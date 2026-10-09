/* ================= Sourcing connections (Admin › Recruiting › Sourcing connections) =================
   v33: the Dice and iLabor360 credentials (sealed on the server), the job feed job boards and Dice's Job Bot read, Dice
   applicants and iLabor360 requisitions arriving by email.
   v34: the live API connections, configured from each company's API documents (they are given to customers, not
   published): sign-in, the operations with their paths and bodies, where the list sits in the answer and which field
   means what (detected by a test call). Then: iLabor360 requisitions pulled onto the Requirements desk, Dice candidate
   search and import into Candidates, and Dice job posting, updating and closing. Server: api/sources.php and
   api/connectors.php.
   v36.1: "In Talent search": Talent search runs on Dice too; the people found are saved into the ATS (everyone, those
   who fit, nobody) and their full profiles read in the background within a daily allowance (api/tsdice.php). */
const CX_PH = {
  reqs: ['{page}', '{size}', '{offset}', '{since}', '{since_date}', '{sysid}'],
  search: ['{q}', '{location}', '{radius}', '{page}', '{size}', '{offset}'],
  profile: ['{id}'],
  post: ['{title}', '{description}', '{description_html}', '{city}', '{state}', '{zip}', '{location}', '{{remote}}', '{workplace}', '{type}', '{type_code}', '{skills}', '{{skills_list}}', '{rate}', '{duration}', '{visa}', '{apply_url}', '{company}', '{email}', '{job_id}'],
};
CX_PH.update = ['{posting_id}', ...CX_PH.post];
CX_PH.close = ['{posting_id}', '{job_id}'];
const CX_AUTH = [
  ['oauth2', 'OAuth 2.0 (client ID and secret)'],
  ['basic', 'Username and password'],
  ['apikey', 'API key'],
  ['bearer', 'Access token'],
  ['none', 'None'],
];

function cxDiceWebsiteUrl(url) {
  return /^https?:\/\/(?:(?:www|employer|employers)\.)?dice\.com(?:\/|$)/i.test((url || '').trim());
}

function IntegrationRunPanel({ d, cx, reload }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const diceFeed = (d.feed.boards || []).find(b => b.k === 'dice');
  const badDiceWeb = cxDiceWebsiteUrl(cx.api.dice.base);
  const diceSearch = !!cx.api.dice.base && !badDiceWeb && !!cx.api.dice.ops.search.on;
  const dicePostApi = !!cx.api.dice.base && !badDiceWeb && !!cx.api.dice.ops.post.on;
  const ilApi = !!cx.api.ilabor.base && !!cx.api.ilabor.ops.reqs.on;
  const run = async () => {
    setBusy(true);
    try {
      const r = await api('src_run', {}, { timeout: 300000 });
      setRes(r);
      toast('Sourcing and publishing run finished.');
      await reload();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const ds = res && res.dice && res.dice.search;
  const ip = res && res.ilabor && res.ilabor.pull;
  return html`<section className="panel form">
      <div className="ph-row"><div><h3 className="ph" style=${{ margin: 0 }}>Run recruiting integrations</h3><p className="muted small" style=${{ margin: '4px 0 0' }}>One safe run for job publishing, candidate sourcing and requisition intake. The app never treats a Dice website page as an API success.</p></div><button type="button" className="btn" disabled=${busy} onClick=${run}>${busy ? 'Running…' : 'Run sourcing & publishing now'}</button></div>
      <div className="cxhubgrid">
        <div className="cxhubcard" style=${{ cursor: 'default' }}>
          <span className="cxhubtop"><b>Jobs → Dice</b><${Chip} s="ok">Feed ready<//>${dicePostApi ? html`<${Chip} s="ok">Direct API configured<//>` : null}</span>
          <span className="muted small">${badDiceWeb ? 'A Dice website URL was found, so direct API posting is bypassed automatically. ' : ''}Open jobs selected for Dice are published to the XML/JSON Job Bot feed. Direct posting is used only when a verified Dice API endpoint has been configured.</span>
          ${diceFeed && html`<span className="cxhubaction"><button type="button" className="btn link small" onClick=${() => copyText(toast, diceFeed.url)}>Copy Dice feed</button></span>`}
        </div>
        <div className="cxhubcard" style=${{ cursor: 'default' }}>
          <span className="cxhubtop"><b>Candidates ← Dice</b><${Chip} s=${diceSearch ? 'ok' : 'amber'}>${diceSearch ? 'Direct sourcing ready' : 'Inbound ready'}<//></span>
          <span className="muted small">${diceSearch ? 'A run searches Dice against open requirements and keeps the scored matches on each requirement.' : 'Dice applications and forwarded profiles arriving in the company inbox are converted into ATS candidates. Automatic Dice database search waits for the private Dice integration endpoint.'}</span>
        </div>
        <div className="cxhubcard" style=${{ cursor: 'default' }}>
          <span className="cxhubtop"><b>Requisitions ← iLabor360</b><${Chip} s=${ilApi ? 'ok' : 'amber'}>${ilApi ? 'API pull ready' : 'Email intake ready'}<//></span>
          <span className="muted small">${ilApi ? 'A run pulls and updates iLabor360 requisitions on the Requirements desk.' : 'iLabor360 notification emails are filed on the Requirements desk now; direct pulling starts when the verified API base and requisition path are configured.'}</span>
        </div>
      </div>
      ${res && html`<div className="note info"><span><b>Last run:</b> Dice feed exposed <b>${res.dice.feedJobs}</b> job${res.dice.feedJobs === 1 ? '' : 's'}. ${ds ? html`Dice API searched <b>${ds.searched}</b> requirement${ds.searched === 1 ? '' : 's'}, found <b>${ds.found}</b> matches and added <b>${ds.imported}</b> candidate${ds.imported === 1 ? '' : 's'} to the ATS${ds.posted || ds.updated || ds.closed ? html`; direct job API: ${ds.posted} posted, ${ds.updated} updated, ${ds.closed} closed` : ''}.` : html`Direct Dice candidate search did not run; inbound candidate intake remains active.`} ${ip ? html`iLabor360 read <b>${ip.fetched}</b> requisition${ip.fetched === 1 ? '' : 's'}: ${ip.added} new, ${ip.updated} updated, ${ip.closed} closed.` : html`iLabor360 direct API pull did not run; requisition-email intake remains active.`}</span></div>`}
    </section>`;
}

function OorwinPanel({ ow, reload }) {
  const toast = useToast();
  const [login, setLogin] = useState({ email: '', password: '', clientSecret: '' });
  const [jobs, setJobs] = useState(true);
  const [candidates, setCandidates] = useState(true);
  const [max, setMax] = useState(500);
  const [busy, setBusy] = useState('');
  const [res, setRes] = useState(null);
  const connect = async () => {
    setBusy('login');
    try {
      const r = await api('oorwin_login', login, { timeout: 120000 });
      setLogin({ email: '', password: '', clientSecret: '' });
      toast('Oorwin connected. Your Oorwin password and client secret were not stored.');
      await reload();
      if (!r.permissions.jobs && !r.permissions.candidates) toast('Signed in, but this Oorwin user cannot read Jobs or Candidates through the API.', true);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const disconnect = async () => {
    if (!window.confirm('Disconnect Oorwin from StratEdge? Imported records stay here.')) return;
    setBusy('disconnect');
    try {
      await api('oorwin_disconnect');
      setRes(null);
      toast('Oorwin disconnected.');
      await reload();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const run = async () => {
    if (!jobs && !candidates) return toast('Choose jobs, candidates, or both.', true);
    setBusy('import');
    try {
      const r = await api('oorwin_import', { jobs, candidates, max }, { timeout: 900000 });
      setRes(r);
      toast('Oorwin backup and import finished.');
      await reload();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const last = res || ow.last;
  return html`<section id="src-oorwin" className="panel form srcanchor">
      <div className="srchead"><h3 className="ph" style=${{ margin: 0 }}>Oorwin AI</h3><${Chip} s=${ow.connected ? 'ok' : ''}>${ow.connected ? 'Connected' : 'Not connected'}<//><${Chip} s=${ow.backup.ready ? 'ok' : 'amber'}>${ow.backup.ready ? 'Backup ready' : 'Backup required'}<//></div>
      <p className="small">Import Oorwin <b>Jobs → Requirements</b> and <b>Candidates → ATS Candidates</b>. StratEdge makes an encrypted database backup before it writes any imported records. Existing records are matched by Oorwin ID and candidate email to prevent duplicates.</p>
      ${!ow.connected ? html`<div className="stack" style=${{ gap: 10 }}>
        <div className="row3">
          <${Field} label="Oorwin email"><input type="email" value=${login.email} onInput=${e => setLogin({ ...login, email: e.target.value })} autoComplete="username" placeholder="name@company.com" /><//>
          <${Field} label="Oorwin password" hint="Used once for Oorwin login; not stored."><input type="password" value=${login.password} onInput=${e => setLogin({ ...login, password: e.target.value })} autoComplete="current-password" /><//>
          <${Field} label="Oorwin client secret" hint="Ask your Oorwin account manager if you do not have one."><input type="password" value=${login.clientSecret} onInput=${e => setLogin({ ...login, clientSecret: e.target.value })} autoComplete="new-password" /><//>
        </div>
        <div className="actions"><button type="button" className="btn" disabled=${!!busy || !login.email.trim() || !login.password || !login.clientSecret.trim()} onClick=${connect}>${busy === 'login' ? 'Signing in…' : 'Connect Oorwin'}</button><a className="btn ghost" href="https://app.oorwin.com/developer.html" target="_blank" rel="noopener noreferrer">Oorwin API portal ↗</a><span className="muted small">Official API: <code>${ow.base}</code></span></div>
      </div>` : html`<div className="stack" style=${{ gap: 12 }}>
        <div className="note ok"><span><b>Signed in to Oorwin</b>${ow.email ? html` as ${ow.email}` : ''}. Access detected: ${ow.permissions.jobs ? 'Jobs' : 'no Jobs'} · ${ow.permissions.candidates ? 'Candidates' : 'no Candidates'}.</span></div>
        ${!ow.backup.ready && html`<div className="note amber"><span><b>Set up backups before importing.</b> Oorwin data will not be written until StratEdge can make a recovery backup. <a href="#/portal/admin/trust?tab=backups">Open Security center → Backups</a>.</span></div>`}
        <div className="row3">
          <label className="check"><input type="checkbox" checked=${jobs} onChange=${e => setJobs(e.target.checked)} disabled=${!ow.permissions.jobs} /><span><b>Import jobs</b><br /><small className="muted">Into Requirements</small></span></label>
          <label className="check"><input type="checkbox" checked=${candidates} onChange=${e => setCandidates(e.target.checked)} disabled=${!ow.permissions.candidates} /><span><b>Import candidates</b><br /><small className="muted">Into ATS Candidates</small></span></label>
          <${Field} label="Maximum from each"><select value=${max} onChange=${e => setMax(+e.target.value)}><option value="100">100</option><option value="500">500</option><option value="1000">1,000</option><option value="2000">2,000</option></select><//>
        </div>
        <div className="actions"><button type="button" className="btn" disabled=${!!busy || !ow.backup.ready || (!jobs && !candidates)} onClick=${run}>${busy === 'import' ? 'Backing up & importing…' : 'Backup & import now'}</button><button type="button" className="btn ghost" disabled=${!!busy} onClick=${disconnect}>${busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}</button><span className="muted small">The saved Oorwin bearer token is encrypted on this server. Your password is not saved.</span></div>
      </div>`}
      ${last && html`<div className="note info"><span><b>Last Oorwin import:</b> ${last.backup && last.backup.name ? html`backup <code>${last.backup.name}</code>. ` : ''}${last.jobs ? html`Jobs: ${last.jobs.read} read, <b>${last.jobs.added}</b> added, ${last.jobs.updated} updated, ${last.jobs.skipped} skipped. ` : ''}${last.candidates ? html`Candidates: ${last.candidates.read} read, <b>${last.candidates.added}</b> added, ${last.candidates.updated} updated, ${last.candidates.skipped} skipped.` : ''}</span></div>`}
    </section>`;
}

function SourcesPage() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [cx, setCx] = useState(null);
  const [mig, setMig] = useState({ sources: [] });
  const [ow, setOw] = useState(null);
  const [dice, setDice] = useState({ cid: '', secret: '' });
  const [il, setIl] = useState({ user: '', pass: '', key: '', sysid: '' });
  const [busy, setBusy] = useState('');
  const load = () => Promise.all([api('src_get').then(setD), api('cx_get').then(setCx), api('oorwin_get').then(setOw), api('mig_list').then(setMig).catch(() => setMig({ sources: [] }))]).catch(e => toast(errText(e), true));
  useEffect(() => {
    load();
  }, []);
  const save = async (which, body) => {
    setBusy(which);
    try {
      await api('src_save', body);
      toast('Saved. The keys are stored encrypted; only the server reads them.');
      setDice({ cid: '', secret: '' });
      setIl({ user: '', pass: '', key: '', sysid: '' });
      load();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  if (!d || !cx || !ow) return html`<div className="panel"><${Spinner} /></div>`;
  const copyRow = (label, url) => html`<div className="srcurl"><span className="muted small">${label}</span><code>${url}</code><button type="button" className="btn ghost sm" onClick=${() => copyText(toast, url)}>Copy</button></div>`;
  const inbox = d.inbox.from || 'your company address';
  const badDiceWeb = cxDiceWebsiteUrl(cx.api.dice.base);
  const live = p => Object.values(cx.api[p].ops).some(o => o.on) && !!cx.api[p].base && !(p === 'dice' && badDiceWeb);
  const connected = (mig.sources || []).filter(x => x.conn);
  const portalKey = (location.hash.match(/#\/portal\/(admin|hr|acct|manager)/) || [])[1] || 'admin';
  const importHref = '#/portal/' + portalKey + '/import';
  const jump = id => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const diceReady = live('dice');
  const ilReady = live('ilabor') && cx.api.ilabor.ops.reqs.on;
  return html`<div className="stack">
    <section className="panel cxhub">
      <div className="ph-row"><div><h2 className="ph" style=${{ margin: 0 }}>Portal integrations</h2><p className="muted small" style=${{ margin: '4px 0 0' }}>Connect recruiting sources in one place. Start with the simple setup; the full API fields stay available under <b>Advanced API settings</b>.</p></div></div>
      <div className="cxhubgrid">
        <button type="button" className="cxhubcard" onClick=${() => jump('src-dice')}>
          <span className="cxhubtop"><b>Dice</b><${Chip} s=${diceReady ? 'ok' : d.dice.set ? 'amber' : ''}>${diceReady ? 'Live' : d.dice.set ? 'Keys saved' : 'Set up'}<//></span>
          <span className="muted small">Job Bot feed and candidate intake are ready; private API search/posting turns on only when verified.</span>
          <span className="cxhubaction">Open Dice setup →</span>
        </button>
        <button type="button" className="cxhubcard" onClick=${() => jump('src-ilabor')}>
          <span className="cxhubtop"><b>iLabor360</b><${Chip} s=${ilReady ? 'ok' : d.ilabor.set ? 'amber' : ''}>${ilReady ? 'Live' : d.ilabor.set ? 'Credentials saved' : 'Set up'}<//></span>
          <span className="muted small">Requisition-email intake is ready; verified API pulling can run on demand or a schedule.</span>
          <span className="cxhubaction">Open iLabor360 setup →</span>
        </button>
        <button type="button" className="cxhubcard" onClick=${() => jump('src-oorwin')}>
          <span className="cxhubtop"><b>Oorwin AI</b><${Chip} s=${ow.connected ? 'ok' : ''}>${ow.connected ? 'Connected' : 'Connect'}<//></span>
          <span className="muted small">Login-based import for Oorwin jobs and candidates, with an encrypted StratEdge backup before every import.</span>
          <span className="cxhubaction">Open Oorwin import →</span>
        </button>
        <a className="cxhubcard" href=${importHref}>
          <span className="cxhubtop"><b>Other ATS & CRM</b><${Chip} s=${connected.length ? 'ok' : ''}>${connected.length ? connected.length + ' connected' : 'Connect'}<//></span>
          <span className="muted small">HubSpot, Salesforce, Zoho Recruit, Bullhorn, Workable, Greenhouse, Lever, Manatal, Recruit CRM and more.</span>
          <span className="cxhubaction">Open connectors →</span>
        </a>
        <button type="button" className="cxhubcard" onClick=${() => jump('src-feeds')}>
          <span className="cxhubtop"><b>Job boards & inbound email</b><${Chip} s="ok">Ready<//></span>
          <span className="muted small">XML/JSON feeds for job boards plus inbound applications and vendor/VMS email.</span>
          <span className="cxhubaction">Open feeds & email →</span>
        </button>
      </div>
    </section>
    <${IntegrationRunPanel} d=${d} cx=${cx} reload=${load} />
    <div className="note info"><span><b>Production paths:</b> Dice jobs can run through the supported Job Bot feed now; Dice applications and forwarded profiles can enter Candidates through inbound email now; iLabor360 notification emails can enter the Requirements desk now. Oorwin jobs and candidates can be imported through Oorwin's official API after login. Direct Dice search/posting and direct iLabor360 pulling are used only after their private API endpoints are verified.</span></div>
    <section id="src-dice" className="panel form srcanchor">
      <div className="srchead"><h3 className="ph" style=${{ margin: 0 }}>Dice</h3><span className=${'chip ' + (d.dice.set ? 'ok' : '')}>${d.dice.set ? 'API keys saved' : 'No API keys yet'}</span><span className=${'chip ' + (live('dice') ? 'ok' : 'amber')}>${live('dice') ? 'Live API set up' : 'Live API not set up yet'}</span></div>
      <div className="row2">
        <${Field} label="Client ID (access ID)" hint=${d.dice.cid ? 'Saved: ' + d.dice.cid + ' (type to replace)' : 'From your Dice account team'}><input value=${dice.cid} onInput=${e => setDice({ ...dice, cid: e.target.value })} autoComplete="off" /><//>
        <${Field} label="Client secret" hint=${d.dice.set ? 'Saved (type to replace)' : ''}><input type="password" value=${dice.secret} onInput=${e => setDice({ ...dice, secret: e.target.value })} autoComplete="new-password" /><//>
      </div>
      <div className="actions"><button type="button" className="btn" disabled=${!!busy || (!dice.cid.trim() && !dice.secret.trim())} onClick=${() => save('dice', { dice })}>${busy === 'dice' ? 'Saving…' : 'Save Dice keys'}</button>${d.dice.set && html`<button type="button" className="btn ghost" disabled=${!!busy} onClick=${() => save('dice', { dice: { clear: true } })}>Remove</button>`}${d.dice.at ? html`<span className="muted small">Saved ${fmtTs(d.dice.at)} by ${d.dice.by}</span>` : ''}</div>
      <${CxAutoSetup} prov="dice" cx=${cx} reload=${load} hasKeys=${d.dice.set} />
      ${live('dice') && (cx.api.dice.ops.search.on || cx.api.dice.ops.post.on) && html`<${CxRunAuto} cx=${cx} reload=${load} />`}
      ${live('dice') && cx.api.dice.ops.search.on && html`<${CxTalent} key=${'tsd' + JSON.stringify(cx.api.dice.auto) + cx.api.dice.ops.profile.on} cx=${cx} reload=${load} />`}
      <${CxConnection} key=${'dice' + JSON.stringify(cx.api.dice).length} prov="dice" cx=${cx} reload=${load} />
      ${live('dice') && cx.api.dice.ops.search.on && html`<${CxDiceSearch} cx=${cx} />`}
      ${live('dice') && cx.api.dice.ops.post.on && html`<${CxDiceJobs} cx=${cx} reload=${load} />`}
      ${badDiceWeb && html`<div className="note amber"><span><b>Dice website URL detected.</b> The portal will not send job data to it. Use the Dice Job Bot feed below; Advanced API settings can stay empty until Dice gives you a private API base address.</span></div>`}
      <div className="srcworks">
        <b>Works today</b>
        <ol className="small">
          <li>Send this job feed address to your Dice account team and ask them to set up the <b>Dice Job Bot</b>: your open jobs post to Dice and stay in sync. ${copyRow('Feed for Dice', d.feed.boards.find(b => b.k === 'dice').url)}</li>
          <li>Set your Dice postings to send applications to <b>${inbox}</b>, and forward profiles you like from Dice’s candidate search to the same address. The screening agent makes each one a candidate (source: Dice), checks them and asks them to confirm their details. ${d.dice.recent ? html`<b>${d.dice.recent}</b> Dice candidates in the last 30 days.` : ''}</li>
        </ol>
      </div>
    </section>
    <section id="src-ilabor" className="panel form srcanchor">
      <div className="srchead"><h3 className="ph" style=${{ margin: 0 }}>iLabor360</h3><span className=${'chip ' + (d.ilabor.set ? 'ok' : '')}>${d.ilabor.set ? 'API credentials saved' : 'No API credentials yet'}</span><span className=${'chip ' + (live('ilabor') ? 'ok' : 'amber')}>${live('ilabor') ? 'Live API set up' : 'Live API not set up yet'}</span></div>
      <div className="row2">
        <${Field} label="API username" hint=${d.ilabor.user ? 'Saved: ' + d.ilabor.user : ''}><input value=${il.user} onInput=${e => setIl({ ...il, user: e.target.value })} autoComplete="off" /><//>
        <${Field} label="API password" hint=${d.ilabor.set ? 'Saved (type to replace)' : ''}><input type="password" value=${il.pass} onInput=${e => setIl({ ...il, pass: e.target.value })} autoComplete="new-password" /><//>
      </div>
      <div className="row2">
        <${Field} label="API key" hint=${d.ilabor.set ? 'Saved (type to replace)' : ''}><input type="password" value=${il.key} onInput=${e => setIl({ ...il, key: e.target.value })} autoComplete="new-password" /><//>
        <${Field} label="System user ID" hint=${d.ilabor.sysid ? 'Saved: ' + d.ilabor.sysid : 'Used in the requests as {sysid}'}><input value=${il.sysid} onInput=${e => setIl({ ...il, sysid: e.target.value })} autoComplete="off" /><//>
      </div>
      <div className="actions"><button type="button" className="btn" disabled=${!!busy || !(il.user.trim() || il.pass.trim() || il.key.trim() || il.sysid.trim())} onClick=${() => save('il', { ilabor: il })}>${busy === 'il' ? 'Saving…' : 'Save iLabor360 credentials'}</button>${d.ilabor.set && html`<button type="button" className="btn ghost" disabled=${!!busy} onClick=${() => save('il', { ilabor: { clear: true } })}>Remove</button>`}${d.ilabor.at ? html`<span className="muted small">Saved ${fmtTs(d.ilabor.at)} by ${d.ilabor.by}</span>` : ''}</div>
      <${CxAutoSetup} prov="ilabor" cx=${cx} reload=${load} hasKeys=${d.ilabor.set} />
      <${CxConnection} key=${'il' + JSON.stringify(cx.api.ilabor).length} prov="ilabor" cx=${cx} reload=${load} />
      ${live('ilabor') && cx.api.ilabor.ops.reqs.on && html`<${CxPull} cx=${cx} reload=${load} />`}
      <div className="srcworks">
        <b>Works today</b>
        <ol className="small">
          <li>In iLabor360, send the requisition notification emails to <b>${inbox}</b>. New requisitions land on the Requirements desk under iLabor360 with the requisition number and a link back; later emails about the same requisition (shortlisted, interview, closed) are noted on it. ${d.ilabor.reqs ? html`<b>${d.ilabor.reqs}</b> iLabor360 requisitions on the desk.` : ''}</li>
          <li>Submit candidates in iLabor360 itself and log the submission on the desk.</li>
        </ol>
      </div>
    </section>
    <${OorwinPanel} ow=${ow} reload=${load} />
    <section id="src-other" className="panel srcanchor">
      <div className="srchead"><h3 className="ph" style=${{ margin: 0 }}>Other ATS & CRM connectors</h3><span className=${'chip ' + (connected.length ? 'ok' : '')}>${connected.length ? connected.length + ' connected' : 'Read-only imports'}</span></div>
      <p className="small">Connect another recruiting or sales system without building a custom integration. The app reads records from the other system into <b>Import with preview</b>, where you review field matching and duplicates before anything is saved here. Nothing is written back to the source system.</p>
      ${connected.length ? html`<div className="cxchips">${connected.map(x => html`<span key=${x.k} className="chip ok">${x.n}</span>`)}</div>` : null}
      <div className="actions"><a className="btn" href=${importHref}>Manage ATS & CRM connectors</a><span className="muted small">Available: ${(mig.sources || []).map(x => x.n).join(' · ') || 'open Import with preview to see the available systems'}.</span></div>
    </section>
    <section id="src-feeds" className="panel srcanchor">
      <div className="srchead"><h3 className="ph" style=${{ margin: 0 }}>Job board feed</h3><span className="chip ok">Works today</span><span className="muted small">${d.feed.jobs} open job${d.feed.jobs === 1 ? '' : 's'} in it</span></div>
      <p className="small">Job boards that take an XML feed read your open jobs from these addresses and keep them up to date (closed jobs drop out). Each address tags the job links, so applicants arrive in the ATS with the board as their source. Submit the address in each board’s employer or publisher settings.</p>
      ${d.feed.boards.map(b => html`<div key=${b.k}>${copyRow(b.n, b.url)}</div>`)}
      ${copyRow('Any other board (XML)', d.feed.xml)}
      ${copyRow('JSON', d.feed.json)}
    </section>
    <section className="panel">
      <div className="srchead"><h3 className="ph" style=${{ margin: 0 }}>Emails into the portal</h3><span className=${'chip ' + (d.inbox.mailgun ? 'ok' : 'amber')}>${d.inbox.mailgun ? 'Mailgun inbound' : 'Check the inbound route'}</span></div>
      <p className="small">Dice applications, vendor submissions and iLabor360 requisitions reach the portal through the company inbox. With Mailgun, a route that forwards mail for your domain to this address does it:</p>
      ${copyRow('Inbound route', d.inbox.webhook)}
    </section>
    <${CxLog} rows=${cx.log} />
  </div>`;
}

/* ---- the connection: sign-in and operations, with test calls ---- */
function CxConnection({ prov, cx, reload }) {
  const toast = useToast();
  const [f, setF] = useState(() => JSON.parse(JSON.stringify(cx.api[prov])));
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState('');
  const [tests, setTests] = useState({});
  const [open, setOpen] = useState(false);
  const ops = cx.ops[prov];
  const badDiceWeb = prov === 'dice' && cxDiceWebsiteUrl(f.base);
  const useFeed = async () => {
    setBusy('feed');
    try {
      const r = await api('src_dice_feed_mode', {});
      if (r.api) setF(JSON.parse(JSON.stringify(r.api)));
      setToken('');
      toast('Dice is now in Job Bot feed mode. Open jobs selected for Dice stay in the feed; no dice.com web page will be called as an API.');
      await reload();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const setOp = (op, k, v) => setF({ ...f, ops: { ...f.ops, [op]: { ...f.ops[op], [k]: v } } });
  const setMap = (op, k, v) => setOp(op, 'map', { ...f.ops[op].map, [k]: v });
  const save = async () => {
    if (badDiceWeb) {
      await useFeed();
      return;
    }
    setBusy('save');
    try {
      const r = await api('cx_save', { prov, api: f, token: token.trim() });
      setF(JSON.parse(JSON.stringify(r.api)));
      setToken('');
      toast('Connection saved.');
      reload();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const getToken = async () => {
    setBusy('token');
    try {
      await api('cx_save', { prov, api: f, token: token.trim() });
      const r = await api('cx_token', { prov });
      toast(r.ok ? 'Signed in: the token is valid until ' + fmtTs(r.exp) + '.' : r.err, !r.ok);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const test = async (op, vars) => {
    setBusy('test-' + op);
    try {
      await api('cx_save', { prov, api: f, token: token.trim() });
      const r = await api('cx_test', { prov, op, ...(vars || {}) }, { timeout: 60000 });
      setTests({ ...tests, [op]: r });
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const c = cx.creds[prov];
  return html`<details className="cxbox" open=${open} onToggle=${e => setOpen(e.currentTarget.open)}>
      <summary><b>Advanced API settings</b> <span className="muted small">${f.base ? f.base : 'not set up'}${Object.entries(f.ops).filter(([, o]) => o.on).length ? ' · ' + Object.entries(f.ops).filter(([, o]) => o.on).map(([k]) => ops[k]).join(', ') : ''}</span></summary>
      <div className="stack form" style=${{ gap: 14, marginTop: 10 }}>
        <div className="row2">
          <${Field} label="Base address" hint="From the API documents, e.g. https://api.example.com/v1"><input value=${f.base} onInput=${e => setF({ ...f, base: e.target.value.trim() })} placeholder="https://" /><//>
          <${Field} label="Sign-in"><select value=${f.auth} onChange=${e => setF({ ...f, auth: e.target.value })}>${CX_AUTH.map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select><//>
        </div>
        ${badDiceWeb && html`<div className="note amber"><span><b>This is the Dice website, not an API.</b> Direct API posting is disabled for this address. Use the supported Job Bot feed now, or replace the base address later with the private API host from Dice's integration documents. <button type="button" className="btn ghost sm" disabled=${!!busy} onClick=${useFeed}>${busy === 'feed' ? 'Switching…' : 'Use Job Bot feed mode'}</button></span></div>`}
        ${
          f.auth === 'oauth2' &&
          html`<div className="row3">
            <${Field} label="Token address"><input value=${f.tokenUrl} onInput=${e => setF({ ...f, tokenUrl: e.target.value.trim() })} placeholder="https://…/oauth/token" /><//>
            <${Field} label="Scope (if the documents name one)"><input value=${f.scope} onInput=${e => setF({ ...f, scope: e.target.value })} /><//>
            <${Field} label="Client ID and secret sent as"><select value=${f.clientAuth} onChange=${e => setF({ ...f, clientAuth: e.target.value })}><option value="basic">Basic header (most common)</option><option value="form">Form fields</option><option value="json">JSON body</option></select><//>
          </div>`
        }
        ${f.auth === 'oauth2' && html`<p className="muted small" style=${{ margin: 0 }}>Uses the ${prov === 'dice' ? 'client ID and secret' : 'username (client ID) and password (secret)'} saved above${c.id || c.user ? '' : ' (not saved yet)'}. <button type="button" className="btn link small" disabled=${!!busy} onClick=${getToken}>${busy === 'token' ? 'Signing in…' : 'Test the sign-in'}</button></p>`}
        ${
          f.auth === 'apikey' &&
          html`<div className="row2">
            <${Field} label="Key name" hint=${'Uses the ' + (prov === 'dice' ? 'client secret' : 'API key') + ' saved above.'}><input value=${f.keyName} onInput=${e => setF({ ...f, keyName: e.target.value.trim() })} placeholder="x-api-key" /><//>
            <${Field} label="Sent in"><select value=${f.keyIn} onChange=${e => setF({ ...f, keyIn: e.target.value })}><option value="header">A header</option><option value="query">The address (query)</option></select><//>
          </div>`
        }
        ${f.auth === 'bearer' && html`<${Field} label="Access token" hint=${c.token ? 'Saved (type to replace)' : 'Stored encrypted'}><input type="password" value=${token} onInput=${e => setToken(e.target.value)} autoComplete="new-password" /><//>`}
        ${f.auth === 'basic' && html`<p className="muted small" style=${{ margin: 0 }}>Uses the ${prov === 'dice' ? 'client ID and secret' : 'username and password'} saved above.</p>`}
        ${prov === 'ilabor' && f.auth !== 'apikey' && html`<div className="cxauxkey">
          <label className="check"><input type="checkbox" checked=${!!f.useKey} onChange=${e => setF({ ...f, useKey: e.target.checked })} /><span><b>Also send the saved API key</b> with ${f.auth === 'basic' ? 'username/password' : f.auth === 'oauth2' ? 'OAuth' : f.auth === 'bearer' ? 'the access token' : 'this request'}.</span></label>
          ${f.useKey && html`<div className="row2"><${Field} label="API key name"><input value=${f.keyName} onInput=${e => setF({ ...f, keyName: e.target.value.trim() })} placeholder="x-api-key" /><//><${Field} label="API key sent in"><select value=${f.keyIn} onChange=${e => setF({ ...f, keyIn: e.target.value })}><option value="header">A header</option><option value="query">The address (query)</option></select><//></div>`}
        </div>`}
        <${Field} label="Extra headers (optional)" hint="One per line, as in the documents, e.g. SystemUserId: {sysid} or Accept-Version: 2. You can use {sysid}, {user} and {key}."><textarea rows="2" value=${f.headers} onInput=${e => setF({ ...f, headers: e.target.value })} spellCheck="false" /><//>
        ${Object.keys(ops).map(op => html`<${CxOp} key=${op} prov=${prov} op=${op} name=${ops[op]} o=${f.ops[op]} fields=${cx.fields[op]} setOp=${(k, v) => setOp(op, k, v)} setMap=${(k, v) => setMap(op, k, v)} test=${tests[op]} busy=${busy} onTest=${vars => test(op, vars)} last=${prov === 'dice' && op === 'post' ? cx.lastPost : null} />`)}
        ${
          prov === 'ilabor' &&
          html`<div className="row2">
            <${Field} label="Pull requisitions automatically"><select value=${f.sched} onChange=${e => setF({ ...f, sched: +e.target.value })}><option value="0">Only when I press Pull</option>${[1, 2, 4, 6, 12, 24].map(h => html`<option key=${h} value=${h}>Every ${h} hour${h === 1 ? '' : 's'}</option>`)}</select><//>
            <${Field} label="Statuses that close a requisition" hint="Words in the VMS status; comma-separated."><input value=${f.closeWords} onInput=${e => setF({ ...f, closeWords: e.target.value })} /><//>
          </div>`
        }
        <div className="actions"><button type="button" className="btn" disabled=${!!busy} onClick=${save}>${busy === 'save' ? 'Saving…' : busy === 'feed' ? 'Switching…' : badDiceWeb ? 'Use Job Bot feed mode' : 'Save the connection'}</button></div>
      </div>
    </details>`;
}
function CxOp({ prov, op, name, o, fields, setOp, setMap, test, busy, onTest, last }) {
  const [vars, setVars] = useState({ q: 'java developer', location: '', id: '' });
  const reads = ['reqs', 'search', 'profile'].includes(op);
  const lists = ['reqs', 'search'].includes(op);
  const writes = !['GET'].includes(o.method);
  const fkeys = Object.keys(fields || {});
  return html`<div className=${'cxop' + (o.on ? ' on' : '')}>
      <label className="check"><input type="checkbox" checked=${o.on} onChange=${e => setOp('on', e.target.checked)} /><span><b>${name}</b></span></label>
      ${
        o.on &&
        html`<div className="stack" style=${{ gap: 10 }}>
          <div className="cxline">
            <select value=${o.method} onChange=${e => setOp('method', e.target.value)} aria-label="Method">${['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(m => html`<option key=${m}>${m}</option>`)}</select>
            <input value=${o.path} onInput=${e => setOp('path', e.target.value)} placeholder=${op === 'reqs' ? '/requisitions?status=open&page={page}&pageSize={size}' : op === 'search' ? '/candidates/search?q={q}&location={location}&page={page}' : op === 'profile' ? '/candidates/{id}' : op === 'post' ? '/jobs' : '/jobs/{posting_id}'} aria-label="Path" spellCheck="false" />
          </div>
          <p className="muted small" style=${{ margin: 0 }}>Placeholders: ${(CX_PH[op] || []).map(p => html`<code key=${p} className="cxph">${p}</code> `)}</p>
          ${
            writes &&
            html`<div className="cxline">
              <select value=${o.ctype} onChange=${e => setOp('ctype', e.target.value)} aria-label="Body format"><option value="json">JSON</option><option value="form">Form</option><option value="xml">XML</option></select>
              <textarea rows="5" value=${o.body} onInput=${e => setOp('body', e.target.value)} spellCheck="false" placeholder=${op === 'post' || op === 'update' ? '{ "title": "{title}", "description": "{description_html}", "location": { "city": "{city}", "state": "{state}" }, "remote": {{remote}}, "skills": {{skills_list}}, "applyUrl": "{apply_url}" }' : ''} aria-label="Body"></textarea>
            </div>`
          }
          ${
            lists &&
            html`<div className="row3">
              <${Field} label="List in the answer" hint="Dot path; empty finds it. XML works too."><input value=${o.items} onInput=${e => setOp('items', e.target.value.trim())} placeholder="data.results" spellCheck="false" /><//>
              <${Field} label="Records per page"><input type="number" min="1" max="500" value=${o.size} onInput=${e => setOp('size', +e.target.value)} /><//>
              <${Field} label="Pages at most"><input type="number" min="1" max="50" value=${o.pages} onInput=${e => setOp('pages', +e.target.value)} /><//>
            </div>`
          }
          ${
            fkeys.length > 0 &&
            html`<details className="cxmap">
              <summary className="small">Which field is which ${Object.keys(o.map || {}).length ? '(' + Object.keys(o.map).length + ' set)' : '(detected automatically)'}</summary>
              <datalist id=${'cxp-' + prov + op}>${(test && test.paths ? test.paths : last && last.paths ? last.paths.map(x => x[0]) : []).map(p => html`<option key=${p} value=${p} />`)}</datalist>
              <div className="cxmapgrid">
                ${fkeys.map(k => html`<label key=${k}><span className="small">${fields[k]}</span><input value=${(o.map || {})[k] || ''} onInput=${e => setMap(k, e.target.value)} placeholder=${(test && test.auto && test.auto[k]) || ''} list=${'cxp-' + prov + op} spellCheck="false" /></label>`)}
              </div>
              <p className="muted small" style=${{ margin: 0 }}>Dot paths into one record (location.city, skills.0.name); alternatives with |. ${op === 'post' || op === 'update' ? html`An ID sent in a header: <code>@header:location</code>; an answer that is only the ID: <code>@text</code>. Empty: the portal finds the ID itself and keeps where it found it.` : 'Empty uses the field found by the test call (shown in grey).'}</p>
            </details>`
          }
          ${
            reads &&
            html`<div className="cxline">
              ${op === 'search' && html`<input value=${vars.q} onInput=${e => setVars({ ...vars, q: e.target.value })} placeholder="Keywords" aria-label="Test keywords" />`}
              ${op === 'search' && html`<input value=${vars.location} onInput=${e => setVars({ ...vars, location: e.target.value })} placeholder="Location" aria-label="Test location" />`}
              ${op === 'profile' && html`<input value=${vars.id} onInput=${e => setVars({ ...vars, id: e.target.value })} placeholder="A profile ID from a search" aria-label="Profile ID" />`}
              <button type="button" className="btn ghost sm" disabled=${!!busy} onClick=${() => onTest(vars)}>${busy === 'test-' + op ? 'Calling…' : 'Test call'}</button>
            </div>`
          }
          ${test && html`<${CxTestResult} t=${test} lists=${lists} useItems=${p => setOp('items', p)} useMap=${m => setOp('map', { ...m, ...(o.map || {}) })} fields=${fields} />`}
          ${op === 'post' && last && html`<${CxLastAnswer} last=${last} map=${o.map || {}} setMap=${setMap} />`}
        </div>`
      }
    </div>`;
}
function CxTestResult({ t, lists, useItems, useMap, fields }) {
  const okCode = t.code >= 200 && t.code < 300;
  return html`<div className="cxtest">
      <div className="trhead">${okCode && !t.err ? html`<${Chip} s="ok">${t.code} OK<//>` : html`<${Chip} s="red">${t.code || 'No answer'}<//>`}<span className="muted small">${t.ms} ms${t.ctype ? ' · ' + t.ctype.split(';')[0] : ''}${lists ? ' · ' + t.n + ' records' : ''}</span></div>
      ${t.err && html`<p className="err small" style=${{ margin: 0 }}>${t.err}</p>`}
      ${
        lists && t.itemsPath &&
        html`<p className="small" style=${{ margin: 0 }}>The list was found at <code>${t.itemsPath}</code>. <button type="button" className="btn link small" onClick=${() => useItems(t.itemsPath)}>Use this path</button></p>`
      }
      ${Object.keys(t.auto || {}).length > 0 && html`<p className="small" style=${{ margin: 0 }}>Fields recognised: ${Object.entries(t.auto).map(([k, p]) => html`<span key=${k} className="cxph">${fields[k] || k} = ${p}</span> `)} <button type="button" className="btn link small" onClick=${() => useMap(t.auto)}>Keep these</button></p>`}
      ${
        t.preview && t.preview.length > 0 &&
        html`<div className="tblwrap"><table className="tbl small"><thead><tr>${Object.keys(t.preview[0]).filter(k => t.preview.some(r => r[k])).slice(0, 7).map(k => html`<th key=${k}>${fields[k] || k}</th>`)}</tr></thead><tbody>${t.preview.map((r, i) => html`<tr key=${i}>${Object.keys(t.preview[0]).filter(k => t.preview.some(x => x[k])).slice(0, 7).map(k => html`<td key=${k} className="trwrap">${String(r[k] || '').slice(0, 80)}</td>`)}</tr>`)}</tbody></table></div>`
      }
      ${t.sample && html`<details><summary className="small">What the API sent back (secrets removed)</summary><pre className="trpre">${t.sample}</pre></details>`}
    </div>`;
}

/* ---- v35.2: set the connection up from the documents ---- */
function CxAutoSetup({ prov, cx, reload, hasKeys }) {
  const toast = useToast();
  const [files, setFiles] = useState([]);
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState('');
  const [over, setOver] = useState(false);
  const [res, setRes] = useState(null);
  const inp = useRef(null);
  const name = prov === 'dice' ? 'Dice' : 'iLabor360';
  const a = cx.api[prov];
  const setUp = async discover => {
    setBusy(discover ? 'look' : 'setup');
    try {
      const fd = new FormData();
      fd.append('prov', prov);
      if (!discover) {
        files.forEach(f => fd.append('files[]', f, f.name));
        if (notes.trim()) fd.append('files[]', new File([notes.trim()], name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-api-notes.txt', { type: 'text/plain' }));
        fd.append('url', url.trim());
      } else fd.append('base', a.base || url.trim());
      fd.append('replace', replace ? '1' : '');
      const r = await api('cx_auto', fd, { timeout: 180000 });
      setRes(r);
      if (r.ok) {
        setFiles([]);
        setNotes('');
        toast('The connection is filled in' + (r.steps.some(s => s.ok === true && s.op) ? ' and the operations that answered are switched on.' : '. Check the steps below.'));
        reload();
      } else toast(r.err, true);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const writesOff = ['post', 'update', 'close'].filter(op => a.ops[op] && a.ops[op].path && !a.ops[op].on);
  const switchOn = async () => {
    setBusy('on');
    try {
      const ops = {};
      Object.keys(a.ops).forEach(op => (ops[op] = { ...a.ops[op], on: a.ops[op].on || writesOff.includes(op) }));
      await api('cx_save', { prov, api: { ...a, ops } });
      toast('Posting, updating and closing jobs on ' + name + ' are switched on.');
      reload();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const live = Object.values(a.ops).some(o => o.on) && !!a.base;
  return html`<details className="cxbox cxauto" open=${!live || !!res}>
      <summary><b>Auto-configure from API docs</b> <span className="muted small">${live ? 'the connection is set up; run it again after ' + name + ' sends new documents' : 'from the API documents ' + name + ' gave you'}</span></summary>
      <div className="stack" style=${{ gap: 12, marginTop: 10 }}>
        ${!hasKeys && html`<p className="note amber" style=${{ margin: 0 }}><span>Save the ${prov === 'dice' ? 'client ID and secret' : 'API credentials'} above first: setting up signs in with them to test the connection.</span></p>`}
        <div className=${'drop' + (over ? ' over' : '')} onDragOver=${e => {
          e.preventDefault();
          setOver(true);
        }} onDragLeave=${() => setOver(false)} onDrop=${e => {
          e.preventDefault();
          setOver(false);
          const fl = [...e.dataTransfer.files];
          if (fl.length) setFiles(cur => [...cur, ...fl].slice(0, 10));
        }}>
          <p><b>Drop the API documents</b>: the OpenAPI (Swagger) file in JSON or YAML, a Postman collection, or the PDF, Word or web pages ${name} sent.<br /><small className="muted">Several files at once are fine. Nothing is posted while setting up.</small></p>
          <button type="button" className="btn ghost" onClick=${() => inp.current && inp.current.click()}><${Icon} n="up" />Choose files</button>
          <input ref=${inp} type="file" multiple accept=".json,.yaml,.yml,.pdf,.docx,.html,.htm,.txt,.md" hidden onChange=${e => {
            const fl = [...e.target.files];
            e.target.value = '';
            if (fl.length) setFiles(cur => [...cur, ...fl].slice(0, 10));
          }} />
        </div>
        ${files.length > 0 && html`<ul className="grabfiles">${files.map((f, i) => html`<li key=${f.name + i}><${Icon} n="file" /><span>${f.name}</span><span className="muted small">${Math.max(1, Math.round(f.size / 1024))} KB</span><button type="button" className="btn ghost icon sm" aria-label=${'Remove ' + f.name} onClick=${() => setFiles(files.filter((x, j) => j !== i))}><${Icon} n="x" /></button></li>`)}</ul>`}
        <div className="row2">
          <${Field} label="Or the address of the documents" hint="The OpenAPI (Swagger) or Postman address from the documents, if they gave one."><input value=${url} onInput=${e => setUrl(e.target.value)} placeholder="https://…/openapi.json" spellCheck="false" /><//>
          <label className="check" style=${{ alignSelf: 'end' }}><input type="checkbox" checked=${replace} onChange=${e => setReplace(e.target.checked)} /><span>Replace what is already filled in</span></label>
        </div>
        <${Field} label="Or paste the API instructions" hint="Paste the base URL, authentication notes, endpoints or a copied section of the provider's API document. Secrets are not needed here."><textarea rows="5" value=${notes} onInput=${e => setNotes(e.target.value)} placeholder="Base URL: …
Authentication: …
GET /requisitions …" spellCheck="false" /><//>
        <div className="actions">
          <button type="button" className="btn" disabled=${!!busy || (!files.length && !url.trim() && !notes.trim())} onClick=${() => setUp(false)}>${busy === 'setup' ? 'Setting up…' : 'Set up & test'}</button>
          <button type="button" className="btn ghost" disabled=${!!busy || !(a.base || url.trim())} onClick=${() => setUp(true)} title="Looks for the documents and the sign-in settings at the usual addresses of the base address">${busy === 'look' ? 'Looking…' : 'Look at the base address'}</button>
        </div>
        ${prov === 'dice' && !live && !res && html`<p className="muted small" style=${{ margin: 0 }}>Dice gives API access and its documents to integration customers. If you have the client ID and secret but no documents, ask your Dice account team or integrationsupport@dice.com for them.</p>`}
        ${
          res &&
          html`<div className="cxreport">
            ${(res.kinds || []).length > 0 && html`<p className="small" style=${{ margin: 0 }}>Read: ${res.kinds.join(' · ')}</p>`}
            ${res.ok && html`<p className="small" style=${{ margin: 0 }}>Base address <code>${res.base}</code> · sign-in: ${{ oauth2: 'OAuth 2.0 (client ID and secret)', basic: 'username and password', apikey: 'API key', bearer: 'access token', none: 'none' }[res.auth] || res.auth}${res.tokenUrl && res.auth === 'oauth2' ? html` · token address <code>${res.tokenUrl}</code>` : ''}</p>`}
            <ul className="cxsteps">
              ${(res.plan || []).map((p, i) => html`<li key=${'p' + i} className=${p.ok ? 'ok' : 'no'}><span>${p.ok ? '•' : '–'}</span>${p.text}</li>`)}
              ${(res.steps || []).map((s, i) => html`<li key=${'s' + i} className=${s.ok === true ? 'ok' : s.ok === false ? 'bad' : ''}><span>${s.ok === true ? '✓' : s.ok === false ? '✗' : '○'}</span>${s.text}</li>`)}
            </ul>
            ${(res.warn || []).map((w, i) => html`<p key=${i} className="note amber small" style=${{ margin: 0 }}><span>${w}</span></p>`)}
            ${!res.ok && (res.looked || []).length > 0 && html`<details><summary className="small">Addresses tried</summary><pre className="trpre">${res.looked.join('\n')}</pre></details>`}
          </div>`
        }
        ${prov === 'dice' && writesOff.length > 0 && html`<div className="actions"><button type="button" className="btn ghost sm" disabled=${!!busy} onClick=${switchOn}>Switch on posting, updating and closing jobs</button><span className="muted small">Then post one job from the list below to check it.</span></div>`}
      </div>
    </details>`;
}

/* ---- v35.2: Dice by itself ---- */
function CxRunAuto({ cx, reload }) {
  const toast = useToast();
  const a = cx.api.dice;
  const [f, setF] = useState({ ...a.auto });
  const [busy, setBusy] = useState('');
  const run = cx.auto;
  const save = async () => {
    setBusy('save');
    try {
      await api('cx_save', { prov: 'dice', api: { auto: { ...f, search: +f.search, keep: +f.keep, import: +f.import, min: +f.min, slots: +f.slots, jobs: !!f.jobs } } });
      toast(+f.search || f.jobs ? 'Saved: it runs with the scheduled task (every few minutes, while the cron job or the web link runs).' : 'Saved: nothing runs by itself.');
      reload();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const runNow = async () => {
    setBusy('run');
    try {
      const r = await api('cx_auto_run', { prov: 'dice' }, { timeout: 300000 });
      toast(r.err ? r.err : 'Done: ' + r.searched + ' requirement' + (r.searched === 1 ? '' : 's') + ' searched, ' + r.found + ' candidates kept, ' + r.imported + ' added to the database; ' + r.posted + ' posted, ' + r.updated + ' updated, ' + r.closed + ' closed.', !!r.err);
      reload();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  return html`<div className="cxrun cxauto-run">
      <div className="ph-row" style=${{ margin: 0 }}><b>Run by itself</b><div className="actions"><button type="button" className="btn ghost sm" disabled=${!!busy} onClick=${runNow}>${busy === 'run' ? 'Running…' : 'Run now'}</button></div></div>
      ${
        a.ops.search.on &&
        html`<div className="row4">
          <${Field} label="Search Dice for every open requirement"><select value=${f.search} onChange=${e => setF({ ...f, search: +e.target.value })}><option value="0">Off</option>${[2, 4, 6, 12, 24, 48].map(h => html`<option key=${h} value=${h}>Every ${h} hours</option>`)}</select><//>
          <${Field} label="Keep the best, per requirement"><input type="number" min="5" max="50" value=${f.keep} onInput=${e => setF({ ...f, keep: e.target.value })} /><//>
          <${Field} label="Add the best to the consultant database" hint="0 keeps them on the requirement only"><input type="number" min="0" max="10" value=${f.import} onInput=${e => setF({ ...f, import: e.target.value })} /><//>
          <${Field} label="…when they fit at least (%)"><input type="number" min="30" max="95" value=${f.min} onInput=${e => setF({ ...f, min: e.target.value })} /><//>
        </div>`
      }
      ${
        a.ops.post.on &&
        html`<div className="row2">
          <label className="check"><input type="checkbox" checked=${!!f.jobs} onChange=${e => setF({ ...f, jobs: e.target.checked })} /><span><b>Keep Dice in step with the careers page</b>: new jobs are posted, changed ones updated, closed ones closed on Dice.</span></label>
          <${Field} label="At most this many live Dice postings" hint="Your Dice job slots"><input type="number" min="1" max="200" value=${f.slots} onInput=${e => setF({ ...f, slots: e.target.value })} /><//>
        </div>`
      }
      <div className="actions"><button type="button" className="btn sm" disabled=${!!busy} onClick=${save}>${busy === 'save' ? 'Saving…' : 'Save'}</button>${run ? html`<span className="muted small">Last run ${fmtTs(run.at)} (${run.by}): ${run.searched} searched, ${run.found} kept, ${run.imported} added; ${run.posted} posted, ${run.updated} updated, ${run.closed} closed${run.waiting ? ', ' + run.waiting + ' waiting for their Dice ID' : ''}${run.err ? html`. <span style=${{ color: 'var(--red-ink)' }}>${run.err}</span>` : '.'}</span>` : html`<span className="muted small">Not run yet. Matches show on each requirement under “On Dice”.</span>`}</div>
    </div>`;
}

/* ---- v36.1: Dice in Talent search: searched with the same words, the people found saved into the ATS ---- */
function CxTalent({ cx, reload }) {
  const toast = useToast();
  const a = cx.api.dice;
  const t = cx.tsd || {};
  const [f, setF] = useState({ tsOn: !!a.auto.tsOn, tsProf: !!a.auto.tsProf, tsDay: a.auto.tsDay });
  const [busy, setBusy] = useState('');
  const save = async () => {
    setBusy('save');
    try {
      await api('cx_save', { prov: 'dice', api: { auto: { ...a.auto, ...f, tsDay: +f.tsDay } } });
      toast(f.tsOn ? 'Saved: Talent search searches Dice too.' : 'Saved: Talent search no longer searches Dice.');
      reload();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const readNow = async () => {
    setBusy('read');
    try {
      const r = await api('ts_dice_fetch', {}, { timeout: 170000 });
      toast(r.err ? 'Stopped: ' + r.err : r.done + ' profile' + (r.done === 1 ? '' : 's') + ' read (' + r.resumes + ' with the resume' + (r.merged ? ', ' + r.merged + ' joined to a candidate already in the ATS' : '') + '); ' + r.left + ' waiting' + (r.cap ? ' (today’s allowance is used up)' : '') + '.', !!r.err);
      reload();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  return html`<div className="cxrun cxtalent">
      <div className="ph-row" style=${{ margin: 0 }}><b>In Talent search</b><div className="actions">${t.wait > 0 && a.ops.profile.on && html`<button type="button" className="btn ghost sm" disabled=${!!busy} onClick=${readNow}>${busy === 'read' ? 'Reading…' : 'Read the waiting profiles now'}</button>`}<a className="btn ghost sm" href="#/portal/admin/search">Open Talent search</a></div></div>
      <label className="check"><input type="checkbox" checked=${f.tsOn} onChange=${e => setF({ ...f, tsOn: e.target.checked })} /><span><b>Search Dice from Talent search</b>: the same keywords, skills and place run on Dice, and those people show next to the portal’s, labeled “Dice”.</span></label>
      ${
        f.tsOn &&
        html`<p className="small" style=${{ margin: 0 }}>Saving into the ATS: <b>${t.save === 'off' ? 'nobody by themselves' : t.save === 'fit' ? 'the people who fit at least ' + t.min + '%' : 'everyone found'}</b> (one setting for every source: Talent search › “Saving into the ATS”, administrators and HR).</p>
        ${
          a.ops.profile.on
            ? html`<div className="row2">
                <label className="check"><input type="checkbox" checked=${f.tsProf} onChange=${e => setF({ ...f, tsProf: e.target.checked })} /><span><b>Read the full profile</b> (email, phone, resume) of the saved Dice people who fit at least ${t.min || 60}%, in the background. When the email shows the person is already in the ATS, the two records become one.</span></label>
                <${Field} label="Full profiles a day, at most" hint="Each one uses a Dice profile view"><input type="number" min="0" max="500" value=${f.tsDay} onInput=${e => setF({ ...f, tsDay: e.target.value })} /><//>
              </div>`
            : html`<p className="muted small" style=${{ margin: 0 }}>Switch on “Candidate profile” below to read each saved person’s email, phone and resume too.</p>`
        }
        <p className="muted small" style=${{ margin: 0 }}>Saved Dice people go into the ATS talent pool with the source Dice and their Dice profile ID, so nobody is saved twice. Saved searches with Dice ticked email new Dice people too.</p>`
      }
      <div className="actions"><button type="button" className="btn sm" disabled=${!!busy} onClick=${save}>${busy === 'save' ? 'Saving…' : 'Save'}</button><span className="muted small">${t.wait || 0} waiting for their profile · ${t.today || 0} read today${t.last && t.last.at ? ' · last read ' + fmtTs(t.last.at) + (t.last.err ? ': ' + t.last.err : '') : ''}</span></div>
    </div>`;
}

/* ---- iLabor360: pull requisitions ---- */
function CxPull({ cx, reload }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [sel, setSel] = useState([]);
  const p = cx.pull;
  const incoming = cx.incoming || { rows: [], counts: {}, pending: 0 };
  const rows = (incoming.rows || []).filter(x => ['new', 'updated', 'closed', 'duplicate'].includes(x.state));
  const pending = rows.filter(x => ['new', 'updated'].includes(x.state));
  const pull = async () => {
    setBusy('pull');
    try {
      const r = await api('cx_pull', { prov: 'ilabor' }, { timeout: 300000 });
      toast(r.ok ? r.fetched + ' requisitions read: ' + (r.staged || 0) + ' sent to Incoming Requisitions, ' + r.updated + ' imported records updated, ' + r.closed + ' closed.' : r.err, !r.ok);
      await reload();
    } catch (e) { toast(errText(e), true); }
    setBusy('');
  };
  const act = async action => {
    const ids = sel.length ? sel : pending.map(x => x.id);
    if (!ids.length) return toast('Select one or more incoming requisitions first.', true);
    setBusy(action);
    try {
      const r = await api(action === 'accept' ? 'cx_ilabor_accept' : 'cx_ilabor_skip', { prov: 'ilabor', ids }, { timeout: 180000 });
      toast(action === 'accept' ? `${r.imported || 0} requisition${r.imported === 1 ? '' : 's'} moved to the Requirements desk${r.duplicates ? `; ${r.duplicates} duplicate${r.duplicates === 1 ? '' : 's'} linked instead` : ''}.` : `${r.skipped || 0} requisition${r.skipped === 1 ? '' : 's'} skipped.`);
      setSel([]); await reload();
    } catch (e) { toast(errText(e), true); }
    setBusy('');
  };
  const toggle = id => setSel(x => x.includes(id) ? x.filter(y => y !== id) : [...x, id]);
  return html`<div className="cxrun stack" style=${{ gap: 12 }}>
      <div className="ph-row" style=${{ margin: 0 }}><div><b>Requisitions from iLabor360</b><div className="muted small">Pull first, review incoming requisitions, then accept them into the Requirements desk. Existing imported requisitions still update automatically.</div></div><div className="actions"><button type="button" className="btn sm" disabled=${!!busy} onClick=${pull}>${busy === 'pull' ? 'Pulling…' : 'Pull requisitions now'}</button><a className="btn ghost sm" href="#/portal/admin/vreqs">Requirements desk</a></div></div>
      ${p ? html`<p className="muted small" style=${{ margin: 0 }}>Last pull ${fmtTs(p.at)} (${p.by}): ${p.ok ? p.fetched + ' read, ' + (p.staged || 0) + ' staged, ' + p.updated + ' imported records updated, ' + p.closed + ' closed' : html`<span style=${{ color: 'var(--red-ink)' }}>failed: ${p.err}</span>`}.${cx.api.ilabor.sched ? ' Automatic every ' + cx.api.ilabor.sched + ' h.' : ''}</p>` : html`<p className="muted small" style=${{ margin: 0 }}>Not pulled yet. New iLabor requisitions will appear below for review before they enter the Requirements desk.</p>`}
      <section className="panel" style=${{ margin: 0 }}>
        <div className="ph-row"><div><b>Incoming requisitions</b><div className="muted small">${incoming.pending || 0} waiting · ${incoming.counts && incoming.counts.imported || 0} imported · ${incoming.counts && incoming.counts.skipped || 0} skipped</div></div><div className="actions"><button type="button" className="btn sm" disabled=${!!busy || !(sel.length || pending.length)} onClick=${() => act('accept')}>${busy === 'accept' ? 'Importing…' : sel.length ? `Accept selected (${sel.length})` : `Accept all pending (${pending.length})`}</button><button type="button" className="btn ghost sm" disabled=${!!busy || !sel.length} onClick=${() => act('skip')}>${busy === 'skip' ? 'Skipping…' : 'Skip selected'}</button></div></div>
        ${rows.length ? html`<div className="tablewrap"><table><thead><tr><th></th><th>iLabor ID</th><th>Requisition</th><th>Location</th><th>Positions</th><th>Rate</th><th>Dates</th><th>Checks</th><th>Status</th></tr></thead><tbody>${rows.slice(0, 100).map(x => { const m = x.m || {}; const choose = ['new','updated'].includes(x.state); return html`<tr key=${x.id}><td>${choose && html`<input type="checkbox" checked=${sel.includes(x.id)} onChange=${() => toggle(x.id)} aria-label=${'Select ' + (m.title || x.ref)} />`}</td><td><code>${x.ref}</code></td><td><b>${m.title || 'Untitled requisition'}</b>${m.client && html`<div className="muted small">${m.client}</div>`}${m.skills && html`<div className="muted small">${m.skills}</div>`}</td><td>${m.loc || [m.city,m.state].filter(Boolean).join(', ') || '—'}</td><td>${m.n || 1}</td><td>${m.rate || '—'}</td><td><span className="small">${m.sd || '—'}${m.ed ? html`<br />to ${m.ed}` : ''}</span></td><td><span className="small">${m.bg ? `Background: ${m.bg}` : ''}${m.bg && m.drug ? html`<br />` : ''}${m.drug ? `Drug: ${m.drug}` : ''}</span></td><td><${Chip} s=${x.state === 'new' ? 'ok' : x.state === 'closed' ? 'red' : x.state === 'duplicate' ? 'amber' : ''}>${x.state}<//></td></tr>`; })}</tbody></table></div>` : html`<${Empty} title="No incoming requisitions">Press Pull requisitions now to check iLabor360.<//>`}
      </section>
    </div>`;
}

/* ---- Dice: candidate search and import ---- */
function CxDiceSearch({ cx }) {
  const toast = useToast();
  const [f, setF] = useState({ q: '', location: '', radius: 50, page: 1 });
  const [res, setRes] = useState(null);
  const [sel, setSel] = useState([]);
  const [job, setJob] = useState('');
  const [busy, setBusy] = useState('');
  const search = async page => {
    if (!f.q.trim()) return toast('Type the skills or title to search for.', true);
    setBusy('search');
    try {
      const r = await api('cx_search', { prov: 'dice', ...f, page }, { timeout: 60000 });
      setRes(r);
      setSel([]);
      setF({ ...f, page });
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const importSel = async () => {
    setBusy('import');
    try {
      const items = res.results.filter(x => sel.includes(x.id));
      const r = await api('cx_import', { prov: 'dice', items, job }, { timeout: 180000 });
      toast(r.added.length + ' added to Candidates' + (r.added.filter(x => x.resume).length ? ' (' + r.added.filter(x => x.resume).length + ' with the resume)' : '') + (r.skipped ? ', ' + r.skipped + ' already there' : '') + '.');
      setRes({ ...res, results: res.results.map(x => (r.added.some(a => a.n === x.name) ? { ...x, have: '1' } : x)) });
      setSel([]);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  return html`<div className="cxrun">
      <b>Search Dice for candidates</b>
      <form className="cxline" onSubmit=${e => { e.preventDefault(); search(1); }}>
        <input value=${f.q} onInput=${e => setF({ ...f, q: e.target.value })} placeholder="Skills or title, e.g. Java Spring Kafka" aria-label="Keywords" />
        <input value=${f.location} onInput=${e => setF({ ...f, location: e.target.value })} placeholder="City, state or ZIP" aria-label="Location" />
        <select value=${f.radius} onChange=${e => setF({ ...f, radius: +e.target.value })} aria-label="Distance">${[10, 25, 50, 100, 250].map(r => html`<option key=${r} value=${r}>${r} miles</option>`)}</select>
        <button className="btn sm" disabled=${!!busy}>${busy === 'search' ? 'Searching…' : 'Search'}</button>
      </form>
      ${
        res &&
        (res.results.length
          ? html`<div className="stack" style=${{ gap: 8 }}>
              <div className="tblwrap"><table className="tbl small">
                <thead><tr><th></th><th>Candidate</th><th>Location</th><th>Skills</th><th>Experience</th><th>Authorization</th></tr></thead>
                <tbody>${res.results.map(
                  x => html`<tr key=${x.id || x.name}>
                    <td>${x.have ? html`<${Chip} s="ok">In candidates<//>` : html`<input type="checkbox" checked=${sel.includes(x.id)} onChange=${() => setSel(sel.includes(x.id) ? sel.filter(y => y !== x.id) : [...sel, x.id])} aria-label=${'Select ' + x.name} />`}</td>
                    <td><b>${x.url ? html`<a href=${x.url} target="_blank" rel="noopener">${x.name}</a>` : x.name}</b><div className="muted">${x.title}</div></td>
                    <td>${x.loc}</td>
                    <td className="trwrap">${String(x.skills || '').slice(0, 120)}</td>
                    <td>${x.exp ? x.exp + ' yrs' : ''}</td>
                    <td>${x.auth}</td>
                  </tr>`
                )}</tbody>
              </table></div>
              <div className="cxline">
                <select value=${job} onChange=${e => setJob(e.target.value)} aria-label="Add them to"><option value="">Talent pool (no job)</option>${cx.jobs.map(j => html`<option key=${j.id} value=${j.id}>${j.ti}</option>`)}</select>
                <button type="button" className="btn sm" disabled=${!!busy || !sel.length} onClick=${importSel}>${busy === 'import' ? 'Adding…' : 'Add ' + (sel.length || '') + ' to Candidates'}</button>
                <span className="actions" style=${{ marginLeft: 'auto' }}>
                  <button type="button" className="btn ghost sm" disabled=${!!busy || f.page <= 1} onClick=${() => search(f.page - 1)}>Previous</button>
                  <button type="button" className="btn ghost sm" disabled=${!!busy || !res.more} onClick=${() => search(f.page + 1)}>Next</button>
                </span>
              </div>
              <p className="muted small" style=${{ margin: 0 }}>${cx.api.dice.ops.profile.on ? 'Each added candidate’s full profile (email, phone, resume) is fetched from Dice, which may use your Dice profile views.' : 'Switch on "Candidate profile" to fetch the email, phone and resume of each added candidate.'} The screening agent then checks them like any other candidate.</p>
            </div>`
          : html`<p className="muted small" style=${{ margin: 0 }}>No candidates found.</p>`)
      }
    </div>`;
}

/* ---- Dice: post, update and close the careers jobs ---- */
// v37.1: a job Dice took without saying its ID shows "Live · ID unknown": it is never posted twice, and its ID can be
// typed in (or picked from Dice's last answer under Live API › Post a job) so it can be updated and closed from here
function CxDiceJobs({ cx, reload }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [edit, setEdit] = useState(null);
  const act = async (job, a, again) => {
    if (a === 'close' && !window.confirm('Close this job on Dice?')) return;
    if (again && !window.confirm('Dice may already show this job. Post it again anyway? Look on Dice first, so it is not listed twice.')) return;
    setBusy(job + a);
    try {
      const r = await api('cx_job', { prov: 'dice', job, act: a, again: !!again });
      if (r.warn) toast(r.warn, true);
      else toast({ post: 'Posted to Dice' + (r.dice && r.dice.id ? ' as ' + r.dice.id : '') + '.', update: 'Updated on Dice.', close: 'Closed on Dice.' }[a] + (r.learned ? ' Its ID was found at ' + r.learned + ' and saved as the Posting ID under Post a job.' : '') + (r.note ? ' ' + r.note : ''));
      reload();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const saveId = async clear => {
    if (clear && !window.confirm('Remove the Dice record of this job? Do this only when the job is not on Dice; it can then be posted again.')) return;
    setBusy(edit.job + 'id');
    try {
      await api('cx_job_id', clear ? { prov: 'dice', job: edit.job, clear: true } : { prov: 'dice', job: edit.job, id: edit.id.trim(), url: edit.url.trim() });
      toast(clear ? 'The Dice record was removed.' : 'Dice ID saved: the job can be updated and closed from here.');
      setEdit(null);
      reload();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const o = cx.api.dice.ops;
  const unknown = cx.jobs.filter(j => j.dice && j.dice.noId && j.dice.st === 'live').length;
  return html`<div className="cxrun">
      <b>Jobs on Dice</b>
      ${unknown > 0 && html`<p className="small cxwarn" style=${{ margin: 0 }}>${unknown === 1 ? 'One job' : unknown + ' jobs'} went to Dice, but Dice's answer did not say the posting ID. They will not be posted again. Look each one up on Dice and enter its ID here, or pick the Posting ID in Dice's last answer under Live API › Post a job.</p>`}
      ${
        cx.jobs.length
          ? html`<div className="tblwrap"><table className="tbl small">
              <thead><tr><th>Job</th><th>On Dice</th><th></th></tr></thead>
              <tbody>${cx.jobs.map(j => {
                const dj = j.dice;
                const liveId = !!(dj && dj.id && dj.st === 'live');
                const noId = !!(dj && dj.noId && dj.st === 'live');
                const editing = edit && edit.job === j.id;
                return html`<tr key=${j.id}>
                  <td>${j.code ? html`<code>${j.code}</code> ` : null}<b>${j.ti}</b><div className="muted">${j.loc}${j.open === false ? ' · closed on the careers page' : j.internal ? ' · internal only (not for job boards)' : j.off ? ' · Dice is switched off for this job (job boards desk)' : ''}</div></td>
                  <td>
                    ${
                      editing
                        ? html`<div className="cxidform">
                            <input value=${edit.id} onInput=${e => setEdit({ ...edit, id: e.target.value })} placeholder="Dice posting ID" aria-label="Dice posting ID" spellCheck="false" />
                            <input value=${edit.url} onInput=${e => setEdit({ ...edit, url: e.target.value })} placeholder="Link on Dice (optional, https://…)" aria-label="Link on Dice" spellCheck="false" />
                            <div className="actions">
                              <button type="button" className="btn sm" disabled=${!!busy || !edit.id.trim()} onClick=${() => saveId(false)}>${busy === edit.job + 'id' ? 'Saving…' : 'Save'}</button>
                              <button type="button" className="btn ghost sm" disabled=${!!busy} onClick=${() => setEdit(null)}>Cancel</button>
                              <button type="button" className="btn link small" disabled=${!!busy} onClick=${() => saveId(true)}>It is not on Dice</button>
                            </div>
                          </div>`
                        : dj && dj.id
                          ? html`${dj.url ? html`<a href=${dj.url} target="_blank" rel="noopener">${dj.id}</a>` : dj.id} <${Chip} s=${dj.st === 'closed' ? '' : 'ok'}>${dj.st === 'closed' ? 'Closed' : 'Live'}<//><div className="muted">${fmtTs(dj.at)}${dj.idBy === 'hand' ? ' · ID entered by hand' : ''}</div>`
                          : noId
                            ? html`<${Chip} s="amber">Live · ID unknown<//><div className="muted">Sent ${fmtTs(dj.postedAt || dj.at)}${dj.by ? ' by ' + dj.by : ''}</div>`
                            : html`<span className="muted">Not posted</span>`
                    }
                    ${(j.open === false || j.off) && (liveId || noId) && html`<div className="small cxwarn">Still live on Dice${noId ? ': enter its ID to close it from here, or close it on Dice.' : j.off ? ': "Keep Dice in step" closes it at its next run, or close it here.' : '.'}</div>`}
                  </td>
                  <td className="r nowrap"><div className="actions" style=${{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                    ${!editing && !liveId && !noId && j.open !== false && !j.internal && html`<button type="button" className="btn sm" disabled=${!!busy} onClick=${() => act(j.id, 'post')} title=${j.off ? 'Dice is switched off for this job; posting it here switches Dice on for it' : undefined}>${busy === j.id + 'post' ? 'Posting…' : 'Post to Dice'}</button>`}
                    ${!editing && noId && html`<button type="button" className="btn sm" disabled=${!!busy} onClick=${() => setEdit({ job: j.id, id: '', url: '' })}>Enter the Dice ID</button>`}
                    ${!editing && !liveId && !noId && html`<button type="button" className="btn link small" disabled=${!!busy} onClick=${() => setEdit({ job: j.id, id: '', url: '' })} title="It was posted before (or by hand): enter its Dice ID instead of posting it again">Already on Dice?</button>`}
                    ${!editing && noId && j.open !== false && !j.internal && html`<button type="button" className="btn ghost sm" disabled=${!!busy} onClick=${() => act(j.id, 'post', true)}>${busy === j.id + 'post' ? 'Posting…' : 'Post again'}</button>`}
                    ${!editing && liveId && o.update.on && j.open !== false && !j.off && html`<button type="button" className="btn ghost sm" disabled=${!!busy} onClick=${() => act(j.id, 'update')}>Update</button>`}
                    ${!editing && liveId && o.close.on && html`<button type="button" className="btn ghost sm" disabled=${!!busy} onClick=${() => act(j.id, 'close')}>Close</button>`}
                    ${!editing && liveId && html`<button type="button" className="btn link small" disabled=${!!busy} onClick=${() => setEdit({ job: j.id, id: dj.id || '', url: dj.url || '' })}>Change ID</button>`}
                  </div></td>
                </tr>`;
              })}</tbody>
            </table></div>`
          : html`<p className="muted small" style=${{ margin: 0 }}>No open jobs on the careers page.</p>`
      }
      <p className="muted small" style=${{ margin: 0 }}>Applicants who click Apply on Dice come to the job’s page on your site and arrive in Candidates with the source Dice.</p>
    </div>`;
}
/* ---- v37.1: Dice's last answer to "Post a job": the fields in it, to pick the Posting ID (and link) by hand ---- */
function CxLastAnswer({ last, map, setMap }) {
  if (!last) return null;
  const okCode = last.code >= 200 && last.code < 300;
  const hdrs = Object.entries(last.hdrs || {});
  const paths = last.paths || [];
  const pick = (k, p) => setMap(k, map[k] === p ? '' : p);
  const btn = (k, p, label) => html`<button type="button" className=${'btn sm ' + (map[k] === p ? '' : 'ghost')} onClick=${() => pick(k, p)} aria-pressed=${map[k] === p}>${map[k] === p ? label + ' ✓' : label}</button>`;
  return html`<details className="cxlast" open=${!!(last.err || !last.id)}>
      <summary className="small"><b>Dice's last answer</b> <span className="muted">${fmtTs(last.at)}${last.ti ? ' · ' + last.ti : ''}</span> ${okCode && !last.err ? html`<${Chip} s="ok">${last.code}<//>` : html`<${Chip} s="red">${last.code || 'No answer'}<//>`} <span className="muted">${last.id ? 'posting ID ' + last.id + (last.found ? ' (at ' + last.found + ')' : '') : last.err ? '' : 'no posting ID found'}</span></summary>
      <div className="stack" style=${{ gap: 8, marginTop: 8 }}>
        ${last.err && html`<p className="err small" style=${{ margin: 0 }}>${last.err}</p>`}
        ${(paths.length > 0 || hdrs.length > 0 || last.text) && html`<p className="small" style=${{ margin: 0 }}>Pick the field that is the posting's ID (and its public link, if there is one), then press <b>Save the connection</b>. Every later answer is read the same way.</p>`}
        ${
          paths.length > 0 &&
          html`<div className="cxpaths">${paths.map(([p, v]) => html`<div key=${p} className="cxpathrow"><code>${p}</code><span className="muted cxval">${v}</span><span className="push">${btn('id', p, 'Posting ID')}${/^https:\/\//.test(v) ? btn('url', p, 'Posting link') : null}</span></div>`)}</div>`
        }
        ${hdrs.length > 0 && html`<div className="cxpaths">${hdrs.map(([k, v]) => html`<div key=${k} className="cxpathrow"><code>${k}</code><span className="muted cxval">${v}</span><span className="push">${btn('id', '@header:' + k, 'Posting ID')}</span></div>`)}</div>`}
        ${last.text && html`<div className="cxpaths"><div className="cxpathrow"><code>the whole answer</code><span className="muted cxval">${last.text.slice(0, 120)}</span><span className="push">${btn('id', '@text', 'Posting ID')}</span></div></div>`}
        ${!paths.length && !hdrs.length && !last.text && !last.err && html`<p className="muted small" style=${{ margin: 0 }}>The answer was empty: nothing in it names the posting. Enter each job's Dice ID by hand under Jobs on Dice, or ask Dice which call or field returns the posting ID.</p>`}
        ${last.sample && html`<details><summary className="small">The answer as sent (secrets removed)</summary><pre className="trpre">${last.sample}</pre></details>`}
      </div>
    </details>`;
}

/* ---- the call log ---- */
function CxLog({ rows }) {
  if (!rows || !rows.length) return null;
  return html`<section className="panel">
      <details>
        <summary><b>API calls</b> <span className="muted small">the last ${rows.length} (no data or secrets kept)</span></summary>
        <div className="tblwrap" style=${{ marginTop: 8 }}><table className="tbl small">
          <thead><tr><th>When</th><th>Connection</th><th>Call</th><th>Answer</th><th className="r">Time</th><th className="r">Records</th></tr></thead>
          <tbody>${rows.map((r, i) => html`<tr key=${i}><td className="nowrap">${fmtTs(r.at)}</td><td>${r.prov === 'dice' ? 'Dice' : 'iLabor360'}</td><td><code className="small">${r.m} ${r.path}</code><div className="muted">${r.op}</div></td><td>${r.code >= 200 && r.code < 300 ? html`<${Chip} s="ok">${r.code}<//>` : html`<${Chip} s="red">${r.code || '—'}<//>`}${r.err ? html`<div className="small" style=${{ color: 'var(--red-ink)' }}>${r.err}</div>` : ''}</td><td className="r">${r.ms} ms</td><td className="r">${r.n || ''}</td></tr>`)}</tbody>
        </table></div>
      </details>
    </section>`;
}

/* ================= v80: Ceipal & Oorwin — the easy connector. Paste credentials, Test, Pull now (jobs →
   Requirements desk, candidates → Consultant database), or let a schedule pull. Routes atc_* (api/atc.php). ================= */
function AtcCard({ prov, p, reload }) {
  const toast = useToast();
  const isC = prov === 'ceipal';
  const cfg = p.cfg;
  const [f, setF] = useState(() =>
    isC
      ? { email: cfg.email || '', apiKey: '', password: '', base: cfg.base || '', tokenPath: cfg.tokenPath || '', jobsPath: cfg.jobsPath || '', candsPath: cfg.candsPath || '', jobs: cfg.jobs, cands: cfg.cands, sched: cfg.sched || 0, pages: cfg.pages || 3, size: cfg.size || 50, on: cfg.on }
      : { apiKey: '', keyHeader: cfg.keyHeader || 'Authorization', keyPrefix: cfg.keyPrefix || 'Bearer ', base: cfg.base || '', jobsPath: cfg.jobsPath || '', candsPath: cfg.candsPath || '', jobs: cfg.jobs, cands: cfg.cands, sched: cfg.sched || 0, pages: cfg.pages || 3, size: cfg.size || 50, on: cfg.on }
  );
  const [busy, setBusy] = useState('');
  const [adv, setAdv] = useState(false);
  const [res, setRes] = useState(null);
  const set = k => e => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const call = async (route, body, label) => {
    setBusy(label);
    setRes(null);
    try {
      const r = await api(route, { prov, ...body });
      await reload();
      return r;
    } catch (e) {
      toast(errText(e), true);
    } finally {
      setBusy('');
    }
  };
  const save = async () => {
    const cfgOut = { base: f.base, jobsPath: f.jobsPath, candsPath: f.candsPath, jobs: f.jobs, cands: f.cands, sched: +f.sched, pages: +f.pages, size: +f.size, on: f.on };
    if (isC) { cfgOut.tokenPath = f.tokenPath; cfgOut.email = f.email; if (f.apiKey.trim()) cfgOut.apiKey = f.apiKey.trim(); if (f.password.trim()) cfgOut.password = f.password.trim(); }
    else { cfgOut.keyHeader = f.keyHeader; cfgOut.keyPrefix = f.keyPrefix; if (f.apiKey.trim()) cfgOut.apiKey = f.apiKey.trim(); }
    const r = await call('atc_save', { cfg: cfgOut }, 'save');
    if (r) { toast(p.n + ' settings saved.'); setF({ ...f, apiKey: '', password: '' }); }
  };
  const test = async () => { const r = await call('atc_test', {}, 'test'); if (r) setRes(r); };
  const pull = async () => {
    const r = await call('atc_pull', {}, 'pull');
    if (r && r.result) { const x = r.result; toast(`${p.n}: ${x.jobs.added} job${x.jobs.added === 1 ? '' : 's'} and ${x.cands.added} candidate${x.cands.added === 1 ? '' : 's'} imported.${x.errors && x.errors.length ? ' (' + x.errors.join('; ') + ')' : ''}`); }
  };
  const remove = async () => { if (confirm('Remove the ' + p.n + ' connection and its saved credentials?')) { const r = await call('atc_save', { clear: true }, 'rm'); if (r) toast(p.n + ' removed.'); } };
  const last = cfg.last && cfg.last.at ? cfg.last : null;
  return html`<section className="panel form srcanchor" id=${'src-' + prov}>
    <div className="srchead">
      <h3 className="ph" style=${{ margin: 0 }}>${p.n}</h3>
      <span className=${'chip ' + (p.ready ? 'ok' : cfg.at ? 'amber' : '')}>${p.ready ? 'Ready' : cfg.at ? 'Credentials saved' : 'Not set up'}</span>
      ${cfg.on ? html`<span className="chip ok">Scheduled pull on</span>` : ''}
    </div>
    <p className="muted small" style=${{ margin: 0 }}>
      ${isC ? 'Enter the Ceipal account email, API key and password. StratEdge signs in for a token on its own and reads your job postings and applicants.' : 'Paste the Oorwin API key. StratEdge sends it as a header and reads your jobs and candidates.'}
      Jobs become requirements on the desk; candidates go into the consultant database. Credentials are encrypted on the server.
    </p>
    ${
      isC
        ? html`<div className="row2">
            <${Field} label="Account email" hint=${cfg.email ? 'Saved: ' + cfg.email : ''}><input value=${f.email} onInput=${set('email')} autoComplete="off" placeholder="you@company.com" /><//>
            <${Field} label="API key" hint=${cfg.hasKey ? 'Saved (type to replace)' : 'From Ceipal (API access is enabled on request)'}><input type="password" value=${f.apiKey} onInput=${set('apiKey')} autoComplete="new-password" placeholder=${cfg.hasKey ? '•••••••• (saved)' : ''} /><//>
          </div>
          <${Field} label="Password" hint=${cfg.hasPassword ? 'Saved (type to replace)' : ''}><input type="password" value=${f.password} onInput=${set('password')} autoComplete="new-password" placeholder=${cfg.hasPassword ? '•••••••• (saved)' : 'Ceipal password'} /><//>`
        : html`<div className="row2">
            <${Field} label="API key" hint=${cfg.hasKey ? 'Saved (type to replace)' : 'From your Oorwin account'}><input type="password" value=${f.apiKey} onInput=${set('apiKey')} autoComplete="new-password" placeholder=${cfg.hasKey ? '•••••••• (saved)' : ''} /><//>
            <${Field} label="Key header" hint="How Oorwin expects the key (default Authorization: Bearer …)"><input value=${f.keyHeader} onInput=${set('keyHeader')} placeholder="Authorization" /><//>
          </div>`
    }
    <div className="checks">
      <label className="kcheck"><input type="checkbox" checked=${!!f.jobs} onChange=${set('jobs')} /><span>Import jobs → Requirements desk</span></label>
      <label className="kcheck"><input type="checkbox" checked=${!!f.cands} onChange=${set('cands')} /><span>Import candidates → Consultant database</span></label>
      <label className="kcheck"><input type="checkbox" checked=${!!f.on} onChange=${set('on')} /><span>Let the schedule pull automatically</span></label>
    </div>
    ${f.on ? html`<${Field} label="Pull every (hours)"><select value=${f.sched} onChange=${set('sched')}><option value="0">Off</option><option value="2">2</option><option value="4">4</option><option value="6">6</option><option value="12">12</option><option value="24">24</option></select><//>` : ''}
    <button type="button" className="btn link small" onClick=${() => setAdv(a => !a)}>${adv ? 'Hide advanced' : 'Advanced (endpoints & paging)'}</button>
    ${
      adv &&
      html`<div className="form" style=${{ background: 'var(--surface-2)', padding: 10, borderRadius: 10 }}>
        <${Field} label="Base address"><input value=${f.base} onInput=${set('base')} placeholder="https://api…" /><//>
        ${isC ? html`<${Field} label="Sign-in path"><input value=${f.tokenPath} onInput=${set('tokenPath')} placeholder="createAuthtoken/" /><//>` : html`<${Field} label="Key prefix" hint="Text before the key, e.g. 'Bearer '"><input value=${f.keyPrefix} onInput=${set('keyPrefix')} /><//>`}
        <div className="row2"><${Field} label="Jobs list path"><input value=${f.jobsPath} onInput=${set('jobsPath')} /><//><${Field} label="Candidates list path"><input value=${f.candsPath} onInput=${set('candsPath')} /><//></div>
        <div className="row2"><${Field} label="Pages per pull"><input type="number" min="1" max="20" value=${f.pages} onInput=${set('pages')} /><//><${Field} label="Records per page"><input type="number" min="1" max="200" value=${f.size} onInput=${set('size')} /><//></div>
      </div>`
    }
    ${res && html`<div className=${'note ' + (res.ok ? 'ok' : 'red')}><span>${res.what}</span></div>`}
    ${last ? html`<p className="muted small" style=${{ margin: 0 }}>Last pull ${fmtTs(last.at)}${last.how === 'schedule' ? ' (scheduled)' : ''}: ${last.jobs || 0} job(s), ${last.cands || 0} candidate(s).${last.errors && last.errors.length ? ' Issues: ' + last.errors.join('; ') : ''}</p>` : ''}
    <div className="actions">
      <button type="button" className="btn" disabled=${!!busy} onClick=${save}>${busy === 'save' ? 'Saving…' : 'Save'}</button>
      <button type="button" className="btn ghost" disabled=${!!busy || !p.ready} onClick=${test}>${busy === 'test' ? 'Testing…' : 'Test connection'}</button>
      <button type="button" className="btn ghost" disabled=${!!busy || !p.ready} onClick=${pull}><${Icon} n="down" />${busy === 'pull' ? 'Pulling…' : 'Pull now'}</button>
      ${cfg.at ? html`<button type="button" className="btn ghost danger" disabled=${!!busy} onClick=${remove}>Remove</button>` : ''}
      ${cfg.at ? html`<span className="muted small">Saved ${fmtTs(cfg.at)}${cfg.by ? ' by ' + cfg.by : ''}</span>` : ''}
    </div>
  </section>`;
}
function AtcConnect() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const load = () => api('atc_get').then(setD).catch(e => toast(errText(e), true));
  useEffect(() => { load(); }, []);
  if (!d) return html`<div className="panel"><${Spinner} /></div>`;
  return html`<div className="stack">
    <div className="note info"><span><b>Connect Ceipal and Oorwin the easy way.</b> Paste your credentials, press <b>Test connection</b>, then <b>Pull now</b> — jobs land on the Requirements desk and candidates in the Consultant database. Turn on the schedule to keep them flowing. Everything is encrypted on your server; nothing is sent anywhere else.</span></div>
    <${AtcCard} prov="ceipal" p=${d.providers.ceipal} reload=${load} />
    <${AtcCard} prov="oorwin" p=${d.providers.oorwin} reload=${load} />
  </div>`;
}
