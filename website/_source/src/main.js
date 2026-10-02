/* ================= App & routing ================= */
const TITLES = { '/': 'IT staffing and solutions', '/about': 'About us', '/services': 'Services', '/blog': 'Blog', '/careers': 'Careers', '/contact': 'Contact us', '/login': 'Log in', '/terms': 'Terms of use', '/privacy': 'Privacy policy', '/faq': 'FAQ', '/request-talent': 'Request talent' };
function App() {
  const { path, q } = useHashRoute();
  useEffect(() => { window.scrollTo(0, 0); }, [path]);
  useFxBehaviors(path);
  useEffect(() => {
    const svc = path.startsWith('/services/') && SERVICES.find(s => '/services/' + s.s === path);
    const post = path.startsWith('/blog/') && POSTS.find(p => '/blog/' + p.s === path);
    document.title = `${path.startsWith('/portal') ? 'Portal' : path.startsWith('/sign/') ? 'Sign document' : path.startsWith('/invoice/') ? 'Invoice' : svc ? svc.n : post ? post.t : (TITLES[path] || 'StratEdge')} | StratEdge IT Consulting`;
  }, [path]);
  if (path.startsWith('/portal') || path.startsWith('/client')) return html`<${Portal} path=${path} q=${q} />`;
  let page;
  if (path === '/') page = html`<${Home} />`;
  else if (path === '/about') page = html`<${About} />`;
  else if (path === '/services') page = html`<${ServicesPage} />`;
  else if (path.startsWith('/services/')) page = html`<${ServiceDetail} slug=${path.split('/')[2]} />`;
  else if (path === '/blog') page = html`<${BlogPage} />`;
  else if (path.startsWith('/blog/')) page = html`<${BlogPost} slug=${path.split('/')[2]} />`;
  else if (path === '/faq') page = html`<${FaqPage} />`;
  else if (path === '/request-talent') page = html`<${RequestTalent} q=${q} />`;
  else if (path === '/terms') page = html`<${TermsPage} />`;
  else if (path === '/privacy') page = html`<${PrivacyPage} />`;
  else if (path === '/careers') page = html`<${Careers} />`;
  else if (path === '/contact') page = html`<${ContactPage} />`;
  else if (path === '/login') page = html`<${LoginPage} q=${q} />`;
  else if (path.startsWith('/sign/')) { const [, , sid, stok] = path.split('/'); page = html`<${SignPublic} id=${sid || ''} tok=${stok || ''} />`; }
  else if (path.startsWith('/invoice/')) { const [, , iid, itok] = path.split('/'); page = html`<${InvoicePublic} id=${iid || ''} tok=${itok || ''} />`; }
  else page = html`<${NotFound} />`;
  return html`<div className="site">
    <a className="skip" href="#/" onClick=${e => { e.preventDefault(); const m = document.getElementById('main'); m && m.focus(); }}>Skip to content</a>
    <${SiteHeader} path=${path} />
    <main id="main" tabIndex="-1">${page}</main>
    <${SiteFooter} />
    <${EdgeBot} />
  </div>`;
}
ReactDOM.createRoot(document.getElementById('app')).render(html`<${ToastHost}><${App} /><//>`);
