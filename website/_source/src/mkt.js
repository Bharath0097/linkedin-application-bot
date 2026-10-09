/* ================= Talent marketplace =================
   Employers (client and vendor contacts in the client portal) search the people StratEdge marked as marketable, see
   a redacted profile, request it, and get the full profile with the resume once a recruiter approves. Staff run it
   under Talent marketplace: Requests, Profiles (who is listed), Employers and Settings. Server: api/mkt.php. */
const MKT_AUTH = ['US citizen', 'Green card', 'H-1B', 'H4 EAD', 'OPT', 'CPT', 'L2 EAD', 'TN', 'EAD'];
const mktStChip = st => (st === 'approved' || st === 'submitted' ? 'ok' : st === 'declined' ? 'red' : 'amber');
const MKT_ST = { new: 'Waiting for StratEdge', approved: 'Approved', submitted: 'Approved', declined: 'Not released' };
const mktHome = P => (P.base || '/portal').replace(/\/$/, '');
/* One redacted profile as a card. */
function TalentCard({ c, req, saved, onOpen, onRequest, onSave, score, why }) {
  const yrs = c.years != null && c.years !== '' ? `${c.years} yr${+c.years === 1 ? '' : 's'}` : '';
  return html`<article className="tcard" onClick=${() => onOpen(c)} tabIndex="0" onKeyDown=${e => e.key === 'Enter' && onOpen(c)}>
      <div className="tcard-top">
        <span className="tcode">${c.code}</span>
        <span className="muted small">${c.src === 'bench' ? 'On the bench' : c.src === 'candidate' ? 'Candidate' : 'Consultant database'}</span>
        ${onSave && html`<button type="button" className=${'btn ghost sm icon tsave' + (saved ? ' on' : '')} aria-label=${saved ? 'Remove from shortlist' : 'Shortlist'} title=${saved ? 'Shortlisted' : 'Shortlist'} onClick=${e => {
          e.stopPropagation();
          onSave(c);
        }}><${Icon} n="star" /></button>`}
      </div>
      <h3>${c.ti || 'Consultant'}</h3>
      <div className="chips">
        ${c.loc && html`<span className="chip">${c.loc}</span>`}
        ${yrs && html`<span className="chip">${yrs}</span>`}
        ${c.auth && html`<span className="chip">${c.auth}</span>`}
        ${c.avail && html`<span className="chip ok">${/^\d{4}-/.test(c.avail) ? 'From ' + fmtDate(c.avail) : c.avail}</span>`}
        ${c.band && html`<span className="chip new">${c.band}</span>`}
      </div>
      ${c.skills.length > 0 && html`<p className="tskills">${c.skills.slice(0, 10).join(' · ')}${c.skills.length > 10 ? ` · +${c.skills.length - 10}` : ''}</p>`}
      ${c.summary && html`<p className="tsum">${c.summary.slice(0, 220)}${c.summary.length > 220 ? '…' : ''}</p>`}
      ${score != null && html`<div className="tscore"><div className="bar"><span style=${{ width: Math.min(100, score) + '%' }} /></div><span className="small"><b>${score}</b> match${why && why.length ? ' · ' + why.slice(0, 2).join(', ') : ''}</span></div>`}
      <div className="tcard-foot" onClick=${e => e.stopPropagation()}>
        ${
          req
            ? html`<${Chip} s=${mktStChip(req.st)}>${MKT_ST[req.st] || req.st}<//>`
            : html`<button type="button" className="btn sm" onClick=${() => onRequest(c)}><${Icon} n="send" />Request profile</button>`
        }
        <button type="button" className="btn ghost sm" onClick=${() => onOpen(c)}>View</button>
      </div>
    </article>`;
}
/* The redacted (or, once approved, full) profile, with the request form. */
function TalentProfile({ pid, reqs, onClose, onRequested, rq }) {
  const P = usePortal();
  const C = useClient();
  const toast = useToast();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [note, setNote] = useState('');
  const [forReq, setForReq] = useState(rq || '');
  const [busy, setBusy] = useState(false);
  const load = () =>
    api('mkt_profile', { pid })
      .then(r => {
        setD(r);
        setErr(null);
      })
      .catch(setErr);
  useEffect(() => {
    load();
  }, [pid]);
  const request = async () => {
    setBusy(true);
    try {
      const r = await api('mkt_request', { pid, rq: forReq, note: note.trim(), cid: P.cid || '' });
      toast(r.already ? 'You already asked for this profile.' : r.st === 'approved' ? 'Approved: the full profile is open.' : 'Request sent. StratEdge usually answers within a working day.');
      onRequested && onRequested();
      load();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const p = d && d.profile;
  const myReq = d && d.request;
  const open = (C && C.openReqs) || [];
  return html`<${Modal} wide title=${p ? `${p.code} · ${p.ti || 'Consultant'}` : 'Profile'} onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Close</button>`}>
      ${err && html`<${LoadError} error=${err} onRetry=${load} />`}
      ${!d && !err && html`<${Spinner} />`}
      ${
        p &&
        html`<div className="stack">
            ${
              p.n
                ? html`<section className="panel stack tfull" style=${{ gap: 6 }}>
                    <b>${p.n}</b>
                    <div className="small">${[p.e && html`<a key="e" href=${'mailto:' + p.e}>${p.e}</a>`, p.ph && html`<span key="p">${p.ph}</span>`].filter(Boolean).map((x, i) => html`<${Fragment} key=${i}>${i ? ' · ' : ''}${x}<//>`)}</div>
                    ${p.resumeUrl ? html`<div><a className="btn sm" href=${p.resumeUrl}><${Icon} n="down" />Download resume</a></div>` : html`<span className="muted small">No resume file on this profile; ask your account manager.</span>`}
                    <span className="muted small">Released to you${myReq && myReq.dec && myReq.dec.at ? ' on ' + fmtTs(myReq.dec.at) : ''}. Please route interviews and offers through StratEdge.</span>
                  </section>`
                : html`<p className="note small" style=${{ margin: 0 }}>Name, contact details and the resume file are shared once StratEdge approves your request.</p>`
            }
            <div className="chips">
              ${p.loc && html`<span className="chip">${p.loc}</span>`}
              ${p.years != null && p.years !== '' && html`<span className="chip">${p.years} yrs experience</span>`}
              ${p.auth && html`<span className="chip">${p.auth}</span>`}
              ${p.avail && html`<span className="chip ok">${/^\d{4}-/.test(p.avail) ? 'Available from ' + fmtDate(p.avail) : 'Available: ' + p.avail}</span>`}
              ${p.reloc && html`<span className="chip">Relocation: ${p.reloc}</span>`}
              ${p.band && html`<span className="chip new">${p.band}</span>`}
            </div>
            ${p.titles.length > 1 && html`<div className="muted small">Also: ${p.titles.slice(1).join(', ')}</div>`}
            ${p.skills.length > 0 && html`<div><span className="lbl">Skills</span><div className="chips">${p.skills.map(s => html`<span key=${s} className="chip">${s}</span>`)}</div></div>`}
            ${p.summary && html`<div><span className="lbl">From the resume</span><p className="tsum big" style=${{ whiteSpace: 'pre-wrap' }}>${p.summary}</p></div>`}
            ${
              myReq
                ? html`<div className=${'note small ' + (myReq.st === 'declined' ? 'red' : myReq.st === 'new' ? 'amber' : 'ok')} style=${{ margin: 0 }}>
                    <b>${MKT_ST[myReq.st] || myReq.st}</b> · requested ${fmtTs(myReq.at)}${myReq.rqTitle ? ' for ' + myReq.rqTitle : ''}${myReq.dec && myReq.dec.why ? ' · ' + myReq.dec.why : ''}
                  </div>`
                : !(C && C.preview) &&
                  html`<section className="panel stack" style=${{ gap: 8, background: 'var(--surface-2)' }}>
                    <b>Request this profile</b>
                    ${open.length > 0 && html`<${Field} label="For which requirement? (optional)"><select value=${forReq} onChange=${e => setForReq(e.target.value)}><option value="">Not tied to a requirement</option>${open.map(r => html`<option key=${r.id} value=${r.id}>${r.ti}</option>`)}</select><//>`}
                    <${Field} label="A note for StratEdge (optional)"><textarea rows="2" value=${note} onInput=${e => setNote(e.target.value)} placeholder="Interview slots, rate target, start date…" /><//>
                    <div><button type="button" className="btn" disabled=${busy} onClick=${request}><${Icon} n="send" />${busy ? 'Sending…' : 'Request full profile'}</button></div>
                  </section>`
            }
          </div>`
      }
    <//>`;
}
/* Employer: search the marketplace, or see the people ranked against one of their requirements (?rq=). */
function TalentPage({ q }) {
  const P = usePortal();
  const C = useClient();
  const toast = useToast();
  const [f, setF] = useState({ q: '', loc: '', auth: '', years: '' });
  const [res, setRes] = useState(null);
  const [intro, setIntro] = useState(''); // the 'Line shown above the search' setting (mkt_search returns it beside rows)
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(null);
  const [reqs, setReqs] = useState([]);
  const [tab, setTab] = useState('all');
  const saved = useCol(P.uid ? `e/${P.uid}/mkt` : null);
  const rq = (q && q.rq) || '';
  const [matchReq, setMatchReq] = useState(null);
  const search = (over = {}) => {
    const p = { ...f, ...over };
    setErr(null);
    return (rq ? api('mkt_match', { rq }) : api('mkt_search', { q: p.q, loc: p.loc, auth: p.auth, years: p.years ? +p.years : 0 }))
      .then(r => {
        setRes(r.rows);
        if (r.intro !== undefined) setIntro(r.intro || '');
        if (r.req) setMatchReq(r.req);
      })
      .catch(e => setErr(e));
  };
  const loadReqs = () =>
    api('mkt_my_requests')
      .then(r => setReqs(r.rows))
      .catch(() => {});
  useEffect(() => {
    search();
    loadReqs();
  }, [rq]);
  const reqOf = pid => reqs.find(r => r.pid === pid && r.st !== 'declined');
  const savedIds = new Set(saved.docs.map(d => d.id));
  const toggleSave = async c => {
    try {
      if (savedIds.has(c.pid)) await dbDel(`e/${P.uid}/mkt/${c.pid}`);
      else await dbSet(`e/${P.uid}/mkt/${c.pid}`, { at: Date.now(), ti: c.ti, code: c.code });
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const quickRequest = async c => {
    try {
      const r = await api('mkt_request', { pid: c.pid, rq, note: '', cid: P.cid || '' });
      toast(r.already ? 'You already asked for this profile.' : r.st === 'approved' ? 'Approved: open the profile for the details.' : 'Request sent. StratEdge usually answers within a working day.');
      loadReqs();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const list = (res || []).filter(c => tab !== 'saved' || savedIds.has(c.pid));
  const home = mktHome(P);
  return html`<div className="stack">
      ${
        rq && matchReq
          ? html`<div className="note ok" style=${{ margin: 0, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span><b>Matching profiles for "${matchReq.ti}"</b>${matchReq.loc ? ' · ' + matchReq.loc : ''}. Ranked by title, skills and location; request the ones you like and StratEdge releases the details.</span>
              <a className="btn ghost sm" href=${'#' + home + '/talent'}>Search everyone</a>
            </div>`
          : html`<section className="panel tsearch">
              <form className="actions" onSubmit=${e => {
                e.preventDefault();
                search();
              }} style=${{ flexWrap: 'wrap' }}>
                <label className="kitsearch" style=${{ flex: '2 1 260px' }}><${Icon} n="search" /><input type="search" placeholder="Skills, title or keywords, e.g. SAP PP/QM, Java, network engineer" value=${f.q} onInput=${e => setF({ ...f, q: e.target.value })} aria-label="Search profiles" /></label>
                <input placeholder="Location" value=${f.loc} onInput=${e => setF({ ...f, loc: e.target.value })} style=${{ flex: '1 1 140px' }} aria-label="Location" />
                <select value=${f.auth} onChange=${e => setF({ ...f, auth: e.target.value })} aria-label="Work authorization" style=${{ flex: '1 1 150px' }}><option value="">Any work authorization</option>${MKT_AUTH.map(a => html`<option key=${a} value=${a}>${a}</option>`)}</select>
                <select value=${f.years} onChange=${e => setF({ ...f, years: e.target.value })} aria-label="Experience" style=${{ flex: '0 1 130px' }}><option value="">Any experience</option>${[2, 4, 6, 8, 10, 15].map(y => html`<option key=${y} value=${y}>${y}+ years</option>`)}</select>
                <button className="btn" type="submit">Search</button>
              </form>
              <p className="muted small" style=${{ margin: '8px 0 0' }}>${intro || 'Profiles StratEdge can place with you, shown without names. Request a profile and StratEdge releases the name, contact details and resume.'}</p>
            </section>`
      }
      <div className="toolbar">
        <${KitTabs} tab=${tab} onTab=${setTab} tabs=${[
          ['all', rq ? 'Matches' : 'Profiles', res ? res.length : null],
          ['saved', 'Shortlisted', savedIds.size || null],
        ]} />
        <div className="push"><a className="btn ghost sm" href=${'#' + home + '/requests'}><${Icon} n="send" />My requests${reqs.length ? ` (${reqs.length})` : ''}</a></div>
      </div>
      ${err && html`<${LoadError} error=${err} onRetry=${() => search()} />`}
      ${!res && !err && html`<${Spinner} label="Finding profiles…" />`}
      ${
        res &&
        (list.length
          ? html`<div className="tgrid">${list.map(c => html`<${TalentCard} key=${c.pid} c=${c} req=${reqOf(c.pid)} saved=${savedIds.has(c.pid)} onOpen=${x => setOpen(x.pid)} onRequest=${quickRequest} onSave=${toggleSave} score=${rq ? c.score : null} why=${c.why} />`)}</div>`
          : html`<div className="panel"><${Empty} title=${tab === 'saved' ? 'Nothing shortlisted yet' : rq ? 'No close matches yet' : 'No profiles match'}>${tab === 'saved' ? 'Use the star on a profile to keep it here.' : rq ? 'Post the requirement details under Requirements and StratEdge will source for it.' : 'Try fewer words, or post a requirement and StratEdge will source for it.'}<//></div>`)
      }
      ${open && html`<${TalentProfile} pid=${open} reqs=${reqs} rq=${rq} onClose=${() => setOpen(null)} onRequested=${loadReqs} />`}
    </div>`;
}
/* Employer: every profile they asked for, with the released details. */
function MyRequestsPage() {
  const P = usePortal();
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(null);
  const load = () =>
    api('mkt_my_requests')
      .then(r => {
        setRows(r.rows);
        setErr(null);
      })
      .catch(setErr);
  useEffect(() => {
    load();
  }, []);
  const home = mktHome(P);
  if (err && !rows) return html`<${LoadError} error=${err} onRetry=${load} />`;
  if (!rows) return html`<${Spinner} />`;
  return html`<div className="stack">
      <${KitStats} items=${[
        { v: rows.length, l: 'Profiles requested' },
        { v: rows.filter(r => r.st === 'new').length, l: 'Waiting for StratEdge', tone: rows.some(r => r.st === 'new') ? 'warn' : '' },
        { v: rows.filter(r => r.st === 'approved' || r.st === 'submitted').length, l: 'Released to you', tone: 'ok' },
      ]} />
      ${
        rows.length
          ? html`<section className="panel" style=${{ padding: '6px 8px' }}><div className="tblwrap"><table className="tbl click"><thead><tr><th>Profile</th><th>Requested</th><th>For</th><th>Status</th><th /></tr></thead><tbody>
              ${rows.map(
                r => html`<tr key=${r.id} onClick=${() => setOpen(r.pid)} tabIndex="0">
                    <td><b style=${{ fontWeight: 600 }}>${r.code}</b> ${r.card ? r.card.ti : r.ti}${r.card && r.card.n ? html`<div className="small">${r.card.n}${r.card.e ? ' · ' + r.card.e : ''}${r.card.ph ? ' · ' + r.card.ph : ''}</div>` : null}</td>
                    <td className="small nw">${fmtTs(r.at)}</td>
                    <td className="small">${r.rqTitle || '—'}</td>
                    <td><${Chip} s=${mktStChip(r.st)}>${MKT_ST[r.st] || r.st}<//>${r.dec && r.dec.why && r.st === 'declined' ? html`<div className="muted small">${r.dec.why}</div>` : null}</td>
                    <td className="r" onClick=${e => e.stopPropagation()}>${r.card && r.card.resumeUrl ? html`<a className="btn ghost sm" href=${r.card.resumeUrl}><${Icon} n="down" />Resume</a>` : null}</td>
                  </tr>`
              )}
            </tbody></table></div></section>`
          : html`<div className="panel"><${Empty} title="No requests yet" action=${html`<a className="btn" href=${'#' + home + '/talent'}>Source talent</a>`}>Find a profile under Source talent and request it; StratEdge releases the name, contact details and resume here.<//></div>`
      }
      ${open && html`<${TalentProfile} pid=${open} reqs=${rows} onClose=${() => setOpen(null)} onRequested=${load} />`}
    </div>`;
}

/* ================= Staff: Talent marketplace ================= */
function MarketplacePage() {
  const P = usePortal();
  const [tab, setTab] = useState('requests');
  const [counts, setCounts] = useState({ newRequests: 0, on: 0 });
  useEffect(() => {
    api('mkt_pool', { only: 'on' })
      .then(r => setCounts({ newRequests: r.newRequests, on: r.on }))
      .catch(() => {});
  }, [tab]);
  return html`<div className="stack">
      <${KitTabs} tab=${tab} onTab=${setTab} tabs=${[
        ['requests', 'Requests', counts.newRequests || null],
        ['profiles', 'Profiles', counts.on || null],
        ['preview', 'What employers see'],
        ['employers', 'Employers'],
        ['settings', 'Settings'],
      ]} />
      ${tab === 'requests' && html`<${MktRequests} />`}
      ${tab === 'profiles' && html`<${MktProfiles} onChanged=${() => setCounts({ ...counts })} />`}
      ${tab === 'preview' && html`<${ClientCtx.Provider} value=${{ openReqs: [], reqs: [], preview: true }}><${TalentPage} q=${{}} /><//>`}
      ${tab === 'employers' && html`<${MktEmployers} />`}
      ${tab === 'settings' && html`<${MktSettings} />`}
    </div>`;
}
function MktRequests() {
  const toast = useToast();
  const [st, setSt] = useState('new');
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [dec, setDec] = useState(null); // {row, st}
  const load = () =>
    api('mkt_requests', { st })
      .then(r => {
        setRows(r.rows);
        setErr(null);
      })
      .catch(setErr);
  useEffect(() => {
    load();
  }, [st]);
  return html`<div className="stack">
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Status">
          ${[['new', 'Waiting'], ['approved', 'Approved'], ['declined', 'Declined'], ['all', 'All']].map(([k, v]) => html`<button key=${k} type="button" className=${st === k ? 'on' : ''} onClick=${() => setSt(k)}>${v}</button>`)}
        </div>
        <div className="push"><button type="button" className="btn ghost sm" onClick=${load}><${Icon} n="refresh" />Refresh</button></div>
      </div>
      ${err && html`<${LoadError} error=${err} onRetry=${load} />`}
      ${!rows && !err && html`<${Spinner} />`}
      ${
        rows &&
        (rows.length
          ? html`<section className="panel" style=${{ padding: '6px 8px' }}><div className="tblwrap"><table className="tbl"><thead><tr><th>Employer</th><th>Profile</th><th>For</th><th>Requested</th><th>Status</th><th /></tr></thead><tbody>
              ${rows.map(
                r => html`<tr key=${r.id}>
                    <td><b style=${{ fontWeight: 600 }}>${r.org}</b><div className="muted small">${r.byn} · ${r.bye}${r.orgKind === 'vendor' ? ' · vendor' : ''}</div></td>
                    <td>${r.card ? html`<b style=${{ fontWeight: 600 }}>${r.card.n}</b> <span className="muted small">${r.code}</span><div className="small">${r.card.ti}${r.card.loc ? ' · ' + r.card.loc : ''}${r.card.auth ? ' · ' + r.card.auth : ''}</div>` : html`${r.code} <span className="muted small">(record removed)</span>`}${r.note && html`<div className="small" style=${{ marginTop: 4 }}>“${r.note}”</div>`}</td>
                    <td className="small">${r.rqTitle || '—'}</td>
                    <td className="small nw">${fmtTs(r.at)}</td>
                    <td><${Chip} s=${mktStChip(r.st)}>${r.st === 'new' ? 'Waiting' : MKT_ST[r.st] || r.st}<//>${r.dec && html`<div className="muted small">${r.dec.by}${r.dec.at ? ', ' + fmtTs(r.dec.at) : ''}${r.dec.mailed ? ' · emailed' : ''}</div>`}</td>
                    <td className="r"><div className="actions" style=${{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                      ${r.card && r.card.resumeUrl && html`<a className="btn ghost sm" href=${r.card.resumeUrl} title="Resume"><${Icon} n="down" /></a>`}
                      ${r.st !== 'approved' && html`<button type="button" className="btn go sm" onClick=${() => setDec({ row: r, st: 'approved' })}>Approve</button>`}
                      ${r.st !== 'declined' && html`<button type="button" className="btn ghost sm" onClick=${() => setDec({ row: r, st: 'declined' })}>Decline</button>`}
                    </div></td>
                  </tr>`
              )}
            </tbody></table></div></section>`
          : html`<div className="panel"><${Empty} title=${st === 'new' ? 'No requests waiting' : 'Nothing here'}>When a client or vendor contact asks for a profile under Source talent, it shows up here. Approve to release the name, contact details and resume (and email them), or decline with a reason.<//></div>`)
      }
      ${dec && html`<${MktDecide} row=${dec.row} st=${dec.st} onClose=${() => setDec(null)} onDone=${() => {
        setDec(null);
        load();
      }} />`}
    </div>`;
}
function MktDecide({ row, st, onClose, onDone }) {
  const toast = useToast();
  const [why, setWhy] = useState(st === 'declined' ? 'This consultant is no longer available.' : '');
  const [email, setEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const r = await api('mkt_decide', { id: row.id, st, why: why.trim(), email });
      toast(st === 'approved' ? `Approved${r.mailed ? ' and emailed to ' + row.bye : ''}.` : `Declined${r.mailed ? ' and the employer was told' : ''}.`);
      onDone();
    } catch (e) {
      toast(errText(e), true);
      setBusy(false);
    }
  };
  return html`<${Modal} title=${(st === 'approved' ? 'Release ' : 'Decline ') + row.code + (row.card ? ' · ' + row.card.n : '')} onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Cancel</button><button type="button" className=${'btn ' + (st === 'approved' ? 'go' : '')} disabled=${busy} onClick=${go}>${busy ? 'Working…' : st === 'approved' ? 'Approve and release' : 'Decline'}</button>`}>
      <div className="form">
        <p className="muted small" style=${{ margin: 0 }}>${st === 'approved' ? `${row.byn} at ${row.org} will see the name, email, phone and resume in their portal${row.rqTitle ? ', and a submission is logged for "' + row.rqTitle + '"' : ''}.` : `${row.byn} at ${row.org} will see the profile as not released, with your reason.`}</p>
        <${Field} label=${st === 'approved' ? 'A line for the email (optional)' : 'Reason shown to the employer'}><textarea rows="3" value=${why} onInput=${e => setWhy(e.target.value)} /><//>
        <label className="kcheck"><input type="checkbox" checked=${email} onChange=${e => setEmail(e.target.checked)} /><span>Email ${row.bye}${st === 'approved' && row.card && row.card.resumeUrl ? ' with the resume attached' : ''}</span></label>
      </div>
    <//>`;
}
function MktProfiles({ onChanged }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [only, setOnly] = useState('on');
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [sel, setSel] = useState(new Set());
  const [edit, setEdit] = useState(null);
  const load = () =>
    api('mkt_pool', { q, only })
      .then(r => {
        setD(r);
        setErr(null);
        setSel(new Set());
      })
      .catch(setErr);
  useEffect(() => {
    load();
  }, [only]);
  const set = async (keys, on, extra) => {
    if (!keys.length) return;
    try {
      const r = await api('mkt_set', { keys, on, ...(extra || {}) });
      toast(on ? `${r.n} profile${r.n === 1 ? '' : 's'} now in the marketplace.` : `${r.n} profile${r.n === 1 ? '' : 's'} taken out.`);
      load();
      onChanged && onChanged();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const rows = (d && d.rows) || [];
  const allSel = rows.length > 0 && rows.every(r => sel.has(r.key));
  return html`<div className="stack">
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Show">
          ${[['on', 'In the marketplace'], ['off', 'Not listed'], ['', 'Everyone']].map(([k, v]) => html`<button key=${k} type="button" className=${only === k ? 'on' : ''} onClick=${() => setOnly(k)}>${v}</button>`)}
        </div>
        <input type="search" style=${{ maxWidth: 260 }} placeholder="Name, title, skill, city" value=${q} onInput=${e => setQ(e.target.value)} onKeyDown=${e => e.key === 'Enter' && load()} aria-label="Search people" />
        <button type="button" className="btn ghost sm" onClick=${load}>Search</button>
        <div className="push">
          ${sel.size > 0 && html`<span className="muted small">${sel.size} selected</span>`}
          ${sel.size > 0 && only !== 'on' && html`<button type="button" className="btn go sm" onClick=${() => set([...sel], true)}><${Icon} n="globe" />Show in marketplace</button>`}
          ${sel.size > 0 && only !== 'off' && html`<button type="button" className="btn ghost sm" onClick=${() => set([...sel], false)}>Take out</button>`}
        </div>
      </div>
      <p className="muted small" style=${{ margin: 0 }}>Employers see listed people without names: title, skills, years, location, availability and a rate band (set the band or availability yourself with Edit, or it comes from the record). People come from the consultant database, the ATS and the bench (job portal resumes).</p>
      ${err && html`<${LoadError} error=${err} onRetry=${load} />`}
      ${!d && !err && html`<${Spinner} />`}
      ${
        d &&
        html`<section className="panel" style=${{ padding: '6px 8px' }}>
            ${
              rows.length
                ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th style=${{ width: 30 }}><input type="checkbox" checked=${allSel} onChange=${e => setSel(e.target.checked ? new Set(rows.map(r => r.key)) : new Set())} aria-label="Select all" /></th><th>Person</th><th>Title · skills</th><th>Location</th><th>Work authorization</th><th>Rate · band</th><th>Listed</th><th /></tr></thead><tbody>
                    ${rows.map(
                      r => html`<tr key=${r.key} className=${r.on ? '' : 'muted'}>
                          <td><input type="checkbox" checked=${sel.has(r.key)} onChange=${e => {
                            const n = new Set(sel);
                            e.target.checked ? n.add(r.key) : n.delete(r.key);
                            setSel(n);
                          }} aria-label=${'Select ' + r.n} /></td>
                          <td><b style=${{ fontWeight: 600 }}>${r.n || '—'}</b><div className="muted small">${r.code} · ${r.src === 'portal' ? 'bench' : r.src === 'ats' ? 'ATS' : 'database'}${r.resume ? '' : ' · no resume'}</div></td>
                          <td className="small">${r.hl || r.ti || '—'}${r.skills.length ? html`<div className="muted small">${r.skills.join(', ')}</div>` : null}</td>
                          <td className="small">${r.loc || '—'}${r.avail ? html`<div className="muted small">${r.avail}</div>` : null}</td>
                          <td className="small">${r.auth || '—'}</td>
                          <td className="small">${r.rate || '—'}${r.band ? html`<div className="muted small">shown as ${r.band}</div>` : null}</td>
                          <td>${r.on ? html`<${Chip} s="ok">Listed<//>` : html`<span className="muted small">No</span>`}</td>
                          <td className="r"><div className="actions" style=${{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                            <button type="button" className="btn ghost sm" onClick=${() => setEdit(r)}>Edit</button>
                            ${r.on ? html`<button type="button" className="btn ghost sm" onClick=${() => set([r.key], false)}>Take out</button>` : html`<button type="button" className="btn sm" onClick=${() => set([r.key], true)}>List</button>`}
                          </div></td>
                        </tr>`
                    )}
                  </tbody></table></div>${d.total > rows.length && html`<p className="muted small" style=${{ padding: '8px 6px 2px' }}>Showing ${rows.length} of ${d.total}; search to narrow it down.</p>`}`
                : html`<${Empty} title=${only === 'on' ? 'Nobody is listed yet' : 'No one matches'}>${only === 'on' ? 'Open "Not listed", tick the people employers may see, and press "Show in marketplace".' : 'Try another search.'}<//>`
            }
          </section>`
      }
      ${edit && html`<${MktEdit} row=${edit} onClose=${() => setEdit(null)} onSave=${async v => {
        await set([edit.key], v.on, { band: v.band, avail: v.avail, hl: v.hl });
        setEdit(null);
      }} />`}
    </div>`;
}
function MktEdit({ row, onClose, onSave }) {
  const [f, setF] = useState({ on: row.on, band: row.band || '', avail: row.avail || '', hl: row.hl || '' });
  const [busy, setBusy] = useState(false);
  return html`<${Modal} title=${row.n + ' in the marketplace'} onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Cancel</button><button type="button" className="btn" disabled=${busy} onClick=${async () => {
    setBusy(true);
    await onSave(f);
    setBusy(false);
  }}>Save</button>`}>
      <div className="form">
        <label className="kcheck"><input type="checkbox" checked=${f.on} onChange=${e => setF({ ...f, on: e.target.checked })} /><span>Listed in the marketplace</span></label>
        <${Field} label="Headline shown to employers" hint=${'Leave empty to use the record’s title' + (row.ti ? ': ' + row.ti : '') + '.'}><input value=${f.hl} onInput=${e => setF({ ...f, hl: e.target.value })} placeholder="e.g. Senior SAP PP/QM consultant, 9 years, pharma" /><//>
        <div className="row2">
          <${Field} label="Rate band shown" hint=${'Empty = worked out from the record’s rate' + (row.rate ? ' (' + row.rate + ')' : '') + '.'}><input value=${f.band} onInput=${e => setF({ ...f, band: e.target.value })} placeholder="e.g. $80–90/hr" /><//>
          <${Field} label="Availability shown"><input value=${f.avail} onInput=${e => setF({ ...f, avail: e.target.value })} placeholder="e.g. Immediately, 2 weeks, 2026-11-01" /><//>
        </div>
      </div>
    <//>`;
}
function MktEmployers() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [adding, setAdding] = useState(false);
  const load = () =>
    api('mkt_employers')
      .then(r => {
        setD(r);
        setErr(null);
      })
      .catch(setErr);
  useEffect(() => {
    load();
  }, []);
  if (err && !d) return html`<${LoadError} error=${err} onRetry=${load} />`;
  if (!d) return html`<${Spinner} />`;
  return html`<div className="stack">
      <div className="toolbar">
        <p className="muted small" style=${{ margin: 0 }}>Everyone who can search the marketplace: client contacts (from their client workspace) and vendor contacts. Client logins are made under Roles & access or on the Clients page; vendor logins here.</p>
        <div className="push"><button type="button" className="btn" onClick=${() => setAdding(true)}><${Icon} n="plus" />Add a vendor login</button></div>
      </div>
      <section className="panel" style=${{ padding: '6px 8px' }}>
        ${
          d.rows.length
            ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Person</th><th>Organisation</th><th>Kind</th><th>Last seen</th><th className="r">Requests</th></tr></thead><tbody>
                ${d.rows.map(r => html`<tr key=${r.uid}><td><b style=${{ fontWeight: 600 }}>${r.n}</b><div className="muted small">${r.e}</div></td><td>${r.org || '—'}</td><td className="small">${r.kind === 'vendor' ? 'Vendor contact' : 'Client contact'}</td><td className="small nw">${r.seen ? fmtTs(r.seen) : 'Never signed in'}</td><td className="r num">${r.requests}</td></tr>`)}
              </tbody></table></div>`
            : html`<${Empty} title="No employer logins yet">Add a client contact under Clients, or a vendor login here.<//>`
        }
      </section>
      ${adding && html`<${MktVendorLogin} vendors=${d.vendors} onClose=${() => setAdding(false)} onDone=${() => {
        setAdding(false);
        load();
      }} />`}
    </div>`;
}
function MktVendorLogin({ vendors, onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({ vid: vendors[0] ? vendors[0].id : '', n: '', e: '', title: '' });
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState(null);
  const v = vendors.find(x => x.id === f.vid);
  const pickContact = c => setF({ ...f, n: c.n, e: c.e });
  const save = async () => {
    if (!f.vid || f.n.trim().length < 2 || !/^\S+@\S+\.\S+$/.test(f.e)) {
      toast('Pick the vendor and add the person’s name and email.', true);
      return;
    }
    setBusy(true);
    try {
      const r = await api('admin_create_user', { kind: 'vendor', vid: f.vid, name: f.n.trim(), email: f.e.trim(), title: f.title.trim(), company: v ? v.n : '' });
      setMade(r);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<${Modal} title="Vendor login for the marketplace" onClose=${made ? onDone : onClose} foot=${made ? html`<button type="button" className="btn" onClick=${onDone}>Done</button>` : html`<button type="button" className="btn ghost" onClick=${onClose}>Cancel</button><button type="button" className="btn" disabled=${busy} onClick=${save}>${busy ? 'Creating…' : 'Create login'}</button>`}>
      ${
        made
          ? html`<div className="stack">
              <${InviteResult} name=${f.n} email=${f.e} link=${made.link} mailed=${made.mailed} />
              <p className="muted small" style=${{ margin: 0 }}>They sign in through the <b>Client login</b> and see Source talent, Requirements and Profile requests.</p>
            </div>`
          : html`<div className="form">
              <${Field} label="Vendor"><select value=${f.vid} onChange=${e => setF({ ...f, vid: e.target.value })}>${vendors.map(x => html`<option key=${x.id} value=${x.id}>${x.n}</option>`)}</select><//>
              ${v && v.contacts.length > 0 && html`<div className="chips">${v.contacts.filter(c => c.e).map(c => html`<button key=${c.e} type="button" className="chip pick" onClick=${() => pickContact(c)}>${c.n || c.e}</button>`)}</div>`}
              <div className="row2">
                <${Field} label="Full name"><input value=${f.n} onInput=${e => setF({ ...f, n: e.target.value })} /><//>
                <${Field} label="Email"><input type="email" value=${f.e} onInput=${e => setF({ ...f, e: e.target.value })} /><//>
              </div>
              <${Field} label="Title (optional)"><input value=${f.title} onInput=${e => setF({ ...f, title: e.target.value })} placeholder="e.g. Delivery manager" /><//>
              <p className="muted small" style=${{ margin: 0 }}>They are emailed an invitation to choose their own password. Vendor contacts never see your timesheets or invoices, only the marketplace and their own requirements.</p>
            </div>`
      }
    <//>`;
}
function MktSettings() {
  const toast = useToast();
  const [f, setF] = useState(null);
  const [emps, setEmps] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api('mkt_pool', { only: 'on' })
      .then(r => setF({ ...r.settings, autoApprove: r.settings.autoApprove || [] }))
      .catch(() => setF({ band: 10, summary: 700, intro: '', autoApprove: [] }));
    api('mkt_employers')
      .then(r => setEmps(r.rows))
      .catch(() => {});
  }, []);
  if (!f) return html`<${Spinner} />`;
  const orgs = [];
  emps.forEach(e => {
    if (e.orgId && !orgs.some(o => o.id === e.orgId)) orgs.push({ id: e.orgId, n: e.org || e.orgId, kind: e.kind });
  });
  const save = async () => {
    setBusy(true);
    try {
      const r = await api('mkt_settings_save', f);
      setF({ ...r.settings });
      toast('Marketplace settings saved.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<section className="panel stack form" style=${{ maxWidth: 720 }}>
      <h2 className="ph">What employers see</h2>
      <div className="row2">
        <${Field} label="Rate band width ($/hr)" hint="A $78/hr rate shows as $70–80/hr with a width of 10."><input type="number" min="5" max="50" value=${f.band} onInput=${e => setF({ ...f, band: +e.target.value })} /><//>
        <${Field} label="Resume summary length (characters)" hint="Names, emails, phones and links are always removed."><input type="number" min="200" max="2000" value=${f.summary} onInput=${e => setF({ ...f, summary: +e.target.value })} /><//>
      </div>
      <${Field} label="Line shown above the search" hint="Optional."><input value=${f.intro} onInput=${e => setF({ ...f, intro: e.target.value })} placeholder="Profiles StratEdge can place with you…" /><//>
      <div>
        <span className="lbl">Trusted employers: approve their requests automatically</span>
        <p className="muted small" style=${{ margin: '0 0 6px' }}>Their requests are released at once, name and resume included. Everyone else waits for a recruiter.</p>
        ${orgs.length ? html`<div className="stack" style=${{ gap: 4 }}>${orgs.map(o => html`<label key=${o.id} className="kcheck"><input type="checkbox" checked=${f.autoApprove.includes(o.id)} onChange=${e => setF({ ...f, autoApprove: e.target.checked ? [...f.autoApprove, o.id] : f.autoApprove.filter(x => x !== o.id) })} /><span>${o.n} <span className="muted small">(${o.kind === 'vendor' ? 'vendor' : 'client'})</span></span></label>`)}</div>` : html`<p className="muted small">No employer logins yet.</p>`}
      </div>
      <div><button type="button" className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save settings'}</button></div>
    </section>`;
}
