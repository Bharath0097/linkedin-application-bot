/* ================= CRM: companies, contacts, opportunities and follow-ups =================
   The pick-lists (pipeline stages with a win probability, company types and statuses, industries, sources, lost
   reasons, follow-up types, currencies, payment terms) live in crm/main/x/settings and are edited under Settings.
   Records: crm/main/acc (companies), crm/main/con (contacts), crm/main/deal (opportunities), crm/main/act (follow-ups). */
const CRM_DEFAULTS = {
  stages: [
    { k: 'lead', n: 'Lead', p: 10 },
    { k: 'qualified', n: 'Qualified', p: 25 },
    { k: 'proposal', n: 'Proposal sent', p: 50 },
    { k: 'negotiation', n: 'Negotiation', p: 75 },
    { k: 'won', n: 'Won', p: 100 },
    { k: 'lost', n: 'Lost', p: 0 },
  ],
  types: ['End client', 'Prime vendor', 'Implementation partner', 'Vendor', 'Sub-vendor', 'Prospect'],
  statuses: ['Active', 'Prospect', 'On hold', 'Inactive'],
  inds: ['IT services', 'Banking & finance', 'Insurance', 'Healthcare', 'Pharma & life sciences', 'Retail & e-commerce', 'Manufacturing', 'Telecom', 'Government', 'Energy & utilities', 'Education', 'Other'],
  rels: ['Hiring manager', 'Recruiter', 'Account manager', 'Procurement', 'Accounts payable', 'Executive', 'Other'],
  kinds: ['Staffing (T&M)', 'SOW project', 'Consulting', 'Training', 'Other'],
  srcs: ['Referral', 'LinkedIn', 'Email campaign', 'Website', 'Vendor portal', 'Cold outreach', 'Existing client', 'Other'],
  acts: ['Call', 'Email', 'Meeting', 'Follow-up', 'Note'],
  lost: ['Price', 'Went with another vendor', 'No budget', 'Position cancelled', 'No response', 'Timing', 'Other'],
  curs: ['USD', 'INR'],
  terms: ['Net 15', 'Net 30', 'Net 45', 'Net 60', 'Due on receipt'],
};
const CRM_LIST_NAMES = {
  types: ['Company types', 'The kind of company: end client, prime vendor, partner…'],
  statuses: ['Company statuses', 'Active, Prospect, On hold… The first one is the default for new companies.'],
  inds: ['Industries', ''],
  rels: ['Contact relationships', 'What a contact is to you: hiring manager, recruiter, procurement…'],
  kinds: ['Opportunity kinds', ''],
  srcs: ['Sources', 'Where opportunities come from.'],
  acts: ['Follow-up types', ''],
  lost: ['Lost reasons', 'Asked for when an opportunity is moved to Lost.'],
  curs: ['Currencies', ''],
  terms: ['Payment terms', ''],
};
const crmSlug = s =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'stage';
/* The lists in use: whatever is saved, with the built-in defaults for anything missing. Won and Lost always exist. */
function crmSettings(raw) {
  const s = raw || {};
  const out = {};
  Object.keys(CRM_DEFAULTS).forEach(k => {
    const v = Array.isArray(s[k]) ? s[k].filter(x => x != null && x !== '') : [];
    out[k] = v.length ? v : CRM_DEFAULTS[k];
  });
  out.stages = out.stages
    .map(x => (typeof x === 'string' ? { k: crmSlug(x), n: x, p: 50 } : { k: crmSlug(x.k || x.n), n: String(x.n || x.k || ''), p: Math.max(0, Math.min(100, Math.round(+x.p || 0))) }))
    .filter(x => x.n);
  if (!out.stages.some(x => x.k === 'won')) out.stages.push({ k: 'won', n: 'Won', p: 100 });
  if (!out.stages.some(x => x.k === 'lost')) out.stages.push({ k: 'lost', n: 'Lost', p: 0 });
  Object.assign(out, crmExtra(s)); // v29: lead scoring, assignment, workflow rules, custom fields
  return out;
}
const crmStage = (S, k) => S.stages.find(s => s.k === (k || 'lead')) || S.stages[0];
const crmOpen = d => !['won', 'lost'].includes(d.stage || 'lead');
const crmFields = S => ({
  acc: [
    { k: 'n', n: 'Company', req: 1 },
    { k: 'ty', n: 'Type', t: 'select', o: S.types },
    { k: 'st', n: 'Status', t: 'select', o: S.statuses, chip: { Active: 'ok', Prospect: 'new', 'On hold': 'warn' } },
    { k: 'own', n: 'Owner', t: 'person' },
    { k: 'web', n: 'Website', t: 'url' },
    { k: 'ind', n: 'Industry', t: 'select', o: S.inds },
    { k: 'loc', n: 'Location', ph: 'City, state' },
    { k: 'e', n: 'Main email', t: 'email' },
    { k: 'ph', n: 'Phone', t: 'tel' },
    { k: 'terms', n: 'Payment terms', t: 'select', o: S.terms },
    { k: 'msa', n: 'MSA signed', t: 'check', cl: 'Master services agreement in place' },
    { k: 'vms', n: 'Vendor portal / VMS', ph: 'e.g. Beeline, Fieldglass, supplier portal URL' },
    ...crmCustomFields(S.custom, 'acc'),
    { k: 'notes', n: 'Notes', t: 'textarea' },
  ],
  con: [
    { k: 'n', n: 'Name', req: 1 },
    { k: 'acc', n: 'Company', t: 'ref', ref: 'acc' },
    { k: 'ti', n: 'Title', ph: 'e.g. Delivery manager' },
    { k: 'e', n: 'Email', t: 'email' },
    { k: 'ph', n: 'Phone', t: 'tel' },
    { k: 'li', n: 'LinkedIn', t: 'url' },
    { k: 'rel', n: 'Relationship', t: 'select', o: S.rels },
    ...crmCustomFields(S.custom, 'con'),
    { k: 'notes', n: 'Notes', t: 'textarea' },
  ],
  deal: [
    { k: 't', n: 'Opportunity', req: 1, ph: 'e.g. 3 SAP PP/QM consultants, Q1' },
    { k: 'acc', n: 'Company', t: 'ref', ref: 'acc' },
    { k: 'stage', n: 'Stage', t: 'select', o: S.stages.map(x => [x.k, x.n + (x.k === 'won' || x.k === 'lost' ? '' : ' · ' + x.p + '%')]), req: 1 },
    { k: 'why', n: 'Lost reason', t: 'select', o: S.lost, hide: f => f.stage !== 'lost' },
    { k: 'v', n: 'Value', t: 'money' },
    { k: 'cur', n: 'Currency', t: 'select', o: S.curs },
    { k: 'kind', n: 'Kind', t: 'select', o: S.kinds },
    { k: 'close', n: 'Expected close', t: 'date' },
    { k: 'own', n: 'Owner', t: 'person' },
    { k: 'src', n: 'Source', t: 'select', o: S.srcs },
    { k: 'con', n: 'Contact', t: 'ref', ref: 'con' },
    { k: 'next', n: 'Next step', ph: 'e.g. Send rate card Friday' },
    ...crmCustomFields(S.custom, 'deal'),
    { k: 'notes', n: 'Notes', t: 'textarea' },
  ],
  act: [
    { k: 't', n: 'Subject', req: 1, ph: 'e.g. Follow up on proposal' },
    { k: 'kind', n: 'Type', t: 'select', o: S.acts },
    { k: 'due', n: 'Due', t: 'date' },
    { k: 'acc', n: 'Company', t: 'ref', ref: 'acc' },
    { k: 'deal', n: 'Opportunity', t: 'ref', ref: 'deal' },
    { k: 'con', n: 'Contact', t: 'ref', ref: 'con' },
    { k: 'own', n: 'Owner', t: 'person' },
    { k: 'done', n: 'Done', t: 'check', cl: 'Completed', yes: 'Done' },
    { k: 'notes', n: 'Notes', t: 'textarea' },
  ],
});
/* The My email page of whichever portal the person is in, with the compose window opened to someone. */
const mymailHref = (to, subject) => {
  const m = location.hash.split('?')[0].match(/^#\/portal\/(admin|hr|acct|manager)(\/|$)/);
  const q = [];
  if (to) q.push('to=' + encodeURIComponent(to));
  if (subject) q.push('subject=' + encodeURIComponent(subject));
  return (m ? `#/portal/${m[1]}/mymail` : '#/portal/mymail') + (q.length ? '?' + q.join('&') : '');
};
function CRMBoard({ deals, refs, S, accs, onOpen }) {
  const P = usePortal();
  const toast = useToast();
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState('');
  const [lost, setLost] = useState(null);
  const move = async (d, st) => {
    if ((d.stage || 'lead') === st) return;
    if (st === 'lost') {
      setLost(d);
      return;
    }
    try {
      await dbMerge(`crm/main/deal/${d.id}`, { stage: st, u: Date.now(), ...(st === 'won' ? { closedAt: Date.now(), why: '' } : {}) });
      const made = await applyFlows(S, 'deal', { ...d, stage: st }, d.stage, P);
      if (made) toast(`${made} follow-up${made === 1 ? '' : 's'} created by your workflow rules.`);
      const a = st === 'won' && d.acc && accs.find(x => x.id === d.acc);
      if (a && (a.st || 'Prospect') === 'Prospect') {
        await dbMerge(`crm/main/acc/${a.id}`, { st: 'Active', u: Date.now() });
        toast(`Won. ${a.n} is now an active company.`);
      } else toast(`Moved to ${crmStage(S, st).n}.`);
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const idx = st => S.stages.findIndex(s => s.k === st);
  return html`<div className="kanban">
      ${S.stages.map((stg, i) => {
        const st = stg.k;
        const list = deals.filter(d => (d.stage || 'lead') === st);
        const sum = {};
        list.forEach(d => {
          sum[d.cur || 'USD'] = (sum[d.cur || 'USD'] || 0) + (+d.v || 0);
        });
        return html`<div key=${st} className=${'kcol k-' + st + (over === st ? ' over' : '')}
            onDragOver=${e => {
              e.preventDefault();
              setOver(st);
            }}
            onDragLeave=${() => setOver('')}
            onDrop=${e => {
              e.preventDefault();
              setOver('');
              const id = drag || e.dataTransfer.getData('text/plain');
              const d = deals.find(x => x.id === id);
              if (d) move(d, st);
              setDrag(null);
            }}>
            <div className="khead">
              <b>${stg.n}${st !== 'won' && st !== 'lost' ? html` <span className="muted small" style=${{ fontWeight: 400 }}>${stg.p}%</span>` : null}</b>
              <span>${list.length}</span>
            </div>
            <div className="ksum">${Object.entries(sum).filter(([, v]) => v).map(([c, v]) => fmtMoney(v, c)).join(' + ') || ' '}</div>
            ${list.map(
              d => html`<div key=${d.id} className="kcard" draggable="true" tabIndex="0"
                  onDragStart=${e => {
                    setDrag(d.id);
                    e.dataTransfer.setData('text/plain', d.id);
                  }}
                  onClick=${() => onOpen(d)}
                  onKeyDown=${e => e.key === 'Enter' && onOpen(d)}>
                  <b>${d.t}</b>
                  <span className="muted small">${refName(refs.acc, d.acc) || 'No company yet'}</span>
                  <div className="kmeta">
                    ${d.v ? html`<span className="kval">${fmtMoney(+d.v, d.cur || 'USD')}</span>` : null}
                    ${d.close && html`<span className=${'small' + (d.close < dkey() && st !== 'won' && st !== 'lost' ? ' late' : '')}>${fmtDate(d.close)}</span>`}
                    ${d.own && html`<span className="kown" title=${kitName(P, d.own)}>${(kitName(P, d.own) || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2)}</span>`}
                  </div>
                  ${st === 'lost' && d.why ? html`<span className="knext">Lost: ${d.why}</span>` : d.next ? html`<span className="knext">Next: ${d.next}</span>` : null}
                  <div className="kmove" onClick=${e => e.stopPropagation()}>
                    <button type="button" className="btn ghost sm icon" aria-label="Move back" disabled=${i === 0} onClick=${() => move(d, S.stages[idx(d.stage || 'lead') - 1].k)}><${Icon} n="left" /></button>
                    <button type="button" className="btn ghost sm icon" aria-label="Move forward" disabled=${i === S.stages.length - 1} onClick=${() => move(d, S.stages[idx(d.stage || 'lead') + 1].k)}><${Icon} n="right" /></button>
                  </div>
                </div>`
            )}
          </div>`;
      })}
      ${lost && html`<${CRMLost} d=${lost} S=${S} onClose=${() => setLost(null)} />`}
    </div>`;
}
/* Moving an opportunity to Lost asks why, so the pipeline report can say where deals go. */
function CRMLost({ d, S, onClose }) {
  const toast = useToast();
  const [why, setWhy] = useState(S.lost[0] || '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await dbMerge(`crm/main/deal/${d.id}`, { stage: 'lost', why, lostNote: note.trim(), closedAt: Date.now(), u: Date.now() });
      toast('Marked as lost.');
      onClose();
    } catch (e) {
      toast(errText(e), true);
      setBusy(false);
    }
  };
  return html`<${Modal} title=${'Lost: ' + d.t} onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Cancel</button><button type="button" className="btn" disabled=${busy} onClick=${save}>Mark as lost</button>`}>
      <div className="form">
        <${Field} label="Why was it lost?"><select value=${why} onChange=${e => setWhy(e.target.value)}>${S.lost.map(x => html`<option key=${x}>${x}</option>`)}</select><//>
        <${Field} label="Anything to remember" hint="Who they went with, what they said, when to try again."><div className="aibar"><${AiWrite} kind="note" label="Tidy up with AI" value=${note} ctx=${{ deal: d.t, reason: why }} onUse=${t => setNote(t)} /></div><textarea rows="3" value=${note} onInput=${e => setNote(e.target.value)} /><//>
      </div>
    <//>`;
}
/* Bring companies and contacts in from the email contact list, the vendors list and the client workspaces. */
function CRMImport({ onClose }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [done, setDone] = useState({});
  const run = async src => {
    setBusy(src);
    try {
      const r = await api('crm_import', { src });
      setDone({ ...done, [src]: r });
      toast(r.added ? `${r.added} contact${r.added === 1 ? '' : 's'} added.` : 'Nothing new to add.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const opts = [
    ['mail', 'Email contacts', 'Everyone in Email › Contacts, with their company, title, phone and city. Tags set the company type.'],
    ['vendors', 'Vendors', 'The vendors from Vendors & clients with their contacts, website, payment terms and MSA.'],
    ['clients', 'Clients', 'The client workspaces and the client contacts who sign in to them, as end clients.'],
  ];
  return html`<${Modal} title="Import into the CRM" onClose=${onClose} foot=${html`<button type="button" className="btn" onClick=${onClose}>Done</button>`}>
      <p className="muted small" style=${{ marginTop: 0 }}>Contacts already in the CRM (same email) and companies already there (same name) are left as they are, so importing twice is safe.</p>
      <div className="stack">
        ${opts.map(
          ([k, n, d]) => html`<div key=${k} className="panel" style=${{ display: 'flex', gap: 12, alignItems: 'center', background: 'var(--surface-2)' }}>
              <div style=${{ flex: 1 }}>
                <b>${n}</b>
                <div className="muted small">${d}</div>
                ${done[k] && html`<div className="small" style=${{ marginTop: 4 }}>Added ${done[k].added} contact${done[k].added === 1 ? '' : 's'} and ${done[k].companies} compan${done[k].companies === 1 ? 'y' : 'ies'}; ${done[k].skipped} already there.</div>`}
              </div>
              <button type="button" className="btn ghost" disabled=${!!busy} onClick=${() => run(k)}>${busy === k ? 'Importing…' : 'Import'}</button>
            </div>`
        )}
        ${
          (impCan('crmco') || impCan('crm') || impCan('lead')) &&
          html`<div className="panel" style=${{ background: 'var(--surface-2)' }}>
            <b>From a spreadsheet</b>
            <div className="muted small">Excel or CSV, checked row by row before anything is saved (new, updated, likely duplicates, values it cannot read), and can be undone.</div>
            <div className="actions" style=${{ marginTop: 8 }}>
              ${impCan('crmco') && html`<a className="btn ghost sm" href=${impHref('crmco')}>Companies</a>`}
              ${impCan('crm') && html`<a className="btn ghost sm" href=${impHref('crm')}>Contacts with their companies</a>`}
              ${impCan('lead') && html`<a className="btn ghost sm" href=${impHref('lead')}>Leads</a>`}
            </div>
          </div>`
        }
      </div>
    <//>`;
}
const CRM_TL_ICON = { deal: 'target', won: 'check', lost: 'x', act: 'tasks', con: 'user', inv: 'money', req: 'brief', mailin: 'inbox', mailout: 'send' };
/* One company: who it is, what is open, and everything that happened with it, newest first. */
function CompanyView({ id, S, F, refs, accs, cons, deals, acts, onClose }) {
  const P = usePortal();
  const toast = useToast();
  const a = accs.find(x => x.id === id);
  const [tab, setTab] = useState('timeline');
  const [tl, setTl] = useState(null);
  const [tlErr, setTlErr] = useState(null);
  const [form, setForm] = useState(null);
  const load = () =>
    api('crm_timeline', { acc: id })
      .then(r => {
        setTl(r);
        setTlErr(null);
      })
      .catch(e => setTlErr(e));
  useEffect(() => {
    load();
  }, [id]);
  if (!a) return null;
  const myCons = cons.filter(c => c.acc === id);
  const myDeals = deals.filter(d => d.acc === id);
  const myActs = acts.filter(x => x.acc === id);
  const open = myDeals.filter(crmOpen);
  const won = myDeals.filter(d => d.stage === 'won');
  const usd = l => l.filter(d => (d.cur || 'USD') === 'USD').reduce((s, d) => s + (+d.v || 0), 0);
  const today = dkey();
  const late = myActs.filter(x => !x.done && x.due && x.due < today).length;
  const rows = [];
  myDeals.forEach(d => {
    rows.push({ at: d.at || d.u, k: 'deal', t: d.t, sub: `Opportunity added · ${crmStage(S, d.stage).n}${d.v ? ' · ' + fmtMoney(+d.v, d.cur || 'USD') : ''}` });
    if (d.closedAt && (d.stage === 'won' || d.stage === 'lost')) rows.push({ at: d.closedAt, k: d.stage, t: d.t, sub: d.stage === 'won' ? `Won${d.v ? ' · ' + fmtMoney(+d.v, d.cur || 'USD') : ''}` : `Lost${d.why ? ' · ' + d.why : ''}${d.lostNote ? ' · ' + d.lostNote : ''}` });
  });
  myActs.forEach(x => rows.push({ at: x.due ? new Date(x.due + 'T12:00:00').getTime() : x.at || x.u, k: 'act', t: x.t, sub: `${x.kind || 'Follow-up'} · ${x.done ? 'done' : x.due && x.due < today ? 'late' : 'planned'}${x.own ? ' · ' + kitName(P, x.own) : ''}`, late: !x.done && x.due && x.due < today }));
  myCons.forEach(c => rows.push({ at: c.at || c.u, k: 'con', t: c.n, sub: `Contact added${c.ti ? ' · ' + c.ti : ''}${c.src ? ' · from ' + c.src : ''}` }));
  (tl ? tl.items : []).forEach(it =>
    rows.push({
      at: it.at,
      k: it.k === 'mail' ? (it.dir === 'in' ? 'mailin' : 'mailout') : it.k,
      t: it.t || (it.k === 'mail' ? '(no subject)' : ''),
      sub:
        it.k === 'inv'
          ? `Invoice · ${INV_LABEL(it.st)} · ${fmtMoney(it.v, it.cur)}${it.paid ? ', ' + fmtMoney(it.paid, it.cur) + ' paid' : ''}${it.due ? ' · due ' + fmtDate(it.due) : ''}`
          : it.k === 'req'
            ? `Requirement · ${it.st}${it.loc ? ' · ' + it.loc : ''}${it.rate ? ' · ' + it.rate : ''}`
            : `${it.dir === 'in' ? 'Email from' : 'Email to'} ${it.who} · ${it.via}${it.st === 'bounced' ? ' · bounced' : it.st === 'failed' ? ' · failed' : ''}`,
      snippet: it.snippet,
      bad: it.st === 'bounced' || it.st === 'failed',
    })
  );
  rows.sort((x, y) => (y.at || 0) - (x.at || 0));
  const openForm = (col, fields, noun, init) => setForm({ col, fields, noun, init });
  const saveForm = async v => {
    await kitSave(form.col, form.fields, form.init, v, P, {});
    toast(form.init.id ? `${form.noun} saved.` : `${form.noun} added.`);
  };
  const delForm = async () => {
    if (!confirm(`Delete this ${form.noun.toLowerCase()}? This can't be undone.`)) return;
    try {
      await dbDel(`${form.col}/${form.init.id}`);
      setForm(null);
      if (form.col === 'crm/main/acc') onClose();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const firstEmail = (myCons.find(c => c.e) || {}).e || a.e || '';
  const accF = F.acc.find(x => x.k === 'st');
  return html`<${Modal} wide title=${a.n} onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Close</button>`}>
      <div className="stack">
        <div className="cohead">
          <div className="stack" style=${{ gap: 4, flex: 1, minWidth: 0 }}>
            <div className="chips">
              ${a.ty && html`<${Chip}>${a.ty}<//>`}
              ${a.st && html`<${Chip} s=${(accF.chip || {})[a.st] || ''}>${a.st}<//>`}
              ${a.msa && html`<${Chip} s="ok">MSA signed<//>`}
              ${a.cid && html`<${Chip} s="new">Client workspace<//>`}
              ${a.vid && html`<${Chip} s="new">On the vendors list<//>`}
            </div>
            <div className="muted small">
              ${[a.ind, a.loc, a.terms, a.own ? 'Owner ' + kitName(P, a.own) : ''].filter(Boolean).join(' · ')}
              ${a.web && html` · <a href=${/^https?:/i.test(a.web) ? a.web : 'https://' + a.web} target="_blank" rel="noopener">${String(a.web).replace(/^https?:\/\//, '')}</a>`}
              ${a.e && html` · <a href=${'mailto:' + a.e}>${a.e}</a>`}
              ${a.ph && html` · <${CallLink} n=${a.ph} ref=${'acc:' + id} name=${a.n} />`}
            </div>
            ${a.notes && html`<p className="small" style=${{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>${a.notes}</p>`}
          </div>
          <div className="actions" style=${{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button type="button" className="btn ghost sm" onClick=${() => openForm('crm/main/acc', F.acc, 'Company', a)}><${Icon} n="pen" />Edit</button>
            ${firstEmail && html`<a className="btn ghost sm" href=${mymailHref(firstEmail)} onClick=${onClose}><${Icon} n="mail" />Email</a>`}
            <button type="button" className="btn ghost sm" onClick=${() => openForm('crm/main/act', F.act, 'Follow-up', { kind: 'Follow-up', due: today, own: P.uid, acc: id })}><${Icon} n="tasks" />Follow-up</button>
            <button type="button" className="btn ghost sm" onClick=${() => openForm('crm/main/con', F.con, 'Contact', { acc: id })}><${Icon} n="user" />Contact</button>
            <button type="button" className="btn sm" onClick=${() => openForm('crm/main/deal', F.deal, 'Opportunity', { stage: S.stages[0].k, cur: S.curs[0], own: P.uid, acc: id })}><${Icon} n="plus" />Opportunity</button>
          </div>
        </div>
        <${KitStats} items=${[
          { v: fmtMoney(usd(open), 'USD'), l: `Open (USD), ${open.length} deal${open.length === 1 ? '' : 's'}`, onClick: () => setTab('deals') },
          { v: fmtMoney(usd(won), 'USD'), l: `Won (USD), ${won.length} deal${won.length === 1 ? '' : 's'}`, tone: won.length ? 'ok' : '' },
          { v: myCons.length, l: 'Contacts', onClick: () => setTab('contacts') },
          { v: late, l: 'Follow-ups late', tone: late ? 'warn' : '', onClick: () => setTab('acts') },
        ]} />
        <${KitTabs} tab=${tab} onTab=${setTab} tabs=${[
          ['timeline', 'History', rows.length],
          ['contacts', 'Contacts', myCons.length],
          ['deals', 'Opportunities', myDeals.length],
          ['acts', 'Follow-ups', myActs.filter(x => !x.done).length],
        ]} />
        ${
          tab === 'timeline' &&
          html`<div className="stack">
              ${tlErr && html`<${LoadError} error=${tlErr} onRetry=${load} title="Invoices and emails could not be loaded" />`}
              ${!tl && !tlErr && html`<p className="muted small">Looking up invoices, requirements and emails…</p>`}
              ${
                rows.length
                  ? html`<ol className="tl">
                      ${rows.slice(0, 200).map(
                        (r, i) => html`<li key=${i} className=${(r.bad || r.late ? 'bad ' : '') + 'tl-' + r.k}>
                            <span className="tli"><${Icon} n=${CRM_TL_ICON[r.k] || 'file'} /></span>
                            <div>
                              <b>${r.t}</b>
                              <div className="muted small">${r.sub}</div>
                              ${r.snippet && html`<div className="small tlsnip">${r.snippet}</div>`}
                            </div>
                            <time className="muted small nowrap">${r.at ? fmtTs(r.at) : ''}</time>
                          </li>`
                      )}
                    </ol>`
                  : tl && html`<${Empty} title="Nothing yet">Opportunities, follow-ups, contacts, invoices, requirements and emails with this company will show up here.<//>`
              }
            </div>`
        }
        ${
          tab === 'contacts' &&
          html`<section className="panel" style=${{ padding: '6px 8px' }}>
              ${
                myCons.length
                  ? html`<div className="tblwrap"><table className="tbl click"><thead><tr><th>Name</th><th>Title</th><th>Email</th><th>Phone</th><th>Relationship</th><th /></tr></thead><tbody>
                      ${myCons.map(
                        c => html`<tr key=${c.id} onClick=${() => openForm('crm/main/con', F.con, 'Contact', c)}>
                            <td><b style=${{ fontWeight: 600 }}>${c.n}</b></td><td className="small">${c.ti || '—'}</td><td className="small">${c.e || '—'}</td><td className="small">${c.ph ? html`<${CallLink} n=${c.ph} ref=${'crm:' + c.id} name=${c.n} />` : '—'}</td><td className="small">${c.rel || '—'}</td>
                            <td className="r" onClick=${e => e.stopPropagation()}>${c.e && html`<a className="btn ghost sm" href=${mymailHref(c.e)} onClick=${onClose}>Email</a>`}</td>
                          </tr>`
                      )}
                    </tbody></table></div>`
                  : html`<${Empty} title="No contacts yet" action=${html`<button type="button" className="btn" onClick=${() => openForm('crm/main/con', F.con, 'Contact', { acc: id })}>Add a contact</button>`} />`
              }
            </section>`
        }
        ${
          tab === 'deals' &&
          html`<section className="panel" style=${{ padding: '6px 8px' }}>
              ${
                myDeals.length
                  ? html`<div className="tblwrap"><table className="tbl click"><thead><tr><th>Opportunity</th><th>Stage</th><th className="r">Value</th><th>Expected close</th><th>Owner</th><th>Next step</th></tr></thead><tbody>
                      ${myDeals.map(
                        d => html`<tr key=${d.id} onClick=${() => openForm('crm/main/deal', F.deal, 'Opportunity', d)}>
                            <td><b style=${{ fontWeight: 600 }}>${d.t}</b></td><td><${Chip} s=${d.stage === 'won' ? 'ok' : d.stage === 'lost' ? 'red' : 'new'}>${crmStage(S, d.stage).n}<//></td><td className="r num">${d.v ? fmtMoney(+d.v, d.cur || 'USD') : '—'}</td><td className="small">${d.close ? fmtDate(d.close) : '—'}</td><td className="small">${kitName(P, d.own) || '—'}</td><td className="small">${d.stage === 'lost' ? d.why || '—' : d.next || '—'}</td>
                          </tr>`
                      )}
                    </tbody></table></div>`
                  : html`<${Empty} title="No opportunities yet" />`
              }
            </section>`
        }
        ${
          tab === 'acts' &&
          html`<section className="panel" style=${{ padding: '6px 8px' }}>
              ${
                myActs.length
                  ? html`<div className="tblwrap"><table className="tbl click"><thead><tr><th>Subject</th><th>Type</th><th>Due</th><th>Owner</th><th /></tr></thead><tbody>
                      ${myActs.map(
                        x => html`<tr key=${x.id} onClick=${() => openForm('crm/main/act', F.act, 'Follow-up', x)}>
                            <td><b style=${{ fontWeight: 600 }}>${x.t}</b></td><td className="small">${x.kind || '—'}</td><td className=${'small' + (!x.done && x.due && x.due < today ? ' late' : '')}>${x.due ? fmtDate(x.due) : '—'}</td><td className="small">${kitName(P, x.own) || '—'}</td>
                            <td className="r" onClick=${e => e.stopPropagation()}>${x.done ? html`<${Chip} s="ok">Done<//>` : html`<button type="button" className="btn go sm" onClick=${() => dbMerge(`crm/main/act/${x.id}`, { done: true, u: Date.now() })}>Mark done</button>`}</td>
                          </tr>`
                      )}
                    </tbody></table></div>`
                  : html`<${Empty} title="No follow-ups yet" />`
              }
            </section>`
        }
      </div>
      ${form && html`<${KitForm} title=${(form.init.id ? 'Edit ' : 'New ') + form.noun.toLowerCase()} fields=${form.fields} init=${form.init} refs=${refs} onSave=${saveForm} onClose=${() => setForm(null)} onDelete=${form.init.id ? delForm : null} />`}
    <//>`;
}
/* A list of short values with add and remove; Enter adds. */
function ListEditor({ items, onChange, placeholder }) {
  const [v, setV] = useState('');
  const add = () => {
    const t = v.trim();
    if (!t) return;
    if (!items.some(x => x.toLowerCase() === t.toLowerCase())) onChange([...items, t]);
    setV('');
  };
  return html`<div className="lsted">
      <div className="chips">
        ${items.map((x, i) => html`<span key=${x} className="chip pick">${x}<button type="button" aria-label=${'Remove ' + x} onClick=${() => onChange(items.filter((_, j) => j !== i))}>×</button></span>`)}
        ${!items.length && html`<span className="muted small">Nothing yet.</span>`}
      </div>
      <div className="actions" style=${{ flexWrap: 'nowrap' }}>
        <input value=${v} placeholder=${placeholder || 'Add one'} onInput=${e => setV(e.target.value)} onKeyDown=${e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
        }} />
        <button type="button" className="btn ghost sm" onClick=${add}>Add</button>
      </div>
    </div>`;
}
/* The lists behind every drop-down in the CRM, plus the pipeline stages and their win probability. */
function CRMSettings({ S }) {
  const toast = useToast();
  const [f, setF] = useState(() => JSON.parse(JSON.stringify(S)));
  const [X, setX] = useState(() => JSON.parse(JSON.stringify(crmExtra(S))));
  const [busy, setBusy] = useState(false);
  const [newStage, setNewStage] = useState('');
  const stages = f.stages;
  const setStages = s => setF({ ...f, stages: s });
  const upStage = (i, patch) => setStages(stages.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const moveStage = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= stages.length) return;
    const s = [...stages];
    [s[i], s[j]] = [s[j], s[i]];
    setStages(s);
  };
  const addStage = () => {
    const n = newStage.trim();
    if (!n) return;
    if (stages.some(x => x.n.trim().toLowerCase() === n.toLowerCase())) {
      toast('There is a stage with that name already.', true);
      return;
    }
    let k = crmSlug(n);
    while (stages.some(x => x.k === k)) k += '-2';
    // new stages go before Won and Lost
    const i = stages.findIndex(x => x.k === 'won' || x.k === 'lost');
    const s = [...stages];
    s.splice(i < 0 ? s.length : i, 0, { k, n, p: 50 });
    setStages(s);
    setNewStage('');
  };
  const save = async () => {
    const bad = stages.find(x => !x.n.trim());
    if (bad) {
      toast('Every stage needs a name.', true);
      return;
    }
    setBusy(true);
    try {
      const out = {};
      Object.keys(CRM_DEFAULTS).forEach(k => {
        out[k] = k === 'stages' ? stages.map(x => ({ k: x.k, n: x.n.trim(), p: Math.max(0, Math.min(100, Math.round(+x.p || 0))) })) : f[k];
      });
      ['leadRules', 'flows', 'assign', 'custom'].forEach(k => {
        out[k] = X[k];
      });
      await dbMerge('crm/main/x/settings', { ...out, u: Date.now() });
      toast('CRM settings saved.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const reset = () => {
    if (!confirm('Put every list back to the built-in defaults? Nothing is saved until you press Save.')) return;
    setF(JSON.parse(JSON.stringify(crmSettings({}))));
  };
  return html`<div className="stack">
      <section className="panel stack">
        <div>
          <h2 className="ph">Pipeline stages</h2>
          <p className="muted small" style=${{ margin: 0 }}>The columns on the board, in order. The probability is how likely a deal in that stage is to be won; the weighted pipeline multiplies each open deal by it. Won and Lost always stay.</p>
        </div>
        <div className="tblwrap">
          <table className="tbl">
            <thead><tr><th style=${{ width: 70 }}>Order</th><th>Stage</th><th style=${{ width: 140 }}>Win probability</th><th /></tr></thead>
            <tbody>
              ${stages.map(
                (x, i) => html`<tr key=${x.k}>
                    <td className="nowrap"><button type="button" className="btn ghost sm icon" aria-label="Move up" disabled=${i === 0} onClick=${() => moveStage(i, -1)}><${Icon} n="up" /></button><button type="button" className="btn ghost sm icon" aria-label="Move down" disabled=${i === stages.length - 1} onClick=${() => moveStage(i, 1)}><${Icon} n="down" /></button></td>
                    <td><input value=${x.n} onInput=${e => upStage(i, { n: e.target.value })} aria-label="Stage name" /></td>
                    <td>${x.k === 'won' || x.k === 'lost' ? html`<span className="muted small">${x.k === 'won' ? '100%' : '0%'}</span>` : html`<span className="actions" style=${{ flexWrap: 'nowrap' }}><input type="number" min="0" max="100" value=${x.p} style=${{ width: 80 }} onInput=${e => upStage(i, { p: e.target.value })} aria-label="Win probability" />%</span>`}</td>
                    <td className="r">${x.k !== 'won' && x.k !== 'lost' && html`<button type="button" className="btn ghost sm" onClick=${() => setStages(stages.filter((_, j) => j !== i))}>Remove</button>`}</td>
                  </tr>`
              )}
            </tbody>
          </table>
        </div>
        <div className="actions" style=${{ flexWrap: 'nowrap', maxWidth: 420 }}>
          <input value=${newStage} placeholder="New stage, e.g. Rate card sent" onInput=${e => setNewStage(e.target.value)} onKeyDown=${e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addStage();
            }
          }} />
          <button type="button" className="btn ghost sm" onClick=${addStage}>Add stage</button>
        </div>
        <p className="muted small" style=${{ margin: 0 }}>Removing a stage does not touch existing opportunities; they keep their old stage until moved.</p>
      </section>
      <div className="g2">
        ${Object.keys(CRM_LIST_NAMES).map(
          k => html`<section key=${k} className="panel stack" style=${{ gap: 8 }}>
              <div>
                <b>${CRM_LIST_NAMES[k][0]}</b>
                ${CRM_LIST_NAMES[k][1] && html`<div className="muted small">${CRM_LIST_NAMES[k][1]}</div>`}
              </div>
              <${ListEditor} items=${f[k]} onChange=${v => setF({ ...f, [k]: v })} />
            </section>`
        )}
      </div>
      <${CRMAutomationSettings} X=${X} setX=${setX} S=${f} />
      <div className="actions">
        <button type="button" className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save settings'}</button>
        <button type="button" className="btn ghost" onClick=${reset}>Back to defaults</button>
      </div>
    </div>`;
}
function CRMPage() {
  const P = usePortal();
  const [tab, setTab] = useState('pipeline');
  const [view, setView] = useState(null);
  const [imp, setImp] = useState(false);
  const sdoc = useDoc('crm/main/x/settings');
  const S = useMemo(() => crmSettings(sdoc.data), [sdoc.data]);
  const F = useMemo(() => crmFields(S), [S]);
  const acc = useCol('crm/main/acc', 'n:asc');
  const con = useCol('crm/main/con', 'n:asc');
  const deals = useCol('crm/main/deal', 'u:desc');
  const acts = useCol('crm/main/act', 'due:asc');
  const leadsCol = useCol('crm/main/lead', 'u:desc');
  const dupes = useMemo(() => crmDupes(acc.docs, con.docs), [acc.docs, con.docs]);
  const refs = {
    acc: acc.docs.map(a => [a.id, a.n || 'Unnamed']),
    deal: deals.docs.map(d => [d.id, d.t || 'Untitled']),
    con: con.docs.map(c => [c.id, (c.n || c.e || 'Unnamed') + (c.acc ? ' · ' + (refName(acc.docs.map(a => [a.id, a.n]), c.acc) || '') : '')]),
  };
  const today = dkey();
  const open = deals.docs.filter(crmOpen);
  const usd = list => list.filter(d => (d.cur || 'USD') === 'USD').reduce((a, d) => a + (+d.v || 0), 0);
  const weighted = open.filter(d => (d.cur || 'USD') === 'USD').reduce((a, d) => a + ((+d.v || 0) * crmStage(S, d.stage).p) / 100, 0);
  const month = today.slice(0, 7);
  const wonM = deals.docs.filter(d => d.stage === 'won' && d.closedAt && dkey(new Date(d.closedAt)).slice(0, 7) === month);
  const due = acts.docs.filter(a => !a.done && a.due && a.due <= today);
  const closed = deals.docs.filter(d => ['won', 'lost'].includes(d.stage));
  const winRate = closed.length ? Math.round((closed.filter(d => d.stage === 'won').length / closed.length) * 100) + '%' : '—';
  const lostWhy = {};
  deals.docs.filter(d => d.stage === 'lost' && d.why).forEach(d => {
    lostWhy[d.why] = (lostWhy[d.why] || 0) + 1;
  });
  const topLost = Object.entries(lostWhy).sort((a, b) => b[1] - a[1])[0];
  const importBtn = html`<button type="button" className="btn ghost" onClick=${() => setImp(true)}><${Icon} n="down" />Import</button>`;
  if (sdoc.loading) return html`<${Spinner} onRetry=${() => Sync.kick(0)} />`;
  return html`<div className="stack">
      <${KitStats} items=${[
        { v: fmtMoney(usd(open), 'USD'), l: `Open pipeline (USD), ${open.length} deal${open.length === 1 ? '' : 's'}`, onClick: () => setTab('pipeline') },
        { v: fmtMoney(Math.round(weighted), 'USD'), l: 'Weighted by stage (USD)' },
        { v: fmtMoney(usd(wonM), 'USD'), l: `Won this month, ${wonM.length} deal${wonM.length === 1 ? '' : 's'}`, tone: 'ok' },
        { v: winRate, l: topLost ? `Win rate · lost mostly: ${topLost[0]}` : 'Win rate (closed deals)' },
        { v: due.length, l: 'Follow-ups due today or late', tone: due.length ? 'warn' : '', onClick: () => setTab('acts') },
      ]} />
      <${KitTabs} tab=${tab} onTab=${setTab} wrap tabs=${[
        ['leads', 'Leads', leadsCol.docs.filter(l => !['Converted', 'Unqualified'].includes(l.st || 'New')).length],
        ['pipeline', 'Pipeline'],
        ['acc', 'Companies', acc.docs.length],
        ['con', 'Contacts', con.docs.length],
        ['acts', 'Follow-ups', due.length],
        ['reports', 'Reports'],
        ['settings', 'Settings'],
      ]} />
      ${dupes.length > 0 && tab !== 'settings' && html`<div className="note amber"><span><b>Possible duplicates:</b> ${dupes.slice(0, 5).map(d => `${d.kind} ${d.n} (${d.ids.length}×)`).join('; ')}${dupes.length > 5 ? ` and ${dupes.length - 5} more` : ''}. Keep one and delete the rest, or merge their notes by hand.</span></div>`}
      ${tab === 'leads' && html`<${LeadsTab} S=${S} X=${crmExtra(S)} refs=${refs} accs=${acc.docs} cons=${con.docs} onConverted=${() => setTab('pipeline')} />`}
      ${
        tab === 'pipeline' &&
        html`<${KitList} col="crm/main/deal" fields=${F.deal} cols=${['t', 'acc', 'stage', 'v', 'close', 'own']} title="Opportunities" noun="Opportunity"
            refs=${refs} defaults=${{ stage: S.stages[0].k, cur: S.curs[0], own: P.uid }}
            onSaved=${(out, prev) => applyFlows(S, 'deal', { ...(prev || {}), ...out }, prev ? prev.stage || 'lead' : '', P)}
            board=${(list, open) => html`<${CRMBoard} deals=${list} refs=${refs} S=${S} accs=${acc.docs} onOpen=${open} />`} />`
      }
      ${tab === 'reports' && html`<${CRMReports} S=${S} deals=${deals.docs} acts=${acts.docs} accs=${acc.docs} leads=${leadsCol.docs} />`}
      ${
        tab === 'acc' &&
        html`<${KitList} col="crm/main/acc" fields=${F.acc} cols=${['n', 'ty', 'st', 'own', 'ind', 'loc', 'msa']} title="Companies" noun="Company" refs=${refs} sort="n:asc"
            defaults=${{ st: S.statuses[0], own: P.uid }} empty="No companies yet" extraTools=${importBtn} onOpen=${r => setView(r.id)} />`
      }
      ${
        tab === 'con' &&
        html`<${KitList} col="crm/main/con" fields=${F.con} cols=${['n', 'acc', 'ti', 'e', 'ph', 'rel']} title="Contacts" noun="Contact" refs=${refs} sort="n:asc" extraTools=${importBtn}
            rowTools=${r => (r.e ? html`<a className="btn ghost sm" href=${mymailHref(r.e)}>Email</a>` : null)} />`
      }
      ${
        tab === 'acts' &&
        html`<${KitList} col="crm/main/act" fields=${F.act} cols=${['t', 'kind', 'due', 'acc', 'own', 'done']} title="Follow-ups" noun="Follow-up" refs=${refs} sort="due:asc"
            defaults=${{ kind: S.acts[0], due: today, own: P.uid }}
            rowTools=${r =>
              r.done
                ? null
                : html`<button type="button" className="btn go sm" onClick=${() => dbMerge(`crm/main/act/${r.id}`, { done: true, u: Date.now() })}>Mark done</button>`} />`
      }
      ${tab === 'settings' && html`<${CRMSettings} key=${sdoc.data ? sdoc.data.u || 1 : 0} S=${S} />`}
      ${view && html`<${CompanyView} id=${view} S=${S} F=${F} refs=${refs} accs=${acc.docs} cons=${con.docs} deals=${deals.docs} acts=${acts.docs} onClose=${() => setView(null)} />`}
      ${imp && html`<${CRMImport} onClose=${() => setImp(false)} />`}
    </div>`;
}
