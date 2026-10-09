/* ================= v34: Service desk for staff (Admin, HR and Accounting portals; tools/desk for other group members) =================
   The dashboard and the queue come from desk.js (DeskWork, shared with the Help & support page's Team queue tab).
   Here: Knowledge (help articles, for everyone who works tickets) and, for administrators, the request catalog,
   assignment groups and the desk settings (SLA targets, auto-close, the support address, emails, the assistant).
   Server: api/desk.php (desk_kb all, desk_kb_save, desk_admin, desk_item_save, desk_group_save, desk_delete,
   desk_settings_save). */
const DESK_ICONS = ['file', 'key', 'layers', 'money', 'sheet', 'user', 'star', 'tasks', 'mail', 'cal', 'folder', 'shield', 'brief', 'phone', 'compass', 'help', 'clock', 'globe'];
const DESK_APPR_NAMES = { none: 'No approval', admin: 'An administrator approves first', grp: 'Someone in the group approves first' };
const DESK_ROLE_NAMES = { admin: 'Administrators', hr: 'HR', acct: 'Accounting', manager: 'Managers' };
const DESK_FIELD_TYPES = [['text', 'Short answer'], ['textarea', 'Long answer'], ['select', 'Choice'], ['date', 'Date']];

function ServiceDeskPage({ q }) {
  const admin = (Cap.roles || []).includes('admin');
  const tabs = [['kb', 'Knowledge'], ...(admin ? [['catalog', 'Request catalog'], ['groups', 'Groups'], ['settings', 'Settings']] : [])];
  return html`<${DeskWork}
    q=${q || {}}
    extraTabs=${tabs}
    extra=${tab =>
      tab === 'kb'
        ? html`<${DeskKbAdmin} />`
        : tab === 'catalog'
          ? html`<${DeskCatalogAdmin} />`
          : tab === 'groups'
            ? html`<${DeskGroupsAdmin} />`
            : tab === 'settings'
              ? html`<${DeskSettingsAdmin} />`
              : null}
  />`;
}

/* ---- Knowledge: the help articles ---- */
function DeskKbAdmin() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [edit, setEdit] = useState(null);
  const [q, setQ] = useState('');
  const load = () => api('desk_kb', { all: true }).then(setD, e => toast(errText(e), true));
  useEffect(() => {
    load();
  }, []);
  if (!d) return html`<${Spinner} />`;
  const needle = q.trim().toLowerCase();
  const rows = needle ? d.articles.filter(a => (a.t + ' ' + a.tags + ' ' + a.catName + ' ' + a.body).toLowerCase().includes(needle)) : d.articles;
  return html`<div className="stack">
      <div className="ph-row">
        <p className="muted small" style=${{ margin: 0, maxWidth: 760 }}>Help articles answer common questions on everyone's Help & support page, and the Help button's assistant looks in them first (by title, search words and text) before it offers a ticket. Write them as short steps that use the portal's own page names. "Helpful" counts the answers to "Did this answer your question?".</p>
        <button type="button" className="btn" onClick=${() => setEdit({ t: '', body: '', cat: 'other', tags: '', aud: 'all', pub: true })}><${Icon} n="plus" />New article</button>
      </div>
      <div className="trfilters"><input type="search" value=${q} onInput=${e => setQ(e.target.value)} placeholder="Find an article" aria-label="Find an article" /></div>
      ${
        rows.length
          ? html`<section className="panel" style=${{ padding: '6px 8px' }}><div className="tblwrap"><table className="tbl">
              <thead><tr><th>Article</th><th>Area</th><th>Read</th><th>Helpful</th><th>Status</th><th className="r"><span className="sr">Edit</span></th></tr></thead>
              <tbody>${rows.map(
                a => html`<tr key=${a.id}>
                  <td><b>${a.t}</b>${a.aud === 'staff' && html` <span className="chip">Staff only</span>`}${a.web && html` <span className="chip">On the website</span>`}</td>
                  <td className="small">${a.catName}</td>
                  <td className="small">${a.views}</td>
                  <td className="small">${a.up + a.down ? Math.round((a.up * 100) / (a.up + a.down)) + '% of ' + (a.up + a.down) : '—'}</td>
                  <td>${a.pub ? html`<span className="chip ok">Published</span>` : html`<span className="chip">Draft</span>`}</td>
                  <td className="r"><button type="button" className="btn ghost sm" onClick=${() => setEdit(a)}>Edit</button></td>
                </tr>`
              )}</tbody>
            </table></div></section>`
          : html`<section className="panel"><${Empty} title=${needle ? 'No article matches' : 'No articles yet'}>${needle ? 'Try other words.' : 'Write the answers to the questions people ask most.'}<//></section>`
      }
      ${edit && html`<${DeskKbModal} key=${edit.id || 'new'} a=${edit} cats=${d.cats} admin=${d.admin} onClose=${() => setEdit(null)} onSaved=${() => { setEdit(null); load(); }} />`}
    </div>`;
}
function DeskKbModal({ a, cats, admin, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ ...a });
  const [busy, setBusy] = useState(false);
  const [look, setLook] = useState(false);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const save = async () => {
    setBusy(true);
    try {
      await api('desk_kb_save', { id: a.id || '', t: f.t, body: f.body, cat: f.cat, tags: f.tags, aud: f.aud, pub: !!f.pub, web: !!f.web && f.aud !== 'staff' });
      toast(f.pub ? 'Saved and published.' : 'Saved as a draft.');
      onSaved();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const del = async () => {
    if (!confirm('Delete this article? To keep it out of sight for now, untick Published instead.')) return;
    setBusy(true);
    try {
      await api('desk_delete', { what: 'kb', id: a.id });
      toast('Deleted.');
      onSaved();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<${Modal} wide title=${a.id ? 'Edit article' : 'New article'} onClose=${onClose} foot=${html`${a.id && admin && html`<button className="btn ghost" style=${{ marginRight: 'auto' }} disabled=${busy} onClick=${del}><${Icon} n="trash" />Delete</button>`}<button className="btn ghost" onClick=${() => setLook(!look)}>${look ? 'Edit' : 'Preview'}</button><button className="btn ghost" onClick=${onClose}>Cancel</button><button className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save'}</button>`}>
      ${
        look
          ? html`<article className="stack kbart" style=${{ gap: 10 }}>
              <span className="muted small">${cats[f.cat] || ''}</span>
              <h2 className="ph" style=${{ margin: 0 }}>${f.t || 'Untitled'}</h2>
              ${String(f.body || '').split(/\n{2,}/).map((p, i) => (/^- /m.test(p) ? html`<ul key=${i}>${p.split('\n').map((l, j) => html`<li key=${j}>${l.replace(/^- /, '')}</li>`)}</ul>` : html`<p key=${i}>${p}</p>`))}
            </article>`
          : html`<div className="form">
              <${Field} label="Title" hint="The question as people would ask it: Can't sign in, Where is my paystub?"><input value=${f.t} onInput=${e => set('t', e.target.value)} maxLength="200" /><//>
              <div className="row2">
                <${Field} label="Area"><select value=${f.cat} onChange=${e => set('cat', e.target.value)}>${Object.entries(cats).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//>
                <${Field} label="Who can read it"><select value=${f.aud} onChange=${e => set('aud', e.target.value)}><option value="all">Everyone signed in</option><option value="staff">Staff and the service desk only</option></select><//>
              </div>
              <${Field} label="Search words" hint="Other words people use for it, separated by spaces (password reset locked 2fa). They help the assistant find the article."><input value=${f.tags} onInput=${e => set('tags', e.target.value)} maxLength="400" /><//>
              <${Field} label="Text" hint="A blank line starts a new paragraph; lines that start with a dash and a space become a list. Never put passwords or personal details here."><textarea rows="12" value=${f.body} onInput=${e => set('body', e.target.value)} /><//>
              <label className="check"><input type="checkbox" checked=${!!f.pub} onChange=${e => set('pub', e.target.checked)} /><span>Published: shown on the Help page and used by the assistant</span></label>
              ${f.aud !== 'staff' && html`<label className="check"><input type="checkbox" checked=${!!f.web} onChange=${e => set('web', e.target.checked)} /><span>Also on the public website's Help & support page (for sign-in problems: anyone can read it there)</span></label>`}
            </div>`
      }
    <//>`;
}

/* ---- the request catalog ---- */
function DeskCatalogAdmin() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [edit, setEdit] = useState(null);
  const load = () => api('desk_admin', {}).then(setD, e => toast(errText(e), true));
  useEffect(() => {
    load();
  }, []);
  if (!d) return html`<${Spinner} />`;
  const gname = id => (d.groups.find(g => g.id === id) || {}).n || id;
  return html`<div className="stack">
      <div className="ph-row">
        <p className="muted small" style=${{ margin: 0, maxWidth: 760 }}>What people can request under Help & support › Get help › Request something. Each request type goes to a group, can need an approval before the group starts, and asks its own questions. The response and fix targets start when it is approved.</p>
        <button type="button" className="btn" onClick=${() => setEdit({ t: '', d: '', cat: 'other', grp: d.groups.some(g => g.id === 'gen') ? 'gen' : (d.groups[0] || {}).id, icon: 'tasks', appr: 'none', fields: [], pub: true, ord: 50 })}><${Icon} n="plus" />New request type</button>
      </div>
      ${
        d.catalog.length
          ? html`<section className="panel" style=${{ padding: '6px 8px' }}><div className="tblwrap"><table className="tbl">
              <thead><tr><th>Request</th><th>Goes to</th><th>Approval</th><th>Questions</th><th>Status</th><th className="r"><span className="sr">Edit</span></th></tr></thead>
              <tbody>${d.catalog.map(
                c => html`<tr key=${c.id}>
                  <td><span className="deskcatname"><${Icon} n=${c.icon} /><b>${c.t}</b></span><div className="muted small">${c.d}</div></td>
                  <td className="small">${gname(c.grp)}</td>
                  <td className="small">${c.appr === 'none' ? '—' : DESK_APPR_NAMES[c.appr]}</td>
                  <td className="small">${c.fields.length}</td>
                  <td>${c.pub ? html`<span className="chip ok">Offered</span>` : html`<span className="chip">Hidden</span>`}</td>
                  <td className="r"><button type="button" className="btn ghost sm" onClick=${() => setEdit(c)}>Edit</button></td>
                </tr>`
              )}</tbody>
            </table></div></section>`
          : html`<section className="panel"><${Empty} title="Nothing to request yet">Add the things people ask for most: letters, access to a tool, equipment, a payroll correction.<//></section>`
      }
      ${edit && html`<${DeskItemModal} key=${edit.id || 'new'} it=${edit} d=${d} onClose=${() => setEdit(null)} onSaved=${() => { setEdit(null); load(); }} />`}
    </div>`;
}
function DeskItemModal({ it, d, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ ...it, fields: (it.fields || []).map(x => ({ ...x, opts: (x.opts || []).join(', ') })) });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const setFld = (i, k, v) => setF(x => ({ ...x, fields: x.fields.map((y, j) => (j === i ? { ...y, [k]: v } : y)) }));
  const move = (i, by) =>
    setF(x => {
      const list = [...x.fields];
      const j = i + by;
      if (j < 0 || j >= list.length) return x;
      [list[i], list[j]] = [list[j], list[i]];
      return { ...x, fields: list };
    });
  const save = async () => {
    setBusy(true);
    try {
      await api('desk_item_save', {
        id: it.id || '',
        t: f.t,
        d: f.d,
        cat: f.cat,
        grp: f.grp,
        icon: f.icon,
        appr: f.appr,
        ord: +f.ord || 50,
        pub: !!f.pub,
        fields: f.fields.map(x => ({ k: x.k || '', l: x.l, type: x.type, req: !!x.req, opts: x.type === 'select' ? String(x.opts || '').split(',').map(o => o.trim()).filter(Boolean) : [] })),
      });
      toast(f.pub ? 'Saved. It is offered on the Help page.' : 'Saved (hidden from the Help page).');
      onSaved();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const del = async () => {
    if (!confirm('Delete this request type? Tickets already raised keep their answers. To stop offering it for now, untick "Offered" instead.')) return;
    setBusy(true);
    try {
      await api('desk_delete', { what: 'catalog', id: it.id });
      toast('Deleted.');
      onSaved();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const badSelect = f.fields.some(x => x.type === 'select' && !String(x.opts || '').trim());
  return html`<${Modal} wide title=${it.id ? 'Edit request type' : 'New request type'} onClose=${onClose} foot=${html`${it.id && html`<button className="btn ghost" style=${{ marginRight: 'auto' }} disabled=${busy} onClick=${del}><${Icon} n="trash" />Delete</button>`}<button className="btn ghost" onClick=${onClose}>Cancel</button><button className="btn" disabled=${busy || badSelect} onClick=${save} title=${badSelect ? 'Add the choices for each Choice question' : undefined}>${busy ? 'Saving…' : 'Save'}</button>`}>
      <div className="form">
        <${Field} label="Name"><input value=${f.t} onInput=${e => set('t', e.target.value)} placeholder="Employment verification letter" maxLength="120" /><//>
        <${Field} label="What it is for (shown under the name)"><textarea rows="2" value=${f.d} onInput=${e => set('d', e.target.value)} maxLength="600" /><//>
        <div className="fld"><span>Icon</span>
          <div className="deskicons" role="radiogroup" aria-label="Icon">${DESK_ICONS.map(n => html`<button type="button" key=${n} role="radio" aria-checked=${f.icon === n} aria-label=${n} className=${f.icon === n ? 'on' : ''} onClick=${() => set('icon', n)}><${Icon} n=${n} /></button>`)}</div>
        </div>
        <div className="row3">
          <${Field} label="Area"><select value=${f.cat} onChange=${e => set('cat', e.target.value)}>${Object.entries(d.cats).map(([k, c]) => html`<option key=${k} value=${k}>${c.n}</option>`)}</select><//>
          <${Field} label="Goes to the group"><select value=${f.grp} onChange=${e => set('grp', e.target.value)}>${d.groups.map(g => html`<option key=${g.id} value=${g.id}>${g.n}</option>`)}</select><//>
          <${Field} label="Approval"><select value=${f.appr} onChange=${e => set('appr', e.target.value)}>${Object.entries(DESK_APPR_NAMES).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//>
        </div>
        <div className="fld"><span>Questions asked when someone requests it</span>
          <div className="deskfields">
            ${f.fields.length === 0 && html`<p className="muted small" style=${{ margin: 0 }}>No questions: people only get a free-text box.</p>`}
            ${f.fields.map(
              (x, i) => html`<div key=${i} className="deskfield">
                <input value=${x.l} onInput=${e => setFld(i, 'l', e.target.value)} placeholder="The question, e.g. Needed by" aria-label=${'Question ' + (i + 1)} maxLength="120" />
                <select value=${x.type} onChange=${e => setFld(i, 'type', e.target.value)} aria-label=${'Answer type for question ' + (i + 1)}>${DESK_FIELD_TYPES.map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select>
                ${x.type === 'select' && html`<input className="dfopts" value=${x.opts} onInput=${e => setFld(i, 'opts', e.target.value)} placeholder="Choices, separated by commas" aria-label=${'Choices for question ' + (i + 1)} />`}
                <label className="check"><input type="checkbox" checked=${!!x.req} onChange=${e => setFld(i, 'req', e.target.checked)} /><span>Required</span></label>
                <span className="dfbtns">
                  <button type="button" className="btn ghost icon sm" aria-label="Move up" disabled=${i === 0} onClick=${() => move(i, -1)}><${Icon} n="up" /></button>
                  <button type="button" className="btn ghost icon sm" aria-label="Remove this question" onClick=${() => set('fields', f.fields.filter((_, j) => j !== i))}><${Icon} n="trash" /></button>
                </span>
              </div>`
            )}
            ${f.fields.length < 12 && html`<div><button type="button" className="btn ghost sm" onClick=${() => set('fields', [...f.fields, { k: '', l: '', type: 'text', opts: '', req: false }])}><${Icon} n="plus" />Add a question</button></div>`}
          </div>
        </div>
        <div className="row2">
          <${Field} label="Order" hint="Lower numbers come first on the Help page."><input type="number" value=${f.ord} onInput=${e => set('ord', e.target.value)} /><//>
          <label className="check" style=${{ alignSelf: 'end' }}><input type="checkbox" checked=${!!f.pub} onChange=${e => set('pub', e.target.checked)} /><span>Offered on the Help & support page</span></label>
        </div>
      </div>
    <//>`;
}

/* ---- assignment groups ---- */
function DeskGroupsAdmin() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [edit, setEdit] = useState(null);
  const load = () => api('desk_admin', {}).then(setD, e => toast(errText(e), true));
  useEffect(() => {
    load();
  }, []);
  if (!d) return html`<${Spinner} />`;
  const pname = id => (d.people.find(p => p.id === id) || {}).n || 'Someone no longer active';
  const gname = id => (d.groups.find(g => g.id === id) || {}).n;
  const fallback = d.groups.some(g => g.id === 'gen') ? 'gen' : (d.groups[0] || {}).id;
  return html`<div className="stack">
      <div className="ph-row">
        <p className="muted small" style=${{ margin: 0, maxWidth: 760 }}>A group works the tickets of its areas. Everyone with the roles you tick is in it, plus the people you name (an employee who helps with IT, say). Group members see the group's queue under Service desk and get its emails; administrators see every ticket.</p>
        <button type="button" className="btn" onClick=${() => setEdit({ n: '', d: '', roles: [], named: [] })}><${Icon} n="plus" />New group</button>
      </div>
      <section className="panel" style=${{ padding: '6px 8px' }}><div className="tblwrap"><table className="tbl">
        <thead><tr><th>Group</th><th>Who is in it</th><th>People</th><th className="r"><span className="sr">Edit</span></th></tr></thead>
        <tbody>${d.groups.map(
          g => html`<tr key=${g.id}>
            <td><b>${g.n}</b><div className="muted small">${g.d}</div></td>
            <td className="small">${g.roles.map(r => html`<span key=${r} className="chip">${DESK_ROLE_NAMES[r] || r}</span> `)}${g.named.map(id => html`<span key=${id} className="chip new">${pname(id)}</span> `)}${!g.roles.length && !g.named.length && html`<span className="late">Nobody: its tickets alert the administrators</span>`}</td>
            <td className="small">${g.members.length}</td>
            <td className="r"><button type="button" className="btn ghost sm" onClick=${() => setEdit(g)}>Edit</button></td>
          </tr>`
        )}</tbody>
      </table></div></section>
      <section className="panel stack" style=${{ gap: 8 }}>
        <h3 className="ph" style=${{ margin: 0 }}>Where problems go</h3>
        <p className="muted small" style=${{ margin: 0 }}>A reported problem goes to the group of its area (the person picks the area, or the desk guesses it from their words). Requests from the catalog go to the group set on each request type. Anyone working a ticket can move it to another group.</p>
        <div className="deskroutes">${Object.entries(d.cats).map(([k, c]) => html`<div key=${k}><span>${c.n}</span><b>${gname(c.grp) || html`${gname(fallback)} <span className="muted small">(${c.grp} was removed)</span>`}</b></div>`)}</div>
      </section>
      ${edit && html`<${DeskGroupModal} key=${edit.id || 'new'} g=${edit} people=${d.people} onClose=${() => setEdit(null)} onSaved=${() => { setEdit(null); load(); }} />`}
    </div>`;
}
function DeskGroupModal({ g, people, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ n: g.n, d: g.d, roles: [...(g.roles || [])], named: [...(g.named || [])] });
  const [find, setFind] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const needle = find.trim().toLowerCase();
  const hits = needle ? people.filter(p => !f.named.includes(p.id) && (p.n + ' ' + p.e).toLowerCase().includes(needle)).slice(0, 8) : [];
  const byRole = people.filter(p => p.roles.some(r => f.roles.includes(r)));
  const save = async () => {
    setBusy(true);
    try {
      await api('desk_group_save', { id: g.id || '', n: f.n, d: f.d, roles: f.roles, members: f.named });
      toast('Group saved.');
      onSaved();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const del = async () => {
    if (!confirm('Delete this group? Its areas then go to General requests (or the first group left).')) return;
    setBusy(true);
    try {
      await api('desk_delete', { what: 'groups', id: g.id });
      toast('Deleted.');
      onSaved();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<${Modal} wide title=${g.id ? 'Edit group' : 'New group'} onClose=${onClose} foot=${html`${g.id && html`<button className="btn ghost" style=${{ marginRight: 'auto' }} disabled=${busy} onClick=${del}><${Icon} n="trash" />Delete</button>`}<button className="btn ghost" onClick=${onClose}>Cancel</button><button className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save'}</button>`}>
      <div className="form">
        <div className="row2">
          <${Field} label="Name"><input value=${f.n} onInput=${e => set('n', e.target.value)} placeholder="IT & portal support" maxLength="80" /><//>
          <${Field} label="What it handles"><input value=${f.d} onInput=${e => set('d', e.target.value)} maxLength="300" /><//>
        </div>
        <div className="fld"><span>Everyone with these roles is in the group</span>
          <div className="actions">${Object.entries(DESK_ROLE_NAMES).map(([k, v]) => html`<label key=${k} className="check"><input type="checkbox" checked=${f.roles.includes(k)} onChange=${e => set('roles', e.target.checked ? [...f.roles, k] : f.roles.filter(r => r !== k))} /><span>${v}</span></label>`)}</div>
          <small>${byRole.length ? byRole.length + ' ' + (byRole.length === 1 ? 'person' : 'people') + ' by role: ' + byRole.slice(0, 8).map(p => p.n).join(', ') + (byRole.length > 8 ? '…' : '') : 'Nobody has these roles yet.'}</small>
        </div>
        <div className="fld"><span>Also these people</span>
          <div className="deskpeople">
            ${f.named.map(id => {
              const p = people.find(x => x.id === id);
              return html`<span key=${id} className="chip new">${p ? p.n : 'Someone no longer active'}<button type="button" aria-label=${'Remove ' + (p ? p.n : 'this person')} onClick=${() => set('named', f.named.filter(x => x !== id))}><${Icon} n="x" /></button></span>`;
            })}
            ${f.named.length === 0 && html`<span className="muted small">Nobody named.</span>`}
          </div>
          <input type="search" value=${find} onInput=${e => setFind(e.target.value)} placeholder="Find someone by name or email to add" aria-label="Find someone to add" />
          ${
            hits.length > 0 &&
            html`<div className="deskhits">${hits.map(p => html`<button key=${p.id} type="button" onClick=${() => { set('named', [...f.named, p.id]); setFind(''); }}><b>${p.n}</b> <span className="muted small">${p.e}</span></button>`)}</div>`
          }
        </div>
      </div>
    <//>`;
}

/* ---- settings: SLA targets, closing, the support address, emails, the assistant ---- */
function DeskDur({ mins, onChange, label }) {
  const pick = m => (m >= 1440 && m % 1440 === 0 ? 1440 : m >= 60 && m % 60 === 0 ? 60 : 1);
  const [unit, setUnit] = useState(pick(mins));
  const n = Math.round((mins / unit) * 100) / 100;
  return html`<span className="deskdur">
      <input type="number" min="1" step="1" value=${n} aria-label=${label} onInput=${e => onChange(Math.max(1, Math.round((+e.target.value || 0) * unit)))} />
      <select value=${unit} aria-label=${label + ' (unit)'} onChange=${e => { const u = +e.target.value; setUnit(u); onChange(Math.max(1, Math.round(n * u))); }}>
        <option value="1">minutes</option><option value="60">hours</option><option value="1440">days</option>
      </select>
    </span>`;
}
function DeskSettingsAdmin() {
  const toast = useToast();
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api('desk_admin', {}).then(
      r => setF({ ...r.settings, sla: { ...r.settings.sla } }),
      e => toast(errText(e), true)
    );
  }, []);
  if (!f) return html`<${Spinner} />`;
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const setSla = (p, i, v) => setF(x => ({ ...x, sla: { ...x.sla, [p]: i === 0 ? [v, x.sla[p][1]] : [x.sla[p][0], v] } }));
  const save = async () => {
    setBusy(true);
    try {
      const r = await api('desk_settings_save', f);
      setF({ ...r.settings, sla: { ...r.settings.sla } });
      toast('Service desk settings saved.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<div className="stack" style=${{ gap: 14 }}>
      <section className="panel stack form" style=${{ gap: 12 }}>
        <h3 className="ph" style=${{ margin: 0 }}>Targets (SLA) by priority</h3>
        <p className="muted small" style=${{ margin: 0 }}>Priority comes from impact and urgency. The clock runs around the clock and stops while a ticket is on hold. A missed target marks the ticket and emails its group (P1 and P2 also email the administrators).</p>
        <div className="tblwrap"><table className="tbl desksla">
          <thead><tr><th>Priority</th><th>First answer within</th><th>Resolved within</th></tr></thead>
          <tbody>${[1, 2, 3, 4].map(p => html`<tr key=${p}><td>${deskPri(p)}</td><td><${DeskDur} mins=${f.sla[p][0]} label=${DESK_PRI_NAME[p] + ': first answer within'} onChange=${v => setSla(p, 0, v)} /></td><td><${DeskDur} mins=${f.sla[p][1]} label=${DESK_PRI_NAME[p] + ': resolved within'} onChange=${v => setSla(p, 1, v)} /></td></tr>`)}</tbody>
        </table></div>
      </section>
      <section className="panel stack form" style=${{ gap: 12 }}>
        <h3 className="ph" style=${{ margin: 0 }}>Email and closing</h3>
        <div className="row2">
          <${Field} label="Support email address (optional)" hint="Emails sent to this address become tickets, and ticket emails ask people to reply to it. Its mail must reach the site's inbox (Email, inbox & campaigns › Inbox). Replies that keep [SD-number] in the subject always update their ticket."><input type="email" value=${f.email} onInput=${e => set('email', e.target.value)} placeholder="support@yourcompany.com" /><//>
          <${Field} label="Close resolved tickets after (days)" hint="The requester can reopen a resolved ticket until then."><input type="number" min="1" max="30" value=${f.autoClose} onInput=${e => set('autoClose', +e.target.value)} /><//>
        </div>
        <div className="fld"><span>Emails</span>
          <div className="stack" style=${{ gap: 6 }}>
            ${[
              ['create', 'Confirm each new ticket to the person who raised it'],
              ['assign', 'Tell people when a ticket is assigned to them'],
              ['update', 'Email answers, questions and resolutions to the requester, and replies to the group'],
              ['breach', 'Alert the group (and administrators for P1 and P2) when a target is missed'],
            ].map(([k, l]) => html`<label key=${k} className="check"><input type="checkbox" checked=${!!f.notify[k]} onChange=${e => set('notify', { ...f.notify, [k]: e.target.checked })} /><span>${l}</span></label>`)}
          </div>
        </div>
        <label className="check"><input type="checkbox" checked=${!!f.bot} onChange=${e => set('bot', e.target.checked)} /><span>Let StratEdge AI write the Help assistant's answers from the help articles (when StratEdge AI is set up). Off: the assistant shows the matching articles.</span></label>
        <label className="check"><input type="checkbox" checked=${f.web !== false} onChange=${e => set('web', e.target.checked)} /><span>Help & support on the public website (#/support): the articles marked for the website, the assistant, and requests from people who cannot sign in (they get a private link to follow theirs).</span></label>
      </section>
      <div className="actions"><button type="button" className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save settings'}</button></div>
    </div>`;
}
