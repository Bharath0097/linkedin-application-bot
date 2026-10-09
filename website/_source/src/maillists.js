/* ================= v37.5 Distribution lists (Email › Lists) =================
   Named lists of vendor and client contacts, team members, consultants, candidates and any addresses, with a selection
   that keeps itself up to date. Administrators and HR make them and choose who may send to each; the team picks a list
   in New email or Share requirements. A list can have its own address: mail to it reaches every member (read from the
   list's mailbox, or handed over by Mailgun / Postal). Routes dl_* (api/maillists.php). */

const DL_ST = { active: ['Active', 'ok'], paused: ['Paused', 'amber'] };
const DL_MSG_ST = { relayed: ['Passed on', 'ok'], sent: ['Sent', 'ok'], held: ['Held for you', 'amber'], dropped: ['Not passed on', ''], discarded: ['Discarded', ''], duplicate: ['Already received', ''] };
const DL_SRC = [
  ['vendors', 'Vendors & clients'],
  ['team', 'Team'],
  ['consultants', 'Consultants'],
  ['candidates', 'ATS candidates'],
  ['contacts', 'Contacts'],
];
const dlWho = r => (r.byn ? r.byn : r.fromN || r.from || '—');

function MailLists({ q, onSend }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(null); // a list's id, or 'new'
  const load = () =>
    api('dl_lists', {}).then(
      r => {
        setD(r);
        setErr(null);
      },
      e => setErr(e)
    );
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (q && q.dl) setOpen(q.dl);
  }, [q && q.dl]);
  if (err) return html`<${LoadError} error=${err} onRetry=${load} />`;
  if (!d) return html`<${Spinner} label="Loading the lists…" />`;
  const rows = d.rows || [];
  return html`<div className="stack dladmin">
      <div className="toolbar">
        <p className="muted small" style=${{ margin: 0, maxWidth: 760 }}>${d.manager ? 'Lists of vendors, clients, your team, consultants and candidates. Choose who may send to each; they pick the list in New email or Share requirements, and every person gets their own copy under the list’s name. A list can also have its own address that passes mail on to everyone on it.' : 'The lists you may send to. Pick one in New email or Share requirements: every person gets their own copy, under the list’s name.'}</p>
        ${d.manager && html`<div className="push"><button className="btn" onClick=${() => setOpen('new')}><${Icon} n="plus" />New list</button></div>`}
      </div>
      <section className="panel" style=${{ padding: '6px 8px' }}>
        ${
          rows.length
            ? html`<div className="tblwrap"><table className="tbl">
                <thead><tr><th>List</th><th className="r">Reaches</th><th>Its address</th><th>Last sent</th>${d.manager && html`<th>Status</th>`}<th /></tr></thead>
                <tbody>${rows.map(r => {
                  const st = DL_ST[r.status] || [r.status, ''];
                  return html`<tr key=${r.id} className=${d.manager ? 'click' : ''} tabIndex=${d.manager ? 0 : undefined} onClick=${() => d.manager && setOpen(r.id)} onKeyDown=${e => d.manager && e.key === 'Enter' && setOpen(r.id)}>
                    <td><b style=${{ fontWeight: 600 }}>${r.name}</b><div className="muted small">${r.descr || r.ruleText || ''}</div></td>
                    <td className="r num">${(r.reach || 0).toLocaleString()}${d.manager && r.held ? html`<div><${Chip} s="amber">${r.held} held<//></div>` : null}</td>
                    <td className="small">${r.addr || html`<span className="muted">—</span>`}</td>
                    <td className="small nw">${r.lastSent ? fmtTs(r.lastSent) : html`<span className="muted">never</span>`}</td>
                    ${d.manager && html`<td><${Chip} s=${st[1]}>${st[0]}<//></td>`}
                    <td className="r nw">
                      ${r.status === 'active' && html`<button className="btn ghost sm" onClick=${e => {
                        e.stopPropagation();
                        onSend(r);
                      }}><${Icon} n="send" />Send</button>`}
                      ${d.manager && html` <button className="btn ghost sm" onClick=${e => {
                        e.stopPropagation();
                        setOpen(r.id);
                      }}>Open</button>`}
                    </td>
                  </tr>`;
                })}</tbody>
              </table></div>`
            : html`<${Empty} title=${d.manager ? 'No lists yet' : 'No lists for you yet'} action=${d.manager ? html`<button className="btn" onClick=${() => setOpen('new')}>Make the first list</button>` : null}>${d.manager ? 'For example "NJ prime vendors" for requirements, "Bench consultants" for hotlists, or "Recruiting team" with its own address.' : 'Ask an administrator or HR to add you as a sender on a list.'}<//>`
        }
      </section>
      ${
        open &&
        html`<${DlEditor} key=${open} id=${open === 'new' ? '' : open} meta=${d} onClose=${() => setOpen(null)} onChanged=${load} onCreated=${id => {
          load();
          setOpen(id);
        }} onSend=${onSend} />`
      }
    </div>`;
}

function DlEditor({ id, meta, onClose, onChanged, onCreated, onSend }) {
  const toast = useToast();
  const [g, setG] = useState(null); // dl_get: list, reach, msgs
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState(id ? 'members' : 'settings');
  const load = () =>
    id
      ? api('dl_get', { id }).then(
          r => {
            setG(r);
            setErr(null);
          },
          e => setErr(e)
        )
      : Promise.resolve();
  useEffect(() => {
    load();
  }, [id]);
  const L = g ? g.list : null;
  const held = g ? g.msgs.filter(m => m.st === 'held').length : 0;
  const tabs = id
    ? [
        ['members', 'Members'],
        ['settings', 'Settings'],
        ['address', 'Its address'],
        ['activity', 'Activity', held || null],
      ]
    : [['settings', 'Settings']];
  let body;
  if (err) body = html`<${LoadError} error=${err} onRetry=${load} />`;
  else if (id && !g) body = html`<${Spinner} />`;
  else if (tab === 'settings')
    body = html`<${DlSettings} L=${L} meta=${meta} onSaved=${l => {
      if (!id) {
        toast('List made. Now add its members.');
        onCreated(l.id);
        return;
      }
      toast('Saved.');
      load();
      onChanged();
    }} onDeleted=${() => {
      toast('List deleted.');
      onChanged();
      onClose();
    }} />`;
  else if (tab === 'members')
    body = html`<${DlMembers} L=${L} reach=${g.reach} meta=${meta} onChanged=${() => {
      load();
      onChanged();
    }} />`;
  else if (tab === 'address')
    body = html`<${DlAddress} L=${L} meta=${meta} onSaved=${() => {
      load();
      onChanged();
    }} />`;
  else
    body = html`<${DlActivity} L=${L} msgs=${g.msgs} onChanged=${() => {
      load();
      onChanged();
    }} />`;
  return html`<${Modal} title=${L ? L.name : 'New distribution list'} onClose=${onClose} wide foot=${L && L.status === 'active' ? html`<button className="btn ghost" onClick=${() => onSend(L)}><${Icon} n="send" />Send to this list</button>` : null}>
      ${L && html`<p className="muted small" style=${{ margin: '0 0 10px' }}>Reaches <b>${(g.reach || 0).toLocaleString()}</b> ${g.reach === 1 ? 'person' : 'people'} now${L.addr ? ' · its address: ' + L.addr : ''}${L.status === 'paused' ? ' · paused: nothing is sent to it or passed on' : ''}.</p>`}
      <${KitTabs} tabs=${tabs} tab=${tab} onTab=${setTab} />
      ${body}
    <//>`;
}

function DlSettings({ L, meta, onSaved, onDeleted }) {
  const toast = useToast();
  const [f, setF] = useState(() =>
    L
      ? { name: L.name, descr: L.descr, fromName: L.fromName, reply: L.reply, replyTo: L.replyTo, prefix: L.prefix, status: L.status, roles: [...L.senders.roles], uids: [...L.senders.uids] }
      : { name: '', descr: '', fromName: '', reply: 'sender', replyTo: '', prefix: '', status: 'active', roles: ['everyone'], uids: [] }
  );
  const [busy, setBusy] = useState('');
  const [del, setDel] = useState('');
  const [pick, setPick] = useState('');
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const team = meta.team || [];
  const save = async () => {
    if (f.name.trim().length < 2) return toast('Give the list a name.', true);
    setBusy('save');
    try {
      const r = await api('dl_save', { ...(L ? { id: L.id } : {}), name: f.name.trim(), descr: f.descr, fromName: f.fromName, reply: f.reply, replyTo: f.replyTo, prefix: f.prefix, status: f.status, senders: { roles: f.roles, uids: f.uids } });
      onSaved(r.list);
    } catch (x) {
      toast(errText(x), true);
    }
    setBusy('');
  };
  const remove = async () => {
    setBusy('delete');
    try {
      await api('dl_delete', { id: L.id, confirm: del });
      onDeleted();
    } catch (x) {
      toast(errText(x), true);
    }
    setBusy('');
  };
  const everyone = f.roles.includes('everyone');
  return html`<div className="form">
      <div className="row2">
        <${Field} label="Name"><input value=${f.name} maxLength="120" onInput=${e => set('name', e.target.value)} placeholder="NJ prime vendors" /><//>
        <${Field} label="Sender name" hint=${'Shown as the sender of its emails. Empty: "' + (f.name || 'the list') + '".'}><input value=${f.fromName} maxLength="120" onInput=${e => set('fromName', e.target.value)} placeholder="StratEdge Requirements" /><//>
      </div>
      <${Field} label="What it is for (optional)"><input value=${f.descr} maxLength="500" onInput=${e => set('descr', e.target.value)} placeholder="Prime vendors in New Jersey: requirements and hotlists" /><//>
      <div className="fld">
        <span>Who may send to it</span>
        <span className="muted small">Administrators and HR always may.</span>
        <div className="dlroles">
          ${Object.entries(meta.roles || {}).map(
            ([k, n]) => html`<label key=${k} className="check">
                <input type="checkbox" checked=${f.roles.includes(k)} disabled=${k !== 'everyone' && everyone} onChange=${e => set('roles', e.target.checked ? (k === 'everyone' ? ['everyone'] : [...f.roles, k]) : f.roles.filter(x => x !== k))} />
                <span>${n}</span>
              </label>`
          )}
        </div>
        ${
          !everyone &&
          html`<div className="actions" style=${{ alignItems: 'center', marginTop: 6 }}>
              ${f.uids.map(u => {
                const p = team.find(t => t.id === u);
                return html`<span key=${u} className="chip">${p ? p.name : u}<button type="button" className="btn link" style=${{ marginLeft: 6 }} aria-label=${'Remove ' + (p ? p.name : u)} onClick=${() => set('uids', f.uids.filter(x => x !== u))}>×</button></span>`;
              })}
              <select value=${pick} style=${{ width: 'auto', minWidth: 200 }} aria-label="Add a person who may send" onChange=${e => {
                const v = e.target.value;
                if (v && !f.uids.includes(v)) set('uids', [...f.uids, v]);
                setPick('');
              }}>
                <option value="">Add a person…</option>
                ${team.filter(t => !f.uids.includes(t.id)).map(t => html`<option key=${t.id} value=${t.id}>${t.name} (${t.email})</option>`)}
              </select>
            </div>`
        }
      </div>
      <div className="fld">
        <span>Replies go to</span>
        <div className="dlroles">
          ${Object.entries(meta.reply || {}).map(
            ([k, n]) => html`<label key=${k} className="check">
                <input type="radio" name="dlreply" value=${k} checked=${f.reply === k} disabled=${k === 'list' && !(L && L.addr)} onChange=${() => set('reply', k)} />
                <span>${n}${k === 'list' && !(L && L.addr) ? html` <span className="muted small">(give the list an address first, under Its address)</span>` : ''}</span>
              </label>`
          )}
        </div>
        ${f.reply === 'fixed' && html`<input type="email" value=${f.replyTo} onInput=${e => set('replyTo', e.target.value)} placeholder="reqs@yourcompany.com" aria-label="Replies go to this address" style=${{ marginTop: 6 }} />`}
      </div>
      <div className="row2">
        <${Field} label="Subject prefix (optional)" hint="Put in front of the subject of mail passed on from the list's address."><input value=${f.prefix} maxLength="40" onInput=${e => set('prefix', e.target.value)} placeholder="[NJ Vendors]" /><//>
        <${Field} label="Status">
          <select value=${f.status} onChange=${e => set('status', e.target.value)}>
            <option value="active">Active</option>
            <option value="paused">Paused (nothing sent to it or passed on; mail to its address waits)</option>
          </select>
        <//>
      </div>
      <div className="actions"><button className="btn" disabled=${!!busy} onClick=${save}>${busy === 'save' ? 'Saving…' : L ? 'Save' : 'Make the list'}</button></div>
      ${
        L &&
        html`<details className="dldanger">
            <summary className="small">Delete the list</summary>
            <p className="small" style=${{ margin: '8px 0' }}>Its members and activity are deleted; people stay in Contacts and everywhere else.</p>
            <div className="actions" style=${{ alignItems: 'center' }}>
              <input value=${del} onInput=${e => setDel(e.target.value)} placeholder=${'Type ' + L.name + ' to confirm'} aria-label="Type the list's name to confirm" style=${{ maxWidth: 320 }} />
              <button className="btn danger" disabled=${del !== L.name || busy === 'delete'} onClick=${remove}>Delete it</button>
            </div>
          </details>`
      }
    </div>`;
}

function DlMembers({ L, reach, meta, onChanged }) {
  const toast = useToast();
  const [src, setSrc] = useState(null); // mail_sources: types, tags, counts for the selection
  const [rule, setRule] = useState(() => ({ groups: [], ats: false, atsStage: '', vms: false, vmsTypes: [], rec: false, contacts: false, tags: [], ...L.rule }));
  const [prev, setPrev] = useState(null);
  const [m, setM] = useState(null); // dl_members
  const [qq, setQq] = useState('');
  const [kind, setKind] = useState('');
  const [st, setSt] = useState('');
  const [off, setOff] = useState(0);
  const [sel, setSel] = useState([]);
  const [add, setAdd] = useState(false);
  const [busy, setBusy] = useState('');
  const loadM = (o = 0) =>
    api('dl_members', { id: L.id, q: qq, kind, st, off: o, limit: 200 }).then(
      r => setM(x => (o > 0 && x ? { rows: [...x.rows, ...r.rows], total: r.total } : r)),
      e => toast(errText(e), true)
    );
  useEffect(() => {
    api('mail_sources').then(setSrc, () => setSrc({}));
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      setOff(0);
      setSel([]);
      loadM(0);
    }, 250);
    return () => clearTimeout(t);
  }, [qq, kind, st]);
  const ruleKey = JSON.stringify(rule);
  useEffect(() => {
    const t = setTimeout(() => {
      api('dl_preview', { rule })
        .then(setPrev)
        .catch(() => setPrev(null));
    }, 350);
    return () => clearTimeout(t);
  }, [ruleKey]);
  const ruleSaved = JSON.stringify({ groups: [], ats: false, atsStage: '', vms: false, vmsTypes: [], rec: false, contacts: false, tags: [], ...L.rule }) === ruleKey;
  const toggle = (arr, v) => (arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);
  const saveRule = async () => {
    setBusy('rule');
    try {
      await api('dl_save', { id: L.id, rule });
      toast('The selection is saved: it updates itself as people come and go.');
      onChanged();
    } catch (x) {
      toast(errText(x), true);
    }
    setBusy('');
  };
  const removeSel = async () => {
    if (!sel.length) return;
    setBusy('remove');
    try {
      const r = await api('dl_members_remove', { id: L.id, emails: sel });
      toast(plural(r.removed, 'person', 'people') + ' taken off the list.');
      setSel([]);
      loadM(0);
      onChanged();
    } catch (x) {
      toast(errText(x), true);
    }
    setBusy('');
  };
  const back = async email => {
    if (!window.confirm('Put ' + email + ' back on the list? Do this only when they asked for it: they left it themselves.')) return;
    try {
      await api('dl_member_back', { id: L.id, email });
      toast(email + ' is on the list again.');
      loadM(0);
      onChanged();
    } catch (x) {
      toast(errText(x), true);
    }
  };
  const exportCsv = async () => {
    try {
      const r = await api('dl_export', { id: L.id });
      await saveDownload(r.name, r.csv);
    } catch (x) {
      if (!x || x.code !== 'declined') toast(errText(x), true);
    }
  };
  const vt = Object.entries((src && src.vms && src.vms.types) || {});
  const tagList = Object.entries((src && src.tags) || {});
  const rows = (m && m.rows) || [];
  const allOn = rows.length > 0 && rows.filter(r => r.st === 'in').every(r => sel.includes(r.email));
  return html`<div className="stack">
      <section className="panel soft stack" style=${{ gap: 10, padding: 14 }}>
        <div><b>Kept up to date</b><span className="muted small" style=${{ display: 'block' }}>Everyone in what you tick is on the list, now and later: people join and leave it with your records.</span></div>
        <div className="actions">
          ${[
            ['employees', 'Employees'],
            ['consultants', 'Consultants in the portal'],
            ['clients', 'Client contacts'],
          ].map(([k, n]) => html`<label key=${k} className="check"><input type="checkbox" checked=${rule.groups.includes(k)} onChange=${() => setRule({ ...rule, groups: toggle(rule.groups, k) })} /><span>${n}${src && src[k] != null ? ' (' + src[k].toLocaleString() + ')' : ''}</span></label>`)}
        </div>
        <label className="check"><input type="checkbox" checked=${rule.vms} onChange=${e => setRule({ ...rule, vms: e.target.checked, vmsTypes: e.target.checked ? rule.vmsTypes : [] })} /><span>Vendor and client contacts${src && src.vms ? ' (' + src.vms.n.toLocaleString() + ')' : ''}</span></label>
        ${vt.length > 0 && rule.vms && html`<div className="actions" style=${{ marginLeft: 28 }}><span className="muted small">Only:</span>${vt.map(([t, n]) => html`<button key=${t} type="button" className=${'chip' + (rule.vmsTypes.includes(t) ? ' new' : '')} style=${{ border: 0, cursor: 'pointer' }} aria-pressed=${rule.vmsTypes.includes(t)} onClick=${() => setRule({ ...rule, vmsTypes: toggle(rule.vmsTypes, t) })}>${t} · ${n}</button>`)}</div>`}
        <label className="check"><input type="checkbox" checked=${rule.rec} onChange=${e => setRule({ ...rule, rec: e.target.checked })} /><span>The consultant database${src && src.rec != null ? ' (' + src.rec.toLocaleString() + ')' : ''}</span></label>
        <div className="actions" style=${{ alignItems: 'center' }}>
          <label className="check"><input type="checkbox" checked=${rule.ats} onChange=${e => setRule({ ...rule, ats: e.target.checked })} /><span>ATS applicants</span></label>
          ${rule.ats && html`<select style=${{ width: 'auto' }} value=${rule.atsStage} onChange=${e => setRule({ ...rule, atsStage: e.target.value })} aria-label="Applicant stage"><option value="">All stages except rejected</option>${Object.entries(ATS_ST).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select>`}
        </div>
        <label className="check"><input type="checkbox" checked=${rule.contacts} onChange=${e => setRule({ ...rule, contacts: e.target.checked, tags: e.target.checked ? rule.tags : [] })} /><span>Contacts${src && src.contacts != null ? ' (' + src.contacts.toLocaleString() + ')' : ''}</span></label>
        ${tagList.length > 0 && rule.contacts && html`<div className="actions" style=${{ marginLeft: 28 }}><span className="muted small">Only these tags:</span>${tagList.map(([t, n]) => html`<button key=${t} type="button" className=${'chip' + (rule.tags.includes(t) ? ' new' : '')} style=${{ border: 0, cursor: 'pointer' }} aria-pressed=${rule.tags.includes(t)} onClick=${() => setRule({ ...rule, tags: toggle(rule.tags, t) })}>${t} · ${n}</button>`)}</div>`}
        <div className="actions" style=${{ alignItems: 'center' }}>
          <span className="small">${prev ? (prev.n ? plural(prev.n, 'person', 'people') + ' in the selection' + (prev.sample.length ? ': ' + prev.sample.slice(0, 3).join(', ') + (prev.n > 3 ? ', …' : '') : '') : 'Nothing ticked: only the people added by hand') : 'Counting…'}</span>
          <button className="btn sm push" disabled=${ruleSaved || busy === 'rule'} onClick=${saveRule}>${busy === 'rule' ? 'Saving…' : 'Save the selection'}</button>
        </div>
      </section>
      <div className="toolbar">
        <b>Added by hand</b>
        <input type="search" value=${qq} onInput=${e => setQq(e.target.value)} placeholder="Search name, email, company" aria-label="Search members" style=${{ maxWidth: 240 }} />
        <select value=${kind} onChange=${e => setKind(e.target.value)} aria-label="Kind" style=${{ width: 'auto' }}><option value="">Every kind</option>${Object.entries(meta.kinds || {}).map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select>
        <select value=${st} onChange=${e => setSt(e.target.value)} aria-label="Status" style=${{ width: 'auto' }}><option value="">Members and people who left</option><option value="in">Members</option><option value="left">People who left</option></select>
        <div className="push actions">
          <button className="btn ghost sm" onClick=${exportCsv}><${Icon} n="down" />CSV</button>
          <button className="btn sm" onClick=${() => setAdd(!add)}><${Icon} n="plus" />Add people</button>
        </div>
      </div>
      ${
        add &&
        html`<${DlAdd} L=${L} meta=${meta} onAdded=${() => {
          loadM(0);
          onChanged();
        }} />`
      }
      <section className="panel" style=${{ padding: '6px 8px' }}>
        ${
          !m
            ? html`<${Spinner} />`
            : rows.length
              ? html`<div className="tblwrap"><table className="tbl small">
                  <thead><tr><th style=${{ width: 32 }}><input type="checkbox" checked=${allOn} aria-label="Select everyone shown" onChange=${e => setSel(e.target.checked ? rows.filter(r => r.st === 'in').map(r => r.email) : [])} /></th><th>Person</th><th>Email</th><th>Kind</th><th>Added from</th><th /></tr></thead>
                  <tbody>${rows.map(
                    r => html`<tr key=${r.email}>
                      <td>${r.st === 'in' && html`<input type="checkbox" checked=${sel.includes(r.email)} aria-label=${'Select ' + r.email} onChange=${() => setSel(toggle(sel, r.email))} />`}</td>
                      <td><b style=${{ fontWeight: 600 }}>${r.name || '—'}</b>${r.company || r.title ? html`<div className="muted">${[r.company, r.title].filter(Boolean).join(' · ')}</div>` : null}</td>
                      <td>${r.email}</td>
                      <td>${(meta.kinds || {})[r.kind] || r.kind}</td>
                      <td className="muted">${r.src || '—'}<div>${fmtDay(r.added)}</div></td>
                      <td className="r nw">${r.st === 'left' ? html`<${Chip} s="">Left ${fmtDay(r.leftAt)}<//> <button className="btn link small" onClick=${() => back(r.email)}>Add back…</button>` : r.unsub ? html`<${Chip} s="amber">Unsubscribed<//>` : null}</td>
                    </tr>`
                  )}</tbody>
                </table></div>
                <div className="actions" style=${{ padding: '8px 4px', alignItems: 'center' }}>
                  <span className="muted small">${rows.length.toLocaleString()} of ${m.total.toLocaleString()} shown</span>
                  ${rows.length < m.total && html`<button className="btn ghost sm" onClick=${() => {
                    const o = off + 200;
                    setOff(o);
                    loadM(o);
                  }}>Show more</button>`}
                  ${sel.length > 0 && html`<button className="btn danger sm push" disabled=${busy === 'remove'} onClick=${removeSel}>Take ${plural(sel.length, 'person', 'people')} off the list</button>`}
                </div>`
              : html`<${Empty} title=${qq || kind || st ? 'Nobody matches' : 'Nobody added by hand yet'}>${qq || kind || st ? 'Try another search.' : 'Use "Add people" for vendor contacts, your team, consultants, candidates, pasted addresses or a CSV file. The selection above adds whole groups.'}<//>`
        }
      </section>
      <p className="muted small" style=${{ margin: 0 }}>Reaches ${(reach || 0).toLocaleString()} now: the people added by hand and the selection, without anyone who left the list or unsubscribed from all email.</p>
    </div>`;
}

function DlAdd({ L, meta, onAdded }) {
  const toast = useToast();
  const [how, setHow] = useState('portal');
  const [src, setSrc] = useState('vendors');
  const [q, setQ] = useState('');
  const [found, setFound] = useState(null);
  const [sel, setSel] = useState([]);
  const [paste, setPaste] = useState('');
  const [kind, setKind] = useState('vendor');
  const [csv, setCsv] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (how !== 'portal') return;
    const t = setTimeout(() => {
      api('dl_pick', { src, q })
        .then(r => {
          setFound(r.rows);
          setSel([]);
        })
        .catch(e => toast(errText(e), true));
    }, 300);
    return () => clearTimeout(t);
  }, [how, src, q]);
  const said = r => {
    const parts = [plural(r.added, 'person', 'people') + ' added'];
    if (r.already) parts.push(r.already + ' already on the list');
    if (r.left) parts.push(r.left + ' left it before and were not put back');
    if (r.bad) parts.push(r.bad + ' without a valid address');
    if (r.unsub) parts.push(r.unsub + ' unsubscribed from all email (on the list, but not emailed)');
    return parts.join(', ') + '.';
  };
  const go = async body => {
    setBusy(true);
    try {
      const r = await api('dl_members_add', { id: L.id, ...body });
      toast(said(r));
      onAdded();
      setSel([]);
      setPaste('');
      setCsv(null);
    } catch (x) {
      toast(errText(x), true);
    }
    setBusy(false);
  };
  const readCsv = async e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const parsed = csvToContacts(parseCSV(await file.text()));
    if (!parsed.list.length) return toast('No email addresses found in that file. It needs a column of addresses (a header like "Email" helps).', true);
    setCsv({ name: file.name, list: parsed.list });
  };
  const toggle = (arr, v) => (arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);
  const rows = found || [];
  return html`<section className="panel soft stack" style=${{ gap: 10, padding: 14 }}>
      <${KitTabs} tabs=${[['portal', 'From the portal'], ['paste', 'Paste addresses'], ['csv', 'Import a CSV']]} tab=${how} onTab=${setHow} />
      ${
        how === 'portal' &&
        html`<${Fragment}>
          <div className="actions" style=${{ alignItems: 'center' }}>
            <select value=${src} onChange=${e => setSrc(e.target.value)} aria-label="Add from" style=${{ width: 'auto' }}>${DL_SRC.map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select>
            <input type="search" value=${q} onInput=${e => setQ(e.target.value)} placeholder="Search name, email, company or type" aria-label="Search people to add" style=${{ maxWidth: 300 }} />
          </div>
          ${
            !found
              ? html`<${Spinner} />`
              : rows.length
                ? html`<div className="tblwrap" style=${{ maxHeight: 320, overflow: 'auto' }}><table className="tbl small">
                    <thead><tr><th style=${{ width: 32 }}><input type="checkbox" aria-label="Select all found" checked=${sel.length === rows.length} onChange=${e => setSel(e.target.checked ? rows.map(r => r.email) : [])} /></th><th>Person</th><th>Email</th><th>From</th></tr></thead>
                    <tbody>${rows.map(r => html`<tr key=${r.email}><td><input type="checkbox" checked=${sel.includes(r.email)} aria-label=${'Select ' + r.email} onChange=${() => setSel(toggle(sel, r.email))} /></td><td><b style=${{ fontWeight: 600 }}>${r.name || '—'}</b>${r.company || r.title ? html`<div className="muted">${[r.company, r.title].filter(Boolean).join(' · ')}</div>` : null}</td><td>${r.email}</td><td className="muted">${r.src}</td></tr>`)}</tbody>
                  </table></div>
                  <div className="actions"><button className="btn sm" disabled=${busy || !sel.length} onClick=${() => go({ members: rows.filter(r => sel.includes(r.email)) })}>Add ${sel.length ? plural(sel.length, 'person', 'people') : 'the ones ticked'}</button></div>`
                : html`<p className="muted small" style=${{ margin: 0 }}>Nobody found${q ? ' for "' + q + '"' : ''}.</p>`
          }
        <//>`
      }
      ${
        how === 'paste' &&
        html`<${Fragment}>
          <${Field} label="Addresses" hint="One per line: name@company.com, or Jane Smith <jane@company.com>. Copied spreadsheet rows work too."><textarea rows="5" value=${paste} onInput=${e => setPaste(e.target.value)} placeholder="jane@vendor.com" /><//>
          <div className="actions" style=${{ alignItems: 'center' }}>
            <select value=${kind} onChange=${e => setKind(e.target.value)} aria-label="They are" style=${{ width: 'auto' }}>${Object.entries(meta.kinds || {}).map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select>
            <button className="btn sm" disabled=${busy || !paste.trim()} onClick=${() => go({ paste, kind })}>Add them</button>
          </div>
        <//>`
      }
      ${
        how === 'csv' &&
        html`<${Fragment}>
          <p className="muted small" style=${{ margin: 0 }}>A CSV with a column of email addresses; name, company and title columns are used when they are there (for example an export of a vendor list from Outlook, Gmail or a spreadsheet).</p>
          <div className="actions" style=${{ alignItems: 'center' }}>
            <label className="btn ghost sm" style=${{ cursor: 'pointer' }}><${Icon} n="up" />Choose a CSV file<input type="file" accept=".csv,text/csv" hidden onChange=${readCsv} /></label>
            ${csv && html`<span className="small">${csv.name}: ${plural(csv.list.length, 'address', 'addresses')}</span>`}
          </div>
          ${
            csv &&
            html`<div className="actions" style=${{ alignItems: 'center' }}>
                <select value=${kind} onChange=${e => setKind(e.target.value)} aria-label="They are" style=${{ width: 'auto' }}>${Object.entries(meta.kinds || {}).map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select>
                <button className="btn sm" disabled=${busy} onClick=${() => go({ members: csv.list.map(c => ({ email: c.email, name: c.name, company: c.company, title: c.title, kind, src: 'CSV: ' + csv.name })) })}>Add ${plural(csv.list.length, 'person', 'people')}</button>
              </div>`
          }
        <//>`
      }
    </section>`;
}

function DlAddress({ L, meta, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ addr: L.addr, post: L.post });
  const im0 = L.imap || {};
  const [im, setIm] = useState({ on: !!im0.on, host: im0.host || '', port: im0.port || 993, sec: im0.sec || 'ssl', user: im0.user || L.addr || '', pass: '', folder: im0.folder || 'INBOX' });
  const [busy, setBusy] = useState('');
  const [test, setTest] = useState(null);
  const [last, setLast] = useState(im0);
  const saveAddr = async () => {
    setBusy('addr');
    try {
      await api('dl_save', { id: L.id, addr: f.addr.trim(), post: f.post });
      toast(f.addr.trim() ? 'Saved. Mail to ' + f.addr.trim() + ' goes to the list once it reaches the portal (below).' : 'Saved: the list has no address.');
      onSaved();
    } catch (x) {
      toast(errText(x), true);
    }
    setBusy('');
  };
  const saveIm = async () => {
    setBusy('imap');
    try {
      const r = await api('dl_imap_save', { id: L.id, ...im, port: +im.port || 993 });
      setLast(r.imap);
      setIm(x => ({ ...x, pass: '' }));
      toast(im.on ? 'Saved. The mailbox is checked every few minutes by the scheduled task.' : 'Saved: the mailbox is not checked.');
      onSaved();
    } catch (x) {
      if (!x || x.code !== 'declined') toast(errText(x), true);
    }
    setBusy('');
  };
  const runTest = async () => {
    setBusy('test');
    setTest(null);
    try {
      setTest(await api('dl_imap_test', { id: L.id }));
    } catch (x) {
      setTest({ ok: false, msg: errText(x) });
    }
    setBusy('');
  };
  const check = async () => {
    setBusy('check');
    try {
      const r = await api('dl_check', { id: L.id }, { timeout: 130000 });
      setLast(r.imap);
      toast(r.ok ? (r.n ? plural(r.n, 'new message', 'new messages') + ': ' + [r.relayed && r.relayed + ' passed on', r.held && r.held + ' held for you', r.dropped && r.dropped + ' not passed on'].filter(Boolean).join(', ') + '.' : 'No new mail in the mailbox.') : 'The check failed: ' + r.err, !r.ok);
      onSaved();
    } catch (x) {
      toast(errText(x), true);
    }
    setBusy('');
  };
  const set = (k, v) => setIm(x => ({ ...x, [k]: v }));
  return html`<div className="stack">
      <div className="form">
        <${Field} label="The list's own address (optional)" hint="Mail sent to it goes to everyone on the list, shown as from “Sender via the list”. Use an address only this list uses.">
          <input type="email" value=${f.addr} onInput=${e => setF({ ...f, addr: e.target.value })} placeholder="reqs@yourcompany.com" />
        <//>
        <div className="fld">
          <span>Who may write to it</span>
          <div className="dlroles">
            ${Object.entries(meta.post || {}).map(([k, n]) => html`<label key=${k} className="check"><input type="radio" name="dlpost" value=${k} checked=${f.post === k} onChange=${() => setF({ ...f, post: k })} /><span>${n}</span></label>`)}
          </div>
          <span className="muted small">Mail from anyone else, or mail whose sender the receiving mail server could not confirm (no DMARC pass), waits under Activity for an administrator to pass it on or discard it. Automatic replies, delivery reports and the list's own copies are never passed on.</span>
        </div>
        <div className="actions"><button className="btn" disabled=${busy === 'addr'} onClick=${saveAddr}>${busy === 'addr' ? 'Saving…' : 'Save'}</button></div>
      </div>
      <section className="panel soft stack" style=${{ gap: 10, padding: 14 }}>
        <b>How mail to the address reaches the portal</b>
        <p className="small" style=${{ margin: 0 }}><b>With Mailgun or Postal</b> (Email › Sending setup): send the address to the portal's inbound route as you do for its other addresses. Nothing else to set here.</p>
        <p className="small" style=${{ margin: 0 }}><b>Or from a mailbox</b>: create the address as a normal mailbox (cPanel › Email Accounts, Google Workspace or Microsoft 365) and give its sign-in below. The scheduled task reads new mail every few minutes and passes it on; read messages stay in the mailbox.</p>
        <label className="check"><input type="checkbox" checked=${im.on} onChange=${e => set('on', e.target.checked)} /><span>Check this list's mailbox</span></label>
        <div className="form">
          <div className="row3">
            <${Field} label="Mail server" hint="cPanel: mail.yourcompany.com · Gmail: imap.gmail.com · Microsoft 365: outlook.office365.com"><input value=${im.host} onInput=${e => set('host', e.target.value.trim())} placeholder="mail.yourcompany.com" /><//>
            <${Field} label="Port"><input type="number" min="1" max="65535" value=${im.port} onInput=${e => set('port', e.target.value)} /><//>
            <${Field} label="Security">
              <select value=${im.sec} onChange=${e => set('sec', e.target.value)}>
                <option value="ssl">SSL (port 993)</option>
                <option value="tls">STARTTLS (port 143)</option>
              </select>
            <//>
          </div>
          <div className="row3">
            <${Field} label="Mailbox sign-in"><input value=${im.user} onInput=${e => set('user', e.target.value.trim())} placeholder="reqs@yourcompany.com" autoComplete="off" /><//>
            <${Field} label="Password" hint=${last && last.passSet ? 'Saved (encrypted). Leave empty to keep it; a new server, port, security or sign-in needs it again.' : 'Gmail and Microsoft 365 need an app password.'}><input type="password" value=${im.pass} onInput=${e => set('pass', e.target.value)} autoComplete="new-password" placeholder=${last && last.passSet ? '••••••••' : ''} /><//>
            <${Field} label="Folder"><input value=${im.folder} onInput=${e => set('folder', e.target.value)} /><//>
          </div>
        </div>
        <div className="actions">
          <button className="btn" disabled=${!!busy} onClick=${saveIm}>${busy === 'imap' ? 'Saving…' : 'Save the mailbox'}</button>
          <button className="btn ghost" disabled=${!!busy || !(last && last.passSet)} onClick=${runTest}>${busy === 'test' ? 'Testing…' : 'Test the connection'}</button>
          <button className="btn ghost" disabled=${!!busy || !(last && last.on && last.passSet)} onClick=${check}><${Icon} n="refresh" />${busy === 'check' ? 'Checking…' : 'Check now'}</button>
        </div>
        ${test && html`<p className=${'note small ' + (test.ok ? 'ok' : 'amber')} style=${{ margin: 0 }}><span>${test.msg}</span></p>`}
        ${last && last.last ? html`<p className="muted small" style=${{ margin: 0 }}>Last checked ${fmtTs(last.last)}${last.err ? '' : ' · fine'}${last.n ? ' · ' + plural(last.n, 'message') + ' read so far' : ''}.${last.err ? html` <span style=${{ color: 'var(--red-ink)' }}>${last.err}</span>` : ''}</p>` : null}
      </section>
    </div>`;
}

function DlActivity({ L, msgs, onChanged }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const act = async (mid, a) => {
    setBusy(mid);
    try {
      const r = await api('dl_held', { id: L.id, mid, act: a });
      toast(a === 'discard' ? 'Discarded.' : 'Passed on to ' + plural(r.n, 'person', 'people') + '.');
      onChanged();
    } catch (x) {
      toast(errText(x), true);
    }
    setBusy('');
  };
  if (!msgs.length) return html`<${Empty} title="Nothing yet">Emails sent to the list from the portal, and mail that reached its address, show here.<//>`;
  return html`<div className="tblwrap"><table className="tbl small">
      <thead><tr><th>When</th><th>What</th><th>Subject</th><th>Status</th><th className="r">Reached</th></tr></thead>
      <tbody>${msgs.map(m => {
        const st = DL_MSG_ST[m.st] || [m.st, ''];
        return html`<tr key=${m.id}>
          <td className="nw">${fmtTs(m.at)}</td>
          <td>${m.dir === 'out' ? html`<span>Sent from the portal<div className="muted">${dlWho(m)}</div></span>` : html`<span>To its address<div className="muted">${m.fromN ? m.fromN + ' · ' : ''}${m.from || '—'}</div></span>`}</td>
          <td>${m.subject}${m.files && m.files.length ? html`<div className="muted">${plural(m.files.length, 'attachment')}</div>` : null}</td>
          <td><${Chip} s=${st[1]}>${st[0]}<//>${m.why ? html`<div className="muted">${m.why}</div>` : null}
            ${m.st === 'held' && html`<div className="actions" style=${{ marginTop: 6 }}><button className="btn sm" disabled=${busy === m.id} onClick=${() => act(m.id, 'approve')}>Pass it on</button><button className="btn ghost sm" disabled=${busy === m.id} onClick=${() => act(m.id, 'discard')}>Discard</button></div>`}
          </td>
          <td className="r num">${m.n ? m.n.toLocaleString() : '—'}</td>
        </tr>`;
      })}</tbody>
    </table></div>`;
}
