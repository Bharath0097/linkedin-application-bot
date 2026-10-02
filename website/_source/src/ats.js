/* ================= ATS: applicant tracking ================= */
const atsChip = s => s === 'hired' ? 'ok' : s === 'rejected' ? 'red' : s === 'offer' || s === 'interview' ? 'new' : s === 'screen' ? 'amber' : '';
function Stars({ v, onChange }) {
  return html`<span className="stars" role=${onChange ? 'radiogroup' : undefined}>${[1, 2, 3, 4, 5].map(n => html`<button key=${n} type="button" className=${n <= (v || 0) ? 'on' : ''} aria-label=${n + ' star' + (n > 1 ? 's' : '')} disabled=${!onChange} onClick=${() => onChange && onChange(n === v ? 0 : n)}>★</button>`)}</span>`;
}
function CandidateModal({ c, jobs, onClose }) {
  const P = usePortal(); const toast = useToast();
  const [f, setF] = useState({ ...c }); const [note, setNote] = useState(''); const [mail, setMail] = useState(null); const [busy, setBusy] = useState(''); const [prog, setProg] = useState(0);
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const me = (P.prof && P.prof.n) || (Cap.me && Cap.me.name) || '';
  const saveFields = async (patch, ev) => { setBusy('save'); try { const now = Date.now(); await dbMerge(`ats/${c.id}`, { ...patch, u: now, ...(ev ? { log: [...(c.log || []), { t: now, who: me, ev }] } : {}) }); toast('Saved.'); } catch (e) { toast(errText(e), true); } setBusy(''); };
  const save = () => saveFields({ n: f.n.trim(), e: f.e.trim(), ph: f.ph || '', jt: f.jt || '', job: f.job || '', li: f.li || '', src: f.src || '', st: f.st, rating: +f.rating || 0, intv: f.intv || '', intvNote: f.intvNote || '' }, f.st !== c.st ? `Moved to ${ATS_ST[f.st]}` : f.intv !== c.intv && f.intv ? `Interview scheduled for ${f.intv.replace('T', ' ')}` : null);
  const addNote = async () => { if (!note.trim()) return; setBusy('note'); try { await dbMerge(`ats/${c.id}`, { notes: [...(c.notes || []), { t: Date.now(), who: me, x: note.trim() }], u: Date.now() }); setNote(''); } catch (e) { toast(errText(e), true); } setBusy(''); };
  const onFiles = async fs => { setBusy('file'); try { setProg(0.03); const r = await storeFile(`ats/${c.id}`, fs[0], { c: 'resume' }, setProg); await dbMerge(`ats/${c.id}`, { rid: r.id, rn: r.n, u: Date.now() }); toast('Resume attached.'); } catch (e) { toast(errText(e), true); } setBusy(''); };
  const openMail = k => { const t = ATS_TEMPLATES[k]; const fill = s => s.replace(/\{name\}/g, (c.n || '').split(' ')[0]).replace(/\{job\}/g, c.jt || 'the open').replace(/\{date\}/g, f.intv ? f.intv.replace('T', ' at ') : '[date and time]').replace(/\{me\}/g, me); setMail({ k, s: fill(t.s), b: fill(t.b) }); };
  const sendMailNow = async () => { setBusy('mail'); try { const r = await api('ats_email', { id: c.id, subject: mail.s, body: mail.b }); toast(r.mailed ? 'Email sent.' : 'Could not send; check the mail settings in api/config.php.', !r.mailed); if (r.mailed && mail.k !== 'screen' && f.st !== mail.k) await dbMerge(`ats/${c.id}`, { st: mail.k, u: Date.now() }); setMail(null); } catch (e) { toast(errText(e), true); } setBusy(''); };
  return html`<${Modal} wide title=${c.n} onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Close</button><button className="btn" disabled=${!!busy} onClick=${save}>${busy === 'save' ? 'Saving…' : 'Save'}</button>`}>
    <div className="stack">
      <div className="actions"><${Chip} s=${atsChip(c.st)}>${ATS_ST[c.st]}<//><${Stars} v=${+f.rating} onChange=${v => setF({ ...f, rating: v })} /><span className="muted small">Applied ${fmtDay(c.at)}${c.src ? ' via ' + c.src : ''}</span>
        <div className="push" style=${{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>${Object.keys(ATS_TEMPLATES).map(k => html`<button key=${k} className="btn ghost sm" onClick=${() => openMail(k)}><${Icon} n="send" />${k === 'screen' ? 'Email: screening call' : k === 'interview' ? 'Email: interview' : k === 'offer' ? 'Email: offer' : 'Email: not selected'}</button>`)}</div></div>
      <div className="form">
        <div className="row3"><${Field} label="Name"><input value=${f.n} onInput=${up('n')} /><//><${Field} label="Email"><input type="email" value=${f.e} onInput=${up('e')} /><//><${Field} label="Phone"><input value=${f.ph || ''} onInput=${up('ph')} /><//></div>
        <div className="row3"><${Field} label="Role applied for"><input value=${f.jt || ''} onInput=${up('jt')} list="atsjobs" /><datalist id="atsjobs">${jobs.map(j => html`<option key=${j.id} value=${j.t} />`)}</datalist><//><${Field} label="Stage"><select value=${f.st} onChange=${up('st')}>${Object.entries(ATS_ST).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//><${Field} label="Source"><input value=${f.src || ''} onInput=${up('src')} placeholder="Website, LinkedIn, referral" /><//></div>
        <div className="row3"><${Field} label="LinkedIn"><input value=${f.li || ''} onInput=${up('li')} /><//><${Field} label="Interview date and time"><input type="datetime-local" value=${f.intv || ''} onInput=${up('intv')} /><//><${Field} label="Interview details"><input value=${f.intvNote || ''} onInput=${up('intvNote')} placeholder="Panel, link, location" /><//></div>
      </div>
      ${c.msg && html`<div className="note info"><span style=${{ whiteSpace: 'pre-wrap' }}><b>Cover note.</b> ${c.msg}</span></div>`}
      <div><span className="lbl">Resume</span>${c.rid ? html`<ul className="files" style=${{ marginTop: 8 }}><li><${Icon} n="file" /><div className="fn"><b>${c.rn || 'Resume'}</b></div><${FileActions} base=${'ats/' + c.id} f=${{ id: c.rid, n: c.rn || 'resume', ty: '' }} /></li></ul>` : html`<p className="muted small">No resume attached.</p>`}
        <div style=${{ marginTop: 8 }}><${FilePick} busy=${busy === 'file'} progress=${prog} onFiles=${onFiles} label=${c.rid ? 'Replace the resume.' : 'Attach a resume.'} /></div></div>
      <div><span className="lbl">Notes</span>${(c.notes || []).length ? html`<ul className="list" style=${{ marginTop: 6 }}>${c.notes.slice().reverse().map((n, i) => html`<li key=${i}><div><div className="t" style=${{ fontWeight: 500 }}>${n.x}</div><div className="m">${n.who}</div></div><span className="muted small num">${fmtTs(n.t)}</span></li>`)}</ul>` : null}
        <div className="actions" style=${{ marginTop: 8 }}><input value=${note} onInput=${e => setNote(e.target.value)} placeholder="Add a note (screening feedback, rate, availability)" style=${{ flex: 1 }} onKeyDown=${e => { if (e.key === 'Enter') addNote(); }} /><button className="btn ghost" disabled=${busy === 'note'} onClick=${addNote}>Add</button></div></div>
      <div><h3 className="ph" style=${{ marginBottom: 8 }}>History</h3><ul className="list">${(c.log || []).slice().reverse().map((l, i) => html`<li key=${i}><div><div className="t">${l.ev}</div><div className="m">${l.who}</div></div><span className="muted small num">${fmtTs(l.t)}</span></li>`)}</ul></div>
    </div>
    ${mail && html`<${Modal} title=${'Email ' + c.n} onClose=${() => setMail(null)} foot=${html`<button className="btn ghost" onClick=${() => setMail(null)}>Cancel</button><button className="btn" disabled=${busy === 'mail'} onClick=${sendMailNow}><${Icon} n="send" />${busy === 'mail' ? 'Sending…' : 'Send'}</button>`}>
      <div className="form"><${Field} label="To"><input value=${c.e} disabled /><//><${Field} label="Subject"><input value=${mail.s} onInput=${e => setMail({ ...mail, s: e.target.value })} /><//><${Field} label="Message"><textarea value=${mail.b} onInput=${e => setMail({ ...mail, b: e.target.value })} style=${{ minHeight: 220 }} /><//>${mail.k !== 'screen' && html`<p className="muted small">Sending also moves the candidate to "${ATS_ST[mail.k]}".</p>`}</div><//>`}<//>`;
}
function AddCandidate({ jobs, onClose }) {
  const P = usePortal(); const toast = useToast();
  const [f, setF] = useState({ n: '', e: '', ph: '', jt: '', src: 'Recruiter sourced' }); const [file, setFile] = useState(null); const [busy, setBusy] = useState(false); const [prog, setProg] = useState(0);
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    if (!f.n.trim() || !/^\S+@\S+\.\S+$/.test(f.e)) { toast('Add a name and a valid email.', true); return; }
    setBusy(true);
    try { const id = nid(); const now = Date.now(); const me = (P.prof && P.prof.n) || '';
      await dbSet(`ats/${id}`, { n: f.n.trim(), e: f.e.trim().toLowerCase(), ph: f.ph, jt: f.jt, src: f.src, st: 'new', rating: 0, notes: [], at: now, u: now, log: [{ t: now, who: me, ev: 'Added' + (f.jt ? ' for ' + f.jt : '') }] });
      if (file) { setProg(0.03); const r = await storeFile(`ats/${id}`, file, { c: 'resume' }, setProg); await dbMerge(`ats/${id}`, { rid: r.id, rn: r.n }); }
      toast('Candidate added.'); onClose(); }
    catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  return html`<${Modal} title="Add a candidate" onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Cancel</button><button className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Add candidate'}</button>`}>
    <div className="form"><div className="row2"><${Field} label="Name"><input value=${f.n} onInput=${up('n')} /><//><${Field} label="Email"><input type="email" value=${f.e} onInput=${up('e')} /><//></div>
      <div className="row3"><${Field} label="Phone"><input value=${f.ph} onInput=${up('ph')} /><//><${Field} label="Role"><input value=${f.jt} onInput=${up('jt')} list="atsjobs2" /><datalist id="atsjobs2">${jobs.map(j => html`<option key=${j.id} value=${j.t} />`)}</datalist><//><${Field} label="Source"><input value=${f.src} onInput=${up('src')} /><//></div>
      <div><span className="lbl">Resume</span>${file ? html`<ul className="files" style=${{ marginTop: 8 }}><li><${Icon} n="file" /><div className="fn"><b>${file.name}</b></div><button className="btn ghost sm" onClick=${() => setFile(null)}>Remove</button></li></ul>` : html`<div style=${{ marginTop: 8 }}><${FilePick} busy=${busy} progress=${prog} onFiles=${fs => setFile(fs[0])} /></div>`}</div></div><//>`;
}
function ATSPage() {
  const col = useCol('ats', 'u:desc'); const jobsCol = useCol('org/site/jobs', 'at:desc');
  const [view, setView] = useState('board'); const [open, setOpen] = useState(null); const [add, setAdd] = useState(false); const [q, setQ] = useState(''); const [job, setJob] = useState(''); const [stage, setStage] = useState('active');
  const ql = q.trim().toLowerCase();
  const docs = col.docs.filter(c => (!ql || [c.n, c.e, c.jt, c.src].join(' ').toLowerCase().includes(ql)) && (!job || c.jt === job));
  const list = docs.filter(c => stage === 'all' || (stage === 'active' ? !['hired', 'rejected'].includes(c.st) : c.st === stage));
  const cur = open && col.docs.find(c => c.id === open);
  const jobTitles = [...new Set([...jobsCol.docs.map(j => j.t), ...col.docs.map(c => c.jt).filter(Boolean)])];
  const interviews = col.docs.filter(c => c.intv && c.intv.slice(0, 10) >= dkey() && !['hired', 'rejected'].includes(c.st)).sort((a, b) => a.intv.localeCompare(b.intv));
  return html`<div className="stack">
    <div className="kpis">${Object.entries(ATS_ST).map(([k, v]) => html`<a key=${k} onClick=${() => { setStage(k); setView('list'); }} style=${{ cursor: 'pointer' }}><b>${col.docs.filter(c => c.st === k).length}</b><span>${v}</span></a>`)}</div>
    <div className="toolbar"><div className="seg" style=${{ marginBottom: 0 }}>${[['board', 'Pipeline'], ['list', 'List']].map(([k, v]) => html`<button key=${k} className=${view === k ? 'on' : ''} onClick=${() => setView(k)}>${v}</button>`)}</div>
      <input type="search" style=${{ maxWidth: 220 }} placeholder="Search candidates" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Search candidates" />
      <select value=${job} onChange=${e => setJob(e.target.value)} aria-label="Filter by role" style=${{ maxWidth: 240 }}><option value="">All roles</option>${jobTitles.map(t => html`<option key=${t}>${t}</option>`)}</select>
      ${view === 'list' && html`<select value=${stage} onChange=${e => setStage(e.target.value)} aria-label="Stage" style=${{ maxWidth: 170 }}><option value="active">Active</option>${Object.entries(ATS_ST).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}<option value="all">All</option></select>`}
      <div className="push"><a className="btn ghost" href="#/portal/admin/website?tab=jobs">Job postings</a><button className="btn" onClick=${() => setAdd(true)}><${Icon} n="plus" />Add candidate</button></div></div>
    ${interviews.length > 0 && html`<div className="note info"><span><b>Upcoming interviews:</b> ${interviews.slice(0, 4).map(c => `${c.n} on ${c.intv.replace('T', ' at ')}`).join('; ')}</span></div>`}
    ${col.loading ? html`<${Spinner} />` : view === 'board' ? html`<div className="board">${Object.entries(ATS_ST).map(([k, v]) => { const cards = docs.filter(c => c.st === k); return html`<div key=${k} className="col"><div className="col-h"><span>${v}</span><span className="chip">${cards.length}</span></div>
        ${cards.map(c => html`<div key=${c.id} className="card click" tabIndex="0" onClick=${() => setOpen(c.id)} onKeyDown=${e => { if (e.key === 'Enter') setOpen(c.id); }}><b>${c.n}</b><div className="muted small">${c.jt || 'No role'}</div><div className="actions" style=${{ marginTop: 6, justifyContent: 'space-between' }}><${Stars} v=${c.rating} /><span className="muted small">${fmtDate(dkey(new Date(c.at)))}</span></div>${c.intv && html`<div className="small" style=${{ marginTop: 4, color: 'var(--indigo-ink)' }}>Interview ${c.intv.replace('T', ' ')}</div>`}</div>`)}
        ${!cards.length && html`<div className="muted small" style=${{ padding: 10 }}>Empty</div>`}</div>`; })}</div>`
      : html`<section className="panel" style=${{ padding: '6px 8px' }}>${list.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Candidate</th><th>Role</th><th>Stage</th><th>Rating</th><th>Source</th><th>Applied</th><th>Resume</th></tr></thead>
        <tbody>${list.map(c => html`<tr key=${c.id} className="click" tabIndex="0" onClick=${() => setOpen(c.id)}><td><b style=${{ fontWeight: 600 }}>${c.n}</b><div className="muted small">${c.e}${c.ph ? ', ' + c.ph : ''}</div></td><td>${c.jt || '—'}</td><td><${Chip} s=${atsChip(c.st)}>${ATS_ST[c.st]}<//></td><td><${Stars} v=${c.rating} /></td><td>${c.src || '—'}</td><td className="num">${fmtDay(c.at)}</td><td>${c.rid ? html`<a className="btn ghost sm" href=${fileUrl('ats/' + c.id, c.rid, true)} onClick=${e => e.stopPropagation()}><${Icon} n="down" />Resume</a>` : html`<span className="muted small">None</span>`}</td></tr>`)}</tbody></table></div>`
        : html`<${Empty} title="No candidates here" action=${html`<button className="btn" onClick=${() => setAdd(true)}>Add a candidate</button>`}>Applications from the website Careers page land here automatically with their resume. Move candidates through screening, interview and offer, and email them from their card.<//>`}</section>`}
    ${cur && html`<${CandidateModal} key=${cur.id + cur.u} c=${cur} jobs=${jobsCol.docs} onClose=${() => setOpen(null)} />`}
    ${add && html`<${AddCandidate} jobs=${jobsCol.docs} onClose=${() => setAdd(false)} />`}
  </div>`;
}
