/* ================= v37 StratEdge Workspaces: the provider console (Admin › System › Workspaces) =================
   Other companies' portals on this installation. Each workspace has its own database, files, encryption key, search
   index and logs (storage/ws/<name>/), its own address (/w/<name>/ at once; a subdomain or the company's own domain
   once the hosting has it), its own parts of the portal, brand and first administrator. Routes ws_* (api/wsadmin.php);
   only StratEdge's own administrators, on StratEdge's own site, reach them. */

const WS_STATUS = { active: ['Active', 'ok'], paused: ['Paused', 'amber'] };
// wsSlugOf (a short name from a company's name) is in wsjoin.js, shared with the public sign-up page
const wsWhen = ts => (ts ? fmtTs(ts) : 'never');

function WorkspacesPage({ q }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [make, setMake] = useState(false);
  const [open, setOpen] = useState(null); // slug
  // v37.4: Workspaces | Sign-up requests (#/portal/admin/workspaces?tab=requests&req=<id> from the emails)
  const [tab, setTab] = useState(q && q.tab === 'requests' ? 'requests' : 'list');
  useEffect(() => {
    if (q && q.tab === 'requests') setTab('requests');
  }, [q && q.tab, q && q.req]);
  const load = () =>
    api('ws_list', {}).then(
      r => {
        setD(r);
        setErr(null);
      },
      e => setErr(e)
    );
  useEffect(() => {
    load();
  }, []);
  if (err) return html`<${LoadError} error=${err} onRetry=${load} />`;
  if (!d) return html`<${Spinner} label="Loading the workspaces…" />`;
  const rows = d.rows || [];
  const row = open ? rows.find(r => r.slug === open) : null;
  const put = r => setD(x => ({ ...x, rows: x.rows.some(y => y.slug === r.slug) ? x.rows.map(y => (y.slug === r.slug ? r : y)) : [r, ...x.rows] }));
  const sg = d.signups || { new: 0 };
  // the count is only on requests waiting for review (a figure on the list would read as something to do)
  const tabs = html`<${KitTabs} tabs=${[['list', 'Workspaces', null], ['requests', 'Sign-up requests', sg.new || null]]} tab=${tab} onTab=${setTab} />`;
  if (tab === 'requests')
    return html`<div className="stack wsadmin">
        ${tabs}
        <${WsSignups} d=${d} q=${q} onWs=${(r, counts) => {
          if (r) put(r);
          if (counts) setD(x => ({ ...x, signups: { ...(x.signups || {}), ...counts } }));
        }} onOpenWs=${slug => {
          setTab('list');
          setOpen(slug);
        }} />
        ${
          row &&
          html`<${WsManageModal} d=${d} row=${row} onClose=${() => setOpen(null)} onRow=${put} onGone=${slug => {
            setD(x => ({ ...x, rows: x.rows.filter(y => y.slug !== slug) }));
            setOpen(null);
          }} />`
        }
      </div>`;
  return html`<div className="stack wsadmin">
      ${tabs}
      <div className="toolbar">
        <p className="muted small" style=${{ margin: 0, maxWidth: 720 }}>Portals for other companies, run on this site. Each workspace has its own database, files and encryption key; nobody in one can see another's data or StratEdge's. A new workspace works at once at ${d.base}<i>name</i>/.</p>
        <div className="push">
          <button className="btn" onClick=${() => setMake(true)} disabled=${!d.writable}><${Icon} n="plus" />New workspace</button>
        </div>
      </div>
      ${
        !d.writable &&
        html`<p className="note amber" role="alert"><span><b>The workspaces folder can't be written.</b> The web server needs to write to storage/ws (make storage writable as for uploads, or create storage/ws with the same permissions as storage/files).</span></p>`
      }
      <section className="panel" style=${{ padding: '6px 8px' }}>
        ${
          rows.length
            ? html`<div className="tblwrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Company</th>
                      <th>Address</th>
                      <th>Status</th>
                      <th>People</th>
                      <th>Last sign-in</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    ${rows.map(r => {
                      const st = WS_STATUS[r.status] || [r.status, ''];
                      return html`<tr key=${r.slug}>
                        <td>
                          <b style=${{ fontWeight: 600 }}>${r.name}</b>
                          <div className="muted small">${r.slug} · ${r.features.length} part${r.features.length === 1 ? '' : 's'}${r.plan && r.plan.until ? ' · pilot until ' + fmtDate(r.plan.until, { month: 'short', day: 'numeric', year: 'numeric' }) : ''}</div>
                        </td>
                        <td><a href=${r.url} target="_blank" rel="noopener">${r.url.replace(/^https?:\/\//, '')}</a></td>
                        <td>
                          <${Chip} s=${st[1]}>${st[0]}<//>
                          ${!r.setupDone && html`<div className="muted small" style=${{ marginTop: 4 }}>Waiting for ${r.admin.email || 'its administrator'} to set it up</div>`}
                        </td>
                        <td>${r.usage.users} account${r.usage.users === 1 ? '' : 's'}${r.usage.people ? html`<div className="muted small">${r.usage.people} candidate${r.usage.people === 1 ? '' : 's'} · ${r.usage.mb} MB</div>` : html`<div className="muted small">${r.usage.mb} MB</div>`}</td>
                        <td>${wsWhen(r.usage.last)}</td>
                        <td className="r"><button className="btn ghost sm" onClick=${() => setOpen(r.slug)}>Manage</button></td>
                      </tr>`;
                    })}
                  </tbody>
                </table>
              </div>`
            : html`<${Empty} title="No workspaces yet" action=${d.writable ? html`<button className="btn" onClick=${() => setMake(true)}>Create the first workspace</button>` : null}>Create one for a company: it gets its own portal, with the parts of the portal you choose, its name and colors, and a setup link for its first administrator.<//>`
        }
      </section>
      <p className="muted small">Scheduled work (reminders, emails, clean-ups) runs for every active workspace after StratEdge's own, from the same scheduled task. Deleting a workspace moves its folder to storage/ws/.trash; nothing is erased.</p>
      ${
        make &&
        html`<${WsCreateModal} d=${d} onClose=${() => setMake(false)} onMade=${(r, mailed) => {
          put(r);
          setMake(false);
          setOpen(r.slug);
          toast(mailed ? 'Workspace created. The setup link went to ' + r.admin.email + '.' : 'Workspace created, but the email did not go out: copy the setup link from Overview.', !mailed);
        }} />`
      }
      ${
        row &&
        html`<${WsManageModal} d=${d} row=${row} onClose=${() => setOpen(null)} onRow=${put} onGone=${slug => {
          setD(x => ({ ...x, rows: x.rows.filter(y => y.slug !== slug) }));
          setOpen(null);
        }} />`
      }
    </div>`;
}

function WsFeatureChecks({ d, value, onChange }) {
  return html`<div className="wsfeats">
      ${(d.features || []).map(
        f => html`<label key=${f.k} className="check">
            <input type="checkbox" checked=${value.includes(f.k)} onChange=${e => onChange(e.target.checked ? [...value, f.k] : value.filter(x => x !== f.k))} />
            <span><b>${f.n}</b><span className="muted small" style=${{ display: 'block' }}>${f.d}</span></span>
          </label>`
      )}
    </div>`;
}

/* v37.2: the brand color: suggested colors, the code (3-digit codes and a missing # are fixed when you leave the field),
   a pick from anywhere on the screen where the browser can (the logo, the company's website), and a preview with how
   readable white text is on it (the portal's buttons and header use white text on the brand color). */
const WS_SWATCHES = ['#2B3993', '#1D4ED8', '#0E7490', '#0F766E', '#15803D', '#A16207', '#B91C1C', '#9D174D', '#6D28D9', '#334155'];
function wsContrast(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const lin = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 1.05 / (0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2] + 0.05);
}
function wsHexFix(v) {
  const t = String(v || '').trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(t)) return '#' + t.split('').map(c => c + c).join('').toUpperCase();
  if (/^[0-9a-fA-F]{6}$/.test(t)) return '#' + t.toUpperCase();
  return null;
}
function WsColorInput({ value, onChange }) {
  const v = String(value || '');
  const ok = /^#[0-9a-fA-F]{6}$/.test(v);
  const fix = !ok && v ? wsHexFix(v) : null;
  const ratio = ok ? wsContrast(v) : null;
  const eye = typeof window.EyeDropper === 'function';
  const pick = async () => {
    try {
      const r = await new window.EyeDropper().open();
      const h = wsHexFix(r && r.sRGBHex);
      if (h) onChange(h);
    } catch (e) {
      /* cancelled */
    }
  };
  return html`<div className="wscolor-wrap">
      <div className="wscolor">
        <input type="color" value=${ok ? v : '#2B3993'} onInput=${e => onChange(e.target.value.toUpperCase())} aria-label="Pick the color" />
        <input value=${v} onInput=${e => onChange(e.target.value.trim())} onBlur=${() => fix && onChange(fix)} placeholder="#2B3993 (leave empty for the default)" aria-label="Color code" spellCheck="false" />
        ${eye && html`<button type="button" className="btn ghost sm" onClick=${pick} title="Pick a color from anywhere on the screen, such as the company's logo"><${Icon} n="target" />Pick</button>`}
        ${v && html`<button type="button" className="btn ghost sm" onClick=${() => onChange('')} title="Use the default color">Default</button>`}
      </div>
      <div className="wsswatches" role="group" aria-label="Suggested colors">${WS_SWATCHES.map(c => html`<button key=${c} type="button" className=${'wssw' + (v.toUpperCase() === c ? ' on' : '')} style=${{ background: c }} onClick=${() => onChange(c)} aria-label=${'Use ' + c} aria-pressed=${v.toUpperCase() === c} title=${c} />`)}</div>
      ${v && !ok ? html`<p className="small cxwarn" style=${{ margin: 0 }}>${fix ? 'This becomes ' + fix + ' when you leave the field.' : 'Use a color code like #2B3993 (# and six letters or digits).'}</p>` : null}
      ${ok ? html`<div className="wsprev small"><span className="wsprev-btn" style=${{ background: v }}>Button</span><span style=${{ color: v, fontWeight: 600 }}>Link text</span>${ratio < 4.5 ? html`<span className="cxwarn">White text on this color is hard to read (contrast ${ratio.toFixed(1)} to 1; aim for 4.5 or more). A darker shade works better.</span>` : html`<span className="muted">Contrast ${ratio.toFixed(1)} to 1 with white text: easy to read.</span>`}</div>` : null}
    </div>`;
}

function WsCreateModal({ d, onClose, onMade, signup, pilotDays }) {
  // v37.4: with a sign-up request, the form starts from what they sent and approves the request (ws_signup_decide)
  const [f, setF] = useState(() =>
    signup
      ? { name: signup.co, slug: signup.free || wsSlugOf(signup.co), adminName: signup.n, adminEmail: signup.e, preset: 'staffing', pilotDays: pilotDays || 30, color: '', tagline: '', addr: '', features: (signup.feats || []).slice() }
      : { name: '', slug: '', adminName: '', adminEmail: '', preset: 'staffing', pilotDays: 90, color: '', tagline: '', addr: '' }
  );
  const [slugTouched, setSlugTouched] = useState(!!signup);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k, v) => setF(x => ({ ...x, [k]: v, ...(k === 'name' && !slugTouched ? { slug: wsSlugOf(v) } : {}) }));
  const preset = (d.presets || []).find(p => p.k === f.preset);
  const submit = async e => {
    e && e.preventDefault();
    setErr('');
    if (f.name.trim().length < 2) return setErr("Give the company's name.");
    if (!/^[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])?$/.test(f.slug) || f.slug.length < 2) return setErr('The short name is 2 to 30 lowercase letters, numbers and hyphens.');
    if (f.adminName.trim().length < 2 || !/^\S+@\S+\.\S+$/.test(f.adminEmail.trim())) return setErr("Give the name and email of the company's first administrator.");
    if (signup && !(f.features || []).length) return setErr('Choose at least one part of the portal.');
    setBusy(true);
    try {
      if (signup) {
        const { preset, ...rest } = f;
        const r = await api('ws_signup_decide', { ...rest, id: signup.id, act: 'approve', name: f.name.trim(), adminName: f.adminName.trim(), adminEmail: f.adminEmail.trim(), pilotDays: +f.pilotDays || 30 });
        onMade(r.ws, r.mailed, r.req);
        return;
      }
      const r = await api('ws_create', { ...f, name: f.name.trim(), adminName: f.adminName.trim(), adminEmail: f.adminEmail.trim(), pilotDays: +f.pilotDays || 90 });
      onMade(r.row, r.mailed);
    } catch (x) {
      setErr(errText(x));
      setBusy(false);
    }
  };
  const other = signup && f.adminEmail.trim().toLowerCase() !== String(signup.e).toLowerCase();
  return html`<${Modal} title=${signup ? 'Approve: ' + signup.co : 'New workspace'} onClose=${onClose} wide foot=${html`<${Fragment}>
      <button className="btn ghost" onClick=${onClose}>Cancel</button>
      <button className="btn" onClick=${submit} disabled=${busy}>${busy ? 'Creating…' : signup ? 'Approve, create and email the setup link' : 'Create and email the setup link'}</button>
    <//>`}>
      <form className="form" onSubmit=${submit} noValidate>
        <div className="row2">
          <${Field} label="Company name"><input value=${f.name} onInput=${e => set('name', e.target.value)} placeholder="Acme Staffing" /><//>
          <${Field} label="Short name" hint=${'Its address: ' + d.base + (f.slug || 'acme') + '/'}>
            <input value=${f.slug} onInput=${e => {
              setSlugTouched(true);
              set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30));
            }} placeholder="acme" />
          <//>
        </div>
        <div className="row2">
          <${Field} label="First administrator's name"><input value=${f.adminName} onInput=${e => set('adminName', e.target.value)} /><//>
          <${Field} label="Their email" hint=${other ? signup.e + ' (who asked) is told it was approved and who has the setup link.' : 'The setup link goes here; it works once, for 14 days.'}><input type="email" value=${f.adminEmail} onInput=${e => set('adminEmail', e.target.value)} /><//>
        </div>
        ${
          signup
            ? html`<${Fragment}>
                <div className="fld"><span>Parts of the portal</span><span className="muted small">Ticked: what they asked for. Change it as you agree with them.</span></div>
                <${WsFeatureChecks} d=${d} value=${f.features || []} onChange=${v => set('features', v)} />
                <div className="row2">
                  <${Field} label="Free pilot" hint="Days until the pilot ends (you can change it later).">
                    <input type="number" min="1" max="365" value=${f.pilotDays} onInput=${e => set('pilotDays', e.target.value)} />
                  <//>
                  <div />
                </div>
              <//>`
            : html`<div className="row2">
                <${Field} label="Start with" hint=${preset ? preset.f.map(k => ((d.features || []).find(x => x.k === k) || {}).n || k).join(', ') : ''}>
                  <select value=${f.preset} onChange=${e => set('preset', e.target.value)}>
                    ${(d.presets || []).map(p => html`<option key=${p.k} value=${p.k}>${p.n}</option>`)}
                  </select>
                <//>
                <${Field} label="Free pilot" hint="Days until the pilot ends (you can change it later).">
                  <input type="number" min="1" max="365" value=${f.pilotDays} onInput=${e => set('pilotDays', e.target.value)} />
                <//>
              </div>`
        }
        <div className="row2">
          <${Field} label="Brand color (optional)"><${WsColorInput} value=${f.color} onChange=${v => set('color', v)} /><//>
          <${Field} label="Tagline (optional)"><input value=${f.tagline} maxLength="120" onInput=${e => set('tagline', e.target.value)} placeholder="IT staffing across the Midwest" /><//>
        </div>
        <${Field} label="Postal address (optional)" hint="Shown at the bottom of its emails; marketing emails need one."><input value=${f.addr} maxLength="200" onInput=${e => set('addr', e.target.value)} /><//>
        ${err && html`<p className="err" role="alert">${err}</p>`}
        <p className="muted small" style=${{ margin: 0 }}>The parts of the portal, the logo and the addresses can be changed afterwards. Until the company connects its own email, its emails go out through StratEdge's mail service under its own name, with replies to its administrator.</p>
      </form>
    <//>`;
}

function WsManageModal({ d, row, onClose, onRow, onGone }) {
  const toast = useToast();
  const [tab, setTab] = useState('overview');
  const [f, setF] = useState(() => ({
    name: row.name,
    contact: row.contact,
    until: (row.plan && row.plan.until) || '',
    notes: row.notes || '',
    shareAi: !!row.shareAi,
    features: [...row.features],
    color: row.brand.color || '',
    tagline: row.brand.tagline || '',
    addr: row.brand.addr || '',
    sub: !!row.sub,
    hosts: row.hosts.join('\n'),
    primary: row.primary || 'path',
  }));
  const [busy, setBusy] = useState('');
  const [runOut, setRunOut] = useState(null);
  const [inv, setInv] = useState(null); // { name, email } when sending the setup link to someone else
  const [del, setDel] = useState('');
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const act = async (what, route, body, done) => {
    setBusy(what);
    try {
      const r = await api(route, { slug: row.slug, ...body }, route === 'ws_run' ? { timeout: 200000 } : undefined);
      if (r && r.row) onRow(r.row);
      done && done(r);
    } catch (x) {
      toast(errText(x), true);
    }
    setBusy('');
  };
  const save = (fields, msg) =>
    act('save', 'ws_save', fields, () => toast(msg || 'Saved.'));
  const check = (key, body) =>
    act('check:' + key, 'ws_check', body, r => {
      onRow({ ...row, checks: { ...(row.checks || {}), [key]: r } });
      toast(r.msg, !r.ok);
    });
  const hostList = f.hosts
    .split(/[\s,]+/)
    .map(h => h.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, ''))
    .filter(Boolean);
  const checkLine = key => {
    const c = (row.checks || {})[key];
    return c ? html`<div className=${'small ' + (c.ok ? 'okline' : 'err')} style=${{ marginTop: 4 }}>${c.ok ? '✓ ' : ''}${c.msg} <span className="muted">(${fmtTs(c.at)})</span></div>` : null;
  };
  const logo = async e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const fd = new FormData();
    fd.append('slug', row.slug);
    fd.append('file', file);
    setBusy('logo');
    try {
      const r = await upload('ws_logo_save', fd);
      if (r && r.row) onRow(r.row);
      toast('Logo saved.');
    } catch (x) {
      toast(errText(x), true);
    }
    setBusy('');
  };
  const st = WS_STATUS[row.status] || [row.status, ''];
  const u = row.usage || {};
  const tabs = [
    ['overview', 'Overview'],
    ['parts', 'Parts of the portal'],
    ['brand', 'Name & brand'],
    ['addr', 'Addresses'],
    ['remove', 'Delete'],
  ];
  let body;
  if (tab === 'overview')
    body = html`<div className="stack">
        <div className="wskv">
          <div><span className="muted small">Status</span><b><${Chip} s=${st[1]}>${st[0]}<//></b></div>
          <div><span className="muted small">Address</span><b><a href=${row.url} target="_blank" rel="noopener">${row.url.replace(/^https?:\/\//, '')}</a></b></div>
          <div><span className="muted small">Accounts</span><b>${u.users || 0} (${u.admins || 0} admin${u.admins === 1 ? '' : 's'})</b></div>
          <div><span className="muted small">Candidates</span><b>${u.people || 0}</b></div>
          <div><span className="muted small">Storage</span><b>${u.mb || 0} MB</b></div>
          <div><span className="muted small">Last sign-in</span><b>${wsWhen(u.last)}</b></div>
          <div><span className="muted small">Scheduled work</span><b>${u.cron ? fmtTs(u.cron) : 'not yet'}</b></div>
          <div><span className="muted small">Created</span><b>${fmtTs(row.created)}${row.by ? ' by ' + row.by : ''}</b></div>
          ${row.signup && html`<div><span className="muted small">Came from</span><b>A sign-up request on the website</b></div>`}
        </div>
        ${u.err && html`<p className="note amber"><span>${u.err}</span></p>`}
        ${(u.cronErr || []).length > 0 && html`<p className="note amber"><span><b>Its last scheduled run reported:</b> ${u.cronErr.join(' · ')}</span></p>`}
        ${
          row.setupDone
            ? html`<p className="muted small" style=${{ margin: 0 }}>Set up by its first administrator, ${row.admin.name || row.admin.email}. They add their own team from their Admin portal.</p>`
            : html`<div className="panel soft" style=${{ padding: 14 }}>
                <b>Waiting for ${row.admin.name || 'the first administrator'} (${row.admin.email}) to set it up.</b>
                <p className="muted small" style=${{ margin: '6px 0 10px' }}>${row.setupUrl ? 'The setup link works until ' + fmtTs(row.setupExp) + ', once.' : 'The setup link has expired.'}</p>
                <div className="actions">
                  ${row.setupUrl && html`<button className="btn ghost sm" onClick=${() => copyText(toast, row.setupUrl)}><${Icon} n="link" />Copy the setup link</button>`}
                  <button className="btn sm" disabled=${busy === 'invite'} onClick=${() => act('invite', 'ws_invite', {}, r => toast(r.mailed ? 'A new setup link went to ' + r.row.admin.email + '.' : 'A new link was made but the email did not go out: copy it here.', !r.mailed))}>Send a new setup link</button>
                  <button className="btn ghost sm" onClick=${() => setInv(inv ? null : { name: '', email: '' })}>Send it to someone else…</button>
                </div>
                ${
                  inv &&
                  html`<div className="row2" style=${{ marginTop: 10 }}>
                      <${Field} label="Name"><input value=${inv.name} onInput=${e => setInv({ ...inv, name: e.target.value })} /><//>
                      <${Field} label="Email"><input type="email" value=${inv.email} onInput=${e => setInv({ ...inv, email: e.target.value })} /><//>
                      <div className="actions"><button className="btn sm" disabled=${busy === 'invite'} onClick=${() => act('invite', 'ws_invite', { adminName: inv.name, adminEmail: inv.email }, r => {
                        setInv(null);
                        toast(r.mailed ? 'The setup link went to ' + r.row.admin.email + '.' : 'The email did not go out: copy the link here.', !r.mailed);
                      })}>Send</button></div>
                    </div>`
                }
              </div>`
        }
        <div className="row2">
          <${Field} label="Contact email" hint="Receives its staff emails (new applications, daily reports) and the replies to emails sent for it."><input type="email" value=${f.contact} onInput=${e => set('contact', e.target.value)} /><//>
          <${Field} label="Free pilot until"><input type="date" value=${f.until} onInput=${e => set('until', e.target.value)} /><//>
        </div>
        <label className="check"><input type="checkbox" checked=${f.shareAi} onChange=${e => set('shareAi', e.target.checked)} /><span>Let it use StratEdge's AI connection (the assistant, resume tailoring, screening). Off: its AI features stay off.</span></label>
        <${Field} label="Notes (only StratEdge's administrators see these)"><textarea rows="2" value=${f.notes} onInput=${e => set('notes', e.target.value)} /><//>
        <div className="actions">
          <button className="btn" disabled=${busy === 'save'} onClick=${() => save({ contact: f.contact, until: f.until, notes: f.notes, shareAi: f.shareAi ? 1 : 0 })}>Save</button>
          <button className="btn ghost" disabled=${busy === 'run' || row.status !== 'active'} onClick=${() => act('run', 'ws_run', {}, r => setRunOut(r))}>${busy === 'run' ? 'Running…' : 'Run its scheduled work now'}</button>
          ${
            row.status === 'active'
              ? html`<button className="btn ghost" disabled=${busy === 'status'} onClick=${() => act('status', 'ws_status', { st: 'paused' }, () => toast('Paused. Its portal shows "paused" and answers nothing else until you switch it back on.'))}>Pause it</button>`
              : html`<button className="btn ghost" disabled=${busy === 'status'} onClick=${() => act('status', 'ws_status', { st: 'active' }, () => toast('Switched back on.'))}>Switch it back on</button>`
          }
        </div>
        ${
          runOut &&
          html`<div className=${'note ' + (runOut.ok ? 'ok' : 'amber')}><span>${runOut.ok ? (runOut.lines || []).length + ' task lines' + ((runOut.lines || []).length ? ': ' + runOut.lines.slice(-4).join(' · ') : '') : 'It did not run: ' + runOut.err}</span></div>`
        }
      </div>`;
  else if (tab === 'parts')
    body = html`<div className="stack">
        <p className="muted small" style=${{ margin: 0 }}>The parts its people see. A part switched off disappears from its menus and its server answers no requests for it; its records stay and come back when switched on again. Sign-in, people, documents, settings and security are always there.</p>
        <${WsFeatureChecks} d=${d} value=${f.features} onChange=${v => set('features', v)} />
        <div className="actions"><button className="btn" disabled=${busy === 'save'} onClick=${() => save({ features: f.features }, 'The parts of its portal are saved.')}>Save</button></div>
      </div>`;
  else if (tab === 'brand')
    body = html`<div className="stack">
        <div className="wsbrandrow">
          <div className="wslogobox" style=${f.color ? { borderColor: f.color } : null}>
            ${row.brand.logo ? html`<img src=${'w/' + row.slug + '/api/index.php?r=ws_logo&v=' + (row.brand.logoAt || 0)} alt="" />` : html`<span className="muted small">No logo</span>`}
          </div>
          <div>
            <label className="btn ghost sm"><input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange=${logo} />${busy === 'logo' ? 'Saving…' : row.brand.logo ? 'Change the logo' : 'Add a logo'}</label>
            <p className="muted small" style=${{ margin: '6px 0 0' }}>PNG, JPEG or WebP up to 1 MB, at least 32 pixels. It shows on its website, in its portal and as the app icon.</p>
          </div>
        </div>
        <div className="row2">
          <${Field} label="Company name"><input value=${f.name} onInput=${e => set('name', e.target.value)} /><//>
          <${Field} label="Brand color"><${WsColorInput} value=${f.color} onChange=${v => set('color', v)} /><//>
        </div>
        <${Field} label="Tagline"><input value=${f.tagline} maxLength="120" onInput=${e => set('tagline', e.target.value)} /><//>
        <${Field} label="Postal address" hint="Shown at the bottom of its emails and pages; marketing emails need one."><input value=${f.addr} maxLength="200" onInput=${e => set('addr', e.target.value)} /><//>
        <div className="actions"><button className="btn" disabled=${busy === 'save'} onClick=${() => save({ name: f.name, color: f.color, tagline: f.tagline, addr: f.addr }, 'Name and brand saved.')}>Save</button></div>
      </div>`;
  else if (tab === 'addr')
    body = html`<div className="stack">
        <div className="panel soft" style=${{ padding: 14 }}>
          <b>${row.pathUrl}</b>
          <p className="muted small" style=${{ margin: '4px 0 8px' }}>Works at once, with nothing to set up.</p>
          <button className="btn ghost sm" disabled=${busy === 'check:path'} onClick=${() => check('path', { what: 'path' })}>Check</button>
          ${checkLine('path')}
        </div>
        <div className="panel soft" style=${{ padding: 14 }}>
          <label className="check"><input type="checkbox" checked=${f.sub} onChange=${e => set('sub', e.target.checked)} /><span><b>${row.subUrl || 'Its own subdomain'}</b></span></label>
          <p className="muted small" style=${{ margin: '4px 0 8px' }}>Needs the wildcard subdomain on the hosting once for all workspaces (cPanel › Domains › Create a new domain: *.${d.main}, document root the site's folder) and a certificate that covers it (README, "Workspaces"). Switch it on, save, then check.</p>
          <button className="btn ghost sm" disabled=${busy === 'check:sub' || !row.sub} onClick=${() => check('sub', { what: 'sub' })}>Check</button>
          ${checkLine('sub')}
        </div>
        <div className="panel soft" style=${{ padding: 14 }}>
          <${Field} label="The company's own addresses (one per line, up to 5)" hint=${'For example portal.theircompany.com. Their DNS points it here (a CNAME to ' + d.main + ' or an A record to this server), and the address is added on the hosting sharing the site’s folder; AutoSSL then gives it a certificate.'}>
            <textarea rows="2" value=${f.hosts} onInput=${e => set('hosts', e.target.value)} placeholder="portal.theircompany.com" />
          <//>
          <div className="actions">
            ${row.hosts.map(h => html`<button key=${h} className="btn ghost sm" disabled=${busy === 'check:' + h} onClick=${() => check(h, { what: 'host', host: h })}>Check ${h}</button>`)}
          </div>
          ${row.hosts.map(h => html`<div key=${h}>${checkLine(h)}</div>`)}
        </div>
        <${Field} label="The address used in its emails and links">
          <select value=${f.primary} onChange=${e => set('primary', e.target.value)}>
            <option value="path">${row.pathUrl}</option>
            ${f.sub && row.subUrl && html`<option value="sub">${row.subUrl}</option>`}
            ${hostList.map(h => html`<option key=${h} value=${h}>https://${h}/</option>`)}
          </select>
        <//>
        <div className="actions"><button className="btn" disabled=${busy === 'save'} onClick=${() => save({ sub: f.sub ? 1 : 0, hosts: hostList, primary: f.primary }, 'Addresses saved.')}>Save</button></div>
      </div>`;
  else
    body = html`<div className="stack">
        <p>Deleting ${row.name} takes its portal offline at every address and removes it from this list. Its folder (database, files, key) moves to storage/ws/.trash on the server, so nothing is erased; restoring it is a job for the hosting's file manager.</p>
        <${Field} label=${'Type ' + row.slug + ' to confirm'}><input value=${del} onInput=${e => setDel(e.target.value.trim())} autoComplete="off" /><//>
        <div className="actions">
          <button className="btn danger" disabled=${del !== row.slug || busy === 'delete'} onClick=${() => act('delete', 'ws_delete', { confirm: del }, r => {
            toast('Deleted. Its folder was kept as ' + r.kept + '.');
            onGone(row.slug);
          })}>Delete the workspace</button>
        </div>
      </div>`;
  return html`<${Modal} title=${row.name} onClose=${onClose} wide>
      <div className="tabs" role="tablist">
        ${tabs.map(([k, n]) => html`<button key=${k} type="button" role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${n}</button>`)}
      </div>
      ${body}
    <//>`;
}

/* ---------- v37.4 sign-up requests: the public page's settings, the requests and their review ----------
   Companies ask on #/get-portal (wsjoin.js) and confirm their email; here an administrator approves (the same
   "New workspace" form, filled in from the request) or declines. Routes ws_signups, ws_signup_cfg, ws_signup_decide. */
const WSJ_ST = { new: ['Waiting for review', 'amber'], unverified: ['Email not confirmed', ''], approved: ['Approved', 'ok'], declined: ['Declined', 'red'] };
const WSJ_MODE = [
  ['off', 'Off', 'The page says portals are by invitation; nothing can be sent.'],
  ['review', 'Review each request', 'People confirm their email address, then an administrator approves or declines. Administrators get a task (and an email).'],
  ['auto', 'Approve automatically', 'A portal is made as soon as they confirm their email, with the parts they asked for within the choice below. Past the daily limit, requests wait for review.'],
];
const wsjFeatNames = (d, ks) => (ks || []).map(k => ((d.features || []).find(x => x.k === k) || {}).n || k).join(', ') || '—';

function WsSignups({ d, q, onWs, onOpenWs }) {
  const toast = useToast();
  const [s, setS] = useState(null);
  const [err, setErr] = useState(null);
  const [f, setF] = useState(null);
  const [view, setView] = useState('new');
  const [open, setOpen] = useState(null); // request id
  const [approve, setApprove] = useState(null); // the request being approved
  const [busy, setBusy] = useState('');
  const load = () =>
    api('ws_signups', {}).then(
      r => {
        setS(r);
        setF(r.cfg);
        setErr(null);
        return r;
      },
      e => {
        setErr(e);
        return null;
      }
    );
  useEffect(() => {
    load().then(r => {
      const x = r && q && q.req ? r.rows.find(y => y.id === q.req) : null;
      if (x) {
        setView(x.st);
        setOpen(x.id);
      }
    });
  }, [q && q.req]);
  if (err) return html`<${LoadError} error=${err} onRetry=${load} />`;
  if (!s || !f) return html`<${Spinner} label="Loading the requests…" />`;
  const rows = s.rows || [];
  const counts = list => ({ new: list.filter(y => y.st === 'new').length, unverified: list.filter(y => y.st === 'unverified').length });
  const putReq = r => {
    const next = rows.map(y => (y.id === r.id ? { ...r, hints: y.hints } : y));
    setS(x => ({ ...x, rows: next }));
    onWs(null, counts(next));
  };
  const dropReq = id => {
    const next = rows.filter(y => y.id !== id);
    setS(x => ({ ...x, rows: next }));
    onWs(null, counts(next));
  };
  const c = s.cfg;
  const dirty = ['mode', 'pilotDays', 'preset', 'workOnly', 'autoMax', 'notify'].some(k => String(f[k]) !== String(c[k]));
  const saveCfg = async () => {
    setBusy('cfg');
    try {
      const r = await api('ws_signup_cfg', { mode: f.mode, preset: f.preset, pilotDays: +f.pilotDays || 30, autoMax: +f.autoMax || 5, workOnly: f.workOnly ? 1 : 0, notify: f.notify ? 1 : 0 });
      setS(x => ({ ...x, cfg: r.cfg }));
      setF(r.cfg);
      onWs(null, { mode: r.cfg.mode });
      toast(r.cfg.mode === 'off' ? 'Saved. The page is closed: it says portals are by invitation.' : r.cfg.mode === 'auto' ? 'Saved. Confirmed requests now get a portal at once.' : 'Saved. The page takes requests for you to review.');
    } catch (x) {
      if (!x || x.code !== 'declined') toast(errText(x), true);
    }
    setBusy('');
  };
  const list = rows.filter(r => view === 'all' || r.st === view);
  const row = open ? rows.find(r => r.id === open) : null;
  const n = k => rows.filter(r => r.st === k).length || null;
  return html`<div className="stack wsjadmin">
      <section className="panel stack" style=${{ gap: 12 }}>
        <div className="ph-row">
          <div>
            <h2 className="ph">The sign-up page</h2>
            <p className="muted small" style=${{ margin: '4px 0 0' }}>Companies ask for their own portal at <a href=${s.link} target="_blank" rel="noopener">${s.link.replace(/^https?:\/\//, '')}</a>. It is not in the website's menu: share the link where you want companies to find it.</p>
          </div>
          <div className="actions"><button className="btn ghost sm" onClick=${() => copyText(toast, s.link)}><${Icon} n="link" />Copy the link</button></div>
        </div>
        <div className="wsjmode" role="radiogroup" aria-label="How the page works">
          ${WSJ_MODE.map(
            ([k, nm, h]) => html`<label key=${k} className="check">
                <input type="radio" name="wsjmode" value=${k} checked=${f.mode === k} onChange=${() => setF({ ...f, mode: k })} />
                <span><b>${nm}</b><span className="muted small" style=${{ display: 'block' }}>${h}</span></span>
              </label>`
          )}
        </div>
        <div className="form"><div className="row3">
          <${Field} label="Free pilot (days)"><input type="number" min="1" max="365" value=${f.pilotDays} onInput=${e => setF({ ...f, pilotDays: e.target.value })} /><//>
          <${Field} label="Automatic portals may have" hint="What they asked for, within these parts.">
            <select value=${f.preset} onChange=${e => setF({ ...f, preset: e.target.value })} disabled=${f.mode !== 'auto'}>
              ${(s.presets || []).map(p => html`<option key=${p.k} value=${p.k}>${p.n}</option>`)}
            </select>
          <//>
          <${Field} label="Automatic portals a day" hint=${'Made in the last 24 hours: ' + (s.autoToday || 0) + '.'}><input type="number" min="1" max="50" value=${f.autoMax} onInput=${e => setF({ ...f, autoMax: e.target.value })} disabled=${f.mode !== 'auto'} /><//>
        </div></div>
        <label className="check"><input type="checkbox" checked=${!!f.workOnly} onChange=${e => setF({ ...f, workOnly: e.target.checked })} /><span>Work email addresses only (no Gmail, Outlook, Yahoo or other personal mailboxes)</span></label>
        <label className="check"><input type="checkbox" checked=${!!f.notify} onChange=${e => setF({ ...f, notify: e.target.checked })} /><span>Email the administrators about new requests (they get a task either way)</span></label>
        ${f.mode === 'auto' && c.mode !== 'auto' && html`<p className="note amber small" style=${{ margin: 0 }}><span>Anyone who confirms a work email address will get a portal on this site without anyone checking first. You confirm it's you when you save.</span></p>`}
        <div className="actions"><button className="btn" disabled=${busy === 'cfg' || !dirty} onClick=${saveCfg}>${busy === 'cfg' ? 'Saving…' : 'Save'}</button></div>
      </section>
      <${KitTabs} tabs=${[['new', 'Waiting for review', n('new')], ['unverified', 'Email not confirmed', n('unverified')], ['approved', 'Approved', null], ['declined', 'Declined', null], ['all', 'All', null]]} tab=${view} onTab=${setView} />
      <section className="panel" style=${{ padding: '6px 8px' }}>
        ${
          list.length
            ? html`<div className="tblwrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Company</th>
                      <th>Person</th>
                      <th>Wants</th>
                      <th>Asked</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    ${list.map(r => {
                      const st = WSJ_ST[r.st] || [r.st, ''];
                      return html`<tr key=${r.id} className="click" tabIndex="0" onClick=${() => setOpen(r.id)} onKeyDown=${e => e.key === 'Enter' && setOpen(r.id)}>
                        <td><b style=${{ fontWeight: 600 }}>${r.co}</b><div className="muted small">${[(s.sizes || {})[r.size] || r.size, (s.countries || {})[r.country] || r.country, r.web].filter(Boolean).join(' · ')}</div></td>
                        <td>${r.n}<div className="muted small">${r.e}${r.role ? ' · ' + r.role : ''}</div></td>
                        <td className="small">${wsjFeatNames(d, r.feats)}</td>
                        <td className="nw small">${fmtTs(r.vAt || r.at)}</td>
                        <td><${Chip} s=${st[1]}>${st[0]}<//>${(r.hints || []).length ? html`<div className="muted small" style=${{ marginTop: 4 }}>${r.hints.length} note${r.hints.length === 1 ? '' : 's'}</div>` : null}</td>
                        <td className="r"><button className="btn ghost sm" onClick=${e => {
                          e.stopPropagation();
                          setOpen(r.id);
                        }}>Review</button></td>
                      </tr>`;
                    })}
                  </tbody>
                </table>
              </div>`
            : html`<${Empty} title=${view === 'new' ? 'Nothing waiting for review' : 'Nothing here'}>${c.mode === 'off' ? 'The sign-up page is off: choose "Review each request" above to take requests.' : 'Requests appear under "Waiting for review" once people confirm their email address.'}<//>`
        }
      </section>
      ${
        row &&
        !approve &&
        html`<${WsSignupModal} d=${d} row=${row} s=${s} onClose=${() => setOpen(null)} onApprove=${() => setApprove(row)} onReq=${putReq} onGone=${id => {
          dropReq(id);
          setOpen(null);
        }} onOpenWs=${onOpenWs} />`
      }
      ${
        approve &&
        html`<${WsCreateModal} d=${d} signup=${approve} pilotDays=${c.pilotDays} onClose=${() => setApprove(null)} onMade=${(ws, mailed, req) => {
          putReq(req);
          onWs(ws);
          setApprove(null);
          setOpen(null);
          toast(mailed ? 'Approved. ' + ws.name + ' is made and the setup link went to ' + ws.admin.email + '.' : 'Approved and made, but the email did not go out: copy the setup link from the workspace.', !mailed);
        }} />`
      }
    </div>`;
}

function WsSignupModal({ d, row, s, onClose, onApprove, onReq, onGone, onOpenWs }) {
  const toast = useToast();
  const [dec, setDec] = useState(null); // { reason, tell } while declining
  const [del, setDel] = useState(false);
  const [busy, setBusy] = useState('');
  const st = WSJ_ST[row.st] || [row.st, ''];
  const done = row.dec;
  const act = async (what, body, then) => {
    setBusy(what);
    try {
      then(await api('ws_signup_decide', { id: row.id, ...body }));
    } catch (x) {
      toast(errText(x), true);
    }
    setBusy('');
  };
  const open = row.st === 'new' || row.st === 'unverified';
  const foot = html`<${Fragment}>
      <button className="btn ghost" disabled=${del} onClick=${() => {
        setDel(true);
        setDec(null);
      }}>Delete…</button>
      ${open && html`<button className="btn ghost" disabled=${!!dec} onClick=${() => {
        setDec({ reason: '', tell: row.st === 'new' });
        setDel(false);
      }}>Decline…</button>`}
      ${row.st === 'new' ? html`<button className="btn" onClick=${onApprove}>Approve…</button>` : html`<button className="btn" onClick=${onClose}>Close</button>`}
    <//>`;
  return html`<${Modal} title=${row.co} onClose=${onClose} wide foot=${foot}>
      <div className="stack">
        <div className="wskv">
          <div><span className="muted small">Status</span><b><${Chip} s=${st[1]}>${st[0]}<//></b></div>
          <div><span className="muted small">Person</span><b>${row.n}${row.role ? ', ' + row.role : ''}</b></div>
          <div><span className="muted small">Email</span><b><a href=${'mailto:' + row.e}>${row.e}</a></b></div>
          <div><span className="muted small">Phone</span><b>${row.ph || '—'}</b></div>
          <div><span className="muted small">Website</span><b>${row.web ? html`<a href=${'https://' + row.web} target="_blank" rel="noopener noreferrer">${row.web}</a>` : '—'}</b></div>
          <div><span className="muted small">Size</span><b>${(s.sizes || {})[row.size] || row.size}</b></div>
          <div><span className="muted small">Where</span><b>${(s.countries || {})[row.country] || row.country}</b></div>
          <div><span className="muted small">Address they would like</span><b>${row.slug ? '/w/' + row.slug + '/' : '—'}</b></div>
          <div><span className="muted small">Asked</span><b>${fmtTs(row.at)}</b></div>
          <div><span className="muted small">Email confirmed</span><b>${row.vAt ? fmtTs(row.vAt) : 'Not yet'}</b></div>
        </div>
        <div><span className="lbl">They want</span><p style=${{ margin: '4px 0 0' }}>${wsjFeatNames(d, row.feats)}</p></div>
        ${row.msg && html`<div className="panel soft" style=${{ padding: 12 }}><span className="lbl">Their message</span><p className="trwrap" style=${{ margin: '4px 0 0' }}>${row.msg}</p></div>`}
        ${(row.hints || []).length > 0 && html`<div className="note amber"><span><b>Worth knowing</b><ul className="wsjhints">${row.hints.map((h, i) => html`<li key=${i}>${h}</li>`)}</ul></span></div>`}
        ${row.st === 'unverified' && html`<p className="muted small" style=${{ margin: 0 }}>They have not confirmed their email address yet (${row.sent || 1} confirmation email${row.sent === 1 ? '' : 's'} sent; the link works for 48 hours). Approve it once they do. Requests never confirmed are removed after 7 days.</p>`}
        ${row.st === 'unverified' && row.mailFail && html`<p className="note amber small" style=${{ margin: 0 }}><span>The confirmation email could not be sent: check the email settings, then ask them to send the form again.</span></p>`}
        ${
          done &&
          html`<p className=${'note small ' + (row.st === 'approved' ? 'ok' : '')} style=${{ margin: 0 }}><span>${row.st === 'approved' ? 'Approved' : 'Declined'} by ${done.byn || 'an administrator'} on ${fmtTs(done.at)}${done.slug ? ': the workspace ' + done.slug : ''}${done.reason ? '. Reason: ' + done.reason : ''}${row.st === 'declined' ? (done.told ? ' (emailed to them).' : ' (not emailed).') : '.'}</span></p>`
        }
        ${done && done.slug && (d.rows || []).some(w => w.slug === done.slug) && html`<div className="actions"><button className="btn ghost sm" onClick=${() => onOpenWs(done.slug)}>Open the workspace</button></div>`}
        ${
          dec &&
          html`<div className="panel soft stack" style=${{ padding: 14, gap: 10 }}>
            <${Field} label="Reason (optional)" hint=${dec.tell ? 'It goes in the email to them.' : 'Kept here only.'}><textarea rows="3" maxLength="1000" value=${dec.reason} onInput=${e => setDec({ ...dec, reason: e.target.value })} /><//>
            ${row.st === 'new' ? html`<label className="check"><input type="checkbox" checked=${dec.tell} onChange=${e => setDec({ ...dec, tell: e.target.checked })} /><span>Email ${row.e} the decision</span></label>` : html`<p className="muted small" style=${{ margin: 0 }}>Their address is not confirmed, so no email goes out.</p>`}
            <div className="actions">
              <button className="btn danger" disabled=${busy === 'decline'} onClick=${() => act('decline', { act: 'decline', reason: dec.reason, tell: dec.tell ? 1 : 0 }, r => {
                onReq(r.req);
                setDec(null);
                toast(r.told ? 'Declined, and they were told by email.' : 'Declined.');
              })}>Decline the request</button>
              <button className="btn ghost" onClick=${() => setDec(null)}>Cancel</button>
            </div>
          </div>`
        }
        ${
          del &&
          html`<div className="panel soft stack" style=${{ padding: 14, gap: 10 }}>
            <p style=${{ margin: 0 }}>Delete this request for good? Use it for spam. To say no to a company, decline instead.</p>
            <div className="actions">
              <button className="btn danger" disabled=${busy === 'delete'} onClick=${() => act('delete', { act: 'delete' }, () => {
                toast('Request deleted.');
                onGone(row.id);
              })}>Delete it</button>
              <button className="btn ghost" onClick=${() => setDel(false)}>Cancel</button>
            </div>
          </div>`
        }
        ${
          (row.log || []).length > 0 &&
          html`<details className="wsjlog">
            <summary className="small">History (${row.log.length})</summary>
            <ul className="list">${row.log.slice().reverse().map((l, i) => html`<li key=${i}><div><div className="t">${l.ev}</div><div className="m">${l.who} · ${fmtTs(l.t)}</div></div></li>`)}</ul>
          </details>`
        }
      </div>
    <//>`;
}
