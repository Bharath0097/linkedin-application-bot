const { useState, useEffect, useMemo, useRef, useCallback, createContext, useContext, Fragment } = React;
try {
  const t = localStorage.getItem('theme');
  if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
} catch (e) {
  /* storage blocked */
}
const themeNow = () =>
  document.documentElement.getAttribute('data-theme') ||
  (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  try {
    localStorage.setItem('theme', t);
  } catch (e) {}
}
/* v38: the look of the portals, "glass" (where everyone starts) or "classic" (the look before v38). A person's own
   choice is kept on their device (Appearance menu); without one, the look an administrator picked for everyone applies
   (Cap.look, from the server), remembered per site address so the next visit draws in it from the start (js/boot.js). */
const LOOKS = ['glass', 'classic'];
const lookKey = () => 'lookSite:' + location.pathname;
const lookNow = () => (document.documentElement.getAttribute('data-look') === 'classic' ? 'classic' : 'glass');
const lookMine = () => {
  try {
    const v = localStorage.getItem('look');
    return LOOKS.includes(v) ? v : '';
  } catch (e) {
    return '';
  }
};
function applyLook() {
  let site = LOOKS.includes(Cap.look) ? Cap.look : '';
  if (site) {
    try {
      localStorage.setItem(lookKey(), site);
    } catch (e) {}
  } else {
    try {
      site = localStorage.getItem(lookKey()) || '';
    } catch (e) {}
  }
  const v = lookMine() || (LOOKS.includes(site) ? site : 'glass');
  document.documentElement.setAttribute('data-look', v);
}
// '' follows the look everyone starts with again
function setLook(v) {
  try {
    if (LOOKS.includes(v)) localStorage.setItem('look', v);
    else localStorage.removeItem('look');
  } catch (e) {}
  applyLook();
}
// which part of the site is showing: the glass look dresses the portals ("app") and the sign-in pages ("auth"); the
// public website ("site") keeps its own look. Windows and messages are drawn at the page root and follow this.
const lookArea = path =>
  /^\/(portal|client)(\/|$)/.test(path) ? 'app' : ['/login', '/forgot', '/reset', '/stop-change', '/ws-setup', '/get-portal'].includes(path) ? 'auth' : 'site';
/* v37: in a company workspace (StratEdge Workspaces) the pages carry the company's name wherever they were written
   with StratEdge's: wsBrandApply() sets WS_BRAND once the workspace is known, and every element's text children and
   its title / alt / placeholder / aria-label pass through wsBrandStr. "StratEdge Workspaces" (the service) stays.
   On StratEdge's own site WS_BRAND stays null and elements are made exactly as before. */
let WS_BRAND = null;
let WS_MAIL = ''; // the workspace's contact address, in place of StratEdge's
let WS_DOMAIN = ''; // its domain, in the examples of hints and placeholders
const WS_BRAND_RE = /StratEdge IT Consulting Inc\.|StratEdge IT Consulting|StratEdge(?! Workspaces)/g;
// v38: in page text, a real web address (https://… or a subdomain of it) is left exactly as it is: the workspace's own
// addresses (…/w/<name>/, <name>.stratedgeitconsulting.com) are shown to be copied into Google, DNS and so on, and must
// not turn into the company's email domain. Examples without a scheme ("postal.stratedgeitconsulting.com") still change.
const wsBrandStr = (s, keepUrls) => {
  if (typeof s !== 'string' || !WS_BRAND) return s;
  if (s.indexOf('StratEdge') >= 0) s = s.replace(WS_BRAND_RE, () => WS_BRAND);
  if (s.indexOf('stratedgeitconsulting.com') >= 0)
    s = s
      .replace(/info@stratedgeitconsulting\.com/g, () => WS_MAIL)
      .replace(/(:\/\/(?:[a-z0-9-]+\.)*)?stratedgeitconsulting\.com/gi, (m, url) => (url && keepUrls ? m : (url || '') + WS_DOMAIN));
  return s;
};
const wsBrandKid = k => (typeof k === 'string' ? wsBrandStr(k, true) : Array.isArray(k) ? k.map(wsBrandKid) : k);
const WS_TEXT_PROPS = ['title', 'alt', 'placeholder', 'aria-label'];
function seH(type, props, ...kids) {
  if (WS_BRAND) {
    for (let i = 0; i < kids.length; i++) kids[i] = wsBrandKid(kids[i]);
    if (props && typeof type === 'string') {
      for (const p of WS_TEXT_PROPS)
        if (typeof props[p] === 'string' && (props[p].indexOf('StratEdge') >= 0 || props[p].indexOf('stratedgeitconsulting.com') >= 0)) props = { ...props, [p]: wsBrandStr(props[p]) };
      if (typeof props.href === 'string' && props.href.startsWith('mailto:') && props.href.indexOf('stratedgeitconsulting.com') >= 0) props = { ...props, href: wsBrandStr(props.href) };
    }
  }
  return React.createElement(type, props, ...kids);
}
const html = htm.bind(seH);

/* ================= Company facts ================= */
const CO = {
  name: 'StratEdge IT Consulting',
  legal: 'StratEdge IT Consulting Inc.',
  phone: '+1 (302) 434-8889',
  tel: '+13024348889',
  email: 'info@stratedgeitconsulting.com',
  hours: 'Mon–Fri, 9 AM–7 PM',
  addr1: '1553 Route 27, Suite 1000',
  addr2: 'Somerset, NJ 08873',
  map: 'https://maps.app.goo.gl/7Bm8MdkeHx6ifoxMA',
  linkedin: 'https://www.linkedin.com/company/stratedge-it-consulting-inc/',
  site: 'https://stratedgeitconsulting.com',
};

/* ================= Date & number helpers ================= */
const pad = n => String(n).padStart(2, '0');
const dkey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/* Dates are stored as YYYY-MM-DD text. A missing or odd value gives an invalid date rather than an error,
   and the formatters below show nothing for it. */
const parseD = k => {
  const [y, m, d] = String(k || '').split('-').map(Number);
  return y > 0 && m > 0 ? new Date(y, m - 1, d || 1) : new Date(NaN);
};
const addDays = (k, n) => {
  const d = parseD(k);
  d.setDate(d.getDate() + n);
  return dkey(d);
};
const weekStart = (k = dkey()) => {
  const d = parseD(k);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return dkey(d);
};
const weekDays = ws => Array.from({ length: 7 }, (_, i) => addDays(ws, i));
const mkey = k => String(k || '').slice(0, 7);
const addMonths = (mk, n) => {
  const [y, m] = String(mk || mkey(dkey())).split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return isNaN(d) ? mkey(dkey()) : `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};
const validDate = d => d instanceof Date && !isNaN(d);
const monthLabel = mk => {
  const [y, m] = String(mk || '').split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return validDate(d) ? d.toLocaleDateString([], { month: 'long', year: 'numeric' }) : '';
};
const fmtTime = ts => (validDate(new Date(ts)) ? new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');
const fmtDate = (k, o) => {
  const d = parseD(k);
  return validDate(d) ? d.toLocaleDateString([], o || { weekday: 'short', month: 'short', day: 'numeric' }) : '';
};
const fmtTs = ts =>
  validDate(new Date(ts)) ? new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
const fmtDay = ts => (validDate(new Date(ts)) ? new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const weekLabel = ws =>
  `${fmtDate(ws, { month: 'short', day: 'numeric' })} – ${fmtDate(addDays(ws, 6), { month: 'short', day: 'numeric', year: 'numeric' })}`;
const mins = (a, b) => Math.max(0, ((b == null ? Date.now() : b) - a) / 60000);
const hm = m => {
  m = Math.round(m);
  return `${Math.floor(m / 60)}h ${pad(m % 60)}m`;
};
const hrs = m => (m / 60).toFixed(2);
const h1 = n =>
  (Math.round((+n || 0) * 100) / 100)
    .toFixed(2)
    .replace(/\.00$/, '')
    .replace(/(\.\d)0$/, '$1');
const toLocalInput = ts => {
  const d = new Date(ts);
  return `${dkey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = s => {
  if (!s) return NaN;
  const [d, t] = s.split('T');
  const [y, m, dd] = d.split('-').map(Number);
  const [hh, mi] = (t || '0:0').split(':').map(Number);
  return new Date(y, m - 1, dd, hh, mi).getTime();
};
const bizDays = (f, t) => {
  if (!f || !t || t < f) return 0;
  let n = 0;
  for (let k = f; k <= t; k = addDays(k, 1)) {
    const wd = parseD(k).getDay();
    if (wd && wd < 6) n++;
  }
  return n;
};
const nid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-5);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clean = o => JSON.parse(JSON.stringify(o));
const firstName = n => String(n || '').trim().split(/\s+/)[0] || '';
const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};
const sizeLabel = b =>
  b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
async function pMap(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k], k);
      }
    })
  );
  return out;
}

/* ================= Server API (PHP backend) ================= */
const API = typeof API_BASE === 'string' ? API_BASE : 'api/index.php?r=';
const LOGIN = '#/login';
const API_TIMEOUT = 30000; // a request that gets no answer in this time fails instead of hanging a page
/* v34: when the person last clicked, typed, scrolled or touched (the session ends after a while without any) */
let SE_LAST_INPUT = Date.now();
['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev => addEventListener(ev, () => (SE_LAST_INPUT = Date.now()), { passive: true, capture: true }));
/* v35: a request that needs something first is answered here and then sent again, so no page has to know:
   - "pow_required": a public form (or a sign-in while the site is under attack) must carry a solved bot check. The
     server sends a small puzzle (find n with SHA-256(salt + n) = challenge); the browser solves it in a fraction of a
     second and repeats the request with the answer. People never see it; a bot sending thousands pays each time.
   - "reauth": a sensitive action needs a password, passkey or code from the last few minutes. The "Confirm it's you"
     window opens (SeGate.reauth, set by ReauthHost in security.js) and the action is repeated once it is confirmed. */
const SeGate = { reauth: null };
async function seGated(e, again, opts) {
  const o = opts || {};
  if (e && e.code === 'pow_required' && e.pow && !o.powTried) {
    const tok = await powSolve(e.pow);
    return again({ ...o, powTried: true, headers: { ...(o.headers || {}), 'X-SE-Pow': tok } });
  }
  if (e && e.code === 'reauth' && SeGate.reauth && !o.reauthTried && Cap.state === 'ready') {
    await SeGate.reauth(e);
    return again({ ...o, reauthTried: true });
  }
  throw e;
}
/** SHA-256 for browsers without crypto.subtle (a page opened over plain http on a local network). */
function seSha256(msg) {
  const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  const bytes = new TextEncoder().encode(msg);
  const len = bytes.length;
  const n = (((len + 8) >> 6) + 1) << 4;
  const w = new Uint32Array(n);
  for (let i = 0; i < len; i++) w[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
  w[len >> 2] |= 0x80 << (24 - (len % 4) * 8);
  w[n - 1] = len * 8;
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const m = new Uint32Array(64);
  const r = (x, y) => (x >>> y) | (x << (32 - y));
  for (let b = 0; b < n; b += 16) {
    for (let i = 0; i < 64; i++) m[i] = i < 16 ? w[b + i] : (r(m[i - 2], 17) ^ r(m[i - 2], 19) ^ (m[i - 2] >>> 10)) + m[i - 7] + (r(m[i - 15], 7) ^ r(m[i - 15], 18) ^ (m[i - 15] >>> 3)) + m[i - 16];
    let [a, bb, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + m[i]) | 0;
      const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & bb) ^ (a & c) ^ (bb & c))) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = bb;
      bb = a;
      a = (t1 + t2) | 0;
    }
    [a, bb, c, d, e, f, g, hh].forEach((v, i) => (h[i] = (h[i] + v) | 0));
  }
  return h.map(v => (v >>> 0).toString(16).padStart(8, '0')).join('');
}
/** Solves the server's bot-check puzzle; returns the answer for the X-SE-Pow header. */
async function powSolve(ch) {
  const max = Math.min(+ch.max || 0, 2000000);
  const target = new Uint8Array((String(ch.challenge).match(/../g) || []).map(x => parseInt(x, 16)));
  const subtle = typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder === 'function' ? crypto.subtle : null;
  const enc = subtle ? new TextEncoder() : null;
  let found = -1;
  if (subtle) {
    const same = buf => {
      const v = new Uint8Array(buf);
      for (let i = 0; i < 32; i++) if (v[i] !== target[i]) return false;
      return true;
    };
    for (let from = 0; from <= max && found < 0; from += 2000) {
      const to = Math.min(max, from + 1999);
      const hs = await Promise.all(Array.from({ length: to - from + 1 }, (_, k) => subtle.digest('SHA-256', enc.encode(ch.salt + (from + k)))));
      for (let k = 0; k < hs.length; k++) {
        if (same(hs[k])) {
          found = from + k;
          break;
        }
      }
    }
  } else {
    for (let i = 0; i <= max; i++) {
      if (seSha256(ch.salt + i) === ch.challenge) {
        found = i;
        break;
      }
      if (i % 5000 === 4999) await sleep(0);
    }
  }
  if (found < 0) throw { code: 'unavailable', message: 'The bot check could not be completed. Reload the page and try again.' };
  return btoa(JSON.stringify({ salt: ch.salt, challenge: ch.challenge, sig: ch.sig, n: found }));
}
async function api(route, body, opts) {
  try {
    return await apiOnce(route, body, opts);
  } catch (e) {
    return seGated(e, o => api(route, body, o), opts);
  }
}
/* v38: a sign-in step (password, second step, passkey, sign-out...) gives the browser a new session cookie. A request
   that left with the old cookie while it was on its way could come back with a fresh, empty session that replaced the
   new one; the second step then said "The sign-in timed out" (the data refresh polls every few seconds, even on the
   login page). So a sign-in step first lets the requests already on their way finish (a few seconds at most), and
   every other request waits until it is done. */
const SE_AUTH_ROUTE = /^(register|login|logout|sso_gis|password|auth_reauth|auth_reauth_drop|ws_setup|mfa_\w+|pk_\w+)$/;
let seAuthBusy = null;
let seInFlight = 0;
async function apiOnce(route, body, opts) {
  const auth = SE_AUTH_ROUTE.test(route);
  let release = null;
  if (auth) {
    for (const t = Date.now(); seInFlight > 0 && Date.now() - t < 4000; ) await new Promise(r => setTimeout(r, 40));
    while (seAuthBusy) await seAuthBusy;
    seAuthBusy = new Promise(r => (release = r));
  } else {
    while (seAuthBusy) await seAuthBusy;
    seInFlight++;
  }
  try {
    return await apiSend(route, body, opts);
  } finally {
    if (auth) {
      seAuthBusy = null;
      release();
    } else seInFlight--;
  }
}
async function apiSend(route, body, opts) {
  const isForm = body instanceof FormData;
  const ac = typeof AbortController === 'function' ? new AbortController() : null;
  // a few calls wait on the assistant (resume tailoring): they pass a longer timeout
  const timer = ac && setTimeout(() => ac.abort(), (opts && opts.timeout) || API_TIMEOUT);
  let res;
  try {
    res = await fetch(API + route, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'X-Requested-With': 'fetch',
        // v34: background polls count as activity only right after the person clicked or typed (idle sign-out)
        ...(Date.now() - SE_LAST_INPUT < 120000 ? { 'X-SE-Active': '1' } : {}),
        ...(body === undefined || isForm ? {} : { 'Content-Type': 'application/json' }),
        ...((opts && opts.headers) || {}),
      },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      signal: ac ? ac.signal : undefined,
    });
    // v35: a download (a CSV, a file built by the server) comes back as a Blob
    if (opts && opts.blob && res.ok) return await res.blob();
  } catch (e) {
    throw {
      code: 'unavailable',
      message:
        e && e.name === 'AbortError'
          ? 'The server took too long to answer. Check your connection and try again.'
          : 'The server could not be reached. Check your connection and try again.',
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
  let j = null;
  try {
    j = await res.json();
  } catch (e) {
    /* non-JSON */
  }
  if (!res.ok) {
    // (a request for a fresh password or passkey confirmation is not a signed-out session: the page asks for it)
    if (res.status === 401 && Cap.state === 'ready' && !(j && j.error === 'reauth')) {
      Cap.state = 'noid';
      Cap.me = null;
      Cap.uid = null;
      Cap.isAdmin = false;
      capNotify();
      // v83: a session that ended leaves no copies of this person's records in the browser either
      Sync.subs.clear();
      clearTimeout(SnapCache.timer);
      SnapCache.load(null);
      location.hash = '#/login?expired=1';
    }
    throw {
      ...(j && typeof j === 'object' ? j : {}),
      code: (j && j.error) || (res.status === 403 ? 'invalid_argument' : 'unavailable'),
      message: (j && j.message) || 'The server could not be reached.',
    };
  }
  return j;
}
function upload(route, form, onProgress, opts) {
  return uploadOnce(route, form, onProgress, opts).catch(e => seGated(e, o => upload(route, form, onProgress, o), opts));
}
function uploadOnce(route, form, onProgress, opts) {
  return new Promise((res, rej) => {
    const x = new XMLHttpRequest();
    x.open('POST', API + route);
    x.setRequestHeader('X-Requested-With', 'fetch');
    Object.entries((opts && opts.headers) || {}).forEach(([k, v]) => x.setRequestHeader(k, v));
    x.withCredentials = true;
    x.upload.onprogress = e => {
      if (e.lengthComputable && onProgress) onProgress(Math.min(0.98, e.loaded / e.total));
    };
    x.onload = () => {
      let j = null;
      try {
        j = JSON.parse(x.responseText);
      } catch (e) {}
      if (x.status >= 200 && x.status < 300) res(j);
      else rej({ ...(j && typeof j === 'object' ? j : {}), code: (j && j.error) || 'unavailable', message: (j && j.message) || 'Upload failed.' });
    };
    x.onerror = () =>
      rej({ code: 'unavailable', message: 'Upload failed. Check your connection and try again.' });
    x.send(form);
  });
}
const avatarFor = (name, id) => {
  let h = 0;
  for (const ch of String(id || name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  const ini =
    String(name || '?')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(w => w[0] || '')
      .join('')
      .toUpperCase() || '?';
  return {
    url:
      'data:image/svg+xml,' +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="32" fill="hsl(${hue} 45% 42%)"/><text x="32" y="40" font-family="Arial,sans-serif" font-size="26" font-weight="700" text-anchor="middle" fill="#fff">${ini}</text></svg>`
      ),
    color: `hsl(${hue} 45% 42%)`,
  };
};

/* Live updates: every open subscription is refreshed in one request, a few seconds apart, and right after any write. */
const POLL = typeof POLL_MS === 'number' ? POLL_MS : 6000;
const docSnap = (path, e, d) => ({
  id: path.split('/').pop(),
  exists: !!e,
  data: () => (e ? d : undefined),
  metadata: { fromCache: false, hasPendingWrites: false },
});
const colSnap = docs => {
  const ds = (docs || []).map(([id, d]) => ({
    id,
    exists: true,
    data: () => d,
    metadata: { fromCache: false, hasPendingWrites: false },
  }));
  return {
    docs: ds,
    size: ds.length,
    empty: !ds.length,
    docChanges: () => [],
    metadata: { fromCache: false, hasPendingWrites: false },
  };
};
/* The same ordering the server applies (api/lib.php colList): by a field, missing values last, ties by id. Used when a
   collection is updated from a delta instead of being re-sent whole. */
function sortDocs(list, f, dir) {
  const num = v => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !isNaN(v));
  const cmpId = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  if (!f) return list.sort(cmpId);
  const desc = dir === 'desc';
  return list.sort((a, b) => {
    const x = a[1] && a[1][f] != null ? a[1][f] : null;
    const y = b[1] && b[1][f] != null ? b[1][f] : null;
    if (x === null && y === null) return cmpId(a, b);
    if (x === null) return 1;
    if (y === null) return -1;
    const c = num(x) && num(y) ? +x - +y : String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0;
    return desc ? -c : c;
  });
}
/* The last answer for every record and list this person looked at, kept in memory and (per person, size-capped) in
   the browser, so a page opens with its data at once and the server only confirms or sends what changed. Cleared when
   the person signs out or the session ends. Pay, security and sign-in records are never kept in the browser. */
const SnapCache = {
  uid: null,
  mem: new Map(),
  timer: null,
  keyOf() {
    return 'se_snap:' + this.uid;
  },
  load(uid) {
    if (this.uid === uid) return;
    this.uid = uid;
    this.mem = new Map();
    if (!uid) {
      this.clearAll();
      return;
    }
    // v83: whoever used this browser before (a session that timed out) leaves no cached records for the next person
    try {
      Object.keys(localStorage)
        .filter(k => k.startsWith('se_snap:') && k !== this.keyOf())
        .forEach(k => localStorage.removeItem(k));
    } catch (e) {
      /* fine */
    }
    try {
      const j = JSON.parse(localStorage.getItem(this.keyOf()) || 'null');
      if (j && j.v === 1 && Array.isArray(j.e)) j.e.forEach(([k, x]) => x && x.raw && this.mem.set(k, x));
    } catch (e) {
      /* no cache */
    }
  },
  get(k) {
    return this.mem.get(k) || null;
  },
  put(k, v, raw) {
    if (!this.uid) return;
    this.mem.set(k, { v, raw, at: Date.now() });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.save(), 1500);
  },
  // v83: the books and bank lines (org/acct, payroll runs included) stay in memory only, like pay and security records
  persistable: k => !/^(doc|col)\|(pays|sec|log|org\/acct)(\/|\||$)/.test(k),
  save() {
    if (!this.uid) return;
    try {
      const rows = [...this.mem.entries()].filter(([k]) => this.persistable(k)).sort((a, b) => b[1].at - a[1].at);
      const out = [];
      let total = 0;
      for (const [k, x] of rows) {
        const sz = JSON.stringify(x).length;
        if (sz > 300000) continue;
        if (total + sz > 2000000) break;
        total += sz;
        out.push([k, x]);
      }
      localStorage.setItem(this.keyOf(), JSON.stringify({ v: 1, e: out }));
    } catch (e) {
      /* storage full or blocked: memory only */
    }
  },
  clearAll() {
    try {
      Object.keys(localStorage)
        .filter(k => k.startsWith('se_snap:'))
        .forEach(k => localStorage.removeItem(k));
    } catch (e) {
      /* fine */
    }
    // v83: the payroll page's quick-open copies (se_pay_*) go too at sign-out
    try {
      Object.keys(sessionStorage)
        .filter(k => k.startsWith('se_pay_'))
        .forEach(k => sessionStorage.removeItem(k));
    } catch (e) {
      /* fine */
    }
  },
};
const Sync = {
  subs: new Map(),
  t: null,
  busy: false,
  pending: false,
  n: 0,
  key: q => [q.t, q.p, q.o || '', q.d || '', q.l || '', q.x || ''].join('|'),
  on(q, cb) {
    const k = this.key(q);
    let s = this.subs.get(k);
    if (!s) {
      s = { q, cbs: new Set(), v: null, res: null, docs: null };
      // open with the last known answer; the next poll confirms it or sends what changed
      const c = SnapCache.get(k);
      if (c && c.raw) {
        s.v = c.v;
        if (q.t === 'doc') s.res = docSnap(q.p, c.raw.e, c.raw.d);
        else {
          s.docs = c.raw.docs || [];
          s.res = colSnap(s.docs);
        }
        s.res.metadata.fromCache = true;
      }
      this.subs.set(k, s);
    }
    s.cbs.add(cb);
    if (s.res) cb(s.res);
    this.kick(30);
    return () => {
      s.cbs.delete(cb);
      if (!s.cbs.size) this.subs.delete(k);
    };
  },
  kick(ms) {
    // while a poll is in flight, a kick marks it as stale instead of arming a timer: the in-flight poll's wrap-up used
    // to cancel that timer (schedule() clears it), which left a page opened mid-poll waiting a full interval for its
    // first refresh (a spinner or stale cached rows for up to 18 s)
    if (this.busy) {
      this.pending = true;
      return;
    }
    clearTimeout(this.t);
    this.t = setTimeout(() => this.poll(), ms == null ? 200 : ms);
  },
  schedule() {
    clearTimeout(this.t);
    // after two quiet minutes the page checks for changes a third as often, which keeps busy offices light on the server
    const idle = Date.now() - (this.lastAct || 0) > 120000;
    this.t = setTimeout(() => this.poll(), idle ? POLL * 3 : POLL);
  },
  async poll() {
    if (this.busy) {
      this.pending = true;
      return;
    }
    const list = [...this.subs.values()];
    if (!list.length || (document.hidden && !this.pending)) {
      this.schedule();
      return;
    }
    this.busy = true;
    try {
      // the server answers up to 60 reads per request, so a page with more open records asks in parallel parts
      const qs = list.map(s => ({ ...s.q, v: s.v, ...(s.q.t === 'col' && s.v && s.docs && !s.q.l ? { since: parseInt(s.v, 10) || 0 } : {}) }));
      const parts = [];
      for (let i = 0; i < qs.length; i += 60) parts.push(qs.slice(i, i + 60));
      const outs = await Promise.all(parts.map(q => api('batch', { q })));
      const out = { r: outs.flatMap(o => (o && o.r) || []) };
      (out.r || []).forEach((r, i) => {
        const s = list[i];
        if (!s || this.subs.get(this.key(s.q)) !== s) return;
        if (r.err) {
          s.cbs.forEach(cb => cb(null, { code: 'invalid_argument', message: r.err }));
          return;
        }
        if (r.same) return;
        s.v = r.v;
        if (s.q.t === 'doc') {
          s.res = docSnap(s.q.p, r.e, r.d);
          SnapCache.put(this.key(s.q), r.v, { e: r.e, d: r.d });
        } else if (r.delta) {
          // only the changed records came through: merge them into what the page already has
          const map = new Map(s.docs || []);
          (r.docs || []).forEach(([id, d]) => map.set(id, d));
          const keep = new Set(r.ids || []);
          let missing = false;
          keep.forEach(id => {
            if (!map.has(id)) missing = true;
          });
          s.docs = sortDocs([...map].filter(([id]) => keep.has(id)), s.q.o, s.q.d);
          s.res = colSnap(s.docs);
          SnapCache.put(this.key(s.q), r.v, { docs: s.docs });
          if (missing) {
            // a record became visible without changing (access was widened): fetch the whole list next time
            s.v = null;
            s.docs = null;
            this.pending = true;
          }
        } else {
          s.docs = r.docs || [];
          s.res = colSnap(s.docs);
          SnapCache.put(this.key(s.q), r.v, { docs: s.docs });
        }
        s.cbs.forEach(cb => cb(s.res));
      });
    } catch (e) {
      /* network hiccup: next poll will retry */
    }
    this.busy = false;
    if (++this.n % 10 === 0 && Cap.state === 'ready') {
      const was = Cap.roleName + '|' + (Cap.portals || []).join(',');
      reloadCaps().then(() => {
        if (Cap.roleName + '|' + (Cap.portals || []).join(',') !== was && Cap.state === 'ready') location.reload();
      });
    }
    if (this.pending) {
      this.pending = false;
      this.kick(150);
    } else this.schedule();
  },
};
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) Sync.kick(0);
});
function chkPath(p, doc) {
  const segs = p.split('/');
  if (
    !p ||
    segs.some(s => !s || !/^[A-Za-z0-9_\-.~:@+]+$/.test(s)) ||
    (doc && segs.length % 2) ||
    (!doc && !(segs.length % 2))
  )
    throw new TypeError('Bad path: ' + p);
}
function docRef(path) {
  chkPath(path, true);
  return {
    id: path.split('/').pop(),
    path,
    get: async () => {
      const r = await api('doc&path=' + encodeURIComponent(path));
      return docSnap(path, r.e, r.d);
    },
    set: async data => {
      await api('set', { path, data });
      Sync.kick();
    },
    update: async data => {
      await api('update', { path, data });
      Sync.kick();
    },
    delete: async () => {
      await api('delete', { path });
      Sync.kick();
    },
    onSnapshot: (next, err) => Sync.on({ t: 'doc', p: path }, (res, e) => (e ? err && err(e) : next(res))),
    collection: sub => colRef(path + '/' + sub, {}),
  };
}
function colRef(path, q) {
  chkPath(path, false);
  return {
    path,
    where: () => colRef(path, q),
    orderBy: (f, d) => colRef(path, { ...q, o: f, d: d || 'asc' }),
    limit: n => colRef(path, { ...q, l: n }),
    // v36.2: a named server-side filter ("nolite": leave out records a search saved that nobody has worked with)
    only: x => colRef(path, { ...q, x }),
    get: async () => {
      const r = await api(
        'col&path=' +
          encodeURIComponent(path) +
          (q.o ? '&o=' + encodeURIComponent(q.o) + '&d=' + (q.d || 'asc') : '') +
          (q.l ? '&l=' + q.l : '') +
          (q.x ? '&x=' + encodeURIComponent(q.x) : '')
      );
      return colSnap(r.docs);
    },
    onSnapshot: (next, err) =>
      Sync.on({ t: 'col', p: path, o: q.o, d: q.d, l: q.l, ...(q.x ? { x: q.x } : {}) }, (res, e) => (e ? err && err(e) : next(res))),
    doc: id => docRef(path + '/' + (id || nid())),
    add: async d => {
      const ref = docRef(path + '/' + nid());
      await ref.set(d);
      return ref;
    },
  };
}
const ServerDB = { doc: p => docRef(p), collection: p => colRef(p, {}) };
const ServerUsers = {
  me: async () =>
    Cap.me || {
      id: null,
      name: '',
      avatarUrl: avatarFor('', '').url,
      color: '',
      email: null,
      isOwner: false,
      canEdit: false,
    },
  id: async () => Cap.uid,
  isOwner: async () => Cap.isAdmin,
  canEdit: async () => Cap.isAdmin,
  can: async () => !!Cap.uid,
  profiles: async ids => {
    const list = [...new Set((Array.isArray(ids) ? ids : [ids]).filter(Boolean))];
    const out = {};
    let got = {};
    try {
      got = (await api('profiles', { ids: list })).profiles || {};
    } catch (e) {
      /* unresolved */
    }
    list.forEach(id => {
      const n = (got[id] && got[id].name) || '';
      const a = avatarFor(n, id);
      out[id] = {
        id,
        name: n,
        avatarUrl: a.url,
        color: a.color,
        email: null,
        isMe: id === Cap.uid,
        guest: false,
      };
    });
    return out;
  },
  search: async () => [],
};
const FileSaver = {
  save: async ({ filename, data }) => {
    const blob = data instanceof Blob ? data : new Blob([data]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return { status: 'saved' };
  },
};

const Cap = {
  state: 'loading',
  db: ServerDB,
  user: ServerUsers,
  dl: FileSaver,
  me: null,
  uid: null,
  isAdmin: false,
  isHR: false,
  roleName: '',
  books: 'full',
  noPay: false,
  isOwner: false,
  canWrite: null,
  portal: '',
  portals: [],
  clients: [],
  roles: [],
  jobs: false,
  ct: '', // v32: consultant type for the job rules ('' = no limits)
  billing: null, // v32: students and outside consultants: their plan (status, features)
  mfa: null, // v34: a sign-in waiting for its second step (what the sign-in page shows)
  sec: null, // v34: { mustPw, mfa, mfaDue, policies } for the signed-in person
  pk: false, // v34: passkey sign-in is switched on
  desk: false, // v34: in a service desk assignment group
  chat: false, // v35: may use Messages
  ids: false, // v36.1: may check IDs (ID checks)
  fa: {}, // v58: per-person feature overrides from Admin > Roles & access
};
/* v32: consultant types (Admin > Consultant types & job rules); the server keeps the same list (api/rules.php). */
const CT_NAMES = {
  w2: 'W2 consultant',
  c2c: 'C2C consultant',
  1099: '1099 / independent',
  fte: 'Full-time job seeker',
  outside: 'Outside consultant (membership)',
  student: 'Student / trainee',
};
// in this order everywhere (an object puts the numeric key "1099" first)
const CT_ORDER = ['w2', 'c2c', '1099', 'fte', 'outside', 'student'];
const ctEntries = (names, skip) => CT_ORDER.filter(k => (names || CT_NAMES)[k] && !(skip || []).includes(k)).map(k => [k, (names || CT_NAMES)[k]]);
/* v32: is a paid feature still locked for this student or outside consultant? (false for everyone else) */
const planLocked = feature => {
  const b = Cap.billing;
  return !!(b && b.required && !(b.active && (b.feat || []).includes(feature)));
};
/* The portals a person can open, in the order the chooser and the switcher show them. */
const PORTAL_INFO = {
  admin: { n: 'Admin portal', d: 'Every page: people, time and pay, finance, recruiting, messages and system settings.', i: 'grid', href: '#/portal/admin' },
  hr: { n: 'HR portal', d: 'Onboarding, documents, policies, HRMS, candidates, approvals and the team.', i: 'users', href: '#/portal/hr' },
  acct: { n: 'Accounting portal', d: 'Invoices, bills, payroll runs, paystubs, taxes and accounting reports.', i: 'money', href: '#/portal/acct' },
  mgr: { n: 'Manager portal', d: 'Your direct reports: approvals, attendance and tasks.', i: 'check', href: '#/portal/mgr' },
  employee: { n: 'Employee portal', d: 'Time, pay, tasks, documents, email, recruiting tools and the Bench desk.', i: 'clock', href: '#/portal/employee' },
  consultant: { n: 'Consultant portal', d: 'Your resume, matched jobs, timesheets and applications.', i: 'brief', href: '#/portal/consultant' },
  client: { n: 'Client portal', d: 'Consultants on your projects, timesheet approvals, requirements and invoices.', i: 'building', href: '#/portal/client' },
  student: { n: 'Student portal', d: 'Your plan and payments, courses, StratEdge certifications, daily tests, live projects and job help.', i: 'compass', href: '#/portal/student' },
};
const STAFF_KEYS = ['admin', 'hr', 'acct', 'mgr'];
const MEMBER_KEYS = ['employee', 'consultant', 'client', 'student'];
const PORTAL_LABEL = {
  consultant: 'Consultant portal',
  employee: 'Employee portal',
  employer: 'Client portal',
  client: 'Client portal',
  student: 'Student portal',
};
const portalLabel = role => PORTAL_LABEL[role] || 'Employee portal';
const portalKeyOf = role =>
  role === 'employer'
    ? 'client'
    : role === 'employee'
      ? 'employee'
      : role === 'bench'
        ? 'employee'
        : role === 'student'
          ? 'student'
          : 'consultant';
const reloadedFor = b => {
  try {
    return sessionStorage.getItem('se_reload_for') === b;
  } catch (e) {
    return true;
  }
};
const capListeners = new Set();
const capNotify = () => capListeners.forEach(f => f({ ...Cap }));
/* Boot timings for Admin > System health > Speed check: how long the page shell, the scripts and the styles took
   and whether they travelled compressed. Captured once, right after the page has loaded. */
const BOOT_PERF = { nav: null, res: [] };
try {
  if (performance.setResourceTimingBufferSize) performance.setResourceTimingBufferSize(600);
  const grab = () => {
    try {
      const n = performance.getEntriesByType('navigation')[0];
      if (n) BOOT_PERF.nav = { ttfb: Math.round(n.responseStart - n.requestStart), start: Math.round(n.responseStart), dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), proto: n.nextHopProtocol || '', enc: n.encodedBodySize || 0, dec: n.decodedBodySize || 0 };
      BOOT_PERF.res = performance
        .getEntriesByType('resource')
        .filter(r => /\/(js|css)\/|\.woff2/.test(r.name) && !/index\.php/.test(r.name))
        .map(r => ({ n: r.name.replace(/^.*\//, '').split('?')[0], ms: Math.round(r.duration), enc: r.encodedBodySize || 0, dec: r.decodedBodySize || 0, tr: r.transferSize || 0 }));
    } catch (e) {
      /* fine */
    }
  };
  if (document.readyState === 'complete') setTimeout(grab, 300);
  else addEventListener('load', () => setTimeout(grab, 300));
} catch (e) {
  /* fine */
}

/* v45.2: the site ships in parts, so the website and the sign-in page start fast:
     js/app.js     the website, the sign-in pages and the pages anyone may open from a link (always loaded)
     js/member.js  the portals themselves (consultant, employee, bench, client, student) and what staff portals build on
     js/staff.js   admin, HR, accounting, manager, recruiting and bench pages
     js/tax.js     the tax center;  js/work.js  work boards, expense claims, goals and immigration cases
   A later part runs only after the member part; their downloads start together (boot.js starts them even earlier from
   the address, and for someone signed in). */
// v62: site2 = the website's link pages (the portals need it, so member waits for it); staff2 = the staff pages opened
// now and then (fetched after staff)
const BUNDLE_FLAG = { site2: '__SE_SITE2', member: '__SE_MEMBER', staff: '__SE_STAFF', staff2: '__SE_STAFF2', tax: '__SE_TAX', work: '__SE_WORK' };
const bundleSrc = name => 'js/' + name + '.js?v=' + (typeof APP_BUILD === 'string' ? APP_BUILD : Date.now());
const bundleLoads = {};
const bundleWait = { member: [], site2: [] };
function prefetchBundle(name) {
  try {
    if (window[BUNDLE_FLAG[name]] || document.querySelector('link[data-pre="' + name + '"]')) return;
    const l = document.createElement('link');
    l.rel = 'preload';
    l.as = 'script';
    l.href = bundleSrc(name);
    l.setAttribute('data-pre', name);
    document.head.appendChild(l);
  } catch (e) {
    /* the script tag below still loads it */
  }
}
function loadBundle(name) {
  const flag = BUNDLE_FLAG[name];
  if (window[flag]) return Promise.resolve();
  if (!bundleLoads[name]) {
    prefetchBundle(name);
    bundleLoads[name] = (name === 'site2' ? Promise.resolve() : name === 'member' ? loadBundle('site2') : name === 'staff2' ? loadBundle('staff') : loadBundle('member')).then(
      () =>
        new Promise((res, rej) => {
          const s = document.createElement('script');
          s.src = bundleSrc(name);
          s.async = true;
          s.onload = () => {
            if (!window[flag]) return rej(new Error(name + ' bundle did not run'));
            (bundleWait[name] || []).splice(0).forEach(f => f());
            res();
          };
          s.onerror = () => rej(new Error(name + ' bundle failed to load'));
          document.head.appendChild(s);
        })
    );
    // a failed download can be tried again (Lazy's "Try again")
    bundleLoads[name].catch(() => {
      bundleLoads[name] = null;
    });
  }
  return bundleLoads[name];
}
const loadSite2 = () => loadBundle('site2');
const loadMember = () => loadBundle('member');
const loadStaff = () => loadBundle('staff');
const loadStaff2 = () => loadBundle('staff2');
const site2Ready = () => !!window.__SE_SITE2;
const staff2Ready = () => !!window.__SE_STAFF2;
// true once the link pages' bundle has run (the "Confirm it's you" window lives there)
function useSite2Loaded() {
  const [ok, setOk] = useState(site2Ready());
  useEffect(() => {
    if (ok) return;
    let live = true;
    bundleWait.site2.push(() => live && setOk(true));
    return () => {
      live = false;
    };
  }, []);
  return ok;
}
const loadTax = () => loadBundle('tax');
const loadWork = () => loadBundle('work');
const memberReady = () => !!window.__SE_MEMBER;
const staffReady = () => !!window.__SE_STAFF;
// true once the member bundle has run (it is never loaded from here: the portal pages ask for it)
function useMemberLoaded() {
  const [ok, setOk] = useState(memberReady());
  useEffect(() => {
    if (ok) return;
    let live = true;
    bundleWait.member.push(() => live && setOk(true));
    return () => {
      live = false;
    };
  }, []);
  return ok;
}
/* Renders a component that may live in the staff bundle: get=${() => SomeComponent}. Loads the bundle first when needed
   (load=${loadTax} for the tax center's bundle). */
function Lazy({ get, props, label, load }) {
  const C = (() => {
    try {
      return get();
    } catch (e) {
      return undefined;
    }
  })();
  const [, tick] = useState(0);
  const [err, setErr] = useState(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (C) return;
    let live = true;
    (load || loadStaff)().then(
      () => live && tick(t => t + 1),
      e => live && setErr(e)
    );
    return () => {
      live = false;
    };
  }, [C, attempt]);
  if (C) return html`<${C} ...${props || {}} />`;
  if (err)
    return html`<${LoadError} error=${{ message: 'This part of the site did not load. Check your connection and reload the page.' }} onRetry=${() => {
      setErr(null);
      setAttempt(a => a + 1);
    }} />`;
  return html`<${Spinner} label=${label || 'Loading…'} />`;
}

async function reloadCaps() {
  const booting = Cap.state === 'loading';
  const wasUid = Cap.uid || null;
  try {
    // index.html starts the "me" request before app.js has arrived; the first boot uses that answer
    let early = null;
    if (booting && window.__earlyMe) {
      const p = window.__earlyMe;
      window.__earlyMe = null;
      try {
        early = await p;
      } catch (e) {
        early = null;
      }
    }
    const r = early && typeof early === 'object' ? early : await api('me');
    const u = r && r.user;
    Cap.portal = (r && r.portal) || '';
    Cap.jobs = !!(r && r.jobs);
    Cap.stale = !!(r && r.build && typeof APP_BUILD === 'string' && APP_BUILD && r.build !== APP_BUILD);
    Cap.upload = r && r.upload && typeof r.upload === 'object' ? r.upload : null;
    Cap.sig = (r && r.sig) || ''; // v69: the person's email signature
    Cap.sigAuto = (r && r.sigAuto) || '';
    // A browser that kept an old copy of the site after an upload reloads itself once, straight away; if the host is
    // still handing out the old files after that, the banner asks the person to reload (or purge the host's cache).
    if (Cap.stale && booting && !reloadedFor(r.build)) {
      try {
        sessionStorage.setItem('se_reload_for', r.build);
      } catch (e) {
        /* fine */
      }
      location.reload();
      return Cap;
    }
    Cap.ft = (r && r.ft) || {};
    Cap.fa = (r && r.fa && typeof r.fa === 'object') ? r.fa : {};
    Cap.ai = (r && r.ai) || null;
    Cap.bench = !!(r && r.bench);
    // v64: a client contact's role in each of their companies: { cid: { role, units, areas: { area: 'w'|'r' }, deleg } }
    Cap.ca = r && r.ca && typeof r.ca === 'object' && !Array.isArray(r.ca) ? r.ca : {};
    Cap.mail = !!(r && r.mail);
    Cap.desk = !!(r && r.desk); // v34: works service desk tickets (an assignment group, or an administrator)
    Cap.chat = !!(r && r.chat); // v35: team messaging (the Messages button)
    Cap.ids = !!(r && r.ids); // v36.1: checks driver's licenses and green cards (ID checks)
    Cap.imp = r && Array.isArray(r.imp) ? r.imp : []; // v38.1: kinds of records this person may import with preview
    Cap.work = r && +r.work ? +r.work : 0; // v42: work boards (2 = creates projects, 1 = on a project)
    Cap.es = r && r.es ? r.es : null; // v45.3: e-signatures (may send, may run the library)
    Cap.phone = r && r.phone && typeof r.phone === 'object' ? r.phone : null; // v39: the phone (calls and texts), when switched on for this person
    // v37: a company workspace (another company's portal on this installation): its name, brand and parts
    Cap.ws = r && r.ws && typeof r.ws === 'object' ? r.ws : null;
    // v38: the look everyone starts with (an administrator's choice); a person's own choice on this device comes first
    // (an older server that sends no look means Glass; no answer at all keeps what this device last saw)
    if (r) Cap.look = LOOKS.includes(r.look) ? r.look : 'glass';
    applyLook();
    Cap.wsAdmin = !!(r && r.wsAdmin);
    wsBrandApply();
    Cap.ct = (r && typeof r.ct === 'string' && r.ct) || '';
    Cap.billing = r && r.bill && typeof r.bill === 'object' ? r.bill : null;
    Cap.sso = (r && r.sso) || [];
    // v34: a sign-in waiting for its second step, the portal's security notices, passkey sign-in on or off
    Cap.mfa = r && r.mfa && typeof r.mfa === 'object' ? r.mfa : null;
    Cap.sec = r && r.sec && typeof r.sec === 'object' ? r.sec : null;
    Cap.pk = !!(r && r.pk);
    // v24: every portal this person may open (staff and member portals) and the client workspaces they belong to
    Cap.portals = Array.isArray(r && r.portals) ? r.portals.filter(k => typeof k === 'string') : [];
    Cap.clients = Array.isArray(r && r.clients) ? r.clients.filter(c => c && typeof c === 'object' && c.id) : [];
    if (u) {
      const roles = Array.isArray(u.roles) && u.roles.length ? u.roles : [u.role];
      const staff = roles.some(x => ['admin', 'hr', 'acct'].includes(x));
      const a = avatarFor(u.name, u.id);
      Cap.me = {
        id: u.id,
        name: u.name,
        email: u.email,
        avatarUrl: a.url,
        color: a.color,
        isOwner: roles.includes('admin'),
        canEdit: staff,
      };
      Cap.uid = u.id;
      Cap.isAdmin = staff;
      Cap.roles = roles;
      Cap.isHR = roles.includes('hr');
      Cap.isAcct = roles.includes('acct');
      Cap.isMgr = roles.includes('manager');
      Cap.roleName = roles.includes('admin') ? 'admin' : u.role;
      Cap.isOwner = roles.includes('admin');
      // bookkeepers: 'full' edits the books, 'view' reads everything, 'reports' sees reports only; noPay hides payroll
      Cap.books = r && r.acct && r.acct.books ? r.acct.books : 'full';
      Cap.noPay = !!(r && r.acct && r.acct.nopay);
      Cap.canWrite = true;
      Cap.state = 'ready';
      SnapCache.load(u.id);
      // staff and managers get the staff part of the site right away, in parallel with their data
      if (staff || roles.includes('manager') || Cap.portals.some(k => ['admin', 'hr', 'acct', 'mgr'].includes(k))) {
        // v62: the pages opened now and then (js/staff2.js) run once the browser is idle, after the first page is up
        loadStaff()
          .then(() => (window.requestIdleCallback ? requestIdleCallback(() => loadStaff2().catch(() => {}), { timeout: 4000 }) : setTimeout(() => loadStaff2().catch(() => {}), 2500)))
          .catch(() => {});
      }
    } else {
      SnapCache.load(null);
      Cap.me = null;
      Cap.uid = null;
      Cap.isAdmin = false;
      Cap.isHR = false;
      Cap.isAcct = false;
      Cap.isMgr = false;
      Cap.roles = [];
      Cap.roleName = '';
      Cap.books = 'full';
      Cap.noPay = false;
      Cap.isOwner = false;
      Cap.canWrite = null;
      Cap.state = 'noid';
    }
  } catch (e) {
    Cap.state = 'none';
  }
  // v83: another person (or nobody) is signed in now: stores that keep the last person's data in memory drop it
  if (!booting && (Cap.uid || null) !== wasUid) window.dispatchEvent(new CustomEvent('se-who', { detail: Cap.uid || '' }));
  capNotify();
  return Cap;
}
const capsReady = reloadCaps();
// When a tab comes back to the foreground after a while, check whether the site was updated meanwhile.
let buildCheckedAt = Date.now();
addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || Date.now() - buildCheckedAt < 600000 || Cap.stale) return;
  buildCheckedAt = Date.now();
  api('me')
    .then(r => {
      if (r && r.build && typeof APP_BUILD === 'string' && APP_BUILD && r.build !== APP_BUILD) {
        Cap.stale = true;
        capNotify();
      }
    })
    .catch(() => {});
});
async function logout() {
  try {
    await api('logout', {});
  } catch (e) {
    /* already out */
  }
  Sync.subs.clear();
  SnapCache.clearAll();
  SnapCache.load(null);
  // v83: the Messages store, the Bench desk boot and the like forget this person even if the next "me" fails
  window.dispatchEvent(new CustomEvent('se-who', { detail: '' }));
  await reloadCaps();
  location.hash = '#/';
}
function useCaps() {
  const [c, setC] = useState(Cap.state === 'loading' ? null : { ...Cap });
  useEffect(() => {
    let on = true;
    const f = v => on && setC(v.state === 'loading' ? null : v);
    capListeners.add(f);
    capsReady.then(() => on && setC({ ...Cap }));
    return () => {
      on = false;
      capListeners.delete(f);
    };
  }, []);
  return c;
}

/* Shown when the server has a newer build than the one this tab loaded (browsers sometimes keep an old copy after an update). */
function StaleBanner() {
  const c = useCaps();
  const [hid, setHid] = useState(() => {
    try {
      return sessionStorage.getItem('se_upload_hide') === '1';
    } catch (e) {
      return false;
    }
  });
  if (c && c.upload && (c.upload.missing || c.upload.changed || c.upload.mismatch) && !c.stale && !hid)
    return html`<div className="stale warn" role="status">
        <span>The last upload is incomplete${c.upload.missing ? `: ${c.upload.missing} file${c.upload.missing === 1 ? '' : 's'} missing` : ''}${c.upload.changed ? `${c.upload.missing ? ',' : ':'} ${c.upload.changed} file${c.upload.changed === 1 ? '' : 's'} from an older version` : ''}${c.upload.mismatch && !c.upload.missing && !c.upload.changed ? ': index.html and js/app.js are from different uploads' : ''}. System health lists them.</span>
        <a className="btn sm" href="#/portal/admin/health">Open System health</a>
        <button type="button" className="btn ghost sm icon" aria-label="Hide for now" onClick=${() => {
          try {
            sessionStorage.setItem('se_upload_hide', '1');
          } catch (e) {
            /* fine */
          }
          setHid(true);
        }}><${Icon} n="x" /></button>
      </div>`;
  if (!c || !c.stale) return null;
  return html`<div className="stale" role="status">
      <span>This site was updated, but this browser still has the old copy. Reload once; if it comes back, the hosting cache (LiteSpeed or Cloudflare) needs a purge.</span>
      <button type="button" className="btn sm" onClick=${() => location.reload()}>Reload</button>
    </div>`;
}

/* ================= Data layer ================= */
const _q = new Map();
function serial(key, fn) {
  const p = (_q.get(key) || Promise.resolve()).catch(() => {}).then(fn);
  _q.set(key, p);
  return p;
}
async function retry(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e && e.code === 'unavailable') {
      await sleep(400 + Math.random() * 600);
      return fn();
    }
    throw e;
  }
}
const dbSet = (path, data) => serial(path, () => retry(() => Cap.db.doc(path).set(clean(data))));
const dbMerge = (path, patch) =>
  serial(path, () =>
    retry(async () => {
      const ref = Cap.db.doc(path);
      const s = await ref.get();
      return s.exists ? ref.update(clean(patch)) : ref.set(clean(patch));
    })
  );
const dbDel = path => serial(path, () => retry(() => Cap.db.doc(path).delete()));
const dbGet = async path => {
  const s = await retry(() => Cap.db.doc(path).get());
  return s.exists ? s.data() : null;
};
const dbList = async (path, build) => {
  let q = Cap.db.collection(path);
  if (build) q = build(q);
  const s = await retry(() => q.get());
  return s.docs.map(d => ({ id: d.id, ...d.data() }));
};
/* Reads many documents in one round trip (the batch endpoint answers up to 60 paths per request). */
async function dbGetMany(paths) {
  const out = [];
  for (let i = 0; i < paths.length; i += 60) {
    const part = paths.slice(i, i + 60);
    const r = await api('batch', { q: part.map(p => ({ t: 'doc', p })) });
    part.forEach((p, j) => {
      const x = (r.r || [])[j] || {};
      out.push(x.e ? x.d : null);
    });
  }
  return out;
}

function useDoc(path) {
  const [st, setSt] = useState({ data: undefined, exists: false, loading: !!path, for: path });
  useEffect(() => {
    if (!path || !Cap.db) {
      setSt({ data: undefined, exists: false, loading: false, for: path });
      return;
    }
    let live = true,
      un = () => {};
    setSt({ data: undefined, exists: false, loading: true, for: path });
    const fallback = setTimeout(
      () => live && setSt(s => (s.loading && s.for === path ? { ...s, loading: false } : s)),
      6000
    );
    try {
      un = Cap.db.doc(path).onSnapshot(
        snap => {
          if (!live) return;
          const definitive = !snap.metadata || !snap.metadata.fromCache;
          if (!snap.exists && !definitive) return; // wait for the server before treating it as missing
          setSt({
            data: snap.exists ? snap.data() : undefined,
            exists: snap.exists,
            loading: false,
            for: path,
          });
        },
        err => {
          console.warn('doc', path, err);
          live && setSt({ data: undefined, exists: false, loading: false, error: err, for: path });
        }
      );
    } catch (e) {
      console.warn(e);
      setSt({ data: undefined, exists: false, loading: false, error: e, for: path });
    }
    return () => {
      live = false;
      clearTimeout(fallback);
      un();
    };
  }, [path]);
  return st.for === path ? st : { data: undefined, exists: false, loading: !!path, for: path };
}
function useCol(path, order, limit, only) {
  const key = path ? `${path}|${order || ''}|${limit || ''}|${only || ''}` : '';
  const [st, setSt] = useState({ docs: [], loading: !!path, for: key });
  useEffect(() => {
    if (!path || !Cap.db) {
      setSt({ docs: [], loading: false, for: key });
      return;
    }
    let live = true,
      un = () => {};
    setSt({ docs: [], loading: true, for: key });
    // if the server never answers (blocked request, host throttling), stop showing a spinner after a while
    const fallback = setTimeout(
      () => live && setSt(s => (s.loading && s.for === key ? { ...s, loading: false, stalled: true } : s)),
      9000
    );
    try {
      let q = Cap.db.collection(path);
      if (order) {
        const [f, dir] = order.split(':');
        q = q.orderBy(f, dir || 'asc');
      }
      if (limit) q = q.limit(limit);
      if (only) q = q.only(only);
      un = q.onSnapshot(
        snap => {
          if (live)
            setSt({ docs: snap.docs.map(d => ({ id: d.id, ...d.data() })), loading: false, for: key });
        },
        err => {
          console.warn('col', path, err);
          live && setSt({ docs: [], loading: false, error: err, for: key });
        }
      );
    } catch (e) {
      console.warn(e);
      setSt({ docs: [], loading: false, error: e, for: key });
    }
    return () => {
      live = false;
      clearTimeout(fallback);
      un();
    };
  }, [key]);
  return st.for === key ? st : { docs: [], loading: !!path, for: key };
}
function usePeople(ids) {
  const key = [...new Set((ids || []).filter(Boolean))].sort().join(',');
  const [map, setMap] = useState({});
  useEffect(() => {
    let live = true;
    if (!Cap.user || !key) return;
    Cap.user
      .profiles(key.split(','))
      .then(m => live && setMap(m || {}))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [key]);
  return map;
}
function useNow(ms) {
  const [n, setN] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setN(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return n;
}

function errText(e) {
  const c = e && e.code;
  // v32: the server's own sentence wins ("Name the certification.", "You have reached today's 20 applications…");
  // the generic wording is only for errors that came without one
  const m = e && typeof e.message === 'string' && e.message && e.message !== 'The server could not be reached.' ? e.message : '';
  if (c === 'invalid_argument') return m || "That change wasn't saved because your access level doesn't allow it.";
  if (c === 'quota_exceeded') return m || 'Storage is full. Ask an admin to remove old files.';
  if (c === 'resource_exhausted' || c === 'rate_limited') return m || 'Too many requests at once. Wait a moment, then try again.';
  if (c === 'revoked') return 'Your access to this page changed. Reload the page to continue.';
  if (c === 'unavailable' || c === 'not_granted' || c === 'capability_disabled')
    return "Couldn't reach the server. Check your connection and try again.";
  if (c === 'declined') return 'Download cancelled.';
  if (c === 'rejected_extension' || c === 'extension_not_enabled')
    return "This file type can't be downloaded here.";
  return (e && e.message) || 'Something went wrong. Try again.';
}

/* ================= File storage (uploads kept on the server) ================= */
const MAX_FILE = 10 * 1024 * 1024;
const MIME = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  csv: 'text/csv',
  txt: 'text/plain',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
  md: 'text/markdown',
  json: 'application/json',
};
const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.gif,.xlsx,.docx,.pptx,.zip,.csv,.txt,.md,.json';
const extOf = n => ((n || '').split('.').pop() || '').toLowerCase();
async function shrinkImage(file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size <= 2.5 * 1048576) return file;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas');
    cv.width = Math.round(bmp.width * k);
    cv.height = Math.round(bmp.height * k);
    const cx = cv.getContext('2d');
    cx.fillStyle = '#fff';
    cx.fillRect(0, 0, cv.width, cv.height);
    cx.drawImage(bmp, 0, 0, cv.width, cv.height);
    const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.88));
    if (blob && blob.size < file.size)
      return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch (e) {
    /* keep original */
  }
  return file;
}
async function storeFile(base, file, meta, onProgress) {
  const ext = extOf(file.name);
  if (!MIME[ext])
    throw {
      message: `${ext ? '.' + ext : 'That'} file type isn't supported. Upload a PDF, image, Excel, Word, PowerPoint, zip, CSV, Markdown, JSON or text file.`,
    };
  file = await shrinkImage(file);
  if (!file.size) throw { message: 'That file is empty.' };
  if (file.size > MAX_FILE)
    throw {
      message: `That file is ${sizeLabel(file.size)}. The limit is 10 MB, so save it as a smaller PDF or image.`,
    };
  const fd = new FormData();
  fd.append('base', base);
  fd.append('meta', JSON.stringify(meta || {}));
  fd.append('file', file, file.name);
  const r = await upload('upload', fd, onProgress);
  Sync.kick();
  onProgress && onProgress(1);
  return r.doc;
}
const fileUrl = (base, fid, dl, tok) =>
  API +
  'file&base=' +
  encodeURIComponent(base) +
  '&id=' +
  encodeURIComponent(fid) +
  (dl ? '&dl=1' : '') +
  (tok ? '&tok=' + encodeURIComponent(tok) : '');
async function downloadStored(base, fid) {
  const a = document.createElement('a');
  a.href = fileUrl(base, fid, true);
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
  return { status: 'saved' };
}
async function previewUrl(base, fid) {
  const m = await dbGet(`${base}/f/${fid}`);
  if (!m) throw { message: 'This file is no longer available.' };
  return { url: fileUrl(base, fid, false), meta: m };
}
async function deleteStored(base, fid) {
  await api('delfile', { base, id: fid });
  Sync.kick();
}
async function saveDownload(filename, data) {
  return FileSaver.save({ filename, data });
}
const toCSV = rows =>
  rows
    .map(r =>
      r
        .map(v => {
          let s = v == null ? '' : String(v);
          // v83: a cell that starts like a spreadsheet formula (= + - @) would run when the file is opened in Excel or
          // Sheets: an apostrophe keeps it text. Numbers (also written as text, like "-12.50") stay as they are.
          if (typeof v !== 'number' && /^(\s*[=+\-@]|[\t\r])/.test(s) &&!/^\s*[+-]?\d+(?:[.,]\d+)*\s*$/.test(s)) s = "'" + s;
          return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        })
        .join(',')
    )
    .join('\n');

/* ================= Timesheet status ================= */
const TS_LABEL = {
  none: 'Not started',
  draft: 'Draft',
  pending: 'Awaiting approval',
  approved: 'Approved',
  rejected: 'Returned',
  reopened: 'Reopened',
};
function tsStatus(sum, rev) {
  if (!sum) return 'none';
  // v83: an approval also names the hours it approved (t); older approvals without t still count
  if (rev && rev.v === sum.u && (rev.t === undefined || rev.t === sum.t)) {
    if (rev.s === 'reopened') return 'reopened';
    if (sum.s === 'submitted') return rev.s;
  }
  return sum.s === 'submitted' ? 'pending' : rev && rev.s === 'rejected' ? 'rejected' : 'draft';
}
const TASK_S = { todo: 'To do', doing: 'In progress', blocked: 'Blocked', done: 'Done' };
const LEAVE_K = { pto: 'Paid time off', sick: 'Sick leave', unpaid: 'Unpaid leave', other: 'Other' };
const MODES = { office: 'Office', remote: 'Remote', client: 'Client site' };
const EMP_TYPES = ['C2C', 'W2', '1099', 'Full-time', 'Contract-to-hire'];
const DOC_CATS = {
  timesheet: 'Signed timesheet',
  invoice: 'Invoice',
  agreement: 'Agreement / MSA',
  insurance: 'Insurance (COI)',
  tax: 'Tax form (W-9)',
  resume: 'Resume',
  // v37.3: the documents HR can ask for in a profile update request
  passport: 'Passport',
  visa: 'Visa stamp',
  i797: 'I-797 approval notice',
  i94: 'I-94 record',
  ead: 'EAD card',
  gc: 'Green card',
  dl: "Driver's license or state ID",
  i9: 'I-9 documents',
  w4: 'Form W-4',
  statetax: 'State tax withholding form',
  degree: 'Degree or transcript',
  cert: 'Certification',
  other: 'Other',
};
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/* ================= HR and recruiting ================= */
const AUTH_TYPES = [
  'US citizen',
  'Green card',
  'H-1B',
  'H4 EAD',
  'OPT / CPT',
  'L2 EAD',
  'TN',
  'GC EAD',
  'Other',
];
const CAND_STATUS = {
  active: 'Available',
  working: 'In process',
  placed: 'Placed',
  hold: 'On hold',
  inactive: 'Inactive',
};
/* v68: the languages a call, a voicemail or a practice answer can be transcribed in (BCP-47 codes as Twilio's
   real-time transcription takes them); seSpeechLang gives the browser's own code for speech recognition and synthesis */
const SE_SPEECH_LANGS = [
  ['auto', 'Auto-detect (any language)'],
  ['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['en-IN', 'English (India)'], ['en-AU', 'English (Australia)'], ['en-CA', 'English (Canada)'], ['en-IE', 'English (Ireland)'], ['en-NZ', 'English (New Zealand)'], ['en-ZA', 'English (South Africa)'], ['en-SG', 'English (Singapore)'], ['en-PH', 'English (Philippines)'],
  ['es-US', 'Spanish (US)'], ['es-MX', 'Spanish (Mexico)'], ['es-ES', 'Spanish (Spain)'], ['es-AR', 'Spanish (Argentina)'], ['es-CO', 'Spanish (Colombia)'], ['pt-BR', 'Portuguese (Brazil)'], ['pt-PT', 'Portuguese (Portugal)'], ['fr-FR', 'French'], ['fr-CA', 'French (Canada)'], ['de-DE', 'German'], ['it-IT', 'Italian'], ['nl-NL', 'Dutch'], ['nl-BE', 'Dutch (Belgium)'],
  ['sv-SE', 'Swedish'], ['da-DK', 'Danish'], ['nb-NO', 'Norwegian'], ['fi-FI', 'Finnish'], ['is-IS', 'Icelandic'], ['pl-PL', 'Polish'], ['cs-CZ', 'Czech'], ['sk-SK', 'Slovak'], ['hu-HU', 'Hungarian'], ['ro-RO', 'Romanian'], ['bg-BG', 'Bulgarian'], ['el-GR', 'Greek'], ['tr-TR', 'Turkish'], ['ru-RU', 'Russian'], ['uk-UA', 'Ukrainian'], ['sr-RS', 'Serbian'], ['hr-HR', 'Croatian'], ['sl-SI', 'Slovenian'], ['lt-LT', 'Lithuanian'], ['lv-LV', 'Latvian'], ['et-EE', 'Estonian'], ['ca-ES', 'Catalan'], ['eu-ES', 'Basque'], ['gl-ES', 'Galician'],
  ['he-IL', 'Hebrew'], ['ar-SA', 'Arabic (Saudi Arabia)'], ['ar-EG', 'Arabic (Egypt)'], ['ar-AE', 'Arabic (UAE)'], ['fa-IR', 'Persian'], ['ur-PK', 'Urdu (Pakistan)'], ['ur-IN', 'Urdu (India)'], ['tr-TR', 'Turkish'],
  ['hi-IN', 'Hindi'], ['bn-IN', 'Bengali (India)'], ['bn-BD', 'Bengali (Bangladesh)'], ['pa-Guru-IN', 'Punjabi'], ['gu-IN', 'Gujarati'], ['mr-IN', 'Marathi'], ['ta-IN', 'Tamil'], ['te-IN', 'Telugu'], ['kn-IN', 'Kannada'], ['ml-IN', 'Malayalam'], ['ne-NP', 'Nepali'], ['si-LK', 'Sinhala'],
  ['cmn-Hans-CN', 'Chinese, Mandarin (Simplified)'], ['cmn-Hant-TW', 'Chinese, Mandarin (Taiwan)'], ['yue-Hant-HK', 'Chinese, Cantonese (Hong Kong)'], ['ja-JP', 'Japanese'], ['ko-KR', 'Korean'], ['vi-VN', 'Vietnamese'], ['th-TH', 'Thai'], ['id-ID', 'Indonesian'], ['ms-MY', 'Malay'], ['fil-PH', 'Filipino'], ['km-KH', 'Khmer'], ['my-MM', 'Burmese'], ['lo-LA', 'Lao'],
  ['sw-KE', 'Swahili'], ['am-ET', 'Amharic'], ['zu-ZA', 'Zulu'], ['af-ZA', 'Afrikaans'], ['ka-GE', 'Georgian'], ['hy-AM', 'Armenian'], ['az-AZ', 'Azerbaijani'], ['uz-UZ', 'Uzbek'], ['kk-KZ', 'Kazakh'], ['mn-MN', 'Mongolian'],
].filter((x, i, a) => a.findIndex(y => y[0] === x[0]) === i);
const seSpeechLang = code => ({ 'cmn-Hans-CN': 'zh-CN', 'cmn-Hant-TW': 'zh-TW', 'yue-Hant-HK': 'zh-HK', 'pa-Guru-IN': 'pa-IN', auto: 'en-US' })[code] || code || 'en-US';
const seSpeechLangName = code => ((SE_SPEECH_LANGS.find(x => x[0] === code) || [])[1] || code || 'Auto-detect (any language)');
/* the name of a language code as the transcript reports it (en, en-US, hi, es-419 …) */
const seLangLabel = code => {
  const c = String(code || '');
  if (!c) return '';
  const hit = SE_SPEECH_LANGS.find(x => x[0].toLowerCase() === c.toLowerCase()) || SE_SPEECH_LANGS.find(x => x[0] !== 'auto' && x[0].split('-')[0].toLowerCase() === c.split('-')[0].toLowerCase());
  return hit ? hit[1].replace(/\s*\(.*\)$/, '') : c;
};
const SUB_ST = {
  // v36: the bench desk prepares a submission before it is sent (shortlisted, waiting for the consultant's approval, ready)
  shortlisted: 'Shortlisted',
  approval: 'Waiting for approval',
  ready: 'Ready to submit',
  submitted: 'Submitted',
  screening: 'Screening',
  interview: 'Interview',
  offer: 'Offer',
  // v45.4: the client or vendor paused the role or this candidate for now
  hold: 'On hold',
  placed: 'Placed',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  closed: 'Closed',
};
const SUB_PRE = ['shortlisted', 'approval', 'ready'];
/* v68: healthcare staffing. A submission or a requirement in the healthcare line of business (lob: 'hc') carries hc:
   {disc, spec, fac, ftype, atype, shift, hrs, len, start, lic, licExp, compact, certs, emr, yrs, hourly, stipend,
   bill, cred: {imm|tb|drug|bg|fit|phys|ref|skills: ok|due|na}, notes}; hcLine is the one-line summary. */
const HC_CRED = [['imm', 'Immunizations'], ['tb', 'TB test'], ['drug', 'Drug screen'], ['bg', 'Background check'], ['fit', 'Fit test / N95'], ['phys', 'Physical'], ['ref', 'References'], ['skills', 'Skills checklist']];
const hcLine = hc =>
  hc
    ? [hc.disc, hc.spec, hc.fac ? hc.fac + (hc.ftype ? ' (' + hc.ftype + ')' : '') : hc.ftype, hc.atype, hc.shift, hc.hrs ? hc.hrs + ' h/wk' : '', hc.len ? hc.len + ' wks' : '', hc.start ? 'from ' + hc.start : '']
        .filter(Boolean)
        .join(' · ')
    : '';
const hcPay = hc => (hc ? [hc.hourly ? hc.hourly + '/h' : '', hc.stipend ? hc.stipend + '/wk stipend' : '', hc.bill ? 'bill ' + hc.bill : ''].filter(Boolean).join(' + ') : '');
const hcCred = hc => {
  const c = (hc && hc.cred) || {};
  const due = HC_CRED.filter(([k]) => c[k] === 'due').map(([, n]) => n);
  const ok = HC_CRED.filter(([k]) => c[k] === 'ok').length;
  return due.length ? 'Credentialing due: ' + due.join(', ') : ok ? 'Credentialing: ' + ok + ' of ' + HC_CRED.length + ' done' : '';
};
// a submission that went out (prepared ones are not counted as submissions anywhere)
const subSent = s => !SUB_PRE.includes(s && s.st);
const subChip = st => (st === 'placed' ? 'ok' : ['rejected', 'withdrawn', 'closed'].includes(st) ? 'red' : st === 'interview' || st === 'offer' ? 'new' : SUB_PRE.includes(st) || st === 'hold' ? '' : 'amber');
const ONB_ST = { pending: 'Pending', received: 'Received', verified: 'Verified', na: 'Not needed' };
const ONB_DEFAULT = [
  {
    id: 'offer',
    n: 'Signed offer letter or agreement',
    d: 'Offer letter (W2) or consulting agreement and MSA (C2C/1099).',
    doc: true,
  },
  { id: 'id', n: 'Government photo ID', d: 'Driver\u2019s license or passport.', doc: true },
  {
    id: 'auth',
    n: 'Work authorization document',
    d: 'EAD, visa, green card or citizenship proof.',
    doc: true,
  },
  { id: 'tax', n: 'Tax form', d: 'W-4 for W2 employees, W-9 for C2C and 1099.', doc: true },
  {
    id: 'bank',
    n: 'Direct deposit or invoicing details',
    d: 'Bank details for payroll or invoice payment.',
    doc: true,
  },
  {
    id: 'coi',
    n: 'Certificate of insurance',
    d: 'Liability insurance for corp-to-corp consultants.',
    doc: true,
  },
  { id: 'nda', n: 'Signed NDA', d: 'Confidentiality agreement.', doc: true },
  { id: 'bg', n: 'Background check consent', d: 'Signed consent form.', doc: true },
  {
    id: 'emg',
    n: 'Emergency contact',
    d: 'Name and phone number of an emergency contact, added to the profile.',
    doc: false,
  },
  {
    id: 'portal',
    n: 'Portal account and pay plan',
    d: 'Account approved, client linked, pay plan set.',
    doc: false,
  },
  {
    id: 'client',
    n: 'Client onboarding complete',
    d: 'Client paperwork, badge and system access.',
    doc: false,
  },
];
const OFF_DEFAULT = [
  { id: 'notice', n: 'End date confirmed', d: 'Last working day agreed with the client.', doc: false },
  {
    id: 'assets',
    n: 'Equipment and access returned',
    d: 'Laptop, badge, client accounts closed.',
    doc: false,
  },
  { id: 'ts', n: 'Final timesheets approved', d: 'All weeks submitted and approved.', doc: false },
  { id: 'pay', n: 'Final pay and reimbursements', d: 'Last payroll or invoice settled.', doc: false },
  { id: 'exit', n: 'Exit note', d: 'Feedback and forwarding contact recorded.', doc: false },
];
const POLICY_CATS = {
  handbook: 'Employee handbook',
  leave: 'Leave and holiday policy',
  conduct: 'Code of conduct',
  benefits: 'Benefits and payroll',
  template: 'Template (offer, NDA, forms)',
  other: 'Other',
};
const weekRange = ws => [ws, addDays(ws, 6)];

/* ================= Pay: computed from clock-ins ================= */
const PAY_DEFAULT = {
  cur: 'INR',
  type: 'monthly',
  amt: 0,
  hrs: 8,
  days: 'mon-fri',
  wdm: 20,
  ot: 0,
  lop: true,
  pl: true,
  allow: [],
  ded: [],
  from: '',
};
const CURRENCIES = { INR: 'Indian rupee (₹)', USD: 'US dollar ($)' };
const r2 = n => Math.round((+n || 0) * 100) / 100;
// A currency written as a symbol or a word on an older record ("₹", "Rs", "dollars") still formats correctly.
const curCode = cur => {
  const c = String(cur || '')
    .trim()
    .toUpperCase();
  if (/^[A-Z]{3}$/.test(c)) return c;
  if (/₹|RS|RUPEE/.test(c)) return 'INR';
  if (/\$|DOLLAR/.test(c)) return 'USD';
  return 'INR';
};
const _moneyFmt = {};
const fmtMoney = (n, cur) => {
  const code = curCode(cur);
  try {
    if (!_moneyFmt[code])
      _moneyFmt[code] = new Intl.NumberFormat(code === 'INR' ? 'en-IN' : 'en-US', {
        style: 'currency',
        currency: code,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    return _moneyFmt[code].format(r2(n));
  } catch (e) {
    return (code === 'INR' ? '₹' : code === 'USD' ? '$' : code + ' ') + r2(n).toFixed(2);
  }
};
const monthDays = mk => {
  const [y, m] = mk.split('-').map(Number);
  return new Date(y, m, 0).getDate();
};
const isWorkDay = (k, basis) => {
  const d = parseD(k).getDay();
  return basis === 'all' ? true : basis === 'mon-sat' ? d !== 0 : d >= 1 && d <= 5;
};
/* pay: settings; md: the month's attendance document; leaves: approved leave requests [{f,t}]; holidays: ['YYYY-MM-DD']; adjs: [{n,a}] one-off items */
/* ---- pay cycles, attendance approval and the pay engine ---- */
const payStartOf = s =>
  s && s.payStart != null && s.payStart !== '' ? Math.max(1, Math.min(28, +s.payStart || 1)) : 26;
const attApprovalOn = s => !(s && s.attApproval === false);
/* Pay schedules (v28). Monthly periods keep their YYYY-MM keys (optionally starting on a day other than the 1st);
   twice-a-month periods are YYYY-MM-1 (1st–15th) and YYYY-MM-2 (16th–end); weekly and two-week periods are keyed by
   their first day (YYYY-MM-DD) counted from an anchor date. The schedule comes from org/main/x/settings. */
const PAY_FREQS = {
  monthly: ['Monthly', 12],
  semimonthly: ['Twice a month (1st–15th and 16th–end)', 24],
  biweekly: ['Every two weeks', 26],
  weekly: ['Weekly', 52],
};
const paySched = s => {
  s = obj(s);
  const freq = PAY_FREQS[s.payFreq] ? s.payFreq : 'monthly';
  const anchor = typeof s.payAnchor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.payAnchor) ? s.payAnchor : '2026-01-05';
  const lag = s.payLag != null && s.payLag !== '' ? Math.max(0, Math.min(30, +s.payLag || 0)) : 5;
  return { freq, start: payStartOf(s), anchor, lag, ppy: PAY_FREQS[freq][1] };
};
const schedOf = x => (x && typeof x === 'object' && x.freq ? x : { freq: 'monthly', start: +x || 1, anchor: '2026-01-05', lag: 5, ppy: 12 });
const cycleLen = sch => (sch.freq === 'weekly' ? 7 : 14);
const daysBetween = (a, b) => Math.round((parseD(b) - parseD(a)) / 86400000);
const isHalfKey = mk => /^\d{4}-\d{2}-[12]$/.test(mk);
const isDayKey = mk => /^\d{4}-\d{2}-\d{2}$/.test(mk);
function cycleRange(mk, schedOrStart) {
  const sch = schedOf(schedOrStart);
  const span = (from, to) => ({
    key: mk,
    from,
    to,
    label: `${fmtDate(from, { month: 'short', day: 'numeric' })} – ${fmtDate(to, { month: 'short', day: 'numeric', year: 'numeric' })}`,
    short: `${fmtDate(from, { month: 'short', day: 'numeric' })} – ${fmtDate(to, { month: 'short', day: 'numeric' })}`,
  });
  if (isHalfKey(mk)) {
    const m = mk.slice(0, 7);
    return mk.endsWith('-1') ? span(`${m}-01`, `${m}-15`) : span(`${m}-16`, `${m}-${pad(monthDays(m))}`);
  }
  if (isDayKey(mk)) return span(mk, addDays(mk, cycleLen(sch) - 1));
  const start = +sch.start || 1;
  if (start <= 1)
    return {
      key: mk,
      from: `${mk}-01`,
      to: `${mk}-${pad(monthDays(mk))}`,
      label: monthLabel(mk),
      short: monthLabel(mk),
    };
  const pm = addMonths(mk, -1);
  return span(`${pm}-${pad(Math.min(start, monthDays(pm)))}`, `${mk}-${pad(start - 1)}`);
}
const cycleFor = (dk, schedOrStart) => {
  const sch = schedOf(schedOrStart);
  if (sch.freq === 'semimonthly') return mkey(dk) + (+dk.slice(8) <= 15 ? '-1' : '-2');
  if (sch.freq === 'biweekly' || sch.freq === 'weekly') {
    const len = cycleLen(sch);
    return addDays(sch.anchor, Math.floor(daysBetween(sch.anchor, dk) / len) * len);
  }
  const start = +sch.start || 1;
  const mk = mkey(dk);
  return start <= 1 ? mk : +dk.slice(8) >= start ? addMonths(mk, 1) : mk;
};
/* The period n steps before (negative) or after a key, in that key's own rhythm. */
const cycleStep = (mk, n, schedOrStart) => {
  const sch = schedOf(schedOrStart);
  if (isHalfKey(mk)) {
    let idx = +mk.slice(8) - 1 + n;
    const m = addMonths(mk.slice(0, 7), Math.floor(idx / 2));
    idx = ((idx % 2) + 2) % 2;
    return `${m}-${idx + 1}`;
  }
  if (isDayKey(mk)) return addDays(mk, n * cycleLen(sch));
  return addMonths(mk, n);
};
const cyclePayDate = (cyc, schedOrStart) => addDays(cyc.to, schedOf(schedOrStart).lag);
/* The next few pay periods and pay days, for the settings page and the employee's Earnings page. */
const payCalendar = (sch, n, fromDk) => {
  const out = [];
  let mk = cycleFor(fromDk || dkey(), sch);
  for (let i = 0; i < (n || 6); i++) {
    const cyc = cycleRange(mk, sch);
    out.push({ ...cyc, payDate: cyclePayDate(cyc, sch) });
    mk = cycleStep(mk, 1, sch);
  }
  return out;
};
const cycleMonths = cyc => [...new Set([mkey(cyc.from), mkey(cyc.to)])];
const mergeAtt = docs => ({ days: Object.assign({}, ...docs.filter(Boolean).map(d => d.days || {})) });
async function loadCycleAtt(uid, cyc) {
  const docs = await Promise.all(cycleMonths(cyc).map(m => dbGet(`u/${uid}/att/${m}`).catch(() => null)));
  return mergeAtt(docs);
}
function useCycleAtt(uid, cyc, on) {
  const ms = cycleMonths(cyc);
  const a = useDoc(on ? `u/${uid}/att/${ms[0]}` : null);
  const b = useDoc(on && ms[1] ? `u/${uid}/att/${ms[1]}` : null);
  return { data: mergeAtt([a.data, b.data]), loading: a.loading || b.loading };
}
const breakMaxOf = s => (s && s.breakMax != null && s.breakMax !== '' ? Math.max(0, +s.breakMax || 0) : 60);
/* Records written by earlier versions of the site, or edited by hand, don't always have the shape the code
   expects. These readers coerce whatever is stored into the shape needed, so one odd record never takes a whole
   page down: a list that was saved as an object becomes its values, anything else becomes empty. */
const arr = x => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.values(x) : []);
const obj = x => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
const spans = list => arr(list).filter(x => x && typeof x === 'object' && +x.i > 0);
const breakMins = (day, now) =>
  Math.round(
    spans(day && day.b).reduce((a, x) => a + mins(+x.i, x.o != null && +x.o > 0 ? +x.o : now || Date.now()), 0)
  );
const grossDayMins = day =>
  Math.round(spans(day && day.s).reduce((a, x) => a + (+x.o > 0 ? mins(+x.i, +x.o) : 0), 0));
const excessBreak = (day, allow, now) => Math.max(0, breakMins(day, now) - (allow == null ? 60 : allow));
/* paid minutes for a day: clocked time minus break time beyond the allowance, unless an admin approved the extended break */
const dayMins = (day, allow, extOk) => Math.max(0, grossDayMins(day) - (extOk ? 0 : excessBreak(day, allow)));
const EV_LABEL = {
  in: 'Clock in',
  out: 'Clock out',
  bi: 'Break start',
  bo: 'Break end',
  logout: 'Logged out',
  password: 'Signed in',
  register: 'Account created',
};
/* "password:hr" → "Signed in (HR login)", "sso:google:consultant" → "Signed in with Google (Consultant login)",
   "refused:client" → "Refused at the Client login (no access)". */
// v64: what a client contact may use in a company (core.js so the menu, the dashboard and the pages agree). No record
// (staff, a vendor contact, before sign-in): everything.
const caOf = cid => (cid && Cap.ca && Cap.ca[cid]) || null;
const caMay = (cid, area, need) => {
  const a = caOf(cid);
  if (!a) return true;
  const l = (a.areas || {})[area] || '';
  return need === 'w' ? l === 'w' : l !== '';
};
const PORTAL_LOGIN_NAMES = { admin: 'Admin', hr: 'HR', acct: 'Accounting', mgr: 'Manager', manager: 'Manager', employee: 'Employee', consultant: 'Consultant', bench: 'Employee', client: 'Client', employer: 'Client', student: 'Student' };
const howLabel = how => {
  if (!how || typeof how !== 'string') return 'Signed in';
  if (EV_LABEL[how]) return EV_LABEL[how];
  const [kind, a, b] = how.split(':');
  const portal = kind === 'sso' ? b : a;
  const where = portal && PORTAL_LOGIN_NAMES[portal] ? ` (${PORTAL_LOGIN_NAMES[portal]} login)` : '';
  if (kind === 'refused') return `Refused at the ${PORTAL_LOGIN_NAMES[a] || a} login (no access)`;
  if (kind === 'sso') return `Signed in with ${a ? a[0].toUpperCase() + a.slice(1) : 'a provider'}${where}`;
  if (kind === 'password') return 'Signed in' + where;
  return how;
};
function attStatus(k, approvals, m, required) {
  if (!required) return 'approved';
  const a = approvals && approvals[k];
  if (!a) return 'pending';
  if (typeof a !== 'object') return a === 'rejected' ? 'rejected' : 'approved'; // very old approvals were stored as a plain word
  if (a.s === 'rejected') return 'rejected';
  if (a.m != null && Math.round(a.m) !== Math.round(m)) return 'changed';
  return 'approved';
}
const ATT_ST = {
  approved: 'Approved',
  pending: 'Awaiting approval',
  changed: 'Changed since approval',
  rejected: 'Rejected',
};
/* Every day in a pay period with clock-in activity, with its approval state. needs = someone has to decide on it
   (never approved, edited after approval, or break time over the allowance that nobody has ruled on yet). */
function attDays(att, approvals, cyc, allow) {
  const out = [];
  const days = obj(att && att.days);
  approvals = obj(approvals);
  Object.keys(days)
    .sort()
    .forEach(k => {
      if (k < cyc.from || k > cyc.to) return;
      const d = obj(days[k]);
      const a = approvals[k] && typeof approvals[k] === 'object' ? approvals[k] : null;
      const extOk = !!(a && a.bx === 'approved');
      const mins = dayMins(d, allow, extOk);
      const open = spans(d.s).some(x => !(+x.o > 0));
      if (!grossDayMins(d) && !open) return;
      const st = attStatus(k, approvals, mins, true);
      const bm = breakMins(d);
      const over = excessBreak(d, allow);
      const needs =
        st === 'pending' ||
        st === 'changed' ||
        (st === 'approved' && over > 0 && !extOk && !(a && a.bx === 'unpaid'));
      out.push({ k, d, a, mins, open, st, bm, over, extOk, needs });
    });
  return out;
}
function computePay(pay, md, mk, leaves, holidays, adjs, opts) {
  const p = { ...PAY_DEFAULT, ...obj(pay) };
  const hol = new Set(arr(holidays).filter(h => typeof h === 'string'));
  opts = obj(opts);
  const from = typeof opts.from === 'string' && opts.from ? opts.from : `${mk}-01`,
    to = typeof opts.to === 'string' && opts.to ? opts.to : `${mk}-${pad(monthDays(mk))}`;
  const required = !!opts.requireApproval;
  const approvals = obj(opts.approvals);
  const brkAllow = opts.breakMax == null ? 60 : +opts.breakMax || 0;
  const attDaysMap = obj(md && md.days);
  const days = [];
  let calDays = 0;
  for (let k = from; k <= to && days.length < 62; k = addDays(k, 1)) {
    const h = hol.has(k);
    const w = isWorkDay(k, p.days) && !h;
    if (w) calDays++;
    days.push({ k, w, h, m: 0, reg: 0, ot: 0, st: 'approved' });
  }
  const ppy = +opts.ppy || 12; // pay periods a year: 12 monthly, 24 twice a month, 26 two-week, 52 weekly
  // standard working days per cycle (20 by default) or the calendar count; shorter periods use their own calendar
  const workDays = ppy === 12 && +p.wdm > 0 ? +p.wdm : calDays;
  const stdMin = (+p.hrs || 8) * 60;
  let present = 0,
    reg = 0,
    ot = 0,
    pending = 0,
    pendingMins = 0,
    rejected = 0;
  days.forEach(d => {
    const day = obj(attDaysMap[d.k]);
    const ap = approvals[d.k];
    const m = dayMins(day, brkAllow, !!(ap && typeof ap === 'object' && ap.bx === 'approved'));
    d.m = m;
    d.bm = breakMins(day);
    d.bx = excessBreak(day, brkAllow);
    d.st = m > 0 ? attStatus(d.k, approvals, m, required) : 'approved';
    const counts = m > 0 && d.st === 'approved';
    if (m > 0 && (d.st === 'pending' || d.st === 'changed')) {
      pending++;
      pendingMins += m;
    }
    if (m > 0 && d.st === 'rejected') rejected++;
    if (counts && d.w) present++;
    if (!counts) {
      d.reg = 0;
      d.ot = 0;
    } else if (!d.w) {
      d.reg = 0;
      d.ot = m;
    } else {
      d.reg = Math.min(m, stdMin);
      d.ot = Math.max(0, m - stdMin);
    }
    reg += d.reg;
    ot += d.ot;
  });
  present = Math.min(present, workDays);
  let leaveDays = 0;
  const idx = {};
  days.forEach((d, i) => {
    idx[d.k] = i;
  });
  arr(leaves).forEach(l => {
    if (!l || typeof l.f !== 'string' || typeof l.t !== 'string' || l.t < l.f) return;
    for (let k = l.f < from ? from : l.f, n = 0; k <= l.t && k <= to && n < 62; k = addDays(k, 1), n++) {
      const d = days[idx[k]];
      if (d && d.w && !d.m && !d.lv) {
        d.lv = true;
        leaveDays++;
      }
    }
  });
  const otMult = +p.ot || 0;
  // a salary is stored per month; a shorter period gets its share (× 12 / periods a year)
  const amt = p.type === 'hourly' ? +p.amt || 0 : r2(((+p.amt || 0) * 12) / ppy);
  const hrs = +p.hrs || 8;
  let base = 0,
    otPay = 0,
    dayRate = 0,
    hourRate = 0,
    paidDays = null;
  if (p.type === 'hourly') {
    hourRate = amt;
    base = (reg / 60) * amt;
    otPay = (ot / 60) * amt * (otMult || 1);
  } else {
    dayRate = workDays ? amt / workDays : 0;
    hourRate = workDays ? amt / (workDays * hrs) : 0;
    // a company holiday on a scheduled working day is paid: when holidays bring the calendar below the standard days
    // (20 by default), the shortfall they cause is not an absence
    const holPaid = Math.max(0, Math.min(days.filter(d => d.h && isWorkDay(d.k, p.days)).length, workDays - calDays));
    paidDays = p.lop ? Math.min(workDays, present + holPaid + (p.pl ? leaveDays : 0)) : workDays;
    base = p.lop ? dayRate * paidDays : amt;
    otPay = otMult ? (ot / 60) * hourRate * otMult : 0;
  }
  // allowances, deductions and one-off adjustments: lists of {n, a|p}; an older plan may hold them as {name: amount}
  const items = list =>
    arr(list)
      .map((a, i) =>
        a && typeof a === 'object' ? a : typeof a === 'number' || typeof a === 'string' ? { n: Object.keys(obj(list))[i] || '', a } : null
      )
      .filter(a => a && typeof a.n === 'string' && a.n);
  const allow = items(p.allow).map(a => ({
    n: a.n,
    v: r2(+a.p ? (base * +a.p) / 100 : +a.a || 0),
    note: +a.p ? `${+a.p}% of base` : '',
  }));
  const gross = r2(base + otPay + allow.reduce((s, a) => s + a.v, 0));
  const ded = items(p.ded).map(a => ({
    n: a.n,
    v: r2(+a.p ? (gross * +a.p) / 100 : +a.a || 0),
    note: +a.p ? `${+a.p}% of gross` : '',
  }));
  const adj = items(adjs).map(a => ({ n: a.n, v: r2(+a.a || 0) }));
  const dedT = r2(ded.reduce((s, a) => s + a.v, 0));
  const adjT = r2(adj.reduce((s, a) => s + a.v, 0));
  const today = dkey();
  const elapsed = Math.min(workDays, days.filter(d => d.w && d.k <= today).length);
  const leaveElapsed = days.filter(d => d.lv && d.k <= today).length;
  const unpaidDays =
    p.type === 'monthly' && p.lop ? Math.max(0, elapsed - present - (p.pl ? leaveElapsed : 0)) : 0;
  return {
    p,
    days,
    workDays,
    calDays,
    present,
    pending,
    pendingMins,
    rejected,
    leaveDays,
    paidDays,
    unpaidDays,
    reg,
    ot,
    dayRate,
    hourRate,
    base: r2(base),
    otPay: r2(otPay),
    allow,
    gross,
    ded,
    dedT,
    adj,
    adjT,
    net: r2(gross - dedT + adjT),
    from,
    to,
    ppy,
    payDate: typeof opts.payDate === 'string' ? opts.payDate : '',
  };
}
const approvedLeaves = (root, asg) => {
  const lvd = obj(asg && asg.lvd);
  return Object.entries(obj(root && root.lv))
    .filter(([id, l]) => l && typeof l === 'object' && !l.x && lvd[id] && typeof lvd[id] === 'object' && lvd[id].s === 'approved')
    // v83: the dates approved are the ones in the decision (older decisions without them fall back to the request)
    .map(([id, l]) => (lvd[id].f && lvd[id].t ? { ...l, k: lvd[id].k || l.k, f: lvd[id].f, t: lvd[id].t } : l));
};
const ROLE_LABEL = { consultant: 'Consultant', employer: 'Client contact' };
const REQ_ST = {
  open: 'Open',
  reviewing: 'Reviewing',
  shared: 'Candidates shared',
  filled: 'Filled',
  closed: 'Closed',
};
const CAND_ST = {
  shared: 'Shared',
  shortlist: 'Shortlisted',
  interview: 'Interview requested',
  rejected: 'Not a fit',
  hired: 'Hired',
};
const CD_LABEL = {
  none: 'Not sent to client',
  pending: 'Awaiting client',
  approved: 'Client approved',
  returned: 'Client returned',
  withdrawn: 'Withdrawn',
};
/* Client-side decision on a shared (pub) timesheet copy */
function cdStatus(d) {
  if (!d) return 'none';
  if (d.s !== 'submitted') return 'withdrawn';
  if (d.cd && d.cd.v === d.u) return d.cd.s;
  return 'pending';
}
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
  users:
    'M9 4a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM2.5 20c1-3.5 3.6-5.5 6.5-5.5s5.5 2 6.5 5.5M16 4.5a3.3 3.3 0 0 1 0 6.3M18 14.6c1.8.6 3 2.2 3.6 4.9',
  approve: 'M4 13h4l2 3h4l2-3h4M5.5 5h13L20 13v6H4v-6z',
  chart: 'M4 20V11M10 20V5M16 20v-6M2 20h20',
  mega: 'M3 10v4l11 4V6L3 10zM14 9a3 3 0 0 1 0 6M6.5 15.2 8 20h3l-1.4-4',
  globe:
    'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.5 3.6 5.5 3.6 9s-1.1 6.5-3.6 9c-2.5-2.5-3.6-5.5-3.6-9S9.5 5.5 12 3z',
  exit: 'M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10',
  menu: 'M4 7h16M4 12h16M4 17h16',
  x: 'M6 6l12 12M18 6 6 18',
  up: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  down: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
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
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  key: 'M14 4a5 5 0 1 0 2.6 9.3L21 17.6V21h-3.4v-2.6h-2.6v-2.6h-2.6L10.3 13.7A5 5 0 0 0 14 4z',
  switch: 'M7 7h11l-3-3M17 17H6l3 3',
  target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 11.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1',
  inbox: 'M3 13l2.5-8h13L21 13v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM3 13h5l1.5 3h5L16 13h5',
  idcard: 'M3 6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM8.5 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM5 16c0-2 1.6-3 3.5-3s3.5 1 3.5 3M14 9h5M14 12h5M14 15h3',
  ad: 'M3 10v4h3l5 4V6L6 10zM14 9.5a3.5 3.5 0 0 1 0 5M17 6.5a7.5 7.5 0 0 1 0 11',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  tag: 'M3 12V4h8l10 10-8 8zM7.5 8.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2',
  history: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 2',
  flag: 'M5 21V4h11l-2 4 2 4H5',
  help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 9.3a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.2-2.5 3.8M12 17.2h.01',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 10a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
};
// v45.2: icons the staff pages added here earlier, now with the others (the website uses some of them)
Object.assign(IP, {
  shield: 'M12 3l7 3v5c0 4.6-3 8.4-7 10-4-1.6-7-5.4-7-10V6l7-3zm-3 9l2 2 4-4',
  key: 'M14.5 3.5a6 6 0 1 1-5.6 8.1L3.5 17v3.5H7v-2h2v-2h2l.9-.9a6 6 0 0 1 2.6-12.1zM16 7.5h.01',
  target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 4a1 1 0 1 0 0 2 1 1 0 0 0 0-2z',
  inbox: 'M3 13l3-8h12l3 8v6H3v-6zm0 0h5l1.5 3h5l1.5-3h5',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7l1-8z',
  idcard: 'M3 5h18v14H3V5zm5 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm4.5 1H18m-5.5 4H16',
  org: 'M9 3h6v5H9V3zM3 16h6v5H3v-5zm12 0h6v5h-6v-5zM12 8v4m-6 4v-2h12v2',
  ad: 'M4 5h16v14H4V5zm3 10l2.5-6 2.5 6m-4-2h3m3-4v6h1.5a3 3 0 0 0 0-6H15z',
  // v38.1: import with preview, and undo
  impin: 'M12 3v11m0 0l-4-4m4 4l4-4M5 15v4h14v-4',
  undo: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
});
const Icon = ({ n, cls }) =>
  html`<svg className=${'ico ' + (cls || '')} viewBox="0 0 24 24" aria-hidden="true">
      <path d=${IP[n] || ''} />
    </svg>`;

/* ================= Shared UI ================= */
const ToastCtx = createContext(() => {});
const useToast = () => useContext(ToastCtx);
function ToastHost({ children }) {
  const [list, setList] = useState([]);
  const push = useCallback((msg, bad) => {
    const id = nid();
    setList(l => [...l, { id, msg, bad }]);
    setTimeout(() => setList(l => l.filter(t => t.id !== id)), bad ? 6000 : 3200);
  }, []);
  return html`<${ToastCtx.Provider} value=${push}>
      ${children}
      <div className="toasts" role="status" aria-live="polite">
        ${list.map(t => html`<div key=${t.id} className=${'toast' + (t.bad ? ' bad' : '')}>${t.msg}</div>`)}
      </div>
    <//>`;
}
function Modal({ title, onClose, children, foot, wide }) {
  useEffect(() => {
    const k = e => {
      if (e.key === 'Escape') onClose();
    };
    addEventListener('keydown', k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      removeEventListener('keydown', k);
      document.body.style.overflow = prev;
    };
  }, []);
  // Drawn at the document root, outside the page it was opened from, so a page container can never box it in
  // or let the sticky header draw over it.
  return ReactDOM.createPortal(
    html`<div className="overlay" onMouseDown=${e => {
    if (e.target === e.currentTarget) onClose();
  }}>
      <div className=${'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label=${title}>
        <div className="mh">
          <h2>
            ${title}
          </h2>
          <button className="btn ghost icon" onClick=${onClose} aria-label="Close">
            <${Icon} n="x" />
          </button>
        </div>
        <div className="mb">
          ${children}
        </div>
        ${foot && html`<div className="mf">${foot}</div>`}
      </div>
    </div>`,
    document.body
  );
}
/* A spinner that admits when something is taking too long and offers a way out. */
function Spinner({ label, stallAfter, onRetry }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), stallAfter || 9000);
    return () => clearTimeout(t);
  }, []);
  return html`<div className="loading">
      <span className="spin" />
      <span>${label || 'Loading…'}</span>
      ${
        slow &&
        html`<span className="stall">This is taking longer than usual.
            ${onRetry ? html`<button type="button" className="btn ghost sm" onClick=${onRetry}>Try again</button>` : html`<button type="button" className="btn ghost sm" onClick=${() => location.reload()}>Reload</button>`}
          </span>`
      }
    </div>`;
}
/* A friendly error box with a retry button, for pages that load data in steps. */
const LoadError = ({ error, onRetry, title }) =>
  html`<div className="note red">
      <span><b>${title || "This page couldn't load."}</b> ${errText(error)}</span>
      ${onRetry && html`<div className="actions"><button type="button" className="btn sm" onClick=${onRetry}>Try again</button></div>`}
    </div>`;

/* ================= When a page breaks =================
   React removes everything it drew when a component throws, which looks like a blank page. The guard below
   catches that for one page at a time, keeps the menus working, says what happened and offers a reload.
   The details can be copied and sent to whoever looks after the site; they are also noted in storage/error.log. */
// v83: the page named in a report keeps its path and query keys but not their values, and a signing or invoice link
// loses its token, so reset links, support keys and the like never reach storage/error.log
const crashHash = () => {
  const [p, qs] = (location.hash || '#/').split('?');
  const path = p.replace(/^(#\/(?:sign|invoice)\/[^/]*)\/.+$/, '$1/…');
  return qs ? path + '?' + qs.split('&').map(x => x.split('=')[0] + '=…').join('&') : path;
};
const crashDetails = (err, info, where) =>
  [
    `Page: ${crashHash()}${where ? ' (' + where + ')' : ''}`,
    `Build: ${typeof APP_BUILD === 'string' ? APP_BUILD : '-'}`,
    `When: ${new Date().toString()}`,
    `Browser: ${navigator.userAgent}`,
    `Error: ${(err && (err.message || String(err))) || 'unknown'}`,
    ...((err && err.stack ? String(err.stack).split('\n').slice(0, 8) : []).map(l => '  ' + l.trim())),
    ...(info && info.componentStack ? ['Where it was drawing:', ...String(info.componentStack).trim().split('\n').slice(0, 10).map(l => '  ' + l.trim())] : []),
  ].join('\n');
let crashReported = 0;
function reportCrash(details) {
  if (crashReported++ > 2) return; // a page that keeps failing is noted once, not on every redraw
  try {
    api('client_error', { details: details.slice(0, 4000) }).catch(() => {});
  } catch (e) {
    /* reporting is best effort */
  }
}
function CrashPanel({ details, where, onReset }) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  const inPortal = /^#\/(portal|client)/.test(location.hash);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(details);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (e) {
      setShow(true);
    }
  };
  return html`<div className="crash" role="alert">
      <h2>This page hit a problem.</h2>
      <p>
        ${
          where === 'site'
            ? 'The site could not draw this screen.'
            : 'The rest of the portal still works; only this page could not be drawn.'
        } Reloading usually fixes it. If it happens again, press <b>Copy details</b> and send what it copies to ${CO.email} so the cause can be fixed.
      </p>
      <div className="actions">
        <button type="button" className="btn" onClick=${() => location.reload()}>Reload</button>
        ${onReset && html`<button type="button" className="btn ghost" onClick=${onReset}>Try again</button>`}
        <a className="btn ghost" href=${inPortal ? '#/portal' : '#/'}>${inPortal ? 'Back to the dashboard' : 'Back to the home page'}</a>
        <button type="button" className="btn ghost" onClick=${copy}>${copied ? 'Copied' : 'Copy details'}</button>
        <button type="button" className="btn link" onClick=${() => setShow(s => !s)}>${show ? 'Hide details' : 'Show details'}</button>
      </div>
      ${show && html`<pre>${details}</pre>`}
    </div>`;
}
class PageGuard extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null, info: null };
  }
  static getDerivedStateFromError(err) {
    return { err: err || new Error('unknown') };
  }
  componentDidCatch(err, info) {
    this.setState({ info });
    const d = crashDetails(err, info, this.props.where);
    console.error('page error', d);
    reportCrash(d);
  }
  render() {
    if (this.state.err)
      return html`<${CrashPanel} details=${crashDetails(this.state.err, this.state.info, this.props.where)} where=${this.props.where} onReset=${() => this.setState({ err: null, info: null })} />`;
    return this.props.children;
  }
}
/* If the very first draw of the site fails (nothing from React is on the page yet), the message is written by hand. */
addEventListener('error', e => {
  const app = document.getElementById('app');
  if (!app || !app.querySelector('[data-boot]')) return;
  const err = e.error || { message: e.message };
  const d = crashDetails(err, null, 'startup');
  reportCrash(d);
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  app.innerHTML = `<div class="crash" role="alert"><h2>The site could not start.</h2><p>Reloading usually fixes it. If it happens again, send the details below to ${esc(CO.email)}.</p><div class="actions"><button type="button" class="btn" data-reload>Reload</button></div><pre>${esc(d)}</pre></div>`;
  // v34: no inline handlers (the page's security policy forbids them)
  const rb = app.querySelector('[data-reload]');
  if (rb) rb.addEventListener('click', () => location.reload());
});
const Chip = ({ s, children }) => html`<span className=${'chip ' + (s || '')}>${children}</span>`;
/* v69: the person's email signature. sigAppend puts it at the end of a message once; SigModal edits it ("Use my details"
   fills it from the record); SigButton pastes it (or a merge field such as {signature} when `field` is given, for
   messages each sender sends as themselves) and opens the editor the first time or from its pen. */
const sigText = () => String(Cap.sig || '').trim();
const sigAppend = (body, sig) => {
  const b = String(body || '');
  const s = String(sig || '').trim();
  if (!s || b.includes(s)) return b;
  return b.replace(/\s+$/, '') + (b.trim() ? '\n\n' : '') + s;
};
function SigModal({ onClose, onSaved }) {
  const toast = useToast();
  const [v, setV] = useState(sigText() || Cap.sigAuto || '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api('sig_save', { sig: v });
      Cap.sig = r.sig || '';
      toast(r.sig ? 'Signature saved.' : 'Signature cleared.');
      onSaved && onSaved(r.sig || '');
      onClose();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<${Modal} title="Your email signature" onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Cancel</button><button type="button" className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save'}</button>`}>
    <div className="form">
      <p className="muted small" style=${{ margin: 0 }}>Pasted at the end of the emails and campaigns you write with the Signature button; sequences and campaigns can also carry <code>{signature}</code>, filled in with each sender's own. Plain text: one line per detail.</p>
      <${Field} label="Signature"><textarea rows="6" value=${v} onInput=${e => setV(e.target.value)} placeholder=${'Priya Sharma\nSenior Recruiter · StratEdge IT Consulting\n(732) 555-0100 · priya@stratedgeitconsulting.com'} /><//>
      <div className="actions"><button type="button" className="btn ghost sm" disabled=${!Cap.sigAuto} onClick=${() => setV(Cap.sigAuto || '')}><${Icon} n="user" />Use my details</button>${v && html`<button type="button" className="btn ghost sm" onClick=${() => setV('')}>Clear</button>`}</div>
    </div>
  <//>`;
}
function SigButton({ onInsert, field, small }) {
  const [edit, setEdit] = useState(false);
  const insert = () => {
    if (field) return onInsert(field);
    const s = sigText();
    if (s) onInsert(s);
    else setEdit(true);
  };
  return html`<span className="sigbtn">
    <button type="button" className=${'btn ghost ' + (small === false ? '' : 'sm')} onClick=${insert} title=${field ? 'Insert ' + field + ' (each sender\'s own signature is filled in)' : sigText() ? 'Paste your signature at the end' : 'Set up your signature, then paste it'}><${Icon} n="pen" />Signature</button>
    <button type="button" className=${'btn ghost ' + (small === false ? '' : 'sm')} onClick=${() => setEdit(true)} aria-label="Edit your signature" title="Edit your signature">✎</button>
    ${edit && html`<${SigModal} onClose=${() => setEdit(false)} onSaved=${s => { if (!field && s) onInsert(s); }} />`}
  </span>`;
}
/* v68: the technology and industry domains recognized on a resume (dom = {tech: [{k, n, y, t}], ind: [{k, n, t}]}); the
   title of each chip names the evidence; max limits each group; line renders one text line instead of chips */
function DomChips({ dom, max, small, line }) {
  if (!dom || (!(dom.tech || []).length && !(dom.ind || []).length)) return null;
  const tech = (dom.tech || []).slice(0, max || 4);
  const ind = (dom.ind || []).slice(0, max || 3);
  if (line) return html`<span className=${'domline' + (small ? ' small' : '')}>${[tech.map(x => x.n).join(' · '), ind.map(x => x.n).join(', ')].filter(Boolean).join(' — ')}</span>`;
  const tip = x => (x.t && x.t.length ? 'Seen on the resume: ' + x.t.join(', ') : '') + (x.y ? (x.t && x.t.length ? ' · ' : '') + x.y + ' years' : '');
  return html`<span className=${'domchips' + (small ? ' small' : '')}>${tech.map(x => html`<span key=${'t' + x.k} className="chip dmt" title=${tip(x)}>${x.n}${x.y ? html`<i>${x.y}y</i>` : ''}</span>`)}${ind.map(x => html`<span key=${'i' + x.k} className="chip dmi" title=${tip(x)}>${x.n}</span>`)}</span>`;
}
const Empty = ({ title, children, action }) =>
  html`<div className="empty"><b>${title}</b>${children && html`<span>${children}</span>`}${action}</div>`;
/* v33: the portal installs as an app. Chrome and Android offer it through beforeinstallprompt; iPhone and iPad
   install from Safari's Share menu. The service worker (sw.js) keeps the app files, never API data. */
let SE_INSTALL = null;
try {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    SE_INSTALL = e;
    window.dispatchEvent(new Event('se-installable'));
  });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname))) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
} catch (e) {}
function InstallAppButton({ className, label }) {
  const toast = useToast();
  const [can, setCan] = useState(!!SE_INSTALL);
  useEffect(() => {
    const f = () => setCan(true);
    window.addEventListener('se-installable', f);
    return () => window.removeEventListener('se-installable', f);
  }, []);
  const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent || '');
  if (standalone || (!can && !ios)) return null;
  const go = async () => {
    if (SE_INSTALL) {
      SE_INSTALL.prompt();
      const r = await SE_INSTALL.userChoice.catch(() => null);
      SE_INSTALL = null;
      setCan(false);
      if (r && r.outcome === 'accepted') toast('Installed: StratEdge is on your home screen.');
    } else toast('On iPhone or iPad: tap the Share button, then "Add to Home Screen".');
  };
  return html`<button type="button" className=${className || 'btn ghost sm'} onClick=${go}><${Icon} n="down" />${label || 'Install the app'}</button>`;
}
function Field({ label, hint, children }) {
  return html`<label className="fld"><span>${label}</span>${children}${hint && html`<small>${hint}</small>`}</label>`;
}
function Avatar({ p, size }) {
  const s = size || 30;
  return p && p.avatarUrl
    ? html`<img src=${p.avatarUrl} alt="" width=${s} height=${s} style=${{ width: s, height: s, borderRadius: '50%' }} />`
    : html`<span style=${{ width: s, height: s, borderRadius: '50%', background: 'var(--surface-2)', display: 'inline-block', flex: 'none' }} />`;
}
function Person({ uid, root, people, sub }) {
  const p = people && people[uid];
  return html`<div className="person">
      <${Avatar} p=${p} />
      <div style=${{ minWidth: 0 }}>
        <b>
          ${nameOf(uid, root, people)}
        </b>
        ${sub && html`<span>${sub}</span>`}
      </div>
    </div>`;
}
const nameOf = (uid, root, people) =>
  (root && root.p && root.p.n) || (people && people[uid] && people[uid].name) || 'Team member';

/* File picker + drag/drop with progress */
function FilePick({ onFiles, busy, progress, label, hint }) {
  const [over, setOver] = useState(false);
  const inp = useRef(null);
  return html`<div className=${'drop' + (over ? ' over' : '')}
      onDragOver=${e => {
        e.preventDefault();
        setOver(true);
      }} onDragLeave=${() => setOver(false)}
      onDrop=${e => {
        e.preventDefault();
        setOver(false);
        if (!busy && e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]);
      }}>
      <p>
        ${label || 'Drop a file here, or choose one from your device.'}
        <br />
        <small className="muted">
          ${hint || 'PDF, image, Word, Excel, PowerPoint, CSV, text, Markdown, JSON or zip, up to ' + Math.round(MAX_FILE / 1048576) + ' MB.'}
        </small>
      </p>
      <button type="button" className="btn ghost" disabled=${busy} onClick=${() => inp.current && inp.current.click()}>
        <${Icon} n="up" />
        ${busy ? 'Uploading…' : 'Choose file'}
      </button>
      <input ref=${inp} type="file" accept=${ACCEPT} hidden onChange=${e => {
        const f = [...e.target.files];
        e.target.value = '';
        if (f.length) onFiles(f);
      }} />
      ${busy && html`<div className="prog"><i style=${{ width: Math.round((progress || 0.05) * 100) + '%' }} /></div>`}
    </div>`;
}
/* Stored file row actions: preview (images) + download */
/* v36.1: files that may be a driver's license, state ID or green card get a "Check ID" button for the people who
   check IDs (Cap.ids); the check itself lives in the staff bundle (idscan.js), opened through IdsHost. */
const idsLooksLikeId = f => /^(image\/|application\/pdf)/.test(f.ty || '') && (['id', 'dl', 'gc', 'wa', 'auth', 'visa', 'ead', 'front', 'back', 'photoid'].includes(f.c) || /(licen[cs]e|driver|\bdl\b|green.?card|\bgc\b|perm(anent)?.?res|i-?551|\bpr.?card|\bid\b|identi|state.?id|\bead\b|work.?auth|passport|visa)/i.test(f.n || ''));
const idsOpen = init => window.dispatchEvent(new CustomEvent('se-ids', { detail: init || {} }));
function IdsHost() {
  const [init, setInit] = useState(null);
  const [ready, setReady] = useState(false);
  const toast = useToast();
  useEffect(() => {
    const on = e => {
      loadStaff2().then(
        () => {
          setReady(true);
          setInit(e.detail || {});
        },
        err => toast(errText(err), true)
      );
    };
    window.addEventListener('se-ids', on);
    return () => window.removeEventListener('se-ids', on);
  }, []);
  if (!init || !ready || typeof IdScanModal !== 'function') return null;
  // v36.3: "Send an ID link" from a consultant's card
  if (init.link && typeof IdsLinkModal === 'function') return html`<${IdsLinkModal} init=${init} onClose=${() => setInit(null)} />`;
  return html`<${IdScanModal} init=${init} onClose=${() => setInit(null)} />`;
}
function FileActions({ base, f, onDelete, who }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [pv, setPv] = useState(null);
  const isImg = /^image\//.test(f.ty || '');
  const dl = async () => {
    setBusy(true);
    try {
      await downloadStored(base, f.id);
    } catch (e) {
      if (!e || e.code !== 'declined') toast(errText(e), true);
    }
    setBusy(false);
  };
  const view = async () => {
    setBusy(true);
    try {
      setPv(await previewUrl(base, f.id));
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<${Fragment}>
      ${isImg && html`<button className="btn ghost sm" disabled=${busy} onClick=${view}><${Icon} n="eye" />View</button>`}
      ${Cap.ids && idsLooksLikeId(f) && html`<button className="btn ghost sm" onClick=${() => idsOpen({ refs: [{ base, fid: f.id, n: f.n, ty: f.ty }], who, src: 'file' })}><${Icon} n="shield" />Check ID</button>`}
      <button className="btn ghost sm" disabled=${busy} onClick=${dl}>
        <${Icon} n="down" />
        ${busy ? '…' : 'Download'}
      </button>
      ${
        onDelete &&
        html`<button className="btn ghost sm icon" aria-label=${'Delete ' + f.n} disabled=${busy} onClick=${onDelete}>
            <${Icon} n="trash" />
          </button>`
      }
      ${
        pv &&
        html`<${Modal} title=${f.n} onClose=${() => setPv(null)} wide>
            <img className="preview" src=${pv.url} alt=${f.n} />
          <//>`
      }
    <//>`;
}
function useHashRoute() {
  const [h, setH] = useState(location.hash || '#/');
  useEffect(() => {
    const f = () => setH(location.hash || '#/');
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  const raw = h.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  const q = {};
  // v83: a link with a broken escape (%E0, a lone %) keeps that part as typed instead of crashing the whole site
  const dec = s => {
    try {
      return decodeURIComponent(s);
    } catch (e) {
      return s;
    }
  };
  (qs || '')
    .split('&')
    .filter(Boolean)
    .forEach(p => {
      const [k, v] = p.split('=');
      const key = dec(k);
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') return;
      q[key] = dec(v || '');
    });
  return { path: path.replace(/\/+$/, '') || '/', q };
}

/* ================= Accounting: taxes, paystubs, chart of accounts ================= */
const TAX_DEFAULT = {
  us: {
    year: 2025,
    std: { single: 15000, married: 30000, head: 22500 },
    brackets: {
      single: [
        [11925, 0.1],
        [48475, 0.12],
        [103350, 0.22],
        [197300, 0.24],
        [250525, 0.32],
        [626350, 0.35],
        [1e12, 0.37],
      ],
      married: [
        [23850, 0.1],
        [96950, 0.12],
        [206700, 0.22],
        [394600, 0.24],
        [501050, 0.32],
        [751600, 0.35],
        [1e12, 0.37],
      ],
      head: [
        [17000, 0.1],
        [64850, 0.12],
        [103350, 0.22],
        [197300, 0.24],
        [250525, 0.32],
        [626350, 0.35],
        [1e12, 0.37],
      ],
    },
    ss: 6.2,
    ssBase: 176100,
    med: 1.45,
    medAdd: 0.9,
    medAddOver: 200000,
    futa: 0.6,
    futaBase: 7000,
    suta: 3.0,
    sutaBase: 43300,
  },
  in: {
    fy: '2025-26',
    regime: 'new',
    newSlabs: [
      [400000, 0],
      [800000, 0.05],
      [1200000, 0.1],
      [1600000, 0.15],
      [2000000, 0.2],
      [2400000, 0.25],
      [1e12, 0.3],
    ],
    newStd: 75000,
    newRebate: 1200000,
    oldSlabs: [
      [250000, 0],
      [500000, 0.05],
      [1000000, 0.2],
      [1e12, 0.3],
    ],
    oldStd: 50000,
    oldRebate: 500000,
    cess: 4,
    pf: 12,
    pfCap: true,
    pfCapWage: 15000,
    basicPct: 50,
    esiLimit: 21000,
    esiEmp: 0.75,
    esiEr: 3.25,
    pt: 200,
    ptMin: 15000,
  },
};
/* Payroll country: whatever the Tax tab says; until someone sets it, it follows the pay currency (INR = India, USD = US). */
const payCountry = (prof, cur) => (prof && prof.country) || (cur === 'USD' ? 'US' : 'IN');
const payMismatch = (country, cur) =>
  (country === 'US' && cur !== 'USD') || (country === 'IN' && cur !== 'INR');
const TAX_PROFILE_DEFAULT = {
  country: 'US',
  wtype: 'w2',
  w4: { multi: false, dep: 0, other: 0, dedn: 0 },
  exemptFed: false,
  exemptState: false,
  stateExtra: 0,
  local: 0,
  localName: '',
  filing: 'single',
  extra: 0,
  state: 0,
  stateName: '',
  fica: true,
  regime: 'new',
  ded: 0,
  basicPct: '',
  pt: '',
  pf: true,
  method: 'Direct deposit',
};
const taxBrackets = (annual, br) => {
  let tax = 0,
    prev = 0;
  for (const row of arr(br)) {
    const lim = +arr(row)[0],
      r = +arr(row)[1];
    if (!(lim > prev) || !(r >= 0)) continue; // a table edited by hand may hold an empty or unordered row
    if (annual > prev) {
      tax += (Math.min(annual, lim) - prev) * r;
      prev = lim;
    } else break;
  }
  return tax;
};
/* US withholding for one pay period. pre = { fit, fica, state }: pay-period amounts that are not wages for that tax
   (Section 125 health, HSA and 401(k) reduce federal/state income tax wages; Section 125 and HSA also reduce FICA
   wages; 401(k) does not). ytd carries the year's wage bases so the Social Security, FUTA and SUTA limits hold.
   W-4 (2020 and later): filing status, Step 2 checkbox (multiple jobs), Step 3 credits, Step 4(a) other income,
   4(b) deductions and 4(c) extra withholding, following Pub. 15-T's percentage method. */
function usTaxes(gross, ytd, prof, s, ppy, pre) {
  s = { ...TAX_DEFAULT.us, ...obj(s) };
  prof = { ...TAX_PROFILE_DEFAULT, ...obj(prof) };
  ppy = ppy || 12;
  gross = +gross || 0;
  pre = obj(pre);
  const fitW = Math.max(0, gross - (+pre.fit || 0));
  const ficaW = Math.max(0, gross - (+pre.fica || 0));
  const stW = Math.max(0, gross - (+pre.state || 0));
  const y = obj(ytd);
  const yg = +y.ficaW || +y.gross || 0; // wage bases follow FICA wages
  const wtype = prof.wtype === '1099' || prof.wtype === 'c2c' ? prof.wtype : 'w2';
  const note0 = `Federal withholding uses the ${s.year} percentage method on annualized pay`;
  if (wtype !== 'w2') {
    // contractors (1099-NEC or corp-to-corp): nothing withheld, no employer taxes; the payout counts toward the 1099
    return { items: [], employer: [], total: 0, employerTotal: 0, wages: { fit: 0, fica: 0, state: 0, ss: 0, med: 0, futa: 0, suta: 0 }, wtype, note: wtype === 'c2c' ? 'Corp-to-corp: paid to the consultant\'s company, no withholding. Reported on Form 1099-NEC when applicable.' : 'Independent contractor: no withholding. Reported on Form 1099-NEC.' };
  }
  const std = { ...TAX_DEFAULT.us.std, ...obj(s.std) };
  const bracketsAll = { ...TAX_DEFAULT.us.brackets, ...obj(s.brackets) };
  const filing = std[prof.filing] != null ? prof.filing : 'single';
  const w4 = obj(prof.w4);
  let brackets = arr(bracketsAll[filing]).length ? bracketsAll[filing] : TAX_DEFAULT.us.brackets.single;
  let stdAmt = +std[filing] || 0;
  if (w4.multi) {
    // Step 2 checkbox: half the standard amount and halved bracket thresholds (Pub. 15-T "checkbox" tables)
    stdAmt = stdAmt / 2;
    brackets = brackets.map(([lim, r]) => [lim / 2, r]);
  }
  const annual = fitW * ppy + (+w4.other || 0) - (+w4.dedn || 0);
  const taxable = Math.max(0, annual - stdAmt);
  const fedAnnual = Math.max(0, taxBrackets(taxable, brackets) - (+w4.dep || 0));
  const fed = prof.exemptFed ? 0 : r2(fedAnnual / ppy + (+prof.extra || 0));
  // FICA: Social Security up to the wage base, Medicare on everything, the additional Medicare rate above the threshold
  const ssW = prof.fica ? Math.max(0, Math.min(ficaW, s.ssBase - yg)) : 0;
  const ss = r2((ssW * s.ss) / 100);
  const med = prof.fica ? r2((ficaW * s.med) / 100) : 0;
  const medAdd = prof.fica ? r2((Math.max(0, Math.min(ficaW, yg + ficaW - s.medAddOver)) * s.medAdd) / 100) : 0;
  // State: the person's state (Team > Tax) decides the rule; a manual rate on their profile overrides it
  const code = String(prof.stateName || '').toUpperCase().trim();
  const rule = code ? stateRule(code, s) : null;
  const stateLabel = rule && US_STATES[code] ? rule.n : prof.stateName || 'State';
  let state = 0;
  if (prof.exemptState) state = 0;
  else if (+prof.state > 0) state = r2((stW * +prof.state) / 100);
  else if (rule && rule.ty === 'f') state = r2((stW * (+rule.r || 0)) / 100);
  else if (rule && rule.ty === 'b')
    state = r2(taxBrackets(Math.max(0, stW * ppy - (+rule.std || 0)), (rule.b || []).map(([l, r]) => [l, r / 100])) / ppy);
  if (state && +prof.stateExtra > 0) state = r2(state + +prof.stateExtra);
  const programs =
    rule && +prof.state <= 0
      ? (rule.x || [])
          .map(([n, r, base]) => ({ n, v: r2((Math.max(0, +base > 0 ? Math.min(stW, +base - yg) : stW) * +r) / 100), g: 'state' }))
          .filter(x => x.v > 0)
      : [];
  const local = +prof.local > 0 ? r2((stW * +prof.local) / 100) : 0;
  const items = [
    { n: 'Federal income tax', v: fed, g: 'fed' },
    { n: `Social Security (${s.ss}%)`, v: ss, g: 'fica' },
    { n: `Medicare (${s.med}%)`, v: med, g: 'fica' },
    ...(medAdd ? [{ n: `Additional Medicare (${s.medAdd}%)`, v: medAdd, g: 'fica' }] : []),
    ...(state ? [{ n: `${stateLabel} income tax`, v: state, g: 'state' }] : []),
    ...programs,
    ...(local ? [{ n: `${prof.localName || 'Local'} tax`, v: local, g: 'local' }] : []),
  ];
  const sutaRate = +obj(s.sutaRates)[code] > 0 ? +s.sutaRates[code] : s.suta;
  const sutaBase = +obj(s.sutaBases)[code] > 0 ? +s.sutaBases[code] : s.sutaBase;
  const futaW = Math.max(0, Math.min(ficaW, s.futaBase - yg));
  const sutaW = Math.max(0, Math.min(ficaW, sutaBase - yg));
  const employer = [
    { n: 'Social Security (employer)', v: ss, g: 'fica' },
    { n: 'Medicare (employer)', v: med, g: 'fica' },
    { n: 'FUTA', v: r2((futaW * s.futa) / 100), g: 'fed' },
    { n: `SUTA${code ? ' (' + code + ')' : ''}`, v: r2((sutaW * sutaRate) / 100), g: 'state' },
  ];
  return {
    items,
    employer,
    total: r2(items.reduce((a, x) => a + x.v, 0)),
    employerTotal: r2(employer.reduce((a, x) => a + x.v, 0)),
    wages: { fit: r2(fitW), fica: r2(ficaW), state: r2(stW), ss: r2(ssW), med: r2(ficaW), futa: r2(futaW), suta: r2(sutaW) },
    wtype,
    state: code,
    note: `${note0} (${filing}${w4.multi ? ', Step 2 checkbox' : ''})${rule && code ? `; ${stateLabel} ${rule.ty === 'n' ? 'has no income tax' : 'uses the state table under Tax settings'}` : ''}. Estimates to confirm with your CPA.`,
  };
}
/* Benefit plans, deductions, garnishments and PTO for one pay period (US). plans: org/acct/x/plans items; the
   person's enrollments (r.ben), garnishments (r.garn) and PTO (r.pto + the policy). Returns what to take before tax,
   after tax, what the employer adds, the garnishments and the period's PTO accrual, each as paystub lines. */
const PLAN_KINDS = {
  health: ['Health insurance', 's125'],
  dental: ['Dental', 's125'],
  vision: ['Vision', 's125'],
  hsa: ['HSA', 'hsa'],
  fsa: ['FSA', 's125'],
  k401: ['401(k)', 'k401'],
  roth: ['Roth 401(k)', 'post'],
  life: ['Life / disability', 'post'],
  other: ['Other', 'post'],
};
const GARN_KINDS = {
  child: ['Child support', 50],
  levy: ['Tax levy', 100],
  student: ['Student loan', 15],
  creditor: ['Creditor garnishment', 25],
  other: ['Other court order', 25],
};
function payBenefits(gross, period, plansDoc, rec, ytd) {
  const plans = {};
  arr(obj(plansDoc).items).forEach(p => {
    if (p && p.id) plans[p.id] = p;
  });
  rec = obj(rec);
  const inRange = x => (!x.start || x.start <= period.to) && (!x.end || x.end >= period.from);
  const pre = { fit: 0, fica: 0, state: 0 };
  const preLines = [];
  const postLines = [];
  const erLines = [];
  const y = obj(ytd);
  arr(rec.ben)
    .filter(e => e && plans[e.plan] && plans[e.plan].active !== false && inRange(e))
    .forEach(e => {
      const p = plans[e.plan];
      const kind = PLAN_KINDS[p.kind] ? p.kind : 'other';
      const taxKind = p.pre || PLAN_KINDS[kind][1];
      let ee = e.ee != null && e.ee !== '' ? +e.ee : +p.ee || 0;
      if (+e.eePct > 0 || (!(e.ee != null && e.ee !== '') && +p.eePct > 0)) ee = r2((gross * (+e.eePct > 0 ? +e.eePct : +p.eePct)) / 100);
      ee = r2(Math.max(0, ee));
      if (+p.limit > 0) {
        const soFar = +obj(y.ben)[p.id] || 0; // the year's contributions so far on this plan
        ee = r2(Math.max(0, Math.min(ee, +p.limit - soFar)));
      }
      let er = +p.er || 0;
      if (+p.erPct > 0) er = r2((gross * +p.erPct) / 100);
      if (+p.match > 0) er = r2(Math.min(ee, (gross * (+p.matchCap > 0 ? +p.matchCap : 100)) / 100) * (+p.match / 100)); // match % of the employee's contribution, up to a % of pay
      er = r2(Math.max(0, er));
      const line = { n: p.n || PLAN_KINDS[kind][0], v: ee, plan: p.id, kind, tax: taxKind };
      if (ee > 0) {
        if (taxKind === 's125' || taxKind === 'hsa') {
          pre.fit += ee;
          pre.fica += ee;
          pre.state += ee;
          preLines.push(line);
        } else if (taxKind === 'k401') {
          pre.fit += ee;
          pre.state += ee;
          preLines.push(line);
        } else postLines.push(line);
      }
      if (er > 0) erLines.push({ n: `${p.n || PLAN_KINDS[kind][0]} (employer)`, v: er, plan: p.id, kind, g: 'ben' });
    });
  return { pre: { fit: r2(pre.fit), fica: r2(pre.fica), state: r2(pre.state) }, preLines, postLines, erLines };
}
/* Court-ordered garnishments on disposable pay (gross minus taxes), each capped as the CCPA allows for its kind. */
function payGarnishments(gross, taxTotal, period, rec, ppy) {
  const disposable = Math.max(0, gross - taxTotal);
  const minWageFloor = (30 * 7.25 * 52) / (ppy || 12); // 30 × federal minimum wage per week, per pay period
  const out = [];
  let left = disposable;
  arr(obj(rec).garn)
    .filter(g => g && (!g.start || g.start <= period.to) && (!g.end || g.end >= period.from) && !(+g.total > 0 && +g.paid >= +g.total))
    .sort((a, b) => (a.kind === 'child' ? 0 : a.kind === 'levy' ? 1 : 2) - (b.kind === 'child' ? 0 : b.kind === 'levy' ? 1 : 2))
    .forEach(g => {
      const kind = GARN_KINDS[g.kind] ? g.kind : 'other';
      let v = +g.pct > 0 ? (disposable * +g.pct) / 100 : +g.amt || 0;
      const capPct = +g.cap > 0 ? +g.cap : GARN_KINDS[kind][1];
      let cap = (disposable * capPct) / 100;
      if (kind === 'creditor' || kind === 'other') cap = Math.min(cap, Math.max(0, disposable - minWageFloor));
      v = Math.min(v, cap, left);
      if (+g.total > 0) v = Math.min(v, +g.total - (+g.paid || 0));
      v = r2(Math.max(0, v));
      if (v > 0) {
        left -= v;
        out.push({ n: `${GARN_KINDS[kind][0]}${g.payee ? ' · ' + g.payee : ''}`, v, id: g.id || '', kind, payee: g.payee || '', caseNo: g.caseNo || '' });
      }
    });
  return out;
}
/* PTO for the period: hours accrued under the person's policy and the balance after this period. */
function payPto(calc, ptoDoc, rec, ppy) {
  const pol = arr(obj(ptoDoc).policies).find(p => p && p.id === obj(obj(rec).pto).policy);
  if (!pol) return null;
  const cur = obj(obj(rec).pto);
  const hours = (calc.reg + calc.ot) / 60;
  let acc = pol.accrual === 'hour' ? hours * (+pol.rate || 0) : pol.accrual === 'year' ? (+pol.rate || 0) / (ppy || 12) : +pol.rate || 0;
  acc = Math.round(acc * 100) / 100;
  let bal = (+cur.bal || 0) + acc;
  if (+pol.cap > 0) bal = Math.min(bal, +pol.cap);
  return { policy: pol.id, n: pol.n || 'PTO', accrued: acc, bal: Math.round(bal * 100) / 100, used: +cur.used || 0 };
}
function inTaxes(gross, ytd, prof, s) {
  s = { ...TAX_DEFAULT.in, ...(s || {}) };
  prof = { ...TAX_PROFILE_DEFAULT, ...(prof || {}) };
  const basic = gross * ((+prof.basicPct || s.basicPct) / 100);
  const pfWage = s.pfCap ? Math.min(basic, s.pfCapWage) : basic;
  const pf = prof.pf ? r2((pfWage * s.pf) / 100) : 0;
  const esiOn = gross <= s.esiLimit;
  const esi = esiOn ? r2((gross * s.esiEmp) / 100) : 0;
  const esiEr = esiOn ? r2((gross * s.esiEr) / 100) : 0;
  const pt = gross >= s.ptMin ? (prof.pt !== '' && prof.pt != null ? +prof.pt : s.pt) : 0;
  const regime = prof.regime || s.regime;
  const annual = gross * 12;
  let taxable, tax;
  if (regime === 'old') {
    taxable = Math.max(0, annual - s.oldStd - (+prof.ded || 0) - pf * 12);
    tax = taxBrackets(taxable, s.oldSlabs);
    if (taxable <= s.oldRebate) tax = 0;
  } else {
    taxable = Math.max(0, annual - s.newStd);
    tax = taxBrackets(taxable, s.newSlabs);
    if (taxable <= s.newRebate) tax = 0;
  }
  tax = tax * (1 + s.cess / 100);
  const tds = r2(tax / 12);
  const items = [
    ...(pf ? [{ n: 'Provident Fund (EPF)', v: pf }] : []),
    ...(esi ? [{ n: 'ESI', v: esi }] : []),
    ...(pt ? [{ n: 'Professional tax', v: r2(pt) }] : []),
    { n: 'TDS (income tax)', v: tds },
  ];
  const employer = [
    ...(pf ? [{ n: 'EPF (employer)', v: pf }] : []),
    ...(esiEr ? [{ n: 'ESI (employer)', v: esiEr }] : []),
  ];
  return {
    items,
    employer,
    total: r2(items.reduce((a, x) => a + x.v, 0)),
    employerTotal: r2(employer.reduce((a, x) => a + x.v, 0)),
    note: `TDS estimated on annualized salary under the ${regime} regime (FY ${s.fy}), with 4% cess; confirm with your CA.`,
  };
}
const payYearKey = (mk, country, payDate) => {
  // US wages belong to the year they are paid in; India to the financial year of the period
  const k = country !== 'IN' && typeof payDate === 'string' && payDate.length >= 10 ? payDate : mk;
  return country === 'IN'
    ? k.slice(5) >= '04'
      ? `${k.slice(0, 4)}-${+k.slice(0, 4) + 1}`
      : `${+k.slice(0, 4) - 1}-${k.slice(0, 4)}`
    : k.slice(0, 4);
};
function buildStub(m, mk, calc, prof, taxSet, prior, extras) {
  prof = obj(prof);
  extras = obj(extras);
  const person = obj(m && m.u && m.u.p);
  const rec = obj(m && m.r);
  const country = payCountry(prof, calc.p.cur);
  const yk = payYearKey(mk, country, calc.payDate);
  const period = { from: calc.from, to: calc.to };
  // earlier paystubs had no year key; the period alone places them in a year
  const ytd = arr(prior)
    .filter(p => p && typeof p === 'object' && typeof (p.mk || p.id) === 'string')
    .map(p => ({ ...p, mk: p.mk || p.id, yk: p.yk || payYearKey(p.mk || p.id, country) }))
    .filter(p => p.yk === yk && p.mk < mk)
    .reduce(
      (a, p) => {
        const w = obj(p.wages);
        const ben = { ...a.ben };
        arr(p.pre).concat(arr(p.post)).forEach(l => {
          if (l && l.plan) ben[l.plan] = (ben[l.plan] || 0) + (+l.v || 0);
        });
        return {
          gross: a.gross + (+p.gross || 0),
          tax: a.tax + (+p.taxT || +p.tax || 0),
          net: a.net + (+p.net || 0),
          ficaW: a.ficaW + (+w.fica || +p.gross || 0),
          fitW: a.fitW + (+w.fit || +p.gross || 0),
          ben,
        };
      },
      { gross: 0, tax: 0, net: 0, ficaW: 0, fitW: 0, ben: {} }
    );
  // v83: one-off positive adjustments (a bonus) are wages: paid, taxed and counted in YTD; negative ones are deductions below
  const gross = r2(calc.gross + calc.adj.filter(a => a.v > 0).reduce((s, a) => s + a.v, 0));
  const ben = country === 'US' ? payBenefits(gross, period, extras.plans, rec, ytd) : { pre: { fit: 0, fica: 0, state: 0 }, preLines: [], postLines: [], erLines: [] };
  const t =
    country === 'IN'
      ? inTaxes(gross, ytd, prof, taxSet && taxSet.in)
      : usTaxes(gross, ytd, prof, taxSet && taxSet.us, calc.ppy || 12, ben.pre);
  const garn = country === 'US' ? payGarnishments(gross, t.total, period, rec, calc.ppy || 12) : [];
  const pto = payPto(calc, extras.pto, rec, calc.ppy || 12);
  const regH = r2(calc.reg / 60),
    otH = r2(calc.ot / 60);
  const earnings = [
    {
      n:
        calc.p.type === 'hourly'
          ? `Regular hours (${h1(regH)} h × ${fmtMoney(calc.hourRate, calc.p.cur)})`
          : `Base salary${calc.paidDays != null && calc.p.lop ? ` (${calc.paidDays} of ${calc.workDays} days)` : ''}`,
      v: calc.base,
    },
    ...(calc.otPay ? [{ n: `Overtime (${h1(otH)} h)`, v: calc.otPay }] : []),
    ...calc.allow.map(a => ({ n: a.n, v: a.v })),
    ...calc.adj.filter(a => a.v > 0).map(a => ({ n: a.n, v: a.v })),
  ];
  const other = [
    ...ben.preLines.map(d => ({ n: d.n + ' (pre-tax)', v: d.v, plan: d.plan, pre: true })),
    ...ben.postLines.map(d => ({ n: d.n, v: d.v, plan: d.plan })),
    ...calc.ded.map(d => ({ n: d.n, v: d.v })),
    ...garn.map(g => ({ n: g.n, v: g.v, garn: g.id || g.kind })),
    ...calc.adj.filter(a => a.v < 0).map(a => ({ n: a.n, v: -a.v })),
  ];
  const otherT = r2(other.reduce((a, x) => a + x.v, 0));
  const net = r2(gross - t.total - otherT);
  const employerAll = [...t.employer, ...ben.erLines];
  const employerT = r2(employerAll.reduce((a, x) => a + x.v, 0));
  return {
    uid: m.id,
    n: person.n || (Cap.me && Cap.me.id === m.id && Cap.me.name) || m.id || '',
    e: person.e || '',
    ti: rec.ti || person.ti || '',
    mk,
    yk,
    country,
    cur: calc.p.cur,
    days: calc.present,
    workDays: calc.workDays,
    reg: regH,
    ot: otH,
    earnings,
    gross,
    taxes: t.items,
    taxT: t.total,
    other,
    otherT,
    net,
    employer: employerAll,
    employerT,
    cost: r2(gross + employerT),
    ytd: { gross: r2(ytd.gross + gross), tax: r2(ytd.tax + t.total), net: r2(ytd.net + net) },
    wages: t.wages || null,
    wtype: t.wtype || (country === 'US' ? 'w2' : ''),
    state: t.state || '',
    pre: ben.preLines,
    post: ben.postLines,
    garn,
    pto,
    payDate: calc.payDate || '',
    ppy: calc.ppy || 12,
    note: t.note,
    method: prof.method || 'Direct deposit',
    filing: prof.filing,
    regime: prof.regime,
  };
}
/* A saved paystub in the shape the pages expect, whichever version of the site wrote it: the lists are always
   lists, the amounts always numbers, and anything missing is filled in from what is there. */
function normStub(s) {
  const o = obj(s);
  const list = l => arr(l).filter(x => x && typeof x === 'object').map(x => ({ ...x, n: String(x.n == null ? '' : x.n), v: +x.v || 0 }));
  const num = (...vals) => {
    for (const v of vals) if (v != null && v !== '' && isFinite(+v)) return +v;
    return 0;
  };
  const sum = l => r2(l.reduce((a, x) => a + x.v, 0));
  const earnings = list(o.earnings),
    taxes = list(o.taxes),
    other = list(o.other),
    employer = list(o.employer);
  const gross = num(o.gross, sum(earnings));
  const taxT = num(o.taxT, o.tax, sum(taxes));
  const otherT = num(o.otherT, sum(other));
  const employerT = num(o.employerT, sum(employer));
  const ytd = obj(o.ytd);
  return {
    ...o,
    n: String(o.n || ''),
    e: String(o.e || ''),
    ti: String(o.ti || ''),
    mk: String(o.mk || o.id || ''),
    cur: o.cur === 'USD' || o.cur === 'INR' ? o.cur : o.country === 'US' ? 'USD' : 'INR',
    country: o.country === 'US' || o.country === 'IN' ? o.country : o.cur === 'USD' ? 'US' : 'IN',
    days: num(o.days),
    workDays: num(o.workDays, 20),
    reg: num(o.reg),
    ot: num(o.ot),
    earnings: earnings.length ? earnings : gross ? [{ n: 'Pay', v: gross }] : [],
    gross,
    taxes,
    taxT,
    other,
    otherT,
    net: num(o.net, r2(gross - taxT - otherT)),
    employer,
    employerT,
    cost: num(o.cost, r2(gross + employerT)),
    ytd: { gross: num(ytd.gross, gross), tax: num(ytd.tax, taxT), net: num(ytd.net, o.net) },
    note: typeof o.note === 'string' ? o.note : '',
    method: typeof o.method === 'string' && o.method ? o.method : 'Direct deposit',
    period: typeof o.period === 'string' ? o.period : '',
    pending: num(o.pending),
    pendingMins: num(o.pendingMins),
    conf: o.conf && typeof o.conf === 'object' ? o.conf : null,
  };
}
const COA_DEFAULT = [
  { id: 'inc-staff', n: 'Staffing income', t: 'income' },
  { id: 'inc-sow', n: 'Project (SOW) income', t: 'income' },
  { id: 'inc-consult', n: 'Consulting income', t: 'income' },
  { id: 'inc-other', n: 'Other income', t: 'income' },
  { id: 'exp-c2c', n: 'Contractor payments (C2C)', t: 'expense' },
  { id: 'exp-payroll', n: 'Payroll', t: 'expense' },
  { id: 'exp-paytax', n: 'Payroll taxes', t: 'expense' },
  { id: 'exp-rent', n: 'Rent and utilities', t: 'expense' },
  { id: 'exp-soft', n: 'Software subscriptions', t: 'expense' },
  { id: 'exp-travel', n: 'Travel', t: 'expense' },
  { id: 'exp-mkt', n: 'Marketing and job boards', t: 'expense' },
  { id: 'exp-prof', n: 'Professional fees (legal, CPA)', t: 'expense' },
  { id: 'exp-ins', n: 'Insurance', t: 'expense' },
  { id: 'exp-office', n: 'Office and supplies', t: 'expense' },
  { id: 'exp-bank', n: 'Bank fees and charges', t: 'expense' },
  { id: 'exp-tax', n: 'Taxes and licenses', t: 'expense' },
  { id: 'exp-other', n: 'Other expenses', t: 'expense' },
];
const ATS_ST = {
  new: 'New',
  screen: 'Screening',
  interview: 'Interview',
  offer: 'Offer',
  hired: 'Hired',
  rejected: 'Rejected',
};
const ATS_TEMPLATES = {
  screen: {
    s: 'Your application to StratEdge IT Consulting',
    b: 'Hi {name},\n\nThank you for applying for the {job} role. We\u2019ve reviewed your profile and would like to set up a short call to learn more about your experience and what you\u2019re looking for.\n\nCould you share a few times that work for you this week?\n\nBest regards,\n{me}\nStratEdge IT Consulting',
  },
  interview: {
    s: 'Interview invitation: {job} at StratEdge IT Consulting',
    b: 'Hi {name},\n\nWe\u2019d like to invite you to an interview for the {job} role on {date}. Please reply to confirm, or suggest another time if that doesn\u2019t work.\n\nWe look forward to speaking with you.\n\nBest regards,\n{me}\nStratEdge IT Consulting',
  },
  offer: {
    s: 'Offer: {job} at StratEdge IT Consulting',
    b: 'Hi {name},\n\nWe\u2019re pleased to move forward with an offer for the {job} role. The offer letter will follow for electronic signature. Please let us know if you have any questions.\n\nWelcome aboard,\n{me}\nStratEdge IT Consulting',
  },
  rejected: {
    s: 'Your application to StratEdge IT Consulting',
    b: 'Hi {name},\n\nThank you for taking the time to apply for the {job} role. We\u2019ve decided to move forward with other candidates for this position, but we\u2019ll keep your profile on file for roles that match your experience.\n\nWe wish you the best in your search.\n\nBest regards,\n{me}\nStratEdge IT Consulting',
  },
};

/* ---- sign-in activity helpers ---- */
function uaSummary(ua) {
  ua = ua || '';
  const os = /iPhone|iPad/.test(ua)
    ? /iPad/.test(ua)
      ? 'iPad'
      : 'iPhone'
    : /Android/.test(ua)
      ? 'Android'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X/.test(ua)
          ? 'Mac'
          : /CrOS/.test(ua)
            ? 'ChromeOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : '';
  const br = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /SamsungBrowser/.test(ua)
        ? 'Samsung Internet'
        : /Chrome\//.test(ua) && !/Chromium/.test(ua)
          ? 'Chrome'
          : /Firefox\//.test(ua)
            ? 'Firefox'
            : /Safari\//.test(ua)
              ? 'Safari'
              : ua
                ? 'Browser'
                : '';
  return [br, os].filter(Boolean).join(' on ') || 'Unknown device';
}
const geoLabel = r => {
  if (!r) return '';
  const g = r.geo;
  const ip = g && g.label ? g.label : '';
  return ip;
};
const mapLink = p => `https://www.google.com/maps?q=${p.lat},${p.lng}`;
/* Exact location: resolves to { pos } or { err } where err is why it is unavailable.
   insecure = page not served over https (browsers block geolocation), denied = the person refused the prompt,
   unavailable = no GPS/network fix, timeout = no answer in time, nosupport = old browser. */
function getPosition(ms) {
  return new Promise(res => {
    try {
      if (!window.isSecureContext) return res({ err: 'insecure' });
      if (!navigator.geolocation) return res({ err: 'nosupport' });
      let done = false;
      const fin = v => {
        if (!done) {
          done = true;
          res(v);
        }
      };
      const timer = setTimeout(() => fin({ err: 'timeout' }), ms || 10000);
      navigator.geolocation.getCurrentPosition(
        p => {
          clearTimeout(timer);
          fin({
            pos: {
              lat: +p.coords.latitude.toFixed(5),
              lng: +p.coords.longitude.toFixed(5),
              acc: Math.round(p.coords.accuracy || 0),
            },
          });
        },
        e => {
          clearTimeout(timer);
          fin({ err: e && e.code === 1 ? 'denied' : e && e.code === 3 ? 'timeout' : 'unavailable' });
        },
        { enableHighAccuracy: true, timeout: (ms || 10000) - 500, maximumAge: 20000 }
      );
    } catch (e) {
      res({ err: 'unavailable' });
    }
  });
}
const POS_ERR = {
  insecure: 'needs a secure https connection',
  denied: 'blocked in the browser',
  unavailable: 'no location fix on this device',
  timeout: 'no answer from the device in time',
  nosupport: 'browser does not support location',
  '': 'not shared',
};
async function locPermission() {
  try {
    if (!window.isSecureContext) return 'insecure';
    if (!navigator.permissions) return 'prompt';
    const s = await navigator.permissions.query({ name: 'geolocation' });
    return s.state;
  } catch (e) {
    return 'prompt';
  }
}
let _loginPos = null;
function startLoginLocation() {
  _loginPos = getPosition(12000);
}
async function shareLoginLocation() {
  try {
    const r = await (_loginPos || getPosition(12000));
    _loginPos = null;
    await api('login_geo', r.pos ? { ...r.pos } : { posErr: r.err || 'unavailable' });
    return r;
  } catch (e) {
    return { err: 'unavailable' };
  }
}

['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(ev =>
  window.addEventListener(
    ev,
    () => {
      const was = Sync.lastAct || 0;
      Sync.lastAct = Date.now();
      if (Date.now() - was > 120000 && !document.hidden) Sync.kick(300);
    },
    { passive: true }
  )
);

/* ---------- v37: StratEdge Workspaces (another company's portal on this installation) ---------- */
const wsOn = () => !!(Cap.ws && !Cap.ws.missing);
const wsName = () => (wsOn() ? Cap.ws.name : 'StratEdge IT Consulting');
/** Is this part of the portal (recruiting, hr, time, payroll, books, crm, learning, billing, mail, chat, desk) on
 *  here? Always on StratEdge's own site; a company workspace has the parts the provider switched on for it. */
const wsFeat = f => !wsOn() || (Array.isArray(Cap.ws.features) && Cap.ws.features.includes(f));
/* An address that may be a company workspace (/w/<name>/, or a host other than StratEdge's own): the website waits for
   the server's answer before drawing anything, so StratEdge's own pages never flash on a company's portal. */
const WS_HINT = (() => {
  try {
    if (/^\/w\/[a-z0-9-]{1,30}\//.test(location.pathname)) return true;
    const h = location.hostname.replace(/^www\./, '');
    return !['localhost', '127.0.0.1', '[::1]', '::1', new URL(CO.site).hostname.replace(/^www\./, '')].includes(h);
  } catch (e) {
    return false;
  }
})();
/** A small square icon: the first letter of a name in white on a color (a data: URL; '' when canvas is missing). */
function wsLetterIcon(name, color) {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = /^#[0-9a-fA-F]{6}$/.test(color || '') ? color : '#2B3993';
    if (g.roundRect) {
      g.beginPath();
      g.roundRect(0, 0, 64, 64, 14);
      g.fill();
    } else g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#fff';
    g.font = '700 38px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText((String(name || '?').trim()[0] || '?').toUpperCase(), 32, 35);
    return c.toDataURL('image/png');
  } catch (e) {
    return '';
  }
}
/** The workspace's name in the tab title, its logo as the tab icon and its color for the browser bar; the company's
 *  name and contact in place of StratEdge's in the pages (WS_BRAND, CO). */
function wsBrandApply() {
  if (!wsOn()) return;
  const ws = Cap.ws;
  WS_BRAND = String(ws.name || ws.slug || '').trim() || null;
  WS_DOMAIN = (/@([a-z0-9.-]+\.[a-z]{2,})$/i.exec(ws.contact || '') || [])[1] || 'yourcompany.com';
  WS_MAIL = ws.contact || 'info@' + WS_DOMAIN;
  if (!CO.se) CO.se = { ...CO };
  Object.assign(CO, {
    name: ws.name,
    legal: ws.name,
    email: ws.contact || '',
    phone: '',
    tel: '',
    hours: '',
    addr1: (ws.brand && ws.brand.addr) || '',
    addr2: '',
    map: '',
    linkedin: '',
    site: ws.url || CO.se.site,
  });
  try {
    const set = (sel, attr, v) => {
      const el = document.querySelector(sel);
      if (el && v) el.setAttribute(attr, v);
    };
    // the company's logo as the tab icon, or its first letter on its color (never StratEdge's icon)
    const icon = ws.brand && ws.brand.logo ? ws.brand.logo : wsLetterIcon(ws.name, (ws.brand && ws.brand.color) || '#2B3993');
    set('link[rel="icon"]', 'href', icon);
    set('link[rel="apple-touch-icon"]', 'href', icon);
    set('link[rel="manifest"]', 'href', 'api/index.php?r=ws_manifest');
    set('meta[name="theme-color"]', 'content', (ws.brand && ws.brand.color) || '');
    set('meta[name="apple-mobile-web-app-title"]', 'content', ws.name);
    document.documentElement.setAttribute('data-ws', ws.slug);
    const col = ws.brand && /^#[0-9a-fA-F]{6}$/.test(ws.brand.color || '') ? ws.brand.color : '';
    if (col) {
      const st = document.documentElement.style;
      st.setProperty('--ws-color', col);
      // the portal's buttons in the company's color when white text stays readable on it (contrast 4.5 : 1)
      const lin = h => {
        const c = parseInt(h, 16) / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      };
      const L = 0.2126 * lin(col.slice(1, 3)) + 0.7152 * lin(col.slice(3, 5)) + 0.0722 * lin(col.slice(5, 7));
      if (1.05 / (L + 0.05) >= 4.5) {
        const dark = '#' + [1, 3, 5].map(i => Math.round(parseInt(col.slice(i, i + 2), 16) * 0.85).toString(16).padStart(2, '0')).join('');
        st.setProperty('--btn', col);
        st.setProperty('--btn-hover', dark);
      }
      // v38: the Glass look in the company's color. Buttons are filled with the color itself when white or dark text on
      // it keeps 4.5 : 1 (a bright orange gets dark text rather than turning brown), otherwise with the color deepened
      // until white text does; text drawn in the company's color on light glass uses it deepened to 4.6 : 1 on white.
      const ch = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
      const hex = a => '#' + a.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
      const shade = (h, f) => hex(ch(h).map(v => v * f));
      const tint = (h, f) => hex(ch(h).map(v => v + (255 - v) * f));
      const lum = h => 0.2126 * lin(h.slice(1, 3)) + 0.7152 * lin(h.slice(3, 5)) + 0.0722 * lin(h.slice(5, 7));
      const onWhite = h => 1.05 / (lum(h) + 0.05);
      const onInk = h => (lum(h) + 0.05) / (lum('#101b35') + 0.05);
      let acc = col;
      let on = '#ffffff';
      let acc2;
      if (onWhite(col) >= 4.5) acc2 = shade(col, 0.8);
      else if (onInk(col) >= 4.5) {
        on = '#101b35';
        acc2 = tint(col, 0.18);
      } else {
        for (let i = 0; i < 14 && onWhite(acc) < 4.6; i++) acc = shade(acc, 0.88);
        acc2 = shade(acc, 0.8);
      }
      let ink = col;
      for (let i = 0; i < 14 && onWhite(ink) < 4.6; i++) ink = shade(ink, 0.88);
      st.setProperty('--ws-accent', acc);
      st.setProperty('--ws-accent-2', acc2);
      st.setProperty('--ws-on', on);
      st.setProperty('--ws-ink', ink);
      // the soft bubbles and the sky take the company's color as it is
      st.setProperty('--g-c1', ch(col).join(', '));
      document.documentElement.setAttribute('data-ws-accent', '');
    }
  } catch (e) {
    /* fine: cosmetic */
  }
}

/* ---------- a small markdown: paragraphs, "## " headings, "- " bullets, **bold**, *em*, [text](url) ---------- */
function mdInline(s, keyBase) {
  const out = [];
  const re = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  let m;
  let i = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    if (m[1]) out.push(html`<a key=${keyBase + '-' + i} href=${m[2]} target="_blank" rel="noopener">${m[1]}</a>`);
    else if (m[3]) out.push(html`<b key=${keyBase + '-' + i}>${m[3]}</b>`);
    else out.push(html`<em key=${keyBase + '-' + i}>${m[4]}</em>`);
    last = m.index + m[0].length;
    i++;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}
function MdLite({ text }) {
  const blocks = String(text || '')
    .replace(/\r/g, '')
    // v34: a heading directly followed by its text (policies are written that way) still starts a new block
    .replace(/^(## [^\n]*)\n(?!\n)/gm, '$1\n\n')
    .split(/\n\s*\n/)
    .map(b => b.trim())
    .filter(Boolean);
  return html`<div className="md">
      ${blocks.map((b, i) => {
        if (/^## /.test(b)) return html`<h3 key=${i}>${mdInline(b.replace(/^## /, ''), 'h' + i)}</h3>`;
        if (/^(\d+\. |- )/.test(b)) {
          const items = b.split('\n').filter(l => l.trim());
          const ordered = /^\d+\. /.test(items[0]);
          const Tag = ordered ? 'ol' : 'ul';
          return html`<${Tag} key=${i}>${items.map((l, j) => html`<li key=${j}>${mdInline(l.replace(/^(\d+\. |- )/, ''), 'l' + i + '-' + j)}</li>`)}<//>`;
        }
        return html`<p key=${i}>${mdInline(b.replace(/\n/g, ' '), 'p' + i)}</p>`;
      })}
    </div>`;
}
