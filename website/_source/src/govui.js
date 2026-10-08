/* ================= v34: Governance & SOC 2 (Admin > Governance & SOC 2) =================
   SOC 2 readiness (the Trust Services Criteria checklist, most of it checked from the site itself), security policies
   (versions, publishing, who accepted), quarterly access reviews, the risk register, the vendor register, incidents
   with their breach-notification deadlines, and the yearly security course. Server: api/gov.php. */
const GOV_TSC = {
  CC1: 'Control environment',
  CC2: 'Communication and information',
  CC3: 'Risk assessment',
  CC4: 'Monitoring',
  CC5: 'Control activities',
  CC6: 'Logical access',
  CC7: 'System operations',
  CC8: 'Change management',
  CC9: 'Risk mitigation',
  A1: 'Availability',
  C1: 'Confidentiality',
  PI1: 'Processing integrity',
  P1: 'Privacy: notice',
  P2: 'Privacy: choice and consent',
  P5: 'Privacy: access',
};
const govGroup = tsc => (tsc.match(/^[A-Z]+\d?/) || [''])[0];
const GOV_AUD = { staff: 'Staff', consultants: 'Consultants', admins: 'Administrators' };
const govPerson = (people, id) => ((people || []).find(p => p.id === id) || {}).n || '';
const riskTone = n => (n >= 15 ? 'red' : n >= 8 ? 'amber' : 'ok');

function GovernancePage({ q }) {
  const [tab, setTab] = useState((q && q.tab) || 'soc');
  const [ov, setOv] = useState(null);
  const [err, setErr] = useState(null);
  const load = () => api('gov_overview').then(setOv, setErr);
  useEffect(() => {
    load();
  }, []);
  if (err && !ov) return html`<${LoadError} error=${err} onRetry=${load} />`;
  if (!ov) return html`<${Spinner} label="Loading governance…" />`;
  const drafts = ov.policies.filter(p => p.st !== 'published').length;
  const TABS = [
    ['soc', 'SOC 2 readiness'],
    ['policies', 'Policies', drafts || null],
    ['reviews', 'Access reviews', ov.review.open ? '!' : null],
    ['risks', 'Risks', ov.risksHigh || null],
    ['vendors', 'Vendors'],
    ['incidents', 'Incidents', ov.incidentsOpen || null],
    ['training', 'Training'],
  ];
  const props = { people: ov.people, reload: load };
  return html`<div className="stack">
      <${KitTabs} wrap tabs=${TABS} tab=${tab} onTab=${setTab} />
      ${
        tab === 'policies'
          ? html`<${GovPolicies} ...${props} />`
          : tab === 'reviews'
            ? html`<${GovReviews} ...${props} />`
            : tab === 'risks'
              ? html`<${GovRisks} ...${props} />`
              : tab === 'vendors'
                ? html`<${GovVendors} ...${props} />`
                : tab === 'incidents'
                  ? html`<${GovIncidents} ...${props} q=${q} />`
                  : tab === 'training'
                    ? html`<${GovTraining} ...${props} />`
                    : html`<${GovSoc} ov=${ov} go=${setTab} ...${props} />`
      }
    </div>`;
}

/* ---- SOC 2 readiness ---- */
function GovSoc({ ov, go, people, reload }) {
  const toast = useToast();
  const [cfg, setCfg] = useState({ ...ov.cfg });
  const [mark, setMark] = useState(null);
  const [busy, setBusy] = useState(false);
  const sc = ov.score;
  const groups = [...new Set(ov.controls.map(c => govGroup(c.tsc)))];
  const saveCfg = async () => {
    setBusy(true);
    try {
      await api('gov_cfg_save', { cfg });
      toast('Saved.');
      reload();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const saveMark = async () => {
    setBusy(true);
    try {
      await api('gov_soc_set', mark);
      toast('Control updated.');
      setMark(null);
      reload();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const report = () => {
    const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const W = { ok: 'In place', warn: 'Partly in place', fail: 'Not in place' };
    const rows = ov.controls.map(c => `<tr><td>${esc(c.tsc)}</td><td><b>${esc(c.t)}</b><br><small>${esc(c.d)}</small></td><td class="${c.st}">${W[c.st]}</td><td>${esc(c.ev)}${c.note ? '<br><small>' + esc(c.note) + '</small>' : ''}${c.mBy ? '<br><small>Marked by ' + esc(c.mBy) + ', ' + new Date(c.mAt).toLocaleDateString() + '</small>' : ''}</td></tr>`).join('');
    const doc = `<!doctype html><html><head><meta charset="utf-8"><title>SOC 2 readiness</title><style>body{font:14px/1.45 system-ui,sans-serif;margin:32px;color:#101b35}h1{font-size:22px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #c5d0de;padding:6px 8px;vertical-align:top;text-align:left}th{background:#eaf0f5}.ok{color:#03716e;font-weight:600}.warn{color:#7e5200;font-weight:600}.fail{color:#a3321f;font-weight:600}small{color:#46546f}</style></head><body><h1>SOC 2 readiness: ${esc(cfg.company || 'StratEdge')}</h1><p>Prepared ${new Date().toLocaleString()} from the StratEdge portal. Readiness ${sc.pct}% (${sc.ok} in place, ${sc.warn} partly, ${sc.fail} not in place, of ${sc.n} controls). Security officer: ${esc(ov.officerName || 'not named')}.</p><p><small>This is a self-assessment against the AICPA Trust Services Criteria to prepare for an audit. A SOC 2 report can only be issued by an independent CPA firm.</small></p><table><thead><tr><th>Criteria</th><th>Control</th><th>Status</th><th>Evidence</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
    FileSaver.save({ filename: 'soc2-readiness-' + dkey() + '.html', data: new Blob([doc], { type: 'text/html' }) });
  };
  return html`<div className="stack">
      <section className="panel trscore">
        <div className=${'trring ' + (sc.fail ? 'bad' : sc.warn ? 'mid' : 'good')} style=${{ '--p': sc.pct }}><b>${sc.pct}%</b><span>ready</span></div>
        <div className="stack" style=${{ gap: 8, minWidth: 0 }}>
          <h2 className="ph" style=${{ margin: 0 }}>SOC 2 readiness: ${sc.ok} of ${sc.n} controls in place</h2>
          <p className="muted small" style=${{ margin: 0 }}>The AICPA Trust Services Criteria (security, availability, confidentiality, privacy). Most controls are checked from the site itself every time you open this page; the rest you mark with your evidence. A SOC 2 report is issued by an independent CPA firm: a Type I looks at the design on one date, a Type II at how the controls worked over 3 to 12 months. This checklist and its evidence are what the auditor asks for.</p>
          <div className="actions"><button className="btn ghost sm" onClick=${report}>Download the readiness report</button></div>
        </div>
      </section>
      <${KitStats} items=${[
        { v: ov.policies.filter(p => p.st === 'published').length + ' / ' + ov.policies.length, l: 'Policies published', tone: ov.policies.every(p => p.st === 'published') ? 'ok' : 'warn', onClick: () => go('policies') },
        { v: ov.review.open ? 'Open' : ov.review.last ? fmtDay(ov.review.due) : 'Due now', l: ov.review.open ? 'Access review in progress' : 'Next access review', tone: ov.review.last && ov.review.due > Date.now() ? 'ok' : 'warn', onClick: () => go('reviews') },
        { v: ov.risksHigh, l: 'High risks open', tone: ov.risksHigh ? 'warn' : 'ok', onClick: () => go('risks') },
        { v: ov.incidentsOpen, l: 'Open incidents', tone: ov.incidentsOpen ? 'warn' : 'ok', onClick: () => go('incidents') },
        { v: ov.training.done + ' / ' + ov.training.n, l: 'Staff trained this year', tone: ov.training.n && ov.training.done === ov.training.n ? 'ok' : 'warn', onClick: () => go('training') },
      ]} />
      <section className="panel stack form" style=${{ gap: 12 }}>
        <h2 className="ph" style=${{ margin: 0 }}>Who is responsible</h2>
        <div className="row2">
          <${Field} label="Security officer" hint="Owns the program: policies, reviews, incidents. Named in the policies.">
            <select value=${cfg.officer || ''} onChange=${e => setCfg({ ...cfg, officer: e.target.value })}><option value="">Not named yet</option>${people.map(p => html`<option key=${p.id} value=${p.id}>${p.n}</option>`)}</select>
          <//>
          <${Field} label="Company name in the policies"><input value=${cfg.company} onInput=${e => setCfg({ ...cfg, company: e.target.value })} /><//>
        </div>
        <div className="row3">
          <${Field} label="Cyber insurance carrier (optional)"><input value=${cfg.insurer} onInput=${e => setCfg({ ...cfg, insurer: e.target.value })} /><//>
          <${Field} label="Outside counsel for incidents (optional)"><input value=${cfg.counsel} onInput=${e => setCfg({ ...cfg, counsel: e.target.value })} /><//>
          <${Field} label="Client notice in contracts (hours)" hint="Used for incident deadlines."><input type="number" min="1" max="720" value=${cfg.contractHours} onInput=${e => setCfg({ ...cfg, contractHours: +e.target.value })} /><//>
        </div>
        <div><button className="btn sm" disabled=${busy} onClick=${saveCfg}>Save</button></div>
      </section>
      ${groups.map(g => {
        const list = ov.controls.filter(c => govGroup(c.tsc) === g);
        return html`<section key=${g} className="panel stack" style=${{ gap: 4 }}>
            <h2 className="ph" style=${{ margin: 0 }}>${g} · ${GOV_TSC[g] || ''}</h2>
            <ul className="list govctl">${list.map(
              c => html`<li key=${c.id}>
                <div className="t">
                  <span className="trhead">${trChip(c.st)}<b>${c.t}</b><span className="muted small">${c.tsc}</span></span>
                  <span className="muted small">${c.d}</span>
                  <span className="small trwrap">${c.ev}${c.note ? html`<br /><i>${c.note}</i>` : ''}${c.mBy ? html`<br /><span className="muted">Marked by ${c.mBy}, ${fmtDay(c.mAt)}</span>` : ''}</span>
                </div>
                <div className="actions">${!c.auto ? html`<button className="btn ghost sm" onClick=${() => setMark({ id: c.id, st: c.st, ev: c.mBy ? c.ev : '', note: c.note, t: c.t, d: c.d })}>Mark</button>` : html`<span className="muted small">Automatic</span>`}</div>
              </li>`
            )}</ul>
          </section>`;
      })}
      ${
        mark &&
        html`<${Modal} title=${mark.t} onClose=${() => setMark(null)} foot=${html`<button className="btn ghost" onClick=${() => setMark(null)}>Cancel</button><button className="btn" disabled=${busy} onClick=${saveMark}>Save</button>`}>
          <div className="form">
            <p className="muted small" style=${{ margin: 0 }}>${mark.d}</p>
            <${Field} label="Status"><div className="seg">${[
              ['ok', 'In place'],
              ['warn', 'Partly'],
              ['fail', 'Not yet'],
            ].map(([k, n]) => html`<button key=${k} type="button" className=${mark.st === k ? 'on' : ''} onClick=${() => setMark({ ...mark, st: k })}>${n}</button>`)}</div><//>
            <${Field} label="Evidence" hint="What an auditor can look at: a document name, a date, where it is kept."><textarea rows="3" value=${mark.ev} onInput=${e => setMark({ ...mark, ev: e.target.value })} /><//>
            <${Field} label="Note (optional)"><textarea rows="2" value=${mark.note} onInput=${e => setMark({ ...mark, note: e.target.value })} /><//>
          </div>
        <//>`
      }
    </div>`;
}

/* ---- Policies ---- */
function GovPolicies({ reload }) {
  const toast = useToast();
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api('gov_pol_list').then(r => setList(r.policies), e => toast(errText(e), true));
  useEffect(() => {
    load();
  }, []);
  const publishAll = async () => {
    if (!window.confirm('Publish every draft policy as written? Staff are then asked to read and accept them in their portal.')) return;
    setBusy(true);
    try {
      const r = await api('gov_pol_publish_all', {});
      toast(r.n + ' policies published.');
      load();
      reload();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  if (!list) return html`<${Spinner} />`;
  const drafts = list.filter(p => p.st !== 'published').length;
  return html`<div className="stack">
      <section className="panel stack" style=${{ gap: 10 }}>
        <div className="ph-row" style=${{ margin: 0 }}>
          <h2 className="ph">Security policies</h2>
          <div className="actions">
            ${drafts > 0 && html`<button className="btn sm" disabled=${busy} onClick=${publishAll}>Publish the ${drafts} drafts</button>`}
            <button className="btn ghost sm" onClick=${() => setOpen({ id: '', isNew: true })}>New policy</button>
          </div>
        </div>
        <p className="muted small" style=${{ margin: 0 }}>Written for a staffing firm and filled in with this site’s settings (officer, contact, password and session rules, retention). Read each one, adjust it to how you work, and publish: everyone it applies to is asked to read and accept the current version in their portal, and the acceptances are your evidence. Review each policy at least once a year.</p>
        <div className="tblwrap"><table className="tbl">
          <thead><tr><th>Policy</th><th>For</th><th>Status</th><th className="r">Accepted</th></tr></thead>
          <tbody>${list.map(
            p => html`<tr key=${p.id} className="clickable" onClick=${() => setOpen(p)}>
              <td><b>${p.t}</b><div className="muted small">${p.sum}</div></td>
              <td className="small">${p.aud.map(a => GOV_AUD[a] || a).join(', ')}</td>
              <td>${p.st === 'published' ? html`<${Chip} s=${p.reviewed > Date.now() - 365 * 86400000 ? 'ok' : 'amber'}>Version ${p.ver}<//><div className="muted small">reviewed ${fmtDay(p.reviewed)}</div>` : html`<${Chip} s="amber">Draft<//>`}</td>
              <td className="r">${p.st === 'published' ? html`<b>${p.acks}</b> / ${p.people}` : '—'}</td>
            </tr>`
          )}</tbody>
        </table></div>
      </section>
      ${
        open &&
        html`<${GovPolicyModal} p=${open} onClose=${() => setOpen(null)} onChanged=${() => {
          load();
          reload();
        }} />`
      }
    </div>`;
}
function GovPolicyModal({ p, onClose, onChanged }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [view, setView] = useState(p.isNew ? 'edit' : 'read');
  const [f, setF] = useState(p.isNew ? { id: '', t: '', sum: '', aud: ['staff'], body: '' } : null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const load = () =>
    api('gov_pol_get', { id: p.id }).then(
      r => {
        setD(r);
        setF({ id: r.id, t: r.t, sum: r.sum, aud: r.aud, body: r.draft != null ? r.draft : r.body });
      },
      e => toast(errText(e), true)
    );
  useEffect(() => {
    if (!p.isNew) load();
  }, [p.id]);
  const act = async (k, route, body, msg, close) => {
    setBusy(k);
    try {
      const r = await api(route, body);
      toast(typeof msg === 'function' ? msg(r) : msg);
      onChanged();
      if (close) onClose();
      else await load();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const save = () => act('save', 'gov_pol_save', f, p.isNew ? 'Policy created as a draft.' : d && d.st === 'published' ? 'Changes saved as a draft: publish them as a new version when ready.' : 'Saved.', !!p.isNew);
  if (!p.isNew && (!d || !f)) return html`<${Modal} title=${p.t} onClose=${onClose}><${Spinner} /><//>`;
  const pub = d && d.st === 'published';
  const hasDraft = d && d.draft != null;
  const togAud = a => setF({ ...f, aud: f.aud.includes(a) ? f.aud.filter(x => x !== a) : [...f.aud, a] });
  const foot = html`<button className="btn ghost" onClick=${onClose}>Close</button>
    ${view === 'edit' && html`<button className="btn" disabled=${!!busy} onClick=${save}>${busy === 'save' ? 'Saving…' : p.isNew ? 'Create draft' : 'Save'}</button>`}
    ${view !== 'edit' && d && html`<button className="btn" disabled=${!!busy} onClick=${() => act('pub', 'gov_pol_publish', { id: d.id, note }, r => 'Published as version ' + r.ver + '. Everyone it applies to is asked to accept it.')}>${pub ? (hasDraft ? 'Publish the changes as version ' + (d.ver + 1) : 'Publish as version ' + (d.ver + 1)) : 'Publish'}</button>`}`;
  return html`<${Modal} wide=${true} title=${p.isNew ? 'New policy' : d.t} onClose=${onClose} foot=${foot}>
      ${
        !p.isNew &&
        html`<${KitTabs} tabs=${[
          ['read', 'Read'],
          ['edit', 'Edit'],
          ['acks', 'Who accepted', pub ? d.acks.filter(a => a.cur).length + '/' + d.acks.length : null],
          ['hist', 'History'],
        ]} tab=${view} onTab=${setView} />`
      }
      ${
        view === 'read'
          ? html`<div className="stack" style=${{ gap: 10 }}>
              <p className="muted small" style=${{ margin: 0 }}>${pub ? 'Version ' + d.ver + ', for ' + d.aud.map(a => GOV_AUD[a]).join(', ') + '.' : 'Draft: not visible to staff yet.'}${hasDraft ? ' There are unpublished changes (see Edit).' : ''}</p>
              <div className="govdoc"><${MdLite} text=${d.filled} /></div>
              <${Field} label="Note for the history (optional)"><input value=${note} onInput=${e => setNote(e.target.value)} placeholder="e.g. Approved by the managing director" /><//>
              <div className="actions">
                ${pub && !hasDraft && html`<button className="btn ghost sm" disabled=${!!busy} onClick=${() => act('rev', 'gov_pol_publish', { id: d.id, review: true, note }, 'Marked as reviewed with no changes.')}>Reviewed, no changes</button>`}
                ${pub && html`<button className="btn ghost sm" disabled=${!!busy} onClick=${() => act('remind', 'gov_pol_remind', { id: d.id }, r => (r.n ? 'Reminder emailed to ' + r.n + ' people.' : 'Everyone has accepted it.'))}>Remind those who have not accepted</button>`}
              </div>
            </div>`
          : view === 'edit'
            ? html`<div className="form">
                ${p.isNew && html`<${Field} label="Short id" hint="Letters, numbers and dashes, e.g. remote-work."><input value=${f.id} onInput=${e => setF({ ...f, id: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })} /><//>`}
                <div className="row2">
                  <${Field} label="Title"><input value=${f.t} onInput=${e => setF({ ...f, t: e.target.value })} /><//>
                  <${Field} label="Applies to"><div className="checks">${Object.entries(GOV_AUD).map(([k, n]) => html`<label key=${k} className="check"><input type="checkbox" checked=${f.aud.includes(k)} onChange=${() => togAud(k)} /><span>${n}</span></label>`)}</div><//>
                </div>
                <${Field} label="One-line summary"><input value=${f.sum} onInput=${e => setF({ ...f, sum: e.target.value })} /><//>
                <${Field} label="Text" hint="## for headings, - for lists. {company}, {officer}, {secEmail}, {site}, {idleStaff}, {pwMin}, {pwMinSolo}, {retention} and {backupKeep} are filled in from the settings."><textarea rows="18" className="govtext" value=${f.body} onInput=${e => setF({ ...f, body: e.target.value })} /><//>
                ${!p.isNew && html`<div className="actions"><button type="button" className="btn ghost sm" disabled=${!!busy} onClick=${() => window.confirm('Replace the text with the built-in version?') && act('reset', 'gov_pol_reset', { id: d.id }, 'The built-in text is back (as a draft change).')}>Use the built-in text</button><button type="button" className="btn ghost sm danger" disabled=${!!busy} onClick=${() => window.confirm('Delete this policy? Acceptances stay in the audit log.') && act('del', 'gov_pol_delete', { id: d.id }, 'Policy deleted.', true)}>Delete the policy</button></div>`}
              </div>`
            : view === 'acks'
              ? pub
                ? html`<div className="tblwrap"><table className="tbl small"><thead><tr><th>Person</th><th>Accepted</th></tr></thead><tbody>${d.acks.map(a => html`<tr key=${a.uid}><td><b>${a.n}</b> <span className="muted">${a.e}</span></td><td>${a.cur ? html`<${Chip} s="ok">Version ${a.ver}, ${fmtDay(a.at)}<//>` : a.ver ? html`<${Chip} s="amber">Older version ${a.ver}<//>` : html`<${Chip} s="red">Not yet<//>`}</td></tr>`)}</tbody></table></div>`
                : html`<p className="muted">Publish the policy first.</p>`
              : html`<ul className="list seclist">${(d.hist || []).slice().reverse().map((h, i) => html`<li key=${i}><div className="t"><span>Version ${h.ver}: ${h.note}</span><span className="muted small">${fmtTs(h.at)} · ${h.by}</span></div></li>`)}${!(d.hist || []).length && html`<li><span className="muted">Not published yet.</span></li>`}</ul>`
      }
    <//>`;
}

/* ---- Access reviews ---- */
function GovReviews({ reload }) {
  const toast = useToast();
  const [list, setList] = useState(null);
  const [cur, setCur] = useState(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState(null);
  const load = async () => {
    try {
      const r = await api('gov_rev_list');
      setList(r.reviews);
      const open = r.reviews.find(x => x.st === 'open');
      setCur(open ? await api('gov_rev_get', { id: open.id }) : null);
    } catch (e) {
      toast(errText(e), true);
    }
  };
  useEffect(() => {
    load();
  }, []);
  const start = async () => {
    setBusy(true);
    try {
      const r = await api('gov_rev_start', {});
      setCur(await api('gov_rev_get', { id: r.id }));
      reload();
      load();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const decide = async (it, d) => {
    try {
      await api('gov_rev_decide', { id: cur.id, uid: it.uid, d, note: it.note || '' });
      setCur({ ...cur, items: cur.items.map(x => (x.uid === it.uid ? { ...x, d } : x)) });
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const done = async () => {
    const rm = cur.items.filter(x => x.d === 'remove').length;
    if (!window.confirm('Complete the review?' + (rm ? ' The ' + rm + ' accounts marked Remove are paused and signed out now.' : ''))) return;
    setBusy(true);
    try {
      const r = await api('gov_rev_done', { id: cur.id });
      toast('Review completed: ' + r.summary.kept + ' kept, ' + r.summary.changed + ' to change, ' + r.summary.removed + ' removed.');
      reload();
      load();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  if (!list) return html`<${Spinner} />`;
  const PORT = k => (PORTAL_INFO[k] || {}).n || k;
  return html`<div className="stack">
      ${
        cur
          ? html`<section className="panel stack" style=${{ gap: 10 }}>
              <div className="ph-row" style=${{ margin: 0 }}>
                <h2 className="ph">Access review ${cur.id}</h2>
                <div className="actions"><span className="muted small">${cur.items.filter(x => x.d).length} of ${cur.items.length} decided · due ${fmtDay(cur.due)}</span><button className="btn sm" disabled=${busy || cur.items.some(x => !x.d)} onClick=${done}>Complete the review</button></div>
              </div>
              <p className="muted small" style=${{ margin: 0 }}>For every active account: does this person still need this access? <b>Keep</b> it, <b>Change</b> it (then adjust it under Roles & access), or <b>Remove</b> it (the account is paused when you complete the review). Staff accounts are listed first.</p>
              <div className="tblwrap"><table className="tbl small">
                <thead><tr><th>Person</th><th>Access</th><th>Last sign-in</th><th>Decision</th></tr></thead>
                <tbody>${cur.items.map(
                  it => html`<tr key=${it.uid}>
                    <td><b>${it.n}</b><div className="muted">${it.e}</div></td>
                    <td>${it.roles.filter(r => r !== 'user').map(r => html`<${Chip} key=${r} s=${['admin', 'hr', 'acct'].includes(r) ? 'amber' : ''}>${r}<//> `)}<div className="muted">${it.portals.map(PORT).join(', ')}</div>${it.priv && !it.mfa ? html`<div style=${{ color: 'var(--red-ink)' }}>No two-step sign-in</div>` : ''}</td>
                    <td className="nowrap">${it.last ? fmtDay(it.last) : html`<span className="muted">Never</span>`}${it.last && it.last < Date.now() - 90 * 86400000 ? html`<div style=${{ color: 'var(--amber-ink)' }}>90+ days ago</div>` : ''}</td>
                    <td><div className="seg" style=${{ margin: 0 }}>${[
                      ['keep', 'Keep'],
                      ['change', 'Change'],
                      ['remove', 'Remove'],
                    ].map(([k, n]) => html`<button key=${k} type="button" className=${it.d === k ? 'on' : ''} onClick=${() => decide(it, k)}>${n}</button>`)}</div></td>
                  </tr>`
                )}</tbody>
              </table></div>
            </section>`
          : html`<section className="panel stack" style=${{ gap: 10 }}>
              <h2 className="ph" style=${{ margin: 0 }}>Quarterly access review</h2>
              <p className="muted small" style=${{ margin: 0 }}>Every three months, check that each account still needs its access: people who left, changed jobs or no longer use the portal. SOC 2 (CC6.2, CC6.3) expects the review and its decisions on record.</p>
              <div><button className="btn" disabled=${busy} onClick=${start}>Start the access review</button></div>
            </section>`
      }
      ${
        list.filter(x => x.st === 'done').length > 0 &&
        html`<section className="panel stack" style=${{ gap: 8 }}>
          <h2 className="ph" style=${{ margin: 0 }}>Completed reviews</h2>
          <ul className="list seclist">${list.filter(x => x.st === 'done').map(r => html`<li key=${r.id}><div className="t"><span>${r.id}</span><span className="muted small">Completed ${fmtDay(r.doneAt)} · ${r.n} accounts · ${r.removed} removed</span></div><div className="actions"><button className="btn ghost sm" onClick=${() => api('gov_rev_get', { id: r.id }).then(setView)}>Open</button></div></li>`)}</ul>
        </section>`
      }
      ${
        view &&
        html`<${Modal} wide=${true} title=${'Access review ' + view.id} onClose=${() => setView(null)}>
          <p className="muted small">Started ${fmtDay(view.at)} by ${view.by}; completed ${fmtDay(view.doneAt)} by ${view.doneBy}.</p>
          <div className="tblwrap"><table className="tbl small"><thead><tr><th>Person</th><th>Roles</th><th>Decision</th><th>By</th></tr></thead><tbody>${view.items.map(it => html`<tr key=${it.uid}><td>${it.n}</td><td>${it.roles.join(', ')}</td><td>${it.d}</td><td className="muted">${it.by || ''}</td></tr>`)}</tbody></table></div>
        <//>`
      }
    </div>`;
}

/* ---- Risks ---- */
const RISK_CATS = ['People', 'Fraud', 'Data', 'Devices', 'Availability', 'Vendors', 'Application', 'Compliance', 'Operations', 'General'];
function GovRisks({ people, reload }) {
  const toast = useToast();
  const [list, setList] = useState(null);
  const [ed, setEd] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api('gov_risks').then(r => setList(r.risks), e => toast(errText(e), true));
  useEffect(() => {
    load();
  }, []);
  const save = async () => {
    setBusy(true);
    try {
      await api('gov_risk_save', ed);
      toast('Saved.');
      setEd(null);
      load();
      reload();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  if (!list) return html`<${Spinner} />`;
  const reviewed = Math.max(0, ...list.map(r => r.reviewed || 0));
  const cell = (l, i) => list.filter(r => r.st !== 'closed' && +r.l === l && +r.i === i).length;
  return html`<div className="stack">
      <section className="panel stack" style=${{ gap: 10 }}>
        <div className="ph-row" style=${{ margin: 0 }}>
          <h2 className="ph">Risk register</h2>
          <div className="actions">
            <button className="btn ghost sm" onClick=${() => api('gov_risks_reviewed', {}).then(() => { toast('Risk assessment marked as reviewed today.'); load(); reload(); }, e => toast(errText(e), true))}>Mark the assessment reviewed</button>
            <button className="btn sm" onClick=${() => setEd({ id: '', t: '', cat: 'General', desc: '', l: 3, i: 3, owner: '', treat: 'mitigate', plan: '', st: 'open' })}>Add a risk</button>
          </div>
        </div>
        <p className="muted small" style=${{ margin: 0 }}>Likelihood × impact (1 to 5 each). Every high risk (15 and above) needs an owner and a plan. Review the whole register at least once a year${reviewed ? '; last reviewed ' + fmtDay(reviewed) : ''}.</p>
        <div className="govheat" role="img" aria-label="Risks by likelihood and impact">
          ${[5, 4, 3, 2, 1].map(l => html`<${Fragment} key=${l}><span className="ax">${l}</span>${[1, 2, 3, 4, 5].map(i => html`<span key=${i} className=${'c ' + riskTone(l * i)}>${cell(l, i) || ''}</span>`)}<//>`)}
          <span></span>${[1, 2, 3, 4, 5].map(i => html`<span key=${i} className="ax">${i}</span>`)}
        </div>
        <p className="muted small" style=${{ margin: 0 }}>Rows: likelihood. Columns: impact.</p>
        <div className="tblwrap"><table className="tbl small">
          <thead><tr><th className="r">Score</th><th>Risk</th><th>Owner</th><th>Treatment</th><th>Status</th></tr></thead>
          <tbody>${list.map(
            r => html`<tr key=${r.id} className="clickable" onClick=${() => setEd({ ...r })}>
              <td className="r"><${Chip} s=${riskTone(r.l * r.i)}>${r.l * r.i}<//></td>
              <td><b>${r.t}</b><div className="muted">${r.cat}</div></td>
              <td>${govPerson(people, r.owner) || html`<span className="muted">—</span>`}</td>
              <td>${r.treat}</td>
              <td>${r.st}</td>
            </tr>`
          )}</tbody>
        </table></div>
      </section>
      ${
        ed &&
        html`<${Modal} title=${ed.id ? 'Risk' : 'New risk'} onClose=${() => setEd(null)} foot=${html`${ed.id && html`<button className="btn ghost danger" onClick=${() => window.confirm('Delete this risk?') && api('gov_risk_delete', { id: ed.id }).then(() => { setEd(null); load(); reload(); })}>Delete</button>`}<button className="btn ghost" onClick=${() => setEd(null)}>Cancel</button><button className="btn" disabled=${busy} onClick=${save}>Save</button>`}>
          <div className="form">
            <${Field} label="Risk"><input value=${ed.t} onInput=${e => setEd({ ...ed, t: e.target.value })} placeholder="What could go wrong" /><//>
            <div className="row2">
              <${Field} label="Category"><select value=${ed.cat} onChange=${e => setEd({ ...ed, cat: e.target.value })}>${RISK_CATS.map(c => html`<option key=${c}>${c}</option>`)}</select><//>
              <${Field} label="Owner"><select value=${ed.owner} onChange=${e => setEd({ ...ed, owner: e.target.value })}><option value="">—</option>${people.map(p => html`<option key=${p.id} value=${p.id}>${p.n}</option>`)}</select><//>
            </div>
            <div className="row2">
              <${Field} label=${'Likelihood: ' + ed.l}><input type="range" min="1" max="5" value=${ed.l} onInput=${e => setEd({ ...ed, l: +e.target.value })} /><//>
              <${Field} label=${'Impact: ' + ed.i}><input type="range" min="1" max="5" value=${ed.i} onInput=${e => setEd({ ...ed, i: +e.target.value })} /><//>
            </div>
            <p className="small" style=${{ margin: 0 }}>Score <${Chip} s=${riskTone(ed.l * ed.i)}>${ed.l * ed.i}<//></p>
            <${Field} label="Description (optional)"><textarea rows="2" value=${ed.desc} onInput=${e => setEd({ ...ed, desc: e.target.value })} /><//>
            <div className="row2">
              <${Field} label="Treatment"><select value=${ed.treat} onChange=${e => setEd({ ...ed, treat: e.target.value })}><option value="mitigate">Mitigate (reduce it)</option><option value="accept">Accept it</option><option value="transfer">Transfer it (insurance, contract)</option><option value="avoid">Avoid it (stop the activity)</option></select><//>
              <${Field} label="Status"><select value=${ed.st} onChange=${e => setEd({ ...ed, st: e.target.value })}><option value="open">Open</option><option value="treated">Treated</option><option value="accepted">Accepted</option><option value="closed">Closed</option></select><//>
            </div>
            <${Field} label="Plan and controls"><textarea rows="3" value=${ed.plan} onInput=${e => setEd({ ...ed, plan: e.target.value })} /><//>
          </div>
        <//>`
      }
    </div>`;
}

/* ---- Vendors ---- */
const VEND_TIER = { critical: 'red', high: 'amber', medium: '', low: 'ok' };
function GovVendors({ people, reload }) {
  const toast = useToast();
  const [list, setList] = useState(null);
  const [ed, setEd] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () =>
    api('gov_vendors').then(
      r => {
        setList(r.vendors);
        if (r.added) toast(r.added + ' services this site uses were added to the register.');
      },
      e => toast(errText(e), true)
    );
  useEffect(() => {
    load();
  }, []);
  const save = async extra => {
    setBusy(true);
    try {
      await api('gov_vendor_save', { ...ed, ...(extra || {}) });
      toast('Saved.');
      setEd(null);
      load();
      reload();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  if (!list) return html`<${Spinner} />`;
  const year = Date.now() - 365 * 86400000;
  return html`<div className="stack">
      <section className="panel stack" style=${{ gap: 10 }}>
        <div className="ph-row" style=${{ margin: 0 }}><h2 className="ph">Vendor register</h2><button className="btn sm" onClick=${() => setEd({ id: '', n: '', svc: '', data: '', tier: 'medium', soc: '', dpa: false, owner: '', notes: '' })}>Add a vendor</button></div>
        <p className="muted small" style=${{ margin: 0 }}>Every outside service that holds or sees your data. The services this site is set up to use are added on their own. Once a year, review the critical and high ones: their latest SOC 2 or ISO 27001 report, a data processing agreement, and whether you still need them.</p>
        <div className="tblwrap"><table className="tbl small">
          <thead><tr><th>Vendor</th><th>What it sees</th><th>Tier</th><th>Assurance</th><th>Reviewed</th></tr></thead>
          <tbody>${list.map(
            v => html`<tr key=${v.id} className="clickable" onClick=${() => setEd({ ...v })}>
              <td><b>${v.n}</b><div className="muted">${v.svc}</div></td>
              <td className="trwrap">${v.data}</td>
              <td><${Chip} s=${VEND_TIER[v.tier]}>${v.tier}<//></td>
              <td>${v.soc || html`<span className="muted">—</span>`}${v.dpa ? html`<div className="muted">DPA signed</div>` : ''}</td>
              <td className="nowrap">${v.reviewed ? fmtDay(v.reviewed) : html`<span className=${['critical', 'high'].includes(v.tier) ? '' : 'muted'} style=${{ color: ['critical', 'high'].includes(v.tier) ? 'var(--amber-ink)' : '' }}>Never</span>`}${v.reviewed && v.reviewed < year && ['critical', 'high'].includes(v.tier) ? html`<div style=${{ color: 'var(--amber-ink)' }}>Due</div>` : ''}</td>
            </tr>`
          )}</tbody>
        </table></div>
      </section>
      ${
        ed &&
        html`<${Modal} title=${ed.id ? ed.n : 'New vendor'} onClose=${() => setEd(null)} foot=${html`${ed.id && html`<button className="btn ghost danger" onClick=${() => window.confirm('Remove this vendor from the register?') && api('gov_vendor_delete', { id: ed.id }).then(() => { setEd(null); load(); })}>Delete</button>`}<button className="btn ghost" onClick=${() => setEd(null)}>Cancel</button>${ed.id && html`<button className="btn ghost" disabled=${busy} onClick=${() => save({ reviewedNow: true })}>Save as reviewed today</button>`}<button className="btn" disabled=${busy} onClick=${() => save()}>Save</button>`}>
          <div className="form">
            <div className="row2">
              <${Field} label="Vendor"><input value=${ed.n} onInput=${e => setEd({ ...ed, n: e.target.value })} /><//>
              <${Field} label="Risk tier"><select value=${ed.tier} onChange=${e => setEd({ ...ed, tier: e.target.value })}><option value="critical">Critical: holds everything, or money moves</option><option value="high">High: personal or financial data</option><option value="medium">Medium: limited personal data</option><option value="low">Low: no sensitive data</option></select><//>
            </div>
            <${Field} label="What it does for you"><input value=${ed.svc} onInput=${e => setEd({ ...ed, svc: e.target.value })} /><//>
            <${Field} label="Data it holds or sees"><input value=${ed.data} onInput=${e => setEd({ ...ed, data: e.target.value })} /><//>
            <div className="row2">
              <${Field} label="Assurance" hint="e.g. SOC 2 Type II (Mar 2026), ISO 27001"><input value=${ed.soc} onInput=${e => setEd({ ...ed, soc: e.target.value })} /><//>
              <${Field} label="Owner"><select value=${ed.owner} onChange=${e => setEd({ ...ed, owner: e.target.value })}><option value="">—</option>${people.map(p => html`<option key=${p.id} value=${p.id}>${p.n}</option>`)}</select><//>
            </div>
            <label className="check"><input type="checkbox" checked=${!!ed.dpa} onChange=${e => setEd({ ...ed, dpa: e.target.checked })} /><span>A data processing agreement (DPA) is signed</span></label>
            <${Field} label="Notes"><textarea rows="3" value=${ed.notes} onInput=${e => setEd({ ...ed, notes: e.target.value })} /><//>
            ${ed.reviewed > 0 && html`<p className="muted small" style=${{ margin: 0 }}>Last reviewed ${fmtDay(ed.reviewed)}.</p>`}
          </div>
        <//>`
      }
    </div>`;
}

/* ---- Incidents ---- */
const INC_ST = [
  ['new', 'New'],
  ['investigating', 'Investigating'],
  ['contained', 'Contained'],
  ['resolved', 'Resolved'],
  ['closed', 'Closed'],
];
const INC_TYPES = [
  ['ssn', 'SSN / tax ID'],
  ['bank', 'Bank accounts'],
  ['ids', 'ID documents'],
  ['immigration', 'Immigration papers'],
  ['resumes', 'Resumes'],
  ['contact', 'Contact details'],
  ['credentials', 'Passwords / keys'],
  ['health', 'Health'],
  ['pay', 'Pay records'],
  ['other', 'Other'],
];
const INC_SEV = { critical: 'red', high: 'red', medium: 'amber', low: '' };
function GovIncidents({ people, reload, q }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [open, setOpen] = useState(null);
  const [nw, setNw] = useState(null);
  const load = () => api('gov_incidents').then(setD, e => toast(errText(e), true));
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (d && q && q.inc && !open) setOpen(d.incidents.find(x => x.id === q.inc) || null);
  }, [d]);
  const create = async () => {
    try {
      const r = await api('gov_inc_save', nw);
      setNw(null);
      await load();
      reload();
      const fresh = await api('gov_incidents');
      setD(fresh);
      setOpen(fresh.incidents.find(x => x.id === r.id) || null);
    } catch (e) {
      toast(errText(e), true);
    }
  };
  if (!d) return html`<${Spinner} />`;
  const nextDue = i => (i.notices || []).filter(n => n.due && !n.done).sort((a, b) => a.due - b.due)[0];
  return html`<div className="stack">
      <section className="panel stack" style=${{ gap: 10 }}>
        <div className="ph-row" style=${{ margin: 0 }}><h2 className="ph">Incidents</h2><button className="btn sm" onClick=${() => setNw({ t: '', kind: 'other', desc: '' })}>Record an incident</button></div>
        <p className="muted small" style=${{ margin: 0 }}>Concerns reported by staff, vulnerability reports from the security page and anything you record yourself. When personal data is involved, the deadlines to notify regulators, clients and the people affected are worked out for you. Not legal advice: involve counsel for a real breach.</p>
        ${
          d.incidents.length
            ? html`<div className="tblwrap"><table className="tbl small">
                <thead><tr><th>Incident</th><th>Severity</th><th>Status</th><th>Found</th><th>Next deadline</th></tr></thead>
                <tbody>${d.incidents.map(i => {
                  const nd = nextDue(i);
                  return html`<tr key=${i.id} className="clickable" onClick=${() => setOpen(i)}>
                    <td><b>${i.t}</b><div className="muted">${i.id} · ${i.kind}${i.reporter ? ' · ' + i.reporter : ''}</div></td>
                    <td><${Chip} s=${INC_SEV[i.sev]}>${i.sev}<//></td>
                    <td>${(INC_ST.find(x => x[0] === i.st) || [, i.st])[1]}${i.breach ? html` <${Chip} s="red">Breach<//>` : ''}</td>
                    <td className="nowrap">${fmtDay(i.found)}</td>
                    <td className="nowrap">${nd ? html`<span style=${{ color: nd.due < Date.now() ? 'var(--red-ink)' : nd.due < Date.now() + 2 * 86400000 ? 'var(--amber-ink)' : '' }}>${fmtTs(nd.due)}</span><div className="muted">${nd.to}</div>` : html`<span className="muted">—</span>`}</td>
                  </tr>`;
                })}</tbody>
              </table></div>`
            : html`<p className="muted small" style=${{ margin: 0 }}>No incidents recorded.</p>`
        }
      </section>
      ${
        nw &&
        html`<${Modal} title="Record an incident" onClose=${() => setNw(null)} foot=${html`<button className="btn ghost" onClick=${() => setNw(null)}>Cancel</button><button className="btn" disabled=${nw.t.trim().length < 3} onClick=${create}>Record</button>`}>
          <div className="form">
            <${Field} label="What happened (short)"><input value=${nw.t} onInput=${e => setNw({ ...nw, t: e.target.value })} /><//>
            <${Field} label="Kind"><select value=${nw.kind} onChange=${e => setNw({ ...nw, kind: e.target.value })}><option value="phishing">Phishing</option><option value="account">Account compromise</option><option value="device">Lost or stolen device</option><option value="data">Data sent or exposed</option><option value="vuln">Vulnerability</option><option value="malware">Malware / ransomware</option><option value="other">Other</option></select><//>
            <${Field} label="Details"><textarea rows="4" value=${nw.desc} onInput=${e => setNw({ ...nw, desc: e.target.value })} /><//>
          </div>
        <//>`
      }
      ${
        open &&
        html`<${GovIncidentModal} inc=${open} states=${d.states} people=${people} onClose=${() => setOpen(null)} onSaved=${async id => {
          const fresh = await api('gov_incidents');
          setD(fresh);
          setOpen(fresh.incidents.find(x => x.id === id) || null);
          reload();
        }} />`
      }
    </div>`;
}
function GovIncidentModal({ inc, states, people, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ st: inc.st, sev: inc.sev, owner: inc.owner || '', pd: !!inc.pd, breach: !!inc.breach, types: inc.types || [], where: inc.where || [], count: inc.count || 0, lessons: inc.lessons || '', t: inc.t, desc: inc.desc || '' });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [add, setAdd] = useState('');
  const save = async extra => {
    setBusy(true);
    try {
      await api('gov_inc_save', { id: inc.id, ...f, note, ...(extra || {}) });
      setNote('');
      toast('Saved.');
      await onSaved(inc.id);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const togType = k => setF({ ...f, types: f.types.includes(k) ? f.types.filter(x => x !== k) : [...f.types, k] });
  const addWhere = v => v && !f.where.includes(v) && setF({ ...f, where: [...f.where, v] });
  const PLACES = [['EU', 'European Union'], ['UK', 'United Kingdom'], ['CA-CAN', 'Canada'], ...Object.entries(states).map(([k, v]) => [k, v[0]])];
  const placeName = k => (PLACES.find(x => x[0] === k) || [k, k])[1];
  return html`<${Modal} wide=${true} title=${inc.t} onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Close</button><button className="btn" disabled=${busy} onClick=${() => save()}>${busy ? 'Saving…' : 'Save'}</button>`}>
      <div className="form">
        <p className="muted small" style=${{ margin: 0 }}>${inc.id} · reported ${fmtTs(inc.found)}${inc.reporter ? ' by ' + inc.reporter : ''} · source: ${inc.src}</p>
        ${inc.desc && html`<div className="govquote">${inc.desc}</div>`}
        <div className="row3">
          <${Field} label="Status"><select value=${f.st} onChange=${e => setF({ ...f, st: e.target.value })}>${INC_ST.map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select><//>
          <${Field} label="Severity"><select value=${f.sev} onChange=${e => setF({ ...f, sev: e.target.value })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select><//>
          <${Field} label="Owner"><select value=${f.owner} onChange=${e => setF({ ...f, owner: e.target.value })}><option value="">—</option>${people.map(p => html`<option key=${p.id} value=${p.id}>${p.n}</option>`)}</select><//>
        </div>
        <div className="checks">
          <label className="check"><input type="checkbox" checked=${f.pd} onChange=${e => setF({ ...f, pd: e.target.checked })} /><span>Personal data may be involved</span></label>
          <label className="check"><input type="checkbox" checked=${f.breach} onChange=${e => setF({ ...f, breach: e.target.checked, pd: e.target.checked || f.pd, sev: e.target.checked && ['low', 'medium'].includes(f.sev) ? 'high' : f.sev })} /><span>Confirmed breach of personal data (unauthorised access or disclosure)</span></label>
        </div>
        ${
          (f.pd || f.breach) &&
          html`<${Fragment}>
            <${Field} label="Kinds of data involved"><div className="checks">${INC_TYPES.map(([k, n]) => html`<label key=${k} className="check"><input type="checkbox" checked=${f.types.includes(k)} onChange=${() => togType(k)} /><span>${n}</span></label>`)}</div><//>
            <div className="row2">
              <${Field} label="Where the people affected live" hint="Each place adds its own notice deadline.">
                <div className="stack" style=${{ gap: 6 }}>
                  <div className="chips">${f.where.map(w => html`<button key=${w} type="button" className="chip pick" onClick=${() => setF({ ...f, where: f.where.filter(x => x !== w) })} title="Remove">${placeName(w)} ×</button>`)}</div>
                  <select value=${add} onChange=${e => {
                    addWhere(e.target.value);
                    setAdd('');
                  }}><option value="">Add a state or country…</option>${PLACES.filter(([k]) => !f.where.includes(k)).map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select>
                </div>
              <//>
              <${Field} label="How many people (estimate)"><input type="number" min="0" value=${f.count} onInput=${e => setF({ ...f, count: +e.target.value })} /><//>
            </div>
          <//>`
        }
        ${
          inc.notices && inc.notices.length > 0 &&
          html`<div className="stack" style=${{ gap: 6 }}>
            <span className="lbl">Notices and deadlines (from when it was found, ${fmtTs(inc.found)})</span>
            <div className="tblwrap"><table className="tbl small">
              <thead><tr><th>Tell</th><th>By</th><th>Rule</th><th>Done</th></tr></thead>
              <tbody>${inc.notices.map(
                n => html`<tr key=${n.k}>
                  <td><b>${n.to}</b></td>
                  <td className="nowrap" style=${{ color: !n.done && n.due && n.due < Date.now() ? 'var(--red-ink)' : '' }}>${n.due ? fmtTs(n.due) : 'As soon as possible'}</td>
                  <td className="trwrap">${n.rule}</td>
                  <td><label className="check"><input type="checkbox" checked=${!!n.done} onChange=${() => save({ noticeDone: n.k })} /><span>${n.done ? fmtDay(n.done) : ''}</span></label></td>
                </tr>`
              )}</tbody>
            </table></div>
            <p className="muted small" style=${{ margin: 0 }}>Deadlines are a quick reference (reviewed October 2026); confirm them with counsel, and check each client contract.</p>
          </div>`
        }
        <${Field} label="Add to the timeline" hint="What was done, decided or learned, and when."><textarea rows="2" value=${note} onInput=${e => setNote(e.target.value)} /><//>
        ${(inc.log || []).length > 0 && html`<ul className="list seclist govlog">${inc.log.slice().reverse().map((l, i) => html`<li key=${i}><div className="t"><span>${l.note}</span><span className="muted small">${fmtTs(l.at)} · ${l.by}</span></div></li>`)}</ul>`}
        ${['resolved', 'closed'].includes(f.st) && html`<${Field} label="Lessons learned" hint="What changes so it does not happen again (SOC 2 CC7.5)."><textarea rows="3" value=${f.lessons} onInput=${e => setF({ ...f, lessons: e.target.value })} /><//>`}
      </div>
    <//>`;
}

/* ---- Training ---- */
function GovTraining() {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [sel, setSel] = useState([]);
  const load = () => api('gov_training').then(r => setRows(r.rows), e => toast(errText(e), true));
  useEffect(() => {
    load();
  }, []);
  if (!rows) return html`<${Spinner} />`;
  const year = Date.now() - 365 * 86400000;
  const late = rows.filter(r => !(r.done > year));
  const remind = async uids => {
    try {
      const r = await api('gov_training_retake', { uids });
      toast('Reminder emailed to ' + r.n + (r.n === 1 ? ' person.' : ' people.'));
      setSel([]);
      load();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  return html`<section className="panel stack" style=${{ gap: 10 }}>
      <div className="ph-row" style=${{ margin: 0 }}>
        <h2 className="ph">Security awareness course</h2>
        <div className="actions">
          ${sel.length > 0 && html`<button className="btn sm" onClick=${() => remind(sel)}>Remind the ${sel.length} selected</button>`}
          ${late.length > 0 && html`<button className="btn ghost sm" onClick=${() => remind(late.map(r => r.uid))}>Remind everyone outstanding (${late.length})</button>`}
        </div>
      </div>
      <p className="muted small" style=${{ margin: 0 }}>"Security awareness at StratEdge" (about 25 minutes, with a short quiz) is required for staff once a year: phishing, passwords and two-step sign-in, handling candidate and immigration data, devices, and reporting. It is in everyone’s Learning page; completions are your SOC 2 evidence (CC1.4, CC2.2).</p>
      <div className="tblwrap"><table className="tbl small">
        <thead><tr><th></th><th>Person</th><th>Progress</th><th>Completed</th></tr></thead>
        <tbody>${rows.map(
          r => html`<tr key=${r.uid}>
            <td><input type="checkbox" checked=${sel.includes(r.uid)} onChange=${() => setSel(sel.includes(r.uid) ? sel.filter(x => x !== r.uid) : [...sel, r.uid])} aria-label=${'Select ' + r.n} /></td>
            <td><b>${r.n}</b><div className="muted">${r.e}</div></td>
            <td>${r.pct}%</td>
            <td>${r.done > year ? html`<${Chip} s="ok">${fmtDay(r.done)}<//>` : r.done ? html`<${Chip} s="amber">${fmtDay(r.done)}: due again<//>` : html`<${Chip} s="red">Not yet<//>`}</td>
          </tr>`
        )}</tbody>
      </table></div>
    </section>`;
}

/* ================= v34: Privacy & retention (Admin and HR) =================
   Requests from #/privacy (confirmed by email first) or logged by staff, with their legal deadline; finding,
   exporting, emailing and deleting a person's data; the retention rule that deletes old candidate records after a
   notice to recruiters. Server: api/privacy.php. */
const PRIV_KIND = { access: 'Copy of their data', correct: 'Correction', delete: 'Deletion', optout: 'Stop contacting them' };
const PRIV_ST = { verifying: 'Waiting for their email confirmation', open: 'Open', done: 'Completed', denied: 'Declined' };
const PRIV_REGION = { us: 'United States', ca: 'Canada', eu: 'European Union', uk: 'United Kingdom', other: 'Elsewhere' };
function PrivacyAdminPage({ q }) {
  const toast = useToast();
  const [tab, setTab] = useState((q && q.tab) || 'requests');
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(null);
  const [nw, setNw] = useState(null);
  const load = () => api('priv_overview').then(setD, setErr);
  useEffect(() => {
    load();
  }, []);
  if (err && !d) return html`<${LoadError} error=${err} onRetry=${load} />`;
  if (!d) return html`<${Spinner} />`;
  const openN = d.requests.filter(r => r.st === 'open').length;
  const late = d.requests.filter(r => r.st === 'open' && r.due < Date.now()).length;
  const addReq = async () => {
    try {
      await api('priv_add', nw);
      toast('Request logged.');
      setNw(null);
      load();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  return html`<div className="stack">
      <${KitTabs} tabs=${[
        ['requests', 'Requests', openN || null],
        ['retention', 'Retention', d.dueCount || null],
      ]} tab=${tab} onTab=${setTab} />
      ${
        tab === 'retention'
          ? html`<${PrivRetention} d=${d} reload=${load} />`
          : html`<section className="panel stack" style=${{ gap: 10 }}>
              <div className="ph-row" style=${{ margin: 0 }}><h2 className="ph">Privacy requests</h2><button className="btn sm" onClick=${() => setNw({ email: '', name: '', kind: 'access', region: 'us', msg: '' })}>Log a request</button></div>
              ${late > 0 && html`<p className="note red" style=${{ margin: 0 }}><span><b>${late} past the deadline.</b> Answer them first.</span></p>`}
              <p className="muted small" style=${{ margin: 0 }}>People ask on the privacy page (they confirm by email first, so nobody can ask for someone else’s data) or you log a request that came by email, phone or letter. The deadline is 45 days in the United States (once extendable by 45 days with notice) and one month in the EU and UK.</p>
              ${
                d.requests.length
                  ? html`<div className="tblwrap"><table className="tbl small">
                      <thead><tr><th>Request</th><th>Person</th><th>Received</th><th>Answer by</th><th>Status</th></tr></thead>
                      <tbody>${d.requests.map(
                        r => html`<tr key=${r.id} className="clickable" onClick=${() => setOpen(r)}>
                          <td><b>${PRIV_KIND[r.kind]}</b><div className="muted">${r.id} · ${PRIV_REGION[r.region] || r.region}</div></td>
                          <td>${r.n || '—'}<div className="muted">${r.e}</div></td>
                          <td className="nowrap">${fmtDay(r.at)}</td>
                          <td className="nowrap" style=${{ color: r.st === 'open' && r.due < Date.now() ? 'var(--red-ink)' : '' }}>${r.due ? fmtDay(r.due) : '—'}</td>
                          <td><${Chip} s=${r.st === 'done' ? 'ok' : r.st === 'open' ? 'amber' : ''}>${PRIV_ST[r.st]}<//></td>
                        </tr>`
                      )}</tbody>
                    </table></div>`
                  : html`<p className="muted small" style=${{ margin: 0 }}>No requests yet.</p>`
              }
            </section>`
      }
      ${
        nw &&
        html`<${Modal} title="Log a privacy request" onClose=${() => setNw(null)} foot=${html`<button className="btn ghost" onClick=${() => setNw(null)}>Cancel</button><button className="btn" onClick=${addReq}>Log it</button>`}>
          <div className="form">
            <p className="muted small" style=${{ margin: 0 }}>Check who is asking first (for example, reply from the email address on file, or ask for details only they would know).</p>
            <div className="row2">
              <${Field} label="Their email"><input type="email" value=${nw.email} onInput=${e => setNw({ ...nw, email: e.target.value })} /><//>
              <${Field} label="Name"><input value=${nw.name} onInput=${e => setNw({ ...nw, name: e.target.value })} /><//>
            </div>
            <div className="row2">
              <${Field} label="They asked for"><select value=${nw.kind} onChange=${e => setNw({ ...nw, kind: e.target.value })}>${Object.entries(PRIV_KIND).map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select><//>
              <${Field} label="Where they live"><select value=${nw.region} onChange=${e => setNw({ ...nw, region: e.target.value })}>${Object.entries(PRIV_REGION).map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select><//>
            </div>
            <${Field} label="Details"><textarea rows="3" value=${nw.msg} onInput=${e => setNw({ ...nw, msg: e.target.value })} /><//>
          </div>
        <//>`
      }
      ${open && html`<${PrivRequestModal} r=${open} onClose=${() => setOpen(null)} onChanged=${async () => {
        const fresh = await api('priv_overview');
        setD(fresh);
        setOpen(fresh.requests.find(x => x.id === open.id) || null);
      }} />`}
    </div>`;
}
function PrivRequestModal({ r, onClose, onChanged }) {
  const toast = useToast();
  const [found, setFound] = useState(null);
  const [busy, setBusy] = useState('');
  const [close, setClose] = useState({ st: 'done', note: '', tell: true });
  useEffect(() => {
    api('priv_find', { email: r.e }).then(setFound, e => toast(errText(e), true));
  }, [r.id]);
  const act = async (k, fn, msg) => {
    setBusy(k);
    try {
      const x = await fn();
      if (msg) toast(typeof msg === 'function' ? msg(x) : msg);
      await onChanged();
      if (k === 'erase') setFound(await api('priv_find', { email: r.e }));
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const live = r.st === 'open';
  const n = found ? found.ats.length + found.cand.length + found.web.length + (found.wsj || []).length + (found.contacts ? 1 : 0) : 0;
  return html`<${Modal} wide=${true} title=${PRIV_KIND[r.kind] + ': ' + (r.n || r.e)} onClose=${onClose}>
      <div className="stack" style=${{ gap: 12 }}>
        <dl className="kv">
          <dt>Email</dt><dd>${r.e}</dd>
          <dt>Lives in</dt><dd>${PRIV_REGION[r.region] || r.region}</dd>
          <dt>Received</dt><dd>${fmtTs(r.at)} (${r.src === 'staff' ? 'logged by staff' : 'privacy page'})</dd>
          <dt>Answer by</dt><dd>${r.due ? fmtDay(r.due) : 'After they confirm their email'}</dd>
          <dt>Status</dt><dd>${PRIV_ST[r.st]}</dd>
          ${r.msg && html`<dt>Their words</dt><dd className="trwrap">${r.msg}</dd>`}
        </dl>
        <section className="stack" style=${{ gap: 6 }}>
          <span className="lbl">What the portal holds for ${r.e}</span>
          ${
            !found
              ? html`<${Spinner} />`
              : html`<ul className="list seclist">
                  <li><div className="t"><span>Portal account</span><span className="muted small">${found.user ? found.user.name + ' · ' + found.user.role + ' · ' + found.user.status : 'None'}</span></div></li>
                  <li><div className="t"><span>Applications (candidates)</span><span className="muted small">${found.ats.length ? found.ats.map(a => a.jt || a.id).join(', ') : 'None'}</span></div></li>
                  <li><div className="t"><span>Consultant database profiles</span><span className="muted small">${found.cand.length || 'None'}</span></div></li>
                  <li><div className="t"><span>Website messages</span><span className="muted small">${found.web.length || 'None'}</span></div></li>
                  ${(found.wsj || []).length > 0 && html`<li><div className="t"><span>Requests for a company portal</span><span className="muted small">${found.wsj.map(w => w.co).join(', ')}</span></div></li>`}
                  <li><div className="t"><span>Mailing contacts</span><span className="muted small">${found.contacts ? found.contacts + (found.suppressed ? ' (on the do-not-contact list)' : '') : found.suppressed ? 'On the do-not-contact list' : 'None'}</span></div></li>
                  ${found.legal.length > 0 && html`<li><div className="t"><span>Kept by law</span><span className="muted small">${found.legal.join('; ')}: these stay even after a deletion request, and you tell them so.</span></div></li>`}
                </ul>`
          }
        </section>
        ${
          live &&
          html`<div className="actions">
            <button className="btn ghost sm" disabled=${!!busy} onClick=${() =>
              act('export', async () => {
                const x = await api('priv_export', { email: r.e });
                FileSaver.save({ filename: 'privacy-' + r.id + '.json', data: new Blob([x.json], { type: 'application/json' }) });
                return x;
              })}>Download their data</button>
            ${r.kind === 'access' && html`<button className="btn sm" disabled=${!!busy} onClick=${() => act('send', () => api('priv_send_copy', { id: r.id }), x => (x.ok ? 'Copy emailed to ' + r.e + '.' : 'The email could not be sent.'))}>Email them a copy</button>`}
            ${r.kind === 'delete' && html`<button className="btn sm danger" disabled=${!!busy || !n} onClick=${() => window.confirm('Delete the applications, database profiles, website messages, mailing contacts and own tax answers of ' + r.e + '? This cannot be undone. Records kept by law stay.') && act('erase', () => api('priv_erase', { id: r.id }), x => 'Deleted: ' + x.deleted.ats + ' applications, ' + x.deleted.cand + ' profiles, ' + x.deleted.web + ' messages, ' + (x.deleted.wsj ? x.deleted.wsj + ' portal requests, ' : '') + (x.deleted.tax ? x.deleted.tax + ' years of tax answers, ' : '') + x.deleted.files + ' files.')}>Delete their data</button>`}
          </div>`
        }
        ${live && found && found.user && r.kind === 'delete' && html`<p className="muted small" style=${{ margin: 0 }}>They also have a portal account: pause or remove it under Team once payroll and compliance records allow.</p>`}
        ${live && r.kind === 'correct' && html`<p className="muted small" style=${{ margin: 0 }}>Make the corrections in the records above (or ask them to update their profile), then complete the request.</p>`}
        ${live && r.kind === 'optout' && html`<p className="muted small" style=${{ margin: 0 }}>Completing the request puts ${r.e} on the do-not-contact list of every mailing.</p>`}
        ${
          live &&
          html`<section className="panel form" style=${{ gap: 10 }}>
            <div className="seg" style=${{ margin: 0 }}>${[
              ['done', 'Complete'],
              ['denied', 'Decline'],
            ].map(([k, nn]) => html`<button key=${k} type="button" className=${close.st === k ? 'on' : ''} onClick=${() => setClose({ ...close, st: k })}>${nn}</button>`)}</div>
            <${Field} label=${close.st === 'done' ? 'Note (also emailed to them when ticked below)' : 'Why it is declined (emailed to them when ticked below)'}><textarea rows="2" value=${close.note} onInput=${e => setClose({ ...close, note: e.target.value })} /><//>
            <label className="check"><input type="checkbox" checked=${close.tell} onChange=${e => setClose({ ...close, tell: e.target.checked })} /><span>Email them that the request is ${close.st === 'done' ? 'completed' : 'declined'}</span></label>
            <div><button className="btn" disabled=${!!busy || (close.st === 'denied' && close.note.trim().length < 5)} onClick=${() => act('close', () => api('priv_close', { id: r.id, ...close }), close.st === 'done' ? 'Request completed.' : 'Request declined.')}>${close.st === 'done' ? 'Complete the request' : 'Decline the request'}</button></div>
          </section>`
        }
        ${r.st === 'verifying' && html`<p className="note amber" style=${{ margin: 0 }}><span>Waiting for ${r.e} to confirm the request with the link we emailed. Nothing to do until then.</span></p>`}
        <section className="stack" style=${{ gap: 4 }}>
          <span className="lbl">Timeline</span>
          <ul className="list seclist govlog">${(r.log || []).slice().reverse().map((l, i) => html`<li key=${i}><div className="t"><span>${l.note}</span><span className="muted small">${fmtTs(l.at)} · ${l.by}</span></div></li>`)}</ul>
        </section>
      </div>
    <//>`;
}
function PrivRetention({ d, reload }) {
  const toast = useToast();
  const [cfg, setCfg] = useState({ ...d.cfg });
  const [sel, setSel] = useState([]);
  const [busy, setBusy] = useState('');
  const act = async (k, fn, msg) => {
    setBusy(k);
    try {
      const x = await fn();
      toast(typeof msg === 'function' ? msg(x) : msg);
      setSel([]);
      reload();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const key = x => x.kind + ':' + x.id;
  const picked = d.due.filter(x => sel.includes(key(x)));
  return html`<div className="stack">
      <section className="panel stack form" style=${{ gap: 12 }}>
        <div className="ph-row" style=${{ margin: 0 }}><h2 className="ph">Retention rule</h2><${Chip} s=${cfg.on ? 'ok' : 'amber'}>${cfg.on ? 'On' : 'Off'}<//></div>
        <p className="muted small" style=${{ margin: 0 }}>Keep candidate data only as long as it is useful: applications and database profiles of people who were never placed and have had no activity for the set period are announced to the security contacts, then deleted after the notice period unless someone keeps them. Hired people, portal accounts and anything on legal hold are never touched.</p>
        <label className="check"><input type="checkbox" disabled=${!d.canSettings} checked=${!!cfg.on} onChange=${e => setCfg({ ...cfg, on: e.target.checked })} /><span>Delete old candidate records automatically</span></label>
        <div className="row2">
          <${Field} label="After this many months without activity"><input type="number" min="6" max="120" disabled=${!d.canSettings} value=${cfg.months} onInput=${e => setCfg({ ...cfg, months: +e.target.value })} /><//>
          <${Field} label="Notice before deleting (days)"><input type="number" min="7" max="90" disabled=${!d.canSettings} value=${cfg.notice} onInput=${e => setCfg({ ...cfg, notice: +e.target.value })} /><//>
        </div>
        <label className="check"><input type="checkbox" disabled=${!d.canSettings} checked=${cfg.consent !== false} onChange=${e => setCfg({ ...cfg, consent: e.target.checked })} /><span>Applications must agree to the privacy notice (recorded with the time and the notice version)</span></label>
        ${
          d.canSettings
            ? html`<div className="actions">
                <button className="btn sm" disabled=${!!busy} onClick=${() => act('save', () => api('priv_cfg_save', { cfg }), 'Retention rule saved.')}>Save</button>
                ${cfg.on && html`<button className="btn ghost sm" disabled=${!!busy} onClick=${() => act('run', () => api('priv_run', {}), x => (x.ran ? x.announced + ' announced, ' + x.deleted + ' deleted.' : 'Nothing to do.'))}>Run the retention pass now</button>`}
              </div>`
            : html`<p className="muted small" style=${{ margin: 0 }}>Only an administrator changes the rule.</p>`
        }
        ${d.cfg.lastRun > 0 && html`<p className="muted small" style=${{ margin: 0 }}>Last run ${fmtTs(d.cfg.lastRun)}.</p>`}
      </section>
      <section className="panel stack" style=${{ gap: 10 }}>
        <div className="ph-row" style=${{ margin: 0 }}>
          <h2 className="ph">Past the retention period (${d.dueCount})</h2>
          ${
            picked.length > 0 &&
            html`<div className="actions">
              <button className="btn sm" disabled=${!!busy} onClick=${() => act('keep', () => api('priv_keep', { items: picked.map(x => ({ kind: x.kind, id: x.id })) }), x => x.n + ' kept (their clock starts again).')}>Keep the ${picked.length} selected</button>
              <button className="btn ghost sm" disabled=${!!busy} onClick=${() => act('hold', () => api('priv_keep', { items: picked.map(x => ({ kind: x.kind, id: x.id })), hold: true }), x => x.n + ' put on legal hold.')}>Legal hold</button>
            </div>`
          }
        </div>
        ${
          d.due.length
            ? html`<div className="tblwrap"><table className="tbl small">
                <thead><tr><th></th><th>Person</th><th>Record</th><th>Last activity</th><th>Deleted on</th></tr></thead>
                <tbody>${d.due.map(
                  x => html`<tr key=${key(x)}>
                    <td><input type="checkbox" checked=${sel.includes(key(x))} onChange=${() => setSel(sel.includes(key(x)) ? sel.filter(y => y !== key(x)) : [...sel, key(x)])} aria-label=${'Select ' + x.n} /></td>
                    <td><b>${x.n || '—'}</b><div className="muted">${x.e}</div></td>
                    <td>${x.kind === 'ats' ? 'Application' : 'Database profile'}</td>
                    <td className="nowrap">${fmtDay(x.last)}</td>
                    <td className="nowrap">${x.due ? fmtDay(x.due) : html`<span className="muted">${cfg.on ? 'Announced at the next run' : 'Rule off'}</span>`}</td>
                  </tr>`
                )}</tbody>
              </table></div>`
            : html`<p className="muted small" style=${{ margin: 0 }}>Nothing is past the retention period.</p>`
        }
      </section>
    </div>`;
}
