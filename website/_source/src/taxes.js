/* ================= US state taxes, paystub viewer and the state tax table ================= */
/* Published 2025 rates, single filer where a state uses brackets: [name, type, rate % or [[upper limit, rate %]…],
   standard deduction, employee-paid state programs [[name, rate %, wage base (0 = none)]…]]. Types: n = no income
   tax, f = flat, b = brackets. Anything here can be changed under Accounting > Tax settings; check every January. */
const US_STATES = {
  AL: ['Alabama', 'b', [[500, 2], [3000, 4], [1e12, 5]], 3000],
  AK: ['Alaska', 'n'],
  AZ: ['Arizona', 'f', 2.5],
  AR: ['Arkansas', 'b', [[4500, 2], [9100, 4], [1e12, 3.9]], 2410],
  CA: ['California', 'b', [[10756, 1], [25499, 2], [40245, 4], [55866, 6], [70606, 8], [360659, 9.3], [432787, 10.3], [721314, 11.3], [1e12, 12.3]], 5540, [['CA State Disability (SDI)', 1.2, 0]]],
  CO: ['Colorado', 'f', 4.4, 0, [['CO FAMLI paid leave', 0.45, 176100]]],
  CT: ['Connecticut', 'b', [[10000, 2], [50000, 4.5], [100000, 5.5], [200000, 6], [250000, 6.5], [500000, 6.9], [1e12, 6.99]], 0, [['CT Paid Leave', 0.5, 176100]]],
  DE: ['Delaware', 'b', [[2000, 0], [5000, 2.2], [10000, 3.9], [20000, 4.8], [25000, 5.2], [60000, 5.55], [1e12, 6.6]], 3250],
  DC: ['District of Columbia', 'b', [[10000, 4], [40000, 6], [60000, 6.5], [250000, 8.5], [500000, 9.25], [1000000, 9.75], [1e12, 10.75]], 15000],
  FL: ['Florida', 'n'],
  GA: ['Georgia', 'f', 5.39, 12000],
  HI: ['Hawaii', 'b', [[2400, 1.4], [4800, 3.2], [9600, 5.5], [14400, 6.4], [19200, 6.8], [24000, 7.2], [36000, 7.6], [48000, 7.9], [150000, 8.25], [175000, 9], [200000, 10], [1e12, 11]], 2200, [['HI Temporary Disability (TDI)', 0.5, 0]]],
  ID: ['Idaho', 'f', 5.695, 15000],
  IL: ['Illinois', 'f', 4.95],
  IN: ['Indiana', 'f', 3.0],
  IA: ['Iowa', 'f', 3.8],
  KS: ['Kansas', 'b', [[23000, 5.2], [1e12, 5.58]], 3605],
  KY: ['Kentucky', 'f', 4.0, 3160],
  LA: ['Louisiana', 'f', 3.0, 12500],
  ME: ['Maine', 'b', [[26050, 5.8], [61600, 6.75], [1e12, 7.15]], 15000],
  MD: ['Maryland', 'b', [[1000, 2], [2000, 3], [3000, 4], [100000, 4.75], [125000, 5], [150000, 5.25], [250000, 5.5], [1e12, 5.75]], 2700],
  MA: ['Massachusetts', 'f', 5.0, 4400, [['MA Paid Family & Medical Leave', 0.46, 176100]]],
  MI: ['Michigan', 'f', 4.25, 5800],
  MN: ['Minnesota', 'b', [[32570, 5.35], [106990, 6.8], [198630, 7.85], [1e12, 9.85]], 14950],
  MS: ['Mississippi', 'f', 4.4, 2300],
  MO: ['Missouri', 'b', [[1313, 0], [2626, 2], [3939, 2.5], [5252, 3], [6565, 3.5], [7878, 4], [9191, 4.5], [1e12, 4.7]], 15000],
  MT: ['Montana', 'b', [[21100, 4.7], [1e12, 5.9]], 15000],
  NE: ['Nebraska', 'b', [[3700, 2.46], [22170, 3.51], [35730, 5.01], [1e12, 5.2]], 8300],
  NV: ['Nevada', 'n'],
  NH: ['New Hampshire', 'n'],
  NJ: ['New Jersey', 'b', [[20000, 1.4], [35000, 1.75], [40000, 3.5], [75000, 5.525], [500000, 6.37], [1000000, 8.97], [1e12, 10.75]], 1000, [['NJ Unemployment & Workforce (UI/WF/SWF)', 0.425, 43300], ['NJ Disability (TDI)', 0.23, 165400], ['NJ Family Leave (FLI)', 0.33, 165400]]],
  NM: ['New Mexico', 'b', [[5500, 1.7], [11000, 3.2], [16000, 4.7], [210000, 4.9], [1e12, 5.9]], 15000],
  NY: ['New York', 'b', [[8500, 4], [11700, 4.5], [13900, 5.25], [80650, 5.5], [215400, 6], [1077550, 6.85], [5000000, 9.65], [25000000, 10.3], [1e12, 10.9]], 8000, [['NY Paid Family Leave', 0.388, 91373], ['NY Disability (DBL)', 0.5, 6240]]],
  NC: ['North Carolina', 'f', 4.25, 12750],
  ND: ['North Dakota', 'b', [[48475, 0], [244825, 1.95], [1e12, 2.5]], 0],
  OH: ['Ohio', 'b', [[26050, 0], [100000, 2.75], [1e12, 3.5]], 0],
  OK: ['Oklahoma', 'b', [[1000, 0.25], [2500, 0.75], [3750, 1.75], [4900, 2.75], [7200, 3.75], [1e12, 4.75]], 6350],
  OR: ['Oregon', 'b', [[4400, 4.75], [11050, 6.75], [125000, 8.75], [1e12, 9.9]], 2800, [['Paid Leave Oregon', 0.6, 176100]]],
  PA: ['Pennsylvania', 'f', 3.07],
  RI: ['Rhode Island', 'b', [[79900, 3.75], [181650, 4.75], [1e12, 5.99]], 10550, [['RI Temporary Disability (TDI)', 1.2, 89200]]],
  SC: ['South Carolina', 'b', [[3560, 0], [17830, 3], [1e12, 6.2]], 15000],
  SD: ['South Dakota', 'n'],
  TN: ['Tennessee', 'n'],
  TX: ['Texas', 'n'],
  UT: ['Utah', 'f', 4.5],
  VT: ['Vermont', 'b', [[47900, 3.35], [116000, 6.6], [242000, 7.6], [1e12, 8.75]], 7400],
  VA: ['Virginia', 'b', [[3000, 2], [5000, 3], [17000, 5], [1e12, 5.75]], 8000],
  WA: ['Washington', 'n', 0, 0, [['WA Paid Family & Medical Leave', 0.658, 176100], ['WA Cares Fund', 0.58, 0]]],
  WV: ['West Virginia', 'b', [[10000, 2.22], [25000, 2.96], [40000, 3.33], [60000, 4.44], [1e12, 4.82]], 0],
  WI: ['Wisconsin', 'b', [[14320, 3.5], [28640, 4.4], [315310, 5.3], [1e12, 7.65]], 13930],
  WY: ['Wyoming', 'n'],
};
/* The rule for a state: the built-in default with anything saved under Tax settings on top. */
function stateRule(code, s) {
  const d = US_STATES[code];
  const o = ((s && s.states) || {})[code] || {};
  const base = d
    ? { n: d[0], ty: d[1], r: d[1] === 'f' ? d[2] : 0, b: d[1] === 'b' ? d[2] : [], std: d[3] || 0, x: d[4] || [] }
    : { n: code, ty: 'n', r: 0, b: [], std: 0, x: [] };
  return { ...base, ...o };
}
const TAX_GROUPS = [
  ['fed', 'Federal'],
  ['fica', 'FICA (Social Security & Medicare)'],
  ['state', 'State'],
  ['local', 'Local'],
  ['in', 'Statutory'],
];
const taxGroupOf = t => t.g || (/Federal/.test(t.n) ? 'fed' : /Social Security|Medicare/.test(t.n) ? 'fica' : /PF|ESI|TDS|Professional|Provident/.test(t.n) ? 'in' : 'state');

/* The paystub as a page: open, read, print, download or email it. */
function PaystubView({ s, org, onClose, onPdf, onEmail, staff }) {
  s = normStub(s);
  const cur = s.cur || 'USD';
  const m = v => fmtMoney(+v || 0, cur);
  const groups = {};
  (s.taxes || []).forEach(t => {
    const g = taxGroupOf(t);
    (groups[g] = groups[g] || []).push(t);
  });
  const sum = list => r2((list || []).reduce((a, x) => a + (+x.v || 0), 0));
  const print = () => {
    const el = document.getElementById('stubsheet');
    const w = window.open('', '_blank', 'width=900,height=1000');
    if (!w || !el) {
      window.print();
      return;
    }
    /* v83: the name and period come from the person's own profile, so escape them before writing the popup's title. */
    const esc = v => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    w.document.write(
      `<!doctype html><html><head><title>Paystub ${esc(s.n || '')} ${esc(s.period || s.mk || '')}</title><style>body{font:14px/1.5 Arial,sans-serif;color:#111;margin:32px}table{width:100%;border-collapse:collapse;margin:8px 0 16px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #ddd}td.r,th.r{text-align:right}h1{font-size:20px;margin:0 0 4px}h2{font-size:14px;margin:18px 0 4px;text-transform:uppercase;letter-spacing:.05em;color:#555}.stubhead{display:flex;justify-content:space-between;gap:24px}.kp{display:flex;gap:24px;margin:14px 0}.kp div{border:1px solid #ddd;border-radius:8px;padding:10px 14px;flex:1}.kp b{display:block;font-size:18px}.muted{color:#666;font-size:12px}.note{font-size:12px;color:#555}</style></head><body>${el.innerHTML}</body></html>`
    );
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };
  const rows = (list, cls) =>
    (list || []).map((x, i) => html`<tr key=${i} className=${cls || ''}><td>${x.n}</td><td className="r">${m(x.v)}</td></tr>`);
  return html`<${Modal} title="Paystub" onClose=${onClose} wide foot=${html`
      ${onEmail && html`<button type="button" className="btn ghost" onClick=${onEmail}><${Icon} n="mail" />Email it</button>`}
      <button type="button" className="btn ghost" onClick=${print}>Print</button>
      ${onPdf && html`<button type="button" className="btn" onClick=${onPdf}><${Icon} n="down" />Download PDF</button>`}`}>
      <div id="stubsheet" className="stub">
        <div className="stubhead">
          <div>
            <h1>${(org && org.n) || 'StratEdge IT Consulting Inc.'}</h1>
            <div className="muted">${(org && org.addr) || ''}</div>
          </div>
          <div style=${{ textAlign: 'right' }}>
            <b>${s.n}</b>
            <div className="muted">${s.ti || ''}${s.e ? ' · ' + s.e : ''}</div>
            <div className="muted">Pay period ${s.period || s.mk}${s.paidOn ? ' · Paid ' + fmtDate(s.paidOn) : s.payDate ? ' · Pay date ' + fmtDate(s.payDate) : ''} · ${s.method || 'Direct deposit'}${s.wtype && s.wtype !== 'w2' ? ' · ' + (s.wtype === 'c2c' ? 'Corp-to-corp' : '1099 contractor') : ''}</div>
          </div>
        </div>
        <div className="kp">
          <div><span className="muted">Gross pay</span><b>${m(s.gross)}</b></div>
          <div><span className="muted">Taxes</span><b>${m(s.taxT != null ? s.taxT : sum(s.taxes))}</b></div>
          <div><span className="muted">Other deductions</span><b>${m(s.otherT != null ? s.otherT : sum(s.other))}</b></div>
          <div><span className="muted">Net pay</span><b>${m(s.net)}</b></div>
        </div>
        <h2>Earnings</h2>
        <table>
          <thead><tr><th>Item</th><th className="r">Amount</th></tr></thead>
          <tbody>${rows(s.earnings)}<tr><th>Gross pay</th><th className="r">${m(s.gross)}</th></tr></tbody>
        </table>
        <h2>Taxes withheld</h2>
        <table>
          <thead><tr><th>Tax</th><th className="r">Amount</th></tr></thead>
          <tbody>
            ${TAX_GROUPS.filter(([g]) => groups[g]).map(
              ([g, label]) => html`<${Fragment} key=${g}>
                  <tr className="grp"><td colSpan="2"><b>${label}</b><span className="muted"> · ${m(sum(groups[g]))}</span></td></tr>
                  ${rows(groups[g], 'sub')}
                <//>`
            )}
            <tr><th>Total taxes</th><th className="r">${m(s.taxT != null ? s.taxT : sum(s.taxes))}</th></tr>
          </tbody>
        </table>
        ${
          (s.other || []).length > 0 &&
          html`<h2>Other deductions</h2>
            <table><tbody>${rows(s.other)}<tr><th>Total</th><th className="r">${m(s.otherT)}</th></tr></tbody></table>`
        }
        <h2>Year to date</h2>
        <table>
          <tbody>
            <tr><td>Gross pay</td><td className="r">${m(s.ytd && s.ytd.gross)}</td></tr>
            <tr><td>Taxes</td><td className="r">${m(s.ytd && s.ytd.tax)}</td></tr>
            <tr><td>Net pay</td><td className="r">${m(s.ytd && s.ytd.net)}</td></tr>
          </tbody>
        </table>
        ${
          s.pto &&
          html`<h2>Paid time off</h2>
            <table><tbody><tr><td>${s.pto.n || 'PTO'} accrued this period</td><td className="r">${(+s.pto.accrued || 0).toFixed(2)} h</td></tr><tr><td>Balance after this period</td><td className="r">${(+s.pto.bal || 0).toFixed(2)} h</td></tr></tbody></table>`
        }
        ${
          s.wages &&
          s.wtype === 'w2' &&
          (s.pre || []).length > 0 &&
          html`<p className="note">Taxable wages this period: federal ${m(s.wages.fit)}, Social Security/Medicare ${m(s.wages.fica)}, state ${m(s.wages.state)} (pre-tax deductions taken first).</p>`
        }
        ${
          staff &&
          (s.employer || []).length > 0 &&
          html`<h2>Employer cost (not shown to the employee)</h2>
            <table><tbody>${rows(s.employer)}<tr><th>Total employer taxes and contributions</th><th className="r">${m(s.employerT)}</th></tr><tr><th>Cost to company</th><th className="r">${m(s.cost)}</th></tr></tbody></table>`
        }
        ${s.note && html`<p className="note">${s.note}</p>`}
      </div>
    <//>`;
}

/* Accounting > Tax settings > State taxes: every state on one table, editable, with reset. */
function StateTaxTable() {
  const toast = useToast();
  const d = useDoc('org/acct/x/tax');
  const [edit, setEdit] = useState(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  if (d.loading) return html`<${Spinner} />`;
  const us = (d.data && d.data.us) || {};
  const over = us.states || {};
  const codes = Object.keys(US_STATES).filter(c => !q || c.includes(q.toUpperCase()) || US_STATES[c][0].toLowerCase().includes(q.toLowerCase()));
  const save = async (code, rule) => {
    setBusy(true);
    try {
      await dbMerge('org/acct/x/tax', { us: { states: { [code]: rule } } });
      toast(`${US_STATES[code][0]} saved.`);
      setEdit(null);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const reset = async code => {
    setBusy(true);
    try {
      const next = { ...over };
      delete next[code];
      await dbMerge('org/acct/x/tax', { us: { states: null } });
      await dbMerge('org/acct/x/tax', { us: { states: next } });
      toast(`${US_STATES[code][0]} back to the built-in rates.`);
      setEdit(null);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const desc = r =>
    r.ty === 'n'
      ? 'No state income tax'
      : r.ty === 'f'
        ? `Flat ${r.r}%`
        : `${(r.b || []).length} brackets, ${r.b && r.b.length ? r.b[0][1] + '% to ' + r.b[r.b.length - 1][1] + '%' : ''}`;
  return html`<section className="panel stack">
      <div className="toolbar">
        <div>
          <h2 className="ph" style=${{ margin: 0 }}>State taxes</h2>
          <p className="muted small" style=${{ margin: '2px 0 0' }}>Each person's state comes from Team › Tax. Income tax uses the state's flat rate or brackets on annualized pay; state programs (disability, family leave, unemployment) are listed separately on the paystub. Built-in figures are 2025 published rates: confirm them with your CPA each January and edit here.</p>
        </div>
        <label className="kitsearch"><${Icon} n="search" /><input type="search" placeholder="Find a state" value=${q} onInput=${e => setQ(e.target.value)} /></label>
      </div>
      <div className="tblwrap">
        <table className="tbl click">
          <thead><tr><th>State</th><th>Income tax</th><th>Deduction</th><th>Employee programs</th><th></th></tr></thead>
          <tbody>
            ${codes.map(code => {
              const r = stateRule(code, us);
              return html`<tr key=${code} onClick=${() => setEdit({ code, ...r, b: (r.b || []).map(x => x.join(':')).join('\n'), x: (r.x || []).map(x => x.join('|')).join('\n') })}>
                  <td><b>${code}</b> <span className="muted">${r.n}</span>${over[code] ? html` <${Chip} s="new">edited<//>` : null}</td>
                  <td>${desc(r)}</td>
                  <td className="r">${r.std ? fmtMoney(r.std, 'USD') : html`<span className="muted">—</span>`}</td>
                  <td className="small">${(r.x || []).map(x => `${x[0]} ${x[1]}%`).join(' · ') || html`<span className="muted">—</span>`}</td>
                  <td className="r"><button type="button" className="btn ghost sm">Edit</button></td>
                </tr>`;
            })}
          </tbody>
        </table>
      </div>
      ${
        edit &&
        html`<${Modal} title=${US_STATES[edit.code][0] + ' tax rules'} onClose=${() => setEdit(null)} foot=${html`
            ${over[edit.code] && html`<button type="button" className="btn ghost" style=${{ marginRight: 'auto' }} disabled=${busy} onClick=${() => reset(edit.code)}>Reset to built-in</button>`}
            <button type="button" className="btn ghost" onClick=${() => setEdit(null)}>Cancel</button>
            <button type="button" className="btn" disabled=${busy} onClick=${() =>
              save(edit.code, {
                n: edit.n,
                ty: edit.ty,
                r: +edit.r || 0,
                std: +edit.std || 0,
                b: String(edit.b || '')
                  .split('\n')
                  .map(l => l.split(':').map(x => parseFloat(x)))
                  .filter(x => x.length === 2 && !isNaN(x[0]) && !isNaN(x[1])),
                x: String(edit.x || '')
                  .split('\n')
                  .map(l => l.split('|').map(x => x.trim()))
                  .filter(x => x[0] && !isNaN(parseFloat(x[1])))
                  .map(x => [x[0], parseFloat(x[1]), parseFloat(x[2]) || 0]),
              })}>${busy ? 'Saving…' : 'Save'}</button>`}>
            <div className="form">
              <div className="row3">
                <${Field} label="Income tax">
                  <select value=${edit.ty} onChange=${e => setEdit({ ...edit, ty: e.target.value })}>
                    <option value="n">None</option><option value="f">Flat rate</option><option value="b">Brackets</option>
                  </select>
                <//>
                ${edit.ty === 'f' && html`<${Field} label="Rate %"><input type="number" step="0.001" value=${edit.r} onInput=${e => setEdit({ ...edit, r: e.target.value })} /><//>`}
                ${edit.ty !== 'n' && html`<${Field} label="Standard deduction ($/year)"><input type="number" value=${edit.std} onInput=${e => setEdit({ ...edit, std: e.target.value })} /><//>`}
              </div>
              ${
                edit.ty === 'b' &&
                html`<${Field} label="Brackets, one per line as upper limit:rate%" hint="For the top bracket use a very large limit, e.g. 1000000000000:10.75">
                    <textarea rows="6" value=${edit.b} onInput=${e => setEdit({ ...edit, b: e.target.value })} />
                  <//>`
              }
              <${Field} label="Employee-paid state programs, one per line as Name|rate%|wage base" hint="Wage base 0 means the rate applies to all pay. Example: NJ Family Leave (FLI)|0.33|165400">
                <textarea rows="4" value=${edit.x} onInput=${e => setEdit({ ...edit, x: e.target.value })} />
              <//>
            </div>
          <//>`
      }
    </section>`;
}

/* ---- The person's own paystubs (Earnings page). The viewer and PDF builder come from the staff bundle on demand. ---- */
function MyPaystubs() {
  const [view, setView] = useState(null);
  const P = usePortal();
  const toast = useToast();
  const col = useCol(`pays/${P.uid}/items`, 'mk:desc');
  const docs = useMemo(() => col.docs.map(d => ({ ...normStub(d), id: d.id })), [col.docs]);
  const org = (P.settings && P.settings.inv) || {};
  const download = async s => {
    try {
      await loadStaff(); // the PDF builder ships with the staff bundle
      const bytes = await buildPaystubPdf(s, org);
      await saveDownload(`paystub-${s.mk}.pdf`, new Blob([bytes], { type: 'application/pdf' }));
    } catch (e) {
      if (!e || e.code !== 'declined') toast(errText(e), true);
    }
  };
  return html`<section className="panel">
      ${view && html`<${PaystubView} s=${view} org=${org} staff=${false} onClose=${() => setView(null)} onPdf=${() => download(view)} />`}
      <div className="ph-row">
        <h2 className="ph">Paystubs</h2>
      </div>
      ${
        col.loading
          ? html`<${Spinner} />`
          : docs.length
            ? html`<div className="tblwrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Period</th>
                      <th className="r">Gross</th>
                      <th className="r">Taxes</th>
                      <th className="r">Net pay</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    ${docs.map(
                      s => html`<tr key=${s.id}>
                          <td>
                            <b style=${{ fontWeight: 600 }}>
                              ${s.period || monthLabel(s.mk)}
                            </b>
                          </td>
                          <td className="r num">
                            ${fmtMoney(s.gross, s.cur)}
                          </td>
                          <td className="r num">
                            ${fmtMoney(s.taxT, s.cur)}
                          </td>
                          <td className="r num">
                            <b>
                              ${fmtMoney(s.net, s.cur)}
                            </b>
                          </td>
                          <td>
                            <${Chip} s=${s.st === 'paid' ? 'ok' : 'new'}>
                              ${s.st === 'paid' ? 'Paid ' + fmtDate(s.paidOn) : 'Finalized'}
                            <//>
                          </td>
                          <td className="r">
                            <div className="actions" style=${{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                              <button className="btn ghost sm" onClick=${() => setView(s)}>View</button>
                              <button className="btn ghost sm" onClick=${() => download(s)}>
                                <${Icon} n="down" />PDF</button>
                            </div>
                          </td>
                        </tr>`
                    )}
                  </tbody>
                </table>
              </div>`
            : html`<p className="muted small">Your paystubs appear here after each payroll run is finalized.</p>`
      }
    </section>`;
}

/* ================= Earnings hub (v28): direct deposit, W-4, benefits & PTO, tax documents ================= */
/* Bank accounts for direct deposit. Numbers are sealed on the server; only the last four digits come back. */
function DdEditor({ uid, staff }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () =>
    api('dd_get', uid ? { uid } : {})
      .then(r => {
        setD(r);
        setRows(r.accts.map(a => ({ ...a, acct: '' })));
      })
      .catch(e => toast(errText(e), true));
  useEffect(() => {
    load();
  }, [uid]);
  if (!rows) return html`<${Spinner} />`;
  const up = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  // v35: payroll ends a hold early after confirming the change with the person by phone
  const release = async () => {
    const note = window.prompt('How did you confirm this change with them? (for example: called them at the number on file)');
    if (!note) return;
    setBusy(true);
    try {
      const r = await api('dd_release', { uid, note });
      setD(r);
      setRows(r.accts.map(a => ({ ...a, acct: '' })));
      toast('Hold released: payroll now pays into the new account.');
    } catch (e) {
      if (!e || e.code !== 'cancelled') toast(errText(e), true);
    }
    setBusy(false);
  };
  const save = async () => {
    for (const r of rows) {
      if (!/^\d{9}$/.test(r.routing)) return toast('Routing numbers are 9 digits.', true);
      if (!r.last4 && !/^\d{4,17}$/.test(r.acct)) return toast('Enter the account number (4 to 17 digits).', true);
    }
    setBusy(true);
    try {
      const r = await api('dd_save', { ...(uid ? { uid } : {}), accts: rows });
      setD(r);
      setRows(r.accts.map(a => ({ ...a, acct: '' })));
      toast(r.holdUntil ? 'Saved. For your protection the new account is used from ' + fmtDay(r.holdUntil) + '; an email confirms the change.' : rows.length ? 'Direct deposit saved. New accounts get a $0 test deposit (prenote) first.' : 'Direct deposit accounts removed.');
    } catch (e) {
      if (!e || e.code !== 'cancelled') toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<div className="stack">
      ${d && d.frozen && !staff && html`<p className="note amber" style=${{ margin: 0 }}><span>Changes here are stopped after a change you reported. StratEdge payroll will call you and can make the change for you.</span></p>`}
      ${
        d &&
        d.holdUntil > 0 &&
        html`<div className="note amber" style=${{ margin: 0 }}>
          <span><b>New bank details on hold until ${fmtDay(d.holdUntil)}.</b> ${d.paidTo.length ? 'Until then pay goes to the account ending ' + d.paidTo.join(' and ') + '.' : 'Until then payroll pays another way.'} ${staff ? 'Release the hold only after confirming the change by phone at a number already on file (never one from an email).' : 'This protects your pay if someone else changes your details; you were emailed about it.'}</span>
          ${staff && html`<div className="actions"><button className="btn sm" disabled=${busy} onClick=${release}>Release the hold</button></div>`}
        </div>`
      }
      ${
        rows.length
          ? rows.map((r, i) => html`<div key=${r.id || i} className="panel form" style=${{ background: 'var(--surface-2)' }}>
              <div className="row3">
                <${Field} label="Nickname"><input value=${r.n} onInput=${e => up(i, 'n', e.target.value)} placeholder="e.g. Chase checking" /><//>
                <${Field} label="Account type"><select value=${r.type} onChange=${e => up(i, 'type', e.target.value)}><option value="checking">Checking</option><option value="savings">Savings</option></select><//>
                <${Field} label="Routing number (9 digits)"><input value=${r.routing} onInput=${e => up(i, 'routing', e.target.value.replace(/\D/g, ''))} inputMode="numeric" /><//>
              </div>
              <div className="row3">
                <${Field} label="Account number" hint=${r.last4 ? `On file: ••••${r.last4}. Type a new number to replace it.` : ''}><input type="password" value=${r.acct} onInput=${e => up(i, 'acct', e.target.value.replace(/\D/g, ''))} autoComplete="off" inputMode="numeric" placeholder=${r.last4 ? '••••' + r.last4 : ''} /><//>
                <${Field} label="How much goes here"><select value=${r.kind} onChange=${e => up(i, 'kind', e.target.value)}><option value="remainder">Everything that is left</option><option value="amount">A fixed amount</option><option value="percent">A percentage</option></select><//>
                ${r.kind !== 'remainder' ? html`<${Field} label=${r.kind === 'amount' ? 'Amount per pay ($)' : 'Percent of net pay'}><input type="number" step="0.01" value=${r.val} onInput=${e => up(i, 'val', e.target.value)} /><//>` : html`<div />`}
              </div>
              <div className="actions">
                ${r.holdUntil > 0 && html`<${Chip} s="amber">on hold until ${fmtDay(r.holdUntil)}<//>`}
                ${r.prenote && r.last4 ? html`<${Chip} s="amber">awaiting $0 test deposit<//>` : r.last4 ? html`<${Chip} s="ok">verified<//>` : null}
                <button className="btn ghost sm danger" onClick=${() => setRows(rows.filter((x, j) => j !== i))}>Remove account</button>
              </div>
            </div>`)
          : html`<p className="muted small">No bank account on file${staff ? ' for this person' : ''}. Pay is issued by check until one is added.</p>`
      }
      <div className="actions">
        ${rows.length < 4 && html`<button className="btn ghost" onClick=${() => setRows([...rows, { id: '', n: '', type: 'checking', routing: '', acct: '', last4: '', kind: rows.length ? 'amount' : 'remainder', val: '' }])}><${Icon} n="plus" />Add ${rows.length ? 'another' : 'a bank'} account</button>`}
        <button className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save direct deposit'}</button>
        ${d && d.u ? html`<span className="muted small">Last changed ${fmtTs(d.u)}${d.byn ? ' by ' + d.byn : ''}.</span>` : null}
      </div>
      <p className="muted small" style=${{ margin: 0 }}>Find the routing and account numbers on a check or in your bank's app. Split pay across up to four accounts; a new account gets a $0 test deposit (prenote) before the first real pay. Changing an account asks you to confirm it is you, emails you a confirmation, and the new account starts receiving pay after a short hold.</p>
    </div>`;
}
/* Employee self-service W-4 (2020 and later form). */
function W4Form() {
  const P = usePortal();
  const toast = useToast();
  const tax = { ...TAX_PROFILE_DEFAULT, ...obj(P.asg.tax) };
  const [f, setF] = useState({ filing: tax.filing, multi: !!obj(tax.w4).multi, dep: obj(tax.w4).dep || 0, other: obj(tax.w4).other || 0, dedn: obj(tax.w4).dedn || 0, extra: tax.extra || 0, stateExtra: tax.stateExtra || 0, exemptFed: !!tax.exemptFed, method: tax.method || 'Direct deposit' });
  const [busy, setBusy] = useState(false);
  const up = k => e => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  if (tax.country !== 'US') return html`<div className="panel"><p className="muted">Your payroll is outside the US; tax declarations are handled by HR.</p></div>`;
  if ((tax.wtype || 'w2') !== 'w2') return html`<div className="panel"><p className="muted">You are paid as ${tax.wtype === 'c2c' ? 'a corp-to-corp consultant' : 'an independent contractor'}: no taxes are withheld, and your payments are reported on Form 1099-NEC. Keep a W-9 on file with HR.</p></div>`;
  const save = async () => {
    setBusy(true);
    try {
      await api('my_w4_save', { filing: f.filing, w4: { multi: f.multi, dep: f.dep, other: f.other, dedn: f.dedn }, extra: f.extra, stateExtra: f.stateExtra, exemptFed: f.exemptFed, method: f.method });
      toast('W-4 details saved. They apply from the next payroll run.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<section className="panel stack">
      <h2 className="ph">Federal withholding (Form W-4)</h2>
      <p className="muted small" style=${{ margin: 0 }}>The same five steps as the paper W-4. Changing them here is your signed election; HR keeps the record. Not sure? <a href="#/portal/mytax">My taxes</a> shows the refund (or balance) you are heading for and how much to add per paycheck; the IRS Tax Withholding Estimator (irs.gov/W4App) works it out too.</p>
      <div className="form">
        <div className="row2">
          <${Field} label="Step 1(c) · Filing status"><select value=${f.filing} onChange=${up('filing')}><option value="single">Single or Married filing separately</option><option value="married">Married filing jointly or Qualifying surviving spouse</option><option value="head">Head of household</option></select><//>
          <${Field} label="How you are paid"><select value=${f.method} onChange=${up('method')}><option>Direct deposit</option><option>Check</option></select><//>
        </div>
        <label className="check"><input type="checkbox" checked=${f.multi} onChange=${up('multi')} /><span><b>Step 2(c)</b> · Check if you hold more than one job at a time, or you are married filing jointly and your spouse also works (withholds at the higher rate)</span></label>
        <div className="row3">
          <${Field} label="Step 3 · Dependents and other credits ($ a year)" hint="$2,000 per qualifying child under 17 + $500 per other dependent."><input type="number" step="1" value=${f.dep} onInput=${up('dep')} /><//>
          <${Field} label="Step 4(a) · Other income ($ a year)" hint="Interest, dividends, retirement income not from jobs."><input type="number" step="1" value=${f.other} onInput=${up('other')} /><//>
          <${Field} label="Step 4(b) · Deductions ($ a year)" hint="Only if you expect to itemize more than the standard deduction."><input type="number" step="1" value=${f.dedn} onInput=${up('dedn')} /><//>
        </div>
        <div className="row3">
          <${Field} label="Step 4(c) · Extra federal withholding per pay ($)"><input type="number" step="0.01" value=${f.extra} onInput=${up('extra')} /><//>
          <${Field} label="Extra state withholding per pay ($)"><input type="number" step="0.01" value=${f.stateExtra} onInput=${up('stateExtra')} /><//>
          <label className="check" style=${{ alignSelf: 'end', paddingBottom: 12 }}><input type="checkbox" checked=${f.exemptFed} onChange=${up('exemptFed')} /><span>I claim exemption from federal withholding (no tax liability last year and none expected this year)</span></label>
        </div>
        <div className="actions"><button className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save my W-4'}</button><span className="muted small">State: ${tax.stateName ? (US_STATES[tax.stateName] || [tax.stateName])[0] : 'set by HR'}.</span></div>
      </div>
    </section>`;
}
/* What the person is enrolled in, their PTO balance and court orders on file (read-only). */
function MyBenefits() {
  const P = usePortal();
  const plansDoc = useDoc('org/acct/x/plans');
  const ptoDoc = useDoc('org/acct/x/pto');
  const plans = {};
  arr(plansDoc.data && plansDoc.data.items).forEach(p => {
    plans[p.id] = p;
  });
  const ben = arr(P.asg.ben).filter(e => plans[e.plan]);
  const pto = obj(P.asg.pto);
  const pol = arr(ptoDoc.data && ptoDoc.data.policies).find(p => p.id === pto.policy);
  const garn = arr(P.asg.garn);
  if (plansDoc.loading || ptoDoc.loading) return html`<${Spinner} />`;
  return html`<div className="stack">
      <section className="panel stack">
        <h2 className="ph">Benefits you are enrolled in</h2>
        ${
          ben.length
            ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Plan</th><th>Kind</th><th className="r">Your contribution per pay</th><th>Since</th></tr></thead><tbody>${ben.map(e => {
                const p = plans[e.plan];
                const amt = e.ee !== '' && e.ee != null ? +e.ee : +p.eePct > 0 ? `${p.eePct}% of pay` : +p.ee || 0;
                return html`<tr key=${e.plan}><td><b>${p.n}</b></td><td>${(PLAN_KINDS[p.kind] || PLAN_KINDS.other)[0]}${(p.pre || PLAN_KINDS[p.kind][1]) !== 'post' ? ' · pre-tax' : ''}</td><td className="r">${typeof amt === 'number' ? fmtMoney(amt, 'USD') : amt}</td><td>${e.start ? fmtDate(e.start) : ''}</td></tr>`;
              })}</tbody></table></div>`
            : html`<p className="muted small">No benefit enrollments on file. HR enrolls you under Team › Benefits.</p>`
        }
      </section>
      <section className="panel stack">
        <h2 className="ph">Paid time off</h2>
        ${pol ? html`<${KitStats} items=${[{ v: (+pto.bal || 0).toFixed(2) + ' h', l: `${pol.n} balance` }, { v: (+pto.used || 0).toFixed(2) + ' h', l: 'Used this year' }, { v: pol.accrual === 'hour' ? `${pol.rate} h / hour worked` : pol.accrual === 'year' ? `${pol.rate} h / year` : `${pol.rate} h / pay`, l: 'Accrual' }]} />` : html`<p className="muted small">No PTO policy assigned yet.</p>`}
      </section>
      ${garn.length > 0 && html`<section className="panel stack"><h2 className="ph">Court orders on file</h2><div className="tblwrap"><table className="tbl"><thead><tr><th>Kind</th><th>Payee</th><th>Case</th><th className="r">Paid so far</th></tr></thead><tbody>${garn.map((g, i) => html`<tr key=${i}><td>${(GARN_KINDS[g.kind] || GARN_KINDS.other)[0]}</td><td>${g.payee}</td><td>${g.caseNo}</td><td className="r">${fmtMoney(g.paid || 0, 'USD')}${+g.total > 0 ? ' of ' + fmtMoney(g.total, 'USD') : ''}</td></tr>`)}</tbody></table></div></section>`}
    </div>`;
}
/* W-2 / 1099 figures and PDFs for past years. */
function MyPayDocs() {
  const toast = useToast();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear - 1);
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setD(null);
    api('my_tax_form', { year })
      .then(setD)
      .catch(e => toast(errText(e), true));
  }, [year]);
  const download = async (kind, payload) => {
    setBusy(true);
    try {
      await loadStaff();
      const bytes = await buildTaxFormPdf(kind, payload, { year, company: d.company, employees: [], quarters: {}, deposits: [], w3: {} });
      await saveDownload(`${kind}-${year}.pdf`, new Blob([bytes], { type: 'application/pdf' }));
    } catch (e) {
      if (!e || e.code !== 'declined') toast(errText(e), true);
    }
    setBusy(false);
  };
  const M = n => fmtMoney(n, 'USD');
  return html`<section className="panel stack">
      <div className="ph-row"><h2 className="ph">Tax documents</h2><div className="seg">${[thisYear - 2, thisYear - 1, thisYear].map(y => html`<button key=${y} className=${y === year ? 'on' : ''} onClick=${() => setYear(y)}>${y}</button>`)}</div></div>
      ${
        !d
          ? html`<${Spinner} />`
          : d.w2
            ? html`<div className="stack">
                <p className="muted small" style=${{ margin: 0 }}>${year === thisYear ? 'Year to date; the W-2 is final after the last payroll of the year.' : 'Your W-2 for the year, from the paystubs of every pay period paid in it.'}</p>
                <div className="tblwrap"><table className="tbl"><tbody>
                  <tr><td>Box 1 · Wages, tips, other compensation</td><td className="r num">${M(d.w2.box1)}</td></tr>
                  <tr><td>Box 2 · Federal income tax withheld</td><td className="r num">${M(d.w2.box2)}</td></tr>
                  <tr><td>Box 3 / 4 · Social Security wages / tax</td><td className="r num">${M(d.w2.box3)} / ${M(d.w2.box4)}</td></tr>
                  <tr><td>Box 5 / 6 · Medicare wages / tax</td><td className="r num">${M(d.w2.box5)} / ${M(d.w2.box6)}</td></tr>
                  ${d.w2.state && html`<tr><td>Box 16 / 17 · ${d.w2.state} wages / tax</td><td className="r num">${M(d.w2.box16)} / ${M(d.w2.box17)}</td></tr>`}
                </tbody></table></div>
                <div className="actions"><button className="btn" disabled=${busy} onClick=${() => download('w2', d.w2)}><${Icon} n="down" />${busy ? 'Building…' : 'Download W-2 (copies B, C, 2)'}</button>${year >= 2025 && html`<a className="btn ghost" href=${'#/portal/mytax?y=' + year}>${year < thisYear ? 'File your ' + year + ' return in My taxes' : 'Your ' + year + ' tax estimate'}</a>`}</div>
              </div>`
            : d.nec && d.nec.length
              ? html`<div className="stack"><p className="muted small" style=${{ margin: 0 }}>Nonemployee compensation paid to you in ${year}: <b>${M(d.nec[0].total)}</b>${d.nec[0].due ? '' : ' (under $600, no 1099 required)'}.</p><div className="actions"><button className="btn" disabled=${busy} onClick=${() => download('1099', d.nec[0])}><${Icon} n="down" />${busy ? 'Building…' : 'Download 1099-NEC (copy B)'}</button></div></div>`
              : html`<p className="muted small">No US pay recorded for ${year}.</p>`
      }
    </section>`;
}
/* The Earnings page with its tabs. */
function EarningsHub() {
  const P = usePortal();
  const [tab, setTab] = useState('pay');
  const us = payCountry(P.asg.tax, (P.asg.pay && P.asg.pay.cur) || 'USD') === 'US';
  const tabs = [['pay', 'Earnings'], ['dd', 'Direct deposit'], ...(us ? [['w4', 'Tax withholding (W-4)']] : []), ['ben', 'Benefits & time off'], ...(us ? [['docs', 'Tax documents']] : [])];
  return html`<div className="stack">
      <${KitTabs} tabs=${tabs} tab=${tab} onTab=${setTab} />
      ${tab === 'pay' && html`<${Earnings} />`}
      ${tab === 'dd' && html`<section className="panel stack"><h2 className="ph">Direct deposit</h2><${DdEditor} /><//>`}
      ${tab === 'w4' && html`<${W4Form} />`}
      ${tab === 'ben' && html`<${MyBenefits} />`}
      ${tab === 'docs' && html`<${MyPayDocs} />`}
    </div>`;
}
