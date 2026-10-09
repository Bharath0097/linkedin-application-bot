/* ================= v35: Application bot, inside the portal =================
   The queue, approvals, run history and settings are saved in the portal (api/appbot.php), the profile comes from the
   Apply profile and the résumé from My résumés. The StratEdge browser companion (browser-companion/, installed once in
   Chrome or Edge) fills the employer forms: this page talks to it directly on the StratEdge addresses (the companion's
   externally_connectable list; fixed id below), or through its page bridge on any other address, and saves what it
   reports back. Job boards (Dice, LinkedIn, Indeed, ZipRecruiter, Monster, Glassdoor) are a manual handoff. */
const AB_EXT_ID = 'bbedkgbbiichnoaafcmjkggegglpdeon';
const AB_STATUS = {
  queued: ['Ready', ''],
  manual: ['Apply on the board', 'amber'],
  review: ['Needs you', 'amber'],
  submitted: ['Submitted', 'ok'],
  uncertain: ['Check the result', 'amber'],
  error: ['Problem', 'red'],
  skipped: ['Skipped', ''],
};
const abNorm = v =>
  String(v == null ? '' : v)
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
/** How many of the person's skills the job description mentions (a transparent coverage percentage). */
function abScore(desc, skills) {
  if (!String(desc || '').trim()) return null;
  const keys = String(skills || '')
    .split(/[,\n]+/)
    .map(s => s.trim())
    .filter(Boolean);
  if (!keys.length) return null;
  const d = ' ' + abNorm(desc) + ' ';
  return Math.round((100 * keys.filter(k => d.includes(' ' + abNorm(k) + ' ')).length) / keys.length);
}
function abParseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') {
      if (quoted && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some(v => v.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (quoted) throw new Error('The CSV has an unclosed quoted field.');
  row.push(cell);
  if (row.some(v => v.trim())) rows.push(row);
  if (!rows.length) return [];
  const head = rows.shift().map(abNorm);
  return rows.map(v => Object.fromEntries(head.map((h, i) => [h, v[i] == null ? '' : v[i]])));
}
/** Whether a link is on a job board (a manual handoff) rather than an employer's own application site. */
const abIsBoard = url => {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return /(^|\.)(dice|linkedin|ziprecruiter)\.com$/.test(h) || /(^|\.)(indeed|monster|glassdoor)\.(com|co\.uk|co\.in|ca|fr|de|nl|com\.au|co\.za)$/.test(h);
  } catch (e) {
    return true;
  }
};
const abCsvCell = v => {
  const s = String(v == null ? '' : v);
  return '"' + (/^\s*[=+@-]/.test(s) ? "'" + s : s).replace(/"/g, '""') + '"';
};
/* ---- v35.1: the sites allowed to submit by themselves ---- */
/** The site a link is on (lower case), or '' for something that is not a link. */
const abHost = url => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (e) {
    return '';
  }
};
/** A line of the allowed-sites list as the exact site name the companion compares: a pasted link keeps only its site
    (the server has the final say and explains any line it cannot use). */
const abHostIn = v => {
  const s = String(v || '').trim();
  if (!s || s.includes('*')) return s;
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : 'https://' + s.replace(/^\/+/, '')).hostname.replace(/\.$/, '') || s;
  } catch (e) {
    return s;
  }
};
// application sites many employers share: allowing one lets the bot submit by itself to every employer there
const AB_SHARED_HOSTS = /(^|\.)(jobs\.lever\.co|boards\.greenhouse\.io|job-boards\.greenhouse\.io|jobs\.ashbyhq\.com|apply\.workable\.com|jobs\.smartrecruiters\.com|jobs\.jobvite\.com|recruiting\.paylocity\.com|recruiting\.ultipro\.com|workforcenow\.adp\.com)$/;
/** Why "Submit by itself" cannot submit this job by itself (the companion's own checks, made before it starts), or null. */
function abAutoBlock(j, s, skills) {
  const host = abHost(j.url);
  if (!(s.allowedHosts || []).includes(host)) return { why: 'site', host };
  const sc = abScore(j.description, skills);
  if (sc === null) return { why: 'info', host };
  if (sc < Number(s.minScore)) return { why: 'low', host, sc };
  return null;
}
// the companion's own wording (it is installed on each computer, so the portal says it plainly instead)
const AB_NOTE_SITE = 'Enable this exact employer hostname in Bot settings.';
const AB_LIMIT_MSG = 'Your daily automatic submission limit has been reached.';
const AB_NOTES = {
  [AB_NOTE_SITE]: h => 'Filled, not submitted: ' + (h || 'this site') + ' is not on your list of sites the bot may submit to by itself. Check the open form and submit it, or allow the site.',
  [AB_LIMIT_MSG]: () => 'Filled, not submitted: today’s limit of automatic submissions was reached. Check the open form and submit it yourself.',
  'Keyword coverage is below your automatic submission threshold.': () => 'Filled, not submitted: the job matches less of your skills than your automatic-submission setting. Check the open form and submit it yourself.',
  'Add the job description and your skills before automatic submission.': () => 'Filled, not submitted: automatic submission needs the job description and the skills in your Apply profile.',
};
const AB_RUN_ERR = {
  [AB_NOTE_SITE]: 'A job’s site is not on your list of sites the bot may submit to by itself. Allow it under Settings, or choose “Fill and let me submit”.',
  'Keyword coverage is below your automatic submission threshold.': 'A job matches less of your skills than your automatic-submission setting (Settings).',
  'Add the job description and your skills before automatic submission.': 'Automatic submission needs each job’s description and the skills in your Apply profile.',
  'Add your name and email to your profile.': 'Add your name and email to your Apply profile first (Profile & answers).',
};
const abNoteText = (note, j) => (AB_NOTES[note] ? AB_NOTES[note](abHost(j.url)) : note);

/* ---- talking to the companion ---- */
let abChannel = null;
function abBridge(action, payload) {
  // the companion's page bridge (when the portal address was entered in the companion)
  return new Promise((res, rej) => {
    const id = nid();
    abChannel = abChannel || nid();
    const on = e => {
      const m = e.data;
      if (e.source !== window || !m || m.source !== 'applypilot-companion' || m.id !== id) return;
      removeEventListener('message', on);
      clearTimeout(t);
      m.error ? rej(new Error(m.error)) : res(m.result);
    };
    const t = setTimeout(() => {
      removeEventListener('message', on);
      rej(new Error('not-connected'));
    }, 2500);
    addEventListener('message', on);
    window.postMessage({ source: 'applypilot-dashboard', action, id, channel: abChannel, payload }, location.origin);
  });
}
function abExt(action, payload) {
  const rt = window.chrome && window.chrome.runtime;
  // v83: ACK goes through the page bridge too, or the companion keeps every report and the poll replays them over statuses set by hand
  if (!rt || typeof rt.sendMessage !== 'function') return abBridge(action, payload);
  return new Promise((res, rej) => {
    let done = false;
    const t = setTimeout(() => {
      if (!done) {
        done = true;
        rej(new Error('not-connected'));
      }
    }, 5000);
    try {
      rt.sendMessage(AB_EXT_ID, { action, payload, ...(payload && payload.ids ? { ids: payload.ids, at: payload.at } : {}) }, r => {
        if (done) return;
        done = true;
        clearTimeout(t);
        if (rt.lastError || !r) return rej(new Error('not-connected'));
        r.error ? rej(new Error(r.error)) : res(r.result);
      });
    } catch (e) {
      done = true;
      clearTimeout(t);
      rej(new Error('not-connected'));
    }
  }).catch(e => (e.message === 'not-connected' ? abBridge(action, payload) : Promise.reject(e)));
}

/* ---- the page ---- */
function ApplicationBotPage() {
  const P = usePortal();
  const toast = useToast();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState('jobs');
  const [ext, setExt] = useState({ state: 'checking' });
  const [edit, setEdit] = useState(null);
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState('');
  const [gate, setGate] = useState(null);
  const load = () => api('ab_boot', {}).then(setD, setErr);
  useEffect(() => {
    load();
  }, []);
  const jobsRef = useRef([]);
  jobsRef.current = d ? d.jobs : [];
  const dRef = useRef(null);
  dRef.current = d;
  const synced = useRef(false);
  const abSeen = useRef(new Set()); // companion reports already saved during this visit (an older companion without ACK keeps sending them)
  // opened as #/portal/appbot?run=<job> (the "Apply with bot" button on Matched jobs): that job runs once the companion answers
  const runOf = () => (location.hash.split('?')[1] || '').match(/(?:^|&)run=([a-f0-9]{8,24})/);
  const runParam = useRef(runOf());
  const [runTick, setRunTick] = useState(0);
  useEffect(() => {
    // also when the page is already open and the address changes to ?run=
    const on = () => {
      const m = runOf();
      if (m) {
        runParam.current = m;
        load().then(() => setRunTick(t => t + 1));
      }
    };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  useEffect(() => {
    if (!d || ext.state !== 'on' || !runParam.current) return;
    const id = runParam.current[1];
    const j = d.jobs.find(x => x.id === id);
    if (!j) return;
    runParam.current = null;
    applyNow(j);
  }, [!!d, ext.state, runTick]);
  // the companion's state, and its reports saved into the portal
  useEffect(() => {
    let stop = false;
    let timer = null;
    const tick = async () => {
      let st;
      try {
        st = await abExt('PING');
        setExt({ state: 'on', version: st.version, running: !!st.running });
        if (!synced.current && dRef.current) {
          // once per visit: the companion's popup fills any application form in one click with these
          synced.current = true;
          const cur = dRef.current;
          api('ab_resume', {})
            .then(r => abExt('SYNC', { profile: { ...cur.profile, answers: { ...cur.profile.answers, ...Object.fromEntries(cur.answers.map(x => [x.q, x.a])) } }, resume: r.resume || null, name: cur.profile.fullName }))
            .catch(() => (synced.current = false));
        }
        const mine = new Map(jobsRef.current.map(j => [j.id, j]));
        const saved = [];
        const at = {};
        for (const u of st.updates || []) {
          const j = mine.get(u.id);
          if (!j) continue;
          const key = u.id + '|' + (u.updatedAt || '');
          if (abSeen.current.has(key)) continue;
          if (j.status !== u.status || j.note !== (u.note || '')) {
            const r = await api('ab_job_status', { id: u.id, status: u.status, note: u.note || '' });
            setD(x => (x ? { ...x, today: r.today, jobs: x.jobs.map(y => (y.id === u.id ? r.job : y)) } : x));
          }
          saved.push(u.id);
          at[u.id] = u.updatedAt;
          abSeen.current.add(key);
        }
        if (saved.length) abExt('ACK', { ids: saved, at }).catch(() => {});
      } catch (e) {
        setExt({ state: 'off' });
      }
      if (!stop) timer = setTimeout(tick, st && st.running ? 2500 : 12000);
    };
    tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, []);
  if (err && !d) return html`<${LoadError} error=${err} onRetry=${load} />`;
  if (!d) return html`<${Spinner} label="Loading the application bot…" />`;
  const practiceUrl = new URL(d.practice, location.href.split('#')[0]).href;
  const p = d.profile;
  const jobs = d.jobs;
  const up = j => setD(x => ({ ...x, jobs: x.jobs.some(y => y.id === j.id) ? x.jobs.map(y => (y.id === j.id ? j : y)) : [j, ...x.jobs] }));
  const ready = Math.round((100 * [p.fullName, p.firstName, p.lastName, p.email, p.phone, d.resume && !d.resume.error].filter(Boolean).length) / 6);
  const counts = {
    queue: jobs.filter(j => j.status === 'queued').length,
    review: jobs.filter(j => ['review', 'uncertain', 'error'].includes(j.status)).length,
    sent: jobs.filter(j => j.status === 'submitted').length,
  };
  const act = async (key, fn, msg) => {
    setBusy(key);
    try {
      const r = await fn();
      if (msg) toast(typeof msg === 'function' ? msg(r) : msg);
      return r;
    } catch (e) {
      if (!e || e.code !== 'cancelled') toast(e && e.message === 'not-connected' ? 'The browser companion is not connected: see Set up.' : errText(e), true);
    } finally {
      setBusy('');
    }
  };
  // v35.1: one click adds sites to the "submit by itself" list
  const allowHosts = async hosts => {
    const r = await api('ab_allow_host', { hosts });
    setD(x => ({ ...x, settings: r.settings }));
    return r.settings;
  };
  const runJobs = (list, opt = {}) =>
    act('run', async () => {
      const go = list.filter(j => j.approved && j.status !== 'manual' && !['submitted', 'uncertain'].includes(j.status));
      if (!go.length) throw { message: 'Approve an employer job first. Job boards are applied to by hand.' };
      if (ext.state !== 'on') throw { message: 'not-connected' };
      const settings = opt.settings || (dRef.current || d).settings;
      if (settings.mode === 'auto' && !opt.checked) {
        // v35.1: the companion refuses the whole run when one job cannot be submitted by itself and does not say which
        // site; the portal checks first, names it and offers the choices
        const blocked = go.map(j => ({ j, b: abAutoBlock(j, settings, p.skills) })).filter(x => x.b);
        if (blocked.length) {
          setGate({ jobs: go, blocked });
          throw { code: 'cancelled' };
        }
      }
      const r = await api('ab_resume', {});
      const answers = { ...p.answers, ...Object.fromEntries(d.answers.map(x => [x.q, x.a])) };
      try {
        await abExt('RUN', {
          profile: { ...p, answers },
          settings,
          resume: r.resume || null,
          jobs: go.map(j => ({ id: j.id, url: j.url, title: j.title, company: j.company, location: j.location, description: j.description, approved: true, status: 'queued' })),
        });
      } catch (e) {
        if (e && e.message === AB_LIMIT_MSG) {
          setGate({ jobs: go, blocked: [], limit: settings.dailyLimit });
          throw { code: 'cancelled' };
        }
        throw e && AB_RUN_ERR[e.message] ? { message: AB_RUN_ERR[e.message] } : e;
      }
      setExt(x => ({ ...x, running: true }));
      return go.length;
    }, n => 'The companion is working on ' + n + ' job' + (n === 1 ? '' : 's') + ' in new tabs. Keep this page open to see the results.');
  const setStatus = (j, status, note) => act('st' + j.id, async () => up((await api('ab_job_status', { id: j.id, status, note })).job));
  const remove = j => window.confirm('Remove ' + j.title + ' at ' + j.company + ' from your queue?') && act('rm' + j.id, async () => {
      await api('ab_job_delete', { id: j.id });
      setD(x => ({ ...x, jobs: x.jobs.filter(y => y.id !== j.id) }));
    }, 'Removed.');
  const approve = j => act('ap' + j.id, async () => up((await api('ab_job_save', { ...j, approved: !j.approved })).job));
  const applyNow = async j => {
    let job = j;
    if (!j.approved) {
      const r = await act('ap' + j.id, () => api('ab_job_save', { ...j, approved: true }));
      if (!r) return;
      up(r.job);
      job = r.job;
    }
    runJobs([job]);
  };
  const importCsv = file =>
    act('csv', async () => {
      const rows = abParseCsv(await file.text());
      const r = await api('ab_jobs_add', { src: 'csv', jobs: rows.map(x => ({ url: x.url, title: x.title, company: x.company, location: x.location, description: x.description, approved: /^(yes|true|1|y)$/i.test(String(x.approved || '').trim()) })) });
      setD(x => ({ ...x, jobs: r.jobs }));
      return r;
    }, r => r.added + ' job' + (r.added === 1 ? '' : 's') + ' added' + (r.skipped.length ? '; skipped ' + r.skipped.length + ' (' + r.skipped.slice(0, 3).join('; ') + ')' : '') + '.');
  const exportCsv = () => {
    const head = ['title', 'company', 'url', 'location', 'status', 'approved', 'description'];
    const csv = [head.join(','), ...jobs.map(j => head.map(h => abCsvCell(h === 'approved' ? (j.approved ? 'yes' : 'no') : j[h])).join(','))].join('\r\n');
    saveDownload('application-bot-jobs.csv', new Blob([csv], { type: 'text/csv' }));
  };
  const shown = jobs.filter(j => filter === 'all' || (filter === 'review' ? ['review', 'uncertain', 'error'].includes(j.status) : j.status === filter));
  const TABS = [
    ['jobs', 'Applications'],
    ['profile', 'Profile & answers'],
    ['boards', 'Job boards'],
    ['settings', 'Settings'],
    ['setup', 'Set up the companion'],
    ...(d.staff ? [['team', 'Team activity']] : []),
  ];
  const extChip =
    ext.state === 'on'
      ? html`<${Chip} s="ok">Companion connected${ext.version ? ' · v' + ext.version : ''}${ext.running ? ' · working' : ''}<//>`
      : ext.state === 'checking'
        ? html`<${Chip}>Looking for the companion…<//>`
        : html`<button type="button" className="chip amber" onClick=${() => setTab('setup')}>Companion not connected: set it up</button>`;
  return html`<div className="stack abpage">
      <div className="ph-row" style=${{ margin: 0, flexWrap: 'wrap', gap: 10 }}>
        <p className="muted small" style=${{ margin: 0, maxWidth: 680 }}>Queue jobs you want, approve each one after reading it, and the companion fills the employer’s form in your browser. It stops for sign-ins, CAPTCHAs and questions it cannot answer, and reports “submitted” only after a visible confirmation.</p>
        ${extChip}
      </div>
      <${KitStats} items=${[
        { v: counts.queue, l: 'Ready to run', onClick: () => (setTab('jobs'), setFilter('queued')) },
        { v: counts.review, l: 'Need you', tone: counts.review ? 'warn' : '', onClick: () => (setTab('jobs'), setFilter('review')) },
        { v: counts.sent, l: 'Submitted' + (d.today ? ' (' + d.today + ' today)' : ''), tone: counts.sent ? 'ok' : '', onClick: () => (setTab('jobs'), setFilter('submitted')) },
        { v: ready + '%', l: 'Profile ready', tone: ready === 100 ? 'ok' : 'warn', onClick: () => setTab('profile') },
      ]} />
      <${KitTabs} wrap tabs=${TABS} tab=${tab} onTab=${setTab} />
      ${
        tab === 'jobs'
          ? html`<section className="panel stack" style=${{ gap: 12 }}>
              <div className="ph-row" style=${{ margin: 0, flexWrap: 'wrap', gap: 8 }}>
                <div className="actions">
                  ${[['all', 'All'], ['queued', 'Ready'], ['review', 'Need you'], ['manual', 'Job boards'], ['submitted', 'Submitted']].map(([k, n]) => html`<button key=${k} type="button" className=${'btn sm ' + (filter === k ? '' : 'ghost')} onClick=${() => setFilter(k)}>${n}</button>`)}
                </div>
                <div className="actions">
                  <button type="button" className="btn sm" onClick=${() => setEdit({})}><${Icon} n="plus" />Add a job</button>
                  <label className="btn ghost sm" style=${{ cursor: 'pointer' }}>Import CSV<input type="file" accept=".csv,text/csv" hidden onChange=${e => e.target.files[0] && importCsv(e.target.files[0])} /></label>
                  ${jobs.length > 0 && html`<button type="button" className="btn ghost sm" onClick=${exportCsv}>Export</button>`}
                  ${ext.running ? html`<button type="button" className="btn ghost sm" disabled=${!!busy} onClick=${() => act('stop', () => abExt('STOP'), 'The bot is paused.').then(() => setExt(x => ({ ...x, running: false })))}>Pause the bot</button>` : html`<button type="button" className="btn sm" disabled=${!!busy} onClick=${() => runJobs(jobs.filter(j => j.status === 'queued'))}><${Icon} n="bolt" />${busy === 'run' ? 'Starting…' : 'Run approved jobs'}</button>`}
                </div>
              </div>
              ${
                shown.length === 0
                  ? html`<${Empty} title=${jobs.length ? 'Nothing here' : 'Your queue is empty'} action=${!jobs.length && html`<button type="button" className="btn" onClick=${() => setEdit({})}>Add a job</button>`}>${jobs.length ? 'Choose another filter.' : 'Add an employer’s application link, queue matches from Job portals, or import a CSV (title, company, url, location, description, approved).'}<//>`
                  : html`<ul className="list abjobs">${shown.map(j => {
                      const sc = abScore(j.description, p.skills);
                      const [sl, stone] = AB_STATUS[j.status] || [j.status, ''];
                      const host = abHost(j.url);
                      const canAllow = !j.board && host && j.note === AB_NOTE_SITE && !(d.settings.allowedHosts || []).includes(host);
                      return html`<li key=${j.id} className="abjob">
                        <div className="t">
                          <b>${j.title}</b>
                          <span className="muted small">${j.company}${j.location ? ' · ' + j.location : ''} · ${j.board || host}</span>
                          <span className="abjob-chips"><${Chip} s=${stone}>${sl}<//>${j.status !== 'manual' && html`<${Chip} s=${j.approved ? 'ok' : ''}>${j.approved ? 'Approved' : 'Not approved'}<//>`}${sc !== null && html`<${Chip} s=${sc >= d.settings.minScore ? 'ok' : ''}>${sc}% skills match<//>`}</span>
                          ${j.note && html`<span className="small abnote">${abNoteText(j.note, j)}</span>`}
                        </div>
                        <div className="actions">
                          ${canAllow ? html`<button type="button" className="btn sm" disabled=${!!busy} onClick=${() => act('al' + j.id, () => allowHosts([host]), host + ' is on your list: the bot can submit there by itself.')}>Allow ${host}</button>` : null}
                          ${j.status === 'manual' ? html`<a className="btn sm" href=${j.url} target="_blank" rel="noopener noreferrer">Open on ${j.board}</a><button type="button" className="btn ghost sm" disabled=${!!busy} onClick=${() => setStatus(j, 'submitted', 'Applied on ' + j.board + ' by hand.')}>I applied</button>` : null}
                          ${j.status !== 'manual' && !['submitted', 'uncertain'].includes(j.status) ? html`<button type="button" className=${'btn sm ' + (j.approved ? 'ghost' : '')} disabled=${!!busy} onClick=${() => approve(j)}>${j.approved ? 'Unapprove' : 'Approve'}</button>` : null}
                          ${j.status !== 'manual' && !['submitted', 'uncertain'].includes(j.status) ? html`<button type="button" className="btn sm" disabled=${!!busy || ext.running} onClick=${() => applyNow(j)} title=${j.approved ? 'Run this application now' : 'Approve and run this application now'}><${Icon} n="bolt" />Apply now</button>` : null}
                          ${j.status === 'uncertain' || j.status === 'review' || j.status === 'error' ? html`<button type="button" className="btn ghost sm" disabled=${!!busy} onClick=${() => setStatus(j, 'submitted', 'Confirmed by hand.')}>It was submitted</button>` : null}
                          ${['review', 'error', 'skipped'].includes(j.status) ? html`<button type="button" className="btn ghost sm" disabled=${!!busy} onClick=${() => setStatus(j, 'queued', '')}>Queue again</button>` : null}
                          <a className="btn ghost sm" href=${j.url} target="_blank" rel="noopener noreferrer" title="Open the application">Open</a>
                          <button type="button" className="btn ghost icon sm" aria-label="Edit" title="Edit" onClick=${() => setEdit(j)}><${Icon} n="pen" /></button>
                          <button type="button" className="btn ghost icon sm" aria-label="Remove" title="Remove" disabled=${!!busy} onClick=${() => remove(j)}><${Icon} n="trash" /></button>
                        </div>
                      </li>`;
                    })}</ul>`
              }
            </section>`
          : tab === 'profile'
            ? html`<${AbProfileTab} d=${d} P=${P} ready=${ready} onAnswers=${answers => setD(x => ({ ...x, answers }))} />`
            : tab === 'boards'
              ? html`<${AbBoardsTab} d=${d} onAdd=${() => setEdit({})} />`
              : tab === 'settings'
                ? html`<${AbSettingsTab} d=${d} onSaved=${settings => setD(x => ({ ...x, settings }))} />`
                : tab === 'team'
                  ? html`<${AbTeamTab} />`
                  : html`<${AbSetupTab} d=${d} practiceUrl=${practiceUrl} ext=${ext} onPractice=${async () => {
                      const j = await act('pr', () => api('ab_job_save', { url: practiceUrl, title: 'Network Security Engineer (practice)', company: 'StratEdge practice form', location: 'Test only', description: 'Practice application: no employer receives it. Cisco, BGP, OSPF, Azure, network security.', approved: true, src: 'practice' }), 'The practice job is in your queue, approved.');
                      if (j) {
                        up(j.job);
                        setTab('jobs');
                      }
                    }} />`
      }
      ${edit && html`<${AbJobModal} job=${edit} onClose=${() => setEdit(null)} onSaved=${j => {
        up(j);
        setEdit(null);
      }} />`}
      ${gate && html`<${AbGateModal} gate=${gate} settings=${d.settings} skills=${p.skills} busy=${!!busy}
        onClose=${() => setGate(null)}
        onAllow=${async hosts => {
          const jobs = gate.jobs;
          const s = await act('allow', () => allowHosts(hosts));
          if (!s) return;
          setGate(null);
          runJobs(jobs, { settings: s });
        }}
        onFill=${() => {
          const jobs = gate.jobs;
          setGate(null);
          runJobs(jobs, { settings: { ...d.settings, mode: 'review' }, checked: true });
        }}
        onReady=${ready => {
          setGate(null);
          runJobs(ready, { checked: true });
        }}
        onSettings=${() => {
          setGate(null);
          setTab('settings');
        }} />`}
    </div>`;
}

/** v35.1: before "Submit by itself" starts, the jobs it cannot submit by itself and the choices (instead of the
    companion's one-line refusal). Also shown when today's automatic submissions are used up. */
function AbGateModal({ gate, settings, skills, busy, onClose, onAllow, onFill, onReady, onSettings }) {
  const blocked = gate.blocked || [];
  const hosts = [...new Set(blocked.filter(x => x.b.why === 'site').map(x => x.b.host))];
  const other = blocked.filter(x => x.b.why !== 'site');
  const ready = gate.limit ? [] : gate.jobs.filter(j => !blocked.some(x => x.j.id === j.id));
  const n = gate.jobs.length;
  const perHost = h => blocked.filter(x => x.b.host === h && x.b.why === 'site').length;
  return html`<${Modal} title=${gate.limit ? 'Today’s automatic submissions are used up' : 'Before the bot submits by itself'} onClose=${onClose}>
      <div className="stack abgate" style=${{ gap: 12 }}>
        ${gate.limit ? html`<p style=${{ margin: 0 }}>The bot has reached today’s limit of automatic submissions (your Settings allow ${gate.limit} a day). It can still fill ${n === 1 ? 'this job' : 'these ' + n + ' jobs'} for you to check and submit.</p>` : null}
        ${hosts.length > 0 &&
        html`<div className="stack" style=${{ gap: 6 }}>
          <p style=${{ margin: 0 }}><b>${hosts.length === 1 ? 'This site is' : 'These sites are'} not on your list of sites the bot may submit to by itself:</b></p>
          <ul className="abgate-list">${hosts.map(h => html`<li key=${h}><code>${h}</code> <span className="muted small">${perHost(h)} job${perHost(h) === 1 ? '' : 's'}${AB_SHARED_HOSTS.test(h) ? ' · many employers take applications on this site: allowing it covers all of them' : ''}</span></li>`)}</ul>
        </div>`}
        ${other.length > 0 &&
        html`<div className="stack" style=${{ gap: 6 }}>
          <p style=${{ margin: 0 }}><b>${other.length === 1 ? 'This job does' : 'These jobs do'} not meet your settings for automatic submission:</b></p>
          <ul className="abgate-list">${other.map(x => html`<li key=${x.j.id}>${x.j.title} · ${x.j.company} <span className="muted small">${x.b.why === 'low' ? x.b.sc + '% skills match; your setting is ' + settings.minScore + '%' : String(skills || '').trim() ? 'no job description to compare with your skills (edit the job to add it)' : 'add your skills to your Apply profile'}</span></li>`)}</ul>
        </div>`}
        ${hosts.length > 0 && html`<p className="muted small" style=${{ margin: 0 }}>Allow only sites whose terms let you apply with automated tools. You can remove a site under Settings at any time.</p>`}
        <div className="actions">
          ${hosts.length > 0 && html`<button type="button" className="btn" disabled=${busy} onClick=${() => onAllow(hosts)}>Allow ${hosts.length === 1 ? hosts[0] : 'these ' + hosts.length + ' sites'} and run</button>`}
          <button type="button" className=${'btn' + (hosts.length ? ' ghost' : '')} disabled=${busy} onClick=${onFill}>Fill ${n === 1 ? 'it' : 'them'} and let me submit</button>
          ${ready.length > 0 && html`<button type="button" className="btn ghost" disabled=${busy} onClick=${() => onReady(ready)}>Run only the ${ready.length} that can submit by ${ready.length === 1 ? 'itself' : 'themselves'}</button>`}
          ${gate.limit && html`<button type="button" className="btn ghost" onClick=${onSettings}>Change the daily limit</button>`}
          <button type="button" className="btn ghost" onClick=${onClose}>Cancel</button>
        </div>
      </div>
    <//>`;
}

function AbJobModal({ job, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ url: job.url || '', title: job.title || '', company: job.company || '', location: job.location || '', description: job.description || '', approved: !!job.approved });
  const [busy, setBusy] = useState(false);
  const save = async e => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api('ab_job_save', { ...f, ...(job.id ? { id: job.id } : {}) });
      toast(job.id ? 'Saved.' : r.job.status === 'manual' ? 'Added. Job boards are applied to by hand: open it from the queue.' : 'Added to your queue.');
      onSaved(r.job);
    } catch (x) {
      toast(errText(x), true);
    }
    setBusy(false);
  };
  return html`<${Modal} title=${job.id ? 'Edit the job' : 'Add a job'} onClose=${onClose}>
      <form className="form" onSubmit=${save}>
        <${Field} label="Application link" hint="The employer’s https:// application page (job board links are a manual handoff)."><input type="url" value=${f.url} onInput=${e => setF({ ...f, url: e.target.value })} required autoFocus /><//>
        <div className="row2">
          <${Field} label="Job title"><input value=${f.title} onInput=${e => setF({ ...f, title: e.target.value })} required /><//>
          <${Field} label="Company"><input value=${f.company} onInput=${e => setF({ ...f, company: e.target.value })} required /><//>
        </div>
        <${Field} label="Location"><input value=${f.location} onInput=${e => setF({ ...f, location: e.target.value })} /><//>
        <${Field} label="Job description" hint="Paste it: the skills match and automatic submission use it."><textarea rows="6" value=${f.description} onInput=${e => setF({ ...f, description: e.target.value })} /><//>
        <label className="check"><input type="checkbox" checked=${f.approved} onChange=${e => setF({ ...f, approved: e.target.checked })} /><span>I read this job and approve applying with my saved profile</span></label>
        <div className="actions"><button className="btn" disabled=${busy}>${busy ? 'Saving…' : job.id ? 'Save' : 'Add to my queue'}</button><button type="button" className="btn ghost" onClick=${onClose}>Cancel</button></div>
      </form>
    <//>`;
}

function AbProfileTab({ d, P, ready, onAnswers }) {
  const toast = useToast();
  const p = d.profile;
  const [rows, setRows] = useState(d.answers.length ? d.answers : [{ q: '', a: '' }]);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api('ab_answers_save', { answers: rows });
      onAnswers(r.answers);
      setRows(r.answers.length ? r.answers : [{ q: '', a: '' }]);
      toast('Saved answers updated.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const fields = [
    ['Full name', p.fullName],
    ['Email', p.email],
    ['Phone', p.phone],
    ['City, state, country', [p.city, p.state, p.country].filter(Boolean).join(', ')],
    ['LinkedIn', p.linkedin],
    ['Current title', p.currentTitle],
    ['Years of experience', p.yearsExperience],
    ['Skills', p.skills],
    ['Authorized to work in the US', p.workAuthorization],
    ['Needs visa sponsorship', p.sponsorship],
    ['Willing to relocate', p.relocation],
    ['Salary expectation', p.salary],
  ];
  return html`<div className="stack">
      <section className="panel stack" style=${{ gap: 10 }}>
        <div className="ph-row" style=${{ margin: 0 }}><h2 className="ph">What the bot fills in</h2><${Chip} s=${ready === 100 ? 'ok' : 'amber'}>${ready}% ready<//></div>
        <p className="muted small" style=${{ margin: 0 }}>From your Apply profile in the portal (change it there and the bot uses the new details right away). Work authorization, sponsorship and salary are only ever what you wrote: the bot never guesses them.</p>
        <dl className="kv">${fields.map(([k, v]) => html`<${Fragment} key=${k}><dt>${k}</dt><dd>${v || html`<span className="muted">not set</span>`}</dd><//>`)}</dl>
        <div className="actions"><a className="btn sm" href=${growHref(P, 'autofill')}>Edit my Apply profile</a></div>
      </section>
      <section className="panel stack" style=${{ gap: 10 }}>
        <h2 className="ph" style=${{ margin: 0 }}>Résumé</h2>
        ${
          d.resume && !d.resume.error
            ? html`<p style=${{ margin: 0 }}><${Icon} n="file" /> <b>${d.resume.name}</b> <span className="muted small">(your active résumé: attached when a form asks for one)</span></p>`
            : html`<p className="note amber" style=${{ margin: 0 }}><span>${(d.resume && d.resume.error) || 'No résumé yet. Upload a PDF or Word (.docx) résumé and make it active.'}</span></p>`
        }
        <div className="actions"><a className="btn ghost sm" href=${growHref(P, 'resume')}>My résumés</a></div>
      </section>
      <section className="panel stack form" style=${{ gap: 10 }}>
        <h2 className="ph" style=${{ margin: 0 }}>Saved answers</h2>
        <p className="muted small" style=${{ margin: 0 }}>For questions employers ask that your profile does not cover. Write the question exactly as the form asks it: the bot only uses exact matches, and leaves anything else for you.</p>
        ${rows.map(
          (x, i) => html`<div key=${i} className="row2 abanswer">
            <${Field} label=${'Question ' + (i + 1)}><input value=${x.q} onInput=${e => setRows(rows.map((y, j) => (j === i ? { ...y, q: e.target.value } : y)))} placeholder="How many years of BGP experience do you have?" /><//>
            <${Field} label="Your answer"><div className="abanswer-a"><input value=${x.a} onInput=${e => setRows(rows.map((y, j) => (j === i ? { ...y, a: e.target.value } : y)))} /><button type="button" className="btn ghost icon sm" aria-label="Remove this answer" onClick=${() => setRows(rows.filter((y, j) => j !== i))}><${Icon} n="x" /></button></div><//>
          </div>`
        )}
        <div className="actions">
          ${rows.length < 100 && html`<button type="button" className="btn ghost sm" onClick=${() => setRows([...rows, { q: '', a: '' }])}><${Icon} n="plus" />Add a question</button>`}
          <button type="button" className="btn sm" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save answers'}</button>
        </div>
      </section>
    </div>`;
}

function AbBoardsTab({ d, onAdd }) {
  const [q, setQ] = useState(d.profile.currentTitle || '');
  const [l, setL] = useState(d.profile.city || '');
  const P = usePortal();
  return html`<div className="stack">
      <section className="panel stack form" style=${{ gap: 10 }}>
        <h2 className="ph" style=${{ margin: 0 }}>Search the job boards</h2>
        <p className="muted small" style=${{ margin: 0 }}>Job boards do not allow automated applications, so the bot never fills their forms. Search here, apply on the board, then keep track in your queue (“I applied”). Employers’ own application pages can be run by the bot.</p>
        <div className="row2">
          <${Field} label="Job title or skills"><input value=${q} onInput=${e => setQ(e.target.value)} /><//>
          <${Field} label="Location"><input value=${l} onInput=${e => setL(e.target.value)} /><//>
        </div>
        <div className="abboards">${d.boards.map(b => html`<a key=${b.id} className="btn ghost sm" target="_blank" rel="noopener noreferrer" href=${b.search.replace('{q}', encodeURIComponent(q)).replace('{l}', encodeURIComponent(l))}>Search ${b.name}</a>`)}</div>
        <div className="actions"><button type="button" className="btn sm" onClick=${onAdd}><${Icon} n="plus" />Add an application link to my queue</button><a className="btn ghost sm" href=${growHref(P, 'jobs')}>My matched jobs</a></div>
      </section>
    </div>`;
}

function AbSettingsTab({ d, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ ...d.settings, hosts: (d.settings.allowedHosts || []).join('\n') });
  const [busy, setBusy] = useState(false);
  const [dropped, setDropped] = useState([]);
  const lines = f.hosts.split(/[\s,;]+/).filter(Boolean);
  const listed = new Set(lines.map(abHostIn));
  // v35.1: the employer sites of approved jobs in the queue that are not on the list yet, one click each
  const suggest = [...new Set(d.jobs.filter(j => j.approved && !j.board && !['submitted', 'manual'].includes(j.status)).map(j => abHost(j.url)).filter(Boolean))].filter(h => !listed.has(h)).slice(0, 12);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api('ab_settings_save', { mode: f.mode, dailyLimit: f.dailyLimit, minScore: f.minScore, allowedHosts: lines.map(abHostIn) });
      onSaved(r.settings);
      setF({ ...r.settings, hosts: r.settings.allowedHosts.join('\n') });
      const left = r.dropped || [];
      setDropped(left);
      toast(left.length ? 'Saved. ' + left.length + ' line' + (left.length === 1 ? ' was' : 's were') + ' left out: see below the list.' : 'Bot settings saved.', left.length > 0);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<section className="panel stack form" style=${{ gap: 12 }}>
      <h2 className="ph" style=${{ margin: 0 }}>What happens when you run a job</h2>
      <div className="checks deskradio">
        <label className="check"><input type="radio" name="abmode" checked=${f.mode !== 'auto'} onChange=${() => setF({ ...f, mode: 'review' })} /><span><b>Fill and let me submit</b> (recommended): the bot fills what it recognises and leaves the form open for you to check and submit.</span></label>
        <label className="check"><input type="radio" name="abmode" checked=${f.mode === 'auto'} onChange=${() => setF({ ...f, mode: 'auto' })} /><span><b>Submit by itself</b> on the employer sites listed below, when every required field is answered and the job matches your skills well enough.</span></label>
      </div>
      <div className="row2">
        <${Field} label="Most automatic submissions a day"><input type="number" min="1" max="50" value=${f.dailyLimit} onInput=${e => setF({ ...f, dailyLimit: +e.target.value })} /><//>
        <${Field} label="Lowest skills match for automatic submission (%)"><input type="number" min="0" max="100" value=${f.minScore} onInput=${e => setF({ ...f, minScore: +e.target.value })} /><//>
      </div>
      <${Field} label="Employer sites allowed to submit by themselves" hint="One per line. Type the site name (careers.example.com) or paste an application link: only that exact site is allowed. Only sites whose terms allow automated applications; job boards cannot be added."><textarea rows="4" value=${f.hosts} onInput=${e => setF({ ...f, hosts: e.target.value })} /><//>
      ${suggest.length > 0 &&
      html`<div className="absuggest">
        <span className="muted small">Employer sites in your queue:</span>
        ${suggest.map(h => html`<button key=${h} type="button" className="btn ghost sm" title="Add to the list (then save)" onClick=${() => setF({ ...f, hosts: (f.hosts.trim() ? f.hosts.trim() + '\n' : '') + h })}><${Icon} n="plus" />${h}</button>`)}
      </div>`}
      ${dropped.length > 0 && html`<p className="note amber" style=${{ margin: 0 }}><span>Left out: ${dropped.map((x, i) => html`<${Fragment} key=${i}>${i ? '; ' : ''}<b>${x.v}</b> (${x.why})<//>`)}.</span></p>`}
      <p className="muted small" style=${{ margin: 0 }}>When you run a job on a site that is not listed, the bot asks first: allow the site in one click, or let it fill the form for you to submit.</p>
      <div className="actions"><button type="button" className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save settings'}</button></div>
    </section>`;
}

function AbSetupTab({ d, practiceUrl, ext, onPractice }) {
  return html`<div className="stack">
      <section className="panel stack" style=${{ gap: 10 }}>
        <div className="ph-row" style=${{ margin: 0 }}><h2 className="ph">The browser companion</h2>${ext.state === 'on' ? html`<${Chip} s="ok">Connected${ext.version ? ' · v' + ext.version : ''}<//>` : html`<${Chip} s="amber">Not connected<//>`}</div>
        <p className="muted small" style=${{ margin: 0 }}>Browsers do not let a web page type into another web site, so a small Chrome (or Edge) extension does the filling, in your own browser. You install it once; everything else happens on this page.</p>
        <ol className="absteps">
          <li><b>Download it.</b> <a className="btn ghost sm" href="application-bot/companion.zip" download><${Icon} n="down" />Download the companion</a> and unzip it into a folder you keep.</li>
          <li><b>Add it to Chrome.</b> Open <code>chrome://extensions</code> (Edge: <code>edge://extensions</code>), switch on <b>Developer mode</b>, choose <b>Load unpacked</b> and pick the unzipped folder.</li>
          <li><b>Come back to this page.</b> It connects by itself: the label above turns to “Connected”.</li>
          <li><b>Run a job.</b> The first time on an employer site, the companion opens a page asking you to allow that site; allow it and press Run again.</li>
        </ol>
        ${ext.state !== 'on' && html`<p className="muted small" style=${{ margin: 0 }}>Installed but not connected? Reload this page. Using the portal at an address other than stratedgeitconsulting.com? Click the companion’s icon, open “Using the portal at another address?” and enter this page’s address.</p>`}
      </section>
      <section className="panel stack" style=${{ gap: 10 }}>
        <h2 className="ph" style=${{ margin: 0 }}>Try it on the practice form</h2>
        <p className="muted small" style=${{ margin: 0 }}>A test application on this site: nothing is sent to any employer. Add it, allow this site when asked, and run it to see the companion fill a form.</p>
        <div className="actions"><button type="button" className="btn sm" onClick=${onPractice}>Add the practice job</button><a className="btn ghost sm" href=${practiceUrl} target="_blank" rel="noopener">Open the practice form</a></div>
      </section>
    </div>`;
}

function AbTeamTab() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    api('ab_team', {}).then(setD, setErr);
  }, []);
  if (err) return html`<${LoadError} error=${err} />`;
  if (!d) return html`<${Spinner} />`;
  return html`<section className="panel stack" style=${{ gap: 8 }}>
      <h2 className="ph" style=${{ margin: 0 }}>Who uses the application bot</h2>
      ${
        d.people.length
          ? html`<div className="tblwrap"><table className="tbl">
              <thead><tr><th>Person</th><th className="r">Jobs queued</th><th className="r">Approved</th><th className="r">Submitted (30 days)</th><th className="r">Need them</th><th>Last activity</th></tr></thead>
              <tbody>${d.people.map(x => html`<tr key=${x.uid}><td><b>${x.n}</b><div className="muted small">${x.e}</div></td><td className="r">${x.jobs}</td><td className="r">${x.approved}</td><td className="r">${x.sent30}</td><td className="r">${x.review}</td><td className="small">${fmtTs(x.last)}</td></tr>`)}</tbody>
            </table></div>`
          : html`<p className="muted small" style=${{ margin: 0 }}>Nobody has queued a job yet.</p>`
      }
    </section>`;
}
