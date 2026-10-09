/* ================= Placements (v29): every engagement with a client, its margin, and who gets credit =================
   Records live in rec/place/items/{id}; the ATS hire button creates one, and they can be added by hand. Pay and bill
   rates are shown to administrators, HR and accounting; recruiters and recruiting team see the placement without them. */
const PLACE_ST = { upcoming: 'Upcoming', active: 'Active', ended: 'Ended', cancelled: 'Cancelled' };
const placeStatus = p => {
  if (p.st === 'cancelled') return 'cancelled';
  const today = dkey();
  if (p.end && p.end < today) return 'ended';
  if (p.start && p.start > today) return 'upcoming';
  return 'active';
};
/* Gross margin per month at the usual 160 hours (or the yearly figure / 12): an estimate until the timesheets say otherwise. */
const placeMonthly = p => {
  const bill = +p.bill || 0, pay = +p.pay || 0;
  const per = p.per || 'hour';
  const m = per === 'hour' ? 160 : per === 'day' ? 20 : per === 'year' ? 1 / 12 : 1;
  return { rev: bill * m, cost: pay * m, gm: (bill - pay) * m, pct: bill ? ((bill - pay) / bill) * 100 : 0 };
};
function PlacementModal({ p, onClose }) {
  const P = usePortal();
  const A = P.admin;
  const toast = useToast();
  const canRates = (P.roles || []).some(r => ['admin', 'acct', 'hr'].includes(r));
  const [f, setF] = useState({ n: '', uid: '', ti: '', cid: '', vid: '', bill: '', pay: '', per: 'hour', cur: 'USD', type: 'w2', start: '', end: '', rec: P.uid, sales: '', comm: { rec: '', sales: '' }, notes: '', st: '', ...(p || {}), comm: { rec: '', sales: '', ...((p && p.comm) || {}) } });
  const [busy, setBusy] = useState(false);
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const staff = A ? A.members.filter(m => m.role !== 'employer' && m.st === 'active') : [];
  const vendors = useCol('vms/vendor/items', 'n:asc');
  const save = async () => {
    if (!f.n.trim() && !f.uid) return toast('Who is placed?', true);
    if (!f.start) return toast('Add the start date.', true);
    setBusy(true);
    try {
      const id = (p && p.id) || nid();
      const m = f.uid && A ? A.members.find(x => x.id === f.uid) : null;
      const cl = f.cid && A ? A.clientsById[f.cid] : null;
      const { id: _i, status: _s, bill: _b, pay: _p, comm: _c, ...rest } = f;
      // v83: rates and commissions only from the people who see them (the server leaves them out for everyone else,
      // so saving the blank form would wipe them)
      const rates = canRates ? { bill: +f.bill || 0, pay: +f.pay || 0, comm: f.comm } : {};
      await dbMerge(`rec/place/items/${id}`, { ...rest, ...rates, n: m ? m.u.p.n : f.n.trim(), cl: cl ? cl.n : f.cl || '', st: f.st || '', u: Date.now(), ...(p ? {} : { at: Date.now(), by: P.uid }) });
      toast('Placement saved.');
      onClose();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const est = placeMonthly(f);
  return html`<${Modal} wide title=${p ? 'Placement: ' + p.n : 'New placement'} onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Cancel</button><button className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save placement'}</button>`}>
      <div className="form">
        <div className="row3">
          <${Field} label="Consultant (portal member)"><select value=${f.uid || ''} onChange=${e => setF({ ...f, uid: e.target.value, n: e.target.value ? '' : f.n })}><option value="">— not in the portal —</option>${staff.map(m => html`<option key=${m.id} value=${m.id}>${m.u.p.n}</option>`)}</select><//>
          <${Field} label="Or a name"><input value=${f.n} onInput=${up('n')} disabled=${!!f.uid} placeholder="when they are not a portal member yet" /><//>
          <${Field} label="Title / role"><input value=${f.ti} onInput=${up('ti')} /><//>
        </div>
        <div className="row3">
          <${Field} label="Client"><select value=${f.cid || ''} onChange=${up('cid')}><option value="">—</option>${((A && A.clients) || []).map(c => html`<option key=${c.id} value=${c.id}>${c.n}</option>`)}</select><//>
          <${Field} label="Through vendor (if any)"><select value=${f.vid || ''} onChange=${up('vid')}><option value="">Direct</option>${vendors.docs.map(v => html`<option key=${v.id} value=${v.id}>${v.n}</option>`)}</select><//>
          <${Field} label="Engagement"><select value=${f.type} onChange=${up('type')}><option value="w2">W-2</option><option value="c2c">Corp-to-corp</option><option value="1099">1099</option></select><//>
        </div>
        ${
          canRates &&
          html`<div className="row3">
              <${Field} label="Bill rate"><div className="actions" style=${{ flexWrap: 'nowrap' }}><input type="number" step="0.01" value=${f.bill} onInput=${up('bill')} /><select value=${f.per} onChange=${up('per')} style=${{ width: 90 }}><option value="hour">/hr</option><option value="day">/day</option><option value="month">/mo</option><option value="year">/yr</option></select><select value=${f.cur} onChange=${up('cur')} style=${{ width: 80 }}><option>USD</option><option>INR</option></select></div><//>
              <${Field} label="Pay rate"><input type="number" step="0.01" value=${f.pay} onInput=${up('pay')} /><//>
              <${Field} label="Margin"><input value=${+f.bill ? `${fmtMoney((+f.bill || 0) - (+f.pay || 0), f.cur)} per ${f.per} (${est.pct.toFixed(0)}%) ≈ ${fmtMoney(est.gm, f.cur)} a month` : '—'} disabled /><//>
            </div>`
        }
        <div className="row3">
          <${Field} label="Start"><input type="date" value=${f.start} onInput=${up('start')} /><//>
          <${Field} label="End (if known)"><input type="date" value=${f.end} onInput=${up('end')} /><//>
          <${Field} label="Status"><select value=${f.st} onChange=${up('st')}><option value="">Automatic (from the dates)</option><option value="cancelled">Cancelled / fell through</option></select><//>
        </div>
        <div className="row2">
          <${Field} label="Recruiter credit"><select value=${f.rec || ''} onChange=${up('rec')}><option value="">—</option>${staff.map(m => html`<option key=${m.id} value=${m.id}>${m.u.p.n}</option>`)}</select><//>
          <${Field} label="Sales credit"><select value=${f.sales || ''} onChange=${up('sales')}><option value="">—</option>${staff.map(m => html`<option key=${m.id} value=${m.id}>${m.u.p.n}</option>`)}</select><//>
        </div>
        ${canRates && html`<div className="row2"><${Field} label="Recruiter commission (% of gross margin)"><input type="number" step="0.5" value=${f.comm.rec} onInput=${e => setF({ ...f, comm: { ...f.comm, rec: e.target.value } })} /><//><${Field} label="Sales commission (% of gross margin)"><input type="number" step="0.5" value=${f.comm.sales} onInput=${e => setF({ ...f, comm: { ...f.comm, sales: e.target.value } })} /><//></div>`}
        <${Field} label="Notes"><textarea value=${f.notes} onInput=${up('notes')} placeholder="PO number, timesheet approver, extension history" /><//>
      </div>
    <//>`;
}
function PlacementsPage() {
  const P = usePortal();
  const A = P.admin;
  const col = useCol('rec/place/items', 'start:desc');
  const [edit, setEdit] = useState(null);
  const [tab, setTab] = useState('active');
  const [q, setQ] = useState('');
  const canRates = (P.roles || []).some(r => ['admin', 'acct', 'hr'].includes(r));
  const rows = col.docs.map(p => ({ ...p, status: placeStatus(p) }));
  const today = dkey();
  const soon = addDays(today, 30);
  const list = rows.filter(p => (tab === 'all' || (tab === 'ending' ? p.status === 'active' && p.end && p.end <= soon : p.status === tab)) && (!q || [p.n, p.cl, p.ti].join(' ').toLowerCase().includes(q.toLowerCase())));
  const active = rows.filter(p => p.status === 'active');
  const gm = active.reduce((a, p) => a + placeMonthly(p).gm, 0);
  const rev = active.reduce((a, p) => a + placeMonthly(p).rev, 0);
  const who = uid => nameIn(A, uid);
  // margin by month over the last 12 months: each placement contributes its monthly estimate for the months it is active
  const months = Array.from({ length: 12 }, (_, i) => addMonths(mkey(today), i - 11));
  const byMonth = months.map(mk => {
    const from = mk + '-01', to = mk + '-' + pad(monthDays(mk));
    let g = 0, r = 0, n = 0;
    rows.filter(p => p.status !== 'cancelled' && p.start && p.start <= to && (!p.end || p.end >= from)).forEach(p => {
      const a = p.start > from ? p.start : from, b = p.end && p.end < to ? p.end : to;
      const share = Math.max(0, (daysBetween(a, b) + 1) / monthDays(mk));
      const m = placeMonthly(p);
      g += m.gm * share;
      r += m.rev * share;
      n++;
    });
    return { mk, gm: g, rev: r, n };
  });
  const maxGm = Math.max(1, ...byMonth.map(m => m.gm));
  return html`<div className="stack">
      <${KitStats} items=${[{ v: active.length, l: 'Active placements', onClick: () => setTab('active') }, { v: rows.filter(p => p.status === 'upcoming').length, l: 'Starting soon', onClick: () => setTab('upcoming') }, { v: rows.filter(p => p.status === 'active' && p.end && p.end <= soon).length, l: 'Ending within 30 days', tone: rows.some(p => p.status === 'active' && p.end && p.end <= soon) ? 'warn' : 'ok', onClick: () => setTab('ending') }, ...(canRates ? [{ v: fmtMoney(gm, 'USD'), l: 'Gross margin / month (est.)' }, { v: fmtMoney(rev, 'USD'), l: 'Billing / month (est.)' }] : [])]} />
      <div className="toolbar">
        <${KitTabs} tabs=${[['active', 'Active'], ['upcoming', 'Upcoming'], ['ending', 'Ending soon'], ['ended', 'Ended'], ['all', 'All']]} tab=${tab} onTab=${setTab} />
        <input type="search" placeholder="Search consultant, client, title" value=${q} onInput=${e => setQ(e.target.value)} style=${{ maxWidth: 260 }} />
        <div className="push"><button className="btn" onClick=${() => setEdit({})}><${Icon} n="plus" />New placement</button></div>
      </div>
      ${
        col.loading
          ? html`<${Spinner} />`
          : list.length
            ? html`<section className="panel" style=${{ padding: '6px 8px' }}><div className="tblwrap"><table className="tbl">
                <thead><tr><th>Consultant</th><th>Client</th>${canRates && html`<th className="r">Bill</th><th className="r">Pay</th><th className="r">Margin</th>`}<th>Dates</th><th>Credit</th><th>Status</th></tr></thead>
                <tbody>${list.map(p => { const m = placeMonthly(p); return html`<tr key=${p.id} className="click" tabIndex="0" onClick=${() => setEdit(p)}>
                    <td><b>${p.n}</b><div className="muted small">${p.ti}${p.type ? ' · ' + { w2: 'W-2', c2c: 'C2C', 1099: '1099' }[p.type] : ''}</div></td>
                    <td>${p.cl || '—'}${p.vid ? html`<div className="muted small">via vendor</div>` : null}</td>
                    ${canRates && html`<td className="r num">${p.bill ? fmtMoney(p.bill, p.cur || 'USD') + '/' + (p.per === 'hour' ? 'hr' : p.per) : '—'}</td><td className="r num">${p.pay ? fmtMoney(p.pay, p.cur || 'USD') : '—'}</td><td className="r num">${p.bill ? html`<b>${m.pct.toFixed(0)}%</b><div className="muted small">${fmtMoney(m.gm, p.cur || 'USD')}/mo</div>` : '—'}</td>`}
                    <td className="num small">${p.start ? fmtDate(p.start, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}${p.end ? ' → ' + fmtDate(p.end, { month: 'short', day: 'numeric', year: 'numeric' }) : ' → open'}</td>
                    <td className="small">${p.rec ? html`<div>R: ${who(p.rec)}</div>` : null}${p.sales ? html`<div>S: ${who(p.sales)}</div>` : null}</td>
                    <td><${Chip} s=${p.status === 'active' ? 'ok' : p.status === 'upcoming' ? 'new' : p.status === 'cancelled' ? 'red' : ''}>${PLACE_ST[p.status]}<//>${p.status === 'active' && p.end && p.end <= soon ? html`<div className="small late">ends ${fmtDate(p.end)}</div>` : null}</td>
                  </tr>`; })}</tbody>
              </table></div></section>`
            : html`<${Empty} title="No placements here" action=${html`<button className="btn" onClick=${() => setEdit({})}>New placement</button>`}>A placement is created when a candidate is hired for a client from the ATS, or by hand here: consultant, client, bill and pay rates, dates, and who gets recruiter and sales credit.<//>`
      }
      ${
        canRates &&
        html`<section className="panel stack">
            <h2 className="ph">Gross margin by month (estimate at 160 hours a month)</h2>
            <div className="tblwrap"><table className="tbl small"><thead><tr><th>Month</th><th className="r">Placements</th><th className="r">Billing</th><th className="r">Gross margin</th><th style=${{ width: '35%' }} /></tr></thead><tbody>${byMonth.map(m => html`<tr key=${m.mk}><td>${monthLabel(m.mk)}</td><td className="r num">${m.n}</td><td className="r num">${fmtMoney(m.rev, 'USD')}</td><td className="r num"><b>${fmtMoney(m.gm, 'USD')}</b></td><td><div style=${{ background: 'var(--bg-2, #eef1f6)', borderRadius: 6, height: 10, overflow: 'hidden' }}><div style=${{ width: Math.round((m.gm / maxGm) * 100) + '%', height: '100%', background: 'var(--teal, #0aa19c)' }} /></div></td></tr>`)}</tbody></table></div>
            <p className="muted small" style=${{ margin: 0 }}>Actual billing comes from approved timesheets and invoices; this table is the run-rate from the rates on each placement. Commissions: recruiter and sales percentages of gross margin are kept on each placement for the payout calculation.</p>
          </section>`
      }
      ${edit && html`<${PlacementModal} p=${edit.id ? edit : null} onClose=${() => setEdit(null)} />`}
    </div>`;
}
