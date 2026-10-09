/* ================= v42 Work boards: the team's agile pipeline (js/work.js, fetched when opened) =================
   Projects are Scrum (backlog and sprints) or Kanban (a continuous board). Board with stages and work-in-progress
   limits (drag and drop, or the stage picker in a work item), backlog ranking and sprint planning, sprint start and
   completion with carry-over, work items with points, priority, assignee, due date, labels, checklist, comments and
   history, time in stage and blocked flags, reports (burndown, velocity, cumulative flow, cycle time, throughput,
   aging), daily stand-ups, retrospectives, and My work with notes. Server: api/work.php (routes wk_*). */
const WK_TYPE = { story: ['Story', 'ok'], task: ['Task', 'info'], bug: ['Bug', 'red'], epic: ['Epic', 'amber'] };
const WK_PRIO = { highest: ['Highest', 'red'], high: ['High', 'amber'], medium: ['Medium', ''], low: ['Low', 'info'] };
const WK_RETRO = { good: 'Went well', bad: 'Didn\'t go well', try: 'Try next' };
const wkIni = n =>
  String(n || '?')
    .split(/\s+/)
    .filter(Boolean)
    .map(x => x[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
const wkDays = ms => Math.max(0, Math.floor((Date.now() - ms) / 86400000));
const wkToday = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
const wkBase = () => (location.hash || '#/portal/work').split('?')[0];
const wkGo = params => {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null)).toString();
  location.hash = wkBase() + (qs ? '?' + qs : '');
};
const wkPts = (items, unit) => items.reduce((t, i) => t + (unit === 'items' ? 1 : +i.pts || 0), 0);
const wkFmt = n => (Math.round((+n || 0) * 10) / 10).toLocaleString();
function WkWho({ uid, people, size }) {
  const p = (people || []).find(x => x.id === uid);
  if (!uid) return html`<span className="wkav none" title="Unassigned">–</span>`;
  return html`<span className="wkav" title=${p ? p.n : 'Someone'} style=${size ? { width: size, height: size, fontSize: size * 0.42 } : null}>${wkIni(p ? p.n : '?')}</span>`;
}
const wkName = (uid, people) => ((people || []).find(x => x.id === uid) || {}).n || 'Someone';

/* The entry: the projects and My work, or one project (?p=<id>&v=<view>&i=<item>). */
function WorkApp({ q }) {
  const p = q && q.p;
  if (p) return html`<${WkProject} id=${p} view=${(q && q.v) || 'board'} item=${(q && q.i) || ''} />`;
  return html`<${WkHome} tab=${(q && q.t) || 'projects'} />`;
}

function WkHome({ tab }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [mine, setMine] = useState(null);
  const [create, setCreate] = useState(false);
  const load = () =>
    api('wk_projects')
      .then(x => {
        setD(x);
        setErr(null);
      })
      .catch(setErr);
  const loadMine = () => api('wk_mine', { seen: true }).then(setMine).catch(e => toast(errText(e), true));
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (tab === 'mine') loadMine();
  }, [tab]);
  if (err && !d) return html`<${LoadError} error=${err} onRetry=${load} />`;
  if (!d) return html`<${Spinner} />`;
  const live = d.projects.filter(p => !p.arch);
  const arch = d.projects.filter(p => p.arch);
  return html`<div className="stack wkpage">
      <div className="ph-row">
        <${KitTabs} tabs=${[['projects', 'Projects'], ['mine', 'My work', d.notes || 0]]} tab=${tab} onTab=${t => wkGo({ t: t === 'projects' ? '' : t })} />
        ${d.canCreate && html`<button className="btn" onClick=${() => setCreate(true)}><${Icon} n="plus" />New project</button>`}
      </div>
      ${
        tab === 'mine'
          ? html`<${WkMine} d=${mine} onOpen=${(pid, iid) => wkGo({ p: pid, i: iid })} />`
          : live.length
            ? html`<div className="wkprojs">${live.map(p => html`<${WkProjCard} key=${p.id} p=${p} />`)}</div>`
            : html`<${Empty} title="No projects yet">${d.canCreate ? 'Start one: a Scrum project plans work in sprints from a backlog; a Kanban board keeps work flowing through stages with limits on work in progress.' : 'When someone adds you to a project, it shows here.'}<//>`
      }
      ${tab !== 'mine' && arch.length > 0 && html`<details className="small"><summary>Archived (${arch.length})</summary><div className="wkprojs" style=${{ marginTop: 10 }}>${arch.map(p => html`<${WkProjCard} key=${p.id} p=${p} />`)}</div></details>`}
      ${create && html`<${WkProjectModal} onClose=${() => setCreate(false)} onSaved=${r => wkGo({ p: r.project.id, v: r.project.kind === 'scrum' ? 'backlog' : 'board' })} />`}
    </div>`;
}
function WkProjCard({ p }) {
  const total = Object.values(p.counts || {}).reduce((a, b) => a + b, 0);
  const left = p.sprint && p.sprint.fin ? Math.ceil((new Date(p.sprint.fin + 'T23:59:59') - Date.now()) / 86400000) : null;
  return html`<a className="wkproj" href=${wkBase() + '?p=' + p.id}>
      <div className="ph-row"><b>${p.n}</b><${Chip} s=${p.kind === 'scrum' ? 'info' : 'ok'}>${p.kind === 'scrum' ? 'Scrum' : 'Kanban'}<//></div>
      <span className="muted small">${p.key} · ${total} work item${total === 1 ? '' : 's'} · ${p.members.length} ${p.members.length === 1 ? 'person' : 'people'}</span>
      <div className="wkbarmini">${p.cols.map(c => html`<i key=${c.k} title=${c.n + ': ' + ((p.counts || {})[c.k] || 0)} className=${c.done ? 'done' : ''} style=${{ flex: Math.max(0.15, (p.counts || {})[c.k] || 0) }} />`)}</div>
      ${p.sprint ? html`<span className="small">${p.sprint.n}${left != null ? ` · ${left >= 0 ? left + ' day' + (left === 1 ? '' : 's') + ' left' : 'past its end date'}` : ''}</span>` : p.kind === 'scrum' ? html`<span className="muted small">No sprint running</span>` : null}
    </a>`;
}
function WkMine({ d, onOpen }) {
  if (!d) return html`<${Spinner} />`;
  const today = wkToday();
  return html`<div className="g2" style=${{ alignItems: 'start' }}>
      <section className="panel stack">
        <h2 className="ph">Assigned to me</h2>
        ${
          d.items.length
            ? html`<ul className="list">${d.items.map(
                i => html`<li key=${i.id} className="wkrow" onClick=${() => onOpen(i.proj, i.id)}>
                  <div><div className="t"><span className="muted">${i.key}-${i.num}</span> ${i.title}</div><div className="m">${i.pn} · ${i.stn}${i.blocked ? ' · blocked' : ''}</div></div>
                  <span className="actions">${i.due ? html`<${Chip} s=${i.due < today ? 'red' : i.due === today ? 'amber' : ''}>${i.due < today ? 'overdue ' : 'due '}${fmtDay(new Date(i.due + 'T12:00:00').getTime())}<//>` : null}<${Chip} s=${WK_PRIO[i.prio][1]}>${WK_PRIO[i.prio][0]}<//></span>
                </li>`
              )}</ul>`
            : html`<p className="muted small">Nothing assigned to you that is still open.</p>`
        }
      </section>
      <section className="panel stack">
        <h2 className="ph">Notes</h2>
        ${
          d.notes.length
            ? html`<ul className="list">${d.notes.map(n => html`<li key=${n.id} className=${n.seen ? '' : 'wknew'}><div><div className="t">${n.txt}</div><div className="m">${fmtTs(n.at)}</div></div></li>`)}</ul>`
            : html`<p className="muted small">When someone assigns you work, mentions you (@name) or a sprint starts, it shows here.</p>`
        }
      </section>
    </div>`;
}

/* A new project, or a project's settings (name, key, members, lead, stages with limits, archive). */
function WkProjectModal({ p, all, onClose, onSaved }) {
  const toast = useToast();
  const [people, setPeople] = useState(all || null);
  const [f, setF] = useState(() =>
    p
      ? { n: p.n, key: p.key, kind: p.kind, d: p.d, members: p.members, lead: p.lead, cols: p.cols.map(c => ({ ...c })), arch: p.arch }
      : { n: '', key: '', kind: 'scrum', d: '', members: [], lead: '', cols: null, arch: false }
  );
  const [find, setFind] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!people) api('wk_people').then(r => setPeople(r.people)).catch(() => setPeople([]));
  }, []);
  const autoKey = n =>
    (n || '')
      .split(/\s+/)
      .filter(Boolean)
      .map(w => w[0])
      .join('')
      .replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase()
      .slice(0, 4) || '';
  const save = async () => {
    setBusy(true);
    try {
      const r = await api('wk_project_save', { id: p ? p.id : '', ...f, key: f.key || autoKey(f.n), cols: f.cols || undefined });
      toast(p ? 'Project saved.' : 'Project created.');
      onSaved && onSaved(r);
      onClose();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const setCol = (i, patch) => setF({ ...f, cols: f.cols.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const moveCol = (i, d) => {
    const cols = f.cols.slice();
    const [c] = cols.splice(i, 1);
    cols.splice(i + d, 0, c);
    setF({ ...f, cols });
  };
  const shown = (people || []).filter(x => !find || (x.n + ' ' + x.e).toLowerCase().includes(find.toLowerCase())).slice(0, 60);
  return html`<${Modal} wide title=${p ? 'Project settings' : 'New project'} onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Cancel</button><button className="btn" disabled=${busy || !f.n.trim()} onClick=${save}>${busy ? 'Saving…' : p ? 'Save' : 'Create project'}</button>`}>
      <div className="form">
        <div className="row3">
          <${Field} label="Name"><input value=${f.n} onInput=${e => setF({ ...f, n: e.target.value })} placeholder="Website relaunch" autoFocus /><//>
          <${Field} label="Key" hint="Starts every work item's number (WEB-12)"><input value=${f.key} onInput=${e => setF({ ...f, key: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) })} placeholder=${autoKey(f.n) || 'WEB'} /><//>
          ${
            p
              ? html`<${Field} label="Kind"><input value=${p.kind === 'scrum' ? 'Scrum' : 'Kanban'} disabled /><//>`
              : html`<${Field} label="Kind"><select value=${f.kind} onChange=${e => setF({ ...f, kind: e.target.value })}><option value="scrum">Scrum: a backlog and sprints</option><option value="kanban">Kanban: a continuous board</option></select><//>`
          }
        </div>
        <${Field} label="What it is about"><textarea value=${f.d} onInput=${e => setF({ ...f, d: e.target.value })} placeholder="The goal, the people it serves, where the files are" /><//>
        <${Field} label=${'People on it (' + f.members.length + ')'} hint="Staff and portal members alike: they see the project and can be assigned work.">
          <div className="stack" style=${{ gap: 6 }}>
            <input value=${find} onInput=${e => setFind(e.target.value)} placeholder="Find someone by name or email" />
            <div className="portalpicks wide wkpick">${
              people
                ? shown.map(x => html`<label key=${x.id} className=${'pick' + (f.members.includes(x.id) ? ' on' : '')}><input type="checkbox" checked=${f.members.includes(x.id)} onChange=${e => setF({ ...f, members: e.target.checked ? [...f.members, x.id] : f.members.filter(y => y !== x.id) })} /><span>${x.n}</span></label>`)
                : html`<${Spinner} />`
            }</div>
          </div>
        <//>
        ${
          people &&
          html`<${Field} label="Project lead" hint="Plans and starts sprints and changes these settings (administrators can too)."><select value=${f.lead} onChange=${e => setF({ ...f, lead: e.target.value })}><option value="">Me</option>${people.filter(x => f.members.includes(x.id) || x.id === f.lead).map(x => html`<option key=${x.id} value=${x.id}>${x.n}</option>`)}</select><//>`
        }
        ${
          p &&
          html`<div className="stack" style=${{ gap: 6 }}>
            <span className="lbl">Stages (columns)</span>
            <table className="tbl small"><thead><tr><th>Stage</th><th>Work-in-progress limit</th><th>Counts as done</th><th /></tr></thead><tbody>${f.cols.map(
              (c, i) => html`<tr key=${c.k}>
                <td><input value=${c.n} onInput=${e => setCol(i, { n: e.target.value })} /></td>
                <td><input type="number" min="0" max="99" value=${c.wip} onInput=${e => setCol(i, { wip: +e.target.value || 0 })} style=${{ maxWidth: 90 }} /> <span className="muted">0 = none</span></td>
                <td><input type="checkbox" checked=${!!c.done} disabled=${i === 0} onChange=${e => setCol(i, { done: e.target.checked })} /></td>
                <td className="r nw"><button type="button" className="btn ghost sm" disabled=${i === 0} onClick=${() => moveCol(i, -1)} aria-label="Up"><${Icon} n="up" /></button><button type="button" className="btn ghost sm" disabled=${i === f.cols.length - 1} onClick=${() => moveCol(i, 1)} aria-label="Down"><${Icon} n="down" /></button><button type="button" className="btn ghost sm" disabled=${f.cols.length <= 2} onClick=${() => setF({ ...f, cols: f.cols.filter((x, j) => j !== i) })} aria-label="Remove"><${Icon} n="x" /></button></td>
              </tr>`
            )}</tbody></table>
            <div><button type="button" className="btn ghost sm" disabled=${f.cols.length >= 12} onClick=${() => setF({ ...f, cols: [...f.cols.slice(0, -1), { k: '', n: 'New stage', wip: 0, done: false }, f.cols[f.cols.length - 1]] })}><${Icon} n="plus" />Add a stage</button></div>
            <label className="check"><input type="checkbox" checked=${!!f.arch} onChange=${e => setF({ ...f, arch: e.target.checked })} /><span>Archived (read only, out of the list)</span></label>
          </div>`
        }
      </div>
    <//>`;
}

/* ---- one project: Board · Backlog (Scrum) · Reports · Stand-up · Retrospectives (Scrum) ---- */
function WkProject({ id, view, item }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [settings, setSettings] = useState(false);
  const [newItem, setNewItem] = useState(null);
  const load = () =>
    api('wk_board', { id })
      .then(x => {
        setD(x);
        setErr(null);
      })
      .catch(setErr);
  useEffect(() => {
    load();
  }, [id]);
  if (err && !d) return html`<${LoadError} error=${err} onRetry=${load} />`;
  if (!d) return html`<${Spinner} />`;
  const P = d.project;
  const scrum = P.kind === 'scrum';
  const tabs = [['board', 'Board'], ...(scrum ? [['backlog', 'Backlog']] : []), ['reports', 'Reports'], ['daily', 'Stand-up'], ...(scrum ? [['retro', 'Retrospectives']] : [])];
  const v = tabs.some(t => t[0] === view) ? view : 'board';
  const go = (nv, extra) => wkGo({ p: id, v: nv === 'board' ? '' : nv, ...(extra || {}) });
  const active = d.sprints.find(s => s.st === 'active') || null;
  return html`<div className="stack wkpage">
      <div className="ph-row wkhead">
        <div>
          <a className="muted small" href=${wkBase()}>‹ All projects</a>
          <h2 className="ph" style=${{ margin: '2px 0 0' }}>${P.n} <span className="muted" style=${{ fontWeight: 400 }}>· ${P.key} · ${scrum ? 'Scrum' : 'Kanban'}${P.arch ? ' · archived' : ''}</span></h2>
          ${active && html`<span className="small">${active.n}${active.goal ? ': ' + active.goal : ''} · ${active.start ? fmtDay(new Date(active.start + 'T12:00:00').getTime()) : ''} – ${active.fin ? fmtDay(new Date(active.fin + 'T12:00:00').getTime()) : ''}</span>`}
        </div>
        <div className="actions">
          ${!P.arch && html`<button className="btn" onClick=${() => setNewItem({ type: 'task', st: P.cols[0].k, sprint: scrum && v === 'board' && active ? active.id : '' })}><${Icon} n="plus" />New work item</button>`}
          ${d.manage && html`<button className="btn ghost" onClick=${() => setSettings(true)}>Settings</button>`}
        </div>
      </div>
      <${KitTabs} tabs=${tabs} tab=${v} onTab=${go} />
      ${v === 'board' && html`<${WkBoard} d=${d} active=${active} onOpen=${iid => go(v, { i: iid })} onChanged=${load} />`}
      ${v === 'backlog' && html`<${WkBacklog} d=${d} active=${active} onOpen=${iid => go(v, { i: iid })} onChanged=${load} />`}
      ${v === 'reports' && html`<${WkReports} d=${d} />`}
      ${v === 'daily' && html`<${WkDaily} d=${d} onOpen=${iid => go(v, { i: iid })} />`}
      ${v === 'retro' && html`<${WkRetro} d=${d} onChanged=${load} />`}
      ${item && html`<${WkItemModal} id=${item} d=${d} onClose=${() => go(v)} onChanged=${load} />`}
      ${newItem && html`<${WkItemModal} fresh=${newItem} d=${d} onClose=${() => setNewItem(null)} onChanged=${load} />`}
      ${settings && html`<${WkProjectModal} p=${P} all=${d.all} onClose=${() => setSettings(false)} onSaved=${() => load()} />`}
    </div>`;
}

/* The board: a column per stage with its limit, cards that are dragged (or moved in the work item's window). */
function WkBoard({ d, active, onOpen, onChanged }) {
  const toast = useToast();
  const P = d.project;
  const scrum = P.kind === 'scrum';
  const [who, setWho] = useState('');
  const [type, setType] = useState('');
  const [find, setFind] = useState('');
  const [onlyBlocked, setOnlyBlocked] = useState(false);
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState('');
  const [quick, setQuick] = useState('');
  const me = (usePortal() || {}).uid || '';
  if (scrum && !active)
    return html`<${Empty} title="No sprint is running">Plan one in the Backlog: put work items in a sprint and start it. The board then shows that sprint's work.<//>`;
  const all = d.items.filter(i => i.type !== 'epic' && (!scrum || i.sprint === (active && active.id)));
  const shown = all.filter(
    i =>
      (!who || (who === 'me' ? i.who === me : who === 'none' ? !i.who : i.who === who)) &&
      (!type || i.type === type) &&
      (!onlyBlocked || i.blocked) &&
      (!find || (P.key + '-' + i.num + ' ' + i.title + ' ' + (i.labels || []).join(' ')).toLowerCase().includes(find.toLowerCase()))
  );
  const move = async (iid, st, before, force) => {
    try {
      await api('wk_move', { id: iid, st, before: before || '', force: !!force });
      onChanged();
    } catch (e) {
      if (e && (e.code === 'wip_limit' || e.error === 'wip_limit' || /at its limit/.test(e.message || ''))) {
        if (confirm(errText(e))) return move(iid, st, before, true);
        return;
      }
      toast(errText(e), true);
    }
  };
  const addQuick = async col => {
    if (!quick.trim()) return;
    try {
      await api('wk_item_save', { proj: P.id, f: { title: quick.trim(), type: 'task', st: col, sprint: scrum && active ? active.id : '' } });
      setQuick('');
      onChanged();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const first = P.cols[0].k;
  const doneKeys = P.cols.filter(c => c.done).map(c => c.k);
  return html`<div className="stack">
      <div className="toolbar wktools">
        <input value=${find} onInput=${e => setFind(e.target.value)} placeholder="Find (number, title, label)" />
        <select value=${who} onChange=${e => setWho(e.target.value)} aria-label="Assignee"><option value="">Everyone</option><option value="me">Assigned to me</option><option value="none">Unassigned</option>${d.people.map(x => html`<option key=${x.id} value=${x.id}>${x.n}</option>`)}</select>
        <select value=${type} onChange=${e => setType(e.target.value)} aria-label="Type"><option value="">All types</option>${['story', 'task', 'bug'].map(t => html`<option key=${t} value=${t}>${WK_TYPE[t][0]}</option>`)}</select>
        <label className="check"><input type="checkbox" checked=${onlyBlocked} onChange=${e => setOnlyBlocked(e.target.checked)} /><span>Blocked only</span></label>
        <span className="muted small">${shown.length} of ${all.length}${scrum && active ? ` · ${wkFmt(wkPts(all.filter(i => doneKeys.includes(i.st)), 'points'))} of ${wkFmt(wkPts(all, 'points'))} points done` : ''}</span>
      </div>
      <div className="wkboard" style=${{ gridTemplateColumns: `repeat(${P.cols.length}, minmax(240px, 1fr))`, '--wkcols': P.cols.length }}>
        ${P.cols.map(c => {
          const inCol = shown.filter(i => i.st === c.k);
          const count = all.filter(i => i.st === c.k).length;
          const full = c.wip > 0 && count > c.wip;
          return html`<section key=${c.k} className=${'wkcol' + (over === c.k ? ' over' : '') + (full ? ' full' : '')} onDragOver=${e => {
            if (drag) {
              e.preventDefault();
              setOver(c.k);
            }
          }} onDragLeave=${() => setOver('')} onDrop=${e => {
            e.preventDefault();
            setOver('');
            const t = e.target.closest && e.target.closest('[data-wk]');
            if (drag) move(drag, c.k, t && t.dataset.wk !== drag ? t.dataset.wk : '');
            setDrag(null);
          }}>
            <header><b>${c.n}</b><span className=${'wkcount' + (full ? ' over' : '')}>${count}${c.wip ? ' / ' + c.wip : ''}</span></header>
            <div className="wkcards">
              ${inCol.map(i => html`<${WkCard} key=${i.id} i=${i} P=${P} people=${d.people} aging=${c.k !== first && !c.done} onOpen=${() => onOpen(i.id)} onDrag=${() => setDrag(i.id)} onDragEnd=${() => setDrag(null)} />`)}
              ${!inCol.length && html`<p className="muted small wkempty">${drag ? 'Drop it here' : 'Nothing here'}</p>`}
            </div>
            ${c.k === first && !P.arch && html`<div className="wkquick"><input value=${quick} onInput=${e => setQuick(e.target.value)} onKeyDown=${e => e.key === 'Enter' && addQuick(c.k)} placeholder="+ Add a task (Enter)" /></div>`}
          </section>`;
        })}
      </div>
      <p className="muted small">Drag a card to another stage or position; on a phone, open it and pick the stage. A stage over its limit turns red: finish work before starting more. The number on a card is how many days it has been in its stage.</p>
    </div>`;
}
function WkCard({ i, P, people, aging, onOpen, onDrag, onDragEnd }) {
  const days = wkDays(i.stAt);
  const today = wkToday();
  const checks = (i.check || []).length;
  return html`<article className=${'wkcard' + (i.blocked ? ' blocked' : '')} data-wk=${i.id} draggable="true" onDragStart=${e => {
    e.dataTransfer.setData('text/plain', i.id);
    e.dataTransfer.effectAllowed = 'move';
    onDrag();
  }} onDragEnd=${onDragEnd} onClick=${onOpen} tabIndex="0" onKeyDown=${e => e.key === 'Enter' && onOpen()}>
      <div className="wkcardtop"><span className=${'wktype wkt-' + i.type} title=${WK_TYPE[i.type][0]} /><span className="muted small">${P.key}-${i.num}</span>${i.blocked ? html`<${Chip} s="red">Blocked<//>` : null}</div>
      <div className="wktitle">${i.title}</div>
      ${(i.labels || []).length > 0 && html`<div className="wklabels">${i.labels.map(l => html`<span key=${l} className="chip lbl">${l}</span>`)}</div>`}
      <div className="wkcardfoot">
        <span className=${'wkprio wkp-' + i.prio} title=${WK_PRIO[i.prio][0] + ' priority'}>${WK_PRIO[i.prio][0]}</span>
        ${i.pts != null ? html`<span className="wkpts" title="Story points">${wkFmt(i.pts)}</span>` : null}
        ${checks > 0 ? html`<span className="muted small" title="Checklist">${i.check.filter(c => c.done).length}/${checks}</span>` : null}
        ${i.cmts > 0 ? html`<span className="muted small" title="Comments"><${Icon} n="chat" />${i.cmts}</span>` : null}
        ${i.due ? html`<span className=${'small ' + (i.due < today && !i.doneAt ? 'wklate' : 'muted')}>${fmtDay(new Date(i.due + 'T12:00:00').getTime()).replace(/, \d{4}$/, '')}</span>` : null}
        ${aging ? html`<span className=${'wkage' + (days >= 7 ? ' old' : days >= 3 ? ' warm' : '')} title=${days + ' days in this stage'}>${days}d</span>` : null}
        <${WkWho} uid=${i.who} people=${people} />
      </div>
    </article>`;
}

/* The backlog (Scrum): the sprints being planned and the ranked backlog; move work into a sprint, start and complete. */
function WkBacklog({ d, active, onOpen, onChanged }) {
  const toast = useToast();
  const P = d.project;
  const [sprintEdit, setSprintEdit] = useState(null);
  const [complete, setComplete] = useState(null);
  const [busy, setBusy] = useState('');
  const doneKeys = P.cols.filter(c => c.done).map(c => c.k);
  const items = d.items.filter(i => i.type !== 'epic');
  const epics = d.items.filter(i => i.type === 'epic');
  const backlog = items.filter(i => !i.sprint && !doneKeys.includes(i.st));
  const planned = d.sprints.filter(s => s.st === 'plan');
  const call = async (route, body, msg) => {
    setBusy(route);
    let r = null;
    try {
      r = await api(route, body);
      if (msg) toast(typeof msg === 'function' ? msg(r) : msg);
      onChanged();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
    return r;
  };
  const setSprint = (i, sid) => call('wk_item_save', { id: i.id, f: { sprint: sid } });
  const rank = (list, i, dir) => {
    const k = list.indexOf(i);
    const target = dir < 0 ? list[k - 1] : list[k + 2];
    if (dir < 0 && !list[k - 1]) return;
    if (dir > 0 && !list[k + 1]) return;
    call('wk_rank', { id: i.id, before: target ? target.id : '' });
  };
  const Row = ({ i, list }) => html`<li className="wkrow" key=${i.id}>
      <span className=${'wktype wkt-' + i.type} title=${WK_TYPE[i.type][0]} />
      <div className="wkrowmain" onClick=${() => onOpen(i.id)}><div className="t"><span className="muted">${P.key}-${i.num}</span> ${i.title}</div><div className="m">${(P.cols.find(c => c.k === i.st) || {}).n || i.st}${i.epic ? ' · ' + ((epics.find(e => e.id === i.epic) || {}).title || '') : ''}${(i.labels || []).length ? ' · ' + i.labels.join(', ') : ''}</div></div>
      <span className="actions" style=${{ flexWrap: 'nowrap' }}>
        <span className=${'wkprio wkp-' + i.prio}>${WK_PRIO[i.prio][0]}</span>
        <span className="wkpts" title="Story points">${i.pts != null ? wkFmt(i.pts) : '–'}</span>
        <${WkWho} uid=${i.who} people=${d.people} />
        <select value=${i.sprint} onChange=${e => setSprint(i, e.target.value)} aria-label="Sprint" disabled=${!!busy || P.arch}><option value="">Backlog</option>${[...(active ? [active] : []), ...planned].map(s => html`<option key=${s.id} value=${s.id}>${s.n}</option>`)}</select>
        ${list && html`<button className="btn ghost sm" aria-label="Up" disabled=${!!busy} onClick=${() => rank(list, i, -1)}><${Icon} n="up" /></button><button className="btn ghost sm" aria-label="Down" disabled=${!!busy} onClick=${() => rank(list, i, 1)}><${Icon} n="down" /></button>`}
      </span>
    </li>`;
  const sum = list => `${list.length} item${list.length === 1 ? '' : 's'} · ${wkFmt(wkPts(list, 'points'))} points`;
  return html`<div className="stack">
      ${
        active &&
        html`<section className="panel stack">
          <div className="ph-row"><div><b>${active.n}</b> <${Chip} s="ok">active<//><div className="muted small">${active.goal || 'No goal written'} · ${sum(items.filter(i => i.sprint === active.id))}</div></div>
            ${d.manage && html`<button className="btn sm" onClick=${() => setComplete(active)}>Complete sprint</button>`}</div>
          <ul className="list">${items.filter(i => i.sprint === active.id).map(i => html`<${Row} key=${i.id} i=${i} />`)}</ul>
        </section>`
      }
      ${planned.map(s => {
        const list = items.filter(i => i.sprint === s.id);
        return html`<section key=${s.id} className="panel stack">
          <div className="ph-row"><div><b>${s.n}</b> <${Chip}>planned<//><div className="muted small">${s.goal || 'No goal written'} · ${s.start ? fmtDay(new Date(s.start + 'T12:00:00').getTime()) + ' – ' + (s.fin ? fmtDay(new Date(s.fin + 'T12:00:00').getTime()) : '') + ' · ' : ''}${sum(list)}</div></div>
            <div className="actions">${d.manage && html`<button className="btn sm" disabled=${!!active || !list.length || !!busy} title=${active ? 'Finish the active sprint first' : ''} onClick=${() => call('wk_sprint_start', { proj: P.id, id: s.id }, r => r.sprint.n + ' started.')}>Start sprint</button>`}<button className="btn ghost sm" onClick=${() => setSprintEdit(s)}>Edit</button>${d.manage && html`<button className="btn ghost sm" onClick=${() => confirm('Remove ' + s.n + '? Its work goes back to the backlog.') && call('wk_sprint_delete', { proj: P.id, id: s.id }, 'Sprint removed.')}>Remove</button>`}</div></div>
          ${list.length ? html`<ul className="list">${list.map(i => html`<${Row} key=${i.id} i=${i} />`)}</ul>` : html`<p className="muted small">Pick this sprint for work items in the backlog below.</p>`}
        </section>`;
      })}
      <section className="panel stack">
        <div className="ph-row"><div><b>Backlog</b><div className="muted small">${sum(backlog)} · in priority order: the top is done first</div></div>${!P.arch && html`<button className="btn ghost sm" onClick=${() => setSprintEdit({})}><${Icon} n="plus" />Plan a sprint</button>`}</div>
        ${backlog.length ? html`<ul className="list">${backlog.map(i => html`<${Row} key=${i.id} i=${i} list=${backlog} />`)}</ul>` : html`<p className="muted small">The backlog is empty. Add work items with "New work item".</p>`}
      </section>
      ${epics.length > 0 && html`<section className="panel stack"><b>Epics</b><ul className="list">${epics.map(e => {
        const kids = items.filter(i => i.epic === e.id);
        const done = kids.filter(i => doneKeys.includes(i.st)).length;
        return html`<li key=${e.id} className="wkrow" onClick=${() => onOpen(e.id)}><div><div className="t"><span className="muted">${P.key}-${e.num}</span> ${e.title}</div><div className="m">${done} of ${kids.length} done</div></div><div className="wkbarmini" style=${{ width: 120 }}><i className="done" style=${{ flex: Math.max(0.01, done) }} /><i style=${{ flex: Math.max(0.01, kids.length - done) }} /></div></li>`;
      })}</ul></section>`}
      ${sprintEdit && html`<${WkSprintModal} P=${P} s=${sprintEdit} onClose=${() => setSprintEdit(null)} onSaved=${onChanged} />`}
      ${complete && html`<${WkCompleteModal} P=${P} s=${complete} items=${items.filter(i => i.sprint === complete.id)} planned=${planned} onClose=${() => setComplete(null)} onDone=${onChanged} />`}
    </div>`;
}
function WkSprintModal({ P, s, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ n: s.n || '', goal: s.goal || '', start: s.start || '', fin: s.fin || '' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api('wk_sprint_save', { proj: P.id, id: s.id || '', ...f });
      toast(s.id ? 'Sprint saved.' : 'Sprint planned: pick it for work items in the backlog.');
      onSaved();
      onClose();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<${Modal} title=${s.id ? 'Edit ' + s.n : 'Plan a sprint'} onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Cancel</button><button className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save'}</button>`}>
      <div className="form">
        <${Field} label="Name" hint="Left empty: the next number (Sprint 3)"><input value=${f.n} onInput=${e => setF({ ...f, n: e.target.value })} /><//>
        <${Field} label="Goal" hint="What the sprint is for, in a sentence"><input value=${f.goal} onInput=${e => setF({ ...f, goal: e.target.value })} /><//>
        <div className="row2"><${Field} label="Starts"><input type="date" value=${f.start} onInput=${e => setF({ ...f, start: e.target.value })} /><//><${Field} label="Ends" hint="Two weeks if left empty"><input type="date" value=${f.fin} onInput=${e => setF({ ...f, fin: e.target.value })} /><//></div>
      </div>
    <//>`;
}
function WkCompleteModal({ P, s, items, planned, onClose, onDone }) {
  const toast = useToast();
  const doneKeys = P.cols.filter(c => c.done).map(c => c.k);
  const open = items.filter(i => !doneKeys.includes(i.st));
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const r = await api('wk_sprint_complete', { proj: P.id, id: s.id, to });
      toast(`${s.n} completed: ${wkFmt(r.completed)} ${r.unit} done${r.carried ? `, ${r.carried} carried over` : ''}.`);
      onDone();
      onClose();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<${Modal} title=${'Complete ' + s.n} onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Cancel</button><button className="btn" disabled=${busy} onClick=${go}>${busy ? 'Completing…' : 'Complete sprint'}</button>`}>
      <div className="form">
        <p className="small" style=${{ margin: 0 }}>${items.length - open.length} of ${items.length} work items are done (${wkFmt(wkPts(items.filter(i => doneKeys.includes(i.st)), 'points'))} of ${wkFmt(wkPts(items, 'points'))} points).</p>
        ${
          open.length > 0 &&
          html`<${Field} label=${open.length + ' unfinished: carry them to'}><select value=${to} onChange=${e => setTo(e.target.value)}><option value="">The backlog</option>${planned.map(x => html`<option key=${x.id} value=${x.id}>${x.n}</option>`)}</select><//>`
        }
        <p className="muted small" style=${{ margin: 0 }}>The sprint's figures go into the velocity report, and its retrospective stays open under Retrospectives.</p>
      </div>
    <//>`;
}

/* A work item: everything about it, its comments (@name tells someone) and its history. */
function WkItemModal({ id, fresh, d, onClose, onChanged }) {
  const toast = useToast();
  const P = d.project;
  const scrum = P.kind === 'scrum';
  const [x, setX] = useState(null);
  const [f, setF] = useState(null);
  const [cmt, setCmt] = useState('');
  const [busy, setBusy] = useState('');
  const [newCheck, setNewCheck] = useState('');
  const load = () =>
    api('wk_item_get', { id })
      .then(r => {
        setX(r);
        setF({ ...r.item, labelsTxt: (r.item.labels || []).join(', ') });
      })
      .catch(e => {
        toast(errText(e), true);
        onClose();
      });
  useEffect(() => {
    if (fresh) setF({ title: '', type: fresh.type || 'task', prio: 'medium', pts: null, who: '', due: '', labelsTxt: '', epic: '', sprint: fresh.sprint || '', st: fresh.st, check: [], blocked: false, bwhy: '', d: '' });
    else load();
  }, [id]);
  if (!f) return html`<${Modal} title="Work item" onClose=${onClose}><${Spinner} /><//>`;
  const I = x && x.item;
  const epics = d.items.filter(i => i.type === 'epic' && (!I || i.id !== I.id));
  const sprints = d.sprints.filter(s => s.st !== 'done');
  const fields = () => ({
    title: f.title,
    type: f.type,
    prio: f.prio,
    pts: f.pts === '' || f.pts == null ? null : +f.pts,
    who: f.who,
    due: f.due,
    labels: String(f.labelsTxt || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
    epic: f.epic,
    check: f.check,
    blocked: !!f.blocked,
    bwhy: f.bwhy || '',
    d: f.d || '',
    ...(scrum ? { sprint: f.sprint || '' } : {}),
  });
  const save = async () => {
    setBusy('save');
    try {
      if (fresh) {
        await api('wk_item_save', { proj: P.id, f: { ...fields(), st: f.st } });
        toast('Work item added.');
        onChanged();
        onClose();
        return;
      }
      await api('wk_item_save', { id: I.id, f: fields() });
      if (f.st !== I.st) await api('wk_move', { id: I.id, st: f.st, force: true });
      toast('Saved.');
      onChanged();
      onClose();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const comment = async () => {
    if (!cmt.trim()) return;
    setBusy('cmt');
    try {
      const r = await api('wk_comment', { id: I.id, txt: cmt.trim() });
      setCmt('');
      if (r.mentioned && r.mentioned.length) toast(`${r.mentioned.map(u => wkName(u, x.people)).join(', ')} will see it in My work.`);
      load();
      onChanged();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const del = async () => {
    if (!confirm('Delete ' + P.key + '-' + I.num + '? Its comments and history go too.')) return;
    try {
      await api('wk_item_delete', { id: I.id });
      toast('Deleted.');
      onChanged();
      onClose();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const histText = h => {
    const n = { st: 'Stage', title: 'Title', type: 'Type', prio: 'Priority', pts: 'Points', who: 'Assignee', due: 'Due', labels: 'Labels', epic: 'Epic', check: 'Checklist', blocked: 'Blocked', bwhy: 'Reason', sprint: 'Sprint', d: 'Description' }[h.f];
    const show = v => {
      if (h.f === 'st') return (P.cols.find(c => c.k === v) || {}).n || v;
      if (h.f === 'who') return v ? wkName(v, x.people) : 'nobody';
      if (h.f === 'sprint') return v ? (d.sprints.concat(d.past || []).find(s => s.id === v) || {}).n || 'a sprint' : 'the backlog';
      if (h.f === 'blocked') return v === '1' || v === 'true' ? 'yes' : 'no';
      return v === '' || v == null ? '–' : String(v).replace(/^\[|\]$/g, '').replace(/"/g, '');
    };
    if (h.f === 'new') return 'created it';
    if (h.f === 'cmt') return 'commented';
    if (h.f === 'd') return 'changed the description';
    return `${n || h.f}: ${show(h.a)} → ${show(h.b)}`;
  };
  return html`<${Modal} wide title=${fresh ? 'New work item' : P.key + '-' + I.num} onClose=${onClose} foot=${html`${!fresh && !P.arch && html`<button className="btn ghost" style=${{ marginRight: 'auto' }} onClick=${del}>Delete</button>`}<button className="btn ghost" onClick=${onClose}>Close</button>${!P.arch && html`<button className="btn" disabled=${!!busy || !f.title.trim()} onClick=${save}>${busy === 'save' ? 'Saving…' : fresh ? 'Add' : 'Save'}</button>`}`}>
      <div className="wkitem">
        <div className="form">
          <${Field} label="Title"><input value=${f.title} onInput=${e => setF({ ...f, title: e.target.value })} autoFocus=${!!fresh} placeholder="What needs doing, in a few words" /><//>
          <div className="row3">
            <${Field} label="Type"><select value=${f.type} onChange=${e => setF({ ...f, type: e.target.value })}>${Object.entries(WK_TYPE).map(([k, v]) => html`<option key=${k} value=${k}>${v[0]}</option>`)}</select><//>
            <${Field} label="Priority"><select value=${f.prio} onChange=${e => setF({ ...f, prio: e.target.value })}>${Object.entries(WK_PRIO).map(([k, v]) => html`<option key=${k} value=${k}>${v[0]}</option>`)}</select><//>
            <${Field} label="Story points"><input type="number" min="0" step="0.5" value=${f.pts == null ? '' : f.pts} onInput=${e => setF({ ...f, pts: e.target.value })} placeholder="–" /><//>
          </div>
          <div className="row3">
            <${Field} label="Assignee"><select value=${f.who} onChange=${e => setF({ ...f, who: e.target.value })}><option value="">Unassigned</option>${d.people.map(p => html`<option key=${p.id} value=${p.id}>${p.n}</option>`)}</select><//>
            <${Field} label="Stage"><select value=${f.st} onChange=${e => setF({ ...f, st: e.target.value })} disabled=${scrum && !f.sprint && f.type !== 'epic'}>${P.cols.map(c => html`<option key=${c.k} value=${c.k}>${c.n}</option>`)}</select><//>
            <${Field} label="Due"><input type="date" value=${f.due} onInput=${e => setF({ ...f, due: e.target.value })} /><//>
          </div>
          <div className="row3">
            ${scrum && f.type !== 'epic' && html`<${Field} label="Sprint"><select value=${f.sprint} onChange=${e => setF({ ...f, sprint: e.target.value })}><option value="">Backlog</option>${sprints.map(s => html`<option key=${s.id} value=${s.id}>${s.n}${s.st === 'active' ? ' (active)' : ''}</option>`)}</select><//>`}
            ${f.type !== 'epic' && html`<${Field} label="Epic"><select value=${f.epic} onChange=${e => setF({ ...f, epic: e.target.value })}><option value="">None</option>${epics.map(e => html`<option key=${e.id} value=${e.id}>${P.key}-${e.num} ${e.title}</option>`)}</select><//>`}
            <${Field} label="Labels" hint="Separated by commas"><input value=${f.labelsTxt} onInput=${e => setF({ ...f, labelsTxt: e.target.value })} placeholder="frontend, client-x" /><//>
          </div>
          <${Field} label="Description"><textarea value=${f.d} onInput=${e => setF({ ...f, d: e.target.value })} style=${{ minHeight: 110 }} placeholder="What done looks like (acceptance criteria), links, notes" /><//>
          <div className="stack" style=${{ gap: 6 }}>
            <span className="lbl">Checklist${f.check.length ? ` · ${f.check.filter(c => c.done).length}/${f.check.length}` : ''}</span>
            ${f.check.map((c, i) => html`<div key=${i} className="actions wkcheck"><label className="check"><input type="checkbox" checked=${!!c.done} onChange=${e => setF({ ...f, check: f.check.map((y, j) => (j === i ? { ...y, done: e.target.checked } : y)) })} /><span className=${c.done ? 'muted' : ''}>${c.t}</span></label><button type="button" className="btn ghost sm" aria-label="Remove" onClick=${() => setF({ ...f, check: f.check.filter((y, j) => j !== i) })}><${Icon} n="x" /></button></div>`)}
            <input value=${newCheck} onInput=${e => setNewCheck(e.target.value)} onKeyDown=${e => {
              if (e.key === 'Enter' && newCheck.trim()) {
                e.preventDefault();
                setF({ ...f, check: [...f.check, { t: newCheck.trim(), done: false }] });
                setNewCheck('');
              }
            }} placeholder="+ Add a step (Enter)" />
          </div>
          <label className="check"><input type="checkbox" checked=${!!f.blocked} onChange=${e => setF({ ...f, blocked: e.target.checked })} /><span>Blocked</span></label>
          ${f.blocked && html`<${Field} label="What it is waiting for"><input value=${f.bwhy} onInput=${e => setF({ ...f, bwhy: e.target.value })} placeholder="Client access, a decision, another item" /><//>`}
        </div>
        ${
          !fresh &&
          html`<aside className="stack wkside">
            <div className="muted small">Created ${fmtTs(I.at)} by ${wkName(I.by, x.people)} · in "${(P.cols.find(c => c.k === I.st) || {}).n || I.st}" for ${wkDays(I.stAt)} day${wkDays(I.stAt) === 1 ? '' : 's'}${I.doneAt ? ' · done ' + fmtTs(I.doneAt) : ''}</div>
            <b>Comments</b>
            ${x.comments.length ? html`<ul className="list">${x.comments.map(c => html`<li key=${c.id}><div><div className="t" style=${{ whiteSpace: 'pre-wrap' }}>${c.txt}</div><div className="m">${wkName(c.who, x.people)} · ${fmtTs(c.at)}</div></div></li>`)}</ul>` : html`<p className="muted small">No comments yet.</p>`}
            <textarea value=${cmt} onInput=${e => setCmt(e.target.value)} placeholder="Write a comment; @Name tells someone on the project" />
            <div><button className="btn sm" disabled=${busy === 'cmt' || !cmt.trim()} onClick=${comment}>${busy === 'cmt' ? 'Sending…' : 'Comment'}</button></div>
            <details><summary className="small"><b>History</b> (${x.hist.length})</summary><ul className="list small">${x.hist.map((h, k) => html`<li key=${k}><div><div className="t">${wkName(h.who, x.people)} ${histText(h)}</div><div className="m">${fmtTs(h.at)}</div></div></li>`)}</ul></details>
          </aside>`
        }
      </div>
    <//>`;
}

/* ---- reports: small SVG charts ---- */
function WkLine({ days, lines, max, unit }) {
  const W = 640;
  const H = 220;
  const pad = 30;
  const n = Math.max(1, days.length - 1);
  const top = Math.max(1, max);
  const X = i => pad + (i / n) * (W - pad - 10);
  const Y = v => H - pad - (v / top) * (H - pad - 12);
  return html`<svg className="wkchart" viewBox=${'0 0 ' + W + ' ' + H} role="img" aria-label=${'Burndown in ' + unit}>
      <line x1=${pad} y1=${H - pad} x2=${W - 10} y2=${H - pad} className="ax" /><line x1=${pad} y1="10" x2=${pad} y2=${H - pad} className="ax" />
      <text x="4" y="16" className="tk">${wkFmt(top)}</text><text x="4" y=${H - pad} className="tk">0</text>
      ${days.map((d, i) => {
        const step = Math.ceil(days.length / 6);
        return i === 0 || i === days.length - 1 || (i % step === 0 && days.length - 1 - i >= step / 2) ? html`<text key=${d} x=${X(i)} y=${H - 10} className="tk" textAnchor="middle">${d.slice(5)}</text>` : null;
      })}
      ${lines.map(
        (l, k) =>
          html`<polyline key=${k} className=${'ln ' + l.cls} points=${l.pts
            .map((v, i) => (v == null ? null : X(i) + ',' + Y(v)))
            .filter(Boolean)
            .join(' ')} />`
      )}
      ${lines.filter(l => l.cls === 'real').map(l => l.pts.map((v, i) => (v == null ? null : html`<circle key=${'d' + i} className="dot" cx=${X(i)} cy=${Y(v)} r="3.5"><title>${days[i]}: ${wkFmt(v)} ${unit} left</title></circle>`)))}
    </svg>`;
}
function WkBars({ rows, max, keys }) {
  const W = 640;
  const H = 200;
  const pad = 30;
  const top = Math.max(1, max);
  const bw = (W - pad - 10) / Math.max(1, rows.length);
  return html`<svg className="wkchart" viewBox=${'0 0 ' + W + ' ' + H} role="img">
      <line x1=${pad} y1=${H - pad} x2=${W - 10} y2=${H - pad} className="ax" />
      <text x="4" y="16" className="tk">${wkFmt(top)}</text>
      ${rows.map((r, i) => {
        const w = (bw * 0.7) / keys.length;
        return html`<g key=${i}>${keys.map((k, j) => {
          const h = ((+r[k[0]] || 0) / top) * (H - pad - 14);
          return html`<rect key=${k[0]} className=${'wkbar ' + k[1]} x=${pad + i * bw + bw * 0.15 + j * w} y=${H - pad - h} width=${Math.max(2, w - 2)} height=${h}><title>${r.l}: ${k[2]} ${wkFmt(r[k[0]])}</title></rect>`;
        })}<text x=${pad + i * bw + bw / 2} y=${H - 10} className="tk" textAnchor="middle">${String(r.l).slice(0, 12)}</text></g>`;
      })}
    </svg>`;
}
function WkFlow({ cfd, cols }) {
  const W = 640;
  const H = 220;
  const pad = 30;
  const n = Math.max(1, cfd.length - 1);
  const tot = Math.max(1, ...cfd.map(d => Object.values(d.n).reduce((a, b) => a + b, 0)));
  const X = i => pad + (i / n) * (W - pad - 10);
  const Y = v => H - pad - (v / tot) * (H - pad - 12);
  // stacked from the done stages at the bottom up to the first stage on top
  const order = cols.slice().reverse();
  const bands = order.map((c, k) => {
    const below = d => order.slice(0, k).reduce((t, o) => t + (d.n[o.k] || 0), 0);
    const upper = cfd.map((d, i) => X(i) + ',' + Y(below(d) + (d.n[c.k] || 0)));
    const lower = cfd.map((d, i) => X(i) + ',' + Y(below(d))).reverse();
    return html`<polygon key=${c.k} className=${'band b' + (k % 6)} points=${upper.concat(lower).join(' ')}><title>${c.n}</title></polygon>`;
  });
  return html`<div><svg className="wkchart" viewBox=${'0 0 ' + W + ' ' + H} role="img" aria-label="Cumulative flow">
      ${bands}
      <line x1=${pad} y1=${H - pad} x2=${W - 10} y2=${H - pad} className="ax" />
      <text x="4" y="16" className="tk">${tot}</text>
      ${cfd.map((d, i) => (i === 0 || i === cfd.length - 1 || (i % 7 === 0 && cfd.length - 1 - i >= 4) ? html`<text key=${d.day} x=${X(i)} y=${H - 10} className="tk" textAnchor="middle">${d.day.slice(5)}</text>` : null))}
    </svg><div className="wklegend">${order.map((c, k) => html`<span key=${c.k}><i className=${'band b' + (k % 6)} />${c.n}</span>`)}</div></div>`;
}
function WkReports({ d }) {
  const P = d.project;
  const scrum = P.kind === 'scrum';
  const [sprint, setSprint] = useState('');
  const [r, setR] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    setR(null);
    api('wk_reports', { id: P.id, sprint })
      .then(setR)
      .catch(setErr);
  }, [sprint]);
  if (err && !r) return html`<${LoadError} error=${err} />`;
  if (!r) return html`<${Spinner} />`;
  const bd = r.burndown;
  const sprintsAll = d.sprints.filter(s => s.st === 'active').concat(d.past || []);
  return html`<div className="stack">
      ${
        scrum &&
        html`<section className="panel stack">
          <div className="ph-row"><h2 className="ph">Burndown</h2><select value=${sprint} onChange=${e => setSprint(e.target.value)} aria-label="Sprint"><option value="">The active sprint</option>${sprintsAll.map(s => html`<option key=${s.id} value=${s.id}>${s.n}</option>`)}</select></div>
          ${
            bd
              ? html`<p className="muted small" style=${{ margin: 0 }}>${bd.sprint.n}: ${wkFmt(bd.start)} ${bd.unit} at the start; the dashed line is an even pace to zero.</p>
                <${WkLine} days=${bd.days.map(x => x.day)} unit=${bd.unit} max=${Math.max(bd.start, ...bd.days.map(x => x.left || 0))} lines=${[
                  { cls: 'ideal', pts: bd.days.map((x, i) => bd.start * (1 - i / Math.max(1, bd.days.length - 1))) },
                  { cls: 'real', pts: bd.days.map(x => x.left) },
                ]} />`
              : html`<p className="muted small">No sprint has started yet.</p>`
          }
        </section>
        <section className="panel stack">
          <h2 className="ph">Velocity</h2>
          ${r.velocity && r.velocity.length ? html`<${WkBars} rows=${r.velocity.map(v => ({ l: v.n, a: v.committed, b: v.done }))} keys=${[['a', 'plan', 'committed'], ['b', 'done', 'completed']]} max=${Math.max(1, ...r.velocity.map(v => Math.max(v.committed, v.done)))} /><p className="muted small" style=${{ margin: 0 }}>Committed (light) and completed (dark) per finished sprint. Average completed: ${wkFmt(r.velocity.reduce((t, v) => t + v.done, 0) / r.velocity.length)}.</p>` : html`<p className="muted small">After the first sprint is completed.</p>`}
        </section>`
      }
      <section className="panel stack"><h2 className="ph">Cumulative flow (30 days)</h2><${WkFlow} cfd=${r.cfd} cols=${P.cols} /><p className="muted small" style=${{ margin: 0 }}>A band that keeps widening is a stage where work piles up.</p></section>
      <div className="g2" style=${{ alignItems: 'start' }}>
        <section className="panel stack"><h2 className="ph">Cycle time</h2>${r.cycle.items.length ? html`<${KitStats} items=${[{ v: r.cycle.avg + ' d', l: 'Average, start to done' }, { v: r.cycle.p85 + ' d', l: '85% finish within' }, { v: r.cycle.items.length, l: 'Done in 90 days' }]} /><${WkBars} rows=${r.cycle.items.slice(-20).map(c => ({ l: P.key + '-' + c.num, a: c.days }))} keys=${[['a', 'done', 'days']]} max=${Math.max(1, ...r.cycle.items.map(c => c.days))} />` : html`<p className="muted small">When work items are done, how long each took from leaving "${P.cols[0].n}" shows here.</p>`}</section>
        <section className="panel stack"><h2 className="ph">Throughput</h2><${WkBars} rows=${r.throughput.map(t => ({ l: t.to.slice(5), a: t.n }))} keys=${[['a', 'done', 'done']]} max=${Math.max(1, ...r.throughput.map(t => t.n))} /><p className="muted small" style=${{ margin: 0 }}>Work items done per week (the week ending on each date).</p></section>
      </div>
      <section className="panel stack"><h2 className="ph">Aging work in progress</h2>${
        r.aging.length
          ? html`<div className="tblwrap"><table className="tbl small"><thead><tr><th>Work item</th><th>Stage</th><th>Assignee</th><th className="r">Days in stage</th><th className="r">Days since started</th></tr></thead><tbody>${r.aging.map(a => html`<tr key=${a.id}><td>${P.key}-${a.num} ${a.title}${a.blocked ? html` <${Chip} s="red">Blocked<//>` : null}</td><td>${(P.cols.find(c => c.k === a.st) || {}).n || a.st}</td><td>${a.who ? wkName(a.who, d.people) : '–'}</td><td className=${'r num' + (a.inStage >= 7 ? ' wklate' : '')}>${a.inStage}</td><td className="r num">${a.age}</td></tr>`)}</tbody></table></div>`
          : html`<p className="muted small">Nothing in progress.</p>`
      }</section>
    </div>`;
}

/* ---- the daily stand-up ---- */
function WkDaily({ d, onOpen }) {
  const toast = useToast();
  const P = d.project;
  const me = (usePortal() || {}).uid || '';
  const [day, setDay] = useState(wkToday());
  const [r, setR] = useState(null);
  const [f, setF] = useState({ y: '', t: '', b: '' });
  const [busy, setBusy] = useState(false);
  const load = () =>
    api('wk_daily', { id: P.id, day })
      .then(x => {
        setR(x);
        const mine = x.entries.find(e => e.uid === me);
        if (mine && day === wkToday()) setF({ y: mine.y, t: mine.t, b: mine.b });
      })
      .catch(e => toast(errText(e), true));
  useEffect(() => {
    load();
  }, [day]);
  if (!r) return html`<${Spinner} />`;
  const save = async () => {
    setBusy(true);
    try {
      await api('wk_daily_save', { id: P.id, ...f, day: wkToday() }); // file it under the poster's local day, the one this page reads
      toast('Your stand-up is in.');
      load();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const missing = d.people.filter(p => !r.entries.some(e => e.uid === p.id));
  return html`<div className="g2" style=${{ alignItems: 'start' }}>
      <div className="stack">
        <section className="panel stack">
          <div className="ph-row"><h2 className="ph">Stand-up</h2><input type="date" value=${day} max=${wkToday()} onInput=${e => setDay(e.target.value || wkToday())} aria-label="Day" /></div>
          ${r.entries.length ? r.entries.map(e => html`<div key=${e.uid} className="wkdaily"><div className="actions"><${WkWho} uid=${e.uid} people=${r.people} /><b>${wkName(e.uid, r.people)}</b><span className="muted small">${fmtTs(e.at)}</span></div>${e.y && html`<div className="small"><span className="lbl">Yesterday</span> ${e.y}</div>`}${e.t && html`<div className="small"><span className="lbl">Today</span> ${e.t}</div>`}${e.b && html`<div className="small wklate"><span className="lbl">Blockers</span> ${e.b}</div>`}</div>`) : html`<p className="muted small">Nobody has posted for this day.</p>`}
          ${day === wkToday() && missing.length > 0 && html`<p className="muted small" style=${{ margin: 0 }}>Not in yet: ${missing.map(p => p.n).join(', ')}.</p>`}
        </section>
        ${r.blocked.length > 0 && html`<section className="panel stack"><b>Blocked work items</b><ul className="list">${r.blocked.map(i => html`<li key=${i.id} className="wkrow" onClick=${() => onOpen(i.id)}><div><div className="t">${P.key}-${i.num} ${i.title}</div><div className="m">${i.bwhy || 'No reason given'}${i.who ? ' · ' + wkName(i.who, r.people) : ''}</div></div></li>`)}</ul></section>`}
      </div>
      ${
        day === wkToday() &&
        d.people.some(p => p.id === me) &&
        html`<section className="panel stack form">
          <h2 className="ph">Your update</h2>
          <${Field} label="Yesterday"><textarea value=${f.y} onInput=${e => setF({ ...f, y: e.target.value })} placeholder="What you finished" /><//>
          <${Field} label="Today"><textarea value=${f.t} onInput=${e => setF({ ...f, t: e.target.value })} placeholder="What you will work on" /><//>
          <${Field} label="Blockers" hint="The project lead is told"><textarea value=${f.b} onInput=${e => setF({ ...f, b: e.target.value })} placeholder="Anything in your way" /><//>
          <div><button className="btn" disabled=${busy} onClick=${save}>${busy ? 'Posting…' : 'Post'}</button></div>
        </section>`
      }
    </div>`;
}

/* ---- sprint retrospectives ---- */
function WkRetro({ d, onChanged }) {
  const toast = useToast();
  const P = d.project;
  const me = (usePortal() || {}).uid || '';
  const options = d.sprints.filter(s => s.st === 'active').concat(d.past || []);
  const [sid, setSid] = useState(options.length ? (d.past && d.past.length ? d.past[0].id : options[0].id) : '');
  const [r, setR] = useState(null);
  const [txt, setTxt] = useState({ good: '', bad: '', try: '' });
  const load = () => (sid ? api('wk_retro', { id: P.id, sprint: sid }).then(setR).catch(e => toast(errText(e), true)) : null);
  useEffect(() => {
    load();
  }, [sid]);
  if (!options.length) return html`<${Empty} title="No sprints yet">A retrospective belongs to a sprint: once one has started, the team writes what went well, what did not, and what to try next.<//>`;
  const act = async (body, msg) => {
    try {
      const x = await api('wk_retro_save', { id: P.id, sprint: sid, ...body });
      if (msg) toast(typeof msg === 'function' ? msg(x) : msg);
      load();
      if (body.act === 'item') onChanged();
      return true;
    } catch (e) {
      toast(errText(e), true);
      return false;
    }
  };
  return html`<div className="stack">
      <div className="toolbar"><select value=${sid} onChange=${e => setSid(e.target.value)} aria-label="Sprint">${options.map(s => html`<option key=${s.id} value=${s.id}>${s.n}${s.st === 'active' ? ' (active)' : ''}</option>`)}</select><span className="muted small">Everyone on the project adds notes and votes; an idea to try can become a work item.</span></div>
      ${
        !r
          ? html`<${Spinner} />`
          : html`<div className="wkretro">${Object.entries(WK_RETRO).map(
              ([k, n]) => html`<section key=${k} className=${'panel stack wkretrocol ' + k}>
                <b>${n}</b>
                ${r.notes
                  .filter(x => x.kind === k)
                  .sort((a, b) => b.votes.length - a.votes.length)
                  .map(
                    x => html`<div key=${x.id} className="wkretronote">
                    <div className="small">${x.txt}</div>
                    <div className="actions">
                      <button className=${'btn ghost sm' + (x.votes.includes(me) ? ' on' : '')} onClick=${() => act({ act: 'vote', note: x.id })} aria-label="Vote">+${x.votes.length}</button>
                      ${k === 'try' && (x.item ? html`<span className="muted small">a work item</span>` : html`<button className="btn ghost sm" onClick=${() => act({ act: 'item', note: x.id }, y => P.key + '-' + y.num + ' added to the backlog.')}>Make it a work item</button>`)}
                      ${x.who === me && html`<button className="btn ghost sm" aria-label="Remove" onClick=${() => act({ act: 'del', note: x.id })}><${Icon} n="x" /></button>`}
                    </div>
                  </div>`
                  )}
                <textarea value=${txt[k]} onInput=${e => setTxt({ ...txt, [k]: e.target.value })} placeholder="Add a note" />
                <div><button className="btn sm" disabled=${!txt[k].trim()} onClick=${() => act({ act: 'add', kind: k, txt: txt[k] }).then(ok => ok && setTxt(t => ({ ...t, [k]: '' })))}>Add</button></div>
              </section>`
            )}</div>`
      }
    </div>`;
}
