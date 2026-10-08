/* ================= v34: Security center (Admin > Security center) =================
   Overview (the daily self-check and what needs attention), Sign-in rules, Monitoring (the self-check in full, file
   integrity, blocked scripts), Backups (recovery key, schedule, off-site copy, test restore, restore), Encryption (where
   the key lives, uploads encrypted at rest) and Activity (the sealed audit log). Server: api/monitor.php, api/backup.php,
   api/auth.php (sec_auth_*) and api/gov.php (gov_audit*). Administrators only. */
const TR_CHIP = { ok: 'ok', warn: 'amber', fail: 'red' };
const TR_WORD = { ok: 'OK', warn: 'Improve', fail: 'Fix now' };
const trChip = st => html`<${Chip} s=${TR_CHIP[st] || ''}>${TR_WORD[st] || st}<//>`;
const trBytes = n => (n >= 1073741824 ? (n / 1073741824).toFixed(1) + ' GB' : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round((n || 0) / 1024)) + ' KB');
const trJson = s => {
  try {
    const o = JSON.parse(s || '{}');
    return o && typeof o === 'object' ? o : {};
  } catch (e) {
    return {};
  }
};
/** A POST that answers with a file (a backup): fails like api() so the re-confirmation works the same way. */
async function apiBlob(route, body) {
  let res;
  try {
    res = await fetch(API + route, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  } catch (e) {
    throw { code: 'unavailable', message: 'The server could not be reached.' };
  }
  if (!res.ok) {
    let j = null;
    try {
      j = await res.json();
    } catch (e) {
      /* not JSON */
    }
    throw { ...(j || {}), code: (j && j.error) || 'unavailable', message: (j && j.message) || 'The download failed.' };
  }
  return res.blob();
}

function TrustPage({ q }) {
  const [tab, setTab] = useState((q && q.tab) || 'overview');
  const TABS = [
    ['overview', 'Overview'],
    ['signin', 'Sign-in rules'],
    ['protect', 'Protection'],
    ['monitor', 'Monitoring'],
    ['backups', 'Backups'],
    ['data', 'Encryption'],
    ['audit', 'Activity'],
  ];
  return html`<div className="stack">
      <${KitTabs} wrap tabs=${TABS} tab=${tab} onTab=${setTab} />
      ${
        tab === 'signin'
          ? html`<${TrustSignIn} />`
          : tab === 'protect'
            ? html`<${TrustProtect} />`
            : tab === 'monitor'
            ? html`<${TrustMonitor} />`
            : tab === 'backups'
              ? html`<${TrustBackups} />`
              : tab === 'data'
                ? html`<${TrustData} />`
                : tab === 'audit'
                  ? html`<${TrustAudit} />`
                  : html`<${TrustOverview} go=${setTab} />`
      }
    </div>`;
}

/* ---- one finding of the self-check ---- */
function TrCheck({ c }) {
  return html`<li className="trcheck">
      <div className="t">
        <span className="trhead">${trChip(c.st)}<b>${c.t}</b></span>
        ${c.d && html`<span className="muted small trdetail">${c.d}</span>`}
        ${c.fix && c.st !== 'ok' && html`<span className="small"><b>How to fix:</b> ${c.fix}</span>`}
      </div>
    </li>`;
}
function TrChecks({ checks, only }) {
  const list = only ? checks.filter(c => c.st !== 'ok').sort((a, b) => (a.st === 'fail' ? 0 : 1) - (b.st === 'fail' ? 0 : 1)) : checks;
  if (only) return html`<ul className="list trchecks">${list.map(c => html`<${TrCheck} key=${c.k} c=${c} />`)}</ul>`;
  const areas = [...new Set(checks.map(c => c.area))];
  return html`<div className="stack" style=${{ gap: 6 }}>
      ${areas.map(a => {
        const inA = checks.filter(c => c.area === a);
        const bad = inA.filter(c => c.st !== 'ok').length;
        return html`<details key=${a} className="trarea" open=${bad > 0}>
            <summary><b>${a}</b> <span className="muted small">${inA.length} checks${bad ? ', ' + bad + ' to look at' : ', all OK'}</span></summary>
            <ul className="list trchecks">${inA.map(c => html`<${TrCheck} key=${c.k} c=${c} />`)}</ul>
          </details>`;
      })}
    </div>`;
}
function useTrScan(onDone) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const scan = async where => {
    setBusy(true);
    try {
      const r = await api('trust_scan', { where }, { timeout: 120000 });
      toast('Self-check finished: ' + r.sum.fail + ' to fix, ' + r.sum.warn + ' to improve.');
      if (onDone) await onDone(r);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return [scan, busy];
}

/* ---- Overview ---- */
function TrustOverview({ go }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const load = () => api('trust_overview').then(setD, setErr);
  const [scan, scanning] = useTrScan(load);
  useEffect(() => {
    load();
  }, []);
  if (err && !d) return html`<${LoadError} error=${err} onRetry=${load} />`;
  if (!d) return html`<${Spinner} label="Loading the Security center…" />`;
  const s = d.scan;
  const bk = d.backup || {};
  const iv = d.integrity;
  const ivBad = iv ? iv.changed.length + iv.missing.length + iv.unexpected.length : 0;
  const a7 = d.auth7 || {};
  const head = !s ? 'Run the first self-check' : s.sum.fail ? s.sum.fail + ' to fix now' + (s.sum.warn ? ', ' + s.sum.warn + ' to improve' : '') : s.sum.warn ? s.sum.warn + ' things to improve' : 'Everything checked is in order';
  return html`<div className="stack">
      <section className="panel trscore">
        <div className=${'trring ' + (!s ? '' : s.sum.fail ? 'bad' : s.sum.warn ? 'mid' : 'good')} style=${{ '--p': s ? s.score : 0 }}><b>${s ? s.score + '%' : '—'}</b><span>score</span></div>
        <div className="stack" style=${{ gap: 8, minWidth: 0 }}>
          <h2 className="ph" style=${{ margin: 0 }}>${head}</h2>
          <p className="muted small" style=${{ margin: 0 }}>${s ? 'Last checked ' + fmtTs(s.at) + ' (' + s.base + '). ' : ''}The check runs every day on its own and emails the security contacts when something changes. ${d.daily ? 'Last daily run ' + fmtTs(d.daily) + '.' : 'The daily run has not happened yet: check the cron job under System health.'}</p>
          <div className="actions">
            <button className="btn sm" disabled=${scanning} onClick=${() => scan('here')}>${scanning ? 'Checking…' : 'Run the self-check now'}</button>
            ${d.origin.replace(/\/$/, '') !== d.site.replace(/\/$/, '') && html`<button className="btn ghost sm" disabled=${scanning} onClick=${() => scan('site')} title=${d.site}>Check the public address</button>`}
            <button className="btn ghost sm" onClick=${() => go('monitor')}>All checks</button>
          </div>
        </div>
      </section>
      <${KitStats} items=${[
        { v: bk.ok ? fmtTs(bk.ok.at) : 'Never', l: 'Last good backup', tone: bk.ok && bk.ok.at > Date.now() - 48 * 3600000 ? 'ok' : 'warn', onClick: () => go('backups') },
        { v: iv ? (iv.ok ? 'Unchanged' : ivBad + ' files') : 'Not checked', l: 'Program files', tone: iv && iv.ok ? 'ok' : 'warn', onClick: () => go('monitor') },
        { v: d.files ? (d.files.plain ? d.files.plain + ' to go' : 'All ' + d.files.total) : '—', l: 'Uploads encrypted', tone: d.files && !d.files.plain ? 'ok' : 'warn', onClick: () => go('data') },
        { v: d.sessionsNow, l: 'People signed in (last hour)' },
        { v: a7['Failed sign-in'] || 0, l: 'Failed sign-ins (7 days)', tone: (a7['Failed sign-in'] || 0) > 50 ? 'warn' : '', onClick: () => go('audit') },
        { v: d.csp7, l: 'Blocked scripts (7 days)', tone: d.csp7 > 0 ? 'warn' : '', onClick: () => go('monitor') },
      ]} />
      ${s && s.checks.some(c => c.st !== 'ok') && html`<section className="panel stack" style=${{ gap: 6 }}><h2 className="ph" style=${{ margin: 0 }}>What needs attention</h2><${TrChecks} checks=${s.checks} only=${true} /></section>`}
      <div className="g2" style=${{ alignItems: 'start' }}>
        <section className="panel stack" style=${{ gap: 8 }}>
          <h2 className="ph" style=${{ margin: 0 }}>Sign-ins in the last 7 days</h2>
          <dl className="kv">
            ${[
              ['Signed in', 'Successful sign-ins'],
              ['Failed sign-in', 'Wrong passwords'],
              ['Wrong second-step code', 'Wrong second-step codes'],
              ['Account locked', 'Accounts locked'],
              ['Backup code used', 'Backup codes used'],
              ['Password reset requested', 'Password resets asked for'],
              ['Password found in breach lists', 'Breached passwords found'],
            ].map(([k, n]) => html`<${Fragment} key=${k}><dt>${n}</dt><dd>${a7[k] || 0}</dd><//>`)}
          </dl>
          <div><button className="btn ghost sm" onClick=${() => go('audit')}>Open the activity log</button></div>
        </section>
        <section className="panel stack" style=${{ gap: 8 }}>
          <h2 className="ph" style=${{ margin: 0 }}>Recent security alerts</h2>
          ${
            d.alerts.length
              ? html`<ul className="list seclist">${d.alerts.map(x => html`<li key=${x.seq}><div className="t"><span>${x.act}</span><span className="muted small">${fmtTs(+x.at)}</span>${trJson(x.detail).text && html`<span className="small trwrap">${String(trJson(x.detail).text).slice(0, 300)}</span>`}</div></li>`)}</ul>`
              : html`<p className="muted small" style=${{ margin: 0 }}>No alerts yet. New-device and unusual sign-ins, lockouts, file changes and new reports appear here and are emailed to the security contacts.</p>`
          }
        </section>
      </div>
    </div>`;
}

/* ---- Sign-in rules ---- */
function TrustSignIn() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const [run, reauthModal] = useReauth();
  const load = () =>
    api('sec_auth_get').then(
      r => {
        setD(r);
        setF({ ...r.cfg });
      },
      e => toast(errText(e), true)
    );
  useEffect(() => {
    load();
  }, []);
  if (!d || !f) return html`<${Spinner} />`;
  const chk = k => e => setF({ ...f, [k]: e.target.checked });
  const num = k => e => setF({ ...f, [k]: e.target.value === '' ? '' : +e.target.value });
  const roleOn = r => (f.mfaRoles || []).includes(r);
  const toggleRole = r => setF({ ...f, mfaRoles: roleOn(r) ? f.mfaRoles.filter(x => x !== r) : [...(f.mfaRoles || []), r] });
  const alertOn = id => (f.alertUids || []).includes(id);
  const toggleAlert = id => setF({ ...f, alertUids: alertOn(id) ? f.alertUids.filter(x => x !== id) : [...(f.alertUids || []), id] });
  const save = async extra => {
    setBusy(true);
    try {
      const r = await run(() => api('sec_auth_save', { cfg: { ...f, ...(extra || {}) } }));
      setF({ ...r.cfg });
      toast('Sign-in rules saved.');
      load();
    } catch (x) {
      if (!x || x.code !== 'cancelled') toast(errText(x), true);
    }
    setBusy(false);
  };
  const enforced = Date.now() >= d.due;
  const NAMES = { totp: 'App', passkey: 'Passkey', email: 'Email', backup: 'Codes' };
  const admins = d.people.filter(p => p.roles.includes('admin'));
  return html`<div className="stack">
      ${reauthModal}
      <section className="panel stack form" style=${{ gap: 12 }}>
        <div className="ph-row" style=${{ margin: 0 }}><h2 className="ph">Two-step sign-in</h2><${Chip} s=${d.have === d.need ? 'ok' : enforced ? 'red' : 'amber'}>${d.have} of ${d.need} set up<//></div>
        <p className=${'note ' + (enforced ? (d.have === d.need ? 'ok' : 'red') : 'amber')} style=${{ margin: 0 }}><span>${enforced ? 'Required now: people in these roles without a second step must set one up when they sign in.' : 'Required from ' + fmtDay(d.due) + '. Until then people are reminded in their portal; after it, they must set it up at sign-in.'}</span></p>
        <div className="checks">
          ${[
            ['admin', 'Administrators'],
            ['hr', 'HR'],
            ['acct', 'Accounting'],
            ['manager', 'Managers'],
          ].map(([r, n]) => html`<label key=${r} className="check"><input type="checkbox" checked=${roleOn(r)} onChange=${() => toggleRole(r)} /><span>${n}</span></label>`)}
          <label className="check"><input type="checkbox" checked=${!!f.mfaStaff} onChange=${chk('mfaStaff')} /><span>Also every employee, recruiter and manager</span></label>
        </div>
        <div className="row2">
          <${Field} label="Grace period (days)" hint="How long people have to set it up after the rule starts."><input type="number" min="0" max="90" value=${f.graceDays} onInput=${num('graceDays')} /><//>
          <${Field} label="Remember a device for (days)" hint="0 asks every time. Signing out everywhere forgets every device."><input type="number" min="0" max="90" value=${f.remember} onInput=${num('remember')} /><//>
        </div>
        <label className="check"><input type="checkbox" checked=${!!f.rememberStaff} onChange=${chk('rememberStaff')} /><span>Staff (admin, HR, accounting, managers) may also skip it on a remembered device</span></label>
        <div className="checks">
          <label className="check"><input type="checkbox" checked=${!!f.passkey} onChange=${chk('passkey')} /><span><b>Passkeys</b>: Face ID, fingerprint, Windows Hello, security keys. Phishing-proof; also sign in without a password.${d.rp ? ' Tied to ' + d.rp + '.' : ' Need the site’s name in the address bar.'}</span></label>
          <label className="check"><input type="checkbox" checked=${!!f.totp} onChange=${chk('totp')} /><span><b>Authenticator apps</b>: Google or Microsoft Authenticator, Authy, 1Password.</span></label>
        </div>
        <${Field} label="Email codes" hint="Weaker than the two above (an email account can be taken over), so they are best kept away from staff.">
          <select value=${f.email} onChange=${e => setF({ ...f, email: e.target.value })}>
            <option value="members">Consultants, students and clients only</option>
            <option value="everyone">Everyone</option>
            <option value="off">Off</option>
          </select>
        <//>
        <div className="actions"><button className="btn ghost sm" disabled=${busy} onClick=${() => window.confirm('Start the grace period again from today? Everyone who still needs it gets the full grace period.') && save({ restartGrace: true })}>Restart the grace period from today</button></div>
      </section>
      <div className="g2" style=${{ alignItems: 'start' }}>
        <section className="panel stack form" style=${{ gap: 12 }}>
          <h2 className="ph" style=${{ margin: 0 }}>Passwords</h2>
          <div className="row2">
            <${Field} label="Shortest password used alone" hint="NIST SP 800-63B: at least 15."><input type="number" min="8" max="64" value=${f.pwMinSolo} onInput=${num('pwMinSolo')} /><//>
            <${Field} label="Shortest with two-step sign-in" hint="NIST: at least 8."><input type="number" min="8" max="64" value=${f.pwMin} onInput=${num('pwMin')} /><//>
          </div>
          <label className="check"><input type="checkbox" checked=${!!f.breached} onChange=${chk('breached')} /><span>Refuse passwords found in data breaches (checked privately: only 5 characters of a hash leave the server), and ask people to change one found later</span></label>
          <p className="muted small" style=${{ margin: 0 }}>No forced changes on a schedule and no composition rules (NIST advice). Passwords are stored with ${d.argon2 ? 'Argon2id' : 'bcrypt (Argon2id is not available on this PHP)'}.</p>
          <div className="row2">
            <${Field} label="Lock an account after (wrong passwords)"><input type="number" min="5" max="100" value=${f.lockAfter} onInput=${num('lockAfter')} /><//>
            <${Field} label="For (minutes)"><input type="number" min="5" max="1440" value=${f.lockMin} onInput=${num('lockMin')} /><//>
          </div>
        </section>
        <section className="panel stack form" style=${{ gap: 12 }}>
          <h2 className="ph" style=${{ margin: 0 }}>Sessions</h2>
          <div className="row2">
            <${Field} label="Staff: sign out after idle (minutes)"><input type="number" min="5" max="720" value=${f.idleStaff} onInput=${num('idleStaff')} /><//>
            <${Field} label="Staff: longest session (hours)"><input type="number" min="1" max="168" value=${f.absStaff} onInput=${num('absStaff')} /><//>
          </div>
          <div className="row2">
            <${Field} label="Others: sign out after idle (minutes)"><input type="number" min="5" max="10080" value=${f.idleOther} onInput=${num('idleOther')} /><//>
            <${Field} label="Others: longest session (hours)"><input type="number" min="1" max="2160" value=${f.absOther} onInput=${num('absOther')} /><//>
          </div>
          <p className="muted small" style=${{ margin: 0 }}>Staff means administrators, HR, accounting and managers. Background refreshes do not count as activity.</p>
        </section>
      </div>
      <section className="panel stack form" style=${{ gap: 12 }}>
        <h2 className="ph" style=${{ margin: 0 }}>Alerts and the security contact</h2>
        <div className="checks">
          <label className="check"><input type="checkbox" checked=${!!f.newDevice} onChange=${chk('newDevice')} /><span>Email people when their account signs in from a new device</span></label>
          <label className="check"><input type="checkbox" checked=${!!f.unusual} onChange=${chk('unusual')} /><span>Alert the security contacts about unusual sign-ins (a new country for staff, impossible travel, success after many failures)</span></label>
        </div>
        <${Field} label="Security alerts go to" hint="Nobody ticked: every administrator.">
          <div className="checks">${admins.map(p => html`<label key=${p.id} className="check"><input type="checkbox" checked=${alertOn(p.id)} onChange=${() => toggleAlert(p.id)} /><span>${p.n} <span className="muted small">${p.e}</span></span></label>`)}</div>
        <//>
        <${Field} label="Security contact email (public)" hint=${'Shown on the security page and in security.txt. Empty uses the site’s sending address. Confirmed ' + fmtDay(f.secReviewed) + '; security.txt asks for a fresh confirmation every year.'}>
          <input type="email" value=${f.secEmail || ''} onInput=${e => setF({ ...f, secEmail: e.target.value })} placeholder="security@yourdomain.com" />
        <//>
      </section>
      <div className="actions">
        <button className="btn" disabled=${busy} onClick=${() => save()}>${busy ? 'Saving…' : 'Save the sign-in rules'}</button>
        <button className="btn ghost" disabled=${busy} onClick=${() => save({ reviewed: true })}>Save and confirm the security contact</button>
      </div>
      <section className="panel stack" style=${{ gap: 8 }}>
        <h2 className="ph" style=${{ margin: 0 }}>People who must use two-step sign-in</h2>
        ${
          d.people.length
            ? html`<div className="tblwrap"><table className="tbl">
                <thead><tr><th>Person</th><th>Roles</th><th>Second step</th></tr></thead>
                <tbody>${d.people.map(
                  p => html`<tr key=${p.id}>
                    <td><b>${p.n}</b><div className="muted small">${p.e}</div></td>
                    <td className="small">${p.roles.join(', ')}</td>
                    <td>${p.methods.filter(m => m !== 'backup').length ? p.methods.filter(m => m !== 'backup').map(m => html`<${Chip} key=${m} s="ok">${NAMES[m]}<//> `) : html`<${Chip} s=${enforced ? 'red' : 'amber'}>Not yet<//>`}</td>
                  </tr>`
                )}</tbody>
              </table></div>`
            : html`<p className="muted small" style=${{ margin: 0 }}>Nobody is in a role that requires it.</p>`
        }
        <p className="muted small" style=${{ margin: 0 }}>Someone lost their phone and backup codes? Open them under Team (or Roles & access) and use "Reset two-step sign-in" after confirming who they are by phone or video. If every administrator is locked out, the mfa_reset_email line in api/config.php resets the second step of that one email at its next password sign-in.</p>
      </section>
    </div>`;
}

/* ---- Monitoring: the self-check, file integrity, blocked scripts ---- */
function TrustMonitor() {
  const toast = useToast();
  const [ov, setOv] = useState(null);
  const [iv, setIv] = useState(null);
  const [csp, setCsp] = useState(null);
  const [busy, setBusy] = useState('');
  const [run, reauthModal] = useReauth();
  const load = () =>
    Promise.all([api('trust_overview').then(setOv), api('trust_csp', {}).then(r => setCsp(r.rows))]).catch(e => toast(errText(e), true));
  const [scan, scanning] = useTrScan(load);
  const files = async accept => {
    setBusy(accept ? 'accept' : 'files');
    try {
      const r = accept ? await run(() => api('trust_integrity_accept', {})) : await api('trust_integrity', {}, { timeout: 120000 });
      setIv(r);
      toast(r.ok ? 'All program files match this version.' : 'Some files differ: see the list.');
    } catch (x) {
      if (!x || x.code !== 'cancelled') toast(errText(x), true);
    }
    setBusy('');
  };
  useEffect(() => {
    load();
  }, []);
  if (!ov) return html`<${Spinner} />`;
  const s = ov.scan;
  const v = iv || ov.integrity;
  const list = (t, items, tone) =>
    items && items.length
      ? html`<div><b className="small" style=${{ color: tone === 'red' ? 'var(--red-ink)' : 'inherit' }}>${t} (${items.length})</b><ul className="trfiles">${items.slice(0, 60).map(x => html`<li key=${x}><code>${x}</code></li>`)}</ul></div>`
      : null;
  return html`<div className="stack">
      ${reauthModal}
      <section className="panel stack" style=${{ gap: 10 }}>
        <div className="ph-row" style=${{ margin: 0 }}>
          <h2 className="ph">Security self-check</h2>
          <div className="actions">
            <button className="btn sm" disabled=${scanning} onClick=${() => scan('here')}>${scanning ? 'Checking…' : 'Run it now'}</button>
            ${ov.origin.replace(/\/$/, '') !== ov.site.replace(/\/$/, '') && html`<button className="btn ghost sm" disabled=${scanning} onClick=${() => scan('site')}>Check the public address</button>`}
          </div>
        </div>
        ${s ? html`<p className="muted small" style=${{ margin: 0 }}>Score ${s.score}% · ${s.sum.ok} OK, ${s.sum.warn} to improve, ${s.sum.fail} to fix · checked ${fmtTs(s.at)} at ${s.base}</p><${TrChecks} checks=${s.checks} />` : html`<p className="muted">Not run yet.</p>`}
      </section>
      <section className="panel stack" style=${{ gap: 10 }}>
        <div className="ph-row" style=${{ margin: 0 }}>
          <h2 className="ph">Program files</h2>
          <div className="actions">
            <button className="btn sm" disabled=${!!busy} onClick=${() => files(false)}>${busy === 'files' ? 'Checking…' : 'Check the files now'}</button>
            ${v && v.edited && v.edited.length > 0 && html`<button className="btn ghost sm" disabled=${!!busy} onClick=${() => files(true)}>I made these edits: accept them</button>`}
          </div>
        </div>
        <p className="muted small" style=${{ margin: 0 }}>Every file of the version is compared with its fingerprint from the build (${v ? v.checked + ' files, version ' + v.version + ', build ' + v.build : 'not checked yet'}). Any PHP file that is not part of the version is reported at once: on a hacked site that is usually how a back door looks.</p>
        ${
          v &&
          html`<${Fragment}>
            ${v.ok && !(v.edited || []).length ? html`<p className="note ok" style=${{ margin: 0 }}><span>All program files match this version (checked ${fmtTs(v.at)}).</span></p>` : null}
            ${list('Unexpected program files: review and delete them, then change passwords and record an incident', v.unexpected, 'red')}
            ${list('Changed since the build', v.changed)}
            ${list('Missing', v.missing)}
            ${list('Settings files edited on the server since you last accepted them', v.edited)}
          <//>`
        }
      </section>
      <section className="panel stack" style=${{ gap: 10 }}>
        <div className="ph-row" style=${{ margin: 0 }}>
          <h2 className="ph">Blocked scripts (Content-Security-Policy)</h2>
          ${csp && csp.length > 0 && html`<button className="btn ghost sm" onClick=${() => api('trust_csp', { clear: true }).then(r => setCsp(r.rows))}>Clear the list</button>`}
        </div>
        <p className="muted small" style=${{ margin: 0 }}>Browsers refuse scripts and frames that do not come from this site, and report each refusal here. A browser extension causes most of them; a flood of reports for one page can mean someone tried to inject code.</p>
        ${
          csp && csp.length
            ? html`<div className="tblwrap"><table className="tbl small">
                <thead><tr><th>Last seen</th><th>Page</th><th>Rule</th><th>Blocked</th><th className="r">Times</th></tr></thead>
                <tbody>${csp.map(r => html`<tr key=${r.id}><td>${fmtTs(+r.at)}</td><td className="trwrap">${r.page}</td><td>${r.dir}</td><td className="trwrap">${r.blocked}</td><td className="r">${r.n}</td></tr>`)}</tbody>
              </table></div>`
            : html`<p className="muted small" style=${{ margin: 0 }}>Nothing blocked.</p>`
        }
      </section>
    </div>`;
}

/* ---- Backups ---- */
function TrustBackups() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState('');
  const [key, setKey] = useState(null);
  const [kept, setKept] = useState(false);
  const [check, setCheck] = useState(null);
  const [run, reauthModal] = useReauth();
  const load = () =>
    api('trust_backup_get').then(
      r => {
        setD(r);
        setF(x => x || { keep: r.cfg.keep, full: r.cfg.full, fullKeep: r.cfg.fullKeep, s3: { ...r.cfg.s3 } });
      },
      e => toast(errText(e), true)
    );
  useEffect(() => {
    load();
  }, []);
  if (!d || !f) return html`<${Spinner} />`;
  const c = d.cfg;
  const act = async (k, fn, msg) => {
    setBusy(k);
    try {
      const r = await run(fn);
      if (msg) toast(typeof msg === 'function' ? msg(r) : msg);
      await load();
      return r;
    } catch (x) {
      if (!x || x.code !== 'cancelled') toast(errText(x), true);
    } finally {
      setBusy('');
    }
  };
  const keygen = async () => {
    if (c.pk && !window.confirm('Make a new recovery key? Backups made from now on use the new key; keep the old key for the older backups.')) return;
    const r = await act('key', () => api('trust_backup_keygen', {}));
    if (r && r.secret) {
      setKey(r);
      setKept(false);
    }
  };
  const keyText = key ? 'StratEdge portal backup recovery key\nFingerprint: ' + key.fp + '\nMade: ' + new Date().toLocaleString() + '\n\n' + key.secret + '\n\nKeep this offline (a password manager or a printed copy in a safe). Without it the backups cannot be opened.\n' : '';
  const saveCfg = () => act('cfg', () => api('trust_backup_cfg', { cfg: f }), 'Backup settings saved.');
  const s3 = f.s3;
  const up3 = k => e => setF({ ...f, s3: { ...s3, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value } });
  const last = d.last;
  return html`<div className="stack">
      ${reauthModal}
      ${!d.sodium && html`<p className="note red" style=${{ margin: 0 }}><span>This server has no libsodium, so backups cannot be encrypted. Ask the host to enable the PHP sodium extension.</span></p>`}
      ${!d.zip && html`<p className="note red" style=${{ margin: 0 }}><span>The PHP zip extension is missing; ask the host to enable it.</span></p>`}
      <section className="panel stack" style=${{ gap: 10 }}>
        <div className="ph-row" style=${{ margin: 0 }}><h2 className="ph">Encrypted backups</h2>${c.on && c.pk ? html`<${Chip} s=${last && last.ok ? 'ok' : 'amber'}>${last && last.ok ? 'Working' : 'Set up'}<//>` : html`<${Chip} s="red">Not set up<//>`}</div>
        <p className="muted small" style=${{ margin: 0 }}>Every night the database, the encryption key and the settings are packed and encrypted with the recovery key’s public half (XChaCha20-Poly1305); once a week the uploaded files are added. Only the recovery key opens a backup, and it is never stored on this server, so a copy of the server alone cannot read the backups.</p>
        ${
          !c.pk
            ? html`<div className="stack" style=${{ gap: 8 }}><p className="note amber" style=${{ margin: 0 }}><span><b>Start here:</b> make the recovery key and keep it offline. Backups start that night.</span></p><div><button className="btn" disabled=${!!busy || !d.sodium} onClick=${keygen}>Make the recovery key</button></div></div>`
            : html`<${Fragment}>
                <dl className="kv">
                  <dt>Recovery key</dt><dd>Fingerprint <code>${c.fp}</code>, made ${fmtDay(c.keyAt)}${c.keyBy ? ' by ' + c.keyBy : ''}${c.exported ? '' : html` <${Chip} s="amber">not confirmed as saved<//>`}</dd>
                  <dt>Last backup</dt><dd>${last ? (last.ok ? fmtTs(last.at) + ' · ' + last.name + ' · ' + trBytes(last.size) + (last.offsite ? ' · off-site copy' : '') : html`<span style=${{ color: 'var(--red-ink)' }}>Failed ${fmtTs(last.at)}: ${last.err}</span>`) : 'None yet'}</dd>
                  ${d.verify && html`<dt>Last test restore</dt><dd>${fmtTs(d.verify.at)} · ${d.verify.name} · ${d.verify.users} accounts, ${d.verify.records} records</dd>`}
                </dl>
                <div className="actions">
                  <button className="btn sm" disabled=${!!busy} onClick=${() => act('run', () => api('trust_backup_run', { full: false }, { timeout: 600000 }), r => (r.ok ? 'Backup made: ' + r.name : 'Backup failed: ' + r.err))}>${busy === 'run' ? 'Backing up…' : 'Back up now'}</button>
                  <button className="btn ghost sm" disabled=${!!busy} onClick=${() => act('run', () => api('trust_backup_run', { full: true }, { timeout: 600000 }), r => (r.ok ? 'Full backup made: ' + r.name : 'Backup failed: ' + r.err))}>Full backup with files</button>
                  <button className="btn ghost sm" disabled=${!!busy} onClick=${keygen}>New recovery key</button>
                </div>
              <//>`
        }
      </section>
      ${
        key &&
        html`<${Modal} title="Your backup recovery key" onClose=${() => kept && setKey(null)} foot=${html`<button className="btn" disabled=${!kept} onClick=${() => {
          api('trust_backup_key_saved', {}).then(load);
          setKey(null);
        }}>Done</button>`}>
          <div className="stack" style=${{ gap: 12 }}>
            <p className="note amber" style=${{ margin: 0 }}><span><b>Shown once.</b> Save it now: StratEdge does not keep it. Without it nobody, including us, can open the backups.</span></p>
            <code className="secretkey" style=${{ display: 'block' }}>${key.secret}</code>
            <p className="muted small" style=${{ margin: 0 }}>Fingerprint ${key.fp}. Keep it in a password manager and on paper in a safe place, away from this server.</p>
            <div className="actions">
              <button className="btn ghost sm" onClick=${() => navigator.clipboard && navigator.clipboard.writeText(key.secret).then(() => toast('Copied.'))}>Copy</button>
              <button className="btn ghost sm" onClick=${() => FileSaver.save({ filename: 'stratedge-backup-recovery-key-' + key.fp + '.txt', data: keyText })}>Download</button>
            </div>
            <label className="check"><input type="checkbox" checked=${kept} onChange=${e => setKept(e.target.checked)} /><span>I saved the recovery key somewhere safe, away from this server</span></label>
          </div>
        <//>`
      }
      ${
        c.pk &&
        html`<${Fragment}>
          <section className="panel stack" style=${{ gap: 10 }}>
            <h2 className="ph" style=${{ margin: 0 }}>Backups on this server</h2>
            ${
              d.list.length
                ? html`<div className="tblwrap"><table className="tbl">
                    <thead><tr><th>Backup</th><th>Made</th><th className="r">Size</th><th></th></tr></thead>
                    <tbody>${d.list.map(
                      b => html`<tr key=${b.name}>
                        <td><code className="small">${b.name}</code> ${b.full ? html`<${Chip} s="ok">with files<//>` : ''}</td>
                        <td>${fmtTs(b.at)}</td>
                        <td className="r">${trBytes(b.size)}</td>
                        <td className="r"><div className="actions" style=${{ justifyContent: 'flex-end' }}>
                          <button className="btn ghost sm" onClick=${() => setCheck({ name: b.name, mode: 'verify', key: '', res: null })}>Check</button>
                          <button className="btn ghost sm" onClick=${() =>
                            act('dl', async () => {
                              const blob = await apiBlob('trust_backup_download', { name: b.name });
                              FileSaver.save({ filename: b.name, data: blob });
                              return true;
                            })}>Download</button>
                          <button className="btn ghost sm" onClick=${() => setCheck({ name: b.name, mode: 'restore', key: '', confirm: '', res: null })}>Restore…</button>
                        </div></td>
                      </tr>`
                    )}</tbody>
                  </table></div>`
                : html`<p className="muted small" style=${{ margin: 0 }}>No backups yet: press "Back up now", or wait for tonight.</p>`
            }
            <p className="muted small" style=${{ margin: 0 }}>"Check" opens a backup with the recovery key and tests the database inside, without changing anything (do it every few months: an untested backup is a hope, not a backup). A downloaded backup opens with the same key and the decrypt steps in README.txt.</p>
          </section>
          <section className="panel stack form" style=${{ gap: 12 }}>
            <h2 className="ph" style=${{ margin: 0 }}>Schedule and off-site copy</h2>
            <div className="row3">
              <${Field} label="Nightly backups to keep"><input type="number" min="3" max="90" value=${f.keep} onInput=${e => setF({ ...f, keep: +e.target.value })} /><//>
              <${Field} label="Weekly full backups to keep"><input type="number" min="1" max="12" value=${f.fullKeep} onInput=${e => setF({ ...f, fullKeep: +e.target.value })} /><//>
              <label className="check" style=${{ alignSelf: 'end' }}><input type="checkbox" checked=${!!f.full} onChange=${e => setF({ ...f, full: e.target.checked })} /><span>Weekly full backup with the uploaded files (Sundays)</span></label>
            </div>
            <label className="check"><input type="checkbox" checked=${!!s3.on} onChange=${up3('on')} /><span><b>Also copy each backup off the server</b> (Amazon S3, Backblaze B2, Wasabi, Cloudflare R2 or any S3-compatible storage). A copy elsewhere survives a lost or hacked server.</span></label>
            ${
              s3.on &&
              html`<${Fragment}>
                <div className="row2">
                  <${Field} label="Storage address" hint="e.g. https://s3.us-east-1.amazonaws.com or https://s3.us-west-004.backblazeb2.com"><input value=${s3.endpoint} onInput=${up3('endpoint')} placeholder="https://" /><//>
                  <${Field} label="Region"><input value=${s3.region} onInput=${up3('region')} placeholder="us-east-1" /><//>
                </div>
                <div className="row2">
                  <${Field} label="Bucket"><input value=${s3.bucket} onInput=${up3('bucket')} /><//>
                  <${Field} label="Folder in the bucket"><input value=${s3.prefix} onInput=${up3('prefix')} /><//>
                </div>
                <div className="row2">
                  <${Field} label="Access key ID"><input value=${s3.akid} onInput=${up3('akid')} autoComplete="off" /><//>
                  <${Field} label="Secret access key" hint="Stored encrypted; leave the dots to keep the saved one."><input type="password" value=${s3.secret} onInput=${up3('secret')} autoComplete="new-password" /><//>
                </div>
                <p className="muted small" style=${{ margin: 0 }}>Give this key permission to upload and delete in that bucket only. Turn on the bucket’s versioning or object lock if your provider has it, so a stolen key cannot erase the copies.</p>
              <//>`
            }
            <div className="actions">
              <button className="btn" disabled=${!!busy} onClick=${saveCfg}>${busy === 'cfg' ? 'Saving…' : 'Save'}</button>
              ${s3.on && html`<button className="btn ghost" disabled=${!!busy} onClick=${() => act('s3', () => api('trust_backup_s3test', {}), r => r.message)}>Test the storage</button>`}
            </div>
          </section>
        <//>`
      }
      ${
        check &&
        html`<${Modal} title=${(check.mode === 'restore' ? 'Restore from ' : 'Check ') + check.name} onClose=${() => setCheck(null)} foot=${html`<button className="btn ghost" onClick=${() => setCheck(null)}>Close</button>
            <button className=${'btn' + (check.mode === 'restore' ? ' danger' : '')} disabled=${!!busy || !check.key || (check.mode === 'restore' && check.confirm !== 'RESTORE')} onClick=${async () => {
              const r = await act(check.mode, () => api(check.mode === 'restore' ? 'trust_backup_restore' : 'trust_backup_verify', { name: check.name, key: check.key.trim(), confirm: check.confirm || '' }, { timeout: 900000 }));
              if (r) setCheck({ ...check, key: '', res: r });
            }}>${busy === check.mode ? 'Working…' : check.mode === 'restore' ? 'Restore' : 'Check this backup'}</button>`}>
          <div className="form">
            ${check.mode === 'restore' && html`<p className="note red" style=${{ margin: 0 }}><span><b>Restoring replaces the whole database</b> with this backup (and the uploaded files when it has them). Everything entered since ${check.name.match(/\d{8}-\d{6}/) ? 'it was made' : 'then'} is lost. A safety copy of the current database is kept first.</span></p>`}
            <${Field} label="Recovery key" hint="Starts with SEBK-. It is used for this request only and never stored."><textarea rows="3" value=${check.key} onInput=${e => setCheck({ ...check, key: e.target.value })} autoComplete="off" spellCheck="false" /><//>
            ${check.mode === 'restore' && html`<${Field} label="Type RESTORE to confirm"><input value=${check.confirm} onInput=${e => setCheck({ ...check, confirm: e.target.value })} /><//>`}
            ${
              check.res &&
              (check.res.ok
                ? html`<p className="note ok" style=${{ margin: 0 }}><span>${check.mode === 'restore' ? 'Restored. ' + (check.res.files || 0) + ' files put back; the previous database was kept as ' + check.res.safety + '. Reload the page.' : 'The backup opens and its database is sound: ' + check.res.users + ' accounts, ' + check.res.records + ' records' + (check.res.hasKey ? ', encryption key included' : '') + '.'}</span></p>`
                : html`<p className="note red" style=${{ margin: 0 }}><span>${check.res.err}</span></p>`)
            }
          </div>
        <//>`
      }
    </div>`;
}

/* ---- Encryption ---- */
function TrustData() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState('');
  const [run, reauthModal] = useReauth();
  const load = () => api('trust_overview').then(setD, e => toast(errText(e), true));
  useEffect(() => {
    load();
  }, []);
  if (!d) return html`<${Spinner} />`;
  const fs = d.files;
  const sweep = async () => {
    setBusy('seal');
    try {
      let r;
      for (let i = 0; i < 40; i++) {
        r = await api('trust_files_seal', {}, { timeout: 60000 });
        setD(x => ({ ...x, files: r }));
        if (!r.plain || !r.done) break;
      }
      toast(r && !r.plain ? 'Every uploaded file is encrypted.' : (r ? r.plain : '?') + ' files still to encrypt' + (r && r.failed ? ' (' + r.failed + ' could not be read)' : '') + '.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const move = async () => {
    if (!window.confirm('Move the encryption key out of the website folder? Do this when no one is uploading files. Make a backup first.')) return;
    setBusy('key');
    try {
      const r = await run(() => api('trust_key_move', {}));
      toast(r.message, !r.ok);
      load();
    } catch (x) {
      if (!x || x.code !== 'cancelled') toast(errText(x), true);
    }
    setBusy('');
  };
  return html`<div className="stack">
      ${reauthModal}
      <section className="panel stack" style=${{ gap: 10 }}>
        <div className="ph-row" style=${{ margin: 0 }}><h2 className="ph">Encryption at rest</h2>${fs && !fs.plain ? html`<${Chip} s="ok">All files encrypted<//>` : html`<${Chip} s="amber">${fs ? fs.plain + ' files to go' : 'Not checked'}<//>`}</div>
        <p className="muted small" style=${{ margin: 0 }}>Uploaded documents (immigration papers, ID copies, resumes, contracts, signed PDFs, receipts) are encrypted with AES-256-GCM before they are written to disk; bank account numbers, mailbox passwords and connection secrets are sealed the same way. People see their files as usual: the portal decrypts them on the way out, for those allowed to see them.</p>
        ${fs && html`<dl className="kv"><dt>Uploads</dt><dd>${fs.total - fs.plain} of ${fs.total} encrypted${fs.failed ? ', ' + fs.failed + ' could not be read' : ''} (checked ${fmtTs(fs.at)})</dd></dl>`}
        ${fs && fs.plain > 0 && html`<div><button className="btn sm" disabled=${!!busy} onClick=${sweep}>${busy === 'seal' ? 'Encrypting…' : 'Encrypt the older files now'}</button></div>`}
        <p className="muted small" style=${{ margin: 0 }}>Older uploads are also encrypted a batch at a time by the scheduled task.</p>
      </section>
      <section className="panel stack" style=${{ gap: 10 }}>
        <div className="ph-row" style=${{ margin: 0 }}><h2 className="ph">The encryption key</h2>${d.key.ok ? (d.key.inside ? html`<${Chip} s="amber">Inside the website folder<//>` : html`<${Chip} s="ok">Outside the website folder<//>`) : html`<${Chip} s="red">Missing<//>`}</div>
        <p className="muted small" style=${{ margin: 0 }}>One key protects everything above. The website folder blocks it from the web, but keeping it one folder up (${d.key.outsideDir}) means even a host misconfiguration cannot serve it. It is included in every encrypted backup.</p>
        ${d.key.inside && html`<div><button className="btn sm" disabled=${!!busy} onClick=${move}>${busy === 'key' ? 'Moving…' : 'Move the key out of the website folder'}</button></div>`}
        <p className="muted small" style=${{ margin: 0 }}>Never delete or replace the key file: without it the encrypted files cannot be opened. If the site moves to another server, copy the key with it (it is in every backup).</p>
      </section>
    </div>`;
}

/* ---- Activity: the sealed audit log ---- */
const AUDIT_KINDS = [
  ['', 'Everything'],
  ['auth', 'Sign-ins'],
  ['access', 'Access changes'],
  ['data', 'Personal data'],
  ['settings', 'Settings'],
  ['policy', 'Policies & risks'],
  ['incident', 'Incidents'],
  ['system', 'System'],
  ['alert', 'Alerts'],
];
function TrustAudit() {
  const toast = useToast();
  const [f, setF] = useState({ kind: '', q: '', from: '', to: '', page: 1 });
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState(null);
  const load = (x = f) =>
    api('gov_audit', { kind: x.kind, q: x.q, page: x.page, from: x.from ? new Date(x.from + 'T00:00:00').getTime() : 0, to: x.to ? new Date(x.to + 'T23:59:59').getTime() : 0 }).then(setD, e => toast(errText(e), true));
  useEffect(() => {
    load();
  }, []);
  const set = (k, v) => {
    const n = { ...f, [k]: v, page: k === 'page' ? v : 1 };
    setF(n);
    if (k !== 'q') load(n);
  };
  const verify = async () => {
    setBusy('verify');
    try {
      const r = await api('gov_audit_verify', {});
      toast(r.ok ? 'The audit log is complete and unaltered (' + r.n + ' entries).' : 'The audit log was altered: ' + r.why, !r.ok);
      load();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const csv = async () => {
    setBusy('csv');
    try {
      const r = await api('gov_audit_csv', {});
      FileSaver.save({ filename: 'stratedge-audit-log-' + dkey() + '.csv', data: new Blob([r.csv], { type: 'text/csv' }) });
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const v = d && d.verify;
  const pages = d ? Math.max(1, Math.ceil(d.total / 100)) : 1;
  return html`<div className="stack">
      <section className="panel stack" style=${{ gap: 10 }}>
        <div className="ph-row" style=${{ margin: 0 }}>
          <h2 className="ph">Activity and audit log</h2>
          <div className="actions">
            <button className="btn ghost sm" disabled=${!!busy} onClick=${verify}>${busy === 'verify' ? 'Checking…' : 'Check the seal'}</button>
            <button className="btn ghost sm" disabled=${!!busy} onClick=${csv}>Export CSV</button>
          </div>
        </div>
        <p className="muted small" style=${{ margin: 0 }}>Sign-ins, access and settings changes, data exports and deletions, policies and incidents, in order. Each entry is sealed to the one before it, so a change or removal made directly in the database shows up when the seal is checked (every day automatically).${v ? ' Last check ' + fmtTs(v.at) + ': ' + (v.ok ? 'unaltered, ' + v.n + ' entries.' : 'ALTERED (' + v.why + ').') : ''}</p>
        <div className="trfilters">
          <select value=${f.kind} onChange=${e => set('kind', e.target.value)} aria-label="Kind">${AUDIT_KINDS.map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select>
          <input type="search" placeholder="Search person, action, target or address" value=${f.q} onInput=${e => setF({ ...f, q: e.target.value })} onKeyDown=${e => e.key === 'Enter' && load({ ...f, page: 1 })} aria-label="Search" />
          <input type="date" value=${f.from} onChange=${e => set('from', e.target.value)} aria-label="From" />
          <input type="date" value=${f.to} onChange=${e => set('to', e.target.value)} aria-label="To" />
          <button className="btn sm" onClick=${() => load({ ...f, page: 1 })}>Search</button>
        </div>
        ${
          !d
            ? html`<${Spinner} />`
            : d.rows.length
              ? html`<div className="tblwrap"><table className="tbl small trlog">
                  <thead><tr><th>When</th><th>Who</th><th>What</th><th>About</th><th>Address</th></tr></thead>
                  <tbody>${d.rows.map(
                    r => html`<tr key=${r.seq} onClick=${() => setOpen(r)} className="clickable">
                      <td className="nowrap">${fmtTs(+r.at)}</td>
                      <td>${r.who || 'System'}</td>
                      <td><span className=${'trkind k-' + r.kind}>${r.kind}</span> ${r.act}</td>
                      <td className="trwrap">${r.target}</td>
                      <td className="nowrap muted">${r.ip}</td>
                    </tr>`
                  )}</tbody>
                </table></div>
                <div className="actions" style=${{ justifyContent: 'space-between' }}>
                  <span className="muted small">${d.total.toLocaleString()} entries · page ${d.page} of ${pages}</span>
                  <span className="actions">
                    <button className="btn ghost sm" disabled=${d.page <= 1} onClick=${() => set('page', d.page - 1)}>Newer</button>
                    <button className="btn ghost sm" disabled=${d.page >= pages} onClick=${() => set('page', d.page + 1)}>Older</button>
                  </span>
                </div>`
              : html`<p className="muted">Nothing matches.</p>`
        }
      </section>
      ${
        open &&
        html`<${Modal} title=${'Entry ' + open.seq} onClose=${() => setOpen(null)}>
          <dl className="kv">
            <dt>When</dt><dd>${fmtTs(+open.at)}</dd>
            <dt>Who</dt><dd>${open.who || 'System'}${open.uid ? html` <span className="muted small">(${open.uid})</span>` : ''}</dd>
            <dt>Network address</dt><dd>${open.ip}</dd>
            <dt>Kind</dt><dd>${open.kind}</dd>
            <dt>Action</dt><dd>${open.act}</dd>
            <dt>About</dt><dd className="trwrap">${open.target}</dd>
          </dl>
          <pre className="trpre">${JSON.stringify(trJson(open.detail), null, 2)}</pre>
        <//>`
      }
    </div>`;
}

/* ---- v35: Protection (api/guard.php): confirm-it's-you, the bot check, the data-theft guard, payroll bank changes,
   staff networks, upload screening. Cross-site blocking and the locked session cookie are always on. ---- */
function TrustProtect() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState('');
  const load = () =>
    api('guard_get', {}).then(
      r => {
        setD(r);
        setF({ ...r.cfg });
      },
      e => toast(errText(e), true)
    );
  useEffect(() => {
    load();
  }, []);
  if (!d || !f) return html`<${Spinner} label="Loading the protection settings…" />`;
  const chk = k => e => setF({ ...f, [k]: e.target.checked });
  const num = k => e => setF({ ...f, [k]: e.target.value === '' ? '' : +e.target.value });
  const act = async (key, fn, msg) => {
    setBusy(key);
    try {
      const r = await fn();
      if (msg) toast(typeof msg === 'function' ? msg(r) : msg);
      await load();
    } catch (x) {
      if (!x || x.code !== 'cancelled') toast(errText(x), true);
    }
    setBusy('');
  };
  const save = () => act('save', () => api('guard_save', { cfg: f }), 'Protection settings saved.');
  const ev = d.events || [];
  return html`<div className="stack">
      <${KitStats} items=${[
        { v: d.counts.bot || 0, l: 'Bot checks failed (7 days)' },
        { v: d.counts.xsite || 0, l: 'Requests from other sites blocked (7 days)' },
        { v: d.pauses.length, l: 'People paused by the data guard', tone: d.pauses.length ? 'warn' : '' },
        { v: d.holds, l: 'Bank account changes on hold' },
        { v: d.attack ? 'Until ' + fmtTs(d.attack) : 'No', l: 'Sign-in attack mode', tone: d.attack ? 'warn' : '' },
      ]} />
      ${
        d.attack > 0 &&
        html`<div className="note amber"><span><b>Sign-in attack mode is on</b> after many wrong passwords: every sign-in passes the invisible bot check until ${fmtTs(d.attack)}.</span><div className="actions"><button className="btn sm" disabled=${!!busy} onClick=${() => act('attack', () => api('guard_attack_end', {}), 'Attack mode ended.')}>End it now</button></div></div>`
      }
      <div className="g2" style=${{ alignItems: 'start' }}>
        <section className="panel stack form" style=${{ gap: 12 }}>
          <h2 className="ph" style=${{ margin: 0 }}>Confirm it’s you</h2>
          <p className="muted small" style=${{ margin: 0 }}>Before access and role changes, new staff logins, keys of outside services (email, Stripe, Plaid, QuickBooks, sign-in providers, AI, job boards), bank accounts and payroll files, bulk exports and data deletion, people enter their password, a passkey or a code, unless they did within this time. A stolen session or an unlocked computer cannot do these on its own.</p>
          <${Field} label="Ask again after (minutes)"><input type="number" min="1" max="60" value=${f.reauthMin} onInput=${num('reauthMin')} /><//>
        </section>
        <section className="panel stack form" style=${{ gap: 12 }}>
          <h2 className="ph" style=${{ margin: 0 }}>Bot check</h2>
          <p className="muted small" style=${{ margin: 0 }}>The browser solves a small puzzle before a form is accepted: invisible to people (a fraction of a second), costly for bots sending thousands. No picture puzzles and no outside service.</p>
          <div className="checks">
            <label className="check"><input type="checkbox" checked=${!!f.pow} onChange=${chk('pow')} /><span>On public forms (contact, sign-up, careers, password reset, privacy and security reports, the website assistant)</span></label>
            <label className="check"><input type="checkbox" checked=${!!f.powLogin} onChange=${chk('powLogin')} /><span>On sign-in, from an address with wrong passwords and for everyone during an attack</span></label>
          </div>
          <div className="row2">
            <${Field} label="Wrong passwords from one address (15 minutes)"><input type="number" min="1" max="50" value=${f.powIpFails} onInput=${num('powIpFails')} /><//>
            <${Field} label="Wrong passwords site-wide (10 minutes) = attack"><input type="number" min="5" max="5000" value=${f.powAttack} onInput=${num('powAttack')} /><//>
          </div>
          <${Field} label="Puzzle size for public forms"><select value=${f.powLevel} onChange=${e => setF({ ...f, powLevel: e.target.value })}><option value="normal">Normal (about a quarter of a second)</option><option value="strong">Strong (about a second, for heavy spam)</option></select><//>
        </section>
      </div>
      <section className="panel stack form" style=${{ gap: 12 }}>
        <div className="ph-row" style=${{ margin: 0 }}><h2 className="ph">Data-theft guard</h2>${f.dlp ? html`<${Chip} s="ok">On<//>` : html`<${Chip} s="amber">Off<//>`}</div>
        <p className="muted small" style=${{ margin: 0 }}>Resumes, documents, exports and candidate profiles are counted per person. More than the levels below in an hour alerts the security contacts; three times as many pauses that person’s downloads, exports and profile views until you allow them again. Administrators are alerted on, never paused.</p>
        <label className="check"><input type="checkbox" checked=${!!f.dlp} onChange=${chk('dlp')} /><span>Watch downloads, exports and profile views</span></label>
        <div className="row3">
          <${Field} label="Files per hour"><input type="number" min="5" value=${f.dlpFiles} onInput=${num('dlpFiles')} /><//>
          <${Field} label="Exports per hour"><input type="number" min="5" value=${f.dlpExports} onInput=${num('dlpExports')} /><//>
          <${Field} label="Profiles opened per hour"><input type="number" min="5" value=${f.dlpProfiles} onInput=${num('dlpProfiles')} /><//>
        </div>
        <label className="check"><input type="checkbox" checked=${!!f.dlpPause} onChange=${chk('dlpPause')} /><span>Pause the person at three times the level</span></label>
        ${
          d.pauses.length > 0 &&
          html`<ul className="list seclist">${d.pauses.map(
            x => html`<li key=${x.uid}><div className="t"><b>${x.name}</b><span className="muted small">${x.email} · paused ${fmtTs(x.at)} after ${x.n} ${x.kind === 'file' ? 'files' : x.kind === 'export' ? 'exports' : 'profiles'} in an hour</span></div><div className="actions"><button className="btn sm" disabled=${!!busy} onClick=${() => act('rel' + x.uid, () => api('guard_release', { uid: x.uid }), x.name + ' can download again.')}>Allow again</button></div></li>`
          )}</ul>`
        }
      </section>
      <div className="g2" style=${{ alignItems: 'start' }}>
        <section className="panel stack form" style=${{ gap: 12 }}>
          <h2 className="ph" style=${{ margin: 0 }}>Payroll bank changes</h2>
          <p className="muted small" style=${{ margin: 0 }}>Criminals who take over an account (or email HR pretending to be an employee) change the bank account so the next pay goes to them. A changed account waits this many days before payroll pays into it, pay keeps going to the old account meanwhile, and the employee gets an email with a “this was not me” link that puts the old account back and locks the account. Payroll staff can release a hold after calling the person.</p>
          <${Field} label="Hold a changed bank account for (days)" hint="0 switches the hold off; the emails are always sent."><input type="number" min="0" max="14" value=${f.ddHold} onInput=${num('ddHold')} /><//>
        </section>
        <section className="panel stack form" style=${{ gap: 12 }}>
          <h2 className="ph" style=${{ margin: 0 }}>Staff networks</h2>
          <p className="muted small" style=${{ margin: 0 }}>Optional: administrators, HR, accounting and managers sign in (and stay signed in) only from these network addresses, for example your office. Others are not affected. Your address now: <b>${d.ip}</b>.</p>
          ${d.netsOff && html`<p className="note amber" style=${{ margin: 0 }}><span>Switched off by staff_nets_off in api/config.php.</span></p>`}
          <${Field} label="Network addresses, one per line" hint="203.0.113.9, a prefix like 203.0.113. or a block like 203.0.113.0/24. Empty: staff may sign in from anywhere. If the office address changes and nobody can sign in, add 'staff_nets_off' => true to api/config.php."><textarea rows="4" value=${f.staffNets} onInput=${e => setF({ ...f, staffNets: e.target.value })} placeholder=${d.ip} /><//>
        </section>
      </div>
      <section className="panel stack form" style=${{ gap: 10 }}>
        <h2 className="ph" style=${{ margin: 0 }}>Uploads and email attachments</h2>
        <p className="muted small" style=${{ margin: 0 }}>Always on: a file’s content must match its type (a “PDF” must really be a PDF); Office files with macros, archives carrying programs, unsafe paths and zip bombs are refused. Attachments on emails from outside lose programs, scripts, web pages and macro files before anyone can open them.${d.zip ? '' : ' (This server’s PHP has no zip support, so the inside of Office files and archives is not checked: ask the host to enable the zip extension.)'}</p>
        <label className="check"><input type="checkbox" checked=${!!f.av} onChange=${chk('av')} /><span>Scan every upload with ClamAV ${d.av.target ? '(set in api/config.php)' : '(not set up: add \'clamav\' => \'unix:///var/run/clamd.scan/clamd.sock\' to api/config.php if your host runs ClamAV)'}</span></label>
        ${d.av.target && html`<div className="actions"><button className="btn ghost sm" disabled=${!!busy} onClick=${() => act('av', () => api('guard_av_test', {}), r => (r.found ? 'ClamAV works: it caught the test file (' + r.virus + ').' : 'ClamAV did not report the test file' + (r.err ? ': ' + r.err : '.')))}>Test the virus scanner</button>${d.av.ok ? html`<span className="muted small">Last clean scan ${fmtTs(d.av.ok)}</span>` : null}</div>`}
        ${d.av.err && html`<p className="muted small" style=${{ margin: 0 }}>Last problem: ${d.av.err.err} (${fmtTs(d.av.err.at)})</p>`}
      </section>
      <div className="actions"><button className="btn" disabled=${!!busy} onClick=${save}>${busy === 'save' ? 'Saving…' : 'Save the protection settings'}</button></div>
      <section className="panel stack" style=${{ gap: 8 }}>
        <h2 className="ph" style=${{ margin: 0 }}>Always on</h2>
        <ul className="list seclist">
          <li><div className="t"><b>Requests from other web sites are refused</b><span className="muted small">A page elsewhere cannot use a visitor’s signed-in browser to change anything here (Fetch Metadata), on top of the same-site check every change already needs.</span></div></li>
          <li><div className="t"><b>The session is locked to this site and this browser</b><span className="muted small">Over HTTPS the session cookie can only be set by this exact site (__Host-), the server only accepts sessions it created, and a session used from a browser without its device cookie (a copied cookie) ends at once and alerts you.</span></div></li>
        </ul>
      </section>
      <section className="panel stack" style=${{ gap: 8 }}>
        <h2 className="ph" style=${{ margin: 0 }}>Recent protection events</h2>
        ${
          ev.length
            ? html`<ul className="list seclist">${ev.map(x => html`<li key=${x.seq}><div className="t"><span>${x.act}</span><span className="muted small">${fmtTs(+x.at)} · ${x.target}</span>${trJson(x.detail).text && html`<span className="small trwrap">${String(trJson(x.detail).text).slice(0, 300)}</span>`}</div></li>`)}</ul>`
            : html`<p className="muted small" style=${{ margin: 0 }}>Nothing yet. Unusual downloads, pauses, refused uploads, sign-in attacks and staff sign-ins from outside the networks appear here.</p>`
        }
      </section>
    </div>`;
}
