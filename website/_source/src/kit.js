/* ================= Building blocks for list-and-form pages (CRM, HRMS, ads) ================= */
function KitTabs({ tabs, tab, onTab, wrap }) {
  return html`<div className=${'tabs' + (wrap ? ' wrap' : '')} role="tablist">
      ${tabs.map(
        ([k, n, c]) => html`<button key=${k} type="button" role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => onTab(k)}>
            ${n}${c ? html`<span className="badge">${c}</span>` : null}
          </button>`
      )}
    </div>`;
}
function KitStats({ items }) {
  return html`<div className="kpis">
      ${items.map(
        (x, i) => {
          // a long money figure shrinks rather than breaking mid-number; words still wrap
          const sv = typeof x.v === 'string' || typeof x.v === 'number' ? String(x.v) : '';
          const num = sv !== '' && /^[-−+$€£₹\d.,\s%]+$/.test(sv);
          return html`<a key=${i} href=${x.href || undefined} onClick=${x.onClick} className=${(x.tone ? 'k-' + x.tone : '') + (num ? ' k-num' : '') + (num && sv.length > 10 ? ' k-long' : '')} title=${sv || undefined}>
            <b>${x.v}</b>
            <span>${x.l}</span>
          </a>`;
        }
      )}
    </div>`;
}
const kitPeople = P =>
  P.admin
    ? P.admin.members.filter(m => m.role !== 'employer' && m.st === 'active').map(m => [m.id, m.u.p.n])
    : [[P.uid, (P.prof && P.prof.n) || 'Me']];
const kitName = (P, id) => {
  if (!id) return '';
  const m = P.admin && P.admin.members.find(x => x.id === id);
  return m ? m.u.p.n : (P.people[id] && P.people[id].name) || (id === P.uid ? (P.prof && P.prof.n) || 'Me' : '');
};
const refName = (list, id) => {
  const o = (list || []).find(x => x[0] === id);
  return o ? o[1] : '';
};
const kitOpts = (f, P, refs) => (f.t === 'person' ? kitPeople(P) : f.t === 'ref' ? (refs || {})[f.ref] || [] : f.o || []);
function kitText(f, row, P, refs) {
  const v = row[f.k];
  if (v == null || v === '') return '';
  if (f.t === 'person') return kitName(P, v);
  if (f.t === 'ref') return refName((refs || {})[f.ref], v);
  if (f.t === 'check') return v ? 'Yes' : '';
  if (f.t === 'money') return fmtMoney(+v || 0, row[f.curKey || 'cur'] || f.cur || 'USD');
  if (f.t === 'date') return fmtDate(v);
  if (f.t === 'select') {
    const o = (f.o || []).find(x => (Array.isArray(x) ? x[0] === v : x === v));
    return Array.isArray(o) ? o[1] : String(v);
  }
  return String(v);
}
function kitShow(f, row, P, refs) {
  const v = row[f.k];
  if (v == null || v === '') return html`<span className="muted">—</span>`;
  if (f.t === 'url')
    return html`<a href=${/^https?:/i.test(v) ? v : 'https://' + v} target="_blank" rel="noopener" onClick=${e => e.stopPropagation()}>${String(v).replace(/^https?:\/\//, '').slice(0, 36)}</a>`;
  if (f.t === 'email') return html`<a href=${'mailto:' + v} onClick=${e => e.stopPropagation()}>${v}</a>`;
  if (f.t === 'check') return v ? html`<${Chip} s="ok">${f.yes || 'Yes'}<//>` : html`<span className="muted">—</span>`;
  if (f.chip) return html`<${Chip} s=${(f.chip[v] || '')}>${kitText(f, row, P, refs)}<//>`;
  return kitText(f, row, P, refs);
}
function KitInput({ f, v, set, opts }) {
  const val = v == null ? '' : v;
  const on = e => set(e.target.value);
  if (f.t === 'textarea') return html`<textarea value=${val} onInput=${on} rows=${f.rows || 3} placeholder=${f.ph || ''} />`;
  if (f.t === 'check')
    return html`<span className="kcheck"><input type="checkbox" checked=${!!v} onChange=${e => set(e.target.checked)} /><span>${f.cl || 'Yes'}</span></span>`;
  if (f.t === 'select' || f.t === 'person' || f.t === 'ref') {
    // a value saved before the list changed stays selectable
    const known = (opts || []).some(o => (Array.isArray(o) ? o[0] : o) === val);
    return html`<select value=${val} onChange=${on}>
        <option value="">${f.none || '—'}</option>
        ${(opts || []).map(o =>
          Array.isArray(o) ? html`<option key=${o[0]} value=${o[0]}>${o[1]}</option>` : html`<option key=${o} value=${o}>${o}</option>`
        )}
        ${val !== '' && !known && html`<option value=${val}>${String(val)}</option>`}
      </select>`;
  }
  const type = { number: 'number', money: 'number', date: 'date', email: 'email', tel: 'tel', url: 'url' }[f.t] || 'text';
  return html`<input type=${type} value=${val} onInput=${on} placeholder=${f.ph || ''} step=${f.t === 'money' ? '0.01' : undefined} />`;
}
function KitForm({ title, fields, init, refs, onSave, onClose, onDelete, preview }) {
  const P = usePortal();
  const [f, setF] = useState({ ...init });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    const miss = fields.find(x => x.req && (f[x.k] == null || String(f[x.k]).trim() === ''));
    if (miss) {
      setErr(`Add the ${miss.n.toLowerCase()}.`);
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await onSave(f);
      onClose();
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  };
  return html`<${Modal} title=${title} onClose=${onClose} foot=${html`${
    onDelete &&
    html`<button type="button" className="btn ghost danger" style=${{ marginRight: 'auto' }} onClick=${onDelete}>Delete</button>`
  }
      <button type="button" className="btn ghost" onClick=${onClose}>Cancel</button>
      <button type="button" className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save'}</button>`}>
      ${preview && html`<div className="kitprev">${preview(f)}</div>`}
      <div className="form kitform">
        ${fields
          .filter(x => !(typeof x.hide === 'function' ? x.hide(f) : x.hide))
          .map(
            x => html`<div key=${x.k} className=${x.wide || x.t === 'textarea' ? 'wide' : ''}>
                <${Field} label=${x.n + (x.req ? ' *' : '')} hint=${x.hint}>
                  <${KitInput} f=${x} v=${f[x.k]} set=${v => setF(s => ({ ...s, [x.k]: v }))} opts=${kitOpts(x, P, refs)} />
                <//>
              </div>`
          )}
      </div>
      ${err && html`<p className="err" role="alert">${err}</p>`}
    <//>`;
}
/* A searchable table over one collection with add / edit / delete and CSV export; optional board view. */
/* Save a row of a list-and-form page: numbers coerced, new rows stamped with who and when. */
async function kitSave(col, fields, edit, v, P, defaults) {
  const now = Date.now();
  const num = x => x.t === 'money' || x.t === 'number';
  const out = {};
  fields.forEach(x => {
    if (v[x.k] === undefined) return;
    out[x.k] = num(x) ? (v[x.k] === '' || v[x.k] == null ? null : +v[x.k]) : v[x.k];
  });
  if (edit && edit.id) await dbMerge(`${col}/${edit.id}`, { ...out, u: now, ub: P.uid });
  else await dbSet(`${col}/${nid()}`, { ...(defaults || {}), ...out, at: now, by: P.uid, u: now });
  return out;
}
function KitList({ col, fields, cols, title, noun, empty, refs, search, defaults, rowTools, filter, board, preview, onSaved, extraTools, onOpen, sort }) {
  const P = usePortal();
  const toast = useToast();
  const data = useCol(col, sort || 'u:desc');
  const [q, setQ] = useState('');
  const [view, setView] = useState(board ? 'board' : 'table');
  const [edit, setEdit] = useState(null);
  const needle = q.trim().toLowerCase();
  const list = data.docs.filter(
    r =>
      (!filter || filter(r)) &&
      (!needle ||
        (search || fields.map(x => x.k)).some(k =>
          kitText(fields.find(x => x.k === k) || { k }, r, P, refs)
            .toLowerCase()
            .includes(needle)
        ))
  );
  const shownCols = (cols || fields.slice(0, 5).map(x => x.k)).map(k => fields.find(x => x.k === k)).filter(Boolean);
  const num = x => x.t === 'money' || x.t === 'number';
  const save = async v => {
    const out = await kitSave(col, fields, edit, v, P, defaults);
    toast(edit && edit.id ? `${noun} saved.` : `${noun} added.`);
    onSaved && onSaved(out, edit && edit.id ? edit : null);
  };
  const open = r => (onOpen ? onOpen(r, () => setEdit(r)) : setEdit(r));
  const del = async () => {
    if (!confirm(`Delete this ${noun.toLowerCase()}? This can't be undone.`)) return;
    try {
      await dbDel(`${col}/${edit.id}`);
      setEdit(null);
      toast(`${noun} deleted.`);
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const exp = async () => {
    try {
      await saveDownload(
        `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${dkey()}.csv`,
        toCSV([fields.map(x => x.n), ...list.map(r => fields.map(x => kitText(x, r, P, refs)))])
      );
    } catch (e) {
      if (!e || e.code !== 'declined') toast(errText(e), true);
    }
  };
  return html`<div className="stack">
      <div className="toolbar">
        <label className="kitsearch">
          <${Icon} n="search" />
          <input type="search" placeholder=${'Search ' + title.toLowerCase()} value=${q} onInput=${e => setQ(e.target.value)} aria-label=${'Search ' + title.toLowerCase()} />
        </label>
        ${
          board &&
          html`<div className="seg" role="group" aria-label="View">
              <button type="button" className=${view === 'board' ? 'on' : ''} onClick=${() => setView('board')}>Board</button>
              <button type="button" className=${view === 'table' ? 'on' : ''} onClick=${() => setView('table')}>Table</button>
            </div>`
        }
        <div className="push">
          ${extraTools}
          <button type="button" className="btn ghost" disabled=${!list.length} onClick=${exp}><${Icon} n="down" />CSV</button>
          <button type="button" className="btn" onClick=${() => setEdit({ ...(defaults || {}) })}><${Icon} n="plus" />${'Add ' + noun.toLowerCase()}</button>
        </div>
      </div>
      ${
        data.loading
          ? html`<${Spinner} onRetry=${() => Sync.kick(0)} />`
          : data.error
            ? html`<${LoadError} error=${data.error} onRetry=${() => Sync.kick(0)} />`
            : board && view === 'board'
              ? board(list, open)
              : !list.length
                ? html`<div className="panel"><${Empty} title=${needle ? 'Nothing matches that search' : empty || 'Nothing here yet'}>${needle ? 'Try other words.' : `Use "Add ${noun.toLowerCase()}" to create the first one.`}<//></div>`
                : html`<section className="panel" style=${{ padding: '6px 8px' }}>
                    <div className="tblwrap">
                      <table className="tbl click">
                        <thead>
                          <tr>${shownCols.map(x => html`<th key=${x.k} className=${num(x) ? 'r' : ''}>${x.n}</th>`)}${rowTools && html`<th className="r"></th>`}</tr>
                        </thead>
                        <tbody>
                          ${list.map(
                            r => html`<tr key=${r.id} onClick=${() => open(r)} tabIndex="0" onKeyDown=${e => e.key === 'Enter' && open(r)}>
                                ${shownCols.map(x => html`<td key=${x.k} className=${num(x) ? 'r' : ''}>${kitShow(x, r, P, refs)}</td>`)}
                                ${rowTools && html`<td className="r" onClick=${e => e.stopPropagation()}>${rowTools(r)}</td>`}
                              </tr>`
                          )}
                        </tbody>
                      </table>
                    </div>
                  </section>`
      }
      ${
        edit &&
        html`<${KitForm}
          title=${(edit.id ? 'Edit ' : 'New ') + noun.toLowerCase()}
          fields=${fields}
          init=${edit}
          refs=${refs}
          preview=${preview}
          onSave=${save}
          onClose=${() => setEdit(null)}
          onDelete=${edit.id ? del : null}
        />`
      }
    </div>`;
}
