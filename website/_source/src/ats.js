/* ================= ATS (v29): requisitions, pipelines, structured interviews, scorecards, offers, hires =================
   Modelled on Greenhouse (structured scorecards, interview kits, approvals), Workable (fast set-up, AI screening,
   careers questions), Ceipal / Oorwin (placements, submissions, bulk actions). Candidates live in ats/{id}; the public
   posting in org/site/jobs/{id}; the internal requisition in ats/x/jobs/{id} (api/ats.php). */
const ATS_KINDS = ['new', 'screen', 'interview', 'offer', 'hired', 'rejected'];
const ATS_KIND_NAME = { new: 'New', screen: 'Screening', interview: 'Interview', offer: 'Offer', hired: 'Hired', rejected: 'Rejected' };
const ATS_DEFAULT_STAGES = ATS_KINDS.map(k => ({ k, n: ATS_KIND_NAME[k], kind: k }));
const REC_LABEL = { strong_yes: 'Strong yes', yes: 'Yes', no: 'No', strong_no: 'Strong no' };
const REC_TONE = { strong_yes: 'ok', yes: 'ok', no: 'warn', strong_no: 'red' };
const atsChip = kind => (kind === 'hired' ? 'ok' : kind === 'rejected' ? 'red' : kind === 'offer' || kind === 'interview' ? 'new' : kind === 'screen' ? 'amber' : '');
const stagesOf = job => (job && Array.isArray(job.stages) && job.stages.length ? job.stages : ATS_DEFAULT_STAGES);
const stageOf = (job, st) => stagesOf(job).find(s => s.k === st) || { k: st, n: ATS_KIND_NAME[st] || st || 'New', kind: ATS_KINDS.includes(st) ? st : 'new' };
const kindOf = (job, st) => stageOf(job, st).kind;
const stageKeyOfKind = (job, kind) => (stagesOf(job).find(s => s.kind === kind) || {}).k || kind;
const daysSince = t => (t ? Math.floor((Date.now() - t) / 86400000) : 0);
const activeKind = k => !['hired', 'rejected'].includes(k);
/* Boolean search: AND / OR / NOT, quotes for phrases, parentheses. Returns a test over one lowercase haystack. */
function boolSearch(q) {
  const src = String(q || '').trim();
  if (!src) return () => true;
  const toks = src.match(/\(|\)|"[^"]*"|[^\s()"]+/g) || [];
  let i = 0;
  const peek = () => toks[i];
  const next = () => toks[i++];
  const term = () => {
    const t = next();
    if (t === undefined) return () => true;
    if (t === '(') {
      const e = expr();
      if (peek() === ')') next();
      return e;
    }
    if (/^(not|-)$/i.test(t)) {
      const e = term();
      return h => !e(h);
    }
    if (t.startsWith('-') && t.length > 1) {
      const w = t.slice(1).toLowerCase();
      return h => !h.includes(w);
    }
    const w = t.replace(/^"|"$/g, '').toLowerCase();
    return h => h.includes(w);
  };
  const andExpr = () => {
    let left = term();
    while (peek() !== undefined && peek() !== ')' && !/^or$/i.test(peek())) {
      if (/^and$/i.test(peek())) next();
      if (peek() === undefined || peek() === ')') break;
      const right = term();
      const l = left;
      left = h => l(h) && right(h);
    }
    return left;
  };
  const expr = () => {
    let left = andExpr();
    while (peek() !== undefined && /^or$/i.test(peek())) {
      next();
      const right = andExpr();
      const l = left;
      left = h => l(h) || right(h);
    }
    return left;
  };
  try {
    return expr();
  } catch (e) {
    const w = src.toLowerCase();
    return h => h.includes(w);
  }
}
const candText = c => [c.n, c.e, c.ph, c.ti, c.jt, c.sk, c.loc, c.auth, c.src, (c.tags || []).join(' '), c.msg, c.li, (c.notes || []).map(n => n.x).join(' ')].join(' ').toLowerCase();
function Stars({ v, onChange }) {
  return html`<span className="stars" role=${onChange ? 'radiogroup' : undefined}>
      ${[1, 2, 3, 4, 5].map(n => html`<button key=${n} type="button" className=${n <= (v || 0) ? 'on' : ''} aria-label=${n + ' star' + (n > 1 ? 's' : '')} disabled=${!onChange} onClick=${() => onChange && onChange(n === v ? 0 : n)}>★</button>`)}
    </span>`;
}
const ScoreChip = ({ s }) => (s && s.v != null ? html`<span className=${'chip ' + (s.v >= 70 ? 'ok' : s.v >= 45 ? 'amber' : '')} title=${(s.why || []).join(' · ')}>fit ${s.v}</span>` : null);
function useAtsSettings() {
  const [S, setS] = useState(null);
  const load = () => api('ats_settings', {}).then(r => setS(r.settings)).catch(() => setS({}));
  useEffect(() => {
    load();
  }, []);
  return [S, load];
}
function useAtsJobs() {
  const [rows, setRows] = useState(null);
  const [tick, setTick] = useState(0);
  const jobsCol = useCol('org/site/jobs', 'at:desc');
  useEffect(() => {
    api('ats_jobs', {}).then(r => setRows(r.rows)).catch(() => setRows([]));
  }, [tick, jobsCol.docs.length]);
  const map = useMemo(() => Object.fromEntries((rows || []).map(r => [r.id, r])), [rows]);
  return [rows, map, () => setTick(t => t + 1)];
}
const teamOf = (A, job) => {
  const t = (job && job.team) || {};
  return [...new Set([t.rec, t.coord, t.hm, ...(t.intv || [])].filter(Boolean))];
};
const staffOf = A => (A ? A.members.filter(m => m.role !== 'employer' && m.st === 'active') : []);
const nameIn = (A, uid) => {
  const m = A && A.members.find(x => x.id === uid);
  return m ? m.u.p.n : uid ? 'Team member' : '';
};
const referrerName = (A, code) => {
  if (!code) return '';
  const m = A && A.members.find(x => x.id.slice(2, 8) === code || x.id === code);
  return m ? m.u.p.n : code;
};

/* ---------------- Candidate ---------------- */
function CandidateModal({ c, jobsMap, S, onClose, onChanged, onMail }) {
  const P = usePortal();
  const A = P.admin;
  const toast = useToast();
  const [tab, setTab] = useState(() => (/[?&]cal=[a-z]+/.test(location.hash || '') ? 'interviews' : 'profile')); // v41: back from connecting a calendar
  const [f, setF] = useState({ ...c });
  const [note, setNote] = useState('');
  const [mail, setMail] = useState(null);
  const [busy, setBusy] = useState('');
  const [prog, setProg] = useState(0);
  const [dupes, setDupes] = useState(null);
  const [reject, setReject] = useState(null);
  const [hire, setHire] = useState(false);
  const row = jobsMap[c.job] || null;
  const job = row ? row.job : null;
  const pub = row ? row.pub : null;
  const stages = stagesOf(job);
  const stage = stageOf(job, c.st);
  const me = (P.prof && P.prof.n) || (Cap.me && Cap.me.name) || '';
  const up = k => e => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  useEffect(() => {
    api('ats_dupes', { e: c.e, ph: c.ph, id: c.id }).then(r => setDupes(r.rows)).catch(() => setDupes([]));
  }, [c.id]);
  const files = useCol(`ats/${c.id}/f`, 'at:desc');
  const merge = async (patch, msg) => {
    setBusy('save');
    try {
      await dbMerge(`ats/${c.id}`, { ...patch, u: Date.now() });
      if (msg) toast(msg);
      onChanged && onChanged();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const save = () =>
    merge(
      {
        n: f.n.trim(),
        e: (f.e || '').trim().toLowerCase(),
        ph: f.ph || '',
        ti: f.ti || '',
        loc: f.loc || '',
        auth: f.auth || '',
        exp: f.exp === '' || f.exp == null ? null : +f.exp,
        sk: f.sk || '',
        li: f.li || '',
        src: f.src || '',
        tags: Array.isArray(f.tags) ? f.tags : String(f.tags || '').split(',').map(x => x.trim()).filter(Boolean),
        pool: !!f.pool,
        rating: +f.rating || 0,
        ...(f.job !== c.job ? { job: f.job || '', jt: f.job && jobsMap[f.job] ? jobsMap[f.job].pub.ti : f.jt || '' } : {}),
        log: f.job !== c.job ? [...(c.log || []), { t: Date.now(), who: me, ev: f.job && jobsMap[f.job] ? 'Added to ' + jobsMap[f.job].pub.ti : 'Removed from the job' }] : c.log,
      },
      'Saved.'
    );
  const move = async (st, reason, noteTxt) => {
    const target = stageOf(job, st);
    if (target.kind === 'rejected' && reason === undefined) {
      setReject({ st, why: (S.reject || [])[0] || '', note: '' });
      return;
    }
    if (target.kind === 'hired') {
      setHire(true);
      return;
    }
    setBusy('move');
    try {
      const r = await api('ats_move', { id: c.id, st, reason: reason || '', note: noteTxt || '' });
      toast(`Moved to ${target.n}${r.emailed ? ' and emailed' : ''}${r.tasks ? `, ${r.tasks} task${r.tasks === 1 ? '' : 's'} created` : ''}.`);
      setReject(null);
      onChanged && onChanged();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const addNote = async () => {
    if (!note.trim()) return;
    await merge({ notes: [...(c.notes || []), { t: Date.now(), who: me, x: note.trim() }] });
    setNote('');
  };
  const onFiles = async fs => {
    setBusy('file');
    try {
      setProg(0.03);
      const r = await storeFile(`ats/${c.id}`, fs[0], { c: 'resume' }, setProg);
      await dbMerge(`ats/${c.id}`, { rid: r.id, rn: r.n, u: Date.now() });
      toast('Resume attached.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const onDoc = async fs => {
    setBusy('file');
    try {
      for (const fl of fs) {
        setProg(0.03);
        await storeFile(`ats/${c.id}`, fl, { c: 'doc' }, setProg);
      }
      toast('Document added.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const score = async withSummary => {
    setBusy('score');
    try {
      const r = await api('ats_match', { id: c.id, summary: !!withSummary });
      toast(`Fit score ${r.score.v}/100.`);
      onChanged && onChanged();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const openMail = k => {
    const t = ATS_TEMPLATES[k] || ATS_TEMPLATES.screen;
    const fill = s => s.replace(/\{name\}/g, (c.n || '').split(' ')[0]).replace(/\{job\}/g, c.jt || 'the open').replace(/\{date\}/g, c.intv ? c.intv.replace('T', ' at ') : '[date and time]').replace(/\{me\}/g, me);
    setMail({ k, s: fill(t.s), b: fill(t.b) });
  };
  const sendMailNow = async () => {
    setBusy('mail');
    try {
      const r = await api('ats_email', { id: c.id, subject: mail.s, body: mail.b });
      toast(r.mailed ? 'Email sent.' : 'Could not send; check the mail settings.', !r.mailed);
      setMail(null);
      onChanged && onChanged();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const tabs = [['profile', 'Profile'], ['agent', c.ag && c.ag.st ? 'Screening · ' + (AG_ST[c.ag.st] || c.ag.st).replace(': you decide', '').replace('Waiting for the candidate', 'waiting') : 'Screening'], ['activity', 'Activity'], ['interviews', `Interviews${(c.intvs || []).filter(i => !i.cancelled).length ? ' · ' + (c.intvs || []).filter(i => !i.cancelled).length : ''}`], ['cards', `Scorecards${(c.cards || []).length ? ' · ' + c.cards.length : ''}`], ['offer', c.offer && c.offer.st ? `Offer · ${c.offer.st}` : 'Offer'], ['docs', 'Documents']];
  const sla = S.sla && S.sla[stage.kind];
  const inStage = daysSince(c.stAt || c.at);
  return html`<${Modal} wide title=${c.n} onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Close</button>${tab === 'profile' && html`<button className="btn" disabled=${!!busy} onClick=${save}>${busy === 'save' ? 'Saving…' : 'Save'}</button>`}`}>
      <div className="stack">
        <div className="actions" style=${{ alignItems: 'center' }}>
          <select value=${c.st} disabled=${!!busy} onChange=${e => move(e.target.value)} aria-label="Stage" style=${{ maxWidth: 220 }}>
            ${stages.map(s => html`<option key=${s.k} value=${s.k}>${s.n}</option>`)}
          </select>
          <${Chip} s=${atsChip(stage.kind)}>${stage.n}<//>
          ${activeKind(stage.kind) && html`<span className=${'small ' + (sla && inStage > sla ? 'late' : 'muted')}>${inStage} day${inStage === 1 ? '' : 's'} in stage${sla && inStage > sla ? ` (goal ${sla})` : ''}</span>`}
          <${Stars} v=${+f.rating} onChange=${v => { setF({ ...f, rating: v }); merge({ rating: v }); }} />
          <${ScoreChip} s=${c.score} />
          ${c.ag && c.ag.st && html`<${AgentChips} ag=${c.ag} compact />`}
          ${c.ko && html`<${Chip} s="red">knocked out<//>`}
          <${DomChips} dom=${c.dom} small />
          <div className="push" style=${{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button className="btn ghost sm" disabled=${!!busy} onClick=${() => score(false)} title="Title, skills, location and years against the job"><${Icon} n="target" />${busy === 'score' ? 'Scoring…' : 'Fit score'}</button>
            <button className="btn ghost sm" disabled=${!!busy} onClick=${() => score(true)} title="A short written summary (uses the assistant model when one is configured)"><${Icon} n="spark" />AI summary</button>
            ${c.ph && phMine() && html`<button className="btn ghost sm" onClick=${() => phCall(c.ph, { ref: 'ats:' + c.id, name: c.n })} title=${'Call ' + c.ph}><${Icon} n="phone" />Call</button>`}
            <button className="btn ghost sm" onClick=${() => openMail('screen')}><${Icon} n="send" />Email</button>
            ${onMail && html`<button className="btn ghost sm" onClick=${() => onMail({ mode: 'push', cands: [c], job: c.job || '' })} title="Send this profile (with the resume) to a client, vendor or hiring manager"><${Icon} n="mail" />Send profile</button>`}
            ${stage.kind !== 'hired' && html`<button className="btn sm" disabled=${!!busy} onClick=${() => setHire(true)}><${Icon} n="check" />Hire</button>`}
          </div>
        </div>
        ${(c.sent || []).length > 0 && html`<p className="muted small atssentline"><${Icon} n="mail" /> Profile sent ${c.sent.length === 1 ? 'once' : c.sent.length + ' times'}: last to ${c.sent[c.sent.length - 1].to} on ${fmtDay(c.sent[c.sent.length - 1].t)} by ${c.sent[c.sent.length - 1].by}${c.sent[c.sent.length - 1].job ? ' (' + c.sent[c.sent.length - 1].job + ')' : ''}.</p>`}
        ${dupes && dupes.length > 0 && html`<div className="note amber"><span><b>Same person elsewhere:</b> ${dupes.map(d => `${d.n} · ${d.jt || 'no job'} · ${ATS_KIND_NAME[d.st] || d.st}`).join('; ')}. A person applying to two jobs is two records; merge by keeping one and rejecting the other with "Duplicate".</span></div>`}
        ${c.ai && c.ai.text && html`<div className="note info"><span><b>Summary.</b> ${c.ai.text} <span className="muted small">(${fmtTs(c.ai.at)})</span></span></div>`}
        <${KitTabs} tabs=${tabs} tab=${tab} onTab=${setTab} wrap />
        ${
          tab === 'profile' &&
          html`<div className="form">
              <div className="row3">
                <${Field} label="Name"><input value=${f.n} onInput=${up('n')} /><//>
                <${Field} label="Email"><input type="email" value=${f.e} onInput=${up('e')} /><//>
                <${Field} label="Phone"><input value=${f.ph || ''} onInput=${up('ph')} /><//>
              </div>
              <div className="row3">
                <${Field} label="Job"><select value=${f.job || ''} onChange=${up('job')}><option value="">Talent pool (no job)</option>${Object.values(jobsMap).map(r => html`<option key=${r.id} value=${r.id}>${r.pub.ti}${r.pub.open === false ? ' (closed)' : ''}</option>`)}</select><//>
                <${Field} label="Current title"><input value=${f.ti || ''} onInput=${up('ti')} placeholder="e.g. Senior Java Developer" /><//>
                <${Field} label="Source"><select value=${f.src || ''} onChange=${up('src')}><option value="">—</option>${[...new Set([...(S.sources || []), f.src].filter(Boolean))].map(s => html`<option key=${s}>${s}</option>`)}</select><//>
              </div>
              <div className="row3">
                <${Field} label="Location"><input value=${f.loc || ''} onInput=${up('loc')} placeholder="City, ST" /><//>
                <${Field} label="Work authorization"><select value=${f.auth || ''} onChange=${up('auth')}><option value="">—</option>${['US citizen', 'Green card', 'H-1B', 'H4 EAD', 'OPT', 'CPT', 'L2 EAD', 'TN', 'EAD', 'Other'].map(a => html`<option key=${a}>${a}</option>`)}</select><//>
                <${Field} label="Years of experience"><input type="number" step="0.5" min="0" value=${f.exp == null ? '' : f.exp} onInput=${up('exp')} /><//>
              </div>
              <div className="row2">
                <${Field} label="Skills" hint="Comma separated; the fit score reads these and the resume."><input value=${f.sk || ''} onInput=${up('sk')} placeholder="Java, Spring Boot, AWS, Kafka" /><//>
                <${Field} label="LinkedIn"><input value=${f.li || ''} onInput=${up('li')} /><//>
              </div>
              <div className="row2">
                <${Field} label="Tags">
                  <div className="portalpicks wide">${[...new Set([...(S.tags || []), ...(f.tags || [])])].map(t => html`<label key=${t} className=${'pick' + ((f.tags || []).includes(t) ? ' on' : '')}><input type="checkbox" checked=${(f.tags || []).includes(t)} onChange=${e => setF({ ...f, tags: e.target.checked ? [...(f.tags || []), t] : (f.tags || []).filter(x => x !== t) })} /><span>${t}</span></label>`)}</div>
                <//>
                <div className="stack" style=${{ gap: 8 }}>
                  <label className="check"><input type="checkbox" checked=${!!f.pool} onChange=${up('pool')} /><span>Keep in the talent pool for future roles</span></label>
                  ${c.refCode && html`<span className="small">Referred by <b>${referrerName(A, c.refCode)}</b> (code ${c.refCode})</span>`}
                  ${c.src === 'Website' && html`<span className="muted small">Applied through the Careers page.</span>`}
                </div>
              </div>
              ${c.msg && html`<div className="note info"><span style=${{ whiteSpace: 'pre-wrap' }}><b>Cover note.</b> ${c.msg}</span></div>`}
              ${
                c.answers && Object.keys(c.answers).length > 0 &&
                html`<div>
                    <span className="lbl">Screening answers</span>
                    <table className="tbl small" style=${{ marginTop: 6 }}><tbody>${Object.entries(c.answers).map(([qid, v]) => { const q = ((pub && pub.qs) || []).find(x => x.id === qid); const koVal = job && job.ko && job.ko[qid]; return html`<tr key=${qid}><td>${q ? q.q : qid}</td><td><b>${String(v)}</b>${koVal != null && koVal !== '' ? html`<span className="muted small"> · wanted ${q && q.type === 'number' ? '≥ ' : ''}${koVal}</span>` : null}</td></tr>`; })}</tbody></table>
                  </div>`
              }
              <div>
                <span className="lbl">Resume</span>
                ${c.rid ? html`<ul className="files" style=${{ marginTop: 8 }}><li><${Icon} n="file" /><div className="fn"><b>${c.rn || 'Resume'}</b></div><${FileActions} base=${'ats/' + c.id} f=${{ id: c.rid, n: c.rn || 'resume', ty: '' }} /></li></ul>` : html`<p className="muted small">No resume attached.</p>`}
                <div style=${{ marginTop: 8 }}><${FilePick} busy=${busy === 'file'} progress=${prog} onFiles=${onFiles} label=${c.rid ? 'Replace the resume.' : 'Attach a resume.'} /></div>
              </div>
            </div>`
        }
        ${
          tab === 'activity' &&
          html`<div className="stack">
              <${PhoneHistory} phones=${[c.ph]} refId=${'ats:' + c.id} name=${c.n} />
              <div className="actions">
                <input value=${note} onInput=${e => setNote(e.target.value)} placeholder="Add a note (screening feedback, rate, availability)" style=${{ flex: 1 }} onKeyDown=${e => { if (e.key === 'Enter') addNote(); }} />
                <button className="btn ghost" disabled=${busy === 'save'} onClick=${addNote}>Add note</button>
              </div>
              ${(c.notes || []).length > 0 && html`<ul className="list">${c.notes.slice().reverse().map((n, i) => html`<li key=${i}><div><div className="t" style=${{ fontWeight: 500 }}>${n.x}</div><div className="m">${n.who}</div></div><span className="muted small num">${fmtTs(n.t)}</span></li>`)}</ul>`}
              <h3 className="ph" style=${{ marginBottom: 0 }}>History</h3>
              <ul className="list">${(c.log || []).slice().reverse().map((l, i) => html`<li key=${i}><div><div className="t">${l.ev}</div><div className="m">${l.who}</div></div><span className="muted small num">${fmtTs(l.t)}</span></li>`)}</ul>
            </div>`
        }
        ${tab === 'agent' && html`<${AgentPanel} id=${c.id} onChanged=${onChanged} />`}
        ${tab === 'interviews' && html`<${InterviewsPanel} c=${c} job=${job} S=${S} onChanged=${onChanged} />`}
        ${tab === 'cards' && html`<${ScorecardsPanel} c=${c} job=${job} S=${S} onChanged=${onChanged} />`}
        ${tab === 'offer' && html`<${OfferPanel} c=${c} job=${job} pub=${pub} S=${S} onChanged=${onChanged} onHire=${() => setHire(true)} />`}
        ${
          tab === 'docs' &&
          html`<div className="stack">
              ${files.docs.length ? html`<ul className="files">${files.docs.map(fl => html`<li key=${fl.id}><${Icon} n="file" /><div className="fn"><b>${fl.n}</b><span className="muted small"> · ${fl.c === 'resume' ? 'resume' : fl.c === 'offer' ? 'offer letter' : 'document'} · ${fmtDay(fl.at)}</span></div><${FileActions} base=${'ats/' + c.id} f=${fl} who=${{ kind: 'ats', id: c.id, n: c.n }} /></li>`)}</ul>` : html`<p className="muted small">No documents yet: resumes, portfolios, signed offer letters and ID copies live here.</p>`}
              <${FilePick} busy=${busy === 'file'} progress=${prog} onFiles=${onDoc} label="Add a document." />
            </div>`
        }
      </div>
      ${
        reject &&
        html`<${Modal} title=${'Reject ' + c.n} onClose=${() => setReject(null)} foot=${html`<button className="btn ghost" onClick=${() => setReject(null)}>Cancel</button><button className="btn" disabled=${!!busy} onClick=${() => move(reject.st, reject.why, reject.note)}>Reject${(S.auto || []).some(a => a.kind === 'rejected' && a.email) && c.e ? ' and email' : ''}</button>`}>
            <div className="form">
              <${Field} label="Reason"><select value=${reject.why} onChange=${e => setReject({ ...reject, why: e.target.value })}>${(S.reject || ['Other']).map(r => html`<option key=${r}>${r}</option>`)}</select><//>
              <${Field} label="Internal note (optional)"><input value=${reject.note} onInput=${e => setReject({ ...reject, note: e.target.value })} /><//>
              ${(S.auto || []).some(a => a.kind === 'rejected' && a.email) && c.e && html`<p className="muted small">The "not selected" email goes out automatically (Settings › Automations).</p>`}
            </div>
          <//>`
      }
      ${hire && html`<${HireModal} c=${c} job=${job} pub=${pub} onClose=${() => setHire(false)} onDone=${() => { setHire(false); onChanged && onChanged(); }} />`}
      ${
        mail &&
        html`<${Modal} title=${'Email ' + c.n} onClose=${() => setMail(null)} foot=${html`<button className="btn ghost" onClick=${() => setMail(null)}>Cancel</button><button className="btn" disabled=${busy === 'mail'} onClick=${sendMailNow}><${Icon} n="send" />${busy === 'mail' ? 'Sending…' : 'Send'}</button>`}>
            <div className="form">
              <div className="seg">${Object.keys(ATS_TEMPLATES).map(k => html`<button key=${k} className=${mail.k === k ? 'on' : ''} onClick=${() => openMail(k)}>${k === 'screen' ? 'Screening call' : k === 'interview' ? 'Interview' : k === 'offer' ? 'Offer' : 'Not selected'}</button>`)}</div>
              <${Field} label="To"><input value=${c.e} disabled /><//>
              <${Field} label="Subject"><input value=${mail.s} onInput=${e => setMail({ ...mail, s: e.target.value })} /><//>
              <${Field} label="Message"><div className="aibar"><${AiWrite} kind="email" value=${mail.b} subject=${mail.s} ctx=${{ candidate: c.n, job: (pub && pub.ti) || c.jt || '', purpose: mail.k || '' }} onUse=${(t, s) => setMail({ ...mail, b: t, s: s && !String(mail.s || '').trim() ? s : mail.s })} /></div><textarea value=${mail.b} onInput=${e => setMail({ ...mail, b: e.target.value })} style=${{ minHeight: 220 }} /><//>
            </div>
          <//>`
      }
    <//>`;
}
/* Interviews: schedule, update, cancel; invitations with a calendar file go to the candidate and the panel. */
/* v41: interviews in the organiser's Google Calendar or Outlook (the invitations, a Meet or Teams link, each guest's
   answer), and the panel's busy times while scheduling (only the times: what the meetings are is never read). */
const CAL_N = { google: 'Google Calendar', microsoft: 'Outlook' };
const CAL_MEET = { google: 'Google Meet', microsoft: 'Teams' };
const CAL_BACK = {
  connected: ['Calendar connected.', false],
  denied: ['Connecting the calendar was cancelled.', true],
  norefresh: ['The calendar gave access for an hour only. Remove the portal from the apps with access to your Google or Microsoft account, then connect again.', true],
  expired: ['That took too long or started in another tab. Connect the calendar again.', true],
  refused: ['The provider refused the connection. An administrator can check the app under Roles & access › Sign-in providers.', true],
  token: ['The calendar could not be connected: the provider did not hand over access. Try again.', true],
  profile: ['The calendar could not be connected: the account did not give its email address. Try again.', true],
};
const CAL_RSVP = { yes: ['accepted', 'ok'], no: ['declined', 'red'], maybe: ['maybe', 'amber'], none: ['no answer yet', ''] };
function calConnectUrl(p) {
  const next = (location.hash || '#/portal').slice(1).replace(/[?&]cal=[a-z]+/, '');
  return API + 'sso_start&p=' + p + '&connect=cal&next=' + encodeURIComponent(next);
}
const calInOne = iv => !!(iv && iv.cal && typeof iv.cal === 'object' && iv.cal.eid && iv.cal.st !== 'cancelled');
/* Back from connecting a calendar (?cal=<how it went> on the address): said once, then taken off the address. */
function useCalReturn(onDone) {
  const toast = useToast();
  useEffect(() => {
    const m = /[?&]cal=([a-z]+)/.exec(location.hash || '');
    if (!m) return;
    const [msg, bad] = CAL_BACK[m[1]] || ['The calendar could not be connected. Try again.', true];
    toast(msg, bad);
    try {
      history.replaceState(null, '', location.pathname + location.search + location.hash.replace(/([?&])cal=[a-z]+&?/, '$1').replace(/[?&]$/, ''));
    } catch (e) {
      /* the address keeps it */
    }
    onDone && onDone();
  }, []);
}
function useCalStatus() {
  const [st, setSt] = useState(null);
  const load = () =>
    api('cal_status')
      .then(setSt)
      .catch(() => setSt({ acct: null, google: false, microsoft: false, failed: true }));
  useEffect(() => {
    load();
  }, []);
  return [st, load];
}
/* Each guest's answer in the calendar. */
function CalRsvp({ cal, c, A }) {
  const list = Object.entries((cal && cal.rsvp) || {});
  if (!list.length) return null;
  const who = em => {
    if (c.e && em === String(c.e).toLowerCase()) return String(c.n || 'Candidate').split(' ')[0];
    if (cal.gn && cal.gn[em]) return String(cal.gn[em]).split(' ')[0];
    const m = staffOf(A).find(x => String((x.u && x.u.p && x.u.p.e) || '').toLowerCase() === em);
    return m ? String(m.u.p.n || em).split(' ')[0] : em;
  };
  return html`<div className="calrsvp">${list.map(([em, a]) => html`<${Chip} key=${em} s=${(CAL_RSVP[a] || CAL_RSVP.none)[1]}>${who(em)}: ${(CAL_RSVP[a] || CAL_RSVP.none)[0]}<//>`)}</div>`;
}
/* The panel's day while scheduling: busy times from their calendars and the interviews already in the portal. */
function CalAvail({ c, edit, prev }) {
  const P = usePortal();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const day = String(edit.at || '').slice(0, 10);
  const who = [...new Set([P.uid, ...(edit.who || [])])].filter(Boolean);
  const okDay = /^\d{4}-\d{2}-\d{2}$/.test(day);
  useEffect(() => {
    if (!okDay || !who.length) {
      setD(null);
      return undefined;
    }
    let live = true;
    const t = setTimeout(() => {
      api('cal_busy', { day, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || '', who, skip: edit.id ? c.id + ':' + edit.id : '' })
        .then(r => live && (setD(r), setErr('')))
        .catch(e => live && (setD(null), setErr(errText(e))));
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [day, who.join(',')]);
  if (!okDay) return null;
  if (err) return html`<p className="muted small">Availability: ${err}</p>`;
  if (!d) return html`<p className="muted small">Checking the panel's calendars…</p>`;
  const s0 = new Date(edit.at).getTime() || 0;
  const s1 = s0 + (edit.dur || 60) * 60000;
  // the interview's own event in the calendars (at its saved time) is no clash with itself
  const ps = prev && prev.at && calInOne(prev) ? new Date(prev.at).getTime() : 0;
  const pe = ps + ((prev && prev.dur) || 60) * 60000;
  const lo = d.from + 7 * 3600000;
  const span = 14 * 3600000;
  const pct = t => Math.max(0, Math.min(100, ((t - lo) / span) * 100));
  const hm = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const clashes = [];
  const rows = d.people.map(p => {
    const blocks = p.busy.filter(b => !(b[2] === 'cal' && ps && b[0] === ps && b[1] === pe));
    let clash = false;
    blocks.forEach(b => {
      if (s0 && b[0] < s1 && b[1] > s0) {
        clash = true;
        clashes.push(`${String(p.n || 'Someone').split(' ')[0]} ${hm(b[0])}–${hm(b[1])}${b[2] === 'portal' ? ' (' + b[3] + ')' : ''}`);
      }
    });
    return { p, blocks, clash };
  });
  return html`<div className="calavail">
      <div className="calhours">${[8, 11, 14, 17, 20].map(h => html`<span key=${h} style=${{ left: pct(d.from + h * 3600000) + '%' }}>${hm(d.from + h * 3600000)}</span>`)}</div>
      ${rows.map(
        ({ p, blocks, clash }) => html`<div key=${p.uid} className="calrow">
          <span className="calwho" title=${p.err || ''}>${p.n || 'Someone'}${p.uid === P.uid ? ' (you)' : ''}${p.cal ? null : html` <span className="muted">· no calendar</span>`}${p.err ? html` <span className="calerr">· calendar not readable</span>` : null}</span>
          <div className="calbar">${blocks.map((b, i) => html`<i key=${i} className=${'calblk ' + b[2]} style=${{ left: pct(b[0]) + '%', width: Math.max(0.8, pct(b[1]) - pct(b[0])) + '%' }} title=${hm(b[0]) + '–' + hm(b[1]) + (b[2] === 'portal' ? ' · ' + b[3] : ' · busy in their calendar')} />`)}${s0 ? html`<b className=${'calslot' + (clash ? ' clash' : '')} style=${{ left: pct(s0) + '%', width: Math.max(0.8, pct(s1) - pct(s0)) + '%' }} />` : null}</div>
        </div>`,
      )}
      ${clashes.length ? html`<div className="note amber small"><span><b>Clashes:</b> ${clashes.join('; ')}</span></div>` : html`<div className="muted small">${s0 ? 'Everyone is free then, as far as their calendars and the portal show.' : 'Pick a time to see clashes.'} Only busy times are read, never what the meetings are.</div>`}
    </div>`;
}
/* My interviews: the calendar this person connected, or the buttons to connect one. */
function CalConnectCard() {
  const toast = useToast();
  const [st, load] = useCalStatus();
  const [busy, setBusy] = useState('');
  useCalReturn(load);
  if (!st || st.failed || (!st.acct && !st.google && !st.microsoft)) return null;
  const a = st.acct;
  const check = async () => {
    setBusy('check');
    try {
      await api('cal_check', {});
      toast('The calendar connection works.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
    load();
  };
  const drop = async () => {
    if (!confirm('Disconnect your calendar? Interviews already in it stay there; new invitations are emailed with a calendar file.')) return;
    setBusy('drop');
    try {
      await api('cal_disconnect', {});
      toast('Calendar disconnected.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
    load();
  };
  return html`<section className="panel stack calcard">
      <div className="ph-row">
        <div><b>Your calendar</b><div className="muted small">${a ? `${CAL_N[a.provider] || a.provider} · ${a.email}${a.meet ? ` · ${CAL_MEET[a.provider]} links` : ''}` : 'Not connected'}</div></div>
        <div className="actions">${a ? html`<button className="btn ghost sm" disabled=${!!busy} onClick=${check}>${busy === 'check' ? 'Checking…' : 'Check'}</button><button className="btn ghost sm" disabled=${!!busy} onClick=${drop}>Disconnect</button>` : html`${st.google ? html`<a className="btn sm" href=${calConnectUrl('google')}><${Icon} n="cal" />Connect Google Calendar</a>` : null}${st.microsoft ? html`<a className="btn sm" href=${calConnectUrl('microsoft')}><${Icon} n="cal" />Connect Outlook</a>` : null}`}</div>
      </div>
      ${a && a.err ? html`<div className="note red small"><span>${a.err}</span></div>` : null}
      <p className="muted small" style=${{ margin: 0 }}>${a ? 'Interviews you schedule can go out from this calendar with a meeting link. When someone puts you on a panel, the invitation comes here and they see when you are busy: only the times, never what the meetings are.' : 'Connect Google Calendar or Outlook: interviews you schedule go out from your calendar (with a Meet or Teams link), panel invitations come to it, and whoever schedules you sees when you are busy: only the times, never what the meetings are.'}</p>
    </section>`;
}
function InterviewsPanel({ c, job, S, onChanged }) {
  const P = usePortal();
  const A = P.admin;
  const toast = useToast();
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  const [cal, loadCal] = useCalStatus();
  useCalReturn(loadCal);
  const acct = cal && cal.acct;
  const staff = staffOf(A);
  const team = teamOf(A, job);
  const kinds = ['Phone screen', 'Video interview', 'Technical interview', 'Panel interview', 'Onsite', 'Client interview', 'Final round', 'Reference check'];
  const blank = () => ({ id: '', at: '', dur: 60, kind: kinds[1], where: '', who: team.length ? team : [P.uid], stage: c.st, notes: '', invite: true, useCal: !!acct, meet: !!(acct && acct.meet) });
  const save = async (cancel, ivIn) => {
    const e = ivIn || edit;
    if (!cancel && !e.at) return toast('Pick the date and time.', true);
    const inCal = calInOne(e);
    setBusy(true);
    try {
      const r = await api('ats_interview', {
        id: c.id,
        intv: { id: e.id, at: e.at, dur: e.dur, kind: e.kind, where: e.where, who: e.who, stage: e.stage, notes: e.notes, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || '' },
        invite: !!e.invite,
        cancel: !!cancel,
        cal: !inCal && !cancel && !!(acct && e.useCal),
        meet: !!e.meet,
      });
      const where = r.cal ? CAL_N[r.cal.p] || 'the calendar' : '';
      if (r.calErr) toast(`${cancel ? 'Interview cancelled' : 'Interview saved'}, but the calendar was not updated: ${r.calErr}${r.sent ? ` The portal emailed ${r.sent} invitation${r.sent === 1 ? '' : 's'} instead.` : ''}`, true);
      else if (r.cal) toast(cancel ? `Interview cancelled; ${where} tells the guests.` : inCal ? `Interview saved; ${where} sends the change to the guests.` : `Interview saved; ${where} sent the invitations${r.cal.join ? ` with a ${CAL_MEET[r.cal.p]} link` : ''}.`);
      else toast(cancel ? 'Interview cancelled.' : `Interview saved${r.sent ? `; ${r.sent} invitation${r.sent === 1 ? '' : 's'} sent` : ''}.`);
      setEdit(null);
      onChanged && onChanged();
    } catch (er) {
      toast(errText(er), true);
    }
    setBusy(false);
  };
  const list = (c.intvs || []).slice().sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const cardsFor = iv => (c.cards || []).filter(k => k.intv === iv.id);
  const link = w => (/^https:\/\//.test(w || '') ? html`<a href=${w} target="_blank" rel="noopener">${/meet\.google\.com/.test(w) ? 'Google Meet' : /teams\.microsoft\.com/.test(w) ? 'Teams meeting' : w}</a>` : w);
  const inCalEdit = edit && calInOne(edit);
  const viaCal = edit && (inCalEdit || (acct && edit.useCal));
  return html`<div className="stack">
      <div className="ph-row"><b>Interviews</b><button className="btn sm" onClick=${() => setEdit(blank())}><${Icon} n="cal" />Schedule</button></div>
      ${
        list.length
          ? html`<div className="tblwrap"><table className="tbl small"><thead><tr><th>When</th><th>Kind</th><th>Panel</th><th>Where</th><th>Scorecards</th><th /></tr></thead><tbody>${list.map(iv => html`<tr key=${iv.id} className=${iv.cancelled ? 'muted' : ''}><td className="nw">${fmtTs(new Date(iv.at).getTime())}${iv.cancelled ? html` <${Chip}>cancelled<//>` : new Date(iv.at) < new Date() ? html` <${Chip}>done<//>` : null}<div className="muted">${iv.dur} min</div>${iv.cal && iv.cal.eid ? html`<div className="muted calin">${iv.cal.st === 'cancelled' ? 'Cancelled in ' : 'In '}${CAL_N[iv.cal.p] || 'the calendar'}${iv.cal.link && iv.cal.st !== 'cancelled' ? html` · <a href=${iv.cal.link} target="_blank" rel="noopener">open</a>` : null}</div>` : null}</td><td>${iv.kind}<div className="muted">${stageOf(job, iv.stage).n}</div></td><td>${(iv.who || []).map(u => nameIn(A, u)).join(', ') || '—'}${!iv.cancelled ? html`<${CalRsvp} cal=${iv.cal} c=${c} A=${A} />` : null}</td><td className="small">${link(iv.where)}</td><td>${cardsFor(iv).length ? html`${cardsFor(iv).map(k => html`<${Chip} key=${k.id} s=${REC_TONE[k.rec] || ''}>${k.byn.split(' ')[0]}: ${REC_LABEL[k.rec] || 'notes'}<//>`)}` : html`<span className="muted small">${(iv.who || []).length ? `${(iv.who || []).length} pending` : '—'}</span>`}</td><td className="r">${!iv.cancelled && html`<div className="actions" style=${{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}><button className="btn ghost sm" onClick=${() => setEdit({ ...iv, invite: true, useCal: false, meet: false })}>Edit</button><button className="btn ghost sm" disabled=${busy} onClick=${() => confirm(`Cancel this interview? ${calInOne(iv) ? (iv.cal.p === 'google' ? 'Google' : 'Outlook') + ' tells the guests.' : 'Attendees are told by email.'}`) && save(true, { ...iv, invite: true })}>Cancel</button></div>`}</td></tr>`)}</tbody></table></div>`
          : html`<p className="muted small">No interviews yet. Scheduling one invites the candidate and the panel (from your Google Calendar or Outlook once connected, otherwise by email with a calendar file) and gives each interviewer a scorecard to fill in afterwards.</p>`
      }
      ${
        edit &&
        html`<${Modal} title=${edit.id ? 'Edit interview' : 'Schedule an interview'} onClose=${() => setEdit(null)} foot=${html`<button className="btn ghost" onClick=${() => setEdit(null)}>Cancel</button><button className="btn" disabled=${busy} onClick=${() => save(false)}>${busy ? 'Saving…' : inCalEdit ? `Save (updates ${CAL_N[edit.cal.p]})` : viaCal ? `Save and send from ${CAL_N[acct.provider]}` : edit.invite ? 'Save and send invitations' : 'Save'}</button>`}>
            <div className="form">
              <div className="row3">
                <${Field} label="Kind"><select value=${edit.kind} onChange=${e => setEdit({ ...edit, kind: e.target.value })}>${kinds.map(k => html`<option key=${k}>${k}</option>`)}</select><//>
                <${Field} label="Date and time"><input type="datetime-local" value=${edit.at} onInput=${e => setEdit({ ...edit, at: e.target.value })} /><//>
                <${Field} label="Minutes"><input type="number" min="15" step="15" value=${edit.dur} onInput=${e => setEdit({ ...edit, dur: +e.target.value })} /><//>
              </div>
              <div className="row2">
                <${Field} label="Where / link" hint=${viaCal && edit.meet && !edit.where ? `Left empty: the ${CAL_MEET[(inCalEdit ? edit.cal : acct).p || (acct && acct.provider)] || 'meeting'} link goes here.` : ''}><input value=${edit.where} onInput=${e => setEdit({ ...edit, where: e.target.value })} placeholder="Zoom link, phone, or the office address" /><//>
                <${Field} label="For stage"><select value=${edit.stage} onChange=${e => setEdit({ ...edit, stage: e.target.value })}>${stagesOf(job).map(s => html`<option key=${s.k} value=${s.k}>${s.n}</option>`)}</select><//>
              </div>
              <${Field} label="Interviewers" hint="They get the invitation and a scorecard to fill in.">
                <div className="portalpicks wide">${staff.map(m => html`<label key=${m.id} className=${'pick' + ((edit.who || []).includes(m.id) ? ' on' : '')}><input type="checkbox" checked=${(edit.who || []).includes(m.id)} onChange=${e => setEdit({ ...edit, who: e.target.checked ? [...(edit.who || []), m.id] : (edit.who || []).filter(x => x !== m.id) })} /><span>${m.u.p.n}</span></label>`)}</div>
              <//>
              ${edit.at && html`<${Field} label="The panel's day"><${CalAvail} c=${c} edit=${edit} prev=${(c.intvs || []).find(x => x.id === edit.id && edit.id)} /><//>`}
              <${Field} label="Notes for the panel and the candidate"><textarea value=${edit.notes} onInput=${e => setEdit({ ...edit, notes: e.target.value })} placeholder="Agenda, what to prepare, who joins when" /><//>
              ${
                inCalEdit
                  ? html`<div className="note info"><span><b>In ${CAL_N[edit.cal.p]}</b> (${edit.cal.email}). Changes go there and ${edit.cal.p === 'google' ? 'Google' : 'Outlook'} tells the guests.${edit.cal.join ? html` <a href=${edit.cal.join} target="_blank" rel="noopener">${CAL_MEET[edit.cal.p]} link</a>` : null}</span></div>`
                  : acct
                    ? html`<div className="stack" style=${{ gap: 6 }}>
                        <label className="check"><input type="checkbox" checked=${!!edit.useCal} onChange=${e => setEdit({ ...edit, useCal: e.target.checked })} /><span>Send the invitation from my calendar (${CAL_N[acct.provider]} · ${acct.email})</span></label>
                        ${edit.useCal && acct.meet ? html`<label className="check"><input type="checkbox" checked=${!!edit.meet} onChange=${e => setEdit({ ...edit, meet: e.target.checked })} /><span>Add a ${CAL_MEET[acct.provider]} link</span></label>` : null}
                        ${edit.useCal && !acct.meet && acct.provider === 'microsoft' ? html`<span className="muted small">Teams links need a work or school Microsoft 365 account.</span>` : null}
                        ${acct.err ? html`<span className="calerr small">${acct.err}</span>` : null}
                      </div>`
                    : cal && (cal.google || cal.microsoft)
                      ? html`<div className="note info"><span>Connect your calendar to send invitations from Google Calendar or Outlook (with a Meet or Teams link) and get the guests' answers back. ${cal.google ? html`<a className="btn ghost sm" href=${calConnectUrl('google')}>Connect Google Calendar</a> ` : null}${cal.microsoft ? html`<a className="btn ghost sm" href=${calConnectUrl('microsoft')}>Connect Outlook</a>` : null}</span></div>`
                      : null
              }
              <label className="check"><input type="checkbox" checked=${edit.invite} onChange=${e => setEdit({ ...edit, invite: e.target.checked })} /><span>${viaCal ? 'If the calendar cannot send it, email the invitations with a calendar file instead' : 'Email invitations with a calendar file to the candidate and the panel'}</span></label>
            </div>
          <//>`
      }
    </div>`;
}
/* Structured scorecards: each interviewer rates the job's attributes 1–4 and gives one recommendation. */
function ScorecardsPanel({ c, job, S, onChanged }) {
  const P = usePortal();
  const toast = useToast();
  const attrs = (job && job.attrs && job.attrs.length ? job.attrs : S.attrs) || [];
  const [card, setCard] = useState(null);
  const [busy, setBusy] = useState(false);
  const cards = c.cards || [];
  const kit = (() => {
    const kind = kindOf(job, c.st);
    const custom = job && job.kit && (job.kit[c.st] || job.kit[kind]);
    return (custom && custom.length ? custom : (S.kits || {})[kind] || (S.kits || {}).interview) || [];
  })();
  const avg = {};
  attrs.forEach(a => {
    const vs = cards.map(k => k.attrs && k.attrs[a]).filter(v => v);
    avg[a] = vs.length ? (vs.reduce((x, y) => x + y, 0) / vs.length).toFixed(1) : null;
  });
  const tally = Object.keys(REC_LABEL).map(k => [k, cards.filter(x => x.rec === k).length]);
  const submit = async () => {
    setBusy(true);
    try {
      await api('ats_card', { id: c.id, card });
      toast('Scorecard submitted.');
      setCard(null);
      onChanged && onChanged();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const scale = ['', 'Below bar', 'Mixed', 'Meets bar', 'Exceptional'];
  return html`<div className="stack">
      <div className="ph-row"><b>Scorecards</b><button className="btn sm" onClick=${() => setCard({ intv: ((c.intvs || []).filter(i => !i.cancelled).slice(-1)[0] || {}).id || '', stage: c.st, attrs: {}, rec: '', notes: '' })}><${Icon} n="pen" />Submit my scorecard</button></div>
      ${
        cards.length
          ? html`<div className="g2" style=${{ alignItems: 'start' }}>
              <table className="tbl small"><thead><tr><th>Attribute</th><th className="r">Average (1–4)</th></tr></thead><tbody>${attrs.map(a => html`<tr key=${a}><td>${a}</td><td className="r num">${avg[a] || '—'}</td></tr>`)}</tbody></table>
              <div className="stack" style=${{ gap: 6 }}>${tally.map(([k, n]) => html`<div key=${k} className="actions"><${Chip} s=${REC_TONE[k]}>${REC_LABEL[k]}<//><b>${n}</b></div>`)}</div>
            </div>`
          : html`<p className="muted small">No scorecards yet. Interviewers rate ${attrs.length ? attrs.join(', ') : 'the job\'s attributes'} on a 1–4 scale and give one overall recommendation; the averages and the tally show here.</p>`
      }
      ${cards.slice().reverse().map(k => html`<div key=${k.id} className="panel" style=${{ padding: 12 }}>
          <div className="actions"><b>${k.byn}</b><${Chip} s=${REC_TONE[k.rec] || ''}>${REC_LABEL[k.rec] || 'No recommendation'}<//><span className="muted small">${stageOf(job, k.stage).n} · ${fmtTs(k.at)}</span></div>
          ${k.attrs && Object.keys(k.attrs).length > 0 && html`<div className="small" style=${{ marginTop: 6 }}>${Object.entries(k.attrs).map(([a, v]) => html`<span key=${a} style=${{ marginRight: 12 }}>${a}: <b>${v}</b></span>`)}</div>`}
          ${k.notes && html`<p className="small" style=${{ whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>${k.notes}</p>`}
        </div>`)}
      ${
        card &&
        html`<${Modal} title=${'Scorecard for ' + c.n} onClose=${() => setCard(null)} foot=${html`<button className="btn ghost" onClick=${() => setCard(null)}>Cancel</button><button className="btn" disabled=${busy} onClick=${submit}>${busy ? 'Submitting…' : 'Submit scorecard'}</button>`}>
            <div className="form">
              ${kit.length > 0 && html`<div className="note info"><span><b>Interview kit.</b> ${kit.map((q, i) => html`<div key=${i}>${i + 1}. ${q}</div>`)}</span></div>`}
              <div className="row2">
                <${Field} label="Interview"><select value=${card.intv} onChange=${e => setCard({ ...card, intv: e.target.value })}><option value="">General / not tied to an interview</option>${(c.intvs || []).filter(i => !i.cancelled).map(i => html`<option key=${i.id} value=${i.id}>${i.kind} · ${fmtTs(new Date(i.at).getTime())}</option>`)}</select><//>
                <${Field} label="Stage"><select value=${card.stage} onChange=${e => setCard({ ...card, stage: e.target.value })}>${stagesOf(job).map(s => html`<option key=${s.k} value=${s.k}>${s.n}</option>`)}</select><//>
              </div>
              <table className="tbl small"><thead><tr><th>Attribute</th>${[1, 2, 3, 4].map(v => html`<th key=${v} className="c">${v} · ${scale[v]}</th>`)}</tr></thead><tbody>${attrs.map(a => html`<tr key=${a}><td>${a}</td>${[1, 2, 3, 4].map(v => html`<td key=${v} className="c"><input type="radio" name=${'attr-' + a} checked=${card.attrs[a] === v} onChange=${() => setCard({ ...card, attrs: { ...card.attrs, [a]: v } })} /></td>`)}</tr>`)}</tbody></table>
              <${Field} label="Overall recommendation"><div className="seg">${Object.entries(REC_LABEL).map(([k, n]) => html`<button key=${k} type="button" className=${card.rec === k ? 'on' : ''} onClick=${() => setCard({ ...card, rec: k })}>${n}</button>`)}</div><//>
              <${Field} label="Notes" hint="Evidence, not adjectives: what they said or did."><textarea value=${card.notes} onInput=${e => setCard({ ...card, notes: e.target.value })} style=${{ minHeight: 120 }} /><//>
            </div>
          <//>`
      }
    </div>`;
}
/* The offer: terms, approval, the letter as a PDF sent for e-signature, acceptance. */
function OfferPanel({ c, job, pub, S, onChanged, onHire }) {
  const P = usePortal();
  const A = P.admin;
  const toast = useToast();
  const o = c.offer || {};
  const [f, setF] = useState({ title: o.title || c.jt || (pub && pub.ti) || '', type: o.type || (pub && pub.ty === 'C2C' ? 'c2c' : pub && /W2/i.test(pub.ty || '') ? 'w2c' : 'w2'), pay: o.pay || '', per: o.per || 'hour', cur: o.cur || 'USD', start: o.start || '', expires: o.expires || '', client: o.client || (job && job.client && A && A.clientsById[job.client] ? A.clientsById[job.client].n : '') || '', terms: o.terms || '', signer: o.signer || (P.prof && P.prof.n) || '', approver: o.approver || (job && job.team && job.team.hm) || '', st: o.st || 'draft' });
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState('');
  const sig = useDoc(o.sigId ? `sig/${o.sigId}` : null);
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const save = async (patch, msg) => {
    setBusy('save');
    try {
      await dbMerge(`ats/${c.id}`, { offer: { ...o, ...f, ...(patch || {}), u: Date.now() }, u: Date.now(), log: [...(c.log || []), { t: Date.now(), who: (P.prof && P.prof.n) || '', ev: msg || 'Offer updated' }] });
      toast(msg || 'Offer saved.');
      onChanged && onChanged();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const letter = async () => {
    setBusy('letter');
    try {
      const r = await api('ats_offer_letter', { id: c.id, offer: f });
      setPreview(r.text);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const send = async () => {
    if (!/^\S+@\S+\.\S+$/.test(c.e || '')) return toast('The candidate needs an email address for e-signature.', true);
    setBusy('send');
    try {
      const text = preview || (await api('ats_offer_letter', { id: c.id, offer: f })).text;
      const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
      const pdf = await PDFDocument.create();
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
      let page = pdf.addPage([612, 792]);
      let y = 740;
      try {
        const lr = await fetch(LOGO_L);
        if (lr.ok) {
          const logo = await pdf.embedPng(new Uint8Array(await lr.arrayBuffer()));
          const w = 130, h = (w * logo.height) / logo.width;
          page.drawImage(logo, { x: 50, y: y - h + 10, width: w, height: h });
        }
      } catch (e) { /* no logo */ }
      page.drawText('OFFER OF EMPLOYMENT', { x: 330, y, size: 15, font: bold, color: rgb(0.063, 0.106, 0.208) });
      page.drawText(ascii(fmtDay(Date.now())), { x: 330, y: y - 18, size: 10, font, color: rgb(0.42, 0.46, 0.55) });
      y -= 60;
      const wrap = (s, max) => { const words = s.split(/\s+/); const lines = []; let cur = ''; words.forEach(w => { const t = cur ? cur + ' ' + w : w; if (font.widthOfTextAtSize(t, 11) > max) { lines.push(cur); cur = w; } else cur = t; }); if (cur) lines.push(cur); return lines; };
      text.split('\n').forEach(par => {
        const lines = par.trim() === '' ? [''] : wrap(ascii(par), 500);
        lines.forEach(l => {
          if (y < 90) { page = pdf.addPage([612, 792]); y = 740; }
          if (l) page.drawText(l, { x: 56, y, size: 11, font, color: rgb(0.1, 0.1, 0.12) });
          y -= 16;
        });
        y -= 4;
      });
      if (y < 150) { page = pdf.addPage([612, 792]); y = 740; }
      y -= 10;
      page.drawText('Accepted and agreed:', { x: 56, y, size: 11, font: bold });
      y -= 40;
      page.drawLine({ start: { x: 56, y }, end: { x: 280, y }, thickness: 0.8 });
      page.drawLine({ start: { x: 330, y }, end: { x: 556, y }, thickness: 0.8 });
      page.drawText(ascii(c.n) + ' (candidate)', { x: 56, y: y - 14, size: 9.5, font });
      page.drawText(ascii(f.signer || 'StratEdge IT Consulting'), { x: 330, y: y - 14, size: 9.5, font });
      const bytes = await pdf.save();
      const fd = new FormData();
      fd.append('ti', `Offer letter · ${c.n} · ${f.title}`);
      fd.append('msg', `Please review and sign your offer for the ${f.title} role.${f.expires ? ` This offer is valid until ${fmtDay(new Date(f.expires + 'T12:00:00').getTime())}.` : ''}`);
      fd.append('due', f.expires || '');
      fd.append('signers', JSON.stringify([{ n: c.n, e: c.e }, { uid: P.uid }]));
      fd.append('counter', '0');
      fd.append('file', new Blob([bytes], { type: 'application/pdf' }), `offer-${(c.n || 'candidate').replace(/\s+/g, '-')}.pdf`);
      const r = await upload('sig_create', fd);
      Sync.kick();
      await dbMerge(`ats/${c.id}`, { offer: { ...o, ...f, st: 'sent', sigId: r.id, sentAt: Date.now(), u: Date.now() }, u: Date.now(), log: [...(c.log || []), { t: Date.now(), who: (P.prof && P.prof.n) || '', ev: 'Offer letter sent for e-signature' }] });
      // the offer stage, if the job has one
      const offerKey = stageKeyOfKind(job, 'offer');
      if (kindOf(job, c.st) !== 'offer' && kindOf(job, c.st) !== 'hired') await api('ats_move', { id: c.id, st: offerKey, silent: true }).catch(() => {});
      toast('Offer letter sent for signature.');
      setPreview(null);
      onChanged && onChanged();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const sigSt = sig.data && sig.data.st;
  useEffect(() => {
    // the signature request finished: the offer follows it
    if (o.st === 'sent' && sigSt === 'done') dbMerge(`ats/${c.id}`, { offer: { ...o, st: 'accepted', acceptedAt: Date.now() }, u: Date.now(), log: [...(c.log || []), { t: Date.now(), who: 'E-sign', ev: 'Offer accepted (signed)' }] }).catch(() => {});
  }, [sigSt]);
  const money = v => (v ? fmtMoney(+v, f.cur) + (f.per === 'hour' ? '/hr' : f.per === 'year' ? '/yr' : '/' + f.per) : '—');
  return html`<div className="stack">
      <div className="actions"><b>Offer</b><${Chip} s=${o.st === 'accepted' ? 'ok' : o.st === 'declined' ? 'red' : o.st === 'sent' || o.st === 'approved' ? 'new' : ''}>${o.st || 'draft'}<//>${o.sentAt && html`<span className="muted small">sent ${fmtTs(o.sentAt)}</span>`}${sig.data && html`<span className="muted small">· signature request ${SIG_ST[sig.data.st] || sig.data.st}</span>`}</div>
      <div className="form">
        <div className="row3">
          <${Field} label="Title"><input value=${f.title} onInput=${up('title')} /><//>
          <${Field} label="Engagement"><select value=${f.type} onChange=${up('type')}><option value="w2">W-2 employee</option><option value="w2c">W-2 contractor</option><option value="c2c">Corp-to-corp</option><option value="1099">1099 contractor</option></select><//>
          <${Field} label="Client / assignment (optional)"><input value=${f.client} onInput=${up('client')} placeholder="e.g. Acme Health" /><//>
        </div>
        <div className="row3">
          <${Field} label="Pay"><div className="actions" style=${{ flexWrap: 'nowrap' }}><input type="number" step="0.01" min="0" value=${f.pay} onInput=${up('pay')} style=${{ flex: 1 }} /><select value=${f.per} onChange=${up('per')} style=${{ width: 110 }}><option value="hour">per hour</option><option value="year">per year</option><option value="month">per month</option><option value="day">per day</option></select><select value=${f.cur} onChange=${up('cur')} style=${{ width: 80 }}><option>USD</option><option>INR</option></select></div><//>
          <${Field} label="Start date"><input type="date" value=${f.start} onInput=${up('start')} /><//>
          <${Field} label="Offer valid until"><input type="date" value=${f.expires} onInput=${up('expires')} /><//>
        </div>
        <div className="row2">
          <${Field} label="Approver" hint="Offers above the pay range or outside policy go to them first."><select value=${f.approver} onChange=${up('approver')}><option value="">No approval needed</option>${staffOf(A).map(m => html`<option key=${m.id} value=${m.id}>${m.u.p.n}</option>`)}</select><//>
          <${Field} label="Signs for the company"><input value=${f.signer} onInput=${up('signer')} /><//>
        </div>
        <${Field} label="Extra terms (optional)" hint="Benefits, bonus, probation, per-diem, relocation… Added to the letter."><textarea value=${f.terms} onInput=${up('terms')} /><//>
        ${job && job.pay && (job.pay.min || job.pay.max) && +f.pay > 0 && (job.pay.max && +f.pay > +job.pay.max) && html`<div className="note amber"><span>Above the requisition's range (${money(job.pay.min)} – ${money(job.pay.max)}): get approval before sending.</span></div>`}
        <div className="actions">
          <button className="btn ghost" disabled=${!!busy} onClick=${() => save({}, 'Offer saved')}>Save</button>
          ${f.approver && o.st !== 'approved' && o.st !== 'sent' && o.st !== 'accepted' && html`<button className="btn ghost" disabled=${!!busy || f.approver !== P.uid} title=${f.approver !== P.uid ? 'Only the approver can approve' : ''} onClick=${() => save({ st: 'approved', approvedAt: Date.now(), approvedBy: P.uid }, 'Offer approved')}>Approve</button>`}
          <button className="btn ghost" disabled=${!!busy} onClick=${letter}>${busy === 'letter' ? 'Building…' : 'Preview letter'}</button>
          <button className="btn" disabled=${!!busy || (!!f.approver && o.st !== 'approved' && o.st !== 'sent' && o.st !== 'accepted')} onClick=${send}>${busy === 'send' ? 'Sending…' : 'Send for e-signature'}</button>
          ${o.st !== 'accepted' && html`<button className="btn ghost" disabled=${!!busy} onClick=${() => save({ st: 'accepted', acceptedAt: Date.now() }, 'Offer accepted (recorded by hand)')}>Mark accepted</button>`}
          ${o.st !== 'declined' && o.st && html`<button className="btn ghost" disabled=${!!busy} onClick=${() => save({ st: 'declined', declinedAt: Date.now() }, 'Offer declined')}>Mark declined</button>`}
          ${o.st === 'accepted' && html`<button className="btn go" onClick=${onHire}><${Icon} n="check" />Hire and onboard</button>`}
        </div>
      </div>
      ${preview != null && html`<${Modal} wide title="Offer letter" onClose=${() => setPreview(null)} foot=${html`<button className="btn ghost" onClick=${() => setPreview(null)}>Close</button><button className="btn" disabled=${!!busy} onClick=${send}>Send for e-signature</button>`}><textarea value=${preview} onInput=${e => setPreview(e.target.value)} style=${{ minHeight: 420, width: '100%', fontFamily: 'inherit' }} /><p className="muted small">Edit the text here before sending; the template lives under Settings › Offer letter.</p><//>`}
    </div>`;
}
/* The hire: a login, the onboarding checklist, the HR record, the pay plan, and the placement. */
function HireModal({ c, job, pub, onClose, onDone }) {
  const P = usePortal();
  const A = P.admin;
  const toast = useToast();
  const o = c.offer || {};
  const [f, setF] = useState({ kind: o.type === 'c2c' || o.type === '1099' || (pub && pub.ty === 'C2C') ? 'consultant' : 'employee', login: !c.uid, onboard: true, pay: !!o.pay, placement: !!(o.client || (job && job.client)), client: (job && job.client) || '', bill: '', vendor: '', end: '', sales: (job && job.team && job.team.sales) || '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const go = async () => {
    setBusy(true);
    try {
      const r = await api('ats_hire', { id: c.id, opt: f });
      setDone(r);
      toast('Hired.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const clients = (A && A.clients) || [];
  return html`<${Modal} title=${'Hire ' + c.n} onClose=${done ? onDone : onClose} foot=${done ? html`<button className="btn" onClick=${onDone}>Done</button>` : html`<button className="btn ghost" onClick=${onClose}>Cancel</button><button className="btn" disabled=${busy} onClick=${go}>${busy ? 'Working…' : 'Hire'}</button>`}>
      ${
        done
          ? html`<div className="stack">
              <div className="note ok"><span><b>${c.n}</b> is hired${done.uid ? ' · portal login ' + done.uid : ''}${done.placement ? ' · placement recorded' : ''}.</span></div>
              ${done.login && html`<${InviteResult} name=${c.n} email=${c.e} link=${done.login.link} mailed=${done.login.mailed} />`}
              <p className="muted small">Next: HR › Onboarding has the checklist; Payroll setup carries the pay plan; Placements shows the engagement and its margin.</p>
            </div>`
          : html`<div className="form">
              ${!o.st && html`<div className="note amber"><span>No offer is recorded. You can still hire; the pay plan and start date then come from the HR record.</span></div>`}
              <${Field} label="Join as"><div className="seg">${[['employee', 'Employee (internal staff)'], ['consultant', 'Consultant (placed with a client)']].map(([k, n]) => html`<button key=${k} type="button" className=${f.kind === k ? 'on' : ''} onClick=${() => setF({ ...f, kind: k })}>${n}</button>`)}</div><//>
              <label className="check"><input type="checkbox" checked=${f.login} disabled=${!!c.uid} onChange=${e => setF({ ...f, login: e.target.checked })} /><span>${c.uid ? 'Already has a portal login' : 'Create the portal login and email an invitation to choose a password'}</span></label>
              <label className="check"><input type="checkbox" checked=${f.onboard} onChange=${e => setF({ ...f, onboard: e.target.checked })} /><span>Start the onboarding checklist (HR › Onboarding)</span></label>
              <label className="check"><input type="checkbox" checked=${f.pay} disabled=${!o.pay} onChange=${e => setF({ ...f, pay: e.target.checked })} /><span>Set the pay plan from the offer${o.pay ? ` (${fmtMoney(+o.pay, o.cur || 'USD')} per ${o.per || 'hour'})` : ''}</span></label>
              <${Field} label="Client (for a placement)"><select value=${f.client} onChange=${e => setF({ ...f, client: e.target.value, placement: !!e.target.value })}><option value="">— internal, no client —</option>${clients.map(cl => html`<option key=${cl.id} value=${cl.id}>${cl.n}</option>`)}</select><//>
              ${
                f.client &&
                html`<${Fragment}>
                    <label className="check"><input type="checkbox" checked=${f.placement} onChange=${e => setF({ ...f, placement: e.target.checked })} /><span>Record the placement (bill rate, margin, dates, who gets credit)</span></label>
                    <div className="row3">
                      <${Field} label=${'Bill rate (' + (o.cur || 'USD') + ' per ' + (o.per || 'hour') + ')'}><input type="number" step="0.01" value=${f.bill} onInput=${e => setF({ ...f, bill: e.target.value })} /><//>
                      <${Field} label="End date (if known)"><input type="date" value=${f.end} onInput=${e => setF({ ...f, end: e.target.value })} /><//>
                      <${Field} label="Sales credit"><select value=${f.sales} onChange=${e => setF({ ...f, sales: e.target.value })}><option value="">—</option>${staffOf(A).map(m => html`<option key=${m.id} value=${m.id}>${m.u.p.n}</option>`)}</select><//>
                    </div>
                    ${+f.bill > 0 && +o.pay > 0 && html`<p className="small">Margin ${fmtMoney(+f.bill - +o.pay, o.cur || 'USD')} per ${o.per || 'hour'} (${Math.round(((+f.bill - +o.pay) / +f.bill) * 100)}%).</p>`}
                  <//>`
              }
            </div>`
      }
    <//>`;
}
/* ---------------- Add / import ---------------- */
function AddCandidate({ jobsMap, S, defaultJob, onClose }) {
  const P = usePortal();
  const toast = useToast();
  const [f, setF] = useState({ n: '', e: '', ph: '', ti: '', loc: '', auth: '', exp: '', sk: '', li: '', src: 'Recruiter sourced', job: defaultJob || '', tags: [], pool: !defaultJob, msg: '' });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(0);
  const [dupes, setDupes] = useState([]);
  const up = k => e => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const checkDupes = () => {
    if (!f.e && !f.ph) return;
    api('ats_dupes', { e: f.e, ph: f.ph }).then(r => setDupes(r.rows)).catch(() => {});
  };
  const save = async () => {
    if (!f.n.trim() || (f.e && !/^\S+@\S+\.\S+$/.test(f.e))) {
      toast('Add a name (and a valid email if you have one).', true);
      return;
    }
    setBusy(true);
    try {
      const id = nid();
      const now = Date.now();
      const me = (P.prof && P.prof.n) || '';
      const row = f.job ? jobsMap[f.job] : null;
      await dbSet(`ats/${id}`, {
        n: f.n.trim(),
        e: f.e.trim().toLowerCase(),
        ph: f.ph,
        ti: f.ti,
        loc: f.loc,
        auth: f.auth,
        exp: f.exp === '' ? null : +f.exp,
        sk: f.sk,
        li: f.li,
        src: f.src,
        job: f.job || '',
        jt: row ? row.pub.ti : '',
        tags: f.tags,
        pool: !!f.pool || !f.job,
        msg: f.msg,
        st: 'new',
        rating: 0,
        notes: [],
        at: now,
        stAt: now,
        u: now,
        by: P.uid,
        log: [{ t: now, who: me, ev: 'Added' + (row ? ' for ' + row.pub.ti : ' to the talent pool') + (f.src ? ' · ' + f.src : '') }],
      });
      if (file) {
        setProg(0.03);
        const r = await storeFile(`ats/${id}`, file, { c: 'resume' }, setProg);
        await dbMerge(`ats/${id}`, { rid: r.id, rn: r.n });
      }
      toast('Candidate added.');
      onClose(id);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<${Modal} title="Add a candidate" onClose=${() => onClose()} foot=${html`<button className="btn ghost" onClick=${() => onClose()}>Cancel</button><button className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Add candidate'}</button>`}>
      <div className="form">
        <div className="row3">
          <${Field} label="Name"><input value=${f.n} onInput=${up('n')} autoFocus /><//>
          <${Field} label="Email"><input type="email" value=${f.e} onInput=${up('e')} onBlur=${checkDupes} /><//>
          <${Field} label="Phone"><input value=${f.ph} onInput=${up('ph')} onBlur=${checkDupes} /><//>
        </div>
        ${dupes.length > 0 && html`<div className="note amber"><span>Already here: ${dupes.map(d => `${d.n} (${d.jt || 'pool'}, ${ATS_KIND_NAME[d.st] || d.st})`).join('; ')}. Add anyway to consider them for another job.</span></div>`}
        <div className="row3">
          <${Field} label="Job"><select value=${f.job} onChange=${up('job')}><option value="">Talent pool (no job yet)</option>${Object.values(jobsMap).filter(r => r.pub.open !== false || r.id === f.job).map(r => html`<option key=${r.id} value=${r.id}>${r.pub.ti}</option>`)}</select><//>
          <${Field} label="Source"><select value=${f.src} onChange=${up('src')}>${[...new Set([...(S.sources || []), f.src])].map(s => html`<option key=${s}>${s}</option>`)}</select><//>
          <${Field} label="Current title"><input value=${f.ti} onInput=${up('ti')} /><//>
        </div>
        <div className="row3">
          <${Field} label="Location"><input value=${f.loc} onInput=${up('loc')} placeholder="City, ST" /><//>
          <${Field} label="Work authorization"><select value=${f.auth} onChange=${up('auth')}><option value="">—</option>${['US citizen', 'Green card', 'H-1B', 'H4 EAD', 'OPT', 'CPT', 'L2 EAD', 'TN', 'EAD', 'Other'].map(a => html`<option key=${a}>${a}</option>`)}</select><//>
          <${Field} label="Years"><input type="number" step="0.5" min="0" value=${f.exp} onInput=${up('exp')} /><//>
        </div>
        <div className="row2">
          <${Field} label="Skills"><input value=${f.sk} onInput=${up('sk')} placeholder="Comma separated" /><//>
          <${Field} label="LinkedIn"><input value=${f.li} onInput=${up('li')} /><//>
        </div>
        <${Field} label="Tags"><div className="portalpicks wide">${(S.tags || []).map(t => html`<label key=${t} className=${'pick' + (f.tags.includes(t) ? ' on' : '')}><input type="checkbox" checked=${f.tags.includes(t)} onChange=${e => setF({ ...f, tags: e.target.checked ? [...f.tags, t] : f.tags.filter(x => x !== t) })} /><span>${t}</span></label>`)}</div><//>
        <${Field} label="Notes"><textarea value=${f.msg} onInput=${up('msg')} placeholder="Where you found them, rate, availability" /><//>
        <div>
          <span className="lbl">Resume</span>
          ${file ? html`<ul className="files" style=${{ marginTop: 8 }}><li><${Icon} n="file" /><div className="fn"><b>${file.name}</b></div><button className="btn ghost sm" onClick=${() => setFile(null)}>Remove</button></li></ul>` : html`<div style=${{ marginTop: 8 }}><${FilePick} busy=${busy} progress=${prog} onFiles=${fs => setFile(fs[0])} /></div>`}
        </div>
      </div>
    <//>`;
}
/* ---------------- Import candidates from the other portals and from job boards (v31) ---------------- */
const ATS_PULL_TABS = [
  ['portal', 'Consultant & employee portals'],
  ['db', 'Consultant database'],
  ['files', 'Resumes from job boards'],
  ['paste', 'Paste a profile'],
  ['csv', 'A spreadsheet (with preview)'],
];
function AtsPullModal({ jobsMap, onClose, onCsv }) {
  const toast = useToast();
  const [tab, setTab] = useState('portal');
  const [rows, setRows] = useState(null);
  const [boards, setBoards] = useState(['Dice', 'Monster', 'LinkedIn', 'Indeed', 'Other job board']);
  const [ai, setAi] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState({});
  const [job, setJob] = useState('');
  const [board, setBoard] = useState('Dice');
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(0);
  const [res, setRes] = useState(null);
  const [text, setText] = useState('');
  const [added, setAdded] = useState(0);
  const load = src =>
    api('ats_sources', { src })
      .then(r => {
        setRows(r.rows);
        setBoards(r.boards);
        setAi(r.ai);
      })
      .catch(e => toast(errText(e), true));
  useEffect(() => {
    setSel({});
    setRes(null);
    setQ('');
    if (tab === 'portal' || tab === 'db') {
      setRows(null);
      load(tab);
    } else if (!rows) api('ats_sources', { src: 'db', q: '~none~' }).then(r => { setBoards(r.boards); setAi(r.ai); }, () => {});
  }, [tab]);
  const ql = q.trim().toLowerCase();
  const list = (rows || []).filter(r => !ql || [r.n, r.e, r.ti, r.sk, r.loc].join(' ').toLowerCase().includes(ql));
  const pickable = list.filter(r => !r.in);
  const nSel = Object.values(sel).filter(Boolean).length;
  const jobSelect = html`<${Field} label="Add them to"><select value=${job} onChange=${e => setJob(e.target.value)}><option value="">The talent pool</option>${Object.values(jobsMap).map(r => html`<option key=${r.id} value=${r.id}>${r.pub.ti}${r.pub.open === false ? ' (closed)' : ''}</option>`)}</select><//>`;
  const done = (n, skipped) => {
    setAdded(a => a + n);
    toast(`${n} candidate${n === 1 ? '' : 's'} added to the ATS${skipped && skipped.length ? `, ${skipped.length} skipped` : ''}.`);
  };
  const pull = async () => {
    const ids = Object.keys(sel).filter(k => sel[k]);
    if (!ids.length) return toast('Tick the people to import.', true);
    setBusy(true);
    try {
      const r = await api('ats_pull', { src: tab, ids, job });
      setRes(r);
      done(r.added.length, r.skipped);
      setSel({});
      load(tab);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const uploadFiles = async files => {
    const list2 = [...files].filter(f => /\.(pdf|docx|txt)$/i.test(f.name));
    if (!list2.length) return toast('Choose PDF, Word (.docx) or text resumes.', true);
    setBusy(true);
    setRes(null);
    const all = { added: [], skipped: [...files].filter(f => !/\.(pdf|docx|txt)$/i.test(f.name)).map(f => f.name + ': not a PDF, Word or text file') };
    for (let i = 0; i < list2.length; i += 5) {
      const fd = new FormData();
      fd.append('board', board);
      fd.append('job', job);
      list2.slice(i, i + 5).forEach(f => fd.append('files[]', f, f.name));
      try {
        const r = await upload('ats_upload', fd, p => setProg((i + p * Math.min(5, list2.length - i)) / list2.length));
        all.added.push(...r.added);
        all.skipped.push(...r.skipped);
      } catch (e) {
        all.skipped.push(...list2.slice(i, i + 5).map(f => f.name + ': ' + errText(e)));
      }
      setProg(Math.min(1, (i + 5) / list2.length));
    }
    setRes(all);
    done(all.added.length, all.skipped);
    setBusy(false);
    setProg(0);
  };
  const paste = async () => {
    setBusy(true);
    try {
      const r = await api('ats_paste', { text, board, job }, { timeout: 90000 });
      setRes({ added: [{ id: r.id, n: r.fields.n, e: r.fields.e || '', ti: r.fields.ti || '' }], skipped: [] });
      done(1, []);
      setText('');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<${Modal} wide title="Import candidates" onClose=${() => onClose(added > 0)} foot=${html`<button type="button" className="btn ghost" onClick=${() => onClose(added > 0)}>${added ? 'Done' : 'Close'}</button>${(tab === 'portal' || tab === 'db') && html`<button type="button" className="btn" disabled=${busy || !nSel} onClick=${pull}>${busy ? 'Importing…' : `Import ${nSel || ''} selected`}</button>`}${tab === 'paste' && html`<button type="button" className="btn" disabled=${busy || text.trim().length < 80} onClick=${paste}>${busy ? 'Reading…' : 'Add this candidate'}</button>`}`}>
    <div className="seg ats-pull-tabs" role="tablist">${ATS_PULL_TABS.map(([k, n]) => html`<button key=${k} type="button" role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => (k === 'csv' ? onCsv() : setTab(k))}>${n}</button>`)}</div>
    ${
      (tab === 'portal' || tab === 'db') &&
      html`<div className="form" style=${{ marginTop: 12 }}>
        <p className="muted small" style=${{ margin: 0 }}>${tab === 'portal' ? 'Consultants and employees who signed up in the portal, with the resume they uploaded there.' : 'Everyone in Recruiting › Consultant database, with the resume on their card.'} The resume file is copied in; people already in the ATS (same email) are marked and skipped.</p>
        <div className="toolbar">
          <input type="search" placeholder="Search name, title, skills, location" value=${q} onInput=${e => setQ(e.target.value)} style=${{ maxWidth: 320 }} aria-label="Search" />
          <label className="check small"><input type="checkbox" checked=${pickable.length > 0 && pickable.every(r => sel[r.id])} onChange=${e => setSel(e.target.checked ? Object.fromEntries(pickable.map(r => [r.id, true])) : {})} /><span>Select all ${pickable.length ? '(' + pickable.length + ')' : ''}</span></label>
        </div>
        ${
          !rows
            ? html`<${Spinner} />`
            : list.length
              ? html`<div className="tblwrap" style=${{ maxHeight: 360, overflowY: 'auto' }}>
                  <table className="tbl small">
                    <thead><tr><th></th><th>Name</th><th>Title</th><th>Skills</th><th>Location</th><th>Resume</th></tr></thead>
                    <tbody>${list.map(r => html`<tr key=${r.id} className=${r.in ? 'muted' : ''}>
                      <td>${r.in ? html`<span className="chip ok">In ATS</span>` : html`<input type="checkbox" checked=${!!sel[r.id]} onChange=${e => setSel({ ...sel, [r.id]: e.target.checked })} aria-label=${'Select ' + r.n} />`}</td>
                      <td><b>${r.n}</b>${r.e && html`<div className="muted small">${r.e}</div>`}</td>
                      <td>${r.ti}${r.exp ? html`<div className="muted small">${r.exp} yrs</div>` : ''}</td>
                      <td className="small">${r.sk}</td>
                      <td>${r.loc}</td>
                      <td>${r.resume ? html`<span className="chip ok">Yes</span>` : html`<span className="chip">None</span>`}</td>
                    </tr>`)}</tbody>
                  </table>
                </div>`
              : html`<${Empty} title="Nobody here">${tab === 'portal' ? 'No consultants or employees have signed up yet.' : 'The consultant database is empty.'}<//>`
        }
        ${jobSelect}
      </div>`
    }
    ${
      tab === 'files' &&
      html`<div className="form" style=${{ marginTop: 12 }}>
        <p className="muted small" style=${{ margin: 0 }}>Download the resumes from Dice, Monster, LinkedIn, Indeed or your email and drop them here, up to 50 at a time. Each one becomes a candidate with the resume attached; the name, email, phone, title, skills, location and years are read ${ai ? 'by the assistant' : 'from the text'}. Anyone already here (same email) is skipped.</p>
        <div className="row2">
          <${Field} label="Where they came from"><select value=${board} onChange=${e => setBoard(e.target.value)}>${boards.map(b => html`<option key=${b}>${b}</option>`)}</select><//>
          ${jobSelect}
        </div>
        <div className="drop">
          <p>Drop the resumes here, or choose them.<br /><small className="muted">PDF, Word (.docx) or text, up to 10 MB each.</small></p>
          <label className="btn ghost"><${Icon} n="up" />${busy ? `Reading… ${Math.round(prog * 100)}%` : 'Choose resumes'}<input type="file" multiple accept=".pdf,.docx,.txt" style=${{ display: 'none' }} disabled=${busy} onChange=${e => { uploadFiles(e.target.files); e.target.value = ''; }} /></label>
        </div>
      </div>`
    }
    ${
      tab === 'paste' &&
      html`<div className="form" style=${{ marginTop: 12 }}>
        <p className="muted small" style=${{ margin: 0 }}>Copy a profile from a job-board page (or a resume from an email) and paste it here. ${ai ? 'The assistant reads it into a candidate.' : 'Put the name on the first line; email, phone, title, skills and location are picked up from the text.'}</p>
        <div className="row2">
          <${Field} label="Where it came from"><select value=${board} onChange=${e => setBoard(e.target.value)}>${boards.map(b => html`<option key=${b}>${b}</option>`)}</select><//>
          ${jobSelect}
        </div>
        <${Field} label="Profile or resume text"><textarea rows="12" value=${text} onInput=${e => setText(e.target.value)} placeholder="Name&#10;Title · Location&#10;email · phone&#10;Summary, experience, skills…" /><//>
      </div>`
    }
    ${
      res &&
      html`<div className="stack" style=${{ gap: 8, marginTop: 12 }}>
        ${res.added.length > 0 && html`<div className="note ok"><span><b>Added:</b> ${res.added.map(a => a.n + (a.ti ? ' (' + a.ti + ')' : '')).join(', ')}</span></div>`}
        ${res.skipped.length > 0 && html`<div className="note amber"><span><b>Skipped:</b> ${res.skipped.join(' · ')}</span></div>`}
      </div>`
    }
  <//>`;
}
/* ---------------- Requisitions ---------------- */
const Q_TYPES = [['text', 'Short answer'], ['yesno', 'Yes / No'], ['select', 'Pick one'], ['number', 'Number']];
function RequisitionModal({ row, S, onClose, onSaved, tpl, onOpenReq }) {
  const P = usePortal();
  const A = P.admin;
  const toast = useToast();
  // v37.2: a new requisition can start from a template (its posting, questions, pipeline and pay)
  const pub0 = (row && row.pub) || (tpl && tpl.pub) || {};
  const job0 = (row && row.job) || (tpl && tpl.job) || {};
  const [tab, setTab] = useState('post');
  const [pub, setPub] = useState({ ti: '', loc: '', ty: 'C2C', md: 'Onsite', sk: '', d: '', open: true, qs: [], eeo: !!S.eeo, visa: '', ...pub0 });
  const [j, setJ] = useState({ dept: '', openings: 1, status: 'open', priority: 'normal', client: '', team: { rec: P.uid, coord: '', hm: '', sales: '', intv: [] }, stages: stagesOf(job0), attrs: S.attrs || [], kit: {}, ko: {}, pay: { min: '', max: '', cur: 'USD', per: 'hour' }, bill: { rate: '', per: 'hour' }, approvals: [], internal: false, notes: '', tags: [], ...job0, team: { rec: P.uid, coord: '', hm: '', sales: '', intv: [], ...(job0.team || {}) }, pay: { min: '', max: '', cur: 'USD', per: 'hour', ...(job0.pay || {}) }, bill: { rate: '', per: 'hour', ...(job0.bill || {}) } });
  const [busy, setBusy] = useState(false);
  const [dupes, setDupes] = useState(null);
  const [tagsText, setTagsText] = useState((job0.tags || []).join(', '));
  const upP = k => e => setPub({ ...pub, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const upJ = k => e => setJ({ ...j, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const staff = staffOf(A);
  const shut = ['draft', 'closed', 'filled'].includes(j.status);
  // v37.2: saved on the server, which keeps what other parts of the portal store on the posting (the Dice record, share
  // counts, the job code) and holds back a requisition that looks like one already open
  const save = async force => {
    if (!pub.ti.trim()) return toast('Add a job title.', true);
    setBusy(true);
    setDupes(null);
    try {
      const P1 = {};
      ['ti', 'loc', 'ty', 'md', 'sk', 'd', 'open', 'internal', 'eeo', 'visa', 'boards', 'rate', 'dur', 'exp'].forEach(k => {
        if (pub[k] !== undefined) P1[k] = pub[k];
      });
      P1.ti = pub.ti.trim();
      P1.qs = (pub.qs || []).filter(q => q.q && q.q.trim()).map(q => ({ ...q, id: q.id || nid().slice(0, 8), opts: q.type === 'select' ? String(q.opts || '').split('|').map(x => x.trim()).filter(Boolean).join('|') : '' }));
      const J1 = {};
      ['dept', 'openings', 'status', 'priority', 'client', 'team', 'attrs', 'kit', 'ko', 'pay', 'bill', 'approvals', 'internal', 'notes', 'sla', 'tags', 'ec', 'vendor', 'reqBy'].forEach(k => {
        if (j[k] !== undefined) J1[k] = j[k];
      });
      J1.stages = (j.stages || []).filter(s => s.k && s.n);
      J1.tags = tagsText.split(',').map(x => x.trim()).filter((x, i, a) => x && a.indexOf(x) === i).slice(0, 12);
      const r = await api('ats_req_save', { id: row ? row.id : '', pub: P1, job: J1, force: !!force, tpl: !row && tpl ? tpl.id : '' });
      toast(row ? 'Requisition saved.' : 'Requisition ' + r.code + ' created' + (r.pub && r.pub.open !== false ? ' and listed on the careers page.' : ' (not on the careers page yet).'));
      onSaved && onSaved(r.id, r);
      onClose();
    } catch (e) {
      if (e && e.code === 'duplicate' && Array.isArray(e.dupes)) {
        setDupes(e.dupes);
        setTab('post');
      } else toast(errText(e), true);
    }
    setBusy(false);
  };
  const setStatus = v => {
    setJ({ ...j, status: v });
    if (['draft', 'closed', 'filled'].includes(v)) setPub(p => ({ ...p, open: false }));
    else if (v === 'open' && shut) setPub(p => ({ ...p, open: true }));
  };
  const setStageSet = id => {
    const set = (S.stageSets || []).find(s => s.id === id);
    if (set) setJ({ ...j, stages: set.stages.map(s => ({ ...s })) });
  };
  const upStage = (i, patch) => setJ({ ...j, stages: j.stages.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const qs = pub.qs || [];
  const upQ = (i, patch) => setPub({ ...pub, qs: qs.map((q, k) => (k === i ? { ...q, ...patch } : q)) });
  const approve = async (i, ok) => {
    const ap = j.approvals.map((a, k) => (k === i ? { ...a, st: ok ? 'approved' : 'declined', at: Date.now() } : a));
    setJ({ ...j, approvals: ap });
  };
  const tabs = [['post', 'Posting'], ['team', 'Hiring'], ['pipe', 'Pipeline'], ['qs', 'Screening'], ['card', 'Scorecard'], ['ok', `Approvals${j.approvals.length ? ' · ' + j.approvals.filter(a => a.st === 'approved').length + '/' + j.approvals.length : ''}`]];
  return html`<${Modal} wide title=${row ? (pub0.code ? pub0.code + ' · ' : '') + pub0.ti : tpl ? 'New requisition from "' + tpl.n + '"' : 'New requisition'} onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Cancel</button><button className="btn" disabled=${busy} onClick=${() => save(false)}>${busy ? 'Saving…' : row ? 'Save' : pub.open !== false ? 'Create and post' : 'Create'}</button>`}>
      <div className="stack">
        ${
          dupes &&
          html`<div className="note warn jdupes"><div className="stack" style=${{ gap: 6 }}>
              <b>${dupes.length === 1 ? 'A requisition like this one is already open' : dupes.length + ' requisitions like this one are already open'}</b>
              ${dupes.map(x => html`<div key=${x.id} className="small"><code>${x.code}</code> ${x.ti}${x.loc ? ' · ' + x.loc : ''}${x.client ? ' · ' + x.client : ''} · ${x.open ? 'open' : x.st} · ${fmtDay(x.at)} <span className="muted">(${x.why})</span>${onOpenReq ? html` <a href="#" onClick=${e => { e.preventDefault(); onClose(); onOpenReq(x.id); }}>Open it</a>` : null}</div>`)}
              <div className="actions"><button type="button" className="btn sm" disabled=${busy} onClick=${() => save(true)}>Create it anyway</button><button type="button" className="btn ghost sm" onClick=${() => setDupes(null)}>Change it</button></div>
            </div></div>`
        }
        <${KitTabs} tabs=${tabs} tab=${tab} onTab=${setTab} wrap />
        ${
          tab === 'post' &&
          html`<div className="form">
              <${Field} label="Job title"><input value=${pub.ti} onInput=${upP('ti')} placeholder="e.g. Senior Network Engineer" /><//>
              <div className="row3">
                <${Field} label="Location"><input value=${pub.loc} onInput=${upP('loc')} placeholder="Somerset, NJ" /><//>
                <${Field} label="Type"><select value=${pub.ty} onChange=${upP('ty')}>${['C2C', 'W2 contract', 'Full-time', 'Contract-to-hire', 'Part-time', 'Internship'].map(t => html`<option key=${t}>${t}</option>`)}</select><//>
                <${Field} label="Work mode"><select value=${pub.md} onChange=${upP('md')}>${['Onsite', 'Hybrid', 'Remote'].map(t => html`<option key=${t}>${t}</option>`)}</select><//>
              </div>
              <div className="row2">
                <${Field} label="Must-have skills" hint="Comma separated; drives matching and the fit score."><input value=${pub.sk} onInput=${upP('sk')} /><//>
                <${Field} label="Work authorization accepted"><input value=${pub.visa || ''} onInput=${upP('visa')} placeholder="e.g. USC/GC only, or Any" /><//>
              </div>
              <${Field} label="Job boards" hint="Which boards' feeds carry this job (Admin › Sourcing connections). None ticked: every board.">
                <div className="portalpicks wide">${[['indeed', 'Indeed'], ['dice', 'Dice'], ['ziprecruiter', 'ZipRecruiter'], ['jooble', 'Jooble'], ['linkedin', 'LinkedIn'], ['glassdoor', 'Glassdoor'], ['talent', 'Talent.com'], ['adzuna', 'Adzuna']].map(([k, n]) => html`<label key=${k} className=${'pick' + ((pub.boards || []).includes(k) ? ' on' : '')}><input type="checkbox" checked=${(pub.boards || []).includes(k)} onChange=${e => setPub({ ...pub, boards: e.target.checked ? [...(pub.boards || []), k] : (pub.boards || []).filter(x => x !== k) })} /><span>${n}</span></label>`)}</div>
              <//>
              <${Field} label="Description"><div className="aibar"><${AiWrite} kind="job" value=${pub.d} ctx=${{ title: pub.ti, location: pub.loc, type: pub.ty, mode: pub.md, skills: pub.sk, authorization: pub.visa || '' }} onUse=${t => setPub({ ...pub, d: t })} /></div><textarea value=${pub.d} onInput=${upP('d')} style=${{ minHeight: 160 }} /><//>
              <div className="row2">
                <label className="check"><input type="checkbox" checked=${pub.open !== false} disabled=${shut} onChange=${upP('open')} /><span>Open: listed on the Careers page and accepting applications${shut ? html` <span className="muted">(set the status to Open first, under Hiring)</span>` : null}</span></label>
                <label className="check"><input type="checkbox" checked=${!!pub.internal} onChange=${upP('internal')} /><span>Internal only (not listed and never sent to job boards; shareable by direct link)</span></label>
              </div>
              <label className="check"><input type="checkbox" checked=${!!pub.eeo} onChange=${upP('eeo')} /><span>Ask applicants the voluntary EEO self-identification questions (reported in aggregate only, never on a candidate)</span></label>
              ${row && html`<p className="muted small">${pub0.code ? html`Short link: <code>${jobShort(pub0.code, '')}</code> · ` : null}Careers link: <code>${location.origin + location.pathname}#/careers/${row.id}</code> · the requisition page has links per channel, a QR code and your referral link.</p>`}
            </div>`
        }
        ${
          tab === 'team' &&
          html`<div className="form">
              <div className="row3">
                <${Field} label="Department"><input value=${j.dept || ''} onInput=${upJ('dept')} list="ats-depts" /><datalist id="ats-depts">${['Delivery', 'Recruiting', 'HR', 'Accounts', 'Administration', 'Client project'].map(d => html`<option key=${d} value=${d} />`)}</datalist><//>
                <${Field} label="Openings"><input type="number" min="1" value=${j.openings || 1} onInput=${upJ('openings')} /><//>
                <${Field} label="Status"><select value=${j.status || 'open'} onChange=${e => setStatus(e.target.value)}>${[['draft', 'Draft'], ['open', 'Open'], ['hold', 'On hold'], ['filled', 'Filled'], ['closed', 'Closed']].map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select><//>
              </div>
              <div className="row3">
                <${Field} label="Priority"><select value=${j.priority || 'normal'} onChange=${upJ('priority')}>${[['urgent', 'Urgent'], ['high', 'High'], ['normal', 'Normal'], ['low', 'Low']].map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select><//>
                <${Field} label="Client (for a placement)"><select value=${j.client || ''} onChange=${upJ('client')}><option value="">— internal —</option>${((A && A.clients) || []).map(cl => html`<option key=${cl.id} value=${cl.id}>${cl.n}</option>`)}</select><//>
                <${Field} label="Pay range"><div className="actions" style=${{ flexWrap: 'nowrap' }}><input type="number" placeholder="min" value=${j.pay.min} onInput=${e => setJ({ ...j, pay: { ...j.pay, min: e.target.value } })} /><input type="number" placeholder="max" value=${j.pay.max} onInput=${e => setJ({ ...j, pay: { ...j.pay, max: e.target.value } })} /><select value=${j.pay.per} onChange=${e => setJ({ ...j, pay: { ...j.pay, per: e.target.value } })} style=${{ width: 90 }}><option value="hour">/hr</option><option value="year">/yr</option></select></div><//>
              </div>
              <div className="row3">
                <${Field} label="Bill rate (client)" hint="For the margin on the requisition page."><div className="actions" style=${{ flexWrap: 'nowrap' }}><input type="number" min="0" placeholder="rate" value=${j.bill.rate} onInput=${e => setJ({ ...j, bill: { ...j.bill, rate: e.target.value } })} /><select value=${j.bill.per} onChange=${e => setJ({ ...j, bill: { ...j.bill, per: e.target.value } })} style=${{ width: 90 }}><option value="hour">/hr</option><option value="year">/yr</option></select></div><//>
                <div style=${{ gridColumn: 'span 2' }}><${Field} label="Tags" hint="Comma separated, e.g. hot, local only, exclusive"><input value=${tagsText} onInput=${e => setTagsText(e.target.value)} /><//></div>
              </div>
              <div className="row2">
                <${Field} label="Recruiter (owner)"><select value=${j.team.rec || ''} onChange=${e => setJ({ ...j, team: { ...j.team, rec: e.target.value } })}><option value="">—</option>${staff.map(m => html`<option key=${m.id} value=${m.id}>${m.u.p.n}</option>`)}</select><//>
                <${Field} label="Hiring manager"><select value=${j.team.hm || ''} onChange=${e => setJ({ ...j, team: { ...j.team, hm: e.target.value } })}><option value="">—</option>${staff.map(m => html`<option key=${m.id} value=${m.id}>${m.u.p.n}</option>`)}</select><//>
              </div>
              <div className="row2">
                <${Field} label="Coordinator"><select value=${j.team.coord || ''} onChange=${e => setJ({ ...j, team: { ...j.team, coord: e.target.value } })}><option value="">—</option>${staff.map(m => html`<option key=${m.id} value=${m.id}>${m.u.p.n}</option>`)}</select><//>
                <${Field} label="Sales credit (placements)"><select value=${j.team.sales || ''} onChange=${e => setJ({ ...j, team: { ...j.team, sales: e.target.value } })}><option value="">—</option>${staff.map(m => html`<option key=${m.id} value=${m.id}>${m.u.p.n}</option>`)}</select><//>
              </div>
              <${Field} label="Interview panel" hint="Preselected when scheduling interviews; each gets tasks from the automations."><div className="portalpicks wide">${staff.map(m => html`<label key=${m.id} className=${'pick' + ((j.team.intv || []).includes(m.id) ? ' on' : '')}><input type="checkbox" checked=${(j.team.intv || []).includes(m.id)} onChange=${e => setJ({ ...j, team: { ...j.team, intv: e.target.checked ? [...(j.team.intv || []), m.id] : (j.team.intv || []).filter(x => x !== m.id) } })} /><span>${m.u.p.n}</span></label>`)}</div><//>
              <${Field} label="Internal notes"><textarea value=${j.notes || ''} onInput=${upJ('notes')} placeholder="Budget, why the role is open, must-haves vs nice-to-haves" /><//>
            </div>`
        }
        ${
          tab === 'pipe' &&
          html`<div className="form">
              <${Field} label="Start from a pipeline template"><div className="seg">${(S.stageSets || []).map(s => html`<button key=${s.id} type="button" onClick=${() => setStageSet(s.id)}>${s.n}</button>`)}</div><//>
              <div className="tblwrap"><table className="tbl small"><thead><tr><th>Stage</th><th>Counts as</th><th>Key</th><th /></tr></thead><tbody>${(j.stages || []).map((s, i) => html`<tr key=${i}><td><input value=${s.n} onInput=${e => upStage(i, { n: e.target.value, k: s.k && !['hired', 'rejected'].includes(s.k) && !j.stages.some((x, k) => k !== i && x.k === s.k) ? s.k : slug(e.target.value) })} /></td><td><select value=${s.kind} onChange=${e => upStage(i, { kind: e.target.value })}>${ATS_KINDS.map(k => html`<option key=${k} value=${k}>${ATS_KIND_NAME[k]}</option>`)}</select></td><td><code>${s.k}</code></td><td className="r"><div className="actions" style=${{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}><button className="btn ghost icon sm" disabled=${i === 0} onClick=${() => { const a = [...j.stages]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; setJ({ ...j, stages: a }); }}><${Icon} n="up" /></button><button className="btn ghost icon sm" disabled=${i === j.stages.length - 1} onClick=${() => { const a = [...j.stages]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; setJ({ ...j, stages: a }); }}><${Icon} n="down" /></button><button className="btn ghost icon sm" disabled=${['hired', 'rejected'].includes(s.kind) && j.stages.filter(x => x.kind === s.kind).length === 1} onClick=${() => setJ({ ...j, stages: j.stages.filter((x, k) => k !== i) })}><${Icon} n="x" /></button></div></td></tr>`)}</tbody></table></div>
              <div><button className="btn ghost sm" onClick=${() => setJ({ ...j, stages: [...j.stages.slice(0, -2), { k: 'stage' + (j.stages.length + 1), n: 'New stage', kind: 'interview' }, ...j.stages.slice(-2)] })}><${Icon} n="plus" />Add a stage</button></div>
              <p className="muted small">"Counts as" groups custom stages for the board summary, the automations and the reports (an "Onsite" stage counts as Interview). Candidates already in a stage you rename keep their place.</p>
            </div>`
        }
        ${
          tab === 'qs' &&
          html`<div className="form">
              <p className="muted small" style=${{ margin: 0 }}>Questions asked on the Careers application. A knockout answer rejects the application automatically (with a polite note in the log); everything else just shows on the candidate.</p>
              ${qs.map((q, i) => html`<div key=${i} className="panel" style=${{ padding: 12 }}>
                  <div className="row3">
                    <div style=${{ gridColumn: 'span 2' }}><${Field} label=${'Question ' + (i + 1)}><input value=${q.q || ''} onInput=${e => upQ(i, { q: e.target.value })} placeholder="e.g. Are you authorized to work in the US without sponsorship?" /><//></div>
                    <${Field} label="Answer type"><select value=${q.type || 'text'} onChange=${e => upQ(i, { type: e.target.value })}>${Q_TYPES.map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select><//>
                  </div>
                  <div className="row3">
                    ${q.type === 'select' ? html`<${Field} label="Choices (separate with |)"><input value=${q.opts || ''} onInput=${e => upQ(i, { opts: e.target.value })} placeholder="0-2 years | 3-5 years | 6+ years" /><//>` : html`<div />`}
                    <${Field} label="Knockout" hint=${q.type === 'number' ? 'Reject below this number' : q.type === 'yesno' ? 'Reject unless the answer is' : q.type === 'select' ? 'Reject unless they pick' : 'Reject unless the answer contains'}>
                      ${q.type === 'yesno' ? html`<select value=${j.ko[q.id] || ''} onChange=${e => setJ({ ...j, ko: { ...j.ko, [q.id]: e.target.value } })}><option value="">No knockout</option><option value="yes">Yes</option><option value="no">No</option></select>` : html`<input value=${j.ko[q.id] || ''} onInput=${e => setJ({ ...j, ko: { ...j.ko, [q.id]: e.target.value } })} placeholder="leave blank for no knockout" />`}
                    <//>
                    <div className="actions" style=${{ alignSelf: 'end', paddingBottom: 10 }}><label className="check"><input type="checkbox" checked=${q.req !== false} onChange=${e => upQ(i, { req: e.target.checked })} /><span>Required</span></label><button className="btn ghost sm" onClick=${() => setPub({ ...pub, qs: qs.filter((x, k) => k !== i) })}>Remove</button></div>
                  </div>
                </div>`)}
              <div><button className="btn ghost sm" onClick=${() => setPub({ ...pub, qs: [...qs, { id: nid().slice(0, 8), q: '', type: 'yesno', req: true }] })}><${Icon} n="plus" />Add a question</button></div>
            </div>`
        }
        ${
          tab === 'card' &&
          html`<div className="form">
              <${Field} label="Scorecard attributes (one per line)" hint="What every interviewer rates 1–4 for this job."><textarea value=${(j.attrs || []).join('\n')} onInput=${e => setJ({ ...j, attrs: e.target.value.split('\n').map(x => x.trim()).filter(Boolean) })} style=${{ minHeight: 120 }} /><//>
              ${(j.stages || []).filter(s => ['screen', 'interview'].includes(s.kind)).map(s => html`<${Field} key=${s.k} label=${'Interview kit: ' + s.n} hint="Questions the interviewer sees while filling in the scorecard (one per line)."><textarea value=${((j.kit || {})[s.k] || (S.kits || {})[s.kind] || []).join('\n')} onInput=${e => setJ({ ...j, kit: { ...(j.kit || {}), [s.k]: e.target.value.split('\n').map(x => x.trim()).filter(Boolean) } })} /><//>`)}
            </div>`
        }
        ${
          tab === 'ok' &&
          html`<div className="form">
              <p className="muted small" style=${{ margin: 0 }}>Who signs off on opening this requisition (budget owner, hiring manager, leadership). Approvers approve from here; the posting can stay in Draft until everyone has.</p>
              ${(j.approvals || []).map((a, i) => html`<div key=${i} className="actions"><select value=${a.uid} onChange=${e => setJ({ ...j, approvals: j.approvals.map((x, k) => (k === i ? { ...x, uid: e.target.value } : x)) })}>${staff.map(m => html`<option key=${m.id} value=${m.id}>${m.u.p.n}</option>`)}</select><${Chip} s=${a.st === 'approved' ? 'ok' : a.st === 'declined' ? 'red' : ''}>${a.st || 'pending'}<//>${a.at && html`<span className="muted small">${fmtTs(a.at)}</span>`}${a.uid === P.uid && a.st !== 'approved' && html`<button className="btn sm" onClick=${() => approve(i, true)}>Approve</button>`}${a.uid === P.uid && a.st !== 'declined' && html`<button className="btn ghost sm" onClick=${() => approve(i, false)}>Decline</button>`}<button className="btn ghost sm" onClick=${() => setJ({ ...j, approvals: j.approvals.filter((x, k) => k !== i) })}>Remove</button></div>`)}
              <div><button className="btn ghost sm" onClick=${() => setJ({ ...j, approvals: [...(j.approvals || []), { uid: (staff[0] || {}).id || '', st: 'pending' }] })}><${Icon} n="plus" />Add an approver</button></div>
            </div>`
        }
      </div>
    <//>`;
}
function JobsTab({ rows, reload, S, onCandidates, onOpenReq, onEdit, onNew }) {
  const P = usePortal();
  const A = P.admin;
  const toast = useToast();
  const [showClosed, setShowClosed] = useState(false);
  const [q, setQ] = useState('');
  const [mine, setMine] = useState(false);
  const [tpls, setTpls] = useState(false);
  if (!rows) return html`<${Spinner} />`;
  const ql = q.trim().toLowerCase();
  const cl = r => (r.job.client && A ? (A.clientsById[r.job.client] || {}).n || '' : '');
  // v37.2: drafts and jobs on hold stay in the list; closed and filled ones show on request
  const list = rows.filter(r => (showClosed || !['closed', 'filled'].includes(jobState(r))) && (!ql || [r.pub.code, r.pub.ti, r.pub.loc, r.job.dept, cl(r), nameIn(A, (r.job.team || {}).rec), (r.job.tags || []).join(' ')].join(' ').toLowerCase().includes(ql)) && (!mine || (r.job.team || {}).rec === P.uid || (r.job.assign || []).some(a => a.uid === P.uid)));
  const clone = async r => {
    try {
      const x = await api('ats_req_clone', { id: r.id });
      toast('Copied as ' + x.code + ': a draft, not on the careers page until you open it.');
      reload();
      onOpenReq(x.id);
    } catch (e) {
      toast(errText(e), true);
    }
  };
  return html`<div className="stack">
      <div className="toolbar">
        <input type="search" value=${q} onInput=${e => setQ(e.target.value)} placeholder="Code, title, client, place, recruiter or tag" style=${{ maxWidth: 300 }} aria-label="Find a requisition" />
        <label className="check small"><input type="checkbox" checked=${mine} onChange=${e => setMine(e.target.checked)} /><span>Mine (recruiter or assigned)</span></label>
        <label className="check small"><input type="checkbox" checked=${showClosed} onChange=${e => setShowClosed(e.target.checked)} /><span>Show closed and filled</span></label>
        <div className="push"><button type="button" className="btn ghost" onClick=${() => setTpls(true)}><${Icon} n="star" />Templates</button><a className="btn ghost" href="#/portal/admin/ads">Advertise</a><button className="btn" onClick=${onNew}><${Icon} n="plus" />New requisition</button></div>
      </div>
      ${
        list.length
          ? html`<div className="tblwrap"><table className="tbl">
              <thead><tr><th>Code</th><th>Requisition</th><th>Status</th><th>Team</th><th>Pipeline</th><th className="r">Openings</th><th>Posted</th><th /></tr></thead>
              <tbody>${list.map(r => { const c = r.counts || {}; const s = jobState(r); const asg = (r.job.assign || []).length; return html`<tr key=${r.id}>
                  <td className="nw"><code>${r.pub.code || '—'}</code></td>
                  <td><a href="#" className="jlink" onClick=${e => { e.preventDefault(); onOpenReq(r.id); }}><b>${r.pub.ti}</b></a>${r.job.priority === 'urgent' || r.job.priority === 'high' ? html` <${Chip} s=${r.job.priority === 'urgent' ? 'red' : 'amber'}>${r.job.priority}<//>` : null}<div className="muted small">${[r.pub.loc, r.pub.ty, r.pub.md, r.job.dept, cl(r)].filter(Boolean).join(' · ')}</div>${r.job.approvals && r.job.approvals.length ? html`<div className="small">Approvals ${r.job.approvals.filter(a => a.st === 'approved').length}/${r.job.approvals.length}</div>` : null}</td>
                  <td><${Chip} s=${jobStTone(s)}>${s}<//>${r.pub.internal ? html` <${Chip}>internal<//>` : null}</td>
                  <td className="small">${r.job.team && r.job.team.rec ? html`<div>Recruiter: ${nameIn(A, r.job.team.rec)}</div>` : null}${r.job.team && r.job.team.hm ? html`<div>Manager: ${nameIn(A, r.job.team.hm)}</div>` : null}${asg ? html`<div className="muted">${asg} assigned</div>` : null}</td>
                  <td className="small">${c.total ? html`<span><b>${c.active}</b> active · ${c.new || 0} new · ${c.screen || 0} screening · ${c.interview || 0} interview · ${c.offer || 0} offer · ${c.hired || 0} hired</span>` : html`<span className="muted">No candidates yet</span>`}</td>
                  <td className="r num">${r.job.filled || 0} / ${r.job.openings || 1}</td>
                  <td className="num small">${fmtDay(r.pub.at)}</td>
                  <td className="r"><div className="actions" style=${{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}><button className="btn ghost sm" onClick=${() => onOpenReq(r.id)}>Open</button><button className="btn ghost sm" onClick=${() => onCandidates(r.id)}>Pipeline</button><button className="btn ghost sm" onClick=${() => onEdit(r)}>Edit</button><button className="btn ghost sm" onClick=${() => clone(r)} title="A draft copy with a new code">Copy</button><a className="btn ghost sm" href=${'#/careers/' + r.id} target="_blank" rel="noopener" title="The public posting"><${Icon} n="globe" /></a></div></td>
                </tr>`; })}</tbody>
            </table></div>`
          : html`<${Empty} title=${q || mine ? 'No requisition matches' : 'No open requisitions'} action=${html`<button className="btn" onClick=${onNew}>New requisition</button>`}>A requisition is a job with its hiring team, pipeline stages, screening questions and scorecard. Open ones are listed on the Careers page.<//>`
      }
      ${tpls && html`<${AtsTplPicker} manage onClose=${() => setTpls(false)} />`}
    </div>`;
}
/* ---------------- Pipeline board, list, pool, interviews, offers ---------------- */
function CandidateCard({ c, job, S, onOpen, selected, onSelect }) {
  const stage = stageOf(job, c.st);
  const sla = S.sla && S.sla[stage.kind];
  const d = daysSince(c.stAt || c.at);
  const late = activeKind(stage.kind) && sla && d > sla;
  const next = (c.intvs || []).filter(i => !i.cancelled && new Date(i.at) >= new Date()).sort((a, b) => a.at.localeCompare(b.at))[0];
  const recs = (c.cards || []).map(k => k.rec).filter(Boolean);
  return html`<div className=${'card click' + (selected ? ' sel' : '')} tabIndex="0" onClick=${() => onOpen(c.id)} onKeyDown=${e => { if (e.key === 'Enter') onOpen(c.id); }}>
      <div className="actions" style=${{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <b>${c.n}</b>
        ${onSelect && html`<input type="checkbox" checked=${selected} onClick=${e => e.stopPropagation()} onChange=${e => onSelect(c.id, e.target.checked)} aria-label="Select" />`}
      </div>
      <div className="muted small">${c.ti || c.jt || 'No role'}${c.loc ? ' · ' + c.loc : ''}</div>
      <${DomChips} dom=${c.dom} small max=${2} />
      <div className="actions" style=${{ marginTop: 6, justifyContent: 'space-between' }}>
        <${Stars} v=${c.rating} />
        <span className="actions" style=${{ gap: 4 }}>${c.ag && c.ag.risk && c.ag.risk.level === 'high' ? html`<span className="chip red" title=${(c.ag.risk.flags || []).map(f => f.t).join(' · ')}>risk</span>` : c.ag && c.ag.st === 'verified' ? html`<span className="chip ok" title="Verified by the screening agent">verified</span>` : null}<${ScoreChip} s=${c.score} />${recs.length ? html`<span className=${'chip ' + (REC_TONE[recs[recs.length - 1]] || '')} title="Latest scorecard">${recs.length} card${recs.length === 1 ? '' : 's'}</span>` : null}</span>
      </div>
      ${(c.tags || []).length > 0 && html`<div className="small" style=${{ marginTop: 4 }}>${c.tags.map(t => html`<span key=${t} className="chip" style=${{ marginRight: 4 }}>${t}</span>`)}</div>`}
      <div className=${'small ' + (late ? 'late' : 'muted')} style=${{ marginTop: 4 }}>${d}d in stage${late ? ` · over the ${sla}-day goal` : ''}</div>
      ${next && html`<div className="small" style=${{ marginTop: 2, color: 'var(--indigo-ink)' }}>${next.kind} ${fmtTs(new Date(next.at).getTime())}</div>`}
    </div>`;
}
function PipelineTab({ docs, jobsMap, S, jobId, setJobId, onOpen, bulk, onMail }) {
  const row = jobsMap[jobId];
  const job = row ? row.job : null;
  const cols = jobId ? stagesOf(job) : ATS_KINDS.map(k => ({ k, n: ATS_KIND_NAME[k], kind: k }));
  const [sel, setSel] = useState([]);
  const inCol = (c, col) => (jobId ? c.st === col.k : kindOf(jobsMap[c.job] && jobsMap[c.job].job, c.st) === col.k);
  const list = docs.filter(c => (!jobId || c.job === jobId) && (jobId || !c.pool || c.job));
  return html`<div className="stack">
      ${sel.length > 0 && html`<${BulkBar} ids=${sel} docs=${docs} jobsMap=${jobsMap} S=${S} onMail=${onMail} onDone=${() => { setSel([]); bulk(); }} />`}
      <div className="board">
        ${cols.map(col => {
          const cards = list.filter(c => inCol(c, col));
          return html`<div key=${col.k} className="col">
              <div className="col-h"><span>${col.n}</span><span className="chip">${cards.length}</span></div>
              ${cards.slice(0, 60).map(c => html`<${CandidateCard} key=${c.id} c=${c} job=${jobsMap[c.job] && jobsMap[c.job].job} S=${S} onOpen=${onOpen} selected=${sel.includes(c.id)} onSelect=${(id, on) => setSel(on ? [...sel, id] : sel.filter(x => x !== id))} />`)}
              ${cards.length > 60 && html`<div className="muted small" style=${{ padding: 10 }}>+${cards.length - 60} more (use the list)</div>`}
              ${!cards.length && html`<div className="muted small" style=${{ padding: 10 }}>Empty</div>`}
            </div>`;
        })}
      </div>
    </div>`;
}
/* ---------------- v36.4: Mail from the ATS ----------------
   One window for what goes out of the ATS: candidates' profiles (with their resumes) to a client, vendor or hiring
   manager; an email to candidates (each their own); or a message to anyone with resumes or files attached. It goes
   out from the person's own mailbox (My email) when connected, otherwise from the company mailbox (replies to them). */
const ATS_MAIL_MODES = [
  ['push', 'Send profiles', 'To a client, vendor or hiring manager, with their resumes'],
  ['cand', 'Email candidates', 'Each candidate gets their own email'],
  ['any', 'Write to anyone', 'Any address; attach resumes or files'],
];
/* the profiles as text: name and title, place, experience, work authorization, skills (contact details only when asked) */
function atsMailSummary(list, hide) {
  return list
    .map((c, i) => {
      const lines = [(list.length > 1 ? i + 1 + '. ' : '') + c.n + (c.ti ? ' – ' + c.ti : '')];
      const facts = [c.loc ? 'Location: ' + c.loc : '', c.exp ? 'Experience: ' + c.exp + ' years' : '', c.auth ? 'Work authorization: ' + c.auth : ''].filter(Boolean);
      if (facts.length) lines.push('   ' + facts.join(' · '));
      if (c.sk) lines.push('   Skills: ' + String(c.sk).replace(/\s+/g, ' ').slice(0, 300));
      if (!hide && (c.e || c.ph)) lines.push('   ' + [c.e ? 'Email: ' + c.e : '', c.ph ? 'Phone: ' + c.ph : ''].filter(Boolean).join(' · '));
      return lines.join('\n');
    })
    .join('\n\n');
}
/* addresses as chips, with suggestions from the people this person writes to */
function AtsAddrInput({ value, onChange, book, label, placeholder }) {
  const [t, setT] = useState('');
  const [focus, setFocus] = useState(false);
  const ok = e => /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(e);
  const add = raw => {
    const parts = String(raw).split(/[,;\s]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
    const good = parts.filter(ok);
    if (good.length) onChange([...value, ...good.filter(x => !value.includes(x))]);
    return parts.length === good.length;
  };
  const ql = t.trim().toLowerCase();
  const sugg = ql.length >= 1 ? (book || []).filter(x => !value.includes(x.e) && (x.e.includes(ql) || (x.n || '').toLowerCase().includes(ql))).slice(0, 6) : [];
  return html`<div className="atsaddr">
      <span className="lbl">${label}</span>
      <div className=${'atsaddrbox' + (focus ? ' on' : '')}>
        ${value.map(e => html`<span key=${e} className="chip">${e}<button type="button" aria-label=${'Remove ' + e} onClick=${() => onChange(value.filter(x => x !== e))}>×</button></span>`)}
        <input value=${t} placeholder=${value.length ? '' : placeholder} aria-label=${label} type="email" autoComplete="off"
          onFocus=${() => setFocus(true)} onBlur=${() => { setFocus(false); if (t.trim() && add(t)) setT(''); }}
          onInput=${e => { const v = e.target.value; if (/[,;]\s*$/.test(v)) { if (add(v)) setT(''); else setT(v); } else setT(v); }}
          onKeyDown=${e => { if ((e.key === 'Enter' || e.key === 'Tab') && t.trim()) { if (add(t)) { setT(''); if (e.key === 'Enter') e.preventDefault(); } } else if (e.key === 'Backspace' && !t && value.length) onChange(value.slice(0, -1)); }} />
      </div>
      ${focus && sugg.length > 0 && html`<div className="atsaddrsugg">${sugg.map(x => html`<button key=${x.e} type="button" onMouseDown=${e => { e.preventDefault(); add(x.e); setT(''); }}><b>${x.n || x.e}</b>${x.n ? html`<span>${x.e}</span>` : ''}</button>`)}</div>`}
    </div>`;
}
function AtsMailModal({ init, docs, jobsMap, jobRows, S, onClose, onSent }) {
  const P = usePortal();
  const toast = useToast();
  const me = (P.prof && P.prof.n) || (Cap.me && Cap.me.name) || '';
  const [mode, setMode] = useState((init && init.mode) || 'push');
  const extra = useRef({});
  ((init && init.cands) || []).forEach(c => (extra.current[c.id] = c));
  const [ids, setIds] = useState(() => [...new Set([...((init && init.ids) || []), ...((init && init.cands) || []).map(c => c.id)])]);
  const [find, setFind] = useState('');
  const [info, setInfo] = useState(null);
  const [to, setTo] = useState([]);
  const [cc, setCc] = useState([]);
  const [job, setJob] = useState((init && init.job) || '');
  const [attach, setAttach] = useState(true);
  const [hide, setHide] = useState(true);
  const [via, setVia] = useState('box');
  const [tpl, setTpl] = useState('screen');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [edited, setEdited] = useState(false);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const max = (info && info.max) || 25;
  useEffect(() => {
    api('ats_mail_info', {}).then(setInfo, e => toast(errText(e), true));
  }, []);
  const byId = id => docs.find(c => c.id === id) || extra.current[id] || null;
  const cands = ids.map(byId).filter(Boolean);
  const jobRow = (jobRows || []).find(r => r.id === job);
  const jobT = jobRow ? jobRow.pub.ti : cands.length && cands.every(c => c.jt && c.jt === cands[0].jt) ? cands[0].jt : '';
  const withResume = cands.filter(c => c.rid).length;
  // the subject and message write themselves from the candidates until the person changes them
  const auto = () => {
    if (mode === 'push') {
      const one = cands.length === 1;
      return {
        s: !cands.length ? '' : one ? cands[0].n + (cands[0].ti || jobT ? ' – ' + (cands[0].ti || jobT) : '') : cands.length + ' profiles' + (jobT ? ' for ' + jobT : ''),
        b: 'Hello,\n\nPlease find ' + (one ? 'the profile' : 'the profiles') + ' below' + (jobT ? ' for the ' + jobT + ' role' : '') + '.' + (attach && withResume ? (withResume === 1 && one ? ' The resume is attached.' : ' Resumes are attached.') : '') + '\n\n' + (cands.length ? atsMailSummary(cands, hide) : '[add the candidates above]') + '\n\nLet me know if you would like to set up ' + (one ? 'an interview.' : 'interviews with any of them.') + '\n\nThanks,\n' + me,
      };
    }
    if (mode === 'cand') {
      const t = ((S && S.templates) || {})[tpl] && S.templates[tpl].s ? S.templates[tpl] : ATS_TEMPLATES[tpl] || ATS_TEMPLATES.screen;
      // {name} in the templates is the first name; each candidate gets theirs
      const fix = x => String(x || '').replace(/\{name\}/g, '{first}').replace(/\{date\}/g, '[date and time]');
      return { s: fix(t.s), b: fix(t.b) };
    }
    return { s: '', b: 'Hello,\n\n\n\nThanks,\n' + me };
  };
  useEffect(() => {
    if (edited) return;
    const a = auto();
    setSubject(a.s);
    setBody(a.b);
  }, [mode, ids.join(','), job, attach, hide, tpl, !!info]);
  const pickMode = m => {
    setMode(m);
    setEdited(false);
  };
  const ql = find.trim().toLowerCase();
  const found = ql.length >= 2 ? docs.filter(c => !ids.includes(c.id) && [c.n, c.e, c.ti, c.sk, c.loc].filter(Boolean).join(' ').toLowerCase().includes(ql)).slice(0, 8) : [];
  const noEmail = mode === 'cand' ? cands.filter(c => !/^\S+@\S+\.\S+$/.test(c.e || '')) : [];
  const box = info && info.box;
  const send = async () => {
    if (mode !== 'cand' && !to.length) return toast('Add who it goes to.', true);
    if (mode !== 'any' && !cands.length) return toast('Add the candidates.', true);
    if (!subject.trim() || !body.trim()) return toast('Add a subject and a message.', true);
    setBusy(true);
    try {
      const fd = new FormData();
      const vals = { mode, ids: JSON.stringify(ids), to: to.join(','), cc: cc.join(','), job, subject, body, attach: attach ? '1' : '', via: box && via === 'box' ? 'box' : 'portal' };
      Object.entries(vals).forEach(([k, v]) => fd.append(k, v));
      if (mode === 'any') files.forEach(f => fd.append('file[]', f, f.name));
      const r = await upload('ats_mail', fd, null, { timeout: 180000 });
      const from = r.via === 'company mailbox' ? 'from the company mailbox' : 'from ' + r.via;
      if (mode === 'cand') toast(r.sent + ' email' + (r.sent === 1 ? '' : 's') + ' sent ' + from + (r.skipped && r.skipped.length ? '; ' + r.skipped.length + ' without an email address' : '') + (r.failed && r.failed.length ? '; ' + r.failed.length + ' failed: ' + r.failed[0] : '') + '.', !!(r.failed && r.failed.length && !r.sent));
      else toast('Sent to ' + r.to.join(', ') + ' ' + from + (r.atts ? ' with ' + r.atts + ' attachment' + (r.atts === 1 ? '' : 's') : '') + '.');
      onSent && onSent();
      onClose();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const foot = html`<button className="btn ghost" onClick=${onClose}>Cancel</button><button className="btn" disabled=${busy || !info} onClick=${send}><${Icon} n="send" />${busy ? 'Sending…' : mode === 'cand' ? 'Send ' + (cands.length - noEmail.length || '') + ' email' + (cands.length - noEmail.length === 1 ? '' : 's') : 'Send'}</button>`;
  return html`<${Modal} wide title="Mail from the ATS" onClose=${onClose} foot=${foot}>
      <div className="stack atsmail" style=${{ gap: 12 }}>
        <div className="seg atsmailseg" role="group" aria-label="What to send">${ATS_MAIL_MODES.map(([k, n, d]) => html`<button key=${k} type="button" className=${mode === k ? 'on' : ''} title=${d} onClick=${() => pickMode(k)}>${n}</button>`)}</div>
        <p className="muted small" style=${{ margin: 0 }}>${(ATS_MAIL_MODES.find(x => x[0] === mode) || [])[2]}.</p>
        <div className="atsmailcands">
          <span className="lbl">${mode === 'any' ? 'Candidates (their resumes can be attached)' : 'Candidates'}</span>
          <div className="atsmailchips">
            ${cands.map(c => html`<span key=${c.id} className="chip">${c.n}${c.ti ? html`<i>${c.ti}</i>` : ''}${mode !== 'cand' && attach && !c.rid ? html`<i className="t-amber">no resume</i>` : ''}${mode === 'cand' && !/^\S+@\S+\.\S+$/.test(c.e || '') ? html`<i className="t-amber">no email</i>` : ''}<button type="button" aria-label=${'Remove ' + c.n} onClick=${() => setIds(ids.filter(x => x !== c.id))}>×</button></span>`)}
            ${ids.length < max && html`<span className="atsmailfind"><input value=${find} onInput=${e => setFind(e.target.value)} placeholder=${cands.length ? 'Add another…' : 'Find a candidate: name, title or skill'} aria-label="Add a candidate" />${found.length > 0 && html`<span className="atsaddrsugg">${found.map(c => html`<button key=${c.id} type="button" onClick=${() => { setIds([...ids, c.id]); setFind(''); }}><b>${c.n}</b><span>${[c.ti, c.loc].filter(Boolean).join(' · ')}</span></button>`)}</span>`}</span>`}
          </div>
        </div>
        ${
          mode !== 'cand' &&
          html`<div className="row2">
            <${AtsAddrInput} label="To" value=${to} onChange=${setTo} book=${info && info.book} placeholder=${mode === 'push' ? 'client@company.com' : 'name@company.com'} />
            <${AtsAddrInput} label="Cc (optional)" value=${cc} onChange=${setCc} book=${info && info.book} placeholder="" />
          </div>`
        }
        ${
          mode === 'cand' &&
          html`<div className="seg" role="group" aria-label="Template">${[['screen', 'Screening call'], ['interview', 'Interview'], ['offer', 'Offer'], ['rejected', 'Not selected'], ['blank', 'Blank']].map(([k, n]) => html`<button key=${k} type="button" className=${tpl === k ? 'on' : ''} onClick=${() => { setTpl(k); setEdited(false); if (k === 'blank') { setSubject(''); setBody('Hi {first},\n\n\n\nThanks,\n{me}'); setEdited(true); } }}>${n}</button>`)}</div>`
        }
        ${
          mode !== 'any' &&
          html`<${Field} label="Requisition (optional)" hint=${mode === 'push' ? 'Named in the message and kept with each candidate.' : 'Fills {job} in the message.'}><select value=${job} onChange=${e => setJob(e.target.value)}><option value="">${mode === 'cand' ? "Each candidate's own job" : '— none —'}</option>${(jobRows || []).map(r => html`<option key=${r.id} value=${r.id}>${r.pub.ti}${r.pub.open === false ? ' (closed)' : ''}</option>`)}</select><//>`
        }
        ${
          mode !== 'cand' &&
          html`<div className="atsmailopts">
            <label className="check"><input type="checkbox" checked=${attach} onChange=${e => setAttach(e.target.checked)} /><span>Attach their resumes${cands.length ? ' (' + withResume + ' of ' + cands.length + ' have one)' : ''}</span></label>
            ${mode === 'push' && html`<label className="check"><input type="checkbox" checked=${hide} onChange=${e => setHide(e.target.checked)} /><span>Leave out their email and phone</span></label>`}
          </div>`
        }
        <${Field} label="Subject"><input value=${subject} onInput=${e => { setSubject(e.target.value); setEdited(true); }} /><//>
        <${Field} label="Message" hint=${mode === 'cand' ? 'Placeholders: {first} (their first name), {name}, {job}, {me}. Each candidate gets their own email.' : mode === 'push' && !edited ? 'Written from the candidates; edit it as you like.' : ''}>
          <div className="aibar"><${SigButton} onInsert=${s => { setBody(sigAppend(body, s)); setEdited(true); }} /><${AiWrite} kind="email" value=${body} subject=${subject} ctx=${{ purpose: mode === 'push' ? 'send candidate profiles to a client' : mode === 'cand' ? 'email to candidates' : 'email', candidates: cands.map(c => c.n + (c.ti ? ' (' + c.ti + ')' : '')).join('; '), job: jobT }} onUse=${(t, s2) => { setBody(t); if (s2 && !subject.trim()) setSubject(s2); setEdited(true); }} /></div>
          <textarea value=${body} onInput=${e => { setBody(e.target.value); setEdited(true); }} style=${{ minHeight: 240 }} />
        <//>
        ${
          mode === 'any' &&
          html`<div className="actions" style=${{ justifyContent: 'flex-start', alignItems: 'center' }}>
            <label className="btn ghost sm idsaddbtn"><input type="file" multiple onChange=${e => { setFiles([...files, ...Array.from(e.target.files || [])].slice(0, 10)); e.target.value = ''; }} /><${Icon} n="file" />Attach files</label>
            ${files.map((f, i) => html`<span key=${i} className="chip">${f.name}<button type="button" className="atschipx" aria-label=${'Remove ' + f.name} onClick=${() => setFiles(files.filter((_, j) => j !== i))}>×</button></span>`)}
          </div>`
        }
        ${
          info &&
          html`<div className="atsmailvia">
            <span className="lbl">Send from</span>
            ${
              box
                ? html`<div className="seg" role="group" aria-label="Send from"><button type="button" className=${via === 'box' ? 'on' : ''} onClick=${() => setVia('box')}>Your mailbox (${box.email})</button><button type="button" className=${via !== 'box' ? 'on' : ''} onClick=${() => setVia('portal')}>The company mailbox</button></div>`
                : html`<span className="small muted">The company mailbox, with replies coming to you. <a href="#/portal/admin/mymail" onClick=${onClose}>Connect your own mailbox</a> (My email) to send from your address.</span>`
            }
          </div>`
        }
      </div>
    <//>`;
}
function BulkBar({ ids, docs, jobsMap, S, onDone, onMail }) {
  const toast = useToast();
  const [act, setAct] = useState('move');
  const [v, setV] = useState('');
  const [mail, setMail] = useState({ s: '', b: '' });
  const [busy, setBusy] = useState(false);
  const first = docs.find(c => c.id === ids[0]);
  const job = first && jobsMap[first.job] ? jobsMap[first.job].job : null;
  const sameJob = ids.every(id => (docs.find(c => c.id === id) || {}).job === (first || {}).job);
  const stages = sameJob ? stagesOf(job) : ATS_DEFAULT_STAGES;
  const run = async () => {
    setBusy(true);
    try {
      const body = act === 'move' ? { act: 'move', st: v, reason: '' } : act === 'reject' ? { act: 'move', st: stageKeyOfKind(sameJob ? job : null, 'rejected'), reason: v || 'Other' } : act === 'tag' ? { act: 'tag', tag: v } : act === 'pool' ? { act: 'pool' } : { act: 'email', subject: mail.s, body: mail.b };
      if ((act === 'move' || act === 'tag') && !v) return toast('Pick a value.', true);
      if (act === 'email' && (!mail.s || !mail.b)) return toast('Add a subject and a message.', true);
      const r = await api('ats_bulk', { ids, ...body });
      toast(`${r.n} candidate${r.n === 1 ? '' : 's'} updated.`);
      onDone();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<div className="panel" style=${{ padding: 10 }}>
      <div className="actions">
        <b>${ids.length} selected</b>
        ${onMail && html`<button className="btn sm" onClick=${() => onMail({ mode: 'push', ids: ids.slice(0, 25) })} title="Send their profiles to a client, email them, or write to anyone"><${Icon} n="mail" />Mail${ids.length > 25 ? ' (first 25)' : ''}</button>`}
        <select value=${act} onChange=${e => { setAct(e.target.value); setV(''); }}><option value="move">Move to stage</option><option value="reject">Reject</option><option value="tag">Add tag</option>${!onMail && html`<option value="email">Email</option>`}<option value="pool">Add to talent pool</option></select>
        ${act === 'move' && html`<select value=${v} onChange=${e => setV(e.target.value)}><option value="">Stage…</option>${stages.filter(s => s.kind !== 'hired').map(s => html`<option key=${s.k} value=${s.k}>${s.n}</option>`)}</select>`}
        ${act === 'reject' && html`<select value=${v} onChange=${e => setV(e.target.value)}>${(S.reject || ['Other']).map(r => html`<option key=${r}>${r}</option>`)}</select>`}
        ${act === 'tag' && html`<select value=${v} onChange=${e => setV(e.target.value)}><option value="">Tag…</option>${(S.tags || []).map(t => html`<option key=${t}>${t}</option>`)}</select>`}
        ${!sameJob && act === 'move' && html`<span className="muted small">Different jobs: only the standard stages apply.</span>`}
        <button className="btn sm" disabled=${busy} onClick=${run}>${busy ? 'Working…' : 'Apply'}</button>
        <button className="btn ghost sm" onClick=${onDone}>Clear</button>
      </div>
      ${act === 'email' && html`<div className="form" style=${{ marginTop: 10 }}><input placeholder="Subject ({first}, {job} work)" value=${mail.s} onInput=${e => setMail({ ...mail, s: e.target.value })} /><textarea placeholder="Message" value=${mail.b} onInput=${e => setMail({ ...mail, b: e.target.value })} style=${{ minHeight: 100 }} /></div>`}
    </div>`;
}
function CandidatesTab({ docs, jobsMap, S, jobId, onOpen, bulk, pool, onMail }) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState(pool ? 'all' : 'active');
  const [src, setSrc] = useState('');
  const [tag, setTag] = useState('');
  const [sort, setSort] = useState('u');
  const [sel, setSel] = useState([]);
  const toast = useToast();
  const test = useMemo(() => boolSearch(q), [q]);
  const list = docs
    .filter(c => (pool ? c.pool || !c.job : !pool && (!jobId || c.job === jobId)))
    .filter(c => {
      const k = kindOf(jobsMap[c.job] && jobsMap[c.job].job, c.st);
      return kind === 'all' || (kind === 'active' ? activeKind(k) : k === kind);
    })
    .filter(c => (!src || c.src === src) && (!tag || (c.tags || []).includes(tag)) && test(candText(c)))
    .sort((a, b) => (sort === 'score' ? ((b.score && b.score.v) || 0) - ((a.score && a.score.v) || 0) : sort === 'at' ? b.at - a.at : sort === 'n' ? String(a.n).localeCompare(String(b.n)) : (b.u || 0) - (a.u || 0)));
  const exportCsv = async () => {
    const res = await fetch(API + 'ats_export', { method: 'POST', headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'application/json' }, body: JSON.stringify({ job: jobId || '' }) });
    if (!res.ok) return toast('Could not export.', true);
    try {
      await saveDownload('candidates.csv', await res.blob());
    } catch (e) {
      if (!e || e.code !== 'declined') toast(errText(e), true);
    }
  };
  const scoreAll = async () => {
    if (!jobId) return toast('Pick a job first; scoring compares each candidate with that job.', true);
    try {
      const r = await api('ats_match', { job: jobId });
      toast(`${r.scored} candidates scored.`);
      bulk();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const all = list.map(c => c.id);
  return html`<div className="stack">
      <div className="toolbar">
        <input type="search" style=${{ maxWidth: 320 }} placeholder='Search: java AND (aws OR azure) NOT "staff aug"' value=${q} onInput=${e => setQ(e.target.value)} aria-label="Search candidates" />
        ${!pool && html`<select value=${kind} onChange=${e => setKind(e.target.value)} aria-label="Stage"><option value="active">Active</option>${ATS_KINDS.map(k => html`<option key=${k} value=${k}>${ATS_KIND_NAME[k]}</option>`)}<option value="all">All</option></select>`}
        <select value=${src} onChange=${e => setSrc(e.target.value)} aria-label="Source"><option value="">Any source</option>${[...new Set([...(S.sources || []), ...docs.map(c => c.src).filter(Boolean)])].map(s => html`<option key=${s}>${s}</option>`)}</select>
        <select value=${tag} onChange=${e => setTag(e.target.value)} aria-label="Tag"><option value="">Any tag</option>${[...new Set([...(S.tags || []), ...docs.flatMap(c => c.tags || [])])].map(t => html`<option key=${t}>${t}</option>`)}</select>
        <select value=${sort} onChange=${e => setSort(e.target.value)} aria-label="Sort"><option value="u">Recently changed</option><option value="at">Newest</option><option value="score">Best fit</option><option value="n">Name</option></select>
        <div className="push">
          ${!pool && html`<button className="btn ghost" onClick=${scoreAll} title="Fit score for every active candidate on the selected job"><${Icon} n="target" />Score all</button>`}
          <a className="btn ghost" href=${impHref('ats', jobId ? { job: jobId } : {})} title="A spreadsheet, checked row by row before anything is saved"><${Icon} n="up" />Import</a>
          <button className="btn ghost" onClick=${exportCsv}><${Icon} n="down" />Export</button>
        </div>
      </div>
      ${sel.length > 0 && html`<${BulkBar} ids=${sel} docs=${docs} jobsMap=${jobsMap} S=${S} onMail=${onMail} onDone=${() => { setSel([]); bulk(); }} />`}
      <section className="panel" style=${{ padding: '6px 8px' }}>
        ${
          list.length
            ? html`<div className="tblwrap"><table className="tbl">
                <thead><tr><th><input type="checkbox" checked=${sel.length > 0 && all.every(id => sel.includes(id))} onChange=${e => setSel(e.target.checked ? all : [])} aria-label="Select all" /></th><th>Candidate</th><th>Job</th><th>Stage</th><th>Fit</th><th>Rating</th><th>Source</th><th>Applied</th><th>In stage</th><th>Resume</th></tr></thead>
                <tbody>${list.slice(0, 400).map(c => { const job = jobsMap[c.job] && jobsMap[c.job].job; const stage = stageOf(job, c.st); const d = daysSince(c.stAt || c.at); const sla = S.sla && S.sla[stage.kind]; return html`<tr key=${c.id} className="click" tabIndex="0" onClick=${() => onOpen(c.id)}>
                    <td onClick=${e => e.stopPropagation()}><input type="checkbox" checked=${sel.includes(c.id)} onChange=${e => setSel(e.target.checked ? [...sel, c.id] : sel.filter(x => x !== c.id))} aria-label="Select" /></td>
                    <td><b style=${{ fontWeight: 600 }}>${c.n}</b>${c.ko ? html` <${Chip} s="red">KO<//>` : null}<div className="muted small">${[c.ti, c.loc, c.auth].filter(Boolean).join(' · ') || c.e}</div>${(c.tags || []).length ? html`<div className="small">${c.tags.map(t => html`<span key=${t} className="chip" style=${{ marginRight: 4 }}>${t}</span>`)}</div>` : null}</td>
                    <td className="small">${c.jt || html`<span className="muted">pool</span>`}</td>
                    <td><${Chip} s=${atsChip(stage.kind)}>${stage.n}<//></td>
                    <td><${ScoreChip} s=${c.score} /></td>
                    <td><${Stars} v=${c.rating} /></td>
                    <td className="small">${c.src || '—'}</td>
                    <td className="num small">${fmtDay(c.at)}</td>
                    <td className=${'num small ' + (activeKind(stage.kind) && sla && d > sla ? 'late' : '')}>${activeKind(stage.kind) ? d + 'd' : '—'}</td>
                    <td>${c.rid ? html`<a className="btn ghost sm" href=${fileUrl('ats/' + c.id, c.rid, true)} onClick=${e => e.stopPropagation()}><${Icon} n="down" /></a>` : html`<span className="muted small">—</span>`}</td>
                  </tr>`; })}</tbody>
              </table></div>`
            : html`<${Empty} title=${pool ? 'The talent pool is empty' : 'No candidates here'}>${pool ? 'People you want to keep for future roles: add them with "Keep in the talent pool", import a CSV, or tick "Add to talent pool" in a bulk action.' : 'Applications from the Careers page land here with their resume and screening answers; add sourced candidates or import a CSV.'}<//>`
        }
      </section>
    </div>`;
}
function InterviewsTab({ docs, jobsMap, onOpen }) {
  const P = usePortal();
  const A = P.admin;
  const [mine, setMine] = useState(false);
  const [past, setPast] = useState(false);
  const now = new Date();
  const rows = [];
  docs.forEach(c => (c.intvs || []).forEach(iv => { if (!iv.cancelled && (past ? new Date(iv.at) < now : new Date(iv.at) >= now) && (!mine || (iv.who || []).includes(P.uid))) rows.push({ c, iv }); }));
  rows.sort((a, b) => (past ? b.iv.at.localeCompare(a.iv.at) : a.iv.at.localeCompare(b.iv.at)));
  return html`<div className="stack">
      <div className="toolbar"><div className="seg"><button className=${!past ? 'on' : ''} onClick=${() => setPast(false)}>Upcoming</button><button className=${past ? 'on' : ''} onClick=${() => setPast(true)}>Past</button></div><label className="check small"><input type="checkbox" checked=${mine} onChange=${e => setMine(e.target.checked)} /><span>Only mine</span></label></div>
      ${
        rows.length
          ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>When</th><th>Candidate</th><th>Kind</th><th>Panel</th><th>Scorecards</th></tr></thead><tbody>${rows.slice(0, 200).map(({ c, iv }) => { const cards = (c.cards || []).filter(k => k.intv === iv.id); const missing = (iv.who || []).filter(u => !cards.some(k => k.by === u)); return html`<tr key=${c.id + iv.id} className="click" tabIndex="0" onClick=${() => onOpen(c.id)}><td className="nw">${fmtTs(new Date(iv.at).getTime())}<div className="muted small">${iv.dur} min${iv.where ? ' · ' + iv.where.slice(0, 40) : ''}</div></td><td><b>${c.n}</b><div className="muted small">${c.jt}</div></td><td>${iv.kind}</td><td className="small">${(iv.who || []).map(u => nameIn(A, u)).join(', ')}</td><td>${cards.map(k => html`<${Chip} key=${k.id} s=${REC_TONE[k.rec] || ''}>${k.byn.split(' ')[0]}<//>`)}${past && missing.length ? html`<span className=${'small ' + (missing.includes(P.uid) ? 'late' : 'muted')}>${missing.includes(P.uid) ? 'yours is due' : missing.length + ' missing'}</span>` : null}</td></tr>`; })}</tbody></table></div>`
          : html`<${Empty} title=${past ? 'No past interviews' : 'Nothing scheduled'}>Interviews are scheduled from a candidate's card; the panel gets a calendar invitation and a scorecard to fill in.<//>`
      }
    </div>`;
}
function OffersTab({ docs, jobsMap, onOpen }) {
  const rows = docs.filter(c => c.offer && c.offer.st).sort((a, b) => (b.offer.u || 0) - (a.offer.u || 0));
  return rows.length
    ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Candidate</th><th>Role</th><th>Pay</th><th>Start</th><th>Status</th><th>Expires</th></tr></thead><tbody>${rows.map(c => html`<tr key=${c.id} className="click" tabIndex="0" onClick=${() => onOpen(c.id)}><td><b>${c.n}</b></td><td>${c.offer.title || c.jt}<div className="muted small">${{ w2: 'W-2', w2c: 'W-2 contract', c2c: 'Corp-to-corp', 1099: '1099' }[c.offer.type] || ''}${c.offer.client ? ' · ' + c.offer.client : ''}</div></td><td className="num">${c.offer.pay ? fmtMoney(+c.offer.pay, c.offer.cur || 'USD') + '/' + (c.offer.per === 'hour' ? 'hr' : c.offer.per === 'year' ? 'yr' : c.offer.per) : '—'}</td><td className="num">${c.offer.start ? fmtDate(c.offer.start) : '—'}</td><td><${Chip} s=${c.offer.st === 'accepted' ? 'ok' : c.offer.st === 'declined' ? 'red' : 'new'}>${c.offer.st}<//></td><td className="num small">${c.offer.expires ? fmtDate(c.offer.expires) : '—'}</td></tr>`)}</tbody></table></div>`
    : html`<${Empty} title="No offers yet">Offers are drafted on the candidate's Offer tab: terms, an approver if needed, then the letter goes out for e-signature.<//>`;
}
/* ---------------- Reports ---------------- */
function Bar({ v, max, label, tone }) {
  const pct = max ? Math.round((v / max) * 100) : 0;
  return html`<div className="small" style=${{ display: 'grid', gridTemplateColumns: '150px 1fr 50px', gap: 8, alignItems: 'center' }}><span>${label}</span><div style=${{ background: 'var(--bg-2, #eef1f6)', borderRadius: 6, height: 12, overflow: 'hidden' }}><div style=${{ width: pct + '%', height: '100%', background: tone || 'var(--indigo)' }} /></div><b className="num r">${v}</b></div>`;
}
function ReportsTab({ onOpen }) {
  const P = usePortal();
  const A = P.admin;
  const toast = useToast();
  const [range, setRange] = useState({ from: `${new Date().getFullYear()}-01-01`, to: dkey() });
  const [d, setD] = useState(null);
  useEffect(() => {
    setD(null);
    api('ats_report', range).then(setD).catch(e => toast(errText(e), true));
  }, [range.from, range.to]);
  if (!d) return html`<${Spinner} />`;
  const f = d.funnel;
  const srcs = Object.entries(d.sources).sort((a, b) => b[1].n - a[1].n);
  return html`<div className="stack">
      <div className="toolbar"><span className="small">Applied between</span><input type="date" value=${range.from} onInput=${e => setRange({ ...range, from: e.target.value })} /><span className="small">and</span><input type="date" value=${range.to} onInput=${e => setRange({ ...range, to: e.target.value })} /></div>
      <${KitStats} items=${[{ v: f.applied, l: 'Applied' }, { v: f.hired, l: 'Hired', tone: 'ok' }, { v: d.tth.med != null ? d.tth.med + ' d' : '—', l: `Time to hire (median${d.tth.n ? ', ' + d.tth.n + ' hires' : ''})` }, { v: d.ttf.med != null ? d.ttf.med + ' d' : '—', l: 'Time to fill (posting to hire)' }, { v: d.offers.made ? Math.round((d.offers.accepted / d.offers.made) * 100) + '%' : '—', l: `Offer acceptance (${d.offers.accepted}/${d.offers.made})` }]} />
      <div className="g2" style=${{ alignItems: 'start' }}>
        <section className="panel stack">
          <h2 className="ph">Funnel</h2>
          ${[['applied', 'Applied'], ['screen', 'Screened'], ['interview', 'Interviewed'], ['offer', 'Offered'], ['hired', 'Hired']].map(([k, n]) => html`<${Bar} key=${k} v=${f[k]} max=${f.applied || 1} label=${n} tone=${k === 'hired' ? 'var(--teal, #0aa19c)' : undefined} />`)}
          <${Bar} v=${f.rejected} max=${f.applied || 1} label="Rejected" tone="var(--red, #b42318)" />
          <p className="muted small" style=${{ margin: 0 }}>Conversion: ${f.applied ? Math.round((f.screen / f.applied) * 100) : 0}% screened · ${f.screen ? Math.round((f.interview / f.screen) * 100) : 0}% of screened interviewed · ${f.interview ? Math.round((f.offer / f.interview) * 100) : 0}% of interviewed offered · ${f.offer ? Math.round((f.hired / f.offer) * 100) : 0}% of offers hired.</p>
        </section>
        <section className="panel stack">
          <h2 className="ph">Sources</h2>
          ${srcs.length ? html`<table className="tbl small"><thead><tr><th>Source</th><th className="r">Candidates</th><th className="r">Interviewed</th><th className="r">Hired</th><th className="r">Hire rate</th></tr></thead><tbody>${srcs.map(([s, x]) => html`<tr key=${s}><td>${s}</td><td className="r num">${x.n}</td><td className="r num">${x.interview}</td><td className="r num">${x.hired}</td><td className="r num">${x.n ? Math.round((x.hired / x.n) * 100) + '%' : '—'}</td></tr>`)}</tbody></table>` : html`<p className="muted small">No candidates in this period.</p>`}
        </section>
      </div>
      <div className="g2" style=${{ alignItems: 'start' }}>
        <section className="panel stack">
          <h2 className="ph">By job</h2>
          ${Object.keys(d.jobs).length ? html`<table className="tbl small"><thead><tr><th>Job</th><th className="r">Total</th><th className="r">Active</th><th className="r">Hired</th><th className="r">Rejected</th></tr></thead><tbody>${Object.entries(d.jobs).sort((a, b) => b[1].n - a[1].n).map(([j, x]) => html`<tr key=${j}><td>${j}</td><td className="r num">${x.n}</td><td className="r num">${x.active}</td><td className="r num">${x.hired}</td><td className="r num">${x.rejected}</td></tr>`)}</tbody></table>` : html`<p className="muted small">—</p>`}
        </section>
        <section className="panel stack">
          <h2 className="ph">Speed and load</h2>
          <table className="tbl small"><tbody>${Object.entries(d.stageAges || {}).map(([k, v]) => html`<tr key=${k}><td>Average days waiting in ${ATS_KIND_NAME[k] || k}</td><td className="r num">${v != null ? v : '—'}</td></tr>`)}</tbody></table>
          ${d.load.length > 0 && html`<${Fragment}><b className="small">Interviews per interviewer</b><table className="tbl small"><tbody>${d.load.slice(0, 10).map(x => html`<tr key=${x.uid}><td>${x.n}</td><td className="r num">${x.count}</td></tr>`)}</tbody></table><//>`}
        </section>
      </div>
      ${
        d.overdue.length > 0 &&
        html`<section className="panel stack">
            <h2 className="ph">Waiting too long (over the stage goal)</h2>
            <div className="tblwrap"><table className="tbl small"><thead><tr><th>Candidate</th><th>Job</th><th>Stage</th><th className="r">Days</th><th className="r">Goal</th></tr></thead><tbody>${d.overdue.map(x => html`<tr key=${x.id} className="click" onClick=${() => onOpen(x.id)}><td><b>${x.n}</b></td><td>${x.jt}</td><td>${x.stage}</td><td className="r num late">${x.days}</td><td className="r num">${x.limit}</td></tr>`)}</tbody></table></div>
          </section>`
      }
      <section className="panel stack">
        <h2 className="ph">EEO / OFCCP summary</h2>
        ${d.eeo.hidden ? html`<p className="muted small">${d.eeo.n} voluntary responses so far; the breakdown shows once at least 5 people have answered, and is never tied to a candidate.</p>` : html`<div className="g2">${['gender', 'race', 'veteran', 'disability'].map(k => html`<div key=${k}><b className="small" style=${{ textTransform: 'capitalize' }}>${k}</b><table className="tbl small"><tbody>${Object.entries(d.eeo[k] || {}).sort((a, b) => b[1] - a[1]).map(([v, n]) => html`<tr key=${v}><td>${v}</td><td className="r num">${n} (${Math.round((n / d.eeo.n) * 100)}%)</td></tr>`)}</tbody></table></div>`)}</div>`}
      </section>
    </div>`;
}
/* ---------------- Settings ---------------- */
function AtsSettingsTab({ S, reload }) {
  const toast = useToast();
  const [f, setF] = useState(JSON.parse(JSON.stringify(S)));
  const [busy, setBusy] = useState(false);
  const lines = (arr, set) => html`<textarea value=${(arr || []).join('\n')} onInput=${e => set(e.target.value.split('\n').map(x => x.trim()).filter(Boolean))} style=${{ minHeight: 120 }} />`;
  const save = async () => {
    setBusy(true);
    try {
      await api('ats_settings_save', f);
      toast('ATS settings saved.');
      reload();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const rule = kind => (f.auto || []).find(a => a.kind === kind) || { kind, email: false, task: '' };
  const setRule = (kind, patch) => setF({ ...f, auto: [...(f.auto || []).filter(a => a.kind !== kind), { ...rule(kind), ...patch }] });
  const tpl = k => (f.templates || {})[k] || { s: '', b: '' };
  return html`<div className="stack">
      <div className="g2" style=${{ alignItems: 'start' }}>
        <section className="panel stack">
          <h2 className="ph">Lists</h2>
          <div className="form">
            <${Field} label="Sources">${lines(f.sources, v => setF({ ...f, sources: v }))}<//>
            <${Field} label="Tags">${lines(f.tags, v => setF({ ...f, tags: v }))}<//>
            <${Field} label="Rejection reasons">${lines(f.reject, v => setF({ ...f, reject: v }))}<//>
            <${Field} label="Default scorecard attributes">${lines(f.attrs, v => setF({ ...f, attrs: v }))}<//>
            <${Field} label="Job code prefix" hint="Letters and digits, up to 6. New requisitions are numbered like J-1001; codes already given stay."><input value=${f.codePrefix || ''} onInput=${e => setF({ ...f, codePrefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) })} placeholder="J" style=${{ maxWidth: 140 }} aria-label="Job code prefix" /><//>
          </div>
        </section>
        <section className="panel stack">
          <h2 className="ph">Stage goals and automations</h2>
          <p className="muted small" style=${{ margin: 0 }}>Goals: how many days a candidate may wait in a stage before the board flags them. Automations run when a candidate enters a stage kind: the e-mail template below and a task for the hiring team (use {name}).</p>
          <table className="tbl small"><thead><tr><th>Stage kind</th><th>Goal (days)</th><th>Email</th><th>Task for the team</th></tr></thead><tbody>${['new', 'screen', 'interview', 'offer', 'hired', 'rejected'].map(k => html`<tr key=${k}><td>${ATS_KIND_NAME[k]}</td><td>${!['hired', 'rejected'].includes(k) ? html`<input type="number" min="0" value=${(f.sla || {})[k] || ''} onInput=${e => setF({ ...f, sla: { ...(f.sla || {}), [k]: +e.target.value } })} style=${{ width: 70 }} />` : '—'}</td><td>${k !== 'new' && k !== 'hired' ? html`<input type="checkbox" checked=${!!rule(k).email} onChange=${e => setRule(k, { email: e.target.checked })} />` : '—'}</td><td><input value=${rule(k).task || ''} onInput=${e => setRule(k, { task: e.target.value })} placeholder="none" /></td></tr>`)}</tbody></table>
          <label className="check"><input type="checkbox" checked=${!!f.eeo} onChange=${e => setF({ ...f, eeo: e.target.checked })} /><span>New requisitions ask the voluntary EEO questions by default</span></label>
        </section>
      </div>
      <section className="panel stack">
        <h2 className="ph">Email templates</h2>
        <p className="muted small" style=${{ margin: 0 }}>Placeholders: {first}, {name}, {job}, {stage}, {me}. Leave a template blank to use the built-in wording.</p>
        <div className="g2">${['screen', 'interview', 'offer', 'rejected'].map(k => html`<div key=${k} className="form"><b className="small">${ATS_KIND_NAME[k]}</b><input placeholder="Subject" value=${tpl(k).s} onInput=${e => setF({ ...f, templates: { ...(f.templates || {}), [k]: { ...tpl(k), s: e.target.value } } })} /><textarea placeholder="Message" value=${tpl(k).b} onInput=${e => setF({ ...f, templates: { ...(f.templates || {}), [k]: { ...tpl(k), b: e.target.value } } })} style=${{ minHeight: 110 }} /></div>`)}</div>
      </section>
      <div className="g2" style=${{ alignItems: 'start' }}>
        <section className="panel stack">
          <h2 className="ph">Offer letter template</h2>
          <p className="muted small" style=${{ margin: 0 }}>Placeholders: {name}, {first}, {job}, {client}, {start}, {pay}, {terms}, {expires}, {signer}, {date}.</p>
          <textarea value=${f.offerTpl || ''} onInput=${e => setF({ ...f, offerTpl: e.target.value })} style=${{ minHeight: 260 }} />
        </section>
        <section className="panel stack">
          <h2 className="ph">Pipeline templates</h2>
          <p className="muted small" style=${{ margin: 0 }}>Starting points for a requisition's stages (each stage also "counts as" one of the six kinds). Edit the per-job stages in the requisition.</p>
          ${(f.stageSets || []).map((set, i) => html`<div key=${set.id} className="form"><div className="actions"><input value=${set.n} onInput=${e => setF({ ...f, stageSets: f.stageSets.map((s, k) => (k === i ? { ...s, n: e.target.value } : s)) })} style=${{ maxWidth: 240 }} />${f.stageSets.length > 1 && html`<button className="btn ghost sm" onClick=${() => setF({ ...f, stageSets: f.stageSets.filter((s, k) => k !== i) })}>Remove</button>`}</div><textarea value=${set.stages.map(s => `${s.n} = ${s.kind}`).join('\n')} onInput=${e => setF({ ...f, stageSets: f.stageSets.map((s, k) => (k === i ? { ...s, stages: e.target.value.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const [n, kind] = l.split('=').map(x => x.trim()); const kk = ATS_KINDS.includes(kind) ? kind : 'interview'; return { k: ['hired', 'rejected'].includes(kk) ? kk : String(n).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), n, kind: kk }; }) } : s)) })} style=${{ minHeight: 120 }} /></div>`)}
          <div><button className="btn ghost sm" onClick=${() => setF({ ...f, stageSets: [...(f.stageSets || []), { id: nid().slice(0, 6), n: 'New template', stages: ATS_DEFAULT_STAGES.map(s => ({ ...s })) }] })}><${Icon} n="plus" />Add a template</button></div>
          <p className="muted small">One stage per line as <code>Name = kind</code> (kinds: new, screen, interview, offer, hired, rejected).</p>
        </section>
      </div>
      <div className="actions"><button className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save settings'}</button></div>
    </div>`;
}
/* ---------------- v36.2: Talent pool › Saved from searches (loaded on demand, paged) ---------------- */
function AtsSavedPool({ tick, onOpen }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [src, setSrc] = useState('');
  const [page, setPage] = useState(1);
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = async pg => {
    setBusy(true);
    try {
      const r = await api('ats_pool', { q, src, page: pg });
      setD(r);
      setPage(pg);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  useEffect(() => {
    load(1);
  }, [src, tick]);
  const portalKey = (location.hash.match(/#\/portal\/([a-z]+)/) || [])[1] || 'admin';
  const from = d ? (d.page - 1) * d.size + 1 : 0;
  const to = d ? Math.min(d.total, d.page * d.size) : 0;
  return html`<div className="stack atssaved">
      <div className="note info"><span>People Talent search found in the consultant database, the portals and on Dice and saved into the ATS. They join the candidate lists as soon as someone works with them: edits them, adds them to a job or acts on them. To search them by skills with years, use <a href=${'#/portal/' + portalKey + '/search'}>Talent search</a>.</span></div>
      <form className="toolbar" onSubmit=${e => { e.preventDefault(); load(1); }}>
        <input type="search" style=${{ maxWidth: 320 }} placeholder="Name, email, title, skill or place" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Search the people saved from searches" />
        <select value=${src} onChange=${e => setSrc(e.target.value)} aria-label="Source"><option value="">Any source</option>${Object.entries((d && d.srcs) || {}).map(([k, n]) => html`<option key=${k} value=${k}>${k || 'No source'} (${n})</option>`)}</select>
        <button className="btn ghost" disabled=${busy}>${busy ? 'Searching…' : 'Search'}</button>
        <span className="muted small push">${d ? (d.total ? from + '–' + to + ' of ' + d.total : '') : ''}</span>
      </form>
      <section className="panel" style=${{ padding: '6px 8px' }}>
        ${
          !d
            ? html`<${Spinner} />`
            : d.rows.length
              ? html`<div className="tblwrap"><table className="tbl">
                  <thead><tr><th>Candidate</th><th>Source</th><th>Saved</th><th>Resume</th></tr></thead>
                  <tbody>${d.rows.map(
                    c => html`<tr key=${c.id} className="click" tabIndex="0" onClick=${() => onOpen(c.id)} onKeyDown=${e => { if (e.key === 'Enter') onOpen(c.id); }}>
                      <td><b style=${{ fontWeight: 600 }}>${c.n}</b><div className="muted small">${[c.ti, c.loc, c.auth].filter(Boolean).join(' · ') || c.e}</div>${c.by ? html`<div className="muted small atssavedby">${c.by}</div>` : null}</td>
                      <td className="small">${c.src || '—'}</td>
                      <td className="num small">${fmtDay(c.at)}</td>
                      <td>${c.rid ? html`<a className="btn ghost sm" href=${fileUrl('ats/' + c.id, c.rid, true)} onClick=${e => e.stopPropagation()} aria-label=${'Resume of ' + c.n}><${Icon} n="down" /></a>` : html`<span className="muted small">—</span>`}</td>
                    </tr>`
                  )}</tbody>
                </table></div>`
              : html`<${Empty} title=${q || src ? 'Nobody matches' : 'Nobody saved from searches yet'}>${q || src ? 'Try other words or any source.' : 'Talent search saves the people it finds here (Recruiting › Talent search).'}<//>`
        }
      </section>
      ${
        d &&
        d.total > d.size &&
        html`<div className="actions"><button type="button" className="btn ghost sm" disabled=${busy || page <= 1} onClick=${() => load(page - 1)}>Previous</button><button type="button" className="btn ghost sm" disabled=${busy || to >= d.total} onClick=${() => load(page + 1)}>Next</button></div>`
      }
    </div>`;
}
/* ---------------- The page ---------------- */
function ATSPage({ q }) {
  // (styles for the board and pickers live in theme.css under "v29 ATS")
  // v36.2: people Talent search saved that nobody has worked with yet stay out of the live list (a big talent pool
  // would slow every ATS page); they show under Talent pool › Saved from searches and open on demand
  const col = useCol('ats', 'u:desc', 0, 'nolite');
  const [S, reloadS] = useAtsSettings();
  const [jobRows, jobsMap, reloadJobs] = useAtsJobs();
  const [tab, setTab] = useState(q && q.tab ? q.tab : 'pipeline');
  const [jobId, setJobId] = useState((q && q.job) || '');
  const [open, setOpen] = useState((q && q.c) || null);
  const [pull, setPull] = useState(false);
  const [add, setAdd] = useState(false);
  const [tick, setTick] = useState(0);
  const [poolView, setPoolView] = useState((q && q.pool) === 'saved' ? 'saved' : 'kept');
  const [mail, setMail] = useState(null); // v36.4: the Mail window ({mode, ids, cands})
  // v37.2: the requisition page (…/ats?tab=jobs&req=<id>, so the browser's Back works), the form and templates
  const [req, setReq] = useState((q && q.req) || '');
  const [editRow, setEditRow] = useState(null);
  const [pickTpl, setPickTpl] = useState(false);
  const [reqVer, setReqVer] = useState(0);
  useEffect(() => {
    if (q && q.req) {
      setReq(q.req);
      setTab('jobs');
    } else setReq('');
  }, [q && q.req]);
  const atsBase = () => location.hash.replace(/^#/, '').split('?')[0];
  const openReq = id => {
    location.hash = '#' + atsBase() + '?tab=jobs&req=' + encodeURIComponent(id);
  };
  const closeReq = () => {
    location.hash = '#' + atsBase() + '?tab=jobs';
  };
  const docs = col.docs;
  const live = open && docs.find(c => c.id === open);
  const one = useDoc(open && !live && !col.loading ? 'ats/' + open : null);
  const cur = live || (open && one.exists ? { id: open, ...one.data } : null);
  const bump = () => {
    setTick(t => t + 1);
    reloadJobs();
  };
  if (!S) return html`<${Spinner} label="Opening the ATS…" />`;
  const activeDocs = docs.filter(c => activeKind(kindOf(jobsMap[c.job] && jobsMap[c.job].job, c.st)) && !(c.pool && !c.job));
  const upcoming = docs.reduce((n, c) => n + (c.intvs || []).filter(i => !i.cancelled && new Date(i.at) >= new Date()).length, 0);
  const openJobs = (jobRows || []).filter(r => r.pub.open !== false && !['closed', 'filled', 'draft'].includes(r.job.status));
  const kpis = [
    { v: openJobs.length, l: 'Open requisitions', onClick: () => setTab('jobs') },
    { v: activeDocs.length, l: 'Active candidates', onClick: () => setTab('list') },
    { v: docs.filter(c => kindOf(jobsMap[c.job] && jobsMap[c.job].job, c.st) === 'new' && !(c.pool && !c.job)).length, l: 'New to review', onClick: () => setTab('list') },
    { v: upcoming, l: 'Interviews coming up', onClick: () => setTab('interviews') },
    { v: docs.filter(c => c.offer && ['sent', 'approved'].includes(c.offer.st)).length, l: 'Offers out', onClick: () => setTab('offers') },
  ];
  const tabs = [['pipeline', 'Pipeline'], ['list', 'Candidates'], ['jobs', 'Requisitions'], ['postings', 'Job boards'], ['interviews', 'Interviews'], ['offers', 'Offers'], ['pool', 'Talent pool'], ['reports', 'Reports'], ['settings', 'Settings']];
  const onTab = k => {
    setTab(k);
    if (k === 'jobs' && req) closeReq();
  };
  return html`<div className="stack ats">
      ${!(tab === 'jobs' && req) && html`<${KitStats} items=${kpis} />`}
      <div className="toolbar">
        <${KitTabs} tabs=${tabs} tab=${tab} onTab=${onTab} wrap />
        <div className="push">
          ${['pipeline', 'list'].includes(tab) && html`<select value=${jobId} onChange=${e => setJobId(e.target.value)} aria-label="Job" style=${{ maxWidth: 280 }}><option value="">All jobs (standard stages)</option>${(jobRows || []).map(r => html`<option key=${r.id} value=${r.id}>${r.pub.ti}${r.pub.open === false ? ' (closed)' : ''}</option>`)}</select>`}
          <button className="btn ghost" onClick=${() => setMail({ mode: 'push', ids: [] })} title="Send profiles to a client, email candidates, or write to anyone"><${Icon} n="mail" />Mail</button>
          <button className="btn ghost" onClick=${() => setPull(true)}><${Icon} n="users" />Import candidates</button>
          <button className="btn" onClick=${() => setAdd(true)}><${Icon} n="plus" />Add candidate</button>
        </div>
      </div>
      ${col.loading && !docs.length ? html`<${Spinner} />` : null}
      ${tab === 'pipeline' && html`<${PipelineTab} key=${tick} docs=${docs} jobsMap=${jobsMap} S=${S} jobId=${jobId} setJobId=${setJobId} onOpen=${setOpen} bulk=${bump} onMail=${setMail} />`}
      ${tab === 'list' && html`<${CandidatesTab} key=${tick} docs=${docs} jobsMap=${jobsMap} S=${S} jobId=${jobId} onOpen=${setOpen} bulk=${bump} onMail=${setMail} />`}
      ${
        tab === 'pool' &&
        html`<div className="stack">
          <div className="seg atspoolseg" style=${{ marginBottom: 0 }}>
            <button type="button" className=${poolView === 'kept' ? 'on' : ''} onClick=${() => setPoolView('kept')}>Kept in the pool</button>
            <button type="button" className=${poolView === 'saved' ? 'on' : ''} onClick=${() => setPoolView('saved')}>Saved from searches</button>
          </div>
          ${poolView === 'kept' ? html`<${CandidatesTab} key=${'p' + tick} docs=${docs} jobsMap=${jobsMap} S=${S} jobId="" onOpen=${setOpen} bulk=${bump} onMail=${setMail} pool />` : html`<${AtsSavedPool} tick=${tick} onOpen=${setOpen} />`}
        </div>`
      }
      ${tab === 'jobs' && !req && html`<${JobsTab} rows=${jobRows} reload=${reloadJobs} S=${S} onCandidates=${id => { setJobId(id); setTab('pipeline'); }} onOpenReq=${openReq} onEdit=${row => setEditRow({ row })} onNew=${() => setPickTpl(true)} />`}
      ${tab === 'jobs' && req && html`<${JobPage} id=${req} ver=${reqVer + tick} rows=${jobRows} docs=${docs} S=${S} onBack=${closeReq} onOpenCand=${setOpen} onNav=${openReq} onPipeline=${id => { setJobId(id); setTab('pipeline'); }} onEdit=${row => setEditRow({ row })} onAdd=${() => setAdd(true)} reloadJobs=${reloadJobs} />`}
      ${tab === 'postings' && html`<${PostingsTab} onOpenReq=${openReq} />`}
      ${tab === 'interviews' && html`<${InterviewsTab} docs=${docs} jobsMap=${jobsMap} onOpen=${setOpen} />`}
      ${tab === 'offers' && html`<${OffersTab} docs=${docs} jobsMap=${jobsMap} onOpen=${setOpen} />`}
      ${tab === 'reports' && html`<${ReportsTab} key=${tick} onOpen=${setOpen} />`}
      ${tab === 'settings' && html`<${AtsSettingsTab} key=${S.u || 0} S=${S} reload=${reloadS} />`}
      ${cur && html`<${CandidateModal} key=${cur.id} c=${cur} jobsMap=${jobsMap} S=${S} onClose=${() => setOpen(null)} onChanged=${bump} onMail=${setMail} />`}
      ${mail && html`<${AtsMailModal} init=${mail} docs=${docs} jobsMap=${jobsMap} jobRows=${jobRows} S=${S} onClose=${() => setMail(null)} onSent=${bump} />`}
      ${add && html`<${AddCandidate} jobsMap=${jobsMap} S=${S} defaultJob=${(tab === 'jobs' && req) || jobId} onClose=${id => { setAdd(false); if (id) { setOpen(id); bump(); } }} />`}
      ${editRow && html`<${RequisitionModal} key=${editRow.row ? editRow.row.id : 'new'} row=${editRow.row || null} tpl=${editRow.tpl || null} S=${S} onClose=${() => setEditRow(null)} onOpenReq=${openReq} onSaved=${id => { reloadJobs(); setReqVer(v => v + 1); if (!editRow.row) openReq(id); }} />`}
      ${pickTpl && html`<${AtsTplPicker} onClose=${() => setPickTpl(false)} onPick=${t => { setPickTpl(false); setEditRow(t ? { tpl: t } : {}); }} />`}
      ${pull && html`<${AtsPullModal} jobsMap=${jobsMap} onClose=${changed => { setPull(false); if (changed) bump(); }} onCsv=${() => { setPull(false); location.hash = impHref('ats', jobId ? { job: jobId } : {}); }} />`}
    </div>`;
}

/* ---------------- My interviews: for everyone on a panel (hiring managers included), scorecards without the full ATS ---------------- */
function MyInterviewsPage() {
  const P = usePortal();
  const toast = useToast();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [card, setCard] = useState(null);
  const [busy, setBusy] = useState(false);
  const [past, setPast] = useState(false);
  const load = () => api('ats_my_interviews', {}).then(x => { setD(x); setErr(null); }).catch(setErr);
  useEffect(() => { load(); }, []);
  if (err && !d) return html`<${LoadError} error=${err} onRetry=${load} />`;
  if (!d) return html`<${Spinner} />`;
  const now = new Date();
  const rows = [];
  d.rows.forEach(c => c.intvs.forEach(iv => { if (past ? new Date(iv.at) < now : new Date(iv.at) >= now || !c.cards.some(k => k.intv === iv.id)) rows.push({ c, iv }); }));
  rows.sort((a, b) => a.iv.at.localeCompare(b.iv.at));
  const submit = async () => {
    setBusy(true);
    try {
      await api('ats_card', { id: card.c.id, card: { intv: card.iv.id, stage: card.iv.stage || card.c.st, attrs: card.attrs, rec: card.rec, notes: card.notes } });
      toast('Scorecard submitted. Thank you.');
      setCard(null);
      load();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const scale = ['', 'Below bar', 'Mixed', 'Meets bar', 'Exceptional'];
  return html`<div className="stack">
      <${CalConnectCard} />
      <div className="toolbar"><div className="seg"><button className=${!past ? 'on' : ''} onClick=${() => setPast(false)}>Upcoming and due</button><button className=${past ? 'on' : ''} onClick=${() => setPast(true)}>Past</button></div><span className="muted small">Interviews you are on. Read the resume beforehand; submit your scorecard right after, while it is fresh.</span></div>
      ${
        rows.length
          ? rows.map(({ c, iv }) => { const mine = c.cards.find(k => k.intv === iv.id && k.by === P.uid); const done = new Date(iv.at) < now; return html`<section key=${c.id + iv.id} className="panel stack">
              <div className="ph-row">
                <div><h2 className="ph">${c.n} <span className="muted" style=${{ fontWeight: 400 }}>· ${c.jt}</span></h2><div className="muted small">${iv.kind} · ${fmtTs(new Date(iv.at).getTime())} · ${iv.dur} min${iv.where && !(iv.cal && iv.where === iv.cal.join) ? ' · ' + iv.where : ''} · stage: ${c.stage}${iv.cal && iv.cal.join ? html` · <a href=${iv.cal.join} target="_blank" rel="noopener">Join (${CAL_MEET[iv.cal.p] || 'meeting'})</a>` : null}</div></div>
                <div className="actions">${c.rid && html`<a className="btn ghost sm" href=${fileUrl('ats/' + c.id, c.rid, true, c.tok)}><${Icon} n="down" />Resume</a>`}${c.li && html`<a className="btn ghost sm" href=${/^https?:/.test(c.li) ? c.li : 'https://' + c.li} target="_blank" rel="noopener">LinkedIn</a>`}${mine ? html`<${Chip} s=${REC_TONE[mine.rec] || 'ok'}>Your scorecard: ${REC_LABEL[mine.rec] || 'submitted'}<//>` : html`<button className="btn sm" onClick=${() => setCard({ c, iv, attrs: {}, rec: '', notes: '' })}><${Icon} n="pen" />${done ? 'Submit scorecard' : 'Scorecard'}</button>`}</div>
              </div>
              <div className="g2">
                <div className="small"><b>About the candidate.</b> ${[c.ti, c.loc, c.exp ? c.exp + ' years' : ''].filter(Boolean).join(' · ')}${c.sk ? html`<div>Skills: ${c.sk}</div>` : null}${c.dom ? html`<div>Domains: <${DomChips} dom=${c.dom} line /></div>` : null}${c.msg ? html`<div className="muted">"${c.msg.slice(0, 240)}"</div>` : null}${c.others ? html`<div className="muted">${c.others} other scorecard${c.others === 1 ? '' : 's'} submitted (shown to HR).</div>` : null}</div>
                <div className="small">${iv.notes ? html`<div><b>Panel notes.</b> ${iv.notes}</div>` : null}${c.kit.length ? html`<div><b>Interview kit.</b><ol style=${{ margin: '4px 0 0 18px', padding: 0 }}>${c.kit.map((q, i) => html`<li key=${i}>${q}</li>`)}</ol></div>` : null}</div>
              </div>
            </section>`; })
          : html`<${Empty} title=${past ? 'No past interviews' : 'No interviews on your calendar'}>When HR puts you on an interview panel you get a calendar invitation and the candidate appears here with the resume and the questions to cover.<//>`
      }
      ${
        card &&
        html`<${Modal} title=${'Scorecard: ' + card.c.n} onClose=${() => setCard(null)} foot=${html`<button className="btn ghost" onClick=${() => setCard(null)}>Cancel</button><button className="btn" disabled=${busy} onClick=${submit}>${busy ? 'Submitting…' : 'Submit scorecard'}</button>`}>
            <div className="form">
              <table className="tbl small"><thead><tr><th>Attribute</th>${[1, 2, 3, 4].map(v => html`<th key=${v} className="c">${v} · ${scale[v]}</th>`)}</tr></thead><tbody>${card.c.attrs.map(a => html`<tr key=${a}><td>${a}</td>${[1, 2, 3, 4].map(v => html`<td key=${v} className="c"><input type="radio" name=${'my-' + a} checked=${card.attrs[a] === v} onChange=${() => setCard({ ...card, attrs: { ...card.attrs, [a]: v } })} /></td>`)}</tr>`)}</tbody></table>
              <${Field} label="Overall recommendation"><div className="seg">${Object.entries(REC_LABEL).map(([k, n]) => html`<button key=${k} type="button" className=${card.rec === k ? 'on' : ''} onClick=${() => setCard({ ...card, rec: k })}>${n}</button>`)}</div><//>
              <${Field} label="Notes" hint="What they said or did; specific examples help the hiring decision."><textarea value=${card.notes} onInput=${e => setCard({ ...card, notes: e.target.value })} style=${{ minHeight: 120 }} /><//>
            </div>
          <//>`
      }
    </div>`;
}
