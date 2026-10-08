/* ================= v37.4 Your own portal (#/get-portal) =================
   A company asks for its own portal on StratEdge Workspaces: the form, then the link in an email to confirm the
   address (#/get-portal?v=...), then StratEdge's team approves it (or, when switched on, it is made at once).
   Routes ws_signup_info, ws_signup, ws_signup_verify (api/wsjoin.php). The page answers the same whatever the address:
   whether it already has an account, a request or a portal is only ever told to that inbox. The page is not in the
   website's menu (selling the portal is still to be decided); the console shares its link. */

// a short name from a company's name ("Acme Staffing & Co." -> acme-staffing-and-co); the console uses it too
const wsSlugOf = n =>
  String(n || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/, '');

function GetPortalPage({ q }) {
  return q && q.v ? html`<${GetPortalConfirm} v=${q.v} />` : html`<${GetPortalForm} />`;
}

function GetPortalForm() {
  const [d, setD] = useState(null);
  const [loadErr, setLoadErr] = useState('');
  const [f, setF] = useState({ co: '', web: '', size: '', country: 'US', n: '', role: '', e: '', ph: '', feats: [], slug: '', msg: '', consent: false });
  const [slugTouched, setSlugTouched] = useState(false);
  const [errs, setErrs] = useState({});
  const [err, setErr] = useState('');
  const [st, setSt] = useState('idle'); // idle | busy | sent
  useEffect(() => {
    api('ws_signup_info', {}).then(setD, x => setLoadErr(errText(x)));
  }, []);
  const set = (k, v) => {
    setF(x => ({ ...x, [k]: v, ...(k === 'co' && !slugTouched ? { slug: wsSlugOf(v) } : {}) }));
    if (errs[k]) setErrs(x => ({ ...x, [k]: '' }));
  };
  const up = k => e => set(k, e.target.value);
  const fe = k => (errs[k] ? html`<small className="err">${errs[k]}</small>` : null);
  const inv = k => (errs[k] ? 'true' : undefined);
  const check = () => {
    const e = {};
    if (f.co.trim().length < 2) e.co = "Give your company's name.";
    if (f.n.trim().length < 2) e.n = 'Add your full name.';
    if (!/^\S+@\S+\.\S+$/.test(f.e.trim())) e.e = 'Enter a valid email address.';
    if (!f.size) e.size = "Choose the company's size.";
    if (!f.country) e.country = 'Choose where the company is.';
    if (!f.feats.length) e.feats = 'Choose at least one part of the portal.';
    if (f.slug && (f.slug.length < 2 || !/^[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])?$/.test(f.slug))) e.slug = 'The address uses 2 to 30 lowercase letters, numbers and hyphens, or leave it empty.';
    if (!f.consent) e.consent = 'Tick the box to agree to the terms of use and the privacy notice.';
    return e;
  };
  const send = async ev => {
    ev.preventDefault();
    const e = check();
    setErrs(e);
    if (Object.keys(e).length) {
      setErr('Check the fields marked in red.');
      return;
    }
    setErr('');
    setSt('busy');
    try {
      await api('ws_signup', { ...f, co: f.co.trim(), n: f.n.trim(), e: f.e.trim(), web: f.web.trim(), consent: 1, website: botTrap.hp, t0: botTrap.t0 });
      setSt('sent');
    } catch (x) {
      setErrs((x && x.errs) || {});
      setErr(errText(x));
      setSt('idle');
    }
  };
  const head = html`<${PageHead} title="Your own portal" intro="Recruiting, HR, time, payroll and accounting for your company, at its own address, with its own data and your brand. Tell us about your company: we set it up, and you choose your password." />`;
  if (loadErr) return html`<${Fragment}>${head}<section className="sec"><div className="wrap"><p className="note amber"><span>${loadErr}</span></p></div></section><//>`;
  if (!d) return html`<${Fragment}>${head}<section className="sec"><div className="wrap"><${Spinner} label="Loading…" /></div></section><//>`;
  if (!d.open)
    return html`<${Fragment}>${head}<section className="sec"><div className="wrap"><div className="panel stack" style=${{ maxWidth: 680 }}>
        <h2 style=${{ margin: 0, fontSize: 22 }}>By invitation for now</h2>
        <p style=${{ margin: 0 }}>Company portals are set up by invitation right now. Write to us at <a href=${'mailto:' + d.email}>${d.email}</a> and tell us about your company and what you need.</p>
        <div className="actions"><a className="btn" href="#/contact">Contact us</a></div>
      </div></div></section><//>`;
  const names = (d.feats || []).map(x => x.n);
  return html`<${Fragment}>
      ${head}
      <section className="sec"><div className="wrap">
        <div className="g2 wsjgrid" style=${{ gap: 40, alignItems: 'start' }}>
          <div className="prose">
            <h2>What you get</h2>
            <ul>
              <li>Its own address: <span className="wsjurl">${d.base}<i>your-company</i>/</span> (your own domain can come later).</li>
              <li>Its own database, files and encryption key: nobody outside your company sees your data.</li>
              <li>Your name, color and logo on its website, its portal and its emails.</li>
              <li>The parts you need: ${names.join(', ')}.</li>
              <li>A free pilot of ${d.pilotDays} day${d.pilotDays === 1 ? '' : 's'}.</li>
            </ul>
            <h2>How it works</h2>
            <ol className="wsjsteps">
              <li>Send this form.</li>
              <li>Confirm your email address with the link we send you (it works for 48 hours).</li>
              <li>${d.mode === 'auto' ? 'Your portal is made as soon as you confirm.' : 'Our team looks at your request and replies within one working day.'}</li>
              <li>Choose your password with the setup link, then add your team.</li>
            </ol>
          </div>
          <div className="panel">
            ${
              st === 'sent'
                ? html`<div className="stack" role="status">
                    <p className="note ok" style=${{ margin: 0 }}><span><b>Check your inbox.</b> We emailed the next step to <b>${f.e.trim()}</b>: usually a link to confirm the address, which works for 48 hours. Nothing is set up until you confirm.</span></p>
                    <p className="muted small" style=${{ margin: 0 }}>Nothing there in a few minutes? Look in the spam folder, or send the form again.</p>
                    <div className="actions"><button type="button" className="btn ghost" onClick=${() => setSt('idle')}>Back to the form</button></div>
                  </div>`
                : html`<form className="form" onSubmit=${send} noValidate>
                    <${BotTrap} />
                    <div className="row2">
                      <${Field} label="Company name"><input value=${f.co} onInput=${up('co')} autoComplete="organization" maxLength="80" aria-invalid=${inv('co')} />${fe('co')}<//>
                      <${Field} label="Company website (optional)"><input value=${f.web} onInput=${up('web')} placeholder="acme.com" autoComplete="url" inputMode="url" aria-invalid=${inv('web')} />${fe('web')}<//>
                    </div>
                    <div className="row2">
                      <${Field} label="Company size">
                        <select value=${f.size} onChange=${up('size')} aria-invalid=${inv('size')}>
                          <option value="">Choose…</option>
                          ${Object.entries(d.sizes || {}).map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}
                        </select>${fe('size')}
                      <//>
                      <${Field} label="Where the company is">
                        <select value=${f.country} onChange=${up('country')} aria-invalid=${inv('country')}>
                          ${Object.entries(d.countries || {}).map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}
                        </select>${fe('country')}
                      <//>
                    </div>
                    <div className="row2">
                      <${Field} label="Your name"><input value=${f.n} onInput=${up('n')} autoComplete="name" maxLength="120" aria-invalid=${inv('n')} />${fe('n')}<//>
                      <${Field} label="Your role (optional)"><input value=${f.role} onInput=${up('role')} autoComplete="organization-title" maxLength="80" placeholder="Founder, HR manager…" /><//>
                    </div>
                    <div className="row2">
                      <${Field} label=${d.workOnly ? 'Work email' : 'Email'} hint=${d.workOnly && !errs.e ? 'Your company address, not a personal one such as Gmail.' : ''}><input type="email" value=${f.e} onInput=${up('e')} autoComplete="email" maxLength="190" aria-invalid=${inv('e')} />${fe('e')}<//>
                      <${Field} label="Phone (optional)"><input type="tel" value=${f.ph} onInput=${up('ph')} autoComplete="tel" maxLength="30" aria-invalid=${inv('ph')} />${fe('ph')}<//>
                    </div>
                    <div className="fld">
                      <span>What do you want to use?</span>
                      <div className="wsfeats wsjfeats">
                        ${(d.feats || []).map(
                          x => html`<label key=${x.k} className="check">
                              <input type="checkbox" checked=${f.feats.includes(x.k)} onChange=${e => set('feats', e.target.checked ? [...f.feats, x.k] : f.feats.filter(y => y !== x.k))} />
                              <span><b>${x.n}</b><span className="muted small" style=${{ display: 'block' }}>${x.d}</span></span>
                            </label>`
                        )}
                      </div>
                      ${fe('feats')}
                    </div>
                    <${Field} label="The address you would like (optional)" hint=${errs.slug ? '' : 'If it is taken, we choose one close to it.'}>
                      <div className="wsjslug"><span className="muted small">${d.base}</span><input value=${f.slug} onInput=${e => {
                        setSlugTouched(true);
                        set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30));
                      }} placeholder="acme" aria-label="Short name for the address" aria-invalid=${inv('slug')} /><span className="muted small">/</span></div>
                      ${fe('slug')}
                    <//>
                    <${Field} label="Anything we should know (optional)"><textarea rows="3" value=${f.msg} onInput=${up('msg')} maxLength="2000" placeholder="How many people would use it, the tools you use today, when you would like to start…" /><//>
                    <label className="check small">
                      <input type="checkbox" checked=${f.consent} onChange=${e => set('consent', e.target.checked)} aria-invalid=${inv('consent')} />
                      <span>I agree to the <a href="#/terms" target="_blank" rel="noopener">terms of use</a> and the <a href="#/privacy" target="_blank" rel="noopener">privacy notice</a>, and that StratEdge may contact me about this request.</span>
                    </label>
                    ${fe('consent')}
                    ${err && html`<p className="err" role="alert">${err}</p>`}
                    <button className="btn lg" disabled=${st === 'busy'}>${st === 'busy' ? 'Sending…' : 'Send the request'}</button>
                    <p className="muted small" style=${{ margin: 0 }}>We email you a link to confirm your address. Nothing is set up before you confirm it.</p>
                  </form>`
            }
          </div>
        </div>
      </div></section>
    <//>`;
}

function GetPortalConfirm({ v }) {
  const [st, setSt] = useState('idle'); // idle | busy | done | err
  const [r, setR] = useState(null);
  const [err, setErr] = useState('');
  const go = async () => {
    setSt('busy');
    setErr('');
    try {
      setR(await api('ws_signup_verify', { t: v }));
      setSt('done');
    } catch (x) {
      setErr(errText(x));
      setSt('err');
    }
  };
  let body;
  if (st === 'done' && r && r.st === 'approved')
    body = html`<div className="stack" role="status">
        <p className="note ok" style=${{ margin: 0 }}><span><b>${r.again ? 'Your portal for ' + r.co + ' is ready already.' : 'Your portal for ' + r.co + ' is ready.'}</b> ${r.setup ? 'Choose your password to open it. We emailed you the same link; it works once, for 14 days.' : 'Use the setup link we emailed you, or sign in if you have chosen your password already.'}</span></p>
        ${r.setup && html`<a className="btn lg" href=${r.setup}>Choose your password</a>`}
        ${r.url && html`<p className="muted small" style=${{ margin: 0 }}>Its address: <a href=${r.url}>${r.url}</a></p>`}
      </div>`;
  else if (st === 'done' && r)
    body = html`<div className="stack" role="status">
        <p className="note ok" style=${{ margin: 0 }}><span><b>${r.again ? 'Your email was confirmed already.' : 'Thank you, your email is confirmed.'}</b> ${r.st === 'declined' ? 'Our team has answered your request for ' + r.co + ' by email.' : 'Your request for ' + r.co + ' is with our team. We look at each request and reply by email, usually within one working day.'}</span></p>
        <a className="btn ghost" href="#/">Back to the website</a>
      </div>`;
  else if (st === 'err')
    body = html`<div className="stack">
        <p className="err" role="alert" style=${{ margin: 0 }}>${err}</p>
        <a className="btn ghost" href="#/get-portal">Send the form again</a>
      </div>`;
  else
    body = html`<div className="stack">
        <p style=${{ margin: 0 }}>One click confirms that this email address is yours and sends your request on.</p>
        <button className="btn lg" style=${{ width: '100%' }} disabled=${st === 'busy'} onClick=${go}>${st === 'busy' ? 'Confirming…' : 'Confirm my email'}</button>
        <p className="muted small" style=${{ margin: 0 }}>Did not ask for a portal? Close this page; nothing happens without the confirmation.</p>
      </div>`;
  return html`<div className="login"><div className="blade"><h1>Your own portal</h1><ul><li>Its own address, data and brand.</li><li>The parts of the portal you need.</li><li>Your team signs in with their own accounts.</li></ul></div>
      <div className="login-card">
        <h2>Confirm your email</h2>
        ${body}
      </div></div>`;
}
