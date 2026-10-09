/* ================= v50 Specialist service pages and case evidence on the website (CC-07) =================
   #/hire lists the specialist pages StratEdge published (a planned service is never listed); #/hire/<page> explains
   the buyer's problem, the scope, the screening, the steps, the roles, and ends in a request that names the page;
   #/cases/<case> is a published case: reviewed against its records, with each number's method, the client named only
   with permission, an example always labeled as one. Server: api/corpweb.php (pub_cw routes, no sign-in). The views
   (CwHireView, CwCaseView) also draw the staff preview in js/work.js. */
function useCwPublic(route, slug) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let live = true;
    setD(null);
    setErr(null);
    api(route, slug ? { slug } : {}).then(
      x => live && setD(x),
      e => live && setErr(e)
    );
    return () => {
      live = false;
    };
  }, [route, slug]);
  return [d, err];
}
const cwPeriod = (from, to) => {
  const f = k => (k ? new Date(k + '-01T12:00:00').toLocaleDateString([], { month: 'short', year: 'numeric' }) : '');
  return from ? f(from) + (to && to !== from ? ' – ' + f(to) : to ? '' : ' – now') : '';
};
const cwReqHref = p => '#/request-talent?pg=' + encodeURIComponent(p.slug) + '&pgn=' + encodeURIComponent(p.ti);
function CwCaseCard({ c, preview }) {
  return html`<a className="card cwcase" href=${preview ? null : '#/cases/' + c.slug}>
      ${c.ex ? html`<span className="cwex">Example</span>` : c.logo && html`<img className="cwlogo" src=${c.logo} alt=${c.client} loading="lazy" />`}
      <h3>${c.ti}</h3>
      <p className="muted small">${c.ex ? 'How an engagement like this works' : [c.client, cwPeriod(c.from, c.to)].filter(Boolean).join(' · ')}</p>
      ${c.sum && html`<p>${c.sum}</p>`}
    </a>`;
}
function CwPageCards({ pages, avail }) {
  return html`<div className="svc-list">${pages.map(
    p => html`<a key=${p.slug} className="svc" href=${'#/hire/' + p.slug}><h3>${p.ti}</h3><p>${p.sum}</p>${p.avail === 'limited' && html`<span className="cwlim">${avail.limited}</span>`}</a>`
  )}</div>`;
}
/* The specialist pages as a band (on the Services page) */
function CwHireBand({ title }) {
  const [d] = useCwPublic('pub_cw');
  if (!d || !d.pages.length) return null;
  return html`<section className="sec alt cwband">
      <div className="wrap">
        <h2 style=${{ fontSize: 28, marginBottom: 8 }}>${title || 'Specialist talent'}</h2>
        <p className="muted" style=${{ marginBottom: 20, maxWidth: '62ch' }}>Pages for the skill areas we recruit for: what we screen for, how an engagement runs, and the roles we fill.</p>
        <${CwPageCards} pages=${d.pages} avail=${d.avail} />
        ${d.cases.length > 0 && html`<p style=${{ marginTop: 20 }}><a href="#/hire">See the case evidence</a></p>`}
      </div>
    </section>`;
}
function CwHireList() {
  const [d, err] = useCwPublic('pub_cw');
  return html`<${Fragment}>
      <${PageHead} title="Specialist talent" intro="The skill areas we recruit for, how we screen candidates in each, and how an engagement runs." />
      <section className="sec">
        <div className="wrap">
          ${err ? html`<p className="muted">The pages could not be loaded. <a href="#/request-talent">Request talent</a> directly.</p>` : !d ? html`<${Spinner} />` : d.pages.length ? html`<${CwPageCards} pages=${d.pages} avail=${d.avail} />` : html`<p className="muted">Our specialist pages are on their way. Meanwhile, <a href="#/request-talent">tell us who you need</a>.</p>`}
          ${d && d.cases.length > 0 && html`<h2 style=${{ fontSize: 28, margin: '48px 0 16px' }}>Case evidence</h2><div className="cwcases">${d.cases.map(c => html`<${CwCaseCard} key=${c.slug} c=${c} />`)}</div>`}
        </div>
      </section>
    <//>`;
}
/* A service page's body (the website, and the staff preview of a draft) */
function CwHireView({ p, cases, avail, preview }) {
  const req = preview ? null : cwReqHref(p);
  return html`<section className="sec">
      <div className="wrap">
        ${p.avail === 'limited' && html`<div className="note amber" style=${{ marginBottom: 24 }}><span><b>${avail.limited}.</b> ${p.limitNote || 'Ask us about current capacity before planning around this service.'}</span></div>`}
        ${p.avail === 'planned' && preview && html`<div className="note amber" style=${{ marginBottom: 24 }}><span><b>Planned.</b> A planned service is not listed on the website, even when published.</span></div>`}
        <div className="g2" style=${{ gap: 48, alignItems: 'start' }}>
          <div>
            <h2 style=${{ fontSize: 28, marginBottom: 12 }}>The problem we solve</h2>
            <p className="crpre" style=${{ fontSize: 17 }}>${p.problem}</p>
            ${p.scope.length > 0 && html`<h2 style=${{ fontSize: 24, margin: '32px 0 12px' }}>What we cover</h2><ul className="incl">${p.scope.map(x => html`<li key=${x}>${x}</li>`)}</ul>`}
          </div>
          <div>
            ${p.screen && html`<h2 style=${{ fontSize: 24, marginBottom: 12 }}>How we screen</h2><p className="crpre muted" style=${{ fontSize: 16 }}>${p.screen}</p>`}
            ${p.roles.length > 0 && html`<h3 style=${{ fontSize: 18, margin: '28px 0 10px' }}>Roles we fill</h3><div className="models">${p.roles.map(r => html`<span key=${r}>${r}</span>`)}</div>`}
            ${p.tech.length > 0 && html`<h3 style=${{ fontSize: 18, margin: '28px 0 10px' }}>Technologies</h3><div className="models">${p.tech.map(t => html`<span key=${t}>${t}</span>`)}</div>`}
          </div>
        </div>
        ${
          p.steps.length > 0 &&
          html`<h2 style=${{ fontSize: 28, margin: '48px 0 16px' }}>How an engagement runs</h2><ol className="cwsteps">${p.steps.map((s, i) => html`<li key=${i}><span className="cwn">${i + 1}</span><span>${s}</span></li>`)}</ol>
            ${p.video && html`<p style=${{ marginTop: 20 }}><a className="btn ghost" href=${preview ? null : p.video} target="_blank" rel="noopener noreferrer"><${Icon} n="link" />Watch our services video</a></p>`}`
        }
        ${cases.length > 0 && html`<h2 style=${{ fontSize: 28, margin: '48px 0 16px' }}>Case evidence</h2><div className="cwcases">${cases.map(c => html`<${CwCaseCard} key=${c.slug} c=${c} preview=${preview} />`)}</div>`}
        ${p.faq.length > 0 && html`<div style=${{ marginTop: 48 }}><h2 style=${{ fontSize: 28, marginBottom: 16 }}>Common questions</h2><div className="faqs">${p.faq.map(f => html`<details key=${f.q} className="faq"><summary>${f.q}</summary><p>${f.a}</p></details>`)}</div></div>`}
        <div className="actions" style=${{ marginTop: 40 }}>
          <a className="btn lg cwcta" href=${req}>${p.cta || 'Request talent'}</a>
          <a className="btn ghost lg" href=${preview ? null : '#/contact'}>Ask a question</a>
        </div>
      </div>
    </section>`;
}
function CwHirePage({ slug }) {
  const [d, err] = useCwPublic('pub_cw_page', slug);
  useEffect(() => {
    if (d && d.page) document.title = d.page.ti + ' | StratEdge IT Consulting';
  }, [d]);
  if (err) return html`<${NotFound} />`;
  if (!d) return html`<div className="sec"><div className="wrap"><${Spinner} /></div></div>`;
  return html`<${Fragment}>
      <${PageHead} crumb=${html`<a href="#/hire">Specialist talent</a>`} title=${d.page.ti} intro=${d.page.sum} />
      <${CwHireView} p=${d.page} cases=${d.cases} avail=${d.avail} />
    <//>`;
}
/* A case's body (the website, and the staff preview) */
function CwCaseView({ c, pages, preview }) {
  return html`<section className="sec">
      <div className="wrap cwcasebody">
        ${
          c.ex
            ? html`<div className="note amber"><span><b>Example.</b> This shows how an engagement like this works. It is not a report of a specific client's results.</span></div>`
            : html`<div className="cwwho">${c.logo && html`<img className="cwlogo" src=${c.logo} alt=${c.client} />`}<p className="muted">${c.client}${cwPeriod(c.from, c.to) ? ' · ' + cwPeriod(c.from, c.to) : ''}</p></div>`
        }
        ${c.challenge && html`<h2>The challenge</h2><p className="crpre">${c.challenge}</p>`}
        ${c.did && html`<h2>What we did</h2><p className="crpre">${c.did}</p>`}
        ${c.outcome && html`<h2>The outcome</h2><p className="crpre">${c.outcome}</p>`}
        ${
          c.metrics.length > 0 &&
          html`<div className="cwmetrics">${c.metrics.map((m, i) => html`<div key=${i} className="card"><b>${m.value}</b><span>${m.label}</span><small className="muted">${m.how}${m.n ? ' · ' + m.n : ''}</small></div>`)}</div>`
        }
        ${c.quote && html`<blockquote className="cwquote"><p>${c.quote.text}</p>${c.quote.who && html`<footer>${c.quote.who}</footer>`}</blockquote>`}
        ${!c.ex && html`<p className="muted small">Checked against StratEdge's records for the period shown before it was published.${c.named ? ' Published with the client’s permission.' : ''}</p>`}
        <div className="actions" style=${{ marginTop: 32 }}>
          ${pages.map(p => html`<a key=${p.slug} className="btn ghost" href=${preview ? null : '#/hire/' + p.slug}>${p.ti}</a>`)}
          <a className="btn" href=${preview ? null : pages.length === 1 ? cwReqHref(pages[0]) : '#/request-talent'}>Request talent</a>
        </div>
      </div>
    </section>`;
}
function CwCasePage({ slug }) {
  const [d, err] = useCwPublic('pub_cw_case', slug);
  useEffect(() => {
    if (d && d.case) document.title = d.case.ti + ' | StratEdge IT Consulting';
  }, [d]);
  if (err) return html`<${NotFound} />`;
  if (!d) return html`<div className="sec"><div className="wrap"><${Spinner} /></div></div>`;
  return html`<${Fragment}>
      <${PageHead} crumb=${html`<a href="#/hire">Specialist talent</a>`} title=${d.case.ti} intro=${d.case.sum} />
      <${CwCaseView} c=${d.case} pages=${d.pages} />
    <//>`;
}
