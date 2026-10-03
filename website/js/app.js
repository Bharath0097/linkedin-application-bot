'use strict';

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
const PORTAL_LABEL = { consultant: 'Consultant portal', employee: 'Employee portal', bench: 'Bench sales portal', employer: 'Client portal', client: 'Client portal' };
const portalLabel = role => PORTAL_LABEL[role] || 'Employee portal';
const portalKeyOf = role => role === 'employer' ? 'client' : role === 'employee' ? 'employee' : role === 'bench' ? 'bench' : 'consultant';
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
const ROLE_LABEL = { consultant: 'Consultant', employer: 'Client contact', bench: 'Bench sales recruiter' };
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
      <div className="mh"><h2>${title}</h2><button type="button" className="btn ghost icon" onClick=${onClose} aria-label="Close"><${Icon} n="x" /></button></div>
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
    ${isImg && html`<button type="button" className="btn ghost sm" disabled=${busy} onClick=${view}><${Icon} n="eye" />View</button>`}
    <button type="button" className="btn ghost sm" disabled=${busy} onClick=${dl}><${Icon} n="down" />${busy ? '…' : 'Download'}</button>
    ${onDelete && html`<button type="button" className="btn ghost sm icon" aria-label=${'Delete ' + f.n} disabled=${busy} onClick=${onDelete}><${Icon} n="trash" /></button>`}
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

/* ================= Website content ================= */
const SERVICES = [
  { s: 'staffing', n: 'Staffing services', d: 'Contract, contract-to-hire and direct-hire talent for IT and non-IT roles.',
    l: 'We place consultants with end clients directly and work as a dependable subcontractor to prime vendors. Every engagement is screened, onboarded and supported by our team, with attendance and timesheets tracked in one portal.',
    inc: ['Contract and C2C consultants', 'Contract-to-hire and direct hire', 'SOW-based project teams', 'Prime-vendor and subcontract partnerships', 'IT, healthcare, and finance & accounting roles', 'Onboarding and timesheet management'] },
  { s: 'web-development', n: 'Web development', d: 'SEO-friendly websites built on scalable frameworks.',
    l: 'Fast, accessible websites that are easy for your team to update and easy for search engines to understand.',
    inc: ['Corporate and marketing sites', 'E-commerce builds', 'CMS and headless platforms', 'Performance and technical SEO'] },
  { s: 'app-development', n: 'App development', d: 'Secure mobile and web apps with intuitive interfaces.',
    l: 'Native and cross-platform apps for phones, tablets, watches and TVs, built with security and maintainability in mind.',
    inc: ['iOS and Android apps', 'Cross-platform builds', 'Watch and TV apps', 'App modernization'] },
  { s: 'software-development', n: 'Software development', d: 'Custom software and SaaS products shaped around your workflows.',
    l: 'Business software and SaaS products designed around the way your organization actually operates, with integrations into the systems you already use.',
    inc: ['Custom business software', 'SaaS product development', 'APIs and system integration', 'QA, maintenance and support'] },
  { s: 'digital-marketing', n: 'Digital marketing', d: 'Search, social and paid campaigns that bring in qualified leads.',
    l: 'Campaigns planned around measurable outcomes, from organic search to paid social, with reporting you can act on.',
    inc: ['Search engine optimization', 'Social media marketing', 'Paid search and social', 'Content and analytics'] },
  { s: 'ui-ux', n: 'UI / UX design', d: 'Interfaces designed around how people actually work.',
    l: 'Research-led design that turns complex workflows into clear screens, backed by prototypes you can test before you build.',
    inc: ['User research', 'Wireframes and prototypes', 'Design systems', 'Usability testing'] },
  { s: 'it-consultancy', n: 'IT consultancy', d: 'Advice that lines up your IT strategy with business goals.',
    l: 'Independent guidance on architecture, tooling and delivery so technology spending maps directly to business results.',
    inc: ['IT strategy and roadmaps', 'Architecture reviews', 'Vendor and tool selection', 'IT project management'] },
  { s: 'erp-crm', n: 'ERP / CRM', d: 'Streamlined operations and stronger customer relationships.',
    l: 'Implementation, configuration and support for ERP and CRM platforms, including SAP, with clean data migration and integrations.',
    inc: ['SAP and ERP implementation', 'CRM setup and customization', 'Data migration', 'Integrations and support'] },
  { s: 'devops', n: 'DevOps', d: 'Faster, safer releases with automated pipelines and cloud infrastructure.',
    l: 'Automated build, test and deployment pipelines on modern cloud infrastructure, monitored around the clock.',
    inc: ['CI/CD pipelines', 'Cloud infrastructure on AWS, Azure and GCP', 'Containers and Kubernetes', 'Monitoring and incident response'] },
  { s: 'healthcare', n: 'Healthcare IT solutions', d: 'Compliant systems for hospitals, clinics and research teams.',
    l: 'Software for hospitals, clinics, diagnostic centers and research organizations, designed around HIPAA, HL7 and FHIR from day one.',
    inc: ['EHR and EMR implementation', 'HIPAA-compliant telemedicine apps', 'Remote patient monitoring and IoMT', 'Healthcare CRM and patient engagement', 'Medical portals and scheduling'] },
  { s: 'clinical-saas', n: 'Clinical SaaS development', d: 'Cloud software for clinical workflows, research and trials.',
    l: 'Secure, interoperable cloud products for clinical teams, from workflow tools to research and trial data platforms.',
    inc: ['Clinical workflow applications', 'Research and trial data platforms', 'HIPAA-ready hosting', 'HL7 and FHIR interoperability'] },
];
const SERVICE_EXTRA = {
  'staffing': { who: 'Hiring managers, procurement and prime vendors who need vetted people on a project quickly.', tech: ['Network engineering', 'SAP', 'React and front-end', 'Java', 'Python', '.NET', 'Cloud and DevOps', 'Healthcare IT', 'Finance and accounting'],
    deliver: ['Screened, interview-ready profiles with RTR', 'Rate, availability and work-authorization check', 'Agreements, onboarding and compliance paperwork', 'Timesheets, approvals and invoicing through the portal', 'Replacement guarantee on contract placements', 'A named account manager'],
    time: 'First profiles in 2 to 5 business days', team: 'Recruiter, account manager, compliance', models: 'C2C, W2, 1099, contract-to-hire, direct hire, SOW teams',
    faq: [['How fast can you present candidates?', 'For common roles we usually present screened profiles within a few business days. Niche roles take longer, and we tell you when that is the case rather than guess.'], ['Do you handle the paperwork?', 'Yes. Agreements, onboarding, timesheets and invoicing run through our team and the portal, so your managers only approve hours.'], ['What if a consultant does not work out?', 'Tell your account manager. We replace contract placements and re-screen against your feedback.']] },
  'web-development': { who: 'Companies that need a site that loads fast, ranks well and can be updated without a developer.', tech: ['HTML/CSS/JS', 'React', 'Next.js', 'WordPress', 'Shopify', 'Headless CMS'],
    deliver: ['Design system and responsive templates', 'CMS with editable pages and blog', 'Lead forms, analytics and SEO setup', 'Performance budget and accessibility pass', 'Launch, redirects and search console', 'Training and a maintenance plan'],
    time: '4 to 10 weeks for a marketing site', team: 'Designer, front-end developer, project lead', models: 'Fixed scope or monthly retainer',
    faq: [['Do you also host and maintain sites?', 'We can hand over a site for your own hosting or keep maintaining it under a support agreement.'], ['Can you redesign an existing site?', 'Yes. We start from your current content and analytics so nothing that works is lost.']] },
  'app-development': { who: 'Businesses launching a customer app or replacing an aging internal one.', tech: ['Swift', 'Kotlin', 'React Native', 'Flutter', 'watchOS and tvOS', 'Firebase and AWS'],
    deliver: ['Clickable prototype and user flows', 'iOS and Android builds from one codebase where it fits', 'Backend APIs, push notifications and analytics', 'App store listings and release management', 'Crash monitoring and update plan'],
    time: '8 to 16 weeks to a first release', team: 'Product designer, mobile engineers, backend engineer, QA', models: 'Fixed scope, then support retainer',
    faq: [['Native or cross-platform?', 'It depends on the app. We recommend cross-platform when one codebase can serve both stores well, and native when performance or device features demand it.'], ['Do you publish to the app stores?', 'Yes, including store listings, review feedback and updates after launch.']] },
  'software-development': { who: 'Teams whose spreadsheets and off-the-shelf tools no longer fit how they work.', tech: ['Java', 'Python', '.NET', 'Node.js', 'PostgreSQL and SQL Server', 'REST and GraphQL APIs'],
    deliver: ['Discovery report with scoped plan and estimate', 'Working software in two-week increments', 'Integrations with the systems you already use', 'Automated tests and documentation', 'Source code and deployment runbooks', 'Support and enhancement backlog'],
    time: 'Discovery in 2 weeks, first release in 6 to 12', team: 'Business analyst, tech lead, 2 to 4 engineers, QA', models: 'SOW team or dedicated engineers',
    faq: [['How do projects start?', 'With a short discovery phase that produces a scoped plan and estimate before any build work begins.'], ['Who owns the code?', 'You do. Source code and documentation are delivered with the product.']] },
  'digital-marketing': { who: 'Companies that want measurable leads from search and social, not just traffic.', tech: ['Google Ads', 'Meta and LinkedIn Ads', 'Technical SEO', 'Analytics and tag management', 'Email campaigns'],
    deliver: ['Keyword and competitor research', 'Campaign setup across search and social', 'Landing pages built to convert', 'Monthly reports on leads and cost per lead', 'Ongoing optimization'],
    time: 'Setup in 2 to 3 weeks, results compound over 3+ months', team: 'Marketing strategist, content writer, ads specialist', models: 'Monthly retainer',
    faq: [['How do you report results?', 'Monthly reports tied to the goals we agreed on: leads, cost per lead and conversion, not vanity metrics.'], ['Is there a minimum term?', 'Campaigns need a few months to optimize, so we recommend at least three.']] },
  'ui-ux': { who: 'Product teams that want interfaces tested with real users before engineering starts.', tech: ['Figma', 'Design systems', 'Prototyping', 'Usability testing', 'Accessibility (WCAG)'],
    deliver: ['User interviews and journey maps', 'Wireframes and interactive prototypes', 'Design system with reusable components', 'Usability test findings and fixes', 'Developer-ready specifications'],
    time: '3 to 8 weeks depending on scope', team: 'UX researcher, product designer', models: 'Fixed scope or embedded designer',
    faq: [['Can you work with our developers?', 'Yes. We deliver specs and components your team can implement directly.'], ['Do you do research?', 'User interviews, task analysis and usability tests are part of most engagements.']] },
  'it-consultancy': { who: 'Leadership teams making technology decisions that are hard to reverse.', tech: ['Architecture reviews', 'Cloud strategy', 'Vendor evaluation', 'Security posture', 'Project and program management'],
    deliver: ['Current-state assessment', 'Roadmap with options, costs and risks', 'Vendor shortlist and selection criteria', 'Architecture and security recommendations', 'Project governance and PMO support'],
    time: 'Assessment in 2 to 4 weeks', team: 'Principal consultant, solution architect', models: 'Fixed-fee assessment or advisory retainer',
    faq: [['Are you tied to specific vendors?', 'No. Recommendations are independent; we have no resale arrangements that influence them.'], ['Can you run the project after the plan?', 'Yes, with our project managers and delivery team or alongside yours.']] },
  'erp-crm': { who: 'Operations and finance teams that need their systems to talk to each other.', tech: ['SAP S/4HANA', 'SAP PP, QM, MM and FICO', 'Salesforce', 'Microsoft Dynamics', 'Data migration'],
    deliver: ['Process mapping and fit-gap analysis', 'Configuration and custom development', 'Cleansed and migrated data with rehearsals', 'Integration with finance, HR and plant systems', 'User training and hypercare after go-live'],
    time: '3 to 9 months by module and scope', team: 'Functional consultants, technical consultants, PM', models: 'SOW project or staffed consultants',
    faq: [['Do you staff SAP consultants as well as implement?', 'Both. Many clients start with a functional consultant on contract and grow into a project.'], ['How do you handle data migration?', 'With cleansing, mapping and rehearsal migrations before the final cutover.']] },
  'devops': { who: 'Engineering teams that ship too slowly or lose sleep over production.', tech: ['AWS, Azure and GCP', 'Kubernetes and Docker', 'Terraform', 'GitHub Actions and Jenkins', 'Observability tooling'],
    deliver: ['Pipeline and infrastructure audit', 'CI/CD with automated tests and approvals', 'Infrastructure as code and environments', 'Monitoring, alerting and runbooks', 'Cost optimization report', 'On-call support option'],
    time: 'Audit in 1 to 2 weeks, improvements in sprints', team: 'DevOps engineer, cloud architect', models: 'SOW or embedded engineers',
    faq: [['Can you take over an existing setup?', 'Yes. We start with an audit of the current pipelines and infrastructure, then improve in steps.'], ['Do you offer on-call support?', 'Monitoring and incident response can be part of a support agreement.']] },
  'healthcare': { who: 'Hospitals, clinics, diagnostic centers and research groups that must stay compliant while modernizing.', tech: ['HIPAA', 'HL7 and FHIR', 'EHR and EMR platforms', 'Telemedicine', 'Remote patient monitoring'],
    deliver: ['EHR/EMR implementation and integration', 'HIPAA-compliant telemedicine and patient portals', 'Remote monitoring and device (IoMT) integration', 'Healthcare CRM and scheduling', 'Compliance documentation for your auditors'],
    time: 'Scoped per program; portals in 8 to 14 weeks', team: 'Healthcare analyst, integration engineers, security lead', models: 'SOW project or staffed healthcare IT roles',
    faq: [['How do you handle protected health information?', 'With HIPAA-aligned design, access controls and encryption from the first day, documented for your compliance team.'], ['Can you integrate with our EHR?', 'Yes, through HL7 and FHIR interfaces.']] },
  'clinical-saas': { who: 'Clinical teams and research organizations that need secure, interoperable cloud software.', tech: ['HIPAA-ready hosting', 'FHIR APIs', 'Trial and research data platforms', 'Audit logging', 'Role-based access'],
    deliver: ['Multi-tenant SaaS architecture', 'Clinical workflow and research modules', 'FHIR interoperability layer', 'Audit trails and validation documentation', 'Hosting, monitoring and release management'],
    time: 'MVP in 12 to 20 weeks', team: 'Product lead, full-stack engineers, compliance specialist', models: 'SOW product build, then support',
    faq: [['Can the platform be white-labeled?', 'Yes. Multi-tenant SaaS with your branding is a common request.'], ['What about audit and validation?', 'Audit trails and validation documentation are built in for regulated environments.']] },
};
const INDUSTRIES = [
  ['Healthcare and life sciences', 'EHR, telemedicine and patient platforms, plus healthcare IT staffing.'],
  ['Banking, finance and accounting', 'Finance and accounting professionals, fintech engineering, compliance-aware delivery.'],
  ['Manufacturing and supply chain', 'SAP PP, QM and MM teams and plant-floor integrations.'],
  ['Telecom and networking', 'Network engineers, security specialists and NOC staffing.'],
  ['Technology and SaaS', 'Product engineering squads, DevOps and cloud specialists.'],
  ['Public sector and education', 'Compliant staffing and portals for institutions and agencies.'],
];
const FAQS = [
  ['How quickly can you place a consultant?', 'For common roles we typically present screened profiles within a few business days. Niche or senior roles can take longer, and we say so up front instead of promising a date we cannot keep.'],
  ['Which engagement models do you support?', 'Contract (C2C, W2 or 1099), contract-to-hire, direct hire and SOW-based project teams. The model follows what fits your organization and the consultant.'],
  ['Do you work through prime vendors?', 'Yes. We work directly with end clients and as a subcontractor to prime vendors and staffing partners, with the paperwork handled by our team.'],
  ['How do timesheets and approvals work?', 'Consultants clock in and submit weekly hours in the employee portal. The client manager approves them in the client portal, StratEdge gives final approval, and invoicing follows the approved hours.'],
  ['Where do you operate?', 'We are based in Somerset, New Jersey, and place consultants across the United States, onsite, hybrid or remote.'],
  ['What roles do you cover?', 'Network engineering, SAP functional and technical, front-end and React, Java, Python and .NET, cloud and DevOps, healthcare IT, and finance and accounting, among others.'],
  ['How do I get access to the portals?', 'Click Log in, create an account, choose consultant or client contact and fill in your profile. StratEdge approves access, usually within one business day.'],
  ['Do you build software as well as staff projects?', 'Yes. Our delivery team builds web and mobile apps, custom software and SaaS, ERP/CRM implementations, DevOps and healthcare IT systems.'],
  ['How is pricing determined?', 'Rates depend on the role, location, duration and engagement model. The first consultation is free and ends with a written quote.'],
  ['How do I apply for a role?', 'Open roles are on the Careers page with an Apply button. You can also send a general application or email your resume to info@stratedgeitconsulting.com.'],
];
const ROLES = ['Network engineering', 'SAP functional & technical', 'Front-end & React', 'Java, Python & .NET engineering', 'Cloud & DevOps', 'Healthcare IT', 'Finance & accounting'];
const POSTS = [
  { s: 'cloud-efficiency', d: 'Jul 5', t: 'Maximizing cloud efficiency: tools and tactics', c: 'Cloud solutions', body: [
    'Cloud bills grow quietly. Idle instances, oversized databases and forgotten storage buckets rarely show up as a single line item, which is why most teams discover them months late. The first fix is visibility: tag every resource by team and project, and review spend weekly rather than at month end.',
    'Once you can see the spend, the tactics are well understood. Right-size compute from actual utilization instead of launch-day guesses. Schedule non-production environments to shut down overnight and on weekends. Move cold data to cheaper storage tiers, and buy committed-use discounts only for workloads that have proven steady.',
    'The native tools cover most of this: AWS Cost Explorer, Azure Cost Management and Google Cloud Billing all surface anomalies and recommendations. Infrastructure as code keeps environments from drifting, and autoscaling ties capacity to demand. StratEdge runs these reviews with client teams and implements the changes without disrupting production.'] },
  { s: 'mobile-apps-ai', d: 'Jul 3', t: 'The future of mobile apps: innovation and AI', c: 'App development', body: [
    'Mobile apps are moving from screens full of forms toward assistants that anticipate what people need. Models that run on the device make personalization fast and private, the camera and microphone are becoming primary inputs, and offline-first design is expected rather than optional.',
    'Planning for that future means thinking about privacy-preserving inference, accessibility from the first wireframe, and the wider family of surfaces an app now lives on: watches, tablets and TVs. Cross-platform frameworks keep a single codebase viable across all of them.',
    'Our advice is to start with one AI feature tied to a real user problem, measure whether it helps, and keep people in control of the outcome. StratEdge builds iOS, Android and cross-platform apps on exactly these foundations.'] },
  { s: 'engagement-models', d: 'Sep 20', t: 'C2C, W2 or 1099: choosing an engagement model', c: 'Staffing', body: [
    'The three letters on a staffing contract decide who pays taxes, who carries insurance and how quickly an engagement can start. Corp-to-corp (C2C) means the consultant works through their own company and invoices for hours; W2 means they are employed and paid through payroll; 1099 means an independent contractor paid directly.',
    'Clients usually care about three things: compliance, speed and continuity. W2 keeps classification simple. C2C suits experienced consultants who already run a business and carry their own coverage. 1099 fits short, well-defined work by established independents.',
    'StratEdge supports all three, plus contract-to-hire and direct hire, and we recommend the model only after seeing the role. The right choice is the one your legal and finance teams are comfortable with on day one.'] },
  { s: 'clean-timesheet-process', d: 'Sep 12', t: 'What a clean timesheet process looks like', c: 'Operations', body: [
    'Most billing disputes between vendors and clients trace back to the same thing: hours recorded in one place, approved in another, and invoiced from a third. By the time anyone notices a mismatch, three people have to be chased.',
    'A clean process has one record. The consultant logs hours during the week, attaches the client-signed sheet if the client uses one, and submits once. The client manager approves or returns it with a note. The staffing firm checks it against clocked time, gives final approval, and invoices from that approved number.',
    'That is exactly how our portals work: employee, client and admin views of the same timesheet, each with the decisions that belong to them. It removes the Friday scramble for signatures and gives everyone the same number.'] },
  { s: 'scaling-enterprise-systems', d: 'Jul 1', t: 'Scaling software systems for enterprise growth', c: 'Software engineering', body: [
    'Systems that served a hundred users comfortably start to strain at ten thousand. The usual culprits are a single overloaded database, synchronous calls between every component, and deployments that still depend on one person.',
    'Scale in steps. Add observability first so decisions rest on data. Then introduce caching and read replicas, move heavy work to asynchronous queues, and split services only where ownership boundaries are already clear. Rewriting everything at once is the most expensive way to grow.',
    'Process matters as much as architecture: continuous integration and delivery, automated testing, and runbooks for the people on call. StratEdge\u2019s software and DevOps teams help enterprises grow capacity without re-platforming the business.'] },
];
const STATS = [['120+', 'happy clients'], ['150+', 'projects delivered'], ['40+', 'tech experts'], ['60+', 'global collaborations']];

/* ================= Shell ================= */
const Logo = ({ white }) => white
  ? html`<img src=${LOGO_D} alt="StratEdge IT Consulting" width="220" height="56" />`
  : html`<${Fragment}><img className="logo-l" src=${LOGO_L} alt="StratEdge IT Consulting" width="220" height="56" /><img className="logo-d" src=${LOGO_D} alt="StratEdge IT Consulting" width="220" height="56" /><//>`;

function SiteHeader({ path }) {
  const [dd, setDd] = useState(false);
  const [sheet, setSheet] = useState(false);
  const ddRef = useRef(null);
  /* ddOpen mirrors dd synchronously (React may not have re-rendered between the mouseenter and the click of one tap); hoverAt remembers when a hover opened it */
  const ddOpen = useRef(false); const hoverAt = useRef(0);
  const openDd = v => { ddOpen.current = v; setDd(v); };
  const ddHover = e => { if (e && e.pointerType && e.pointerType !== 'mouse') return; hoverAt.current = Date.now(); openDd(true); };
  const ddClick = () => {
    /* Closed (or opened by the synthetic mouseenter of this same tap): open the menu. Already open from a hover or an earlier tap: go to Services. */
    if (ddOpen.current && Date.now() - hoverAt.current > 150) { openDd(false); location.hash = '#/services'; } else openDd(true);
  };
  useEffect(() => { openDd(false); setSheet(false); }, [path]);
  useEffect(() => {
    if (!dd) return;
    const f = e => { if (ddRef.current && !ddRef.current.contains(e.target)) openDd(false); };
    const k = e => { if (e.key === 'Escape') openDd(false); };
    addEventListener('mousedown', f); addEventListener('keydown', k);
    return () => { removeEventListener('mousedown', f); removeEventListener('keydown', k); };
  }, [dd]);
  const on = p => (p === '/' ? path === '/' : path.startsWith(p)) ? 'on' : '';
  return html`<${Fragment}>
    <div className="util"><div className="wrap">
      <a href=${'tel:' + CO.tel}>${CO.phone}</a>
      <a href=${'mailto:' + CO.email}>${CO.email}</a>
      <span className="hide-m">${CO.hours}</span>
      <a className="push hide-s" href=${CO.linkedin} target="_blank" rel="noopener">LinkedIn</a>
    </div></div>
    <header className="nav"><div className="wrap">
      <a className="brand" href="#/" aria-label="StratEdge IT Consulting home"><${Logo} /></a>
      <nav className="links" aria-label="Main">
        <a className=${on('/')} href="#/">Home</a>
        <a className=${on('/about')} href="#/about">About us</a>
        <div className="dd" ref=${ddRef} onPointerLeave=${window.PointerEvent ? (e => { if (!e.pointerType || e.pointerType === 'mouse') openDd(false); }) : undefined} onMouseLeave=${window.PointerEvent ? undefined : (() => openDd(false))}>
          <button type="button" aria-expanded=${dd} aria-haspopup="true" aria-controls="services-menu" onClick=${ddClick} onPointerEnter=${window.PointerEvent ? ddHover : undefined} onMouseEnter=${window.PointerEvent ? undefined : ddHover} className=${on('/services')}>Services <${Icon} n="chev" cls="sm" /></button>
          ${dd && html`<div className="dd-menu" id="services-menu">${SERVICES.map(s => html`<a key=${s.s} href=${'#/services/' + s.s}>${s.n}<small>${s.d}</small></a>`)}</div>`}
        </div>
        <a className=${on('/blog')} href="#/blog">Blog</a>
        <a className=${on('/careers')} href="#/careers">Careers</a>
        <a className=${on('/contact')} href="#/contact">Contact us</a>
      </nav>
      <div className="nav-cta">
        <button type="button" className="askbtn hide-m" onClick=${() => dispatchEvent(new CustomEvent('edge-open'))} aria-label="Ask the StratEdge assistant" title="Ask the assistant"><span className="askbot"><${Bot} small /></span></button>
        <a className="btn ghost hide-m" href="#/request-talent">Request talent</a>
        <a className="btn" href=${LOGIN}>Log in</a>
        <button type="button" className="btn ghost icon burger" aria-label="Open menu" onClick=${() => setSheet(true)}><${Icon} n="menu" /></button>
      </div>
    </div></header>
    ${sheet && html`<div className="sheet" role="dialog" aria-modal="true" aria-label="Menu">
      <div className="top-row"><a className="brand" href="#/"><${Logo} /></a><button type="button" className="btn ghost icon" aria-label="Close menu" onClick=${() => setSheet(false)}><${Icon} n="x" /></button></div>
      <a href="#/">Home</a><a href="#/about">About us</a><a href="#/services">Services</a>
      <div className="sub">${SERVICES.map(s => html`<a key=${s.s} href=${'#/services/' + s.s}>${s.n}</a>`)}</div>
      <a href="#/blog">Blog</a><a href="#/careers">Careers</a><a href="#/faq">FAQ</a><a href="#/contact">Contact us</a>
      <div className="actions"><a className="btn lg" href=${LOGIN}>Log in to the portal</a><a className="btn ghost lg" href="#/request-talent">Request talent</a></div>
    </div>`}
  <//>`;
}

function SiteFooter() {
  return html`<footer className="foot">
    <div className="wrap">
      <div><${Logo} white /><p>IT staffing, consulting and software delivery from Somerset, New Jersey.</p></div>
      <div><h4>Company</h4><ul><li><a href="#/about">About us</a></li><li><a href="#/services">Services</a></li><li><a href="#/request-talent">Request talent</a></li><li><a href="#/blog">Blog</a></li><li><a href="#/careers">Careers</a></li><li><a href="#/faq">FAQ</a></li><li><a href="#/contact">Contact us</a></li></ul></div>
      <div><h4>Services</h4><ul>${SERVICES.slice(0, 6).map(s => html`<li key=${s.s}><a href=${'#/services/' + s.s}>${s.n}</a></li>`)}</ul></div>
      <div><h4>Get in touch</h4><ul>
        <li><a href=${'tel:' + CO.tel}>${CO.phone}</a></li><li><a href=${'mailto:' + CO.email}>${CO.email}</a></li>
        <li><a href=${CO.map} target="_blank" rel="noopener">${CO.addr1}, ${CO.addr2}</a></li>
        <li><a href=${CO.linkedin} target="_blank" rel="noopener">LinkedIn</a></li><li><a href=${LOGIN + '?as=consultant'}>Consultant portal</a></li><li><a href=${LOGIN + '?as=employee'}>Employee portal</a></li><li><a href=${LOGIN + '?as=bench'}>Bench sales portal</a></li><li><a href=${LOGIN + '?as=client'}>Client portal</a></li>
        <li><button type="button" className="btn sm go" style=${{ marginTop: 8 }} onClick=${() => dispatchEvent(new CustomEvent('edge-open'))}><${Icon} n="chat" />Ask the StratEdge assistant</button></li></ul></div>
    </div>
    <div className="legal"><div className="wrap">
      <span>© ${new Date().getFullYear()} ${CO.legal}. All rights reserved. <${PortalStatus} /></span>
      <span><a href="#/terms">Terms of use</a><a style=${{ marginLeft: 18 }} href="#/privacy">Privacy policy</a></span>
    </div></div>
  </footer>`;
}

/* ================= Sections ================= */
const HERO_WORDS = ['network engineers', 'SAP consultants', 'React developers', 'DevOps engineers', 'healthcare IT teams', 'finance professionals'];
const EDGE_PROMPTS = ['Need SAP consultants by next month?', 'Ask me how timesheets work.', 'Want a quote for a project team?', 'Curious about C2C vs W2?'];
function Mascot({ size }) {
  return html`<div className="mascot" style=${{ width: size || 120, height: size || 120 }}><${Bot} big /></div>`;
}
function HeroVisual() {
  return html`<div className="hv" aria-hidden="true">
    <div className="hv-card hv-profile"><div className="hv-head"><span className="av">AK</span><div><b>Anirudh K.</b><span>SAP PP/QM Consultant · Edison, NJ</span></div></div><div className="hv-tags"><span>S/4HANA</span><span>PP</span><span>QM</span><span>H-1B</span></div><div className="hv-row"><span>RTR received</span><${Chip} s="ok">Verified<//></div></div>
    <div className="hv-card hv-ts"><div className="hv-title">Timesheet · week of Sep 28</div><div className="hv-bars">${[8, 8, 8, 8, 8].map((h, i) => html`<i key=${i} style=${{ height: h * 9 + 'px' }} />`)}</div><div className="hv-row"><b>40.0 h</b><${Chip} s="ok">Client approved<//></div></div>
    <div className="hv-card hv-report"><div className="hv-title">This week</div><div className="hv-nums"><div><b>14</b><span>submitted</span></div><div><b>6</b><span>interviews</span></div><div><b>2</b><span>offers</span></div></div></div>
    <div className="hv-mascot"><${Mascot} size=${96} /><span className="hv-bubble">Hi! Ask me anything</span></div>
  </div>`;
}
function Hero() {
  return html`<section className="hero"><div className="wrap">
    <div className="hero-copy">
      <div className="kicker">IT staffing · Software · Cloud · Healthcare IT</div>
      <h1>The right IT people, <em>on your project in days.</em></h1>
      <p className="lead">StratEdge places screened IT and business professionals with US clients and prime vendors, and builds the software, cloud and healthcare systems behind them. One consultant or a full project team, with the paperwork handled.</p>
      <div className="actions"><a className="btn lg" href="#/contact">Book a free consultation</a><a className="btn ghost lg" href="#/request-talent">Request talent</a></div>
      <ul className="hero-trust">${['Screened profiles with RTR in 2 to 5 days', 'Timesheets your managers approve online', 'C2C, W2, contract-to-hire or SOW teams'].map(x => html`<li key=${x}><${Icon} n="check" />${x}</li>`)}</ul>
    </div>
    <${HeroVisual} />
  </div></section>`;
}
const StatsBand = () => html`<section className="stats-band"><div className="wrap"><div className="stats-row">${STATS.map(([n, l]) => html`<${Counter} key=${l} n=${parseInt(n, 10)} suffix="+" label=${l} />`)}<div className="counter roles"><b>2–5</b><span>days to first profiles</span></div></div></div></section>`;
const PortalBand = () => html`<div className="band"><div className="wrap">
  <p><strong>Already working with StratEdge?</strong> Consultants upload a resume, see matched jobs and submit timesheets in the consultant portal. StratEdge staff use the employee portal, and bench sales recruiters the bench sales portal. Clients approve hours and post requirements in the client portal.</p>
  <div className="actions"><a className="btn go" href=${LOGIN + '?as=consultant'}>Consultant portal</a><a className="btn ghost" href=${LOGIN + '?as=employee'}>Employee portal</a><a className="btn ghost" href=${LOGIN + '?as=bench'}>Bench sales portal</a><a className="btn ghost" href=${LOGIN + '?as=client'}>Client portal</a></div></div></div>`;
const PORTALS = [
  { k: 'consultant', t: 'Consultant portal', d: 'For consultants placed by StratEdge, and those on the bench.', pts: ['Upload your resume and get matched to jobs collected from leading job boards every few hours', 'Save, track and apply to the roles that fit', 'Clock in, weekly timesheets, earnings and documents'] },
  { k: 'employee', t: 'Employee portal', d: 'For StratEdge staff: recruiters, delivery and office teams.', pts: ['Clock in and out from any device', 'Recruiting workspace: consultants, RTRs and submissions', 'Tasks, time off, onboarding and documents'] },
  { k: 'bench', t: 'Bench sales portal', d: 'For StratEdge bench sales recruiters who market consultants to vendors and clients.', pts: ['Job grabber: search every job source by keyword and publish roles to Careers', 'Submit a consultant to a role in one click with the right resume', 'Consultants, RTRs, submissions and the daily report'] },
  { k: 'client', t: 'Client portal', d: 'For the managers our consultants work with.', pts: ['Approve or return consultant timesheets', 'See who is on site and hours clocked', 'Post requirements and review candidates'] },
  { k: 'hr', t: 'HR & Accounting', d: 'For StratEdge HR and accounting staff.', pts: ['Onboarding, e-signatures and the ATS', 'Invoices, bills, payroll runs and paystubs', 'US and India tax calculations and reports'] },
  { k: 'admin', t: 'Admin portal', d: 'For StratEdge account managers.', pts: ['Final approvals, team and client setup', 'Attendance across every engagement', 'Hours exports for payroll and invoicing'] },
];
const PortalsSec = () => html`<section className="sec alt"><div className="wrap">
  <div className="kicker">Portals</div><h2>Six portals, one login</h2>
  <p className="intro">Everyone signs in with their own account and lands in the portal built for them.</p>
  <div className="portals">${PORTALS.map(p => html`<div key=${p.k} className="portal"><h3>${p.t}</h3><p>${p.d}</p><ul>${p.pts.map(x => html`<li key=${x}>${x}</li>`)}</ul>
    <a className=${'btn ' + (p.k === 'admin' || p.k === 'hr' ? 'ghost' : '')} href=${LOGIN + '?as=' + p.k}>${p.k === 'admin' ? 'Admin sign-in' : p.k === 'hr' ? 'HR sign-in' : p.k === 'bench' ? 'Open the bench sales portal' : 'Open the ' + p.t.toLowerCase()}</a></div>`)}</div>
</div></section>`;

function StaffingFeature() {
  return html`<div className="staff">
    <div><h3>Staffing services</h3>
      <p>Contract, contract-to-hire and direct-hire placements across IT and non-IT roles. We work with end clients directly and as a trusted subcontractor to prime vendors.</p>
      <div className="models">${['C2C', 'W2', '1099', 'Contract-to-hire', 'Direct hire', 'SOW project teams'].map(m => html`<span key=${m}>${m}</span>`)}</div>
      <div className="actions" style=${{ marginTop: 26 }}><a className="btn" href="#/services/staffing">How staffing works</a><a className="btn ghost" href="#/contact">Request talent</a></div>
    </div>
    <div className="facts">
      <div><b>100,000+</b><span>professionals in our talent network</span></div>
      <div><b>IT and beyond</b><span>Including healthcare, and finance & accounting roles</span></div>
      <div><b>One portal</b><span>Attendance, timesheets and approvals for every consultant</span></div>
    </div>
  </div>`;
}
const PILLARS = [
  ['users', 'Staffing', 'Contract, contract-to-hire and direct-hire placements across IT, healthcare and finance. Screened, compliant and tracked in the portal.', '#/services/staffing'],
  ['code', 'Software, web and cloud', 'Custom software, websites, mobile apps, DevOps and ERP/CRM delivered by our own teams.', '#/services/software-development'],
  ['heart', 'Healthcare IT', 'HIPAA-aligned EHR integration, telemedicine, patient portals and clinical SaaS.', '#/services/healthcare'],
];
function ServicesSec({ full }) {
  return html`<section className="sec" id="services"><div className="wrap">
    <div className="head-row"><div><div className="kicker">What we do</div><h2>People when you need people, delivery when you need a product</h2></div>${!full && html`<a className="btn ghost" href="#/services">All services and models</a>`}</div>
    ${!full && html`<div className="pillars">${PILLARS.map(([ic, t, d, href]) => html`<a key=${t} className="pillar" href=${href}><span className="pillar-ico"><${Icon} n=${ic} /></span><h3>${t}</h3><p>${d}</p><span className="more">Learn more</span></a>`)}</div>`}
    ${full ? html`<${ServicesExplorer} />` : html`<div className="svc-grid">${SERVICES.map(s => html`<a key=${s.s} className="svc-card" href=${'#/services/' + s.s}><span className="svc-ico"><${Icon} n=${SERVICE_ICON[s.s]} /></span><div><b>${s.n}</b><span>${s.d}</span></div></a>`)}</div>`}
    ${full && html`<${Fragment}>
      <div className="head-row" style=${{ marginTop: 80 }}><div><div className="kicker">Engagement models</div><h2 style=${{ fontSize: 34 }}>Pick the model that fits your organization</h2><p className="intro">Every placement runs on one of these. We recommend one only after seeing the role.</p></div></div>
      <${ModelsTable} />
    <//>`}
  </div></section>`;
}
const PlansSec = () => html`<section className="sec alt"><div className="wrap">
  <div className="head-row"><div><div className="kicker">Engagement plans</div><h2>Choose how you want to work with us</h2><p className="intro">Every plan includes screened profiles, onboarding paperwork, the client portal and a weekly report. Pricing follows a free consultation; we don\u2019t publish rates because every role is different.</p></div></div>
  <${PlanCards} />
  <p className="muted small" style=${{ marginTop: 18 }}>Not sure which fits? <a href="#/contact">Book a free consultation</a> and an account manager will recommend one.</p>
</div></section>`;
const BenefitsSec = () => html`<section className="sec"><div className="wrap">
  <div className="kicker">What you get</div><h2>What working with StratEdge gives you</h2><p className="intro">The things that come with every engagement, whether you need one person or a team.</p>
  <${BenefitsGrid} />
</div></section>`;
const WalkSec = () => html`<section className="sec"><div className="wrap">
  <div className="head-row"><div><div className="kicker">How it works</div><h2>From request to delivery in five steps</h2><p className="intro">A 30-second tour of how an engagement runs. Hover to pause, or click a step.</p></div></div>
  <${Walkthrough} />
</div></section>`;
const CommitSec = () => html`<section className="sec alt"><div className="wrap">
  <div className="kicker">Our commitment</div><h2>What we commit to</h2><p className="intro">Clear work you can check every week.</p>
  <div className="commit">
    <div><h3>Every business day</h3><ul className="ticks"><li>Screening and submissions for open requirements</li><li>Follow-ups with consultants and your managers</li><li>Updates as soon as a candidate or client responds</li></ul></div>
    <div><h3>Every week</h3><ul className="ticks"><li>An engagement report with every submission and its status</li><li>Timesheets reviewed and approved hours confirmed</li><li>Adjustments to the search based on your feedback</li></ul></div>
    <div className="honest"><h3>What no one can honestly promise</h3><p>A perfect hire in a day, or a guaranteed placement. Clients make the hiring decision and consultants choose where to work. We commit to the screening, the paperwork and the follow-through that make good engagements likely, and we tell you early when a role is hard to fill.</p></div>
  </div>
</div></section>`;
const HomeFaqSec = () => html`<section className="sec"><div className="wrap">
  <div className="head-row"><div><div className="kicker">Questions</div><h2>Common questions</h2></div><a className="btn ghost" href="#/faq">All questions</a></div>
  <div className="faqs" style=${{ maxWidth: 820 }}>${FAQS.slice(0, 6).map(([q, a]) => html`<details key=${q} className="faq"><summary>${q}</summary><p>${a}</p></details>`)}</div>
</div></section>`;
const PlannerSec = () => html`<section className="sec alt"><div className="wrap">
  <div className="head-row"><div><div className="kicker">Build Your Team</div><h2>Assemble the team, send it in one click</h2><p className="intro">Pick roles and headcount. Your plan becomes a talent request, and a recruiter comes back with a timeline and a quote.</p></div></div>
  <${TeamPlanner} />
</div></section>`;
const IndustriesSec = () => html`<section className="sec"><div className="wrap">
  <div className="kicker">Industries</div><h2>Industries we serve</h2>
  <p className="intro">The same people and delivery methods, shaped by the rules and systems of each sector.</p>
  <div className="inds">${INDUSTRIES.map(([n, d]) => html`<div key=${n} className="ind"><h3>${n}</h3><p>${d}</p></div>`)}</div>
</div></section>`;
function HealthSec() {
  const s = SERVICES.find(x => x.s === 'healthcare');
  return html`<section className="sec alt"><div className="wrap hc">
    <div><div className="kicker">Healthcare</div><h2>Healthcare IT, built for compliance</h2>
      <p className="intro">We build and support systems for hospitals, clinics, diagnostic centers and medical research teams, with patient-centered design and the future of connected care in mind.</p>
      <ul>${s.inc.map(i => html`<li key=${i}>${i}</li>`)}</ul>
      <a className="btn" href="#/services/healthcare">Healthcare IT solutions</a>
    </div>
    <div className="stds" aria-label="Standards we build to"><span>Standards we build to</span><b>HIPAA</b><b>HL7</b><b>FHIR</b></div>
  </div></section>`;
}
function ProcessSec({ stats }) {
  return html`<section className="sec"><div className="wrap">
    <div className="kicker">Process</div><h2>How we work</h2>
    <p className="intro">Four steps from first call to delivery, whether you need one consultant or a full project team.</p>
    <div className="steps">
      <div className="step"><h3>Choose a service</h3><p>Tell us whether you need people, a product, or both.</p></div>
      <div className="step"><h3>Define requirements</h3><p>We map your goals, constraints and technical needs together.</p></div>
      <div className="step"><h3>Meet and plan</h3><p>Agree on scope, timeline and deliverables in a working session.</p></div>
      <div className="step"><h3>Deliver and support</h3><p>We place, build or launch, then stay on for ongoing support.</p></div>
    </div>

  </div></section>`;
}
function WhySec() {
  return html`<section className="sec"><div className="wrap why">
    <div><div className="kicker">Why Stratedge</div><h2>A partner that stays accountable</h2><p className="intro">Industry expertise paired with a client-first way of working, so every engagement is secure, scalable and built to last.</p></div>
    <dl>
      <div><dt>Custom web and app development</dt><dd>Built for your workflows instead of adapted from a template.</dd></div>
      <div><dt>UI/UX strategy</dt><dd>Interfaces designed around how your people actually work.</dd></div>
      <div><dt>Real-time monitoring and support</dt><dd>Systems watched and maintained long after launch.</dd></div>
      <div><dt>End-to-end digital transformation</dt><dd>From strategy and staffing through to delivery.</dd></div>
    </dl>
  </div></section>`;
}
function BlogSec({ title }) {
  return html`<section className="sec"><div className="wrap">
    ${title !== false && html`<div className="head-row"><div><div className="kicker">Insights</div><h2>Insights and updates</h2></div><a className="btn ghost" href="#/blog">All posts</a></div>`}
    <div className="posts">${POSTS.map(p => html`<a key=${p.s} className="post" href=${'#/blog/' + p.s}>
      <time>${p.d}</time><div><span className="cat">${p.c}</span><h3>${p.t}</h3></div><span className="muted small">Read article</span></a>`)}</div>
  </div></section>`;
}

/* ================= Contact & inquiries ================= */
async function submitInquiry(data, file) {
  const fd = new FormData();
  Object.entries(data).forEach(([k, v]) => fd.append(k, v == null ? '' : String(v)));
  if (file) fd.append('file', file, file.name);
  await upload('public_contact', fd);
  return true;
}
const mailtoFor = (subject, lines) => `mailto:${CO.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.filter(Boolean).join('\n'))}`;

function ContactForm() {
  const toast = useToast();
  const [f, setF] = useState({ n: '', e: '', ph: '', co: '', sv: '', msg: '' });
  const [ok, setOk] = useState(false);
  const [st, setSt] = useState('idle'); // idle | busy | sent | mail
  const [err, setErr] = useState('');
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const send = async e => {
    e.preventDefault();
    if (!f.n.trim() || !/^\S+@\S+\.\S+$/.test(f.e) || !f.msg.trim()) { setErr('Add your name, a valid email and a short message.'); return; }
    if (!ok) { setErr('Tick the box so we can contact you.'); return; }
    setErr(''); setSt('busy');
    try { await submitInquiry({ k: 'contact', ...f }); setSt('sent'); }
    catch (x) { setSt('mail'); toast(errText(x), true); }
  };
  if (st === 'sent') return html`<div className="cform"><h3>Thanks, ${firstName(f.n)}.</h3><p className="muted">Your message is with our team. We'll reply to ${f.e}.</p></div>`;
  if (st === 'mail') return html`<div className="cform"><h3>Send your message by email</h3>
    <p className="muted" style=${{ margin: '6px 0 18px' }}>The message couldn't be delivered through the site just now, so your details are ready in a new email to ${CO.email}.</p>
    <a className="btn lg" href=${mailtoFor('Consultation request: ' + (f.sv || 'General'), [`Name: ${f.n}`, `Email: ${f.e}`, f.ph && `Phone: ${f.ph}`, f.co && `Company: ${f.co}`, f.sv && `Service: ${f.sv}`, '', f.msg])}><${Icon} n="mail" />Open email</a></div>`;
  return html`<form className="cform form" onSubmit=${send} noValidate>
    <div><h3>Tell us about your need</h3><p className="muted small">Takes about a minute. The right person on our team gets back to you.</p></div>
    <div className="row2"><${Field} label="Full name"><input value=${f.n} onInput=${up('n')} autoComplete="name" required /><//><${Field} label="Work email"><input type="email" value=${f.e} onInput=${up('e')} autoComplete="email" required /><//></div>
    <div className="row2"><${Field} label="Phone"><input type="tel" value=${f.ph} onInput=${up('ph')} autoComplete="tel" /><//><${Field} label="Company"><input value=${f.co} onInput=${up('co')} autoComplete="organization" /><//></div>
    <${Field} label="What can we help with?"><select value=${f.sv} onChange=${up('sv')}><option value="">Choose a service</option>${SERVICES.map(s => html`<option key=${s.s}>${s.n}</option>`)}<option>Something else</option></select><//>
    <${Field} label="Message"><textarea value=${f.msg} onInput=${up('msg')} placeholder="Roles you're hiring for, or the project you have in mind" required /><//>
    <label className="check small"><input type="checkbox" checked=${ok} onChange=${e => setOk(e.target.checked)} /><span>I agree that StratEdge IT Consulting may contact me about its services by email, phone or text. Consent isn’t a condition of purchase.</span></label>
    ${err && html`<p className="err" role="alert">${err}</p>`}
    <div><button className="btn lg" disabled=${st === 'busy'}>${st === 'busy' ? 'Sending…' : 'Send request'}</button></div>
    <p className="muted small">We use these details as described in our <a href="#/privacy">privacy policy</a>.</p>
  </form>`;
}
function ContactSec() {
  return html`<section className="night"><div className="wrap contact">
    <div><div className="kicker">Contact</div><h2>Let's talk about your next hire or project</h2>
      <p className="muted" style=${{ marginTop: 16, fontSize: 18, maxWidth: '46ch' }}>Free consultation, no obligation. Here’s what happens after you send the form.</p>
      <ol className="next-steps"><li>An account manager calls or emails within one business day.</li><li>You walk through the role, timeline and engagement model together.</li><li>You get a plan and a written quote, with no obligation.</li></ol>
      <dl>
        <div><dt>Call us</dt><dd><a href=${'tel:' + CO.tel}>${CO.phone}</a></dd></div>
        <div><dt>Email</dt><dd><a href=${'mailto:' + CO.email}>${CO.email}</a></dd></div>
        <div><dt>Office</dt><dd><a href=${CO.map} target="_blank" rel="noopener">${CO.addr1}<br />${CO.addr2}</a></dd></div>
        <div><dt>Hours</dt><dd>${CO.hours}</dd></div>
      </dl>
    </div>
    <${ContactForm} />
  </div></section>`;
}

/* ================= Pages ================= */
const PageHead = ({ title, intro, crumb }) => html`<div className="phead"><div className="wrap">${crumb && html`<div className="crumb">${crumb}</div>`}<h1>${title}</h1>${intro && html`<p>${intro}</p>`}</div></div>`;
const Home = () => html`<${Fragment}><${Hero} /><${StatsBand} /><${ServicesSec} /><${WalkSec} /><${PlansSec} /><${BenefitsSec} /><${IndustriesSec} /><${HealthSec} /><${PlannerSec} /><${PortalsSec} /><${CommitSec} /><${AssistantSec} /><${HomeFaqSec} /><${BlogSec} /><${ContactSec} /><//>`;
const About = () => html`<${Fragment}>
  <${PageHead} title="About StratEdge" intro="We help organizations hire the right technical talent and build the systems that move their business forward." />
  <section className="sec"><div className="wrap"><div className="prose">
    <p>StratEdge IT Consulting was founded in 2024 and is based in Somerset, New Jersey. We work with end clients directly and alongside prime vendors, placing consultants across network engineering, SAP, software engineering, healthcare IT, and finance and accounting.</p>
    <p>Our delivery team covers web and mobile development, cloud and DevOps, ERP and CRM, and strategic IT consulting, so a staffing relationship can grow into a full project whenever you need it.</p>
    <p>However we work together, the goal is the same: technology that performs, stays secure and supports growth at every stage of your digital journey.</p>
  </div>
  <div className="counters" style=${{ marginTop: 56 }}>${STATS.map(([n, l]) => html`<${Counter} key=${l} n=${parseInt(n, 10)} suffix="+" label=${l} />`)}</div>
  <h2 style=${{ fontSize: 30, margin: '72px 0 24px' }}>What we stand for</h2>
  <div className="inds">${[['Accountable delivery', 'One team owns the outcome, from the first call to support after launch.'], ['Transparent terms', 'Engagement models, rates and timelines are explained before anything is signed.'], ['People first', 'Consultants get real support on assignment, and clients get people who stay.']].map(([n, d]) => html`<div key=${n} className="ind"><h3>${n}</h3><p>${d}</p></div>`)}</div>
  </div></section>
  <${IndustriesSec} /><${WhySec} /><${ProcessSec} /><${ContactSec} />
<//>`;
const ServicesPage = () => html`<${Fragment}><${PageHead} title="Services" intro="Staffing, software and consulting from one partner. Start with the people you need, and add delivery when you're ready." /><${ServicesSec} full /><${PlansSec} /><${PlannerSec} /><${WalkSec} /><${HealthSec} /><${CommitSec} /><${ContactSec} /><//>`;
function ServiceDetail({ slug }) {
  const s = SERVICES.find(x => x.s === slug); const x = SERVICE_EXTRA[slug] || {};
  if (!s) return html`<${NotFound} />`;
  return html`<${Fragment}>
    <${PageHead} crumb=${html`<a href="#/services">Services</a>`} title=${s.n} intro=${s.l} />
    <section className="sec"><div className="wrap">
      ${(x.time || x.team || x.models) && html`<div className="glance">${x.time && html`<div className="card"><span className="lbl2">Timeline</span><b>${x.time}</b></div>`}${x.team && html`<div className="card"><span className="lbl2">Typical team</span><b>${x.team}</b></div>`}${x.models && html`<div className="card"><span className="lbl2">Engagement</span><b>${x.models}</b></div>`}</div>`}
      <div className="g2" style=${{ gap: 48, alignItems: 'start' }}>
        <div><h2 style=${{ fontSize: 28, marginBottom: 24 }}>What we deliver</h2><ul className="incl">${(x.deliver || s.inc).map(i => html`<li key=${i}>${i}</li>`)}</ul></div>
        <div>${x.who && html`<${Fragment}><h2 style=${{ fontSize: 28, marginBottom: 12 }}>Who it's for</h2><p className="muted" style=${{ fontSize: 17, maxWidth: '48ch' }}>${x.who}</p><//>`}
          ${x.tech && html`<${Fragment}><h3 style=${{ fontSize: 18, margin: '28px 0 10px', fontStretch: '108%' }}>Technologies and specialties</h3><div className="models">${x.tech.map(t => html`<span key=${t}>${t}</span>`)}</div><//>`}</div>
      </div>
      ${x.faq && html`<div style=${{ marginTop: 56 }}><h2 style=${{ fontSize: 28, marginBottom: 16 }}>Common questions</h2><div className="faqs">${x.faq.map(([q, a]) => html`<details key=${q} className="faq"><summary>${q}</summary><p>${a}</p></details>`)}</div></div>`}
      <div className="actions" style=${{ marginTop: 36 }}><a className="btn lg" href="#/contact">Book a free consultation</a><a className="btn ghost lg" href=${'tel:' + CO.tel}>Call ${CO.phone}</a></div>
    </div></section>
    <${ProcessSec} />
    <section className="sec alt"><div className="wrap"><h2 style=${{ fontSize: 28, marginBottom: 20 }}>Other services</h2>
      <div className="svc-list">${SERVICES.filter(x => x.s !== s.s).map(x => html`<a key=${x.s} className="svc" href=${'#/services/' + x.s}><h3>${x.n}</h3><p>${x.d}</p></a>`)}</div></div></section>
  <//>`;
}
const BlogPage = () => html`<${Fragment}><${PageHead} title="Blog" intro="Notes from our team on cloud, apps and enterprise software." /><${BlogSec} title=${false} /><//>`;
function BlogPost({ slug }) {
  const p = POSTS.find(x => x.s === slug);
  if (!p) return html`<${NotFound} />`;
  return html`<${Fragment}>
    <${PageHead} crumb=${html`<a href="#/blog">Blog</a>`} title=${p.t} intro=${`${p.c}. Posted ${p.d}.`} />
    <section className="sec"><div className="wrap"><div className="prose">${p.body.map((t, i) => html`<p key=${i}>${t}</p>`)}</div>
      <div className="actions" style=${{ marginTop: 36 }}><a className="btn" href="#/contact">Talk to our team</a><a className="btn ghost" href="#/blog">More posts</a></div></div></section>
    <${BlogSec} />
  <//>`;
}
const LegalPage = ({ title, intro, sections }) => html`<${Fragment}>
  <${PageHead} title=${title} intro=${intro} />
  <section className="sec"><div className="wrap"><div className="prose">${sections.map(([h, t]) => html`<div key=${h}><h2 style=${{ fontSize: 24, marginBottom: 10 }}>${h}</h2><p>${t}</p></div>`)}
    <p className="muted small">Questions about these terms? Contact us at ${CO.email} or ${CO.phone}.</p></div></div></section><//>`;
const TermsPage = () => html`<${LegalPage} title="Terms of use" intro=${'These terms cover the use of this website and the StratEdge employee portal. Last updated ' + new Date().toLocaleDateString([], { month: 'long', year: 'numeric' }) + '.'} sections=${[
  ['Using this site', 'The content on this site describes StratEdge IT Consulting Inc. services and is provided for general information. It is not an offer, a quotation or professional advice, and engagements are governed by the agreement signed for each one.'],
  ['Accuracy', 'We keep the site current but make no guarantee that every detail is complete or error-free. Service descriptions, roles and figures may change without notice.'],
  ['Employee portal', 'Portal access is granted to StratEdge employees, consultants and approved staff. Each person is responsible for the accuracy of the attendance, timesheets and documents they submit, and for keeping their account to themselves. Access can be paused or withdrawn when an engagement ends.'],
  ['Intellectual property', 'The StratEdge name, logo and site content belong to StratEdge IT Consulting Inc. and may not be reused without written permission. Third-party names mentioned on this site belong to their respective owners.'],
  ['Changes', 'We may update these terms from time to time. Continued use of the site after an update means you accept the revised terms.'],
]} />`;
const PrivacyPage = () => html`<${LegalPage} title="Privacy policy" intro="How StratEdge IT Consulting Inc. collects and uses information through this website and the employee portal." sections=${[
  ['What we collect', 'When you contact us or apply for a role, we receive the details you send, such as your name, email, phone number, company and resume. In the employee portal, we collect the profile details you enter, clock-in and clock-out times, timesheets, time-off requests, task updates and the documents you upload.'],
  ['How we use it', 'Contact details are used to respond to your inquiry or application. Portal records are used to manage your engagement: approving timesheets, invoicing clients, running payroll, and keeping compliance documents on file.'],
  ['Who can see it', 'Portal records are visible to you and to StratEdge HR and management staff. Consultants cannot see one another\u2019s records. We share timesheet details with the client or vendor for the engagement they relate to, and with payroll and accounting providers as needed to pay you and bill clients.'],
  ['Retention and your choices', 'We keep engagement records for as long as required for accounting, tax and employment obligations, then remove them. You can review or update your profile in the portal at any time and ask us to correct or delete information by contacting us.'],
  ['Security', 'Portal data is stored on access-controlled infrastructure and protected by individual sign-in. Please report any concern about your account to us right away.'],
]} />`;

function ApplyModal({ job, onClose }) {
  const toast = useToast();
  const [f, setF] = useState({ n: '', e: '', ph: '', li: '', msg: '' });
  const [file, setFile] = useState(null);
  const [st, setSt] = useState('idle');
  const [err, setErr] = useState('');
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const send = async () => {
    if (!f.n.trim() || !/^\S+@\S+\.\S+$/.test(f.e)) { setErr('Add your name and a valid email.'); return; }
    setErr(''); setSt('busy');
    try { await submitInquiry({ k: 'apply', job: job ? job.id : '', jt: job ? job.ti : 'General application', ...f }, file); setSt('sent'); }
    catch (x) { setSt('mail'); toast(errText(x), true); }
  };
  const title = job ? 'Apply: ' + job.ti : 'Send your resume';
  if (st === 'sent') return html`<${Modal} title=${title} onClose=${onClose} foot=${html`<button type="button" className="btn" onClick=${onClose}>Done</button>`}><p>Application received. Our recruiting team will review it and contact you at ${f.e}.</p><//>`;
  if (st === 'mail') return html`<${Modal} title=${title} onClose=${onClose}>
    <p className="muted" style=${{ marginBottom: 16 }}>The application couldn't be sent through the site just now. Attach your resume to the email that opens instead.</p>
    <a className="btn lg" href=${mailtoFor('Application: ' + (job ? job.ti : 'General'), [`Name: ${f.n}`, `Email: ${f.e}`, f.ph && `Phone: ${f.ph}`, f.li && `LinkedIn: ${f.li}`, '', f.msg])}><${Icon} n="mail" />Open email</a><//>`;
  return html`<${Modal} title=${title} onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Cancel</button><button type="button" className="btn" disabled=${st === 'busy'} onClick=${send}>${st === 'busy' ? 'Sending…' : 'Submit application'}</button>`}>
    <div className="form">
      <div className="row2"><${Field} label="Full name"><input value=${f.n} onInput=${up('n')} autoComplete="name" /><//><${Field} label="Email"><input type="email" value=${f.e} onInput=${up('e')} autoComplete="email" /><//></div>
      <div className="row2"><${Field} label="Phone"><input type="tel" value=${f.ph} onInput=${up('ph')} /><//><${Field} label="LinkedIn or portfolio"><input value=${f.li} onInput=${up('li')} placeholder="https://" /><//></div>
      <${Field} label="Note to the recruiter"><textarea value=${f.msg} onInput=${up('msg')} placeholder="Availability, visa or work authorization, rate expectations" /><//>
      <div><span className="lbl">Resume</span>
        ${file ? html`<ul className="files" style=${{ marginTop: 8 }}><li><div className="fn"><b>${file.name}</b><span>${sizeLabel(file.size)}</span></div><button type="button" className="btn ghost sm" onClick=${() => setFile(null)}>Remove</button></li></ul>`
          : html`<div style=${{ marginTop: 8 }}><${FilePick} label="Add your resume." hint="PDF or Word (.docx), up to 5 MB." onFiles=${fs => setFile(fs[0])} /></div>`}
      </div>
      ${err && html`<p className="err" role="alert">${err}</p>`}
    </div><//>`;
}
function Careers() {
  const caps = useCaps();
  const jobs = useCol(caps && caps.db ? 'org/site/jobs' : null, 'at:desc');
  const [apply, setApply] = useState(undefined);
  const [q, setQ] = useState(''); const [fl, setFl] = useState({ loc: '', ty: '', md: '' });
  const all = jobs.docs.filter(j => j.open !== false);
  const opts = k => [...new Set(all.map(j => (j[k] || '').trim()).filter(Boolean))].sort();
  const ql = q.trim().toLowerCase();
  const open = all.filter(j => (!ql || [j.ti, j.loc, j.sk, j.d, j.ty, j.md].filter(Boolean).join(' ').toLowerCase().includes(ql)) && (!fl.loc || j.loc === fl.loc) && (!fl.ty || j.ty === fl.ty) && (!fl.md || j.md === fl.md));
  const isNew = j => j.at && Date.now() - j.at < 7 * 86400000;
  return html`<${Fragment}>
    <${PageHead} title="Careers" intro="Contract, contract-to-hire and full-time roles with StratEdge and our clients across the US." />
    <section className="sec"><div className="wrap">
      <div className="head-row"><h2 style=${{ fontSize: 30 }}>Open roles${all.length ? html` <span className="muted" style=${{ fontSize: 18, fontWeight: 500 }}>(${open.length === all.length ? all.length : open.length + ' of ' + all.length})</span>` : ''}</h2><button type="button" className="btn ghost" onClick=${() => setApply(null)}>Send a general application</button></div>
      ${all.length > 0 && html`<div className="jobs-filter"><input type="search" value=${q} onInput=${e => setQ(e.target.value)} placeholder="Search title, skills or location" aria-label="Search roles" />
        <select value=${fl.loc} onChange=${e => setFl({ ...fl, loc: e.target.value })} aria-label="Location"><option value="">All locations</option>${opts('loc').map(v => html`<option key=${v}>${v}</option>`)}</select>
        <select value=${fl.ty} onChange=${e => setFl({ ...fl, ty: e.target.value })} aria-label="Engagement"><option value="">All engagements</option>${opts('ty').map(v => html`<option key=${v}>${v}</option>`)}</select>
        <select value=${fl.md} onChange=${e => setFl({ ...fl, md: e.target.value })} aria-label="Work mode"><option value="">Any work mode</option>${opts('md').map(v => html`<option key=${v}>${v}</option>`)}</select></div>`}
      ${!caps || jobs.loading ? html`<${Spinner} label="Loading open roles…" />` : open.length ? html`<div className="jobs">${open.map(j => html`<div key=${j.id} className="job">
          <div><h3><a href=${'#/careers/' + j.id}>${j.ti}</a>${isNew(j) ? html` <span className="tag new">New</span>` : ''}</h3>${j.at ? html`<div className="muted small">Posted ${fmtDay(j.at)}</div>` : ''}${j.d && html`<p className="muted" style=${{ marginTop: 6, fontSize: 15.5, whiteSpace: 'pre-wrap' }}>${j.d.length > 320 ? j.d.slice(0, 320).replace(/\s+\S*$/, '') + '…' : j.d}</p>`}
            <div className="meta">${[j.loc, j.ty, j.md, j.sk].filter(Boolean).map(t => html`<span key=${t} className="tag">${t}</span>`)}</div></div>
          <div className="actions" style=${{ flexWrap: 'nowrap' }}><${ShareButton} job=${j} /><button type="button" className="btn" onClick=${() => setApply(j)}>Apply</button></div></div>`)}</div>`
        : all.length ? html`<div className="panel"><${Empty} title="No roles match that search" action=${html`<button type="button" className="btn ghost" onClick=${() => { setQ(''); setFl({ loc: '', ty: '', md: '' }); }}>Clear filters</button>`}>Try a broader search, or send a general application.<//></div>`
        : html`<div className="panel"><${Empty} title="No roles are posted right now">Send your resume and we'll match you with new positions as they open, or email it to ${CO.email}.<//></div>`}
    </div></section>
    <section className="sec alt"><div className="wrap"><h2 style=${{ fontSize: 30 }}>Working with StratEdge</h2>
      <div className="inds" style=${{ marginTop: 28 }}>${[['Your choice of engagement', 'C2C, W2, 1099, contract-to-hire or direct hire, explained before you sign.'], ['One portal for everything', 'Clock in, submit timesheets, request time off and keep documents in one place.'], ['A person to call', 'An account manager who knows your assignment and answers the phone.'], ['Room to grow', 'Short contracts often turn into longer ones and full-time offers with our clients.']].map(([n, d]) => html`<div key=${n} className="ind"><h3>${n}</h3><p>${d}</p></div>`)}</div>
    </div></section>
    <${PortalBand} />
    ${apply !== undefined && html`<${ApplyModal} job=${apply} onClose=${() => setApply(undefined)} />`}
  <//>`;
}
/* ---- share a particular job (link to its own page) ---- */
const jobLink = id => location.origin + location.pathname + '#/careers/' + id;
function ShareButton({ job, primary, small }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const url = jobLink(job.id); const title = `${job.ti} at ${CO.name}`;
  const text = `${job.ti}${job.loc ? ' in ' + job.loc : ''}${job.ty ? ' (' + job.ty + ')' : ''} at StratEdge IT Consulting`;
  const copy = async () => { try { await navigator.clipboard.writeText(url); toast('Link copied.'); } catch (e) { prompt('Copy this link', url); } };
  const native = async () => { try { await navigator.share({ title, text, url }); setOpen(false); } catch (e) { /* cancelled */ } };
  const [f, setF] = useState({ to_n: '', to_e: '', from_n: '', from_e: '', msg: '' }); const [st, setSt] = useState('idle');
  const upf = k => e => setF({ ...f, [k]: e.target.value });
  const sendMailShare = async e => {
    e.preventDefault();
    if (!f.from_n.trim() || !/^\S+@\S+\.\S+$/.test(f.to_e)) { toast('Add your name and a valid email for the person.', true); return; }
    setSt('busy');
    try { const r = await api('public_share', { id: job.id, ...f }); setSt(r.mailed ? 'sent' : 'fail'); if (!r.mailed) toast('The email could not be sent right now. Copy the link instead.', true); }
    catch (x) { setSt('idle'); toast(errText(x), true); }
  };
  const links = [
    ['LinkedIn', 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(url)],
    ['WhatsApp', 'https://wa.me/?text=' + encodeURIComponent(text + ' ' + url)],
    ['X', 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(url)],
    ['Facebook', 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url)],
    ['Email', 'mailto:?subject=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(text + '\n\n' + url)],
  ];
  return html`<${Fragment}>
    <button type="button" className=${'btn ' + (primary ? '' : 'ghost') + (small ? ' sm' : '')} onClick=${() => setOpen(true)} aria-haspopup="dialog"><${Icon} n="send" />Share</button>
    ${open && html`<${Modal} title=${'Share: ' + job.ti} onClose=${() => setOpen(false)}>
      <div className="stack" style=${{ gap: 14 }}>
        <p className="muted small" style=${{ margin: 0 }}>Send this role to someone who fits it. The link opens the job with its own Apply button.</p>
        <div style=${{ display: 'flex', gap: 8 }}><input readOnly value=${url} onFocus=${e => e.target.select()} aria-label="Job link" /><button type="button" className="btn" onClick=${copy}>Copy link</button></div>
        <div className="share-row">${typeof navigator.share === 'function' && html`<button type="button" className="btn ghost sm" onClick=${native}>Share…</button>`}${links.map(([n, h]) => html`<a key=${n} className="btn ghost sm" href=${h} target="_blank" rel="noopener noreferrer">${n}</a>`)}</div>
        ${st === 'sent' ? html`<div className="note ok"><span>Sent to ${f.to_e}. They get the job details and a View-and-apply link.</span></div>`
          : html`<form className="form share-mail" onSubmit=${sendMailShare} noValidate>
            <p className="lbl" style=${{ margin: 0 }}>Or email it to someone from here</p>
            <div className="row2"><${Field} label="Their name"><input value=${f.to_n} onInput=${upf('to_n')} /><//><${Field} label="Their email"><input type="email" value=${f.to_e} onInput=${upf('to_e')} /><//></div>
            <div className="row2"><${Field} label="Your name"><input value=${f.from_n} onInput=${upf('from_n')} autoComplete="name" /><//><${Field} label="Your email (for replies)"><input type="email" value=${f.from_e} onInput=${upf('from_e')} autoComplete="email" /><//></div>
            <${Field} label="Note (optional)"><input value=${f.msg} onInput=${upf('msg')} placeholder="e.g. This looks like your kind of project" maxLength="300" /><//>
            <div><button className="btn sm" disabled=${st === 'busy'}><${Icon} n="mail" />${st === 'busy' ? 'Sending…' : 'Email this job'}</button></div>
          </form>`}
      </div><//>`}
  <//>`;
}
function CareerJob({ id }) {
  const caps = useCaps();
  const job = useDoc(caps && caps.db ? `org/site/jobs/${id}` : null);
  const [apply, setApply] = useState(false);
  useEffect(() => { if (job.data) document.title = `${job.data.ti} | Careers | StratEdge IT Consulting`; }, [job.data]);
  if (!caps || job.loading) return html`<${PageHead} title="Careers" intro=${html`<${Spinner} label="Loading the role…" />`} />`;
  const j = job.data;
  if (!j || j.open === false) return html`<${Fragment}><${PageHead} crumb=${html`<a href="#/careers">Careers</a> / Role`} title="This role is no longer open" intro=${html`It may have been filled. <a href="#/careers">See the open roles</a> or send a general application.`} /><section className="sec"><div className="wrap"><a className="btn" href="#/careers">All open roles</a></div></section><//>`;
  return html`<${Fragment}>
    <${PageHead} crumb=${html`<a href="#/careers">Careers</a> / ${j.ti}`} title=${j.ti} intro=${[j.loc, j.ty, j.md].filter(Boolean).join(' · ')} />
    <section className="sec"><div className="wrap"><div className="g2" style=${{ gap: 48, alignItems: 'start' }}>
      <div className="prose">${j.d ? html`<p style=${{ whiteSpace: 'pre-wrap', fontSize: 17 }}>${j.d}</p>` : html`<p className="muted">Contact us for the full description.</p>`}
        ${j.sk && html`<div className="meta" style=${{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 20 }}>${j.sk.split(/,\s*/).filter(Boolean).map(t => html`<span key=${t} className="tag">${t}</span>`)}</div>`}
        ${j.src && j.src.credit && j.src.url && html`<p className="muted small" style=${{ marginTop: 16 }}>Originally listed on <a href=${j.src.url} target="_blank" rel="noopener">${j.src.portal || 'the job board'}</a>.</p>`}
        <div className="actions" style=${{ marginTop: 32 }}><button type="button" className="btn lg" onClick=${() => setApply(true)}>Apply for this role</button><${ShareButton} job=${j} /></div></div>
      <aside className="panel"><h3 style=${{ fontSize: 20, marginBottom: 12 }}>At a glance</h3>
        <dl className="kv">${j.loc && html`<dt>Location</dt><dd>${j.loc}</dd>`}${j.ty && html`<dt>Engagement</dt><dd>${j.ty}</dd>`}${j.md && html`<dt>Work mode</dt><dd>${j.md}</dd>`}<dt>Posted</dt><dd>${j.at ? fmtDay(j.at) : '—'}</dd><dt>Questions</dt><dd><a href=${'mailto:' + CO.email}>${CO.email}</a><br /><a href=${'tel:' + CO.tel}>${CO.phone}</a></dd></dl>
        <p className="muted small" style=${{ marginTop: 14 }}>Know someone who fits? Share the link; it opens this page with the Apply button.</p></aside>
    </div></div></section>
    <${PortalBand} />
    ${apply && html`<${ApplyModal} job=${{ ...j, id }} onClose=${() => setApply(false)} />`}
  <//>`;
}
const ContactPage = () => html`<${Fragment}><${PageHead} title="Contact us" intro="Hiring, a new project, or a question about an existing engagement? We're here Monday to Friday, 9 AM to 7 PM Eastern." /><${ContactSec} /><//>`;
const NotFound = () => html`<${PageHead} title="Page not found" intro=${html`That link doesn't match a page on this site. <a href="#/">Go to the home page</a>.`} />`;

function LoginPage({ q }) {
  const c = useCaps(); const toast = useToast();
  const as = q.as; const [mode, setMode] = useState(q.mode === 'register' ? 'register' : 'login');
  const [f, setF] = useState({ n: '', e: '', p: '', p2: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(q.expired ? 'Your session ended. Log in again to continue.' : '');
  const [wrong, setWrong] = useState('');
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const dest = '#/portal' + (as ? '?as=' + as : '');
  const LOGINS = [['consultant', 'Consultant'], ['employee', 'Employee'], ['bench', 'Bench sales'], ['client', 'Client']];
  const asName = { consultant: 'Consultant', employee: 'Employee', bench: 'Bench sales', client: 'Client', admin: 'Admin', hr: 'HR and accounting' }[as] || '';
  const submit = async e => {
    e.preventDefault(); setErr(''); setWrong('');
    if (!/^\S+@\S+\.\S+$/.test(f.e)) { setErr('Enter a valid email address.'); return; }
    if (mode === 'register') {
      if (f.n.trim().length < 2) { setErr('Add your full name.'); return; }
      if (f.p.length < 8) { setErr('Use a password of at least 8 characters.'); return; }
      if (f.p !== f.p2) { setErr('The two passwords don\u2019t match.'); return; }
    } else if (!f.p) { setErr('Enter your password.'); return; }
    setBusy(true);
    try {
      startLoginLocation();
      const r = mode === 'register' ? await api('register', { name: f.n.trim(), email: f.e.trim(), password: f.p }) : await api('login', { email: f.e.trim(), password: f.p, as: as || '' });
      await reloadCaps(); shareLoginLocation();
      if (mode === 'register' && r.first) toast('Administrator account created. You manage everything from the Admin section.');
      const staff = r.user && ['admin', 'hr', 'acct'].includes(r.user.role);
      location.hash = staff && mode === 'login' && (!as || as === 'admin' || as === 'hr') ? (as === 'hr' && r.user.role !== 'admin' ? '#/portal/hr' : '#/portal/admin') : (mode === 'login' && r.portal ? '#/portal?as=' + portalKeyOf(r.portal) : dest);
    } catch (x) { if (x && x.code === 'wrong_portal') { setWrong(x.portal || ''); setErr(x.message); } else setErr(errText(x)); }
    setBusy(false);
  };
  const me = c && c.me;
  let body;
  if (!c) body = html`<${Spinner} label="Checking your sign-in…" />`;
  else if (c.state === 'ready') body = html`<${Fragment}>
      <div className="who"><img src=${me.avatarUrl} alt="" /><div><b>${me.name || 'Your account'}</b><span className="muted small">${c.roleName === 'admin' ? 'Admin access' : c.isHR ? 'HR access' : c.isAcct ? 'Accounting access' : me.email}</span></div></div>
      <p className="lbl" style=${{ marginBottom: 8 }}>Open your portal</p>
      <div className="stack" style=${{ gap: 8 }}>
        ${c.portal ? html`<a className="btn lg" href=${'#/portal?as=' + portalKeyOf(c.portal)}>${portalLabel(c.portal)}</a>`
          : c.isAdmin ? null : html`<${Fragment}><a className=${'btn lg' + (as === 'consultant' || !as ? '' : ' ghost')} href="#/portal?as=consultant">Consultant portal</a><a className=${'btn lg' + (as === 'employee' ? '' : ' ghost')} href="#/portal?as=employee">Employee portal</a><a className=${'btn lg' + (as === 'bench' ? '' : ' ghost')} href="#/portal?as=bench">Bench sales portal</a><a className=${'btn lg' + (as === 'client' ? '' : ' ghost')} href="#/portal?as=client">Client portal</a><//>`}
        ${(c.isHR || c.roleName === 'admin') && html`<a className="btn lg soft" href="#/portal/hr">HR portal</a>`}
        ${(c.isAcct || c.roleName === 'admin') && html`<a className="btn lg soft" href="#/portal/acct">Accounting portal</a>`}
        ${c.roleName === 'admin' && html`<a className="btn lg soft" href="#/portal/admin">Admin portal</a>`}
      </div>
      <p className="muted small" style=${{ marginTop: 16 }}>Your account decides what you see: consultants get the consultant portal, StratEdge staff the employee portal, bench sales recruiters the bench sales portal, client contacts the client portal. <button type="button" className="btn link small" onClick=${logout}>Log out</button></p>
    <//>`;
  else if (c.state === 'none') body = html`<p className="muted">The portal server isn\u2019t reachable right now. Try again in a few minutes, or email ${CO.email}.</p>`;
  else body = html`<${Fragment}>
      ${as !== 'admin' && as !== 'hr' && html`<div className="seg logins" role="group" aria-label="Which login">${LOGINS.map(([k, v]) => html`<a key=${k} className=${(as || 'consultant') === k ? 'on' : ''} href=${'#/login?as=' + k + (mode === 'register' ? '&mode=register' : '')}>${v}</a>`)}</div>`}
      <div className="tabs" role="tablist">${[['login', 'Log in'], ['register', 'Create account']].map(([k, v]) => html`<button key=${k} type="button" role="tab" aria-selected=${mode === k} className=${mode === k ? 'on' : ''} onClick=${() => { setMode(k); setErr(''); }}>${v}</button>`)}</div>
      <form className="form" onSubmit=${submit} noValidate>
        ${mode === 'register' && html`<${Field} label="Full name"><input value=${f.n} onInput=${up('n')} autoComplete="name" /><//>`}
        <${Field} label="Email"><input type="email" value=${f.e} onInput=${up('e')} autoComplete=${mode === 'register' ? 'email' : 'username'} /><//>
        <${Field} label="Password" hint=${mode === 'register' ? 'At least 8 characters.' : null}><input type="password" value=${f.p} onInput=${up('p')} autoComplete=${mode === 'register' ? 'new-password' : 'current-password'} /><//>
        ${mode === 'register' && html`<${Field} label="Confirm password"><input type="password" value=${f.p2} onInput=${up('p2')} autoComplete="new-password" /><//>`}
        ${err && html`<p className="err" role="alert">${err}${wrong && html` <a href=${'#/login?as=' + wrong}>Go to the ${wrong} login</a>`}</p>`}
        <div><button type="submit" className="btn lg" style=${{ width: '100%' }} disabled=${busy}>${busy ? 'Please wait…' : mode === 'register' ? 'Create ' + (asName && as !== 'admin' && as !== 'hr' ? asName.toLowerCase() + ' ' : '') + 'account' : asName ? asName + ' log in' : 'Log in'}</button></div>
        ${mode === 'login' ? html`<p className="muted small">Forgot your password? Contact StratEdge HR at <a href=${'mailto:' + CO.email}>${CO.email}</a> and they can reset it.<br />For security, the time, network address and approximate location of each sign-in are recorded; sharing your precise location when the browser asks is optional.</p>`
          : html`<p className="muted small">${as === 'consultant' ? 'After you create your account you\u2019ll fill in a short profile and upload your resume; StratEdge approves your access and matched jobs start appearing.' : as === 'employee' ? 'Employee accounts are for StratEdge staff. After you create yours, an administrator approves it.' : as === 'bench' ? 'Bench sales recruiter accounts are for StratEdge recruiters who market consultants. After you create yours, an administrator approves it.' : 'After you create your account you\u2019ll fill in a short profile, then StratEdge approves your access.'}</p>`}
      </form>
    <//>`;
  return html`<div className="login">
    <div className="blade"><h1>${as === 'client' ? 'Client portal' : as === 'admin' ? 'Admin portal' : as === 'hr' ? 'HR and accounting portal' : as === 'employee' ? 'Employee portal' : as === 'bench' ? 'Bench sales portal' : as === 'consultant' ? 'Consultant portal' : 'StratEdge portals'}</h1>
      <ul>${(PORTALS.find(p => p.k === (as || 'consultant')) || PORTALS[0]).pts.map((r, i) => html`<li key=${r} style=${{ animationDelay: (0.1 + i * 0.06) + 's' }}>${r}</li>`)}</ul></div>
    <div className="login-card"><h2>${mode === 'register' && !(c && c.state === 'ready') ? 'Create your ' + (asName && as !== 'admin' && as !== 'hr' ? asName.toLowerCase() + ' ' : '') + 'account' : asName && as !== 'admin' && as !== 'hr' ? asName + ' log in' : 'Log in'}</h2>${body}</div>
  </div>`;
}

const FaqPage = () => html`<${Fragment}>
  <${PageHead} title="Frequently asked questions" intro="Straight answers about how we staff, build and bill. Anything missing? Ask the assistant in the corner, or contact the team." />
  <section className="sec"><div className="wrap"><div className="faqs" style=${{ maxWidth: 820 }}>${FAQS.map(([q, a]) => html`<details key=${q} className="faq"><summary>${q}</summary><p>${a}</p></details>`)}</div>
    <div className="actions" style=${{ marginTop: 36 }}><a className="btn" href="#/contact">Contact us</a><button type="button" className="btn ghost" onClick=${() => dispatchEvent(new CustomEvent('edge-open'))}><${Icon} n="chat" />Ask the assistant</button></div></div></section>
<//>`;
function RequestTalent({ q }) {
  const toast = useToast();
  const plan = useMemo(() => { try { return q && q.plan ? JSON.parse(q.plan) : null; } catch (e) { return null; } }, [q && q.plan]);
  const [f, setF] = useState({ co: '', n: '', e: '', ph: '', jt: plan && plan.roles ? plan.roles.join(', ') : '', cnt: plan && plan.roles ? String(plan.roles.reduce((a, r) => a + (parseInt(r, 10) || 1), 0)) : '1', loc: (plan && plan.loc) || '', ty: (plan && plan.ty) || 'C2C', md: (plan && plan.md) || 'Onsite', sd: (plan && plan.sd) || '', sk: '', msg: plan && plan.roles ? 'Team plan from the website:\n' + plan.roles.join('\n') : '' });
  const [st, setSt] = useState('idle'); const [err, setErr] = useState('');
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const send = async e => {
    e.preventDefault();
    if (!f.n.trim() || !/^\S+@\S+\.\S+$/.test(f.e) || !f.jt.trim()) { setErr('Add your name, a valid email and the role you need.'); return; }
    setErr(''); setSt('busy');
    const details = [`Role: ${f.jt}`, `Headcount: ${f.cnt}`, f.loc && `Location: ${f.loc}`, `Engagement: ${f.ty}`, `Work mode: ${f.md}`, f.sd && `Target start: ${f.sd}`, f.sk && `Skills: ${f.sk}`, f.msg && `Notes: ${f.msg}`].filter(Boolean).join('\n');
    try { await submitInquiry({ k: 'talent', n: f.n, e: f.e, ph: f.ph, co: f.co, sv: 'Staffing services', jt: f.jt, msg: details }); setSt('sent'); }
    catch (x) { setSt('mail'); toast(errText(x), true); }
  };
  return html`<${Fragment}>
    <${PageHead} title="Request talent" intro=${plan ? 'Your team plan is filled in below. Add your details and send it; a recruiter comes back with a timeline and a quote.' : 'Tell us who you need. A recruiter reviews it and comes back with a plan, a timeline and a quote. The consultation is free.'} />
    <section className="sec"><div className="wrap"><div className="g2" style=${{ gap: 48, alignItems: 'start' }}>
      ${st === 'sent' ? html`<div className="panel"><h3 style=${{ fontSize: 24, marginBottom: 8 }}>Thanks, ${firstName(f.n)}.</h3><p className="muted">Your request for ${f.jt} is with our recruiting team. We'll reply to ${f.e}${f.ph ? ' or call ' + f.ph : ''}.</p></div>`
        : st === 'mail' ? html`<div className="panel"><h3 style=${{ fontSize: 22, marginBottom: 8 }}>Send it by email instead</h3><p className="muted" style=${{ marginBottom: 16 }}>The request couldn't be sent through the site just now. Your details are ready in a new email.</p>
          <a className="btn lg" href=${mailtoFor('Talent request: ' + f.jt, [`Company: ${f.co}`, `Name: ${f.n}`, `Email: ${f.e}`, `Phone: ${f.ph}`, '', `Role: ${f.jt}`, `Headcount: ${f.cnt}`, `Location: ${f.loc}`, `Engagement: ${f.ty}`, `Work mode: ${f.md}`, `Start: ${f.sd}`, `Skills: ${f.sk}`, '', f.msg])}><${Icon} n="mail" />Open email</a></div>`
        : html`<form className="panel form" onSubmit=${send} noValidate>
          <div className="row2"><${Field} label="Company"><input value=${f.co} onInput=${up('co')} autoComplete="organization" /><//><${Field} label="Your name"><input value=${f.n} onInput=${up('n')} autoComplete="name" /><//></div>
          <div className="row2"><${Field} label="Work email"><input type="email" value=${f.e} onInput=${up('e')} autoComplete="email" /><//><${Field} label="Phone"><input type="tel" value=${f.ph} onInput=${up('ph')} autoComplete="tel" /><//></div>
          <div className="row2"><${Field} label="Role you need"><input value=${f.jt} onInput=${up('jt')} placeholder="e.g. SAP PP/QM Analyst" /><//><${Field} label="How many"><input type="number" min="1" value=${f.cnt} onInput=${up('cnt')} /><//></div>
          <div className="row3"><${Field} label="Location"><input value=${f.loc} onInput=${up('loc')} placeholder="City, state" /><//>
            <${Field} label="Engagement"><select value=${f.ty} onChange=${up('ty')}>${['C2C', 'W2', '1099', 'Contract-to-hire', 'Direct hire', 'SOW project team', 'Not sure yet'].map(t => html`<option key=${t}>${t}</option>`)}</select><//>
            <${Field} label="Work mode"><select value=${f.md} onChange=${up('md')}>${['Onsite', 'Hybrid', 'Remote'].map(t => html`<option key=${t}>${t}</option>`)}</select><//></div>
          <div className="row2"><${Field} label="Target start"><input type="date" value=${f.sd} onInput=${up('sd')} /><//><${Field} label="Must-have skills"><input value=${f.sk} onInput=${up('sk')} placeholder="e.g. S/4HANA, PP, QM" /><//></div>
          <${Field} label="Anything else"><textarea value=${f.msg} onInput=${up('msg')} placeholder="Project, duration, interview process, budget range if you have one" /><//>
          ${err && html`<p className="err" role="alert">${err}</p>`}
          <div><button className="btn lg" disabled=${st === 'busy'}>${st === 'busy' ? 'Sending…' : 'Send request'}</button></div>
        </form>`}
      <div className="stack"><h2 style=${{ fontSize: 28 }}>What happens next</h2>
        <div className="steps" style=${{ gridTemplateColumns: '1fr', marginTop: 8 }}>
          <div className="step"><h3>We review it the same day</h3><p>A recruiter reads the requirement and calls or emails with any questions.</p></div>
          <div className="step"><h3>You get a plan and a quote</h3><p>Engagement model, rate range and a realistic timeline, in writing.</p></div>
          <div className="step"><h3>Screened candidates arrive</h3><p>Profiles land in your client portal, where you shortlist and request interviews.</p></div>
          <div className="step"><h3>Onboarding and timesheets run through us</h3><p>Paperwork, clock-ins and weekly approvals happen in the portal.</p></div>
        </div></div>
    </div></div></section>
  <//>`;
}
function ThemeToggle() {
  const [t, setT] = useState(themeNow());
  const flip = () => { const n = t === 'dark' ? 'light' : 'dark'; setTheme(n); setT(n); };
  return html`<button type="button" className="btn ghost icon" onClick=${flip} aria-label=${t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} title=${t === 'dark' ? 'Light mode' : 'Dark mode'}><${Icon} n=${t === 'dark' ? 'sun' : 'moon'} /></button>`;
}

/* ================= Edge, the 3D assistant ================= */
function Bot({ small, talking }) {
  const ref = useRef(null);
  const move = e => { const el = ref.current; if (!el) return; const r = el.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5; el.style.setProperty('--ry', (x * 34) + 'deg'); el.style.setProperty('--rx', (-y * 22) + 'deg'); };
  const leave = () => { const el = ref.current; if (el) { el.style.removeProperty('--ry'); el.style.removeProperty('--rx'); } };
  return html`<div className=${'bot' + (small ? ' sm' : '') + (talking ? ' talking' : '')} onMouseMove=${move} onMouseLeave=${leave} aria-hidden="true">
    <div className="bot-scale"><div className="bot-body">
      <div className="bot-ant"><i /></div>
      <div className="bot-turn"><div className="bot-head" ref=${ref}>
        <div className="face front"><span className="eye l" /><span className="eye r" /><span className="cheek l" /><span className="cheek r" /><span className="mouth" /></div>
        <div className="face back" /><div className="face left" /><div className="face right" /><div className="face top" /><div className="face bottom" />
      </div></div>
      <div className="bot-ring" />
    </div><div className="bot-shadow" /></div>
  </div>`;
}
const EDGE_HELLO = { role: 'assistant', content: "Hi, I'm the StratEdge assistant. Ask me about our services, staffing, the portals, careers, or how to reach the team." };
const EDGE_SUGS = ['What services do you offer?', 'How do I submit a timesheet?', 'How do I request talent?', 'How do I get portal access?'];
function EdgeBot() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState(() => { try { return JSON.parse(sessionStorage.getItem('edge-chat') || 'null') || [EDGE_HELLO]; } catch (e) { return [EDGE_HELLO]; } });
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const [talk, setTalk] = useState(false);
  const [tip, setTip] = useState(() => { try { return !sessionStorage.getItem('edge-tip'); } catch (e) { return true; } });
  const [tipI, setTipI] = useState(0);
  useEffect(() => { if (!tip || open || REDUCED()) return; const t = setInterval(() => setTipI(i => i + 1), 5000); return () => clearInterval(t); }, [tip, open]);
  const [sugs, setSugs] = useState(EDGE_SUGS);
  const box = useRef(null); const inp = useRef(null);
  const pendingQ = useRef('');
  useEffect(() => { const f = e => { setOpen(true); if (e.detail && e.detail.ask) pendingQ.current = e.detail.ask; }; addEventListener('edge-open', f); return () => removeEventListener('edge-open', f); }, []);
  useEffect(() => { if (open && pendingQ.current) { const q = pendingQ.current; pendingQ.current = ''; setTimeout(() => ask(q), 150); } }, [open]);
  useEffect(() => { try { sessionStorage.setItem('edge-chat', JSON.stringify(msgs.slice(-30))); } catch (e) {} if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [msgs, open, busy]);
  useEffect(() => { if (open) { setTip(false); try { sessionStorage.setItem('edge-tip', '1'); } catch (e) {} setTimeout(() => inp.current && inp.current.focus(), 50); } }, [open]);
  useEffect(() => { if (!tip) return; const t = setTimeout(() => setTip(false), 22000); return () => clearTimeout(t); }, [tip]);
  useEffect(() => { if (!open) return; const k = e => { if (e.key === 'Escape') setOpen(false); }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [open]);
  const ask = async q => {
    const content = (q || text).trim(); if (!content || busy) return;
    const next = [...msgs, { role: 'user', content }]; setMsgs(next); setText(''); setBusy(true);
    try {
      const r = await api('chat', { messages: next.filter(m => m.content !== EDGE_HELLO.content).slice(-12) });
      setMsgs(m => [...m, { role: 'assistant', content: r.reply }]); if (r.suggestions) setSugs(r.suggestions);
      setTalk(true); setTimeout(() => setTalk(false), Math.min(6000, 1200 + r.reply.length * 25));
    } catch (e) { setMsgs(m => [...m, { role: 'assistant', content: e.code === 'rate_limited' ? e.message : `I can't reach the server right now. You can always reach the team at ${CO.phone} or ${CO.email}.` }]); }
    setBusy(false);
  };
  return html`<${Fragment}>
    ${open && html`<section className="edge" role="dialog" aria-label="Chat with the StratEdge assistant">
      <div className="edge-h"><${Bot} small talking=${busy || talk} /><div style=${{ flex: 1, minWidth: 0 }}><b>StratEdge</b><span>AI assistant</span></div>
        <button type="button" className="btn ghost icon" onClick=${() => { setMsgs([EDGE_HELLO]); setSugs(EDGE_SUGS); }} aria-label="Start over" title="Start over"><${Icon} n="trash" /></button>
        <button type="button" className="btn ghost icon" onClick=${() => setOpen(false)} aria-label="Close chat"><${Icon} n="x" /></button></div>
      <div className="edge-m" ref=${box} aria-live="polite">${msgs.map((m, i) => html`<div key=${i} className=${'msg ' + (m.role === 'user' ? 'u' : 'b')}>${m.content}</div>`)}
        ${busy && html`<div className="msg b typing"><i /><i /><i /></div>`}</div>
      ${!busy && html`<div className="sugs">${sugs.slice(0, 4).map(s => html`<button key=${s} type="button" onClick=${() => ask(s)}>${s}</button>`)}</div>`}
      <div className="quick"><a href="#/request-talent" onClick=${() => setOpen(false)}><${Icon} n="users" />Request talent</a><a href="#/login?as=consultant" onClick=${() => setOpen(false)}><${Icon} n="user" />Consultant portal</a><a href="#/login?as=employee" onClick=${() => setOpen(false)}><${Icon} n="users" />Employee portal</a><a href="#/login?as=bench" onClick=${() => setOpen(false)}><${Icon} n="search" />Bench sales portal</a><a href=${'tel:' + CO.tel}><${Icon} n="phone" />Call us</a></div>
      <form className="edge-f" onSubmit=${e => { e.preventDefault(); ask(); }}>
        <input ref=${inp} value=${text} onInput=${e => setText(e.target.value)} placeholder="Ask about services, timesheets, careers…" maxLength="1500" aria-label="Your question" />
        <button className="btn icon" aria-label="Send" disabled=${busy || !text.trim()}><${Icon} n="send" /></button></form>
      <p className="edge-note">The assistant can make mistakes. For anything important, call ${CO.phone}.</p>
    </section>`}
    <div className="edge-launch">
      ${tip && !open && html`<div className="edge-tip" role="status" key=${tipI}>${["Hi, I'm the StratEdge assistant. Ask me anything.", ...EDGE_PROMPTS][tipI % (EDGE_PROMPTS.length + 1)]}</div>`}
      <button type="button" className="edge-btn" onClick=${() => setOpen(o => !o)} aria-label=${open ? 'Close chat' : 'Chat with the StratEdge assistant'} aria-expanded=${open}><span className="sonar" /><${Bot} talking=${busy || talk} /></button>
    </div>
  <//>`;
}

/* ================= Website effects ================= */
const REDUCED = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function FxLayer() {
  const cv = useRef(null);
  useEffect(() => {
    const c = cv.current; if (!c) return;
    const x = c.getContext('2d'); let raf = 0, live = true, w = 0, h = 0, pts = [];
    const dpr = Math.min(1.5, window.devicePixelRatio || 1); const mobile = innerWidth < 760;
    const resize = () => { w = innerWidth; h = innerHeight; c.width = w * dpr; c.height = h * dpr; c.style.width = w + 'px'; c.style.height = h + 'px'; x.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = mobile ? 34 : Math.min(90, Math.round(w * h / 22000)); pts = Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - .5) * .22, vy: (Math.random() - .5) * .22, r: 1 + Math.random() * 1.6, t: Math.random() < .5 })); };
    const draw = () => {
      x.clearRect(0, 0, w, h);
      for (let i = 0; i < pts.length; i++) { const p = pts[i]; p.x += p.vx; p.y += p.vy; if (p.x < -10) p.x = w + 10; if (p.x > w + 10) p.x = -10; if (p.y < -10) p.y = h + 10; if (p.y > h + 10) p.y = -10; }
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) { const a = pts[i], b = pts[j]; const dx = a.x - b.x, dy = a.y - b.y; const d2 = dx * dx + dy * dy; if (d2 < 16900) { const al = (1 - Math.sqrt(d2) / 130) * .35; x.strokeStyle = `rgba(124,140,255,${al})`; x.lineWidth = 1; x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke(); } }
      for (const p of pts) { x.fillStyle = p.t ? 'rgba(34,229,216,.85)' : 'rgba(124,140,255,.85)'; x.beginPath(); x.arc(p.x, p.y, p.r, 0, Math.PI * 2); x.fill(); }
    };
    const loop = () => { if (!live) return; if (!document.hidden) draw(); raf = requestAnimationFrame(loop); };
    resize(); addEventListener('resize', resize);
    if (REDUCED()) draw(); else loop();
    const spot = document.querySelector('.fx-spot');
    const mm = e => { if (spot) { spot.style.setProperty('--mx', e.clientX + 'px'); spot.style.setProperty('--my', e.clientY + 'px'); } };
    if (!mobile && !REDUCED()) addEventListener('pointermove', mm, { passive: true });
    return () => { live = false; cancelAnimationFrame(raf); removeEventListener('resize', resize); removeEventListener('pointermove', mm); };
  }, []);
  return html`<div className="fx" aria-hidden="true"><div className="fx-aurora" /><canvas ref=${cv} className="fx-net" /><div className="fx-grid" /><div className="fx-spot" /></div>`;
}
/* scroll reveal + 3D tilt, installed once per route render */
function useFxBehaviors(dep) {
  useEffect(() => {
    const reduced = REDUCED();
    const els = [...document.querySelectorAll('.rv:not(.in)')];
    let io = null;
    if (reduced || !('IntersectionObserver' in window)) els.forEach(e => e.classList.add('in'));
    else { io = new IntersectionObserver(en => en.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .12, rootMargin: '0px 0px -40px 0px' }); els.forEach(e => io.observe(e)); }
    const onMove = e => { const el = e.target.closest && e.target.closest('.tilt'); if (!el || reduced) return; const r = el.getBoundingClientRect(); const px = (e.clientX - r.left) / r.width - .5, py = (e.clientY - r.top) / r.height - .5; el.style.setProperty('--ry', (px * 10) + 'deg'); el.style.setProperty('--rx', (-py * 10) + 'deg'); el.style.setProperty('--gx', ((px + .5) * 100) + '%'); el.style.setProperty('--gy', ((py + .5) * 100) + '%'); };
    const onOut = e => { const el = e.target.closest && e.target.closest('.tilt'); if (!el) return; el.style.removeProperty('--ry'); el.style.removeProperty('--rx'); };
    document.addEventListener('pointermove', onMove, { passive: true }); document.addEventListener('pointerout', onOut, { passive: true });
    return () => { io && io.disconnect(); document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerout', onOut); };
  }, [dep]);
}
function useCountUp(target, ms) {
  const [v, setV] = useState(0); const ref = useRef(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    if (REDUCED() || !('IntersectionObserver' in window)) { setV(target); return; }
    const io = new IntersectionObserver(en => { if (!en[0].isIntersecting) return; io.disconnect(); const t0 = performance.now(); const step = t => { const k = Math.min(1, (t - t0) / (ms || 1400)); setV(Math.round(target * (1 - Math.pow(1 - k, 3)))); if (k < 1) requestAnimationFrame(step); }; requestAnimationFrame(step); }, { threshold: .4 });
    io.observe(el); return () => io.disconnect();
  }, [target]);
  return [v, ref];
}
function Counter({ n, suffix, label }) {
  const [v, ref] = useCountUp(n);
  return html`<div ref=${ref} className="counter"><b>${v.toLocaleString()}${suffix || ''}</b><span>${label}</span></div>`;
}
function Rotator({ words }) {
  const [i, setI] = useState(0);
  useEffect(() => { if (REDUCED()) return; const t = setInterval(() => setI(x => (x + 1) % words.length), 2400); return () => clearInterval(t); }, [words.length]);
  return html`<span className="rot" aria-live="polite"><span key=${i} className="rot-in">${words[i]}</span></span>`;
}
const SKILLS = ['SAP S/4HANA', 'React', 'Java', 'Python', '.NET', 'AWS', 'Azure', 'Kubernetes', 'Cisco', 'Palo Alto', 'HL7 / FHIR', 'Salesforce', 'Terraform', 'Snowflake', 'Node.js', 'Flutter', 'Power BI', 'ServiceNow'];
const Marquee = () => html`<div className="marquee" aria-hidden="true"><div className="marquee-track">${[...SKILLS, ...SKILLS].map((s, i) => html`<span key=${i}>${s}</span>`)}</div></div>`;

/* ================= Services explorer, models, planner ================= */
const SERVICE_ICON = { staffing: 'users', 'web-development': 'globe', 'app-development': 'phone', 'software-development': 'code', 'digital-marketing': 'mega', 'ui-ux': 'pen', 'it-consultancy': 'compass', 'erp-crm': 'layers', devops: 'cloud', healthcare: 'heart', 'clinical-saas': 'flask' };
function ServicesExplorer() {
  const [cur, setCur] = useState(SERVICES[0].s);
  const s = SERVICES.find(x => x.s === cur); const x = SERVICE_EXTRA[cur] || {};
  return html`<div className="xp">
    <div className="xp-list" role="tablist" aria-label="Services">${SERVICES.map(v => html`<button type="button" key=${v.s} role="tab" aria-selected=${cur === v.s} className=${cur === v.s ? 'on' : ''} onClick=${() => setCur(v.s)}><${Icon} n=${SERVICE_ICON[v.s]} /><span>${v.n}</span></button>`)}</div>
    <div className="xp-detail" key=${cur}>
      <div className="xp-head"><span className="xp-ico"><${Icon} n=${SERVICE_ICON[cur]} /></span><div><h3>${s.n}</h3><p>${s.l}</p></div></div>
      <div className="xp-grid">
        <div><h4>What we deliver</h4><ul className="ticks">${(x.deliver || s.inc).map(i => html`<li key=${i}>${i}</li>`)}</ul></div>
        <div className="xp-facts">
          ${x.time && html`<div><span className="lbl2">Timeline</span><b>${x.time}</b></div>`}
          ${x.team && html`<div><span className="lbl2">Typical team</span><b>${x.team}</b></div>`}
          ${x.models && html`<div><span className="lbl2">Engagement</span><b>${x.models}</b></div>`}
          ${x.who && html`<div><span className="lbl2">Built for</span><b>${x.who}</b></div>`}
        </div>
      </div>
      ${x.tech && html`<div className="models" style=${{ marginTop: 18 }}>${x.tech.map(t => html`<span key=${t}>${t}</span>`)}</div>`}
      <div className="actions" style=${{ marginTop: 24 }}><a className="btn" href=${'#/services/' + cur}>Full details</a><a className="btn ghost" href="#/contact">Book a free consultation</a></div>
    </div>
  </div>`;
}
const MODELS = [
  ['C2C', 'Experienced consultants who run their own company', 'The consultant\u2019s company', 'Hourly, invoiced', 'Months to years', 'StratEdge and the consultant\u2019s company'],
  ['W2', 'Clients who want simple classification', 'StratEdge', 'Hourly or salaried', 'Months to years', 'StratEdge'],
  ['1099', 'Short, well-defined work by independents', 'Self-employed', 'Hourly or fixed', 'Weeks to months', 'The contractor, with StratEdge paperwork'],
  ['Contract-to-hire', 'Try before converting to full-time', 'StratEdge, then you', 'Hourly, then salary', '3 to 6 months, then permanent', 'StratEdge, then your HR'],
  ['Direct hire', 'Permanent roles you want filled fast', 'You', 'Placement fee', 'Permanent', 'Your HR'],
  ['SOW team', 'A deliverable, not a headcount', 'StratEdge', 'Milestones or monthly', 'Project length', 'StratEdge'],
];
const ModelsTable = () => html`<div className="card tblwrap" style=${{ padding: 6 }}><table className="tbl models-tbl"><thead><tr><th>Model</th><th>Best for</th><th>Who employs</th><th>Billing</th><th>Typical duration</th><th>Compliance handled by</th></tr></thead>
  <tbody>${MODELS.map(r => html`<tr key=${r[0]}><td><b>${r[0]}</b></td>${r.slice(1).map((c, i) => html`<td key=${i}>${c}</td>`)}</tr>`)}</tbody></table></div>`;

const PLAN_ROLES = ['Network Engineer', 'SAP Functional Consultant', 'SAP Technical (ABAP)', 'React Developer', 'Java Developer', 'Python Developer', '.NET Developer', 'Cloud / DevOps Engineer', 'Data Engineer', 'QA Engineer', 'Healthcare IT Analyst', 'Project Manager', 'Business Analyst', 'Finance & Accounting'];
function TeamPlanner() {
  const [plan, setPlan] = useState({}); const [f, setF] = useState({ loc: '', ty: 'C2C', md: 'Onsite', sd: '' });
  const toggle = r => setPlan(p => { const n = { ...p }; if (n[r]) delete n[r]; else n[r] = 1; return n; });
  const bump = (r, d) => setPlan(p => ({ ...p, [r]: Math.max(1, (p[r] || 1) + d) }));
  const roles = Object.entries(plan); const total = roles.reduce((a, [, n]) => a + n, 0);
  const send = () => { const q = encodeURIComponent(JSON.stringify({ roles: roles.map(([r, n]) => `${n} × ${r}`), ...f })); location.hash = '#/request-talent?plan=' + q; };
  return html`<div className="planner">
    <div className="planner-roles">${PLAN_ROLES.map(r => html`<button key=${r} type="button" className=${'chipbtn' + (plan[r] ? ' on' : '')} aria-pressed=${!!plan[r]} onClick=${() => toggle(r)}>${r}${plan[r] ? html` <b>×${plan[r]}</b>` : ''}</button>`)}</div>
    <div className="planner-side">
      <h3>${total ? `${total} ${total === 1 ? 'person' : 'people'} across ${roles.length} role${roles.length === 1 ? '' : 's'}` : 'Pick the roles you need'}</h3>
      ${roles.length ? html`<ul className="list">${roles.map(([r, n]) => html`<li key=${r}><span>${r}</span><span className="qty"><button type="button" aria-label=${'Fewer ' + r} onClick=${() => bump(r, -1)}>−</button><b>${n}</b><button type="button" aria-label=${'More ' + r} onClick=${() => bump(r, 1)}>+</button></span></li>`)}</ul>` : html`<p className="muted small">Tap roles on the left. Add more than one person per role with the + button.</p>`}
      <div className="row2 form" style=${{ gap: 10 }}><${Field} label="Location"><input value=${f.loc} onInput=${e => setF({ ...f, loc: e.target.value })} placeholder="City, state or remote" /><//><${Field} label="Start"><input type="date" value=${f.sd} onInput=${e => setF({ ...f, sd: e.target.value })} /><//></div>
      <div className="row2 form" style=${{ gap: 10 }}><${Field} label="Engagement"><select value=${f.ty} onChange=${e => setF({ ...f, ty: e.target.value })}>${['C2C', 'W2', '1099', 'Contract-to-hire', 'Direct hire', 'SOW project team'].map(t => html`<option key=${t}>${t}</option>`)}</select><//><${Field} label="Work mode"><select value=${f.md} onChange=${e => setF({ ...f, md: e.target.value })}>${['Onsite', 'Hybrid', 'Remote'].map(t => html`<option key=${t}>${t}</option>`)}</select><//></div>
      <button type="button" className="btn lg" style=${{ width: '100%' }} disabled=${!roles.length} onClick=${send}><${Icon} n="send" />Send this plan to StratEdge</button>
    </div>
  </div>`;
}
function PortalStatus() {
  const c = useCaps();
  return html`<span className="status"><i className=${c && c.state !== 'none' ? 'ok' : ''} />${c && c.state !== 'none' ? 'Portal online' : c ? 'Portal unreachable' : 'Checking portal'}</span>`;
}

/* ================= Reference-style sections ================= */
const REPORT_BARS = [9, 12, 7, 14, 10];
function WeeklyReportCard() {
  const [on, setOn] = useState(false); const ref = useRef(null);
  useEffect(() => { const el = ref.current; if (!el || REDUCED() || !('IntersectionObserver' in window)) { setOn(true); return; } const io = new IntersectionObserver(en => { if (en[0].isIntersecting) { setOn(true); io.disconnect(); } }, { threshold: .3 }); io.observe(el); return () => io.disconnect(); }, []);
  return html`<div ref=${ref} className=${'report' + (on ? ' on' : '')}>
    <div className="report-head"><div><h3>Weekly engagement report</h3><p className="muted small">What every client receives each week</p></div><span className="tag">Sample</span></div>
    <div className="report-nums"><div><b>14</b><span>Profiles submitted</span></div><div><b>6</b><span>Interviews</span></div><div><b>2</b><span>Offers</span></div></div>
    <div className="report-bars" aria-hidden="true">${REPORT_BARS.map((v, i) => html`<div key=${i}><i style=${{ height: (v / 14 * 100) + '%' }} /><span>${DOW[i]}</span></div>`)}</div>
    <ul className="report-list">
      <li><span>SAP PP/QM Analyst, Edison NJ</span><${Chip} s="new">Interview<//></li>
      <li><span>Senior Network Engineer, remote</span><${Chip} s="amber">Submitted<//></li>
      <li><span>Java Developer, Dallas TX</span><${Chip} s="ok">Client round<//></li>
    </ul>
  </div>`;
}
const PLANS = [
  { k: 'C2C', t: 'Corp-to-corp', d: 'Consultants who run their own company and invoice for hours.', best: 'experienced consultants and clients who need speed', pts: ['Screened profiles with RTR in days', 'Consultant\u2019s company carries insurance and taxes', 'Weekly timesheets approved by your manager', 'Replacement on request'] },
  { k: 'W2', t: 'W2 contract', d: 'StratEdge employs the consultant and handles payroll and compliance.', best: 'clients who want simple classification', pts: ['Everything in C2C, plus:', 'StratEdge as employer of record', 'Payroll, benefits and tax handled', 'Convert to your payroll when you\u2019re ready'], rec: true },
  { k: 'Contract-to-hire', t: 'Contract-to-hire', d: 'Work together first, then bring the consultant onto your team.', best: 'roles you want to fill permanently with less risk', pts: ['3 to 6 months on contract', 'Conversion terms agreed up front', 'Onboarding support through the switch', 'No surprise fees'] },
  { k: 'SOW project team', t: 'SOW project team', d: 'A delivery team with an outcome, a timeline and milestones.', best: 'projects you\u2019d rather hand off than staff', pts: ['Scoped plan and estimate after discovery', 'Tech lead, engineers and QA', 'Milestone or monthly billing', 'Support after go-live'] },
];
function PlanCards() {
  const go = k => { location.hash = '#/request-talent?plan=' + encodeURIComponent(JSON.stringify({ roles: [], ty: k })); };
  return html`<div className="plans">${PLANS.map(p => html`<div key=${p.k} className=${'plan' + (p.rec ? ' rec' : '')}>
    ${p.rec && html`<span className="plan-tag">Most chosen</span>`}
    <h3>${p.t}</h3><p className="plan-price">Custom pricing <span>after a free consultation</span></p><p className="muted">${p.d}</p>
    <p className="small"><b>Best for:</b> ${p.best}</p>
    <ul className="ticks">${p.pts.map(x => html`<li key=${x}>${x}</li>`)}</ul>
    <button type="button" className=${'btn' + (p.rec ? '' : ' ghost')} style=${{ width: '100%' }} onClick=${() => go(p.k)}>Request ${p.t}</button>
  </div>`)}</div>`;
}
const BENEFITS = [
  ['Screened, interview-ready profiles', 'Every submission comes with an RTR, verified authorization and a rate check.'], ['A recruiter and an account manager', 'Two named people who know your requirement and answer the phone.'], ['Weekly engagement report', 'Submissions, interviews, offers and timesheet status, every week.'],
  ['Compliance handled', 'Agreements, insurance, onboarding paperwork and tax forms, collected and verified.'], ['Timesheets your managers approve online', 'Clock-ins, weekly timesheets and client approval in one portal.'], ['Vendor and client network', 'Direct clients and prime vendors across the US, onsite, hybrid or remote.'],
  ['Replacement on contract roles', 'If a consultant doesn\u2019t work out, we re-screen against your feedback and replace.'], ['Delivery when you need it', 'Web, mobile, cloud, ERP/CRM and healthcare IT from the same team.'], ['Support after the start date', 'A check-in in week one and a person to call for the length of the engagement.'],
];
const BenefitsGrid = () => html`<div className="benefits">${BENEFITS.map(([t, d]) => html`<div key=${t} className="benefit"><b>${t}</b><span>${d}</span></div>`)}</div>`;
const WALK = [
  ['Request', 'Send a requirement from the Request talent page, the team planner, or a call.', 'A recruiter calls or emails the same business day with questions.'],
  ['Shortlist', 'Screened profiles land in your client portal within days.', 'Rate, availability and authorization are checked before you see them.'],
  ['Interview', 'Shortlist, request interviews and leave feedback in the portal.', 'We prepare the consultant and schedule around your calendar.'],
  ['Onboard', 'Agreements, insurance and tax forms are collected and e-signed.', 'Your manager gets a client portal login for approvals.'],
  ['Deliver', 'Consultants clock in and submit weekly timesheets you approve online.', 'You get a weekly report; StratEdge invoices approved hours.'],
];
function Walkthrough() {
  const [i, setI] = useState(0); const [paused, setPaused] = useState(false);
  useEffect(() => { if (paused || REDUCED()) return; const t = setInterval(() => setI(x => (x + 1) % WALK.length), 4500); return () => clearInterval(t); }, [paused]);
  return html`<div className="walk" onMouseEnter=${() => setPaused(true)} onMouseLeave=${() => setPaused(false)}>
    <div className="walk-tabs" role="tablist">${WALK.map((w, k) => html`<button type="button" key=${w[0]} role="tab" aria-selected=${i === k} className=${i === k ? 'on' : ''} onClick=${() => { setI(k); setPaused(true); }}><span className="walk-n">${k + 1}</span>${w[0]}${i === k && !paused && html`<i className="walk-prog" />`}</button>`)}</div>
    <div className="walk-body" key=${i}>
      <div className="walk-stage"><div className="walk-num">0${i + 1}</div><div className="walk-orb" /><div className="walk-line" /></div>
      <div><h3>${WALK[i][0]}</h3><p>${WALK[i][1]}</p><p className="muted">${WALK[i][2]}</p></div>
    </div>
  </div>`;
}
const ASSISTANT_QS = ['What roles do you staff?', 'How does client timesheet approval work?', 'Can you build our customer portal?'];
function AssistantSec() {
  const ask = q => { dispatchEvent(new CustomEvent('edge-open', { detail: { ask: q } })); };
  return html`<section className="sec alt rv"><div className="wrap assist">
    <div><div className="kicker">Assistant</div><h2>Ask the StratEdge assistant</h2><p className="intro">It knows our services, engagement models, portals and timesheets, and answers in seconds. Try one of these, or type your own question in the corner.</p>
      <div className="assist-qs">${ASSISTANT_QS.map(q => html`<button type="button" key=${q} className="chipbtn" onClick=${() => ask(q)}>${q}</button>`)}</div></div>
    <div className="assist-demo"><${Mascot} size=${150} /><div className="assist-chat"><div className="msg b">Hi, I'm the StratEdge assistant. Ask me about services, timesheets or how to request talent.</div><div className="msg u">How fast can you send profiles?</div><div className="msg b">Usually within 2 to 5 business days for common roles. Want me to open the talent request form?</div></div></div>
  </div></section>`;
}

/* ================= Portal context & gates ================= */
const PortalCtx = createContext(null);
const usePortal = () => useContext(PortalCtx);
const accessMail = mailtoFor('Portal access request', ['Hi StratEdge HR,', '', 'Please help me with my portal access.', '', 'Name:', 'Company / client / project:']);

function Gate({ title, children, actions }) {
  return html`<div className="gate"><div className="card">
    <a href="#/" className="brand" aria-label="StratEdge home"><${Logo} /></a>
    <h1>${title}</h1>${children}
    <div className="actions">${actions || html`<a className="btn ghost" href="#/">Back to website</a>`}</div>
  </div></div>`;
}

function ProfileForm({ uid, initial, onSaved, submitLabel, as }) {
  const toast = useToast();
  const me = Cap.me || {};
  const [f, setF] = useState({ n: '', e: '', ph: '', ti: '', loc: '', co: '', role: as === 'client' ? 'employer' : as === 'employee' ? 'employee' : as === 'bench' ? 'bench' : 'consultant', ...(initial || {}), ...(!initial ? { n: me.name || '', e: me.email || '' } : {}) });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const emp = f.role === 'employer';
  const save = async e => {
    e.preventDefault();
    if (!f.n.trim() || !/^\S+@\S+\.\S+$/.test(f.e || '')) { setErr('Add your full name and a valid email.'); return; }
    if (emp && !(f.co || '').trim()) { setErr('Add your company name.'); return; }
    setErr(''); setBusy(true);
    try {
      const p = { n: f.n.trim(), e: f.e.trim(), ph: (f.ph || '').trim(), ti: (f.ti || '').trim(), loc: (f.loc || '').trim(), role: f.role, co: emp ? f.co.trim() : '' };
      await dbMerge(`u/${uid}`, initial ? { p } : { p, joined: Date.now() });
      toast('Profile saved.'); onSaved && onSaved();
    } catch (x) { toast(errText(x), true); }
    setBusy(false);
  };
  return html`<form className="form" onSubmit=${save} noValidate>
    <div className="rolepick" role="radiogroup" aria-label="I am">
      ${[['consultant', 'Consultant', 'I am placed by StratEdge or looking for my next role: resume, matched jobs, timesheets.'], ['employee', 'StratEdge employee', 'I work for StratEdge: recruiting, HR, delivery or office staff.'], ['bench', 'Bench sales recruiter', 'I market StratEdge consultants to vendors and clients: job grabber, submissions, RTRs.'], ['employer', 'Client or vendor contact', 'I approve timesheets and post requirements.']].map(([k, t, d]) => html`<label key=${k} className=${f.role === k ? 'on' : ''}>
        <input type="radio" name="role" value=${k} checked=${f.role === k} onChange=${() => setF({ ...f, role: k })} /><div><b>${t}</b><span>${d}</span></div></label>`)}
    </div>
    <div className="row2"><${Field} label=${emp ? 'Full name' : 'Full legal name'} hint=${emp ? null : 'As it should appear on timesheets.'}><input value=${f.n} onInput=${up('n')} autoComplete="name" /><//>
      <${Field} label="Work email"><input type="email" value=${f.e} onInput=${up('e')} autoComplete="email" /><//></div>
    ${emp && html`<${Field} label="Company"><input value=${f.co} onInput=${up('co')} placeholder="The company you approve timesheets for" autoComplete="organization" /><//>`}
    <div className="row2"><${Field} label="Phone"><input type="tel" value=${f.ph} onInput=${up('ph')} autoComplete="tel" /><//>
      <${Field} label=${emp ? 'Your title' : 'Job title'}><input value=${f.ti} onInput=${up('ti')} placeholder=${emp ? 'e.g. Engineering Manager' : 'e.g. Network Engineer'} /><//></div>
    <${Field} label="City and state"><input value=${f.loc} onInput=${up('loc')} placeholder="e.g. Edison, NJ" /><//>
    ${err && html`<p className="err" role="alert">${err}</p>`}
    <div><button className="btn" disabled=${busy}>${busy ? 'Saving…' : (submitLabel || 'Save profile')}</button></div>
  </form>`;
}

function Portal({ path, q }) {
  const caps = useCaps();
  if (!caps) return html`<div className="gate"><${Spinner} label="Connecting to the portal…" /></div>`;
  if (caps.state === 'none') return html`<${Gate} title="The portal isn't reachable right now"><p className="muted">The server didn't answer. Try again in a few minutes, or contact StratEdge at ${CO.email}.</p><//>`;
  if (caps.state !== 'ready') return html`<${Gate} title="Log in to use the portal"
      actions=${html`<a className="btn" href=${'#/login' + (q.as ? '?as=' + q.as : '')}>Log in</a><a className="btn ghost" href=${'#/login?mode=register' + (q.as ? '&as=' + q.as : '')}>Create an account</a>`}>
    <p className="muted">Consultants, client contacts and StratEdge staff each sign in with their own account.</p><//>`;
  return html`<${PortalData} caps=${caps} path=${path} q=${q} />`;
}

function PortalData({ caps, path, q }) {
  const uid = caps.uid, isAdmin = caps.isAdmin;
  const root = useDoc(`u/${uid}`);
  const asg = useDoc(`r/${uid}`);
  const ann = useCol('org/main/ann', 'at:desc', 30);
  const settings = useDoc('org/main/x/settings');
  const tpl = useDoc('org/hr/x/tpl');
  const sigs = useCol('sig');
  const allU = useCol(isAdmin ? 'u' : null);
  const allR = useCol(isAdmin ? 'r' : null);
  const inbox = useCol(isAdmin ? 'inbox' : null);
  const clients = useCol(isAdmin ? 'org/admin/clients' : null);
  const [editing, setEditing] = useState(false);
  const people = usePeople(isAdmin ? [uid, ...allU.docs.map(d => d.id)] : [uid]);
  const [accounts, setAccounts] = useState({});
  const loadAccounts = useCallback(() => { if (!isAdmin) return; api('admin_users').then(r => { const o = {}; (r.users || []).forEach(u => { o[u.id] = u; }); setAccounts(o); }).catch(() => {}); }, [isAdmin]);
  useEffect(() => { loadAccounts(); }, [loadAccounts, allU.docs.length]);

  const admin = useMemo(() => {
    if (!isAdmin) return null;
    const rMap = {}; allR.docs.forEach(d => { rMap[d.id] = d; });
    const members = allU.docs.filter(d => d.p).map(d => {
      const r = rMap[d.id] || null;
      return { id: d.id, u: d, r, st: (r && r.st) || (d.id === uid ? 'active' : 'new'), role: (r && r.role) || d.p.role || 'consultant', self: d.id === uid };
    }).sort((a, b) => a.u.p.n.localeCompare(b.u.p.n));
    const pendTs = [], pendLv = [], reviewed = [];
    members.forEach(m => {
      Object.entries(m.u.ts || {}).forEach(([w, s]) => {
        const rev = m.r && m.r.rev && m.r.rev[w]; const st = tsStatus(s, rev);
        if (st === 'pending') pendTs.push({ m, w, s }); else if (rev && rev.at && rev.v === s.u) reviewed.push({ m, w, s, rev, st });
      });
      Object.entries(m.u.lv || {}).forEach(([id, l]) => { if (!l.x && !(m.r && m.r.lvd && m.r.lvd[id])) pendLv.push({ m, id, l }); });
    });
    pendTs.sort((a, b) => (a.s.sa || 0) - (b.s.sa || 0));
    pendLv.sort((a, b) => (a.l.at || 0) - (b.l.at || 0));
    reviewed.sort((a, b) => b.rev.at - a.rev.at);
    const msgs = [];
    inbox.docs.forEach(d => Object.entries(d.m || {}).forEach(([id, x]) => msgs.push({ ...x, uid: d.id, id })));
    msgs.sort((a, b) => (b.at || 0) - (a.at || 0));
    const clientsById = {}; clients.docs.forEach(c => { clientsById[c.id] = c; });
    return { members, rMap, pendTs, pendLv, reviewed: reviewed.slice(0, 25), msgs, unread: msgs.filter(x => !x.done).length,
      onClock: members.filter(m => m.u.clock && m.u.clock.on), requests: members.filter(m => m.st === 'new'), clients: clients.docs.slice().sort((a, b) => (a.n || '').localeCompare(b.n || '')), clientsById,
      employers: members.filter(m => m.role === 'employer' && m.st === 'active'), accounts, loadAccounts, loading: allU.loading || allR.loading };
  }, [isAdmin, allU.docs, allR.docs, inbox.docs, clients.docs, accounts, loadAccounts]);

  if (root.loading || asg.loading) return html`<div className="gate"><${Spinner} label="Loading your workspace…" /></div>`;
  const prof = root.data && root.data.p;
  const a = asg.data || {};
  const role = isAdmin ? 'admin' : (a.role || (prof && prof.role) || 'consultant');
  if (!isAdmin) {
    if (!prof) return html`<${Gate} title="Set up your profile" actions=${html`<a className="btn ghost" href="#/">Back to website</a>`}>
      <p className="muted">Welcome to the StratEdge portal. Add your details once, and StratEdge will approve your access.</p>
      <${ProfileForm} uid=${uid} as=${q.as} submitLabel="Request access" /><//>`;
    if (!a.st) return html`<${Gate} title=${`Thanks, ${firstName(prof.n)}. Your access is being reviewed`}>
      <p className="muted">${prof.role === 'employer' ? `StratEdge will connect your account to ${prof.co || 'your company'}'s client workspace.` : prof.role === 'bench' ? 'An administrator approves your account and you get the bench sales portal.' : 'HR will approve your account and assign your client and project.'} This page opens your portal automatically as soon as that happens.</p>
      ${editing ? html`<${ProfileForm} uid=${uid} initial=${prof} onSaved=${() => setEditing(false)} />`
        : html`<dl className="kv"><dt>Name</dt><dd>${prof.n}</dd><dt>Email</dt><dd>${prof.e}</dd>${prof.co && html`<dt>Company</dt><dd>${prof.co}</dd>`}${prof.ph && html`<dt>Phone</dt><dd>${prof.ph}</dd>`}${prof.ti && html`<dt>Title</dt><dd>${prof.ti}</dd>`}<dt>Requested</dt><dd>${portalLabel(prof.role)}</dd></dl>
          <div><button type="button" className="btn ghost sm" onClick=${() => setEditing(true)}>Edit details</button></div>`}<//>`;
    if (a.st === 'inactive') return html`<${Gate} title="Your portal access is paused">
      <p className="muted">This usually means an engagement has ended. If you think it's a mistake, contact StratEdge at ${CO.email} or ${CO.phone}.</p><//>`;
    if (role === 'employer' && !a.cid) return html`<${Gate} title="Your client workspace isn't linked yet">
      <p className="muted">StratEdge needs to connect your account to your company before timesheets appear here. Contact your account manager at ${CO.email}.</p><//>`;
  }
  const ctx = { uid, caps, isAdmin, role, cid: a.cid || null, root: root.data || {}, prof, asg: a, ann: ann.docs, settings: settings.data || {}, tpl: tpl.data || {}, sigs: sigs.docs, people, admin, isHR: !!caps.isHR, roleName: caps.roleName };
  return html`<${PortalCtx.Provider} value=${ctx}><${Shell} path=${path} q=${q} /><//>`;
}

/* ================= Shell ================= */
const MEMBER_NAV = [
  ['', 'Dashboard', 'home'], ['attendance', 'Attendance', 'clock'], ['timesheets', 'Timesheets', 'sheet'], ['pay', 'Earnings', 'money'], ['tasks', 'Tasks', 'tasks'],
  ['timeoff', 'Time off', 'cal'], ['documents', 'Documents', 'folder'], ['profile', 'Profile', 'user'],
];
const CLIENT_NAV = [
  ['', 'Dashboard', 'home'], ['timesheets', 'Timesheets', 'sheet'], ['consultants', 'Consultants', 'users'], ['attendance', 'Attendance', 'clock'],
  ['requirements', 'Requirements', 'brief'], ['invoices', 'Invoices', 'money'], ['reports', 'Reports', 'chart'], ['sign', 'Sign documents', 'sheet'], ['profile', 'Profile', 'user'],
];
const ADMIN_NAV = [
  ['admin', 'Overview', 'grid'], ['admin/team', 'Team', 'users'], ['admin/clients', 'Clients', 'building'], ['admin/approvals', 'Approvals', 'approve'], ['admin/payroll', 'Pay plans', 'money'], ['admin/payruns', 'Payroll runs & salary confirmation', 'money'], ['admin/requirements', 'Requirements', 'brief'],
  ['admin/recruiting', 'Recruiting', 'users'], ['admin/jobs', 'Job portals', 'search'], ['admin/ats', 'Candidates (ATS)', 'users'], ['admin/esign', 'E-signatures', 'sheet'], ['admin/invoices', 'Invoices', 'money'], ['admin/attendance', 'Team attendance', 'clock'], ['admin/logins', 'Sign-in activity', 'globe'], ['admin/tasks', 'Assign tasks', 'tasks'], ['admin/reports', 'Reports', 'chart'], ['admin/announcements', 'Announcements', 'mega'], ['admin/website', 'Website', 'globe'],
];
const HR_NAV = [
  ['hr', 'HR overview', 'grid'], ['hr/ats', 'Candidates (ATS)', 'users'], ['hr/jobs', 'Job portals', 'search'], ['hr/onboarding', 'Onboarding', 'tasks'], ['hr/esign', 'E-signatures', 'sheet'], ['hr/invoices', 'Invoices', 'money'], ['hr/verify', 'Document checks', 'folder'], ['hr/policies', 'Policies & templates', 'sheet'], ['hr/directory', 'Directory', 'users'], ['hr/logins', 'Sign-in activity', 'globe'], ['hr/reports', 'Daily reports', 'chart'],
];
const ACCT_NAV = [
  ['acct', 'Accounting overview', 'grid'], ['admin/invoices', 'Invoices', 'money'], ['acct/expenses', 'Bills & expenses', 'sheet'], ['acct/payroll', 'Payroll runs & paystubs', 'money'], ['acct/reports', 'Reports', 'chart'], ['acct/taxes', 'Tax settings', 'approve'], ['acct/accounts', 'Chart of accounts', 'folder'],
];
const ACCT_SHARED_NAV = [['admin/team', 'Team', 'users'], ['admin/payroll', 'Pay plans', 'money'], ['admin/attendance', 'Team attendance', 'clock']];
const HR_SHARED_NAV = [['admin/team', 'Team', 'users'], ['admin/approvals', 'Approvals', 'approve'], ['admin/payroll', 'Payroll', 'money'], ['admin/attendance', 'Team attendance', 'clock'], ['admin/announcements', 'Announcements', 'mega']];
const REC_NAV = [['rec/consultants', 'Consultants', 'users'], ['rec/submissions', 'RTRs & submissions', 'send'], ['rec/eod', 'Daily report', 'mega']];
const CONSULTANT_NAV = [
  ['', 'Dashboard', 'home'], ['jobs', 'Matched jobs', 'search'], ['applications', 'Applications', 'check'], ['resume', 'Resume & preferences', 'star'], ['attendance', 'Attendance', 'clock'], ['timesheets', 'Timesheets', 'sheet'], ['pay', 'Earnings', 'money'], ['timeoff', 'Time off', 'cal'],
  ['tasks', 'Tasks', 'tasks'], ['documents', 'Documents', 'folder'], ['profile', 'Profile', 'user'],
];
// Bench sales recruiters: the job grabber and the recruiting workspace are inline in the primary nav (no separate Recruiting group).
const BENCH_NAV = [
  ['', 'Dashboard', 'home'], ['jobs/grab', 'Job grabber', 'search'], ['jobs/consultants', 'Consultant matches', 'users'], ['rec/consultants', 'Bench consultants', 'users'], ['rec/submissions', 'RTRs & submissions', 'send'], ['rec/eod', 'Daily report', 'mega'],
  ['attendance', 'Attendance', 'clock'], ['timesheets', 'Timesheets', 'sheet'], ['tasks', 'Tasks', 'tasks'], ['timeoff', 'Time off', 'cal'], ['documents', 'Documents', 'folder'], ['profile', 'Profile', 'user'],
];
function Shell({ path, q }) {
  const P = usePortal();
  const [more, setMore] = useState(false);
  const sub = path.replace(/^\/(portal|client)\/?/, '');
  useEffect(() => { setMore(false); }, [path]);
  const emp = P.role === 'employer'; const cons = P.role === 'consultant'; const bench = P.role === 'bench';
  const toSign = pendingSigs(P.sigs, P.uid).length;
  const openTasks = emp ? 0 : Object.entries(P.asg.tasks || {}).filter(([id, t]) => !t.x && (((P.root.tp || {})[id] || {}).s || 'todo') !== 'done').length;
  const A = P.admin;
  const badge = { tasks: openTasks, sign: toSign, 'admin/team': A && A.requests.length, 'admin/approvals': A && (A.pendTs.length + A.pendLv.length), 'admin/website': A && A.unread, 'admin/esign': toSign, 'hr/esign': toSign };
  const onbOpen = !emp && P.asg.onb && P.asg.onb.kind !== 'done';
  const benchNav = bench ? BENCH_NAV.filter(n => !(P.asg.norec && n[0].startsWith('rec/'))) : BENCH_NAV;
  const primary = emp ? CLIENT_NAV : cons ? [...CONSULTANT_NAV.slice(0, 8), ...(onbOpen ? [['onboarding', 'Onboarding', 'tasks']] : []), ['sign', 'Sign documents', 'sheet'], ['policies', 'Policies', 'sheet'], ...CONSULTANT_NAV.slice(8)] : bench ? [...benchNav.slice(0, -1), ...(onbOpen ? [['onboarding', 'Onboarding', 'tasks']] : []), ['sign', 'Sign documents', 'sheet'], ['policies', 'Policies', 'sheet'], benchNav[benchNav.length - 1]] : [...MEMBER_NAV.slice(0, 6), ...(onbOpen ? [['onboarding', 'Onboarding', 'tasks']] : []), ['sign', 'Sign documents', 'sheet'], ['policies', 'Policies', 'sheet'], MEMBER_NAV[6]];
  const rec = (!emp && !cons && !bench && P.prof && !P.asg.norec) || P.isAdmin ? REC_NAV : [];
  // Separate portals: the route prefix decides which portal is open; a switcher moves between the ones this person can use.
  const portals = [...(emp ? [['client', 'Client portal', '']] : cons ? [['consultant', 'Consultant portal', '']] : bench ? [['bench', 'Bench sales portal', '']] : [['employee', 'Employee portal', '']]), ...(P.isHR || P.roleName === 'admin' ? [['hr', 'HR portal', 'hr']] : []), ...(P.isAcct || P.roleName === 'admin' ? [['acct', 'Accounting portal', 'acct']] : []), ...(P.roleName === 'admin' ? [['admin', 'Admin portal', 'admin']] : [])];
  const portalKey = sub === 'admin' || sub.startsWith('admin/') ? 'admin' : sub === 'hr' || sub.startsWith('hr/') ? 'hr' : sub === 'acct' || sub.startsWith('acct/') ? 'acct' : emp ? 'client' : cons ? 'consultant' : bench ? 'bench' : 'employee';
  const inPortal = portals.some(x => x[0] === portalKey) ? portalKey : portals[0][0];
  const groups = inPortal === 'admin' ? [['', ADMIN_NAV], ['Recruiting', REC_NAV]] : inPortal === 'hr' ? [['', HR_NAV], ['Team', HR_SHARED_NAV], ['Recruiting', REC_NAV]] : inPortal === 'acct' ? [['', ACCT_NAV], ['Team', ACCT_SHARED_NAV]] : [['', primary], ...(rec.length ? [['Recruiting', rec]] : [])];
  const staff = [];
  const all = [...primary, ...rec, ...CONSULTANT_NAV, ...BENCH_NAV, ...ADMIN_NAV, ...HR_NAV, ...HR_SHARED_NAV, ...ACCT_NAV, ...ACCT_SHARED_NAV];
  const cur = all.find(n => n[0] === sub) || groups[0][1][0];
  const portalName = (portals.find(x => x[0] === inPortal) || portals[0])[1];
  const switchPortal = e => { const k = e.target.value; const p = portals.find(x => x[0] === k); if (p) location.hash = '#/portal' + (p[2] ? '/' + p[2] : ''); };
  const title = cur[1];
  const href = k => '#/portal' + (k ? '/' + k : '');
  const link = ([k, label, ic]) => html`<a key=${k} href=${href(k)} className=${cur[0] === k ? 'on' : ''} aria-current=${cur[0] === k ? 'page' : undefined}>
    <${Icon} n=${ic} />${label}${badge[k] ? html`<span className="badge">${badge[k]}</span>` : null}</a>`;
  const tabs = inPortal === 'client' ? ['', 'timesheets', 'consultants', 'requirements'] : inPortal === 'admin' ? ['admin', 'admin/approvals', 'admin/team', 'admin/payruns'] : inPortal === 'hr' ? ['hr', 'hr/onboarding', 'hr/verify', 'hr/reports'] : inPortal === 'acct' ? ['acct', 'admin/invoices', 'acct/expenses', 'acct/payroll'] : cons ? ['', 'jobs', 'applications', 'resume'] : bench ? (P.asg.norec ? ['', 'jobs/grab', 'jobs/consultants', 'timesheets'] : ['', 'jobs/grab', 'rec/submissions', 'rec/consultants']) : ['', 'attendance', 'timesheets', 'rec/submissions'];
  const page = (() => {
    if (emp) switch (sub) {
      case 'timesheets': return html`<${ClientTimesheets} />`;
      case 'consultants': return html`<${ClientConsultants} />`;
      case 'attendance': return html`<${ClientAttendance} />`;
      case 'requirements': return html`<${ClientRequirements} />`;
      case 'reports': return html`<${ClientReports} />`;
      case 'invoices': return html`<${ClientInvoices} />`;
      case 'sign': return html`<${SignDocsPage} />`;
      case 'profile': return html`<${Profile} />`;
      default: return html`<${ClientDashboard} />`;
    }
    switch (sub) {
      case 'attendance': return html`<${Attendance} />`;
      case 'timesheets': return html`<${Timesheets} q=${q} />`;
      case 'pay': return html`<${Earnings} />`;
      case 'tasks': return html`<${Tasks} />`;
      case 'timeoff': return html`<${TimeOff} />`;
      case 'documents': return html`<${Documents} />`;
      case 'profile': return html`<${Profile} />`;
      case 'onboarding': return html`<${OnboardingPage} />`;
      case 'policies': return html`<${PoliciesPage} />`;
      case 'sign': return html`<${SignDocsPage} />`;
      case 'jobs': return html`<${JobsPage} />`;
      case 'applications': return html`<${ApplicationsPage} />`;
      case 'resume': return html`<${ResumePage} />`;
    }
    // Job grabber: bench sales recruiters and admins only (consultants and clients fall through to the dashboard).
    if (bench || P.isAdmin) switch (sub) {
      case 'jobs/grab': return html`<${JobPortalsAdmin} bench=${!P.isAdmin} />`;
      case 'jobs/consultants': return html`<${JobPortalsAdmin} bench=${!P.isAdmin} tab="consultants" />`;
    }
    if ((!emp && !cons && !P.asg.norec) || P.isAdmin) switch (sub) {
      case 'rec/consultants': return html`<${RecConsultants} />`;
      case 'rec/submissions': return html`<${RecSubmissions} />`;
      case 'rec/eod': return html`<${RecEOD} />`;
    }
    if (P.isAdmin) switch (sub) {
      case 'hr': return html`<${HROverview} />`;
      case 'hr/onboarding': return html`<${HROnboarding} />`;
      case 'hr/verify': return html`<${HRVerify} />`;
      case 'hr/policies': return html`<${HRPolicies} />`;
      case 'hr/directory': return html`<${HRDirectory} />`;
      case 'hr/reports': return html`<${Recruiting} />`;
      case 'hr/esign': return html`<${ESignAdmin} />`;
      case 'admin/esign': return html`<${ESignAdmin} />`;
      case 'hr/invoices': return html`<${InvoicesAdmin} />`;
      case 'admin/invoices': return html`<${InvoicesAdmin} />`;
      case 'hr/ats': return html`<${ATSPage} />`;
      case 'admin/ats': return html`<${ATSPage} />`;
      case 'hr/logins': return html`<${SignIns} />`;
      case 'admin/logins': return html`<${SignIns} />`;
      case 'acct': return html`<${AcctOverview} />`;
      case 'acct/expenses': return html`<${Expenses} />`;
      case 'acct/payroll': return html`<${PayrollRuns} />`;
      case 'admin/payruns': return html`<${PayrollRuns} />`;
      case 'acct/reports': return html`<${AcctReports} />`;
      case 'acct/taxes': return html`<${TaxSettings} />`;
      case 'acct/accounts': return html`<${ChartOfAccounts} />`;
      case 'admin/recruiting': return html`<${Recruiting} />`;
      case 'admin/jobs': return html`<${JobPortalsAdmin} />`;
      case 'hr/jobs': return html`<${JobPortalsAdmin} />`;
      case 'admin': return html`<${AdminOverview} />`;
      case 'admin/team': return html`<${AdminTeam} q=${q} />`;
      case 'admin/clients': return html`<${AdminClients} />`;
      case 'admin/approvals': return html`<${AdminApprovals} q=${q} />`;
      case 'admin/payroll': return html`<${AdminPayroll} />`;
      case 'admin/requirements': return html`<${AdminRequirements} />`;
      case 'admin/attendance': return html`<${AdminAttendance} />`;
      case 'admin/tasks': return html`<${AdminTasks} />`;
      case 'admin/reports': return html`<${AdminReports} />`;
      case 'admin/announcements': return html`<${AdminAnnouncements} />`;
      case 'admin/website': return html`<${AdminWebsite} q=${q} />`;
    }
    if (sub === '' && !P.prof && P.isAdmin) return html`<${Fragment}>${P.roleName === 'admin' ? html`<${AdminOverview} />` : P.isHR ? html`<${HROverview} />` : html`<${AcctOverview} />`}<//>`;
    return html`<${Dashboard} />`;
  })();
  const me = P.people[P.uid] || Cap.me || {};
  const roleLine = P.roleName === 'admin' ? 'Admin' : P.isHR ? 'HR' : P.roleName === 'acct' ? 'Accounting' : emp ? (P.asg.cl || P.prof.co || 'Client contact') : cons ? (P.asg.ty ? P.asg.ty + ' consultant' : 'Consultant') : bench ? 'Bench sales recruiter' : 'StratEdge employee';
  const banner = toSign > 0 && sub !== 'sign' && !sub.endsWith('esign') ? html`<div className="note amber" style=${{ marginBottom: 18 }}><span><b>${toSign} document${toSign === 1 ? '' : 's'} waiting for your signature.</b></span><div className="actions"><a className="btn sm" href="#/portal/sign">Review and sign</a></div></div>` : null;
  const content = html`<${Fragment}>${banner}${emp ? html`<${ClientData}>${page}<//>` : page}<//>`;
  return html`<div className="app">
    <aside className="side" aria-label="Portal navigation">
      <a className="brand" href="#/" aria-label="StratEdge website"><${Logo} /></a>
      ${portals.length > 1 ? html`<label className="pswitch"><span className="plabel">${portalName}</span><select value=${inPortal} onChange=${switchPortal} aria-label="Switch portal">${portals.map(x => html`<option key=${x[0]} value=${x[0]}>${x[1]}</option>`)}</select></label>` : html`<div className="plabel">${portalName}</div>`}
      ${groups.map(([g, items], i) => html`<${Fragment} key=${g || i}>${g && html`<div className="grp">${g}</div>`}<nav>${items.map(link)}</nav><//>`)}
      <div className="me"><img src=${me.avatarUrl} alt="" /><div style=${{ minWidth: 0 }}><b>${(P.prof && P.prof.n) || me.name || 'You'}</b><span>${roleLine}</span></div></div>
    </aside>
    <div className="main">
      <header className="ptop">
        <a className="mlogo" href="#/" aria-label="StratEdge website"><${Logo} /></a>
        <h1>${title}</h1>
        <div className="push"><${ThemeToggle} /><a className="btn ghost sm" href="#/">Website</a><button type="button" className="btn ghost sm" onClick=${logout}><${Icon} n="exit" />Log out</button></div>
      </header>
      <main className="content">${content}</main>
    </div>
    <nav className="tabbar" aria-label="Portal sections">
      ${tabs.map(k => { const n = all.find(x => x[0] === k) || ['', 'Home', 'home']; return html`<a key=${k} href=${href(k)} className=${cur[0] === k ? 'on' : ''}><${Icon} n=${n[2]} />${k === '' || k === 'admin' || k === 'hr' || k === 'acct' ? 'Home' : n[1].replace('Team attendance', 'Attendance')}${badge[k] ? html`<span className="badge">${badge[k]}</span>` : null}</a>`; })}
      <button type="button" onClick=${() => setMore(true)}><${Icon} n="more" />More</button>
    </nav>
    ${more && html`<${Modal} title="Portal" onClose=${() => setMore(false)}>
      <div className="side" style=${{ display: 'flex', position: 'static', height: 'auto', border: 0, padding: 0 }}>
        ${portals.length > 1 && html`<label className="pswitch" style=${{ padding: '0 16px 10px' }}><span className="plabel">${portalName}</span><select value=${inPortal} onChange=${switchPortal} aria-label="Switch portal">${portals.map(x => html`<option key=${x[0]} value=${x[0]}>${x[1]}</option>`)}</select></label>`}
        ${groups.map(([g, items], i) => html`<${Fragment} key=${g || i}>${g && html`<div className="grp">${g}</div>`}<nav>${items.filter(n => !tabs.includes(n[0])).map(link)}</nav><//>`)}
        <div className="grp">Account</div><nav><a href="#/">Back to website</a><a href="#/" onClick=${e => { e.preventDefault(); logout(); }}><${Icon} n="exit" />Log out</a></nav>
      </div><//>`}
  </div>`;
}
const NeedProfile = () => html`<div className="panel"><${Empty} title="Set up your profile first" action=${html`<a className="btn" href="#/portal/profile">Set up profile</a>`}>Attendance, timesheets and time off are tied to your profile.<//></div>`;

/* ================= Clock in / out ================= */
const dayTotal = (s, b) => Math.max(0, Math.round(s.reduce((a, x) => a + (x.o ? mins(x.i, x.o) : 0), 0)) - excessBreak({ b: b || [] }, 60));
function useClockActions() {
  const P = usePortal(); const toast = useToast();
  const base = `u/${P.uid}`; const cid = P.cid; const nm = P.prof ? P.prof.n : '';
  const [busy, setBusy] = useState(false);
  const mirror = async (dk, s, bl) => { if (cid) await dbMerge(`pub/${cid}/att/${P.uid}_${mkey(dk)}`, { uid: P.uid, n: nm, m: mkey(dk), days: { [dk]: dayTotal(s, bl) } }); };
  const stamp = async ev => { const g = await getPosition(9000); const pos = g.pos || null; try { const r = await api('punch', { ev, pos, posErr: g.err || '' }); return { t: r.t, ip: r.ip, g: r.g || '', pos: r.pos || pos || null, posErr: pos ? '' : (g.err || '') }; } catch (e) { return { t: Date.now(), ip: '', g: '', pos, posErr: pos ? '' : (g.err || '') }; } };
  const clockIn = async mode => {
    if (busy) return; setBusy(true);
    try {
      const meta = await stamp('in'); const t = meta.t; const dk = dkey(new Date(t)); const path = `${base}/att/${mkey(dk)}`;
      const md = await dbGet(path);
      const s = (((md && md.days && md.days[dk]) || {}).s || []).map(x => ({ ...x }));
      s.push({ i: t, o: null, m: mode, li: meta });
      await dbMerge(path, { days: { [dk]: { s } } });
      await dbMerge(base, { clock: { on: true, i: t, d: dk, m: mode, brk: null }, lastMode: mode });
      if (cid) await dbMerge(`pub/${cid}/live/${P.uid}`, { n: nm, on: true, i: t, d: dk, m: mode, at: t });
      toast(`Clocked in at ${fmtTime(t)}.${meta.pos ? ` Location recorded (±${meta.pos.acc} m).` : ` Exact location ${POS_ERR[meta.posErr] || 'not shared'}; the network address was recorded.`}`);
    } catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  const breakStart = async () => {
    const c = P.root.clock; if (!c || !c.on || c.brk || busy) return; setBusy(true);
    try { const meta = await stamp('bi'); await dbMerge(base, { clock: { ...c, brk: { i: meta.t, li: meta } } }); toast(`Break started at ${fmtTime(meta.t)}.`); } catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  const breakEnd = async (silent) => {
    const c = P.root.clock; if (!c || !c.on || !c.brk) return null; if (!silent) setBusy(true);
    let out = null;
    try { const meta = await stamp('bo'); const path = `${base}/att/${mkey(c.d)}`; const md = await dbGet(path);
      const day = ((md && md.days && md.days[c.d]) || {}); const bl = (day.b || []).map(x => ({ ...x })); bl.push({ i: c.brk.i, o: meta.t, li: c.brk.li || null, lo: meta });
      await dbMerge(path, { days: { [c.d]: { b: bl } } }); await dbMerge(base, { clock: { ...c, brk: null } });
      const total = breakMins({ b: bl }); const allow = breakMaxOf(P.settings);
      if (!silent) toast(total > allow ? `Break ended. Breaks today total ${hm(total)}, over the ${hm(allow)} allowance; the extra time needs admin approval.` : `Break ended at ${fmtTime(meta.t)}. Breaks today: ${hm(total)} of ${hm(allow)}.`);
      out = bl;
    } catch (e) { toast(errText(e), true); }
    if (!silent) setBusy(false); return out;
  };
  const clockOut = async (at, edited) => {
    const c = P.root.clock; if (!c || !c.on || busy) return false; setBusy(true);
    let ok = false;
    try {
      if (c.brk) await breakEnd(true);
      const meta = edited ? null : await stamp('out'); const t = at || (meta ? meta.t : Date.now()); const path = `${base}/att/${mkey(c.d)}`;
      const md = await dbGet(path);
      const day = ((md && md.days && md.days[c.d]) || {}); const s = (day.s || []).map(x => ({ ...x }));
      const ix = s.findIndex(x => x.i === c.i && !x.o);
      if (ix >= 0) { s[ix].o = t; if (edited) s[ix].e = 1; if (meta) s[ix].lo = meta; } else s.push({ i: c.i, o: t, m: c.m, e: edited ? 1 : 0, lo: meta || null });
      await dbMerge(path, { days: { [c.d]: { s } } });
      await dbMerge(base, { clock: { on: false, i: null, d: null, m: null, brk: null }, lastOut: t });
      if (cid) { await dbMerge(`pub/${cid}/live/${P.uid}`, { n: nm, on: false, i: null, d: null, m: null, at: t }); await mirror(c.d, s, day.b || []); }
      toast(`Clocked out at ${fmtTime(t)}. This session: ${hm(mins(c.i, t))}.`); ok = true;
    } catch (e) { toast(errText(e), true); }
    setBusy(false); return ok;
  };
  return { busy, clockIn, clockOut, breakStart, breakEnd, mirror };
}
const sessMins = (s, c, now) => s.reduce((a, x) => a + mins(x.i, x.o != null ? x.o : (c && c.i === x.i ? now : x.i)), 0);
function timeParts(ts) {
  const parts = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' }).formatToParts(new Date(ts));
  return { main: parts.filter(p => p.type !== 'dayPeriod').map(p => p.value).join('').trim(), per: (parts.find(p => p.type === 'dayPeriod') || {}).value || '' };
}

function ClockCard() {
  const P = usePortal(); const now = useNow(1000);
  const c = P.root.clock && P.root.clock.on ? P.root.clock : null;
  const today = dkey(new Date(now));
  const month = useDoc(`u/${P.uid}/att/${mkey(today)}`);
  const dayD = (month.data && month.data.days && month.data.days[(c && c.d) || today]) || {}; const sess = dayD.s || [];
  const [mode, setMode] = useState(P.root.lastMode || 'remote');
  const { busy, clockIn, clockOut, breakStart, breakEnd } = useClockActions();
  const onBrk = c && c.brk; const allow = breakMaxOf(P.settings);
  const bUsed = breakMins({ b: [...(dayD.b || []), ...(onBrk ? [{ i: c.brk.i, o: null }] : [])] }, now); const over = Math.max(0, bUsed - allow);
  const el = c ? Math.max(0, Math.floor((now - c.i) / 1000)) : 0;
  const tp = timeParts(now);
  return html`<section className=${'clock' + (c ? ' on' : '')} aria-label="Attendance">
    <div className="state"><span className=${'dot' + (c ? ' live' : '')} />${c ? `Clocked in since ${fmtTime(c.i)}${c.d !== today ? ', ' + fmtDate(c.d) : ''}` : "You're clocked out"}</div>
    <div className="time" aria-live="off">${c ? `${Math.floor(el / 3600)}:${pad(Math.floor(el % 3600 / 60))}:${pad(el % 60)}` : html`${tp.main}<small>${tp.per}</small>`}</div>
    <div className="sub"><span>Today: <b className="num">${hm(Math.max(0, sessMins(sess, c, now) - over))}</b></span>${c && html`<span>${MODES[c.m] || ''}</span>`}${(c || bUsed > 0) && html`<span>Breaks: <b className="num">${hm(bUsed)}</b> of ${hm(allow)}</span>`}</div>
    ${onBrk && html`<div className="brk-live"><span className="dot live" />On break since ${fmtTime(c.brk.i)} (${hm(mins(c.brk.i, now))})</div>`}
    ${over > 0 && html`<div className="note amber" style=${{ marginBottom: 10 }}><span>Breaks are ${hm(over)} over today’s ${hm(allow)} allowance. The extra time is unpaid unless an admin approves the extended break.</span></div>`}
    <${LocationStatus} />
    ${!c && html`<div className="seg" role="radiogroup" aria-label="Where are you working?">${Object.entries(MODES).map(([k, v]) => html`<button type="button" key=${k} role="radio" aria-checked=${mode === k} className=${mode === k ? 'on' : ''} onClick=${() => setMode(k)}>${v}</button>`)}</div>`}
    ${c ? html`<div className="punches">${onBrk ? html`<button type="button" className="punch brk" disabled=${busy} onClick=${() => breakEnd()}>${busy ? 'Saving…' : 'End break'}</button>` : html`<button type="button" className="punch brk" disabled=${busy} onClick=${breakStart}>${busy ? 'Saving…' : 'Start break'}</button>`}<button type="button" className="punch out" disabled=${busy} onClick=${() => clockOut()}>${busy ? 'Saving…' : 'Clock out'}</button></div>`
      : html`<button type="button" className="punch in" disabled=${busy} onClick=${() => clockIn(mode)}>${busy ? 'Saving…' : 'Clock in'}</button>`}
    ${sess.length > 0 && html`<ul className="sess">${sess.slice().reverse().map(s => html`<li key=${s.i}><span><b>${fmtTime(s.i)} – ${s.o ? fmtTime(s.o) : 'now'}</b><span style=${{ marginLeft: 10 }}>${MODES[s.m] || ''}</span></span><span className="num">${hm(mins(s.i, s.o || (c && c.i === s.i ? now : s.i)))}</span></li>`)}</ul>`}
  </section>`;
}
function ClockOutAtModal({ onClose }) {
  const P = usePortal(); const c = P.root.clock;
  const { busy, clockOut } = useClockActions();
  const [v, setV] = useState(toLocalInput(Math.min(c.i + 8 * 3600000, Date.now())));
  const [err, setErr] = useState('');
  const save = async () => {
    const t = fromLocalInput(v);
    if (!(t > c.i)) { setErr('Clock-out has to be after your clock-in time.'); return; }
    if (t > Date.now()) { setErr("Clock-out can't be in the future."); return; }
    if (await clockOut(t, true)) onClose();
  };
  return html`<${Modal} title="Set your clock-out time" onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Cancel</button><button type="button" className="btn" disabled=${busy} onClick=${save}>Save clock-out</button>`}>
    <p className="muted" style=${{ marginBottom: 16 }}>You clocked in ${fmtDate(c.d)} at ${fmtTime(c.i)}. Corrected times are marked as edited for your approver.</p>
    <${Field} label="Clocked out at"><input type="datetime-local" value=${v} min=${toLocalInput(c.i)} max=${toLocalInput(Date.now())} onInput=${e => setV(e.target.value)} /><//>
    ${err && html`<p className="err" role="alert" style=${{ marginTop: 10 }}>${err}</p>`}<//>`;
}
function ForgotBanner() {
  const P = usePortal(); const c = P.root.clock;
  const [open, setOpen] = useState(false);
  const { busy, clockOut } = useClockActions();
  if (!c || !c.on || c.d === dkey()) return null;
  return html`<div className="note amber" role="alert"><span>You're still clocked in from <b>${fmtDate(c.d)} at ${fmtTime(c.i)}</b>. Did you forget to clock out?</span>
    <div className="actions"><button type="button" className="btn sm" onClick=${() => setOpen(true)}>Set clock-out time</button><button type="button" className="btn ghost sm" disabled=${busy} onClick=${() => clockOut()}>Clock out now</button></div>
    ${open && html`<${ClockOutAtModal} onClose=${() => setOpen(false)} />`}</div>`;
}
function WeekCard() {
  const P = usePortal(); const now = useNow(30000);
  const today = dkey(new Date(now)); const ws = weekStart(today); const days = weekDays(ws);
  const m1 = mkey(days[0]), m2 = mkey(days[6]);
  const a = useDoc(`u/${P.uid}/att/${m1}`); const b = useDoc(m2 !== m1 ? `u/${P.uid}/att/${m2}` : null);
  const c = P.root.clock && P.root.clock.on ? P.root.clock : null;
  const per = days.map(k => { const md = mkey(k) === m1 ? a.data : b.data; return sessMins(((md && md.days && md.days[k]) || {}).s || [], c, now); });
  const tot = per.reduce((x, y) => x + y, 0); const max = Math.max(480, ...per);
  return html`<section className="panel">
    <div className="ph-row"><h2 className="ph">This week</h2><a className="small" href="#/portal/attendance">Attendance history</a></div>
    <div className="bignum">${hm(tot)}</div><p className="muted small">${weekLabel(ws)}</p>
    <div className="week" role="img" aria-label=${`Hours worked each day this week, ${hm(tot)} total`}>${days.map((k, i) => html`<div key=${k} className=${'d' + (k === today ? ' today' : '')}>
      <em>${per[i] ? h1(per[i] / 60) : ''}</em><div className="bar" style=${{ height: Math.max(4, Math.round(per[i] / max * 100)) + 'px' }} /><span>${DOW[i].slice(0, 2)}</span></div>`)}</div>
  </section>`;
}
function TsCard() {
  const P = usePortal(); const ws = weekStart(); const lw = addDays(ws, -7);
  const ts = P.root.ts || {}; const rev = P.asg.rev || {};
  const st = tsStatus(ts[ws], rev[ws]); const lst = tsStatus(ts[lw], rev[lw]);
  return html`<section className="panel stack" style=${{ gap: 12 }}>
    <div className="ph-row" style=${{ marginBottom: 0 }}><h2 className="ph">Timesheet</h2><${Chip} s=${st}>${TS_LABEL[st]}<//></div>
    <div><div className="bignum">${h1(ts[ws] ? ts[ws].t : 0)} h</div><p className="muted small">Week of ${weekLabel(ws)}</p></div>
    ${(['draft', 'rejected', 'reopened'].includes(lst) || (lst === 'none' && (P.root.joined || Infinity) < parseD(ws).getTime())) && html`<div className="note amber">Last week's timesheet hasn't been submitted.<div className="actions"><a className="btn sm" href=${'#/portal/timesheets?w=' + lw}>Finish last week</a></div></div>`}
    <div className="actions"><a className="btn" href=${'#/portal/timesheets?w=' + ws}>${st === 'none' ? 'Start timesheet' : 'Open timesheet'}</a></div>
  </section>`;
}
function myTasks(P) {
  return Object.entries(P.asg.tasks || {}).filter(([, t]) => !t.x).map(([id, t]) => ({ id, ...t, pr: (P.root.tp || {})[id] || {} }))
    .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
}
function TasksCard() {
  const P = usePortal();
  const open = myTasks(P).filter(t => t.pr.s !== 'done');
  return html`<section className="panel">
    <div className="ph-row"><h2 className="ph">Tasks</h2><a className="small" href="#/portal/tasks">All tasks</a></div>
    ${open.length ? html`<ul className="list">${open.slice(0, 4).map(t => html`<li key=${t.id}><div><div className="t">${t.ti}</div><div className="m">${t.due ? 'Due ' + fmtDate(t.due) : 'No due date'}</div></div><${Chip} s=${t.pr.s || 'todo'}>${TASK_S[t.pr.s || 'todo']}<//></li>`)}</ul>`
      : html`<${Empty} title="You're all caught up">New tasks from HR or your manager show up here.<//>`}
  </section>`;
}
function AnnCard() {
  const P = usePortal();
  const list = P.ann.slice().sort((a, b) => (b.pin ? 1 : 0) - (a.pin ? 1 : 0) || b.at - a.at).slice(0, 3);
  if (!list.length && !P.isAdmin) return null;
  return html`<section className="panel">
    <div className="ph-row" style=${{ marginBottom: 4 }}><h2 className="ph">Announcements</h2>${P.isAdmin && html`<a className="small" href="#/portal/admin/announcements">Manage</a>`}</div>
    ${list.length ? list.map(a => html`<article key=${a.id} className="ann"><h3>${a.ti}</h3><time>${fmtDay(a.at)}${a.pin ? ', pinned' : ''}</time><p>${a.b}</p></article>`)
      : html`<${Empty} title="No announcements yet">Post updates for the whole team, like holiday schedules or policy changes.<//>`}
  </section>`;
}
function Dashboard() {
  const P = usePortal();
  return html`<div className="stack">
    <div className="hello"><div><h2>${greeting()}${P.prof ? ', ' + firstName(P.prof.n) : ''}</h2>
      <p className="muted">${new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}${(P.asg.ec || P.asg.cl) ? ', on assignment with ' + (P.asg.ec || P.asg.cl) : ''}</p></div></div>
    ${P.isAdmin && html`<${AdminKpis} />`}
    ${P.prof ? html`<${Fragment}>
      <${ForgotBanner} />
      ${P.role === 'consultant' && html`<${JobsCard} />`}
      ${P.role === 'bench' && html`<${BenchCard} />`}
      <div className="g32"><${ClockCard} /><${WeekCard} /></div>
      <div className="g2"><${TsCard} /><${TasksCard} /></div>
      <${EarnCard} />
      <${AnnCard} />
    <//>` : html`<${Fragment}>${P.isAdmin && html`<div className="note info">To track your own time, set up your profile. Everything else in the admin section works without it.<div className="actions"><a className="btn sm" href="#/portal/profile">Set up profile</a></div></div>`}<${AnnCard} /><//>`}
  </div>`;
}

/* ================= Attendance ================= */
function MissedPunch({ onClose }) {
  const P = usePortal(); const toast = useToast(); const { mirror } = useClockActions();
  const [f, setF] = useState({ d: dkey(), i: '09:00', o: '17:00', m: P.root.lastMode || 'remote', n: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    const ti = fromLocalInput(`${f.d}T${f.i}`); let to = fromLocalInput(`${f.d}T${f.o}`);
    if (!f.d || isNaN(ti) || isNaN(to)) { setErr('Add the date and both times.'); return; }
    if (to <= ti) { setErr('Clock-out has to be after clock-in.'); return; }
    if (to > Date.now()) { setErr("Times can't be in the future."); return; }
    if (!f.n.trim()) { setErr('Add a short reason for your approver.'); return; }
    setErr(''); setBusy(true);
    try {
      const path = `u/${P.uid}/att/${mkey(f.d)}`; const md = await dbGet(path);
      const s = (((md && md.days && md.days[f.d]) || {}).s || []).map(x => ({ ...x }));
      if (s.some(x => x.i < to && (x.o || Date.now()) > ti)) { setErr('Those times overlap a session you already have that day.'); setBusy(false); return; }
      s.push({ i: ti, o: to, m: f.m, e: 1, n: f.n.trim() }); s.sort((a, b) => a.i - b.i);
      await dbMerge(path, { days: { [f.d]: { s } } });
      await mirror(f.d, s);
      toast('Missed punch added. It is marked as edited for your approver.'); onClose();
    } catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  return html`<${Modal} title="Add a missed punch" onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Cancel</button><button type="button" className="btn" disabled=${busy} onClick=${save}>Add punch</button>`}>
    <div className="form">
      <div className="row3"><${Field} label="Date"><input type="date" max=${dkey()} value=${f.d} onInput=${up('d')} /><//><${Field} label="Clock in"><input type="time" value=${f.i} onInput=${up('i')} /><//><${Field} label="Clock out"><input type="time" value=${f.o} onInput=${up('o')} /><//></div>
      <${Field} label="Work location"><select value=${f.m} onChange=${up('m')}>${Object.entries(MODES).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//>
      <${Field} label="Reason"><input value=${f.n} onInput=${up('n')} placeholder="e.g. Forgot to clock in after client meeting" /><//>
      ${err && html`<p className="err" role="alert">${err}</p>`}
    </div><//>`;
}
function attRows(md, c, now) {
  const out = [];
  Object.keys((md && md.days) || {}).sort().reverse().forEach(d => {
    const s = (md.days[d].s || []).slice().sort((a, b) => a.i - b.i);
    const day = md.days[d]; const bm = breakMins(day, now); const over = excessBreak(day, 60, now);
    s.forEach((x, i) => out.push({ d, first: i === 0, n: s.length, dayMins: Math.max(0, sessMins(s, c, now) - over), gross: sessMins(s, c, now), bm, over, nb: (day.b || []).length, x, m: mins(x.i, x.o != null ? x.o : (c && c.i === x.i ? now : x.i)) }));
  });
  return out;
}
function Attendance() {
  const P = usePortal(); const toast = useToast(); const now = useNow(30000);
  const [mk, setMk] = useState(mkey(dkey()));
  const doc = useDoc(P.prof ? `u/${P.uid}/att/${mk}` : null);
  const [add, setAdd] = useState(false);
  if (!P.prof) return html`<${NeedProfile} />`;
  const c = P.root.clock && P.root.clock.on ? P.root.clock : null;
  const rows = attRows(doc.data, c, now);
  const total = rows.reduce((a, r) => a + r.m, 0); const daysWorked = new Set(rows.map(r => r.d)).size;
  const exp = async () => {
    try { await saveDownload(`attendance-${mk}.csv`, toCSV([['Date', 'Clock in', 'Clock out', 'Hours', 'Location', 'Edited', 'Note'],
      ...rows.slice().reverse().map(r => [r.d, fmtTime(r.x.i), r.x.o ? fmtTime(r.x.o) : '', hrs(r.m), MODES[r.x.m] || '', r.x.e ? 'Yes' : '', r.x.n || ''])])); }
    catch (e) { if (!e || e.code !== 'declined') toast(errText(e), true); }
  };
  return html`<div className="stack">
    <${ForgotBanner} />
    <div className="toolbar">
      <div className="wknav"><button type="button" className="btn ghost icon" aria-label="Previous month" onClick=${() => setMk(addMonths(mk, -1))}><${Icon} n="left" /></button><b>${monthLabel(mk)}</b>
        <button className="btn ghost icon" aria-label="Next month" disabled=${mk >= mkey(dkey())} onClick=${() => setMk(addMonths(mk, 1))}><${Icon} n="right" /></button></div>
      ${mk !== mkey(dkey()) && html`<button type="button" className="btn ghost sm" onClick=${() => setMk(mkey(dkey()))}>This month</button>`}
      <div className="push"><button type="button" className="btn ghost" onClick=${() => setAdd(true)}><${Icon} n="plus" />Add missed punch</button><button type="button" className="btn ghost" disabled=${!rows.length} onClick=${exp}><${Icon} n="down" />Export CSV</button></div>
    </div>
    <div className="kpis" style=${{ gridTemplateColumns: 'repeat(3,minmax(0,1fr))' }}>
      <a><b>${hm(total)}</b><span>Total this month</span></a><a><b>${daysWorked}</b><span>Days worked</span></a><a><b>${daysWorked ? hm(total / daysWorked) : '0h 00m'}</b><span>Average per day</span></a>
    </div>
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${doc.loading ? html`<${Spinner} />` : rows.length ? html`<div className="tblwrap"><table className="tbl">
        <thead><tr><th>Date</th><th>Clock in</th><th>Clock out</th><th>Location</th><th className="r">Hours</th><th>Breaks</th><th className="r">Day total</th><th>Approval</th></tr></thead>
        <tbody>${rows.map(r => html`<tr key=${r.d + r.x.i}>
          <td>${r.first ? html`<b>${fmtDate(r.d)}</b>` : ''}</td>
          <td className="num">${fmtTime(r.x.i)}${r.x.e ? html` <span className="chip amber" title=${r.x.n || 'Edited'}>Edited</span>` : ''}</td>
          <td className="num">${r.x.o ? fmtTime(r.x.o) : html`<${Chip} s="ok">Working<//>`}</td>
          <td>${MODES[r.x.m] || ''}</td><td className="r num">${hm(r.m)}</td><td className="small">${r.first ? (r.nb ? html`${r.nb} · ${hm(r.bm)}${r.over ? html`<div style=${{ color: 'var(--amber-ink)' }}>${hm(r.over)} over${((P.asg.attA || {})[r.d] || {}).bx === 'approved' ? ', approved' : ', awaiting approval'}</div>` : ''}` : html`<span className="muted">None</span>`) : ''}</td><td className="r num">${r.first ? html`<b>${hm(((P.asg.attA || {})[r.d] || {}).bx === 'approved' ? r.gross : r.dayMins)}</b>` : ''}</td><td>${r.first ? (() => { const a = (P.asg.attA || {})[r.d]; const st = attStatus(r.d, P.asg.attA, a && a.bx === 'approved' ? r.gross : r.dayMins, attApprovalOn(P.settings)); return html`<${Chip} s=${st === 'approved' ? 'ok' : st === 'rejected' ? 'red' : 'amber'}>${ATT_ST[st]}<//>${a && a.n && st !== 'approved' ? html`<div className="muted small">${a.n}</div>` : ''}`; })() : ''}</td></tr>`)}</tbody></table></div>`
        : html`<${Empty} title=${'No attendance in ' + monthLabel(mk)}>Clock in from your dashboard and each session appears here.<//>`}
    </section>
    ${add && html`<${MissedPunch} onClose=${() => setAdd(false)} />`}
  </div>`;
}

/* ================= Timesheets ================= */
const numv = v => { const n = parseFloat(v); return isFinite(n) && n > 0 ? n : 0; };
const round2 = n => Math.round(n * 100) / 100;
function Timesheets({ q }) {
  const P = usePortal(); const toast = useToast();
  const base = `u/${P.uid}`; const cid = P.cid;
  const ws = q.w && /^\d{4}-\d{2}-\d{2}$/.test(q.w) && weekStart(q.w) === q.w ? q.w : weekStart();
  const doc = useDoc(P.prof ? `${base}/ts/${ws}` : null);
  const pub = useDoc(P.prof && cid ? `pub/${cid}/ts/${P.uid}_${ws}` : null);
  const sum = (P.root.ts || {})[ws]; const rev = (P.asg.rev || {})[ws];
  const st = tsStatus(sum, rev);
  const cst = cid && sum && sum.s === 'submitted' ? cdStatus(pub.data) : 'none';
  const editable = ['none', 'draft', 'rejected', 'reopened'].includes(st);
  const projects = (P.asg.pr || '').split(',').map(s => s.trim()).filter(Boolean);
  const blank = () => ({ p: projects[0] || '', t: '', h: ['', '', '', '', '', '', ''] });
  const [form, setForm] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [prog, setProg] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const loadedFor = useRef('');
  useEffect(() => {
    if (doc.loading) return;
    if (dirty && loadedFor.current === ws) return;
    loadedFor.current = ws;
    const d = doc.data;
    setForm(d ? { rows: d.rows && d.rows.length ? d.rows.map(r => ({ p: r.p || '', t: r.t || '', h: r.h.map(x => x ? String(x) : '') })) : [blank()], note: d.note || '', files: (d.files || []).map(f => ({ ...f })) }
      : { rows: [blank()], note: '', files: [] });
    setDirty(false);
  }, [ws, doc.loading, doc.data]);
  if (!P.prof) return html`<${NeedProfile} />`;
  const days = weekDays(ws);

  const persist = async (submit, f) => {
    f = f || form;
    const rows = f.rows.map(r => ({ p: (r.p || '').trim(), t: (r.t || '').trim(), h: r.h.map(x => round2(numv(x))) })).filter(r => r.t || r.h.some(x => x > 0) || (r.p && f.rows.length === 1));
    const dayT = DOW.map((_, d) => rows.reduce((a, r) => a + r.h[d], 0));
    if (dayT.some(x => x > 24)) throw { message: "A day can't have more than 24 hours." };
    const total = round2(dayT.reduce((a, b) => a + b, 0));
    if (submit && !total) throw { message: 'Add your hours before submitting.' };
    if (submit && P.asg.na && !f.files.length) throw { message: 'Attach your client-approved timesheet before submitting.' };
    const now = Date.now();
    const data = { w: ws, rows, note: (f.note || '').trim(), files: f.files, s: submit ? 'submitted' : 'draft', u: now, sa: submit ? now : null };
    await dbSet(`${base}/ts/${ws}`, data);
    await dbMerge(base, { ts: { [ws]: { t: total, s: data.s, u: now, sa: data.sa, f: f.files.length } } });
    if (cid && (submit || (pub.data && pub.data.s === 'submitted'))) {
      await dbSet(`pub/${cid}/ts/${P.uid}_${ws}`, { uid: P.uid, n: P.prof.n, w: ws, t: total, rows, note: data.note, s: submit ? 'submitted' : 'withdrawn', sa: data.sa, u: now, cd: (pub.data && pub.data.cd) || null });
    }
    setDirty(false);
  };
  const act = async (label, fn, okMsg) => {
    setBusy(label);
    try { await fn(); okMsg && toast(okMsg); } catch (e) { toast(errText(e), true); }
    setBusy('');
  };
  const goWeek = async n => {
    if (dirty && editable) { try { await persist(false); toast('Draft saved.'); } catch (e) { toast(errText(e), true); return; } }
    location.hash = '#/portal/timesheets?w=' + addDays(ws, n * 7);
  };
  const setRow = (ri, patch) => { setForm({ ...form, rows: form.rows.map((r, i) => i === ri ? { ...r, ...patch } : r) }); setDirty(true); };
  const setH = (ri, di, v) => setRow(ri, { h: form.rows[ri].h.map((x, j) => j === di ? v : x) });
  const fill = () => act('fill', async () => {
    const docs = {}; for (const m of [...new Set(days.map(mkey))]) docs[m] = await dbGet(`${base}/att/${m}`);
    const per = days.map(k => Math.round(((((docs[mkey(k)] || {}).days || {})[k] || {}).s || []).reduce((a, x) => a + (x.o ? mins(x.i, x.o) : 0), 0) / 15) / 4);
    if (!per.some(Boolean)) throw { message: 'No completed clock-in sessions found for this week.' };
    const rows = form.rows.slice(); rows[0] = { ...rows[0], h: per.map(x => x ? String(x) : '') };
    setForm({ ...form, rows }); setDirty(true);
  }, 'Filled from your attendance. Check the hours, then save.');
  const copyPrev = () => act('copy', async () => {
    const d = await dbGet(`${base}/ts/${addDays(ws, -7)}`);
    if (!d || !d.rows || !d.rows.length) throw { message: 'There is no timesheet for the previous week to copy.' };
    setForm({ ...form, rows: d.rows.map(r => ({ p: r.p || '', t: r.t || '', h: r.h.map(x => x ? String(x) : '') })) }); setDirty(true);
  }, 'Copied last week. Adjust anything that changed.');
  const onFiles = files => act('upload', async () => {
    let f2 = form;
    for (const file of files) {
      setProg(0.03);
      const r = await storeFile(base, file, { c: 'timesheet', w: ws }, setProg);
      f2 = { ...f2, files: [...f2.files, { id: r.id, n: r.n, sz: r.sz, ty: r.ty }] };
    }
    setForm(f2); await persist(false, f2);
  }, 'Attachment added and draft saved.');
  const removeFile = f => act('rm', async () => {
    await deleteStored(base, f.id);
    const f2 = { ...form, files: form.files.filter(x => x.id !== f.id) }; setForm(f2); await persist(false, f2);
  }, 'Attachment removed.');

  const totals = form ? DOW.map((_, d) => form.rows.reduce((a, r) => a + numv(r.h[d]), 0)) : [];
  const grand = totals.reduce((a, b) => a + b, 0);
  const hist = Object.entries(P.root.ts || {}).sort((a, b) => b[0].localeCompare(a[0]));
  const projOpts = (cur) => [...new Set([...projects, cur].filter(Boolean))];
  const cdNote = pub.data && pub.data.cd;
  return html`<div className="stack">
    <div className="toolbar">
      <div className="wknav"><button type="button" className="btn ghost icon" aria-label="Previous week" disabled=${!!busy} onClick=${() => goWeek(-1)}><${Icon} n="left" /></button><b>${weekLabel(ws)}</b>
        <button className="btn ghost icon" aria-label="Next week" disabled=${!!busy || ws >= weekStart()} onClick=${() => goWeek(1)}><${Icon} n="right" /></button></div>
      <${Chip} s=${st}>${TS_LABEL[st]}<//>
      ${cst !== 'none' && html`<${Chip} s=${cst === 'approved' ? 'ok' : cst === 'returned' ? 'red' : 'amber'}>${CD_LABEL[cst]}<//>`}
      ${editable && html`<div className="push"><button type="button" className="btn ghost sm" disabled=${!!busy} onClick=${fill}>Fill from attendance</button><button type="button" className="btn ghost sm" disabled=${!!busy} onClick=${copyPrev}>Copy previous week</button></div>`}
    </div>
    ${st === 'rejected' && html`<div className="note red"><span><b>Returned by StratEdge.</b> ${rev.c || 'Update your timesheet and submit it again.'}</span></div>`}
    ${st === 'reopened' && html`<div className="note info"><span><b>Reopened for changes.</b> ${rev.c || 'Make your updates and submit again.'}</span></div>`}
    ${cst === 'returned' && cdNote && html`<div className="note red"><span><b>Returned by your client.</b> ${cdNote.c || 'Review the hours with your client manager and resubmit.'}</span></div>`}
    ${cst === 'approved' && cdNote && html`<div className="note ok"><span>Your client approved these hours ${fmtDay(cdNote.at)}.${cdNote.c ? ' ' + cdNote.c : ''}</span></div>`}
    ${st === 'pending' && html`<div className="note amber"><span>Submitted ${fmtTs(sum.sa)}. ${cid ? 'Your client and StratEdge are reviewing it.' : 'Waiting for approval.'}</span><div className="actions"><button type="button" className="btn ghost sm" disabled=${!!busy} onClick=${() => act('withdraw', () => persist(false), 'Withdrawn. You can edit and resubmit.')}>Withdraw to edit</button></div></div>`}
    ${st === 'approved' && html`<div className="note ok"><span>Approved by StratEdge ${fmtDay(rev.at)}${rev.c ? ': ' + rev.c : ''}. This timesheet is locked.</span></div>`}
    ${!form ? html`<${Spinner} />` : html`<${Fragment}>
      <div className="stack" style=${{ gap: 10 }}>
        ${form.rows.map((r, ri) => html`<div key=${ri} className="tsline">
          <div className="top">
            <${Field} label="Project">${projects.length ? html`<select disabled=${!editable} value=${r.p} onChange=${e => setRow(ri, { p: e.target.value })}>${projOpts(r.p).map(p => html`<option key=${p}>${p}</option>`)}</select>`
              : html`<input disabled=${!editable} value=${r.p} onInput=${e => setRow(ri, { p: e.target.value })} placeholder="Client or project" />`}<//>
            <${Field} label="Task or description"><input disabled=${!editable} value=${r.t} onInput=${e => setRow(ri, { t: e.target.value })} placeholder="What you worked on" /><//>
            ${editable && form.rows.length > 1 ? html`<button type="button" className="btn ghost icon" aria-label="Remove line" onClick=${() => { setForm({ ...form, rows: form.rows.filter((_, i) => i !== ri) }); setDirty(true); }}><${Icon} n="trash" /></button>` : html`<span />`}
          </div>
          <div className="days">${DOW.map((d, di) => html`<label key=${d} className=${di > 4 ? 'we' : ''}>${d} ${parseD(days[di]).getDate()}
            <input disabled=${!editable} inputMode="decimal" value=${r.h[di]} placeholder="0" aria-label=${`${d} hours, line ${ri + 1}`}
              onInput=${e => setH(ri, di, e.target.value.replace(/[^0-9.]/g, '').slice(0, 5))} /></label>`)}
            <div className="tot">${h1(r.h.reduce((a, x) => a + numv(x), 0))} h</div></div>
        </div>`)}
        <div className="days sum" aria-label="Daily totals">${totals.map((t, i) => html`<div key=${i} className=${t > 24 ? 'over' : ''}>${h1(t)}</div>`)}<div className="tot" style=${{ fontSize: 17 }}>${h1(grand)} h</div></div>
        ${editable && html`<div><button type="button" className="btn ghost sm" onClick=${() => { setForm({ ...form, rows: [...form.rows, blank()] }); setDirty(true); }}><${Icon} n="plus" />Add line</button></div>`}
      </div>
      <section className="panel stack" style=${{ gap: 14 }}>
        <div><h2 className="ph">Attachments</h2><p className="muted small" style=${{ marginTop: 4 }}>${P.asg.na ? 'Your client requires a signed timesheet. Attach it before submitting.' : 'Attach your client-approved timesheet if your client provides one.'}</p></div>
        ${form.files.length > 0 && html`<ul className="files">${form.files.map(f => html`<li key=${f.id}><${Icon} n="file" /><div className="fn"><b>${f.n}</b><span>${sizeLabel(f.sz || 0)}</span></div>
          <${FileActions} base=${base} f=${f} onDelete=${editable ? () => removeFile(f) : null} /></li>`)}</ul>`}
        ${editable && html`<${FilePick} busy=${busy === 'upload'} progress=${prog} onFiles=${onFiles} label="Drop your signed timesheet here, or choose a file." />`}
        <${Field} label="Notes for your approver"><textarea disabled=${!editable} value=${form.note} onInput=${e => { setForm({ ...form, note: e.target.value }); setDirty(true); }} placeholder="Overtime, holidays, anything your approver should know" /><//>
      </section>
      ${editable && html`<div className="actions">
        <button type="button" className="btn lg" disabled=${!!busy} onClick=${() => act('submit', () => persist(true), cid ? 'Submitted to your client and StratEdge for approval.' : 'Timesheet submitted for approval.')}>${busy === 'submit' ? 'Submitting…' : 'Submit for approval'}</button>
        <button type="button" className="btn ghost lg" disabled=${!!busy} onClick=${() => act('save', () => persist(false), 'Draft saved.')}>${busy === 'save' ? 'Saving…' : 'Save draft'}</button>
        ${dirty && html`<span className="muted small">Unsaved changes</span>`}</div>`}
    <//>`}
    <section className="panel">
      <h2 className="ph" style=${{ marginBottom: 8 }}>Timesheet history</h2>
      ${hist.length ? html`<ul className="list">${(showAll ? hist : hist.slice(0, 8)).map(([w, s]) => { const x = tsStatus(s, (P.asg.rev || {})[w]); return html`<li key=${w}>
        <a href=${'#/portal/timesheets?w=' + w} style=${{ textDecoration: 'none', color: 'inherit' }}><div className="t">${weekLabel(w)}</div><div className="m">${h1(s.t)} hours${s.f ? `, ${s.f} attachment${s.f > 1 ? 's' : ''}` : ''}</div></a>
        <${Chip} s=${x}>${TS_LABEL[x]}<//></li>`; })}</ul>
        ${hist.length > 8 && !showAll && html`<button type="button" className="btn link" style=${{ marginTop: 10 }} onClick=${() => setShowAll(true)}>Show all ${hist.length} weeks</button>`}`
      : html`<${Empty} title="No timesheets yet">Your submitted weeks will be listed here.<//>`}
    </section>
  </div>`;
}

/* ================= Tasks ================= */
function TaskItem({ t }) {
  const P = usePortal(); const toast = useToast();
  const [note, setNote] = useState(t.pr.n || '');
  const [busy, setBusy] = useState(false);
  const save = async (s, n) => {
    setBusy(true);
    try { await dbMerge(`u/${P.uid}`, { tp: { [t.id]: { s, n: (n != null ? n : note).trim(), at: Date.now() } } }); toast(s === 'done' ? 'Task marked done.' : 'Task updated.'); }
    catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  const s = t.pr.s || 'todo'; const late = t.due && t.due < dkey() && s !== 'done';
  return html`<article className=${'task' + (s === 'done' ? ' isdone' : '')}>
    <div className="ph-row" style=${{ marginBottom: 0, alignItems: 'flex-start' }}><h3>${t.ti}</h3><span className=${'prio ' + (t.p || '')}>${t.p === 'high' ? 'High priority' : t.p === 'low' ? 'Low priority' : 'Normal'}</span></div>
    ${t.d && html`<p className="muted" style=${{ fontSize: 15, whiteSpace: 'pre-wrap' }}>${t.d}</p>`}
    <div className="meta"><span className=${late ? 'late' : ''}>${t.due ? (late ? 'Overdue, was due ' : 'Due ') + fmtDate(t.due) : 'No due date'}</span><span>Assigned ${fmtDay(t.at)}</span></div>
    <div className="row2 form" style=${{ gap: 10 }}>
      <${Field} label="Status"><select value=${s} disabled=${busy} onChange=${e => save(e.target.value)}>${Object.entries(TASK_S).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//>
      <${Field} label="Update for your manager"><div style=${{ display: 'flex', gap: 8 }}><input value=${note} onInput=${e => setNote(e.target.value)} placeholder="Progress, blockers, links" />
        <button type="button" className="btn ghost" disabled=${busy || note === (t.pr.n || '')} onClick=${() => save(s)}>Save</button></div><//>
    </div>
  </article>`;
}
function Tasks() {
  const P = usePortal();
  const [tab, setTab] = useState('open');
  const all = myTasks(P);
  const list = all.filter(t => tab === 'open' ? t.pr.s !== 'done' : t.pr.s === 'done');
  return html`<div className="stack">
    <div className="tabs" role="tablist">${[['open', 'Open'], ['done', 'Done']].map(([k, v]) => html`<button type="button" key=${k} role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${v}<span className="chip">${all.filter(t => k === 'open' ? t.pr.s !== 'done' : t.pr.s === 'done').length}</span></button>`)}</div>
    ${list.length ? list.map(t => html`<${TaskItem} key=${t.id} t=${t} />`) : html`<div className="panel"><${Empty} title=${tab === 'open' ? 'No open tasks' : 'Nothing completed yet'}>Tasks assigned by HR or your manager appear here, along with due dates and priorities.<//></div>`}
  </div>`;
}

/* ================= Time off ================= */
function TimeOff() {
  const P = usePortal(); const toast = useToast();
  const [f, setF] = useState({ k: 'pto', f: '', t: '', r: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  if (!P.prof) return html`<${NeedProfile} />`;
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const submit = async e => {
    e.preventDefault();
    if (!f.f || !f.t) { setErr('Choose the first and last day off.'); return; }
    if (f.t < f.f) { setErr('The last day has to be on or after the first day.'); return; }
    setErr(''); setBusy(true);
    try { await dbMerge(`u/${P.uid}`, { lv: { [nid()]: { k: f.k, f: f.f, t: f.t, r: f.r.trim(), at: Date.now() } } }); setF({ k: 'pto', f: '', t: '', r: '' }); toast('Time-off request sent to HR.'); }
    catch (x) { toast(errText(x), true); }
    setBusy(false);
  };
  const cancel = async id => { try { await dbMerge(`u/${P.uid}`, { lv: { [id]: { x: 1 } } }); toast('Request cancelled.'); } catch (x) { toast(errText(x), true); } };
  const list = Object.entries(P.root.lv || {}).map(([id, l]) => ({ id, ...l, dec: (P.asg.lvd || {})[id] })).sort((a, b) => b.f.localeCompare(a.f));
  const n = bizDays(f.f, f.t);
  return html`<div className="g2" style=${{ alignItems: 'start' }}>
    <form className="panel form" onSubmit=${submit} noValidate>
      <h2 className="ph">Request time off</h2>
      <${Field} label="Type"><select value=${f.k} onChange=${up('k')}>${Object.entries(LEAVE_K).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//>
      <div className="row2"><${Field} label="First day off"><input type="date" value=${f.f} onInput=${up('f')} /><//><${Field} label="Last day off"><input type="date" min=${f.f} value=${f.t} onInput=${up('t')} /><//></div>
      ${n > 0 && html`<p className="muted small">${n} business day${n > 1 ? 's' : ''}</p>`}
      <${Field} label="Note for HR"><textarea value=${f.r} onInput=${up('r')} placeholder="Optional. Your client lead's approval, coverage plans, etc." /><//>
      ${err && html`<p className="err" role="alert">${err}</p>`}
      <div><button className="btn" disabled=${busy}>${busy ? 'Sending…' : 'Send request'}</button></div>
    </form>
    <section className="panel"><h2 className="ph" style=${{ marginBottom: 8 }}>Your requests</h2>
      ${list.length ? html`<ul className="list">${list.map(l => { const s = l.x ? 'cancelled' : l.dec ? l.dec.s : 'pending'; return html`<li key=${l.id}>
        <div><div className="t">${LEAVE_K[l.k]}: ${fmtDate(l.f)}${l.t !== l.f ? ' to ' + fmtDate(l.t) : ''}</div><div className="m">${bizDays(l.f, l.t)} business day${bizDays(l.f, l.t) === 1 ? '' : 's'}${l.dec && l.dec.c ? '. HR: ' + l.dec.c : ''}</div></div>
        <div className="actions"><${Chip} s=${s}>${s === 'pending' ? 'Pending' : s === 'approved' ? 'Approved' : s === 'declined' ? 'Declined' : 'Cancelled'}<//>${s === 'pending' && html`<button type="button" className="btn ghost sm" onClick=${() => cancel(l.id)}>Cancel</button>`}</div></li>`; })}</ul>`
        : html`<${Empty} title="No requests yet">Requests you send show their approval status here.<//>`}
    </section>
  </div>`;
}

/* ================= Documents ================= */
function Documents() {
  const P = usePortal(); const toast = useToast();
  const base = `u/${P.uid}`;
  const files = useCol(P.prof ? `${base}/f` : null, 'at:desc');
  const [cat, setCat] = useState('other'); const [busy, setBusy] = useState(false); const [prog, setProg] = useState(0);
  if (!P.prof) return html`<${NeedProfile} />`;
  const onFiles = async fs => {
    setBusy(true);
    try { for (const f of fs) { setProg(0.03); await storeFile(base, f, { c: cat }, setProg); } toast('Document uploaded.'); }
    catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  const del = async f => { try { await deleteStored(base, f.id, f.np); toast('Document deleted.'); } catch (e) { toast(errText(e), true); } };
  return html`<div className="stack">
    <section className="panel stack" style=${{ gap: 14 }}>
      <div><h2 className="ph">Upload a document</h2><p className="muted small" style=${{ marginTop: 4 }}>Only you and StratEdge HR can open your documents.</p></div>
      <div style=${{ maxWidth: 320 }}><${Field} label="Document type"><select value=${cat} onChange=${e => setCat(e.target.value)}>${Object.entries(DOC_CATS).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//></div>
      <${FilePick} busy=${busy} progress=${prog} onFiles=${onFiles} />
    </section>
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${files.loading ? html`<${Spinner} />` : files.docs.length ? html`<div className="tblwrap"><table className="tbl">
        <thead><tr><th>Name</th><th>Type</th><th>Uploaded</th><th className="r">Size</th><th className="r"><span className="sr">Actions</span></th></tr></thead>
        <tbody>${files.docs.map(f => html`<tr key=${f.id}><td><b style=${{ fontWeight: 600 }}>${f.n}</b>${f.w ? html`<div className="muted small">Week of ${fmtDate(f.w)}</div>` : ''}${f.vf ? html`<div className="small"><${Chip} s=${f.vf.s === 'verified' ? 'ok' : 'red'}>${f.vf.s === 'verified' ? 'Verified by HR' : 'Sent back'}<//>${f.vf.n ? html` <span className="muted">${f.vf.n}</span>` : ''}</div>` : ''}</td><td>${DOC_CATS[f.c] || (f.c === 'onboarding' ? 'Onboarding' : 'Other')}</td><td className="num">${fmtDay(f.at)}</td><td className="r num">${sizeLabel(f.sz)}</td>
          <td className="r"><div className="actions" style=${{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}><${FileActions} base=${base} f=${f} onDelete=${f.w ? null : () => del(f)} /></div></td></tr>`)}</tbody></table></div>`
        : html`<${Empty} title="No documents yet">Upload agreements, insurance certificates, tax forms or invoices so HR has them on file.<//>`}
    </section>
  </div>`;
}

/* ================= Profile ================= */
function Profile() {
  const P = usePortal(); const a = P.asg; const me = P.people[P.uid] || Cap.me || {};
  const emp = P.role === 'employer';
  return html`<div className="g2" style=${{ alignItems: 'start' }}>
    <section className="panel stack"><h2 className="ph">${P.prof ? 'Your details' : 'Set up your profile'}</h2>
      <${ProfileForm} uid=${P.uid} initial=${P.prof} /></section>
    <div className="stack">
      <section className="panel"><h2 className="ph" style=${{ marginBottom: 14 }}>Signed in as</h2>
        <div className="person"><${Avatar} p=${me} size=${44} /><div><b>${me.name || 'Your account'}</b><span>${me.email || ''}${me.email ? ', ' : ''}${P.isAdmin ? 'admin access' : portalLabel(P.role).toLowerCase()}</span></div></div></section>
      <${PasswordPanel} />
      <section className="panel"><h2 className="ph" style=${{ marginBottom: 14 }}>${emp ? 'Your company' : 'Assignment'}</h2>
        ${emp ? html`<dl className="kv"><dt>Company</dt><dd>${a.cl || (P.prof && P.prof.co) || '—'}</dd>${a.ec && html`<dt>End client</dt><dd>${a.ec}</dd>`}<dt>Access</dt><dd>Approve timesheets, see attendance, post requirements</dd></dl>`
          : a.cl || a.pr || a.ty ? html`<dl className="kv">
          ${a.ty && html`<dt>Engagement</dt><dd>${a.ty}</dd>`}${a.cl && html`<dt>Client or vendor</dt><dd>${a.cl}</dd>`}${a.ec && html`<dt>End client</dt><dd>${a.ec}</dd>`}
          ${a.pr && html`<dt>Projects</dt><dd>${a.pr}</dd>`}${a.mgr && html`<dt>Approver</dt><dd>${a.mgr}</dd>`}${a.sd && html`<dt>Start date</dt><dd>${fmtDate(a.sd, { month: 'long', day: 'numeric', year: 'numeric' })}</dd>`}</dl>`
          : html`<p className="muted">HR hasn't added assignment details yet.</p>`}</section>
    </div>
  </div>`;
}

function PasswordPanel() {
  const toast = useToast();
  const [f, setF] = useState({ c: '', n: '', n2: '' }); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const save = async e => {
    e.preventDefault();
    if (f.n.length < 8) { setErr('Use a new password of at least 8 characters.'); return; }
    if (f.n !== f.n2) { setErr('The new passwords don\u2019t match.'); return; }
    setErr(''); setBusy(true);
    try { await api('password', { current: f.c, new: f.n }); setF({ c: '', n: '', n2: '' }); toast('Password changed.'); } catch (x) { setErr(errText(x)); }
    setBusy(false);
  };
  return html`<form className="panel form" onSubmit=${save} noValidate><h2 className="ph">Change password</h2>
    <${Field} label="Current password"><input type="password" value=${f.c} onInput=${up('c')} autoComplete="current-password" /><//>
    <div className="row2"><${Field} label="New password"><input type="password" value=${f.n} onInput=${up('n')} autoComplete="new-password" /><//><${Field} label="Confirm new password"><input type="password" value=${f.n2} onInput=${up('n2')} autoComplete="new-password" /><//></div>
    ${err && html`<p className="err" role="alert">${err}</p>`}
    <div><button className="btn ghost" disabled=${busy}>${busy ? 'Saving…' : 'Update password'}</button></div></form>`;
}

/* ================= Earnings (computed from clock-ins) ================= */
const payLabel = p => p.type === 'hourly' ? `${fmtMoney(p.amt, p.cur)} per hour` : `${fmtMoney(p.amt, p.cur)} per month`;
function PayBreakdown({ c }) {
  const cur = c.p.cur; const M = n => fmtMoney(n, cur);
  const row = (label, note, v, cls) => html`<tr className=${cls || ''}><td><b style=${{ fontWeight: cls ? 750 : 600 }}>${label}</b>${note && html`<div className="muted small">${note}</div>`}</td><td className="r num">${v}</td></tr>`;
  return html`<div className="tblwrap"><table className="tbl">
    <tbody>
      ${row(c.p.type === 'hourly' ? 'Regular hours' : 'Base pay', c.p.type === 'hourly' ? `${hm(c.reg)} × ${M(c.hourRate)} per hour` : c.p.lop ? `${M(c.p.amt)} ÷ ${c.workDays} working days = ${M(c.dayRate)} per day × ${c.paidDays} paid day${c.paidDays === 1 ? '' : 's'}` : 'Fixed monthly salary', M(c.base))}
      ${(c.ot > 0 || c.otPay > 0) && row('Overtime', `${hm(c.ot)}${c.p.type === 'hourly' ? ` × ${M(c.hourRate)}` : ` × ${M(c.hourRate)} per hour`}${+c.p.ot ? ` × ${+c.p.ot}` : (c.p.type === 'monthly' ? ', not paid under this pay plan' : '')}`, M(c.otPay))}
      ${c.allow.map(a => row(a.n, a.note || 'Allowance', '+ ' + M(a.v)))}
      ${row('Gross pay', '', M(c.gross), 'sum')}
      ${c.ded.map(a => row(a.n, a.note || 'Deduction', '− ' + M(a.v)))}
      ${c.adj.map(a => row(a.n, 'This month only', (a.v < 0 ? '− ' : '+ ') + M(Math.abs(a.v))))}
      ${row('Net pay', c.unpaidDays ? `${c.unpaidDays} unpaid day${c.unpaidDays === 1 ? '' : 's'} (loss of pay)` : '', M(c.net), 'sum')}
    </tbody></table></div>`;
}
function payCsv(c, mk, name) {
  const M = n => r2(n).toFixed(2);
  const rows = [['Payslip', name, monthLabel(mk)], ['Currency', c.p.cur], ['Pay plan', c.p.type === 'hourly' ? 'Hourly' : 'Monthly', M(c.p.amt)], [],
    ['Working days', c.workDays], ['Present days', c.present], ['Paid leave days', c.leaveDays], ['Unpaid days', c.unpaidDays], ['Regular hours', hrs(c.reg)], ['Overtime hours', hrs(c.ot)], [],
    ['Base pay', M(c.base)], ['Overtime pay', M(c.otPay)], ...c.allow.map(a => [a.n, M(a.v)]), ['Gross pay', M(c.gross)], ...c.ded.map(a => [a.n, '-' + M(a.v)]), ...c.adj.map(a => [a.n, M(a.v)]), ['Net pay', M(c.net)], [],
    ['Date', 'Day type', 'Hours', 'Overtime'], ...c.days.map(d => [d.k, d.h ? 'Holiday' : !d.w ? 'Weekend' : d.lv ? 'Paid leave' : d.m ? 'Present' : 'Absent', hrs(d.m), hrs(d.ot)])];
  return toCSV(rows);
}
function Earnings() {
  const P = usePortal(); const toast = useToast(); const ps = payStartOf(P.settings);
  const [mk, setMk] = useState(cycleFor(dkey(), ps));
  const pay = P.asg.pay; const ready = !!(P.prof && pay && +pay.amt); const cyc = cycleRange(mk, ps);
  const md = useCycleAtt(P.uid, cyc, ready);
  if (!P.prof) return html`<${NeedProfile} />`;
  if (!ready) return html`<div className="stack"><${NoPayPlan} /><${MyPaystubs} /></div>`;
  const c = computePay(pay, md.data, mk, approvedLeaves(P.root, P.asg), P.settings.hol || [], (P.asg.payAdj || {})[mk] || [], { from: cyc.from, to: cyc.to, approvals: P.asg.attA, requireApproval: attApprovalOn(P.settings), breakMax: breakMaxOf(P.settings) });
  const M = n => fmtMoney(n, c.p.cur);
  const exp = async () => { try { await saveDownload(`payslip-${mk}.csv`, payCsv(c, mk, P.prof.n)); } catch (e) { if (!e || e.code !== 'declined') toast(errText(e), true); } };
  return html`<div className="stack">
    <div className="toolbar">
      <div className="wknav"><button type="button" className="btn ghost icon" aria-label="Previous pay period" onClick=${() => setMk(addMonths(mk, -1))}><${Icon} n="left" /></button><b>${cyc.label}</b>
        <button className="btn ghost icon" aria-label="Next pay period" disabled=${mk >= cycleFor(dkey(), ps)} onClick=${() => setMk(addMonths(mk, 1))}><${Icon} n="right" /></button></div>
      <span className="muted small">${payLabel(c.p)}${c.p.from ? ', from ' + fmtDate(c.p.from, { month: 'short', day: 'numeric', year: 'numeric' }) : ''}${ps > 1 ? `. Pay period runs from the ${ps}${ps === 26 ? 'th' : ''} to the ${ps - 1}${ps - 1 === 25 ? 'th' : ''}.` : ''}</span>
      <div className="push"><button type="button" className="btn ghost" onClick=${exp}><${Icon} n="down" />Download payslip</button></div>
    </div>
    <div className="kpis" style=${{ gridTemplateColumns: 'repeat(4,minmax(0,1fr))' }}>
      <a><b>${M(c.net)}</b><span>Net pay${mk === mkey(dkey()) ? ' so far' : ''}</span></a>
      <a><b>${c.present}<span style=${{ fontSize: 16, fontWeight: 600 }}> / ${c.workDays}</span></b><span>Approved days / working days${+c.p.wdm > 0 ? ' (standard ' + c.p.wdm + ')' : ''}${c.pending ? `, ${c.pending} awaiting admin approval` : ''}</span></a>
      <a><b>${hm(c.reg)}</b><span>Regular hours</span></a>
      <a><b>${hm(c.ot)}</b><span>Overtime hours</span></a>
    </div>
    ${md.loading ? html`<${Spinner} />` : html`<${Fragment}>
      <section className="panel" style=${{ padding: '6px 8px' }}><h2 className="ph" style=${{ padding: '12px 12px 4px' }}>Breakdown</h2><${PayBreakdown} c=${c} /></section>
      <section className="panel" style=${{ padding: '6px 8px' }}><h2 className="ph" style=${{ padding: '12px 12px 4px' }}>Day by day</h2>
        <div className="tblwrap"><table className="tbl"><thead><tr><th>Date</th><th>Day</th><th className="r">Hours</th><th className="r">Overtime</th>${c.p.type === 'hourly' && html`<th className="r">Pay</th>`}</tr></thead>
          <tbody>${c.days.filter(d => d.m || d.w || d.h || d.lv).map(d => html`<tr key=${d.k}><td>${fmtDate(d.k)}</td>
            <td>${d.h ? html`<${Chip}>Holiday<//>` : !d.w ? html`<${Chip}>Weekend<//>` : d.lv ? html`<${Chip} s="new">Paid leave<//>` : d.m ? html`<${Chip} s="ok">Present<//>` : d.k > dkey() ? html`<span className="muted small">Upcoming</span>` : html`<${Chip} s="red">Absent<//>`}</td>
            <td className="r num">${d.m ? hm(d.m) : ''}</td><td className="r num">${d.ot ? hm(d.ot) : ''}</td>
            ${c.p.type === 'hourly' && html`<td className="r num">${d.m ? M(d.reg / 60 * c.hourRate + d.ot / 60 * c.hourRate * (+c.p.ot || 1)) : ''}</td>`}</tr>`)}</tbody></table></div></section>
    <//>`}
    <p className="muted small">Computed from your clock-ins and clock-outs${c.p.type === 'monthly' ? `, on a ${c.p.days === 'mon-sat' ? 'Monday to Saturday' : c.p.days === 'all' ? 'seven-day' : 'Monday to Friday'} basis` : ''}. A session counts after you clock out. Final payroll is confirmed by StratEdge.</p>
      <${MyPaystubs} />
  </div>`;
}
function EarnCard() {
  const P = usePortal(); const pay = P.asg.pay; const ps = payStartOf(P.settings); const mk = cycleFor(dkey(), ps); const cyc = cycleRange(mk, ps);
  const md = useCycleAtt(P.uid, cyc, !!(pay && +pay.amt));
  if (!pay || !+pay.amt) return null;
  const c = computePay(pay, md.data, mk, approvedLeaves(P.root, P.asg), P.settings.hol || [], (P.asg.payAdj || {})[mk] || [], { from: cyc.from, to: cyc.to, approvals: P.asg.attA, requireApproval: attApprovalOn(P.settings), breakMax: breakMaxOf(P.settings) });
  return html`<section className="panel"><div className="ph-row"><h2 className="ph">Earnings this pay period</h2><a className="small" href="#/portal/pay">Full breakdown</a></div>
    <div className="bignum">${fmtMoney(c.net, c.p.cur)}</div><p className="muted small">${cyc.short}: ${c.present} of ${c.workDays} approved days so far${c.pending ? `, ${c.pending} awaiting approval` : ''}, ${hm(c.reg + c.ot)} clocked. ${payLabel(c.p)}.</p></section>`;
}

/* ================= Onboarding (employee view) & policies ================= */
function OnboardingPage() {
  const P = usePortal(); const toast = useToast();
  const onb = P.asg.onb; const base = `u/${P.uid}`;
  const files = useCol(P.prof ? `${base}/f` : null, 'at:desc');
  const [busyId, setBusyId] = useState(''); const [prog, setProg] = useState(0);
  if (!P.prof) return html`<${NeedProfile} />`;
  if (!onb || onb.kind === 'done') return html`<div className="panel"><${Empty} title=${onb ? 'Your checklist is complete' : 'No checklist yet'}>${onb ? 'HR has verified everything. Your documents stay under Documents.' : 'When HR starts your onboarding, the documents and steps you need to complete appear here.'}<//></div>`;
  const items = tplItems(P.tpl, onb.kind); const st = onb.items || {}; const up = P.root.onbUp || {};
  const upload = async (item, fs) => {
    setBusyId(item.id);
    try { setProg(0.03); const r = await storeFile(base, fs[0], { c: 'onboarding', item: item.id }, setProg); await dbMerge(base, { onbUp: { [item.id]: r.id } }); toast(`${item.n}: uploaded. HR will verify it.`); }
    catch (e) { toast(errText(e), true); }
    setBusyId('');
  };
  const done = items.filter(i => ['verified', 'na'].includes((st[i.id] || {}).s)).length;
  return html`<div className="stack">
    <div className="note info"><span><b>${onb.kind === 'off' ? 'Offboarding' : 'Onboarding'} checklist.</b> Upload each document below; HR verifies it and ticks it off. ${done} of ${items.length} done.</span></div>
    ${items.map(i => { const s = st[i.id] || {}; const fid = up[i.id]; const f = fid && files.docs.find(x => x.id === fid); const status = s.s || (fid ? 'received' : 'pending'); return html`<section key=${i.id} className="panel stack" style=${{ gap: 10 }}>
      <div className="ph-row" style=${{ marginBottom: 0 }}><div><h2 className="ph">${i.n}</h2>${i.d && html`<p className="muted small" style=${{ marginTop: 4 }}>${i.d}</p>`}</div><${Chip} s=${status === 'verified' || status === 'na' ? 'ok' : status === 'received' ? 'amber' : ''}>${ONB_ST[status] || status}<//></div>
      ${s.n && html`<p className="small"><b>HR:</b> ${s.n}</p>`}
      ${i.doc && status !== 'verified' && status !== 'na' && html`<${Fragment}>
        ${f && html`<ul className="files"><li><${Icon} n="file" /><div className="fn"><b>${f.n}</b><span>Uploaded ${fmtDay(f.at)}</span></div><${FileActions} base=${base} f=${f} /></li></ul>`}
        <${FilePick} busy=${busyId === i.id} progress=${prog} onFiles=${fs => upload(i, fs)} label=${f ? 'Replace with a new file.' : 'Upload this document.'} />
      <//>`}
      ${i.doc && f && status === 'verified' && html`<ul className="files"><li><${Icon} n="file" /><div className="fn"><b>${f.n}</b><span>Verified by HR</span></div><${FileActions} base=${base} f=${f} /></li></ul>`}
    </section>`; })}
  </div>`;
}
function PoliciesPage() {
  const files = useCol('org/hr/f', 'at:desc');
  const groups = {}; files.docs.forEach(f => { (groups[f.c || 'other'] = groups[f.c || 'other'] || []).push(f); });
  return html`<div className="stack">
    ${files.loading ? html`<${Spinner} />` : files.docs.length ? Object.entries(POLICY_CATS).filter(([k]) => groups[k]).map(([k, v]) => html`<section key=${k} className="panel"><h2 className="ph" style=${{ marginBottom: 10 }}>${v}</h2>
      <ul className="files">${groups[k].map(f => html`<li key=${f.id}><${Icon} n="file" /><div className="fn"><b>${f.n}</b><span>Updated ${fmtDay(f.at)}, ${sizeLabel(f.sz)}</span></div><${FileActions} base="org/hr" f=${f} /></li>`)}</ul></section>`)
      : html`<div className="panel"><${Empty} title="No policies published yet">HR publishes the employee handbook, leave policy and templates here.<//></div>`}
  </div>`;
}

/* Earnings before a pay plan exists: admins set their own right here; employees can nudge HR */
function NoPayPlan() {
  const P = usePortal(); const toast = useToast(); const [busy, setBusy] = useState(false);
  if (P.isAdmin) return html`<section className="panel stack" style=${{ gap: 14 }}>
    <div><h2 className="ph">Set up your pay plan</h2><p className="muted small" style=${{ marginTop: 4 }}>No salary or hourly rate is on file for your account yet. As ${P.roleName === 'admin' ? 'an administrator' : 'staff'} you can set it here; it saves to your own record, the same as Team › your name › Pay.</p></div>
    <${PayForm} m=${{ id: P.uid, r: P.asg, u: P.root }} />
  </section>`;
  const asked = P.root && P.root.payReq;
  const ask = async () => { setBusy(true); try { await dbMerge(`u/${P.uid}`, { payReq: Date.now() }); toast('HR has been notified.'); } catch (e) { toast(errText(e), true); } setBusy(false); };
  return html`<div className="panel"><${Empty} title="Your pay plan isn't set up yet" action=${html`<button type="button" className="btn" disabled=${busy || !!asked} onClick=${ask}>${asked ? 'HR notified ' + fmtDay(asked) : 'Ask HR to set it up'}</button>`}>StratEdge HR adds your salary or hourly rate and any allowances under Team › your name › Pay. Once that's done, this page shows your earnings for each month, computed from your clock-ins.<//></div>`;
}

/* Location sharing status on the clock card, with a one-click way to allow it */
function LocationStatus() {
  const toast = useToast(); const [st, setSt] = useState('checking'); const [pos, setPos] = useState(null); const [busy, setBusy] = useState(false);
  useEffect(() => { let live = true; locPermission().then(s => { if (live) setSt(s); }); return () => { live = false; }; }, []);
  const share = async () => { setBusy(true); const r = await getPosition(12000); setBusy(false); if (r.pos) { setPos(r.pos); setSt('granted'); try { await api('login_geo', { ...r.pos }); } catch (e) { /* no login record to attach to */ } toast(`Location shared (±${r.pos.acc} m). Clock-ins and breaks will include it.`); } else { setSt(r.err); toast(`Exact location ${POS_ERR[r.err] || 'not available'}.`, true); } };
  const ok = st === 'granted' || !!pos;
  const text = ok ? `Exact location on${pos ? ` (±${pos.acc} m)` : ''}` : st === 'insecure' ? 'Exact location needs https on this site' : st === 'denied' ? 'Location blocked in your browser' : st === 'checking' ? 'Checking location…' : 'Share your location so clock-ins record where you are';
  return html`<div className=${'locstat ' + (ok ? 'ok' : st === 'insecure' || st === 'denied' ? 'bad' : '')}>
    <${Icon} n="globe" /><span>${text}</span>
    ${!ok && st !== 'insecure' && html`<button type="button" className="btn ghost sm" disabled=${busy} onClick=${share}>${busy ? 'Locating…' : st === 'denied' ? 'Try again' : 'Share my location'}</button>`}
    ${st === 'denied' && html`<div className="muted small" style=${{ flexBasis: '100%' }}>Allow it from the lock icon next to the address bar (Site settings › Location), then try again.</div>`}
    ${st === 'insecure' && html`<div className="muted small" style=${{ flexBasis: '100%' }}>Browsers only share exact location on https pages. Ask the admin to enable SSL for the site; the network address is still recorded.</div>`}
  </div>`;
}

/* ================= Client portal: data ================= */
const ClientCtx = createContext(null);
const useClient = () => useContext(ClientCtx);
const cdChip = s => s === 'approved' ? 'ok' : s === 'returned' ? 'red' : s === 'pending' ? 'amber' : '';
function ClientData({ children }) {
  const P = usePortal(); const cid = P.cid;
  const roster = useCol(`pub/${cid}/roster`);
  const ts = useCol(`pub/${cid}/ts`);
  const live = useCol(`pub/${cid}/live`);
  const reqs = useCol(`e/${P.uid}/req`, 'at:desc');
  const val = useMemo(() => {
    const sheets = ts.docs.map(d => ({ ...d, st: cdStatus(d) })).sort((a, b) => (b.sa || 0) - (a.sa || 0));
    const pending = sheets.filter(x => x.st === 'pending').sort((a, b) => (a.sa || 0) - (b.sa || 0));
    const active = roster.docs.filter(r => r.st !== 'inactive').sort((a, b) => (a.n || '').localeCompare(b.n || ''));
    const liveById = {}; live.docs.forEach(l => { liveById[l.id] = l; });
    return { cid, roster: roster.docs, active, sheets, pending, live: live.docs, liveById, onClock: live.docs.filter(l => l.on && active.some(a => a.id === l.id)),
      reqs: reqs.docs, openReqs: reqs.docs.filter(r => !['filled', 'closed'].includes(r.st || 'open')), loading: roster.loading || ts.loading };
  }, [roster.docs, ts.docs, live.docs, reqs.docs, roster.loading, ts.loading]);
  return html`<${ClientCtx.Provider} value=${val}>${children}<//>`;
}
const company = P => P.asg.cl || (P.prof && P.prof.co) || 'your company';

/* Timesheet review (client) */
function ClientTsReview({ d, onClose }) {
  const P = usePortal(); const C = useClient(); const toast = useToast();
  const [c, setC] = useState(''); const [busy, setBusy] = useState(false);
  const live = C.sheets.find(x => x.id === d.id) || d; const st = cdStatus(live);
  const decide = async s => {
    if (s === 'returned' && !c.trim()) { toast('Add a note so the consultant knows what to fix.', true); return; }
    setBusy(true);
    try { await dbMerge(`pub/${C.cid}/ts/${d.id}`, { cd: { s, c: c.trim(), at: Date.now(), by: P.uid, v: live.u } }); toast(s === 'approved' ? 'Hours approved. StratEdge has been notified.' : 'Timesheet returned to the consultant.'); onClose(); }
    catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  const days = weekDays(live.w); const rows = live.rows || [];
  const dayT = DOW.map((_, i) => rows.reduce((a, r) => a + (r.h[i] || 0), 0));
  const foot = st === 'pending' ? html`<button type="button" className="btn danger" disabled=${busy} onClick=${() => decide('returned')}>Return with note</button><button type="button" className="btn go" disabled=${busy} onClick=${() => decide('approved')}>Approve hours</button>`
    : st === 'approved' ? html`<button type="button" className="btn ghost" disabled=${busy} onClick=${() => decide('returned')}>Undo and return</button><button type="button" className="btn ghost" onClick=${onClose}>Close</button>`
    : st === 'returned' ? html`<button type="button" className="btn go" disabled=${busy} onClick=${() => decide('approved')}>Approve after all</button><button type="button" className="btn ghost" onClick=${onClose}>Close</button>`
    : html`<button type="button" className="btn ghost" onClick=${onClose}>Close</button>`;
  return html`<${Modal} wide title=${`${live.n || 'Consultant'}: ${weekLabel(live.w)}`} onClose=${onClose} foot=${foot}>
    <div className="stack">
      <div className="actions"><${Chip} s=${cdChip(st)}>${CD_LABEL[st]}<//><span className="muted small">${live.sa ? 'Submitted ' + fmtTs(live.sa) : ''}</span></div>
      ${live.cd && st !== 'pending' && live.cd.c && html`<div className=${'note ' + (st === 'approved' ? 'ok' : 'red')}><span>${live.cd.c}</span></div>`}
      ${st === 'withdrawn' && html`<div className="note amber"><span>The consultant withdrew this timesheet to make changes. A new version will appear when they resubmit.</span></div>`}
      <div className="tblwrap"><table className="tbl">
        <thead><tr><th>Project</th><th>Task</th>${days.map((k, i) => html`<th key=${k} className="r">${DOW[i]} ${parseD(k).getDate()}</th>`)}<th className="r">Total</th></tr></thead>
        <tbody>${rows.map((r, i) => html`<tr key=${i}><td>${r.p}</td><td>${r.t}</td>${r.h.map((x, j) => html`<td key=${j} className="r num">${x ? h1(x) : ''}</td>`)}<td className="r num"><b>${h1(r.h.reduce((a, b) => a + b, 0))}</b></td></tr>`)}
          <tr><td colSpan="2"><b>Total</b></td>${dayT.map((t, i) => html`<td key=${i} className="r num"><b>${h1(t)}</b></td>`)}<td className="r num"><b>${h1(dayT.reduce((a, b) => a + b, 0))}</b></td></tr>
        </tbody></table></div>
      ${live.note && html`<div className="note info"><span><b>Note from ${firstName(live.n)}:</b> ${live.note}</span></div>`}
      ${(st === 'pending' || st === 'approved') && html`<${Field} label=${st === 'pending' ? 'Note to the consultant (required to return)' : 'Reason for returning'}><textarea value=${c} onInput=${e => setC(e.target.value)} placeholder="e.g. Thursday should be 6 hours, not 8" /><//>`}
    </div><//>`;
}

/* ================= Client: dashboard ================= */
function ClientDashboard() {
  const P = usePortal(); const C = useClient();
  const [rv, setRv] = useState(null);
  if (C.loading) return html`<${Spinner} />`;
  return html`<div className="stack">
    <div className="hello"><div><h2>${greeting()}${P.prof ? ', ' + firstName(P.prof.n) : ''}</h2><p className="muted">${company(P)}, ${new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</p></div>
      <a className="btn" href="#/portal/requirements">Post a requirement</a></div>
    <div className="kpis" style=${{ gridTemplateColumns: 'repeat(4,minmax(0,1fr))' }}>
      <a href="#/portal/consultants"><b>${C.active.length}</b><span>Consultants on assignment</span></a>
      <a href="#/portal/attendance"><b>${C.onClock.length}</b><span>On the clock now</span></a>
      <a href="#/portal/timesheets"><b>${C.pending.length}</b><span>Timesheets to approve</span></a>
      <a href="#/portal/requirements"><b>${C.openReqs.length}</b><span>Open requirements</span></a>
    </div>
    <div className="g2" style=${{ alignItems: 'start' }}>
      <section className="panel"><div className="ph-row"><h2 className="ph">Timesheets waiting for you</h2><a className="small" href="#/portal/timesheets">All timesheets</a></div>
        ${C.pending.length ? html`<ul className="list">${C.pending.slice(0, 6).map(x => html`<li key=${x.id}><div><div className="t">${x.n}</div><div className="m">${weekLabel(x.w)}, ${h1(x.t)} hours</div></div><button type="button" className="btn sm" onClick=${() => setRv(x)}>Review</button></li>`)}</ul>`
          : html`<${Empty} title="Nothing to approve">Consultants' weekly hours appear here as soon as they submit.<//>`}</section>
      <section className="panel"><div className="ph-row"><h2 className="ph">On the clock now</h2><a className="small" href="#/portal/attendance">Attendance</a></div>
        ${C.onClock.length ? html`<ul className="list">${C.onClock.map(l => html`<li key=${l.id}><div><div className="t">${l.n}</div><div className="m">Since ${fmtTime(l.i)}${l.d !== dkey() ? ', ' + fmtDate(l.d) : ''}</div></div><${Chip} s="ok">${MODES[l.m] || 'Working'}<//></li>`)}</ul>`
          : html`<${Empty} title="Nobody is clocked in right now" />`}</section>
    </div>
    ${C.reqs.length > 0 && html`<section className="panel"><div className="ph-row"><h2 className="ph">Your requirements</h2><a className="small" href="#/portal/requirements">Manage</a></div>
      <ul className="list">${C.reqs.slice(0, 4).map(r => html`<li key=${r.id}><div><div className="t">${r.ti}</div><div className="m">${Object.keys(r.cands || {}).length} candidate${Object.keys(r.cands || {}).length === 1 ? '' : 's'} shared</div></div><${Chip} s=${r.st === 'filled' ? 'ok' : r.st === 'shared' ? 'new' : r.st === 'closed' ? '' : 'amber'}>${REQ_ST[r.st || 'open']}<//></li>`)}</ul></section>`}
    ${rv && html`<${ClientTsReview} d=${rv} onClose=${() => setRv(null)} />`}
  </div>`;
}

/* ================= Client: timesheets ================= */
function ClientTimesheets() {
  const C = useClient();
  const [tab, setTab] = useState('pending'); const [rv, setRv] = useState(null);
  if (C.loading) return html`<${Spinner} />`;
  const list = C.sheets.filter(x => tab === 'all' || x.st === tab);
  const counts = { pending: C.pending.length, approved: C.sheets.filter(x => x.st === 'approved').length, returned: C.sheets.filter(x => x.st === 'returned').length };
  return html`<div className="stack">
    <div className="tabs" role="tablist">${[['pending', 'To approve'], ['approved', 'Approved'], ['returned', 'Returned'], ['all', 'All']].map(([k, v]) => html`<button type="button" key=${k} role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${v}${counts[k] != null && html`<span className=${'chip' + (k === 'pending' && counts[k] ? ' amber' : '')}>${counts[k]}</span>`}</button>`)}</div>
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${list.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Consultant</th><th>Week</th><th className="r">Hours</th><th>Status</th><th>Submitted</th><th /></tr></thead>
        <tbody>${list.map(x => html`<tr key=${x.id}><td><b style=${{ fontWeight: 600 }}>${x.n}</b></td><td className="nw">${weekLabel(x.w)}</td><td className="r num"><b>${h1(x.t)}</b></td><td><${Chip} s=${cdChip(x.st)}>${CD_LABEL[x.st]}<//></td><td className="num muted">${x.sa ? fmtTs(x.sa) : '—'}</td>
          <td className="r"><button type="button" className=${'btn sm' + (x.st === 'pending' ? '' : ' ghost')} onClick=${() => setRv(x)}>${x.st === 'pending' ? 'Review' : 'Open'}</button></td></tr>`)}</tbody></table></div>`
        : html`<${Empty} title=${tab === 'pending' ? 'No timesheets waiting' : 'Nothing here yet'}>Your consultants' weekly timesheets arrive here when they submit them. Approve them to confirm the hours before StratEdge invoices.<//>`}
    </section>
    ${rv && html`<${ClientTsReview} d=${rv} onClose=${() => setRv(null)} />`}
  </div>`;
}

/* ================= Client: consultants & attendance ================= */
function useWeekHours(C, ws) {
  const days = weekDays(ws); const months = [...new Set(days.map(mkey))];
  const [data, setData] = useState(null);
  const ids = C.active.map(r => r.id).join(',');
  useEffect(() => {
    let live = true; setData(null);
    const jobs = []; C.active.forEach(r => months.forEach(m => jobs.push({ id: r.id, m })));
    pMap(jobs, 4, j => dbGet(`pub/${C.cid}/att/${j.id}_${j.m}`).catch(() => null)).then(docs => {
      if (!live) return; const o = {};
      C.active.forEach(r => { o[r.id] = days.map(k => { const i = jobs.findIndex(j => j.id === r.id && j.m === mkey(k)); const d = docs[i]; return (d && d.days && d.days[k]) || 0; }); });
      setData(o);
    });
    return () => { live = false; };
  }, [ws, ids]);
  return { days, data };
}
function ClientConsultants() {
  const P = usePortal(); const C = useClient();
  const ws = weekStart(); const { data } = useWeekHours(C, ws);
  if (C.loading) return html`<${Spinner} />`;
  const list = C.roster.slice().sort((a, b) => (a.st === 'inactive') - (b.st === 'inactive') || (a.n || '').localeCompare(b.n || ''));
  return html`<div className="stack">
    <p className="muted small">Consultants StratEdge has placed with ${company(P)}. Hours shown are clocked in the portal this week (${weekLabel(ws)}).</p>
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${list.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Consultant</th><th>Title</th><th>Start date</th><th>Right now</th><th className="r">Hours this week</th><th>Status</th></tr></thead>
        <tbody>${list.map(r => { const l = C.liveById[r.id]; const h = data && data[r.id] ? data[r.id].reduce((a, b) => a + b, 0) : null; return html`<tr key=${r.id}>
          <td><b style=${{ fontWeight: 600 }}>${r.n}</b></td><td>${r.ti || '—'}</td><td className="num">${r.sd ? fmtDate(r.sd, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
          <td>${l && l.on ? html`<${Chip} s="ok">In since ${fmtTime(l.i)}<//>` : l && l.at ? html`<span className="muted small">Last out ${fmtTs(l.at)}</span>` : html`<span className="muted small">—</span>`}</td>
          <td className="r num">${h == null ? '…' : hm(h)}</td><td><${Chip} s=${r.st === 'inactive' ? 'inactive' : 'active'}>${r.st === 'inactive' ? 'Ended' : 'Active'}<//></td></tr>`; })}</tbody></table></div>`
        : html`<${Empty} title="No consultants assigned yet">When StratEdge links a consultant to ${company(P)}, they appear here with their hours.<//>`}
    </section>
  </div>`;
}
function ClientAttendance() {
  const C = useClient(); const toast = useToast();
  const [ws, setWs] = useState(weekStart());
  const { days, data } = useWeekHours(C, ws);
  if (C.loading) return html`<${Spinner} />`;
  const exp = async () => {
    try { await saveDownload(`attendance_${ws}.csv`, toCSV([['Consultant', ...days, 'Total hours'], ...C.active.map(r => { const h = (data && data[r.id]) || [0, 0, 0, 0, 0, 0, 0]; return [r.n, ...h.map(m => hrs(m)), hrs(h.reduce((a, b) => a + b, 0))]; })])); }
    catch (e) { if (!e || e.code !== 'declined') toast(errText(e), true); }
  };
  return html`<div className="stack">
    <div className="toolbar">
      <div className="wknav"><button type="button" className="btn ghost icon" aria-label="Previous week" onClick=${() => setWs(addDays(ws, -7))}><${Icon} n="left" /></button><b>${weekLabel(ws)}</b>
        <button className="btn ghost icon" aria-label="Next week" disabled=${ws >= weekStart()} onClick=${() => setWs(addDays(ws, 7))}><${Icon} n="right" /></button></div>
      ${ws !== weekStart() && html`<button type="button" className="btn ghost sm" onClick=${() => setWs(weekStart())}>This week</button>`}
      <div className="push"><button type="button" className="btn ghost" disabled=${!data || !C.active.length} onClick=${exp}><${Icon} n="down" />Export week</button></div>
    </div>
    ${C.onClock.length > 0 && html`<div className="note ok"><span><b>On the clock now:</b> ${C.onClock.map(l => `${l.n} (since ${fmtTime(l.i)})`).join(', ')}</span></div>`}
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${!C.active.length ? html`<${Empty} title="No consultants assigned yet" />` : !data ? html`<${Spinner} />` : html`<div className="tblwrap"><table className="tbl">
        <thead><tr><th>Consultant</th>${days.map((k, i) => html`<th key=${k} className="r">${DOW[i]} ${parseD(k).getDate()}</th>`)}<th className="r">Total</th></tr></thead>
        <tbody>${C.active.map(r => { const h = data[r.id] || []; return html`<tr key=${r.id}><td><b style=${{ fontWeight: 600 }}>${r.n}</b></td>${h.map((m, i) => html`<td key=${i} className="r num">${m ? h1(m / 60) : ''}</td>`)}<td className="r num"><b>${hm(h.reduce((a, b) => a + b, 0))}</b></td></tr>`; })}</tbody></table></div>`}
    </section>
    <p className="muted small">Hours come from consultants' clock-ins and clock-outs in the employee portal. Submitted timesheets may differ; those are under Timesheets.</p>
  </div>`;
}

/* ================= Client: requirements ================= */
function ReqForm({ onClose }) {
  const P = usePortal(); const toast = useToast();
  const [f, setF] = useState({ ti: '', n: 1, loc: '', ty: 'C2C', md: 'Onsite', sk: '', d: '', sd: '' });
  const [busy, setBusy] = useState(false);
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    if (!f.ti.trim()) { toast('Add a title for the role.', true); return; }
    setBusy(true);
    try { await dbSet(`e/${P.uid}/req/${nid()}`, { ...f, ti: f.ti.trim(), n: Math.max(1, parseInt(f.n, 10) || 1), st: 'open', at: Date.now(), by: P.uid }); toast('Requirement sent to StratEdge.'); onClose(); }
    catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  return html`<${Modal} title="Post a staffing requirement" onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Cancel</button><button type="button" className="btn" disabled=${busy} onClick=${save}>${busy ? 'Sending…' : 'Send to StratEdge'}</button>`}>
    <div className="form">
      <div className="row2"><${Field} label="Role"><input value=${f.ti} onInput=${up('ti')} placeholder="e.g. SAP PP/QM Analyst" /><//><${Field} label="How many"><input type="number" min="1" value=${f.n} onInput=${up('n')} /><//></div>
      <div className="row3"><${Field} label="Location"><input value=${f.loc} onInput=${up('loc')} placeholder="City, state" /><//>
        <${Field} label="Engagement"><select value=${f.ty} onChange=${up('ty')}>${EMP_TYPES.map(t => html`<option key=${t}>${t}</option>`)}</select><//>
        <${Field} label="Work mode"><select value=${f.md} onChange=${up('md')}>${['Onsite', 'Hybrid', 'Remote'].map(t => html`<option key=${t}>${t}</option>`)}</select><//></div>
      <div className="row2"><${Field} label="Must-have skills"><input value=${f.sk} onInput=${up('sk')} placeholder="e.g. S/4HANA, PP, QM" /><//><${Field} label="Target start"><input type="date" value=${f.sd} onInput=${up('sd')} /><//></div>
      <${Field} label="Details"><textarea value=${f.d} onInput=${up('d')} placeholder="Project, duration, interview process, anything else that helps us match the right person" /><//>
    </div><//>`;
}
function ReqDetail({ r, onClose }) {
  const P = usePortal(); const C = useClient(); const toast = useToast();
  const live = C.reqs.find(x => x.id === r.id) || r;
  const [busy, setBusy] = useState(false);
  const path = `e/${P.uid}/req/${r.id}`;
  const setCand = async (id, st) => { setBusy(true); try { await dbMerge(path, { cands: { [id]: { st, cat: Date.now() } } }); toast(CAND_ST[st] + '. StratEdge will follow up.'); } catch (e) { toast(errText(e), true); } setBusy(false); };
  const setSt = async st => { setBusy(true); try { await dbMerge(path, { st, uat: Date.now() }); toast(st === 'closed' ? 'Requirement closed.' : 'Requirement reopened.'); } catch (e) { toast(errText(e), true); } setBusy(false); };
  const cands = Object.entries(live.cands || {}).sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
  const closed = ['filled', 'closed'].includes(live.st);
  return html`<${Modal} wide title=${live.ti} onClose=${onClose} foot=${html`${closed ? html`<button type="button" className="btn ghost" disabled=${busy} onClick=${() => setSt('open')}>Reopen</button>` : html`<button type="button" className="btn ghost" disabled=${busy} onClick=${() => setSt('closed')}>Close requirement</button>`}<button type="button" className="btn" onClick=${onClose}>Done</button>`}>
    <div className="stack">
      <div className="actions"><${Chip} s=${live.st === 'filled' ? 'ok' : live.st === 'shared' ? 'new' : closed ? '' : 'amber'}>${REQ_ST[live.st || 'open']}<//><span className="muted small">Posted ${fmtDay(live.at)}</span></div>
      <dl className="kv"><dt>Need</dt><dd>${live.n || 1} ${(live.n || 1) > 1 ? 'people' : 'person'}${live.loc ? ', ' + live.loc : ''}${live.md ? ', ' + live.md : ''}${live.ty ? ', ' + live.ty : ''}${live.sd ? ', start ' + fmtDate(live.sd) : ''}</dd>
        ${live.sk && html`<dt>Skills</dt><dd>${live.sk}</dd>`}${live.d && html`<dt>Details</dt><dd style=${{ whiteSpace: 'pre-wrap' }}>${live.d}</dd>`}</dl>
      <div><h3 className="ph" style=${{ marginBottom: 8 }}>Candidates from StratEdge</h3>
        ${cands.length ? html`<div className="cands">${cands.map(([id, x]) => html`<div key=${id} className="cand">
          <div className="ph-row" style=${{ marginBottom: 0 }}><h4>${x.n}, ${x.ti}</h4><${Chip} s=${x.st === 'hired' ? 'ok' : x.st === 'rejected' ? 'red' : x.st === 'shared' ? '' : 'new'}>${CAND_ST[x.st] || x.st}<//></div>
          ${x.sum && html`<p className="muted small" style=${{ whiteSpace: 'pre-wrap' }}>${x.sum}</p>`}${x.av && html`<p className="muted small">Available ${x.av}</p>`}
          ${!closed && html`<div className="actions">${[['shortlist', 'Shortlist'], ['interview', 'Request interview'], ['hired', 'Hired'], ['rejected', 'Not a fit']].filter(([k]) => k !== x.st).map(([k, v]) => html`<button type="button" key=${k} className=${'btn sm ' + (k === 'rejected' ? 'danger' : k === 'hired' ? 'go' : 'ghost')} disabled=${busy} onClick=${() => setCand(id, k)}>${v}</button>`)}</div>`}
        </div>`)}</div>` : html`<p className="muted small">StratEdge is working on this. Candidates appear here as they're shared.</p>`}</div>
    </div><//>`;
}
function ClientRequirements() {
  const C = useClient();
  const [nw, setNw] = useState(false); const [open, setOpen] = useState(null); const [tab, setTab] = useState('open');
  if (C.loading) return html`<${Spinner} />`;
  const list = C.reqs.filter(r => tab === 'all' || (tab === 'open' ? !['filled', 'closed'].includes(r.st || 'open') : ['filled', 'closed'].includes(r.st)));
  const cur = open && C.reqs.find(r => r.id === open);
  return html`<div className="stack">
    <div className="toolbar"><div className="tabs" role="tablist" style=${{ marginBottom: 0, border: 0 }}>${[['open', 'Open'], ['done', 'Filled or closed'], ['all', 'All']].map(([k, v]) => html`<button type="button" key=${k} role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${v}</button>`)}</div>
      <div className="push"><button type="button" className="btn" onClick=${() => setNw(true)}><${Icon} n="plus" />Post a requirement</button></div></div>
    ${list.length ? html`<div className="jobs">${list.map(r => { const n = Object.keys(r.cands || {}).length; return html`<div key=${r.id} className="job" style=${{ cursor: 'pointer' }} onClick=${() => setOpen(r.id)}>
      <div><h3>${r.ti}</h3><div className="meta">${[`${r.n || 1} ${(r.n || 1) > 1 ? 'people' : 'person'}`, r.loc, r.ty, r.md, r.sk].filter(Boolean).map(t => html`<span key=${t} className="tag">${t}</span>`)}</div>
        <p className="muted small" style=${{ marginTop: 8 }}>Posted ${fmtDay(r.at)}. ${n ? `${n} candidate${n === 1 ? '' : 's'} shared.` : 'No candidates yet.'}</p></div>
      <${Chip} s=${r.st === 'filled' ? 'ok' : r.st === 'shared' ? 'new' : ['closed'].includes(r.st) ? '' : 'amber'}>${REQ_ST[r.st || 'open']}<//></div>`; })}</div>`
      : html`<div className="panel"><${Empty} title=${tab === 'open' ? 'No open requirements' : 'Nothing here yet'} action=${html`<button type="button" className="btn" onClick=${() => setNw(true)}>Post a requirement</button>`}>Tell StratEdge who you need. Your account manager reviews it and shares matching candidates here for you to shortlist or interview.<//></div>`}
    ${nw && html`<${ReqForm} onClose=${() => setNw(false)} />`}
    ${cur && html`<${ReqDetail} key=${cur.id} r=${cur} onClose=${() => setOpen(null)} />`}
  </div>`;
}

/* ================= Client: reports ================= */
function ClientReports() {
  const C = useClient(); const toast = useToast();
  const [from, setFrom] = useState(addDays(weekStart(), -21)); const [to, setTo] = useState(weekStart());
  if (C.loading) return html`<${Spinner} />`;
  const f = weekStart(from), t = weekStart(to);
  const byC = {};
  C.sheets.forEach(x => { if (x.w < f || x.w > t || x.st === 'withdrawn') return; const r = byC[x.uid] || (byC[x.uid] = { n: x.n, weeks: 0, total: 0, appr: 0, pend: 0 }); r.weeks++; r.total += x.t || 0; if (x.st === 'approved') r.appr += x.t || 0; else if (x.st === 'pending') r.pend += x.t || 0; });
  const rows = Object.values(byC).sort((a, b) => a.n.localeCompare(b.n));
  const tot = rows.reduce((a, r) => ({ total: a.total + r.total, appr: a.appr + r.appr, pend: a.pend + r.pend }), { total: 0, appr: 0, pend: 0 });
  const exp = async () => {
    try { await saveDownload(`hours_${f}_to_${addDays(t, 6)}.csv`, toCSV([['Consultant', 'Weeks', 'Submitted hours', 'Approved by you', 'Awaiting your approval'], ...rows.map(r => [r.n, r.weeks, h1(r.total), h1(r.appr), h1(r.pend)])])); }
    catch (e) { if (!e || e.code !== 'declined') toast(errText(e), true); }
  };
  return html`<div className="stack">
    <div className="toolbar">
      <${Field} label="From week of"><input type="date" value=${from} onInput=${e => e.target.value && setFrom(e.target.value)} /><//>
      <${Field} label="To week of"><input type="date" value=${to} onInput=${e => e.target.value && setTo(e.target.value)} /><//>
      <div className="push" style=${{ alignSelf: 'flex-end' }}><button type="button" className="btn" disabled=${!rows.length} onClick=${exp}><${Icon} n="down" />Export CSV</button></div>
    </div>
    <p className="muted small">Submitted timesheet hours for weeks of ${weekLabel(f)} through ${weekLabel(t)}.</p>
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${rows.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Consultant</th><th className="r">Weeks</th><th className="r">Submitted</th><th className="r">Approved by you</th><th className="r">Awaiting</th></tr></thead>
        <tbody>${rows.map(r => html`<tr key=${r.n}><td><b style=${{ fontWeight: 600 }}>${r.n}</b></td><td className="r num">${r.weeks}</td><td className="r num"><b>${h1(r.total)}</b></td><td className="r num">${h1(r.appr)}</td><td className="r num">${h1(r.pend)}</td></tr>`)}
          <tr><td><b>All consultants</b></td><td /><td className="r num"><b>${h1(tot.total)}</b></td><td className="r num"><b>${h1(tot.appr)}</b></td><td className="r num"><b>${h1(tot.pend)}</b></td></tr></tbody></table></div>`
        : html`<${Empty} title="No timesheets in this range">Widen the range, or check back after your consultants submit their weeks.<//>`}
    </section>
  </div>`;
}

/* ================= Recruiting workspace (internal recruiters) ================= */
const candName = (cands, id) => { const c = cands.find(x => x.id === id); return c ? c.n : ''; };
function CandModal({ c, onClose }) {
  const P = usePortal(); const toast = useToast(); const subs = useCol(c ? 'rec/sub/items' : null, 'd:desc');
  const me = (P.prof && P.prof.n) || (Cap.me && Cap.me.name) || '';
  const [f, setF] = useState({ n: '', e: '', ph: '', ti: '', sk: '', auth: 'H-1B', loc: '', reloc: 'Open', rate: '', avail: '', exp: '', li: '', src: '', notes: '', st: 'active', emp: '', empw: '', spon: '', mn: '', mp: '', me: '', ...(c || {}) });
  const [busy, setBusy] = useState(false); const [prog, setProg] = useState(0);
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const mine = !c || c.by === P.uid || P.isAdmin;
  const save = async () => {
    if (!f.n.trim() || !f.ti.trim()) { toast('Add the consultant\u2019s name and title.', true); return; }
    setBusy(true);
    try {
      const id = c ? c.id : nid(); const now = Date.now();
      const { id: _i, ...rest } = f;
      await (c ? dbMerge : dbSet)(`rec/cand/items/${id}`, { ...rest, n: f.n.trim(), ti: f.ti.trim(), by: c ? c.by : P.uid, byn: c ? c.byn : me, at: c ? c.at : now, u: now, un: me });
      toast(c ? 'Consultant updated.' : 'Consultant added.'); onClose();
    } catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  const onFiles = async fs => {
    if (!c) { toast('Save the consultant first, then attach the resume.', true); return; }
    setBusy(true);
    try { setProg(0.03); const r = await storeFile(`rec/cand/items/${c.id}`, fs[0], { c: 'resume' }, setProg); await dbMerge(`rec/cand/items/${c.id}`, { rid: r.id, rn: r.n, u: Date.now() }); toast('Resume attached.'); }
    catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  return html`<${Modal} wide title=${c ? c.n : 'Add a consultant'} onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Close</button>${mine && html`<button type="button" className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : c ? 'Save changes' : 'Add consultant'}</button>`}`}>
    <div className="form">
      <div className="row3"><${Field} label="Full name"><input value=${f.n} onInput=${up('n')} disabled=${!mine} /><//><${Field} label="Title / role"><input value=${f.ti} onInput=${up('ti')} placeholder="e.g. SAP PP/QM Consultant" disabled=${!mine} /><//><${Field} label="Status"><select value=${f.st} onChange=${up('st')} disabled=${!mine}>${Object.entries(CAND_STATUS).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//></div>
      <div className="row3"><${Field} label="Email"><input type="email" value=${f.e} onInput=${up('e')} disabled=${!mine} /><//><${Field} label="Phone"><input type="tel" value=${f.ph} onInput=${up('ph')} disabled=${!mine} /><//><${Field} label="LinkedIn"><input value=${f.li} onInput=${up('li')} placeholder="https://" disabled=${!mine} /><//></div>
      <${Field} label="Key skills"><input value=${f.sk} onInput=${up('sk')} placeholder="e.g. S/4HANA, PP, QM, MM" disabled=${!mine} /><//>
      <div className="row3"><${Field} label="Work authorization"><select value=${f.auth} onChange=${up('auth')} disabled=${!mine}>${AUTH_TYPES.map(a => html`<option key=${a}>${a}</option>`)}</select><//>
        <${Field} label="Experience (years)"><input type="number" min="0" step="0.5" value=${f.exp} onInput=${up('exp')} disabled=${!mine} /><//>
        <${Field} label="Expected rate"><input value=${f.rate} onInput=${up('rate')} placeholder="e.g. $75/hr C2C" disabled=${!mine} /><//></div>
      <div className="row3"><${Field} label="Current location"><input value=${f.loc} onInput=${up('loc')} placeholder="City, state" disabled=${!mine} /><//>
        <${Field} label="Relocation"><select value=${f.reloc} onChange=${up('reloc')} disabled=${!mine}>${['Open', 'Remote only', 'Local only', 'Specific states'].map(x => html`<option key=${x}>${x}</option>`)}</select><//>
        <${Field} label="Available from"><input value=${f.avail} onInput=${up('avail')} placeholder="e.g. Immediately, 2 weeks" disabled=${!mine} /><//></div>
      <div className="row2"><${Field} label="Source"><input value=${f.src} onInput=${up('src')} placeholder="e.g. Dice, LinkedIn, referral" disabled=${!mine} /><//><${Field} label="Notes"><input value=${f.notes} onInput=${up('notes')} placeholder="Interview readiness, references, anything useful" disabled=${!mine} /><//></div>
      <div className="row3"><${Field} label="Current employer / vendor"><input value=${f.emp} onInput=${up('emp')} placeholder="Company the consultant works through" disabled=${!mine} /><//><${Field} label="Employer website"><input value=${f.empw} onInput=${up('empw')} placeholder="https://" disabled=${!mine} /><//><${Field} label="Visa sponsor (if different)"><input value=${f.spon} onInput=${up('spon')} disabled=${!mine} /><//></div>
      <div className="row3"><${Field} label="Manager / reference name"><input value=${f.mn} onInput=${up('mn')} placeholder="Current or previous manager" disabled=${!mine} /><//><${Field} label="Manager phone"><input type="tel" value=${f.mp} onInput=${up('mp')} disabled=${!mine} /><//><${Field} label="Manager email"><input type="email" value=${f.me} onInput=${up('me')} disabled=${!mine} /><//></div>
      <div><span className="lbl">Resume</span>
        ${c && c.rid ? html`<ul className="files" style=${{ marginTop: 8 }}><li><${Icon} n="file" /><div className="fn"><b>${c.rn || 'Resume'}</b></div><${FileActions} base=${'rec/cand/items/' + c.id} f=${{ id: c.rid, n: c.rn || 'resume', ty: '' }} /></li></ul>` : null}
        ${c && mine && html`<div style=${{ marginTop: 8 }}><${FilePick} busy=${busy} progress=${prog} onFiles=${onFiles} label=${c.rid ? 'Replace the resume.' : 'Attach the resume.'} hint="PDF or Word (.docx), up to 10 MB." /></div>`}
        ${!c && html`<p className="muted small" style=${{ marginTop: 6 }}>Save first, then attach the resume.</p>`}</div>
      ${c && html`<p className="muted small">Added by ${c.byn || 'a recruiter'} ${fmtDay(c.at)}${c.u ? ', updated ' + fmtDay(c.u) + (c.un ? ' by ' + c.un : '') : ''}.</p>`}
      ${c && html`<div><span className="lbl">Activity for this consultant</span>
        ${subs.loading ? html`<${Spinner} />` : subs.docs.filter(s => s.cid === c.id).length ? html`<div className="tblwrap" style=${{ marginTop: 8 }}><table className="tbl"><thead><tr><th>Date</th><th>By</th><th>Requirement</th><th>Vendor / client</th><th>RTR</th><th>Status</th></tr></thead>
          <tbody>${subs.docs.filter(s => s.cid === c.id).map(s => html`<tr key=${s.id}><td className="num nw">${fmtDate(s.d)}</td><td><b style=${{ fontWeight: 600 }}>${s.byn || '—'}</b></td><td>${s.req}${s.rate ? html`<div className="muted small">${s.rate}</div>` : ''}</td><td>${s.vn}${s.ec ? html`<div className="muted small">${s.ec}</div>` : ''}${s.vw && /^https?:\/\//i.test(s.vw) ? html`<div className="small"><a href=${s.vw} target="_blank" rel="noopener noreferrer" onClick=${e => e.stopPropagation()}>Posting</a></div>` : ''}</td><td>${s.rtr ? html`<${Chip} s="ok">RTR ${fmtDate(s.rtrAt || s.d, { month: 'short', day: 'numeric' })}<//>` : html`<span className="muted small">No</span>`}</td><td><${Chip} s=${s.st === 'placed' ? 'ok' : s.st === 'rejected' || s.st === 'withdrawn' ? 'red' : s.st === 'interview' || s.st === 'offer' ? 'new' : 'amber'}>${SUB_ST[s.st] || s.st}<//></td></tr>`)}</tbody></table></div>`
          : html`<p className="muted small" style=${{ marginTop: 6 }}>No RTRs or submissions logged for this consultant yet. Anyone on the team can log one under RTRs & submissions.</p>`}</div>`}
    </div><//>`;
}
function RecConsultants() {
  const P = usePortal();
  const cands = useCol('rec/cand/items', 'u:desc'); const subs = useCol('rec/sub/items');
  const [q, setQ] = useState(''); const [mine, setMine] = useState(false); const [open, setOpen] = useState(undefined);
  const ql = q.trim().toLowerCase();
  const list = cands.docs.filter(c => (!mine || c.by === P.uid) && (!ql || [c.n, c.ti, c.sk, c.loc, c.auth, c.byn].filter(Boolean).join(' ').toLowerCase().includes(ql)));
  const cur = open && cands.docs.find(c => c.id === open);
  return html`<div className="stack">
    <div className="toolbar"><input type="search" style=${{ maxWidth: 320 }} placeholder="Search name, skills, location" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Search consultants" />
      <label className="check" style=${{ fontSize: 14 }}><input type="checkbox" checked=${mine} onChange=${e => setMine(e.target.checked)} /><span>Only mine</span></label>
      <div className="push"><button type="button" className="btn" onClick=${() => setOpen(null)}><${Icon} n="plus" />Add consultant</button></div></div>
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${cands.loading ? html`<${Spinner} />` : list.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Consultant</th><th>Skills</th><th>Authorization</th><th>Location</th><th>Rate</th><th>Status</th><th>Activity</th><th>Added by</th></tr></thead>
        <tbody>${list.map(c => { const mine = subs.docs.filter(s => s.cid === c.id); const rtr = mine.filter(s => s.rtr).length; const who = [...new Set(mine.map(s => s.byn).filter(Boolean))]; return html`<tr key=${c.id} className="click" tabIndex="0" onClick=${() => setOpen(c.id)} onKeyDown=${e => { if (e.key === 'Enter') setOpen(c.id); }}>
          <td><b style=${{ fontWeight: 600 }}>${c.n}</b><div className="muted small">${c.ti}${c.exp ? `, ${c.exp} yrs` : ''}${c.emp ? ` · ${c.emp}` : ''}</div></td><td className="small">${c.sk || '—'}</td><td>${c.auth || '—'}</td><td>${c.loc || '—'}${c.reloc && c.reloc !== 'Open' ? html`<div className="muted small">${c.reloc}</div>` : ''}</td><td>${c.rate || '—'}</td>
          <td><${Chip} s=${c.st === 'placed' ? 'ok' : c.st === 'inactive' ? '' : c.st === 'working' ? 'new' : c.st === 'hold' ? 'amber' : 'ok'}>${CAND_STATUS[c.st] || c.st}<//></td>
          <td className="small">${mine.length ? html`<b>${rtr}</b> RTR · <b>${mine.length}</b> sub${who.length ? html`<div className="muted small">by ${who.join(', ')}</div>` : ''}` : html`<span className="muted">None yet</span>`}</td><td className="small">${c.byn || ''}</td></tr>`; })}</tbody></table></div>`
        : html`<${Empty} title=${ql ? 'No matches' : 'No consultants yet'} action=${html`<button type="button" className="btn" onClick=${() => setOpen(null)}>Add the first consultant</button>`}>Keep every consultant you work with here: skills, authorization, location, rate and resume, so submissions and RTRs can be verified against one record.<//>`}
    </section>
    ${open !== undefined && (open === null || cur) && html`<${CandModal} key=${open || 'new'} c=${cur || null} onClose=${() => setOpen(undefined)} />`}
  </div>`;
}

/* ---- RTRs and submissions ---- */
function SubModal({ s, cands, onClose }) {
  const P = usePortal(); const toast = useToast();
  const me = (P.prof && P.prof.n) || (Cap.me && Cap.me.name) || '';
  const [f, setF] = useState({ d: dkey(), cid: '', cn: '', req: '', vn: '', vw: '', rn: '', rp: '', re: '', ec: '', mn: '', mp: '', mem: '', rate: '', rtr: false, rtrAt: '', st: 'submitted', intv: '', notes: '', ...(s || {}) });
  const [busy, setBusy] = useState(false);
  const up = k => e => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const mine = !s || s.by === P.uid || P.isAdmin;
  const save = async () => {
    const cn = f.cid ? candName(cands, f.cid) : f.cn.trim();
    if (!cn || !f.req.trim() || !f.vn.trim()) { toast('Add the consultant, the requirement and the vendor or client.', true); return; }
    setBusy(true);
    try {
      const id = s ? s.id : nid(); const now = Date.now(); const { id: _i, ...rest } = f;
      await (s ? dbMerge : dbSet)(`rec/sub/items/${id}`, { ...rest, cn, req: f.req.trim(), vn: f.vn.trim(), rtr: !!f.rtr, rtrAt: f.rtr ? (f.rtrAt || f.d) : '', by: s ? s.by : P.uid, byn: s ? s.byn : me, at: s ? s.at : now, u: now, un: me });
      toast(s ? 'Entry updated.' : 'Submission logged.'); onClose();
    } catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  return html`<${Modal} wide title=${s ? 'Edit submission' : 'Log a submission'} onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Close</button>${mine && html`<button type="button" className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : s ? 'Save' : 'Log it'}</button>`}`}>
    <div className="form">
      <div className="row2"><${Field} label="Date"><input type="date" value=${f.d} max=${dkey()} onInput=${up('d')} disabled=${!mine} /><//>
        <${Field} label="Consultant">${cands.length ? html`<select value=${f.cid} onChange=${up('cid')} disabled=${!mine}><option value="">Type a name below…</option>${cands.map(c => html`<option key=${c.id} value=${c.id}>${c.n}, ${c.ti}</option>`)}</select>` : html`<input value=${f.cn} onInput=${up('cn')} placeholder="Consultant name" disabled=${!mine} />`}<//></div>
      ${cands.length > 0 && !f.cid && html`<${Field} label="Consultant name (if not in the list)"><input value=${f.cn} onInput=${up('cn')} disabled=${!mine} /><//>`}
      <div className="row2"><${Field} label="Requirement / role"><input value=${f.req} onInput=${up('req')} placeholder="e.g. Network Engineer, Edison NJ" disabled=${!mine} /><//><${Field} label="Vendor or client"><input value=${f.vn} onInput=${up('vn')} placeholder="Who you submitted to" disabled=${!mine} /><//></div>
      <div className="row3"><${Field} label="End client"><input value=${f.ec} onInput=${up('ec')} disabled=${!mine} /><//><${Field} label="Rate submitted"><input value=${f.rate} onInput=${up('rate')} placeholder="e.g. $70/hr" disabled=${!mine} /><//>
        <${Field} label="Status"><select value=${f.st} onChange=${up('st')} disabled=${!mine}>${Object.entries(SUB_ST).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//></div>
      <div className="row3"><${Field} label="Vendor website"><input value=${f.vw} onInput=${up('vw')} placeholder="https://" disabled=${!mine} /><//><${Field} label="Vendor recruiter name"><input value=${f.rn} onInput=${up('rn')} disabled=${!mine} /><//><${Field} label="Recruiter phone"><input type="tel" value=${f.rp} onInput=${up('rp')} disabled=${!mine} /><//></div>
      <div className="row3"><${Field} label="Recruiter email"><input type="email" value=${f.re} onInput=${up('re')} disabled=${!mine} /><//><${Field} label="Hiring manager name"><input value=${f.mn} onInput=${up('mn')} disabled=${!mine} /><//><${Field} label="Manager phone"><input type="tel" value=${f.mp} onInput=${up('mp')} disabled=${!mine} /><//></div>
      <${Field} label="Manager email"><input type="email" value=${f.mem} onInput=${up('mem')} disabled=${!mine} /><//>
      <div className="row2"><label className="check" style=${{ alignSelf: 'end', paddingBottom: 12 }}><input type="checkbox" checked=${!!f.rtr} onChange=${up('rtr')} disabled=${!mine} /><span>RTR received from the consultant</span></label>
        ${f.rtr && html`<${Field} label="RTR date"><input type="date" value=${f.rtrAt || f.d} max=${dkey()} onInput=${up('rtrAt')} disabled=${!mine} /><//>`}</div>
      ${(f.st === 'interview' || f.intv) && html`<${Field} label="Interview date"><input type="date" value=${f.intv} onInput=${up('intv')} disabled=${!mine} /><//>`}
      <${Field} label="Notes"><input value=${f.notes} onInput=${up('notes')} placeholder="Feedback, next steps" disabled=${!mine} /><//>
    </div><//>`;
}
const inRange = (d, a, b) => d >= a && d <= b;
function recStats(subs, cands, uid, a, b) {
  const mine = x => !uid || x.by === uid;
  const s = subs.filter(x => mine(x) && inRange(x.d, a, b));
  return { subs: s.length, rtr: subs.filter(x => mine(x) && x.rtr && inRange(x.rtrAt || x.d, a, b)).length, intv: subs.filter(x => mine(x) && x.intv && inRange(x.intv, a, b)).length,
    cands: cands.filter(x => mine(x) && inRange(dkey(new Date(x.at || 0)), a, b)).length, placed: s.filter(x => x.st === 'placed').length };
}
function RecSubmissions() {
  const P = usePortal();
  const subs = useCol('rec/sub/items', 'd:desc'); const cands = useCol('rec/cand/items', 'n:asc');
  const [mine, setMine] = useState(true); const [open, setOpen] = useState(undefined); const [q, setQ] = useState('');
  const today = dkey(); const ws = weekStart(today); const mk = mkey(today);
  const t = recStats(subs.docs, cands.docs, P.uid, today, today), w = recStats(subs.docs, cands.docs, P.uid, ws, addDays(ws, 6)), m = recStats(subs.docs, cands.docs, P.uid, mk + '-01', mk + '-31');
  const ql = q.trim().toLowerCase();
  const list = subs.docs.filter(s => (!mine || s.by === P.uid) && (!ql || [s.cn, s.req, s.vn, s.ec, s.byn].filter(Boolean).join(' ').toLowerCase().includes(ql)));
  const cur = open && subs.docs.find(s => s.id === open);
  return html`<div className="stack">
    <div className="kpis" style=${{ gridTemplateColumns: 'repeat(3,minmax(0,1fr))' }}>
      <a><b>${t.rtr}<span style=${{ fontSize: 16, fontWeight: 600 }}> RTR / ${t.subs} sub</span></b><span>Today</span></a>
      <a><b>${w.rtr}<span style=${{ fontSize: 16, fontWeight: 600 }}> RTR / ${w.subs} sub</span></b><span>This week</span></a>
      <a><b>${m.rtr}<span style=${{ fontSize: 16, fontWeight: 600 }}> RTR / ${m.subs} sub</span></b><span>This month, ${m.intv} interview${m.intv === 1 ? '' : 's'}, ${m.placed} placed</span></a></div>
    <div className="toolbar"><input type="search" style=${{ maxWidth: 300 }} placeholder="Search consultant, role, vendor" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Search submissions" />
      <label className="check" style=${{ fontSize: 14 }}><input type="checkbox" checked=${mine} onChange=${e => setMine(e.target.checked)} /><span>Only mine</span></label>
      <div className="push"><button type="button" className="btn" onClick=${() => setOpen(null)}><${Icon} n="plus" />Log submission</button></div></div>
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${subs.loading ? html`<${Spinner} />` : list.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Date</th><th>Consultant</th><th>Requirement</th><th>Vendor / client</th><th>RTR</th><th>Status</th><th>Recruiter</th></tr></thead>
        <tbody>${list.map(s => html`<tr key=${s.id} className="click" tabIndex="0" onClick=${() => setOpen(s.id)} onKeyDown=${e => { if (e.key === 'Enter') setOpen(s.id); }}>
          <td className="num nw">${fmtDate(s.d)}</td><td><b style=${{ fontWeight: 600 }}>${s.cn}</b></td><td>${s.req}${s.rate ? html`<div className="muted small">${s.rate}</div>` : ''}</td><td>${s.vn}${s.ec ? html`<div className="muted small">${s.ec}</div>` : ''}${s.rn || s.rp ? html`<div className="muted small">${[s.rn, s.rp].filter(Boolean).join(' · ')}</div>` : ''}${s.vw && /^https?:\/\//i.test(s.vw) ? html`<div className="small"><a href=${s.vw} target="_blank" rel="noopener noreferrer" onClick=${e => e.stopPropagation()}>Posting</a></div>` : ''}</td>
          <td>${s.rtr ? html`<${Chip} s="ok">RTR ${fmtDate(s.rtrAt || s.d, { month: 'short', day: 'numeric' })}<//>` : html`<span className="muted small">No</span>`}</td>
          <td><${Chip} s=${s.st === 'placed' ? 'ok' : s.st === 'rejected' || s.st === 'withdrawn' ? 'red' : s.st === 'interview' || s.st === 'offer' ? 'new' : 'amber'}>${SUB_ST[s.st] || s.st}<//>${s.intv ? html`<div className="muted small">Interview ${fmtDate(s.intv)}</div>` : ''}</td><td className="small">${s.byn || ''}</td></tr>`)}</tbody></table></div>`
        : html`<${Empty} title="No submissions logged" action=${html`<button type="button" className="btn" onClick=${() => setOpen(null)}>Log the first submission</button>`}>Log each submission with its requirement, vendor and whether the RTR was received. Counts roll up here and into your daily report.<//>`}
    </section>
    ${open !== undefined && (open === null || cur) && html`<${SubModal} key=${open || 'new'} s=${cur || null} cands=${cands.docs} onClose=${() => setOpen(undefined)} />`}
  </div>`;
}

/* ---- End-of-day report ---- */
function eodText(name, d, st, items, note) {
  const lines = [`End-of-day report: ${name}, ${fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`, '',
    `Consultants added: ${st.cands}`, `RTRs received: ${st.rtr}`, `Submissions: ${st.subs}`, `Interviews scheduled: ${st.intv}`, ''];
  if (items.length) { lines.push('Submissions today:'); items.forEach(s => lines.push(`- ${s.cn}: ${s.req} to ${s.vn}${s.ec ? ' (' + s.ec + ')' : ''}${s.rate ? ', ' + s.rate : ''}${s.rtr ? ', RTR received' : ''}, ${SUB_ST[s.st] || s.st}`)); lines.push(''); }
  if (note) lines.push('Highlights and blockers:', note);
  return lines.join('\n');
}
function RecEOD() {
  const P = usePortal(); const toast = useToast();
  const subs = useCol('rec/sub/items', 'd:desc'); const cands = useCol('rec/cand/items', 'n:asc');
  const mine = useCol('rec/eod/items', 'd:desc', 60);
  const [d, setD] = useState(dkey()); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const st = recStats(subs.docs, cands.docs, P.uid, d, d);
  const items = subs.docs.filter(s => s.by === P.uid && s.d === d);
  const reports = mine.docs.filter(r => r.uid === P.uid);
  const existing = reports.find(r => r.d === d);
  const send = async () => {
    setBusy(true);
    try {
      const text = eodText(P.prof.n, d, st, items, note.trim());
      await dbSet(`rec/eod/items/${P.uid}_${d}`, { uid: P.uid, n: P.prof.n, d, cands: st.cands, rtr: st.rtr, subs: st.subs, intv: st.intv, note: note.trim(), text, at: Date.now() });
      let mailed = false; try { const r = await api('eod_notify', { date: d, text }); mailed = !!r.mailed; } catch (e) { /* in-app copy is already saved */ }
      toast(mailed ? 'Report shared with HR and admin, and emailed.' : 'Report shared with HR and admin.'); setNote('');
    } catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  if (!P.prof) return html`<${NeedProfile} />`;
  return html`<div className="g2" style=${{ alignItems: 'start' }}>
    <section className="panel stack">
      <div className="ph-row" style=${{ marginBottom: 0 }}><h2 className="ph">Today\u2019s report</h2><input type="date" value=${d} max=${dkey()} onInput=${e => e.target.value && setD(e.target.value)} style=${{ width: 170 }} aria-label="Report date" /></div>
      <div className="kpis" style=${{ gridTemplateColumns: 'repeat(4,minmax(0,1fr))' }}>
        <a href="#/portal/rec/consultants"><b>${st.cands}</b><span>Consultants added</span></a><a href="#/portal/rec/submissions"><b>${st.rtr}</b><span>RTRs received</span></a><a href="#/portal/rec/submissions"><b>${st.subs}</b><span>Submissions</span></a><a href="#/portal/rec/submissions"><b>${st.intv}</b><span>Interviews</span></a></div>
      ${items.length ? html`<ul className="list">${items.map(s => html`<li key=${s.id}><div><div className="t">${s.cn}: ${s.req}</div><div className="m">${s.vn}${s.ec ? ', ' + s.ec : ''}${s.rate ? ', ' + s.rate : ''}</div></div><div className="actions">${s.rtr && html`<${Chip} s="ok">RTR<//>`}<${Chip} s=${s.st === 'placed' ? 'ok' : 'amber'}>${SUB_ST[s.st]}<//></div></li>`)}</ul>`
        : html`<p className="muted small">No submissions logged for this day yet. Log them under RTRs & submissions and they appear here automatically.</p>`}
      <${Field} label="Highlights and blockers"><textarea value=${note} onInput=${e => setNote(e.target.value)} placeholder="Interviews lined up, vendors to chase tomorrow, anything HR should know" /><//>
      ${existing && html`<div className="note info"><span>You already sent a report for this day at ${fmtTime(existing.at)}. Sending again replaces it.</span></div>`}
      <div className="actions"><button type="button" className="btn lg go" disabled=${busy} onClick=${send}><${Icon} n="send" />${busy ? 'Sending…' : existing ? 'Send again' : 'Send to HR and admin'}</button><span className="muted small">One click: saved to the HR and admin portals${P.settings.eodMail ? ' and emailed' : ''}.</span></div>
    </section>
    <section className="panel"><h2 className="ph" style=${{ marginBottom: 8 }}>Your recent reports</h2>
      ${reports.length ? html`<ul className="list">${reports.slice(0, 20).map(r => html`<li key=${r.id}><div><div className="t">${fmtDate(r.d, { weekday: 'short', month: 'short', day: 'numeric' })}</div><div className="m">${r.rtr} RTR, ${r.subs} submissions, ${r.cands} consultants added${r.intv ? `, ${r.intv} interviews` : ''}${r.note ? '. ' + r.note.slice(0, 80) : ''}</div></div><span className="muted small num">${fmtTime(r.at)}</span></li>`)}</ul>`
        : html`<${Empty} title="No reports sent yet">Your daily reports are listed here after you send them.<//>`}
    </section>
  </div>`;
}

/* ================= Jobs: resume matching for consultants, job sources and collections for staff =================
   Job matching runs inside the PHP backend (api/jobs.php). Nothing here talks to an outside service directly. */
const MATCH_STATES = { new: 'New', saved: 'Saved', applied: 'Applied', dismissed: 'Dismissed' };
const REMOTE_OPTS = [['any', 'Anywhere (remote, hybrid or on-site)'], ['remote', 'Remote only'], ['hybrid', 'Hybrid or remote'], ['onsite', 'On-site near me']];
const JOB_TYPES = ['Contract', 'C2C', 'W2', '1099', 'Contract-to-hire', 'Full-time', 'Part-time'];
const RUN_STATUS = { done: 'Done', running: 'Running', queued: 'Queued', done_with_errors: 'Done with errors', failed: 'Failed', cancelled: 'Stopped' };
const RUN_KINDS = { all: 'Scheduled collection', grab: 'Job grab', person: 'One consultant' };
const listStr = v => Array.isArray(v) ? v.join(', ') : (v || '');
const runLive = r => !!r && (r.status === 'running' || r.status === 'queued');

function useJobsApi(route, deps) {
  const [st, setSt] = useState({ data: null, loading: true, error: null });
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true; setSt(s => ({ ...s, loading: true }));
    api(route).then(d => live && setSt({ data: d, loading: false, error: null })).catch(e => live && setSt({ data: null, loading: false, error: e }));
    return () => { live = false; };
  }, [route, n, ...(deps || [])]);
  return { ...st, reload: () => setN(x => x + 1) };
}

const JobsOffline = ({ error }) => html`<div className="note red"><span><b>Job matching hit a problem.</b> ${error ? error.message : ''} Your other pages work as usual.</span></div>`;

/* Keeps a collection moving while someone has it on screen: each tick does a few seconds of work on the server. */
function useRunTicker(run, onRun) {
  const id = run && run.id; const live = runLive(run);
  useEffect(() => {
    if (!id || !live) return;
    let on = true;
    (async () => {
      while (on) {
        let r = null;
        try { r = await api('jobs_tick', { id }); } catch (e) { await sleep(3000); continue; }
        if (!on) return;
        onRun(r.run);
        if (!runLive(r.run)) return;
        await sleep(1000);
      }
    })();
    return () => { on = false; };
  }, [id, live]);
}
function RunBanner({ run, setRun, admin, onDone }) {
  useRunTicker(run, r => { setRun(r); if (r && !runLive(r) && onDone) onDone(r); });
  if (!run) return null;
  const p = run.progress || { done: 0, total: 0 }; const pct = p.total ? Math.round(100 * p.done / p.total) : 0;
  if (!runLive(run)) return html`<div className=${'note ' + (run.status === 'done' ? 'ok' : run.status === 'done_with_errors' ? 'amber' : 'red')}><span><b>${RUN_STATUS[run.status] || run.status}.</b> ${run.jobs_found} job${run.jobs_found === 1 ? '' : 's'} found, ${run.jobs_new} new${run.errors && run.errors.length ? html`; ${run.errors.length} source${run.errors.length === 1 ? '' : 's'} had a problem (see Collection runs)` : ''}.</span></div>`;
  return html`<div className="note info"><span style=${{ minWidth: 0, flex: 1 }}><b>${run.status === 'queued' ? 'Waiting for the current collection to finish…' : 'Collecting jobs…'}</b> step ${p.done} of ${p.total}${run.jobs_found ? `, ${run.jobs_found} jobs found (${run.jobs_new} new)` : ''}. Keep this page open; it finishes on its own.
    <i className="prog"><b style=${{ width: pct + '%' }} /></i>${admin && run.log ? html`<pre className="small runlog">${run.log}</pre>` : ''}</span>
    ${admin && html`<div className="actions"><button className="btn ghost sm" type="button" onClick=${async () => { try { const r = await api('jobs_admin', { op: 'stop', id: run.id }); setRun(r.run); } catch (e) { /* shown by the next tick */ } }}>Stop</button></div>`}</div>`;
}

const ScoreMeter = ({ n }) => html`<span className="score" title=${'Match score ' + n + ' of 100'}><i style=${{ '--w': Math.max(4, n) + '%' }} /><b>${n}</b></span>`;

/* Props: onState(j, state) marks a match; onPublish(j, on) for staff; onApply(j[, resume]) for consultants (with `resumes`: exactly one resume
   makes "Apply now" the anchor itself, so the job board opens and the application is logged in one click); onSubmit(j) for staff/bench. */
function JobRow({ j, onState, onPublish, onApply, onSubmit, resumes, busy }) {
  const [open, setOpen] = useState(false);
  const one = onApply && resumes && resumes.length === 1 ? resumes[0] : null;
  const chips = [j.portal, j.remote, j.job_type, j.salary].filter(Boolean);
  const also = (j.also || []).filter(a => a.portal && a.portal !== j.portal).slice(0, 4);
  return html`<div className="match">
    <div style=${{ minWidth: 0 }}>
      <h3><a href=${j.url} target="_blank" rel="noopener noreferrer">${j.title}</a></h3>
      <div className="muted">${[j.company, j.location].filter(Boolean).join(' · ')}${j.posted ? html` <span className="small">· ${j.posted}</span>` : ''}</div>
      <div className="meta">${chips.map(c => html`<${Chip} key=${c}>${c}<//>`)}${j.state && j.state !== 'new' ? html`<${Chip} s=${j.state === 'applied' ? 'ok' : j.state === 'saved' ? 'new' : 'inactive'}>${MATCH_STATES[j.state]}<//>` : ''}${j.source_name && j.source_name !== j.portal ? html`<span className="muted small">via ${j.source_name}</span>` : ''}</div>
      ${also.length ? html`<div className="small muted" style=${{ marginTop: 6 }}>Also on ${also.map((a, i) => html`<${Fragment} key=${a.url}>${i ? ', ' : ''}<a href=${a.url} target="_blank" rel="noopener noreferrer">${a.portal}</a><//>`)}</div>` : ''}
      ${j.reasons && j.reasons.length ? html`<div className="reasons">${j.reasons.join(' · ')}</div>` : ''}
      ${open && html`<div className="prose small" style=${{ marginTop: 10, whiteSpace: 'pre-wrap', maxHeight: 360, overflow: 'auto' }}><${JobDescription} id=${j.id} summary=${j.summary} /></div>`}
    </div>
    <div className="stack" style=${{ gap: 8, alignItems: 'flex-end' }}>
      ${typeof j.score === 'number' && html`<${ScoreMeter} n=${j.score} />`}
      <div className="actions" style=${{ justifyContent: 'flex-end' }}>
        <button className="btn ghost sm" type="button" onClick=${() => setOpen(o => !o)}>${open ? 'Hide' : 'Details'}</button>
        <a className="btn ghost sm" href=${j.url} target="_blank" rel="noopener noreferrer">Open on ${j.portal || 'the job board'}</a>
        ${onPublish && (j.published ? html`<a className="btn ghost sm" href=${'#/careers/g' + j.id} target="_blank" rel="noopener"><${Icon} n="check" />On Careers</a><${SendJobButton} jobId=${'g' + j.id} small=${true} /><button className="btn ghost sm" type="button" disabled=${busy} onClick=${() => onPublish(j, false)}>Remove</button>` : html`<button className="btn sm" type="button" disabled=${busy} onClick=${() => onPublish(j, true)}><${Icon} n="mega" />Publish to Careers</button>`)}
        ${onSubmit && html`<button className="btn sm" type="button" disabled=${busy} onClick=${() => onSubmit(j)}><${Icon} n="send" />Submit consultant</button>`}
        ${onApply && j.state !== 'applied' && (one ? html`<a className="btn sm go" href=${j.url} target="_blank" rel="noopener noreferrer" title=${'Opens the posting and sends your resume ' + (one.label || one.name)} onClick=${() => { onApply(j, one); }}><${Icon} n="send" />Apply now</a>`
          : html`<button className="btn sm go" type="button" disabled=${busy} onClick=${() => onApply(j)}><${Icon} n="send" />Apply now</button>`)}
        ${onState && html`<${Fragment}>
          ${j.state !== 'saved' && j.state !== 'applied' && html`<button className="btn sm" type="button" disabled=${busy} onClick=${() => onState(j, 'saved')}><${Icon} n="star" />Save</button>`}
          ${j.state !== 'applied' && html`<button className="btn ghost sm" type="button" disabled=${busy} onClick=${() => onState(j, 'applied')}><${Icon} n="check" />${onApply ? 'Mark applied' : 'Applied'}</button>`}
          ${j.state !== 'dismissed' ? html`<button className="btn ghost sm icon" type="button" aria-label="Dismiss" title="Not interested" disabled=${busy} onClick=${() => onState(j, 'dismissed')}><${Icon} n="x" /></button>`
            : html`<button className="btn ghost sm" type="button" disabled=${busy} onClick=${() => onState(j, 'new')}>Restore</button>`}
        <//>`}
      </div>
    </div>
  </div>`;
}

function JobDescription({ id, summary }) {
  const r = useJobsApi('jobs_job&id=' + id);
  if (r.loading) return html`<${Spinner} label="Loading the job post…" />`;
  const d = r.data && r.data.job && r.data.job.description;
  return d ? d : (summary || 'No description was captured for this job. Open it on the job board for the full post.');
}

/* ---------- consultant: matched jobs ---------- */
function JobsPage() {
  const P = usePortal(); const toast = useToast();
  const [tab, setTab] = useState('new');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState(null);
  const [applying, setApplying] = useState(null);
  const sentToMe = useCol(P.prof ? `u/${P.uid}/jobs` : null, 'at:desc');
  const me = useJobsApi('jobs_me');
  const m = useJobsApi('jobs_matches&state=' + tab);
  useEffect(() => { if (me.data) setRun(me.data.run || null); }, [me.data]);
  if (!P.prof) return html`<${NeedProfile} />`;
  const sentPanel = html`<${SentToMe} docs=${sentToMe.docs} loading=${sentToMe.loading} />`;
  if (tab === 'sent') return html`<div className="stack"><${JobsTabs} tab=${tab} setTab=${setTab} counts=${{ ...((me.data && me.data.consultant && me.data.consultant.match_counts) || {}), sent: sentToMe.docs.length }} />${sentPanel}</div>`;
  if (me.error) return html`<div className="stack"><${JobsOffline} error=${me.error} />${sentToMe.docs.length ? html`<${JobsTabs} tab="sent" setTab=${setTab} counts=${{ sent: sentToMe.docs.length }} />${sentPanel}` : ''}</div>`;
  if (!me.data) return html`<${Spinner} label="Checking your matches…" />`;
  const c = me.data.consultant;
  const banner = html`<${RunBanner} run=${run} setRun=${setRun} onDone=${() => { m.reload(); me.reload(); }} />`;
  if (!c || (!c.has_resume && !((c.prefs || {}).titles || []).length)) return html`<div className="stack">${sentToMe.docs.length ? html`<${JobsTabs} tab="sent" setTab=${setTab} counts=${{ sent: sentToMe.docs.length }} />${sentPanel}` : ''}<div className="panel"><${Empty} title="Upload your resume to see matched jobs" action=${html`<a className="btn" href="#/portal/resume">Upload resume</a>`}>
    Jobs are collected from job boards every few hours and ranked against the skills, titles and location in your resume. You can also just type the titles you want under Resume & preferences.<//></div></div>`;
  const setState = async (j, state) => {
    setBusy(true);
    try { await api('jobs_mark', { job_id: j.id, state }); toast(state === 'saved' ? 'Saved. Find it under Saved.' : state === 'applied' ? 'Marked as applied.' : state === 'dismissed' ? 'Dismissed.' : 'Restored.'); m.reload(); me.reload(); }
    catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  const resumes = c.resumes || [];
  /* One-click apply: the anchor that calls this opens the job board itself, so the request is fired without awaiting (Chrome blocks window.open after an await). */
  const fireApply = (j, resumeId, note) => {
    api('jobs_apply', { job_id: j.id, resume_id: resumeId, note: note || '' })
      .then(r => { toast(`Applied to ${j.title}. Logged under Applications${r.mailed ? ' and your resume was emailed to the contact in the posting' : ''}.`); m.reload(); me.reload(); })
      .catch(e => toast(errText(e), true));
  };
  const onApply = (j, one) => { if (one) fireApply(j, one.id, applyNote((c.prefs || {}).apply_note, j, c, P.prof)); else setApplying(j); };
  const refresh = async () => { setBusy(true); try { const r = await api('jobs_rematch', {}); toast(`Matches refreshed: ${r.matches} job${r.matches === 1 ? '' : 's'} fit your resume and preferences.`); m.reload(); me.reload(); } catch (e) { toast(errText(e), true); } setBusy(false); };
  const counts = c.match_counts || {};
  const ql = q.trim().toLowerCase();
  const list = ((m.data && m.data.matches) || []).filter(j => !ql || [j.title, j.company, j.location, j.summary].filter(Boolean).join(' ').toLowerCase().includes(ql));
  const last = c.last_run;
  return html`<div className="stack">
    <div className="kpis" style=${{ gridTemplateColumns: 'repeat(4,minmax(0,1fr))' }}>
      <a href="#/portal/jobs" onClick=${e => { e.preventDefault(); setTab('new'); }}><b>${counts.new || 0}</b><span>New matches</span></a>
      <a href="#/portal/jobs" onClick=${e => { e.preventDefault(); setTab('saved'); }}><b>${counts.saved || 0}</b><span>Saved</span></a>
      <a href="#/portal/jobs" onClick=${e => { e.preventDefault(); setTab('applied'); }}><b>${counts.applied || 0}</b><span>Applied</span></a>
      <a href="#/portal/jobs" onClick=${e => { e.preventDefault(); setTab('sent'); }}><b>${sentToMe.docs.length}</b><span>Sent to you by StratEdge</span></a>
    </div>
    ${banner}
    <div className="note info"><span>Matched ${c.has_resume ? html`from your resume <b>${c.resume_name}</b>` : 'from your preferences'}${c.profile && c.profile.titles && c.profile.titles.length ? ` as ${c.profile.titles.slice(0, 2).join(' / ')}` : ''}${c.profile && c.profile.location ? ` near ${c.profile.location}` : ''}. ${last ? `Last job collection ${fmtTs(last.finished_at || last.started_at)}${last.jobs_new ? `, ${last.jobs_new} new jobs` : ''}.` : 'The first job collection has not run yet.'}</span>
      <div className="actions"><a className="btn ghost sm" href="#/portal/resume">Edit resume & preferences</a><button className="btn ghost sm" type="button" disabled=${busy} onClick=${refresh}><${Icon} n="refresh" />Refresh matches</button></div></div>
    <${JobsTabs} tab=${tab} setTab=${setTab} counts=${{ ...counts, sent: sentToMe.docs.length }} />
    <div className="toolbar"><input style=${{ maxWidth: 360 }} type="search" placeholder="Filter by title, company or location" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Filter jobs" /></div>
    ${m.error ? html`<${JobsOffline} error=${m.error} />` : m.loading ? html`<${Spinner} />` : list.length ? html`<div className="matches">${list.map(j => html`<${JobRow} key=${j.id} j=${j} onState=${setState} onApply=${onApply} resumes=${resumes} busy=${busy} />`)}</div>`
      : html`<div className="panel"><${Empty} title=${tab === 'new' ? (ql ? 'No matches for that filter' : 'No new matches yet') : `Nothing under ${MATCH_STATES[tab]}`}>${tab === 'new' && !ql ? (runLive(run) ? 'A collection is running right now; matches appear when it finishes.' : 'Jobs are collected every few hours. Add more titles or locations under Resume & preferences to widen the search.') : ''}<//></div>`}
    ${applying && html`<${JobApplyModal} j=${applying} c=${c} onClose=${() => setApplying(null)} onApply=${(resumeId, note) => { fireApply(applying, resumeId, note); setTimeout(() => setApplying(null), 50); }} />`}
  </div>`;
}

/* ---------- one-click apply (consultant side) ---------- */
const APP_STATES = { applied: 'Applied', interview: 'Interview', offer: 'Offer', placed: 'Placed', rejected: 'Rejected', withdrawn: 'Withdrawn' };
const APPLY_TPL = 'Hello,\n\nPlease consider {name} for the {job} role{company}. {name} is a {title} with {years} of experience in {skills}, based in {location}, available for {types}.\n\nThe resume is attached. Reply to this email to schedule a call.\n\n{signature}';
const APPLY_VARS = '{name} {title} {job} {company} {years} {skills} {location} {phone} {email}';
/* Renders the cover note for a job client side (the server renders the same template when no note is sent). c = jobPersonOut, prof = the u/{uid}.p profile. */
function applyNote(tpl, j, c, prof) {
  const p = (c && c.profile) || {}; const pr = (c && c.prefs) || {}; prof = prof || {};
  const own = !!(tpl && tpl.trim()); tpl = own ? tpl : APPLY_TPL;
  const name = prof.n || (c && c.name) || 'the consultant';
  const vars = { name, job: j.title || 'this', company: j.company ? (own ? j.company : ' at ' + j.company) : '',
    title: (pr.titles && pr.titles[0]) || (p.titles && p.titles[0]) || prof.ti || 'consultant',
    years: p.years ? p.years + ' years' : 'several years', skills: (p.skills || []).slice(0, 6).join(', ') || (pr.skills || []).slice(0, 6).join(', ') || 'the required skills',
    location: (pr.locations && pr.locations[0]) || p.location || prof.loc || 'the United States', phone: prof.ph || '', email: prof.e || (c && c.email) || '',
    types: (pr.job_types || []).join(', ') || 'contract or full-time roles' };
  vars.signature = [name, vars.phone, vars.email].filter(Boolean).join('\n');
  return tpl.replace(/\{(\w+)\}/g, (m, k) => Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : m);
}
function JobApplyModal({ j, c, onClose, onApply }) {
  const P = usePortal();
  const resumes = (c && c.resumes) || []; const prefs = (c && c.prefs) || {};
  const primary = resumes.find(r => r.primary) || resumes[0];
  const [rid, setRid] = useState(primary ? primary.id : 0);
  const [note, setNote] = useState(() => applyNote(prefs.apply_note, j, c, P.prof));
  const mails = j.contact_email && prefs.apply_email !== false;
  const foot = html`<button className="btn ghost" type="button" onClick=${onClose}>Cancel</button>
    ${resumes.length ? html`<a className="btn go" href=${j.url} target="_blank" rel="noopener noreferrer" onClick=${() => { onApply(+rid, note); }}><${Icon} n="send" />Apply with this resume</a>` : html`<a className="btn go" href="#/portal/resume" onClick=${onClose}>Upload a resume first</a>`}`;
  return html`<${Modal} title=${'Apply: ' + j.title} onClose=${onClose} foot=${foot}>
    <div className="form">
      <p className="muted small" style=${{ margin: 0 }}><b>${j.title}</b>${[j.company, j.location].filter(Boolean).length ? ' · ' + [j.company, j.location].filter(Boolean).join(' · ') : ''}${j.portal ? ' · ' + j.portal : ''}</p>
      <${Field} label="Resume to send" hint=${resumes.length ? 'The resume marked for matching is preselected.' : ''}>${resumes.length ? html`<select value=${rid} onChange=${e => setRid(e.target.value)}>${resumes.map(r => html`<option key=${r.id} value=${r.id}>${(r.label || r.name) + (r.primary ? ' (used for matching)' : '')}</option>`)}</select>`
        : html`<span className="muted small">You have no resume in the portal yet. <a href="#/portal/resume" onClick=${onClose}>Upload one first</a>.</span>`}<//>
      <${Field} label="Cover note" hint="Sent as the email body when the posting lists a contact address, and kept with the application."><textarea rows="8" value=${note} onInput=${e => setNote(e.target.value)} /><//>
      <div className="note info"><span>Opens the posting on ${j.portal || 'the job board'} in a new tab, logs the application under Applications${mails ? ', and emails your resume to the contact address in the posting' : ''}.</span></div>
    </div><//>`;
}
function ApplicationsPage() {
  const P = usePortal(); const toast = useToast();
  const r = useJobsApi('jobs_apps');
  const [busy, setBusy] = useState(0);
  if (!P.prof) return html`<${NeedProfile} />`;
  if (r.error) return html`<${JobsOffline} error=${r.error} />`;
  if (!r.data) return html`<${Spinner} label="Loading your applications…" />`;
  const apps = r.data.apps || []; const counts = r.data.counts || {};
  const setStatus = async (a, status) => { setBusy(a.id); try { await api('jobs_app_set', { id: a.id, status }); toast(`Marked as ${APP_STATES[status] || status}.`); r.reload(); } catch (e) { toast(errText(e), true); } setBusy(0); };
  return html`<div className="stack">
    <div className="kpis" style=${{ gridTemplateColumns: 'repeat(3,minmax(0,1fr))' }}>
      <a><b>${counts.applied || 0}</b><span>Applied</span></a>
      <a><b>${counts.interview || 0}</b><span>Interviews</span></a>
      <a><b>${counts.offer || 0}</b><span>Offers</span></a>
    </div>
    ${apps.length ? html`<section className="panel"><ul className="list">${apps.map(a => html`<li key=${a.id}><div style=${{ minWidth: 0 }}>
        <div className="t">${a.url ? html`<a href=${a.url} target="_blank" rel="noopener noreferrer">${a.title}</a>` : a.title}</div>
        <div className="m">${[a.company, a.location, a.portal].filter(Boolean).join(' · ')}</div>
        <div className="muted small" style=${{ marginTop: 4 }}>${a.resume_name ? html`Resume <b>${a.resume_name}</b> · ` : ''}${fmtTs(a.at)}${a.kind === 'bench' ? html` · Submitted by ${a.by_name || 'StratEdge'}` : ''}</div>
        ${a.mailed ? html`<div className="meta"><${Chip} s="ok">Emailed to the posting contact<//></div>` : ''}
      </div>
      <div className="actions" style=${{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}><select aria-label="Status" value=${a.status} disabled=${busy === a.id} onChange=${e => setStatus(a, e.target.value)} style=${{ minWidth: 130 }}>${Object.entries(APP_STATES).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select></div></li>`)}</ul></section>`
      : html`<div className="panel"><${Empty} title="No applications yet" action=${html`<a className="btn" href="#/portal/jobs">See matched jobs</a>`}>Use "Apply now" on a matched job: it opens the posting, logs the application here and, when the posting lists a contact address, emails your resume.<//></div>`}
  </div>`;
}

function JobsCard() {
  const r = useJobsApi('jobs_matches&state=new');
  const a = useJobsApi('jobs_apps');
  if (r.error || r.loading) return null;
  const list = ((r.data && r.data.matches) || []).slice(0, 3);
  const nApps = (a.data && a.data.apps) ? a.data.apps.length : 0;
  return html`<section className="panel"><div className="ph-row"><h2 className="ph">Matched jobs</h2><div className="actions" style=${{ flexWrap: 'nowrap' }}><a className="small" href="#/portal/applications">${nApps} application${nApps === 1 ? '' : 's'}</a><a className="btn ghost sm" href="#/portal/jobs">${(r.data && r.data.counts && r.data.counts.new) || 0} new</a></div></div>
    ${list.length ? html`<ul className="list">${list.map(j => html`<li key=${j.id}><div style=${{ minWidth: 0 }}><div className="t"><a href=${j.url} target="_blank" rel="noopener noreferrer">${j.title}</a></div><div className="m">${[j.company, j.location, j.portal].filter(Boolean).join(' · ')}</div></div><${ScoreMeter} n=${j.score} /></li>`)}</ul>`
      : html`<p className="muted small">No new matches yet. <a href="#/portal/resume">Upload or update your resume</a> to get jobs matched from the job boards StratEdge collects from.</p>`}</section>`;
}

/* ---------- consultant: resume and preferences ---------- */
let pdfjsLoad = null;
function loadPdfJs() { // PDF.js is self-hosted under js/vendor/pdfjs and only loaded when a PDF resume is chosen
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (!pdfjsLoad) pdfjsLoad = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'js/vendor/pdfjs/pdf.min.js'; s.onload = () => { try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/vendor/pdfjs/pdf.worker.min.js'; res(window.pdfjsLib); } catch (e) { rej(e); } }; s.onerror = () => { pdfjsLoad = null; rej(new Error('PDF reader did not load')); }; document.head.appendChild(s); });
  return pdfjsLoad;
}
async function pdfTextOf(file) {
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false }).promise;
  let out = '';
  try {
    for (let i = 1; i <= Math.min(doc.numPages, 15); i++) {
      const page = await doc.getPage(i); const tc = await page.getTextContent();
      let line = '', lastY = null, lastX = null;
      for (const it of tc.items) {
        if (typeof it.str !== 'string') continue;
        const x = it.transform[4], y = it.transform[5];
        if (lastY !== null && Math.abs(y - lastY) > 2.5) { out += line.trimEnd() + '\n'; line = ''; }
        else if (lastX !== null && x - lastX > 1.5 && line && !line.endsWith(' ') && !it.str.startsWith(' ')) line += ' ';
        line += it.str; lastY = y; lastX = x + (it.width || 0);
        if (it.hasEOL) { out += line.trimEnd() + '\n'; line = ''; lastY = null; lastX = null; }
      }
      out += line.trimEnd() + '\n\n';
    }
  } finally { try { doc.destroy(); } catch (e) { /* ignore */ } }
  return out;
}
function ResumePage() {
  const P = usePortal(); const toast = useToast();
  const me = useJobsApi('jobs_me');
  const [busy, setBusy] = useState(false); const [prog, setProg] = useState(0);
  const [f, setF] = useState(null); const [run, setRun] = useState(null);
  const [label, setLabel] = useState(''); const [asPrimary, setAsPrimary] = useState(null);
  const [renaming, setRenaming] = useState(null); const [newLabel, setNewLabel] = useState('');
  const addedRef = useRef(0); // uploads in this session, so a second quick upload is not treated as the first one while the list refreshes
  const c = me.data && me.data.consultant;
  const resumes = (c && c.resumes) || [];
  useEffect(() => { if (c && !f) { const p = c.prefs || {}; setF({ titles: listStr(p.titles), locations: listStr(p.locations), remote: p.remote || 'any', job_types: p.job_types || [], skills: listStr(p.skills), keywords: listStr(p.keywords), exclude: listStr(p.exclude), apply_note: p.apply_note || '', apply_email: p.apply_email !== false }); } if (me.data && !c && !f) setF({ titles: '', locations: '', remote: 'any', job_types: [], skills: '', keywords: '', exclude: '', apply_note: '', apply_email: true }); }, [me.data]);
  if (!P.prof) return html`<${NeedProfile} />`;
  if (me.error) return html`<${JobsOffline} error=${me.error} />`;
  if (!f) return html`<${Spinner} label="Loading your resume profile…" />`;
  const up = k => e => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const primaryOn = asPrimary === null ? !(resumes.length || addedRef.current) : asPrimary; // the first resume is always used for matching
  const onFiles = async fs => {
    const file = fs[0]; const ext = extOf(file.name);
    if (!['pdf', 'docx', 'txt'].includes(ext)) { toast('Upload your resume as PDF, Word (.docx) or plain text.', true); return; }
    if (file.size > MAX_FILE) { toast(`That file is ${sizeLabel(file.size)}. The limit is 10 MB.`, true); return; }
    if (resumes.length >= 10) { toast('Up to 10 resumes can be kept. Delete one first.', true); return; }
    setBusy(true); setProg(0.03);
    try {
      const fd = new FormData(); fd.append('file', file, file.name); fd.append('label', label.trim().slice(0, 80)); fd.append('primary', primaryOn ? '1' : '0');
      if (ext === 'pdf') { try { const text = await pdfTextOf(file); if (text.trim().length > 50) fd.append('text', text.slice(0, 200000)); } catch (e) { /* the server reads it instead */ } }
      const r = await upload('jobs_resume', fd, setProg); Sync.kick();
      const added = r.resume || {}; const isPrimary = !!added.primary; const prof = isPrimary && r.consultant && r.consultant.profile;
      const what = added.label || added.name || file.name;
      if (r.read && r.read.chars < 120) toast(`${what} was added, but no text could be read from it (a scanned image?). Add your titles and skills in the preferences so matching can work.`, true);
      else toast([`${what} added${isPrimary ? ' and used for job matching' : ''}.`, prof ? `Read: ${prof.skills.length} skills${prof.titles.length ? ', ' + prof.titles[0] : ''}${r.matches ? `; ${r.matches} matching jobs so far` : ''}.` : '', isPrimary ? '' : 'Pick "Use for matching" whenever you want it to drive your matches.'].filter(Boolean).join(' '));
      if (r.run) setRun(r.run);
      addedRef.current += 1; setLabel(''); setAsPrimary(null); me.reload();
    } catch (e) { toast(errText(e), true); }
    setBusy(false); setProg(0);
  };
  const makePrimary = async r => { setBusy(true); try { const x = await api('jobs_resume_set', { id: r.id, primary: true }); toast(`${r.label || r.name} is now used for matching${typeof x.matches === 'number' ? `: ${x.matches} job${x.matches === 1 ? '' : 's'} match` : ''}.`); me.reload(); } catch (e) { toast(errText(e), true); } setBusy(false); };
  const rename = async r => { const l = newLabel.trim().slice(0, 80); setBusy(true); try { await api('jobs_resume_set', { id: r.id, label: l }); toast('Renamed.'); setRenaming(null); me.reload(); } catch (e) { toast(errText(e), true); } setBusy(false); };
  const del = async r => { if (!confirm(`Delete "${r.label || r.name}"?${r.primary && resumes.length > 1 ? ' Your newest other resume will be used for matching.' : r.primary ? ' Your matches will come from your preferences only until you upload another one.' : ''}`)) return; setBusy(true); try { await api('jobs_resume_delete', { id: r.id }); toast('Resume deleted.'); me.reload(); } catch (e) { toast(errText(e), true); } setBusy(false); };
  const save = async e => {
    e.preventDefault(); setBusy(true);
    try { const r = await api('jobs_prefs', { prefs: f }); toast(`Preferences saved. ${r.matches} job${r.matches === 1 ? '' : 's'} match right now.`); if (r.run) setRun(r.run); me.reload(); } catch (x) { toast(errText(x), true); }
    setBusy(false);
  };
  const toggleType = t => setF({ ...f, job_types: f.job_types.includes(t) ? f.job_types.filter(x => x !== t) : [...f.job_types, t] });
  const prof = (c && c.profile) || {};
  const primary = resumes.find(r => r.primary);
  return html`<div className="stack">
    <${RunBanner} run=${run} setRun=${setRun} onDone=${() => me.reload()} />
    <div className="g2" style=${{ alignItems: 'start' }}>
    <div className="stack">
      <section className="panel stack" style=${{ gap: 14 }}>
        <div><h2 className="ph">Your resumes</h2><p className="muted small" style=${{ marginTop: 4 }}>${resumes.length ? html`Keep a version per skill set or role. The one marked <b>Primary</b> drives your job matches; any of them can be sent with one-click apply. A copy of each is kept under Documents.` : 'Upload your current resume. We read the titles, skills, experience and location from it and search the job boards for you. You can keep up to 10 versions, for example one per skill set.'}</p></div>
        ${resumes.length ? html`<ul className="files">${resumes.map(r => html`<li key=${r.id} style=${{ flexWrap: 'wrap' }}><${Icon} n="file" />
          <div className="fn" style=${{ minWidth: 0, flex: 1 }}>
            ${renaming === r.id ? html`<form className="actions" style=${{ flexWrap: 'nowrap' }} onSubmit=${e => { e.preventDefault(); rename(r); }}><input value=${newLabel} onInput=${e => setNewLabel(e.target.value)} maxLength="80" placeholder="e.g. SAP FICO resume" aria-label="Resume name" autoFocus /><button className="btn sm" disabled=${busy}>Save</button><button className="btn ghost sm" type="button" onClick=${() => setRenaming(null)}>Cancel</button></form>`
              : html`<b>${r.label || r.name}</b><span>${r.label ? r.name + ' · ' : ''}Uploaded ${fmtDay(r.at)}${r.size ? ', ' + sizeLabel(r.size) : ''}</span>`}
            <div className="meta" style=${{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>${r.primary ? html`<${Chip} s="ok">Primary · used for matching<//>` : ''}${r.profile && r.profile.titles && r.profile.titles.length ? html`<${Chip}>${r.profile.titles.slice(0, 2).join(' / ')}<//>` : ''}${r.profile && r.profile.skills_n ? html`<span className="muted small">${r.profile.skills_n} skills read</span>` : ''}</div>
          </div>
          <div className="actions" style=${{ justifyContent: 'flex-end' }}>
            ${!r.primary && html`<button className="btn ghost sm" type="button" disabled=${busy} onClick=${() => makePrimary(r)}><${Icon} n="star" />Use for matching</button>`}
            <button className="btn ghost sm" type="button" disabled=${busy} onClick=${() => { setRenaming(r.id); setNewLabel(r.label || ''); }}><${Icon} n="pen" />Rename</button>
            <a className="btn ghost sm" href=${fileUrl('u/' + P.uid, r.fid, true)} download=${r.name}><${Icon} n="down" />Download</a>
            <button className="btn ghost sm icon" type="button" aria-label="Delete" title="Delete this resume" disabled=${busy} onClick=${() => del(r)}><${Icon} n="trash" /></button>
          </div></li>`)}</ul>` : ''}
        ${resumes.length < 10 ? html`<div className="form" style=${{ gap: 10 }}>
          <div className="row2"><${Field} label="Name this resume (optional)"><input value=${label} onInput=${e => setLabel(e.target.value)} maxLength="80" placeholder="e.g. SAP FICO resume, Java resume" /><//>
            <label className="check" style=${{ alignSelf: 'end', paddingBottom: 12 }}><input type="checkbox" checked=${primaryOn} onChange=${e => setAsPrimary(e.target.checked)} /><span>Use this resume for job matching</span></label></div>
          <${FilePick} busy=${busy} progress=${prog} onFiles=${onFiles} label="Drop a resume here, or choose one. You can keep up to 10." hint="PDF, Word (.docx) or text, up to 10 MB." />
        </div>` : html`<p className="muted small" style=${{ margin: 0 }}>You have 10 resumes, the maximum. Delete one to add another.</p>`}
      </section>
      ${c && c.has_resume && html`<section className="panel stack" style=${{ gap: 10 }}><h2 className="ph">What we read from it</h2>
        ${primary ? html`<p className="muted small" style=${{ margin: 0 }}>From <b>${primary.label || primary.name}</b>, your primary resume.</p>` : ''}
        <dl className="kv">
          <dt>Titles</dt><dd>${(prof.titles || []).join(', ') || '—'}</dd>
          <dt>Experience</dt><dd>${prof.years ? prof.years + ' years' : '—'}${prof.seniority ? ', ' + prof.seniority.toLowerCase() : ''}</dd>
          <dt>Location</dt><dd>${prof.location || '—'}</dd>
          <dt>Skills</dt><dd><div className="meta" style=${{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>${(prof.skills || []).slice(0, 30).map(s => html`<${Chip} key=${s}>${s}<//>`)}${(prof.skills || []).length > 30 ? html`<span className="muted small">+${prof.skills.length - 30} more</span>` : ''}</div></dd>
        </dl>
        <p className="muted small">Not quite right? Add the titles and skills you want to be matched on in the preferences; they take priority over what the resume says.</p></section>`}
    </div>
    <form className="panel form" onSubmit=${save}>
      <h2 className="ph">Job preferences</h2>
      <${Field} label="Titles to search for" hint="Comma-separated, e.g. SAP FICO Consultant, S/4HANA Finance Lead. Leave empty to use the titles from your resume."><input value=${f.titles} onInput=${up('titles')} /><//>
      <${Field} label="Locations" hint="Comma-separated cities or states, e.g. Edison, NJ; Remote. Your resume location is used when empty."><input value=${f.locations} onInput=${up('locations')} /><//>
      <${Field} label="Work mode"><select value=${f.remote} onChange=${up('remote')}>${REMOTE_OPTS.map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//>
      <div className="fld"><span>Engagement types</span><div className="meta" style=${{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>${JOB_TYPES.map(t => html`<label key=${t} className=${'pillbtn' + (f.job_types.includes(t) ? ' on' : '')}><input type="checkbox" hidden checked=${f.job_types.includes(t)} onChange=${() => toggleType(t)} />${t}</label>`)}</div><small>Leave all unticked to see every type.</small></div>
      <${Field} label="Extra skills" hint="Skills to match on that may be missing from the resume."><input value=${f.skills} onInput=${up('skills')} /><//>
      <${Field} label="Must-have words" hint="Jobs mentioning these rank higher, e.g. implementation, healthcare."><input value=${f.keywords} onInput=${up('keywords')} /><//>
      <${Field} label="Exclude words" hint="Jobs mentioning these are hidden, e.g. clearance, relocation."><input value=${f.exclude} onInput=${up('exclude')} /><//>
      <h2 className="ph" style=${{ marginTop: 6 }}>One-click apply</h2>
      <${Field} label="Cover note for one-click apply" hint=${'Leave empty for the standard note. Placeholders: ' + APPLY_VARS + '.'}><textarea rows="5" value=${f.apply_note} onInput=${up('apply_note')} placeholder=${APPLY_TPL.split('\n\n')[1]} /><//>
      <label className="check"><input type="checkbox" checked=${!!f.apply_email} onChange=${up('apply_email')} /><span>Email my resume automatically when a posting lists a contact address</span></label>
      <div className="actions"><button className="btn" disabled=${busy}>${busy ? 'Saving…' : 'Save preferences'}</button><a className="btn ghost" href="#/portal/jobs">See matched jobs</a></div>
    </form>
  </div></div>`;
}

/* ---------- staff: Job portals (grabber, sources, runs, jobs, consultants) ---------- */
/* bench = a bench sales recruiter (no Sources tab, no schedule/cron, read-only runs); tab = the tab to open first. Staff and bench both get "Submit consultant". */
function JobPortalsAdmin({ bench, tab: tab0 }) {
  const [tab, setTab] = useState(tab0 || 'grab');
  const [run, setRun] = useState(null);
  const ov = useJobsApi('jobs_admin&op=overview');
  const sub = useSubmit();
  useEffect(() => { if (ov.data) setRun(ov.data.run || null); }, [ov.data]);
  useEffect(() => { setTab(tab0 || 'grab'); }, [tab0]);
  if (ov.error) return html`<div className="stack"><${JobsOffline} error=${ov.error} /><${JobsHelp} /></div>`;
  if (!ov.data) return html`<${Spinner} label="Loading job matching…" />`;
  const o = ov.data; const last = o.last_run;
  const started = r => { setRun(r); ov.reload(); };
  const here = location.hash || '#/portal/admin/jobs'; // the KPI anchors stay on the current page (#/portal/admin/jobs or #/portal/jobs/grab)
  const go = k => e => { e.preventDefault(); setTab(k); };
  const tabs = [['grab', 'Job grabber'], ['sources', 'Sources'], ['runs', 'Collection runs'], ['jobs', 'Collected jobs'], ['consultants', 'Consultant matches']].filter(([k]) => !bench || k !== 'sources');
  return html`<div className="stack">
    <div className="kpis" style=${bench ? { gridTemplateColumns: 'repeat(3,minmax(0,1fr))' } : null}>
      ${!bench && html`<a href=${here} onClick=${go('sources')}><b>${o.sources_on}</b><span>Job sources in use</span></a>`}
      <a href=${here} onClick=${go('jobs')}><b>${o.jobs}</b><span>Jobs collected (${o.jobs_7d} this week)</span></a>
      <a href=${here} onClick=${go('consultants')}><b>${o.consultants_with_resume}</b><span>Consultants with a resume</span></a>
      <a href=${here} onClick=${go('runs')}><b>${runLive(run) ? 'Running' : last ? (RUN_STATUS[last.status] || last.status) : '—'}</b><span>${last ? 'Last collection ' + fmtTs(last.finished_at || last.started_at) : 'No collection yet'}</span></a>
      ${!bench && html`<a href=${here} onClick=${go('sources')}><b>${o.schedule_hours > 0 ? 'Every ' + (o.schedule_hours >= 1 ? o.schedule_hours + 'h' : Math.round(o.schedule_hours * 60) + 'm') : 'Manual'}</b><span>${o.next_run_at ? 'Next due ' + fmtTs(o.next_run_at) : 'Schedule'}</span></a>`}
    </div>
    <${RunBanner} run=${run} setRun=${setRun} admin=${!bench} onDone=${() => ov.reload()} />
    <div className="tabs" role="tablist">${tabs.map(([k, v]) => html`<button key=${k} type="button" role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${v}</button>`)}</div>
    ${tab === 'grab' && html`<${JobGrabber} o=${o} run=${run} onStart=${started} bench=${bench} onSubmit=${sub.onSubmit} />`}
    ${tab === 'sources' && !bench && html`<${SourcesTab} reload=${ov.reload} />`}
    ${tab === 'runs' && html`<${RunsTab} o=${o} run=${run} onStart=${started} readOnly=${bench} />`}
    ${tab === 'jobs' && html`<${CollectedJobs} o=${o} onSubmit=${sub.onSubmit} bench=${bench} />`}
    ${tab === 'consultants' && html`<${ConsultantMatches} onSubmit=${sub.onSubmit} />`}
    ${sub.modal}
  </div>`;
}
const JobsHelp = () => html`<section className="panel stack" style=${{ gap: 8 }}><h2 className="ph">How job matching works</h2>
  <p className="muted small">Jobs are collected from the sources turned on under Sources (job-board APIs that publish listings for this purpose, plus any RSS/JSON feed you add), every few hours and whenever you grab jobs by keyword. Each posting is ranked against every consultant's resume and preferences. Nothing logs in to Dice, LinkedIn, Indeed or Monster with a password: those sites block automated logins and ban accounts; listings from them come through the JSearch (Google for Jobs) and Jooble sources instead.</p></section>`;

function SourceCard({ s, reload }) {
  const toast = useToast();
  const [f, setF] = useState(() => Object.fromEntries(s.fields.map(x => [x.k, x.secret ? '' : x.value])));
  const [perRun, setPerRun] = useState(s.per_run); const [cap, setCap] = useState(s.month ? s.month.cap : 0); const [country, setCountry] = useState(s.country || 'us');
  const [busy, setBusy] = useState(null); const [test, setTest] = useState(null);
  const call = async (body, msg) => { setBusy(body.op); try { const r = await api('jobs_admin', { key: s.key, ...body }); msg && toast(msg); reload(); return r; } catch (e) { toast(errText(e), true); reload(); } finally { setBusy(null); } };
  const save = async () => { const fields = {}; s.fields.forEach(x => { if (f[x.k] && f[x.k].trim()) fields[x.k] = f[x.k].trim(); }); const r = await call({ op: 'source_save', fields, per_run: perRun, month_cap: cap || undefined, country }, null); if (r) { toast(`${s.name} saved.`); setF(Object.fromEntries(s.fields.map(x => [x.k, x.secret ? '' : (fields[x.k] || f[x.k])]))); } };
  const toggle = async () => { const r = await call({ op: 'source_save', on: !s.on }, null); if (r) toast(r.on ? `${s.name} is on. Click Test to check it.` : `${s.name} is off.`); };
  const runTest = async () => { setTest(null); setBusy('test'); try { const r = await api('jobs_admin', { op: 'source_test', key: s.key }); setTest(r); reload(); } catch (e) { setTest({ ok: false, error: errText(e) }); } setBusy(null); };
  const st = s.status;
  return html`<div className="panel stack srccard" style=${{ gap: 10 }}>
    <div className="ph-row" style=${{ marginBottom: 0 }}><h3 className="ph" style=${{ margin: 0 }}>${s.name}</h3><div className="meta" style=${{ margin: 0, display: 'flex', gap: 6 }}><${Chip}>${s.cost}<//>${s.remote && html`<${Chip}>Remote jobs<//>`}${s.on && s.ready ? html`<${Chip} s="ok">On<//>` : html`<${Chip} s="inactive">Off<//>`}</div></div>
    <p className="muted small" style=${{ margin: 0 }}>${s.about} ${s.link && html`<a href=${s.link} target="_blank" rel="noopener noreferrer">${s.fields.length ? 'Get a key' : 'Website'}</a>`}</p>
    ${s.fields.length ? html`<div className="form" style=${{ gap: 8 }}>${s.fields.map(x => html`<${Field} key=${x.k} label=${x.label + (x.secret && x.set ? ' (saved: ' + x.value + ')' : '')}><input value=${f[x.k]} onInput=${e => setF({ ...f, [x.k]: e.target.value })} placeholder=${x.secret && x.set ? 'Leave empty to keep the saved key' : ''} autoComplete="off" /><//>`)}
      <div className="row2">${s.kind === 'search' && html`<${Field} label="Searches per collection" hint="Each consultant title and location is one search."><input type="number" min="1" max="100" value=${perRun} onInput=${e => setPerRun(+e.target.value || 1)} /><//>`}
        ${s.month && html`<${Field} label="Monthly search limit" hint=${`Used this month: ${s.month.used}. Set it to your plan's limit.`}><input type="number" min="1" max="100000" value=${cap} onInput=${e => setCap(+e.target.value || 1)} /><//>`}
        ${s.key === 'adzuna' && html`<${Field} label="Country code"><input value=${country} onInput=${e => setCountry(e.target.value)} maxLength="2" style=${{ maxWidth: 90 }} /><//>`}</div></div>`
      : s.kind === 'search' ? html`<div className="row2"><${Field} label="Searches per collection"><input type="number" min="1" max="100" value=${perRun} onInput=${e => setPerRun(+e.target.value || 1)} /><//></div>` : ''}
    ${st && (st.error ? html`<p className="err small" style=${{ margin: 0 }}>Last problem ${fmtTs(st.err_at)}: ${st.error}</p>` : st.ok_at ? html`<p className="small" style=${{ margin: 0, color: 'var(--teal-ink)' }}>Last worked ${fmtTs(st.ok_at)} (${st.n} jobs).</p>` : '')}
    ${test && html`<div className=${'note ' + (test.ok ? 'ok' : 'red')}><span>${test.ok ? html`<b>Works.</b> ${test.n} job${test.n === 1 ? '' : 's'} for "software engineer"${test.sample && test.sample.length ? ': ' + test.sample.slice(0, 3).join('; ') : ''}` : html`<b>Not working.</b> ${test.error}`}</span></div>`}
    <div className="actions">
      ${(s.fields.length || s.kind === 'search') && html`<button className="btn sm" type="button" disabled=${!!busy} onClick=${save}>${busy === 'source_save' ? 'Saving…' : 'Save'}</button>`}
      <button className=${'btn sm' + (s.on ? ' ghost' : '')} type="button" disabled=${!!busy} onClick=${toggle}>${s.on ? 'Turn off' : 'Turn on'}</button>
      <button className="btn ghost sm" type="button" disabled=${!!busy || !s.ready} onClick=${runTest}>${busy === 'test' ? 'Testing…' : 'Test'}</button>
    </div>
  </div>`;
}
function SourcesTab({ reload }) {
  const toast = useToast();
  const r = useJobsApi('jobs_admin&op=sources');
  const [st, setSt] = useState(null); const [feed, setFeed] = useState({ name: '', url: '' }); const [busy, setBusy] = useState(false); const [ftest, setFtest] = useState({});
  useEffect(() => { if (r.data && !st) setSt(r.data.settings); }, [r.data]);
  if (r.error) return html`<${JobsOffline} error=${r.error} />`;
  if (!r.data || !st) return html`<${Spinner} />`;
  const both = () => { r.reload(); reload(); };
  const saveSettings = async e => { e.preventDefault(); setBusy(true); try { await api('jobs_admin', { op: 'settings_save', ...st }); toast('Schedule saved.'); both(); } catch (x) { toast(errText(x), true); } setBusy(false); };
  const addFeed = async e => { e.preventDefault(); setBusy(true); try { await api('jobs_admin', { op: 'feed_save', ...feed, on: true }); toast('Feed added.'); setFeed({ name: '', url: '' }); both(); } catch (x) { toast(errText(x), true); } setBusy(false); };
  const feedToggle = async f => { try { await api('jobs_admin', { op: 'feed_toggle', id: f.id, on: !f.on }); both(); } catch (x) { toast(errText(x), true); } };
  const feedDel = async f => { if (!confirm(`Remove the feed "${f.name}"?`)) return; try { await api('jobs_admin', { op: 'feed_delete', id: f.id }); both(); } catch (x) { toast(errText(x), true); } };
  const feedTest = async f => { setFtest({ ...ftest, [f.id]: { busy: true } }); try { const t = await api('jobs_admin', { op: 'source_test', key: 'feed:' + f.id }); setFtest({ ...ftest, [f.id]: t }); } catch (x) { setFtest({ ...ftest, [f.id]: { ok: false, error: errText(x) } }); } };
  const copy = async (text, what) => { try { await navigator.clipboard.writeText(text); toast(what + ' copied.'); } catch (e) { prompt('Copy this:', text); } };
  const newKey = async () => { if (!confirm('Make a new cron key? Update your cron job with the new command afterwards.')) return; try { await api('jobs_admin', { op: 'cron_key' }); toast('New cron key made.'); both(); } catch (x) { toast(errText(x), true); } };
  const cron = r.data.cron; const up = k => e => setSt({ ...st, [k]: e.target.value });
  return html`<div className="stack">
    <div className="note info"><span><b>How this works.</b> Turn on the sources you want and add their keys. Every few hours (or whenever someone opens a job page, or on the cron schedule below) each consultant's titles and locations are searched on every source, and the results are matched to every resume. The free no-key sources list remote roles; for on-site and hybrid roles across the US add Adzuna (free key) and, for listings that appear on LinkedIn, Indeed, Dice and Monster, JSearch.</span></div>
    <div className="portals-grid">${r.data.sources.map(s => html`<${SourceCard} key=${s.key + (s.on ? 1 : 0) + (s.ready ? 1 : 0)} s=${s} reload=${both} />`)}</div>
    <div className="g2" style=${{ alignItems: 'start' }}>
      <section className="panel stack" style=${{ gap: 10 }}><h2 className="ph">Your own feeds</h2>
        <p className="muted small" style=${{ margin: 0 }}>Any RSS, Atom or JSON job feed, for example from a C2C requirement board. If the address contains <code>{keywords}</code> (and optionally <code>{location}</code>) it is searched per consultant title; otherwise the whole feed is read and filtered by the consultants' titles.</p>
        ${r.data.feeds.length ? html`<ul className="list">${r.data.feeds.map(f => html`<li key=${f.id}><div style=${{ minWidth: 0 }}><div className="t">${f.name} ${f.on ? html`<${Chip} s="ok">On<//>` : html`<${Chip} s="inactive">Off<//>`}</div><div className="m" style=${{ wordBreak: 'break-all' }}>${f.url}</div>
          ${f.status && f.status.error ? html`<div className="err small">Last problem: ${f.status.error}</div>` : f.status && f.status.ok_at ? html`<div className="small muted">Last worked ${fmtTs(f.status.ok_at)} (${f.status.n} jobs)</div>` : ''}
          ${ftest[f.id] && !ftest[f.id].busy ? html`<div className="small" style=${{ color: ftest[f.id].ok ? 'var(--teal-ink)' : 'var(--red-ink)' }}>${ftest[f.id].ok ? `Works: ${ftest[f.id].n} items` + (ftest[f.id].sample && ftest[f.id].sample.length ? ' (' + ftest[f.id].sample[0] + ')' : '') : 'Not working: ' + ftest[f.id].error}</div>` : ''}</div>
          <div className="actions" style=${{ flexWrap: 'nowrap' }}><button className="btn ghost sm" type="button" onClick=${() => feedTest(f)} disabled=${ftest[f.id] && ftest[f.id].busy}>Test</button><button className="btn ghost sm" type="button" onClick=${() => feedToggle(f)}>${f.on ? 'Turn off' : 'Turn on'}</button><button className="btn ghost sm icon" type="button" aria-label="Remove" onClick=${() => feedDel(f)}><${Icon} n="trash" /></button></div></li>`)}</ul>` : ''}
        <form className="form" onSubmit=${addFeed} style=${{ gap: 8 }}><div className="row2"><${Field} label="Name"><input value=${feed.name} onInput=${e => setFeed({ ...feed, name: e.target.value })} placeholder="e.g. C2C requirements board" /><//><${Field} label="Feed address"><input value=${feed.url} onInput=${e => setFeed({ ...feed, url: e.target.value })} placeholder="https://…/feed" /><//></div><div><button className="btn sm" disabled=${busy}><${Icon} n="plus" />Add feed</button></div></form>
      </section>
      <div className="stack">
        <form className="panel form" onSubmit=${saveSettings}><h2 className="ph">Schedule and limits</h2>
          <div className="row2"><${Field} label="Collect automatically every (hours)" hint="0 turns automatic collections off."><input type="number" min="0" max="168" step="0.5" value=${st.schedule_hours} onInput=${up('schedule_hours')} /><//><${Field} label="Look for jobs posted in the last (days)"><input type="number" min="1" max="60" value=${st.max_age_days} onInput=${up('max_age_days')} /><//></div>
          <div className="row2"><${Field} label="Searches per collection" hint="Distinct title + location pairs across all consultants."><input type="number" min="1" max="100" value=${st.max_searches} onInput=${up('max_searches')} /><//><${Field} label="Keep jobs for (days)"><input type="number" min="7" max="180" value=${st.keep_days} onInput=${up('keep_days')} /><//></div>
          <${Field} label="Minimum match score to show (10–90)" hint="Lower it to see more, looser matches."><input type="number" min="10" max="90" value=${st.min_score} onInput=${up('min_score')} /><//>
          <div><button className="btn" disabled=${busy}>Save</button></div></form>
        <section className="panel stack" style=${{ gap: 8 }}><h2 className="ph">Hands-free collections (cron)</h2>
          <p className="muted small" style=${{ margin: 0 }}>Collections also run while anyone has a job page open. To run them without that, add a cron job in cPanel (Cron Jobs, every 10 or 15 minutes) with this command:</p>
          <pre className="small" style=${{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>${cron.cli}</pre><div className="actions"><button className="btn ghost sm" type="button" onClick=${() => copy(cron.cli, 'Command')}>Copy command</button></div>
          <p className="muted small" style=${{ margin: 0 }}>Or, if your host only offers web cron, call this address instead (keep it private):</p>
          <pre className="small" style=${{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>${cron.url}</pre><div className="actions"><button className="btn ghost sm" type="button" onClick=${() => copy(cron.url, 'Address')}>Copy address</button><button className="btn ghost sm" type="button" onClick=${newKey}>New key</button></div>
          <p className="small" style=${{ margin: 0 }}>${cron.last ? html`Cron last ran <b>${fmtTs(cron.last)}</b>.` : html`<span className="muted">The cron job has not run yet.</span>`}</p>
        </section>
      </div>
    </div>
  </div>`;
}

function RunsTab({ o, run, onStart, readOnly }) {
  const toast = useToast();
  const r = useJobsApi('jobs_admin&op=runs&limit=40', [run && run.status, run && run.progress && run.progress.done]);
  const [busy, setBusy] = useState(false); const [log, setLog] = useState(null);
  const start = async () => { setBusy(true); try { const x = await api('jobs_admin', { op: 'run' }); toast(x.already ? 'A collection is already running.' : 'Collection started.'); onStart(x.run); } catch (e) { toast(errText(e), true); } setBusy(false); };
  const showLog = async x => { setLog({ ...x, log: 'Loading…' }); try { const d = await api('jobs_admin&op=run_log&id=' + x.id); setLog(d.run); } catch (e) { setLog({ ...x, log: errText(e) }); } };
  const stChip = s => html`<${Chip} s=${s === 'done' ? 'ok' : s === 'running' || s === 'queued' ? 'new' : s === 'done_with_errors' ? 'amber' : 'red'}>${RUN_STATUS[s] || s}<//>`;
  return html`<${Fragment}>
    <div className="note info"><span>A collection searches every source for each consultant's titles and locations, then refreshes everyone's matches. ${readOnly ? 'StratEdge staff schedule them; use the Job grabber to search right now.' : o.schedule_hours > 0 ? `One starts automatically every ${o.schedule_hours} hours when a job page is open or the cron job runs.` : 'Automatic collections are off (set the hours under Sources).'}</span>
      ${!readOnly && html`<div className="actions"><button className="btn sm" type="button" disabled=${busy || runLive(run)} onClick=${start}><${Icon} n="refresh" />${runLive(run) ? 'Collection in progress…' : 'Collect jobs now'}</button></div>`}</div>
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${r.loading && !r.data ? html`<${Spinner} />` : r.data && r.data.runs.length ? html`<div className="tblwrap"><table className="tbl">
        <thead><tr><th>Started</th><th>Kind</th><th>Status</th><th>Started by</th><th className="r">Searches</th><th className="r">Jobs seen</th><th className="r">New</th><th>Problems</th><th className="r"><span className="sr">Log</span></th></tr></thead>
        <tbody>${r.data.runs.map(x => html`<tr key=${x.id}><td>${fmtTs(x.started_at)}${x.finished_at ? html`<div className="muted small">${Math.max(1, Math.round((x.finished_at - x.started_at) / 60000))} min</div>` : html`<div className="muted small">${x.progress.done}/${x.progress.total} steps</div>`}</td><td>${RUN_KINDS[x.kind] || x.kind}</td><td>${stChip(x.status)}</td><td className="muted small">${x.trigger_by}</td>
          <td className="r">${x.searches}</td><td className="r">${x.jobs_found}</td><td className="r">${x.jobs_new}</td><td className="small">${x.errors.length ? x.errors.slice(0, 4).map((e, i) => html`<div key=${i}><b>${e.source}:</b> ${e.error}</div>`) : html`<span className="muted">None</span>`}</td>
          <td className="r"><button className="btn ghost sm" type="button" onClick=${() => showLog(x)}>Log</button></td></tr>`)}</tbody></table></div>`
        : html`<${Empty} title="No collections yet">${readOnly ? 'Use the Job grabber to search the sources by keyword.' : 'Click "Collect jobs now" once a consultant has uploaded a resume, or use the Job grabber.'}<//>`}
    </section>
    ${log && html`<${Modal} wide title=${'Collection ' + fmtTs(log.started_at)} onClose=${() => setLog(null)}><pre className="small" style=${{ whiteSpace: 'pre-wrap', maxHeight: '60vh', overflow: 'auto' }}>${log.log || 'No log lines.'}</pre><//>`}
  <//>`;
}

function usePublish(reload) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const publish = async (j, on) => {
    setBusy(true);
    try { await api('jobs_admin', on ? { op: 'publish', job_id: j.id } : { op: 'unpublish', job_id: j.id }); toast(on ? 'Posted on the Careers page. Share it from there.' : 'Removed from the Careers page.'); reload && reload(); }
    catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  return { publish, busy };
}

function CollectedJobs({ o, onSubmit, bench }) {
  const [q, setQ] = useState(''); const [source, setSource] = useState(''); const [qq, setQq] = useState('');
  useEffect(() => { const t = setTimeout(() => setQq(q.trim()), 350); return () => clearTimeout(t); }, [q]);
  const r = useJobsApi('jobs_admin&op=jobs&q=' + encodeURIComponent(qq) + '&source=' + encodeURIComponent(source));
  const pub = usePublish(r.reload);
  return html`<${Fragment}>
    <div className="toolbar"><input style=${{ maxWidth: 340 }} type="search" placeholder="Search title, company, location, skills" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Search jobs" />
      ${(o.sources || []).some(s => s.key) && html`<select value=${source} onChange=${e => setSource(e.target.value)} aria-label="Source" style=${{ maxWidth: 220 }}><option value="">All sources</option>${(o.sources || []).filter(s => s.key).map(s => html`<option key=${s.key} value=${s.key}>${s.name}</option>`)}</select>`}
      <span className="muted small">${r.data ? `${r.data.total} job${r.data.total === 1 ? '' : 's'}` : ''}</span></div>
    ${r.error ? html`<${JobsOffline} error=${r.error} />` : r.loading && !r.data ? html`<${Spinner} />` : r.data.jobs.length ? html`<div className="matches">${r.data.jobs.map(j => html`<${JobRow} key=${j.id} j=${j} onPublish=${pub.publish} onSubmit=${onSubmit} busy=${pub.busy} />`)}</div>`
      : html`<div className="panel"><${Empty} title="No jobs collected yet">${bench ? 'Grab jobs by keyword from the Job grabber tab.' : 'Grab jobs by keyword, or start a collection from the Collection runs tab once a consultant has uploaded a resume.'}<//></div>`}
  <//>`;
}

function ConsultantMatches({ onSubmit }) {
  const P = usePortal(); const toast = useToast();
  const r = useJobsApi('jobs_admin&op=consultants');
  const [open, setOpen] = useState(null); const [busy, setBusy] = useState(false);
  const m = useJobsApi(open ? 'jobs_admin&op=matches&uid=' + encodeURIComponent(open.uid) : 'jobs_admin&op=overview');
  if (r.error) return html`<${JobsOffline} error=${r.error} />`;
  if (r.loading && !r.data) return html`<${Spinner} />`;
  const list = r.data.consultants || [];
  const nameOfC = c => c.name || (P.people[c.uid] && P.people[c.uid].name) || c.uid;
  const rematch = async () => { setBusy(true); try { const x = await api('jobs_admin', { op: 'rematch_all' }); toast(`Matches refreshed for ${x.people} ${x.people === 1 ? 'person' : 'people'}.`); r.reload(); } catch (e) { toast(errText(e), true); } setBusy(false); };
  return html`<${Fragment}>
    <div className="toolbar" style=${{ justifyContent: 'flex-end' }}><button className="btn ghost sm" type="button" disabled=${busy} onClick=${rematch}><${Icon} n="refresh" />${busy ? 'Refreshing…' : 'Refresh all matches'}</button></div>
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${list.length ? html`<div className="tblwrap"><table className="tbl">
        <thead><tr><th>Consultant</th><th>Resume</th><th>Matched as</th><th>Location</th><th className="r">New</th><th className="r">Saved</th><th className="r">Applied</th><th className="r"><span className="sr">Open</span></th></tr></thead>
        <tbody>${list.map(c => html`<tr key=${c.uid} className="click" tabIndex="0" onClick=${() => setOpen(c)} onKeyDown=${e => { if (e.key === 'Enter') setOpen(c); }}>
          <td><b style=${{ fontWeight: 600 }}>${nameOfC(c)}</b><div className="muted small">${c.email}</div></td>
          <td>${c.has_resume ? html`<${Chip} s="ok">${c.resume_count > 1 ? c.resume_count + ' resumes' : c.resume_name}<//><div className="muted small">${c.resume_count > 1 ? 'Matching on ' + c.resume_name : fmtTs(c.resume_at)}</div>` : html`<${Chip} s="amber">Not uploaded<//>`}</td>
          <td>${((c.prefs && c.prefs.titles && c.prefs.titles.length ? c.prefs.titles : c.profile.titles) || []).slice(0, 2).join(', ') || '—'}</td><td>${(c.prefs && c.prefs.locations && c.prefs.locations[0]) || c.profile.location || '—'}</td>
          <td className="r">${c.match_counts.new || 0}</td><td className="r">${c.match_counts.saved || 0}</td><td className="r">${c.match_counts.applied || 0}</td>
          <td className="r"><button className="btn ghost sm" type="button">View</button></td></tr>`)}</tbody></table></div>`
        : html`<${Empty} title="No consultants have set up job matching yet">Consultants upload their resume under "Resume & preferences" in the consultant portal.<//>`}
    </section>
    ${open && html`<${Modal} wide title=${'Matches for ' + nameOfC(open)} onClose=${() => setOpen(null)}>
      <div className="stack">
        <${ConsultantResumes} uid=${open.uid} />
        ${m.loading ? html`<${Spinner} />` : m.error ? html`<${JobsOffline} error=${m.error} />` : (m.data.matches || []).length ? html`<div className="matches">${m.data.matches.map(j => html`<${JobRow} key=${j.id} j=${j} onSubmit=${onSubmit} />`)}</div>` : html`<${Empty} title="No matches yet" />`}
      </div><//>`}
  <//>`;
}

/* ---------- staff: Job grabber (search the sources by keyword, publish to Careers) ---------- */
const GRAB_DAYS = [[1, 'Past 24 hours'], [3, 'Past 3 days'], [7, 'Past week'], [14, 'Past 2 weeks'], [30, 'Past month']];
function JobGrabber({ o, run, onStart, bench, onSubmit }) {
  const toast = useToast();
  const sources = (o.sources || []).filter(s => s.on && s.ready);
  const [f, setF] = useState({ keywords: '', location: '', remote: 'any', posted_days: 7, sources: null });
  const [runId, setRunId] = useState(null);
  const [busy, setBusy] = useState(false);
  const mine = run && run.id === runId ? run : null; const finished = runId && (!run || run.id !== runId || !runLive(run));
  const jobs = useJobsApi(finished ? 'jobs_admin&op=run_jobs&id=' + runId : 'jobs_admin&op=overview');
  const pub = usePublish(jobs.reload);
  const sel = f.sources || Object.fromEntries(sources.map(s => [s.key, true]));
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const grab = async e => {
    e.preventDefault();
    const kws = f.keywords.split(/[,\n;]/).map(x => x.trim()).filter(Boolean);
    if (!kws.length) { toast('Type at least one job title or keyword.', true); return; }
    const chosen = sources.filter(s => sel[s.key]).map(s => s.key);
    if (!chosen.length) { toast('Pick at least one source.', true); return; }
    setBusy(true);
    try { const r = await api('jobs_admin', { op: 'grab', keywords: kws, location: f.location, remote: f.remote, posted_days: +f.posted_days, sources: chosen }); setRunId(r.run.id); onStart(r.run); toast(r.run.status === 'queued' ? 'Queued behind the current collection.' : 'Grabbing jobs… results appear below as each source answers.'); }
    catch (x) { toast(errText(x), true); }
    setBusy(false);
  };
  return html`<${Fragment}>
    <p className="muted small">${bench ? 'Grabbed jobs are matched to every consultant\'s resume. Use Submit to send a consultant\'s resume to the posting in one click.' : `Type job titles or keywords, pick the sources, and grab. Results are stored, matched to every consultant's resume, and any of them can be published to the Careers page with one click.`}${sources.length ? '' : bench ? ' No job source is on yet: ask an administrator to turn some on.' : ' No source is on yet: turn some on under Sources.'}</p>
    <form className="panel form" onSubmit=${grab}>
      <h2 className="ph">Grab jobs</h2>
      <${Field} label="Job titles or keywords" hint="Comma-separated. Each one is searched on every selected source."><input value=${f.keywords} onInput=${up('keywords')} placeholder="e.g. SAP FICO Consultant, ServiceNow Developer, Epic Analyst" /><//>
      <div className="row3"><${Field} label="Location"><input value=${f.location} onInput=${up('location')} placeholder="City, state (empty = United States)" /><//>
        <${Field} label="Posted"><select value=${f.posted_days} onChange=${up('posted_days')}>${GRAB_DAYS.map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//>
        <${Field} label="Work mode"><select value=${f.remote} onChange=${up('remote')}>${REMOTE_OPTS.map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//></div>
      <div className="fld"><span>Sources</span><div className="meta" style=${{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>${sources.map(s => html`<label key=${s.key} className=${'pillbtn' + (sel[s.key] ? ' on' : '')}><input type="checkbox" hidden checked=${!!sel[s.key]} onChange=${() => setF({ ...f, sources: { ...sel, [s.key]: !sel[s.key] } })} />${s.name}${s.remote ? ' (remote)' : ''}</label>`)}${!sources.length && html`<span className="muted small">None on.</span>`}</div></div>
      <div className="actions"><button className="btn" disabled=${busy || !sources.length}><${Icon} n="search" />${mine && runLive(mine) ? 'Grabbing…' : 'Grab jobs'}</button></div>
    </form>
    ${runId && (finished ? html`<section className="panel stack" style=${{ gap: 10 }}>
      <div className="ph-row"><h2 className="ph">${jobs.data && jobs.data.jobs ? `Grabbed ${jobs.data.jobs.length} job${jobs.data.jobs.length === 1 ? '' : 's'}` : 'Grabbed jobs'}</h2><span className="muted small">${mine && mine.search ? mine.search.map(q => q.q).join(', ') + (mine.search[0] ? ' in ' + mine.search[0].location : '') : ''}</span></div>
      ${mine && mine.errors && mine.errors.length ? html`<div className="note amber"><span>${mine.errors.map((e, i) => html`<div key=${i}><b>${e.source}:</b> ${e.error}</div>`)}</span></div>` : ''}
      ${jobs.data && jobs.data.jobs ? (jobs.data.jobs.length ? html`<div className="matches">${jobs.data.jobs.map(j => html`<${JobRow} key=${j.id} j=${j} onPublish=${pub.publish} onSubmit=${onSubmit} busy=${pub.busy} />`)}</div>` : html`<${Empty} title="Nothing found for that search">Try broader keywords, a longer "Posted" window, or more sources.<//>`) : html`<${Spinner} />`}
    </section>` : html`<section className="panel"><${Spinner} label="Searching the sources… results appear here when the grab finishes." /></section>`)}
  <//>`;
}

/* ---------- staff / bench: submit a consultant to a posting in one click ---------- */
function useSubmit() {
  const [j, setJ] = useState(null);
  const modal = j ? html`<${SubmitModal} j=${j} onClose=${() => setJ(null)} onDone=${() => setJ(null)} />` : null;
  return { onSubmit: setJ, modal };
}
function ConsultantResumes({ uid }) {
  const r = useJobsApi('jobs_admin&op=resumes&uid=' + encodeURIComponent(uid));
  if (r.loading && !r.data) return html`<p className="muted small" style=${{ margin: 0 }}>Loading resumes…</p>`;
  const list = (r.data && r.data.resumes) || [];
  if (r.error || !list.length) return html`<p className="muted small" style=${{ margin: 0 }}><b>Resumes:</b> none uploaded yet.</p>`;
  return html`<div className="small" style=${{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}><b>Resumes:</b>${list.map(x => html`<a key=${x.id} className="chip" href=${fileUrl('u/' + uid, x.fid, true)} download=${x.name} title=${x.name + ' · ' + fmtDay(x.at)}><${Icon} n="down" />${x.label || x.name}${x.primary ? ' (primary)' : ''}</a>`)}</div>`;
}
function SubmitModal({ j, onClose, onDone }) {
  const P = usePortal(); const toast = useToast();
  const cons = useJobsApi('jobs_admin&op=consultants');
  const jd = useJobsApi('jobs_job&id=' + j.id);
  const [q, setQ] = useState(''); const [uid, setUid] = useState('');
  const [res, setRes] = useState({ uid: '', list: null, error: null }); const [rid, setRid] = useState(0);
  const [to, setTo] = useState(''); const [toTouched, setToTouched] = useState(false);
  const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { // the posting's contact address is suggested once, unless the recruiter already typed one
    const ct = jd.data && jd.data.job && jd.data.job.contact; if (ct && !toTouched && !to) setTo(ct);
  }, [jd.data]);
  useEffect(() => {
    if (!uid) { setRes({ uid: '', list: null, error: null }); setRid(0); return; }
    let live = true; setRes({ uid, list: null, error: null });
    api('jobs_admin&op=resumes&uid=' + encodeURIComponent(uid)).then(d => { if (!live) return; const l = d.resumes || []; const p = l.find(x => x.primary) || l[0]; setRes({ uid, list: l, error: null }); setRid(p ? p.id : 0); })
      .catch(e => live && setRes({ uid, list: [], error: e }));
    return () => { live = false; };
  }, [uid]);
  const all = ((cons.data && cons.data.consultants) || []).filter(c => (c.resume_count || 0) > 0 || c.has_resume);
  const ql = q.trim().toLowerCase();
  const list = all.filter(c => !ql || [c.name, c.email, listStr(c.profile && c.profile.titles), c.profile && c.profile.location, listStr(c.prefs && c.prefs.titles)].filter(Boolean).join(' ').toLowerCase().includes(ql));
  const picked = all.find(c => c.uid === uid);
  const nameOfC = c => c.name || (P.people[c.uid] && P.people[c.uid].name) || c.email || c.uid;
  const emailOk = !to.trim() || /^\S+@\S+\.\S+$/.test(to.trim());
  const ready = !!picked && !!rid && emailOk; // the anchor below must stay rendered while busy, or the click that opens the posting loses its target
  const body = () => ({ job_id: j.id, uid, resume_id: +rid, to: to.trim(), note: note.trim() });
  const after = r => { toast(`Submitted ${nameOfC(picked)} for ${j.title}. Logged under RTRs & submissions${r.mailed ? ' and emailed to ' + (r.to || to.trim()) : ''}.`); onDone(r); };
  const fire = () => { if (!ready || busy) return; setBusy(true); api('jobs_apply', body()).then(after).catch(e => { toast(errText(e), true); setBusy(false); }); }; // not awaited: the anchor opens the posting meanwhile
  const quiet = async () => { if (!ready || busy) return; setBusy(true); try { after(await api('jobs_apply', body())); } catch (e) { toast(errText(e), true); setBusy(false); } };
  const foot = html`<button className="btn ghost" type="button" onClick=${onClose}>Cancel</button>
    <button className="btn" type="button" disabled=${!ready || busy} onClick=${quiet}>${busy ? 'Submitting…' : 'Submit without opening'}</button>
    ${ready ? html`<a className="btn go" href=${j.url} target="_blank" rel="noopener noreferrer" onClick=${fire}><${Icon} n="send" />Submit and open posting</a>` : html`<button className="btn go" type="button" disabled><${Icon} n="send" />Submit and open posting</button>`}`;
  return html`<${Modal} wide title=${'Submit a consultant: ' + j.title} onClose=${onClose} foot=${foot}>
    <div className="g2" style=${{ alignItems: 'start' }}>
      <div className="stack" style=${{ gap: 10 }}>
        <p className="muted small" style=${{ margin: 0 }}><b>${j.title}</b>${[j.company, j.location, j.portal].filter(Boolean).length ? ' · ' + [j.company, j.location, j.portal].filter(Boolean).join(' · ') : ''}</p>
        <div className="toolbar" style=${{ margin: 0 }}><input type="search" placeholder="Search consultants by name, title, location" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Search consultants" /></div>
        <div className="picklist">${cons.loading && !cons.data ? html`<${Spinner} />` : cons.error ? html`<p className="err small" style=${{ padding: 10 }}>${errText(cons.error)}</p>` : list.length ? list.map(c => html`<label key=${c.uid} className=${'pick' + (uid === c.uid ? ' on' : '')}><input type="radio" name="sub-uid" checked=${uid === c.uid} onChange=${() => setUid(c.uid)} /><span><b>${nameOfC(c)}</b><small>${[listStr(((c.prefs && c.prefs.titles && c.prefs.titles.length ? c.prefs.titles : (c.profile && c.profile.titles)) || []).slice(0, 2)), (c.prefs && c.prefs.locations && c.prefs.locations[0]) || (c.profile && c.profile.location), (c.resume_count || 1) + (c.resume_count === 1 || !c.resume_count ? ' resume' : ' resumes')].filter(Boolean).join(' · ')}</small></span></label>`)
          : html`<p className="muted small" style=${{ padding: 10 }}>${all.length ? 'No consultant matches that search.' : 'No portal consultant has uploaded a resume yet.'}</p>`}</div>
      </div>
      <div className="form">
        <${Field} label="Resume to send" hint=${picked ? 'The resume the consultant marked for matching is preselected.' : 'Pick a consultant first.'}>${!picked ? html`<select disabled><option>Pick a consultant</option></select>` : res.list === null ? html`<select disabled><option>Loading resumes…</option></select>` : res.list.length ? html`<select value=${rid} onChange=${e => setRid(e.target.value)}>${res.list.map(x => html`<option key=${x.id} value=${x.id}>${(x.label || x.name) + (x.primary ? ' (primary)' : '')}</option>`)}</select>` : html`<span className="err small">This consultant has no resume in the portal yet.</span>`}<//>
        <${Field} label="Send to" hint="Found in the posting. Change it if you know the vendor recruiter's address; leave empty to just log the submission."><input type="email" value=${to} onInput=${e => { setTo(e.target.value); setToTouched(true); }} placeholder=${jd.loading ? 'Looking for a contact address in the posting…' : 'recruiter@vendor.com'} /><//>
        ${!emailOk && html`<p className="err small" style=${{ margin: 0 }}>That does not look like an email address.</p>`}
        <${Field} label="Note (optional)" hint="Goes into the RTR & submissions log entry."><input value=${note} onInput=${e => setNote(e.target.value)} maxLength="300" placeholder="e.g. Rate $70/hr C2C, available in 2 weeks" /><//>
        <div className="note info"><span>The submission is logged under RTRs & submissions and the application appears under the consultant's Applications${to.trim() ? html`; the resume is emailed to <b>${to.trim()}</b> with replies going to ${P.caps.me.email}` : ''}.</span></div>
      </div>
    </div><//>`;
}

/* ---------- bench sales dashboard card ---------- */
function BenchCard() {
  const P = usePortal();
  const ov = useJobsApi('jobs_admin&op=overview');
  const subs = useCol('rec/sub/items', 'd:desc');
  const today = dkey(); const ws = weekStart(today);
  const t = recStats(subs.docs, [], P.uid, today, today), w = recStats(subs.docs, [], P.uid, ws, addDays(ws, 6));
  const o = ov.data || {};
  return html`<section className="panel stack" style=${{ gap: 12 }}>
    <div className="ph-row"><h2 className="ph">Bench sales</h2><div className="actions" style=${{ flexWrap: 'nowrap' }}><a className="btn sm" href="#/portal/jobs/grab"><${Icon} n="search" />Grab jobs</a><a className="btn ghost sm" href="#/portal/rec/submissions"><${Icon} n="send" />Log submission</a></div></div>
    <div className="kpis" style=${{ gridTemplateColumns: 'repeat(4,minmax(0,1fr))' }}>
      <a href="#/portal/jobs/grab"><b>${ov.error ? '—' : ov.data ? o.jobs : '…'}</b><span>Jobs collected${o.jobs_7d ? ` (${o.jobs_7d} this week)` : ''}</span></a>
      <a href="#/portal/jobs/consultants"><b>${ov.error ? '—' : ov.data ? o.consultants_with_resume : '…'}</b><span>Consultants with a resume</span></a>
      <a href="#/portal/rec/submissions"><b>${t.rtr}<span style=${{ fontSize: 16, fontWeight: 600 }}> RTR / ${t.subs} sub</span></b><span>Today</span></a>
      <a href="#/portal/rec/submissions"><b>${w.rtr}<span style=${{ fontSize: 16, fontWeight: 600 }}> RTR / ${w.subs} sub</span></b><span>This week${w.intv ? `, ${w.intv} interview${w.intv === 1 ? '' : 's'}` : ''}</span></a>
    </div>
    <p className="muted small" style=${{ margin: 0 }}>Grab jobs by keyword, then use <b>Submit consultant</b> on any posting to send the right resume and log the submission in one click. ${o.last_run ? `Last job collection ${fmtTs(o.last_run.finished_at || o.last_run.started_at)}.` : ''}</p>
  </section>`;
}

/* ---------- consultant: jobs StratEdge sent directly ---------- */
const JobsTabs = ({ tab, setTab, counts }) => html`<div className="tabs" role="tablist">${[...Object.entries(MATCH_STATES), ['sent', 'Sent to you']].map(([k, v]) => html`<button key=${k} type="button" role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${v}<span className=${'chip' + (k === 'sent' && counts.sent ? ' amber' : '')}>${counts[k] || 0}</span></button>`)}</div>`;
function SentToMe({ docs, loading }) {
  if (loading) return html`<${Spinner} />`;
  if (!docs.length) return html`<div className="panel"><${Empty} title="Nothing sent to you yet">When a StratEdge recruiter sends you a role, it appears here and in your email.<//></div>`;
  return html`<div className="matches">${docs.map(j => html`<div key=${j.id} className="match">
    <div style=${{ minWidth: 0 }}><h3><a href=${'#/careers/' + j.id}>${j.ti}</a></h3>
      <div className="muted">${[j.loc, j.ty, j.md].filter(Boolean).join(' · ')}</div>
      <div className="reasons">Sent by ${j.byn || 'StratEdge'} ${fmtTs(j.at)}${j.msg ? html`<br /><i>“${j.msg}”</i>` : ''}</div>
      ${j.sk && html`<div className="meta">${j.sk.split(/,\s*/).filter(Boolean).slice(0, 8).map(s => html`<${Chip} key=${s}>${s}<//>`)}</div>`}</div>
    <div className="actions" style=${{ justifyContent: 'flex-end' }}><a className="btn sm" href=${'#/careers/' + j.id}>View and apply</a><${ShareButton} job=${j} small=${true} /></div>
  </div>`)}</div>`;
}

/* ---------- staff: send a Careers job to people by email ---------- */
function SendJobButton({ jobId, job, small, label }) {
  const [open, setOpen] = useState(false);
  return html`<${Fragment}><button type="button" className=${'btn' + (small ? ' sm' : '')} onClick=${() => setOpen(true)}><${Icon} n="send" />${label || 'Send to people'}</button>
    ${open && html`<${SendJobModal} jobId=${jobId || job.id} onClose=${() => setOpen(false)} />`}<//>`;
}
const RECIP_GROUPS = [['portal', 'Portal consultants'], ['rec', 'Recruiting database'], ['ats', 'Candidates (ATS)'], ['other', 'Other emails']];
function SendJobModal({ jobId, onClose }) {
  const P = usePortal(); const toast = useToast();
  const jd = useDoc(`org/site/jobs/${jobId}`);
  const rec = useJobsApi('job_recipients');
  const [grp, setGrp] = useState('portal'); const [q, setQ] = useState('');
  const [picked, setPicked] = useState({}); const [other, setOther] = useState('');
  const [subject, setSubject] = useState(''); const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false); const [done, setDone] = useState(null);
  const job = jd.data;
  useEffect(() => { if (job && !subject) { setSubject(`Job opportunity: ${job.ti} at StratEdge IT Consulting`); setMsg(`We have an opening that looks like a fit for you: ${job.ti}${job.loc ? ' in ' + job.loc : ''}${job.ty ? ' (' + job.ty + ')' : ''}. Take a look and apply if you are interested, or reply to this email with any questions.`); } }, [job]);
  if (jd.loading) return html`<${Modal} title="Send job" onClose=${onClose}><${Spinner} /><//>`;
  if (!job) return html`<${Modal} title="Send job" onClose=${onClose}><p className="muted">This job is no longer on the Careers page.</p><//>`;
  const groups = rec.data || { portal: [], rec: [], ats: [] };
  const key = (g, x) => g + ':' + (x.uid || x.id || x.e);
  const list = (groups[grp] || []).filter(x => { const ql = q.trim().toLowerCase(); return !ql || [x.n, x.e, x.ti, x.loc, x.sk].filter(Boolean).join(' ').toLowerCase().includes(ql); });
  const toggle = (g, x) => setPicked(p => { const k = key(g, x); const n = { ...p }; if (n[k]) delete n[k]; else n[k] = { n: x.n, e: x.e, uid: x.uid || '' }; return n; });
  const allVisible = () => setPicked(p => { const n = { ...p }; list.forEach(x => { n[key(grp, x)] = { n: x.n, e: x.e, uid: x.uid || '' }; }); return n; });
  const extra = other.split(/[,;\s]+/).map(e => e.trim()).filter(e => /^\S+@\S+\.\S+$/.test(e)).map(e => ({ n: '', e }));
  const recipients = [...Object.values(picked), ...extra];
  const send = async () => {
    if (!recipients.length) { toast('Pick at least one person or type an email address.', true); return; }
    setBusy(true);
    try { const r = await api('job_send', { id: jobId, to: recipients, subject, message: msg }); setDone(r); toast(`Sent to ${r.sent} ${r.sent === 1 ? 'person' : 'people'}.`); }
    catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  const sentLog = (job.sent || []).slice().reverse();
  const foot = done ? html`<button className="btn" type="button" onClick=${onClose}>Done</button>` : html`<button className="btn ghost" type="button" onClick=${onClose}>Cancel</button><button className="btn" type="button" disabled=${busy || !recipients.length} onClick=${send}><${Icon} n="send" />${busy ? 'Sending…' : `Send to ${recipients.length || ''} ${recipients.length === 1 ? 'person' : 'people'}`}</button>`;
  return html`<${Modal} wide title=${'Send: ' + job.ti} onClose=${onClose} foot=${foot}>
    ${done ? html`<div className="stack">
        <div className="note ok"><span><b>Sent to ${done.sent} ${done.sent === 1 ? 'person' : 'people'}.</b> Each email has the job details and a "View and apply" button; replies come to ${P.caps.me.email}. Portal consultants also see it under Matched jobs › Sent to you.</span></div>
        ${done.failed.length ? html`<div className="note red"><span>Could not deliver to: ${done.failed.join(', ')}. Check the outgoing mail settings in api/config.php (storage/mail.log has details).</span></div>` : ''}
      </div>`
      : html`<div className="g2" style=${{ alignItems: 'start' }}>
      <div className="stack" style=${{ gap: 10 }}>
        <div className="tabs" role="tablist" style=${{ marginBottom: 0 }}>${RECIP_GROUPS.map(([k, v]) => html`<button key=${k} type="button" role="tab" aria-selected=${grp === k} className=${grp === k ? 'on' : ''} onClick=${() => setGrp(k)}>${v}${k !== 'other' ? html`<span className="chip">${(groups[k] || []).length}</span>` : ''}</button>`)}</div>
        ${grp === 'other' ? html`<${Field} label="Email addresses" hint="Comma- or line-separated. Anyone: vendors, referrals, past candidates."><textarea value=${other} onInput=${e => setOther(e.target.value)} rows="5" placeholder="name@example.com, other@example.com" /><//>`
          : html`<${Fragment}>
            <div className="toolbar" style=${{ margin: 0 }}><input type="search" placeholder="Search name, email, title, skills" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Search people" />${list.length > 1 && html`<button className="btn ghost sm" type="button" onClick=${allVisible}>Select all ${list.length}</button>`}</div>
            <div className="picklist">${rec.loading && !rec.data ? html`<${Spinner} />` : list.length ? list.map(x => { const k = key(grp, x); return html`<label key=${k} className=${'pick' + (picked[k] ? ' on' : '')}><input type="checkbox" checked=${!!picked[k]} onChange=${() => toggle(grp, x)} /><span><b>${x.n || x.e}</b><small>${[x.e, x.ti, x.loc, x.st].filter(Boolean).join(' · ')}</small></span></label>`; })
              : html`<p className="muted small" style=${{ padding: 10 }}>${grp === 'portal' ? 'No approved consultants with an email yet.' : grp === 'rec' ? 'No consultants with an email in the recruiting database.' : 'No candidates with an email in the ATS.'}</p>`}</div>
          <//>`}
        ${recipients.length ? html`<div className="meta" style=${{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>${recipients.slice(0, 12).map(r => html`<${Chip} key=${r.e} s="ok">${r.n || r.e}<//>`)}${recipients.length > 12 ? html`<span className="muted small">+${recipients.length - 12} more</span>` : ''}</div>` : ''}
      </div>
      <div className="form">
        <${Field} label="Subject"><input value=${subject} onInput=${e => setSubject(e.target.value)} /><//>
        <${Field} label="Message" hint="The job title, location, engagement, skills, description and a View-and-apply link are added below your message."><textarea value=${msg} onInput=${e => setMsg(e.target.value)} rows="6" /><//>
        <dl className="kv small"><dt>Job</dt><dd>${job.ti}${job.loc ? ', ' + job.loc : ''}</dd><dt>Link</dt><dd><a href=${'#/careers/' + jobId} target="_blank" rel="noopener">${jobLink(jobId)}</a></dd><dt>Replies go to</dt><dd>${P.caps.me.email}</dd></dl>
        ${sentLog.length ? html`<details><summary className="muted small">Sent before (${job.sentN || 0} ${job.sentN === 1 ? 'person' : 'people'})</summary><ul className="list small">${sentLog.slice(0, 8).map((s, i) => html`<li key=${i}><div><div className="t">${s.n} by ${s.byn}, ${fmtTs(s.t)}</div><div className="m">${(s.to || []).join(', ')}</div></div></li>`)}</ul></details>` : ''}
      </div>
    </div>`}
  <//>`;
}

/* ================= HR portal ================= */
const tplItems = (tpl, kind) => ((tpl && tpl[kind]) && tpl[kind].length ? tpl[kind] : (kind === 'off' ? OFF_DEFAULT : ONB_DEFAULT));
const onbProgress = (onb, tpl) => { const items = tplItems(tpl, onb.kind || 'onb'); const st = onb.items || {}; const done = items.filter(i => ['verified', 'na'].includes((st[i.id] || {}).s)).length; return { done, total: items.length, items }; };
function useAllFiles(members, tick) {
  const [files, setFiles] = useState(null);
  const ids = members.map(m => m.id).join(',');
  useEffect(() => { let live = true; setFiles(null); pMap(members, 4, m => dbList(`u/${m.id}/f`).catch(() => [])).then(lists => { if (!live) return; const out = []; members.forEach((m, i) => lists[i].forEach(f => out.push({ ...f, m }))); setFiles(out.sort((a, b) => (b.at || 0) - (a.at || 0))); }); return () => { live = false; }; }, [ids, tick]);
  return files;
}
const employeesOf = A => A.members.filter(m => m.role !== 'employer' && m.st !== 'new');

function HROverview() {
  const P = usePortal(); const A = P.admin;
  const eod = useCol('rec/eod/items', 'd:desc', 40);
  const emps = employeesOf(A);
  const onb = emps.filter(m => m.r && m.r.onb && m.r.onb.kind !== 'done');
  const today = dkey();
  if (A.loading) return html`<${Spinner} />`;
  const pending = onb.map(m => { const p = onbProgress(m.r.onb, P.tpl); return { m, p }; });
  const awaiting = pending.reduce((s, x) => s + Object.values(x.m.r.onb.items || {}).filter(i => i.s === 'received').length, 0);
  return html`<div className="stack">
    <div className="kpis">
      <a href="#/portal/hr/onboarding"><b>${pending.length}</b><span>Onboardings in progress</span></a>
      <a href="#/portal/hr/onboarding"><b>${awaiting}</b><span>Items to verify</span></a>
      <a href="#/portal/admin/approvals?tab=leave"><b>${A.pendLv.length}</b><span>Time-off requests</span></a>
      <a href="#/portal/hr/reports"><b>${eod.docs.filter(r => r.d === today).length}</b><span>Daily reports today</span></a>
      <a href="#/portal/admin/team?tab=new"><b>${A.requests.length}</b><span>Access requests</span></a>
    </div>
    <div className="g2" style=${{ alignItems: 'start' }}>
      <section className="panel"><div className="ph-row"><h2 className="ph">Onboarding in progress</h2><a className="small" href="#/portal/hr/onboarding">All onboarding</a></div>
        ${pending.length ? html`<ul className="list">${pending.slice(0, 6).map(({ m, p }) => html`<li key=${m.id}><${Person} uid=${m.id} root=${m.u} people=${P.people} sub=${(m.r.onb.kind === 'off' ? 'Offboarding' : 'Onboarding') + ', started ' + fmtDay(m.r.onb.started)} /><${Chip} s=${p.done === p.total ? 'ok' : 'amber'}>${p.done} / ${p.total}<//></li>`)}</ul>`
          : html`<${Empty} title="Nobody is being onboarded right now">Start a checklist from Onboarding, or from a person's card under Team.<//>`}</section>
      <section className="panel"><div className="ph-row"><h2 className="ph">Today\u2019s recruiting reports</h2><a className="small" href="#/portal/hr/reports">All reports</a></div>
        ${eod.docs.filter(r => r.d === today).length ? html`<ul className="list">${eod.docs.filter(r => r.d === today).map(r => html`<li key=${r.id}><div><div className="t">${r.n}</div><div className="m">${r.rtr} RTR, ${r.subs} submissions, ${r.cands} consultants added</div></div><span className="muted small num">${fmtTime(r.at)}</span></li>`)}</ul>`
          : html`<${Empty} title="No reports yet today">Recruiters send their end-of-day report with one click; it lands here and in the admin portal.<//>`}</section>
    </div>
  </div>`;
}

/* ---- Onboarding ---- */
function OnboardingModal({ m, onClose }) {
  const P = usePortal(); const toast = useToast();
  const onb = m.r.onb; const { items } = onbProgress(onb, P.tpl);
  const [st, setSt] = useState(onb.items || {}); const [busy, setBusy] = useState(false);
  const files = useCol(`u/${m.id}/f`, 'at:desc');
  const upFor = id => (m.u.onbUp || {})[id];
  const fileOf = fid => files.docs.find(f => f.id === fid);
  const set = (id, patch) => setSt({ ...st, [id]: { ...(st[id] || {}), ...patch, at: Date.now(), by: P.uid } });
  const save = async (finish) => {
    setBusy(true);
    try { await dbMerge(`r/${m.id}`, { onb: { items: st, ...(finish ? { kind: 'done', finished: Date.now(), was: onb.kind } : {}) } }); toast(finish ? 'Checklist completed.' : 'Checklist saved.'); if (finish) onClose(); }
    catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  const done = items.filter(i => ['verified', 'na'].includes((st[i.id] || {}).s)).length;
  return html`<${Modal} wide title=${`${onb.kind === 'off' ? 'Offboarding' : 'Onboarding'}: ${m.u.p.n}`} onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Close</button><button type="button" className="btn ghost" disabled=${busy} onClick=${() => save(false)}>Save</button><button type="button" className="btn go" disabled=${busy || done < items.length} onClick=${() => save(true)}>Mark complete</button>`}>
    <div className="stack">
      <div className="actions"><${Chip} s=${done === items.length ? 'ok' : 'amber'}>${done} of ${items.length} done<//><span className="muted small">Started ${fmtDay(onb.started)}. ${m.u.p.e}${m.u.p.ph ? ', ' + m.u.p.ph : ''}</span></div>
      <div className="tblwrap"><table className="tbl"><thead><tr><th>Item</th><th>Document</th><th>Status</th><th>Note</th></tr></thead>
        <tbody>${items.map(i => { const s = st[i.id] || {}; const fid = upFor(i.id); const f = fid && fileOf(fid); return html`<tr key=${i.id}>
          <td><b style=${{ fontWeight: 600 }}>${i.n}</b>${i.d && html`<div className="muted small">${i.d}</div>`}</td>
          <td>${i.doc ? (f ? html`<div className="actions" style=${{ flexWrap: 'nowrap' }}><span className="small">${f.n}</span><${FileActions} base=${'u/' + m.id} f=${f} /></div>` : fid ? html`<span className="muted small">Uploaded (loading…)</span>` : html`<span className="muted small">Not uploaded yet</span>`) : html`<span className="muted small">—</span>`}</td>
          <td><select value=${s.s || (f ? 'received' : 'pending')} onChange=${e => set(i.id, { s: e.target.value, fid: fid || s.fid || null })}>${Object.entries(ONB_ST).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select></td>
          <td><input value=${s.n || ''} onInput=${e => set(i.id, { n: e.target.value })} placeholder="Optional" /></td></tr>`; })}</tbody></table></div>
      <p className="muted small">Employees upload documents against each item from their Onboarding page. Mark an item Verified once you've checked it, or Not needed if it doesn't apply.</p>
    </div><//>`;
}
function HROnboarding() {
  const P = usePortal(); const A = P.admin; const toast = useToast();
  const [open, setOpen] = useState(null); const [start, setStart] = useState(false); const [who, setWho] = useState(''); const [kind, setKind] = useState('onb'); const [tab, setTab] = useState('active');
  if (A.loading) return html`<${Spinner} />`;
  const emps = employeesOf(A);
  const rows = emps.filter(m => m.r && m.r.onb).map(m => ({ m, p: onbProgress(m.r.onb, P.tpl), done: m.r.onb.kind === 'done' })).filter(r => tab === 'all' || (tab === 'done' ? r.done : !r.done));
  const startNow = async () => {
    if (!who) { toast('Choose a person.', true); return; }
    try { await dbMerge(`r/${who}`, { onb: { kind, started: Date.now(), items: {}, by: P.uid } }); toast('Checklist started. The employee sees it in their portal.'); setStart(false); setWho(''); }
    catch (e) { toast(errText(e), true); }
  };
  const cur = open && emps.find(m => m.id === open);
  return html`<div className="stack">
    <div className="toolbar"><div className="tabs" role="tablist" style=${{ marginBottom: 0, border: 0 }}>${[['active', 'In progress'], ['done', 'Completed'], ['all', 'All']].map(([k, v]) => html`<button type="button" key=${k} role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${v}</button>`)}</div>
      <div className="push"><a className="btn ghost" href="#/portal/hr/policies">Edit checklist template</a><button type="button" className="btn" onClick=${() => setStart(true)}><${Icon} n="plus" />Start a checklist</button></div></div>
    ${start && html`<section className="panel form"><h2 className="ph">Start onboarding or offboarding</h2>
      <div className="row2"><${Field} label="Person"><select value=${who} onChange=${e => setWho(e.target.value)}><option value="">Choose…</option>${emps.map(m => html`<option key=${m.id} value=${m.id}>${m.u.p.n}${m.r && m.r.cl ? ' (' + m.r.cl + ')' : ''}</option>`)}</select><//>
        <${Field} label="Checklist"><select value=${kind} onChange=${e => setKind(e.target.value)}><option value="onb">Onboarding</option><option value="off">Offboarding</option></select><//></div>
      <div className="actions"><button type="button" className="btn" onClick=${startNow}>Start</button><button type="button" className="btn ghost" onClick=${() => setStart(false)}>Cancel</button></div></section>`}
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${rows.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Person</th><th>Checklist</th><th>Started</th><th>Progress</th><th /></tr></thead>
        <tbody>${rows.map(({ m, p, done }) => html`<tr key=${m.id} className="click" tabIndex="0" onClick=${() => !done && setOpen(m.id)}>
          <td><${Person} uid=${m.id} root=${m.u} people=${P.people} sub=${m.r.cl || m.u.p.ti} /></td><td>${done ? (m.r.onb.was === 'off' ? 'Offboarding' : 'Onboarding') + ', completed' : m.r.onb.kind === 'off' ? 'Offboarding' : 'Onboarding'}</td><td className="num">${fmtDay(m.r.onb.started)}</td>
          <td>${done ? html`<${Chip} s="ok">Complete<//>` : html`<${Chip} s=${p.done === p.total ? 'ok' : 'amber'}>${p.done} / ${p.total}<//>`}</td><td className="r">${!done && html`<button className="btn ghost sm">Open</button>`}</td></tr>`)}</tbody></table></div>`
        : html`<${Empty} title=${tab === 'done' ? 'No completed checklists yet' : 'No checklists in progress'}>Start one for a new hire. They see the list of documents to upload in their portal, and you verify each item here.<//>`}
    </section>
    ${cur && cur.r.onb && html`<${OnboardingModal} key=${cur.id} m=${cur} onClose=${() => setOpen(null)} />`}
  </div>`;
}

/* ---- Document checks ---- */
function HRVerify() {
  const P = usePortal(); const A = P.admin; const toast = useToast();
  const [tick, setTick] = useState(0); const [tab, setTab] = useState('pending');
  const emps = employeesOf(A);
  const files = useAllFiles(emps, tick);
  const decide = async (f, s) => { const note = s === 'rejected' ? prompt('What should they fix?') : ''; if (s === 'rejected' && note === null) return; try { await dbMerge(`u/${f.m.id}/f/${f.id}`, { vf: { s, n: note || '', at: Date.now(), by: P.uid } }); setTick(t => t + 1); toast(s === 'verified' ? 'Marked verified.' : 'Sent back to the employee.'); } catch (e) { toast(errText(e), true); } };
  if (A.loading || !files) return html`<${Spinner} />`;
  const list = files.filter(f => !f.w).filter(f => tab === 'all' || (tab === 'pending' ? !f.vf : (f.vf && f.vf.s === tab)));
  return html`<div className="stack">
    <div className="tabs" role="tablist">${[['pending', 'To check', files.filter(f => !f.w && !f.vf).length], ['verified', 'Verified', null], ['rejected', 'Sent back', null], ['all', 'All', null]].map(([k, v, n]) => html`<button type="button" key=${k} role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${v}${n != null && html`<span className=${'chip' + (n ? ' amber' : '')}>${n}</span>`}</button>`)}</div>
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${list.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Person</th><th>Document</th><th>Type</th><th>Uploaded</th><th>Status</th><th /></tr></thead>
        <tbody>${list.map(f => html`<tr key=${f.m.id + f.id}><td><${Person} uid=${f.m.id} root=${f.m.u} people=${P.people} /></td><td><b style=${{ fontWeight: 600 }}>${f.n}</b>${f.item && html`<div className="muted small">Onboarding item</div>`}</td><td>${DOC_CATS[f.c] || (f.c === 'onboarding' ? 'Onboarding' : 'Other')}</td><td className="num">${fmtDay(f.at)}</td>
          <td>${f.vf ? html`<${Chip} s=${f.vf.s === 'verified' ? 'ok' : 'red'}>${f.vf.s === 'verified' ? 'Verified' : 'Sent back'}<//>` : html`<${Chip} s="amber">To check<//>`}</td>
          <td className="r"><div className="actions" style=${{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}><${FileActions} base=${'u/' + f.m.id} f=${f} />${(!f.vf || f.vf.s !== 'verified') && html`<button type="button" className="btn go sm" onClick=${() => decide(f, 'verified')}>Verify</button>`}${(!f.vf || f.vf.s !== 'rejected') && html`<button type="button" className="btn ghost sm" onClick=${() => decide(f, 'rejected')}>Send back</button>`}</div></td></tr>`)}</tbody></table></div>`
        : html`<${Empty} title="Nothing to check">Documents employees upload (agreements, tax forms, insurance, onboarding items) appear here for verification.<//>`}
    </section>
  </div>`;
}

/* ---- Policies, templates and the checklist template ---- */
function HRPolicies() {
  const P = usePortal(); const toast = useToast();
  const files = useCol('org/hr/f', 'at:desc');
  const [cat, setCat] = useState('handbook'); const [busy, setBusy] = useState(false); const [prog, setProg] = useState(0);
  const [kind, setKind] = useState('onb'); const [items, setItems] = useState(null);
  const cur = items || tplItems(P.tpl, kind);
  const onFiles = async fs => { setBusy(true); try { for (const f of fs) { setProg(0.03); await storeFile('org/hr', f, { c: cat }, setProg); } toast('Document published to all employees.'); } catch (e) { toast(errText(e), true); } setBusy(false); };
  const del = async f => { try { await deleteStored('org/hr', f.id); toast('Removed.'); } catch (e) { toast(errText(e), true); } };
  const saveTpl = async () => { try { await dbMerge('org/hr/x/tpl', { [kind]: cur.filter(i => i.n && i.n.trim()).map((i, idx) => ({ id: i.id || nid(), n: i.n.trim(), d: (i.d || '').trim(), doc: !!i.doc })) }); setItems(null); toast('Checklist template saved. New checklists use it.'); } catch (e) { toast(errText(e), true); } };
  const setItem = (idx, patch) => setItems(cur.map((i, j) => j === idx ? { ...i, ...patch } : i));
  return html`<div className="stack">
    <section className="panel stack" style=${{ gap: 14 }}>
      <div><h2 className="ph">Policies, handbook and templates</h2><p className="muted small" style=${{ marginTop: 4 }}>Everything uploaded here is visible to all employees under Policies. Templates (offer letter, NDA, forms) can be downloaded and filled in.</p></div>
      <div style=${{ maxWidth: 360 }}><${Field} label="Document type"><select value=${cat} onChange=${e => setCat(e.target.value)}>${Object.entries(POLICY_CATS).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//></div>
      <${FilePick} busy=${busy} progress=${prog} onFiles=${onFiles} />
      ${files.docs.length ? html`<ul className="files">${files.docs.map(f => html`<li key=${f.id}><${Icon} n="file" /><div className="fn"><b>${f.n}</b><span>${POLICY_CATS[f.c] || 'Other'}, ${fmtDay(f.at)}, ${sizeLabel(f.sz)}</span></div><${FileActions} base="org/hr" f=${f} onDelete=${() => del(f)} /></li>`)}</ul>` : html`<p className="muted small">No documents published yet.</p>`}
    </section>
    <section className="panel stack" style=${{ gap: 14 }}>
      <div className="ph-row"><div><h2 className="ph">Checklist template</h2><p className="muted small" style=${{ marginTop: 4 }}>The items every new ${kind === 'off' ? 'offboarding' : 'onboarding'} checklist starts with.</p></div>
        <div className="seg" style=${{ marginBottom: 0 }}>${[['onb', 'Onboarding'], ['off', 'Offboarding']].map(([k, v]) => html`<button type="button" key=${k} className=${kind === k ? 'on' : ''} onClick=${() => { setKind(k); setItems(null); }}>${v}</button>`)}</div></div>
      <div className="stack" style=${{ gap: 8 }}>${cur.map((i, idx) => html`<div key=${i.id || idx} style=${{ display: 'grid', gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,2fr) auto auto', gap: 8, alignItems: 'end' }}>
        <${Field} label="Item"><input value=${i.n} onInput=${e => setItem(idx, { n: e.target.value })} /><//><${Field} label="Description"><input value=${i.d || ''} onInput=${e => setItem(idx, { d: e.target.value })} /><//>
        <label className="check" style=${{ paddingBottom: 12, whiteSpace: 'nowrap' }}><input type="checkbox" checked=${!!i.doc} onChange=${e => setItem(idx, { doc: e.target.checked })} /><span>Needs a document</span></label>
        <button type="button" className="btn ghost icon" aria-label="Remove" onClick=${() => setItems(cur.filter((_, j) => j !== idx))}><${Icon} n="trash" /></button></div>`)}
        <div className="actions"><button type="button" className="btn ghost sm" onClick=${() => setItems([...cur, { id: nid(), n: '', d: '', doc: true }])}><${Icon} n="plus" />Add item</button><button type="button" className="btn" disabled=${!items} onClick=${saveTpl}>Save template</button></div></div>
    </section>
  </div>`;
}

/* ---- Directory ---- */
function HRDirectory() {
  const P = usePortal(); const A = P.admin; const toast = useToast();
  const [q, setQ] = useState('');
  if (A.loading) return html`<${Spinner} />`;
  const ql = q.trim().toLowerCase();
  const rows = A.members.filter(m => m.st !== 'new' && (!ql || [m.u.p.n, m.u.p.e, m.u.p.ti, m.u.p.loc, m.r && m.r.cl, m.u.p.co].filter(Boolean).join(' ').toLowerCase().includes(ql)));
  const exp = async () => { try { await saveDownload('directory.csv', toCSV([['Name', 'Email', 'Phone', 'Title', 'Portal', 'Status', 'Client', 'End client', 'Engagement', 'Start date', 'Location'], ...rows.map(m => [m.u.p.n, m.u.p.e, m.u.p.ph || '', m.u.p.ti || '', m.role === 'employer' ? 'Client' : m.role === 'bench' ? 'Bench sales' : m.role === 'consultant' ? 'Consultant' : 'Employee', m.st, (m.r && m.r.cl) || m.u.p.co || '', (m.r && m.r.ec) || '', (m.r && m.r.ty) || '', (m.r && m.r.sd) || '', m.u.p.loc || ''])])); } catch (e) { if (!e || e.code !== 'declined') toast(errText(e), true); } };
  return html`<div className="stack">
    <div className="toolbar"><input type="search" style=${{ maxWidth: 320 }} placeholder="Search people" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Search directory" /><div className="push"><button type="button" className="btn ghost" onClick=${exp}><${Icon} n="down" />Export CSV</button></div></div>
    <section className="panel" style=${{ padding: '6px 8px' }}><div className="tblwrap"><table className="tbl"><thead><tr><th>Person</th><th>Contact</th><th>Portal</th><th>Client</th><th>Engagement</th><th>Start</th><th>Location</th></tr></thead>
      <tbody>${rows.map(m => html`<tr key=${m.id}><td><${Person} uid=${m.id} root=${m.u} people=${P.people} sub=${m.u.p.ti} /></td><td className="small"><a href=${'mailto:' + m.u.p.e}>${m.u.p.e}</a>${m.u.p.ph ? html`<div>${m.u.p.ph}</div>` : ''}</td><td>${m.role === 'employer' ? 'Client' : m.role === 'bench' ? 'Bench sales' : m.role === 'consultant' ? 'Consultant' : 'Employee'}${m.st === 'inactive' ? html` <${Chip} s="inactive">Inactive<//>` : ''}</td>
        <td>${(m.r && m.r.cl) || m.u.p.co || '—'}</td><td>${(m.r && m.r.ty) || '—'}</td><td className="num">${m.r && m.r.sd ? fmtDate(m.r.sd, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td><td>${m.u.p.loc || '—'}</td></tr>`)}</tbody></table></div></section>
  </div>`;
}

/* ---- Recruiting overview (HR and admin): counts, details, daily reports ---- */
function Recruiting() {
  const P = usePortal(); const A = P.admin; const toast = useToast();
  const subs = useCol('rec/sub/items', 'd:desc'); const cands = useCol('rec/cand/items', 'u:desc'); const eod = useCol('rec/eod/items', 'd:desc', 200);
  const [tab, setTab] = useState('overview'); const [range, setRange] = useState('week'); const [open, setOpen] = useState(undefined); const [openSub, setOpenSub] = useState(undefined); const [rep, setRep] = useState(null);
  const today = dkey(); const ws = weekStart(today); const mk = mkey(today);
  const [a, b] = range === 'today' ? [today, today] : range === 'week' ? [ws, addDays(ws, 6)] : [mk + '-01', mk + '-31'];
  const active = new Set([...subs.docs.map(s => s.by), ...cands.docs.map(c => c.by), ...eod.docs.map(r => r.uid)].filter(Boolean));
  const recruiters = A.members.filter(m => m.role !== 'employer' && m.st === 'active' && !(m.r && m.r.norec) || active.has(m.id));
  const names = {}; [...subs.docs, ...cands.docs].forEach(x => { if (x.by && x.byn) names[x.by] = x.byn; }); eod.docs.forEach(r => { if (r.uid && r.n) names[r.uid] = r.n; });
  const extra = [...active].filter(id => !recruiters.some(m => m.id === id)).map(id => ({ id, u: null, name: names[id] || 'Staff' }));
  const byRec = [...recruiters, ...extra].map(m => ({ m, s: recStats(subs.docs, cands.docs, m.id, a, b), last: eod.docs.find(r => r.uid === m.id) }));
  const tot = recStats(subs.docs, cands.docs, null, a, b);
  const exp = async () => { try { await saveDownload(`recruiting_${a}_to_${b}.csv`, toCSV([['Recruiter', 'Consultants added', 'RTRs', 'Submissions', 'Interviews', 'Placed'], ...byRec.map(r => [r.m.u.p.n, r.s.cands, r.s.rtr, r.s.subs, r.s.intv, r.s.placed]), ['All', tot.cands, tot.rtr, tot.subs, tot.intv, tot.placed]])); } catch (e) { if (!e || e.code !== 'declined') toast(errText(e), true); } };
  const curC = open && cands.docs.find(c => c.id === open); const curS = openSub && subs.docs.find(s => s.id === openSub);
  return html`<div className="stack">
    <div className="toolbar"><div className="tabs" role="tablist" style=${{ marginBottom: 0, border: 0 }}>${[['overview', 'Overview'], ['subs', 'Submissions'], ['cands', 'Consultants'], ['eod', 'Daily reports']].map(([k, v]) => html`<button type="button" key=${k} role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${v}</button>`)}</div>
      <div className="push"><div className="seg" style=${{ marginBottom: 0 }}>${[['today', 'Today'], ['week', 'This week'], ['month', 'This month']].map(([k, v]) => html`<button type="button" key=${k} className=${range === k ? 'on' : ''} onClick=${() => setRange(k)}>${v}</button>`)}</div><button type="button" className="btn ghost" onClick=${exp}><${Icon} n="down" />CSV</button><button type="button" className="btn ghost" onClick=${() => setOpen(null)}><${Icon} n="plus" />Add consultant</button><button type="button" className="btn" onClick=${() => setOpenSub(null)}><${Icon} n="plus" />Log submission</button></div></div>
    <div className="kpis">
      <a><b>${tot.rtr}</b><span>RTRs received</span></a><a><b>${tot.subs}</b><span>Submissions</span></a><a><b>${tot.intv}</b><span>Interviews</span></a><a><b>${tot.placed}</b><span>Placed</span></a><a><b>${tot.cands}</b><span>Consultants added</span></a></div>
    ${tab === 'overview' && html`<section className="panel" style=${{ padding: '6px 8px' }}>
      ${recruiters.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Recruiter</th><th className="r">Consultants added</th><th className="r">RTRs</th><th className="r">Submissions</th><th className="r">Interviews</th><th className="r">Placed</th><th>Last daily report</th></tr></thead>
        <tbody>${byRec.map(r => html`<tr key=${r.m.id}><td>${r.m.u ? html`<${Person} uid=${r.m.id} root=${r.m.u} people=${P.people} />` : html`<b style=${{ fontWeight: 600 }}>${r.m.name}</b><div className="muted small">Staff account</div>`}</td><td className="r num">${r.s.cands}</td><td className="r num"><b>${r.s.rtr}</b></td><td className="r num"><b>${r.s.subs}</b></td><td className="r num">${r.s.intv}</td><td className="r num">${r.s.placed}</td>
          <td>${r.last ? html`<${Chip} s=${r.last.d === today ? 'ok' : 'amber'}>${fmtDate(r.last.d, { month: 'short', day: 'numeric' })}<//>` : html`<span className="muted small">None yet</span>`}</td></tr>`)}</tbody></table></div>`
        : html`<${Empty} title="No activity yet">Everyone on the team can add consultants and log RTRs and submissions from their portal; you can add them here too. Each entry shows who added it.<//>`}</section>`}
    ${tab === 'subs' && html`<section className="panel" style=${{ padding: '6px 8px' }}>${subs.docs.filter(s => inRange(s.d, a, b)).length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Date</th><th>Consultant</th><th>Requirement</th><th>Vendor / client</th><th>RTR</th><th>Status</th><th>Recruiter</th></tr></thead>
      <tbody>${subs.docs.filter(s => inRange(s.d, a, b)).map(s => html`<tr key=${s.id} className="click" tabIndex="0" onClick=${() => setOpenSub(s.id)}><td className="num nw">${fmtDate(s.d)}</td><td><b style=${{ fontWeight: 600 }}>${s.cn}</b></td><td>${s.req}</td><td>${s.vn}${s.ec ? html`<div className="muted small">${s.ec}</div>` : ''}${s.rn || s.rp ? html`<div className="muted small">${[s.rn, s.rp].filter(Boolean).join(' · ')}</div>` : ''}</td><td>${s.rtr ? html`<${Chip} s="ok">Yes<//>` : html`<span className="muted small">No</span>`}</td><td><${Chip} s=${s.st === 'placed' ? 'ok' : s.st === 'rejected' ? 'red' : 'amber'}>${SUB_ST[s.st] || s.st}<//></td><td className="small">${s.byn}</td></tr>`)}</tbody></table></div>` : html`<${Empty} title="No submissions in this range" />`}</section>`}
    ${tab === 'cands' && html`<section className="panel" style=${{ padding: '6px 8px' }}>${cands.docs.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Consultant</th><th>Skills</th><th>Authorization</th><th>Location</th><th>Rate</th><th>Status</th><th>Recruiter</th></tr></thead>
      <tbody>${cands.docs.map(c => { const mine = subs.docs.filter(s => s.cid === c.id); const who = [...new Set(mine.map(s => s.byn).filter(Boolean))]; return html`<tr key=${c.id} className="click" tabIndex="0" onClick=${() => setOpen(c.id)}><td><b style=${{ fontWeight: 600 }}>${c.n}</b><div className="muted small">${c.ti}${c.emp ? ' · ' + c.emp : ''}</div></td><td className="small">${c.sk || '—'}</td><td>${c.auth || '—'}</td><td>${c.loc || '—'}</td><td>${c.rate || '—'}</td><td><${Chip} s=${c.st === 'placed' ? 'ok' : c.st === 'inactive' ? '' : 'new'}>${CAND_STATUS[c.st] || c.st}<//>${mine.length ? html`<div className="muted small">${mine.filter(s => s.rtr).length} RTR · ${mine.length} sub${who.length ? ' by ' + who.join(', ') : ''}</div>` : ''}</td><td className="small">${c.byn}</td></tr>`; })}</tbody></table></div>` : html`<${Empty} title="No consultants added yet" action=${html`<button type="button" className="btn" onClick=${() => setOpen(null)}>Add a consultant</button>`} />`}</section>`}
    ${tab === 'eod' && html`<section className="panel">${eod.docs.length ? html`<ul className="list">${eod.docs.map(r => html`<li key=${r.id}><div><div className="t">${r.n}, ${fmtDate(r.d, { weekday: 'short', month: 'short', day: 'numeric' })}</div><div className="m">${r.rtr} RTR, ${r.subs} submissions, ${r.cands} consultants added${r.intv ? `, ${r.intv} interviews` : ''}${r.note ? '. ' + r.note.slice(0, 120) : ''}</div></div><div className="actions"><span className="muted small num">${fmtTime(r.at)}</span><button type="button" className="btn ghost sm" onClick=${() => setRep(r)}>Open</button></div></li>`)}</ul>` : html`<${Empty} title="No daily reports yet">Recruiters send an end-of-day report with one click from their portal.<//>`}</section>`}
    ${open !== undefined && (open === null || curC) && html`<${CandModal} key=${open || 'new'} c=${curC || null} onClose=${() => setOpen(undefined)} />`}
    ${openSub !== undefined && (openSub === null || curS) && html`<${SubModal} key=${openSub || 'new'} s=${curS || null} cands=${cands.docs} onClose=${() => setOpenSub(undefined)} />`}
    ${rep && html`<${Modal} title=${`${rep.n}: ${fmtDate(rep.d, { weekday: 'long', month: 'long', day: 'numeric' })}`} onClose=${() => setRep(null)} foot=${html`<button type="button" className="btn ghost" onClick=${async () => { try { await saveDownload(`eod-${rep.d}-${rep.n.replace(/\s+/g, '-')}.txt`, rep.text || ''); } catch (e) {} }}><${Icon} n="down" />Download</button><button type="button" className="btn" onClick=${() => setRep(null)}>Close</button>`}><pre style=${{ whiteSpace: 'pre-wrap', font: 'inherit', margin: 0 }}>${rep.text}</pre><//>`}
  </div>`;
}

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

/* ================= Invoices ================= */
const INV_ST = { draft: 'Draft', sent: 'Sent', viewed: 'Viewed', part: 'Partly paid', paid: 'Paid', void: 'Void' };
const invOverdue = d => ['sent', 'viewed', 'part'].includes(d.st) && d.due && d.due < dkey();
const invStatus = d => invOverdue(d) ? 'overdue' : d.st;
const invChip = d => { const s = invStatus(d); return s === 'paid' ? 'ok' : s === 'overdue' ? 'red' : s === 'draft' || s === 'void' ? '' : s === 'part' ? 'new' : 'amber'; };
const INV_LABEL = s => s === 'overdue' ? 'Overdue' : INV_ST[s] || s;
const invCalc = (lines, taxp, disc) => { const sub = r2((lines || []).reduce((a, l) => a + (+l.q || 0) * (+l.u || 0), 0)); const tax = r2(sub * (+taxp || 0) / 100); const total = r2(Math.max(0, sub + tax - (+disc || 0))); return { sub, tax, total }; };
const invBalance = d => r2((+d.total || 0) - (+d.paid || 0));
const addDaysStr = (k, n) => addDays(k, n);

async function buildInvoicePdf(d, org) {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica); const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logo = null; try { const r = await fetch(LOGO_L); if (r.ok) logo = await pdf.embedPng(new Uint8Array(await r.arrayBuffer())); } catch (e) { /* no logo */ }
  const navy = rgb(0.063, 0.106, 0.208), grey = rgb(0.42, 0.46, 0.55), teal = rgb(0.012, 0.63, 0.61), line = rgb(0.86, 0.89, 0.93);
  const M = n => ascii(fmtMoney(n, d.cur));
  let page = pdf.addPage([612, 792]); let y = 740;
  const text = (t, x, size, f, color, opts) => page.drawText(ascii(t), { x, y: (opts && opts.y) != null ? opts.y : y, size, font: f || font, color: color || navy, ...(opts || {}) });
  const wrap = (t, size, f, maxW) => { const words = ascii(t).split(/\s+/); const out = []; let cur = ''; words.forEach(w => { const test = cur ? cur + ' ' + w : w; if ((f || font).widthOfTextAtSize(test, size) > maxW && cur) { out.push(cur); cur = w; } else cur = test; }); if (cur) out.push(cur); return out; };
  const newPage = () => { page = pdf.addPage([612, 792]); y = 740; };
  if (logo) { const w = 150, h = w * logo.height / logo.width; page.drawImage(logo, { x: 50, y: y - h + 10, width: w, height: h }); }
  text('INVOICE', 440, 26, bold, navy); text(d.num, 440, 11, font, grey, { y: y - 22 }); y -= 54;
  const left = [org.co || 'StratEdge IT Consulting Inc.', ...(org.addr || '').split('\n'), org.email || CO.email, org.phone || CO.phone].filter(Boolean);
  left.forEach((l, i) => text(l, 50, i === 0 ? 11 : 9.5, i === 0 ? bold : font, i === 0 ? navy : grey, { y: y - i * 13 }));
  const meta = [['Issue date', fmtDate(d.issue, { month: 'short', day: 'numeric', year: 'numeric' })], ['Due date', d.due ? fmtDate(d.due, { month: 'short', day: 'numeric', year: 'numeric' }) : '-'], ['Terms', d.terms ? `Net ${d.terms}` : 'Due on receipt'], d.period && d.period.f ? ['Period', `${fmtDate(d.period.f, { month: 'short', day: 'numeric' })} - ${fmtDate(d.period.t || d.period.f, { month: 'short', day: 'numeric', year: 'numeric' })}`] : null].filter(Boolean);
  meta.forEach(([k, v], i) => { text(k, 380, 9, font, grey, { y: y - i * 14 }); text(v, 460, 9.5, bold, navy, { y: y - i * 14 }); });
  y -= Math.max(left.length, meta.length) * 14 + 22;
  text('BILL TO', 50, 8.5, bold, teal); y -= 14;
  [d.bill.co, d.bill.n, d.bill.e, ...(d.bill.addr || '').split('\n')].filter(Boolean).forEach((l, i) => text(l, 50, i === 0 ? 11 : 9.5, i === 0 ? bold : font, i === 0 ? navy : grey, { y: y - i * 13 }));
  y -= [d.bill.co, d.bill.n, d.bill.e, ...(d.bill.addr || '').split('\n')].filter(Boolean).length * 13 + 24;
  const head = () => { page.drawRectangle({ x: 50, y: y - 6, width: 512, height: 22, color: rgb(0.95, 0.96, 0.98) }); text('Description', 58, 9, bold, grey, { y: y + 1 }); text('Qty', 380, 9, bold, grey, { y: y + 1 }); text('Unit price', 430, 9, bold, grey, { y: y + 1 }); text('Amount', 505, 9, bold, grey, { y: y + 1 }); y -= 26; };
  head();
  (d.lines || []).forEach(l => {
    const ls = wrap(l.d || '', 9.5, font, 300); const h = Math.max(1, ls.length) * 12 + 8;
    if (y - h < 150) { newPage(); head(); }
    ls.forEach((t, i) => text(t, 58, 9.5, font, navy, { y: y - i * 12 }));
    text(String(+l.q || 0), 380, 9.5, font, navy); text(M(+l.u || 0), 430, 9.5, font, navy); text(M((+l.q || 0) * (+l.u || 0)), 505, 9.5, font, navy);
    y -= h; page.drawLine({ start: { x: 50, y: y + 4 }, end: { x: 562, y: y + 4 }, thickness: .5, color: line });
  });
  if (y < 190) { newPage(); }
  y -= 10; const tot = [['Subtotal', M(d.sub)], d.tax ? [`Tax (${d.taxp}%)`, M(d.tax)] : null, d.disc ? ['Discount', '-' + M(d.disc)] : null, ['Total', M(d.total)], d.paid ? ['Paid', '-' + M(d.paid)] : null, d.paid ? ['Balance due', M(invBalance(d))] : null].filter(Boolean);
  tot.forEach(([k, v], i) => { const big = k === 'Total' || k === 'Balance due'; text(k, 400, big ? 11 : 9.5, big ? bold : font, big ? navy : grey, { y }); text(v, 505, big ? 11 : 9.5, big ? bold : font, navy, { y }); y -= big ? 18 : 14; });
  y -= 14;
  if (d.notes) { text('Notes', 50, 8.5, bold, teal); y -= 13; wrap(d.notes, 9.5, font, 500).forEach(t => { text(t, 50, 9.5, font, navy); y -= 12; }); y -= 8; }
  if (d.pay) { text('Payment instructions', 50, 8.5, bold, teal); y -= 13; wrap(d.pay, 9.5, font, 500).forEach(t => { text(t, 50, 9.5, font, navy); y -= 12; }); }
  pdf.getPages().forEach((p, i, arr) => p.drawText(ascii(`${d.num}  ·  ${org.co || 'StratEdge IT Consulting Inc.'}  ·  Page ${i + 1} of ${arr.length}`), { x: 50, y: 30, size: 8, font, color: grey }));
  return await pdf.save();
}
function InvoiceView({ d }) {
  const M = n => fmtMoney(n, d.cur);
  return html`<div className="invdoc">
    <div className="invdoc-head"><div><div className="mono">INVOICE</div><h3>${d.num}</h3><${Chip} s=${invChip(d)}>${INV_LABEL(invStatus(d))}<//></div>
      <dl className="kv" style=${{ gridTemplateColumns: '110px auto' }}><dt>Issue date</dt><dd>${fmtDate(d.issue, { month: 'short', day: 'numeric', year: 'numeric' })}</dd><dt>Due</dt><dd>${d.due ? fmtDate(d.due, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}${d.terms ? ` (Net ${d.terms})` : ''}</dd>${d.period && d.period.f && html`<dt>Period</dt><dd>${fmtDate(d.period.f)} – ${fmtDate(d.period.t || d.period.f)}</dd>`}</dl></div>
    <div className="invdoc-bill"><span className="mono">BILL TO</span><b>${d.bill.co}</b>${d.bill.n && html`<div>${d.bill.n}</div>`}${d.bill.e && html`<div className="muted small">${d.bill.e}</div>`}${d.bill.addr && html`<div className="muted small" style=${{ whiteSpace: 'pre-wrap' }}>${d.bill.addr}</div>`}</div>
    <div className="tblwrap"><table className="tbl"><thead><tr><th>Description</th><th className="r">Qty</th><th className="r">Unit price</th><th className="r">Amount</th></tr></thead>
      <tbody>${(d.lines || []).map((l, i) => html`<tr key=${i}><td>${l.d}</td><td className="r num">${+l.q || 0}</td><td className="r num">${M(+l.u || 0)}</td><td className="r num">${M((+l.q || 0) * (+l.u || 0))}</td></tr>`)}
        <tr className="sum"><td colSpan="3" className="r">Subtotal</td><td className="r num">${M(d.sub)}</td></tr>
        ${d.tax > 0 && html`<tr><td colSpan="3" className="r">Tax (${d.taxp}%)</td><td className="r num">${M(d.tax)}</td></tr>`}
        ${d.disc > 0 && html`<tr><td colSpan="3" className="r">Discount</td><td className="r num">− ${M(d.disc)}</td></tr>`}
        <tr className="sum"><td colSpan="3" className="r"><b>Total</b></td><td className="r num"><b>${M(d.total)}</b></td></tr>
        ${d.paid > 0 && html`<tr><td colSpan="3" className="r">Paid</td><td className="r num">− ${M(d.paid)}</td></tr><tr className="sum"><td colSpan="3" className="r"><b>Balance due</b></td><td className="r num"><b>${M(invBalance(d))}</b></td></tr>`}
      </tbody></table></div>
    ${d.notes && html`<p className="small" style=${{ marginTop: 14, whiteSpace: 'pre-wrap' }}><b>Notes.</b> ${d.notes}</p>`}
    ${d.pay && html`<p className="small muted" style=${{ marginTop: 10, whiteSpace: 'pre-wrap' }}><b>Payment instructions.</b> ${d.pay}</p>`}
  </div>`;
}

/* ---- Editor ---- */
function InvoiceEditor({ inv, onClose, onSaved }) {
  const P = usePortal(); const A = P.admin; const toast = useToast(); const org = (P.settings && P.settings.inv) || {};
  const today = dkey();
  const [f, setF] = useState(inv ? { ...inv, lines: (inv.lines || []).map(l => ({ ...l })), bill: { ...inv.bill }, period: { ...(inv.period || {}) } } : { cur: 'USD', cid: '', bill: { co: '', n: '', e: '', addr: '' }, issue: today, terms: org.terms != null ? +org.terms : 30, due: addDaysStr(today, org.terms != null ? +org.terms : 30), period: { f: '', t: '' }, lines: [{ d: '', q: 1, u: '' }], taxp: org.taxp || 0, disc: 0, notes: '', pay: org.pay || '' });
  const [busy, setBusy] = useState(false);
  const up = k => e => { const v = e.target.value; setF(x => k === 'terms' ? { ...x, terms: v, due: x.issue && v !== '' ? addDaysStr(x.issue, +v) : x.due } : k === 'issue' ? { ...x, issue: v, due: v && x.terms !== '' ? addDaysStr(v, +x.terms) : x.due } : { ...x, [k]: v }); };
  const upB = k => e => setF(x => ({ ...x, bill: { ...x.bill, [k]: e.target.value } }));
  const setLine = (i, k, v) => setF(x => ({ ...x, lines: x.lines.map((l, j) => j === i ? { ...l, [k]: v } : l) }));
  const pickClient = e => { const cid = e.target.value; const c = A.clientsById[cid]; const contact = A.members.find(m => m.role === 'employer' && m.r && m.r.cid === cid);
    setF(x => ({ ...x, cid, bill: { ...x.bill, co: c ? c.n : x.bill.co, n: contact ? contact.u.p.n : x.bill.n, e: contact ? contact.u.p.e : x.bill.e, addr: c && c.loc ? c.loc : x.bill.addr } })); };
  const pull = () => {
    if (!f.cid) { toast('Choose a client first.', true); return; }
    if (!f.period.f || !f.period.t) { toast('Set the billing period first.', true); return; }
    const lines = [];
    A.members.filter(m => m.role !== 'employer' && m.r && m.r.cid === f.cid).forEach(m => {
      Object.entries(m.u.ts || {}).forEach(([w, s]) => { if (w < f.period.f || w > f.period.t) return; if (tsStatus(s, ((m.r || {}).rev || {})[w]) !== 'approved') return; if (!(s.t > 0)) return;
        lines.push({ d: `${m.u.p.n}, week of ${weekLabel(w)} (${h1(s.t)} h${m.r.ti ? ', ' + m.r.ti : ''})`, q: r2(s.t), u: m.r.br ? r2(m.r.br) : '' }); });
    });
    if (!lines.length) { toast('No approved timesheets for this client in that period.', true); return; }
    setF(x => ({ ...x, lines: [...x.lines.filter(l => l.d || l.u), ...lines] })); toast(`${lines.length} approved week${lines.length === 1 ? '' : 's'} added. Check the rates.`);
  };
  const calc = invCalc(f.lines, f.taxp, f.disc);
  const save = async () => {
    const lines = f.lines.filter(l => (l.d || '').trim() || +l.u).map(l => ({ d: (l.d || '').trim(), q: r2(l.q), u: r2(l.u) }));
    if (!f.bill.co.trim()) { toast('Add who the invoice is billed to.', true); return; }
    if (!lines.length) { toast('Add at least one line.', true); return; }
    setBusy(true);
    try {
      let num = f.num; if (!num) num = (await api('inv_next')).num;
      const id = f.id || nid(); const now = Date.now(); const c = invCalc(lines, f.taxp, f.disc);
      const doc = { num, cur: f.cur, cid: f.cid || '', bill: { co: f.bill.co.trim(), n: (f.bill.n || '').trim(), e: (f.bill.e || '').trim(), addr: (f.bill.addr || '').trim() }, issue: f.issue, terms: f.terms === '' ? 0 : +f.terms, due: f.due, period: { f: f.period.f || '', t: f.period.t || '' }, lines, taxp: r2(f.taxp), disc: r2(f.disc), sub: c.sub, tax: c.tax, total: c.total, paid: r2(inv ? inv.paid : 0), notes: (f.notes || '').trim(), pay: (f.pay || '').trim(),
        st: inv ? inv.st : 'draft', pays: inv ? inv.pays || [] : [], tok: inv ? inv.tok || '' : '', fid: inv ? inv.fid || '' : '', at: inv ? inv.at : now, by: inv ? inv.by : P.uid, byn: inv ? inv.byn : (P.prof ? P.prof.n : (Cap.me && Cap.me.name) || ''), u: now, log: inv ? [...(inv.log || []), { t: now, who: (P.prof && P.prof.n) || '', ev: 'Edited', ip: '' }] : [{ t: now, who: (P.prof && P.prof.n) || (Cap.me && Cap.me.name) || '', ev: 'Created', ip: '' }] };
      await dbSet(`inv/${id}`, doc); if (inv && inv.cid && inv.st !== 'draft') await dbSet(`pub/${inv.cid}/inv/${id}`, { ...doc, id, log: undefined });
      toast(inv ? 'Invoice updated.' : `Invoice ${num} saved as a draft.`); onSaved && onSaved(id); onClose();
    } catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  const M = n => fmtMoney(n, f.cur);
  return html`<${Modal} wide title=${inv ? 'Edit ' + inv.num : 'New invoice'} onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Cancel</button><button type="button" className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : inv ? 'Save changes' : 'Save draft'}</button>`}>
    <div className="form">
      <div className="row3">
        <${Field} label="Client workspace (optional)" hint="Links the invoice to the client portal and lets you pull approved hours."><select value=${f.cid} onChange=${pickClient}><option value="">None (vendor or other)</option>${A.clients.map(c => html`<option key=${c.id} value=${c.id}>${c.n}</option>`)}</select><//>
        <${Field} label="Currency"><select value=${f.cur} onChange=${up('cur')}><option value="USD">US dollar ($)</option><option value="INR">Indian rupee (₹)</option></select><//>
        <${Field} label="Invoice number"><input value=${f.num || ''} disabled placeholder="Assigned when saved" /><//></div>
      <div className="row2"><${Field} label="Bill to (company)"><input value=${f.bill.co} onInput=${upB('co')} placeholder="Client or vendor name" /><//><${Field} label="Contact name"><input value=${f.bill.n} onInput=${upB('n')} /><//></div>
      <div className="row2"><${Field} label="Contact email" hint="Where the invoice is sent."><input type="email" value=${f.bill.e} onInput=${upB('e')} /><//><${Field} label="Billing address"><textarea value=${f.bill.addr} onInput=${upB('addr')} style=${{ minHeight: 60 }} /><//></div>
      <div className="row3"><${Field} label="Issue date"><input type="date" value=${f.issue} onInput=${up('issue')} /><//><${Field} label="Terms (days)"><input type="number" min="0" value=${f.terms} onInput=${up('terms')} /><//><${Field} label="Due date"><input type="date" value=${f.due} onInput=${up('due')} /><//></div>
      <div className="row3"><${Field} label="Billing period from"><input type="date" value=${f.period.f} onInput=${e => setF(x => ({ ...x, period: { ...x.period, f: e.target.value } }))} /><//><${Field} label="to"><input type="date" value=${f.period.t} onInput=${e => setF(x => ({ ...x, period: { ...x.period, t: e.target.value } }))} /><//>
        <div className="fld"><span>Approved hours</span><button type="button" className="btn ghost" onClick=${pull}><${Icon} n="sheet" />Add approved timesheets</button></div></div>
      <div><span className="lbl">Lines</span>
        <div className="invlines">${f.lines.map((l, i) => html`<div key=${i} className="invline"><input value=${l.d} onInput=${e => setLine(i, 'd', e.target.value)} placeholder="Description" aria-label="Description" /><input type="number" step="0.25" min="0" value=${l.q} onInput=${e => setLine(i, 'q', e.target.value)} aria-label="Quantity" /><input type="number" step="0.01" min="0" value=${l.u} onInput=${e => setLine(i, 'u', e.target.value)} placeholder="Unit price" aria-label="Unit price" /><span className="num r">${M((+l.q || 0) * (+l.u || 0))}</span><button type="button" className="btn ghost icon" aria-label="Remove line" onClick=${() => setF(x => ({ ...x, lines: x.lines.filter((_, j) => j !== i) }))}><${Icon} n="trash" /></button></div>`)}</div>
        <button type="button" className="btn ghost sm" style=${{ marginTop: 8 }} onClick=${() => setF(x => ({ ...x, lines: [...x.lines, { d: '', q: 1, u: '' }] }))}><${Icon} n="plus" />Add line</button></div>
      <div className="row3"><${Field} label="Tax %"><input type="number" step="0.01" min="0" value=${f.taxp} onInput=${up('taxp')} /><//><${Field} label="Discount (amount)"><input type="number" step="0.01" min="0" value=${f.disc} onInput=${up('disc')} /><//>
        <div className="fld"><span>Total</span><div className="bignum">${M(calc.total)}</div><small>Subtotal ${M(calc.sub)}${calc.tax ? `, tax ${M(calc.tax)}` : ''}</small></div></div>
      <div className="row2"><${Field} label="Notes (printed on the invoice)"><textarea value=${f.notes} onInput=${up('notes')} placeholder="PO number, project reference, thank you" /><//><${Field} label="Payment instructions"><textarea value=${f.pay} onInput=${up('pay')} placeholder="Bank name, account, routing, UPI, or a payment link" /><//></div>
    </div><//>`;
}

/* ---- Detail: preview, send, payments ---- */
function SendInvoice({ d, onClose }) {
  const P = usePortal(); const toast = useToast(); const org = (P.settings && P.settings.inv) || {};
  const [f, setF] = useState({ to: d.bill.e || '', cc: '', note: '' }); const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!/^\S+@\S+\.\S+$/.test(f.to)) { toast('Enter a valid email address.', true); return; }
    setBusy(true);
    try { const bytes = await buildInvoicePdf(d, org); const fd = new FormData(); fd.append('id', d.id); fd.append('to', f.to.trim()); fd.append('cc', f.cc.trim()); fd.append('note', f.note.trim()); fd.append('file', new Blob([bytes], { type: 'application/pdf' }), `${d.num}.pdf`);
      const r = await upload('inv_send', fd); Sync.kick(); toast(r.mailed ? `Invoice emailed to ${f.to}.` : 'The invoice was saved and marked sent, but the email could not be delivered. Check mail settings in api/config.php, or share the link.', !r.mailed); onClose(); }
    catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  return html`<${Modal} title=${'Email ' + d.num} onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Cancel</button><button type="button" className="btn" disabled=${busy} onClick=${send}><${Icon} n="send" />${busy ? 'Sending…' : 'Send invoice'}</button>`}>
    <div className="form">
      <${Field} label="To"><input type="email" value=${f.to} onInput=${e => setF({ ...f, to: e.target.value })} /><//>
      <${Field} label="Cc (optional, comma-separated)"><input value=${f.cc} onInput=${e => setF({ ...f, cc: e.target.value })} placeholder="accounts@client.com, you@stratedge.com" /><//>
      <${Field} label="Message"><textarea value=${f.note} onInput=${e => setF({ ...f, note: e.target.value })} placeholder="Optional note included in the email" /><//>
      <p className="muted small">The email includes the PDF and a secure link where they can view and download the invoice. Opening the link marks it as viewed here.</p>
    </div><//>`;
}
function RecordPayment({ d, onClose }) {
  const P = usePortal(); const toast = useToast();
  const [f, setF] = useState({ a: invBalance(d), dt: dkey(), m: 'Bank transfer', ref: '' }); const [busy, setBusy] = useState(false);
  const save = async () => {
    const a = r2(f.a); if (!(a > 0)) { toast('Enter the amount received.', true); return; }
    setBusy(true);
    try { const paid = r2((+d.paid || 0) + a); const st = paid >= d.total - 0.005 ? 'paid' : 'part'; const now = Date.now();
      await dbMerge(`inv/${d.id}`, { paid, st, pays: [...(d.pays || []), { a, dt: f.dt, m: f.m, ref: f.ref.trim(), at: now }], log: [...(d.log || []), { t: now, who: (P.prof && P.prof.n) || '', ev: `Payment recorded: ${fmtMoney(a, d.cur)}${f.ref ? ' (' + f.ref + ')' : ''}`, ip: '' }], u: now });
      if (d.cid && d.st !== 'draft') await dbMerge(`pub/${d.cid}/inv/${d.id}`, { paid, st, u: now });
      toast(st === 'paid' ? 'Invoice marked paid.' : 'Payment recorded.'); onClose(); }
    catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  return html`<${Modal} title=${'Record payment for ' + d.num} onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Cancel</button><button type="button" className="btn go" disabled=${busy} onClick=${save}>Record payment</button>`}>
    <div className="form"><div className="row2"><${Field} label=${'Amount received (' + d.cur + ')'}><input type="number" step="0.01" min="0" value=${f.a} onInput=${e => setF({ ...f, a: e.target.value })} /><//><${Field} label="Date"><input type="date" value=${f.dt} onInput=${e => setF({ ...f, dt: e.target.value })} /><//></div>
      <div className="row2"><${Field} label="Method"><select value=${f.m} onChange=${e => setF({ ...f, m: e.target.value })}>${['Bank transfer', 'ACH', 'Wire', 'Check', 'Card', 'UPI', 'Other'].map(x => html`<option key=${x}>${x}</option>`)}</select><//><${Field} label="Reference"><input value=${f.ref} onInput=${e => setF({ ...f, ref: e.target.value })} placeholder="Transaction or check number" /><//></div>
      <p className="muted small">Balance before this payment: ${fmtMoney(invBalance(d), d.cur)}.</p></div><//>`;
}
function InvoiceDetail({ d, onClose, onEdit }) {
  const P = usePortal(); const toast = useToast(); const org = (P.settings && P.settings.inv) || {};
  const [send, setSend] = useState(false); const [pay, setPay] = useState(false); const [busy, setBusy] = useState(false);
  const download = async () => { setBusy(true); try { const bytes = await buildInvoicePdf(d, org); await saveDownload(`${d.num}.pdf`, new Blob([bytes], { type: 'application/pdf' })); } catch (e) { if (!e || e.code !== 'declined') toast(errText(e), true); } setBusy(false); };
  const voidIt = async () => { try { const now = Date.now(); await dbMerge(`inv/${d.id}`, { st: 'void', u: now, log: [...(d.log || []), { t: now, who: (P.prof && P.prof.n) || '', ev: 'Voided', ip: '' }] }); if (d.cid && d.tok) await dbMerge(`pub/${d.cid}/inv/${d.id}`, { st: 'void', u: now }); toast('Invoice voided.'); onClose(); } catch (e) { toast(errText(e), true); } };
  const link = d.tok ? location.origin + location.pathname + '#/invoice/' + d.id + '/' + d.tok : '';
  const copy = async () => { try { await navigator.clipboard.writeText(link); toast('Invoice link copied.'); } catch (e) { prompt('Copy this invoice link', link); } };
  return html`<${Modal} wide title=${`${d.num}: ${d.bill.co}`} onClose=${onClose} foot=${html`
      ${d.st === 'draft' && html`<button type="button" className="btn ghost" onClick=${() => onEdit(d)}>Edit</button>`}
      ${d.st !== 'void' && d.st !== 'paid' && html`<button type="button" className="btn ghost" onClick=${voidIt}>Void</button>`}
      <button type="button" className="btn ghost" disabled=${busy} onClick=${download}><${Icon} n="down" />PDF</button>
      ${d.st !== 'void' && d.st !== 'paid' && html`<button type="button" className="btn ghost" onClick=${() => setPay(true)}>Record payment</button>`}
      ${d.st !== 'void' && html`<button type="button" className="btn" onClick=${() => setSend(true)}><${Icon} n="send" />${d.st === 'draft' ? 'Send by email' : 'Resend'}</button>`}`}>
    <div className="stack">
      <div className="actions"><${Chip} s=${invChip(d)}>${INV_LABEL(invStatus(d))}<//><span className="muted small">${d.sentAt ? 'Sent ' + fmtTs(d.sentAt) + (d.to ? ' to ' + d.to : '') : 'Not sent yet'}${d.viewedAt ? ', viewed ' + fmtTs(d.viewedAt) : ''}</span>${link && html`<button type="button" className="btn link small" onClick=${copy}>Copy view link</button>`}</div>
      <${InvoiceView} d=${d} />
      ${(d.pays || []).length > 0 && html`<div><h3 className="ph" style=${{ marginBottom: 8 }}>Payments</h3><ul className="list">${d.pays.map((p, i) => html`<li key=${i}><div><div className="t">${fmtMoney(p.a, d.cur)}</div><div className="m">${p.m}${p.ref ? ', ' + p.ref : ''}</div></div><span className="muted small num">${fmtDate(p.dt, { month: 'short', day: 'numeric', year: 'numeric' })}</span></li>`)}</ul></div>`}
      <div><h3 className="ph" style=${{ marginBottom: 8 }}>History</h3><ul className="list">${(d.log || []).slice().reverse().map((l, i) => html`<li key=${i}><div><div className="t">${l.ev}</div><div className="m">${l.who}</div></div><span className="muted small num">${fmtTs(l.t)}</span></li>`)}</ul></div>
    </div>
    ${send && html`<${SendInvoice} d=${d} onClose=${() => { setSend(false); onClose(); }} />`}
    ${pay && html`<${RecordPayment} d=${d} onClose=${() => { setPay(false); onClose(); }} />`}<//>`;
}
function BillingSettings({ onClose }) {
  const P = usePortal(); const toast = useToast(); const org = (P.settings && P.settings.inv) || {};
  const [f, setF] = useState({ co: org.co || CO.legal, addr: org.addr || `${CO.addr1}\n${CO.addr2}`, email: org.email || CO.email, phone: org.phone || CO.phone, pay: org.pay || '', taxp: org.taxp || 0, terms: org.terms != null ? org.terms : 30 });
  const [busy, setBusy] = useState(false); const up = k => e => setF({ ...f, [k]: e.target.value });
  const save = async () => { setBusy(true); try { await dbMerge('org/main/x/settings', { inv: { ...f, taxp: r2(f.taxp), terms: +f.terms || 0 } }); toast('Billing settings saved.'); onClose(); } catch (e) { toast(errText(e), true); } setBusy(false); };
  return html`<${Modal} title="Billing settings" onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Cancel</button><button type="button" className="btn" disabled=${busy} onClick=${save}>Save</button>`}>
    <div className="form"><${Field} label="Company name on invoices"><input value=${f.co} onInput=${up('co')} /><//>
      <${Field} label="Address"><textarea value=${f.addr} onInput=${up('addr')} style=${{ minHeight: 70 }} /><//>
      <div className="row2"><${Field} label="Billing email"><input value=${f.email} onInput=${up('email')} /><//><${Field} label="Phone"><input value=${f.phone} onInput=${up('phone')} /><//></div>
      <div className="row2"><${Field} label="Default tax %"><input type="number" step="0.01" value=${f.taxp} onInput=${up('taxp')} /><//><${Field} label="Default terms (days)"><input type="number" value=${f.terms} onInput=${up('terms')} /><//></div>
      <${Field} label="Payment instructions (printed on every new invoice)"><textarea value=${f.pay} onInput=${up('pay')} placeholder="Bank name, account number, routing number, SWIFT, UPI ID or a payment link" /><//>
      <p className="muted small">Outgoing email settings (SMTP or the host\u2019s mail function) live in api/config.php.</p></div><//>`;
}
function InvoicesAdmin() {
  const P = usePortal(); const A = P.admin;
  const col = useCol('inv', 'u:desc');
  const [tab, setTab] = useState('open'); const [edit, setEdit] = useState(undefined); const [open, setOpen] = useState(null); const [cfgOpen, setCfgOpen] = useState(false); const [q, setQ] = useState('');
  if (A.loading) return html`<${Spinner} />`;
  const docs = col.docs; const ql = q.trim().toLowerCase();
  const list = docs.filter(d => { const s = invStatus(d); return (tab === 'all' || (tab === 'open' ? ['sent', 'viewed', 'part', 'overdue'].includes(s) : tab === 'overdue' ? s === 'overdue' : s === tab)) && (!ql || [d.num, d.bill.co, d.bill.n, d.bill.e].join(' ').toLowerCase().includes(ql)); });
  const out = {}; docs.filter(d => ['sent', 'viewed', 'part'].includes(d.st)).forEach(d => { out[d.cur] = (out[d.cur] || 0) + invBalance(d); });
  const overdue = docs.filter(invOverdue).length;
  const cur = open && docs.find(d => d.id === open);
  return html`<div className="stack">
    <div className="kpis" style=${{ gridTemplateColumns: `repeat(${Object.keys(out).length + 2},minmax(0,1fr))` }}>
      ${Object.entries(out).map(([c, v]) => html`<a key=${c}><b>${fmtMoney(v, c)}</b><span>Outstanding (${c})</span></a>`)}<a><b>${overdue}</b><span>Overdue</span></a><a><b>${docs.filter(d => d.st === 'draft').length}</b><span>Drafts</span></a></div>
    <div className="toolbar"><div className="tabs" role="tablist" style=${{ marginBottom: 0, border: 0 }}>${[['open', 'Open'], ['overdue', 'Overdue'], ['draft', 'Drafts'], ['paid', 'Paid'], ['all', 'All']].map(([k, v]) => html`<button type="button" key=${k} role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${v}</button>`)}</div>
      <input type="search" style=${{ maxWidth: 220 }} placeholder="Search" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Search invoices" />
      <div className="push"><button type="button" className="btn ghost" onClick=${() => setCfgOpen(true)}>Billing settings</button><button type="button" className="btn" onClick=${() => setEdit(null)}><${Icon} n="plus" />New invoice</button></div></div>
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${col.loading ? html`<${Spinner} />` : list.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Invoice</th><th>Billed to</th><th>Issued</th><th>Due</th><th className="r">Total</th><th className="r">Balance</th><th>Status</th></tr></thead>
        <tbody>${list.map(d => html`<tr key=${d.id} className="click" tabIndex="0" onClick=${() => setOpen(d.id)}><td><b style=${{ fontWeight: 600 }}>${d.num}</b></td><td>${d.bill.co}<div className="muted small">${d.bill.e || ''}</div></td><td className="num nw">${fmtDate(d.issue)}</td><td className="num nw">${d.due ? fmtDate(d.due) : '—'}</td>
          <td className="r num">${fmtMoney(d.total, d.cur)}</td><td className="r num">${['paid', 'void'].includes(d.st) ? '—' : fmtMoney(invBalance(d), d.cur)}</td><td><${Chip} s=${invChip(d)}>${INV_LABEL(invStatus(d))}<//></td></tr>`)}</tbody></table></div>`
        : html`<${Empty} title=${tab === 'open' ? 'No open invoices' : 'No invoices here yet'} action=${html`<button type="button" className="btn" onClick=${() => setEdit(null)}>Create an invoice</button>`}>Build an invoice from approved timesheet hours or your own lines, email it with the PDF attached, and track viewed, paid and overdue here. Clients also see their invoices in the client portal.<//>`}
    </section>
    ${edit !== undefined && html`<${InvoiceEditor} inv=${edit} onClose=${() => setEdit(undefined)} onSaved=${id => setOpen(id)} />`}
    ${cur && html`<${InvoiceDetail} key=${cur.id + cur.u} d=${cur} onClose=${() => setOpen(null)} onEdit=${d => { setOpen(null); setEdit(d); }} />`}
    ${cfgOpen && html`<${BillingSettings} onClose=${() => setCfgOpen(false)} />`}
  </div>`;
}
/* ---- Client portal ---- */
function ClientInvoices() {
  const P = usePortal(); const col = useCol(`pub/${P.cid}/inv`, 'u:desc');
  const docs = col.docs.filter(d => d.st !== 'draft');
  const out = docs.filter(d => ['sent', 'viewed', 'part'].includes(d.st)).reduce((a, d) => a + invBalance(d), 0);
  return html`<div className="stack">
    ${docs.length > 0 && html`<div className="kpis" style=${{ gridTemplateColumns: 'repeat(2,minmax(0,1fr))' }}><a><b>${fmtMoney(out, (docs[0] || {}).cur || 'USD')}</b><span>Balance outstanding</span></a><a><b>${docs.filter(invOverdue).length}</b><span>Overdue</span></a></div>`}
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${col.loading ? html`<${Spinner} />` : docs.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Invoice</th><th>Issued</th><th>Due</th><th className="r">Total</th><th className="r">Balance</th><th>Status</th><th /></tr></thead>
        <tbody>${docs.map(d => html`<tr key=${d.id}><td><b style=${{ fontWeight: 600 }}>${d.num}</b>${d.period && d.period.f ? html`<div className="muted small">${fmtDate(d.period.f)} – ${fmtDate(d.period.t)}</div>` : ''}</td><td className="num nw">${fmtDate(d.issue)}</td><td className="num nw">${d.due ? fmtDate(d.due) : '—'}</td><td className="r num">${fmtMoney(d.total, d.cur)}</td><td className="r num">${['paid', 'void'].includes(d.st) ? '—' : fmtMoney(invBalance(d), d.cur)}</td><td><${Chip} s=${invChip(d)}>${INV_LABEL(invStatus(d))}<//></td>
          <td className="r"><div className="actions" style=${{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>${d.tok && html`<a className="btn ghost sm" href=${'#/invoice/' + d.id + '/' + d.tok}>View</a>`}${d.fid && d.tok && html`<a className="btn ghost sm" href=${fileUrl('inv/' + d.id, d.fid, true, d.tok)}><${Icon} n="down" />PDF</a>`}</div></td></tr>`)}</tbody></table></div>`
        : html`<${Empty} title="No invoices yet">Invoices StratEdge sends your company appear here with their status and PDF.<//>`}
    </section>
  </div>`;
}
/* ---- Public page from the email link ---- */
function InvoicePublic({ id, tok }) {
  const [d, setD] = useState(undefined);
  useEffect(() => { api('inv_public_get&id=' + encodeURIComponent(id) + '&tok=' + encodeURIComponent(tok)).then(r => setD(r.d)).catch(() => setD(null)); }, [id, tok]);
  return html`<${Fragment}>
    <${PageHead} title=${d ? 'Invoice ' + d.num : 'Invoice'} intro=${d ? `From StratEdge IT Consulting to ${d.bill.co}.` : ''} />
    <section className="sec" style=${{ paddingTop: 48 }}><div className="wrap" style=${{ maxWidth: 900 }}>
      ${d === undefined ? html`<${Spinner} label="Loading the invoice…" />` : d === null ? html`<div className="panel"><${Empty} title="This invoice link isn\u2019t valid">Contact ${CO.email} and we\u2019ll resend it.<//></div>`
        : html`<div className="panel stack"><${InvoiceView} d=${d} /><div className="actions">${d.fid && html`<a className="btn" href=${fileUrl('inv/' + d.id, d.fid, true, tok)}><${Icon} n="down" />Download PDF</a>`}<a className="btn ghost" href=${'mailto:' + CO.email + '?subject=' + encodeURIComponent('Invoice ' + d.num)}>Question about this invoice</a></div></div>`}
    </div></section>
  <//>`;
}

/* ================= Accounting portal ================= */
const useCoa = () => { const d = useDoc('org/acct/x/coa'); return (d.data && d.data.items && d.data.items.length) ? d.data.items : COA_DEFAULT; };
const useTaxSettings = () => { const d = useDoc('org/acct/x/tax'); const t = d.data || {}; return { us: { ...TAX_DEFAULT.us, ...(t.us || {}) }, in: { ...TAX_DEFAULT.in, ...(t.in || {}) }, loaded: !d.loading }; };
const EXP_ST = { unpaid: 'Unpaid', paid: 'Paid' };
const expOverdue = x => x.st === 'unpaid' && x.due && x.due < dkey();

/* ---- Overview ---- */
function AcctOverview() {
  const P = usePortal(); const inv = useCol('inv', 'u:desc'); const exp = useCol('exp', 'u:desc'); const runs = useCol('org/acct/runs', 'mk:desc', 3);
  const ar = {}; inv.docs.filter(d => ['sent', 'viewed', 'part'].includes(d.st)).forEach(d => { ar[d.cur] = (ar[d.cur] || 0) + invBalance(d); });
  const ap = {}; exp.docs.filter(x => x.st === 'unpaid').forEach(x => { ap[x.cur] = (ap[x.cur] || 0) + (+x.a || 0); });
  const run = runs.docs[0];
  return html`<div className="stack">
    <div className="kpis">
      ${Object.keys(ar).length ? Object.entries(ar).map(([c, v]) => html`<a key=${c} href="#/portal/admin/invoices"><b>${fmtMoney(v, c)}</b><span>Receivable (${c})</span></a>`) : html`<a href="#/portal/admin/invoices"><b>$0.00</b><span>Receivable</span></a>`}
      <a href="#/portal/admin/invoices"><b>${inv.docs.filter(invOverdue).length}</b><span>Overdue invoices</span></a>
      ${Object.keys(ap).length ? Object.entries(ap).map(([c, v]) => html`<a key=${c} href="#/portal/acct/expenses"><b>${fmtMoney(v, c)}</b><span>Bills to pay (${c})</span></a>`) : html`<a href="#/portal/acct/expenses"><b>$0.00</b><span>Bills to pay</span></a>`}
      <a href="#/portal/acct/payroll"><b>${run ? monthLabel(run.mk) : '—'}</b><span>${run ? `Last payroll run, ${run.st}` : 'No payroll run yet'}</span></a>
    </div>
    <div className="g2" style=${{ alignItems: 'start' }}>
      <section className="panel"><div className="ph-row"><h2 className="ph">Open invoices</h2><a className="small" href="#/portal/admin/invoices">All invoices</a></div>
        ${inv.docs.filter(d => ['sent', 'viewed', 'part'].includes(d.st)).length ? html`<ul className="list">${inv.docs.filter(d => ['sent', 'viewed', 'part'].includes(d.st)).slice(0, 6).map(d => html`<li key=${d.id}><div><div className="t">${d.num}, ${d.bill.co}</div><div className="m">Due ${fmtDate(d.due)}</div></div><div className="actions"><${Chip} s=${invChip(d)}>${INV_LABEL(invStatus(d))}<//><b className="num">${fmtMoney(invBalance(d), d.cur)}</b></div></li>`)}</ul>` : html`<${Empty} title="Nothing outstanding" />`}</section>
      <section className="panel"><div className="ph-row"><h2 className="ph">Bills to pay</h2><a className="small" href="#/portal/acct/expenses">All bills and expenses</a></div>
        ${exp.docs.filter(x => x.st === 'unpaid').length ? html`<ul className="list">${exp.docs.filter(x => x.st === 'unpaid').slice(0, 6).map(x => html`<li key=${x.id}><div><div className="t">${x.v}</div><div className="m">${x.cat}${x.due ? ', due ' + fmtDate(x.due) : ''}</div></div><div className="actions">${expOverdue(x) && html`<${Chip} s="red">Overdue<//>`}<b className="num">${fmtMoney(x.a, x.cur)}</b></div></li>`)}</ul>` : html`<${Empty} title="No unpaid bills" />`}</section>
    </div>
    <section className="panel"><h2 className="ph" style=${{ marginBottom: 10 }}>Quick actions</h2><div className="actions"><a className="btn" href="#/portal/admin/invoices">New invoice</a><a className="btn ghost" href="#/portal/acct/expenses">Record a bill or expense</a><a className="btn ghost" href="#/portal/acct/payroll">Run payroll</a><a className="btn ghost" href="#/portal/acct/reports">Reports</a><a className="btn ghost" href="#/portal/acct/taxes">Tax settings</a></div></section>
  </div>`;
}

/* ---- Bills and expenses ---- */
function ExpenseModal({ x, onClose }) {
  const P = usePortal(); const toast = useToast(); const coa = useCoa();
  const [f, setF] = useState(x ? { ...x } : { v: '', cat: (coa.find(c => c.t === 'expense') || {}).n || 'Other expenses', d: dkey(), due: '', a: '', cur: 'USD', ref: '', notes: '', st: 'unpaid', m: 'Bank transfer' });
  const [busy, setBusy] = useState(false); const [prog, setProg] = useState(0);
  const files = useCol(x ? `exp/${x.id}/f` : null, 'at:desc');
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const save = async (markPaid) => {
    if (!f.v.trim() || !(+f.a > 0)) { toast('Add the vendor and the amount.', true); return; }
    setBusy(true);
    try { const id = x ? x.id : nid(); const now = Date.now(); const st = markPaid ? 'paid' : f.st;
      await (x ? dbMerge : dbSet)(`exp/${id}`, { v: f.v.trim(), cat: f.cat, d: f.d, due: f.due, a: r2(f.a), cur: f.cur, ref: f.ref.trim(), notes: f.notes.trim(), st, m: f.m, ...(markPaid ? { paidAt: now, paidOn: dkey() } : {}), at: x ? x.at : now, by: x ? x.by : P.uid, byn: x ? x.byn : (P.prof ? P.prof.n : ''), u: now });
      toast(markPaid ? 'Marked paid.' : x ? 'Saved.' : 'Bill recorded.'); onClose(); }
    catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  const onFiles = async fs => { if (!x) { toast('Save first, then attach the receipt.', true); return; } setBusy(true); try { setProg(0.03); await storeFile(`exp/${x.id}`, fs[0], { c: 'receipt' }, setProg); toast('Receipt attached.'); } catch (e) { toast(errText(e), true); } setBusy(false); };
  return html`<${Modal} title=${x ? x.v : 'Record a bill or expense'} onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Cancel</button>${f.st !== 'paid' && html`<button type="button" className="btn go" disabled=${busy} onClick=${() => save(true)}>Save and mark paid</button>`}<button type="button" className="btn" disabled=${busy} onClick=${() => save(false)}>${busy ? 'Saving…' : 'Save'}</button>`}>
    <div className="form">
      <div className="row2"><${Field} label="Vendor / payee"><input value=${f.v} onInput=${up('v')} placeholder="e.g. Dice, AWS, a C2C consultant's company" /><//><${Field} label="Category"><select value=${f.cat} onChange=${up('cat')}>${coa.filter(c => c.t === 'expense').map(c => html`<option key=${c.id}>${c.n}</option>`)}</select><//></div>
      <div className="row3"><${Field} label="Amount"><input type="number" step="0.01" min="0" value=${f.a} onInput=${up('a')} /><//><${Field} label="Currency"><select value=${f.cur} onChange=${up('cur')}><option value="USD">USD</option><option value="INR">INR</option></select><//><${Field} label="Status"><select value=${f.st} onChange=${up('st')}><option value="unpaid">Unpaid</option><option value="paid">Paid</option></select><//></div>
      <div className="row3"><${Field} label="Bill date"><input type="date" value=${f.d} onInput=${up('d')} /><//><${Field} label="Due date"><input type="date" value=${f.due} onInput=${up('due')} /><//><${Field} label="Payment method"><select value=${f.m} onChange=${up('m')}>${['Bank transfer', 'ACH', 'Wire', 'Card', 'Check', 'UPI', 'Cash'].map(v => html`<option key=${v}>${v}</option>`)}</select><//></div>
      <div className="row2"><${Field} label="Reference (invoice or receipt #)"><input value=${f.ref} onInput=${up('ref')} /><//><${Field} label="Notes"><input value=${f.notes} onInput=${up('notes')} /><//></div>
      <div><span className="lbl">Receipt or bill</span>${x && files.docs.length ? html`<ul className="files" style=${{ marginTop: 8 }}>${files.docs.map(r => html`<li key=${r.id}><${Icon} n="file" /><div className="fn"><b>${r.n}</b><span>${fmtDay(r.at)}</span></div><${FileActions} base=${'exp/' + x.id} f=${r} /></li>`)}</ul>` : null}
        <div style=${{ marginTop: 8 }}><${FilePick} busy=${busy} progress=${prog} onFiles=${onFiles} label=${x ? 'Attach the receipt or vendor invoice.' : 'Save first, then attach the receipt.'} /></div></div>
    </div><//>`;
}
function Expenses() {
  const col = useCol('exp', 'd:desc'); const [tab, setTab] = useState('unpaid'); const [open, setOpen] = useState(undefined); const [q, setQ] = useState(''); const toast = useToast();
  const ql = q.trim().toLowerCase();
  const list = col.docs.filter(x => (tab === 'all' || x.st === tab) && (!ql || [x.v, x.cat, x.ref, x.notes].join(' ').toLowerCase().includes(ql)));
  const tot = {}; col.docs.filter(x => x.st === 'unpaid').forEach(x => { tot[x.cur] = (tot[x.cur] || 0) + (+x.a || 0); });
  const cur = open && col.docs.find(x => x.id === open);
  const exp = async () => { try { await saveDownload('bills-expenses.csv', toCSV([['Date', 'Vendor', 'Category', 'Amount', 'Currency', 'Status', 'Due', 'Paid on', 'Reference', 'Notes'], ...col.docs.map(x => [x.d, x.v, x.cat, x.a, x.cur, x.st, x.due || '', x.paidOn || '', x.ref || '', x.notes || ''])])); } catch (e) { if (!e || e.code !== 'declined') toast(errText(e), true); } };
  return html`<div className="stack">
    <div className="kpis" style=${{ gridTemplateColumns: `repeat(${Math.max(1, Object.keys(tot).length) + 1},minmax(0,1fr))` }}>${Object.keys(tot).length ? Object.entries(tot).map(([c, v]) => html`<a key=${c}><b>${fmtMoney(v, c)}</b><span>Unpaid (${c})</span></a>`) : html`<a><b>$0.00</b><span>Unpaid</span></a>`}<a><b>${col.docs.filter(expOverdue).length}</b><span>Overdue bills</span></a></div>
    <div className="toolbar"><div className="tabs" role="tablist" style=${{ marginBottom: 0, border: 0 }}>${[['unpaid', 'Unpaid'], ['paid', 'Paid'], ['all', 'All']].map(([k, v]) => html`<button type="button" key=${k} role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${v}</button>`)}</div>
      <input type="search" style=${{ maxWidth: 220 }} placeholder="Search" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Search bills" /><div className="push"><button type="button" className="btn ghost" onClick=${exp}><${Icon} n="down" />CSV</button><button type="button" className="btn" onClick=${() => setOpen(null)}><${Icon} n="plus" />Record bill or expense</button></div></div>
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${col.loading ? html`<${Spinner} />` : list.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Date</th><th>Vendor</th><th>Category</th><th className="r">Amount</th><th>Due</th><th>Status</th></tr></thead>
        <tbody>${list.map(x => html`<tr key=${x.id} className="click" tabIndex="0" onClick=${() => setOpen(x.id)}><td className="num nw">${fmtDate(x.d)}</td><td><b style=${{ fontWeight: 600 }}>${x.v}</b>${x.ref ? html`<div className="muted small">${x.ref}</div>` : ''}</td><td>${x.cat}</td><td className="r num">${fmtMoney(x.a, x.cur)}</td><td className="num nw">${x.due ? fmtDate(x.due) : '—'}</td><td><${Chip} s=${x.st === 'paid' ? 'ok' : expOverdue(x) ? 'red' : 'amber'}>${x.st === 'paid' ? 'Paid' : expOverdue(x) ? 'Overdue' : 'Unpaid'}<//></td></tr>`)}</tbody></table></div>`
        : html`<${Empty} title=${tab === 'unpaid' ? 'No unpaid bills' : 'Nothing here yet'} action=${html`<button type="button" className="btn" onClick=${() => setOpen(null)}>Record the first bill</button>`}>Vendor bills, C2C contractor payments, software, travel and every other cost. Categories feed the profit and loss report.<//>`}
    </section>
    ${open !== undefined && (open === null || cur) && html`<${ExpenseModal} key=${open || 'new'} x=${cur || null} onClose=${() => setOpen(undefined)} />`}
  </div>`;
}

/* ---- Chart of accounts ---- */
function ChartOfAccounts() {
  const toast = useToast(); const d = useDoc('org/acct/x/coa'); const [items, setItems] = useState(null);
  const cur = items || ((d.data && d.data.items && d.data.items.length) ? d.data.items : COA_DEFAULT);
  const set = (i, patch) => setItems(cur.map((x, j) => j === i ? { ...x, ...patch } : x));
  const save = async () => { try { await dbMerge('org/acct/x/coa', { items: cur.filter(x => x.n.trim()).map(x => ({ id: x.id || nid(), n: x.n.trim(), t: x.t })) }); setItems(null); toast('Chart of accounts saved.'); } catch (e) { toast(errText(e), true); } };
  return html`<div className="stack">
    <section className="panel stack" style=${{ gap: 12 }}>
      <div className="ph-row"><div><h2 className="ph">Chart of accounts</h2><p className="muted small" style=${{ marginTop: 4 }}>Income and expense categories used by invoices, bills and the profit and loss report.</p></div><div className="actions"><button type="button" className="btn ghost sm" onClick=${() => setItems(COA_DEFAULT.map(x => ({ ...x })))}>Reset to defaults</button><button type="button" className="btn sm" onClick=${() => setItems([...cur, { id: nid(), n: '', t: 'expense' }])}><${Icon} n="plus" />Add account</button></div></div>
      <div className="stack" style=${{ gap: 8 }}>${cur.map((x, i) => html`<div key=${x.id || i} style=${{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) 160px auto', gap: 8, alignItems: 'center' }}><input value=${x.n} onInput=${e => set(i, { n: e.target.value })} aria-label="Account name" /><select value=${x.t} onChange=${e => set(i, { t: e.target.value })} aria-label="Type"><option value="income">Income</option><option value="expense">Expense</option></select><button type="button" className="btn ghost icon" aria-label="Remove" onClick=${() => setItems(cur.filter((_, j) => j !== i))}><${Icon} n="trash" /></button></div>`)}</div>
      <div className="actions"><button type="button" className="btn" disabled=${!items} onClick=${save}>Save</button></div>
    </section>
  </div>`;
}

/* ---- Tax settings ---- */
function TaxSettings() {
  const toast = useToast(); const d = useDoc('org/acct/x/tax'); const [f, setF] = useState(null);
  const cur = f || { us: { ...TAX_DEFAULT.us, ...((d.data || {}).us || {}) }, in: { ...TAX_DEFAULT.in, ...((d.data || {}).in || {}) } };
  const upUS = k => e => setF({ ...cur, us: { ...cur.us, [k]: e.target.type === 'checkbox' ? e.target.checked : +e.target.value } });
  const upIN = k => e => setF({ ...cur, in: { ...cur.in, [k]: e.target.type === 'checkbox' ? e.target.checked : (e.target.type === 'number' ? +e.target.value : e.target.value) } });
  const save = async () => { try { await dbMerge('org/acct/x/tax', { us: cur.us, in: cur.in }); setF(null); toast('Tax settings saved.'); } catch (e) { toast(errText(e), true); } };
  const F = (label, v, on, step) => html`<${Field} label=${label}><input type="number" step=${step || 'any'} value=${v} onInput=${on} /><//>`;
  return html`<div className="stack">
    <div className="note info"><span>These rates drive the paystub calculations. Defaults are the published ${cur.us.year} US figures and the FY ${cur.in.fy} India figures; update them each year and confirm with your CPA or CA. Paystubs are marked as estimates.</span></div>
    <section className="panel stack" style=${{ gap: 12 }}><h2 className="ph">United States (W2 payroll)</h2>
      <div className="row3">${F('Tax year', cur.us.year, upUS('year'), 1)}${F('Standard deduction, single', cur.us.std.single, e => setF({ ...cur, us: { ...cur.us, std: { ...cur.us.std, single: +e.target.value } } }))}${F('Standard deduction, married', cur.us.std.married, e => setF({ ...cur, us: { ...cur.us, std: { ...cur.us.std, married: +e.target.value } } }))}</div>
      <div className="row3">${F('Social Security %', cur.us.ss, upUS('ss'))}${F('Social Security wage base', cur.us.ssBase, upUS('ssBase'))}${F('Medicare %', cur.us.med, upUS('med'))}</div>
      <div className="row3">${F('Additional Medicare % (over threshold)', cur.us.medAdd, upUS('medAdd'))}${F('Additional Medicare threshold', cur.us.medAddOver, upUS('medAddOver'))}${F('FUTA % (employer)', cur.us.futa, upUS('futa'))}</div>
      <div className="row3">${F('FUTA wage base', cur.us.futaBase, upUS('futaBase'))}${F('SUTA % (employer, your state rate)', cur.us.suta, upUS('suta'))}${F('SUTA wage base (NJ 2025: 43,300)', cur.us.sutaBase, upUS('sutaBase'))}</div>
      <p className="muted small">Federal brackets follow the IRS percentage-method tables for the year above. State income tax is set per employee as a flat withholding percent on their Tax tab (NJ, for example, has its own tables; use the effective rate your CPA gives you).</p></section>
    <section className="panel stack" style=${{ gap: 12 }}><h2 className="ph">India (salary payroll)</h2>
      <div className="row3"><${Field} label="Financial year"><input value=${cur.in.fy} onInput=${upIN('fy')} /><//><${Field} label="Default regime"><select value=${cur.in.regime} onChange=${upIN('regime')}><option value="new">New regime</option><option value="old">Old regime</option></select><//>${F('Health and education cess %', cur.in.cess, upIN('cess'))}</div>
      <div className="row3">${F('Standard deduction (new regime)', cur.in.newStd, upIN('newStd'))}${F('87A rebate limit (new regime)', cur.in.newRebate, upIN('newRebate'))}${F('Standard deduction (old regime)', cur.in.oldStd, upIN('oldStd'))}</div>
      <div className="row3">${F('EPF employee %', cur.in.pf, upIN('pf'))}${F('EPF wage ceiling', cur.in.pfCapWage, upIN('pfCapWage'))}<label className="check" style=${{ alignSelf: 'end', paddingBottom: 12 }}><input type="checkbox" checked=${!!cur.in.pfCap} onChange=${upIN('pfCap')} /><span>Apply the EPF wage ceiling</span></label></div>
      <div className="row3">${F('Basic as % of gross (default)', cur.in.basicPct, upIN('basicPct'))}${F('ESI applies up to gross (monthly)', cur.in.esiLimit, upIN('esiLimit'))}${F('ESI employee % / employer %', cur.in.esiEmp, upIN('esiEmp'))}</div>
      <div className="row3">${F('ESI employer %', cur.in.esiEr, upIN('esiEr'))}${F('Professional tax per month (default)', cur.in.pt, upIN('pt'))}${F('No professional tax below gross', cur.in.ptMin, upIN('ptMin'))}</div>
      <p className="muted small">New-regime slabs for FY ${cur.in.fy}: nil to ₹4L, 5% to ₹8L, 10% to ₹12L, 15% to ₹16L, 20% to ₹20L, 25% to ₹24L, 30% above, with the 87A rebate making tax nil up to ₹12L taxable. Professional tax varies by state; set the per-person amount on their Tax tab where it differs.</p></section>
    <div className="actions"><button type="button" className="btn" disabled=${!f} onClick=${save}>Save tax settings</button><button type="button" className="btn ghost" onClick=${() => setF({ us: { ...TAX_DEFAULT.us }, in: { ...TAX_DEFAULT.in } })}>Reset to defaults</button></div>
  </div>`;
}

/* ---- Paystub PDF ---- */
async function buildPaystubPdf(s, org) {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica); const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logo = null; try { const r = await fetch(LOGO_L); if (r.ok) logo = await pdf.embedPng(new Uint8Array(await r.arrayBuffer())); } catch (e) { /* no logo */ }
  const navy = rgb(0.063, 0.106, 0.208), grey = rgb(0.42, 0.46, 0.55), teal = rgb(0.012, 0.63, 0.61), band = rgb(0.95, 0.96, 0.98);
  const page = pdf.addPage([612, 792]); const M = n => ascii(fmtMoney(n, s.cur));
  const T = (t, x, y, size, f, color) => page.drawText(ascii(t), { x, y, size, font: f || font, color: color || navy });
  let y = 740;
  if (logo) { const w = 140, h = w * logo.height / logo.width; page.drawImage(logo, { x: 50, y: y - h + 10, width: w, height: h }); }
  T('EARNINGS STATEMENT', 380, y, 16, bold); T(`Pay period: ${s.period || monthLabel(s.mk)}`, 380, y - 18, 9.5, font, grey); T(`Pay date: ${s.paidOn ? fmtDate(s.paidOn, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Pending'}`, 380, y - 31, 9.5, font, grey); y -= 56;
  [org.co || 'StratEdge IT Consulting Inc.', ...(org.addr || '').split('\n'), org.email || CO.email].filter(Boolean).forEach((l, i) => T(l, 50, y - i * 12, i ? 9 : 10.5, i ? font : bold, i ? grey : navy)); y -= 52;
  T('EMPLOYEE', 50, y, 8.5, bold, teal); T(s.n, 50, y - 14, 11, bold); T([s.ti, s.e].filter(Boolean).join('  ·  '), 50, y - 27, 9, font, grey);
  T('DETAILS', 330, y, 8.5, bold, teal); T(`${s.country === 'IN' ? 'India payroll' : 'US payroll'}${s.filing && s.country !== 'IN' ? ', filing: ' + s.filing : ''}${s.regime && s.country === 'IN' ? ', ' + s.regime + ' regime' : ''}`, 330, y - 14, 9.5); T(`Days worked: ${s.days} of ${s.workDays}   Hours: ${h1(s.reg)} regular, ${h1(s.ot)} overtime`, 330, y - 27, 9.5); T(`Payment: ${s.method}`, 330, y - 40, 9.5, font, grey); y -= 66;
  const col = (title, x, rows, w) => { page.drawRectangle({ x, y: y - 4, width: w, height: 18, color: band }); T(title, x + 6, y + 1, 9, bold, grey); T('Amount', x + w - 48, y + 1, 9, bold, grey); let yy = y - 20; rows.forEach(r => { T(r.n.length > 44 ? r.n.slice(0, 43) + '…' : r.n, x + 6, yy, 9.5); const v = M(r.v); T(v, x + w - 6 - font.widthOfTextAtSize(ascii(v), 9.5), yy, 9.5); yy -= 14; }); return yy; };
  const y1 = col('Earnings', 50, s.earnings, 250); const y2 = col('Taxes and deductions', 312, [...s.taxes, ...s.other], 250); y = Math.min(y1, y2) - 10;
  page.drawLine({ start: { x: 50, y }, end: { x: 562, y }, thickness: .6, color: rgb(0.85, 0.88, 0.92) }); y -= 18;
  const tot = [['Gross pay', s.gross], ['Taxes withheld', s.taxT], ...(s.otherT ? [['Other deductions', s.otherT]] : []), ['NET PAY', s.net]];
  tot.forEach(([k, v]) => { const big = k === 'NET PAY'; T(k, 312, y, big ? 12 : 10, big ? bold : font, big ? navy : grey); const t = M(v); T(t, 562 - (big ? bold : font).widthOfTextAtSize(ascii(t), big ? 12 : 10), y, big ? 12 : 10, big ? bold : font); y -= big ? 20 : 15; });
  y -= 6; T('YEAR TO DATE', 50, y, 8.5, bold, teal); T(`Gross ${M(s.ytd.gross)}   Taxes ${M(s.ytd.tax)}   Net ${M(s.ytd.net)}   (${s.yk})`, 50, y - 14, 9.5); y -= 36;
  if (s.employer && s.employer.length) { T('EMPLOYER CONTRIBUTIONS (not deducted from pay)', 50, y, 8.5, bold, teal); s.employer.forEach((r, i) => T(`${r.n}: ${M(r.v)}`, 50, y - 14 - i * 12, 9, font, grey)); y -= 14 + s.employer.length * 12 + 12; }
  T(s.note || '', 50, 54, 7.5, font, grey); T('This statement is computed by the StratEdge portal from recorded time and the pay plan on file; tax amounts are estimates until confirmed by your accountant.', 50, 42, 7.5, font, grey);
  return await pdf.save();
}
function StubView({ s }) {
  const M = n => fmtMoney(n, s.cur);
  return html`<div className="stub">
    <div className="g2" style=${{ gap: 16 }}>
      <div><h4>Earnings</h4><table className="tbl mini"><tbody>${s.earnings.map((r, i) => html`<tr key=${i}><td>${r.n}</td><td className="r num">${M(r.v)}</td></tr>`)}<tr className="sum"><td><b>Gross pay</b></td><td className="r num"><b>${M(s.gross)}</b></td></tr></tbody></table></div>
      <div><h4>Taxes and deductions</h4><table className="tbl mini"><tbody>${[...s.taxes, ...s.other].map((r, i) => html`<tr key=${i}><td>${r.n}</td><td className="r num">${M(r.v)}</td></tr>`)}<tr className="sum"><td><b>Total</b></td><td className="r num"><b>${M(r2(s.taxT + s.otherT))}</b></td></tr></tbody></table></div>
    </div>
    <div className="stub-net"><span>Net pay</span><b>${M(s.net)}</b><small>${s.period ? s.period + ' · ' : ''}${s.days} of ${s.workDays} approved days${s.pending ? ` (${s.pending} awaiting approval)` : ''} · ${h1(s.reg)} h regular, ${h1(s.ot)} h overtime · YTD gross ${M(s.ytd.gross)}, net ${M(s.ytd.net)}${s.conf ? ` · salary confirmed by ${s.conf.byn}` : ''}</small></div>
    ${s.employer.length > 0 && html`<p className="muted small">Employer contributions (not deducted): ${s.employer.map(r => `${r.n} ${M(r.v)}`).join(', ')}. Total cost to company ${M(s.cost)}.</p>`}
    <p className="muted small">${s.note}</p>
  </div>`;
}

/* ---- Payroll runs ---- */
function PayrollRuns() {
  const P = usePortal(); const A = P.admin; const toast = useToast(); const tax = useTaxSettings(); const org = (P.settings && P.settings.inv) || {};
  const ps = payStartOf(P.settings); const req = attApprovalOn(P.settings);
  const [mk, setMk] = useState(cycleFor(dkey(), ps)); const cyc = cycleRange(mk, ps); const [rows, setRows] = useState(null); const [open, setOpen] = useState(null); const [busy, setBusy] = useState('');
  const run = useDoc(`org/acct/runs/${mk}`); const runD = run.data && run.data.st && run.data.st !== 'open' ? run.data : null; const conf = (run.data && run.data.conf) || {};
  const me = (P.prof && P.prof.n) || (Cap.me && Cap.me.name) || 'Admin';
  const emps = A.members.filter(m => m.role !== 'employer' && m.st === 'active' && m.r && m.r.pay && +m.r.pay.amt);
  const ids = emps.map(m => m.id).join(',');
  useEffect(() => {
    if (A.loading || !tax.loaded) return; let live = true; setRows(null);
    pMap(emps, 4, async m => { const [att, prior, stub] = await Promise.all([loadCycleAtt(m.id, cyc), dbList(`pays/${m.id}/items`).catch(() => []), dbGet(`pays/${m.id}/items/${mk}`)]);
      const c = computePay(m.r.pay, att, mk, approvedLeaves(m.u, m.r), P.settings.hol || [], (m.r.payAdj || {})[mk] || [], { from: cyc.from, to: cyc.to, approvals: m.r.attA, requireApproval: req, breakMax: breakMaxOf(P.settings) }); const s = { ...buildStub(m, mk, c, m.r.tax, tax, prior), period: cyc.label, pending: c.pending }; return { m, s, saved: stub }; })
      .then(r => { if (live) setRows(r); });
    return () => { live = false; };
  }, [ids, mk, A.loading, tax.loaded, run.data && run.data.u]);
  const totals = {}; (rows || []).forEach(r => { const t = totals[r.s.cur] = totals[r.s.cur] || { gross: 0, tax: 0, net: 0, cost: 0, n: 0 }; t.gross += r.s.gross; t.tax += r.s.taxT; t.net += r.s.net; t.cost += r.s.cost; t.n++; });
  const confirmOne = async (r) => { try { await dbMerge(`org/acct/runs/${mk}`, { mk, st: run.data && run.data.st ? run.data.st : 'open', conf: { [r.m.id]: { by: P.uid, byn: me, at: Date.now(), net: r.s.net } }, u: Date.now() }); toast(`Salary confirmed for ${firstName(r.s.n)}.`); } catch (e) { toast(errText(e), true); } };
  const confirmAll = async () => { if (!rows) return; try { const c = {}; rows.forEach(r => { if (!conf[r.m.id]) c[r.m.id] = { by: P.uid, byn: me, at: Date.now(), net: r.s.net }; }); if (Object.keys(c).length) await dbMerge(`org/acct/runs/${mk}`, { mk, st: run.data && run.data.st ? run.data.st : 'open', conf: c, u: Date.now() }); toast('All salaries confirmed.'); } catch (e) { toast(errText(e), true); } };
  const unconfirmed = rows ? rows.filter(r => !conf[r.m.id]) : [];
  const pendingDays = rows ? rows.reduce((a, r) => a + (r.s.pending || 0), 0) : 0;
  const finalize = async () => {
    if (!rows || !rows.length) return;
    if (unconfirmed.length) { toast(`Confirm the salary for ${unconfirmed.map(r => firstName(r.s.n)).join(', ')} first.`, true); return; }
    if (pendingDays && !confirm(`${pendingDays} clocked day${pendingDays === 1 ? ' is' : 's are'} still awaiting attendance approval and will not be paid in this run. Finalize anyway?`)) return;
    if (!confirm(`Finalize payroll for ${cyc.label} for ${rows.length} ${rows.length === 1 ? 'person' : 'people'}? Paystubs become visible to employees.`)) return;
    setBusy('final');
    try { const now = Date.now(); for (const r of rows) await dbSet(`pays/${r.m.id}/items/${mk}`, { ...r.s, conf: conf[r.m.id] || null, st: 'final', at: now, by: P.uid, u: now });
      await dbMerge(`org/acct/runs/${mk}`, { mk, st: 'final', n: rows.length, totals: Object.fromEntries(Object.entries(totals).map(([c, t]) => [c, { gross: r2(t.gross), tax: r2(t.tax), net: r2(t.net), cost: r2(t.cost), n: t.n }])), at: now, by: P.uid, byn: me, u: now });
      toast('Payroll finalized. Paystubs are now in each employee\u2019s Earnings page.'); }
    catch (e) { toast(errText(e), true); }
    setBusy('');
  };
  const markPaid = async () => { const d = prompt('Pay date (YYYY-MM-DD)', dkey()); if (!d) return; setBusy('paid'); try { const now = Date.now(); for (const r of rows) await dbMerge(`pays/${r.m.id}/items/${mk}`, { st: 'paid', paidOn: d, u: now }); await dbMerge(`org/acct/runs/${mk}`, { st: 'paid', paidOn: d, u: now }); toast('Marked paid.'); } catch (e) { toast(errText(e), true); } setBusy(''); };
  const emailAll = async () => { setBusy('mail'); let n = 0; try { for (const r of rows) { const stub = (await dbGet(`pays/${r.m.id}/items/${mk}`)) || r.s; const bytes = await buildPaystubPdf(stub, org); const fd = new FormData(); fd.append('path', `pays/${r.m.id}/items/${mk}`); fd.append('file', new Blob([bytes], { type: 'application/pdf' }), `paystub-${mk}.pdf`); const x = await upload('pay_email', fd); if (x.mailed) n++; } toast(n === rows.length ? `Paystubs emailed to ${n} ${n === 1 ? 'person' : 'people'}.` : `${n} of ${rows.length} emailed; check storage/mail.log and the mail settings.`, n !== rows.length); } catch (e) { toast(errText(e), true); } setBusy(''); };
  const exp = async () => { try { await saveDownload(`payroll-${mk}.csv`, toCSV([['Employee', 'Country', 'Currency', 'Days', 'Regular h', 'OT h', 'Gross', ...['Taxes', 'Other deductions', 'Net', 'Employer contributions', 'Total cost']], ...rows.map(r => [r.s.n, r.s.country, r.s.cur, r.s.days, h1(r.s.reg), h1(r.s.ot), r.s.gross, r.s.taxT, r.s.otherT, r.s.net, r.s.employerT, r.s.cost])])); } catch (e) { if (!e || e.code !== 'declined') toast(errText(e), true); } };
  const download = async r => { try { const bytes = await buildPaystubPdf(r.saved || r.s, org); await saveDownload(`paystub-${r.s.n.replace(/\s+/g, '-')}-${mk}.pdf`, new Blob([bytes], { type: 'application/pdf' })); } catch (e) { if (!e || e.code !== 'declined') toast(errText(e), true); } };
  const cur = open && rows && rows.find(r => r.m.id === open);
  if (A.loading) return html`<${Spinner} />`;
  return html`<div className="stack">
    <div className="toolbar"><div className="wknav"><button type="button" className="btn ghost icon" aria-label="Previous pay period" onClick=${() => setMk(addMonths(mk, -1))}><${Icon} n="left" /></button><b>${cyc.label}</b><button className="btn ghost icon" aria-label="Next pay period" disabled=${mk >= cycleFor(dkey(), ps)} onClick=${() => setMk(addMonths(mk, 1))}><${Icon} n="right" /></button></div>
      ${runD && html`<${Chip} s=${runD.st === 'paid' ? 'ok' : 'new'}>${runD.st === 'paid' ? 'Paid ' + fmtDate(runD.paidOn) : 'Finalized ' + fmtDay(runD.at)}<//>`}
      <div className="push"><button type="button" className="btn ghost" disabled=${!rows || !rows.length} onClick=${exp}><${Icon} n="down" />CSV</button>
        ${!runD ? html`${unconfirmed.length > 0 && html`<button type="button" className="btn ghost" disabled=${!rows} onClick=${confirmAll}>Confirm all salaries</button>`}<button type="button" className="btn" disabled=${!rows || !rows.length || !!busy} onClick=${finalize}>${busy === 'final' ? 'Finalizing…' : 'Finalize run'}</button>`
          : html`${runD.st !== 'paid' && html`<button type="button" className="btn go" disabled=${!!busy} onClick=${markPaid}>Mark paid</button>`}<button type="button" className="btn" disabled=${!!busy} onClick=${emailAll}><${Icon} n="send" />${busy === 'mail' ? 'Emailing…' : 'Email paystubs'}</button>`}</div></div>
    ${!emps.length ? html`<div className="panel"><${Empty} title="No pay plans yet">Set a salary or hourly rate on each employee under Team › Pay, and their country and withholding details under Team › Tax. Then run payroll here.<//></div>`
      : rows === null ? html`<${Spinner} label="Computing pay from clock-ins…" />`
      : html`<${Fragment}>
        <div className="kpis" style=${{ gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))' }}>${Object.entries(totals).map(([c, t]) => html`<${Fragment} key=${c}><a><b>${fmtMoney(t.gross, c)}</b><span>Gross (${c}), ${t.n} people</span></a><a><b>${fmtMoney(t.net, c)}</b><span>Net pay (${c})</span></a><a><b>${fmtMoney(t.cost, c)}</b><span>Cost to company (${c})</span></a><//>`)}</div>
        <section className="panel" style=${{ padding: '6px 8px' }}><div className="tblwrap"><table className="tbl"><thead><tr><th>Employee</th><th>Payroll</th><th className="r">Days</th><th className="r">Hours</th><th className="r">Gross</th><th className="r">Taxes</th><th className="r">Net pay</th><th>Salary confirmed</th><th /></tr></thead>
          <tbody>${rows.map(r => html`<tr key=${r.m.id} className="click" tabIndex="0" onClick=${() => setOpen(r.m.id)}><td><${Person} uid=${r.m.id} root=${r.m.u} people=${P.people} sub=${r.s.ti} /></td><td>${r.s.country === 'IN' ? 'India' : 'US'}${r.saved ? html` <${Chip} s=${r.saved.st === 'paid' ? 'ok' : 'new'}>${r.saved.st}<//>` : ''}</td><td className="r num">${r.s.days}/${r.s.workDays}${r.s.pending ? html`<div className="small" style=${{ color: 'var(--amber-ink)' }}>${r.s.pending} awaiting approval</div>` : ''}</td><td className="r num">${h1(r.s.reg + r.s.ot)}</td><td className="r num">${fmtMoney(r.s.gross, r.s.cur)}</td><td className="r num">${fmtMoney(r.s.taxT, r.s.cur)}</td><td className="r num"><b>${fmtMoney(r.s.net, r.s.cur)}</b></td>
            <td>${(r.saved && r.saved.conf) || conf[r.m.id] ? html`<${Chip} s="ok">Confirmed<//><div className="muted small">${((r.saved && r.saved.conf) || conf[r.m.id]).byn}, ${fmtDay(((r.saved && r.saved.conf) || conf[r.m.id]).at)}</div>` : runD ? html`<span className="muted small">—</span>` : html`<button type="button" className="btn go sm" onClick=${e => { e.stopPropagation(); confirmOne(r); }}>Confirm</button>`}</td>
            <td className="r"><button type="button" className="btn ghost sm" onClick=${e => { e.stopPropagation(); download(r); }}><${Icon} n="down" />PDF</button></td></tr>`)}</tbody></table></div></section>
        ${!runD && html`<p className="muted small">Pay period ${cyc.label}, ${rows[0].s.workDays} standard working days. Figures update live from approved clock-ins until you finalize; confirm each salary (or all) before finalizing. If your pay plans already list PF, PT or TDS as deductions, remove them there so the tax engine doesn’t count them twice.</p>`}
      <//>`}
    ${cur && html`<${Modal} wide title=${`${cur.s.n}: ${cyc.label}`} onClose=${() => setOpen(null)} foot=${html`<button type="button" className="btn ghost" onClick=${() => download(cur)}><${Icon} n="down" />Download PDF</button><button type="button" className="btn" onClick=${() => setOpen(null)}>Close</button>`}><${StubView} s=${cur.saved || cur.s} /><//>`}
  </div>`;
}
/* employee's own paystubs */
function MyPaystubs() {
  const P = usePortal(); const toast = useToast(); const col = useCol(`pays/${P.uid}/items`, 'mk:desc'); const org = (P.settings && P.settings.inv) || {};
  const [open, setOpen] = useState(null);
  const download = async s => { try { const bytes = await buildPaystubPdf(s, org); await saveDownload(`paystub-${s.mk}.pdf`, new Blob([bytes], { type: 'application/pdf' })); } catch (e) { if (!e || e.code !== 'declined') toast(errText(e), true); } };
  const cur = open && col.docs.find(s => s.id === open);
  return html`<section className="panel"><div className="ph-row"><h2 className="ph">Paystubs</h2></div>
    ${col.loading ? html`<${Spinner} />` : col.docs.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Period</th><th className="r">Gross</th><th className="r">Taxes</th><th className="r">Net pay</th><th>Status</th><th /></tr></thead>
      <tbody>${col.docs.map(s => html`<tr key=${s.id}><td><b style=${{ fontWeight: 600 }}>${s.period || monthLabel(s.mk)}</b></td><td className="r num">${fmtMoney(s.gross, s.cur)}</td><td className="r num">${fmtMoney(s.taxT, s.cur)}</td><td className="r num"><b>${fmtMoney(s.net, s.cur)}</b></td><td><${Chip} s=${s.st === 'paid' ? 'ok' : 'new'}>${s.st === 'paid' ? 'Paid ' + fmtDate(s.paidOn) : 'Finalized'}<//></td><td className="r"><div className="actions" style=${{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}><button type="button" className="btn ghost sm" onClick=${() => setOpen(s.id)}>View</button><button type="button" className="btn ghost sm" onClick=${() => download(s)}><${Icon} n="down" />PDF</button></div></td></tr>`)}</tbody></table></div>`
      : html`<p className="muted small">Your paystubs appear here after each payroll run is finalized.</p>`}
    ${cur && html`<${Modal} wide title=${'Paystub: ' + monthLabel(cur.mk)} onClose=${() => setOpen(null)} foot=${html`<button type="button" className="btn ghost" onClick=${() => download(cur)}><${Icon} n="down" />Download PDF</button><button type="button" className="btn" onClick=${() => setOpen(null)}>Close</button>`}><${StubView} s=${cur} /><//>`}
  </section>`;
}

/* ---- Reports ---- */
function AcctReports() {
  const toast = useToast(); const inv = useCol('inv'); const exp = useCol('exp'); const runs = useCol('org/acct/runs'); const coa = useCoa();
  const today = dkey(); const [f, setF] = useState({ a: today.slice(0, 4) + '-01-01', b: today, basis: 'accrual', cur: 'USD', tab: 'pl' });
  const inR = (d, k) => d && d >= f.a && d <= f.b;
  const invs = inv.docs.filter(d => d.st !== 'void' && d.st !== 'draft' && d.cur === f.cur);
  const income = f.basis === 'accrual' ? invs.filter(d => inR(d.issue)).reduce((a, d) => a + (+d.total || 0), 0) : invs.reduce((a, d) => a + (d.pays || []).filter(p => inR(p.dt)).reduce((x, p) => x + (+p.a || 0), 0), 0);
  const exps = exp.docs.filter(x => x.cur === f.cur && (f.basis === 'accrual' ? inR(x.d) : (x.st === 'paid' && inR(x.paidOn || x.d))));
  const byCat = {}; exps.forEach(x => { byCat[x.cat] = (byCat[x.cat] || 0) + (+x.a || 0); });
  const payroll = runs.docs.filter(r => r.mk >= f.a.slice(0, 7) && r.mk <= f.b.slice(0, 7)).reduce((a, r) => { const t = (r.totals || {})[f.cur]; return t ? { gross: a.gross + t.gross, tax: a.tax + t.tax, net: a.net + t.net, cost: a.cost + t.cost } : a; }, { gross: 0, tax: 0, net: 0, cost: 0 });
  const expT = Object.values(byCat).reduce((a, v) => a + v, 0) + payroll.cost;
  const aging = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 }; const open = inv.docs.filter(d => ['sent', 'viewed', 'part'].includes(d.st) && d.cur === f.cur);
  open.forEach(d => { const age = d.due ? Math.max(0, Math.round((new Date(today) - new Date(d.due)) / 86400000)) : 0; const k = age <= 30 ? '0-30' : age <= 60 ? '31-60' : age <= 90 ? '61-90' : '90+'; aging[k] += invBalance(d); });
  const ap = exp.docs.filter(x => x.st === 'unpaid' && x.cur === f.cur);
  const M = n => fmtMoney(n, f.cur);
  const csv = async () => { try { const rows = f.tab === 'pl' ? [['Line', 'Amount'], ['Income', r2(income)], ...Object.entries(byCat).map(([k, v]) => [k, r2(v)]), ['Payroll (gross + employer taxes)', r2(payroll.cost)], ['Total expenses', r2(expT)], ['Net profit', r2(income - expT)]] : f.tab === 'ar' ? [['Invoice', 'Client', 'Due', 'Balance'], ...open.map(d => [d.num, d.bill.co, d.due, invBalance(d)])] : f.tab === 'ap' ? [['Vendor', 'Category', 'Due', 'Amount'], ...ap.map(x => [x.v, x.cat, x.due || '', x.a])] : [['Month', 'People', 'Gross', 'Taxes withheld', 'Net', 'Cost to company'], ...runs.docs.filter(r => (r.totals || {})[f.cur]).map(r => [r.mk, r.totals[f.cur].n, r.totals[f.cur].gross, r.totals[f.cur].tax, r.totals[f.cur].net, r.totals[f.cur].cost])]; await saveDownload(`${f.tab}-report-${f.a}-to-${f.b}.csv`, toCSV(rows)); } catch (e) { if (!e || e.code !== 'declined') toast(errText(e), true); } };
  return html`<div className="stack">
    <div className="toolbar"><div className="tabs" role="tablist" style=${{ marginBottom: 0, border: 0 }}>${[['pl', 'Profit and loss'], ['ar', 'Receivables aging'], ['ap', 'Payables'], ['pay', 'Payroll and taxes']].map(([k, v]) => html`<button type="button" key=${k} role="tab" aria-selected=${f.tab === k} className=${f.tab === k ? 'on' : ''} onClick=${() => setF({ ...f, tab: k })}>${v}</button>`)}</div>
      <div className="push" style=${{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><input type="date" value=${f.a} onInput=${e => setF({ ...f, a: e.target.value })} aria-label="From" /><input type="date" value=${f.b} onInput=${e => setF({ ...f, b: e.target.value })} aria-label="To" /><select value=${f.cur} onChange=${e => setF({ ...f, cur: e.target.value })} aria-label="Currency"><option value="USD">USD</option><option value="INR">INR</option></select><select value=${f.basis} onChange=${e => setF({ ...f, basis: e.target.value })} aria-label="Basis"><option value="accrual">Accrual (by invoice date)</option><option value="cash">Cash (by payment date)</option></select><button type="button" className="btn ghost" onClick=${csv}><${Icon} n="down" />CSV</button></div></div>
    ${f.tab === 'pl' && html`<section className="panel"><h2 className="ph" style=${{ marginBottom: 12 }}>Profit and loss, ${fmtDate(f.a, { month: 'short', day: 'numeric', year: 'numeric' })} to ${fmtDate(f.b, { month: 'short', day: 'numeric', year: 'numeric' })} (${f.basis})</h2>
      <table className="tbl"><tbody>
        <tr className="sum"><td><b>Income</b></td><td className="r num"><b>${M(income)}</b></td></tr><tr><td className="muted">Invoices (${invs.filter(d => f.basis === 'accrual' ? inR(d.issue) : true).length})</td><td className="r num">${M(income)}</td></tr>
        <tr className="sum"><td><b>Expenses</b></td><td className="r num"><b>${M(expT)}</b></td></tr>${Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => html`<tr key=${k}><td className="muted">${k}</td><td className="r num">${M(v)}</td></tr>`)}${payroll.cost > 0 && html`<tr><td className="muted">Payroll (gross ${M(payroll.gross)} + employer taxes)</td><td className="r num">${M(payroll.cost)}</td></tr>`}
        <tr className="sum"><td><b>Net profit</b></td><td className="r num"><b style=${{ color: income - expT >= 0 ? 'var(--ok-ink)' : 'var(--red-ink)' }}>${M(income - expT)}</b></td></tr>
      </tbody></table></section>`}
    ${f.tab === 'ar' && html`<section className="panel"><h2 className="ph" style=${{ marginBottom: 12 }}>Receivables aging (${f.cur})</h2>
      <div className="kpis" style=${{ gridTemplateColumns: 'repeat(4,minmax(0,1fr))', marginBottom: 14 }}>${Object.entries(aging).map(([k, v]) => html`<a key=${k}><b>${M(v)}</b><span>${k === '0-30' ? 'Current to 30 days' : k + ' days past due'}</span></a>`)}</div>
      ${open.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Invoice</th><th>Client</th><th>Due</th><th className="r">Balance</th></tr></thead><tbody>${open.sort((a, b) => (a.due || '').localeCompare(b.due || '')).map(d => html`<tr key=${d.id}><td>${d.num}</td><td>${d.bill.co}</td><td className="num">${d.due ? fmtDate(d.due) : '—'}</td><td className="r num">${M(invBalance(d))}</td></tr>`)}</tbody></table></div>` : html`<${Empty} title="Nothing outstanding" />`}</section>`}
    ${f.tab === 'ap' && html`<section className="panel"><h2 className="ph" style=${{ marginBottom: 12 }}>Unpaid bills (${f.cur}): ${M(ap.reduce((a, x) => a + (+x.a || 0), 0))}</h2>
      ${ap.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Vendor</th><th>Category</th><th>Due</th><th className="r">Amount</th></tr></thead><tbody>${ap.sort((a, b) => (a.due || '').localeCompare(b.due || '')).map(x => html`<tr key=${x.id}><td>${x.v}</td><td>${x.cat}</td><td className="num">${x.due ? fmtDate(x.due) : '—'}${expOverdue(x) ? html` <${Chip} s="red">Overdue<//>` : ''}</td><td className="r num">${M(x.a)}</td></tr>`)}</tbody></table></div>` : html`<${Empty} title="No unpaid bills" />`}</section>`}
    ${f.tab === 'pay' && html`<section className="panel"><h2 className="ph" style=${{ marginBottom: 12 }}>Payroll and withheld taxes (${f.cur})</h2>
      <div className="kpis" style=${{ gridTemplateColumns: 'repeat(4,minmax(0,1fr))', marginBottom: 14 }}><a><b>${M(payroll.gross)}</b><span>Gross pay in range</span></a><a><b>${M(payroll.tax)}</b><span>Taxes withheld</span></a><a><b>${M(payroll.net)}</b><span>Net paid</span></a><a><b>${M(payroll.cost - payroll.gross)}</b><span>Employer contributions</span></a></div>
      ${runs.docs.filter(r => (r.totals || {})[f.cur]).length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Month</th><th className="r">People</th><th className="r">Gross</th><th className="r">Taxes withheld</th><th className="r">Net</th><th className="r">Cost to company</th><th>Status</th></tr></thead><tbody>${runs.docs.filter(r => (r.totals || {})[f.cur]).sort((a, b) => b.mk.localeCompare(a.mk)).map(r => html`<tr key=${r.id}><td>${monthLabel(r.mk)}</td><td className="r num">${r.totals[f.cur].n}</td><td className="r num">${M(r.totals[f.cur].gross)}</td><td className="r num">${M(r.totals[f.cur].tax)}</td><td className="r num">${M(r.totals[f.cur].net)}</td><td className="r num">${M(r.totals[f.cur].cost)}</td><td><${Chip} s=${r.st === 'paid' ? 'ok' : 'new'}>${r.st}<//></td></tr>`)}</tbody></table></div>` : html`<${Empty} title="No payroll runs in this currency yet" />`}
      <p className="muted small" style=${{ marginTop: 12 }}>Use the withheld-tax totals for Form 941 deposits (US) and TDS, EPF and ESI remittances (India); the per-person breakdown is on each paystub and in the payroll CSV.</p></section>`}
  </div>`;
}

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
  return html`<${Modal} wide title=${c.n} onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Close</button><button type="button" className="btn" disabled=${!!busy} onClick=${save}>${busy === 'save' ? 'Saving…' : 'Save'}</button>`}>
    <div className="stack">
      <div className="actions"><${Chip} s=${atsChip(c.st)}>${ATS_ST[c.st]}<//><${Stars} v=${+f.rating} onChange=${v => setF({ ...f, rating: v })} /><span className="muted small">Applied ${fmtDay(c.at)}${c.src ? ' via ' + c.src : ''}</span>
        <div className="push" style=${{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>${Object.keys(ATS_TEMPLATES).map(k => html`<button type="button" key=${k} className="btn ghost sm" onClick=${() => openMail(k)}><${Icon} n="send" />${k === 'screen' ? 'Email: screening call' : k === 'interview' ? 'Email: interview' : k === 'offer' ? 'Email: offer' : 'Email: not selected'}</button>`)}</div></div>
      <div className="form">
        <div className="row3"><${Field} label="Name"><input value=${f.n} onInput=${up('n')} /><//><${Field} label="Email"><input type="email" value=${f.e} onInput=${up('e')} /><//><${Field} label="Phone"><input value=${f.ph || ''} onInput=${up('ph')} /><//></div>
        <div className="row3"><${Field} label="Role applied for"><input value=${f.jt || ''} onInput=${up('jt')} list="atsjobs" /><datalist id="atsjobs">${jobs.map(j => html`<option key=${j.id} value=${j.t} />`)}</datalist><//><${Field} label="Stage"><select value=${f.st} onChange=${up('st')}>${Object.entries(ATS_ST).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//><${Field} label="Source"><input value=${f.src || ''} onInput=${up('src')} placeholder="Website, LinkedIn, referral" /><//></div>
        <div className="row3"><${Field} label="LinkedIn"><input value=${f.li || ''} onInput=${up('li')} /><//><${Field} label="Interview date and time"><input type="datetime-local" value=${f.intv || ''} onInput=${up('intv')} /><//><${Field} label="Interview details"><input value=${f.intvNote || ''} onInput=${up('intvNote')} placeholder="Panel, link, location" /><//></div>
      </div>
      ${c.msg && html`<div className="note info"><span style=${{ whiteSpace: 'pre-wrap' }}><b>Cover note.</b> ${c.msg}</span></div>`}
      <div><span className="lbl">Resume</span>${c.rid ? html`<ul className="files" style=${{ marginTop: 8 }}><li><${Icon} n="file" /><div className="fn"><b>${c.rn || 'Resume'}</b></div><${FileActions} base=${'ats/' + c.id} f=${{ id: c.rid, n: c.rn || 'resume', ty: '' }} /></li></ul>` : html`<p className="muted small">No resume attached.</p>`}
        <div style=${{ marginTop: 8 }}><${FilePick} busy=${busy === 'file'} progress=${prog} onFiles=${onFiles} label=${c.rid ? 'Replace the resume.' : 'Attach a resume.'} /></div></div>
      <div><span className="lbl">Notes</span>${(c.notes || []).length ? html`<ul className="list" style=${{ marginTop: 6 }}>${c.notes.slice().reverse().map((n, i) => html`<li key=${i}><div><div className="t" style=${{ fontWeight: 500 }}>${n.x}</div><div className="m">${n.who}</div></div><span className="muted small num">${fmtTs(n.t)}</span></li>`)}</ul>` : null}
        <div className="actions" style=${{ marginTop: 8 }}><input value=${note} onInput=${e => setNote(e.target.value)} placeholder="Add a note (screening feedback, rate, availability)" style=${{ flex: 1 }} onKeyDown=${e => { if (e.key === 'Enter') addNote(); }} /><button type="button" className="btn ghost" disabled=${busy === 'note'} onClick=${addNote}>Add</button></div></div>
      <div><h3 className="ph" style=${{ marginBottom: 8 }}>History</h3><ul className="list">${(c.log || []).slice().reverse().map((l, i) => html`<li key=${i}><div><div className="t">${l.ev}</div><div className="m">${l.who}</div></div><span className="muted small num">${fmtTs(l.t)}</span></li>`)}</ul></div>
    </div>
    ${mail && html`<${Modal} title=${'Email ' + c.n} onClose=${() => setMail(null)} foot=${html`<button type="button" className="btn ghost" onClick=${() => setMail(null)}>Cancel</button><button type="button" className="btn" disabled=${busy === 'mail'} onClick=${sendMailNow}><${Icon} n="send" />${busy === 'mail' ? 'Sending…' : 'Send'}</button>`}>
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
  return html`<${Modal} title="Add a candidate" onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Cancel</button><button type="button" className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Add candidate'}</button>`}>
    <div className="form"><div className="row2"><${Field} label="Name"><input value=${f.n} onInput=${up('n')} /><//><${Field} label="Email"><input type="email" value=${f.e} onInput=${up('e')} /><//></div>
      <div className="row3"><${Field} label="Phone"><input value=${f.ph} onInput=${up('ph')} /><//><${Field} label="Role"><input value=${f.jt} onInput=${up('jt')} list="atsjobs2" /><datalist id="atsjobs2">${jobs.map(j => html`<option key=${j.id} value=${j.t} />`)}</datalist><//><${Field} label="Source"><input value=${f.src} onInput=${up('src')} /><//></div>
      <div><span className="lbl">Resume</span>${file ? html`<ul className="files" style=${{ marginTop: 8 }}><li><${Icon} n="file" /><div className="fn"><b>${file.name}</b></div><button type="button" className="btn ghost sm" onClick=${() => setFile(null)}>Remove</button></li></ul>` : html`<div style=${{ marginTop: 8 }}><${FilePick} busy=${busy} progress=${prog} onFiles=${fs => setFile(fs[0])} /></div>`}</div></div><//>`;
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
    <div className="toolbar"><div className="seg" style=${{ marginBottom: 0 }}>${[['board', 'Pipeline'], ['list', 'List']].map(([k, v]) => html`<button type="button" key=${k} className=${view === k ? 'on' : ''} onClick=${() => setView(k)}>${v}</button>`)}</div>
      <input type="search" style=${{ maxWidth: 220 }} placeholder="Search candidates" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Search candidates" />
      <select value=${job} onChange=${e => setJob(e.target.value)} aria-label="Filter by role" style=${{ maxWidth: 240 }}><option value="">All roles</option>${jobTitles.map(t => html`<option key=${t}>${t}</option>`)}</select>
      ${view === 'list' && html`<select value=${stage} onChange=${e => setStage(e.target.value)} aria-label="Stage" style=${{ maxWidth: 170 }}><option value="active">Active</option>${Object.entries(ATS_ST).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}<option value="all">All</option></select>`}
      <div className="push"><a className="btn ghost" href="#/portal/admin/website?tab=jobs">Job postings</a><button type="button" className="btn" onClick=${() => setAdd(true)}><${Icon} n="plus" />Add candidate</button></div></div>
    ${interviews.length > 0 && html`<div className="note info"><span><b>Upcoming interviews:</b> ${interviews.slice(0, 4).map(c => `${c.n} on ${c.intv.replace('T', ' at ')}`).join('; ')}</span></div>`}
    ${col.loading ? html`<${Spinner} />` : view === 'board' ? html`<div className="board">${Object.entries(ATS_ST).map(([k, v]) => { const cards = docs.filter(c => c.st === k); return html`<div key=${k} className="col"><div className="col-h"><span>${v}</span><span className="chip">${cards.length}</span></div>
        ${cards.map(c => html`<div key=${c.id} className="card click" tabIndex="0" onClick=${() => setOpen(c.id)} onKeyDown=${e => { if (e.key === 'Enter') setOpen(c.id); }}><b>${c.n}</b><div className="muted small">${c.jt || 'No role'}</div><div className="actions" style=${{ marginTop: 6, justifyContent: 'space-between' }}><${Stars} v=${c.rating} /><span className="muted small">${fmtDate(dkey(new Date(c.at)))}</span></div>${c.intv && html`<div className="small" style=${{ marginTop: 4, color: 'var(--indigo-ink)' }}>Interview ${c.intv.replace('T', ' ')}</div>`}</div>`)}
        ${!cards.length && html`<div className="muted small" style=${{ padding: 10 }}>Empty</div>`}</div>`; })}</div>`
      : html`<section className="panel" style=${{ padding: '6px 8px' }}>${list.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Candidate</th><th>Role</th><th>Stage</th><th>Rating</th><th>Source</th><th>Applied</th><th>Resume</th></tr></thead>
        <tbody>${list.map(c => html`<tr key=${c.id} className="click" tabIndex="0" onClick=${() => setOpen(c.id)}><td><b style=${{ fontWeight: 600 }}>${c.n}</b><div className="muted small">${c.e}${c.ph ? ', ' + c.ph : ''}</div></td><td>${c.jt || '—'}</td><td><${Chip} s=${atsChip(c.st)}>${ATS_ST[c.st]}<//></td><td><${Stars} v=${c.rating} /></td><td>${c.src || '—'}</td><td className="num">${fmtDay(c.at)}</td><td>${c.rid ? html`<a className="btn ghost sm" href=${fileUrl('ats/' + c.id, c.rid, true)} onClick=${e => e.stopPropagation()}><${Icon} n="down" />Resume</a>` : html`<span className="muted small">None</span>`}</td></tr>`)}</tbody></table></div>`
        : html`<${Empty} title="No candidates here" action=${html`<button type="button" className="btn" onClick=${() => setAdd(true)}>Add a candidate</button>`}>Applications from the website Careers page land here automatically with their resume. Move candidates through screening, interview and offer, and email them from their card.<//>`}</section>`}
    ${cur && html`<${CandidateModal} key=${cur.id + cur.u} c=${cur} jobs=${jobsCol.docs} onClose=${() => setOpen(null)} />`}
    ${add && html`<${AddCandidate} jobs=${jobsCol.docs} onClose=${() => setAdd(false)} />`}
  </div>`;
}

/* ================= Admin: shared ================= */
function AdminKpis() {
  const A = usePortal().admin; const logs = useCol('log'); const online = logs.docs.filter(d => d.seen && Date.now() - d.seen < 10 * 60000).length;
  return html`<div className="kpis">
    <a href="#/portal/admin/logins"><b>${online}</b><span>Signed in now</span></a>
    <a href="#/portal/admin/attendance"><b>${A.onClock.length}</b><span>On the clock now</span></a>
    <a href="#/portal/admin/approvals"><b>${A.pendTs.length}</b><span>Timesheets to approve</span></a>
    <a href="#/portal/admin/approvals?tab=leave"><b>${A.pendLv.length}</b><span>Time-off requests</span></a>
    <a href="#/portal/admin/team?tab=new"><b>${A.requests.length}</b><span>Access requests</span></a>
    <a href="#/portal/admin/website?tab=inbox"><b>${A.unread}</b><span>New inquiries</span></a>
  </div>`;
}
const InviteSteps = () => html`<section className="panel"><h2 className="ph" style=${{ marginBottom: 10 }}>How people get access</h2>
  <ol style=${{ margin: 0, paddingLeft: 20, display: 'grid', gap: 8, color: 'var(--ink-2)' }}>
    <li>Send them to the website's <b>Log in</b> page. They create an account with their email and a password, choose "consultant" or "client contact", and fill in their profile.</li>
    <li>They appear here under Access requests. Approve them and set their client, projects and engagement type. Client contacts get linked to their company.</li>
    <li>Give StratEdge colleagues admin access from their member card. Reset a forgotten password from the same place.</li>
  </ol></section>`;
const tsRowsFor = d => (d && d.rows) || [];
const clientOf = (A, m) => (m.r && m.r.cid && A.clientsById[m.r.cid]) || null;
async function loadReqs(A) {
  const emps = A.members.filter(m => m.role === 'employer' && m.r && m.r.cid);
  const lists = await pMap(emps, 4, m => dbList(`e/${m.id}/req`).catch(() => []));
  const out = []; emps.forEach((m, i) => lists[i].forEach(r => out.push({ ...r, m, cl: (clientOf(A, m) || {}).n || m.r.cl || '' })));
  return out.sort((a, b) => (b.at || 0) - (a.at || 0));
}

/* Timesheet review (admin) */
function TsReview({ m, w, onClose }) {
  const P = usePortal(); const toast = useToast();
  const [d, setD] = useState(undefined); const [att, setAtt] = useState(null); const [pubd, setPubd] = useState(undefined);
  const [c, setC] = useState(''); const [busy, setBusy] = useState(false);
  const cid = m.r && m.r.cid;
  useEffect(() => {
    dbGet(`u/${m.id}/ts/${w}`).then(setD).catch(e => { toast(errText(e), true); setD(null); });
    if (cid) dbGet(`pub/${cid}/ts/${m.id}_${w}`).then(setPubd).catch(() => setPubd(null)); else setPubd(null);
    (async () => {
      const days = weekDays(w); const docs = {};
      for (const x of [...new Set(days.map(mkey))]) docs[x] = await dbGet(`u/${m.id}/att/${x}`);
      setAtt(days.map(k => ((((docs[mkey(k)] || {}).days || {})[k] || {}).s || []).reduce((a, s) => a + (s.o ? mins(s.i, s.o) : 0), 0)));
    })().catch(() => setAtt(null));
  }, []);
  const sum = (m.u.ts || {})[w]; const rev = ((m.r || {}).rev || {})[w]; const st = tsStatus(sum, rev);
  const cst = cid && sum && sum.s === 'submitted' ? cdStatus(pubd) : 'none';
  const decide = async s => {
    if ((s === 'rejected' || s === 'reopened') && !c.trim()) { toast('Add a note so the consultant knows what to change.', true); return; }
    setBusy(true);
    try {
      await dbMerge(`r/${m.id}`, { rev: { [w]: { s, c: c.trim(), at: Date.now(), by: P.uid, v: sum.u } } });
      toast(s === 'approved' ? 'Timesheet approved.' : s === 'rejected' ? 'Timesheet returned with your note.' : 'Timesheet reopened.'); onClose();
    } catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  const days = weekDays(w); const rows = tsRowsFor(d);
  const dayT = DOW.map((_, i) => rows.reduce((a, r) => a + (r.h[i] || 0), 0));
  const foot = st === 'pending' ? html`<button type="button" className="btn danger" disabled=${busy} onClick=${() => decide('rejected')}>Return with note</button><button type="button" className="btn go" disabled=${busy} onClick=${() => decide('approved')}>Approve timesheet</button>`
    : st === 'approved' ? html`<button type="button" className="btn ghost" disabled=${busy} onClick=${() => decide('reopened')}>Reopen for changes</button>` : html`<button type="button" className="btn ghost" onClick=${onClose}>Close</button>`;
  return html`<${Modal} wide title=${`${nameOf(m.id, m.u, P.people)}: ${weekLabel(w)}`} onClose=${onClose} foot=${foot}>
    ${d === undefined ? html`<${Spinner} />` : !d ? html`<${Empty} title="This timesheet isn't available">It may have been withdrawn.<//>` : html`<div className="stack">
      <div className="actions"><${Chip} s=${st}>${TS_LABEL[st]}<//>${cst !== 'none' && html`<${Chip} s=${cst === 'approved' ? 'ok' : cst === 'returned' ? 'red' : 'amber'}>${CD_LABEL[cst]}<//>`}<span className="muted small">${sum && sum.sa ? 'Submitted ' + fmtTs(sum.sa) : 'Not submitted'}${m.r && m.r.cl ? ', ' + m.r.cl : ''}${m.r && m.r.ec ? ' for ' + m.r.ec : ''}</span></div>
      ${pubd && pubd.cd && cst !== 'pending' && html`<div className=${'note ' + (cst === 'approved' ? 'ok' : 'red')}><span><b>Client ${cst === 'approved' ? 'approved' : 'returned'} ${fmtDay(pubd.cd.at)}.</b> ${pubd.cd.c || ''}</span></div>`}
      ${cid && pubd && pubd.t !== undefined && sum && pubd.u !== sum.u && pubd.s === 'submitted' && html`<div className="note amber"><span>The copy shared with the client differs from this submission. Ask the consultant to resubmit.</span></div>`}
      <div className="tblwrap"><table className="tbl">
        <thead><tr><th>Project</th><th>Task</th>${days.map((k, i) => html`<th key=${k} className="r">${DOW[i]} ${parseD(k).getDate()}</th>`)}<th className="r">Total</th></tr></thead>
        <tbody>${rows.map((r, i) => html`<tr key=${i}><td>${r.p}</td><td>${r.t}</td>${r.h.map((x, j) => html`<td key=${j} className="r num">${x ? h1(x) : ''}</td>`)}<td className="r num"><b>${h1(r.h.reduce((a, b) => a + b, 0))}</b></td></tr>`)}
          <tr><td colSpan="2"><b>Timesheet total</b></td>${dayT.map((t, i) => html`<td key=${i} className="r num"><b>${h1(t)}</b></td>`)}<td className="r num"><b>${h1(dayT.reduce((a, b) => a + b, 0))}</b></td></tr>
          ${att && html`<tr className="sub"><td colSpan="2">Clocked in the portal</td>${att.map((t, i) => html`<td key=${i} className="r num">${t ? h1(t / 60) : ''}</td>`)}<td className="r num">${h1(att.reduce((a, b) => a + b, 0) / 60)}</td></tr>`}
        </tbody></table></div>
      ${d.note && html`<div className="note info"><span><b>Note from consultant:</b> ${d.note}</span></div>`}
      <div><h3 className="ph" style=${{ marginBottom: 8 }}>Attachments</h3>
        ${(d.files || []).length ? html`<ul className="files">${d.files.map(f => html`<li key=${f.id}><${Icon} n="file" /><div className="fn"><b>${f.n}</b><span>${sizeLabel(f.sz || 0)}</span></div><${FileActions} base=${'u/' + m.id} f=${f} /></li>`)}</ul>`
          : html`<p className="muted small">No attachments.${m.r && m.r.na ? ' This consultant is set to require a signed timesheet.' : ''}</p>`}</div>
      ${(st === 'pending' || st === 'approved') && html`<${Field} label=${st === 'pending' ? 'Note to consultant (required to return)' : 'Reason for reopening'}><textarea value=${c} onInput=${e => setC(e.target.value)} placeholder=${st === 'pending' ? 'e.g. Thursday hours don\u2019t match the client-signed sheet' : 'What should they change?'} /><//>`}
    </div>`}<//>`;
}

/* ================= Admin: overview ================= */
function AdminOverview() {
  const P = usePortal(); const A = P.admin;
  const [reqs, setReqs] = useState(null);
  useEffect(() => { if (!A.loading) loadReqs(A).then(setReqs).catch(() => setReqs([])); }, [A.loading, A.employers.length]);
  if (A.loading) return html`<${Spinner} />`;
  const openReqs = (reqs || []).filter(r => !['filled', 'closed'].includes(r.st || 'open'));
  return html`<div className="stack">
    <${AdminKpis} />
    <div className="g2" style=${{ alignItems: 'start' }}>
      <section className="panel"><div className="ph-row"><h2 className="ph">On the clock now</h2><a className="small" href="#/portal/admin/attendance">Team attendance</a></div>
        ${A.onClock.length ? html`<ul className="list">${A.onClock.map(m => html`<li key=${m.id}><${Person} uid=${m.id} root=${m.u} people=${P.people} sub=${(m.r && m.r.cl) || m.u.p.ti} />
          <span className="muted small num">Since ${fmtTime(m.u.clock.i)}${m.u.clock.d !== dkey() ? ', ' + fmtDate(m.u.clock.d) : ''}<br />${MODES[m.u.clock.m] || ''}</span></li>`)}</ul>`
          : html`<${Empty} title="Nobody is clocked in right now" />`}</section>
      <section className="panel"><div className="ph-row"><h2 className="ph">Waiting on you</h2><a className="small" href="#/portal/admin/approvals">All approvals</a></div>
        ${A.pendTs.length + A.pendLv.length + A.requests.length + openReqs.length ? html`<ul className="list">
          ${A.requests.slice(0, 3).map(m => html`<li key=${'r' + m.id}><${Person} uid=${m.id} root=${m.u} people=${P.people} sub=${'Access request, ' + (m.role === 'employer' ? 'client contact' : m.role === 'employee' ? 'StratEdge employee' : m.role === 'bench' ? 'bench sales recruiter' : 'consultant')} /><a className="btn ghost sm" href="#/portal/admin/team?tab=new">Review</a></li>`)}
          ${A.pendTs.slice(0, 5).map(x => html`<li key=${x.m.id + x.w}><${Person} uid=${x.m.id} root=${x.m.u} people=${P.people} sub=${`Timesheet, ${weekLabel(x.w)}, ${h1(x.s.t)} h`} /><a className="btn ghost sm" href="#/portal/admin/approvals">Review</a></li>`)}
          ${A.pendLv.slice(0, 3).map(x => html`<li key=${x.id}><${Person} uid=${x.m.id} root=${x.m.u} people=${P.people} sub=${`${LEAVE_K[x.l.k]}, ${fmtDate(x.l.f)}`} /><a className="btn ghost sm" href="#/portal/admin/approvals?tab=leave">Review</a></li>`)}
          ${openReqs.slice(0, 3).map(r => html`<li key=${r.m.id + r.id}><div><div className="t">${r.ti}</div><div className="m">Requirement from ${r.cl}, ${REQ_ST[r.st || 'open']}</div></div><a className="btn ghost sm" href="#/portal/admin/requirements">Open</a></li>`)}
        </ul>` : html`<${Empty} title="Nothing waiting">Timesheets, time off, access requests and client requirements that need a decision show up here.<//>`}</section>
    </div>
    ${A.members.length < 4 && html`<${InviteSteps} />`}
  </div>`;
}

/* ================= Admin: team ================= */
function MemberModal({ m, onClose }) {
  const P = usePortal(); const A = P.admin; const toast = useToast();
  const r = m.r || {};
  const [f, setF] = useState({ st: m.st === 'new' ? 'active' : m.st, role: m.role, cid: r.cid || '', ty: r.ty || 'C2C', cl: r.cl || (m.role === 'employer' ? m.u.p.co || '' : ''), ec: r.ec || '', pr: r.pr || '', mgr: r.mgr || '', sd: r.sd || '', na: !!r.na, norec: !!r.norec, br: r.br || '', brc: r.brc || 'USD' });
  const [newC, setNewC] = useState({ n: m.u.p.co || '', ec: '' });
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('ts');
  const [rv, setRv] = useState(null);
  const up = k => e => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const pickClient = e => {
    const v = e.target.value; const c = A.clientsById[v];
    setF({ ...f, cid: v, ...(c ? { cl: c.n, ec: c.ec || f.ec } : {}) });
  };
  const emp = f.role === 'employer';
  const save = async () => {
    if (emp && !f.cid) { toast('Choose the company this contact belongs to, or add it as a new client.', true); return; }
    if (f.cid === '__new' && !newC.n.trim()) { toast('Add the new client\u2019s name.', true); return; }
    setBusy(true);
    try {
      let cid = f.cid; let cl = f.cl, ec = f.ec;
      if (cid === '__new') { cid = token(); await dbSet(`org/admin/clients/${cid}`, { n: newC.n.trim(), ec: newC.ec.trim(), at: Date.now(), by: P.uid }); cl = newC.n.trim(); ec = newC.ec.trim() || ec; }
      const now = Date.now();
      await dbMerge(`r/${m.id}`, { st: f.st, role: f.role, cid: cid || null, ty: f.ty, cl, ec, pr: f.pr, mgr: f.mgr, sd: f.sd, na: f.na, norec: !emp && !!f.norec, br: r2(f.br), brc: f.brc || 'USD', at: now, by: P.uid });
      if (!m.self) { try { await api('admin_status', { uid: m.id, status: f.st === 'active' ? 'active' : 'disabled' }); } catch (e) { /* account status is secondary */ } A.loadAccounts(); }
      if (r.cid && r.role !== 'employer' && r.cid !== cid) await dbDel(`pub/${r.cid}/roster/${m.id}`).catch(() => {});
      if (!emp && cid) await dbSet(`pub/${cid}/roster/${m.id}`, { n: m.u.p.n, ti: m.u.p.ti || '', sd: f.sd || '', st: f.st === 'active' ? 'active' : 'inactive', at: now });
      if (emp && r.cid && r.role !== 'employer') await dbDel(`pub/${r.cid}/roster/${m.id}`).catch(() => {});
      toast(m.st === 'new' ? `${firstName(m.u.p.n)} is approved and can use the ${portalLabel(f.role).toLowerCase()}.` : 'Saved.'); if (m.st === 'new') onClose();
    } catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  const p = m.u.p; const acct = A.accounts[m.id];
  const [temp, setTemp] = useState('');
  const resetPw = async () => { setBusy(true); try { const r = await api('admin_reset', { uid: m.id }); setTemp(r.password); } catch (e) { toast(errText(e), true); } setBusy(false); };
  const toggleAdmin = async e => { const role = e.target.value; try { await api('admin_role', { uid: m.id, role }); A.loadAccounts(); toast(role === 'admin' ? `${firstName(p.n)} now has admin access.` : role === 'hr' ? `${firstName(p.n)} now has HR portal access.` : role === 'acct' ? `${firstName(p.n)} now has accounting portal access.` : 'Staff access removed.'); } catch (x) { toast(errText(x), true); } };
  const startOnb = async () => { setBusy(true); try { await dbMerge(`r/${m.id}`, { onb: { kind: 'onb', started: Date.now(), items: {}, by: P.uid } }); toast('Onboarding checklist started. They see it in their portal.'); } catch (x) { toast(errText(x), true); } setBusy(false); };
  return html`<${Modal} wide title=${p.n} onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Close</button><button type="button" className=${'btn' + (m.st === 'new' ? ' go' : '')} disabled=${busy} onClick=${save}>${m.st === 'new' ? 'Approve access' : 'Save'}</button>`}>
    <div className="stack">
      <div className="g2">
        <dl className="kv"><dt>Requested</dt><dd>${portalLabel(p.role)}${p.co ? ', ' + p.co : ''}</dd><dt>Email</dt><dd><a href=${'mailto:' + p.e}>${p.e}</a></dd>${p.ph && html`<dt>Phone</dt><dd><a href=${'tel:' + p.ph}>${p.ph}</a></dd>`}
          ${p.ti && html`<dt>Title</dt><dd>${p.ti}</dd>`}${p.loc && html`<dt>Location</dt><dd>${p.loc}</dd>`}<dt>Joined portal</dt><dd>${m.u.joined ? fmtDay(m.u.joined) : '—'}</dd></dl>
        <div className="form">
          <div className="row2"><${Field} label="Status"><select value=${f.st} onChange=${up('st')}><option value="active">Active</option><option value="inactive">Inactive (access paused)</option></select><//>
            <${Field} label="Portal" hint="Consultants get resume matching and jobs; employees get the recruiting workspace; bench sales recruiters get the job grabber and recruiting workspace."><select value=${f.role} onChange=${up('role')}><option value="consultant">Consultant portal</option><option value="employee">Employee portal (StratEdge staff)</option><option value="bench">Bench sales portal (recruiter)</option><option value="employer">Client portal (client contact)</option></select><//></div>
          <${Field} label=${emp ? 'Company' : 'Client company'} hint=${emp ? 'Their company\u2019s client workspace.' : 'Links this consultant to a client workspace so the client can approve their timesheets.'}>
            <select value=${f.cid} onChange=${pickClient}><option value="">${emp ? 'Choose a client' : 'No client workspace'}</option>${A.clients.map(c => html`<option key=${c.id} value=${c.id}>${c.n}${c.ec ? ' (' + c.ec + ')' : ''}</option>`)}<option value="__new">Add a new client…</option></select><//>
          ${f.cid === '__new' && html`<div className="row2"><${Field} label="New client name"><input value=${newC.n} onInput=${e => setNewC({ ...newC, n: e.target.value })} /><//><${Field} label="End client (optional)"><input value=${newC.ec} onInput=${e => setNewC({ ...newC, ec: e.target.value })} /><//></div>`}
          ${!emp && html`<${Fragment}>
            <div className="row2"><${Field} label="Engagement"><select value=${f.ty} onChange=${up('ty')}>${EMP_TYPES.map(t => html`<option key=${t}>${t}</option>`)}</select><//><${Field} label="Start date"><input type="date" value=${f.sd} onInput=${up('sd')} /><//></div>
            <div className="row2"><${Field} label="Billed to (client or vendor)"><input value=${f.cl} onInput=${up('cl')} placeholder="Who you invoice" /><//><${Field} label="End client"><input value=${f.ec} onInput=${up('ec')} /><//></div>
            <${Field} label="Projects" hint="Comma-separated. These become the project choices on their timesheet."><input value=${f.pr} onInput=${up('pr')} placeholder="e.g. Network refresh, SAP rollout" /><//>
            <div className="row2"><${Field} label="Timesheet approver"><input value=${f.mgr} onInput=${up('mgr')} placeholder="Client manager name" /><//>
              <${Field} label="Bill rate to client (per hour)" hint="Used when invoices pull approved hours."><div style=${{ display: 'flex', gap: 8 }}><input type="number" step="0.01" min="0" value=${f.br} onInput=${up('br')} placeholder="e.g. 85" /><select value=${f.brc} onChange=${up('brc')} style=${{ maxWidth: 110 }}><option value="USD">USD</option><option value="INR">INR</option></select></div><//></div>
            <label className="check"><input type="checkbox" checked=${f.na} onChange=${up('na')} /><span>Require a client-signed timesheet attachment before submitting</span></label>
          <//>`}
        </div>
      </div>
      <div className="panel" style=${{ background: 'var(--surface-2)', display: 'grid', gap: 10 }}><h3 className="ph">Account</h3>
        <p className="muted small">Signs in with ${acct ? acct.email : p.e}${acct && acct.status === 'disabled' ? '. Account paused.' : ''}</p>
        ${acct && !m.self && html`<div style=${{ maxWidth: 420 }}><${Field} label="Staff access" hint="HR: onboarding, documents, payroll, approvals. Admin: everything."><select value=${acct.role} onChange=${toggleAdmin}><option value="user">None (employee or client only)</option><option value="hr">HR portal</option><option value="acct">Accounting portal</option><option value="admin">Admin portal</option></select><//></div>`}
        ${(f.role === 'employee' || f.role === 'bench') && html`<label className="check"><input type="checkbox" checked=${!!f.norec} onChange=${up('norec')} /><span>Hide the recruiting workspace (consultants, RTRs, submissions, daily reports) for this person. Every employee and bench sales recruiter has it by default; consultants never see it.</span></label>`}
        ${!emp && m.st !== 'new' && html`<div className="actions">${m.r && m.r.onb && m.r.onb.kind !== 'done' ? html`<a className="btn ghost sm" href="#/portal/hr/onboarding">Onboarding in progress (${onbProgress(m.r.onb, P.tpl).done}/${onbProgress(m.r.onb, P.tpl).total})</a>` : html`<button type="button" className="btn ghost sm" disabled=${busy} onClick=${startOnb}>Start onboarding checklist</button>`}</div>`}
        <div className="actions"><button type="button" className="btn ghost sm" disabled=${busy} onClick=${resetPw}>Reset password</button>${temp && html`<span className="small">Temporary password: <b style=${{ fontFamily: 'inherit', fontSize: 16 }}>${temp}</b>. Share it privately; they can change it under Profile.</span>`}</div>
      </div>
      ${m.st !== 'new' && !emp && html`<${Fragment}>
        <div className="tabs" role="tablist">${[['ts', 'Timesheets'], ['pay', 'Pay'], ['tax', 'Tax'], ['att', 'Attendance'], ['docs', 'Documents'], ['lv', 'Time off']].map(([k, v]) => html`<button type="button" key=${k} role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${v}</button>`)}</div>
        ${tab === 'pay' && html`<${PayForm} m=${m} />`}
      ${tab === 'tax' && html`<${TaxProfileForm} m=${m} />`}
        ${tab === 'ts' && (Object.keys(m.u.ts || {}).length ? html`<ul className="list">${Object.entries(m.u.ts).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 26).map(([w, s]) => { const x = tsStatus(s, (r.rev || {})[w]); return html`<li key=${w}>
            <div><div className="t">${weekLabel(w)}</div><div className="m">${h1(s.t)} hours${s.f ? `, ${s.f} attachment${s.f > 1 ? 's' : ''}` : ''}</div></div>
            <div className="actions"><${Chip} s=${x}>${TS_LABEL[x]}<//><button type="button" className="btn ghost sm" onClick=${() => setRv(w)}>Open</button></div></li>`; })}</ul>`
          : html`<${Empty} title="No timesheets yet" />`)}
        ${tab === 'att' && html`<${MemberAttendance} m=${m} />`}
        ${tab === 'docs' && html`<${MemberDocs} m=${m} />`}
        ${tab === 'lv' && (Object.keys(m.u.lv || {}).length ? html`<ul className="list">${Object.entries(m.u.lv).sort((a, b) => b[1].f.localeCompare(a[1].f)).map(([id, l]) => { const dec = (r.lvd || {})[id]; const s = l.x ? 'cancelled' : dec ? dec.s : 'pending'; return html`<li key=${id}>
            <div><div className="t">${LEAVE_K[l.k]}: ${fmtDate(l.f)}${l.t !== l.f ? ' to ' + fmtDate(l.t) : ''}</div><div className="m">${l.r || 'No note'}</div></div><${Chip} s=${s}>${s[0].toUpperCase() + s.slice(1)}<//></li>`; })}</ul>`
          : html`<${Empty} title="No time-off requests" />`)}
      <//>`}
    </div>
    ${rv && html`<${TsReview} m=${m} w=${rv} onClose=${() => setRv(null)} />`}<//>`;
}
function MemberAttendance({ m }) {
  const [mk, setMk] = useState(mkey(dkey()));
  const [d, setD] = useState(undefined);
  useEffect(() => { setD(undefined); dbGet(`u/${m.id}/att/${mk}`).then(x => setD(x || {})).catch(() => setD({})); }, [mk]);
  const rows = d ? attRows(d, m.u.clock && m.u.clock.on ? m.u.clock : null, Date.now()) : [];
  return html`<div className="stack" style=${{ gap: 10 }}>
    <div className="wknav"><button type="button" className="btn ghost icon" aria-label="Previous month" onClick=${() => setMk(addMonths(mk, -1))}><${Icon} n="left" /></button><b>${monthLabel(mk)}</b>
      <button className="btn ghost icon" aria-label="Next month" disabled=${mk >= mkey(dkey())} onClick=${() => setMk(addMonths(mk, 1))}><${Icon} n="right" /></button>
      <span className="muted small" style=${{ marginLeft: 8 }}>${hm(rows.reduce((a, x) => a + x.m, 0))} total</span></div>
    ${d === undefined ? html`<${Spinner} />` : rows.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Date</th><th>In</th><th>Out</th><th>Location</th><th className="r">Hours</th></tr></thead>
      <tbody>${rows.map(r => html`<tr key=${r.d + r.x.i}><td>${r.first ? fmtDate(r.d) : ''}</td><td className="num">${fmtTime(r.x.i)}${r.x.e ? html` <span className="chip amber" title=${r.x.n || 'Edited by consultant'}>Edited</span>` : ''}</td>
        <td className="num">${r.x.o ? fmtTime(r.x.o) : 'Working'}</td><td>${MODES[r.x.m] || ''}</td><td className="r num">${hm(r.m)}</td></tr>`)}</tbody></table></div>`
      : html`<${Empty} title=${'No attendance in ' + monthLabel(mk)} />`}
  </div>`;
}
function MemberDocs({ m }) {
  const files = useCol(`u/${m.id}/f`, 'at:desc');
  if (files.loading) return html`<${Spinner} />`;
  if (!files.docs.length) return html`<${Empty} title="No documents uploaded" />`;
  return html`<ul className="files">${files.docs.map(f => html`<li key=${f.id}><${Icon} n="file" /><div className="fn"><b>${f.n}</b><span>${DOC_CATS[f.c] || 'Other'}, ${fmtDay(f.at)}, ${sizeLabel(f.sz)}</span></div><${FileActions} base=${'u/' + m.id} f=${f} /></li>`)}</ul>`;
}
function AdminTeam({ q }) {
  const P = usePortal(); const A = P.admin;
  const [tab, setTab] = useState(q.tab || (A.requests.length ? 'new' : 'active'));
  const [s, setS] = useState(''); const [open, setOpen] = useState(null);
  if (A.loading) return html`<${Spinner} />`;
  const counts = { active: 0, new: 0, inactive: 0 }; A.members.forEach(m => { counts[m.st] = (counts[m.st] || 0) + 1; });
  const ql = s.trim().toLowerCase();
  const list = A.members.filter(m => m.st === tab && (!ql || [m.u.p.n, m.u.p.e, m.u.p.ti, m.u.p.co, m.r && m.r.cl, m.r && m.r.ec].filter(Boolean).join(' ').toLowerCase().includes(ql)));
  const cur = open && A.members.find(m => m.id === open);
  return html`<div className="stack">
    <div className="tabs" role="tablist">${[['active', 'Active'], ['new', 'Access requests'], ['inactive', 'Inactive']].map(([k, v]) => html`<button type="button" key=${k} role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${v}<span className=${'chip' + (k === 'new' && counts.new ? ' amber' : '')}>${counts[k] || 0}</span></button>`)}</div>
    <div className="toolbar"><input style=${{ maxWidth: 340 }} type="search" placeholder="Search name, email, company" value=${s} onInput=${e => setS(e.target.value)} aria-label="Search team" /></div>
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${list.length ? html`<div className="tblwrap"><table className="tbl">
        <thead><tr><th>Person</th><th>Portal</th><th>Client</th><th>Engagement</th><th>Clock</th><th>Latest timesheet</th></tr></thead>
        <tbody>${list.map(m => { const lw = Object.keys(m.u.ts || {}).sort().pop(); const x = lw ? tsStatus(m.u.ts[lw], ((m.r || {}).rev || {})[lw]) : null; const emp = m.role === 'employer'; const c = clientOf(A, m);
          return html`<tr key=${m.id} className="click" tabIndex="0" onClick=${() => setOpen(m.id)} onKeyDown=${e => { if (e.key === 'Enter') setOpen(m.id); }}>
            <td><${Person} uid=${m.id} root=${m.u} people=${P.people} sub=${m.u.p.ti || m.u.p.e} /></td>
            <td><${Chip} s=${emp ? 'new' : m.role === 'consultant' ? 'ok' : ''}>${emp ? 'Client' : m.role === 'consultant' ? 'Consultant' : m.role === 'bench' ? 'Bench sales' : 'Employee'}<//>${A.accounts[m.id] && A.accounts[m.id].role === 'admin' ? html` <${Chip} s="ok">Admin<//>` : ''}${!emp && m.u.payReq && !(m.r && m.r.pay && +m.r.pay.amt) ? html` <${Chip} s="amber">Pay plan requested<//>` : ''}</td>
            <td>${(c && c.n) || (m.r && m.r.cl) || m.u.p.co || html`<span className="muted">Not set</span>`}${m.r && m.r.ec ? html`<div className="muted small">${m.r.ec}</div>` : ''}</td>
            <td>${emp ? '—' : (m.r && m.r.ty) || '—'}</td>
            <td>${emp ? '—' : m.u.clock && m.u.clock.on ? html`<${Chip} s="ok">In since ${fmtTime(m.u.clock.i)}<//>` : html`<span className="muted small">Out</span>`}</td>
            <td>${emp ? '—' : x ? html`<${Chip} s=${x}>${TS_LABEL[x]}<//><div className="muted small">${weekLabel(lw)}</div>` : html`<span className="muted small">None</span>`}</td></tr>`; })}</tbody></table></div>`
        : tab === 'new' ? html`<${Empty} title="No access requests">New people appear here after they open the portal and fill in their profile.<//>`
          : html`<${Empty} title=${ql ? 'No matches' : tab === 'active' ? 'No active team members yet' : 'No inactive team members'}>${!ql && tab === 'active' ? 'Approve access requests to add people here.' : ''}<//>`}
    </section>
    ${(() => { const orphans = Object.values(A.accounts).filter(a => !A.members.some(m => m.id === a.id) && a.id !== P.uid); return orphans.length ? html`<section className="panel"><h2 className="ph" style=${{ marginBottom: 8 }}>Accounts without a profile</h2>
      <p className="muted small" style=${{ marginBottom: 10 }}>These people created an account but haven't filled in their profile yet, so they can't be approved.</p>
      <ul className="list">${orphans.map(a => html`<li key=${a.id}><div><div className="t">${a.name}</div><div className="m">${a.email}, registered ${fmtDay(a.created)}</div></div></li>`)}</ul></section>` : null; })()}
    ${A.members.length < 4 && html`<${InviteSteps} />`}
    ${cur && html`<${MemberModal} key=${cur.id} m=${cur} onClose=${() => setOpen(null)} />`}
  </div>`;
}

/* ================= Admin: clients ================= */
function ClientModal({ c, onClose }) {
  const P = usePortal(); const toast = useToast();
  const [f, setF] = useState({ n: '', ec: '', loc: '', notes: '', ...(c || {}) });
  const [busy, setBusy] = useState(false);
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    if (!f.n.trim()) { toast('Add the client name.', true); return; }
    setBusy(true);
    try { await dbMerge(`org/admin/clients/${c ? c.id : token()}`, { n: f.n.trim(), ec: (f.ec || '').trim(), loc: (f.loc || '').trim(), notes: (f.notes || '').trim(), at: c ? c.at : Date.now(), by: P.uid }); toast(c ? 'Client updated.' : 'Client added.'); onClose(); }
    catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  return html`<${Modal} title=${c ? 'Edit client' : 'Add a client'} onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Cancel</button><button type="button" className="btn" disabled=${busy} onClick=${save}>${c ? 'Save' : 'Add client'}</button>`}>
    <div className="form">
      <${Field} label="Client name" hint="The company whose managers approve timesheets in the client portal."><input value=${f.n} onInput=${up('n')} /><//>
      <div className="row2"><${Field} label="End client (if different)"><input value=${f.ec} onInput=${up('ec')} /><//><${Field} label="Location"><input value=${f.loc} onInput=${up('loc')} placeholder="City, state" /><//></div>
      <${Field} label="Notes (admin only)"><textarea value=${f.notes} onInput=${up('notes')} placeholder="Billing contact, PO numbers, approval rules" /><//>
    </div><//>`;
}
function AdminClients() {
  const P = usePortal(); const A = P.admin;
  const [edit, setEdit] = useState(undefined);
  if (A.loading) return html`<${Spinner} />`;
  const rows = A.clients.map(c => ({ c, cons: A.members.filter(m => m.role !== 'employer' && m.st === 'active' && m.r && m.r.cid === c.id), cons2: A.members.filter(m => m.role === 'employer' && m.r && m.r.cid === c.id) }));
  return html`<div className="stack">
    <div className="toolbar"><p className="muted small">Each client gets its own workspace. Consultants linked to it appear there, and the client's contacts approve their hours.</p><div className="push"><button type="button" className="btn" onClick=${() => setEdit(null)}><${Icon} n="plus" />Add client</button></div></div>
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${rows.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Client</th><th>End client</th><th>Consultants</th><th>Client contacts</th><th /></tr></thead>
        <tbody>${rows.map(({ c, cons, cons2 }) => html`<tr key=${c.id}><td><b style=${{ fontWeight: 600 }}>${c.n}</b>${c.loc ? html`<div className="muted small">${c.loc}</div>` : ''}</td><td>${c.ec || '—'}</td>
          <td>${cons.length ? cons.map(m => m.u.p.n).join(', ') : html`<span className="muted">None yet</span>`}</td>
          <td>${cons2.length ? cons2.map(m => m.u.p.n).join(', ') : html`<span className="muted">None yet</span>`}</td>
          <td className="r"><button type="button" className="btn ghost sm" onClick=${() => setEdit(c)}>Edit</button></td></tr>`)}</tbody></table></div>`
        : html`<${Empty} title="No clients yet" action=${html`<button type="button" className="btn" onClick=${() => setEdit(null)}>Add your first client</button>`}>Add the companies your consultants work for. You can also create one while approving a consultant or client contact.<//>`}
    </section>
    ${edit !== undefined && html`<${ClientModal} c=${edit} onClose=${() => setEdit(undefined)} />`}
  </div>`;
}

/* ================= Admin: requirements ================= */
function ReqDetailAdmin({ r, onClose, onChanged }) {
  const P = usePortal(); const toast = useToast();
  const [st, setSt] = useState(r.st || 'open');
  const [c, setC] = useState({ n: '', ti: '', sum: '', av: '' });
  const [busy, setBusy] = useState(false);
  const path = `e/${r.m.id}/req/${r.id}`;
  const upC = k => e => setC({ ...c, [k]: e.target.value });
  const saveSt = async v => { setSt(v); try { await dbMerge(path, { st: v, uat: Date.now() }); onChanged(); toast('Status updated.'); } catch (e) { toast(errText(e), true); } };
  const share = async () => {
    if (!c.n.trim() || !c.ti.trim()) { toast('Add the candidate\u2019s name and title.', true); return; }
    setBusy(true);
    try { await dbMerge(path, { cands: { [nid()]: { n: c.n.trim(), ti: c.ti.trim(), sum: c.sum.trim(), av: c.av.trim(), st: 'shared', at: Date.now(), by: P.uid } }, st: st === 'open' || st === 'reviewing' ? 'shared' : st, uat: Date.now() }); setC({ n: '', ti: '', sum: '', av: '' }); if (st === 'open' || st === 'reviewing') setSt('shared'); onChanged(); toast('Candidate shared with the client.'); }
    catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  const cands = Object.entries(r.cands || {}).sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
  return html`<${Modal} wide title=${r.ti} onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Close</button>`}>
    <div className="stack">
      <dl className="kv"><dt>Client</dt><dd>${r.cl}, posted by ${r.m.u.p.n} on ${fmtDay(r.at)}</dd><dt>Need</dt><dd>${r.n || 1} ${(r.n || 1) > 1 ? 'people' : 'person'}${r.loc ? ', ' + r.loc : ''}${r.md ? ', ' + r.md : ''}${r.ty ? ', ' + r.ty : ''}${r.sd ? ', start ' + fmtDate(r.sd) : ''}</dd>
        ${r.sk && html`<dt>Skills</dt><dd>${r.sk}</dd>`}${r.d && html`<dt>Details</dt><dd style=${{ whiteSpace: 'pre-wrap' }}>${r.d}</dd>`}</dl>
      <div style=${{ maxWidth: 320 }}><${Field} label="Status"><select value=${st} onChange=${e => saveSt(e.target.value)}>${Object.entries(REQ_ST).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//></div>
      <div><h3 className="ph" style=${{ marginBottom: 8 }}>Candidates shared</h3>
        ${cands.length ? html`<div className="cands">${cands.map(([id, x]) => html`<div key=${id} className="cand"><div className="ph-row" style=${{ marginBottom: 0 }}><h4>${x.n}, ${x.ti}</h4><${Chip} s=${x.st === 'hired' ? 'ok' : x.st === 'rejected' ? 'red' : x.st === 'shared' ? '' : 'new'}>${CAND_ST[x.st] || x.st}<//></div>
          ${x.sum && html`<p className="muted small" style=${{ whiteSpace: 'pre-wrap' }}>${x.sum}</p>`}<p className="muted small">${x.av ? 'Available ' + x.av + '. ' : ''}Shared ${fmtDay(x.at)}${x.fb ? '. Client: ' + x.fb : ''}</p></div>`)}</div>`
          : html`<p className="muted small">No candidates shared yet.</p>`}</div>
      <div className="panel form" style=${{ background: 'var(--surface-2)' }}><h3 className="ph">Share a candidate</h3>
        <div className="row2"><${Field} label="Name or initials"><input value=${c.n} onInput=${upC('n')} placeholder="e.g. R. Sharma" /><//><${Field} label="Title"><input value=${c.ti} onInput=${upC('ti')} placeholder="e.g. Senior Network Engineer" /><//></div>
        <${Field} label="Summary for the client"><textarea value=${c.sum} onInput=${upC('sum')} placeholder="Experience, certifications, highlights" /><//>
        <${Field} label="Availability"><input value=${c.av} onInput=${upC('av')} placeholder="e.g. 2 weeks notice, open to onsite" /><//>
        <div><button type="button" className="btn" disabled=${busy} onClick=${share}>${busy ? 'Sharing…' : 'Share with client'}</button></div></div>
    </div><//>`;
}
function AdminRequirements() {
  const P = usePortal(); const A = P.admin;
  const [reqs, setReqs] = useState(null); const [tick, setTick] = useState(0); const [open, setOpen] = useState(null); const [tab, setTab] = useState('open');
  useEffect(() => { if (!A.loading) loadReqs(A).then(setReqs).catch(() => setReqs([])); }, [A.loading, A.employers.length, tick]);
  if (A.loading || !reqs) return html`<${Spinner} />`;
  const list = reqs.filter(r => tab === 'all' || (tab === 'open' ? !['filled', 'closed'].includes(r.st || 'open') : ['filled', 'closed'].includes(r.st)));
  const cur = open && reqs.find(r => r.id === open.id && r.m.id === open.mid);
  return html`<div className="stack">
    <div className="toolbar"><div className="tabs" role="tablist" style=${{ marginBottom: 0, border: 0 }}>${[['open', 'Open'], ['done', 'Filled or closed'], ['all', 'All']].map(([k, v]) => html`<button type="button" key=${k} role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${v}</button>`)}</div>
      <div className="push"><button type="button" className="btn ghost" onClick=${() => setTick(tick + 1)}>Refresh</button></div></div>
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${list.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Requirement</th><th>Client</th><th className="r">Need</th><th>Status</th><th className="r">Candidates</th><th>Posted</th><th /></tr></thead>
        <tbody>${list.map(r => html`<tr key=${r.m.id + r.id} className="click" tabIndex="0" onClick=${() => setOpen({ id: r.id, mid: r.m.id })} onKeyDown=${e => { if (e.key === 'Enter') setOpen({ id: r.id, mid: r.m.id }); }}>
          <td><b style=${{ fontWeight: 600 }}>${r.ti}</b>${r.sk ? html`<div className="muted small">${r.sk}</div>` : ''}</td><td>${r.cl}<div className="muted small">${r.m.u.p.n}</div></td><td className="r num">${r.n || 1}</td>
          <td><${Chip} s=${r.st === 'filled' ? 'ok' : r.st === 'closed' ? '' : r.st === 'shared' ? 'new' : 'amber'}>${REQ_ST[r.st || 'open']}<//></td><td className="r num">${Object.keys(r.cands || {}).length}</td><td className="num muted">${fmtDay(r.at)}</td><td className="r"><button className="btn ghost sm">Open</button></td></tr>`)}</tbody></table></div>`
        : html`<${Empty} title=${tab === 'open' ? 'No open requirements' : 'Nothing here yet'}>Client contacts post staffing requirements from their portal. They land here for you to work and share candidates.<//>`}
    </section>
    ${cur && html`<${ReqDetailAdmin} key=${cur.m.id + cur.id} r=${cur} onClose=${() => setOpen(null)} onChanged=${() => setTick(t => t + 1)} />`}
  </div>`;
}

/* ================= Admin: approvals ================= */
function LeaveDecide({ x, s, onClose }) {
  const P = usePortal(); const toast = useToast();
  const [c, setC] = useState(''); const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { await dbMerge(`r/${x.m.id}`, { lvd: { [x.id]: { s, c: c.trim(), at: Date.now(), by: P.uid } } }); toast(s === 'approved' ? 'Time off approved.' : 'Time off declined.'); onClose(); }
    catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  return html`<${Modal} title=${(s === 'approved' ? 'Approve' : 'Decline') + ' time off'} onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Cancel</button><button type="button" className=${'btn ' + (s === 'approved' ? 'go' : 'danger')} disabled=${busy} onClick=${go}>${s === 'approved' ? 'Approve' : 'Decline'}</button>`}>
    <p style=${{ marginBottom: 14 }}><b>${x.m.u.p.n}</b>, ${LEAVE_K[x.l.k]}: ${fmtDate(x.l.f)}${x.l.t !== x.l.f ? ' to ' + fmtDate(x.l.t) : ''} (${bizDays(x.l.f, x.l.t)} business days)</p>
    <${Field} label="Note to the consultant (optional)"><textarea value=${c} onInput=${e => setC(e.target.value)} /><//><//>`;
}
function AdminApprovals({ q }) {
  const P = usePortal(); const A = P.admin;
  const [tab, setTab] = useState(q.tab === 'leave' ? 'leave' : q.tab === 'att' ? 'att' : 'ts');
  const [rv, setRv] = useState(null); const [ld, setLd] = useState(null);
  const [cs, setCs] = useState({});
  const pendKey = A.pendTs.map(x => x.m.id + x.w + (x.s.u || '') + ((x.m.r && x.m.r.cid) || '')).join(',');
  useEffect(() => {
    let live = true;
    pMap(A.pendTs.filter(x => x.m.r && x.m.r.cid), 4, x => dbGet(`pub/${x.m.r.cid}/ts/${x.m.id}_${x.w}`).catch(() => null)).then(docs => {
      if (!live) return; const o = {}; A.pendTs.filter(x => x.m.r && x.m.r.cid).forEach((x, i) => { o[x.m.id + x.w] = cdStatus(docs[i]); }); setCs(o);
    });
    return () => { live = false; };
  }, [pendKey]);
  if (A.loading) return html`<${Spinner} />`;
  const curM = rv && A.members.find(m => m.id === rv.mid);
  return html`<div className="stack">
    <div className="tabs" role="tablist">${[['ts', 'Timesheets', A.pendTs.length], ['att', 'Attendance (clock-ins)', null], ['leave', 'Time off', A.pendLv.length], ['done', 'Recently reviewed', null]].map(([k, v, n]) => html`<button type="button" key=${k} role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${v}${n != null && html`<span className=${'chip' + (n ? ' amber' : '')}>${n}</span>`}</button>`)}</div>
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${tab === 'ts' && (A.pendTs.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Person</th><th>Week</th><th className="r">Hours</th><th>Client approval</th><th>Attachments</th><th>Submitted</th><th /></tr></thead>
        <tbody>${A.pendTs.map(x => { const k = cs[x.m.id + x.w]; return html`<tr key=${x.m.id + x.w}><td><${Person} uid=${x.m.id} root=${x.m.u} people=${P.people} sub=${x.m.r && x.m.r.cl} /></td><td className="nw">${weekLabel(x.w)}</td><td className="r num"><b>${h1(x.s.t)}</b></td>
          <td>${x.m.r && x.m.r.cid ? (k ? html`<${Chip} s=${k === 'approved' ? 'ok' : k === 'returned' ? 'red' : 'amber'}>${CD_LABEL[k]}<//>` : html`<span className="muted small">…</span>`) : html`<span className="muted small">No client workspace</span>`}</td>
          <td>${x.s.f ? x.s.f : html`<span className=${x.m.r && x.m.r.na ? 'chip red' : 'muted'}>${x.m.r && x.m.r.na ? 'Missing' : 'None'}</span>`}</td><td className="num muted">${fmtTs(x.s.sa)}</td>
          <td className="r"><button type="button" className="btn sm" onClick=${() => setRv({ mid: x.m.id, w: x.w })}>Review</button></td></tr>`; })}</tbody></table></div>`
        : html`<${Empty} title="No timesheets waiting">Submitted timesheets appear here, oldest first, with the client's decision alongside.<//>`)}
      ${tab === 'att' && html`<${AttApprovals} />`}
      ${tab === 'leave' && (A.pendLv.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Person</th><th>Type</th><th>Dates</th><th className="r">Days</th><th>Note</th><th /></tr></thead>
        <tbody>${A.pendLv.map(x => html`<tr key=${x.id}><td><${Person} uid=${x.m.id} root=${x.m.u} people=${P.people} /></td><td>${LEAVE_K[x.l.k]}</td><td className="num">${fmtDate(x.l.f)}${x.l.t !== x.l.f ? ' – ' + fmtDate(x.l.t) : ''}</td>
          <td className="r num">${bizDays(x.l.f, x.l.t)}</td><td className="muted">${x.l.r || ''}</td>
          <td className="r"><div className="actions" style=${{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}><button type="button" className="btn ghost sm" onClick=${() => setLd({ x, s: 'declined' })}>Decline</button><button type="button" className="btn go sm" onClick=${() => setLd({ x, s: 'approved' })}>Approve</button></div></td></tr>`)}</tbody></table></div>`
        : html`<${Empty} title="No time-off requests waiting" />`)}
      ${tab === 'done' && (A.reviewed.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Person</th><th>Week</th><th className="r">Hours</th><th>Decision</th><th>Reviewed</th><th /></tr></thead>
        <tbody>${A.reviewed.map(x => html`<tr key=${x.m.id + x.w}><td><${Person} uid=${x.m.id} root=${x.m.u} people=${P.people} /></td><td className="nw">${weekLabel(x.w)}</td><td className="r num">${h1(x.s.t)}</td>
          <td><${Chip} s=${x.st}>${TS_LABEL[x.st]}<//></td><td className="num muted">${fmtTs(x.rev.at)}</td><td className="r"><button type="button" className="btn ghost sm" onClick=${() => setRv({ mid: x.m.id, w: x.w })}>Open</button></td></tr>`)}</tbody></table></div>`
        : html`<${Empty} title="No reviews yet" />`)}
    </section>
    ${curM && html`<${TsReview} m=${curM} w=${rv.w} onClose=${() => setRv(null)} />`}
    ${ld && html`<${LeaveDecide} x=${ld.x} s=${ld.s} onClose=${() => setLd(null)} />`}
  </div>`;
}

/* ================= Admin: team attendance ================= */
function AdminAttendance() {
  const P = usePortal(); const A = P.admin; const toast = useToast();
  const [day, setDay] = useState(dkey());
  const [data, setData] = useState(null); const [tick, setTick] = useState(0); const [busy, setBusy] = useState(false);
  const active = A.members.filter(m => m.st === 'active' && m.role !== 'employer');
  const ids = active.map(m => m.id).join(',');
  useEffect(() => {
    let live = true; setData(null);
    pMap(active, 4, m => dbGet(`u/${m.id}/att/${mkey(day)}`).catch(() => null)).then(docs => { if (live) { const o = {}; active.forEach((m, i) => { o[m.id] = docs[i]; }); setData(o); } });
    return () => { live = false; };
  }, [mkey(day), ids, tick]);
  const now = Date.now();
  const rows = active.map(m => {
    const s = ((((data && data[m.id]) || {}).days || {})[day] || {}).s || []; const c = m.u.clock && m.u.clock.on ? m.u.clock : null;
    return { m, s, first: s.length ? Math.min(...s.map(x => x.i)) : null, last: s.length && s.every(x => x.o) ? Math.max(...s.map(x => x.o)) : null, open: s.some(x => !x.o), total: sessMins(s, c, now), edited: s.some(x => x.e), modes: [...new Set(s.map(x => MODES[x.m]).filter(Boolean))].join(', ') };
  }).sort((a, b) => (b.s.length ? 1 : 0) - (a.s.length ? 1 : 0) || (a.first || 0) - (b.first || 0));
  const exportMonth = async () => {
    setBusy(true);
    try {
      const mk = mkey(day); const docs = await pMap(active, 4, m => dbGet(`u/${m.id}/att/${mk}`).catch(() => null));
      const out = [['Name', 'Email', 'Client', 'Date', 'Clock in', 'Clock out', 'Hours', 'Location', 'Edited', 'Note']];
      active.forEach((m, i) => Object.keys((docs[i] && docs[i].days) || {}).sort().forEach(d => (docs[i].days[d].s || []).forEach(x => out.push([m.u.p.n, m.u.p.e, (m.r && m.r.cl) || '', d, fmtTime(x.i), x.o ? fmtTime(x.o) : '', x.o ? hrs(mins(x.i, x.o)) : '', MODES[x.m] || '', x.e ? 'Yes' : '', x.n || '']))));
      if (out.length === 1) throw { message: `No attendance recorded in ${monthLabel(mk)}.` };
      await saveDownload(`team-attendance-${mk}.csv`, toCSV(out));
    } catch (e) { if (!e || e.code !== 'declined') toast(errText(e), true); }
    setBusy(false);
  };
  return html`<div className="stack">
    <div className="toolbar">
      <div className="wknav"><button type="button" className="btn ghost icon" aria-label="Previous day" onClick=${() => setDay(addDays(day, -1))}><${Icon} n="left" /></button>
        <input type="date" value=${day} max=${dkey()} onInput=${e => e.target.value && setDay(e.target.value)} style=${{ width: 170 }} aria-label="Day" />
        <button className="btn ghost icon" aria-label="Next day" disabled=${day >= dkey()} onClick=${() => setDay(addDays(day, 1))}><${Icon} n="right" /></button></div>
      ${day !== dkey() && html`<button type="button" className="btn ghost sm" onClick=${() => setDay(dkey())}>Today</button>`}
      <div className="push"><button type="button" className="btn ghost" onClick=${() => setTick(tick + 1)}>Refresh</button><button type="button" className="btn ghost" disabled=${busy || !active.length} onClick=${exportMonth}><${Icon} n="down" />${busy ? 'Preparing…' : 'Export ' + monthLabel(mkey(day))}</button></div>
    </div>
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${!active.length ? html`<${Empty} title="No active consultants yet">Approve people under Team to see their attendance.<//>` : !data ? html`<${Spinner} />` : html`<div className="tblwrap"><table className="tbl">
        <thead><tr><th>Person</th><th>First in</th><th>Last out</th><th>Location</th><th className="r">Hours</th><th>Status</th></tr></thead>
        <tbody>${rows.map(r => html`<tr key=${r.m.id}><td><${Person} uid=${r.m.id} root=${r.m.u} people=${P.people} sub=${r.m.r && r.m.r.cl} /></td>
          <td className="num">${r.first ? fmtTime(r.first) : '—'}</td><td className="num">${r.last ? fmtTime(r.last) : '—'}</td><td>${r.modes || '—'}</td>
          <td className="r num">${r.s.length ? hm(r.total) : '—'}</td>
          <td>${r.open ? html`<${Chip} s="ok">Working<//>` : r.s.length ? html`<${Chip}>Done<//>` : html`<span className="muted small">No record</span>`}${r.edited ? html` <span className="chip amber">Edited</span>` : ''}</td></tr>`)}</tbody></table></div>`}
    </section>
  </div>`;
}

/* ================= Admin: tasks ================= */
function NewTask({ onClose }) {
  const P = usePortal(); const A = P.admin; const toast = useToast();
  const active = A.members.filter(m => m.st === 'active' && m.role !== 'employer');
  const [f, setF] = useState({ ti: '', d: '', due: '', p: 'normal' });
  const [who, setWho] = useState([]); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const create = async () => {
    if (!f.ti.trim()) { setErr('Give the task a title.'); return; }
    if (!who.length) { setErr('Choose at least one person.'); return; }
    setErr(''); setBusy(true);
    try {
      const id = nid(); const t = { ti: f.ti.trim(), d: f.d.trim(), due: f.due, p: f.p, at: Date.now(), by: P.uid };
      for (const uid of who) await dbMerge(`r/${uid}`, { tasks: { [id]: t } });
      toast(`Task assigned to ${who.length} ${who.length === 1 ? 'person' : 'people'}.`); onClose();
    } catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  return html`<${Modal} title="New task" onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Cancel</button><button type="button" className="btn" disabled=${busy} onClick=${create}>${busy ? 'Assigning…' : 'Assign task'}</button>`}>
    <div className="form">
      <${Field} label="Title"><input value=${f.ti} onInput=${up('ti')} placeholder="e.g. Upload your updated COI" /><//>
      <${Field} label="Details"><textarea value=${f.d} onInput=${up('d')} /><//>
      <div className="row2"><${Field} label="Due date"><input type="date" value=${f.due} onInput=${up('due')} /><//>
        <${Field} label="Priority"><select value=${f.p} onChange=${up('p')}><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select><//></div>
      <div><div className="ph-row" style=${{ marginBottom: 6 }}><span className="lbl">Assign to</span>${active.length > 1 && html`<button type="button" className="btn link small" onClick=${() => setWho(who.length === active.length ? [] : active.map(m => m.id))}>${who.length === active.length ? 'Clear' : 'Select everyone'}</button>`}</div>
        ${active.length ? html`<div style=${{ display: 'grid', gap: 8, maxHeight: 220, overflow: 'auto' }}>${active.map(m => html`<label key=${m.id} className="check"><input type="checkbox" checked=${who.includes(m.id)} onChange=${e => setWho(e.target.checked ? [...who, m.id] : who.filter(x => x !== m.id))} /><span>${m.u.p.n}${m.r && m.r.cl ? html` <span className="muted small">${m.r.cl}</span>` : ''}</span></label>`)}</div>`
          : html`<p className="muted small">Approve team members first, then assign them tasks.</p>`}</div>
      ${err && html`<p className="err" role="alert">${err}</p>`}
    </div><//>`;
}
function AdminTasks() {
  const P = usePortal(); const A = P.admin; const toast = useToast();
  const [tab, setTab] = useState('open'); const [nw, setNw] = useState(false);
  if (A.loading) return html`<${Spinner} />`;
  const all = [];
  A.members.forEach(m => Object.entries((m.r && m.r.tasks) || {}).forEach(([id, t]) => { if (!t.x) all.push({ id, t, m, pr: (m.u.tp || {})[id] || {} }); }));
  all.sort((a, b) => (a.t.due || '9999').localeCompare(b.t.due || '9999'));
  const list = all.filter(x => tab === 'all' || (tab === 'done' ? x.pr.s === 'done' : x.pr.s !== 'done'));
  const archive = async x => { try { await dbMerge(`r/${x.m.id}`, { tasks: { [x.id]: { x: 1 } } }); toast('Task archived.'); } catch (e) { toast(errText(e), true); } };
  return html`<div className="stack">
    <div className="toolbar"><div className="tabs" role="tablist" style=${{ marginBottom: 0, border: 0 }}>${[['open', 'Open'], ['done', 'Done'], ['all', 'All']].map(([k, v]) => html`<button type="button" key=${k} role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${v}</button>`)}</div>
      <div className="push"><button type="button" className="btn" onClick=${() => setNw(true)}><${Icon} n="plus" />New task</button></div></div>
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${list.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Task</th><th>Assignee</th><th>Due</th><th>Priority</th><th>Progress</th><th /></tr></thead>
        <tbody>${list.map(x => html`<tr key=${x.m.id + x.id}><td><b style=${{ fontWeight: 600 }}>${x.t.ti}</b>${x.pr.n ? html`<div className="muted small">${x.pr.n}</div>` : ''}</td>
          <td><${Person} uid=${x.m.id} root=${x.m.u} people=${P.people} /></td>
          <td className=${'num' + (x.t.due && x.t.due < dkey() && x.pr.s !== 'done' ? ' err' : '')}>${x.t.due ? fmtDate(x.t.due) : '—'}</td>
          <td><span className=${'prio ' + x.t.p}>${x.t.p === 'high' ? 'High' : x.t.p === 'low' ? 'Low' : 'Normal'}</span></td>
          <td><${Chip} s=${x.pr.s || 'todo'}>${TASK_S[x.pr.s || 'todo']}<//></td>
          <td className="r"><button type="button" className="btn ghost sm" onClick=${() => archive(x)}>Archive</button></td></tr>`)}</tbody></table></div>`
        : html`<${Empty} title=${tab === 'done' ? 'No completed tasks' : 'No tasks yet'} action=${tab !== 'done' && html`<button type="button" className="btn" onClick=${() => setNw(true)}>Assign a task</button>`}>Assign onboarding steps, document requests or project to-dos to one person or the whole team.<//>`}
    </section>
    ${nw && html`<${NewTask} onClose=${() => setNw(false)} />`}
  </div>`;
}

/* ================= Admin: reports ================= */
function AdminReports() {
  const P = usePortal(); const A = P.admin; const toast = useToast();
  const [from, setFrom] = useState(addDays(weekStart(), -21)); const [to, setTo] = useState(weekStart());
  const [busy, setBusy] = useState(false);
  if (A.loading) return html`<${Spinner} />`;
  const f = weekStart(from), t = weekStart(to);
  const rows = A.members.filter(m => m.role !== 'employer').map(m => {
    const r = { m, weeks: 0, total: 0, appr: 0, pend: 0, draft: 0 };
    Object.entries(m.u.ts || {}).forEach(([w, s]) => {
      if (w < f || w > t) return; const x = tsStatus(s, ((m.r || {}).rev || {})[w]);
      r.weeks++; r.total += s.t || 0; if (x === 'approved') r.appr += s.t || 0; else if (x === 'pending') r.pend += s.t || 0; else r.draft += s.t || 0;
    });
    return r;
  }).filter(r => r.weeks);
  const tot = rows.reduce((a, r) => ({ total: a.total + r.total, appr: a.appr + r.appr, pend: a.pend + r.pend, draft: a.draft + r.draft }), { total: 0, appr: 0, pend: 0, draft: 0 });
  const fname = `${f}_to_${addDays(t, 6)}`;
  const expSummary = async () => {
    try { await saveDownload(`hours-summary_${fname}.csv`, toCSV([['Name', 'Email', 'Engagement', 'Client', 'End client', 'Weeks', 'Total hours', 'Approved', 'Awaiting approval', 'Draft or returned'],
      ...rows.map(r => [r.m.u.p.n, r.m.u.p.e, (r.m.r || {}).ty || '', (r.m.r || {}).cl || '', (r.m.r || {}).ec || '', r.weeks, h1(r.total), h1(r.appr), h1(r.pend), h1(r.draft)])])); }
    catch (e) { if (!e || e.code !== 'declined') toast(errText(e), true); }
  };
  const expLines = async () => {
    setBusy(true);
    try {
      const jobs = []; rows.forEach(r => Object.keys(r.m.u.ts || {}).forEach(w => { if (w >= f && w <= t) jobs.push({ m: r.m, w }); }));
      const docs = await pMap(jobs, 4, j => dbGet(`u/${j.m.id}/ts/${j.w}`).catch(() => null));
      const out = [['Name', 'Engagement', 'Client', 'End client', 'Week of', 'Status', 'Project', 'Task', ...DOW, 'Line total']];
      jobs.forEach((j, i) => { const d = docs[i]; if (!d) return; const x = TS_LABEL[tsStatus(j.m.u.ts[j.w], ((j.m.r || {}).rev || {})[j.w])];
        tsRowsFor(d).forEach(r => out.push([j.m.u.p.n, (j.m.r || {}).ty || '', (j.m.r || {}).cl || '', (j.m.r || {}).ec || '', j.w, x, r.p, r.t, ...r.h.map(v => v || 0), h1(r.h.reduce((a, b) => a + b, 0))])); });
      await saveDownload(`timesheet-lines_${fname}.csv`, toCSV(out));
    } catch (e) { if (!e || e.code !== 'declined') toast(errText(e), true); }
    setBusy(false);
  };
  return html`<div className="stack">
    <div className="toolbar">
      <${Field} label="From week of"><input type="date" value=${from} onInput=${e => e.target.value && setFrom(e.target.value)} /><//>
      <${Field} label="To week of"><input type="date" value=${to} onInput=${e => e.target.value && setTo(e.target.value)} /><//>
      <div className="push" style=${{ alignSelf: 'flex-end' }}><button type="button" className="btn ghost" disabled=${!rows.length} onClick=${expSummary}><${Icon} n="down" />Summary CSV</button><button type="button" className="btn" disabled=${!rows.length || busy} onClick=${expLines}><${Icon} n="down" />${busy ? 'Preparing…' : 'Timesheet lines CSV'}</button></div>
    </div>
    <p className="muted small">Weeks of ${weekLabel(f)} through ${weekLabel(t)}. Use the timesheet lines export for invoicing and payroll.</p>
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${rows.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Person</th><th>Client</th><th className="r">Weeks</th><th className="r">Total h</th><th className="r">Approved</th><th className="r">Awaiting</th><th className="r">Draft or returned</th></tr></thead>
        <tbody>${rows.map(r => html`<tr key=${r.m.id}><td><${Person} uid=${r.m.id} root=${r.m.u} people=${P.people} sub=${(r.m.r || {}).ty} /></td><td>${(r.m.r || {}).cl || '—'}</td><td className="r num">${r.weeks}</td>
          <td className="r num"><b>${h1(r.total)}</b></td><td className="r num">${h1(r.appr)}</td><td className="r num">${h1(r.pend)}</td><td className="r num">${h1(r.draft)}</td></tr>`)}
          <tr><td colSpan="3"><b>All people</b></td><td className="r num"><b>${h1(tot.total)}</b></td><td className="r num"><b>${h1(tot.appr)}</b></td><td className="r num"><b>${h1(tot.pend)}</b></td><td className="r num"><b>${h1(tot.draft)}</b></td></tr></tbody></table></div>`
        : html`<${Empty} title="No timesheets in this range">Pick a wider range, or check back after people submit their weeks.<//>`}
    </section>
  </div>`;
}

/* ================= Admin: announcements ================= */
function AdminAnnouncements() {
  const P = usePortal(); const toast = useToast();
  const [f, setF] = useState({ ti: '', b: '', pin: false }); const [busy, setBusy] = useState(false);
  const post = async e => {
    e.preventDefault();
    if (!f.ti.trim() || !f.b.trim()) { toast('Add a title and a message.', true); return; }
    setBusy(true);
    try { await dbSet(`org/main/ann/${nid()}`, { ti: f.ti.trim(), b: f.b.trim(), pin: f.pin, at: Date.now(), by: P.uid }); setF({ ti: '', b: '', pin: false }); toast('Announcement posted to everyone.'); }
    catch (x) { toast(errText(x), true); }
    setBusy(false);
  };
  const del = async a => { try { await dbDel(`org/main/ann/${a.id}`); toast('Announcement deleted.'); } catch (x) { toast(errText(x), true); } };
  const pin = async a => { try { await dbMerge(`org/main/ann/${a.id}`, { pin: !a.pin }); } catch (x) { toast(errText(x), true); } };
  return html`<div className="g2" style=${{ alignItems: 'start' }}>
    <form className="panel form" onSubmit=${post}><h2 className="ph">Post an announcement</h2>
      <${Field} label="Title"><input value=${f.ti} onInput=${e => setF({ ...f, ti: e.target.value })} placeholder="e.g. Thanksgiving office closure" /><//>
      <${Field} label="Message"><textarea value=${f.b} onInput=${e => setF({ ...f, b: e.target.value })} /><//>
      <label className="check"><input type="checkbox" checked=${f.pin} onChange=${e => setF({ ...f, pin: e.target.checked })} /><span>Pin to the top of everyone's dashboard</span></label>
      <div><button className="btn" disabled=${busy}>${busy ? 'Posting…' : 'Post announcement'}</button></div></form>
    <section className="panel"><h2 className="ph" style=${{ marginBottom: 4 }}>Posted</h2>
      ${P.ann.length ? P.ann.map(a => html`<article key=${a.id} className="ann"><div className="ph-row" style=${{ marginBottom: 2 }}><h3>${a.ti}</h3>
          <div className="actions"><button type="button" className="btn ghost sm" onClick=${() => pin(a)}>${a.pin ? 'Unpin' : 'Pin'}</button><button type="button" className="btn ghost sm icon" aria-label=${'Delete ' + a.ti} onClick=${() => del(a)}><${Icon} n="trash" /></button></div></div>
        <time>${fmtDay(a.at)}${a.pin ? ', pinned' : ''}</time><p>${a.b}</p></article>`)
      : html`<${Empty} title="Nothing posted yet">Announcements show on every team member's dashboard.<//>`}
    </section>
  </div>`;
}

/* ================= Admin: website (inbox + jobs) ================= */
function JobModal({ job, onClose }) {
  const P = usePortal(); const toast = useToast();
  const [f, setF] = useState({ ti: '', loc: '', ty: 'C2C', md: 'Onsite', sk: '', d: '', open: true, ...(job || {}) });
  const [busy, setBusy] = useState(false);
  const up = k => e => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async () => {
    if (!f.ti.trim()) { toast('Add a job title.', true); return; }
    setBusy(true);
    try { const { id, ...rest } = f; await dbSet(`org/site/jobs/${job ? job.id : nid()}`, { ...rest, ti: f.ti.trim(), at: job ? job.at : Date.now(), by: P.uid }); toast(job ? 'Job updated.' : 'Job posted to the Careers page.'); onClose(); }
    catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  return html`<${Modal} title=${job ? 'Edit job' : 'Post a job'} onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Cancel</button><button type="button" className="btn" disabled=${busy} onClick=${save}>${job ? 'Save job' : 'Post job'}</button>`}>
    <div className="form">
      <${Field} label="Job title"><input value=${f.ti} onInput=${up('ti')} placeholder="e.g. Senior Network Engineer" /><//>
      <div className="row3"><${Field} label="Location"><input value=${f.loc} onInput=${up('loc')} placeholder="City, state" /><//>
        <${Field} label="Engagement"><select value=${f.ty} onChange=${up('ty')}>${EMP_TYPES.map(t => html`<option key=${t}>${t}</option>`)}</select><//>
        <${Field} label="Work mode"><select value=${f.md} onChange=${up('md')}>${['Onsite', 'Hybrid', 'Remote'].map(t => html`<option key=${t}>${t}</option>`)}</select><//></div>
      <${Field} label="Key skills"><input value=${f.sk} onInput=${up('sk')} placeholder="e.g. Cisco, BGP, Palo Alto" /><//>
      <${Field} label="Description"><textarea value=${f.d} onInput=${up('d')} /><//>
      <label className="check"><input type="checkbox" checked=${f.open} onChange=${up('open')} /><span>Show on the Careers page</span></label>
    </div><//>`;
}
function AdminWebsite({ q }) {
  const P = usePortal(); const A = P.admin; const toast = useToast();
  const [tab, setTab] = useState(q.tab === 'jobs' ? 'jobs' : 'inbox');
  const jobs = useCol('org/site/jobs', 'at:desc');
  const [edit, setEdit] = useState(undefined);
  const toggle = async x => { try { await dbMerge(`inbox/${x.uid}`, { m: { [x.id]: { done: !x.done } } }); } catch (e) { toast(errText(e), true); } };
  const delJob = async j => { try { await dbDel(`org/site/jobs/${j.id}`); toast('Job removed.'); } catch (e) { toast(errText(e), true); } };
  return html`<div className="stack">
    <div className="tabs" role="tablist">${[['inbox', 'Inbox', A.unread], ['jobs', 'Job openings', jobs.docs.filter(j => j.open !== false).length]].map(([k, v, n]) => html`<button type="button" key=${k} role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${v}<span className=${'chip' + (k === 'inbox' && n ? ' amber' : '')}>${n}</span></button>`)}</div>
    ${tab === 'inbox' && html`<section className="panel">
      <p className="muted small" style=${{ marginBottom: 8 }}>Messages from the Contact page, talent requests from employers, and job applications with resumes.</p>
      ${A.msgs.length ? html`<ul className="list">${A.msgs.map(x => html`<li key=${x.uid + x.id} style=${{ opacity: x.done ? 0.6 : 1 }}>
        <div style=${{ minWidth: 0 }}><div className="actions" style=${{ gap: 8 }}><${Chip} s=${x.k === 'apply' ? 'new' : x.k === 'talent' ? 'ok' : 'amber'}>${x.k === 'apply' ? 'Application' : x.k === 'talent' ? 'Talent request' : 'Inquiry'}<//><span className="t">${x.n}</span><span className="muted small">${fmtTs(x.at)}</span></div>
          <div className="m" style=${{ marginTop: 6 }}><a href=${'mailto:' + x.e}>${x.e}</a>${x.ph ? ', ' + x.ph : ''}${x.co ? ', ' + x.co : ''}${x.sv ? '. Service: ' + x.sv : ''}${x.jt ? '. Role: ' + x.jt : ''}${x.li ? html`. <a href=${x.li} target="_blank" rel="noopener">Profile link</a>` : ''}</div>
          ${x.msg && html`<p style=${{ marginTop: 6, fontSize: 15, whiteSpace: 'pre-wrap' }}>${x.msg}</p>`}
          ${x.fid && html`<div className="actions" style=${{ marginTop: 8 }}><${FileActions} base=${'inbox/' + x.uid} f=${{ id: x.fid, n: 'Resume', ty: '' }} /></div>`}</div>
        <button type="button" className="btn ghost sm" onClick=${() => toggle(x)}>${x.done ? 'Mark as new' : 'Mark handled'}</button></li>`)}</ul>`
        : html`<${Empty} title="Inbox is empty">Messages from the Contact and Careers pages land here.<//>`}
    </section>`}
    ${tab === 'jobs' && html`<${Fragment}>
      <div className="toolbar"><p className="muted small">Open jobs appear on the website's Careers page. "Send" emails a job to chosen consultants, candidates or any address; "Share" copies a link or posts it.</p><div className="push"><button type="button" className="btn" onClick=${() => setEdit(null)}><${Icon} n="plus" />Post a job</button></div></div>
      <section className="panel" style=${{ padding: '6px 8px' }}>
        ${jobs.loading ? html`<${Spinner} />` : jobs.docs.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Role</th><th>Location</th><th>Engagement</th><th>Status</th><th /></tr></thead>
          <tbody>${jobs.docs.map(j => html`<tr key=${j.id}><td><b style=${{ fontWeight: 600 }}>${j.ti}</b>${j.sk ? html`<div className="muted small">${j.sk}</div>` : ''}${j.src ? html`<div className="muted small">Grabbed from ${j.src.portal ? j.src.portal[0].toUpperCase() + j.src.portal.slice(1) : 'a portal'}${j.src.company ? ', ' + j.src.company : ''}</div>` : ''}</td><td>${j.loc || '—'}${j.md ? html`<div className="muted small">${j.md}</div>` : ''}</td><td>${j.ty}</td>
            <td>${j.open !== false ? html`<${Chip} s="ok">Open<//>` : html`<${Chip}>Closed<//>`}${j.sentN ? html`<div className="muted small">Sent to ${j.sentN}</div>` : ''}${j.shares ? html`<div className="muted small">Shared ${j.shares}×</div>` : ''}</td>
            <td className="r"><div className="actions" style=${{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>${j.open !== false && html`<${SendJobButton} jobId=${j.id} small=${true} label="Send" /><${ShareButton} job=${j} small=${true} />`}<button type="button" className="btn ghost sm" onClick=${() => setEdit(j)}>Edit</button><button type="button" className="btn ghost sm icon" aria-label=${'Delete ' + j.ti} onClick=${() => delJob(j)}><${Icon} n="trash" /></button></div></td></tr>`)}</tbody></table></div>`
          : html`<${Empty} title="No jobs posted" action=${html`<button type="button" className="btn" onClick=${() => setEdit(null)}>Post your first job</button>`}>Roles you post here show on the Careers page with an Apply button.<//>`}
      </section>
    <//>`}
    ${edit !== undefined && html`<${JobModal} job=${edit} onClose=${() => setEdit(undefined)} />`}
  </div>`;
}

/* ================= Admin: pay plan & payroll ================= */
function ItemsEditor({ items, onChange, label, addLabel }) {
  const set = (i, k, v) => onChange(items.map((x, j) => j === i ? { ...x, [k]: v } : x));
  return html`<div className="stack" style=${{ gap: 8 }}>
    <span className="lbl">${label}</span>
    ${items.map((it, i) => html`<div key=${i} className="row3" style=${{ display: 'grid', gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr) minmax(0,1fr) auto', gap: 8, alignItems: 'end' }}>
      <${Field} label="Name"><input value=${it.n || ''} onInput=${e => set(i, 'n', e.target.value)} placeholder="e.g. HRA, PF, Travel" /><//>
      <${Field} label="Amount"><input type="number" min="0" step="0.01" inputMode="decimal" value=${it.a || ''} onInput=${e => set(i, 'a', e.target.value)} disabled=${!!it.p} /><//>
      <${Field} label="or % of base"><input type="number" min="0" max="100" step="0.01" inputMode="decimal" value=${it.p || ''} onInput=${e => set(i, 'p', e.target.value)} /><//>
      <button type="button" className="btn ghost icon" aria-label="Remove" onClick=${() => onChange(items.filter((_, j) => j !== i))}><${Icon} n="trash" /></button></div>`)}
    <div><button type="button" className="btn ghost sm" onClick=${() => onChange([...items, { n: '', a: '', p: '' }])}><${Icon} n="plus" />${addLabel}</button></div>
  </div>`;
}
function PayForm({ m }) {
  const toast = useToast(); const P = usePortal();
  const conf = m.r && m.r.payConf; const plan = m.r && m.r.pay; const confOk = conf && plan && conf.amt === plan.amt && conf.type === plan.type && conf.cur === plan.cur;
  const confirmNow = async () => { try { await dbMerge(`r/${m.id}`, { payConf: { by: P.uid, byn: (P.prof && P.prof.n) || (Cap.me && Cap.me.name) || 'Admin', at: Date.now(), amt: plan.amt, type: plan.type, cur: plan.cur } }); toast('Salary confirmed.'); } catch (e) { toast(errText(e), true); } };
  const [f, setF] = useState({ ...PAY_DEFAULT, ...((m.r && m.r.pay) || {}) });
  const [busy, setBusy] = useState(false);
  const up = k => e => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async () => {
    if (!(+f.amt > 0)) { toast('Enter the salary or hourly rate.', true); return; }
    setBusy(true);
    try {
      const pay = { cur: f.cur, type: f.type, amt: r2(f.amt), hrs: Math.max(1, +f.hrs || 8), days: f.days, wdm: Math.max(0, parseInt(f.wdm == null ? 20 : f.wdm, 10) || 0), ot: r2(f.ot), lop: !!f.lop, pl: !!f.pl, from: f.from || '',
        allow: (f.allow || []).filter(x => x.n && (+x.a || +x.p)).map(x => ({ n: x.n.trim(), a: r2(x.a), p: r2(x.p) })), ded: (f.ded || []).filter(x => x.n && (+x.a || +x.p)).map(x => ({ n: x.n.trim(), a: r2(x.a), p: r2(x.p) })) };
      await dbMerge(`r/${m.id}`, { pay, payAt: Date.now() }); toast(`Pay plan saved for ${firstName(m.u.p.n)}.`); if (P.roleName === 'admin') await dbMerge(`r/${m.id}`, { payConf: { by: P.uid, byn: (P.prof && P.prof.n) || (Cap.me && Cap.me.name) || 'Admin', at: Date.now(), amt: pay.amt, type: pay.type, cur: pay.cur } });
    } catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  const monthly = f.type !== 'hourly';
  return html`<div className="form">
      ${plan && +plan.amt ? html`<div className=${'note ' + (confOk ? 'ok' : 'amber')}><span>${confOk ? html`<b>Salary confirmed</b> by ${conf.byn} ${fmtDay(conf.at)}.` : html`<b>Salary not yet confirmed by an administrator.</b> ${conf ? 'The plan changed after the last confirmation.' : ''}`}</span>${P.roleName === 'admin' && !confOk ? html`<div className="actions"><button type="button" className="btn go sm" onClick=${confirmNow}>Confirm salary</button></div>` : ''}</div>` : ''}
    <div className="row3"><${Field} label="Pay plan"><select value=${f.type} onChange=${up('type')}><option value="monthly">Monthly salary</option><option value="hourly">Hourly rate</option></select><//>
      <${Field} label="Currency"><select value=${f.cur} onChange=${up('cur')}>${Object.entries(CURRENCIES).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//>
      <${Field} label=${monthly ? 'Monthly salary' : 'Rate per hour'}><input type="number" min="0" step="0.01" inputMode="decimal" value=${f.amt || ''} onInput=${up('amt')} placeholder=${monthly ? 'e.g. 60000' : 'e.g. 450'} /><//></div>
    <div className="row3"><${Field} label="Standard hours per day" hint="Time beyond this counts as overtime."><input type="number" min="1" max="16" step="0.5" value=${f.hrs} onInput=${up('hrs')} /><//>
      <${Field} label="Working days"><select value=${f.days} onChange=${up('days')}><option value="mon-fri">Monday to Friday</option><option value="mon-sat">Monday to Saturday</option><option value="all">All seven days</option></select><//>
      <${Field} label="Working days per month" hint="Fixed number used for salary ÷ days; 20 is standard."><select value=${String(f.wdm == null ? 20 : f.wdm)} onChange=${up('wdm')}><option value="20">20 days every month (standard)</option><option value="21">21 days</option><option value="22">22 days</option><option value="26">26 days (Mon–Sat)</option><option value="0">Count the calendar working days</option></select><//>
      <${Field} label="Overtime multiplier" hint=${monthly ? '0 means overtime is not paid.' : '0 means overtime is paid at the normal rate.'}><input type="number" min="0" step="0.25" value=${f.ot} onInput=${up('ot')} placeholder="e.g. 1.5" /><//></div>
    ${monthly && html`<div className="row2">
      <label className="check"><input type="checkbox" checked=${!!f.lop} onChange=${up('lop')} /><span>Loss of pay for absent working days (salary ÷ working days × days present)</span></label>
      <label className="check"><input type="checkbox" checked=${!!f.pl} onChange=${up('pl')} /><span>Approved time off counts as paid days</span></label></div>`}
    <${Field} label="Effective from"><input type="date" value=${f.from || ''} onInput=${up('from')} /><//>
    <${ItemsEditor} label="Allowances (added every month)" addLabel="Add allowance" items=${f.allow || []} onChange=${v => setF({ ...f, allow: v })} />
    <${ItemsEditor} label="Deductions (taken every month; % is of gross)" addLabel="Add deduction" items=${f.ded || []} onChange=${v => setF({ ...f, ded: v })} />
    <div className="actions"><button type="button" className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save pay plan'}</button><span className="muted small">Employees see their earnings computed from clock-ins as soon as this is saved.</span></div>
  </div>`;
}
function PayrollDetail({ row, mk, onClose }) {
  const P = usePortal(); const toast = useToast();
  const [items, setItems] = useState(((row.m.r && row.m.r.payAdj) || {})[mk] || []);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await dbMerge(`r/${row.m.id}`, { payAdj: { [mk]: items.filter(x => x.n && +x.a).map(x => ({ n: x.n.trim(), a: r2(x.a) })) } }); toast('Adjustments saved.'); onClose(); }
    catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  const c = row.c;
  return html`<${Modal} wide title=${`${row.m.u.p.n}: ${monthLabel(mk)}`} onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Close</button><button type="button" className="btn" disabled=${busy} onClick=${save}>Save adjustments</button>`}>
    <div className="stack">
      <div className="kpis" style=${{ gridTemplateColumns: 'repeat(4,minmax(0,1fr))' }}>
        <a><b>${fmtMoney(c.net, c.p.cur)}</b><span>Net pay</span></a><a><b>${c.present} / ${c.workDays}</b><span>Present / working days</span></a><a><b>${hm(c.reg)}</b><span>Regular hours</span></a><a><b>${hm(c.ot)}</b><span>Overtime</span></a></div>
      <${PayBreakdown} c=${c} />
      <div className="panel" style=${{ background: 'var(--surface-2)' }}>
        <h3 className="ph" style=${{ marginBottom: 10 }}>Adjustments for ${monthLabel(mk)}</h3>
        <p className="muted small" style=${{ marginBottom: 10 }}>One-off additions or deductions: a bonus, an advance recovery, a reimbursement. Use a negative amount to deduct.</p>
        <div className="stack" style=${{ gap: 8 }}>${items.map((it, i) => html`<div key=${i} style=${{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr) auto', gap: 8, alignItems: 'end' }}>
          <${Field} label="Name"><input value=${it.n || ''} onInput=${e => setItems(items.map((x, j) => j === i ? { ...x, n: e.target.value } : x))} placeholder="e.g. Diwali bonus, Advance recovery" /><//>
          <${Field} label="Amount (+ or −)"><input type="number" step="0.01" inputMode="decimal" value=${it.a || ''} onInput=${e => setItems(items.map((x, j) => j === i ? { ...x, a: e.target.value } : x))} /><//>
          <button type="button" className="btn ghost icon" aria-label="Remove" onClick=${() => setItems(items.filter((_, j) => j !== i))}><${Icon} n="trash" /></button></div>`)}
          <div><button type="button" className="btn ghost sm" onClick=${() => setItems([...items, { n: '', a: '' }])}><${Icon} n="plus" />Add adjustment</button></div></div>
      </div>
    </div><//>`;
}
function AdminPayroll() {
  const P = usePortal(); const A = P.admin; const toast = useToast(); const ps = payStartOf(P.settings); const req = attApprovalOn(P.settings);
  const [mk, setMk] = useState(cycleFor(dkey(), ps)); const cyc = cycleRange(mk, ps);
  const [data, setData] = useState(null); const [tick, setTick] = useState(0); const [open, setOpen] = useState(null);
  const [hol, setHol] = useState(((P.settings || {}).hol || []).join('\n')); const [editHol, setEditHol] = useState(false);
  const [cfg, setCfg] = useState({ payStart: ps, attApproval: req, breakMax: breakMaxOf(P.settings) });
  const saveCfg = async () => { try { await dbMerge('org/main/x/settings', { payStart: Math.max(1, Math.min(28, +cfg.payStart || 1)), attApproval: !!cfg.attApproval, breakMax: Math.max(0, +cfg.breakMax || 0) }); toast('Payroll settings saved.'); } catch (e) { toast(errText(e), true); } };
  const staff = A.members.filter(m => m.role !== 'employer' && m.st === 'active' && m.r && m.r.pay && +m.r.pay.amt > 0);
  const ids = staff.map(m => m.id).join(',');
  useEffect(() => {
    let live = true; setData(null);
    pMap(staff, 4, m => loadCycleAtt(m.id, cyc)).then(docs => { if (live) { const o = {}; staff.forEach((m, i) => { o[m.id] = docs[i]; }); setData(o); } });
    return () => { live = false; };
  }, [mk, ids, tick]);
  const holidays = (P.settings || {}).hol || [];
  const rows = data ? staff.map(m => ({ m, c: computePay(m.r.pay, data[m.id], mk, approvedLeaves(m.u, m.r), holidays, ((m.r.payAdj || {})[mk]) || [], { from: cyc.from, to: cyc.to, approvals: m.r.attA, requireApproval: req, breakMax: breakMaxOf(P.settings) }) })) : [];
  const totals = {}; rows.forEach(r => { totals[r.c.p.cur] = (totals[r.c.p.cur] || 0) + r.c.net; });
  const saveHol = async () => { try { const list = [...new Set(hol.split(/[\s,]+/).map(s => s.trim()).filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s)))].sort(); await dbMerge('org/main/x/settings', { hol: list }); setEditHol(false); toast('Holidays saved.'); } catch (e) { toast(errText(e), true); } };
  const exp = async () => {
    try {
      const out = [['Employee', 'Email', 'Currency', 'Pay plan', 'Rate', 'Working days', 'Present', 'Paid leave', 'Unpaid days', 'Regular hours', 'Overtime hours', 'Base pay', 'Overtime pay', 'Allowances', 'Gross', 'Deductions', 'Adjustments', 'Net pay']];
      rows.forEach(({ m, c }) => out.push([m.u.p.n, m.u.p.e, c.p.cur, c.p.type, r2(c.p.amt).toFixed(2), c.workDays, c.present, c.leaveDays, c.unpaidDays, hrs(c.reg), hrs(c.ot), c.base.toFixed(2), c.otPay.toFixed(2), r2(c.allow.reduce((s, a) => s + a.v, 0)).toFixed(2), c.gross.toFixed(2), c.dedT.toFixed(2), c.adjT.toFixed(2), c.net.toFixed(2)]));
      await saveDownload(`payroll-${mk}.csv`, toCSV(out));
    } catch (e) { if (!e || e.code !== 'declined') toast(errText(e), true); }
  };
  const cur = open && rows.find(r => r.m.id === open);
  return html`<div className="stack">
    <div className="toolbar">
      <div className="wknav"><button type="button" className="btn ghost icon" aria-label="Previous pay period" onClick=${() => setMk(addMonths(mk, -1))}><${Icon} n="left" /></button><b>${cyc.label}</b>
        <button className="btn ghost icon" aria-label="Next pay period" disabled=${mk >= cycleFor(dkey(), ps)} onClick=${() => setMk(addMonths(mk, 1))}><${Icon} n="right" /></button></div>
      <div className="push"><button type="button" className="btn ghost" onClick=${() => setEditHol(v => !v)}>Payroll settings</button><button type="button" className="btn ghost" onClick=${() => setTick(t => t + 1)}>Refresh</button><button type="button" className="btn" disabled=${!rows.length} onClick=${exp}><${Icon} n="down" />Payroll CSV</button></div>
    </div>
    ${editHol && html`<section className="panel form"><h2 className="ph">Payroll settings</h2>
      <div className="row2"><${Field} label="Pay period starts on day" hint="26 means each period runs from the 26th to the 25th of the next month and is paid as that month. 1 means calendar months."><input type="number" min="1" max="28" value=${cfg.payStart} onInput=${e => setCfg({ ...cfg, payStart: e.target.value })} /><//>
        <${Field} label="Break allowance per day (minutes)" hint="Break time beyond this is unpaid unless an admin approves the extended break."><input type="number" min="0" value=${cfg.breakMax} onInput=${e => setCfg({ ...cfg, breakMax: e.target.value })} /><//></div>
      <label className="check"><input type="checkbox" checked=${!!cfg.attApproval} onChange=${e => setCfg({ ...cfg, attApproval: e.target.checked })} /><span>Clock-ins need admin approval before they count as paid days (Approvals › Attendance)</span></label>
      <div className="actions"><button type="button" className="btn" onClick=${saveCfg}>Save settings</button></div>
      <h2 className="ph" style=${{ marginTop: 10 }}>Company holidays</h2><p className="muted small">One date per line (YYYY-MM-DD). Holidays are paid days and don't count as working days.</p>
      <textarea value=${hol} onInput=${e => setHol(e.target.value)} placeholder="2026-10-02\n2026-11-11" style=${{ minHeight: 120, maxWidth: 360, fontVariantNumeric: 'tabular-nums' }} />
      <div className="actions"><button type="button" className="btn" onClick=${saveHol}>Save holidays</button><button type="button" className="btn ghost" onClick=${() => setEditHol(false)}>Close</button></div></section>`}
    ${Object.keys(totals).length > 0 && html`<div className="kpis" style=${{ gridTemplateColumns: `repeat(${Object.keys(totals).length + 1},minmax(0,1fr))` }}>
      ${Object.entries(totals).map(([k, v]) => html`<a key=${k}><b>${fmtMoney(v, k)}</b><span>Total net pay (${k})</span></a>`)}<a><b>${rows.length}</b><span>People on payroll</span></a></div>`}
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${!staff.length ? html`<${Empty} title="No pay plans yet">Open a team member under Team and set their salary or hourly rate on the Pay tab. Their earnings are then computed from clock-ins.<//>`
        : !data ? html`<${Spinner} />` : html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Employee</th><th>Plan</th><th className="r">Present</th><th className="r">Hours</th><th className="r">OT</th><th className="r">Gross</th><th className="r">Deductions</th><th className="r">Net pay</th><th /></tr></thead>
        <tbody>${rows.map(({ m, c }) => html`<tr key=${m.id} className="click" tabIndex="0" onClick=${() => setOpen(m.id)} onKeyDown=${e => { if (e.key === 'Enter') setOpen(m.id); }}>
          <td><${Person} uid=${m.id} root=${m.u} people=${P.people} sub=${m.r.cl} /></td><td className="muted small">${payLabel(c.p)}</td>
          <td className="r num">${c.present}/${c.workDays}${c.leaveDays ? html`<div className="muted small">+${c.leaveDays} leave</div>` : ''}</td><td className="r num">${hm(c.reg)}</td><td className="r num">${c.ot ? hm(c.ot) : '—'}</td>
          <td className="r num">${fmtMoney(c.gross, c.p.cur)}</td><td className="r num">${c.dedT ? '− ' + fmtMoney(c.dedT, c.p.cur) : '—'}${c.adjT ? html`<div className="muted small">${c.adjT > 0 ? '+' : '−'} ${fmtMoney(Math.abs(c.adjT), c.p.cur)} adj.</div>` : ''}</td>
          <td className="r num"><b>${fmtMoney(c.net, c.p.cur)}</b></td><td className="r"><button className="btn ghost sm">Details</button></td></tr>`)}</tbody></table></div>`}
    </section>
    <p className="muted small">Figures come from completed clock-in sessions in this month. Monthly plans with loss of pay use salary ÷ working days × days present; approved time off and company holidays count as paid.</p>
    ${cur && html`<${PayrollDetail} key=${cur.m.id + mk} row=${cur} mk=${mk} onClose=${() => { setOpen(null); setTick(t => t + 1); }} />`}
  </div>`;
}

/* ---- Tax profile (per employee, used by payroll runs) ---- */
function TaxProfileForm({ m }) {
  const toast = useToast(); const [f, setF] = useState({ ...TAX_PROFILE_DEFAULT, ...((m.r && m.r.tax) || {}) }); const [busy, setBusy] = useState(false);
  const up = k => e => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async () => { setBusy(true); try { await dbMerge(`r/${m.id}`, { tax: { ...f, extra: r2(f.extra), state: r2(f.state), ded: r2(f.ded), basicPct: f.basicPct === '' ? '' : r2(f.basicPct), pt: f.pt === '' ? '' : r2(f.pt) } }); toast('Tax details saved.'); } catch (e) { toast(errText(e), true); } setBusy(false); };
  return html`<div className="form">
    <div className="row2"><${Field} label="Payroll country"><select value=${f.country} onChange=${up('country')}><option value="US">United States (W2)</option><option value="IN">India</option></select><//><${Field} label="Payment method"><select value=${f.method} onChange=${up('method')}>${['Direct deposit', 'Check', 'Bank transfer (NEFT/IMPS)', 'UPI'].map(x => html`<option key=${x}>${x}</option>`)}</select><//></div>
    ${f.country === 'US' ? html`<${Fragment}>
      <div className="row3"><${Field} label="Filing status (W-4)"><select value=${f.filing} onChange=${up('filing')}><option value="single">Single or married filing separately</option><option value="married">Married filing jointly</option><option value="head">Head of household</option></select><//><${Field} label="Extra withholding per pay (W-4 line 4c)"><input type="number" step="0.01" value=${f.extra} onInput=${up('extra')} /><//><label className="check" style=${{ alignSelf: 'end', paddingBottom: 12 }}><input type="checkbox" checked=${!!f.fica} onChange=${up('fica')} /><span>Withhold Social Security and Medicare (untick for FICA-exempt, e.g. F-1 OPT)</span></label></div>
      <div className="row2"><${Field} label="State income tax withholding %" hint="Effective rate from your CPA; 0 for no-tax states."><input type="number" step="0.01" value=${f.state} onInput=${up('state')} /><//><${Field} label="State name"><input value=${f.stateName} onInput=${up('stateName')} placeholder="e.g. NJ" /><//></div><//>`
    : html`<${Fragment}>
      <div className="row3"><${Field} label="Tax regime"><select value=${f.regime} onChange=${up('regime')}><option value="new">New regime</option><option value="old">Old regime</option></select><//>${f.regime === 'old' && html`<${Field} label="Annual deductions (80C, 80D, HRA exemption)"><input type="number" step="1" value=${f.ded} onInput=${up('ded')} /><//>`}<label className="check" style=${{ alignSelf: 'end', paddingBottom: 12 }}><input type="checkbox" checked=${!!f.pf} onChange=${up('pf')} /><span>EPF applies</span></label></div>
      <div className="row2"><${Field} label="Basic as % of gross" hint="Blank uses the default from Tax settings."><input type="number" step="1" value=${f.basicPct} onInput=${up('basicPct')} /><//><${Field} label="Professional tax per month" hint="Blank uses the default; set by state (e.g. 200)."><input type="number" step="1" value=${f.pt} onInput=${up('pt')} /><//></div><//>`}
    <div className="actions"><button type="button" className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save tax details'}</button><span className="muted small">Used by Accounting › Payroll runs to compute withholdings on each paystub.</span></div>
  </div>`;
}

/* ================= Sign-in activity ================= */
function SignIns() {
  const P = usePortal(); const A = P.admin; const toast = useToast();
  const logs = useCol('log', 'seen:desc'); const [q, setQ] = useState(''); const [range, setRange] = useState('all'); const [open, setOpen] = useState(null); const [hist, setHist] = useState(null);
  const now = Date.now(); const since = range === 'today' ? new Date(dkey()).getTime() - new Date().getTimezoneOffset() * 60000 : range === '7d' ? now - 7 * 86400000 : range === '30d' ? now - 30 * 86400000 : 0;
  const byId = {}; A.members.forEach(m => { byId[m.id] = m; });
  const ql = q.trim().toLowerCase();
  const rows = logs.docs.filter(d => d.last && d.last.t >= since && (!ql || [d.name, d.email, d.last.ip, geoLabel(d.last)].join(' ').toLowerCase().includes(ql))).sort((a, b) => (b.seen || b.last.t) - (a.seen || a.last.t));
  const isOnline = d => d.seen && now - d.seen < 10 * 60000;
  useEffect(() => { if (!open) { setHist(null); return; } let live = true; dbList(`log/${open}/items`).then(l => { if (live) setHist(l.sort((a, b) => b.t - a.t)); }).catch(() => setHist([])); return () => { live = false; }; }, [open]);
  const exp = async () => { try { await saveDownload('sign-ins.csv', toCSV([['Name', 'Email', 'Role', 'Last sign-in', 'Online', 'Network address', 'Approximate location', 'Precise location', 'Device', 'Sign-ins'], ...rows.map(d => [d.name, d.email, roleOf(d), new Date(d.last.t).toISOString(), isOnline(d) ? 'yes' : 'no', d.last.ip, geoLabel(d.last), d.last.pos ? `${d.last.pos.lat}, ${d.last.pos.lng} (±${d.last.pos.acc} m)` : '', uaSummary(d.last.ua), d.n])])); } catch (e) { if (!e || e.code !== 'declined') toast(errText(e), true); } };
  const roleOf = d => { const m = byId[d.id]; return m ? (m.role === 'employer' ? 'Client contact' : m.role === 'bench' ? 'Bench sales recruiter' : m.r && m.r.cl ? `Employee, ${m.r.cl}` : 'Employee') : d.role === 'admin' ? 'Admin' : d.role === 'hr' ? 'HR' : d.role === 'acct' ? 'Accounting' : 'Account'; };
  const cur = open && logs.docs.find(d => d.id === open);
  const Loc = ({ r }) => html`<span>${geoLabel(r) || html`<span className="muted">Unknown</span>`}</span>`;
  const Exact = ({ r }) => r.pos ? html`<a href=${mapLink(r.pos)} target="_blank" rel="noopener">${r.pos.lat}, ${r.pos.lng}</a><div className="muted small">±${r.pos.acc} m · map</div>` : html`<span className="muted small">Not shared${r.posErr ? ' (' + (POS_ERR[r.posErr] || r.posErr) + ')' : ''}</span>`;
  return html`<div className="stack">
    <div className="kpis" style=${{ gridTemplateColumns: 'repeat(3,minmax(0,1fr))' }}><a><b>${logs.docs.filter(isOnline).length}</b><span>Signed in now (active in the last 10 minutes)</span></a><a><b>${logs.docs.filter(d => d.last && d.last.t >= now - 86400000).length}</b><span>Signed in within 24 hours</span></a><a><b>${logs.docs.reduce((a, d) => a + (+d.n || 0), 0)}</b><span>Sign-ins recorded</span></a></div>
    <div className="toolbar"><div className="seg" style=${{ marginBottom: 0 }}>${[['all', 'All'], ['today', 'Today'], ['7d', '7 days'], ['30d', '30 days']].map(([k, v]) => html`<button type="button" key=${k} className=${range === k ? 'on' : ''} onClick=${() => setRange(k)}>${v}</button>`)}</div>
      <input type="search" style=${{ maxWidth: 260 }} placeholder="Search name, email, address, city" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Search sign-ins" /><div className="push"><button type="button" className="btn ghost" onClick=${exp}><${Icon} n="down" />CSV</button></div></div>
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${logs.loading ? html`<${Spinner} />` : rows.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Person</th><th>Status</th><th>Last sign-in</th><th>City (from address)</th><th>Exact location</th><th>Network address</th><th>Device</th><th className="r">Sign-ins</th></tr></thead>
        <tbody>${rows.map(d => { const m = byId[d.id]; return html`<tr key=${d.id} className="click" tabIndex="0" onClick=${() => setOpen(d.id)} onKeyDown=${e => { if (e.key === 'Enter') setOpen(d.id); }}>
          <td>${m ? html`<${Person} uid=${m.id} root=${m.u} people=${P.people} sub=${roleOf(d)} />` : html`<b style=${{ fontWeight: 600 }}>${d.name}</b><div className="muted small">${d.email}, ${roleOf(d)}</div>`}</td>
          <td>${isOnline(d) ? html`<${Chip} s="ok">Online<//>` : html`<span className="muted small">Last seen ${fmtTs(d.seen || d.last.t)}</span>`}</td>
          <td className="num nw">${fmtTs(d.last.t)}</td><td><${Loc} r=${d.last} /></td><td><${Exact} r=${d.last} /></td><td className="num small">${d.last.ip}</td><td className="small">${uaSummary(d.last.ua)}</td><td className="r num">${d.n}</td></tr>`; })}</tbody></table></div>`
        : html`<${Empty} title="No sign-ins yet">Every portal sign-in is recorded here with its time, network address, approximate location and device. Precise location appears when the person allows location sharing in their browser.<//>`}
    </section>
    ${cur && html`<${Modal} wide title=${`Sign-in history: ${cur.name}`} onClose=${() => setOpen(null)} foot=${html`<button type="button" className="btn" onClick=${() => setOpen(null)}>Close</button>`}>
      ${hist === null ? html`<${Spinner} />` : hist.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>When</th><th>Event</th><th>City (from address)</th><th>Exact location</th><th>Network address</th><th>Device</th></tr></thead>
        <tbody>${hist.slice(0, 200).map(r => html`<tr key=${r.id}><td className="num nw">${fmtTs(r.t)}</td><td>${r.how === 'punch' ? (EV_LABEL[r.ev] || r.ev) : (EV_LABEL[r.how] || 'Signed in')}</td><td><${Loc} r=${r} /></td><td><${Exact} r=${r} /></td><td className="num small">${r.ip}${r.geo && r.geo.isp ? html`<div className="muted small">${r.geo.isp}</div>` : ''}</td><td className="small">${uaSummary(r.ua)}<div className="muted small" style=${{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title=${r.ua}>${r.ua}</div></td></tr>`)}</tbody></table></div>` : html`<${Empty} title="No history" />`}
      <p className="muted small" style=${{ marginTop: 10 }}>Sign-ins, sign-outs, clock-ins, clock-outs and breaks are listed with the network address and the city it resolves to (VPNs and mobile carriers can place it elsewhere). Exact location is recorded when the person allows location sharing in their browser.</p><//>`}
  </div>`;
}

/* ================= Attendance approvals (clock-ins and clock-outs) ================= */
function AttApprovals() {
  const P = usePortal(); const A = P.admin; const toast = useToast(); const ps = payStartOf(P.settings); const req = attApprovalOn(P.settings);
  const [mk, setMk] = useState(cycleFor(dkey(), ps)); const cyc = cycleRange(mk, ps);
  const [data, setData] = useState(null); const [tick, setTick] = useState(0); const [show, setShow] = useState('pending');
  const staff = A.members.filter(m => m.role !== 'employer' && m.st === 'active'); const ids = staff.map(m => m.id).join(',');
  useEffect(() => { let live = true; setData(null); pMap(staff, 4, m => loadCycleAtt(m.id, cyc)).then(docs => { if (live) { const o = {}; staff.forEach((m, i) => { o[m.id] = docs[i]; }); setData(o); } }); return () => { live = false; }; }, [mk, ids, tick]);
  if (!req) return html`<div className="note info"><span>Attendance approval is switched off, so clock-ins count as soon as they are recorded. Turn it on under Pay plans › Payroll settings.</span></div>`;
  if (A.loading || !data) return html`<${Spinner} label="Loading clock-ins…" />`;
  const rows = [];
  const allow = breakMaxOf(P.settings);
  staff.forEach(m => { const days = (data[m.id] && data[m.id].days) || {}; Object.keys(days).sort().forEach(k => { if (k < cyc.from || k > cyc.to) return; const d = days[k]; const a = (m.r.attA || {})[k]; const extOk = a && a.bx === 'approved'; const mins = dayMins(d, allow, extOk); const open = (d.s || []).some(x => !x.o); if (!grossDayMins(d) && !open) return; const st = attStatus(k, m.r.attA, mins, true); const bm = breakMins(d); const over = excessBreak(d, allow); if (show === 'pending' ? (st === 'approved' || st === 'rejected') && !(over && !extOk && !(a && a.bx === 'unpaid')) : show === 'rejected' ? st !== 'rejected' : false) return; rows.push({ m, k, d, mins, open, st, a, bm, over, extOk }); }); });
  const decide = async (r, s, note, bx) => { try { const cur = r.a || {}; const extOk = bx === 'approved' || (bx == null && r.extOk); await dbMerge(`r/${r.m.id}`, { attA: { [r.k]: { s, m: dayMins(r.d, allow, extOk), by: P.uid, at: Date.now(), n: note || '', bx: bx || cur.bx || (r.over ? 'unpaid' : null) } } }); } catch (e) { toast(errText(e), true); throw e; } };
  const approveAll = async (uid) => { const list = rows.filter(r => (r.st === 'pending' || r.st === 'changed') && !r.open && (!uid || r.m.id === uid)); if (!list.length) return; const byUser = {}; list.forEach(r => { (byUser[r.m.id] = byUser[r.m.id] || {})[r.k] = { s: 'approved', m: r.mins, by: P.uid, at: Date.now(), n: '' }; }); try { for (const [id, attA] of Object.entries(byUser)) await dbMerge(`r/${id}`, { attA }); toast(`${list.length} day${list.length === 1 ? '' : 's'} approved.`); } catch (e) { toast(errText(e), true); } };
  const pendingCount = rows.filter(r => r.st === 'pending' || r.st === 'changed').length;
  return html`<div className="stack" style=${{ marginTop: 12 }}>
    <div className="toolbar"><div className="wknav"><button type="button" className="btn ghost icon" aria-label="Previous pay period" onClick=${() => setMk(addMonths(mk, -1))}><${Icon} n="left" /></button><b>${cyc.label}</b><button className="btn ghost icon" aria-label="Next pay period" disabled=${mk >= cycleFor(dkey(), ps)} onClick=${() => setMk(addMonths(mk, 1))}><${Icon} n="right" /></button></div>
      <div className="seg" style=${{ marginBottom: 0 }}>${[['pending', 'To approve'], ['rejected', 'Rejected'], ['all', 'All days']].map(([k, v]) => html`<button type="button" key=${k} className=${show === k ? 'on' : ''} onClick=${() => setShow(k)}>${v}</button>`)}</div>
      <div className="push"><button type="button" className="btn ghost" onClick=${() => setTick(t => t + 1)}>Refresh</button><button type="button" className="btn go" disabled=${!pendingCount} onClick=${() => approveAll()}>Approve all (${pendingCount})</button></div></div>
    ${rows.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Person</th><th>Date</th><th>Clock in → out</th><th className="r">Hours</th><th>Status</th><th /></tr></thead>
      <tbody>${rows.map(r => html`<tr key=${r.m.id + r.k}><td><${Person} uid=${r.m.id} root=${r.m.u} people=${P.people} sub=${(r.m.r && r.m.r.cl) || r.m.u.p.ti} /></td><td className="num nw">${fmtDate(r.k, { weekday: 'short', month: 'short', day: 'numeric' })}</td>
        <td className="small">${(r.d.s || []).map((x, i) => html`<div key=${i}>${fmtTime(x.i)} → ${x.o ? fmtTime(x.o) : html`<span className="muted">still in</span>`}${x.m ? ' · ' + (MODES[x.m] || x.m) : ''}${x.e ? html` <${Chip} s="amber">Manual entry<//>` : ''}${x.n ? html`<div className="muted">${x.n}</div>` : ''}<${PunchLoc} m=${x.li} label="in" /><${PunchLoc} m=${x.lo} label="out" /></div>`)}
          ${(r.d.b || []).length > 0 && html`<div style=${{ marginTop: 4 }}><b>Breaks:</b> ${(r.d.b || []).map((x, i) => html`<span key=${i}>${i ? ', ' : ''}${fmtTime(x.i)}–${x.o ? fmtTime(x.o) : 'now'}</span>`)} (${hm(r.bm)})${r.over ? html` <${Chip} s=${r.extOk ? 'ok' : 'amber'}>${hm(r.over)} over allowance${r.extOk ? ', approved' : (r.a && r.a.bx === 'unpaid') ? ', unpaid' : ''}<//>` : ''}${(r.d.b || []).map((x, i) => html`<${PunchLoc} key=${'b' + i} m=${x.li} label=${'break ' + (i + 1) + ' start'} />`)}</div>`}</td>
        <td className="r num">${hm(r.mins)}</td><td><${Chip} s=${r.st === 'approved' ? 'ok' : r.st === 'rejected' ? 'red' : 'amber'}>${ATT_ST[r.st]}<//>${r.a && r.a.n ? html`<div className="muted small">${r.a.n}</div>` : ''}</td>
        <td className="r"><div className="actions" style=${{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>${r.open ? html`<span className="muted small">Waiting for clock-out</span>` : html`${r.over && !r.extOk && html`<button type="button" className="btn sm" onClick=${() => decide(r, 'approved', '', 'approved').then(() => toast('Day and extended break approved (paid).'))}>Approve with extra break</button>`}${(r.st !== 'approved' || (r.over && !r.extOk && !(r.a && r.a.bx === 'unpaid'))) && html`<button type="button" className="btn go sm" onClick=${() => decide(r, 'approved', '', r.over && !r.extOk ? 'unpaid' : null).then(() => toast(r.over && !r.extOk ? 'Approved; the extra break time is unpaid.' : 'Approved.'))}>${r.over && !r.extOk ? 'Approve (extra break unpaid)' : 'Approve'}</button>`}${r.st !== 'rejected' && html`<button type="button" className="btn ghost sm" onClick=${() => { const n = prompt('Why is this day rejected? (shown to the employee)'); if (n === null) return; decide(r, 'rejected', n).then(() => toast('Rejected.')); }}>Reject</button>`}`}</div></td></tr>`)}</tbody></table></div>`
      : html`<${Empty} title=${show === 'pending' ? 'Nothing to approve' : 'No days here'}>Each day an employee clocks in and out appears here. Approved days count toward their pay for the ${cyc.short} period; days edited after approval come back for review.<//>`}
  </div>`;
}

const PunchLoc = ({ m, label }) => !m ? null : html`<div className="muted small">${label}: ${m.g || (m.ip ? 'address ' + m.ip : 'no location')}${m.ip && m.g ? ` · ${m.ip}` : ''}${m.pos ? html` · <a href=${mapLink(m.pos)} target="_blank" rel="noopener">exact ${m.pos.lat}, ${m.pos.lng} (±${m.pos.acc} m)</a>` : html` · exact location ${POS_ERR[m.posErr || ''] || 'not shared'}`}</div>`;

/* ================= App & routing ================= */
const TITLES = { '/': 'IT staffing and solutions', '/about': 'About us', '/services': 'Services', '/blog': 'Blog', '/careers': 'Careers', '/contact': 'Contact us', '/login': 'Log in', '/terms': 'Terms of use', '/privacy': 'Privacy policy', '/faq': 'FAQ', '/request-talent': 'Request talent' };
const titleFor = path => path.startsWith('/careers/') ? 'Careers' : TITLES[path];
function App() {
  const { path, q } = useHashRoute();
  useEffect(() => { window.scrollTo(0, 0); }, [path]);
  useFxBehaviors(path);
  useEffect(() => {
    const svc = path.startsWith('/services/') && SERVICES.find(s => '/services/' + s.s === path);
    const post = path.startsWith('/blog/') && POSTS.find(p => '/blog/' + p.s === path);
    document.title = `${path.startsWith('/portal') ? 'Portal' : path.startsWith('/sign/') ? 'Sign document' : path.startsWith('/invoice/') ? 'Invoice' : svc ? svc.n : post ? post.t : (titleFor(path) || 'StratEdge')} | StratEdge IT Consulting`;
  }, [path]);
  if (path.startsWith('/portal') || path.startsWith('/client')) return html`<${Portal} path=${path} q=${q} />`;
  let page;
  if (path === '/') page = html`<${Home} />`;
  else if (path === '/about') page = html`<${About} />`;
  else if (path === '/services') page = html`<${ServicesPage} />`;
  else if (path.startsWith('/services/')) page = html`<${ServiceDetail} slug=${path.split('/')[2]} />`;
  else if (path === '/blog') page = html`<${BlogPage} />`;
  else if (path.startsWith('/blog/')) page = html`<${BlogPost} slug=${path.split('/')[2]} />`;
  else if (path === '/faq') page = html`<${FaqPage} />`;
  else if (path === '/request-talent') page = html`<${RequestTalent} q=${q} />`;
  else if (path === '/terms') page = html`<${TermsPage} />`;
  else if (path === '/privacy') page = html`<${PrivacyPage} />`;
  else if (path === '/careers') page = html`<${Careers} />`;
  else if (path.startsWith('/careers/')) page = html`<${CareerJob} id=${path.split('/')[2] || ''} />`;
  else if (path === '/contact') page = html`<${ContactPage} />`;
  else if (path === '/login') page = html`<${LoginPage} q=${q} />`;
  else if (path.startsWith('/sign/')) { const [, , sid, stok] = path.split('/'); page = html`<${SignPublic} id=${sid || ''} tok=${stok || ''} />`; }
  else if (path.startsWith('/invoice/')) { const [, , iid, itok] = path.split('/'); page = html`<${InvoicePublic} id=${iid || ''} tok=${itok || ''} />`; }
  else page = html`<${NotFound} />`;
  return html`<div className="site">
    <a className="skip" href="#/" onClick=${e => { e.preventDefault(); const m = document.getElementById('main'); m && m.focus(); }}>Skip to content</a>
    <${SiteHeader} path=${path} />
    <main id="main" tabIndex="-1">${page}</main>
    <${SiteFooter} />
    <${EdgeBot} />
  </div>`;
}
ReactDOM.createRoot(document.getElementById('app')).render(html`<${ToastHost}><${App} /><//>`);
