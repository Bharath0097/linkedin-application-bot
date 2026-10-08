/* ================= The apply profile and the autofill =================
   Every job application asks the same questions. A consultant answers them once here (u/{uid}.apply); from then
   on the "StratEdge autofill" bookmarklet fills any application page, attaches the active resume, and each answer
   can also be copied with one click. Recruiters see how complete each consultant's profile is. */
const APPLY_GROUPS = [
  ['Contact details', [
    ['first', 'First name'],
    ['last', 'Last name'],
    ['email', 'Email', 'email'],
    ['phone', 'Phone', 'tel'],
    ['address', 'Street address'],
    ['city', 'City'],
    ['state', 'State'],
    ['zip', 'ZIP code'],
    ['country', 'Country'],
    ['linkedin', 'LinkedIn URL', 'url'],
    ['website', 'Portfolio or website', 'url'],
  ]],
  ['Work authorization', [
    ['auth', 'Work authorization', 'select', ['US citizen', 'Green card', 'H-1B', 'H4 EAD', 'OPT', 'CPT', 'L2 EAD', 'TN', 'EAD (other)', 'Other']],
    ['auth_yesno', 'Legally authorized to work in the US?', 'select', ['Yes', 'No']],
    ['sponsor', 'Will you need visa sponsorship?', 'select', ['No', 'Yes']],
    ['relocate', 'Willing to relocate?', 'select', ['Yes', 'No']],
    ['remote', 'Work arrangement you prefer', 'select', ['Remote', 'Hybrid', 'On-site', 'Any']],
  ]],
  ['Pay and availability', [
    ['rate', 'Expected hourly rate', 'text', null, 'e.g. 65'],
    ['salary', 'Expected yearly salary', 'text', null, 'e.g. 130000'],
    ['avail', 'Availability', 'text', null, 'e.g. Immediately, or 2 weeks notice'],
    ['years', 'Years of experience', 'text', null, 'e.g. 8'],
  ]],
  ['Current role', [
    ['title', 'Current or most recent title'],
    ['employer', 'Current or most recent employer'],
  ]],
  ['Education', [
    ['degree', 'Highest degree', 'select', ['High school', 'Associate', "Bachelor's", "Master's", 'Doctorate', 'Other']],
    ['major', 'Field of study'],
    ['school', 'School'],
    ['gradyear', 'Graduation year'],
  ]],
  ['Skills', [
    ['skills', 'Skills', 'textarea', null, 'Comma separated, the way you want them to appear'],
    ['certs', 'Certifications', 'text', null, 'e.g. AWS Solutions Architect, PMP'],
  ]],
  ['Voluntary self-identification', [
    ['gender', 'Gender', 'select', ['Male', 'Female', 'Non-binary', 'Decline to self identify']],
    ['race', 'Race / ethnicity', 'select', ['Asian', 'Black or African American', 'Hispanic or Latino', 'White', 'Two or more races', 'American Indian or Alaska Native', 'Native Hawaiian or Other Pacific Islander', 'Decline to self identify']],
    ['veteran', 'Veteran status', 'select', ['I am not a protected veteran', 'I identify as one or more of the classifications of a protected veteran', "I don't wish to answer"]],
    ['disability', 'Disability status', 'select', ['No, I do not have a disability', 'Yes, I have a disability', 'I do not want to answer']],
  ]],
  ['Standard answers', [
    ['cover', 'Cover letter / why you are interested', 'textarea', null, 'Written once, pasted into "cover letter" and "tell us about yourself" boxes'],
    ['refer', 'How did you hear about us?', 'text', null, 'e.g. Job board'],
  ]],
];
const APPLY_FIELDS = APPLY_GROUPS.flatMap(([, f]) => f);
const APPLY_CORE = ['first', 'last', 'email', 'phone', 'city', 'state', 'auth', 'sponsor', 'rate', 'years', 'title', 'degree', 'skills'];
const applyPct = a => Math.round((APPLY_CORE.filter(k => a && a[k] != null && String(a[k]).trim() !== '').length / APPLY_CORE.length) * 100);
/* What the autofill looks for on a page, per answer: words that appear in the field's label, name, id or placeholder. */
const APPLY_SYN = {
  first: ['first name', 'given name', 'firstname', 'fname', 'first_name'],
  last: ['last name', 'family name', 'surname', 'lastname', 'lname', 'last_name'],
  name: ['full name', 'your name', 'legal name', 'candidate name'],
  email: ['email', 'e-mail'],
  phone: ['phone', 'mobile', 'telephone', 'cell'],
  address: ['street', 'address line', 'address 1', 'address'],
  city: ['city', 'town'],
  state: ['state', 'province', 'region'],
  zip: ['zip', 'postal'],
  country: ['country'],
  linkedin: ['linkedin'],
  website: ['website', 'portfolio', 'personal site', 'github', 'web site'],
  auth: ['work authorization', 'visa status', 'authorization status', 'immigration status', 'citizenship status'],
  auth_yesno: ['authorized to work', 'legally authorized', 'eligible to work', 'right to work', 'legally eligible'],
  sponsor: ['sponsorship', 'sponsor', 'require visa'],
  relocate: ['relocat'],
  remote: ['remote', 'work arrangement', 'work location preference'],
  rate: ['hourly rate', 'pay rate', 'rate expectation', 'desired rate', 'bill rate'],
  salary: ['salary', 'compensation', 'expected pay', 'desired pay', 'pay expectation'],
  avail: ['availability', 'available to start', 'start date', 'notice period', 'earliest start'],
  years: ['years of experience', 'years experience', 'total experience', 'experience (years)', 'years of relevant'],
  title: ['current title', 'job title', 'current position', 'most recent title', 'title'],
  employer: ['current employer', 'current company', 'most recent employer', 'company name', 'employer'],
  degree: ['degree', 'education level', 'highest education', 'highest level'],
  major: ['major', 'field of study', 'discipline', 'area of study'],
  school: ['school', 'university', 'college', 'institution'],
  gradyear: ['graduation', 'grad year', 'year of completion', 'end year'],
  skills: ['skills', 'technologies', 'technical skills'],
  certs: ['certification'],
  gender: ['gender', 'sex'],
  race: ['race', 'ethnicity', 'ethnic'],
  veteran: ['veteran'],
  disability: ['disability', 'disabled'],
  cover: ['cover letter', 'why do you want', 'why are you interested', 'tell us about yourself', 'additional information', 'message to hiring', 'anything else', 'summary'],
  refer: ['how did you hear', 'referral source', 'hear about', 'source'],
};
/* The bookmarklet: a small script with the answers inside it, run on any application page. It matches fields by
   their labels, fills them the way a person typing would (so React and Angular forms notice), picks drop-down
   options and yes/no radios, attaches the resume through the token link, and reports what it did. */
function applyBookmarklet(a, resumeUrl, reportUrl) {
  const P = { ...a, name: [a.first, a.last].filter(Boolean).join(' ') };
  Object.keys(P).forEach(k => {
    if (P[k] == null || P[k] === '' || typeof P[k] === 'object') delete P[k];
  });
  const code = `(function(){var P=${JSON.stringify(P)},S=${JSON.stringify(APPLY_SYN)},R=${JSON.stringify(resumeUrl || '')},U=${JSON.stringify(reportUrl || '')},F=[],M=[],ok=false;
function tx(e){return(e&&e.textContent||'').replace(/\\s+/g,' ').trim()}
function lab(el){var t=[];try{if(el.id){var l=document.querySelector('label[for="'+CSS.escape(el.id)+'"]');if(l)t.push(tx(l))}var p=el.closest('label');if(p)t.push(tx(p));['aria-label','placeholder','name','id','autocomplete','data-automation-id','data-qa','data-testid'].forEach(function(k){var v=el.getAttribute(k);if(v)t.push(v)});var lb=el.getAttribute('aria-labelledby');if(lb)lb.split(/\\s+/).forEach(function(i){var e=document.getElementById(i);if(e)t.push(tx(e))});var q=el.closest('fieldset,[class*="field"],[class*="question"],[class*="form-group"],[class*="FormField"],li,div');if(q){var g=q.querySelector('legend,label,[class*="label"],[class*="Label"],h3,h4');if(g)t.push(tx(g))}}catch(e){}return t.join(' | ').toLowerCase().replace(/[_\\-]+/g,' ')}
var RX={};Object.keys(S).forEach(function(k){RX[k]=S[k].map(function(s){return new RegExp('(^|[^a-z])'+s.replace(/[.*+?^\${}()|[\]\\]/g,'\\$&'))})});
function key(l){var ks=Object.keys(S);for(var i=0;i<ks.length;i++){var k=ks[i];for(var j=0;j<RX[k].length;j++){if(RX[k][j].test(l))return k}}return null}
function setv(el,v){var pr=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,d=Object.getOwnPropertyDescriptor(pr,'value');el.focus();if(d&&d.set)d.set.call(el,v);else el.value=v;['input','change','blur'].forEach(function(n){el.dispatchEvent(new Event(n,{bubbles:true}))})}
function pick(sel,v){var w=String(v).toLowerCase(),os=[].slice.call(sel.options),o=os.filter(function(x){return x.text.trim().toLowerCase()===w})[0]||os.filter(function(x){var t=x.text.trim().toLowerCase();return t.length>1&&(t.indexOf(w)>=0||w.indexOf(t)>=0)})[0];if(!o&&/^(yes|no)$/.test(w))o=os.filter(function(x){return x.text.trim().toLowerCase().indexOf(w)===0})[0];if(o){sel.value=o.value;sel.dispatchEvent(new Event('change',{bubbles:true}));return true}return false}
var els=[].slice.call(document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=file]):not([type=checkbox]):not([type=radio]),select,textarea'));
els.forEach(function(el){if(el.disabled||el.readOnly||el.offsetParent===null)return;var l=lab(el);if(!l)return;var k=key(l);if(!k)return;var v=P[k];if(k==='title'&&/job title|position title|role title/.test(l)&&/apply|applied|posting/.test(l))return;if(v==null){if(M.indexOf(k)<0)M.push(k);return}if(el.tagName==='SELECT'){if(pick(el,v))F.push(k);return}if(el.value&&el.value.trim()!=='')return;setv(el,String(v));F.push(k)});
var gs={};[].slice.call(document.querySelectorAll('input[type=radio]')).forEach(function(r){var g=r.name||lab(r);(gs[g]=gs[g]||[]).push(r)});
Object.keys(gs).forEach(function(g){var rs=gs[g],q=(lab(rs[0])+' '+g).toLowerCase(),w=null;if(/sponsor/.test(q))w=P.sponsor;else if(/authoriz|eligible|legally|right to work/.test(q))w=P.auth_yesno;else if(/relocat/.test(q))w=P.relocate;else if(/gender/.test(q))w=P.gender;else if(/veteran/.test(q))w=P.veteran;else if(/disabilit/.test(q))w=P.disability;else if(/race|ethnic/.test(q))w=P.race;else if(/remote|hybrid|on.?site/.test(q))w=P.remote;if(!w)return;var s=String(w).toLowerCase(),h=rs.filter(function(r){var t=(lab(r)+' '+r.value).toLowerCase();return t.indexOf(s)>=0})[0];if(h&&!h.checked){h.click();F.push(g.slice(0,20))}});
function done(){var b=document.createElement('div');b.style.cssText='position:fixed;top:12px;right:12px;z-index:2147483647;background:#101b35;color:#fff;padding:12px 16px;border-radius:10px;font:14px/1.45 system-ui,sans-serif;max-width:380px;box-shadow:0 10px 30px rgba(0,0,0,.3);cursor:pointer';var fi=document.querySelector('input[type=file]');b.innerHTML='<b>StratEdge autofill</b><br>Filled '+F.length+' field'+(F.length===1?'':'s')+'.'+(M.length?' Not in your profile yet: '+M.slice(0,4).join(', ')+'.':'')+(fi?(ok?' Resume attached.':' Attach your resume by hand.'):'')+'<br><small>Check every answer before you submit.</small>';b.onclick=function(){b.remove()};document.body.appendChild(b);setTimeout(function(){b.remove()},15000);if(U){try{fetch(U+'&host='+encodeURIComponent(location.hostname),{mode:'no-cors'}).catch(function(){})}catch(e){}}}
var fi=document.querySelector('input[type=file]');if(fi&&R){fetch(R).then(function(r){if(!r.ok)throw 0;var n=(r.headers.get('content-disposition')||'').match(/filename="?([^";]+)/);return r.blob().then(function(b){return new File([b],n?n[1]:'resume.pdf',{type:b.type||'application/pdf'})})}).then(function(f){var dt=new DataTransfer();dt.items.add(f);fi.files=dt.files;fi.dispatchEvent(new Event('change',{bubbles:true}));ok=true}).catch(function(){}).then(done)}else done()})();`;
  return 'javascript:' + encodeURIComponent(code);
}
function ApplyProfilePage() {
  const P = usePortal();
  const toast = useToast();
  const me = useJobsApi('jobs_me');
  const doc = useDoc(P.prof ? `u/${P.uid}` : null);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tok, setTok] = useState(null);
  const [help, setHelp] = useState(false);
  const linkRef = useRef();
  const saved = (doc.data && doc.data.apply) || null;
  useEffect(() => {
    if (!doc.loading && (me.data || me.error) && !f) {
      const a = { ...(saved || {}) };
      // first time: start from the profile and the resume
      const p = (P.prof || {});
      const c = me.data && me.data.consultant;
      const pr = (c && c.profile) || {};
      if (!a.first && !a.last && p.n) {
        const parts = String(p.n).trim().split(/\s+/);
        a.first = parts[0] || '';
        a.last = parts.slice(1).join(' ');
      }
      if (!a.email) a.email = p.e || (Cap.me && Cap.me.email) || '';
      if (!a.phone) a.phone = p.ph || p.phone || '';
      if (!a.title && pr.titles && pr.titles[0]) a.title = pr.titles[0];
      if (!a.years && pr.years) a.years = String(pr.years);
      if (!a.skills && pr.skills && pr.skills.length) a.skills = pr.skills.slice(0, 25).join(', ');
      if (!a.city && pr.location) {
        const m = String(pr.location).match(/^([^,]+),\s*([A-Za-z .]+)$/);
        if (m) {
          a.city = m[1].trim();
          a.state = m[2].trim();
        } else a.city = pr.location;
      }
      if (!a.country) a.country = 'United States';
      setF(a);
    }
  }, [doc.loading, me.data]);
  useEffect(() => {
    if (P.prof) api('apply_token', {}).then(setTok).catch(() => {});
  }, []);
  const resumes = (me.data && me.data.consultant && me.data.consultant.resumes) || [];
  const active = resumes.find(r => r.active) || resumes[0];
  const code = useMemo(() => (f ? applyBookmarklet(f, tok && active ? tok.url : '', tok ? tok.report : '') : ''), [f, tok, active]);
  useEffect(() => {
    if (linkRef.current && code) linkRef.current.setAttribute('href', code);
  }, [code]);
  if (!P.prof) return html`<${NeedProfile} />`;
  if (!f) return html`<${Spinner} onRetry=${() => Sync.kick(0)} label="Loading your apply profile…" />`;
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const pct = applyPct(f);
  const save = async () => {
    setBusy(true);
    try {
      const out = {};
      APPLY_FIELDS.forEach(([k]) => {
        out[k] = String(f[k] == null ? '' : f[k]).trim();
      });
      await dbMerge(`u/${P.uid}`, { apply: { ...out, pct: applyPct(out), u: Date.now(), uses: (saved && saved.uses) || 0, usedAt: (saved && saved.usedAt) || 0, usedOn: (saved && saved.usedOn) || '' } });
      toast('Apply profile saved.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const copy = async (text, what) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what} copied.`);
    } catch (e) {
      prompt('Copy this', text);
    }
  };
  const allText = APPLY_GROUPS.map(([g, fields]) => `${g}\n` + fields.filter(([k]) => f[k]).map(([k, n]) => `${n}: ${f[k]}`).join('\n')).filter(x => x.includes(':')).join('\n\n');
  const downloadJson = async () => {
    try {
      await saveDownload(`apply-profile-${dkey()}.json`, new Blob([JSON.stringify(f, null, 2)], { type: 'application/json' }));
    } catch (e) {
      if (!e || e.code !== 'declined') toast(errText(e), true);
    }
  };
  return html`<div className="stack">
      <div className="g2" style=${{ alignItems: 'start' }}>
        <section className="panel stack" style=${{ gap: 10 }}>
          <div className="ph-row" style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <h2 className="ph">Your apply profile</h2>
            <${Chip} s=${pct >= 80 ? 'ok' : pct >= 40 ? 'amber' : 'red'}>${pct}% complete<//>
          </div>
          <p className="muted small" style=${{ margin: 0 }}>The answers every application asks for. Fill them once; the autofill button types them into job sites for you, and every answer has a copy button for sites it cannot fill.</p>
          <div className="bar"><span style=${{ width: pct + '%' }} /></div>
          ${saved && saved.usedAt ? html`<p className="muted small" style=${{ margin: 0 }}>Autofill used ${saved.uses} time${saved.uses === 1 ? '' : 's'}, last ${fmtTs(saved.usedAt)}${saved.usedOn ? ' on ' + saved.usedOn : ''}.</p>` : null}
        </section>
        <section className="panel stack autofillbox" style=${{ gap: 10 }}>
          <h2 className="ph"><${Icon} n="bolt" /> StratEdge autofill</h2>
          <p className="muted small" style=${{ margin: 0 }}>Drag this button to your bookmarks bar once. On any job application page, click it: your answers are typed in, drop-downs picked, and your resume attached.</p>
          <div className="actions">
            <a ref=${linkRef} className="btn bookmarklet" href="#" onClick=${e => {
              e.preventDefault();
              setHelp(true);
            }} draggable="true" title="Drag me to your bookmarks bar"><${Icon} n="bolt" />StratEdge autofill</a>
            <button type="button" className="btn ghost sm" onClick=${() => setHelp(true)}>How it works</button>
          </div>
          <div className="small muted">
            ${active ? html`Resume attached by the autofill: <b>${active.label || active.name}</b> (${active.name}). ` : html`<span className="late">No resume uploaded yet; </span> <a href="#/portal/resume">add one</a> so it can be attached. `}
            ${tok && html`<button type="button" className="btn link small" onClick=${async () => {
              if (!confirm('Make a new private resume link? The button on your bookmarks bar will stop attaching the resume until you drag the new one.')) return;
              try {
                setTok(await api('apply_token', { regen: true }));
                toast('New link made. Drag the button to your bookmarks bar again.');
              } catch (e) {
                toast(errText(e), true);
              }
            }}>Reset the private resume link</button>`}
          </div>
          <div className="actions">
            <button type="button" className="btn ghost sm" onClick=${() => copy(allText, 'Everything')}><${Icon} n="file" />Copy all answers as text</button>
            <button type="button" className="btn ghost sm" onClick=${downloadJson}><${Icon} n="down" />Download as JSON</button>
          </div>
        </section>
      </div>
      <section className="panel stack" style=${{ gap: 12 }}>
        <h2 className="ph"><${Icon} n="bolt" /> Application bot</h2>
        <p className="muted small" style=${{ margin: 0 }}>The bot fills employer application forms with these answers and your active résumé, through the browser companion. Queue jobs, approve them and run them from the Application bot page; job boards stay a manual handoff.</p>
        <div className="actions"><a className="btn" href="#/portal/appbot"><${Icon} n="bolt" />Open the application bot</a><a className="btn ghost" href="application-bot/companion.zip" download><${Icon} n="down" />Download the browser companion</a></div>
      </section>
      ${APPLY_GROUPS.map(
        ([g, fields]) => html`<section key=${g} className="panel stack" style=${{ gap: 8 }}>
            <h2 className="ph">${g}</h2>
            ${g === 'Voluntary self-identification' && html`<p className="muted small" style=${{ margin: 0 }}>Optional. US employers ask these for equal-opportunity reporting; "decline" is always a valid answer. Stored only in your own profile.</p>`}
            <div className="applygrid">
              ${fields.map(
                ([k, n, t, opts, ph]) => html`<label key=${k} className=${'fld' + (t === 'textarea' ? ' wide' : '')}>
                    <span>${n}${APPLY_CORE.includes(k) ? ' *' : ''}</span>
                    <div className="applyrow">
                      ${
                        t === 'select'
                          ? html`<select value=${f[k] || ''} onChange=${up(k)}><option value="">—</option>${opts.map(o => html`<option key=${o}>${o}</option>`)}${f[k] && !opts.includes(f[k]) && html`<option value=${f[k]}>${f[k]}</option>`}</select>`
                          : t === 'textarea'
                            ? html`<textarea rows=${k === 'cover' ? 6 : 3} value=${f[k] || ''} onInput=${up(k)} placeholder=${ph || ''} />`
                            : html`<input type=${t || 'text'} value=${f[k] || ''} onInput=${up(k)} placeholder=${ph || ''} />`
                      }
                      <button type="button" className="btn ghost sm icon" aria-label=${'Copy ' + n} title="Copy" disabled=${!f[k]} onClick=${() => copy(String(f[k]), n)}><${Icon} n="file" /></button>
                    </div>
                  </label>`
              )}
            </div>
          </section>`
      )}
      <div className="actions"><button type="button" className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save apply profile'}</button><span className="muted small">* used for the completeness score</span></div>
      ${help && html`<${Modal} title="How the autofill works" onClose=${() => setHelp(false)} foot=${html`<button type="button" className="btn" onClick=${() => setHelp(false)}>Got it</button>`}>
          <div className="stack small">
            <p style=${{ margin: 0 }}><b>1. Save your answers here</b>, then <b>drag the "StratEdge autofill" button</b> onto your browser's bookmarks bar (in Chrome: View › Always show bookmarks bar, or Ctrl/Cmd+Shift+B). Clicking it here only shows this help.</p>
            <p style=${{ margin: 0 }}><b>2. Open a job application</b> on any site: Greenhouse, Lever, Workday, iCIMS, Dice, a company's careers page. Get to the form, then click the bookmark.</p>
            <p style=${{ margin: 0 }}><b>3. It fills what it recognises</b>: name, email, phone, address, LinkedIn, work authorization and sponsorship (including yes/no questions), rate or salary, availability, years of experience, education, skills, the self-identification questions, and your cover letter in "why are you interested" boxes. It attaches your active resume to the first file field. A note in the corner says what it filled and what it skipped.</p>
            <p style=${{ margin: 0 }}><b>4. Check every answer, then submit.</b> It never submits for you. Fields it already finds filled are left alone.</p>
            <p style=${{ margin: 0 }}>When you change answers here, save and drag the button again; your answers travel inside it. A few sites block bookmarklets: use the copy buttons there. Multi-step forms: click the bookmark on each step.</p>
            <p className="muted" style=${{ margin: 0 }}>Your resume is fetched through a private link that only works for the autofill. Reset it from this page if you ever share your screen with it visible.</p>
          </div>
        <//>`}
    </div>`;
}
/* A provider button for signing in or connecting an account, styled the way those providers ask for: each carries the
   provider's own mark as published for sign-in buttons (Google's "G" from its branding kit, the "in" from LinkedIn's
   sign-in button image, Microsoft's symbol from its sign-in button kit) - see assets/sso-*. */
const SSO_MARK = { google: 'assets/sso-google.png', linkedin: 'assets/sso-linkedin.png', microsoft: 'assets/sso-microsoft.svg' };
const SsoMark = ({ k, n }) => html`<span className="ssoi" aria-hidden="true">${SSO_MARK[k] ? html`<img src=${SSO_MARK[k]} alt="" width="20" height="20" />` : (n || k)[0]}</span>`;
function SsoBtn({ p, href, label }) {
  const k = (p && p.k) || 'google';
  const n = (p && p.n) || 'Google';
  return html`<a className=${'btn ssobtn sso-' + k} href=${href}><${SsoMark} k=${k} n=${n} /><span>${label || 'Continue with ' + n}</span></a>`;
}
/* Google's own sign-in button (Google Identity Services draws it, logo and all) when the admin left that on and
   the browser can load Google's script; otherwise the classic redirect button. The ID token Google hands back is
   checked by the server (sso_gis), which applies the same one-portal rule as the password login. */
let gisScript = null;
/* Google's library draws its button even when it has refused the site's address or does not know the client id -
   the button then does nothing when clicked, and the refusal is only written to the console (from Google's own
   frame, out of reach). The One Tap prompt API reports the reason on browsers that still honour
   use_fedcm_for_prompt:false; the admin test under Roles & access uses it as a hint, and the real proof is an
   administrator clicking the drawn button there and Google handing back a token (sso_gis_verify). */
const GIS_FATAL = ['unregistered_origin', 'invalid_client', 'missing_client_id', 'secure_http_required'];
function gisProbe() {
  return new Promise(res => {
    // Chrome and Edge run One Tap through the browser itself (FedCM): the reason is not reported there and a refusal
    // pops up as a Google "Access blocked" page, so the probe is skipped and the click on the drawn button decides.
    if (typeof window.IdentityCredential === 'function') return res('');
    let done = false;
    const finish = v => {
      if (done) return;
      done = true;
      try {
        window.google.accounts.id.cancel();
      } catch (e) {}
      res(v);
    };
    const t = setTimeout(() => finish(''), 4000);
    try {
      window.google.accounts.id.prompt(n => {
        try {
          const reason = n && n.isNotDisplayed && n.isNotDisplayed() && n.getNotDisplayedReason ? String(n.getNotDisplayedReason() || '') : '';
          clearTimeout(t);
          finish(reason);
        } catch (e) {
          clearTimeout(t);
          finish('');
        }
      });
    } catch (e) {
      clearTimeout(t);
      finish('');
    }
  });
}
function loadGis() {
  if (window.google && window.google.accounts && window.google.accounts.id) return Promise.resolve();
  if (!gisScript)
    gisScript = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.defer = true;
      s.onload = () => (window.google && window.google.accounts ? res() : rej(new Error('gis')));
      s.onerror = () => {
        gisScript = null;
        rej(new Error('gis'));
      };
      document.head.appendChild(s);
    });
  return gisScript;
}
function GoogleSignIn({ p, href, label, mode, onCredential }) {
  const box = useRef(null);
  const cb = useRef(onCredential);
  cb.current = onCredential;
  const [fallback, setFallback] = useState(!(p && p.cid && p.gis !== false));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (fallback) return;
    let live = true;
    const el = box.current;
    const giveUp = setTimeout(() => live && setFallback(true), 7000);

    loadGis()
      .then(() => {
        if (!live || !el) return;
        try {
          window.google.accounts.id.initialize({
            client_id: p.cid,
            callback: r => r && r.credential && cb.current && cb.current(r.credential),
            ux_mode: 'popup',
            auto_select: false,
            cancel_on_tap_outside: true,
            itp_support: true,
            use_fedcm_for_prompt: false,
          });
          const w = Math.max(200, Math.min(400, Math.floor(el.parentElement ? el.parentElement.clientWidth : 360)));
          const t = document.documentElement.getAttribute('data-theme');
          const dark = t === 'dark' || (t !== 'light' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
          window.google.accounts.id.renderButton(el, {
            type: 'standard',
            theme: dark ? 'filled_black' : 'outline',
            size: 'large',
            text: mode === 'register' ? 'signup_with' : 'continue_with',
            shape: 'pill',
            logo_alignment: 'left',
            width: w,
            locale: 'en',
          });
        } catch (e) {
          live && setFallback(true);
          return;
        }
        // Google draws the button into the box; nothing there after a moment means it was refused (a blocker, no
        // network). A drawn button can still be dead when the site's address is not registered with Google, which
        // is why the server only hands out p.gis once an administrator has clicked the button successfully in the
        // settings test (sso_gis_verify).
        setTimeout(() => {
          if (!live) return;
          if (el.childElementCount > 0) {
            clearTimeout(giveUp);
            setReady(true);
          } else setFallback(true);
        }, 900);
      })
      .catch(() => live && setFallback(true));
    return () => {
      live = false;
      clearTimeout(giveUp);
    };
  }, [fallback, p && p.cid, mode]);
  if (fallback) return html`<${SsoBtn} p=${p} href=${href} label=${label} />`;
  return html`<div className=${'gsi' + (ready ? ' ready' : '')}>
      <div ref=${box} className="gsibox"></div>
      ${!ready && html`<span className="gsiwait btn ssobtn sso-google" aria-hidden="true"><${SsoMark} k="google" n="Google" /><span>${label || 'Continue with Google'}</span></span>`}
    </div>`;
}
/* Staff view (Job portals › Apply profiles): who has filled theirs in, how complete it is, and every answer with a
   copy button, so a recruiter submitting on a consultant's behalf has the details at hand. */
function ApplyProfilesTab() {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(null);
  const [q, setQ] = useState('');
  const load = () =>
    api('apply_profiles')
      .then(r => {
        setRows(r.rows);
        setErr(null);
      })
      .catch(e => setErr(e));
  useEffect(() => {
    load();
  }, []);
  if (err && !rows) return html`<${LoadError} error=${err} onRetry=${load} />`;
  if (!rows) return html`<${Spinner} onRetry=${load} />`;
  const ql = q.trim().toLowerCase();
  const list = rows.filter(r => !ql || [r.name, r.email, r.title, r.loc, r.auth].join(' ').toLowerCase().includes(ql));
  const done = rows.filter(r => r.has).length;
  return html`<div className="stack">
      <${KitStats} items=${[
        { v: rows.length, l: 'Consultants' },
        { v: done, l: 'With an apply profile', tone: done ? 'ok' : '' },
        { v: rows.filter(r => r.pct >= 80).length, l: 'At least 80% complete' },
        { v: rows.reduce((a, r) => a + r.uses, 0), l: 'Autofill uses so far' },
      ]} />
      <div className="toolbar">
        <input type="search" style=${{ maxWidth: 280 }} placeholder="Search name, title, city, visa" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Search" />
        <div className="push"><button type="button" className="btn ghost sm" onClick=${load}><${Icon} n="refresh" />Refresh</button></div>
      </div>
      <p className="muted small" style=${{ margin: 0 }}>Consultants fill their profile under Consultant portal › Apply profile & autofill; the autofill button on their bookmarks bar then types the answers into any application page and attaches their resume. Your own profile is under this portal's menu, if you want to try it.</p>
      <section className="panel" style=${{ padding: '6px 8px' }}>
        ${
          list.length
            ? html`<div className="tblwrap"><table className="tbl click"><thead><tr><th>Consultant</th><th>Title</th><th>Location</th><th>Work authorization</th><th className="r">Rate</th><th>Profile</th><th>Autofill used</th></tr></thead><tbody>
                ${list.map(
                  r => html`<tr key=${r.uid} onClick=${() => (r.has ? setOpen(r) : toast(`${r.name || 'This consultant'} has not filled in an apply profile yet.`))} tabIndex="0">
                      <td><b style=${{ fontWeight: 600 }}>${r.name || r.email}</b><div className="muted small">${r.email}</div></td>
                      <td className="small">${r.title || '—'}</td>
                      <td className="small">${r.loc || '—'}</td>
                      <td className="small">${r.auth || '—'}</td>
                      <td className="r num small">${r.rate ? '$' + r.rate : '—'}</td>
                      <td>${r.has ? html`<div className="actions" style=${{ flexWrap: 'nowrap', gap: 8 }}><div className="bar" style=${{ width: 70 }}><span style=${{ width: r.pct + '%', background: r.pct >= 80 ? 'var(--teal)' : r.pct >= 40 ? 'var(--amber-ink)' : 'var(--red-ink)' }} /></div><span className="small">${r.pct}%</span></div>` : html`<span className="muted small">Not started</span>`}</td>
                      <td className="small">${r.uses ? `${r.uses}× · last ${fmtTs(r.usedAt)}${r.usedOn ? ' on ' + r.usedOn : ''}` : html`<span className="muted">Never</span>`}</td>
                    </tr>`
                )}
              </tbody></table></div>`
            : html`<${Empty} title=${ql ? 'No one matches' : 'No consultants yet'}>Consultants appear here as soon as they have a profile; their apply profile fills in from the resume they upload.<//>`
        }
      </section>
      ${open && html`<${ApplyView} row=${open} onClose=${() => setOpen(null)} />`}
    </div>`;
}
function ApplyView({ row, onClose }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    api('apply_profile_get', { uid: row.uid })
      .then(setD)
      .catch(setErr);
  }, [row.uid]);
  const a = (d && d.apply) || {};
  const copy = async (text, what) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what} copied.`);
    } catch (e) {
      prompt('Copy this', text);
    }
  };
  const allText = APPLY_GROUPS.map(([g, fields]) => `${g}\n` + fields.filter(([k]) => a[k]).map(([k, n]) => `${n}: ${a[k]}`).join('\n')).filter(x => x.includes(':')).join('\n\n');
  return html`<${Modal} wide title=${(row.name || row.email) + ': apply profile'} onClose=${onClose} foot=${html`<button type="button" className="btn ghost" disabled=${!d} onClick=${() => copy(allText, 'Everything')}><${Icon} n="file" />Copy all as text</button><button type="button" className="btn" onClick=${onClose}>Close</button>`}>
      ${err && html`<${LoadError} error=${err} />`}
      ${!d && !err && html`<${Spinner} />`}
      ${
        d &&
        html`<div className="stack">
            <div className="muted small">${a.pct != null ? `${a.pct}% complete` : ''}${a.u ? ` · updated ${fmtTs(a.u)}` : ''}${a.uses ? ` · autofill used ${a.uses} time${a.uses === 1 ? '' : 's'}` : ''}${d.resumes && d.resumes.length ? ` · resume: ${(d.resumes.find(r => r.active) || d.resumes[0]).name}` : ' · no resume uploaded'}</div>
            ${APPLY_GROUPS.map(([g, fields]) => {
              const have = fields.filter(([k]) => a[k]);
              if (!have.length) return null;
              return html`<section key=${g} className="panel stack" style=${{ gap: 6, background: 'var(--surface-2)' }}>
                  <b>${g}</b>
                  <div className="tblwrap"><table className="tbl"><tbody>
                    ${have.map(([k, n]) => html`<tr key=${k}><td className="small muted" style=${{ width: '34%' }}>${n}</td><td style=${{ whiteSpace: 'pre-wrap' }}>${String(a[k])}</td><td className="r" style=${{ width: 44 }}><button type="button" className="btn ghost sm icon" aria-label=${'Copy ' + n} onClick=${() => copy(String(a[k]), n)}><${Icon} n="file" /></button></td></tr>`)}
                  </tbody></table></div>
                </section>`;
            })}
          </div>`
      }
    <//>`;
}
