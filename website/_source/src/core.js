
const { useState, useEffect, useMemo, useRef, useCallback, createContext, useContext, Fragment } = React;
try { const t = localStorage.getItem('theme'); if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t); } catch (e) { /* storage blocked */ }
const themeNow = () => document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
function setTheme(t) { document.documentElement.setAttribute('data-theme', t); try { localStorage.setItem('theme', t); } catch (e) {} }
const html = htm.bind(React.createElement);

/* ================= Company facts ================= */
const CO = {
  name: 'StratEdge IT Consulting',
  legal: 'StratEdge IT Consulting Inc.',
  phone: '+1 (302) 434-8889', tel: '+13024348889',
  email: 'info@stratedgeitconsulting.com',
  hours: 'Mon–Fri, 9 AM–7 PM',
  addr1: '1553 Route 27, Suite 1000', addr2: 'Somerset, NJ 08873',
  map: 'https://maps.app.goo.gl/7Bm8MdkeHx6ifoxMA',
  linkedin: 'https://www.linkedin.com/company/stratedge-it-consulting-inc/',
  site: 'https://stratedgeitconsulting.com',
};

/* ================= Date & number helpers ================= */
const pad = n => String(n).padStart(2, '0');
const dkey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseD = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (k, n) => { const d = parseD(k); d.setDate(d.getDate() + n); return dkey(d); };
const weekStart = (k = dkey()) => { const d = parseD(k); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return dkey(d); };
const weekDays = ws => Array.from({ length: 7 }, (_, i) => addDays(ws, i));
const mkey = k => k.slice(0, 7);
const addMonths = (mk, n) => { const [y, m] = mk.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const monthLabel = mk => { const [y, m] = mk.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString([], { month: 'long', year: 'numeric' }); };
const fmtTime = ts => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtDate = (k, o) => parseD(k).toLocaleDateString([], o || { weekday: 'short', month: 'short', day: 'numeric' });
const fmtTs = ts => new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const fmtDay = ts => new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
const weekLabel = ws => `${fmtDate(ws, { month: 'short', day: 'numeric' })} – ${fmtDate(addDays(ws, 6), { month: 'short', day: 'numeric', year: 'numeric' })}`;
const mins = (a, b) => Math.max(0, ((b == null ? Date.now() : b) - a) / 60000);
const hm = m => { m = Math.round(m); return `${Math.floor(m / 60)}h ${pad(m % 60)}m`; };
const hrs = m => (m / 60).toFixed(2);
const h1 = n => (Math.round((+n || 0) * 100) / 100).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
const toLocalInput = ts => { const d = new Date(ts); return `${dkey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fromLocalInput = s => { if (!s) return NaN; const [d, t] = s.split('T'); const [y, m, dd] = d.split('-').map(Number); const [hh, mi] = (t || '0:0').split(':').map(Number); return new Date(y, m - 1, dd, hh, mi).getTime(); };
const bizDays = (f, t) => { if (!f || !t || t < f) return 0; let n = 0; for (let k = f; k <= t; k = addDays(k, 1)) { const wd = parseD(k).getDay(); if (wd && wd < 6) n++; } return n; };
const nid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-5);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clean = o => JSON.parse(JSON.stringify(o));
const firstName = n => (n || '').trim().split(/\s+/)[0] || '';
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
const sizeLabel = b => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
async function pMap(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

/* ================= Native backend (PHP API) ================= */
const API = (typeof API_BASE === 'string' ? API_BASE : 'api/index.php?r=');
const LOGIN = '#/login';
async function api(route, body) {
  const isForm = body instanceof FormData;
  const res = await fetch(API + route, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'X-Requested-With': 'fetch', ...(body === undefined || isForm ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : (isForm ? body : JSON.stringify(body)) });
  let j = null; try { j = await res.json(); } catch (e) { /* non-JSON */ }
  if (!res.ok) {
    if (res.status === 401 && Cap.state === 'ready') { Cap.state = 'noid'; Cap.me = null; Cap.uid = null; Cap.isAdmin = false; capNotify(); location.hash = '#/login?expired=1'; }
    throw { code: (j && j.error) || (res.status === 403 ? 'invalid_argument' : 'unavailable'), message: (j && j.message) || 'The server could not be reached.' };
  }
  return j;
}
function upload(route, form, onProgress) {
  return new Promise((res, rej) => {
    const x = new XMLHttpRequest(); x.open('POST', API + route); x.setRequestHeader('X-Requested-With', 'fetch'); x.withCredentials = true;
    x.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(Math.min(0.98, e.loaded / e.total)); };
    x.onload = () => { let j = null; try { j = JSON.parse(x.responseText); } catch (e) {} if (x.status >= 200 && x.status < 300) res(j); else rej({ code: (j && j.error) || 'unavailable', message: (j && j.message) || 'Upload failed.' }); };
    x.onerror = () => rej({ code: 'unavailable', message: 'Upload failed. Check your connection and try again.' });
    x.send(form);
  });
}
const avatarFor = (name, id) => { let h = 0; for (const ch of String(id || name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0; const hue = h % 360; const ini = String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';
  return { url: 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="32" fill="hsl(${hue} 45% 42%)"/><text x="32" y="40" font-family="Arial,sans-serif" font-size="26" font-weight="700" text-anchor="middle" fill="#fff">${ini}</text></svg>`), color: `hsl(${hue} 45% 42%)` }; };

/* Live updates: every open subscription is refreshed in one request, a few seconds apart, and right after any write. */
const POLL = typeof POLL_MS === 'number' ? POLL_MS : 6000;
const docSnap = (path, e, d) => ({ id: path.split('/').pop(), exists: !!e, data: () => (e ? d : undefined), metadata: { fromCache: false, hasPendingWrites: false } });
const colSnap = docs => { const ds = (docs || []).map(([id, d]) => ({ id, exists: true, data: () => d, metadata: { fromCache: false, hasPendingWrites: false } })); return { docs: ds, size: ds.length, empty: !ds.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } }; };
const Sync = {
  subs: new Map(), t: null, busy: false, pending: false, n: 0,
  key: q => [q.t, q.p, q.o || '', q.d || '', q.l || ''].join('|'),
  on(q, cb) {
    const k = this.key(q); let s = this.subs.get(k);
    if (!s) { s = { q, cbs: new Set(), v: null, res: null }; this.subs.set(k, s); }
    s.cbs.add(cb); if (s.res) cb(s.res); this.kick(30);
    return () => { s.cbs.delete(cb); if (!s.cbs.size) this.subs.delete(k); };
  },
  kick(ms) { clearTimeout(this.t); this.t = setTimeout(() => this.poll(), ms == null ? 200 : ms); },
  schedule() { clearTimeout(this.t); this.t = setTimeout(() => this.poll(), POLL); },
  async poll() {
    if (this.busy) { this.pending = true; return; }
    const list = [...this.subs.values()];
    if (!list.length || (document.hidden && !this.pending)) { this.schedule(); return; }
    this.busy = true;
    try {
      const out = await api('batch', { q: list.map(s => ({ ...s.q, v: s.v })) });
      (out.r || []).forEach((r, i) => {
        const s = list[i]; if (!s || this.subs.get(this.key(s.q)) !== s) return;
        if (r.err) { s.cbs.forEach(cb => cb(null, { code: 'invalid_argument', message: r.err })); return; }
        if (r.same) return;
        s.v = r.v; s.res = s.q.t === 'doc' ? docSnap(s.q.p, r.e, r.d) : colSnap(r.docs);
        s.cbs.forEach(cb => cb(s.res));
      });
    } catch (e) { /* network hiccup: next poll will retry */ }
    this.busy = false;
    if (++this.n % 10 === 0 && Cap.state === 'ready') { const was = Cap.roleName; reloadCaps().then(() => { if (Cap.roleName !== was && Cap.state === 'ready') location.reload(); }); }
    if (this.pending) { this.pending = false; this.kick(150); } else this.schedule();
  },
};
document.addEventListener('visibilitychange', () => { if (!document.hidden) Sync.kick(0); });
function chkPath(p, doc) {
  const segs = p.split('/');
  if (!p || segs.some(s => !s || !/^[A-Za-z0-9_\-.~:@+]+$/.test(s)) || (doc && segs.length % 2) || (!doc && !(segs.length % 2))) throw new TypeError('Bad path: ' + p);
}
function docRef(path) {
  chkPath(path, true);
  return { id: path.split('/').pop(), path,
    get: async () => { const r = await api('doc&path=' + encodeURIComponent(path)); return docSnap(path, r.e, r.d); },
    set: async data => { await api('set', { path, data }); Sync.kick(); },
    update: async data => { await api('update', { path, data }); Sync.kick(); },
    delete: async () => { await api('delete', { path }); Sync.kick(); },
    onSnapshot: (next, err) => Sync.on({ t: 'doc', p: path }, (res, e) => (e ? err && err(e) : next(res))),
    collection: sub => colRef(path + '/' + sub, {}) };
}
function colRef(path, q) {
  chkPath(path, false);
  return { path,
    where: () => colRef(path, q), orderBy: (f, d) => colRef(path, { ...q, o: f, d: d || 'asc' }), limit: n => colRef(path, { ...q, l: n }),
    get: async () => { const r = await api('col&path=' + encodeURIComponent(path) + (q.o ? '&o=' + encodeURIComponent(q.o) + '&d=' + (q.d || 'asc') : '') + (q.l ? '&l=' + q.l : '')); return colSnap(r.docs); },
    onSnapshot: (next, err) => Sync.on({ t: 'col', p: path, o: q.o, d: q.d, l: q.l }, (res, e) => (e ? err && err(e) : next(res))),
    doc: id => docRef(path + '/' + (id || nid())), add: async d => { const ref = docRef(path + '/' + nid()); await ref.set(d); return ref; } };
}
const NativeDB = { doc: p => docRef(p), collection: p => colRef(p, {}) };
const NativeUser = {
  me: async () => Cap.me || { id: null, name: '', avatarUrl: avatarFor('', '').url, color: '', email: null, isOwner: false, canEdit: false },
  id: async () => Cap.uid, isOwner: async () => Cap.isAdmin, canEdit: async () => Cap.isAdmin, can: async () => !!Cap.uid,
  profiles: async ids => { const list = [...new Set((Array.isArray(ids) ? ids : [ids]).filter(Boolean))]; const out = {}; let got = {};
    try { got = (await api('profiles', { ids: list })).profiles || {}; } catch (e) { /* unresolved */ }
    list.forEach(id => { const n = (got[id] && got[id].name) || ''; const a = avatarFor(n, id); out[id] = { id, name: n, avatarUrl: a.url, color: a.color, email: null, isMe: id === Cap.uid, guest: false }; });
    return out; },
  search: async () => [],
};
const NativeDL = { save: async ({ filename, data }) => {
  const blob = data instanceof Blob ? data : new Blob([data]); const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000); return { status: 'saved' }; } };

const Cap = { state: 'loading', db: NativeDB, user: NativeUser, dl: NativeDL, me: null, uid: null, isAdmin: false, isHR: false, roleName: '', isOwner: false, canWrite: null, portal: '', jobs: false };
const PORTAL_LABEL = { consultant: 'Consultant portal', employee: 'Employee portal', employer: 'Client portal', client: 'Client portal' };
const portalLabel = role => PORTAL_LABEL[role] || 'Employee portal';
const portalKeyOf = role => role === 'employer' ? 'client' : role === 'employee' ? 'employee' : 'consultant';
const capListeners = new Set();
const capNotify = () => capListeners.forEach(f => f({ ...Cap }));
async function reloadCaps() {
  try {
    const r = await api('me'); const u = r && r.user; Cap.portal = (r && r.portal) || ''; Cap.jobs = !!(r && r.jobs);
    if (u) { const staff = ['admin', 'hr', 'acct'].includes(u.role); const a = avatarFor(u.name, u.id); Cap.me = { id: u.id, name: u.name, email: u.email, avatarUrl: a.url, color: a.color, isOwner: u.role === 'admin', canEdit: staff }; Cap.uid = u.id; Cap.isAdmin = staff; Cap.isHR = u.role === 'hr'; Cap.isAcct = u.role === 'acct'; Cap.roleName = u.role; Cap.isOwner = u.role === 'admin'; Cap.canWrite = true; Cap.state = 'ready'; }
    else { Cap.me = null; Cap.uid = null; Cap.isAdmin = false; Cap.isHR = false; Cap.isAcct = false; Cap.roleName = ''; Cap.isOwner = false; Cap.canWrite = null; Cap.state = 'noid'; }
  } catch (e) { Cap.state = 'none'; }
  capNotify(); return Cap;
}
const capsReady = reloadCaps();
async function logout() { try { await api('logout', {}); } catch (e) { /* already out */ } Sync.subs.clear(); await reloadCaps(); location.hash = '#/'; }
function useCaps() {
  const [c, setC] = useState(Cap.state === 'loading' ? null : { ...Cap });
  useEffect(() => { let on = true; const f = v => on && setC(v.state === 'loading' ? null : v); capListeners.add(f); capsReady.then(() => on && setC({ ...Cap })); return () => { on = false; capListeners.delete(f); }; }, []);
  return c;
}

/* ================= Data layer ================= */
const _q = new Map();
function serial(key, fn) { const p = (_q.get(key) || Promise.resolve()).catch(() => {}).then(fn); _q.set(key, p); return p; }
async function retry(fn) {
  try { return await fn(); }
  catch (e) { if (e && e.code === 'unavailable') { await sleep(400 + Math.random() * 600); return fn(); } throw e; }
}
const dbSet = (path, data) => serial(path, () => retry(() => Cap.db.doc(path).set(clean(data))));
const dbMerge = (path, patch) => serial(path, () => retry(async () => {
  const ref = Cap.db.doc(path); const s = await ref.get();
  return s.exists ? ref.update(clean(patch)) : ref.set(clean(patch));
}));
const dbDel = path => serial(path, () => retry(() => Cap.db.doc(path).delete()));
const dbGet = async path => { const s = await retry(() => Cap.db.doc(path).get()); return s.exists ? s.data() : null; };
const dbList = async (path, build) => {
  let q = Cap.db.collection(path); if (build) q = build(q);
  const s = await retry(() => q.get()); return s.docs.map(d => ({ id: d.id, ...d.data() }));
};

function useDoc(path) {
  const [st, setSt] = useState({ data: undefined, exists: false, loading: !!path, for: path });
  useEffect(() => {
    if (!path || !Cap.db) { setSt({ data: undefined, exists: false, loading: false, for: path }); return; }
    let live = true, un = () => {};
    setSt({ data: undefined, exists: false, loading: true, for: path });
    const fallback = setTimeout(() => live && setSt(s => s.loading && s.for === path ? { ...s, loading: false } : s), 6000);
    try {
      un = Cap.db.doc(path).onSnapshot(snap => {
        if (!live) return;
        const definitive = !snap.metadata || !snap.metadata.fromCache;
        if (!snap.exists && !definitive) return; // wait for the server before treating it as missing
        setSt({ data: snap.exists ? snap.data() : undefined, exists: snap.exists, loading: false, for: path });
      }, err => { console.warn('doc', path, err); live && setSt({ data: undefined, exists: false, loading: false, error: err, for: path }); });
    } catch (e) { console.warn(e); setSt({ data: undefined, exists: false, loading: false, error: e, for: path }); }
    return () => { live = false; clearTimeout(fallback); un(); };
  }, [path]);
  return st.for === path ? st : { data: undefined, exists: false, loading: !!path, for: path };
}
function useCol(path, order, limit) {
  const key = path ? `${path}|${order || ''}|${limit || ''}` : '';
  const [st, setSt] = useState({ docs: [], loading: !!path, for: key });
  useEffect(() => {
    if (!path || !Cap.db) { setSt({ docs: [], loading: false, for: key }); return; }
    let live = true, un = () => {};
    setSt({ docs: [], loading: true, for: key });
    try {
      let q = Cap.db.collection(path);
      if (order) { const [f, dir] = order.split(':'); q = q.orderBy(f, dir || 'asc'); }
      if (limit) q = q.limit(limit);
      un = q.onSnapshot(snap => { if (live) setSt({ docs: snap.docs.map(d => ({ id: d.id, ...d.data() })), loading: false, for: key }); },
        err => { console.warn('col', path, err); live && setSt({ docs: [], loading: false, error: err, for: key }); });
    } catch (e) { console.warn(e); setSt({ docs: [], loading: false, error: e, for: key }); }
    return () => { live = false; un(); };
  }, [key]);
  return st.for === key ? st : { docs: [], loading: !!path, for: key };
}
function usePeople(ids) {
  const key = [...new Set((ids || []).filter(Boolean))].sort().join(',');
  const [map, setMap] = useState({});
  useEffect(() => {
    let live = true;
    if (!Cap.user || !key) return;
    Cap.user.profiles(key.split(',')).then(m => live && setMap(m || {})).catch(() => {});
    return () => { live = false; };
  }, [key]);
  return map;
}
function useNow(ms) {
  const [n, setN] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setN(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return n;
}

function errText(e) {
  const c = e && e.code;
  if (c === 'invalid_argument') return "That change wasn't saved because your access level doesn't allow it.";
  if (c === 'quota_exceeded') return 'Storage is full. Ask an admin to remove old files.';
  if (c === 'resource_exhausted' || c === 'rate_limited') return 'Too many requests at once. Wait a moment, then try again.';
  if (c === 'revoked') return 'Your access to this page changed. Reload the page to continue.';
  if (c === 'unavailable' || c === 'not_granted' || c === 'capability_disabled') return "Couldn't reach the server. Check your connection and try again.";
  if (c === 'declined') return 'Download cancelled.';
  if (c === 'rejected_extension' || c === 'extension_not_enabled') return "This file type can't be downloaded here.";
  return (e && e.message) || 'Something went wrong. Try again.';
}

/* ================= File storage (uploads kept on the server) ================= */
const MAX_FILE = 10 * 1024 * 1024;
const MIME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', csv: 'text/csv', txt: 'text/plain',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.gif,.xlsx,.docx,.csv,.txt';
const extOf = n => ((n || '').split('.').pop() || '').toLowerCase();
async function shrinkImage(file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size <= 2.5 * 1048576) return file;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(bmp, 0, 0, cv.width, cv.height);
    const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.88));
    if (blob && blob.size < file.size) return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch (e) { /* keep original */ }
  return file;
}
async function storeFile(base, file, meta, onProgress) {
  const ext = extOf(file.name);
  if (!MIME[ext]) throw { message: `${ext ? '.' + ext : 'That'} file type isn't supported. Upload a PDF, image, Excel (.xlsx), Word (.docx), CSV or text file.` };
  file = await shrinkImage(file);
  if (!file.size) throw { message: 'That file is empty.' };
  if (file.size > MAX_FILE) throw { message: `That file is ${sizeLabel(file.size)}. The limit is 10 MB, so save it as a smaller PDF or image.` };
  const fd = new FormData(); fd.append('base', base); fd.append('meta', JSON.stringify(meta || {})); fd.append('file', file, file.name);
  const r = await upload('upload', fd, onProgress); Sync.kick(); onProgress && onProgress(1);
  return r.doc;
}
const fileUrl = (base, fid, dl, tok) => API + 'file&base=' + encodeURIComponent(base) + '&id=' + encodeURIComponent(fid) + (dl ? '&dl=1' : '') + (tok ? '&tok=' + encodeURIComponent(tok) : '');
async function downloadStored(base, fid) { const a = document.createElement('a'); a.href = fileUrl(base, fid, true); a.download = ''; document.body.appendChild(a); a.click(); a.remove(); return { status: 'saved' }; }
async function previewUrl(base, fid) { const m = await dbGet(`${base}/f/${fid}`); if (!m) throw { message: 'This file is no longer available.' }; return { url: fileUrl(base, fid, false), meta: m }; }
async function deleteStored(base, fid) { await api('delfile', { base, id: fid }); Sync.kick(); }
async function saveDownload(filename, data) { return NativeDL.save({ filename, data }); }
const toCSV = rows => rows.map(r => r.map(v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\n');

/* ================= Timesheet status ================= */
const TS_LABEL = { none: 'Not started', draft: 'Draft', pending: 'Awaiting approval', approved: 'Approved', rejected: 'Returned', reopened: 'Reopened' };
function tsStatus(sum, rev) {
  if (!sum) return 'none';
  if (rev && rev.v === sum.u) { if (rev.s === 'reopened') return 'reopened'; if (sum.s === 'submitted') return rev.s; }
  return sum.s === 'submitted' ? 'pending' : (rev && rev.s === 'rejected' ? 'rejected' : 'draft');
}
const TASK_S = { todo: 'To do', doing: 'In progress', blocked: 'Blocked', done: 'Done' };
const LEAVE_K = { pto: 'Paid time off', sick: 'Sick leave', unpaid: 'Unpaid leave', other: 'Other' };
const MODES = { office: 'Office', remote: 'Remote', client: 'Client site' };
const EMP_TYPES = ['C2C', 'W2', '1099', 'Full-time', 'Contract-to-hire'];
const DOC_CATS = { timesheet: 'Signed timesheet', invoice: 'Invoice', agreement: 'Agreement / MSA', insurance: 'Insurance (COI)', tax: 'Tax form (W-9)', resume: 'Resume', other: 'Other' };
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/* ================= HR and recruiting ================= */
const AUTH_TYPES = ['US citizen', 'Green card', 'H-1B', 'H4 EAD', 'OPT / CPT', 'L2 EAD', 'TN', 'GC EAD', 'Other'];
const CAND_STATUS = { active: 'Available', working: 'In process', placed: 'Placed', hold: 'On hold', inactive: 'Inactive' };
const SUB_ST = { submitted: 'Submitted', screening: 'Screening', interview: 'Interview', offer: 'Offer', placed: 'Placed', rejected: 'Rejected', withdrawn: 'Withdrawn' };
const ONB_ST = { pending: 'Pending', received: 'Received', verified: 'Verified', na: 'Not needed' };
const ONB_DEFAULT = [
  { id: 'offer', n: 'Signed offer letter or agreement', d: 'Offer letter (W2) or consulting agreement and MSA (C2C/1099).', doc: true },
  { id: 'id', n: 'Government photo ID', d: 'Driver\u2019s license or passport.', doc: true },
  { id: 'auth', n: 'Work authorization document', d: 'EAD, visa, green card or citizenship proof.', doc: true },
  { id: 'tax', n: 'Tax form', d: 'W-4 for W2 employees, W-9 for C2C and 1099.', doc: true },
  { id: 'bank', n: 'Direct deposit or invoicing details', d: 'Bank details for payroll or invoice payment.', doc: true },
  { id: 'coi', n: 'Certificate of insurance', d: 'Liability insurance for corp-to-corp consultants.', doc: true },
  { id: 'nda', n: 'Signed NDA', d: 'Confidentiality agreement.', doc: true },
  { id: 'bg', n: 'Background check consent', d: 'Signed consent form.', doc: true },
  { id: 'emg', n: 'Emergency contact', d: 'Name and phone number of an emergency contact, added to the profile.', doc: false },
  { id: 'portal', n: 'Portal account and pay plan', d: 'Account approved, client linked, pay plan set.', doc: false },
  { id: 'client', n: 'Client onboarding complete', d: 'Client paperwork, badge and system access.', doc: false },
];
const OFF_DEFAULT = [
  { id: 'notice', n: 'End date confirmed', d: 'Last working day agreed with the client.', doc: false },
  { id: 'assets', n: 'Equipment and access returned', d: 'Laptop, badge, client accounts closed.', doc: false },
  { id: 'ts', n: 'Final timesheets approved', d: 'All weeks submitted and approved.', doc: false },
  { id: 'pay', n: 'Final pay and reimbursements', d: 'Last payroll or invoice settled.', doc: false },
  { id: 'exit', n: 'Exit note', d: 'Feedback and forwarding contact recorded.', doc: false },
];
const POLICY_CATS = { handbook: 'Employee handbook', leave: 'Leave and holiday policy', conduct: 'Code of conduct', benefits: 'Benefits and payroll', template: 'Template (offer, NDA, forms)', other: 'Other' };
const weekRange = ws => [ws, addDays(ws, 6)];

/* ================= Pay: computed from clock-ins ================= */
const PAY_DEFAULT = { cur: 'INR', type: 'monthly', amt: 0, hrs: 8, days: 'mon-fri', wdm: 20, ot: 0, lop: true, pl: true, allow: [], ded: [], from: '' };
const CURRENCIES = { INR: 'Indian rupee (₹)', USD: 'US dollar ($)' };
const r2 = n => Math.round((+n || 0) * 100) / 100;
const fmtMoney = (n, cur) => new Intl.NumberFormat(cur === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency: cur || 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(r2(n));
const monthDays = mk => { const [y, m] = mk.split('-').map(Number); return new Date(y, m, 0).getDate(); };
const isWorkDay = (k, basis) => { const d = parseD(k).getDay(); return basis === 'all' ? true : basis === 'mon-sat' ? d !== 0 : d >= 1 && d <= 5; };
/* pay: settings; md: the month's attendance document; leaves: approved leave requests [{f,t}]; holidays: ['YYYY-MM-DD']; adjs: [{n,a}] one-off items */
/* ---- pay cycles, attendance approval and the pay engine ---- */
const payStartOf = s => (s && s.payStart != null && s.payStart !== '') ? Math.max(1, Math.min(28, +s.payStart || 1)) : 26;
const attApprovalOn = s => !(s && s.attApproval === false);
function cycleRange(mk, start) {
  start = +start || 1;
  if (start <= 1) return { key: mk, from: `${mk}-01`, to: `${mk}-${pad(monthDays(mk))}`, label: monthLabel(mk), short: monthLabel(mk) };
  const pm = addMonths(mk, -1); const from = `${pm}-${pad(Math.min(start, monthDays(pm)))}`; const to = `${mk}-${pad(start - 1)}`;
  return { key: mk, from, to, label: `${fmtDate(from, { month: 'short', day: 'numeric' })} – ${fmtDate(to, { month: 'short', day: 'numeric', year: 'numeric' })}`, short: `${fmtDate(from, { month: 'short', day: 'numeric' })} – ${fmtDate(to, { month: 'short', day: 'numeric' })}` };
}
const cycleFor = (dk, start) => { start = +start || 1; const mk = mkey(dk); return start <= 1 ? mk : (+dk.slice(8) >= start ? addMonths(mk, 1) : mk); };
const cycleMonths = cyc => [...new Set([mkey(cyc.from), mkey(cyc.to)])];
const mergeAtt = docs => ({ days: Object.assign({}, ...docs.filter(Boolean).map(d => d.days || {})) });
async function loadCycleAtt(uid, cyc) { const docs = await Promise.all(cycleMonths(cyc).map(m => dbGet(`u/${uid}/att/${m}`).catch(() => null))); return mergeAtt(docs); }
function useCycleAtt(uid, cyc, on) { const ms = cycleMonths(cyc); const a = useDoc(on ? `u/${uid}/att/${ms[0]}` : null); const b = useDoc(on && ms[1] ? `u/${uid}/att/${ms[1]}` : null); return { data: mergeAtt([a.data, b.data]), loading: a.loading || b.loading }; }
const breakMaxOf = s => (s && s.breakMax != null && s.breakMax !== '') ? Math.max(0, +s.breakMax || 0) : 60;
const breakMins = (day, now) => Math.round(((day && day.b) || []).reduce((a, x) => a + mins(x.i, x.o != null ? x.o : (now || Date.now())), 0));
const grossDayMins = day => Math.round(((day && day.s) || []).reduce((a, x) => a + (x.o ? mins(x.i, x.o) : 0), 0));
const excessBreak = (day, allow, now) => Math.max(0, breakMins(day, now) - (allow == null ? 60 : allow));
/* paid minutes for a day: clocked time minus break time beyond the allowance, unless an admin approved the extended break */
const dayMins = (day, allow, extOk) => Math.max(0, grossDayMins(day) - (extOk ? 0 : excessBreak(day, allow)));
const EV_LABEL = { in: 'Clock in', out: 'Clock out', bi: 'Break start', bo: 'Break end', logout: 'Logged out', password: 'Signed in', register: 'Account created' };
function attStatus(k, approvals, m, required) {
  if (!required) return 'approved'; const a = approvals && approvals[k]; if (!a) return 'pending';
  if (a.s === 'rejected') return 'rejected'; if (a.m != null && Math.round(a.m) !== Math.round(m)) return 'changed'; return 'approved';
}
const ATT_ST = { approved: 'Approved', pending: 'Awaiting approval', changed: 'Changed since approval', rejected: 'Rejected' };
function computePay(pay, md, mk, leaves, holidays, adjs, opts) {
  const p = { ...PAY_DEFAULT, ...(pay || {}) }; const hol = new Set(holidays || []); opts = opts || {};
  const from = opts.from || `${mk}-01`, to = opts.to || `${mk}-${pad(monthDays(mk))}`; const required = !!opts.requireApproval; const approvals = opts.approvals || {}; const brkAllow = opts.breakMax == null ? 60 : +opts.breakMax;
  const days = []; let calDays = 0;
  for (let k = from; k <= to; k = addDays(k, 1)) { const h = hol.has(k); const w = isWorkDay(k, p.days) && !h; if (w) calDays++; days.push({ k, w, h, m: 0, reg: 0, ot: 0, st: 'approved' }); }
  const workDays = +p.wdm > 0 ? +p.wdm : calDays; // standard working days per cycle (20 by default) or the calendar count
  const stdMin = (+p.hrs || 8) * 60; let present = 0, reg = 0, ot = 0, pending = 0, rejected = 0;
  days.forEach(d => {
    const day = ((md && md.days) || {})[d.k]; const ap = approvals[d.k]; const m = dayMins(day, brkAllow, ap && ap.bx === 'approved'); d.m = m; d.bm = breakMins(day); d.bx = excessBreak(day, brkAllow); d.st = m > 0 ? attStatus(d.k, approvals, m, required) : 'approved';
    const counts = m > 0 && d.st === 'approved';
    if (m > 0 && (d.st === 'pending' || d.st === 'changed')) pending++; if (m > 0 && d.st === 'rejected') rejected++;
    if (counts && d.w) present++;
    if (!counts) { d.reg = 0; d.ot = 0; } else if (!d.w) { d.reg = 0; d.ot = m; } else { d.reg = Math.min(m, stdMin); d.ot = Math.max(0, m - stdMin); }
    reg += d.reg; ot += d.ot;
  });
  present = Math.min(present, workDays);
  let leaveDays = 0; const idx = {}; days.forEach((d, i) => { idx[d.k] = i; });
  (leaves || []).forEach(l => { for (let k = l.f; k <= l.t; k = addDays(k, 1)) { const d = days[idx[k]]; if (d && d.w && !d.m && !d.lv) { d.lv = true; leaveDays++; } } });
  const otMult = +p.ot || 0; const amt = +p.amt || 0; const hrs = +p.hrs || 8;
  let base = 0, otPay = 0, dayRate = 0, hourRate = 0, paidDays = null;
  if (p.type === 'hourly') { hourRate = amt; base = reg / 60 * amt; otPay = ot / 60 * amt * (otMult || 1); }
  else {
    dayRate = workDays ? amt / workDays : 0; hourRate = workDays ? amt / (workDays * hrs) : 0;
    paidDays = p.lop ? Math.min(workDays, present + (p.pl ? leaveDays : 0)) : workDays;
    base = p.lop ? dayRate * paidDays : amt; otPay = otMult ? ot / 60 * hourRate * otMult : 0;
  }
  const allow = (p.allow || []).filter(a => a && a.n).map(a => ({ n: a.n, v: r2(+a.p ? base * (+a.p) / 100 : +a.a || 0), note: +a.p ? `${+a.p}% of base` : '' }));
  const gross = r2(base + otPay + allow.reduce((s, a) => s + a.v, 0));
  const ded = (p.ded || []).filter(a => a && a.n).map(a => ({ n: a.n, v: r2(+a.p ? gross * (+a.p) / 100 : +a.a || 0), note: +a.p ? `${+a.p}% of gross` : '' }));
  const adj = (adjs || []).filter(a => a && a.n).map(a => ({ n: a.n, v: r2(+a.a || 0) }));
  const dedT = r2(ded.reduce((s, a) => s + a.v, 0)); const adjT = r2(adj.reduce((s, a) => s + a.v, 0));
  const today = dkey(); const elapsed = Math.min(workDays, days.filter(d => d.w && d.k <= today).length); const leaveElapsed = days.filter(d => d.lv && d.k <= today).length;
  const unpaidDays = p.type === 'monthly' && p.lop ? Math.max(0, elapsed - present - (p.pl ? leaveElapsed : 0)) : 0;
  return { p, days, workDays, calDays, present, pending, rejected, leaveDays, paidDays, unpaidDays, reg, ot, dayRate, hourRate, base: r2(base), otPay: r2(otPay), allow, gross, ded, dedT, adj, adjT, net: r2(gross - dedT + adjT), from, to };
}
const approvedLeaves = (root, asg) => Object.entries((root && root.lv) || {}).filter(([id, l]) => !l.x && ((asg && asg.lvd) || {})[id] && asg.lvd[id].s === 'approved').map(([, l]) => l);
const ROLE_LABEL = { consultant: 'Consultant', employer: 'Client contact' };
const REQ_ST = { open: 'Open', reviewing: 'Reviewing', shared: 'Candidates shared', filled: 'Filled', closed: 'Closed' };
const CAND_ST = { shared: 'Shared', shortlist: 'Shortlisted', interview: 'Interview requested', rejected: 'Not a fit', hired: 'Hired' };
const CD_LABEL = { none: 'Not sent to client', pending: 'Awaiting client', approved: 'Client approved', returned: 'Client returned', withdrawn: 'Withdrawn' };
/* Client-side decision on a shared (pub) timesheet copy */
function cdStatus(d) { if (!d) return 'none'; if (d.s !== 'submitted') return 'withdrawn'; if (d.cd && d.cd.v === d.u) return d.cd.s; return 'pending'; }
const token = () => nid() + nid() + Math.random().toString(36).slice(2, 8);

/* ================= Icons (24px line set) ================= */
const IP = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3.5 2',
  sheet: 'M6 3h9l4 4v14H6zM14 3v5h5M9 12.5h7M9 16.5h7',
  tasks: 'M4 4h16v16H4zM8 12l3 3 5-6',
  cal: 'M4 6h16v14H4zM4 10h16M8 3v5M16 3v5',
  folder: 'M3 7a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
  user: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 21c1.4-4 4.6-6 8-6s6.6 2 8 6',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  users: 'M9 4a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM2.5 20c1-3.5 3.6-5.5 6.5-5.5s5.5 2 6.5 5.5M16 4.5a3.3 3.3 0 0 1 0 6.3M18 14.6c1.8.6 3 2.2 3.6 4.9',
  approve: 'M4 13h4l2 3h4l2-3h4M5.5 5h13L20 13v6H4v-6z',
  chart: 'M4 20V11M10 20V5M16 20v-6M2 20h20',
  mega: 'M3 10v4l11 4V6L3 10zM14 9a3 3 0 0 1 0 6M6.5 15.2 8 20h3l-1.4-4',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.5 3.6 5.5 3.6 9s-1.1 6.5-3.6 9c-2.5-2.5-3.6-5.5-3.6-9S9.5 5.5 12 3z',
  exit: 'M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10',
  menu: 'M4 7h16M4 12h16M4 17h16',
  x: 'M6 6l12 12M18 6 6 18',
  up: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  down: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  left: 'M15 5l-7 7 7 7', right: 'M9 5l7 7-7 7',
  plus: 'M12 5v14M5 12h14',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  file: 'M6 3h9l4 4v14H6zM14 3v5h5',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM20 20l-4.5-4.5',
  star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.9l-5.3 2.8 1.1-5.9-4.3-4.1 5.9-.8z',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  chev: 'M6 9l6 6 6-6',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  brief: 'M3 8h18v12H3zM8 8V5h8v3M3 13h18',
  money: 'M3 7h18v10H3zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5M6.5 10h.01M17.5 14h.01',
  sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z',
  send: 'M4 12l16-8-5 16-3-6-8-2z',
  chat: 'M4 5h16v11H9l-5 4z',
  building: 'M4 21V4h10v17M14 10h6v11M7 8h2M7 12h2M7 16h2M17 14h1M17 18h1M2 21h20',
  cloud: 'M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 11a3.5 3.5 0 0 0 1 7z',
  code: 'M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14',
  pen: 'M4 20l4-1 11-11-3-3L5 16zM13 7l3 3',
  compass: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM15 9l-2 5-5 2 2-5z',
  heart: 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z',
  flask: 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  spark: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z',
};
const Icon = ({ n, cls }) => html`<svg className=${'ico ' + (cls || '')} viewBox="0 0 24 24" aria-hidden="true"><path d=${IP[n] || ''} /></svg>`;

/* ================= Shared UI ================= */
const ToastCtx = createContext(() => {});
const useToast = () => useContext(ToastCtx);
function ToastHost({ children }) {
  const [list, setList] = useState([]);
  const push = useCallback((msg, bad) => {
    const id = nid(); setList(l => [...l, { id, msg, bad }]);
    setTimeout(() => setList(l => l.filter(t => t.id !== id)), bad ? 6000 : 3200);
  }, []);
  return html`<${ToastCtx.Provider} value=${push}>${children}
    <div className="toasts" role="status" aria-live="polite">${list.map(t => html`<div key=${t.id} className=${'toast' + (t.bad ? ' bad' : '')}>${t.msg}</div>`)}</div><//>`;
}
function Modal({ title, onClose, children, foot, wide }) {
  useEffect(() => {
    const k = e => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', k); const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { removeEventListener('keydown', k); document.body.style.overflow = prev; };
  }, []);
  return html`<div className="overlay" onMouseDown=${e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className=${'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label=${title}>
      <div className="mh"><h2>${title}</h2><button className="btn ghost icon" onClick=${onClose} aria-label="Close"><${Icon} n="x" /></button></div>
      <div className="mb">${children}</div>
      ${foot && html`<div className="mf">${foot}</div>`}
    </div></div>`;
}
const Spinner = ({ label }) => html`<div className="loading"><span className="spin" />${label || 'Loading…'}</div>`;
const Chip = ({ s, children }) => html`<span className=${'chip ' + (s || '')}>${children}</span>`;
const Empty = ({ title, children, action }) => html`<div className="empty"><b>${title}</b>${children && html`<span>${children}</span>`}${action}</div>`;
function Field({ label, hint, children }) { return html`<label className="fld"><span>${label}</span>${children}${hint && html`<small>${hint}</small>`}</label>`; }
function Avatar({ p, size }) {
  const s = size || 30;
  return p && p.avatarUrl ? html`<img src=${p.avatarUrl} alt="" width=${s} height=${s} style=${{ width: s, height: s, borderRadius: '50%' }} />`
    : html`<span style=${{ width: s, height: s, borderRadius: '50%', background: 'var(--surface-2)', display: 'inline-block', flex: 'none' }} />`;
}
function Person({ uid, root, people, sub }) {
  const p = people && people[uid];
  return html`<div className="person"><${Avatar} p=${p} /><div style=${{ minWidth: 0 }}><b>${nameOf(uid, root, people)}</b>${sub && html`<span>${sub}</span>`}</div></div>`;
}
const nameOf = (uid, root, people) => (root && root.p && root.p.n) || (people && people[uid] && people[uid].name) || 'Team member';

/* File picker + drag/drop with progress */
function FilePick({ onFiles, busy, progress, label, hint }) {
  const [over, setOver] = useState(false);
  const inp = useRef(null);
  return html`<div className=${'drop' + (over ? ' over' : '')}
      onDragOver=${e => { e.preventDefault(); setOver(true); }} onDragLeave=${() => setOver(false)}
      onDrop=${e => { e.preventDefault(); setOver(false); if (!busy && e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]); }}>
    <p>${label || 'Drop a file here, or choose one from your device.'}<br /><small className="muted">${hint || 'PDF, image, Excel (.xlsx), Word (.docx) or CSV, up to 5 MB.'}</small></p>
    <button type="button" className="btn ghost" disabled=${busy} onClick=${() => inp.current && inp.current.click()}><${Icon} n="up" />${busy ? 'Uploading…' : 'Choose file'}</button>
    <input ref=${inp} type="file" accept=${ACCEPT} hidden onChange=${e => { const f = [...e.target.files]; e.target.value = ''; if (f.length) onFiles(f); }} />
    ${busy && html`<div className="prog"><i style=${{ width: Math.round((progress || 0.05) * 100) + '%' }} /></div>`}
  </div>`;
}
/* Stored file row actions: preview (images) + download */
function FileActions({ base, f, onDelete }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [pv, setPv] = useState(null);
  const isImg = /^image\//.test(f.ty || '');
  const dl = async () => { setBusy(true); try { await downloadStored(base, f.id); } catch (e) { if (!e || e.code !== 'declined') toast(errText(e), true); } setBusy(false); };
  const view = async () => { setBusy(true); try { setPv(await previewUrl(base, f.id)); } catch (e) { toast(errText(e), true); } setBusy(false); };
  return html`<${Fragment}>
    ${isImg && html`<button className="btn ghost sm" disabled=${busy} onClick=${view}><${Icon} n="eye" />View</button>`}
    <button className="btn ghost sm" disabled=${busy} onClick=${dl}><${Icon} n="down" />${busy ? '…' : 'Download'}</button>
    ${onDelete && html`<button className="btn ghost sm icon" aria-label=${'Delete ' + f.n} disabled=${busy} onClick=${onDelete}><${Icon} n="trash" /></button>`}
    ${pv && html`<${Modal} title=${f.n} onClose=${() => setPv(null)} wide><img className="preview" src=${pv.url} alt=${f.n} /><//>`}
  <//>`;
}
function useHashRoute() {
  const [h, setH] = useState(location.hash || '#/');
  useEffect(() => { const f = () => setH(location.hash || '#/'); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  const raw = h.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  const q = {}; (qs || '').split('&').filter(Boolean).forEach(p => { const [k, v] = p.split('='); q[decodeURIComponent(k)] = decodeURIComponent(v || ''); });
  return { path: path.replace(/\/+$/, '') || '/', q };
}

/* ================= Accounting: taxes, paystubs, chart of accounts ================= */
const TAX_DEFAULT = {
  us: { year: 2025, std: { single: 15000, married: 30000, head: 22500 },
    brackets: { single: [[11925, .10], [48475, .12], [103350, .22], [197300, .24], [250525, .32], [626350, .35], [1e12, .37]], married: [[23850, .10], [96950, .12], [206700, .22], [394600, .24], [501050, .32], [751600, .35], [1e12, .37]], head: [[17000, .10], [64850, .12], [103350, .22], [197300, .24], [250525, .32], [626350, .35], [1e12, .37]] },
    ss: 6.2, ssBase: 176100, med: 1.45, medAdd: 0.9, medAddOver: 200000, futa: 0.6, futaBase: 7000, suta: 3.0, sutaBase: 43300 },
  in: { fy: '2025-26', regime: 'new', newSlabs: [[400000, 0], [800000, .05], [1200000, .10], [1600000, .15], [2000000, .20], [2400000, .25], [1e12, .30]], newStd: 75000, newRebate: 1200000,
    oldSlabs: [[250000, 0], [500000, .05], [1000000, .20], [1e12, .30]], oldStd: 50000, oldRebate: 500000, cess: 4, pf: 12, pfCap: true, pfCapWage: 15000, basicPct: 50, esiLimit: 21000, esiEmp: 0.75, esiEr: 3.25, pt: 200, ptMin: 15000 },
};
const TAX_PROFILE_DEFAULT = { country: 'US', filing: 'single', extra: 0, state: 0, stateName: '', fica: true, regime: 'new', ded: 0, basicPct: '', pt: '', pf: true, method: 'Direct deposit' };
const taxBrackets = (annual, br) => { let tax = 0, prev = 0; for (const [lim, r] of br) { if (annual > prev) { tax += (Math.min(annual, lim) - prev) * r; prev = lim; } else break; } return tax; };
function usTaxes(gross, ytd, prof, s, ppy) {
  s = { ...TAX_DEFAULT.us, ...(s || {}) }; prof = { ...TAX_PROFILE_DEFAULT, ...(prof || {}) }; ppy = ppy || 12; const yg = +ytd.gross || 0;
  const filing = s.std[prof.filing] != null ? prof.filing : 'single';
  const taxable = Math.max(0, gross * ppy - s.std[filing]); const fed = r2(taxBrackets(taxable, s.brackets[filing]) / ppy + (+prof.extra || 0));
  const ssW = prof.fica ? Math.max(0, Math.min(gross, s.ssBase - yg)) : 0; const ss = r2(ssW * s.ss / 100);
  const med = prof.fica ? r2(gross * s.med / 100 + Math.max(0, Math.min(gross, yg + gross - s.medAddOver)) * s.medAdd / 100) : 0;
  const state = r2(gross * (+prof.state || 0) / 100);
  const items = [{ n: 'Federal income tax', v: fed }, { n: 'Social Security', v: ss }, { n: 'Medicare', v: med }, ...(state ? [{ n: (prof.stateName || 'State') + ' income tax', v: state }] : [])];
  const employer = [{ n: 'Social Security (employer)', v: ss }, { n: 'Medicare (employer)', v: r2(gross * s.med / 100 * (prof.fica ? 1 : 0)) }, { n: 'FUTA', v: r2(Math.max(0, Math.min(gross, s.futaBase - yg)) * s.futa / 100) }, { n: 'SUTA', v: r2(Math.max(0, Math.min(gross, s.sutaBase - yg)) * s.suta / 100) }];
  return { items, employer, total: r2(items.reduce((a, x) => a + x.v, 0)), employerTotal: r2(employer.reduce((a, x) => a + x.v, 0)), note: `Federal withholding uses the ${s.year} percentage method on annualized pay (${filing}); estimates to confirm with your CPA.` };
}
function inTaxes(gross, ytd, prof, s) {
  s = { ...TAX_DEFAULT.in, ...(s || {}) }; prof = { ...TAX_PROFILE_DEFAULT, ...(prof || {}) };
  const basic = gross * ((+prof.basicPct || s.basicPct) / 100);
  const pfWage = s.pfCap ? Math.min(basic, s.pfCapWage) : basic; const pf = prof.pf ? r2(pfWage * s.pf / 100) : 0;
  const esiOn = gross <= s.esiLimit; const esi = esiOn ? r2(gross * s.esiEmp / 100) : 0; const esiEr = esiOn ? r2(gross * s.esiEr / 100) : 0;
  const pt = gross >= s.ptMin ? (prof.pt !== '' && prof.pt != null ? +prof.pt : s.pt) : 0;
  const regime = prof.regime || s.regime; const annual = gross * 12;
  let taxable, tax;
  if (regime === 'old') { taxable = Math.max(0, annual - s.oldStd - (+prof.ded || 0) - pf * 12); tax = taxBrackets(taxable, s.oldSlabs); if (taxable <= s.oldRebate) tax = 0; }
  else { taxable = Math.max(0, annual - s.newStd); tax = taxBrackets(taxable, s.newSlabs); if (taxable <= s.newRebate) tax = 0; }
  tax = tax * (1 + s.cess / 100); const tds = r2(tax / 12);
  const items = [...(pf ? [{ n: 'Provident Fund (EPF)', v: pf }] : []), ...(esi ? [{ n: 'ESI', v: esi }] : []), ...(pt ? [{ n: 'Professional tax', v: r2(pt) }] : []), { n: 'TDS (income tax)', v: tds }];
  const employer = [...(pf ? [{ n: 'EPF (employer)', v: pf }] : []), ...(esiEr ? [{ n: 'ESI (employer)', v: esiEr }] : [])];
  return { items, employer, total: r2(items.reduce((a, x) => a + x.v, 0)), employerTotal: r2(employer.reduce((a, x) => a + x.v, 0)), note: `TDS estimated on annualized salary under the ${regime} regime (FY ${s.fy}), with 4% cess; confirm with your CA.` };
}
const payYearKey = (mk, country) => country === 'IN' ? (mk.slice(5) >= '04' ? `${mk.slice(0, 4)}-${+mk.slice(0, 4) + 1}` : `${+mk.slice(0, 4) - 1}-${mk.slice(0, 4)}`) : mk.slice(0, 4);
function buildStub(m, mk, calc, prof, taxSet, prior) {
  const country = (prof && prof.country) || 'US'; const yk = payYearKey(mk, country);
  const ytd = (prior || []).filter(p => p.yk === yk && p.mk < mk).reduce((a, p) => ({ gross: a.gross + (+p.gross || 0), tax: a.tax + (+p.taxT || 0), net: a.net + (+p.net || 0) }), { gross: 0, tax: 0, net: 0 });
  const t = country === 'IN' ? inTaxes(calc.gross, ytd, prof, taxSet && taxSet.in) : usTaxes(calc.gross, ytd, prof, taxSet && taxSet.us, 12);
  const regH = r2(calc.reg / 60), otH = r2(calc.ot / 60);
  const earnings = [{ n: calc.p.type === 'hourly' ? `Regular hours (${h1(regH)} h × ${fmtMoney(calc.hourRate, calc.p.cur)})` : `Base salary${calc.paidDays != null && calc.p.lop ? ` (${calc.paidDays} of ${calc.workDays} days)` : ''}`, v: calc.base }, ...(calc.otPay ? [{ n: `Overtime (${h1(otH)} h)`, v: calc.otPay }] : []), ...calc.allow.map(a => ({ n: a.n, v: a.v })), ...calc.adj.filter(a => a.v > 0).map(a => ({ n: a.n, v: a.v }))];
  const other = [...calc.ded.map(d => ({ n: d.n, v: d.v })), ...calc.adj.filter(a => a.v < 0).map(a => ({ n: a.n, v: -a.v }))];
  const otherT = r2(other.reduce((a, x) => a + x.v, 0)); const net = r2(calc.gross - t.total - otherT);
  return { uid: m.id, n: m.u.p.n, e: m.u.p.e, ti: m.r.ti || m.u.p.ti || '', mk, yk, country, cur: calc.p.cur, days: calc.present, workDays: calc.workDays, reg: regH, ot: otH, earnings, gross: calc.gross, taxes: t.items, taxT: t.total, other, otherT, net, employer: t.employer, employerT: t.employerTotal, cost: r2(calc.gross + t.employerTotal), ytd: { gross: r2(ytd.gross + calc.gross), tax: r2(ytd.tax + t.total), net: r2(ytd.net + net) }, note: t.note, method: (prof && prof.method) || 'Direct deposit', filing: prof && prof.filing, regime: prof && prof.regime };
}
const COA_DEFAULT = [
  { id: 'inc-staff', n: 'Staffing income', t: 'income' }, { id: 'inc-sow', n: 'Project (SOW) income', t: 'income' }, { id: 'inc-consult', n: 'Consulting income', t: 'income' }, { id: 'inc-other', n: 'Other income', t: 'income' },
  { id: 'exp-c2c', n: 'Contractor payments (C2C)', t: 'expense' }, { id: 'exp-payroll', n: 'Payroll', t: 'expense' }, { id: 'exp-paytax', n: 'Payroll taxes', t: 'expense' }, { id: 'exp-rent', n: 'Rent and utilities', t: 'expense' }, { id: 'exp-soft', n: 'Software subscriptions', t: 'expense' }, { id: 'exp-travel', n: 'Travel', t: 'expense' }, { id: 'exp-mkt', n: 'Marketing and job boards', t: 'expense' }, { id: 'exp-prof', n: 'Professional fees (legal, CPA)', t: 'expense' }, { id: 'exp-ins', n: 'Insurance', t: 'expense' }, { id: 'exp-office', n: 'Office and supplies', t: 'expense' }, { id: 'exp-bank', n: 'Bank fees and charges', t: 'expense' }, { id: 'exp-tax', n: 'Taxes and licenses', t: 'expense' }, { id: 'exp-other', n: 'Other expenses', t: 'expense' },
];
const ATS_ST = { new: 'New', screen: 'Screening', interview: 'Interview', offer: 'Offer', hired: 'Hired', rejected: 'Rejected' };
const ATS_TEMPLATES = {
  screen: { s: 'Your application to StratEdge IT Consulting', b: 'Hi {name},\n\nThank you for applying for the {job} role. We\u2019ve reviewed your profile and would like to set up a short call to learn more about your experience and what you\u2019re looking for.\n\nCould you share a few times that work for you this week?\n\nBest regards,\n{me}\nStratEdge IT Consulting' },
  interview: { s: 'Interview invitation: {job} at StratEdge IT Consulting', b: 'Hi {name},\n\nWe\u2019d like to invite you to an interview for the {job} role on {date}. Please reply to confirm, or suggest another time if that doesn\u2019t work.\n\nWe look forward to speaking with you.\n\nBest regards,\n{me}\nStratEdge IT Consulting' },
  offer: { s: 'Offer: {job} at StratEdge IT Consulting', b: 'Hi {name},\n\nWe\u2019re pleased to move forward with an offer for the {job} role. The offer letter will follow for electronic signature. Please let us know if you have any questions.\n\nWelcome aboard,\n{me}\nStratEdge IT Consulting' },
  rejected: { s: 'Your application to StratEdge IT Consulting', b: 'Hi {name},\n\nThank you for taking the time to apply for the {job} role. We\u2019ve decided to move forward with other candidates for this position, but we\u2019ll keep your profile on file for roles that match your experience.\n\nWe wish you the best in your search.\n\nBest regards,\n{me}\nStratEdge IT Consulting' },
};

/* ---- sign-in activity helpers ---- */
function uaSummary(ua) {
  ua = ua || ''; const os = /iPhone|iPad/.test(ua) ? (/iPad/.test(ua) ? 'iPad' : 'iPhone') : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : '';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Chrome\//.test(ua) && !/Chromium/.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : ua ? 'Browser' : '';
  return [br, os].filter(Boolean).join(' on ') || 'Unknown device';
}
const geoLabel = r => { if (!r) return ''; const g = r.geo; const ip = g && g.label ? g.label : ''; return ip; };
const mapLink = p => `https://www.google.com/maps?q=${p.lat},${p.lng}`;
/* Exact location: resolves to { pos } or { err } where err is why it is unavailable.
   insecure = page not served over https (browsers block geolocation), denied = the person refused the prompt,
   unavailable = no GPS/network fix, timeout = no answer in time, nosupport = old browser. */
function getPosition(ms) {
  return new Promise(res => {
    try {
      if (!window.isSecureContext) return res({ err: 'insecure' });
      if (!navigator.geolocation) return res({ err: 'nosupport' });
      let done = false; const fin = v => { if (!done) { done = true; res(v); } };
      const timer = setTimeout(() => fin({ err: 'timeout' }), ms || 10000);
      navigator.geolocation.getCurrentPosition(p => { clearTimeout(timer); fin({ pos: { lat: +p.coords.latitude.toFixed(5), lng: +p.coords.longitude.toFixed(5), acc: Math.round(p.coords.accuracy || 0) } }); },
        e => { clearTimeout(timer); fin({ err: e && e.code === 1 ? 'denied' : e && e.code === 3 ? 'timeout' : 'unavailable' }); }, { enableHighAccuracy: true, timeout: (ms || 10000) - 500, maximumAge: 20000 });
    } catch (e) { res({ err: 'unavailable' }); }
  });
}
const POS_ERR = { insecure: 'needs a secure https connection', denied: 'blocked in the browser', unavailable: 'no location fix on this device', timeout: 'no answer from the device in time', nosupport: 'browser does not support location', '': 'not shared' };
async function locPermission() { try { if (!window.isSecureContext) return 'insecure'; if (!navigator.permissions) return 'prompt'; const s = await navigator.permissions.query({ name: 'geolocation' }); return s.state; } catch (e) { return 'prompt'; } }
let _loginPos = null;
function startLoginLocation() { _loginPos = getPosition(12000); }
async function shareLoginLocation() { try { const r = await (_loginPos || getPosition(12000)); _loginPos = null; await api('login_geo', r.pos ? { ...r.pos } : { posErr: r.err || 'unavailable' }); return r; } catch (e) { return { err: 'unavailable' }; } }
