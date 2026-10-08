/* ================= v66 Account performance and business reviews (CC-11) =================
   The client portal's "Business reviews" page (CrReviewsPage) and the staff desk's tab (CrReviewTab): a scorecard per
   period with each metric's definition, sample size and the records behind it (what the reader may see), the previous
   period beside it; business reviews prepared by StratEdge (the scorecard as it stood, decisions, improvement actions,
   commitments carried from earlier reviews), shared with the company, which leaves feedback. Lives in js/work.js. */
const RV_TONE = { draft: 'amber', shared: 'new', closed: '' };
const rvDay = ms => (ms ? fmtDay(ms) : '');
const rvPeriod = (s, e) => rvDay(s) + ' – ' + rvDay(e - 1);
const rvVal = m => (m.value == null ? html`<span className="muted">${m.n === 0 && (m.unit || '').startsWith('%') ? 'none' : 'unknown'}</span>` : m.unit.startsWith('%') ? m.value + '%' : m.unit === 'days' ? m.value + ' d' : String(m.value));
const rvDelta = (a, b, lowerIsBetter) => {
  if (a == null || b == null) return null;
  const d = Math.round((a - b) * 10) / 10;
  if (d === 0) return html`<span className="muted small">same</span>`;
  const better = lowerIsBetter ? d < 0 : d > 0;
  return html`<span className=${'small ' + (better ? 'ok' : 'amber')}>${d > 0 ? '+' : ''}${d}</span>`;
};
const RV_LOWER = { tts: true, ttd: true };

function RvScore({ score, defs, few, compact }) {
  const [open, setOpen] = useState('');
  const cur = score.cur;
  const prev = score.prev;
  const keys = ['tts', 'ttd', 'iv', 'starts', 'ret', 'issues'];
  const counts = (m, k) => (k === 'iv' && m.counts ? `${m.counts.interview} interviewed, ${m.counts.selected} selected, ${m.counts.declined} declined, ${m.counts.open} open` : k === 'issues' && m.counts ? `${m.counts.raised} raised, ${m.counts.ackOk} of ${m.counts.ackN} acknowledged in time, ${m.counts.resOk} of ${m.counts.resN} resolved in time, ${m.counts.escalated} escalated, ${m.counts.reopened} sent back` : '');
  return html`<div className="rvscore">
    <div className="tblwrap"><table className="tbl rvtbl"><thead><tr><th>Measure</th><th>${rvPeriod(cur.period.start, cur.period.end)}</th><th>Before (${rvPeriod(prev.period.start, prev.period.end)})</th><th className="r">Cases</th><th></th></tr></thead><tbody>
      ${keys.map(k => {
        const m = cur[k];
        const p = prev[k];
        return html`<${Fragment} key=${k}><tr>
          <td><b>${defs[k][0]}</b>${!compact && html`<div className="muted small">${defs[k][1]}</div>`}${counts(m, k) && html`<div className="small">${counts(m, k)}</div>`}</td>
          <td><b>${rvVal(m)}</b>${m.unit && m.value != null && !m.unit.startsWith('%') && m.unit !== 'days' ? ' ' + m.unit : m.unit.startsWith('%') && m.value != null ? ' ' + m.unit.slice(1) : ''}${m.unknown > 0 && html`<div className="muted small">${m.unknown} unknown${m.unknownWhy ? ' (' + m.unknownWhy + ')' : ''}</div>`}</td>
          <td>${rvVal(p)} ${rvDelta(m.value, p.value, RV_LOWER[k])}</td>
          <td className="r">${m.n}${m.few && m.n > 0 && html`<div><${Chip} s="amber">few cases<//></div>`}</td>
          <td className="r">${(m.items && m.items.length) || (m.excluded && m.excluded.length) || (Array.isArray(m.unknown) && m.unknown.length) ? html`<button type="button" className="btn ghost sm" onClick=${() => setOpen(open === k ? '' : k)}>${open === k ? 'Hide' : 'Behind it'}</button>` : null}</td>
        </tr>
        ${open === k && html`<tr className="rvdetail"><td colSpan="5">
          ${m.items && m.items.length > 0 && html`<div className="small"><b>Counted:</b> ${m.items.map(x => (x.ti || x.alias || x.id) + (x.reqTi ? ' (' + x.reqTi + ')' : '') + (x.days != null ? ': ' + x.days + ' d' + (x.hold ? ', ' + x.hold + ' d on hold taken out' : '') : '') + (x.st ? ': ' + x.st : '') + (x.sd ? ': start ' + x.sd : '')).join(' · ')}</div>`}
          ${Array.isArray(m.unknown) && m.unknown.length > 0 && html`<div className="small"><b>Unknown yet:</b> ${m.unknown.map(x => x.ti + (x.waiting != null ? ' (waiting ' + x.waiting + ' d)' : '')).join(' · ')}</div>`}
          ${m.excluded && m.excluded.length > 0 && html`<div className="small"><b>Left out:</b> ${m.excluded.join(' · ')}</div>`}
        </td></tr>`}
        <//>`;
      })}
      <tr><td><b>Volume</b><div className="muted small">Requests sent, first approved, filled or closed; candidates shared.</div></td><td>${cur.volume.sent} sent · ${cur.volume.approved} approved · ${cur.volume.closed} closed · ${cur.volume.shared} shared</td><td>${prev.volume.sent} · ${prev.volume.approved} · ${prev.volume.closed} · ${prev.volume.shared}</td><td></td><td></td></tr>
    </tbody></table></div>
    <p className="muted small" style=${{ margin: 0 }}>Each measure says what it counts and leaves unknown outcomes unknown. Fewer than ${few} cases is a list, not a rate.</p>
  </div>`;
}

function RvActions({ actions, manage, canToggle, onToggle, title }) {
  if (!actions.length) return null;
  return html`<div className="stack rvactions"><b>${title}</b><ul className="list">${actions.map(a => html`<li key=${a.id}><div><div className=${'t' + (a.st === 'done' ? ' rvdone' : '')}>${a.text}</div><div className="m">${a.owner ? 'Owner: ' + a.owner : ''}${a.due ? ' · due ' + a.due : ''}${a.reviewTi ? ' · from ' + a.reviewTi : ''}${a.st === 'done' ? ' · done by ' + a.doneBy + ', ' + fmtTs(a.doneAt) : ''}</div></div>${canToggle && html`<label className="check"><input type="checkbox" checked=${a.st === 'done'} onChange=${e => onToggle(a.id, e.target.checked)} /><span>Done</span></label>`}</li>`)}</ul></div>`;
}

function RvReview({ id, staff, onClose, onChanged }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [f, setF] = useState({ decision: '', text: '', owner: '', due: '', notes: null, rating: 0, msg: '' });
  const [busy, setBusy] = useState(false);
  const load = () => api('cr_rv_get', { id }).then(x => (setD(x), setErr(null)), setErr);
  useEffect(() => {
    load();
  }, [id]);
  const run = async (route, body, msg) => {
    setBusy(true);
    try {
      const r = await api(route, { id, ...body });
      setD(x => ({ ...(x || {}), review: r.review, open: r.open }));
      if (msg) toast(msg);
      onChanged && onChanged();
      return true;
    } catch (e) {
      toast(errText(e), true);
      return false;
    } finally {
      setBusy(false);
    }
  };
  if (err && !d) return html`<${Modal} wide title="Business review" onClose=${onClose}><${LoadError} error=${err} onRetry=${load} /><//>`;
  if (!d) return html`<${Modal} wide title="Business review" onClose=${onClose}><${Spinner} /><//>`;
  const r = d.review;
  const mine = (r.feedback || []).find(x => x.uid === d.me);
  const editable = staff && r.st !== 'closed';
  const foot = html`<button className="btn ghost" onClick=${onClose}>Close</button>${staff && r.st === 'draft' && html`<button className="btn" disabled=${busy} onClick=${async () => (await run('cr_rv_act', { act: 'share' }, 'Shared with ' + r.co + '.')) && onChanged && onChanged()}><${Icon} n="send" />Share with ${r.co}</button>`}${staff && r.st === 'shared' && html`<button className="btn" disabled=${busy} onClick=${() => run('cr_rv_act', { act: 'close' }, 'Closed.')}>Close the review</button>`}`;
  return html`<${Modal} wide title=${r.ti} onClose=${onClose} foot=${foot}>
    <div className="stack rvreview">
      <div className="muted small"><${Chip} s=${RV_TONE[r.st]}>${r.stN}<//> · ${rvPeriod(r.start, r.end)} · prepared by ${r.byN}, ${fmtTs(r.at)}${r.sharedAt ? ' · shared ' + fmtTs(r.sharedAt) : ''}${r.closedAt ? ' · closed ' + fmtTs(r.closedAt) : ''}</div>
      ${r.agenda && html`<section className="stack"><div className="ph-row"><h3 className="ph">Scorecard as it stood</h3>${editable && html`<button type="button" className="btn ghost sm" disabled=${busy} onClick=${() => run('cr_rv_save', { refresh: 1 }, 'Scorecard refreshed.')}>Refresh</button>`}</div><${RvScore} score=${r.agenda} defs=${d.defs} few=${d.few} compact=${true} /></section>`}
      ${(r.commitments || []).length > 0 && html`<section className="stack"><${RvActions} title="Commitments carried from earlier reviews" actions=${r.commitments} canToggle=${editable || (!staff && r.st === 'shared')} onToggle=${(aid, done) => run('cr_rv_act', { act: 'action', aid, done: done ? 1 : 0 })} /></section>`}
      <section className="stack"><div className="ph-row"><h3 className="ph">Notes</h3></div>${editable ? html`<div className="form stack"><textarea rows="3" value=${f.notes == null ? r.notes : f.notes} maxLength="6000" placeholder="What the period looked like, what the company said, what we agreed to look at." onInput=${e => setF({ ...f, notes: e.target.value })}></textarea>${f.notes != null && f.notes !== r.notes && html`<div><button type="button" className="btn sm" disabled=${busy} onClick=${async () => (await run('cr_rv_save', { notes: f.notes }, 'Notes saved.')) && setF({ ...f, notes: null })}>Save the notes</button></div>`}</div>` : r.notes ? html`<div className="crpre small">${r.notes}</div>` : html`<p className="muted small" style=${{ margin: 0 }}>No notes.</p>`}</section>
      <section className="stack"><div className="ph-row"><h3 className="ph">Decisions</h3></div>
        ${r.decisions.length ? html`<ul className="list">${r.decisions.map((x, i) => html`<li key=${i}><div><div className="t">${x.text}</div><div className="m">${x.by}, ${fmtTs(x.at)}</div></div></li>`)}</ul>` : html`<p className="muted small" style=${{ margin: 0 }}>No decision recorded yet.</p>`}
        ${editable && html`<div className="form stack crform2"><${Field} label="Record a decision"><input value=${f.decision} maxLength="1000" placeholder="e.g. Shortlists go out within 5 working days of approval from next quarter." onInput=${e => setF({ ...f, decision: e.target.value })} /><//><div><button type="button" className="btn sm" disabled=${busy || f.decision.trim().length < 5} onClick=${async () => (await run('cr_rv_save', { decision: f.decision }, 'Decision recorded.')) && setF({ ...f, decision: '' })}>Record</button></div></div>`}
      </section>
      <section className="stack"><div className="ph-row"><h3 className="ph">Improvement actions</h3></div>
        ${r.actions.length ? html`<${RvActions} title="" actions=${r.actions} canToggle=${editable || (!staff && r.st === 'shared')} onToggle=${(aid, done) => run('cr_rv_act', { act: 'action', aid, done: done ? 1 : 0 })} />` : html`<p className="muted small" style=${{ margin: 0 }}>No action yet.</p>`}
        ${editable && html`<div className="form stack crform2"><div className="row3"><${Field} label="Action"><input value=${f.text} maxLength="500" placeholder="What will be done" onInput=${e => setF({ ...f, text: e.target.value })} /><//><${Field} label="Owner"><input value=${f.owner} maxLength="120" placeholder="Who" onInput=${e => setF({ ...f, owner: e.target.value })} /><//><${Field} label="Due"><input type="date" value=${f.due} onInput=${e => setF({ ...f, due: e.target.value })} /><//></div><div><button type="button" className="btn sm" disabled=${busy || f.text.trim().length < 5} onClick=${async () => (await run('cr_rv_save', { action: { text: f.text, owner: f.owner, due: f.due } }, 'Action added.')) && setF({ ...f, text: '', owner: '', due: '' })}>Add the action</button></div></div>`}
      </section>
      <section className="stack"><div className="ph-row"><h3 className="ph">Feedback from ${r.co}</h3></div>
        ${r.feedback.length ? html`<ul className="list">${r.feedback.map((x, i) => html`<li key=${i}><div><div className="t">${'★'.repeat(x.rating)}${'☆'.repeat(5 - x.rating)} <span className="small">${x.rating} of 5</span></div><div className="m">${x.by}, ${fmtTs(x.at)}${x.text ? ' · ' + x.text : ''}</div></div></li>`)}</ul>` : html`<p className="muted small" style=${{ margin: 0 }}>${r.st === 'shared' ? 'No feedback yet.' : r.st === 'draft' ? 'The company sees it once shared.' : 'No feedback was left.'}</p>`}
        ${!staff && r.st === 'shared' && html`<div className="form stack crform2 rvfb"><span className="lbl">${mine ? 'Change your feedback' : 'Your feedback on the period'}</span><div className="rvstars" role="radiogroup" aria-label="Rating">${[1, 2, 3, 4, 5].map(n => html`<button key=${n} type="button" className=${'btn ghost sm' + ((f.rating || (mine && mine.rating) || 0) >= n ? ' on' : '')} aria-label=${n + ' of 5'} onClick=${() => setF({ ...f, rating: n })}>${(f.rating || (mine && mine.rating) || 0) >= n ? '★' : '☆'}</button>`)}</div><textarea rows="2" value=${f.msg} maxLength="3000" placeholder="What went well, what should change." onInput=${e => setF({ ...f, msg: e.target.value })}></textarea><div><button type="button" className="btn sm" disabled=${busy || !(f.rating || (mine && mine.rating))} onClick=${() => run('cr_rv_act', { act: 'feedback', rating: f.rating || (mine && mine.rating), msg: f.msg || (mine && mine.text) || '' }, 'Thank you; StratEdge is told.')}>Send feedback</button></div></div>`}
      </section>
    </div>
  <//>`;
}

function useRvHome(cid, days) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    setD(null);
  }, [cid, days]);
  useEffect(() => {
    const end = Date.now();
    api('cr_rv_home', { ...(cid ? { cid } : {}), start: end - days * 86400000, end }).then(x => (setD(x), setErr(null)), setErr);
  }, [cid, days, tick]);
  return [d, err, () => setTick(t => t + 1)];
}
function RvList({ d, staff, onOpen }) {
  return d.reviews.length
    ? html`<ul className="list rvlist">${d.reviews.map(r => html`<li key=${r.id}><div><div className="t">${r.ti}</div><div className="m"><${Chip} s=${RV_TONE[r.st]}>${r.stN}<//> ${rvPeriod(r.start, r.end)} · ${r.decisions.length} decision${r.decisions.length === 1 ? '' : 's'}, ${r.actions.length} action${r.actions.length === 1 ? '' : 's'}${r.feedback.length ? ' · ' + r.feedback.length + ' feedback' : ''}</div></div><button type="button" className="btn ghost sm" onClick=${() => onOpen(r.id)}>Open</button></li>`)}</ul>`
    : html`<${Empty} title="No business review yet">${staff ? 'Prepare one for a period: the scorecard is kept as it stands, with the decisions and actions you record; share it with the company for its feedback.' : 'StratEdge prepares periodic reviews and shares them here for your feedback.'}<//>`;
}

/* ---------- the client's page ---------- */
function CrReviewsPage({ q }) {
  const P = usePortal();
  const [days, setDays] = useState(90);
  const [d, err, reload] = useRvHome(P.cid, days);
  const [open, setOpen] = useState((q && q.v) || '');
  if (err && !d) return html`<${LoadError} error=${err} onRetry=${reload} />`;
  if (!d) return html`<${Spinner} label="Opening business reviews…" />`;
  return html`<div className="stack crpage rvpage">
    <div className="muted small">How the engagement with StratEdge is going, measured from the portal's own records: each measure with its definition, the cases behind it and the period before; and the business reviews StratEdge prepares, with the decisions, the improvement actions and your feedback.</div>
    <section className="panel stack"><div className="ph-row"><h2 className="ph">Scorecard</h2><div className="seg">${[[30, '30 days'], [90, '90 days'], [365, 'A year']].map(([k, n]) => html`<button key=${k} type="button" className=${days === k ? 'on' : ''} onClick=${() => setDays(k)}>${n}</button>`)}</div></div><${RvScore} score=${d.score} defs=${d.score.defs} few=${d.score.few} /></section>
    ${d.open.length > 0 && html`<section className="panel stack"><${RvActions} title="Open commitments from the reviews" actions=${d.open} canToggle=${false} /></section>`}
    <section className="panel stack"><div className="ph-row"><h2 className="ph">Business reviews</h2></div><${RvList} d=${d} staff=${false} onOpen=${setOpen} /></section>
    ${open && html`<${RvReview} id=${open} staff=${false} onClose=${() => setOpen('')} onChanged=${reload} />`}
  </div>`;
}

/* ---------- the staff desk tab ---------- */
function CrReviewTab({ cos, cid0, q }) {
  const toast = useToast();
  const [cid, setCid] = useState(cid0 || (q && q.c) || (cos[0] && cos[0].id) || '');
  const [days, setDays] = useState(90);
  const [d, err, reload] = useRvHome(cid, days);
  const [open, setOpen] = useState((q && q.v) || '');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (cid0) setCid(cid0);
  }, [cid0]);
  if (!cos.length) return html`<${Empty} title="No client companies">Add client companies under Clients first.<//>`;
  const pick = html`<div className="toolbar"><select value=${cid} aria-label="Client company" onChange=${e => setCid(e.target.value)}>${cos.map(x => html`<option key=${x.id} value=${x.id}>${x.n}</option>`)}</select><div className="seg">${[[30, '30 days'], [90, '90 days'], [365, 'A year']].map(([k, n]) => html`<button key=${k} type="button" className=${days === k ? 'on' : ''} onClick=${() => setDays(k)}>${n}</button>`)}</div><button className="btn push" disabled=${busy || !d} onClick=${async () => {
    setBusy(true);
    try {
      const end = Date.now();
      const r = await api('cr_rv_save', { cid, start: end - days * 86400000, end });
      toast('Prepared: ' + r.review.ti);
      reload();
      setOpen(r.review.id);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  }}><${Icon} n="plus" />Prepare a review (${days} days)</button></div>`;
  if (err && !d) return html`<div className="stack">${pick}<${LoadError} error=${err} onRetry=${reload} /></div>`;
  if (!d) return html`<div className="stack">${pick}<${Spinner} label="Opening business reviews…" /></div>`;
  return html`<div className="stack rvpage">
    ${pick}
    <section className="panel stack"><div className="ph-row"><h2 className="ph">Scorecard for ${d.co}</h2></div><${RvScore} score=${d.score} defs=${d.score.defs} few=${d.score.few} /></section>
    ${d.open.length > 0 && html`<section className="panel stack"><${RvActions} title="Open commitments" actions=${d.open} canToggle=${false} /></section>`}
    <section className="panel stack"><div className="ph-row"><h2 className="ph">Business reviews</h2></div><${RvList} d=${d} staff=${true} onOpen=${setOpen} /></section>
    ${open && html`<${RvReview} id=${open} staff=${true} onClose=${() => setOpen('')} onChanged=${reload} />`}
  </div>`;
}
