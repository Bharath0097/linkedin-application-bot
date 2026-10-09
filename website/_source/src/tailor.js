/* ================= Resume tailoring (v31): a job description in, an ATS-ready resume out =================
   Members tailor their own resumes (Tailor my resume); recruiters, recruiting team and HR work from Tailor & submit:
   find the best consultants for a JD, tailor one, download DOCX/PDF, log the submission and email the vendor. */
const TL_RUN_TIMEOUT = 345000; // v33: a long resume (many pages) can take a few minutes
const tlFile = (item, ext, dl) => (item && item.files && item.files[ext] ? fileUrl(item.base, item.files[ext].id, !!dl) : '');
const tlScoreClass = v => (v >= 75 ? 'ok' : v >= 50 ? 'amber' : 'red');

/* ---------- the score panel: before/after, keywords, requirement lines, format checks ---------- */
/* v69: while editing, `live` is the draft's score (tl_score) — shown beside the saved one; onCheck scores now; auto scores
   after each change; a missing keyword can be added to the skills (onAdd) */
function TailorScore({ item, live, editing, onCheck, scoring, auto, setAuto, onAdd }) {
  const b = item.before || { score: 0 };
  const saved = item.after || { score: 0, kw: { have: [], missing: [] }, terms: { have: [], missing: [] }, reqs: [], checks: [] };
  const a = editing && live ? live : saved;
  const [more, setMore] = useState(false);
  const delta = editing && live ? live.score - saved.score : 0;
  return html`<section className=${'panel tlscore' + (editing ? ' editing' : '')}>
    <div className="tlnums">
      <div className="tlnum"><span className="muted small">Original</span><b className=${tlScoreClass(b.score)}>${b.score}</b></div>
      <div className="tlarrow" aria-hidden="true">→</div>
      <div className="tlnum"><span className="muted small">${editing && live ? 'Draft' : 'Tailored'}</span><b className=${tlScoreClass(a.score)}>${a.score}</b><span className="muted small">ATS match${editing && live ? html` · saved ${saved.score}${delta ? html` <span className=${delta > 0 ? 'tlup' : 'tldown'}>(${delta > 0 ? '+' : ''}${delta})</span>` : ''}` : ''}</span></div>
      ${editing && html`<div className="tlcheck">
        <button type="button" className="btn sm" disabled=${scoring} onClick=${onCheck}><${Icon} n="target" />${scoring ? 'Scoring…' : 'Check ATS score'}</button>
        <label className="check small"><input type="checkbox" checked=${!!auto} onChange=${e => setAuto(e.target.checked)} /><span>Score as I edit</span></label>
        <span className="muted small">${live ? 'The draft is scored against the job; save to rewrite the files.' : 'Not scored yet: the numbers are the saved version\'s.'}</span>
      </div>`}
      <div className="tlfacts muted small">
        ${a.years && a.years.need ? html`<div>Asks ${a.years.need}+ years · resume shows ${a.years.have == null ? '?' : a.years.have}</div>` : ''}
        ${a.title && a.title.jd ? html`<div>${a.title.ok ? '✓' : '✗'} Job title in the headline or summary</div>` : ''}
        ${a.words ? html`<div>${a.words} words</div>` : ''}
        ${item.mode === 'ai' ? html`<div>Rewritten by the assistant</div>` : html`<div>Reordered and summarized (no assistant rewrite)</div>`}
      </div>
    </div>
    <div className="tlkw">
      <b className="small">Keywords from the job</b>
      <div className="chips">
        ${(a.kw.have || []).map(k => html`<span key=${'h' + k} className="chip ok">${k}</span>`)}
        ${(a.kw.missing || []).map(k => editing && onAdd ? html`<button key=${'m' + k} type="button" className="chip tladd" title="Add it to the core skills (only if it is true)" onClick=${() => onAdd(k)}>+ ${k}</button>` : html`<span key=${'m' + k} className="chip">${k}</span>`)}
        ${(a.terms && a.terms.have || []).map(k => html`<span key=${'th' + k} className="chip ok">${k}</span>`)}
        ${(a.terms && a.terms.missing || []).map(k => editing && onAdd ? html`<button key=${'tm' + k} type="button" className="chip tladd" title="Add it to the core skills (only if it is true)" onClick=${() => onAdd(k)}>+ ${k}</button>` : html`<span key=${'tm' + k} className="chip">${k}</span>`)}
      </div>
      <span className="muted small">Green = on the tailored resume. Grey = asked for, not evidenced: add it only if it is true.${editing ? ' While editing, "+ keyword" puts it in the core skills and the score follows.' : ''}</span>
    </div>
    ${
      (a.fit || []).length &&
      html`<div className="tlfit">
        <b className="small">Fit by module${item.analysis && item.analysis.summary ? html` <span className="muted" style=${{ fontWeight: 400 }}>· ${item.analysis.summary}</span>` : ''}</b>
        <div className="tblwrap"><table className="tbl tlfittbl">
          <thead><tr><th>Module</th><th>Before</th><th>After</th><th>Evidence</th></tr></thead>
          <tbody>${a.fit.map((m, i) => { const bf = ((b.fit || []).find(x => x.module === m.module) || {}).level; return html`<tr key=${i}>
            <td><b>${m.module}</b>${m.must === false ? html`<div className="muted small">nice-to-have</div>` : ''}</td>
            <td>${bf ? html`<span className=${'chip ' + (bf === 'strong' ? 'ok' : bf === 'partial' ? 'amber' : '')}>${bf}</span>` : ''}</td>
            <td><span className=${'chip ' + (m.level === 'strong' ? 'ok' : m.level === 'partial' ? 'amber' : 'red')}>${m.level}</span></td>
            <td className="small">${m.evidence}${m.missing && m.missing.length ? html`<div className="muted">Missing: ${m.missing.join(', ')}</div>` : ''}</td>
          </tr>`; })}</tbody>
        </table></div>
        ${item.analysis && (item.analysis.constraints || []).length ? html`<div className="muted small">Constraints: ${item.analysis.constraints.join(' · ')}</div>` : ''}
      </div>`
    }
    <button type="button" className="btn ghost sm" onClick=${() => setMore(!more)}>${more ? 'Hide the detail' : 'Requirement lines and format checks'}</button>
    ${
      more &&
      html`<div className="row2">
        <div>
          <b className="small">Requirement lines (${(a.reqs || []).filter(r => r.ok).length}/${(a.reqs || []).length} covered)</b>
          <ul className="tllist">${(a.reqs || []).map((r, i) => html`<li key=${i} className=${r.ok ? 'ok' : ''}>${r.ok ? '✓' : '○'} ${r.t}</li>`)}</ul>
        </div>
        <div>
          <b className="small">Format checks</b>
          <ul className="tllist">${(a.checks || []).map((c, i) => html`<li key=${i} className=${c.ok ? 'ok' : ''}>${c.ok ? '✓' : '○'} ${c.t}</li>`)}</ul>
        </div>
      </div>`
    }
  </section>`;
}

/* ---------- the resume itself, read-only ---------- */
function TailorPreview({ r }) {
  if (!r) return null;
  const contact = [r.email, r.phone, r.loc, r.linkedin, r.auth].filter(Boolean);
  return html`<div className="tlpreview">
    <h2>${r.name || 'Resume'}</h2>
    ${r.title && html`<div className="tlrole">${r.title}</div>`}
    ${contact.length ? html`<div className="muted small">${contact.join('  |  ')}</div>` : ''}
    ${(r.summary || (r.hl || []).length) ? html`<h4>Professional summary</h4>${r.summary ? html`<p>${r.summary}</p>` : ''}${(r.hl || []).length ? html`<ul>${r.hl.map((h, i) => html`<li key=${i}>${h}</li>`)}</ul>` : ''}` : ''}
    ${(r.skills || []).length ? html`<h4>Core skills</h4>${r.skills.map((g, i) => html`<p key=${i}><b>${g.g}:</b> ${g.items.join(', ')}</p>`)}` : ''}
    ${
      (r.experience || []).length &&
      html`<h4>Professional experience</h4>
        ${r.experience.map((e, i) => html`<div key=${i} className="tljob">
          <div className="tljobhead"><b>${e.ti || 'Role'}</b><span className="muted small">${[e.from, e.to].filter(Boolean).join(' – ')}</span></div>
          <div className="muted small">${[e.co, e.loc].filter(Boolean).join(' — ')}</div>
          <ul>${(e.bullets || []).map((b, j) => html`<li key=${j}>${b}</li>`)}</ul>
          ${e.env ? html`<p className="small"><b>Environment:</b> ${e.env}</p>` : ''}
        </div>`)}`
    }
    ${(r.projects || []).length ? html`<h4>Projects</h4>${r.projects.map((p, i) => html`<p key=${i}><b>${p.t}</b>${p.d ? ' — ' + p.d : ''}</p>`)}` : ''}
    ${(r.education || []).length ? html`<h4>Education</h4>${r.education.map((e, i) => html`<p key=${i}>${e.t}</p>`)}` : ''}
    ${(r.certs || []).length ? html`<h4>Certifications</h4><ul>${r.certs.map((c, i) => html`<li key=${i}>${c}</li>`)}</ul>` : ''}
    ${(r.other || []).length ? html`<h4>Additional</h4>${r.other.map((o, i) => html`<p key=${i}>${o}</p>`)}` : ''}
  </div>`;
}

/* ---------- the editor: plain textareas per section, one line per bullet ---------- */
function TailorEditor({ r, onChange }) {
  const set = (k, v) => onChange({ ...r, [k]: v });
  const lines = s => s.split('\n').map(x => x.trim()).filter(Boolean);
  const skillsText = (r.skills || []).map(g => g.g + ': ' + g.items.join(', ')).join('\n');
  const setSkills = txt =>
    set(
      'skills',
      lines(txt).map(l => {
        const m = l.match(/^([^:]{1,60}):\s*(.*)$/);
        const g = m ? m[1].trim() : 'Skills';
        const items = (m ? m[2] : l).split(/\s*,\s*(?![^()]*\))/).map(x => x.trim()).filter(Boolean);
        return { g, items };
      })
    );
  const setExp = (i, k, v) => set('experience', r.experience.map((e, j) => (j === i ? { ...e, [k]: v } : e)));
  return html`<div className="stack tledit">
    <div className="row2">
      <${Field} label="Name"><input value=${r.name || ''} onInput=${e => set('name', e.target.value)} /><//>
      <${Field} label="Headline (target title)"><input value=${r.title || ''} onInput=${e => set('title', e.target.value)} /><//>
    </div>
    <div className="row2">
      <${Field} label="Email"><input value=${r.email || ''} onInput=${e => set('email', e.target.value)} /><//>
      <${Field} label="Phone"><input value=${r.phone || ''} onInput=${e => set('phone', e.target.value)} /><//>
    </div>
    <div className="row2">
      <${Field} label="Location"><input value=${r.loc || ''} onInput=${e => set('loc', e.target.value)} /><//>
      <${Field} label="Work authorization (optional)"><input value=${r.auth || ''} onInput=${e => set('auth', e.target.value)} placeholder="H-1B, GC, US Citizen…" /><//>
    </div>
    <${Field} label="LinkedIn"><input value=${r.linkedin || ''} onInput=${e => set('linkedin', e.target.value)} /><//>
    <${Field} label="Professional summary"><textarea rows="4" value=${r.summary || ''} onInput=${e => set('summary', e.target.value)} /><//>
    <${Field} label="Summary bullets (one per line, optional)" hint="Longer resumes list the highlights as bullet points under the summary."><textarea rows=${Math.max(2, Math.min(12, (r.hl || []).length + 1))} defaultValue=${(r.hl || []).join('\n')} onBlur=${e => set('hl', lines(e.target.value))} /><//>
    <${Field} label="Core skills" hint='One group per line: "Group: skill, skill, skill".'><textarea key=${skillsText} rows=${Math.max(3, (r.skills || []).length + 1)} defaultValue=${skillsText} onBlur=${e => setSkills(e.target.value)} /><//>
    <b className="small">Experience (employers, titles and dates are kept from the original)</b>
    ${(r.experience || []).map((e, i) => html`<div key=${i} className="panel tlexp" style=${{ background: 'var(--surface-2)' }}>
      <div className="tljobhead"><b>${e.ti || 'Role'}</b><span className="muted small">${[e.co, e.loc].filter(Boolean).join(' — ')} · ${[e.from, e.to].filter(Boolean).join(' – ')}</span></div>
      <${Field} label="Bullets (one per line)"><textarea rows=${Math.max(3, Math.min(18, (e.bullets || []).length + 1))} defaultValue=${(e.bullets || []).join('\n')} onBlur=${ev => setExp(i, 'bullets', lines(ev.target.value))} /><//>
      <${Field} label="Environment (tools used in this job, optional)"><input defaultValue=${e.env || ''} onBlur=${ev => setExp(i, 'env', ev.target.value.trim())} placeholder="Java, Spring Boot, AWS, Jenkins" /><//>
    </div>`)}
    <div className="row2">
      <${Field} label="Education (one per line)"><textarea rows="2" defaultValue=${(r.education || []).map(x => x.t).join('\n')} onBlur=${e => set('education', lines(e.target.value).map(t => ({ t })))} /><//>
      <${Field} label="Certifications (one per line)"><textarea rows="2" defaultValue=${(r.certs || []).join('\n')} onBlur=${e => set('certs', lines(e.target.value))} /><//>
    </div>
    <${Field} label="Projects (one per line, \"Title — what it was\")"><textarea rows="2" defaultValue=${(r.projects || []).map(p => p.t + (p.d ? ' — ' + p.d : '')).join('\n')} onBlur=${e => set('projects', lines(e.target.value).map(l => { const m = l.split(/\s+[—-]\s+/); return { t: m[0], d: m.slice(1).join(' - ') }; }))} /><//>
  </div>`;
}

/* ---------- email the files to a vendor or client (staff), or to yourself ---------- */
function TailorEmailModal({ item, scope, mymail, onClose, onSent }) {
  const toast = useToast();
  const r = item.out || {};
  const who = item.who || {};
  const sk = ((item.after && item.after.kw && item.after.kw.have) || []).slice(0, 6).join(', ');
  const [f, setF] = useState({
    to: '',
    cc: '',
    subject: `Submission: ${who.n || r.name || 'Consultant'} – ${item.t || ''}${item.co ? ' – ' + item.co : ''}`,
    text: `Hello,\n\nPlease find attached the resume of ${who.n || r.name || 'our consultant'} for the ${item.t || 'role'}${item.co ? ' at ' + item.co : ''}.\n\n${r.title ? r.title + (item.after && item.after.years && item.after.years.have ? ' with ' + item.after.years.have + '+ years of experience' : '') + '.' : ''}${sk ? ' Key skills: ' + sk + '.' : ''}${r.loc ? ' Location: ' + r.loc + '.' : ''}${r.auth ? ' Work authorization: ' + r.auth + '.' : ''}\n\nAvailable to interview at your convenience. Rate and availability on request.\n\nThank you,\n${(Cap.me && Cap.me.name) || ''}\n${CO.name || ''}${CO.phone || CO.email ? '\n' + [CO.phone, CO.email].filter(Boolean).join(' · ') : ''}`,
    which: 'both',
  });
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      const res = await api('tl_email', { scope, id: item.id, ...f });
      toast('Sent to ' + res.to.join(', ') + ' from ' + res.via + '.');
      onSent && onSent();
      onClose();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<${Modal} wide title="Email the tailored resume" onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Cancel</button><button type="button" className="btn" disabled=${busy} onClick=${send}>${busy ? 'Sending…' : 'Send'}</button>`}>
    <p className="muted small" style=${{ marginTop: 0 }}>${mymail ? 'Goes out from your own connected mailbox (My email), so replies come back to you.' : 'Goes out from the company mailbox with your address as reply-to. Connect your own mailbox under My email to send as yourself.'}</p>
    <div className="row2">
      <${Field} label="To"><input value=${f.to} onInput=${e => setF({ ...f, to: e.target.value })} placeholder="vendor@example.com, second@example.com" /><//>
      <${Field} label="Cc"><input value=${f.cc} onInput=${e => setF({ ...f, cc: e.target.value })} /><//>
    </div>
    <${Field} label="Subject"><input value=${f.subject} onInput=${e => setF({ ...f, subject: e.target.value })} /><//>
    <${Field} label="Message"><div className="aibar"><${SigButton} onInsert=${s => setF({ ...f, text: sigAppend(f.text, s) })} /></div><textarea rows="10" value=${f.text} onInput=${e => setF({ ...f, text: e.target.value })} /><//>
    <${Field} label="Attach">
      <select value=${f.which} onChange=${e => setF({ ...f, which: e.target.value })}>
        <option value="both">Word and PDF</option>
        <option value="docx">Word (.docx) only</option>
        <option value="pdf">PDF only</option>
      </select>
    <//>
  <//>`;
}

/* ---------- a finished tailoring: score, notes, preview/editor, files and the next steps ---------- */
function TailorResult({ item: item0, scope, staff, mymail, onChanged, onDeleted }) {
  const toast = useToast();
  const P = usePortal();
  const cands = useCol(staff ? 'rec/cand/items' : null, 'n:asc');
  const [item, setItem] = useState(item0);
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [mail, setMail] = useState(false);
  const [sub, setSub] = useState(false);
  // v69: the draft's ATS score while editing
  const [live, setLive] = useState(null);
  const [scoring, setScoring] = useState(false);
  const [auto, setAutoState] = useState(() => { try { return localStorage.getItem('se_tl_auto') !== '0'; } catch (e) { return true; } });
  const setAuto = v => { setAutoState(v); try { localStorage.setItem('se_tl_auto', v ? '1' : '0'); } catch (e) {} };
  const scoreRef = useRef(0);
  const score = async d => {
    const my = ++scoreRef.current;
    setScoring(true);
    try {
      const res = await api('tl_score', { scope, id: item.id, resume: d || draft }, { timeout: 60000 });
      if (my === scoreRef.current) setLive(res.after);
    } catch (e) {
      if (my === scoreRef.current) toast(errText(e), true);
    }
    if (my === scoreRef.current) setScoring(false);
  };
  useEffect(() => {
    if (!edit || !auto || !draft) return;
    const t = setTimeout(() => score(draft), 1200);
    return () => clearTimeout(t);
  }, [edit, auto, draft]);
  useEffect(() => {
    if (!edit) setLive(null);
  }, [edit]);
  const addKeyword = k => {
    const groups = (draft && draft.skills) || [];
    const has = groups.some(g => (g.items || []).some(x => x.toLowerCase() === k.toLowerCase()));
    if (has) return;
    const ix = groups.findIndex(g => /^keywords?$/i.test(g.g || ''));
    const next = ix >= 0 ? groups.map((g, i) => (i === ix ? { ...g, items: [...g.items, k] } : g)) : [...groups, { g: 'Keywords', items: [k] }];
    setDraft({ ...draft, skills: next });
    toast('Added "' + k + '" to the core skills. Keep it only if it is true.');
  };
  useEffect(() => {
    setItem(item0);
    setEdit(false);
  }, [item0 && item0.id]);
  // hooks stay above the early return so they run in the same order on every render
  const [pg, setPg] = useState(item0 ? item0.pages || 0 : 0);
  useEffect(() => setPg(item0 ? item0.pages || 0 : 0), [item0 && item0.id]);
  if (!item) return null;
  const r = item.out || {};
  const who = item.who || {};
  const setPages = async pages => {
    setBusy(true);
    try {
      const res = await api('tl_pages', { scope, id: item.id, pages }, { timeout: TL_RUN_TIMEOUT });
      setItem(res.item);
      setPg(res.item.pages || 0);
      const n = res.item.pageN;
      toast(!pages ? 'Back to its own length; the Word and PDF files were rewritten.' : n === pages ? `Now ${tlPagesWord(pages)}; the Word and PDF files were rewritten.` : `Came to ${tlPagesWord(n)} of the ${pages} needed; the notes below say why.`, !!pages && n !== pages);
      onChanged && onChanged(res.item);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const save = async () => {
    setBusy(true);
    try {
      const res = await api('tl_save', { scope, id: item.id, resume: draft, t: item.t, co: item.co, vn: item.vn }, { timeout: 60000 });
      setItem(res.item);
      setEdit(false);
      toast('Saved; the Word and PDF files were rewritten.');
      onChanged && onChanged(res.item);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const rescore = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const before = item.after && item.after.score != null ? item.after.score : 0;
      const res = await api('tl_save', { scope, id: item.id, resume: draft, t: item.t, co: item.co, vn: item.vn }, { timeout: 60000 });
      setItem(res.item);
      setDraft(JSON.parse(JSON.stringify(res.item.out || draft)));
      setEdit(true);
      toast(`Saved; the Word and PDF files were rewritten. ATS score ${before} → ${res.item.after.score}.`);
      onChanged && onChanged(res.item);
    } catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  const del = async () => {
    if (!confirm('Delete this tailored resume and its files?')) return;
    try {
      await api('tl_delete', { scope, id: item.id });
      toast('Deleted.');
      onDeleted && onDeleted(item.id);
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const subInit = {
    cid: who.kind === 'cand' ? who.id : '',
    cn: who.n || r.name || '',
    req: item.t || '',
    vn: item.vn || item.co || '',
    ec: item.co || '',
    notes: 'Tailored resume: ' + ((item.files && item.files.docx && item.files.docx.n) || '') + ' (Tailor & submit)',
    tl: { base: item.base, id: item.id, fid: item.files && item.files.docx ? item.files.docx.id : '', n: item.files && item.files.docx ? item.files.docx.n : '' },
  };
  const onSubSaved = async sid => {
    try {
      await api('tl_link', { id: item.id, sub: sid });
      const res = await api('tl_get', { scope, id: item.id });
      setItem(res.item);
      onChanged && onChanged(res.item);
    } catch (e) {}
  };
  return html`<div className="stack tlresult">
    <section className="panel">
      <div className="tlhead">
        <div style=${{ minWidth: 0 }}>
          <h3 style=${{ margin: 0 }}>${who.n || r.name || 'Resume'} <span className="muted">for</span> ${item.t}${item.co ? html` <span className="muted">at</span> ${item.co}` : ''}</h3>
          <div className="muted small">${fmtTs(item.u || item.at)}${item.byn ? ' · by ' + item.byn : ''} · from ${item.src && item.src.label ? item.src.label : 'resume'}${item.st === 'sent' ? ' · emailed' : item.st === 'submitted' ? ' · submission logged' : item.st === 'edited' ? ' · edited' : ''}${item.pageN ? ' · ' + (item.pages && item.pageN !== item.pages ? item.pageN + ' of ' + tlPagesWord(item.pages) : tlPagesWord(item.pageN)) : ''}</div>
        </div>
        <div className="actions">
          <${TlPages} label="Pages" value=${pg} onChange=${setPg} disabled=${busy} />
          ${(pg !== (item.pages || 0) || (pg && item.pageN && item.pageN < pg)) && html`<button type="button" className="btn sm" disabled=${busy} onClick=${() => setPages(pg)}>${busy ? (pg >= 4 ? 'Writing… (a few minutes)' : 'Fitting…') : pg ? 'Fit to ' + tlPagesWord(pg) : 'Use its own length'}</button>`}
          ${tlFile(item, 'docx') && html`<a className="btn sm" href=${tlFile(item, 'docx', true)}><${Icon} n="down" />Word</a>`}
          ${tlFile(item, 'pdf') && html`<a className="btn sm ghost" href=${tlFile(item, 'pdf', true)}><${Icon} n="down" />PDF</a>`}
          ${tlFile(item, 'pdf') && html`<a className="btn sm ghost" href=${tlFile(item, 'pdf')} target="_blank" rel="noopener noreferrer"><${Icon} n="eye" />View</a>`}
          <button type="button" className="btn sm ghost" onClick=${() => setMail(true)}><${Icon} n="mail" />${staff ? 'Email to vendor' : 'Email it'}</button>
          ${staff && html`<button type="button" className="btn sm ghost" onClick=${() => setSub(true)}><${Icon} n="send" />Log submission</button>`}
          <button type="button" className="btn sm ghost danger" onClick=${del}><${Icon} n="trash" /></button>
        </div>
      </div>
    </section>
    <${TailorScore} item=${item} live=${live} editing=${edit} onCheck=${() => score(draft)} scoring=${scoring} auto=${auto} setAuto=${setAuto} onAdd=${addKeyword} />
    ${
      ((item.changes || []).length || (item.gaps || []).length || (item.added || []).length || (item.flags || []).length || (item.fitNotes || []).length) &&
      html`<section className="panel tlnotes">
        <div className="row2">
          ${((item.changes || []).length || (item.fitNotes || []).length) && html`<div><b className="small">What changed</b><ul className="tllist">${(item.changes || []).map((c, i) => html`<li key=${i}>${c}</li>`)}${(item.fitNotes || []).length ? html`<li><b>Length (${tlPagesWord(item.pages)} needed):</b> ${item.fitNotes.join('; ')}.</li>` : ''}</ul></div>`}
          ${(item.gaps || []).length && html`<div><b className="small">Gaps the job asks for (not on the resume)</b><ul className="tllist">${item.gaps.map((g, i) => html`<li key=${i}>○ ${g}</li>`)}</ul><span className="muted small">${staff ? 'Confirm with the consultant before claiming any of these.' : 'Only add these if you have done them; the editor below is for that.'}</span></div>`}
        </div>
        ${(item.added || []).length && html`<div className="note amber"><span><b>Keywords the rewrite introduced that the original resume never mentioned:</b> ${item.added.join(', ')}. ${staff ? 'Check them with the consultant' : 'Remove any that are not true'} before sending; the editor below lets you change the wording.</span></div>`}
        ${(item.flags || []).map((f, i) => html`<div key=${i} className="note"><span>${f}</span></div>`)}
      </section>`
    }
    <section className="panel">
      <div className="tlhead">
        <b>${edit ? 'Edit the tailored resume' : 'Tailored resume'}</b>
        <div className="actions">
          ${edit
            ? html`<button type="button" className="btn ghost sm" disabled=${busy} onClick=${() => setEdit(false)}>Cancel</button><button type="button" className="btn ghost sm" disabled=${busy} onClick=${rescore} title="Saves the draft, rewrites the Word and PDF files and scores it; Cancel will not undo this"><${Icon} n="star" />Save and rescore${item.after && item.after.score != null ? ' (' + item.after.score + ')' : ''}</button><button type="button" className="btn sm" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save and rewrite the files'}</button>`
            : html`<button type="button" className="btn ghost sm" onClick=${() => { setDraft(JSON.parse(JSON.stringify(r))); setEdit(true); }}><${Icon} n="pen" />Edit</button>`}
        </div>
      </div>
      ${edit ? html`<${TailorEditor} r=${draft} onChange=${setDraft} />` : html`<${TailorPreview} r=${r} />`}
    </section>
    ${mail && html`<${TailorEmailModal} item=${item} scope=${scope} mymail=${mymail} onClose=${() => setMail(false)} onSent=${async () => { try { const res = await api('tl_get', { scope, id: item.id }); setItem(res.item); onChanged && onChanged(res.item); } catch (e) {} }} />`}
    ${sub && staff && html`<${SubModal} s=${null} cands=${cands.docs || []} init=${subInit} onClose=${() => setSub(false)} onSaved=${onSubSaved} />`}
  </div>`;
}

/* v33: how many pages the tailored resume needs: type any number (1-15) or step with - and +; empty = its own length.
   Longer than the resume: StratEdge AI writes it out (summary bullets, Environment lines, more detail per job);
   shorter: the least relevant bullets come off. The last choice is remembered on this device. */
const TL_MAX_PAGES = 15;
const tlPagesWord = n => (n === 1 ? '1 page' : (n || 0) + ' pages');
const tlPagesPref = () => {
  try {
    const v = localStorage.getItem('tl.pages');
    const n = v === null ? 2 : Number(v);
    return n >= 0 && n <= TL_MAX_PAGES ? n : 2;
  } catch (e) {
    return 2;
  }
};
const tlPagesKeep = n => {
  try {
    localStorage.setItem('tl.pages', String(n || 0));
  } catch (e) {}
};
function TlPages({ value, onChange, label, disabled }) {
  const [txt, setTxt] = useState(value ? String(value) : '');
  useEffect(() => setTxt(value ? String(value) : ''), [value]);
  const set = n => {
    const v = Math.max(0, Math.min(TL_MAX_PAGES, n | 0));
    setTxt(v ? String(v) : '');
    onChange(v);
  };
  return html`<div className="tlpages" role="group" aria-label="Number of pages needed">
    <span className="muted small">${label || 'Pages needed'}</span>
    <div className="pgstep">
      <button type="button" aria-label="Fewer pages" title="Fewer pages" disabled=${disabled || !value} onClick=${() => set((value || 1) - 1)}>−</button>
      <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength="2" placeholder="Any" value=${txt} disabled=${disabled} aria-label="Pages needed (1 to ${TL_MAX_PAGES}; empty for any length)" onInput=${e => { const t = e.target.value.replace(/\D/g, '').slice(0, 2); setTxt(t); onChange(t ? Math.max(1, Math.min(TL_MAX_PAGES, Number(t))) : 0); }} onBlur=${() => setTxt(value ? String(value) : '')} />
      <button type="button" aria-label="More pages" title="More pages" disabled=${disabled || value >= TL_MAX_PAGES} onClick=${() => set((value || 0) + 1)}>+</button>
    </div>
    <span className="muted small">${value ? (value === 1 ? 'page' : 'pages') : 'any length'}</span>
  </div>`;
}

/* ---------- the JD box: paste, or pick one the system already has (staff) ---------- */
function TailorJdBox({ f, setF, staff }) {
  const [jds, setJds] = useState(null);
  const [parsed, setParsed] = useState(null);
  useEffect(() => {
    if (!staff) return;
    api('tl_jds').then(r => setJds(r.items), () => setJds([]));
  }, [staff]);
  useEffect(() => {
    if ((f.jd || '').trim().length < 80) {
      setParsed(null);
      return;
    }
    const t = setTimeout(() => api('tl_jd', { jd: f.jd, title: f.title, company: f.company }).then(r => setParsed(r.jd), () => {}), 500);
    return () => clearTimeout(t);
  }, [f.jd, f.title, f.company]);
  const pick = v => {
    const j = (jds || []).find(x => x.kind + ':' + x.id === v);
    if (!j) return;
    setF({ ...f, jd: j.text, title: j.ti, company: j.co, vendor: j.vn || f.vendor, jdKind: j.kind, jdId: j.id });
  };
  return html`<section className="panel form">
    <b>1. The job description</b>
    ${
      staff && jds && jds.length
        ? html`<${Field} label="Pick one you already have (ATS requisitions, requirements desk)">
            <select value=${f.jdKind ? f.jdKind + ':' + f.jdId : ''} onChange=${e => pick(e.target.value)}>
              <option value="">— paste one below —</option>
              ${jds.map(j => html`<option key=${j.kind + j.id} value=${j.kind + ':' + j.id}>${j.ti}${j.co ? ' · ' + j.co : ''}${j.loc ? ' · ' + j.loc : ''} (${j.kind === 'ats' ? 'ATS' : 'desk'})</option>`)}
            </select>
          <//>`
        : ''
    }
    <${Field} label="Job description" hint="Paste the whole thing: title, responsibilities, requirements. The vendor's email works as is."><textarea rows="10" value=${f.jd} onInput=${e => setF({ ...f, jd: e.target.value, jdKind: '', jdId: '' })} placeholder="Senior Java Backend Engineer…" /><//>
    <div className=${staff ? 'row3' : 'row2'}>
      <${Field} label="Job title" hint=${parsed && parsed.title && !f.title ? 'Read from the JD: ' + parsed.title : ''}><input value=${f.title} onInput=${e => setF({ ...f, title: e.target.value })} placeholder=${(parsed && parsed.title) || ''} /><//>
      <${Field} label="Company / end client" hint=${parsed && parsed.company && !f.company ? 'Read from the JD: ' + parsed.company : ''}><input value=${f.company} onInput=${e => setF({ ...f, company: e.target.value })} placeholder=${(parsed && parsed.company) || ''} /><//>
      ${staff && html`<${Field} label="Vendor / who to submit to"><input value=${f.vendor} onInput=${e => setF({ ...f, vendor: e.target.value })} /><//>`}
    </div>
    ${
      parsed &&
      html`<div className="muted small">
        Keywords read from the JD: ${parsed.skills.concat(parsed.terms).slice(0, 18).join(', ') || 'none recognised yet'}${parsed.years ? ' · asks ' + parsed.years + '+ years' : ''}${parsed.reqs.length ? ' · ' + parsed.reqs.length + ' requirement lines' : ''}
      </div>`
    }
  </section>`;
}

/* ---------- member: tailor my own resume ---------- */
function TailorPage({ q }) {
  const P = usePortal();
  const toast = useToast();
  const [st, setSt] = useState(null);
  const [items, setItems] = useState(null);
  const [open, setOpen] = useState(null);
  const [f, setF] = useState({ jd: '', title: '', company: '', vendor: '', srcKind: 'resume', rid: 0, text: '', jdKind: '', jdId: '', pages: tlPagesPref() });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const scope = '';
  const load = () =>
    Promise.all([api('tl_status'), api('tl_items')]).then(([s, l]) => {
      setSt(s);
      setItems(l.items);
      if (s.resumes.length && !f.rid) setF(x => ({ ...x, rid: (s.resumes.find(r => r.active) || s.resumes[0]).id }));
    });
  useEffect(() => {
    load().catch(e => toast(errText(e), true));
  }, []);
  // arrived from a matched job: the JD is prefilled
  useEffect(() => {
    if (!q || !q.job) return;
    api('jobs_job&id=' + encodeURIComponent(q.job))
      .then(r => setF(x => ({ ...x, jd: (r.job.title || '') + '\n' + (r.job.company || '') + '\n' + (r.job.location || '') + '\n\n' + (r.job.description || r.job.summary || ''), title: r.job.title || '', company: r.job.company || '', jdKind: 'job', jdId: String(q.job) })))
      .catch(() => {});
  }, [q && q.job]);
  useEffect(() => {
    if (q && q.id && items && !open) {
      api('tl_get', { id: q.id }).then(r => setOpen(r.item), () => {});
    }
  }, [q && q.id, !!items]);
  const run = async () => {
    if ((f.jd || '').trim().length < 80) {
      toast('Paste the job description first.', true);
      return;
    }
    setBusy(true);
    try {
      let res;
      if (f.srcKind === 'file') {
        if (!file) {
          toast('Choose the resume file.', true);
          setBusy(false);
          return;
        }
        const fd = new FormData();
        fd.append('jd', f.jd);
        fd.append('title', f.title);
        fd.append('company', f.company);
        fd.append('src', JSON.stringify({ kind: 'file' }));
        fd.append('jdKind', f.jdKind);
        fd.append('jdId', f.jdId);
        fd.append('pages', String(f.pages));
        fd.append('file', file);
        res = await api('tl_run', fd, { timeout: TL_RUN_TIMEOUT });
      } else {
        res = await api('tl_run', { jd: f.jd, title: f.title, company: f.company, jdKind: f.jdKind, jdId: f.jdId, pages: f.pages, src: f.srcKind === 'text' ? { kind: 'text', text: f.text } : { kind: 'resume', rid: f.rid } }, { timeout: TL_RUN_TIMEOUT });
      }
      setOpen(res.item);
      setItems([res.item, ...(items || [])]);
      toast('Done: ' + res.item.before.score + ' → ' + res.item.after.score + ' ATS match.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  if (!st || !items) return html`<div className="panel"><${Spinner} /></div>`;
  return html`<div className="stack">
    <${PlanNote} feature="tailor" />
    ${
      open
        ? html`<div className="actions"><button type="button" className="btn ghost sm" onClick=${() => setOpen(null)}><${Icon} n="left" />All tailored resumes</button></div>
          <${TailorResult} item=${open} scope=${scope} staff=${false} mymail=${st.mymail} onChanged=${it => setItems(items.map(x => (x.id === it.id ? { ...x, u: it.u, st: it.st, score: { before: it.before.score, after: it.after.score } } : x)))} onDeleted=${id => { setItems(items.filter(x => x.id !== id)); setOpen(null); }} />`
        : html`<section className="panel">
            <h3 style=${{ margin: '0 0 4px' }}>Tailor my resume to a job</h3>
            <p className="muted small" style=${{ margin: 0 }}>Paste a job description, pick which resume to start from, and get a version written for that job: the job's keywords where you have them, a summary for the role, clean headings that applicant tracking systems read, and a match score before and after. Nothing is invented: your employers, titles, dates, education and certifications stay exactly as they are. Download it as Word or PDF.${st.ai ? '' : ' (The assistant is not set up yet, so the rewrite only reorders and summarises what is already there.)'}</p>
          </section>
          <${TailorJdBox} f=${f} setF=${setF} staff=${false} />
          <section className="panel form">
            <b>2. The resume to start from</b>
            <div className="seg" role="tablist">
              ${[['resume', 'One of my resumes'], ['text', 'Paste text'], ['file', 'Upload a file']].map(([k, n]) => html`<button key=${k} type="button" role="tab" aria-selected=${f.srcKind === k} className=${f.srcKind === k ? 'on' : ''} onClick=${() => setF({ ...f, srcKind: k })}>${n}</button>`)}
            </div>
            ${
              f.srcKind === 'resume' &&
              (st.resumes.length
                ? html`<${Field} label="Resume"><select value=${f.rid} onChange=${e => setF({ ...f, rid: Number(e.target.value) })}>${st.resumes.map(r => html`<option key=${r.id} value=${r.id}>${r.label}${r.active ? ' (active)' : ''}</option>`)}</select><//>`
                : html`<div className="note amber"><span>No resume on file yet. Upload one under <a href=${growHref(P, 'resume')}>Resume & preferences</a>, or paste the text here.</span></div>`)
            }
            ${f.srcKind === 'text' && html`<${Field} label="Resume text"><textarea rows="12" value=${f.text} onInput=${e => setF({ ...f, text: e.target.value })} placeholder="Name, contact line, summary, skills, experience…" /><//>`}
            ${f.srcKind === 'file' && html`<${Field} label="Resume file (PDF, Word or text)"><input type="file" accept=".pdf,.docx,.txt" onChange=${e => setFile(e.target.files[0] || null)} /><//>`}
            <div className="actions"><${TlPages} value=${f.pages} onChange=${v => { setF({ ...f, pages: v }); tlPagesKeep(v); }} /><button type="button" className="btn" disabled=${busy} onClick=${run}>${busy ? (f.pages >= 4 ? 'Tailoring… (a longer resume takes a few minutes)' : 'Tailoring… (this can take a minute)') : 'Tailor my resume'}</button></div>
          </section>
          ${
            items.length
              ? html`<section className="panel">
                  <b>My tailored resumes</b>
                  <div className="tlgrid">
                    ${items.map(it => html`<div key=${it.id} className="tlcard">
                      <div className="tlcardhead"><b>${it.t}</b><span className=${'chip ' + tlScoreClass(it.score.after)}>${it.score.before} → ${it.score.after}</span></div>
                      <div className="muted small">${it.co || ''}${it.co ? ' · ' : ''}${fmtDay(it.u || it.at)}</div>
                      <div className="actions">
                        <button type="button" className="btn sm ghost" onClick=${() => api('tl_get', { id: it.id }).then(r => setOpen(r.item), e => toast(errText(e), true))}>Open</button>
                        ${it.files && it.files.docx && html`<a className="btn sm ghost" href=${fileUrl(it.base, it.files.docx.id, true)}>Word</a>`}
                        ${it.files && it.files.pdf && html`<a className="btn sm ghost" href=${fileUrl(it.base, it.files.pdf.id, true)}>PDF</a>`}
                      </div>
                    </div>`)}
                  </div>
                </section>`
              : ''
          }`
    }
  </div>`;
}

/* ---------- staff: find consultants, tailor, submit ---------- */
function TailorStaffPage({ q }) {
  const P = usePortal();
  const toast = useToast();
  const scope = 'rec';
  const [tab, setTab] = useState((q && q.tab) || 'new');
  const [st, setSt] = useState(null);
  const [items, setItems] = useState(null);
  const [open, setOpen] = useState(null);
  const [f, setF] = useState({ jd: '', title: '', company: '', vendor: '', jdKind: '', jdId: '', srcKind: 'find', who: null, text: '', n: '', e: '', q: '', pages: tlPagesPref() });
  const [file, setFile] = useState(null);
  const [people, setPeople] = useState(null);
  const [finding, setFinding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState(false);
  const load = () =>
    Promise.all([api('tl_status'), api('tl_items', { scope })]).then(([s, l]) => {
      setSt(s);
      setItems(l.items);
    });
  useEffect(() => {
    load().catch(e => toast(errText(e), true));
  }, []);
  useEffect(() => {
    if (q && q.id && items && !open) api('tl_get', { scope, id: q.id }).then(r => { setOpen(r.item); setTab('list'); }, () => {});
  }, [q && q.id, !!items]);
  const find = async () => {
    setFinding(true);
    try {
      const r = await api('tl_find', { jd: f.jd, title: f.title, q: f.q }, { timeout: 90000 });
      setPeople(r.people);
      if (!r.people.length) toast('No one found: add consultants under Consultant database, or upload their resumes.', true);
    } catch (e) {
      toast(errText(e), true);
    }
    setFinding(false);
  };
  const run = async () => {
    if ((f.jd || '').trim().length < 80) {
      toast('Paste or pick the job description first.', true);
      return;
    }
    setBusy(true);
    try {
      let res;
      const common = { jd: f.jd, title: f.title, company: f.company, vendor: f.vendor, jdKind: f.jdKind, jdId: f.jdId, pages: f.pages, scope };
      if (f.srcKind === 'file') {
        if (!file) {
          toast('Choose the resume file.', true);
          setBusy(false);
          return;
        }
        const fd = new FormData();
        Object.entries(common).forEach(([k, v]) => fd.append(k, v));
        fd.append('src', JSON.stringify({ kind: 'file', n: f.n, e: f.e }));
        fd.append('file', file);
        res = await api('tl_run', fd, { timeout: TL_RUN_TIMEOUT });
      } else if (f.srcKind === 'text') {
        res = await api('tl_run', { ...common, src: { kind: 'text', text: f.text, n: f.n, e: f.e } }, { timeout: TL_RUN_TIMEOUT });
      } else {
        if (!f.who) {
          toast('Pick a consultant first (Find consultants, or search by name).', true);
          setBusy(false);
          return;
        }
        res = await api('tl_run', { ...common, src: { kind: f.who.kind, id: f.who.id } }, { timeout: TL_RUN_TIMEOUT });
      }
      setOpen(res.item);
      setItems([res.item, ...(items || [])]);
      setTab('list');
      toast('Done: ' + res.item.before.score + ' → ' + res.item.after.score + ' ATS match.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  if (!st || !items) return html`<div className="panel"><${Spinner} /></div>`;
  const list = items.filter(it => !mine || it.by === P.uid);
  return html`<div className="stack">
    <div className="tabs" role="tablist">
      ${[['new', 'New: JD → consultant → resume'], ['list', 'Tailored resumes', items.length]].map(([k, n, c]) => html`<button key=${k} role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => { setTab(k); if (k === 'new') setOpen(null); }}>${n}${c != null ? html` <span className="chip">${c}</span>` : ''}</button>`)}
    </div>
    ${
      tab === 'new' &&
      html`<section className="panel">
          <p className="muted small" style=${{ margin: 0 }}>Paste the vendor's JD, let the system rank the consultants you have (portal resumes, the consultant database, ATS candidates), tailor the best fit's resume to the JD, then log the submission and email the vendor with the files attached - all from one page.${st.ai ? '' : html` <b>No assistant is set up</b> (Admin › Website & messages › Assistant (AI)): until then the rewrite only reorders and summarises what the resume already says.`}</p>
        </section>
        <${TailorJdBox} f=${f} setF=${setF} staff=${true} />
        <section className="panel form">
          <b>2. The consultant</b>
          <div className="seg" role="tablist">
            ${[['find', 'Find consultants for this JD'], ['text', 'Paste a resume'], ['file', 'Upload a resume']].map(([k, n]) => html`<button key=${k} type="button" role="tab" aria-selected=${f.srcKind === k} className=${f.srcKind === k ? 'on' : ''} onClick=${() => setF({ ...f, srcKind: k })}>${n}</button>`)}
          </div>
          ${
            f.srcKind === 'find' &&
            html`<div className="toolbar">
                <input type="search" style=${{ maxWidth: 280 }} placeholder="Search by name or title (optional)" value=${f.q} onInput=${e => setF({ ...f, q: e.target.value })} aria-label="Search consultants" />
                <button type="button" className="btn sm" disabled=${finding} onClick=${find}>${finding ? (st.ai ? 'Ranking and reading resumes…' : 'Ranking…') : (f.jd || '').trim().length >= 40 ? 'Find consultants for this JD' : 'List consultants'}</button>
                ${f.who && html`<span className="chip ok">Chosen: ${f.who.n}</span>`}
              </div>
              ${
                people &&
                (people.length
                  ? html`<div className="tblwrap">
                      <table className="tbl">
                        <thead><tr><th>Match</th><th>Consultant</th><th>Title</th><th>Location</th><th>Visa</th><th>Source</th><th></th></tr></thead>
                        <tbody>
                          ${people.map(p => html`<tr key=${p.kind + p.id} className=${f.who && f.who.kind === p.kind && f.who.id === p.id ? 'on' : ''}>
                            <td><span className=${'chip ' + tlScoreClass(p.score)}>${p.score}</span>${p.ai ? html`<div className="small"><span className=${'chip ' + (p.ai.level === 'strong' ? 'ok' : p.ai.level === 'good' ? 'amber' : '')}>${p.ai.level} fit</span></div>` : ''}${p.why && p.why.length ? html`<div className="muted small">${p.why.slice(0, 3).join(' · ')}</div>` : ''}${p.ai && p.ai.note ? html`<div className="small tlainote">${p.ai.note}</div>` : ''}</td>
                            <td><b>${p.n}</b>${p.email ? html`<div className="muted small">${p.email}</div>` : ''}</td>
                            <td>${p.ti}${p.years ? html`<div className="muted small">${p.years} yrs</div>` : ''}</td>
                            <td>${p.loc}</td>
                            <td>${p.auth}</td>
                            <td className="muted small">${p.src}${p.resume ? '' : html`<br /><span className="chip amber">no resume file</span>`}</td>
                            <td><button type="button" className="btn sm" disabled=${!p.resume} onClick=${() => setF({ ...f, who: p })}>Use</button></td>
                          </tr>`)}
                        </tbody>
                      </table>
                    </div>`
                  : html`<${Empty} title="No consultants to rank">Add people under Consultant database (with their resume) or let consultants upload a resume in their portal.<//>`)
              }`
          }
          ${
            (f.srcKind === 'text' || f.srcKind === 'file') &&
            html`<div className="row2">
                <${Field} label="Consultant's name"><input value=${f.n} onInput=${e => setF({ ...f, n: e.target.value })} /><//>
                <${Field} label="Email (for the submission log)"><input value=${f.e} onInput=${e => setF({ ...f, e: e.target.value })} /><//>
              </div>`
          }
          ${f.srcKind === 'text' && html`<${Field} label="Resume text"><textarea rows="12" value=${f.text} onInput=${e => setF({ ...f, text: e.target.value })} /><//>`}
          ${f.srcKind === 'file' && html`<${Field} label="Resume file (PDF, Word or text)"><input type="file" accept=".pdf,.docx,.txt" onChange=${e => setFile(e.target.files[0] || null)} /><//>`}
          <div className="actions"><${TlPages} value=${f.pages} onChange=${v => { setF({ ...f, pages: v }); tlPagesKeep(v); }} /><button type="button" className="btn" disabled=${busy} onClick=${run}>${busy ? (f.pages >= 4 ? 'Tailoring… (a longer resume takes a few minutes)' : 'Tailoring… (this can take a minute)') : '3. Tailor the resume'}</button></div>
        </section>`
    }
    ${
      tab === 'list' &&
      (open
        ? html`<div className="actions"><button type="button" className="btn ghost sm" onClick=${() => setOpen(null)}><${Icon} n="left" />All tailored resumes</button></div>
          <${TailorResult} item=${open} scope=${scope} staff=${true} mymail=${st.mymail} onChanged=${it => setItems(items.map(x => (x.id === it.id ? { ...x, u: it.u, st: it.st, sub: it.sub, score: { before: it.before.score, after: it.after.score } } : x)))} onDeleted=${id => { setItems(items.filter(x => x.id !== id)); setOpen(null); }} />`
        : html`<section className="panel" style=${{ padding: '6px 8px' }}>
            <div className="toolbar"><label className="check" style=${{ fontSize: 14 }}><input type="checkbox" checked=${mine} onChange=${e => setMine(e.target.checked)} /><span>Only mine</span></label></div>
            ${
              list.length
                ? html`<div className="tblwrap">
                    <table className="tbl">
                      <thead><tr><th>When</th><th>Consultant</th><th>Role</th><th>Company / vendor</th><th>ATS</th><th>Status</th><th>By</th><th></th></tr></thead>
                      <tbody>
                        ${list.map(it => html`<tr key=${it.id}>
                          <td className="muted small">${fmtTs(it.u || it.at)}</td>
                          <td><b>${(it.who && it.who.n) || ''}</b></td>
                          <td>${it.t}</td>
                          <td>${[it.co, it.vn].filter(Boolean).join(' / ')}</td>
                          <td><span className=${'chip ' + tlScoreClass(it.score.after)}>${it.score.before} → ${it.score.after}</span></td>
                          <td className="muted small">${it.st === 'sent' ? 'Emailed' : it.st === 'submitted' ? 'Submission logged' : it.st === 'edited' ? 'Edited' : 'Draft'}</td>
                          <td className="muted small">${it.byn}</td>
                          <td><div className="actions"><button type="button" className="btn sm ghost" onClick=${() => api('tl_get', { scope, id: it.id }).then(r => setOpen(r.item), e => toast(errText(e), true))}>Open</button>${it.files && it.files.docx && html`<a className="btn sm ghost" href=${fileUrl(it.base, it.files.docx.id, true)}>Word</a>`}${it.files && it.files.pdf && html`<a className="btn sm ghost" href=${fileUrl(it.base, it.files.pdf.id, true)}>PDF</a>`}</div></td>
                        </tr>`)}
                      </tbody>
                    </table>
                  </div>`
                : html`<${Empty} title="Nothing tailored yet">Start from the first tab: paste a JD, pick the consultant, tailor.<//>`
            }
          </section>`)
    }
  </div>`;
}
