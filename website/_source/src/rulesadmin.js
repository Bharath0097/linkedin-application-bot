/* ================= Admin & HR: consultant types and job rules (v32) =================
   Which engagement types (C2C, W2, 1099, contract-to-hire, full-time, SOW) each kind of consultant sees and may apply
   to, e.g. C2C consultants never get full-time requirements; the same rules filter the requirements desk's
   matches and requirement emails. People: each portal consultant's and student's type, plus engagement types
   allowed for one person only. Sign-ups: whether students and outside consultants get their portal right away,
   whether outside consultants need a membership to apply, and the daily application limit. */
function JobRulesPage({ q }) {
  const toast = useToast();
  const [tab, setTab] = useState((q && q.tab) || 'rules');
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () =>
    api('rules_get').then(
      r => {
        setErr(null);
        setD(r);
        setF(JSON.parse(JSON.stringify(r.settings)));
      },
      e => setErr(e)
    );
  useEffect(() => {
    load();
  }, []);
  if (err) return html`<${LoadError} error=${err} onRetry=${load} />`;
  if (!d || !f) return html`<${Spinner} />`;
  const dirty = JSON.stringify(f) !== JSON.stringify(d.settings);
  const save = async () => {
    setBusy(true);
    try {
      await api('rules_save', { settings: f });
      toast('Saved. Matches, applications and requirement emails follow the new rules.');
      load();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const cell = (ct, e) => {
    const on = !!(f.m[ct] || {})[e];
    return html`<td key=${e} className="c"><label className=${'rulecell' + (on ? ' on' : '')} title=${(on ? 'Allowed: ' : 'Blocked: ') + e + ' roles for ' + d.kinds[ct]}><input type="checkbox" checked=${on} onChange=${() => setF({ ...f, m: { ...f.m, [ct]: { ...f.m[ct], [e]: !on } } })} aria-label=${e + ' roles for ' + d.kinds[ct]} /><span>${on ? 'Yes' : 'No'}</span></label></td>`;
  };
  return html`<div className="stack jobrules">
      <${KitTabs} tab=${tab} onTab=${setTab} tabs=${[['rules', 'Who sees which roles'], ['people', 'People', d.people.length || null], ['signup', 'Sign-ups & limits']]} />
      ${
        tab === 'rules' &&
        html`<${Fragment}>
          <p className="muted small" style=${{ margin: 0, maxWidth: 820 }}>A "No" hides that kind of role from that kind of consultant: it is left out of their matched jobs, they cannot apply to it, the requirements desk does not suggest them for it, and requirement emails to them leave it out. A role whose type says nothing (just "Contract") is open to everyone. People with no type (StratEdge staff, placed consultants not yet typed) see everything.</p>
          <section className="panel" style=${{ padding: '6px 8px' }}><div className="tblwrap"><table className="tbl rulegrid">
            <thead><tr><th>Consultant type</th>${d.eng.map(e => html`<th key=${e} className="c">${e}</th>`)}<th className="r">People</th></tr></thead>
            <tbody>${ctEntries(d.kinds).map(([ct, n]) => html`<tr key=${ct}><td><b>${n}</b></td>${d.eng.map(e => cell(ct, e))}<td className="r">${(d.counts[ct] || 0) + (d.cand[ct] ? ' + ' + d.cand[ct] + ' in the database' : '')}</td></tr>`)}</tbody>
          </table></div></section>
          <section className="panel">
            <label className="check"><input type="checkbox" checked=${f.auth} onChange=${e => setF({ ...f, auth: e.target.checked })} /><span><b>Also hide roles whose work authorization leaves the person out</b> (for example "USC/GC only" for an H-1B consultant, or "No OPT"). A role that names no authorization is open to all.</span></label>
          </section>
          <div className="actions"><button type="button" className="btn" disabled=${busy || !dirty} onClick=${save}>${busy ? 'Saving…' : 'Save the rules'}</button>${dirty && html`<button type="button" className="btn ghost" onClick=${() => setF(JSON.parse(JSON.stringify(d.settings)))}>Undo changes</button>`}</div>
        <//>`
      }
      ${tab === 'people' && html`<${RulesPeople} d=${d} onChanged=${load} />`}
      ${
        tab === 'signup' &&
        html`<${Fragment}>
          <section className="panel form">
            <h3 className="ph" style=${{ margin: 0 }}>Sign-ups</h3>
            <label className="check"><input type="checkbox" checked=${f.open.student} onChange=${e => setF({ ...f, open: { ...f.open, student: e.target.checked } })} /><span><b>Students get their portal right away</b>: no review; their plan decides what they can use. Off: HR approves each student under Team.</span></label>
            <label className="check"><input type="checkbox" checked=${f.open.outside} onChange=${e => setF({ ...f, open: { ...f.open, outside: e.target.checked } })} /><span><b>Outside consultants get their portal right away</b> when they sign up as outside consultants (membership). Off: HR approves them like everyone else.</span></label>
            <${Field} label="A consultant who signs up and is not approved yet counts as"><select value=${f.newCt} onChange=${e => setF({ ...f, newCt: e.target.value })}><option value="outside">An outside consultant (their rules and fees apply)</option><option value="">No type (no limits) until HR sets one</option></select><//>
          </section>
          <section className="panel form">
            <h3 className="ph" style=${{ margin: 0 }}>Applying through the portal</h3>
            <label className="check"><input type="checkbox" checked=${f.member} onChange=${e => setF({ ...f, member: e.target.checked })} /><span><b>Outside consultants need an active membership to apply</b> (when membership plans are published under Plans & payments). Students always need a plan that includes job applications.</span></label>
            <${Field} label="Applications a day per outside consultant or student (0 = no limit)"><input type="number" min="0" max="500" value=${f.limit} onChange=${e => setF({ ...f, limit: Math.max(0, Math.min(500, parseInt(e.target.value, 10) || 0)) })} style=${{ maxWidth: 140 }} /><//>
            <p className="muted small" style=${{ margin: 0 }}>Placement fees per engagement type are set under Plans & payments > Placement fees; people agree to them before applying.</p>
          </section>
          <div className="actions"><button type="button" className="btn" disabled=${busy || !dirty} onClick=${save}>${busy ? 'Saving…' : 'Save'}</button></div>
        <//>`
      }
    </div>`;
}
function RulesPeople({ d, onChanged }) {
  const toast = useToast();
  const [qs, setQs] = useState('');
  const [ct, setCt] = useState('*');
  const [edit, setEdit] = useState({});
  const [busy, setBusy] = useState('');
  const ql = qs.trim().toLowerCase();
  const list = d.people.filter(p => (ct === '*' || p.eff === ct) && (!ql || (p.n + ' ' + p.e).toLowerCase().includes(ql)));
  const cur = p => edit[p.id] || { ct: p.ct, ctx: p.ctx };
  const save = async p => {
    const v = cur(p);
    setBusy(p.id);
    try {
      await api('rules_person', { uid: p.id, ct: v.ct, ctx: v.ctx });
      toast('Saved for ' + firstName(p.n) + '.');
      setEdit(x => {
        const n = { ...x };
        delete n[p.id];
        return n;
      });
      onChanged();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  return html`<div className="stack">
      <div className="toolbar" style=${{ gap: 8, flexWrap: 'wrap' }}>
        <input type="search" style=${{ maxWidth: 260 }} placeholder="Search people" value=${qs} onInput=${e => setQs(e.target.value)} aria-label="Search people" />
        <select value=${ct} onChange=${e => setCt(e.target.value)} aria-label="Type"><option value="*">Every type</option><option value="">No type</option>${ctEntries(d.kinds).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select>
      </div>
      <p className="muted small" style=${{ margin: 0 }}>Portal consultants and students. The type can also be set on a person's Team card; the consultant database has its own "Works as" field for people without a portal account.</p>
      ${
        list.length
          ? html`<section className="panel" style=${{ padding: '6px 8px' }}><div className="tblwrap"><table className="tbl">
              <thead><tr><th>Person</th><th>Status</th><th>Work authorization</th><th>Type</th><th>Also allowed for this person</th><th className="r"><span className="sr">Save</span></th></tr></thead>
              <tbody>${list.map(p => {
                const v = cur(p);
                const changed = !!edit[p.id];
                return html`<tr key=${p.id}>
                  <td><b>${p.n || p.e}</b><div className="muted small">${p.e} · ${p.role === 'student' ? 'Student portal' : 'Consultant portal'}</div></td>
                  <td>${p.st === 'active' ? html`<span className="chip ok">Active</span>` : p.st === 'inactive' ? html`<span className="chip red">Paused</span>` : html`<span className="chip amber">Waiting</span>`}</td>
                  <td className="small">${p.auth || '—'}</td>
                  <td><select value=${v.ct} onChange=${e => setEdit({ ...edit, [p.id]: { ...v, ct: e.target.value } })} aria-label=${'Type for ' + p.n}><option value="">${p.eff && !p.ct ? 'Default (' + (d.kinds[p.eff] || p.eff) + ')' : 'No type (no limits)'}</option>${ctEntries(d.kinds).map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select></td>
                  <td><div className="actions" style=${{ flexWrap: 'wrap', gap: 4 }}>${d.eng.map(e => html`<button key=${e} type="button" className=${'chip' + (v.ctx.includes(e) ? ' new' : '')} style=${{ border: 0, cursor: 'pointer' }} aria-pressed=${v.ctx.includes(e)} onClick=${() => setEdit({ ...edit, [p.id]: { ...v, ctx: v.ctx.includes(e) ? v.ctx.filter(x => x !== e) : [...v.ctx, e] } })}>${e}</button>`)}</div></td>
                  <td className="r">${changed && html`<button type="button" className="btn sm" disabled=${busy === p.id} onClick=${() => save(p)}>Save</button>`}</td>
                </tr>`;
              })}</tbody>
            </table></div></section>`
          : html`<section className="panel"><${Empty} title=${d.people.length ? 'Nobody matches' : 'No portal consultants or students yet'}><//></section>`
      }
    </div>`;
}
