/* ================= v49 Supplier qualification (CC-04) (in js/work.js, fetched when opened) =================
   StratEdge's supplier profile (approved before clients see it), its document library (versions, expiry, draft or
   executed agreements) and one packet per client company: what the company asked for, what was supplied, their review
   and their decision. Client portal: Supplier documents. Staff: Supplier profile & documents. Server: api/corpq.php. */
const CQ_ITONE = { requested: '', supplied: 'info', returned: 'red', approved: 'ok', waived: '' };
const CQ_PTONE = { open: 'info', qualified: 'ok', not: 'red', closed: '' };
const CQ_EXC = { expired: ['Expired', 'red'], returned: ['Returned', 'red'], overdue: ['Overdue', 'amber'], review: ['Waiting for review over a week', 'amber'] };
const cqFileHref = id => 'api/index.php?r=cq_file&id=' + encodeURIComponent(id);
const cqLines = a => (a || []).join('\n');
const cqSplit = t => String(t || '').split('\n').map(x => x.trim()).filter(Boolean);
function useCqHome(cid) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    api('cq_home', cid ? { cid } : {}).then(setD, setErr);
  }, [cid, tick]);
  return [d, err, () => setTick(t => t + 1)];
}

/* The approved supplier profile, as a client company reads it */
function CqProfileView({ prof, staffPreview }) {
  if (!prof) return html`<${Empty} title="No supplier profile yet">${staffPreview ? 'Write the profile and have an administrator approve it; clients then see it here.' : 'StratEdge has not published its supplier profile yet.'}<//>`;
  const d = prof.data;
  const list = (t, a) => (a && a.length ? html`<section><h3>${t}</h3><ul>${a.map((x, i) => html`<li key=${i}>${x}</li>`)}</ul></section>` : null);
  return html`<div className="crdoc cqprof">
      <div className="crdochead"><div><h2>${d.legal}</h2><div className="muted">${[d.dba && 'Doing business as ' + d.dba, d.founded && 'Founded ' + d.founded, d.hq].filter(Boolean).join(' · ')}</div></div><div className="small r">${d.web ? html`<div>${d.web}</div>` : ''}Approved profile, version ${prof.n}${prof.apvAt ? html`<div className="muted">${crDay(new Date(prof.apvAt).toISOString().slice(0, 10))}</div>` : ''}</div></div>
      ${d.about && html`<p className="crpre crintro">${d.about}</p>`}
      ${list('Services', d.services)}${list('Skill areas', d.skills)}${list('Locations', d.locs)}
      ${d.ids && html`<section><h3>Registrations and identifiers</h3><p className="crpre">${d.ids}</p></section>`}
      ${(d.owners || []).length > 0 && html`<section><h3>Your contacts at StratEdge</h3><div className="tblwrap"><table className="tbl small"><tbody>${d.owners.map((o, i) => html`<tr key=${i}><td><b>${o.n}</b><div className="muted">${o.role}</div></td><td>${o.e}</td><td className="nw">${o.ph}</td></tr>`)}</tbody></table></div></section>`}
      ${(d.certs || []).length > 0 && html`<section><h3>Certifications</h3><div className="tblwrap"><table className="tbl small"><tbody>${d.certs.map((c, i) => html`<tr key=${i}><td><b>${c.n}</b>${c.by ? html`<div className="muted">${c.by}</div>` : ''}</td><td>${c.num}</td><td className="nw">${c.exp ? 'valid until ' + crDay(c.exp) : ''}</td></tr>`)}</tbody></table></div><p className="muted small" style=${{ margin: 0 }}>Each is backed by current evidence StratEdge holds; ask for the document through your packet.</p></section>`}
      ${(d.refs || []).length > 0 && html`<section><h3>Customer references</h3><ul>${d.refs.map((r, i) => html`<li key=${i}><b>${r.co}</b>${r.who ? ' · ' + r.who : ''}${r.what ? html`<div className="small">${r.what}</div>` : ''}</li>`)}</ul></section>`}
      ${d.ins && html`<section><h3>Insurance</h3><p className="crpre">${d.ins}</p></section>`}
    </div>`;
}

/* The items of a packet, with the actions the caller may take */
function CqItems({ pkt, home, staff, onDone, docs }) {
  const toast = useToast();
  const [act, setAct] = useState(null);
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  const run = async (route, body, msg) => {
    setBusy(true);
    try {
      await api(route, body);
      toast(msg);
      setAct(null);
      setF({});
      onDone();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const open = pkt.st === 'open';
  return html`<div className="tblwrap"><table className="tbl cqitems"><thead><tr><th>What</th><th>Status</th><th>Document</th><th>Due</th>${open && html`<th></th>`}</tr></thead><tbody>${pkt.items.map(
    it => html`<${Fragment} key=${it.id}><tr className=${it.exc ? 'cqexc' : ''}>
        <td><b>${it.ti}</b>${it.note ? html`<div className="muted small">${it.note}</div>` : ''}<div className="muted small">${it.side === 'client' ? 'Asked for by ' + pkt.co : 'Added by StratEdge'}${staff && it.respN ? ' · ' + it.respN : ''}</div></td>
        <td><${Chip} s=${CQ_ITONE[it.st]}>${home.ist[it.st] || it.st}<//>${it.exc && html` <${Chip} s=${CQ_EXC[it.exc][1]}>${CQ_EXC[it.exc][0]}<//>`}${it.rev && it.rev.note ? html`<div className="small">${it.rev.d === 'return' ? 'Returned' : it.rev.d === 'approve' ? 'Approved' : 'Not needed'} by ${it.rev.n}: ${it.rev.note}</div>` : it.rev && it.rev.n ? html`<div className="small muted">${it.rev.d === 'approve' ? 'Approved' : it.rev.d === 'return' ? 'Returned' : 'Marked not needed'} by ${it.rev.n}</div>` : ''}</td>
        <td>${it.doc ? html`<a href=${cqFileHref(it.doc.id)}>${it.doc.ti}</a><div className="muted small">version ${it.doc.n}${home.agree.includes(it.kind) || it.doc.ast ? ' · ' + (it.doc.ast === 'executed' ? 'executed' : 'draft agreement') : ''}${it.doc.exp ? ' · valid until ' + crDay(it.doc.exp) : ''}</div>` : html`<span className="muted">—</span>`}</td>
        <td className="nw">${it.due ? crDay(it.due) : '—'}</td>
        ${
          open &&
          html`<td className="r"><div className="actions" style=${{ justifyContent: 'flex-end' }}>
            ${staff && ['requested', 'returned', 'supplied'].includes(it.st) && html`<button type="button" className="btn ghost sm" onClick=${() => (setAct({ id: it.id, a: 'supply' }), setF({}))}>Supply…</button>`}
            ${!staff && !home.ro && it.st === 'supplied' && html`<button type="button" className="btn sm" disabled=${busy} onClick=${() => run('cq_item_act', { id: it.id, act: 'approve' }, 'Approved.')}>Approve</button><button type="button" className="btn ghost sm" onClick=${() => (setAct({ id: it.id, a: 'return' }), setF({}))}>Return…</button>`}
            ${['requested', 'returned', 'supplied'].includes(it.st) && (staff ? it.side !== 'client' : it.side === 'client' && !home.ro) && html`<button type="button" className="btn ghost sm" onClick=${() => (setAct({ id: it.id, a: 'waive' }), setF({}))}>Not needed</button>`}
          </div></td>`
        }
      </tr>
      ${
        act &&
        act.id === it.id &&
        html`<tr><td colSpan=${open ? 5 : 4}><div className="crform2 form">
          ${
            act.a === 'supply'
              ? html`<b>Supply "${it.ti}"</b><${Field} label="From the document library"><select value=${f.doc || ''} onChange=${e => setF({ ...f, doc: e.target.value })}><option value="">Choose…</option>${(docs || []).filter(dd => dd.cur && !dd.expired && (it.kind === 'other' || ['ref', 'pol', 'cert'].includes(it.kind) || dd.kind === it.kind)).map(dd => html`<option key=${dd.id} value=${dd.id}>${dd.ti} (version ${dd.n}${dd.ast ? ', ' + dd.ast : ''}${dd.exp ? ', valid until ' + dd.exp : ''})</option>`)}</select><//><p className="small muted" style=${{ margin: 0 }}>Only current documents that have not expired are offered. Add a new one under Documents first if it is missing.</p>`
              : html`<b>${act.a === 'return' ? 'Return "' + it.ti + '"' : '"' + it.ti + '" is not needed'}</b>`
          }
          <${Field} label=${act.a === 'return' ? 'What needs to change' : 'A note (optional)'}><textarea rows="2" value=${f.msg || ''} onInput=${e => setF({ ...f, msg: e.target.value })} /><//>
          <div className="actions"><button type="button" className="btn ghost sm" onClick=${() => setAct(null)}>Cancel</button><button type="button" className="btn sm" disabled=${busy || (act.a === 'supply' && !f.doc)} onClick=${() => run('cq_item_act', { id: it.id, act: act.a, doc: f.doc || '', msg: f.msg || '' }, { supply: 'Supplied. ' + pkt.co + ' is asked to review it.', return: 'Returned.', waive: 'Marked not needed.' }[act.a])}>${{ supply: 'Supply it', return: 'Return it', waive: 'Not needed' }[act.a]}</button></div>
        </div></td></tr>`
      }
    <//>`
  )}</tbody></table></div>`;
}

/* A packet's head: status, progress, exceptions, the decision */
function CqPktHead({ pkt, home }) {
  const m = pkt.m;
  const ok = (m.by.approved || 0) + (m.by.waived || 0);
  return html`<div className="cqhead">
      <${Chip} s=${CQ_PTONE[pkt.st]}>${home.pst[pkt.st] || pkt.st}<//>
      <span className="small">${ok} of ${m.items} done${m.by.supplied ? ' · ' + m.by.supplied + ' waiting for review' : ''}${m.by.requested ? ' · ' + m.by.requested + ' to supply' : ''}${pkt.due ? ' · due ' + crDay(pkt.due) : ''}</span>
      ${Object.entries(m.exc || {}).map(([k, n]) => html`<${Chip} key=${k} s=${CQ_EXC[k][1]}>${n} ${CQ_EXC[k][0].toLowerCase()}<//>`)}
      ${pkt.dec && pkt.dec.d && html`<span className="small crright">${pkt.dec.d === 'qualified' ? 'Qualified' : 'Not qualified'} by <b>${pkt.dec.n}</b>, ${fmtTs(pkt.dec.at)}${pkt.dec.rec ? ' (recorded by ' + pkt.dec.rec + ')' : ''}</span>`}
    </div>`;
}

/* ---------- the client portal: Supplier documents ---------- */
function CqClientPage() {
  const P = usePortal();
  const toast = useToast();
  const [home, err, reload] = useCqHome(P.cid);
  const [f, setF] = useState({ kind: '' });
  const [busy, setBusy] = useState(false);
  const [dec, setDec] = useState(null);
  const [evs, setEvs] = useState(null);
  useEffect(() => {
    if (home && home.pkt) api('cq_pkt_get', { cid: home.cid }).then(r => setEvs(r.evs), () => {});
  }, [home]);
  if (err && !home) return html`<${LoadError} error=${err} onRetry=${reload} />`;
  if (!home) return html`<${Spinner} label="Loading supplier documents…" />`;
  const run = async (route, body, msg) => {
    setBusy(true);
    try {
      await api(route, body);
      toast(msg);
      setF({ kind: '' });
      setDec(null);
      reload();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const pkt = home.pkt;
  return html`<div className="stack crpage cqpage">
      <div className="muted small">StratEdge's approved supplier profile, and the documents ${home.co} asked for to qualify StratEdge as a supplier: what was supplied, your review and your decision. Supplying a document does not qualify StratEdge by itself: your decision is recorded below.</div>
      ${
        pkt
          ? html`<section className="panel stack">
              <div className="ph-row"><h2 className="ph">What ${home.co} asked for</h2></div>
              <${CqPktHead} pkt=${pkt} home=${home} />
              ${pkt.items.length ? html`<${CqItems} pkt=${pkt} home=${home} staff=${false} onDone=${reload} />` : html`<p className="muted small">Nothing requested yet.</p>`}
              ${home.ro && html`<p className="muted small" style=${{ margin: 0 }}>Your role at ${home.co} reads supplier documents; asking for documents, reviewing them and the decision are for procurement and full-access people.</p>`}
              ${
                pkt.st === 'open' && !home.ro &&
                html`<details className="crcmp"><summary>Ask for a document</summary><div className="form stack" style=${{ marginTop: 8 }}>
                  <div className="row3"><${Field} label="Which"><select value=${f.kind} onChange=${e => setF({ ...f, kind: e.target.value })}><option value="">Choose…</option>${Object.entries(home.kinds).map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select><//><${Field} label="Title (optional)"><input value=${f.ti || ''} onInput=${e => setF({ ...f, ti: e.target.value })} /><//><${Field} label="Needed by"><input type="date" value=${f.due || ''} onInput=${e => setF({ ...f, due: e.target.value })} /><//></div>
                  <${Field} label="Details (optional)"><textarea rows="2" value=${f.note || ''} onInput=${e => setF({ ...f, note: e.target.value })} placeholder="e.g. the certificate must name us as additional insured" /><//>
                  <div><button type="button" className="btn sm" disabled=${busy || !f.kind} onClick=${() => run('cq_item_add', { cid: home.cid, kind: f.kind, ti: f.ti || '', note: f.note || '', due: f.due || '' }, 'Requested. StratEdge is told.')}>Ask for it</button></div>
                </div></details>`
              }
              ${
                pkt.st === 'open' && !home.ro &&
                html`<div className="cqdecide">${
                  dec
                    ? html`<div className="crform2 form"><b>${dec === 'qualified' ? 'Record: StratEdge is qualified' : 'Record: StratEdge is not qualified'}</b><${Field} label=${dec === 'not' ? 'Why' : 'A note (optional)'}><textarea rows="2" value=${f.msg || ''} onInput=${e => setF({ ...f, msg: e.target.value })} /><//><div className="actions"><button type="button" className="btn ghost sm" onClick=${() => setDec(null)}>Cancel</button><button type="button" className="btn sm" disabled=${busy} onClick=${() => run('cq_decide', { cid: home.cid, d: dec, msg: f.msg || '' }, 'Your decision is recorded.')}>Record it</button></div></div>`
                    : html`<div className="actions"><span className="small">Your decision:</span><button type="button" className="btn sm" onClick=${() => setDec('qualified')}><${Icon} n="check" />Qualified</button><button type="button" className="btn ghost sm" onClick=${() => setDec('not')}>Not qualified…</button></div>`
                }</div>`
              }
              ${evs && evs.length > 0 && html`<details className="crcmp"><summary>History (${evs.length})</summary><div className="crlog">${evs.map((e, i) => html`<div key=${i} className=${'crev ' + e.side}><div className="small"><b>${e.byn || 'StratEdge'}</b> <span className="muted">${fmtTs(e.at)}</span></div><div className="crmsg">${e.msg}</div></div>`)}</div></details>`}
            </section>`
          : html`<div className="note"><span>Nothing was requested yet. When ${home.co} needs documents to qualify StratEdge (a W-9, insurance, agreements, a security questionnaire), StratEdge opens a list here and you can ask for more.</span></div>`
      }
      <section className="stack"><div className="ph-row"><h2 className="ph">StratEdge as a supplier</h2></div><${CqProfileView} prof=${home.prof} /></section>
    </div>`;
}

/* ---------- StratEdge: Supplier profile & documents ---------- */
function CqStaffPage({ q }) {
  const [home, err, reload] = useCqHome('');
  const [tab, setTab] = useState((q && q.t) || 'pkts');
  const [open, setOpen] = useState((q && q.c) || '');
  if (err && !home) return html`<${LoadError} error=${err} onRetry=${reload} />`;
  if (!home) return html`<${Spinner} label="Loading supplier documents…" />`;
  const exc = home.pkts.reduce((n, p) => n + Object.values(p.m.exc || {}).reduce((a, b) => a + b, 0), 0);
  return html`<div className="stack crpage cqpage">
      <${KitTabs} tabs=${[['pkts', 'Client packets', exc || null], ['docs', 'Documents', home.docs.filter(d => d.cur && d.expired).length || null], ['prof', 'Supplier profile']]} tab=${tab} onTab=${setTab} />
      ${tab === 'pkts' && html`<${CqPackets} home=${home} reload=${reload} onOpen=${setOpen} />`}
      ${tab === 'docs' && html`<${CqDocs} home=${home} reload=${reload} />`}
      ${tab === 'prof' && html`<${CqProfEditor} home=${home} reload=${reload} />`}
      ${open && html`<${CqPktModal} cid=${open} home=${home} onClose=${() => setOpen('')} onChanged=${reload} />`}
    </div>`;
}
function CqPackets({ home, reload, onOpen }) {
  const toast = useToast();
  const [nw, setNw] = useState(null);
  const [busy, setBusy] = useState(false);
  const have = home.pkts.map(p => p.cid);
  const create = async () => {
    setBusy(true);
    try {
      await api('cq_pkt_open', { cid: nw.cid, due: nw.due || '', items: nw.items, owner: nw.owner || '' });
      toast('Packet opened.');
      const cid = nw.cid;
      setNw(null);
      reload();
      onOpen(cid);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<div className="stack">
      <div className="toolbar"><span className="muted small">One packet for each client company: what they ask for to qualify StratEdge as a supplier.</span><button className="btn push" onClick=${() => setNw({ cid: '', items: [...home.starter], due: '' })}><${Icon} n="plus" />Open a packet</button></div>
      ${
        home.pkts.length
          ? html`<div className="tblwrap"><table className="tbl crtbl"><thead><tr><th>Company</th><th>Status</th><th>Progress</th><th>Exceptions</th><th className="r">Days</th></tr></thead><tbody>${home.pkts.map(
              p => html`<tr key=${p.id} className="click" tabIndex="0" onClick=${() => onOpen(p.cid)} onKeyDown=${e => e.key === 'Enter' && onOpen(p.cid)}><td><b>${p.co}</b>${p.ownerN ? html`<div className="muted small">${p.ownerN}</div>` : ''}</td><td><${Chip} s=${CQ_PTONE[p.st]}>${home.pst[p.st]}<//></td><td className="small">${(p.m.by.approved || 0) + (p.m.by.waived || 0)} of ${p.m.items} done${p.m.by.supplied ? ' · ' + p.m.by.supplied + ' in review' : ''}</td><td>${Object.entries(p.m.exc || {}).map(([k, n]) => html`<${Chip} key=${k} s=${CQ_EXC[k][1]}>${n} ${CQ_EXC[k][0].toLowerCase()}<//>`)}</td><td className="r">${p.m.days}${p.m.complete ? html`<div className="muted small">complete</div>` : ''}</td></tr>`
            )}</tbody></table></div>`
          : html`<${Empty} title="No packets yet">Open one when a client company starts qualifying StratEdge as a supplier.<//>`
      }
      ${
        nw &&
        html`<${Modal} title="Open a supplier packet" onClose=${() => setNw(null)} foot=${html`<button className="btn ghost" onClick=${() => setNw(null)}>Cancel</button><button className="btn" disabled=${busy || !nw.cid} onClick=${create}>Open it</button>`}>
          <div className="stack form">
            <${Field} label="Client company"><select value=${nw.cid} onChange=${e => setNw({ ...nw, cid: e.target.value })}><option value="">Choose…</option>${home.cos.filter(c => !have.includes(c.id)).map(c => html`<option key=${c.id} value=${c.id}>${c.n}</option>`)}</select><//>
            <span className="lbl">What they usually ask for (untick what they do not need)</span>
            <div className="crpick">${Object.entries(home.kinds).map(([k, n]) => html`<label key=${k} className="check"><input type="checkbox" checked=${nw.items.includes(k)} onChange=${e => setNw({ ...nw, items: e.target.checked ? [...nw.items, k] : nw.items.filter(x => x !== k) })} /><span>${n}</span></label>`)}</div>
            <div className="row2"><${Field} label="Due"><input type="date" value=${nw.due} onInput=${e => setNw({ ...nw, due: e.target.value })} /><//><${Field} label="Responsible at StratEdge"><select value=${nw.owner || ''} onChange=${e => setNw({ ...nw, owner: e.target.value })}><option value="">Me</option>${home.team.map(t => html`<option key=${t.id} value=${t.id}>${t.n}</option>`)}</select><//></div>
          </div>
        <//>`
      }
    </div>`;
}
function CqPktModal({ cid, home, onClose, onChanged }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [f, setF] = useState({ kind: '' });
  const [rec, setRec] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api('cq_pkt_get', { cid }).then(setD, e => (toast(errText(e), true), onClose()));
  useEffect(() => {
    load();
  }, [cid]);
  if (!d) return html`<${Modal} wide title="Supplier packet" onClose=${onClose}><${Spinner} /><//>`;
  const pkt = d.pkt;
  const run = async (route, body, msg) => {
    setBusy(true);
    try {
      await api(route, body);
      toast(msg);
      setF({ kind: '' });
      setRec(null);
      load();
      onChanged();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<${Modal} wide title=${'Supplier packet: ' + pkt.co} onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Close</button>${pkt.st !== 'open' && html`<button className="btn ghost" disabled=${busy} onClick=${() => run('cq_reopen', { cid }, 'Reopened.')}>Reopen</button>`}`}>
      <div className="stack">
        <${CqPktHead} pkt=${pkt} home=${home} />
        <${CqItems} pkt=${pkt} home=${home} staff=${true} docs=${home.docs} onDone=${() => (load(), onChanged())} />
        ${
          pkt.st === 'open' &&
          html`<details className="crcmp"><summary>Add an item</summary><div className="form stack" style=${{ marginTop: 8 }}>
            <div className="row3"><${Field} label="Which"><select value=${f.kind} onChange=${e => setF({ ...f, kind: e.target.value })}><option value="">Choose…</option>${Object.entries(home.kinds).map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select><//><${Field} label="Title (optional)"><input value=${f.ti || ''} onInput=${e => setF({ ...f, ti: e.target.value })} /><//><${Field} label="Due"><input type="date" value=${f.due || ''} onInput=${e => setF({ ...f, due: e.target.value })} /><//></div>
            <div><button type="button" className="btn sm" disabled=${busy || !f.kind} onClick=${() => run('cq_item_add', { cid, kind: f.kind, ti: f.ti || '', due: f.due || '', note: f.note || '' }, 'Added.')}>Add</button></div>
          </div></details>`
        }
        <details className="crcmp"><summary>Who at ${pkt.co} is told</summary><div className="crpick" style=${{ marginTop: 8 }}>${(d.contacts || []).length ? d.contacts.map(c => html`<label key=${c.id} className="check"><input type="checkbox" checked=${(pkt.to || []).includes(c.id)} onChange=${e => run('cq_pkt_set', { cid, to: e.target.checked ? [...(pkt.to || []), c.id] : (pkt.to || []).filter(x => x !== c.id) }, 'Saved.')} /><span>${c.n} <span className="muted small">${c.e}</span></span></label>`) : html`<p className="muted small">No contacts with a portal login yet.</p>`}</div><p className="muted small">With nobody ticked, every contact of ${pkt.co} is told.</p></details>
        ${
          pkt.st === 'open' &&
          html`<div>${
            rec
              ? html`<div className="crform2 form"><b>Record ${pkt.co}'s decision (given by email, on a call…)</b><div className="seg">${[['qualified', 'Qualified'], ['not', 'Not qualified']].map(([k, n]) => html`<button key=${k} type="button" className=${rec === k ? 'on' : ''} onClick=${() => setRec(k)}>${n}</button>`)}</div><${Field} label="Who decided at the company"><input value=${f.who || ''} onInput=${e => setF({ ...f, who: e.target.value })} /><//><${Field} label="The evidence"><textarea rows="2" value=${f.msg || ''} onInput=${e => setF({ ...f, msg: e.target.value })} /><//><div className="actions"><button type="button" className="btn ghost sm" onClick=${() => setRec(null)}>Cancel</button><button type="button" className="btn sm" disabled=${busy} onClick=${() => run('cq_decide', { cid, d: rec, who: f.who || '', msg: f.msg || '' }, 'Decision recorded.')}>Record it</button></div></div>`
              : html`<button type="button" className="btn ghost sm" onClick=${() => setRec('qualified')}>Record the company's decision…</button>`
          }</div>`
        }
        ${d.evs.length > 0 && html`<details className="crcmp"><summary>History (${d.evs.length})</summary><div className="crlog">${d.evs.map((e, i) => html`<div key=${i} className=${'crev ' + e.side}><div className="small"><b>${e.byn || 'StratEdge'}</b> <span className="muted">${fmtTs(e.at)}</span></div><div className="crmsg">${e.msg}</div></div>`)}</div></details>`}
      </div>
    <//>`;
}
function CqDocs({ home, reload }) {
  const toast = useToast();
  const [nw, setNw] = useState(null);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(0);
  const fams = {};
  home.docs.forEach(d => (fams[d.fam] = fams[d.fam] || []).push(d));
  const save = async () => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('data', JSON.stringify({ fam: nw.fam || '', kind: nw.kind, ti: nw.ti, exp: nw.exp || '', ast: nw.ast || 'draft', note: nw.note || '' }));
      fd.append('file', nw.file);
      await upload('cq_doc_save', fd, setProg);
      toast(nw.fam ? 'New version added.' : 'Added to the library.');
      setNw(null);
      reload();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
    setProg(0);
  };
  return html`<div className="stack">
      <div className="toolbar"><span className="muted small">StratEdge's documents for clients, each with its versions. Clients only receive a document you supply for what they asked for.</span><button className="btn push" onClick=${() => setNw({ kind: '', ti: '', exp: '', ast: 'draft', file: null })}><${Icon} n="plus" />Add a document</button></div>
      ${
        Object.keys(fams).length
          ? html`<div className="tblwrap"><table className="tbl crtbl"><thead><tr><th>Document</th><th>Kind</th><th>Version</th><th>Valid until</th><th>Added</th><th></th></tr></thead><tbody>${Object.values(fams).map(vs => {
              const d = vs.find(x => x.cur) || vs[0];
              return html`<tr key=${d.fam} className=${d.expired ? 'cqexc' : ''}><td><a href=${cqFileHref(d.id)}><b>${d.ti}</b></a><div className="muted small">${d.fn}${vs.length > 1 ? ' · ' + (vs.length - 1) + ' older version' + (vs.length > 2 ? 's' : '') : ''}</div>${d.note ? html`<div className="small">${d.note}</div>` : ''}</td><td className="small">${home.kinds[d.kind]}${d.ast ? html` <${Chip} s=${d.ast === 'executed' ? 'ok' : ''}>${d.ast === 'executed' ? 'executed' : 'draft'}<//>` : ''}</td><td>v${d.n}</td><td className="nw">${d.exp ? crDay(d.exp) : '—'}${d.expired ? html` <${Chip} s="red">expired<//>` : ''}</td><td className="small nw">${fmtTs(d.at)}<div className="muted">${d.byn}</div></td><td className="r"><button type="button" className="btn ghost sm" onClick=${() => setNw({ fam: d.fam, kind: d.kind, ti: d.ti, exp: '', ast: d.ast || 'draft', file: null })}>New version…</button></td></tr>`;
            })}</tbody></table></div>`
          : html`<${Empty} title="The library is empty">Add the documents clients usually ask for: a W-9, a certificate of insurance, the MSA and NDA, a security questionnaire.<//>`
      }
      ${
        nw &&
        html`<${Modal} title=${nw.fam ? 'New version: ' + nw.ti : 'Add a document'} onClose=${() => setNw(null)} foot=${html`<button className="btn ghost" onClick=${() => setNw(null)}>Cancel</button><button className="btn" disabled=${busy || !nw.file || !nw.kind || !nw.ti.trim()} onClick=${save}>${busy && prog ? Math.round(prog * 100) + '%' : 'Save'}</button>`}>
          <div className="stack form">
            ${!nw.fam && html`<div className="row2"><${Field} label="Kind"><select value=${nw.kind} onChange=${e => setNw({ ...nw, kind: e.target.value, ti: nw.ti || (home.kinds[e.target.value] || '') })}><option value="">Choose…</option>${Object.entries(home.kinds).map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select><//><${Field} label="Title"><input value=${nw.ti} onInput=${e => setNw({ ...nw, ti: e.target.value })} /><//></div>`}
            <${Field} label="File"><input type="file" onChange=${e => setNw({ ...nw, file: e.target.files[0] || null })} /><//>
            <div className="row2"><${Field} label="Valid until (if it expires)"><input type="date" value=${nw.exp} onInput=${e => setNw({ ...nw, exp: e.target.value })} /><//>${home.agree.includes(nw.kind) && html`<${Field} label="This copy is"><select value=${nw.ast} onChange=${e => setNw({ ...nw, ast: e.target.value })}><option value="draft">A draft (not signed)</option><option value="executed">The executed (signed) agreement</option></select><//>`}</div>
            <${Field} label="Note (optional)"><input value=${nw.note || ''} onInput=${e => setNw({ ...nw, note: e.target.value })} /><//>
          </div>
        <//>`
      }
    </div>`;
}
function CqProfEditor({ home, reload }) {
  const toast = useToast();
  const base = (home.draft || home.approved || { data: { legal: '', dba: '', founded: null, hq: '', web: '', about: '', ids: '', ins: '', locs: [], services: [], skills: [], owners: [], certs: [], refs: [] } }).data;
  const [d, setD] = useState(() => ({ ...base, locsT: cqLines(base.locs), servicesT: cqLines(base.services), skillsT: cqLines(base.skills) }));
  const [busy, setBusy] = useState(false);
  const [pv, setPv] = useState(false);
  const up = (k, v) => setD({ ...d, [k]: v });
  const row = (k, i, patch) => setD({ ...d, [k]: d[k].map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const save = async () => {
    setBusy(true);
    try {
      const data = { ...d, locs: cqSplit(d.locsT), services: cqSplit(d.servicesT), skills: cqSplit(d.skillsT) };
      await api('cq_prof_save', { data });
      toast('Draft saved. An administrator approves it before clients see it.');
      reload();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const approve = async () => {
    setBusy(true);
    try {
      const r = await api('cq_prof_approve', {});
      toast('Version ' + r.n + ' approved: clients see it now.');
      reload();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const certDocs = home.docs.filter(x => x.cur);
  return html`<div className="stack">
      <div className="note"><span>${home.approved ? 'Clients see version ' + home.approved.n + ', approved ' + fmtTs(home.approved.apvAt) + ' by ' + home.approved.apvBy + '.' : 'Clients see nothing yet: no version is approved.'} ${home.draft ? 'A draft (version ' + home.draft.n + ') is waiting for approval.' : ''}</span></div>
      <div className="actions"><button className="btn" disabled=${busy} onClick=${save}>Save the draft</button>${home.admin && home.draft && html`<button className="btn ghost" disabled=${busy} onClick=${approve}><${Icon} n="check" />Approve the draft</button>`}<button className="btn ghost" onClick=${() => setPv(!pv)}>${pv ? 'Hide' : 'What clients see now'}</button></div>
      ${pv && html`<${CqProfileView} prof=${home.public} staffPreview=${true} />`}
      <div className="stack form cqprofedit">
        <div className="row3"><${Field} label="Legal name"><input value=${d.legal} onInput=${e => up('legal', e.target.value)} /><//><${Field} label="Doing business as"><input value=${d.dba} onInput=${e => up('dba', e.target.value)} /><//><${Field} label="Founded (year)"><input type="number" min="1900" value=${d.founded || ''} onInput=${e => up('founded', e.target.value)} /><//></div>
        <div className="row2"><${Field} label="Headquarters"><input value=${d.hq} onInput=${e => up('hq', e.target.value)} /><//><${Field} label="Website"><input value=${d.web} onInput=${e => up('web', e.target.value)} /><//></div>
        <${Field} label="About"><textarea rows="3" value=${d.about} onInput=${e => up('about', e.target.value)} /><//>
        <div className="row3"><${Field} label="Services (one per line)"><textarea rows="5" value=${d.servicesT} onInput=${e => up('servicesT', e.target.value)} /><//><${Field} label="Skill areas (one per line)"><textarea rows="5" value=${d.skillsT} onInput=${e => up('skillsT', e.target.value)} /><//><${Field} label="Locations (one per line)"><textarea rows="5" value=${d.locsT} onInput=${e => up('locsT', e.target.value)} /><//></div>
        <div className="row2"><${Field} label="Registrations and identifiers" hint="e.g. EIN, UEI, DUNS, NAICS codes, state registration"><textarea rows="2" value=${d.ids} onInput=${e => up('ids', e.target.value)} /><//><${Field} label="Insurance summary"><textarea rows="2" value=${d.ins} onInput=${e => up('ins', e.target.value)} /><//></div>
        <span className="lbl">Relationship owners</span>
        ${d.owners.map((o, i) => html`<div key=${i} className="cqrow"><input value=${o.n} aria-label=${'Owner ' + (i + 1) + ' name'} placeholder="Name" onInput=${e => row('owners', i, { n: e.target.value })} /><input value=${o.role} aria-label=${'Owner ' + (i + 1) + ' role'} placeholder="Role" onInput=${e => row('owners', i, { role: e.target.value })} /><input value=${o.e} aria-label=${'Owner ' + (i + 1) + ' email'} placeholder="Email" onInput=${e => row('owners', i, { e: e.target.value })} /><input value=${o.ph} aria-label=${'Owner ' + (i + 1) + ' phone'} placeholder="Phone" onInput=${e => row('owners', i, { ph: e.target.value })} /><button type="button" className="btn ghost sm" aria-label=${'Remove owner ' + (i + 1)} onClick=${() => up('owners', d.owners.filter((x, j) => j !== i))}><${Icon} n="trash" /></button></div>`)}
        <div><button type="button" className="btn ghost sm" onClick=${() => up('owners', [...d.owners, { n: '', role: '', e: '', ph: '' }])}><${Icon} n="plus" />Add an owner</button></div>
        <span className="lbl">Certifications</span>
        <p className="muted small" style=${{ margin: 0 }}>A certification shows to clients only with evidence from the library that has not expired, and only when it is meant for every client.</p>
        ${d.certs.map((c, i) => html`<div key=${i} className="cqrow"><input value=${c.n} aria-label=${'Certification ' + (i + 1)} placeholder="Certification" onInput=${e => row('certs', i, { n: e.target.value })} /><input value=${c.by} aria-label=${'Certification ' + (i + 1) + ' issuer'} placeholder="Issued by" onInput=${e => row('certs', i, { by: e.target.value })} /><input value=${c.num || ''} aria-label=${'Certification ' + (i + 1) + ' number'} placeholder="Number" maxLength="80" onInput=${e => row('certs', i, { num: e.target.value })} /><input type="date" value=${c.exp} aria-label=${'Certification ' + (i + 1) + ' valid until'} onInput=${e => row('certs', i, { exp: e.target.value })} /><select value=${c.doc} aria-label=${'Certification ' + (i + 1) + ' evidence'} onChange=${e => row('certs', i, { doc: e.target.value })}><option value="">No evidence yet</option>${certDocs.map(x => html`<option key=${x.id} value=${x.id}>${x.ti} (v${x.n}${x.expired ? ', expired' : ''})</option>`)}</select><label className="check"><input type="checkbox" checked=${!!c.all} onChange=${e => row('certs', i, { all: e.target.checked })} /><span>Every client</span></label><button type="button" className="btn ghost sm" aria-label=${'Remove certification ' + (i + 1)} onClick=${() => up('certs', d.certs.filter((x, j) => j !== i))}><${Icon} n="trash" /></button></div>`)}
        <div><button type="button" className="btn ghost sm" onClick=${() => up('certs', [...d.certs, { n: '', by: '', num: '', exp: '', doc: '', all: true }])}><${Icon} n="plus" />Add a certification</button></div>
        <span className="lbl">Customer references</span>
        <p className="muted small" style=${{ margin: 0 }}>A reference shows to clients only once the customer's permission is recorded.</p>
        ${d.refs.map((r, i) => html`<div key=${i} className="cqrow"><input value=${r.co} aria-label=${'Reference ' + (i + 1) + ' company'} placeholder="Company" onInput=${e => row('refs', i, { co: e.target.value })} /><input value=${r.who} aria-label=${'Reference ' + (i + 1) + ' contact'} placeholder="Contact (optional)" onInput=${e => row('refs', i, { who: e.target.value })} /><input value=${r.what} aria-label=${'Reference ' + (i + 1) + ' work'} placeholder="What StratEdge did" onInput=${e => row('refs', i, { what: e.target.value })} /><label className="check"><input type="checkbox" checked=${!!r.ok} onChange=${e => row('refs', i, { ok: e.target.checked })} /><span>Permission recorded</span></label><button type="button" className="btn ghost sm" aria-label=${'Remove reference ' + (i + 1)} onClick=${() => up('refs', d.refs.filter((x, j) => j !== i))}><${Icon} n="trash" /></button></div>`)}
        <div><button type="button" className="btn ghost sm" onClick=${() => up('refs', [...d.refs, { co: '', who: '', what: '', ok: false, okNote: '' }])}><${Icon} n="plus" />Add a reference</button></div>
      </div>
    </div>`;
}
