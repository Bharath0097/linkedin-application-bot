/* ================= E-signatures =================
   v45.3 Team e-signature: anyone given the "E-signatures" feature (or the whole team, as HR decides) uploads internal
   documents into the shared library, sends them for signature (one after the other or in any order, only me, or to many
   people at once with a tracker), places the fields each signer fills on the pages, and chooses how the emails go out
   (the company address or their own mailbox, subject, message, a copy attached, the signed copy to more addresses,
   reminders, expiry). Signers see their fields on the pages and fill them in; the signed PDF carries every value and a
   certificate per signer. Server: api/esign.php (es_) and the sig_ routes in api/index.php. */
const SIG_ST = {
  sent: 'Awaiting signature',
  completed: 'Completed',
  declined: 'Declined',
  cancelled: 'Cancelled',
  expired: 'Expired',
};
const sigChip = s => (s === 'completed' ? 'ok' : s === 'declined' ? 'red' : s === 'cancelled' || s === 'expired' ? '' : 'amber');
let _pdfLib = null;
function loadPdfLib() {
  if (window.PDFLib) return Promise.resolve(window.PDFLib);
  if (_pdfLib) return _pdfLib;
  _pdfLib = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'js/vendor/pdf-lib.min.js';
    s.onload = () => res(window.PDFLib);
    s.onerror = () => {
      _pdfLib = null;
      rej({ message: 'The PDF library could not be loaded. Check your connection and try again.' });
    };
    document.head.appendChild(s);
  });
  return _pdfLib;
}
const ascii = s =>
  String(s || '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/–|—/g, '-')
    .replace(/₹/g, 'INR ')
    .replace(/[^\x20-\x7E]/g, '');
// the signers a request waits for: the one whose turn it is, or (in any order) everyone who has not signed
const sigWaiting = d => (d.st !== 'sent' ? [] : (d.signers || []).map((s, i) => i).filter(i => d.signers[i].st === 'pending' && (d.order === 'any' || i === (d.cur || 0))));
const myTurn = (d, uid) => sigWaiting(d).some(i => d.signers[i].uid === uid);
const pendingSigs = (docs, uid) => (docs || []).filter(d => myTurn(d, uid));
const ES_KIND_N = { sig: 'Signature', ini: 'Initials', date: 'Date signed', name: 'Full name', text: 'Text', check: 'Checkbox' };
// each signer's color on the pages (field boxes and the list of signers)
const ES_TONES = ['#2b6cb0', '#c05621', '#2f855a', '#6b46c1', '#b83280', '#2c7a7b', '#975a16', '#4a5568', '#9b2c2c', '#3c366b'];
const esTone = i => ES_TONES[i % ES_TONES.length];
const esToday = () => new Date().toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
const esInitials = n =>
  String(n || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w[0].toUpperCase())
    .join('')
    .slice(0, 4);

function SignaturePad({ onChange }) {
  const cv = useRef(null);
  const drawing = useRef(false);
  const inked = useRef(false);
  useEffect(() => {
    const c = cv.current;
    const r = window.devicePixelRatio || 1;
    c.width = c.clientWidth * r;
    c.height = c.clientHeight * r;
    const x = c.getContext('2d');
    x.scale(r, r);
    x.lineWidth = 2.4;
    x.lineCap = 'round';
    x.lineJoin = 'round';
    x.strokeStyle = '#13205a';
  }, []);
  const pos = e => {
    const r = cv.current.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const down = e => {
    e.preventDefault();
    drawing.current = true;
    const x = cv.current.getContext('2d');
    const [px, py] = pos(e);
    x.beginPath();
    x.moveTo(px, py);
    try {
      cv.current.setPointerCapture(e.pointerId);
    } catch (err) {
      /* pointer capture unavailable */
    }
  };
  const move = e => {
    if (!drawing.current) return;
    const x = cv.current.getContext('2d');
    const [px, py] = pos(e);
    x.lineTo(px, py);
    x.stroke();
    inked.current = true;
    onChange(cv.current.toDataURL('image/png'));
  };
  const up = () => {
    if (drawing.current && inked.current) onChange(cv.current.toDataURL('image/png'));
    drawing.current = false;
  };
  const clear = () => {
    const c = cv.current;
    const x = c.getContext('2d');
    x.clearRect(0, 0, c.width, c.height);
    inked.current = false;
    onChange('');
  };
  return html`<div className="sigpad">
      <canvas ref=${cv} onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerLeave=${up} aria-label="Draw your signature" />
      <div className="actions" style=${{ justifyContent: 'space-between' }}>
        <span className="muted small">Draw with your mouse or finger.</span>
        <button type="button" className="btn ghost sm" onClick=${clear}>Clear</button>
      </div>
    </div>`;
}
function typedSignaturePng(name, size) {
  const c = document.createElement('canvas');
  c.width = size === 'ini' ? 360 : 900;
  c.height = 260;
  const x = c.getContext('2d');
  x.font = 'italic 600 88px "Archivo", "Segoe Script", "Brush Script MT", cursive';
  x.fillStyle = '#13205a';
  x.textBaseline = 'middle';
  x.fillText(name, 30, 130);
  return c.toDataURL('image/png');
}
const b64ToBytes = dataUrl => {
  const bin = atob(dataUrl.split(',')[1]);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/* v45.3: a picture (PNG or JPG) as a one-page PDF, so fields can be placed on it like on any other document */
async function esPictureToPdf(file) {
  const { PDFDocument } = await loadPdfLib();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await PDFDocument.create();
  const img = /png$/i.test(file.type) || /\.png$/i.test(file.name) ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
  const k = Math.min(1, 540 / img.width, 700 / img.height);
  const page = pdf.addPage([612, 792]);
  page.drawImage(img, { x: (612 - img.width * k) / 2, y: 792 - 46 - img.height * k, width: img.width * k, height: img.height * k });
  const out = await pdf.save();
  return new File([out], file.name.replace(/\.[^.]+$/, '') + '.pdf', { type: 'application/pdf' });
}
/* v45.3: the pages of a PDF as pictures (PDF.js, self-hosted) with their shape, for placing and showing fields */
const esPageCache = new Map();
function esPages(url, bytesOrNull) {
  const key = url || '';
  if (key && esPageCache.has(key)) return esPageCache.get(key);
  const p = (async () => {
    const lib = await loadPdfJs();
    const data = bytesOrNull || new Uint8Array(await (await fetch(url, { credentials: 'same-origin' })).arrayBuffer());
    const doc = await lib.getDocument({ data, isEvalSupported: false }).promise;
    const out = [];
    for (let n = 1; n <= Math.min(doc.numPages, 60); n++) {
      const page = await doc.getPage(n);
      const vp1 = page.getViewport({ scale: 1 });
      const scale = Math.min(2, 900 / vp1.width);
      const vp = page.getViewport({ scale });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width);
      c.height = Math.round(vp.height);
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      out.push({ url: c.toDataURL('image/jpeg', 0.82), w: vp1.width, h: vp1.height });
    }
    return { pages: out, total: doc.numPages };
  })();
  if (key) {
    esPageCache.set(key, p);
    p.catch(() => esPageCache.delete(key));
  }
  return p;
}
function useEsPages(url, bytes) {
  const [st, setSt] = useState({ pages: null, err: null });
  useEffect(() => {
    if (!url && !bytes) return;
    let live = true;
    setSt({ pages: null, err: null });
    esPages(bytes ? '' : url, bytes)
      .then(r => live && setSt({ pages: r.pages, total: r.total, err: null }))
      .catch(e => live && setSt({ pages: null, err: e }));
    return () => {
      live = false;
    };
  }, [url, bytes]);
  return st;
}

/* The pages with their fields. Editing (the sender): click a page to put the chosen field there, drag a field to move it,
   drag its corner to size it. Signing: the signer's fields are shown with what will go in them. */
function EsPageView({ pages, fields, names, edit, onAdd, onChange, sel, setSel, show, only }) {
  const drag = useRef(null);
  const start = (e, f, mode) => {
    if (!edit) return;
    e.preventDefault();
    e.stopPropagation();
    setSel && setSel(f.id);
    const box = e.currentTarget.closest('.espage').getBoundingClientRect();
    drag.current = { id: f.id, mode, x0: e.clientX, y0: e.clientY, f0: { ...f }, bw: box.width, bh: box.height };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (x) {
      /* fine */
    }
  };
  const move = e => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x0) / d.bw;
    const dy = (e.clientY - d.y0) / d.bh;
    const f = d.f0;
    const nf =
      d.mode === 'move'
        ? { ...f, x: Math.max(0, Math.min(1 - f.w, f.x + dx)), y: Math.max(0, Math.min(1 - f.h, f.y + dy)) }
        : { ...f, w: Math.max(0.03, Math.min(1 - f.x, f.w + dx)), h: Math.max(0.015, Math.min(1 - f.y, f.h + dy)) };
    onChange && onChange(nf);
  };
  const end = () => {
    drag.current = null;
  };
  return html`<div className="espages">
      ${pages.map(
        (pg, p) => html`<div key=${p} className="espagewrap">
            <div className="esmuted small">Page ${p + 1}</div>
            <div className=${'espage' + (edit ? ' edit' : '')} style=${{ aspectRatio: pg.w + ' / ' + pg.h }} onPointerMove=${move} onPointerUp=${end} onPointerLeave=${end}
              onClick=${e => {
                if (!edit || !onAdd || e.target !== e.currentTarget.querySelector('img')) return;
                const r = e.currentTarget.getBoundingClientRect();
                onAdd(p, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
              }}>
              <img src=${pg.url} alt=${'Page ' + (p + 1)} draggable="false" />
              ${fields
                .filter(f => f.p === p && (only === undefined || f.s === only))
                .map(
                  f => html`<div key=${f.id} className=${'esfield k-' + f.k + (sel === f.id ? ' sel' : '')} style=${{ left: f.x * 100 + '%', top: f.y * 100 + '%', width: f.w * 100 + '%', height: f.h * 100 + '%', borderColor: esTone(f.s), background: esTone(f.s) + '1f' }}
                    onPointerDown=${e => start(e, f, 'move')} title=${ES_KIND_N[f.k] + (names && names[f.s] ? ' · ' + names[f.s] : '')}>
                    ${show && show(f) ? show(f) : html`<span className="eslbl" style=${{ color: esTone(f.s) }}>${f.lbl || ES_KIND_N[f.k]}${!edit && f.req && (f.k === 'text' || f.k === 'check') ? ' *' : ''}</span>`}
                    ${edit && html`<i className="esgrip" onPointerDown=${e => start(e, f, 'size')} aria-hidden="true" />`}
                  </div>`
                )}
            </div>
          </div>`
      )}
    </div>`;
}

/* The signed copy: every page stamped (who signed it, when, the request), each of this signer's fields filled in on its
   page, and a certificate page for this signer at the end. */
async function buildSignedPdf(src, mime, info) {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  let pdf;
  if (mime === 'application/pdf') pdf = await PDFDocument.load(src, { ignoreEncryption: true, updateMetadata: false });
  else {
    pdf = await PDFDocument.create();
    const img = mime === 'image/png' ? await pdf.embedPng(src) : await pdf.embedJpg(src);
    const k = Math.min(1, 540 / img.width, 700 / img.height);
    const page = pdf.addPage([612, 792]);
    page.drawImage(img, {
      x: (612 - img.width * k) / 2,
      y: 792 - 46 - img.height * k,
      width: img.width * k,
      height: img.height * k,
    });
  }
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  // v45.3: the fields this signer fills, at the places the sender put them (fractions of each page's visible box)
  const pages = pdf.getPages();
  const imgCache = {};
  const imgOf = async key => {
    if (!imgCache[key]) imgCache[key] = await pdf.embedPng(b64ToBytes(key === 'ini' ? info.iniPng : info.sigPng));
    return imgCache[key];
  };
  for (const f of info.fields || []) {
    const page = pages[f.p];
    if (!page) continue;
    const box = page.getCropBox ? page.getCropBox() : { x: 0, y: 0, ...page.getSize() };
    const bx = box.x + f.x * box.width;
    const bw = f.w * box.width;
    const bh = f.h * box.height;
    const by = box.y + box.height - (f.y + f.h) * box.height;
    if (f.k === 'sig' || f.k === 'ini') {
      const img = await imgOf(f.k === 'ini' ? 'ini' : 'sig');
      const sc = Math.min(bw / img.width, bh / img.height);
      page.drawImage(img, { x: bx, y: by + (bh - img.height * sc) / 2, width: img.width * sc, height: img.height * sc });
    } else if (f.k === 'check') {
      if (info.vals && info.vals[f.id]) {
        const s = Math.min(bw, bh);
        page.drawLine({ start: { x: bx + s * 0.15, y: by + bh / 2 }, end: { x: bx + s * 0.4, y: by + bh / 2 - s * 0.3 }, thickness: Math.max(1, s * 0.1), color: rgb(0.07, 0.13, 0.35) });
        page.drawLine({ start: { x: bx + s * 0.4, y: by + bh / 2 - s * 0.3 }, end: { x: bx + s * 0.85, y: by + bh / 2 + s * 0.32 }, thickness: Math.max(1, s * 0.1), color: rgb(0.07, 0.13, 0.35) });
      }
    } else {
      const t = ascii(f.k === 'date' ? info.dateStr : f.k === 'name' ? info.name : (info.vals && info.vals[f.id]) || '');
      if (!t) continue;
      let size = Math.max(5, Math.min(14, bh * 0.62));
      while (size > 5 && font.widthOfTextAtSize(t, size) > bw - 4) size -= 0.5;
      page.drawText(t, { x: bx + 2, y: by + (bh - size) / 2 + size * 0.18, size, font, color: rgb(0.07, 0.13, 0.35) });
    }
  }
  const stamp = ascii(wsBrandStr(`Electronically signed by ${info.name} on ${info.when}. StratEdge e-sign ${info.id}.`));
  pages.forEach(p => {
    const { width } = p.getSize();
    p.drawText(stamp, { x: 30, y: 14 + 9 * (info.n || 0), size: 7.5, font, color: rgb(0.35, 0.35, 0.35), maxWidth: width - 60 });
  });
  const page = pdf.addPage([612, 792]);
  let y = 736;
  const line = (t, size, f, color) => {
    const words = ascii(t).split(' ');
    let cur = '';
    const fl = [];
    words.forEach(w => {
      const test = cur ? cur + ' ' + w : w;
      if ((f || font).widthOfTextAtSize(test, size) > 500 && cur) {
        fl.push(cur);
        cur = w;
      } else cur = test;
    });
    if (cur) fl.push(cur);
    fl.forEach(l => {
      page.drawText(l, { x: 56, y, size, font: f || font, color: color || rgb(0.08, 0.1, 0.2) });
      y -= size * 1.45;
    });
  };
  line('Electronic signature certificate', 20, bold);
  y -= 10;
  line(`Document: ${info.title}`, 11);
  line(`File: ${info.file}`, 10, font, rgb(0.35, 0.35, 0.35));
  y -= 6;
  line(`Signed by: ${info.name} (${info.email})`, 11);
  line(`Signed on: ${info.when}`, 11);
  line(`Request ID: ${info.id}`, 11);
  if (info.hash) line(`Original document SHA-256: ${info.hash}`, 8.5, font, rgb(0.35, 0.35, 0.35));
  const filled = (info.fields || []).filter(f => f.k === 'text' || f.k === 'check');
  if (filled.length) {
    y -= 4;
    line('Filled in by this signer:', 10, bold);
    filled.forEach(f => line(`${f.lbl || ES_KIND_N[f.k]} (page ${f.p + 1}): ${f.k === 'check' ? (info.vals && info.vals[f.id] ? 'ticked' : 'not ticked') : (info.vals && info.vals[f.id]) || '-'}`, 9.5));
  }
  y -= 8;
  line(
    wsBrandStr('The signer confirmed that they reviewed the document and agreed to sign it electronically, and that this electronic signature has the same effect as a handwritten signature. Signing details, including the time and network address, are kept in the StratEdge portal audit log.'),
    9.5,
    font,
    rgb(0.3, 0.3, 0.3)
  );
  y -= 16;
  if (info.sigPng) {
    const img = await pdf.embedPng(b64ToBytes(info.sigPng));
    const w = 230,
      h = (w * img.height) / img.width;
    page.drawImage(img, { x: 56, y: y - h, width: w, height: h });
    y -= h + 6;
  }
  page.drawLine({ start: { x: 56, y }, end: { x: 316, y }, thickness: 1, color: rgb(0.2, 0.2, 0.3) });
  y -= 16;
  line(info.name, 11, bold);
  line('Signature', 9, font, rgb(0.4, 0.4, 0.4));
  return await pdf.save();
}

/* The signing panel itself, shared by portal members and email signers. me: this signer's place in the list. reload:
   fetches the request again (another signer may have signed in the meantime). */
function SignPanel({ d, mine, signer, tok, me, onDone, reload }) {
  const toast = useToast();
  const base = `sig/${d.id}`;
  const [mode, setMode] = useState('draw');
  const [png, setPng] = useState('');
  const [typed, setTyped] = useState(signer.n || '');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState('');
  const [decl, setDecl] = useState(null);
  const [done, setDone] = useState(null);
  const [vals, setVals] = useState({});
  const myFields = (d.fields || []).filter(f => f.s === me);
  const latest = d.sfid || d.fid;
  const pdfLike = d.sfid || d.fty === 'application/pdf';
  const pv = useEsPages(mine && myFields.length && pdfLike ? fileUrl(base, latest, false, tok) : null);
  useEffect(() => {
    if (mine) api('sig_viewed', { id: d.id, tok: tok || undefined }).catch(() => {});
  }, [d.id]);
  const sigImg = () => (mode === 'draw' ? png : typed.trim() ? typedSignaturePng(typed.trim()) : '');
  const sign = async (again) => {
    if (!consent) {
      toast('Please confirm you agree to sign electronically.', true);
      return;
    }
    if (mode === 'draw' && !png) {
      toast('Draw your signature first.', true);
      return;
    }
    if (!typed.trim()) {
      toast('Type your full name.', true);
      return;
    }
    const missing = myFields.find(f => f.req && ((f.k === 'text' && !String(vals[f.id] || '').trim()) || (f.k === 'check' && !vals[f.id])));
    if (missing) {
      toast('Fill in every required field' + (missing.lbl ? ' (' + missing.lbl + ')' : '') + '.', true);
      return;
    }
    setBusy('sign');
    try {
      const cur = again || d;
      const onCopy = cur.sfid || cur.fid;
      const res = await fetch(fileUrl(base, onCopy, false, tok), { credentials: 'same-origin' });
      if (!res.ok) throw { message: 'The document could not be loaded.' };
      const bytes = new Uint8Array(await res.arrayBuffer());
      const when = new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) + ' (' + Intl.DateTimeFormat().resolvedOptions().timeZone + ')';
      const out = await buildSignedPdf(bytes, cur.sfid ? 'application/pdf' : cur.fty, {
        name: typed.trim(),
        email: signer.e || '',
        when,
        id: d.id,
        title: d.ti,
        file: d.fn,
        hash: d.fh,
        sigPng: sigImg(),
        iniPng: typedSignaturePng(esInitials(typed), 'ini'),
        dateStr: esToday(),
        fields: myFields,
        vals,
        n: (cur.signers || []).filter(s => s.st === 'signed').length,
      });
      const fd = new FormData();
      fd.append('id', d.id);
      if (tok) fd.append('tok', tok);
      fd.append('name', typed.trim());
      fd.append('consent', '1');
      fd.append('base', onCopy);
      fd.append('vals', JSON.stringify(vals));
      fd.append('file', new Blob([out], { type: 'application/pdf' }), (d.fn || 'document').replace(/\.[^.]+$/, '') + '-signed.pdf');
      const r = await upload('sig_sign', fd);
      Sync.kick();
      setDone(r.st);
      toast(r.st === 'completed' ? 'Signed. A copy has been emailed to everyone.' : 'Signed. The next signer has been notified.');
      onDone && onDone(r.st);
    } catch (e) {
      // v45.3: in any order, someone may have signed a moment ago: sign again on the newest copy (once)
      if (e && e.code === 'conflict' && reload && !again) {
        try {
          const fresh = await reload();
          setBusy('');
          return sign(fresh);
        } catch (x) {
          /* fall through to the message */
        }
      }
      toast(errText(e), true);
    }
    setBusy('');
  };
  const decline = async () => {
    setBusy('decline');
    try {
      await api('sig_decline', { id: d.id, tok: tok || undefined, reason: decl || '' });
      Sync.kick();
      setDone('declined');
      toast('Declined. The sender has been notified.');
      onDone && onDone('declined');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const isPdf = d.fty === 'application/pdf';
  if (done)
    return html`<div className=${'note ' + (done === 'declined' ? 'red' : 'ok')}>
        <span>
          <b>${done === 'declined' ? 'You declined to sign.' : done === 'completed' ? 'All signatures collected.' : 'Thank you, your signature has been recorded.'}</b> ${done === 'completed' ? 'The signed copy has been emailed to everyone.' : done === 'declined' ? 'The sender has been told.' : 'You’ll receive the final signed copy by email once everyone has signed.'}
        </span>
      </div>`;
  const expired = d.exp && d.exp < Date.now() && d.st === 'sent';
  const fieldShow = f =>
    f.k === 'sig' && sigImg()
      ? html`<img className="esval" src=${sigImg()} alt="Your signature" />`
      : f.k === 'ini' && typed.trim()
        ? html`<span className="esval t">${esInitials(typed)}</span>`
        : f.k === 'date'
          ? html`<span className="esval t">${esToday()}</span>`
          : f.k === 'name' && typed.trim()
            ? html`<span className="esval t">${typed.trim()}</span>`
            : f.k === 'text' && vals[f.id]
              ? html`<span className="esval t">${vals[f.id]}</span>`
              : f.k === 'check' && vals[f.id]
                ? html`<span className="esval t">✓</span>`
                : null;
  return html`<div className="stack">
      <div className="actions">
        <${Chip} s=${sigChip(expired ? 'expired' : d.st)}>${SIG_ST[expired ? 'expired' : d.st] || d.st}<//>
        <span className="muted small">From ${d.byn}, ${fmtDay(d.at)}${d.due ? '. Due ' + fmtDate(d.due, { month: 'short', day: 'numeric', year: 'numeric' }) : ''}${d.exp ? '. Open until ' + fmtDay(d.exp) : ''}${d.order === 'any' ? '. Signers may sign in any order' : ''}</span>
      </div>
      ${d.msg && html`<div className="note info"><span style=${{ whiteSpace: 'pre-wrap' }}>${d.msg}</span></div>`}
      ${
        mine && myFields.length && pdfLike
          ? pv.pages
            ? html`<div className="esdoc"><${EsPageView} pages=${pv.pages} fields=${myFields} show=${fieldShow} only=${me} /></div>`
            : pv.err
              ? html`<div className="docview"><iframe src=${fileUrl(base, latest, false, tok)} title="Document to sign" /></div>`
              : html`<${Spinner} label="Opening the pages…" />`
          : html`<div className="docview">
              ${isPdf || d.sfid ? html`<iframe src=${fileUrl(base, latest, false, tok)} title="Document to sign" />` : html`<img src=${fileUrl(base, d.fid, false, tok)} alt="Document to sign" />`}
            </div>`
      }
      <p className="muted small">Can't see it? <a href=${fileUrl(base, latest, false, tok)} target="_blank" rel="noopener">Open the document in a new tab</a> or <a href=${fileUrl(base, latest, true, tok)}>download it</a>.${d.sfid && d.st === 'sent' ? ' This copy already carries the earlier signatures.' : ''}</p>
      ${
        expired
          ? html`<div className="note"><span>This request has expired. Ask ${d.byn} to send it again.</span></div>`
          : mine
            ? html`<section className="panel stack" style=${{ gap: 12 }}>
                ${
                  myFields.length > 0 &&
                  html`<div className="stack" style=${{ gap: 8 }}>
                      <b>Your fields (${myFields.length})</b>
                      <p className="muted small" style=${{ margin: 0 }}>Your signature, initials, name and the date go in their places on the pages when you sign.${myFields.some(f => f.k === 'text' || f.k === 'check') ? ' Fill in the rest here:' : ''}</p>
                      ${myFields
                        .filter(f => f.k === 'text' || f.k === 'check')
                        .map(f =>
                          f.k === 'check'
                            ? html`<label key=${f.id} className="check"><input type="checkbox" checked=${!!vals[f.id]} onChange=${e => setVals({ ...vals, [f.id]: e.target.checked })} /><span>${f.lbl || 'Tick the box'} <span className="muted small">(page ${f.p + 1}${f.req ? ', required' : ''})</span></span></label>`
                            : html`<${Field} key=${f.id} label=${(f.lbl || 'Text') + ' (page ' + (f.p + 1) + (f.req ? ', required' : '') + ')'}><input value=${vals[f.id] || ''} maxLength="300" onInput=${e => setVals({ ...vals, [f.id]: e.target.value })} /><//>`
                        )}
                    </div>`
                }
                <div className="ph-row" style=${{ marginBottom: 0 }}>
                  <h2 className="ph">Your signature</h2>
                  <div className="seg" style=${{ marginBottom: 0 }}>
                    ${[
                      ['draw', 'Draw'],
                      ['type', 'Type'],
                    ].map(([k, v]) => html`<button key=${k} type="button" className=${mode === k ? 'on' : ''} onClick=${() => setMode(k)}>${v}</button>`)}
                  </div>
                </div>
                ${mode === 'draw' ? html`<${SignaturePad} onChange=${setPng} />` : html`<div className="sigtype">${typed || 'Your name'}</div>`}
                <${Field} label="Full legal name">
                  <input value=${typed} onInput=${e => setTyped(e.target.value)} />
                <//>
                <label className="check">
                  <input type="checkbox" checked=${consent} onChange=${e => setConsent(e.target.checked)} />
                  <span>I have reviewed this document and agree to sign it electronically. I understand this electronic signature is as binding as a handwritten one.</span>
                </label>
                <div className="actions">
                  <button className="btn go lg" disabled=${!!busy} onClick=${() => sign()}>${busy === 'sign' ? 'Signing…' : 'Sign document'}</button>
                  ${
                    decl === null
                      ? html`<button className="btn ghost" disabled=${!!busy} onClick=${() => setDecl('')}>Decline</button>`
                      : html`<input value=${decl} onInput=${e => setDecl(e.target.value)} placeholder="Reason (optional)" style=${{ maxWidth: 240 }} />
                          <button className="btn danger" disabled=${!!busy} onClick=${decline}>Confirm decline</button>`
                  }
                </div>
              </section>`
            : d.st === 'sent'
              ? html`<div className="note amber"><span>Waiting for ${sigWaiting(d).map(i => d.signers[i].n).join(', ') || 'another signer'} to sign first.</span></div>`
              : null
      }
      ${
        d.st === 'completed' &&
        d.sfid &&
        html`<div className="note ok">
            <span><b>Completed ${fmtDay(d.done)}.</b></span>
            <div className="actions"><a className="btn sm" href=${fileUrl(base, d.sfid, true, tok)}>Download signed copy</a></div>
          </div>`
      }
    </div>`;
}
function SignModal({ d, onClose }) {
  const P = usePortal();
  const me = (d.signers || []).findIndex((s, i) => s.uid === P.uid && (d.order === 'any' ? s.st === 'pending' : i === (d.cur || 0)));
  return html`<${Modal} wide title=${d.ti} onClose=${onClose} foot=${html`<button className="btn" onClick=${onClose}>Close</button>`}>
      <${SignPanel} d=${d} me=${me} mine=${myTurn(d, P.uid)} signer=${{ n: P.prof ? P.prof.n : (Cap.me && Cap.me.name) || '', e: (Cap.me && Cap.me.email) || '' }}
        reload=${async () => {
          const r = await dbGet('sig/' + d.id);
          return r ? { ...r, id: d.id } : d;
        }} />
    <//>`;
}
/* Public signing page for email signers (no account needed) */
function SignPublic({ id, tok }) {
  const [d, setD] = useState(undefined);
  const get = () =>
    api('sig_public_get&id=' + encodeURIComponent(id) + '&tok=' + encodeURIComponent(tok)).then(r => {
      setD(r.d);
      return r.d;
    });
  useEffect(() => {
    get().catch(() => setD(null));
  }, [id, tok]);
  const mine = d && d.st === 'sent' && d.signers[d.me] && d.signers[d.me].st === 'pending' && (d.order === 'any' || d.me === (d.cur || 0));
  return html`<${Fragment}>
      <${PageHead} title=${d ? d.ti : 'Sign document'} intro=${d ? `Sent by ${d.byn} at StratEdge IT Consulting. Review the document below and sign it on screen; no account is needed.` : ''} />
      <section className="sec" style=${{ paddingTop: 48 }}>
        <div className="wrap" style=${{ maxWidth: 960 }}>
          ${
            d === undefined
              ? html`<${Spinner} label="Loading your document…" />`
              : d === null
                ? html`<div className="panel"><${Empty} title="This signing link isn’t valid">It may have been cancelled or already used. Contact ${CO.email} if you still need to sign.<//></div>`
                : html`<${SignPanel} d=${d} me=${d.me} mine=${mine} signer=${d.signers[d.me] || {}} tok=${tok} reload=${get} onDone=${st => setD({ ...d, st, cur: (d.cur || 0) + 1 })} />`
          }
        </div>
      </section>
    <//>`;
}
/* ---- Recipient view ---- */
function SignDocsPage() {
  const P = usePortal();
  const [open, setOpen] = useState(null);
  const [tab, setTab] = useState('todo');
  const docs = P.sigs || [];
  const todo = pendingSigs(docs, P.uid);
  const done = docs.filter(d => d.st !== 'sent');
  const waiting = docs.filter(d => d.st === 'sent' && !myTurn(d, P.uid));
  const list = tab === 'todo' ? todo : tab === 'done' ? done : docs;
  const cur = open && docs.find(d => d.id === open);
  return html`<div className="stack">
      <div className="tabs" role="tablist">
        ${[
          ['todo', 'Waiting for you', todo.length],
          ['done', 'Completed', done.length],
          ['all', 'All', docs.length],
        ].map(
          ([k, v, n]) =>
            html`<button key=${k} role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>
                ${v}
                <span className=${'chip' + (k === 'todo' && n ? ' amber' : '')}>
                  ${n}
                </span>
              </button>`
        )}
      </div>
      ${
        tab === 'todo' &&
        waiting.length > 0 &&
        html`<p className="muted small">
            ${waiting.length} more ${waiting.length === 1 ? 'document is' : 'documents are'} waiting for someone else to sign first.</p>`
      }
      <section className="panel" style=${{ padding: '6px 8px' }}>
        ${
          list.length
            ? html`<div className="tblwrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Document</th>
                      <th>From</th>
                      <th>Sent</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    ${list.map(
                      d => html`<tr key=${d.id} className="click" tabIndex="0" onClick=${() => setOpen(d.id)}>
                          <td>
                            <b style=${{ fontWeight: 600 }}>
                              ${d.ti}
                            </b>
                            <div className="muted small">
                              ${d.fn}
                            </div>
                          </td>
                          <td>
                            ${d.byn}
                          </td>
                          <td className="num">
                            ${fmtDay(d.at)}${d.due ? html`<div className="muted small">Due ${fmtDate(d.due)}</div>` : ''}
                          </td>
                          <td>
                            <${Chip} s=${sigChip(d.st)}>
                              ${myTurn(d, P.uid) ? 'Your signature needed' : SIG_ST[d.st]}
                            <//>
                          </td>
                          <td className="r">
                            <button className=${'btn sm' + (myTurn(d, P.uid) ? ' go' : ' ghost')}>
                              ${myTurn(d, P.uid) ? 'Review and sign' : 'Open'}
                            </button>
                          </td>
                        </tr>`
                    )}
                  </tbody>
                </table>
              </div>`
            : html`<${Empty} title=${tab === 'todo' ? 'Nothing to sign right now' : 'No documents yet'}>Documents StratEdge sends you for signature appear here, and you also get an email with a link.<//>`
        }
      </section>
      ${cur && html`<${SignModal} key=${cur.id + cur.st + cur.cur} d=${cur} onClose=${() => setOpen(null)} />`}
    </div>`;
}


/* ================= v45.3 Team e-signature: the page for senders ================= */
// what the page needs once: the person's rights, the settings, their mailbox, the labels
function useEsHome() {
  const [h, setH] = useState(null);
  const [err, setErr] = useState(null);
  const load = () =>
    api('es_home', {})
      .then(setH)
      .catch(setErr);
  useEffect(() => {
    load();
  }, []);
  return { h, err, load };
}
let esPeopleLoad = null;
const esPeopleList = () => {
  if (!esPeopleLoad)
    esPeopleLoad = api('es_people', {}).then(
      r => r.people || [],
      e => {
        esPeopleLoad = null;
        throw e;
      }
    );
  return esPeopleLoad;
};
function useEsPeople(on) {
  const [p, setP] = useState(null);
  useEffect(() => {
    if (!on) return;
    let live = true;
    esPeopleList().then(x => live && setP(x), () => live && setP([]));
    return () => {
      live = false;
    };
  }, [on]);
  return p;
}
const esWho = (d, P) => (d.by === P.uid ? 'You' : d.byn);

function ESignApp({ q }) {
  const P = usePortal();
  const { h, err, load } = useEsHome();
  const [tab, setTab] = useState((q && q.t) || 'todo');
  const [send, setSend] = useState(null);
  const [open, setOpen] = useState(null);
  if (err && !h) return html`<${LoadError} error=${err} onRetry=${load} />`;
  if (!h) return html`<${Spinner} />`;
  const caps = h.caps;
  const docs = (P.sigs || []).slice().sort((a, b) => (b.at || 0) - (a.at || 0));
  const todo = pendingSigs(docs, P.uid);
  const sent = docs.filter(d => d.by === P.uid || (caps.manage && tab === 'sent'));
  const tabs = [
    ['todo', 'To sign', todo.length || null],
    ...(caps.send ? [['sent', caps.manage ? 'Requests' : 'Sent by me', sent.filter(d => d.st === 'sent').length || null], ['lib', 'Library'], ['bulk', 'Sent to many']] : []),
    ...(caps.level === 'admin' ? [['set', 'Settings']] : []),
  ];
  const cur = open && docs.find(d => d.id === open);
  return html`<div className="stack espage-app">
      <div className="toolbar">
        <${KitTabs} tabs=${tabs} tab=${tab} onTab=${setTab} wrap />
        ${caps.send && html`<div className="push"><button className="btn" onClick=${() => setSend({})}><${Icon} n="send" />Send for signature</button></div>`}
      </div>
      ${tab === 'todo' && html`<${EsList} docs=${todo} P=${P} empty="Nothing waits for your signature." onOpen=${setOpen} />`}
      ${tab === 'sent' && html`<${EsSent} docs=${sent} P=${P} caps=${caps} onOpen=${setOpen} />`}
      ${tab === 'lib' && html`<${EsLibrary} h=${h} onSend=${(lib, bulk) => setSend({ lib, bulk })} />`}
      ${tab === 'bulk' && html`<${EsBatches} />`}
      ${tab === 'set' && html`<${EsSettings} h=${h} onSaved=${load} />`}
      ${send && html`<${EsSend} h=${h} lib=${send.lib} bulk=${send.bulk} onClose=${() => setSend(null)} onSent=${t => (setSend(null), setTab(t || 'sent'))} />`}
      ${cur && html`<${SigDetail} key=${cur.id + cur.st + cur.cur} d=${cur} h=${h} onClose=${() => setOpen(null)} />`}
    </div>`;
}
// earlier versions' name for this page (shell.js PAGES.esign)
const ESignAdmin = ESignApp;

function EsList({ docs, P, empty, onOpen }) {
  if (!docs.length) return html`<section className="panel"><${Empty} title=${empty} /></section>`;
  return html`<section className="panel" style=${{ padding: '6px 8px' }}>
      <div className="tblwrap">
        <table className="tbl">
          <thead><tr><th>Document</th><th>From</th><th>Signers</th><th>Status</th><th /></tr></thead>
          <tbody>
            ${docs.map(
              d => html`<tr key=${d.id} className="click" tabIndex="0" onClick=${() => onOpen(d.id)}>
                  <td><b style=${{ fontWeight: 600 }}>${d.ti}</b><div className="muted small">${d.fn}${d.exp ? ' · open until ' + fmtDay(d.exp) : ''}</div></td>
                  <td>${esWho(d, P)}<div className="muted small">${fmtDay(d.at)}</div></td>
                  <td className="small">${(d.signers || []).map((s, i) => html`<div key=${i}><span className="esdot" style=${{ background: esTone(i) }} />${s.n} <span className="muted">${s.st === 'signed' ? '(signed)' : s.st === 'declined' ? '(declined)' : ''}</span></div>`)}</td>
                  <td><${Chip} s=${myTurn(d, P.uid) ? 'amber' : sigChip(d.st)}>${myTurn(d, P.uid) ? 'Your signature needed' : SIG_ST[d.st] || d.st}<//></td>
                  <td className="r"><button className=${'btn sm' + (myTurn(d, P.uid) ? ' go' : ' ghost')}>${myTurn(d, P.uid) ? 'Review and sign' : 'Open'}</button></td>
                </tr>`
            )}
          </tbody>
        </table>
      </div>
    </section>`;
}
function EsSent({ docs, P, caps, onOpen }) {
  const [st, setSt] = useState('sent');
  const [qq, setQq] = useState('');
  const [mine, setMine] = useState(!caps.manage);
  const ql = qq.trim().toLowerCase();
  const list = docs.filter(
    d =>
      (st === 'all' || d.st === st) &&
      (!mine || d.by === P.uid) &&
      (!ql || [d.ti, d.fn, d.byn, ...(d.signers || []).map(s => s.n + ' ' + s.e)].join(' ').toLowerCase().includes(ql))
  );
  const n = k => docs.filter(d => (k === 'all' || d.st === k) && (!mine || d.by === P.uid)).length;
  return html`<div className="stack">
      <div className="toolbar">
        <div className="seg" style=${{ marginBottom: 0 }}>
          ${[['sent', 'Waiting'], ['completed', 'Completed'], ['declined', 'Declined'], ['expired', 'Expired'], ['all', 'All']].map(([k, v]) => html`<button key=${k} type="button" className=${st === k ? 'on' : ''} onClick=${() => setSt(k)}>${v} <span className="muted">${n(k)}</span></button>`)}
        </div>
        ${caps.manage && html`<label className="check"><input type="checkbox" checked=${mine} onChange=${e => setMine(e.target.checked)} /><span>Only mine</span></label>`}
        <input type="search" style=${{ maxWidth: 220 }} placeholder="Find a document or person" value=${qq} onInput=${e => setQq(e.target.value)} aria-label="Find a request" />
      </div>
      ${list.length ? html`<${EsList} docs=${list} P=${P} onOpen=${onOpen} />` : html`<section className="panel"><${Empty} title="Nothing here">Requests you send show here with each signer's progress. The signed copy comes back here and to everyone by email.<//></section>`}
    </div>`;
}

/* ---- one request: progress, who signed and what they filled in, the emails, the log ---- */
function SigDetail({ d, h, onClose }) {
  const P = usePortal();
  const toast = useToast();
  const base = `sig/${d.id}`;
  const [sign, setSign] = useState(false);
  const [copy, setCopy] = useState(null);
  const run = d.by === P.uid || (h && h.caps.manage) || P.isAdmin;
  const call = async (route, body, msg) => {
    try {
      const r = await api(route, body);
      Sync.kick();
      msg && toast(typeof msg === 'function' ? msg(r) : msg);
      return r;
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const copyLink = async s => {
    const link = location.origin + location.pathname + '#/sign/' + d.id + '/' + s.tok;
    try {
      await navigator.clipboard.writeText(link);
      toast('Signing link copied.');
    } catch (e) {
      prompt('Copy this signing link', link);
    }
  };
  const mail = d.mail || {};
  const waiting = sigWaiting(d);
  return html`<${Modal} wide title=${d.ti} onClose=${onClose} foot=${html`${
    run &&
    d.st === 'sent' &&
    html`<button className="btn ghost" onClick=${() => call('sig_remind', { id: d.id }, r => (r.mailed ? 'Reminder emailed.' : 'The reminder could not be emailed. Check the mail settings.'))}>Remind now</button>
      <button className="btn ghost" onClick=${() => confirm('Cancel this request? Nobody can sign it afterwards.') && call('sig_cancel', { id: d.id }, 'Request cancelled.').then(r => r && onClose())}>Cancel request</button>`
  }${d.st === 'completed' && d.sfid && html`<button className="btn ghost" onClick=${() => setCopy({ to: '', note: '', from: 'co' })}><${Icon} n="send" />Email the signed copy</button>`}${myTurn(d, P.uid) && html`<button className="btn go" onClick=${() => setSign(true)}>Sign now</button>`}
    <button className="btn" onClick=${onClose}>Close</button>`}>
      <div className="stack">
        <div className="actions">
          <${Chip} s=${sigChip(d.st)}>${SIG_ST[d.st] || d.st}<//>
          <span className="muted small">Sent by ${d.byn} ${fmtDay(d.at)}${d.due ? ', due ' + fmtDate(d.due) : ''}${d.done ? ', completed ' + fmtDay(d.done) : ''}${d.exp ? ', open until ' + fmtDay(d.exp) : ''}</span>
        </div>
        <div className="esfacts small">
          <span><b>Order:</b> ${d.order === 'any' ? 'any order' : 'one after the other'}</span>
          <span><b>Emails:</b> ${mail.from === 'me' ? 'from ' + (d.bye || 'the sender') + '’s mailbox' : 'from the company address'}${mail.attach ? ', document attached' : ''}${d.remind ? ', reminders every ' + d.remind + ' day' + (d.remind === 1 ? '' : 's') : ''}</span>
          ${(mail.cc || []).length > 0 && html`<span><b>Signed copy also to:</b> ${mail.cc.join(', ')}</span>`}
          ${d.fields && d.fields.length > 0 && html`<span><b>Fields on the pages:</b> ${d.fields.length}</span>`}
          ${waiting.length > 0 && html`<span><b>Waiting for:</b> ${waiting.map(i => d.signers[i].n).join(', ')}</span>`}
        </div>
        <div className="tblwrap">
          <table className="tbl">
            <thead><tr><th>Signer</th><th>How</th><th>Status</th><th>Signed</th><th>Filled in</th><th /></tr></thead>
            <tbody>
              ${(d.signers || []).map(
                (s, i) => html`<tr key=${i}>
                    <td><span className="esdot" style=${{ background: esTone(i) }} /><b style=${{ fontWeight: 600 }}>${s.n}</b><div className="muted small">${s.e}</div></td>
                    <td>${s.ext ? 'Email link' : s.role === 'countersign' ? 'Countersign' : 'Portal'}</td>
                    <td>
                      <${Chip} s=${s.st === 'signed' ? 'ok' : s.st === 'declined' ? 'red' : waiting.includes(i) ? 'amber' : ''}>${s.st === 'signed' ? 'Signed' : s.st === 'declined' ? 'Declined' : waiting.includes(i) ? 'Waiting' : d.st === 'sent' ? 'Queued' : '—'}<//>
                      ${s.typed ? html`<div className="muted small">as "${s.typed}"</div>` : ''}${s.reason ? html`<div className="muted small">${s.reason}</div>` : ''}
                    </td>
                    <td className="num">${s.at ? fmtTs(s.at) : '—'}${s.ip ? html`<div className="muted small">${s.ip}</div>` : ''}</td>
                    <td className="small">${(d.fields || [])
                      .filter(f => f.s === i && (f.k === 'text' || f.k === 'check'))
                      .map(f => html`<div key=${f.id}>${f.lbl || ES_KIND_N[f.k]}: <b>${s.vals ? (f.k === 'check' ? (s.vals[f.id] ? 'yes' : 'no') : s.vals[f.id] || '—') : '—'}</b></div>`)}</td>
                    <td className="r">${run && s.tok && s.st !== 'signed' && d.st === 'sent' && html`<button className="btn ghost sm" onClick=${() => copyLink(s)}>Copy link</button>`}</td>
                  </tr>`
              )}
            </tbody>
          </table>
        </div>
        <div className="actions">
          <a className="btn ghost sm" href=${fileUrl(base, d.fid, true)}><${Icon} n="down" />Original (${d.fn})</a>
          ${d.sfid && html`<a className="btn sm" href=${fileUrl(base, d.sfid, true)}><${Icon} n="down" />${d.st === 'completed' ? 'Signed copy' : 'Copy signed so far'}</a>`}
        </div>
        ${d.fh && html`<p className="muted small">Original SHA-256: <span className="num" style=${{ wordBreak: 'break-all' }}>${d.fh}</span></p>`}
        ${
          (d.log || []).length > 0 &&
          html`<div>
              <h3 className="ph" style=${{ marginBottom: 8 }}>Audit log</h3>
              <ul className="list">
                ${(d.log || [])
                  .slice()
                  .reverse()
                  .map(
                    (l, i) => html`<li key=${i}>
                        <div><div className="t">${l.ev}</div><div className="m">${l.who}${l.ip ? ', ' + l.ip : ''}</div></div>
                        <span className="muted small num">${fmtTs(l.t)}</span>
                      </li>`
                  )}
              </ul>
            </div>`
        }
      </div>
      ${sign && html`<${SignModal} d=${d} onClose=${() => (setSign(false), onClose())} />`}
      ${
        copy &&
        html`<${Modal} title="Email the signed copy" onClose=${() => setCopy(null)} foot=${html`<button className="btn ghost" onClick=${() => setCopy(null)}>Cancel</button>
            <button className="btn" disabled=${!copy.to.trim()} onClick=${() =>
              call('es_send_copy', { id: d.id, ...copy }, r => 'Sent to ' + r.sent + (r.errors && r.errors.length ? '; not delivered: ' + r.errors.join(', ') : '') + '.').then(r => r && setCopy(null))}><${Icon} n="send" />Send</button>`}>
            <div className="form">
              <${Field} label="To (one or more addresses, separated by commas)"><input value=${copy.to} onInput=${e => setCopy({ ...copy, to: e.target.value })} placeholder="hr@client.com, legal@client.com" /><//>
              <${Field} label="Note (optional)"><textarea rows="3" value=${copy.note} onInput=${e => setCopy({ ...copy, note: e.target.value })} /><//>
              ${h && h.mailbox ? html`<${Field} label="Send from"><select value=${copy.from} onChange=${e => setCopy({ ...copy, from: e.target.value })}><option value="co">The company address (replies come to you)</option><option value="me">My mailbox (${h.mailbox})</option></select><//>` : null}
              <p className="muted small" style=${{ margin: 0 }}>The signed PDF goes as an attachment, with a signature certificate for each signer. It is noted in the audit log.</p>
            </div>
          <//>`
      }
    <//>`;
}

/* ---- placing the fields: pick whose field and what kind, click the page, drag to move, drag the corner to size ---- */
const ES_SIZE = { sig: [0.28, 0.06], ini: [0.09, 0.05], date: [0.18, 0.032], name: [0.26, 0.032], text: [0.26, 0.032], check: [0.028, 0.02] };
function EsFieldEditor({ url, bytes, names, fields, setFields }) {
  const pv = useEsPages(url, bytes);
  const [kind, setKind] = useState('sig');
  const [who, setWho] = useState(0);
  const [sel, setSel] = useState(null);
  if (pv.err) return html`<div className="note amber"><span>The pages could not be shown here (${errText(pv.err)}). You can still send: each signature then goes on a signature page at the end.</span></div>`;
  if (!pv.pages) return html`<${Spinner} label="Opening the pages…" />`;
  const add = (p, x, y) => {
    const [w, h] = ES_SIZE[kind];
    const nf = { id: 'f' + Math.random().toString(36).slice(2, 9), k: kind, s: Math.min(who, names.length - 1), p, x: Math.max(0, Math.min(1 - w, x - w / 2)), y: Math.max(0, Math.min(1 - h, y - h / 2)), w, h, req: true, lbl: '' };
    setFields([...fields, nf]);
    setSel(nf.id);
  };
  const cur = fields.find(f => f.id === sel);
  const set = patch => setFields(fields.map(f => (f.id === sel ? { ...f, ...patch } : f)));
  return html`<div className="esedit">
      <aside className="espalette stack" style=${{ gap: 10 }}>
        <div className="stack" style=${{ gap: 6 }}>
          <span className="lbl">Whose field</span>
          ${names.map((n, i) => html`<label key=${i} className=${'eswho' + (who === i ? ' on' : '')}><input type="radio" name="eswho" checked=${who === i} onChange=${() => setWho(i)} /><span className="esdot" style=${{ background: esTone(i) }} />${n}</label>`)}
        </div>
        <div className="stack" style=${{ gap: 6 }}>
          <span className="lbl">Field</span>
          <div className="eskinds">${Object.entries(ES_KIND_N).map(([k, n]) => html`<button key=${k} type="button" className=${'btn sm' + (kind === k ? '' : ' ghost')} onClick=${() => setKind(k)}>${n}</button>`)}</div>
          <p className="muted small" style=${{ margin: 0 }}>Click the page where it goes. Drag a field to move it, its corner to size it.</p>
        </div>
        ${
          cur
            ? html`<div className="stack panel" style=${{ gap: 8, padding: 10 }}>
                <b className="small">${ES_KIND_N[cur.k]} · page ${cur.p + 1}</b>
                <${Field} label="Signer"><select value=${cur.s} onChange=${e => set({ s: +e.target.value })}>${names.map((n, i) => html`<option key=${i} value=${i}>${n}</option>`)}</select><//>
                ${(cur.k === 'text' || cur.k === 'check') && html`<${Field} label="Label (what to fill in)"><input value=${cur.lbl} maxLength="60" onInput=${e => set({ lbl: e.target.value })} placeholder=${cur.k === 'text' ? 'e.g. Job title' : 'e.g. I have read the policy'} /><//>`}
                ${(cur.k === 'text' || cur.k === 'check') && html`<label className="check"><input type="checkbox" checked=${!!cur.req} onChange=${e => set({ req: e.target.checked })} /><span>Required</span></label>`}
                <div><button type="button" className="btn ghost sm" onClick=${() => (setFields(fields.filter(f => f.id !== sel)), setSel(null))}><${Icon} n="trash" />Remove</button></div>
              </div>`
            : html`<p className="muted small" style=${{ margin: 0 }}>${fields.length} field${fields.length === 1 ? '' : 's'} placed. Without fields, each signature goes on a signature page at the end.</p>`
        }
        ${fields.length > 0 && html`<div><button type="button" className="btn link small" onClick=${() => confirm('Remove every field?') && (setFields([]), setSel(null))}>Remove all fields</button></div>`}
      </aside>
      <div className="esdoc"><${EsPageView} pages=${pv.pages} fields=${fields} names=${names} edit onAdd=${add} onChange=${nf => setFields(fields.map(f => (f.id === nf.id ? nf : f)))} sel=${sel} setSel=${setSel} /></div>
    </div>`;
}

/* ---- a signing pattern's roles: who signs, in order ---- */
function EsRoles({ roles, setRoles, people, caps }) {
  const set = (i, patch) => setRoles(roles.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const kinds = Object.entries({ person: 'The person it is sent to', manager: 'Their manager', hr: 'HR', sender: 'The sender', member: 'A named person', ...(caps.ext ? { ext: 'Someone outside, by email' } : {}) });
  return html`<div className="stack" style=${{ gap: 8 }}>
      ${roles.map(
        (r, i) => html`<div key=${i} className="esrole">
            <span className="esdot" style=${{ background: esTone(i) }} /><b className="small">${i + 1}.</b>
            <select value=${r.k} onChange=${e => set(i, { k: e.target.value })} aria-label=${'Signer ' + (i + 1)}>${kinds.map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select>
            ${r.k === 'member' && html`<select value=${r.uid || ''} onChange=${e => set(i, { uid: e.target.value })} aria-label="Which person"><option value="">Choose…</option>${(people || []).map(p => html`<option key=${p.id} value=${p.id}>${p.n}</option>`)}</select>`}
            ${r.k === 'ext' && html`<input value=${r.n || ''} onInput=${e => set(i, { n: e.target.value })} placeholder="Name" aria-label="Outside signer's name" /><input type="email" value=${r.e || ''} onInput=${e => set(i, { e: e.target.value })} placeholder="email@company.com" aria-label="Outside signer's email" />`}
            <span className="push" />
            <button type="button" className="btn ghost icon" disabled=${i === 0} aria-label="Move up" onClick=${() => setRoles(roles.map((x, j) => (j === i - 1 ? roles[i] : j === i ? roles[i - 1] : x)))}>↑</button>
            <button type="button" className="btn ghost icon" aria-label="Remove this signer" onClick=${() => setRoles(roles.filter((x, j) => j !== i))}><${Icon} n="trash" /></button>
          </div>`
      )}
      ${roles.length < 10 && html`<div><button type="button" className="btn link small" onClick=${() => setRoles([...roles, { k: roles.some(r => r.k === 'person') ? 'hr' : 'person' }])}>Add a signer</button></div>`}
    </div>`;
}
const esRoleName = (r, people, me) => {
  const pn = id => ((people || []).find(p => p.id === id) || {}).n || '';
  return r.k === 'member' ? pn(r.uid) || 'A named person' : r.k === 'ext' ? r.n || r.e || 'Outside signer' : r.k === 'sender' ? 'The sender' + (me ? ' (' + me + ')' : '') : r.lbl || { person: 'The person', manager: 'Their manager', hr: 'HR' }[r.k];
};
// a pattern's roles for one person: the signer rows of a single send
function esRowsFor(pat, personId, people, h) {
  const byId = id => (people || []).find(p => p.id === id);
  return pat.roles.map(r => {
    if (r.k === 'person') return { k: 'member', uid: personId || '' };
    if (r.k === 'manager') return { k: 'member', uid: ((byId(personId) || {}).mgr) || '' };
    if (r.k === 'hr') return { k: 'member', uid: h.hr || '' };
    if (r.k === 'sender') return { k: 'member', uid: h.me.id };
    if (r.k === 'member') return { k: 'member', uid: r.uid || '' };
    return { k: 'ext', n: r.n || '', e: r.e || '' };
  });
}

/* ---- sending: the document, who signs, the fields, the email ---- */
function EsSend({ h, lib, bulk, onClose, onSent }) {
  const toast = useToast();
  const people = useEsPeople(true);
  const caps = h.caps;
  const hasPat = !!(lib && lib.pat && lib.pat.roles && lib.pat.roles.length);
  const [step, setStep] = useState(lib ? 1 : 0);
  const [file, setFile] = useState(null);
  const [bytes, setBytes] = useState(null);
  const [mode, setMode] = useState(bulk ? 'many' : 'others');
  const [person, setPerson] = useState('');
  const [rows, setRows] = useState(hasPat && !bulk ? esRowsFor(lib.pat, '', [], h) : [{ k: 'member', uid: '' }]);
  const [order, setOrder] = useState(hasPat ? lib.pat.order : 'seq');
  const [roles, setRoles] = useState(hasPat ? lib.pat.roles : [{ k: 'person' }]);
  const [many, setMany] = useState([]);
  const [fields, setFields] = useState(hasPat ? lib.pat.fields : []);
  const [f, setF] = useState({ ti: lib ? lib.ti : '', msg: lib ? lib.mail.msg || '' : '', subj: lib ? lib.mail.subj || '' : '', from: 'co', cc: '', attach: false, days: lib && lib.days ? lib.days : h.cfg.days, remind: lib && lib.remind ? lib.remind : h.cfg.remind, due: '' });
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(0);
  const [qq, setQq] = useState('');
  // a pattern's "person" chosen: the rows follow (their manager, HR, me...)
  useEffect(() => {
    if (hasPat && mode === 'others' && people) setRows(esRowsFor(lib.pat, person, people, h));
  }, [person, people && people.length]);
  const pickFile = async fl => {
    if (!fl) return;
    if (!/\.(pdf|png|jpe?g)$/i.test(fl.name)) {
      toast('Documents to sign must be PDF, PNG or JPG. Save Word files as PDF first.', true);
      return;
    }
    try {
      const pdf = /\.pdf$/i.test(fl.name) ? fl : await esPictureToPdf(fl);
      setFile(pdf);
      setBytes(new Uint8Array(await pdf.arrayBuffer()));
      if (!f.ti) setF(x => ({ ...x, ti: fl.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ') }));
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const pn = id => ((people || []).find(p => p.id === id) || {}).n || '';
  const names = mode === 'many' ? roles.map(r => esRoleName(r, people, h.me.n)) : mode === 'me' ? [h.me.n] : rows.map((r, i) => (r.k === 'member' ? pn(r.uid) || 'Signer ' + (i + 1) : r.n || r.e || 'Signer ' + (i + 1)));
  // fields of signers that are gone (a row removed) go with them
  useEffect(() => {
    if (fields.some(x => x.s >= names.length)) setFields(fields.filter(x => x.s < names.length));
  }, [names.length]);
  const docUrl = lib && lib.cur ? fileUrl('esd/' + lib.id, lib.cur.fid, false, lib.tok) : null;
  const okSigners = () => {
    if (mode === 'me') return '';
    if (mode === 'many') {
      if (!many.length) return 'Choose the people to send it to.';
      if (!roles.some(r => r.k === 'person')) return 'The signers need "The person it is sent to".';
      if (roles.some(r => r.k === 'member' && !r.uid)) return 'Choose the named person.';
      if (roles.some(r => r.k === 'ext' && !/^\S+@\S+\.\S+$/.test(r.e || ''))) return 'Give the outside signer’s email.';
      return '';
    }
    if (!rows.length) return 'Add at least one signer.';
    if (rows.some(r => (r.k === 'member' ? !r.uid : !(r.n || '').trim() || !/^\S+@\S+\.\S+$/.test(r.e || '')))) return 'Complete every signer (a person, or a name and email).';
    const keys = rows.map(r => (r.k === 'member' ? r.uid : (r.e || '').toLowerCase()));
    if (new Set(keys).size !== keys.length) return 'Each person signs once on a request.';
    return '';
  };
  const send = async () => {
    const why = okSigners();
    if (why || !f.ti.trim()) {
      toast(why || 'Give the request a title.', true);
      return;
    }
    setBusy(true);
    const data = {
      lib: lib ? lib.id : '',
      ti: f.ti.trim(),
      msg: f.msg.trim(),
      order: mode === 'many' ? order : order,
      fields,
      days: +f.days || 0,
      remind: +f.remind || 0,
      due: f.due,
      self: mode === 'me',
      signers: mode === 'others' ? rows.map(r => (r.k === 'member' ? { uid: r.uid } : { n: r.n.trim(), e: r.e.trim() })) : [],
      bulk: mode === 'many' ? many : [],
      pat: mode === 'many' ? { order, roles, fields } : undefined,
      mail: { from: f.from, subj: f.subj.trim(), cc: f.cc, attach: f.attach },
    };
    try {
      let r;
      if (lib) r = await api('es_send', data);
      else {
        const fd = new FormData();
        fd.append('data', JSON.stringify(data));
        fd.append('file', file, file.name);
        r = await upload('es_send', fd, setProg);
      }
      Sync.kick();
      toast(r.batch ? 'Sent to ' + r.sent + ' people' + (r.skipped && r.skipped.length ? '; not sent to ' + r.skipped.length + ' (' + r.skipped.map(s => (s.n || s.id) + ': ' + s.why).join('; ') + ')' : '') + '.' : mode === 'me' ? 'Ready: sign it now under To sign.' : 'Sent. Each signer gets an email with their link.');
      onSent && onSent(r.batch ? 'bulk' : mode === 'me' ? 'todo' : 'sent');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const steps = ['Document', 'Signers', 'Fields', 'Email and send'];
  const canNext = step === 0 ? !!file : step === 1 ? !okSigners() : true;
  const shown = (people || []).filter(p => !qq.trim() || (p.n + ' ' + p.e + ' ' + p.role).toLowerCase().includes(qq.trim().toLowerCase()));
  return html`<${Modal} wide title=${lib ? 'Send: ' + lib.ti : 'Send a document for signature'} onClose=${onClose} foot=${html`
      ${step > (lib ? 1 : 0) && html`<button className="btn ghost" onClick=${() => setStep(step - 1)}>Back</button>`}
      ${step < 3 ? html`<button className="btn" disabled=${!canNext} onClick=${() => (step === 1 && okSigners() ? toast(okSigners(), true) : setStep(step + 1))}>Next</button>` : html`<button className="btn go" disabled=${busy} onClick=${send}><${Icon} n="send" />${busy ? 'Sending…' : mode === 'many' ? 'Send to ' + many.length + ' people' : mode === 'me' ? 'Create and sign' : 'Send for signature'}</button>`}`}>
      <div className="stack">
        <ol className="essteps">${steps.map((s, i) => html`<li key=${i} className=${i === step ? 'on' : i < step ? 'done' : ''}>${s}</li>`)}</ol>
        ${
          step === 0 &&
          html`<div className="stack">
              ${file ? html`<ul className="files"><li><${Icon} n="file" /><div className="fn"><b>${file.name}</b><span>${sizeLabel(file.size)}</span></div><button className="btn ghost sm" onClick=${() => (setFile(null), setBytes(null), setFields([]))}>Remove</button></li></ul>` : html`<${FilePick} busy=${busy} progress=${prog} onFiles=${fs => pickFile(fs[0])} label="Attach the document to sign." hint="PDF works best; a PNG or JPG becomes a one-page PDF. Save Word files as PDF first." />`}
              <p className="muted small" style=${{ margin: 0 }}>To use a document from the library instead, open Library and press Send next to it.</p>
            </div>`
        }
        ${
          step === 1 &&
          html`<div className="stack">
              <div className="seg" style=${{ marginBottom: 0 }}>
                ${[['others', 'Send to others'], ['me', 'Only me'], ...(lib ? [['many', 'Many people, each their own copy']] : [])].map(([k, v]) => html`<button key=${k} type="button" className=${mode === k ? 'on' : ''} onClick=${() => setMode(k)}>${v}</button>`)}
              </div>
              ${mode === 'me' && html`<p className="muted">You sign it yourself; the signed copy stays here and is emailed to you.</p>`}
              ${
                mode === 'others' &&
                html`<div className="stack">
                    ${hasPat && lib.pat.roles.some(r => r.k === 'person') && html`<${Field} label="Who is it for?"><select value=${person} onChange=${e => setPerson(e.target.value)}><option value="">Choose a person…</option>${(people || []).map(p => html`<option key=${p.id} value=${p.id}>${p.n} (${p.e})</option>`)}</select><//>`}
                    <span className="lbl">Signers${order === 'seq' ? ', in signing order' : ''}</span>
                    ${rows.map(
                      (r, i) => html`<div key=${i} className="signer-row">
                          <span className="esdot" style=${{ background: esTone(i), alignSelf: 'center' }} />
                          <select value=${r.k} onChange=${e => setRows(rows.map((x, j) => (j === i ? { k: e.target.value, uid: '', n: '', e: '' } : x)))} aria-label="Signer type">
                            <option value="member">Portal member</option>
                            ${caps.ext && html`<option value="ext">By email (no account)</option>`}
                          </select>
                          ${
                            r.k === 'member'
                              ? html`<select value=${r.uid} onChange=${e => setRows(rows.map((x, j) => (j === i ? { ...x, uid: e.target.value } : x)))} aria-label="Choose a person"><option value="">${people ? 'Choose a person…' : 'Loading people…'}</option>${(people || []).map(p => html`<option key=${p.id} value=${p.id}>${p.n}${p.id === h.me.id ? ' (me)' : ''}</option>`)}</select>`
                              : html`<input value=${r.n} onInput=${e => setRows(rows.map((x, j) => (j === i ? { ...x, n: e.target.value } : x)))} placeholder="Full name" aria-label="Signer name" /><input type="email" value=${r.e} onInput=${e => setRows(rows.map((x, j) => (j === i ? { ...x, e: e.target.value } : x)))} placeholder="email@company.com" aria-label="Signer email" />`
                          }
                          ${rows.length > 1 && html`<button type="button" className="btn ghost icon" aria-label="Remove signer" onClick=${() => setRows(rows.filter((_, j) => j !== i))}><${Icon} n="trash" /></button>`}
                        </div>`
                    )}
                    <div className="actions">
                      ${rows.length < 10 && html`<button type="button" className="btn link small" onClick=${() => setRows([...rows, { k: 'member', uid: '' }])}>Add a signer</button>`}
                      ${!rows.some(r => r.uid === h.me.id) && rows.length < 10 && html`<button type="button" className="btn link small" onClick=${() => setRows([...rows, { k: 'member', uid: h.me.id }])}>I sign last</button>`}
                    </div>
                  </div>`
              }
              ${
                mode === 'many' &&
                html`<div className="stack">
                    <span className="lbl">Signers on each copy</span>
                    <${EsRoles} roles=${roles} setRoles=${setRoles} people=${people} caps=${caps} />
                    <div className="ph-row" style=${{ marginBottom: 0 }}><span className="lbl">Send it to (${many.length} chosen)</span>
                      <span className="actions"><button type="button" className="btn link small" onClick=${() => setMany(Array.from(new Set([...many, ...shown.map(p => p.id)])))}>Choose all shown</button><button type="button" className="btn link small" onClick=${() => setMany([])}>Clear</button></span></div>
                    <input type="search" value=${qq} onInput=${e => setQq(e.target.value)} placeholder="Find people by name, email or role (employee, bench…)" aria-label="Find people" />
                    <div className="esmany">${shown.map(p => html`<label key=${p.id} className="check"><input type="checkbox" checked=${many.includes(p.id)} onChange=${e => setMany(e.target.checked ? [...many, p.id] : many.filter(x => x !== p.id))} /><span>${p.n} <span className="muted small">${p.e} · ${p.role}${roles.some(r => r.k === 'manager') && !p.mgr ? ' · no manager on file' : ''}</span></span></label>`)}</div>
                  </div>`
              }
              ${mode !== 'me' && html`<label className="check"><input type="checkbox" checked=${order === 'any'} onChange=${e => setOrder(e.target.checked ? 'any' : 'seq')} /><span>Signers may sign in any order (everyone is asked at once)</span></label>`}
            </div>`
        }
        ${step === 2 && html`<${EsFieldEditor} url=${bytes ? null : docUrl} bytes=${bytes} names=${names} fields=${fields} setFields=${setFields} />`}
        ${
          step === 3 &&
          html`<div className="form">
              <${Field} label="Title"><input value=${f.ti} onInput=${e => setF({ ...f, ti: e.target.value })} placeholder="e.g. Updated leave policy, NDA, Offer letter" /><//>
              <${Field} label="Email subject"><input value=${f.subj} onInput=${e => setF({ ...f, subj: e.target.value })} placeholder="Please sign: {title}" /><//>
              <${Field} label="Message to the signers">
                <div className="aibar"><${AiWrite} kind="esign" value=${f.msg} ctx=${{ document: f.ti || '' }} onUse=${t => setF({ ...f, msg: t })} /></div>
                <textarea value=${f.msg} onInput=${e => setF({ ...f, msg: e.target.value })} placeholder="What this is and anything to check before signing. {first_name}, {title} and {sender} are filled in." />
              <//>
              <div className="row3">
                <${Field} label="Send the emails from">
                  <select value=${f.from} onChange=${e => setF({ ...f, from: e.target.value })}>
                    <option value="co">The company address (replies come to you)</option>
                    ${h.mailbox ? html`<option value="me">My mailbox (${h.mailbox})</option>` : null}
                  </select>
                <//>
                <${Field} label="Remind them"><select value=${f.remind} onChange=${e => setF({ ...f, remind: +e.target.value })}>${[[0, 'Never'], [1, 'Every day'], [2, 'Every 2 days'], [3, 'Every 3 days'], [5, 'Every 5 days'], [7, 'Every week']].map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//>
                <${Field} label="Close it after"><select value=${f.days} onChange=${e => setF({ ...f, days: +e.target.value })}>${[[0, 'Never'], [7, '7 days'], [14, '14 days'], [30, '30 days'], [60, '60 days'], [90, '90 days']].map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//>
              </div>
              ${!h.mailbox && html`<p className="muted small" style=${{ margin: 0 }}>Connect your mailbox under My email to send these from your own address.</p>`}
              <div className="row2">
                <${Field} label="Also send the signed copy to (optional)"><input value=${f.cc} onInput=${e => setF({ ...f, cc: e.target.value })} placeholder="hr@client.com, legal@company.com" /><//>
                <${Field} label="Due date (optional)"><input type="date" value=${f.due} onInput=${e => setF({ ...f, due: e.target.value })} /><//>
              </div>
              <label className="check"><input type="checkbox" checked=${f.attach} onChange=${e => setF({ ...f, attach: e.target.checked })} /><span>Attach a copy of the document to the email (signing still happens on the secure link)</span></label>
              <div className="note info"><span>${mode === 'many' ? 'Each of the ' + many.length + ' people gets their own copy with ' + roles.length + ' signer' + (roles.length === 1 ? '' : 's') : mode === 'me' ? 'Only you sign' : rows.length + ' signer' + (rows.length === 1 ? '' : 's') + (order === 'any' ? ', in any order' : ', one after the other')}${fields.length ? '; ' + fields.length + ' field' + (fields.length === 1 ? '' : 's') + ' on the pages' : '; signatures on a signature page at the end'}. When everyone has signed, the signed PDF goes to everyone${f.cc.trim() ? ' and the addresses above' : ''}.</span></div>
            </div>`
        }
      </div>
    <//>`;
}

/* ---- the internal document library ---- */
function EsLibrary({ h, onSend }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [arch, setArch] = useState(false);
  const [qq, setQq] = useState('');
  const [cat, setCat] = useState('');
  const [edit, setEdit] = useState(null);
  const load = () =>
    api('es_lib', { arch })
      .then(r => setD(r.docs))
      .catch(setErr);
  useEffect(() => {
    load();
  }, [arch]);
  if (err && !d) return html`<${LoadError} error=${err} onRetry=${load} />`;
  if (!d) return html`<${Spinner} />`;
  const ql = qq.trim().toLowerCase();
  const list = d.filter(x => (!cat || x.cat === cat) && (!ql || (x.ti + ' ' + x.desc + ' ' + x.byn).toLowerCase().includes(ql)));
  const cats = Object.entries(h.cats).filter(([k]) => d.some(x => x.cat === k));
  return html`<div className="stack">
      <div className="toolbar">
        <input type="search" style=${{ maxWidth: 260 }} placeholder="Find a document" value=${qq} onInput=${e => setQq(e.target.value)} aria-label="Find a document" />
        <select value=${cat} onChange=${e => setCat(e.target.value)} aria-label="Category"><option value="">All kinds</option>${cats.map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select>
        <label className="check"><input type="checkbox" checked=${arch} onChange=${e => setArch(e.target.checked)} /><span>Show archived</span></label>
        ${h.caps.send && html`<div className="push"><button className="btn" onClick=${() => setEdit({})}><${Icon} n="up" />Add a document</button></div>`}
      </div>
      ${
        list.length
          ? html`<div className="eslib">${list.map(
              x => html`<section key=${x.id} className=${'panel eslibdoc' + (x.arch ? ' arch' : '')}>
                  <div className="ph-row" style=${{ marginBottom: 4 }}>
                    <div><b>${x.ti}</b> <${Chip}>${h.cats[x.cat] || x.cat}<//>${x.arch ? html` <${Chip}>archived<//>` : null}</div>
                  </div>
                  ${x.desc && html`<p className="muted small" style=${{ margin: '0 0 6px', whiteSpace: 'pre-wrap' }}>${x.desc}</p>`}
                  <div className="muted small">Version ${x.cur ? x.cur.v : 1} · ${x.cur ? x.cur.fn : ''} · ${h.vis[x.vis]} · added by ${x.byn}${x.uses ? ' · sent ' + x.uses + ' time' + (x.uses === 1 ? '' : 's') : ''}</div>
                  ${x.pat && x.pat.roles && x.pat.roles.length > 0 && html`<div className="muted small">Signing pattern: ${x.pat.roles.map(r => esRoleName(r, null, '')).join(' → ')}${x.pat.order === 'any' ? ' (any order)' : ''}${x.pat.fields.length ? ' · ' + x.pat.fields.length + ' fields' : ''}</div>`}
                  <div className="actions" style=${{ marginTop: 8 }}>
                    ${x.cur && html`<a className="btn ghost sm" href=${fileUrl('esd/' + x.id, x.cur.fid, false, x.tok)} target="_blank" rel="noopener"><${Icon} n="file" />Read</a>`}
                    ${x.send && !x.arch && html`<button className="btn sm" onClick=${() => onSend(x)}><${Icon} n="send" />Send</button>`}
                    ${x.send && !x.arch && x.pat && x.pat.roles.some(r => r.k === 'person') && html`<button className="btn ghost sm" onClick=${() => onSend(x, true)}>Send to many</button>`}
                    ${x.edit && html`<button className="btn ghost sm" onClick=${() => setEdit(x)}><${Icon} n="pen" />Edit</button>`}
                    ${x.edit && html`<button className="btn ghost sm" onClick=${() => api('es_lib_archive', { id: x.id, arch: !x.arch }).then(() => (toast(x.arch ? 'Back in the library.' : 'Archived.'), load()), e => toast(errText(e), true))}>${x.arch ? 'Restore' : 'Archive'}</button>`}
                  </div>
                </section>`
            )}</div>`
          : html`<section className="panel"><${Empty} title=${d.length ? 'Nothing matches' : 'The library is empty'} action=${h.caps.send && !d.length ? html`<button className="btn" onClick=${() => setEdit({})}>Add a document</button>` : null}>Keep the company's internal documents here: policies, handbooks, NDAs, offer letters, HR forms. Give each one a signing pattern (who signs, in what order, and where on the pages) and send it in a few clicks, to one person or to many.<//></section>`
      }
      ${edit && html`<${EsLibEdit} h=${h} doc=${edit.id ? edit : null} onClose=${() => setEdit(null)} onSaved=${() => (setEdit(null), load())} />`}
    </div>`;
}
function EsLibEdit({ h, doc, onClose, onSaved }) {
  const toast = useToast();
  const people = useEsPeople(true);
  const [tab, setTab] = useState('doc');
  const [f, setF] = useState(doc ? { ti: doc.ti, cat: doc.cat, desc: doc.desc, vis: doc.vis, days: doc.days, remind: doc.remind, note: '' } : { ti: '', cat: 'policy', desc: '', vis: 'team', days: 0, remind: 0, note: '' });
  const [mail, setMail] = useState(doc ? { subj: doc.mail.subj || '', msg: doc.mail.msg || '' } : { subj: '', msg: '' });
  const [order, setOrder] = useState(doc ? doc.pat.order : 'seq');
  const [roles, setRoles] = useState(doc && doc.pat.roles.length ? doc.pat.roles : [{ k: 'person' }]);
  const [fields, setFields] = useState(doc ? doc.pat.fields : []);
  const [file, setFile] = useState(null);
  const [bytes, setBytes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(0);
  const pick = async fl => {
    if (!fl) return;
    if (!/\.(pdf|png|jpe?g)$/i.test(fl.name)) {
      toast('Library documents must be PDF, PNG or JPG. Save Word files as PDF first.', true);
      return;
    }
    try {
      const pdf = /\.pdf$/i.test(fl.name) ? fl : await esPictureToPdf(fl);
      setFile(pdf);
      setBytes(new Uint8Array(await pdf.arrayBuffer()));
      if (!f.ti) setF(x => ({ ...x, ti: fl.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ') }));
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const save = async () => {
    if (!f.ti.trim()) return toast('Give the document a title.', true);
    if (!doc && !file) return toast('Attach the document.', true);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('data', JSON.stringify({ id: doc ? doc.id : '', ...f, ti: f.ti.trim(), pat: { order, roles, fields: fields.filter(x => x.s < roles.length) }, mail }));
      if (file) fd.append('file', file, file.name);
      await upload('es_lib_save', fd, setProg);
      toast(doc ? 'Saved.' : 'Added to the library.');
      onSaved();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const names = roles.map(r => esRoleName(r, people, ''));
  const url = !bytes && doc && doc.cur ? fileUrl('esd/' + doc.id, doc.cur.fid, false, doc.tok) : null;
  return html`<${Modal} wide title=${doc ? 'Edit: ' + doc.ti : 'Add a document to the library'} onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Cancel</button><button className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save'}</button>`}>
      <${KitTabs} tabs=${[['doc', 'Document'], ['pat', 'Who signs'], ['fields', 'Fields on the pages', fields.length || null], ['mail', 'Email and timing']]} tab=${tab} onTab=${setTab} wrap />
      ${
        tab === 'doc' &&
        html`<div className="form">
            <${Field} label="Title"><input value=${f.ti} onInput=${e => setF({ ...f, ti: e.target.value })} placeholder="e.g. Employee handbook acknowledgement" /><//>
            <div className="row2">
              <${Field} label="Kind"><select value=${f.cat} onChange=${e => setF({ ...f, cat: e.target.value })}>${Object.entries(h.cats).map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select><//>
              <${Field} label="Who sees it in the library"><select value=${f.vis} onChange=${e => setF({ ...f, vis: e.target.value })}>${Object.entries(h.vis).filter(([k]) => k !== 'hr' || h.caps.manage).map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select><//>
            </div>
            <${Field} label="Description (optional)"><textarea rows="3" value=${f.desc} onInput=${e => setF({ ...f, desc: e.target.value })} placeholder="What it is and when to send it" /><//>
            <span className="lbl">${doc ? 'A new version (optional)' : 'The document'}</span>
            ${file ? html`<ul className="files"><li><${Icon} n="file" /><div className="fn"><b>${file.name}</b><span>${sizeLabel(file.size)}</span></div><button className="btn ghost sm" onClick=${() => (setFile(null), setBytes(null))}>Remove</button></li></ul>` : html`<${FilePick} busy=${busy} progress=${prog} onFiles=${fs => pick(fs[0])} label=${doc ? 'Drop the new version here.' : 'Attach the document.'} hint="PDF works best; a PNG or JPG becomes a one-page PDF." />`}
            ${file && doc && html`<${Field} label="What changed in this version"><input value=${f.note} onInput=${e => setF({ ...f, note: e.target.value })} /><//>`}
            ${
              doc &&
              doc.files.length > 0 &&
              html`<details><summary className="small">Versions (${doc.files.length})</summary><ul className="list small">${doc.files
                .slice()
                .reverse()
                .map(v => html`<li key=${v.v}><div><div className="t"><a href=${fileUrl('esd/' + doc.id, v.fid, false, doc.tok)} target="_blank" rel="noopener">Version ${v.v}: ${v.fn}</a></div><div className="m">${v.by}, ${fmtTs(v.at)}${v.note ? ' · ' + v.note : ''}</div></div></li>`)}</ul></details>`
            }
          </div>`
      }
      ${
        tab === 'pat' &&
        html`<div className="stack">
            <p className="muted small" style=${{ margin: 0 }}>Who signs this document, in order. "The person it is sent to" is chosen when you send it, so the same document goes to one person or to many; their manager and HR are found for each of them.</p>
            <${EsRoles} roles=${roles} setRoles=${setRoles} people=${people} caps=${h.caps} />
            <label className="check"><input type="checkbox" checked=${order === 'any'} onChange=${e => setOrder(e.target.checked ? 'any' : 'seq')} /><span>They may sign in any order</span></label>
          </div>`
      }
      ${tab === 'fields' && (url || bytes ? html`<${EsFieldEditor} url=${url} bytes=${bytes} names=${names.length ? names : ['Signer 1']} fields=${fields} setFields=${setFields} />` : html`<p className="muted">Attach the document first (Document tab).</p>`)}
      ${
        tab === 'mail' &&
        html`<div className="form">
            <${Field} label="Email subject"><input value=${mail.subj} onInput=${e => setMail({ ...mail, subj: e.target.value })} placeholder="Please sign: {title}" /><//>
            <${Field} label="Message"><textarea rows="4" value=${mail.msg} onInput=${e => setMail({ ...mail, msg: e.target.value })} placeholder="Hi {first_name}, please read and sign {title}. {sender}" /><//>
            <div className="row2">
              <${Field} label="Remind them"><select value=${f.remind} onChange=${e => setF({ ...f, remind: +e.target.value })}>${[[0, 'The usual (' + (h.cfg.remind ? 'every ' + h.cfg.remind + ' days' : 'never') + ')'], [1, 'Every day'], [2, 'Every 2 days'], [3, 'Every 3 days'], [5, 'Every 5 days'], [7, 'Every week']].map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//>
              <${Field} label="Close it after"><select value=${f.days} onChange=${e => setF({ ...f, days: +e.target.value })}>${[[0, 'The usual (' + (h.cfg.days ? h.cfg.days + ' days' : 'never') + ')'], [7, '7 days'], [14, '14 days'], [30, '30 days'], [60, '60 days'], [90, '90 days']].map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//>
            </div>
          </div>`
      }
    <//>`;
}

/* ---- sent to many: one copy per person, and who has signed ---- */
function EsBatches() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(null);
  const load = () =>
    api('es_batches', {})
      .then(r => setD(r.batches))
      .catch(setErr);
  useEffect(() => {
    load();
  }, []);
  if (err && !d) return html`<${LoadError} error=${err} onRetry=${load} />`;
  if (!d) return html`<${Spinner} />`;
  return html`<div className="stack">
      ${
        d.length
          ? html`<section className="panel" style=${{ padding: '6px 8px' }}><div className="tblwrap"><table className="tbl">
              <thead><tr><th>Document</th><th>Sent</th><th>Signed</th><th /></tr></thead>
              <tbody>${d.map(
                b => html`<tr key=${b.id} className="click" onClick=${() => setOpen(b.id)}>
                    <td><b style=${{ fontWeight: 600 }}>${b.ti}</b><div className="muted small">by ${b.byn}</div></td>
                    <td className="num">${fmtDay(b.at)}</td>
                    <td><div className="imbar" style=${{ maxWidth: 160 }}><span style=${{ width: Math.round((b.done / Math.max(1, b.n)) * 100) + '%' }} /></div><div className="small">${b.done} of ${b.n}${b.skipped ? ' · ' + b.skipped + ' not sent' : ''}</div></td>
                    <td className="r"><button className="btn ghost sm">Open</button></td>
                  </tr>`
              )}</tbody></table></div></section>`
          : html`<section className="panel"><${Empty} title="Nothing sent to many yet">Send a library document to many people at once (Library › Send to many): everyone gets their own copy, and this page shows who has signed.<//></section>`
      }
      ${open && html`<${EsBatch} id=${open} onClose=${() => (setOpen(null), load())} />`}
    </div>`;
}
function EsBatch({ id, onClose }) {
  const toast = useToast();
  const [b, setB] = useState(null);
  const [f, setF] = useState('all');
  const load = () => api('es_batch', { id }).then(r => setB(r.batch), e => toast(errText(e), true));
  useEffect(() => {
    load();
  }, [id]);
  const rows = b ? b.rows.filter(r => f === 'all' || (f === 'done' ? r.st === 'completed' : r.st === 'sent')) : [];
  const csv = () => {
    const lines = [['Person', 'Status', 'Signed', 'Waiting for'], ...b.rows.map(r => [r.n, SIG_ST[r.st] || r.st, r.signed + ' of ' + r.of, r.wait.join('; ')])];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.map(l => l.map(x => '"' + String(x).replace(/"/g, '""') + '"').join(',')).join('\n')], { type: 'text/csv' }));
    a.download = (b.ti || 'signatures').replace(/[^\w-]+/g, '-') + '.csv';
    a.click();
  };
  return html`<${Modal} wide title=${b ? b.ti : 'Sent to many'} onClose=${onClose} foot=${html`${b && html`<button className="btn ghost" onClick=${csv}><${Icon} n="down" />Download as CSV</button><button className="btn ghost" onClick=${() => api('es_batch_remind', { id }).then(r => toast('Reminded ' + r.reminded + '.'), e => toast(errText(e), true))}>Remind everyone waiting</button>`}<button className="btn" onClick=${onClose}>Close</button>`}>
      ${
        !b
          ? html`<${Spinner} />`
          : html`<div className="stack">
              <${KitStats} items=${[{ v: b.rows.length, l: 'Copies sent' }, { v: b.rows.filter(r => r.st === 'completed').length, l: 'Signed by everyone', tone: 'ok' }, { v: b.rows.filter(r => r.st === 'sent').length, l: 'Still waiting', tone: b.rows.some(r => r.st === 'sent') ? 'amber' : '' }, { v: (b.skipped || []).length, l: 'Not sent' }]} />
              <div className="seg" style=${{ marginBottom: 0 }}>${[['all', 'Everyone'], ['wait', 'Waiting'], ['done', 'Signed']].map(([k, v]) => html`<button key=${k} type="button" className=${f === k ? 'on' : ''} onClick=${() => setF(k)}>${v}</button>`)}</div>
              <div className="tblwrap"><table className="tbl small"><thead><tr><th>Person</th><th>Status</th><th>Signatures</th><th>Waiting for</th><th /></tr></thead><tbody>${rows.map(
                r => html`<tr key=${r.id}><td>${r.n}</td><td><${Chip} s=${sigChip(r.st)}>${SIG_ST[r.st] || r.st}<//></td><td>${r.signed} of ${r.of}</td><td>${r.wait.join(', ') || '—'}</td><td className="r">${r.sfid && html`<a className="btn ghost sm" href=${fileUrl('sig/' + r.id, r.sfid, true)}><${Icon} n="down" />PDF</a>`}</td></tr>`
              )}</tbody></table></div>
              ${(b.skipped || []).length > 0 && html`<div className="note amber"><span>Not sent: ${b.skipped.map(s => (s.n || s.id) + ' (' + s.why + ')').join('; ')}.</span></div>`}
            </div>`
      }
    <//>`;
}

/* ---- settings (administrators and HR) ---- */
function EsSettings({ h, onSaved }) {
  const toast = useToast();
  const people = useEsPeople(true);
  const [f, setF] = useState({ ...h.cfg });
  const save = () =>
    api('es_settings_save', f).then(
      () => (toast('E-signature settings saved.'), onSaved()),
      e => toast(errText(e), true)
    );
  return html`<div className="stack form" style=${{ maxWidth: 760 }}>
      <section className="panel stack">
        <b>Who may send documents for signature</b>
        <label className="check"><input type="radio" name="eswhoset" checked=${f.who === 'granted'} onChange=${() => setF({ ...f, who: 'granted' })} /><span>Administrators, HR, accounting and the people given the "E-signatures" feature under Admin › Roles & access</span></label>
        <label className="check"><input type="radio" name="eswhoset" checked=${f.who === 'team'} onChange=${() => setF({ ...f, who: 'team' })} /><span>Everyone on the team (employees, managers and recruiters), plus the above</span></label>
        <p className="muted small" style=${{ margin: 0 }}>Everyone can always sign what is sent to them. "E-signature manager" (Roles & access) runs the library and sees every request.</p>
        <label className="check"><input type="checkbox" checked=${!!f.ext} onChange=${e => setF({ ...f, ext: e.target.checked })} /><span>Team members may also send to people outside the portal, by email</span></label>
      </section>
      <section className="panel stack">
        <b>Defaults for new requests</b>
        <div className="row3">
          <${Field} label="Close requests after"><select value=${f.days} onChange=${e => setF({ ...f, days: +e.target.value })}>${[[0, 'Never'], [7, '7 days'], [14, '14 days'], [30, '30 days'], [60, '60 days'], [90, '90 days']].map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//>
          <${Field} label="Remind signers"><select value=${f.remind} onChange=${e => setF({ ...f, remind: +e.target.value })}>${[[0, 'Never'], [1, 'Every day'], [2, 'Every 2 days'], [3, 'Every 3 days'], [5, 'Every 5 days'], [7, 'Every week']].map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//>
          <${Field} label=${'"HR" in signing patterns is'}><select value=${f.hr} onChange=${e => setF({ ...f, hr: e.target.value })}><option value="">The sender if HR, else the first HR person</option>${(people || []).filter(p => p.hr).map(p => html`<option key=${p.id} value=${p.id}>${p.n}</option>`)}</select><//>
        </div>
        <p className="muted small" style=${{ margin: 0 }}>Reminders go out from the company address, with the sender as the one replies go to. Each request can change these when it is sent.</p>
      </section>
      <div><button className="btn" onClick=${save}>Save</button></div>
    </div>`;
}
