/* ================= v36.1: ID checks (driver's licenses, state IDs, green cards) ================= */
// The server checks what the browser read (api/idscan.php): the license barcode against the AAMVA standard, the green
// card's three lines digit by digit, the front against the back, and the portal's other checks.
// v36.3: the reading itself lives in idkit.js (shared with the page an ID link opens): the green card's lines are read
// from the picture or live from the camera (no typing, no AI service), the front is read and compared by itself, a
// "Can't tell" lists what is missing with a fix next to each, a check can be run again, and ID links ask a person to
// scan or upload their ID (their pictures are read again here before the result is recorded).
const IDS_V = { ok: ['Looks genuine', 'ok'], fake: ['Looks fake', 'red'], unsure: ["Can't tell", 'amber'] };
const IDS_ST = { pass: ['✓', 'ok'], fail: ['✗', 'red'], warn: ['!', 'amber'], unsure: ['?', 'amber'], info: ['i', ''] };
const IDS_GROUPS = [
  ['barcode', 'The barcode'],
  ['mrz', 'The machine-readable lines'],
  ['front', 'Front and back'],
  ['document', 'The document'],
  ['person', 'The person'],
  ['pictures', 'The pictures'],
];
const IDS_DEC = { verified: ['Accepted', 'ok'], not: ['Not accepted', 'red'], more: ['Asked for another document', 'amber'] };
const IDS_KIND = { dl: "Driver's license or state ID", gc: 'Green card' };
const IDS_REQ_ST = { open: ['Waiting', 'amber'], opened: ['Opened', 'amber'], done: ['Received', 'ok'], expired: ['Expired', ''], cancelled: ['Cancelled', ''] };
const IDS_FIELD = { name: 'name', dob: 'date of birth', exp: 'expiry date', num: 'number' };

/* ---------- the rules, once per person ---------- */
function IdsRules({ onOk, onClose }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const ok = async () => {
    setBusy(true);
    try {
      await api('ids_ack', {});
      onOk();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<${Modal} title="Before you check IDs" onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Not now</button><button className="btn" disabled=${busy} onClick=${ok}>I understand</button>`}>
      <ul className="idsrules">
        <li><b>What it is for:</b> spotting fake or altered driver's licenses, state IDs and green cards that candidates, consultants or vendors send. It reads the barcode or the machine-readable lines on the back and compares them with the front and with the portal's other checks.</li>
        <li><b>Not for Form I-9.</b> For your own employees, accept any document from the I-9 lists that reasonably appears genuine and relates to the person, and use E-Verify. Don't reject an I-9 document because of this result.</li>
        <li><b>The same for everyone:</b> check IDs the same way for every candidate, and never ask someone for one particular document (for example a green card).</li>
        <li><b>A result is not a decision:</b> "Looks fake" is a reason to look closer (the original on a video call, or another copy), and you record what you decided.</li>
        <li><b>What is kept:</b> the result of each check, the pictures (encrypted, deleted after the retention period) and a one-way fingerprint of the document number to spot one ID used by two people. Nothing read from a license barcode is kept.</li>
      </ul>
    <//>`;
}

/* ---------- reading one picture: the back (barcode or lines) or else the front ---------- */
async function idsReadItem(it) {
  const r = await idkBack(it.canvas, ['dl', 'gc']);
  if (r.bar) return { code: r.bar, mrz: null, side: 'back' };
  if (r.mrz && r.mrz.found) return { code: '', mrz: r.mrz, side: 'back' };
  return { code: '', mrz: null, side: '' };
}
/* a check that arrived through an ID link, read here (the person's phone already read it; that is compared, not trusted) */
async function idsAutoRead(w) {
  const pics = [];
  for (const im of w.img) {
    const resp = await fetch(API + 'ids_img&id=' + encodeURIComponent(w.id) + '&f=' + encodeURIComponent(im.fid), { credentials: 'same-origin' });
    if (!resp.ok) throw new Error('A picture of this ID could not be opened.');
    const b = await resp.blob();
    const pages = await idsPages(new File([b], im.side + '.jpg', { type: b.type || 'image/jpeg' }));
    pics.push({ side: im.side, c: pages[0] });
  }
  const back = pics.find(p => p.side === 'back');
  const front = pics.find(p => p.side === 'front');
  const r = back ? await idkBack(back.c, w.kind ? [w.kind] : ['dl', 'gc']) : { bar: '', mrz: { found: false } };
  const usable = idkMrzUsable(r.mrz);
  const kind = r.bar ? 'dl' : usable || (r.mrz && r.mrz.found) ? 'gc' : w.kind || '';
  const vals = r.bar || usable ? await idkBackValues(r.bar ? { bar: r.bar } : { mrz: r.mrz }) : null;
  const f = vals && front ? await idkFront(front.c, vals) : null;
  return api('ids_check', {
    id: w.id,
    kind,
    bar: r.bar || '',
    mrz: JSON.stringify(kind === 'gc' && usable ? r.mrz.lines : []),
    mrzRead: 'scan',
    front: JSON.stringify(f ? idkFrontSend(f.m) : {}),
    final: '1',
  });
}

/* ---------- a check, from the pictures to the result ---------- */
function IdScanModal({ init, onClose, onDone }) {
  const toast = useToast();
  const cands = useCol('rec/cand/items', 'n:asc');
  const [boot, setBoot] = useState(null);
  const [step, setStep] = useState('add');
  const [items, setItems] = useState([]);
  const [reading, setReading] = useState(0);
  const [cam, setCam] = useState('');
  const [kind, setKind] = useState('');
  const [mrz, setMrz] = useState(['', '', '']);
  const [mrzSrc, setMrzSrc] = useState('typed');
  const [typing, setTyping] = useState(false);
  const [who, setWho] = useState((init && init.who) || { kind: '', id: '', n: '' });
  const [res, setRes] = useState(null);
  const [front, setFront] = useState({ mode: '', diff: [] });
  const [fm, setFm] = useState(null); // the front read by itself: {key, m} or {key, busy} or {key, err}
  const [busy, setBusy] = useState(false);
  const [rules, setRules] = useState(false);
  const [dec, setDec] = useState({ st: '', note: '' });
  const keyRef = useRef(0);
  const urls = useRef([]);
  const sent = useRef('');
  const itemsRef = useRef([]);
  itemsRef.current = items;
  useEffect(() => {
    api('ids_boot', {}).then(
      b => {
        setBoot(b);
        if (!b.ack) setRules(true);
      },
      e => toast(errText(e), true)
    );
    // the readers load while the pictures are chosen
    idkLib().catch(() => {});
  }, []);
  const patch = (key, p) => setItems(list => list.map(x => (x.key === key ? { ...x, ...p } : x)));
  const add = async (canvas, side, read, from) => {
    const blob = await idsBlob(canvas);
    const it = { key: ++keyRef.current, blob, url: URL.createObjectURL(blob), side: side || 'page', code: (read && read.bar) || '', mrz: (read && read.mrz) || null, name: (from && from.n) || 'picture.jpg', ref: (from && from.ref) || null, canvas, done: !!(read && (read.bar || read.mrz)) };
    urls.current.push(it.url);
    setItems(list => [...list, it]);
    if (it.mrz) takeLines(it.mrz);
    return it;
  };
  // lines read with confidence are used as they are; unclear ones are only shown to be compared with the card (they
  // count once someone corrects or confirms them by typing)
  const takeLines = r => {
    if (r && r.found && r.lines) {
      const good = idkMrzUsable(r);
      setMrz(r.lines.slice());
      setMrzSrc(good ? 'scan' : 'unclear');
      setKind('gc');
      setTyping(!good);
    }
  };
  // every picture is read: the back's barcode or lines; anything else is taken for the front
  const readIt = async it => {
    if (it.done) return;
    setReading(n => n + 1);
    try {
      const r = await idsReadItem(it);
      // nothing read: the side stays open (it may be an unreadable back); the front is picked once the back is known
      patch(it.key, { code: r.code, mrz: r.mrz, done: true, side: r.side || it.side });
      if (r.mrz) takeLines(r.mrz);
      if (r.code) setKind('dl');
    } catch (e) {
      patch(it.key, { done: true });
      toast(errText(e), true);
    }
    setReading(n => n - 1);
  };
  const addFiles = async files => {
    for (const f of Array.from(files || [])) {
      try {
        const pages = await idsPages(f);
        for (const c of pages) readIt(await add(c, 'page', null, { n: f.name }));
      } catch (e) {
        toast(errText(e), true);
      }
    }
  };
  useEffect(() => {
    // files already in the portal (a record, an ATS candidate, an email attachment), or the pictures of an earlier check
    (async () => {
      for (const r of (init && init.refs) || []) {
        try {
          const resp = await fetch(r.url || fileUrl(r.base, r.fid, false), { credentials: 'same-origin' });
          if (!resp.ok) throw new Error('The file could not be opened.');
          const b = await resp.blob();
          const f = new File([b], r.n || 'file', { type: b.type || r.ty || '' });
          const pages = await idsPages(f);
          for (const c of pages) readIt(await add(c, r.side && r.side !== 'page' ? r.side : 'page', null, { n: r.n || 'file', ref: !r.url && pages.length === 1 ? { base: r.base, fid: r.fid } : null }));
        } catch (e) {
          toast(errText(e), true);
        }
      }
    })();
    return () => urls.current.forEach(u => URL.revokeObjectURL(u));
  }, []);
  const bar = (items.find(x => x.code) || {}).code || '';
  const k = bar ? 'dl' : kind;
  const useAi = !!(boot && boot.set.ai && boot.ai);
  const lines = mrz.map(l => l.toUpperCase().replace(/\s+/g, ''));
  const hints = idsMrzHints(lines);
  const linesOk = k === 'gc' && lines.every(l => l.length === 30) && hints.every(h => h[1]);
  // the front: the picture marked front; otherwise, once the back is known, the other picture that matches it best
  const backKnown = !!(bar || linesOk);
  const marked = items.find(x => x.side === 'front') || null;
  const cand = marked ? [marked] : backKnown ? items.filter(x => x.done && x.side === 'page' && !x.code && !x.mrz) : [];
  const sig = backKnown && cand.length ? cand.map(x => x.key).join(',') + '|' + (bar ? 'b' : lines.join('')) : '';
  useEffect(() => {
    if (!sig || (fm && fm.sig === sig)) return;
    let live = true;
    setFm({ sig, key: cand[0].key, busy: true });
    (async () => {
      try {
        const vals = await idkBackValues(bar ? { bar } : { mrz: { lines } });
        let best = null;
        for (const it of cand) {
          const r = await idkFront(it.canvas, vals);
          const score = r.m.got.length * 100 + r.m.n;
          if (!best || score > best.score) best = { score, key: it.key, m: r.m };
        }
        if (!live) return;
        if (!marked && best) setItems(list => list.map(x => (x.key === best.key ? { ...x, side: 'front' } : x)));
        setFm({ sig: best && !marked ? best.key + '|' + (bar ? 'b' : lines.join('')) : sig, key: best.key, m: best.m });
      } catch (e) {
        if (live) setFm({ sig, key: cand[0].key, err: errText(e) });
      }
    })();
    return () => {
      live = false;
    };
  }, [sig]);
  const frontItem = items.find(x => x.side === 'front') || null;
  const frontAuto = fm && fm.m && frontItem && fm.key === frontItem.key ? fm.m : null;
  // the front is still being read (or about to be): checking waits for it
  const frontPending = !!sig && !(fm && fm.sig === sig && !fm.busy) && !(fm && fm.m && frontItem && fm.key === frontItem.key && !fm.busy);
  const send = async (final, sameId) => {
    setBusy(true);
    try {
      let r;
      const frontSend = front.mode ? front : frontAuto ? idkFrontSend(frontAuto) : {};
      const common = { kind: k, bar, mrz: JSON.stringify(k === 'gc' && lines.some(Boolean) && mrzSrc !== 'unclear' ? lines : []), mrzRead: mrzSrc === 'scan' ? 'scan' : 'typed', who: JSON.stringify(who), front: JSON.stringify(frontSend), src: (init && init.src) || '', prev: (init && init.again) || '', ai: useAi ? '1' : '', final: final ? '1' : '' };
      // the same pictures: the same check, run again; pictures added or removed since: a new check (the old one goes)
      const keys = items.map(x => x.key + ':' + x.side).join(',');
      const id = sameId || (res && res.id && sent.current === keys ? res.id : '');
      if (id) r = await api('ids_check', { ...common, id });
      else {
        const fd = new FormData();
        Object.entries(common).forEach(([kk, v]) => fd.append(kk, v));
        if (res && res.id) fd.append('drop', res.id);
        const refs = [];
        items.forEach(x => {
          if (x.ref) refs.push({ ...x.ref, side: x.side });
          else {
            fd.append('img[]', x.blob, (x.side || 'page') + '.jpg');
            fd.append('side[]', x.side);
          }
        });
        fd.append('refs', JSON.stringify(refs));
        r = await upload('ids_check', fd, null, { timeout: 180000 });
        sent.current = keys;
      }
      setRes(r);
      if (r.final) {
        setStep('result');
        onDone && onDone(r);
      } else if (r.v !== 'unsure' || !(r.need || []).length) {
        // nothing left to fix: the result is recorded straight away
        setBusy(false);
        return send(true, r.id);
      } else setStep('fix');
    } catch (e) {
      if (e && e.code === 'needs_ack') setRules(true);
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const decide = async () => {
    if (!dec.st) return toast('Pick a decision.', true);
    setBusy(true);
    try {
      await api('ids_decide', { id: res.id, st: dec.st, note: dec.note });
      toast('Decision saved.');
      onDone && onDone(res);
      onClose();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const people = cands.docs.slice(0, 2000);
  const sh = (res && res.shown) || {};
  const shownRows = [
    ['Name', sh.name],
    ['Date of birth', sh.dob ? fmtDay(sh.dob + 'T12:00:00') : ''],
    [k === 'gc' ? 'Card number' : 'License number', sh.number],
    k === 'gc' ? ['USCIS number', sh.uscis] : ['Issued', sh.issue ? fmtDay(sh.issue + 'T12:00:00') : ''],
    ['Expires', sh.expiry ? fmtDay(sh.expiry + 'T12:00:00') : ''],
    ['Sex', sh.sex],
    k === 'gc' ? ['Country of birth', sh.cob] : ['City and state', sh.address],
  ].filter(x => x[1]);
  const checksBy = g => ((res && res.checks) || []).filter(x => x.g === g);
  const need = (res && res.need) || [];
  const camBack = cam === 'back';
  const onCamBack = async (c, read) => {
    const it = await add(c, 'back', read && (read.bar || read.mrz) ? read : null, { n: 'back.jpg' });
    if (!read || !(read.bar || read.mrz)) readIt(it);
    if (read && read.bar) setKind('dl');
    setCam(frontItem ? '' : 'front');
  };
  const onCamFront = async c => {
    setItems(list => list.map(x => (x.side === 'front' ? { ...x, side: 'page' } : x)));
    const it = await add(c, 'front', null, { n: 'front.jpg' });
    patch(it.key, { done: true });
    setCam('');
  };
  const canCheck = items.length && reading === 0 && (bar || k) && !frontPending;
  const foot =
    step === 'result'
      ? html`<button className="btn ghost" onClick=${onClose}>Close</button><button className="btn" disabled=${busy || !dec.st} onClick=${decide}>Save the decision</button>`
      : step === 'fix'
        ? html`<button className="btn ghost" onClick=${onClose}>Cancel</button><button className="btn ghost" disabled=${busy} onClick=${() => send(true)}>Finish anyway (Can't tell)</button><button className="btn" disabled=${busy || reading > 0 || frontPending} onClick=${() => send(false)}>${busy ? 'Checking…' : reading > 0 ? 'Reading…' : frontPending ? 'Reading the front…' : 'Check again'}</button>`
        : html`<button className="btn ghost" onClick=${onClose}>Cancel</button><button className="btn" disabled=${busy || !canCheck} onClick=${() => send(false)}>${busy ? 'Checking…' : reading > 0 ? 'Reading…' : frontPending ? 'Reading the front…' : 'Check it'}</button>`;
  if (rules) return html`<${IdsRules} onOk=${() => { setRules(false); setBoot(b => (b ? { ...b, ack: true } : b)); }} onClose=${onClose} />`;
  const status = x =>
    !x.done
      ? 'Reading…'
      : x.code
        ? html`<b>Barcode read</b>`
        : x.mrz && idkMrzUsable(x.mrz)
          ? html`<b>Lines read</b>`
          : x.mrz
            ? 'Lines unclear'
            : x.side === 'front'
              ? frontAuto && fm.key === x.key
                ? frontAuto.diff.length
                  ? html`<b className="t-amber">May differ</b>`
                  : frontAuto.got.length >= 3
                    ? html`<b>Front matches</b>`
                    : 'Front: partly read'
                : fm && fm.key === x.key && fm.busy
                  ? 'Reading the front…'
                  : 'Front'
              : backKnown
                ? 'Not used'
                : 'The front? (no barcode or lines)';
  const camera =
    cam &&
    html`<${IdLiveScan} want=${cam} kinds=${kind ? [kind] : ['gc', 'dl']} onBack=${onCamBack} onFront=${onCamFront} onClose=${() => setCam('')} />`;
  const pics =
    items.length > 0 &&
    html`<div className="idspics">${items.map(
      x => html`<div key=${x.key} className=${'idspic' + (x.code || (x.mrz && idkMrzUsable(x.mrz)) ? ' found' : '')}>
        <img src=${x.url} alt=${x.side} />
        <div className="idspicf">
          <select value=${x.side} aria-label="Which side" onChange=${e => setItems(list => list.map(y => (y.key === x.key ? { ...y, side: e.target.value } : e.target.value === 'front' && y.side === 'front' ? { ...y, side: 'page' } : y)))}>
            <option value="page">Side?</option><option value="front">Front</option><option value="back">Back</option>
          </select>
          <span className="small">${status(x)}</span>
          <button type="button" className="btn ghost sm icon" aria-label="Remove" onClick=${() => setItems(list => list.filter(y => y.key !== x.key))}><${Icon} n="x" /></button>
        </div>
      </div>`
    )}</div>`;
  const lineInputs = html`<div className="idsmrz">
      ${[0, 1, 2].map(i => html`<label key=${i}><span className="small muted">Line ${i + 1} · ${lines[i].length}/30</span><input value=${mrz[i]} maxLength="34" spellCheck="false" autoComplete="off" onInput=${e => { setMrzSrc('typed'); setMrz(m => m.map((v, j) => (j === i ? e.target.value.toUpperCase() : v))); }} placeholder=${['C1USA000000000…', '900101…', 'FAMILY<<GIVEN<NAMES…'][i]} /></label>`)}
      ${hints.length > 0 && html`<div className="small">${hints.map(([n, okk]) => html`<span key=${n} className=${'chip ' + (okk ? 'ok' : 'amber')} style=${{ marginRight: 6 }}>${okk ? '✓' : '!'} ${n}</span>`)}${hints.some(h => !h[1]) ? html`<span className="muted"> A check digit does not match: look again at the characters (0 and O, 1 and I, 8 and B).</span>` : ''}</div>`}
    </div>`;
  const frontLine =
    frontAuto &&
    html`<p className="small idsfrontauto">
      <b>The front, read by itself:</b> ${frontAuto.got.length ? 'found ' + frontAuto.got.map(f => IDS_FIELD[f]).join(', ') : 'none of the back\'s details found'}${frontAuto.diff.length ? html`; <span className="t-amber">${frontAuto.diff.map(d => IDS_FIELD[d.f] + ' reads ' + d.front + (d.sure ? ' (read twice)' : '')).join('; ')}</span>` : ''}.
    </p>`;
  return html`<${Modal} wide title=${init && init.again ? 'Check the ID again' : 'Check an ID'} onClose=${onClose} foot=${foot}>
      <div className="stack idscan" style=${{ gap: 14 }}>
        ${
          step === 'add' &&
          html`<${Fragment}>
            <p className="muted small">Scan the card with the camera (the back is read by itself, then the front), or add pictures or a PDF of the front and the back of a US driver's license, state ID or green card. Everything is read here in your browser.</p>
            ${
              !cam &&
              html`<div className="idlinkopts">
                <button type="button" className="btn" onClick=${() => setCam(items.some(x => x.side === 'back' && (x.code || x.mrz)) ? 'front' : 'back')}><${Icon} n="camera" />Scan with the camera</button>
                <label className="btn ghost idsaddbtn"><input type="file" accept="image/*,application/pdf" multiple onChange=${e => { addFiles(e.target.files); e.target.value = ''; }} /><${Icon} n="up" />Add pictures or a PDF</label>
              </div>`
            }
            ${camera}
            ${
              !cam &&
              !items.length &&
              html`<label className="idsdrop" onDragOver=${e => e.preventDefault()} onDrop=${e => { e.preventDefault(); addFiles(e.dataTransfer.files); }}>
                <input type="file" accept="image/*,application/pdf" multiple onChange=${e => { addFiles(e.target.files); e.target.value = ''; }} />
                <${Icon} n="file" /><b>Or drop the pictures here</b><span>JPEG, PNG or PDF</span>
              </label>`
            }
            ${pics}
            ${frontLine}
            ${fm && fm.err && html`<p className="small t-amber">The front could not be read here (${fm.err}). You can compare it by eye after the check.</p>`}
            ${
              items.length > 0 &&
              !bar &&
              reading === 0 &&
              html`<div className="stack" style=${{ gap: 8 }}>
                ${
                  !(k === 'gc' && mrzSrc === 'scan' && !typing)
                    ? html`<${Fragment}>
                        <span className="lbl">${k === 'gc' && mrzSrc === 'unclear' ? 'The lines were found but some characters are unclear: compare them with the card and correct them' : k === 'gc' && mrzSrc === 'scan' ? 'The lines as read: compare them with the card' : 'Nothing was read from the back. Which ID is it?'}</span>
                        ${
                          !(k === 'gc' && (mrzSrc === 'scan' || mrzSrc === 'unclear')) &&
                          html`<div className="seg" role="group" aria-label="Which ID">${[['dl', "Driver's license or state ID"], ['gc', 'Green card']].map(([kk, v]) => html`<button key=${kk} type="button" className=${kind === kk ? 'on' : ''} onClick=${() => setKind(kk)}>${v}</button>`)}</div>`
                        }
                        ${kind === 'dl' && html`<p className="note amber" style=${{ margin: 0 }}><span>The barcode on the back could not be read. Scan the back with the camera, or add a sharper, flat picture of the back (the whole barcode, no glare).</span></p>`}
                        ${kind === 'gc' && mrzSrc === 'typed' && html`<p className="muted small">The three lines at the bottom of the back could not be read. Scan the back with the camera or add a sharper picture; or type the lines exactly as printed (30 characters each, every ${'<'} counted).</p>`}
                        ${kind === 'gc' && lineInputs}
                      <//>`
                    : html`<p className="small"><span className="chip ok">✓</span> The three lines on the back were read and every check digit is right. <a href="#" onClick=${e => { e.preventDefault(); setTyping(true); }}>Show them</a></p>`
                }
              </div>`
            }
            <${Field} label="Whose ID is it?" hint="Their name on the ID is compared with the record.">
              <select value=${who.kind === 'cand' ? who.id : who.kind === 'name' ? '__name' : who.kind ? '__init' : ''} onChange=${e => { const v = e.target.value; if (v === '__name') setWho({ kind: 'name', id: '', n: who.n || '' }); else if (v === '__init') setWho(init.who); else if (!v) setWho({ kind: '', id: '', n: '' }); else { const c = people.find(p => p.id === v); setWho({ kind: 'cand', id: v, n: c ? c.n : '' }); } }}>
                <option value="">Not linked to anyone</option>
                ${init && init.who && init.who.kind && init.who.kind !== 'cand' && init.who.kind !== 'name' && html`<option value="__init">${init.who.n}</option>`}
                <option value="__name">Someone not in the database (type the name)</option>
                <optgroup label="Consultant database">${people.map(p => html`<option key=${p.id} value=${p.id}>${p.n}${p.ti ? ', ' + p.ti : ''}</option>`)}</optgroup>
              </select>
            <//>
            ${who.kind === 'name' && html`<${Field} label="Name"><input value=${who.n} onInput=${e => setWho({ ...who, n: e.target.value })} placeholder="The person's full name" /><//>`}
          <//>`
        }
        ${
          step === 'fix' &&
          res &&
          html`<${Fragment}>
            <div className="idsverdict amber"><b>Can't tell yet</b><span>${need.length === 1 ? 'One thing is missing' : need.length + ' things are missing'}. Fix ${need.length === 1 ? 'it' : 'them'} below, then check again.</span></div>
            ${
              (need.includes('lines') || need.includes('barcode')) &&
              html`<div className="idsfix">
                <b>${need.includes('barcode') ? 'The barcode on the back could not be read.' : 'The three lines at the bottom of the back could not be read.'}</b>
                <div className="actions" style=${{ justifyContent: 'flex-start' }}>
                  <button type="button" className="btn sm" onClick=${() => setCam('back')}><${Icon} n="camera" />Scan the back with the camera</button>
                  <label className="btn ghost sm idsaddbtn"><input type="file" accept="image/*,application/pdf" onChange=${e => { addFiles(e.target.files); e.target.value = ''; }} /><${Icon} n="up" />Add a sharper picture</label>
                  ${need.includes('lines') && !typing && html`<button type="button" className="btn ghost sm" onClick=${() => setTyping(true)}>Type the lines</button>`}
                </div>
                ${need.includes('lines') && typing && lineInputs}
              </div>`
            }
            ${
              (need.includes('front') || need.includes('frontdiff')) &&
              html`<div className="idsfix">
                <b>${need.includes('frontdiff') ? 'The front may not match the back.' : 'The front was not compared with the back.'}</b>
                ${checksBy('front').filter(x => x.st !== 'pass').map((x, i) => html`<p key=${i} className="small">${x.t}</p>`)}
                <div className="idscmp">
                  <div>
                    <span className="lbl">${k === 'gc' ? 'The machine-readable lines say' : 'The barcode says'}</span>
                    ${shownRows.length ? html`<dl className="bddl">${shownRows.map(([a, b]) => html`<${Fragment} key=${a}><dt>${a}</dt><dd><b>${b}</b></dd><//>`)}</dl>` : html`<p className="muted small">Nothing could be read from the back.</p>`}
                  </div>
                  <div>
                    <span className="lbl">The front</span>
                    ${frontItem ? html`<img className="idsfront" src=${frontItem.url} alt="The front of the ID" />` : html`<p className="muted small">No picture of the front.</p>`}
                  </div>
                </div>
                ${
                  frontItem &&
                  html`<div className="stack" style=${{ gap: 8 }}>
                    <span className="lbl">Does the front show the same name, date of birth, number and expiry date?</span>
                    <div className="seg" role="group" aria-label="Front compared">
                      <button type="button" className=${front.mode === 'same' ? 'on' : ''} onClick=${() => setFront({ mode: 'same', diff: [] })}>Yes, the same</button>
                      <button type="button" className=${front.mode === 'differs' ? 'on' : ''} onClick=${() => setFront({ mode: 'differs', diff: front.diff })}>No, something differs</button>
                    </div>
                    ${front.mode === 'differs' && html`<div className="idsdiff">${['name', 'date of birth', 'number', 'expiry date', 'photo', 'other'].map(d => html`<label key=${d} className="check"><input type="checkbox" checked=${front.diff.includes(d)} onChange=${e => setFront({ ...front, diff: e.target.checked ? [...front.diff, d] : front.diff.filter(x => x !== d) })} /><span>${d}</span></label>`)}</div>`}
                  </div>`
                }
                <div className="actions" style=${{ justifyContent: 'flex-start' }}>
                  <button type="button" className="btn ghost sm" onClick=${() => setCam('front')}><${Icon} n="camera" />Scan the front with the camera</button>
                  <label className="btn ghost sm idsaddbtn"><input type="file" accept="image/*,application/pdf" onChange=${async e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return; try { const pages = await idsPages(f); setItems(list => list.map(x => (x.side === 'front' ? { ...x, side: 'page' } : x))); await add(pages[0], 'front', null, { n: f.name }); } catch (err) { toast(errText(err), true); } }} /><${Icon} n="up" />Add a sharper picture of the front</label>
                </div>
              </div>`
            }
            ${camera}
            ${frontLine}
            ${pics}
          <//>`
        }
        ${
          step === 'result' &&
          res &&
          html`<${Fragment}>
            <div className=${'idsverdict ' + IDS_V[res.v][1]}>
              <b>${IDS_V[res.v][0]}</b>
              <span>${[sh.kind || IDS_KIND[res.kind] || 'ID', sh.number ? '…' + String(sh.number).slice(-4) : ''].filter(Boolean).join(' · ')}</span>
            </div>
            <p className="muted small">${res.v === 'ok' ? 'Every check passed. ' : res.v === 'fake' ? 'A check that a genuine document passes failed (below). Look closer before going further: ask for the original on a video call, or for another copy. ' : 'Something needed could not be read or compared (below). '}Automated checks of the pictures, not a government verification; not for Form I-9 decisions.</p>
            ${IDS_GROUPS.filter(([g]) => checksBy(g).length).map(
              ([g, label]) => html`<div key=${g}>
                <span className="lbl">${label}</span>
                <ul className="idschecks">${checksBy(g).map((x, i) => html`<li key=${i} className=${'is-' + x.st}><i className=${'chip ' + IDS_ST[x.st][1]}>${IDS_ST[x.st][0]}</i><span>${x.t}</span></li>`)}</ul>
              </div>`
            )}
            <div className="bdform form">
              <span className="lbl">Your decision</span>
              <div className="seg" role="group" aria-label="Decision">
                ${Object.entries(IDS_DEC).map(([kk, [v]]) => html`<button key=${kk} type="button" className=${dec.st === kk ? 'on' : ''} onClick=${() => setDec({ ...dec, st: kk })}>${v}</button>`)}
              </div>
              ${dec.st && html`<${Field} label=${dec.st === 'not' ? 'Why (required, kept with the check)' : 'Note (optional)'}><input value=${dec.note} onInput=${e => setDec({ ...dec, note: e.target.value })} /><//>`}
            </div>
          <//>`
        }
      </div>
    <//>`;
}

/* ---------- ID links: a person scans or uploads their ID from a link ---------- */
function IdsLinkModal({ boot, init, onClose, onMade }) {
  const toast = useToast();
  const cands = useCol('rec/cand/items', 'n:asc');
  const [who, setWho] = useState((init && init.who) || { kind: '', id: '', n: '' });
  const [f, setF] = useState({ email: (init && init.email) || '', kind: 'any', days: 7, note: '' });
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState(null);
  const people = cands.docs.slice(0, 2000);
  const go = async send => {
    setBusy(true);
    try {
      const r = await api('ids_req_new', { who: JSON.stringify(who), email: f.email, kind: f.kind, days: f.days, note: f.note, send: send ? '1' : '' });
      setMade({ ...r, sent: send });
      onMade && onMade(r);
      if (!send) {
        try {
          await navigator.clipboard.writeText(r.url);
          toast('Link copied. Paste it in a message to ' + (who.n || 'them') + '.');
        } catch (e) {
          /* copied by hand below */
        }
      } else toast('Link emailed to ' + f.email + '.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<${Modal} title="Send an ID link" onClose=${onClose} foot=${made ? html`<button className="btn" onClick=${onClose}>Done</button>` : html`<button className="btn ghost" onClick=${onClose}>Cancel</button><button className="btn ghost" disabled=${busy || !who.n} onClick=${() => go(false)}><${Icon} n="link" />Create and copy the link</button><button className="btn" disabled=${busy || !who.n || !f.email} onClick=${() => go(true)}><${Icon} n="send" />Email the link</button>`}>
      ${
        made
          ? html`<div className="stack" style=${{ gap: 10 }}>
              <p>${made.sent ? 'The link was emailed to ' + f.email + '.' : 'The link is ready.'} When ${who.n || 'they'} scan or upload their ID, it is read here and the result appears in ID checks (you get an email).</p>
              <div className="idslinkurl"><input readOnly value=${made.url} onFocus=${e => e.target.select()} aria-label="The link" /><button type="button" className="btn ghost sm" onClick=${async () => { try { await navigator.clipboard.writeText(made.url); toast('Link copied.'); } catch (e) { toast('Select the link and copy it.', true); } }}>Copy</button></div>
            </div>`
          : html`<div className="stack" style=${{ gap: 12 }}>
              <p className="muted small">They open the link on their phone, scan their ID with the camera or upload pictures (only pictures that can be read are accepted), and send it. No account needed; the link works once.</p>
              <${Field} label="Whose ID?">
                <select value=${who.kind === 'cand' ? who.id : who.kind === 'name' ? '__name' : who.kind ? '__init' : ''} onChange=${e => { const v = e.target.value; if (v === '__name') setWho({ kind: 'name', id: '', n: '' }); else if (v === '__init') setWho(init.who); else if (!v) setWho({ kind: '', id: '', n: '' }); else { const c = people.find(p => p.id === v); setWho({ kind: 'cand', id: v, n: c ? c.n : '' }); if (c && c.e && !f.email) setF(x => ({ ...x, email: c.e })); } }}>
                  <option value="">Choose…</option>
                  ${init && init.who && init.who.kind && init.who.kind !== 'cand' && init.who.kind !== 'name' && html`<option value="__init">${init.who.n}</option>`}
                  <option value="__name">Someone not in the database (type the name)</option>
                  <optgroup label="Consultant database">${people.map(p => html`<option key=${p.id} value=${p.id}>${p.n}${p.ti ? ', ' + p.ti : ''}</option>`)}</optgroup>
                </select>
              <//>
              ${who.kind === 'name' && html`<${Field} label="Their name"><input value=${who.n} onInput=${e => setWho({ ...who, n: e.target.value })} placeholder="Full name" /><//>`}
              <${Field} label="Their email" hint="To email the link. Leave it empty to copy the link and send it another way."><input type="email" value=${f.email} onInput=${e => setF({ ...f, email: e.target.value })} /><//>
              <${Field} label="Which ID" hint=${f.kind === 'gc' ? 'Ask every candidate the same way, and never use this for Form I-9 (the person chooses their I-9 documents).' : 'They choose a green card, a driver\'s license or a state ID.'}>
                <div className="seg" role="group" aria-label="Which ID">${[['any', 'They choose'], ['gc', 'Green card'], ['dl', "Driver's license or state ID"]].map(([kk, v]) => html`<button key=${kk} type="button" className=${f.kind === kk ? 'on' : ''} onClick=${() => setF({ ...f, kind: kk })}>${v}</button>`)}</div>
              <//>
              <div className="row2">
                <${Field} label="The link works for (days)"><input type="number" min="1" max="30" value=${f.days} onInput=${e => setF({ ...f, days: e.target.value })} style=${{ maxWidth: 120 }} /><//>
                <${Field} label="A note for them (optional)"><input value=${f.note} maxLength="400" onInput=${e => setF({ ...f, note: e.target.value })} placeholder="For the Java role at Acme" /><//>
              </div>
            </div>`
      }
    <//>`;
}
function IdsLinks({ boot, onChanged, onOpen }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const act = async (id, r) => {
    setBusy(id);
    try {
      await api(r, { id });
      toast(r === 'ids_req_cancel' ? 'Link cancelled.' : 'Link emailed again.');
      onChanged();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const copy = async url => {
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied.');
    } catch (e) {
      toast('The link: ' + url);
    }
  };
  const rows = boot.reqs || [];
  if (!rows.length) return null;
  return html`<section className="panel" style=${{ padding: '6px 8px' }}>
      <h2 style=${{ margin: '8px 6px' }}>ID links</h2>
      <div className="tblwrap"><table className="tbl">
        <thead><tr><th>Sent</th><th>To</th><th>ID</th><th>Status</th><th>By</th><th></th></tr></thead>
        <tbody>${rows.map(r => {
          const st = r.st === 'open' && r.opened ? 'opened' : r.st;
          return html`<tr key=${r.id}>
            <td className="num nw">${fmtTs(r.at)}</td>
            <td><b style=${{ fontWeight: 600 }}>${(r.who && r.who.n) || '—'}</b>${r.email ? html`<div className="muted small">${r.email}</div>` : ''}</td>
            <td className="small">${r.kind === 'any' ? 'They choose' : IDS_KIND[r.kind]}</td>
            <td><${Chip} s=${(IDS_REQ_ST[st] || ['', ''])[1]}>${(IDS_REQ_ST[st] || [st])[0]}<//>${r.st === 'open' ? html`<div className="muted small">until ${fmtDay(r.exp)}</div>` : ''}</td>
            <td className="small">${r.byn}</td>
            <td className="nw">
              ${r.st === 'done' && r.check && html`<button className="btn ghost sm" onClick=${() => onOpen(r.check)}>Open the check</button>`}
              ${(r.st === 'open' || r.st === 'expired') && r.url && html`<button className="btn ghost sm" onClick=${() => copy(r.url)}><${Icon} n="link" />Copy</button>`}
              ${(r.st === 'open' || r.st === 'expired') && r.email && html`<button className="btn ghost sm" disabled=${busy === r.id} onClick=${() => act(r.id, 'ids_req_send')}>Email again</button>`}
              ${r.st === 'open' && html`<button className="btn ghost sm" disabled=${busy === r.id} onClick=${() => act(r.id, 'ids_req_cancel')}>Cancel</button>`}
            </td>
          </tr>`;
        })}</tbody>
      </table></div>
    </section>`;
}

/* ---------- the page: every check, the links, the settings ---------- */
function IdScanPage({ q }) {
  const toast = useToast();
  const [boot, setBoot] = useState(null);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(null);
  const [link, setLink] = useState(null);
  const [view, setView] = useState(null);
  const [f, setF] = useState('all');
  const [qs, setQs] = useState('');
  const [auto, setAuto] = useState(null); // the link checks being read here: {n, of, who}
  const seen = useRef(new Set());
  const load = () => api('ids_boot', {}).then(setBoot, setErr);
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (q && q.open && /^[a-f0-9]{16}$/.test(q.open)) setView(q.open);
  }, [q && q.open]);
  // checks that arrived through links are read here as soon as the page opens
  useEffect(() => {
    if (!boot || auto || !(boot.waiting || []).length || !boot.ack) return;
    const todo = boot.waiting.filter(w => !seen.current.has(w.id));
    if (!todo.length) return;
    (async () => {
      let n = 0;
      for (const w of todo) {
        seen.current.add(w.id);
        setAuto({ n: ++n, of: todo.length, who: (w.who && w.who.n) || 'someone' });
        try {
          const r = await idsAutoRead(w);
          toast(((w.who && w.who.n) || 'The ID') + ': ' + IDS_V[r.v][0] + '.');
        } catch (e) {
          toast(errText(e), true);
        }
      }
      setAuto(null);
      load();
    })();
  }, [boot]);
  if (err) return html`<div className="note red"><span>${errText(err)}</span></div>`;
  if (!boot) return html`<${Spinner} />`;
  const ql = qs.trim().toLowerCase();
  const list = boot.list.filter(x => (f === 'all' || x.v === f || (f === 'open' && !x.dec)) && (!ql || [x.who && x.who.n, x.byn, x.jur, x.num4].filter(Boolean).join(' ').toLowerCase().includes(ql)));
  const n = v => boot.list.filter(x => x.v === v).length;
  return html`<div className="stack">
      <div className="kpis" style=${{ gridTemplateColumns: 'repeat(4,minmax(0,1fr))' }}>
        <a onClick=${() => setF('all')}><b>${boot.list.length}</b><span>IDs checked</span></a>
        <a onClick=${() => setF('ok')}><b>${n('ok')}</b><span>Looked genuine</span></a>
        <a onClick=${() => setF('fake')}><b>${n('fake')}</b><span>Looked fake</span></a>
        <a onClick=${() => setF('open')}><b>${boot.list.filter(x => !x.dec).length}</b><span>No decision yet</span></a>
      </div>
      ${auto && html`<div className="note" role="status"><span><span className="spin sm" /> Reading the ID ${auto.who} sent through a link${auto.of > 1 ? ' (' + auto.n + ' of ' + auto.of + ')' : ''}…</span></div>`}
      <div className="toolbar">
        <input type="search" style=${{ maxWidth: 280 }} placeholder="Search name, checked by, state" value=${qs} onInput=${e => setQs(e.target.value)} aria-label="Search ID checks" />
        <div className="seg" style=${{ marginBottom: 0 }}>
          ${[
            ['all', 'All'],
            ['fake', 'Looked fake'],
            ['unsure', "Can't tell"],
            ['open', 'No decision'],
          ].map(([kk, v]) => html`<button key=${kk} className=${f === kk ? 'on' : ''} onClick=${() => setF(kk)}>${v}</button>`)}
        </div>
        <div className="push">
          <button className="btn ghost" onClick=${() => setLink({})}><${Icon} n="link" />Send an ID link</button>
          <button className="btn" onClick=${() => setOpen({})}><${Icon} n="shield" />Check an ID</button>
        </div>
      </div>
      <section className="panel" style=${{ padding: '6px 8px' }}>
        ${
          list.length
            ? html`<div className="tblwrap"><table className="tbl">
                <thead><tr><th>When</th><th>Whose</th><th>Document</th><th>Result</th><th>Decision</th><th>Checked by</th></tr></thead>
                <tbody>${list.map(
                  x => html`<tr key=${x.id} className="click" tabIndex="0" onClick=${() => setView(x.id)} onKeyDown=${e => e.key === 'Enter' && setView(x.id)}>
                    <td className="num nw">${fmtTs(x.at)}</td>
                    <td><b style=${{ fontWeight: 600 }}>${(x.who && x.who.n) || '—'}</b></td>
                    <td className="small">${IDS_KIND[x.kind] || 'ID'}${x.jur ? ' · ' + x.jur : ''}${x.num4 ? ' · ' + x.num4 : ''}</td>
                    <td><${Chip} s=${(IDS_V[x.v] || ['', ''])[1]}>${(IDS_V[x.v] || [x.v])[0]}<//>${x.fails ? html`<div className="muted small">${bdPlural(x.fails, 'failed check')}</div>` : ''}</td>
                    <td>${x.dec ? html`<${Chip} s=${(IDS_DEC[x.dec.st] || ['', ''])[1]}>${(IDS_DEC[x.dec.st] || [x.dec.st])[0]}<//>` : html`<span className="muted small">None yet</span>`}</td>
                    <td className="small">${x.byn}</td>
                  </tr>`
                )}</tbody>
              </table></div>`
            : html`<${Empty} title=${boot.list.length ? 'No check matches' : 'No ID checked yet'} action=${html`<button className="btn" onClick=${() => setOpen({})}>Check an ID</button>`}>Check a driver's license, state ID or green card that a candidate, consultant or vendor sent, or send them a link to scan it. Files in a consultant's record or an email have a "Check ID" button too.<//>`
        }
      </section>
      <${IdsLinks} boot=${boot} onChanged=${load} onOpen=${id => setView(id)} />
      ${boot.admin && html`<${IdsSettings} boot=${boot} onSaved=${load} />`}
      ${open && html`<${IdScanModal} init=${open} onClose=${() => setOpen(null)} onDone=${() => load()} />`}
      ${link && html`<${IdsLinkModal} boot=${boot} init=${link} onClose=${() => setLink(null)} onMade=${() => load()} />`}
      ${view && html`<${IdsView} id=${view} onClose=${() => { setView(null); load(); }} onAgain=${init => { setView(null); setOpen(init); }} />`}
    </div>`;
}
/* one finished check */
function IdsView({ id, onClose, onAgain }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [dec, setDec] = useState({ st: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [cmp, setCmp] = useState({ mode: '', diff: [] });
  const get = () =>
    api('ids_get', { id }).then(
      r => {
        setD(r);
        setDec({ st: (r.dec && r.dec.st) || '', note: (r.dec && r.dec.note) || '' });
      },
      e => toast(errText(e), true)
    );
  useEffect(() => {
    get();
  }, [id]);
  const save = async () => {
    setBusy(true);
    try {
      await api('ids_decide', { id, st: dec.st, note: dec.note });
      toast('Decision saved.');
      onClose();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const compare = async () => {
    setBusy(true);
    try {
      const r = await api('ids_front', { id, mode: cmp.mode, diff: JSON.stringify(cmp.diff) });
      toast('Front compared: ' + IDS_V[r.v][0] + '.');
      setCmp({ mode: '', diff: [] });
      await get();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const again = () =>
    onAgain({
      again: id,
      who: d.who && d.who.n ? d.who : undefined,
      src: 'again',
      refs: d.img.filter(p => !p.gone).map(p => ({ url: API + 'ids_img&id=' + encodeURIComponent(id) + '&f=' + encodeURIComponent(p.fid), side: p.side, n: (p.side || 'picture') + '.jpg' })),
    });
  const frontOpen = d && d.bk && d.checks.some(x => (x.k === 'front' && x.st === 'unsure') || x.k === 'frontdiff');
  return html`<${Modal} wide title="ID check" onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Close</button>${d && d.img.some(p => !p.gone) && html`<button className="btn ghost" onClick=${again}><${Icon} n="refresh" />Check again</button>`}${d && html`<button className="btn" disabled=${busy || !dec.st} onClick=${save}>Save the decision</button>`}`}>
      ${
        !d
          ? html`<${Spinner} />`
          : html`<div className="stack" style=${{ gap: 12 }}>
              <div className=${'idsverdict ' + (IDS_V[d.v] || ['', ''])[1]}><b>${(IDS_V[d.v] || [d.v])[0]}</b><span>${[IDS_KIND[d.kind] || 'ID', d.jur, d.num4, d.who && d.who.n].filter(Boolean).join(' · ')}</span></div>
              <p className="muted small">Checked ${fmtTs(d.at)} by ${d.byn}${d.src === 'link' ? ' (sent by the person through an ID link)' : ''}. ${d.dec ? 'Decision: ' + (IDS_DEC[d.dec.st] || [d.dec.st])[0] + ' (' + d.dec.by + ', ' + fmtDay(d.dec.at) + ')' + (d.dec.note ? ': ' + d.dec.note : '') + '.' : 'No decision yet.'}</p>
              ${d.next && html`<p className="note"><span>This ID was checked again later: the newer check is in the list.</span></p>`}
              ${d.v === 'unsure' && !d.next && d.img.some(p => !p.gone) && html`<div className="note amber"><span><b>Can't tell</b>: ${d.bk ? 'the back was read' : 'the back could not be read'}${d.bk && !d.fd ? ', the front was not compared' : ''}. ${d.bk && !d.fd ? 'Compare the front by eye below, or ' : ''}<a href="#" onClick=${e => { e.preventDefault(); again(); }}>check it again</a> (the pictures are read again, and you can add sharper ones or use the camera).</span></div>`}
              <div className="idspics">${d.img.map(p => html`<div key=${p.fid} className="idspic">${p.gone ? html`<div className="muted small" style=${{ padding: 20 }}>Picture deleted after the retention period</div>` : html`<img src=${API + 'ids_img&id=' + encodeURIComponent(id) + '&f=' + encodeURIComponent(p.fid)} alt=${p.side} />`}<div className="idspicf"><span className="small">${p.side === 'page' ? 'Picture' : p.side}</span></div></div>`)}</div>
              ${IDS_GROUPS.filter(([g]) => d.checks.some(x => x.g === g)).map(
                ([g, label]) => html`<div key=${g}><span className="lbl">${label}</span><ul className="idschecks">${d.checks.filter(x => x.g === g).map((x, i) => html`<li key=${i} className=${'is-' + x.st}><i className=${'chip ' + IDS_ST[x.st][1]}>${IDS_ST[x.st][0]}</i><span>${x.t}</span></li>`)}</ul></div>`
              )}
              ${
                frontOpen &&
                html`<div className="idsfix">
                  <b>Compare the front with the back by eye</b>
                  <p className="muted small">Look at both pictures above: the name, the date of birth, the number and the expiry date.</p>
                  <div className="seg" role="group" aria-label="Front compared">
                    <button type="button" className=${cmp.mode === 'same' ? 'on' : ''} onClick=${() => setCmp({ mode: 'same', diff: [] })}>The same</button>
                    <button type="button" className=${cmp.mode === 'differs' ? 'on' : ''} onClick=${() => setCmp({ mode: 'differs', diff: cmp.diff })}>Something differs</button>
                  </div>
                  ${cmp.mode === 'differs' && html`<div className="idsdiff">${['name', 'date of birth', 'number', 'expiry date', 'photo', 'other'].map(x => html`<label key=${x} className="check"><input type="checkbox" checked=${cmp.diff.includes(x)} onChange=${e => setCmp({ ...cmp, diff: e.target.checked ? [...cmp.diff, x] : cmp.diff.filter(y => y !== x) })} /><span>${x}</span></label>`)}</div>`}
                  <div className="actions" style=${{ justifyContent: 'flex-start' }}><button className="btn sm" disabled=${busy || !cmp.mode} onClick=${compare}>Save the comparison</button></div>
                </div>`
              }
              <div className="bdform form">
                <span className="lbl">Decision</span>
                <div className="seg" role="group" aria-label="Decision">${Object.entries(IDS_DEC).map(([kk, [v]]) => html`<button key=${kk} type="button" className=${dec.st === kk ? 'on' : ''} onClick=${() => setDec({ ...dec, st: kk })}>${v}</button>`)}</div>
                ${dec.st && html`<${Field} label=${dec.st === 'not' ? 'Why (required)' : 'Note (optional)'}><input value=${dec.note} onInput=${e => setDec({ ...dec, note: e.target.value })} /><//>`}
              </div>
            </div>`
      }
    <//>`;
}
function IdsSettings({ boot, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ ...boot.set });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api('ids_settings_save', f);
      toast('ID check settings saved.');
      onSaved();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<section className="panel stack" style=${{ gap: 12 }}>
      <h2>Settings</h2>
      <label className="check"><input type="checkbox" checked=${f.rec} onChange=${e => setF({ ...f, rec: e.target.checked })} /><span>Recruiters and recruiting team may check IDs and send ID links (HR and administrators always can)</span></label>
      <label className="check"><input type="checkbox" checked=${f.ai} disabled=${!boot.ai} onChange=${e => setF({ ...f, ai: e.target.checked })} /><span>StratEdge AI also reads the pictures (tampering, screens, photocopies)${boot.ai ? '' : ' (set up StratEdge AI first)'}</span></label>
      <p className="muted small" style=${{ marginTop: -6 }}>Without it, everything is still read in the browser: the license barcode, the green card's three lines and the front's text. When on, the pictures of each ID you check are also sent to your AI provider.</p>
      <${Field} label="Delete the pictures after (days)" hint="The result of each check stays. Pictures from ID links waiting to be read are deleted after this too."><input type="number" min="7" max="3650" value=${f.keep} onInput=${e => setF({ ...f, keep: e.target.value })} style=${{ maxWidth: 140 }} /><//>
      <div className="actions" style=${{ justifyContent: 'flex-start' }}><button className="btn" disabled=${busy} onClick=${save}>Save</button></div>
    </section>`;
}
