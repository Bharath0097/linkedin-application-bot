/* ================= v30: compliance hub, learning platform, live projects and the vault (member portals) =================
   Pages: CompliancePage (#/portal/compliance), LearnPage (#/portal/learn, ?c=course), ProjectsPage (#/portal/projects,
   ?p=id), VaultPage (#/portal/vault). The server builds the compliance checklist and grades every quiz (api/comp.php,
   api/learn.php); this file only shows and edits. */

/* Links inside the member portal keep the portal the person is in (#/portal/consultant/... or #/portal/employee/...). */
const growHref = (P, sub) => '#' + ((P && P.base) || '/portal') + '/' + sub;


/* ================= Compliance hub ================= */
const COMP_SEV = { late: ['Overdue', 'red'], soon: ['Due soon', 'amber'], later: ['Scheduled', ''], open: ['To do', 'new'], info: ['Good to know', 'info'], done: ['Done', 'done'] };
const COMP_DOC_CATS = { passport: 'Passport', visa: 'Visa stamp', i94: 'I-94 record', i20: 'I-20 / DS-2019', ead: 'EAD card', i797: 'I-797 notice', i983: 'Form I-983', lca: 'LCA', pay: 'Pay stubs', tax: 'Tax return / W-2', letter: 'Employment or client letter', other: 'Other' };
function compDays(a, b) {
  return Math.round((parseD(b) - parseD(a)) / 86400000);
}
function RuleCard({ r, open, onToggle, cats }) {
  return html`<div className=${'rule' + (open ? ' open' : '')}>
      <button type="button" className="rulehead" onClick=${onToggle} aria-expanded=${open}>
        <span className="rulecat">${(cats && cats[r.cat]) || r.cat}</span>
        <b>${r.t}</b>
        ${r.dl && html`<span className="chip">${r.dl}</span>`}
        <${Icon} n=${open ? 'up' : 'down'} />
      </button>
      <p className="rulesum">${r.s}</p>
      ${
        open &&
        html`<div className="rulebody">
          ${r.d && html`<${MdLite} text=${r.d} />`}
          ${r.risk && html`<div className="note amber"><span><b>If it is missed:</b> ${r.risk}</span></div>`}
          ${
            r.src && r.src.length
              ? html`<p className="muted small" style=${{ marginTop: 10 }}>
                  Sources: ${r.src.map((s, i) => html`<${Fragment} key=${i}>${i ? ' · ' : ''}<a href=${s.u} target="_blank" rel="noopener">${s.l || s.u}</a><//>`)}
                </p>`
              : null
          }
        </div>`
      }
    </div>`;
}
/* The status-and-dates form; the server derives the checklist from it. */
function CompProfileModal({ profile, statuses, uid, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState(() => ({ ...profile, unemp: (profile.unemp || []).map(x => ({ ...x })), evals: { ...(profile.evals || {}) } }));
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const st = f.st || '';
  const isF1 = ['f1opt', 'f1stem', 'f1cpt'].includes(st);
  const isWork = ['h1b', 'l1', 'tn', 'e3', 'o1'].includes(st);
  const D = (k, label, hint) => html`<${Field} label=${label} hint=${hint}><input type="date" value=${f[k] || ''} onChange=${e => set(k, e.target.value)} /><//>`;
  const C = (k, label) => html`<label className="check"><input type="checkbox" checked=${!!f[k]} onChange=${e => set(k, e.target.checked)} /> ${label}</label>`;
  const save = async () => {
    setBusy(true);
    try {
      const r = await api('comp_profile_save', { profile: f, ...(uid ? { uid } : {}) });
      toast('Status saved; your checklist is updated.');
      onSaved(r);
      onClose();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<${Modal} title="Your status and dates" onClose=${onClose} wide foot=${html`<button className="btn ghost" onClick=${onClose}>Cancel</button><button className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save'}</button>`}>
      <div className="form">
        <p className="muted small" style=${{ margin: 0 }}>Copy the dates from your documents. Only you, HR and administrators can see them; the checklist, reminders and I-9 reverification dates are built from them.</p>
        <${Field} label="Current status">
          <select value=${st} onChange=${e => set('st', e.target.value)}>
            <option value="">Choose…</option>
            ${Object.entries(statuses).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}
          </select>
        <//>
        ${
          st &&
          st !== 'citizen' &&
          html`<div className="row3">
            ${D('passExp', 'Passport expires')}
            ${D('i94Exp', 'I-94 "admit until" date', 'From i94.cbp.dhs.gov')}
            ${D('visaExp', 'Visa stamp expires')}
          </div>`
        }
        ${
          isF1 &&
          html`<${Fragment}>
            <div className="row3">
              ${D('optStart', 'OPT EAD start')}
              ${D('optEnd', 'OPT EAD end')}
              ${st === 'f1stem' ? D('stemStart', 'STEM OPT EAD start') : D('eadExp', 'EAD expires')}
            </div>
            ${
              st === 'f1stem' &&
              html`<div className="row3">
                ${D('stemEnd', 'STEM OPT EAD end')}
                ${D('eadExp', 'EAD card expires', 'Usually the STEM end date')}
                <${Field} label="School / DSO"><input value=${f.school || ''} onChange=${e => set('school', e.target.value)} placeholder="School and DSO name" /><//>
              </div>`
            }
            <div className="checks">
              ${C('ds', 'I was admitted for "duration of status" (D/S) before 15 September 2026')}
              ${st === 'f1opt' && C('stem', 'My degree qualifies for the STEM extension')}
              ${C('h1bReg', 'StratEdge is registering me in the H-1B lottery')}
            </div>
            ${
              (st === 'f1opt' || st === 'f1stem') &&
              html`<div className="panel" style=${{ padding: 14 }}>
                <div className="ph-row"><b>Unemployment log</b><button type="button" className="btn ghost sm" onClick=${() => set('unemp', [...(f.unemp || []), { from: '', to: '', note: '' }])}><${Icon} n="plus" />Add a gap</button></div>
                <p className="muted small" style=${{ marginTop: 0 }}>Every calendar day without a qualifying job, from the EAD start date. ${st === 'f1stem' ? '150 days in total with OPT.' : '90 days at most.'}</p>
                <label className="check"><input type="checkbox" checked=${f.working !== false} onChange=${e => set('working', e.target.checked)} /> I am working now</label>
                ${f.working === false && html`<div style=${{ maxWidth: 260 }}>${D('notWorkingSince', 'Not working since')}</div>`}
                ${(f.unemp || []).map(
                  (g, i) => html`<div key=${i} className="row3" style=${{ marginTop: 8, alignItems: 'end' }}>
                    <${Field} label="From"><input type="date" value=${g.from || ''} onChange=${e => set('unemp', f.unemp.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} /><//>
                    <${Field} label="To (empty = ongoing)"><input type="date" value=${g.to || ''} onChange=${e => set('unemp', f.unemp.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))} /><//>
                    <div className="actions"><input value=${g.note || ''} placeholder="Note" onChange=${e => set('unemp', f.unemp.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} /><button type="button" className="btn ghost icon" aria-label="Remove" onClick=${() => set('unemp', f.unemp.filter((_, j) => j !== i))}><${Icon} n="trash" /></button></div>
                  </div>`
                )}
              </div>`
            }
            ${
              st === 'f1stem' &&
              html`<div className="panel" style=${{ padding: 14 }}>
                <b>Reports already filed</b>
                <p className="muted small" style=${{ marginTop: 4 }}>Enter the date you sent each one; the checklist drops it.</p>
                <div className="row3">
                  ${[['v6', '6-month validation'], ['v12', '12-month validation'], ['v18', '18-month validation'], ['v24', '24-month validation'], ['e12', '12-month evaluation (I-983)'], ['e24', 'Final evaluation (I-983)']].map(
                    ([k, l]) => html`<${Field} key=${k} label=${l}><input type="date" value=${(f.evals || {})[k] || ''} onChange=${e => set('evals', { ...(f.evals || {}), [k]: e.target.value })} /><//>`
                  )}
                </div>
              </div>`
            }
          <//>`
        }
        ${
          isWork &&
          html`<${Fragment}>
            <div className="row3">
              ${D('h1bExp', 'Approval (I-797) valid until')}
              ${st === 'h1b' && D('h1bFirst', 'First day in H-1B status', 'Starts the six-year clock')}
              ${st === 'h1b' && html`<${Field} label="Days spent outside the U.S. since" hint="Recapturable time"><input type="number" min="0" value=${f.abroad || 0} onChange=${e => set('abroad', e.target.value)} /><//>`}
            </div>
            <div className="row2">
              <${Field} label="LCA worksite area (city / metro)"><input value=${f.lcaArea || ''} onChange=${e => set('lcaArea', e.target.value)} placeholder="e.g. Somerset, NJ (New York metro)" /><//>
              <div className="checks" style=${{ alignSelf: 'end' }}>${C('deps', 'I have H-4 / dependent family members')}</div>
            </div>
          <//>`
        }
        ${
          st === 'h4ead' &&
          html`<div className="row2">
            ${D('eadExp', 'H-4 EAD expires')}
            ${D('h1bExp', "Principal's H-1B valid until")}
          </div>`
        }
        ${st === 'lpr' && html`<div className="row2">${D('gcExp', 'Green card expires')}</div>`}
        ${
          (isWork || st === 'gcpend' || st === 'h4ead') &&
          html`<div className="panel" style=${{ padding: 14 }}>
            <b>Green card process</b>
            <div className="row3" style=${{ marginTop: 8 }}>
              <${Field} label="Stage">
                <select value=${f.gc || 'none'} onChange=${e => set('gc', e.target.value)}>
                  <option value="none">Not started</option>
                  <option value="perm">PERM in progress</option>
                  <option value="i140">I-140 filed or approved</option>
                  <option value="i485">I-485 pending</option>
                </select>
              <//>
              ${D('pd', 'Priority date')}
              ${f.gc === 'i140' && D('i140At', 'I-140 approved on')}
              ${f.gc === 'i485' && D('i485At', 'I-485 filed on')}
              ${(f.gc === 'i485' || st === 'gcpend') && D('eadExp', 'EAD (c)(9) expires')}
              ${(f.gc === 'i485' || st === 'gcpend') && D('apExp', 'Advance Parole expires')}
            </div>
          </div>`
        }
        ${
          st &&
          st !== 'citizen' &&
          html`<div className="panel" style=${{ padding: 14 }}>
            <b>Moved recently?</b>
            <div className="row2" style=${{ marginTop: 8, alignItems: 'end' }}>
              <div className="checks">${C('moved', 'I moved and still have to report the new address')}</div>
              ${f.moved && D('addrAt', 'Date of the move')}
            </div>
          </div>`
        }
        <div className="row2">
          <${Field} label="Attorney or DSO contact (optional)"><input value=${f.attorney || ''} onChange=${e => set('attorney', e.target.value)} placeholder="Name" /><//>
          <${Field} label="Their e-mail"><input value=${f.attorneyEmail || ''} onChange=${e => set('attorneyEmail', e.target.value)} /><//>
        </div>
        <${Field} label="Notes"><textarea rows="2" value=${f.notes || ''} onChange=${e => set('notes', e.target.value)} /><//>
      </div>
    <//>`;
}
function CompDocuments({ uid }) {
  const toast = useToast();
  const base = `comp/${uid}/docs/all`;
  const files = useCol(`${base}/f`, 'at:desc');
  const [cat, setCat] = useState('passport');
  const [exp, setExp] = useState('');
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(0);
  const onFiles = async fs => {
    setBusy(true);
    try {
      for (const f of fs) {
        setProg(0.03);
        const d = await storeFile(base, f, { c: cat }, setProg);
        if (exp) await Cap.db.doc(`${base}/f/${d.id}`).update({ exp });
      }
      toast('Document saved.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const today = dkey();
  return html`<div className="stack">
      <section className="panel stack" style=${{ gap: 14 }}>
        <div>
          <h2 className="ph">Add an immigration document</h2>
          <p className="muted small" style=${{ marginTop: 4 }}>Only you and HR can open these. Give each one its expiry date so it shows up in time.</p>
        </div>
        <div className="form"><div className="row2">
          <${Field} label="Document"><select value=${cat} onChange=${e => setCat(e.target.value)}>${Object.entries(COMP_DOC_CATS).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//>
          <${Field} label="Expires (optional)"><input type="date" value=${exp} onChange=${e => setExp(e.target.value)} /><//>
        </div></div>
        <${FilePick} busy=${busy} progress=${prog} onFiles=${onFiles} />
      </section>
      <section className="panel" style=${{ padding: '6px 8px' }}>
        ${
          files.loading
            ? html`<${Spinner} />`
            : files.docs.length
              ? html`<div className="tblwrap"><table className="tbl">
                  <thead><tr><th>Document</th><th>File</th><th>Expires</th><th>Added</th><th className="r"><span className="sr">Actions</span></th></tr></thead>
                  <tbody>
                    ${files.docs.map(
                      f => html`<tr key=${f.id}>
                        <td><b>${COMP_DOC_CATS[f.c] || 'Document'}</b></td>
                        <td><a href=${fileUrl(base, f.id)} target="_blank" rel="noopener">${f.n}</a></td>
                        <td>${f.exp ? html`<span className=${'chip ' + (f.exp < today ? 'red' : compDays(today, f.exp) <= 90 ? 'amber' : 'ok')}>${fmtDate(f.exp, { month: 'short', day: 'numeric', year: 'numeric' })}</span>` : html`<span className="muted">—</span>`}</td>
                        <td className="muted">${fmtDay(f.at)}</td>
                        <td className="r"><button type="button" className="btn ghost sm" onClick=${async () => { try { await deleteStored(base, f.id); toast('Deleted.'); } catch (e) { toast(errText(e), true); } }}>Delete</button></td>
                      </tr>`
                    )}
                  </tbody>
                </table></div>`
              : html`<${Empty} title="No documents yet">Passport, visa, I-94, I-20, EAD, I-797 notices, LCA, pay stubs: keep them here with their expiry dates.<//>`
        }
      </section>
    </div>`;
}
function CompliancePage({ q, uid: forUid, embedded }) {
  const P = usePortal();
  const toast = useToast();
  const uid = forUid || P.uid;
  const [data, setData] = useState(null);
  const [rules, setRules] = useState(null);
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState((q && q.tab) || 'checklist');
  const [edit, setEdit] = useState(false);
  const [openRule, setOpenRule] = useState((q && q.rule) || null);
  const [cat, setCat] = useState('mine');
  const [showDone, setShowDone] = useState(false);
  const load = async () => {
    try {
      const [d, r] = await Promise.all([api('comp_me' + (forUid ? '&uid=' + encodeURIComponent(forUid) : '')), rules ? Promise.resolve(rules) : api('comp_rules')]);
      setData(d);
      setRules(r);
    } catch (e) {
      setErr(errText(e));
    }
  };
  useEffect(() => {
    load();
  }, [uid]);
  if (err) return html`<div className="panel"><${Empty} title="Could not load the compliance hub">${err}<//></div>`;
  if (!data || !rules) return html`<${Spinner} />`;
  const p = data.profile;
  const tasks = data.tasks;
  const late = tasks.filter(t => t.sev === 'late').length;
  const soon = tasks.filter(t => t.sev === 'soon').length;
  const open = tasks.filter(t => !t.done && t.kind !== 'info').length;
  const ruleById = Object.fromEntries(rules.items.map(r => [r.id, r]));
  const toggleDone = async t => {
    try {
      setData(await api('comp_task_done', { id: t.id, undo: !!t.done, ...(forUid ? { uid: forUid } : {}) }));
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const applies = r => (r.who === 'all' ? true : r.who === 'nonciz' ? p.st && p.st !== 'citizen' : Array.isArray(r.who) && r.who.includes(p.st));
  const shownRules = rules.items.filter(r => (cat === 'mine' ? applies(r) : cat === 'all' ? true : r.cat === cat));
  const shownTasks = tasks.filter(t => showDone || !t.done);
  // v45: "My cases" (the person's own view only) lists the petitions and applications HR runs for them (ImMine, js/work.js)
  return html`<div className="stack comp">
      ${
        !embedded &&
        html`<${KitStats} items=${[
          { v: late, l: 'Overdue', tone: late ? 'warn' : '', onClick: () => setTab('checklist') },
          { v: soon, l: 'Due in 30 days', tone: soon ? 'warn' : '' },
          { v: open, l: 'Open items' },
          data.unemp ? { v: `${data.unemp.used} / ${data.unemp.limit}`, l: 'Unemployment days used', tone: data.unemp.left <= 30 ? 'warn' : '' } : { v: p.st ? (rules.statuses[p.st] || '').split(' ')[0] : '—', l: p.st ? 'Status on file' : 'No status set yet' },
        ]} />`
      }
      <${KitTabs} tab=${tab} onTab=${setTab} tabs=${[['checklist', 'My checklist', open || null], ['rules', 'Rules & regulations'], ['docs', 'Documents'], ...(forUid ? [] : [['cases', 'My cases']])]} />
      ${
        tab === 'checklist' &&
        html`<div className="stack">
          <section className="panel">
            <div className="ph-row">
              <div>
                <h2 className="ph">${p.st ? rules.statuses[p.st] : 'Set your status to build the checklist'}</h2>
                <p className="muted small" style=${{ margin: '4px 0 0' }}>
                  ${p.st ? [p.i94Exp && 'I-94 until ' + fmtDate(p.i94Exp, { month: 'short', day: 'numeric', year: 'numeric' }), p.eadExp && 'EAD ' + fmtDate(p.eadExp, { month: 'short', day: 'numeric', year: 'numeric' }), p.h1bExp && 'Approval ' + fmtDate(p.h1bExp, { month: 'short', day: 'numeric', year: 'numeric' }), p.passExp && 'Passport ' + fmtDate(p.passExp, { month: 'short', day: 'numeric', year: 'numeric' }), p.gc && p.gc !== 'none' && { perm: 'PERM in progress', i140: 'I-140 stage', i485: 'I-485 pending' }[p.gc]].filter(Boolean).join(' · ') || 'Add your dates to get deadlines.' : 'Pick your status and copy the dates from your documents; every deadline below is derived from them.'}
                </p>
              </div>
              <div className="actions">
                <button type="button" className="btn" onClick=${() => setEdit(true)}><${Icon} n="pen" />${p.st ? 'Update status & dates' : 'Set my status'}</button>
              </div>
            </div>
            ${
              data.unemp &&
              html`<div style=${{ marginTop: 6 }}>
                <div className="prog" style=${{ height: 8 }}><i style=${{ width: Math.min(100, (data.unemp.used / data.unemp.limit) * 100) + '%', background: data.unemp.left <= 30 ? 'var(--red)' : undefined }} /></div>
                <p className="muted small" style=${{ margin: '6px 0 0' }}>Unemployment: ${data.unemp.used} of ${data.unemp.limit} days used, ${data.unemp.left} left. Log every gap under "Update status & dates".</p>
              </div>`
            }
          </section>
          <section className="panel" style=${{ padding: '6px 8px' }}>
            <div className="ph-row" style=${{ padding: '8px 8px 0' }}>
              <span className="muted small">${shownTasks.length} item${shownTasks.length === 1 ? '' : 's'}</span>
              <label className="check small"><input type="checkbox" checked=${showDone} onChange=${e => setShowDone(e.target.checked)} /> Show completed</label>
            </div>
            ${
              shownTasks.length
                ? html`<div className="tasklist">
                    ${shownTasks.map(t => {
                      const [label, tone] = COMP_SEV[t.sev] || ['', ''];
                      return html`<div key=${t.id} className=${'ctask ' + t.sev}>
                        ${t.kind !== 'info' ? html`<input type="checkbox" checked=${!!t.done} onChange=${() => toggleDone(t)} aria-label=${'Done: ' + t.ti} />` : html`<span className="cinfo"><${Icon} n="spark" /></span>`}
                        <div className="cbody">
                          <div className="ctitle"><b>${t.ti}</b><span className=${'chip ' + tone}>${label}${t.due && !t.done ? ' · ' + fmtDate(t.due, { month: 'short', day: 'numeric', year: 'numeric' }) : ''}</span>${t.kind === 'hr' && html`<span className="chip info">HR</span>`}</div>
                          <p className="muted small">${t.d}</p>
                          ${t.from && !t.done && t.days > 0 && html`<p className="muted small">Window opens ${fmtDate(t.from, { month: 'short', day: 'numeric', year: 'numeric' })}.</p>`}
                          ${t.rule && ruleById[t.rule] && html`<button type="button" className="btn link sm" onClick=${() => { setTab('rules'); setCat('all'); setOpenRule(t.rule); }}>Read the rule: ${ruleById[t.rule].t}</button>`}
                        </div>
                      </div>`;
                    })}
                  </div>`
                : html`<${Empty} title="Nothing on the list">${p.st ? 'No open items for your status and dates.' : 'Set your status to see your deadlines.'}<//>`
            }
          </section>
          <p className="muted small">This checklist is a reminder tool built from the dates you entered, not legal advice. Deadlines change; confirm anything important with your DSO or attorney. Rules last reviewed ${rules.rev}.</p>
        </div>`
      }
      ${
        tab === 'rules' &&
        html`<div className="stack">
          <div className="chips">
            ${[['mine', 'Applies to me'], ['all', 'Everything'], ...Object.entries(rules.cats)].map(([k, v]) => html`<button key=${k} type="button" className=${'chipbtn' + (cat === k ? ' on' : '')} onClick=${() => setCat(k)}>${v}</button>`)}
          </div>
          ${
            shownRules.length
              ? shownRules.map(r => html`<${RuleCard} key=${r.id} r=${r} cats=${rules.cats} open=${openRule === r.id} onToggle=${() => setOpenRule(openRule === r.id ? null : r.id)} />`)
              : html`<div className="panel"><${Empty} title="No rules for this filter">${cat === 'mine' && !p.st ? 'Set your status under My checklist to see what applies to you.' : 'Try another category.'}<//></div>`
          }
          <p className="muted small">Summaries written for StratEdge consultants from the sources linked under each rule, reviewed ${rules.rev}. They are not legal advice.</p>
        </div>`
      }
      ${tab === 'docs' && html`<${CompDocuments} uid=${uid} />`}
      ${tab === 'cases' && !forUid && html`<${Lazy} load=${loadWork} get=${() => ImMine} label="Loading your cases…" />`}
      ${edit && html`<${CompProfileModal} profile=${p} statuses=${rules.statuses} uid=${forUid} onClose=${() => setEdit(false)} onSaved=${d => setData(d)} />`}
    </div>`;
}

/* ================= Learning platform ================= */
function QuizItemView({ item, value, onChange, result }) {
  const dis = !!result;
  const ok = result ? result.ok : null;
  const Opt = (o, i, type) => html`<label key=${i} className=${'qopt' + (dis && result && (type === 'mc' ? i === Number(value) : (value || []).includes(i)) ? (ok ? ' right' : ' wrong') : '')}>
      <input type=${type === 'mc' ? 'radio' : 'checkbox'} name=${'q' + item.i} disabled=${dis} checked=${type === 'mc' ? Number(value) === i : (value || []).includes(i)} onChange=${() => onChange(type === 'mc' ? i : (value || []).includes(i) ? (value || []).filter(x => x !== i) : [...(value || []), i])} />
      <span>${o}</span>
    </label>`;
  let body;
  switch (item.ty) {
    case 'mc':
      body = html`<div className="qopts">${item.o.map((o, i) => Opt(o, i, 'mc'))}</div>`;
      break;
    case 'multi':
      body = html`<div className="qopts">${item.o.map((o, i) => Opt(o, i, 'multi'))}<p className="muted small">Choose all that apply.</p></div>`;
      break;
    case 'tf':
      body = html`<div className="seg">${[[true, 'True'], [false, 'False']].map(([v, l]) => html`<button key=${l} type="button" disabled=${dis} className=${value === v ? 'on' : ''} onClick=${() => onChange(v)}>${l}</button>`)}</div>`;
      break;
    case 'fill':
      body = html`<input type="text" disabled=${dis} value=${value || ''} placeholder="Type the missing word" onChange=${e => onChange(e.target.value)} />`;
      break;
    case 'num':
      body = html`<input type="number" step="any" disabled=${dis} value=${value == null ? '' : value} placeholder="Enter a number" onChange=${e => onChange(e.target.value)} />`;
      break;
    case 'scramble':
      body = html`<div className="stack" style=${{ gap: 8 }}>
          <div className="letters">${(item.s || '').split('').map((c, i) => html`<span key=${i} className="letter">${c}</span>`)}</div>
          ${item.hint && html`<p className="muted small" style=${{ margin: 0 }}>Hint: ${item.hint}</p>`}
          <input type="text" disabled=${dis} value=${value || ''} placeholder="Your answer" onChange=${e => onChange(e.target.value)} />
        </div>`;
      break;
    case 'order': {
      const cur = Array.isArray(value) && value.length === item.o.length ? value : item.o.map(x => x.k);
      const byKey = Object.fromEntries(item.o.map(x => [x.k, x.t]));
      const move = (i, d) => {
        const n = [...cur];
        const j = i + d;
        if (j < 0 || j >= n.length) return;
        [n[i], n[j]] = [n[j], n[i]];
        onChange(n);
      };
      body = html`<ol className="orderlist">
          ${cur.map((k, i) => html`<li key=${k}><span className="onum">${i + 1}</span><span className="otext">${byKey[k]}</span>${!dis && html`<span className="actions"><button type="button" className="btn ghost icon sm" aria-label="Move up" disabled=${i === 0} onClick=${() => move(i, -1)}><${Icon} n="up" /></button><button type="button" className="btn ghost icon sm" aria-label="Move down" disabled=${i === cur.length - 1} onClick=${() => move(i, 1)}><${Icon} n="down" /></button></span>`}</li>`)}
        </ol>`;
      break;
    }
    case 'match': {
      const v = value || {};
      body = html`<div className="matchgrid">
          ${item.l.map((l, i) => html`<${Fragment} key=${i}><span className="mleft">${l}</span><select disabled=${dis} value=${v[i] == null ? '' : v[i]} onChange=${e => onChange({ ...v, [i]: e.target.value === '' ? null : Number(e.target.value) })}><option value="">Choose…</option>${item.r.map(r => html`<option key=${r.k} value=${r.k}>${r.t}</option>`)}</select><//>`)}
        </div>`;
      break;
    }
    default:
      body = null;
  }
  return html`<div className=${'qitem' + (result ? (ok ? ' right' : ' wrong') : '')}>
      <p className="qq"><span className="qn">${item.i + 1}</span>${item.q}</p>
      ${body}
      ${result && html`<div className=${'qres ' + (ok ? 'ok' : 'bad')}><b>${ok ? 'Correct.' : 'Not quite.'}</b> ${!ok && result.a ? html`<span>Answer: ${result.a}. </span>` : null}${result.why}</div>`}
    </div>`;
}
function LessonQuiz({ course, lesson, progress, onProgress }) {
  const toast = useToast();
  const [answers, setAnswers] = useState({});
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setAnswers({});
    setRes(null);
  }, [lesson.id]);
  const items = lesson.quiz || [];
  const prev = progress && progress.scores && progress.scores[lesson.id];
  const submit = async () => {
    const missing = items.filter(it => {
      const v = answers[it.i];
      return v == null || v === '' || (Array.isArray(v) && !v.length && it.ty === 'multi') || (it.ty === 'match' && Object.keys(v || {}).length < it.l.length);
    });
    if (missing.length) {
      toast(`Answer question${missing.length > 1 ? 's' : ''} ${missing.map(m => m.i + 1).join(', ')} first.`, true);
      return;
    }
    setBusy(true);
    try {
      const r = await api('learn_quiz', { course: course.id, lesson: lesson.id, answers });
      setRes(r);
      onProgress(r.progress);
      toast(r.passed ? `Passed with ${r.result.pct}%.` : `${r.result.pct}% — ${r.pass}% needed. Review the answers and try again.`, !r.passed);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const byI = res ? Object.fromEntries(res.result.items.map(x => [x.i, x])) : {};
  return html`<section className="quiz">
      <div className="ph-row"><h3 className="ph">${items.some(i => ['order', 'match', 'scramble'].includes(i.ty)) ? 'Puzzles & questions' : 'Check your understanding'}</h3>${prev && html`<span className=${'chip ' + (prev.pct >= course.pass ? 'ok' : 'amber')}>Best ${prev.pct}% · ${prev.n} attempt${prev.n === 1 ? '' : 's'}</span>`}</div>
      ${items.map(it => html`<${QuizItemView} key=${it.i} item=${it} value=${answers[it.i]} onChange=${v => setAnswers(a => ({ ...a, [it.i]: v }))} result=${byI[it.i]} />`)}
      <div className="actions">
        ${res ? html`<button type="button" className="btn ghost" onClick=${() => { setRes(null); setAnswers({}); }}>Try again</button>` : html`<button type="button" className="btn" disabled=${busy} onClick=${submit}>${busy ? 'Checking…' : 'Check my answers'}</button>`}
        ${res && html`<span className=${'chip ' + (res.passed ? 'ok' : 'red')}>${res.result.ok} of ${res.result.n} correct · ${res.result.pct}%${res.passed ? ' · lesson complete' : ` · need ${res.pass}%`}</span>`}
      </div>
    </section>`;
}
async function certificatePdf(cert, org) {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([842, 595]);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const navy = rgb(0.07, 0.16, 0.33);
  const teal = rgb(0.05, 0.49, 0.49);
  page.drawRectangle({ x: 0, y: 0, width: 842, height: 595, color: rgb(0.985, 0.98, 0.97) });
  page.drawRectangle({ x: 28, y: 28, width: 786, height: 539, borderColor: navy, borderWidth: 2 });
  page.drawRectangle({ x: 40, y: 40, width: 762, height: 515, borderColor: teal, borderWidth: 1 });
  const center = (t, y, size, f, color) => {
    const x = pdfSafe(t);
    page.drawText(x, { x: (842 - f.widthOfTextAtSize(x, size)) / 2, y, size, font: f, color: color || navy });
  };
  center(org.toUpperCase(), 500, 14, bold, teal);
  center('Certificate of completion', 440, 34, bold);
  center('This certifies that', 395, 14, font);
  center(cert.n || 'Participant', 355, 28, bold);
  center('has completed the course', 320, 14, font);
  const title = cert.t || '';
  center(title, 285, title.length > 48 ? 18 : 22, bold);
  center(`with an average score of ${cert.avg == null ? '—' : cert.avg + '%'} on ${new Date(cert.at).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })}`, 250, 13, font);
  page.drawLine({ start: { x: 300, y: 160 }, end: { x: 542, y: 160 }, thickness: 1, color: navy });
  center('Human Resources, ' + org, 145, 11, font);
  // v32: the public verification page (no login needed), with the number and code filled in
  center(`Certificate ${cert.no} · verification code ${cert.code} · verify at ${siteBase()}#/verify?no=${encodeURIComponent(cert.no)}&code=${encodeURIComponent(cert.code)}`, 70, 8, font, rgb(0.4, 0.4, 0.45));
  return pdf.save();
}
function CertificateButton({ uid, certId, label }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return html`<button type="button" className="btn ghost sm" disabled=${busy} onClick=${async () => {
    setBusy(true);
    try {
      const r = await api('learn_cert', { id: certId, ...(uid ? { uid } : {}) });
      // v32: a StratEdge certification (passed exam) has its own certificate design
      const bytes = r.cert.kind === 'prog' ? await exCertPdf(r.cert, r.org) : await certificatePdf(r.cert, r.org);
      await saveDownload(`certificate-${r.cert.no}.pdf`, new Blob([bytes], { type: 'application/pdf' }));
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  }}><${Icon} n="file" />${busy ? 'Preparing…' : label || 'Certificate (PDF)'}</button>`;
}
function CoursePlayer({ id, onBack }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [cur, setCur] = useState(null);
  useEffect(() => {
    setData(null);
    api('learn_course', { id }).then(
      d => {
        setData(d);
        const ids = d.course.mods.flatMap(m => m.ls.map(l => l.id));
        const next = ids.find(x => !(d.progress.done || {})[x]) || ids[0];
        setCur(next);
      },
      e => setErr(errText(e))
    );
  }, [id]);
  if (err && planLocked('learn')) return html`<div className="stack"><${PlanGate} feature="learn" /><div className="actions"><button className="btn ghost" onClick=${onBack}>Back to courses</button></div></div>`;
  if (err) return html`<div className="panel"><${Empty} title="Course not available">${err}<//><div className="actions" style=${{ marginTop: 12 }}><button className="btn ghost" onClick=${onBack}>Back to courses</button></div></div>`;
  if (!data) return html`<${Spinner} />`;
  const { course: c, progress: p } = data;
  const flat = c.mods.flatMap(m => m.ls.map(l => ({ ...l, mod: m })));
  const idx = Math.max(0, flat.findIndex(l => l.id === cur));
  const lesson = flat[idx];
  const done = p.done || {};
  const complete = !!p.completedAt;
  const markRead = async () => {
    try {
      const r = await api('learn_lesson_read', { course: c.id, lesson: lesson.id });
      setData(d => ({ ...d, progress: r.progress }));
      if (idx < flat.length - 1) setCur(flat[idx + 1].id);
    } catch (e) {
      toast(errText(e), true);
    }
  };
  return html`<div className="course">
      <aside className="couter">
        <button type="button" className="btn link sm" onClick=${onBack}><${Icon} n="left" />All courses</button>
        <h2 className="ph" style=${{ marginTop: 8 }}>${c.t}</h2>
        <div className="prog" style=${{ margin: '10px 0' }}><i style=${{ width: (p.pct || 0) + '%' }} /></div>
        <p className="muted small" style=${{ margin: '0 0 12px' }}>${p.pct || 0}% complete${c.pass ? ` · pass mark ${c.pass}%` : ''}</p>
        ${c.mods.map(
          m => html`<div key=${m.id} className="comod">
            <b>${m.t}</b>
            ${m.ls.map(l => html`<button key=${l.id} type="button" className=${'coles' + (l.id === cur ? ' on' : '') + (done[l.id] ? ' done' : '')} onClick=${() => setCur(l.id)}><${Icon} n=${done[l.id] ? 'check' : l.quiz && l.quiz.length ? 'flask' : 'file'} />${l.t}</button>`)}
          </div>`
        )}
      </aside>
      <div className="comain">
        ${
          complete &&
          html`<div className="note ok"><span><b>Course complete.</b> ${p.avg != null ? `Average score ${p.avg}%.` : ''} ${p.cert ? 'Your certificate is ready.' : ''}</span>${p.cert && html`<div className="actions"><${CertificateButton} certId=${p.cert} /></div>`}</div>`
        }
        ${
          lesson &&
          html`<article className="panel lesson">
            <p className="crumb">${lesson.mod.t} · Lesson ${idx + 1} of ${flat.length}</p>
            <div className="ph-row" style=${{ margin: 0, alignItems: 'flex-start' }}><h2>${lesson.t}</h2><${ReadAloudButton} key=${lesson.id} text=${lesson.t + '. ' + (lesson.body || '')} /></div>
            <${MdLite} text=${lesson.body} />
            ${
              lesson.quiz && lesson.quiz.length
                ? html`<${LessonQuiz} course=${c} lesson=${lesson} progress=${p} onProgress=${np => setData(d => ({ ...d, progress: np }))} />`
                : html`<div className="actions" style=${{ marginTop: 18 }}>${done[lesson.id] ? html`<span className="chip ok">Read</span>` : html`<button type="button" className="btn" onClick=${markRead}><${Icon} n="check" />Mark as read${idx < flat.length - 1 ? ' and continue' : ''}</button>`}</div>`
            }
            <div className="actions" style=${{ marginTop: 18, justifyContent: 'space-between' }}>
              <button type="button" className="btn ghost" disabled=${idx === 0} onClick=${() => setCur(flat[idx - 1].id)}><${Icon} n="left" />Previous</button>
              <button type="button" className="btn ghost" disabled=${idx >= flat.length - 1} onClick=${() => setCur(flat[idx + 1].id)}>Next<${Icon} n="right" /></button>
            </div>
          </article>`
        }
      </div>
    </div>`;
}
function VerifyCertificate() {
  const [no, setNo] = useState('');
  const [code, setCode] = useState('');
  const [res, setRes] = useState(null);
  const toast = useToast();
  return html`<section className="panel">
      <h2 className="ph">Verify a certificate</h2>
      <p className="muted small">Enter the certificate number and the verification code printed on the PDF.</p>
      <div className="form"><div className="row3">
        <${Field} label="Certificate number"><input value=${no} onChange=${e => setNo(e.target.value)} placeholder="SE-2026-0001" /><//>
        <${Field} label="Verification code"><input value=${code} onChange=${e => setCode(e.target.value)} /><//>
        <div className="actions" style=${{ alignSelf: 'end' }}><button type="button" className="btn ghost" onClick=${async () => { try { setRes(await api('learn_cert_verify', { no, code })); } catch (e) { toast(errText(e), true); } }}>Check</button></div>
      </div></div>
      ${res && html`<div className=${'note ' + (res.valid ? (res.expired ? 'amber' : 'ok') : 'red')} style=${{ marginTop: 12 }}><span>${res.valid ? html`<b>${res.expired ? 'Valid, but expired.' : 'Valid.'}</b> ${res.n} ${res.kind === 'prog' ? html`holds "${res.t}"${res.level ? ' (' + res.level + ')' : ''}, issued` : html`completed "${res.t}" on`} ${fmtDay(res.at)} (${res.no}).` : html`<b>Not found.</b> Check the number and code.`}</span></div>`}
      <p className="muted small" style=${{ margin: '10px 0 0' }}>Anyone can check a certificate without logging in at <a href="#/verify" target="_blank" rel="noopener">${siteBase()}#/verify</a>.</p>
    </section>`;
}
function LearnPage({ q }) {
  const P = usePortal();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState('courses');
  const courseId = q && q.c;
  const load = () => api('learn_catalog').then(setData, e => setErr(errText(e)));
  useEffect(() => {
    if (!courseId) load();
  }, [courseId]);
  if (courseId) return html`<${CoursePlayer} id=${courseId} onBack=${() => { location.hash = growHref(P, 'learn'); }} />`;
  if (q && q.verify) return html`<div className="stack"><${VerifyCertificate} /><div className="actions"><a className="btn ghost" href=${growHref(P, 'learn')}>Back to courses</a></div></div>`;
  if (err) return html`<div className="panel"><${Empty} title="Could not load the courses">${err}<//></div>`;
  if (!data) return html`<${Spinner} />`;
  const courses = data.courses;
  const required = courses.filter(c => c.req && !c.completedAt);
  const done = courses.filter(c => c.completedAt);
  const inProgress = courses.filter(c => c.started && !c.completedAt);
  const card = c => html`<a key=${c.id} className="cocard" href=${growHref(P, 'learn?c=' + encodeURIComponent(c.id))}>
      <div className="cohead"><span className="rulecat">${c.cat || 'Course'}</span>${c.req && html`<span className=${'chip ' + (c.completedAt ? 'ok' : 'amber')}>${c.completedAt ? 'Completed' : 'Required'}</span>`}${c.cert && html`<span className="chip info">Certificate</span>`}</div>
      <b>${c.t}</b>
      <p>${c.desc}</p>
      <div className="cometa muted small">${c.shape.modules} module${c.shape.modules === 1 ? '' : 's'} · ${c.shape.lessons} lessons · ${c.shape.quizzes} questions${c.min ? ` · about ${c.min} min` : ''}${c.level ? ` · ${c.level}` : ''}</div>
      <div className="prog"><i style=${{ width: (c.pct || 0) + '%' }} /></div>
      <span className="cogo">${c.completedAt ? 'Review' : c.started ? `Continue · ${c.pct}%` : 'Start'} <${Icon} n="right" /></span>
    </a>`;
  return html`<div className="stack learn">
      <${PlanNote} feature="learn" />
      <${KitStats} items=${[
        { v: courses.length, l: 'Courses available' },
        { v: required.length, l: 'Required, not finished', tone: required.length ? 'warn' : '' },
        { v: inProgress.length, l: 'In progress' },
        { v: data.certs.length, l: 'Certificates earned', tone: data.certs.length ? 'ok' : '' },
      ]} />
      ${!P.staffView && html`<div className="note info">
        <span><b>StratEdge certifications.</b> Pass a timed exam to earn a certification clients can verify, and add it to your LinkedIn profile. A few minutes of daily practice keeps you ready.</span>
        <div className="actions"><a className="btn sm" href=${growHref(P, 'certify')}><${Icon} n="flag" />Certifications</a><a className="btn ghost sm" href=${growHref(P, 'tests')}><${Icon} n="target" />Daily & weekly tests</a></div>
      </div>`}
      <${KitTabs} tab=${tab} onTab=${setTab} tabs=${[['courses', 'Courses'], ['certs', 'My certificates', data.certs.length || null]]} />
      ${
        tab === 'courses' &&
        html`<div className="stack">
          ${required.length ? html`<div className="note amber"><span><b>${required.length} required course${required.length === 1 ? '' : 's'}</b> to complete: ${required.map(c => c.t).join(', ')}.</span></div>` : null}
          <div className="cogrid">${courses.map(card)}</div>
        </div>`
      }
      ${
        tab === 'certs' &&
        html`<div className="stack">
          <section className="panel" style=${{ padding: '6px 8px' }}>
            ${
              data.certs.length
                ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Certificate</th><th>Course</th><th>Date</th><th>Score</th><th className="r"><span className="sr">Download</span></th></tr></thead><tbody>
                    ${data.certs.map(x => html`<tr key=${x.id}><td><b>${x.no}</b></td><td>${x.t}</td><td>${fmtDay(x.at)}</td><td>${x.avg != null ? x.avg + '%' : '—'}</td><td className="r"><${CertificateButton} certId=${x.id} /></td></tr>`)}
                  </tbody></table></div>`
                : html`<${Empty} title="No certificates yet">Finish a course marked "Certificate" to earn one.${done.length ? '' : ' Required courses are a good place to start.'}<//>`
            }
          </section>
          <${VerifyCertificate} />
        </div>`
      }
    </div>`;
}

/* ================= Live projects ================= */
const PROJ_ST = { planned: ['Planned', ''], active: ['In progress', 'new'], paused: ['Paused', 'amber'], done: ['Done', 'ok'] };
function projProgress(p) {
  let n = 0;
  (p.milestones || []).forEach(m => (n += (m.tasks || []).length));
  const d = Object.keys(p.done || {}).length;
  return { n, d, pct: n ? Math.round((d * 100) / n) : 0 };
}
/* IT briefs talk about features and architecture; healthcare and business briefs about deliverables and the approach. */
const PROJ_TRACKS = {
  it: { n: 'IT & software', feat: 'Features to build', arch: 'Architecture', data: 'Data', nfr: 'Non-functional requirements', stack: 'Preferred stack', stackPh: 'e.g. React + Node + PostgreSQL on Azure', rolePh: 'e.g. Senior Java developer', skillsPh: 'Java, Spring Boot, Kafka, AWS…', domPh: 'healthcare, logistics, fintech, insurance…' },
  health: { n: 'Healthcare', feat: 'Deliverables', arch: 'Approach and workstreams', data: 'Data and records (synthetic)', nfr: 'Standards and constraints', stack: 'Tools and systems you use (optional)', stackPh: 'e.g. Epic, Excel, encoder, Power BI', rolePh: 'e.g. Medical coder, RN, billing specialist, practice manager', skillsPh: 'ICD-10, CPT, HIPAA, Epic, quality improvement…', domPh: 'coding, revenue cycle, nursing quality, pharmacy, patient access…' },
  biz: { n: 'Business & other (non-IT)', feat: 'Deliverables', arch: 'Approach and workstreams', data: 'Data and records (synthetic)', nfr: 'Standards and constraints', stack: 'Tools you use (optional)', stackPh: 'e.g. Excel, QuickBooks, HubSpot, Power BI', rolePh: 'e.g. Staff accountant, HR generalist, recruiter, marketing coordinator', skillsPh: 'GAAP, reconciliations, onboarding, SEO, forecasting…', domPh: 'accounting, HR, marketing, sales, supply chain, project management…' },
};
const projTrackOf = b => PROJ_TRACKS[(b && b.track) || 'it'] || PROJ_TRACKS.it;
function BriefView({ b, children }) {
  const T = projTrackOf(b);
  const List = ({ t, items, ordered }) =>
    items && items.length
      ? html`<section><h3>${t}</h3>${ordered ? html`<ol>${items.map((x, i) => html`<li key=${i}>${x}</li>`)}</ol>` : html`<ul>${items.map((x, i) => html`<li key=${i}>${x}</li>`)}</ul>`}</section>`
      : null;
  return html`<div className="brief">
      <div className="chips">${(b.stack || []).map(s => html`<span key=${s} className="tag">${s}</span>`)}${b.domain && html`<span className="chip">${b.domain}</span>`}${b.hours && html`<span className="chip">${b.hours} h · ${b.weeks || Math.ceil(b.hours / 10)} weeks</span>`}${b.src && html`<span className="chip info">${b.src === 'ai' ? 'AI-generated' : b.src === 'template' ? 'From a template' : b.src === 'catalog' ? 'From the catalog' : 'Custom'}</span>`}</div>
      ${b.summary && html`<p className="lead">${b.summary}</p>`}
      ${b.problem && html`<section><h3>The client's problem</h3><p>${b.problem}</p></section>`}
      <${List} t="Users" items=${b.users} />
      <${List} t=${T.feat} items=${b.features} />
      ${b.arch && (b.arch.overview || (b.arch.components || []).length) && html`<section><h3>${T.arch}</h3>${b.arch.overview && html`<p>${b.arch.overview}</p>`}<ul>${(b.arch.components || []).map((x, i) => html`<li key=${i}>${x}</li>`)}</ul>${(b.arch.data || []).length ? html`<p><b>${T.data}:</b> ${b.arch.data.join('; ')}</p>` : null}</section>`}
      <${List} t=${T.nfr} items=${b.nfr} />
      <${List} t="Acceptance criteria" items=${b.accept} />
      ${children}
      <${List} t="Stretch goals" items=${b.stretch} />
      <${List} t="Questions an interviewer will ask" items=${b.talk} ordered />
      <${List} t="Resume bullets (adapt once it is done)" items=${b.resume} />
    </div>`;
}
function ProjectDetail({ id, uid, onBack }) {
  const P = usePortal();
  const toast = useToast();
  const path = `proj/${uid}/items/${id}`;
  const doc = useDoc(path);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState({ t: '', u: '' });
  if (doc.loading) return html`<${Spinner} />`;
  if (!doc.exists) return html`<div className="panel"><${Empty} title="Project not found"><//><div className="actions" style=${{ marginTop: 12 }}><button className="btn ghost" onClick=${onBack}>Back</button></div></div>`;
  const p = doc.data;
  const pr = projProgress(p);
  const save = async patch => {
    setBusy(true);
    try {
      await api('proj_save', { item: { ...p, ...patch, id }, ...(uid !== P.uid ? { uid } : {}) });
      Sync.kick(0);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const toggleTask = (mi, ti) => {
    const k = mi + '.' + ti;
    const done = { ...(p.done || {}) };
    if (done[k]) delete done[k];
    else done[k] = Date.now();
    const allDone = pr.n > 0 && Object.keys(done).length >= pr.n;
    save({ done, st: allDone ? 'done' : p.st === 'planned' ? 'active' : p.st });
  };
  const addToVault = async () => {
    setBusy(true);
    try {
      const vid = p.vault || rid8();
      await Cap.db.doc(`pv/${uid}/items/${vid}`).set({ t: p.t, client: 'Practice engagement (live project)', role: 'Developer / owner', from: p.at ? dkey(new Date(p.at)) : dkey(), to: p.finished ? dkey(new Date(p.finished)) : '', stack: p.stack || [], summary: p.summary || '', outcome: (p.resume || []).join('\n'), tags: ['live-project', p.domain || ''].filter(Boolean), share: false, proj: id, at: Date.now(), u: Date.now() });
      await api('proj_save', { item: { ...p, id, vault: vid }, ...(uid !== P.uid ? { uid } : {}) });
      Sync.kick(0);
      toast('Added to your vault. Attach files there.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const [stLabel, stTone] = PROJ_ST[p.st] || PROJ_ST.planned;
  return html`<div className="stack">
      <div className="ph-row">
        <div>
          <button type="button" className="btn link sm" onClick=${onBack}><${Icon} n="left" />My projects</button>
          <h2 className="ph" style=${{ marginTop: 6 }}>${p.t}</h2>
        </div>
        <div className="actions">
          <select value=${p.st || 'planned'} onChange=${e => save({ st: e.target.value })} aria-label="Status">${Object.entries(PROJ_ST).map(([k, [l]]) => html`<option key=${k} value=${k}>${l}</option>`)}</select>
          ${p.vault ? html`<a className="btn ghost" href=${growHref(P, 'vault')}>Open in vault</a>` : html`<button type="button" className="btn ghost" disabled=${busy} onClick=${addToVault}><${Icon} n="folder" />Add to vault</button>`}
        </div>
      </div>
      <${KitStats} items=${[{ v: pr.pct + '%', l: `${pr.d} of ${pr.n} tasks done` }, { v: stLabel, l: 'Status', tone: stTone === 'ok' ? 'ok' : '' }, { v: (p.milestones || []).length, l: 'Milestones' }, { v: p.hours || '—', l: 'Planned hours' }]} />
      <section className="panel">
        <${BriefView} b=${p}>
          <section>
            <h3>Milestones</h3>
            ${(p.milestones || []).map(
              (m, mi) => html`<div key=${mi} className="milestone">
                <div className="ph-row"><b>${m.t}</b><span className="chip">${m.d} days</span></div>
                ${(m.tasks || []).map((t, ti) => html`<label key=${ti} className="check"><input type="checkbox" checked=${!!(p.done || {})[mi + '.' + ti]} disabled=${busy} onChange=${() => toggleTask(mi, ti)} /> <span className=${(p.done || {})[mi + '.' + ti] ? 'muted' : ''}>${t}</span></label>`)}
              </div>`
            )}
          </section>
        <//>
      </section>
      <section className="panel">
        <h3 className="ph">Links and notes</h3>
        <div className="form" style=${{ marginTop: 10 }}>
          ${(p.links || []).length ? html`<ul className="linklist">${p.links.map((l, i) => html`<li key=${i}><a href=${l.u} target="_blank" rel="noopener">${l.t || l.u}</a> <button type="button" className="btn ghost icon sm" aria-label="Remove" onClick=${() => save({ links: p.links.filter((_, j) => j !== i) })}><${Icon} n="x" /></button></li>`)}</ul>` : null}
          <div className="row3" style=${{ alignItems: 'end' }}>
            <${Field} label="Link title"><input value=${link.t} onChange=${e => setLink({ ...link, t: e.target.value })} placeholder="Repository, demo, write-up" /><//>
            <${Field} label="URL"><input value=${link.u} onChange=${e => setLink({ ...link, u: e.target.value })} placeholder="https://" /><//>
            <div className="actions"><button type="button" className="btn ghost" disabled=${!/^https?:\/\//.test(link.u)} onClick=${() => { save({ links: [...(p.links || []), link] }); setLink({ t: '', u: '' }); }}>Add link</button></div>
          </div>
          <${Field} label="Notes (decisions, what you learned, what you would do differently)"><textarea rows="4" defaultValue=${p.notes || ''} onBlur=${e => e.target.value !== (p.notes || '') && save({ notes: e.target.value })} /><//>
        </div>
      </section>
    </div>`;
}
const rid8 = () => Math.random().toString(36).slice(2, 10);
function ProjectWizard({ onSaved }) {
  const P = usePortal();
  const toast = useToast();
  const prof = P.prof || {};
  const [f, setF] = useState({ track: 'it', role: prof.ti || '', skills: Array.isArray(prof.skills) ? prof.skills.join(', ') : prof.skills || '', stack: '', level: 'mid', domain: '', hours: 60, goal: 'interview readiness' });
  const TW = PROJ_TRACKS[f.track] || PROJ_TRACKS.it;
  const [brief, setBrief] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [used, setUsed] = useState([]);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const gen = async template => {
    setBusy(true);
    try {
      const r = await api('proj_generate', { ...f, template: !!template, used });
      setBrief(r.brief);
      setNote(r.note || '');
      if (r.brief.tag && r.brief.tag !== 'ai') setUsed(u => [...u, r.brief.tag]);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const save = async () => {
    setBusy(true);
    try {
      const r = await api('proj_save', { item: { ...brief, st: 'active' } });
      toast('Project saved. Tick the tasks as you go.');
      onSaved(r.id);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<div className="stack">
      <section className="panel">
        <h2 className="ph">Create a live project</h2>
        <p className="muted small">Describe the role you are aiming for; the assistant writes a realistic client brief - problem, users, features, architecture, milestones, acceptance criteria, interview questions and resume bullets. Without an assistant configured, a built-in template is adapted to your stack.</p>
        <div className="form" style=${{ marginTop: 12 }}>
          <${Field} label="Field">
            <div className="seg" role="tablist">${Object.entries(PROJ_TRACKS).map(([k, t]) => html`<button key=${k} type="button" role="tab" aria-selected=${f.track === k} className=${f.track === k ? 'on' : ''} onClick=${() => { set('track', k); setUsed([]); }}>${t.n}</button>`)}</div>
          <//>
          <div className="row2">
            <${Field} label="Target role"><input value=${f.role} onChange=${e => set('role', e.target.value)} placeholder=${TW.rolePh} /><//>
            <${Field} label="Your skills"><input value=${f.skills} onChange=${e => set('skills', e.target.value)} placeholder=${TW.skillsPh} /><//>
          </div>
          <div className="row3">
            <${Field} label=${TW.stack}><input value=${f.stack} onChange=${e => set('stack', e.target.value)} placeholder=${TW.stackPh} /><//>
            <${Field} label="Level"><select value=${f.level} onChange=${e => set('level', e.target.value)}><option value="junior">Junior</option><option value="mid">Mid-level</option><option value="senior">Senior</option><option value="lead">Lead / architect</option></select><//>
            <${Field} label="Hours you can invest"><input type="number" min="10" max="400" value=${f.hours} onChange=${e => set('hours', e.target.value)} /><//>
          </div>
          <div className="row2">
            <${Field} label="Industry or area (optional)"><input value=${f.domain} onChange=${e => set('domain', e.target.value)} placeholder=${TW.domPh} /><//>
            <${Field} label="Goal"><input value=${f.goal} onChange=${e => set('goal', e.target.value)} placeholder="interview readiness, learn Kafka, portfolio piece…" /><//>
          </div>
          <div className="actions">
            <button type="button" className="btn" disabled=${busy} onClick=${() => gen(false)}><${Icon} n="spark" />${busy ? 'Working…' : brief ? 'Generate another' : 'Generate my project'}</button>
            <button type="button" className="btn ghost" disabled=${busy} onClick=${() => gen(true)}>Use a built-in template</button>
          </div>
        </div>
      </section>
      ${
        brief &&
        html`<section className="panel">
          ${note && html`<div className="note amber" style=${{ marginBottom: 12 }}><span>${note}</span></div>`}
          <div className="ph-row"><h2 className="ph">${brief.t}</h2><div className="actions"><button type="button" className="btn" disabled=${busy} onClick=${save}><${Icon} n="check" />Save and start</button></div></div>
          <${BriefView} b=${brief}>
            <section><h3>Milestones</h3><ol>${(brief.milestones || []).map((m, i) => html`<li key=${i}><b>${m.t}</b> <span className="muted small">(${m.d} days)</span><ul>${(m.tasks || []).map((t, j) => html`<li key=${j}>${t}</li>`)}</ul></li>`)}</ol></section>
          <//>
        </section>`
      }
    </div>`;
}
function ProjectsPage({ q }) {
  const P = usePortal();
  const toast = useToast();
  const [tab, setTab] = useState((q && q.tab) || 'mine');
  const mine = useCol(`proj/${P.uid}/items`, 'u:desc');
  const [catalog, setCatalog] = useState(null);
  const [catField, setCatField] = useState('');
  const [view, setView] = useState(null);
  const pid = q && q.p;
  useEffect(() => {
    if (tab === 'catalog' && !catalog) api('proj_catalog').then(r => setCatalog(r.items), e => toast(errText(e), true));
  }, [tab]);
  if (pid) return html`<${ProjectDetail} id=${pid} uid=${P.uid} onBack=${() => { location.hash = growHref(P, 'projects'); }} />`;
  const open = id => { location.hash = growHref(P, 'projects?p=' + encodeURIComponent(id)); };
  const startCatalog = async it => {
    try {
      const full = (await api('proj_catalog_item', { id: it.id })).item;
      const r = await api('proj_save', { item: { ...full, src: 'catalog', catalog: it.id, st: 'active', done: {} } });
      toast('Project added to yours.');
      open(r.id);
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const active = mine.docs.filter(p => p.st !== 'done').length;
  const done = mine.docs.filter(p => p.st === 'done').length;
  return html`<div className="stack projects">
      <${PlanNote} feature="projects" />
      <${KitStats} items=${[{ v: mine.docs.length, l: 'My projects' }, { v: active, l: 'In progress' }, { v: done, l: 'Completed', tone: done ? 'ok' : '' }, { v: mine.docs.reduce((a, p) => a + (p.hours || 0), 0), l: 'Hours planned' }]} />
      <${KitTabs} tab=${tab} onTab=${setTab} tabs=${[['mine', 'My projects', mine.docs.length || null], ['new', 'Create with AI'], ['catalog', 'Catalog']]} />
      ${
        tab === 'mine' &&
        (mine.loading
          ? html`<${Spinner} />`
          : mine.docs.length
            ? html`<div className="cogrid">
                ${mine.docs.map(p => {
                  const pr = projProgress(p);
                  const [l, tone] = PROJ_ST[p.st] || PROJ_ST.planned;
                  return html`<a key=${p.id} className="cocard" href=${growHref(P, 'projects?p=' + encodeURIComponent(p.id))}>
                    <div className="cohead"><span className="rulecat">${p.domain || 'Project'}</span><span className=${'chip ' + tone}>${l}</span></div>
                    <b>${p.t}</b>
                    <p>${p.summary}</p>
                    <div className="chips">${(p.stack || []).slice(0, 5).map(s => html`<span key=${s} className="tag">${s}</span>`)}</div>
                    <div className="prog"><i style=${{ width: pr.pct + '%' }} /></div>
                    <span className="cogo">${pr.d} of ${pr.n} tasks <${Icon} n="right" /></span>
                  </a>`;
                })}
              </div>`
            : html`<div className="panel"><${Empty} title="No live projects yet" action=${html`<button className="btn" onClick=${() => setTab('new')}><${Icon} n="spark" />Create one with AI</button>`}>A live project is a realistic client brief you build end to end - the best interview material there is.<//></div>`)
      }
      ${tab === 'new' && html`<${ProjectWizard} onSaved=${id => open(id)} />`}
      ${
        tab === 'catalog' &&
        (!catalog
          ? html`<${Spinner} />`
          : catalog.length
            ? html`${catalog.some(it => (it.track || 'it') !== 'it') && html`<div className="seg" role="tablist" style=${{ marginBottom: 12 }}>${[['', 'All fields'], ...Object.entries(PROJ_TRACKS).map(([k, t]) => [k, t.n])].map(([k, n]) => html`<button key=${k || 'all'} type="button" role="tab" aria-selected=${catField === k} className=${catField === k ? 'on' : ''} onClick=${() => setCatField(k)}>${n}</button>`)}</div>`}<div className="cogrid">
                ${catalog.filter(it => !catField || (it.track || 'it') === catField).map(it => html`<div key=${it.id} className="cocard static">
                  <div className="cohead"><span className="rulecat">${it.domain || 'Project'}</span>${(it.track || 'it') !== 'it' && html`<span className="chip info">${projTrackOf(it).n}</span>`}${it.level && html`<span className="chip">${it.level}</span>`}</div>
                  <b>${it.t}</b>
                  <p>${it.summary}</p>
                  <div className="chips">${(it.stack || []).slice(0, 5).map(s => html`<span key=${s} className="tag">${s}</span>`)}</div>
                  <div className="actions"><button type="button" className="btn sm" onClick=${() => startCatalog(it)}>Start this project</button>${it.hours && html`<span className="muted small">${it.hours} h</span>`}</div>
                </div>`)}
              </div>`
            : html`<div className="panel"><${Empty} title="The catalog is empty">${P.isAdmin || (P.roles || []).includes('hr') ? 'Publish projects under Admin › Learning › Project catalog. Meanwhile, anyone can create one with AI.' : 'No published projects yet. Create your own with AI from the "My projects" tab.'}<//></div>`)
      }
    </div>`;
}

/* ================= Project vault ================= */
function VaultItemModal({ item, uid, onClose }) {
  const toast = useToast();
  const isNew = !item.id;
  const id = item.id || rid8();
  const path = `pv/${uid}/items/${id}`;
  const [f, setF] = useState({ t: '', client: '', role: '', from: '', to: '', stack: [], summary: '', outcome: '', tags: [], share: false, ...item, stack: (item.stack || []).join(', '), tags: (item.tags || []).join(', ') });
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(0);
  const files = useCol(isNew ? null : `${path}/f`, 'at:desc');
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const data = () => ({ t: f.t.trim(), client: f.client, role: f.role, from: f.from, to: f.to, stack: f.stack.split(',').map(s => s.trim()).filter(Boolean).slice(0, 20), summary: f.summary, outcome: f.outcome, tags: f.tags.split(',').map(s => s.trim()).filter(Boolean).slice(0, 12), share: !!f.share, proj: item.proj || '', links: item.links || [], at: item.at || Date.now(), u: Date.now() });
  const save = async close => {
    if (!f.t.trim()) {
      toast('Give the entry a title.', true);
      return;
    }
    setBusy(true);
    try {
      await Cap.db.doc(path).set(data());
      toast('Saved.');
      if (close) onClose();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const onFiles = async fs => {
    if (isNew) {
      await save(false);
    }
    setBusy(true);
    try {
      for (const file of fs) {
        setProg(0.03);
        await storeFile(path, file, {}, setProg);
      }
      toast('File added.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<${Modal} title=${isNew ? 'New vault entry' : f.t} onClose=${onClose} wide foot=${html`<button className="btn ghost" onClick=${onClose}>Close</button><button className="btn" disabled=${busy} onClick=${() => save(true)}>${busy ? 'Saving…' : 'Save'}</button>`}>
      <div className="form">
        <${Field} label="Title"><input value=${f.t} onChange=${e => set('t', e.target.value)} placeholder="Project, engagement, certification or course" /><//>
        <div className="row3">
          <${Field} label="Client or context"><input value=${f.client} onChange=${e => set('client', e.target.value)} placeholder="Industry or 'Practice engagement' - no confidential names" /><//>
          <${Field} label="Your role"><input value=${f.role} onChange=${e => set('role', e.target.value)} /><//>
          <${Field} label="Stack (comma separated)"><input value=${f.stack} onChange=${e => set('stack', e.target.value)} /><//>
        </div>
        <div className="row3">
          <${Field} label="From"><input type="date" value=${f.from} onChange=${e => set('from', e.target.value)} /><//>
          <${Field} label="To"><input type="date" value=${f.to} onChange=${e => set('to', e.target.value)} /><//>
          <${Field} label="Tags (comma separated)"><input value=${f.tags} onChange=${e => set('tags', e.target.value)} placeholder="microservices, migration, lead" /><//>
        </div>
        <${Field} label="What you built and how"><textarea rows="4" value=${f.summary} onChange=${e => set('summary', e.target.value)} /><//>
        <${Field} label="Outcome, with numbers (one line per bullet)" hint="These become your resume bullets."><textarea rows="3" value=${f.outcome} onChange=${e => set('outcome', e.target.value)} /><//>
        <label className="check"><input type="checkbox" checked=${!!f.share} onChange=${e => set('share', e.target.checked)} /> Share with StratEdge recruiters for submissions and profile requests (otherwise only you and HR see it)</label>
        <div className="panel" style=${{ padding: 14 }}>
          <b>Files</b>
          <p className="muted small" style=${{ marginTop: 4 }}>Sanitized screenshots, diagrams, certificates, write-ups, zipped code of your own. Never client code, data or confidential documents.</p>
          ${!isNew && files.docs.length ? html`<ul className="linklist">${files.docs.map(x => html`<li key=${x.id}><a href=${fileUrl(path, x.id)} target="_blank" rel="noopener">${x.n}</a> <span className="muted small">${sizeLabel(x.sz)}</span> <button type="button" className="btn ghost icon sm" aria-label="Delete file" onClick=${async () => { try { await deleteStored(path, x.id); } catch (e) { toast(errText(e), true); } }}><${Icon} n="trash" /></button></li>`)}</ul>` : null}
          <${FilePick} busy=${busy} progress=${prog} onFiles=${onFiles} label=${isNew ? 'Save and add files' : 'Add files'} />
        </div>
      </div>
    <//>`;
}
function VaultPage() {
  const P = usePortal();
  const toast = useToast();
  const items = useCol(`pv/${P.uid}/items`, 'u:desc');
  const [edit, setEdit] = useState(null);
  const copyBullets = () => {
    const lines = items.docs.flatMap(i => [`${i.t}${i.role ? ' — ' + i.role : ''}${i.from ? ` (${i.from}${i.to ? ' to ' + i.to : ' to present'})` : ''}`, ...(i.outcome || '').split('\n').filter(Boolean).map(l => '  • ' + l.trim()), (i.stack || []).length ? '  Stack: ' + i.stack.join(', ') : '', '']);
    const text = lines.join('\n');
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('Resume bullets copied.'));
    else toast(text);
  };
  const del = async i => {
    if (!confirm(`Delete "${i.t}" and its files?`)) return;
    try {
      for (const f of await dbList(`pv/${P.uid}/items/${i.id}/f`)) await deleteStored(`pv/${P.uid}/items/${i.id}`, f.id);
      await Cap.db.doc(`pv/${P.uid}/items/${i.id}`).delete();
      toast('Deleted.');
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const shared = items.docs.filter(i => i.share).length;
  return html`<div className="stack vault">
      <${KitStats} items=${[{ v: items.docs.length, l: 'Entries' }, { v: shared, l: 'Shared with recruiters' }, { v: items.docs.filter(i => i.proj).length, l: 'From live projects' }, { v: [...new Set(items.docs.flatMap(i => i.stack || []))].length, l: 'Technologies' }]} />
      <div className="ph-row">
        <p className="muted small" style=${{ margin: 0 }}>Evidence of your work: summaries, outcomes with numbers, sanitized files and links. Only you and HR see it unless you share an entry with recruiters.</p>
        <div className="actions"><button type="button" className="btn ghost" disabled=${!items.docs.length} onClick=${copyBullets}><${Icon} n="file" />Copy resume bullets</button><button type="button" className="btn" onClick=${() => setEdit({})}><${Icon} n="plus" />New entry</button></div>
      </div>
      ${
        items.loading
          ? html`<${Spinner} />`
          : items.docs.length
            ? html`<div className="cogrid">
                ${items.docs.map(i => html`<div key=${i.id} className="cocard static">
                  <div className="cohead"><span className="rulecat">${i.client || 'Project'}</span>${i.share ? html`<span className="chip ok">Shared</span>` : html`<span className="chip">Private</span>`}</div>
                  <b>${i.t}</b>
                  <p className="muted small">${[i.role, i.from && (i.from + (i.to ? ' – ' + i.to : ' – present'))].filter(Boolean).join(' · ')}</p>
                  <p>${i.summary}</p>
                  <div className="chips">${(i.stack || []).slice(0, 6).map(s => html`<span key=${s} className="tag">${s}</span>`)}</div>
                  <div className="actions"><button type="button" className="btn sm ghost" onClick=${() => setEdit(i)}><${Icon} n="pen" />Edit & files</button><button type="button" className="btn sm ghost" onClick=${() => del(i)}>Delete</button></div>
                </div>`)}
              </div>`
            : html`<div className="panel"><${Empty} title="Your vault is empty" action=${html`<button className="btn" onClick=${() => setEdit({})}>Add your first entry</button>`}>Add past engagements, certifications and finished live projects. Recruiters use shared entries in submissions.<//></div>`
      }
      ${edit && html`<${VaultItemModal} item=${edit} uid=${P.uid} onClose=${() => setEdit(null)} />`}
    </div>`;
}

/* ================= v53: live USCIS & immigration intelligence ================= */
function ImmigrationLivePage() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [src, setSrc] = useState('all');
  const [topic, setTopic] = useState('all');
  const [find, setFind] = useState('');
  const load = async refresh => {
    setBusy(true);
    setErr('');
    try {
      const r = await api('immnews_feed', refresh ? { refresh: true } : {}, { timeout: 70000 });
      setD(r);
      if (refresh) toast(r.stale ? 'Showing the last official-source snapshot.' : 'Official immigration sources refreshed.');
    } catch (e) {
      setErr(errText(e));
    }
    setBusy(false);
  };
  useEffect(() => {
    load(false);
  }, []);
  const items = d && Array.isArray(d.items) ? d.items : [];
  const lower = find.trim().toLowerCase();
  const passTopic = x => {
    const tags = x.tags || [];
    if (topic === 'all') return true;
    if (topic === 'h1b') return tags.includes('h1b') || tags.includes('h4') || tags.includes('employer');
    if (topic === 'student') return tags.includes('f1') || tags.includes('opt') || tags.includes('ead');
    if (topic === 'green') return tags.includes('greencard');
    if (topic === 'work') return tags.includes('i9') || tags.includes('ead') || tags.includes('employer');
    if (topic === 'humanitarian') return tags.includes('tps') || tags.includes('asylum');
    if (topic === 'forms') return tags.includes('forms') || tags.includes('fees');
    return true;
  };
  const shown = items.filter(x => {
    const sourceOk =
      src === 'all' ||
      (src === 'uscis' && String(x.source || '').toLowerCase().includes('uscis')) ||
      (src === 'dos' && String(x.source || '').toLowerCase().includes('state')) ||
      (src === 'fr' && String(x.url || '').includes('federalregister.gov'));
    if (!sourceOk || !passTopic(x)) return false;
    if (!lower) return true;
    return `${x.title || ''} ${x.summary || ''} ${x.source || ''} ${(x.tags || []).join(' ')}`.toLowerCase().includes(lower);
  });
  const when = x => {
    if (!x) return '';
    const dt = new Date(x);
    if (Number.isNaN(dt.getTime())) return String(x).slice(0, 10);
    return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };
  const asof = d && d.asOf ? new Date(d.asOf) : null;
  return html`<div className="stack immnews">
    <section className="panel immnews-hero">
      <div className="ph-row">
        <div>
          <div className="eyebrow">Official-source intelligence</div>
          <h2 className="ph" style=${{ marginBottom: 4 }}>USCIS & immigration live updates</h2>
          <p className="muted" style=${{ margin: 0 }}>Current USCIS News & Alerts, the Department of State Visa Bulletin, and immigration-related Federal Register notices. StratEdge AI uses this same official-source snapshot when you ask immigration questions.</p>
        </div>
        <button type="button" className="btn ghost" disabled=${busy} onClick=${() => load(true)}><${Icon} n="refresh" />${busy ? 'Refreshing…' : 'Refresh live sources'}</button>
      </div>
      <div className="immnews-status">
        <span className=${'chip ' + (d && !d.stale ? 'ok' : d ? 'warn' : '')}>${d ? (d.stale ? 'Cached official snapshot' : 'Live official sources') : 'Connecting…'}</span>
        ${asof && !Number.isNaN(asof.getTime()) && html`<span className="muted small">Checked ${asof.toLocaleString()}</span>`}
        ${d && d.cached && html`<span className="muted small">Server cache ${Math.max(0, Math.round((d.cacheAge || 0) / 60))} min old</span>`}
      </div>
      <div className="notice info" style=${{ marginTop: 12 }}><b>General information, not legal advice.</b> Open the official source before acting on a filing, status, deadline or case-specific decision, and confirm individual situations with HR or qualified immigration counsel.</div>
    </section>

    ${err && html`<div className="notice bad">${err}<button type="button" className="btn ghost sm" onClick=${() => load(false)}>Try again</button></div>`}

    ${d && html`<section className="panel">
      <div className="ph-row"><h3 className="ph">Source health</h3><span className="muted small">${items.length} official update${items.length === 1 ? '' : 's'} in the current snapshot</span></div>
      <div className="immnews-sources">
        ${(d.sources || []).map(x => html`<a key=${x.id} className="immnews-source" href=${x.url} target="_blank" rel="noopener noreferrer">
          <span className=${'dot ' + (x.ok ? 'ok' : 'warn')}></span>
          <span><b>${x.name}</b><small>${x.note || (x.ok ? 'Connected' : 'Open official source')}</small></span>
        </a>`)}
      </div>
    </section>`}

    <section className="panel">
      <div className="ph-row">
        <h3 className="ph">Latest updates</h3>
        <div className="actions"><input className="immnews-search" value=${find} onInput=${e => setFind(e.target.value)} placeholder="Search H-1B, OPT, I-485…" aria-label="Search immigration updates" /></div>
      </div>
      <div className="immnews-filters">
        ${[['all','All sources'],['uscis','USCIS'],['dos','Visa Bulletin'],['fr','Federal Register']].map(([k,n]) => html`<button type="button" key=${k} className=${'chip ' + (src === k ? 'on' : '')} onClick=${() => setSrc(k)}>${n}</button>`)}
      </div>
      <div className="immnews-filters">
        ${[['all','All topics'],['h1b','H-1B / H-4'],['student','F-1 / OPT / EAD'],['green','Green card'],['work','Work authorization / I-9'],['forms','Forms & fees'],['humanitarian','TPS / asylum']].map(([k,n]) => html`<button type="button" key=${k} className=${'chip ' + (topic === k ? 'on' : '')} onClick=${() => setTopic(k)}>${n}</button>`)}
      </div>
      ${busy && !d ? html`<${Spinner} label="Reading official immigration sources…" />` : shown.length
        ? html`<div className="immnews-list">${shown.map(x => html`<article key=${x.id} className="immnews-card">
            <div className="immnews-meta">
              <span className="chip">${x.source}</span>
              ${x.type && html`<span className="muted small">${x.type}</span>`}
              ${x.date && html`<span className="muted small">${when(x.date)}</span>`}
            </div>
            <h4><a href=${x.url} target="_blank" rel="noopener noreferrer">${x.title}</a></h4>
            ${x.summary && html`<p>${x.summary}</p>`}
            ${(x.tags || []).length > 0 && html`<div className="chips">${x.tags.slice(0, 6).map(t => html`<span key=${t} className="tag">${t === 'greencard' ? 'green card' : t.toUpperCase() === 'H1B' ? 'H-1B' : t.toUpperCase() === 'H4' ? 'H-4' : t.toUpperCase()}</span>`)}</div>`}
            <div className="actions"><a className="btn ghost sm" href=${x.url} target="_blank" rel="noopener noreferrer"><${Icon} n="globe" />Open official source</a></div>
          </article>`)}</div>`
        : html`<${Empty} title=${items.length ? 'No updates match these filters' : 'No official updates are available right now'}>${items.length ? 'Try another topic or clear the search.' : 'Use Refresh live sources, or open an official source above.'}<//>`}
    </section>
  </div>`;
}

const GROW_NAV = [
  ['compliance', 'USCIS compliance', 'shield'],
  ['immigration-live', 'Immigration live updates', 'globe'],
  ['learn', 'Learning', 'compass'],
  // v32: StratEdge certifications (timed exams, verifiable certificates) and the daily and weekly tests
  ['certify', 'Certifications', 'flag'],
  ['tests', 'Daily & weekly tests', 'target'],
  // v35: practice calls with a recruiter, technical lead or hiring manager, answered out loud; voice drills
  ['practice', 'Practice calls', 'phone'],
  ['projects', 'Live projects', 'flask'],
  ['vault', 'Project vault', 'layers'],
];

/* Dashboard card: deadlines, required courses and project progress at a glance (members only). */
function GrowCard() {
  const P = usePortal();
  const [d, setD] = useState(null);
  useEffect(() => {
    let live = true;
    Promise.all([api('comp_me').catch(() => null), api('learn_catalog').catch(() => null)]).then(([c, l]) => live && setD({ c, l }));
    return () => {
      live = false;
    };
  }, []);
  const mine = useCol(`proj/${P.uid}/items`, 'u:desc', 3);
  if (!d) return null;
  const tasks = d.c ? d.c.tasks.filter(t => !t.done && t.kind !== 'info') : [];
  const late = tasks.filter(t => t.sev === 'late');
  const soon = tasks.filter(t => t.sev === 'soon');
  const next = tasks.filter(t => t.due).sort((a, b) => a.due.localeCompare(b.due))[0];
  const req = d.l ? d.l.courses.filter(c => c.req && !c.completedAt) : [];
  const active = mine.docs.find(p => p.st === 'active' || p.st === 'planned');
  const pr = active ? projProgress(active) : null;
  const noStatus = d.c && !d.c.profile.st;
  return html`<section className="panel">
      <div className="ph-row" style=${{ marginBottom: 8 }}><h2 className="ph">Compliance, learning & projects</h2></div>
      <div className="growrow">
        <a className="growtile" href=${growHref(P, 'compliance')}>
          <span className="hubicon"><${Icon} n="shield" /></span>
          <span>
            <b>${noStatus ? 'Set your immigration status' : late.length ? `${late.length} overdue compliance item${late.length === 1 ? '' : 's'}` : soon.length ? `${soon.length} due within 30 days` : 'Compliance on track'}</b>
            <em>${noStatus ? 'Your deadlines, rules and documents in one place.' : next ? `Next: ${next.ti} · ${fmtDate(next.due, { month: 'short', day: 'numeric' })}` : 'No dated items.'}</em>
          </span>
        </a>
        <a className="growtile" href=${growHref(P, 'learn')}>
          <span className="hubicon"><${Icon} n="compass" /></span>
          <span>
            <b>${req.length ? `${req.length} required course${req.length === 1 ? '' : 's'} to finish` : d.l && d.l.certs.length ? `${d.l.certs.length} certificate${d.l.certs.length === 1 ? '' : 's'} earned` : 'Courses and puzzles'}</b>
            <em>${req.length ? req[0].t + (req[0].pct ? ` · ${req[0].pct}%` : '') : 'USCIS compliance, STEM OPT, CHEA credentials, interviews.'}</em>
          </span>
        </a>
        <a className="growtile" href=${growHref(P, active ? 'projects?p=' + encodeURIComponent(active.id) : 'projects')}>
          <span className="hubicon"><${Icon} n="flask" /></span>
          <span>
            <b>${active ? active.t : 'Start a live project'}</b>
            <em>${pr ? `${pr.d} of ${pr.n} tasks · ${pr.pct}%` : 'A realistic client brief, generated for your target role.'}</em>
          </span>
        </a>
      </div>
    </section>`;
}
