/* ================= Books (v28): the general ledger, bank review, reconciliation, reports, exports =================
   Everything here reads api/books.php. The ledger is derived from the records (invoices, bills, payroll, tax
   deposits, categorized bank lines) plus manual journal entries, so there is nothing to "post": fixing a record
   fixes the books. */

const DL = x => fmtDate(x, { month: 'short', day: 'numeric', year: 'numeric' }); // report dates: no weekday
const BOOKS_TYPE_LABEL = { asset: 'Assets', liability: 'Liabilities', equity: 'Equity', income: 'Income', expense: 'Expenses' };
const BOOKS_SUBS = {
  asset: [['bank', 'Bank'], ['cash', 'Cash / undeposited'], ['ar', 'Accounts receivable'], ['current', 'Other current asset'], ['fixed', 'Fixed asset']],
  liability: [['ap', 'Accounts payable'], ['cc', 'Credit card'], ['payroll', 'Payroll liability'], ['current', 'Other current liability'], ['longterm', 'Long-term liability']],
  equity: [['equity', 'Equity']],
  income: [['income', 'Income'], ['other', 'Other income']],
  expense: [['cogs', 'Cost of services'], ['opex', 'Operating expense'], ['other', 'Other expense']],
};
const SRC_LABEL = { inv: 'Invoice', pay: 'Invoice payment', exp: 'Bill', billpay: 'Bill payment', payroll: 'Payroll', paynet: 'Net pay', taxdep: 'Tax deposit', bank: 'Bank', je: 'Journal', open: 'Opening' };
const srcLink = (link, id) => (link === 'inv' ? '#/portal/admin/invoices' : link === 'exp' ? '#/portal/admin/expenses' : link === 'pay' ? '#/portal/admin/payruns' : link === 'bank' ? '#/portal/admin/books?tab=tx' : '');
const q1 = d => `${d.getFullYear()}-${pad(Math.floor(d.getMonth() / 3) * 3 + 1)}-01`;
const rangePreset = key => {
  const now = new Date();
  const today = dkey();
  const y = now.getFullYear();
  const m = now.getMonth();
  if (key === 'month') return [`${y}-${pad(m + 1)}-01`, today];
  if (key === 'last') {
    const d = new Date(y, m - 1, 1);
    return [dkey(d), dkey(new Date(y, m, 0))];
  }
  if (key === 'quarter') return [q1(now), today];
  if (key === 'ytd') return [`${y}-01-01`, today];
  if (key === 'lastyear') return [`${y - 1}-01-01`, `${y - 1}-12-31`];
  return ['', today];
};
function RangePicker({ from, to, onChange, asOf }) {
  const [preset, setPreset] = useState('ytd');
  const pick = k => {
    setPreset(k);
    const [f, t] = rangePreset(k);
    onChange(f, t);
  };
  return html`<div className="toolbar" style=${{ marginBottom: 0 }}>
      ${!asOf && html`<div className="seg">${[['month', 'This month'], ['last', 'Last month'], ['quarter', 'This quarter'], ['ytd', 'Year to date'], ['lastyear', 'Last year'], ['all', 'All time']].map(([k, n]) => html`<button key=${k} className=${preset === k ? 'on' : ''} onClick=${() => pick(k)}>${n}</button>`)}</div>`}
      <div className="actions" style=${{ gap: 6 }}>
        ${!asOf && html`<input type="date" value=${from} onInput=${e => { setPreset(''); onChange(e.target.value, to); }} style=${{ width: 150 }} />`}
        <span className="muted small">${asOf ? 'As of' : 'to'}</span>
        <input type="date" value=${to} onInput=${e => { setPreset(''); onChange(from, e.target.value); }} style=${{ width: 150 }} />
      </div>
    </div>`;
}
const useBooksRange = () => {
  const [f, t] = rangePreset('ytd');
  const [r, setR] = useState({ from: f, to: t });
  return [r, (from, to) => setR({ from, to })];
};

/* ---- Overview ---- */
function BooksOverview({ goto }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const load = () => api('books_overview', {}).then(x => { setD(x); setErr(null); }).catch(setErr);
  useEffect(() => { load(); }, []);
  if (err && !d) return html`<${LoadError} error=${err} onRetry=${load} />`;
  if (!d) return html`<${Spinner} label="Reading the books…" />`;
  const M = n => fmtMoney(n, d.cfg.base);
  const t = d.pl.totals.total || {};
  const months = d.pl.cols.filter(c => c !== 'total');
  const skipped = Object.entries(d.skipped || {});
  return html`<div className="stack">
      <${KitStats} items=${[
        { v: M(d.cash), l: 'Cash in bank accounts', tone: d.cash < 0 ? 'warn' : 'ok' },
        { v: M(d.ar), l: 'Owed to us (receivable)' },
        { v: M(d.ap), l: 'We owe (payable)' },
        { v: M(t.net || 0), l: `Net income, fiscal year to date`, tone: (t.net || 0) < 0 ? 'warn' : 'ok' },
        { v: d.review, l: 'Bank lines to review', tone: d.review ? 'warn' : 'ok' },
      ]} />
      ${d.cfg.close && html`<div className="note info"><span><b>Books closed through ${DL(d.cfg.close)}</b>${d.cfg.closedBy ? ` by ${d.cfg.closedBy}` : ''}. Records dated on or before that day cannot change until an administrator reopens them under Settings.</span></div>`}
      ${skipped.length > 0 && html`<div className="note amber"><span><b>${skipped.map(([c, n]) => `${n} ${c} record${n === 1 ? '' : 's'}`).join(', ')} left out of the books.</b> The books are kept in ${d.cfg.base}; add a rate for ${skipped.map(([c]) => c).join(', ')} under Settings and they are converted in.</span><div className="actions"><button className="btn sm" onClick=${() => goto('settings')}>Settings</button></div></div>`}
      ${!d.bs.balanced && html`<div className="note red"><span><b>The balance sheet does not balance</b> (assets ${M(d.bs.assets)} vs liabilities + equity ${M(d.bs.total)}). This usually means an account was deleted from the chart while records still point to it; check Accounts.</span></div>`}
      <div className="g2" style=${{ alignItems: 'start' }}>
        <section className="panel stack">
          <div className="ph-row"><h2 className="ph">Profit & loss by month</h2><button className="btn ghost sm" onClick=${() => goto('reports')}>All reports</button></div>
          <div className="tblwrap"><table className="tbl small">
            <thead><tr><th>Month</th><th className="r">Income</th><th className="r">Cost of services</th><th className="r">Expenses</th><th className="r">Net</th></tr></thead>
            <tbody>${months.map(c => { const x = d.pl.totals[c] || {}; return html`<tr key=${c}><td>${monthLabel(c)}</td><td className="r num">${M(x.income)}</td><td className="r num">${M(x.cogs)}</td><td className="r num">${M(x.opex)}</td><td className="r num"><b>${M(x.net)}</b></td></tr>`; })}
              <tr><th>Fiscal year to date</th><th className="r num">${M(t.income)}</th><th className="r num">${M(t.cogs)}</th><th className="r num">${M(t.opex)}</th><th className="r num">${M(t.net)}</th></tr>
            </tbody>
          </table></div>
        </section>
        <section className="panel stack">
          <div className="ph-row"><h2 className="ph">Balance sheet today</h2><span className="muted small">as of ${DL(d.bs.asOf)}</span></div>
          ${['asset', 'liability', 'equity'].map(k => html`<div key=${k}><b className="small">${BOOKS_TYPE_LABEL[k]}</b><table className="tbl small"><tbody>${d.bs.groups[k].map(a => html`<tr key=${a.id}><td>${a.n}</td><td className="r num">${M(a.v)}</td></tr>`)}${k === 'equity' ? html`<tr><td>Net income (current year)</td><td className="r num">${M(d.bs.netIncome)}</td></tr>` : null}<tr><th>Total ${BOOKS_TYPE_LABEL[k].toLowerCase()}</th><th className="r num">${M(k === 'asset' ? d.bs.assets : k === 'liability' ? d.bs.liabilities : d.bs.equity + d.bs.netIncome)}</th></tr></tbody></table></div>`)}
        </section>
      </div>
      <div className="note info"><span><b>How the books are kept.</b> Every invoice, payment, bill, finalized payroll, tax deposit and categorized bank line becomes a balanced journal entry automatically; manual entries cover the rest (owner contributions, depreciation, loans). Review bank lines under Transactions, reconcile each statement, and hand the accountant the exports.</span></div>
    </div>`;
}

/* ---- Transactions: the bank feed to review ---- */
function BooksTransactions() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [acct, setAcct] = useState('');
  const [only, setOnly] = useState('review');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');
  const [pick, setPick] = useState(null); // { row, cat, payee, remember, match, k }
  const load = () => api('books_review', { acct, only }).then(x => { setD(x); setErr(null); }).catch(setErr);
  useEffect(() => { setD(null); load(); }, [acct, only]);
  if (err && !d) return html`<${LoadError} error=${err} onRetry=${load} />`;
  if (!d) return html`<${Spinner} />`;
  const coa = d.coa.filter(a => a.active !== false);
  const byId = Object.fromEntries(coa.map(a => [a.id, a]));
  const M = (n, cur) => fmtMoney(n, cur || d.cfg.base);
  const rows = d.rows.filter(r => !q || (r.desc + ' ' + (r.payee || '') + ' ' + (r.ref || '')).toLowerCase().includes(q.toLowerCase()));
  const act = async (row, body, msg) => {
    setBusy(row.id);
    try {
      const r = await api('books_line', { id: row.id, ...body });
      setD({ ...d, rows: d.rows.map(x => (x.id === row.id ? { ...r.row, suggest: [], rule: null } : x)).filter(x => only !== 'review' || !(x.m || x.cat || x.excl)) });
      if (msg) toast(msg);
      setPick(null);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const applyRules = async () => {
    setBusy('rules');
    try {
      const r = await api('books_rules_apply', {});
      toast(r.applied ? `${r.applied} line${r.applied === 1 ? '' : 's'} categorized by your rules.` : 'No line matched a rule.');
      load();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const group = t => coa.filter(a => a.t === t);
  const catSelect = (value, onChange) => html`<select value=${value} onChange=${onChange}>
      <option value="">Choose an account…</option>
      ${['expense', 'income', 'asset', 'liability', 'equity'].map(t => html`<optgroup key=${t} label=${BOOKS_TYPE_LABEL[t]}>${group(t).map(a => html`<option key=${a.id} value=${a.id}>${a.num ? a.num + ' · ' : ''}${a.n}</option>`)}</optgroup>`)}
    </select>`;
  return html`<div className="stack">
      <div className="toolbar">
        <div className="seg">${[['review', `To review`], ['done', 'Done'], ['all', 'All']].map(([k, n]) => html`<button key=${k} className=${only === k ? 'on' : ''} onClick=${() => setOnly(k)}>${n}</button>`)}</div>
        <select value=${acct} onChange=${e => setAcct(e.target.value)} style=${{ maxWidth: 220 }}><option value="">All bank accounts</option>${Object.entries(d.accts).map(([a, n]) => html`<option key=${a} value=${a}>${a || '(unnamed)'} · ${n}</option>`)}</select>
        <input type="search" placeholder="Search description, payee, reference" value=${q} onInput=${e => setQ(e.target.value)} style=${{ maxWidth: 300 }} />
        <div className="push">
          <button className="btn ghost sm" disabled=${busy === 'rules'} onClick=${applyRules}><${Icon} n="bolt" />Apply rules</button>
          <a className="btn ghost sm" href="#/portal/admin/bank">Import a statement</a>
        </div>
      </div>
      ${
        rows.length
          ? html`<div className="tblwrap"><table className="tbl">
              <thead><tr><th>Date</th><th>Description</th><th>Account</th><th className="r">Amount</th><th>Status / suggestion</th><th /></tr></thead>
              <tbody>${rows.map(r => {
                const done = r.m || r.cat || r.excl;
                const sug = (r.suggest || [])[0];
                return html`<tr key=${r.id} className=${busy === r.id ? 'muted' : ''}>
                    <td className="num">${fmtDate(r.dt)}</td>
                    <td><b>${r.payee || r.desc}</b>${r.payee ? html`<div className="muted small">${r.desc}</div>` : null}${r.ref ? html`<div className="muted small">Ref ${r.ref}</div>` : null}</td>
                    <td className="small">${r.acct || '—'}</td>
                    <td className=${'r num ' + (r.a < 0 ? '' : 'ok')}><b>${M(r.a, r.cur)}</b></td>
                    <td className="small">
                      ${r.excl ? html`<${Chip}>excluded<//>` : r.m ? html`<${Chip} s="ok">${r.m.k === 'inv' ? 'Invoice ' + r.m.n : r.m.k === 'exp' ? 'Bill · ' + r.m.n : r.m.n || r.m.k}<//>` : r.cat ? html`<${Chip} s="ok">${(byId[r.cat] || {}).n || r.cat}<//>` : r.rule && byId[r.rule.cat] ? html`<span><${Chip} s="new">rule<//> ${byId[r.rule.cat].n}</span>` : sug ? html`<span><${Chip} s="new">match?<//> ${sug.k === 'inv' ? `Invoice ${sug.n}${sug.who ? ' · ' + sug.who : ''}` : sug.k === 'exp' ? `Bill · ${sug.n}` : sug.n} (${M(sug.open)})</span>` : html`<span className="muted">to review</span>`}
                    </td>
                    <td className="r">
                      <div className="actions" style=${{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                        ${!done && r.rule && byId[r.rule.cat] && html`<button className="btn sm" disabled=${!!busy} onClick=${() => act(r, { act: 'cat', cat: r.rule.cat, payee: r.rule.payee }, 'Categorized.')}>Accept</button>`}
                        ${!done && !r.rule && sug && html`<button className="btn sm" disabled=${!!busy} onClick=${() => act(r, { act: 'match', k: sug.k, mid: sug.id }, 'Matched.')}>Match</button>`}
                        ${!done && html`<button className="btn ghost sm" disabled=${!!busy} onClick=${() => setPick({ row: r, cat: r.rule ? r.rule.cat : '', payee: r.payee || r.rule && r.rule.payee || '', remember: false, match: (r.desc || '').split(/\\s+/).slice(0, 2).join(' '), k: 'cat' })}>Review</button>`}
                        ${done && html`<button className="btn ghost sm" disabled=${!!busy} onClick=${() => act(r, { act: 'undo' }, 'Back to review.')}>Undo</button>`}
                      </div>
                    </td>
                  </tr>`;
              })}</tbody>
            </table></div>`
          : html`<${Empty} title=${only === 'review' ? 'Nothing to review' : 'No bank lines'}>${only === 'review' ? 'Every bank line is matched, categorized or excluded. New lines arrive from the bank connection or a statement import.' : 'Import a statement or connect the bank under Connections.'}<//>`
      }
      ${
        pick &&
        html`<${Modal} title=${`${fmtDate(pick.row.dt)} · ${M(pick.row.a, pick.row.cur)}`} onClose=${() => setPick(null)}>
            <div className="form">
              <p className="muted small" style=${{ margin: 0 }}>${pick.row.desc}${pick.row.ref ? ' · ref ' + pick.row.ref : ''} · ${pick.row.acct || 'bank'}</p>
              <div className="seg">${[['cat', pick.row.a < 0 ? 'Categorize as an expense' : 'Categorize as income'], ['match', pick.row.a < 0 ? 'Pay a bill' : 'Apply to an invoice'], ['transfer', 'Transfer / credit card payment'], ['excl', 'Exclude']].map(([k, n]) => html`<button key=${k} className=${pick.k === k ? 'on' : ''} onClick=${() => setPick({ ...pick, k })}>${n}</button>`)}</div>
              ${
                pick.k === 'cat' &&
                html`<${Fragment}>
                    <${Field} label="Account (category)">${catSelect(pick.cat, e => setPick({ ...pick, cat: e.target.value }))}<//>
                    <${Field} label="Payee / customer"><input value=${pick.payee} onInput=${e => setPick({ ...pick, payee: e.target.value })} /><//>
                    <label className="check"><input type="checkbox" checked=${pick.remember} onChange=${e => setPick({ ...pick, remember: e.target.checked })} /><span>Remember: when the description contains <input value=${pick.match} onInput=${e => setPick({ ...pick, match: e.target.value })} style=${{ width: 180, minHeight: 32, padding: '2px 8px', margin: '0 4px' }} /> use this account</span></label>
                    <div className="actions"><button className="btn" disabled=${!pick.cat || !!busy} onClick=${() => act(pick.row, { act: 'cat', cat: pick.cat, payee: pick.payee, remember: pick.remember, match: pick.match }, 'Categorized.')}>Save</button></div>
                  <//>`
              }
              ${
                pick.k === 'match' &&
                html`<${Fragment}>
                    ${(pick.row.suggest || []).length ? html`<div className="stack" style=${{ gap: 6 }}>${pick.row.suggest.map(s => html`<button key=${s.k + s.id} className="btn ghost" style=${{ justifyContent: 'space-between' }} disabled=${!!busy} onClick=${() => act(pick.row, { act: 'match', k: s.k, mid: s.id }, 'Matched.')}><span>${s.k === 'inv' ? `Invoice ${s.n}${s.who ? ' · ' + s.who : ''}` : s.k === 'exp' ? `Bill · ${s.n}${s.who ? ' · ' + s.who : ''}` : s.n}</span><b>${M(s.open)}</b></button>`)}</div>` : html`<p className="muted small">No open ${pick.row.a < 0 ? 'bill' : 'invoice'} is close to this amount. Record the ${pick.row.a < 0 ? 'bill under Expenses' : 'invoice under Invoices'} first, or categorize the line directly.</p>`}
                  <//>`
              }
              ${
                pick.k === 'transfer' &&
                html`<${Fragment}>
                    <${Field} label=${pick.row.a < 0 ? 'Money went to' : 'Money came from'}><select value=${pick.cat} onChange=${e => setPick({ ...pick, cat: e.target.value })}><option value="">Choose the other account…</option>${coa.filter(a => ['bank', 'cash', 'cc', 'longterm', 'equity'].includes(a.sub) || a.t === 'equity').map(a => html`<option key=${a.id} value=${a.id}>${a.num ? a.num + ' · ' : ''}${a.n}</option>`)}</select><//>
                    <div className="actions"><button className="btn" disabled=${!pick.cat || !!busy} onClick=${() => act(pick.row, { act: 'match', k: 'transfer', to: pick.cat }, 'Recorded as a transfer.')}>Save</button></div>
                  <//>`
              }
              ${pick.k === 'excl' && html`<div className="actions"><p className="muted small" style=${{ margin: 0 }}>Excluded lines stay on the statement for reconciliation but never post to the books (personal spending, duplicates).</p><button className="btn" disabled=${!!busy} onClick=${() => act(pick.row, { act: 'excl' }, 'Excluded.')}>Exclude this line</button></div>`}
            </div>
          <//>`
      }
    </div>`;
}

/* ---- Reconcile ---- */
function BooksReconcile() {
  const toast = useToast();
  const [accts, setAccts] = useState(null);
  const [acct, setAcct] = useState('');
  const [end, setEnd] = useState(dkey());
  const [endBal, setEndBal] = useState('');
  const [d, setD] = useState(null);
  const [hist, setHist] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api('books_review', { only: 'all' }).then(r => { setAccts(Object.keys(r.accts)); if (!acct && Object.keys(r.accts).length) setAcct(Object.keys(r.accts)[0]); }).catch(() => setAccts([]));
    api('books_recon_list', {}).then(r => setHist(r.rows)).catch(() => setHist([]));
  }, []);
  const load = () => (acct ? api('books_recon', { acct, end }).then(setD).catch(e => toast(errText(e), true)) : null);
  useEffect(() => { setD(null); load(); }, [acct, end]);
  if (!accts) return html`<${Spinner} />`;
  if (!accts.length) return html`<${Empty} title="No bank lines yet">Connect a bank or import a statement first; reconciliation ticks the lines off against the statement.<//>`;
  const M = n => fmtMoney(n, 'USD');
  const cleared = d ? d.rows.filter(r => r.clr).reduce((a, r) => a + r.a, 0) : 0;
  const opening = d ? d.opening : 0;
  const diff = r2((+endBal || 0) - (opening + cleared));
  const toggle = async (ids, clr) => {
    setBusy(true);
    try {
      await api('books_recon_clear', { ids, clr });
      setD({ ...d, rows: d.rows.map(r => (ids.includes(r.id) ? { ...r, clr } : r)) });
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const finish = async force => {
    if (endBal === '') return toast('Enter the ending balance from the statement.', true);
    setBusy(true);
    try {
      const r = await api('books_recon_finish', { acct, end, endBal: +endBal, force });
      toast(`Reconciled ${r.n} lines${Math.abs(r.diff) >= 0.005 ? ` with a ${M(r.diff)} adjustment` : ''}.`);
      load();
      api('books_recon_list', {}).then(x => setHist(x.rows)).catch(() => {});
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<div className="stack">
      <section className="panel stack">
        <h2 className="ph">Reconcile a statement</h2>
        <div className="form"><div className="row3">
          <${Field} label="Bank account"><select value=${acct} onChange=${e => setAcct(e.target.value)}>${accts.map(a => html`<option key=${a} value=${a}>${a || '(unnamed)'}</option>`)}</select><//>
          <${Field} label="Statement ending date"><input type="date" value=${end} onInput=${e => setEnd(e.target.value)} /><//>
          <${Field} label="Ending balance on the statement"><input type="number" step="0.01" value=${endBal} onInput=${e => setEndBal(e.target.value)} /><//>
        </div></div>
        ${d && html`<${KitStats} items=${[{ v: M(opening), l: d.last ? `Beginning balance (statement of ${DL(d.last.end)})` : 'Beginning balance (first reconciliation)' }, { v: M(cleared), l: `${d.rows.filter(r => r.clr).length} of ${d.rows.length} lines cleared` }, { v: M(+endBal || 0), l: 'Ending balance entered' }, { v: M(diff), l: 'Difference', tone: Math.abs(diff) < 0.005 && endBal !== '' ? 'ok' : 'warn' }]} />`}
      </section>
      ${
        d &&
        html`<section className="panel stack">
            <div className="ph-row"><h2 className="ph">Lines up to ${DL(end)}</h2><div className="actions"><button className="btn ghost sm" disabled=${busy} onClick=${() => toggle(d.rows.filter(r => !r.clr).map(r => r.id), true)}>Clear all</button><button className="btn ghost sm" disabled=${busy} onClick=${() => toggle(d.rows.filter(r => r.clr).map(r => r.id), false)}>Unclear all</button></div></div>
            ${d.rows.some(r => !r.done) && html`<div className="note amber"><span>${d.rows.filter(r => !r.done).length} of these lines are still unreviewed under Transactions; they can be cleared but will not be in the books until categorized.</span></div>`}
            <div className="tblwrap"><table className="tbl">
              <thead><tr><th /><th>Date</th><th>Description</th><th className="r">Amount</th><th>Books</th></tr></thead>
              <tbody>${d.rows.map(r => html`<tr key=${r.id}><td><input type="checkbox" checked=${r.clr} disabled=${busy} onChange=${e => toggle([r.id], e.target.checked)} /></td><td className="num">${fmtDate(r.dt)}</td><td>${r.desc}</td><td className="r num">${M(r.a)}</td><td>${r.done ? html`<${Chip} s="ok">posted<//>` : html`<${Chip} s="warn">to review<//>`}</td></tr>`)}</tbody>
            </table></div>
            <div className="actions">
              <button className="btn" disabled=${busy || Math.abs(diff) >= 0.005 || endBal === ''} onClick=${() => finish(false)}>Finish reconciliation</button>
              ${Math.abs(diff) >= 0.005 && endBal !== '' && html`<button className="btn ghost" disabled=${busy} onClick=${() => confirm(`Record a ${M(diff)} adjusting entry and finish?`) && finish(true)}>Finish with an adjustment</button>`}
              <span className="muted small">A finished reconciliation locks its lines; the next statement starts from this ending balance.</span>
            </div>
          </section>`
      }
      ${hist && hist.length > 0 && html`<section className="panel stack"><h2 className="ph">Past reconciliations</h2><div className="tblwrap"><table className="tbl small"><thead><tr><th>Account</th><th>Statement date</th><th className="r">Ending balance</th><th className="r">Lines</th><th className="r">Adjustment</th><th>By</th></tr></thead><tbody>${hist.map(h => html`<tr key=${h.id}><td>${h.acct}</td><td>${fmtDate(h.end)}</td><td className="r num">${M(h.endBal)}</td><td className="r">${h.n}</td><td className="r num">${Math.abs(h.diff) >= 0.005 ? M(h.diff) : '—'}</td><td>${h.byn} · ${fmtTs(h.at)}</td></tr>`)}</tbody></table></div></section>`}
    </div>`;
}

/* ---- Journal: manual entries and the account register ---- */
function BooksJournal({ coa }) {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  const [range, setRange] = useBooksRange();
  const [acct, setAcct] = useState('');
  const [gl, setGl] = useState(null);
  const load = () => api('books_je_list', {}).then(r => setRows(r.rows)).catch(e => toast(errText(e), true));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    setGl(null);
    api('books_report', { kind: 'gl', from: range.from, to: range.to, acct }).then(setGl).catch(e => toast(errText(e), true));
  }, [range.from, range.to, acct]);
  const byId = Object.fromEntries(coa.map(a => [a.id, a]));
  const M = n => fmtMoney(n, 'USD');
  const blank = () => ({ id: '', d: dkey(), memo: '', ref: '', lines: [{ acct: '', dr: '', cr: '', memo: '' }, { acct: '', dr: '', cr: '', memo: '' }] });
  const totals = e => ({ dr: r2(e.lines.reduce((a, l) => a + (+l.dr || 0), 0)), cr: r2(e.lines.reduce((a, l) => a + (+l.cr || 0), 0)) });
  const save = async () => {
    const t = totals(edit);
    if (Math.abs(t.dr - t.cr) >= 0.005) return toast(`Debits (${M(t.dr)}) must equal credits (${M(t.cr)}).`, true);
    setBusy(true);
    try {
      await api('books_je_save', edit);
      toast('Journal entry saved.');
      setEdit(null);
      load();
      setAcct(acct); // refresh the register
      api('books_report', { kind: 'gl', from: range.from, to: range.to, acct }).then(setGl).catch(() => {});
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const acctSel = (v, on) => html`<select value=${v} onChange=${on}><option value="">Account…</option>${['asset', 'liability', 'equity', 'income', 'expense'].map(t => html`<optgroup key=${t} label=${BOOKS_TYPE_LABEL[t]}>${coa.filter(a => a.t === t).map(a => html`<option key=${a.id} value=${a.id}>${a.num ? a.num + ' · ' : ''}${a.n}</option>`)}</optgroup>`)}</select>`;
  return html`<div className="stack">
      <section className="panel stack">
        <div className="ph-row"><h2 className="ph">Manual journal entries</h2><button className="btn sm" onClick=${() => setEdit(blank())}><${Icon} n="plus" />New entry</button></div>
        <p className="muted small" style=${{ margin: 0 }}>For what the records do not create on their own: owner contributions and draws, loans, depreciation, accruals, corrections. Everything else (invoices, bills, payroll, bank lines) posts automatically.</p>
        ${rows === null ? html`<${Spinner} />` : rows.length ? html`<div className="tblwrap"><table className="tbl small"><thead><tr><th>Date</th><th>Memo</th><th>Reference</th><th className="r">Amount</th><th>By</th><th /></tr></thead><tbody>${rows.map(e => html`<tr key=${e.id} className=${e.void ? 'muted' : ''}><td className="num">${fmtDate(e.d)}</td><td>${e.memo}${e.void ? html` <${Chip}>void<//>` : null}</td><td>${e.ref}</td><td className="r num">${M(arr(e.lines).reduce((a, l) => a + (+l.dr || 0), 0))}</td><td>${e.byn}</td><td className="r"><button className="btn ghost sm" onClick=${() => setEdit({ id: e.id, d: e.d, memo: e.memo, ref: e.ref || '', void: !!e.void, lines: arr(e.lines).map(l => ({ acct: l.acct, dr: l.dr || '', cr: l.cr || '', memo: l.memo || '' })) })}>Open</button></td></tr>`)}</tbody></table></div>` : html`<p className="muted small">No manual entries yet.</p>`}
      </section>
      <section className="panel stack">
        <div className="ph-row"><h2 className="ph">Account register</h2><select value=${acct} onChange=${e => setAcct(e.target.value)} style=${{ maxWidth: 320 }}><option value="">All entries (general journal)</option>${coa.map(a => html`<option key=${a.id} value=${a.id}>${a.num ? a.num + ' · ' : ''}${a.n}</option>`)}</select></div>
        <${RangePicker} from=${range.from} to=${range.to} onChange=${setRange} />
        ${!gl ? html`<${Spinner} />` : html`<div className="tblwrap"><table className="tbl small">
            <thead><tr><th>Date</th><th>Source</th><th>Memo</th>${!acct && html`<th>Account</th>`}<th>Name</th><th className="r">Debit</th><th className="r">Credit</th>${acct && html`<th className="r">Balance</th>`}</tr></thead>
            <tbody>
              ${acct && html`<tr><td colSpan="5"><b>Opening balance</b></td><td /><td /><td className="r num"><b>${M(gl.opening)}</b></td></tr>`}
              ${gl.rows.map((r, i) => html`<tr key=${i}><td className="num">${fmtDate(r.d)}</td><td className="small">${r.link && srcLink(r.link) ? html`<a href=${srcLink(r.link)}>${SRC_LABEL[r.src] || r.src}</a>` : SRC_LABEL[r.src] || r.src}${r.ref ? html`<div className="muted">${r.ref}</div>` : null}</td><td>${r.memo}</td>${!acct && html`<td className="small">${r.num ? r.num + ' · ' : ''}${r.an}</td>`}<td className="small">${r.name}</td><td className="r num">${r.dr ? M(r.dr) : ''}</td><td className="r num">${r.cr ? M(r.cr) : ''}</td>${acct && html`<td className="r num">${M(r.bal)}</td>`}</tr>`)}
              ${acct && html`<tr><td colSpan="5"><b>Closing balance</b></td><td /><td /><td className="r num"><b>${M(gl.closing)}</b></td></tr>`}
            </tbody>
          </table></div>`}
      </section>
      ${
        edit &&
        html`<${Modal} wide title=${edit.id ? 'Journal entry' : 'New journal entry'} onClose=${() => setEdit(null)} foot=${html`${edit.id && html`<label className="check" style=${{ marginRight: 'auto' }}><input type="checkbox" checked=${!!edit.void} onChange=${e => setEdit({ ...edit, void: e.target.checked })} /><span>Void this entry</span></label>`}<button className="btn ghost" onClick=${() => setEdit(null)}>Cancel</button><button className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save entry'}</button>`}>
            <div className="form">
              <div className="row3">
                <${Field} label="Date"><input type="date" value=${edit.d} onInput=${e => setEdit({ ...edit, d: e.target.value })} /><//>
                <${Field} label="Memo"><input value=${edit.memo} onInput=${e => setEdit({ ...edit, memo: e.target.value })} placeholder="e.g. Owner contribution, July depreciation" /><//>
                <${Field} label="Reference"><input value=${edit.ref} onInput=${e => setEdit({ ...edit, ref: e.target.value })} /><//>
              </div>
              <div className="tblwrap"><table className="tbl small">
                <thead><tr><th>Account</th><th className="r">Debit</th><th className="r">Credit</th><th>Line memo</th><th /></tr></thead>
                <tbody>${edit.lines.map((l, i) => html`<tr key=${i}>
                    <td>${acctSel(l.acct, e => setEdit({ ...edit, lines: edit.lines.map((x, j) => (j === i ? { ...x, acct: e.target.value } : x)) }))}</td>
                    <td><input type="number" step="0.01" value=${l.dr} onInput=${e => setEdit({ ...edit, lines: edit.lines.map((x, j) => (j === i ? { ...x, dr: e.target.value, cr: e.target.value ? '' : x.cr } : x)) })} style=${{ width: 120 }} /></td>
                    <td><input type="number" step="0.01" value=${l.cr} onInput=${e => setEdit({ ...edit, lines: edit.lines.map((x, j) => (j === i ? { ...x, cr: e.target.value, dr: e.target.value ? '' : x.dr } : x)) })} style=${{ width: 120 }} /></td>
                    <td><input value=${l.memo} onInput=${e => setEdit({ ...edit, lines: edit.lines.map((x, j) => (j === i ? { ...x, memo: e.target.value } : x)) })} /></td>
                    <td><button className="btn ghost icon sm" disabled=${edit.lines.length <= 2} onClick=${() => setEdit({ ...edit, lines: edit.lines.filter((x, j) => j !== i) })}><${Icon} n="x" /></button></td>
                  </tr>`)}
                  <tr><th>Totals</th><th className="r num">${M(totals(edit).dr)}</th><th className="r num">${M(totals(edit).cr)}</th><th colSpan="2">${Math.abs(totals(edit).dr - totals(edit).cr) < 0.005 ? html`<${Chip} s="ok">balanced<//>` : html`<${Chip} s="warn">off by ${M(Math.abs(totals(edit).dr - totals(edit).cr))}<//>`}</th></tr>
                </tbody>
              </table></div>
              <div><button className="btn ghost sm" onClick=${() => setEdit({ ...edit, lines: [...edit.lines, { acct: '', dr: '', cr: '', memo: '' }] })}><${Icon} n="plus" />Add a line</button></div>
            </div>
          <//>`
      }
    </div>`;
}

/* ---- Reports ---- */
function BooksReports({ base }) {
  const toast = useToast();
  const [kind, setKind] = useState('pl');
  const [range, setRange] = useBooksRange();
  const [byMonth, setByMonth] = useState(false);
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const asOfOnly = kind === 'bs' || kind === 'ar' || kind === 'ap';
  const load = () => api('books_report', { kind, from: asOfOnly ? '' : range.from, to: range.to, byMonth }).then(x => { setD({ ...x, _kind: kind }); setErr(null); }).catch(setErr);
  useEffect(() => { setD(null); load(); }, [kind, range.from, range.to, byMonth]);
  const M = n => fmtMoney(n, base || 'USD');
  // the data on screen must belong to the tab on screen (the state lags one render behind a tab change)
  const R = d && d._kind === kind ? d : null;
  const exportCsv = async () => {
    const res = await fetch(API + 'books_export', { method: 'POST', headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, from: asOfOnly ? '' : range.from, to: range.to }) });
    if (!res.ok) return toast('Could not export.', true);
    try {
      await saveDownload(`${kind}-${range.to}.csv`, await res.blob());
    } catch (e) {
      if (!e || e.code !== 'declined') toast(errText(e), true);
    }
  };
  const print = () => window.print();
  const tabs = [['pl', 'Profit & loss'], ['bs', 'Balance sheet'], ['cf', 'Cash flow'], ['tb', 'Trial balance'], ['ar', 'A/R aging'], ['ap', 'A/P aging'], ['salestax', 'Sales tax']];
  return html`<div className="stack">
      <${KitTabs} tabs=${tabs} tab=${kind} onTab=${setKind} />
      <div className="toolbar" style=${{ alignItems: 'center' }}>
        <${RangePicker} from=${range.from} to=${range.to} onChange=${setRange} asOf=${asOfOnly} />
        <div className="push">
          ${kind === 'pl' && html`<label className="check small"><input type="checkbox" checked=${byMonth} onChange=${e => setByMonth(e.target.checked)} /><span>By month</span></label>`}
          ${['pl', 'bs', 'tb'].includes(kind) && html`<button className="btn ghost sm" onClick=${exportCsv}><${Icon} n="down" />CSV</button>`}
          <button className="btn ghost sm" onClick=${print}>Print</button>
        </div>
      </div>
      ${err && !R ? html`<${LoadError} error=${err} onRetry=${load} />` : !R ? html`<${Spinner} />` : null}
      ${
        R && kind === 'pl' &&
        html`<section className="panel stack printable">
            <h2 className="ph">Profit & loss · ${DL(d.from)} – ${DL(d.to)}</h2>
            <div className="tblwrap"><table className="tbl small">
              <thead><tr><th>Account</th>${d.cols.map(c => html`<th key=${c} className="r">${c === 'total' ? 'Total' : monthLabel(c)}</th>`)}</tr></thead>
              <tbody>
                ${[['income', 'Income'], ['cogs', 'Cost of services'], ['opex', 'Operating expenses']].map(([k, label]) => html`<${Fragment} key=${k}>
                    <tr><th colSpan=${d.cols.length + 1}>${label}</th></tr>
                    ${d.sections[k].map(a => html`<tr key=${a.id}><td>${a.num ? a.num + ' · ' : ''}${a.n}</td>${d.cols.map(c => html`<td key=${c} className="r num">${M(a.v[c] || 0)}</td>`)}</tr>`)}
                    <tr><td><b>Total ${label.toLowerCase()}</b></td>${d.cols.map(c => html`<td key=${c} className="r num"><b>${M(d.totals[c][k])}</b></td>`)}</tr>
                    ${k === 'cogs' && html`<tr className="grp"><td><b>Gross profit</b></td>${d.cols.map(c => html`<td key=${c} className="r num"><b>${M(d.totals[c].gross)}</b></td>`)}</tr>`}
                  <//>`)}
                <tr><th>Net income</th>${d.cols.map(c => html`<th key=${c} className="r num">${M(d.totals[c].net)}</th>`)}</tr>
              </tbody>
            </table></div>
          </section>`
      }
      ${
        R && kind === 'bs' &&
        html`<section className="panel stack printable">
            <h2 className="ph">Balance sheet · as of ${DL(d.asOf)}</h2>
            ${!d.balanced && html`<div className="note red"><span>Assets and liabilities + equity differ by ${M(d.assets - d.total)}.</span></div>`}
            <div className="g2" style=${{ alignItems: 'start' }}>
              <table className="tbl small"><tbody><tr><th colSpan="2">Assets</th></tr>${d.groups.asset.map(a => html`<tr key=${a.id}><td>${a.num ? a.num + ' · ' : ''}${a.n}</td><td className="r num">${M(a.v)}</td></tr>`)}<tr><th>Total assets</th><th className="r num">${M(d.assets)}</th></tr></tbody></table>
              <table className="tbl small"><tbody><tr><th colSpan="2">Liabilities</th></tr>${d.groups.liability.map(a => html`<tr key=${a.id}><td>${a.num ? a.num + ' · ' : ''}${a.n}</td><td className="r num">${M(a.v)}</td></tr>`)}<tr><th>Total liabilities</th><th className="r num">${M(d.liabilities)}</th></tr><tr><th colSpan="2">Equity</th></tr>${d.groups.equity.map(a => html`<tr key=${a.id}><td>${a.num ? a.num + ' · ' : ''}${a.n}</td><td className="r num">${M(a.v)}</td></tr>`)}<tr><td>Net income (fiscal year from ${DL(d.fyStart)})</td><td className="r num">${M(d.netIncome)}</td></tr><tr><th>Total equity</th><th className="r num">${M(d.equity + d.netIncome)}</th></tr><tr><th>Total liabilities and equity</th><th className="r num">${M(d.total)}</th></tr></tbody></table>
            </div>
          </section>`
      }
      ${
        R && kind === 'cf' &&
        html`<section className="panel stack printable">
            <h2 className="ph">Cash flow (direct) · ${DL(d.from)} – ${DL(d.to)}</h2>
            <table className="tbl small"><tbody>
              <tr><td><b>Cash at the start</b></td><td className="r num"><b>${M(d.opening)}</b></td></tr>
              ${[['operating', 'Operating'], ['investing', 'Investing'], ['financing', 'Financing']].map(([k, label]) => html`<${Fragment} key=${k}><tr><th colSpan="2">${label} activities</th></tr>${d.sections[k].rows.map(r => html`<tr key=${r.n}><td>${r.n}</td><td className="r num">${M(r.v)}</td></tr>`)}<tr><td><b>Net cash from ${label.toLowerCase()} activities</b></td><td className="r num"><b>${M(d.sections[k].total)}</b></td></tr><//>`)}
              <tr><th>Net change in cash</th><th className="r num">${M(d.net)}</th></tr>
              <tr><th>Cash at the end</th><th className="r num">${M(d.closing)}</th></tr>
            </tbody></table>
          </section>`
      }
      ${
        R && kind === 'tb' &&
        html`<section className="panel stack printable">
            <h2 className="ph">Trial balance · ${d.from ? DL(d.from) + ' – ' : 'through '}${DL(d.to)}</h2>
            <div className="tblwrap"><table className="tbl small"><thead><tr><th>Number</th><th>Account</th><th className="r">Debit</th><th className="r">Credit</th></tr></thead><tbody>${d.rows.map(r => html`<tr key=${r.id}><td>${r.num}</td><td>${r.n}</td><td className="r num">${r.dr ? M(r.dr) : ''}</td><td className="r num">${r.cr ? M(r.cr) : ''}</td></tr>`)}<tr><th /><th>Total</th><th className="r num">${M(d.totalDr)}</th><th className="r num">${M(d.totalCr)}</th></tr></tbody></table></div>
            ${Math.abs(d.totalDr - d.totalCr) >= 0.005 && html`<div className="note red"><span>Debits and credits differ by ${M(d.totalDr - d.totalCr)}.</span></div>`}
          </section>`
      }
      ${
        R && (kind === 'ar' || kind === 'ap') &&
        html`<section className="panel stack printable">
            <h2 className="ph">${kind === 'ar' ? 'Accounts receivable' : 'Accounts payable'} aging · as of ${DL(d.asOf)}</h2>
            <${KitStats} items=${[{ v: M(d.buckets.current), l: 'Current' }, { v: M(d.buckets.b30), l: '1–30 days' }, { v: M(d.buckets.b60), l: '31–60 days' }, { v: M(d.buckets.b90), l: '61–90 days' }, { v: M(d.buckets.b90p), l: 'Over 90 days', tone: d.buckets.b90p > 0 ? 'warn' : 'ok' }]} />
            <div className="tblwrap"><table className="tbl small"><thead><tr><th>${kind === 'ar' ? 'Client' : 'Vendor'}</th><th className="r">Current</th><th className="r">1–30</th><th className="r">31–60</th><th className="r">61–90</th><th className="r">90+</th><th className="r">Total</th></tr></thead><tbody>${d.rows.map(r => html`<tr key=${r.n}><td><b>${r.n}</b><div className="muted small">${r.items.map(i => `${i.num || i.id}${i.due ? ' due ' + fmtDate(i.due) : ''} ${M(i.open)}`).join(' · ')}</div></td><td className="r num">${M(r.current)}</td><td className="r num">${M(r.b30)}</td><td className="r num">${M(r.b60)}</td><td className="r num">${M(r.b90)}</td><td className="r num">${M(r.b90p)}</td><td className="r num"><b>${M(r.total)}</b></td></tr>`)}<tr><th>Total</th><th className="r num">${M(d.buckets.current)}</th><th className="r num">${M(d.buckets.b30)}</th><th className="r num">${M(d.buckets.b60)}</th><th className="r num">${M(d.buckets.b90)}</th><th className="r num">${M(d.buckets.b90p)}</th><th className="r num">${M(d.total)}</th></tr></tbody></table></div>
          </section>`
      }
      ${
        R && kind === 'salestax' &&
        html`<section className="panel stack printable">
            <h2 className="ph">Sales tax · ${DL(d.from)} – ${DL(d.to)}</h2>
            ${d.rows.length ? html`<table className="tbl small"><thead><tr><th>Month</th><th className="r">Collected on invoices</th><th className="r">Remitted</th><th className="r">Owed</th></tr></thead><tbody>${d.rows.map(r => html`<tr key=${r.m}><td>${monthLabel(r.m)}</td><td className="r num">${M(r.collected)}</td><td className="r num">${M(r.remitted)}</td><td className="r num">${M(r.collected - r.remitted)}</td></tr>`)}</tbody></table>` : html`<p className="muted small">No sales tax on invoices in this period (staffing services are usually not taxable; set a tax rate on an invoice when they are).</p>`}
          </section>`
      }
    </div>`;
}

/* ---- Accounts (chart) ---- */
function BooksAccounts({ onChanged }) {
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api('books_coa', {}).then(r => setItems(r.items)).catch(e => toast(errText(e), true));
  useEffect(() => { load(); }, []);
  if (!items) return html`<${Spinner} />`;
  const save = async list => {
    setBusy(true);
    try {
      const r = await api('books_coa_save', { items: list });
      setItems(r.items);
      setEdit(null);
      toast('Chart of accounts saved.');
      onChanged && onChanged();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const blank = { id: '', n: '', t: 'expense', sub: 'opex', num: '', open: 0, openDate: '', sys: '', active: true };
  return html`<section className="panel stack">
      <div className="ph-row"><h2 className="ph">Chart of accounts</h2><button className="btn sm" onClick=${() => setEdit({ ...blank })}><${Icon} n="plus" />Add an account</button></div>
      <p className="muted small" style=${{ margin: 0 }}>Numbered the usual way: 1000s assets, 2000s liabilities, 3000s equity, 4000s income, 5000s cost of services, 6000s+ expenses. Accounts with a role (bank, receivable, payable, payroll liabilities…) are used by the automatic entries and cannot be removed. Opening balances start the books on the date given.</p>
      ${['asset', 'liability', 'equity', 'income', 'expense'].map(t => html`<div key=${t}>
          <b className="small">${BOOKS_TYPE_LABEL[t]}</b>
          <div className="tblwrap"><table className="tbl small"><tbody>${items.filter(a => a.t === t).map(a => html`<tr key=${a.id} className=${a.active === false ? 'muted' : ''}><td style=${{ width: 70 }}>${a.num}</td><td><b>${a.n}</b>${a.sys ? html` <span className="muted small">· ${a.sys === 'inc' ? 'default income' : a.sys}</span>` : null}${a.active === false ? html` <${Chip}>inactive<//>` : null}</td><td className="small">${((BOOKS_SUBS[t] || []).find(([k]) => k === a.sub) || [a.sub, a.sub])[1]}</td><td className="r num small">${+a.open ? `${fmtMoney(a.open, 'USD')} opening${a.openDate ? ' ' + fmtDate(a.openDate) : ''}` : ''}</td><td className="r"><button className="btn ghost sm" onClick=${() => setEdit({ ...blank, ...a })}>Edit</button></td></tr>`)}</tbody></table></div>
        </div>`)}
      ${
        edit &&
        html`<${Modal} title=${edit.id ? edit.n : 'New account'} onClose=${() => setEdit(null)} foot=${html`${edit.id && !edit.sys && html`<button className="btn ghost danger" onClick=${() => confirm('Remove this account? Records that used it fall back to "Other expenses".') && save(items.filter(a => a.id !== edit.id))}>Remove</button>`}<button className="btn ghost" onClick=${() => setEdit(null)}>Cancel</button><button className="btn" disabled=${busy} onClick=${() => {
          if (!edit.n.trim()) return toast('Name the account.', true);
          const row = { ...edit, n: edit.n.trim(), id: edit.id || 'a' + nid() };
          save(items.some(a => a.id === row.id) ? items.map(a => (a.id === row.id ? row : a)) : [...items, row]);
        }}>Save account</button>`}>
            <div className="form">
              <div className="row3">
                <${Field} label="Number"><input value=${edit.num} onInput=${e => setEdit({ ...edit, num: e.target.value.replace(/\\D/g, '') })} /><//>
                <${Field} label="Name" style=${{ gridColumn: 'span 2' }}><input value=${edit.n} onInput=${e => setEdit({ ...edit, n: e.target.value })} /><//>
              </div>
              <div className="row2">
                <${Field} label="Type"><select value=${edit.t} disabled=${!!edit.sys} onChange=${e => setEdit({ ...edit, t: e.target.value, sub: BOOKS_SUBS[e.target.value][0][0] })}>${Object.entries(BOOKS_TYPE_LABEL).map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select><//>
                <${Field} label="Detail type"><select value=${edit.sub} onChange=${e => setEdit({ ...edit, sub: e.target.value })}>${(BOOKS_SUBS[edit.t] || []).map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select><//>
              </div>
              <div className="row2">
                <${Field} label="Opening balance" hint="What the account held when the books start here (bank balance, loan owed)."><input type="number" step="0.01" value=${edit.open} onInput=${e => setEdit({ ...edit, open: e.target.value })} /><//>
                <${Field} label="As of"><input type="date" value=${edit.openDate} onInput=${e => setEdit({ ...edit, openDate: e.target.value })} /><//>
              </div>
              <label className="check"><input type="checkbox" checked=${edit.active !== false} onChange=${e => setEdit({ ...edit, active: e.target.checked })} /><span>Active (offered when categorizing)</span></label>
            </div>
          <//>`
      }
    </section>`;
}

/* ---- Audit log ---- */
function BooksAudit() {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const toast = useToast();
  const load = () => api('books_audit', { q, kind }).then(r => setRows(r.rows)).catch(e => toast(errText(e), true));
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [q, kind]);
  return html`<section className="panel stack">
      <div className="ph-row"><h2 className="ph">Audit log</h2><div className="actions"><select value=${kind} onChange=${e => setKind(e.target.value)}><option value="">Every kind</option>${['create', 'change', 'delete', 'bank', 'je', 'recon', 'coa', 'books', 'dd', 'ach', 'w4', 'taxdep', 'plaid', 'qbo'].map(k => html`<option key=${k} value=${k}>${k}</option>`)}</select><input type="search" placeholder="Search" value=${q} onInput=${e => setQ(e.target.value)} /></div></div>
      <p className="muted small" style=${{ margin: 0 }}>Every change to a financial record: who, when, from where, and what changed. The log itself cannot be edited.</p>
      ${rows === null ? html`<${Spinner} />` : rows.length ? html`<div className="tblwrap"><table className="tbl small"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Record</th><th>Details</th></tr></thead><tbody>${rows.map(r => html`<tr key=${r.id}><td className="num">${fmtTs(r.t)}</td><td>${r.byn || r.by}<div className="muted">${r.ip}</div></td><td><${Chip}>${r.kind}<//> ${r.what}</td><td><code>${r.ref}</code></td><td className="small">${r.data && typeof r.data === 'object' ? Object.entries(r.data).slice(0, 6).map(([k, v]) => html`<div key=${k}><b>${k}</b>: ${v && typeof v === 'object' && 'from' in v ? `${v.from} → ${v.to}` : typeof v === 'object' ? JSON.stringify(v).slice(0, 80) : String(v)}</div>`) : null}</td></tr>`)}</tbody></table></div>` : html`<p className="muted small">Nothing recorded yet.</p>`}
    </section>`;
}

/* ---- Exports ---- */
function BooksExports() {
  const toast = useToast();
  const [range, setRange] = useBooksRange();
  const [busy, setBusy] = useState('');
  const dl = async (kind, ext) => {
    setBusy(kind);
    try {
      const res = await fetch(API + 'books_export', { method: 'POST', headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, from: range.from, to: range.to }) });
      if (!res.ok) throw { message: 'Could not build the export.' };
      await saveDownload(`${kind}-${range.from || 'all'}-${range.to}.${ext}`, await res.blob());
    } catch (e) {
      if (!e || e.code !== 'declined') toast(errText(e), true);
    }
    setBusy('');
  };
  const items = [['gl', 'General ledger (CSV)', 'Every journal line with date, account, name, debit and credit. The one file an accountant asks for.', 'csv'], ['iif', 'General journal (IIF)', 'QuickBooks Desktop import: File › Utilities › Import › IIF Files.', 'iif'], ['tb', 'Trial balance (CSV)', 'Account balances for the period.', 'csv'], ['pl', 'Profit & loss (CSV)', '', 'csv'], ['bs', 'Balance sheet (CSV)', '', 'csv'], ['inv', 'Invoices (CSV)', 'Issued, due, status, totals and payments.', 'csv'], ['bills', 'Bills (CSV)', 'Vendor, category, status and payment details.', 'csv'], ['bank', 'Bank transactions (CSV, 3 columns)', 'The format QuickBooks Online accepts under Banking › Upload transactions.', 'csv'], ['coa', 'Chart of accounts (CSV)', 'Numbers, names, types and opening balances.', 'csv']];
  return html`<section className="panel stack">
      <h2 className="ph">Exports for your accountant</h2>
      <${RangePicker} from=${range.from} to=${range.to} onChange=${setRange} />
      <div className="tblwrap"><table className="tbl"><tbody>${items.map(([k, n, d, ext]) => html`<tr key=${k}><td><b>${n}</b>${d ? html`<div className="muted small">${d}</div>` : null}</td><td className="r"><button className="btn ghost sm" disabled=${!!busy} onClick=${() => dl(k, ext)}><${Icon} n="down" />${busy === k ? 'Building…' : 'Download'}</button></td></tr>`)}</tbody></table></div>
      <p className="muted small" style=${{ margin: 0 }}>To hand the whole set over, send the general ledger, trial balance and the invoices and bills files for the year. Connecting QuickBooks Online under Connections pushes the same records as they happen.</p>
    </section>`;
}

/* ---- Settings: close the books, fiscal year, currency rates, how records map to accounts ---- */
function BooksSettings({ coa, cfg, onChanged }) {
  const P = usePortal();
  const toast = useToast();
  const { S } = useAcctSettings();
  const [f, setF] = useState({ fy: cfg.fy || 1, start: cfg.start || '', rates: { ...(cfg.rates || {}) }, catMap: { ...(cfg.catMap || {}) }, bankMap: { ...(cfg.bankMap || {}) }, methodMap: { ...(cfg.methodMap || {}) }, newCur: '' });
  const [close, setClose] = useState(cfg.close || '');
  const [busy, setBusy] = useState('');
  const [bankNames, setBankNames] = useState([]);
  useEffect(() => {
    api('books_review', { only: 'all' }).then(r => setBankNames(Object.keys(r.accts).filter(Boolean))).catch(() => {});
  }, []);
  // bill categories post by name; only the ones that no longer match an account (renamed, deleted) need a mapping
  const exp = useCol('exp', 'u:desc', 600);
  const byName = new Set(coa.map(a => a.n.toLowerCase().trim()));
  const cats = [...new Set(exp.docs.map(x => x.cat).filter(Boolean))].filter(c => !byName.has(String(c).toLowerCase().trim()));
  const sel = (v, on, filter) => html`<select value=${v} onChange=${on}><option value="">Automatic</option>${coa.filter(filter || (() => true)).map(a => html`<option key=${a.id} value=${a.id}>${a.num ? a.num + ' · ' : ''}${a.n}</option>`)}</select>`;
  const save = async () => {
    setBusy('save');
    try {
      await api('books_settings_save', { fy: f.fy, start: f.start, rates: f.rates, catMap: f.catMap, bankMap: f.bankMap, methodMap: f.methodMap });
      toast('Books settings saved.');
      onChanged && onChanged();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const doClose = async date => {
    setBusy('close');
    try {
      const r = await api('books_close', { date });
      setClose(r.close);
      toast(r.close ? `Books closed through ${DL(r.close)}.` : 'Books reopened.');
      onChanged && onChanged();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  return html`<div className="stack">
      <section className="panel stack">
        <h2 className="ph">Close the books</h2>
        <p className="muted small" style=${{ margin: 0 }}>Once a period is filed with the accountant, close it: invoices, bills, payroll, bank lines and journal entries dated on or before the closing date can no longer be changed or deleted, by anyone, until an administrator reopens them. Every attempt is refused with a clear message.</p>
        <div className="actions">
          <input type="date" value=${close} onInput=${e => setClose(e.target.value)} style=${{ maxWidth: 180 }} disabled=${!(P.roles || []).includes('admin')} />
          <button className="btn" disabled=${busy === 'close' || !close || !(P.roles || []).includes('admin')} onClick=${() => doClose(close)}>Close the books through this date</button>
          ${cfg.close && html`<button className="btn ghost" disabled=${busy === 'close' || !(P.roles || []).includes('admin')} onClick=${() => confirm('Reopen the books? Closed records become editable again.') && doClose('')}>Reopen</button>`}
          ${cfg.close ? html`<span className="muted small">Closed through ${DL(cfg.close)}${cfg.closedBy ? ' by ' + cfg.closedBy : ''}${cfg.closedAt ? ' · ' + fmtTs(cfg.closedAt) : ''}.</span>` : html`<span className="muted small">Open. Only administrators can close or reopen.</span>`}
        </div>
      </section>
      <section className="panel stack">
        <h2 className="ph">Fiscal year and currency</h2>
        <div className="form"><div className="row3">
          <${Field} label="Fiscal year starts in"><select value=${f.fy} onChange=${e => setF({ ...f, fy: +e.target.value })}>${Array.from({ length: 12 }, (_, i) => html`<option key=${i + 1} value=${i + 1}>${new Date(2026, i, 1).toLocaleDateString([], { month: 'long' })}</option>`)}</select><//>
          <${Field} label="Books start on" hint="Opening balances without their own date post here."><input type="date" value=${f.start} onInput=${e => setF({ ...f, start: e.target.value })} /><//>
          <${Field} label="Books currency" hint="From Accounting settings."><input value=${cfg.base || S.cur} disabled /><//>
        </div></div>
        <${Field} label=${`Conversion rates into ${cfg.base || S.cur} (records in other currencies are converted; without a rate they stay out of the books)`}>
          <div className="stack" style=${{ gap: 6 }}>
            ${Object.entries(f.rates).map(([cur, v]) => html`<div key=${cur} className="actions"><b style=${{ width: 50 }}>${cur}</b><input type="number" step="0.000001" value=${v} onInput=${e => setF({ ...f, rates: { ...f.rates, [cur]: e.target.value } })} style=${{ maxWidth: 160 }} /><span className="muted small">1 ${cur} = ${v || '?'} ${cfg.base || S.cur}</span><button className="btn ghost sm" onClick=${() => { const r = { ...f.rates }; delete r[cur]; setF({ ...f, rates: r }); }}>Remove</button></div>`)}
            <div className="actions"><input placeholder="Currency code, e.g. INR" value=${f.newCur} onInput=${e => setF({ ...f, newCur: e.target.value.toUpperCase() })} style=${{ maxWidth: 200 }} /><button className="btn ghost sm" disabled=${f.newCur.length !== 3} onClick=${() => setF({ ...f, rates: { ...f.rates, [f.newCur]: f.newCur === 'INR' ? 0.012 : '' }, newCur: '' })}>Add a rate</button></div>
          </div>
        <//>
      </section>
      <section className="panel stack">
        <h2 className="ph">Where records post</h2>
        <p className="muted small" style=${{ margin: 0 }}>Bills post to the account with the same name as their category; bank lines to the account named like their bank account; invoice payments to the account for their payment method. Override any of these here.</p>
        <div className="g2 form" style=${{ alignItems: 'start' }}>
          <div className="stack" style=${{ gap: 8 }}>
            <b className="small">Bill categories</b>
            ${[...new Set([...cats, ...Object.keys(f.catMap)])].length ? [...new Set([...cats, ...Object.keys(f.catMap)])].map(c => html`<div key=${c} className="row2" style=${{ alignItems: 'center' }}><span className="small">${c}</span>${sel(f.catMap[c] || '', e => setF({ ...f, catMap: { ...f.catMap, [c]: e.target.value } }), a => a.t === 'expense' || a.t === 'asset')}</div>`) : html`<span className="muted small">Every category used on a bill matches an account by name; nothing to map.</span>`}
          </div>
          <div className="stack" style=${{ gap: 8 }}>
            <b className="small">Bank accounts (statement / feed names)</b>
            ${bankNames.length ? bankNames.map(n => html`<div key=${n} className="row2" style=${{ alignItems: 'center' }}><span className="small">${n}</span>${sel(f.bankMap[n] || '', e => setF({ ...f, bankMap: { ...f.bankMap, [n]: e.target.value } }), a => ['bank', 'cash', 'cc'].includes(a.sub))}</div>`) : html`<span className="muted small">No bank lines yet.</span>`}
            <b className="small" style=${{ marginTop: 8 }}>Payment methods</b>
            ${(S.methods || []).map(m => html`<div key=${m} className="row2" style=${{ alignItems: 'center' }}><span className="small">${m}</span>${sel(f.methodMap[m] || '', e => setF({ ...f, methodMap: { ...f.methodMap, [m]: e.target.value } }), a => ['bank', 'cash', 'cc'].includes(a.sub))}</div>`)}
          </div>
        </div>
        <div className="actions"><button className="btn" disabled=${busy === 'save'} onClick=${save}>${busy === 'save' ? 'Saving…' : 'Save settings'}</button></div>
      </section>
    </div>`;
}

/* ---- Receipts: documents stored on transactions ---- */
function BooksReceipts() {
  const toast = useToast();
  const files = useCol('org/acct/receipts/f', 'at:desc');
  const bank = useCol('org/acct/bank', 'dt:desc', 300);
  const exp = useCol('exp', 'u:desc', 300);
  const [prog, setProg] = useState(0);
  const [busy, setBusy] = useState(false);
  const [attach, setAttach] = useState(null);
  const [q, setQ] = useState('');
  const fileRef = useRef();
  const upload = async list => {
    setBusy(true);
    let n = 0;
    for (const f of list) {
      try {
        setProg(0.03);
        await storeFile('org/acct/receipts', f, { c: 'receipt' }, setProg);
        n++;
      } catch (e) {
        toast(errText(e), true);
      }
    }
    setProg(0);
    setBusy(false);
    if (n) toast(`${n} receipt${n === 1 ? '' : 's'} stored.`);
  };
  const link = async (rec, kind, id, label) => {
    try {
      if (kind === 'bank') await dbMerge(`org/acct/bank/${id}`, { receipt: rec.id, u: Date.now() });
      if (kind === 'exp') await dbMerge(`exp/${id}`, { receipt: rec.id, u: Date.now() });
      await dbMerge(`org/acct/receipts/f/${rec.id}`, { to: { k: kind, id, n: label } });
      toast('Attached.');
      setAttach(null);
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const del = async f => {
    try {
      await deleteStored('org/acct/receipts', f.id);
      toast('Removed.');
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const hit = s => !q || (s || '').toLowerCase().includes(q.toLowerCase());
  return html`<section className="panel stack">
      <div className="ph-row"><h2 className="ph">Receipts and documents</h2><div className="actions"><input ref=${fileRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.docx,.csv" style=${{ display: 'none' }} onChange=${e => { const fs = [...e.target.files]; e.target.value = ''; fs.length && upload(fs); }} /><button className="btn sm" disabled=${busy} onClick=${() => fileRef.current.click()}><${Icon} n="up" />${busy ? `Uploading… ${Math.round(prog * 100)}%` : 'Upload receipts'}</button></div></div>
      <p className="muted small" style=${{ margin: 0 }}>Drop in receipts, vendor bills and statements, then attach each to the bank line or bill it belongs to so the accountant finds the document behind every number. Bills also take attachments directly under Expenses.</p>
      ${
        files.loading
          ? html`<${Spinner} />`
          : files.docs.length
            ? html`<div className="tblwrap"><table className="tbl small"><thead><tr><th>File</th><th>Added</th><th>Attached to</th><th /></tr></thead><tbody>${files.docs.map(f => html`<tr key=${f.id}><td><a href=${fileUrl('org/acct/receipts', f.id)} target="_blank" rel="noopener">${f.n}</a><div className="muted">${sizeLabel(f.sz || 0)}</div></td><td>${fmtTs(f.at)}</td><td>${f.to ? html`<${Chip} s="ok">${f.to.k === 'bank' ? 'Bank line' : 'Bill'} · ${f.to.n}<//>` : html`<${Chip} s="warn">not attached<//>`}</td><td className="r"><div className="actions" style=${{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}><a className="btn ghost sm" href=${fileUrl('org/acct/receipts', f.id, true)}><${Icon} n="down" /></a><button className="btn ghost sm" onClick=${() => setAttach(f)}>${f.to ? 'Re-attach' : 'Attach'}</button><button className="btn ghost sm" onClick=${() => confirm('Remove this file?') && del(f)}><${Icon} n="trash" /></button></div></td></tr>`)}</tbody></table></div>`
            : html`<${Empty} title="No receipts yet">Upload the first one; photos from a phone work too.<//>`
      }
      ${
        attach &&
        html`<${Modal} title=${'Attach ' + attach.n} onClose=${() => setAttach(null)}>
            <div className="stack">
              <input type="search" placeholder="Search by payee, description or vendor" value=${q} onInput=${e => setQ(e.target.value)} />
              <b className="small">Bank lines</b>
              <div className="tblwrap" style=${{ maxHeight: 220, overflow: 'auto' }}><table className="tbl small"><tbody>${bank.docs.filter(b => hit((b.payee || '') + ' ' + b.desc)).slice(0, 60).map(b => html`<tr key=${b.id}><td className="num">${fmtDate(b.dt)}</td><td>${b.payee || b.desc}</td><td className="r num">${fmtMoney(b.a, b.cur || 'USD')}</td><td className="r"><button className="btn ghost sm" onClick=${() => link(attach, 'bank', b.id, `${fmtDate(b.dt)} ${b.payee || b.desc}`.slice(0, 50))}>Attach</button></td></tr>`)}</tbody></table></div>
              <b className="small">Bills</b>
              <div className="tblwrap" style=${{ maxHeight: 220, overflow: 'auto' }}><table className="tbl small"><tbody>${exp.docs.filter(x => hit((x.v || '') + ' ' + (x.cat || '') + ' ' + (x.memo || ''))).slice(0, 60).map(x => html`<tr key=${x.id}><td className="num">${fmtDate(x.d)}</td><td>${x.v}<div className="muted">${x.cat}</div></td><td className="r num">${fmtMoney(x.a, x.cur || 'USD')}</td><td className="r"><button className="btn ghost sm" onClick=${() => link(attach, 'exp', x.id, x.v)}>Attach</button></td></tr>`)}</tbody></table></div>
            </div>
          <//>`
      }
    </section>`;
}

/* ---- Connections: the bank feed (Plaid) and QuickBooks Online ---- */
let plaidScript = null;
function loadPlaid() {
  if (window.Plaid && window.Plaid.create) return Promise.resolve();
  if (!plaidScript)
    plaidScript = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
      s.async = true;
      s.onload = () => (window.Plaid ? res() : rej(new Error('plaid')));
      s.onerror = () => {
        plaidScript = null;
        rej(new Error('plaid'));
      };
      document.head.appendChild(s);
    });
  return plaidScript;
}
function PlaidCard() {
  const P = usePortal();
  const toast = useToast();
  const isAdmin = (P.roles || []).includes('admin');
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState('');
  const [showKeys, setShowKeys] = useState(false);
  const load = () => api('plaid_settings', {}).then(x => { setD(x); setErr(null); if (!f) setF({ on: x.on, env: x.env, clientId: x.clientId, secret: '', country: x.country || 'US' }); }).catch(setErr);
  useEffect(() => { load(); }, []);
  if (err && !d) return html`<${LoadError} error=${err} onRetry=${load} />`;
  if (!d || !f) return html`<${Spinner} />`;
  const save = async () => {
    setBusy('save');
    try {
      await api('plaid_settings_save', f);
      toast('Bank connection settings saved.');
      setF({ ...f, secret: '' });
      setShowKeys(false);
      load();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const link = async itemId => {
    setBusy('link');
    try {
      const [{ token }] = await Promise.all([api('plaid_link_token', itemId ? { itemId } : {}), loadPlaid()]);
      if (!token) throw { message: 'Plaid returned no link token.' };
      const handler = window.Plaid.create({
        token,
        onSuccess: async (public_token, metadata) => {
          if (itemId) {
            toast('Bank login updated.');
            api('plaid_sync', { itemId }).then(load).catch(() => load());
            return;
          }
          setBusy('exchange');
          try {
            const r = await api('plaid_exchange', { public_token, metadata });
            toast(`${r.item.inst} connected${r.sync && r.sync.added ? `, ${r.sync.added} transactions pulled in` : ''}.`);
          } catch (e) {
            toast(errText(e), true);
          }
          setBusy('');
          load();
        },
        onExit: (e2, metadata) => {
          if (e2) toast(e2.display_message || e2.error_message || 'The bank window closed before finishing.', true);
          setBusy('');
        },
      });
      handler.open();
    } catch (e) {
      toast(e && e.message === 'plaid' ? 'Plaid’s script could not load (an ad blocker or a strict network can stop it).' : errText(e), true);
      setBusy('');
    }
  };
  const sync = async itemId => {
    setBusy('sync' + (itemId || ''));
    try {
      const r = await api('plaid_sync', itemId ? { itemId } : {});
      toast(r.added || r.modified || r.removed ? `${r.added} new, ${r.modified} changed, ${r.removed} removed.` : 'Nothing new at the bank.');
      load();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const balances = async itemId => {
    setBusy('bal' + itemId);
    try {
      await api('plaid_balances', { itemId });
      load();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const remove = async it => {
    if (!confirm(`Disconnect ${it.inst}? Transactions already pulled in stay in the books.`)) return;
    setBusy('rm' + it.id);
    try {
      await api('plaid_remove', { itemId: it.id });
      toast('Disconnected.');
      load();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const sandbox = async () => {
    setBusy('sandbox');
    try {
      const r = await api('plaid_sandbox_item', {});
      toast(`${r.item.inst} connected${r.sync && r.sync.added ? `, ${r.sync.added} transactions pulled in` : ''}.`);
      load();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const ready = d.on && d.clientId && d.hasSecret;
  return html`<section className="panel stack">
      <div className="ph-row"><h2 className="ph">Bank feed (Plaid)</h2>${ready ? html`<${Chip} s="ok">${d.env === 'production' ? 'live' : 'sandbox'}<//>` : html`<${Chip}>not set up<//>`}</div>
      <p className="muted small" style=${{ margin: 0 }}>Connect the business bank and credit-card accounts once; new transactions arrive on their own (every few hours through the cron job, and the moment Plaid reports them), land under Transactions, and are matched to invoices and bills or categorized by your rules. Statement files (OFX, QFX, CSV) still import under <a href="#/portal/admin/bank">Bank</a> when a bank is not connected.</p>
      ${!d.curl && html`<div className="note red"><span>PHP cURL is not available on this server, so the site cannot talk to Plaid. Ask the host to enable the curl extension.</span></div>`}
      ${
        d.items.length > 0 &&
        html`<div className="tblwrap"><table className="tbl">
            <thead><tr><th>Bank</th><th>Accounts</th><th>Last update</th><th /></tr></thead>
            <tbody>${d.items.map(it => html`<tr key=${it.id}>
                <td><b>${it.inst}</b>${it.env && it.env !== 'production' ? html` <${Chip}>sandbox<//>` : null}${it.err ? html`<div className="small" style=${{ color: 'var(--red, #b42318)' }}>${it.err.msg}</div>` : null}</td>
                <td className="small">${(it.accounts || []).map(a => html`<div key=${a.id}>${a.label}${a.bal != null ? html` <span className="muted">· ${fmtMoney(a.bal, a.cur || 'USD')}${a.avail != null && a.avail !== a.bal ? ` (${fmtMoney(a.avail, a.cur || 'USD')} available)` : ''}</span>` : null}</div>`)}</td>
                <td className="small">${it.lastSync ? fmtTs(it.lastSync) : 'never'}${it.added ? html`<div className="muted">${it.added} transactions so far</div>` : null}${it.needsSync ? html`<div className="muted">news waiting</div>` : null}</td>
                <td className="r"><div className="actions" style=${{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                  <button className="btn ghost sm" disabled=${!!busy} onClick=${() => sync(it.id)}>${busy === 'sync' + it.id ? 'Syncing…' : 'Sync now'}</button>
                  <button className="btn ghost sm" disabled=${!!busy} onClick=${() => balances(it.id)} title="Refresh balances"><${Icon} n="refresh" /></button>
                  ${it.err && html`<button className="btn ghost sm" disabled=${!!busy} onClick=${() => link(it.id)}>Fix login</button>`}
                  ${isAdmin && html`<button className="btn ghost sm" disabled=${!!busy} onClick=${() => remove(it)}><${Icon} n="trash" /></button>`}
                </div></td>
              </tr>`)}</tbody>
          </table></div>`
      }
      <div className="actions">
        <button className="btn" disabled=${!ready || !!busy || P.books !== 'full'} onClick=${() => link('')}>${busy === 'link' || busy === 'exchange' ? 'Opening the bank window…' : html`<${Fragment}><${Icon} n="plus" />Connect a bank<//>`}</button>
        ${d.items.length > 0 && html`<button className="btn ghost" disabled=${!!busy} onClick=${() => sync('')}>${busy === 'sync' ? 'Syncing…' : 'Sync all'}</button>`}
        ${ready && d.env === 'sandbox' && html`<button className="btn ghost" disabled=${!!busy} onClick=${sandbox}>${busy === 'sandbox' ? 'Connecting…' : 'Connect Plaid’s test bank'}</button>`}
        ${isAdmin && html`<button className="btn ghost" onClick=${() => setShowKeys(!showKeys)}>${showKeys ? 'Hide keys' : ready ? 'Keys & environment' : 'Set up'}</button>`}
      </div>
      ${
        isAdmin && (showKeys || !ready) &&
        html`<div className="form" style=${{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
            <p className="muted small" style=${{ margin: 0 }}>Create a free account at <a href="https://dashboard.plaid.com/signup" target="_blank" rel="noopener">dashboard.plaid.com</a>, copy the <b>client ID</b> and the <b>secret</b> for the environment (Sandbox lets you try everything with a test bank; Production needs Plaid’s approval and a paid plan), and add this webhook address in the Plaid dashboard so new transactions arrive right away: <code>${d.webhook}</code></p>
            <div className="row3">
              <${Field} label="Client ID"><input value=${f.clientId} onInput=${e => setF({ ...f, clientId: e.target.value })} /><//>
              <${Field} label=${d.hasSecret ? 'Secret (leave blank to keep the saved one)' : 'Secret'}><input type="password" value=${f.secret} onInput=${e => setF({ ...f, secret: e.target.value })} autoComplete="off" /><//>
              <${Field} label="Environment"><select value=${f.env} onChange=${e => setF({ ...f, env: e.target.value })}><option value="sandbox">Sandbox (test bank, no real data)</option><option value="production">Production (real banks)</option></select><//>
            </div>
            <div className="row3">
              <${Field} label="Country"><select value=${f.country} onChange=${e => setF({ ...f, country: e.target.value })}>${['US', 'CA', 'GB', 'IE', 'FR', 'ES', 'NL', 'DE'].map(c => html`<option key=${c} value=${c}>${c}</option>`)}</select><//>
              <label className="check" style=${{ alignSelf: 'end', paddingBottom: 10 }}><input type="checkbox" checked=${f.on} onChange=${e => setF({ ...f, on: e.target.checked })} /><span>Bank connection switched on</span></label>
            </div>
            <div className="actions"><button className="btn" disabled=${busy === 'save'} onClick=${save}>${busy === 'save' ? 'Saving…' : 'Save'}</button></div>
          </div>`
      }
    </section>`;
}
function QboCard({ q }) {
  const P = usePortal();
  const toast = useToast();
  const isAdmin = (P.roles || []).includes('admin');
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState('');
  const [showKeys, setShowKeys] = useState(false);
  const [accts, setAccts] = useState(null);
  const [mapEdit, setMapEdit] = useState({});
  const load = () => api('qbo_settings', {}).then(x => { setD(x); setErr(null); if (!f) setF({ env: x.env, clientId: x.clientId, secret: '', auto: x.auto }); }).catch(setErr);
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (q && q.qbo) {
      const m = { ok: 'QuickBooks is connected.', denied: 'QuickBooks access was declined.', failed: 'QuickBooks did not complete the connection; try again.', state: 'The connection request did not match this session; try again.', login: 'Log in as an administrator, then connect QuickBooks.' };
      toast(m[q.qbo] || 'Back from QuickBooks.', q.qbo !== 'ok');
    }
  }, []);
  if (err && !d) return html`<${LoadError} error=${err} onRetry=${load} />`;
  if (!d || !f) return html`<${Spinner} />`;
  const save = async () => {
    setBusy('save');
    try {
      const r = await api('qbo_settings_save', f);
      setD(r);
      setF({ ...f, secret: '' });
      toast('QuickBooks settings saved.');
      setShowKeys(false);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const connect = async () => {
    setBusy('connect');
    try {
      const r = await api('qbo_connect', {});
      location.href = r.url;
    } catch (e) {
      toast(errText(e), true);
      setBusy('');
    }
  };
  const disconnect = async () => {
    if (!confirm('Disconnect QuickBooks? Records already pushed stay in QuickBooks.')) return;
    setBusy('disc');
    try {
      setD(await api('qbo_disconnect', {}));
      toast('Disconnected.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const sync = async full => {
    setBusy('sync');
    try {
      let total = { created: 0, updated: 0, removed: 0, errors: 0 };
      let r;
      let rounds = 0;
      do {
        r = await api('qbo_sync', { full: !!full && rounds === 0 });
        ['created', 'updated', 'removed', 'errors'].forEach(k => (total[k] += r[k]));
        rounds++;
      } while (r.more && rounds < 10);
      setD(r.state);
      toast(total.created + total.updated + total.removed ? `QuickBooks: ${total.created} created, ${total.updated} updated, ${total.removed} removed${total.errors ? `, ${total.errors} failed (see the log)` : ''}.` : total.errors ? `${total.errors} records failed; see the log.` : 'QuickBooks is up to date.', !!total.errors);
      if (r.errorList && r.errorList.length) console.warn('QuickBooks sync', r.errorList);
    } catch (e) {
      toast(errText(e), true);
      load();
    }
    setBusy('');
  };
  const loadAccts = async () => {
    setBusy('accts');
    try {
      setAccts(await api('qbo_accounts', {}));
      setMapEdit({});
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const saveMap = async () => {
    setBusy('map');
    try {
      const r = await api('qbo_map_save', { map: mapEdit });
      setAccts({ ...accts, map: r.map });
      setMapEdit({});
      toast('Account mapping saved.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const ready = d.clientId && d.hasSecret;
  const n = d.counts || {};
  return html`<section className="panel stack">
      <div className="ph-row"><h2 className="ph">QuickBooks Online</h2>${d.connected ? html`<${Chip} s="ok">connected${d.env === 'sandbox' ? ' · sandbox' : ''}<//>` : html`<${Chip}>not connected<//>`}</div>
      <p className="muted small" style=${{ margin: 0 }}>Every invoice, payment, bill, bill payment, payroll run, tax deposit, categorized bank line and journal entry is copied into QuickBooks as it happens, under matching accounts, customers and vendors. The books here stay the master copy; nothing is pulled back.</p>
      ${!d.curl && html`<div className="note red"><span>PHP cURL is not available on this server, so the site cannot talk to QuickBooks. Ask the host to enable the curl extension.</span></div>`}
      ${
        d.connected &&
        html`<${KitStats} items=${[{ v: d.company || d.realmId, l: `Company${d.country ? ' · ' + d.country : ''}` }, { v: d.lastSync ? fmtTs(d.lastSync) : 'never', l: 'Last sync', tone: d.lastErr ? 'warn' : 'ok' }, { v: (n.inv || 0) + (n.pay || 0), l: 'Invoices & payments in QuickBooks' }, { v: (n.bill || 0) + (n.billpay || 0), l: 'Bills & payments' }, { v: n.je || 0, l: 'Journal entries' }]} />`
      }
      ${d.lastErr && html`<div className="note amber"><span><b>Last problem</b> (${fmtTs(d.lastErr.at)}): ${d.lastErr.msg}${d.lastErr.n > 1 ? ` and ${d.lastErr.n - 1} more; the log below has the rest.` : ''}</span></div>`}
      ${d.connected && d.refreshExp && d.refreshExp < Date.now() / 1000 + 14 * 86400 && html`<div className="note amber"><span>The QuickBooks connection expires ${fmtDate(new Date(d.refreshExp * 1000))}; connect again before then.</span></div>`}
      <div className="actions">
        ${!d.connected && isAdmin && html`<button className="btn" disabled=${!ready || !!busy} onClick=${connect}>${busy === 'connect' ? 'Sending you to Intuit…' : 'Connect to QuickBooks'}</button>`}
        ${d.connected && html`<button className="btn" disabled=${!!busy || P.books !== 'full'} onClick=${() => sync(false)}>${busy === 'sync' ? 'Syncing…' : 'Sync now'}</button>`}
        ${d.connected && html`<button className="btn ghost" disabled=${!!busy || P.books !== 'full'} onClick=${() => confirm('Re-check every record against QuickBooks, including closed periods? This takes longer.') && sync(true)}>Full re-sync</button>`}
        ${d.connected && html`<button className="btn ghost" disabled=${!!busy} onClick=${loadAccts}>${busy === 'accts' ? 'Loading…' : 'Account mapping'}</button>`}
        ${d.connected && isAdmin && html`<button className="btn ghost" disabled=${!!busy} onClick=${disconnect}>Disconnect</button>`}
        ${isAdmin && html`<button className="btn ghost" onClick=${() => setShowKeys(!showKeys)}>${showKeys ? 'Hide keys' : ready ? 'Keys & environment' : 'Set up'}</button>`}
      </div>
      ${
        isAdmin && (showKeys || !ready) &&
        html`<div className="form" style=${{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
            <p className="muted small" style=${{ margin: 0 }}>At <a href="https://developer.intuit.com/app/developer/dashboard" target="_blank" rel="noopener">developer.intuit.com</a> create an app with the <b>Accounting</b> scope, add this redirect URI under Keys & credentials: <code>${d.redirect}</code>, then paste the client ID and client secret here. Sandbox keys work with Intuit’s free sandbox company; production keys need the app to pass Intuit’s review (or the company can use the app’s own production keys for itself).</p>
            <div className="row3">
              <${Field} label="Client ID"><input value=${f.clientId} onInput=${e => setF({ ...f, clientId: e.target.value })} /><//>
              <${Field} label=${d.hasSecret ? 'Client secret (blank keeps the saved one)' : 'Client secret'}><input type="password" value=${f.secret} onInput=${e => setF({ ...f, secret: e.target.value })} autoComplete="off" /><//>
              <${Field} label="Environment"><select value=${f.env} onChange=${e => setF({ ...f, env: e.target.value })}><option value="sandbox">Sandbox company</option><option value="production">Production (the real company)</option></select><//>
            </div>
            <label className="check"><input type="checkbox" checked=${f.auto} onChange=${e => setF({ ...f, auto: e.target.checked })} /><span>Push changes automatically from the cron job (otherwise only when someone presses Sync now)</span></label>
            <div className="actions"><button className="btn" disabled=${busy === 'save'} onClick=${save}>${busy === 'save' ? 'Saving…' : 'Save'}</button></div>
          </div>`
      }
      ${
        accts &&
        html`<div className="stack" style=${{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
            <div className="ph-row"><b>Where each of our accounts posts in QuickBooks</b><div className="actions"><button className="btn ghost sm" onClick=${() => setAccts(null)}>Close</button>${isAdmin && Object.keys(mapEdit).length > 0 && html`<button className="btn sm" disabled=${busy === 'map'} onClick=${saveMap}>Save mapping</button>`}</div></div>
            <p className="muted small" style=${{ margin: 0 }}>Accounts are matched by name or number; anything unmatched is created in QuickBooks on the next sync. Pick a different QuickBooks account here when the company already has one under another name.</p>
            <div className="tblwrap"><table className="tbl small"><thead><tr><th>Our account</th><th>QuickBooks account</th></tr></thead><tbody>${accts.coa.map(a => { const cur = mapEdit[a.id] !== undefined ? mapEdit[a.id] : accts.map[a.id] || ''; return html`<tr key=${a.id}><td>${a.num ? a.num + ' · ' : ''}${a.n}<div className="muted">${BOOKS_TYPE_LABEL[a.t]}</div></td><td><select value=${cur} disabled=${!isAdmin} onChange=${e => setMapEdit({ ...mapEdit, [a.id]: e.target.value })}><option value="">${accts.map[a.id] ? '— (unmap; create on next sync)' : '— create on next sync'}</option>${accts.qbo.filter(x => x.active).map(x => html`<option key=${x.id} value=${x.id}>${x.num ? x.num + ' · ' : ''}${x.n} (${x.t})</option>`)}</select></td></tr>`; })}</tbody></table></div>
          </div>`
      }
      ${
        d.log && d.log.length > 0 &&
        html`<details><summary className="small">Sync log</summary><table className="tbl small"><tbody>${[...d.log].reverse().map((l, i) => html`<tr key=${i}><td className="num nw">${fmtTs(l.t)}</td><td>${l.msg}</td></tr>`)}</tbody></table></details>`
      }
    </section>`;
}
function ConnectionsTab({ q }) {
  return html`<div className="stack">
      <${PlaidCard} />
      <${QboCard} q=${q} />
      <section className="panel stack">
        <h2 className="ph">Statement files</h2>
        <p className="muted small" style=${{ margin: 0 }}>Banks that are not connected still come in by file. Download the statement as <b>OFX / QFX / QBO</b> (Quicken or QuickBooks format: the bank’s own transaction ids stop duplicates) or CSV, then import it under <a href="#/portal/admin/bank">Bank</a>. Lines land under Transactions exactly like the feed’s.</p>
      </section>
    </div>`;
}

/* ---- The page ---- */
const BOOKS_TABS = [['overview', 'Overview'], ['tx', 'Transactions'], ['recon', 'Reconcile'], ['journal', 'Journal'], ['reports', 'Reports'], ['accounts', 'Accounts'], ['receipts', 'Receipts'], ['audit', 'Audit log'], ['exports', 'Exports'], ['settings', 'Settings'], ['connect', 'Connections']];
function BooksPage({ q }) {
  const P = usePortal();
  const level = P.books || 'full';
  const tabs = level === 'reports' ? BOOKS_TABS.filter(([k]) => ['overview', 'reports', 'exports'].includes(k)) : BOOKS_TABS;
  const [tab, setTab] = useState(q && q.tab && tabs.some(([k]) => k === q.tab) ? q.tab : 'overview');
  const [meta, setMeta] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    api('books_coa', {}).then(setMeta).catch(() => setMeta({ items: [], cfg: {} }));
  }, [tick]);
  if (!meta) return html`<${Spinner} label="Opening the books…" />`;
  const coa = meta.items.filter(a => a.active !== false);
  const cfg = meta.cfg || {};
  const refresh = () => setTick(t => t + 1);
  return html`<div className="stack">
      <${KitTabs} tabs=${tabs} tab=${tab} onTab=${setTab} wrap />
      ${level !== 'full' && html`<div className="note info"><span>${level === 'reports' ? 'Your access covers the Books reports and exports.' : 'Your books access is view-only: every record and report is open to you, and changes are refused.'}</span></div>`}
      ${tab === 'overview' && html`<${BooksOverview} key=${tick} goto=${setTab} />`}
      ${tab === 'tx' && html`<${BooksTransactions} />`}
      ${tab === 'recon' && html`<${BooksReconcile} />`}
      ${tab === 'journal' && html`<${BooksJournal} coa=${coa} />`}
      ${tab === 'reports' && html`<${BooksReports} base=${cfg.base} />`}
      ${tab === 'accounts' && html`<${BooksAccounts} onChanged=${refresh} />`}
      ${tab === 'receipts' && html`<${BooksReceipts} />`}
      ${tab === 'audit' && html`<${BooksAudit} />`}
      ${tab === 'exports' && html`<${BooksExports} />`}
      ${tab === 'settings' && html`<${BooksSettings} key=${tick} coa=${coa} cfg=${cfg} onChanged=${refresh} />`}
      ${tab === 'connect' && html`<${ConnectionsTab} q=${q} />`}
    </div>`;
}
