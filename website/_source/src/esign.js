/* ================= E-signatures ================= */
const SIG_ST = { sent: 'Awaiting signature', completed: 'Completed', declined: 'Declined', cancelled: 'Cancelled' };
const sigChip = s => s === 'completed' ? 'ok' : s === 'declined' ? 'red' : s === 'cancelled' ? '' : 'amber';
let _pdfLib = null;
function loadPdfLib() {
  if (window.PDFLib) return Promise.resolve(window.PDFLib);
  if (_pdfLib) return _pdfLib;
  _pdfLib = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'js/vendor/pdf-lib.min.js'; s.onload = () => res(window.PDFLib); s.onerror = () => { _pdfLib = null; rej({ message: 'The PDF library could not be loaded. Check your connection and try again.' }); }; document.head.appendChild(s); });
  return _pdfLib;
}
const ascii = s => String(s || '').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\u2013|\u2014/g, '-').replace(/\u20B9/g, 'INR ').replace(/[^\x20-\x7E]/g, '');
const myTurn = (d, uid) => d.st === 'sent' && d.signers && d.signers[d.cur || 0] && d.signers[d.cur || 0].uid === uid;
const pendingSigs = (docs, uid) => (docs || []).filter(d => myTurn(d, uid));

function SignaturePad({ onChange }) {
  const cv = useRef(null); const drawing = useRef(false); const inked = useRef(false);
  useEffect(() => { const c = cv.current; const r = window.devicePixelRatio || 1; c.width = c.clientWidth * r; c.height = c.clientHeight * r; const x = c.getContext('2d'); x.scale(r, r); x.lineWidth = 2.4; x.lineCap = 'round'; x.lineJoin = 'round'; x.strokeStyle = '#13205a'; }, []);
  const pos = e => { const r = cv.current.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const down = e => { e.preventDefault(); drawing.current = true; const x = cv.current.getContext('2d'); const [px, py] = pos(e); x.beginPath(); x.moveTo(px, py); try { cv.current.setPointerCapture(e.pointerId); } catch (err) { /* pointer capture unavailable */ } };
  const move = e => { if (!drawing.current) return; const x = cv.current.getContext('2d'); const [px, py] = pos(e); x.lineTo(px, py); x.stroke(); inked.current = true; onChange(cv.current.toDataURL('image/png')); };
  const up = () => { if (drawing.current && inked.current) onChange(cv.current.toDataURL('image/png')); drawing.current = false; };
  const clear = () => { const c = cv.current; const x = c.getContext('2d'); x.clearRect(0, 0, c.width, c.height); inked.current = false; onChange(''); };
  return html`<div className="sigpad"><canvas ref=${cv} onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerLeave=${up} aria-label="Draw your signature" />
    <div className="actions" style=${{ justifyContent: 'space-between' }}><span className="muted small">Draw with your mouse or finger.</span><button type="button" className="btn ghost sm" onClick=${clear}>Clear</button></div></div>`;
}
function typedSignaturePng(name) {
  const c = document.createElement('canvas'); c.width = 900; c.height = 260; const x = c.getContext('2d');
  x.font = 'italic 600 88px "Archivo", "Segoe Script", "Brush Script MT", cursive'; x.fillStyle = '#13205a'; x.textBaseline = 'middle'; x.fillText(name, 30, 130);
  return c.toDataURL('image/png');
}
const b64ToBytes = dataUrl => { const bin = atob(dataUrl.split(',')[1]); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
async function buildSignedPdf(src, mime, info) {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  let pdf;
  if (mime === 'application/pdf') pdf = await PDFDocument.load(src, { ignoreEncryption: true, updateMetadata: false });
  else { pdf = await PDFDocument.create(); const img = mime === 'image/png' ? await pdf.embedPng(src) : await pdf.embedJpg(src); const k = Math.min(1, 540 / img.width, 700 / img.height); const page = pdf.addPage([612, 792]); page.drawImage(img, { x: (612 - img.width * k) / 2, y: 792 - 46 - img.height * k, width: img.width * k, height: img.height * k }); }
  const font = await pdf.embedFont(StandardFonts.Helvetica); const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const stamp = ascii(`Electronically signed by ${info.name} on ${info.when}. StratEdge e-sign ${info.id}.`);
  pdf.getPages().forEach(p => { const { width } = p.getSize(); p.drawText(stamp, { x: 30, y: 14, size: 7.5, font, color: rgb(0.35, 0.35, 0.35), maxWidth: width - 60 }); });
  const page = pdf.addPage([612, 792]); let y = 736;
  const line = (t, size, f, color) => { const words = ascii(t).split(' '); let cur = ''; const fl = []; words.forEach(w => { const test = cur ? cur + ' ' + w : w; if ((f || font).widthOfTextAtSize(test, size) > 500 && cur) { fl.push(cur); cur = w; } else cur = test; }); if (cur) fl.push(cur); fl.forEach(l => { page.drawText(l, { x: 56, y, size, font: f || font, color: color || rgb(0.08, 0.1, 0.2) }); y -= size * 1.45; }); };
  line('Electronic signature certificate', 20, bold); y -= 10;
  line(`Document: ${info.title}`, 11); line(`File: ${info.file}`, 10, font, rgb(0.35, 0.35, 0.35)); y -= 6;
  line(`Signed by: ${info.name} (${info.email})`, 11); line(`Signed on: ${info.when}`, 11); line(`Request ID: ${info.id}`, 11); if (info.hash) line(`Original document SHA-256: ${info.hash}`, 8.5, font, rgb(0.35, 0.35, 0.35)); y -= 8;
  line('The signer confirmed that they reviewed the document and agreed to sign it electronically, and that this electronic signature has the same effect as a handwritten signature. Signing details, including the time and network address, are kept in the StratEdge portal audit log.', 9.5, font, rgb(0.3, 0.3, 0.3)); y -= 16;
  if (info.sigPng) { const img = await pdf.embedPng(b64ToBytes(info.sigPng)); const w = 230, h = w * img.height / img.width; page.drawImage(img, { x: 56, y: y - h, width: w, height: h }); y -= h + 6; }
  page.drawLine({ start: { x: 56, y }, end: { x: 316, y }, thickness: 1, color: rgb(0.2, 0.2, 0.3) }); y -= 16;
  line(info.name, 11, bold); line('Signature', 9, font, rgb(0.4, 0.4, 0.4));
  return await pdf.save();
}

/* The signing panel itself, shared by portal members and email signers */
function SignPanel({ d, mine, signer, tok, onDone }) {
  const toast = useToast(); const base = `sig/${d.id}`;
  const [mode, setMode] = useState('draw'); const [png, setPng] = useState(''); const [typed, setTyped] = useState(signer.n || '');
  const [consent, setConsent] = useState(false); const [busy, setBusy] = useState(''); const [decl, setDecl] = useState(null); const [done, setDone] = useState(null);
  useEffect(() => { if (mine) api('sig_viewed', { id: d.id, tok: tok || undefined }).catch(() => {}); }, [d.id]);
  const sign = async () => {
    if (!consent) { toast('Please confirm you agree to sign electronically.', true); return; }
    if (mode === 'draw' && !png) { toast('Draw your signature first.', true); return; }
    if (!typed.trim()) { toast('Type your full name.', true); return; }
    setBusy('sign');
    try {
      const latest = d.sfid || d.fid; const latestType = d.sfid ? 'application/pdf' : d.fty;
      const res = await fetch(fileUrl(base, latest, false, tok), { credentials: 'same-origin' }); if (!res.ok) throw { message: 'The document could not be loaded.' };
      const bytes = new Uint8Array(await res.arrayBuffer());
      const when = new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) + ' (' + Intl.DateTimeFormat().resolvedOptions().timeZone + ')';
      const out = await buildSignedPdf(bytes, latestType, { name: typed.trim(), email: signer.e || '', when, id: d.id, title: d.ti, file: d.fn, hash: d.fh, sigPng: mode === 'draw' ? png : typedSignaturePng(typed.trim()) });
      const fd = new FormData(); fd.append('id', d.id); if (tok) fd.append('tok', tok); fd.append('name', typed.trim()); fd.append('consent', '1'); fd.append('file', new Blob([out], { type: 'application/pdf' }), (d.fn || 'document').replace(/\.[^.]+$/, '') + '-signed.pdf');
      const r = await upload('sig_sign', fd); Sync.kick(); setDone(r.st); toast(r.st === 'completed' ? 'Signed. A copy has been emailed to everyone.' : 'Signed. The next signer has been notified.'); onDone && onDone(r.st);
    } catch (e) { toast(errText(e), true); }
    setBusy('');
  };
  const decline = async () => { setBusy('decline'); try { await api('sig_decline', { id: d.id, tok: tok || undefined, reason: decl || '' }); Sync.kick(); setDone('declined'); toast('Declined. The sender has been notified.'); onDone && onDone('declined'); } catch (e) { toast(errText(e), true); } setBusy(''); };
  const isPdf = d.fty === 'application/pdf';
  if (done) return html`<div className=${'note ' + (done === 'declined' ? 'red' : 'ok')}><span><b>${done === 'declined' ? 'You declined to sign.' : done === 'completed' ? 'All signatures collected.' : 'Thank you, your signature has been recorded.'}</b> ${done === 'completed' ? 'The signed copy has been emailed to everyone.' : done === 'declined' ? 'The sender has been told.' : 'You\u2019ll receive the final signed copy by email once everyone has signed.'}</span></div>`;
  return html`<div className="stack">
    <div className="actions"><${Chip} s=${sigChip(d.st)}>${SIG_ST[d.st] || d.st}<//><span className="muted small">From ${d.byn}, ${fmtDay(d.at)}${d.due ? '. Due ' + fmtDate(d.due, { month: 'short', day: 'numeric', year: 'numeric' }) : ''}</span></div>
    ${d.msg && html`<div className="note info"><span style=${{ whiteSpace: 'pre-wrap' }}>${d.msg}</span></div>`}
    <div className="docview">${isPdf || d.sfid ? html`<iframe src=${fileUrl(base, d.sfid || d.fid, false, tok)} title="Document to sign" />` : html`<img src=${fileUrl(base, d.fid, false, tok)} alt="Document to sign" />`}</div>
    <p className="muted small">Can't see it? <a href=${fileUrl(base, d.sfid || d.fid, false, tok)} target="_blank" rel="noopener">Open the document in a new tab</a> or <a href=${fileUrl(base, d.sfid || d.fid, true, tok)}>download it</a>.${d.sfid && d.st === 'sent' ? ' This copy already carries the earlier signature.' : ''}</p>
    ${mine ? html`<section className="panel stack" style=${{ gap: 12 }}>
        <div className="ph-row" style=${{ marginBottom: 0 }}><h2 className="ph">Your signature</h2><div className="seg" style=${{ marginBottom: 0 }}>${[['draw', 'Draw'], ['type', 'Type']].map(([k, v]) => html`<button key=${k} type="button" className=${mode === k ? 'on' : ''} onClick=${() => setMode(k)}>${v}</button>`)}</div></div>
        ${mode === 'draw' ? html`<${SignaturePad} onChange=${setPng} />` : html`<div className="sigtype">${typed || 'Your name'}</div>`}
        <${Field} label="Full legal name"><input value=${typed} onInput=${e => setTyped(e.target.value)} /><//>
        <label className="check"><input type="checkbox" checked=${consent} onChange=${e => setConsent(e.target.checked)} /><span>I have reviewed this document and agree to sign it electronically. I understand this electronic signature is as binding as a handwritten one.</span></label>
        <div className="actions">
          <button type="button" className="btn go lg" disabled=${!!busy} onClick=${sign}>${busy === 'sign' ? 'Signing…' : 'Sign document'}</button>
          ${decl === null ? html`<button type="button" className="btn ghost" disabled=${!!busy} onClick=${() => setDecl('')}>Decline</button>` : html`<input value=${decl} onInput=${e => setDecl(e.target.value)} placeholder="Reason (optional)" style=${{ maxWidth: 240 }} /><button type="button" className="btn danger" disabled=${!!busy} onClick=${decline}>Confirm decline</button>`}
        </div>
      </section>`
      : d.st === 'sent' ? html`<div className="note amber"><span>Waiting for ${(d.signers[d.cur || 0] || {}).n || 'another signer'} to sign first.</span></div>` : null}
    ${d.st === 'completed' && d.sfid && html`<div className="note ok"><span><b>Completed ${fmtDay(d.done)}.</b></span><div className="actions"><a className="btn sm" href=${fileUrl(base, d.sfid, true, tok)}>Download signed copy</a></div></div>`}
  </div>`;
}
function SignModal({ d, onClose }) {
  const P = usePortal();
  return html`<${Modal} wide title=${d.ti} onClose=${onClose} foot=${html`<button type="button" className="btn" onClick=${onClose}>Close</button>`}>
    <${SignPanel} d=${d} mine=${myTurn(d, P.uid)} signer=${{ n: P.prof ? P.prof.n : ((Cap.me && Cap.me.name) || ''), e: (Cap.me && Cap.me.email) || '' }} /><//>`;
}
/* Public signing page for email signers (no account needed) */
function SignPublic({ id, tok }) {
  const [d, setD] = useState(undefined);
  useEffect(() => { api('sig_public_get&id=' + encodeURIComponent(id) + '&tok=' + encodeURIComponent(tok)).then(r => setD(r.d)).catch(() => setD(null)); }, [id, tok]);
  return html`<${Fragment}>
    <${PageHead} title=${d ? d.ti : 'Sign document'} intro=${d ? `Sent by ${d.byn} at StratEdge IT Consulting. Review the document below and sign it on screen; no account is needed.` : ''} />
    <section className="sec" style=${{ paddingTop: 48 }}><div className="wrap" style=${{ maxWidth: 960 }}>
      ${d === undefined ? html`<${Spinner} label="Loading your document…" />` : d === null ? html`<div className="panel"><${Empty} title="This signing link isn\u2019t valid">It may have been cancelled or already used. Contact ${CO.email} if you still need to sign.<//></div>`
        : html`<${SignPanel} d=${d} mine=${d.st === 'sent' && d.me === (d.cur || 0)} signer=${d.signers[d.me] || {}} tok=${tok} onDone=${st => setD({ ...d, st, cur: (d.cur || 0) + 1 })} />`}
    </div></section>
  <//>`;
}

/* ---- Recipient view ---- */
function SignDocsPage() {
  const P = usePortal(); const [open, setOpen] = useState(null); const [tab, setTab] = useState('todo');
  const docs = P.sigs || [];
  const todo = pendingSigs(docs, P.uid); const done = docs.filter(d => d.st !== 'sent');
  const waiting = docs.filter(d => d.st === 'sent' && !myTurn(d, P.uid));
  const list = tab === 'todo' ? todo : tab === 'done' ? done : docs;
  const cur = open && docs.find(d => d.id === open);
  return html`<div className="stack">
    <div className="tabs" role="tablist">${[['todo', 'Waiting for you', todo.length], ['done', 'Completed', done.length], ['all', 'All', docs.length]].map(([k, v, n]) => html`<button type="button" key=${k} role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${v}<span className=${'chip' + (k === 'todo' && n ? ' amber' : '')}>${n}</span></button>`)}</div>
    ${tab === 'todo' && waiting.length > 0 && html`<p className="muted small">${waiting.length} more ${waiting.length === 1 ? 'document is' : 'documents are'} waiting for someone else to sign first.</p>`}
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${list.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Document</th><th>From</th><th>Sent</th><th>Status</th><th /></tr></thead>
        <tbody>${list.map(d => html`<tr key=${d.id} className="click" tabIndex="0" onClick=${() => setOpen(d.id)}><td><b style=${{ fontWeight: 600 }}>${d.ti}</b><div className="muted small">${d.fn}</div></td><td>${d.byn}</td><td className="num">${fmtDay(d.at)}${d.due ? html`<div className="muted small">Due ${fmtDate(d.due)}</div>` : ''}</td>
          <td><${Chip} s=${sigChip(d.st)}>${myTurn(d, P.uid) ? 'Your signature needed' : SIG_ST[d.st]}<//></td><td className="r"><button className=${'btn sm' + (myTurn(d, P.uid) ? ' go' : ' ghost')}>${myTurn(d, P.uid) ? 'Review and sign' : 'Open'}</button></td></tr>`)}</tbody></table></div>`
        : html`<${Empty} title=${tab === 'todo' ? 'Nothing to sign right now' : 'No documents yet'}>Documents StratEdge sends you for signature appear here, and you also get an email with a link.<//>`}
    </section>
    ${cur && html`<${SignModal} key=${cur.id + cur.st + cur.cur} d=${cur} onClose=${() => setOpen(null)} />`}
  </div>`;
}

/* ---- Admin / HR manager ---- */
function NewSigRequest({ onClose }) {
  const P = usePortal(); const A = P.admin; const toast = useToast();
  const [f, setF] = useState({ ti: '', msg: '', due: '', counter: false }); const [rows, setRows] = useState([{ kind: 'member', uid: '', n: '', e: '' }]);
  const [file, setFile] = useState(null); const [busy, setBusy] = useState(false); const [prog, setProg] = useState(0);
  const up = k => e => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const setRow = (i, patch) => setRows(rows.map((r, j) => j === i ? { ...r, ...patch } : r));
  const people = A.members.filter(m => m.st !== 'inactive');
  const send = async () => {
    const signers = rows.map(r => r.kind === 'member' ? (r.uid ? { uid: r.uid } : null) : (r.n.trim() && /^\S+@\S+\.\S+$/.test(r.e) ? { n: r.n.trim(), e: r.e.trim() } : null));
    if (!f.ti.trim() || signers.some(s => !s)) { toast('Add a title and complete every signer (a portal member, or a name and email).', true); return; }
    if (!file) { toast('Attach the document (PDF, PNG or JPG).', true); return; }
    setBusy(true);
    try { const fd = new FormData(); fd.append('ti', f.ti.trim()); fd.append('msg', f.msg.trim()); fd.append('due', f.due); fd.append('signers', JSON.stringify(signers)); fd.append('counter', f.counter ? '1' : '0'); fd.append('file', file, file.name);
      await upload('sig_create', fd, setProg); Sync.kick(); toast('Sent. Each signer gets an email with their signing link.'); onClose(); }
    catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  return html`<${Modal} title="Send a document for signature" onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Cancel</button><button type="button" className="btn" disabled=${busy} onClick=${send}>${busy ? 'Sending…' : 'Send for signature'}</button>`}>
    <div className="form">
      <${Field} label="Title"><input value=${f.ti} onInput=${up('ti')} placeholder="e.g. Consulting agreement, NDA, Offer letter, Vendor MSA" /><//>
      <div><div className="ph-row" style=${{ marginBottom: 6 }}><span className="lbl">Signers, in signing order</span><button type="button" className="btn link small" onClick=${() => setRows([...rows, { kind: 'email', uid: '', n: '', e: '' }])}>Add another signer</button></div>
        <div className="stack" style=${{ gap: 8 }}>${rows.map((r, i) => html`<div key=${i} className="signer-row">
          <select value=${r.kind} onChange=${e => setRow(i, { kind: e.target.value })} aria-label="Signer type"><option value="member">Portal member</option><option value="email">By email (no account)</option></select>
          ${r.kind === 'member' ? html`<select value=${r.uid} onChange=${e => setRow(i, { uid: e.target.value })} aria-label="Choose a person"><option value="">Choose a person…</option>${people.map(m => html`<option key=${m.id} value=${m.id}>${m.u.p.n}${m.role === 'employer' ? ' (client contact' + (m.r && m.r.cl ? ', ' + m.r.cl : '') + ')' : m.r && m.r.cl ? ' (' + m.r.cl + ')' : ''}</option>`)}</select>`
            : html`<input value=${r.n} onInput=${e => setRow(i, { n: e.target.value })} placeholder="Full name" aria-label="Signer name" /><input type="email" value=${r.e} onInput=${e => setRow(i, { e: e.target.value })} placeholder="email@company.com" aria-label="Signer email" />`}
          ${rows.length > 1 && html`<button type="button" className="btn ghost icon" aria-label="Remove signer" onClick=${() => setRows(rows.filter((_, j) => j !== i))}><${Icon} n="trash" /></button>`}</div>`)}</div></div>
      <label className="check"><input type="checkbox" checked=${f.counter} onChange=${up('counter')} /><span>I countersign after them (adds your signature last)</span></label>
      <div className="row2"><${Field} label="Due date (optional)"><input type="date" value=${f.due} onInput=${up('due')} /><//></div>
      <${Field} label="Message to the signers"><textarea value=${f.msg} onInput=${up('msg')} placeholder="What this is and anything they should check before signing. Included in the email." /><//>
      <div><span className="lbl">Document</span>${file ? html`<ul className="files" style=${{ marginTop: 8 }}><li><${Icon} n="file" /><div className="fn"><b>${file.name}</b><span>${sizeLabel(file.size)}</span></div><button type="button" className="btn ghost sm" onClick=${() => setFile(null)}>Remove</button></li></ul>`
        : html`<div style=${{ marginTop: 8 }}><${FilePick} busy=${busy} progress=${prog} onFiles=${fs => setFile(fs[0])} label="Attach the document to sign." hint="PDF works best; PNG or JPG also work. Save Word files as PDF first." /></div>`}</div>
      <p className="muted small">Every signer receives an email with a secure link. Email signers don\u2019t need an account. When everyone has signed, the final PDF is emailed to all parties and kept here.</p>
    </div><//>`;
}
function SigDetail({ d, onClose }) {
  const P = usePortal(); const toast = useToast();
  const base = `sig/${d.id}`; const [sign, setSign] = useState(false);
  const cancel = async () => { try { await api('sig_cancel', { id: d.id }); Sync.kick(); toast('Request cancelled.'); onClose(); } catch (e) { toast(errText(e), true); } };
  const remind = async () => { try { const r = await api('sig_remind', { id: d.id }); Sync.kick(); toast(r.mailed ? 'Reminder emailed.' : 'Reminder could not be emailed. Check the mail settings in api/config.php.', !r.mailed); } catch (e) { toast(errText(e), true); } };
  const copy = async s => { const link = location.origin + location.pathname + '#/sign/' + d.id + '/' + s.tok; try { await navigator.clipboard.writeText(link); toast('Signing link copied.'); } catch (e) { prompt('Copy this signing link', link); } };
  return html`<${Modal} wide title=${d.ti} onClose=${onClose} foot=${html`${d.st === 'sent' && html`<button type="button" className="btn ghost" onClick=${remind}>Resend email</button><button type="button" className="btn ghost" onClick=${cancel}>Cancel request</button>`}${myTurn(d, P.uid) && html`<button type="button" className="btn go" onClick=${() => setSign(true)}>Sign now</button>`}<button type="button" className="btn" onClick=${onClose}>Close</button>`}>
    <div className="stack">
      <div className="actions"><${Chip} s=${sigChip(d.st)}>${SIG_ST[d.st]}<//><span className="muted small">Sent by ${d.byn} ${fmtDay(d.at)}${d.due ? ', due ' + fmtDate(d.due) : ''}${d.done ? ', completed ' + fmtDay(d.done) : ''}</span></div>
      <div className="tblwrap"><table className="tbl"><thead><tr><th>Signer</th><th>How</th><th>Status</th><th>Signed</th><th>Network address</th><th /></tr></thead>
        <tbody>${(d.signers || []).map((s, i) => html`<tr key=${i}><td><b style=${{ fontWeight: 600 }}>${s.n}</b><div className="muted small">${s.e}</div></td><td>${s.ext ? 'Email link' : s.role === 'countersign' ? 'Countersign' : 'Portal'}</td>
          <td><${Chip} s=${s.st === 'signed' ? 'ok' : s.st === 'declined' ? 'red' : d.st === 'sent' && i === (d.cur || 0) ? 'amber' : ''}>${s.st === 'signed' ? 'Signed' : s.st === 'declined' ? 'Declined' : d.st === 'sent' && i === (d.cur || 0) ? 'Waiting' : 'Queued'}<//>${s.typed ? html`<div className="muted small">as "${s.typed}"</div>` : ''}${s.reason ? html`<div className="muted small">${s.reason}</div>` : ''}</td>
          <td className="num">${s.at ? fmtTs(s.at) : '—'}</td><td className="small muted">${s.ip || '—'}</td><td className="r">${s.tok && s.st !== 'signed' && d.st === 'sent' && html`<button type="button" className="btn ghost sm" onClick=${() => copy(s)}>Copy link</button>`}</td></tr>`)}</tbody></table></div>
      <div className="actions"><a className="btn ghost sm" href=${fileUrl(base, d.fid, true)}><${Icon} n="down" />Original (${d.fn})</a>${d.sfid && html`<a className="btn sm" href=${fileUrl(base, d.sfid, true)}><${Icon} n="down" />Signed copy</a>`}</div>
      ${d.fh && html`<p className="muted small">Original SHA-256: <span className="num" style=${{ wordBreak: 'break-all' }}>${d.fh}</span></p>`}
      <div><h3 className="ph" style=${{ marginBottom: 8 }}>Audit log</h3><ul className="list">${(d.log || []).slice().reverse().map((l, i) => html`<li key=${i}><div><div className="t">${l.ev}</div><div className="m">${l.who}${l.ip ? ', ' + l.ip : ''}</div></div><span className="muted small num">${fmtTs(l.t)}</span></li>`)}</ul></div>
    </div>
    ${sign && html`<${SignModal} d=${d} onClose=${() => { setSign(false); onClose(); }} />`}<//>`;
}
function ESignAdmin() {
  const P = usePortal();
  const docs = (P.sigs || []).slice().sort((a, b) => (b.at || 0) - (a.at || 0));
  const [tab, setTab] = useState('open'); const [nw, setNw] = useState(false); const [open, setOpen] = useState(null); const [q, setQ] = useState('');
  const ql = q.trim().toLowerCase();
  const list = docs.filter(d => (tab === 'all' || (tab === 'open' ? d.st === 'sent' : d.st === tab)) && (!ql || [d.ti, d.fn, d.byn, ...(d.signers || []).map(s => s.n + ' ' + s.e)].join(' ').toLowerCase().includes(ql)));
  const counts = { open: docs.filter(d => d.st === 'sent').length, completed: docs.filter(d => d.st === 'completed').length, declined: docs.filter(d => d.st === 'declined').length };
  const cur = open && docs.find(d => d.id === open);
  const mineTurn = docs.filter(d => myTurn(d, P.uid));
  return html`<div className="stack">
    ${mineTurn.length > 0 && html`<div className="note amber"><span><b>${mineTurn.length} document${mineTurn.length === 1 ? '' : 's'} need your countersignature.</b></span><div className="actions"><button type="button" className="btn sm" onClick=${() => setOpen(mineTurn[0].id)}>Open</button></div></div>`}
    <div className="toolbar"><div className="tabs" role="tablist" style=${{ marginBottom: 0, border: 0 }}>${[['open', 'Awaiting', counts.open], ['completed', 'Completed', counts.completed], ['declined', 'Declined', counts.declined], ['all', 'All', null]].map(([k, v, n]) => html`<button type="button" key=${k} role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${v}${n != null && html`<span className=${'chip' + (k === 'open' && n ? ' amber' : '')}>${n}</span>`}</button>`)}</div>
      <input type="search" style=${{ maxWidth: 240 }} placeholder="Search" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Search requests" />
      <div className="push"><button type="button" className="btn" onClick=${() => setNw(true)}><${Icon} n="send" />Send for signature</button></div></div>
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${list.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Document</th><th>Signers</th><th>Sent</th><th>Status</th><th /></tr></thead>
        <tbody>${list.map(d => html`<tr key=${d.id} className="click" tabIndex="0" onClick=${() => setOpen(d.id)}><td><b style=${{ fontWeight: 600 }}>${d.ti}</b><div className="muted small">${d.fn}</div></td>
          <td>${(d.signers || []).map((s, i) => html`<div key=${i} className="small">${s.n} <span className="muted">${s.st === 'signed' ? '(signed)' : s.st === 'declined' ? '(declined)' : s.ext ? '(email)' : ''}</span></div>`)}</td><td className="num">${fmtDay(d.at)}<div className="muted small">by ${d.byn}</div></td>
          <td><${Chip} s=${sigChip(d.st)}>${SIG_ST[d.st]}<//></td><td className="r">${d.sfid && d.st === 'completed' ? html`<a className="btn ghost sm" href=${fileUrl(`sig/${d.id}`, d.sfid, true)} onClick=${e => e.stopPropagation()}><${Icon} n="down" />Signed copy</a>` : html`<button className="btn ghost sm">Open</button>`}</td></tr>`)}</tbody></table></div>`
        : html`<${Empty} title=${tab === 'open' ? 'Nothing awaiting signature' : 'No requests here yet'} action=${html`<button type="button" className="btn" onClick=${() => setNw(true)}>Send a document for signature</button>`}>Send offer letters, agreements, NDAs, vendor MSAs or client paperwork to anyone by email. They sign on a secure link, and the signed copy with its audit trail comes back here.<//>`}
    </section>
    ${nw && html`<${NewSigRequest} onClose=${() => setNw(false)} />`}
    ${cur && html`<${SigDetail} key=${cur.id + cur.st + cur.cur} d=${cur} onClose=${() => setOpen(null)} />`}
  </div>`;
}
