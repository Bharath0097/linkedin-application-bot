/* ================= v39 Phone & texts (VoIP through the company's own Twilio account) =================
   For the people an administrator switched the phone on for (Cap.phone): a Phone button in the top bar of every
   portal (dialer, recent calls, texts), incoming calls ringing on any page, a call bar while on a call, click-to-call
   and text on records (CallLink), each record's calls and texts (PhoneHistory), and the Calls & texts page.
   The Twilio Voice SDK (js/vendor/twilio/twilio.min.js) is loaded only for them. Routes ph_* (api/phone.php). */
Object.assign(IP, {
  callin: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1zM15 3v6h6M21 3l-6 6',
  callout: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1zM21 9V3h-6M15 9l6-6',
  hang: 'M3 14.5c5-5 13-5 18 0l-2 2.5-3.5-1.5V13a10 10 0 0 0-7 0v2.5L5 17z',
  mic: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zm-7 9a7 7 0 0 0 14 0M12 19v3',
  micoff: 'M3 3l18 18M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V6a3 3 0 0 0-5.9-.8M5 12a7 7 0 0 0 11.6 5.2M19 12a7 7 0 0 1-.6 2.8M12 19v3',
  dialpad: 'M6 4h.01M12 4h.01M18 4h.01M6 10h.01M12 10h.01M18 10h.01M6 16h.01M12 16h.01M18 16h.01M12 21h.01',
  sms: 'M4 5h16v11H8l-4 4V5zm4 5h.01m4 0h.01m4 0h.01',
  voicemail: 'M6.5 16a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7zm11 0a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7zM6.5 16h11',
  chevup: 'M6 15l6-6 6 6',
});
const PH_ST = {
  ringing: ['Ringing', 'new'],
  live: ['On the call', 'ok'],
  done: ['', ''],
  missed: ['Missed', 'red'],
  voicemail: ['Voicemail', 'amber'],
  busy: ['Busy', ''],
  noanswer: ['No answer', ''],
  failed: ['Failed', 'red'],
  canceled: ['Canceled', ''],
  blocked: ['Not allowed', 'red'],
};
// v39.1: why the green Call button is greyed out, in the panel
const PH_WHY = {
  account: "The company's Twilio account is not connected yet.",
  keys: 'The Twilio keys are incomplete (the Auth Token or the API key secret is missing).',
  number: 'No company number is switched on in the portal yet.',
  nonum: "Every company number is someone else's personal line, so none is set up for you yet.",
};
// v39.1: the browser phone's error codes in plain words (Twilio's own words are only the fallback)
const PH_ERR = {
  31486: 'The number is busy.',
  31480: 'Nobody answered (or the phone is switched off).',
  31603: 'The call was declined.',
  31002: 'The call was declined.',
  31404: 'That number could not be reached. Check it, with the country code.',
  31003: 'The call timed out. Check the internet connection and try again.',
  31009: 'The browser lost its connection to the phone service. Check the internet connection.',
  31005: 'Twilio ended the call before it connected.',
  31000: 'Twilio ended the call before it connected.',
  31401: 'The browser was not allowed to use the microphone. Allow the microphone for this site (the icon in the address bar), then call again.',
  31208: 'The browser was not allowed to use the microphone. Allow the microphone for this site (the icon in the address bar), then call again.',
  31402: 'The microphone could not be used. Check that a microphone or headset is connected.',
  53405: "The call's sound could not connect: a firewall or the network may be blocking it.",
  31204: "The phone's pass is not valid any more. Reload the page.",
  31205: "The phone's pass ran out. Reload the page.",
  20104: "The phone's pass ran out. Reload the page.",
};
const PH_LOCAL = [31401, 31208, 31402, 31003, 31009, 53405, 31204, 31205, 20104]; // the browser's own problems: nothing to ask Twilio
const phErrText = e => {
  const code = e && e.code;
  const gw = e && e.originalError && e.originalError.code;
  return PH_ERR[gw] || PH_ERR[code] || (e && (e.message || e.description)) || 'The call had a problem.';
};
const PH_KIND = { ats: 'Candidate', cons: 'Consultant', vendor: 'Vendor', crm: 'CRM contact', lead: 'Lead', req: 'Requirement', mail: 'Email contact' };
/** +15552013344, 1-555-201-3344 or 555.201.3344 → (555) 201-3344; +919876543210 → +91 98765 43210; others as written. */
const phFmt = n => {
  const s = String(n || '');
  const d = s.replace(/[^\d+]/g, '');
  let m = /^(?:\+1|1)?(\d{3})(\d{3})(\d{4})$/.exec(d);
  if (m) return `(${m[1]}) ${m[2]}-${m[3]}`;
  m = /^\+91(\d{5})(\d{5})$/.exec(d);
  if (m) return `+91 ${m[1]} ${m[2]}`;
  return s;
};
const phDur = s => {
  s = Math.max(0, Math.round(+s || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};
const phIsEmergency = n => ['911', '933', '112', '999', '000', '100', '101', '102', '108', '110', '119'].includes(String(n || '').replace(/\D+/g, '').replace(/^1(?=911$|933$)/, ''));
const phName = (names, fallback) => (names && names.length ? names[0][2] : '') || fallback || '';
/** Ask the phone to call a number (from a record: its kind:id, the person's name). */
const phCall = (n, meta) => window.dispatchEvent(new CustomEvent('se-phone', { detail: { act: 'call', n, ...(meta || {}) } }));
const phText = (n, meta) => window.dispatchEvent(new CustomEvent('se-phone', { detail: { act: 'text', n, ...(meta || {}) } }));
const phOn = () => !!(Cap.phone && Cap.phone.on);
// v39.1: this person has the phone (an administrator also sees the Phone button before, to finish setting it up)
const phMine = () => !!(Cap.phone && Cap.phone.mine !== false);
const CALLS_NAV_ITEM = ['calls', 'Calls & texts', 'phone']; // the member portals' menu (after Messages)

/* ---- the phone's state, shared by the button, the call bar and the pages ---- */
const PH = {
  st: 'off', // off | loading | ready | error
  err: '',
  gen: 0, // each start; a stop makes a start still on its way give up
  uid: null,
  reg: false,
  dev: null,
  call: null, // { c: Twilio Call (null for a provider call, which has a key k instead), dir, n, name, ref, st: 'calling'|'ringing'|'live'|'ended', at, muted, callId, sid }
  inc: null, // { c, n, name, sub, line, callId }
  unseen: { calls: 0, texts: 0 },
  subs: new Set(),
  emit() {
    PH.subs.forEach(f => f({}));
  },
  async loadSdk() {
    if (window.Twilio && window.Twilio.Device) return;
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'js/vendor/twilio/twilio.min.js?v=2.18.5';
      s.onload = () => (window.Twilio && window.Twilio.Device ? res() : rej(new Error('The phone could not start.')));
      s.onerror = () => rej(new Error('The phone could not load. Check your connection and reload the page.'));
      document.head.appendChild(s);
    });
  },
  async start() {
    if (PH.dev && PH.uid !== Cap.uid) PH.stop();
    if (PH.st === 'loading' || PH.st === 'ready' || !phOn()) return;
    const gen = ++PH.gen;
    PH.st = 'loading';
    PH.err = '';
    PH.uid = Cap.uid;
    PH.emit();
    if (Cap.phone && Cap.phone.provider && Cap.phone.provider !== 'twilio') {
      PH.st = 'ready'; PH.reg = false; PH.emit(); return;
    }
    try {
      await PH.loadSdk();
      const t = await api('ph_token', {});
      if (gen !== PH.gen) return;
      const D = new window.Twilio.Device(t.token, { closeProtection: true, codecPreferences: ['opus', 'pcmu'], enableImprovedSignalingErrorPrecision: true, logLevel: 'error', appName: 'stratedge-portal', appVersion: typeof APP_VERSION === 'string' ? APP_VERSION : '' });
      D.on('tokenWillExpire', async () => {
        try {
          D.updateToken((await api('ph_token', {})).token);
        } catch (e) {
          /* the next call asks again */
        }
      });
      D.on('registered', () => {
        PH.reg = true;
        PH.emit();
      });
      D.on('unregistered', () => {
        PH.reg = false;
        PH.emit();
      });
      D.on('error', e => {
        PH.err = (e && (e.message || e.description)) || 'The phone had a problem.';
        PH.emit();
      });
      D.on('incoming', c => PH.ring(c));
      PH.dev = D;
      PH.st = 'ready';
      if (Cap.phone && Cap.phone.avail) await D.register().catch(e => (PH.err = (e && e.message) || 'Incoming calls could not be switched on.'));
    } catch (e) {
      if (gen !== PH.gen) return;
      PH.st = 'error';
      PH.err = errText(e);
    }
    PH.emit();
  },
  /** Signed out, or the phone was switched off: the browser stops ringing and any call ends. */
  stop() {
    PH.gen++;
    if (PH.dev) {
      try {
        PH.dev.destroy();
      } catch (e) {
        /* already gone */
      }
    }
    Object.assign(PH, { dev: null, st: 'off', reg: false, call: null, inc: null, uid: null, err: '', unseen: { calls: 0, texts: 0 } });
    PH.emit();
  },
  async avail(on) {
    try {
      await api('ph_avail', { on });
      if (Cap.phone) Cap.phone.avail = on;
      if (PH.dev) await (on ? PH.dev.register() : PH.dev.unregister()).catch(() => {});
    } catch (e) {
      PH.err = errText(e);
    }
    PH.emit();
  },
  watch(c, info) {
    PH.call = { c, at: 0, t0: Date.now(), muted: false, st: info.dir === 'out' ? 'calling' : 'live', ...info };
    if (info.dir === 'in') PH.call.at = Date.now();
    const end = () => {
      if (PH.call && PH.call.c === c) {
        PH.call = { ...PH.call, st: 'ended', ended: Date.now(), sid: PH.call.sid || (c.parameters && c.parameters.CallSid) || '' };
        PH.emit();
      }
    };
    c.on('ringing', () => {
      if (PH.call && PH.call.c === c && PH.call.st === 'calling') PH.call = { ...PH.call, st: 'ringing' };
      PH.emit();
    });
    c.on('accept', () => {
      if (PH.call && PH.call.c === c) PH.call = { ...PH.call, st: 'live', at: Date.now(), sid: (c.parameters && c.parameters.CallSid) || '' };
      PH.emit();
    });
    c.on('mute', m => {
      if (PH.call && PH.call.c === c) PH.call = { ...PH.call, muted: !!m };
      PH.emit();
    });
    c.on('disconnect', end);
    c.on('cancel', end);
    c.on('reject', end);
    c.on('error', e => {
      const code = (e && e.code) || 0;
      if (PH.call && PH.call.c === c) PH.call = { ...PH.call, err: phErrText(e), code, gw: (e && e.originalError && +e.originalError.code) || 0 };
      end();
      // v39.1: a call out that Twilio ended: the portal asks why (its log, then Twilio's errors for the call)
      if (info.dir === 'out' && !PH_LOCAL.includes(code)) PH.why(c);
    });
    PH.emit();
  },
  async why(c) {
    const sid = (c.parameters && c.parameters.CallSid) || '';
    for (const wait of [1200, 4500, 9000]) {
      await new Promise(r => setTimeout(r, wait));
      if (!PH.call || PH.call.c !== c) return;
      try {
        const r = await api('ph_why', { sid, gw: PH.call.gw || 0, at: PH.call.t0 || 0 });
        if (!PH.call || PH.call.c !== c) return;
        PH.call = { ...PH.call, why: r };
        PH.emit();
        if (r.final) return;
      } catch (e) {
        return;
      }
    }
  },
  lang(v) {
    if (v !== undefined) {
      try {
        v ? localStorage.setItem('se_ph_lang', v) : localStorage.removeItem('se_ph_lang');
      } catch (e) {}
      return v || '';
    }
    try {
      return localStorage.getItem('se_ph_lang') || '';
    } catch (e) {
      return '';
    }
  },
  async dial(n, meta) {
    const to = String(n || '').trim();
    if (!to) return 'Enter a number first.';
    if (phIsEmergency(to) && !(Cap.phone && Cap.phone.e911 === 'allow')) return 'This phone cannot call emergency services. Dial from a mobile phone or a desk phone.';
    if (PH.call && PH.call.st !== 'ended') return 'You are already on a call.';
    if (PH.st !== 'ready') await PH.start();
    if (Cap.phone && Cap.phone.provider && Cap.phone.provider !== 'twilio') {
      try {
        // v83: keep the ph_calls row id the server returns, so the call bar can save a note on it
        const r = await api('ph_provider_call', { to, ref: (meta && meta.ref) || '' }, { timeout: 45000 });
        PH.call = { c: null, k: 'p' + Date.now(), callId: (r && r.id) || '', at: Date.now(), t0: Date.now(), muted: false, st: 'ended', dir: 'out', n: to, name: (meta && meta.name) || '', ref: (meta && meta.ref) || '', provider: Cap.phone.provider };
        PH.emit();
        return '';
      } catch (e) { return errText(e); }
    }
    if (!PH.dev) return PH.err || 'The phone is not ready.';
    try {
      const params = { To: to, cid: (meta && meta.cid) || (Cap.phone && Cap.phone.cid) || '' };
      if (meta && meta.ref) params.ref = meta.ref;
      // v68: the transcript's language for this call (chosen in the dialer; empty = the account's)
      const lang = (meta && meta.lang) || PH.lang();
      if (lang) params.Lang = lang;
      const c = await PH.dev.connect({ params });
      PH.watch(c, { dir: 'out', n: to, name: (meta && meta.name) || '', ref: (meta && meta.ref) || '', rec: !!(Cap.phone && Cap.phone.recOut) });
      if (!(meta && meta.name)) api('ph_lookup', { n: to }).then(r => { if (PH.call && PH.call.c === c && r.names.length) { PH.call = { ...PH.call, name: r.names[0][2], sub: r.names[0][3] }; PH.emit(); } }, () => {});
      return '';
    } catch (e) {
      return errText(e);
    }
  },
  ring(c) {
    const p = c.parameters || {};
    const cp = c.customParameters || new Map();
    const n = p.From || '';
    if (PH.call && PH.call.st !== 'ended') {
      // already on a call: this one goes on to the others it rings, or to voicemail
      c.reject();
      return;
    }
    const cpv = k => (cp && cp.get ? cp.get(k) || '' : '');
    PH.inc = { c, n, name: '', sub: '', line: cpv('line'), callId: cpv('callId'), rec: cpv('rec') === '1' };
    const clear = () => {
      if (PH.inc && PH.inc.c === c) {
        PH.inc = null;
        PH.emit();
      }
    };
    c.on('cancel', clear);
    c.on('disconnect', clear);
    c.on('reject', clear);
    api('ph_lookup', { n }).then(
      r => {
        if (PH.inc && PH.inc.c === c && r.names.length) {
          PH.inc = { ...PH.inc, name: r.names[0][2], sub: r.names[0][3] };
          PH.emit();
        }
      },
      () => {}
    );
    PH.emit();
  },
  answer() {
    const i = PH.inc;
    if (!i) return;
    PH.inc = null;
    i.c.accept();
    PH.watch(i.c, { dir: 'in', n: i.n, name: i.name, sub: i.sub, callId: i.callId, line: i.line, rec: i.rec });
  },
  decline() {
    const i = PH.inc;
    if (!i) return;
    PH.inc = null;
    i.c.reject();
    PH.emit();
  },
  hangup() {
    if (PH.call && PH.call.c) PH.call.c.disconnect();
  },
  mute() {
    if (PH.call && PH.call.c) PH.call.c.mute(!PH.call.c.isMuted());
  },
  digit(d) {
    if (PH.call && PH.call.c && PH.call.st === 'live') PH.call.c.sendDigits(d);
  },
  close() {
    PH.call = null;
    PH.emit();
  },
  async refresh() {
    try {
      const r = await api('ph_me', {});
      const was = !!(Cap.phone && Cap.phone.on);
      Cap.phone = r.me;
      PH.unseen = r.unseen || PH.unseen;
      if (was !== !!(r.me && r.me.on)) capNotify();
      PH.emit();
    } catch (e) {
      // switched off meanwhile: the Phone button goes and the browser stops ringing
      if (e && e.code === 'forbidden') {
        Cap.phone = null;
        capNotify();
      }
    }
  },
};
function usePhone() {
  const [, set] = useState({});
  useEffect(() => {
    PH.subs.add(set);
    return () => PH.subs.delete(set);
  }, []);
  return PH;
}

/* ---- the Phone button (top bar): starts the phone, shows what was missed, opens the panel ---- */
function PhoneButton({ href }) {
  const S = usePhone();
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState(null);
  useEffect(() => {
    PH.refresh();
    const t = setInterval(() => document.visibilityState === 'visible' && PH.refresh(), 60000);
    const onPhone = e => {
      const d = e.detail || {};
      if (d.act === 'call' && d.n && phOn()) {
        // a call from a record: the call bar shows it; the panel opens only to say why it could not start
        PH.dial(d.n, d).then(msg => {
          if (!msg) return;
          setPreset({ ...d, err: msg, k: Date.now() });
          setOpen(true);
        });
        return;
      }
      setPreset({ ...d, k: Date.now() });
      setOpen(true);
    };
    window.addEventListener('se-phone', onPhone);
    const other = e => e.detail !== 'phone' && setOpen(false);
    window.addEventListener('se-panel', other);
    // the Calls & texts page has all of it: the panel closes when it opens
    const onHash = () => /\/calls(\?|$)/.test(location.hash) && setOpen(false);
    window.addEventListener('hashchange', onHash);
    return () => {
      clearInterval(t);
      window.removeEventListener('se-phone', onPhone);
      window.removeEventListener('se-panel', other);
      window.removeEventListener('hashchange', onHash);
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    window.dispatchEvent(new CustomEvent('se-panel', { detail: 'phone' }));
    const onKey = e => e.key === 'Escape' && !document.querySelector('.modal') && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  const n = (S.unseen.calls || 0) + (S.unseen.texts || 0);
  const busy = S.call && S.call.st !== 'ended';
  const todo = !!(Cap.phone && Cap.phone.admin && !Cap.phone.on); // v39.1: setup is not finished (administrators)
  return html`<${Fragment}>
    <button type="button" className=${'btn ghost sm chatbtn phbtn' + (busy ? ' oncall' : '') + (n > 0 ? ' hasbadge' : '')} onClick=${() => setOpen(!open)} aria-expanded=${open} title=${todo ? 'Phone: not set up yet' : 'Phone: calls and texts'} aria-label=${'Phone' + (n ? ', ' + n + ' new' : todo ? ', not set up yet' : '')}>
      <${Icon} n="phone" /><span className="askai-label">Phone</span>${n > 0 ? html`<span className="badge chatbadge">${n > 99 ? '99+' : n}</span>` : busy ? html`<span className="chatdot chatbtndot"></span>` : todo ? html`<span className="chatdot chatbtndot phtodo"></span>` : null}
    </button>
    ${
      // drawn at the page root like the windows: a call or a text started from a record's window shows above it
      open && ReactDOM.createPortal(html`<${PhonePanel} key=${preset ? preset.k : 0} preset=${preset} href=${href} onClose=${() => setOpen(false)} />`, document.body)
    }
  <//>`;
}
/* At the root of the site (main.js): starts the phone for the people who have it, stops it at sign-out or when it is
   switched off, and shows an incoming call and the call in progress on every page (moving around keeps the call). */
function PhoneHost() {
  const caps = useCaps();
  const want = !!(caps && caps.uid && caps.phone && caps.phone.on);
  useEffect(() => {
    if (want) PH.start();
    else if (PH.dev || PH.st !== 'off') PH.stop();
  }, [want, caps && caps.uid]);
  if (!want) return null;
  return html`<${PhoneLive} href="#/portal/calls" />`;
}
/* An incoming call (answer / decline) and the bar of the call in progress, on every page. */
function PhoneLive({ href }) {
  const S = usePhone();
  const [pad, setPad] = useState(false);
  const [mini, setMini] = useState(false);
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState(false);
  const [noteErr, setNoteErr] = useState('');
  const [, tick] = useState(0);
  useEffect(() => {
    if (!S.call || S.call.st !== 'live') return;
    const t = setInterval(() => tick(x => x + 1), 1000);
    return () => clearInterval(t);
  }, [S.call && S.call.st]);
  useEffect(() => {
    setNote('');
    setSaved(false);
    setNoteErr('');
    setPad(false);
    setMini(false);
  }, [S.call && (S.call.c || S.call.k)]);
  const c = S.call;
  const i = S.inc;
  const saveNote = async () => {
    setNoteErr('');
    try {
      const r = await api('ph_note', { id: c.callId || '', sid: c.sid || '', note, ref: c.ref || '' });
      if (PH.call && (PH.call.c || PH.call.k) === (c.c || c.k) && r.id) PH.call = { ...PH.call, callId: r.id };
      setSaved(true);
    } catch (e) {
      setNoteErr(e && e.code === 'not_found' ? 'The call is not in the log yet: try again in a moment, or add the note under Calls & texts.' : errText(e));
    }
  };
  const when = c
    ? c.st === 'calling'
      ? 'Calling…'
      : c.st === 'ringing'
        ? 'Ringing…'
        : c.st === 'live'
          ? phDur((Date.now() - c.at) / 1000) + (c.rec ? ' · recorded' : '')
          : 'Call ended' + (c.at ? ' · ' + phDur(((c.ended || Date.now()) - c.at) / 1000) : '')
    : '';
  return html`<${Fragment}>
    ${
      i &&
      html`<div className="phring" role="alertdialog" aria-label=${'Incoming call from ' + (i.name || phFmt(i.n))}>
        <div className="phring-ico"><${Icon} n="callin" /></div>
        <div className="phring-who">
          <b>${i.name || phFmt(i.n) || 'Unknown caller'}</b>
          ${(i.name || i.sub) && html`<span className="small">${[i.name ? phFmt(i.n) : '', i.sub].filter(Boolean).join(' · ')}</span>`}
          <span className="small muted">${i.line ? 'Calling ' + i.line : 'Incoming call'}${i.rec ? ' · recorded' : ''}</span>
        </div>
        <div className="actions">
          <button type="button" className="btn danger sm" onClick=${() => PH.decline()}><${Icon} n="hang" />Decline</button>
          <button type="button" className="btn go sm" onClick=${() => PH.answer()} autoFocus><${Icon} n="phone" />Answer</button>
        </div>
      </div>`
    }
    ${
      c &&
      mini &&
      html`<div className=${'phbar mini st-' + c.st} role="region" aria-label="Call">
        <div className="phbar-top">
          <span className="phbar-ico"><${Icon} n=${c.dir === 'in' ? 'callin' : 'callout'} /></span>
          <div className="phbar-who"><b>${c.name || phFmt(c.n)}</b><span className="small">${when}</span></div>
          ${c.st !== 'ended' && html`<button type="button" className="btn danger sm" onClick=${() => PH.hangup()} aria-label="Hang up"><${Icon} n="hang" /></button>`}
          <button type="button" className="btn ghost icon sm" aria-label="Show the call" title="Show the call" onClick=${() => setMini(false)}><${Icon} n="chevup" /></button>
        </div>
      </div>`
    }
    ${
      c &&
      !mini &&
      html`<div className=${'phbar st-' + c.st} role="region" aria-label="Call">
        <div className="phbar-top">
          <span className="phbar-ico"><${Icon} n=${c.dir === 'in' ? 'callin' : 'callout'} /></span>
          <div className="phbar-who">
            <b>${c.name || phFmt(c.n)}</b>
            <span className="small">${when}${c.name ? ' · ' + phFmt(c.n) : ''}</span>
          </div>
          ${c.st !== 'ended' && html`<button type="button" className="btn ghost icon sm" aria-label="Make the call bar small" title="Make it small" onClick=${() => setMini(true)}><${Icon} n="chev" /></button>`}
          ${c.st === 'ended' && html`<button type="button" className="btn ghost icon sm" aria-label="Close" onClick=${() => PH.close()}><${Icon} n="x" /></button>`}
        </div>
        ${
          c.why
            ? html`<div className="phwhy small" role="alert"><b>${c.why.reason}</b>${c.why.fix && html`<span>${c.why.fix}</span>`}${(c.why.code || c.why.more) && html`<span className="muted">${c.why.code ? 'Twilio error ' + c.why.code : ''}${c.why.more ? (c.why.code ? ': ' : '') + c.why.more : ''}</span>`}${Cap.phone && Cap.phone.admin && html`<a href="#/portal/admin/phone?check=1" onClick=${() => PH.close()}>Check the setup</a>`}</div>`
            : c.err && html`<div className="small" style=${{ color: 'var(--red-ink)' }} role="alert">${c.err}</div>`
        }
        ${
          c.st !== 'ended' &&
          html`<div className="phbar-ctl">
            <button type="button" className=${'btn ghost sm' + (c.muted ? ' on' : '')} aria-pressed=${!!c.muted} onClick=${() => PH.mute()}><${Icon} n=${c.muted ? 'micoff' : 'mic'} />${c.muted ? 'Unmute' : 'Mute'}</button>
            <button type="button" className=${'btn ghost sm' + (pad ? ' on' : '')} aria-pressed=${pad} disabled=${c.st !== 'live'} onClick=${() => setPad(!pad)}><${Icon} n="dialpad" />Keypad</button>
            <button type="button" className="btn danger sm" onClick=${() => PH.hangup()}><${Icon} n="hang" />Hang up</button>
          </div>`
        }
        ${pad && c.st === 'live' && html`<${PhoneKeys} onKey=${d => PH.digit(d)} />`}
        <div className="phbar-note">
          <textarea rows="2" placeholder="Notes about this call" value=${note} onInput=${e => { setNote(e.target.value); setSaved(false); }} aria-label="Notes about this call" />
          ${noteErr && html`<div className="small" style=${{ color: 'var(--red-ink)' }} role="alert">${noteErr}</div>`}
          ${(c.st === 'ended' || note) && html`<div className="actions"><button type="button" className="btn sm" disabled=${!note.trim() || saved} onClick=${saveNote}>${saved ? 'Saved' : 'Save the note'}</button>${c.st === 'ended' && html`<a className="btn ghost sm" href=${href} onClick=${() => PH.close()}>Calls & texts</a>`}</div>`}
        </div>
      </div>`
    }
  <//>`;
}
function PhoneKeys({ onKey }) {
  return html`<div className="phkeys" role="group" aria-label="Keypad">
      ${['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map(k => html`<button key=${k} type="button" className="btn ghost" onClick=${() => onKey(k)}>${k}</button>`)}
    </div>`;
}

/* ---- the panel: dial, recent calls, texts ---- */
function PhonePanel({ preset, href, onClose }) {
  const S = usePhone();
  const [tab, setTab] = useState(preset && preset.act === 'text' ? 'texts' : 'dial');
  const [n, setN] = useState((preset && preset.act === 'call' && preset.n) || '');
  const [err, setErr] = useState((preset && preset.err) || '');
  const [cid, setCid] = useState((Cap.phone && Cap.phone.cid) || '');
  const [lang, setLang] = useState(PH.lang()); // v68: the transcript's language for the next call
  useEffect(() => {
    if (preset && preset.err) setErr(preset.err);
  }, [preset && preset.err]);
  // the call bar moves aside while the panel is open (wide screens)
  useEffect(() => {
    document.body.classList.add('phpanel-open');
    return () => document.body.classList.remove('phpanel-open');
  }, []);
  const me = Cap.phone || {};
  const dial = async (num, meta) => {
    setErr('');
    const msg = await PH.dial(num || n, { cid, ...(meta || {}) });
    if (msg) setErr(msg);
    else onClose(); // the call bar takes over (mute, keypad, notes, hang up)
  };
  const changeCid = async v => {
    setCid(v);
    try {
      await api('ph_cid', { n: v });
      if (Cap.phone) Cap.phone.cid = v;
    } catch (e) {
      setErr(errText(e));
    }
  };
  // v77.1: only Twilio registers a browser device for inbound calls. VitelGlobal and
  // other REST providers are server-side/outbound providers, so waiting for PH.reg made
  // the panel say "Connecting…" forever even though the provider was already ready.
  const browserProvider = !me.provider || me.provider === 'twilio';
  const providerName = me.providerLabel || (me.provider === 'vitel' ? 'VitelGlobal' : me.provider === 'custom' ? 'Phone provider' : 'Twilio');
  const status = S.st === 'loading'
    ? 'Starting the phone…'
    : S.st === 'error'
      ? S.err
      : !me.on
        ? 'Not set up yet'
        : !browserProvider
          ? providerName + ' ready'
          : me.avail
            ? (S.reg ? 'Taking calls' : 'Connecting…')
            : 'Not taking calls';
  if (me.mine === false) return html`<${PhoneSteps} me=${me} onClose=${onClose} />`;
  return html`<div className="askai phonepanel" role="dialog" aria-label="Phone">
      <div className="askai-head">
        <div style=${{ minWidth: 0 }}><b className="askai-title"><${Icon} n="phone" /> Phone</b><div className="muted small">${status}</div></div>
        <div className="actions">
          <a className="btn ghost sm" href=${href} onClick=${onClose}>Calls & texts</a>
          <button type="button" className="btn ghost icon sm" aria-label="Close" onClick=${onClose}><${Icon} n="x" /></button>
        </div>
      </div>
      <div className="tabs phtabs" role="tablist">
        ${[['dial', 'Dial'], ['recent', 'Recent' + (S.unseen.calls ? ' (' + S.unseen.calls + ')' : '')], ['texts', 'Texts' + (S.unseen.texts ? ' (' + S.unseen.texts + ')' : '')]].map(([k, l]) => html`<button key=${k} type="button" role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${l}</button>`)}
      </div>
      <div className="askai-body phbody">
        ${
          !me.on &&
          html`<div className="note amber phsetup" role="note"><span><b>Calls and texts can't be made yet.</b> ${PH_WHY[me.why] || 'The phone is not set up yet.'} ${me.admin ? 'Finish it under Phone setup.' : 'Ask an administrator to finish Admin › System › Phone setup.'}</span>${me.admin && html`<div className="actions"><a className="btn sm" href="#/portal/admin/phone" onClick=${onClose}><${Icon} n="phone" />Open Phone setup</a></div>`}</div>`
        }
        ${
          tab === 'dial' &&
          html`<div className="phdial">
            <input type="tel" className="phnum" value=${n} placeholder="Number to call" aria-label="Number to call" onInput=${e => setN(e.target.value)} onKeyDown=${e => e.key === 'Enter' && dial()} autoFocus />
            <${PhoneKeys} onKey=${k => setN(v => v + k)} />
            ${
              (me.nums || []).length > 1 &&
              html`<${Field} label="Call from"><select value=${cid} onChange=${e => changeCid(e.target.value)}>${me.nums.map(x => html`<option key=${x.n} value=${x.n}>${(x.own ? 'Your line · ' : '') + (x.l ? x.l + ' · ' : '') + phFmt(x.n)}</option>`)}</select><//>`
            }
            ${me.tx && me.recOut && html`<${Field} label="Transcribe in"><select value=${lang} onChange=${e => setLang(PH.lang(e.target.value))} aria-label="Transcript language"><option value="">${seSpeechLangName(me.lang)} (default)</option>${SE_SPEECH_LANGS.map(([k, l]) => html`<option key=${k} value=${k}>${l}</option>`)}</select><//>`}
            ${err && html`<div className="note red" role="alert"><span>${err}</span></div>`}
            <div className="actions phdial-go">
              <button type="button" className="btn ghost" onClick=${() => setN(v => (v.trim().startsWith('+') ? v : '+' + v.trim()))} aria-label="Add + (international number)" title="Add + for a country code">+</button>
              <button type="button" className="btn go" disabled=${!me.on || (S.call && S.call.st !== 'ended')} onClick=${() => dial()}><${Icon} n="phone" />Call</button>
              ${n && html`<button type="button" className="btn ghost" onClick=${() => setN(n.slice(0, -1))} aria-label="Delete the last digit">⌫</button>`}
            </div>
            ${browserProvider ? html`<label className="check phavail"><input type="checkbox" checked=${!!me.avail} disabled=${!me.on} onChange=${e => PH.avail(e.target.checked)} /><span>Take incoming calls on this device</span></label>` : html`<p className="muted small" style=${{ margin: 0 }}>${providerName} uses the configured extension/phone for calls; the browser does not register as an inbound phone.</p>`}
            ${me.e911 !== 'allow' && html`<p className="muted small" style=${{ margin: 0 }}>Emergency numbers (911) cannot be called from the portal: use a mobile phone or a desk phone.</p>`}
          </div>`
        }
        ${tab === 'recent' && html`<${PhoneRecent} onOpen=${c => { onClose(); location.hash = href + '?c=' + c.id; }} onCall=${(num, meta) => { setTab('dial'); setN(num); dial(num, meta); }} />`}
        ${tab === 'texts' && html`<${PhoneTexts} compact start=${preset && preset.act === 'text' ? preset : null} />`}
      </div>
    </div>`;
}
/* v39.1: an administrator who has not got the phone yet: what is left to set up, and the phone for themselves */
function PhoneSteps({ me, onClose }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const acct = me.why !== 'account' && me.why !== 'keys';
  const num = acct && me.why !== 'number' && me.why !== 'nonum';
  const pName = me.providerLabel || (me.provider === 'vitel' ? 'VitelGlobal' : me.provider === 'custom' ? 'phone provider' : 'Twilio');
  const isTwilio = !me.provider || me.provider === 'twilio';
  const giveMe = async () => {
    setBusy(true);
    setErr('');
    try {
      await api('ph_grant', { uid: Cap.uid, on: true });
      await reloadCaps();
      PH.emit();
      window.dispatchEvent(new CustomEvent('se-phone-grant')); // Phone setup, if open, shows it
    } catch (e) {
      setErr(errText(e));
    }
    setBusy(false);
  };
  const step = (i, done, b, sub) =>
    html`<li className=${done ? 'done' : ''}><span className="phstep-n" aria-hidden="true">${done ? html`<${Icon} n="check" />` : i}</span><span className="phstep-t"><b>${b}</b><span className="muted small">${sub}</span></span>${done && html`<${Chip} s="ok">Done<//>`}</li>`;
  return html`<div className="askai phonepanel" role="dialog" aria-label="Phone">
      <div className="askai-head">
        <div style=${{ minWidth: 0 }}><b className="askai-title"><${Icon} n="phone" /> Phone</b><div className="muted small">Not switched on for you yet</div></div>
        <div className="actions"><button type="button" className="btn ghost icon sm" aria-label="Close" onClick=${onClose}><${Icon} n="x" /></button></div>
      </div>
      <div className="askai-body phbody">
        <div className="phsteps">
          <p className="small" style=${{ margin: 0 }}>Calls and texts use <b>${pName}</b>. Three steps, all under <b>Admin › System › Phone setup</b>:</p>
          <ol>
            ${step(1, acct, isTwilio ? "Connect the company's Twilio account" : 'Connect ' + pName, isTwilio ? (me.why === 'keys' ? 'Connected, but a key is missing: enter the Auth Token and the API key secret again, then Connect.' : 'Save the Twilio Account SID, Auth Token and API key, then Connect.') : 'Save the provider account credentials in Phone setup. Secrets stay encrypted on the server.')}
            ${step(2, num, isTwilio ? 'Set up a company number' : 'Set the calling/texting number', isTwilio ? 'Switch on a Twilio number that can make calls and texts.' : 'Save the provider extension/source number required for outbound calls and texts.')}
            ${step(3, false, 'Give the phone to people', 'Administrators are not included automatically, so give it to yourself too.')}
          </ol>
          ${err && html`<div className="note red" role="alert"><span>${err}</span></div>`}
          <div className="actions">
            <button type="button" className="btn go" disabled=${busy} onClick=${giveMe}><${Icon} n="phone" />${busy ? 'Switching it on…' : 'Give me the phone'}</button>
            <a className="btn" href="#/portal/admin/phone" onClick=${onClose}>Open Phone setup</a>
          </div>
        </div>
      </div>
    </div>`;
}
function PhoneRecent({ onOpen, onCall }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    api('ph_calls', {}).then(
      r => {
        setD(r.calls.slice(0, 15));
        api('ph_seen', { k: 'calls' }).then(() => PH.refresh(), () => {});
      },
      setErr
    );
  }, []);
  if (err) return html`<${LoadError} error=${err} />`;
  if (!d) return html`<${Spinner} />`;
  if (!d.length) return html`<${Empty} title="No calls yet">Calls you make and take appear here.<//>`;
  return html`<ul className="phlist">${d.map(c => html`<${PhoneCallRow} key=${c.id} c=${c} onCall=${onCall} onOpen=${onOpen} />`)}</ul>`;
}
function PhoneCallRow({ c, onCall, onOpen }) {
  const st = PH_ST[c.st] || [c.st, ''];
  const name = phName(c.names, '');
  return html`<li className=${'phrow st-' + c.st}>
      <span className=${'phrow-ico' + (c.st === 'missed' || c.st === 'voicemail' ? ' miss' : '')} aria-hidden="true"><${Icon} n=${c.vm ? 'voicemail' : c.dir === 'in' ? 'callin' : 'callout'} /></span>
      <button type="button" className="phrow-main" onClick=${() => onOpen(c)}>
        <b>${name || phFmt(c.other)}</b>
        <span className="muted small">${[name ? phFmt(c.other) : '', fmtTs(c.at), c.secs ? phDur(c.secs) : '', c.who && c.dir === 'in' ? 'taken by ' + c.who : ''].filter(Boolean).join(' · ')}</span>
      </button>
      ${st[0] && html`<${Chip} s=${st[1]}>${st[0]}<//>`}
      ${c.rec && html`<span className="phrec-mark" title="Recorded" aria-label="Recorded"><${Icon} n="mic" /></span>`}
      ${c.other && !c.em && html`<button type="button" className="btn ghost icon sm" title=${'Call ' + (name || phFmt(c.other))} aria-label=${'Call ' + (name || phFmt(c.other))} onClick=${() => onCall(c.other, { name, ref: c.ref })}><${Icon} n="phone" /></button>`}
    </li>`;
}
/* ---- texts: conversations by number, and one conversation ---- */
function PhoneTexts({ compact, start, all }) {
  const toast = useToast();
  const [th, setTh] = useState(null);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(start && start.n ? { od: String(start.n).replace(/\D+/g, '').slice(-10), other: start.n, name: start.name || '', ref: start.ref || '', fresh: true } : null);
  const [neu, setNeu] = useState('');
  const load = () => api('ph_threads', { all: !!all }).then(r => setTh(r.threads), setErr);
  useEffect(() => {
    load();
    api('ph_seen', { k: 'texts' }).then(() => PH.refresh(), () => {});
  }, []);
  if (open) return html`<${PhoneThread} t=${open} compact=${compact} all=${all} onBack=${() => { setOpen(null); load(); }} />`;
  if (err) return html`<${LoadError} error=${err} onRetry=${load} />`;
  if (!th) return html`<${Spinner} />`;
  return html`<div className="stack" style=${{ gap: 10 }}>
      <div className="phnew">
        <input type="tel" value=${neu} placeholder="Text a number" aria-label="Text a number" onInput=${e => setNeu(e.target.value)} onKeyDown=${e => e.key === 'Enter' && neu.trim() && setOpen({ od: neu.replace(/\D+/g, '').slice(-10), other: neu.trim(), name: '', fresh: true })} />
        <button type="button" className="btn sm" disabled=${!neu.trim()} onClick=${() => setOpen({ od: neu.replace(/\D+/g, '').slice(-10), other: neu.trim(), name: '', fresh: true })}>New text</button>
      </div>
      ${
        th.length
          ? html`<ul className="phlist">${th.map(
              t => html`<li key=${t.od} className="phrow">
                <span className="phrow-ico" aria-hidden="true"><${Icon} n="sms" /></span>
                <button type="button" className="phrow-main" onClick=${() => setOpen({ ...t, name: phName(t.names, '') })}>
                  <b>${phName(t.names, phFmt(t.other))}${t.unread ? html` <span className="badge">${t.unread}</span>` : null}</b>
                  <span className="muted small">${(t.dir === 'out' ? 'You: ' : '') + t.last}</span>
                </button>
                <span className="muted small nw">${fmtTs(t.at)}</span>
              </li>`
            )}</ul>`
          : html`<${Empty} title="No texts yet">Texts to and from the company numbers appear here.<//>`
      }
    </div>`;
}
function PhoneThread({ t, compact, onBack, all }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef(null);
  const load = () => api('ph_thread', { od: t.od, all: !!all }).then(setD, e => setD({ msgs: [], names: [], optout: false, err: errText(e) }));
  useEffect(() => {
    load();
    const iv = setInterval(() => document.visibilityState === 'visible' && load(), 15000);
    return () => clearInterval(iv);
  }, [t.od]);
  useEffect(() => {
    if (end.current) end.current.scrollIntoView({ block: 'end' });
  }, [d && d.msgs.length]);
  const send = async () => {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await api('ph_sms_send', { to: t.other, body, ref: t.ref || '', from: t.num || (Cap.phone && Cap.phone.cid) || '' });
      setBody('');
      load();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const name = (d && phName(d.names, '')) || t.name || '';
  const nums = ((Cap.phone && Cap.phone.nums) || []).filter(x => x.sms);
  return html`<div className=${'phthread' + (compact ? ' compact' : '')}>
      <div className="phthread-head">
        ${onBack && html`<button type="button" className="btn ghost icon sm" aria-label="Back" onClick=${onBack}><${Icon} n="left" /></button>`}
        <div style=${{ minWidth: 0, flex: 1 }}><b>${name || phFmt(t.other)}</b>${name && html`<div className="muted small">${phFmt(t.other)}</div>`}</div>
        <button type="button" className="btn ghost icon sm" title="Call" aria-label="Call" onClick=${() => phCall(t.other, { name, ref: t.ref })}><${Icon} n="phone" /></button>
      </div>
      <div className="phmsgs">
        ${!d ? html`<${Spinner} />` : d.msgs.length ? d.msgs.map(m => html`<div key=${m.id} className=${'phmsg ' + m.dir}><div className="phmsg-b">${m.body}</div><div className="muted small">${fmtTs(m.at)}${m.dir === 'out' ? ' · ' + (m.st === 'delivered' ? 'Delivered' : m.st === 'failed' || m.st === 'undelivered' ? 'Not delivered' + (m.err ? ' (' + m.err + ')' : '') : 'Sent') + (m.who ? ' by ' + m.who : '') : ''}</div></div>`) : html`<p className="muted small">${d.err || 'No texts with this number yet.'}</p>`}
        <div ref=${end} />
      </div>
      ${d && d.optout && html`<div className="note amber"><span>This person replied STOP: texts cannot be sent until they reply START.</span></div>`}
      ${!nums.length && html`<p className="muted small">No company number sends texts yet (Admin › Phone setup).</p>`}
      <div className="phcompose">
        <textarea rows="2" value=${body} maxLength="1600" placeholder="Write a text" aria-label="Write a text" disabled=${!nums.length || (d && d.optout)} onInput=${e => setBody(e.target.value)} onKeyDown=${e => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && send()} />
        <button type="button" className="btn" disabled=${busy || !body.trim() || !nums.length || (d && d.optout)} onClick=${send}><${Icon} n="send" />${busy ? 'Sending…' : 'Send'}</button>
      </div>
    </div>`;
}

/* ---- on records: a phone number to call or text, and the record's calls and texts ---- */
function CallLink({ n, ref, name }) {
  if (!n) return null;
  if (!phMine())
    return html`<a href=${'tel:' + String(n).replace(/[^\d+]/g, '')} className="phlink" onClick=${e => e.stopPropagation()}>${n}</a>`;
  return html`<span className="phlink-wrap">
      <button type="button" className="phlink" title=${'Call ' + (name || n)} onClick=${e => { e.stopPropagation(); phCall(n, { ref, name }); }}><${Icon} n="phone" />${n}</button>
      <button type="button" className="phlink-sms" title=${'Text ' + (name || n)} aria-label=${'Text ' + (name || n)} onClick=${e => { e.stopPropagation(); phText(n, { ref, name }); }}><${Icon} n="sms" /></button>
    </span>`;
}
function PhoneHistory({ phones, refId, name }) {
  const list = (phones || []).filter(Boolean);
  const [d, setD] = useState(null);
  const [play, setPlay] = useState(null);
  useEffect(() => {
    if (!phMine() || (!list.length && !refId)) return;
    api('ph_hist', { phones: list, ref: refId || '' }).then(setD, () => setD({ calls: [], msgs: [] }));
  }, [list.join('|'), refId]);
  if (!phMine() || (!list.length && !refId)) return null;
  const items = d ? [...d.calls.map(c => ({ ...c, k: 'call' })), ...d.msgs.map(m => ({ ...m, k: 'msg' }))].sort((a, b) => b.at - a.at).slice(0, 12) : [];
  return html`<div className="phhist">
      <div className="ph-row"><b>Calls & texts</b>${list[0] && html`<div className="actions"><button type="button" className="btn ghost sm" onClick=${() => phCall(list[0], { ref: refId, name })}><${Icon} n="phone" />Call</button><button type="button" className="btn ghost sm" onClick=${() => phText(list[0], { ref: refId, name })}><${Icon} n="sms" />Text</button></div>`}</div>
      ${
        !d
          ? html`<${Spinner} />`
          : items.length
            ? html`<ul className="phlist small">${items.map(x =>
                x.k === 'call'
                  ? html`<li key=${'c' + x.id} className=${'phrow st-' + x.st}><span className=${'phrow-ico' + (x.st === 'missed' ? ' miss' : '')}><${Icon} n=${x.vm ? 'voicemail' : x.dir === 'in' ? 'callin' : 'callout'} /></span><span className="phrow-main"><b>${x.vm ? 'Voicemail' : x.dir === 'in' ? 'Call in' : 'Call out'}${x.st !== 'done' && PH_ST[x.st] && PH_ST[x.st][0] ? ' · ' + PH_ST[x.st][0] : ''}</b><span className="muted">${[fmtTs(x.at), x.secs ? phDur(x.secs) : '', x.who].filter(Boolean).join(' · ')}${x.note ? ' — ' + x.note : ''}</span></span>${x.rec && html`<button type="button" className="btn ghost sm" onClick=${() => setPlay(play === x.id ? null : x.id)}>${play === x.id ? 'Hide' : 'Listen'}</button>`}${play === x.id && html`<audio className="phaudio" controls autoPlay src=${API + 'ph_rec&id=' + encodeURIComponent(x.id)} />`}</li>`
                  : html`<li key=${'m' + x.id} className="phrow"><span className="phrow-ico"><${Icon} n="sms" /></span><span className="phrow-main"><b>${x.dir === 'in' ? 'Text in' : 'Text out'}</b><span className="muted">${fmtTs(x.at)} — ${x.body.slice(0, 140)}</span></span></li>`
              )}</ul>`
            : html`<p className="muted small" style=${{ margin: '4px 0 0' }}>No calls or texts with ${list.length > 1 ? 'these numbers' : 'this number'} yet.</p>`
      }
    </div>`;
}

/* ---- the Calls & texts page ---- */
function CallsPage({ q }) {
  const [tab, setTab] = useState(q && q.tab === 'texts' ? 'texts' : 'calls');
  const [f, setF] = useState((q && q.f) || 'all');
  const [all, setAll] = useState(false);
  const [allTx, setAllTx] = useState(false); // v39.2: administrators: someone else's personal line too
  const [qq, setQq] = useState('');
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState((q && q.c) || null);
  const [pg, setPg] = useState(1);
  const load = () =>
    api('ph_calls', { f, all, q: qq, pg }).then(
      r => {
        setD(r);
        setErr(null);
      },
      setErr
    );
  useEffect(() => {
    if (tab !== 'calls' || !phMine()) return;
    const t = setTimeout(load, qq ? 300 : 0);
    return () => clearTimeout(t);
  }, [tab, f, all, qq, pg]);
  useEffect(() => {
    if (phMine()) api('ph_seen', { k: 'calls' }).then(() => PH.refresh(), () => {});
  }, []);
  useEffect(() => {
    if (q && q.c) setOpen(q.c);
  }, [q && q.c]);
  if (!phMine()) return html`<${NoAccess} title="The phone is not switched on for you" why="An administrator can switch on Phone & texts for you under Roles & access." />`;
  const href = location.hash.split('?')[0];
  return html`<div className="stack phpage">
      ${!Cap.phone.on && html`<div className="note amber"><span><b>The phone is not set up yet.</b> ${PH_WHY[Cap.phone.why] || ''} ${Cap.phone.admin ? 'Finish it under Phone setup.' : 'An administrator finishes it under Admin › System › Phone setup.'}</span>${Cap.phone.admin && html`<div className="actions"><a className="btn sm" href="#/portal/admin/phone">Open Phone setup</a></div>`}</div>`}
      <div className="toolbar">
        <div className="seg" role="tablist">${[['calls', 'Calls'], ['texts', 'Texts']].map(([k, l]) => html`<button key=${k} type="button" role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${l}</button>`)}</div>
        ${
          tab === 'calls' &&
          html`<${Fragment}>
            <input type="search" className="phfind" placeholder="Name or number" value=${qq} onInput=${e => { setQq(e.target.value); setPg(1); }} aria-label="Find a call" />
            ${Cap.phone.admin && html`<label className="check small"><input type="checkbox" checked=${all} onChange=${e => setAll(e.target.checked)} /><span>Everyone's calls</span></label>`}
          <//>`
        }
        ${tab === 'calls' && html`<div className="push"><button type="button" className="btn go" onClick=${() => phCall('', {})}><${Icon} n="phone" />Call</button></div>`}
      </div>
      ${
        tab === 'calls' &&
        html`<div className="chips phfilters" role="tablist" aria-label="Show">${[['all', 'All'], ['missed', 'Missed'], ['vm', 'Voicemail'], ['in', 'Incoming'], ['out', 'Outgoing'], ['rec', 'Recorded']].map(([k, l]) => html`<button key=${k} type="button" role="tab" aria-selected=${f === k} className=${'chipbtn' + (f === k ? ' on' : '')} onClick=${() => { setF(k); setPg(1); }}>${l}</button>`)}</div>`
      }
      ${
        tab === 'texts'
          ? html`<section className="panel">${Cap.phone.admin && html`<label className="check small phalltx"><input type="checkbox" checked=${allTx} onChange=${e => setAllTx(e.target.checked)} /><span>Everyone's texts (personal lines too)</span></label>`}<${PhoneTexts} key=${allTx ? 'all' : 'mine'} all=${allTx} /></section>`
          : err
            ? html`<${LoadError} error=${err} onRetry=${load} />`
            : !d
              ? html`<${Spinner} />`
              : html`<section className="panel" style=${{ padding: '8px 10px' }}>
                  ${d.calls.length ? html`<ul className="phlist big">${d.calls.map(c => html`<${PhoneCallRow} key=${c.id} c=${c} href=${href} onOpen=${x => setOpen(x.id)} onCall=${(n, meta) => phCall(n, meta)} />`)}</ul>` : html`<${Empty} title="No calls here">${f === 'all' ? 'Calls you make and take appear here, with their recordings, transcripts and notes.' : 'Choose another view.'}<//>`}
                  ${(d.more || pg > 1) && html`<div className="actions" style=${{ justifyContent: 'center', marginTop: 8 }}><button type="button" className="btn ghost sm" disabled=${pg <= 1} onClick=${() => setPg(pg - 1)}>Newer</button><button type="button" className="btn ghost sm" disabled=${!d.more} onClick=${() => setPg(pg + 1)}>Older</button></div>`}
                </section>`
      }
      ${open && html`<${CallDetail} id=${open} onClose=${() => { setOpen(null); if (q && q.c) location.hash = href; }} onChanged=${load} />`}
    </div>`;
}
function CallDetail({ id, onClose, onChanged }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const load = () =>
    api('ph_call', { id }, { timeout: 90000 }).then(
      r => {
        setD(r);
        setNote(r.call.note || '');
      },
      setErr
    );
  useEffect(() => {
    load();
  }, [id]);
  const c = d && d.call;
  const name = c ? phName(c.names, '') : '';
  const saveNote = async () => {
    setBusy('note');
    try {
      await api('ph_note', { id, note });
      toast('Note saved.');
      onChanged && onChanged();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const summarize = async () => {
    setBusy('sum');
    try {
      const r = await api('ph_summary', { id }, { timeout: 120000 });
      setD({ ...d, call: r.call });
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const delRec = async () => {
    if (!confirm('Delete this recording? It is removed from Twilio and cannot be played again. The transcript and notes stay.')) return;
    setBusy('del');
    try {
      await api('ph_rec_del', { id });
      toast('Recording deleted.');
      load();
      onChanged && onChanged();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const who = w => (w === 'staff' ? c.who || 'You' : w === 'greeting' ? 'Greeting' : name || 'Caller');
  return html`<${Modal} wide title=${c ? (c.vm ? 'Voicemail from ' : c.dir === 'in' ? 'Call from ' : 'Call to ') + (name || phFmt(c.other)) : 'Call'} onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Close</button>${c && c.other && !c.em && html`<button type="button" className="btn ghost" onClick=${() => phText(c.other, { name, ref: c.ref })}><${Icon} n="sms" />Text</button><button type="button" className="btn go" onClick=${() => { onClose(); phCall(c.other, { name, ref: c.ref }); }}><${Icon} n="phone" />Call back</button>`}`}>
      ${
        err
          ? html`<${LoadError} error=${err} onRetry=${load} />`
          : !c
            ? html`<${Spinner} />`
            : html`<div className="stack" style=${{ gap: 14 }}>
              <div className="phdetail-head">
                <div><b>${name || phFmt(c.other)}</b><div className="muted small">${[name ? phFmt(c.other) : '', ...c.names.slice(0, 2).map(x => x[3] || PH_KIND[x[0]] || '')].filter(Boolean).join(' · ')}</div></div>
                <div className="muted small r">${fmtTs(c.at)}<br />${[c.dir === 'in' ? 'Incoming to ' + phFmt(c.num) : 'From ' + phFmt(c.num), c.secs ? phDur(c.secs) : '', c.who ? (c.dir === 'in' ? 'taken by ' : 'by ') + c.who : ''].filter(Boolean).join(' · ')}${PH_ST[c.st] && PH_ST[c.st][0] ? html` <${Chip} s=${PH_ST[c.st][1]}>${PH_ST[c.st][0]}<//>` : null}</div>
              </div>
              ${
                c.rec &&
                html`<div className="phrec"><audio controls preload="none" src=${API + 'ph_rec&id=' + encodeURIComponent(c.id)} />${(Cap.phone.admin || c.uid === Cap.uid) && html`<button type="button" className="btn ghost sm" disabled=${busy === 'del'} onClick=${delRec}><${Icon} n="trash" />Delete the recording</button>`}</div>`
              }
              ${
                c.sum
                  ? html`<div className="phsum"><b>Summary</b><p>${c.sum.s}</p>${c.sum.next && c.sum.next.length > 0 && html`<${Fragment}><b>Next steps</b><ul>${c.sum.next.map((x, i) => html`<li key=${i}>${x}</li>`)}</ul><//>`}${Object.keys(c.sum.facts || {}).length > 0 && html`<dl>${Object.entries(c.sum.facts).map(([k, v]) => html`<${Fragment} key=${k}><dt>${k}</dt><dd>${v}</dd><//>`)}</dl>`}</div>`
                  : c.hasTx && d.ai && html`<div className="actions"><button type="button" className="btn ghost sm" disabled=${busy === 'sum'} onClick=${summarize}>${busy === 'sum' ? 'Writing the summary…' : 'Write the summary with AI'}</button></div>`
              }
              ${
                c.tx && c.tx.length > 0 &&
                html`<details className="phtx" open=${!c.sum}><summary><b>Transcript</b> <span className="muted small">(${c.tx.length} parts)</span></summary><div className="phtx-body">${c.tx.map((s, i) => html`<p key=${i} className=${'phtx-' + (s.w === 'staff' ? 'me' : s.w === 'greeting' ? 'greet' : 'them')}><span className="lbl">${who(s.w)}</span> ${s.s}${s.l && (i === 0 || (c.tx[i - 1].l || '') !== s.l) ? html` <span className="chip phlang" title="The language of this part">${seLangLabel(s.l)}</span>` : ''}</p>`)}</div></details>`
              }
              <${Field} label="Notes"><textarea rows="3" value=${note} onInput=${e => setNote(e.target.value)} /><//>
              <div className="actions"><button type="button" className="btn sm" disabled=${busy === 'note' || note === (c.note || '')} onClick=${saveNote}>Save the note</button></div>
            </div>`
      }
    <//>`;
}
