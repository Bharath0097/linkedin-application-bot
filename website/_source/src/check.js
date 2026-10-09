/* ================= Email checker, bounces, and the System health page ================= */
const CHECK_ST = { good: ['ok', 'Good to go'], risky: ['warn', 'Risky'], bad: ['', 'Do not send'] };
/* Paste addresses, see which are safe to send to. onUse hands the good ones back (used by compose). */
function EmailChecker({ initial, initialLabel, autoRun = false, onUse, compact, session, onSaved }) {
  const toast = useToast();
  const [txt, setTxt] = useState(initial || (session ? session.rows.map(r => r.e).join('\n') : ''));
  const [label, setLabel] = useState(session ? session.session.label || '' : (initialLabel || ''));
  const [res, setRes] = useState(session ? { rows: session.rows, summary: { good: session.session.good, risky: session.session.risky, bad: session.session.bad }, duplicates: 0, capped: false, id: session.session.id, at: session.session.at, by: session.session.by_name } : null);
  const [busy, setBusy] = useState(false);
  const [only, setOnly] = useState('');
  const run = async () => {
    if (!txt.trim()) return;
    setBusy(true);
    try {
      const r = await api('mail_check', { emails: txt, label: label.trim(), save: !compact });
      setRes({ ...r, at: Date.now() });
      if (r.id && onSaved) onSaved(r.id);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const autoDone = useRef(false);
  useEffect(() => {
    if (!autoRun || autoDone.current || !String(initial || '').trim()) return;
    autoDone.current = true;
    const t = setTimeout(() => run(), 0);
    return () => clearTimeout(t);
  }, []);
  const rows = res ? res.rows.filter(r => !only || r.st === only) : [];
  const good = res ? res.rows.filter(r => r.st === 'good').map(r => r.e) : [];
  const copy = list =>
    navigator.clipboard
      ? navigator.clipboard.writeText(list.join(', ')).then(
          () => toast(`${list.length} addresses copied.`),
          () => toast('Select the addresses and copy them.', true)
        )
      : toast('Select the addresses and copy them.', true);
  const csv = () =>
    saveDownload(
      `email-check-${dkey()}.csv`,
      toCSV([['Email', 'Result', 'Reasons', 'Suggested fix'], ...res.rows.map(r => [r.e, CHECK_ST[r.st][1], r.why.join('; '), r.fix])])
    ).catch(() => {});
  return html`<div className="stack">
      ${
        !compact &&
        html`<p className="muted small" style=${{ margin: 0 }}>Paste any list: one per line, or comma separated. Each address is checked for format, typos, throwaway services, whether its domain has a mail server, role addresses (info@, sales@), and whether it bounced, complained or unsubscribed in the past. "Good to go" means nothing stood out.</p>`
      }
      <textarea rows=${compact ? 3 : 7} value=${txt} onInput=${e => setTxt(e.target.value)} placeholder="name@company.com, another@company.com" />
      ${!compact && html`<input value=${label} onInput=${e => setLabel(e.target.value)} placeholder="Name this check (optional), e.g. October hotlist vendors" style=${{ maxWidth: 420 }} aria-label="Check name" />`}
      <div className="actions">
        <button type="button" className="btn" disabled=${busy || !txt.trim()} onClick=${run}><${Icon} n="check" />${busy ? 'Checking…' : res && res.id ? 'Check again' : 'Check addresses'}</button>
        ${res && good.length > 0 && html`<button type="button" className="btn ghost" onClick=${() => copy(good)}>Copy the ${good.length} good</button>`}
        ${res && onUse && html`<button type="button" className="btn go" disabled=${!good.length} onClick=${() => onUse(good)}>Keep only the good ones</button>`}
        ${res && !compact && html`<button type="button" className="btn ghost" onClick=${csv}><${Icon} n="down" />CSV</button>`}
      </div>
      ${
        res &&
        html`<${KitStats} items=${[
            { v: res.summary.good, l: 'Good to go', tone: 'ok', onClick: () => setOnly(only === 'good' ? '' : 'good') },
            { v: res.summary.risky, l: 'Risky (role or earlier failure)', tone: 'warn', onClick: () => setOnly(only === 'risky' ? '' : 'risky') },
            { v: res.summary.bad, l: 'Do not send', onClick: () => setOnly(only === 'bad' ? '' : 'bad') },
            { v: res.duplicates, l: 'Duplicates removed' },
          ]} />
          ${res.capped && html`<p className="note amber small"><span>Only the first 300 addresses were checked. Paste the rest separately.</span></p>`}
          ${!compact && res.id && html`<p className="muted small" style=${{ margin: 0 }}>This check is saved under History${res.by ? ' (' + res.by + ', ' + fmtTs(res.at) + ')' : ''}; every address also remembers this result, so the next check and the compose page show when it was last checked and what came of it.</p>`}
          <section className="panel" style=${{ padding: '6px 8px' }}>
            <div className="tblwrap">
              <table className="tbl">
                <thead><tr><th>Email</th><th>Result</th><th>Why</th>${!compact && html`<th>Before this check</th>`}</tr></thead>
                <tbody>
                  ${rows.map(
                    r => html`<tr key=${r.e}>
                        <td><code>${r.e}</code>${r.fix && html`<div className="small">Did you mean <b>${r.fix}</b>?</div>`}</td>
                        <td><${Chip} s=${CHECK_ST[r.st][0]}>${CHECK_ST[r.st][1]}<//></td>
                        <td className="small">${r.why.join(' · ') || html`<span className="muted">Nothing stood out</span>`}</td>
                        ${!compact && html`<td className="small">${r.bounced ? html`<span className="err">Bounced ${fmtDay(r.bounced.at)}${r.bounced.src ? ' (' + r.bounced.src + ')' : ''}</span>` : r.last ? html`${CHECK_ST[r.last.st] ? CHECK_ST[r.last.st][1] : r.last.st} on ${fmtDay(r.last.at)}${r.last.by ? ' by ' + r.last.by : ''}` : html`<span className="muted">First time checked</span>`}</td>`}
                      </tr>`
                  )}
                  ${!rows.length && html`<tr><td colSpan="4" className="muted small">Nothing in this group.</td></tr>`}
                </tbody>
              </table>
            </div>
          </section>`
      }
    </div>`;
}
function BouncesPanel({ sync, recent, onSynced }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const load = () =>
    api('mail_bounces')
      .then(setD)
      .catch(e => toast(errText(e), true));
  useEffect(() => {
    load();
  }, []);
  const syncNow = async () => {
    setSyncing(true);
    try {
      const r = await api('mail_bounce_sync', { force: true });
      toast(r.msg, !!/could not|answered|not available/i.test(r.msg));
      load();
      onSynced && onSynced();
    } catch (e) {
      toast(errText(e), true);
    }
    setSyncing(false);
  };
  const cleanContacts = async () => {
    setCleaning(true);
    try {
      const p = await api('mail_contacts_cleanup', { apply: false });
      if (!p.n) {
        toast('The contact list is already refined: no confirmed bad addresses or duplicate contacts remain.');
        setCleaning(false);
        return;
      }
      const badBits = [p.counts && p.counts.bounced && `${p.counts.bounced} bounced`, p.counts && p.counts.rejected && `${p.counts.rejected} rejected`, p.counts && p.counts.complained && `${p.counts.complained} spam complaint${p.counts.complained === 1 ? '' : 's'}`].filter(Boolean);
      const bits = [...badBits, p.duplicates && `${p.duplicates} duplicate row${p.duplicates === 1 ? '' : 's'} in ${p.duplicateGroups} mailbox${p.duplicateGroups === 1 ? '' : 'es'}`].filter(Boolean).join(', ');
      if (!confirm(`Refine ${p.n} contact row${p.n === 1 ? '' : 's'} (${bits})?\n\nConfirmed hard bounces/permanent rejects leave the active Contacts list but stay suppressed. Duplicate contacts are merged by normalized email; useful fields, tags and notes are kept. Unsubscribes, manual suppressions and temporary failures are not deleted.`)) {
        setCleaning(false);
        return;
      }
      const r = await api('mail_contacts_cleanup', { apply: true });
      toast(`Contacts refined: ${r.removedBad || 0} bad address${(r.removedBad || 0) === 1 ? '' : 'es'} removed and ${r.mergedDuplicates || 0} duplicate row${(r.mergedDuplicates || 0) === 1 ? '' : 's'} merged.`);
      load();
      onSynced && onSynced();
    } catch (e) {
      toast(errText(e), true);
    }
    setCleaning(false);
  };
  if (!d) return html`<${Spinner} />`;
  return html`<div className="stack">
      <section className="panel stack">
        <div className="ph-row">
          <h2 className="ph">Bounces brought in from your email service</h2>
          <div className="actions">
            <button type="button" className="btn ghost sm" disabled=${syncing || cleaning} onClick=${syncNow}><${Icon} n="refresh" />${syncing ? 'Syncing…' : 'Sync now'}</button>
            <button type="button" className="btn danger sm" disabled=${cleaning || syncing} onClick=${cleanContacts}>${cleaning ? 'Refining…' : 'Refine contacts'}</button>
          </div>
        </div>
        <p className="muted small">${sync && sync.at ? `Last sync ${fmtTs(sync.at)}: ${sync.msg || ''}` : 'Not synced yet.'} Bounces reach the site three ways: the Mailgun webhook the moment they happen, this sync (also every hour when the cron job is set up, and whenever this page opens after six hours), and delivery-failure messages that land in connected Gmail mailboxes. Each bounced address is remembered with the date and reason, skipped by mass email, and the person who sent to it sees "Bounced" on their message.</p>
        ${
          recent && recent.length > 0
            ? html`<div className="tblwrap">
                <table className="tbl">
                  <thead><tr><th>Email</th><th>Bounced</th><th>Why</th><th>Learned from</th><th>Who sent to it</th></tr></thead>
                  <tbody>
                    ${recent.slice(0, 50).map(r => html`<tr key=${r.email}><td><code>${r.email}</code></td><td className="small nowrap">${fmtTs(r.bounced_at)}</td><td className="small">${r.bounce_why || '—'}</td><td className="small">${r.bounce_src || '—'}</td><td className="small">${(r.senders || []).filter(Boolean).join(', ') || html`<span className="muted">—</span>`}</td></tr>`)}
                  </tbody>
                </table>
              </div>`
            : html`<p className="muted small">No bounces recorded yet.</p>`
        }
      </section>
      <section className="panel stack">
        <h2 className="ph">Addresses the site skips (${d.suppressed.length})</h2>
        <p className="muted small">Bounces, spam complaints and unsubscribes reported by your email service, plus addresses that failed repeatedly. Mass email skips them automatically. <b>Refine contacts</b> removes confirmed hard-bounce/permanent-reject contacts from the active list and merges duplicate contacts by normalized email. Useful fields, tags and notes are preserved; suppression/bounce history remains. Unsubscribes, manual suppressions and temporary failures stay in Contacts.</p>
        <div className="tblwrap">
          <table className="tbl">
            <thead><tr><th>Email</th><th>Why</th><th>Since</th><th></th></tr></thead>
            <tbody>
              ${d.suppressed.map(
                s => html`<tr key=${s.email}><td><code>${s.email}</code></td><td><${Chip} s="warn">${s.why}<//></td><td className="small">${fmtTs(+s.at)}</td>
                    <td className="r"><button type="button" className="btn ghost sm" onClick=${() => api('mail_unsuppress', { email: s.email }).then(load, e => toast(errText(e), true))}>Allow again</button></td></tr>`
              )}
              ${!d.suppressed.length && html`<tr><td colSpan="4" className="muted small">Nothing is being skipped.</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel stack">
        <h2 className="ph">Recent failed sends (${d.failed.length})</h2>
        <div className="tblwrap">
          <table className="tbl">
            <thead><tr><th>When</th><th>To</th><th>Subject</th><th>What happened</th></tr></thead>
            <tbody>
              ${d.failed.map(
                (f, i) => html`<tr key=${i}><td className="small nowrap">${fmtTs(+f.at)}</td><td><code>${f.to_email}</code></td><td className="small">${f.subject}</td><td className="small"><${Chip}>${f.status}<//> ${f.err}</td></tr>`
              )}
              ${!d.failed.length && html`<tr><td colSpan="4" className="muted small">No failures recorded.</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
    </div>`;
}

/* The Check & bounces page: run a check, look back at earlier checks, see what bounced and what is known about any address. */
function CheckCenter({ showCleanup = true, initial = '', initialLabel = '', autoRun = false } = {}) {
  const toast = useToast();
  const [tab, setTab] = useState('check');
  const [d, setD] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [session, setSession] = useState(null);
  const [q, setQ] = useState('');
  const [known, setKnown] = useState(null);
  const load = () =>
    api('mail_check_sessions')
      .then(setD)
      .catch(e => toast(errText(e), true));
  useEffect(() => {
    load();
    // bounces older than six hours are brought in quietly when the page opens
    api('mail_bounce_sync', { force: false })
      .then(r => r.ran && load())
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!openId) {
      setSession(null);
      return;
    }
    api('mail_check_session', { id: openId })
      .then(setSession)
      .catch(e => toast(errText(e), true));
  }, [openId]);
  const lookup = () =>
    api('mail_addr_lookup', { q })
      .then(r => setKnown(r.rows))
      .catch(e => toast(errText(e), true));
  const del = async id => {
    if (!confirm('Delete this check from the history?')) return;
    try {
      await api('mail_check_delete', { id });
      if (openId === id) setOpenId(null);
      load();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const sessions = (d && d.sessions) || [];
  return html`<div className="stack">
      ${
        d &&
        html`<${KitStats} items=${[
            { v: sessions.length, l: 'Checks saved', onClick: () => setTab('history') },
            { v: d.known.n, l: 'Addresses remembered', onClick: () => setTab('known') },
            { v: d.known.good, l: 'Known good', tone: 'ok' },
            { v: d.known.bounced, l: 'Bounced', tone: d.known.bounced ? 'warn' : '', onClick: () => setTab('bounces') },
          ]} />`
      }
      <${KitTabs} tab=${tab} onTab=${setTab} tabs=${[
        ['check', 'Validate addresses'],
        ['history', 'History', sessions.length],
        ['known', 'Known addresses'],
        ...(showCleanup ? [['bounces', 'Bounces & skips', d && d.known.bounced]] : []),
      ]} />
      ${tab === 'check' && html`<section className="panel stack"><h2 className="ph">Email validation</h2><p className="muted small" style=${{ marginTop: 0 }}>Validate addresses before sending. When contacts are selected from Contacts, their addresses are brought here and checked automatically.</p><${EmailChecker} initial=${initial} initialLabel=${initialLabel} autoRun=${autoRun} onSaved=${load} /></section>`}
      ${
        tab === 'history' &&
        html`<div className="stack">
            ${
              session
                ? html`<section className="panel stack">
                    <div className="ph-row">
                      <h2 className="ph">${session.session.label || 'Check'} · ${fmtTs(session.session.at)} · ${session.session.by_name}</h2>
                      <div className="actions"><button type="button" className="btn ghost sm" onClick=${() => setOpenId(null)}>Back to the list</button><button type="button" className="btn ghost sm" onClick=${() => del(session.session.id)}>Delete</button></div>
                    </div>
                    <p className="muted small">The results as they were then. "Check again" re-runs the same list now and saves a new entry, so you can compare.</p>
                    <${EmailChecker} key=${session.session.id} session=${session} onSaved=${id => {
                      load();
                      setOpenId(id);
                    }} />
                  </section>`
                : html`<section className="panel stack">
                    <h2 className="ph">Earlier checks</h2>
                    <p className="muted small">Every check is kept with its results, who ran it and when. Open one to see it again, re-run it or download it.</p>
                    ${
                      sessions.length
                        ? html`<div className="tblwrap">
                            <table className="tbl">
                              <thead><tr><th>When</th><th>Name</th><th>By</th><th className="r">Checked</th><th className="r">Good</th><th className="r">Risky</th><th className="r">Do not send</th><th /></tr></thead>
                              <tbody>
                                ${sessions.map(
                                  x => html`<tr key=${x.id} className="click" tabIndex="0" onClick=${() => setOpenId(x.id)}>
                                      <td className="small nowrap">${fmtTs(x.at)}</td>
                                      <td>${x.label || html`<span className="muted">Untitled</span>`}</td>
                                      <td className="small">${x.by_name}</td>
                                      <td className="r num">${x.n}</td>
                                      <td className="r num">${x.good}</td>
                                      <td className="r num">${x.risky}</td>
                                      <td className="r num">${x.bad}</td>
                                      <td className="r"><button type="button" className="btn ghost sm" onClick=${e => {
                                        e.stopPropagation();
                                        setOpenId(x.id);
                                      }}>Open</button></td>
                                    </tr>`
                                )}
                              </tbody>
                            </table>
                          </div>`
                        : html`<p className="muted small">No checks saved yet. Run one under Check addresses; it is kept here automatically.</p>`
                    }
                  </section>`
            }
          </div>`
      }
      ${showCleanup && tab === 'bounces' && html`<${BouncesPanel} sync=${d && d.sync} recent=${d && d.recent} onSynced=${load} />`}
      ${
        tab === 'known' &&
        html`<section className="panel stack">
            <h2 className="ph">What is known about an address</h2>
            <p className="muted small">Every address that was ever checked or bounced is remembered: the last result, when, who checked it, and any bounce with its reason. Search by address or domain.</p>
            <div className="toolbar"><input type="search" placeholder="name@company.com or company.com" value=${q} onInput=${e => setQ(e.target.value)} onKeyDown=${e => e.key === 'Enter' && lookup()} style=${{ maxWidth: 360 }} /><button type="button" className="btn ghost" onClick=${lookup}>Search</button></div>
            ${
              known &&
              html`<div className="tblwrap">
                  <table className="tbl">
                    <thead><tr><th>Email</th><th>Last result</th><th>Checked</th><th>Bounced</th></tr></thead>
                    <tbody>
                      ${known.map(r => html`<tr key=${r.e}><td><code>${r.e}</code></td><td><${Chip} s=${(CHECK_ST[r.st] || ['', r.st])[0]}>${(CHECK_ST[r.st] || ['', r.st])[1]}<//><div className="muted small">${r.why}</div></td><td className="small">${r.at ? fmtTs(r.at) + (r.by ? ' by ' + r.by : '') + (r.checks > 1 ? ' · ' + r.checks + ' checks' : '') : html`<span className="muted">Never (learned from a bounce)</span>`}</td><td className="small">${r.bouncedAt ? html`<span className="err">${fmtTs(r.bouncedAt)}</span> ${r.bounceWhy}${r.bounceSrc ? ' (' + r.bounceSrc + ')' : ''}` : html`<span className="muted">—</span>`}</td></tr>`)}
                      ${!known.length && html`<tr><td colSpan="4" className="muted small">Nothing matches.</td></tr>`}
                    </tbody>
                  </table>
                </div>`
            }
          </section>`
      }
    </div>`;
}

/* Admin > System health: what the server is doing, and what to ask the host to change. */
const fmtBytes = b => (b >= 1073741824 ? (b / 1073741824).toFixed(1) + ' GB' : b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : b >= 1024 ? Math.round(b / 1024) + ' KB' : (b || 0) + ' B');
/* ---- Speed check: where the time goes between clicking the site and seeing a page, with the fix for each cause ---- */
function SpeedCheck({ d }) {
  const [ping, setPing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [perf, setPerf] = useState(BOOT_PERF);
  const measure = async () => {
    setBusy(true);
    const times = [];
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      try {
        await api('me');
      } catch (e) {
        /* counted anyway */
      }
      times.push(Math.round(performance.now() - t0));
    }
    times.sort((a, b) => a - b);
    setPing({ med: times[1], min: times[0], max: times[2] });
    setPerf({ ...BOOT_PERF });
    setBusy(false);
  };
  useEffect(() => {
    measure();
  }, []);
  // the boot timings are captured shortly after the page's load event; wait for them when this panel mounts first
  useEffect(() => {
    if (perf.nav) return;
    let n = 0;
    const t = setInterval(() => {
      if (BOOT_PERF.nav || ++n > 12) {
        clearInterval(t);
        setPerf({ ...BOOT_PERF });
      }
    }, 500);
    return () => clearInterval(t);
  }, [perf.nav]);
  const res = perf.res || [];
  const find = re => res.find(r => re.test(r.n));
  const app = find(/^app\.js$/);
  const css = find(/^styles\.css$/);
  const big = res.filter(r => r.dec > 20000 || r.enc > 20000);
  const wire = res.reduce((s, r) => s + (r.tr || r.enc || 0), 0);
  const cached = app && app.tr === 0 && app.dec > 0;
  const compressed = r => r && r.dec > 0 && r.enc > 0 && r.enc < r.dec * 0.9;
  const unknownEnc = r => !r || r.dec === 0; // cross-origin or an old browser: sizes hidden
  const kbps = app && app.ms > 0 && app.enc > 0 ? Math.round(((app.enc * 8) / app.ms) * 1000 / 1000) : null; // kbit/s
  const nav = perf.nav || {};
  const items = [];
  const tips = [];
  if (nav.ttfb != null) {
    items.push({ v: nav.ttfb + ' ms', l: 'Server: first byte of the page', tone: nav.ttfb > 800 ? 'warn' : 'ok' });
    if (nav.ttfb > 800) tips.push(['warn', `The server took ${nav.ttfb} ms to start answering for the page itself (a static file). That is hosting speed, not the site: a shared server under load. Ask the host about LiteSpeed or PHP-FPM, or a faster plan; nothing in this site can shorten it.`]);
  }
  if (app) {
    items.push({ v: cached ? 'cached' : fmtBytes(app.enc || app.dec), l: 'Main script on the wire' + (cached ? ' (browser cache; reload with Shift held to time a fresh download)' : compressed(app) ? ' (compressed)' : unknownEnc(app) ? '' : ' (NOT compressed)'), tone: cached || compressed(app) || unknownEnc(app) ? 'ok' : 'warn' });
    items.push({ v: app.ms + ' ms', l: 'Main script download time', tone: app.ms > 2500 ? 'warn' : 'ok' });
    if (!cached && !compressed(app) && !unknownEnc(app)) tips.push(['warn', `Scripts travel uncompressed (app.js ${fmtBytes(app.dec)} on the wire instead of about ${fmtBytes(Math.round(app.dec * 0.28))}). Ask the host to switch on compression for .js and .css files (mod_deflate or mod_brotli on Apache; LiteSpeed has it under Server Configuration > Tuning > GZIP/Brotli compression).`]);
    if (!cached && kbps !== null && kbps < 3000) tips.push(['info', `This connection managed about ${(kbps / 1000).toFixed(1)} Mbit/s while downloading the script, so the first visit on it needs about ${Math.round(wire / 1024)} KB; after that the browser keeps the files (they are cached for a year by build) and only the data travels.`]);
  }
  if (ping) {
    items.push({ v: ping.med + ' ms', l: `Portal request round trip (3 tries: ${ping.min}–${ping.max} ms)`, tone: ping.med > 600 ? 'warn' : 'ok' });
    if (ping.med > 600) tips.push(['warn', `Each request to the server takes about ${ping.med} ms. The server-side part of this one was ${d.reqMs} ms, so ${d.reqMs < ping.med / 3 ? 'most of it is the network and the host answering slowly, not the site\'s own work' : 'PHP itself is slow here: switch OPcache on (see the checks) and ask the host about CPU limits on the account'}.`]);
  }
  if (d.reqMs != null) items.push({ v: d.reqMs + ' ms', l: 'Server work for the health request', tone: d.reqMs > 400 ? 'warn' : 'ok' });
  if (!d.opcache) tips.push(['warn', 'PHP OPcache is off, so PHP re-reads and compiles every script on every request. In cPanel open "Select PHP Version" (or "MultiPHP INI Editor") and switch opcache on; the portal answers noticeably faster.']);
  if (d.modules && !d.modules.headers) tips.push(['warn', 'Apache\'s mod_headers is not loaded, so the long browser caching of the scripts cannot be used. Ask the host to enable mod_headers (it is standard on cPanel hosts).']);
  if (nav.proto && /^http\/1/.test(nav.proto)) tips.push(['info', `The site is served over ${nav.proto.toUpperCase()}. HTTP/2 lets the browser fetch the scripts, styles and fonts in parallel; most hosts switch it on with the free SSL certificate (cPanel › SSL/TLS Status).`]);
  if (!tips.length) tips.push(['ok', 'Nothing is holding the site back on this server and connection. If a page still feels slow, note which one and what it was doing; the "Slow requests" list below records anything the server took more than 1.5 s on.']);
  return html`<section className="panel stack">
      <div className="ph-row" style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h2 className="ph">Speed check</h2>
        <div className="actions"><button type="button" className="btn ghost sm" disabled=${busy} onClick=${measure}><${Icon} n="refresh" />${busy ? 'Measuring…' : 'Measure again'}</button></div>
      </div>
      <p className="muted small" style=${{ margin: 0 }}>How this page reached this browser: the server's response time, how big the scripts were on the wire and whether they came compressed, and how long one portal request takes. Measured in this browser on this connection, so try it from the office and from a phone.</p>
      ${items.length ? html`<${KitStats} items=${items} />` : null}
      <ul className="small" style=${{ margin: 0, paddingLeft: 18 }}>
        ${tips.map(([tone, text], i) => html`<li key=${i} style=${{ marginBottom: 6 }}><${Chip} s=${tone === 'warn' ? 'warn' : tone === 'ok' ? 'ok' : 'new'}>${tone === 'warn' ? 'Fix' : tone === 'ok' ? 'Good' : 'Note'}<//> ${text}</li>`)}
      </ul>
      ${
        big.length
          ? html`<details>
              <summary className="muted small" style=${{ cursor: 'pointer' }}>Files this page loaded (${res.length}) · ${fmtBytes(wire)} on the wire</summary>
              <div className="tblwrap" style=${{ marginTop: 8 }}>
                <table className="tbl">
                  <thead><tr><th>File</th><th className="r">On the wire</th><th className="r">Unpacked</th><th className="r">Time</th><th>How</th></tr></thead>
                  <tbody>${big.map(r => html`<tr key=${r.n}><td><code>${r.n}</code></td><td className="r">${r.tr === 0 && r.dec > 0 ? '—' : fmtBytes(r.enc)}</td><td className="r">${fmtBytes(r.dec)}</td><td className="r">${r.ms} ms</td><td>${r.tr === 0 && r.dec > 0 ? html`<${Chip} s="ok">browser cache<//>` : compressed(r) ? html`<${Chip} s="ok">compressed<//>` : unknownEnc(r) ? html`<${Chip}>unknown<//>` : html`<${Chip} s="warn">not compressed<//>`}</td></tr>`)}</tbody>
                </table>
              </div>
            </details>`
          : null
      }
    </section>`;
}

function HealthPage() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [cleaning, setCleaning] = useState(false);
  const load = () =>
    api('health')
      .then(r => {
        setD(r);
        setErr(null);
      })
      .catch(setErr);
  useEffect(() => {
    load();
  }, []);
  // v83: declared before the early returns so a failed first load keeps the hook order (React #300)
  // what the server actually hands this browser for js/app.js (a cache or proxy between the two can differ from the file on disk)
  const [served, setServed] = useState(null);
  useEffect(() => {
    if (!d || !d.version) return;
    let live = true;
    const want = d.version.js || APP_BUILD;
    fetch('js/app.js?v=' + encodeURIComponent(want), { cache: 'reload', credentials: 'same-origin' })
      .then(async r => {
        const text = (await r.text()).slice(0, 400);
        const m = text.match(/APP_BUILD\s*=\s*['"]([^'"]+)['"]/);
        return { ok: r.ok, status: r.status, build: m ? m[1] : null, enc: r.headers.get('content-encoding') || '', readable: /use strict/.test(text) };
      })
      .catch(e => ({ ok: false, err: String((e && e.message) || e) }))
      .then(x => live && setServed(x));
    return () => {
      live = false;
    };
  }, [d && d.version && d.version.js]);
  if (err && !d) return html`<${LoadError} error=${err} onRetry=${load} />`;
  if (!d) return html`<${Spinner} label="Measuring the server…" onRetry=${load} />`;
  const bad = d.checks.filter(c => !c[1]);
  const V = d.version || { missing: [], changed: [] };
  const here = { v: typeof APP_VERSION === 'string' ? APP_VERSION : '', b: APP_BUILD };
  const up = [];
  if (served && served.err) up.push(`This browser could not download js/app.js from the server just now (${served.err}). When this happens on a fresh visit the site stays on "Loading…": the host is sending the script in a form the browser cannot decode (double compression) or blocking it. Check the server's compression settings and the .htaccess that came with this version.`);
  else if (served && served.ok && !served.readable) up.push('The server sends js/app.js in a form this browser cannot read (it is not plain JavaScript on arrival). A cache or compression setting on the host is altering the file; purge the host cache and check its compression settings.');
  else if (served && served.ok && served.build && V.js && served.build !== V.js) up.push(`The server (or a cache in front of it: LiteSpeed Cache, Cloudflare) is still handing out js/app.js from build ${served.build} although build ${V.js} is on disk. Purge the host or CDN cache, then reload with the Shift key held.`);
  if (V.js && V.html && V.js !== V.html) up.push(`index.html on the server is from build ${V.html} but js/app.js is from build ${V.js}: the last upload replaced one and not the other. Upload the whole folder again (everything except storage).`);
  if (V.manifest && V.manifest.build && V.js && V.manifest.build !== V.js) up.push(`js/app.js (build ${V.js}) does not belong to the rest of the files on the server (${V.manifest.version}, build ${V.manifest.build}). Upload the js folder again.`);
  if ((V.missing || []).length) up.push(`${V.missing.length} file${V.missing.length === 1 ? ' is' : 's are'} missing from the server: ${V.missing.slice(0, 10).join(', ')}${V.missing.length > 10 ? '…' : ''}. Upload them (the api folder most often).`);
  if ((V.changed || []).length) up.push(`${V.changed.length} file${V.changed.length === 1 ? ' differs' : 's differ'} from this version: ${V.changed.slice(0, 10).join(', ')}${V.changed.length > 10 ? '…' : ''}. Upload them again; a file that was cut short during an upload is the usual reason.`);
  if (V.js && here.b !== V.js) up.push(`This browser is running build ${here.b} but the server has ${V.js}. Reload the page with the Shift key held (or clear the browser cache) to get the new version.`);
  const leftovers = V.leftovers || [];
  const cleanup = async () => {
    setCleaning(true);
    try {
      const r = await api('admin_cleanup_gz', {});
      load();
      toast(r.removed.length ? `Removed ${r.removed.length} leftover file${r.removed.length === 1 ? '' : 's'}.` : 'Nothing to remove.');
    } catch (e) {
      toast(errText(e), true);
    }
    setCleaning(false);
  };
  return html`<div className="stack">
      <section className=${'panel stack verbox ' + (up.length ? 'bad' : 'good')}>
        <div className="ph-row" style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h2 className="ph">Version & upload</h2>
          ${up.length ? html`<${Chip} s="red">Needs attention<//>` : html`<${Chip} s="ok">Up to date and complete<//>`}
        </div>
        <div className="vergrid">
          <div><span className="muted small">On the server</span><b>${V.label || V.manifest && V.manifest.version || '—'} · build ${V.js || '—'}</b><span className="muted small">${V.manifest ? `${V.manifest.total} files checked` : 'no file list (older upload)'}${V.jsAt ? ` · js uploaded ${fmtTs(V.jsAt * 1000)}` : ''}</span></div>
          <div><span className="muted small">In this browser</span><b>${here.v} · build ${here.b}</b><span className="muted small">${here.b === V.js ? 'Same as the server' : 'Different from the server'}</span></div>
          <div><span className="muted small">Page shell (index.html)</span><b>build ${V.html || '—'}</b><span className="muted small">${V.htmlAt ? 'uploaded ' + fmtTs(V.htmlAt * 1000) : ''}</span></div>
          <div><span className="muted small">Served to this browser now</span><b>${served ? (served.err ? 'failed' : served.build ? 'build ' + served.build : served.ok ? 'unreadable' : 'HTTP ' + served.status) : 'checking…'}</b><span className="muted small">${served && served.ok && served.readable ? (served.enc ? 'compressed (' + served.enc + ')' : 'not compressed') + (served.build === V.js ? ' · matches the server' : '') : served && served.err ? 'could not be downloaded' : ''}</span></div>
        </div>
        ${leftovers.length ? html`<div className="note amber"><span><b>${leftovers.length} pre-compressed file${leftovers.length === 1 ? '' : 's'} from an older version</b> (${leftovers.slice(0, 4).join(', ')}${leftovers.length > 4 ? '…' : ''}) are still on the server. They are no longer used; LiteSpeed hosts used to compress them twice and break the site, so remove them.</span><div className="actions"><button type="button" className="btn sm" disabled=${cleaning} onClick=${cleanup}>${cleaning ? 'Removing…' : 'Remove them'}</button></div></div>` : null}
        ${up.length ? html`<ul className="small" style=${{ margin: 0, paddingLeft: 18 }}>${up.map((x, i) => html`<li key=${i}>${x}</li>`)}</ul>` : html`<p className="muted small" style=${{ margin: 0 }}>Every file of ${V.label || here.v} is on the server and this browser runs it. After each upload, come back here to confirm.</p>`}
      </section>
      <div className=${'note ' + (bad.length ? 'amber' : 'ok')}>
        <span><b>${bad.length ? `${bad.length} thing${bad.length === 1 ? '' : 's'} to look at.` : 'Everything checks out.'}</b> Measured ${fmtTs(Date.parse(d.time))} on ${d.server || 'the web server'}, PHP ${d.php}, build ${d.build}.</span>
        <div className="actions"><button type="button" className="btn ghost sm" onClick=${load}><${Icon} n="refresh" />Measure again</button></div>
      </div>
      <${SpeedCheck} d=${d} />
      <${KitStats} items=${[
        { v: d.listMs + ' ms', l: `Loading the ${d.people} team records`, tone: d.listMs > 1500 ? 'warn' : 'ok' },
        { v: d.countMs + ' ms', l: `Counting ${d.docs.toLocaleString()} records` },
        { v: d.driver === 'sqlite' ? fmtBytes(d.dbSize) : d.driver, l: d.driver === 'sqlite' ? 'Database size (SQLite, ' + (d.journal || '?') + ')' : 'Database engine' },
        { v: d.memory, l: `PHP memory limit (peak ${d.peak} MB this request)` },
        { v: d.execTime + ' s', l: 'PHP time limit per request' },
        { v: fmtBytes(d.disk), l: 'Free disk space' },
      ]} />
      <section className="panel stack">
        <h2 className="ph">Checks</h2>
        <div className="tblwrap">
          <table className="tbl">
            <tbody>
              ${d.checks.map(
                ([n, ok, hint]) => html`<tr key=${n}><td style=${{ width: 40 }}>${ok ? html`<${Chip} s="ok">OK<//>` : html`<${Chip} s="warn">Fix<//>`}</td><td><b>${n}</b>${!ok && html`<div className="muted small">${hint}</div>`}</td></tr>`
              )}
            </tbody>
          </table>
        </div>
      </section>
      <div className="g2" style=${{ alignItems: 'start' }}>
        <section className="panel stack">
          <h2 className="ph">What takes space</h2>
          <div className="tblwrap">
            <table className="tbl">
              <thead><tr><th>Area</th><th className="r">Records</th><th className="r">Size</th></tr></thead>
              <tbody>${d.cols.map(c => html`<tr key=${c.col}><td><code>${c.col}</code></td><td className="r">${(+c.n).toLocaleString()}</td><td className="r">${fmtBytes(+c.b)}</td></tr>`)}</tbody>
            </table>
          </div>
        </section>
        <section className="panel stack">
          <h2 className="ph">Largest records</h2>
          <p className="muted small">A record above a few hundred KB slows every page that reads it (for example a person with years of timesheets on one record).</p>
          <div className="tblwrap">
            <table className="tbl">
              <thead><tr><th>Record</th><th className="r">Size</th></tr></thead>
              <tbody>${d.big.map(c => html`<tr key=${c.path}><td><code>${c.path}</code></td><td className="r"><${Chip} s=${+c.b > 300000 ? 'warn' : ''}>${fmtBytes(+c.b)}<//></td></tr>`)}</tbody>
            </table>
          </div>
        </section>
      </div>
      ${[
        ['Slow requests (over 1.5 s)', d.slow, 'None recorded. Slow requests are written to storage/slow.log with the route, the person and the memory used.'],
        ['Recent errors', d.errors, 'No errors recorded in storage/error.log.'],
        ['Email log', d.mail, 'Nothing in storage/mail.log yet.'],
      ].map(
        ([title, lines, empty]) => html`<section key=${title} className="panel stack">
            <h2 className="ph">${title}</h2>
            ${lines.length ? html`<pre className="logbox">${lines.slice().reverse().join('\n')}</pre>` : html`<p className="muted small">${empty}</p>`}
          </section>`
      )}
    </div>`;
}


/* v55: separate mail work areas. */
function MailValidationPage() {
  const [picked] = useState(() => {
    try {
      const rows = JSON.parse(sessionStorage.getItem('se_mail_validate_selected') || 'null');
      sessionStorage.removeItem('se_mail_validate_selected');
      return Array.isArray(rows) ? rows.filter(x => x && x.email) : [];
    } catch (_) { return []; }
  });
  // v83: only the addresses go to mail_check; it splits on whitespace, so a 'Name <addr>' line made each name word a bad row and a known address
  const initial = picked.map(x => String(x.email).trim()).join('\n');
  return html`<div className="stack">
    <section className="panel"><div className="eyebrow">List quality</div><h2 className="ph">Email Validation</h2><p className="muted small">Validate addresses before sending. Validation history and known-address checks live here; bounce cleanup is intentionally separate.</p>${picked.length ? html`<div className="note info" style=${{ marginTop: 12 }}><span><b>${picked.length} selected contact${picked.length === 1 ? '' : 's'} loaded from Contacts.</b> Validation starts automatically.</span></div>` : ''}</section>
    <${CheckCenter} showCleanup=${false} initial=${initial} initialLabel=${picked.length ? 'Selected contacts' : ''} autoRun=${picked.length > 0} />
  </div>`;
}
function MailCleanupPage() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const load = () => api('mail_check_sessions').then(setD).catch(e => toast(errText(e), true));
  useEffect(() => { load(); }, []);
  return html`<div className="stack">
    <section className="panel"><div className="eyebrow">Contact maintenance</div><h2 className="ph">Bounces & Contact Cleanup</h2><p className="muted small">Sync bounces, remove confirmed permanent failures from the active address book, and merge duplicate contacts safely. No campaign or automation creation controls appear on this page.</p></section>
    <${BouncesPanel} sync=${d && d.sync} recent=${d && d.recent} onSynced=${load} />
  </div>`;
}
