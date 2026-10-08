/* ================= Recruiting workspace (internal recruiters) ================= */
const candName = (cands, id) => {
  const c = cands.find(x => x.id === id);
  return c ? c.n : '';
};
function CandModal({ c, onClose }) {
  const P = usePortal();
  const toast = useToast();
  const subs = useCol(c ? 'rec/sub/items' : null, 'd:desc');
  const me = (P.prof && P.prof.n) || (Cap.me && Cap.me.name) || '';
  const [f, setF] = useState({
    n: '',
    e: '',
    ph: '',
    ti: '',
    sk: '',
    auth: 'H-1B',
    loc: '',
    reloc: 'Open',
    rate: '',
    avail: '',
    exp: '',
    li: '',
    src: '',
    notes: '',
    st: 'active',
    emp: '',
    empw: '',
    spon: '',
    mn: '',
    mp: '',
    me: '',
    eng: '',
    ...(c || {}),
  });
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(0);
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const mine = !c || c.by === P.uid || c.own === P.uid || c.bk === P.uid || P.isAdmin;
  const save = async () => {
    if (!f.n.trim() || !f.ti.trim()) {
      toast('Add the consultant\u2019s name and title.', true);
      return;
    }
    setBusy(true);
    try {
      const id = c ? c.id : nid();
      const now = Date.now();
      // fields the bench desk keeps (owner, confirmations, history) are not written back from this form
      const { id: _i, fresh: _f, conf: _c, owh: _o, fh: _h, own: _w, ownn: _wn, bk: _b, bkn: _bn, benchSince: _bs, rAt: _r, dom: _d, ...rest } = f; // dom (v68) is the index's
      // v36: a changed availability, rate, location or work authorization counts as confirmed today by this recruiter
      const groups = { avail: ['avail', 'availDate'], rate: ['rate'], loc: ['loc', 'md', 'reloc'], auth: ['auth'] };
      const fresh = {};
      Object.entries(groups).forEach(([k, keys]) => {
        if (keys.some(x => String((c && c[x]) || '') !== String(f[x] || '')) && keys.some(x => String(f[x] || '').trim())) fresh[k] = { at: now, how: 'recruiter', byn: me };
      });
      await (c ? dbMerge : dbSet)(`rec/cand/items/${id}`, {
        ...rest,
        n: f.n.trim(),
        ti: f.ti.trim(),
        by: c ? c.by : P.uid,
        byn: c ? c.byn : me,
        ...(c ? {} : { own: P.uid, ownn: me, benchSince: f.st === 'active' || f.st === 'working' ? dkey() : '' }),
        ...(Object.keys(fresh).length ? { fresh } : {}),
        at: c ? c.at : now,
        u: now,
        un: me,
      });
      toast(c ? 'Consultant updated.' : 'Consultant added.');
      onClose();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const onFiles = async fs => {
    if (!c) {
      toast('Save the consultant first, then attach the resume.', true);
      return;
    }
    setBusy(true);
    try {
      setProg(0.03);
      const r = await storeFile(`rec/cand/items/${c.id}`, fs[0], { c: 'resume' }, setProg);
      // v36: the resume's own date (a new resume is not a fresh availability)
      await dbMerge(`rec/cand/items/${c.id}`, { rid: r.id, rn: r.n, rAt: Date.now(), fresh: { resume: { at: Date.now(), how: 'uploaded', byn: me } }, u: Date.now() });
      toast('Resume attached.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<${Modal} wide title=${c ? c.n : 'Add a consultant'} onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Close</button>
    ${
      mine &&
      html`<button className="btn" disabled=${busy} onClick=${save}>
          ${busy ? 'Saving…' : c ? 'Save changes' : 'Add consultant'}
        </button>`
    }`}>
      <div className="form">
        ${mine && aiOn('extract') && html`<div className="aibar" style=${{ justifyContent: 'flex-start' }}><${AiFill} kind="cand" label=${c && c.rid ? 'Fill the empty fields from the resume' : 'Fill from a resume file'} base=${c && c.rid ? 'rec/cand/items/' + c.id : ''} allowFile=${!(c && c.rid)} onFill=${fields => { let [next, n] = aiMerge(f, fields); if (!c && fields.auth && fields.auth !== f.auth) { next.auth = fields.auth; n++; } setF(next); return n; }} /></div>`}
        <div className="row3">
          <${Field} label="Full name">
            <input value=${f.n} onInput=${up('n')} disabled=${!mine} />
          <//>
          <${Field} label="Title / role">
            <input value=${f.ti} onInput=${up('ti')} placeholder="e.g. SAP PP/QM Consultant" disabled=${!mine} />
          <//>
          <${Field} label="Status">
            <select value=${f.st} onChange=${up('st')} disabled=${!mine}>
              ${Object.entries(CAND_STATUS).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}
            </select>
          <//>
        </div>
        <div className="row3">
          <${Field} label="Email">
            <input type="email" value=${f.e} onInput=${up('e')} disabled=${!mine} />
          <//>
          <${Field} label="Phone">
            <input type="tel" value=${f.ph} onInput=${up('ph')} disabled=${!mine} />
          <//>
          <${Field} label="LinkedIn">
            <input value=${f.li} onInput=${up('li')} placeholder="https://" disabled=${!mine} />
          <//>
        </div>
        <div className="row2">
          <${Field} label="Key skills">
            <input value=${f.sk} onInput=${up('sk')} placeholder="e.g. S/4HANA, PP, QM, MM" disabled=${!mine} />
          <//>
          <${Field} label="Works as" hint="Which requirements the desk suggests them for (Consultant types & job rules).">
            <select value=${f.eng || ''} onChange=${up('eng')} disabled=${!mine}>
              <option value="">Not set: every type</option>
              ${ctEntries(null, ['student']).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}
            </select>
          <//>
        </div>
        <div className="row3">
          <${Field} label="Work authorization">
            <select value=${f.auth} onChange=${up('auth')} disabled=${!mine}>
              ${AUTH_TYPES.map(a => html`<option key=${a}>${a}</option>`)}
            </select>
          <//>
          <${Field} label="Experience (years)">
            <input type="number" min="0" step="0.5" value=${f.exp} onInput=${up('exp')} disabled=${!mine} />
          <//>
          <${Field} label="Expected rate">
            <input value=${f.rate} onInput=${up('rate')} placeholder="e.g. $75/hr C2C" disabled=${!mine} />
          <//>
        </div>
        <div className="row3">
          <${Field} label="Current location">
            <input value=${f.loc} onInput=${up('loc')} placeholder="City, state" disabled=${!mine} />
          <//>
          <${Field} label="Relocation">
            <select value=${f.reloc} onChange=${up('reloc')} disabled=${!mine}>
              ${['Open', 'Remote only', 'Local only', 'Specific states'].map(x => html`<option key=${x}>${x}</option>`)}
            </select>
          <//>
          <${Field} label="Available from">
            <input value=${f.avail} onInput=${up('avail')} placeholder="e.g. Immediately, 2 weeks" disabled=${!mine} />
          <//>
        </div>
        <div className="row2">
          <${Field} label="Source">
            <input value=${f.src} onInput=${up('src')} placeholder="e.g. Dice, LinkedIn, referral" disabled=${!mine} />
          <//>
          <${Field} label="Notes">
            <input value=${f.notes} onInput=${up('notes')} placeholder="Interview readiness, references, anything useful" disabled=${!mine} />
          <//>
        </div>
        <div className="row3">
          <${Field} label="Current employer / vendor">
            <input value=${f.emp} onInput=${up('emp')} placeholder="Company the consultant works through" disabled=${!mine} />
          <//>
          <${Field} label="Employer website">
            <input value=${f.empw} onInput=${up('empw')} placeholder="https://" disabled=${!mine} />
          <//>
          <${Field} label="Visa sponsor (if different)">
            <input value=${f.spon} onInput=${up('spon')} disabled=${!mine} />
          <//>
        </div>
        <div className="row3">
          <${Field} label="Manager / reference name">
            <input value=${f.mn} onInput=${up('mn')} placeholder="Current or previous manager" disabled=${!mine} />
          <//>
          <${Field} label="Manager phone">
            <input type="tel" value=${f.mp} onInput=${up('mp')} disabled=${!mine} />
          <//>
          <${Field} label="Manager email">
            <input type="email" value=${f.me} onInput=${up('me')} disabled=${!mine} />
          <//>
        </div>
        <div>
          <span className="lbl">Resume</span>
          ${
            c && c.rid
              ? html`<ul className="files" style=${{ marginTop: 8 }}>
                  <li>
                    <${Icon} n="file" />
                    <div className="fn">
                      <b>
                        ${c.rn || 'Resume'}
                      </b>
                    </div>
                    <${FileActions} base=${'rec/cand/items/' + c.id} f=${{ id: c.rid, n: c.rn || 'resume', ty: '' }} />
                  </li>
                </ul>`
              : null
          }
          ${
            c &&
            mine &&
            html`<div style=${{ marginTop: 8 }}>
                <${FilePick} busy=${busy} progress=${prog} onFiles=${onFiles} label=${c.rid ? 'Replace the resume.' : 'Attach the resume.'} hint="PDF or Word (.docx), up to 10 MB." />
              </div>`
          }
          ${!c && html`<p className="muted small" style=${{ marginTop: 6 }}>Save first, then attach the resume.</p>`}
          ${c && c.dom && ((c.dom.tech || []).length || (c.dom.ind || []).length) ? html`<div className="tsdom" style=${{ marginTop: 10 }}><span className="lbl">Domains recognized on the resume</span><div style=${{ marginTop: 4 }}><${DomChips} dom=${c.dom} /></div><div className="muted small" style=${{ marginTop: 4 }}>${[...(c.dom.tech || []), ...(c.dom.ind || [])].map(x => x.n + ': ' + (x.t || []).join(', ') + (x.y ? ' (' + x.y + ' years)' : '')).join(' · ')}</div></div>` : ''}
        </div>
        ${
          c &&
          Cap.ids &&
          html`<div>
              <span className="lbl">ID check</span>
              <div className="actions" style=${{ justifyContent: 'flex-start', marginTop: 6, alignItems: 'center' }}>
                ${c.idchk ? html`<${Chip} s=${{ ok: 'ok', fake: 'red', unsure: 'amber' }[c.idchk.v] || ''}>${{ ok: 'Looks genuine', fake: 'Looks fake', unsure: "Can't tell" }[c.idchk.v] || c.idchk.v}<//><span className="muted small">${c.idchk.kind === 'gc' ? 'Green card' : "Driver's license or ID"} · ${fmtDay(c.idchk.at)}${c.idchk.dec ? ' · ' + ({ verified: 'accepted', not: 'not accepted', more: 'asked for another document' }[c.idchk.dec] || '') : ''}</span>` : html`<span className="muted small">No ID checked yet.</span>`}
                <button type="button" className="btn ghost sm" onClick=${() => idsOpen({ who: { kind: 'cand', id: c.id, n: c.n }, src: 'consultant' })}><${Icon} n="shield" />Check an ID</button>
                <button type="button" className="btn ghost sm" onClick=${() => idsOpen({ link: true, who: { kind: 'cand', id: c.id, n: c.n }, email: c.e || '' })}><${Icon} n="link" />Send an ID link</button>
              </div>
            </div>`
        }
        ${c && html`<p className="muted small">Added by ${c.byn || 'a recruiter'} ${fmtDay(c.at)}${c.u ? ', updated ' + fmtDay(c.u) + (c.un ? ' by ' + c.un : '') : ''}.</p>`}
        ${
          c &&
          html`<div>
              <span className="lbl">Activity for this consultant</span>
              ${
                subs.loading
                  ? html`<${Spinner} />`
                  : subs.docs.filter(s => s.cid === c.id).length
                    ? html`<div className="tblwrap" style=${{ marginTop: 8 }}>
                        <table className="tbl">
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th>By</th>
                              <th>Requirement</th>
                              <th>Vendor / client</th>
                              <th>RTR</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            ${subs.docs
                              .filter(s => s.cid === c.id)
                              .map(
                                s => html`<tr key=${s.id}>
                                    <td className="num nw">
                                      ${fmtDate(s.d)}
                                    </td>
                                    <td>
                                      <b style=${{ fontWeight: 600 }}>
                                        ${s.byn || '—'}
                                      </b>
                                    </td>
                                    <td>
                                      ${s.req}${s.rate ? html`<div className="muted small">${s.rate}</div>` : ''}
                                    </td>
                                    <td>
                                      ${s.vn}${s.ec ? html`<div className="muted small">${s.ec}</div>` : ''}
                                    </td>
                                    <td>
                                      ${s.rtr ? html`<${Chip} s="ok">RTR ${fmtDate(s.rtrAt || s.d, { month: 'short', day: 'numeric' })}<//>` : html`<span className="muted small">No</span>`}
                                    </td>
                                    <td>
                                      <${Chip} s=${subChip(s.st)}>
                                        ${SUB_ST[s.st] || s.st}
                                      <//>
                                    </td>
                                  </tr>`
                              )}
                          </tbody>
                        </table>
                      </div>`
                    : html`<p className="muted small" style=${{ marginTop: 6 }}>No RTRs or submissions logged for this consultant yet. Anyone on the team can log one under RTRs & submissions.</p>`
              }
            </div>`
        }
        ${c && html`<${PhoneHistory} phones=${[c.ph]} refId=${'cons:' + c.id} name=${c.n} />`}
      </div>
    <//>`;
}
function RecConsultants() {
  const P = usePortal();
  const toast = useToast();
  const cands = useCol('rec/cand/items', 'u:desc');
  const subs = useCol('rec/sub/items');
  const saved = useDoc(`rec/x/searches/${P.uid}`);
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [mine, setMine] = useState(false);
  const [open, setOpen] = useState(undefined);
  const [importing, setImporting] = useState(false);
  const ql = q.trim().toLowerCase();
  const qTest = useMemo(() => boolSearch(q), [q]); // v29: AND / OR / NOT, quotes, parentheses
  const tags = [...new Set(cands.docs.flatMap(c => (Array.isArray(c.tags) ? c.tags : [])).filter(Boolean))].sort();
  const list = cands.docs.filter(
    c =>
      (!mine || c.by === P.uid) &&
      (!tag || (Array.isArray(c.tags) && c.tags.includes(tag))) &&
      (!ql || qTest([c.n, c.ti, c.sk, c.loc, c.auth, c.byn, c.e, c.emp, c.notes, ...(Array.isArray(c.tags) ? c.tags : [])].filter(Boolean).join(' ').toLowerCase()))
  );
  const searches = (saved.data && Array.isArray(saved.data.list) ? saved.data.list : []).filter(x => x && x.n);
  const saveSearch = async () => {
    const n = prompt('Name this search', [q.trim(), tag].filter(Boolean).join(' · '));
    if (!n) return;
    try {
      await dbMerge(`rec/x/searches/${P.uid}`, { list: [...searches.filter(x => x.n !== n), { n, q: q.trim(), tag }].slice(-20) });
      toast('Search saved.');
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const dropSearch = async n => {
    try {
      await dbMerge(`rec/x/searches/${P.uid}`, { list: searches.filter(x => x.n !== n) });
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const cur = open && cands.docs.find(c => c.id === open);
  return html`<div className="stack">
      <div className="toolbar">
        <input type="search" style=${{ maxWidth: 300 }} placeholder="Search: java AND (aws OR azure) NOT selenium" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Search consultants" />
        ${tags.length > 0 && html`<select value=${tag} onChange=${e => setTag(e.target.value)} aria-label="Tag"><option value="">All tags</option>${tags.map(t => html`<option key=${t} value=${t}>${t}</option>`)}</select>`}
        <label className="check" style=${{ fontSize: 14 }}>
          <input type="checkbox" checked=${mine} onChange=${e => setMine(e.target.checked)} />
          <span>Only mine</span>
        </label>
        ${(ql || tag) && html`<button className="btn ghost sm" onClick=${saveSearch}>Save this search</button>`}
        <div className="push">
          <button className="btn ghost" onClick=${() => setImporting(true)}><${Icon} n="up" />Import</button>
          <button className="btn" onClick=${() => setOpen(null)}>
            <${Icon} n="plus" />Add consultant</button>
        </div>
      </div>
      ${
        searches.length > 0 &&
        html`<div className="chips">
            <span className="muted small">Saved searches:</span>
            ${searches.map(x => html`<span key=${x.n} className=${'chip pick' + (q.trim() === x.q && tag === x.tag ? ' on' : '')}><button type="button" onClick=${() => {
              setQ(x.q);
              setTag(x.tag || '');
            }}>${x.n}</button><button type="button" className="x" aria-label="Remove" onClick=${() => dropSearch(x.n)}>×</button></span>`)}
          </div>`
      }
      <section className="panel" style=${{ padding: '6px 8px' }}>
        ${
          cands.loading
            ? html`<${Spinner} />`
            : list.length
              ? html`<div className="tblwrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Consultant</th>
                        <th>Skills</th>
                        <th>Authorization</th>
                        <th>Location</th>
                        <th>Rate</th>
                        <th>Status</th>
                        <th>Activity</th>
                        <th>Added by</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${list.map(c => {
                        const mine = subs.docs.filter(s => s.cid === c.id);
                        const rtr = mine.filter(s => s.rtr).length;
                        const who = [...new Set(mine.map(s => s.byn).filter(Boolean))];
                        return html`<tr key=${c.id} className="click" tabIndex="0" onClick=${() => setOpen(c.id)} onKeyDown=${e => {
                          if (e.key === 'Enter') setOpen(c.id);
                        }}>
                            <td>
                              <b style=${{ fontWeight: 600 }}>
                                ${c.n}
                              </b>
                              <div className="muted small">
                                ${c.ti}${c.exp ? `, ${c.exp} yrs` : ''}${c.emp ? ` · ${c.emp}` : ''}
                              </div>
                            </td>
                            <td className="small">
                              ${c.sk || '—'}${Array.isArray(c.tags) && c.tags.length ? html`<div className="muted small">${c.tags.join(' · ')}</div>` : ''}
                              <${DomChips} dom=${c.dom} small max=${3} />
                            </td>
                            <td>
                              ${c.auth || '—'}
                            </td>
                            <td>
                              ${c.loc || '—'}${c.reloc && c.reloc !== 'Open' ? html`<div className="muted small">${c.reloc}</div>` : ''}
                            </td>
                            <td>
                              ${c.rate || '—'}
                            </td>
                            <td>
                              <${Chip} s=${c.st === 'placed' ? 'ok' : c.st === 'inactive' ? '' : c.st === 'working' ? 'new' : c.st === 'hold' ? 'amber' : 'ok'}>
                                ${CAND_STATUS[c.st] || c.st}
                              <//>
                            </td>
                            <td className="small">
                              ${
                                mine.length
                                  ? html`<b>
                                      ${rtr}
                                    </b> RTR · <b>
                                      ${mine.length}
                                    </b> sub${who.length ? html`<div className="muted small">by ${who.join(', ')}</div>` : ''}`
                                  : html`<span className="muted">None yet</span>`
                              }
                            </td>
                            <td className="small">
                              ${c.byn || ''}
                            </td>
                          </tr>`;
                      })}
                    </tbody>
                  </table>
                </div>`
              : html`<${Empty} title=${ql ? 'No matches' : 'No consultants yet'} action=${html`<button className="btn" onClick=${() => setOpen(null)}>Add the first consultant</button>`}>Keep every consultant you work with here: skills, authorization, location, rate and resume, so submissions and RTRs can be verified against one record.<//>`
        }
      </section>
      ${open !== undefined && (open === null || cur) && html`<${CandModal} key=${open || 'new'} c=${cur || null} onClose=${() => setOpen(undefined)} />`}
      ${importing && html`<${ImportCandidates} onClose=${() => setImporting(false)} onDone=${() => Sync.kick(0)} />`}
    </div>`;
}

/* ---- RTRs and submissions ---- */
/* v68: the healthcare staffing fields (kind: 'sub' | 'req'); hc is the object, set(patch) merges into it */
const HC_DISC = ['RN', 'LPN / LVN', 'CNA', 'NP', 'PA', 'CRNA', 'Physician (locum)', 'PT', 'PTA', 'OT', 'COTA', 'SLP', 'RT (respiratory)', 'Rad tech', 'CT / MRI tech', 'Sonographer', 'Surgical tech', 'MLT / MLS (lab)', 'Pharmacist', 'Pharmacy tech', 'Dietitian', 'Social worker', 'Medical assistant', 'Phlebotomist', 'Other'];
const HC_SPEC = ['ICU', 'ER / ED', 'Med-Surg', 'Telemetry', 'PCU / Step-down', 'OR', 'PACU', 'L&D', 'Mother-baby', 'NICU', 'PICU', 'Oncology', 'Cath lab', 'Dialysis', 'Psych / Behavioral', 'Home health', 'Hospice', 'LTC / SNF', 'Rehab', 'Case management', 'Infusion', 'Clinic / Ambulatory', 'School', 'Correctional'];
const HC_FTYPE = ['Hospital', 'Clinic / outpatient', 'SNF / LTC', 'Home health', 'Surgery center', 'Behavioral health', 'Rehab facility', 'Urgent care', 'Correctional', 'School', 'Other'];
const HC_ATYPE = ['Travel', 'Local contract', 'Per diem', 'Contract-to-hire', 'Permanent', 'Locum tenens'];
const HC_SHIFT = ['Days', 'Nights', 'Mids / Evenings', 'Rotating', 'Weekends', 'Flex'];
const hcEmpty = () => ({ disc: '', spec: '', fac: '', ftype: '', atype: '', shift: '', hrs: '', len: '', start: '', lic: '', licExp: '', compact: false, certs: '', emr: '', yrs: '', hourly: '', stipend: '', bill: '', cred: {}, notes: '' });
function HcFields({ hc, set, mine, kind }) {
  const h = { ...hcEmpty(), ...(hc || {}) };
  const up = k => e => set({ [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const opts = (list, v) => [...new Set([...list, ...(v && !list.includes(v) ? [v] : [])])];
  return html`<div className="hcfields stack" style=${{ gap: 0 }}>
    <div className="row3">
      <${Field} label="Discipline"><select value=${h.disc} onChange=${up('disc')} disabled=${!mine} aria-label="Discipline"><option value="">—</option>${opts(HC_DISC, h.disc).map(x => html`<option key=${x}>${x}</option>`)}</select><//>
      <${Field} label="Specialty / unit"><input list="hcspec" value=${h.spec} onInput=${up('spec')} placeholder="ICU, ER, Med-Surg…" disabled=${!mine} /><datalist id="hcspec">${HC_SPEC.map(x => html`<option key=${x} value=${x} />`)}</datalist><//>
      <${Field} label="Years in the specialty"><input type="number" min="0" step="0.5" value=${h.yrs} onInput=${up('yrs')} disabled=${!mine} /><//>
    </div>
    <div className="row3">
      <${Field} label="Facility"><input value=${h.fac} onInput=${up('fac')} placeholder="Hospital or health system" disabled=${!mine} /><//>
      <${Field} label="Facility type"><select value=${h.ftype} onChange=${up('ftype')} disabled=${!mine} aria-label="Facility type"><option value="">—</option>${opts(HC_FTYPE, h.ftype).map(x => html`<option key=${x}>${x}</option>`)}</select><//>
      <${Field} label="Assignment"><select value=${h.atype} onChange=${up('atype')} disabled=${!mine} aria-label="Assignment"><option value="">—</option>${opts(HC_ATYPE, h.atype).map(x => html`<option key=${x}>${x}</option>`)}</select><//>
    </div>
    <div className="row3">
      <${Field} label="Shift"><select value=${h.shift} onChange=${up('shift')} disabled=${!mine} aria-label="Shift"><option value="">—</option>${opts(HC_SHIFT, h.shift).map(x => html`<option key=${x}>${x}</option>`)}</select><//>
      <${Field} label="Hours per week"><input type="number" min="0" value=${h.hrs} onInput=${up('hrs')} placeholder="36" disabled=${!mine} /><//>
      <${Field} label="Length (weeks)"><input type="number" min="0" value=${h.len} onInput=${up('len')} placeholder="13" disabled=${!mine} /><//>
    </div>
    <div className="row3">
      <${Field} label="Start date"><input type="date" value=${h.start} onInput=${up('start')} disabled=${!mine} /><//>
      <${Field} label="License state(s)"><input value=${h.lic} onInput=${up('lic')} placeholder="NJ, NY" disabled=${!mine} /><//>
      <div className="fld"><span>License</span><div className="stack" style=${{ gap: 4 }}><input type="date" value=${h.licExp} onInput=${up('licExp')} aria-label="License expiry" disabled=${!mine} /><label className="check"><input type="checkbox" checked=${!!h.compact} onChange=${up('compact')} disabled=${!mine} /><span>Compact (multistate) license</span></label></div></div>
    </div>
    <div className="row3">
      <${Field} label="Certifications"><input value=${h.certs} onInput=${up('certs')} placeholder="BLS, ACLS, PALS, NIHSS…" disabled=${!mine} /><//>
      <${Field} label="EMR systems"><input value=${h.emr} onInput=${up('emr')} placeholder="Epic, Cerner, Meditech…" disabled=${!mine} /><//>
      <${Field} label=${kind === 'req' ? 'Pay package offered' : 'Pay package submitted'}><div className="hcpay"><input value=${h.hourly} onInput=${up('hourly')} placeholder="$55 hourly" aria-label="Hourly pay" disabled=${!mine} /><input value=${h.stipend} onInput=${up('stipend')} placeholder="$1,200 weekly stipend" aria-label="Weekly stipend" disabled=${!mine} /><input value=${h.bill} onInput=${up('bill')} placeholder="$95 bill rate" aria-label="Bill rate" disabled=${!mine} /></div><//>
    </div>
    ${kind !== 'req' && html`<div className="fld"><span>Credentialing</span><div className="hccred">${HC_CRED.map(([k, n]) => html`<label key=${k}><span>${n}</span><select value=${(h.cred || {})[k] || ''} onChange=${e => set({ cred: { ...(h.cred || {}), [k]: e.target.value } })} disabled=${!mine} aria-label=${n}><option value="">—</option><option value="ok">Done</option><option value="due">Due</option><option value="na">Not needed</option></select></label>`)}</div></div>`}
    <${Field} label=${kind === 'req' ? 'Healthcare notes' : 'Healthcare notes'}><input value=${h.notes} onInput=${up('notes')} placeholder=${kind === 'req' ? 'Floating, call, block scheduling, unit details' : 'Availability for the unit, preferences, anything the facility should know'} disabled=${!mine} /><//>
  </div>`;
}
const LOB = { '': 'IT and professional', hc: 'Healthcare staffing' };
function SubModal({ s, cands, onClose, init, onSaved }) {
  const P = usePortal();
  const toast = useToast();
  const me = (P.prof && P.prof.n) || (Cap.me && Cap.me.name) || '';
  // init: prefilled fields from Tailor & submit (consultant, role, vendor and the tailored resume file as tl)
  const [f, setF] = useState({
    d: dkey(),
    cid: '',
    cn: '',
    req: '',
    vn: '',
    vw: '',
    rn: '',
    rp: '',
    re: '',
    ec: '',
    mn: '',
    mp: '',
    mem: '',
    rate: '',
    rtr: false,
    rtrAt: '',
    st: 'submitted',
    intv: '',
    notes: '',
    lob: '',
    hc: null,
    ...(init || {}),
    ...(s || {}),
  });
  const [busy, setBusy] = useState(false);
  const [cf, setCf] = useState(null);
  const [ack, setAck] = useState(false);
  // v45.4: the resume that goes with a new submission (a file, or the one on the consultant's record)
  const [rf, setRf] = useState(null);
  const [onFileNew, setOnFileNew] = useState(false);
  const newCand = !s && f.cid ? cands.find(x => x.id === f.cid) : null;
  const up = k => e => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const mine = !s || s.by === P.uid || s.own === P.uid || s.bk === P.uid || P.isAdmin;
  const save = async () => {
    const cn = (f.cid ? candName(cands, f.cid) : '') || f.cn.trim();
    if (!cn || !f.req.trim() || !f.vn.trim()) {
      toast('Add the consultant, the requirement and the vendor or client.', true);
      return;
    }
    setBusy(true);
    // v36: a new submission that went out: show the earlier ones it repeats (same requirement, requisition, end client)
    let checked = cf;
    if (!s && subSent(f) && !checked && typeof BdConflictBox === 'function') {
      try {
        const cc = f.cid ? cands.find(x => x.id === f.cid) : null;
        const r = await api('bd_check', { cid: f.cid || '', cn, ce: (cc && cc.e) || '', req: f.req.trim(), vn: f.vn.trim(), ec: (f.ec || '').trim(), ext: (f.ext || '').trim() });
        checked = { ...r, conflicts: (r.conflicts || []).filter(x => x.kind !== 'info') };
        if (checked.conflicts.length) {
          setCf(checked);
          setBusy(false);
          toast('Check the earlier submission first.', true);
          return;
        }
      } catch (e) {
        // the check helps; logging still works without it
      }
    }
    if (checked && checked.conflicts.length && !ack) {
      setBusy(false);
      toast('Tick the box to log it anyway.', true);
      return;
    }
    try {
      const id = s ? s.id : nid();
      const now = Date.now();
      // what the bench desk keeps (approval, history, next action, what was sent) is not written back from this form
      const { id: _i, rtr2: _a, hist: _h, next: _n, pk: _p, cf: _c, ovr: _o, ack: _k, flag: _f, xc: _x, stAt: _s, own: _w, ownn: _wn, bk: _b, bkn: _bn, ...rest } = f;
      if (s && s.st !== f.st) rest.stAt = now;
      await (s ? dbMerge : dbSet)(`rec/sub/items/${id}`, {
        ...rest,
        cn,
        req: f.req.trim(),
        vn: f.vn.trim(),
        rtr: !!f.rtr,
        rtrAt: f.rtr ? f.rtrAt || f.d : '',
        by: s ? s.by : P.uid,
        byn: s ? s.byn : me,
        ...(s ? {} : { own: P.uid, ownn: me, stAt: now, hist: [{ t: now, by: me, ev: 'Logged by hand (' + (SUB_ST[f.st] || f.st) + ')' }] }),
        ...(checked && checked.conflicts.length && ack ? { ack: { by: me, at: now, sids: checked.conflicts.map(x => x.sid), logged: true } } : {}),
        at: s ? s.at : now,
        u: now,
        un: me,
      });
      let rsErr = '';
      const withRs = !s && (rf || (onFileNew && subOnFileOk(newCand)));
      if (withRs) {
        try {
          await subAddResume({ id, cn }, rf || (await subResumeOnFile(newCand)));
        } catch (e) {
          rsErr = errText(e);
        }
      }
      toast(s ? 'Entry updated.' : rsErr ? 'Submission logged, but the resume was not added (' + rsErr + '). Add it from the Resume column.' : withRs ? 'Submission logged with the resume.' : 'Submission logged.', !!rsErr);
      onSaved && onSaved(id);
      onClose();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<${Modal} wide title=${s ? 'Edit submission' : 'Log a submission'} onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Close</button>
    ${
      mine &&
      html`<button className="btn" disabled=${busy} onClick=${save}>
          ${busy ? 'Saving…' : s ? 'Save' : 'Log it'}
        </button>`
    }`}>
      <div className="form">
        <div className="row2">
          <${Field} label="Date">
            <input type="date" value=${f.d} max=${dkey()} onInput=${up('d')} disabled=${!mine} />
          <//>
          <${Field} label="Consultant">
            ${
              cands.length
                ? html`<select value=${f.cid} onChange=${up('cid')} disabled=${!mine}>
                    <option value="">Type a name below…</option>
                    ${cands.map(c => html`<option key=${c.id} value=${c.id}>${c.n}, ${c.ti}</option>`)}
                  </select>`
                : html`<input value=${f.cn} onInput=${up('cn')} placeholder="Consultant name" disabled=${!mine} />`
            }
          <//>
        </div>
        ${
          cands.length > 0 &&
          !f.cid &&
          html`<${Field} label="Consultant name (if not in the list)">
              <input value=${f.cn} onInput=${up('cn')} disabled=${!mine} />
            <//>`
        }
        ${f.tl && f.tl.fid && !(s && s.rs) && html`<div className="note"><span><b>Tailored resume attached:</b> <a href=${fileUrl(f.tl.base, f.tl.fid, true)}>${f.tl.n || 'Word file'}</a></span></div>`}
        ${
          s
            ? html`<div className="actions"><span className="lbl">Resume submitted</span><${SubResumeCell} s=${s} edit=${mine} cand=${f.cid ? cands.find(x => x.id === f.cid) : null} /></div>`
            : html`<div className="fld subrsnew">
                <span>Resume submitted (optional)</span>
                <input type="file" accept=".pdf,.docx,.txt" aria-label="Resume submitted" onChange=${e => {
                  const fl = (e.target.files && e.target.files[0]) || null;
                  if (fl && !SUB_RS_RE.test(fl.name)) {
                    e.target.value = '';
                    toast('Add the resume as a PDF, Word (.docx) or text file.', true);
                    return setRf(null);
                  }
                  setRf(fl);
                }} />
                ${!rf && subOnFileOk(newCand) && html`<label className="check"><input type="checkbox" checked=${onFileNew} onChange=${e => setOnFileNew(e.target.checked)} /><span>Use ${firstName(newCand.n)}’s resume on file (${newCand.rn})</span></label>`}
                <small>${f.tl && f.tl.fid ? 'Leave it empty to keep the tailored resume above.' : 'The exact file that went out with it. You can also add it later from the Resume column.'}</small>
              </div>`
        }
        <div className="row2">
          <${Field} label="Requirement / role">
            <input value=${f.req} onInput=${up('req')} placeholder=${f.lob === 'hc' ? 'e.g. ICU RN, Newark NJ' : 'e.g. Network Engineer, Edison NJ'} disabled=${!mine} />
          <//>
          <${Field} label="Vendor or client">
            <input value=${f.vn} onInput=${up('vn')} placeholder="Who you submitted to" disabled=${!mine} />
          <//>
        </div>
        <${Field} label="Line of business" hint=${f.lob === 'hc' ? 'The healthcare details below go with the submission (the list, the bench desk and what was sent).' : ''}>
          <select value=${f.lob || ''} onChange=${e => setF({ ...f, lob: e.target.value, hc: e.target.value === 'hc' ? f.hc || hcEmpty() : f.hc })} disabled=${!mine} aria-label="Line of business">${Object.entries(LOB).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select>
        <//>
        ${f.lob === 'hc' && html`<${HcFields} hc=${f.hc} set=${p => setF({ ...f, hc: { ...hcEmpty(), ...(f.hc || {}), ...p } })} mine=${mine} kind="sub" />`}
        <div className="row3">
          <${Field} label="End client">
            <input value=${f.ec} onInput=${up('ec')} disabled=${!mine} />
          <//>
          <${Field} label="Rate submitted">
            <input value=${f.rate} onInput=${up('rate')} placeholder="e.g. $70/hr" disabled=${!mine} />
          <//>
          <${Field} label="Status" hint=${s && SUB_PRE.includes(s.st) ? 'Being prepared on the bench desk: send it from there (it checks for earlier submissions first).' : ''}>
            <select value=${f.st} onChange=${up('st')} disabled=${!mine}>
              ${Object.entries(SUB_ST)
                .filter(([k]) => !(s && SUB_PRE.includes(s.st)) || SUB_PRE.includes(k) || k === 'withdrawn')
                .map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}
            </select>
          <//>
        </div>
        <div className="row3">
          <${Field} label="Vendor website">
            <input value=${f.vw} onInput=${up('vw')} placeholder="https://" disabled=${!mine} />
          <//>
          <${Field} label="Vendor recruiter name">
            <input value=${f.rn} onInput=${up('rn')} disabled=${!mine} />
          <//>
          <${Field} label="Recruiter phone">
            <input type="tel" value=${f.rp} onInput=${up('rp')} disabled=${!mine} />
          <//>
        </div>
        <div className="row3">
          <${Field} label="Recruiter email">
            <input type="email" value=${f.re} onInput=${up('re')} disabled=${!mine} />
          <//>
          <${Field} label="Hiring manager name">
            <input value=${f.mn} onInput=${up('mn')} disabled=${!mine} />
          <//>
          <${Field} label="Manager phone">
            <input type="tel" value=${f.mp} onInput=${up('mp')} disabled=${!mine} />
          <//>
        </div>
        <${Field} label="Manager email">
          <input type="email" value=${f.mem} onInput=${up('mem')} disabled=${!mine} />
        <//>
        <div className="row2">
          <label className="check" style=${{ alignSelf: 'end', paddingBottom: 12 }}>
            <input type="checkbox" checked=${!!f.rtr} onChange=${up('rtr')} disabled=${!mine} />
            <span>RTR received from the consultant</span>
          </label>
          ${
            f.rtr &&
            html`<${Field} label="RTR date">
                <input type="date" value=${f.rtrAt || f.d} max=${dkey()} onInput=${up('rtrAt')} disabled=${!mine} />
              <//>`
          }
        </div>
        ${
          (f.st === 'interview' || f.intv) &&
          html`<${Field} label="Interview date">
              <input type="date" value=${f.intv} onInput=${up('intv')} disabled=${!mine} />
            <//>`
        }
        <${Field} label="Notes">
          <input value=${f.notes} onInput=${up('notes')} placeholder="Feedback, next steps" disabled=${!mine} />
        <//>
        ${cf && cf.conflicts.length > 0 && html`<${BdConflictBox} list=${cf.conflicts} manager=${cf.manager} ack=${ack} setAck=${setAck} logging=${true} />`}
      </div>
    <//>`;
}
const inRange = (d, a, b) => d >= a && d <= b;
function recStats(subs, cands, uid, a, b) {
  const mine = x => !uid || x.by === uid;
  const s = subs.filter(x => mine(x) && subSent(x) && inRange(x.d, a, b));
  return {
    subs: s.length,
    rtr: subs.filter(x => mine(x) && x.rtr && inRange(x.rtrAt || x.d, a, b)).length,
    intv: subs.filter(x => mine(x) && x.intv && inRange(x.intv, a, b)).length,
    cands: cands.filter(x => mine(x) && inRange(dkey(new Date(x.at || 0)), a, b)).length,
    placed: s.filter(x => x.st === 'placed').length,
  };
}
/* v45.4: the resume that went out with a submission: the one added here (or the tailored one from Tailor & submit),
   and "Add resume" / "Replace" for the people who may change the submission. "Use the one on file" copies the
   consultant's current resume into the submission, so a later change to their record never changes what was sent. */
const SUB_RS_RE = /\.(pdf|docx|txt)$/i;
async function subAddResume(s, file) {
  if (!SUB_RS_RE.test(file.name || '')) throw { message: 'Add the resume as a PDF, Word (.docx) or text file.' };
  const doc = await storeFile('rec/sub/items/' + s.id, file, { c: 'resume' });
  await dbMerge('rec/sub/items/' + s.id, { rs: { fid: doc.id, n: doc.n, at: Date.now(), byn: (Cap.me && Cap.me.name) || '' }, u: Date.now() });
  return doc;
}
const subOnFileOk = c => !!(c && c.rid && SUB_RS_RE.test(c.rn || ''));
async function subResumeOnFile(c) {
  const r = await fetch(fileUrl('rec/cand/items/' + c.id, c.rid, true), { credentials: 'same-origin' });
  if (!r.ok) throw { message: 'The resume on ' + (firstName(c.n) || 'their') + '’s record could not be opened.' };
  const bl = await r.blob();
  return new File([bl], c.rn, { type: bl.type || 'application/octet-stream' });
}
function SubResumeCell({ s, edit, cand }) {
  const toast = useToast();
  const inp = useRef(null);
  const [busy, setBusy] = useState(false);
  const rs =
    s.rs && s.rs.fid
      ? { base: 'rec/sub/items/' + s.id, fid: s.rs.fid, n: s.rs.n || 'Resume', t: 'Added' + (s.rs.byn ? ' by ' + s.rs.byn : '') + (s.rs.at ? ', ' + fmtTs(s.rs.at) : '') }
      : s.tl && s.tl.fid
        ? { base: s.tl.base, fid: s.tl.fid, n: 'Tailored resume', t: (s.tl.n || 'Word file') + ', made with Tailor & submit' }
        : null;
  const onFile = !rs && edit && subOnFileOk(cand);
  const add = async get => {
    setBusy(true);
    try {
      await subAddResume(s, await get());
      toast('Resume added to ' + (s.cn || 'the submission') + '.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<div className="subrs" onClick=${e => e.stopPropagation()} onKeyDown=${e => e.stopPropagation()}>
      ${rs && html`<a className="small" href=${fileUrl(rs.base, rs.fid, true)} title=${rs.t}><${Icon} n="down" />${rs.n}</a>`}
      ${
        edit
          ? html`<button type="button" className=${'btn sm' + (rs ? ' ghost' : '')} disabled=${busy} onClick=${() => inp.current && inp.current.click()}>${busy ? 'Adding…' : rs ? 'Replace' : 'Add resume'}</button>
              ${onFile && html`<button type="button" className="btn sm ghost" disabled=${busy} title=${'Copy ' + cand.rn + ' from ' + firstName(cand.n) + '’s record'} onClick=${() => add(() => subResumeOnFile(cand))}>Use the one on file</button>`}
              <input ref=${inp} type="file" hidden accept=".pdf,.docx,.txt" aria-label=${'Resume for ' + (s.cn || 'this submission')} onChange=${e => {
                const fl = e.target.files && e.target.files[0];
                e.target.value = '';
                fl && add(async () => fl);
              }} />`
          : !rs && html`<span className="muted small">—</span>`
      }
    </div>`;
}
const subMayEdit = (s, P) => !s || s.by === P.uid || s.own === P.uid || s.bk === P.uid || P.isAdmin;
function RecSubmissions() {
  const P = usePortal();
  const subs = useCol('rec/sub/items', 'd:desc');
  const cands = useCol('rec/cand/items', 'n:asc');
  const candBy = useMemo(() => Object.fromEntries(cands.docs.map(c => [c.id, c])), [cands.docs]);
  const [mine, setMine] = useState(true);
  const [open, setOpen] = useState(undefined);
  const [q, setQ] = useState('');
  const [lob, setLob] = useState('all'); // v68: all | it | hc
  const today = dkey();
  const ws = weekStart(today);
  const mk = mkey(today);
  const t = recStats(subs.docs, cands.docs, P.uid, today, today),
    w = recStats(subs.docs, cands.docs, P.uid, ws, addDays(ws, 6)),
    m = recStats(subs.docs, cands.docs, P.uid, mk + '-01', mk + '-31');
  const ql = q.trim().toLowerCase();
  const list = subs.docs.filter(
    s =>
      (!mine || s.by === P.uid) &&
      (lob === 'all' || (lob === 'hc' ? s.lob === 'hc' : s.lob !== 'hc')) &&
      (!ql || [s.cn, s.req, s.vn, s.ec, s.byn, s.lob === 'hc' ? hcLine(s.hc) : ''].filter(Boolean).join(' ').toLowerCase().includes(ql))
  );
  const hcN = subs.docs.filter(s => s.lob === 'hc' && (!mine || s.by === P.uid)).length;
  const cur = open && subs.docs.find(s => s.id === open);
  return html`<div className="stack">
      <div className="kpis" style=${{ gridTemplateColumns: 'repeat(3,minmax(0,1fr))' }}>
        <a>
          <b>
            ${t.rtr}
            <span style=${{ fontSize: 16, fontWeight: 600 }}> RTR / ${t.subs} sub</span>
          </b>
          <span>Today</span>
        </a>
        <a>
          <b>
            ${w.rtr}
            <span style=${{ fontSize: 16, fontWeight: 600 }}> RTR / ${w.subs} sub</span>
          </b>
          <span>This week</span>
        </a>
        <a>
          <b>
            ${m.rtr}
            <span style=${{ fontSize: 16, fontWeight: 600 }}> RTR / ${m.subs} sub</span>
          </b>
          <span>This month, ${m.intv} interview${m.intv === 1 ? '' : 's'}, ${m.placed} placed</span>
        </a>
      </div>
      <div className="toolbar">
        <input type="search" style=${{ maxWidth: 300 }} placeholder="Search consultant, role, vendor" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Search submissions" />
        <label className="check" style=${{ fontSize: 14 }}>
          <input type="checkbox" checked=${mine} onChange=${e => setMine(e.target.checked)} />
          <span>Only mine</span>
        </label>
        ${hcN > 0 && html`<select value=${lob} onChange=${e => setLob(e.target.value)} aria-label="Line of business" style=${{ width: 'auto' }}><option value="all">All lines of business</option><option value="it">IT and professional</option><option value="hc">Healthcare staffing (${hcN})</option></select>`}
        <div className="push">
          <button className="btn" onClick=${() => setOpen(null)}>
            <${Icon} n="plus" />Log submission</button>
        </div>
      </div>
      <section className="panel" style=${{ padding: '6px 8px' }}>
        ${
          subs.loading
            ? html`<${Spinner} />`
            : list.length
              ? html`<div className="tblwrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Consultant</th>
                        <th>Requirement</th>
                        <th>Vendor / client</th>
                        <th>RTR</th>
                        <th>Status</th>
                        <th>Recruiter</th>
                        <th>Resume</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${list.map(
                        s => html`<tr key=${s.id} className="click" tabIndex="0" onClick=${() => setOpen(s.id)} onKeyDown=${e => {
                          if (e.key === 'Enter') setOpen(s.id);
                        }}>
                            <td className="num nw">
                              ${fmtDate(s.d)}
                            </td>
                            <td>
                              <b style=${{ fontWeight: 600 }}>
                                ${s.cn}
                              </b>
                            </td>
                            <td>
                              ${s.req}${s.rate ? html`<div className="muted small">${s.rate}</div>` : ''}
                              ${s.lob === 'hc' ? html`<div className="small hcline"><${Chip} s="new">Healthcare<//> ${hcLine(s.hc)}${hcPay(s.hc) ? html`<div className="muted small">${hcPay(s.hc)}</div>` : ''}${hcCred(s.hc) ? html`<div className=${'small ' + (/due/.test(hcCred(s.hc)) ? 'late' : 'muted')}>${hcCred(s.hc)}</div>` : ''}</div>` : ''}
                            </td>
                            <td>
                              ${s.vn}${s.ec ? html`<div className="muted small">${s.ec}</div>` : ''}${s.rn || s.rp ? html`<div className="muted small">${[s.rn, s.rp].filter(Boolean).join(' · ')}</div>` : ''}
                            </td>
                            <td>
                              ${s.rtr ? html`<${Chip} s="ok">RTR ${fmtDate(s.rtrAt || s.d, { month: 'short', day: 'numeric' })}<//>` : html`<span className="muted small">No</span>`}
                            </td>
                            <td>
                              <${Chip} s=${subChip(s.st)}>
                                ${SUB_ST[s.st] || s.st}
                              <//>
                              ${s.intv ? html`<div className="muted small">Interview ${fmtDate(s.intv)}</div>` : ''}
                            </td>
                            <td className="small">
                              ${s.byn || ''}
                            </td>
                            <td>
                              <${SubResumeCell} s=${s} edit=${subMayEdit(s, P)} cand=${s.cid ? candBy[s.cid] : null} />
                            </td>
                          </tr>`
                      )}
                    </tbody>
                  </table>
                </div>`
              : html`<${Empty} title="No submissions logged" action=${html`<button className="btn" onClick=${() => setOpen(null)}>Log the first submission</button>`}>Log each submission with its requirement, vendor and whether the RTR was received. Counts roll up here and into your daily report.<//>`
        }
      </section>
      ${open !== undefined && (open === null || cur) && html`<${SubModal} key=${open || 'new'} s=${cur || null} cands=${cands.docs} onClose=${() => setOpen(undefined)} />`}
    </div>`;
}

/* ---- End-of-day report ---- */
function eodText(name, d, st, items, note) {
  const lines = [
    `End-of-day report: ${name}, ${fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`,
    '',
    `Consultants added: ${st.cands}`,
    `RTRs received: ${st.rtr}`,
    `Submissions: ${st.subs}`,
    `Interviews scheduled: ${st.intv}`,
    '',
  ];
  if (items.length) {
    lines.push('Submissions today:');
    items.forEach(s =>
      lines.push(
        `- ${s.cn}: ${s.req} to ${s.vn}${s.ec ? ' (' + s.ec + ')' : ''}${s.rate ? ', ' + s.rate : ''}${s.rtr ? ', RTR received' : ''}, ${SUB_ST[s.st] || s.st}`
      )
    );
    lines.push('');
  }
  if (note) lines.push('Highlights and blockers:', note);
  return lines.join('\n');
}
function RecEOD() {
  const P = usePortal();
  const toast = useToast();
  const subs = useCol('rec/sub/items', 'd:desc');
  const cands = useCol('rec/cand/items', 'n:asc');
  const mine = useCol('rec/eod/items', 'd:desc', 60);
  const [d, setD] = useState(dkey());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const st = recStats(subs.docs, cands.docs, P.uid, d, d);
  const items = subs.docs.filter(s => s.by === P.uid && s.d === d && subSent(s));
  const reports = mine.docs.filter(r => r.uid === P.uid);
  const existing = reports.find(r => r.d === d);
  const send = async () => {
    setBusy(true);
    try {
      const text = eodText(P.prof.n, d, st, items, note.trim());
      await dbSet(`rec/eod/items/${P.uid}_${d}`, {
        uid: P.uid,
        n: P.prof.n,
        d,
        cands: st.cands,
        rtr: st.rtr,
        subs: st.subs,
        intv: st.intv,
        note: note.trim(),
        text,
        at: Date.now(),
      });
      let mailed = false;
      try {
        const r = await api('eod_notify', { date: d, text });
        mailed = !!r.mailed;
      } catch (e) {
        /* in-app copy is already saved */
      }
      toast(mailed ? 'Report shared with HR and admin, and emailed.' : 'Report shared with HR and admin.');
      setNote('');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  if (!P.prof) return html`<${NeedProfile} />`;
  return html`<div className="g2" style=${{ alignItems: 'start' }}>
      <section className="panel stack">
        <div className="ph-row" style=${{ marginBottom: 0 }}>
          <h2 className="ph">Today\u2019s report</h2>
          <input type="date" value=${d} max=${dkey()} onInput=${e => e.target.value && setD(e.target.value)} style=${{ width: 170 }} aria-label="Report date" />
        </div>
        <div className="kpis" style=${{ gridTemplateColumns: 'repeat(4,minmax(0,1fr))' }}>
          <a href="#/portal/rec/consultants">
            <b>
              ${st.cands}
            </b>
            <span>Consultants added</span>
          </a>
          <a href="#/portal/rec/submissions">
            <b>
              ${st.rtr}
            </b>
            <span>RTRs received</span>
          </a>
          <a href="#/portal/rec/submissions">
            <b>
              ${st.subs}
            </b>
            <span>Submissions</span>
          </a>
          <a href="#/portal/rec/submissions">
            <b>
              ${st.intv}
            </b>
            <span>Interviews</span>
          </a>
        </div>
        ${
          items.length
            ? html`<ul className="list">
                ${items.map(
                  s => html`<li key=${s.id}>
                      <div>
                        <div className="t">
                          ${s.cn}: ${s.req}
                        </div>
                        <div className="m">
                          ${s.vn}${s.ec ? ', ' + s.ec : ''}${s.rate ? ', ' + s.rate : ''}
                        </div>
                      </div>
                      <div className="actions">
                        ${s.rtr && html`<${Chip} s="ok">RTR<//>`}
                        <${Chip} s=${subChip(s.st)}>
                          ${SUB_ST[s.st]}
                        <//>
                      </div>
                    </li>`
                )}
              </ul>`
            : html`<p className="muted small">No submissions logged for this day yet. Log them under RTRs & submissions and they appear here automatically.</p>`
        }
        <${Field} label="Highlights and blockers">
          <div className="aibar"><${AiWrite} kind="eod" label="Draft from today's log" value=${note} ctx=${{ date: d, submissions: st.subs, rtrs: st.rtr, interviews: st.intv, consultants_added: st.cands, log: items.map(s => `${s.cn}: ${s.req} to ${s.vn}${s.st ? ' (' + s.st + ')' : ''}`).join('; ').slice(0, 1500) }} onUse=${t => setNote(t)} /></div>
          <textarea value=${note} onInput=${e => setNote(e.target.value)} placeholder="Interviews lined up, vendors to chase tomorrow, anything HR should know" />
        <//>
        ${
          existing &&
          html`<div className="note info">
              <span>You already sent a report for this day at ${fmtTime(existing.at)}. Sending again replaces it.</span>
            </div>`
        }
        <div className="actions">
          <button className="btn lg go" disabled=${busy} onClick=${send}>
            <${Icon} n="send" />
            ${busy ? 'Sending…' : existing ? 'Send again' : 'Send to HR and admin'}
          </button>
          <span className="muted small">One click: saved to the HR and admin portals${P.settings.eodMail ? ' and emailed' : ''}.</span>
        </div>
      </section>
      <section className="panel">
        <h2 className="ph" style=${{ marginBottom: 8 }}>Your recent reports</h2>
        ${
          reports.length
            ? html`<ul className="list">
                ${reports.slice(0, 20).map(
                  r => html`<li key=${r.id}>
                      <div>
                        <div className="t">
                          ${fmtDate(r.d, { weekday: 'short', month: 'short', day: 'numeric' })}
                        </div>
                        <div className="m">
                          ${r.rtr} RTR, ${r.subs} submissions, ${r.cands} consultants added${r.intv ? `, ${r.intv} interviews` : ''}${r.note ? '. ' + r.note.slice(0, 80) : ''}
                        </div>
                      </div>
                      <span className="muted small num">
                        ${fmtTime(r.at)}
                      </span>
                    </li>`
                )}
              </ul>`
            : html`<${Empty} title="No reports sent yet">Your daily reports are listed here after you send them.<//>`
        }
      </section>
    </div>`;
}
