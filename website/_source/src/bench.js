/* ================= v36: the Bench desk ================= */
// One place for recruiting team and recruiters: who is on the bench and for how long, what is due today, every
// submission from the shortlist to the placement, the consultant's approval (RTR), the check for earlier
// submissions of the same person, and the details that need confirming (api/bench.php, routes bd_*).
const BD_DONE_ST = ['placed', 'rejected', 'withdrawn', 'closed'];
const BD_LANES = ['shortlisted', 'approval', 'ready', 'submitted', 'screening', 'interview', 'offer', 'hold'];
const BD_FRESH_KEYS = [
  ['avail', 'Availability'],
  ['rate', 'Rate'],
  ['loc', 'Location and work mode'],
  ['auth', 'Work authorization'],
  ['resume', 'Resume'],
];
const BD_ASK_KEYS = ['avail', 'rate', 'loc', 'auth'];
const BD_NEXT = {
  submitted: ['screening', 'interview', 'hold', 'rejected', 'withdrawn', 'closed'],
  screening: ['interview', 'hold', 'rejected', 'withdrawn', 'closed'],
  interview: ['interview', 'offer', 'hold', 'rejected', 'withdrawn', 'closed'],
  offer: ['placed', 'hold', 'rejected', 'withdrawn'],
  // v45.4: back in play from on hold
  hold: ['screening', 'interview', 'offer', 'rejected', 'withdrawn', 'closed'],
};
const BD_STAGE_VERB = { screening: 'Screening', interview: 'Interview…', offer: 'Offer', hold: 'On hold', placed: 'Placed', rejected: 'Rejected…', withdrawn: 'Withdraw…', closed: 'Closed…' };
const BD_TZ = ['ET', 'CT', 'MT', 'PT', 'IST', 'GMT'];
let BD_BOOT_P = null;
const bdBootLoad = force => {
  if (!BD_BOOT_P || force)
    BD_BOOT_P = api('bd_boot').catch(e => {
      BD_BOOT_P = null;
      throw e;
    });
  return BD_BOOT_P;
};
function useBdBoot() {
  const [st, setSt] = useState({ b: null, err: null });
  const load = force =>
    bdBootLoad(force).then(
      b => setSt({ b, err: null }),
      err => setSt({ b: null, err })
    );
  useEffect(() => {
    load(false);
  }, []);
  return [st.b, st.err, () => load(true)];
}
const bdName = (boot, uid) => {
  const p = boot && uid ? boot.people.find(x => x.id === uid) : null;
  return p ? p.n : '';
};
const bdOwner = x => x.own || x.by || '';
const bdOwnerName = (boot, x) => x.ownn || bdName(boot, bdOwner(x)) || x.byn || '';
const bdDaysAgo = v => {
  const t = typeof v === 'number' ? v : v ? parseD(v).getTime() : 0;
  return t && !isNaN(t) ? Math.max(0, Math.floor((Date.now() - t) / 86400000)) : null;
};
const bdPlural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
const bdChainOf = s => [s.vn, s.ec ? s.ec + ' (end client)' : ''].filter(Boolean).join(' → ');

/* ---------- freshness (the same rules as the server's bdFresh) ---------- */
function bdFreshOf(c, set) {
  const win = (set && set.fresh) || { avail: 14, rate: 30, loc: 60, auth: 90, resume: 90 };
  const have = {
    avail: !!(String(c.avail || '').trim() || c.availDate),
    rate: !!String(c.rate || '').trim(),
    loc: !!String(c.loc || '').trim(),
    auth: !!String(c.auth || '').trim(),
    resume: !!c.rid,
  };
  const fr = c.fresh || {};
  const out = {};
  BD_FRESH_KEYS.forEach(([k, label]) => {
    const e = fr[k] || null;
    const at = (e && e.at) || (k === 'resume' ? c.rAt || c.at : c.at) || 0;
    const left = Math.floor((at + win[k] * 86400000 - Date.now()) / 86400000);
    out[k] = { label, st: !have[k] ? 'missing' : left < 0 ? 'stale' : left <= 3 ? 'soon' : 'fresh', at, left, how: (e && e.how) || 'entered', by: (e && e.byn) || '' };
  });
  return out;
}
function bdFreshLine(f) {
  if (f.st === 'missing') return 'not recorded';
  const when = f.at ? fmtDay(f.at) : 'an unknown date';
  const how =
    f.how === 'entered'
      ? 'entered ' + when
      : f.how === 'uploaded'
        ? 'uploaded ' + when
        : 'confirmed ' + when + (f.how === 'recruiter' ? (f.by ? ' by ' + f.by : ' by a recruiter') : f.how === 'changed' ? ' (changed by the consultant)' : ' by the consultant');
  return how + (f.st === 'stale' ? ', due for a check' : f.st === 'soon' ? ', due in ' + bdPlural(Math.max(0, f.left), 'day') : '');
}
function BdFreshDots({ fr }) {
  return html`<span className="bddots" role="img" aria-label=${BD_FRESH_KEYS.map(([k, l]) => l + ': ' + bdFreshLine(fr[k])).join('. ')}>
      ${BD_FRESH_KEYS.map(([k, l]) => html`<i key=${k} className=${'bd-' + fr[k].st} title=${l + ': ' + bdFreshLine(fr[k])} />`)}
    </span>`;
}
const bdNeedsCheck = fr => BD_ASK_KEYS.filter(k => fr[k].st === 'stale' || fr[k].st === 'missing');

/* ---------- the check for earlier submissions (shown before anything is sent or logged) ---------- */
function BdConflictBox({ list, manager, ack, setAck, ovr, setOvr, logging }) {
  const all = list || [];
  const hard = all.filter(x => x.kind === 'confirmed');
  const soft = all.filter(x => x.kind === 'possible');
  const info = all.filter(x => x.kind === 'info');
  if (!all.length) return null;
  const row = x =>
    html`<li key=${x.sid}>
      <b>${x.cn}</b> for ${x.req || 'a role'} to ${x.vn || 'a vendor'}${x.ec ? ' (end client ' + x.ec + ')' : ''}${x.ext ? ', requisition ' + x.ext : ''}${x.d ? ', ' + fmtDate(x.d, { month: 'short', day: 'numeric', year: 'numeric' }) : ''}${x.byn ? ', by ' + x.byn : ''} · ${SUB_ST[x.st] || x.st}${x.rtr ? ' · RTR on file' : ''}
      <div className="small">Why it matches: ${x.why}</div>
    </li>`;
  return html`<div className="bdconf stack" style=${{ gap: 10 }}>
      ${
        hard.length > 0 &&
        html`<div className="note red"><div style=${{ flex: 1 }}>
            <b>Already submitted</b>
            <ul>${hard.map(row)}</ul>
            ${
              logging
                ? null
                : manager
                  ? html`<${Field} label="Reason to send it anyway (kept with the submission)"><input value=${ovr || ''} onInput=${e => setOvr(e.target.value)} placeholder="e.g. the client asked for this resubmission" /><//>`
                  : html`<p className="small" style=${{ margin: '6px 0 0' }}>A bench manager can send it anyway with a reason.</p>`
            }
          </div></div>`
      }
      ${
        soft.length > 0 &&
        html`<div className="note amber"><div style=${{ flex: 1 }}>
            <b>Check first: a similar earlier submission</b>
            <ul>${soft.map(row)}</ul>
            ${!logging && html`<label className="check"><input type="checkbox" checked=${!!ack} onChange=${e => setAck(e.target.checked)} /><span>I checked: this is a different opening</span></label>`}
          </div></div>`
      }
      ${info.length > 0 && html`<div className="note info"><div style=${{ flex: 1 }}><b>Also sent to the same end client</b><ul>${info.map(row)}</ul></div></div>`}
      ${logging && (hard.length > 0 || soft.length > 0) && html`<label className="check"><input type="checkbox" checked=${!!ack} onChange=${e => setAck(e.target.checked)} /><span>I know about the earlier submission; log this one anyway</span></label>`}
    </div>`;
}

/* ---------- the page ---------- */
function BenchDeskPage({ q }) {
  const P = usePortal();
  const [boot, bootErr, reboot] = useBdBoot();
  const cands = useCol('rec/cand/items', 'u:desc');
  const subs = useCol('rec/sub/items', 'd:desc');
  const [tab, setTab] = useState((q && q.tab) || 'today');
  const [who, setWho] = useState('mine');
  const [openC, setOpenC] = useState(null); // { id, tab }
  const [openS, setOpenS] = useState((q && q.s) || null);
  const [adding, setAdding] = useState(null);
  if (bootErr)
    return html`<div className="note red"><span>${errText(bootErr)}</span><div className="actions"><button className="btn sm" onClick=${reboot}>Try again</button></div></div>`;
  if (!boot || cands.loading || subs.loading) return html`<${Spinner} label="Loading the bench desk…" />`;
  const me = boot.me;
  const today = dkey();
  const mineC = c => bdOwner(c) === me || c.bk === me;
  const mineS = s => bdOwner(s) === me || s.bk === me || (s.next && s.next.own === me);
  const allSubs = subs.docs;
  const scopeC = cands.docs.filter(c => who === 'all' || mineC(c));
  const scopeS = allSubs.filter(s => who === 'all' || mineS(s));
  const open = scopeS.filter(s => !BD_DONE_ST.includes(s.st || 'submitted'));
  const bench = scopeC.filter(c => ['active', 'working', 'hold'].includes(c.st || 'active'));
  const lastSent = {};
  const openBy = {};
  allSubs.forEach(s => {
    if (!s.cid) return;
    if (subSent(s) && s.d && (!lastSent[s.cid] || s.d > lastSent[s.cid])) lastSent[s.cid] = s.d;
    if (!BD_DONE_ST.includes(s.st || 'submitted')) openBy[s.cid] = (openBy[s.cid] || 0) + 1;
  });
  const freshOf = {};
  bench.forEach(c => (freshOf[c.id] = bdFreshOf(c, boot.set)));
  const curS = openS && allSubs.find(s => s.id === openS);
  const curC = openC && cands.docs.find(c => c.id === openC.id);
  const monthKey = mkey(today);
  const kpi = {
    bench: bench.filter(c => c.st !== 'hold').length,
    open: open.length,
    due: open.filter(s => s.next && s.next.due && s.next.due <= today).length,
    intv: open.filter(s => s.st === 'interview' && s.intv && s.intv >= today && s.intv <= addDays(today, 6)).length,
    placed: scopeS.filter(s => s.st === 'placed' && mkey(s.stAt ? dkey(new Date(s.stAt)) : s.d) === monthKey).length,
  };
  const tabs = [
    ['today', 'Today'],
    ['bench', 'On the bench'],
    ['pipe', 'Pipeline'],
    ['set', 'Settings'],
  ];
  return html`<div className="stack bdpage">
      <div className="kpis">
        <a onClick=${() => setTab('bench')}><b>${kpi.bench}</b><span>On the bench</span></a>
        <a onClick=${() => setTab('pipe')}><b>${kpi.open}</b><span>Open submissions</span></a>
        <a onClick=${() => setTab('today')}><b>${kpi.due}</b><span>Due today or late</span></a>
        <a onClick=${() => setTab('pipe')}><b>${kpi.intv}</b><span>Interviews this week</span></a>
        <a><b>${kpi.placed}</b><span>Placed this month</span></a>
      </div>
      <div className="toolbar">
        <div className="tabs" role="tablist" style=${{ marginBottom: 0, border: 0 }}>
          ${tabs.map(([k, v]) => html`<button key=${k} role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${v}</button>`)}
        </div>
        <div className="push">
          <div className="seg" style=${{ marginBottom: 0 }} role="group" aria-label="Whose work">
            ${[
              ['mine', 'Mine'],
              ['all', 'Everyone'],
            ].map(([k, v]) => html`<button key=${k} className=${who === k ? 'on' : ''} onClick=${() => setWho(k)}>${v}</button>`)}
          </div>
          <button className="btn" onClick=${() => setAdding({})}><${Icon} n="plus" />Add to the pipeline</button>
        </div>
      </div>
      ${tab === 'today' && html`<${BdToday} boot=${boot} open=${open} bench=${bench} freshOf=${freshOf} lastSent=${lastSent} who=${who} onSub=${setOpenS} onCand=${(id, t) => setOpenC({ id, tab: t })} />`}
      ${tab === 'bench' && html`<${BdBenchList} boot=${boot} bench=${bench} all=${scopeC} freshOf=${freshOf} lastSent=${lastSent} openBy=${openBy} onCand=${(id, t) => setOpenC({ id, tab: t })} />`}
      ${tab === 'pipe' && html`<${BdPipeline} boot=${boot} subs=${scopeS} onSub=${setOpenS} />`}
      ${tab === 'set' && html`<${BdSettings} boot=${boot} onSaved=${reboot} />`}
      ${curC && html`<${BdConsultModal} key=${curC.id} c=${curC} boot=${boot} subs=${allSubs} startTab=${openC.tab} onClose=${() => setOpenC(null)} onSub=${id => { setOpenC(null); setOpenS(id); }} />`}
      ${curS && html`<${BdSubModal} key=${curS.id} s=${curS} boot=${boot} cands=${cands.docs} onClose=${() => setOpenS(null)} onCand=${id => { setOpenS(null); setOpenC({ id, tab: 'over' }); }} />`}
      ${adding && html`<${BdAddModal} boot=${boot} cands=${cands.docs} init=${adding} onClose=${() => setAdding(null)} onAdded=${id => { setAdding(null); setOpenS(id); }} />`}
    </div>`;
}

/* ---------- Today: what needs doing, in order ---------- */
function BdToday({ boot, open, bench, freshOf, lastSent, who, onSub, onCand }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const today = dkey();
  const tomorrow = addDays(today, 1);
  const due = open.filter(s => s.next && s.next.due && s.next.due <= today).sort((a, b) => (a.next.due < b.next.due ? -1 : a.next.due > b.next.due ? 1 : 0));
  const intv = open.filter(s => s.st === 'interview' && s.intv && s.intv >= today && s.intv <= tomorrow).sort((a, b) => ((a.intv + (a.intvAt || '')) < b.intv + (b.intvAt || '') ? -1 : 1));
  const ready = open.filter(s => s.st === 'ready');
  const waiting = open.filter(s => s.st === 'approval');
  const flagged = open.filter(s => s.flag);
  const quiet = Date.now() - 45 * 86400000;
  const noNext = open.filter(s => (!s.next || !s.next.what) && (s.stAt || s.u || s.at || 0) >= quiet);
  const oldNoNext = open.filter(s => (!s.next || !s.next.what) && (s.stAt || s.u || s.at || 0) < quiet).length;
  const toConfirm = bench.filter(c => c.st !== 'hold' && bdNeedsCheck(freshOf[c.id]).length > 0);
  const pushDay = addDays(today, -boot.set.push);
  const idle = bench.filter(c => c.st !== 'hold' && (!lastSent[c.id] || lastSent[c.id] < pushDay));
  const ask = async c => {
    setBusy(c.id);
    try {
      const r = await api('bd_confirm_send', { cid: c.id });
      Sync.kick();
      toast(r.mailed === false ? 'The request was saved but the email could not be sent (see Email › Sent log).' : 'Asked ' + firstName(c.n) + ' to confirm: ' + r.fields.map(k => (BD_FRESH_KEYS.find(x => x[0] === k) || [k, k])[1].toLowerCase()).join(', ') + '.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const subRow = (s, extra) =>
    html`<li key=${s.id} className="bdrow click" tabIndex="0" onClick=${() => onSub(s.id)} onKeyDown=${e => e.key === 'Enter' && onSub(s.id)}>
      <div className="bdmain">
        <b>${s.cn}</b> · ${s.req || 'Role not named'}
        <div className="muted small">${bdChainOf(s)}${extra ? html`${bdChainOf(s) ? ' · ' : ''}${extra}` : ''}</div>
      </div>
      <${Chip} s=${subChip(s.st)}>${SUB_ST[s.st] || s.st}<//>
    </li>`;
  const sec = (title, list, hint, render, more) =>
    list.length > 0 &&
    html`<section className="panel bdsec">
      <div className="bdsech"><h2>${title} <span className="muted">${list.length}</span></h2>${hint && html`<span className="muted small">${hint}</span>`}</div>
      <ul className="bdlist">${list.slice(0, more || 12).map(render)}</ul>
      ${list.length > (more || 12) && html`<p className="muted small">And ${list.length - (more || 12)} more.</p>`}
    </section>`;
  const nothing = !due.length && !intv.length && !ready.length && !waiting.length && !flagged.length && !noNext.length && !toConfirm.length && !idle.length;
  return html`<div className="stack">
      ${nothing && html`<section className="panel"><${Empty} title="Nothing due">${who === 'mine' ? 'No follow-ups, approvals or checks are waiting on you. Switch to Everyone to see the whole team.' : 'No follow-ups, approvals or checks are waiting.'}<//></section>`}
      ${sec('Due today or late', due, 'Next actions with a date of today or earlier', s => subRow(s, html`<span className=${s.next.due < today ? 'bdlate' : ''}>${s.next.what} · ${s.next.due < today ? bdPlural(daysBetween(s.next.due, today), 'day') + ' late' : 'today'}${s.next.ownn ? ' · ' + s.next.ownn : ''}</span>`))}
      ${sec('Interviews today and tomorrow', intv, '', s => subRow(s, (s.intv === today ? 'Today' : 'Tomorrow') + (s.intvAt ? ' at ' + s.intvAt + (s.intvTz ? ' ' + s.intvTz : '') : '') + (s.intvKind ? ' · ' + s.intvKind : '')))}
      ${sec('Flags to check', flagged, 'Changed rates and earlier submissions the consultant told you about', s => subRow(s, s.flag))}
      ${sec('Ready to send', ready, 'The consultant approved; send it and mark it submitted', s => subRow(s, s.rtr2 && s.rtr2.ans ? 'Approved ' + fmtDay(s.rtr2.ans.at) : 'Approval on file'))}
      ${sec('Waiting for the consultant’s approval', waiting, 'Ask again from the submission if it takes more than a day', s => subRow(s, s.rtr2 && s.rtr2.at ? 'Asked ' + fmtDay(s.rtr2.at) + (s.rtr2.exp && s.rtr2.exp < Date.now() ? ' · the link expired' : '') : ''))}
      ${sec('No next action', noNext, 'Every open submission needs an owner and a next step', s => subRow(s, bdPlural(bdDaysAgo(s.stAt || s.u || s.at) || 0, 'day') + ' in this stage'))}
      ${oldNoNext > 0 && html`<p className="muted small">${bdPlural(oldNoNext, 'older open submission')} had no update in 45 days. Close the ones that are over from the Pipeline (untick “Only moved in the last 60 days” to see them).</p>`}
      ${sec(
        'Details to confirm',
        toConfirm,
        'Availability, rate, location or work authorization not confirmed recently',
        c =>
          html`<li key=${c.id} className="bdrow">
            <div className="bdmain click" tabIndex="0" onClick=${() => onCand(c.id, 'over')} onKeyDown=${e => e.key === 'Enter' && onCand(c.id, 'over')}>
              <b>${c.n}</b> · ${c.ti || ''}
              <div className="muted small">${bdNeedsCheck(freshOf[c.id]).map(k => freshOf[c.id][k].label + ' ' + bdFreshLine(freshOf[c.id][k])).join(' · ')}</div>
            </div>
            <${BdFreshDots} fr=${freshOf[c.id]} />
            <button className="btn ghost sm" disabled=${busy === c.id || !c.e} title=${c.e ? '' : 'Add their email first'} onClick=${() => ask(c)}><${Icon} n="mail" />${busy === c.id ? 'Sending…' : 'Ask them'}</button>
          </li>`
      )}
      ${sec(
        'Not submitted lately',
        idle,
        'On the bench with no submission in ' + bdPlural(boot.set.push, 'day'),
        c =>
          html`<li key=${c.id} className="bdrow">
            <div className="bdmain click" tabIndex="0" onClick=${() => onCand(c.id, 'over')} onKeyDown=${e => e.key === 'Enter' && onCand(c.id, 'over')}>
              <b>${c.n}</b> · ${c.ti || ''}
              <div className="muted small">${lastSent[c.id] ? 'Last submitted ' + fmtDate(lastSent[c.id], { month: 'short', day: 'numeric' }) : 'Never submitted'}${c.benchSince ? ' · on the bench since ' + fmtDate(c.benchSince, { month: 'short', day: 'numeric' }) : ''}</div>
            </div>
            <button className="btn ghost sm" onClick=${() => onCand(c.id, 'reqs')}><${Icon} n="search" />Find requirements</button>
          </li>`
      )}
    </div>`;
}

/* ---------- On the bench ---------- */
function BdBenchList({ boot, bench, all, freshOf, lastSent, openBy, onCand }) {
  const [q, setQ] = useState('');
  const [show, setShow] = useState('bench');
  const ql = q.trim().toLowerCase();
  const base = show === 'bench' ? bench : all;
  const list = base
    .filter(c => !ql || [c.n, c.ti, c.sk, c.loc, c.auth, c.ownn, c.byn].filter(Boolean).join(' ').toLowerCase().includes(ql))
    .sort((a, b) => (bdDaysAgo(b.benchSince || b.at) || 0) - (bdDaysAgo(a.benchSince || a.at) || 0));
  return html`<div className="stack">
      <div className="toolbar" style=${{ marginBottom: 0 }}>
        <input type="search" style=${{ maxWidth: 300 }} placeholder="Search name, skill, location" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Search consultants" />
        <div className="seg" style=${{ marginBottom: 0 }}>
          ${[
            ['bench', 'On the bench'],
            ['all', 'Everyone'],
          ].map(([k, v]) => html`<button key=${k} className=${show === k ? 'on' : ''} onClick=${() => setShow(k)}>${v}</button>`)}
        </div>
        <span className="muted small push">Dots: ${BD_FRESH_KEYS.map(x => x[1].toLowerCase()).join(', ')}. Green is confirmed recently, amber due soon, red overdue, grey not recorded.</span>
      </div>
      <section className="panel" style=${{ padding: '6px 8px' }}>
        ${
          list.length
            ? html`<div className="tblwrap"><table className="tbl">
                <thead><tr><th>Consultant</th><th>Owner</th><th>On the bench</th><th>Details</th><th>Open</th><th>Last submitted</th><th>Status</th></tr></thead>
                <tbody>
                  ${list.map(c => {
                    const fr = freshOf[c.id] || bdFreshOf(c, boot.set);
                    const days = bdDaysAgo(c.benchSince || c.at);
                    return html`<tr key=${c.id} className="click" tabIndex="0" onClick=${() => onCand(c.id, 'over')} onKeyDown=${e => e.key === 'Enter' && onCand(c.id, 'over')}>
                      <td><b style=${{ fontWeight: 600 }}>${c.n}</b><div className="muted small">${[c.ti, c.loc].filter(Boolean).join(' · ')}</div><${DomChips} dom=${c.dom} small max=${3} /></td>
                      <td className="small">${bdOwnerName(boot, c) || '—'}${c.bkn ? html`<div className="muted small">Backup ${c.bkn}</div>` : ''}</td>
                      <td className="num nw">${days == null ? '—' : bdPlural(days, 'day')}</td>
                      <td><${BdFreshDots} fr=${fr} /></td>
                      <td className="num">${openBy[c.id] || 0}</td>
                      <td className="num nw">${lastSent[c.id] ? fmtDate(lastSent[c.id], { month: 'short', day: 'numeric' }) : html`<span className="muted small">Never</span>`}</td>
                      <td><${Chip} s=${c.st === 'hold' ? 'amber' : c.st === 'placed' ? 'ok' : c.st === 'inactive' ? 'red' : 'new'}>${CAND_STATUS[c.st || 'active'] || c.st}<//>${c.st === 'hold' && c.why ? html`<div className="muted small">${c.why}</div>` : ''}</td>
                    </tr>`;
                  })}
                </tbody>
              </table></div>`
            : html`<${Empty} title=${q ? 'No one matches' : 'No one on the bench'}>${q ? 'Try fewer words.' : 'Consultants who are available or in process show here. Add them under Consultants, or switch to Everyone.'}<//>`
        }
      </section>
    </div>`;
}

/* ---------- Pipeline: every open submission by stage ---------- */
function BdPipeline({ boot, subs, onSub }) {
  const [q, setQ] = useState('');
  const [recent, setRecent] = useState(true);
  const ql = q.trim().toLowerCase();
  const today = dkey();
  const cut = Date.now() - 60 * 86400000;
  const fresh = s => !recent || (s.stAt || s.u || s.at || 0) >= cut || (s.next && s.next.what);
  const match = s => !ql || [s.cn, s.req, s.vn, s.ec, s.ownn, s.byn, s.ext].filter(Boolean).join(' ').toLowerCase().includes(ql);
  const inLanes = subs.filter(s => BD_LANES.includes(s.st || 'submitted') && match(s));
  const hidden = inLanes.filter(s => !fresh(s)).length;
  const lanes = BD_LANES.map(st => [st, inLanes.filter(s => (s.st || 'submitted') === st && fresh(s))]);
  const since = Date.now() - 30 * 86400000;
  const done = subs.filter(s => BD_DONE_ST.includes(s.st) && (s.stAt || s.u || 0) >= since && match(s));
  const card = s => {
    const late = s.next && s.next.due && s.next.due < today;
    return html`<button key=${s.id} type="button" className=${'bdcard' + (s.flag ? ' flag' : '')} onClick=${() => onSub(s.id)}>
      <b>${s.cn}</b>
      <span className="bdrole">${s.req || 'Role not named'}</span>
      <span className="muted small">${bdChainOf(s) || 'Vendor not named'}</span>
      <span className="bdcardf">
        ${s.next && s.next.what ? html`<span className=${late ? 'bdlate' : ''} title=${s.next.what}>${late ? 'Late: ' : ''}${s.next.what}${s.next.due ? ' · ' + fmtDate(s.next.due, { month: 'short', day: 'numeric' }) : ''}</span>` : html`<span className="bdwarn">No next action</span>`}
        <span className="muted">${bdPlural(bdDaysAgo(s.stAt || s.u || s.at) || 0, 'day')} in this stage${s.ownn || s.byn ? ' · ' + (s.ownn || s.byn) : ''}</span>
      </span>
    </button>`;
  };
  return html`<div className="stack">
      <div className="toolbar" style=${{ marginBottom: 0 }}>
        <input type="search" style=${{ maxWidth: 320 }} placeholder="Search consultant, role, vendor, end client" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Search the pipeline" />
        <label className="check" style=${{ fontSize: 14 }}><input type="checkbox" checked=${recent} onChange=${e => setRecent(e.target.checked)} /><span>Only moved in the last 60 days${recent && hidden ? ' (' + hidden + ' older hidden)' : ''}</span></label>
      </div>
      <div className="bdlanes">
        ${lanes.map(
          ([st, list]) => html`<section key=${st} className="bdlane">
            <h3>${SUB_ST[st]} <span className="muted">${list.length}</span></h3>
            ${list.length ? list.map(card) : html`<p className="muted small">None</p>`}
          </section>`
        )}
      </div>
      <section className="panel" style=${{ padding: '6px 8px' }}>
        <h2 style=${{ margin: '10px 8px' }}>Closed in the last 30 days</h2>
        ${
          done.length
            ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Consultant</th><th>Role</th><th>Vendor → end client</th><th>Outcome</th><th>When</th></tr></thead><tbody>
                ${done.map(s => html`<tr key=${s.id} className="click" tabIndex="0" onClick=${() => onSub(s.id)} onKeyDown=${e => e.key === 'Enter' && onSub(s.id)}><td><b style=${{ fontWeight: 600 }}>${s.cn}</b></td><td>${s.req}</td><td className="small">${bdChainOf(s)}</td><td><${Chip} s=${subChip(s.st)}>${SUB_ST[s.st]}<//>${s.why ? html`<div className="muted small">${s.why}</div>` : ''}</td><td className="num nw">${fmtDay(s.stAt || s.u)}</td></tr>`)}
              </tbody></table></div>`
            : html`<p className="muted small" style=${{ margin: '0 8px 12px' }}>Nothing closed lately.</p>`
        }
      </section>
    </div>`;
}

/* ---------- Settings ---------- */
function BdSettings({ boot, onSaved }) {
  const toast = useToast();
  const s0 = boot.set;
  const [f, setF] = useState({ fresh: { ...s0.fresh }, conflictDays: s0.conflictDays, rtrDays: s0.rtrDays, push: s0.push, managers: s0.managers || [] });
  const [busy, setBusy] = useState(false);
  const num = (k, sub) => e => setF(sub ? { ...f, fresh: { ...f.fresh, [k]: e.target.value } } : { ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    try {
      await api('bd_settings_save', f);
      toast('Bench desk settings saved.');
      onSaved();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const ro = !boot.manager;
  return html`<section className="panel stack" style=${{ gap: 16 }}>
      ${ro && html`<div className="note info"><span>Bench managers and administrators change these settings.</span></div>`}
      <div>
        <h2>How long a confirmation stays fresh</h2>
        <p className="muted small">After this many days a field is due for a check, and the consultant can be asked to confirm it in one click. A new resume never counts as a fresh availability.</p>
        <div className="bdgrid5">
          ${BD_FRESH_KEYS.map(([k, l]) => html`<${Field} key=${k} label=${l + ' (days)'}><input type="number" min="1" max="365" value=${f.fresh[k]} onInput=${num(k, true)} disabled=${ro} /><//>`)}
        </div>
      </div>
      <div className="row3 form">
        <${Field} label="Earlier submissions to check (days)" hint="The same consultant to the same requirement, requisition ID, or end client and role inside this window stops a submission."><input type="number" min="14" max="365" value=${f.conflictDays} onInput=${num('conflictDays')} disabled=${ro} /><//>
        <${Field} label="Approval (RTR) valid for (days)" hint="The default end date the consultant approves."><input type="number" min="7" max="180" value=${f.rtrDays} onInput=${num('rtrDays')} disabled=${ro} /><//>
        <${Field} label="Flag a consultant not submitted in (days)" hint="Shown under Today › Not submitted lately."><input type="number" min="3" max="60" value=${f.push} onInput=${num('push')} disabled=${ro} /><//>
      </div>
      <div>
        <h2>Bench managers</h2>
        <p className="muted small">Besides administrators, HR and managers, these people may send a submission that repeats an earlier one (with a reason, kept on the record) and change who owns any consultant.${boot.admin ? '' : ' Administrators change this list.'}</p>
        <div className="bdpeople">
          ${boot.people.map(
            p => html`<label key=${p.id} className="check"><input type="checkbox" disabled=${!boot.admin} checked=${f.managers.includes(p.id)} onChange=${e => setF({ ...f, managers: e.target.checked ? [...f.managers, p.id] : f.managers.filter(x => x !== p.id) })} /><span>${p.n}</span></label>`
          )}
        </div>
      </div>
      ${!ro && html`<div className="actions"><button className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save settings'}</button></div>`}
    </section>`;
}

/* ---------- one consultant: status, owner, details to confirm, requirements that fit, submissions ---------- */
function BdConsultModal({ c, boot, subs, startTab, onClose, onSub }) {
  const toast = useToast();
  const [tab, setTab] = useState(startTab || 'over');
  const [busy, setBusy] = useState('');
  const [edit, setEdit] = useState(false);
  const [tick, setTick] = useState({});
  const [own, setOwn] = useState({ own: bdOwner(c), bk: c.bk || '', note: '' });
  const [bst, setBst] = useState({ st: c.st || 'active', why: c.why || '', since: c.benchSince || '' });
  const [reqs, setReqs] = useState(null);
  const [reqErr, setReqErr] = useState(null);
  const fr = bdFreshOf(c, boot.set);
  const mine = subs.filter(s => s.cid === c.id).sort((a, b) => (b.stAt || b.u || b.at || 0) - (a.stAt || a.u || a.at || 0));
  const canOwn = boot.manager || [bdOwner(c), c.bk, c.by].includes(boot.me);
  const run = async (key, route, body, msg) => {
    setBusy(key);
    try {
      const r = await api(route, body);
      Sync.kick();
      if (msg) toast(typeof msg === 'function' ? msg(r) : msg);
      setBusy('');
      return r;
    } catch (e) {
      toast(errText(e), true);
      setBusy('');
      return null;
    }
  };
  const loadReqs = () => {
    setReqErr(null);
    api('bd_reqs_for', { cid: c.id }).then(r => setReqs(r.reqs), setReqErr);
  };
  useEffect(() => {
    if (tab === 'reqs' && !reqs) loadReqs();
  }, [tab]);
  const ticked = Object.keys(tick).filter(k => tick[k]);
  const due = bdNeedsCheck(fr);
  const value = k =>
    k === 'avail'
      ? [c.avail, c.availDate ? 'from ' + fmtDate(c.availDate, { month: 'short', day: 'numeric', year: 'numeric' }) : ''].filter(Boolean).join(', ')
      : k === 'loc'
        ? [c.loc, c.md, c.reloc ? 'relocation: ' + c.reloc : ''].filter(Boolean).join(' · ')
        : k === 'resume'
          ? c.rn || (c.rid ? 'Resume on file' : '')
          : c[k] || '';
  const shortlist = async r => {
    const res = await run('sl' + r.id, 'bd_shortlist', { cid: c.id, vreq: r.id }, x => ((x.conflicts || []).some(y => y.kind !== 'info') ? 'Shortlisted. Check the earlier submission before sending.' : 'Shortlisted for ' + r.ti + '.'));
    if (res) onSub(res.id);
  };
  const conf = c.conf || null;
  const asked = conf && conf.st === 'sent' && conf.exp > Date.now();
  const tabs = [
    ['over', 'Overview'],
    ['reqs', 'Requirements that fit'],
    ['subs', 'Submissions' + (mine.length ? ' (' + mine.length + ')' : '')],
    ['hist', 'Changes'],
  ];
  if (edit) return html`<${CandModal} c=${c} onClose=${() => setEdit(false)} />`;
  return html`<${Modal} wide title=${c.n} onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${() => setEdit(true)}><${Icon} n="pen" />Edit the full record</button><button className="btn ghost" onClick=${onClose}>Close</button>`}>
      <div className="stack" style=${{ gap: 14 }}>
        <div className="muted small">${[c.ti, c.loc, c.auth, c.rate, c.e, c.ph].filter(Boolean).join(' · ')}</div>
        <${DomChips} dom=${c.dom} small />
        <div className="tabs" role="tablist" style=${{ marginBottom: 0 }}>
          ${tabs.map(([k, v]) => html`<button key=${k} role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${v}</button>`)}
        </div>
        ${
          tab === 'over' &&
          html`<div className="stack" style=${{ gap: 16 }}>
            <div>
              <h3 className="bdh3">Details and when they were last confirmed</h3>
              <div className="tblwrap"><table className="tbl bdfreshtbl">
                <tbody>
                  ${BD_FRESH_KEYS.map(
                    ([k, l]) => html`<tr key=${k}>
                      <td className="nw"><i className=${'bddot bd-' + fr[k].st} /> <b style=${{ fontWeight: 600 }}>${l}</b></td>
                      <td>${value(k) || html`<span className="muted">Not recorded</span>`}</td>
                      <td className="small muted">${bdFreshLine(fr[k])}</td>
                      <td><label className="check" style=${{ fontSize: 14 }}><input type="checkbox" checked=${!!tick[k]} onChange=${e => setTick({ ...tick, [k]: e.target.checked })} /><span>Confirmed now</span></label></td>
                    </tr>`
                  )}
                </tbody>
              </table></div>
              ${asked && html`<p className="note info" style=${{ marginTop: 10 }}><span>Asked ${fmtDay(conf.at)} by ${conf.by} to confirm ${conf.fields.map(k => (BD_FRESH_KEYS.find(x => x[0] === k) || [k, k])[1].toLowerCase()).join(', ')}; the link works until ${fmtDay(conf.exp)}.</span></p>`}
              ${conf && conf.st === 'answered' && html`<p className="muted small" style=${{ marginTop: 8 }}>Last answered by the consultant ${fmtDay(conf.ans)}.</p>`}
              <div className="actions" style=${{ justifyContent: 'flex-start', marginTop: 10 }}>
                <button className="btn sm" disabled=${!ticked.length || busy === 'fresh'} onClick=${async () => { if (await run('fresh', 'bd_fresh', { cid: c.id, fields: ticked }, 'Recorded: confirmed with the consultant today.')) setTick({}); }}><${Icon} n="check" />Record confirmation${ticked.length ? ' (' + ticked.length + ')' : ''}</button>
                <button className="btn ghost sm" disabled=${!c.e || busy === 'ask'} title=${c.e ? '' : 'Add their email first'} onClick=${() => run('ask', 'bd_confirm_send', { cid: c.id, fields: ticked.filter(k => BD_ASK_KEYS.includes(k)) }, r => (r.mailed === false ? 'Saved, but the email could not be sent.' : 'Emailed ' + firstName(c.n) + ' a link to confirm ' + r.fields.map(k => (BD_FRESH_KEYS.find(x => x[0] === k) || [k, k])[1].toLowerCase()).join(', ') + '.'))}><${Icon} n="mail" />${ticked.filter(k => BD_ASK_KEYS.includes(k)).length ? 'Ask them to confirm these' : due.length ? 'Ask them to confirm what is due' : 'Ask them to confirm'}</button>
              </div>
            </div>
            <div className="bdtwo">
              <div>
                <h3 className="bdh3">On the bench</h3>
                <div className="form">
                  <div className="row2">
                    <${Field} label="Status"><select value=${bst.st} onChange=${e => setBst({ ...bst, st: e.target.value })}>${Object.entries(CAND_STATUS).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//>
                    <${Field} label="On the bench since"><input type="date" value=${bst.since} max=${dkey()} onInput=${e => setBst({ ...bst, since: e.target.value })} /><//>
                  </div>
                  ${bst.st === 'hold' && html`<${Field} label="Why marketing is paused"><input value=${bst.why} onInput=${e => setBst({ ...bst, why: e.target.value })} placeholder="e.g. on vacation until the 20th" /><//>`}
                  <div className="actions" style=${{ justifyContent: 'flex-start' }}><button className="btn ghost sm" disabled=${busy === 'bench'} onClick=${() => run('bench', 'bd_bench', { cid: c.id, ...bst }, 'Saved.')}>Save</button></div>
                </div>
              </div>
              <div>
                <h3 className="bdh3">Who looks after ${firstName(c.n)}</h3>
                <div className="form">
                  <div className="row2">
                    <${Field} label="Owner"><select value=${own.own} disabled=${!canOwn} onChange=${e => setOwn({ ...own, own: e.target.value })}><option value="">Choose…</option>${boot.people.map(p => html`<option key=${p.id} value=${p.id}>${p.n}</option>`)}</select><//>
                    <${Field} label="Backup"><select value=${own.bk} disabled=${!canOwn} onChange=${e => setOwn({ ...own, bk: e.target.value })}><option value="">None</option>${boot.people.map(p => html`<option key=${p.id} value=${p.id}>${p.n}</option>`)}</select><//>
                  </div>
                  ${canOwn && html`<${Field} label="Note (optional)"><input value=${own.note} onInput=${e => setOwn({ ...own, note: e.target.value })} placeholder="Why it changed" /><//>`}
                  ${canOwn ? html`<div className="actions" style=${{ justifyContent: 'flex-start' }}><button className="btn ghost sm" disabled=${busy === 'own' || !own.own} onClick=${() => run('own', 'bd_own', { kind: 'cand', id: c.id, ...own }, 'Owner saved.')}>Save</button></div>` : html`<p className="muted small">The owner, the backup or a bench manager changes this.</p>`}
                </div>
              </div>
            </div>
          </div>`
        }
        ${
          tab === 'reqs' &&
          html`<div className="stack" style=${{ gap: 10 }}>
            <p className="muted small">Open requirements on the desk that fit ${firstName(c.n)}’s title, skills, location and work authorization, best first. Shortlisting starts a submission; nothing is sent until ${firstName(c.n)} approves it and you mark it submitted.</p>
            ${
              reqErr
                ? html`<div className="note red"><span>${errText(reqErr)}</span></div>`
                : !reqs
                  ? html`<${Spinner} />`
                  : reqs.length
                    ? html`<ul className="bdlist">${reqs.map(
                        r => html`<li key=${r.id} className="bdrow">
                          <div className="bdmain">
                            <b>${r.ti}</b> <span className="bdscore">${r.score}%</span>
                            <div className="muted small">${[r.vn, r.ec && r.ec + ' (end client)', r.loc, r.md, r.rate, r.ty].filter(Boolean).join(' · ')}</div>
                            ${r.why.length > 0 && html`<div className="small">${r.why.join(' · ')}</div>`}
                          </div>
                          ${
                            r.sub
                              ? html`<button className="btn ghost sm" onClick=${() => onSub(r.sub.sid)}>${SUB_ST[r.sub.st] || r.sub.st}</button>`
                              : html`<button className="btn sm" disabled=${busy === 'sl' + r.id} onClick=${() => shortlist(r)}><${Icon} n="plus" />${busy === 'sl' + r.id ? 'Adding…' : 'Shortlist'}</button>`
                          }
                        </li>`
                      )}</ul>`
                    : html`<${Empty} title="No open requirement fits yet">Requirements arrive on the Requirements desk from email, Dice, iLabor360 and vendors. Add a requirement there, or add a submission by hand with “Add to the pipeline”.<//>`
            }
          </div>`
        }
        ${
          tab === 'subs' &&
          (mine.length
            ? html`<ul className="bdlist">${mine.map(
                s => html`<li key=${s.id} className="bdrow click" tabIndex="0" onClick=${() => onSub(s.id)} onKeyDown=${e => e.key === 'Enter' && onSub(s.id)}>
                  <div className="bdmain"><b>${s.req}</b><div className="muted small">${[bdChainOf(s), s.d && subSent(s) ? 'sent ' + fmtDate(s.d, { month: 'short', day: 'numeric' }) : '', bdOwnerName(boot, s)].filter(Boolean).join(' · ')}</div></div>
                  <${Chip} s=${subChip(s.st)}>${SUB_ST[s.st] || s.st}<//>
                </li>`
              )}</ul>`
            : html`<${Empty} title="No submissions yet">Shortlist ${firstName(c.n)} for a requirement under “Requirements that fit”.<//>`)
        }
        ${
          tab === 'hist' &&
          html`<div className="stack" style=${{ gap: 12 }}>
            ${
              (c.owh || []).length || (c.fh || []).length
                ? html`<ul className="bdhist">
                    ${[...(c.owh || []).map(h => ({ t: h.t, by: h.by, ev: 'Owner: ' + (h.from || 'none') + ' → ' + (h.to || 'none') + (h.bk ? ', backup ' + h.bk : '') + (h.note ? ' (' + h.note + ')' : '') })), ...(c.fh || []).map(h => ({ t: h.t, by: h.by, ev: ({ avail: 'Availability', availDate: 'Available from', rate: 'Rate', loc: 'Location', md: 'Work mode', reloc: 'Relocation', auth: 'Work authorization' }[h.f] || h.f) + ': ' + (h.from || 'empty') + ' → ' + (h.to || 'empty') }))]
                      .sort((a, b) => b.t - a.t)
                      .map((h, i) => html`<li key=${i}><span className="muted small nw">${fmtTs(h.t)}</span><span>${h.ev}<span className="muted small"> · ${h.by}</span></span></li>`)}
                  </ul>`
                : html`<p className="muted small">No changes recorded yet. Owner changes and details the consultant updates are listed here.</p>`
            }
          </div>`
        }
      </div>
    <//>`;
}

/* ---------- one submission: approval, the check before sending, stages, next action, history ---------- */
function BdSubModal({ s, boot, cands, onClose, onCand }) {
  const toast = useToast();
  const today = dkey();
  const st = s.st || 'submitted';
  const pre = SUB_PRE.includes(st);
  const done = BD_DONE_ST.includes(st);
  const c = s.cid ? cands.find(x => x.id === s.cid) : null;
  const [act, setAct] = useState(null);
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  const [cf, setCf] = useState(null);
  const [ack, setAck] = useState(false);
  const [ovr, setOvr] = useState('');
  const [edit, setEdit] = useState(false);
  useEffect(() => {
    if (pre)
      api('bd_conflicts', { sid: s.id }).then(
        r => setCf(r),
        () => {}
      );
  }, [s.id, st]);
  const up = k => e => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const open = (a, init) => {
    setAct(a);
    setF(init || {});
  };
  const run = async (route, body, msg) => {
    setBusy(true);
    try {
      const r = await api(route, body);
      Sync.kick();
      toast(typeof msg === 'function' ? msg(r) : msg);
      setAct(null);
      setF({});
      setBusy(false);
      return r;
    } catch (e) {
      if (e && (e.code === 'conflict' || e.code === 'check')) setCf({ conflicts: e.conflicts || [], manager: !!e.manager });
      toast(errText(e), true);
      setBusy(false);
      return null;
    }
  };
  const q = s.rtr2 || null;
  const nm = firstName(s.cn);
  const late = s.next && s.next.due && s.next.due < today;
  const hardN = cf ? cf.conflicts.filter(x => x.kind === 'confirmed').length : 0;
  const softN = cf ? cf.conflicts.filter(x => x.kind === 'possible').length : 0;
  const canSend = !hardN || (cf.manager && ovr.trim().length > 2);
  const send = () => {
    if (!s.rtr && !f.rtrWay) return toast('Say how ' + nm + ' approved it, or that the vendor does not ask for an RTR.', true);
    if (softN && !ack) return toast('Tick “I checked” after looking at the earlier submission.', true);
    return run('bd_stage', { sid: s.id, st: 'submitted', ref: f.ref || '', rtrHave: f.rtrWay === 'have' ? 1 : 0, nortr: f.rtrWay === 'none' ? '1' : '', ack: ack ? '1' : '', override: ovr }, 'Marked as submitted. A follow-up is set for two days from now.');
  };
  const stage = to => {
    if (['rejected', 'withdrawn', 'closed'].includes(to) && !(f.note || '').trim()) return toast('Say why; it is kept with the submission.', true);
    if (to === 'interview' && !f.intv) return toast('Pick the interview date.', true);
    return run('bd_stage', { sid: s.id, st: to, note: f.note || '', intv: f.intv || '', intvAt: f.intvAt || '', intvTz: f.intvTz || 'ET', intvKind: f.intvKind || '', placeCand: to === 'placed' && f.placeCand !== false ? 1 : 0 }, (SUB_ST[to] || to) + ' saved.');
  };
  if (edit) return html`<${SubModal} s=${s} cands=${cands} onClose=${() => setEdit(false)} />`;
  const btn = (label, a, init, cls) => html`<button key=${a + label} className=${'btn sm ' + (cls || 'ghost')} onClick=${() => open(a, init)}>${label}</button>`;
  return html`<${Modal} wide title=${s.cn + ' · ' + (s.req || 'Submission')} onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${() => setEdit(true)}><${Icon} n="pen" />Edit details</button><button className="btn ghost" onClick=${onClose}>Close</button>`}>
      <div className="stack" style=${{ gap: 14 }}>
        <div className="toolbar" style=${{ marginBottom: 0, gap: 8 }}>
          <${Chip} s=${subChip(st)}>${SUB_ST[st] || st}<//>
          ${s.rtr ? html`<${Chip} s="ok">Approved (RTR)<//>` : q && q.st === 'requested' ? html`<${Chip} s="amber">Approval asked<//>` : q && q.st === 'declined' ? html`<${Chip} s="red">Declined by ${nm}<//>` : pre ? html`<${Chip}>No approval yet<//>` : null}
          <span className="muted small">${bdPlural(bdDaysAgo(s.stAt || s.u || s.at) || 0, 'day')} in this stage · owner ${bdOwnerName(boot, s) || '—'}${s.bkn ? ', backup ' + s.bkn : ''}</span>
          ${c && html`<button className="btn link sm push" onClick=${() => onCand(c.id)}>Open ${nm}’s record</button>`}
        </div>
        <dl className="bddl">
          <dt>Goes to</dt><dd>${bdChainOf(s) || html`<span className="muted">Vendor not named</span>`}${s.ec ? '' : html`<span className="muted small"> · end client not known yet</span>`}</dd>
          ${s.ext && html`<dt>Requisition</dt><dd>${s.ext}</dd>`}
          ${s.rate && html`<dt>Rate</dt><dd>${s.rate}</dd>`}
          ${s.lob === 'hc' && html`<dt>Healthcare</dt><dd>${hcLine(s.hc) || '—'}${hcPay(s.hc) ? html`<div className="muted small">${hcPay(s.hc)}</div>` : ''}${s.hc && (s.hc.lic || s.hc.certs || s.hc.emr) ? html`<div className="muted small">${[s.hc.lic ? 'license ' + s.hc.lic + (s.hc.compact ? ' (compact)' : '') + (s.hc.licExp ? ' to ' + s.hc.licExp : '') : '', s.hc.certs, s.hc.emr].filter(Boolean).join(' · ')}</div>` : ''}${hcCred(s.hc) ? html`<div className=${'small ' + (/due/.test(hcCred(s.hc)) ? 'late' : 'muted')}>${hcCred(s.hc)}</div>` : ''}</dd>`}
          <dt>Resume</dt><dd><${SubResumeCell} s=${s} edit=${boot.manager || [bdOwner(s), s.bk, s.by].includes(boot.me)} cand=${c} /></dd>
          ${(s.rn || s.re) && html`<dt>Vendor contact</dt><dd>${[s.rn, s.re, s.rp].filter(Boolean).join(' · ')}</dd>`}
          ${s.d && subSent(s) && html`<dt>Sent</dt><dd>${fmtDate(s.d, { month: 'short', day: 'numeric', year: 'numeric' })}${s.xc ? ' · confirmation ' + s.xc.ref : ''}</dd>`}
          ${s.intv && html`<dt>Interview</dt><dd>${fmtDate(s.intv)}${s.intvAt ? ' at ' + s.intvAt + (s.intvTz ? ' ' + s.intvTz : '') : ''}${s.intvKind ? ' · ' + s.intvKind : ''}</dd>`}
          ${done && s.why && html`<dt>Why</dt><dd>${s.why}</dd>`}
        </dl>
        ${s.flag && html`<div className="note amber"><span>${s.flag}</span></div>`}
        ${
          q &&
          html`<div className=${'note ' + (q.st === 'approved' ? 'ok' : q.st === 'declined' ? 'red' : 'info')}><span>
            ${
              q.st === 'requested'
                ? html`Approval asked ${fmtTs(q.at)} by ${q.by} (${q.scope === 'client' ? 'any role at this end client through this vendor' : 'this requirement only'}, until ${fmtDate(q.until, { month: 'short', day: 'numeric', year: 'numeric' })}${q.rate ? ', at ' + q.rate : ''}). ${q.exp < Date.now() ? 'The link expired: ask again.' : 'The link works until ' + fmtDay(q.exp) + '.'}`
                : q.st === 'approved'
                  ? html`Approved${q.ans ? ' by ' + nm + ' ' + fmtTs(q.ans.at) + ' (typed name “' + q.ans.name + '”, ' + q.ans.via + ')' : ' · ' + (q.via || '')}${q.until ? ', valid until ' + fmtDate(q.until, { month: 'short', day: 'numeric', year: 'numeric' }) : ''}.${q.ans && q.ans.other === 'yes' ? ' They say someone else already submitted them' + (q.ans.otherWho ? ': ' + q.ans.otherWho : '') + '.' : q.ans && q.ans.other === 'no' ? ' Not submitted by anyone else, they say.' : ''}${q.ans && q.ans.note ? ' Note: ' + q.ans.note : ''}`
                  : html`Declined by ${nm}${q.ans ? ' ' + fmtTs(q.ans.at) : ''}.${q.ans && q.ans.note ? ' Note: ' + q.ans.note : ''}`
            }
          </span></div>`
        }
        ${pre && cf && html`<${BdConflictBox} list=${cf.conflicts} manager=${cf.manager} ack=${ack} setAck=${setAck} ovr=${ovr} setOvr=${setOvr} />`}
        ${s.ovr && html`<p className="muted small">Sent despite an earlier submission: ${s.ovr.why} (${s.ovr.by}, ${fmtDay(s.ovr.at)}).</p>`}
        <div className="bdnext">
          <div>
            <span className="lbl">Next action</span>
            ${s.next && s.next.what ? html`<div><b className=${late ? 'bdlate' : ''}>${s.next.what}</b> <span className="muted small">by ${fmtDate(s.next.due, { month: 'short', day: 'numeric' })}${late ? ' (late)' : ''} · ${s.next.ownn || ''}</span></div>` : html`<div className=${done ? 'muted' : 'bdwarn'}>${done ? 'None: this submission is closed.' : 'None set. Every open submission needs one.'}</div>`}
          </div>
          ${!done && html`<button className="btn ghost sm" onClick=${() => open('next', { what: (s.next && s.next.what) || '', due: (s.next && s.next.due) || addDays(today, 1), own: (s.next && s.next.own) || bdOwner(s) })}>${s.next && s.next.what ? 'Change' : 'Set one'}</button>`}
        </div>
        ${
          !act &&
          !done &&
          html`<div className="bdacts">
            ${pre && btn(q && q.st === 'requested' ? 'Ask again for approval' : 'Ask ' + nm + ' to approve', 'rtr', { rate: s.rate || (c && c.rate) || '', scope: 'req', until: addDays(today, boot.set.rtrDays), note: '' }, st === 'shortlisted' ? 'go' : 'ghost')}
            ${pre && !s.rtr && btn('I have the approval in writing', 'have', {})}
            ${pre && btn('Mark as submitted', 'send', { ref: '', rtrWay: '' }, st === 'ready' ? 'go' : 'ghost')}
            ${(BD_NEXT[st] || []).map(to => btn(to === 'interview' && st === 'interview' ? 'Another interview…' : BD_STAGE_VERB[to], 'stage', { to, intvTz: 'ET', intvKind: 'Video', placeCand: true }, to === 'offer' || to === 'placed' || (to === 'interview' && st !== 'interview') ? 'go' : 'ghost'))}
            ${pre && btn('Withdraw…', 'stage', { to: 'withdrawn' })}
            ${btn('Change owner', 'own', { own: bdOwner(s), bk: s.bk || '' })}
          </div>`
        }
        ${
          act === 'rtr' &&
          html`<div className="bdform form">
            <h3 className="bdh3">Ask ${nm} to approve this submission</h3>
            ${!(c && c.e) && !s.ce ? html`<div className="note red"><span>${nm}’s email is not on their record. Add it first (Edit the full record).</span></div>` : html`<p className="muted small">${nm} gets an email to ${(c && c.e) || s.ce} with the role, ${s.ec ? 'the end client, ' : ''}the vendor, the rate, the scope and the end date, and approves with their typed name or declines. The link works for 7 days.</p>`}
            <div className="row3">
              <${Field} label="Rate for this submission"><input value=${f.rate || ''} onInput=${up('rate')} placeholder="e.g. $70/hr C2C" /><//>
              <${Field} label="Scope"><select value=${f.scope} onChange=${up('scope')}><option value="req">This requirement only</option><option value="client">Any role at this end client through this vendor</option></select><//>
              <${Field} label="Valid until"><input type="date" value=${f.until} min=${today} onInput=${up('until')} /><//>
            </div>
            <${Field} label=${'Note to ' + nm + ' (optional)'}><input value=${f.note || ''} onInput=${up('note')} placeholder="Anything they should know before approving" /><//>
            <div className="actions"><button className="btn ghost" onClick=${() => setAct(null)}>Cancel</button><button className="btn" disabled=${busy} onClick=${() => run('bd_rtr_send', { sid: s.id, rate: f.rate, scope: f.scope, until: f.until, note: f.note }, r => (r.mailed === false ? 'Saved, but the email could not be sent (see Email › Sent log).' : 'Emailed ' + nm + ' for approval.'))}>${busy ? 'Sending…' : 'Email the request'}</button></div>
          </div>`
        }
        ${
          act === 'have' &&
          html`<div className="bdform form">
            <h3 className="bdh3">Record the approval you have</h3>
            <p className="muted small">Use this when ${nm} approved in writing outside the portal (an email reply or a signed RTR form). Keep that email or form; the record notes who recorded it and when.</p>
            <div className="actions"><button className="btn ghost" onClick=${() => setAct(null)}>Cancel</button><button className="btn" disabled=${busy} onClick=${() => run('bd_stage', { sid: s.id, st: 'ready', rtrHave: 1 }, 'Approval recorded. Ready to submit.')}>${busy ? 'Saving…' : 'Record it'}</button></div>
          </div>`
        }
        ${
          act === 'send' &&
          html`<div className="bdform form">
            <h3 className="bdh3">Mark as submitted</h3>
            <p className="muted small">After you sent ${nm}’s profile to ${s.vn || 'the vendor'} (by email, their portal or a VMS). What was sent is kept with the record: rate, resume and approval.</p>
            ${
              !s.rtr &&
              html`<div className="stack" style=${{ gap: 6 }}>
                <span className="lbl">${nm} has not approved it in the portal</span>
                <label className="check"><input type="radio" name="rtrway" checked=${f.rtrWay === 'have'} onChange=${() => setF({ ...f, rtrWay: 'have' })} /><span>${nm} approved in writing; I have it</span></label>
                <label className="check"><input type="radio" name="rtrway" checked=${f.rtrWay === 'none'} onChange=${() => setF({ ...f, rtrWay: 'none' })} /><span>The vendor does not ask for an RTR</span></label>
              </div>`
            }
            <${Field} label="Vendor’s confirmation (optional)" hint="Their submission ID, or the subject of their reply."><input value=${f.ref || ''} onInput=${up('ref')} /><//>
            ${hardN > 0 && !cf.manager && html`<div className="note red"><span>This repeats an earlier submission (see above). Ask a bench manager to send it.</span></div>`}
            <div className="actions"><button className="btn ghost" onClick=${() => setAct(null)}>Cancel</button><button className="btn go" disabled=${busy || !canSend} onClick=${send}>${busy ? 'Saving…' : 'Mark as submitted'}</button></div>
          </div>`
        }
        ${
          act === 'stage' &&
          html`<div className="bdform form">
            <h3 className="bdh3">${f.to === 'interview' ? 'Interview' : SUB_ST[f.to]}</h3>
            ${
              f.to === 'interview' &&
              html`<div className="row3">
                <${Field} label="Date"><input type="date" value=${f.intv || ''} onInput=${up('intv')} /><//>
                <${Field} label="Time"><div style=${{ display: 'flex', gap: 6 }}><input type="time" value=${f.intvAt || ''} onInput=${up('intvAt')} /><select value=${f.intvTz} onChange=${up('intvTz')} aria-label="Time zone">${BD_TZ.map(z => html`<option key=${z}>${z}</option>`)}</select></div><//>
                <${Field} label="How"><select value=${f.intvKind} onChange=${up('intvKind')}>${['Video', 'Phone', 'Onsite', 'Technical test'].map(x => html`<option key=${x}>${x}</option>`)}</select><//>
              </div>`
            }
            ${f.to === 'placed' && html`<label className="check"><input type="checkbox" checked=${f.placeCand !== false} onChange=${e => setF({ ...f, placeCand: e.target.checked })} /><span>Take ${nm} off the bench (mark placed)</span></label>`}
            <${Field} label=${['rejected', 'withdrawn', 'closed'].includes(f.to) ? 'Why (required)' : 'Note (optional)'}><input value=${f.note || ''} onInput=${up('note')} placeholder=${f.to === 'rejected' ? 'e.g. the client chose a local candidate' : f.to === 'withdrawn' ? 'e.g. the consultant took another offer' : f.to === 'closed' ? 'e.g. the role was cancelled' : ''} /><//>
            <div className="actions"><button className="btn ghost" onClick=${() => setAct(null)}>Cancel</button><button className="btn" disabled=${busy} onClick=${() => stage(f.to)}>${busy ? 'Saving…' : 'Save'}</button></div>
          </div>`
        }
        ${
          act === 'next' &&
          html`<div className="bdform form">
            <h3 className="bdh3">Next action</h3>
            <div className="row3">
              <${Field} label="What"><input value=${f.what} onInput=${up('what')} placeholder="e.g. Call the vendor for feedback" /><//>
              <${Field} label="By"><input type="date" value=${f.due} onInput=${up('due')} /><//>
              <${Field} label="Who"><select value=${f.own} onChange=${up('own')}>${boot.people.map(p => html`<option key=${p.id} value=${p.id}>${p.n}</option>`)}</select><//>
            </div>
            <div className="actions">${s.next && s.next.what && html`<button className="btn ghost" disabled=${busy} onClick=${() => run('bd_next', { sid: s.id, what: '' }, 'Next action cleared.')}>Clear</button>`}<button className="btn ghost" onClick=${() => setAct(null)}>Cancel</button><button className="btn" disabled=${busy || !(f.what || '').trim()} onClick=${() => run('bd_next', { sid: s.id, what: f.what, due: f.due, own: f.own }, 'Next action saved.')}>Save</button></div>
          </div>`
        }
        ${
          act === 'own' &&
          html`<div className="bdform form">
            <h3 className="bdh3">Who owns this submission</h3>
            <div className="row2">
              <${Field} label="Owner"><select value=${f.own} onChange=${up('own')}><option value="">Choose…</option>${boot.people.map(p => html`<option key=${p.id} value=${p.id}>${p.n}</option>`)}</select><//>
              <${Field} label="Backup"><select value=${f.bk} onChange=${up('bk')}><option value="">None</option>${boot.people.map(p => html`<option key=${p.id} value=${p.id}>${p.n}</option>`)}</select><//>
            </div>
            <div className="actions"><button className="btn ghost" onClick=${() => setAct(null)}>Cancel</button><button className="btn" disabled=${busy || !f.own} onClick=${() => run('bd_own', { kind: 'sub', id: s.id, own: f.own, bk: f.bk }, 'Owner saved.')}>Save</button></div>
          </div>`
        }
        ${
          s.pk &&
          html`<details className="bdpk"><summary>What was sent (${fmtDay(s.pk.at)}, ${s.pk.by})</summary>
            <dl className="bddl">
              ${s.pk.rate && html`<dt>Rate</dt><dd>${s.pk.rate}</dd>`}
              ${s.pk.hc && html`<dt>Healthcare</dt><dd>${hcLine(s.pk.hc)}${hcPay(s.pk.hc) ? ' · ' + hcPay(s.pk.hc) : ''}</dd>`}
              <dt>Resume</dt><dd>${s.pk.resume ? html`<a href=${fileUrl(s.pk.resume.sub ? 'rec/sub/items/' + s.id : s.pk.resume.tailored && s.tl ? s.tl.base : 'rec/cand/items/' + s.cid, s.pk.resume.id, true)}>${s.pk.resume.n || 'Resume'}</a>${s.pk.resume.tailored ? ' (tailored)' : ''}` : html`<span className="muted">Not recorded</span>`}</dd>
              <dt>Approval</dt><dd>${s.pk.rtr ? (s.pk.rtr.name ? 'Typed name “' + s.pk.rtr.name + '”' + (s.pk.rtr.at ? ', ' + fmtTs(s.pk.rtr.at) : '') : 'Recorded') + (s.pk.rtr.scope === 'client' ? ' · any role at this end client' : '') + (s.pk.rtr.until ? ' · until ' + fmtDate(s.pk.rtr.until, { month: 'short', day: 'numeric', year: 'numeric' }) : '') : 'Sent without an RTR'}</dd>
              <dt>To</dt><dd>${[s.pk.vn, s.pk.ec].filter(Boolean).join(' → ')}${s.pk.ext ? ' · requisition ' + s.pk.ext : ''}</dd>
              ${s.pk.hc && s.pk.hc.on && html`<dt>Healthcare details</dt><dd>${[s.pk.hc.facility, s.pk.hc.specialty, s.pk.hc.shift, s.pk.hc.license, s.pk.hc.certs].filter(Boolean).join(' · ')}${s.pk.hc.credentialing ? html`<div className="muted small">${s.pk.hc.credentialing}</div>` : ''}</dd>`}
            </dl>
          </details>`
        }
        ${
          (s.hist || []).length > 0 &&
          html`<div>
            <span className="lbl">History</span>
            <ul className="bdhist">${s.hist
              .slice()
              .reverse()
              .map((h, i) => html`<li key=${i}><span className="muted small nw">${fmtTs(h.t)}</span><span>${h.ev}<span className="muted small"> · ${h.by}</span></span></li>`)}</ul>
          </div>`
        }
      </div>
    <//>`;
}

/* ---------- add a consultant to the pipeline (a requirement on the desk, or one typed in) ---------- */
function BdAddModal({ boot, cands, init, onClose, onAdded }) {
  const toast = useToast();
  const reqs = useCol('vms/req/items', 'u:desc');
  const [mode, setMode] = useState('desk');
  const [f, setF] = useState({ cid: init.cid || '', vreq: init.vreq || '', req: '', vn: '', ec: '', ext: '', rate: '', note: '', hcOn: false, hcFacility: '', hcSpecialty: '', hcLicense: '', hcCerts: '', hcShift: '', hcCredentialing: '' });
  const [busy, setBusy] = useState(false);
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const onBench = cands.filter(c => ['active', 'working', 'hold'].includes(c.st || 'active')).sort((a, b) => String(a.n).localeCompare(String(b.n)));
  const others = cands.filter(c => !['active', 'working', 'hold'].includes(c.st || 'active')).sort((a, b) => String(a.n).localeCompare(String(b.n)));
  const open = reqs.docs.filter(r => ['open', 'working', 'submitted', 'interview'].includes(r.st));
  const go = async () => {
    if (!f.cid) return toast('Pick the consultant.', true);
    if (mode === 'desk' && !f.vreq) return toast('Pick the requirement, or type one in.', true);
    if (mode === 'typed' && (!f.req.trim() || !f.vn.trim())) return toast('Name the role and the vendor or client.', true);
    setBusy(true);
    try {
      const hc = { hcOn: f.hcOn ? 1 : 0, hcFacility: f.hcFacility, hcSpecialty: f.hcSpecialty, hcLicense: f.hcLicense, hcCerts: f.hcCerts, hcShift: f.hcShift, hcCredentialing: f.hcCredentialing };
      const r = await api('bd_shortlist', mode === 'desk' ? { cid: f.cid, vreq: f.vreq, rate: f.rate, note: f.note, ...hc } : { cid: f.cid, req: f.req, vn: f.vn, ec: f.ec, ext: f.ext, rate: f.rate, note: f.note, ...hc });
      Sync.kick();
      toast((r.conflicts || []).some(x => x.kind !== 'info') ? 'Added. Check the earlier submission before sending.' : 'Added to the pipeline as shortlisted.');
      onAdded(r.id);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<${Modal} title="Add to the pipeline" onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Cancel</button><button className="btn" disabled=${busy} onClick=${go}>${busy ? 'Adding…' : 'Shortlist'}</button>`}>
      <div className="form">
        <${Field} label="Consultant">
          <select value=${f.cid} onChange=${up('cid')}>
            <option value="">Choose…</option>
            ${onBench.length > 0 && html`<optgroup label="On the bench">${onBench.map(c => html`<option key=${c.id} value=${c.id}>${c.n}${c.ti ? ', ' + c.ti : ''}</option>`)}</optgroup>`}
            ${others.length > 0 && html`<optgroup label="Everyone else">${others.map(c => html`<option key=${c.id} value=${c.id}>${c.n}${c.ti ? ', ' + c.ti : ''}</option>`)}</optgroup>`}
          </select>
        <//>
        <div className="seg" role="group" aria-label="Requirement">
          ${[
            ['desk', 'A requirement on the desk'],
            ['typed', 'Type it in'],
          ].map(([k, v]) => html`<button key=${k} type="button" className=${mode === k ? 'on' : ''} onClick=${() => setMode(k)}>${v}</button>`)}
        </div>
        ${
          mode === 'desk'
            ? html`<${Field} label="Requirement" hint=${open.length ? '' : 'No open requirement on the desk: type it in instead.'}>
                <select value=${f.vreq} onChange=${up('vreq')}>
                  <option value="">Choose…</option>
                  ${open.map(r => html`<option key=${r.id} value=${r.id}>${r.ti}${r.vn || r.cl ? ' · ' + (r.vn || r.cl) : ''}${r.loc ? ' · ' + r.loc : ''}</option>`)}
                </select>
              <//>`
            : html`<div className="stack" style=${{ gap: 10 }}>
                <div className="row2">
                  <${Field} label="Role"><input value=${f.req} onInput=${up('req')} placeholder="e.g. Java Developer" /><//>
                  <${Field} label="Vendor or client it goes to"><input value=${f.vn} onInput=${up('vn')} /><//>
                </div>
                <div className="row2">
                  <${Field} label="End client" hint="Leave empty if the vendor has not said; the check before sending treats it as unknown."><input value=${f.ec} onInput=${up('ec')} /><//>
                  <${Field} label="Requisition ID (optional)"><input value=${f.ext} onInput=${up('ext')} /><//>
                </div>
              </div>`
        }
        <div className="row2">
          <${Field} label="Rate (optional)" hint="Defaults to the consultant’s rate."><input value=${f.rate} onInput=${up('rate')} /><//>
          <${Field} label="Note (optional)"><input value=${f.note} onInput=${up('note')} /><//>
        </div>
        <details className="panel" open=${f.hcOn} style=${{ background: 'var(--surface-2)' }}>
          <summary><label className="check" style=${{ display: 'inline-flex' }}><input type="checkbox" checked=${!!f.hcOn} onChange=${e => setF({ ...f, hcOn: e.target.checked })} /><span><b>Healthcare staffing details</b></span></label></summary>
          ${f.hcOn && html`<div className="form" style=${{ marginTop: 10 }}>
            <div className="row3"><${Field} label="Facility / health system"><input value=${f.hcFacility} onInput=${up('hcFacility')} /><//><${Field} label="Specialty / unit"><input value=${f.hcSpecialty} onInput=${up('hcSpecialty')} placeholder="ICU, Med-Surg, Epic…" /><//><${Field} label="Shift"><input value=${f.hcShift} onInput=${up('hcShift')} placeholder="Days, nights, 3x12…" /><//></div>
            <div className="row2"><${Field} label="License"><input value=${f.hcLicense} onInput=${up('hcLicense')} placeholder="RN NJ, compact license…" /><//><${Field} label="Certifications"><input value=${f.hcCerts} onInput=${up('hcCerts')} placeholder="BLS, ACLS, PALS…" /><//></div>
            <${Field} label="Credentialing / compliance notes"><textarea rows="3" value=${f.hcCredentialing} onInput=${up('hcCredentialing')} placeholder="Background, drug screen, immunization, onboarding requirements…" /><//>
          </div>`}
        </details>
      </div>
    <//>`;
}
