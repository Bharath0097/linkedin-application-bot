/* ================= Email: mass email, contacts, sent log and Gmail settings ================= */
const MAIL_KIND = {
  mass: 'Mass email',
  mass_test: 'Test (mass email)',
  mail_test: 'Connection test',
  inv_send: 'Invoice',
  sig_create: 'Signature request',
  sig_remind: 'Signature reminder',
  sig_sign: 'Signed document',
  sig_decline: 'Signature declined',
  sig_cancel: 'Signature cancelled',
  pay_email: 'Paystub',
  eod_notify: 'Daily report',
  ats_email: 'Candidate email',
  job_send: 'Job shared',
  public_share: 'Job shared',
  public_contact: 'Website inquiry',
  jobs_apply: 'Job application',
  cron: 'Scheduled',
  public_apply: 'Job application',
};
const CAMP_ST = {
  queued: 'Queued',
  sending: 'Sending',
  done: 'Sent',
  paused: 'Paused',
  cancelled: 'Cancelled',
};
const campChip = s =>
  s === 'done' ? 'ok' : s === 'sending' ? 'new' : s === 'queued' ? 'amber' : s === 'cancelled' ? 'red' : '';
const MERGE_FIELDS = ['{first_name}', '{name}', '{company}', '{title}', '{signature}']; // v69: {signature} = the sender's
const PROVIDERS = [
  ['gmail', 'Gmail', 'A personal @gmail.com address. Up to 500 emails a day.'],
  ['workspace', 'Google Workspace', 'Your company address hosted by Google. Up to 2,000 emails a day.'],
  ['m365', 'Microsoft 365 (Outlook)', 'Your company mailbox at Microsoft, connected with Microsoft: no password is kept. Exchange Online allows up to 10,000 recipients a day.'],
  ['postal', 'Your own mail server (Postal)', 'Free, open-source software on a server you rent: no per-email fees and no daily cap. Needs a server that may send on port 25, and a warm-up.'],
  ['ses_api', 'Amazon SES (API)', 'About $0.10 per 1,000 emails, many sent at once; bounces and spam complaints come back automatically.'],
  ['mailgun', 'Mailgun', 'High-volume sending through the Mailgun API with no daily cap from the site; replies can land in the portal Inbox.'],
  ['sendgrid', 'SendGrid', 'Twilio SendGrid over SMTP with an API key.'],
  ['brevo', 'Brevo', 'Brevo (formerly Sendinblue) SMTP relay.'],
  ['ses', 'Amazon SES (SMTP)', 'Amazon SES SMTP credentials, US East region.'],
  ['host', 'Web host email', 'The mailbox from your hosting account (cPanel), e.g. info@yourdomain.com.'],
  ['smtp', 'Other SMTP service', 'Zoho or any other SMTP login. For a Microsoft 365 mailbox choose Microsoft 365 above.'],
  ['php', 'Basic server mail', 'PHP mail() on the server. No login, but often lands in spam.'],
];
const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many || one + 's'}`;
// v37.5: where replies to a distribution list's email go ('' = the person sending)
const dlReplyOf = l => (!l ? '' : l.reply === 'list' ? l.addr || '' : l.reply === 'fixed' ? l.replyTo || '' : '');

/* CSV reading for contact imports: quoted fields, commas, semicolons or tabs, Excel's byte-order mark. */
function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '');
  const head = text.slice(0, text.indexOf('\n') > 0 ? text.indexOf('\n') : text.length);
  const sep = [',', ';', '\t'].sort((a, b) => head.split(b).length - head.split(a).length)[0];
  const rows = [];
  let row = [],
    field = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}
const CSV_COLS = {
  email: [
    'email',
    'e-mail',
    'email address',
    'e-mail address',
    'mail',
    'work email',
    'email id',
    'primary email',
  ],
  name: ['name', 'full name', 'contact name', 'candidate name', 'consultant name', 'contact'],
  first: ['first name', 'firstname', 'first', 'given name'],
  last: ['last name', 'lastname', 'last', 'surname', 'family name'],
  company: [
    'company',
    'company name',
    'organization',
    'organisation',
    'employer',
    'vendor',
    'client',
    'account',
  ],
  title: ['title', 'job title', 'position', 'designation', 'role'],
  phone: ['phone', 'phone number', 'mobile', 'mobile number', 'cell', 'contact number', 'telephone'],
  city: ['city', 'location', 'city/state', 'current location', 'state'],
  tags: ['tags', 'tag', 'labels', 'list', 'group', 'segment'],
  notes: ['notes', 'note', 'comments', 'skills'],
};
/* Works out which column holds what; falls back to the column that looks most like email addresses. */
function csvToContacts(rows) {
  if (!rows.length) return { list: [], cols: {} };
  const head = rows[0].map(h => h.trim().toLowerCase());
  const cols = {};
  Object.entries(CSV_COLS).forEach(([k, names]) => {
    const i = head.findIndex(h => names.includes(h));
    if (i >= 0) cols[k] = i;
  });
  let body = rows.slice(1);
  if (cols.email == null) {
    const score = head.map((_, i) => rows.slice(0, 50).filter(r => /\S+@\S+\.\S+/.test(r[i] || '')).length);
    const best = score.indexOf(Math.max(...score));
    if (score[best] > 0) {
      cols.email = best;
      if (/\S+@\S+\.\S+/.test(rows[0][best] || '')) body = rows;
    }
  }
  if (cols.email == null) return { list: [], cols };
  const get = (r, k) => (cols[k] != null ? (r[cols[k]] || '').trim() : '');
  const list = body
    .map(r => ({
      email: get(r, 'email').toLowerCase(),
      name: get(r, 'name') || [get(r, 'first'), get(r, 'last')].filter(Boolean).join(' '),
      company: get(r, 'company'),
      title: get(r, 'title'),
      phone: get(r, 'phone'),
      city: get(r, 'city'),
      tags: get(r, 'tags'),
      notes: get(r, 'notes'),
    }))
    .filter(c => /^\S+@\S+\.\S+$/.test(c.email));
  return { list, cols };
}

function mailAreaHref(area) {
  const h = window.location.hash || '';
  const m = h.match(/^#\/portal\/(admin|hr|acct|mgr)\//);
  return m ? `#/portal/${m[1]}/${area}` : `#/portal/rec/${area}`;
}
function mailGoArea(area) {
  window.location.hash = mailAreaHref(area);
}

/* v55: the address book/inbox are separate from validation, cleanup and campaigns. */
function MailPage({ q }) {
  const P = usePortal();
  const owner = P.roleName === 'admin';
  const staff = P.isAdmin;
  const tabs = [
    ['contacts', 'Contacts'],
    ['lists', 'Lists'],
    ...(staff ? [['log', 'Sent log']] : []),
    ['inbox', 'Inbox'],
    ['deliv', 'Deliverability'],
    ...(owner ? [['settings', 'Sending setup']] : []),
  ];
  const [tab, setTab] = useState(tabs.some(t => t[0] === q.tab) ? q.tab : 'contacts');
  useEffect(() => {
    if (q.tab && tabs.some(t => t[0] === q.tab)) setTab(q.tab);
    // old bookmarks from before v55 land on the new dedicated pages
    if (q.tab === 'campaigns' || q.tab === 'compose') mailGoArea('mail-campaigns');
    if (q.tab === 'check') mailGoArea('mail-validation');
  }, [q.tab]);
  const [st, setSt] = useState(null);
  const loadStatus = () => api('mail_status').then(setSt).catch(() => setSt(null));
  useEffect(() => { loadStatus(); }, [tab]);
  const sendContacts = list => {
    try { sessionStorage.setItem('se_mail_picked', JSON.stringify(list || [])); } catch (_) {}
    mailGoArea('mail-campaigns');
  };
  const validateContacts = list => {
    try {
      const rows = Array.isArray(list) ? list.filter(x => x && x.email).map(x => ({ email: x.email, name: x.name || '' })) : [];
      if (rows.length) sessionStorage.setItem('se_mail_validate_selected', JSON.stringify(rows));
      else sessionStorage.removeItem('se_mail_validate_selected');
    } catch (_) {}
    mailGoArea('mail-validation');
  };
  const sendList = l => {
    try { sessionStorage.setItem('se_mail_prelist', JSON.stringify(l || null)); } catch (_) {}
    mailGoArea('mail-campaigns');
  };
  return html`<div className="stack">
      <section className="panel">
        <div className="ph-row">
          <div><div className="eyebrow">Email workspace</div><h2 className="ph" style=${{ marginBottom: 4 }}>Email & Contacts</h2><p className="muted small" style=${{ margin: 0 }}>Manage the address book, lists, inbox and sending setup here. Validation, cleanup and campaigns each have their own page.</p></div>
          <div className="actions">
            <a className="btn ghost sm" href=${mailAreaHref('mail-validation')}><${Icon} n="check" />Email Validation</a>
            <a className="btn ghost sm" href=${mailAreaHref('mail-cleanup')}><${Icon} n="trash" />Contact Cleanup</a>
            <a className="btn sm" href=${mailAreaHref('mail-campaigns')}><${Icon} n="send" />Campaigns</a>
          </div>
        </div>
      </section>
      ${st && !st.ready && html`<div className="note amber"><span><b>Email is not connected to a mailbox yet.</b> ${owner ? 'Connect Gmail (or another mail service) so portal email and campaigns go out from your own address.' : 'Ask an administrator to connect a sending service.'}</span>${owner && tab !== 'settings' && html`<div className="actions"><button className="btn sm" onClick=${() => setTab('settings')}>Set up sending</button></div>`}</div>`}
      ${st && st.wait && tab !== 'settings' && html`<div className="note red"><span><b>Sending is paused for a few minutes:</b> ${st.wait.message}${st.wait.hint ? html`<br />${st.wait.hint}` : ''}</span></div>`}
      <div className="tabs" role="tablist">
        ${tabs.map(([k, v]) => html`<button key=${k} role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${v}</button>`)}
      </div>
      ${tab === 'contacts' && html`<${MailContacts} onEmail=${sendContacts} onValidate=${validateContacts} onCleanup=${() => mailGoArea('mail-cleanup')} />`}
      ${tab === 'lists' && html`<${MailLists} q=${q} onSend=${sendList} />`}
      ${tab === 'log' && html`<${MailLog} />`}
      ${tab === 'inbox' && html`<${MailInbox} />`}
      ${tab === 'deliv' && html`<${MailDeliverability} />`}
      ${tab === 'settings' && html`<${MailSettings} onSaved=${loadStatus} />`}
    </div>`;
}

function MailCampaignPage({ q = {} } = {}) {
  const P = usePortal();
  const owner = P.roleName === 'admin';
  const [tab, setTab] = useState(q.tab === 'list' ? 'list' : 'new');
  const [st, setSt] = useState(null);
  const [picked] = useState(() => {
    try { const x = JSON.parse(sessionStorage.getItem('se_mail_picked') || 'null'); sessionStorage.removeItem('se_mail_picked'); return Array.isArray(x) ? x : null; } catch (_) { return null; }
  });
  const [preList] = useState(() => {
    try { const x = JSON.parse(sessionStorage.getItem('se_mail_prelist') || 'null'); sessionStorage.removeItem('se_mail_prelist'); return x && typeof x === 'object' ? x : null; } catch (_) { return null; }
  });
  const loadStatus = () => api('mail_status').then(setSt).catch(() => setSt(null));
  useEffect(() => { loadStatus(); }, [tab]);
  return html`<div className="stack">
    <section className="panel"><div className="ph-row"><div><div className="eyebrow">Outbound email</div><h2 className="ph" style=${{ marginBottom: 4 }}>Campaigns</h2><p className="muted small" style=${{ margin: 0 }}>Create campaigns and monitor queued/sent results here. Validate or clean the contact list on their separate pages before a large send.</p></div><div className="actions"><a className="btn ghost sm" href=${mailAreaHref('mail-validation')}>Email Validation</a><a className="btn ghost sm" href=${mailAreaHref('mail-cleanup')}>Contact Cleanup</a></div></div></section>
    ${st && !st.ready && html`<div className="note amber"><span><b>Email is not connected yet.</b> ${owner ? 'Use Email & Contacts → Sending setup before starting a campaign.' : 'Ask an administrator to connect the sending service.'}</span></div>`}
    <div className="tabs"><button className=${tab === 'new' ? 'on' : ''} onClick=${() => setTab('new')}>New campaign</button><button className=${tab === 'list' ? 'on' : ''} onClick=${() => setTab('list')}>Campaign status</button></div>
    ${tab === 'new' && html`<${MailCompose} key=${preList ? 'l' + preList.id : picked ? 'picked' : 'new'} picked=${picked} preList=${preList} status=${st} onQueued=${() => setTab('list')} />`}
    ${tab === 'list' && html`<${MailCampaigns} />`}
  </div>`;
}


function MailSignatureTools({ value, onChange }) {
  const toast = useToast();
  const [sig, setSig] = useState('');
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api('mail_signature').then(r => { setSig(r.text || ''); setDraft(r.text || ''); }).catch(() => {});
  }, []);
  const add = () => {
    if (!sig.trim()) return setEdit(true);
    const cur = String(value || '').replace(/\s+$/, '');
    if (cur.includes(sig.trim())) return toast('Your signature is already in this message.');
    onChange(cur + (cur ? '\n\n' : '') + sig.trim());
  };
  const save = async () => {
    setBusy(true);
    try {
      const r = await api('mail_signature_save', { text: draft });
      setSig(r.text || ''); setDraft(r.text || ''); setEdit(false); toast('Personal email signature saved.');
    } catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  return html`<${Fragment}>
    <button type="button" className="btn ghost sm" onClick=${add}><${Icon} n="pen" />Signature</button>
    <button type="button" className="btn link sm" onClick=${() => setEdit(true)}>${sig.trim() ? 'Edit signature' : 'Save signature'}</button>
    ${edit && html`<${Modal} title="My email signature" onClose=${() => setEdit(false)} foot=${html`<button className="btn ghost" onClick=${() => setEdit(false)}>Cancel</button><button className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save signature'}</button>`}>
      <div className="form"><${Field} label="Signature" hint="Saved only for your user account. Use the Signature button to insert it into campaigns and replies."><textarea rows="8" value=${draft} onInput=${e => setDraft(e.target.value)} placeholder=${'Your name\nTitle\nCompany\nPhone'} /></${Field}></div>
    <//>`}
  <//>`;
}

/* ---- compose ---- */
function MailCompose({ picked, preList, status, onQueued }) {
  const P = usePortal();
  const toast = useToast();
  const me = Cap.me || {};
  const [src, setSrc] = useState(null);
  const [a, setA] = useState({
    groups: [],
    ats: false,
    atsStage: '',
    vms: false,
    vmsTypes: [],
    rec: false,
    contacts: false,
    tags: [],
    paste: picked ? picked.map(x => (x.name ? `${x.name} <${x.email}>` : x.email)).join('\n') : '',
    save: true,
    saveTag: '',
    lists: preList ? [preList.id] : [],
  });
  const [m, setM] = useState({
    subject: '',
    body: '',
    btnText: '',
    btnUrl: '',
    // v37.5: one list chosen: its sender name and reply address (both can be changed)
    fromName: preList ? preList.fromName || preList.name : '',
    replyTo: dlReplyOf(preList) || me.email || '',
  });
  const [files, setFiles] = useState([]);
  const [count, setCount] = useState(null);
  const [busy, setBusy] = useState('');
  const [preview, setPreview] = useState(null);
  const [inbox, setInbox] = useState(null);
  const body = useRef(null);
  // v34: the inbox check reads the message the way spam filters do, a moment after typing stops
  const msgKey = JSON.stringify([m.subject, m.body, m.btnText, m.btnUrl, m.fromName, files.length]);
  useEffect(() => {
    if (!m.subject.trim() && !m.body.trim()) {
      setInbox(null);
      return;
    }
    const t = setTimeout(() => {
      api('mail_content_check', { ...m, atts: files.length })
        .then(setInbox)
        .catch(() => setInbox(null));
    }, 700);
    return () => clearTimeout(t);
  }, [msgKey]);
  const cap = status && status.me && status.me.cap > 0 ? status.me : null;
  const capLeft = cap ? Math.max(0, cap.cap - cap.used) : Infinity;
  useEffect(() => {
    api('mail_sources')
      .then(setSrc)
      .catch(e => toast(errText(e), true));
  }, []);
  const audKey = JSON.stringify(a);
  useEffect(() => {
    const t = setTimeout(() => {
      api('mail_audience', { aud: a })
        .then(setCount)
        .catch(() => setCount(null));
    }, 350);
    return () => clearTimeout(t);
  }, [audKey]);
  const up = k => e => setM({ ...m, [k]: e.target.value });
  const toggleGroup = g =>
    setA({ ...a, groups: a.groups.includes(g) ? a.groups.filter(x => x !== g) : [...a.groups, g] });
  const toggleTag = t =>
    setA({ ...a, contacts: true, tags: a.tags.includes(t) ? a.tags.filter(x => x !== t) : [...a.tags, t] });
  const insert = token => {
    const el = body.current;
    if (!el) return;
    const s = el.selectionStart || 0,
      e = el.selectionEnd || 0;
    setM({ ...m, body: m.body.slice(0, s) + token + m.body.slice(e) });
    setTimeout(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = s + token.length;
    }, 0);
  };
  const toggleList = l => {
    const on = !a.lists.includes(l.id);
    const next = on ? [...a.lists, l.id] : a.lists.filter(x => x !== l.id);
    setA({ ...a, lists: next });
    // the first list chosen sets the sender name and reply address, when they were not changed by hand
    const fresh = !m.fromName && m.replyTo === (me.email || '');
    if (on && next.length === 1 && fresh) setM({ ...m, fromName: l.fromName || l.name, replyTo: dlReplyOf(l) || me.email || '' });
  };
  const label = () => {
    const parts = [];
    const ln = ((src && src.lists) || []).filter(l => a.lists.includes(l.id)).map(l => l.name);
    if (ln.length) parts.push((ln.length === 1 ? 'list ' : 'lists ') + ln.join(', '));
    if (a.groups.includes('employees')) parts.push('employees');
    if (a.groups.includes('consultants')) parts.push('consultants');
    if (a.groups.includes('clients')) parts.push('client contacts');
    if (a.ats) parts.push(a.atsStage ? `ATS: ${ATS_ST[a.atsStage]}` : 'ATS candidates');
    if (a.vms) parts.push(a.vmsTypes.length ? a.vmsTypes.join(', ').toLowerCase() : 'vendors & clients');
    if (a.rec) parts.push('recruiting consultants');
    if (a.contacts) parts.push(a.tags.length ? `contacts tagged ${a.tags.join(', ')}` : 'all contacts');
    if (a.paste.trim()) parts.push('pasted addresses');
    return parts.join(', ');
  };
  const form = () => {
    const fd = new FormData();
    fd.append('data', JSON.stringify({ ...m, aud: a, label: label() }));
    files.forEach(f => fd.append('att[]', f));
    return fd;
  };
  const check = () => {
    if (!m.subject.trim() || !m.body.trim()) {
      toast('Add a subject and a message.', true);
      return false;
    }
    if (!!m.btnText.trim() !== !!m.btnUrl.trim()) {
      toast('A button needs both its text and its link.', true);
      return false;
    }
    return true;
  };
  const sendTest = async () => {
    if (!check()) return;
    setBusy('test');
    try {
      const r = await upload('mail_send_test', form());
      toast(
        r.ok
          ? `Test sent to ${r.to}. Check that inbox (and the spam folder).`
          : `The test did not send: ${r.error}${r.hint ? ' ' + r.hint : ''}`,
        !r.ok
      );
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const send = async () => {
    if (!check()) return;
    if (!count || !count.count) {
      toast('Choose who should get this email first.', true);
      return;
    }
    const days = status && status.limit ? Math.ceil(count.count / status.limit) : 1;
    if (
      !confirm(
        `Send "${m.subject}" to ${plural(count.count, 'person', 'people')}? Each person gets their own copy.${days > 1 ? ` At ${status.limit} emails a day this takes about ${days} days.` : ''}`
      )
    )
      return;
    setBusy('send');
    try {
      const r = await upload('mail_campaign_create', form());
      toast(`Queued for ${plural(r.campaign.total, 'person', 'people')}${r.cleaned && r.cleaned.n ? ` (${r.cleaned.n.toLocaleString()} left out by list cleaning)` : ''}. Sending has started.`);
      onQueued();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const showPreview = async () => {
    try {
      setPreview(await api('mail_preview', m));
    } catch (e) {
      toast(errText(e), true);
    }
  };
  if (!src) return html`<${Spinner} />`;
  const tagList = Object.entries(src.tags || {});
  return html`<div className="stack">
      <section className="panel stack" style=${{ gap: 14 }}>
        <h2 className="ph">Who gets it</h2>
        ${
          (src.lists || []).length > 0 &&
          html`<div className="stack" style=${{ gap: 8 }}>
              <span className="lbl">Distribution lists</span>
              <div className="actions">
                ${src.lists.map(l => html`<button key=${l.id} type="button" className=${'chip' + (a.lists.includes(l.id) ? ' new' : '')} style=${{ border: 0, cursor: 'pointer' }} aria-pressed=${a.lists.includes(l.id)} title=${l.descr || ''} onClick=${() => toggleList(l)}>${l.name} · ${(l.n || 0).toLocaleString()}</button>`)}
              </div>
            </div>`
        }
        ${
          src.staff &&
          html`<div className="stack" style=${{ gap: 8 }}>
              <span className="lbl">People in the portal</span>
              <div className="actions">
                ${[
                  ['employees', 'Employees'],
                  ['consultants', 'Consultants'],
                  ['clients', 'Client contacts'],
                ].map(
                  ([k, v]) =>
                    html`<label key=${k} className="check">
                        <input type="checkbox" checked=${a.groups.includes(k)} onChange=${() => toggleGroup(k)} />
                        <span>
                          ${v} (${(src[k] || 0).toLocaleString()})</span>
                      </label>`
                )}
              </div>
              <div className="actions" style=${{ alignItems: 'center' }}>
                <label className="check">
                  <input type="checkbox" checked=${a.ats} onChange=${e => setA({ ...a, ats: e.target.checked })} />
                  <span>Job applicants in the ATS</span>
                </label>
                <select style=${{ width: 'auto' }} value=${a.atsStage} onChange=${e => setA({ ...a, ats: true, atsStage: e.target.value })} aria-label="Applicant stage">
                  <option value="">All stages except rejected (${(src.ats && src.ats.all) || 0})</option>
                  ${Object.entries(ATS_ST).map(([k, v]) => html`<option key=${k} value=${k}>${v} (${(src.ats && src.ats[k]) || 0})</option>`)}
                </select>
              </div>
            </div>`
        }
        ${
          src.vms &&
          html`<div className="stack" style=${{ gap: 8 }}>
              <label className="check">
                <input type="checkbox" checked=${a.vms} onChange=${e => setA({ ...a, vms: e.target.checked, vmsTypes: e.target.checked ? a.vmsTypes : [] })} />
                <span>Vendors & clients on file (${src.vms.n.toLocaleString()} contacts)</span>
              </label>
              ${
                Object.keys(src.vms.types || {}).length > 0 &&
                html`<div className="actions" style=${{ marginLeft: 28 }}>
                    <span className="muted small">Only:</span>
                    ${Object.entries(src.vms.types).map(([t, n]) => html`<button key=${t} type="button" className=${'chip' + (a.vmsTypes.includes(t) ? ' new' : '')} style=${{ border: 0, cursor: 'pointer' }} aria-pressed=${a.vmsTypes.includes(t)} onClick=${() => setA({ ...a, vms: true, vmsTypes: a.vmsTypes.includes(t) ? a.vmsTypes.filter(x => x !== t) : [...a.vmsTypes, t] })}>${t} · ${n}</button>`)}
                  </div>`
              }
            </div>`
        }
        <label className="check">
          <input type="checkbox" checked=${a.rec} onChange=${e => setA({ ...a, rec: e.target.checked })} />
          <span>Consultants in the recruiting workspace (${src.rec.toLocaleString()})</span>
        </label>
        <div className="stack" style=${{ gap: 8 }}>
          <label className="check">
            <input type="checkbox" checked=${a.contacts} onChange=${e => setA({ ...a, contacts: e.target.checked, tags: e.target.checked ? a.tags : [] })} />
            <span>Contacts list (${src.contacts.toLocaleString()})${a.contacts && !a.tags.length ? ': everyone' : ''}
            </span>
          </label>
          ${
            tagList.length > 0 &&
            html`<div className="actions" style=${{ marginLeft: 28 }}>
                <span className="muted small">Only these tags:</span>
                ${tagList.map(
                  ([
                    t,
                    n,
                  ]) => html`<button key=${t} type="button" className=${'chip' + (a.tags.includes(t) ? ' new' : '')} style=${{ border: 0, cursor: 'pointer' }} aria-pressed=${a.tags.includes(t)} onClick=${() => toggleTag(t)}>
                      ${t} · ${n}
                    </button>`
                )}
              </div>`
          }
        </div>
        <${Field} label="Or paste addresses" hint="One per line: name@company.com or Jane Smith <jane@company.com>. Copied spreadsheet rows work too.">
          <textarea value=${a.paste} onInput=${e => setA({ ...a, paste: e.target.value })} style=${{ minHeight: 90 }} placeholder="jane@company.com" />
        <//>
        ${
          a.paste.trim() &&
          html`<div className="actions" style=${{ alignItems: 'center' }}>
              <label className="check">
                <input type="checkbox" checked=${a.save} onChange=${e => setA({ ...a, save: e.target.checked })} />
                <span>Save new addresses to Contacts with the tag</span>
              </label>
              <input style=${{ width: 200 }} value=${a.saveTag} onInput=${e => setA({ ...a, saveTag: e.target.value })} placeholder="e.g. Vendors NJ" aria-label="Tag for saved addresses" />
            </div>`
        }
        <div className=${'note ' + (count && count.count ? 'info' : '')} style=${count && count.count ? null : { background: 'var(--surface-2)' }}>
          <span>
            <b>
              ${count ? plural(count.count, 'recipient') : 'Counting…'}
            </b>
            ${count && count.suppressed ? `, ${count.suppressed} unsubscribed address${count.suppressed === 1 ? ' is' : 'es are'} left out` : ''}${count && count.clean && count.clean.n ? `, ${count.clean.n.toLocaleString()} more left out by list cleaning` : ''}${
              count && count.sample && count.sample.length
                ? html`<br />
                  <span className="small">
                    ${count.sample.join(', ')}${count.count > count.sample.length ? ', …' : ''}
                  </span>`
                : ''
            }${
              count && count.clean && count.clean.n
                ? html`<br /><span className="small">Left out: ${[
                    count.clean.removed.known && `${count.clean.removed.known} bounced or checked bad before`,
                    count.clean.removed.typo && `${count.clean.removed.typo} with a typo in the domain`,
                    count.clean.removed.disposable && `${count.clean.removed.disposable} throwaway`,
                    count.clean.removed.nomx && `${count.clean.removed.nomx} whose domain takes no email`,
                  ]
                    .filter(Boolean)
                    .join(', ')} (${count.clean.examples.join('; ')}${count.clean.n > count.clean.examples.length ? '; …' : ''})</span>`
                : ''
            }${count && count.clean && count.clean.unchecked ? html`<br /><span className="small muted">Domains not looked up yet are checked as the email sends.</span>` : ''}
          </span>
        </div>
        ${
          cap &&
          html`<p className=${'small ' + (count && count.count > capLeft ? '' : 'muted')} style=${{ margin: 0, color: count && count.count > capLeft ? 'var(--red-ink)' : undefined }}>
              Your daily limit is ${cap.cap.toLocaleString()} emails; ${capLeft.toLocaleString()} left today.${count && count.count > capLeft ? ' Choose fewer people, or ask an administrator to raise your limit.' : ''}
            </p>`
        }
      </section>
      <section className="panel stack" style=${{ gap: 14 }}>
        <h2 className="ph">Message</h2>
        <div className="row2">
          <${Field} label="From name" hint=${`Shown as the sender. Leave blank for "${(status && status.fromName) || 'StratEdge IT Consulting'}".`}>
            <input value=${m.fromName} onInput=${up('fromName')} placeholder=${(status && status.fromName) || 'StratEdge IT Consulting'} />
          <//>
          <${Field} label="Replies go to" hint="Usually your own address.">
            <input type="email" value=${m.replyTo} onInput=${up('replyTo')} />
          <//>
        </div>
        <${Field} label="Subject">
          <input value=${m.subject} onInput=${up('subject')} maxLength="200" placeholder="e.g. New contract roles this week" />
        <//>
        <${Field} label="Message" hint="Blank lines start a new paragraph. Links become clickable.">
          <div className="actions" style=${{ marginBottom: 6 }}>
            <span className="muted small">Insert:</span>
            ${MERGE_FIELDS.map(f => html`<button key=${f} type="button" className="btn ghost sm" onClick=${() => insert(f)}>${f}</button>`)}
          </div>
          <div className="aibar"><${SigButton} onInsert=${s => setM({ ...m, body: sigAppend(m.body, s) })} /><${AiWrite} kind="campaign" value=${m.body} subject=${m.subject} vars=${MERGE_FIELDS} ctx=${{ subject: m.subject }} onUse=${(t, s) => setM({ ...m, body: t, subject: s && !m.subject.trim() ? s : m.subject })} /></div>
          <textarea ref=${body} value=${m.body} onInput=${up('body')} style=${{ minHeight: 220 }} placeholder=${'Hi {first_name},\n\n…'} />
        <//>
        <div className="row2">
          <${Field} label="Button text (optional)">
            <input value=${m.btnText} onInput=${up('btnText')} placeholder="e.g. View open roles" />
          <//>
          <${Field} label="Button link">
            <input type="url" value=${m.btnUrl} onInput=${up('btnUrl')} placeholder="https://stratedgeitconsulting.com/#/careers" />
          <//>
        </div>
        <div className="stack" style=${{ gap: 8 }}>
          <span className="lbl">Attachments</span>
          <div className="actions">
            ${files.map(
              (f, i) => html`<span key=${i} className="chip">
                  ${f.name} · ${Math.max(1, Math.round(f.size / 1024))} KB<button type="button" className="btn link" style=${{ marginLeft: 6 }} aria-label=${'Remove ' + f.name} onClick=${() => setFiles(files.filter((_, j) => j !== i))}>×</button>
                </span>`
            )}
            <label className="btn ghost sm" style=${{ cursor: 'pointer' }}>
              <${Icon} n="plus" />Attach a file<input type="file" hidden multiple accept=".pdf,.docx,.xlsx,.csv,.txt,.png,.jpg,.jpeg" onChange=${e => {
                const add = [...e.target.files];
                e.target.value = '';
                setFiles([...files, ...add].slice(0, 5));
              }} />
            </label>
          </div>
          <span className="muted small">Up to 5 files, 15 MB in total. Every recipient gets the files, so keep them small.</span>
        </div>
        <p className="muted small">Each person receives their own copy, so nobody sees the other addresses. Your company address and an unsubscribe link are added at the bottom, and people who unsubscribe are skipped automatically.</p>
        ${
          inbox &&
          html`<details className=${'inboxcheck ic-' + inbox.grade} open=${inbox.grade !== 'good'}>
              <summary>
                <b>Inbox check: ${inbox.score}/100</b>
                <${Chip} s=${inbox.grade === 'good' ? 'ok' : inbox.grade === 'fair' ? 'amber' : 'red'}>${inbox.grade === 'good' ? 'Looks good' : inbox.grade === 'fair' ? 'Could land in spam or Promotions' : 'Likely spam'}<//>
              </summary>
              <ul>
                ${inbox.items
                  .slice()
                  .sort((a, b) => ({ fail: 0, warn: 1, ok: 2 })[a.st] - ({ fail: 0, warn: 1, ok: 2 })[b.st])
                  .map((x, i) => html`<li key=${i} className=${'ic-' + x.st}><${Chip} s=${DV_CHIP[x.st]}>${x.st === 'ok' ? 'OK' : x.st === 'warn' ? 'Improve' : 'Fix'}<//><span><b>${x.t}</b>${x.fix ? html` ${x.fix}` : ''}</span></li>`)}
              </ul>
            </details>`
        }
        <div className="actions">
          <button className="btn ghost" onClick=${showPreview}>
            <${Icon} n="eye" />Preview</button>
          <button className="btn ghost" disabled=${!!busy} onClick=${sendTest}>
            ${busy === 'test' ? 'Sending test…' : `Send a test to ${me.email || 'me'}`}
          </button>
          <button className="btn" disabled=${!!busy || !count || !count.count || count.count > capLeft} onClick=${send}>
            <${Icon} n="send" />
            ${busy === 'send' ? 'Queuing…' : count && count.count ? `Send to ${plural(count.count, 'person', 'people')}` : 'Send'}
          </button>
        </div>
      </section>
      ${
        preview &&
        html`<${Modal} wide title=${preview.subject || 'Preview'} onClose=${() => setPreview(null)} foot=${html`<button className="btn" onClick=${() => setPreview(null)}>Close</button>`}>
            <p className="muted small" style=${{ marginBottom: 10 }}>Shown with sample details for "Alex Morgan, Network Engineer at Example Corp".</p>
            <iframe title="Email preview" srcDoc=${preview.html} sandbox="" style=${{ width: '100%', height: 520, border: '1px solid var(--line)', borderRadius: 12, background: '#fff' }} />
          <//>`
      }
    </div>`;
}

/* ---- campaigns: progress, and the sender loop while this page is open ---- */
function MailCampaigns() {
  const toast = useToast();
  const [list, setList] = useState(null);
  const [run, setRun] = useState(null);
  const [open, setOpen] = useState(null);
  const load = () =>
    api('mail_campaigns')
      .then(r => {
        setList(r.campaigns);
        return r;
      })
      .catch(e => {
        toast(errText(e), true);
        return null;
      });
  useEffect(() => {
    load();
  }, []);
  const active = (list || []).some(c => c.status === 'queued' || c.status === 'sending');
  useEffect(() => {
    if (!active) return;
    let live = true;
    (async () => {
      while (live) {
        let pause = 2500;
        if (!document.hidden) {
          try {
            const r = await api('mail_campaign_run', {});
            if (!live) return;
            setRun(r);
            if (r.state === 'waiting' || r.state === 'limit' || r.state === 'stopped' || r.state === 'held') pause = 30000;
            else if (r.state === 'busy') pause = 4000;
          } catch (e) {
            pause = 10000;
          }
          await load();
        }
        await sleep(pause);
      }
    })();
    return () => {
      live = false;
    };
  }, [active]);
  if (!list) return html`<${Spinner} />`;
  return html`<div className="stack">
      ${
        active &&
        run &&
        (run.state === 'stopped' || run.state === 'waiting') &&
        html`<div className="note red">
            <span>
              <b>Sending is paused:</b> ${run.message}${run.hint ? html`<br />${run.hint}` : ''}
              <br />
              <span className="small">It tries again at ${fmtTime(run.until)}.</span>
            </span>
            <div className="actions">
              <button className="btn sm" onClick=${async () => {
                await api('mail_campaign_action', { id: list[0].id, action: 'wake' }).catch(() => {});
                setRun(null);
                load();
              }}>Try again now</button>
            </div>
          </div>`
      }
      ${
        active &&
        run &&
        run.state === 'limit' &&
        html`<div className="note amber">
            <span>
              ${
                run.limitWhy === 'warmup' && run.warm
                  ? html`<b>Today's warm-up cap is reached</b> (day ${run.warm.day} of ${run.warm.days}: ${run.limit.toLocaleString()} emails in 24 hours). The rest go out as the cap grows each day.`
                  : html`<b>Today's sending limit is reached</b> (${run.limit} emails in 24 hours). The rest go out automatically as the limit allows.`
              }</span>
          </div>`
      }
      ${
        active &&
        run &&
        run.held > 0 &&
        html`<div className="note info">
            <span><b>${plural(run.held, 'email')} waiting</b> so no receiving domain gets more than ${(run.domHour || 0).toLocaleString()} an hour (Deliverability › Delivery safety). ${run.heldUntil ? `They continue from ${fmtTime(run.heldUntil)}.` : ''}</span>
          </div>`
      }
      ${active && html`<p className="muted small">Sending runs while this page is open. To keep it going with the page closed, add the scheduled task shown under Job portals › Sources; it now sends queued email too.</p>`}
      <section className="panel" style=${{ padding: '6px 8px' }}>
        ${
          list.length
            ? html`<div className="tblwrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Subject</th>
                      <th>Sent</th>
                      <th className="r" title="Failed, bounced or marked as spam">Problems</th>
                      <th>Status</th>
                      <th>By</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${list.map(
                      c => html`<tr key=${c.id} className="click" tabIndex="0" onClick=${() => setOpen(c.id)} onKeyDown=${e => {
                        if (e.key === 'Enter') setOpen(c.id);
                      }}>
                          <td>
                            <b style=${{ fontWeight: 600 }}>
                              ${c.subject}
                            </b>
                            <div className="muted small">
                              ${c.audience}${c.atts.length ? ` · ${plural(c.atts.length, 'attachment')}` : ''}
                            </div>
                            ${c.note && c.status !== 'done' ? html`<div className="small" style=${{ color: 'var(--red-ink)' }}>${c.note}</div>` : ''}
                          </td>
                          <td style=${{ minWidth: 150 }}>
                            <span className="num">
                              ${c.sent.toLocaleString()} of ${c.total.toLocaleString()}
                            </span>
                            <div className="prog">
                              <b style=${{ width: (c.total ? Math.round(((c.sent + c.failed + c.skipped) / c.total) * 100) : 0) + '%' }} />
                            </div>
                            ${(c.delivered || c.bounced || c.complained) > 0 && html`<div className="muted small">${[c.delivered && `${c.delivered.toLocaleString()} delivered`, c.bounced && `${c.bounced.toLocaleString()} bounced`, c.complained && `${c.complained.toLocaleString()} spam`].filter(Boolean).join(' · ')}</div>`}
                            ${c.held && html`<div className="muted small">${c.held.n.toLocaleString()} held until ${fmtTime(c.held.until)}</div>`}
                          </td>
                          <td className="r num">
                            ${c.failed + c.bounced + c.complained || '—'}
                          </td>
                          <td>
                            <${Chip} s=${campChip(c.status)}>
                              ${CAMP_ST[c.status] || c.status}
                            <//>
                          </td>
                          <td className="small">
                            ${c.by}
                          </td>
                          <td className="num nw small">
                            ${fmtTs(c.created)}
                          </td>
                        </tr>`
                    )}
                  </tbody>
                </table>
              </div>`
            : html`<${Empty} title="No mass email yet">Write one on the New email tab. Each campaign shows its progress here, with every recipient's result.<//>`
        }
      </section>
      ${
        open &&
        html`<${CampaignModal} id=${open} onClose=${() => {
          setOpen(null);
          load();
        }} />`
      }
    </div>`;
}
function CampaignModal({ id, onClose }) {
  const toast = useToast();
  const [f, setF] = useState({ status: '', offset: 0 });
  const [d, setD] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    api('mail_campaign', { id, ...f })
      .then(setD)
      .catch(e => toast(errText(e), true));
  }, [id, f.status, f.offset, tick]);
  const act = async (action, msg) => {
    try {
      await api('mail_campaign_action', { id, action });
      toast(msg);
      setTick(t => t + 1);
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const c = d && d.campaign;
  return html`<${Modal} wide title=${c ? c.subject : 'Campaign'} onClose=${onClose} foot=${html`${c && (c.status === 'queued' || c.status === 'sending') && html`<button className="btn ghost" onClick=${() => act('pause', 'Paused.')}>Pause</button>`}${c && c.status === 'paused' && html`<button className="btn ghost" onClick=${() => act('resume', 'Sending resumed.')}>Resume</button>`}${
    c &&
    ['queued', 'sending', 'paused'].includes(c.status) &&
    html`<button className="btn ghost" onClick=${() => {
      if (confirm('Cancel this campaign? Nobody else on the list will get it.')) act('cancel', 'Cancelled.');
    }}>Cancel campaign</button>`
  }${c && c.failed > 0 && c.status !== 'cancelled' && html`<button className="btn ghost" onClick=${() => act('retry', c.status === 'paused' ? 'Failed addresses are queued again; they go out when you resume.' : 'Failed addresses are queued again.')}>Retry failed</button>`}
    <button className="btn" onClick=${onClose}>Close</button>`}>
      ${
        !d
          ? html`<${Spinner} />`
          : html`<div className="stack">
              <div className="kpis" style=${{ gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))' }}>
                <a>
                  <b>
                    ${c.total.toLocaleString()}
                  </b>
                  <span>Recipients</span>
                </a>
                <a>
                  <b>
                    ${c.sent.toLocaleString()}
                  </b>
                  <span>Sent</span>
                </a>
                <a>
                  <b>${c.delivered.toLocaleString()}</b>
                  <span>Delivered</span>
                </a>
                <a>
                  <b>${c.bounced.toLocaleString()}</b>
                  <span>Bounced${c.sent + c.failed >= 20 ? ` (${dvPct(((c.bounced + c.failed) * 100) / Math.max(1, c.sent + c.failed), 1)})` : ''}</span>
                </a>
                <a>
                  <b>${c.complained.toLocaleString()}</b>
                  <span>Marked as spam</span>
                </a>
                <a>
                  <b>
                    ${c.failed.toLocaleString()}
                  </b>
                  <span>Failed</span>
                </a>
                <a>
                  <b>
                    ${c.skipped.toLocaleString()}
                  </b>
                  <span>Skipped</span>
                </a>
              </div>
              <dl className="kv">
                <dt>Status</dt>
                <dd>
                  <${Chip} s=${campChip(c.status)}>
                    ${CAMP_ST[c.status]}
                  <//>
                </dd>
                <dt>Audience</dt>
                <dd>
                  ${c.audience}
                </dd>
                <dt>From</dt>
                <dd>
                  ${c.fromName || 'Default sender name'}${c.replyTo ? `, replies to ${c.replyTo}` : ''}
                </dd>
                <dt>Created</dt>
                <dd>
                  ${fmtTs(c.created)} by ${c.by}
                </dd>
                ${c.atts.length > 0 && html`<dt>Attachments</dt><dd>${c.atts.join(', ')}</dd>`}
                ${c.clean && c.clean.n > 0 && html`<dt>List cleaning</dt><dd>${plural(c.clean.n, 'address', 'addresses')} left out${c.clean.examples && c.clean.examples.length ? html`<div className="muted small">${c.clean.examples.slice(0, 4).join('; ')}</div>` : ''}</dd>`}
                ${c.score && html`<dt>Inbox check</dt><dd>${c.score.score}/100</dd>`}
                ${c.held && html`<dt>Waiting</dt><dd>${plural(c.held.n, 'email')} held back by the per-domain limit, from ${fmtTime(c.held.until)}</dd>`}
              </dl>
              ${c.auto && c.status === 'paused' && html`<div className="note red"><span><b>Paused automatically</b> on ${fmtTs(c.auto.at)}: ${c.auto.why}. Remove the addresses that bounced (Check & bounces) before resuming; the rates are measured again from the moment you resume.</span></div>`}
              <details>
                <summary className="small" style=${{ cursor: 'pointer' }}>Message</summary>
                <pre style=${{ whiteSpace: 'pre-wrap', font: 'inherit', fontSize: 14, marginTop: 8 }}>
                  ${c.body}
                </pre>
              </details>
              <div className="seg" style=${{ marginBottom: 0 }}>
                ${[
                  ['', 'Everyone'],
                  ['sent', 'Sent'],
                  ['delivered', 'Delivered'],
                  ['bounced', 'Bounced'],
                  ['failed', 'Failed'],
                  ['queued', 'Waiting'],
                  ['skipped', 'Skipped'],
                ].map(
                  ([k, v]) =>
                    html`<button key=${k} className=${f.status === k ? 'on' : ''} onClick=${() => setF({ status: k, offset: 0 })}>
                        ${v}
                      </button>`
                )}
              </div>
              ${
                d.rows.length
                  ? html`<div className="tblwrap">
                      <table className="tbl mini">
                        <thead>
                          <tr>
                            <th>Recipient</th>
                            <th>Result</th>
                            <th>When</th>
                          </tr>
                        </thead>
                        <tbody>
                          ${d.rows.map(
                            (r, i) => html`<tr key=${i}>
                                <td>
                                  ${r.name ? html`<b style=${{ fontWeight: 600 }}>${r.name}</b> ` : ''}
                                  <span className="muted">
                                    ${r.email}
                                  </span>
                                </td>
                                <td>
                                  ${
                                    r.status === 'sent'
                                      ? html`<${Chip} s="ok">Sent<//>${r.err ? html`<div className="muted small">${r.err}</div>` : ''}`
                                      : r.status === 'delivered'
                                        ? html`<${Chip} s="ok">Delivered<//>`
                                        : r.status === 'bounced' || r.status === 'complained'
                                          ? html`<${Chip} s="red">${r.status === 'bounced' ? 'Bounced' : 'Marked as spam'}<//><div className="muted small">${r.err}</div>`
                                      : r.status === 'failed'
                                        ? html`<${Chip} s="red">Failed<//><div className="muted small">${r.err}</div>`
                                        : r.status === 'queued'
                                          ? html`<${Chip} s="amber">Waiting<//>${+r.nb > Date.now() ? html`<div className="muted small">Held until ${fmtTime(+r.nb)} (per-domain limit)</div>` : r.err ? html`<div className="muted small">${r.err}</div>` : ''}`
                                          : html`<${Chip}>
                                            ${r.status === 'skipped' ? 'Skipped' : 'Cancelled'}
                                          <//>
                                          ${r.err ? html`<div className="muted small">${r.err}</div>` : ''}`
                                  }
                                </td>
                                <td className="num small nw">
                                  ${+r.at ? fmtTs(+r.at) : '—'}
                                </td>
                              </tr>`
                          )}
                        </tbody>
                      </table>
                    </div>`
                  : html`<${Empty} title="Nobody here" />`
              }
              ${
                d.total > 100 &&
                html`<div className="actions">
                    <button className="btn ghost sm" disabled=${f.offset === 0} onClick=${() => setF({ ...f, offset: Math.max(0, f.offset - 100) })}>Previous</button>
                    <span className="small muted">
                      ${f.offset + 1}–${Math.min(d.total, f.offset + 100)} of ${d.total.toLocaleString()}
                    </span>
                    <button className="btn ghost sm" disabled=${f.offset + 100 >= d.total} onClick=${() => setF({ ...f, offset: f.offset + 100 })}>Next</button>
                  </div>`
              }
            </div>`
      }
    <//>`;
}

/* ---- contacts: the address book behind mass email ---- */
function MailContacts({ onEmail, onValidate, onCleanup }) {
  const toast = useToast();
  const P = usePortal();
  const [f, setF] = useState({ q: '', tag: '', status: '', sort: 'created', offset: 0 });
  const [res, setRes] = useState(null);
  const [sel, setSel] = useState({});
  const [edit, setEdit] = useState(undefined);
  const [imp, setImp] = useState(false);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const key = JSON.stringify(f);
  useEffect(() => {
    const t = setTimeout(
      () =>
        api('mail_contacts', { ...f, limit: 50 })
          .then(setRes)
          .catch(e => toast(errText(e), true)),
      f.q ? 300 : 0
    );
    return () => clearTimeout(t);
  }, [key, tick]);
  const set = patch => {
    setF({ ...f, offset: 0, ...patch });
    setSel({});
  };
  const rows = res ? res.rows : [];
  const ids = Object.keys(sel).filter(k => sel[k]);
  const allOn = rows.length > 0 && rows.every(r => sel[r.id]);
  const reload = () => {
    setSel({});
    setTick(t => t + 1);
  };
  const tagSel = async remove => {
    const tag = prompt(
      remove ? 'Remove which tag from the selected contacts?' : 'Tag to add to the selected contacts'
    );
    if (!tag || !tag.trim()) return;
    try {
      await api('mail_contacts_tag', { ids, tag: tag.trim(), remove });
      toast(remove ? 'Tag removed.' : 'Tag added.');
      reload();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const delSel = async () => {
    if (!confirm(`Delete ${plural(ids.length, 'contact')}? This can't be undone.`)) return;
    try {
      await api('mail_contacts_delete', { ids });
      toast('Deleted.');
      reload();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const exportAll = async () => {
    setBusy(true);
    try {
      const out = [
        [
          'Name',
          'Email',
          'Phone',
          'Company',
          'Title',
          'City',
          'Tags',
          'Source',
          'Notes',
          'Added',
          'Last emailed',
          'Unsubscribed',
        ],
      ];
      for (let off = 0; ; off += 1000) {
        const r = await api('mail_contacts', { ...f, offset: off, limit: 1000 });
        r.rows.forEach(c =>
          out.push([
            c.name,
            c.email,
            c.phone,
            c.company,
            c.title,
            c.city,
            c.tags.join(', '),
            c.source,
            c.notes,
            dkey(new Date(c.created)),
            c.lastSent ? dkey(new Date(c.lastSent)) : '',
            c.unsub ? 'Yes' : '',
          ])
        );
        if (r.rows.length < 1000) break;
      }
      await saveDownload(`contacts-${dkey()}.csv`, toCSV(out));
    } catch (e) {
      if (!e || e.code !== 'declined') toast(errText(e), true);
    }
    setBusy(false);
  };
  const tags = res ? Object.entries(res.tags) : [];
  return html`<div className="stack">
      <div className="toolbar">
        <input type="search" style=${{ maxWidth: 280 }} placeholder="Search name, email, company, title" value=${f.q} onInput=${e => set({ q: e.target.value })} aria-label="Search contacts" />
        <select value=${f.tag} onChange=${e => set({ tag: e.target.value })} aria-label="Tag">
          <option value="">All tags</option>
          ${tags.map(([t, n]) => html`<option key=${t} value=${t}>${t} (${n})</option>`)}
        </select>
        <select value=${f.status} onChange=${e => set({ status: e.target.value })} aria-label="Subscription">
          <option value="">Everyone</option>
          <option value="subscribed">Subscribed</option>
          <option value="unsub">Unsubscribed</option>
        </select>
        <div className="push">
          ${onValidate && html`<button className="btn ghost" onClick=${onValidate}><${Icon} n="check" />Email validation</button>`}
          ${onCleanup && html`<button className="btn ghost" onClick=${onCleanup}><${Icon} n="trash" />Contact cleanup</button>`}
          <button className="btn ghost" disabled=${busy || !res || !res.total} onClick=${exportAll}>
            <${Icon} n="down" />
            ${busy ? 'Exporting…' : 'Export CSV'}
          </button>
          <button className="btn ghost" onClick=${() => (impCan('mail') ? (location.hash = impHref('mail')) : setImp(true))}>
            <${Icon} n="up" />Import</button>
          <button className="btn" onClick=${() => setEdit(null)}>
            <${Icon} n="plus" />Add contact</button>
        </div>
      </div>
      ${
        ids.length > 0 &&
        html`<div className="note info">
            <span>
              <b>
                ${plural(ids.length, 'contact')} selected.</b>
            </span>
            <div className="actions">
              <button className="btn sm" onClick=${() => onEmail(rows.filter(r => sel[r.id] && !r.unsub).map(r => ({ email: r.email, name: r.name })))}>
                <${Icon} n="send" />Email selected</button>
              ${onValidate && html`<button className="btn ghost sm" title="Verify the selected email addresses before sending" onClick=${() => onValidate(rows.filter(r => sel[r.id]).map(r => ({ email: r.email, name: r.name })))}><${Icon} n="check" />Validate selected</button>`}
              <button className="btn ghost sm" onClick=${() => tagSel(false)}>Add tag</button>
              <button className="btn ghost sm" onClick=${() => tagSel(true)}>Remove tag</button>
              <button className="btn danger sm" onClick=${delSel}>Delete</button>
            </div>
          </div>`
      }
      <section className="panel" style=${{ padding: '6px 8px' }}>
        ${
          !res
            ? html`<${Spinner} />`
            : rows.length
              ? html`<div className="tblwrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th style=${{ width: 30 }}>
                          <input type="checkbox" aria-label="Select all on this page" checked=${allOn} onChange=${e => {
                            const o = { ...sel };
                            rows.forEach(r => {
                              o[r.id] = e.target.checked;
                            });
                            setSel(o);
                          }} />
                        </th>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Phone</th>
                        <th>Company</th>
                        <th>Title</th>
                        <th>City</th>
                        <th>Tags</th>
                        <th>Source</th>
                        <th>Added</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${rows.map(
                        c => html`<tr key=${c.id} className="click" onClick=${() => setEdit(c)}>
                            <td onClick=${e => e.stopPropagation()}>
                              <input type="checkbox" aria-label=${'Select ' + c.email} checked=${!!sel[c.id]} onChange=${e => setSel({ ...sel, [c.id]: e.target.checked })} />
                            </td>
                            <td>
                              <b style=${{ fontWeight: 600 }}>
                                ${c.name || '—'}
                              </b>
                            </td>
                            <td className="small">
                              ${c.email}
                            </td>
                            <td className="small nw">
                              ${c.phone}
                            </td>
                            <td className="small">
                              ${c.company}
                            </td>
                            <td className="small">
                              ${c.title}
                            </td>
                            <td className="small">
                              ${c.city}
                            </td>
                            <td>
                              <div className="actions" style=${{ gap: 4 }}>
                                ${c.tags.map(t => html`<span key=${t} className="chip">${t}</span>`)}
                              </div>
                            </td>
                            <td className="small muted">
                              ${c.source}
                            </td>
                            <td className="num small nw">
                              ${fmtDay(c.created)}
                            </td>
                            <td>
                              ${c.unsub ? html`<${Chip} s="red">${c.unsub === 'bounced' ? 'Bounced' : 'Unsubscribed'}<//>` : html`<${Chip} s="ok">Subscribed<//>`}
                            </td>
                          </tr>`
                      )}
                    </tbody>
                  </table>
                </div>`
              : html`<${Empty} title=${res.all ? 'No contacts match' : 'No contacts yet'} action=${
                  !res.all &&
                  html`<div className="actions" style=${{ justifyContent: 'center' }}>
                      <button className="btn" onClick=${() => setImp(true)}>Import a CSV</button>
                      <button className="btn ghost" onClick=${() => setEdit(null)}>Add one</button>
                    </div>`
                }>
                  ${res.all ? 'Try a different search or tag.' : 'Import your candidates, vendors and clients from a spreadsheet, or add them one at a time. Tags let you email one group at a time.'}
                <//>`
        }
      </section>
      ${
        res &&
        res.total > 50 &&
        html`<div className="actions">
            <button className="btn ghost sm" disabled=${f.offset === 0} onClick=${() => {
              setF({ ...f, offset: Math.max(0, f.offset - 50) });
              setSel({});
            }}>Previous</button>
            <span className="small muted">
              ${f.offset + 1}–${Math.min(res.total, f.offset + 50)} of ${res.total.toLocaleString()}
            </span>
            <button className="btn ghost sm" disabled=${f.offset + 50 >= res.total} onClick=${() => {
              setF({ ...f, offset: f.offset + 50 });
              setSel({});
            }}>Next</button>
          </div>`
      }
      ${
        edit !== undefined &&
        html`<${ContactModal} c=${edit} staff=${P.isAdmin} onClose=${changed => {
          setEdit(undefined);
          if (changed) reload();
        }} />`
      }
      ${
        imp &&
        html`<${ImportContacts} onClose=${changed => {
          setImp(false);
          if (changed) reload();
        }} />`
      }
    </div>`;
}
function ContactModal({ c, staff, onClose }) {
  const toast = useToast();
  const [f, setF] = useState(
    c
      ? { ...c, tags: c.tags.join(', ') }
      : {
          email: '',
          name: '',
          company: '',
          title: '',
          phone: '',
          city: '',
          tags: '',
          source: 'Added by hand',
          notes: '',
        }
  );
  const [busy, setBusy] = useState(false);
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    try {
      await api('mail_contact_save', { ...f, id: c ? c.id : '' });
      toast(c ? 'Contact saved.' : 'Contact added.');
      onClose(true);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const sub = async on => {
    try {
      await api('mail_suppress', { email: c.email, on });
      toast(on ? 'Unsubscribed. Mass email skips this address.' : 'Subscribed again.');
      onClose(true);
    } catch (e) {
      toast(errText(e), true);
    }
  };
  return html`<${Modal} title=${c ? c.name || c.email : 'Add a contact'} onClose=${() => onClose(false)} foot=${html`<button className="btn ghost" onClick=${() => onClose(false)}>Cancel</button>
    <button className="btn" disabled=${busy} onClick=${save}>
      ${busy ? 'Saving…' : 'Save contact'}
    </button>`}>
      <div className="form">
        <div className="row2">
          <${Field} label="Name">
            <input value=${f.name} onInput=${up('name')} />
          <//>
          <${Field} label="Email">
            <input type="email" value=${f.email} onInput=${up('email')} />
          <//>
        </div>
        <div className="row2">
          <${Field} label="Company">
            <input value=${f.company} onInput=${up('company')} />
          <//>
          <${Field} label="Title">
            <input value=${f.title} onInput=${up('title')} />
          <//>
        </div>
        <div className="row2">
          <${Field} label="Phone">
            <input type="tel" value=${f.phone} onInput=${up('phone')} />
          <//>
          <${Field} label="City and state">
            <input value=${f.city} onInput=${up('city')} />
          <//>
        </div>
        <div className="row2">
          <${Field} label="Tags" hint="Separate with commas, e.g. Vendors, Java, NJ">
            <input value=${f.tags} onInput=${up('tags')} />
          <//>
          <${Field} label="Source">
            <input value=${f.source} onInput=${up('source')} />
          <//>
        </div>
        <${Field} label="Notes">
          <textarea value=${f.notes} onInput=${up('notes')} style=${{ minHeight: 70 }} />
        <//>
        ${
          c &&
          html`<div className=${'note ' + (c.unsub ? 'red' : 'ok')}>
              <span>
                ${c.unsub ? `This address is ${c.unsub === 'bounced' ? 'bouncing' : 'unsubscribed'}, so mass email skips it.` : `Subscribed${c.lastSent ? `, last emailed ${fmtDay(c.lastSent)}` : ''}.`}
              </span>
              ${
                staff &&
                html`<div className="actions">
                    <button className="btn ghost sm" onClick=${() => sub(!c.unsub)}>
                      ${c.unsub ? 'Subscribe again' : 'Unsubscribe'}
                    </button>
                  </div>`
              }
            </div>`
        }
      </div>
    <//>`;
}
function ImportContacts({ onClose }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [tag, setTag] = useState('');
  const [prog, setProg] = useState(null);
  const [err, setErr] = useState('');
  const read = async file => {
    setErr('');
    try {
      const text = await file.text();
      const parsed = csvToContacts(parseCSV(text));
      if (!parsed.list.length) {
        setErr('No email addresses were found. Save the sheet as CSV with a column called Email.');
        setData(null);
        return;
      }
      setData({ ...parsed, file: file.name });
      setTag(file.name.replace(/\.[^.]+$/, '').slice(0, 40));
    } catch (e) {
      setErr('That file could not be read. Save it as CSV (comma separated) and try again.');
    }
  };
  const go = async () => {
    const list = data.list;
    const tot = { added: 0, updated: 0, invalid: 0 };
    setProg(0);
    try {
      for (let i = 0; i < list.length; i += 500) {
        const r = await api('mail_contacts_import', {
          rows: list.slice(i, i + 500),
          tag: tag.trim(),
          source: 'Import: ' + data.file,
        });
        tot.added += r.added;
        tot.updated += r.updated;
        tot.invalid += r.invalid;
        setProg(Math.min(1, (i + 500) / list.length));
      }
      toast(
        `${plural(tot.added, 'new contact')} added, ${plural(tot.updated, 'existing contact')} updated${tot.invalid ? `, ${tot.invalid} skipped (no valid email)` : ''}.`
      );
      onClose(true);
    } catch (e) {
      toast(errText(e), true);
      setProg(null);
    }
  };
  const found = data ? Object.keys(data.cols).filter(k => k !== 'first' && k !== 'last') : [];
  return html`<${Modal} title="Import contacts from a spreadsheet" onClose=${() => onClose(false)} foot=${html`<button className="btn ghost" onClick=${() => onClose(false)}>Cancel</button>
    <button className="btn" disabled=${!data || prog !== null} onClick=${go}>
      ${prog !== null ? `Importing… ${Math.round(prog * 100)}%` : data ? `Import ${plural(data.list.length, 'contact')}` : 'Import'}
    </button>`}>
      <div className="stack" style=${{ gap: 14 }}>
        <p className="muted small">Save the sheet from Excel or Google Sheets as CSV. Columns are matched by their headings: Email (required), Name or First/Last name, Company, Title, Phone, City, Tags, Notes. Existing contacts keep their details; blank fields are filled in and tags are added.</p>
        <${FilePick} label="Drop a CSV file here, or choose one." hint="CSV, up to a few thousand rows at a time." onFiles=${files => read(files[0])} />
        ${err && html`<p className="err" role="alert">${err}</p>`}
        ${
          data &&
          html`<div className="note info">
              <span>
                <b>
                  ${plural(data.list.length, 'contact')} found in ${data.file}.</b> Columns matched: ${found.join(', ')}.</span>
            </div>
            <${Field} label="Tag everyone in this file" hint="Use tags to email one group at a time, e.g. Vendors, Java bench, Clients NJ.">
              <input value=${tag} onInput=${e => setTag(e.target.value)} />
            <//>`
        }
        ${prog !== null && html`<div className="prog"><b style=${{ width: Math.round(prog * 100) + '%' }} /></div>`}
      </div>
    <//>`;
}

/* ---- sent log: every email the site sends ---- */
function MailLog() {
  const toast = useToast();
  const [f, setF] = useState({ q: '', status: '', kind: '', offset: 0 });
  const [res, setRes] = useState(null);
  const [tick, setTick] = useState(0);
  const key = JSON.stringify(f);
  useEffect(() => {
    const t = setTimeout(
      () =>
        api('mail_log', { ...f, limit: 50 })
          .then(setRes)
          .catch(e => toast(errText(e), true)),
      f.q ? 300 : 0
    );
    return () => clearTimeout(t);
  }, [key, tick]);
  const set = patch => setF({ ...f, offset: 0, ...patch });
  return html`<div className="stack">
      ${
        res &&
        html`<div className="kpis" style=${{ gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))' }}>
            <a>
              <b>
                ${res.sent24.toLocaleString()}${res.limit ? ` / ${res.limit.toLocaleString()}` : ''}
              </b>
              <span>Sent in the last 24 hours${res.limit ? ' (daily limit)' : ''}
              </span>
            </a>
            <a>
              <b>
                ${res.failed24.toLocaleString()}
              </b>
              <span>Failed in the last 24 hours</span>
            </a>
            <a>
              <b>
                ${res.total.toLocaleString()}
              </b>
              <span>
                ${f.q || f.status || f.kind ? 'Matching emails' : 'Emails logged'}
              </span>
            </a>
          </div>`
      }
      <div className="toolbar">
        <input type="search" style=${{ maxWidth: 260 }} placeholder="Search recipient or subject" value=${f.q} onInput=${e => set({ q: e.target.value })} aria-label="Search the sent log" />
        <select value=${f.status} onChange=${e => set({ status: e.target.value })} aria-label="Result">
          <option value="">Sent and failed</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
        </select>
        <select value=${f.kind} onChange=${e => set({ kind: e.target.value })} aria-label="Type">
          <option value="">Every type</option>
          ${((res && res.kinds) || []).map(k => html`<option key=${k} value=${k}>${MAIL_KIND[k] || k || 'Other'}</option>`)}
        </select>
        <div className="push">
          <button className="btn ghost" onClick=${() => setTick(t => t + 1)}>Refresh</button>
        </div>
      </div>
      <section className="panel" style=${{ padding: '6px 8px' }}>
        ${
          !res
            ? html`<${Spinner} />`
            : res.rows.length
              ? html`<div className="tblwrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>To</th>
                        <th>Subject</th>
                        <th>Type</th>
                        <th>Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${res.rows.map(
                        (r, i) => html`<tr key=${i}>
                            <td className="num small nw">
                              ${fmtTs(+r.at)}
                            </td>
                            <td>
                              ${r.to_name ? html`<b style=${{ fontWeight: 600 }}>${r.to_name}</b><div className="muted small">${r.to_email}</div>` : html`<span className="small">${r.to_email}</span>`}
                            </td>
                            <td className="small">
                              ${r.subject}
                            </td>
                            <td className="small">
                              ${MAIL_KIND[r.kind] || r.kind || 'Other'}
                            </td>
                            <td>
                              ${r.status === 'sent' ? html`<${Chip} s="ok">Sent<//>` : html`<${Chip} s="red">Failed<//><div className="muted small" style=${{ maxWidth: 360 }}>${r.err}</div>`}
                            </td>
                          </tr>`
                      )}
                    </tbody>
                  </table>
                </div>`
              : html`<${Empty} title="Nothing logged yet">Every email the website sends (invoices, signature requests, paystubs, daily reports, mass email) is listed here with its result.<//>`
        }
      </section>
      ${
        res &&
        res.total > 50 &&
        html`<div className="actions">
            <button className="btn ghost sm" disabled=${f.offset === 0} onClick=${() => setF({ ...f, offset: Math.max(0, f.offset - 50) })}>Previous</button>
            <span className="small muted">
              ${f.offset + 1}–${Math.min(res.total, f.offset + 50)} of ${res.total.toLocaleString()}
            </span>
            <button className="btn ghost sm" disabled=${f.offset + 50 >= res.total} onClick=${() => setF({ ...f, offset: f.offset + 50 })}>Next</button>
          </div>`
      }
    </div>`;
}

/* ---- sending settings (administrators) ---- */
const MAIL_BULK = ['mailgun', 'postal', 'ses_api', 'sendgrid', 'brevo', 'ses'];
const MAIL_API = ['mailgun', 'postal', 'ses_api', 'm365'];
/* v41: back from connecting the company's Microsoft 365 mailbox (?m365=<how it went>) */
const MAIL_M365_BACK = {
  denied: 'Connecting Microsoft 365 was cancelled.',
  norefresh: 'Microsoft gave access for an hour only. Remove the portal from the apps with access to that Microsoft account, then connect again.',
  expired: 'That took too long or started in another tab. Connect Microsoft 365 again.',
  refused: 'Microsoft refused the connection. Check the Microsoft app under Roles & access › Sign-in providers.',
  token: 'Microsoft 365 could not be connected: Microsoft did not hand over access. Try again.',
  profile: 'Microsoft 365 could not be connected: the account did not give its email address. Try again.',
};
const MAIL_PRESET_HOST = { sendgrid: 'smtp.sendgrid.net', brevo: 'smtp-relay.brevo.com', ses: 'email-smtp.us-east-1.amazonaws.com' };
const SES_REGIONS = ['us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'ca-central-1', 'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'eu-north-1', 'eu-south-1', 'ap-south-1', 'ap-northeast-1', 'ap-northeast-2', 'ap-northeast-3', 'ap-southeast-1', 'ap-southeast-2', 'ap-southeast-3', 'sa-east-1', 'me-south-1', 'af-south-1', 'il-central-1'];
/** "Last event: 2 min ago (MessageSent for …)" for the delivery-event addresses. */
function HookSeen({ seen }) {
  if (!seen || !seen.at) return html`<p className="muted small" style=${{ margin: 0 }}>No delivery events have arrived yet. Once the address is set up, the first send shows here.</p>`;
  return html`<p className="small" style=${{ margin: 0 }}><${Chip} s="ok">Working<//> Last event ${fmtTs(seen.at)}: ${seen.what} · ${(seen.n || 0).toLocaleString()} received</p>`;
}
function MailSettings({ onSaved }) {
  const toast = useToast();
  const me = Cap.me || {};
  const [f, setF] = useState(null);
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState('');
  const [to, setTo] = useState(me.email || '');
  const [result, setResult] = useState(null);
  const load = () =>
    api('mail_settings')
      .then(r => {
        setS(r);
        setF({
          provider: r.provider === 'config' ? 'gmail' : r.provider,
          host: r.provider === 'postal' ? '' : r.host,
          domain: r.provider === 'mailgun' ? r.host : '',
          postalUrl: r.provider === 'postal' ? r.host : '',
          region: r.provider === 'ses_api' ? 'us' : r.region || 'us',
          awsRegion: r.provider === 'ses_api' ? r.region : 'us-east-1',
          whk: '',
          port: r.port,
          secure: r.secure,
          user: r.user,
          pass: '',
          from: r.from === r.user ? '' : r.from,
          fromName: r.fromName,
          limit: r.limit || '',
          gap: r.gap,
          rate: r.rate || '',
          pkey: r.pkey || '',
          cset: r.cset || '',
          topic: r.topic || '',
          ip: r.ip || '',
          dkimSel: r.dkimSel || '',
        });
        if (r.status && r.status.test) setResult(r.status.test);
      })
      .catch(e => toast(errText(e), true));
  useEffect(() => {
    load();
    const m = /[?&]m365=([a-z]+)/.exec(location.hash || '');
    if (m) {
      if (m[1] === 'connected') toast('Microsoft 365 is connected: the portal sends as that mailbox now. Send a test email below.');
      else toast(MAIL_M365_BACK[m[1]] || 'Microsoft 365 could not be connected. Try again.', true);
      try {
        history.replaceState(null, '', location.pathname + location.search + location.hash.replace(/&m365=[a-z]+/, ''));
      } catch (e) {
        /* the address keeps it */
      }
    }
  }, []);
  if (!f) return html`<${Spinner} />`;
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const p = f.provider;
  const google = p === 'gmail' || p === 'workspace';
  const mg = p === 'mailgun';
  const postal = p === 'postal';
  const sesApi = p === 'ses_api';
  const apiP = MAIL_API.includes(p);
  const preset = MAIL_PRESET_HOST[p];
  const pick = k =>
    setF({
      ...f,
      provider: k,
      limit: k === 'gmail' ? 450 : k === 'workspace' ? 1900 : k === 'm365' ? (s && s.provider === 'm365' ? s.limit : 5000) : MAIL_BULK.includes(k) ? 0 : f.limit,
      gap: MAIL_BULK.includes(k) ? 0 : f.gap || 1,
      rate: k === 'ses_api' ? f.rate || 10 : k === 'postal' ? f.rate || 20 : k === 'm365' ? (s && s.provider === 'm365' ? s.rate : 0.4) : f.rate,
      ...(k === 'gmail' || k === 'workspace' || k === 'host' ? { port: 465, secure: 'ssl' } : k === 'smtp' || preset || MAIL_PRESET_HOST[k] ? { port: 587, secure: 'tls' } : {}),
      ...(k === 'sendgrid' ? { user: 'apikey' } : f.user === 'apikey' ? { user: '' } : {}),
    });
  const save = async () => {
    setBusy('save');
    try {
      await api('mail_settings_save', { ...f, from: f.from || '', limit: +f.limit || 0, gap: +f.gap || 0, rate: +f.rate || 0 });
      toast('Email settings saved.');
      onSaved && onSaved();
      await load();
      return true;
    } catch (e) {
      toast(errText(e), true);
      return false;
    } finally {
      setBusy('');
    }
  };
  const test = async () => {
    if (!(await save())) return;
    setResult(null);
    setBusy('test');
    try {
      const r = await api('mail_test', { to });
      setResult(r);
      toast(r.ok ? `Test email sent to ${r.to}.` : 'The test email did not send. See the details below.', !r.ok);
      load();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const copy = t =>
    navigator.clipboard
      ? navigator.clipboard.writeText(t).then(
          () => toast('Copied.'),
          () => toast(t)
        )
      : toast(t);
  const same = s && s.provider === p;
  const savedPass = same && s.hasPass && (apiP || s.user === f.user);
  const userLabel = google ? (p === 'gmail' ? 'Gmail address' : 'Google Workspace address') : p === 'sendgrid' ? 'Username' : p === 'brevo' ? 'Brevo login email' : p === 'ses' ? 'SMTP username' : 'Username';
  const passLabel = google ? 'App password' : p === 'sendgrid' ? 'SendGrid API key' : p === 'brevo' ? 'SMTP key' : p === 'ses' ? 'SMTP password' : 'Password';
  const acct = (result && result.account) || (same && s.ses);
  const linkRow = (n, u) => html`<div key=${n} className="linkrow"><b>${n}</b><code>${u}</code><button type="button" className="btn ghost sm" onClick=${() => copy(u)}>Copy</button></div>`;
  return html`<div className="stack">
      <section className="panel stack" style=${{ gap: 14 }}>
        <h2 className="ph">How the website sends email</h2>
        <p className="muted small">Invoices, signature requests, paystubs, daily reports, job shares and mass email all go out through this connection, and every message is recorded in the Sent log. For large lists use your own Postal server, Amazon SES or Mailgun: Gmail stops at its daily limit. The Deliverability tab checks the domain and keeps sending safe.</p>
        ${
          s &&
          s.viaProvider &&
          html`<p className="note ok" role="status"><span><b>Your email is sent for you for now.</b> Until you connect your own mail service here, the StratEdge Workspaces service sends this portal's email under your company's name, with replies going to your contact address. Connect your own so messages come from your address.</span></p>`
        }
        <div className="rolepick" role="radiogroup" aria-label="Email service">
          ${PROVIDERS.map(
            ([k, t, d]) => html`<label key=${k} className=${p === k ? 'on' : ''}>
                <input type="radio" name="provider" checked=${p === k} onChange=${() => pick(k)} />
                <div><b>${t}</b><span>${d}</span></div>
              </label>`
          )}
        </div>
      </section>
      ${
        google &&
        html`<section className="panel stack" style=${{ gap: 12 }}>
            <h2 className="ph">Connect ${p === 'gmail' ? 'Gmail' : 'Google Workspace'}</h2>
            <ol className="small" style=${{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
              <li>Sign in to the Google account you want to send from and turn on <b>2-Step Verification</b> (Google Account › Security).</li>
              <li>Open <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">myaccount.google.com/apppasswords</a>, name it "StratEdge website" and create it.</li>
              <li>Copy the 16-character app password into the box below. Spaces are fine.</li>
              ${p === 'workspace' && html`<li>If App passwords is missing, your Google Workspace administrator has to allow app passwords for this account.</li>`}
            </ol>
          </section>`
      }
      ${
        p === 'm365' &&
        html`<section className="panel stack" style=${{ gap: 12 }}>
            <h2 className="ph">Connect Microsoft 365</h2>
            ${same && s.user ? html`<p className="note ok" role="status"><span><b>Connected: ${s.user}.</b> The portal sends as this mailbox through Microsoft Graph, and Microsoft renews the access by itself.</span></p>` : null}
            <ol className="small" style=${{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
              <li>The Microsoft app is set up once under Roles & access › Sign-in providers (Microsoft); for sending it needs the delegated Microsoft Graph permissions <b>Mail.Send</b> and <b>offline_access</b>.</li>
              <li>Press <b>Connect with Microsoft</b> and sign in as the mailbox the portal sends from, for example info@ or hr@ your domain. Microsoft asks for permission once.</li>
              <li>Check the sender name and limit below, save, and send a test email.</li>
            </ol>
            <div className="actions">${
              s && s.msReady
                ? html`<a className="btn" href=${API + 'sso_start&p=microsoft&connect=sysmail'}>${same && s.user ? 'Connect a different mailbox' : 'Connect with Microsoft'}</a>`
                : html`<p className="note amber small" style=${{ margin: 0 }}><span>Set up the Microsoft app under Roles & access › Sign-in providers first.</span></p>`
            }</div>
            <p className="muted small" style=${{ margin: 0 }}>Why not an SMTP password: Microsoft is switching off password (Basic) sign-in for SMTP. It is off by default for existing Microsoft 365 organizations from the end of December 2026 (an administrator can still turn it back on for a while), and the final removal date is to be announced in the second half of 2027. Connecting with Microsoft is not affected.</p>
          </section>
          ${
            same &&
            s.user &&
            html`<section className="panel form">
              <div className="row3">
                <${Field} label="From address" hint="Leave blank for the connected mailbox; another address only if the mailbox may send as it (an alias, or Send As rights)."><input type="email" value=${f.from} onInput=${up('from')} placeholder=${s.user} /><//>
                <${Field} label="Sender name"><input value=${f.fromName} onInput=${up('fromName')} placeholder="StratEdge IT Consulting" /><//>
                <${Field} label="Daily sending limit" hint="Exchange Online allows up to 10,000 recipients a day per mailbox."><input type="number" min="0" value=${f.limit} onInput=${up('limit')} /><//>
              </div>
            </section>`
          }`
      }
      ${
        mg &&
        html`<section className="panel stack" style=${{ gap: 12 }}>
            <h2 className="ph">Connect Mailgun</h2>
            <ol className="small" style=${{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
              <li>In Mailgun, add a sending domain such as <b>mg.stratedgeitconsulting.com</b> and add the DNS records it shows (SPF, DKIM, MX) in cPanel › Zone Editor, then verify it.</li>
              <li>Copy the private API key (Mailgun › API Security) and the HTTP webhook signing key (Mailgun › Webhooks) into the boxes below.</li>
              <li>Under Webhooks, add the delivery-events address below for Delivered, Permanent failure, Temporary failure, Spam complaints and Unsubscribes. Bounces and complaints are then skipped automatically.</li>
              <li>To get replies in the portal Inbox, create a Route (Receiving › Routes): match the recipient you send from and choose Forward to the inbound address below.</li>
            </ol>
            ${[
              ['Delivery events', s && s.webhookUrl],
              ['Inbound mail', s && s.inboundUrl],
            ].map(([n, u]) => linkRow(n, u))}
            <${HookSeen} seen=${s && s.hooks && s.hooks.mailgun} />
          </section>
          <section className="panel form">
            <div className="row3">
              <${Field} label="Sending domain"><input value=${f.domain} onInput=${up('domain')} placeholder="mg.stratedgeitconsulting.com" /><//>
              <${Field} label="Region">
                <select value=${f.region} onChange=${up('region')}><option value="us">US (api.mailgun.net)</option><option value="eu">EU (api.eu.mailgun.net)</option></select>
              <//>
              <${Field} label="Seconds between mass emails" hint="0 sends as fast as Mailgun accepts."><input type="number" min="0" max="10" step="0.1" value=${f.gap} onInput=${up('gap')} /><//>
            </div>
            <div className="row2">
              <${Field} label="Private API key" hint=${savedPass ? 'Saved. Leave blank to keep it.' : 'From Mailgun › API Security.'}>
                <input type="password" value=${f.pass} onInput=${up('pass')} autoComplete="new-password" placeholder=${savedPass ? '••••••••••••••••' : ''} />
              <//>
              <${Field} label="Webhook signing key" hint=${same && s.hasWhk ? 'Saved. Leave blank to keep it.' : 'Lets the portal trust delivery events and inbound mail.'}>
                <input type="password" value=${f.whk} onInput=${up('whk')} autoComplete="new-password" placeholder=${same && s.hasWhk ? '••••••••••••••••' : ''} />
              <//>
            </div>
            <div className="row3">
              <${Field} label="From address" hint="An address on the Mailgun domain or your main domain."><input type="email" value=${f.from} onInput=${up('from')} placeholder="info@stratedgeitconsulting.com" /><//>
              <${Field} label="Sender name"><input value=${f.fromName} onInput=${up('fromName')} placeholder="StratEdge IT Consulting" /><//>
              <${Field} label="Daily sending limit" hint="0 means no limit; your Mailgun plan still applies."><input type="number" min="0" value=${f.limit} onInput=${up('limit')} /><//>
            </div>
          </section>`
      }
      ${
        postal &&
        html`<section className="panel stack mailguide" style=${{ gap: 12 }}>
            <h2 className="ph">Connect your own mail server (Postal)</h2>
            <p className="small" style=${{ margin: 0 }}>Postal is free, open-source mail server software: "your own Mailgun". It runs on a server you rent, sends as many emails as that server and its reputation allow, with no per-email fees, and reports every bounce back here.</p>
            <details>
              <summary><b>Set up Postal on your own server</b> (about an hour for someone comfortable with Linux)</summary>
              <ol className="small">
                <li><b>Rent a server</b> with at least 4 GB of memory, 2 CPU cores and 25 GB of disk, from a company that lets it send on port 25. Many block port 25 on new servers until you ask: DigitalOcean, Vultr, Linode, Hetzner and AWS each have a support request for it; Google Cloud and Azure generally don't allow it. Ask before you pay.</li>
                <li><b>Name it:</b> add an A record <code>postal.stratedgeitconsulting.com</code> pointing to the server's IP address, and ask the provider to set the IP's reverse DNS (PTR) to that same name.</li>
                <li><b>Install it</b> following docs.postalserver.io › Getting started: Docker, MariaDB 10.6 or newer, then <code>postal bootstrap postal.stratedgeitconsulting.com</code>, <code>postal initialize</code>, <code>postal make-user</code> and <code>postal start</code>, with Caddy in front for HTTPS.</li>
                <li><b>Publish the server's DNS records</b> the guide lists (the SPF include <code>spf.postal…</code>, the return path <code>rp.postal…</code>, routes, and the DKIM key from <code>postal default-dkim-record</code>).</li>
                <li><b>In Postal's web interface:</b> create an organization and a mail server (mode Live), add your sending domain (your main domain, or a subdomain such as <code>mail.stratedgeitconsulting.com</code> to keep bulk email apart from everyday email), and publish its SPF, DKIM, return-path and MX records until every one shows green.</li>
                <li><b>Credentials</b> › add one with the type <b>API</b> and paste its key below. <b>Webhooks</b> › add the delivery-events address below with all events.</li>
                <li><b>Replies in the portal Inbox</b> (and replies to service desk tickets): <b>Routes</b> › HTTP endpoints › add the incoming-email address below with the format <b>Hash</b>, then add a route for the address you send from (or <code>*</code> on your domain) to that endpoint, and point the domain's MX record to Postal as its guide shows.</li>
                <li>Turn on <b>warm-up</b> under Deliverability and start small: a new IP that suddenly sends thousands of emails is treated like a spammer.</li>
              </ol>
            </details>
            ${linkRow('Delivery events', s && s.postalHook)}
            <${HookSeen} seen=${s && s.hooks && s.hooks.postal} />
            ${linkRow('Incoming email', s && s.postalInbound)}
            ${s && s.hooks && s.hooks.postalIn && html`<${HookSeen} seen=${s.hooks.postalIn} />`}
            ${same && s.jwks && html`<p className="small muted" style=${{ margin: 0 }}>${s.jwks.ok ? 'The webhook signing key was read from your Postal server.' : 'The signing key could not be read from your Postal server yet (it publishes it at /.well-known/jwks.json); paste it below if your Postal version is older.'}</p>`}
          </section>
          <section className="panel form">
            <div className="row2">
              <${Field} label="Postal server address" hint="The address you open Postal's web interface at."><input value=${f.postalUrl} onInput=${up('postalUrl')} placeholder="https://postal.stratedgeitconsulting.com" /><//>
              <${Field} label="API key" hint=${savedPass ? 'Saved. Leave blank to keep it.' : 'Postal › your mail server › Credentials, type API.'}>
                <input type="password" value=${f.pass} onInput=${up('pass')} autoComplete="new-password" placeholder=${savedPass ? '••••••••••••••••' : ''} />
              <//>
            </div>
            <div className="row3">
              <${Field} label="From address" hint="On a domain added to your Postal server."><input type="email" value=${f.from} onInput=${up('from')} placeholder="team@stratedgeitconsulting.com" /><//>
              <${Field} label="Sender name"><input value=${f.fromName} onInput=${up('fromName')} placeholder="StratEdge IT Consulting" /><//>
              <${Field} label="Emails a second" hint="How fast the site hands email to Postal; Postal then delivers at its own pace. 0 = no limit."><input type="number" min="0" max="500" step="1" value=${f.rate} onInput=${up('rate')} /><//>
            </div>
            <div className="row3">
              <${Field} label="Sending IP address (optional)" hint="Used to check its reverse DNS and blocklists."><input value=${f.ip} onInput=${up('ip')} placeholder="203.0.113.25" /><//>
              <${Field} label="DKIM selector (optional)" hint="The postal-xxxxxx part of the domain's DKIM record."><input value=${f.dkimSel} onInput=${up('dkimSel')} placeholder="postal-ab12cd" /><//>
              <${Field} label="Daily sending limit" hint="0 means no limit (warm-up still applies)."><input type="number" min="0" value=${f.limit} onInput=${up('limit')} /><//>
            </div>
            <${Field} label="Webhook public key (optional)" hint="Leave empty: the site reads the key your Postal server publishes. For an older Postal, paste the p= value from postal default-dkim-record.">
              <textarea rows="2" value=${f.pkey} onInput=${up('pkey')} placeholder="MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQ…" />
            <//>
          </section>`
      }
      ${
        sesApi &&
        html`<section className="panel stack mailguide" style=${{ gap: 12 }}>
            <h2 className="ph">Connect Amazon SES (API)</h2>
            <p className="small" style=${{ margin: 0 }}>Amazon SES sends from Amazon's well-kept servers for about $0.10 per 1,000 emails, many at a time, and reports bounces and spam complaints back here.</p>
            <details open=${!(same && s.hasPass)}>
              <summary><b>Set up Amazon SES</b></summary>
              <ol className="small">
                <li>In the AWS console open <b>Amazon SES</b> in the region you want (for example US East, N. Virginia: us-east-1) › <b>Identities</b> › Create identity › <b>Domain</b>, enter your domain, and publish the three <b>Easy DKIM</b> CNAME records in cPanel › Zone Editor until it shows Verified. A custom MAIL FROM domain is optional and also aligns SPF.</li>
                <li>New accounts start in a <b>sandbox</b> (200 emails a day, only to verified addresses): on the <b>Account dashboard</b> choose <b>Request production access</b> and describe how people sign up and unsubscribe.</li>
                <li>In <b>IAM</b> › Users › create a user with the <b>AmazonSESFullAccess</b> policy (or one allowing ses:SendEmail, ses:SendRawEmail, ses:GetAccount and ses:ListSuppressedDestinations) › Security credentials › <b>Create access key</b>, and paste both parts below.</li>
                <li>For bounces and complaints: in <b>SNS</b> create a Standard topic (for example ses-events) and an <b>HTTPS subscription</b> to the address below; the site confirms it by itself. Then in SES › <b>Configuration sets</b> create one (for example bulk) with an event destination to that topic for Bounce, Complaint and Delivery, and write its name below.</li>
              </ol>
            </details>
            ${linkRow('SNS subscription', s && s.sesHook)}
            <${HookSeen} seen=${s && s.hooks && s.hooks.ses} />
            ${
              acct &&
              (acct.ok
                ? html`<div className=${'note ' + (acct.production ? 'ok' : 'amber')}>
                    <span>${acct.production ? html`<b>Production access.</b>` : html`<b>Sandbox:</b> only verified addresses receive email until Amazon grants production access.`} Up to ${(acct.max24 || 0).toLocaleString()} emails in 24 hours (${(acct.sent24 || 0).toLocaleString()} sent), ${acct.rate} a second.${acct.rate && f.rate && +f.rate > acct.rate ? html` <b>Set "Emails a second" to ${Math.floor(acct.rate)} or less.</b>` : ''}</span>
                  </div>`
                : html`<div className="note red"><span><b>The account could not be read.</b> ${acct.err}</span></div>`)
            }
          </section>
          <section className="panel form">
            <div className="row3">
              <${Field} label="Region">
                <input list="ses-regions" value=${f.awsRegion} onInput=${up('awsRegion')} placeholder="us-east-1" />
                <datalist id="ses-regions">${SES_REGIONS.map(r => html`<option key=${r} value=${r} />`)}</datalist>
              <//>
              <${Field} label="Access key ID"><input value=${f.user} onInput=${up('user')} autoComplete="off" placeholder="AKIA…" /><//>
              <${Field} label="Secret access key" hint=${savedPass ? 'Saved. Leave blank to keep it.' : ''}>
                <input type="password" value=${f.pass} onInput=${up('pass')} autoComplete="new-password" placeholder=${savedPass ? '••••••••••••••••' : ''} />
              <//>
            </div>
            <div className="row3">
              <${Field} label="From address" hint="An address or domain verified in SES."><input type="email" value=${f.from} onInput=${up('from')} placeholder="team@stratedgeitconsulting.com" /><//>
              <${Field} label="Sender name"><input value=${f.fromName} onInput=${up('fromName')} placeholder="StratEdge IT Consulting" /><//>
              <${Field} label="Emails a second" hint="Keep at or under the account's maximum send rate."><input type="number" min="0" max="500" step="1" value=${f.rate} onInput=${up('rate')} /><//>
            </div>
            <div className="row3">
              <${Field} label="Configuration set (optional)" hint="Sends bounce, complaint and delivery events to SNS."><input value=${f.cset} onInput=${up('cset')} placeholder="bulk" /><//>
              <${Field} label="SNS topic ARN (optional)" hint="Filled in by itself when the subscription is confirmed; only this topic is trusted."><input value=${f.topic} onInput=${up('topic')} placeholder="arn:aws:sns:us-east-1:123456789012:ses-events" /><//>
              <${Field} label="Daily sending limit" hint="0 = the account's own quota."><input type="number" min="0" value=${f.limit} onInput=${up('limit')} /><//>
            </div>
            <${Field} label="DKIM selector (optional)" hint="One of the three Easy DKIM names (the part before ._domainkey), for the domain check.">
              <input value=${f.dkimSel} onInput=${up('dkimSel')} placeholder="abcdefghijklmnop" />
            <//>
          </section>`
      }
      ${
        !apiP &&
        p !== 'php' &&
        html`<section className="panel form">
            ${
              !google &&
              (preset
                ? html`<p className="muted small" style=${{ margin: 0 }}>Server <b>${preset}</b>, port 587 with STARTTLS. ${p === 'sendgrid' ? 'The username is always "apikey"; paste a SendGrid API key with Mail Send permission as the password.' : p === 'brevo' ? 'Use your Brevo login email and an SMTP key from Brevo › SMTP & API.' : 'Create SMTP credentials in the SES console (they differ from your AWS keys) and verify the From address or domain in SES.'}</p>`
                : html`<div className="row3">
                    <${Field} label="Mail server" hint=${p === 'host' ? 'Usually mail.yourdomain.com (cPanel › Email Accounts › Connect Devices).' : 'From your email provider, e.g. smtp.zoho.com'}>
                      <input value=${f.host} onInput=${up('host')} placeholder=${p === 'host' ? 'mail.stratedgeitconsulting.com' : 'smtp.example.com'} />
                    <//>
                    <${Field} label="Port"><input type="number" value=${f.port} onInput=${up('port')} /><//>
                    <${Field} label="Security">
                      <select value=${f.secure} onChange=${up('secure')}>
                        <option value="ssl">SSL (usually port 465)</option>
                        <option value="tls">STARTTLS (usually port 587)</option>
                        <option value="none">None (not recommended)</option>
                      </select>
                    <//>
                  </div>`)
            }
            ${
              google &&
              html`<${Field} label="Connection" hint="Use STARTTLS on port 587 if your host blocks port 465.">
                  <select value=${f.secure + ':' + f.port} onChange=${e => {
                    const [sec, port] = e.target.value.split(':');
                    setF({ ...f, secure: sec, port: +port });
                  }}>
                    <option value="ssl:465">SSL, port 465 (recommended)</option>
                    <option value="tls:587">STARTTLS, port 587</option>
                  </select>
                <//>`
            }
            <div className="row2">
              <${Field} label=${userLabel} hint=${google ? 'The full address, e.g. info@stratedgeitconsulting.com' : ''}>
                <input type=${p === 'sendgrid' || p === 'ses' ? 'text' : 'email'} value=${f.user} disabled=${p === 'sendgrid'} onInput=${up('user')} autoComplete="off" />
              <//>
              <${Field} label=${passLabel} hint=${savedPass ? 'Saved. Leave blank to keep it, or type a new one.' : google ? 'The 16-character app password, not your normal password.' : ''}>
                <input type="password" value=${f.pass} onInput=${up('pass')} autoComplete="new-password" placeholder=${savedPass ? '••••••••••••••••' : ''} />
              <//>
            </div>
            <div className="row2">
              <${Field} label="Sender name"><input value=${f.fromName} onInput=${up('fromName')} placeholder="StratEdge IT Consulting" /><//>
              <${Field} label=${preset ? 'From address' : 'Send from a different address (optional)'} hint=${google ? 'Only a "Send mail as" address already added in Gmail settings. Leave blank to use the address above.' : preset ? 'A sender address or domain verified with ' + PROVIDERS.find(x => x[0] === p)[1] + '.' : 'Leave blank to send from the username.'}>
                <input type="email" value=${f.from} onInput=${up('from')} />
              <//>
            </div>
            <div className="row2">
              <${Field} label="Daily sending limit" hint=${google ? 'Google allows 500 a day for Gmail and 2,000 for Workspace; staying a little under avoids a lockout.' : 'Emails per 24 hours. 0 means no limit.'}>
                <input type="number" min="0" value=${f.limit} onInput=${up('limit')} />
              <//>
              <${Field} label="Seconds between mass emails" hint="A short pause keeps a mailbox from looking like spam; bulk services can use 0.">
                <input type="number" min="0" max="10" step="0.1" value=${f.gap} onInput=${up('gap')} />
              <//>
            </div>
            ${
              (p === 'host' || p === 'smtp') &&
              html`<div className="row2">
                  <${Field} label="Sending IP address (optional)" hint="For the reverse-DNS and blocklist checks under Deliverability."><input value=${f.ip} onInput=${up('ip')} placeholder="203.0.113.25" /><//>
                  <${Field} label="DKIM selector (optional)" hint="The part before ._domainkey in your DKIM record."><input value=${f.dkimSel} onInput=${up('dkimSel')} placeholder="default" /><//>
                </div>`
            }
          </section>`
      }
      ${
        p === 'php' &&
        html`<div className="note amber"><span>The server's mail() function needs no login, but messages often go to spam or are blocked by Gmail and Outlook. Use it only if nothing else is available.</span></div>`
      }
      <section className="panel stack" style=${{ gap: 12 }}>
        <div className="actions" style=${{ alignItems: 'flex-end' }}>
          <button className="btn ghost" disabled=${!!busy} onClick=${save}>${busy === 'save' ? 'Saving…' : 'Save settings'}</button>
          <${Field} label="Send a test email to"><input type="email" value=${to} onInput=${e => setTo(e.target.value)} style=${{ minWidth: 260 }} /><//>
          <button className="btn" disabled=${!!busy} onClick=${test}><${Icon} n="send" />${busy === 'test' ? 'Sending…' : 'Save and send test'}</button>
        </div>
        ${
          result &&
          html`<div className=${'note ' + (result.ok ? 'ok' : 'red')}>
              <span>${result.ok ? html`<b>Connected.</b> A test email went to ${result.to} on ${fmtTs(result.at)}.` : html`<b>The test email did not send.</b> ${result.error}${result.hint ? html`<br />${result.hint}` : ''}`}</span>
            </div>`
        }
        ${s && s.status && html`<p className="muted small">Sent in the last 24 hours: ${s.status.sent24.toLocaleString()}${s.status.limit ? ` of ${s.status.limit.toLocaleString()}` : ' (no daily limit)'}.${s.status.warm && s.status.warm.on && !s.status.warm.done ? ` Warm-up day ${s.status.warm.day}: up to ${s.status.warm.cap.toLocaleString()} today.` : ''}</p>`}
      </section>
    </div>`;
}

/* ---- v34: Deliverability: inbox health, the domain and server checks, delivery safety and team limits ---- */
const DV_CHIP = { ok: 'ok', warn: 'amber', fail: 'red' };
const DV_WORD = { ok: 'OK', warn: 'Improve', fail: 'Fix now' };
const DV_GROUPS = ['Domain', 'Server', 'Sending', 'Reputation'];
const dvPct = (n, d) => (+(n || 0)).toFixed(d === undefined ? 1 : d).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') + '%';
function MailDeliverability() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState('');
  const [sel, setSel] = useState('');
  const [sf, setSf] = useState(null);
  const [caps, setCaps] = useState({});
  const [teamQ, setTeamQ] = useState('');
  const load = () =>
    api('mail_deliv')
      .then(r => {
        setD(r);
        setSf({ ...r.safety, warmDay: '' });
        setCaps(r.caps || {});
      })
      .catch(e => toast(errText(e), true));
  useEffect(() => {
    load();
  }, []);
  if (!d || !sf) return html`<${Spinner} />`;
  const check = async () => {
    setBusy('check');
    try {
      const r = await api('mail_deliv_check', { sel });
      setD({ ...d, check: r });
      toast(r.sum.fail ? `${r.sum.fail} thing${r.sum.fail === 1 ? '' : 's'} to fix.` : 'Checked.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const save = async () => {
    setBusy('save');
    try {
      await api('mail_safety_save', { ...sf, warmDay: +sf.warmDay || 0, domHour: +sf.domHour || 0, bounceMax: +sf.bounceMax || 5, complaintMax: +sf.complaintMax || 0.3, userDay: +sf.userDay || 0, caps });
      toast('Delivery safety saved.');
      load();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const s30 = d.stats30;
  const s7 = d.stats7;
  const tone = (v, good, bad) => (v <= good ? 'ok' : v <= bad ? 'amber' : 'red');
  const c = d.check;
  const w = d.warm;
  const owner = d.owner;
  const set = (k, v) => setSf({ ...sf, [k]: v });
  return html`<div className="stack dv">
      <section className="panel stack" style=${{ gap: 12 }}>
        <div className="ph-row" style=${{ margin: 0 }}><h2 className="ph">Inbox health</h2><span className="muted small">Last 30 days · sending from ${d.from}</span></div>
        <div className="kpis dvkpis">
          <a><b>${s30.out.toLocaleString()}</b><span>Sent</span></a>
          <a><b>${s30.delivered ? dvPct(s30.deliveredRate) : '—'}</b><span>Confirmed delivered</span></a>
          <a className=${'dv-' + tone(s30.bounceRate, 2, 5)}><b>${dvPct(s30.bounceRate, 2)}</b><span>Bounced · keep under 2%</span></a>
          <a className=${'dv-' + tone(s30.complaintRate, 0.1, 0.3)}><b>${dvPct(s30.complaintRate, 3)}</b><span>Spam complaints · keep under 0.1%</span></a>
        </div>
        <p className="muted small" style=${{ margin: 0 }}>Last 7 days: ${s7.out.toLocaleString()} sent, ${dvPct(s7.bounceRate, 2)} bounced, ${dvPct(s7.complaintRate, 3)} complaints. Gmail and Yahoo filter or refuse bulk email when complaints pass 0.3%; a campaign pauses itself before that (Delivery safety below).</p>
        ${w.on && html`<div className=${'note ' + (w.done ? 'ok' : 'info')}><span>${w.done ? html`<b>Warm-up finished.</b> No warm-up cap any more.` : html`<b>Warm-up day ${w.day} of ${w.days}:</b> up to ${w.cap.toLocaleString()} emails today, ${(w.plan[Math.min(w.days - 1, w.day)] || 0).toLocaleString()} tomorrow.`}</span></div>`}
        ${d.me && d.me.cap > 0 && html`<p className="small" style=${{ margin: 0 }}>Your daily limit: <b>${d.me.cap.toLocaleString()}</b> emails · used today ${d.me.used.toLocaleString()}.</p>`}
        ${d.ses && d.ses.ok && !d.ses.production && html`<div className="note amber"><span><b>Amazon SES sandbox:</b> only verified addresses receive email until Amazon grants production access (SES › Account dashboard).</span></div>`}
        ${d.postalLimit && d.postalLimit.ev === 'SendLimitExceeded' && d.postalLimit.at > Date.now() - 86400000 && html`<div className="note red"><span><b>Your Postal server reached its send limit</b> (${(d.postalLimit.limit || 0).toLocaleString()}). Raise it in Postal or wait for it to reset.</span></div>`}
      </section>
      <section className="panel stack" style=${{ gap: 12 }}>
        <div className="ph-row" style=${{ margin: 0 }}>
          <h2 className="ph">Domain and server checks</h2>
          <div className="actions">
            <input style=${{ width: 190 }} value=${sel} onInput=${e => setSel(e.target.value)} placeholder="DKIM selector (optional)" aria-label="DKIM selector" />
            <button className="btn sm" disabled=${!!busy || !d.staff} onClick=${check}>${busy === 'check' ? 'Checking…' : c ? 'Check again' : 'Check now'}</button>
          </div>
        </div>
        ${
          c
            ? html`<p className="muted small" style=${{ margin: 0 }}>${c.domain ? html`<b>${c.domain}</b> · ` : ''}checked ${fmtTs(c.at)} · ${c.sum.ok} OK, ${c.sum.warn} to improve, ${c.sum.fail} to fix</p>
                ${DV_GROUPS.filter(g => c.checks.some(x => x.grp === g)).map(
                  g => html`<div key=${g} className="dvgroup">
                    <h3>${{ Domain: 'Sending domain', Server: 'Your server', Sending: 'How email goes out', Reputation: 'Reputation' }[g]}</h3>
                    <ul className="dvlist">
                      ${c.checks
                        .filter(x => x.grp === g)
                        .sort((a, b) => ({ fail: 0, warn: 1, ok: 2 })[a.st] - ({ fail: 0, warn: 1, ok: 2 })[b.st])
                        .map(
                          x => html`<li key=${x.id} className=${'dv-' + x.st}>
                            <${Chip} s=${DV_CHIP[x.st]}>${DV_WORD[x.st]}<//>
                            <div><b>${x.t}</b>${x.d ? html`<code>${x.d}</code>` : ''}${x.fix ? html`<span className="dvfix">${x.fix}</span>` : ''}</div>
                          </li>`
                        )}
                    </ul>
                  </div>`
                )}`
            : html`<${Empty} title="Not checked yet">Checks SPF, DKIM and DMARC on the domain you send from, a mailbox for replies, the server's reverse DNS and blocklists (for your own server), and how sending is set up.<//>`
        }
      </section>
      ${
        owner &&
        html`<section className="panel stack form" style=${{ gap: 12 }}>
            <h2 className="ph" style=${{ margin: 0 }}>Delivery safety</h2>
            <label className="check"><input type="checkbox" checked=${!!sf.warm} onChange=${e => set('warm', e.target.checked)} /><span><b>Warm up a new server or IP address</b>: start at ${Math.round(50 * ({ careful: 0.5, normal: 1, fast: 2 }[sf.warmPace] || 1))} emails a day and grow over ${w.days} days, so mailbox providers learn to trust it.</span></label>
            ${
              sf.warm &&
              html`<div className="row3">
                  <${Field} label="Pace">
                    <select value=${sf.warmPace} onChange=${e => set('warmPace', e.target.value)}>
                      <option value="careful">Careful (half)</option>
                      <option value="normal">Normal</option>
                      <option value="fast">Faster (double)</option>
                    </select>
                  <//>
                  <${Field} label="Today is warm-up day" hint=${w.on ? `Now day ${w.day}. Change it if sending began earlier.` : 'Starts at day 1 when you save.'}><input type="number" min="1" max=${w.days + 1} value=${sf.warmDay} placeholder=${w.on ? String(w.day) : '1'} onInput=${e => set('warmDay', e.target.value)} /><//>
                  <div className="dvplan small muted">${w.plan.filter((x, i) => i % 5 === 0 || i === w.plan.length - 1).map((x, i, a) => html`<span key=${i}>Day ${i === a.length - 1 ? w.days : i * 5 + 1}: ${Math.round((x * ({ careful: 0.5, normal: 1, fast: 2 }[sf.warmPace] || 1)) / ({ careful: 0.5, normal: 1, fast: 2 }[w.pace] || 1)).toLocaleString()}</span>`)}</div>
                </div>`
            }
            <div className="row3">
              <${Field} label="Emails to one receiving domain per hour" hint="0 = no limit. For a new server about 300 spreads Gmail, Outlook and Yahoo out; the rest waits and goes later."><input type="number" min="0" value=${sf.domHour} onInput=${e => set('domHour', e.target.value)} /><//>
              <${Field} label="Pause a campaign when bounces pass (%)" hint="Measured after the first 100 emails."><input type="number" min="0.5" max="50" step="0.5" value=${sf.bounceMax} onInput=${e => set('bounceMax', e.target.value)} /><//>
              <${Field} label="Pause a campaign when spam complaints pass (%)" hint="Measured after the first 300 emails; Gmail's line is 0.3%."><input type="number" min="0.05" max="5" step="0.05" value=${sf.complaintMax} onInput=${e => set('complaintMax', e.target.value)} /><//>
            </div>
            <label className="check"><input type="checkbox" checked=${!!sf.clean} onChange=${e => set('clean', e.target.checked)} /><span><b>Clean every list before it sends</b>: leave out typos of big mail services, throwaway addresses, addresses that bounced before and domains that take no email.</span></label>
            <h3 style=${{ margin: '6px 0 0' }}>Team limits</h3>
            <div className="row3">
              <${Field} label="Each person's daily limit" hint="Recipients a day across their campaigns; 0 = no limit. Administrators have none."><input type="number" min="0" value=${sf.userDay} onInput=${e => set('userDay', e.target.value)} /><//>
            </div>
            ${
              (d.team || []).length > 0 &&
              html`<details className="dvteam" open=${Object.keys(caps).length > 0 && Object.keys(caps).length <= 8}>
                <summary>Different limits for some people (${d.team.length} can send mass email${Object.keys(caps).length ? `, ${Object.keys(caps).length} with their own limit` : ''})</summary>
                <input type="search" value=${teamQ} onInput=${e => setTeamQ(e.target.value)} placeholder="Find a person" aria-label="Find a person" style=${{ maxWidth: 320, margin: '6px 0' }} />
                <div className="tblwrap"><table className="tbl mini">
                  <thead><tr><th>Team member</th><th className="r">Sent today</th><th>Own limit</th></tr></thead>
                  <tbody>${d.team
                    .filter(t => !teamQ.trim() || (t.name + ' ' + t.email).toLowerCase().includes(teamQ.trim().toLowerCase()))
                    .sort((a, b) => (caps[b.id] !== undefined) - (caps[a.id] !== undefined) || b.used - a.used)
                    .map(
                    t => html`<tr key=${t.id}>
                      <td><b style=${{ fontWeight: 600 }}>${t.name}</b> <span className="muted small">${t.email}</span></td>
                      <td className="r num">${t.used.toLocaleString()}</td>
                      <td>${t.admin ? html`<span className="muted small">No limit (administrator)</span>` : html`<input type="number" min="0" style=${{ width: 120 }} aria-label=${'Daily limit for ' + t.name} value=${caps[t.id] === undefined ? '' : caps[t.id]} placeholder=${sf.userDay ? String(sf.userDay) + ' (team)' : 'No limit'} onInput=${e => {
                            const v = e.target.value;
                            const n = { ...caps };
                            if (v === '') delete n[t.id];
                            else n[t.id] = v;
                            setCaps(n);
                          }} />`}</td>
                    </tr>`
                  )}</tbody>
                </table></div>
              </details>`
            }
            <div className="actions"><button className="btn" disabled=${!!busy} onClick=${save}>${busy === 'save' ? 'Saving…' : 'Save delivery safety'}</button></div>
          </section>`
      }
      <section className="panel stack mailguide" style=${{ gap: 10 }}>
        <h2 className="ph" style=${{ margin: 0 }}>Getting into the inbox</h2>
        <p className="small" style=${{ margin: 0 }}>Gmail, Yahoo and Microsoft apply these rules to anyone sending more than about 5,000 emails a day to their users; following them at any volume keeps you out of spam.</p>
        <ul className="small dvrules">
          <li><b>SPF and DKIM</b> on the domain you send from, and <b>DMARC</b> (p=none is enough to start), with the From domain matching the domain that signs.</li>
          <li><b>One-click unsubscribe</b>, honored within two days: built in here, and people who unsubscribe are skipped at once.</li>
          <li><b>Spam complaints under 0.3%</b> (aim for 0.1%): email people who know you, such as vendors you work with and people who asked to hear from you.</li>
          <li><b>Reverse DNS</b> on the sending IP and an <b>encrypted</b> hand-over: Amazon SES and Mailgun do this for you; for your own server, see the checks above.</li>
          <li><b>Clean lists and steady volume:</b> check old lists before sending, warm up a new server or domain, and keep a regular rhythm instead of sudden bursts.</li>
          <li><b>Write like a person:</b> a clear subject, a personal greeting, a few sentences, few links, no attachments, no link shorteners. The inbox check on New email scores each message.</li>
          <li><b>Keep bulk email apart:</b> sending it from a subdomain (for example mail.stratedgeitconsulting.com) protects your main domain's reputation. Watch it in Google Postmaster Tools.</li>
        </ul>
        <details>
          <summary><b>Which way to send?</b></summary>
          <div className="tblwrap"><table className="tbl mini dvcompare">
            <thead><tr><th>Option</th><th>Cost</th><th>Good to know</th></tr></thead>
            <tbody>
              <tr><td><b>Your own Postal server</b></td><td>Software free (open source); you pay for the server</td><td>No per-email fees or caps. You look after the IP's reputation: port 25 open, reverse DNS, warm-up.</td></tr>
              <tr><td><b>Amazon SES</b></td><td>About $0.10 per 1,000 emails</td><td>Amazon's established servers; production access needs a short request.</td></tr>
              <tr><td><b>Mailgun</b></td><td>Monthly plans by volume</td><td>Easy setup; replies can come into the portal Inbox.</td></tr>
              <tr><td><b>Google Workspace</b></td><td>Your existing mailbox</td><td>About 2,000 emails a day per mailbox: fine for small batches, not for bulk.</td></tr>
            </tbody>
          </table></div>
          <p className="muted small" style=${{ margin: '8px 0 0' }}>Hosted services' free plans are small (Brevo about 300 emails a day, Mailgun about 100; SendGrid now only has a 60-day trial). Prices as of October 2026; check each provider's page before choosing.</p>
        </details>
      </section>
    </div>`;
}

/* ---- Inbox: replies and messages that Mailgun forwards to the site (Receiving › Routes) ---- */
function MailInbox() {
  const toast = useToast();
  const [folder, setFolder] = useState('inbox');
  const [q, setQ] = useState('');
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  // the search last sent, so the 30-second refresh keeps showing the same results (its timer outlives this render)
  const qRef = useRef('');
  const load = (fd, qq) => {
    const qv = qq == null ? q : qq;
    qRef.current = qv;
    return api('mail_inbox', { folder: fd || folder, q: qv })
      .then(r => {
        setErr(null);
        setD(r);
      })
      .catch(e => {
        // a failed read is shown in place, with a way to try again, instead of a spinner that never ends
        if (d) toast(errText(e), true);
        else setErr(e || { message: 'The inbox could not be read.' });
      });
  };
  useEffect(() => {
    setOpen(null);
    load(folder);
    const t = setInterval(() => !document.hidden && load(folder, qRef.current), 30000);
    return () => clearInterval(t);
  }, [folder]);
  const act = async (ids, a) => {
    try {
      await api('mail_inbox_act', { ids, act: a });
      if (open && ids.includes(open.id) && ['archive', 'trash', 'delete', 'inbox'].includes(a)) setOpen(null);
      load();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const view = async m => {
    try {
      const r = await api('mail_inbox_get', { id: m.id });
      setOpen(r.message);
      setReply('');
      if (!m.seen) act([m.id], 'seen');
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const send = async () => {
    if (!reply.trim()) return;
    setBusy(true);
    try {
      await api('mail_inbox_reply', { id: open.id, text: reply });
      toast('Reply sent.');
      setReply('');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const counts = (d && d.counts) || {};
  const list = (d && d.messages) || [];
  const atts = open ? (typeof open.atts === 'string' ? JSON.parse(open.atts || '[]') : open.atts || []) : [];
  return html`<div className="stack">
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Folder">
          ${[
            ['inbox', 'Inbox'],
            ['archive', 'Archive'],
            ['trash', 'Trash'],
          ].map(
            ([k, n]) => html`<button key=${k} type="button" className=${folder === k ? 'on' : ''} onClick=${() => setFolder(k)}>
                ${n}${k === 'inbox' && counts.inbox && counts.inbox.unread ? html`<span className="badge">${counts.inbox.unread}</span>` : null}
              </button>`
          )}
        </div>
        <label className="kitsearch">
          <${Icon} n="search" />
          <input type="search" placeholder="Search mail" value=${q} onInput=${e => setQ(e.target.value)} onKeyDown=${e => e.key === 'Enter' && load(folder, q)} aria-label="Search mail" />
        </label>
        <div className="push"><button type="button" className="btn ghost" onClick=${() => load()}><${Icon} n="refresh" />Refresh</button></div>
      </div>
      ${
        !d
          ? err
            ? html`<${LoadError} title="The inbox didn't load." error=${err} onRetry=${() => load()} />`
            : html`<${Spinner} label="Opening the inbox…" onRetry=${() => load()} />`
          : html`<div className=${'mailbox' + (open ? ' reading' : '')}>
              <section className="panel mlist">
                ${!list.length && html`<${Empty} title=${folder === 'inbox' ? 'No messages yet' : 'Nothing here'}>${folder === 'inbox' ? 'Choose Mailgun under Sending setup and add the inbound route; replies to your emails then arrive here.' : ''}<//>`}
                ${list.map(
                  m => html`<button type="button" key=${m.id} className=${'mrow' + (m.seen ? '' : ' unread') + (open && open.id === m.id ? ' on' : '')} onClick=${() => view(m)}>
                      <span className="mfrom">${m.from_name || m.from_email}</span>
                      <span className="mdate">${fmtTs(+m.at)}</span>
                      <span className="msub">${m.starred ? '★ ' : ''}${m.subject || '(no subject)'}${m.atts && m.atts.length ? ' 📎' : ''}</span>
                      <span className="mprev">${m.preview}</span>
                    </button>`
                )}
              </section>
              ${
                open &&
                html`<section className="panel mread">
                    <div className="toolbar">
                      <button type="button" className="btn ghost sm mback" onClick=${() => setOpen(null)}><${Icon} n="left" />Back</button>
                      <div className="push">
                        <button type="button" className="btn ghost sm" onClick=${() => act([open.id], open.starred ? 'unstar' : 'star').then(() => setOpen({ ...open, starred: !open.starred }))}>${open.starred ? 'Unstar' : 'Star'}</button>
                        <button type="button" className="btn ghost sm" onClick=${() => act([open.id], 'unseen')}>Mark unread</button>
                        ${folder !== 'archive' && html`<button type="button" className="btn ghost sm" onClick=${() => act([open.id], 'archive')}>Archive</button>`}
                        ${folder !== 'inbox' && html`<button type="button" className="btn ghost sm" onClick=${() => act([open.id], 'inbox')}>Move to inbox</button>`}
                        ${
                          folder === 'trash'
                            ? html`<button type="button" className="btn ghost sm danger" onClick=${() => confirm('Delete this message for good?') && act([open.id], 'delete')}>Delete</button>`
                            : html`<button type="button" className="btn ghost sm" onClick=${() => act([open.id], 'trash')}>Trash</button>`
                        }
                      </div>
                    </div>
                    <h2 className="ph" style=${{ margin: '6px 0 2px' }}>${open.subject || '(no subject)'}</h2>
                    <p className="muted small" style=${{ margin: 0 }}>From <b>${open.from_name ? open.from_name + ' <' + open.from_email + '>' : open.from_email}</b> to ${open.to_email} · ${fmtTs(+open.at)}</p>
                    ${
                      atts.length > 0 &&
                      html`<div className="chips">${atts.map(
                        a => html`<${Fragment} key=${a.id}><a className="tag" href=${API + 'file&base=' + encodeURIComponent(a.base) + '&id=' + encodeURIComponent(a.id)} target="_blank" rel="noopener">📎 ${a.n}${a.s ? ' (' + sizeLabel(+a.s) + ')' : ''}</a>${
                          Cap.ids && /\.(jpe?g|png|webp|gif|pdf)$/i.test(a.n || '') && html`<button type="button" className="btn ghost sm" title="Check whether this driver's license, state ID or green card looks genuine" onClick=${() => idsOpen({ refs: [{ base: a.base, fid: a.id, n: a.n }], src: 'email' })}><${Icon} n="shield" />Check ID</button>`
                        }<//>`
                      )}</div>`
                    }
                    <${AiMailHelp} from=${open.from_name ? open.from_name + ' <' + open.from_email + '>' : open.from_email} subject=${open.subject || ''} text=${open.text || ''} onDraft=${t => setReply(t)} />
                    ${
                      open.agent &&
                      html`<div className="note info agmailnote"><span><img className="aimark" src="assets/ai-mark.png" alt="" width="16" height="16" /> <b>Screening agent:</b> ${open.agent.kind === 'reply' ? 'read this as the reply of ' + (open.agent.names[0] || 'a candidate') + ' and filed what they sent' : (open.agent.cids.length === 1 ? 'made a candidate from the resume' : 'made ' + open.agent.cids.length + ' candidates from the resumes') + ': ' + open.agent.names.join(', ') + (open.agent.src ? ' (' + open.agent.src + ')' : '')}. ${open.agent.cids.map((cid, i) => html`<a key=${cid} href=${'#/portal/' + ((location.hash.match(/#\/portal\/([a-z]+)/) || [])[1] || 'admin') + '/agent?c=' + encodeURIComponent(cid)}>Open ${open.agent.names[i] || 'candidate'}</a>`)}</span></div>`
                    }
                    ${open.html ? html`<iframe className="mailframe" title="Message" sandbox="" srcDoc=${open.html}></iframe>` : html`<pre className="mailtext">${open.text}</pre>`}
                    <div className="form">
                      <${Field} label=${'Reply to ' + (open.from_name || open.from_email)}>
                        <div className="aibar"><${SigButton} onInsert=${s => setReply(sigAppend(reply, s))} /><${AiWrite} kind="reply" label="Draft a reply" value=${reply} ctx=${{ from: open.from_name || open.from_email, subject: open.subject || '', original: (open.text || '').slice(0, 3500) }} onUse=${t => setReply(t)} /></div>
                        <textarea rows="5" value=${reply} onInput=${e => setReply(e.target.value)} placeholder="Write your reply…" />
                      <//>
                      <div><button type="button" className="btn" disabled=${busy || !reply.trim()} onClick=${send}><${Icon} n="send" />${busy ? 'Sending…' : 'Send reply'}</button></div>
                    </div>
                  </section>`
              }
            </div>`
      }
    </div>`;
}

/* ---- public page reached from the unsubscribe link in every mass email ---- */
function UnsubscribePage({ q }) {
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [left, setLeft] = useState([]); // v37.5: distribution lists left from this page
  useEffect(() => {
    api('unsub_info&t=' + encodeURIComponent(q.t || ''))
      .then(setInfo)
      .catch(() => setInfo({ bad: true }));
  }, [q.t]);
  const go = async () => {
    setBusy(true);
    try {
      await api('unsub&t=' + encodeURIComponent(q.t || '') + ((info && info.lists && info.lists.length) ? '&all=1' : ''), {});
      setDone(true);
    } catch (e) {
      setInfo({ bad: true });
    }
    setBusy(false);
  };
  const leave = async l => {
    setBusy(true);
    try {
      await api('unsub&t=' + encodeURIComponent(q.t || '') + '&list=' + encodeURIComponent(l.id), {});
      setLeft(x => [...x, l.id]);
    } catch (e) {
      setInfo({ bad: true });
    }
    setBusy(false);
  };
  const lists = (info && info.lists) || [];
  const open = lists.filter(l => !l.left && !left.includes(l.id));
  return html`<${Fragment}>
      <${PageHead} title="Email preferences" />
      <section className="sec">
        <div className="wrap">
          <div className="prose" style=${{ maxWidth: 620 }}>
            ${
              !info
                ? html`<${Spinner} />`
                : info.bad
                  ? html`<p>This link is not valid any more. To stop receiving email from StratEdge IT Consulting, reply to any of our emails or write to <a href="mailto:info@stratedgeitconsulting.com">info@stratedgeitconsulting.com</a>.</p>`
                  : done || info.done
                    ? html`<p>
                        <b>
                          ${info.email}
                        </b> is unsubscribed. You won't receive further mass email from StratEdge IT Consulting. Messages about your own timesheets, invoices or documents may still be sent.</p>`
                    : lists.length
                      ? html`<${Fragment}>
                          ${lists
                            .filter(l => l.left || left.includes(l.id))
                            .map(l => html`<p key=${'x' + l.id} className="note ok" style=${{ margin: '0 0 12px' }}><span>You left the <b>${l.name}</b> list. Its emails stop now.</span></p>`)}
                          ${
                            open.length > 0 &&
                            html`<p>This email came to <b>${info.email}</b> from ${open.length === 1 ? 'a list' : 'lists'} at StratEdge IT Consulting.</p>
                              <div className="actions">
                                ${open.map(l => html`<button key=${l.id} className="btn" disabled=${busy} onClick=${() => leave(l)}>Leave the ${l.name} list</button>`)}
                              </div>`
                          }
                          <p className="muted small" style=${{ marginTop: 18 }}>Or stop all mass email from StratEdge IT Consulting to ${info.email} (every list and campaign).</p>
                          <div className="actions">
                            <button className="btn ghost" disabled=${busy} onClick=${go}>Stop all mass email</button>
                            <a className="btn ghost" href="#/">Go to the website</a>
                          </div>
                        <//>`
                      : html`<p>Stop mass email from StratEdge IT Consulting to <b>
                          ${info.email}
                        </b>?</p>
                      <div className="actions">
                        <button className="btn" disabled=${busy} onClick=${go}>
                          ${busy ? 'Unsubscribing…' : 'Unsubscribe'}
                        </button>
                        <a className="btn ghost" href="#/">Go to the website</a>
                      </div>`
            }
          </div>
        </div>
      </section>
    <//>`;
}
