/* ================= Ads: website promotions with view/click counts, and social job posts (staff pages; the public ad card is in pub.js) ================= */
function AdsPage() {
  const [tab, setTab] = useState('ads');
  const stats = useCol('ads/stats');
  const ads = useCol('org/site/ads');
  const st = {};
  stats.docs.forEach(s => {
    st[s.id] = s;
  });
  const tot = ads.docs.reduce(
    (a, x) => ({ v: a.v + ((st[x.id] || {}).views || 0), c: a.c + ((st[x.id] || {}).clicks || 0) }),
    { v: 0, c: 0 }
  );
  const today = dkey();
  const live = ads.docs.filter(a => a.on && (!a.from || a.from <= today) && (!a.to || a.to >= today));
  return html`<div className="stack">
      <${KitStats} items=${[
        { v: live.length, l: 'Ads live on the website', tone: live.length ? 'ok' : '' },
        { v: tot.v.toLocaleString(), l: 'Views (one per visit)' },
        { v: tot.c.toLocaleString(), l: 'Clicks' },
        { v: tot.v ? ((tot.c / tot.v) * 100).toFixed(1) + '%' : '—', l: 'Click-through rate' },
      ]} />
      <${KitTabs} tab=${tab} onTab=${setTab} tabs=${[
        ['ads', 'Website ads'],
        ['social', 'Social job posts'],
      ]} />
      ${
        tab === 'ads' &&
        html`<${KitList} col="org/site/ads" fields=${AD_FIELDS} cols=${['t', 'place', 'from', 'to', 'on']} title="Website ads" noun="Ad"
            defaults=${{ place: 'bar', theme: 'navy', cta: 'See open roles', url: '#/careers', on: true }}
            empty="No ads yet. Add one to promote roles, services or an event across the website."
            preview=${f => html`<${AdView} ad=${{ ...f, t: f.t || 'Your headline' }} place=${f.place || 'bar'} />`}
            rowTools=${r => {
              const s = st[r.id] || {};
              return html`<span className="adstat">${(s.views || 0).toLocaleString()} views · ${(s.clicks || 0).toLocaleString()} clicks${s.views ? ` · ${(((s.clicks || 0) / s.views) * 100).toFixed(1)}%` : ''}</span>
                <button type="button" className=${'btn sm ' + (r.on ? 'ghost' : 'go')} onClick=${() => dbMerge(`org/site/ads/${r.id}`, { on: !r.on, u: Date.now() })}>${r.on ? 'Pause' : 'Go live'}</button>`;
            }} />`
      }
      ${tab === 'social' && html`<${SocialBuilder} />`}
    </div>`;
}
function adTags(sk) {
  return String(sk || '')
    .split(/[,/|]+/)
    .map(s => s.trim().replace(/[^A-Za-z0-9+#]/g, '').replace(/\+/g, 'Plus').replace(/#/g, 'Sharp'))
    .filter(s => s.length > 1)
    .slice(0, 4)
    .map(s => '#' + s);
}
function SocialBuilder() {
  const toast = useToast();
  const jobs = useCol('org/site/jobs', 'at:desc');
  const open = jobs.docs.filter(j => j.open !== false);
  const [jid, setJid] = useState('');
  const [f, setF] = useState({ t: '', loc: '', ty: '', md: '', sk: '', extra: '' });
  useEffect(() => {
    const j = open.find(x => x.id === jid);
    if (j) setF(s => ({ ...s, t: j.ti || '', loc: j.loc || '', ty: j.ty || '', md: j.md || '', sk: j.sk || '' }));
  }, [jid]);
  const base = location.origin + location.pathname;
  const link = ch => jobShareLink(jid, ch); // v31: through job.php so the networks show the role's card
  const meta = [f.loc, f.ty, f.md].filter(Boolean).join(' · ');
  const tags = [...adTags(f.sk), '#hiring', '#StratEdge'].join(' ');
  const posts = [
    ['linkedin', 'LinkedIn', `🚀 We're hiring: ${f.t || 'your role'}\n${meta ? '📍 ' + meta + '\n' : ''}${f.sk ? '\nSkills: ' + f.sk + '\n' : ''}${f.extra ? '\n' + f.extra + '\n' : ''}\nApply in one click: ${link('linkedin')}\n\n${tags}`],
    ['x', 'X (Twitter)', `Hiring: ${f.t || 'your role'}${meta ? ' (' + meta + ')' : ''}. Apply in one click 👉 ${link('x')} ${tags}`.slice(0, 280)],
    ['facebook', 'Facebook', `Know someone great? We're looking for a ${f.t || 'new teammate'}${f.loc ? ' in ' + f.loc : ''}.${f.sk ? ' Skills: ' + f.sk + '.' : ''}${f.extra ? ' ' + f.extra : ''}\n\nApply here: ${link('facebook')}`],
    ['whatsapp', 'WhatsApp', `*${f.t || 'Open role'}*\n${meta}\n${f.sk ? 'Skills: ' + f.sk + '\n' : ''}Apply: ${link('whatsapp')}`],
    ['email', 'Email', `Subject: ${f.t || 'Open role'}${f.loc ? ', ' + f.loc : ''}\n\nHi,\n\nWe're hiring a ${f.t || 'new teammate'}${meta ? ' (' + meta + ')' : ''}.${f.sk ? ' Key skills: ' + f.sk + '.' : ''}\n\nYou can apply in one click here: ${link('email')}\n\nThanks,\nStratEdge IT Consulting`],
  ];
  const share = {
    linkedin: u => 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(u),
    x: (u, t) => 'https://x.com/intent/tweet?text=' + encodeURIComponent(t),
    facebook: u => 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(u),
    whatsapp: (u, t) => 'https://wa.me/?text=' + encodeURIComponent(t),
  };
  const copy = t =>
    navigator.clipboard
      ? navigator.clipboard.writeText(t).then(
          () => toast('Copied.'),
          () => toast('Select the text and copy it.', true)
        )
      : toast('Select the text and copy it.', true);
  const image = async () => {
    try {
      const blob = await adImage(f, base.replace(/^https?:\/\//, '').replace(/\/$/, ''));
      await saveDownload(`job-post-${(f.t || 'role').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`, blob);
    } catch (e) {
      if (!e || e.code !== 'declined') toast(errText(e), true);
    }
  };
  const up = k => e => setF({ ...f, [k]: e.target.value });
  return html`<div className="g2 social">
      <section className="panel form">
        <${Field} label="Start from an open role (optional)">
          <select value=${jid} onChange=${e => setJid(e.target.value)}>
            <option value="">Write my own</option>
            ${open.map(j => html`<option key=${j.id} value=${j.id}>${j.ti}${j.loc ? ' · ' + j.loc : ''}</option>`)}
          </select>
        <//>
        <${Field} label="Role title"><input value=${f.t} onInput=${up('t')} placeholder="e.g. Senior Network Engineer" /><//>
        <div className="row3">
          <${Field} label="Location"><input value=${f.loc} onInput=${up('loc')} /><//>
          <${Field} label="Engagement"><input value=${f.ty} onInput=${up('ty')} placeholder="C2C, W2, Full-time" /><//>
          <${Field} label="Work mode"><input value=${f.md} onInput=${up('md')} placeholder="Onsite, Hybrid, Remote" /><//>
        </div>
        <${Field} label="Skills" hint="Comma separated; the first four become hashtags."><input value=${f.sk} onInput=${up('sk')} /><//>
        <${Field} label="Extra line (optional)"><input value=${f.extra} onInput=${up('extra')} placeholder="e.g. Day 1 onsite, long-term project" /><//>
        <div className="actions">
          <button type="button" className="btn" onClick=${image}><${Icon} n="down" />Download post image</button>
          ${jid && html`<a className="btn ghost" href=${'#/careers/' + jid} target="_blank" rel="noopener">Open the job page</a>`}
        </div>
        <p className="muted small">Links carry ?src=… so you can tell which channel people came from. Every link opens the role with the one-click Easy apply button.</p>
      </section>
      <div className="stack">
        ${posts.map(
          ([k, n, t]) => html`<section key=${k} className="panel post">
              <div className="posthead">
                <b>${n}</b>
                <div className="push">
                  ${share[k] && html`<a className="btn ghost sm" href=${share[k](link(k), t)} target="_blank" rel="noopener">Share</a>`}
                  <button type="button" className="btn sm" onClick=${() => copy(t)}>Copy</button>
                </div>
              </div>
              <pre>${t}</pre>
            </section>`
        )}
      </div>
    </div>`;
}
/* Draws a 1200×628 job post (the size LinkedIn, Facebook and X show best) and returns it as a PNG blob. */
async function adImage(f, site, type) {
  const c = document.createElement('canvas');
  c.width = 1200;
  c.height = 628;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 1200, 628);
  g.addColorStop(0, '#0f1b4d');
  g.addColorStop(0.55, '#2b3993');
  g.addColorStop(1, '#0e8f8a');
  x.fillStyle = g;
  x.fillRect(0, 0, 1200, 628);
  x.globalAlpha = 0.08;
  x.fillStyle = '#fff';
  for (let i = 0; i < 7; i++) {
    x.beginPath();
    x.arc(1040 - i * 40, 90 + i * 18, 220 - i * 26, 0, Math.PI * 2);
    x.fill();
  }
  x.globalAlpha = 1;
  const font = (w, s) => `${w} ${s}px Archivo, "Segoe UI", Arial, sans-serif`;
  x.fillStyle = '#7ff0e3';
  x.font = font(700, 26);
  x.fillText("WE'RE HIRING", 72, 110);
  x.fillStyle = '#ffffff';
  x.font = font(800, 64);
  const words = String(f.t || 'Open role').split(/\s+/);
  const lines = [];
  let line = '';
  words.forEach(w => {
    const t = line ? line + ' ' + w : w;
    if (x.measureText(t).width > 1000 && line) {
      lines.push(line);
      line = w;
    } else line = t;
  });
  lines.push(line);
  lines.slice(0, 3).forEach((l, i) => x.fillText(l, 72, 190 + i * 74));
  let y = 190 + Math.min(lines.length, 3) * 74 + 6;
  const meta = [f.loc, f.ty, f.md].filter(Boolean).join('  ·  ');
  if (meta) {
    x.fillStyle = '#d6dcff';
    x.font = font(500, 30);
    x.fillText(meta, 72, y);
    y += 56;
  }
  let cx = 72;
  x.font = font(600, 24);
  String(f.sk || '')
    .split(/,\s*/)
    .filter(Boolean)
    .slice(0, 5)
    .forEach(s => {
      const w = x.measureText(s).width + 36;
      if (cx + w > 1130) return;
      x.fillStyle = 'rgba(255,255,255,0.14)';
      x.beginPath();
      x.roundRect ? x.roundRect(cx, y - 32, w, 46, 23) : x.rect(cx, y - 32, w, 46);
      x.fill();
      x.fillStyle = '#ffffff';
      x.fillText(s, cx + 18, y);
      cx += w + 12;
    });
  x.fillStyle = '#ffffff';
  x.beginPath();
  x.roundRect ? x.roundRect(72, 512, 340, 64, 32) : x.rect(72, 512, 340, 64);
  x.fill();
  x.fillStyle = '#0f1b4d';
  x.font = font(800, 26);
  x.fillText('Apply in one click →', 98, 553);
  x.fillStyle = '#d6dcff';
  x.font = font(600, 22);
  x.textAlign = 'right';
  x.fillText(site, 1128, 553);
  x.textAlign = 'left';
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = LOGO_D;
    });
    const h = 54;
    const w = (img.width / img.height) * h;
    x.drawImage(img, 1128 - w, 56, w, h);
  } catch (e) {
    /* no logo, still a good image */
  }
  return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej({ message: 'The image could not be created.' })), type || 'image/png', 0.9));
}

/* ================= Admin › Security & spam firewall ================= */
const SEC_KINDS = {
  spam: 'Spam stopped',
  login: 'Failed or wrong logins',
  rate: 'Too many requests',
  ban: 'Automatic bans',
  blocked: 'Blocked requests',
  trap: 'Scanner probes',
  inject: 'Prompt injection',
  xsite: 'Cross-site requests',
  bot: 'Bot-check failures',
  upload: 'Uploads refused',
  settings: 'Setting changes',
  strike: 'Strikes',
};
const SEC_NUM = [
  ['api_per_min', 'API calls per address per minute'],
  ['poll_per_min', 'Live-update checks per address per minute'],
  ['form_per_hour', 'Public form posts per address per hour'],
  ['strikes', 'Strikes in an hour before a ban'],
  ['ban_min', 'Automatic ban length (minutes)'],
  ['min_seconds', 'Fastest a person can fill a form (seconds)'],
  ['max_links', 'Links allowed in a message'],
  ['log_days', 'Keep the log for (days)'],
];
const SEC_LISTS = [
  ['words', 'Blocked words and phrases', 'One per line. Messages containing any of them are rejected.'],
  ['domains', 'Blocked email domains', 'One per line, e.g. spammy-domain.com'],
  ['emails', 'Blocked email addresses', 'One per line.'],
  ['block_ips', 'Blocked addresses', 'One per line: an address, a prefix like 203.0.113. or a range like 203.0.113.0/24'],
  ['allow', 'Always allowed addresses', 'Your office network. Never limited or banned.'],
  ['proxies', 'Trusted proxies', 'Only when the site sits behind a proxy or load balancer of your own: its addresses, one per line (an address, a prefix like 10.0.0. or a block). Their X-Forwarded-For is then believed. Cloudflare needs no entry: its networks are built in.'],
  ['countries', 'Blocked countries', 'Two-letter codes, one per line (e.g. RU). Uses the sign-in location lookup.'],
];
/* v62: how requests reach this site: direct, through Cloudflare, or through a trusted proxy; a forwarded address from
   anyone else is ignored (and shown, so a proxy that should be trusted is noticed) */
function SecEdge({ e }) {
  if (!e) return null;
  const via = e.via === 'cloudflare' ? 'through Cloudflare' : e.via === 'proxy' ? 'through a trusted proxy (' + e.remote + ')' : 'directly';
  return html`<div className=${'note ' + (e.untrusted ? 'amber' : 'ok')}>
      <span><b>Requests arrive ${via}.</b> Your address as the site sees it: <code>${e.ip}</code>${e.via !== 'direct' ? html` (the connection itself comes from <code>${e.remote}</code>)` : ''}. Bans, rate limits, sign-in alerts and locations use this address.${e.untrusted ? html` <b>A ${e.untrusted} header arrived from ${e.remote}, which is not Cloudflare and not a trusted proxy, so it was ignored.</b> If that is your own proxy or load balancer, add its address under Trusted proxies below; otherwise nothing is wrong.` : ''}</span>
    </div>`;
}
function SecurityPage() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [f, setF] = useState(null);
  const [kind, setKind] = useState('');
  const [blk, setBlk] = useState({ k: '', kind: 'ip', minutes: '1440', why: '' });
  const [tst, setTst] = useState({ name: '', email: '', message: '' });
  const [tres, setTres] = useState(null);
  const [busy, setBusy] = useState('');
  const load = () =>
    api('sec_overview')
      .then(r => {
        setD(r);
        setErr(null);
        setF(x => x || { ...r.settings });
      })
      .catch(setErr);
  useEffect(() => {
    load();
    const t = setInterval(() => !document.hidden && load(), 30000);
    return () => clearInterval(t);
  }, []);
  if (err && !d) return html`<${LoadError} error=${err} onRetry=${load} />`;
  if (!d || !f) return html`<${Spinner} onRetry=${load} />`;
  const run = async (k, route, body, msg) => {
    setBusy(k);
    try {
      const r = await api(route, body);
      if (msg) toast(msg);
      await load();
      return r;
    } catch (e) {
      toast(errText(e), true);
    } finally {
      setBusy('');
    }
  };
  const saveSettings = async () => {
    const r = await run('save', 'sec_save', { settings: f }, 'Security settings saved.');
    if (r && r.settings) setF({ ...r.settings });
  };
  const block = (k, kd, minutes, why) =>
    run('block', 'sec_block', { k, kind: kd, minutes: +minutes, min: +minutes, why }, `${k} blocked.`);
  const counts = d.counts || {};
  const log = (d.log || []).filter(x => !kind || x.kind === kind);
  const until = t => (+t === 0 ? 'Permanent' : +t < Date.now() ? 'Expired' : 'Until ' + fmtTs(+t));
  const num = k => e => setF({ ...f, [k]: e.target.value === '' ? '' : +e.target.value });
  return html`<div className="stack">
      <${SecEdge} e=${d.edge} />
      <div className=${'note ' + (f.enabled ? 'ok' : 'amber')}>
        <span><b>${f.enabled ? 'The firewall is on.' : 'The firewall is off.'}</b> Your address right now is ${d.you}. Add it under "Always allowed addresses" so you can never lock yourself out. ${(d.disposable || 0).toLocaleString()} throwaway email domains are blocked out of the box.</span>
      </div>
      <${KitStats} items=${[
        { v: counts.spam || 0, l: 'Spam messages stopped (24 h)', tone: counts.spam ? 'ok' : '' },
        { v: (counts.blocked || 0) + (counts.rate || 0), l: 'Requests refused (24 h)' },
        { v: counts.login || 0, l: 'Failed or wrong logins (24 h)', tone: counts.login > 20 ? 'warn' : '' },
        { v: (d.blocks || []).filter(b => +b.until === 0 || +b.until > Date.now()).length, l: 'Addresses blocked now' },
      ]} />
      <div className="g2" style=${{ alignItems: 'start' }}>
        <section className="panel stack">
          <h2 className="ph">Block an address or email</h2>
          <div className="form">
            <div className="row2">
              <${Field} label=${blk.kind === 'ip' ? 'Address (IP, prefix or range)' : 'Email address'}>
                <input value=${blk.k} onInput=${e => setBlk({ ...blk, k: e.target.value })} placeholder=${blk.kind === 'ip' ? '203.0.113.7' : 'spammer@example.com'} />
              <//>
              <${Field} label="What">
                <select value=${blk.kind} onChange=${e => setBlk({ ...blk, kind: e.target.value })}><option value="ip">Network address</option><option value="email">Email address</option></select>
              <//>
            </div>
            <div className="row2">
              <${Field} label="For">
                <select value=${blk.minutes} onChange=${e => setBlk({ ...blk, minutes: e.target.value })}>
                  <option value="60">1 hour</option><option value="1440">1 day</option><option value="10080">1 week</option><option value="43200">30 days</option><option value="0">Permanently</option>
                </select>
              <//>
              <${Field} label="Reason (optional)"><input value=${blk.why} onInput=${e => setBlk({ ...blk, why: e.target.value })} /><//>
            </div>
            <div>
              <button type="button" className="btn" disabled=${!blk.k.trim() || busy === 'block'} onClick=${() => block(blk.k.trim(), blk.kind, blk.minutes, blk.why).then(() => setBlk({ ...blk, k: '', why: '' }))}>Block</button>
            </div>
          </div>
          <div className="tblwrap">
            <table className="tbl">
              <thead><tr><th>Blocked</th><th>Reason</th><th>Ends</th><th></th></tr></thead>
              <tbody>
                ${(d.blocks || []).slice(0, 80).map(
                  b => html`<tr key=${b.kind + b.k}>
                      <td><code>${b.k}</code><div className="muted small">${b.kind === 'email' ? 'Email' : 'Address'} · ${fmtTs(+b.at)}</div></td>
                      <td className="small">${b.why}</td>
                      <td className="small">${until(b.until)}</td>
                      <td className="r"><button type="button" className="btn ghost sm" onClick=${() => run('unblock', 'sec_unblock', { k: b.k, kind: b.kind }, `${b.k} unblocked.`)}>Unblock</button></td>
                    </tr>`
                )}
                ${!(d.blocks || []).length && html`<tr><td colSpan="4" className="muted small">Nothing is blocked.</td></tr>`}
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel stack">
          <h2 className="ph">Busiest addresses (24 h)</h2>
          <div className="tblwrap">
            <table className="tbl">
              <thead><tr><th>Address</th><th className="r">Events</th><th></th></tr></thead>
              <tbody>
                ${(d.top || []).map(
                  t => html`<tr key=${t.ip}><td><code>${t.ip}</code>${t.ip === d.you ? html` <${Chip} s="new">you<//>` : null}</td><td className="r">${t.n}</td>
                      <td className="r">${t.ip !== d.you && html`<button type="button" className="btn ghost sm" onClick=${() => block(t.ip, 'ip', 1440, 'Blocked from the busiest list')}>Block 1 day</button>`}</td></tr>`
                )}
                ${!(d.top || []).length && html`<tr><td colSpan="3" className="muted small">Quiet so far.</td></tr>`}
              </tbody>
            </table>
          </div>
          <h2 className="ph" style=${{ marginTop: 8 }}>Test the spam filter</h2>
          <div className="form">
            <div className="row2">
              <${Field} label="Name"><input value=${tst.name} onInput=${e => setTst({ ...tst, name: e.target.value })} /><//>
              <${Field} label="Email"><input value=${tst.email} onInput=${e => setTst({ ...tst, email: e.target.value })} /><//>
            </div>
            <${Field} label="Message"><textarea rows="3" value=${tst.message} onInput=${e => setTst({ ...tst, message: e.target.value })} /><//>
            <div className="actions">
              <button type="button" className="btn ghost" onClick=${async () => setTres(await run('test', 'sec_test', tst))}>Check it</button>
              ${tres && html`<span className=${tres.ok ? 'okmsg' : 'err'}>${tres.ok ? 'This would get through.' : 'This would be rejected: ' + tres.why + '.'}</span>`}
            </div>
          </div>
        </section>
      </div>
      <section className="panel stack">
        <div className="toolbar">
          <h2 className="ph" style=${{ margin: 0 }}>Security log</h2>
          <select value=${kind} onChange=${e => setKind(e.target.value)} aria-label="Filter the log">
            <option value="">Everything</option>
            ${Object.entries(SEC_KINDS).map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}
          </select>
          <div className="push">
            <button type="button" className="btn ghost sm" onClick=${() => saveDownload(`security-log-${dkey()}.csv`, toCSV([['Time', 'Address', 'Type', 'Where', 'Detail'], ...log.map(x => [fmtTs(+x.at), x.ip, SEC_KINDS[x.kind] || x.kind, x.route, x.detail])])).catch(() => {})}><${Icon} n="down" />CSV</button>
            <button type="button" className="btn ghost sm" onClick=${() => confirm('Clear the security log? Blocks stay in place.') && run('clear', 'sec_clear', {}, 'Log cleared.')}>Clear log</button>
          </div>
        </div>
        <div className="tblwrap">
          <table className="tbl">
            <thead><tr><th>When</th><th>Address</th><th>Type</th><th>Detail</th><th></th></tr></thead>
            <tbody>
              ${log.slice(0, 200).map(
                (x, i) => html`<tr key=${i}>
                    <td className="small nowrap">${fmtTs(+x.at)}</td>
                    <td><code>${x.ip}</code></td>
                    <td><${Chip} s=${x.kind === 'spam' || x.kind === 'trap' || x.kind === 'ban' ? 'warn' : ''}>${SEC_KINDS[x.kind] || x.kind}<//></td>
                    <td className="small">${x.detail}${x.route ? html`<span className="muted"> · ${x.route}</span>` : null}</td>
                    <td className="r">${x.ip && x.ip !== d.you && html`<button type="button" className="btn ghost sm" onClick=${() => block(x.ip, 'ip', 1440, 'From the log: ' + (SEC_KINDS[x.kind] || x.kind))}>Block</button>`}</td>
                  </tr>`
              )}
              ${!log.length && html`<tr><td colSpan="5" className="muted small">No events${kind ? ' of this type' : ''} yet.</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel stack">
        <h2 className="ph">Firewall settings</h2>
        <div className="checks">
          ${[
            ['enabled', 'Firewall on (rate limits, bans and spam screening)'],
            ['honeypot', 'Hidden trap field on public forms (bots fill it, people never see it)'],
            ['block_disposable', 'Reject throwaway email addresses on sign-up and forms'],
          ].map(
            ([k, n]) => html`<label key=${k} className="kcheck"><input type="checkbox" checked=${!!f[k]} onChange=${e => setF({ ...f, [k]: e.target.checked })} /><span>${n}</span></label>`
          )}
        </div>
        <div className="form seccfg">
          ${SEC_NUM.map(([k, n]) => html`<${Field} key=${k} label=${n}><input type="number" min="0" value=${f[k]} onInput=${num(k)} /><//>`)}
        </div>
        <div className="form seclists">
          ${SEC_LISTS.map(([k, n, h]) => html`<${Field} key=${k} label=${n} hint=${h}><textarea rows="4" value=${f[k] || ''} onInput=${e => setF({ ...f, [k]: e.target.value })} /><//>`)}
        </div>
        <div className="actions">
          <button type="button" className="btn" disabled=${busy === 'save'} onClick=${saveSettings}>${busy === 'save' ? 'Saving…' : 'Save security settings'}</button>
          <button type="button" className="btn ghost" onClick=${() => setF({ ...f, allow: [String(f.allow || '').trim(), d.you].filter(Boolean).join('\n') })}>Add my address to the allow list</button>
        </div>
      </section>
    </div>`;
}

/* ================= Web application firewall (v78): attack signatures, threat scores, bans, and the security analyst
   view. Admin > Web application firewall. Reads waf_overview; blocks go through the existing firewall (sec_block). */
const WAF_ACT_TONE = { block: 'red', ban: 'red', watch: 'amber', log: 'amber' };
const WAF_ACT_LABEL = { block: 'Refused', ban: 'Banned', watch: 'Watch', log: 'Logged' };
const WAF_MODE_NOTE = {
  balanced: 'Balanced: clear attacks are refused, borderline requests are logged for you to review. Low risk of turning away real people.',
  strict: 'Strict: anything suspicious is refused at a lower threshold. Strongest, but a staff member may occasionally hit a false block you then clear.',
  watch: 'Watch only: nothing is refused yet — everything is logged so you can see what the firewall would catch. Switch to Balanced once it looks right.',
};
function WafBars({ series }) {
  if (!series || !series.length) return html`<p className="muted small">No requests flagged in this window.</p>`;
  const max = Math.max(1, ...series.map(s => s.block + s.log));
  return html`<div className="waf-bars" aria-hidden="true">
    ${series.map(s => html`<div key=${s.t} className="waf-bar" title=${fmtTs(s.t) + ': ' + s.block + ' refused, ' + s.log + ' logged'}>
      <div className="waf-bar-block" style=${{ height: 44 * (s.block / max) + 'px' }} />
      <div className="waf-bar-log" style=${{ height: 44 * (s.log / max) + 'px' }} />
    </div>`)}
  </div>`;
}
function WafAddress({ ip, onClose, onBlock }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    api('waf_ip', { ip, geo: true }).then(setD).catch(setErr);
  }, [ip]);
  return html`<${Modal} wide title=${'Address ' + ip} onClose=${onClose}>
    ${err ? html`<p className="err">${errText(err)}</p>` : !d ? html`<${Spinner} />` : html`<div className="stack">
      <${KitStats} items=${[
        { v: d.score, l: 'Attack score now', tone: d.score >= 15 ? 'warn' : '' },
        { v: d.hits, l: 'Flagged requests' },
        { v: d.bans, l: 'Automatic bans' },
        { v: d.people.length, l: 'Accounts signed in here', tone: d.people.length ? 'warn' : '' },
      ]} />
      <div className="note ${d.blocked ? 'red' : d.allowed ? 'ok' : ''}"><span>${d.blocked ? 'Currently blocked.' : d.allowed ? 'On the allow list (never blocked).' : 'Not blocked.'} ${d.cc ? 'Country: ' + d.cc + '. ' : ''}${d.geo && d.geo.label ? d.geo.label + '. ' : ''}${d.you ? 'This is your own address.' : ''}</span></div>
      ${d.people.length > 0 && html`<div><b className="small">Signed in from this address</b><div className="tblwrap"><table className="tbl"><tbody>${d.people.map(p => html`<tr key=${p.uid}><td>${p.name || p.email}</td><td className="small muted">${p.email}</td><td className="r small muted">${fmtTs(p.last)}</td></tr>`)}</tbody></table></div></div>`}
      <div><b className="small">What it sent (firewall)</b>
        <div className="tblwrap"><table className="tbl"><thead><tr><th>When</th><th>Action</th><th>Signatures</th><th>Route</th></tr></thead><tbody>
          ${d.waf.map((e, i) => html`<tr key=${i}><td className="small nowrap">${fmtTs(+e.at)}</td><td><${Chip} s=${WAF_ACT_TONE[e.act] || ''}>${WAF_ACT_LABEL[e.act] || e.act}<//></td><td className="small">${e.rules}${e.sample ? html`<div className="muted" style=${{ fontFamily: 'monospace', fontSize: 11 }}>${e.sample}</div>` : ''}</td><td className="small muted">${e.route}</td></tr>`)}
          ${!d.waf.length && html`<tr><td colSpan="4" className="muted small">Nothing from the application firewall.</td></tr>`}
        </tbody></table></div>
      </div>
      <div className="actions">
        ${!d.you && !d.blocked && html`<button className="btn danger" onClick=${() => { onBlock(ip); onClose(); }}>Block this address</button>`}
        <button className="btn ghost" onClick=${onClose}>Close</button>
      </div>
    </div>`}
  <//>`;
}
function WafPanel({ q }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [f, setF] = useState(null);
  const [hours, setHours] = useState(24);
  const [flt, setFlt] = useState({ act: '', fam: '' });
  const [busy, setBusy] = useState('');
  const [look, setLook] = useState('');
  const [tst, setTst] = useState('');
  const [tres, setTres] = useState(null);
  const load = () =>
    api('waf_overview', { hours, act: flt.act, fam: flt.fam })
      .then(r => { setD(r); setErr(null); setF(x => x || { ...r.cfg }); })
      .catch(setErr);
  useEffect(() => {
    load();
    const t = setInterval(() => !document.hidden && load(), 30000);
    return () => clearInterval(t);
  }, [hours, flt.act, flt.fam]);
  if (err && !d) return html`<${LoadError} error=${err} onRetry=${load} />`;
  if (!d || !f) return html`<${Spinner} onRetry=${load} />`;
  const run = async (k, route, body, msg) => {
    setBusy(k);
    try { const r = await api(route, body); if (msg) toast(msg); await load(); return r; }
    catch (e) { toast(errText(e), true); }
    finally { setBusy(''); }
  };
  const save = async over => { const r = await run('save', 'waf_save', { cfg: { ...f, ...(over || {}) } }, 'Firewall settings saved.'); if (r && r.cfg) setF({ ...r.cfg }); };
  const block = (ip, minutes, why) => run('block', 'sec_block', { k: ip, kind: 'ip', minutes, why: why || 'From the web application firewall' }, ip + ' blocked.');
  const b = d.brief;
  const num = k => e => setF({ ...f, [k]: e.target.value === '' ? '' : +e.target.value });
  const famLabel = k => (d.families && d.families[k]) || k;
  return html`<div className="stack">
    <div className=${'note ' + (!f.on ? 'amber' : f.mode === 'watch' ? 'amber' : 'ok')}>
      <span><b>${!f.on ? 'The web application firewall is off.' : 'The web application firewall is on (' + f.mode + ').'}</b> ${!f.on ? 'Turn it on below to read every request for attacks before any page handles it.' : WAF_MODE_NOTE[f.mode]} ${d.cf ? 'Requests arrive through Cloudflare, so country blocking and addresses use its headers.' : ''}</span>
    </div>
    ${b.attackMode ? html`<div className="note red"><span><b>A password-guessing attack is in progress.</b> Every sign-in is being checked with the bot puzzle until it passes. Nothing is needed from you.</span></div>` : ''}
    <div className="toolbar">
      <div className="tabs" role="tablist" style=${{ marginBottom: 0, border: 0 }}>
        ${[[1, 'Last hour'], [24, '24 hours'], [168, '7 days'], [720, '30 days']].map(([h, n]) => html`<button key=${h} role="tab" aria-selected=${hours === h} className=${hours === h ? 'on' : ''} onClick=${() => setHours(h)}>${n}</button>`)}
      </div>
      <div className="push muted small">Your address: <code>${d.you}</code></div>
    </div>
    <${KitStats} items=${[
      { v: (b.blocked || 0).toLocaleString(), l: 'Requests refused', tone: b.blocked ? 'ok' : '' },
      { v: (b.logged || 0).toLocaleString(), l: 'Logged for review', tone: b.logged ? 'warn' : '' },
      { v: (b.bans || 0).toLocaleString(), l: 'Addresses banned' },
      { v: (b.families[0] && b.families[0].n) || '—', l: 'Most common attack' },
    ]} />
    <div className="g2" style=${{ alignItems: 'start' }}>
      <section className="panel stack">
        <h2 className="ph">Activity</h2>
        <${WafBars} series=${d.series} />
        <div className="muted small"><span className="waf-key block"></span> refused &nbsp; <span className="waf-key log"></span> logged</div>
        <h3 className="ph" style=${{ marginTop: 10 }}>What's being tried</h3>
        ${b.families.length ? html`<div className="chips">${b.families.map(x => html`<button key=${x.k} type="button" className=${'chip' + (flt.fam === x.k ? ' on' : '')} onClick=${() => setFlt({ ...flt, fam: flt.fam === x.k ? '' : x.k })}>${x.n} · ${x.count}</button>`)}</div>` : html`<p className="muted small">Nothing flagged in this window.</p>`}
      </section>
      <section className="panel stack">
        <h2 className="ph">Addresses to consider blocking</h2>
        ${
          b.suggest && b.suggest.length
            ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Address</th><th>Why</th><th></th></tr></thead><tbody>
                ${b.suggest.map(s => html`<tr key=${s.ip}><td><code>${s.ip}</code>${s.cc ? html` <span className="muted small">${s.cc}</span>` : ''}<div className="muted small">score ${s.score}${s.bans ? ', ' + s.bans + ' prior bans' : ''}</div></td><td className="small">${s.why}</td><td className="r"><button className="btn ghost sm" onClick=${() => setLook(s.ip)}>Look</button><button className="btn danger sm" disabled=${busy === 'block'} onClick=${() => block(s.ip, s.minutes, 'Repeat attacker (score ' + s.score + ')')}>Block</button></td></tr>`)}
              </tbody></table></div>`
            : html`<p className="muted small">No address stands out right now. The firewall bans repeat attackers on its own.</p>`
        }
        <h3 className="ph" style=${{ marginTop: 8 }}>Busiest attacking addresses</h3>
        <div className="tblwrap"><table className="tbl"><thead><tr><th>Address</th><th className="r">Hits</th><th></th></tr></thead><tbody>
          ${(b.top || []).map(t => html`<tr key=${t.ip}><td><code>${t.ip}</code>${t.cc ? html` <span className="muted small">${t.cc}</span>` : ''}${t.blocked ? html` <${Chip} s="red">blocked<//>` : t.allowed ? html` <${Chip} s="ok">allowed<//>` : ''}</td><td className="r">${t.n}</td><td className="r"><button className="btn ghost sm" onClick=${() => setLook(t.ip)}>Look</button></td></tr>`)}
          ${!(b.top || []).length && html`<tr><td colSpan="3" className="muted small">Quiet so far.</td></tr>`}
        </tbody></table></div>
      </section>
    </div>
    ${
      b.members && b.members.length
        ? html`<section className="panel stack"><h2 className="ph">Signed-in accounts flagged</h2>
            <p className="muted small">Attack-like requests from people who are signed in. Usually harmless (pasted code, a technical note); occasionally a sign an account is misused. They are never blocked automatically.</p>
            <div className="tblwrap"><table className="tbl"><thead><tr><th>Person</th><th className="r">Requests</th><th className="r">Top score</th></tr></thead><tbody>
              ${b.members.map(m => html`<tr key=${m.uid}><td>${m.name}<div className="muted small">${m.email}</div></td><td className="r">${m.n}</td><td className="r">${m.max}</td></tr>`)}
            </tbody></table></div></section>`
        : ''
    }
    <section className="panel stack">
      <div className="toolbar">
        <h2 className="ph" style=${{ margin: 0 }}>Recent events</h2>
        <select value=${flt.act} onChange=${e => setFlt({ ...flt, act: e.target.value })} aria-label="Filter by action">
          <option value="">Everything</option><option value="block">Refused</option><option value="ban">Banned</option><option value="log">Logged</option><option value="watch">Watch</option>
        </select>
        <select value=${flt.fam} onChange=${e => setFlt({ ...flt, fam: e.target.value })} aria-label="Filter by type">
          <option value="">All types</option>
          ${Object.entries(d.families).map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}
        </select>
        <div className="push"><button type="button" className="btn ghost sm" onClick=${() => saveDownload('waf-log-' + dkey() + '.csv', toCSV([['Time', 'Ref', 'Action', 'Score', 'Types', 'Field', 'Sample', 'Route', 'Address', 'Who'], ...(d.events || []).map(x => [fmtTs(+x.at), x.ref, x.act, x.score, x.fam, x.field, x.sample, x.route, x.ip, x.who || ''])])).catch(() => {})}><${Icon} n="down" />CSV</button></div>
      </div>
      <div className="tblwrap"><table className="tbl"><thead><tr><th>When</th><th>Action</th><th className="r">Score</th><th>Signatures & sample</th><th>Where</th><th>Address</th><th></th></tr></thead><tbody>
        ${(d.events || []).map(x => html`<tr key=${x.id}>
          <td className="small nowrap">${fmtTs(+x.at)}<div className="muted" style=${{ fontSize: 10 }}>${x.ref}</div></td>
          <td><${Chip} s=${WAF_ACT_TONE[x.act] || ''}>${WAF_ACT_LABEL[x.act] || x.act}<//></td>
          <td className="r">${x.score}</td>
          <td className="small"><b>${x.rules}</b>${x.who ? html` <span className="muted">· ${x.who}</span>` : ''}${x.sample ? html`<div className="muted" style=${{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>${x.field ? x.field + ': ' : ''}${x.sample}</div>` : ''}</td>
          <td className="small muted">${x.route}<div>${x.method}</div></td>
          <td><code className="small">${x.ip}</code></td>
          <td className="r nowrap">
            <button className="btn ghost sm" onClick=${() => setLook(x.ip)}>Look</button>
            ${x.ip && x.ip !== d.you && html`<button className="btn danger sm" onClick=${() => block(x.ip, 1440, 'From the firewall log: ' + x.fam)}>Block</button>`}
            ${(x.act === 'log' || x.act === 'watch') && x.rules && !x.rules.includes(',') && html`<button className="btn ghost sm" title="Stop this signature counting on this route (a false alarm)" onClick=${() => confirm('Stop "' + x.rules + '" counting on ' + x.route + '? Use this only for a genuine false alarm.') && run('allow', 'waf_allow', { rule: x.rules, route: x.route }, 'Exception added.')}>Allow</button>`}
          </td>
        </tr>`)}
        ${!(d.events || []).length && html`<tr><td colSpan="7" className="muted small">No events${flt.act || flt.fam ? ' of this kind' : ''} in this window.</td></tr>`}
      </tbody></table></div>
      ${(f.skip && f.skip.length) ? html`<div><b className="small">Exceptions (signatures you told the firewall to ignore)</b><div className="chips">${f.skip.map(s => html`<span key=${s} className="chip">${s}<button type="button" className="chip-x" aria-label="Remove" onClick=${() => run('unallow', 'waf_unallow', { k: s }, 'Exception removed.')}>×</button></span>`)}</div></div>` : ''}
    </section>
    <div className="g2" style=${{ alignItems: 'start' }}>
      <section className="panel stack">
        <h2 className="ph">Settings</h2>
        <label className="kcheck"><input type="checkbox" checked=${!!f.on} onChange=${e => setF({ ...f, on: e.target.checked })} /><span>Web application firewall on</span></label>
        <${Field} label="How strict">
          <select value=${f.mode} onChange=${e => setF({ ...f, mode: e.target.value })}>
            <option value="balanced">Balanced — refuse clear attacks, log the rest</option>
            <option value="strict">Strict — refuse anything suspicious</option>
            <option value="watch">Watch only — log, refuse nothing</option>
          </select>
        <//>
        <div><b className="small">What it looks for</b><div className="checks" style=${{ marginTop: 6 }}>
          ${Object.entries(d.families).map(([k, n]) => html`<label key=${k} className="kcheck"><input type="checkbox" checked=${!!(f.fam && f.fam[k])} onChange=${e => setF({ ...f, fam: { ...f.fam, [k]: e.target.checked } })} /><span>${n}</span></label>`)}
        </div></div>
        <div className="checks">
          <label className="kcheck"><input type="checkbox" checked=${!!f.traps} onChange=${e => setF({ ...f, traps: e.target.checked })} /><span>Ban scanners that probe decoy addresses (wp-admin, .env…)</span></label>
          <label className="kcheck"><input type="checkbox" checked=${!!f.behavior} onChange=${e => setF({ ...f, behavior: e.target.checked })} /><span>Behavioral layer: catch scans spread across the site and credential stuffing (patterns no single request shows)</span></label>
          <label className="kcheck"><input type="checkbox" checked=${!!f.geo} onChange=${e => setF({ ...f, geo: e.target.checked })} /><span>Refuse the countries listed under Firewall settings${d.countries ? '' : ' (none listed yet)'}</span></label>
          <label className="kcheck"><input type="checkbox" checked=${!!f.staffAlert} onChange=${e => setF({ ...f, staffAlert: e.target.checked })} /><span>Email the security contacts when a signed-in account sends attack-like requests</span></label>
        </div>
        <div className="row2">
          <${Field} label="Ban an address at this score" hint="Points add up and fade over time."><input type="number" min="8" value=${f.banAt} onInput=${num('banAt')} /><//>
          <${Field} label="Points fade by half after (hours)"><input type="number" min="1" value=${f.halfLife} onInput=${num('halfLife')} /><//>
        </div>
        ${f.behavior && html`<div className="row3" style=${{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8 }}>
          <${Field} label="Scan window (minutes)" hint="How far back refused requests are counted."><input type="number" min="1" value=${f.probeWindow} onInput=${num('probeWindow')} /><//>
          <${Field} label="Refused requests before a scan is flagged"><input type="number" min="4" value=${f.probeMax} onInput=${num('probeMax')} /><//>
          <${Field} label="Wrong sign-ins before stuffing is flagged" hint="From one address in 15 minutes."><input type="number" min="3" value=${f.stuffMax} onInput=${num('stuffMax')} /><//>
        </div>`}
        <div><button type="button" className="btn" disabled=${busy === 'save'} onClick=${() => save()}>${busy === 'save' ? 'Saving…' : 'Save firewall settings'}</button></div>
      </section>
      <section className="panel stack">
        <h2 className="ph">Test a request</h2>
        <p className="muted small">Paste anything (a URL, a form value, a snippet) to see what the firewall makes of it. Nothing is logged or blocked.</p>
        <textarea rows="4" value=${tst} onInput=${e => setTst(e.target.value)} placeholder="e.g. ' OR 1=1--   or   <script>alert(1)</script>" />
        <div className="actions">
          <button type="button" className="btn ghost" disabled=${!tst.trim()} onClick=${async () => setTres(await api('waf_test', { text: tst }).catch(e => ({ err: errText(e) })))}>Check it</button>
          ${tres && (tres.err ? html`<span className="err">${tres.err}</span>` : html`<span className=${tres.score >= 10 ? 'err' : tres.score > 0 ? 'okmsg' : 'muted'}>Score ${tres.score} · a visitor would be <b>${tres.visitor}</b>, a signed-in person <b>${tres.member}</b>.</span>`)}
        </div>
        ${tres && !tres.err && tres.hits && tres.hits.length > 0 && html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Signature</th><th>Type</th><th className="r">Points</th></tr></thead><tbody>${tres.hits.map(h => html`<tr key=${h.id}><td className="small">${h.n}${h.skipped ? ' (exception)' : ''}</td><td className="small muted">${famLabel(h.fam)}</td><td className="r">${h.skipped ? 0 : h.pts}</td></tr>`)}</tbody></table></div>`}
      </section>
    </div>
    ${look && html`<${WafAddress} ip=${look} onClose=${() => setLook('')} onBlock=${ip => block(ip, 1440, 'Blocked from the firewall')} />`}
  </div>`;
}
