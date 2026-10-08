/* ================= v39 Phone setup (Admin › System › Phone setup) =================
   The company's own Twilio account (each workspace connects its own): the keys and the TwiML App the browsers call
   through, the company numbers (who each rings, voicemail, recording, texts), who has the phone, recording and
   transcripts, and where calls may go. Routes ph_cfg, ph_cfg_save, ph_connect, ph_numbers, ph_number_save, ph_grant. */
const PH_LANGS = SE_SPEECH_LANGS; // v68: every language Twilio's transcription takes (core.js)

function PhoneSetupPage({ q }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [nums, setNums] = useState(null);
  const [numErr, setNumErr] = useState('');
  const [edit, setEdit] = useState(null);
  // v82: inside a company workspace the phone provider is set up centrally by StratEdge. This page then shows only
  // "who can use the phone" (role management, which stays with the workspace), not the provider wiring.
  const wsMode = typeof wsOn === 'function' && wsOn();
  const load = () =>
    api('ph_cfg', {}).then(
      r => {
        setD(r);
        setErr(null);
      },
      setErr
    );
  const loadNums = () => {
    setNumErr('');
    return api('ph_numbers', {}).then(
      r => setNums(r.numbers),
      e => setNumErr(errText(e))
    );
  };
  useEffect(() => {
    load();
    // v39.1: the administrator gave themselves the phone from the Phone panel
    const f = () => load();
    window.addEventListener('se-phone-grant', f);
    return () => window.removeEventListener('se-phone-grant', f);
  }, []);
  useEffect(() => {
    if (d && !wsMode && d.cfg.provider === 'twilio' && d.cfg.ok && !nums) loadNums();
  }, [d && d.cfg.provider, d && d.cfg.ok]);
  if (err) return html`<${LoadError} error=${err} onRetry=${load} />`;
  if (!d) return html`<${Spinner} label="Loading the phone settings…" />`;
  const c = d.cfg;
  const on = c.numbers.filter(n => n.on);
  const ppl = d.people.filter(p => p.on);
  const put = r => setD(x => ({ ...x, cfg: r.cfg, ready: r.ready }));
  const publicOk = /^https:\/\//.test(d.base) && !/\/\/(localhost|127\.|10\.|192\.168\.)/.test(d.base);
  return html`<div className="stack phadmin">
      <${KitStats} items=${[
        { v: wsMode ? (d.ready ? 'Ready' : 'Set up by StratEdge') : d.ready ? 'Ready' : c.provider === 'twilio' && c.ok ? 'Connected' : 'Needs setup', l: (c.providerLabel || (c.provider === 'vitel' ? 'VitelGlobal' : c.provider === 'custom' ? 'Other phone provider' : 'Twilio')), tone: d.ready ? 'ok' : 'warn' },
        { v: ppl.length, l: ppl.length === 1 ? 'Person with the phone' : 'People with the phone', tone: ppl.length ? 'ok' : 'warn' },
        ...(wsMode ? [] : [
          { v: c.provider === 'twilio' ? on.length : (c.providerFrom ? 1 : 0), l: c.provider === 'twilio' ? (on.length === 1 ? 'Company number on' : 'Company numbers on') : 'Configured company number', tone: (c.provider === 'twilio' ? on.length : c.providerFrom) ? 'ok' : 'warn' },
          { v: c.recOut || on.some(n => n.rec) ? 'On' : 'Off', l: 'Call recording' },
        ]),
      ]} />
      ${
        wsMode &&
        html`<div className="note info" role="note"><span><b>Calling is set up centrally by StratEdge.</b> The phone provider, company numbers, recording and allowed destinations are managed on the StratEdge side${d.ready ? '' : ' (not finished yet)'}. Here you choose which of your people can use the phone.</span></div>`
      }
      ${
        !wsMode && c.provider === 'twilio' && !publicOk &&
        html`<div className="note amber" role="note"><span><b>Twilio can only reach a public https:// address.</b> This portal answers at ${d.base}; calls and texts will not reach it until the site runs on its public https address.</span></div>`
      }
      ${!wsMode && html`<${PhAccount} d=${d} onCfg=${r => {
        put(r);
        if (r.cfg.ok) loadNums();
      }} />`}
      ${!wsMode && c.provider === 'twilio' && html`<${PhCheck} d=${d} auto=${!!(q && q.check)} />`}
      ${
        !wsMode && c.provider === 'twilio' && c.ok &&
        html`<section className="panel">
          <div className="ph-row"><h2 className="ph">Company numbers</h2><button type="button" className="btn ghost sm" onClick=${loadNums}><${Icon} n="refresh" />Check Twilio again</button></div>
          <p className="muted small">The numbers on the Twilio account. A number switched on here sends its calls (and texts, when switched on) to the portal: it rings the people you choose in their browsers, then goes to voicemail. Buy or port numbers in the Twilio console.</p>
          ${numErr && html`<div className="note red" role="alert"><span>${numErr}</span></div>`}
          ${
            !nums
              ? !numErr && html`<${Spinner} label="Asking Twilio for the numbers…" />`
              : nums.length
                ? html`<div className="tblwrap"><table className="tbl phnums">
                    <thead><tr><th>Number</th><th>Can</th><th>In the portal</th><th>Rings</th><th>Recording</th><th></th></tr></thead>
                    <tbody>${nums.map(n => {
                      const p = n.portal;
                      const elsewhere = n.voiceUrl && n.voiceUrl !== d.hooks.voice && !(p && p.on);
                      return html`<tr key=${n.n}>
                        <td><b>${phFmt(n.n)}</b>${n.fn && n.fn !== phFmt(n.n) ? html`<div className="muted small">${n.fn}</div>` : null}${elsewhere ? html`<div className="muted small">Calls now go elsewhere</div>` : null}</td>
                        <td>${n.voice && html`<${Chip}>Calls<//>`} ${n.sms && html`<${Chip}>Texts<//>`}</td>
                        <td>${p && p.on ? html`<${Chip} s="ok">On${p.label ? ' · ' + p.label : ''}<//>${p.sms ? html` <${Chip} s="ok">Texts<//>` : null}` : html`<${Chip}>Off<//>`}</td>
                        <td className="small">${p && p.on ? (p.own ? html`<b>${(d.people.find(x => x.id === p.own) || { n: 'Someone' }).n} only</b> (personal line)` : p.ring && p.ring.length ? p.ring.length + (p.ring.length === 1 ? ' person' : ' people') : 'Everyone with the phone') : '—'}${p && p.on && p.vm !== false ? ', then voicemail' : ''}</td>
                        <td className="small">${p && p.on ? (p.rec ? 'Recorded' : 'No') : '—'}</td>
                        <td className="r"><button type="button" className="btn sm" disabled=${!n.voice} onClick=${() => setEdit(n)}>${p && p.on ? 'Change' : 'Set up'}</button></td>
                      </tr>`;
                    })}</tbody>
                  </table></div>`
                : html`<${Empty} title="No numbers on this Twilio account">Buy a number (or port your company number) in the Twilio console, then check again.<//>`
          }
        </section>`
      }
      <${PhPeople} d=${d} onChange=${load} />
      ${!wsMode && c.provider === 'twilio' && html`<${PhRecording} d=${d} onCfg=${put} />`}
      ${!wsMode && html`<${PhAllowed} d=${d} onCfg=${put} />`}
      ${!wsMode && c.provider === 'twilio' && html`<section className="panel">
        <h2 className="ph">Texting US phones</h2>
        <p className="muted small" style=${{ margin: 0 }}>US carriers block texts from numbers that are not registered: a 10-digit number needs an A2P 10DLC registration (Twilio console › Messaging › Regulatory compliance), a toll-free number needs toll-free verification. Until then Twilio refuses the texts (error 30034) and the portal says so. Replies of STOP, START and HELP are answered by Twilio; the portal does not text a number that replied STOP until it replies START.</p>
      </section>`}
      ${!wsMode && c.provider === 'twilio' && html`<details className="panel phhooks">
        <summary><b>How Twilio reaches the portal</b> <span className="muted small">(set up for you)</span></summary>
        <p className="muted small">Connecting makes a TwiML App named "StratEdge portal phone" for the browser calls; setting up a number points it here. Every request from Twilio is checked against the Auth Token's signature.</p>
        <dl className="phdl">
          <dt>Browser calls (TwiML App)</dt><dd><code>${d.hooks.app}</code></dd>
          <dt>Calls to a number</dt><dd><code>${d.hooks.voice}</code></dd>
          <dt>Texts to a number</dt><dd><code>${d.hooks.sms}</code></dd>
          <dt>Call status</dt><dd><code>${d.hooks.status}</code></dd>
        </dl>
      </details>`}
      ${
        !wsMode && edit &&
        html`<${PhNumberModal} n=${edit} d=${d} onClose=${() => setEdit(null)} onSaved=${r => {
          put(r);
          setEdit(null);
          loadNums();
        }} />`
      }
    </div>`;
}

/* ---- the Twilio account: the keys, then Connect ---- */
function PhAccount({ d, onCfg }) {
  const toast = useToast();
  const c = d.cfg;
  const [provider, setProvider] = useState(c.provider || 'twilio');
  const [f, setF] = useState({
    sid:c.sid,keySid:c.keySid,keySecret:'',token:'',providerLabel:c.providerLabel||'',providerBase:c.providerBase||'',providerCallPath:c.providerCallPath||'',providerSmsPath:c.providerSmsPath||'',providerFrom:c.providerFrom||'',providerKey:'',
    vitelUsername:c.vitelUsername||'',vitelPassword:'',vitelDomain:c.vitelDomain||'billing',vitelExtension:c.vitelExtension||'',vitelLine:c.vitelLine||'All'
  });
  const [busy,setBusy]=useState(false); const[msg,setMsg]=useState(''); const[open,setOpen]=useState(!c.ok||provider!=='twilio');
  const set=k=>e=>setF(x=>({...x,[k]:e.target.value}));
  const choose=async e=>{const v=e.target.value;setProvider(v);setOpen(true);try{onCfg(await api('ph_cfg_save',{provider:v}));toast('Phone provider changed.')}catch(err){toast(errText(err),true)}};
  const connect=async()=>{setBusy(true);setMsg('');try{
    if(provider==='vitel'){
      const patch={provider:'vitel',providerLabel:f.providerLabel||'VitelGlobal',providerFrom:f.providerFrom.trim(),vitelUsername:f.vitelUsername.trim(),vitelDomain:f.vitelDomain.trim()||'billing',vitelExtension:f.vitelExtension.trim(),vitelLine:f.vitelLine.trim()||'All'};
      if(f.vitelPassword)patch.vitelPassword=f.vitelPassword;
      const r=await api('ph_cfg_save',patch);onCfg(r);setF(x=>({...x,vitelPassword:''}));toast('VitelGlobal settings saved.');
    } else if(provider==='custom'){
      const patch={provider,providerLabel:f.providerLabel,providerBase:f.providerBase.trim(),providerCallPath:f.providerCallPath.trim(),providerSmsPath:f.providerSmsPath.trim(),providerFrom:f.providerFrom.trim()};if(f.providerKey)patch.providerKey=f.providerKey;
      const r=await api('ph_cfg_save',patch);onCfg(r);setF(x=>({...x,providerKey:''}));toast('Phone provider settings saved.');
    } else {
      const patch={provider:'twilio'};if(f.sid!==c.sid)patch.sid=f.sid.trim();if(f.keySid!==c.keySid)patch.keySid=f.keySid.trim();if(f.keySecret)patch.keySecret=f.keySecret.trim();if(f.token)patch.token=f.token.trim();if(Object.keys(patch).length)onCfg(await api('ph_cfg_save',patch));const r=await api('ph_connect',{});onCfg(r);setF(x=>({...x,keySecret:'',token:''}));setOpen(false);toast('Connected to Twilio.');
    }
  }catch(e){setMsg(errText(e))}setBusy(false)};
  const vitelCheck=async()=>{setBusy(true);setMsg('');try{const r=await api('ph_vitel_check',{}, {timeout:60000});toast(`${r.message}${r.rows?` ${r.rows} call row${r.rows===1?'':'s'} today.`:''}`)}catch(e){setMsg(errText(e))}setBusy(false)};
  const vitelSync=async()=>{setBusy(true);setMsg('');try{const r=await api('ph_vitel_sync',{days:7},{timeout:90000});toast(`VitelGlobal call reports synced: ${r.added||0} new, ${r.updated||0} updated.`)}catch(e){setMsg(errText(e))}setBusy(false)};
  const [testTo,setTestTo]=useState('');
  const vitelTest=async()=>{if(!testTo.trim())return;setBusy(true);setMsg('');try{const r=await api('ph_vitel_testcall',{to:testTo.trim()},{timeout:60000});toast(r.message||'Test call requested.')}catch(e){setMsg(errText(e))}setBusy(false)};
  return html`<section className="panel">
    <div className="ph-row"><div><h2 className="ph">Phone provider</h2><p className="muted small" style=${{margin:0}}>Choose which provider handles company calling and texting.</p></div><select value=${provider} onChange=${choose} aria-label="Phone provider"><option value="twilio">Twilio</option><option value="vitel">VitelGlobal</option><option value="custom">Other REST provider</option></select></div>
    ${provider==='twilio'?html`<div className="stack" style=${{gap:12}}><div className="ph-row"><h3 className="ph" style=${{margin:0}}>Twilio account</h3>${c.ok&&!open&&html`<button type="button" className="btn ghost sm" onClick=${()=>setOpen(true)}>Change the keys</button>`}</div>${c.ok&&!open?html`<p className="muted small" style=${{margin:0}}>Connected${c.acct?' to '+c.acct:''} (${c.sid.slice(0,6)}…${c.sid.slice(-4)}) on ${fmtTs(c.okAt)}. Calls and texts are billed by Twilio.</p>`:html`<div className="form"><p className="muted small" style=${{margin:0}}>Use the company’s Twilio Account SID, Auth Token and Standard API key. Secrets stay encrypted on this server.</p><div className="row2"><${Field} label="Account SID"><input value=${f.sid} onInput=${set('sid')} placeholder="AC…" autoComplete="off"/><//><${Field} label="Auth Token" hint=${c.hasToken?'Saved; enter only to replace it.':''}><input type="password" value=${f.token} onInput=${set('token')} placeholder=${c.hasToken?'•••••••• (saved)':''}/><//></div><div className="row2"><${Field} label="API key SID"><input value=${f.keySid} onInput=${set('keySid')} placeholder="SK…"/><//><${Field} label="API key secret" hint=${c.hasSecret?'Saved; enter only to replace it.':''}><input type="password" value=${f.keySecret} onInput=${set('keySecret')} placeholder=${c.hasSecret?'•••••••• (saved)':''}/><//></div>${msg&&html`<div className="note red"><span>${msg}</span></div>`}<div className="actions"><button type="button" className="btn" disabled=${busy||!f.sid||!f.keySid||(!f.keySecret&&!c.hasSecret)||(!f.token&&!c.hasToken)} onClick=${connect}>${busy?'Connecting…':c.ok?'Save and connect again':'Connect'}</button>${c.ok&&html`<button type="button" className="btn ghost" onClick=${()=>setOpen(false)}>Cancel</button>`}</div></div>`}</div>`:
    provider==='vitel'?html`<div className="form" style=${{marginTop:12}}><div className="note info"><span><b>Native VitelGlobal adapter.</b> StratEdge uses the documented HTTPS billing endpoints for click-to-call, SMS and XML call reports. The password is encrypted on this server and is never sent to the browser after saving.</span></div><div className="row2"><${Field} label="VitelGlobal username"><input value=${f.vitelUsername} onInput=${set('vitelUsername')} autoComplete="off" placeholder="Account username"/><//><${Field} label="Password" hint=${c.hasVitelPassword?'Saved encrypted; enter only to replace it.':''}><input type="password" value=${f.vitelPassword} onInput=${set('vitelPassword')} placeholder=${c.hasVitelPassword?'•••••••• (saved)':'VitelGlobal password'}/><//></div><div className="row2"><${Field} label="Extension / source for click-to-call"><input value=${f.vitelExtension} onInput=${set('vitelExtension')} placeholder="Extension"/><//><${Field} label="Company/from number for SMS"><input value=${f.providerFrom} onInput=${set('providerFrom')} placeholder="+1…"/><//></div><div className="row2"><${Field} label="Call report line"><input value=${f.vitelLine} onInput=${set('vitelLine')} placeholder="All or extension"/><//><${Field} label="Domain"><input value=${f.vitelDomain} onInput=${set('vitelDomain')} placeholder="billing"/><//></div><${Field} label="Display name"><input value=${f.providerLabel} onInput=${set('providerLabel')} placeholder="VitelGlobal"/><//><div className="note"><span><b>Fixed HTTPS endpoints:</b> Call reports <code>/vitelglobal_callrecords.php</code> · SMS <code>/vitelsms.php</code> · Click-to-call <code>/clicktocall/index.php</code></span></div>${msg&&html`<div className="note red"><span>${msg}</span></div>`}<div className="actions"><button className="btn" disabled=${busy||!f.vitelUsername.trim()||(!f.vitelPassword&&!c.hasVitelPassword)||!f.vitelExtension.trim()||!f.providerFrom.trim()} onClick=${connect}>${busy?'Saving…':'Save VitelGlobal'}</button><button className="btn ghost" disabled=${busy||!c.vitelUsername||!c.hasVitelPassword} onClick=${vitelCheck}>Test call-report API</button><button className="btn ghost" disabled=${busy||!c.vitelUsername||!c.hasVitelPassword} onClick=${vitelSync}><${Icon} n="refresh"/>Sync last 7 days</button></div>${c.vitelUsername&&c.hasVitelPassword&&c.vitelExtension?html`<div className="note"><span><b>Place a test call.</b> VitelGlobal rings your extension (${c.vitelExtension}); when you answer, it connects you to the number below. Use your own mobile to confirm calling works from the portal.</span></div><div className="row2"><${Field} label="Ring this number for the test"><input value=${testTo} onInput=${e=>setTestTo(e.target.value)} placeholder="+1 your mobile" autoComplete="off"/><//><div style=${{display:'flex',alignItems:'flex-end'}}><button className="btn" disabled=${busy||!testTo.trim()} onClick=${vitelTest}><${Icon} n="phone"/>${busy?'Calling…':'Place test call'}</button></div></div>`:''}</div>`:
    html`<div className="form" style=${{marginTop:12}}><div className="note info"><span><b>Other REST provider.</b> Enter the public HTTPS REST endpoints and Bearer/API key exactly as supplied in your provider documentation.</span></div><div className="row2"><${Field} label="Display name"><input value=${f.providerLabel} onInput=${set('providerLabel')} placeholder="Phone provider"/><//><${Field} label="Company/from number"><input value=${f.providerFrom} onInput=${set('providerFrom')} placeholder="+1…"/><//></div><${Field} label="API base address"><input value=${f.providerBase} onInput=${set('providerBase')} placeholder="https://api.provider.example/v1"/><//><div className="row2"><${Field} label="Call endpoint/path"><input value=${f.providerCallPath} onInput=${set('providerCallPath')} placeholder="/calls"/><//><${Field} label="SMS endpoint/path"><input value=${f.providerSmsPath} onInput=${set('providerSmsPath')} placeholder="/messages"/><//></div><${Field} label="API key" hint=${c.hasProviderKey?'Saved encrypted; enter only to replace it.':'Bearer/API key from the provider'}><input type="password" value=${f.providerKey} onInput=${set('providerKey')} placeholder=${c.hasProviderKey?'•••••••• (saved)':''}/><//>${msg&&html`<div className="note red"><span>${msg}</span></div>`}<div className="actions"><button type="button" className="btn" disabled=${busy||!f.providerBase.trim()||!f.providerFrom.trim()||(!f.providerKey&&!c.hasProviderKey)||(!f.providerCallPath.trim()&&!f.providerSmsPath.trim())} onClick=${connect}>${busy?'Saving…':'Save provider settings'}</button></div></div>`}
  </section>`;
}

/* ---- one company number: on or off, its name, who it rings, voicemail, recording, texts ---- */
function PhNumberModal({ n, d, onClose, onSaved }) {
  const p = n.portal || {};
  const [f, setF] = useState({
    on: p.on === undefined ? true : !!p.on,
    label: p.label || '',
    mode: p.own ? 'own' : p.ring && p.ring.length ? 'some' : 'all', // v39.2: shared (everyone / chosen) or one person only
    own: p.own || '',
    ring: p.own ? [] : p.ring || [],
    secs: p.secs || 25,
    vm: p.vm !== false,
    greet: p.greet || '',
    rec: !!p.rec,
    sms: p.sms === undefined ? !!n.sms : !!p.sms && !!n.sms,
    lang: p.lang || '', // v68
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const people = d.people.filter(x => x.on || f.ring.includes(x.id));
  const save = async () => {
    setBusy(true);
    setMsg('');
    try {
      onSaved(await api('ph_number_save', { n: n.n, sid: n.sid, on: f.on, label: f.label, ring: f.mode === 'some' ? f.ring : f.mode === 'own' ? [f.own] : [], own: f.mode === 'own' ? f.own : '', secs: +f.secs || 25, vm: f.vm, greet: f.greet, rec: f.rec, sms: f.sms && n.sms, lang: f.lang }));
    } catch (e) {
      setMsg(errText(e));
      setBusy(false);
    }
  };
  const elsewhere = n.voiceUrl && n.voiceUrl !== d.hooks.voice;
  return html`<${Modal} title=${'Company number ' + phFmt(n.n)} onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Cancel</button><button type="button" className="btn" disabled=${busy || (f.on && ((f.mode === 'some' && !f.ring.length) || (f.mode === 'own' && !f.own)))} onClick=${save}>${busy ? 'Saving…' : 'Save'}</button>`}>
      <div className="form">
        <label className="check"><input type="checkbox" checked=${f.on} onChange=${e => set('on', e.target.checked)} /><span><b>Use this number in the portal</b><br /><span className="muted small">Calls to it ring in the portal; people can call and text from it.</span></span></label>
        ${elsewhere && f.on && html`<div className="note amber"><span>Calls to this number now go to ${n.voiceUrl}. Saving sends them to the portal instead.</span></div>`}
        ${
          f.on &&
          html`<${Fragment}>
            <${Field} label="Name" hint="Shown to the person answering, e.g. Main line, Recruiting, Sales"><input value=${f.label} maxLength="60" onInput=${e => set('label', e.target.value)} /><//>
            <div className="fld"><span>Who uses it</span>
              <label className="check"><input type="radio" name="phring" checked=${f.mode === 'all'} onChange=${() => set('mode', 'all')} /><span>Shared: it rings everyone with the phone who is taking calls</span></label>
              <label className="check"><input type="radio" name="phring" checked=${f.mode === 'some'} onChange=${() => set('mode', 'some')} /><span>Shared: it rings only these people</span></label>
              ${
                f.mode === 'some' &&
                (people.length
                  ? html`<div className="phpick">${people.map(x => html`<label key=${x.id} className="check small"><input type="checkbox" checked=${f.ring.includes(x.id)} onChange=${e => set('ring', e.target.checked ? [...f.ring, x.id] : f.ring.filter(y => y !== x.id))} /><span>${x.n}${!x.on ? html` <span className="muted">(phone off)</span>` : null}</span></label>`)}</div>`
                  : html`<p className="muted small">Switch the phone on for people first (People with the phone).</p>`)
              }
              <label className="check"><input type="radio" name="phring" checked=${f.mode === 'own'} onChange=${() => set('mode', 'own')} /><span><b>One person only (a personal line)</b><br /><span className="muted small">Only this person gets its calls, voicemails and texts, and only they call and text from it.</span></span></label>
              ${
                f.mode === 'own' &&
                html`<select className="phown" aria-label="The person whose line it is" value=${f.own} onChange=${e => set('own', e.target.value)}>
                  <option value="">Choose a person with the phone…</option>
                  ${d.people.filter(x => x.on || x.id === f.own).map(x => {
                    const has = d.cfg.numbers.filter(m => m.on && m.own === x.id && m.n !== n.n).map(m => phFmt(m.n));
                    return html`<option key=${x.id} value=${x.id}>${x.n}${has.length ? ' (already has ' + has.join(', ') + ')' : ''}</option>`;
                  })}
                </select>`
              }
              <small>${f.mode === 'own' ? 'Shared numbers stay shared; a person can also have a personal line and use the shared numbers.' : 'Up to 10 browsers ring at once; the first to answer takes the call.'}</small>
            </div>
            <div className="row2">
              <${Field} label="Ring for (seconds)"><input type="number" min="5" max="60" value=${f.secs} onInput=${e => set('secs', e.target.value)} /><//>
              <div className="fld"><span>When nobody answers</span><label className="check"><input type="checkbox" checked=${f.vm} onChange=${e => set('vm', e.target.checked)} /><span>Voicemail (an email goes to the people it rings)</span></label></div>
            </div>
            ${f.vm && html`<${Field} label="Voicemail greeting" hint="Read out by Twilio's voice. Empty: “Sorry we missed your call. Please leave your name, number and a short message after the tone.”"><textarea rows="2" maxLength="400" value=${f.greet} onInput=${e => set('greet', e.target.value)} /><//>`}
            ${d.cfg.tx && html`<${Field} label="Language callers speak" hint="Calls and voicemails on this number are transcribed in this language."><select value=${f.lang} onChange=${e => set('lang', e.target.value)} aria-label="Number language"><option value="">The account's default (${seSpeechLangName(d.cfg.lang)})</option>${PH_LANGS.map(([k, l]) => html`<option key=${k} value=${k}>${l}</option>`)}</select><//>`}
            <label className="check"><input type="checkbox" checked=${f.rec} onChange=${e => set('rec', e.target.checked)} /><span><b>Record calls to this number</b><br /><span className="muted small">Callers first hear the notice set under Recording (“${d.cfg.notice}”).${d.cfg.tx ? ' Recorded calls are transcribed.' : ''}</span></span></label>
            <label className="check"><input type="checkbox" checked=${f.sms && n.sms} disabled=${!n.sms} onChange=${e => set('sms', e.target.checked)} /><span><b>Texts</b><br /><span className="muted small">${n.sms ? 'Texts to this number come into the portal, and people can text from it. US phones need the number registered for texting (see Texting US phones).' : 'This number cannot send texts (Twilio).'}</span></span></label>
          <//>`
        }
        ${msg && html`<div className="note red" role="alert"><span>${msg}</span></div>`}
      </div>
    <//>`;
}

/* ---- who has the phone (the same switch as Roles & access › Phone & texts) ---- */
function PhPeople({ d, onChange }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');
  const set = async (p, on) => {
    setBusy(p.id);
    try {
      await api('ph_grant', { uid: p.id, on });
      const line = d.cfg.numbers.filter(m => m.on && m.own === p.id).map(m => phFmt(m.n)); // v39.2
      toast(`Phone ${on ? 'switched on' : 'switched off'} for ${p.n}.${!on && line.length ? ' Calls to their personal line (' + line.join(', ') + ') now go to voicemail.' : ''}`);
      await onChange();
      if (p.id === Cap.uid) reloadCaps();
      if (on) setQ('');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const have = d.people.filter(p => p.on);
  const self = d.people.find(p => p.id === Cap.uid); // v39.1: the administrator's own phone, one click
  const needle = q.trim().toLowerCase();
  const found = needle ? d.people.filter(p => !p.on && (p.n + ' ' + p.e).toLowerCase().includes(needle)).slice(0, 8) : [];
  return html`<section className="panel">
      <h2 className="ph">People with the phone</h2>
      <p className="muted small">${d.cfg.provider === 'twilio' ? 'They see a Phone button at the top of the portal: they call from the browser with a company number, take calls to the numbers that ring them, and text. Each person can pause taking calls.' : `They see a Phone button at the top of the portal for ${d.cfg.providerLabel || (d.cfg.provider === 'vitel' ? 'VitelGlobal' : 'the selected provider')} outbound calls and texts. Calls use the configured extension/phone rather than registering the browser for inbound calls.`} Administrators are not included automatically. The same switch is under Roles & access › Phone & texts.</p>
      ${self && !self.on && html`<div className="note amber phself" role="note"><span><b>You don't have the phone yourself yet.</b> The Phone button at the top shows the steps; with the phone, Call and Text show on candidates, consultants and contacts.</span><div className="actions"><button type="button" className="btn sm" disabled=${busy === self.id} onClick=${() => set(self, true)}>Give me the phone</button></div></div>`}
      ${
        have.length
          ? html`<div className="tblwrap"><table className="tbl">
              <thead><tr><th>Person</th><th>${d.cfg.provider === 'twilio' ? 'Taking calls' : 'Phone access'}</th><th>${d.cfg.provider === 'twilio' ? 'Personal line' : 'Provider line'}</th><th></th></tr></thead>
              <tbody>${have.map(
                p => html`<tr key=${p.id}>
                  <td><b>${p.n}</b><div className="muted small">${p.e}${p.admin ? ' · Administrator' : ''}</div></td>
                  <td className="small">${d.cfg.provider === 'twilio' ? (p.avail ? 'Yes' : html`<span className="muted">Paused by them</span>`) : 'Enabled'}</td>
                  <td className="small">${d.cfg.provider === 'twilio' ? (d.cfg.numbers.filter(m => m.on && m.own === p.id).map(m => phFmt(m.n)).join(', ') || html`<span className="muted">—</span>`) : (d.cfg.providerFrom ? phFmt(d.cfg.providerFrom) : html`<span className="muted">—</span>`)}</td>
                  <td className="r"><button type="button" className="btn ghost sm" disabled=${busy === p.id} onClick=${() => set(p, false)}>Switch off</button></td>
                </tr>`
              )}</tbody>
            </table></div>`
          : html`<p className="small" style=${{ margin: 0 }}>Nobody has the phone yet.</p>`
      }
      <div className="phpeople-add">
        <input type="search" placeholder="Give the phone to… (name or email)" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Find a person to give the phone to" />
        ${
          needle &&
          (found.length
            ? html`<ul>${found.map(p => html`<li key=${p.id}><span><b>${p.n}</b> <span className="muted small">${p.e}${p.admin ? ' · Administrator' : ''}</span></span><button type="button" className="btn sm" disabled=${busy === p.id} onClick=${() => set(p, true)}>Switch on</button></li>`)}</ul>`
            : html`<p className="muted small" style=${{ margin: 0 }}>Nobody else matches (client contacts and outside members cannot have the company phone).</p>`)
        }
      </div>
    </section>`;
}

/* ---- v39.1: "Check the setup": every part Twilio needs, and Twilio's recent errors in plain words ---- */
function PhCheck({ d, auto }) {
  const [r, setR] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const run = async () => {
    setBusy(true);
    setErr('');
    try {
      setR(await api('ph_check', {}, { timeout: 120000 }));
    } catch (e) {
      setErr(errText(e));
    }
    setBusy(false);
  };
  useEffect(() => {
    if (auto && d.cfg.sid) run();
  }, []);
  if (!d.cfg.sid) return null;
  const severity = x => x.sev || (x.ok === true ? 'ok' : x.ok === false ? 'fix' : 'info');
  const bad = r ? r.checks.filter(x => severity(x) === 'fix').length : 0;
  const improve = r ? r.checks.filter(x => severity(x) === 'improve').length : 0;
  return html`<section className="panel phcheck">
      <div className="ph-row"><h2 className="ph">Check the setup</h2><button type="button" className="btn sm" disabled=${busy} onClick=${run}><${Icon} n="check" />${busy ? 'Checking…' : r ? 'Check again' : 'Check the setup'}</button></div>
      <p className="muted small">Asks Twilio about the account, the Auth Token, the TwiML App, the numbers and the geo permissions, sends the portal's call address a signed test like Twilio's, and lists Twilio's errors from the last 7 days in plain words. Use it when calls end at once (for example "ConnectionError (31005)").</p>
      ${busy && html`<${Spinner} label="Asking Twilio…" />`}
      ${err && html`<div className="note red" role="alert"><span>${err}</span></div>`}
      ${r && html`<div className=${'note ' + (bad ? 'red' : improve ? 'amber' : 'ok')} role="status"><span><b>${bad ? (bad === 1 ? 'One thing to fix.' : bad + ' things to fix.') : improve ? 'Everything required is configured.' : 'Everything checked is right.'}</b> ${bad ? 'Each required fix is explained below.' : improve ? (improve === 1 ? 'There is 1 improvement available below.' : 'There are ' + improve + ' improvements available below.') : 'If calls still fail, Twilio\'s errors below say why.'}</span></div>`}
      ${
        r &&
        html`<ul className="phchecks">${r.checks.map(x => {
          const sev = severity(x);
          return html`<li key=${x.k} className=${sev === 'ok' ? 'ok' : sev === 'fix' ? 'bad' : 'unk'}>
            <span className="phcheck-ico" aria-label=${sev === 'ok' ? 'Right' : sev === 'fix' ? 'To fix' : sev === 'improve' ? 'Improve' : 'Not sure'}><${Icon} n=${sev === 'ok' ? 'check' : sev === 'fix' ? 'x' : 'help'} /></span>
            <span className="phcheck-t"><b>${x.t}</b>${sev === 'improve' && html` <${Chip} s="amber">Improve<//>`}<span className="small">${x.d}</span>${x.fix && html`<span className="small phfix"><b>${sev === 'improve' ? 'Improve:' : 'Fix:'}</b> ${x.fix}</span>`}</span>
          </li>`;
        })}</ul>`
      }
      ${
        r &&
        html`<div className="phalerts">
          <h3>Twilio's errors, last 7 days</h3>
          ${
            r.alerts.length
              ? html`<ul className="small">${r.alerts.map(a => html`<li key=${a.at + ':' + a.code}><b>${fmtTs(a.at)} · error ${a.code}</b>${a.words ? ' — ' + a.words : ''}${a.fix && html` <span className="muted">${a.fix}</span>`}${a.text && html`<div className="muted">Twilio: ${a.text}</div>`}</li>`)}</ul>`
              : html`<p className="small muted" style=${{ margin: 0 }}>${r.alertsErr ? "Twilio's error log could not be read: " + r.alertsErr : 'None.'}</p>`
          }
        </div>`
      }
    </section>`;
}

/* ---- recording, transcripts, summaries, voicemail alerts ---- */
function PhRecording({ d, onCfg }) {
  const toast = useToast();
  const c = d.cfg;
  const [f, setF] = useState({ recOut: c.recOut, notice: c.notice, tx: c.tx, lang: c.lang, sum: c.sum, keepDays: c.keepDays, vmMail: c.vmMail });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const dirty = Object.keys(f).some(k => f[k] !== c[k]);
  const save = async () => {
    setBusy(true);
    try {
      onCfg(await api('ph_cfg_save', { ...f, keepDays: +f.keepDays || 0 }));
      toast('Saved.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<section className="panel">
      <h2 className="ph">Recording, transcripts and summaries</h2>
      <div className="form">
        <label className="check"><input type="checkbox" checked=${f.recOut} onChange=${e => set('recOut', e.target.checked)} /><span><b>Record calls made from the portal</b><br /><span className="muted small">Both sides are recorded once the person called answers and has heard the notice. Calls to company numbers are recorded per number.</span></span></label>
        <${Field} label="Notice played before recording" hint="Recording laws differ by state and country: in several US states and in many countries everyone on the call must know. The notice is played before anything is recorded."><input value=${f.notice} maxLength="300" onInput=${e => set('notice', e.target.value)} /><//>
        <div className="row2">
          <label className="check"><input type="checkbox" checked=${f.tx} onChange=${e => set('tx', e.target.checked)} /><span><b>Transcripts</b><br /><span className="muted small">Recorded calls and voicemails are written out as they happen (Twilio's real-time transcription, billed by Twilio).</span></span></label>
          <${Field} label="Language spoken (default)" hint="Auto-detect transcribes whatever language is spoken (English, Spanish, Hindi, French, German, Portuguese, Italian, Dutch, Russian, Japanese and more: Twilio's multi-language model) and the transcript names the language of each part. Pick one language only when callers speak one that auto-detection does not cover (Tamil, Telugu, Arabic…). Each number can have its own, and the dialer offers one per call."><select value=${f.lang} onChange=${e => set('lang', e.target.value)} disabled=${!f.tx} aria-label="Transcription language">${PH_LANGS.map(([k, l]) => html`<option key=${k} value=${k}>${l}</option>`)}</select><//>
        </div>
        <label className="check"><input type="checkbox" checked=${f.sum} disabled=${!f.tx} onChange=${e => set('sum', e.target.checked)} /><span><b>AI summary and next steps</b><br /><span className="muted small">${d.ai ? 'Written by StratEdge AI from the transcript when the call ends: what was said, the next steps, and facts like rate, availability and work authorization.' : 'StratEdge AI is not set up (Admin › Website & messages › Assistant): summaries are written once it is.'}</span></span></label>
        <div className="row2">
          <${Field} label="Keep recordings for (days)" hint="0 keeps them until someone deletes them. Older recordings are deleted from Twilio each night; transcripts and notes stay."><input type="number" min="0" max="3650" value=${f.keepDays} onInput=${e => set('keepDays', e.target.value === '' ? '' : +e.target.value)} /><//>
          <div className="fld"><span>Voicemail alerts</span><label className="check"><input type="checkbox" checked=${f.vmMail} onChange=${e => set('vmMail', e.target.checked)} /><span>Email the people a number rings when a voicemail is left</span></label></div>
        </div>
        <div className="actions"><button type="button" className="btn" disabled=${busy || !dirty} onClick=${save}>Save</button></div>
      </div>
    </section>`;
}

/* ---- where calls and texts may go, emergency numbers, limits ---- */
function PhAllowed({ d, onCfg }) {
  const toast = useToast();
  const c = d.cfg;
  const [f, setF] = useState({ dest: c.dest, cc: c.cc, region: c.region, e911: c.e911, perHour: c.perHour, smsPerHour: c.smsPerHour });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const dirty = JSON.stringify(f) !== JSON.stringify({ dest: c.dest, cc: c.cc, region: c.region, e911: c.e911, perHour: c.perHour, smsPerHour: c.smsPerHour });
  const dest = (k, on) => set('dest', on ? [...new Set([...f.dest, k])] : f.dest.filter(x => x !== k));
  const save = async () => {
    setBusy(true);
    try {
      onCfg(await api('ph_cfg_save', { ...f, perHour: +f.perHour || 120, smsPerHour: +f.smsPerHour || 200 }));
      toast('Saved.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<section className="panel">
      <h2 className="ph">Calls and texts allowed</h2>
      <div className="form">
        <div className="fld"><span>People may call and text</span>
          <label className="check"><input type="checkbox" checked=${f.dest.includes('nanp')} onChange=${e => dest('nanp', e.target.checked)} /><span>The US and Canada</span></label>
          <label className="check"><input type="checkbox" checked=${f.dest.includes('in')} onChange=${e => dest('in', e.target.checked)} /><span>India (+91)</span></label>
          <label className="check"><input type="checkbox" checked=${f.dest.includes('other')} onChange=${e => dest('other', e.target.checked)} /><span>Other countries, by country code</span></label>
          ${f.dest.includes('other') && html`<input value=${f.cc} placeholder="e.g. 44, 61, 1876" onInput=${e => set('cc', e.target.value)} aria-label="Country codes allowed" />`}
          <small>The Caribbean countries that share +1 count as other countries (add 1 and the area code, e.g. 1876). Premium numbers (900, 976) are never called. Twilio's own Geographic Permissions apply as well.</small>
        </div>
        <div className="row2">
          <${Field} label="Numbers written without a country code are" hint="How a number like (555) 201-3344 or 98765 43210 is read"><select value=${f.region} onChange=${e => set('region', e.target.value)}><option value="US">US or Canada numbers</option><option value="IN">Indian numbers</option></select><//>
          <${Field} label="Emergency numbers (911, 112…)"><select value=${f.e911} onChange=${e => set('e911', e.target.value)}><option value="block">Blocked: use a mobile or desk phone</option><option value="allow">Allowed</option></select><//>
        </div>
        ${f.e911 === 'allow' && html`<div className="note amber"><span>Calls from a browser cannot give emergency services a reliable location. Allow them only if every company number has its emergency address registered in Twilio and people know to give their location.</span></div>`}
        <div className="row2">
          <${Field} label="Calls per person per hour"><input type="number" min="5" max="1000" value=${f.perHour} onInput=${e => set('perHour', e.target.value)} /><//>
          <${Field} label="Texts per person per hour"><input type="number" min="5" max="2000" value=${f.smsPerHour} onInput=${e => set('smsPerHour', e.target.value)} /><//>
        </div>
        <div className="actions"><button type="button" className="btn" disabled=${busy || !dirty || !f.dest.length} onClick=${save}>Save</button></div>
      </div>
    </section>`;
}
