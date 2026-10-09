/* ================= Vendors & clients, the requirements desk, candidate matching and import =================
   Vendors live in vms/vendor/items, requirements in vms/req/items. Requirements posted by client contacts from the
   client portal (e/{uid}/req) show on the same desk. Matching and the bulk import run on the server (api/vms.php). */
const VENDOR_TYPES = ['Prime vendor', 'Direct client', 'Implementation partner', 'Staffing agency', 'MSP / VMS'];
const PAY_RATING = [
  ['', 'Not known yet'],
  ['ontime', 'Pays on time'],
  ['late', 'Pays late'],
  ['risk', 'Payment problems'],
];
const NET_TERMS = ['Net 15', 'Net 30', 'Net 45', 'Net 60', 'Net 90', 'Other'];
const DESK_ST = {
  new: ['New', 'new'],
  open: ['Open', 'info'],
  working: ['Working', 'info'],
  submitted: ['Submitted', 'ok'],
  interview: ['Interview', 'ok'],
  filled: ['Filled', 'ok'],
  closed: ['Closed', ''],
  dismissed: ['Dismissed', ''],
};
const REQ_SRC = { client: 'Client portal', email: 'Email', link: 'Posting link', feed: 'Job board', manual: 'Added here', corp: 'Client talent request' };
// v47: the talent request behind a requirement, on the staff page this person has (admin, HR, or Tools)
const crReqHref = id => { const m = /^#\/portal\/(admin|hr)\//.exec(location.hash); return (m ? '#/portal/' + m[1] : '#/portal/tools') + '/clientreq?r=' + encodeURIComponent(id); };
const vendorsCol = () => useCol('vms/vendor/items', 'n:asc');
const postLink = tok => location.origin + location.pathname + '#/post-requirement' + (tok ? '?v=' + encodeURIComponent(tok) : '');
const copyText = (toast, text) =>
  navigator.clipboard
    ? navigator.clipboard.writeText(text).then(
        () => toast('Copied.'),
        () => toast(text)
      )
    : toast(text);

/* ---- one vendor or client ---- */
function VendorModal({ v, onClose }) {
  const P = usePortal();
  const toast = useToast();
  const isClient = v && v.kind === 'client';
  const [tab, setTab] = useState('details');
  const [f, setF] = useState({
    n: '',
    type: 'Prime vendor',
    site: '',
    loc: '',
    terms: 'Net 30',
    pays: '',
    payNotes: '',
    rates: '',
    notes: '',
    msaSt: 'none',
    msaDate: '',
    contacts: [],
    ...(v && !isClient ? v : {}),
    ...(isClient ? { n: v.n, type: 'Direct client', site: v.site || '', loc: v.loc || '', notes: v.notes || '' } : {}),
  });
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(0);
  const subs = useCol(v && !isClient ? 'rec/sub/items' : null, 'd:desc');
  const reqs = useCol(v && !isClient ? 'vms/req/items' : null, 'at:desc');
  const files = useCol(v && !isClient ? `vms/vendor/items/${v.id}/f` : null, 'at:desc');
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const upC = (i, k) => e => setF({ ...f, contacts: f.contacts.map((c, j) => (j === i ? { ...c, [k]: e.target.value } : c)) });
  const save = async () => {
    if (!f.n.trim()) {
      toast('Add the vendor or client name.', true);
      return;
    }
    setBusy(true);
    try {
      if (isClient) {
        await dbMerge(`org/admin/clients/${v.id}`, { n: f.n.trim(), site: f.site.trim(), loc: f.loc.trim(), notes: f.notes.trim() });
      } else {
        const id = v ? v.id : nid();
        const { id: _i, kind: _k, ...rest } = f;
        await (v ? dbMerge : dbSet)(`vms/vendor/items/${id}`, {
          ...rest,
          n: f.n.trim(),
          contacts: f.contacts.filter(c => c.n || c.e).map(c => ({ n: (c.n || '').trim(), e: (c.e || '').trim().toLowerCase(), ph: (c.ph || '').trim(), ti: (c.ti || '').trim() })),
          tok: v && v.tok ? v.tok : nid() + nid().slice(0, 4),
          at: v ? v.at : Date.now(),
          by: v ? v.by : P.uid,
          u: Date.now(),
        });
      }
      toast(v ? 'Saved.' : 'Vendor added.');
      onClose();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const uploadMsa = async e => {
    const fs = e.target.files;
    if (!fs || !fs.length) return;
    if (!v || isClient) {
      toast('Save the vendor first, then attach the MSA.', true);
      return;
    }
    try {
      await storeFile(`vms/vendor/items/${v.id}`, fs[0], { c: 'msa' }, setProg);
      await dbMerge(`vms/vendor/items/${v.id}`, { msaSt: 'signed', msaDate: f.msaDate || dkey() });
      setF({ ...f, msaSt: 'signed', msaDate: f.msaDate || dkey() });
      toast('MSA attached.');
    } catch (x) {
      toast(errText(x), true);
    }
    setProg(0);
  };
  const newToken = async () => {
    try {
      const r = await api('vms_token', { id: v.id });
      setF({ ...f, tok: r.tok });
      toast('A new posting link was made; the old one no longer works.');
    } catch (x) {
      toast(errText(x), true);
    }
  };
  const mySubs = subs.docs.filter(s => subSent(s) && (s.vn || '').toLowerCase() === (f.n || '').toLowerCase());
  const myReqs = reqs.docs.filter(r => r.vid === (v && v.id) || (r.vn || '').toLowerCase() === (f.n || '').toLowerCase());
  const tabs = [
    ['details', 'Details'],
    ...(!isClient ? [['contacts', `Contacts${f.contacts.length ? ' (' + f.contacts.length + ')' : ''}`], ['terms', 'MSA & terms'], ['link', 'Posting link'], ['activity', 'Activity']] : []),
  ];
  return html`<${Modal} wide title=${v ? f.n || 'Vendor' : 'Add a vendor'} onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Close</button>
      <button className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : v ? 'Save' : 'Add vendor'}</button>`}>
      <div className="tabs" role="tablist">
        ${tabs.map(([k, n]) => html`<button key=${k} role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${n}</button>`)}
      </div>
      ${
        tab === 'details' &&
        html`<div className="form">
            <div className="row2">
              <${Field} label="Name"><input value=${f.n} onInput=${up('n')} placeholder="e.g. TCS, Randstad, Acme Corp" /><//>
              <${Field} label="Kind">
                ${isClient ? html`<input value="Direct client (Clients page)" disabled />` : html`<select value=${f.type} onChange=${up('type')}>${VENDOR_TYPES.map(t => html`<option key=${t}>${t}</option>`)}</select>`}
              <//>
            </div>
            <div className="row2">
              <${Field} label="Website or email domain" hint="Emails from this domain are tied to this vendor on the requirements desk."><input value=${f.site} onInput=${up('site')} placeholder="randstadusa.com" /><//>
              <${Field} label="Location"><input value=${f.loc} onInput=${up('loc')} placeholder="City, state" /><//>
            </div>
            ${
              !isClient &&
              html`<div className="row2">
                <${Field} label="Pays on time?" hint="What the team has seen. Shared with the payment-check initiative.">
                  <select value=${f.pays} onChange=${up('pays')}>${PAY_RATING.map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select>
                <//>
                <${Field} label="Payment notes"><input value=${f.payNotes} onInput=${up('payNotes')} placeholder="e.g. paid Aug invoice 20 days late" /><//>
              </div>`
            }
            <${Field} label="Notes"><textarea value=${f.notes} onInput=${up('notes')} placeholder="Who they are, what they usually need, how to work with them" /><//>
          </div>`
      }
      ${
        tab === 'contacts' &&
        html`<div className="stack" style=${{ gap: 10 }}>
            ${f.contacts.map(
              (c, i) => html`<div key=${i} className="row4" style=${{ alignItems: 'end' }}>
                  <${Field} label="Name"><input value=${c.n || ''} onInput=${upC(i, 'n')} /><//>
                  <${Field} label="Email"><input type="email" value=${c.e || ''} onInput=${upC(i, 'e')} /><//>
                  <${Field} label="Phone"><input value=${c.ph || ''} onInput=${upC(i, 'ph')} /><//>
                  <div style=${{ display: 'flex', gap: 6, alignItems: 'end' }}>
                    <${Field} label="Title"><input value=${c.ti || ''} onInput=${upC(i, 'ti')} /><//>
                    <button type="button" className="btn ghost icon" aria-label="Remove" onClick=${() => setF({ ...f, contacts: f.contacts.filter((_, j) => j !== i) })}><${Icon} n="trash" /></button>
                  </div>
                </div>`
            )}
            <div><button type="button" className="btn ghost sm" onClick=${() => setF({ ...f, contacts: [...f.contacts, { n: '', e: '', ph: '', ti: '' }] })}><${Icon} n="plus" />Add contact</button></div>
            <p className="muted small">Requirements emailed by these contacts are filed under this vendor automatically, and submissions can be emailed back to them with one click.</p>
          </div>`
      }
      ${
        tab === 'terms' &&
        html`<div className="form">
            <div className="row3">
              <${Field} label="MSA">
                <select value=${f.msaSt} onChange=${up('msaSt')}>
                  <option value="none">Not signed</option><option value="pending">Being reviewed</option><option value="signed">Signed</option>
                </select>
              <//>
              <${Field} label="MSA date"><input type="date" value=${f.msaDate} onInput=${up('msaDate')} /><//>
              <${Field} label="Payment terms"><select value=${f.terms} onChange=${up('terms')}>${NET_TERMS.map(t => html`<option key=${t}>${t}</option>`)}</select><//>
            </div>
            <${Field} label="Rate card and markup notes"><textarea value=${f.rates} onInput=${up('rates')} placeholder="e.g. Java $65–75/h C2C, 10% markup on W2, overtime billed at 1.0x" /><//>
            <${Field} label="MSA file">
              <input type="file" accept=".pdf,.docx" onChange=${uploadMsa} />
              ${prog > 0 && prog < 1 && html`<div className="prog"><i style=${{ width: Math.round(prog * 100) + '%' }} /></div>`}
            <//>
            ${
              files.docs.length > 0 &&
              html`<ul className="list">
                ${files.docs.map(d => html`<li key=${d.id}><a href=${fileUrl(`vms/vendor/items/${v.id}`, d.id)} target="_blank" rel="noopener">${d.n}</a><span className="muted small">${fmtDay(d.at)}</span></li>`)}
              </ul>`
            }
          </div>`
      }
      ${
        tab === 'link' &&
        html`<div className="stack">
            <p className="muted">Give this link to ${f.n || 'the vendor'}. Anything they post through it lands on the requirements desk under their name, in the Inbox tab, and the team gets an email.</p>
            <div className="linkrow"><code style=${{ wordBreak: 'break-all' }}>${postLink(f.tok)}</code><button type="button" className="btn ghost sm" onClick=${() => copyText(toast, postLink(f.tok))}>Copy link</button></div>
            <div><button type="button" className="btn ghost sm" onClick=${newToken}>Make a new link</button> <span className="muted small">if the old one got into the wrong hands</span></div>
          </div>`
      }
      ${
        tab === 'activity' &&
        html`<div className="stack">
            <h3 className="ph">Requirements (${myReqs.length})</h3>
            ${myReqs.length ? html`<ul className="list">${myReqs.slice(0, 20).map(r => html`<li key=${r.id}><span><b>${r.ti}</b> <span className="muted small">${r.loc || ''} · ${fmtDay(r.at)}</span></span><${Chip} s=${(DESK_ST[r.st] || ['', ''])[1]}>${(DESK_ST[r.st] || [r.st])[0]}<//></li>`)}</ul>` : html`<p className="muted small">None yet.</p>`}
            <h3 className="ph">Submissions (${mySubs.length})</h3>
            ${mySubs.length ? html`<ul className="list">${mySubs.slice(0, 20).map(s => html`<li key=${s.id}><span><b>${s.cn}</b> for ${s.req} <span className="muted small">${fmtDate(s.d)}</span></span><${Chip} s=${subChip(s.st)}>${SUB_ST[s.st] || s.st}<//></li>`)}</ul>` : html`<p className="muted small">None yet. Submissions logged with this vendor's name appear here.</p>`}
          </div>`
      }
    <//>`;
}

/* ---- Vendors & clients page ---- */
function VendorsPage() {
  const P = usePortal();
  const A = P.admin;
  const toast = useToast();
  const vendors = vendorsCol();
  const subs = useCol('rec/sub/items');
  const reqs = useCol('vms/req/items');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('all');
  const [open, setOpen] = useState(undefined);
  if (vendors.loading || (A && A.loading)) return html`<${Spinner} label="Loading vendors…" />`;
  const clients = ((A && A.clients) || []).map(c => ({ ...c, kind: 'client', type: 'Direct client' }));
  const all = [...vendors.docs.map(v => ({ ...v, kind: 'vendor' })), ...clients.filter(c => !vendors.docs.some(v => (v.n || '').toLowerCase() === (c.n || '').toLowerCase()))];
  const ql = q.trim().toLowerCase();
  const list = all
    .filter(x => kind === 'all' || (kind === 'client' ? x.kind === 'client' || x.type === 'Direct client' : x.kind === 'vendor' && x.type !== 'Direct client'))
    .filter(x => !ql || [x.n, x.type, x.loc, x.site, ...((x.contacts || []).map(c => c.n + ' ' + c.e))].filter(Boolean).join(' ').toLowerCase().includes(ql))
    .sort((a, b) => (a.n || '').localeCompare(b.n || ''));
  const month = dkey().slice(0, 7);
  const subsFor = x => subs.docs.filter(s => subSent(s) && (s.vn || '').toLowerCase() === (x.n || '').toLowerCase());
  const openFor = x => reqs.docs.filter(r => (r.vid === x.id || (r.vn || '').toLowerCase() === (x.n || '').toLowerCase()) && ['new', 'open', 'working', 'submitted', 'interview'].includes(r.st)).length;
  const cur = open && open !== 'new' ? all.find(x => x.id === open.id && x.kind === open.kind) : undefined;
  return html`<div className="stack">
      <div className="kpis" style=${{ gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))' }}>
        <a><b>${all.length}</b><span>Vendors and clients</span></a>
        <a><b>${reqs.docs.filter(r => ['new', 'open', 'working'].includes(r.st)).length}</b><span>Requirements to work</span></a>
        <a><b>${subs.docs.filter(s => subSent(s) && (s.d || '').startsWith(month)).length}</b><span>Submissions this month</span></a>
        <a><b>${vendors.docs.filter(v => v.pays === 'ontime').length}<span style=${{ fontSize: 15, fontWeight: 600 }}> / ${vendors.docs.filter(v => v.pays === 'late' || v.pays === 'risk').length}</span></b><span>Pay on time / pay late</span></a>
      </div>
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Kind">
          ${[
            ['all', 'All'],
            ['vendor', 'Vendors'],
            ['client', 'Clients'],
          ].map(([k, n]) => html`<button key=${k} type="button" className=${kind === k ? 'on' : ''} onClick=${() => setKind(k)}>${n}</button>`)}
        </div>
        <input type="search" style=${{ maxWidth: 300 }} placeholder="Search name, contact, domain" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Search vendors" />
        <div className="push">
          ${impCan('vendor') && html`<a className="btn ghost" href=${impHref('vendor')} title="A spreadsheet of vendors and their contacts, checked row by row before anything is saved"><${Icon} n="up" />Import</a>`}
          <button className="btn ghost" onClick=${() => copyText(toast, postLink(''))} title="A general posting link, not tied to one vendor">Copy posting link</button>
          <button className="btn" onClick=${() => setOpen('new')}><${Icon} n="plus" />Add vendor</button>
        </div>
      </div>
      <section className="panel" style=${{ padding: '6px 8px' }}>
        ${
          list.length
            ? html`<div className="tblwrap">
                <table className="tbl">
                  <thead><tr><th>Name</th><th>Kind</th><th>Contacts</th><th>MSA · terms</th><th>Pays</th><th className="r">Open reqs</th><th className="r">Submissions</th><th /></tr></thead>
                  <tbody>
                    ${list.map(
                      x => html`<tr key=${x.kind + x.id} className="click" tabIndex="0" onClick=${() => setOpen({ id: x.id, kind: x.kind })}>
                          <td><b style=${{ fontWeight: 600 }}>${x.n}</b>${x.loc ? html`<div className="muted small">${x.loc}</div>` : ''}</td>
                          <td className="small">${x.type || 'Direct client'}</td>
                          <td className="small">${(x.contacts || []).length ? (x.contacts || []).slice(0, 2).map(c => c.n || c.e).join(', ') + ((x.contacts || []).length > 2 ? ' +' + ((x.contacts || []).length - 2) : '') : html`<span className="muted">—</span>`}</td>
                          <td className="small">${x.kind === 'vendor' ? html`${x.msaSt === 'signed' ? html`<${Chip} s="ok">MSA signed<//>` : x.msaSt === 'pending' ? html`<${Chip} s="new">MSA pending<//>` : html`<span className="muted">No MSA</span>`} <span className="muted">${x.terms || ''}</span>` : html`<span className="muted">Clients page</span>`}</td>
                          <td className="small">${x.pays === 'ontime' ? html`<${Chip} s="ok">On time<//>` : x.pays === 'late' ? html`<${Chip} s="new">Late<//>` : x.pays === 'risk' ? html`<${Chip} s="red">Problems<//>` : html`<span className="muted">—</span>`}</td>
                          <td className="r num">${openFor(x) || '—'}</td>
                          <td className="r num">${subsFor(x).length || '—'}</td>
                          <td className="r"><button className="btn ghost sm" onClick=${e => {
                            e.stopPropagation();
                            setOpen({ id: x.id, kind: x.kind });
                          }}>Open</button></td>
                        </tr>`
                    )}
                  </tbody>
                </table>
              </div>`
            : html`<${Empty} title="No vendors yet" action=${html`<button className="btn" onClick=${() => setOpen('new')}>Add your first vendor</button>`}>The prime vendors, implementation partners and agencies you work with: contacts, MSA, payment terms, whether they pay on time, their requirements and your submissions, all in one place.<//>`
        }
      </section>
      ${open === 'new' && html`<${VendorModal} v=${null} onClose=${() => setOpen(undefined)} />`}
      ${cur && html`<${VendorModal} v=${cur} onClose=${() => setOpen(undefined)} />`}
    </div>`;
}

/* ---- a requirement: details, matches and submissions ---- */
/* ---- v35.2: Dice candidates for a requirement (found by the automatic search or on demand) ---- */
function ReqDiceTab({ req, onAdded }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState('');
  const [sel, setSel] = useState([]);
  const load = async fresh => {
    setBusy(fresh ? 'search' : 'load');
    setErr(null);
    try {
      const r = await api('vms_dice', { id: req.id, fresh: !!fresh }, { timeout: 90000 });
      setD(r);
      setSel([]);
    } catch (e) {
      setErr(e);
    }
    setBusy('');
  };
  useEffect(() => {
    load(false);
  }, [req.id]);
  if (err) return html`<${LoadError} error=${err} onRetry=${() => load(false)} />`;
  if (!d || busy === 'load') return html`<${Spinner} label=${busy === 'search' ? 'Searching Dice…' : 'Loading…'} />`;
  if (!d.on) return html`<p className="muted small">Dice candidate search is not set up (Admin › Sourcing connections).</p>`;
  const res = d.res || { rows: [] };
  const rows = res.rows || [];
  const free = rows.filter(r => !r.have);
  const add = async () => {
    setBusy('add');
    try {
      const r = await api('vms_dice_import', { id: req.id, rows: sel }, { timeout: 120000 });
      toast(r.added.length + ' added to the consultant database' + (r.had ? '; ' + r.had + ' were already there' : '') + '. They now show under Matching candidates.');
      setD({ ...d, res: r.res });
      setSel([]);
      onAdded && onAdded();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  return html`<div className="stack" style=${{ gap: 10 }}>
      <div className="toolbar" style=${{ gap: 8 }}>
        <span className="muted small">${res.at ? html`Searched ${fmtTs(res.at)}${res.by ? ' (' + res.by + ')' : ''} for <b>${res.q}</b>${res.loc ? ' near ' + res.loc : ''}: the ${rows.length} best of ${res.found} Dice profile${res.found === 1 ? '' : 's'}, scored like the portal’s own matches.` : 'Not searched yet.'}${d.auto && d.auto.search ? ' Searched again by itself every ' + d.auto.search + ' hours.' : ''}</span>
        <div className="push">
          ${sel.length > 0 && html`<button className="btn sm" disabled=${!!busy} onClick=${add}>${busy === 'add' ? 'Adding…' : 'Add ' + sel.length + ' to the consultant database'}</button>`}
          <button className="btn ghost sm" disabled=${!!busy} onClick=${() => load(true)}><${Icon} n="refresh" />${busy === 'search' ? 'Searching…' : 'Search Dice now'}</button>
        </div>
      </div>
      ${
        rows.length === 0
          ? html`<${Empty} title="No Dice profiles yet">Search Dice now, or add skills to the requirement for a closer search.<//>`
          : html`<div className="tblwrap"><table className="tbl dicerows">
              <thead><tr><th className="pickcol">${free.length > 0 && html`<input type="checkbox" aria-label="Pick every profile not in the database yet" checked=${free.length > 0 && free.every(r => sel.includes(r.id))} onChange=${e => setSel(e.target.checked ? free.map(r => r.id) : [])} />`}</th><th className="r">Fit</th><th>On Dice</th><th>Why</th><th>Location · visa · experience</th><th /></tr></thead>
              <tbody>${rows.map(
                r => html`<tr key=${r.id}>
                  <td className="pickcol">${!r.have && html`<input type="checkbox" aria-label=${'Pick ' + r.n} checked=${sel.includes(r.id)} onChange=${e => setSel(e.target.checked ? [...sel, r.id] : sel.filter(x => x !== r.id))} />`}</td>
                  <td className="r num"><b className=${'fit ' + (r.score >= 70 ? 'hi' : r.score >= 50 ? 'mid' : '')}>${r.score}%</b></td>
                  <td><b style=${{ fontWeight: 600 }}>${r.n || '(no name)'}</b><div className="muted small">${r.ti || '—'}${r.url ? html` · <a href=${r.url} target="_blank" rel="noopener noreferrer">Dice profile</a>` : ''}${r.upd ? ' · active ' + r.upd : ''}</div></td>
                  <td className="small">${(r.why || []).map((w, i) => html`<div key=${i} className=${/^Not listed|Different|Visa/.test(w) ? 'muted' : ''}>${w}</div>`)}</td>
                  <td className="small">${[r.loc, r.auth, r.exp && r.exp + ' yrs'].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="r">${r.have ? html`<${Chip} s="ok">${r.auto ? 'Added by itself' : 'In the database'}<//>` : ''}</td>
                </tr>`
              )}</tbody>
            </table></div>`
      }
    </div>`;
}

/* ---- v35.1: grab requirements from emails: Outlook (.msg) and .eml emails dragged in, JD files, pasted text ---- */
const GRAB_ACCEPT = '.msg,.eml,.txt,.htm,.html,.pdf,.docx,.rtf';
const GRAB_KEYS = ['ti', 'cl', 'ec', 'vn', 'vid', 'loc', 'md', 'ty', 'rate', 'dur', 'n', 'sd', 'sk', 'visa', 'd', 'cn', 'ce', 'cp', 'vref', 'ip', 'exp', 'iv', 'pref'];
/** What a drop carried: files (Outlook gives a .msg per email), or the text/HTML of a selection. */
const grabDrop = e => {
  const dt = e.dataTransfer;
  const files = [...((dt && dt.files) || [])];
  return { files, text: files.length ? '' : (dt && dt.getData('text/plain')) || '', html: files.length ? '' : (dt && dt.getData('text/html')) || '' };
};
const grabHasData = e => {
  const t = [...((e.dataTransfer && e.dataTransfer.types) || [])];
  return t.includes('Files') || t.includes('text/plain') || t.includes('text/html');
};
/** The form's empty fields filled from a read email (the engagement and work mode replace the defaults). */
const grabMerge = (f, g) => {
  let [next, n] = aiMerge(f, g, ['ti', 'ec', 'loc', 'rate', 'dur', 'n', 'sk', 'visa', 'cn', 'ce', 'cp', 'sd']);
  if (g.ec && !f.cl) next.cl = g.ec;
  if (g.vn && !f.vn && !f.vid) {
    next.vn = g.vn;
    n++;
  }
  if (g.vid && !f.vid) next.vid = g.vid;
  if (g.md && g.md !== f.md && f.md === 'Onsite') {
    next.md = g.md;
    n++;
  }
  if (g.ty && g.ty !== f.ty && f.ty === 'C2C') {
    next.ty = g.ty;
    n++;
  }
  ['vref', 'ip', 'exp', 'iv', 'pref'].forEach(k => {
    if (g[k] && !f[k]) next[k] = g[k];
  });
  return [next, n];
};

function ReqGrabModal({ init, onClose, onAdded }) {
  const toast = useToast();
  const [files, setFiles] = useState((init && init.files) || []);
  const [text, setText] = useState((init && init.text) || '');
  const [pastedHtml, setPastedHtml] = useState((init && init.html) || '');
  const [items, setItems] = useState(null);
  const [skipped, setSkipped] = useState([]);
  const [busy, setBusy] = useState('');
  const [over, setOver] = useState(false);
  const [st, setSt] = useState('open');
  const [edit, setEdit] = useState('');
  const inp = useRef(null);
  const read = async (fs, tx, hx) => {
    if (!fs.length && !tx.trim() && !hx.trim()) {
      toast('Drop emails or JD files, or paste the email text first.', true);
      return;
    }
    setBusy('read');
    try {
      // the host takes about 12 MB per request: files go in batches of up to 10 MB (and 10 files), the text with the first
      const big = fs.filter(x => x.size > 12 * 1048576);
      const batches = [];
      let cur = [];
      let size = 0;
      fs.filter(x => x.size <= 12 * 1048576).forEach(x => {
        if (cur.length && (size + x.size > 10 * 1048576 || cur.length >= 10)) {
          batches.push(cur);
          cur = [];
          size = 0;
        }
        cur.push(x);
        size += x.size;
      });
      if (cur.length || !batches.length) batches.push(cur);
      let all = [];
      let skip = big.map(x => x.name + ': larger than 12 MB');
      for (let i = 0; i < batches.length; i++) {
        if (!batches[i].length && !(i === 0 && (tx.trim() || hx.trim()))) continue;
        const fd = new FormData();
        batches[i].forEach(x => fd.append('files[]', x, x.name));
        fd.append('text', i === 0 ? tx : '');
        fd.append('html', i === 0 ? hx : '');
        const r = await api('vms_grab', fd, { timeout: 120000 });
        all = all.concat(r.items.map(x => ({ ...x, key: 'b' + i + x.key })));
        skip = skip.concat(r.skipped || []);
      }
      // the same requirement in two batches: the later one is a repeat
      const seen = {};
      all = all.map(x => {
        const k = [x.f.ti, x.f.loc, x.f.vref || x.f.ec].map(v => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()).join('|');
        const again = x.f.ti && seen[k];
        seen[k] = 1;
        return again && x.on ? { ...x, on: false, warn: [...(x.warn || []), 'The same requirement appears earlier in what you dropped.'] } : x;
      });
      setItems(all);
      setSkipped(skip);
      setEdit('');
      if (!all.length) toast('No requirement was found in what you added.', true);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  useEffect(() => {
    if (init && ((init.files && init.files.length) || (init.text || '').trim() || (init.html || '').trim())) read(init.files || [], init.text || '', init.html || '');
  }, []);
  const addFiles = list => setFiles(cur => [...cur, ...list.filter(x => !cur.some(y => y.name === x.name && y.size === x.size))].slice(0, 30));
  const onDrop = e => {
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    const d = grabDrop(e);
    if (d.files.length) addFiles(d.files);
    else if (d.html.trim() || d.text.trim()) {
      setText(t => (t.trim() ? t + '\n\n' : '') + d.text);
      if (d.html.trim()) setPastedHtml(h => h + d.html);
    }
  };
  const setItem = (key, patch) => setItems(list => list.map(x => (x.key === key ? { ...x, ...patch } : x)));
  const setField = (key, k, v) => setItems(list => list.map(x => (x.key === key ? { ...x, f: { ...x.f, [k]: v } } : x)));
  const picked = (items || []).filter(x => x.on);
  const save = async () => {
    if (!picked.length) return;
    if (picked.some(x => !String(x.f.ti || '').trim())) {
      toast('Every ticked requirement needs a role title.', true);
      return;
    }
    setBusy('save');
    try {
      const r = await api('vms_grab_save', { st, items: picked.map(x => Object.fromEntries(GRAB_KEYS.map(k => [k, x.f[k] == null ? '' : x.f[k]]))) });
      toast(r.ids.length + ' requirement' + (r.ids.length === 1 ? '' : 's') + ' added' + (st === 'new' ? ' to the Inbox' : '') + (r.skipped.length ? '; left out: ' + r.skipped.join(', ') : '') + '.');
      onAdded && onAdded(r.ids);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const fileList = files.length > 0 && html`<ul className="grabfiles">${files.map((x, i) => html`<li key=${x.name + i}><${Icon} n="mail" /><span>${x.name}</span><span className="muted small">${Math.max(1, Math.round(x.size / 1024))} KB</span><button type="button" className="btn ghost icon sm" aria-label=${'Remove ' + x.name} onClick=${() => setFiles(files.filter((y, j) => j !== i))}><${Icon} n="x" /></button></li>`)}</ul>`;
  const input = html`<div className="stack" style=${{ gap: 12 }}>
      <div className=${'drop grabdrop' + (over ? ' over' : '')} onDragOver=${e => {
        e.preventDefault();
        setOver(true);
      }} onDragLeave=${() => setOver(false)} onDrop=${onDrop}>
        <p><b>Drag vendor emails here</b> — select several in Outlook and drag them in together — or JD files.<br /><small className="muted">Outlook emails (.msg), .eml files (Apple Mail, Thunderbird, new Outlook, Gmail’s “Download message”), PDF, Word (.docx) and text. Up to 30 at a time.</small></p>
        <button type="button" className="btn ghost" onClick=${() => inp.current && inp.current.click()}><${Icon} n="up" />Choose files</button>
        <input ref=${inp} type="file" multiple accept=${GRAB_ACCEPT} hidden onChange=${e => {
          const fl = [...e.target.files];
          e.target.value = '';
          if (fl.length) addFiles(fl);
        }} />
      </div>
      ${fileList}
      <${Field} label="Or paste the email text" hint="Several emails can go in one paste, with their From / Sent / Subject lines or one after another; an email with several requirements becomes several."><textarea value=${text} onInput=${e => setText(e.target.value)} style=${{ minHeight: 150 }} placeholder="Paste one or more vendor emails" /><//>
      <div className="actions">
        <button type="button" className="btn" disabled=${!!busy || (!files.length && !text.trim() && !pastedHtml.trim())} onClick=${() => read(files, text, pastedHtml)}>${busy === 'read' ? 'Reading…' : 'Read the emails'}</button>
        <button type="button" className="btn ghost" onClick=${onClose}>Cancel</button>
      </div>
    </div>`;
  const chip = (s, t) => html`<${Chip} s=${s}>${t}<//>`;
  const review =
    items &&
    html`<div className="stack" style=${{ gap: 10 }}>
      <p className="muted small" style=${{ margin: 0 }}>${items.length} requirement${items.length === 1 ? '' : 's'} found${skipped.length ? '; ' + skipped.length + ' file' + (skipped.length === 1 ? '' : 's') + ' left out' : ''}. Check the ticked ones, change anything, then add them. Repeats and hotlists are left unticked.</p>
      ${skipped.length > 0 && html`<p className="note amber" style=${{ margin: 0 }}><span>${skipped.join(' · ')}</span></p>`}
      <ul className="grablist">
        ${items.map(it => {
          const f = it.f;
          const open = edit === it.key;
          const fld = (k, label, attrs) => html`<${Field} label=${label}><input value=${f[k] == null ? '' : f[k]} onInput=${e => setField(it.key, k, e.target.value)} ...${attrs || {}} /><//>`;
          return html`<li key=${it.key} className=${'grabitem' + (it.on ? ' on' : '')}>
            <div className="grabhead">
              <input type="checkbox" checked=${it.on} aria-label=${'Add ' + (f.ti || 'this requirement')} onChange=${e => setItem(it.key, { on: e.target.checked })} />
              <input className="grabti" value=${f.ti} placeholder="Role title" aria-label="Role title" onInput=${e => setField(it.key, 'ti', e.target.value)} />
              <button type="button" className="btn ghost sm" onClick=${() => setEdit(open ? '' : it.key)}>${open ? 'Done' : 'Edit details'}</button>
            </div>
            <div className="grabmeta small">
              ${[f.loc && f.loc + (f.md && f.md !== 'Onsite' && f.loc !== 'Remote' ? ' · ' + f.md : f.loc === 'Remote' ? '' : ' · ' + f.md), f.ty, f.rate, f.dur, f.visa && 'Visa: ' + f.visa, f.n > 1 && f.n + ' openings'].filter(Boolean).join('  ·  ')}
            </div>
            ${f.sk && html`<div className="muted small">Skills: ${f.sk}</div>`}
            <div className="muted small">${[f.vn, f.cn && f.ce ? f.cn + ' <' + f.ce + '>' : f.cn || f.ce, it.src + (it.part ? ' (' + it.part + ')' : '')].filter(Boolean).join(' · ')}</div>
            <div className="abjob-chips">
              ${it.dup && chip('amber', 'Already on the desk: ' + it.dup.ti + ' (' + fmtDay(it.dup.at) + ', ' + it.dup.why + ')')}
              ${(it.warn || []).map((w, i) => html`<${Chip} key=${i} s="amber">${w}<//>`)}
            </div>
            ${
              open &&
              html`<div className="form grabedit">
                <div className="row3">${fld('ec', 'End client')}${fld('loc', 'Location')}<${Field} label="Work mode"><select value=${f.md} onChange=${e => setField(it.key, 'md', e.target.value)}>${['Onsite', 'Hybrid', 'Remote'].map(t => html`<option key=${t}>${t}</option>`)}</select><//></div>
                <div className="row4"><${Field} label="Engagement"><select value=${f.ty || ''} onChange=${e => setField(it.key, 'ty', e.target.value)}><option value="">Not given</option>${['C2C', 'W2', '1099', 'Contract-to-hire', 'Full-time', 'SOW'].map(t => html`<option key=${t}>${t}</option>`)}</select><//>${fld('rate', 'Rate')}${fld('dur', 'Duration')}${fld('n', 'Openings', { type: 'number', min: 1 })}</div>
                <div className="row2">${fld('sk', 'Must-have skills')}${fld('visa', 'Visa / work authorization')}</div>
                <div className="row4">${fld('vn', 'Vendor')}${fld('cn', 'Contact name')}${fld('ce', 'Contact email')}${fld('cp', 'Contact phone')}</div>
                <div className="row4">${fld('vref', 'Their job ID')}${fld('ip', 'Implementation partner')}${fld('exp', 'Experience')}${fld('sd', 'Target start', { type: 'date' })}</div>
                <${Field} label="Job description"><div className="aibar"><${AiFill} kind="req" label="Fill the empty fields with AI" getText=${() => it.raw || f.d} onFill=${g => {
                  const [next, n] = grabMerge(f, g);
                  setItem(it.key, { f: next });
                  return n;
                }} /></div><textarea value=${f.d} onInput=${e => setField(it.key, 'd', e.target.value)} style=${{ minHeight: 160 }} /><//>
              </div>`
            }
          </li>`;
        })}
      </ul>
      <div className="actions grabfoot">
        <label className="check" style=${{ margin: 0 }}><span className="muted small">Add to</span></label>
        <select value=${st} onChange=${e => setSt(e.target.value)} aria-label="Where they go" style=${{ width: 'auto' }}><option value="open">Open requirements</option><option value="new">The Inbox, to review</option></select>
        <button type="button" className="btn" disabled=${!!busy || !picked.length} onClick=${save}>${busy === 'save' ? 'Adding…' : 'Add ' + picked.length + ' requirement' + (picked.length === 1 ? '' : 's')}</button>
        <button type="button" className="btn ghost" disabled=${!!busy} onClick=${() => setItems(null)}>Add more emails</button>
        <button type="button" className="btn ghost" onClick=${onClose}>Cancel</button>
      </div>
    </div>`;
  return html`<${Modal} wide title="Grab requirements from emails" onClose=${onClose}>
      ${busy === 'read' && !items ? html`<${Spinner} label="Reading the emails…" />` : items ? review : input}
    <//>`;
}

function DeskReqForm({ r, onSaved, onClose, vendors, onGrab }) {
  const P = usePortal();
  const toast = useToast();
  const [f, setF] = useState({ ti: '', cl: '', ec: '', vn: '', vid: '', loc: '', md: 'Onsite', ty: 'C2C', rate: '', dur: '', n: 1, sd: '', sk: '', visa: '', d: '', cn: '', ce: '', cp: '', st: 'open', lob: '', hc: null, ...(r || {}) }); // v68: lob, hc
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  // v35.1: the rule-based reader (no AI needed): fills the empty fields and keeps only the requirement in the description
  const readEmail = async () => {
    if (!String(f.d || '').trim()) {
      toast('Paste the vendor’s email into the job description first.', true);
      return;
    }
    setReading(true);
    try {
      const g = await api('vms_grab', { text: f.d });
      if (!g.items.length) toast('No requirement was found in the text.', true);
      else if (g.items.length > 1 && onGrab) {
        toast('That text holds ' + g.items.length + ' requirements: check them all here.');
        onGrab({ files: [], text: f.d, html: '' });
      } else {
        const [next, n] = grabMerge(f, g.items[0].f);
        next.d = g.items[0].f.d || f.d;
        setF(next);
        toast(n ? 'Filled ' + n + ' field' + (n === 1 ? '' : 's') + ' and kept only the requirement in the description. Check them before saving.' : 'The description is tidied; the fields already had values.');
      }
    } catch (e) {
      toast(errText(e), true);
    }
    setReading(false);
  };
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const pickVendor = e => {
    const v = vendors.find(x => x.id === e.target.value);
    setF({ ...f, vid: e.target.value, vn: v ? v.n : f.vn, ce: f.ce || (v && v.contacts && v.contacts[0] ? v.contacts[0].e : ''), cn: f.cn || (v && v.contacts && v.contacts[0] ? v.contacts[0].n : '') });
  };
  const save = async () => {
    if (!f.ti.trim()) {
      toast('Add the role title.', true);
      return;
    }
    setBusy(true);
    try {
      const id = r && r.id ? r.id : nid();
      const { id: _i, src: _s, skills: _k, ...rest } = f;
      await (r && r.id ? dbMerge : dbSet)(`vms/req/items/${id}`, {
        ...rest,
        ti: f.ti.trim(),
        n: Math.max(1, parseInt(f.n, 10) || 1),
        src: (r && r.src) || 'manual',
        st: f.st || 'open',
        at: r && r.at ? r.at : Date.now(),
        by: r && r.by ? r.by : P.uid,
        u: Date.now(),
      });
      toast(r && r.id ? 'Saved.' : 'Requirement added.');
      if (r && r.id && !RS_OPEN.includes(f.st || 'open')) api('rs_sync', { ids: [id] }).catch(() => {});
      onSaved && onSaved(id);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<div className="form">
      <div className="row2">
        <${Field} label="Role title"><input value=${f.ti} onInput=${up('ti')} placeholder="e.g. SAP PP/QM Consultant" /><//>
        <${Field} label="Vendor">
          <select value=${f.vid || ''} onChange=${pickVendor}>
            <option value="">${f.vn ? f.vn + ' (not on file)' : 'Pick a vendor'}</option>
            ${vendors.map(v => html`<option key=${v.id} value=${v.id}>${v.n}</option>`)}
          </select>
        <//>
      </div>
      <div className="row3">
        <${Field} label="End client"><input value=${f.ec || f.cl} onInput=${e => setF({ ...f, ec: e.target.value, cl: e.target.value })} /><//>
        <${Field} label="Location"><input value=${f.loc} onInput=${up('loc')} placeholder="City, state" /><//>
        <${Field} label="Work mode"><select value=${f.md} onChange=${up('md')}>${['Onsite', 'Hybrid', 'Remote'].map(t => html`<option key=${t}>${t}</option>`)}</select><//>
      </div>
      <div className="row4">
        <${Field} label="Engagement"><select value=${f.ty} onChange=${up('ty')}>${['C2C', 'W2', '1099', 'Contract-to-hire', 'Full-time', 'SOW'].map(t => html`<option key=${t}>${t}</option>`)}</select><//>
        <${Field} label="Rate"><input value=${f.rate} onInput=${up('rate')} placeholder="$70/h C2C" /><//>
        <${Field} label="Duration"><input value=${f.dur} onInput=${up('dur')} placeholder="12 months" /><//>
        <${Field} label="Openings"><input type="number" min="1" value=${f.n} onInput=${up('n')} /><//>
      </div>
      <div className="row2">
        <${Field} label="Must-have skills" hint="Comma separated. These drive the matching."><input value=${f.sk} onInput=${up('sk')} placeholder=${f.lob === 'hc' ? 'ICU, BLS, ACLS, Epic' : 'S/4HANA, PP, QM'} /><//>
        <${Field} label="Visa / work authorization"><input value=${f.visa} onInput=${up('visa')} placeholder="USC, GC, H-1B ok" /><//>
      </div>
      <${Field} label="Line of business" hint=${f.lob === 'hc' ? 'The healthcare details prefill every submission made from this requirement.' : ''}>
        <select value=${f.lob || ''} onChange=${e => setF({ ...f, lob: e.target.value, hc: e.target.value === 'hc' ? f.hc || hcEmpty() : f.hc })} aria-label="Line of business">${Object.entries(LOB).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select>
      <//>
      ${f.lob === 'hc' && html`<${HcFields} hc=${f.hc} set=${p => setF({ ...f, hc: { ...hcEmpty(), ...(f.hc || {}), ...p } })} mine=${true} kind="req" />`}
      <div className="row3">
        <${Field} label="Contact name"><input value=${f.cn} onInput=${up('cn')} /><//>
        <${Field} label="Contact email" hint="Submissions can be emailed here."><input type="email" value=${f.ce} onInput=${up('ce')} /><//>
        <${Field} label="Contact phone"><input value=${f.cp} onInput=${up('cp')} /><//>
      </div>
      <div className="row2">
        <${Field} label="Target start"><input type="date" value=${f.sd} onInput=${up('sd')} /><//>
        <${Field} label="Status"><select value=${f.st} onChange=${up('st')}>${Object.entries(DESK_ST).map(([k, [n]]) => html`<option key=${k} value=${k}>${n}</option>`)}</select><//>
      </div>
      <${Field} label="Job description" hint=${'Paste the vendor\u2019s email here, then \u201cRead the email\u201d' + (aiOn('extract') ? ' (or \u201cFill the fields with AI\u201d).' : '.')}>
        <div className="aibar"><button type="button" className="btn ghost sm" disabled=${reading} onClick=${readEmail}><${Icon} n="mail" />${reading ? 'Reading\u2026' : 'Read the email'}</button><${AiFill} kind="req" label="Fill the fields with AI" getText=${() => f.d} onFill=${fields => { let [next, n] = aiMerge(f, fields, ['ti', 'ec', 'loc', 'rate', 'dur', 'n', 'sk', 'visa', 'cn', 'ce', 'cp', 'sd']); if (fields.ec && !f.cl) next.cl = fields.ec; if (fields.vn && !f.vn && !f.vid) { next.vn = fields.vn; n++; } if (fields.md && fields.md !== f.md && f.md === 'Onsite') { next.md = fields.md; n++; } if (fields.ty && fields.ty !== f.ty && f.ty === 'C2C') { next.ty = fields.ty; n++; } setF(next); return n; }} /></div>
        <textarea value=${f.d} onInput=${up('d')} style=${{ minHeight: 140 }} placeholder="Paste the requirement as it came in" />
      <//>
      <div className="actions">
        ${onClose && html`<button type="button" className="btn ghost" onClick=${onClose}>Cancel</button>`}
        <button type="button" className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : r && r.id ? 'Save changes' : 'Add requirement'}</button>
      </div>
    </div>`;
}
function SubmitForm({ req, cand, onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({ rate: req.rate || cand.rate || '', note: '', email: !!req.ce, to: req.ce || '', rtr: false, lob: req.lob || '', hc: req.lob === 'hc' ? { ...hcEmpty(), ...(req.hc || {}) } : null }); // v68: the healthcare details come from the requirement
  const [busy, setBusy] = useState(false);
  // v36: the check for earlier submissions of this person, before anything is sent
  const [cf, setCf] = useState(null);
  const [ack, setAck] = useState(false);
  const [ovr, setOvr] = useState('');
  useEffect(() => {
    api('bd_check', { cid: cand.src === 'db' ? cand.id : '', cn: cand.n, ce: cand.e || '', req: req.ti, vn: req.vn || req.cl || '', ec: req.ec || '', ext: req.vref || '', vreq: req.id }).then(
      r => setCf(r),
      () => {}
    );
  }, [req.id, cand.id]);
  const up = k => e => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const hard = cf ? cf.conflicts.filter(x => x.kind === 'confirmed').length : 0;
  const soft = cf ? cf.conflicts.filter(x => x.kind === 'possible').length : 0;
  const go = async () => {
    if (soft && !ack) return toast('Tick \u201cI checked\u201d after looking at the earlier submission.', true);
    if (hard && !(cf.manager && ovr.trim().length > 2)) return toast(cf.manager ? 'Give the reason to send it anyway.' : 'This repeats an earlier submission. A bench manager can send it anyway.', true);
    setBusy(true);
    try {
      const r = await api('vms_submit', { id: req.id, src: cand.src, cid: cand.id, rate: f.rate, note: f.note, email: f.email, to: f.to, rtr: f.rtr, score: cand.score, lob: f.lob, hc: f.lob === 'hc' ? f.hc : null, ack: ack ? '1' : '', override: ovr });
      toast(f.email ? (r.mailed ? `${cand.n} submitted and emailed to ${f.to}.` : `${cand.n} submitted. The email could not be sent (see Email › Sent log).`) : `${cand.n} logged as submitted.`);
      onDone(r);
    } catch (e) {
      if (e && (e.code === 'conflict' || e.code === 'check')) setCf({ conflicts: e.conflicts || [], manager: !!e.manager });
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<${Modal} title=${'Submit ' + cand.n} onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Cancel</button><button className="btn" disabled=${busy} onClick=${go}>${busy ? 'Submitting…' : 'Submit'}</button>`}>
      <div className="form">
        <p className="muted small">For <b>${req.ti}</b>${req.vn ? ' at ' + req.vn : ''}. This logs a submission (RTRs & submissions) and marks the requirement as submitted.</p>
        <div className="row2">
          <${Field} label="Rate submitted"><input value=${f.rate} onInput=${up('rate')} placeholder="$70/h C2C" /><//>
          <label className="check" style=${{ alignSelf: 'end' }}><input type="checkbox" checked=${f.rtr} onChange=${up('rtr')} /><span>RTR received</span></label>
        </div>
        <label className="check"><input type="checkbox" checked=${f.lob === 'hc'} onChange=${e => setF({ ...f, lob: e.target.checked ? 'hc' : '', hc: e.target.checked ? f.hc || { ...hcEmpty(), ...(req.hc || {}) } : f.hc })} /><span>Healthcare staffing submission (discipline, unit, facility, shift, license, pay package, credentialing)</span></label>
        ${f.lob === 'hc' && html`<${HcFields} hc=${f.hc} set=${p => setF({ ...f, hc: { ...hcEmpty(), ...(f.hc || {}), ...p } })} mine=${true} kind="sub" />`}
        <${Field} label="Note to the vendor (optional)"><div className="aibar"><${AiWrite} kind="vendor" label="Draft the note" value=${f.note} ctx=${{ consultant: cand.n, role: req.ti, vendor: req.vn || '', rate: f.rate, title: cand.ti || '', skills: cand.sk || '' }} onUse=${t => setF({ ...f, note: t })} /></div><textarea value=${f.note} onInput=${up('note')} placeholder="Availability, interview slots, anything they asked for" /><//>
        <label className="check"><input type="checkbox" checked=${f.email} onChange=${up('email')} /><span>Email the resume and this note to the vendor contact</span></label>
        ${f.email && html`<${Field} label="Send to"><input type="email" value=${f.to} onInput=${up('to')} placeholder="recruiter@vendor.com" /><//>`}
        ${cf && cf.conflicts.length > 0 && html`<${BdConflictBox} list=${cf.conflicts} manager=${cf.manager} ack=${ack} setAck=${setAck} ovr=${ovr} setOvr=${setOvr} />`}
      </div>
    <//>`;
}
function ReqModal({ req, onClose, onChanged, vendors }) {
  const toast = useToast();
  const P = usePortal();
  const [tab, setTab] = useState(req.st === 'new' ? 'details' : 'matches');
  const [sharing, setSharing] = useState(false);
  const [m, setM] = useState(null);
  const [err, setErr] = useState(null);
  const [busyM, setBusyM] = useState(false);
  const [pick, setPick] = useState(null);
  const subs = useCol('rec/sub/items', 'd:desc');
  const mine = subs.docs.filter(s => s.vreq === req.id);
  const findMatches = async () => {
    setBusyM(true);
    setErr(null);
    try {
      setM(await api('vms_match', { id: req.id }));
    } catch (e) {
      setErr(e);
    }
    setBusyM(false);
  };
  useEffect(() => {
    if (tab === 'matches' && !m && !busyM) findMatches();
  }, [tab]);
  const setSt = async st => {
    if (req.src === 'client') {
      toast('Client-posted requirements are updated under Requirements.', true);
      return;
    }
    try {
      await dbMerge(`vms/req/items/${req.id}`, { st, u: Date.now() });
      if (!RS_OPEN.includes(st)) api('rs_sync', { ids: [req.id] }).catch(() => {});
      onChanged();
      toast(st === 'dismissed' ? 'Dismissed.' : st === 'open' && req.st === 'new' ? 'Accepted to the desk. Share it with vendors, clients and your network with Share.' : 'Status updated.');
      if (st === 'dismissed') onClose();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const title = html`<span>${req.ti}${req.vn ? html` <span className="muted" style=${{ fontWeight: 500 }}>· ${req.vn}</span>` : ''}</span>`;
  return html`<${Modal} wide title=${req.ti} onClose=${onClose} foot=${html`${req.st === 'new' && req.src !== 'client' && html`<button className="btn ghost" onClick=${() => setSt('dismissed')}>Dismiss</button><button className="btn go" onClick=${() => setSt('open')}>Accept to the desk</button>`}${RS_OPEN.includes(req.st || 'open') && html`<button className="btn" onClick=${() => setSharing(true)}><${Icon} n="send" />Share</button>`}<button className="btn ghost" onClick=${onClose}>Close</button>`}>
      <div className="stack" style=${{ gap: 12 }}>
        <div className="toolbar" style=${{ gap: 8 }}>
          <${Chip} s=${(DESK_ST[req.st] || ['', ''])[1]}>${(DESK_ST[req.st] || [req.st])[0]}<//>
          <span className="muted small">${REQ_SRC[req.src] || req.src}${req.cn || req.ce ? ' · ' + [req.cn, req.ce].filter(Boolean).join(' ') : ''} · ${fmtTs(req.at)}</span>
          <div className="push">
            ${req.src !== 'client' && html`<select value=${req.st} onChange=${e => setSt(e.target.value)} aria-label="Status">${Object.entries(DESK_ST).map(([k, [n]]) => html`<option key=${k} value=${k}>${n}</option>`)}</select>`}
          </div>
        </div>
        ${req.creq && html`<div className="note info"><span>From ${req.cl || 'a client'}'s talent request (version ${req.cver || 1} approved). When the client approves a change, this requirement follows it. <a href=${crReqHref(req.creq)}>Open the talent request</a></span></div>`}
        ${
          req.vms &&
          html`<div className="note info"><span>From <b>${req.vms}</b>${req.vref ? ' · requisition ' + req.vref : ''}${req.vurl ? html` · <a href=${req.vurl} target="_blank" rel="noopener noreferrer">Open in ${req.vms}</a>` : ''}. Submit candidates in ${req.vms} and log the submission here (the live ${req.vms} connection sends them straight from the portal once it is switched on).${(req.vlog || []).length ? html`<br /><b>Updates:</b> ${req.vlog.slice().reverse().slice(0, 5).map(l => fmtDay(l.t) + ': ' + l.ev).join(' · ')}` : ''}</span></div>`
        }
        <div className="tabs" role="tablist">
          ${[
            ['matches', 'Matching candidates'],
            ...(m && m.dice ? [['dice', 'On Dice']] : []),
            ['details', 'Details'],
            ['subs', `Submissions${mine.length ? ' (' + mine.length + ')' : ''}`],
          ].map(([k, n]) => html`<button key=${k} role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${n}</button>`)}
        </div>
        ${
          tab === 'details' &&
          (req.src === 'client'
            ? html`<dl className="kv">
                <dt>End client</dt><dd>${req.cl || '—'}</dd>
                <dt>Location</dt><dd>${req.loc || '—'} · ${req.md || ''}</dd>
                <dt>Engagement</dt><dd>${req.ty || '—'}</dd>
                <dt>Skills</dt><dd>${req.sk || '—'}</dd>
                <dt>Openings</dt><dd>${req.n || 1}</dd>
                <dt>Start</dt><dd>${req.sd ? fmtDate(req.sd) : '—'}</dd>
                <dt>Details</dt><dd style=${{ whiteSpace: 'pre-wrap' }}>${req.d || '—'}</dd>
              </dl>`
            : html`<${DeskReqForm} r=${req} vendors=${vendors} onSaved=${() => {
                onChanged();
                setM(null);
              }} />`)
        }
        ${
          tab === 'matches' &&
          html`<div className="stack" style=${{ gap: 10 }}>
              ${busyM ? html`<${Spinner} label="Reading the candidate database…" />` : err ? html`<${LoadError} error=${err} onRetry=${findMatches} />` : null}
              ${
                m &&
                !busyM &&
                html`<div className="toolbar" style=${{ gap: 8 }}>
                    <span className="muted small">Looking for <b>${(m.profile.titleTokens || []).join(' ') || req.ti}</b>${(m.profile.skills || []).length ? html` with <b>${m.profile.skills.slice(0, 10).join(', ')}</b>` : ''}. ${m.pool} ${m.pool === 1 ? 'person scores' : 'people score'} ${m.profile.minScore}+ across the consultant database, candidates (ATS) and resumes in the job portal.</span>
                    <div className="push"><button className="btn ghost sm" onClick=${findMatches}><${Icon} n="refresh" />Refresh</button></div>
                  </div>`
              }
              ${m && !busyM && m.hidden > 0 && html`<p className="muted small" style=${{ margin: 0 }}>${m.hidden} more ${m.hidden === 1 ? 'person fits' : 'people fit'} but ${m.hidden === 1 ? 'is' : 'are'} left out: their consultant type may not take ${m.eng || 'this'} roles, or the role's work authorization leaves them out (Consultant types & job rules).</p>`}
              ${
                m && !busyM && !m.matches.length && html`<${Empty} title="No close matches yet">Add must-have skills to the requirement, import more candidates (Consultant database › Import) or lower the match threshold under Settings.<//>`
              }
              ${
                m &&
                !busyM &&
                m.matches.length > 0 &&
                html`<div className="tblwrap">
                    <table className="tbl">
                      <thead><tr><th className="r">Fit</th><th>Candidate</th><th>Why</th><th>Location · visa · rate</th><th /></tr></thead>
                      <tbody>
                        ${m.matches.map(
                          c => html`<tr key=${c.src + c.id}>
                              <td className="r num"><b className=${'fit ' + (c.score >= 70 ? 'hi' : c.score >= 50 ? 'mid' : '')}>${c.score}%</b></td>
                              <td><b style=${{ fontWeight: 600 }}>${c.n}</b><div className="muted small">${c.ti || '—'} · ${{ db: 'Consultant database', ats: 'Candidates (ATS)', portal: 'Job portal resume' }[c.src]}${c.resume ? ' · resume' : ''}</div></td>
                              <td className="small">${(c.why || []).map((w, i) => html`<div key=${i} className=${/^Not listed|Different|Visa/.test(w) ? 'muted' : ''}>${w}</div>`)}</td>
                              <td className="small">${[c.loc, c.auth, c.rate].filter(Boolean).join(' · ') || '—'}</td>
                              <td className="r">${c.sub ? html`<${Chip} s="ok">${c.sub}<//>` : html`<button className="btn sm" onClick=${() => setPick(c)}>Submit</button>`}</td>
                            </tr>`
                        )}
                      </tbody>
                    </table>
                  </div>`
              }
            </div>`
        }
        ${tab === 'dice' && html`<${ReqDiceTab} req=${req} onAdded=${() => setM(null)} />`}
        ${
          tab === 'subs' &&
          (mine.length
            ? html`<ul className="list">${mine.map(s => html`<li key=${s.id}><span><b>${s.cn}</b> <span className="muted small">${fmtDate(s.d)} · ${s.byn || ''}${s.rate ? ' · ' + s.rate : ''}${s.rtr ? ' · RTR' : ''}</span></span><${Chip} s=${subChip(s.st)}>${SUB_ST[s.st] || s.st}<//></li>`)}</ul>`
            : html`<p className="muted small">No submissions for this requirement yet. Pick someone under Matching candidates.</p>`)
        }
      </div>
      ${pick && html`<${SubmitForm} req=${req} cand=${pick} onClose=${() => setPick(null)} onDone=${() => {
        setPick(null);
        setM(null);
        findMatches();
        onChanged();
      }} />`}
      ${sharing && html`<${ReqShareModal} ids=${[req.id]} onClose=${() => setSharing(false)} onChanged=${onChanged} />`}
    <//>`;
}

/* ---- import from the job pool ---- */
function FromJobs({ onClose, onAdded }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [jobs, setJobs] = useState(null);
  const [busy, setBusy] = useState('');
  const load = () =>
    api('vms_jobs', { q })
      .then(r => setJobs(r.jobs))
      .catch(e => toast(errText(e), true));
  useEffect(() => {
    load();
  }, []);
  const add = async j => {
    setBusy(j.id);
    try {
      const r = await api('vms_from_job', { jobId: j.id });
      toast('Added to the desk.');
      onAdded(r.id);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  return html`<${Modal} wide title="Requirements from job boards" onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Close</button>`}>
      <div className="stack">
        <p className="muted small">Jobs collected under Job portals (Adzuna, Jooble, feeds and the rest) can be worked as requirements: pick one and it lands on the desk with its skills filled in.</p>
        <div className="toolbar"><input type="search" placeholder="Search title, company, location" value=${q} onInput=${e => setQ(e.target.value)} onKeyDown=${e => e.key === 'Enter' && load()} /><button className="btn ghost" onClick=${load}>Search</button></div>
        ${!jobs ? html`<${Spinner} />` : !jobs.length ? html`<${Empty} title="Nothing collected yet">Turn on sources under Job portals › Sources and run a collection; jobs then appear here.<//>` : html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Job</th><th>Company</th><th>Location</th><th>Source</th><th /></tr></thead><tbody>
          ${jobs.map(j => html`<tr key=${j.id}><td><b style=${{ fontWeight: 600 }}>${j.ti}</b></td><td className="small">${j.co}</td><td className="small">${j.loc}${j.remote ? ' · ' + j.remote : ''}</td><td className="small">${j.src}</td><td className="r"><button className="btn ghost sm" disabled=${busy === j.id} onClick=${() => add(j)}>Add to desk</button></td></tr>`)}
        </tbody></table></div>`}
      </div>
    <//>`;
}
function DeskSettings({ onClose }) {
  const toast = useToast();
  const d = useDoc('org/vms/x/settings');
  const [f, setF] = useState(null);
  useEffect(() => {
    if (!d.loading && !f) setF({ mailReq: !(d.data && d.data.mailReq === false), linkOpen: !(d.data && d.data.linkOpen === false), keywords: (d.data && d.data.keywords) || 'requirement, req, urgent, need, position, opening, role, job, c2c, contract, w2, hotlist', minScore: (d.data && d.data.minScore) || 35, agentOn: !!(d.data && d.data.agentOn), agentThreshold: (d.data && d.data.agentThreshold) || 86, agentFollow: !!(d.data && d.data.agentFollow) });
  }, [d.loading]);
  const save = async () => {
    try {
      await api('vms_settings_save', f);
      toast('Settings saved.');
      onClose();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  return html`<${Modal} title="Requirements desk settings" onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Cancel</button><button className="btn" disabled=${!f} onClick=${save}>Save</button>`}>
      ${!f ? html`<${Spinner} />` : html`<div className="form">
        <label className="check"><input type="checkbox" checked=${f.mailReq} onChange=${e => setF({ ...f, mailReq: e.target.checked })} /><span>Turn vendor emails into requirements (shared inbox and each person's connected Gmail)</span></label>
        <${Field} label="Words that mark an email as a requirement" hint="Comma separated, matched in the subject."><input value=${f.keywords} onInput=${e => setF({ ...f, keywords: e.target.value })} /><//>
        <label className="check"><input type="checkbox" checked=${f.linkOpen} onChange=${e => setF({ ...f, linkOpen: e.target.checked })} /><span>Accept postings through the general link (without a vendor's own link)</span></label>
        <${Field} label="Lowest match score to show" hint="Out of 100. Lower it to see more people for every requirement."><input type="number" min="10" max="90" value=${f.minScore} onInput=${e => setF({ ...f, minScore: e.target.value })} /><//>
        <div className="divider"></div>
        <h3 className="ph" style=${{ marginBottom: 0 }}>Vendor auto-reply agent</h3>
        <div className="note amber"><span><b>Off by default.</b> When enabled, vendor-email requirements are matched automatically. Nothing is sent below the ATS gate; below-threshold items are tailored and re-scored first, then sent only if they clear the gate. Every decision is logged.</span></div>
        <label className="check"><input type="checkbox" checked=${f.agentOn} onChange=${e => setF({ ...f, agentOn: e.target.checked })} /><span><b>Enable vendor auto-reply agent</b><br /><span className="muted small">Uses the administrator who enables it as the sending/tailoring owner.</span></span></label>
        <${Field} label="Minimum ATS score to send" hint="Default 86. A candidate below this score is never auto-sent."><input type="number" min="70" max="100" value=${f.agentThreshold} onInput=${e => setF({ ...f, agentThreshold: e.target.value })} /><//>
        <label className="check"><input type="checkbox" checked=${f.agentFollow} onChange=${e => setF({ ...f, agentFollow: e.target.checked })} /><span><b>Send up to 3 automated follow-ups</b><br /><span className="muted small">Scheduled at the next available 9:00 AM, 10:00 AM and 3:00 PM Eastern-time slots. Turn this on only when your vendor-outreach policy allows it.</span></span></label>
      </div>`}
    <//>`;
}

function VendorAgentPanel({ onClose }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState(null);
  const load = () => api('vms_agent_get').then(x => { setErr(null); setD(x); }).catch(e => { setErr(e); toast(errText(e), true); });
  useEffect(() => { load(); }, []);
  const run = async () => { setBusy('run'); try { const r = await api('vms_agent_run', {}, { timeout: 360000 }); toast(`Vendor agent: ${r.sent || 0} sent · ${r.tailored || 0} tailored · ${r.follow || 0} follow-ups · ${r.review || 0} to review.`); await load(); } catch(e) { toast(errText(e), true); } setBusy(''); };
  const retry = async id => { setBusy(id); try { const r = await api('vms_agent_retry', { id }); setD(r); toast('Queued for another agent pass.'); } catch(e) { toast(errText(e), true); } setBusy(''); };
  return html`<${Modal} wide title="Vendor auto-reply agent" onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Close</button><button className="btn" disabled=${!!busy || !(d && d.cfg && d.cfg.on)} onClick=${run}>${busy==='run'?'Running…':'Run agent now'}</button>`}>
    ${!d ? (err ? html`<${LoadError} title="The vendor agent didn't load." error=${err} onRetry=${load} />` : html`<${Spinner} />`) : html`<div className="stack">
      <div className=${'note ' + (d.cfg.on ? 'ok' : 'amber')}><span><b>${d.cfg.on ? 'Agent enabled' : 'Agent is off'}</b> · ATS gate ${d.cfg.threshold}% · ${d.cfg.follow ? 'up to 3 follow-ups at 9/10/3 ET' : 'follow-ups off'}. Change these under Requirements desk → Settings.</span></div>
      <div className="chips">${Object.entries(d.counts || {}).map(([k,n]) => html`<${Chip} key=${k} s=${k==='sent'?'ok':k==='review'?'amber':''}>${k}: ${n}<//>`)}</div>
      ${(d.rows || []).length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Status</th><th>Candidate</th><th>ATS</th><th>Tailored</th><th>Follow-ups</th><th>Latest decision</th><th></th></tr></thead><tbody>${d.rows.map(x => { const lg=x.log||[]; const last=lg.length?lg[lg.length-1]:null; return html`<tr key=${x.id}><td><${Chip} s=${x.st==='sent'?'ok':x.st==='review'?'amber':''}>${x.st}<//></td><td>${x.cand||'—'}</td><td>${x.score||0}% → <b>${x.finalScore||x.score||0}%</b></td><td>${x.tailored?'Yes':'No'}</td><td>${x.followN||0}${x.nextFollow?html`<div className="muted small">next ${fmtTs(x.nextFollow)}</div>`:''}</td><td className="small">${last?last.ev:'—'}</td><td className="r">${x.st==='review'&&html`<button className="btn ghost sm" disabled=${!!busy} onClick=${()=>retry(x.id)}>Retry</button>`}</td></tr>`; })}</tbody></table></div>` : html`<${Empty} title="No vendor-agent items yet">New vendor-email requirements are queued here after the agent is enabled.<//>`}
    </div>`}
  <//>`;
}

/* ---- Requirements desk page ---- */
/* v80: the stored consultant-match summary (->mx) as a small chip on a requirement row. Strong = score 75+. */
function mxChip(r) {
  const mx = r && r.mx;
  if (!mx || typeof mx !== 'object') return '';
  const names = (mx.top || []).map(t => t.n + (t.score ? ' ' + t.score + '%' : '')).join(', ');
  if (!mx.n) return html`<div className="small muted" style=${{ marginTop: 3 }}>No consultant matches yet</div>`;
  return html`<div className="small" style=${{ marginTop: 3 }} title=${names ? 'Top: ' + names : ''}>
    <${Chip} s=${mx.strong ? 'ok' : 'info'}>${mx.strong ? mx.strong + ' strong' : ''}${mx.strong && mx.n > mx.strong ? ' · ' : ''}${mx.n > mx.strong ? mx.n + ' match' + (mx.n === 1 ? '' : 'es') : ''}<//>
    ${names ? html`<span className="muted"> ${names}</span>` : ''}
  </div>`;
}
function ReqDeskPage() {
  const P = usePortal();
  const A = P.admin;
  const toast = useToast();
  const reqs = useCol('vms/req/items', 'at:desc');
  const vendors = vendorsCol();
  const [clientReqs, setClientReqs] = useState([]);
  const [tab, setTab] = useState('inbox');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState(false);
  const [fromJobs, setFromJobs] = useState(false);
  const [settings, setSettings] = useState(false);
  const [agentPanel, setAgentPanel] = useState(false);
  const [tick, setTick] = useState(0);
  const [picked, setPicked] = useState([]);
  const [sharing, setSharing] = useState(null);
  // v35.1: emails dragged onto the desk (or "Grab from emails") open the reader
  const [grab, setGrab] = useState(null);
  const [dragging, setDragging] = useState(false);
  const dragT = useRef(0);
  const shr = useCol('vms/shr/items');
  useEffect(() => {
    if (A && !A.loading && typeof loadReqs === 'function')
      loadReqs(A)
        .then(list => setClientReqs(list.map(r => ({ ...r, id: `e:${r.m.id}:${r.id}`, src: 'client', vn: r.cl, cn: r.m.u.p.n, ce: r.m.u.p.e, st: r.st || 'open' }))))
        .catch(() => setClientReqs([]));
  }, [A && A.loading, A && A.employers && A.employers.length, tick]);
  if (reqs.loading) return html`<${Spinner} label="Loading the desk…" />`;
  const all = [...reqs.docs, ...clientReqs].sort((a, b) => (b.at || 0) - (a.at || 0));
  const inboxN = all.filter(r => r.st === 'new').length;
  const ql = q.trim().toLowerCase();
  const list = all
    .filter(r => {
      const st = r.st || 'open';
      if (tab === 'inbox') return st === 'new';
      if (tab === 'open') return ['open', 'working'].includes(st);
      if (tab === 'sub') return ['submitted', 'interview'].includes(st);
      if (tab === 'done') return ['filled', 'closed', 'dismissed'].includes(st);
      return true;
    })
    .filter(r => !ql || [r.ti, r.vn, r.cl, r.ec, r.loc, r.sk, r.cn].filter(Boolean).join(' ').toLowerCase().includes(ql));
  const cur = open && all.find(r => r.id === open);
  const refresh = () => {
    Sync.kick(0);
    setTick(t => t + 1);
  };
  // v31: sharing (open, accepted requirements only)
  const canShare = r => RS_OPEN.includes(r.st || 'open');
  const shareable = list.filter(canShare);
  const pickedNow = picked.filter(id => all.some(r => r.id === id && canShare(r)));
  const shareOf = {};
  shr.docs.forEach(d => {
    if (d.rid) shareOf[d.rid] = d;
  });
  const shareChips = r => {
    const d = shareOf[r.id];
    if (!d) return null;
    const mailed = (d.sh || []).filter(h => h.ch === 'email').length;
    const social = (d.sh || []).some(h => ['linkedin', 'facebook', 'x', 'whatsapp', 'telegram', 'instagram', 'native'].includes(h.ch));
    return html`${d.on ? html` <${Chip} s="ok">Careers<//>` : ''}${mailed ? html` <${Chip} s="info">Emailed${mailed > 1 ? ' ×' + mailed : ''}<//>` : ''}${social ? html` <${Chip} s="new">Social<//>` : ''}`;
  };
  const allPicked = shareable.length > 0 && shareable.every(r => pickedNow.includes(r.id));
  const quiet = grab || adding || cur || settings || agentPanel || fromJobs || sharing;
  const onDragOver = e => {
    if (quiet || !grabHasData(e)) return;
    e.preventDefault();
    setDragging(true);
    clearTimeout(dragT.current);
    dragT.current = setTimeout(() => setDragging(false), 350);
  };
  const onDrop = e => {
    if (quiet) return;
    e.preventDefault();
    setDragging(false);
    const d = grabDrop(e);
    if (d.files.length || d.text.trim() || d.html.trim()) setGrab(d);
  };
  return html`<div className="stack reqdesk" onDragOver=${onDragOver} onDrop=${onDrop}>
      ${dragging && html`<div className="grabover" aria-hidden="true"><div><${Icon} n="mail" /><b>Drop the emails to grab their requirements</b><span>Outlook emails, .eml files, JD documents or text</span></div></div>`}
      <div className="toolbar">
        <div className="tabs" role="tablist" style=${{ marginBottom: 0, border: 0 }}>
          ${[
            ['inbox', `Inbox${inboxN ? ' (' + inboxN + ')' : ''}`],
            ['open', 'Open'],
            ['sub', 'Submitted'],
            ['done', 'Filled or closed'],
            ['all', 'All'],
          ].map(([k, n]) => html`<button key=${k} role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${n}</button>`)}
        </div>
        <input type="search" style=${{ maxWidth: 260 }} placeholder="Search" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Search requirements" />
        <div className="push">
          ${(P.roles || []).includes('admin') && html`<button className="btn ghost" onClick=${() => setAgentPanel(true)}>Vendor agent</button><button className="btn ghost" onClick=${() => setSettings(true)}>Settings</button>`}
          ${tab !== 'inbox' && shareable.length > 0 && html`<button className="btn ghost" onClick=${() => setSharing(pickedNow.length ? pickedNow : shareable.map(r => r.id).slice(0, 30))} title="Email them to vendors, clients and consultants, post them on the careers page and share them to social media"><${Icon} n="send" />${pickedNow.length ? `Share ${pickedNow.length} selected` : tab === 'open' ? 'Share open requirements' : `Share ${shareable.length === 1 ? 'this one' : 'these ' + Math.min(30, shareable.length)}`}</button>`}
          ${impCan('req') && html`<a className="btn ghost" href=${impHref('req')} title="A spreadsheet or a VMS export, checked row by row before anything is saved"><${Icon} n="up" />Import</a>`}
          <button className="btn ghost" onClick=${() => setFromJobs(true)}>From job boards</button>
          <button className="btn ghost" onClick=${() => setGrab({ files: [], text: '', html: '' })} title="Drag Outlook or .eml emails (several at once), JD files, or paste emails"><${Icon} n="mail" />Grab from emails</button>
          <button className="btn" onClick=${() => setAdding(true)}><${Icon} n="plus" />Add requirement</button>
        </div>
      </div>
      ${
        tab === 'inbox' &&
        html`<p className="muted small">Requirements that arrived on their own: vendor emails that read like a requirement, postings through the website link, and what client contacts post in the client portal. Open one to accept it to the desk, or dismiss it.</p>`
      }
      <section className="panel" style=${{ padding: '6px 8px' }}>
        ${
          list.length
            ? html`<div className="tblwrap">
                <table className="tbl">
                  <thead><tr>${tab !== 'inbox' && html`<th className="pickcol">${shareable.length > 0 && html`<input type="checkbox" aria-label="Pick every open requirement shown" checked=${allPicked} onChange=${e => setPicked(e.target.checked ? [...new Set([...pickedNow, ...shareable.map(r => r.id)])] : pickedNow.filter(id => !shareable.some(r => r.id === id)))} />`}</th>`}<th>Role</th><th>Vendor · client</th><th>Location</th><th>Rate · type</th><th>From</th><th>Status</th><th className="r">Received</th></tr></thead>
                  <tbody>
                    ${list.map(
                      r => html`<tr key=${r.id} className="click" tabIndex="0" onClick=${() => setOpen(r.id)}>
                          ${tab !== 'inbox' && html`<td className="pickcol" onClick=${e => e.stopPropagation()}>${canShare(r) && html`<input type="checkbox" aria-label=${'Pick ' + r.ti} checked=${pickedNow.includes(r.id)} onChange=${e => setPicked(e.target.checked ? [...pickedNow, r.id] : pickedNow.filter(x => x !== r.id))} />`}</td>`}
                          <td><b style=${{ fontWeight: 600 }}>${r.ti}</b>${r.sk ? html`<div className="muted small">${String(r.sk).slice(0, 90)}</div>` : ''}${r.lob === 'hc' ? html`<div className="small"><${Chip} s="new">Healthcare<//> ${hcLine(r.hc)}</div>` : ''}${mxChip(r)}</td>
                          <td className="small">${r.vn || '—'}${r.ec && r.ec !== r.vn ? html`<div className="muted">${r.ec}</div>` : ''}</td>
                          <td className="small">${r.loc || '—'}${r.md ? html`<div className="muted">${r.md}</div>` : ''}</td>
                          <td className="small">${[r.rate, r.ty].filter(Boolean).join(' · ') || '—'}</td>
                          <td className="small">${REQ_SRC[r.src] || r.src}</td>
                          <td><${Chip} s=${(DESK_ST[r.st] || ['', ''])[1]}>${(DESK_ST[r.st] || [r.st])[0]}<//>${shareChips(r)}</td>
                          <td className="r small">${fmtDay(r.at)}</td>
                        </tr>`
                    )}
                  </tbody>
                </table>
              </div>`
            : html`<${Empty} title=${tab === 'inbox' ? 'Nothing waiting' : 'No requirements here'}>${tab === 'inbox' ? 'New requirements from vendor emails, the posting link and the client portal show up here. You can also drag vendor emails onto this page.' : 'Add one, drag vendor emails onto this page, pull one from the job boards, or accept one from the Inbox.'}<//>`
        }
      </section>
      ${adding && html`<${Modal} wide title="Add a requirement" onClose=${() => setAdding(false)}><${DeskReqForm} vendors=${vendors.docs} onClose=${() => setAdding(false)} onGrab=${d => {
        setAdding(false);
        setGrab(d);
      }} onSaved=${id => {
        setAdding(false);
        setOpen(id);
      }} /><//>`}
      ${grab && html`<${ReqGrabModal} init=${grab} onClose=${() => setGrab(null)} onAdded=${ids => {
        setGrab(null);
        setTab(ids.length ? 'all' : tab);
        refresh();
      }} />`}
      ${fromJobs && html`<${FromJobs} onClose=${() => setFromJobs(false)} onAdded=${id => {
        setFromJobs(false);
        setOpen(id);
      }} />`}
      ${settings && html`<${DeskSettings} onClose=${() => setSettings(false)} />`}
      ${agentPanel && html`<${VendorAgentPanel} onClose=${() => setAgentPanel(false)} />`}
      ${cur && html`<${ReqModal} req=${cur} vendors=${vendors.docs} onClose=${() => setOpen(null)} onChanged=${refresh} />`}
      ${sharing && html`<${ReqShareModal} ids=${sharing} onClose=${() => setSharing(null)} onChanged=${refresh} />`}
    </div>`;
}

/* ---- bulk import into the consultant database ---- */
function ImportCandidates({ onClose, onDone }) {
  const toast = useToast();
  const [files, setFiles] = useState([]);
  const [tags, setTags] = useState('');
  const [update, setUpdate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(0);
  const [res, setRes] = useState(null);
  const go = async () => {
    if (!files.length) {
      toast('Choose the files first.', true);
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      files.forEach(f => fd.append('files[]', f, f.name));
      fd.append('tags', tags);
      fd.append('update', update ? '1' : '0');
      const r = await upload('vms_import', fd, setProg);
      setRes(r);
      onDone && onDone();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<${Modal} title="Import candidates" onClose=${onClose} foot=${res ? html`<button className="btn" onClick=${onClose}>Done</button>` : html`<button className="btn ghost" onClick=${onClose}>Cancel</button><button className="btn" disabled=${busy || !files.length} onClick=${go}>${busy ? 'Importing…' : 'Import'}</button>`}>
      ${
        res
          ? html`<div className="stack">
              <div className="note ok"><span><b>${res.added} added, ${res.updated} updated, ${res.skipped} skipped.</b></span></div>
              ${res.failed && res.failed.length > 0 && html`<div className="note amber"><span><b>${res.failed.length} file${res.failed.length === 1 ? '' : 's'} could not be read:</b> ${res.failed.join('; ')}</span></div>`}
              <p className="muted small">Skipped means the person was already in the database (same email, phone or name). Tick "Update people already in the database" to fill their empty fields instead.</p>
            </div>`
          : html`<div className="form">
              ${impCan('cons') && html`<div className="note info"><span><b>A spreadsheet?</b> Import with preview shows what every row will do (new, updated, a likely duplicate, a value it cannot read) before anything is saved, and can be undone.</span><div className="actions"><a className="btn sm" href=${impHref('cons')}>Import with preview</a></div></div>`}
              <${Field} label="Files" hint="A CSV or Excel sheet (first row = column names: Name, Email, Phone, Title, Skills, Location, Visa, Rate…), or any number of resumes (PDF, Word, text). Up to 12 MB each.">
                <input type="file" multiple accept=".csv,.tsv,.xlsx,.pdf,.docx,.txt" onChange=${e => setFiles([...e.target.files])} />
                ${files.length > 0 && html`<div className="muted small" style=${{ marginTop: 6 }}>${files.length} file${files.length === 1 ? '' : 's'} chosen</div>`}
              <//>
              <${Field} label="Tag everyone with" hint="Comma separated, e.g. hotlist-oct, sap, bench"><input value=${tags} onInput=${e => setTags(e.target.value)} /><//>
              <label className="check"><input type="checkbox" checked=${update} onChange=${e => setUpdate(e.target.checked)} /><span>Update people already in the database (fills empty fields, adds tags)</span></label>
              ${busy && html`<div className="prog"><i style=${{ width: Math.round(prog * 100) + '%' }} /></div>`}
              <p className="muted small">Duplicates are found by email, then phone, then name. Resumes are read for the title, skills, location and years of experience and attached to the record.</p>
            </div>`
      }
    <//>`;
}

/* ---- the public posting form (#/post-requirement?v=...) ---- */
function PostRequirementPage({ q }) {
  const [info, setInfo] = useState(null);
  const [f, setF] = useState({ ti: '', cl: '', loc: '', md: 'Onsite', ty: 'C2C', rate: '', dur: '', n: 1, sk: '', visa: '', d: '', cn: '', ce: '', cp: '', vn: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');
  const t0 = useRef(Date.now());
  const up = k => e => setF({ ...f, [k]: e.target.value });
  useEffect(() => {
    api('vms_vendor_of&v=' + encodeURIComponent(q.v || ''))
      .then(setInfo)
      .catch(() => setInfo({ vendor: '', open: true }));
  }, [q.v]);
  const send = async e => {
    e.preventDefault();
    setErr('');
    if (!f.ti.trim()) {
      setErr('Add the role or job title.');
      return;
    }
    if (!f.ce.trim() || !/^\S+@\S+\.\S+$/.test(f.ce)) {
      setErr('Add your email so we can reply.');
      return;
    }
    setBusy(true);
    try {
      await api('vms_post', { ...f, v: q.v || '', website: botTrap.hp, t0: t0.current });
      setDone(true);
    } catch (x) {
      setErr(errText(x));
    }
    setBusy(false);
  };
  const vendor = info && info.vendor;
  return html`<${Fragment}>
      <${PageHead} title=${vendor ? `Send a requirement from ${vendor}` : 'Send StratEdge a requirement'} intro="Paste the requirement as it is. Our team matches it against the consultant database the moment it arrives and comes back with profiles, usually the same day." />
      <section className="sec">
      <div className="wrap" style=${{ maxWidth: 860 }}>
        ${
          done
            ? html`<div className="panel" style=${{ marginTop: 24 }}><h2 style=${{ marginTop: 0 }}>Received, thank you.</h2><p className="muted">The requirement is on our desk. You will hear from us at ${f.ce} shortly. Email <a href=${'mailto:' + CO.email}>${CO.email}</a> if anything changes.</p><a className="btn" href="#/">Back to the website</a></div>`
            : info && !info.open && !vendor
              ? html`<div className="panel" style=${{ marginTop: 24 }}><p className="muted">This posting link needs a vendor code. Ask your StratEdge contact for your link, or email <a href=${'mailto:' + CO.email}>${CO.email}</a>.</p></div>`
              : html`<form className="panel form" style=${{ marginTop: 24 }} onSubmit=${send} noValidate>
                  ${!vendor && html`<${Field} label="Your company"><input value=${f.vn} onInput=${up('vn')} placeholder="Vendor or client name" /><//>`}
                  <div className="row2">
                    <${Field} label="Role / job title *"><input value=${f.ti} onInput=${up('ti')} placeholder="e.g. Senior Java Developer" /><//>
                    <${Field} label="End client (if you can share it)"><input value=${f.cl} onInput=${up('cl')} /><//>
                  </div>
                  <div className="row3">
                    <${Field} label="Location"><input value=${f.loc} onInput=${up('loc')} placeholder="City, state" /><//>
                    <${Field} label="Work mode"><select value=${f.md} onChange=${up('md')}>${['Onsite', 'Hybrid', 'Remote'].map(t => html`<option key=${t}>${t}</option>`)}</select><//>
                    <${Field} label="Engagement"><select value=${f.ty} onChange=${up('ty')}>${['C2C', 'W2', '1099', 'Contract-to-hire', 'Full-time', 'SOW'].map(t => html`<option key=${t}>${t}</option>`)}</select><//>
                  </div>
                  <div className="row3">
                    <${Field} label="Rate"><input value=${f.rate} onInput=${up('rate')} placeholder="$70/h C2C" /><//>
                    <${Field} label="Duration"><input value=${f.dur} onInput=${up('dur')} placeholder="12 months" /><//>
                    <${Field} label="Openings"><input type="number" min="1" value=${f.n} onInput=${up('n')} /><//>
                  </div>
                  <div className="row2">
                    <${Field} label="Must-have skills"><input value=${f.sk} onInput=${up('sk')} placeholder="Java, Spring Boot, AWS" /><//>
                    <${Field} label="Visa / work authorization"><input value=${f.visa} onInput=${up('visa')} placeholder="USC, GC, H-1B ok" /><//>
                  </div>
                  <${Field} label="Job description"><textarea value=${f.d} onInput=${up('d')} style=${{ minHeight: 160 }} placeholder="Paste the full requirement" /><//>
                  <div className="row3">
                    <${Field} label="Your name"><input value=${f.cn} onInput=${up('cn')} /><//>
                    <${Field} label="Your email *"><input type="email" value=${f.ce} onInput=${up('ce')} /><//>
                    <${Field} label="Phone"><input value=${f.cp} onInput=${up('cp')} /><//>
                  </div>
                  <${BotTrap} />
                  ${err && html`<div className="note red"><span>${err}</span></div>`}
                  <div className="actions"><button className="btn lg" disabled=${busy || !info}>${busy ? 'Sending…' : 'Send the requirement'}</button></div>
                </form>`
        }
      </div>
    </section>
    <//>`;
}
