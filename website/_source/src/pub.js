/* ================= Public-site pieces that every bundle needs: the website ads (view/click counted) ================= */
const AD_PLACES = [
  ['bar', 'Thin bar above every page'],
  ['home', 'Banner on the home page'],
  ['careers', 'Banner on the careers pages'],
];
const AD_THEMES = [
  ['navy', 'Navy'],
  ['teal', 'Teal'],
  ['sunset', 'Sunset'],
  ['mint', 'Mint'],
  ['night', 'Night'],
];
const AD_FIELDS = [
  { k: 't', n: 'Headline', req: 1, ph: 'e.g. Hiring SAP consultants for Q4 projects', wide: 1 },
  { k: 'b', n: 'Text', t: 'textarea', rows: 2, ph: 'One short line that makes people click' },
  { k: 'cta', n: 'Button label', ph: 'See open roles' },
  { k: 'url', n: 'Button link', ph: '#/careers', hint: 'A page on this site (#/careers, #/request-talent, #/contact) or a full https:// address.' },
  { k: 'place', n: 'Where it shows', t: 'select', o: AD_PLACES, req: 1 },
  { k: 'theme', n: 'Colors', t: 'select', o: AD_THEMES },
  { k: 'em', n: 'Emoji or tag', ph: '🚀 or NEW' },
  { k: 'from', n: 'Start date', t: 'date' },
  { k: 'to', n: 'End date', t: 'date' },
  { k: 'on', n: 'Live', t: 'check', cl: 'Show it on the website', yes: 'Live' },
];
const adLink = ad => {
  const u = String(ad.url || '#/careers').trim();
  return /^(https?:\/\/|#\/|mailto:|tel:)/i.test(u) ? u : '#/' + u.replace(/^[#/]+/, '');
};
function AdView({ ad, place, onGo, onHide }) {
  const link = adLink(ad);
  const ext = /^https?:/i.test(link);
  const cta = html`<a className="adcta" href=${link} target=${ext ? '_blank' : undefined} rel=${ext ? 'noopener' : undefined} onClick=${onGo}>${ad.cta || 'Learn more'}</a>`;
  const x = onHide && html`<button type="button" className="adx" aria-label="Hide this message" onClick=${onHide}>×</button>`;
  if (place === 'bar')
    return html`<div className=${'adbar ad-' + (ad.theme || 'navy')} role="region" aria-label="Announcement">
        ${ad.em && html`<span className="adem">${ad.em}</span>`}
        <span className="adt"><b>${ad.t}</b>${ad.b ? html`<span> ${ad.b}</span>` : null}</span>
        ${cta}${x}
      </div>`;
  return html`<div className=${'adcard ad-' + (ad.theme || 'navy')} role="region" aria-label="Promotion">
      ${ad.em && html`<span className="adem">${ad.em}</span>`}
      <div className="adbody"><h3>${ad.t}</h3>${ad.b && html`<p>${ad.b}</p>`}</div>
      ${cta}${x}
    </div>`;
}
/* The live ad for a spot on the public site. Counts one view per visit and every click. */
function SiteAds({ place }) {
  const caps = useCaps();
  const ads = useCol(caps && place ? 'org/site/ads' : null);
  const [hidden, setHidden] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem('se_adhide') || '[]');
    } catch (e) {
      return [];
    }
  });
  const today = dkey();
  const ad = ads.docs.find(
    a => a.on && a.place === place && (!a.from || a.from <= today) && (!a.to || a.to >= today) && !hidden.includes(a.id)
  );
  useEffect(() => {
    if (!ad) return;
    try {
      if (sessionStorage.getItem('se_adv_' + ad.id)) return;
      sessionStorage.setItem('se_adv_' + ad.id, '1');
    } catch (e) {}
    api('ad_hit', { id: ad.id, kind: 'view' }).catch(() => {});
  }, [ad && ad.id]);
  if (!ad) return null;
  const hide = () => {
    const h = [...hidden, ad.id];
    setHidden(h);
    try {
      sessionStorage.setItem('se_adhide', JSON.stringify(h));
    } catch (e) {}
  };
  const go = () => {
    api('ad_hit', { id: ad.id, kind: 'click' }).catch(() => {});
  };
  return place === 'bar'
    ? html`<${AdView} ad=${ad} place="bar" onGo=${go} onHide=${hide} />`
    : html`<div className="wrap adwrap"><${AdView} ad=${ad} place=${place} onGo=${go} onHide=${hide} /></div>`;
}
