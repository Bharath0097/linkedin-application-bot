/* ================= My email: each person's own Gmail inside the portal ================= */
/* v41: why a mailbox connection did not go through (the provider sends the person back with ?conn=...) */
const MYMAIL_CONN = {
  denied: 'Connecting the mailbox was cancelled.',
  norefresh: 'Microsoft gave access for an hour only. Remove the portal from the apps with access to your Microsoft account, then connect again.',
  expired: 'That took too long or started in another tab. Connect the mailbox again.',
  refused: 'The provider refused the connection. An administrator can check the app under Roles & access › Sign-in providers.',
  token: 'The mailbox could not be connected: the provider did not hand over access. Try again.',
  profile: 'The mailbox could not be connected: the account did not give its email address. Try again.',
};
const MYMAIL_LABEL_N = { '': 'No label', candidate: 'Candidate', consultant: 'Consultant', vendor: 'Vendor', client: 'Client', personal: 'Personal' };
const MYMAIL_TEMPLATES = [
  ['', 'Blank'],
  ['rtr', 'Right-to-represent request', 'RTR for {role}', 'Hi {first_name},\n\nI have an opening that matches your profile: {role}.\n\nCould you reply with "I authorize StratEdge IT Consulting to represent me for this position" along with your current location and expected rate? I will submit you right away.\n\nThanks,\n{my_name}'],
  ['hotlist', 'Hotlist to vendors', 'Available consultants - {date}', 'Hi {first_name},\n\nPlease find our consultants available immediately:\n\n- \n- \n\nAll are open to C2C and can start within two weeks. Reply with any matching requirements.\n\nThanks,\n{my_name}\nStratEdge IT Consulting'],
  ['followup', 'Follow-up', 'Following up', 'Hi {first_name},\n\nFollowing up on my last email. Do you have a few minutes this week for a quick call?\n\nThanks,\n{my_name}'],
  ['interview', 'Interview confirmation', 'Interview confirmed', 'Hi {first_name},\n\nYour interview is confirmed. Please check the details below and reply to confirm:\n\nDate and time: \nFormat: \nInterviewer: \n\nGood luck,\n{my_name}'],
];
function MyMail({ q }) {
  const toast = useToast();
  const P = usePortal();
  const [st, setSt] = useState(null);
  const [box, setBox] = useState('in');
  const [label, setLabel] = useState('');
  const [search, setSearch] = useState('');
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(null);
  const [compose, setCompose] = useState(null);
  const [book, setBook] = useState(null);
  const [tab, setTab] = useState('mail');
  const [busy, setBusy] = useState('');
  const [smtp, setSmtp] = useState({ email: '', pass: '', name: '' });
  const [sel, setSel] = useState({});
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [alsoGmail, setAlsoGmail] = useState(false);
  const status = () =>
    api('mymail_status')
      .then(setSt)
      .catch(e => toast(errText(e), true));
  const [listErr, setListErr] = useState(null);
  const load = (b, l, s) =>
    api('mymail_list', { box: b || box, label: l == null ? label : l, q: s == null ? search : s })
      .then(r => {
        setListErr(null);
        setList(r.messages);
      })
      .catch(e => {
        if (list) toast(errText(e), true);
        else setListErr(e || { message: 'The mailbox could not be read.' });
      });
  useEffect(() => {
    status();
    // opened from the CRM, a contact list or a vendor card with someone to write to
    if (q && (q.to || q.subject)) setCompose({ to: q.to || '', cc: '', bcc: '', subject: q.subject || '', text: q.text || '', loop: true, label: q.label || '' });
    if (q && q.connected === 'short') toast('Gmail is connected for about an hour. To keep it connected, remove the StratEdge access under your Google account permissions and connect again.', true);
    else if (q && q.connected) toast('Your mailbox is connected.');
    // v41: a Microsoft 365 / Outlook connection that did not go through says why
    else if (q && q.conn) toast(MYMAIL_CONN[q.conn] || 'The mailbox could not be connected. Try again.', true);
  }, []);
  useEffect(() => {
    if (st && st.acct) load(box, label);
    setSel({});
  }, [st && st.acct && st.acct.email, box, label]);
  const sync = async () => {
    setBusy('sync');
    try {
      const r = await api('mymail_sync', {});
      toast(r.added ? `${r.added} new message${r.added === 1 ? '' : 's'}.` : 'Inbox is up to date.');
      await status();
      await load();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const act = async (ids, a, extra) => {
    try {
      const r = await api('mymail_act', { ids, act: a, ...(extra || {}) });
      if (a === 'delete' && open && ids.includes(open.id)) setOpen(null);
      if (a === 'delete') toast(`${ids.length} message${ids.length === 1 ? '' : 's'} removed from the portal${r && r.trashed ? `, ${r.trashed} moved to ${st && st.acct && st.acct.provider === 'microsoft' ? 'Deleted Items in Outlook' : "Gmail's trash"}` : ''}.`);
      setSel({});
      await load();
      if (a === 'label' && open && ids.includes(open.id)) setOpen({ ...open, label: extra.label });
      if (a === 'label' && ids.length > 1) toast(`Labelled ${ids.length} messages.`);
    } catch (e) {
      toast(errText(e), true);
    }
  };
  // the chosen messages as an .eml file (one) or a zip of .eml files with an index (several)
  const download = async ids => {
    try {
      const res = await fetch(API + 'mymail_download', { method: 'POST', credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw { message: (j && j.message) || 'The download did not work.' };
      }
      const cd = res.headers.get('Content-Disposition') || '';
      const m = cd.match(/filename="([^"]+)"/);
      await saveDownload(m ? m[1] : 'my-email.zip', await res.blob());
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const view = async m => {
    try {
      const r = await api('mymail_get', { id: m.id });
      setOpen(r.message);
      if (!m.seen) setList(l => l.map(x => (x.id === m.id ? { ...x, seen: true } : x)));
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const connectSmtp = async () => {
    setBusy('smtp');
    try {
      const r = await api('mymail_connect_smtp', smtp);
      setSt(s => ({ ...s, acct: r.acct }));
      toast('Email connected. Send yourself a test message to confirm it works.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const disconnect = async () => {
    if (!confirm('Disconnect your email from the portal? Messages already stored here stay.')) return;
    await api('mymail_disconnect', {});
    status();
  };
  const exportCsv = async () => {
    try {
      const r = await api('mymail_export');
      await saveDownload(
        `my-email-${dkey()}.csv`,
        toCSV([
          ['Direction', 'Date', 'From', 'From name', 'To', 'Cc', 'Subject', 'Label', 'Read', 'Starred', 'Error', 'Preview'],
          ...r.rows.map(x => [x.dir === 'in' ? 'Received' : 'Sent', fmtTs(+x.at), x.from_email, x.from_name, x.to_email, x.cc, x.subject, MYMAIL_LABEL_N[x.label] || x.label, x.seen ? 'Yes' : 'No', x.starred ? 'Yes' : '', x.err, x.snippet]),
        ])
      );
    } catch (e) {
      if (!e || e.code !== 'declined') toast(errText(e), true);
    }
  };
  const loadBook = () =>
    api('mymail_book')
      .then(r => setBook(r.book))
      .catch(e => toast(errText(e), true));
  useEffect(() => {
    if (tab === 'book' && !book) loadBook();
  }, [tab]);
  if (!st) return html`<${Spinner} onRetry=${status} />`;
  const a = st.acct;
  const connectUrl = API + 'sso_start&p=google&gmail=1';
  const connectPanel = html`<section className="panel stack">
      ${q && q.to && html`<p className="note amber small" style=${{ margin: 0 }}>You came here to write to <b>${q.to}</b>. Connect your mailbox below to send from the portal, or <a href=${'mailto:' + q.to + (q.subject ? '?subject=' + encodeURIComponent(q.subject) : '')}>open it in your mail app</a>.</p>`}
      <h2 className="ph">Connect your email</h2>
      <p className="muted small">Send and receive from your own address without leaving the portal. Every message you send or receive here is kept in your mailbox history and can be exported.</p>
      <div className="g2" style=${{ alignItems: 'start' }}>
        <div className="panel stack" style=${{ background: 'var(--surface-2)' }}>
          <b>Gmail or Google Workspace with Google (recommended)</b>
          <p className="muted small" style=${{ margin: 0 }}>Sends from your address and brings your inbox into the portal (last three weeks, refreshed on demand). Google asks for permission once.</p>
          ${
            st.google
              ? html`<${SsoBtn} p=${{ k: 'google', n: 'Google' }} href=${connectUrl} label="Connect Gmail with Google" />`
              : html`<p className="note amber small" style=${{ margin: 0 }}>An administrator sets up the Google app under Roles & access › Sign-in providers first.</p>`
          }
        </div>
        <div className="panel stack" style=${{ background: 'var(--surface-2)' }}>
          <b>Microsoft 365 or Outlook.com with Microsoft</b>
          <p className="muted small" style=${{ margin: 0 }}>Sends from your work or Outlook.com address and brings your inbox into the portal (last three weeks, refreshed on demand). Deleting here moves the message to Deleted Items there. Microsoft asks for permission once.</p>
          ${
            st.microsoft
              ? html`<${SsoBtn} p=${{ k: 'microsoft', n: 'Microsoft' }} href=${API + 'sso_start&p=microsoft&connect=mail'} label="Connect Outlook with Microsoft" />`
              : html`<p className="note amber small" style=${{ margin: 0 }}>An administrator sets up the Microsoft app under Roles & access › Sign-in providers first.</p>`
          }
        </div>
        <div className="panel stack form" style=${{ background: 'var(--surface-2)' }}>
          <b>Gmail with an app password (sending only)</b>
          <p className="muted small" style=${{ margin: 0 }}>Turn on 2-Step Verification in your Google account, create an app password at myaccount.google.com/apppasswords, and paste it here.</p>
          <${Field} label="Your Gmail or Workspace address"><input type="email" value=${smtp.email} onInput=${e => setSmtp({ ...smtp, email: e.target.value })} /><//>
          <${Field} label="App password"><input type="password" value=${smtp.pass} onInput=${e => setSmtp({ ...smtp, pass: e.target.value })} autoComplete="new-password" /><//>
          <${Field} label="Name shown to recipients"><input value=${smtp.name} onInput=${e => setSmtp({ ...smtp, name: e.target.value })} placeholder=${(P.prof && P.prof.n) || ''} /><//>
          <div><button type="button" className="btn" disabled=${busy === 'smtp' || !smtp.email || !smtp.pass} onClick=${connectSmtp}>Connect</button></div>
        </div>
      </div>
    </section>`;
  if (!a) return connectPanel;
  const counts = st.counts || {};
  const own = st.own || [];
  const labelName = k => MYMAIL_LABEL_N[k] || (own.find(l => l.k === k) || {}).n || k;
  const labelColor = k => (own.find(l => l.k === k) || {}).c || '';
  const selIds = Object.keys(sel).filter(k => sel[k]);
  return html`<div className="stack">
      <div className="toolbar">
        <div className="muted small">
          <b>${a.email}</b>${a.receive ? ` · inbox synced ${a.synced ? fmtTs(a.synced) : 'never'}` : ' · sending only (connect with Google or Microsoft to receive)'}
        </div>
        <div className="push">
          ${a.receive && html`<button type="button" className="btn ghost sm" disabled=${busy === 'sync'} onClick=${sync}><${Icon} n="refresh" />${busy === 'sync' ? 'Syncing…' : 'Sync inbox'}</button>`}
          <button type="button" className="btn ghost sm" onClick=${exportCsv}><${Icon} n="down" />Export CSV</button>
          <button type="button" className="btn ghost sm" onClick=${disconnect}>Disconnect</button>
          <button type="button" className="btn sm" onClick=${() => setCompose({ to: '', cc: '', bcc: '', subject: '', text: '', loop: true, label: '' })}><${Icon} n="pen" />New email</button>
        </div>
      </div>
      <${KitTabs} tab=${tab} onTab=${setTab} tabs=${[
        ['mail', 'Mail', counts.unread || 0],
        ['book', 'Address book'],
      ]} />
      ${
        tab === 'book' &&
        html`<${MyBook} book=${book} onReload=${loadBook} onWrite=${emails => {
          setTab('mail');
          setCompose({ to: emails.join(', '), cc: '', bcc: '', subject: '', text: '', loop: true, label: '' });
        }} />`
      }
      ${
        tab === 'mail' &&
        st.bounced > 0 &&
        html`<div className="note red">
            <span><b>${st.bounced} of your emails bounced</b> since you last looked. They are marked "Bounced" under Sent with the reason, and the addresses are now skipped by mass email.</span>
            <div className="actions"><button type="button" className="btn sm" onClick=${() => {
              setBox('out');
              api('mymail_bounces_seen', {}).then(status, () => {});
            }}>Show them</button></div>
          </div>`
      }
      ${
        tab === 'mail' &&
        html`<div className="toolbar">
            <div className="seg" role="group" aria-label="Folder">
              <button type="button" className=${box === 'in' ? 'on' : ''} onClick=${() => setBox('in')}>Inbox${counts.unread ? html`<span className="badge">${counts.unread}</span>` : null}</button>
              <button type="button" className=${box === 'out' ? 'on' : ''} onClick=${() => setBox('out')}>Sent${st.bounced ? html`<span className="badge">${st.bounced}</span>` : null}</button>
            </div>
            <select value=${label} onChange=${e => setLabel(e.target.value)} aria-label="Label">
              <option value="">All labels</option>
              ${(st.labels || []).filter(Boolean).map(l => html`<option key=${l} value=${l}>${labelName(l)}</option>`)}
            </select>
            <button type="button" className="btn ghost sm" onClick=${() => setLabelsOpen(true)}><${Icon} n="tag" />Labels</button>
            <label className="kitsearch"><${Icon} n="search" /><input type="search" placeholder="Search mail" value=${search} onInput=${e => setSearch(e.target.value)} onKeyDown=${e => e.key === 'Enter' && load(box, label, search)} /></label>
          </div>
          ${
            !list
              ? listErr
                ? html`<${LoadError} title="The mailbox didn't load." error=${listErr} onRetry=${() => load(box, label)} />`
                : html`<${Spinner} label="Opening your mailbox…" onRetry=${() => load(box, label)} />`
              : html`<div className=${'mailbox' + (open ? ' reading' : '')}>
                  <section className="panel mlist">
                    ${
                      list.length > 0 &&
                      html`<div className=${'mbulk' + (selIds.length ? ' on' : '')}>
                        <label className="check small"><input type="checkbox" checked=${list.length > 0 && list.every(m => sel[m.id])} onChange=${e => setSel(e.target.checked ? Object.fromEntries(list.map(m => [m.id, true])) : {})} aria-label="Select all" /><span>${selIds.length ? selIds.length + ' selected' : 'Select all'}</span></label>
                        ${
                          selIds.length > 0 &&
                          html`<div className="actions">
                            <button type="button" className="btn ghost sm" onClick=${() => act(selIds, 'seen')}>Mark read</button>
                            <button type="button" className="btn ghost sm" onClick=${() => act(selIds, 'unseen')}>Mark unread</button>
                            <select value="" onChange=${e => e.target.value !== '' && act(selIds, 'label', { label: e.target.value === '-' ? '' : e.target.value })} aria-label="Label the selected messages">
                              <option value="">Label as…</option>
                              ${(st.labels || []).filter(Boolean).map(l => html`<option key=${l} value=${l}>${labelName(l)}</option>`)}
                              <option value="-">No label</option>
                            </select>
                            <button type="button" className="btn ghost sm" onClick=${() => download(selIds)}><${Icon} n="down" />Download</button>
                            <button type="button" className="btn ghost sm danger" onClick=${() => confirm(`Remove ${selIds.length} message${selIds.length === 1 ? '' : 's'} from the portal?${a.provider === 'google' && alsoGmail ? ' They also go to Gmail\u2019s trash (recoverable there for 30 days).' : a.provider === 'google' ? ' They stay in Gmail.' : a.provider === 'microsoft' ? ' They also move to Deleted Items in Outlook.' : ''}`) && act(selIds, 'delete', { gmail: (a.provider === 'google' && alsoGmail) || a.provider === 'microsoft' })}><${Icon} n="trash" />Delete</button>
                            ${a.provider === 'google' && html`<label className="check small" title="Also move them to Gmail's trash"><input type="checkbox" checked=${alsoGmail} onChange=${e => setAlsoGmail(e.target.checked)} /><span>also in Gmail</span></label>`}
                            <button type="button" className="btn link sm" onClick=${() => setSel({})}>Clear</button>
                          </div>`
                        }
                      </div>`
                    }
                    ${!list.length && html`<${Empty} title=${box === 'in' ? 'No messages here yet' : 'Nothing sent yet'}>${box === 'in' ? (a.receive ? 'Press "Sync inbox" to bring in recent mail.' : 'Connect with Google to receive mail here.') : 'Emails you send from the portal appear here.'}<//>`}
                    ${list.map(
                      m => html`<div key=${m.id} className=${'mrowwrap' + (sel[m.id] ? ' picked' : '')}><input type="checkbox" className="mpick" checked=${!!sel[m.id]} onChange=${e => setSel({ ...sel, [m.id]: e.target.checked })} aria-label=${'Select ' + (m.subject || 'message')} /><button type="button" className=${'mrow' + (m.seen ? '' : ' unread') + (open && open.id === m.id ? ' on' : '')} onClick=${() => view(m)}>
                          <span className="mfrom">${box === 'in' ? m.from_name || m.from_email : 'To ' + m.to_email}</span>
                          <span className="mdate">${fmtTs(+m.at)}</span>
                          <span className="msub">${m.starred ? '★ ' : ''}${m.subject || '(no subject)'}${m.err && /^Bounced/.test(m.err) ? html` <${Chip} s="red" title=${m.err}>Bounced<//>` : m.label ? html` <span className=${'chip lbl ' + (labelColor(m.label) ? 'lbl-' + labelColor(m.label) : 'new')}>${labelName(m.label)}</span>` : null}</span>
                          <span className="mprev">${m.snippet}</span>
                        </button></div>`
                    )}
                  </section>
                  ${
                    open &&
                    html`<section className="panel mread">
                        <div className="toolbar">
                          <button type="button" className="btn ghost sm mback" onClick=${() => setOpen(null)}><${Icon} n="left" />Back</button>
                          <div className="push">
                            <select value=${open.label || ''} onChange=${e => act([open.id], 'label', { label: e.target.value })} aria-label="Label this message">
                              ${(st.labels || []).map(l => html`<option key=${l} value=${l}>${labelName(l)}</option>`)}
                            </select>
                            <button type="button" className="btn ghost sm" onClick=${() => download([open.id])} title="Download as an .eml file"><${Icon} n="down" />Download</button>
                            <button type="button" className="btn ghost sm" onClick=${() => act([open.id], open.starred ? 'unstar' : 'star').then(() => setOpen({ ...open, starred: !open.starred }))}>${open.starred ? 'Unstar' : 'Star'}</button>
                            ${box === 'in' && html`<button type="button" className="btn sm" onClick=${() => setCompose({ to: open.from_email, cc: '', bcc: '', subject: /^re:/i.test(open.subject) ? open.subject : 'Re: ' + open.subject, text: `\n\n---\nOn ${fmtTs(+open.at)}, ${open.from_name || open.from_email} wrote:\n${(open.text || '').split('\n').map(l => '> ' + l).join('\n')}`, loop: false, reply: open.id, label: open.label || '' })}>Reply</button>`}
                            <button type="button" className="btn ghost sm danger" onClick=${() => (a && a.provider === 'microsoft' ? confirm('Remove this message? It also moves to Deleted Items in Outlook.') && act([open.id], 'delete', { gmail: true }) : confirm('Remove this message from the portal? It stays in Gmail.') && act([open.id], 'delete'))}>Remove</button>
                          </div>
                        </div>
                        <h2 className="ph" style=${{ margin: '6px 0 2px' }}>${open.subject || '(no subject)'}</h2>
                        <p className="muted small" style=${{ margin: 0 }}>${open.dir === 'in' ? 'From ' : 'To '}<b>${open.dir === 'in' ? (open.from_name ? open.from_name + ' <' + open.from_email + '>' : open.from_email) : open.to_email}</b>${open.cc ? ' · cc ' + open.cc : ''} · ${fmtTs(+open.at)}${open.err ? html` · <span className="err">Not sent: ${open.err}</span>` : null}</p>
                        <${AiMailHelp}
                          from=${open.dir === 'in' ? (open.from_name ? open.from_name + ' <' + open.from_email + '>' : open.from_email) : 'me, to ' + open.to_email}
                          subject=${open.subject || ''}
                          text=${open.text || ''}
                          sent=${open.dir !== 'in'}
                          onDraft=${draft => {
                            const quote = `\n\n---\nOn ${fmtTs(+open.at)}, ${open.dir === 'in' ? open.from_name || open.from_email : 'I'} wrote:\n${(open.text || '').split('\n').map(l => '> ' + l).join('\n')}`;
                            setCompose({ to: open.dir === 'in' ? open.from_email : open.to_email, cc: '', bcc: '', subject: /^re:/i.test(open.subject || '') ? open.subject : 'Re: ' + (open.subject || ''), text: draft + quote, loop: false, reply: open.dir === 'in' ? open.id : '', label: open.label || '' });
                          }}
                        />
                        <pre className="mailtext">${open.text}</pre>
                      </section>`
                  }
                </div>`
          }`
      }
      ${labelsOpen && html`<${MyLabels} own=${own} onClose=${() => setLabelsOpen(false)} onSaved=${r => { setSt({ ...st, own: r.own, labels: r.labels }); setLabelsOpen(false); if (label && !r.labels.includes(label)) setLabel(''); else load(); }} />`}
      ${
        compose &&
        html`<${MyCompose} draft=${compose} onClose=${() => setCompose(null)} labels=${st.labels || []} own=${own} myName=${a.name || (P.prof && P.prof.n) || ''} onSent=${() => {
          setCompose(null);
          status();
          load('out', label);
          setBox('out');
        }} />`
      }
    </div>`;
}
/* ---------- My email: the person's own labels (v31) ---------- */
const MYMAIL_COLORS = [['blue', 'Blue'], ['green', 'Green'], ['amber', 'Amber'], ['red', 'Red'], ['purple', 'Purple'], ['teal', 'Teal'], ['gray', 'Gray']];
function MyLabels({ own, onClose, onSaved }) {
  const toast = useToast();
  const [rows, setRows] = useState(() => own.map(l => ({ ...l })));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api('mymail_labels_save', { labels: rows.filter(x => x.n.trim()) });
      toast('Labels saved.');
      onSaved(r);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<${Modal} title="Your labels" onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Cancel</button><button type="button" className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save labels'}</button>`}>
    <div className="form">
      <p className="muted small" style=${{ margin: 0 }}>The built-in labels (Candidate, Consultant, Vendor, Client, Personal) are always there. Add your own, for a client, a requirement or a stage; removing one takes it off its messages.</p>
      ${rows.map((x, i) => html`<div key=${x.k || 'n' + i} className="actions" style=${{ flexWrap: 'nowrap' }}>
        <span className=${'chip lbl lbl-' + (x.c || 'blue')} style=${{ minWidth: 14 }}> </span>
        <input value=${x.n} onInput=${e => setRows(rows.map((y, j) => (j === i ? { ...y, n: e.target.value } : y)))} placeholder="Label name" maxLength="40" />
        <select value=${x.c || 'blue'} onChange=${e => setRows(rows.map((y, j) => (j === i ? { ...y, c: e.target.value } : y)))} aria-label="Color" style=${{ maxWidth: 110 }}>${MYMAIL_COLORS.map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select>
        <button type="button" className="btn ghost icon sm" aria-label="Remove label" onClick=${() => setRows(rows.filter((_, j) => j !== i))}><${Icon} n="trash" /></button>
      </div>`)}
      <div><button type="button" className="btn ghost sm" onClick=${() => setRows([...rows, { k: '', n: '', c: MYMAIL_COLORS[rows.length % MYMAIL_COLORS.length][0] }])}><${Icon} n="plus" />Add a label</button></div>
    </div>
  <//>`;
}
function MyCompose({ draft, onClose, onSent, labels, own, myName }) {
  const toast = useToast();
  const [f, setF] = useState({ ...draft });
  const [busy, setBusy] = useState(false);
  const [tpl, setTpl] = useState('');
  const [res, setRes] = useState(null);
  const [chk, setChk] = useState(false);
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const n = f.to.split(/[,;\s]+/).filter(x => /^\S+@\S+\.\S+$/.test(x)).length;
  const pickTpl = k => {
    setTpl(k);
    const t = MYMAIL_TEMPLATES.find(x => x[0] === k);
    if (t && t[2]) setF({ ...f, subject: t[2].replace('{date}', fmtDate(dkey())), text: t[3] });
  };
  const send = async () => {
    setBusy(true);
    try {
      const r = await api('mymail_send', f);
      setRes(r);
      if (r.failed.length) toast(`${r.sent} sent, ${r.failed.length} failed.`, true);
      else {
        toast(`${r.sent} email${r.sent === 1 ? '' : 's'} sent.`);
        onSent();
      }
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<${Modal} title=${f.reply ? 'Reply' : 'New email'} onClose=${onClose} wide foot=${html`
      <span className="muted small" style=${{ marginRight: 'auto' }}>${n > 1 ? (f.loop ? `${n} separate emails, one per person` : `One email to all ${n} people`) : n === 1 ? '1 recipient' : ''}</span>
      <button type="button" className="btn ghost" onClick=${onClose}>Cancel</button>
      <button type="button" className="btn" disabled=${busy || !n} onClick=${send}><${Icon} n="send" />${busy ? 'Sending…' : n > 1 && f.loop ? `Send ${n} emails` : 'Send'}</button>`}>
      <div className="form">
        <${Field} label="To" hint="Several addresses separated by commas or new lines; up to 100 at a time.">
          <textarea rows="2" value=${f.to} onInput=${up('to')} placeholder="name@example.com, another@example.com" />
        <//>
        <div><button type="button" className="btn ghost sm" onClick=${() => setChk(!chk)}><${Icon} n="check" />${chk ? 'Hide the check' : 'Check these addresses first'}</button></div>
        ${chk && html`<${EmailChecker} compact initial=${f.to} onUse=${g => {
          setF({ ...f, to: g.join(', ') });
          setChk(false);
        }} />`}
        <div className="row2">
          <${Field} label="Cc"><input value=${f.cc} onInput=${up('cc')} /><//>
          <${Field} label="Bcc"><input value=${f.bcc} onInput=${up('bcc')} /><//>
        </div>
        <div className="row3">
          <${Field} label="Template">
            <select value=${tpl} onChange=${e => pickTpl(e.target.value)}>${MYMAIL_TEMPLATES.map(t => html`<option key=${t[0]} value=${t[0]}>${t[1]}</option>`)}</select>
          <//>
          <${Field} label="Label this conversation">
            <select value=${f.label} onChange=${up('label')}>${labels.map(l => html`<option key=${l} value=${l}>${MYMAIL_LABEL_N[l] || ((own || []).find(x => x.k === l) || {}).n || l}</option>`)}</select>
          <//>
          <${Field} label="Several recipients">
            <select value=${f.loop ? '1' : ''} onChange=${e => setF({ ...f, loop: e.target.value === '1' })}>
              <option value="1">Send to each person separately</option>
              <option value="">One email, everyone in To</option>
            </select>
          <//>
        </div>
        <${Field} label="Subject"><input value=${f.subject} onInput=${up('subject')} /><//>
        <${Field} label="Message" hint="{first_name}, {email}, {my_name} and {signature} are filled in for each person.">
          <div className="aibar"><${SigButton} onInsert=${s => setF({ ...f, text: sigAppend(f.text, s) })} /><${AiWrite} kind="email" value=${f.text} subject=${f.subject} vars=${['{first_name}', '{my_name}']} ctx=${{ to: f.to, subject: f.subject }} onUse=${(t, s) => setF({ ...f, text: t, subject: s && !String(f.subject || '').trim() ? s : f.subject })} /></div>
          <textarea rows="10" value=${f.text} onInput=${up('text')} />
        <//>
        ${res && res.failed.length > 0 && html`<div className="note red"><span><b>${res.failed.length} could not be sent.</b><br />${res.failed.slice(0, 5).join(' · ')}</span></div>`}
        <p className="muted small">Sent as ${myName || 'you'} from your connected address. Replies go to your mailbox.</p>
      </div>
    <//>`;
}
function MyBook({ book, onReload, onWrite }) {
  const toast = useToast();
  const [sel, setSel] = useState([]);
  const [f, setF] = useState({ email: '', name: '', tag: '' });
  const [q, setQ] = useState('');
  if (!book) return html`<${Spinner} />`;
  const list = book.filter(b => !q || b.email.includes(q.toLowerCase()) || (b.name || '').toLowerCase().includes(q.toLowerCase()));
  const save = async (row, del) => {
    try {
      await api('mymail_book_save', { ...row, delete: !!del });
      setF({ email: '', name: '', tag: '' });
      onReload();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  return html`<div className="stack">
      <div className="toolbar">
        <label className="kitsearch"><${Icon} n="search" /><input type="search" placeholder="Search people" value=${q} onInput=${e => setQ(e.target.value)} /></label>
        <div className="push">
          <button type="button" className="btn ghost sm" disabled=${!sel.length} onClick=${() => setSel(sel.length === list.length ? [] : list.map(b => b.email))}>${sel.length === list.length && list.length ? 'Clear' : 'Select all'}</button>
          <button type="button" className="btn sm" disabled=${!sel.length} onClick=${() => onWrite(sel)}><${Icon} n="send" />Email ${sel.length || ''} selected</button>
        </div>
      </div>
      <section className="panel form" style=${{ padding: 14 }}>
        <div className="row3">
          <${Field} label="Email"><input type="email" value=${f.email} onInput=${e => setF({ ...f, email: e.target.value })} /><//>
          <${Field} label="Name"><input value=${f.name} onInput=${e => setF({ ...f, name: e.target.value })} /><//>
          <${Field} label="Tag">
            <select value=${f.tag} onChange=${e => setF({ ...f, tag: e.target.value })}>${Object.entries(MYMAIL_LABEL_N).map(([k, v]) => html`<option key=${k} value=${k}>${k ? v : 'No tag'}</option>`)}</select>
          <//>
        </div>
        <div><button type="button" className="btn sm" disabled=${!/^\S+@\S+\.\S+$/.test(f.email)} onClick=${() => save(f)}>Add person</button></div>
      </section>
      <section className="panel" style=${{ padding: '6px 8px' }}>
        <div className="tblwrap">
          <table className="tbl">
            <thead><tr><th></th><th>Person</th><th>Tag</th><th>Last contact</th><th className="r">Emails</th><th></th></tr></thead>
            <tbody>
              ${list.map(
                b => html`<tr key=${b.email}>
                    <td><input type="checkbox" checked=${sel.includes(b.email)} onChange=${e => setSel(e.target.checked ? [...sel, b.email] : sel.filter(x => x !== b.email))} /></td>
                    <td><b>${b.name || b.email}</b>${b.name ? html`<div className="muted small">${b.email}</div>` : null}</td>
                    <td>${b.tag ? html`<${Chip} s="new">${MYMAIL_LABEL_N[b.tag] || b.tag}<//>` : html`<span className="muted">—</span>`}</td>
                    <td className="small">${b.last ? fmtTs(+b.last) : '—'}</td>
                    <td className="r">${b.n}</td>
                    <td className="r"><button type="button" className="btn ghost sm" onClick=${() => onWrite([b.email])}>Email</button> <button type="button" className="btn ghost sm" onClick=${() => confirm('Remove this person from your address book?') && save({ email: b.email }, true)}>Remove</button></td>
                  </tr>`
              )}
              ${!list.length && html`<tr><td colSpan="6" className="muted small">People you email or hear from are added here automatically.</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
    </div>`;
}

/* ---- Admin > Roles & access > Sign-in providers (Google, LinkedIn, Microsoft) ---- */
function SsoSettings() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState(null);
  const [testing, setTesting] = useState(false);
  const gisBox = useRef(null);
  const [gisTry, setGisTry] = useState(null); // 'drawn' | 'failed' | 'verified' | 'rejected'
  // After the checks, Google's own button is drawn here for the administrator to click: a token coming back proves
  // the site's address is registered, and only then does the login page show that button to everyone.
  const drawGisButton = async () => {
    setGisTry(null);
    try {
      await loadGis();
      const el = gisBox.current;
      if (!el) return;
      el.innerHTML = '';
      window.google.accounts.id.initialize({
        client_id: d.providers.google.id,
        ux_mode: 'popup',
        auto_select: false,
        use_fedcm_for_prompt: false,
        callback: async r => {
          try {
            const v = await api('sso_gis_verify', { credential: r && r.credential });
            setGisTry('verified');
            toast('Google\'s own button works on ' + location.origin + '; the login page at this address now shows it.');
            await load();
            reloadCaps();
          } catch (e) {
            setGisTry('rejected');
            toast(errText(e), true);
          }
        },
      });
      window.google.accounts.id.renderButton(el, { type: 'standard', theme: 'outline', size: 'large', text: 'continue_with', shape: 'pill', width: 300 });
      setTimeout(() => setGisTry(el.childElementCount ? 'drawn' : 'failed'), 900);
    } catch (e) {
      setGisTry('failed');
    }
  };
  // Checks the saved keys with each provider, and whether Google will draw its own button for this site's address
  const runTest = async () => {
    setTesting(true);
    try {
      const r = await api('sso_test', {});
      const res = { ...r.results };
      if (res.google && d.providers.google && d.providers.google.id) {
        let gis = { ok: false, what: 'Google did not answer in time; the classic "Continue with Google" button is used instead.' };
        try {
          await loadGis();
          const box = document.createElement('div');
          box.style.cssText = 'position:fixed;left:-9999px;top:0;width:300px';
          document.body.appendChild(box);
          window.google.accounts.id.initialize({ client_id: d.providers.google.id, callback: () => {}, use_fedcm_for_prompt: false });
          window.google.accounts.id.renderButton(box, { type: 'standard', size: 'large', width: 280 });
          await new Promise(res => setTimeout(res, 900));
          const reason = await gisProbe();
          const frame = box.querySelector('iframe');
          const here = location.origin;
          const why = { unregistered_origin: 'this address is not registered: add ' + here + ' under "Authorized JavaScript origins" on the OAuth client (Google Cloud console › Credentials)', invalid_client: 'Google does not know this client ID; paste it again from the Google Cloud console', missing_client_id: 'no client ID is saved', secure_http_required: 'Google only allows it over https' };
          const g = d.providers.google;
          gis = why[reason]
            ? { ok: false, what: "Google's own button is refused - " + why[reason] + '. The login page shows the classic "Continue with Google" button, which still signs people in.' }
            : !frame
              ? { ok: false, what: 'Google did not draw its button for ' + here + '; the classic "Continue with Google" button is used instead.', soft: true }
              : g.gisOk
                ? { ok: true, what: 'Verified on ' + here + ' by ' + (g.gisOkBy || 'an administrator') + (g.gisOkAt ? ' on ' + fmtDay(g.gisOkAt) : '') + ': Google\'s own button is shown on the login page at this address.' }
                : { ok: false, soft: true, what: 'Google draws its button, but it has not been verified on ' + here + ' yet - click the button below. If a Google window opens and comes straight back here, this address is registered and its login page switches to Google\'s button. If Google says "Access blocked", "origin_mismatch" or "no registered origin", add ' + here + ' under "Authorized JavaScript origins" on the OAuth client (Google Cloud console › Credentials), wait a few minutes and test again.' };
          box.remove();
          setTimeout(drawGisButton, 50);
        } catch (e) {
          gis = { ok: false, what: "Google's script could not be loaded in this browser (blocked by an extension or network).", soft: true };
        }
        res.google_button = gis;
      }
      setTest(res);
    } catch (e) {
      toast(errText(e), true);
    }
    setTesting(false);
  };
  const load = () =>
    api('sso_settings')
      .then(r => {
        setD(r);
        const o = {};
        Object.entries(r.providers).forEach(([k, p]) => {
          o[k] = { id: p.id, secret: '', on: p.on, gis: p.gis !== false };
        });
        setF(o);
      })
      .catch(e => toast(errText(e), true));
  useEffect(() => {
    load();
  }, []);
  if (!d || !f) return html`<${Spinner} />`;
  const save = async () => {
    setBusy(true);
    try {
      await api('sso_settings_save', f);
      toast('Sign-in providers saved.');
      await load();
      reloadCaps();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const copy = t => (navigator.clipboard ? navigator.clipboard.writeText(t).then(() => toast('Copied.'), () => toast(t)) : toast(t));
  const help = {
    google: 'Google Cloud console › APIs & Services › Credentials › Create OAuth client ID (Web application). Add the redirect address below under Authorized redirect URIs, and the site address under Authorized JavaScript origins (that is what lets Google draw its own button on the login page). If Google shows "Access blocked" or "This app isn\'t verified" to people signing in, open OAuth consent screen (Audience) and publish the app, or add them as test users. Enable the Gmail API and the Google Calendar API on the same project so people can connect their own Gmail under My email and their calendar for interviews; for @stratedgeitconsulting.com accounts set the consent screen to Internal and no verification is needed.',
    linkedin: 'LinkedIn Developers (linkedin.com/developers) › Create app (needs a LinkedIn company page) › Products tab: request "Sign In with LinkedIn using OpenID Connect" - without it LinkedIn shows "Bummer, something went wrong" to everyone who tries › Auth tab: add the redirect address below under "Authorized redirect URLs for your app" and copy the Client ID and Primary Client Secret.',
    microsoft: 'Azure portal › Microsoft Entra ID › App registrations › New registration (accounts in any organizational directory and personal accounts) › add the redirect address below as a Web platform, then create a client secret. Under API permissions add the delegated Microsoft Graph permissions offline_access, User.Read, Calendars.ReadWrite, Mail.ReadWrite and Mail.Send: they let people connect their Outlook calendar and mailbox, and an administrator the company mailbox under Email › Settings (some organizations need an administrator to grant consent once). A client secret expires (6 to 24 months): put the new one here before it does.',
  };
  return html`<section className="panel stack">
      <h2 className="ph">Sign in with Google, LinkedIn or Microsoft</h2>
      <p className="muted small">Lets consultants, employees and clients sign in or create their account with one click; the same apps let people connect their own Gmail or Outlook under My email and their Google or Outlook calendar for interviews (a client ID and secret are enough for that: the sign-in switch only puts the button on the login page). ${(d.addrs || []).length > 1 ? 'This portal opens at more than one address: register each one people use with each provider (its redirect address; for Google also its JavaScript origin). A sign-in always comes back to the address it started on.' : 'Register this redirect address with each provider (for Google also the JavaScript origin):'}</p>
      ${(d.addrs && d.addrs.length ? d.addrs : [{ base: '', origin: d.origin, redirect: d.redirect, here: true }]).map(
        a => html`<div key=${a.redirect} className=${'ssoaddr' + (a.here ? ' here' : '')}>
            ${a.base && html`<div className="ssoaddr-h"><b>${a.base}</b>${a.here ? html`<${Chip} s="ok">You are here<//>` : null}${a.main ? html`<${Chip}>Main address<//>` : null}</div>`}
            <div className="linkrow"><b>Redirect address</b><code>${a.redirect}</code><button type="button" className="btn ghost sm" onClick=${() => copy(a.redirect)}>Copy</button></div>
            ${a.origin && html`<div className="linkrow"><b>JavaScript origin (Google)</b><code>${a.origin}</code><button type="button" className="btn ghost sm" onClick=${() => copy(a.origin)}>Copy</button></div>`}
          </div>`
      )}
      ${Object.entries(d.providers).map(
        ([k, p]) => html`<div key=${k} className="panel form" style=${{ background: 'var(--surface-2)' }}>
            <label className="kcheck"><input type="checkbox" checked=${!!f[k].on} onChange=${e => setF({ ...f, [k]: { ...f[k], on: e.target.checked } })} /><span><b>${p.n}</b></span></label>
            <p className="muted small" style=${{ margin: 0 }}>${help[k]}</p>
            ${p.lastErr && p.lastErr.at > Date.now() - 30 * 86400000 && html`<div className="note amber"><span><b>Last refused sign-in</b> (${fmtDay(p.lastErr.at)}): ${p.lastErr.err}${p.lastErr.desc ? ' - ' + p.lastErr.desc : ''}<br />${p.lastErr.fix}</span></div>`}
            <div className="row2">
              <${Field} label="Client ID"><input value=${f[k].id} onInput=${e => setF({ ...f, [k]: { ...f[k], id: e.target.value } })} autoComplete="off" /><//>
              <${Field} label="Client secret" hint=${p.hasSecret ? 'Saved. Leave blank to keep it.' : ''}><input type="password" value=${f[k].secret} onInput=${e => setF({ ...f, [k]: { ...f[k], secret: e.target.value } })} autoComplete="new-password" placeholder=${p.hasSecret ? '••••••••••••' : ''} /><//>
            </div>
            ${
              k === 'google' &&
              html`<label className="kcheck"><input type="checkbox" checked=${!!f[k].gis} onChange=${e => setF({ ...f, [k]: { ...f[k], gis: e.target.checked } })} /><span><b>Show Google's own sign-in button</b><br /><span className="muted small">${p.gisOk ? 'Verified on this address (' + location.origin + ')' + (p.gisOkBy ? ' by ' + p.gisOkBy : '') + '. ' : 'Not verified on this address (' + location.origin + ') yet: its login page uses the classic button until an administrator clicks Google\'s button successfully here under "Test the sign-in setup". '}${(p.gisOrigins || []).length ? 'Verified addresses: ' + p.gisOrigins.join(', ') + '. ' : ''}Google draws the button (with its logo) right on the login page and the sign-in happens in a small popup. Each address needs its JavaScript origin registered and is verified on its own; anywhere it is not, the login page shows the classic "Continue with Google" button.</span></span></label>`
            }
          </div>`
      )}
      ${
        d.connScopes &&
        html`<details className="small">
          <summary><b>What each connection asks for</b></summary>
          <ul style=${{ margin: '6px 0 0', paddingLeft: 18, lineHeight: 1.6 }}>
            <li><b>Gmail (My email):</b> <code>${d.connScopes.google.gmail}</code></li>
            <li><b>Google Calendar (interviews):</b> <code>${d.connScopes.google.cal}</code></li>
            <li><b>Outlook calendar (interviews):</b> <code>${d.connScopes.microsoft.cal}</code></li>
            <li><b>Outlook / Microsoft 365 mailbox (My email):</b> <code>${d.connScopes.microsoft.mail}</code></li>
            <li><b>Company mailbox (Email › Settings › Microsoft 365):</b> <code>${d.connScopes.microsoft.sysmail}</code></li>
          </ul>
        </details>`
      }
      <div className="actions"><button type="button" className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save sign-in providers'}</button><button type="button" className="btn ghost" disabled=${testing || busy} onClick=${runTest}>${testing ? 'Testing…' : 'Test the sign-in setup'}</button></div>
      ${
        test &&
        html`<div className="stack" style=${{ gap: 8 }}>
          ${Object.keys(test).length ? Object.entries(test).map(([k, x]) => html`<div key=${k} className=${'note ' + (x.ok && !x.last ? 'ok' : x.soft || (x.ok && x.last) ? 'amber' : 'red')}><span><b>${k === 'google_button' ? "Google's own button" : (d.providers[k] || {}).n || k}:</b> ${x.what}${x.last ? html`<br /><b>But a real sign-in was refused on ${fmtDay(x.last.at)}:</b> ${x.last.what}. ${x.last.fix}` : ''}</span></div>`) : html`<div className="note amber"><span>No provider has a client ID yet.</span></div>`}
          ${
            test.google_button &&
            html`<div className="panel" style=${{ background: 'var(--surface-2)' }}>
              <p className="muted small" style=${{ margin: '0 0 10px' }}><b>Try Google's own button</b> (signed in as you; nothing changes on your account). ${gisTry === 'verified' ? 'Verified - it is now on the login page.' : gisTry === 'rejected' ? 'Google answered, but the token was rejected (see the message above).' : gisTry === 'failed' ? 'Google did not draw it in this browser.' : 'A Google window should open and come straight back here.'}</p>
              <div ref=${gisBox} style=${{ minHeight: 44 }} />
            </div>`
          }
        </div>`
      }
    </section>`;
}
