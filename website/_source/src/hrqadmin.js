/* ================= v37.3 HRMS › Update requests: ask people for details and documents, review what they send ================= */
function HRUpdateRequests({ staff, q }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [meta, setMeta] = useState(null);
  const [view, setView] = useState('review');
  const [make, setMake] = useState(null);
  const [open, setOpen] = useState((q && q.hrq) || null);
  const [exp, setExp] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    api('hrq_meta', {}).then(setMeta).catch(() => setMeta(null));
  }, []);
  useEffect(() => {
    api('hrq_list', {})
      .then(setD)
      .catch(e => {
        toast(errText(e), true);
        setD({ rows: [], counts: {}, late: 0 });
      });
  }, [tick]);
  if (!d || !meta) return html`<${Spinner} />`;
  const c = d.counts || {};
  const groups = { review: ['submitted'], waiting: ['open', 'returned'], done: ['approved', 'partial', 'rejected', 'cancelled'], all: null };
  const rows = d.rows.filter(r => !groups[view] || groups[view].includes(r.st));
  const reload = () => setTick(t => t + 1);
  return html`<div className="stack">
      <${KitStats} items=${[
        { v: c.submitted || 0, l: 'Sent in, to review', tone: c.submitted ? 'warn' : undefined, onClick: () => setView('review') },
        { v: (c.open || 0) + (c.returned || 0), l: 'Waiting for people', onClick: () => setView('waiting') },
        { v: d.late || 0, l: 'Past their date', tone: d.late ? 'warn' : undefined, onClick: () => setView('waiting') },
        { v: (c.approved || 0) + (c.partial || 0), l: 'Approved', onClick: () => setView('done') },
      ]} />
      <div className="toolbar">
        <div className="seg">${[['review', 'To review'], ['waiting', 'Waiting'], ['done', 'Decided'], ['all', 'All']].map(([k, n]) => html`<button key=${k} type="button" className=${view === k ? 'on' : ''} onClick=${() => setView(k)}>${n}</button>`)}</div>
        <div className="push">
          <button type="button" className="btn ghost" onClick=${() => setExp(true)}><${Icon} n="clock" />Expiring documents</button>
          <button type="button" className="btn" onClick=${() => setMake({})}><${Icon} n="send" />Ask for updates</button>
        </div>
      </div>
      ${
        rows.length
          ? html`<section className="panel" style=${{ padding: '6px 8px' }}><div className="tblwrap"><table className="tbl click">
              <thead><tr><th>Person</th><th>What</th><th>Status</th><th>Due</th><th>Updated</th></tr></thead>
              <tbody>${rows.map(
                r => html`<tr key=${r.id} tabIndex="0" onClick=${() => setOpen(r.id)} onKeyDown=${e => { if (e.key === 'Enter') setOpen(r.id); }}>
                  <td><b>${r.n}</b>${r.origin === 'self' ? html`<div className="muted small">asked by them</div>` : html`<div className="muted small">asked by ${r.byn}</div>`}</td>
                  <td className="small">${r.what}</td>
                  <td><${Chip} s=${hrqTone(r.st)}>${(meta.st || {})[r.st] || r.st}<//></td>
                  <td className=${'small nw' + (r.late ? ' late' : '')}>${r.due ? hrqDay(r.due) : '—'}</td>
                  <td className="small nw">${fmtDay(r.u)}</td>
                </tr>`
              )}</tbody>
            </table></div></section>`
          : html`<${Empty} title=${view === 'review' ? 'Nothing to review' : 'No requests here'} action=${html`<button type="button" className="btn" onClick=${() => setMake({})}>Ask for updates</button>`}>Ask employees and consultants to confirm or update their details (address, emergency contact, education…) and to send documents (a renewed passport, EAD, W-4…). They fill it in from their Profile page; you approve each change before it is saved.<//>`
      }
      ${make && html`<${HrqNew} meta=${meta} staff=${staff} init=${make} onClose=${() => setMake(null)} onSent=${() => { setMake(null); reload(); }} />`}
      ${open && html`<${HrqReview} id=${open} meta=${meta} onClose=${() => setOpen(null)} onChanged=${reload} />`}
      ${exp && html`<${HrqExpiring} onClose=${() => setExp(false)} onAsk=${x => { setExp(false); setMake(x); }} />`}
    </div>`;
}
function HrqNew({ meta, staff, init, onClose, onSent }) {
  const toast = useToast();
  const people = staff.filter(m => m.role !== 'employer');
  const [uids, setUids] = useState(init.uids || []);
  const [find, setFind] = useState('');
  const [secs, setSecs] = useState(init.secs || []);
  const [docs, setDocs] = useState(init.docs || []);
  const [note, setNote] = useState(init.note || '');
  const [due, setDue] = useState(init.due || addDays(dkey(), 7));
  const [busy, setBusy] = useState(false);
  const fl = find.trim().toLowerCase();
  const shown = people.filter(m => !fl || [m.u.p.n, m.u.p.e].join(' ').toLowerCase().includes(fl));
  const flip = k => setSecs(secs.includes(k) ? secs.filter(x => x !== k) : [...secs, k]);
  const docOn = k => docs.find(x => x.k === k);
  const flipDoc = d => setDocs(docOn(d.k) ? docs.filter(x => x.k !== d.k) : [...docs, { k: d.k, exp: d.exp, note: '' }]);
  const upDoc = (k, patch) => setDocs(docs.map(x => (x.k === k ? { ...x, ...patch } : x)));
  const send = async () => {
    setBusy(true);
    try {
      const r = await api('hrq_create', { uids, secs, docs, note, due });
      toast('Sent to ' + plural0(r.made.length, 'person', 'people') + '. They get a task and an email.' + (r.skipped.length ? ' Not sent (no active login or a client contact): ' + r.skipped.join(', ') + '.' : ''));
      onSent();
    } catch (e) {
      toast(errText(e), true);
      setBusy(false);
    }
  };
  return html`<${Modal} wide title="Ask for updates" onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Cancel</button><button type="button" className="btn" disabled=${busy || !uids.length || (!secs.length && !docs.length)} onClick=${send}>${busy ? 'Sending…' : 'Send to ' + plural0(uids.length, 'person', 'people')}</button>`}>
      <div className="stack hrqnew">
        <div className="g2" style=${{ alignItems: 'start' }}>
          <div className="stack" style=${{ gap: 8 }}>
            <b className="small">Who</b>
            <div className="actions"><input type="search" value=${find} onInput=${e => setFind(e.target.value)} placeholder="Find people" aria-label="Find people" style=${{ maxWidth: 220 }} /><button type="button" className="btn ghost sm" onClick=${() => setUids([...new Set([...uids, ...shown.map(m => m.id)])])}>Choose everyone shown</button>${uids.length ? html`<button type="button" className="btn ghost sm" onClick=${() => setUids([])}>Clear</button>` : null}</div>
            <div className="hrqpeople">${shown.map(m => html`<label key=${m.id} className="check small"><input type="checkbox" checked=${uids.includes(m.id)} onChange=${e => setUids(e.target.checked ? [...uids, m.id] : uids.filter(x => x !== m.id))} /><span>${m.u.p.n} <span className="muted">${m.u.p.e}</span></span></label>`)}</div>
          </div>
          <div className="stack" style=${{ gap: 8 }}>
            <b className="small">Details to confirm or update</b>
            ${meta.secs.map(s => html`<label key=${s.k} className="check"><input type="checkbox" checked=${secs.includes(s.k)} onChange=${() => flip(s.k)} /><span>${s.n} <span className="muted small">(${s.f.map(f => f.n.toLowerCase()).join(', ')})</span></span></label>`)}
            <b className="small">Documents to send</b>
            <div className="portalpicks wide">${meta.docs.map(dd => html`<label key=${dd.k} className=${'pick' + (docOn(dd.k) ? ' on' : '')}><input type="checkbox" checked=${!!docOn(dd.k)} onChange=${() => flipDoc(dd)} /><span>${dd.n}</span></label>`)}</div>
            ${docs.map(x => html`<div key=${x.k} className="hrqdocopt"><b className="small">${hrqDocName(meta, x.k)}</b><label className="check small"><input type="checkbox" checked=${!!x.exp} onChange=${e => upDoc(x.k, { exp: e.target.checked })} /><span>Ask for its expiry date</span></label><input value=${x.note} onInput=${e => upDoc(x.k, { note: e.target.value })} placeholder="A note about it (optional)" maxLength="160" aria-label=${'Note about the ' + hrqDocName(meta, x.k)} /></div>`)}
          </div>
        </div>
        <div className="row2">
          <${Field} label="Message (optional)"><textarea value=${note} onInput=${e => setNote(e.target.value)} maxLength="1000" placeholder="e.g. Our yearly check of employee records" /><//>
          <${Field} label="Due by" hint="A reminder goes out the day before, and once more if it passes."><input type="date" value=${due} min=${dkey()} onInput=${e => setDue(e.target.value)} /><//>
        </div>
      </div>
    <//>`;
}
function HrqReview({ id, meta, onClose, onChanged }) {
  const toast = useToast();
  const [x, setX] = useState(null);
  const [ok, setOk] = useState({});
  const [fok, setFok] = useState({});
  const [msg, setMsg] = useState('');
  const [comp, setComp] = useState(true);
  const [busy, setBusy] = useState('');
  const load = () =>
    api('hrq_get', { id })
      .then(r => {
        setX(r.q);
        const o = {};
        if (r.q.sub) Object.keys(r.q.sub.vals || {}).forEach(k => (o[k] = true));
        setOk(o);
        const f = {};
        (r.q.files || []).forEach(ff => (f[ff.id] = true));
        setFok(f);
      })
      .catch(e => {
        toast(errText(e), true);
        onClose();
      });
  useEffect(() => {
    load();
  }, [id]);
  if (!x) return html`<${Modal} title="Profile update" onClose=${onClose}><${Spinner} /><//>`;
  const cur = x.cur || {};
  const vals = (x.sub && x.sub.vals) || {};
  const diff = Object.keys(vals).filter(k => String(cur[k] || '') !== String(vals[k] || ''));
  const act = async a => {
    if (a !== 'approve' && !msg.trim()) return toast(a === 'return' ? 'Say what they should change.' : 'Say why it is declined.', true);
    setBusy(a);
    try {
      const r = await api('hrq_review', { id, act: a, ok, fok, msg, comp });
      toast({ returned: 'Sent back to them.', approved: 'Approved and saved.', partial: 'Part of it approved and saved.', rejected: 'Declined.' }[r.st] + (r.changed && r.changed.length ? ' Updated: ' + r.changed.join(', ') + '.' : '') + (r.kept ? ' ' + plural0(r.kept, 'document') + ' added to their Documents.' : '') + (r.comp && r.comp.length ? ' Compliance dates: ' + r.comp.join(', ') + '.' : ''));
      onChanged();
      onClose();
    } catch (e) {
      toast(errText(e), true);
      setBusy('');
    }
  };
  const simple = async (route, done) => {
    setBusy(route);
    try {
      await api(route, { id });
      toast(done);
      onChanged();
      onClose();
    } catch (e) {
      toast(errText(e), true);
      setBusy('');
    }
  };
  const sub = x.st === 'submitted';
  const compKinds = ['passport', 'visa', 'i797', 'i94', 'ead'];
  const foot = sub
    ? html`<button type="button" className="btn ghost danger" style=${{ marginRight: 'auto' }} disabled=${!!busy} onClick=${() => act('reject')}>Decline</button><button type="button" className="btn ghost" disabled=${!!busy} onClick=${() => act('return')}>Send back for changes</button><button type="button" className="btn" disabled=${!!busy} onClick=${() => act('approve')}>${busy === 'approve' ? 'Saving…' : 'Approve the ticked'}</button>`
    : ['open', 'returned'].includes(x.st)
      ? html`<button type="button" className="btn ghost danger" style=${{ marginRight: 'auto' }} disabled=${!!busy} onClick=${() => confirm('Cancel this request?') && simple('hrq_cancel', 'Cancelled.')}>Cancel the request</button><button type="button" className="btn" disabled=${!!busy} onClick=${() => simple('hrq_remind', 'Reminder sent: a task and an email.')}>Remind them</button>`
      : html`<button type="button" className="btn ghost" onClick=${onClose}>Close</button>`;
  return html`<${Modal} wide title=${'Profile update · ' + x.n} onClose=${onClose} foot=${foot}>
      <div className="stack hrqreview">
        <div className="actions"><${Chip} s=${hrqTone(x.st)}>${(meta.st || {})[x.st] || x.st}<//><span className="small">${x.origin === 'self' ? 'Asked by ' + x.n : 'Asked by ' + (x.byn || 'HR')} · ${fmtDay(x.at)}${x.due ? ' · due ' + hrqDay(x.due) : ''}</span></div>
        ${x.note ? html`<p className="small" style=${{ margin: 0 }}>Message: "${x.note}"</p>` : null}
        ${x.sub && x.sub.msg ? html`<div className="note info"><span>${x.n}: "${x.sub.msg}"</span></div>` : null}
        ${x.purged ? html`<p className="muted small">The values were cleared 180 days after the decision; the history below says what changed.</p>` : null}
        ${
          x.sub && !x.purged
            ? (x.secs || []).map(sk => {
                const s = meta.secs.find(y => y.k === sk);
                if (!s) return null;
                return html`<section key=${sk} className="hrqsec"><h3>${s.n}</h3><table className="tbl small hrqdiff"><thead><tr><th>Field</th><th>On file</th><th>Sent</th>${sub ? html`<th className="c">Approve</th>` : null}</tr></thead><tbody>${s.f.map(f => {
                  const ch = String(cur[f.k] || '') !== String(vals[f.k] || '');
                  return html`<tr key=${f.k} className=${ch ? 'chg' : ''}><td>${f.n}</td><td>${cur[f.k] || html`<span className="muted">—</span>`}${f.k === 'ecn' && cur._emg && !cur.ecn ? html`<div className="muted">on file: ${cur._emg}</div>` : null}</td><td>${ch ? html`<b>${vals[f.k] || '(empty)'}</b>` : html`<span className="muted">no change</span>`}</td>${sub ? html`<td className="c">${ch ? html`<input type="checkbox" checked=${!!ok[f.k]} onChange=${e => setOk({ ...ok, [f.k]: e.target.checked })} aria-label=${'Approve ' + f.n} />` : '—'}</td>` : null}</tr>`;
                })}</tbody></table></section>`;
              })
            : x.st !== 'submitted' && !x.sub
              ? html`<p className="muted small" style=${{ margin: 0 }}>Waiting for ${x.n} to fill it in: ${hrqWhatOf(x, meta)}.</p>`
              : null
        }
        ${
          (x.files || []).length > 0 &&
          html`<section className="hrqsec"><h3>Documents</h3><table className="tbl small"><thead><tr><th>Document</th><th>File</th><th>Expires</th>${sub ? html`<th className="c">Approve</th>` : null}</tr></thead><tbody>${x.files.map(f => html`<tr key=${f.id}><td>${hrqDocName(meta, f.k)}</td><td><a href=${fileUrl('hrms/main/hrq/' + id, f.id)} target="_blank" rel="noopener">${f.n}</a> <span className="muted">${sizeLabel(f.sz)}</span></td><td className="nw">${f.exp ? hrqDay(f.exp) : '—'}</td>${sub ? html`<td className="c"><input type="checkbox" checked=${!!fok[f.id]} onChange=${e => setFok({ ...fok, [f.id]: e.target.checked })} aria-label=${'Approve ' + f.n} /></td>` : null}</tr>`)}</tbody></table></section>`
        }
        ${sub && (x.files || []).some(f => compKinds.includes(f.k) && f.exp) && x.comp ? html`<label className="check small"><input type="checkbox" checked=${comp} onChange=${e => setComp(e.target.checked)} /><span>Also update their compliance dates from the approved documents' expiry dates</span></label>` : null}
        ${sub ? html`<${Field} label="Comment for them" hint="Needed to send it back or decline; optional when approving."><textarea value=${msg} onInput=${e => setMsg(e.target.value)} maxLength="1000" /><//>` : null}
        ${sub && !diff.length && !(x.files || []).length ? html`<p className="muted small" style=${{ margin: 0 }}>They confirmed everything on file without changes.</p>` : null}
        ${
          (x.log || []).length > 0 &&
          html`<details><summary className="small">History (${x.log.length})</summary><ul className="jtimeline">${[...x.log].reverse().map((l, i) => html`<li key=${i}><span className="muted small nw">${fmtTs(l.t)}</span><div className="small"><b>${l.who}</b> ${l.ev}</div></li>`)}</ul></details>`
        }
      </div>
    <//>`;
}
function HrqExpiring({ onClose, onAsk }) {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  useEffect(() => {
    api('hrq_expiring', {})
      .then(r => setRows(r.rows))
      .catch(e => {
        toast(errText(e), true);
        setRows([]);
      });
  }, []);
  return html`<${Modal} wide title="Documents expiring within 60 days" onClose=${onClose}>
      ${
        !rows
          ? html`<${Spinner} />`
          : rows.length
            ? html`<div className="tblwrap"><table className="tbl small"><thead><tr><th>Person</th><th>Document</th><th>Expires</th><th /></tr></thead><tbody>${rows.map(
                r => html`<tr key=${r.fid}><td><b>${r.n}</b></td><td>${r.kn}<div className="muted">${r.fn}</div></td><td className=${'nw' + (r.late ? ' late' : '')}>${r.late ? 'Expired ' : ''}${hrqDay(r.exp)}</td><td className="r"><button type="button" className="btn ghost sm" onClick=${() => onAsk({ uids: [r.uid], docs: [{ k: r.k || 'other', exp: true, note: '' }], note: 'Your ' + r.kn.toLowerCase() + ' on file ' + (r.late ? 'expired on ' : 'expires on ') + hrqDay(r.exp) + '. Please send the renewed one.', due: addDays(dkey(), 14) })}>Ask for a new one</button></td></tr>`
              )}</tbody></table></div>`
            : html`<${Empty} title="Nothing expiring">Documents approved through update requests (and any with an expiry date) show here 60 days before they expire.<//>`
      }
    <//>`;
}
