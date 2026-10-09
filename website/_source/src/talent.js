/* ================= v33: Talent search (Recruiting › Talent search) =================
   JobDiva-style search over every resume the portal holds (ATS, consultant database, the portals): Boolean keywords
   plus skills with years of experience, location, work authorization, total experience and how recent the resume is.
   Saved searches can email their new matches once a day.
   v36.1: Dice too. The same search runs on Dice (live, through Sourcing connections) next to the portal's own; Dice
   people show labeled "Dice" and are saved into the ATS as the administrator set (everyone, those who fit, nobody),
   their full profile read in the background. A Dice person already in the ATS shows once. Any chosen person can be
   saved into the ATS ("Save to the ATS") or put on a job.
   v36.2: everyone a search finds (consultant database, portals, Dice) is saved into the ATS as administrators and HR
   set it ("Saving into the ATS": everyone / who fits / nobody); each row says where it stands with the ATS. */
const TS_AUTH = [['USC', 'US citizen'], ['GC', 'Green card'], ['GC-EAD', 'GC EAD'], ['H-1B', 'H-1B'], ['H-4 EAD', 'H-4 EAD'], ['L-2 EAD', 'L-2 EAD'], ['OPT', 'OPT'], ['STEM OPT', 'STEM OPT'], ['TN', 'TN'], ['E-3', 'E-3']];
const TS_SRC = [['ats', 'ATS candidates'], ['cand', 'Consultant database'], ['u', 'Portal consultants & employees']];
const tsEmpty = () => ({ q: '', skills: [{ s: '', y: '' }], loc: '', auth: [], ymin: '', ymax: '', upd: '', src: { ats: true, cand: true, u: true, dice: true }, sort: 'score', dom: '', ind: '' }); // v68: dom, ind
const tsTerms = q =>
  (String(q || '').match(/"[^"]*"|[^\s()"]+/g) || [])
    .filter(t => !/^(AND|OR|NOT)$/.test(t) && !t.startsWith('-'))
    .map(t => t.replace(/^"|"$/g, '').replace(/\*$/, ''))
    .filter(t => t.length > 1);
function tsHighlight(text, terms) {
  if (!terms.length) return text;
  const rx = new RegExp('(' + terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'ig');
  return String(text)
    .split(rx)
    .map((part, i) => (i % 2 ? html`<mark key=${i}>${part}</mark>` : part));
}
const tsScoreChip = s => 'chip ' + (s >= 75 ? 'ok' : s >= 55 ? 'amber' : '');
function TsPreview({ k, ats, terms, onClose, canAts, portalKey }) {
  const toast = useToast();
  const [p, setP] = useState(null);
  useEffect(() => {
    api('ts_person', { k }).then(r => setP(r.p), e => toast(errText(e), true));
  }, [k]);
  const atsId = p ? (p.kind === 'ats' ? p.id : ats || '') : '';
  return html`<${Modal} wide title=${p ? p.n : 'Candidate'} onClose=${onClose} foot=${html`${atsId && canAts && html`<a className="btn ghost" href=${'#/portal/' + portalKey + '/ats?c=' + encodeURIComponent(atsId)}>Open in the ATS</a>`}<button type="button" className="btn" onClick=${onClose}>Close</button>`}>
    ${
      !p
        ? html`<${Spinner} />`
        : html`<div className="stack">
            <div className="muted small">${[p.ti, p.loc, p.auth, p.years ? p.years + ' years' : '', p.src].filter(Boolean).join(' · ')}</div>
            <div className="small">${[p.e, p.ph].filter(Boolean).join(' · ')}</div>
            ${p.dom && ((p.dom.tech || []).length || (p.dom.ind || []).length) ? html`<div className="tsdom"><b className="small">Domains recognized on the resume.</b> <${DomChips} dom=${p.dom} /><div className="muted small">${[...(p.dom.tech || []), ...(p.dom.ind || [])].map(x => x.n + ': ' + (x.t || []).join(', ') + (x.y ? ' (' + x.y + ' years)' : '')).join(' · ')}</div></div>` : ''}
            ${
              Object.keys(p.skills || {}).length > 0 &&
              html`<div className="tblwrap"><table className="tbl small tsskills"><thead><tr><th>Skill</th><th>Years</th></tr></thead><tbody>${Object.entries(p.skills)
                .slice(0, 30)
                .map(([s, v]) => html`<tr key=${s}><td>${s}</td><td>${v.y ? v.y + (v.c ? ' (stated)' : '') : html`<span className="muted">named</span>`}</td></tr>`)}</tbody></table></div>`
            }
            <p className="muted small" style=${{ margin: 0 }}>Years come from the dated jobs that mention each skill (overlaps counted once); "stated" means the resume says so and its dates allow it.</p>
            ${p.txt ? html`<div className="tsresume">${tsHighlight(p.txt, terms)}</div>` : html`<p className="muted">No resume text on file; the search used the card only.</p>`}
          </div>`
    }
  <//>`;
}
/* v36.1: a Dice person, from what the Dice search showed */
function TsDicePreview({ r, cfg, onClose, canAts, portalKey }) {
  const status = r.ats
    ? r.new
      ? 'Saved to the ATS by this search' + (r.q ? '. Their full Dice profile (email, phone, resume) is being read and added.' : '.')
      : 'Already in the ATS.'
    : r.cand
      ? 'In the consultant database, not in the ATS yet.'
      : cfg && cfg.save === 'off'
        ? 'Not saved: Dice people are not saved by themselves (Sourcing connections). Select them and use “Save to the ATS”.'
        : cfg && cfg.save === 'fit'
          ? 'Not saved: only people who fit at least ' + cfg.min + '% are saved by themselves. Select them and use “Save to the ATS”.'
          : 'Not in the ATS.';
  return html`<${Modal} wide title=${r.n} onClose=${onClose} foot=${html`${r.url && html`<a className="btn ghost" href=${r.url} target="_blank" rel="noopener noreferrer">Open on Dice</a>`}${r.ats && canAts && html`<a className="btn ghost" href=${'#/portal/' + portalKey + '/ats?c=' + encodeURIComponent(r.ats)}>Open in the ATS</a>`}<button type="button" className="btn" onClick=${onClose}>Close</button>`}>
    <div className="stack tsdiceview">
      <div className="muted small">${[r.ti, r.loc, r.auth, r.years ? r.years + ' years' : '', 'Dice'].filter(Boolean).join(' · ')}</div>
      ${(r.e || r.ph) && html`<div className="small">${[r.e, r.ph].filter(Boolean).join(' · ')}</div>`}
      <div className=${'note ' + (r.ats ? 'ok' : 'info')}><span>${status}</span></div>
      ${r.sk && html`<div className="tschips">${String(r.sk).split(/[,;|]+/).map(s => s.trim()).filter(Boolean).slice(0, 30).map(s => html`<span key=${s} className=${'chip' + (r.hits.some(h => h.s.toLowerCase() === s.toLowerCase()) ? ' ok' : '')}>${s}</span>`)}</div>`}
      <p className="muted small" style=${{ margin: 0 }}>Fit ${r.score}: from the Dice search summary (title, skills, total experience, last active). A summary has no years per skill: a skill counts when it is named and the total experience allows the years asked for.${r.upd ? ' Last active on Dice ' + fmtDay(r.upd) + '.' : ''}</p>
    </div>
  <//>`;
}
function TalentSearchPage({ q }) {
  const P = usePortal();
  const toast = useToast();
  const [f, setF] = useState(tsEmpty());
  const [res, setRes] = useState(null);
  const [dres, setDres] = useState(null);
  const gen = useRef(0); // v83: which search the answers on screen belong to (a late answer from an earlier search or after Clear is dropped)
  const [dice, setDice] = useState(null);
  const [cat, setCat] = useState(null); // v68: the domain catalogs
  const [domPanel, setDomPanel] = useState(null);
  const [svc, setSvc] = useState(null);
  const [svEdit, setSvEdit] = useState(null);
  const [tab, setTab] = useState('all');
  const [busy, setBusy] = useState('');
  const [sel, setSel] = useState({});
  const [view, setView] = useState(null);
  const [dview, setDview] = useState(null);
  const [saved, setSaved] = useState([]);
  const [saving, setSaving] = useState(null);
  const [jdOpen, setJdOpen] = useState(false);
  const [jd, setJd] = useState('');
  const [toJob, setToJob] = useState(null);
  const jobs = useCol('org/site/jobs', 'ti:asc');
  const openJobs = (jobs.docs || []).filter(j => j.open !== false);
  const roles = P.roles && P.roles.length ? P.roles : [P.roleName];
  const canAts = roles.includes('admin') || roles.includes('hr') || P.isAdmin;
  const portalKey = (location.hash.match(/#\/portal\/([a-z]+)/) || [])[1] || 'admin';
  const diceOn = !!(dice && dice.on);
  const loadSaved = () =>
    api('ts_saved').then(
      r => {
        setSaved(r.rows);
        setDice(r.dice || null);
        setSvc(r.save || null);
        setCat(r.dom || null);
      },
      () => {}
    );
  useEffect(() => {
    loadSaved();
  }, []);
  useEffect(() => {
    if (q && q.saved && saved.length) {
      const s = saved.find(x => x.id === q.saved);
      if (s) run({ ...tsEmpty(), ...s.q });
    }
  }, [q && q.saved, saved.length]);
  // v37.2: opened from a requisition (…/search?job=<id>): its must-have skills (with the years its description asks)
  // become the search
  const [fromJob, setFromJob] = useState('');
  useEffect(() => {
    if (!(q && q.job) || fromJob === q.job) return;
    const j = (jobs.docs || []).find(x => x.id === q.job);
    if (!j) return;
    setFromJob(q.job);
    const typed = String(j.sk || '')
      .split(/[,;|]+/)
      .map(x => x.trim())
      .filter(Boolean)
      .slice(0, 6);
    const text = [j.ti, j.d, j.sk ? 'Skills: ' + j.sk : ''].filter(Boolean).join('\n');
    (text.length >= 40 ? api('ts_fromjd', { jd: text }).then(r => r.skills, () => []) : Promise.resolve([])).then(found => {
      const yrs = Object.fromEntries(found.map(x => [String(x.s).toLowerCase(), x.y || '']));
      const skills = typed.length ? typed.map(s2 => ({ s: s2, y: yrs[s2.toLowerCase()] || '' })) : found.slice(0, 6).map(x => ({ s: x.s, y: x.y || '' }));
      toast('Searching for ' + j.ti + (j.code ? ' (' + j.code + ')' : '') + ': its skills are filled in. Change the years and search again as you like.');
      run({ ...tsEmpty(), skills: skills.length ? skills : tsEmpty().skills, q: skills.length ? '' : j.ti });
    });
  }, [q && q.job, (jobs.docs || []).length]);
  const clean = x => ({ ...x, skills: (x.skills || []).filter(s => String(s.s || '').trim()).map(s => ({ s: s.s.trim(), y: +s.y || 0 })) });
  const searchDice = async (use, page, g = gen.current) => {
    setDres(d => ({ ...(page > 1 && d ? d : { rows: [] }), busy: true, err: '' }));
    try {
      const r = await api('ts_dice', { f: clean(use), page }, { timeout: 130000 });
      if (g !== gen.current) return;
      setDres(d => {
        const prev = page > 1 && d ? d.rows : [];
        return { ...r, f: use, busy: false, rows: [...prev, ...r.rows.filter(x => !prev.some(y => y.k === x.k))], saved: (page > 1 && d ? d.saved || 0 : 0) + (r.saved || 0), found: (page > 1 && d ? d.found || 0 : 0) + (r.found || 0) };
      });
    } catch (e) {
      if (g !== gen.current) return;
      setDres(d => ({ ...(d || { rows: [] }), busy: false, err: errText(e) }));
    }
  };
  const run = async (ff, reindex) => {
    const g = ++gen.current;
    const use = ff || f;
    if (ff) setF(ff);
    setBusy('search');
    setSel({});
    setTab('all');
    const withDice = diceOn && !!(use.src && use.src.dice);
    setDres(withDice ? { busy: true, rows: [] } : null);
    if (withDice) searchDice(use, 1, g);
    try {
      if (reindex) await api('ts_index', { full: false }, { timeout: 160000 });
      const r = await api('ts_search', { f: clean(use) }, { timeout: 100000 });
      if (g === gen.current) setRes(r);
    } catch (e) {
      if (g === gen.current) toast(errText(e), true);
    }
    if (g === gen.current) setBusy('');
  };
  const setSkill = (i, k, v) => setF({ ...f, skills: f.skills.map((s, j) => (j === i ? { ...s, [k]: v } : s)) });
  const fromJd = async () => {
    try {
      const r = await api('ts_fromjd', { jd });
      setF({ ...f, skills: r.skills.length ? r.skills.map(s => ({ s: s.s, y: s.y || '' })) : f.skills, loc: f.loc || (r.loc || '') });
      setJdOpen(false);
      toast('Skills from the job description: set the years you need, then Search.');
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const save = async () => {
    if (!saving || !saving.name.trim()) return;
    try {
      await api('ts_save', { id: saving.id || '', name: saving.name, alert: saving.alert, f: clean(f) });
      toast(saving.alert ? 'Saved. New matches are emailed to you once a day.' : 'Saved.');
      setSaving(null);
      loadSaved();
    } catch (e) {
      toast(errText(e), true);
    }
  };

  // the rows: the portal's, then Dice's (a Dice person the portal already shows is shown once, "also: Dice")
  const lrows = (res && res.rows) || [];
  const drAll = (dres && dres.rows) || [];
  const byKey = {};
  const byEmail = {};
  lrows.forEach(r => {
    byKey[r.k] = r;
    if (r.e) byEmail[String(r.e).toLowerCase()] = byEmail[String(r.e).toLowerCase()] || r;
  });
  const alsoDice = {};
  const drows = drAll.filter(d => {
    const hit = (d.ats && byKey['ats:' + d.ats]) || (d.cand && byKey['cand:' + d.cand]) || (d.e && byEmail[String(d.e).toLowerCase()]);
    if (hit) {
      alsoDice[hit.k] = d;
      return false;
    }
    return true;
  });
  const order = (a, b) => (f.sort === 'recent' ? (b.upd || 0) - (a.upd || 0) : f.sort === 'years' ? (b.years || 0) - (a.years || 0) : b.score - a.score || (b.upd || 0) - (a.upd || 0));
  const merged = dres ? [...lrows, ...drows].sort(order) : lrows;
  const shown = tab === 'portal' ? lrows : tab === 'dice' ? [...drAll].sort(order) : merged;
  const everyRow = [...lrows, ...drAll];
  const pickedRows = everyRow.filter((r, i) => sel[r.k] && everyRow.findIndex(x => x.k === r.k) === i);
  const picked = pickedRows.map(r => r.k);
  // what the server needs for the chosen rows: Dice people in the ATS by their ATS record, the others with their details
  const payload = rows => ({
    keys: rows.map(r => (r.kind !== 'ats' && r.ats ? 'ats:' + r.ats : r.k)),
    dice: Object.fromEntries(rows.filter(r => r.kind === 'dice' && !r.ats).map(r => [r.id, { n: r.n, e: r.e, ph: r.ph, ti: r.ti, loc: r.loc, auth: r.auth, sk: r.sk, years: r.years, url: r.url, score: r.score }])),
  });
  const notInAts = pickedRows.filter(r => r.kind !== 'ats' && !r.ats);
  const addToJob = async () => {
    if (!toJob || !toJob.job) return;
    setBusy('tojob');
    try {
      const r = await api('ts_tojob', { job: toJob.job, ...payload(pickedRows) });
      toast(`${r.added.length} added to ${r.job}${r.skipped.length ? '; ' + r.skipped.join('; ') : ''}.`);
      setToJob(null);
      setSel({});
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const toAts = async () => {
    setBusy('toats');
    try {
      const r = await api('ts_toats', payload(notInAts));
      toast(`${r.added.length} saved to the ATS${r.have.length ? ', ' + r.have.length + ' already there' : ''}${r.queued ? '; their Dice profiles are being read' : ''}.`);
      const got = Object.fromEntries(r.added.filter(a => a.k).map(a => [a.k, a.id]));
      if (Object.keys(got).length) {
        setDres(d => (d ? { ...d, rows: d.rows.map(x => (got[x.k] ? { ...x, ats: got[x.k], new: true, q: !!r.queued } : x)) } : d));
        setRes(x => (x ? { ...x, rows: x.rows.map(row => (got[row.k] ? { ...row, ats: got[row.k], new: true } : row)) } : x));
      }
      setSel({});
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const saveCfg = async () => {
    try {
      const r = await api('ts_cfg_save', { save: svEdit.save, min: +svEdit.min || 60 });
      setSvc({ ...svc, ...r });
      setSvEdit(null);
      toast(r.save === 'off' ? 'Saved: nobody is saved into the ATS by themselves.' : 'Saved: ' + (r.save === 'fit' ? 'people who fit at least ' + r.min + '%' : 'everyone found') + ' is saved into the ATS.');
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const saveLine = svc ? (svc.save === 'off' ? 'Nobody is saved into the ATS by themselves: choose people and use “Save to the ATS”.' : svc.save === 'fit' ? 'The people found who fit at least ' + svc.min + '% are saved into the ATS.' : 'Everyone found is saved into the ATS.') : '';
  const terms = tsTerms(f.q);
  const searched = !!(res || dres);
  const diceLine = () => {
    if (!dres) return null;
    if (dres.busy && !drAll.length) return html`<span className="muted small tsdicestate"><span className="spin" /> Searching Dice…</span>`;
    if (dres.err && !drAll.length) return html`<span className="small tsdicestate tsdiceerr">Dice: ${dres.err}</span>`;
    const where = (dres.locs || []).length ? ' in ' + dres.locs.join(' / ') : '';
    return html`<span className="muted small tsdicestate">Dice: ${dres.found || 0} found for “${dres.q}”${where}${dres.saved ? ', ' + dres.saved + ' saved to the ATS' : ''}${dres.queued ? ' (their profiles are being read)' : ''}${dres.busy ? ' · loading more…' : ''}</span>`;
  };
  const rowLocal = r => {
    const ad = alsoDice[r.k];
    const also = [...(r.also || []).map(a => a.src), ...(ad ? ['Dice'] : [])];
    return html`<li key=${r.k}>
      <input type="checkbox" checked=${!!sel[r.k]} onChange=${e => setSel({ ...sel, [r.k]: e.target.checked })} aria-label=${'Select ' + r.n} />
      <div className="tsmain" onClick=${() => setView(r.k)}>
        <div className="t"><b>${r.n}</b> <span className="muted small">${[r.ti, r.loc, r.auth, r.years ? r.years + ' yrs' : ''].filter(Boolean).join(' · ')}</span></div>
        <div className="tschips">${r.hits.map(h => html`<span key=${'h' + h.s} className="chip ok" title=${h.c ? 'Stated on the resume' : 'From the dated jobs'}>${h.s} ${h.y}y</span>`)}${r.top.filter(t => !r.hits.some(h => h.s.startsWith(t.s))).slice(0, 5).map(t => html`<span key=${'t' + t.s} className="chip">${t.s}${t.y ? ' ' + t.y + 'y' : ''}</span>`)}</div>
        <${DomChips} dom=${r.dom} small />
        ${r.snip && html`<div className="muted small tssnip">${tsHighlight(r.snip, terms)}</div>`}
      </div>
      <div className="tsside"><span className=${tsScoreChip(r.score)}>${r.score}</span><span className="muted small">${r.src}</span>${also.length ? html`<span className="muted small" title="The same person elsewhere">also: ${also.join(', ')}</span>` : ''}${r.kind !== 'ats' ? html`<span className=${'small tsatsst' + (r.ats ? (r.new ? ' new' : '') : ' muted')}>${r.ats ? (r.new ? 'Saved to the ATS' : 'In the ATS') : 'Not in the ATS'}</span>` : ''}<span className="muted small">${r.upd ? fmtDay(r.upd) : ''}</span></div>
    </li>`;
  };
  const rowDice = r => html`<li key=${r.k} className="tsdicerow">
      <input type="checkbox" checked=${!!sel[r.k]} onChange=${e => setSel({ ...sel, [r.k]: e.target.checked })} aria-label=${'Select ' + r.n} />
      <div className="tsmain" onClick=${() => setDview(r)}>
        <div className="t"><b>${r.n}</b> <span className="muted small">${[r.ti, r.loc, r.auth, r.years ? r.years + ' yrs' : ''].filter(Boolean).join(' · ')}</span></div>
        <div className="tschips">${r.hits.map(h => html`<span key=${'h' + h.s} className="chip ok" title="Named on the Dice profile">${h.s}</span>`)}${r.top.filter(t => !r.hits.some(h => h.s.toLowerCase() === t.s.toLowerCase())).slice(0, 5).map(t => html`<span key=${'t' + t.s} className="chip">${t.s}</span>`)}</div>
      </div>
      <div className="tsside"><span className=${tsScoreChip(r.score)}>${r.score}</span><span className="chip dice">Dice</span><span className="muted small">${r.ats ? (r.new ? 'Saved to the ATS' : 'In the ATS') : r.cand ? 'In the consultant database' : 'Not in the ATS'}</span><span className="muted small">${r.upd ? 'active ' + fmtDay(r.upd) : ''}</span></div>
    </li>`;
  const srcPicks = [...TS_SRC, ...(diceOn ? [['dice', 'Dice (live)']] : [])];
  return html`<div className="stack tspage">
    <section className="panel form tsform">
      <div className="tshead">
        <div><h3 style=${{ margin: 0 }}>Talent search</h3><span className="muted small">Every resume in the portal: ATS candidates, the consultant database and the portals${diceOn ? ', and Dice (live)' : ''}${res && res.index ? ' · ' + res.index.n + ' people indexed, updated ' + fmtTs(res.index.at) : ''}</span></div>
        <div className="actions"><button type="button" className="btn ghost sm" onClick=${() => setJdOpen(true)}><${Icon} n="spark" />From a job description</button></div>
      </div>
      ${
        saved.length > 0 &&
        html`<div className="tssaved"><span className="muted small">My saved searches:</span>${saved.map(s => html`<span key=${s.id} className="chip tschip"><button type="button" className="linkish" onClick=${() => run({ ...tsEmpty(), ...s.q })}>${s.name}</button>${s.q && s.q.src && s.q.src.dice ? html` <span className="muted" title="Dice is searched too">+ Dice</span>` : ''}${s.alert ? html` <span title="New matches are emailed to you daily">🔔</span>` : ''}<button type="button" className="linkish" aria-label=${'Delete ' + s.name} onClick=${() => api('ts_delete', { id: s.id }).then(loadSaved)}>×</button></span>`)}</div>`
      }
      <${Field} label="Keywords" hint='AND, OR, NOT, brackets, "exact phrases", prefix* and -word. Example: java AND (spring OR "spring boot") NOT intern'><input value=${f.q} onInput=${e => setF({ ...f, q: e.target.value })} onKeyDown=${e => { if (e.key === 'Enter') run(); }} placeholder='java AND (spring OR "spring boot")' /><//>
      <div className="tsskillrows">
        <span className="lbl">Skills with years of experience</span>
        ${f.skills.map(
          (s, i) => html`<div key=${i} className="tsskill">
            <input value=${s.s} onInput=${e => setSkill(i, 's', e.target.value)} placeholder="Skill, e.g. Java" aria-label="Skill" />
            <input type="number" min="0" max="40" step="0.5" value=${s.y} onInput=${e => setSkill(i, 'y', e.target.value)} placeholder="years" aria-label="Minimum years" />
            <span className="muted small">+ years</span>
            <button type="button" className="btn ghost sm" aria-label="Remove" onClick=${() => setF({ ...f, skills: f.skills.length > 1 ? f.skills.filter((x, j) => j !== i) : [{ s: '', y: '' }] })}>×</button>
          </div>`
        )}
        <button type="button" className="btn ghost sm" onClick=${() => setF({ ...f, skills: [...f.skills, { s: '', y: '' }] })}><${Icon} n="plus" />Add a skill</button>
      </div>
      <div className="row3">
        <${Field} label="Location" hint="City or state; several with commas: NJ, Dallas"><input value=${f.loc} onInput=${e => setF({ ...f, loc: e.target.value })} /><//>
        <${Field} label="Total experience (years)"><div className="tsrange"><input type="number" min="0" value=${f.ymin} onInput=${e => setF({ ...f, ymin: e.target.value })} placeholder="min" aria-label="Minimum years" /><span>to</span><input type="number" min="0" value=${f.ymax} onInput=${e => setF({ ...f, ymax: e.target.value })} placeholder="max" aria-label="Maximum years" /></div><//>
        <${Field} label="Resume updated"><select value=${f.upd} onChange=${e => setF({ ...f, upd: e.target.value })}><option value="">Any time</option><option value="30">Last 30 days</option><option value="90">Last 3 months</option><option value="180">Last 6 months</option><option value="365">Last year</option></select><//>
      </div>
      <div className="row3 tsdomrow">
        <${Field} label="Technology domain" hint="Recognized on the resume: Java, .NET, SAP, Salesforce, data, cloud…"><select value=${f.dom || ''} onChange=${e => setF({ ...f, dom: e.target.value })} aria-label="Technology domain"><option value="">Any</option>${((cat && cat.tech) || []).map(d => html`<option key=${d.k} value=${d.k}>${d.n}</option>`)}</select><//>
        <${Field} label="Industry domain" hint="Banking, capital markets, insurance, healthcare, retail…"><select value=${f.ind || ''} onChange=${e => setF({ ...f, ind: e.target.value })} aria-label="Industry domain"><option value="">Any</option>${((cat && cat.ind) || []).map(d => html`<option key=${d.k} value=${d.k}>${d.n}</option>`)}</select><//>
        <${Field} label=" "><button type="button" className="btn ghost sm" onClick=${() => { setDomPanel({ busy: true }); api('ts_domains').then(r => setDomPanel(r), e => { toast(errText(e), true); setDomPanel(null); }); }}><${Icon} n="tag" />Domains across the index</button><//>
      </div>
      ${domPanel && html`<div className="note tsdompanel">${domPanel.busy ? html`<${Spinner} />` : html`<div className="stack" style=${{ gap: 6 }}>
        <div className="small"><b>${domPanel.n} people in the index.</b> How many show each domain on their resume (a term named once is not a domain; the evidence is on each person's chips).</div>
        <div className="domchips">${(domPanel.cat.tech || []).map(d => html`<button type="button" key=${d.k} className=${'chip dmt' + (f.dom === d.k ? ' on' : '')} onClick=${() => setF({ ...f, dom: f.dom === d.k ? '' : d.k })}>${d.n}<i>${domPanel.counts.tech[d.k] || 0}</i></button>`)}</div>
        <div className="domchips">${(domPanel.cat.ind || []).map(d => html`<button type="button" key=${d.k} className=${'chip dmi' + (f.ind === d.k ? ' on' : '')} onClick=${() => setF({ ...f, ind: f.ind === d.k ? '' : d.k })}>${d.n}<i>${domPanel.counts.ind[d.k] || 0}</i></button>`)}</div>
        <div className="actions"><button type="button" className="btn ghost sm" disabled=${busy === 'dom'} onClick=${async () => { setBusy('dom'); try { const r = await api('ts_dom_rescan', {}, { timeout: 160000 }); toast('Domains read again on ' + r.n + ' resumes.'); setDomPanel({ busy: true }); setDomPanel(await api('ts_domains')); } catch (e) { toast(errText(e), true); } setBusy(''); }}>${busy === 'dom' ? 'Reading…' : 'Read every resume again'}</button><button type="button" className="btn ghost sm" onClick=${() => setDomPanel(null)}>Hide</button></div>
      </div>`}</div>`}
      <div className="row2">
        <${Field} label="Work authorization" hint="Leave empty for everyone">
          <div className="portalpicks wide">${TS_AUTH.map(([k, n]) => html`<label key=${k} className=${'pick' + (f.auth.includes(k) ? ' on' : '')}><input type="checkbox" checked=${f.auth.includes(k)} onChange=${e => setF({ ...f, auth: e.target.checked ? [...f.auth, k] : f.auth.filter(x => x !== k) })} /><span>${n}</span></label>`)}</div>
        <//>
        <${Field} label="Search in" hint=${!diceOn && dice && !dice.set && P.isAdmin ? 'Connect Dice under Sourcing connections to search it here too.' : ''}>
          <div className="portalpicks wide">${srcPicks.map(([k, n]) => html`<label key=${k} className=${'pick' + (f.src[k] ? ' on' : '')}><input type="checkbox" checked=${!!f.src[k]} onChange=${e => setF({ ...f, src: { ...f.src, [k]: e.target.checked } })} /><span>${n}</span></label>`)}</div>
        <//>
      </div>
      ${saveLine && html`<div className="muted small tssaveline"><${Icon} n="users" /><span>${saveLine}</span>${svc.can && html`<button type="button" className="linkish" onClick=${() => setSvEdit({ save: svc.save, min: svc.min })}>Change</button>`}</div>`}
      <div className="actions">
        <button type="button" className="btn" disabled=${busy === 'search'} onClick=${() => run()}><${Icon} n="search" />${busy === 'search' ? 'Searching…' : 'Search'}</button>
        <select value=${f.sort} onChange=${e => setF({ ...f, sort: e.target.value })} aria-label="Sort" style=${{ maxWidth: 200 }}><option value="score">Best match first</option><option value="recent">Most recent first</option><option value="years">Most experience first</option></select>
        <button type="button" className="btn ghost" onClick=${() => setSaving({ name: '', alert: true })}>Save this search</button>
        <button type="button" className="btn ghost" onClick=${() => { gen.current++; setF(tsEmpty()); setRes(null); setDres(null); setBusy(b => (b === 'search' ? '' : b)); }}>Clear</button>
        <button type="button" className="btn ghost sm" disabled=${!!busy} onClick=${() => run(null, true)} title="Read new and changed resumes now">Refresh the index</button>
      </div>
    </section>
    ${
      searched &&
      html`<section className="panel tsresults">
        <div className="tshead">
          <b>${merged.length} ${merged.length === 1 ? 'person' : 'people'}${res && res.total > lrows.length ? ' (the portal’s top ' + lrows.length + ' of ' + res.total + ')' : ''}</b>
          <span className="muted small">${res && res.saved ? res.saved + ' saved to the ATS · ' : ''}${res ? res.took + ' ms' : ''}${res && res.index && res.index.left ? ' · ' + res.index.left + ' resumes still being read: refresh in a minute' : ''}</span>
        </div>
        ${
          dres &&
          html`<div className="tssrcbar">
            <div className="seg" style=${{ marginBottom: 0 }}>
              <button type="button" className=${tab === 'all' ? 'on' : ''} onClick=${() => setTab('all')}>All ${merged.length}</button>
              <button type="button" className=${tab === 'portal' ? 'on' : ''} onClick=${() => setTab('portal')}>In the portal ${lrows.length}</button>
              <button type="button" className=${tab === 'dice' ? 'on' : ''} onClick=${() => setTab('dice')}>Dice ${drAll.length}</button>
            </div>
            ${diceLine()}
          </div>`
        }
        ${
          picked.length > 0 &&
          html`<div className="tsbulk"><b>${picked.length} selected</b>${canAts && html`<button type="button" className="btn sm" onClick=${() => setToJob({ job: (openJobs[0] && openJobs[0].id) || '' })}>Add to a job…</button>`}${canAts && notInAts.length > 0 && html`<button type="button" className="btn sm" disabled=${busy === 'toats'} onClick=${toAts}>${busy === 'toats' ? 'Saving…' : 'Save ' + notInAts.length + ' to the ATS'}</button>`}<button type="button" className="btn ghost sm" onClick=${() => copyText(toast, pickedRows.filter(r => r.e).map(r => r.e).join(', '))}>Copy emails</button><button type="button" className="btn ghost sm" onClick=${() => setSel({})}>Clear</button></div>`
        }
        ${
          shown.length
            ? html`<ul className="list tsrows">${shown.map(r => (r.kind === 'dice' ? rowDice(r) : rowLocal(r)))}</ul>`
            : dres && dres.busy && tab !== 'portal'
              ? html`<div className="muted small" style=${{ padding: '8px 2px' }}>${tab === 'dice' ? 'Searching Dice…' : 'Nobody in the portal matches; searching Dice…'}</div>`
              : html`<${Empty} title="Nobody matches">Loosen a filter: fewer years, more locations, or OR instead of AND.<//>`
        }
        ${dres && dres.err && drAll.length > 0 && html`<p className="small tsdiceerr" style=${{ margin: '8px 0 0' }}>Dice: ${dres.err}</p>`}
        ${dres && dres.more && tab !== 'portal' && html`<div className="actions" style=${{ marginTop: 8 }}><button type="button" className="btn ghost sm" disabled=${dres.busy} onClick=${() => searchDice(dres.f || f, (dres.page || 1) + 1)}>${dres.busy ? 'Loading…' : 'More from Dice'}</button></div>`}
      </section>`
    }
    ${view && html`<${TsPreview} k=${view} ats=${(lrows.find(x => x.k === view) || {}).ats || ''} terms=${terms} canAts=${canAts} portalKey=${portalKey} onClose=${() => setView(null)} />`}
    ${
      svEdit &&
      html`<${Modal} title="Saving into the ATS" onClose=${() => setSvEdit(null)} foot=${html`<button type="button" className="btn ghost" onClick=${() => setSvEdit(null)}>Cancel</button><button type="button" className="btn" onClick=${saveCfg}>Save</button>`}>
        <div className="form tssaveform">
          <p className="muted small" style=${{ margin: 0 }}>Who Talent search saves into the ATS talent pool, from the consultant database, the portals and Dice. Nobody is saved twice. Saved people show in the ATS under Talent pool › Saved from searches until someone works with them; the screening agent leaves them alone.</p>
          <${Field} label="Save the people found"><select value=${svEdit.save} onChange=${e => setSvEdit({ ...svEdit, save: e.target.value })}><option value="all">Everyone found</option><option value="fit">Only those who fit</option><option value="off">Nobody (save them by hand)</option></select><//>
          <${Field} label="…who fit at least (%)" hint="Also the fit at which Dice profiles are read in full"><input type="number" min="30" max="95" value=${svEdit.min} onInput=${e => setSvEdit({ ...svEdit, min: e.target.value })} /><//>
        </div>
      <//>`
    }
    ${dview && html`<${TsDicePreview} r=${drAll.find(x => x.k === dview.k) || dview} cfg=${dres && dres.cfg} canAts=${canAts} portalKey=${portalKey} onClose=${() => setDview(null)} />`}
    ${
      saving &&
      html`<${Modal} title="Save this search" onClose=${() => setSaving(null)} foot=${html`<button type="button" className="btn ghost" onClick=${() => setSaving(null)}>Cancel</button><button type="button" className="btn" onClick=${save}>Save</button>`}>
        <div className="form">
          <${Field} label="Name"><input value=${saving.name} onInput=${e => setSaving({ ...saving, name: e.target.value })} placeholder="Java + AWS, NJ, 5+ years" /><//>
          <label className="check"><input type="checkbox" checked=${saving.alert} onChange=${e => setSaving({ ...saving, alert: e.target.checked })} /><span>Email me new matches once a day${diceOn && f.src.dice ? ' (Dice included)' : ''}</span></label>
        </div>
      <//>`
    }
    ${
      jdOpen &&
      html`<${Modal} wide title="Search from a job description" onClose=${() => setJdOpen(false)} foot=${html`<button type="button" className="btn ghost" onClick=${() => setJdOpen(false)}>Cancel</button><button type="button" className="btn" onClick=${fromJd}>Use its skills</button>`}>
        <div className="form"><${Field} label="Job description" hint="Its skills (and the years it asks for) become the search."><textarea rows="12" value=${jd} onInput=${e => setJd(e.target.value)} /><//></div>
      <//>`
    }
    ${
      toJob &&
      html`<${Modal} title=${'Add ' + picked.length + ' to a job'} onClose=${() => setToJob(null)} foot=${html`<button type="button" className="btn ghost" onClick=${() => setToJob(null)}>Cancel</button><button type="button" className="btn" disabled=${busy === 'tojob' || !toJob.job} onClick=${addToJob}>${busy === 'tojob' ? 'Adding…' : 'Add to the job'}</button>`}>
        <div className="form">
          <${Field} label="Open job"><select value=${toJob.job} onChange=${e => setToJob({ job: e.target.value })}>${openJobs.map(j => html`<option key=${j.id} value=${j.id}>${j.ti}</option>`)}</select><//>
          <p className="muted small" style=${{ margin: 0 }}>Each person becomes an application on the job in the ATS, with their resume (Dice people: their Dice profile is read and added). With the screening agent on, it checks them like any new candidate.</p>
        </div>
      <//>`
    }
  </div>`;
}
