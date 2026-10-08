/* ================= Admin & HR: StratEdge certifications and the daily and weekly tests (v32) =================
   Certifications: a credential with a level, an exam drawn from the question bank by topic, a pass mark, attempts,
   prerequisite courses and a validity. The bank: questions with topics and a level, written by hand, copied from the
   course quizzes or drafted by the assistant. Tests: the daily and weekly test sizes and the leaderboard. Results:
   participation, scores, weak topics and every certification attempt (with tab switches). */
const EX_LVL = { 1: 'Basic', 2: 'Intermediate', 3: 'Advanced' };
const EX_WHO_NAMES = { consultant: 'Consultants', employee: 'Employees', student: 'Students' };
const exBlankItem = () => ({ ty: 'mc', q: '', o: ['', '', '', ''], a: 0, why: '', topics: [], lvl: 2 });
const exMatches = (bank, topics) => {
  const want = (topics || []).map(t => t.toLowerCase());
  return want.length ? bank.filter(x => (x.topics || []).some(t => want.includes(t.toLowerCase()))) : bank;
};
const exSrcLabel = s => (s === 'ai' ? 'Assistant' : s && s.startsWith('course:') ? 'Course quiz' : 'Written by hand');

function ExamsAdminPage({ q }) {
  const [tab, setTab] = useState((q && q.tab) || 'progs');
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const load = () =>
    api('ex_admin').then(
      r => {
        setErr(null);
        setD(r);
      },
      e => setErr(e)
    );
  useEffect(() => {
    load();
  }, []);
  if (err) return html`<${LoadError} error=${err} onRetry=${load} />`;
  if (!d) return html`<${Spinner} />`;
  return html`<div className="stack exadmin">
      <${KitStats} items=${[
        { v: d.bank.length, l: 'Questions in the bank', onClick: () => setTab('bank') },
        { v: d.topics.length, l: 'Topics' },
        { v: d.progs.filter(p => p.pub).length, l: 'Certifications published', onClick: () => setTab('progs') },
        { v: (d.cfg.daily.on ? 'Daily' : '') + (d.cfg.daily.on && d.cfg.weekly.on ? ' + ' : '') + (d.cfg.weekly.on ? 'weekly' : '') || 'Off', l: 'Tests switched on', onClick: () => setTab('tests') },
      ]} />
      <${KitTabs} tab=${tab} onTab=${setTab} tabs=${[['progs', 'Certifications', d.progs.length || null], ['bank', 'Question bank', d.bank.length || null], ['tests', 'Daily & weekly tests'], ['results', 'Results']]} />
      ${tab === 'progs' && html`<${ExProgs} d=${d} onChanged=${load} />`}
      ${tab === 'bank' && html`<${ExBank} d=${d} setD=${setD} onChanged=${load} />`}
      ${tab === 'tests' && html`<${ExTestsCfg} d=${d} onSaved=${cfg => setD({ ...d, cfg })} />`}
      ${tab === 'results' && html`<${ExResults} />`}
    </div>`;
}

/* ---- certifications ---- */
function ExProgs({ d, onChanged }) {
  const [edit, setEdit] = useState(null);
  return html`<div className="stack">
      <div className="ph-row">
        <p className="muted small" style=${{ margin: 0, maxWidth: 760 }}>Each certification is an exam drawn from the question bank by topic. People see the published ones under Grow > Certifications (students and outside consultants when their plan includes certifications). Passing issues a certificate with a number and a code anyone can check, a PDF and an "Add to LinkedIn profile" button.</p>
        <button type="button" className="btn" onClick=${() => setEdit({ t: '', code: '', level: 'Associate', d: '', topics: [], courses: [], n: 30, min: 45, pass: 70, tries: 3, cool: 24, valid: 24, who: ['consultant', 'employee', 'student'], pub: false, ord: 50 })}><${Icon} n="plus" />New certification</button>
      </div>
      ${
        d.progs.length
          ? html`<section className="panel" style=${{ padding: '6px 8px' }}><div className="tblwrap"><table className="tbl">
              <thead><tr><th>Certification</th><th>Level</th><th>Exam</th><th>Questions available</th><th>Open to</th><th>Status</th><th className="r"><span className="sr">Edit</span></th></tr></thead>
              <tbody>
                ${d.progs.map(p => {
                  const pool = exMatches(d.bank, p.topics).length;
                  return html`<tr key=${p.id}>
                    <td><b>${p.t}</b>${p.code && html` <span className="muted small">${p.code}</span>`}<div className="muted small">${p.topics.join(', ')}</div></td>
                    <td><span className=${'chip ' + (EX_LEVEL_TONE[p.level] || '')}>${p.level}</span></td>
                    <td className="small">${p.n} questions · ${p.min} min · ${p.pass}% to pass<br />${p.tries} attempt${p.tries === 1 ? '' : 's'} in 30 days${p.cool ? ', ' + p.cool + ' h apart' : ''}${p.valid ? ' · valid ' + p.valid + ' months' : ''}</td>
                    <td>${pool < p.n ? html`<span className="chip amber" title="The exam uses every matching question when there are fewer than it asks for">${pool} of ${p.n}</span>` : html`<span className="chip ok">${pool}</span>`}</td>
                    <td className="small">${p.who.map(w => EX_WHO_NAMES[w]).join(', ')}</td>
                    <td>${p.pub ? html`<span className="chip ok">Published</span>` : html`<span className="chip">Draft</span>`}</td>
                    <td className="r"><button type="button" className="btn ghost sm" onClick=${() => setEdit(p)}>Edit</button></td>
                  </tr>`;
                })}
              </tbody>
            </table></div></section>`
          : html`<section className="panel"><${Empty} title="No certifications yet">Create one, e.g. "StratEdge Certified Java Developer" at Professional level drawn from the Java and Spring topics. The question bank already holds the course quizzes; add more questions by hand or with the assistant under Question bank.<//></section>`
      }
      ${edit && html`<${ExProgModal} p=${edit} d=${d} onClose=${() => setEdit(null)} onSaved=${() => { setEdit(null); onChanged(); }} />`}
    </div>`;
}
function ExProgModal({ p, d, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ ...p, topics: [...(p.topics || [])], courses: [...(p.courses || [])], who: [...(p.who || [])] });
  const [busy, setBusy] = useState(false);
  const [newTopic, setNewTopic] = useState('');
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const toggle = (k, v) => setF(x => ({ ...x, [k]: x[k].includes(v) ? x[k].filter(y => y !== v) : [...x[k], v] }));
  const pool = exMatches(d.bank, f.topics);
  const lvls = pool.reduce((o, x) => ({ ...o, [x.lvl || 2]: (o[x.lvl || 2] || 0) + 1 }), {});
  const save = async () => {
    setBusy(true);
    try {
      await api('ex_prog_save', { prog: f });
      toast(f.pub ? 'Saved and published.' : 'Saved as a draft. Tick Published when it is ready.');
      onSaved();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const del = async () => {
    if (!confirm('Delete this certification? Certificates already issued stay valid.')) return;
    setBusy(true);
    try {
      await api('ex_prog_delete', { id: p.id });
      toast('Deleted.');
      onSaved();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const addTopic = () => {
    const t = newTopic.trim();
    if (t && !f.topics.some(x => x.toLowerCase() === t.toLowerCase())) set('topics', [...f.topics, t]);
    setNewTopic('');
  };
  const num = (k, min, max) => html`<input type="number" min=${min} max=${max} value=${f[k]} onChange=${e => set(k, Math.max(min, Math.min(max, parseInt(e.target.value, 10) || 0)))} />`;
  return html`<${Modal} wide title=${p.id ? 'Edit certification' : 'New certification'} onClose=${onClose} foot=${html`${p.id && html`<button className="btn ghost" style=${{ marginRight: 'auto' }} disabled=${busy} onClick=${del}><${Icon} n="trash" />Delete</button>`}<button className="btn ghost" onClick=${onClose}>Cancel</button><button className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save'}</button>`}>
      <div className="form">
        <div className="row3">
          <${Field} label="Name"><input value=${f.t} onInput=${e => set('t', e.target.value)} placeholder="StratEdge Certified Java Developer" /><//>
          <${Field} label="Short code (optional)"><input value=${f.code} onInput=${e => set('code', e.target.value)} placeholder="SCJD" /><//>
          <${Field} label="Level"><select value=${f.level} onChange=${e => set('level', e.target.value)}>${(d.levels || ['Associate', 'Professional', 'Expert']).map(l => html`<option key=${l}>${l}</option>`)}</select><//>
        </div>
        <${Field} label="What it certifies" hint="Shown to people before they start, and on the verification page."><textarea rows="3" value=${f.d} onInput=${e => set('d', e.target.value)} /><//>
        <div className="fld">
          <span>Topics the questions come from</span>
          <div className="actions" style=${{ flexWrap: 'wrap', gap: 6 }}>
            ${d.topics.map(t => html`<button key=${t.t} type="button" className=${'chip' + (f.topics.some(x => x.toLowerCase() === t.t.toLowerCase()) ? ' new' : '')} style=${{ border: 0, cursor: 'pointer' }} aria-pressed=${f.topics.includes(t.t)} onClick=${() => toggle('topics', t.t)}>${t.t} · ${t.n}</button>`)}
            ${f.topics.filter(t => !d.topics.some(x => x.t.toLowerCase() === t.toLowerCase())).map(t => html`<button key=${t} type="button" className="chip new" style=${{ border: 0, cursor: 'pointer' }} onClick=${() => toggle('topics', t)}>${t} · 0</button>`)}
          </div>
          <div className="actions" style=${{ marginTop: 6 }}><input style=${{ maxWidth: 260 }} value=${newTopic} onInput=${e => setNewTopic(e.target.value)} onKeyDown=${e => e.key === 'Enter' && (e.preventDefault(), addTopic())} placeholder="Another topic (add questions for it in the bank)" /><button type="button" className="btn ghost sm" onClick=${addTopic}>Add</button></div>
          <p className="muted small" style=${{ margin: '6px 0 0' }}>${pool.length} question${pool.length === 1 ? '' : 's'} match: ${Object.entries(lvls).map(([k, n]) => n + ' ' + (EX_LVL[k] || '').toLowerCase()).join(', ') || 'none yet'}. ${pool.length < f.n ? `The exam asks for ${f.n}, so add more questions or ask for fewer.` : 'Each attempt draws a different mix, favouring the level that fits.'}</p>
        </div>
        <div className="row3">
          <${Field} label="Questions per exam">${num('n', 5, 100)}<//>
          <${Field} label="Time limit (minutes)">${num('min', 5, 240)}<//>
          <${Field} label="Pass mark (%)">${num('pass', 40, 100)}<//>
        </div>
        <div className="row3">
          <${Field} label="Attempts in 30 days">${num('tries', 1, 10)}<//>
          <${Field} label="Hours between attempts">${num('cool', 0, 720)}<//>
          <${Field} label="Valid for (months, 0 = no expiry)">${num('valid', 0, 120)}<//>
        </div>
        <div className="fld">
          <span>Courses to finish first (optional)</span>
          <div className="actions" style=${{ flexWrap: 'wrap', gap: 6 }}>${d.courses.map(c => html`<button key=${c.id} type="button" className=${'chip' + (f.courses.includes(c.id) ? ' new' : '')} style=${{ border: 0, cursor: 'pointer' }} aria-pressed=${f.courses.includes(c.id)} onClick=${() => toggle('courses', c.id)}>${c.t}</button>`)}</div>
        </div>
        <div className="row2">
          <div className="fld">
            <span>Open to</span>
            <div className="actions" style=${{ flexWrap: 'wrap' }}>${Object.entries(EX_WHO_NAMES).map(([k, v]) => html`<label key=${k} className="check"><input type="checkbox" checked=${f.who.includes(k)} onChange=${() => toggle('who', k)} /><span>${v}</span></label>`)}</div>
          </div>
          <${Field} label="Order on the page">${num('ord', 0, 999)}<//>
        </div>
        <label className="check"><input type="checkbox" checked=${f.pub} onChange=${e => set('pub', e.target.checked)} /><span><b>Published</b>: people can see it and take the exam</span></label>
      </div>
    <//>`;
}

/* ---- the question bank ---- */
function ExBank({ d, setD, onChanged }) {
  const toast = useToast();
  const [topic, setTopic] = useState('');
  const [lvl, setLvl] = useState('');
  const [qs, setQs] = useState('');
  const [edit, setEdit] = useState(null);
  const [ai, setAi] = useState(false);
  const [pick, setPick] = useState([]);
  const [show, setShow] = useState(60);
  const [busy, setBusy] = useState(false);
  const ql = qs.trim().toLowerCase();
  const list = d.bank.filter(x => (!topic || (x.topics || []).includes(topic)) && (!lvl || String(x.lvl || 2) === lvl) && (!ql || (x.q || '').toLowerCase().includes(ql)));
  const put = item => setD({ ...d, bank: [item, ...d.bank.filter(x => x.id !== item.id)] });
  const delMany = async ids => {
    if (!ids.length || !confirm(`Delete ${ids.length} question${ids.length === 1 ? '' : 's'}? Tests already taken keep their results.`)) return;
    setBusy(true);
    try {
      await api('ex_bank_delete', { ids });
      setD({ ...d, bank: d.bank.filter(x => !ids.includes(x.id)) });
      setPick([]);
      toast('Deleted.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const importCourses = async () => {
    if (!confirm('Copy the quiz questions of every course into the bank again? Courses copied before are copied a second time, which can make duplicates.')) return;
    setBusy(true);
    try {
      const r = await api('ex_bank_import', { again: true });
      toast(`${r.added} question${r.added === 1 ? '' : 's'} copied from the courses.`);
      onChanged();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const shown = list.slice(0, show);
  const allPicked = shown.length > 0 && shown.every(x => pick.includes(x.id));
  return html`<div className="stack">
      <div className="toolbar" style=${{ flexWrap: 'wrap', gap: 8 }}>
        <input type="search" style=${{ maxWidth: 260 }} placeholder="Search the questions" value=${qs} onInput=${e => setQs(e.target.value)} aria-label="Search the questions" />
        <select value=${topic} onChange=${e => setTopic(e.target.value)} aria-label="Topic"><option value="">All topics</option>${d.topics.map(t => html`<option key=${t.t} value=${t.t}>${t.t} (${t.n})</option>`)}</select>
        <select value=${lvl} onChange=${e => setLvl(e.target.value)} aria-label="Level"><option value="">All levels</option>${Object.entries(EX_LVL).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select>
        <div className="actions" style=${{ marginLeft: 'auto' }}>
          ${pick.length > 0 && html`<button type="button" className="btn ghost sm" disabled=${busy} onClick=${() => delMany(pick)}><${Icon} n="trash" />Delete ${pick.length}</button>`}
          <button type="button" className="btn ghost sm" disabled=${busy} onClick=${importCourses}>Copy course quizzes</button>
          <button type="button" className="btn ghost sm" onClick=${() => setAi(true)}><${Icon} n="spark" />Write with the assistant</button>
          <button type="button" className="btn sm" onClick=${() => setEdit({ ...exBlankItem(), topics: topic ? [topic] : [] })}><${Icon} n="plus" />Add a question</button>
        </div>
      </div>
      ${
        list.length
          ? html`<section className="panel" style=${{ padding: '6px 8px' }}><div className="tblwrap"><table className="tbl">
              <thead><tr><th style=${{ width: 28 }}><input type="checkbox" aria-label="Select all shown" checked=${allPicked} onChange=${() => setPick(allPicked ? pick.filter(id => !shown.some(x => x.id === id)) : [...new Set([...pick, ...shown.map(x => x.id)])])} /></th><th>Question</th><th>Type</th><th>Topics</th><th>Level</th><th>Source</th><th className="r"><span className="sr">Edit</span></th></tr></thead>
              <tbody>
                ${shown.map(
                  x => html`<tr key=${x.id}>
                    <td><input type="checkbox" aria-label="Select" checked=${pick.includes(x.id)} onChange=${() => setPick(pick.includes(x.id) ? pick.filter(y => y !== x.id) : [...pick, x.id])} /></td>
                    <td style=${{ maxWidth: 460 }}><span className="clamp2">${x.q}</span></td>
                    <td className="small">${(QUIZ_TYPES.find(t => t[0] === x.ty) || [x.ty, x.ty])[1]}</td>
                    <td>${(x.topics || []).map(t => html`<span key=${t} className="chip" style=${{ marginRight: 4 }}>${t}</span>`)}</td>
                    <td className="small">${EX_LVL[x.lvl || 2]}</td>
                    <td className="small muted">${exSrcLabel(x.src)}</td>
                    <td className="r"><button type="button" className="btn ghost sm" onClick=${() => setEdit(x)}>Edit</button></td>
                  </tr>`
                )}
              </tbody>
            </table></div>
            ${list.length > show && html`<div className="actions" style=${{ margin: 8 }}><button type="button" className="btn ghost sm" onClick=${() => setShow(show + 100)}>Show more (${list.length - show} left)</button></div>`}
            </section>`
          : html`<section className="panel"><${Empty} title=${d.bank.length ? 'No question matches' : 'The bank is empty'}>${d.bank.length ? 'Change the search or the filters.' : 'Copy the course quizzes in, add questions by hand or have the assistant draft a set for a topic.'}<//></section>`
      }
      ${edit && html`<${ExItemModal} item=${edit} topics=${d.topics} onClose=${() => setEdit(null)} onSaved=${it => { put(it); setEdit(null); }} onDeleted=${id => { setD({ ...d, bank: d.bank.filter(x => x.id !== id) }); setEdit(null); }} />`}
      ${ai && html`<${ExAiModal} d=${d} topic=${topic} onClose=${() => setAi(false)} onDone=${items => { setD({ ...d, bank: [...items, ...d.bank] }); setAi(false); onChanged(); }} />`}
    </div>`;
}
function ExItemModal({ item, topics, onClose, onSaved, onDeleted }) {
  const toast = useToast();
  const [q, setQ] = useState({ ...item });
  const [tops, setTops] = useState((item.topics || []).join(', '));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api('ex_bank_save', { item: { ...q, topics: tops.split(',').map(x => x.trim()).filter(Boolean) } });
      toast('Saved.');
      onSaved(r.item);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const del = async () => {
    if (!confirm('Delete this question?')) return;
    setBusy(true);
    try {
      await api('ex_bank_delete', { ids: [item.id] });
      toast('Deleted.');
      onDeleted(item.id);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<${Modal} wide title=${item.id ? 'Edit question' : 'New question'} onClose=${onClose} foot=${html`${item.id && html`<button className="btn ghost" style=${{ marginRight: 'auto' }} disabled=${busy} onClick=${del}><${Icon} n="trash" />Delete</button>`}<button className="btn ghost" onClick=${onClose}>Cancel</button><button className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save'}</button>`}>
      <div className="form">
        <div className="row2">
          <${Field} label="Topics (comma separated)" hint=${topics.length ? 'In use: ' + topics.slice(0, 12).map(t => t.t).join(', ') + (topics.length > 12 ? '…' : '') : ''}><input value=${tops} onInput=${e => setTops(e.target.value)} placeholder="Java, Spring Boot" /><//>
          <${Field} label="Level"><select value=${String(q.lvl || 2)} onChange=${e => setQ({ ...q, lvl: Number(e.target.value) })}>${Object.entries(EX_LVL).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//>
        </div>
        <${QuizItemEditor} q=${q} onChange=${setQ} onRemove=${item.id ? del : onClose} />
      </div>
    <//>`;
}
function ExAiModal({ d, topic, onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({ topic: topic || '', n: 8, lvl: 2 });
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (f.topic.trim().length < 2) {
      toast('Name the topic.', true);
      return;
    }
    setBusy(true);
    try {
      const r = await api('ex_bank_ai', f, { timeout: 150000 });
      toast(`${r.items.length} question${r.items.length === 1 ? '' : 's'} added to the bank. Check them under the topic.`);
      onDone(r.items);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<${Modal} title="Write questions with the assistant" onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Cancel</button><button className="btn" disabled=${busy || !d.ai} onClick=${go}><${Icon} n="spark" />${busy ? 'Writing…' : 'Write them'}</button>`}>
      <div className="form">
        ${!d.ai && html`<div className="note amber"><span>The assistant is not set up. An administrator adds it under Admin > Website & messages > Assistant (AI).</span></div>`}
        <${Field} label="Topic"><input value=${f.topic} onInput=${e => setF({ ...f, topic: e.target.value })} placeholder="e.g. Kubernetes, ICD-10 coding, US payroll taxes" list="extopics" /><datalist id="extopics">${d.topics.map(t => html`<option key=${t.t} value=${t.t} />`)}</datalist><//>
        <div className="row2">
          <${Field} label="How many (3 to 15)"><input type="number" min="3" max="15" value=${f.n} onChange=${e => setF({ ...f, n: Math.max(3, Math.min(15, parseInt(e.target.value, 10) || 8)) })} /><//>
          <${Field} label="Level"><select value=${String(f.lvl)} onChange=${e => setF({ ...f, lvl: Number(e.target.value) })}>${Object.entries(EX_LVL).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//>
        </div>
        <p className="muted small" style=${{ margin: 0 }}>The questions go straight into the bank, marked "Assistant". Read them before publishing an exam that uses them: the assistant can be wrong.</p>
      </div>
    <//>`;
}

/* ---- daily and weekly test settings ---- */
function ExTestsCfg({ d, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState(JSON.parse(JSON.stringify(d.cfg)));
  const [busy, setBusy] = useState(false);
  const set = (k, kk, v) => setF(x => ({ ...x, [k]: { ...x[k], [kk]: v } }));
  const save = async () => {
    setBusy(true);
    try {
      const r = await api('ex_cfg_save', { cfg: f });
      toast('Saved.');
      onSaved(r.cfg);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const block = (k, title, hint, maxN, maxMin) => html`<section className="panel">
      <label className="check"><input type="checkbox" checked=${f[k].on} onChange=${e => set(k, 'on', e.target.checked)} /><span><b>${title}</b></span></label>
      <p className="muted small">${hint}</p>
      <div className="form"><div className="row2">
        <${Field} label="Questions"><input type="number" min="3" max=${maxN} value=${f[k].n} disabled=${!f[k].on} onChange=${e => set(k, 'n', parseInt(e.target.value, 10) || 0)} /><//>
        <${Field} label="Minutes"><input type="number" min="2" max=${maxMin} value=${f[k].min} disabled=${!f[k].on} onChange=${e => set(k, 'min', parseInt(e.target.value, 10) || 0)} /><//>
      </div></div>
    </section>`;
  return html`<div className="stack">
      <div className="g2">
        ${block('daily', 'Daily test', 'A short set every day from the topics each person picks (all topics when they pick none), avoiding the questions they saw lately. Streaks count consecutive days.', 30, 60)}
        ${block('weekly', 'Weekly test', 'One longer test per week (Monday to Sunday), the same idea with more questions.', 80, 180)}
      </div>
      <section className="panel">
        <label className="check"><input type="checkbox" checked=${f.board} onChange=${e => setF({ ...f, board: e.target.checked })} /><span><b>Weekly leaderboard</b>: the top ten weekly scores, shown as first name and initial</span></label>
      </section>
      <div className="actions"><button type="button" className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save'}</button></div>
    </div>`;
}

/* ---- results ---- */
function ExResults() {
  const [r, setR] = useState(null);
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState('people');
  useEffect(() => {
    api('ex_results').then(setR, setErr);
  }, []);
  if (err) return html`<${LoadError} error=${err} />`;
  if (!r) return html`<${Spinner} />`;
  return html`<div className="stack">
      <${KitTabs} tab=${tab} onTab=${setTab} tabs=${[['people', 'People', r.people.length || null], ['tries', 'Certification exams', r.tries.length || null], ['topics', 'Topics']]} />
      ${
        tab === 'people' &&
        (r.people.length
          ? html`<section className="panel" style=${{ padding: '6px 8px' }}><div className="tblwrap"><table className="tbl">
              <thead><tr><th>Person</th><th className="r">Daily tests (30 days)</th><th className="r">Average</th><th className="r">Streak</th><th>Weekly (last 4)</th><th>Certifications</th></tr></thead>
              <tbody>${r.people.map(p => html`<tr key=${p.id}><td><b>${p.n}</b><div className="muted small">${p.e}</div></td><td className="r">${p.days}</td><td className="r">${p.avg == null ? '—' : p.avg + '%'}</td><td className="r">${p.streak}</td><td className="small">${Object.values(p.weekly || {}).map(v => v + '%').join(' · ') || '—'}</td><td className="small">${p.certs.length ? p.certs.join(', ') : p.tries ? p.tries + ' attempt' + (p.tries === 1 ? '' : 's') : '—'}</td></tr>`)}</tbody>
            </table></div></section>`
          : html`<section className="panel"><${Empty} title="Nobody has taken a test yet">Results show up here as people take the daily and weekly tests and the certification exams.<//></section>`)
      }
      ${
        tab === 'tries' &&
        (r.tries.length
          ? html`<section className="panel" style=${{ padding: '6px 8px' }}><div className="tblwrap"><table className="tbl">
              <thead><tr><th>Person</th><th>Certification</th><th>Started</th><th className="r">Score</th><th>Result</th><th className="r" title="How often the person left the exam page">Left the page</th></tr></thead>
              <tbody>${r.tries.map((t, i) => html`<tr key=${i}><td>${t.n}</td><td>${t.t}</td><td className="small">${fmtTs(t.at)}</td><td className="r">${t.pct == null ? '—' : t.pct + '%'}</td><td>${!t.done ? html`<span className="chip new">In progress</span>` : t.passed ? html`<span className="chip ok">Passed</span>` : html`<span className="chip red">Not passed</span>`}${t.late ? html` <span className="chip amber">Late</span>` : ''}</td><td className="r">${t.tabs ? html`<span className=${'chip ' + (t.tabs > 3 ? 'red' : 'amber')}>${t.tabs}</span>` : '0'}</td></tr>`)}</tbody>
            </table></div></section>`
          : html`<section className="panel"><${Empty} title="No certification exams yet"><//></section>`)
      }
      ${
        tab === 'topics' &&
        (r.topics.length
          ? html`<section className="panel"><p className="muted small" style=${{ marginTop: 0 }}>Right answers per topic across everyone's daily and weekly tests, weakest first: good candidates for a course or a refresher.</p><ul className="list">${r.topics.map(t => html`<li key=${t.t}><span>${t.t} <span className="muted small">· ${t.n} answers</span></span><span className=${'chip ' + (t.pct >= 70 ? 'ok' : t.pct >= 50 ? 'amber' : 'red')}>${t.pct}%</span></li>`)}</ul></section>`
          : html`<section className="panel"><${Empty} title="No answers yet"><//></section>`)
      }
    </div>`;
}
