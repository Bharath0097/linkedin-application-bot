/* ================= v37 StratEdge Workspaces: a company's own portal website =================
   On a company workspace's address (/w/<name>/, <name>.stratedgeitconsulting.com or the company's own domain) the
   website is the company's: its name, logo and color, a home page with the way in, the pages people reach from
   emails and links (password reset, signing, invoices, ID and confirmation links), open roles when it recruits, and
   the first administrator's setup page. StratEdge's own marketing pages, ads and website assistant are not shown. */

// What each part of the portal gives the people who sign in (the home page lists the parts the workspace has)
const WS_PARTS = [
  ['recruiting', 'Jobs and applications', 'Open roles, applications, interviews and the status of your submissions.', 'brief'],
  ['time', 'Time and timesheets', 'Clock in, submit timesheets and ask for time off.', 'clock'],
  ['payroll', 'Pay and tax forms', 'Paystubs, direct deposit and your tax forms.', 'money'],
  ['hr', 'Onboarding and documents', 'Forms to fill in, policies to read and documents to sign.', 'folder'],
  ['learning', 'Learning', 'Courses, tests and certifications.', 'compass'],
  ['chat', 'Team messages', 'Channels and direct messages with your team.', 'chat'],
  ['desk', 'Help and support', 'Ask for help and follow your requests.', 'help'],
];

function WsHeader({ path, ws }) {
  const on = p => (path === p || path.startsWith(p + '/') ? 'on' : '');
  return html`<header className="nav wsnav">
      <div className="wrap">
        <a className="brand" href="#/" aria-label=${(ws.name || 'Portal') + ' home'}><${WsLogo} ws=${ws} /></a>
        <nav className="links" aria-label="Main">
          <a className=${path === '/' ? 'on' : ''} href="#/">Home</a>
          ${wsFeat('recruiting') && html`<a className=${on('/careers')} href="#/careers">Open roles</a>`}
          ${wsFeat('desk') && html`<a className=${on('/support')} href="#/support">Help</a>`}
        </nav>
        <div className="nav-cta">
          ${Cap.state === 'ready' ? html`<a className="btn" href="#/portal">Open your portal</a>` : html`<a className="btn" href=${LOGIN}>Log in</a>`}
        </div>
      </div>
    </header>`;
}

function WsFooter({ ws }) {
  const b = ws.brand || {};
  return html`<footer className="foot wsfoot">
      <div className="wrap">
        <div>
          <${WsLogo} ws=${ws} white />
          <p>${b.tagline || 'The ' + ws.name + ' portal.'}</p>
        </div>
        <div>
          <h4>Contact</h4>
          <ul>
            ${ws.contact && html`<li><a href=${'mailto:' + ws.contact}>${ws.contact}</a></li>`}
            ${b.addr && html`<li>${b.addr}</li>`}
            <li><a href=${LOGIN}>Log in to the portal</a></li>
            ${wsFeat('desk') && html`<li><a href="#/support">Help & support</a></li>`}
            <li><${InstallAppButton} className="btn sm ghost" label="Install the app" /></li>
          </ul>
        </div>
      </div>
      <div className="legal">
        <div className="wrap">
          <span>© ${new Date().getFullYear()} ${ws.name}. <span className="wsruns">Runs on StratEdge Workspaces.</span></span>
          <span>
            <a href="#/terms">Terms of use</a>
            <a style=${{ marginLeft: 18 }} href="#/privacy">Privacy</a>
          </span>
        </div>
      </div>
    </footer>`;
}

/** The workspace's home page: who it is, the way in, open roles, and what people find inside. */
function WsHome({ ws }) {
  const b = ws.brand || {};
  const parts = WS_PARTS.filter(p => (ws.features || []).includes(p[0]));
  const signedIn = Cap.state === 'ready';
  return html`<${Fragment}>
      <section className="wshero" style=${b.color ? { '--ws-color': b.color } : null}>
        <div className="wrap">
          <div className="wshero-in">
            ${b.logo ? html`<img className="wshero-logo" src=${b.logo} alt="" />` : null}
            <h1>${ws.name}</h1>
            <p className="lead">${b.tagline || (signedIn ? 'Welcome back to the ' + ws.name + ' portal.' : 'Sign in to your ' + ws.name + ' portal.')}</p>
            ${
              !ws.setup
                ? html`<p className="note amber" role="status"><span><b>This portal is being set up.</b> Its administrator signs in first, from the link in their email. Everyone else can sign in once they are added.</span></p>`
                : null
            }
            <div className="actions">
              ${
                signedIn
                  ? html`<a className="btn lg" href="#/portal">Open your portal</a>`
                  : html`<a className="btn lg" href=${LOGIN}>Log in</a>`
              }
              ${wsFeat('recruiting') && ws.setup && html`<a className="btn lg ghost" href="#/careers">See open roles</a>`}
            </div>
          </div>
        </div>
      </section>
      ${
        parts.length > 0 &&
        html`<section className="sec">
            <div className="wrap">
              <h2 className="wsh2">In your portal</h2>
              <div className="wsparts">
                ${parts.map(
                  ([k, n, d, i]) => html`<div key=${k} className="wspart">
                      <span className="wsicon"><${Icon} n=${i} /></span>
                      <div><h3>${n}</h3><p className="muted">${d}</p></div>
                    </div>`
                )}
              </div>
            </div>
          </section>`
      }
    <//>`;
}

/** The first administrator's setup, from the link the provider emailed: their name and a password, then the
 *  Admin portal. The link works once, for 14 days. */
function WsSetupPage({ q, ws }) {
  const t = String((q && q.t) || '');
  const pol = usePwPolicy();
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState('');
  const [f, setF] = useState({ n: '', p: '', p2: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    if (!/^[a-f0-9]{48}$/.test(t)) {
      setInfo({ bad: true, msg: 'This link is not complete. Open it again from the email, or ask the StratEdge Workspaces team for a new one.' });
      return;
    }
    api('ws_setup_get', { t })
      .then(r => {
        if (!live) return;
        setInfo(r);
        setF(x => ({ ...x, n: (r.admin && r.admin.name) || '' }));
      })
      .catch(e => live && setInfo({ bad: true, msg: errText(e) }));
    return () => {
      live = false;
    };
  }, [t]);
  const submit = async e => {
    e.preventDefault();
    setErr('');
    if (f.n.trim().length < 2) return setErr('Add your full name.');
    if (f.p.length < pol.minSolo) return setErr('Use at least ' + pol.minSolo + ' characters. A passphrase of a few unrelated words is strong and easy to remember.');
    if (f.p !== f.p2) return setErr('The two passwords don’t match.');
    setBusy(true);
    try {
      const r = await api('ws_setup', { t, name: f.n.trim(), password: f.p });
      await reloadCaps();
      location.hash = r.go || '#/portal/admin';
    } catch (x) {
      setErr(errText(x));
      setBusy(false);
    }
  };
  let body;
  if (!info) body = html`<${Spinner} label="Checking your link…" />`;
  else if (info.bad) body = html`<p className="err" role="alert">${info.msg}</p>`;
  else if (info.done)
    body = html`<${Fragment}>
        <p>The ${ws.name} portal is set up already.</p>
        <a className="btn lg" href=${LOGIN + '?as=admin'}>Log in</a>
      <//>`;
  else
    body = html`<form className="form" onSubmit=${submit} noValidate>
        <p className="muted">You are the first administrator of the ${ws.name} portal. Choose your password; you then add your team from the Admin portal.</p>
        <${Field} label="Your email"><input value=${(info.admin && info.admin.email) || ''} readOnly autoComplete="username" /><//>
        <${Field} label="Full name"><input value=${f.n} onInput=${e => setF({ ...f, n: e.target.value })} autoComplete="name" /><//>
        <${Field} label="Password"><input type="password" value=${f.p} onInput=${e => setF({ ...f, p: e.target.value })} autoComplete="new-password" /><//>
        ${f.p && html`<${PwHint} pw=${f.p} min=${pol.minSolo} />`}
        <${Field} label="Confirm password"><input type="password" value=${f.p2} onInput=${e => setF({ ...f, p2: e.target.value })} autoComplete="new-password" /><//>
        ${err && html`<p className="err" role="alert">${err}</p>`}
        <button className="btn lg" style=${{ width: '100%' }} disabled=${busy}>${busy ? 'Please wait…' : 'Set up the portal'}</button>
        <p className="muted small">Administrators set up two-step sign-in after this (the portal asks). The link works once.</p>
      </form>`;
  return html`<div className="wsgate">
      <div className="card">
        <h1>Set up ${ws.name}</h1>
        ${body}
      </div>
    </div>`;
}

/** /w/<name>/ for a name that is not (or no longer) a workspace. */
function WsGone() {
  return html`<div className="gate wsalone">
      <div className="card">
        <h1>No portal here</h1>
        <p>There is no company portal at this address. Check the link you were given, or ask the company that sent it.</p>
        <p className="muted small">Company portals run on StratEdge Workspaces.</p>
      </div>
    </div>`;
}

/** A workspace the provider paused (the server answers nothing else meanwhile). */
function WsPaused({ ws }) {
  return html`<div className="gate wsalone">
      <div className="card">
        <${WsLogo} ws=${ws} />
        <h1>This portal is paused</h1>
        <p>The ${ws.name} portal is not available right now. Nothing in it was removed. ${ws.contact ? html`Questions: <a href=${'mailto:' + ws.contact}>${ws.contact}</a>.` : null}</p>
        <p className="muted small">Its administrator can switch it back on with the StratEdge Workspaces team.</p>
      </div>
    </div>`;
}

/** A StratEdge website page that a company workspace does not have. */
const WsNotHere = ({ ws }) =>
  html`<${PageHead} title="Page not found" intro=${html`That page isn't part of the ${ws.name} portal. <a href="#/">Go to the home page</a> or <a href=${LOGIN}>log in</a>.`} />`;

/** Terms and privacy on a company workspace: the company decides how the information is used; the request form files
 *  privacy requests with the company's own administrators. */
function WsLegal({ ws, terms, q }) {
  const who = ws.contact ? html`<a href=${'mailto:' + ws.contact}>${ws.contact}</a>` : 'its administrators';
  return html`<${Fragment}>
      <${PageHead} title=${terms ? 'Terms of use' : 'Privacy'} intro=${ws.name + ' runs this portal on StratEdge Workspaces.'} />
      <section className="sec">
        <div className=${terms ? 'wrap' : 'wrap g32'} style=${{ alignItems: 'start', gap: 36 }}>
          <div className="prose">
            ${
              terms
                ? html`<${Fragment}>
                    <p>This portal is for the people ${ws.name} works with: its team, consultants, candidates, clients and vendors. Use it for that work only, keep your sign-in to yourself, and do not try to reach information that was not shared with you.</p>
                    <p>${ws.name} decides who has an account and what each account can open. Questions about your account or this portal go to ${who}.</p>
                    <p>The StratEdge Workspaces service hosts the portal for ${ws.name}.</p>
                  <//>`
                : html`<${Fragment}>
                    <p>${ws.name} decides what information this portal collects and how it is used: for example your profile, the documents you upload, and records of your work and pay. Ask ${who} what is kept, why, and for how long.</p>
                    <p>The StratEdge Workspaces service hosts the portal and handles the information only to run it for ${ws.name}. The portal's data is kept apart from every other company's.</p>
                    <p>To ask for a copy of your information, a correction or a deletion, use the form. ${ws.name}'s administrators receive it.</p>
                  <//>`
            }
          </div>
          ${!terms && html`<div className="stickyside"><${PrivacyRequest} q=${q || {}} /></div>`}
        </div>
      </section>
    <//>`;
}

/** The website of a company workspace (main.js hands over here once the server says this address is one). */
function WsApp({ path, q, ws }) {
  if (ws.missing) return html`<${WsGone} />`;
  if (ws.status === 'paused') return html`<${WsPaused} ws=${ws} />`;
  if (path === '/portal/choose') return html`<${PageGuard} where="chooser"><${Lazy} load=${loadMember} get=${() => PortalHub} props=${{ q }} /><//>`;
  if (path.startsWith('/portal') || path.startsWith('/client')) return html`<${Lazy} load=${loadMember} get=${() => Portal} props=${{ path, q }} label="Opening your portal…" />`;
  if (path === '/ws-setup') return html`<${PageGuard} where="website"><${WsSetupPage} q=${q} ws=${ws} /><//>`;
  const rec = wsFeat('recruiting');
  let page;
  if (path === '/') page = html`<${WsHome} ws=${ws} />`;
  else if (path === '/login') page = html`<${LoginPage} q=${q} />`;
  else if (path === '/forgot') page = html`<${ForgotPage} q=${q} />`;
  else if (path === '/reset') page = html`<${ResetPage} q=${q} />`;
  else if (path === '/stop-change') page = html`<${StopChangePage} q=${q} />`;
  else if (path === '/unsubscribe') page = html`<${Lazy} get=${() => UnsubscribePage} props=${{ q }} />`;
  else if (path === '/confirm') page = html`<${ConfirmPage} q=${q} />`;
  else if (path === '/privacy') page = html`<${WsLegal} ws=${ws} q=${q} />`;
  else if (path === '/terms') page = html`<${WsLegal} ws=${ws} terms />`;
  else if (path === '/support' && wsFeat('desk')) page = html`<${SupportPage} q=${q} />`;
  else if (path === '/verify' && wsFeat('learning')) page = html`<${VerifyPage} q=${q} />`;
  else if (path === '/careers' && rec) page = html`<${Careers} />`;
  else if (path.startsWith('/careers/') && rec) page = html`<${CareerJob} id=${path.split('/')[2] || ''} q=${q} />`;
  else if (path === '/rtr' && rec) page = html`<${RtrPage} q=${q} />`;
  else if (path === '/my-details' && rec) page = html`<${MyDetailsPage} q=${q} />`;
  else if (path === '/id' && rec) page = html`<${Lazy} load=${loadMember} get=${() => IdLinkPage} props=${{ q }} />`;
  else if (path.startsWith('/sign/')) {
    const [, , sid, stok] = path.split('/');
    page = html`<${Lazy} load=${loadMember} get=${() => SignPublic} props=${{ id: sid || '', tok: stok || '' }} label="Opening the document…" />`;
  } else if (path.startsWith('/invoice/')) {
    const [, , iid, itok] = path.split('/');
    page = html`<${Lazy} load=${loadMember} get=${() => InvoicePublic} props=${{ id: iid || '', tok: itok || '' }} label="Opening the invoice…" />`;
  } else page = html`<${WsNotHere} ws=${ws} />`;
  return html`<div className="site wsite">
      <${StaleBanner} />
      <a className="skip" href="#/" onClick=${e => {
        e.preventDefault();
        const m = document.getElementById('main');
        m && m.focus();
      }}>Skip to content</a>
      <${WsHeader} path=${path} ws=${ws} />
      <main id="main" tabIndex="-1"><${PageGuard} key=${path} where="website">${page}<//></main>
      <${WsFooter} ws=${ws} />
    </div>`;
}
