/* ================= StratEdge certifications and the daily and weekly tests (v32) =================
   Members (consultants, employees, students): Grow > Certifications and Grow > Daily & weekly tests. The questions
   come from the bank HR keeps (api/exams.php); answers stay on the server until a test is handed in. Passing a
   certification exam issues a certificate with a number and code: a PDF, a public verification page (#/verify) and
   "Add to LinkedIn profile". Students and outside consultants use these when their plan includes them. */
const EX_LEVEL_TONE = { Associate: 'info', Professional: 'ok', Expert: 'amber' };
const exVerifyUrl = c => siteBase() + '#/verify?no=' + encodeURIComponent(c.no) + '&code=' + encodeURIComponent(c.code);
const exShareUrl = c => siteBase() + 'cert.php?no=' + encodeURIComponent(c.no) + '&code=' + encodeURIComponent(c.code);
function exLinkedInAdd(c, org) {
  const d = new Date(c.at);
  const p = new URLSearchParams({
    startTask: 'CERTIFICATION_NAME',
    name: c.t + (c.level ? ' (' + c.level + ')' : ''),
    organizationName: org || CO.name,
    issueYear: String(d.getFullYear()),
    issueMonth: String(d.getMonth() + 1),
    certUrl: exVerifyUrl(c),
    certId: c.no,
  });
  if (c.exp) {
    const e = new Date(c.exp);
    p.set('expirationYear', String(e.getFullYear()));
    p.set('expirationMonth', String(e.getMonth() + 1));
  }
  return 'https://www.linkedin.com/profile/add?' + p.toString();
}
const exClock = ms => {
  const s = Math.max(0, Math.round(ms / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};
/* The PDF's standard fonts only carry Western European letters: anything else (a name in another script, an emoji)
   would stop the certificate from being made, so it is swapped for a close or neutral character first. */
const PDF_OK = /[\x20-\x7E\u00A0-\u00FF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026]/;
const pdfSafe = s =>
  Array.from(
    String(s == null ? '' : s)
      .normalize('NFC')
      .replace(/[\u2010-\u2012\u2212]/g, '-')
  )
    .map(ch => {
      if (PDF_OK.test(ch)) return ch;
      const base = ch.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); // Ś → S, ł stays out
      return base && Array.from(base).every(c => PDF_OK.test(c)) ? base : '?';
    })
    .join('');
/* A certification certificate (landscape A4): the credential, its level, the skills it covers, issue and expiry. */
async function exCertPdf(cert, org) {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([842, 595]);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const navy = rgb(0.07, 0.16, 0.33);
  const teal = rgb(0.05, 0.49, 0.49);
  const gold = rgb(0.72, 0.55, 0.16);
  page.drawRectangle({ x: 0, y: 0, width: 842, height: 595, color: rgb(0.985, 0.98, 0.97) });
  page.drawRectangle({ x: 26, y: 26, width: 790, height: 543, borderColor: navy, borderWidth: 2.5 });
  page.drawRectangle({ x: 38, y: 38, width: 766, height: 519, borderColor: gold, borderWidth: 1 });
  const center = (t, y, size, f, color) => {
    const x = pdfSafe(t);
    page.drawText(x, { x: (842 - f.widthOfTextAtSize(x, size)) / 2, y, size, font: f, color: color || navy });
  };
  const fit = (t, max, size, f) => {
    let s = size;
    while (s > 10 && f.widthOfTextAtSize(pdfSafe(t), s) > max) s -= 1;
    return s;
  };
  center((org || CO.name).toUpperCase(), 505, 13, bold, teal);
  center('Certification', 455, 36, bold);
  center('This certifies that', 415, 13, font);
  const name = cert.n || 'Participant';
  center(name, 375, fit(name, 640, 30, bold), bold);
  center('has passed the examination and is a', 340, 13, font);
  const title = cert.t || '';
  center(title, 302, fit(title, 700, 24, bold), bold);
  if (cert.level) center(cert.level + ' level', 276, 13, bold, gold);
  const skills = (cert.skills || []).join(' · ');
  if (skills) center('Covers: ' + skills, 250, fit('Covers: ' + skills, 700, 11, font), font, rgb(0.3, 0.33, 0.4));
  const day = ts => new Date(ts).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
  center(`Issued ${day(cert.at)}${cert.exp ? ' · valid until ' + day(cert.exp) : ''}${cert.avg != null ? ' · exam score ' + cert.avg + '%' : ''}`, 222, 12, font);
  page.drawLine({ start: { x: 300, y: 150 }, end: { x: 542, y: 150 }, thickness: 1, color: navy });
  center('Learning & Certification, ' + (org || CO.name), 135, 11, font);
  const v = `Certificate ${cert.no} · code ${cert.code} · verify at ${exVerifyUrl(cert)}`;
  center(v, 70, fit(v, 760, 9, font), font, rgb(0.4, 0.4, 0.45));
  return pdf.save();
}
/* ---- one test or exam: the questions, the clock, the result ---- */
function ExamRunner({ attempt: a0, onExit, onDone }) {
  const toast = useToast();
  const [a, setA] = useState(a0);
  const [ans, setAns] = useState({});
  const [cur, setCur] = useState(0);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(Math.max(0, a0.dl - (a0.now || Date.now())));
  const tabs = useRef(0);
  const skew = useRef(a0.now ? a0.now - Date.now() : 0);
  const ansRef = useRef({});
  const sent = useRef(false);
  const done = !!a.done;
  const key = 'se_ex_' + a.id;
  useEffect(() => {
    try {
      const s = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (s && typeof s === 'object') {
        setAns(s);
        ansRef.current = s;
      }
    } catch (e) {
      /* a fresh start */
    }
  }, [a.id]);
  const setAnswer = (i, v) => {
    const n = { ...ansRef.current, [i]: v };
    ansRef.current = n;
    setAns(n);
    try {
      sessionStorage.setItem(key, JSON.stringify(n));
    } catch (e) {
      /* fine */
    }
  };
  const submit = async auto => {
    if (sent.current || done) return;
    const unanswered = a.qs.filter(q => ansRef.current[q.i] == null || ansRef.current[q.i] === '').length;
    if (!auto && unanswered && !confirm(`${unanswered} question${unanswered === 1 ? ' is' : 's are'} not answered. Hand in anyway?`)) return;
    sent.current = true;
    setBusy(true);
    try {
      const r = await api('ex_submit', { id: a.id, answers: ansRef.current, tabs: tabs.current });
      setA(r.attempt);
      try {
        sessionStorage.removeItem(key);
      } catch (e) {
        /* fine */
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
      onDone && onDone(r.attempt);
      if (auto) toast('Time is up: your answers were handed in.');
    } catch (e) {
      sent.current = false;
      toast(errText(e), true);
    }
    setBusy(false);
  };
  useEffect(() => {
    if (done) return;
    const vis = () => {
      if (document.hidden) tabs.current++;
    };
    document.addEventListener('visibilitychange', vis);
    const t = setInterval(() => {
      const l = Math.max(0, a.dl - (Date.now() + skew.current));
      setLeft(l);
      if (l <= 0) submit(true);
    }, 1000);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [done]);
  if (done) {
    const byI = Object.fromEntries((a.res || []).map(x => [x.i, x]));
    const topics = Object.entries(a.topics || {}).map(([t, v]) => [t, v[0], v[1]]);
    const cert = a.kind === 'cert';
    return html`<div className="stack exam">
        <section className="panel exresult">
          <div className=${'exscore ' + (cert ? (a.passed ? 'ok' : 'bad') : a.pct >= 70 ? 'ok' : a.pct >= 50 ? 'mid' : 'bad')}><b>${a.pct}%</b><span>${a.ok} of ${a.n}</span></div>
          <div className="exsum">
            <h3 style=${{ margin: 0 }}>${a.t}</h3>
            ${cert ? html`<p className="muted" style=${{ margin: '4px 0 0' }}>${a.passed ? html`<b>Passed.</b> Your certificate is ready under My certifications.` : html`<b>Not passed</b> (${a.pass}% needed). Review the answers below; you can try again when the waiting time is over.`}</p>` : html`<p className="muted" style=${{ margin: '4px 0 0' }}>${a.pct >= 80 ? 'Strong result.' : a.pct >= 60 ? 'Good work: the explanations below cover what you missed.' : 'Keep at it: read the explanations and try the topics again tomorrow.'}${a.late ? ' (Handed in after the time was up, so the answers did not count.)' : ''}</p>`}
            ${topics.length > 0 && html`<div className="extopics">${topics.map(([t, ok, n]) => html`<span key=${t} className=${'chip ' + (ok / n >= 0.7 ? 'ok' : ok / n >= 0.5 ? 'amber' : 'red')}>${t} ${ok}/${n}</span>`)}</div>`}
          </div>
          <div className="actions"><button type="button" className="btn ghost" onClick=${onExit}><${Icon} n="left" />Back</button></div>
        </section>
        ${a.qs.map(q => html`<${QuizItemView} key=${q.i} item=${q} value=${(a.ans || {})[q.i]} onChange=${() => {}} result=${byI[q.i] || { ok: false, a: '', why: '' }} />`)}
      </div>`;
  }
  const q = a.qs[cur];
  const answered = a.qs.filter(x => ans[x.i] != null && ans[x.i] !== '' && !(Array.isArray(ans[x.i]) && !ans[x.i].length)).length;
  const low = left < 60000;
  return html`<div className="stack exam">
      <section className="panel exhead">
        <div style=${{ minWidth: 0 }}>
          <h3 style=${{ margin: 0 }}>${a.t}</h3>
          <div className="muted small">${answered} of ${a.qs.length} answered${a.kind === 'cert' ? ' · stay on this page: leaving it is noted' : ''}</div>
        </div>
        <div className=${'exclock' + (low ? ' low' : '')} role="timer" aria-live=${low ? 'polite' : 'off'}><${Icon} n="clock" />${exClock(left)}</div>
        <button type="button" className="btn" disabled=${busy} onClick=${() => submit(false)}>${busy ? 'Handing in…' : 'Hand in'}</button>
      </section>
      <div className="exnav" role="navigation" aria-label="Questions">
        ${a.qs.map((x, i) => html`<button key=${x.i} type="button" className=${(i === cur ? 'on ' : '') + (ans[x.i] != null && ans[x.i] !== '' ? 'did' : '')} onClick=${() => setCur(i)} aria-label=${'Question ' + (i + 1)}>${i + 1}</button>`)}
      </div>
      ${q && html`<${QuizItemView} key=${q.i} item=${q} value=${ans[q.i]} onChange=${v => setAnswer(q.i, v)} />`}
      <div className="actions" style=${{ justifyContent: 'space-between' }}>
        <button type="button" className="btn ghost" disabled=${cur === 0} onClick=${() => setCur(cur - 1)}><${Icon} n="left" />Previous</button>
        ${cur < a.qs.length - 1 ? html`<button type="button" className="btn ghost" onClick=${() => setCur(cur + 1)}>Next<${Icon} n="right" /></button>` : html`<button type="button" className="btn" disabled=${busy} onClick=${() => submit(false)}>Hand in</button>`}
      </div>
    </div>`;
}

/* ---- Grow > Daily & weekly tests ---- */
function TestsPage({ q }) {
  const P = usePortal();
  const toast = useToast();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [run, setRun] = useState(null);
  const [pick, setPick] = useState(null);
  const load = () =>
    api('ex_home').then(
      r => {
        setD(r);
        setPick(r.mine);
      },
      e => setErr(e)
    );
  useEffect(() => {
    load();
  }, []);
  const open = async (kind, cur) => {
    try {
      const r = cur && cur.id ? await api('ex_attempt', { id: cur.id }) : await api('ex_start', { kind });
      setRun(r.attempt);
      window.scrollTo({ top: 0 });
    } catch (e) {
      toast(errText(e), true);
    }
  };
  if (run) return html`<${ExamRunner} attempt=${run} onExit=${() => { setRun(null); load(); }} onDone=${() => load()} />`;
  if (err) return html`<${LoadError} error=${err} onRetry=${() => { setErr(null); load(); }} />`;
  if (!d) return html`<${Spinner} />`;
  if (!d.can.tests) return html`<${PlanGate} feature="tests" />`;
  const card = (kind, title, cfg, cur, ref) => {
    const doneIt = cur && cur.done;
    return html`<section className=${'panel extest' + (doneIt ? ' done' : '')}>
        <div className="ph-row"><h3 className="ph" style=${{ margin: 0 }}>${title}</h3>${doneIt ? html`<span className=${'chip ' + (cur.pct >= 70 ? 'ok' : cur.pct >= 50 ? 'amber' : 'red')}>${cur.pct}%</span>` : cur ? html`<span className="chip new">Started</span>` : null}</div>
        <p className="muted small" style=${{ margin: '6px 0 12px' }}>${cfg.n} questions · ${cfg.min} minutes · ${kind === 'daily' ? 'a new set every day' : 'one try per week'}${d.mine.length ? ' · your topics' : ' · all topics'}</p>
        ${!cfg.on ? html`<p className="muted small">Switched off by HR.</p>` : doneIt ? html`<button type="button" className="btn ghost" onClick=${() => open(kind, cur)}><${Icon} n="eye" />Review the answers</button>` : html`<button type="button" className="btn" onClick=${() => open(kind, cur)}><${Icon} n="target" />${cur ? 'Continue' : kind === 'daily' ? "Start today's test" : "Start this week's test"}</button>`}
      </section>`;
  };
  const days = Object.entries(d.days || {});
  const topics = d.topics || [];
  const togglePick = t => setPick(p => (p.includes(t) ? p.filter(x => x !== t) : [...p, t]));
  const saveTopics = async () => {
    try {
      const r = await api('ex_topics_save', { topics: pick });
      toast(`Saved: ${r.pool} questions match your topics.`);
      load();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  return html`<div className="stack extests">
      <${KitStats} items=${[
        { v: d.streak, l: d.streak === 1 ? 'Day in a row' : 'Days in a row', tone: d.streak ? 'ok' : '' },
        { v: d.best, l: 'Best streak' },
        { v: days.length, l: 'Daily tests in 30 days' },
        { v: days.length ? Math.round(days.reduce((s, [, v]) => s + v, 0) / days.length) + '%' : '—', l: 'Average score' },
      ]} />
      <div className="g2">
        ${card('daily', "Today's test", d.cfg.daily, d.daily, d.today)}
        ${card('weekly', "This week's test", d.cfg.weekly, d.weekly, d.week)}
      </div>
      ${
        days.length > 0 &&
        html`<section className="panel">
          <h3 className="ph">Last 30 days</h3>
          <div className="exbars" aria-label="Daily scores">${days.map(([k, v]) => html`<span key=${k} title=${fmtDate(k, { month: 'short', day: 'numeric' }) + ': ' + v + '%'} style=${{ height: Math.max(6, v) + '%' }} className=${v >= 70 ? 'ok' : v >= 50 ? 'mid' : 'bad'} />`)}</div>
        </section>`
      }
      <div className="g2">
        <section className="panel">
          <h3 className="ph">My topics</h3>
          <p className="muted small">Tests draw from these topics (none picked = everything in the bank). ${d.pool} questions match now.</p>
          <div className="actions" style=${{ flexWrap: 'wrap' }}>${topics.map(t => html`<button key=${t.t} type="button" className=${'chip' + (pick.includes(t.t) ? ' new' : '')} style=${{ border: 0, cursor: 'pointer' }} aria-pressed=${pick.includes(t.t)} onClick=${() => togglePick(t.t)}>${t.t} · ${t.n}</button>`)}</div>
          ${JSON.stringify(pick) !== JSON.stringify(d.mine) && html`<div className="actions" style=${{ marginTop: 10 }}><button type="button" className="btn sm" onClick=${saveTopics}>Save my topics</button></div>`}
        </section>
        <section className="panel">
          <h3 className="ph">${d.weak.length ? 'Topics to practise' : 'Leaderboard this week'}</h3>
          ${
            d.weak.length
              ? html`<ul className="list">${d.weak.map(w => html`<li key=${w.t}><span>${w.t}</span><span className=${'chip ' + (w.pct >= 70 ? 'ok' : w.pct >= 50 ? 'amber' : 'red')}>${w.pct}% right</span></li>`)}</ul><p className="muted small">The courses under Learning cover these; tomorrow's test keeps mixing them in.</p>`
              : null
          }
          ${
            d.cfg.board &&
            (d.board.length
              ? html`${d.weak.length ? html`<h3 className="ph" style=${{ marginTop: 14 }}>Leaderboard this week</h3>` : ''}<ol className="exboard">${d.board.map((b, i) => html`<li key=${i} className=${b.me ? 'me' : ''}><span>${b.n}${b.me ? ' (you)' : ''}</span><b>${b.pct}%</b></li>`)}</ol>`
              : html`<p className="muted small">Nobody has taken this week's test yet.</p>`)
          }
        </section>
      </div>
    </div>`;
}

/* ---- Grow > Certifications ---- */
function CertsPage({ q }) {
  const P = usePortal();
  const toast = useToast();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [run, setRun] = useState(null);
  const [ask, setAsk] = useState(null);
  const [busy, setBusy] = useState('');
  const load = () => api('ex_home').then(setD, e => setErr(e));
  useEffect(() => {
    load();
  }, []);
  const start = async p => {
    setAsk(null);
    try {
      const r = await api('ex_start', { kind: 'cert', prog: p.id });
      setRun(r.attempt);
      window.scrollTo({ top: 0 });
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const pdf = async c => {
    setBusy(c.id);
    try {
      const bytes = await exCertPdf(c, d.org);
      await saveDownload(`StratEdge-certification-${c.no}.pdf`, new Blob([bytes], { type: 'application/pdf' }));
    } catch (e) {
      if (!e || e.code !== 'declined') toast(errText(e), true);
    }
    setBusy('');
  };
  if (run) return html`<${ExamRunner} attempt=${run} onExit=${() => { setRun(null); load(); }} onDone=${() => load()} />`;
  if (err) return html`<${LoadError} error=${err} onRetry=${() => { setErr(null); load(); }} />`;
  if (!d) return html`<${Spinner} />`;
  if (!d.can.cert) return html`<${PlanGate} feature="cert" />`;
  const mine = (d.certs || []).filter(c => c.kind === 'prog').sort((a, b) => b.at - a.at);
  return html`<div className="stack excerts">
      <section className="panel">
        <h2 className="ph" style=${{ marginTop: 0 }}>StratEdge certifications</h2>
        <p className="muted small" style=${{ margin: 0 }}>Pass the exam to earn a certification you can show clients: a certificate with a number anyone can check, and a button that adds it to your LinkedIn profile. Exams are timed and drawn from our question bank.</p>
      </section>
      ${
        d.progs.length
          ? html`<div className="cogrid">${d.progs.map(p => {
              const me = p.me;
              return html`<section key=${p.id} className=${'panel excard' + (me.heldOk ? ' held' : '')}>
                  <div className="cohead"><span className=${'chip ' + (EX_LEVEL_TONE[p.level] || '')}>${p.level}</span>${me.heldOk && html`<span className="chip ok">Certified</span>`}</div>
                  <b className="ext">${p.t}</b>
                  ${p.d && html`<p className="muted small">${p.d}</p>`}
                  <div className="muted small">${p.n} questions · ${p.min} min · ${p.pass}% to pass · ${p.tries} attempt${p.tries === 1 ? '' : 's'} a month${p.valid ? ' · valid ' + p.valid + ' months' : ''}</div>
                  ${p.topics.length > 0 && html`<div className="extopics">${p.topics.map(t => html`<span key=${t} className="chip">${t}</span>`)}</div>`}
                  ${me.missing.length > 0 && html`<div className="note amber"><span>First finish: ${me.missing.map((c, i) => html`<${Fragment} key=${c.id}>${i ? ', ' : ''}<a href=${growHref(P, 'learn?c=' + encodeURIComponent(c.id))}>${c.t}</a><//>`)}</span></div>`}
                  <div className="actions" style=${{ marginTop: 'auto' }}>
                    ${me.open ? html`<button type="button" className="btn" onClick=${() => api('ex_attempt', { id: me.open }).then(r => setRun(r.attempt), e => toast(errText(e), true))}>Continue the exam</button>` : me.can ? html`<button type="button" className="btn" onClick=${() => setAsk(p)}><${Icon} n="flag" />Take the exam</button>` : html`<span className="muted small">${me.why}</span>`}
                    ${me.tries > 0 && html`<span className="muted small">${me.left} left this month · best ${me.best}%</span>`}
                  </div>
                </section>`;
            })}</div>`
          : html`<section className="panel"><${Empty} title="No certifications yet">StratEdge HR publishes them here.<//></section>`
      }
      <section className="panel">
        <h3 className="ph">My certifications</h3>
        ${
          mine.length
            ? html`<div className="stack" style=${{ gap: 10 }}>${mine.map(c => {
                const expired = c.exp && c.exp < Date.now();
                return html`<div key=${c.id} className=${'excert' + (expired ? ' off' : '')}>
                    <div style=${{ minWidth: 0 }}>
                      <b>${c.t}</b> <span className=${'chip ' + (EX_LEVEL_TONE[c.level] || '')}>${c.level}</span>${expired && html` <span className="chip red">Expired</span>`}
                      <div className="muted small">${c.no} · issued ${fmtDay(c.at)}${c.exp ? ' · valid until ' + fmtDay(c.exp) : ''} · score ${c.avg}%</div>
                    </div>
                    <div className="actions">
                      <button type="button" className="btn ghost sm" disabled=${busy === c.id} onClick=${() => pdf(c)}><${Icon} n="down" />${busy === c.id ? 'Preparing…' : 'Certificate (PDF)'}</button>
                      <a className="btn sm rsnet" style=${{ '--net': '#0A66C2' }} href=${exLinkedInAdd(c, d.org)} target="_blank" rel="noopener noreferrer"><${Icon} n="plus" />Add to LinkedIn profile</a>
                      <a className="btn ghost sm" href=${'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(exShareUrl(c))} target="_blank" rel="noopener noreferrer"><${Icon} n="send" />Share</a>
                      <a className="btn ghost sm" href=${'#/verify?no=' + encodeURIComponent(c.no) + '&code=' + encodeURIComponent(c.code)} target="_blank" rel="noopener">Verification page</a>
                    </div>
                  </div>`;
              })}</div>`
            : html`<p className="muted small">None yet. Course certificates are under Learning > My certificates.</p>`
        }
      </section>
      ${
        ask &&
        html`<${Modal} title=${'Start: ' + ask.t} onClose=${() => setAsk(null)} foot=${html`<button className="btn ghost" onClick=${() => setAsk(null)}>Not now</button><button className="btn" onClick=${() => start(ask)}>Start the exam</button>`}>
          <ul className="tllist">
            <li>${ask.n} questions from: ${ask.topics.join(', ')}.</li>
            <li>${ask.min} minutes; the clock keeps running if you leave, and answers are handed in when the time is up.</li>
            <li>${ask.pass}% passes. You have ${ask.me.left} of ${ask.tries} attempts left this month${ask.cool ? `, with ${ask.cool} hours between attempts` : ''}.</li>
            <li>Stay on the page: switching tabs or windows is noted for the reviewers.</li>
          </ul>
        <//>`
      }
    </div>`;
}

/* ---- the public verification page (#/verify?no=…&code=…), linked from certificates and LinkedIn ---- */
function VerifyPage({ q }) {
  const [no, setNo] = useState((q && q.no) || '');
  const [code, setCode] = useState((q && q.code) || '');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const check = async () => {
    if (!no.trim() || !code.trim()) return;
    setBusy(true);
    try {
      setRes(await api('learn_cert_verify', { no: no.trim(), code: code.trim() }));
    } catch (e) {
      setRes({ valid: false, err: errText(e) });
    }
    setBusy(false);
  };
  useEffect(() => {
    if (q && q.no && q.code) check();
  }, []);
  return html`<${Fragment}>
      <${PageHead} title="Verify a certificate" intro="Check a StratEdge IT Consulting certificate or certification with its number and code." />
      <section className="sec">
        <div className="wrap" style=${{ maxWidth: 760 }}>
          <div className="panel form">
            <div className="row3">
              <${Field} label="Certificate number"><input value=${no} onInput=${e => setNo(e.target.value)} placeholder="SEC-2026-0001" /><//>
              <${Field} label="Verification code"><input value=${code} onInput=${e => setCode(e.target.value)} /><//>
              <div className="actions" style=${{ alignSelf: 'end' }}><button type="button" className="btn" disabled=${busy} onClick=${check}>${busy ? 'Checking…' : 'Check'}</button></div>
            </div>
            ${
              res &&
              (res.valid
                ? html`<div className=${'note ' + (res.expired ? 'amber' : 'ok')}><span>
                    <b>${res.expired ? 'Valid, but expired.' : 'Valid.'}</b> ${res.n} ${res.kind === 'prog' ? html`holds <b>${res.t}</b>${res.level ? ' (' + res.level + ')' : ''}` : html`completed <b>${res.t}</b>`}, issued ${fmtDay(res.at)}${res.exp ? (res.expired ? ', expired ' : ', valid until ') + fmtDay(res.exp) : ''}. Certificate ${res.no}.
                    ${res.skills && res.skills.length ? html`<br />Covers: ${res.skills.join(', ')}.` : ''}
                  </span></div>`
                : html`<div className="note red"><span><b>Not found.</b> ${res.err || 'Check the number and the code as printed on the certificate.'}</span></div>`)
            }
          </div>
        </div>
      </section>
    <//>`;
}
