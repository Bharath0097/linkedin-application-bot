/* ================= App & routing ================= */
const TITLES = {
  '/': 'IT staffing and solutions',
  '/about': 'About us',
  '/services': 'Services',
  '/blog': 'Blog',
  '/careers': 'Careers',
  '/contact': 'Contact us',
  '/login': 'Log in',
  '/terms': 'Terms of use',
  '/privacy': 'Privacy policy',
  '/faq': 'FAQ',
  '/request-talent': 'Request talent',
  '/post-requirement': 'Post a requirement',
  '/unsubscribe': 'Email preferences',
  '/plans': 'Plans for students and consultants',
  '/verify': 'Verify a certificate',
  '/confirm': 'Confirm your details',
  '/security': 'Security',
  '/pricing': 'Pricing',
  '/forgot': 'Reset your password',
  '/reset': 'Choose a new password',
  '/stop-change': 'Stop a bank account change',
  '/support': 'Help & support',
  '/rtr': 'Approve a submission',
  '/my-details': 'Confirm your details',
  '/id': 'Verify your ID',
  '/ws-setup': 'Set up your portal',
  '/get-portal': 'Your own portal',
  '/atty': 'Immigration case',
  '/hire': 'Specialist talent',
};
const titleFor = path => (path.startsWith('/careers/') ? 'Careers' : TITLES[path]);
function App() {
  const { path, q } = useHashRoute();
  // v37: on an address that may be a company workspace, nothing is drawn until the server says which portal this is
  const caps = useCaps();
  const ws = caps && caps.ws ? caps.ws : null;
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [path]);
  useFxBehaviors(path);
  // v38: portal pages and sign-in pages take the Glass look; the public website keeps its own (set before painting)
  React.useLayoutEffect(() => {
    document.documentElement.setAttribute('data-area', lookArea(path));
  }, [path]);
  useEffect(() => {
    if (ws) {
      document.title = (ws.missing ? 'No portal here' : (path.startsWith('/portal') ? 'Portal' : path === '/' ? 'Home' : titleFor(path) || 'Portal') + ' | ' + ws.name);
      return;
    }
    const svc = path.startsWith('/services/') && SERVICES.find(s => '/services/' + s.s === path);
    const post = path.startsWith('/blog/') && POSTS.find(p => '/blog/' + p.s === path);
    document.title = `${path.startsWith('/portal') ? 'Portal' : path.startsWith('/sign/') ? 'Sign document' : path.startsWith('/invoice/') ? 'Invoice' : svc ? svc.n : post ? post.t : titleFor(path) || 'StratEdge'} | StratEdge IT Consulting`;
  }, [path, ws && ws.name, ws && ws.missing]);
  if (WS_HINT && !caps) return html`<div className="gate"><${Spinner} label="Loading…" /></div>`;
  if (ws) return html`<${Lazy} load=${loadSite2} get=${() => WsApp} props=${{ path, q, ws }} />`;
  if (path === '/portal/choose') return html`<${PageGuard} where="chooser"><${Lazy} load=${loadMember} get=${() => PortalHub} props=${{ q }} /><//>`;
  if (path.startsWith('/portal') || path.startsWith('/client'))
    return html`<${Lazy} load=${loadMember} get=${() => Portal} props=${{ path, q }} label="Opening your portal…" />`;
  let page;
  if (path === '/') page = html`<${Home} />`;
  else if (path === '/about') page = html`<${About} />`;
  else if (path === '/services') page = html`<${ServicesPage} />`;
  else if (path.startsWith('/services/')) page = html`<${ServiceDetail} slug=${path.split('/')[2]} />`;
  else if (path === '/blog') page = html`<${BlogPage} />`;
  else if (path.startsWith('/blog/')) page = html`<${BlogPost} slug=${path.split('/')[2]} />`;
  else if (path === '/faq') page = html`<${FaqPage} />`;
  else if (path === '/request-talent') page = html`<${RequestTalent} q=${q} />`;
  // v50: specialist service pages and case evidence
  else if (path === '/hire') page = html`<${CwHireList} />`;
  else if (path.startsWith('/hire/')) page = html`<${CwHirePage} slug=${path.split('/')[2] || ''} />`;
  else if (path.startsWith('/cases/')) page = html`<${CwCasePage} slug=${path.split('/')[2] || ''} />`;
  else if (path === '/post-requirement') page = html`<${Lazy} get=${() => PostRequirementPage} props=${{ q }} />`;
  else if (path === '/terms') page = html`<${TermsPage} />`;
  else if (path === '/privacy') page = html`<${Lazy} load=${loadSite2} get=${() => (site2Ready() ? PrivacyPage : undefined)} props=${{ q }} />`;
  else if (path === '/security') page = html`<${Lazy} load=${loadSite2} get=${() => SecurityPublicPage} />`;
  else if (path === '/support') page = html`<${Lazy} load=${loadSite2} get=${() => SupportPage} props=${{ q }} />`;
  else if (path === '/forgot') page = html`<${Lazy} load=${loadSite2} get=${() => ForgotPage} props=${{ q }} />`;
  else if (path === '/reset') page = html`<${Lazy} load=${loadSite2} get=${() => ResetPage} props=${{ q }} />`;
  else if (path === '/stop-change') page = html`<${Lazy} load=${loadSite2} get=${() => StopChangePage} props=${{ q }} />`;
  else if (path === '/careers') page = html`<${Careers} />`;
  else if (path.startsWith('/careers/')) page = html`<${CareerJob} id=${path.split('/')[2] || ''} q=${q} />`;
  else if (path === '/contact') page = html`<${ContactPage} />`;
  else if (path === '/unsubscribe') page = html`<${Lazy} get=${() => UnsubscribePage} props=${{ q }} />`;
  else if (path === '/login') page = html`<${Lazy} load=${loadSite2} get=${() => (site2Ready() ? LoginPage : undefined)} props=${{ q }} label="Opening sign-in…" />`;
  else if (path === '/plans') page = html`<${Lazy} load=${loadSite2} get=${() => PlansPage} />`;
  else if (path === '/pricing') page = html`<${Lazy} load=${loadSite2} get=${() => PricingPage} props=${{ q }} />`;
  else if (path === '/verify') page = html`<${Lazy} load=${loadSite2} get=${() => VerifyPage} props=${{ q }} />`;
  else if (path === '/confirm') page = html`<${Lazy} load=${loadSite2} get=${() => ConfirmPage} props=${{ q }} />`;
  // v36: the bench desk's links to consultants (approve a submission, confirm your details)
  else if (path === '/rtr') page = html`<${Lazy} load=${loadSite2} get=${() => RtrPage} props=${{ q }} />`;
  else if (path === '/my-details') page = html`<${Lazy} load=${loadSite2} get=${() => MyDetailsPage} props=${{ q }} />`;
  else if (path === '/id') page = html`<${Lazy} load=${loadMember} get=${() => IdLinkPage} props=${{ q }} />`;
  // v37.4: a company asks for its own portal (and confirms its email from the link)
  else if (path === '/get-portal') page = html`<${Lazy} load=${loadSite2} get=${() => GetPortalPage} props=${{ q }} />`;
  // v45.1: an immigration case shared with its attorney (a secure link and a code emailed each visit; js/work.js)
  else if (path === '/atty') page = html`<${Lazy} load=${loadWork} get=${() => ImAtty} props=${{ q }} label="Opening the case…" />`;
  else if (path.startsWith('/sign/')) {
    const [, , sid, stok] = path.split('/');
    page = html`<${Lazy} load=${loadMember} get=${() => SignPublic} props=${{ id: sid || '', tok: stok || '' }} label="Opening the document…" />`;
  } else if (path.startsWith('/invoice/')) {
    const [, , iid, itok] = path.split('/');
    page = html`<${Lazy} load=${loadMember} get=${() => InvoicePublic} props=${{ id: iid || '', tok: itok || '' }} label="Opening the invoice…" />`;
  } else page = html`<${NotFound} />`;
  return html`<div className="site">
      <${StaleBanner} />
      <a className="skip" href="#/" onClick=${e => {
        e.preventDefault();
        const m = document.getElementById('main');
        m && m.focus();
      }}>Skip to content</a>
      ${path !== '/id' && html`<${SiteAds} place="bar" />`}
      <${SiteHeader} path=${path} />
      <main id="main" tabIndex="-1">
        ${path === '/' ? html`<${SiteAds} place="home" />` : path.startsWith('/careers') ? html`<${SiteAds} place="careers" />` : null}<${PageGuard} key=${path} where="website">${page}<//>
      </main>
      <${SiteFooter} />
      ${!['/login', '/forgot', '/reset', '/stop-change', '/id'].includes(path) && html`<${SiteAssistant} />`}
    </div>`;
}
// v45.2: the call window lives in the member bundle; it is drawn once that bundle has run (in the portal)
function MemberHost() {
  return useMemberLoaded() ? html`<${PhoneHost} />` : null;
}
// v62: the "Confirm it's you" window lives in js/site2.js (with the sign-in pages); it is drawn once that bundle has run
// (the portals always load it; a sensitive action never happens before someone signed in)
function Site2Host() {
  return useSite2Loaded() ? html`<${ReauthHost} />` : null;
}
// v35: one "Confirm it's you" window for every sensitive action, wherever it starts
ReactDOM.createRoot(document.getElementById('app')).render(html`<${ToastHost}><${PageGuard} where="site"><${App} /><//><${Site2Host} /><${IdsHost} /><${MemberHost} /><//>`);
