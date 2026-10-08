/* ================= Payroll (v28): setup, benefits, direct deposit, taxes & filings =================
   Benefit plans and PTO policies live in org/acct/x/plans and org/acct/x/pto; a person's enrollments, garnishments
   and PTO balance on their r/{uid} record (ben, garn, pto); bank accounts behind the dd_* routes (sealed on the
   server); the company's ACH settings behind ach_settings. The pay engine itself is in core.js. */

const PLAN_TAX = { s125: 'Pre-tax (Section 125): before federal, state and FICA', k401: 'Pre-tax 401(k): before federal and state, not FICA', hsa: 'Pre-tax HSA: before federal, state and FICA', post: 'After tax' };
const GARN_LABEL = k => (GARN_KINDS[k] || GARN_KINDS.other)[0];

/* ---- Benefit plans ---- */
function PlansEditor() {
  const toast = useToast();
  const d = useDoc('org/acct/x/plans');
  const [edit, setEdit] = useState(null);
  const items = arr(d.data && d.data.items);
  const save = async list => {
    try {
      await dbMerge('org/acct/x/plans', { items: list, u: Date.now() });
      toast('Plans saved.');
      setEdit(null);
    } catch (e) {
      toast(errText(e), true);
    }
  };
  if (d.loading) return html`<${Spinner} />`;
  const blank = { id: nid(), n: '', kind: 'health', pre: 's125', ee: '', eePct: '', er: '', erPct: '', match: '', matchCap: '', limit: '', active: true };
  return html`<section className="panel stack">
      <div className="ph-row"><h2 className="ph">Benefit plans and deductions</h2><button className="btn sm" onClick=${() => setEdit(blank)}><${Icon} n="plus" />Add a plan</button></div>
      <p className="muted small" style=${{ margin: 0 }}>Health, dental, vision, HSA/FSA, 401(k) and other deductions. Amounts are per pay period; the tax treatment decides which wages they reduce. Enroll people from Team › a person › Benefits.</p>
      ${
        items.length
          ? html`<div className="tblwrap"><table className="tbl">
              <thead><tr><th>Plan</th><th>Kind</th><th>Tax treatment</th><th className="r">Employee / pay</th><th className="r">Employer / pay</th><th>Annual limit</th><th /></tr></thead>
              <tbody>${items.map(p => html`<tr key=${p.id} className=${p.active === false ? 'muted' : ''}>
                  <td><b>${p.n}</b>${p.active === false ? html` <${Chip}>inactive<//>` : null}</td>
                  <td>${(PLAN_KINDS[p.kind] || PLAN_KINDS.other)[0]}</td>
                  <td className="small">${(PLAN_TAX[p.pre || (PLAN_KINDS[p.kind] || PLAN_KINDS.other)[1]] || '').split(':')[0]}</td>
                  <td className="r">${+p.eePct > 0 ? fmtPct(p.eePct) + ' of pay' : fmtMoney(p.ee || 0, 'USD')}</td>
                  <td className="r">${+p.match > 0 ? `${fmtPct(p.match)} match${+p.matchCap > 0 ? ' up to ' + fmtPct(p.matchCap) + ' of pay' : ''}` : +p.erPct > 0 ? fmtPct(p.erPct) + ' of pay' : fmtMoney(p.er || 0, 'USD')}</td>
                  <td>${+p.limit > 0 ? fmtMoney(p.limit, 'USD') : '—'}</td>
                  <td className="r"><button className="btn ghost sm" onClick=${() => setEdit({ ...blank, ...p })}>Edit</button></td>
                </tr>`)}</tbody>
            </table></div>`
          : html`<${Empty} title="No plans yet">Add the plans you offer; each person is then enrolled with their own amount.<//>`
      }
      ${
        edit &&
        html`<${Modal} title=${edit.n ? edit.n : 'New plan'} onClose=${() => setEdit(null)} foot=${html`${items.some(p => p.id === edit.id) && html`<button className="btn ghost danger" onClick=${() => save(items.filter(p => p.id !== edit.id))}>Remove</button>`}<button className="btn ghost" onClick=${() => setEdit(null)}>Cancel</button><button className="btn" onClick=${() => {
          if (!edit.n.trim()) return toast('Name the plan.', true);
          const row = { ...edit, n: edit.n.trim(), ee: r2(edit.ee), eePct: r2(edit.eePct), er: r2(edit.er), erPct: r2(edit.erPct), match: r2(edit.match), matchCap: r2(edit.matchCap), limit: r2(edit.limit) };
          save(items.some(p => p.id === row.id) ? items.map(p => (p.id === row.id ? row : p)) : [...items, row]);
        }}>Save plan</button>`}>
            <div className="form">
              <div className="row2">
                <${Field} label="Plan name"><input value=${edit.n} onInput=${e => setEdit({ ...edit, n: e.target.value })} placeholder="e.g. Aetna PPO, Fidelity 401(k)" /><//>
                <${Field} label="Kind">
                  <select value=${edit.kind} onChange=${e => setEdit({ ...edit, kind: e.target.value, pre: PLAN_KINDS[e.target.value][1] })}>
                    ${Object.entries(PLAN_KINDS).map(([k, [n]]) => html`<option key=${k} value=${k}>${n}</option>`)}
                  </select>
                <//>
              </div>
              <${Field} label="Tax treatment">
                <select value=${edit.pre} onChange=${e => setEdit({ ...edit, pre: e.target.value })}>
                  ${Object.entries(PLAN_TAX).map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}
                </select>
              <//>
              <div className="row2">
                <${Field} label="Employee amount per pay period ($)"><input type="number" step="0.01" value=${edit.ee} onInput=${e => setEdit({ ...edit, ee: e.target.value })} /><//>
                <${Field} label="…or % of gross pay" hint="Used instead of the amount when set."><input type="number" step="0.01" value=${edit.eePct} onInput=${e => setEdit({ ...edit, eePct: e.target.value })} /><//>
              </div>
              <div className="row2">
                <${Field} label="Employer amount per pay period ($)"><input type="number" step="0.01" value=${edit.er} onInput=${e => setEdit({ ...edit, er: e.target.value })} /><//>
                <${Field} label="…or employer % of gross pay"><input type="number" step="0.01" value=${edit.erPct} onInput=${e => setEdit({ ...edit, erPct: e.target.value })} /><//>
              </div>
              ${
                ['k401', 'roth', 'hsa'].includes(edit.kind) &&
                html`<div className="row2">
                    <${Field} label="Employer match (% of the employee's contribution)" hint="100 means dollar for dollar."><input type="number" step="1" value=${edit.match} onInput=${e => setEdit({ ...edit, match: e.target.value })} /><//>
                    <${Field} label="Match up to (% of pay)" hint="e.g. 4 matches contributions up to 4% of pay."><input type="number" step="0.5" value=${edit.matchCap} onInput=${e => setEdit({ ...edit, matchCap: e.target.value })} /><//>
                  </div>`
              }
              <div className="row2">
                <${Field} label="Annual employee limit ($)" hint="Contributions stop at this amount for the year (e.g. the IRS 401(k) or HSA limit)."><input type="number" step="1" value=${edit.limit} onInput=${e => setEdit({ ...edit, limit: e.target.value })} /><//>
                <label className="check" style=${{ alignSelf: 'end', paddingBottom: 12 }}><input type="checkbox" checked=${edit.active !== false} onChange=${e => setEdit({ ...edit, active: e.target.checked })} /><span>Active (offered to employees)</span></label>
              </div>
            </div>
          <//>`
      }
    </section>`;
}

/* ---- PTO policies ---- */
function PtoEditor() {
  const toast = useToast();
  const d = useDoc('org/acct/x/pto');
  const [edit, setEdit] = useState(null);
  const pols = arr(d.data && d.data.policies);
  const save = async list => {
    try {
      await dbMerge('org/acct/x/pto', { policies: list, u: Date.now() });
      toast('PTO policies saved.');
      setEdit(null);
    } catch (e) {
      toast(errText(e), true);
    }
  };
  if (d.loading) return html`<${Spinner} />`;
  const blank = { id: nid(), n: '', kind: 'pto', accrual: 'period', rate: '', cap: '', carry: '', waiting: '' };
  const how = p => (p.accrual === 'hour' ? `${p.rate} h per hour worked` : p.accrual === 'year' ? `${p.rate} h a year, spread over the pay periods` : `${p.rate} h per pay period`);
  return html`<section className="panel stack">
      <div className="ph-row"><h2 className="ph">Paid time off policies</h2><button className="btn sm" onClick=${() => setEdit(blank)}><${Icon} n="plus" />Add a policy</button></div>
      <p className="muted small" style=${{ margin: 0 }}>Hours accrue with each finalized pay run and show on the paystub. Assign a policy and a starting balance from Team › a person › Benefits; approved time off under Time off draws the balance down.</p>
      ${
        pols.length
          ? html`<div className="tblwrap"><table className="tbl">
              <thead><tr><th>Policy</th><th>Type</th><th>Accrual</th><th className="r">Max balance</th><th className="r">Carryover</th><th /></tr></thead>
              <tbody>${pols.map(p => html`<tr key=${p.id}><td><b>${p.n}</b></td><td>${{ pto: 'PTO', vacation: 'Vacation', sick: 'Sick leave' }[p.kind] || p.kind}</td><td>${how(p)}</td><td className="r">${+p.cap > 0 ? p.cap + ' h' : 'none'}</td><td className="r">${+p.carry > 0 ? p.carry + ' h' : p.carry === 0 || p.carry === '0' ? 'none' : 'all'}</td><td className="r"><button className="btn ghost sm" onClick=${() => setEdit({ ...blank, ...p })}>Edit</button></td></tr>`)}</tbody>
            </table></div>`
          : html`<${Empty} title="No PTO policies yet">Add one, for example 4.62 hours per two-week period (15 days a year).<//>`
      }
      ${
        edit &&
        html`<${Modal} title=${edit.n || 'New policy'} onClose=${() => setEdit(null)} foot=${html`${pols.some(p => p.id === edit.id) && html`<button className="btn ghost danger" onClick=${() => save(pols.filter(p => p.id !== edit.id))}>Remove</button>`}<button className="btn ghost" onClick=${() => setEdit(null)}>Cancel</button><button className="btn" onClick=${() => {
          if (!edit.n.trim() || !(+edit.rate > 0)) return toast('Name the policy and set the accrual rate.', true);
          const row = { ...edit, n: edit.n.trim(), rate: +edit.rate, cap: +edit.cap || 0, carry: edit.carry === '' ? '' : +edit.carry, waiting: +edit.waiting || 0 };
          save(pols.some(p => p.id === row.id) ? pols.map(p => (p.id === row.id ? row : p)) : [...pols, row]);
        }}>Save policy</button>`}>
            <div className="form">
              <div className="row2">
                <${Field} label="Policy name"><input value=${edit.n} onInput=${e => setEdit({ ...edit, n: e.target.value })} placeholder="e.g. Standard PTO" /><//>
                <${Field} label="Type"><select value=${edit.kind} onChange=${e => setEdit({ ...edit, kind: e.target.value })}><option value="pto">PTO (combined)</option><option value="vacation">Vacation</option><option value="sick">Sick leave</option></select><//>
              </div>
              <div className="row3">
                <${Field} label="Accrues"><select value=${edit.accrual} onChange=${e => setEdit({ ...edit, accrual: e.target.value })}><option value="period">per pay period</option><option value="hour">per hour worked</option><option value="year">a fixed number of hours a year</option></select><//>
                <${Field} label="Rate (hours)"><input type="number" step="0.01" value=${edit.rate} onInput=${e => setEdit({ ...edit, rate: e.target.value })} /><//>
                <${Field} label="Maximum balance (hours)" hint="Blank for no cap."><input type="number" step="1" value=${edit.cap} onInput=${e => setEdit({ ...edit, cap: e.target.value })} /><//>
              </div>
              <div className="row2">
                <${Field} label="Carryover at year end (hours)" hint="Blank carries everything; 0 resets the balance."><input type="number" step="1" value=${edit.carry} onInput=${e => setEdit({ ...edit, carry: e.target.value })} /><//>
                <${Field} label="Waiting period (days from start date)"><input type="number" step="1" value=${edit.waiting} onInput=${e => setEdit({ ...edit, waiting: e.target.value })} /><//>
              </div>
            </div>
          <//>`
      }
    </section>`;
}

/* ---- Company ACH settings and the prenote ---- */
function AchSettings() {
  const toast = useToast();
  const [c, setC] = useState(null);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState('');
  const load = () =>
    api('ach_settings')
      .then(r => {
        setC(r);
        setF({ ...r, offsetAcct: '' });
      })
      .catch(e => toast(errText(e), true));
  useEffect(() => {
    load();
  }, []);
  if (!f) return html`<${Spinner} />`;
  const up = k => e => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async () => {
    setBusy('save');
    try {
      const r = await api('ach_settings_save', f);
      setC(r);
      setF({ ...r, offsetAcct: '' });
      toast('ACH settings saved.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const prenote = async () => {
    setBusy('pre');
    try {
      const r = await api('pay_nacha', { mk: 'prenote', prenote: true });
      await saveDownload(`prenote-${dkey()}.ach`, new Blob([r.file], { type: 'text/plain' }));
      if (confirm(`Prenote file with ${r.summary.entries} account${r.summary.entries === 1 ? '' : 's'} downloaded. Upload it to your bank, then press OK to mark these accounts as verified (the bank reports problems within 3 banking days).`)) {
        await api('dd_prenoted', { mk: 'prenote' });
        toast('Accounts marked as prenoted.');
      }
    } catch (e) {
      if (!e || e.code !== 'declined') toast(errText(e), true);
    }
    setBusy('');
  };
  return html`<section className="panel stack">
      <h2 className="ph">Direct deposit: your bank's ACH details</h2>
      <p className="muted small" style=${{ margin: 0 }}>From your bank's ACH origination agreement. These go into the header of every direct deposit (NACHA) file; the file is created from a finalized payroll run and uploaded to the bank's business portal. Employees enter their own accounts under Earnings › Direct deposit.</p>
      <div className="form">
        <div className="row2">
          <${Field} label="Bank routing number (immediate destination)" hint="9 digits."><input value=${f.immDest} onInput=${up('immDest')} inputMode="numeric" /><//>
          <${Field} label="Bank name (destination name)"><input value=${f.destName} onInput=${up('destName')} /><//>
        </div>
        <div className="row2">
          <${Field} label="Immediate origin" hint="Usually your 9-digit EIN, or the ID the bank assigned."><input value=${f.immOrigin} onInput=${up('immOrigin')} inputMode="numeric" /><//>
          <${Field} label="Origin name (your company, 23 characters)"><input value=${f.originName} onInput=${up('originName')} maxLength="23" /><//>
        </div>
        <div className="row3">
          <${Field} label="Company name on the batch (16 characters)" hint="What employees see on their statement."><input value=${f.companyName} onInput=${up('companyName')} maxLength="16" /><//>
          <${Field} label="Company ID (10 characters)" hint="Usually 1 followed by the EIN."><input value=${f.companyId} onInput=${up('companyId')} maxLength="10" /><//>
          <${Field} label="ODFI identification (first 8 digits of the bank's routing)"><input value=${f.odfi} onInput=${up('odfi')} inputMode="numeric" maxLength="9" /><//>
        </div>
        <div className="row2">
          <${Field} label="Entry description (10 characters)"><input value=${f.entryDesc} onInput=${up('entryDesc')} maxLength="10" /><//>
          <label className="check" style=${{ alignSelf: 'end', paddingBottom: 12 }}><input type="checkbox" checked=${!!f.balanced} onChange=${up('balanced')} /><span>Balanced file: add the offsetting debit to our account (some banks require it)</span></label>
        </div>
        ${
          f.balanced &&
          html`<div className="row3">
              <${Field} label="Our account: routing"><input value=${f.offsetRouting} onInput=${up('offsetRouting')} inputMode="numeric" /><//>
              <${Field} label="Our account number" hint=${c.hasOffset ? `On file (…${c.offsetLast4}). Leave blank to keep it.` : ''}><input type="password" value=${f.offsetAcct} onInput=${up('offsetAcct')} autoComplete="off" inputMode="numeric" /><//>
              <${Field} label="Type"><select value=${f.offsetType} onChange=${up('offsetType')}><option value="checking">Checking</option><option value="savings">Savings</option></select><//>
            </div>`
        }
        <div className="actions">
          <button className="btn" disabled=${busy === 'save'} onClick=${save}>${busy === 'save' ? 'Saving…' : 'Save ACH settings'}</button>
          <button className="btn ghost" disabled=${busy === 'pre'} onClick=${prenote}><${Icon} n="down" />${busy === 'pre' ? 'Building…' : 'Prenote file for new accounts'}</button>
          <span className="muted small">A prenote is a $0 test entry banks use to confirm new account details before real pay goes out.</span>
        </div>
      </div>
    </section>`;
}

/* ---- Tax accounts: EIN, state IDs and SUTA rates ---- */
function TaxAccounts() {
  const toast = useToast();
  const s = useDoc('org/acct/x/settings');
  const t = useDoc('org/acct/x/tax');
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (s.loading || t.loading || f) return;
    const us = (t.data && t.data.us) || {};
    setF({ ein: (s.data && s.data.ein) || '', stateIds: { ...((s.data && s.data.stateIds) || {}) }, sutaRates: { ...(us.sutaRates || {}) }, sutaBases: { ...(us.sutaBases || {}) }, newState: '' });
  }, [s.loading, t.loading]);
  if (!f) return html`<${Spinner} />`;
  const states = [...new Set([...Object.keys(f.stateIds), ...Object.keys(f.sutaRates)])].sort();
  const setSt = (code, k, v) => setF({ ...f, stateIds: { ...f.stateIds, [code]: { ...(f.stateIds[code] || {}), [k]: v } } });
  const save = async () => {
    setBusy(true);
    try {
      await dbMerge('org/acct/x/settings', { ein: f.ein.trim(), stateIds: f.stateIds });
      const rates = {},
        bases = {};
      Object.entries(f.sutaRates).forEach(([k, v]) => {
        if (+v > 0) rates[k] = r2(v);
      });
      Object.entries(f.sutaBases).forEach(([k, v]) => {
        if (+v > 0) bases[k] = r2(v);
      });
      await dbMerge('org/acct/x/tax', { us: { sutaRates: rates, sutaBases: bases } });
      toast('Tax accounts saved.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<section className="panel stack">
      <h2 className="ph">Tax accounts</h2>
      <p className="muted small" style=${{ margin: 0 }}>Your federal EIN prints on W-2s and 1099s. For each state you pay people in: the withholding account number, the unemployment (SUTA) account number, and the SUTA rate and wage base the state assigned you (used in employer cost on every paystub).</p>
      <div className="form">
        <${Field} label="Federal EIN" hint="Format 12-3456789."><input value=${f.ein} onInput=${e => setF({ ...f, ein: e.target.value })} style=${{ maxWidth: 240 }} /><//>
        <div className="tblwrap"><table className="tbl">
          <thead><tr><th>State</th><th>Withholding account</th><th>Unemployment account</th><th>SUTA rate %</th><th>SUTA wage base $</th><th /></tr></thead>
          <tbody>
            ${states.map(code => html`<tr key=${code}>
                <td><b>${code}</b> <span className="muted small">${(US_STATES[code] || [''])[0]}</span></td>
                <td><input value=${(f.stateIds[code] || {}).wh || ''} onInput=${e => setSt(code, 'wh', e.target.value)} /></td>
                <td><input value=${(f.stateIds[code] || {}).ui || ''} onInput=${e => setSt(code, 'ui', e.target.value)} /></td>
                <td><input type="number" step="0.01" value=${f.sutaRates[code] || ''} onInput=${e => setF({ ...f, sutaRates: { ...f.sutaRates, [code]: e.target.value } })} style=${{ width: 100 }} /></td>
                <td><input type="number" step="1" value=${f.sutaBases[code] || ''} onInput=${e => setF({ ...f, sutaBases: { ...f.sutaBases, [code]: e.target.value } })} style=${{ width: 120 }} /></td>
                <td className="r"><button className="btn ghost sm" onClick=${() => {
                  const ids = { ...f.stateIds }, r = { ...f.sutaRates }, b = { ...f.sutaBases };
                  delete ids[code]; delete r[code]; delete b[code];
                  setF({ ...f, stateIds: ids, sutaRates: r, sutaBases: b });
                }}>Remove</button></td>
              </tr>`)}
          </tbody>
        </table></div>
        <div className="actions">
          <select value=${f.newState} onChange=${e => setF({ ...f, newState: e.target.value })} style=${{ maxWidth: 260 }}>
            <option value="">Add a state…</option>
            ${Object.keys(US_STATES).filter(c => !states.includes(c)).map(c => html`<option key=${c} value=${c}>${c} · ${US_STATES[c][0]}</option>`)}
          </select>
          <button className="btn ghost" disabled=${!f.newState} onClick=${() => setF({ ...f, stateIds: { ...f.stateIds, [f.newState]: { wh: '', ui: '' } }, newState: '' })}>Add</button>
          <button className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save tax accounts'}</button>
        </div>
      </div>
    </section>`;
}

function PayCalendarCard() {
  const P = usePortal();
  const sch = paySched(P.settings);
  const cal = payCalendar(sch, 8);
  return html`<section className="panel stack">
      <div className="ph-row"><h2 className="ph">Pay calendar</h2><a className="btn ghost sm" href="#/portal/admin/attendance">Change the schedule</a></div>
      <p className="muted small" style=${{ margin: 0 }}>${PAY_FREQS[sch.freq][0]}; pay day ${sch.lag} day${sch.lag === 1 ? '' : 's'} after the period ends. The schedule is set under Team attendance › Payroll settings.</p>
      <div className="tblwrap"><table className="tbl"><thead><tr><th>Pay period</th><th>Pay day</th></tr></thead><tbody>${cal.map(c => html`<tr key=${c.key}><td>${c.label}</td><td>${fmtDate(c.payDate, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</td></tr>`)}</tbody></table></div>
    </section>`;
}

function PayrollSetupPage() {
  const [tab, setTab] = useState('calendar');
  return html`<div className="stack">
      <${KitTabs} tabs=${[['calendar', 'Pay calendar'], ['plans', 'Benefit plans'], ['pto', 'PTO policies'], ['ach', 'Direct deposit (ACH)'], ['taxids', 'Tax accounts']]} tab=${tab} onTab=${setTab} />
      ${tab === 'calendar' && html`<${PayCalendarCard} />`}
      ${tab === 'plans' && html`<${PlansEditor} />`}
      ${tab === 'pto' && html`<${PtoEditor} />`}
      ${tab === 'ach' && html`<${AchSettings} />`}
      ${tab === 'taxids' && html`<${TaxAccounts} />`}
    </div>`;
}

/* ---- A person's benefits, garnishments, PTO and bank accounts (Team › person › Benefits) ---- */
function BenefitsForm({ m }) {
  const toast = useToast();
  const plansDoc = useDoc('org/acct/x/plans');
  const ptoDoc = useDoc('org/acct/x/pto');
  const plans = arr(plansDoc.data && plansDoc.data.items).filter(p => p.active !== false);
  const pols = arr(ptoDoc.data && ptoDoc.data.policies);
  const r = m.r || {};
  const [ben, setBen] = useState(arr(r.ben));
  const [garn, setGarn] = useState(arr(r.garn));
  const [pto, setPto] = useState({ policy: '', bal: 0, used: 0, ...obj(r.pto) });
  const [busy, setBusy] = useState(false);
  const enrolled = id => ben.find(e => e.plan === id);
  const toggle = p => setBen(enrolled(p.id) ? ben.filter(e => e.plan !== p.id) : [...ben, { plan: p.id, ee: '', start: dkey(), end: '' }]);
  const upBen = (id, k, v) => setBen(ben.map(e => (e.plan === id ? { ...e, [k]: v } : e)));
  const save = async () => {
    setBusy(true);
    try {
      await dbMerge(`r/${m.id}`, {
        ben: ben.map(e => ({ plan: e.plan, ee: e.ee === '' || e.ee == null ? '' : r2(e.ee), eePct: e.eePct ? r2(e.eePct) : '', start: e.start || '', end: e.end || '' })),
        garn: garn.filter(g => g.kind).map(g => ({ ...g, id: g.id || nid(), amt: r2(g.amt), pct: r2(g.pct), cap: r2(g.cap), total: r2(g.total), paid: r2(g.paid) })),
        pto: pto.policy ? { policy: pto.policy, bal: Math.round((+pto.bal || 0) * 100) / 100, used: Math.round((+pto.used || 0) * 100) / 100, asOf: obj(r.pto).asOf || '' } : null,
      });
      toast('Benefits saved.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  if (plansDoc.loading || ptoDoc.loading) return html`<${Spinner} />`;
  return html`<div className="stack">
      <section className="panel stack">
        <h2 className="ph">Benefit plans</h2>
        ${
          plans.length
            ? html`<div className="tblwrap"><table className="tbl">
                <thead><tr><th /><th>Plan</th><th>Employee / pay</th><th>Start</th><th>End</th></tr></thead>
                <tbody>${plans.map(p => {
                  const e = enrolled(p.id);
                  return html`<tr key=${p.id}>
                      <td><input type="checkbox" checked=${!!e} onChange=${() => toggle(p)} /></td>
                      <td><b>${p.n}</b><div className="muted small">${(PLAN_KINDS[p.kind] || PLAN_KINDS.other)[0]} · ${(PLAN_TAX[p.pre || PLAN_KINDS[p.kind][1]] || '').split(':')[0]} · default ${+p.eePct > 0 ? fmtPct(p.eePct) + ' of pay' : fmtMoney(p.ee || 0, 'USD')}</div></td>
                      <td>${e && html`<input type="number" step="0.01" placeholder=${+p.eePct > 0 ? 'plan %' : 'plan amount'} value=${e.ee} onInput=${ev => upBen(p.id, 'ee', ev.target.value)} style=${{ width: 120 }} />`}</td>
                      <td>${e && html`<input type="date" value=${e.start || ''} onInput=${ev => upBen(p.id, 'start', ev.target.value)} />`}</td>
                      <td>${e && html`<input type="date" value=${e.end || ''} onInput=${ev => upBen(p.id, 'end', ev.target.value)} />`}</td>
                    </tr>`;
                })}</tbody>
              </table></div>`
            : html`<p className="muted small">No plans set up yet (Accounting › Payroll setup › Benefit plans).</p>`
        }
      </section>
      <section className="panel stack">
        <div className="ph-row"><h2 className="ph">Garnishments and court orders</h2><button className="btn ghost sm" onClick=${() => setGarn([...garn, { id: nid(), kind: 'child', payee: '', caseNo: '', amt: '', pct: '', cap: '', total: '', paid: 0, start: dkey(), end: '' }])}><${Icon} n="plus" />Add</button></div>
        <p className="muted small" style=${{ margin: 0 }}>Taken after taxes from disposable pay, within the federal (CCPA) limits for each kind: child support up to 50–65%, student loans 15%, creditor orders 25% (or the amount above 30× the minimum wage). Child support is taken first.</p>
        ${garn.map((g, i) => html`<div key=${g.id || i} className="panel form" style=${{ background: 'var(--surface-2)' }}>
            <div className="row3">
              <${Field} label="Kind"><select value=${g.kind} onChange=${e => setGarn(garn.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x)))}>${Object.entries(GARN_KINDS).map(([k, [n]]) => html`<option key=${k} value=${k}>${n}</option>`)}</select><//>
              <${Field} label="Payee (agency or creditor)"><input value=${g.payee} onInput=${e => setGarn(garn.map((x, j) => (j === i ? { ...x, payee: e.target.value } : x)))} /><//>
              <${Field} label="Case / order number"><input value=${g.caseNo} onInput=${e => setGarn(garn.map((x, j) => (j === i ? { ...x, caseNo: e.target.value } : x)))} /><//>
            </div>
            <div className="row3">
              <${Field} label="Amount per pay ($)"><input type="number" step="0.01" value=${g.amt} onInput=${e => setGarn(garn.map((x, j) => (j === i ? { ...x, amt: e.target.value } : x)))} /><//>
              <${Field} label="…or % of disposable pay"><input type="number" step="0.1" value=${g.pct} onInput=${e => setGarn(garn.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))} /><//>
              <${Field} label="Cap (% of disposable)" hint=${`Blank uses the legal default for ${GARN_LABEL(g.kind).toLowerCase()} (${(GARN_KINDS[g.kind] || GARN_KINDS.other)[1]}%).`}><input type="number" step="1" value=${g.cap} onInput=${e => setGarn(garn.map((x, j) => (j === i ? { ...x, cap: e.target.value } : x)))} /><//>
            </div>
            <div className="row3">
              <${Field} label="Total owed ($, blank if ongoing)"><input type="number" step="0.01" value=${g.total} onInput=${e => setGarn(garn.map((x, j) => (j === i ? { ...x, total: e.target.value } : x)))} /><//>
              <${Field} label="Paid so far ($)"><input type="number" step="0.01" value=${g.paid} onInput=${e => setGarn(garn.map((x, j) => (j === i ? { ...x, paid: e.target.value } : x)))} /><//>
              <div className="row2" style=${{ gap: 8 }}>
                <${Field} label="From"><input type="date" value=${g.start || ''} onInput=${e => setGarn(garn.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} /><//>
                <${Field} label="Until"><input type="date" value=${g.end || ''} onInput=${e => setGarn(garn.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} /><//>
              </div>
            </div>
            <div><button className="btn ghost sm danger" onClick=${() => setGarn(garn.filter((x, j) => j !== i))}>Remove this order</button></div>
          </div>`)}
      </section>
      <section className="panel stack">
        <h2 className="ph">Paid time off</h2>
        <div className="row3">
          <${Field} label="Policy"><select value=${pto.policy} onChange=${e => setPto({ ...pto, policy: e.target.value })}><option value="">None</option>${pols.map(p => html`<option key=${p.id} value=${p.id}>${p.n}</option>`)}</select><//>
          <${Field} label="Current balance (hours)"><input type="number" step="0.25" value=${pto.bal} onInput=${e => setPto({ ...pto, bal: e.target.value })} /><//>
          <${Field} label="Used this year (hours)"><input type="number" step="0.25" value=${pto.used} onInput=${e => setPto({ ...pto, used: e.target.value })} /><//>
        </div>
      </section>
      <div className="actions"><button className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save benefits, orders and PTO'}</button></div>
      <section className="panel stack">
        <h2 className="ph">Direct deposit accounts</h2>
        <${DdEditor} uid=${m.id} staff=${true} />
      </section>
    </div>`;
}

/* ---- Direct deposit and the register, from a finalized run ---- */
function DdActions({ mk, run }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [sum, setSum] = useState(null);
  const build = async () => {
    setBusy('ach');
    try {
      const r = await api('pay_nacha', { mk });
      await saveDownload(`payroll-${r.summary.payDate}.ach`, new Blob([r.file], { type: 'text/plain' }));
      setSum(r.summary);
      toast(`ACH file: ${r.summary.entries} deposit${r.summary.entries === 1 ? '' : 's'}, ${fmtMoney(r.summary.total, 'USD')}.`);
    } catch (e) {
      if (!e || e.code !== 'declined') toast(errText(e), true);
    }
    setBusy('');
  };
  const csv = async () => {
    setBusy('csv');
    try {
      // v35: through api() so "Confirm it's you" and the data-theft guard apply like everywhere else
      await saveDownload(`direct-deposit-${mk}.csv`, await api('pay_dd_register', { mk }, { blob: true }));
    } catch (e) {
      if (!e || e.code !== 'declined') toast(errText(e), true);
    }
    setBusy('');
  };
  const ach = run && run.ach;
  return html`<div className="stack" style=${{ gap: 8 }}>
      <div className="actions">
        <button className="btn" disabled=${!!busy} onClick=${build}><${Icon} n="down" />${busy === 'ach' ? 'Building…' : 'Direct deposit file (ACH)'}</button>
        <button className="btn ghost" disabled=${!!busy} onClick=${csv}>${busy === 'csv' ? 'Building…' : 'Deposit register (CSV)'}</button>
        ${ach && html`<span className="muted small">Last file: ${fmtTs(ach.at)} by ${ach.byn || ''} · ${ach.entries} deposits · ${fmtMoney(ach.total, 'USD')}</span>`}
      </div>
      ${
        sum &&
        (sum.holds || []).length > 0 &&
        html`<div className="note amber">
            <span><b>Bank account changes on hold:</b> ${sum.holds.map(x => x.n + (x.prev ? ' (paid to the previous account)' : ' (not in the file: pay another way)') + ' until ' + fmtDay(x.until)).join('; ')}. Release a hold early under Payroll setup only after confirming the change by phone at a number already on file.</span>
          </div>`
      }
      ${
        sum &&
        (sum.missing.length > 0 || sum.checks.length > 0) &&
        html`<div className="note amber">
            <span>${sum.missing.length > 0 ? `${sum.missing.map(x => x.n).join(', ')} ${sum.missing.length === 1 ? 'has' : 'have'} no bank account on file and ${sum.missing.length === 1 ? 'is' : 'are'} not in the file. ` : ''}${sum.checks.length > 0 ? `${sum.checks.map(x => x.n).join(', ')} ${sum.checks.length === 1 ? 'is' : 'are'} paid by ${sum.checks[0].method.toLowerCase()}.` : ''}</span>
          </div>`
      }
    </div>`;
}

/* ---- Taxes & filings ---- */
const Q_LABEL = { 1: 'Q1 (Jan–Mar)', 2: 'Q2 (Apr–Jun)', 3: 'Q3 (Jul–Sep)', 4: 'Q4 (Oct–Dec)' };
function TaxFilingsPage() {
  const P = usePortal();
  const toast = useToast();
  const [year, setYear] = useState(new Date().getFullYear());
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState('941');
  const [dep, setDep] = useState(null);
  const [busy, setBusy] = useState('');
  const load = () =>
    api('pay_tax_summary', { year })
      .then(r => {
        setD(r);
        setErr(null);
      })
      .catch(setErr);
  useEffect(() => {
    setD(null);
    load();
  }, [year]);
  if (err && !d) return html`<${LoadError} error=${err} onRetry=${load} />`;
  if (!d) return html`<${Spinner} label="Adding up the year's paystubs…" />`;
  const M = n => fmtMoney(n, 'USD');
  const depFor = (kind, period, state) => d.deposits.filter(x => x.kind === kind && (!period || x.period === period) && (!state || x.state === state)).reduce((a, x) => a + (+x.a || 0), 0);
  const saveDep = async () => {
    setBusy('dep');
    try {
      await api('taxdep_save', dep);
      toast('Deposit recorded.');
      setDep(null);
      await load();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const pdf = async (kind, payload) => {
    setBusy(kind);
    try {
      const bytes = await buildTaxFormPdf(kind, payload, d);
      await saveDownload(`${kind}-${year}${payload && payload.n ? '-' + payload.n.replace(/[^A-Za-z0-9]+/g, '_') : ''}.pdf`, new Blob([bytes], { type: 'application/pdf' }));
    } catch (e) {
      if (!e || e.code !== 'declined') toast(errText(e), true);
    }
    setBusy('');
  };
  const yearTotal = Object.values(d.quarters).reduce((a, q) => a + q.liability, 0);
  const depTotal = d.deposits.filter(x => x.kind === '941').reduce((a, x) => a + (+x.a || 0), 0);
  return html`<div className="stack">
      <div className="toolbar">
        <div className="seg">${[year - 2, year - 1, year, year + 1].filter(y => y <= new Date().getFullYear()).map(y => html`<button key=${y} className=${y === year ? 'on' : ''} onClick=${() => setYear(y)}>${y}</button>`)}</div>
        <div className="push"><button className="btn ghost sm" onClick=${load}><${Icon} n="refresh" />Refresh</button><button className="btn sm" onClick=${() => setDep({ kind: '941', period: 'Q' + Math.ceil((new Date().getMonth() + 1) / 3), d: dkey(), a: '', conf: '', state: '', note: '' })}><${Icon} n="plus" />Record a tax deposit</button></div>
      </div>
      <${KitStats} items=${[
        { v: M(Object.values(d.quarters).reduce((a, q) => a + q.wages, 0)), l: `W-2 wages paid in ${year}` },
        { v: M(yearTotal), l: 'Federal 941 liability (tax withheld + employer FICA)' },
        { v: M(depTotal), l: 'Federal deposits recorded', tone: depTotal + 0.005 < yearTotal ? 'warn' : 'ok' },
        { v: d.employees.length, l: 'W-2 employees' },
        { v: d.nec.filter(c => c.due).length, l: '1099-NEC recipients ($600+)' },
      ]} />
      <div className="note info"><span><b>How to file.</b> These are the figures your payroll tax filings need, computed from the paystubs. File Form 941 each quarter and Form 940 once a year through IRS e-file or your payroll tax service, deposit withheld taxes on the IRS schedule (EFTPS), and give W-2s and 1099-NECs out by January 31 (the SSA/IRS copies are e-filed). Record each deposit here so the liability and what was paid stay side by side. Figures to confirm with your CPA.</span></div>
      <${KitTabs} tabs=${[['941', 'Form 941 (quarterly)'], ['940', 'Form 940 (FUTA)'], ['states', 'States'], ['w2', `W-2 / W-3 (${d.employees.length})`], ['1099', `1099-NEC (${d.nec.length})`], ['deposits', `Deposits (${d.deposits.length})`]]} tab=${tab} onTab=${setTab} />
      ${
        tab === '941' &&
        html`<div className="g2" style=${{ alignItems: 'start' }}>
            ${[1, 2, 3, 4].map(i => {
              const q = d.quarters[i];
              const paid = depFor('941', 'Q' + i);
              return html`<section key=${i} className="panel stack">
                  <div className="ph-row"><h2 className="ph">${Q_LABEL[i]}</h2><button className="btn ghost sm" disabled=${!!busy} onClick=${() => pdf('941', { q: i })}><${Icon} n="down" />Worksheet PDF</button></div>
                  <table className="tbl small">
                    <tbody>
                      <tr><td>Line 2 · Wages, tips, other compensation</td><td className="r num">${M(q.fitW)}</td></tr>
                      <tr><td>Line 3 · Federal income tax withheld</td><td className="r num">${M(q.fit)}</td></tr>
                      <tr><td>Line 5a · Taxable Social Security wages</td><td className="r num">${M(q.ssW)} <span className="muted">× 12.4% = ${M(q.ssEE + q.ssER)}</span></td></tr>
                      <tr><td>Line 5c · Taxable Medicare wages</td><td className="r num">${M(q.medW)} <span className="muted">× 2.9% = ${M(q.medEE + q.medER)}</span></td></tr>
                      ${q.medAdd > 0 && html`<tr><td>Line 5d · Additional Medicare withheld</td><td className="r num">${M(q.medAdd)}</td></tr>`}
                      <tr><th>Line 12 · Total taxes after adjustments</th><th className="r num">${M(q.liability)}</th></tr>
                      <tr><td>Line 13 · Deposits recorded for the quarter</td><td className="r num">${M(paid)}</td></tr>
                      <tr><th>${paid + 0.005 >= q.liability ? 'Line 15 · Overpayment' : 'Line 14 · Balance due'}</th><th className="r num">${M(Math.abs(q.liability - paid))}</th></tr>
                    </tbody>
                  </table>
                  <p className="muted small" style=${{ margin: 0 }}>Monthly liability (Line 16 / Schedule B): ${Object.entries(q.byMonth).map(([mo, v]) => `${new Date(year, +mo - 1, 1).toLocaleDateString([], { month: 'short' })} ${M(v)}`).join(' · ') || '—'}</p>
                </section>`;
            })}
          </div>`
      }
      ${
        tab === '940' &&
        html`<section className="panel stack">
            <div className="ph-row"><h2 className="ph">Form 940 · Federal unemployment (FUTA) for ${year}</h2><button className="btn ghost sm" disabled=${!!busy} onClick=${() => pdf('940', {})}><${Icon} n="down" />Worksheet PDF</button></div>
            <table className="tbl small"><tbody>
              <tr><td>Line 3 · Total payments to all employees</td><td className="r num">${M(Object.values(d.quarters).reduce((a, q) => a + q.wages, 0))}</td></tr>
              <tr><td>Line 7 · Total taxable FUTA wages (first $7,000 per person)</td><td className="r num">${M(Object.values(d.quarters).reduce((a, q) => a + q.futaW, 0))}</td></tr>
              <tr><th>Line 8 · FUTA tax before adjustments (0.6%)</th><th className="r num">${M(Object.values(d.quarters).reduce((a, q) => a + q.futa, 0))}</th></tr>
              ${[1, 2, 3, 4].map(i => html`<tr key=${i}><td>Line 16 · ${Q_LABEL[i]} liability</td><td className="r num">${M(d.quarters[i].futa)}</td></tr>`)}
              <tr><td>Deposits recorded (940)</td><td className="r num">${M(depFor('940'))}</td></tr>
            </tbody></table>
            <p className="muted small" style=${{ margin: 0 }}>Deposit FUTA quarterly when the liability passes $500; otherwise pay with the annual return (due January 31). States with a FUTA credit reduction add a line 11 adjustment: confirm with your CPA.</p>
          </section>`
      }
      ${
        tab === 'states' &&
        html`<section className="panel stack">
            <h2 className="ph">State withholding and unemployment</h2>
            ${
              d.states.length
                ? html`<div className="tblwrap"><table className="tbl">
                    <thead><tr><th>State</th><th className="r">Wages</th><th className="r">Income tax withheld</th><th className="r">Other programs (SDI/PFL…)</th><th className="r">SUTA (employer)</th><th className="r">Withholding deposits</th><th className="r">SUTA deposits</th><th>Accounts</th></tr></thead>
                    <tbody>${d.states.map(s => {
                      const ids = (d.company.stateIds || {})[s.code] || {};
                      return html`<tr key=${s.code}><td><b>${s.code}</b> ${(US_STATES[s.code] || [''])[0]}<div className="muted small">${s.people} people · by quarter: ${[1, 2, 3, 4].map(i => `Q${i} ${M(s.quarters[i].wh)}`).join(' · ')}</div></td><td className="r num">${M(s.wages)}</td><td className="r num">${M(s.wh)}</td><td className="r num">${M(s.programs)}</td><td className="r num">${M(s.suta)}</td><td className="r num">${M(depFor('state-wh', '', s.code))}</td><td className="r num">${M(depFor('suta', '', s.code))}</td><td className="small">${ids.wh ? 'WH ' + ids.wh : ''}${ids.ui ? ' · UI ' + ids.ui : ''}${!ids.wh && !ids.ui ? html`<a href="#/portal/admin/paysetup">add</a>` : ''}</td></tr>`;
                    })}</tbody>
                  </table></div>`
                : html`<${Empty} title="No state wages this year">Set each person's state under Team › Tax so state withholding and SUTA are computed.<//>`
            }
          </section>`
      }
      ${
        tab === 'w2' &&
        html`<section className="panel stack">
            <div className="ph-row"><h2 className="ph">W-2 for each employee, W-3 totals</h2><div className="actions"><button className="btn ghost sm" disabled=${!!busy} onClick=${() => pdf('w3', {})}><${Icon} n="down" />W-3 worksheet</button><button className="btn sm" disabled=${!!busy || !d.employees.length} onClick=${() => pdf('w2all', {})}><${Icon} n="down" />All W-2s (one PDF)</button></div></div>
            <p className="muted small" style=${{ margin: 0 }}>Employee copies B, C and 2 print on plain paper. Copy A goes to the SSA by e-file (Business Services Online) or on the official red form; the figures are the same. Employer EIN: ${d.company.ein || html`<a href="#/portal/admin/paysetup">add it under Tax accounts</a>`}.</p>
            <div className="tblwrap"><table className="tbl">
              <thead><tr><th>Employee</th><th className="r">Box 1 wages</th><th className="r">Box 2 federal tax</th><th className="r">Box 3 SS wages</th><th className="r">Box 4 SS tax</th><th className="r">Box 5 Medicare wages</th><th className="r">Box 6 Medicare tax</th><th>Box 12</th><th>State (16/17)</th><th /></tr></thead>
              <tbody>${d.employees.map(e => html`<tr key=${e.uid}><td><b>${e.n}</b><div className="muted small">${e.e}${e.addr ? ' · ' + e.addr : ''}${e.retire ? ' · retirement plan' : ''}</div></td><td className="r num">${M(e.box1)}</td><td className="r num">${M(e.box2)}</td><td className="r num">${M(e.box3)}</td><td className="r num">${M(e.box4)}</td><td className="r num">${M(e.box5)}</td><td className="r num">${M(e.box6)}</td><td className="small">${Object.entries(e.box12).filter(([, v]) => v > 0).map(([c, v]) => `${c} ${M(v)}`).join(' · ') || '—'}</td><td className="small">${e.state ? `${e.state} ${M(e.box16)} / ${M(e.box17)}` : '—'}</td><td className="r"><button className="btn ghost sm" disabled=${!!busy} onClick=${() => pdf('w2', e)}>W-2 PDF</button></td></tr>`)}
                <tr><th>W-3 totals (${d.w3.n})</th><th className="r num">${M(d.w3.box1)}</th><th className="r num">${M(d.w3.box2)}</th><th className="r num">${M(d.w3.box3)}</th><th className="r num">${M(d.w3.box4)}</th><th className="r num">${M(d.w3.box5)}</th><th className="r num">${M(d.w3.box6)}</th><th /><th /><th /></tr>
              </tbody>
            </table></div>
          </section>`
      }
      ${
        tab === '1099' &&
        html`<section className="panel stack">
            <h2 className="ph">1099-NEC · nonemployee compensation paid in ${year}</h2>
            <p className="muted small" style=${{ margin: 0 }}>Contractors and corp-to-corp consultants paid through payroll runs, and vendors marked "1099" on their vendor card or on a paid bill. A form is due for anyone paid $600 or more. Get a W-9 from each recipient for their TIN; the recipient copy prints here, the IRS copy is e-filed (IRIS) or on the official form.</p>
            ${
              d.nec.length
                ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Recipient</th><th>Kind</th><th className="r">Box 1 · Nonemployee compensation</th><th>Payments</th><th /></tr></thead>
                    <tbody>${d.nec.map((c, i) => html`<tr key=${i}><td><b>${c.n}</b>${c.e ? html`<div className="muted small">${c.e}</div>` : null}</td><td>${c.kind === 'c2c' ? 'Corp-to-corp' : c.kind === '1099' ? 'Contractor' : 'Vendor'}</td><td className="r num">${M(c.total)}${c.due ? '' : html` <${Chip}>under $600<//>`}</td><td>${c.runs}</td><td className="r"><button className="btn ghost sm" disabled=${!!busy} onClick=${() => pdf('1099', c)}>1099-NEC PDF</button></td></tr>`)}</tbody></table></div>`
                : html`<${Empty} title="No 1099 payments this year">Mark contractors as 1099 or corp-to-corp under Team › Tax, and vendors on their vendor card.<//>`
            }
          </section>`
      }
      ${
        tab === 'deposits' &&
        html`<section className="panel stack">
            <h2 className="ph">Tax deposits and payments recorded</h2>
            ${
              d.deposits.length
                ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Date</th><th>Form</th><th>Period</th><th>State</th><th className="r">Amount</th><th>Confirmation</th><th /></tr></thead>
                    <tbody>${d.deposits.map(x => html`<tr key=${x.id}><td>${fmtDate(x.d)}</td><td>${x.kind}</td><td>${x.period}</td><td>${x.state || ''}</td><td className="r num">${M(x.a)}</td><td className="small">${x.conf}${x.note ? ' · ' + x.note : ''}</td><td className="r"><button className="btn ghost sm" onClick=${() => setDep({ ...x })}>Edit</button></td></tr>`)}</tbody></table></div>`
                : html`<p className="muted small">Nothing recorded yet. Each EFTPS or state payment goes here with its confirmation number.</p>`
            }
          </section>`
      }
      ${
        dep &&
        html`<${Modal} title=${dep.id ? 'Tax deposit' : 'Record a tax deposit'} onClose=${() => setDep(null)} foot=${html`${dep.id && html`<button className="btn ghost danger" onClick=${async () => {
          await api('taxdep_delete', { id: dep.id });
          setDep(null);
          load();
        }}>Remove</button>`}<button className="btn ghost" onClick=${() => setDep(null)}>Cancel</button><button className="btn" disabled=${busy === 'dep'} onClick=${saveDep}>Save</button>`}>
            <div className="form">
              <div className="row3">
                <${Field} label="Form / tax"><select value=${dep.kind} onChange=${e => setDep({ ...dep, kind: e.target.value })}><option value="941">941 · federal withholding & FICA</option><option value="940">940 · FUTA</option><option value="state-wh">State withholding</option><option value="suta">State unemployment (SUTA)</option><option value="local">Local tax</option><option value="other">Other</option></select><//>
                <${Field} label="Period" hint="Q1–Q4, a month (2026-03) or the year."><input value=${dep.period} onInput=${e => setDep({ ...dep, period: e.target.value })} /><//>
                ${['state-wh', 'suta', 'local'].includes(dep.kind) && html`<${Field} label="State"><select value=${dep.state} onChange=${e => setDep({ ...dep, state: e.target.value })}><option value="">—</option>${Object.keys(US_STATES).map(c => html`<option key=${c} value=${c}>${c}</option>`)}</select><//>`}
              </div>
              <div className="row3">
                <${Field} label="Date paid"><input type="date" value=${dep.d} onInput=${e => setDep({ ...dep, d: e.target.value })} /><//>
                <${Field} label="Amount"><input type="number" step="0.01" value=${dep.a} onInput=${e => setDep({ ...dep, a: e.target.value })} /><//>
                <${Field} label="Confirmation number"><input value=${dep.conf} onInput=${e => setDep({ ...dep, conf: e.target.value })} /><//>
              </div>
              <${Field} label="Note"><input value=${dep.note} onInput=${e => setDep({ ...dep, note: e.target.value })} /><//>
            </div>
          <//>`
      }
    </div>`;
}

/* ---- Printable worksheets and employee copies (plain paper), built with pdf-lib ---- */
async function buildTaxFormPdf(kind, payload, d) {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.06, 0.1, 0.2),
    grey = rgb(0.4, 0.45, 0.55),
    line = rgb(0.8, 0.84, 0.9);
  const M = n => fmtMoney(n, 'USD').replace(/[^\x20-\x7E]/g, '');
  const co = d.company || {};
  const year = d.year;
  const page = () => pdf.addPage([612, 792]);
  const text = (pg, t, x, y, size, f, color) => pg.drawText(String(t == null ? '' : t).replace(/[^\x20-\x7E]/g, ''), { x, y, size: size || 10, font: f || font, color: color || ink });
  const box = (pg, x, y, w, h, label, value, big) => {
    pg.drawRectangle({ x, y, width: w, height: h, borderColor: line, borderWidth: 0.8 });
    text(pg, label, x + 4, y + h - 10, 6.5, font, grey);
    text(pg, value, x + 4, y + 6, big ? 11 : 9.5, bold);
  };
  const header = (pg, title, sub) => {
    text(pg, title, 50, 745, 15, bold);
    text(pg, sub, 50, 729, 9, font, grey);
    text(pg, `${co.n || ''}${co.ein ? ' · EIN ' + co.ein : ''}${co.addr ? ' · ' + co.addr.replace(/\n/g, ', ') : ''}`, 50, 716, 8.5, font, grey);
    pg.drawLine({ start: { x: 50, y: 708 }, end: { x: 562, y: 708 }, thickness: 0.8, color: line });
  };
  const w2Page = e => {
    const pg = page();
    header(pg, `Form W-2 · Wage and Tax Statement · ${year}`, 'Employee copies B (federal return), C (employee records) and 2 (state return). Printed from StratEdge payroll on plain paper; the SSA copy is filed electronically.');
    const col = (x, y, w, h, label, v, big) => box(pg, x, y, w, h, label, v, big);
    let y = 650;
    col(50, y, 250, 40, 'b  Employer identification number (EIN)', co.ein || '');
    col(310, y, 120, 40, '1  Wages, tips, other compensation', M(e.box1), true);
    col(440, y, 122, 40, '2  Federal income tax withheld', M(e.box2), true);
    y -= 50;
    col(50, y, 250, 60, "c  Employer's name, address, and ZIP code", `${co.n || ''}  ${(co.addr || '').replace(/\n/g, ', ')}`);
    col(310, y + 20, 120, 40, '3  Social security wages', M(e.box3), true);
    col(440, y + 20, 122, 40, '4  Social security tax withheld', M(e.box4), true);
    col(310, y - 30, 120, 40, '5  Medicare wages and tips', M(e.box5), true);
    col(440, y - 30, 122, 40, '6  Medicare tax withheld', M(e.box6), true);
    y -= 90;
    col(50, y, 250, 40, "e  Employee's name", e.n);
    const b12 = Object.entries(e.box12).filter(([, v]) => v > 0);
    col(310, y, 252, 40, '12  Codes', b12.length ? b12.map(([c, v]) => `${c} ${M(v)}`).join('   ') : '');
    y -= 50;
    col(50, y, 250, 50, "f  Employee's address and ZIP code", e.addr || '');
    col(310, y, 120, 50, '13  Retirement plan', e.retire ? 'X' : '');
    col(440, y, 122, 50, '14  Other', e.box14 > 0 ? `State programs ${M(e.box14)}` : '');
    y -= 60;
    col(50, y, 90, 40, '15  State', e.state || '');
    col(140, y, 160, 40, "Employer's state ID number", ((co.stateIds || {})[e.state] || {}).wh || '');
    col(310, y, 120, 40, '16  State wages, tips, etc.', M(e.box16), true);
    col(440, y, 122, 40, '17  State income tax', M(e.box17), true);
    y -= 50;
    col(50, y, 250, 40, "a  Employee's social security number", 'From your records (not stored in the portal)');
    col(310, y, 252, 40, '19  Local income tax', e.local > 0 ? M(e.local) : '');
    text(pg, `Gross pay for the year ${M(e.gross)} · net pay ${M(e.net)} · ${e.runs} pay periods. Box 1 is gross pay less pre-tax deductions (Section 125, HSA, 401(k)); boxes 3 and 5 less Section 125 and HSA only.`, 50, y - 24, 8, font, grey);
    text(pg, 'This information is being furnished to the Internal Revenue Service. Keep Copy C for your records.', 50, y - 36, 8, font, grey);
  };
  if (kind === 'w2') w2Page(payload);
  else if (kind === 'w2all') (d.employees || []).forEach(w2Page);
  else if (kind === 'w3') {
    const pg = page();
    header(pg, `Form W-3 · Transmittal of Wage and Tax Statements · ${year}`, 'Totals of all W-2s. Worksheet for e-filing with the SSA (Business Services Online).');
    const rows = [['c  Total number of Forms W-2', String(d.w3.n)], ['1  Wages, tips, other compensation', M(d.w3.box1)], ['2  Federal income tax withheld', M(d.w3.box2)], ['3  Social security wages', M(d.w3.box3)], ['4  Social security tax withheld', M(d.w3.box4)], ['5  Medicare wages and tips', M(d.w3.box5)], ['6  Medicare tax withheld', M(d.w3.box6)]];
    let y = 660;
    rows.forEach(([l, v]) => {
      box(pg, 50, y, 350, 34, l, v, true);
      y -= 40;
    });
    text(pg, 'Kind of payer: 941. Kind of employer: none apply (unless otherwise advised by your CPA).', 50, y - 10, 9, font, grey);
  } else if (kind === '941') {
    const q = d.quarters[payload.q];
    const pg = page();
    header(pg, `Form 941 worksheet · ${Q_LABEL[payload.q]} ${year}`, "Employer's Quarterly Federal Tax Return: the figures to enter, line by line. File through IRS e-file or your payroll tax service.");
    const rows = [['1  Number of employees paid in the quarter', String(q.people || d.employees.length)], ['2  Wages, tips, and other compensation', M(q.fitW)], ['3  Federal income tax withheld', M(q.fit)], ['5a  Taxable social security wages', `${M(q.ssW)}  x 0.124 = ${M(q.ssEE + q.ssER)}`], ['5c  Taxable Medicare wages & tips', `${M(q.medW)}  x 0.029 = ${M(q.medEE + q.medER)}`], ['5d  Wages subject to Additional Medicare Tax withholding', M(q.medAdd / 0.009 || 0) + `  x 0.009 = ${M(q.medAdd)}`], ['5e  Total social security and Medicare taxes', M(q.ssEE + q.ssER + q.medEE + q.medER + q.medAdd)], ['6  Total taxes before adjustments (3 + 5e)', M(q.liability)], ['12  Total taxes after adjustments and credits', M(q.liability)], ['13  Total deposits for this quarter', M((d.deposits || []).filter(x => x.kind === '941' && x.period === 'Q' + payload.q).reduce((a, x) => a + (+x.a || 0), 0))]];
    let y = 660;
    rows.forEach(([l, v]) => {
      box(pg, 50, y, 512, 30, l, v);
      y -= 34;
    });
    text(pg, `Line 16 / Schedule B monthly liability: ${Object.entries(q.byMonth).map(([mo, v]) => `${new Date(year, +mo - 1, 1).toLocaleDateString([], { month: 'short' })} ${M(v)}`).join('   ')}`, 50, y - 8, 9, font, grey);
  } else if (kind === '940') {
    const pg = page();
    header(pg, `Form 940 worksheet · ${year}`, "Employer's Annual Federal Unemployment (FUTA) Tax Return: the figures to enter.");
    const Q = d.quarters;
    const sum = k => Object.values(Q).reduce((a, q) => a + q[k], 0);
    const rows = [['3  Total payments to all employees', M(sum('wages'))], ['4/5  Payments exempt and in excess of $7,000 per employee', M(sum('wages') - sum('futaW'))], ['7  Total taxable FUTA wages', M(sum('futaW'))], ['8  FUTA tax before adjustments (line 7 x 0.006)', M(sum('futa'))], ['16a  First quarter liability', M(Q[1].futa)], ['16b  Second quarter', M(Q[2].futa)], ['16c  Third quarter', M(Q[3].futa)], ['16d  Fourth quarter', M(Q[4].futa)], ['13  FUTA deposits made during the year', M((d.deposits || []).filter(x => x.kind === '940').reduce((a, x) => a + (+x.a || 0), 0))]];
    let y = 660;
    rows.forEach(([l, v]) => {
      box(pg, 50, y, 512, 30, l, v);
      y -= 34;
    });
  } else if (kind === '1099') {
    const c = payload;
    const pg = page();
    header(pg, `Form 1099-NEC · Nonemployee Compensation · ${year}`, 'Recipient copy B, printed on plain paper. The IRS copy is filed electronically (IRIS) or on the official scannable form.');
    box(pg, 50, 640, 250, 60, "PAYER'S name, street address, city, state, ZIP", `${co.n || ''}  ${(co.addr || '').replace(/\n/g, ', ')}`);
    box(pg, 310, 640, 252, 60, '1  Nonemployee compensation', M(c.total), true);
    box(pg, 50, 580, 250, 50, "PAYER'S TIN", co.ein || '');
    box(pg, 310, 580, 252, 50, "RECIPIENT'S TIN", c.tin || 'From the W-9 on file');
    box(pg, 50, 510, 512, 60, "RECIPIENT'S name and address", `${c.n}${c.e ? '  ' + c.e : ''}`);
    box(pg, 50, 460, 250, 40, '4  Federal income tax withheld', M(0));
    box(pg, 310, 460, 252, 40, 'Account number', c.uid || c.vid || '');
    text(pg, `${c.runs} payment${c.runs === 1 ? '' : 's'} in ${year} · ${c.kind === 'c2c' ? 'corp-to-corp consultant' : c.kind === '1099' ? 'independent contractor' : 'vendor'}.`, 50, 440, 9, font, grey);
  }
  return pdf.save();
}
