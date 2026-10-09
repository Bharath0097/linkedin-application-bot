/* ================= v50 Service pages & cases (CC-07): the staff side (in js/work.js) =================
   Specialist service pages (drafts; an administrator publishes; availability shown honestly; a person who answers
   the page's requests) and case evidence (a factual review and, for a named client, a quote or a logo, the client's
   permission, recorded before an administrator publishes; examples always labeled), a preview of each as the website
   shows it, and the inquiries each page brought and how far they went. Server: api/corpweb.php. The website's own
   views (CwHireView, CwCaseView in js/app.js) draw the previews. */
const CW_STONE = { draft: '', reviewed: 'info', published: 'ok', withdrawn: '' };
const cwLinesOut = t => String(t || '').split('\n').map(x => x.trim()).filter(Boolean);
/* The website's shape of a page or a case, from the staff view's draft (for the preview) */
const cwPagePub = p => ({ slug: p.slug, ti: p.ti, avail: p.avail, sum: p.data.sum || '', cta: p.data.cta || 'Request talent', problem: p.data.problem || '', scope: p.data.scope || [], screen: p.data.screen || '', steps: p.data.steps || [], roles: p.data.roles || [], tech: p.data.tech || [], faq: p.data.faq || [], limitNote: p.data.limitNote || '', video: p.data.video || '' });
const cwCasePub = c => {
  const d = c.data;
  const named = !!(d.client && d.client.named);
  return { slug: c.slug, ti: c.ti, ex: !!c.ex, client: named ? d.client.name : (d.client && d.client.desc) || '', named, logo: named ? c.logoUrl || '' : '', from: d.from || '', to: d.to || '', pages: d.pages || [], sum: d.sum || '', challenge: d.challenge || '', did: d.did || '', outcome: d.outcome || '', metrics: d.metrics || [], quote: d.quote && d.quote.text ? d.quote : null };
};
function CwStaffPage({ q }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [tab, setTab] = useState((q && q.t) || 'pages');
  const [ep, setEp] = useState(null);
  const [ec, setEc] = useState(null);
  const [pv, setPv] = useState(null);
  const [act, setAct] = useState(null);
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  const load = () => api('cw_home', {}).then(setD, e => toast(errText(e), true));
  useEffect(() => {
    load();
  }, []);
  if (!d) return html`<${Spinner} label="Loading service pages…" />`;
  const run = async (route, body, msg) => {
    setBusy(true);
    try {
      await api(route, body);
      toast(msg);
      setAct(null);
      setF({});
      load();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const logo = async (c, file, off) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('data', JSON.stringify({ id: c.id, off: off ? 1 : 0 }));
      if (file) fd.append('file', file, file.name);
      await upload('cw_case_logo', fd);
      toast(off ? 'Logo removed.' : 'Logo stored. Record the client\'s permission for it before publishing.');
      load();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const pageTi = Object.fromEntries(d.pages.map(p => [p.slug, p.ti]));
  const teamName = Object.fromEntries(d.team.map(t => [t.id, t.n]));
  const permWords = covers => (covers || []).map(x => d.perm[x] || x).join(', ');
  return html`<div className="stack crpage cwpage">
      <${KitTabs} tabs=${[['pages', 'Service pages', d.pages.length || null], ['cases', 'Case evidence', d.cases.filter(c => c.st !== 'published' && c.st !== 'withdrawn').length || null], ['stats', 'Inquiries by page']]} tab=${tab} onTab=${setTab} />
      ${
        tab === 'pages' &&
        html`<div className="stack">
          <div className="toolbar"><span className="muted small">Pages for the skill areas StratEdge recruits for (on the website under Specialist talent and on the Services page). A planned service is never listed. ${d.admin ? 'Publishing is yours.' : 'An administrator publishes.'}</span><button className="btn push" onClick=${() => setEp({ ti: '', slug: '', avail: 'now', ord: 0, own: '', data: { sum: '', problem: '', scope: [], screen: '', steps: [], roles: [], tech: [], faq: [], cta: 'Request talent', limitNote: '', video: '' } })}><${Icon} n="plus" />New page</button></div>
          ${
            d.pages.length
              ? html`<div className="tblwrap"><table className="tbl crtbl"><thead><tr><th>Page</th><th>Availability</th><th>Answered by</th><th>Status</th><th>Published</th><th></th></tr></thead><tbody>${d.pages.map(
                  p => html`<tr key=${p.id}><td><b>${p.ti}</b><div className="muted small">#/hire/${p.slug}</div></td><td><${Chip} s=${p.avail === 'now' ? 'ok' : p.avail === 'limited' ? 'amber' : ''}>${d.avail[p.avail]}<//></td><td className="small">${teamName[p.own] || html`<span className="muted">—</span>`}</td><td><${Chip} s=${CW_STONE[p.st]}>${p.st === 'published' ? 'Published' : 'Draft'}<//>${p.unpub && html` <${Chip} s="amber">unpublished changes<//>`}</td><td className="small nw">${p.pubAt ? fmtTs(p.pubAt) + ' · ' + p.pubBy : '—'}</td><td className="r"><div className="actions" style=${{ justifyContent: 'flex-end' }}><button type="button" className="btn ghost sm" onClick=${() => setEp(p)}><${Icon} n="pen" />Edit</button><button type="button" className="btn ghost sm" onClick=${() => setPv({ kind: 'page', item: p })}><${Icon} n="eye" />Preview</button>${d.admin && html`<button type="button" className="btn sm" disabled=${busy || (p.st === 'published' && !p.unpub)} onClick=${() => run('cw_page_pub', { id: p.id }, 'Published.')}>${p.st === 'published' ? 'Publish the changes' : 'Publish'}</button>`}${d.admin && p.st === 'published' && html`<button type="button" className="btn ghost sm" disabled=${busy} onClick=${() => run('cw_page_pub', { id: p.id, off: 1 }, 'Unpublished.')}>Unpublish</button>`}${p.st === 'published' && p.avail !== 'planned' && html`<a className="btn ghost sm" href=${'#/hire/' + p.slug} target="_blank" rel="noopener">View</a>`}</div></td></tr>`
                )}</tbody></table></div>`
              : html`<${Empty} title="No service pages yet">Write one for each skill area you recruit for: the buyer's problem, what you cover, how you screen, the steps, the roles.<//>`
          }
        </div>`
      }
      ${
        tab === 'cases' &&
        html`<div className="stack">
          <div className="toolbar"><span className="muted small">A case is published only after its factual review is recorded; a named client, a quote or a logo needs the client's permission recorded too. An example is always labeled as one.</span><button className="btn push" onClick=${() => setEc({ ti: '', slug: '', ex: false, data: { client: { named: false, name: '', desc: '' }, from: '', to: '', pages: [], sum: '', challenge: '', did: '', outcome: '', metrics: [], quote: { text: '', who: '' }, sources: '' } })}><${Icon} n="plus" />New case</button></div>
          ${
            d.cases.length
              ? html`<div className="stack">${d.cases.map(
                  c => html`<div key=${c.id} className="cwrow">
                    <div className="cwrowhead"><div>${c.logoUrl && html`<img className="cwlogo sm" src=${c.logoUrl} alt="" />`}<b>${c.ti}</b>${c.ex && html` <${Chip} s="amber">Example<//>`} <${Chip} s=${CW_STONE[c.st]}>${d.cst[c.st]}<//>${c.unpub && html` <${Chip} s="amber">unpublished changes<//>`}<div className="muted small">${c.ex ? 'Example' : c.data.client.named ? c.data.client.name || 'name missing' : c.data.client.desc || 'client not described'} · ${(c.data.pages || []).map(s => pageTi[s] || s).join(', ') || 'no page'}</div></div>
                      <div className="actions"><button type="button" className="btn ghost sm" onClick=${() => setEc(c)}><${Icon} n="pen" />Edit</button><button type="button" className="btn ghost sm" onClick=${() => setPv({ kind: 'case', item: c })}><${Icon} n="eye" />Preview</button>${!c.ex && html`<button type="button" className="btn ghost sm" onClick=${() => (setAct({ id: c.id, a: 'review' }), setF({}))}>${c.rev ? 'Review again' : 'Record the review'}…</button><button type="button" className="btn ghost sm" onClick=${() => (setAct({ id: c.id, a: 'perm' }), setF({ covers: [] }))}>${c.perm ? 'Permission again' : 'Record permission'}…</button><label className="btn ghost sm" title="The client's logo (PNG, JPEG or WebP up to 1 MB)"><${Icon} n="camera" />${c.logoUrl ? 'Replace logo' : 'Logo'}<input type="file" accept="image/png,image/jpeg,image/webp" style=${{ display: 'none' }} disabled=${busy} onChange=${e => { const file = e.target.files && e.target.files[0]; e.target.value = ''; if (file) logo(c, file, false); }} /></label>${c.logoUrl && html`<button type="button" className="btn ghost sm" disabled=${busy} onClick=${() => logo(c, null, true)}>Remove logo</button>`}`}${d.admin && html`<button type="button" className="btn sm" disabled=${busy || !!c.gate || (c.st === 'published' && !c.unpub)} title=${c.gate || ''} onClick=${() => run('cw_case_pub', { id: c.id }, 'Published.')}>${c.st === 'published' ? 'Publish the changes' : 'Publish'}</button>`}${d.admin && c.st === 'published' && html`<button type="button" className="btn ghost sm" disabled=${busy} onClick=${() => run('cw_case_pub', { id: c.id, off: 1 }, 'Withdrawn.')}>Withdraw</button>`}</div></div>
                    ${c.gate && html`<div className="small cwgate">Before publishing: ${c.gate}</div>`}
                    ${c.rev && html`<div className="small muted">Reviewed by ${c.rev.by}, ${fmtTs(c.rev.at)}${c.rev.self ? ' (the person who wrote it)' : ''}: ${c.rev.note}</div>`}
                    ${c.perm && html`<div className="small muted">Permission for the ${permWords(c.perm.covers)} from ${c.perm.who} (recorded by ${c.perm.by}, ${fmtTs(c.perm.at)}): ${c.perm.ev}</div>`}
                    ${
                      act &&
                      act.id === c.id &&
                      html`<div className="crform2 form">${
                        act.a === 'review'
                          ? html`<b>Record the factual review</b><${Field} label="What you checked it against (the records, the period, how the numbers were counted)"><textarea rows="2" value=${f.msg || ''} onInput=${e => setF({ ...f, msg: e.target.value })} /><//><div className="actions"><button type="button" className="btn ghost sm" onClick=${() => setAct(null)}>Cancel</button><button type="button" className="btn sm" disabled=${busy} onClick=${() => run('cw_case_review', { id: c.id, msg: f.msg || '' }, 'Review recorded.')}>Record it</button></div>`
                          : html`<b>Record the client's permission</b><div className="crpick">${Object.entries(d.perm).map(([k, n]) => html`<label key=${k} className="check"><input type="checkbox" checked=${(f.covers || []).includes(k)} onChange=${e => setF({ ...f, covers: e.target.checked ? [...(f.covers || []), k] : (f.covers || []).filter(x => x !== k) })} /><span>${k === 'name' ? 'To name the company' : k === 'quote' ? 'To use the quote' : 'To show the logo'}</span></label>`)}</div><${Field} label="Who gave it"><input value=${f.who || ''} onInput=${e => setF({ ...f, who: e.target.value })} /><//><${Field} label="The evidence (an email, a signed release…)"><textarea rows="2" value=${f.msg || ''} onInput=${e => setF({ ...f, msg: e.target.value })} /><//><div className="actions"><button type="button" className="btn ghost sm" onClick=${() => setAct(null)}>Cancel</button><button type="button" className="btn sm" disabled=${busy} onClick=${() => run('cw_case_perm', { id: c.id, covers: f.covers || [], who: f.who || '', msg: f.msg || '' }, 'Permission recorded.')}>Record it</button></div>`
                      }</div>`
                    }
                  </div>`
                )}</div>`
              : html`<${Empty} title="No cases yet">Write one from a real engagement (reviewed against your records before it is published), or an example that shows how an engagement works.<//>`
          }
        </div>`
      }
      ${tab === 'stats' && html`<${CwStats} pageTi=${pageTi} />`}
      ${ep && html`<${CwPageEditor} p=${ep} d=${d} onClose=${() => setEp(null)} onSaved=${() => (setEp(null), load())} />`}
      ${ec && html`<${CwCaseEditor} c=${ec} d=${d} onClose=${() => setEc(null)} onSaved=${() => (setEc(null), load())} />`}
      ${pv && html`<${CwPreview} kind=${pv.kind} item=${pv.item} d=${d} onClose=${() => setPv(null)} />`}
    </div>`;
}
/* The inquiries each page brought (the website's talent requests that named a page; "No page" is the plain form) */
function CwStats({ pageTi }) {
  const toast = useToast();
  const [days, setDays] = useState(90);
  const [s, setS] = useState(null);
  useEffect(() => {
    setS(null);
    api('cw_stats', { days }).then(r => setS(r.stats), e => toast(errText(e), true));
  }, [days]);
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—');
  const rows = s ? Object.entries(s).sort((a, b) => b[1].n - a[1].n) : [];
  return html`<div className="stack">
      <div className="toolbar"><span className="muted small">Website requests sent from each page, by the stage of their CRM lead, and whether the company sent a confirmed talent request afterwards. Observed outcomes only.</span><div className="seg push">${[[30, '30 days'], [90, '90 days'], [365, 'A year'], [0, 'All']].map(([k, n]) => html`<button key=${k} type="button" className=${days === k ? 'on' : ''} onClick=${() => setDays(k)}>${n}</button>`)}</div></div>
      ${
        !s
          ? html`<${Spinner} />`
          : rows.length
            ? html`<div className="tblwrap"><table className="tbl crtbl"><thead><tr><th>Page</th><th className="r">Inquiries</th><th className="r">New</th><th className="r">In discussion</th><th className="r">Qualified</th><th className="r">Converted</th><th className="r">Not a fit</th><th className="r" title="Reached a discussion, qualified or converted">Reached discussion</th><th className="r" title="Qualified or converted">Qualified</th><th className="r" title="A talent request from the company approved after the inquiry">Confirmed requests</th><th>Why not a fit</th></tr></thead><tbody>${rows.map(
                ([slug, x]) => html`<tr key=${slug}><td><b>${slug === '-' ? 'No page (the plain form)' : pageTi[slug] || slug}</b></td><td className="r">${x.n}</td><td className="r">${x.new}</td><td className="r">${x.disc}</td><td className="r">${x.qualified}</td><td className="r">${x.converted}</td><td className="r">${x.unfit}</td><td className="r">${pct(x.reached, x.n)}</td><td className="r">${pct(x.qual, x.n)}</td><td className="r">${x.req}</td><td className="small">${Object.entries(x.why || {}).map(([w, n]) => w + ' (' + n + ')').join('; ') || '—'}</td></tr>`
              )}</tbody></table></div>`
            : html`<${Empty} title="No inquiries from the pages yet">Requests sent from a service page show here with how far each went.<//>`
      }
    </div>`;
}
/* The page or the case as the website shows it, from the draft */
function CwPreview({ kind, item, d, onClose }) {
  const pubCases = d.cases.filter(c => c.st === 'published');
  return html`<${Modal} wide title=${(kind === 'page' ? 'Preview: ' : 'Preview: ') + item.ti} onClose=${onClose} foot=${html`<span className="muted small crright">What visitors would see if this draft were published (links are off).</span><button className="btn ghost" onClick=${onClose}>Close</button>`}>
      <div className="cwpreview site-skin">
        ${
          kind === 'page'
            ? html`<${PageHead} crumb=${html`<span>Specialist talent</span>`} title=${item.ti} intro=${item.data.sum} /><${CwHireView} p=${cwPagePub(item)} cases=${pubCases.filter(c => (c.data.pages || []).includes(item.slug)).map(cwCasePub)} avail=${d.avail} preview />`
            : html`<${PageHead} crumb=${html`<span>Specialist talent</span>`} title=${item.ti} intro=${item.data.sum} /><${CwCaseView} c=${cwCasePub(item)} pages=${d.pages.filter(p => p.st === 'published' && (item.data.pages || []).includes(p.slug)).map(p => ({ slug: p.slug, ti: p.ti }))} preview />`
        }
      </div>
    <//>`;
}
function CwPageEditor({ p, d, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState(() => ({ ...p, scopeT: (p.data.scope || []).join('\n'), stepsT: (p.data.steps || []).join('\n'), rolesT: (p.data.roles || []).join('\n'), techT: (p.data.tech || []).join('\n'), faq: (p.data.faq || []).map(x => ({ ...x })) }));
  const [busy, setBusy] = useState(false);
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const upd = k => e => setF({ ...f, data: { ...f.data, [k]: e.target.value } });
  const save = async () => {
    setBusy(true);
    try {
      await api('cw_page_save', { id: p.id || '', ti: f.ti, slug: f.slug, avail: f.avail, ord: +f.ord || 0, own: f.own || '', data: { ...f.data, scope: cwLinesOut(f.scopeT), steps: cwLinesOut(f.stepsT), roles: cwLinesOut(f.rolesT), tech: cwLinesOut(f.techT), faq: f.faq } });
      toast(p.st === 'published' ? 'Saved. Publish the changes to show them on the website (the availability and who answers took effect at once).' : 'Saved.');
      onSaved();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<${Modal} wide title=${p.id ? 'Edit: ' + p.ti : 'New service page'} onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Cancel</button><button className="btn" disabled=${busy || !f.ti.trim()} onClick=${save}>Save</button>`}>
      <div className="stack form cwform">
        <div className="row3"><${Field} label="Title"><input value=${f.ti} onInput=${up('ti')} placeholder="e.g. SAP consultants" /><//><${Field} label="Address" hint=${'#/hire/' + (f.slug || '…')}><input value=${f.slug} onInput=${up('slug')} placeholder="made from the title" disabled=${p.st === 'published'} /><//><${Field} label="Availability"><select value=${f.avail} onChange=${up('avail')}>${Object.entries(d.avail).map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select><//></div>
        ${f.avail === 'limited' && html`<${Field} label="What is limited (shown on the page)"><input value=${f.data.limitNote} onInput=${upd('limitNote')} /><//>`}
        ${f.avail === 'planned' && html`<div className="note amber"><span>A planned service is not listed on the website, even when published.</span></div>`}
        <div className="row2"><${Field} label="Who answers its requests" hint="Website requests from this page go to this person (the CRM's round-robin otherwise); the receipt names them."><select value=${f.own || ''} onChange=${up('own')}><option value="">The CRM's round-robin</option>${d.team.map(t => html`<option key=${t.id} value=${t.id}>${t.n}</option>`)}</select><//><${Field} label="Services video (optional)" hint="An https link; shown under the steps and opened on its own site."><input value=${f.data.video || ''} onInput=${upd('video')} placeholder="https://" /><//></div>
        <${Field} label="Summary (one or two lines)"><input value=${f.data.sum} onInput=${upd('sum')} /><//>
        <${Field} label="The buyer's problem"><textarea rows="3" value=${f.data.problem} onInput=${upd('problem')} /><//>
        <div className="row2"><${Field} label="What we cover (one per line)"><textarea rows="5" value=${f.scopeT} onInput=${up('scopeT')} /><//><${Field} label="How we screen"><textarea rows="5" value=${f.data.screen} onInput=${upd('screen')} /><//></div>
        <${Field} label="The steps of an engagement (one per line)"><textarea rows="4" value=${f.stepsT} onInput=${up('stepsT')} /><//>
        <div className="row2"><${Field} label="Roles we fill (one per line)"><textarea rows="4" value=${f.rolesT} onInput=${up('rolesT')} /><//><${Field} label="Technologies (one per line)"><textarea rows="4" value=${f.techT} onInput=${up('techT')} /><//></div>
        <span className="lbl">Common questions</span>
        ${f.faq.map((x, i) => html`<div key=${i} className="row2"><input value=${x.q} aria-label=${'Question ' + (i + 1)} placeholder="Question" onInput=${e => setF({ ...f, faq: f.faq.map((y, j) => (j === i ? { ...y, q: e.target.value } : y)) })} /><input value=${x.a} aria-label=${'Answer ' + (i + 1)} placeholder="Answer" onInput=${e => setF({ ...f, faq: f.faq.map((y, j) => (j === i ? { ...y, a: e.target.value } : y)) })} /></div>`)}
        <div><button type="button" className="btn ghost sm" onClick=${() => setF({ ...f, faq: [...f.faq, { q: '', a: '' }] })}><${Icon} n="plus" />Add a question</button></div>
        <div className="row2"><${Field} label="The request button"><input value=${f.data.cta} onInput=${upd('cta')} /><//><${Field} label="Order on the website"><input type="number" value=${f.ord} onInput=${up('ord')} /><//></div>
      </div>
    <//>`;
}
function CwCaseEditor({ c, d, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState(() => ({ ti: c.ti, slug: c.slug, ex: !!c.ex, data: JSON.parse(JSON.stringify(c.data)) }));
  const [busy, setBusy] = useState(false);
  const ud = (k, v) => setF({ ...f, data: { ...f.data, [k]: v } });
  const save = async () => {
    setBusy(true);
    try {
      const r = await api('cw_case_save', { id: c.id || '', ti: f.ti, slug: f.slug, ex: f.ex ? 1 : 0, data: f.data });
      toast(r.reviewReset ? 'Saved. The facts changed, so the review must be recorded again before publishing.' : r.permReset ? 'Saved. The name or the quote changed, so the client\'s permission must be recorded again.' : 'Saved.', !!(r.reviewReset || r.permReset));
      onSaved();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const m = f.data.metrics;
  return html`<${Modal} wide title=${c.id ? 'Edit: ' + c.ti : 'New case'} onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Cancel</button><button className="btn" disabled=${busy || !f.ti.trim()} onClick=${save}>Save</button>`}>
      <div className="stack form cwform">
        <div className="row2"><${Field} label="Title"><input value=${f.ti} onInput=${e => setF({ ...f, ti: e.target.value })} /><//><${Field} label="Address" hint=${'#/cases/' + (f.slug || '…')}><input value=${f.slug} onInput=${e => setF({ ...f, slug: e.target.value })} placeholder="made from the title" disabled=${c.st === 'published'} /><//></div>
        ${!c.id && html`<label className="check"><input type="checkbox" checked=${f.ex} onChange=${e => setF({ ...f, ex: e.target.checked })} /><span>A conceptual example (labeled "Example" on the website; no client, period, quote, logo or numbers)</span></label>`}
        ${
          !f.ex &&
          html`<div className="row3"><label className="check"><input type="checkbox" checked=${f.data.client.named} onChange=${e => ud('client', { ...f.data.client, named: e.target.checked })} /><span>Name the client (needs their permission)</span></label>${f.data.client.named && html`<${Field} label="Client name"><input value=${f.data.client.name} onInput=${e => ud('client', { ...f.data.client, name: e.target.value })} /><//>`}<${Field} label="The client without its name"><input value=${f.data.client.desc} onInput=${e => ud('client', { ...f.data.client, desc: e.target.value })} placeholder="e.g. a pharmaceutical manufacturer in New Jersey" /><//></div>
            <div className="row2"><${Field} label="From (month)"><input type="month" value=${f.data.from} onInput=${e => ud('from', e.target.value)} /><//><${Field} label="To (month)"><input type="month" value=${f.data.to} onInput=${e => ud('to', e.target.value)} /><//></div>
            ${c.id && html`<p className="muted small" style=${{ margin: 0 }}>The client's logo is added from the list (Logo) and shown only when the client is named, with their permission for it.</p>`}`
        }
        <span className="lbl">Service pages it belongs to</span>
        <div className="crpick">${d.pages.map(pg => html`<label key=${pg.slug} className="check"><input type="checkbox" checked=${f.data.pages.includes(pg.slug)} onChange=${e => ud('pages', e.target.checked ? [...f.data.pages, pg.slug] : f.data.pages.filter(x => x !== pg.slug))} /><span>${pg.ti}</span></label>`)}${!d.pages.length && html`<span className="muted small">No service pages yet.</span>`}</div>
        <${Field} label="Summary"><input value=${f.data.sum} onInput=${e => ud('sum', e.target.value)} /><//>
        <${Field} label="The challenge"><textarea rows="3" value=${f.data.challenge} onInput=${e => ud('challenge', e.target.value)} /><//>
        <${Field} label="What we did"><textarea rows="3" value=${f.data.did} onInput=${e => ud('did', e.target.value)} /><//>
        <${Field} label="The outcome"><textarea rows="3" value=${f.data.outcome} onInput=${e => ud('outcome', e.target.value)} /><//>
        ${
          !f.ex &&
          html`<span className="lbl">Numbers (each with how it was measured)</span>
            ${m.map((x, i) => html`<div key=${i} className="cwmrow"><input value=${x.label} aria-label=${'Number ' + (i + 1) + ' label'} placeholder="What (e.g. days to the first shortlist)" onInput=${e => ud('metrics', m.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))} /><input value=${x.value} aria-label=${'Number ' + (i + 1) + ' value'} placeholder="Value" onInput=${e => ud('metrics', m.map((y, j) => (j === i ? { ...y, value: e.target.value } : y)))} /><input value=${x.how} aria-label=${'Number ' + (i + 1) + ' method'} placeholder="How it was measured" onInput=${e => ud('metrics', m.map((y, j) => (j === i ? { ...y, how: e.target.value } : y)))} /><input value=${x.n} aria-label=${'Number ' + (i + 1) + ' count'} placeholder="Count (e.g. 4 roles)" onInput=${e => ud('metrics', m.map((y, j) => (j === i ? { ...y, n: e.target.value } : y)))} /><button type="button" className="btn ghost sm" aria-label=${'Remove number ' + (i + 1)} onClick=${() => ud('metrics', m.filter((y, j) => j !== i))}><${Icon} n="trash" /></button></div>`)}
            <div><button type="button" className="btn ghost sm" onClick=${() => ud('metrics', [...m, { label: '', value: '', how: '', n: '' }])}><${Icon} n="plus" />Add a number</button></div>
            <div className="row2"><${Field} label="A quote (needs permission)"><textarea rows="2" value=${f.data.quote.text} onInput=${e => ud('quote', { ...f.data.quote, text: e.target.value })} /><//><${Field} label="Who said it"><input value=${f.data.quote.who} onInput=${e => ud('quote', { ...f.data.quote, who: e.target.value })} /><//></div>
            <${Field} label="Source records (for the review; never shown)"><textarea rows="2" value=${f.data.sources} onInput=${e => ud('sources', e.target.value)} placeholder="e.g. placements P-118 to P-121, submissions log, March to May 2026" /><//>`
        }
      </div>
    <//>`;
}
