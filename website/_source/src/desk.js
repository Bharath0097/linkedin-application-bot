/* ================= v34: Help & support (the service desk) =================
   Everyone: the Help button (a support bot that searches the knowledge base, then raises a ticket), the Help & support
   page (my requests, report a problem, request something from the catalog, the knowledge base) and email replies.
   The people in an assignment group work tickets here too: the ticket view has their controls, and the Team queue
   tab (or Service desk in the staff portals) lists the work. Server: api/desk.php. */
const DESK_ST_CHIP = { approval: 'amber', new: 'new', assigned: 'new', progress: 'new', hold: 'amber', resolved: 'ok', closed: '', cancelled: '' };
const DESK_PRI_CHIP = { 1: 'red', 2: 'amber', 3: 'new', 4: '' };
const DESK_PRI_NAME = { 1: 'P1 Critical', 2: 'P2 High', 3: 'P3 Moderate', 4: 'P4 Low' };
const DESK_STEPS = [['new', 'New'], ['assigned', 'Assigned'], ['progress', 'In progress'], ['hold', 'On hold'], ['resolved', 'Resolved'], ['closed', 'Closed']];
const DESK_HOLD_NAMES = { caller: 'Waiting for the requester', vendor: 'Waiting for an outside company', change: 'Waiting for a planned change' };
const DESK_RES_NAMES = { solved: 'Fixed', workaround: 'Worked around (a workaround for now)', answered: 'Question answered', duplicate: 'Duplicate of another ticket', noaction: 'No action needed' };
const deskPri = p => html`<${Chip} s=${DESK_PRI_CHIP[p]}>${DESK_PRI_NAME[p] || 'P' + p}<//>`;
const deskSt = t => html`<${Chip} s=${DESK_ST_CHIP[t.st]}>${t.stName}<//>`;
// the same as deskPri() in api/desk.php: impact x urgency, and someone who can't work at all is never below P2
const deskPriOf = (i, u) => {
  const s = (+i || 3) + (+u || 3);
  const p = s <= 2 ? 1 : s === 3 ? 2 : s === 4 ? 3 : 4;
  return +u === 1 ? Math.min(p, 2) : p;
};
/** "in 3 h" / "2 h late" for an SLA target. */
const deskDue = (at, done) => {
  if (done) return 'met';
  const m = Math.round((at - Date.now()) / 60000);
  const f = x => (x < 60 ? x + ' min' : x < 2880 ? Math.round(x / 60) + ' h' : Math.round(x / 1440) + ' days');
  return m >= 0 ? 'in ' + f(m) : f(-m) + ' late';
};
const DESK_KINDS = [['incident', 'Report a problem'], ['request', 'Request something'], ['feedback', 'Send feedback']];

/* ---- the knowledge base: the article reader ---- */
function DeskArticle({ id, onBack, onTicket }) {
  const [a, setA] = useState(null);
  const [voted, setVoted] = useState(false);
  const toast = useToast();
  useEffect(() => {
    api('desk_kb_get', { id }).then(r => setA(r.article), e => toast(errText(e), true));
  }, [id]);
  if (!a) return html`<${Spinner} />`;
  const vote = up =>
    api('desk_kb_vote', { id, up }).then(() => {
      setVoted(true);
      if (!up && onTicket) onTicket(a);
    });
  return html`<article className="panel stack kbart" style=${{ gap: 10 }}>
      ${onBack && html`<div><button type="button" className="btn ghost sm" onClick=${onBack}><${Icon} n="left" />Back</button></div>`}
      <span className="muted small">${a.catName}</span>
      <h2 className="ph" style=${{ margin: 0 }}>${a.t}</h2>
      ${a.body.split(/\n{2,}/).map((p, i) =>
        /^- /m.test(p) ? html`<ul key=${i}>${p.split('\n').map((l, j) => html`<li key=${j}>${l.replace(/^- /, '')}</li>`)}</ul>` : html`<p key=${i}>${p}</p>`
      )}
      <div className="actions kbvote">${voted ? html`<span className="muted small">Thanks for telling us.</span>` : html`<span className="small">Did this answer your question?</span><button type="button" className="btn ghost sm" onClick=${() => vote(true)}>Yes</button><button type="button" className="btn ghost sm" onClick=${() => vote(false)}>No, I still need help</button>`}</div>
    </article>`;
}
function DeskKb({ onTicket, initial }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(initial || null);
  useEffect(() => {
    const t = setTimeout(() => api('desk_kb', { q }).then(r => setList(r.articles), () => setList([])), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [q]);
  if (open) return html`<${DeskArticle} id=${open} onBack=${() => setOpen(null)} onTicket=${onTicket} />`;
  return html`<div className="stack" style=${{ gap: 12 }}>
      <input type="search" value=${q} onInput=${e => setQ(e.target.value)} placeholder="Search help articles: password, paystub, timesheet…" aria-label="Search help articles" />
      ${
        !list
          ? html`<${Spinner} />`
          : list.length
            ? html`<div className="kblist">${list.map(a => html`<button key=${a.id} type="button" className="kbitem" onClick=${() => setOpen(a.id)}><b>${a.t}</b><span className="muted small">${a.catName}${a.aud === 'staff' ? ' · staff only' : ''}</span><span className="small">${a.snip}…</span></button>`)}</div>`
            : html`<${Empty} title="No article matches">Try other words, or raise a ticket and a person will help.<//>`
      }
    </div>`;
}

/* ---- raising a ticket: a problem, a catalog request, or feedback ---- */
function DeskNew({ home, preset, onCreated }) {
  const toast = useToast();
  const [kind, setKind] = useState((preset && preset.kind) || 'incident');
  const [item, setItem] = useState((preset && preset.item) || null);
  const [f, setF] = useState({ title: (preset && preset.title) || '', body: (preset && preset.body) || '', cat: (preset && preset.cat) || '', impact: 3, urgency: 3, rating: 0, vars: {} });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const pri = deskPriOf(f.impact, f.urgency);
  const send = async () => {
    setBusy(true);
    try {
      const r = await api('desk_create', { kind, item: item && item.id, title: f.title, body: f.body, cat: f.cat, impact: f.impact, urgency: f.urgency, vars: f.vars, rating: f.rating, page: (preset && preset.page) || '', src: (preset && preset.src) || 'portal' });
      toast(`${r.ticket.num} raised. We sent you a confirmation by email.`);
      onCreated && onCreated(r.ticket);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<div className="stack" style=${{ gap: 14 }}>
      <div className="seg" role="tablist" aria-label="What do you need?">${DESK_KINDS.map(([k, v]) => html`<button key=${k} type="button" role="tab" aria-selected=${kind === k} className=${kind === k ? 'on' : ''} onClick=${() => { setKind(k); setItem(null); }}>${v}</button>`)}</div>
      ${
        kind === 'request' && !item &&
        html`<div className="deskcat">${(home.catalog || []).map(c => html`<button key=${c.id} type="button" className="deskcatitem" onClick=${() => setItem(c)}><${Icon} n=${c.icon} /><b>${c.t}</b><span className="muted small">${c.d}</span>${c.appr !== 'none' && html`<span className="chip amber">Needs approval</span>`}</button>`)}</div>`
      }
      ${
        kind === 'request' && item &&
        html`<section className="panel stack form" style=${{ gap: 12 }}>
          <div className="ph-row" style=${{ margin: 0 }}><h3 className="ph" style=${{ margin: 0 }}><${Icon} n=${item.icon} /> ${item.t}</h3><button type="button" className="btn ghost sm" onClick=${() => setItem(null)}>Other requests</button></div>
          <p className="muted small" style=${{ margin: 0 }}>${item.d}${item.appr !== 'none' ? ' It is approved first; you get an email once it is.' : ''}</p>
          ${item.fields.map(
            x => html`<${Field} key=${x.k} label=${x.l}>
              ${
                x.type === 'select'
                  ? html`<select value=${f.vars[x.k] || ''} onChange=${e => set('vars', { ...f.vars, [x.k]: e.target.value })}><option value="">Choose…</option>${x.opts.map(o => html`<option key=${o} value=${o}>${o}</option>`)}</select>`
                  : x.type === 'textarea'
                    ? html`<textarea rows="3" value=${f.vars[x.k] || ''} onInput=${e => set('vars', { ...f.vars, [x.k]: e.target.value })} />`
                    : html`<input type=${x.type === 'date' ? 'date' : 'text'} value=${f.vars[x.k] || ''} onInput=${e => set('vars', { ...f.vars, [x.k]: e.target.value })} />`
              }
            <//>`
          )}
          <${Field} label="Anything else (optional)"><textarea rows="2" value=${f.body} onInput=${e => set('body', e.target.value)} /><//>
          <div className="actions"><button type="button" className="btn" disabled=${busy} onClick=${send}>${busy ? 'Sending…' : 'Send the request'}</button></div>
        </section>`
      }
      ${
        kind === 'incident' &&
        html`<section className="panel stack form" style=${{ gap: 12 }}>
          <${Field} label="What's wrong, in a few words"><input value=${f.title} onInput=${e => set('title', e.target.value)} placeholder="e.g. My timesheet won't submit" maxLength="200" /><//>
          <${Field} label="Details" hint="What you did, what happened, any error message. Never send passwords or bank details."><textarea rows="5" value=${f.body} onInput=${e => set('body', e.target.value)} /><//>
          <${Field} label="Area"><select value=${f.cat} onChange=${e => set('cat', e.target.value)}><option value="">Let the desk decide</option>${Object.entries(home.cats || {}).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//>
          <div className="row2">
            <div className="fld"><span>Who does it affect?</span><div className="deskradio">${[3, 2, 1].map(i => html`<label key=${i} className=${'check' + (f.impact === i ? ' on' : '')}><input type="radio" name="impact" checked=${f.impact === i} onChange=${() => set('impact', i)} /><span>${home.impact[i]}</span></label>`)}</div></div>
            <div className="fld"><span>How much does it stop you?</span><div className="deskradio">${[3, 2, 1].map(i => html`<label key=${i} className=${'check' + (f.urgency === i ? ' on' : '')}><input type="radio" name="urgency" checked=${f.urgency === i} onChange=${() => set('urgency', i)} /><span>${home.urgency[i]}</span></label>`)}</div></div>
          </div>
          <p className="small" style=${{ margin: 0 }}>${deskPri(pri)} <span className="muted">First answer ${home.sla && home.sla[pri] ? 'within ' + home.sla[pri][0] : 'soon'}; aimed to be fixed within ${home.sla && home.sla[pri] ? home.sla[pri][1] : 'a few days'}.</span></p>
          <div className="actions"><button type="button" className="btn" disabled=${busy} onClick=${send}>${busy ? 'Sending…' : 'Raise the ticket'}</button></div>
        </section>`
      }
      ${
        kind === 'feedback' &&
        html`<section className="panel stack form" style=${{ gap: 12 }}>
          <div className="fld"><span>How is the portal working for you?</span><div className="stars" role="radiogroup" aria-label="Rating">${[1, 2, 3, 4, 5].map(n => html`<button key=${n} type="button" role="radio" aria-checked=${f.rating === n} aria-label=${n + ' of 5'} className=${f.rating >= n ? 'on' : ''} onClick=${() => set('rating', n)}>★</button>`)}</div></div>
          <${Field} label="Your feedback or idea"><textarea rows="5" value=${f.body} onInput=${e => set('body', e.target.value)} placeholder="What works well, what gets in your way, what you would add" /><//>
          <div className="actions"><button type="button" className="btn" disabled=${busy} onClick=${send}>${busy ? 'Sending…' : 'Send feedback'}</button></div>
        </section>`
      }
    </div>`;
}

/* ---- one ticket: the requester's view, and the controls of the people who work it ---- */
/* v35: a two-step sign-in reset request (made at sign-in after the password and an emailed code): the checks, then the
   reset itself (administrators; it asks them to confirm it's them first). */
function DeskMfaReset({ t, busy, run }) {
  const [how, setHow] = useState('');
  const [ok1, setOk1] = useState(false);
  const admin = !!Cap.isOwner;
  return html`<section className="panel stack deskmfa" style=${{ gap: 10 }}>
      <h3 style=${{ margin: 0 }}><${Icon} n="shield" /> Two-step sign-in reset</h3>
      <ol className="absteps small">
        <li>The request was made with ${t.by}'s password and a code sent to ${t.byEmail} (see "Checked when asked").</li>
        <li>Call them back on a number you already have (their profile, HR records or their manager), not one written in this ticket, or see them on a video call. Ask something only they would know.</li>
        <li>Then reset it here. Their sessions end, they get an email, and they set two-step sign-in up again at their next sign-in.</li>
      </ol>
      ${admin
        ? html`<div className="form stack" style=${{ gap: 8 }}>
            <label className="check"><input type="checkbox" checked=${ok1} onChange=${e => setOk1(e.target.checked)} /><span>I confirmed it is really ${t.by}</span></label>
            <${Field} label="How you confirmed it" hint="Kept in the ticket's work notes and the audit log."><input value=${how} onInput=${e => setHow(e.target.value)} placeholder="Called back on the number in their HR record at 10:40; they confirmed their start date." /><//>
            <div className="actions"><button type="button" className="btn sm" disabled=${!!busy || !ok1 || how.trim().length < 10} onClick=${() => run('desk_mfa_reset', { how: how.trim() }, 'Two-step sign-in reset. ' + t.by + ' has been emailed.')}><${Icon} n="key" />Reset two-step sign-in</button></div>
          </div>`
        : html`<p className="note small" style=${{ margin: 0 }}><span>Only an administrator can reset it: assign the ticket to one after you have confirmed who it is.</span></p>`}
    </section>`;
}
function DeskTicket({ id, onBack, onChanged }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [reply, setReply] = useState('');
  const [pub, setPub] = useState(true);
  const [busy, setBusy] = useState('');
  const [panel, setPanel] = useState(''); // hold | resolve | assign | fields
  const [x, setX] = useState({});
  const [gone, setGone] = useState('');
  const load = () =>
    api('desk_ticket', { id }).then(
      r => {
        setGone('');
        setD(r);
      },
      e => setGone(errText(e))
    );
  useEffect(() => {
    setD(null);
    load();
  }, [id]);
  if (gone)
    return html`<section className="panel stack">
        ${onBack && html`<div><button type="button" className="btn ghost sm" onClick=${onBack}><${Icon} n="left" />Back</button></div>`}
        <${Empty} title="That ticket is not available">${gone} Tickets can be opened by the person who raised them and by the team working them.<//>
      </section>`;
  if (!d) return html`<${Spinner} />`;
  const t = d.ticket;
  const run = async (route, body, msg) => {
    setBusy(route + (body.act || ''));
    try {
      const r = await api(route, { id: t.id, ...body });
      setD(r);
      setPanel('');
      setX({});
      msg && toast(msg);
      onChanged && onChanged();
      return r;
    } catch (e) {
      toast(errText(e), true);
    } finally {
      setBusy('');
    }
  };
  const send = async () => {
    if (!reply.trim()) return;
    const r = await run('desk_comment', { body: reply, pub }, pub ? (t.mine ? 'Sent.' : 'Sent to ' + t.by + '.') : 'Work note added.');
    if (r) setReply('');
  };
  const open = ['approval', 'new', 'assigned', 'progress', 'hold'].includes(t.st);
  const stepAt = DESK_STEPS.findIndex(s => s[0] === (t.st === 'cancelled' ? 'closed' : t.st));
  const grp = (d.groups || []).find(g => g.id === (x.grp || t.grp));
  return html`<div className="stack deskticket" style=${{ gap: 14 }}>
      ${onBack && html`<div><button type="button" className="btn ghost sm" onClick=${onBack}><${Icon} n="left" />Back</button></div>`}
      <section className="panel stack" style=${{ gap: 10 }}>
        <div className="ph-row" style=${{ margin: 0, alignItems: 'flex-start' }}>
          <div style=${{ minWidth: 0 }}>
            <span className="muted small">${t.num} · ${t.kind === 'request' ? 'Request' : t.kind === 'feedback' ? 'Feedback' : 'Problem'} · ${t.catName}</span>
            <h2 className="ph" style=${{ margin: '2px 0 0' }}>${t.title}</h2>
          </div>
          <div className="actions">${deskPri(t.pri)} ${deskSt(t)}</div>
        </div>
        ${t.st !== 'approval' && t.st !== 'cancelled' && html`<ol className="desksteps">${DESK_STEPS.map(([k, n], i) => html`<li key=${k} className=${i < stepAt ? 'done' : i === stepAt ? 'on' : ''}>${n}</li>`)}</ol>`}
        <dl className="kv">
          <dt>Raised</dt><dd>${fmtTs(t.created)} by ${t.by}${t.src === 'email' ? ' (by email)' : t.src === 'bot' ? ' (from the Help assistant)' : t.src === 'web' ? ' (from the website, not signed in)' : t.src === 'signin' ? ' (at sign-in)' : ''}</dd>
          ${!t.byUid && t.canWork && html`<dt>Email</dt><dd>${t.byEmail} <span className="muted small">· replies are emailed; they follow the request on a private link</span></dd>`}
          <dt>With</dt><dd>${t.grpName}${t.asgName ? ' · ' + t.asgName : ''}</dd>
          ${t.st === 'hold' && html`<dt>On hold</dt><dd>${t.holdName}</dd>`}
          ${open && t.st !== 'approval' && t.kind !== 'feedback' && html`<dt>First answer</dt><dd className=${t.breachResp ? 'late' : ''}>${t.firstResp ? 'answered ' + fmtTs(t.firstResp) : deskDue(t.dueResp)}</dd><dt>Fix target</dt><dd className=${t.breachRes ? 'late' : ''}>${t.st === 'hold' ? 'paused while on hold' : deskDue(t.dueRes)}</dd>`}
          ${t.resName && html`<dt>Resolution</dt><dd>${t.resName}${t.resolvedAt ? ' · ' + fmtTs(t.resolvedAt) : ''}</dd>`}
          ${(t.vars || []).map((v, i) => html`<${Fragment} key=${i}><dt>${v.l}</dt><dd>${v.v}</dd><//>`)}
          ${t.page && html`<dt>Page</dt><dd className="small">${t.page}</dd>`}
        </dl>
        ${t.body && html`<p className="deskbody">${t.body}</p>`}
        ${
          t.appr &&
          html`<div className=${'note ' + (t.appr.st === 'approved' ? 'ok' : t.appr.st === 'rejected' ? 'red' : 'amber')}><span>${t.appr.st === 'pending' ? html`<b>Waiting for approval.</b> The team starts once it is approved.` : html`<b>${t.appr.st === 'approved' ? 'Approved' : 'Not approved'}</b> by ${t.appr.by}${t.appr.note ? ': ' + t.appr.note : ''}`}</span>
            ${
              t.canApprove &&
              html`<div className="actions"><input value=${x.anote || ''} onInput=${e => setX({ ...x, anote: e.target.value })} placeholder="Note (optional)" aria-label="Approval note" /><button type="button" className="btn sm" disabled=${!!busy} onClick=${() => run('desk_approve', { yes: true, note: x.anote || '' }, 'Approved.')}>Approve</button><button type="button" className="btn ghost sm" disabled=${!!busy} onClick=${() => run('desk_approve', { yes: false, note: x.anote || '' }, 'Rejected.')}>Reject</button></div>`
            }
          </div>`
        }
      </section>
      ${t.item === 'mfa_reset' && t.canWork && open && html`<${DeskMfaReset} t=${t} busy=${busy} run=${run} />`}
      ${
        t.canWork && t.st !== 'approval' &&
        html`<section className="panel stack deskwork" style=${{ gap: 10 }}>
          <div className="actions">
            ${open && t.asg !== Cap.uid && html`<button type="button" className="btn sm" disabled=${!!busy} onClick=${() => run('desk_act', { act: 'take' }, 'Assigned to you.')}>Assign to me</button>`}
            ${open && t.st !== 'progress' && html`<button type="button" className="btn ghost sm" disabled=${!!busy} onClick=${() => run('desk_act', { act: 'start' }, 'In progress.')}>Start work</button>`}
            ${open && html`<button type="button" className=${'btn ghost sm' + (panel === 'hold' ? ' on' : '')} onClick=${() => setPanel(panel === 'hold' ? '' : 'hold')}>Put on hold</button>`}
            ${open && html`<button type="button" className=${'btn ghost sm' + (panel === 'resolve' ? ' on' : '')} onClick=${() => setPanel(panel === 'resolve' ? '' : 'resolve')}>Resolve</button>`}
            ${open && html`<button type="button" className=${'btn ghost sm' + (panel === 'assign' ? ' on' : '')} onClick=${() => setPanel(panel === 'assign' ? '' : 'assign')}>Reassign</button>`}
            ${open && html`<button type="button" className=${'btn ghost sm' + (panel === 'fields' ? ' on' : '')} onClick=${() => setPanel(panel === 'fields' ? '' : 'fields')}>Priority & area</button>`}
            ${t.st === 'resolved' && html`<button type="button" className="btn ghost sm" disabled=${!!busy} onClick=${() => run('desk_act', { act: 'close' }, 'Closed.')}>Close</button>`}
            ${(t.st === 'resolved' || t.st === 'closed') && html`<button type="button" className="btn ghost sm" disabled=${!!busy} onClick=${() => run('desk_act', { act: 'reopen' }, 'Reopened.')}>Reopen</button>`}
            ${open && html`<button type="button" className="btn ghost sm" disabled=${!!busy} onClick=${() => confirm('Cancel this ticket? The requester sees it as cancelled.') && run('desk_act', { act: 'cancel' }, 'Cancelled.')}>Cancel ticket</button>`}
          </div>
          ${
            panel === 'hold' &&
            html`<div className="form stack" style=${{ gap: 8 }}>
              <${Field} label="Waiting for"><select value=${x.why || 'caller'} onChange=${e => setX({ ...x, why: e.target.value })}>${Object.entries(DESK_HOLD_NAMES).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//>
              <${Field} label=${(x.why || 'caller') === 'caller' ? 'Your question to the requester (emailed to them)' : 'Note (optional, emailed to the requester)'}><textarea rows="3" value=${x.note || ''} onInput=${e => setX({ ...x, note: e.target.value })} /><//>
              <div className="actions"><button type="button" className="btn sm" disabled=${!!busy} onClick=${() => run('desk_act', { act: 'hold', why: x.why || 'caller', note: x.note || '' }, 'On hold: the fix clock is paused.')}>Put on hold</button></div>
            </div>`
          }
          ${
            panel === 'resolve' &&
            html`<div className="form stack" style=${{ gap: 8 }}>
              <${Field} label="How it was resolved"><select value=${x.code || 'solved'} onChange=${e => setX({ ...x, code: e.target.value })}>${Object.entries(DESK_RES_NAMES).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//>
              <${Field} label="What was done (emailed to the requester)"><textarea rows="3" value=${x.note || ''} onInput=${e => setX({ ...x, note: e.target.value })} /><//>
              <div className="actions"><button type="button" className="btn sm" disabled=${!!busy} onClick=${() => run('desk_act', { act: 'resolve', code: x.code || 'solved', note: x.note || '' }, 'Resolved. The requester was told.')}>Resolve</button></div>
            </div>`
          }
          ${
            panel === 'assign' &&
            html`<div className="form row3" style=${{ alignItems: 'end' }}>
              <${Field} label="Group"><select value=${x.grp || t.grp} onChange=${e => setX({ ...x, grp: e.target.value, uid: '' })}>${(d.groups || []).map(g => html`<option key=${g.id} value=${g.id}>${g.n}</option>`)}</select><//>
              <${Field} label="Person"><select value=${x.uid === undefined ? (x.grp && x.grp !== t.grp ? '' : t.asg) : x.uid} onChange=${e => setX({ ...x, uid: e.target.value })}><option value="">Anyone in the group</option>${((grp && grp.members) || []).map(m => html`<option key=${m.id} value=${m.id}>${m.n}</option>`)}</select><//>
              <div className="actions"><button type="button" className="btn sm" disabled=${!!busy} onClick=${() => run('desk_act', { act: 'assign', grp: x.grp || t.grp, uid: x.uid === undefined ? (x.grp && x.grp !== t.grp ? '' : t.asg) : x.uid }, 'Reassigned.')}>Save</button></div>
            </div>`
          }
          ${
            panel === 'fields' &&
            html`<div className="form row3" style=${{ alignItems: 'end' }}>
              <${Field} label="Impact"><select value=${x.impact || t.impact} onChange=${e => setX({ ...x, impact: +e.target.value })}>${[1, 2, 3].map(i => html`<option key=${i} value=${i}>${i} · ${['', 'High', 'Medium', 'Low'][i]}</option>`)}</select><//>
              <${Field} label="Urgency"><select value=${x.urgency || t.urgency} onChange=${e => setX({ ...x, urgency: +e.target.value })}>${[1, 2, 3].map(i => html`<option key=${i} value=${i}>${i} · ${['', 'High', 'Medium', 'Low'][i]}</option>`)}</select><//>
              <div className="actions">${deskPri(deskPriOf(x.impact || t.impact, x.urgency || t.urgency))}<button type="button" className="btn sm" disabled=${!!busy} onClick=${() => run('desk_act', { act: 'fields', impact: x.impact || t.impact, urgency: x.urgency || t.urgency, cat: t.cat }, 'Priority updated.')}>Save</button></div>
            </div>`
          }
          ${(d.others || []).length > 0 && html`<p className="muted small" style=${{ margin: 0 }}>${t.by}'s other tickets: ${d.others.map(o => o.num + ' ' + o.title + ' (' + o.st + ')').join(' · ')}</p>`}
        </section>`
      }
      <section className="panel stack" style=${{ gap: 0 }}>
        <h3 className="ph" style=${{ margin: '0 0 6px' }}>Activity</h3>
        ${d.notes.length === 0 && html`<p className="muted small">Nothing yet.</p>`}
        <ul className="deskfeed">
          ${d.notes.map(n => html`<li key=${n.id} className=${'dn-' + n.kind + (n.pub ? '' : ' internal')}><div className="dnhead"><b>${n.by}</b><span className="muted small">${fmtTs(n.at)}${n.kind === 'work' ? ' · work note (internal)' : n.kind === 'email' ? ' · by email' : n.kind === 'system' ? '' : ''}</span></div><p>${n.body}</p></li>`)}
        </ul>
        ${
          !['closed', 'cancelled'].includes(t.st) &&
          html`<div className="form stack deskreply" style=${{ gap: 8 }}>
            <textarea rows="3" value=${reply} onInput=${e => setReply(e.target.value)} placeholder=${t.canWork && !pub ? 'Work note: only the people working tickets see it' : t.mine ? 'Add a reply…' : 'Reply to ' + t.by + ' (emailed to them)'} aria-label="Reply" />
            <div className="actions" style=${{ justifyContent: 'space-between' }}>
              ${t.canWork && !t.mine ? html`<div className="seg" style=${{ margin: 0 }}><button type="button" className=${pub ? 'on' : ''} onClick=${() => setPub(true)}>Reply to requester</button><button type="button" className=${!pub ? 'on' : ''} onClick=${() => setPub(false)}>Work note</button></div>` : html`<span></span>`}
              <button type="button" className="btn sm" disabled=${!!busy || !reply.trim()} onClick=${send}>${busy === 'desk_comment' ? 'Sending…' : pub ? 'Send' : 'Add note'}</button>
            </div>
          </div>`
        }
      </section>
      ${
        t.mine &&
        html`<div className="actions">
          ${t.st === 'resolved' && html`<button type="button" className="btn" disabled=${!!busy} onClick=${() => run('desk_mine_act', { act: 'close' }, 'Thanks! The ticket is closed.')}>It's fixed: close it</button>`}
          ${t.st === 'resolved' && html`<button type="button" className="btn ghost" disabled=${!!busy} onClick=${() => run('desk_mine_act', { act: 'reopen', note: reply }, 'Reopened. The team was told.')}>It's not fixed: reopen</button>`}
          ${open && html`<button type="button" className="btn ghost" disabled=${!!busy} onClick=${() => confirm('Cancel this ticket? You no longer need help with it.') && run('desk_mine_act', { act: 'cancel' }, 'Cancelled.')}>I no longer need this</button>`}
        </div>`
      }
      ${
        t.mine && (t.st === 'resolved' || t.st === 'closed') && t.kind !== 'feedback' &&
        html`<section className="panel stack" style=${{ gap: 8 }}>
          <b>${t.csat ? 'Thanks for rating this ticket' : 'How did we do?'}</b>
          <div className="stars" role="radiogroup" aria-label="Rate the help you got">${[1, 2, 3, 4, 5].map(n => html`<button key=${n} type="button" role="radio" aria-checked=${t.csat === n} aria-label=${n + ' of 5'} className=${(x.csat || t.csat) >= n ? 'on' : ''} onClick=${() => run('desk_rate', { csat: n, note: x.cnote || '' }, 'Thank you!')}>★</button>`)}</div>
          ${!t.csat && html`<input value=${x.cnote || ''} onInput=${e => setX({ ...x, cnote: e.target.value })} placeholder="Anything we could do better? (optional, then pick the stars)" aria-label="Rating comment" />`}
        </section>`
      }
    </div>`;
}

/* ---- the list of tickets (mine, or the team queue) ---- */
function DeskList({ rows, onOpen, agent }) {
  if (!rows.length) return null;
  return html`<div className="tblwrap"><table className="tbl desklist">
      <thead><tr><th>Ticket</th><th>Priority</th><th>Stage</th>${agent && html`<th>With</th>`}<th>Updated</th></tr></thead>
      <tbody>${rows.map(
        t => html`<tr key=${t.id} className="clickable" tabIndex="0" onClick=${() => onOpen(t)} onKeyDown=${e => e.key === 'Enter' && onOpen(t)}>
          <td><b>${t.title}</b><div className="muted small">${t.num} · ${t.catName}${agent ? ' · ' + t.by : ''}${agent && (t.breachResp || t.breachRes) ? html` · <span className="late">SLA missed</span>` : ''}</div></td>
          <td>${deskPri(t.pri)}</td>
          <td>${deskSt(t)}</td>
          ${agent && html`<td className="small">${t.grpName}${t.asgName ? html`<br />${t.asgName}` : html`<br /><span className="muted">unassigned</span>`}</td>`}
          <td className="small nw">${fmtTs(t.updated)}</td>
        </tr>`
      )}</tbody>
    </table></div>`;
}
const DESK_VIEWS = [['open', 'All open'], ['mine', 'Assigned to me'], ['groups', 'My groups'], ['unassigned', 'Unassigned'], ['breached', 'SLA missed'], ['approvals', 'Waiting approval'], ['closed', 'Resolved & closed']];
function DeskQueue({ initial, onOpen }) {
  const [f, setF] = useState({ view: initial || 'open', q: '', pri: '', grp: '', offset: 0 });
  const [d, setD] = useState(null);
  const toast = useToast();
  useEffect(() => {
    const t = setTimeout(() => api('desk_queue', f).then(setD, e => toast(errText(e), true)), f.q ? 300 : 0);
    return () => clearTimeout(t);
  }, [JSON.stringify(f)]);
  return html`<div className="stack" style=${{ gap: 12 }}>
      <div className="trfilters">
        <select value=${f.view} onChange=${e => setF({ ...f, view: e.target.value, offset: 0 })} aria-label="Show">${DESK_VIEWS.map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select>
        <select value=${f.pri} onChange=${e => setF({ ...f, pri: e.target.value, offset: 0 })} aria-label="Priority"><option value="">Any priority</option>${[1, 2, 3, 4].map(p => html`<option key=${p} value=${p}>${DESK_PRI_NAME[p]}</option>`)}</select>
        <select value=${f.grp} onChange=${e => setF({ ...f, grp: e.target.value, offset: 0 })} aria-label="Group"><option value="">Any group</option>${((d && d.groups) || []).map(g => html`<option key=${g.id} value=${g.id}>${g.n}</option>`)}</select>
        <input type="search" value=${f.q} onInput=${e => setF({ ...f, q: e.target.value, offset: 0 })} placeholder="Search, or SD-1234" aria-label="Search tickets" />
      </div>
      ${!d ? html`<${Spinner} />` : d.rows.length ? html`<section className="panel" style=${{ padding: '6px 8px' }}><${DeskList} rows=${d.rows} agent onOpen=${onOpen} /></section>` : html`<section className="panel"><${Empty} title="Nothing here">No tickets match.<//></section>`}
      ${
        d && d.total > 50 &&
        html`<div className="actions"><button type="button" className="btn ghost sm" disabled=${f.offset === 0} onClick=${() => setF({ ...f, offset: Math.max(0, f.offset - 50) })}>Previous</button><span className="small muted">${f.offset + 1}–${Math.min(d.total, f.offset + 50)} of ${d.total}</span><button type="button" className="btn ghost sm" disabled=${f.offset + 50 >= d.total} onClick=${() => setF({ ...f, offset: f.offset + 50 })}>Next</button></div>`
      }
    </div>`;
}
function DeskDash({ onView }) {
  const [d, setD] = useState(null);
  const toast = useToast();
  useEffect(() => {
    api('desk_dash', {}).then(setD, e => toast(errText(e), true));
  }, []);
  if (!d) return html`<${Spinner} />`;
  const maxDay = Math.max(1, ...d.days.map(x => Math.max(x.in, x.out)));
  const maxPri = Math.max(1, ...Object.values(d.byPri));
  return html`<div className="stack" style=${{ gap: 14 }}>
      <${KitStats} items=${[
        { v: d.open, l: 'Open tickets', onClick: () => onView('open') },
        { v: d.breached, l: 'SLA missed', tone: d.breached ? 'warn' : '', onClick: () => onView('breached') },
        { v: d.soon, l: 'Due within an hour', tone: d.soon ? 'warn' : '' },
        { v: d.unassigned, l: 'Unassigned', onClick: () => onView('unassigned') },
        { v: d.mine, l: 'Assigned to me', onClick: () => onView('mine') },
        { v: d.approvals, l: 'Waiting approval', onClick: () => onView('approvals') },
      ]} />
      <div className="g2" style=${{ gap: 14, alignItems: 'start' }}>
        <section className="panel stack" style=${{ gap: 8 }}>
          <h3 className="ph" style=${{ margin: 0 }}>Open by priority</h3>
          ${[1, 2, 3, 4].map(p => html`<div key=${p} className="deskbar"><span>${DESK_PRI_NAME[p]}</span><i className=${'p' + p} style=${{ width: d.byPri[p] ? Math.max(2, Math.round((d.byPri[p] / maxPri) * 100)) + '%' : 0 }}></i><b>${d.byPri[p]}</b></div>`)}
          <h3 className="ph" style=${{ margin: '8px 0 0' }}>By group</h3>
          ${d.byGrp.length ? d.byGrp.map(g => html`<div key=${g.id} className="deskbar"><span>${g.n}</span><i style=${{ width: Math.round((g.c / Math.max(1, d.open)) * 100) + '%' }}></i><b>${g.c}</b></div>`) : html`<p className="muted small">No open tickets.</p>`}
        </section>
        <section className="panel stack" style=${{ gap: 8 }}>
          <h3 className="ph" style=${{ margin: 0 }}>Last 14 days: raised and resolved</h3>
          <div className="deskdays" role="img" aria-label="Tickets raised and resolved per day">${d.days.map(x => html`<div key=${x.d} title=${x.d + ': ' + x.in + ' raised, ' + x.out + ' resolved'}><i className="in" style=${{ height: Math.round((x.in / maxDay) * 100) + '%' }}></i><i className="out" style=${{ height: Math.round((x.out / maxDay) * 100) + '%' }}></i></div>`)}</div>
          <p className="muted small" style=${{ margin: 0 }}><span className="dlegend in"></span> raised <span className="dlegend out"></span> resolved</p>
          <dl className="kv">
            <dt>Resolved in 30 days</dt><dd>${d.resolved30}</dd>
            <dt>Typical time to resolve</dt><dd>${d.medianMins ? (d.medianMins < 120 ? d.medianMins + ' minutes' : d.medianMins < 2880 ? Math.round(d.medianMins / 60) + ' hours' : Math.round(d.medianMins / 1440) + ' days') : '—'}</dd>
            <dt>Within the fix target</dt><dd>${d.slaMet === null ? '—' : d.slaMet + '%'}</dd>
            <dt>Satisfaction</dt><dd>${d.csat === null ? '—' : d.csat + ' / 5 (' + d.csatN + ' ratings)'}</dd>
          </dl>
        </section>
      </div>
    </div>`;
}
/** The service desk for the people who work tickets: the dashboard, the queue and a ticket. */
function DeskWork({ q, extraTabs, extra }) {
  const tabs = [['dash', 'Dashboard'], ['queue', 'Queue'], ...(extraTabs || [])];
  const [tab, setTab] = useState(q && q.tab && tabs.some(x => x[0] === q.tab) ? q.tab : q && q.t ? 'queue' : 'dash');
  const [view, setView] = useState(q && DESK_VIEWS.some(v => v[0] === q.view) ? q.view : 'open');
  const [open, setOpen] = useState(q && q.t ? q.t : null);
  const [tick, setTick] = useState(0);
  // a link to another ticket (from an email, or the dashboard) or to a tab while this page is open
  useEffect(() => {
    if (q && q.t) setOpen(q.t);
  }, [q && q.t]);
  useEffect(() => {
    if (q && q.tab && tabs.some(x => x[0] === q.tab)) {
      setOpen(null);
      setTab(q.tab);
    }
  }, [q && q.tab]);
  if (open) return html`<${DeskTicket} id=${open} onBack=${() => { setOpen(null); setTick(tick + 1); }} />`;
  return html`<div className="stack">
      <${KitTabs} wrap tabs=${tabs} tab=${tab} onTab=${setTab} />
      ${tab === 'dash' && html`<${DeskDash} key=${tick} onView=${v => { setView(v); setTab('queue'); }} />`}
      ${tab === 'queue' && html`<${DeskQueue} key=${view + tick} initial=${view} onOpen=${t => setOpen(t.id)} />`}
      ${extra && extra(tab)}
    </div>`;
}

/* ---- the Help & support page ---- */
const DESK_TABS = ['mine', 'new', 'kb', 'team'];
function HelpPage({ q }) {
  const toast = useToast();
  const [home, setHome] = useState(null);
  const [tab, setTab] = useState(q && DESK_TABS.includes(q.tab) ? q.tab : 'mine');
  const [open, setOpen] = useState(q && q.t ? q.t : null);
  const [preset, setPreset] = useState(q && q.kind ? { kind: q.kind } : null);
  const [kbOpen, setKbOpen] = useState(null);
  const load = () => api('desk_home', {}).then(setHome, e => toast(errText(e), true));
  useEffect(() => {
    load();
  }, []);
  // links from the Help button and from emails land on the right tab or ticket, also when this page is already open
  useEffect(() => {
    if (q && q.t) setOpen(q.t);
  }, [q && q.t]);
  useEffect(() => {
    if (q && DESK_TABS.includes(q.tab)) {
      setOpen(null);
      setTab(q.tab);
      setPreset(q.kind ? { kind: q.kind } : null);
    }
  }, [q && q.tab, q && q.kind]);
  if (!home) return html`<${Spinner} />`;
  if (open) return html`<${DeskTicket} id=${open} onBack=${() => { setOpen(null); load(); }} onChanged=${load} />`;
  const openN = home.mine.filter(t => ['approval', 'new', 'assigned', 'progress', 'hold', 'resolved'].includes(t.st)).length;
  const go = t => {
    setTab(t);
    setPreset(null);
    setKbOpen(null);
  };
  return html`<div className="stack">
      <${KitTabs} wrap tabs=${[['mine', 'My requests', openN || null], ['new', 'Get help'], ['kb', 'Help articles'], ...(home.agent ? [['team', 'Team queue']] : [])]} tab=${tab} onTab=${go} />
      ${
        tab === 'mine' &&
        (home.mine.length
          ? html`<section className="panel" style=${{ padding: '6px 8px' }}><${DeskList} rows=${home.mine} onOpen=${t => setOpen(t.id)} /></section>`
          : html`<section className="panel"><${Empty} title="No requests yet" action=${html`<button type="button" className="btn" onClick=${() => go('new')}>Get help</button>`}>When something is wrong or you need something, raise it here, from the Help button at the top, or by email. You can follow every request on this page.<//></section>`)
      }
      ${
        tab === 'new' && (home.popular || []).length > 0 &&
        html`<div className="deskquick"><span className="small muted">Quick answers:</span>${home.popular.slice(0, 6).map(a => html`<button key=${a.id} type="button" className="chip" onClick=${() => { setKbOpen(a.id); setTab('kb'); }}>${a.t}</button>`)}</div>`
      }
      ${tab === 'new' && html`<${DeskNew} key=${preset ? JSON.stringify(preset) : 'new'} home=${home} preset=${preset} onCreated=${t => { load(); setOpen(t.id); }} />`}
      ${
        tab === 'kb' &&
        html`<${DeskKb} key=${kbOpen || 'list'} initial=${kbOpen} onTicket=${a => { setPreset({ kind: 'incident', title: '', body: 'I read "' + a.t + '" and still need help: ', cat: a.cat }); setTab('new'); }} />`
      }
      ${tab === 'team' && home.agent && html`<${DeskWork} q=${{}} />`}
      ${
        tab !== 'team' &&
        html`<p className="muted small">${home.sla ? `First answers: P1 within ${home.sla[1][0]}, P2 within ${home.sla[2][0]}, P3 within ${home.sla[3][0]}, P4 within ${home.sla[4][0]}.` : ''} Replies by email keep [SD-number] in the subject.</p>`
      }
    </div>`;
}

/* ---- the Help button: a support assistant that looks in the help articles, then raises a ticket ---- */
function HelpBot({ title, helpHref }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(null); // { title, body, cat, impact, urgency }
  const [mine, setMine] = useState(null);
  const box = useRef(null);
  const input = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onKey = e => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    setTimeout(() => input.current && input.current.focus(), 50);
    // one side panel at a time: opening Help closes StratEdge AI (and the other way round)
    window.dispatchEvent(new CustomEvent('se-panel', { detail: 'help' }));
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  useEffect(() => {
    const other = e => e.detail !== 'help' && setOpen(false);
    window.addEventListener('se-panel', other);
    return () => window.removeEventListener('se-panel', other);
  }, []);
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [msgs, busy, form, mine]);
  const ask = async text => {
    const question = (text || q).trim();
    if (!question || busy) return;
    setMsgs(m => [...m, { role: 'user', text: question }]);
    setQ('');
    setBusy(true);
    try {
      const r = await api('desk_bot', { q: question });
      setMsgs(m => [...m, { role: 'bot', q: question, r }]);
    } catch (e) {
      setMsgs(m => [...m, { role: 'bot', err: errText(e) }]);
    }
    setBusy(false);
  };
  const raise = async () => {
    setBusy(true);
    try {
      const r = await api('desk_create', { kind: 'incident', title: form.title, body: form.body, cat: form.cat, impact: form.impact, urgency: form.urgency, page: title || '', src: 'bot' });
      setMsgs(m => [...m, { role: 'bot', done: r.ticket }]);
      setForm(null);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const showMine = () =>
    api('desk_home', {}).then(
      r => setMine(r.mine.slice(0, 5)),
      e => toast(errText(e), true)
    );
  const lastQ = [...msgs].reverse().find(m => m.role === 'user');
  const startTicket = () => {
    const last = [...msgs].reverse().find(m => m.role === 'bot' && m.r);
    setForm({ title: (lastQ ? lastQ.text : '').slice(0, 120), body: msgs.filter(m => m.role === 'user').map(m => m.text).join('\n\n'), cat: last ? last.r.cat : '', impact: 3, urgency: 3 });
  };
  return html`<${Fragment}>
    <button type="button" className="btn ghost sm helpbot-btn" onClick=${() => setOpen(!open)} aria-expanded=${open} title="Help: ask a question, report a problem, request something"><${Icon} n="help" /><span className="askai-label">Help</span></button>
    ${
      open &&
      html`<div className="askai helpbot" role="dialog" aria-label="Help and support">
        <div className="askai-head">
          <div style=${{ minWidth: 0 }}><b className="askai-title"><${Icon} n="help" /> Help & support</b><div className="muted small">Answers from the help articles, or a ticket to the right team</div></div>
          <div className="actions">${(msgs.length > 0 || mine) && html`<button type="button" className="btn ghost sm" onClick=${() => { setMsgs([]); setForm(null); setMine(null); }}>New</button>`}<button type="button" className="btn ghost icon sm" aria-label="Close" onClick=${() => setOpen(false)}><${Icon} n="x" /></button></div>
        </div>
        <div className="askai-body" ref=${box}>
          ${
            msgs.length === 0 && !form && !mine &&
            html`<div className="askai-hello">
              <p>Hi${Cap.me && Cap.me.name ? ' ' + firstName(Cap.me.name) : ''}. Tell me what's wrong or what you need, and I'll look for an answer first. If there isn't one, I'll pass it to the right team as a ticket.</p>
              <div className="askai-starters">
                <button type="button" className="chip" onClick=${() => (setQ('I can\'t '), input.current && input.current.focus())}>Something isn't working</button>
                <button type="button" className="chip" onClick=${() => setForm({ title: '', body: '', cat: '', impact: 3, urgency: 3 })}>Report a problem</button>
                <a className="chip" href=${helpHref + '?tab=new&kind=request'} onClick=${() => setOpen(false)}>Request something</a>
                <button type="button" className="chip" onClick=${showMine}>My requests</button>
                <a className="chip" href=${helpHref + '?tab=kb'} onClick=${() => setOpen(false)}>Help articles</a>
              </div>
            </div>`
          }
          ${msgs.map((m, i) =>
            m.role === 'user'
              ? html`<div key=${i} className="askai-msg user"><p>${m.text}</p></div>`
              : m.err
                ? html`<div key=${i} className="askai-msg assistant err"><p>${m.err}</p></div>`
                : m.done
                  ? html`<div key=${i} className="askai-msg assistant"><p><b>${m.done.num}</b> is with ${m.done.grpName} (${DESK_PRI_NAME[m.done.pri]}). You'll get an email, and you can follow it under <a href=${helpHref + '?t=' + m.done.num} onClick=${() => setOpen(false)}>Help & support</a>.</p></div>`
                  : html`<div key=${i} className="askai-msg assistant">
                      ${m.r.answer ? html`<${AiText} text=${m.r.answer} />` : m.r.articles.length ? html`<p>These help articles look related:</p>` : html`<p>I couldn't find a help article about that. Shall I raise a ticket?${m.r.cat && m.r.cat !== 'other' ? ' It goes to the team for ' + m.r.catName + '.' : ''}</p>`}
                      ${m.r.articles.length > 0 && html`<div className="botarts">${m.r.articles.map(a => html`<details key=${a.id}><summary>${a.t}</summary><div className="small">${a.body.split(/\n{2,}/).map((p, j) => html`<p key=${j}>${p}</p>`)}</div></details>`)}</div>`}
                      ${i === msgs.length - 1 && !form && html`<div className="askai-tools"><span className="small">${m.r.articles.length ? 'Did that answer it?' : ''}</span>${m.r.articles.length > 0 && html`<button type="button" className="btn ghost sm" onClick=${() => setMsgs(x => [...x, { role: 'bot', thanks: true, r: { articles: [], answer: 'Glad that helped. Ask me anything else, any time.' } }])}>Yes, thanks</button>`}<button type="button" className="btn sm" onClick=${startTicket}>${m.r.articles.length ? 'No, raise a ticket' : 'Raise a ticket'}</button></div>`}
                    </div>`
          )}
          ${
            mine &&
            html`<div className="askai-msg assistant"><p>${mine.length ? 'Your latest requests:' : 'You have no requests yet.'}</p>${mine.map(t => html`<a key=${t.id} className="botmine" href=${helpHref + '?t=' + t.num} onClick=${() => setOpen(false)}><b>${t.num}</b> ${t.title} <${Chip} s=${DESK_ST_CHIP[t.st]}>${t.stName}<//></a>`)}</div>`
          }
          ${
            form &&
            html`<div className="askai-msg assistant form botform">
              <${Field} label="In a few words"><input value=${form.title} onInput=${e => setForm({ ...form, title: e.target.value })} maxLength="200" /><//>
              <${Field} label="Details"><textarea rows="3" value=${form.body} onInput=${e => setForm({ ...form, body: e.target.value })} /><//>
              <${Field} label="How much does it stop you?"><select value=${form.urgency} onChange=${e => setForm({ ...form, urgency: +e.target.value })}><option value="3">It can wait</option><option value="2">It slows me down: soon, please</option><option value="1">I can't work at all</option></select><//>
              <${Field} label="Who does it affect?"><select value=${form.impact} onChange=${e => setForm({ ...form, impact: +e.target.value })}><option value="3">Just me</option><option value="2">My team or several people</option><option value="1">Everyone, or a client is affected</option></select><//>
              <div className="actions" style=${{ justifyContent: 'space-between' }}>${deskPri(deskPriOf(form.impact, form.urgency))}<span><button type="button" className="btn ghost sm" onClick=${() => setForm(null)}>Not now</button> <button type="button" className="btn sm" disabled=${busy || !form.title.trim() || !form.body.trim()} onClick=${raise}>${busy ? 'Sending…' : 'Raise the ticket'}</button></span></div>
            </div>`
          }
          ${busy && !form && html`<div className="askai-msg assistant"><span className="askai-typing"><i></i><i></i><i></i></span></div>`}
        </div>
        <form className="askai-foot" onSubmit=${e => { e.preventDefault(); ask(); }}>
          <textarea ref=${input} rows="2" value=${q} onInput=${e => setQ(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } }} placeholder="Describe the problem or ask a question…" aria-label="Your question" />
          <div className="askai-row"><span className="muted small">Never type passwords or bank details here.</span><button type="submit" className="btn sm" disabled=${busy || !q.trim()}>Ask</button></div>
        </form>
      </div>`
    }
  <//>`;
}
