/* ================= v38.1 Import with preview (blueprint I01, "import dry run") =================
   A spreadsheet or rows pasted from Excel or Google Sheets are checked row by row before anything is saved: the columns
   are matched to fields (guessed, corrected by the person), every row shows what it would do (add, update field by
   field, join an earlier row, skip) with the values it could not read and the likely duplicates, and the person decides
   where the guess is wrong or fixes a value. Then the import runs in steps, with a result summary, the rows that were
   not imported as a CSV, and Undo. Routes imp_* (api/imports.php). Staff open it as "Import with preview" (Operations);
   recruiters and recruiting team at #/portal/rec/import; other pages link here with ?t=<kind> (and ?job= for the ATS). */

const IMP_ACT = {
  new: ['New', 'ok'],
  upd: ['Update', 'info'],
  merge: ['Joins an earlier row', 'info'],
  same: ['No change', ''],
  skip: ['Skipped', ''],
  err: ['Problem', 'red'],
};
const IMP_ST = {
  draft: ['Not imported yet', ''],
  running: ['Stopped part way', 'amber'],
  done: ['Imported', 'ok'],
  undone: ['Undone', ''],
  partundone: ['Partly undone', 'amber'],
  undoing: ['Being undone', 'amber'],
};
const IMP_POL = [
  ['fill', 'Fill empty fields', 'Values already there stay; empty fields are filled. The differences are listed.'],
  ['over', 'Replace values', 'Values in the file replace what is there (empty cells never erase anything).'],
  ['skip', 'Skip those rows', 'Records already here are left as they are.'],
];
const IMP_FILTERS = [
  ['all', 'All rows'],
  ['new', 'New'],
  ['upd', 'Updates'],
  ['same', 'No change'],
  ['likely', 'Likely duplicates'],
  ['err', 'Problems'],
  ['warn', 'Warnings'],
  ['skip', 'Skipped'],
  ['fixed', 'Fixed by hand'],
];
/** The import page in the portal the person is in (a staff portal, or the recruiting pages of the employee portal). */
const impBase = () => {
  const m = /^#\/portal\/(admin|hr|acct)\//.exec(location.hash || '');
  return m ? '#/portal/' + m[1] + '/import' : '#/portal/rec/import';
};
const impHref = (t, extra) => {
  const qs = new URLSearchParams({ ...(t ? { t } : {}), ...(extra || {}) }).toString();
  return impBase() + (qs ? '?' + qs : '');
};
/** Where the records of a kind live, in the same portal. */
const impPageHref = T => {
  const m = /^#\/portal\/(admin|hr|acct)\//.exec(location.hash || '');
  if (m) return '#/portal/' + m[1] + '/' + T.page + (T.k === 'mail' ? '?tab=contacts' : '');
  return T.mpage ? '#/portal/' + T.mpage + (T.k === 'mail' ? '?tab=contacts' : '') : '';
};
const impNum = n => (+n || 0).toLocaleString();
/** May this person import this kind of record (the server's answer in "me")? */
const impCan = k => !!(Cap.imp && Cap.imp.includes(k));
const impRows = (n, T) => `${impNum(n)} ${n === 1 ? 'row' : 'rows'}`;
/** What the import still needs from the column matching ('' when nothing). */
function impNeed(T, map) {
  const has = new Set(Object.values(map || {}));
  if (T.need === 'n|e') return has.has('n') || has.has('e') || has.has('first') || has.has('last') ? '' : 'Match a column to Contact name or Email.';
  const f = T.f.find(x => x.k === T.need);
  if (has.has(T.need) || (T.need === 'n' && (has.has('first') || has.has('last')))) return '';
  return `Match a column to ${f ? f.l : T.need}${T.need === 'n' && T.f.some(x => x.k === 'first') ? ' (or to First name and Last name)' : ''}.`;
}
async function impSaveCsv(toast, route, body) {
  try {
    const r = await api(route, body);
    await saveDownload(r.name || 'import.csv', new Blob([r.csv], { type: 'text/csv;charset=utf-8' }));
    return r;
  } catch (e) {
    if (!e || e.code !== 'declined') toast(errText(e), true);
  }
  return null;
}

function ImportPage({ q }) {
  const toast = useToast();
  const [meta, setMeta] = useState(null);
  const [err, setErr] = useState(null);
  const [tk, setTk] = useState((q && q.t) || '');
  const [run, setRun] = useState(null); // the file being imported (the server's view of it)
  const [step, setStep] = useState('pick'); // pick | cols | check | go | done
  const [map, setMap] = useState({});
  const [opts, setOpts] = useState({ upd: 'fill' });
  const [fixes, setFixes] = useState({});
  const [acts, setActs] = useState({});
  const [hist, setHist] = useState(null);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [undoOf, setUndoOf] = useState(null);
  const loadHist = (a = all) =>
    api('imp_runs', { all: a }).then(
      r => setHist(r),
      () => setHist({ runs: [], admin: false })
    );
  const load = () =>
    api('imp_targets', {}).then(
      r => {
        setMeta(r);
        setErr(null);
      },
      e => setErr(e)
    );
  useEffect(() => {
    load();
    loadHist();
  }, []);
  // ?t= picks the kind (from a link on another page), ?id= opens an import from the list
  useEffect(() => {
    if (q && q.t) setTk(q.t);
  }, [q && q.t]);
  useEffect(() => {
    if (q && q.id) open(q.id);
  }, [q && q.id]);
  const T = meta && run ? meta.targets.find(x => x.k === run.t) : null;
  const adopt = (r, keep) => {
    setRun(r);
    setTk(r.t);
    if (!keep) {
      setMap({ ...(r.map || {}) });
      setOpts({ upd: 'fill', ...(r.opts || {}), ...(r.t === 'ats' && q && q.job && !(r.opts && r.opts.job) ? { job: q.job } : {}) });
      setFixes({ ...(r.fixes || {}) });
      setActs({ ...(r.acts || {}) });
    }
  };
  const open = async id => {
    try {
      const r = await api('imp_get', { id });
      adopt(r);
      setStep(r.st === 'draft' ? 'cols' : r.st === 'running' && r.canGo ? 'go' : 'done');
      scrollTo(0, 0);
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const uploaded = r => {
    adopt(r);
    setStep('cols');
    loadHist();
    scrollTo(0, 0);
  };
  const reset = () => {
    setRun(null);
    setStep('pick');
    setMap({});
    setFixes({});
    setActs({});
    setOpts({ upd: 'fill' });
    loadHist();
  };
  const changeSheet = async (sheet, hrow) => {
    setBusy(true);
    try {
      const r = await api('imp_set', { id: run.id, sheet, ...(hrow !== undefined ? { hrow } : {}) });
      adopt(r);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const go = async () => {
    setBusy(true);
    try {
      await api('imp_go', { id: run.id, map, opts, fixes, acts });
      setStep('go');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const doUndo = async r => {
    try {
      // a big undo on a slow host comes back in parts ("more"); each call continues where the last one stopped
      let out = null;
      for (let k = 0; k < 500; k++) {
        out = await api('imp_undo', { id: r.id }, { timeout: 180000 });
        if (!out.more) break;
      }
      const x = out.res || {};
      toast(`Undone: ${impNum(x.removed)} removed, ${impNum(x.restored)} put back${x.kept ? `, ${impNum(x.kept)} kept because they changed since` : ''}.`);
      setUndoOf(null);
      if (run && run.id === r.id) adopt(out.run, true);
      loadHist();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  if (err) return html`<${LoadError} error=${err} onRetry=${load} />`;
  if (!meta) return html`<${Spinner} label="Loading…" />`;
  if (!meta.targets.length)
    return html`<div className="panel"><${Empty} title="Nothing to import here">Your access does not include adding records in bulk. An administrator can switch on the parts you work with under Roles & access.<//></div>`;
  const stepper = html`<ol className="impsteps" aria-label="Import steps">
      ${[
        ['pick', 'File'],
        ['cols', 'Columns'],
        ['check', 'Check'],
        ['go', 'Import'],
      ].map(([k, n], i) => {
        const order = ['pick', 'cols', 'check', 'go', 'done'];
        const at = order.indexOf(step);
        const me = order.indexOf(k);
        const st = k === 'go' && step === 'done' ? 'did' : me < at ? 'did' : me === at ? 'now' : '';
        return html`<li key=${k} className=${st} aria-current=${st === 'now' ? 'step' : undefined}><span>${st === 'did' ? html`<${Icon} n="check" />` : i + 1}</span>${n}</li>`;
      })}
    </ol>`;
  return html`<div className="stack impage">
      ${step !== 'pick' && stepper}
      ${step === 'pick' && html`<${ImpPick} meta=${meta} tk=${tk} setTk=${setTk} onUploaded=${uploaded} />`}
      ${step === 'cols' && T && html`<${ImpCols} run=${run} T=${T} meta=${meta} map=${map} setMap=${setMap} opts=${opts} setOpts=${setOpts} busy=${busy} onSheet=${changeSheet} onBack=${reset} onNext=${() => {
        setStep('check');
        scrollTo(0, 0);
      }} />`}
      ${step === 'check' && T && html`<${ImpCheck} run=${run} T=${T} map=${map} opts=${opts} setOpts=${setOpts} fixes=${fixes} setFixes=${setFixes} acts=${acts} setActs=${setActs} busy=${busy} onBack=${() => setStep('cols')} onGo=${go} />`}
      ${step === 'go' && T && html`<${ImpGoing} run=${run} T=${T} onDone=${r => {
        adopt(r, true);
        setStep('done');
        loadHist();
      }} />`}
      ${step === 'done' && T && html`<${ImpDone} run=${run} T=${T} onAgain=${reset} onUndo=${() => setUndoOf(run)} />`}
      ${step === 'pick' && html`<${ImpHistory} hist=${hist} all=${all} onAll=${a => {
        setAll(a);
        loadHist(a);
      }} onOpen=${open} onUndo=${setUndoOf} onChanged=${loadHist} meta=${meta} />`}
      ${undoOf && html`<${ImpUndoModal} run=${undoOf} onClose=${() => setUndoOf(null)} onUndo=${() => doUndo(undoOf)} />`}
    </div>`;
}

/* ---- step 1: what is being imported, and the file ---- */
function ImpPick({ meta, tk, setTk, onUploaded }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(0);
  const [paste, setPaste] = useState(false);
  const [text, setText] = useState('');
  const [over, setOver] = useState(false);
  const inp = useRef(null);
  const T = meta.targets.find(x => x.k === tk);
  const sendFile = async file => {
    if (!T) return toast('First choose what you are importing.', true);
    if (!/\.(csv|tsv|txt|xlsx)$/i.test(file.name)) {
      toast(/\.(xls|ods|numbers)$/i.test(file.name) ? 'Open that file and save it as Excel (.xlsx) or CSV first.' : 'Choose a spreadsheet: Excel (.xlsx), CSV or a tab-separated text file.', true);
      return;
    }
    if (file.size > meta.limits.mb * 1048576) return toast(`The file is larger than ${meta.limits.mb} MB. Split it into smaller files.`, true);
    setBusy(true);
    setProg(0.05);
    try {
      const fd = new FormData();
      fd.append('t', T.k);
      fd.append('file', file, file.name);
      const r = await upload('imp_upload', fd, setProg);
      onUploaded(r);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
    setProg(0);
  };
  const sendText = async () => {
    if (!T) return toast('First choose what you are importing.', true);
    if (!text.trim()) return toast('Paste the rows, with the headings in the first row.', true);
    setBusy(true);
    try {
      onUploaded(await api('imp_upload', { t: T.k, text }));
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<div className="stack">
      <section className="panel">
        <div className="ph-row"><h2 className="ph">What are you importing?</h2></div>
        <p className="muted small" style=${{ margin: '0 0 14px' }}>Nothing is saved until you have seen what every row will do. Excel (.xlsx), CSV or rows pasted from a spreadsheet, up to ${impNum(meta.limits.rows)} rows.</p>
        <div className="imptargets" role="radiogroup" aria-label="What are you importing?">
          ${meta.targets.map(
            t => html`<button key=${t.k} type="button" role="radio" aria-checked=${tk === t.k} className=${'imptarget' + (tk === t.k ? ' on' : '')} onClick=${() => setTk(t.k)}>
              <span className="imptic"><${Icon} n=${t.ico} /></span>
              <span><b>${t.n}</b><small>${t.hint}</small></span>
            </button>`
          )}
        </div>
      </section>
      ${
        T &&
        html`<section className="panel">
          <div className="ph-row">
            <h2 className="ph">${T.n}: the file</h2>
            <div className="actions"><button type="button" className="btn ghost sm" onClick=${() => impSaveCsv(toast, 'imp_template', { t: T.k })}><${Icon} n="down" />Template with the columns</button></div>
          </div>
          ${
            !paste
              ? html`<div className=${'drop impdrop' + (over ? ' over' : '')} onDragOver=${e => {
                  e.preventDefault();
                  setOver(true);
                }} onDragLeave=${() => setOver(false)} onDrop=${e => {
                  e.preventDefault();
                  setOver(false);
                  if (!busy && e.dataTransfer.files.length) sendFile(e.dataTransfer.files[0]);
                }}>
                  <p>Drop the spreadsheet here, or choose it.<br /><small className="muted">Excel (.xlsx), CSV or tab-separated text, up to ${meta.limits.mb} MB. The first row with headings is found by itself; title rows above it are fine.</small></p>
                  <div className="actions" style=${{ justifyContent: 'center' }}>
                    <button type="button" className="btn" disabled=${busy} onClick=${() => inp.current && inp.current.click()}><${Icon} n="up" />${busy ? 'Reading the file…' : 'Choose a file'}</button>
                    <button type="button" className="btn ghost" disabled=${busy} onClick=${() => setPaste(true)}>Paste rows instead</button>
                  </div>
                  <input ref=${inp} type="file" accept=".csv,.tsv,.txt,.xlsx" hidden onChange=${e => {
                    const f = e.target.files[0];
                    e.target.value = '';
                    if (f) sendFile(f);
                  }} />
                  ${busy && html`<div className="prog"><i style=${{ width: Math.round((prog || 0.05) * 100) + '%' }} /></div>`}
                </div>`
              : html`<div className="form">
                  <${Field} label="Rows copied from Excel or Google Sheets" hint="Select the rows with their headings in the spreadsheet, copy, and paste here.">
                    <textarea className="imppaste" value=${text} onInput=${e => setText(e.target.value)} placeholder=${'Name\tEmail\tPhone\nPriya Sharma\tpriya@example.com\t(555) 123-4567'} autoFocus />
                  <//>
                  <div className="actions">
                    <button type="button" className="btn" disabled=${busy || !text.trim()} onClick=${sendText}>${busy ? 'Reading…' : 'Use these rows'}</button>
                    <button type="button" className="btn ghost" onClick=${() => setPaste(false)}>Upload a file instead</button>
                  </div>
                </div>`
          }
        </section>`
      }
      ${T && html`<${ImpFromSystem} key=${T.k} T=${T} onUploaded=${onUploaded} />`}
    </div>`;
}

/* ---- v41.1: the records straight from another ATS or CRM (administrators) ---- */
function ImpFromSystem({ T, onUploaded }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [setup, setSetup] = useState(null);
  const [cred, setCred] = useState({});
  const [busy, setBusy] = useState('');
  const [since, setSince] = useState('');
  const [going, setGoing] = useState(null);
  const stop = useRef(false);
  const load = () =>
    api('mig_list')
      .then(setD)
      .catch(() => setD({ sources: [], denied: true }));
  useEffect(() => {
    load();
  }, []);
  if (!d || d.denied) return null;
  const list = d.sources.filter(s => s.kinds.includes(T.k));
  if (!list.length) return null;
  const open = s => {
    const c = {};
    s.f.forEach(f => (c[f.k] = f.t === 'secret' ? '' : f.v || (f.t === 'dc' ? 'com' : '')));
    setCred(c);
    setSetup(s);
  };
  const save = async () => {
    setBusy('save');
    try {
      await api('mig_save', { src: setup.k, cred }, { timeout: 90000 });
      toast(`${setup.n} is connected: the keys work.`);
      setSetup(null);
      load();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const act = async (s, what) => {
    if (what === 'drop' && !confirm(`Disconnect ${s.n}? The kept keys are removed; what was imported stays.`)) return;
    setBusy(what + s.k);
    try {
      await api(what === 'drop' ? 'mig_drop' : 'mig_check', { src: s.k }, { timeout: 90000 });
      toast(what === 'drop' ? `${s.n} disconnected.` : `${s.n} answers: the keys work.`);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
    load();
  };
  const pull = async (s, set) => {
    stop.current = false;
    setGoing({ k: s.k, name: `${s.n} · ${set.n}`, n: 0 });
    try {
      let r = await api('mig_pull', { src: s.k, set: set.k, since }, { timeout: 120000 });
      while (!r.done) {
        if (stop.current) {
          await api('mig_more', { id: r.id, stop: true });
          setGoing(null);
          toast('Stopped. Nothing was kept.');
          return;
        }
        setGoing(g => (g ? { ...g, n: r.n } : g));
        r = await api('mig_more', { id: r.id }, { timeout: 120000 });
      }
      setGoing(null);
      if (!r.run) {
        toast(`${s.n} has no ${set.n.toLowerCase()}${since ? ' changed since ' + since : ''}.`, true);
        load();
        return;
      }
      if (r.more) toast(`The first ${impNum(r.n)} came in (the most one import takes). Import them, then bring the rest with "Changed since".`, true);
      onUploaded(r.run);
    } catch (e) {
      setGoing(null);
      toast(errText(e), true);
      load();
    }
  };
  return html`<section className="panel stack">
      <div className="ph-row">
        <div><h2 className="ph">Or bring them from another system</h2><p className="muted small" style=${{ margin: 0 }}>Straight from the other ATS or CRM, read only: the records land here like a file, with the same checks, duplicates and undo before anything is saved.</p></div>
        <${Field} label="Changed since (optional)"><input type="date" value=${since} onInput=${e => setSince(e.target.value)} /><//>
      </div>
      ${
        going &&
        html`<div className="note info" role="status"><span><b>Bringing ${going.name}…</b> ${impNum(going.n)} so far. Large accounts take a few minutes; the page can stay open. <button type="button" className="btn ghost sm" onClick=${() => (stop.current = true)}>Stop</button></span></div>`
      }
      <div className="impsys">
        ${list.map(
          s => html`<div key=${s.k} className="impsyscard">
            <div className="ph-row"><b>${s.n}</b><span className="muted small">${s.what}</span></div>
            ${
              s.manual
                ? html`<p className="muted small" style=${{ margin: 0 }}>${s.manual}</p>`
                : s.conn
                  ? html`<div className="stack" style=${{ gap: 6 }}>
                      <span className="muted small">Connected by ${s.conn.by} · ${fmtDay(s.conn.at)}${s.conn.last ? ' · last brought ' + fmtTs(s.conn.last) : ''}</span>
                      ${s.conn.err ? html`<span className="small calerr">${s.conn.err}</span>` : null}
                      <div className="actions">${s.sets.filter(x => x.tk === T.k).map(x => html`<button key=${x.k} type="button" className="btn sm" disabled=${!!going || !!busy} onClick=${() => pull(s, x)}><${Icon} n="down" />Bring ${x.n.toLowerCase()}</button>`)}</div>
                      <div className="actions"><button type="button" className="btn ghost sm" disabled=${!!busy} onClick=${() => act(s, 'check')}>${busy === 'check' + s.k ? 'Checking…' : 'Check'}</button><button type="button" className="btn ghost sm" onClick=${() => open(s)}>Keys</button><button type="button" className="btn ghost sm" disabled=${!!busy} onClick=${() => act(s, 'drop')}>Disconnect</button></div>
                    </div>`
                  : html`<div><button type="button" className="btn ghost sm" onClick=${() => open(s)}>Connect</button></div>`
            }
          </div>`
        )}
      </div>
      ${
        setup &&
        html`<${Modal} title=${'Connect ' + setup.n} onClose=${() => setSetup(null)} foot=${html`<button className="btn ghost" onClick=${() => setSetup(null)}>Cancel</button><button className="btn" disabled=${busy === 'save'} onClick=${save}>${busy === 'save' ? 'Checking the keys…' : 'Check and connect'}</button>`}>
          <div className="form">
            <p className="small" style=${{ margin: 0 }}>${setup.help}</p>
            ${setup.f.map(
              f => html`<${Field} key=${f.k} label=${f.l} hint=${f.t === 'secret' && f.has ? 'Saved. Leave blank to keep it.' : f.h}>
                ${
                  f.t === 'dc'
                    ? html`<select value=${cred[f.k]} onChange=${e => setCred({ ...cred, [f.k]: e.target.value })}>${Object.entries(d.dcs || {}).map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select>`
                    : html`<input type=${f.t === 'secret' ? 'password' : 'text'} value=${cred[f.k] || ''} onInput=${e => setCred({ ...cred, [f.k]: e.target.value })} autoComplete=${f.t === 'secret' ? 'new-password' : 'off'} placeholder=${f.t === 'secret' && f.has ? '••••••••••••' : ''} />`
                }
              <//>`
            )}
            <p className="muted small" style=${{ margin: 0 }}>The keys are checked with one small read, then kept encrypted for this portal. Nothing is ever written to ${setup.n}.</p>
          </div>
        <//>`
      }
    </section>`;
}

/* ---- step 2: which column goes into which field ---- */
function ImpCols({ run, T, meta, map, setMap, opts, setOpts, busy, onSheet, onBack, onNext }) {
  const cols = run.cols || [];
  const fieldOf = k => T.f.find(f => f.k === k);
  const setCol = (ci, fk) => {
    const next = { ...map };
    if (!fk) delete next[ci];
    else {
      const f = fieldOf(fk);
      if (f && !f.multi) Object.keys(next).forEach(k => next[k] === fk && delete next[k]);
      next[ci] = fk;
    }
    setMap(next);
  };
  const usedBy = {};
  Object.entries(map).forEach(([ci, fk]) => {
    const c = cols.find(x => String(x.i) === String(ci));
    if (c) (usedBy[fk] = usedBy[fk] || []).push(c.h);
  });
  const need = impNeed(T, map);
  const missing = T.f.filter(f => !usedBy[f.k] && !['first', 'last'].includes(f.k));
  const hasDate = Object.values(map).some(fk => (fieldOf(fk) || {}).t === 'date');
  const sheets = run.sheets || [];
  const top = run.top || [];
  const n = run.rows || 0;
  return html`<section className="panel">
      <div className="ph-row">
        <h2 className="ph">Match the columns</h2>
        <span className="muted small">${run.paste ? 'Pasted rows' : run.file} · ${impRows(n)} of ${T.many}</span>
      </div>
      <div className="row3 impfile">
        ${
          sheets.length > 1 &&
          html`<${Field} label="Sheet"><select value=${run.sheet} disabled=${busy} onChange=${e => onSheet(+e.target.value)}>${sheets.map((s, i) => html`<option key=${i} value=${i}>${s.n || 'Sheet ' + (i + 1)} (${impNum(s.rows)} rows${s.hidden ? ', hidden' : ''})</option>`)}</select><//>`
        }
        <${Field} label="Headings are in" hint="The row with the column names; the rows under it are imported.">
          <select value=${run.hrow} disabled=${busy} onChange=${e => onSheet(run.sheet, +e.target.value)}>
            <option value="-1">No headings: the first row is data</option>
            ${top.map((r, i) => html`<option key=${i} value=${i}>Row ${r[0]}: ${r.slice(1).filter(Boolean).slice(0, 4).join(' · ').slice(0, 70) || '(empty)'}</option>`)}
          </select>
        <//>
      </div>
      ${sheets[run.sheet] && sheets[run.sheet].more && html`<div className="note amber"><span>This sheet has more than ${impNum(meta.limits.rows)} rows; only the first ${impNum(meta.limits.rows)} are imported. Split the file to import the rest.</span></div>`}
      <div className="tblwrap"><table className="tbl impmap">
        <thead><tr><th>Column in your file</th><th>What it holds</th><th>Goes into</th></tr></thead>
        <tbody>
          ${cols.map(c => {
            const fk = map[c.i] || '';
            return html`<tr key=${c.i} className=${fk ? '' : 'off'}>
              <td><b>${c.h}</b><div className="muted small">${c.f ? `${impNum(c.f)} of ${impNum(n)} filled` : 'empty'}</div></td>
              <td className="small impsamples">${c.s.length ? c.s.map((s, i) => html`<span key=${i}>${s}</span>`) : html`<span className="muted">—</span>`}</td>
              <td>
                <select value=${fk} aria-label=${'Field for the column ' + c.h} onChange=${e => setCol(c.i, e.target.value)}>
                  <option value="">Not imported</option>
                  ${T.f.map(f => {
                    const others = (usedBy[f.k] || []).filter(h => h !== c.h);
                    return html`<option key=${f.k} value=${f.k}>${f.l}${others.length ? (f.multi ? ' (also ' + others[0] + ')' : ' (now ' + others[0] + ')') : ''}</option>`;
                  })}
                </select>
              </td>
            </tr>`;
          })}
        </tbody>
      </table></div>
      ${missing.length > 0 && html`<p className="muted small" style=${{ margin: '10px 0 0' }}>Not in this file: ${missing.map(f => f.l).join(', ')}.</p>`}
      <${ImpOptions} T=${T} meta=${meta} opts=${opts} setOpts=${setOpts} hasDate=${hasDate} />
      ${need && html`<div className="note amber" style=${{ marginTop: 14 }}><span>${need}</span></div>`}
      <div className="actions impfoot">
        <button type="button" className="btn ghost" onClick=${onBack}>Choose another file</button>
        <div className="push"><button type="button" className="btn" disabled=${!!need || busy} onClick=${onNext}>Check the rows<${Icon} n="right" /></button></div>
      </div>
    </section>`;
}
/** What the import adds to every row (a job, tags, a source) and how dates are written. */
function ImpOptions({ T, meta, opts, setOpts, hasDate }) {
  const set = (k, v) => setOpts({ ...opts, [k]: v });
  const has = k => (T.opts || []).includes(k);
  if (!has('job') && !has('tags') && !has('src') && !hasDate) return null;
  return html`<div className="impopts">
      <h3 className="ph" style=${{ fontSize: 15, margin: '18px 0 8px' }}>For every row</h3>
      <div className="row3">
        ${
          has('job') &&
          html`<${Field} label="Add everyone to" hint="A Job column in the file (code or title) goes first.">
            <select value=${opts.job || ''} onChange=${e => set('job', e.target.value)}>
              <option value="">The talent pool</option>
              ${(meta.jobs || []).map(j => html`<option key=${j.id} value=${j.id}>${j.ti}${j.code ? ' · ' + j.code : ''}${j.open ? '' : ' (closed)'}</option>`)}
            </select>
          <//>`
        }
        ${has('tags') && html`<${Field} label="Tag everyone with" hint="Separated by commas, e.g. hotlist-oct, java"><input value=${opts.tags || ''} onInput=${e => set('tags', e.target.value)} /><//>`}
        ${has('src') && html`<${Field} label="Source when the row has none"><input value=${opts.src || ''} placeholder="Import" onInput=${e => set('src', e.target.value)} /><//>`}
        ${
          hasDate &&
          html`<${Field} label="Dates like 03/04/2026 are">
            <select value=${opts.dates || 'mdy'} onChange=${e => set('dates', e.target.value)}>
              <option value="mdy">Month / day (US: March 4)</option>
              <option value="dmy">Day / month (April 3)</option>
            </select>
          <//>`
        }
      </div>
    </div>`;
}

/* ---- step 3: the dry run ---- */
function ImpCheck({ run, T, map, opts, setOpts, fixes, setFixes, acts, setActs, busy, onBack, onGo }) {
  const toast = useToast();
  const [res, setRes] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const [f, setF] = useState('all');
  const [qq, setQq] = useState('');
  const [qd, setQd] = useState('');
  const [pg, setPg] = useState(1);
  const [edit, setEdit] = useState(null);
  const [moreIssues, setMoreIssues] = useState(false);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);
  useEffect(() => {
    const t = setTimeout(() => setQd(qq), 300);
    return () => clearTimeout(t);
  }, [qq]);
  const key = JSON.stringify([map, opts, fixes, acts, f, qd, pg, tick]);
  useEffect(() => {
    const me = ++seq.current;
    setLoading(true);
    api('imp_check', { id: run.id, map, opts, fixes, acts, f, q: qd, pg }, { timeout: 120000 }).then(
      r => {
        if (me !== seq.current) return;
        setRes(r);
        setErr(null);
        setLoading(false);
        if (r.pg !== pg) setPg(r.pg);
      },
      e => {
        if (me !== seq.current) return;
        setErr(e);
        setLoading(false);
      }
    );
  }, [key]);
  if (err && !res) return html`<${LoadError} error=${err} onRetry=${() => setTick(t => t + 1)} />`;
  if (!res) return html`<section className="panel"><${Spinner} label="Checking every row…" /></section>`;
  const c = res.cnt;
  const todo = c.new + c.upd + c.merge;
  const decide = (i, v) => {
    const next = { ...acts };
    if (!v) delete next[i];
    else next[i] = v;
    setActs(next);
  };
  const chips = IMP_FILTERS.filter(([k]) => k === 'all' || c[k] > 0 || f === k);
  const issues = moreIssues ? res.issues : res.issues.slice(0, 3);
  const ups = c.upd + c.merge;
  return html`<div className="stack">
      <section className="panel">
        <div className="ph-row">
          <h2 className="ph">Check before importing</h2>
          <span className="muted small">${run.paste ? 'Pasted rows' : run.file} · ${impRows(c.all)}${loading ? ' · checking…' : ''}</span>
        </div>
        <${KitStats} items=${[
          { v: impNum(c.new), l: `New ${c.new === 1 ? T.one : T.many}`, tone: c.new ? 'ok' : '', onClick: () => setF('new') },
          { v: impNum(ups), l: c.merge ? `${ups === 1 ? 'Update' : 'Updates'} (${impNum(c.merge)} ${c.merge === 1 ? 'joins' : 'join'} an earlier row)` : `${ups === 1 ? 'Update' : 'Updates'} to records already here`, onClick: () => setF('upd') },
          { v: impNum(c.same), l: 'Already up to date', onClick: () => setF('same') },
          { v: impNum(c.err), l: 'Rows with a problem (not imported)', tone: c.err ? 'warn' : '', onClick: () => setF('err') },
          { v: impNum(c.skip), l: 'Skipped', onClick: () => setF('skip') },
        ]} />
        <div className="imppol" role="radiogroup" aria-label="When a row matches a record that is already here">
          <span className="lbl">When a row matches a record already here</span>
          <div className="seg">${IMP_POL.map(([k, n]) => html`<button key=${k} type="button" role="radio" aria-checked=${(opts.upd || 'fill') === k} className=${(opts.upd || 'fill') === k ? 'on' : ''} onClick=${() => setOpts({ ...opts, upd: k })}>${n}</button>`)}</div>
          <span className="muted small">${(IMP_POL.find(x => x[0] === (opts.upd || 'fill')) || IMP_POL[0])[2]} Tags are added; notes are added below what is there.</span>
        </div>
        ${
          res.issues.length > 0 &&
          html`<ul className="impissues">
            ${issues.map(
              (x, i) => html`<li key=${i} className=${x.k === 'e' ? 'e' : 'w'}><span><b>${x.f && !x.t.startsWith(x.f) ? x.f + ': ' : ''}${x.t}</b><span className="small"> · ${impRows(x.n)}, first in row ${x.ln}</span></span>
                <button type="button" className="btn link sm" onClick=${() => {
                  setF(x.k === 'e' ? 'err' : 'warn');
                  setPg(1);
                }}>Show</button></li>`
            )}
            ${res.issues.length > 3 && html`<li className="more"><button type="button" className="btn link sm" onClick=${() => setMoreIssues(!moreIssues)}>${moreIssues ? 'Fewer' : `${res.issues.length - 3} more kinds of warnings`}</button></li>`}
          </ul>`
        }
      </section>
      <section className="panel" style=${{ padding: '12px 10px' }}>
        <div className="toolbar impbar">
          <div className="chips" role="tablist" aria-label="Show">
            ${chips.map(([k, n]) => html`<button key=${k} type="button" role="tab" aria-selected=${f === k} className=${'chipbtn' + (f === k ? ' on' : '')} onClick=${() => {
              setF(k);
              setPg(1);
            }}>${n}${k !== 'all' ? ' ' + impNum(c[k]) : ''}</button>`)}
          </div>
          <input type="search" className="push" style=${{ maxWidth: 240 }} placeholder="Find a row" value=${qq} onInput=${e => {
            setQq(e.target.value);
            setPg(1);
          }} aria-label="Find a row" />
        </div>
        ${
          res.rows.length
            ? html`<div className="tblwrap"><table className=${'tbl improws' + (loading ? ' busy' : '')}>
              <thead><tr><th className="nw">Row</th><th>What happens</th><th>${T.one.charAt(0).toUpperCase() + T.one.slice(1)}</th><th>Details</th><th /></tr></thead>
              <tbody>${res.rows.map(r => html`<${ImpRow} key=${r.i} r=${r} T=${T} onDecide=${v => decide(r.i, v)} onEdit=${() => setEdit(r)} />`)}</tbody>
            </table></div>`
            : html`<${Empty} title="No rows here">${f === 'all' ? 'Nothing matches the search.' : 'Choose another view.'}<//>`
        }
        ${
          res.pages > 1 &&
          html`<div className="actions imppager">
            <button type="button" className="btn ghost sm" disabled=${pg <= 1} onClick=${() => setPg(pg - 1)}><${Icon} n="left" />Previous</button>
            <span className="muted small">Page ${res.pg} of ${res.pages} · ${impRows(res.n)}</span>
            <button type="button" className="btn ghost sm" disabled=${pg >= res.pages} onClick=${() => setPg(pg + 1)}>Next<${Icon} n="right" /></button>
          </div>`
        }
      </section>
      <div className="impsticky">
        <div>
          <b>${todo ? `${impRows(todo)} will be imported` : 'Nothing to import yet'}</b>
          <span className="muted small">${[c.new && `${impNum(c.new)} new`, ups && `${impNum(ups)} ${ups === 1 ? 'update' : 'updates'}`, c.same && `${impNum(c.same)} already up to date`, c.err + c.skip && `${impNum(c.err + c.skip)} left out`].filter(Boolean).join(' · ')}</span>
        </div>
        <div className="actions">
          <button type="button" className="btn ghost" onClick=${onBack}><${Icon} n="left" />Columns</button>
          <button type="button" className="btn" disabled=${busy || loading || !todo || !!res.need} onClick=${onGo}>${busy ? 'Starting…' : `Import ${impRows(todo)}`}</button>
        </div>
      </div>
      ${res.need && html`<div className="note amber"><span>${res.need}</span></div>`}
      ${
        edit &&
        html`<${ImpEditRow} r=${edit} T=${T} map=${map} fix=${fixes[edit.i] || {}} onClose=${() => setEdit(null)} onSave=${fx => {
          const next = { ...fixes };
          if (Object.keys(fx).length) next[edit.i] = fx;
          else delete next[edit.i];
          setFixes(next);
          setEdit(null);
          toast('Row ' + edit.ln + ' corrected; checked again.');
        }} />`
      }
    </div>`;
}
/** One row of the dry run: what happens, the record, what was read and changed, and the person's decision. */
function ImpRow({ r, T, onDecide, onEdit }) {
  const [a0, s0] = IMP_ACT[r.a] || [r.a, ''];
  const label = r.a === 'merge' ? `Joins row ${r.toLn}` : r.a === 'upd' && r.toLn ? `Update (as row ${r.toLn})` : a0;
  const canDecide = r.a !== 'err' || r.dec === 'skip';
  const dupOpts = r.dup || [];
  const strong = dupOpts.filter(d => d.s);
  const likely = dupOpts.filter(d => !d.s);
  const msgs = (r.m || []).filter(m => m[2] !== r.why);
  return html`<tr className=${'impr a-' + r.a}>
      <td className="nw num">${r.ln}${r.fx ? html`<div><${Chip} s="info">fixed<//></div>` : null}</td>
      <td className="impwhat">
        <${Chip} s=${s0}>${label}<//>
        ${
          canDecide &&
          html`<select className="impdec" value=${r.dec || ''} aria-label=${'What to do with row ' + r.ln} onChange=${e => onDecide(e.target.value)}>
            <option value="">Automatic</option>
            <option value="new">Add as new</option>
            ${dupOpts.map(d => html`<option key=${d.id} value=${'upd:' + d.id}>Update ${d.l.slice(0, 40)}</option>`)}
            <option value="skip">Skip this row</option>
          </select>`
        }
      </td>
      <td className="imprec">
        <b>${r.show[0] || html`<span className="muted">(no ${(T.f.find(x => x.k === T.need) || { l: 'name' }).l.toLowerCase()})</span>`}</b>
        ${r.show.length > 1 && html`<div className="muted small">${r.show.slice(1).join(' · ')}</div>`}
        ${r.job && html`<div className="small">Job: ${r.job}</div>`}
        ${r.co && html`<div className="small">Company: ${r.co.l} <span className="muted">(${r.co.a === 'link' ? 'already in the CRM' : r.co.a === 'new' ? 'new, added with this contact' : 'added with an earlier row'})</span></div>`}
      </td>
      <td className="impdet">
        ${r.why && html`<div className=${r.a === 'err' ? 'late' : 'muted'}>${r.why}</div>`}
        ${(r.a === 'upd' || r.a === 'same') && r.lbl && html`<div className="small">${r.a === 'same' ? 'Already up to date: ' : 'Updates '}<b>${r.lbl}</b>${strong[0] ? html`<span className="muted"> (${strong[0].why})</span>` : null}</div>`}
        ${
          r.chg.length > 0 &&
          html`<ul className="impchg">${r.chg.map(
            ([l, from, to, kind], i) =>
              kind === 'add'
                ? html`<li key=${i}><span className="lbl">${l}</span> adds <b>${to}</b></li>`
                : html`<li key=${i}><span className="lbl">${l}</span> ${from ? html`<s className="muted">${from}</s> → ` : r.a === 'new' ? '' : html`<span className="muted">empty</span> → `}<span>${to}</span></li>`
          )}</ul>`
        }
        ${
          r.kept.length > 0 &&
          html`<details className="impkept"><summary className="muted small">${r.kept.length} ${r.kept.length === 1 ? 'difference' : 'differences'} kept as they are</summary><ul className="impchg">${r.kept.map(
            ([l, cur, file], i) => html`<li key=${i}><span className="lbl">${l}</span> stays <b>${cur}</b> <span className="muted">(file: ${file})</span></li>`
          )}</ul></details>`
        }
        ${likely.length > 0 && r.a !== 'upd' && r.a !== 'same' && html`<div className="impdup"><${Icon} n="users" /> May already be here: ${likely.map((d, i) => html`<span key=${d.id}>${i ? '; ' : ''}<b>${d.l}</b> <span className="muted">(${d.why})</span></span>`)}. Choose "Update" if it is the same.</div>`}
        ${
          msgs.length > 0 &&
          html`<ul className="impmsgs">${msgs.map(([k, l, t], i) => html`<li key=${i} className=${k}>${l && !t.startsWith(l) ? html`<span className="lbl">${l}</span> ` : null}${t}</li>`)}</ul>`
        }
      </td>
      <td className="r"><button type="button" className="btn ghost sm" onClick=${onEdit} aria-label=${'Correct row ' + r.ln}><${Icon} n="pen" />Fix</button></td>
    </tr>`;
}
/** Corrects the values of one row by hand (the file itself is not changed). */
function ImpEditRow({ r, T, map, fix, onClose, onSave }) {
  const mapped = new Set(Object.values(map));
  const fields = T.f.filter(f => mapped.has(f.k) || f.k === T.need || (T.need === 'n|e' && (f.k === 'n' || f.k === 'e')) || fix[f.k] !== undefined || (r.raw && r.raw[f.k] !== undefined));
  const [v, setV] = useState(() => Object.fromEntries(fields.map(f => [f.k, fix[f.k] !== undefined ? fix[f.k] : (r.raw && r.raw[f.k]) || ''])));
  const save = () => {
    const out = {};
    fields.forEach(f => {
      const orig = (r.raw && r.raw[f.k]) || '';
      if (fix[f.k] !== undefined || String(v[f.k]) !== String(orig)) out[f.k] = String(v[f.k]);
    });
    onSave(out);
  };
  const msgsOf = k => (r.m || []).filter(m => m[1] === (T.f.find(f => f.k === k) || {}).l);
  return html`<${Modal} title=${'Correct row ' + r.ln} onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Cancel</button>${Object.keys(fix).length > 0 && html`<button type="button" className="btn ghost" onClick=${() => onSave({})}>Back to the file's values</button>`}<button type="button" className="btn" onClick=${save}>Use these values</button>`}>
      <div className="form">
        <p className="muted small" style=${{ margin: 0 }}>Only this import uses the corrections; the file stays as it is. The row is checked again with them.</p>
        ${fields.map(f => {
          const ms = msgsOf(f.k);
          const hint = ms.length ? ms.map(m => m[2]).join('; ') : f.o && f.o.length ? 'One of: ' + f.o.join(', ') : f.h || '';
          return html`<${Field} key=${f.k} label=${f.l} hint=${hint}>
            ${f.t === 'long' ? html`<textarea value=${v[f.k]} onInput=${e => setV({ ...v, [f.k]: e.target.value })} />` : html`<input value=${v[f.k]} list=${f.o && f.o.length ? 'impo-' + f.k : undefined} onInput=${e => setV({ ...v, [f.k]: e.target.value })} />`}
            ${f.o && f.o.length > 0 && html`<datalist id=${'impo-' + f.k}>${f.o.map(o => html`<option key=${o} value=${o} />`)}</datalist>`}
          <//>`;
        })}
      </div>
    <//>`;
}

/* ---- step 4: writing, and the result ---- */
function ImpGoing({ run, T, onDone }) {
  const [p, setP] = useState({ cur: run.cur || 0, total: run.total || 0, res: run.res || {} });
  const [err, setErr] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    (async () => {
      for (;;) {
        try {
          const r = await api('imp_step', { id: run.id }, { timeout: 180000 });
          if (!live) return;
          if (r.done) {
            onDone(r.run);
            return;
          }
          setP({ cur: r.cur, total: r.total, res: r.res });
        } catch (e) {
          if (live) setErr(e);
          return;
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [tick]);
  const pct = p.total ? Math.round((p.cur / p.total) * 100) : 0;
  return html`<section className="panel">
      <div className="ph-row"><h2 className="ph">Importing ${T.many}</h2><span className="muted small">${run.paste ? 'Pasted rows' : run.file}</span></div>
      <div className="prog impprog" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${pct}><i style=${{ width: Math.max(3, pct) + '%' }} /></div>
      <p className="small">${impNum(p.cur)} of ${impRows(p.total)} written${p.res.new ? ` · ${impNum(p.res.new)} new` : ''}${p.res.upd || p.res.merge ? ` · ${impNum((p.res.upd || 0) + (p.res.merge || 0))} updated` : ''}.</p>
      <p className="muted small">Keep this page open until it finishes. If it stops, open the import under Past imports to continue where it stopped, or undo it.</p>
      ${
        err &&
        html`<div className="note red"><span><b>The import paused.</b> ${errText(err)}</span><div className="actions"><button type="button" className="btn sm" onClick=${() => {
          setErr(null);
          setTick(t => t + 1);
        }}>Continue</button></div></div>`
      }
    </section>`;
}
function ImpDone({ run, T, onAgain, onUndo }) {
  const toast = useToast();
  const r = run.res || {};
  const left = (r.skip || 0) + (r.err || 0) + (r.fail || 0) + (r.gone || 0);
  const href = impPageHref(T);
  const st = IMP_ST[run.st] || [run.st, ''];
  return html`<section className="panel">
      <div className="ph-row">
        <h2 className="ph">${run.st === 'done' ? 'Imported' : st[0]}: ${T.many}</h2>
        <${Chip} s=${st[1]}>${st[0]}<//>
      </div>
      <p className="muted small" style=${{ marginTop: 0 }}>${run.paste ? 'Pasted rows' : run.file} · by ${run.who}${run.endAt ? ' · ' + fmtTs(run.endAt) : ''}</p>
      <${KitStats} items=${[
        { v: impNum(r.new), l: `New ${r.new === 1 ? T.one : T.many}`, tone: r.new ? 'ok' : '' },
        { v: impNum((r.upd || 0) + (r.merge || 0)), l: 'Updated' },
        { v: impNum((r.same || 0) + (r.dup || 0)), l: 'Already up to date' },
        { v: impNum(left), l: 'Not imported', tone: left ? 'warn' : '' },
      ]} />
      ${(r.fail || 0) + (r.gone || 0) > 0 && html`<div className="note amber"><span>${impRows((r.fail || 0) + (r.gone || 0))} could not be saved (a record deleted while the import ran, or a save that failed). They are in the list of rows not imported.</span></div>`}
      ${
        run.undo &&
        html`<div className="note info"><span><b>Undone ${fmtTs(run.undo.at)} by ${run.undo.by}:</b> ${impNum(run.undo.removed)} removed, ${impNum(run.undo.restored)} put back${run.undo.kept ? `, ${impNum(run.undo.kept)} kept because they had changed since` : ''}.</span></div>`
      }
      <div className="actions" style=${{ marginTop: 14 }}>
        ${href && run.st === 'done' && html`<a className="btn" href=${href}>Open the ${T.many}</a>`}
        ${left > 0 && !run.purged && html`<button type="button" className="btn ghost" onClick=${() => impSaveCsv(toast, 'imp_problems', { id: run.id })}><${Icon} n="down" />Rows not imported (CSV)</button>`}
        ${run.canUndo && html`<button type="button" className="btn ghost" onClick=${onUndo}><${Icon} n="undo" />Undo this import</button>`}
        <button type="button" className="btn ghost" onClick=${onAgain}>Import another file</button>
      </div>
    </section>`;
}
function ImpUndoModal({ run, onClose, onUndo }) {
  const [busy, setBusy] = useState(false);
  const r = run.res || {};
  return html`<${Modal} title="Undo this import?" onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Keep it</button><button type="button" className="btn danger" disabled=${busy} onClick=${async () => {
      setBusy(true);
      await onUndo();
      setBusy(false);
    }}>${busy ? 'Undoing…' : 'Undo the import'}</button>`}>
      <p>The ${impNum(r.new)} records it added are deleted, and the values it changed in ${impNum((r.upd || 0) + (r.merge || 0))} records are put back.</p>
      <p className="muted small">Anything someone changed after the import stays as it is: such a record is kept, and such a value is not put back. A record that has files, notes or opportunities added since is kept too.</p>
    <//>`;
}

/* ---- past imports ---- */
function ImpHistory({ hist, all, onAll, onOpen, onUndo, onChanged, meta }) {
  const toast = useToast();
  if (!hist) return html`<${Spinner} label="Loading past imports…" />`;
  const runs = hist.runs || [];
  const drop = async r => {
    if (!confirm(r.st === 'draft' ? 'Remove this file? It was never imported.' : 'Remove the file and the undo information of this import now? The import itself stays, and it can no longer be undone.')) return;
    try {
      await api('imp_drop', { id: r.id });
      onChanged();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  return html`<section className="panel" style=${{ padding: '14px 10px 8px' }}>
      <div className="ph-row" style=${{ padding: '0 8px' }}>
        <h2 className="ph">Past imports</h2>
        ${hist.admin && html`<label className="check small"><input type="checkbox" checked=${all} onChange=${e => onAll(e.target.checked)} /><span>Everyone's</span></label>`}
      </div>
      ${
        runs.length
          ? html`<div className="tblwrap"><table className="tbl">
            <thead><tr><th>When</th><th>What</th><th>File</th><th className="r">New</th><th className="r">Updated</th><th className="r">Not imported</th><th>Status</th><th /></tr></thead>
            <tbody>${runs.map(r => {
              const st = IMP_ST[r.st] || [r.st, ''];
              const x = r.res || {};
              const left = (x.skip || 0) + (x.err || 0) + (x.fail || 0) + (x.gone || 0);
              return html`<tr key=${r.id}>
                <td className="nw small">${fmtTs(r.at)}${all ? html`<div className="muted">${r.who}</div>` : null}</td>
                <td>${r.tn}</td>
                <td className="small">${r.paste ? 'Pasted rows' : r.file}<div className="muted">${impRows(r.n)}</div></td>
                <td className="r num">${r.st === 'draft' ? '—' : impNum(x.new)}</td>
                <td className="r num">${r.st === 'draft' ? '—' : impNum((x.upd || 0) + (x.merge || 0))}</td>
                <td className="r num">${r.st === 'draft' ? '—' : impNum(left)}</td>
                <td><${Chip} s=${st[1]}>${st[0]}<//>${r.purged && r.st !== 'draft' ? html`<div className="muted small">file removed</div>` : null}</td>
                <td className="r nw">
                  ${r.st === 'draft' && html`<button type="button" className="btn ghost sm" onClick=${() => onOpen(r.id)}>Continue</button>`}
                  ${r.st === 'running' && r.canGo && html`<button type="button" className="btn ghost sm" onClick=${() => onOpen(r.id)}>Finish it</button>`}
                  ${r.st !== 'draft' && r.st !== 'running' && html`<button type="button" className="btn ghost sm" onClick=${() => onOpen(r.id)}>Open</button>`}
                  ${r.canUndo && html` <button type="button" className="btn ghost sm" onClick=${() => onUndo(r)}><${Icon} n="undo" />Undo</button>`}
                  ${r.mine && !r.purged && r.st !== 'running' && r.st !== 'undoing' && html` <button type="button" className="btn ghost icon sm" title="Remove" aria-label="Remove" onClick=${() => drop(r)}><${Icon} n="trash" /></button>`}
                </td>
              </tr>`;
            })}</tbody>
          </table></div>`
          : html`<${Empty} title="No imports yet">Each import is listed here for ${meta.limits.keep} days with its result, the rows that were not imported and Undo.<//>`
      }
    </section>`;
}
