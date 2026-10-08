/* ================= v35: Practice calls and voice drills (Grow > Practice calls) =================
   A practice phone call with a recruiter, a technical lead or a hiring manager (made-up people and firms): the caller's
   lines are spoken with the browser's speech synthesis and the consultant answers out loud (the browser's speech
   recognition turns the voice into text) or by typing. The server (api/practice.php) asks the questions, follows up
   when a key point is missing, and scores every answer; the report shows what went well, what to work on and an
   example of a strong answer for each question. Voice drills: listen and repeat, and spoken flashcards per skill.
   Only words are saved, never audio. Administrators, HR and managers see the practice in Practice & training. */
Object.assign(IP, {
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7',
  speaker: 'M11 5 6 9H3v6h3l5 4zM15.5 8.8a4.5 4.5 0 0 1 0 6.4M18.4 6a8.5 8.5 0 0 1 0 12',
  stopsq: 'M7 7h10v10H7z',
});
const PR_LEVELS = [
  ['friendly', 'Friendly', 'A patient caller; no follow-up questions'],
  ['typical', 'Typical', 'Follow-up questions when a key point is missing'],
  ['tough', 'Tough', 'A skeptical caller who asks for specifics'],
];
const PR_DIM_NAMES = { clarity: 'Clarity', content: 'Content', confidence: 'Confidence', technical: 'Technical', handling: 'Call handling' };
const PR_DIM_HELP = {
  clarity: 'Filler words, speaking pace and answer length',
  content: 'The key points each answer covers',
  confidence: 'Stating facts without “I think”, “maybe” or “I don’t know”',
  technical: 'The key points of the technical answers',
  handling: 'A clear rate and start date, questions asked, a polite close',
};
const prTone = n => (n == null ? '' : n >= 75 ? 'ok' : n >= 55 ? 'amber' : 'red');
const prDur = s => (s >= 60 ? Math.floor(s / 60) + ' min' + (s % 60 >= 30 ? ' 30 s' : '') : Math.max(1, Math.round(s || 0)) + ' s');

/* ---- speech: the browser speaks the caller's lines and turns the person's voice into text ---- */
const prRecognizer = () => window.SpeechRecognition || window.webkitSpeechRecognition || null;
const prSynth = () => (typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance !== 'undefined' ? window.speechSynthesis : null);
const prVoiceList = lang => {
  const s = prSynth();
  const want = String(seSpeechLang(lang || prPrefsLoad().lang) || 'en-US').slice(0, 2).toLowerCase();
  try {
    const all = s ? s.getVoices() : [];
    const mine = all.filter(v => String(v.lang || '').slice(0, 2).toLowerCase() === want);
    return mine.length ? mine : all.filter(v => /^en([-_]|$)/i.test(v.lang));
  } catch (e) {
    return [];
  }
};
const PR_PREFS_KEY = 'se.practice';
const prPrefsLoad = () => {
  const d = { voice: '', rate: 1, hands: false, typing: false, mute: false, lang: 'en-US' }; // v68: lang
  try {
    return { ...d, ...JSON.parse(localStorage.getItem(PR_PREFS_KEY) || '{}') };
  } catch (e) {
    return d;
  }
};
const prPrefsSave = p => {
  try {
    localStorage.setItem(PR_PREFS_KEY, JSON.stringify(p));
  } catch (e) {}
};
let prSpeakSeq = 0;
let prSpeakFin = null;
/** Speaks a line (sentence by sentence, so long lines are not cut off); resolves when it is done or stopped. */
function prSpeak(text, o) {
  const s = prSynth();
  const t = String(text || '')
    .replace(/\[([^\]]+)\]/g, '$1')
    .trim();
  if (!s || !t || (o && o.mute)) return Promise.resolve(false);
  const my = ++prSpeakSeq;
  const rate = Math.min(1.5, Math.max(0.6, +((o && o.rate) || 1)));
  const parts = t.match(/[^.!?]+[.!?]*\s*/g) || [t];
  const want = seSpeechLang((o && o.lang) || 'en-US');
  const vs = prVoiceList(want);
  const sameLang = x => String(x.lang || '').replace('_', '-').toLowerCase() === want.toLowerCase();
  const v = (o && o.voice && vs.find(x => x.name === o.voice)) || vs.find(x => sameLang(x) && x.localService) || vs.find(sameLang) || vs[0];
  if (prSpeakFin) prSpeakFin(false);
  try {
    s.cancel();
  } catch (e) {}
  return new Promise(res => {
    let done = false;
    const fin = ok => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (prSpeakFin === fin) prSpeakFin = null;
      res(ok && my === prSpeakSeq);
    };
    prSpeakFin = fin;
    // some browsers never say "done": carry on after the time the line should take
    const timer = setTimeout(() => fin(true), 3000 + (t.split(/\s+/).length * 650) / rate);
    parts.forEach((p, i) => {
      const u = new SpeechSynthesisUtterance(p.trim());
      if (v) {
        u.voice = v;
        u.lang = v.lang;
      } else u.lang = want;
      u.rate = rate;
      if (i === parts.length - 1) u.onend = () => fin(true);
      u.onerror = e => (e && e.error === 'interrupted' ? fin(false) : i === parts.length - 1 && fin(true));
      try {
        s.speak(u);
      } catch (e) {
        fin(false);
      }
    });
  });
}
const prHush = () => {
  prSpeakSeq++;
  if (prSpeakFin) prSpeakFin(false);
  const s = prSynth();
  try {
    if (s) s.cancel();
  } catch (e) {}
};
const prMicError = code =>
  ({
    'not-allowed': 'The browser blocked the microphone. Allow it for this site (the microphone icon in the address bar), or answer by typing.',
    'service-not-allowed': 'The browser’s speech service is switched off. Answer by typing, or try Chrome or Edge.',
    'audio-capture': 'No microphone was found. Connect one, or answer by typing.',
    network: 'The browser’s speech service could not be reached. Check the connection, or answer by typing.',
    'language-not-supported': 'This browser cannot recognise speech in the language chosen under Voice and answering. Pick another, or answer by typing.',
  })[code] || 'Speech recognition stopped (' + code + '). Try again, or answer by typing.';
/** The microphone: start() listens until stop() (or a pause, in hands-free mode); the words arrive as they are said. */
function usePrMic(onPause, lang = 'en-US') {
  const SR = prRecognizer();
  const [st, setSt] = useState({ on: false, text: '', interim: '', err: '' });
  const r = useRef({ rec: null, want: false, final: '', interim: '', t0: 0, tLast: 0, timer: null, waiters: [], gen: 0 });
  const pauseRef = useRef(onPause);
  pauseRef.current = onPause;
  const result = () => {
    const x = r.current;
    const text = (x.final + ' ' + x.interim).replace(/\s+/g, ' ').trim();
    return { text, secs: x.t0 ? Math.max(1, Math.round((x.tLast - x.t0) / 1000)) : 0 };
  };
  const settle = () => {
    const x = r.current;
    const w = x.waiters;
    x.waiters = [];
    const res = result();
    w.forEach(f => f(res));
  };
  useEffect(
    () => () => {
      const x = r.current;
      x.want = false;
      clearTimeout(x.timer);
      try {
        if (x.rec) x.rec.abort();
      } catch (e) {}
    },
    []
  );
  const begin = () => {
    const x = r.current;
    const rec = new SR();
    rec.lang = seSpeechLang(prPrefsLoad().lang); // v68: the language chosen under Voice and answering
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const one = e.results[i];
        if (one.isFinal) x.final = (x.final + ' ' + one[0].transcript).trim();
        else interim += ' ' + one[0].transcript;
      }
      x.interim = interim.trim();
      const now = Date.now();
      if (!x.t0) x.t0 = now - 800;
      x.tLast = now;
      setSt(s => ({ ...s, text: x.final, interim: x.interim }));
      clearTimeout(x.timer);
      if (pauseRef.current && x.want)
        x.timer = setTimeout(() => {
          if (x.want && (x.final || x.interim)) stop().then(res => pauseRef.current && pauseRef.current(res));
        }, 2600);
    };
    rec.onerror = e => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      x.want = false;
      setSt(s => ({ ...s, on: false, err: prMicError(e.error) }));
    };
    rec.onend = () => {
      if (x.want) {
        // the browser ends a recognition after a silence or a minute: carry on until the person says they are done
        try {
          begin();
          return;
        } catch (err) {
          x.want = false;
        }
      }
      x.rec = null;
      setSt(s => ({ ...s, on: false, interim: '' }));
      settle();
    };
    x.rec = rec;
    rec.start();
  };
  const start = () => {
    if (!SR) return false;
    const x = r.current;
    prHush();
    x.gen++;
    x.want = true;
    x.final = '';
    x.interim = '';
    x.t0 = 0;
    x.tLast = 0;
    setSt({ on: true, text: '', interim: '', err: '' });
    try {
      begin();
      return true;
    } catch (e) {
      x.want = false;
      setSt({ on: false, text: '', interim: '', err: 'The microphone could not start: ' + (e.message || e) });
      return false;
    }
  };
  const stop = () =>
    new Promise(res => {
      const x = r.current;
      x.want = false;
      clearTimeout(x.timer);
      if (!x.rec) return res(result());
      x.waiters.push(res);
      try {
        x.rec.stop();
      } catch (e) {
        settle();
      }
      // the last words arrive just after stop(); never wait for ever
      const g = ++x.gen;
      setTimeout(() => x.gen === g && settle(), 2500);
    });
  const cancel = () => {
    const x = r.current;
    x.want = false;
    clearTimeout(x.timer);
    x.waiters = [];
    try {
      if (x.rec) x.rec.abort();
    } catch (e) {}
    setSt(s => ({ ...s, on: false, interim: '' }));
  };
  return { ok: !!SR, ...st, start, stop, cancel };
}

/* ---- the page ---- */
function PracticePage({ q }) {
  const P = usePortal();
  const toast = useToast();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState('calls');
  const [view, setView] = useState(null);
  const [prefs, setPrefsState] = useState(prPrefsLoad);
  const [lvl, setLvl] = useState('typical');
  const [skill, setSkill] = useState('');
  const setPrefs = p => {
    setPrefsState(p);
    prPrefsSave(p);
  };
  const load = () => api('pr_home', {}).then(r => (setD(r), setSkill(s => s || r.pack)), setErr);
  useEffect(() => {
    load();
    return prHush;
  }, []);
  const firstQ = useRef(true);
  useEffect(() => {
    // one session has its own address (#/portal/practice?s=<id>); back on the plain address, the list shows again
    if (q && q.s)
      api('pr_get', { id: q.s }).then(
        r => setView({ kind: 'session', s: r.session }),
        e => (toast(errText(e), true), (location.hash = '#' + ((P && P.base) || '/portal') + '/practice'))
      );
    else if (!firstQ.current) {
      setView(v => (v && v.kind === 'session' ? null : v));
      load();
    }
    firstQ.current = false;
  }, [q && q.s]);
  if (err) return html`<${LoadError} error=${err} onRetry=${() => (setErr(null), load())} />`;
  if (!d || (q && q.s && !view)) return html`<${Spinner} />`;
  if (!d.can) return html`<${PlanGate} feature="mentor" />`;
  const back = refresh => {
    prHush();
    setView(null);
    if (refresh) load();
  };
  // a finished call or an opened session has its own address (#/portal/practice?s=<id>): the menu item and the
  // browser's back button lead back to the list
  const home = '#' + ((P && P.base) || '/portal') + '/practice';
  const openSession = id => (location.hash = home + '?s=' + id);
  if (view && view.kind === 'call')
    return html`<${PrCall} start=${view.start} prefs=${prefs} onEnd=${s => (s ? openSession(s.id) : back(true))} onCancel=${() => back(true)} />`;
  if (view && view.kind === 'session')
    return html`<div className="stack">
        <div><a className="btn link sm" href=${home} onClick=${e => q && q.s ? null : (e.preventDefault(), back(false))}><${Icon} n="left" />Practice calls</a></div>
        ${view.s.kind === 'call'
          ? html`<${PrReport} s=${view.s} prefs=${prefs} onAgain=${() => setView({ kind: 'call', start: { scen: view.s.scen, lvl: view.s.lvl, skill: view.s.skill } })} />`
          : html`<${PrDrillView} s=${view.s} prefs=${prefs} />`}
      </div>`;
  if (view && view.kind === 'repeat') return html`<${PrRepeat} set=${view.set} prefs=${prefs} onDone=${() => back(true)} />`;
  if (view && view.kind === 'cards') return html`<${PrCards} skill=${view.skill} prefs=${prefs} onDone=${() => back(true)} />`;
  const st = d.stats;
  const goal = d.goal || 0;
  const SR = prRecognizer();
  const TABS = [
    ['calls', 'Practice calls'],
    ['drills', 'Voice drills'],
    ['progress', 'My progress', d.recent.length || null],
  ];
  return html`<div className="stack prpage">
      <p className="muted small" style=${{ margin: 0, maxWidth: 760 }}>Practise the calls that get you placed: a vendor recruiter’s screening call, a technical screen, a client manager interview, a rate negotiation and visa questions. Answer out loud as on a real call; afterwards you see your scores, what to work on and an example of a strong answer for every question.</p>
      <${KitStats} items=${[
        { v: goal ? st.week + ' of ' + goal : st.week, l: goal ? 'Calls this week (team goal)' : 'Calls this week', tone: goal ? (st.week >= goal ? 'ok' : 'warn') : '' },
        { v: st.avg30 == null ? '—' : st.avg30, l: 'Average call score (30 days)', tone: st.avg30 == null ? '' : st.avg30 >= 75 ? 'ok' : st.avg30 < 55 ? 'warn' : '', onClick: () => setTab('progress') },
        { v: st.minutes30, l: 'Minutes practised (30 days)' },
        { v: st.weak ? PR_DIM_NAMES[st.weak] : '—', l: 'Area to work on', onClick: () => setTab('progress') },
      ]} />
      <${KitTabs} wrap tabs=${TABS} tab=${tab} onTab=${setTab} />
      ${tab === 'calls' &&
      html`<section className="panel stack" style=${{ gap: 14 }}>
          <div className="prchoose">
            <div>
              <span className="muted small">How tough is the caller?</span>
              <div className="actions" role="radiogroup" aria-label="Caller">${PR_LEVELS.map(([k, n, t]) => html`<button key=${k} type="button" role="radio" aria-checked=${lvl === k} title=${t} className=${'btn sm ' + (lvl === k ? '' : 'ghost')} onClick=${() => setLvl(k)}>${n}</button>`)}</div>
            </div>
            <label className="fld" style=${{ margin: 0, minWidth: 220 }}><span>Technical questions about</span><select value=${skill} onChange=${e => setSkill(e.target.value)}>${d.packs.map(p => html`<option key=${p.k} value=${p.k}>${p.n}${p.k === d.pack ? ' (matches your profile)' : ''}</option>`)}</select></label>
          </div>
          <div className="prscen">
            ${d.scenarios.map(
              s => html`<article key=${s.k} className="prscen-card">
                <div className="prscen-top"><span className="prscen-ic"><${Icon} n=${s.k === 'tech' ? 'code' : s.k === 'rate' ? 'money' : s.k === 'visa' ? 'idcard' : s.k === 'client' ? 'brief' : s.k === 'intro' ? 'user' : 'phone'} /></span><div><b>${s.t}</b><span className="muted small">${s.who} · ${s.n} question${s.n === 1 ? '' : 's'} · about ${Math.max(2, Math.round(s.n * 1.2))} min</span></div></div>
                <p className="small">${s.d}</p>
                <button type="button" className="btn sm" onClick=${() => setView({ kind: 'call', start: { scen: s.k, lvl, skill } })}><${Icon} n="phone" />Start the call</button>
              </article>`
            )}
          </div>
          <${PrVoiceSettings} prefs=${prefs} setPrefs=${setPrefs} />
          <p className="muted small" style=${{ margin: 0 }}>${d.ai ? 'The StratEdge AI plays the caller and writes your feedback. ' : ''}Only your words are saved, never audio${SR ? ': the browser’s own speech service turns your voice into text' : ''}. Administrators, HR and your manager can see your practice and scores to help you prepare.</p>
        </section>`}
      ${tab === 'drills' && html`<${PrDrillsTab} d=${d} onRepeat=${set => setView({ kind: 'repeat', set })} onCards=${sk => setView({ kind: 'cards', skill: sk })} prefs=${prefs} setPrefs=${setPrefs} />`}
      ${tab === 'progress' && html`<${PrProgress} d=${d} onOpen=${openSession} />`}
    </div>`;
}
function PrVoiceSettings({ prefs, setPrefs }) {
  const [voices, setVoices] = useState(() => prVoiceList(prefs.lang));
  useEffect(() => {
    const s = prSynth();
    if (!s) return;
    const f = () => setVoices(prVoiceList(prefs.lang));
    f();
    try {
      s.addEventListener('voiceschanged', f);
    } catch (e) {}
    const t = setTimeout(f, 600);
    return () => {
      clearTimeout(t);
      try {
        s.removeEventListener('voiceschanged', f);
      } catch (e) {}
    };
  }, [prefs.lang]);
  const SR = prRecognizer();
  const synth = prSynth();
  const set = (k, v) => setPrefs({ ...prefs, [k]: v });
  return html`<details className="prsettings">
      <summary><${Icon} n="speaker" />Voice and answering${!SR ? ' · typing only in this browser' : prefs.typing ? ' · answering by typing' : prefs.hands ? ' · hands-free' : ''}</summary>
      <div className="form" style=${{ marginTop: 10 }}>
        <${Field} label="Language" hint="You answer in this language (the microphone listens for it and the caller's voice uses it when the browser has one). The practice calls themselves are written in English; StratEdge AI understands your answer in any language and coaches in English.">
          <select value=${prefs.lang || 'en-US'} onChange=${e => setPrefs({ ...prefs, lang: e.target.value, voice: '' })} aria-label="Practice language">${SE_SPEECH_LANGS.filter(x => x[0] !== 'auto').map(([k, l]) => html`<option key=${k} value=${k}>${l}</option>`)}</select>
        <//>
        <div className="row3">
          <${Field} label="Recognition language"><select value=${prefs.lang || 'en-US'} onChange=${e => set('lang', e.target.value)}>${[['en-US','English (US)'],['en-IN','English (India)'],['es-US','Spanish (US)'],['es-ES','Spanish'],['hi-IN','Hindi'],['te-IN','Telugu'],['ta-IN','Tamil'],['fr-FR','French'],['de-DE','German'],['pt-BR','Portuguese'],['zh-CN','Chinese (Mandarin)'],['ja-JP','Japanese'],['ko-KR','Korean'],['ar-SA','Arabic']].map(([v,n]) => html`<option key=${v} value=${v}>${n}</option>`)}</select><//>
          <${Field} label="The caller’s voice">${synth
            ? html`<select value=${prefs.voice} onChange=${e => set('voice', e.target.value)}><option value="">The browser’s ${seSpeechLangName(prefs.lang || 'en-US')} voice</option>${voices.map(v => html`<option key=${v.name} value=${v.name}>${v.name} (${v.lang})</option>`)}</select>`
            : html`<input disabled value="This browser cannot speak: the lines are shown as text" />`}<//>
          <${Field} label="Speed"><select value=${String(prefs.rate)} onChange=${e => set('rate', +e.target.value)}>${[['0.85', 'Slower'], ['1', 'Normal'], ['1.15', 'Faster'], ['1.3', 'Fast']].map(([v, n]) => html`<option key=${v} value=${v}>${n}</option>`)}</select><//>
        </div>
        <div className="actions"><button type="button" className="btn ghost sm" disabled=${!synth} onClick=${() => prSpeak('Hello. This is a voice recognition test.', prefs)}><${Icon} n="speaker" />Hear selected language voice</button></div>
        <label className="check"><input type="checkbox" checked=${!!prefs.mute} onChange=${e => set('mute', e.target.checked)} /> Read the caller’s lines instead of hearing them</label>
        ${SR
          ? html`<label className="check"><input type="checkbox" checked=${!!prefs.typing} onChange=${e => set('typing', e.target.checked)} /> Answer by typing (no microphone)</label>
              <label className="check"><input type="checkbox" checked=${!!prefs.hands && !prefs.typing} disabled=${prefs.typing} onChange=${e => set('hands', e.target.checked)} /> Hands-free: listen as soon as the caller stops, and send my answer after a short pause</label>`
          : html`<p className="note amber small" style=${{ margin: 0 }}><span>This browser cannot turn speech into text, so you answer by typing. For spoken answers use Chrome, Edge or Safari.</span></p>`}
      </div>
    </details>`;
}

/* ---- one practice call ---- */
function PrCall({ start, prefs, onEnd, onCancel }) {
  const toast = useToast();
  const [call, setCall] = useState(null);
  const [lines, setLines] = useState([]);
  const [phase, setPhase] = useState('connecting');
  const [prog, setProg] = useState({ step: 0, of: 1 });
  const [draft, setDraft] = useState('');
  const [took, setTook] = useState({ secs: 0, voice: false });
  const [fail, setFail] = useState(null);
  const [t0] = useState(Date.now());
  const now = useNow(1000);
  const typing = prefs.typing || !prRecognizer();
  const callRef = useRef(null);
  const alive = useRef(true);
  const ending = useRef(false);
  const box = useRef(null);
  const sendRef = useRef(null);
  const mic = usePrMic(prefs.hands && !typing ? res => sendRef.current && sendRef.current(res.text, res.secs, true) : null, prefs.lang);
  useEffect(() => {
    alive.current = true;
    api('pr_start', { ...start, lang: prPrefsLoad().lang || 'en-US' }).then(
      r => {
        if (!alive.current) return;
        callRef.current = r;
        setCall(r);
        setProg({ step: r.step, of: r.of });
        say(r.say, false);
      },
      e => (setFail(errText(e)), setPhase('error'))
    );
    return () => {
      alive.current = false;
      prHush();
    };
  }, []);
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines.length, phase, mic.text, mic.interim]);
  const say = async (text, last) => {
    setLines(l => [...l, { who: 'v', t: text }]);
    setPhase('caller');
    await prSpeak(text, prefs);
    if (!alive.current || ending.current) return;
    if (last) return finish();
    setPhase('answer');
    setDraft('');
    if (prefs.hands && !typing) listen();
  };
  const listen = () => {
    if (mic.start()) setPhase('listening');
  };
  const done = async () => {
    const res = await mic.stop();
    if (!alive.current) return;
    setDraft(res.text);
    setTook({ secs: res.secs, voice: true });
    setPhase(res.text ? 'review' : 'answer');
    if (!res.text) toast('Nothing was heard. Try again a little closer to the microphone, or type your answer.', true);
  };
  const send = async (text, secs, voice, skip) => {
    const c = callRef.current;
    if (!c) return;
    const t = String(text || '').trim();
    if (!t && !skip) return toast('Say or type your answer first.', true);
    mic.cancel();
    prHush();
    setPhase('sending');
    setLines(l => [...l, { who: 'me', t: skip ? '' : t, skip: !!skip }]);
    try {
      const r = await api('pr_turn', skip ? { id: c.id, skip: 1 } : { id: c.id, text: t, secs: voice ? secs : 0, voice: !!voice });
      if (!alive.current) return;
      setProg({ step: r.step, of: r.of });
      say(r.say, r.done);
    } catch (e) {
      setLines(l => l.slice(0, -1));
      setDraft(t);
      setPhase(voice ? 'review' : 'answer');
      toast(errText(e), true);
    }
  };
  sendRef.current = send;
  const finish = async () => {
    const c = callRef.current;
    ending.current = true;
    prHush();
    mic.cancel();
    if (!c) return onCancel();
    setPhase('ending');
    try {
      const r = await api('pr_end', { id: c.id });
      if (r.deleted) toast('No feedback this time: the call ended before a question was answered.');
      onEnd(r.deleted ? null : r.session);
    } catch (e) {
      ending.current = false;
      toast(errText(e), true);
      setPhase('answer');
    }
  };
  const hangUp = () => {
    const answered = lines.some(l => l.who === 'me');
    if (!answered || window.confirm('End the call now? You get feedback on the answers so far.')) finish();
  };
  const lastCaller = [...lines].reverse().find(l => l.who === 'v');
  const p = call && call.persona;
  const secsIn = Math.max(0, Math.round((now - t0) / 1000));
  if (phase === 'error')
    return html`<section className="panel"><${Empty} title="The call could not start" action=${html`<button type="button" className="btn" onClick=${onCancel}>Back</button>`}>${fail}<//></section>`;
  return html`<section className="panel prcall" aria-label="Practice call">
      <div className="prcall-head">
        <span className="prcall-av" aria-hidden="true">${p ? p.name.split(' ').map(x => x[0]).join('') : '…'}</span>
        <div className="prcall-who">
          <b>${p ? p.name : 'Connecting…'}</b>
          <span className="muted small">${p ? p.who + ', ' + p.co : ''}</span>
          <span className="muted small">${p ? p.role + ' · ' + p.client + ' · ' + p.city : ''}</span>
        </div>
        <div className="prcall-meta">
          ${call && html`<${Chip}>${call.title}${call.skill && call.title === 'Technical screen' ? ' · ' + call.skill : ''}<//>`}
          <span className="small muted">Question ${Math.min(prog.step + 1, prog.of)} of ${prog.of} · ${String(Math.floor(secsIn / 60)).padStart(2, '0')}:${String(secsIn % 60).padStart(2, '0')}</span>
          <button type="button" className="btn sm prhang" onClick=${hangUp} disabled=${phase === 'ending'}><${Icon} n="phone" />End call</button>
        </div>
      </div>
      <div className="prcall-bar"><span style=${{ width: Math.round((100 * Math.min(prog.step, prog.of)) / Math.max(1, prog.of)) + '%' }} /></div>
      <div className="prcall-lines" ref=${box} aria-live="polite">
        ${lines.map(
          (l, i) => html`<div key=${i} className=${'prline ' + (l.who === 'v' ? 'them' : 'mine')}>
            <span className="prline-who">${l.who === 'v' ? (p ? p.name.split(' ')[0] : 'Caller') : 'You'}</span>
            <p>${l.skip ? html`<i className="muted">(skipped)</i>` : l.t}</p>
          </div>`
        )}
        ${phase === 'listening' && html`<div className="prline mine live"><span className="prline-who">You</span><p>${mic.text} <i className="muted">${mic.interim}</i>${!mic.text && !mic.interim ? html`<i className="muted">Listening…</i>` : ''}</p></div>`}
        ${(phase === 'sending' || phase === 'ending') && html`<div className="prline them wait"><span className="prline-who">${phase === 'ending' ? 'Feedback' : p ? p.name.split(' ')[0] : ''}</span><p><span className="prdots"><i /><i /><i /></span>${phase === 'ending' ? ' Scoring your answers…' : ''}</p></div>`}
      </div>
      <div className="prcall-answer">
        ${phase === 'connecting' && html`<p className="muted small">Calling…</p>`}
        ${phase === 'caller' &&
        html`<div className="actions"><span className="muted small"><${Icon} n="speaker" /> ${p ? p.name.split(' ')[0] : 'The caller'} is speaking…</span><button type="button" className="btn ghost sm" onClick=${prHush}>Skip to my answer</button></div>`}
        ${phase === 'answer' &&
        (typing
          ? html`<div className="prtype">
              <textarea rows="3" value=${draft} placeholder="Type what you would say…" onChange=${e => setDraft(e.target.value)} onKeyDown=${e => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && send(draft, 0, false)} aria-label="Your answer"></textarea>
              <div className="actions"><button type="button" className="btn" onClick=${() => send(draft, 0, false)}><${Icon} n="send" />Send</button></div>
            </div>`
          : html`<div className="prmic-row">
              <button type="button" className="prmic" onClick=${listen} aria-label="Answer out loud"><${Icon} n="mic" /></button>
              <div><b>Answer out loud</b><span className="muted small">Press the microphone, speak, then press Done.${mic.err ? '' : ' Your words appear as you speak.'}</span>${mic.err && html`<span className="small" style=${{ color: 'var(--red-ink)' }}>${mic.err}</span>`}</div>
              <button type="button" className="btn ghost sm" onClick=${() => (setDraft(''), setTook({ secs: 0, voice: false }), setPhase('typed'))}>Type instead</button>
            </div>`)}
        ${phase === 'typed' &&
        html`<div className="prtype">
            <textarea rows="3" value=${draft} placeholder="Type what you would say…" onChange=${e => setDraft(e.target.value)} aria-label="Your answer"></textarea>
            <div className="actions"><button type="button" className="btn ghost sm" onClick=${() => setPhase('answer')}><${Icon} n="mic" />Speak instead</button><button type="button" className="btn" onClick=${() => send(draft, 0, false)}><${Icon} n="send" />Send</button></div>
          </div>`}
        ${phase === 'listening' &&
        html`<div className="prmic-row">
            <button type="button" className="prmic on" onClick=${done} aria-label="Done speaking"><${Icon} n="stopsq" /></button>
            <div><b>Listening…</b><span className="muted small">${prefs.hands ? 'Your answer is sent after a short pause.' : 'Press Done when you have finished your answer.'}</span></div>
            <button type="button" className="btn sm" onClick=${done}>Done</button>
          </div>`}
        ${phase === 'review' &&
        html`<div className="prtype">
            <span className="muted small">Check what was heard (fix any word the browser got wrong), then send it.</span>
            <textarea rows="3" value=${draft} onChange=${e => setDraft(e.target.value)} aria-label="Your answer"></textarea>
            <div className="actions"><button type="button" className="btn ghost sm" onClick=${listen}><${Icon} n="mic" />Say it again</button><button type="button" className="btn" onClick=${() => send(draft, took.secs, took.voice)}><${Icon} n="send" />Send</button></div>
          </div>`}
      </div>
      <div className="prcall-foot">
        <button type="button" className="btn link sm" disabled=${!lastCaller || phase === 'sending' || phase === 'ending'} onClick=${() => lastCaller && (mic.cancel(), setPhase('caller'), prSpeak(lastCaller.t, { ...prefs, mute: false }).then(() => alive.current && setPhase('answer')))}><${Icon} n="speaker" />Hear the question again</button>
        <button type="button" className="btn link sm" disabled=${!['answer', 'typed', 'review', 'listening'].includes(phase)} onClick=${() => send('', 0, false, true)}>Skip this question</button>
      </div>
    </section>`;
}

/* ---- the report after a call ---- */
function PrDims({ scores }) {
  const keys = Object.keys(PR_DIM_NAMES).filter(k => scores && scores[k] != null);
  if (!keys.length) return null;
  return html`<div className="prdims">
      ${keys.map(
        k => html`<div key=${k} className="prdim" title=${PR_DIM_HELP[k]}>
          <span>${PR_DIM_NAMES[k]}</span>
          <div className="bar"><span style=${{ width: scores[k] + '%', background: scores[k] >= 75 ? 'var(--teal)' : scores[k] >= 55 ? 'var(--amber-ink)' : 'var(--red-ink)' }} /></div>
          <b>${scores[k]}</b>
        </div>`
      )}
    </div>`;
}
function PrReport({ s, prefs, onAgain, staff }) {
  const rep = s.report || {};
  const p = s.persona || {};
  const ans = rep.answers || [];
  const st = rep.stats || {};
  const lvl = (PR_LEVELS.find(x => x[0] === s.lvl) || [])[1];
  return html`<section className="panel prrep">
      <div className="prrep-top">
        <div className=${'prscore ' + prTone(s.score)}><b>${s.score}</b><span>of 100</span></div>
        <div style=${{ minWidth: 0, flex: 1 }}>
          <h2 className="ph" style=${{ margin: 0 }}>${s.title}</h2>
          <p className="muted small" style=${{ margin: '4px 0 0' }}>${[p.name && p.name + ' (' + p.who + ', ' + p.co + ')', lvl && lvl + ' caller', prDur(s.dur), fmtTs(s.at)].filter(Boolean).join(' · ')}</p>
          <p className="muted small" style=${{ margin: '2px 0 0' }}>${rep.by === 'ai' ? 'Feedback by the StratEdge AI coach.' : 'Built-in scoring.'}${rep.left ? ' The call was left open and finished by itself.' : ''}</p>
        </div>
        ${onAgain && html`<div className="actions"><button type="button" className="btn" onClick=${onAgain}><${Icon} n="refresh" />Practise this call again</button></div>`}
      </div>
      <${PrDims} scores=${rep.scores} />
      <div className="prrep-cols">
        <div><h3>What went well</h3>${rep.good && rep.good.length ? html`<ul>${rep.good.map((x, i) => html`<li key=${i}>${x}</li>`)}</ul>` : html`<p className="muted small">Keep practising: the strengths show up here.</p>`}</div>
        <div><h3>${staff ? 'To work on' : 'Work on next'}</h3>${rep.work && rep.work.length ? html`<ul>${rep.work.map((x, i) => html`<li key=${i}>${x}</li>`)}</ul>` : html`<p className="muted small">Nothing stood out. Try a tougher caller next time.</p>`}</div>
      </div>
      <p className="muted small prstats">${[st.words != null && st.words + ' words', st.wpm && st.wpm + ' words a minute', st.fillers != null && st.fillers + ' filler word' + (st.fillers === 1 ? '' : 's'), st.voice != null && st.voice + '% of answers spoken'].filter(Boolean).join(' · ')}</p>
      <h3>Question by question</h3>
      <div className="stack" style=${{ gap: 8 }}>
        ${ans.map(
          (a, i) => html`<details key=${i} className="prans" open=${a.cov < 1 && i < 4}>
            <summary><b>${a.label || a.q}</b><${Chip} s=${a.cov >= 1 ? 'ok' : a.cov >= 0.5 ? 'amber' : 'red'}>${Math.round(a.cov * 100)}% of the key points<//></summary>
            ${a.label && a.label !== a.q && html`<p className="muted small">${a.q}</p>`}
            <p className="prans-you"><b>You said:</b> ${a.you ? a.you : html`<i className="muted">(skipped)</i>`}</p>
            ${a.miss && a.miss.length > 0 && html`<p className="small">Missing: ${a.miss.map((m, j) => html`<span key=${j} className="chip amber">${m}</span>`)}</p>`}
            ${a.tip && html`<p className="note small"><span>${a.tip}</span></p>`}
            ${a.better &&
            html`<div className="prbetter">
              <div className="ph-row" style=${{ margin: 0 }}><b className="small">Example of a strong answer${rep.by === 'ai' ? '' : ' (use your own facts)'}</b>${prSynth() && html`<button type="button" className="btn ghost sm" onClick=${() => prSpeak(a.better, { ...(prefs || {}), mute: false })}><${Icon} n="speaker" />Listen</button>`}</div>
              <p>${a.better}</p>
            </div>`}
          </details>`
        )}
      </div>
      ${s.tr &&
      html`<details className="prtrans">
        <summary>The whole call (${s.tr.filter(x => x.who === 'me').length} answer${s.tr.filter(x => x.who === 'me').length === 1 ? '' : 's'})</summary>
        ${s.tr.map((l, i) => html`<div key=${i} className=${'prline ' + (l.who === 'v' ? 'them' : 'mine')}><span className="prline-who">${l.who === 'v' ? (p.name || 'Caller').split(' ')[0] : 'You'}${l.who === 'me' && l.wpm ? ' · ' + l.wpm + ' wpm' : ''}${l.who === 'me' && !l.skip ? (l.v ? ' · spoken' : ' · typed') : ''}</span><p>${l.skip ? html`<i className="muted">(skipped)</i>` : l.t}</p></div>`)}
      </details>`}
    </section>`;
}
function PrDrillView({ s, prefs }) {
  const items = s.items || [];
  return html`<section className="panel prrep">
      <div className="prrep-top">
        <div className=${'prscore ' + prTone(s.score)}><b>${s.score}</b><span>of 100</span></div>
        <div style=${{ minWidth: 0, flex: 1 }}><h2 className="ph" style=${{ margin: 0 }}>${s.title}</h2><p className="muted small" style=${{ margin: '4px 0 0' }}>${items.length} item${items.length === 1 ? '' : 's'} · ${fmtTs(s.at)}</p></div>
      </div>
      <div className="stack" style=${{ gap: 8 }}>
        ${items.map(
          (x, i) => html`<div key=${i} className="prans">
            <p style=${{ margin: 0 }}><b>${x.q || x.t}</b> <${Chip} s=${prTone(x.acc)}>${x.acc}%<//></p>
            <p className="prans-you"><b>You said:</b> ${x.said || html`<i className="muted">(nothing)</i>`}</p>
            ${x.missed && x.missed.length > 0 && html`<p className="small">${x.q ? 'Missing: ' : 'Missed words: '}${x.missed.map((m, j) => html`<span key=${j} className="chip amber">${m}</span>`)}</p>`}
            ${x.better && html`<div className="prbetter"><div className="ph-row" style=${{ margin: 0 }}><b className="small">Example of a strong answer</b>${prSynth() && html`<button type="button" className="btn ghost sm" onClick=${() => prSpeak(x.better, { ...(prefs || {}), mute: false })}><${Icon} n="speaker" />Listen</button>`}</div><p>${x.better}</p></div>`}
          </div>`
        )}
      </div>
    </section>`;
}

/* ---- voice drills ---- */
function PrDrillsTab({ d, onRepeat, onCards, prefs, setPrefs }) {
  const [skill, setSkill] = useState(d.pack);
  return html`<div className="stack">
      <section className="panel">
        <h2 className="ph">Listen and repeat</h2>
        <p className="muted small">Hear a sentence, say it back, and see which words came through clearly. Good for the phrases you say on every call, and for technical terms that are hard to pronounce.</p>
        <div className="prscen">${d.sets.map(
          s => html`<article key=${s.k} className="prscen-card">
            <div className="prscen-top"><span className="prscen-ic"><${Icon} n="speaker" /></span><div><b>${s.n}</b></div></div>
            <button type="button" className="btn sm ghost" onClick=${() => onRepeat(s.k)}>Start</button>
          </article>`
        )}</div>
      </section>
      <section className="panel">
        <h2 className="ph">Spoken flashcards</h2>
        <p className="muted small">Five interview questions on one skill: hear the question, answer out loud, then compare with the key points and an example answer.</p>
        <div className="actions" style=${{ alignItems: 'flex-end' }}>
          <label className="fld" style=${{ margin: 0, minWidth: 240 }}><span>Skill</span><select value=${skill} onChange=${e => setSkill(e.target.value)}>${d.packs.map(p => html`<option key=${p.k} value=${p.k}>${p.n}${p.k === d.pack ? ' (matches your profile)' : ''}</option>`)}</select></label>
          <button type="button" className="btn" onClick=${() => onCards(skill)}><${Icon} n="target" />Start the flashcards</button>
        </div>
      </section>
      <section className="panel"><${PrVoiceSettings} prefs=${prefs} setPrefs=${setPrefs} /></section>
    </div>`;
}
const PR_CONTR = { "i'm": 'i am', "don't": 'do not', "it's": 'it is', "we're": 'we are', "can't": 'cannot', "i'll": 'i will', "that's": 'that is', "won't": 'will not', "i've": 'i have', "you're": 'you are', "let's": 'let us', "i'd": 'i would' };
/** One written word as the server counts it (api/practice.php prRepeatScore): "I'm" is "i am", "I-94" is "i94". */
const prNormWord = w => {
  let s = String(w).toLowerCase().replace(/[’‘]/g, "'");
  s = PR_CONTR[s.replace(/[^a-z']/g, '')] || s;
  s = s
    .replace(/\b([a-z])[\s-](\d{1,3})\b/g, '$1$2')
    .replace(/\b(dollars?|bucks)\b/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ');
  return s.split(' ').filter(Boolean);
};
/** Marks the sentence's words that did not come through (in order, one mark per missed occurrence). */
function prMarkMissed(t, missed) {
  const left = {};
  (missed || []).forEach(w => (left[w] = (left[w] || 0) + 1));
  return String(t)
    .split(/(\s+)/)
    .map((w, i) => {
      const hit = prNormWord(w).filter(k => left[k] > 0 && left[k]--);
      return hit.length ? html`<mark key=${i} className="prmiss">${w}</mark>` : w;
    });
}
function PrDrillShell({ title, idx, n, onQuit, children }) {
  return html`<section className="panel prdrill">
      <div className="ph-row" style=${{ margin: 0 }}>
        <div><h2 className="ph" style=${{ margin: 0 }}>${title}</h2><span className="muted small">${Math.min(idx + 1, n)} of ${n}</span></div>
        <button type="button" className="btn ghost sm" onClick=${onQuit}>Stop</button>
      </div>
      <div className="prcall-bar"><span style=${{ width: Math.round((100 * idx) / Math.max(1, n)) + '%' }} /></div>
      ${children}
    </section>`;
}
function PrRepeat({ set, prefs, onDone }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [idx, setIdx] = useState(0);
  const [res, setRes] = useState({});
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState('');
  const [saved, setSaved] = useState(null);
  const mic = usePrMic(null, prefs.lang);
  const typing = prefs.typing || !mic.ok;
  useEffect(() => {
    api('pr_drill_items', { kind: 'repeat', set }).then(setD, e => (toast(errText(e), true), onDone()));
    return prHush;
  }, []);
  if (!d) return html`<${Spinner} />`;
  if (!d.items.length) return html`<section className="panel"><${Empty} title="Nothing to repeat yet" action=${html`<button type="button" className="btn" onClick=${onDone}>Back</button>`}>Add your skills and work authorization to your profile (Apply profile) first: these sentences are built from them.<//></section>`;
  const it = d.items[idx];
  const r = it && res[it.i];
  const check = async (said, secs) => {
    if (!String(said || '').trim()) return toast('Nothing was heard. Try again, or type it.', true);
    setBusy(true);
    try {
      const c = await api('pr_check', { kind: 'repeat', t: it.t, said });
      setRes(x => ({ ...x, [it.i]: { ...c, said, secs } }));
    } catch (e) {
      toast(errText(e), true);
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setBusy(true);
    try {
      const out = await api('pr_drill_save', { kind: 'repeat', set, items: d.items.filter(x => res[x.i]).map(x => ({ t: x.t, said: res[x.i].said, secs: res[x.i].secs || 0 })) });
      setSaved(out);
    } catch (e) {
      toast(errText(e), true);
    } finally {
      setBusy(false);
    }
  };
  const quit = () => (Object.keys(res).length && !saved ? window.confirm('Stop now? The sentences you said are saved.') && save().then(onDone) : onDone());
  if (saved)
    return html`<section className="panel prrep">
        <div className="prrep-top"><div className=${'prscore ' + prTone(saved.score)}><b>${saved.score}</b><span>of 100</span></div><div><h2 className="ph" style=${{ margin: 0 }}>Listen and repeat: ${d.n}</h2><p className="muted small">Word accuracy over ${saved.items.length} sentence${saved.items.length === 1 ? '' : 's'}.</p></div><div className="actions"><button type="button" className="btn" onClick=${onDone}>Done</button></div></div>
      </section>`;
  return html`<${PrDrillShell} title=${'Listen and repeat: ' + d.n} idx=${idx} n=${d.items.length} onQuit=${quit}>
      ${d.missing && d.missing.length > 0 && html`<p className="note small"><span>Some sentences are left out until your profile has your ${d.missing.join(' and ')}.</span></p>`}
      <p className="prsay">${r ? prMarkMissed(it.t, r.missed) : it.t}</p>
      <div className="actions">
        <button type="button" className="btn ghost" onClick=${() => prSpeak(it.t, { ...prefs, mute: false })}><${Icon} n="speaker" />Listen</button>
        ${typing
          ? html`<input value=${typed} onChange=${e => setTyped(e.target.value)} placeholder="Type the sentence (no microphone in this browser)" style=${{ flex: 1, minWidth: 200 }} /><button type="button" className="btn" disabled=${busy} onClick=${() => check(typed, 0)}>Check</button>`
          : mic.on
            ? html`<button type="button" className="btn" onClick=${async () => { const x = await mic.stop(); check(x.text, x.secs); }}><${Icon} n="stopsq" />Done</button><span className="muted small">${mic.text} <i>${mic.interim}</i></span>`
            : html`<button type="button" className="btn" disabled=${busy} onClick=${() => mic.start()}><${Icon} n="mic" />${r ? 'Say it again' : 'Say it'}</button>`}
      </div>
      ${mic.err && html`<p className="small" style=${{ color: 'var(--red-ink)' }}>${mic.err}</p>`}
      ${r &&
      html`<div className=${'note ' + (r.acc >= 85 ? 'ok' : r.acc >= 60 ? 'amber' : 'red')}><span><b>${r.acc}% of the words came through.</b> ${r.missed.length ? 'Say the highlighted words more clearly.' : 'Clear and complete.'}</span></div>
        <p className="muted small">Heard: “${r.said}”</p>`}
      <div className="actions" style=${{ justifyContent: 'space-between', marginTop: 8 }}>
        <button type="button" className="btn ghost sm" disabled=${idx === 0} onClick=${() => (setIdx(idx - 1), setTyped(''))}><${Icon} n="left" />Previous</button>
        ${idx < d.items.length - 1
          ? html`<button type="button" className="btn sm" onClick=${() => (prHush(), mic.cancel(), setIdx(idx + 1), setTyped(''))}>Next<${Icon} n="right" /></button>`
          : html`<button type="button" className="btn sm" disabled=${busy || !Object.keys(res).length} onClick=${save}><${Icon} n="check" />Finish and save</button>`}
      </div>
    <//>`;
}
function PrCards({ skill, prefs, onDone }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [idx, setIdx] = useState(0);
  const [res, setRes] = useState({});
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState('');
  const [saved, setSaved] = useState(null);
  const mic = usePrMic(null, prefs.lang);
  const typing = prefs.typing || !mic.ok;
  useEffect(() => {
    api('pr_drill_items', { kind: 'cards', skill }).then(
      x => {
        setD(x);
        if (x.items[0]) prSpeak(x.items[0].q, prefs);
      },
      e => (toast(errText(e), true), onDone())
    );
    return prHush;
  }, []);
  if (!d) return html`<${Spinner} />`;
  const it = d.items[idx];
  const r = it && res[it.i];
  const check = async (said, secs) => {
    if (!String(said || '').trim()) return toast('Nothing was heard. Try again, or type your answer.', true);
    setBusy(true);
    try {
      const c = await api('pr_check', { kind: 'cards', skill: d.skill, i: it.i, said });
      setRes(x => ({ ...x, [it.i]: { ...c, said, secs } }));
    } catch (e) {
      toast(errText(e), true);
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setBusy(true);
    try {
      setSaved(await api('pr_drill_save', { kind: 'cards', skill: d.skill, items: d.items.filter(x => res[x.i]).map(x => ({ i: x.i, said: res[x.i].said, secs: res[x.i].secs || 0 })) }));
    } catch (e) {
      toast(errText(e), true);
    } finally {
      setBusy(false);
    }
  };
  const go = i => {
    prHush();
    mic.cancel();
    setIdx(i);
    setTyped('');
    if (d.items[i] && !res[d.items[i].i]) prSpeak(d.items[i].q, prefs);
  };
  const quit = () => (Object.keys(res).length && !saved ? window.confirm('Stop now? The answers you gave are saved.') && save().then(onDone) : onDone());
  if (saved)
    return html`<section className="panel prrep">
        <div className="prrep-top"><div className=${'prscore ' + prTone(saved.score)}><b>${saved.score}</b><span>of 100</span></div><div><h2 className="ph" style=${{ margin: 0 }}>Spoken flashcards: ${d.n}</h2><p className="muted small">Key points covered over ${saved.items.length} question${saved.items.length === 1 ? '' : 's'}.</p></div><div className="actions"><button type="button" className="btn" onClick=${onDone}>Done</button></div></div>
      </section>`;
  return html`<${PrDrillShell} title=${'Spoken flashcards: ' + d.n} idx=${idx} n=${d.items.length} onQuit=${quit}>
      <p className="prsay">${it.q}</p>
      <div className="actions">
        <button type="button" className="btn ghost" onClick=${() => prSpeak(it.q, { ...prefs, mute: false })}><${Icon} n="speaker" />Hear the question</button>
        ${typing
          ? html`<textarea rows="3" value=${typed} onChange=${e => setTyped(e.target.value)} placeholder="Type your answer" style=${{ flex: 1, minWidth: 220 }}></textarea><button type="button" className="btn" disabled=${busy} onClick=${() => check(typed, 0)}>Check</button>`
          : mic.on
            ? html`<button type="button" className="btn" onClick=${async () => { const x = await mic.stop(); check(x.text, x.secs); }}><${Icon} n="stopsq" />Done</button>`
            : html`<button type="button" className="btn" disabled=${busy} onClick=${() => mic.start()}><${Icon} n="mic" />${r ? 'Answer again' : 'Answer out loud'}</button>`}
      </div>
      ${mic.on && html`<p className="prans-you">${mic.text} <i className="muted">${mic.interim || (!mic.text ? 'Listening…' : '')}</i></p>`}
      ${mic.err && html`<p className="small" style=${{ color: 'var(--red-ink)' }}>${mic.err}</p>`}
      ${r &&
      html`<div className=${'note ' + (r.acc >= 75 ? 'ok' : r.acc >= 50 ? 'amber' : 'red')}><span><b>You covered ${r.acc}% of the key points.</b> ${r.missed.length ? 'Missing: ' + r.missed.join('; ') + '.' : 'All of them.'}</span></div>
        <p className="prans-you"><b>You said:</b> ${r.said}</p>
        <div className="prbetter"><div className="ph-row" style=${{ margin: 0 }}><b className="small">Example answer</b><button type="button" className="btn ghost sm" onClick=${() => prSpeak(r.better, { ...prefs, mute: false })}><${Icon} n="speaker" />Listen</button></div><p>${r.better}</p></div>`}
      <div className="actions" style=${{ justifyContent: 'space-between', marginTop: 8 }}>
        <button type="button" className="btn ghost sm" disabled=${idx === 0} onClick=${() => go(idx - 1)}><${Icon} n="left" />Previous</button>
        ${idx < d.items.length - 1
          ? html`<button type="button" className="btn sm" onClick=${() => go(idx + 1)}>Next question<${Icon} n="right" /></button>`
          : html`<button type="button" className="btn sm" disabled=${busy || !Object.keys(res).length} onClick=${save}><${Icon} n="check" />Finish and save</button>`}
      </div>
    <//>`;
}

/* ---- my progress ---- */
function PrProgress({ d, onOpen }) {
  const st = d.stats;
  if (!d.recent.length)
    return html`<section className="panel"><${Empty} title="No practice yet">Your calls and drills show up here with their scores, so you can see yourself improve.<//></section>`;
  return html`<div className="stack">
      <section className="panel">
        <h2 className="ph">The last 30 days</h2>
        <p className="muted small">${st.calls30} call${st.calls30 === 1 ? '' : 's'} and ${st.drills30} drill${st.drills30 === 1 ? '' : 's'}, ${st.minutes30} minutes${st.best30 != null ? ', best call ' + st.best30 : ''}${st.trend != null ? ' · ' + (st.trend > 0 ? 'up ' + st.trend + ' points' : st.trend < 0 ? 'down ' + -st.trend + ' points' : 'steady') + ' on your earlier calls' : ''}.</p>
        <${PrDims} scores=${st.dims} />
        ${st.weak && html`<p className="note small"><span><b>Work on ${PR_DIM_NAMES[st.weak].toLowerCase()}:</b> ${PR_DIM_HELP[st.weak].toLowerCase()}.</span></p>`}
      </section>
      <section className="panel" style=${{ padding: '6px 8px' }}>
        <div className="tblwrap"><table className="tbl">
          <thead><tr><th>When</th><th>Practice</th><th className="r">Score</th><th className="r">Time</th></tr></thead>
          <tbody>${d.recent.map(
            s => html`<tr key=${s.id} className="click" onClick=${() => onOpen(s.id)} tabIndex="0" onKeyDown=${e => e.key === 'Enter' && onOpen(s.id)}>
              <td className="small">${fmtTs(s.at)}</td>
              <td><b>${s.title}</b>${s.kind === 'call' && html`<span className="muted small"> · ${(PR_LEVELS.find(x => x[0] === s.lvl) || [])[1] || ''}</span>`}</td>
              <td className="r"><${Chip} s=${prTone(s.score)}>${s.score}<//></td>
              <td className="r small">${prDur(s.dur)}</td>
            </tr>`
          )}</tbody>
        </table></div>
      </section>
    </div>`;
}
/* Learning: a lesson read aloud with the same voice settings. */
function ReadAloudButton({ text }) {
  const [on, setOn] = useState(false);
  useEffect(() => () => on && prHush(), [on]);
  if (!prSynth()) return null;
  const plain = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_`>|]/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  return html`<button type="button" className="btn ghost sm" onClick=${() => (on ? (prHush(), setOn(false)) : (setOn(true), prSpeak(plain, { ...prPrefsLoad(), mute: false }).then(() => setOn(false))))}><${Icon} n=${on ? 'stopsq' : 'speaker'} />${on ? 'Stop reading' : 'Listen'}</button>`;
}
