/* ================= CRM (v29): leads, scoring, assignment, workflow rules, custom fields, reports =================
   Zoho-style additions on top of crm.js. Leads live in crm/main/lead; converting one creates the company, the contact
   and the opportunity. Rules live in crm/main/x/settings (leadRules, assign, flows, custom). */
const CRM_LEAD_ST = ['New', 'Working', 'Nurture', 'Qualified', 'Unqualified', 'Converted'];
const CRM_LEAD_RULES_DEFAULT = [
  { when: 'src', eq: 'Referral', pts: 25 },
  { when: 'src', eq: 'Existing client', pts: 30 },
  { when: 'src', eq: 'Website', pts: 10 },
  { when: 'has', eq: 'e', pts: 10 },
  { when: 'has', eq: 'ph', pts: 10 },
  { when: 'title', eq: 'director|vp|vice president|head|chief|cto|cio|ceo|owner|founder', pts: 20 },
  { when: 'title', eq: 'manager|lead', pts: 10 },
  { when: 'need', eq: 'urgent|immediate|asap|this week', pts: 15 },
  { when: 'value', eq: '50000', pts: 15 },
];
const CRM_FLOWS_DEFAULT = [
  { on: 'deal', stage: 'proposal', task: 'Follow up on the proposal', days: 3 },
  { on: 'deal', stage: 'negotiation', task: 'Confirm rates and start date', days: 2 },
  { on: 'deal', stage: 'won', task: 'Kick-off: MSA, PO and onboarding', days: 1 },
  { on: 'lead', stage: 'New', task: 'First call to the new lead', days: 1 },
];
const CRM_CUSTOM_TYPES = [['text', 'Text'], ['number', 'Number'], ['date', 'Date'], ['select', 'Pick one'], ['check', 'Checkbox'], ['url', 'Link']];
const crmExtra = raw => {
  const s = raw || {};
  return {
    leadRules: Array.isArray(s.leadRules) && s.leadRules.length ? s.leadRules : CRM_LEAD_RULES_DEFAULT,
    flows: Array.isArray(s.flows) ? s.flows : CRM_FLOWS_DEFAULT,
    assign: { mode: 'roundrobin', pool: [], ...(s.assign && typeof s.assign === 'object' ? s.assign : {}) },
    custom: { acc: [], con: [], deal: [], lead: [], ...(s.custom && typeof s.custom === 'object' ? s.custom : {}) },
  };
};
/* Points for a lead from the rules: source, having an email/phone, title words, urgency words, value. */
function leadScore(l, rules) {
  let pts = 0;
  const why = [];
  (rules || []).forEach(r => {
    const eq = String(r.eq || '');
    let hit = false;
    if (r.when === 'src') hit = (l.src || '') === eq;
    else if (r.when === 'has') hit = !!(l[eq] && String(l[eq]).trim());
    else if (r.when === 'title') hit = new RegExp('\\b(' + eq + ')\\b', 'i').test(l.ti || '');
    else if (r.when === 'need') hit = new RegExp('(' + eq + ')', 'i').test((l.need || '') + ' ' + (l.notes || ''));
    else if (r.when === 'value') hit = (+l.v || 0) >= +eq;
    else if (r.when === 'ind') hit = (l.ind || '') === eq;
    if (hit) {
      pts += +r.pts || 0;
      why.push((r.when === 'has' ? 'has ' + (eq === 'e' ? 'email' : 'phone') : r.when === 'title' ? 'senior title' : r.when === 'need' ? 'urgent need' : r.when === 'value' ? 'value ≥ ' + eq : eq) + ' +' + r.pts);
    }
  });
  return { pts: Math.max(0, Math.min(100, pts)), why, band: pts >= 60 ? 'Hot' : pts >= 30 ? 'Warm' : 'Cold' };
}
const crmCustomFields = (custom, kind) => (custom && Array.isArray(custom[kind]) ? custom[kind] : []).filter(c => c && c.k && c.n).map(c => ({ k: 'c_' + c.k, n: c.n, t: c.t === 'check' ? 'check' : c.t === 'select' ? 'select' : c.t || 'text', o: c.t === 'select' ? String(c.o || '').split('|').map(x => x.trim()).filter(Boolean) : undefined, custom: true }));
/* Workflow rules: when a deal or lead reaches a stage, a follow-up lands on the owner's list. */
async function applyFlows(S, kind, row, prevStage, P) {
  const flows = (S.flows || []).filter(f => f.on === kind && String(f.stage) === String(row.stage || row.st) && String(prevStage || '') !== String(row.stage || row.st));
  let n = 0;
  for (const f of flows) {
    if (!f.task) continue;
    await dbSet(`crm/main/act/${nid()}`, { t: f.task.replace(/\{name\}/g, row.t || row.n || ''), kind: 'Follow-up', due: addDays(dkey(), +f.days || 0), acc: row.acc || '', deal: kind === 'deal' ? row.id || '' : '', con: row.con || '', own: row.own || P.uid, done: false, auto: true, at: Date.now(), by: P.uid, u: Date.now() });
    n++;
  }
  return n;
}
/* ---- Leads ---- */
function LeadsTab({ S, X, refs, accs, cons, onConverted }) {
  const P = usePortal();
  const toast = useToast();
  const leads = useCol('crm/main/lead', 'u:desc');
  const [st, setSt] = useState('open');
  const [conv, setConv] = useState(null);
  const F = useMemo(() => [
    { k: 'n', n: 'Contact name', req: 1 },
    { k: 'co', n: 'Company' },
    { k: 'ti', n: 'Title', ph: 'e.g. Director of Engineering' },
    { k: 'e', n: 'Email', t: 'email' },
    { k: 'ph', n: 'Phone', t: 'tel' },
    { k: 'src', n: 'Source', t: 'select', o: S.srcs },
    { k: 'st', n: 'Status', t: 'select', o: CRM_LEAD_ST, chip: { New: 'new', Qualified: 'ok', Converted: 'ok', Unqualified: 'warn' } },
    { k: 'own', n: 'Owner', t: 'person' },
    { k: 'need', n: 'What they need', ph: 'e.g. 2 Salesforce developers, remote, 6 months' },
    { k: 'v', n: 'Estimated value', t: 'money' },
    { k: 'ind', n: 'Industry', t: 'select', o: S.inds },
    { k: 'loc', n: 'Location' },
    ...crmCustomFields(X.custom, 'lead'),
    { k: 'notes', n: 'Notes', t: 'textarea' },
  ], [S, X]);
  const list = leads.docs.filter(l => (st === 'all' ? true : st === 'open' ? !['Converted', 'Unqualified'].includes(l.st || 'New') : (l.st || 'New') === st));
  const scored = list.map(l => ({ ...l, _s: leadScore(l, X.leadRules) })).sort((a, b) => b._s.pts - a._s.pts);
  const convert = async () => {
    const l = conv;
    try {
      const now = Date.now();
      let accId = (accs.find(a => (a.n || '').trim().toLowerCase() === (l.co || '').trim().toLowerCase()) || {}).id || '';
      if (!accId && l.co) {
        accId = nid();
        await dbSet(`crm/main/acc/${accId}`, { n: l.co, ty: S.types[0], st: 'Prospect', own: l.own || P.uid, ind: l.ind || '', loc: l.loc || '', e: '', ph: '', at: now, by: P.uid, u: now, fromLead: l.id });
      }
      let conId = (cons.find(c => l.e && (c.e || '').toLowerCase() === l.e.toLowerCase()) || {}).id || '';
      if (!conId) {
        conId = nid();
        await dbSet(`crm/main/con/${conId}`, { n: l.n, acc: accId, ti: l.ti || '', e: l.e || '', ph: l.ph || '', rel: S.rels[0], at: now, by: P.uid, u: now, fromLead: l.id });
      }
      const dealId = nid();
      await dbSet(`crm/main/deal/${dealId}`, { t: l.need || `${l.co || l.n} opportunity`, acc: accId, con: conId, stage: S.stages[0].k, v: +l.v || null, cur: S.curs[0], kind: S.kinds[0], src: l.src || '', own: l.own || P.uid, notes: l.notes || '', at: now, by: P.uid, u: now, fromLead: l.id });
      await dbMerge(`crm/main/lead/${l.id}`, { st: 'Converted', acc: accId, con: conId, deal: dealId, convertedAt: now, u: now });
      await applyFlows({ flows: X.flows }, 'deal', { id: dealId, stage: S.stages[0].k, acc: accId, con: conId, own: l.own || P.uid, t: l.need }, '', P);
      toast('Converted: company, contact and opportunity created.');
      setConv(null);
      onConverted && onConverted();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const dupeOf = l => leads.docs.find(x => x.id !== l.id && l.e && (x.e || '').toLowerCase() === l.e.toLowerCase());
  return html`<div className="stack">
      <div className="toolbar"><div className="seg">${[['open', 'Open'], ['New', 'New'], ['Working', 'Working'], ['Qualified', 'Qualified'], ['Converted', 'Converted'], ['all', 'All']].map(([k, n]) => html`<button key=${k} className=${st === k ? 'on' : ''} onClick=${() => setSt(k)}>${n}</button>`)}</div><span className="muted small">Scored by the rules under Settings › Lead scoring; website enquiries arrive here on their own, assigned round-robin.</span></div>
      <${KitList} col="crm/main/lead" fields=${F} cols=${['n', 'co', 'ti', 'src', 'st', 'own', 'v']} title="Leads" noun="Lead" refs=${refs} sort="u:desc"
        defaults=${{ st: 'New', own: P.uid, src: S.srcs[0] }} filter=${r => scored.some(x => x.id === r.id)}
        onSaved=${(out, prev) => { if (out.st) applyFlows({ flows: X.flows }, 'lead', { ...(prev || {}), ...out, id: '' }, prev ? prev.st || 'New' : '', P); }}
        preview=${f => { const sc = leadScore(f, X.leadRules); return html`<div className="actions"><${Chip} s=${sc.band === 'Hot' ? 'red' : sc.band === 'Warm' ? 'amber' : ''}>${sc.band} · ${sc.pts}<//><span className="muted small">${sc.why.join(' · ') || 'no rule matched yet'}</span></div>`; }}
        rowTools=${r => { const sc = leadScore(r, X.leadRules); const d = dupeOf(r); return html`<span className="actions" style=${{ flexWrap: 'nowrap' }}><${Chip} s=${sc.band === 'Hot' ? 'red' : sc.band === 'Warm' ? 'amber' : ''}>${sc.band} ${sc.pts}<//>${d ? html`<${Chip} s="warn" title=${'Same email as ' + d.n}>dupe<//>` : null}${(r.st || 'New') !== 'Converted' && (r.st || 'New') !== 'Unqualified' ? html`<button type="button" className="btn go sm" onClick=${() => setConv(r)}>Convert</button>` : r.deal ? html`<span className="muted small">→ opportunity</span>` : null}</span>`; }} />
      ${
        conv &&
        html`<${Modal} title=${'Convert ' + conv.n} onClose=${() => setConv(null)} foot=${html`<button className="btn ghost" onClick=${() => setConv(null)}>Cancel</button><button className="btn" onClick=${convert}>Convert</button>`}>
            <p className="small">This creates <b>${conv.co ? (accs.some(a => (a.n || '').trim().toLowerCase() === conv.co.trim().toLowerCase()) ? 'uses the existing company ' : 'the company ') + conv.co : 'no company (none given)'}</b>, the contact <b>${conv.n}</b>${conv.e && cons.some(c => (c.e || '').toLowerCase() === conv.e.toLowerCase()) ? ' (already a contact; reused)' : ''}, and an opportunity in <b>${S.stages[0].n}</b>${conv.v ? ' worth ' + fmtMoney(+conv.v, S.curs[0]) : ''}. The lead is marked Converted and keeps the links.</p>
          <//>`
      }
    </div>`;
}
/* ---- Reports ---- */
function CRMReports({ S, deals, acts, accs, leads }) {
  const P = usePortal();
  const [months, setMonths] = useState(6);
  const open = deals.filter(crmOpen);
  const closed = deals.filter(d => ['won', 'lost'].includes(d.stage));
  const won = closed.filter(d => d.stage === 'won');
  const byStage = S.stages.filter(s => !['won', 'lost'].includes(s.k)).map(s => { const list = open.filter(d => (d.stage || 'lead') === s.k); return { s, n: list.length, v: list.reduce((a, d) => a + (+d.v || 0), 0), age: list.length ? Math.round(list.reduce((a, d) => a + (Date.now() - (d.u || d.at || Date.now())) / 86400000, 0) / list.length) : 0 }; });
  const maxV = Math.max(1, ...byStage.map(x => x.v));
  const owners = {};
  deals.forEach(d => { const o = d.own || '—'; owners[o] = owners[o] || { open: 0, openV: 0, won: 0, wonV: 0, lost: 0 }; if (crmOpen(d)) { owners[o].open++; owners[o].openV += +d.v || 0; } else if (d.stage === 'won') { owners[o].won++; owners[o].wonV += +d.v || 0; } else owners[o].lost++; });
  const srcs = {};
  deals.forEach(d => { const s = d.src || '—'; srcs[s] = srcs[s] || { n: 0, won: 0, v: 0 }; srcs[s].n++; if (d.stage === 'won') { srcs[s].won++; srcs[s].v += +d.v || 0; } });
  const cycle = won.filter(d => d.closedAt && d.at).map(d => (d.closedAt - d.at) / 86400000);
  const avgCycle = cycle.length ? Math.round(cycle.reduce((a, b) => a + b, 0) / cycle.length) : null;
  const avgDeal = won.length ? won.reduce((a, d) => a + (+d.v || 0), 0) / won.length : 0;
  const trend = Array.from({ length: months }, (_, i) => addMonths(mkey(dkey()), i - months + 1)).map(mk => { const w = won.filter(d => d.closedAt && mkey(dkey(new Date(d.closedAt))) === mk); const created = deals.filter(d => d.at && mkey(dkey(new Date(d.at))) === mk); return { mk, won: w.length, v: w.reduce((a, d) => a + (+d.v || 0), 0), created: created.length }; });
  const maxT = Math.max(1, ...trend.map(t => t.v));
  const lostWhy = {};
  deals.filter(d => d.stage === 'lost').forEach(d => { lostWhy[d.why || 'No reason given'] = (lostWhy[d.why || 'No reason given'] || 0) + 1; });
  const actOwners = {};
  acts.forEach(a => { const o = a.own || '—'; actOwners[o] = actOwners[o] || { done: 0, open: 0, late: 0 }; if (a.done) actOwners[o].done++; else { actOwners[o].open++; if (a.due && a.due < dkey()) actOwners[o].late++; } });
  const name = id => (id === '—' ? 'Unassigned' : kitName(P, id) || id);
  const M = v => fmtMoney(v, S.curs[0]);
  const leadBands = { Hot: 0, Warm: 0, Cold: 0 };
  (leads || []).filter(l => !['Converted', 'Unqualified'].includes(l.st || 'New')).forEach(l => { leadBands[leadScore(l, crmExtra(S).leadRules).band]++; });
  return html`<div className="stack">
      <${KitStats} items=${[{ v: closed.length ? Math.round((won.length / closed.length) * 100) + '%' : '—', l: `Win rate (${won.length} of ${closed.length} closed)` }, { v: M(Math.round(avgDeal)), l: 'Average won deal' }, { v: avgCycle != null ? avgCycle + ' d' : '—', l: 'Sales cycle (created → won)' }, { v: open.length, l: 'Open opportunities' }, { v: `${leadBands.Hot} / ${leadBands.Warm} / ${leadBands.Cold}`, l: 'Open leads: hot / warm / cold' }]} />
      <div className="g2" style=${{ alignItems: 'start' }}>
        <section className="panel stack">
          <h2 className="ph">Pipeline by stage</h2>
          <table className="tbl small"><thead><tr><th>Stage</th><th className="r">Deals</th><th className="r">Value</th><th className="r">Avg days</th><th style=${{ width: '30%' }} /></tr></thead><tbody>${byStage.map(x => html`<tr key=${x.s.k}><td>${x.s.n} <span className="muted">· ${x.s.p}%</span></td><td className="r num">${x.n}</td><td className="r num">${M(x.v)}</td><td className="r num">${x.age}</td><td><div style=${{ background: 'var(--bg-2, #eef1f6)', borderRadius: 6, height: 10, overflow: 'hidden' }}><div style=${{ width: Math.round((x.v / maxV) * 100) + '%', height: '100%', background: 'var(--indigo)' }} /></div></td></tr>`)}</tbody></table>
        </section>
        <section className="panel stack">
          <h2 className="ph">Won by month</h2>
          <div className="toolbar" style=${{ marginBottom: 0 }}><div className="seg">${[3, 6, 12].map(n => html`<button key=${n} className=${months === n ? 'on' : ''} onClick=${() => setMonths(n)}>${n} months</button>`)}</div></div>
          <table className="tbl small"><thead><tr><th>Month</th><th className="r">Created</th><th className="r">Won</th><th className="r">Value</th><th style=${{ width: '30%' }} /></tr></thead><tbody>${trend.map(t => html`<tr key=${t.mk}><td>${monthLabel(t.mk)}</td><td className="r num">${t.created}</td><td className="r num">${t.won}</td><td className="r num">${M(t.v)}</td><td><div style=${{ background: 'var(--bg-2, #eef1f6)', borderRadius: 6, height: 10, overflow: 'hidden' }}><div style=${{ width: Math.round((t.v / maxT) * 100) + '%', height: '100%', background: 'var(--teal, #0aa19c)' }} /></div></td></tr>`)}</tbody></table>
        </section>
      </div>
      <div className="g2" style=${{ alignItems: 'start' }}>
        <section className="panel stack">
          <h2 className="ph">By owner</h2>
          <table className="tbl small"><thead><tr><th>Owner</th><th className="r">Open</th><th className="r">Open value</th><th className="r">Won</th><th className="r">Won value</th><th className="r">Win rate</th><th className="r">Follow-ups late</th></tr></thead><tbody>${Object.entries(owners).map(([o, x]) => html`<tr key=${o}><td>${name(o)}</td><td className="r num">${x.open}</td><td className="r num">${M(x.openV)}</td><td className="r num">${x.won}</td><td className="r num">${M(x.wonV)}</td><td className="r num">${x.won + x.lost ? Math.round((x.won / (x.won + x.lost)) * 100) + '%' : '—'}</td><td className=${'r num' + ((actOwners[o] || {}).late ? ' late' : '')}>${(actOwners[o] || {}).late || 0}</td></tr>`)}</tbody></table>
        </section>
        <section className="panel stack">
          <h2 className="ph">By source and lost reasons</h2>
          <table className="tbl small"><thead><tr><th>Source</th><th className="r">Deals</th><th className="r">Won</th><th className="r">Won value</th></tr></thead><tbody>${Object.entries(srcs).sort((a, b) => b[1].n - a[1].n).map(([s, x]) => html`<tr key=${s}><td>${s}</td><td className="r num">${x.n}</td><td className="r num">${x.won}</td><td className="r num">${M(x.v)}</td></tr>`)}</tbody></table>
          ${Object.keys(lostWhy).length > 0 && html`<table className="tbl small"><thead><tr><th>Lost because</th><th className="r">Deals</th></tr></thead><tbody>${Object.entries(lostWhy).sort((a, b) => b[1] - a[1]).map(([w, n]) => html`<tr key=${w}><td>${w}</td><td className="r num">${n}</td></tr>`)}</tbody></table>`}
        </section>
      </div>
    </div>`;
}
/* ---- Settings sections: lead scoring, assignment, workflow rules, custom fields ---- */
function CRMAutomationSettings({ X, setX, S }) {
  const P = usePortal();
  const people = kitPeople(P);
  const rules = X.leadRules;
  const setRule = (i, patch) => setX({ ...X, leadRules: rules.map((r, k) => (k === i ? { ...r, ...patch } : r)) });
  const flows = X.flows;
  const setFlow = (i, patch) => setX({ ...X, flows: flows.map((r, k) => (k === i ? { ...r, ...patch } : r)) });
  const custom = X.custom;
  const setCustom = (kind, list) => setX({ ...X, custom: { ...custom, [kind]: list } });
  return html`<div className="stack">
      <div className="g2" style=${{ alignItems: 'start' }}>
        <section className="panel stack">
          <h2 className="ph">Lead scoring</h2>
          <p className="muted small" style=${{ margin: 0 }}>Points add up to a score (capped at 100): 60+ is Hot, 30+ Warm. Title and need rules take words separated by |.</p>
          <table className="tbl small"><thead><tr><th>When</th><th>Matches</th><th className="r">Points</th><th /></tr></thead><tbody>${rules.map((r, i) => html`<tr key=${i}><td><select value=${r.when} onChange=${e => setRule(i, { when: e.target.value })}><option value="src">Source is</option><option value="has">Has</option><option value="title">Title contains</option><option value="need">Need mentions</option><option value="value">Value at least</option><option value="ind">Industry is</option></select></td><td>${r.when === 'src' ? html`<select value=${r.eq} onChange=${e => setRule(i, { eq: e.target.value })}>${S.srcs.map(s => html`<option key=${s}>${s}</option>`)}</select>` : r.when === 'has' ? html`<select value=${r.eq} onChange=${e => setRule(i, { eq: e.target.value })}><option value="e">email</option><option value="ph">phone</option><option value="co">company</option></select>` : r.when === 'ind' ? html`<select value=${r.eq} onChange=${e => setRule(i, { eq: e.target.value })}>${S.inds.map(s => html`<option key=${s}>${s}</option>`)}</select>` : html`<input value=${r.eq} onInput=${e => setRule(i, { eq: e.target.value })} />`}</td><td className="r"><input type="number" value=${r.pts} onInput=${e => setRule(i, { pts: +e.target.value })} style=${{ width: 70 }} /></td><td className="r"><button type="button" className="btn ghost sm" onClick=${() => setX({ ...X, leadRules: rules.filter((x, k) => k !== i) })}>Remove</button></td></tr>`)}</tbody></table>
          <div><button type="button" className="btn ghost sm" onClick=${() => setX({ ...X, leadRules: [...rules, { when: 'src', eq: S.srcs[0], pts: 10 }] })}><${Icon} n="plus" />Add a rule</button></div>
        </section>
        <section className="panel stack">
          <h2 className="ph">Assignment of website leads</h2>
          <p className="muted small" style=${{ margin: 0 }}>Enquiries from the website (Request talent, Contact us) become leads and go round-robin to these people. With nobody ticked they stay unassigned.</p>
          <div className="portalpicks wide">${people.map(([id, n]) => html`<label key=${id} className=${'pick' + ((X.assign.pool || []).includes(id) ? ' on' : '')}><input type="checkbox" checked=${(X.assign.pool || []).includes(id)} onChange=${e => setX({ ...X, assign: { ...X.assign, pool: e.target.checked ? [...(X.assign.pool || []), id] : (X.assign.pool || []).filter(x => x !== id) } })} /><span>${n}</span></label>`)}</div>
          <h2 className="ph" style=${{ marginTop: 8 }}>Workflow rules</h2>
          <p className="muted small" style=${{ margin: 0 }}>When an opportunity or a lead reaches a stage, a follow-up is created for its owner, due in the given number of days.</p>
          <table className="tbl small"><thead><tr><th>On</th><th>Stage</th><th>Follow-up</th><th className="r">Days</th><th /></tr></thead><tbody>${flows.map((f, i) => html`<tr key=${i}><td><select value=${f.on} onChange=${e => setFlow(i, { on: e.target.value, stage: e.target.value === 'deal' ? S.stages[0].k : 'New' })}><option value="deal">Opportunity</option><option value="lead">Lead</option></select></td><td><select value=${f.stage} onChange=${e => setFlow(i, { stage: e.target.value })}>${(f.on === 'lead' ? CRM_LEAD_ST.map(s => [s, s]) : S.stages.map(s => [s.k, s.n])).map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select></td><td><input value=${f.task} onInput=${e => setFlow(i, { task: e.target.value })} /></td><td className="r"><input type="number" min="0" value=${f.days} onInput=${e => setFlow(i, { days: +e.target.value })} style=${{ width: 60 }} /></td><td className="r"><button type="button" className="btn ghost sm" onClick=${() => setX({ ...X, flows: flows.filter((x, k) => k !== i) })}>Remove</button></td></tr>`)}</tbody></table>
          <div><button type="button" className="btn ghost sm" onClick=${() => setX({ ...X, flows: [...flows, { on: 'deal', stage: S.stages[0].k, task: 'Follow up', days: 2 }] })}><${Icon} n="plus" />Add a rule</button></div>
        </section>
      </div>
      <section className="panel stack">
        <h2 className="ph">Custom fields</h2>
        <p className="muted small" style=${{ margin: 0 }}>Extra fields on the forms. For "Pick one", list the choices separated by |.</p>
        <div className="g2">${[['acc', 'Companies'], ['con', 'Contacts'], ['deal', 'Opportunities'], ['lead', 'Leads']].map(([kind, label]) => html`<div key=${kind} className="stack" style=${{ gap: 6 }}><b className="small">${label}</b>${(custom[kind] || []).map((c, i) => html`<div key=${i} className="actions" style=${{ flexWrap: 'nowrap' }}><input value=${c.n} placeholder="Field name" onInput=${e => setCustom(kind, custom[kind].map((x, k) => (k === i ? { ...x, n: e.target.value, k: x.k || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_') } : x)))} /><select value=${c.t || 'text'} onChange=${e => setCustom(kind, custom[kind].map((x, k) => (k === i ? { ...x, t: e.target.value } : x)))}>${CRM_CUSTOM_TYPES.map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select>${c.t === 'select' ? html`<input value=${c.o || ''} placeholder="A | B | C" onInput=${e => setCustom(kind, custom[kind].map((x, k) => (k === i ? { ...x, o: e.target.value } : x)))} />` : null}<button type="button" className="btn ghost icon sm" onClick=${() => setCustom(kind, custom[kind].filter((x, k) => k !== i))}><${Icon} n="x" /></button></div>`)}<div><button type="button" className="btn ghost sm" onClick=${() => setCustom(kind, [...(custom[kind] || []), { k: '', n: '', t: 'text' }])}><${Icon} n="plus" />Add a field</button></div></div>`)}</div>
      </section>
    </div>`;
}
/* Possible duplicates among companies (same name) and contacts (same email). */
function crmDupes(accs, cons) {
  const out = [];
  const byName = {};
  accs.forEach(a => { const k = (a.n || '').trim().toLowerCase(); if (k) (byName[k] = byName[k] || []).push(a); });
  Object.values(byName).filter(l => l.length > 1).forEach(l => out.push({ kind: 'company', n: l[0].n, ids: l.map(x => x.id) }));
  const byMail = {};
  cons.forEach(c => { const k = (c.e || '').trim().toLowerCase(); if (k) (byMail[k] = byMail[k] || []).push(c); });
  Object.values(byMail).filter(l => l.length > 1).forEach(l => out.push({ kind: 'contact', n: l[0].n + ' (' + l[0].e + ')', ids: l.map(x => x.id) }));
  return out;
}
