/* ================= The storage box =================
   Everything the site stores, in one list: resumes, timesheets, employee documents, MSAs, invoice and bill
   attachments, e-signature documents, inbox attachments and the shared box. Plus the shared box itself, where
   staff drop files with a note and tags for everyone to find. */
function StoragePage() {
  const P = usePortal();
  const toast = useToast();
  const [tab, setTab] = useState('box');
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);
  const [box, setBox] = useState(null);
  const [adding, setAdding] = useState(false);
  const [bq, setBq] = useState('');
  const [btag, setBtag] = useState('');
  const load = (opts = {}) =>
    api('storage_list', { q, kind, page, ...opts })
      .then(r => {
        setErr(null);
        setD(r);
      })
      .catch(e => setErr(e));
  const loadBox = () =>
    api('storage_box')
      .then(r => setBox(r.items))
      .catch(e => toast(errText(e), true));
  useEffect(() => {
    load();
  }, [kind, page]);
  useEffect(() => {
    loadBox();
  }, []);
  const del = async f => {
    if (!confirm(`Delete "${f.n}" for good? The record it belongs to keeps working, but the file is gone.`)) return;
    try {
      await api('storage_delete', { base: f.base, id: f.id });
      toast('File deleted.');
      load();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const cleanup = async () => {
    if (!confirm(`Remove ${d.orphans} file${d.orphans === 1 ? '' : 's'} no record points to any more (${fmtBytes(d.orphanBytes)})?`)) return;
    try {
      const r = await api('storage_cleanup', {});
      toast(`${r.removed} file${r.removed === 1 ? '' : 's'} removed.`);
      load();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const delBox = async it => {
    if (!confirm(`Remove "${it.t || 'this note'}" and its ${it.files.length} file${it.files.length === 1 ? '' : 's'}?`)) return;
    try {
      await api('storage_box_delete', { id: it.id });
      loadBox();
      load();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const tags = box ? [...new Set(box.flatMap(it => it.tags))].sort() : [];
  const bql = bq.trim().toLowerCase();
  const boxList = (box || []).filter(it => (!btag || it.tags.includes(btag)) && (!bql || [it.t, it.byn, ...it.tags, ...it.files.map(f => f.n)].join(' ').toLowerCase().includes(bql)));
  const pages = d ? Math.max(1, Math.ceil(d.total / d.per)) : 1;
  return html`<div className="stack">
      ${
        d &&
        html`<${KitStats} items=${[
            { v: d.count, l: 'Files stored', onClick: () => setTab('all') },
            { v: fmtBytes(d.bytes), l: 'Space used by them' },
            { v: d.disk.free ? fmtBytes(d.disk.free) : '—', l: 'Free on the server', tone: d.disk.free && d.disk.free < 200 * 1048576 ? 'warn' : '' },
            { v: (box || []).length, l: 'Notes in the shared box', onClick: () => setTab('box') },
          ]} />`
      }
      <${KitTabs} tab=${tab} onTab=${setTab} tabs=${[
        ['box', 'Shared box', box && box.length],
        ['all', 'Everything stored', d && d.count],
      ]} />
      ${
        tab === 'box' &&
        html`<div className="stack">
            <div className="toolbar">
              <input type="search" style=${{ maxWidth: 300 }} placeholder="Search notes, files, people" value=${bq} onInput=${e => setBq(e.target.value)} aria-label="Search the box" />
              ${tags.length > 0 && html`<select value=${btag} onChange=${e => setBtag(e.target.value)} aria-label="Tag"><option value="">All tags</option>${tags.map(t => html`<option key=${t} value=${t}>${t}</option>`)}</select>`}
              <div className="push"><button className="btn" onClick=${() => setAdding(true)}><${Icon} n="plus" />Add to the box</button></div>
            </div>
            ${
              !box
                ? html`<${Spinner} />`
                : boxList.length
                  ? html`<div className="boxgrid">
                      ${boxList.map(
                        it => html`<section key=${it.id} className="panel boxcard">
                            <div className="boxhead">
                              <b>${it.t || 'Untitled'}</b>
                              <span className="muted small">${it.byn || '—'} · ${fmtTs(it.at)}</span>
                            </div>
                            ${it.tags.length > 0 && html`<div className="chips">${it.tags.map(t => html`<span key=${t} className="chip">${t}</span>`)}</div>`}
                            <ul className="files">
                              ${it.files.map(f => html`<li key=${f.id}><a href=${fileUrl(f.base, f.id)} target="_blank" rel="noopener">${f.n}</a><span className="muted small">${fmtBytes(f.sz)}</span><a className="btn ghost sm" href=${fileUrl(f.base, f.id, true)}><${Icon} n="down" /></a></li>`)}
                              ${!it.files.length && html`<li className="muted small">No files, just the note.</li>`}
                            </ul>
                            ${(it.by === P.uid || (P.roles || []).includes('admin')) && html`<div className="actions"><button className="btn link small" onClick=${() => delBox(it)}>Remove</button></div>`}
                          </section>`
                      )}
                    </div>`
                  : html`<${Empty} title="The box is empty" action=${html`<button className="btn" onClick=${() => setAdding(true)}>Add the first file</button>`}>Drop anything the team should be able to find again: rate cards, templates, signed agreements, screenshots, exports. Add a note and tags so it turns up in a search.<//>`
            }
          </div>`
      }
      ${
        tab === 'all' &&
        html`<div className="stack">
            <div className="toolbar">
              <input type="search" style=${{ maxWidth: 300 }} placeholder="Search file names and where they belong" value=${q} onInput=${e => setQ(e.target.value)} onKeyDown=${e => e.key === 'Enter' && load({ page: 1 })} aria-label="Search files" />
              <select value=${kind} onChange=${e => {
                setKind(e.target.value);
                setPage(1);
              }} aria-label="Kind">
                <option value="">All kinds</option>
                ${d && Object.entries(d.kinds).map(([k, n]) => html`<option key=${k} value=${k}>${n}${d.byKind[k] ? ' (' + d.byKind[k] + ')' : ''}</option>`)}
              </select>
              <button className="btn ghost" onClick=${() => load({ page: 1 })}>Search</button>
              <div className="push">
                ${d && d.orphans > 0 && d.canDelete && html`<button className="btn ghost" onClick=${cleanup}>Clean up ${d.orphans} unused file${d.orphans === 1 ? '' : 's'} (${fmtBytes(d.orphanBytes)})</button>`}
              </div>
            </div>
            ${err && html`<${LoadError} error=${err} onRetry=${() => load()} />`}
            ${
              d &&
              html`<section className="panel" style=${{ padding: '6px 8px' }}>
                  ${
                    d.files.length
                      ? html`<div className="tblwrap">
                          <table className="tbl">
                            <thead><tr><th>File</th><th>Belongs to</th><th>Kind</th><th className="r">Size</th><th>Stored</th><th /></tr></thead>
                            <tbody>
                              ${d.files.map(
                                f => html`<tr key=${f.base + f.id}>
                                    <td><a href=${fileUrl(f.base, f.id)} target="_blank" rel="noopener"><b style=${{ fontWeight: 600 }}>${f.n}</b></a><div className="muted small">${f.ty}</div></td>
                                    <td className="small">${f.where}</td>
                                    <td className="small">${d.kinds[f.kind] || f.kind}</td>
                                    <td className="r num small">${fmtBytes(f.sz)}</td>
                                    <td className="small nowrap">${fmtTs(f.at)}</td>
                                    <td className="r"><div className="actions" style=${{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}><a className="btn ghost sm" href=${fileUrl(f.base, f.id, true)}><${Icon} n="down" />Download</a>${d.canDelete && html`<button className="btn ghost sm" onClick=${() => del(f)}><${Icon} n="trash" /></button>`}</div></td>
                                  </tr>`
                              )}
                            </tbody>
                          </table>
                        </div>`
                      : html`<${Empty} title="Nothing stored yet">Files uploaded anywhere on the site show up here.<//>`
                  }
                </section>
                ${
                  pages > 1 &&
                  html`<div className="actions">
                      <button className="btn ghost sm" disabled=${page <= 1} onClick=${() => setPage(page - 1)}>Previous</button>
                      <span className="muted small">Page ${page} of ${pages} · ${d.total} files</span>
                      <button className="btn ghost sm" disabled=${page >= pages} onClick=${() => setPage(page + 1)}>Next</button>
                    </div>`
                }`
            }
          </div>`
      }
      ${adding && html`<${BoxAdd} onClose=${() => setAdding(false)} onDone=${() => {
        setAdding(false);
        loadBox();
        load();
      }} />`}
    </div>`;
}
function BoxAdd({ onClose, onDone }) {
  const P = usePortal();
  const toast = useToast();
  const [t, setT] = useState('');
  const [tags, setTags] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState('');
  const save = async () => {
    if (!t.trim() && !files.length) {
      toast('Add a note or choose a file.', true);
      return;
    }
    setBusy(true);
    try {
      const id = nid();
      const me = (P.prof && P.prof.n) || (Cap.me && Cap.me.name) || '';
      await dbSet(`org/box/items/${id}`, {
        t: t.trim(),
        tags: [...new Set(tags.split(',').map(x => x.trim()).filter(Boolean))],
        by: P.uid,
        byn: me,
        at: Date.now(),
        u: Date.now(),
      });
      for (let i = 0; i < files.length; i++) {
        setProg(`Uploading ${i + 1} of ${files.length}: ${files[i].name}`);
        await storeFile(`org/box/items/${id}`, files[i], { c: 'box' });
      }
      toast('Added to the box.');
      onDone();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
    setProg('');
  };
  return html`<${Modal} title="Add to the shared box" onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Cancel</button><button className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Add'}</button>`}>
      <div className="form">
        <${Field} label="Note" hint="What this is and who it is for."><input value=${t} onInput=${e => setT(e.target.value)} placeholder="e.g. Randstad rate card 2026, signed MSA with TCS, onboarding checklist template" autoFocus /><//>
        <${Field} label="Tags" hint="Comma separated, e.g. rate-card, msa, template"><input value=${tags} onInput=${e => setTags(e.target.value)} /><//>
        <${Field} label="Files" hint="PDF, images, Excel, Word, CSV or text, up to 10 MB each."><input type="file" multiple accept=${ACCEPT} onChange=${e => setFiles([...e.target.files])} />${files.length > 0 && html`<div className="muted small" style=${{ marginTop: 6 }}>${files.length} file${files.length === 1 ? '' : 's'} chosen</div>`}<//>
        ${prog && html`<p className="muted small">${prog}</p>`}
      </div>
    <//>`;
}
