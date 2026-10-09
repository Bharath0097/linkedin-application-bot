/* ================= v34: Admin > Website & messages > Pricing =================
   The figures on #/pricing: contract starting rates by role, the full-time hiring fee and guarantee, the
   contract-to-hire and project wording, and which sections show. Student and membership plans come from
   Plans & payments. Saved to org/site/x/pricing (readable by everyone, written by staff). */
function PricingSettings() {
  const toast = useToast();
  const doc = useDoc('org/site/x/pricing');
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progs, setProgs] = useState([]);
  useEffect(() => {
    if (!doc.loading && f === null) setF(JSON.parse(JSON.stringify(pricingOf(doc.data))));
  }, [doc.loading]);
  useEffect(() => {
    // the columns of the comparison: the job placement programs in Plans & payments (not the custom one)
    api('bill_plans', {}).then(r => setProgs((r.plans || []).filter(x => x.line === 'placement' && !x.quote)), () => setProgs([]));
  }, []);
  if (!f) return html`<${Spinner} />`;
  const pl = f.place;
  const setPl = patch => setF({ ...f, place: { ...pl, ...patch } });
  const setRow = (i, patch) => setPl({ rows: pl.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const moveRow = (i, dlt) => {
    const r = pl.rows.slice();
    const j = i + dlt;
    if (j < 0 || j >= r.length) return;
    [r[i], r[j]] = [r[j], r[i]];
    setPl({ rows: r });
  };
  const setRate = (i, k, v) => setF({ ...f, rates: f.rates.map((r, j) => (j === i ? { ...r, [k]: v } : r)) });
  const move = (i, d) => {
    const r = f.rates.slice();
    const j = i + d;
    if (j < 0 || j >= r.length) return;
    [r[i], r[j]] = [r[j], r[i]];
    setF({ ...f, rates: r });
  };
  const save = async () => {
    const rates = f.rates.filter(r => String(r.r || '').trim()).map(r => ({ r: String(r.r).trim().slice(0, 120), v: Math.max(0, Math.round(+r.v || 0)) }));
    if (!rates.length) return toast('Add at least one role and rate.', true);
    if (!(+f.dhPct > 0 && +f.dhPct <= 50)) return toast('The full-time hiring fee should be between 1% and 50%.', true);
    setBusy(true);
    try {
      const place = {
        title: String(pl.title || '').trim().slice(0, 120) || PRICING_DEFAULT.place.title,
        intro: String(pl.intro || '').slice(0, 1200),
        note: String(pl.note || '').slice(0, 1200),
        stats: pl.stats.filter(t => String(t.v || '').trim()).map(t => ({ v: String(t.v).trim().slice(0, 20), t: String(t.t || '').trim().slice(0, 120) })).slice(0, 8),
        rows: pl.rows
          .filter(r => String(r.s || r.t || '').trim())
          .map(r => (r.s !== undefined ? { s: String(r.s).trim().slice(0, 120) } : { t: String(r.t).trim().slice(0, 160), v: Object.fromEntries(Object.entries(r.v || {}).map(([k, v]) => [k, String(v || '').trim().slice(0, 40)])) }))
          .slice(0, 80),
      };
      await dbSet('org/site/x/pricing', { rates, rateNote: f.rateNote, dhPct: +f.dhPct, dhDays: Math.max(0, Math.round(+f.dhDays || 0)), c2h: f.c2h, sow: f.sow, show: f.show, place, u: Date.now() });
      setF({ ...f, rates });
      toast('Pricing saved. The website shows it now.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const tog = k => e => setF({ ...f, show: { ...f.show, [k]: e.target.checked } });
  return html`<div className="stack">
      ${!doc.exists && html`<p className="note amber" style=${{ margin: 0 }}><span><b>The pricing page shows example starting rates.</b> Check every rate and term below against your current rate card, then save: from then on the page shows exactly what you set here.</span></p>`}
      <section className="panel stack form" style=${{ gap: 12 }}>
        <div className="ph-row" style=${{ margin: 0 }}><h2 className="ph">Pricing page</h2><a className="btn ghost sm" href="#/pricing" target="_blank" rel="noopener">Open the page</a></div>
        <div className="checks">
          <label className="check"><input type="checkbox" checked=${!!f.show.employers} onChange=${tog('employers')} /><span>Show prices for employers (contract, contract-to-hire, full-time hiring, projects)</span></label>
          <label className="check"><input type="checkbox" checked=${f.show.place !== false} onChange=${tog('place')} /><span>Show the job placement programs (Basic, Elite, Premium, Custom)</span></label>
          <label className="check"><input type="checkbox" checked=${!!f.show.students} onChange=${tog('students')} /><span>Show the student plans</span></label>
          <label className="check"><input type="checkbox" checked=${!!f.show.consultants} onChange=${tog('consultants')} /><span>Show the consultant membership and placement fees</span></label>
        </div>
        <p className="muted small" style=${{ margin: 0 }}>Student plans, memberships and placement fees are edited under <a href="#/portal/admin/billing">Plans & payments</a>.</p>
      </section>
      <section className="panel stack form" style=${{ gap: 12 }}>
        <h2 className="ph" style=${{ margin: 0 }}>Full-time hiring</h2>
        <div className="row2">
          <${Field} label="Fee (% of the first-year base salary)"><input type="number" min="1" max="50" step="0.5" value=${f.dhPct} onInput=${e => setF({ ...f, dhPct: e.target.value })} /><//>
          <${Field} label="Replacement guarantee (days)" hint="0 hides the guarantee."><input type="number" min="0" max="365" value=${f.dhDays} onInput=${e => setF({ ...f, dhDays: e.target.value })} /><//>
        </div>
        <${Field} label="Contract-to-hire"><textarea rows="3" value=${f.c2h} onInput=${e => setF({ ...f, c2h: e.target.value })} /><//>
        <${Field} label="Projects (SOW)"><textarea rows="2" value=${f.sow} onInput=${e => setF({ ...f, sow: e.target.value })} /><//>
      </section>
      <section className="panel stack" style=${{ gap: 10 }}>
        <div className="ph-row" style=${{ margin: 0 }}><h2 className="ph">Contract starting rates (per hour)</h2><button className="btn ghost sm" onClick=${() => setF({ ...f, rates: [...f.rates, { r: '', v: 0 }] })}>Add a role</button></div>
        <div className="tblwrap"><table className="tbl prrates">
          <thead><tr><th>Role</th><th className="r">From ($/hr)</th><th></th></tr></thead>
          <tbody>${f.rates.map(
            (r, i) => html`<tr key=${i}>
              <td><input value=${r.r} onInput=${e => setRate(i, 'r', e.target.value)} aria-label="Role" /></td>
              <td className="r"><input type="number" min="0" style=${{ width: 100 }} value=${r.v} onInput=${e => setRate(i, 'v', e.target.value)} aria-label="Starting rate" /></td>
              <td className="r nowrap">
                <button type="button" className="btn ghost sm icon" title="Move up" aria-label="Move up" onClick=${() => move(i, -1)}>↑</button>
                <button type="button" className="btn ghost sm icon" title="Move down" aria-label="Move down" onClick=${() => move(i, 1)}>↓</button>
                <button type="button" className="btn ghost sm" onClick=${() => setF({ ...f, rates: f.rates.filter((x, j) => j !== i) })}>Remove</button>
              </td>
            </tr>`
          )}</tbody>
        </table></div>
        <${Field} label="Note under the rates"><textarea rows="2" value=${f.rateNote} onInput=${e => setF({ ...f, rateNote: e.target.value })} /><//>
      </section>
      <section className="panel stack form" style=${{ gap: 12 }}>
        <div className="ph-row" style=${{ margin: 0 }}><h2 className="ph">Job placement programs</h2><a className="btn ghost sm" href="#/portal/admin/billing?tab=plans">Prices and plans</a></div>
        <p className="muted small" style=${{ margin: 0 }}>Names and prices come from Plans & payments; here is what the pricing page says about them. In the table, write <b>yes</b> or <b>no</b> for a mark, or any short text (60+, Top priority).</p>
        <div className="row2">
          <${Field} label="Heading"><input value=${pl.title} onInput=${e => setPl({ title: e.target.value })} /><//>
          <${Field} label="Note under the table"><input value=${pl.note} onInput=${e => setPl({ note: e.target.value })} /><//>
        </div>
        <${Field} label="Introduction"><textarea rows="2" value=${pl.intro} onInput=${e => setPl({ intro: e.target.value })} /><//>
        <div className="fld">
          <span>Track record (shown above the programs; leave a number empty to hide it)</span>
          <div className="prstatsedit">
            ${pl.stats.map(
              (t, i) => html`<div key=${i} className="actions">
                <input style=${{ width: 110 }} value=${t.v} aria-label="Number" placeholder="1,569+" onInput=${e => setPl({ stats: pl.stats.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)) })} />
                <input style=${{ flex: '1 1 260px' }} value=${t.t} aria-label="What it counts" onInput=${e => setPl({ stats: pl.stats.map((x, j) => (j === i ? { ...x, t: e.target.value } : x)) })} />
                <button type="button" className="btn ghost sm" onClick=${() => setPl({ stats: pl.stats.filter((x, j) => j !== i) })}>Remove</button>
              </div>`
            )}
            ${pl.stats.length < 8 && html`<div><button type="button" className="btn ghost sm" onClick=${() => setPl({ stats: [...pl.stats, { v: '', t: '' }] })}>Add a number</button></div>`}
          </div>
        </div>
        <div className="tblwrap"><table className="tbl prmatrix">
          <thead><tr><th>What you get</th>${progs.map(c => html`<th key=${c.id}>${c.t}</th>`)}<th></th></tr></thead>
          <tbody>
            ${pl.rows.map(
              (r, i) => html`<tr key=${i} className=${r.s !== undefined ? 'plsec' : ''}>
                <td>${r.s !== undefined ? html`<input value=${r.s} aria-label="Section" onInput=${e => setRow(i, { s: e.target.value })} />` : html`<input value=${r.t} aria-label="Feature" onInput=${e => setRow(i, { t: e.target.value })} />`}</td>
                ${progs.map(c => html`<td key=${c.id}>${r.s === undefined && html`<input style=${{ width: 120 }} list="prvals" value=${(r.v || {})[c.id] || ''} aria-label=${c.t + ': ' + r.t} onInput=${e => setRow(i, { v: { ...(r.v || {}), [c.id]: e.target.value } })} />`}</td>`)}
                <td className="r nowrap">
                  <button type="button" className="btn ghost sm icon" title="Move up" aria-label="Move up" onClick=${() => moveRow(i, -1)}>↑</button>
                  <button type="button" className="btn ghost sm icon" title="Move down" aria-label="Move down" onClick=${() => moveRow(i, 1)}>↓</button>
                  <button type="button" className="btn ghost sm" onClick=${() => setPl({ rows: pl.rows.filter((x, j) => j !== i) })}>Remove</button>
                </td>
              </tr>`
            )}
          </tbody>
        </table></div>
        <datalist id="prvals"><option value="yes" /><option value="no" /></datalist>
        <div className="actions">
          <button type="button" className="btn ghost sm" onClick=${() => setPl({ rows: [...pl.rows, { t: '', v: {} }] })}>Add a row</button>
          <button type="button" className="btn ghost sm" onClick=${() => setPl({ rows: [...pl.rows, { s: '' }] })}>Add a section heading</button>
        </div>
      </section>
      <div className="actions">
        <button className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save pricing'}</button>
        <button className="btn ghost" disabled=${busy} onClick=${() => window.confirm('Put the example rates and wording back in the form? Nothing changes on the website until you save.') && setF(JSON.parse(JSON.stringify(PRICING_DEFAULT)))}>Use the examples</button>
      </div>
    </div>`;
}
