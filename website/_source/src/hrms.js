/* ================= HRMS: employee records, org chart, leave, assets and reviews ================= */
const HR_TYPES = ['Full-time', 'Part-time', 'Contract (W2)', 'Contract (C2C)', 'Intern'];
const HR_ST = ['Active', 'Probation', 'On notice', 'On leave', 'Exited'];
const HR_CFG_DEFAULT = {
  depts: 'Recruiting\nDelivery\nHR\nAccounts\nAdministration',
  leave: 'Casual leave: 12\nSick leave: 6\nEarned leave: 15',
};
const hrLeaveTypes = cfg =>
  String((cfg && cfg.leave) || HR_CFG_DEFAULT.leave)
    .split('\n')
    .map(l => l.split(':'))
    .filter(x => x[0].trim())
    .map(([n, d]) => [n.trim(), Math.max(0, parseFloat(d) || 0)]);
const hrDepts = cfg =>
  String((cfg && cfg.depts) || HR_CFG_DEFAULT.depts)
    .split('\n')
    .map(x => x.trim())
    .filter(Boolean);
const HR_ASSET = [
  { k: 'n', n: 'Asset', req: 1, ph: 'e.g. Dell Latitude 5440' },
  { k: 'kind', n: 'Kind', t: 'select', o: ['Laptop', 'Monitor', 'Phone', 'Headset', 'Access card', 'Software license', 'Other'] },
  { k: 'tag', n: 'Serial / asset tag' },
  { k: 'uid', n: 'Assigned to', t: 'person', none: 'In stock' },
  { k: 'out', n: 'Issued on', t: 'date' },
  { k: 'back', n: 'Returned on', t: 'date' },
  { k: 'cond', n: 'Condition', t: 'select', o: ['New', 'Good', 'Fair', 'Needs repair', 'Retired'] },
  { k: 'cost', n: 'Cost', t: 'money' },
  { k: 'notes', n: 'Notes', t: 'textarea' },
];
const HR_REVIEW = [
  { k: 'uid', n: 'Employee', t: 'person', req: 1 },
  { k: 'cyc', n: 'Review cycle', req: 1, ph: 'e.g. 2026 H2' },
  { k: 'rev', n: 'Reviewer', t: 'person' },
  { k: 'rating', n: 'Rating', t: 'select', o: [['5', '5 · Outstanding'], ['4', '4 · Exceeds'], ['3', '3 · Meets'], ['2', '2 · Developing'], ['1', '1 · Below']] },
  { k: 'st', n: 'Status', t: 'select', o: ['Draft', 'Shared with employee', 'Acknowledged'], chip: { Acknowledged: 'ok', 'Shared with employee': 'new' } },
  { k: 'date', n: 'Review date', t: 'date' },
  { k: 'goals', n: 'Goals for next cycle', t: 'textarea' },
  { k: 'str', n: 'Strengths', t: 'textarea' },
  { k: 'imp', n: 'Areas to improve', t: 'textarea' },
];
function hrRecFields(cfg) {
  return [
    { k: 'code', n: 'Employee ID', ph: 'e.g. SE-0012' },
    { k: 'dept', n: 'Department', t: 'select', o: hrDepts(cfg) },
    { k: 'desig', n: 'Designation', ph: 'e.g. Senior Recruiter' },
    { k: 'mgrId', n: 'Reports to', t: 'person', none: 'No manager' },
    { k: 'doj', n: 'Date of joining', t: 'date' },
    { k: 'type', n: 'Employment type', t: 'select', o: HR_TYPES },
    { k: 'st', n: 'Status', t: 'select', o: HR_ST },
    { k: 'loc', n: 'Work location', ph: 'e.g. Somerset, NJ or Hyderabad' },
    { k: 'mode', n: 'Work mode', t: 'select', o: ['Office', 'Hybrid', 'Remote'] },
    { k: 'emg', n: 'Emergency contact', ph: 'Name, relation, phone' },
    { k: 'bank', n: 'Payroll bank reference', ph: 'Bank name and last 4 digits only', hint: 'Keep full account numbers in your payroll provider, not here.' },
    // v37.3: personal details (also kept up to date through profile update requests)
    { k: 'pname', n: 'Preferred name' },
    { k: 'dob', n: 'Date of birth', t: 'date' },
    { k: 'pemail', n: 'Personal email' },
    { k: 'addr1', n: 'Home address' },
    { k: 'addr2', n: 'Apartment, suite or unit' },
    { k: 'city', n: 'City' },
    { k: 'state', n: 'State or province' },
    { k: 'zip', n: 'ZIP or postal code' },
    { k: 'country', n: 'Country' },
    { k: 'ecn', n: 'Emergency contact name' },
    { k: 'ecr', n: 'Emergency contact relationship' },
    { k: 'ecp', n: 'Emergency contact phone' },
    { k: 'deg', n: 'Highest degree' },
    { k: 'field', n: 'Field of study' },
    { k: 'school', n: 'School or university' },
    { k: 'gyear', n: 'Year completed' },
    { k: 'notes', n: 'HR notes', t: 'textarea' },
  ];
}
function HRMSPage({ q }) {
  const P = usePortal();
  const A = P.admin;
  const [tab, setTab] = useState((q && q.tab) || 'people');
  const cfgDoc = useDoc('hrms/x/pub/cfg');
  const cfg = cfgDoc.data || {};
  if (!A || A.loading) return html`<${Spinner} label="Loading people…" />`;
  const staff = A.members.filter(m => m.role !== 'employer' && m.st !== 'inactive');
  return html`<div className="stack">
      <${KitTabs} tab=${tab} onTab=${setTab} tabs=${[
        ['people', 'Employees'],
        ['requests', 'Update requests'],
        ['org', 'Org chart'],
        ['leave', 'Leave balances'],
        ['assets', 'Assets'],
        ['reviews', 'Reviews'],
        ['reports', 'Reports'],
        ['cfg', 'Settings'],
      ]} />
      ${tab === 'reports' && html`<${HRReports} staff=${staff} all=${A.members.filter(m => m.role !== 'employer')} cfg=${cfg} />`}
      ${tab === 'people' && html`<${HREmployees} staff=${staff} cfg=${cfg} />`}
      ${tab === 'requests' && html`<${HRUpdateRequests} staff=${staff} q=${q} />`}
      ${tab === 'org' && html`<${HROrg} staff=${staff} />`}
      ${tab === 'leave' && html`<${HRLeave} staff=${staff} cfg=${cfg} />`}
      ${tab === 'assets' && html`<${KitList} col="hrms/main/assets" fields=${HR_ASSET} cols=${['n', 'kind', 'tag', 'uid', 'out', 'cond']} title="Assets" noun="Asset" empty="No assets recorded" defaults=${{ cond: 'Good' }} />`}
      ${tab === 'reviews' && html`<${KitList} col="hrms/main/rev" fields=${HR_REVIEW} cols=${['uid', 'cyc', 'rating', 'rev', 'st', 'date']} title="Reviews" noun="Review" empty="No reviews yet" defaults=${{ st: 'Draft', rev: P.uid, date: dkey() }} />`}
      ${tab === 'cfg' && html`<${HRSettings} cfg=${cfg} />`}
    </div>`;
}
function HREmployees({ staff, cfg }) {
  const P = usePortal();
  const toast = useToast();
  const [recs, setRecs] = useState(null);
  const [tick, setTick] = useState(0);
  const [edit, setEdit] = useState(null);
  const [q, setQ] = useState('');
  const ids = staff.map(m => m.id).join(',');
  useEffect(() => {
    let live = true;
    const list = ids ? ids.split(',') : [];
    dbGetMany(list.map(id => `hrms/emp/${id}/rec`))
      .then(docs => {
        if (!live) return;
        const o = {};
        list.forEach((id, i) => {
          o[id] = docs[i] || {};
        });
        setRecs(o);
      })
      .catch(() => live && setRecs({}));
    return () => {
      live = false;
    };
  }, [ids, tick]);
  if (!recs) return html`<${Spinner} />`;
  const fields = hrRecFields(cfg);
  const rowOf = m => ({ ...(recs[m.id] || {}), mgrId: (m.r && m.r.mgrId) || '' });
  const needle = q.trim().toLowerCase();
  const list = staff.filter(m => {
    if (!needle) return true;
    const r = rowOf(m);
    return [m.u.p.n, m.u.p.e, r.code, r.dept, r.desig, r.loc].some(x => String(x || '').toLowerCase().includes(needle));
  });
  const save = async v => {
    const { mgrId, ...rec } = v;
    delete rec.id;
    await dbSet(`hrms/emp/${edit.id}/rec`, { ...rec, u: Date.now(), by: P.uid });
    const m = staff.find(x => x.id === edit.id);
    if (((m.r && m.r.mgrId) || '') !== (mgrId || '')) await dbMerge(`r/${edit.id}`, { mgrId: mgrId || null });
    toast('Employee record saved.');
    setTick(t => t + 1);
  };
  const exp = () =>
    saveDownload(
      `employees-${dkey()}.csv`,
      toCSV([
        ['Name', 'Email', ...fields.map(f => f.n)],
        ...list.map(m => [m.u.p.n, m.u.p.e, ...fields.map(f => kitText(f, rowOf(m), P, {}))]),
      ])
    ).catch(() => {});
  const by = {};
  staff.forEach(m => {
    const d = rowOf(m).dept || 'No department';
    by[d] = (by[d] || 0) + 1;
  });
  return html`<div className="stack">
      <${KitStats} items=${[
        { v: staff.length, l: 'People on the team' },
        { v: staff.filter(m => rowOf(m).doj && rowOf(m).doj >= addDays(dkey(), -90)).length, l: 'Joined in the last 90 days' },
        { v: staff.filter(m => !rowOf(m).mgrId).length, l: 'Without a manager', tone: 'warn' },
        { v: Object.keys(by).length, l: 'Departments in use' },
      ]} />
      <div className="toolbar">
        <label className="kitsearch"><${Icon} n="search" /><input type="search" placeholder="Search employees" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Search employees" /></label>
        <div className="push"><button type="button" className="btn ghost" onClick=${exp}><${Icon} n="down" />CSV</button></div>
      </div>
      <section className="panel" style=${{ padding: '6px 8px' }}>
        <div className="tblwrap">
          <table className="tbl click">
            <thead><tr><th>Employee</th><th>ID</th><th>Department</th><th>Designation</th><th>Reports to</th><th>Joined</th><th>Type</th><th>Status</th></tr></thead>
            <tbody>
              ${list.map(m => {
                const r = rowOf(m);
                return html`<tr key=${m.id} tabIndex="0" onClick=${() => setEdit({ id: m.id, ...r })} onKeyDown=${e => e.key === 'Enter' && setEdit({ id: m.id, ...r })}>
                    <td><div className="pcell"><img src=${avatarFor(m.u.p.n, m.id).url} alt="" /><div><b>${m.u.p.n}</b><span className="muted small">${m.u.p.e}</span></div></div></td>
                    <td>${r.code || html`<span className="muted">—</span>`}</td>
                    <td>${r.dept || html`<span className="muted">—</span>`}</td>
                    <td>${r.desig || m.u.p.ti || html`<span className="muted">—</span>`}</td>
                    <td>${kitName(P, r.mgrId) || html`<span className="muted">—</span>`}</td>
                    <td>${r.doj ? fmtDate(r.doj) : html`<span className="muted">—</span>`}</td>
                    <td>${r.type || portalLabel(m.role).replace(' portal', '')}</td>
                    <td><${Chip} s=${!r.st || r.st === 'Active' ? 'ok' : r.st === 'Exited' ? '' : 'new'}>${r.st || 'Active'}<//></td>
                  </tr>`;
              })}
            </tbody>
          </table>
        </div>
      </section>
      ${
        edit &&
        html`<${KitForm} title=${'HR record · ' + staff.find(m => m.id === edit.id).u.p.n} fields=${fields} init=${edit} refs=${{}} onSave=${save} onClose=${() => setEdit(null)} />`
      }
    </div>`;
}
function HROrg({ staff }) {
  const ids = new Set(staff.map(m => m.id));
  const kids = {};
  const roots = [];
  staff.forEach(m => {
    const b = m.r && m.r.mgrId;
    if (b && ids.has(b) && b !== m.id) (kids[b] = kids[b] || []).push(m);
    else roots.push(m);
  });
  const node = (m, depth) =>
    html`<li key=${m.id}>
      <div className="onode">
        <img src=${avatarFor(m.u.p.n, m.id).url} alt="" />
        <div><b>${m.u.p.n}</b><span className="muted small">${(m.r && m.r.ti) || m.u.p.ti || portalLabel(m.role)}</span></div>
        ${(kids[m.id] || []).length ? html`<span className="ocount">${kids[m.id].length}</span>` : null}
      </div>
      ${(kids[m.id] || []).length && depth < 12 ? html`<ul>${kids[m.id].map(k => node(k, depth + 1))}</ul>` : null}
    </li>`;
  const lead = roots.filter(m => (kids[m.id] || []).length);
  const solo = roots.filter(m => !(kids[m.id] || []).length);
  return html`<div className="stack">
      <section className="panel">
        ${
          lead.length
            ? html`<ul className="orgtree">${lead.map(m => node(m, 0))}</ul>`
            : html`<${Empty} title="No reporting lines yet">Set "Reports to" on each employee (Employees tab or Admin › Roles & access) and the chart builds itself.<//>`
        }
      </section>
      ${
        solo.length > 0 &&
        html`<section className="panel stack">
            <h2 className="ph">Not in a reporting line (${solo.length})</h2>
            <div className="chips">${solo.map(m => html`<span key=${m.id} className="tag">${m.u.p.n}</span>`)}</div>
          </section>`
      }
    </div>`;
}
function HRLeave({ staff, cfg }) {
  const types = hrLeaveTypes(cfg);
  const quota = types.reduce((a, t) => a + t[1], 0);
  const year = dkey().slice(0, 4);
  const usedOf = m => {
    let n = 0;
    const byType = {};
    approvedLeaves(m.u, m.r).forEach(l => {
      for (let k = l.f > year + '-01-01' ? l.f : year + '-01-01'; k <= l.t && k <= year + '-12-31'; k = addDays(k, 1)) {
        if (!isWorkDay(k, 'mon-fri')) continue;
        n++;
        const t = l.ty || l.k || 'Leave';
        byType[t] = (byType[t] || 0) + 1;
      }
    });
    return { n, byType };
  };
  return html`<div className="stack">
      <p className="muted small">Approved time off in ${year} (working days), against a yearly allowance of ${quota} days: ${types.map(t => `${t[0]} ${t[1]}`).join(', ')}. Change the allowance under Settings.</p>
      <section className="panel" style=${{ padding: '6px 8px' }}>
        <div className="tblwrap">
          <table className="tbl">
            <thead><tr><th>Employee</th><th className="r">Used</th><th className="r">Left</th><th style=${{ width: '34%' }}>Allowance used</th><th>By type</th></tr></thead>
            <tbody>
              ${staff.map(m => {
                const u = usedOf(m);
                const pct = quota ? Math.min(100, Math.round((u.n / quota) * 100)) : 0;
                return html`<tr key=${m.id}>
                    <td><div className="pcell"><img src=${avatarFor(m.u.p.n, m.id).url} alt="" /><b>${m.u.p.n}</b></div></td>
                    <td className="r">${u.n}</td>
                    <td className="r"><b>${Math.max(0, quota - u.n)}</b></td>
                    <td><div className=${'lmeter' + (pct > 85 ? ' hi' : '')}><span style=${{ width: pct + '%' }}></span></div></td>
                    <td className="small">${Object.entries(u.byType).map(([t, d]) => `${t} ${d}`).join(', ') || html`<span className="muted">—</span>`}</td>
                  </tr>`;
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>`;
}
function HRSettings({ cfg }) {
  const toast = useToast();
  const [f, setF] = useState({ depts: cfg.depts || HR_CFG_DEFAULT.depts, leave: cfg.leave || HR_CFG_DEFAULT.leave });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await dbSet('hrms/x/pub/cfg', { ...cfg, ...f, u: Date.now() });
      toast('HR settings saved.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<section className="panel form" style=${{ maxWidth: 720 }}>
      <div className="row2">
        <${Field} label="Departments" hint="One per line. Used on employee records.">
          <textarea rows="8" value=${f.depts} onInput=${e => setF({ ...f, depts: e.target.value })} />
        <//>
        <${Field} label="Leave allowance per year" hint="One type per line as Name: days, e.g. Sick leave: 6">
          <textarea rows="8" value=${f.leave} onInput=${e => setF({ ...f, leave: e.target.value })} />
        <//>
      </div>
      <div><button type="button" className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save settings'}</button></div>
    </section>`;
}

/* ---- HR reports (v29): headcount, joins and exits, tenure, turnover, time off, reviews ---- */
function HRReports({ staff, all, cfg }) {
  const P = usePortal();
  const [recs, setRecs] = useState(null);
  const reviews = useCol('hrms/main/rev', 'date:desc');
  const ids = all.map(m => m.id).join(',');
  useEffect(() => {
    let live = true;
    const list = ids ? ids.split(',') : [];
    dbGetMany(list.map(id => `hrms/emp/${id}/rec`)).then(docs => { if (!live) return; const o = {}; list.forEach((id, i) => { o[id] = docs[i] || {}; }); setRecs(o); }).catch(() => live && setRecs({}));
    return () => { live = false; };
  }, [ids]);
  if (!recs) return html`<${Spinner} />`;
  const today = dkey();
  const rows = all.map(m => ({ m, r: recs[m.id] || {}, active: m.st !== 'inactive' && (recs[m.id] || {}).st !== 'Exited' }));
  const active = rows.filter(x => x.active);
  const count = (list, key, fallback) => { const o = {}; list.forEach(x => { const k = x.r[key] || fallback; o[k] = (o[k] || 0) + 1; }); return Object.entries(o).sort((a, b) => b[1] - a[1]); };
  const tenureDays = x => (x.r.doj ? daysBetween(x.r.doj, x.r.exit || today) : null);
  const tenures = active.map(tenureDays).filter(v => v != null);
  const avgTenure = tenures.length ? tenures.reduce((a, b) => a + b, 0) / tenures.length / 365 : null;
  const months = Array.from({ length: 12 }, (_, i) => addMonths(mkey(today), i - 11));
  const joins = months.map(mk => rows.filter(x => x.r.doj && mkey(x.r.doj) === mk).length);
  const exits = months.map(mk => rows.filter(x => (x.r.exit && mkey(x.r.exit) === mk) || (!x.r.exit && x.r.st === 'Exited' && x.r.u && mkey(dkey(new Date(x.r.u))) === mk)).length);
  const exitsYear = exits.reduce((a, b) => a + b, 0);
  const turnover = active.length ? Math.round((exitsYear / ((active.length + exitsYear / 2) || 1)) * 100) : 0;
  const probation = active.filter(x => x.r.st === 'Probation');
  const anniversaries = active.filter(x => x.r.doj && x.r.doj.slice(0, 4) < today.slice(0, 4) && x.r.doj.slice(5) >= today.slice(5) && x.r.doj.slice(5) <= addDays(today, 30).slice(5)).sort((a, b) => a.r.doj.slice(5).localeCompare(b.r.doj.slice(5)));
  const starting = active.filter(x => x.r.doj && x.r.doj > today).sort((a, b) => a.r.doj.localeCompare(b.r.doj));
  const noRecord = active.filter(x => !x.r.doj && !x.r.dept);
  // approved time off this year, working days by type (the same count as Leave balances)
  const leaveByType = {};
  const year = today.slice(0, 4);
  active.forEach(x => approvedLeaves(x.m.u, x.m.r).forEach(l => { for (let k = l.f > year + '-01-01' ? l.f : year + '-01-01'; k <= l.t && k <= year + '-12-31'; k = addDays(k, 1)) { if (!isWorkDay(k, 'mon-fri')) continue; const t = l.ty || l.k || 'Leave'; leaveByType[t] = (leaveByType[t] || 0) + 1; } }));
  const revDone = reviews.docs.filter(r => r.st === 'Acknowledged' || r.st === 'Shared with employee');
  const revAvg = revDone.length ? (revDone.reduce((a, r) => a + (+r.rating || 0), 0) / revDone.filter(r => +r.rating).length).toFixed(1) : null;
  const table = (title, pairs) => html`<section className="panel stack"><h2 className="ph">${title}</h2>${pairs.length ? html`<table className="tbl small"><tbody>${pairs.map(([k, n]) => html`<tr key=${k}><td>${k}</td><td className="r num"><b>${n}</b></td><td style=${{ width: '40%' }}><div style=${{ background: 'var(--bg-2, #eef1f6)', borderRadius: 6, height: 10, overflow: 'hidden' }}><div style=${{ width: Math.round((n / Math.max(1, ...pairs.map(p => p[1]))) * 100) + '%', height: '100%', background: 'var(--indigo)' }} /></div></td></tr>`)}</tbody></table>` : html`<p className="muted small">Nothing recorded yet.</p>`}</section>`;
  const exp = () => saveDownload(`headcount-${today}.csv`, toCSV([['Name', 'Email', 'Department', 'Designation', 'Type', 'Status', 'Location', 'Joined', 'Tenure (years)'], ...rows.map(x => [x.m.u.p.n, x.m.u.p.e, x.r.dept || '', x.r.desig || '', x.r.type || '', x.r.st || (x.active ? 'Active' : 'Inactive'), x.r.loc || '', x.r.doj || '', tenureDays(x) != null ? (tenureDays(x) / 365).toFixed(1) : ''])]));
  return html`<div className="stack">
      <${KitStats} items=${[{ v: active.length, l: 'Headcount (active)' }, { v: joins.slice(-3).reduce((a, b) => a + b, 0), l: 'Joined in the last 3 months', tone: 'ok' }, { v: exitsYear, l: 'Exits in the last 12 months', tone: exitsYear ? 'warn' : 'ok' }, { v: turnover + '%', l: 'Annual turnover (approx.)' }, { v: avgTenure != null ? avgTenure.toFixed(1) + ' y' : '—', l: 'Average tenure' }]} />
      <div className="toolbar"><span className="muted small">From the HR records under Employees (date of joining, department, type, status). Fill those in and these reports follow.</span><div className="push"><button type="button" className="btn ghost" onClick=${exp}><${Icon} n="down" />Headcount CSV</button></div></div>
      <div className="g2" style=${{ alignItems: 'start' }}>
        ${table('Headcount by department', count(active, 'dept', 'Not set'))}
        ${table('Headcount by employment type', count(active, 'type', 'Not set'))}
      </div>
      <div className="g2" style=${{ alignItems: 'start' }}>
        ${table('Headcount by location', count(active, 'loc', 'Not set'))}
        ${table('Headcount by status', count(active, 'st', 'Active'))}
      </div>
      <section className="panel stack">
        <h2 className="ph">Joins and exits, last 12 months</h2>
        <div className="tblwrap"><table className="tbl small"><thead><tr><th>Month</th><th className="r">Joined</th><th className="r">Left</th><th className="r">Net</th></tr></thead><tbody>${months.map((mk, i) => html`<tr key=${mk}><td>${monthLabel(mk)}</td><td className="r num">${joins[i]}</td><td className="r num">${exits[i]}</td><td className=${'r num' + (joins[i] - exits[i] < 0 ? ' late' : '')}><b>${joins[i] - exits[i]}</b></td></tr>`)}</tbody></table></div>
      </section>
      <div className="g2" style=${{ alignItems: 'start' }}>
        <section className="panel stack">
          <h2 className="ph">Coming up</h2>
          ${probation.length > 0 && html`<div><b className="small">On probation</b><ul className="list">${probation.map(x => html`<li key=${x.m.id}><div><div className="t">${x.m.u.p.n}</div><div className="m">${x.r.desig || ''}${x.r.doj ? ' · joined ' + fmtDate(x.r.doj) : ''}</div></div></li>`)}</ul></div>`}
          ${starting.length > 0 && html`<div><b className="small">Starting soon</b><ul className="list">${starting.map(x => html`<li key=${x.m.id}><div><div className="t">${x.m.u.p.n}</div><div className="m">${x.r.desig || ''} · starts ${fmtDate(x.r.doj)}</div></div></li>`)}</ul></div>`}
          ${anniversaries.length > 0 && html`<div><b className="small">Work anniversaries in the next 30 days</b><ul className="list">${anniversaries.map(x => { const y = +today.slice(0, 4) - +x.r.doj.slice(0, 4); return html`<li key=${x.m.id}><div><div className="t">${x.m.u.p.n}</div><div className="m">${y} year${y === 1 ? '' : 's'} on ${fmtDate(today.slice(0, 4) + x.r.doj.slice(4))}</div></div></li>`; })}</ul></div>`}
          ${noRecord.length > 0 && html`<div><b className="small">No HR record yet</b><p className="muted small">${noRecord.slice(0, 12).map(x => x.m.u.p.n).join(', ')}${noRecord.length > 12 ? ` and ${noRecord.length - 12} more` : ''}. Add the date of joining and department under Employees.</p></div>`}
          ${!probation.length && !anniversaries.length && !starting.length && !noRecord.length && html`<p className="muted small">Nothing due.</p>`}
        </section>
        <section className="panel stack">
          <h2 className="ph">Time off and reviews this year</h2>
          ${Object.keys(leaveByType).length ? html`<table className="tbl small"><tbody>${Object.entries(leaveByType).map(([k, n]) => html`<tr key=${k}><td>${k}</td><td className="r num">${n} day${n === 1 ? '' : 's'}</td></tr>`)}</tbody></table>` : html`<p className="muted small">No time off recorded this year.</p>`}
          <table className="tbl small"><tbody><tr><td>Reviews shared or acknowledged</td><td className="r num">${revDone.length}</td></tr><tr><td>Average rating</td><td className="r num">${revAvg || '—'}</td></tr><tr><td>Draft reviews</td><td className="r num">${reviews.docs.filter(r => r.st === 'Draft').length}</td></tr></tbody></table>
        </section>
      </div>
    </div>`;
}
