/* ================= v36.3: reading IDs in the browser (the staff ID check and the ID link) ================= */
// Everything is read here, in this browser, and nothing is sent to an outside service:
//  - the license barcode (PDF417) with ZXing (js/vendor/zxing.min.js)
//  - the green card's three lines with StratEdge's own reader (js/idread.js, run in a worker; OCR-B + check digits)
//  - the front's printed text with Tesseract (js/vendor/tesseract), then the back's values looked for on it
// Used by the ID check (idscan.js, staff) and by the page a person opens from an ID link (#/id?t=…, IdLinkPage).
const IDK_BUILD = typeof APP_BUILD === 'string' ? APP_BUILD : '1';
let IDS_ZX = null;
const idsZxing = () =>
  IDS_ZX ||
  (IDS_ZX = new Promise((res, rej) => {
    if (window.ZXing) return res(window.ZXing);
    const s = document.createElement('script');
    s.src = 'js/vendor/zxing.min.js?v=' + IDK_BUILD;
    s.onload = () => (window.ZXing ? res(window.ZXing) : rej(new Error('The barcode reader did not start.')));
    s.onerror = () => {
      IDS_ZX = null;
      rej(new Error('The barcode reader could not be loaded. Check your connection and try again.'));
    };
    document.head.appendChild(s);
  }));
/* a picture turned (0/90/180/270) and scaled, never larger than the readers handle quickly */
function idsTurn(src, rot, scale) {
  const w0 = src.videoWidth || src.width;
  const h0 = src.videoHeight || src.height;
  const k = Math.min(scale, 2200 / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * k));
  const h = Math.max(1, Math.round(h0 * k));
  const c = document.createElement('canvas');
  const side = rot % 180 !== 0;
  c.width = side ? h : w;
  c.height = side ? w : h;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.translate(c.width / 2, c.height / 2);
  x.rotate((rot * Math.PI) / 180);
  x.drawImage(src, -w / 2, -h / 2, w, h);
  return c;
}
/* the license barcode in a picture: tried turned and at a few sizes; '' when there is none */
async function idsDecode(src, quick) {
  const ZX = await idsZxing();
  const hints = new Map();
  hints.set(ZX.DecodeHintType.TRY_HARDER, true);
  hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, [ZX.BarcodeFormat.PDF_417]);
  const reader = new ZX.PDF417Reader();
  const tries = quick ? [[0, 1], [180, 1]] : [[0, 1], [90, 1], [270, 1], [180, 1], [0, 0.6], [90, 0.6], [270, 0.6], [0, 1.5], [90, 1.5], [270, 1.5]];
  for (const [rot, scale] of tries) {
    try {
      const c = idsTurn(src, rot, scale);
      const bmp = new ZX.BinaryBitmap(new ZX.HybridBinarizer(new ZX.HTMLCanvasElementLuminanceSource(c)));
      const r = reader.decode(bmp, hints);
      const t = r && r.getText ? r.getText() : '';
      if (t) return t;
    } catch (e) {
      /* not found at this angle */
    }
    if (!quick) await new Promise(r => setTimeout(r, 0));
  }
  return '';
}
/* every page of a file as a picture: images as they are, PDFs page by page (two pages at most) */
async function idsPages(file) {
  const out = [];
  if (/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name || '')) {
    const pdfjs = await loadPdfJs();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    for (let i = 1; i <= Math.min(doc.numPages, 2); i++) {
      const pg = await doc.getPage(i);
      const vp = pg.getViewport({ scale: 1 });
      const k = Math.min(3, 2200 / Math.max(vp.width, vp.height));
      const v2 = pg.getViewport({ scale: k });
      const c = document.createElement('canvas');
      c.width = Math.round(v2.width);
      c.height = Math.round(v2.height);
      await pg.render({ canvasContext: c.getContext('2d'), viewport: v2 }).promise;
      out.push(c);
    }
    return out;
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error((file.name || 'This file') + ' is not a picture this browser can open. Use a JPEG, PNG or PDF.'));
      i.src = url;
    });
    out.push(idsTurn(img, 0, 1));
  } finally {
    URL.revokeObjectURL(url);
  }
  return out;
}
const idsBlob = c => new Promise(res => c.toBlob(b => res(b), 'image/jpeg', 0.9));
/* ICAO 9303 check digit (7-3-1), the same rule the server applies */
const idsCd = s => {
  let sum = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const v = ch === '<' ? 0 : /\d/.test(ch) ? +ch : /[A-Z]/.test(ch) ? ch.charCodeAt(0) - 55 : -1;
    if (v < 0) return -1;
    sum += v * [7, 3, 1][i % 3];
  }
  return sum % 10;
};
function idsMrzHints(l) {
  const [a, b] = l;
  const out = [];
  if (a.length === 30) out.push(['USCIS number', idsCd(a.slice(5, 14)) === +a[14] && /\d/.test(a[14])]);
  if (b.length === 30) {
    out.push(['birth date', idsCd(b.slice(0, 6)) === +b[6] && /\d/.test(b[6])]);
    out.push(['expiry date', idsCd(b.slice(8, 14)) === +b[14] && /\d/.test(b[14])]);
    if (a.length === 30) out.push(['whole line', idsCd(a.slice(5, 30) + b.slice(0, 7) + b.slice(8, 15) + b.slice(18, 29)) === +b[29] && /\d/.test(b[29])]);
  }
  return out;
}

/* ---------- the reader of the green card's lines (js/idread.js), in a worker and on the page ---------- */
let IDK_W = null;
let IDK_N = 0;
const IDK_CB = new Map();
function idkWorker() {
  if (IDK_W) return IDK_W;
  const w = new Worker('js/idread.js?v=' + IDK_BUILD);
  w.onmessage = e => {
    const m = e.data || {};
    const cb = IDK_CB.get(m.id);
    if (cb) {
      IDK_CB.delete(m.id);
      cb.res(m.r);
    }
  };
  w.onerror = () => {
    IDK_CB.forEach(cb => cb.rej(new Error('The ID reader stopped. Reload the page and try again.')));
    IDK_CB.clear();
    IDK_W = null;
  };
  IDK_W = w;
  return w;
}
function idkAsk(msg) {
  return new Promise((res, rej) => {
    const id = ++IDK_N;
    IDK_CB.set(id, { res, rej });
    try {
      idkWorker().postMessage({ ...msg, id }, msg.g ? [msg.g.buffer] : []);
    } catch (e) {
      IDK_CB.delete(id);
      rej(e);
    }
  });
}
let IDK_LIB = null;
/* the reader's own functions on the page (comparing the front, reading the values of the back) */
const idkLib = () =>
  IDK_LIB ||
  (IDK_LIB = new Promise((res, rej) => {
    if (window.SEIdRead) return res(window.SEIdRead);
    const s = document.createElement('script');
    s.src = 'js/idread.js?v=' + IDK_BUILD;
    s.onload = () => (window.SEIdRead ? res(window.SEIdRead) : rej(new Error('The ID reader did not start.')));
    s.onerror = () => {
      IDK_LIB = null;
      rej(new Error('The ID reader could not be loaded. Check your connection and try again.'));
    };
    document.head.appendChild(s);
  }));
let IDK_CV = null;
/* grey values of a picture or a camera frame, its longer side at most max */
function idkGray(src, max) {
  const w0 = src.videoWidth || src.width;
  const h0 = src.videoHeight || src.height;
  const k = Math.min(1, (max || 2200) / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * k));
  const h = Math.max(1, Math.round(h0 * k));
  const c = IDK_CV || (IDK_CV = document.createElement('canvas'));
  c.width = w;
  c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(src, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data;
  const g = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (d[j] * 299 + d[j + 1] * 587 + d[j + 2] * 114 + 500) / 1000;
  return { w, h, g, k };
}
/* the green card's lines in a picture (turned any way) */
async function idkMrz(src) {
  const im = idkGray(src, 2200);
  const r = (await idkAsk({ op: 'mrz', w: im.w, h: im.h, g: im.g, opts: { turns: true } })) || { found: false };
  if (r.quad) r.quad = r.quad.map(([x, y]) => [x / im.k, y / im.k]);
  return r;
}
/* the back of a picture: the green card's lines first (quick), then the license barcode when there are none */
async function idkBack(src, kinds) {
  const ks = kinds || ['dl', 'gc'];
  const mrz = ks.includes('gc') ? await idkMrz(src).catch(() => ({ found: false })) : { found: false };
  if (idkMrzUsable(mrz) || !ks.includes('dl')) return { bar: '', mrz };
  const bar = await idsDecode(src, false).catch(() => '');
  return { bar: bar && /ANSI |AAMVA/.test(bar) ? bar : '', mrz };
}
/* lines good enough to send: every check digit right, or read so clearly that a failing check digit is the card's own */
const idkMrzUsable = r => !!(r && r.found && r.lines && (r.ok || (r.conf >= 0.93 && r.min >= 0.6)));

/* ---------- the front: Tesseract reads its text, the back's values are looked for in it ---------- */
let IDK_T = null;
function idkTess() {
  if (IDK_T) return IDK_T;
  IDK_T = (async () => {
    if (!window.Tesseract) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'js/vendor/tesseract/tesseract.min.js?v=' + IDK_BUILD;
        s.onload = res;
        s.onerror = () => rej(new Error('The text reader could not be loaded. Check your connection and try again.'));
        document.head.appendChild(s);
      });
    }
    let simd = false;
    try {
      simd = WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
    } catch (e) {
      /* no WebAssembly SIMD: the plain build */
    }
    const base = 'js/vendor/tesseract/';
    const w = await window.Tesseract.createWorker('eng', 1, {
      workerPath: base + 'worker.min.js?v=' + IDK_BUILD,
      corePath: base + 'tesseract-core-' + (simd ? 'simd-' : '') + 'lstm.js',
      langPath: base.slice(0, -1),
      gzip: false,
      workerBlobURL: false,
      cacheMethod: 'write',
      cachePath: 'se-idocr-1',
    });
    await w.setParameters({ tessedit_pageseg_mode: '11', user_defined_dpi: '300' });
    return w;
  })().catch(e => {
    IDK_T = null;
    throw e;
  });
  return IDK_T;
}
/* the words of a picture with their confidence, box and line */
async function idkOcr(canvas, psm) {
  const w = await idkTess();
  if (psm) await w.setParameters({ tessedit_pageseg_mode: psm });
  try {
    const { data } = await w.recognize(canvas, {}, { blocks: true, text: false });
    const out = [];
    let l = 0;
    for (const bl of data.blocks || [])
      for (const pa of bl.paragraphs || [])
        for (const li of pa.lines || []) {
          for (const wd of li.words || []) out.push({ t: wd.text, c: Math.round(wd.confidence), b: [wd.bbox.x0, wd.bbox.y0, wd.bbox.x1, wd.bbox.y1], l });
          l++;
        }
    return out;
  } finally {
    if (psm) await w.setParameters({ tessedit_pageseg_mode: '11' });
  }
}
const idkGood = ws => ws.filter(x => x.c >= 75 && /[A-Za-z0-9]{2}/.test(x.t)).length;
/* The front read and compared with the back's values (back: SEIdRead.parseTd1 / parseAamva, or null to only read).
   A difference is read again closer up: the same reading makes it sure; the back's value there means a misread. */
async function idkFront(src, back) {
  const S = await idkLib();
  const big = Math.max(src.videoWidth || src.width, src.videoHeight || src.height);
  let rot = 0;
  let c = idsTurn(src, 0, Math.min(1, 1800 / big));
  let words = await idkOcr(c);
  // a picture taken sideways or upside down: the other ways tried small, the best read fully
  if (idkGood(words) < 8) {
    let best = { n: idkGood(words), rot: 0 };
    for (const r of [90, 270, 180]) {
      const n = idkGood(await idkOcr(idsTurn(src, r, Math.min(1, 1000 / big))));
      if (n > best.n + 3) best = { n, rot: r };
    }
    if (best.rot) {
      rot = best.rot;
      c = idsTurn(src, rot, Math.min(1, 1800 / big));
      words = await idkOcr(c);
    }
  }
  const m = S.frontMatch(words, back || { kind: 'gc' });
  if (back) {
    for (const d of m.diff) {
      if (!d.b) continue;
      const h = Math.max(8, d.b[3] - d.b[1]);
      const x0 = Math.max(0, d.b[0] - h * 1.2);
      const y0 = Math.max(0, d.b[1] - h * 0.6);
      const x1 = Math.min(c.width, d.b[2] + h * 1.2);
      const y1 = Math.min(c.height, d.b[3] + h * 0.6);
      const k = Math.min(3, 1600 / Math.max(1, x1 - x0));
      const crop = document.createElement('canvas');
      crop.width = Math.max(1, Math.round((x1 - x0) * k));
      crop.height = Math.max(1, Math.round((y1 - y0) * k));
      const cx = crop.getContext('2d');
      cx.imageSmoothingQuality = 'high';
      cx.drawImage(c, x0, y0, x1 - x0, y1 - y0, 0, 0, crop.width, crop.height);
      const ws = (await idkOcr(crop, '7')).map(x => ({ ...x, l: 0 }));
      const text = ws.map(x => x.t).join(' ').toUpperCase();
      if (d.f === 'dob' || d.f === 'exp') {
        const ds = S.datesIn(S.frontLines(ws));
        const val = d.f === 'dob' ? back.dob : back.expiry;
        if (ds.some(x => S.sameDate(x, val))) d.gone = true;
        else d.sure = ds.some(x => S.fmtDate(x) === d.front);
      } else if (d.f === 'num') {
        const dg = S.toDigits(text).replace(/\D/g, '');
        if (dg.includes(String(back.uscis || back.number || '').replace(/\D/g, ''))) d.gone = true;
        else d.sure = dg.includes(d.front.replace(/\D/g, ''));
      } else if (d.f === 'name') {
        // the name on the back has no check digit: only a clearly different name (3 letters or more) is sure
        const toks = text.split(/[^A-Z]+/);
        const fam = String(back.family || '').toUpperCase().split(/\s+/).filter(Boolean);
        if (fam.every(p => toks.some(t => S.lev(p, t) <= 1))) d.gone = true;
        else d.sure = toks.includes(d.front) && fam.every(p => S.lev(p, d.front) >= 3);
      }
      if (d.gone) m.found[d.f] = true;
    }
    m.diff = m.diff.filter(d => !d.gone);
    m.got = Object.keys(m.found).filter(k => m.found[k]);
  }
  return { m, rot, canvas: c, words };
}
/* what the server is told about the front (no picture coordinates, nothing else read from it) */
const idkFrontSend = m => ({ mode: 'auto', found: m.found, readable: m.readable, n: m.n, diff: (m.diff || []).map(d => ({ f: d.f, front: d.front, back: d.back, sure: !!d.sure })) });
/* the values of the back the front is compared with */
async function idkBackValues(read) {
  const S = await idkLib();
  if (read.bar) return S.parseAamva(read.bar);
  if (read.mrz && read.mrz.lines) return S.parseTd1(read.mrz.lines);
  return null;
}
/* how sharp a camera frame is (mean Laplacian of its middle) */
function idkSharp(im) {
  const { w, h, g } = im;
  let s = 0;
  let n = 0;
  for (let y = Math.floor(h * 0.25); y < h * 0.75; y += 2) {
    for (let x = Math.floor(w * 0.25); x < w * 0.75; x += 2) {
      const i = y * w + x;
      s += Math.abs(4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w]);
      n++;
    }
  }
  return n ? s / n : 0;
}

/* ---------- the camera: the back read live, then the front taken when it is still and sharp ---------- */
// want: 'back' (the green card's lines and/or the license barcode are read from the moving picture) or 'front'.
// onBack(canvas, {mrz} | {bar}) and onFront(canvas) receive the full-size frame. note: a line under the picture.
function IdLiveScan({ want, kinds, onBack, onFront, onClose, note, paused }) {
  const vid = useRef(null);
  const ov = useRef(null);
  const st = useRef({ busy: false, frames: 0, stable: 0, sharpMax: 0, last: null, since: Date.now(), reset: true, want, paused });
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [flash, setFlash] = useState(false);
  const ks = kinds && kinds.length ? kinds : ['gc', 'dl'];
  if (st.current.want !== want) {
    st.current.want = want;
    st.current.since = Date.now();
    st.current.stable = 0;
    st.current.reset = true;
  }
  st.current.paused = paused;
  const drawQuad = (q, good) => {
    const c = ov.current;
    const v = vid.current;
    if (!c || !v || !v.videoWidth) return;
    const W = c.clientWidth;
    const H = c.clientHeight;
    if (c.width !== W) c.width = W;
    if (c.height !== H) c.height = H;
    const x = c.getContext('2d');
    x.clearRect(0, 0, W, H);
    if (!q) return;
    const k = Math.min(W / v.videoWidth, H / v.videoHeight);
    const ox = (W - v.videoWidth * k) / 2;
    const oy = (H - v.videoHeight * k) / 2;
    x.strokeStyle = good ? '#16a34a' : '#f59e0b';
    x.lineWidth = 3;
    x.beginPath();
    q.forEach(([px, py], i) => (i ? x.lineTo(ox + px * k, oy + py * k) : x.moveTo(ox + px * k, oy + py * k)));
    x.closePath();
    x.stroke();
  };
  const snap = () => {
    const v = vid.current;
    const c = idsTurn(v, 0, 1);
    setFlash(true);
    setTimeout(() => setFlash(false), 180);
    try {
      navigator.vibrate && navigator.vibrate(40);
    } catch (e) {
      /* no vibration */
    }
    return c;
  };
  // the loop below runs from the first render: it always calls the latest step (with the latest props)
  const stepRef = useRef(null);
  stepRef.current = async v => {
    const S = st.current;
    S.frames++;
    if (S.paused) return;
    if (S.want === 'back') {
      if (ks.includes('gc')) {
        const im = idkGray(v, 1280);
        const r = await idkAsk({ op: 'live', w: im.w, h: im.h, g: im.g, reset: S.reset });
        S.reset = false;
        if (S.want !== 'back' || S.paused) return;
        drawQuad(r && r.found && r.quad ? r.quad.map(([x, y]) => [x / im.k, y / im.k]) : null, r && r.ok);
        if (r && r.ok) {
          setMsg('');
          onBack(snap(), { mrz: r });
          return;
        }
        setMsg(r && r.found ? 'Hold still: reading the lines…' : '');
      }
      if (ks.includes('dl') && S.frames % 3 === 0) {
        const c = idsTurn(v, 0, 1);
        const t = await idsDecode(c, true).catch(() => '');
        if (t && /ANSI |AAMVA/.test(t) && S.want === 'back' && !S.paused) {
          onBack(c, { bar: t });
          return;
        }
      }
    } else if (S.want === 'front') {
      drawQuad(null);
      // still and sharp for about half a second (and not straight after turning the card over)
      const im = idkGray(v, 360);
      const sharp = idkSharp(im);
      let moved = 255;
      if (S.last && S.last.length === im.g.length) {
        let d = 0;
        for (let i = 0; i < im.g.length; i += 3) d += Math.abs(im.g[i] - S.last[i]);
        moved = d / (im.g.length / 3);
      }
      S.last = im.g.slice();
      S.sharpMax = Math.max(S.sharpMax * 0.97, sharp);
      const ready = Date.now() - S.since > 1400 && moved < 3.5 && sharp > 2.5 && sharp >= S.sharpMax * 0.8;
      S.stable = ready ? S.stable + 1 : 0;
      if (S.stable >= 4) {
        S.stable = 0;
        S.since = Date.now();
        onFront(snap());
      }
    }
  };
  useEffect(() => {
    let stream = null;
    let alive = true;
    let timer = null;
    (async () => {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw { name: 'NoCamera' };
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        if (!alive) return;
        const v = vid.current;
        v.srcObject = stream;
        await v.play();
        try {
          const t = stream.getVideoTracks()[0];
          const caps = t.getCapabilities ? t.getCapabilities() : {};
          if (caps.focusMode && caps.focusMode.includes('continuous')) await t.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
        } catch (e) {
          /* the camera focuses on its own */
        }
        const tick = async () => {
          if (!alive) return;
          const v2 = vid.current;
          if (v2 && v2.videoWidth && !st.current.busy) {
            st.current.busy = true;
            try {
              await stepRef.current(v2);
            } catch (e) {
              /* one frame missed */
            }
            st.current.busy = false;
          }
          timer = setTimeout(tick, 90);
        };
        tick();
      } catch (e) {
        setErr(e && e.name === 'NotAllowedError' ? 'The browser was not allowed to use the camera. Allow it (the camera sign in the address bar), or add pictures instead.' : 'No camera could be opened here. Add pictures instead.');
      }
    })();
    return () => {
      alive = false;
      clearTimeout(timer);
      if (stream) stream.getTracks().forEach(t => t.stop());
    };
  }, []);
  const take = () => {
    const v = vid.current;
    if (!v || !v.videoWidth) return;
    const c = snap();
    if (want === 'front') onFront(c);
    else onBack(c, {});
  };
  const gcOnly = ks.length === 1 && ks[0] === 'gc';
  const dlOnly = ks.length === 1 && ks[0] === 'dl';
  const hint =
    want === 'front'
      ? 'Now the front: fill the frame with the card and hold it still. The picture is taken by itself.'
      : gcOnly
        ? 'The back of the green card: fill the frame, the three lines of letters and numbers at the bottom. They are read by themselves.'
        : dlOnly
          ? 'The back of the license: fill the frame with the barcode. It is read by itself.'
          : 'The back of the card: the barcode of a license, or the three lines at the bottom of a green card. They are read by themselves.';
  return html`<div className="idscam">
      ${
        err
          ? html`<div className="note red"><span>${err}</span></div>`
          : html`<div className=${'idscamv' + (flash ? ' flash' : '')}>
              <video ref=${vid} playsInline muted aria-label="Camera" />
              <canvas ref=${ov} className="idscamov" aria-hidden="true" />
              <div className=${'idscamguide ' + want + (gcOnly && want === 'back' ? ' gc' : '')} aria-hidden="true"><i /></div>
              ${(msg || paused) && html`<div className="idscammsg">${paused || msg}</div>`}
            </div>`
      }
      <p className="small idscamhint"><b>${want === 'front' ? 'Front' : 'Back'}.</b> ${hint}${note ? ' ' + note : ''}</p>
      <div className="actions" style=${{ justifyContent: 'flex-start' }}>
        <button type="button" className="btn ghost sm" disabled=${!!err || !!paused} onClick=${take}><${Icon} n="camera" />Take the picture now</button>
        <button type="button" className="btn ghost sm" onClick=${onClose}>Close the camera</button>
      </div>
    </div>`;
}

/* ---------- the page an ID link opens (no account needed) ---------- */
const IDQ_KIND = { gc: 'Green card (Permanent Resident Card)', dl: "Driver's license or state ID" };
function IdLinkPage({ q }) {
  const t = (q && q.t) || '';
  const toast = useToast();
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState('');
  const [kind, setKind] = useState('');
  const [agree, setAgree] = useState(false);
  const [mode, setMode] = useState(''); // camera | upload
  const [back, setBack] = useState(null); // {canvas, url, read, vals}
  const [front, setFront] = useState(null); // {canvas, url, m}
  const [work, setWork] = useState('');
  const [bad, setBad] = useState({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const urls = useRef([]);
  useEffect(() => {
    if (!/^[a-f0-9]{16}\.[a-f0-9]{24}$/.test(t)) {
      setErr('This link is not complete. Open it from the email again.');
      return;
    }
    api('idq_get', { t }).then(
      v => {
        setInfo(v);
        if (v.kind !== 'any') setKind(v.kind);
      },
      e => setErr(errText(e))
    );
    // start loading the readers while the person reads the page
    idkLib().catch(() => {});
    return () => urls.current.forEach(u => URL.revokeObjectURL(u));
  }, [t]);
  const urlOf = async canvas => {
    const blob = await idsBlob(canvas);
    const u = URL.createObjectURL(blob);
    urls.current.push(u);
    return { blob, url: u };
  };
  const kinds = kind ? [kind] : ['gc', 'dl'];
  // the back: read, or refused with what to do
  const takeBack = async (canvas, read) => {
    setWork('Reading the back…');
    try {
      let r = read && (read.mrz || read.bar) ? read : await idkBack(canvas, kinds);
      const ok = kind === 'dl' ? !!r.bar : kind === 'gc' ? idkMrzUsable(r.mrz) : !!r.bar || idkMrzUsable(r.mrz);
      if (!ok) {
        setBad(b => ({ ...b, back: kind === 'dl' || (!kind && !(r.mrz && r.mrz.found)) ? "The barcode on the back could not be read. Lay the card flat in good light, fill the frame with the barcode, and avoid glare." : 'The three lines at the bottom of the back could not be read. Take the picture in good light, without glare or shadow, with the whole card sharp.' }));
        setWork('');
        return false;
      }
      if (!r.bar && r.mrz && r.mrz.found && !r.mrz.ok) {
        // read clearly but a check digit fails: the card's own lines; sent as they are
      }
      const vals = await idkBackValues(r.bar ? { bar: r.bar } : { mrz: r.mrz });
      const { blob, url } = await urlOf(canvas);
      setBack({ canvas, blob, url, read: r, vals, kind: r.bar ? 'dl' : 'gc' });
      if (!kind) setKind(r.bar ? 'dl' : 'gc');
      setBad(b => ({ ...b, back: '' }));
      setWork('');
      return true;
    } catch (e) {
      setWork('');
      toast(errText(e), true);
      return false;
    }
  };
  const takeFront = async canvas => {
    setWork('Reading the front…');
    try {
      const r = await idkFront(canvas, back ? back.vals : null);
      if (!r.m.readable) {
        setBad(b => ({ ...b, front: 'The front could not be read. Hold the card flat and still in good light, without glare, the whole card in the picture.' }));
        setWork('');
        return false;
      }
      const { blob, url } = await urlOf(r.canvas);
      setFront({ canvas: r.canvas, blob, url, m: r.m });
      setBad(b => ({ ...b, front: '' }));
      setWork('');
      return true;
    } catch (e) {
      setWork('');
      toast(errText(e), true);
      return false;
    }
  };
  const pick = async (files, side) => {
    const f = files && files[0];
    if (!f) return;
    try {
      const pages = await idsPages(f);
      if (side === 'back') {
        for (const c of pages) if (await takeBack(c)) break;
      } else await takeFront(pages[0]);
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const send = async () => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('t', t);
      fd.append('consent', agree ? '1' : '');
      fd.append('kind', back.kind);
      let barHash = '';
      if (back.read.bar && window.crypto && crypto.subtle) {
        const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(back.read.bar));
        barHash = Array.from(new Uint8Array(h), b => b.toString(16).padStart(2, '0')).join('');
      }
      fd.append('claim', JSON.stringify({ mrz: back.read.bar ? [] : back.read.mrz.lines, bar: barHash, how: mode }));
      fd.append('img[]', back.blob, 'back.jpg');
      fd.append('side[]', 'back');
      fd.append('img[]', front.blob, 'front.jpg');
      fd.append('side[]', 'front');
      await upload('idq_send', fd, null, { timeout: 180000 });
      setDone(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const shell = body => html`<${Fragment}>
      <${PageHead} title="Verify your ID" intro=${info ? info.org + ' asked you to verify your ID. It takes about a minute.' : 'A secure link to verify your ID.'} />
      <section className="sec"><div className="wrap idlink" style=${{ maxWidth: 760 }}>${body}</div></section>
    <//>`;
  if (err) return shell(html`<div className="note red"><span>${err}</span></div>`);
  if (!info) return shell(html`<${Spinner} />`);
  if (done)
    return shell(html`<div className="panel stack" style=${{ gap: 10 }}>
        <h2>Thank you${info.first ? ', ' + info.first : ''}. Your ID was sent.</h2>
        <p>${info.org} has the pictures of your ID. You can close this page; the link no longer works.</p>
      </div>`);
  const ready = !!(back && front && agree);
  const step = !kind || !agree ? 1 : !back ? 2 : !front ? 3 : 4;
  return shell(html`<div className="stack" style=${{ gap: 14 }}>
      <div className="panel stack" style=${{ gap: 12 }}>
        <p>Hi${info.first ? ' ' + info.first : ''}, ${info.by || 'someone'} at ${info.org} asked you to verify your ID. ${info.note ? html`<br /><span className="muted">“${info.note}”</span>` : ''}</p>
        ${
          info.kind === 'any'
            ? html`<div className="stack" style=${{ gap: 6 }}>
                <span className="lbl">Which ID are you sending?</span>
                <div className="seg" role="group" aria-label="Which ID">${Object.entries(IDQ_KIND).map(([k, v]) => html`<button key=${k} type="button" className=${kind === k ? 'on' : ''} disabled=${!!back} onClick=${() => setKind(k)}>${v}</button>`)}</div>
              </div>`
            : html`<p><b>${IDQ_KIND[info.kind]}</b> is asked for.</p>`
        }
        <label className="check"><input type="checkbox" checked=${agree} onChange=${e => setAgree(e.target.checked)} /><span>I agree that ${info.org} receives pictures of the front and the back of my ID to check that it is genuine, and keeps them for up to ${info.keep} days.</span></label>
        <p className="muted small">The pictures are read on this phone or computer, then sent over a secure connection to ${info.org} only. Not used for anything else.</p>
      </div>
      ${
        step >= 2 &&
        html`<div className="panel stack" style=${{ gap: 12 }}>
          <h2 style=${{ margin: 0 }}>${back && front ? 'Ready to send' : 'Scan your ' + (kind === 'gc' ? 'green card' : "license or state ID")}</h2>
          ${
            !mode &&
            !(back && front) &&
            html`<div className="idlinkopts">
              <button type="button" className="btn" onClick=${() => setMode('camera')}><${Icon} n="camera" />Scan it with the camera</button>
              <button type="button" className="btn ghost" onClick=${() => setMode('upload')}><${Icon} n="up" />Upload pictures instead</button>
            </div>`
          }
          ${
            mode === 'camera' &&
            !(back && front) &&
            html`<${IdLiveScan} want=${back ? 'front' : 'back'} kinds=${kinds} paused=${work} onBack=${(c, r) => takeBack(c, r)} onFront=${c => takeFront(c)} onClose=${() => setMode('')} note=${bad[back ? 'front' : 'back'] || ''} />`
          }
          ${
            mode === 'upload' &&
            html`<div className="idlinkup">
              ${['back', 'front'].map(
                side => html`<label key=${side} className=${'idsdrop' + ((side === 'back' ? back : front) ? ' done' : '')}>
                  <input type="file" accept="image/*,application/pdf" disabled=${!!work || (side === 'front' && !back)} onChange=${e => { pick(e.target.files, side); e.target.value = ''; }} />
                  ${(side === 'back' ? back : front) ? html`<img src=${(side === 'back' ? back : front).url} alt=${side} />` : html`<${Icon} n="file" />`}
                  <b>${side === 'back' ? '1. The back' : '2. The front'}${(side === 'back' ? back : front) ? ' ✓' : ''}</b>
                  <span>${side === 'front' && !back ? 'After the back' : (side === 'back' ? back : front) ? 'Read. Tap to choose another picture.' : 'Tap to take a photo or choose one'}</span>
                </label>`
              )}
            </div>`
          }
          ${work && html`<p className="muted small" role="status"><span className="spin sm" /> ${work}</p>`}
          ${(bad.back || bad.front) && !work && html`<div className="note amber"><span>${bad.back || bad.front}</span></div>`}
          ${
            back &&
            front &&
            html`<div className="idspics">${[back, front].map((x, i) => html`<div key=${i} className="idspic found"><img src=${x.url} alt=${i ? 'Front' : 'Back'} /><div className="idspicf"><span className="small"><b>${i ? 'Front' : 'Back'}</b> · read</span><button type="button" className="btn ghost sm" onClick=${() => { if (i) setFront(null); else { setBack(null); setFront(null); } }}>Retake</button></div></div>`)}</div>`
          }
        </div>`
      }
      ${
        step === 4 &&
        html`<div className="actions" style=${{ justifyContent: 'flex-start' }}>
          <button className="btn" disabled=${busy || !ready} onClick=${send}><${Icon} n="send" />${busy ? 'Sending…' : 'Send to ' + info.org}</button>
        </div>`
      }
    </div>`);
}
