/* ================= v34: sign-in security for everyone =================
   The second step at sign-in (authenticator app, passkey, email code, backup code), setting one up, signing in with a
   passkey alone, forgotten passwords and invitation links, "Sign-in & security" (methods, sessions, devices, recent
   sign-ins, password), the forced password change, the notices in the portal, the policies to accept, and the public
   security page with the vulnerability report form. The server side is api/auth.php, api/sessions.php, api/gov.php. */

/* ---- passkeys (WebAuthn): the server speaks base64url JSON, the browser ArrayBuffers ---- */
const b64uToBuf = s => {
  const b = atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4));
  const a = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
  return a.buffer;
};
const bufToB64u = buf => {
  const a = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const pkSupported = () => !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create);
async function pkCreate(o) {
  const cred = await navigator.credentials.create({
    publicKey: {
      ...o,
      challenge: b64uToBuf(o.challenge),
      user: { ...o.user, id: b64uToBuf(o.user.id) },
      excludeCredentials: (o.excludeCredentials || []).map(c => ({ ...c, id: b64uToBuf(c.id) })),
    },
  });
  return {
    id: cred.id,
    rawId: bufToB64u(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: bufToB64u(cred.response.clientDataJSON),
      attestationObject: bufToB64u(cred.response.attestationObject),
      transports: cred.response.getTransports ? cred.response.getTransports() : [],
    },
  };
}
async function pkGet(o) {
  const cred = await navigator.credentials.get({
    publicKey: { ...o, challenge: b64uToBuf(o.challenge), allowCredentials: (o.allowCredentials || []).map(c => ({ ...c, id: b64uToBuf(c.id) })) },
  });
  return {
    id: cred.id,
    rawId: bufToB64u(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: bufToB64u(cred.response.clientDataJSON),
      authenticatorData: bufToB64u(cred.response.authenticatorData),
      signature: bufToB64u(cred.response.signature),
      userHandle: cred.response.userHandle ? bufToB64u(cred.response.userHandle) : '',
    },
  };
}
const pkErr = e =>
  e && e.name === 'NotAllowedError'
    ? 'The passkey request was cancelled or timed out.'
    : e && e.name === 'InvalidStateError'
      ? 'This device already has a passkey for your account.'
      : e && e.name === 'SecurityError'
        ? 'Passkeys need the site’s address (https) in the address bar.'
        : errText(e);

/* ---- the QR code for authenticator apps (js/vendor/qrcode.min.js, MIT, loaded only here) ---- */
let qrLoad = null;
function loadQr() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  if (!qrLoad)
    qrLoad = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'js/vendor/qrcode.min.js?v=' + (typeof APP_BUILD === 'string' ? APP_BUILD : '');
      s.onload = () => (window.qrcode ? res(window.qrcode) : rej(new Error('qr')));
      s.onerror = () => {
        qrLoad = null;
        rej(new Error('qr'));
      };
      document.head.appendChild(s);
    });
  return qrLoad;
}
function QrImg({ text, size }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let on = true;
    loadQr()
      .then(q => {
        const c = q(0, 'M');
        c.addData(text);
        c.make();
        if (on) setSrc(c.createDataURL(5, 10));
      })
      .catch(() => {});
    return () => (on = false);
  }, [text]);
  return src ? html`<img className="qrimg" src=${src} alt="QR code for your authenticator app" width=${size || 200} height=${size || 200} />` : html`<div className="qrimg ph"><${Spinner} label="Drawing the code…" /></div>`;
}

/* ---- backup codes: shown once, copy or download ---- */
function BackupCodes({ codes, onDone, doneLabel }) {
  const toast = useToast();
  const [kept, setKept] = useState(false);
  const text = 'StratEdge backup codes (each works once)\n' + new Date().toLocaleString() + '\n\n' + codes.join('\n') + '\n';
  const save = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = 'stratedge-backup-codes.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    setKept(true);
  };
  return html`<div className="stack" style=${{ gap: 12 }}>
      <p className="note ok" style=${{ margin: 0 }}><span><b>Save your backup codes.</b> If you lose your phone or passkey, each code signs you in once. This is the only time they are shown.</span></p>
      <ol className="codes">${codes.map(c => html`<li key=${c}><code>${c}</code></li>`)}</ol>
      <div className="actions">
        <button type="button" className="btn ghost sm" onClick=${() => {
          navigator.clipboard && navigator.clipboard.writeText(text).then(() => {
            toast('Copied. Keep them somewhere safe, offline.');
            setKept(true);
          });
        }}>Copy</button>
        <button type="button" className="btn ghost sm" onClick=${save}>Download</button>
      </div>
      ${onDone && html`<label className="check"><input type="checkbox" checked=${kept} onChange=${e => setKept(e.target.checked)} /><span>I saved these codes somewhere safe</span></label>
        <button type="button" className="btn" disabled=${!kept} onClick=${onDone}>${doneLabel || 'Continue'}</button>`}
    </div>`;
}

/* ---- the second step at sign-in ---- */
const MFA_NAMES = { passkey: 'Passkey', totp: 'Authenticator app', email: 'Email code', backup: 'Backup code' };
function MfaStep({ info, onDone, onCancel }) {
  // strongest first: passkey, authenticator app, email code, backup code
  const ORDER = ['passkey', 'totp', 'email', 'backup'];
  const methods = (info.methods || []).filter(m => m !== 'passkey' || pkSupported()).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  const first = methods.includes('passkey') ? 'passkey' : methods[0] || 'totp';
  const [m, setM] = useState(first);
  const [code, setCode] = useState('');
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState('');
  const [help, setHelp] = useState(false);
  const done = r => {
    setBusy(false);
    onDone(r);
  };
  const fail = x => {
    setBusy(false);
    if (x && x.code === 'mfa_restart') onCancel(x.message);
    else setErr(x && x.name ? pkErr(x) : errText(x));
  };
  const verify = async e => {
    if (e) e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      if (m === 'passkey') {
        const o = await api('pk_auth_options', {});
        const cred = await pkGet(o);
        done(await api('mfa_verify', { m: 'passkey', cred, remember }));
      } else {
        done(await api('mfa_verify', { m, code: code.trim(), remember }));
      }
    } catch (x) {
      fail(x);
    }
  };
  const sendEmail = async () => {
    setErr('');
    try {
      const r = await api('mfa_email_send', {});
      setSent(r.to);
    } catch (x) {
      setErr(errText(x));
    }
  };
  useEffect(() => {
    setCode('');
    setErr('');
    if (m === 'email' && !sent) sendEmail();
  }, [m]);
  return html`<div className="mfastep stack" style=${{ gap: 14 }}>
      <div>
        <h3 style=${{ margin: '0 0 4px' }}>Confirm it’s you${info.first ? ', ' + info.first : ''}</h3>
        <p className="muted small" style=${{ margin: 0 }}>Your account uses two-step sign-in.</p>
      </div>
      ${methods.length > 1 && html`<div className="seg" role="tablist" aria-label="How to confirm">${methods.map(k => html`<button key=${k} type="button" role="tab" aria-selected=${m === k} className=${m === k ? 'on' : ''} onClick=${() => setM(k)}>${MFA_NAMES[k]}</button>`)}</div>`}
      <form className="form" onSubmit=${verify} noValidate>
        ${
          m === 'passkey'
            ? html`<p className="muted" style=${{ margin: 0 }}>Use the passkey on this device or your phone (Face ID, fingerprint, Windows Hello or a security key).</p>`
            : m === 'totp'
              ? html`<${Field} label="6-digit code from your authenticator app"><input inputMode="numeric" autoComplete="one-time-code" maxLength="7" value=${code} onInput=${e => setCode(e.target.value.replace(/[^0-9 ]/g, ''))} autoFocus /><//>`
              : m === 'email'
                ? html`<${Field} label=${sent ? 'Code we emailed to ' + sent : 'Sending a code to your email…'} hint=${html`<button type="button" className="btn link small" onClick=${sendEmail}>Send another code</button>`}><input inputMode="numeric" autoComplete="one-time-code" maxLength="7" value=${code} onInput=${e => setCode(e.target.value.replace(/[^0-9 ]/g, ''))} autoFocus /><//>`
                : html`<${Field} label="One of your backup codes"><input autoComplete="off" maxLength="12" value=${code} onInput=${e => setCode(e.target.value)} autoFocus placeholder="abcde-fghjk" /><//>`
        }
        ${info.remember > 0 && html`<label className="check"><input type="checkbox" checked=${remember} onChange=${e => setRemember(e.target.checked)} /><span>Don’t ask again on this device for ${info.remember} days</span></label>`}
        ${err && html`<p className="err" role="alert">${err}</p>`}
        <button className="btn lg" style=${{ width: '100%' }} disabled=${busy || (m !== 'passkey' && code.replace(/\D/g, '').length < (m === 'backup' ? 0 : 6) && !(m === 'backup' && code.trim().length >= 10))}>${busy ? 'Checking…' : m === 'passkey' ? 'Use my passkey' : 'Confirm'}</button>
      </form>
      ${help
        ? html`<${MfaHelp} onClose=${() => setHelp(false)} onRestart=${onCancel} />`
        : html`<p className="muted small" style=${{ margin: 0 }}><button type="button" className="btn link small" onClick=${() => setHelp(true)}>Can't use any of these?</button> · <button type="button" className="btn link small" onClick=${() => onCancel('')}>Start over</button> · <a className="small" href="#/support">Help & support</a></p>`}
    </div>`;
}
/* v35: lost every second step: a code emailed to the account address confirms the request, which becomes a ticket for
   the administrators; they check it is really the person (a call-back on a number they already have) and reset it. */
function MfaHelp({ onClose, onRestart }) {
  const [step, setStep] = useState('ask');
  const [to, setTo] = useState('');
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [num, setNum] = useState('');
  const run = async fn => {
    setErr('');
    setBusy(true);
    try {
      await fn();
    } catch (x) {
      if (x && x.code === 'mfa_restart') onRestart(x.message);
      else setErr(errText(x));
    } finally {
      setBusy(false);
    }
  };
  const send = () =>
    run(async () => {
      const r = await api('mfa_help_send', {});
      setTo(r.to);
      setStep('code');
    });
  const request = e => {
    e.preventDefault();
    run(async () => {
      const r = await api('mfa_help_request', { code: code.trim(), note: note.trim() });
      setNum(r.num);
      setStep('done');
    });
  };
  return html`<div className="panel mfahelp stack" style=${{ gap: 10 }} role="region" aria-label="Ask for a two-step sign-in reset">
      ${step === 'ask' &&
      html`<${Fragment}>
        <b>Lost your phone, authenticator and backup codes?</b>
        <p className="small" style=${{ margin: 0 }}>We can reset your two-step sign-in. To start, we email a code to your account's address. Then an administrator contacts you to make sure it is really you before anything changes; you set it up again at your next sign-in.</p>
        ${err && html`<p className="err" role="alert">${err}</p>`}
        <div className="actions"><button type="button" className="btn sm" disabled=${busy} onClick=${send}>${busy ? 'Sending…' : 'Email me a code'}</button><button type="button" className="btn ghost sm" onClick=${onClose}>Back</button></div>
      <//>`}
      ${step === 'code' &&
      html`<form className="form" onSubmit=${request} noValidate>
        <${Field} label=${'The 6-digit code we emailed to ' + to} hint=${html`<button type="button" className="btn link small" disabled=${busy} onClick=${send}>Send another code</button>`}><input inputMode="numeric" autoComplete="one-time-code" maxLength="7" value=${code} onInput=${e => setCode(e.target.value.replace(/[^0-9 ]/g, ''))} autoFocus /><//>
        <${Field} label="Anything we should know (optional)" hint="For example: new phone since last week; best time to call you."><textarea rows="2" maxLength="1000" value=${note} onInput=${e => setNote(e.target.value)} /><//>
        ${err && html`<p className="err" role="alert">${err}</p>`}
        <div className="actions"><button className="btn sm" disabled=${busy || code.replace(/\D/g, '').length < 6}>${busy ? 'Sending…' : 'Ask for the reset'}</button><button type="button" className="btn ghost sm" onClick=${onClose}>Back</button></div>
      </form>`}
      ${step === 'done' &&
      html`<${Fragment}>
        <p className="note ok" style=${{ margin: 0 }} role="status"><span><b>Request ${num} sent.</b> An administrator will contact you, usually by phone, to confirm it is you, then reset your two-step sign-in. You get an email when it is done; then sign in again and set it up on your new phone.</span></p>
        <div className="actions"><button type="button" className="btn ghost sm" onClick=${() => onRestart('')}>Back to the login page</button></div>
      <//>`}
    </div>`;
}

/* ---- setting up two-step sign-in (at sign-in when it is required, or from Sign-in & security) ---- */
function MfaEnroll({ info, during, onDone, onCancel }) {
  const can = info.can || { totp: true, passkey: true };
  const pkOk = can.passkey && pkSupported();
  const [how, setHow] = useState(pkOk ? '' : 'totp');
  const [tp, setTp] = useState(null);
  const [code, setCode] = useState('');
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [codes, setCodes] = useState(null);
  const [res, setRes] = useState(null);
  const finish = r => {
    if (r.codes && r.codes.length) {
      setCodes(r.codes);
      setRes(r);
    } else onDone(r);
  };
  const startTotp = async () => {
    setErr('');
    setHow('totp');
    try {
      setTp(await api('mfa_totp_start', {}));
    } catch (x) {
      setErr(errText(x));
    }
  };
  const confirmTotp = async e => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      finish(await api('mfa_totp_confirm', { code: code.trim(), remember }));
    } catch (x) {
      setErr(errText(x));
    }
    setBusy(false);
  };
  const addPasskey = async () => {
    setBusy(true);
    setErr('');
    setHow('passkey');
    try {
      const o = await api('pk_reg_options', {});
      const cred = await pkCreate(o);
      finish(await api('pk_reg_finish', { cred, name: '', remember }));
    } catch (x) {
      setErr(x && x.name ? pkErr(x) : errText(x));
      setHow('');
    }
    setBusy(false);
  };
  useEffect(() => {
    if (how === 'totp' && !tp && can.totp) startTotp();
  }, []);
  if (codes) return html`<${BackupCodes} codes=${codes} onDone=${() => onDone(res)} doneLabel=${during ? 'Continue to the portal' : 'Done'} />`;
  return html`<div className="mfaenroll stack" style=${{ gap: 14 }}>
      <div>
        <h3 style=${{ margin: '0 0 4px' }}>${during ? 'Set up two-step sign-in' : 'Add a way to confirm it’s you'}</h3>
        <p className="muted small" style=${{ margin: 0 }}>${during ? 'Your role requires it. After your password, you will confirm with your phone or a passkey: a stolen password alone can no longer open your account.' : 'Used after your password at each sign-in (or instead of it, for a passkey).'}</p>
      </div>
      ${
        !how
          ? html`<div className="mfachoices">
              ${pkOk && html`<button type="button" className="choice" disabled=${busy} onClick=${addPasskey}><b>Passkey</b><span>Face ID, fingerprint, Windows Hello or a security key. Fastest, and phishing-proof. Recommended.</span></button>`}
              ${can.totp && html`<button type="button" className="choice" disabled=${busy} onClick=${startTotp}><b>Authenticator app</b><span>Google or Microsoft Authenticator, Authy, 1Password: a new 6-digit code every 30 seconds.</span></button>`}
            </div>`
          : how === 'totp'
            ? tp
              ? html`<form className="form" onSubmit=${confirmTotp} noValidate>
                  <div className="totpbox">
                    <${QrImg} text=${tp.uri} />
                    <div className="stack" style=${{ gap: 8 }}>
                      <ol className="totpsteps small">
                        <li>Open your authenticator app and add an account (the + button).</li>
                        <li>Scan this code with it, or type the key below.</li>
                        <li>Enter the 6-digit code the app shows.</li>
                      </ol>
                      <div><span className="muted small">Key</span><br /><code className="secretkey">${tp.secret}</code></div>
                    </div>
                  </div>
                  <${Field} label="6-digit code"><input inputMode="numeric" autoComplete="one-time-code" maxLength="7" value=${code} onInput=${e => setCode(e.target.value.replace(/[^0-9 ]/g, ''))} autoFocus /><//>
                  ${during && info.remember > 0 && html`<label className="check"><input type="checkbox" checked=${remember} onChange=${e => setRemember(e.target.checked)} /><span>Don’t ask again on this device for ${info.remember} days</span></label>`}
                  ${err && html`<p className="err" role="alert">${err}</p>`}
                  <div className="actions">
                    <button className="btn" disabled=${busy || code.replace(/\D/g, '').length !== 6}>${busy ? 'Checking…' : 'Turn it on'}</button>
                    ${pkOk && html`<button type="button" className="btn ghost" onClick=${() => setHow('')}>Back</button>`}
                  </div>
                </form>`
              : html`${err ? html`<p className="err">${err}</p>` : html`<${Spinner} label="Preparing…" />`}`
            : html`<${Spinner} label="Waiting for your passkey…" />`
      }
      ${how === '' && err && html`<p className="err" role="alert">${err}</p>`}
      ${onCancel && html`<p className="muted small" style=${{ margin: 0 }}><button type="button" className="btn link small" onClick=${() => onCancel('')}>${during ? 'Sign out' : 'Cancel'}</button></p>`}
    </div>`;
}

/* ---- the sign-in page's second step: after the password, or after Google/LinkedIn/Microsoft (#/login?mfa=1) ---- */
function SignInSecondStep({ info, onRestart }) {
  const finish = async r => {
    await reloadCaps();
    if (typeof shareLoginLocation === 'function') shareLoginLocation();
    location.hash = (r && r.go) || '#/portal/choose';
  };
  const cancel = async msg => {
    try {
      await api('mfa_cancel', {});
    } catch (e) {
      /* fine */
    }
    onRestart(msg || '');
  };
  return info.need === 'enroll' ? html`<${MfaEnroll} info=${info} during=${true} onDone=${finish} onCancel=${cancel} />` : html`<${MfaStep} info=${info} onDone=${finish} onCancel=${cancel} />`;
}

/* ---- "Sign in with a passkey" on the sign-in page ---- */
function PasskeySignIn({ as, next, onWrongPortal }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!pkSupported() || !Cap.pk || /^[\d.]+$|^\[/.test(location.hostname)) return null;
  const go = async () => {
    setErr('');
    setBusy(true);
    try {
      const o = await api('pk_login_options', {});
      const cred = await pkGet(o);
      const r = await api('pk_login', { cred, as: as || '', next: next || '' });
      await reloadCaps();
      if (typeof shareLoginLocation === 'function') shareLoginLocation();
      location.hash = r.go || '#/portal/choose';
    } catch (x) {
      if (x && x.code === 'wrong_portal' && onWrongPortal) onWrongPortal(x);
      else setErr(x && x.name ? pkErr(x) : errText(x));
    }
    setBusy(false);
  };
  return html`<div className="pksignin">
      <button type="button" className="btn ghost lg" style=${{ width: '100%' }} disabled=${busy} onClick=${go}><${Icon} n="key" />${busy ? 'Waiting for your passkey…' : 'Sign in with a passkey'}</button>
      ${err && html`<p className="err small" role="alert" style=${{ margin: '6px 0 0' }}>${err}</p>`}
    </div>`;
}

/* ---- passwords: the policy, a strength hint, forgotten passwords and invitation links ---- */
let pwPolicyCache = null;
function usePwPolicy() {
  const [p, setP] = useState(pwPolicyCache);
  useEffect(() => {
    if (!pwPolicyCache)
      api('pw_policy')
        .then(r => {
          pwPolicyCache = r;
          setP(r);
        })
        .catch(() => setP({ min: 15, minMfa: 8, minSolo: 15, max: 128 }));
  }, []);
  return p || { min: 15, minMfa: 8, minSolo: 15, max: 128 };
}
function PwHint({ pw, min }) {
  const n = (pw || '').length;
  const pct = Math.min(100, Math.round((n / Math.max(min, 1)) * 100));
  return html`<div className="pwhint" aria-live="polite">
      <div className="bar"><i style=${{ width: pct + '%' }} className=${n >= min ? 'ok' : ''}></i></div>
      <span className="muted small">${n >= min ? 'Long enough. The server also checks it against common and breached passwords.' : 'At least ' + min + ' characters (' + Math.max(0, min - n) + ' to go). A passphrase of a few unrelated words is strong and easy to remember.'}</span>
    </div>`;
}
function ForgotPage({ q }) {
  const [email, setEmail] = useState(q.e || '');
  const [st, setSt] = useState('idle');
  const [err, setErr] = useState('');
  const submit = async e => {
    e.preventDefault();
    setErr('');
    if (!/^\S+@\S+\.\S+$/.test(email)) return setErr('Enter the email address of your account.');
    setSt('busy');
    try {
      await api('pw_forgot', { email: email.trim(), website: botTrap.hp, t0: botTrap.t0 });
      setSt('sent');
    } catch (x) {
      setErr(errText(x));
      setSt('idle');
    }
  };
  return html`<div className="login"><div className="blade"><h1>Forgot your password?</h1><ul><li>We email you a link that works once, for 30 minutes.</li><li>Your two-step sign-in stays on.</li><li>All your other sessions end when the password changes.</li></ul></div>
      <div className="login-card">
        <h2>Reset your password</h2>
        ${
          st === 'sent'
            ? html`<div className="stack"><p className="note ok" style=${{ margin: 0 }}><span>If <b>${email}</b> has an account, a reset link is on its way. Check your inbox (and the spam folder) in a minute.</span></p><a className="btn ghost" href="#/login">Back to sign-in</a></div>`
            : html`<form className="form" onSubmit=${submit} noValidate>
                <${BotTrap} />
                <${Field} label="Email"><input type="email" autoComplete="username" value=${email} onInput=${e => setEmail(e.target.value)} autoFocus /><//>
                ${err && html`<p className="err" role="alert">${err}</p>`}
                <button className="btn lg" style=${{ width: '100%' }} disabled=${st === 'busy'}>${st === 'busy' ? 'Sending…' : 'Email me a reset link'}</button>
                <p className="muted small"><a href="#/login">Back to sign-in</a></p>
              </form>`
        }
      </div></div>`;
}
function ResetPage({ q }) {
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState('');
  const [f, setF] = useState({ p: '', p2: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    api('pw_reset_check', { t: q.t || '' }).then(setInfo, x => setErr(errText(x)));
  }, [q.t]);
  const submit = async e => {
    e.preventDefault();
    setErr('');
    if (f.p.length < info.min) return setErr('Use at least ' + info.min + ' characters.');
    if (f.p !== f.p2) return setErr('The two passwords don’t match.');
    setBusy(true);
    try {
      await api('pw_reset', { t: q.t, password: f.p });
      setDone(true);
    } catch (x) {
      setErr(errText(x));
    }
    setBusy(false);
  };
  const as = (info && info.as) || q.as || '';
  const invite = info && info.kind === 'invite';
  return html`<div className="login"><div className="blade"><h1>${invite ? 'Welcome to StratEdge' : 'Choose a new password'}</h1><ul><li>Long beats complicated: a passphrase of a few unrelated words.</li><li>Never reuse a password from another site.</li><li>Set up two-step sign-in next under Sign-in & security.</li></ul></div>
      <div className="login-card">
        <h2>${invite ? 'Choose your password' : 'New password'}</h2>
        ${
          done
            ? html`<div className="stack"><p className="note ok" style=${{ margin: 0 }}><span>${invite ? 'Your password is set.' : 'Your password was changed and your other sessions were signed out.'} Sign in with it now.</span></p><a className="btn" href=${'#/login' + (as ? '?as=' + as : '')}>Sign in</a></div>`
            : !info
              ? err
                ? html`<div className="stack"><p className="err">${err}</p><a className="btn ghost" href="#/forgot">Ask for a new link</a></div>`
                : html`<${Spinner} label="Checking the link…" />`
              : html`<form className="form" onSubmit=${submit} noValidate>
                  <p className="muted small" style=${{ margin: 0 }}>For <b>${info.email}</b></p>
                  <input type="email" autoComplete="username" value=${info.email} readOnly hidden />
                  <${Field} label="New password"><input type="password" autoComplete="new-password" value=${f.p} onInput=${e => setF({ ...f, p: e.target.value })} autoFocus /><//>
                  <${PwHint} pw=${f.p} min=${info.min} />
                  <${Field} label="Confirm the new password"><input type="password" autoComplete="new-password" value=${f.p2} onInput=${e => setF({ ...f, p2: e.target.value })} /><//>
                  ${err && html`<p className="err" role="alert">${err}</p>`}
                  <button className="btn lg" style=${{ width: '100%' }} disabled=${busy}>${busy ? 'Saving…' : invite ? 'Set my password' : 'Change my password'}</button>
                </form>`
        }
      </div></div>`;
}

/* ---- confirming it's you before a sensitive change, then the action runs again ----
   v35: every way the person has (password, passkey, authenticator code, backup code, or an emailed code for people
   without an app or passkey, e.g. accounts that only use Google or LinkedIn sign-in). */
function ReauthModal({ onDone, onClose }) {
  const [info, setInfo] = useState(null);
  const [how, setHow] = useState('password');
  const [pw, setPw] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    api('auth_reauth_info', {}).then(setInfo, () => setInfo({ password: true }));
    // v39.1: drawn above the side panels (Phone, assistant) that sit above the windows
    document.body.classList.add('se-reauth');
    return () => document.body.classList.remove('se-reauth');
  }, []);
  const pick = h => {
    setHow(h);
    setErr('');
    setCode('');
  };
  const confirm = async e => {
    if (e) e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await api('auth_reauth', how === 'password' ? { password: pw } : { m: how, code });
      onDone();
    } catch (x) {
      setErr(errText(x));
    }
    setBusy(false);
  };
  const viaPk = async () => {
    setBusy(true);
    setErr('');
    try {
      const o = await api('pk_auth_options', {});
      const cred = await pkGet(o);
      await api('auth_reauth', { m: 'passkey', cred });
      onDone();
    } catch (x) {
      setErr(x && x.name ? pkErr(x) : errText(x));
    }
    setBusy(false);
  };
  const sendCode = async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await api('auth_reauth_email', {});
      setSent(r.to || 'your email');
      pick('email');
    } catch (x) {
      setErr(errText(x));
    }
    setBusy(false);
  };
  const i = info || {};
  const others = [
    i.passkey && pkSupported() && html`<button key="pk" type="button" className="btn ghost sm" disabled=${busy} onClick=${viaPk}><${Icon} n="key" />Use a passkey</button>`,
    i.totp && how !== 'totp' && html`<button key="totp" type="button" className="btn ghost sm" disabled=${busy} onClick=${() => pick('totp')}>Use my authenticator app</button>`,
    i.backup && how !== 'backup' && html`<button key="bk" type="button" className="btn ghost sm" disabled=${busy} onClick=${() => pick('backup')}>Use a backup code</button>`,
    i.email && how !== 'email' && html`<button key="em" type="button" className="btn ghost sm" disabled=${busy} onClick=${sendCode}>Email me a code</button>`,
    how !== 'password' && html`<button key="pw" type="button" className="btn ghost sm" disabled=${busy} onClick=${() => pick('password')}>Use my password</button>`,
  ].filter(Boolean);
  return html`<${Modal} title="Confirm it’s you" onClose=${onClose}>
      <form className="form reauthform" onSubmit=${confirm} noValidate>
        <p className="muted" style=${{ margin: 0 }}>This change is protected: confirm it is you${i.min ? ' (asked again after ' + i.min + ' minutes)' : ''}, then it goes ahead.</p>
        ${
          how === 'password'
            ? html`<${Field} label="Your password"><input type="password" autoComplete="current-password" value=${pw} onInput=${e => setPw(e.target.value)} autoFocus /><//>`
            : html`<${Field} label=${how === 'totp' ? 'The 6-digit code from your authenticator app' : how === 'backup' ? 'One of your backup codes' : 'The 6-digit code we emailed to ' + (sent || i.to || 'you')}><input value=${code} onInput=${e => setCode(e.target.value)} autoComplete="one-time-code" inputMode=${how === 'backup' ? 'text' : 'numeric'} autoFocus /><//>`
        }
        ${err && html`<p className="err" role="alert">${err}</p>`}
        <div className="actions">
          <button className="btn" disabled=${busy || (how === 'password' ? !pw : code.trim().length < 6)}>${busy ? 'Checking…' : 'Confirm'}</button>
          ${others}
        </div>
      </form>
    <//>`;
}
/* The one "Confirm it's you" window for every request (core.js SeGate): several requests waiting at once share it. */
function ReauthHost() {
  const [waiting, setWaiting] = useState([]);
  useEffect(() => {
    SeGate.reauth = () => new Promise((res, rej) => setWaiting(w => [...w, { res, rej }]));
    return () => {
      SeGate.reauth = null;
    };
  }, []);
  if (!waiting.length) return null;
  const settle = ok => {
    const all = waiting;
    setWaiting([]);
    all.forEach(x => (ok ? x.res() : x.rej({ code: 'cancelled', message: 'Not changed: the confirmation was closed.' })));
  };
  return html`<${ReauthModal} onDone=${() => settle(true)} onClose=${() => settle(false)} />`;
}

/* ---- v35: "This was not me" for a direct deposit change (the link in the email; no sign-in needed) ---- */
function StopChangePage({ q }) {
  const k = (q && q.k) || '';
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  useEffect(() => {
    api('dd_dispute_get', { k }).then(setD, x => setErr(errText(x)));
  }, [k]);
  const stop = async () => {
    setBusy(true);
    try {
      await api('dd_dispute', { k });
      setDone('stopped');
    } catch (x) {
      setErr(errText(x));
    }
    setBusy(false);
  };
  return html`<section className="section"><div className="wrap" style=${{ maxWidth: 640 }}>
      <div className="panel stack" style=${{ gap: 14 }}>
        <h1 style=${{ margin: 0, fontSize: 26 }}>Was this change made by you?</h1>
        ${
          err
            ? html`<p className="note amber" style=${{ margin: 0 }}><span>${err}</span></p>`
            : !d
              ? html`<${Spinner} />`
              : done === 'stopped'
                ? html`<p className="note ok" style=${{ margin: 0 }}><span><b>The change is stopped.</b> Your previous bank account is back in place, everyone was signed out of your account, and we emailed you a link to choose a new password. StratEdge payroll has been told and will call you at the number on file before changing anything.</span></p>`
                : done === 'mine'
                  ? html`<p className="note ok" style=${{ margin: 0 }}><span>Thanks for checking. Nothing else is needed.</span></p>`
                  : html`<${Fragment}>
                      <p style=${{ margin: 0 }}>Hi ${d.first || 'there'}, on ${fmtTs(d.at)} ${d.byn ? d.byn + ' changed' : 'someone changed'} where your pay goes: ${d.last4.map(x => 'the account ending ' + x).join(', ')}.</p>
                      <p className="muted small" style=${{ margin: 0 }}>If you did not make or ask for this change, stop it now. Your previous account is put back, every session of your account is signed out, your password is replaced (we email you a link to choose a new one) and payroll is alerted.</p>
                      <div className="actions">
                        <button className="btn danger" disabled=${busy} onClick=${stop}>${busy ? 'Stopping…' : 'No, this was not me: stop it'}</button>
                        <button className="btn ghost" disabled=${busy} onClick=${() => setDone('mine')}>Yes, I made this change</button>
                      </div>
                    <//>`
        }
      </div>
    </div></section>`;
}
/** Runs fn; when the server asks for a fresh confirmation, shows ReauthModal and runs it again. */
function useReauth() {
  const [pending, setPending] = useState(null);
  const run = async fn => {
    try {
      return await fn();
    } catch (x) {
      if (x && x.code === 'reauth')
        return new Promise((res, rej) =>
          setPending({
            go: async () => {
              setPending(null);
              try {
                res(await fn());
              } catch (y) {
                rej(y);
              }
            },
            no: () => {
              setPending(null);
              rej({ code: 'cancelled', message: 'Cancelled.' });
            },
          })
        );
      throw x;
    }
  };
  const modal = pending ? html`<${ReauthModal} onDone=${pending.go} onClose=${pending.no} />` : null;
  return [run, modal];
}

/* ---- Sign-in & security (every portal) ---- */
function MySecurityPage() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState(false);
  const [codes, setCodes] = useState(null);
  const [run, reauthModal] = useReauth();
  const load = () => api('sec_me').then(setD, x => setErr(errText(x)));
  useEffect(() => {
    load();
  }, []);
  const act = async (route, body, msg) => {
    try {
      const r = await run(() => api(route, body || {}));
      if (r && r.codes && r.codes.length) setCodes(r.codes);
      if (msg) toast(msg);
      load();
      reloadCaps();
      return r;
    } catch (x) {
      if (!x || x.code !== 'cancelled') toast(errText(x), true);
    }
  };
  const addPasskey = async () => {
    try {
      await run(async () => {
        const o = await api('pk_reg_options', {});
        const cred = await pkCreate(o);
        // named after this browser and device ("Chrome on Windows"); Rename changes it
        return api('pk_reg_finish', { cred, name: '' });
      }).then(r => {
        if (r && r.codes && r.codes.length) setCodes(r.codes);
        toast('Passkey added.');
        load();
        reloadCaps();
      });
    } catch (x) {
      if (!x || x.code !== 'cancelled') toast(x && x.name ? pkErr(x) : errText(x), true);
    }
  };
  if (err) return html`<p className="err">${err}</p>`;
  if (!d) return html`<${Spinner} label="Loading your sign-in settings…" />`;
  const on = d.methods.filter(m => m !== 'backup').length > 0;
  return html`<div className="stack">
      ${reauthModal}
      <${MyPoliciesPanel} />
      ${codes && html`<${Modal} title="Your backup codes" onClose=${() => setCodes(null)}><${BackupCodes} codes=${codes} onDone=${() => setCodes(null)} doneLabel="Done" /><//>`}
      <section className="panel stack" style=${{ gap: 12 }}>
        <div className="ph-row">
          <h2 className="ph">Two-step sign-in</h2>
          <${Chip} s=${on ? 'ok' : d.required ? 'red' : ''}>${on ? 'On' : d.required ? 'Required for your role' : 'Off'}<//>
        </div>
        ${!on && d.required && html`<p className="note amber" style=${{ margin: 0 }}><span>Your role must use two-step sign-in${d.due > Date.now() ? ' from ' + fmtDay(d.due) : ''}. Add a passkey or an authenticator app below.</span></p>`}
        <p className="muted small" style=${{ margin: 0 }}>After your password you confirm with something only you have, so a stolen password alone cannot open your account.</p>
        <ul className="list secmethods">
          <li>
            <div className="t"><b>Passkeys</b><span className="muted small">Face ID, fingerprint, Windows Hello or a security key; also signs you in without a password.</span></div>
            <div className="actions">${d.can.passkey && pkSupported() ? html`<button className="btn sm" onClick=${addPasskey}>Add a passkey</button>` : html`<span className="muted small">${d.can.passkey ? 'Not supported by this browser' : 'Switched off by the administrator'}</span>`}</div>
          </li>
          ${d.keys.map(
            k => html`<li key=${k.id} className="sub">
              <div className="t"><span>${k.name}</span><span className="muted small">Added ${fmtDay(k.at)}${k.used ? ' · last used ' + fmtTs(k.used) : ''}</span></div>
              <div className="actions">
                <button className="btn ghost sm" onClick=${() => {
                  const n = window.prompt('New name', k.name);
                  if (n) act('pk_rename', { id: k.id, name: n }, 'Renamed.');
                }}>Rename</button>
                <button className="btn ghost sm" onClick=${() => window.confirm('Remove this passkey?') && act('pk_remove', { id: k.id }, 'Passkey removed.')}>Remove</button>
              </div>
            </li>`
          )}
          <li>
            <div className="t"><b>Authenticator app</b><span className="muted small">${d.totp ? 'On since ' + fmtDay(d.totp) : 'Google or Microsoft Authenticator, Authy, 1Password.'}</span></div>
            <div className="actions">${d.totp ? html`<button className="btn ghost sm" onClick=${() => window.confirm('Turn off the authenticator app?') && act('mfa_totp_remove', {}, 'Authenticator app removed.')}>Remove</button>` : d.can.totp ? html`<button className="btn sm" onClick=${() => setAdding(true)}>Set up</button>` : null}</div>
          </li>
          ${
            d.can.email &&
            html`<li>
              <div className="t"><b>Email codes</b><span className="muted small">A code sent to your email. Weaker than the two above; use it only if you cannot.</span></div>
              <div className="actions"><button className=${'btn sm ' + (d.email ? 'ghost' : '')} onClick=${() => act('mfa_email_set', { on: !d.email }, d.email ? 'Email codes off.' : 'Email codes on.')}>${d.email ? 'Turn off' : 'Turn on'}</button></div>
            </li>`
          }
          <li>
            <div className="t"><b>Backup codes</b><span className="muted small">${d.codes ? d.codes + ' unused' + (d.codesAt ? ', made ' + fmtDay(d.codesAt) : '') : 'Made when you turn two-step sign-in on'}</span></div>
            <div className="actions">${on && html`<button className="btn ghost sm" onClick=${() => window.confirm('Make 10 new backup codes? The old ones stop working.') && act('mfa_codes_new', {}, 'New backup codes made.')}>New codes</button>`}</div>
          </li>
        </ul>
        ${adding && html`<${Modal} title="Authenticator app" onClose=${() => setAdding(false)}><${MfaEnroll} info=${{ can: { totp: true, passkey: false } }} during=${false} onDone=${() => {
          setAdding(false);
          toast('Authenticator app on.');
          load();
          reloadCaps();
        }} onCancel=${() => setAdding(false)} /><//>`}
      </section>
      <${PasswordPanel} policy=${d.pw} />
      <section className="panel stack" style=${{ gap: 10 }}>
        <div className="ph-row"><h2 className="ph">Where you’re signed in</h2><button className="btn ghost sm" onClick=${() => window.confirm('Sign out every other browser and device?') && act('sess_revoke_all', {}, 'Signed out everywhere else.')}>Sign out everywhere else</button></div>
        <ul className="list seclist">
          ${d.sessions.map(
            s => html`<li key=${s.id}>
              <div className="t"><span>${s.dev}${s.cur ? html` <${Chip} s="ok">This browser<//>` : ''}</span><span className="muted small">${[s.geo, s.ip, 'signed in ' + fmtTs(s.at), 'active ' + fmtTs(s.seen)].filter(Boolean).join(' · ')}</span></div>
              ${!s.cur && html`<div className="actions"><button className="btn ghost sm" onClick=${() => act('sess_revoke', { id: s.id }, 'Signed out there.')}>Sign out</button></div>`}
            </li>`
          )}
        </ul>
      </section>
      <section className="panel stack" style=${{ gap: 10 }}>
        <h2 className="ph">Devices</h2>
        <p className="muted small" style=${{ margin: 0 }}>Browsers that signed in to your account. A new one is reported to you by email.</p>
        <ul className="list seclist">
          ${d.devices.map(
            x => html`<li key=${x.id}>
              <div className="t"><span>${x.dev}${x.cur ? html` <${Chip} s="ok">This browser<//>` : ''}${x.trust ? html` <${Chip}>Remembered until ${fmtDay(x.trust)}<//>` : ''}</span><span className="muted small">${[x.geo, 'first ' + fmtDay(x.at), 'last ' + fmtTs(x.seen)].filter(Boolean).join(' · ')}</span></div>
              <div className="actions"><button className="btn ghost sm" onClick=${() => act('dev_forget', { id: x.id }, 'Forgotten.')}>Forget</button></div>
            </li>`
          )}
        </ul>
      </section>
      <section className="panel stack" style=${{ gap: 10 }}>
        <h2 className="ph">Recent sign-ins</h2>
        <ul className="list seclist">${d.logins.map((l, i) => html`<li key=${i}><div className="t"><span>${fmtTs(l.t)} · ${l.how === 'logout' ? 'Signed out' : /^sso/.test(l.how) ? 'Signed in with ' + (l.how.split(':')[1] || 'a provider') : /^passkey/.test(l.how) ? 'Signed in with a passkey' : 'Signed in'}</span><span className="muted small">${[l.dev, l.geo, l.ip].filter(Boolean).join(' · ')}</span></div></li>`)}</ul>
        <p className="muted small" style=${{ margin: 0 }}>Something you don’t recognise? Change your password, sign out everywhere else, and report it below.</p>
      </section>
      <${SecurityConcern} />
    </div>`;
}

/* ---- a password the person must replace before anything else (reset by staff, or found in a breach list) ---- */
function MustChangePassword({ why }) {
  const toast = useToast();
  const pol = usePwPolicy();
  const [f, setF] = useState({ c: '', n: '', n2: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async e => {
    e.preventDefault();
    setErr('');
    if (f.n.length < pol.min) return setErr('Use at least ' + pol.min + ' characters.');
    if (f.n !== f.n2) return setErr('The new passwords don’t match.');
    setBusy(true);
    try {
      await api('password', { current: f.c, new: f.n });
      toast('Password changed.');
      await reloadCaps();
    } catch (x) {
      setErr(errText(x));
    }
    setBusy(false);
  };
  return html`<${Gate} title="Choose a new password" actions=${html`<button type="button" className="btn ghost" onClick=${logout}>Log out</button>`}>
      <form className="form" onSubmit=${save} noValidate>
        <p className="muted" style=${{ margin: 0 }}>${why === 'breached' ? 'Your password appears in lists of passwords leaked from other websites, so it is no longer safe. Choose a new one to continue.' : 'Your password was reset by StratEdge. Choose your own to continue.'}</p>
        <input type="email" autoComplete="username" value=${(Cap.me && Cap.me.email) || ''} readOnly hidden />
        <${Field} label=${why === 'breached' ? 'Current password' : 'Temporary or current password'}><input type="password" autoComplete="current-password" value=${f.c} onInput=${e => setF({ ...f, c: e.target.value })} autoFocus /><//>
        <${Field} label="New password"><input type="password" autoComplete="new-password" value=${f.n} onInput=${e => setF({ ...f, n: e.target.value })} /><//>
        ${f.n && html`<${PwHint} pw=${f.n} min=${pol.min} />`}
        <${Field} label="Confirm the new password"><input type="password" autoComplete="new-password" value=${f.n2} onInput=${e => setF({ ...f, n2: e.target.value })} /><//>
        ${err && html`<p className="err" role="alert">${err}</p>`}
        <button className="btn lg" disabled=${busy}>${busy ? 'Saving…' : 'Change password and continue'}</button>
      </form>
    <//>`;
}

/* ---- "Something looks wrong": a phishing email, a lost laptop, a sign-in you don't recognise (to the security officer) ---- */
function SecurityConcern() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ kind: 'phishing', t: '', desc: '' });
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (f.desc.trim().length < 10) return toast('Describe what happened in a sentence or two.', true);
    setBusy(true);
    try {
      await api('gov_concern', f);
      toast('Sent to the security officer. Thank you.');
      setOpen(false);
      setF({ kind: 'phishing', t: '', desc: '' });
    } catch (x) {
      toast(errText(x), true);
    }
    setBusy(false);
  };
  return html`<section className="panel stack" style=${{ gap: 10 }}>
      <h2 className="ph">Report a security concern</h2>
      <p className="muted small" style=${{ margin: 0 }}>A suspicious email or call, a lost phone or laptop, a sign-in you don’t recognise, or data sent to the wrong person: report it right away. Reporting quickly matters more than being sure.</p>
      <div><button className="btn ghost sm" onClick=${() => setOpen(true)}><${Icon} n="shield" />Report a concern</button></div>
      ${
        open &&
        html`<${Modal} title="Report a security concern" onClose=${() => setOpen(false)} foot=${html`<button className="btn ghost" onClick=${() => setOpen(false)}>Cancel</button><button className="btn" disabled=${busy} onClick=${send}>${busy ? 'Sending…' : 'Send'}</button>`}>
          <div className="form">
            <${Field} label="What happened?">
              <select value=${f.kind} onChange=${e => setF({ ...f, kind: e.target.value })}>
                <option value="phishing">A suspicious email, message or call</option>
                <option value="device">A lost or stolen phone or laptop</option>
                <option value="account">A sign-in or account change I don’t recognise</option>
                <option value="data">Personal data sent to the wrong person or exposed</option>
                <option value="other">Something else</option>
              </select>
            <//>
            <${Field} label="Short title (optional)"><input value=${f.t} maxLength="160" onInput=${e => setF({ ...f, t: e.target.value })} /><//>
            <${Field} label="Details" hint="When, what you saw, and anything you already did (for example: clicked the link, changed my password)."><textarea rows="5" value=${f.desc} onInput=${e => setF({ ...f, desc: e.target.value })} /><//>
          </div>
        <//>`
      }
    </section>`;
}

/* ---- notices at the top of every portal page ---- */
function SecurityNotices({ securityHref, policiesHref }) {
  const c = useCaps();
  const s = c && c.sec;
  if (!s) return null;
  const out = [];
  if (!s.mfa && s.mfaDue > 0)
    out.push(
      html`<div key="mfa" className="note amber" style=${{ marginBottom: 14 }}><span><b>Two-step sign-in ${s.mfaDue > Date.now() ? 'is required from ' + fmtDay(s.mfaDue) : 'is required for your role'}.</b> Takes a minute with a passkey or your phone.</span><div className="actions"><a className="btn sm" href=${securityHref}>Set it up</a></div></div>`
    );
  if (s.policies > 0)
    out.push(
      html`<div key="pol" className="note" style=${{ marginBottom: 14 }}><span><b>${s.policies} security ${s.policies === 1 ? 'policy' : 'policies'} to read and accept.</b></span><div className="actions"><a className="btn sm" href=${policiesHref}>Read them</a></div></div>`
    );
  return out.length ? html`<${Fragment}>${out}<//>` : null;
}

/* ---- the security policies a person must accept ---- */
function MyPoliciesPanel() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [open, setOpen] = useState('');
  const load = () => api('gov_my_policies').then(setD, () => setD({ policies: [] }));
  useEffect(() => {
    load();
  }, []);
  const accept = async p => {
    try {
      await api('gov_ack', { id: p.id, ver: p.ver });
      toast('Accepted: ' + p.t);
      setOpen('');
      load();
      reloadCaps();
    } catch (x) {
      toast(errText(x), true);
    }
  };
  if (!d) return html`<${Spinner} />`;
  if (!d.policies.length) return null;
  const todo = d.policies.filter(p => p.ackVer < p.ver).length;
  return html`<section className="panel stack" style=${{ gap: 10 }}>
      <div className="ph-row"><h2 className="ph">Security policies</h2>${todo ? html`<${Chip} s="amber">${todo} to accept<//>` : html`<${Chip} s="ok">All accepted<//>`}</div>
      <ul className="list seclist">
        ${d.policies.map(
          p => html`<li key=${p.id} className="polrow">
            <div className="t"><b>${p.t}</b><span className="muted small">${p.sum}</span><span className="small">${p.ackVer >= p.ver ? html`<${Chip} s="ok">Accepted ${fmtDay(p.ackAt)}<//>` : html`<${Chip} s="amber">${p.ackVer ? 'Updated: accept version ' + p.ver : 'Not accepted yet'}<//>`}</span></div>
            <div className="actions"><button className=${'btn sm ' + (p.ackVer >= p.ver ? 'ghost' : '')} onClick=${() => setOpen(p.id)}>${p.ackVer >= p.ver ? 'Read' : 'Read and accept'}</button></div>
          </li>`
        )}
      </ul>
      ${
        open &&
        (() => {
          const p = d.policies.find(x => x.id === open);
          return html`<${Modal} title=${p.t + ' (version ' + p.ver + ')'} wide=${true} onClose=${() => setOpen('')} foot=${p.ackVer >= p.ver ? html`<button className="btn" onClick=${() => setOpen('')}>Close</button>` : html`<button className="btn ghost" onClick=${() => setOpen('')}>Later</button><button className="btn" onClick=${() => accept(p)}>I have read and accept this policy</button>`}>
            <${MdLite} text=${p.body} />
          <//>`;
        })()
      }
    </section>`;
}

/* ---- the public security page (#/security) and the vulnerability report form ---- */
function SecurityPublicPage() {
  const [f, setF] = useState({ name: '', email: '', t: '', desc: '' });
  const [st, setSt] = useState('idle');
  const [err, setErr] = useState('');
  const [ref, setRef] = useState('');
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const send = async e => {
    e.preventDefault();
    setErr('');
    setSt('busy');
    try {
      const r = await api('sec_report', { ...f, website: botTrap.hp, t0: botTrap.t0 });
      setRef(r.ref);
      setSt('sent');
    } catch (x) {
      setErr(errText(x));
      setSt('idle');
    }
  };
  const P = [
    ['Encryption everywhere', 'The portal only answers over HTTPS. Every uploaded document (immigration papers, ID copies, resumes, contracts) is encrypted at rest with AES-256, as are bank details and stored credentials. Backups are encrypted with a key that never lives on the server.'],
    ['Strong sign-in', 'Two-step sign-in with passkeys or authenticator apps (required for administrators, HR and accounting), passwords checked against breached-password lists, automatic lockout, and alerts for sign-ins from new devices.'],
    ['Least privilege', 'Each person sees only the portals and records their role needs. Access is reviewed every quarter and removed the day someone leaves.'],
    ['Monitoring', 'A tamper-evident audit log of sign-ins and changes, a daily automated security check, file integrity monitoring, and a firewall that blocks scanners and abusive traffic.'],
    ['Governance', 'Written security policies acknowledged by staff, yearly security training, a risk register, vendor reviews and an incident response plan with breach-notification deadlines, organised along the SOC 2 Trust Services Criteria.'],
    ['Your data, your choice', 'Ask for a copy of your data or its deletion at any time on the privacy page. Personal data is never sold.'],
  ];
  return html`<${Fragment}>
      <${PageHead} title="Security at StratEdge" intro="How we protect the information candidates, consultants and clients trust us with, and how to tell us if you find a problem." />
      <section className="sec"><div className="wrap stack" style=${{ gap: 28 }}>
        <div className="secgrid">${P.map(([t, d]) => html`<div key=${t} className="panel"><h3 style=${{ margin: '0 0 8px', fontSize: 20 }}>${t}</h3><p className="muted" style=${{ margin: 0 }}>${d}</p></div>`)}</div>
        <div className="g2" style=${{ gap: 32, alignItems: 'start' }}>
          <div className="prose">
            <h2>Report a vulnerability</h2>
            <p>Found a security problem in this website or the portal? Tell us privately and we will work with you to fix it.</p>
            <ul>
              <li>We acknowledge reports within 3 business days and keep them confidential.</li>
              <li>We will not take legal action against good-faith research that avoids privacy violations, data destruction and service disruption, and gives us reasonable time to fix the problem before any disclosure.</li>
              <li>Please do not access or change other people's data, run automated scans that degrade the service, or use social engineering against our staff.</li>
            </ul>
            <p className="muted small">Machine-readable contact details: <a href=".well-known/security.txt">security.txt</a>.</p>
          </div>
          <div className="panel">
            ${
              st === 'sent'
                ? html`<p className="note ok" style=${{ margin: 0 }}><span>Thank you. Your report was recorded (reference <b>${ref}</b>) and our security officer has been notified.</span></p>`
                : html`<form className="form" onSubmit=${send} noValidate>
                    <${BotTrap} />
                    <div className="row2">
                      <${Field} label="Your name"><input value=${f.name} onInput=${up('name')} autoComplete="name" /><//>
                      <${Field} label="Your email"><input type="email" value=${f.email} onInput=${up('email')} autoComplete="email" /><//>
                    </div>
                    <${Field} label="Short title"><input value=${f.t} onInput=${up('t')} maxLength="120" /><//>
                    <${Field} label="What you found" hint="Where it is, how to reproduce it and the impact. No personal data of others, please."><textarea rows="7" value=${f.desc} onInput=${up('desc')} /><//>
                    ${err && html`<p className="err" role="alert">${err}</p>`}
                    <button className="btn" disabled=${st === 'busy'}>${st === 'busy' ? 'Sending…' : 'Send the report'}</button>
                  </form>`
            }
          </div>
        </div>
      </div></section>
    <//>`;
}

/* ---- v35: Help & support on the public website (#/support): sign-in help, the help assistant and a request without
   a login; the requester follows it on #/support?k=... (the link in our emails). Server: api/desk.php pub_support*. ---- */
function SupportPage({ q }) {
  return q && q.k ? html`<${SupportStatus} k=${q.k} />` : html`<${SupportHome} q=${q} />`;
}
function SupportHome({ q }) {
  const [d, setD] = useState(null);
  const [loadErr, setLoadErr] = useState('');
  const [ask, setAsk] = useState('');
  const [ans, setAns] = useState(null);
  const [asking, setAsking] = useState(false);
  const [f, setF] = useState({ name: '', email: '', portal: 'consultant', topic: (q && q.topic) || 'signin', title: '', body: '' });
  const [st, setSt] = useState('idle');
  const [err, setErr] = useState('');
  const [num, setNum] = useState('');
  useEffect(() => {
    api('pub_support', {}).then(setD, e => setLoadErr(errText(e)));
  }, []);
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const doAsk = async e => {
    e.preventDefault();
    if (!ask.trim()) return;
    setAsking(true);
    try {
      setAns((await api('pub_support_bot', { q: ask })).answers);
    } catch (x) {
      setAns([]);
    } finally {
      setAsking(false);
    }
  };
  const send = async e => {
    e.preventDefault();
    setErr('');
    setSt('busy');
    try {
      const r = await api('pub_support_create', { ...f, website: botTrap.hp, t0: botTrap.t0 });
      setNum(r.num);
      setSt('sent');
    } catch (x) {
      setErr(errText(x));
      setSt('idle');
    }
  };
  const goForm = () => {
    const el = document.getElementById('support-form');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return html`<${Fragment}>
      <${PageHead} title="Help & support" intro="Trouble signing in, a lost phone, or a question about the portal? Most answers are below; if not, send us a request and we reply by email." />
      <section className="sec"><div className="wrap stack" style=${{ gap: 28 }}>
        <div className="g2" style=${{ gap: 24, alignItems: 'start' }}>
          <div className="panel stack" style=${{ gap: 10 }}>
            <h2 style=${{ margin: 0, fontSize: 22 }}>Ask a question</h2>
            <form className="supask" onSubmit=${doAsk}>
              <input value=${ask} onInput=${e => setAsk(e.target.value)} placeholder="For example: I lost my phone and can't sign in" aria-label="Your question" />
              <button className="btn" disabled=${asking}>${asking ? 'Looking…' : 'Ask'}</button>
            </form>
            ${ans &&
            (ans.length
              ? html`<div className="stack" style=${{ gap: 8 }}>${ans.map(a => html`<details key=${a.id} className="supart" open><summary>${a.t}</summary><${MdLite} text=${a.body} /></details>`)}<p className="muted small" style=${{ margin: 0 }}>Not what you needed? <button type="button" className="btn link small" onClick=${goForm}>Send us a request</button>.</p></div>`
              : html`<p className="note small"><span>No article answers that yet. <button type="button" className="btn link small" onClick=${goForm}>Send us a request</button> and a person will reply.</span></p>`)}
          </div>
          <div className="panel stack supmfa" style=${{ gap: 8 }}>
            <h2 style=${{ margin: 0, fontSize: 22 }}>Lost your phone or authenticator app?</h2>
            <ol className="absteps">
              <li>Sign in with your email and password as usual.</li>
              <li>On the code step, use a <b>backup code</b> or an <b>email code</b> if you have one.</li>
              <li>Nothing works? Choose <b>Can't use any of these?</b>: we email you a code to confirm, an administrator contacts you to make sure it is you, then resets your two-step sign-in.</li>
            </ol>
            <div className="actions"><a className="btn" href=${LOGIN}>Go to the login page</a><a className="btn ghost" href="#/forgot">Forgot your password?</a></div>
            <p className="muted small" style=${{ margin: 0 }}>StratEdge never asks for your password or codes by phone, chat or email.</p>
          </div>
        </div>
        <div>
          <h2 style=${{ margin: '0 0 12px', fontSize: 24 }}>Sign-in help</h2>
          ${!d && !loadErr ? html`<${Spinner} />` : loadErr ? html`<p className="note amber"><span>${loadErr}</span></p>` : html`<div className="supgrid">${d.articles.map(a => html`<details key=${a.id} className="supart panel"><summary>${a.t}</summary><${MdLite} text=${a.body} /></details>`)}</div>`}
        </div>
        <div className="g2" id="support-form" style=${{ gap: 32, alignItems: 'start' }}>
          <div className="prose">
            <h2>Contact support</h2>
            <p>Tell us what happened. You get an email with your request number and a link to follow it; our replies come by email too.</p>
            <ul>
              <li>Sign-in and security requests are answered first, within an hour on working days.</li>
              <li>Write from the email address your account uses, so we can find it.</li>
              <li>Never send passwords, codes, bank details or ID numbers.</li>
            </ul>
            ${d && d.email && html`<p className="muted small">Or email us at <a href=${'mailto:' + d.email}>${d.email}</a>.</p>`}
          </div>
          <div className="panel">
            ${d && !d.on
              ? html`<p className="note amber" style=${{ margin: 0 }}><span>Requests from the website are switched off right now. Email us at <a href=${'mailto:' + ((d && d.email) || CO.email)}>${(d && d.email) || CO.email}</a>.</span></p>`
              : st === 'sent'
                ? html`<div className="note ok" style=${{ margin: 0 }} role="status"><span><b>Thank you. Your request ${num} is in.</b> We emailed you a link to follow it, and we reply by email. Keep the number if you call us.</span></div>`
                : html`<form className="form" onSubmit=${send} noValidate>
                    <${BotTrap} />
                    <div className="row2">
                      <${Field} label="Your name"><input value=${f.name} onInput=${up('name')} autoComplete="name" /><//>
                      <${Field} label="Your email"><input type="email" value=${f.email} onInput=${up('email')} autoComplete="email" /><//>
                    </div>
                    <div className="row2">
                      <${Field} label="Which portal">${d ? html`<select value=${f.portal} onChange=${up('portal')}>${Object.entries(d.portals).map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select>` : html`<select disabled><option>…</option></select>`}<//>
                      <${Field} label="What it is about">${d ? html`<select value=${f.topic} onChange=${up('topic')}>${Object.entries(d.topics).map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select>` : html`<select disabled><option>…</option></select>`}<//>
                    </div>
                    <${Field} label="Short title"><input value=${f.title} onInput=${up('title')} maxLength="120" placeholder="For example: new phone, can't get my code" /><//>
                    <${Field} label="What happened" hint="What you tried and any message you saw. No passwords or codes, please."><textarea rows="6" value=${f.body} onInput=${up('body')} /><//>
                    ${err && html`<p className="err" role="alert">${err}</p>`}
                    <button className="btn" disabled=${st === 'busy'}>${st === 'busy' ? 'Sending…' : 'Send the request'}</button>
                  </form>`}
          </div>
        </div>
      </div></section>
    <//>`;
}
function SupportStatus({ k }) {
  const [t, setT] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [sendErr, setSendErr] = useState('');
  useEffect(() => {
    setErr('');
    setT(null);
    api('pub_support_ticket', { k }).then(r => setT(r.ticket), e => setErr(errText(e)));
  }, [k]);
  const reply = async e => {
    e.preventDefault();
    setSendErr('');
    setBusy(true);
    try {
      setT((await api('pub_support_reply', { k, body: msg })).ticket);
      setMsg('');
    } catch (x) {
      setSendErr(errText(x));
    } finally {
      setBusy(false);
    }
  };
  return html`<${Fragment}>
      <${PageHead} title=${t ? t.num + ': ' + t.title : 'Your support request'} crumb=${html`<a href="#/support">Help & support</a>`} />
      <section className="sec"><div className="wrap stack" style=${{ gap: 18, maxWidth: 820 }}>
        ${err
          ? html`<p className="note amber"><span>${err} <a href="#/support">Help & support</a></span></p>`
          : !t
            ? html`<${Spinner} />`
            : html`<${Fragment}>
                <div className="actions"><${Chip} s=${t.st === 'resolved' || t.st === 'closed' ? 'ok' : t.st === 'hold' ? 'amber' : ''}>${t.stName}<//><span className="muted small">${t.pri} · sent ${fmtTs(t.created)} · updated ${fmtTs(t.updated)}</span></div>
                <div className="panel stack" style=${{ gap: 10 }}>
                  <div className="supnote"><b>${t.by}</b><span className="muted small">${fmtTs(t.created)}</span><p>${t.body}</p></div>
                  ${t.notes.map((n, i) => html`<div key=${i} className=${'supnote' + (n.by === 'You' ? '' : ' them')}><b>${n.by}</b><span className="muted small">${fmtTs(n.at)}</span><p>${n.body}</p></div>`)}
                </div>
                ${t.open
                  ? html`<form className="panel form" onSubmit=${reply}>
                      <${Field} label="Add a message"><textarea rows="4" value=${msg} onInput=${e => setMsg(e.target.value)} /><//>
                      ${sendErr && html`<p className="err" role="alert">${sendErr}</p>`}
                      <button className="btn" disabled=${busy || !msg.trim()}>${busy ? 'Sending…' : 'Send'}</button>
                    </form>`
                  : html`<p className="muted">This request is closed. If you still need help, <a href="#/support">send a new one</a> and mention ${t.num}.</p>`}
              <//>`}
      </div></section>
    <//>`;
}

/* ---- privacy: the data request form on #/privacy, and the confirmation link it emails ---- */
function PrivacyRequest({ q }) {
  const [f, setF] = useState({ kind: 'access', email: '', name: '', region: 'us', msg: '' });
  const [st, setSt] = useState(q.confirm ? 'confirming' : 'idle');
  const [err, setErr] = useState('');
  const [info, setInfo] = useState(null);
  useEffect(() => {
    if (q.confirm)
      api('priv_confirm', { t: q.confirm }).then(
        r => {
          setInfo(r);
          setSt('confirmed');
        },
        x => {
          setErr(errText(x));
          setSt('idle');
        }
      );
  }, [q.confirm]);
  // the footer's "Your privacy choices" link (and the emailed confirmation link) open the page at the form
  useEffect(() => {
    if (q.req || q.confirm) setTimeout(() => {
      const el = document.getElementById('privacy-request');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
  }, [q.req, q.confirm]);
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const send = async e => {
    e.preventDefault();
    setErr('');
    setSt('busy');
    try {
      await api('priv_request', { ...f, website: botTrap.hp, t0: botTrap.t0 });
      setSt('sent');
    } catch (x) {
      setErr(errText(x));
      setSt('idle');
    }
  };
  return html`<div className="panel" id="privacy-request">
      <h2 style=${{ margin: '0 0 14px', fontSize: 24, lineHeight: 1.2 }}>Your data: see it, correct it, delete it</h2>
      ${
        st === 'confirming'
          ? html`<${Spinner} label="Confirming your request…" />`
          : st === 'confirmed'
            ? html`<p className="note ok" style=${{ margin: 0 }}><span>Your request is confirmed. We will answer by <b>${fmtDay(info.due)}</b> at the latest.</span></p>`
            : st === 'sent'
              ? html`<p className="note ok" style=${{ margin: 0 }}><span>Almost done: we emailed <b>${f.email}</b> a link to confirm the request. It protects your data from requests made in your name by someone else.</span></p>`
              : html`<form className="form" onSubmit=${send} noValidate>
                  <${BotTrap} />
                  <${Field} label="What would you like?">
                    <select value=${f.kind} onChange=${up('kind')}>
                      <option value="access">A copy of the information you hold about me</option>
                      <option value="correct">Correct my information</option>
                      <option value="delete">Delete my information</option>
                      <option value="optout">Stop contacting me / using my information</option>
                    </select>
                  <//>
                  <div className="row2">
                    <${Field} label="Your email"><input type="email" value=${f.email} onInput=${up('email')} autoComplete="email" /><//>
                    <${Field} label="Your name"><input value=${f.name} onInput=${up('name')} autoComplete="name" /><//>
                  </div>
                  <${Field} label="Where you live">
                    <select value=${f.region} onChange=${up('region')}><option value="us">United States</option><option value="ca">Canada</option><option value="eu">European Union</option><option value="uk">United Kingdom</option><option value="other">Elsewhere</option></select>
                  <//>
                  <${Field} label="Anything we should know (optional)"><textarea rows="3" value=${f.msg} onInput=${up('msg')} /><//>
                  ${err && html`<p className="err" role="alert">${err}</p>`}
                  <button className="btn" disabled=${st === 'busy'}>${st === 'busy' ? 'Sending…' : 'Send the request'}</button>
                  <p className="muted small" style=${{ margin: 0 }}>We answer within 45 days (one month in the EU and UK). Records the law requires us to keep, such as payroll and Form I-9, are kept for their legal period.</p>
                </form>`
      }
    </div>`;
}

/* ---- staff: a new login's invitation (no temporary passwords any more: the person chooses their own) ---- */
function InviteResult({ name, email, link, mailed }) {
  const toast = useToast();
  return html`<div className="stack" style=${{ gap: 10 }}>
      <div className="note ok" style=${{ margin: 0 }}><span><b>${name || email}</b>${mailed ? ' was emailed an invitation to choose a password.' : '’s login is ready. Email is not set up yet, so send them the invitation link yourself.'}</span></div>
      <dl className="kv">
        <dt>Email</dt><dd>${email}</dd>
        ${link && html`<dt>Invitation link</dt><dd><code style=${{ overflowWrap: 'anywhere' }}>${link}</code></dd>`}
      </dl>
      ${link && html`<div className="actions"><button type="button" className="btn ghost sm" onClick=${() => navigator.clipboard && navigator.clipboard.writeText(link).then(() => toast('Link copied.'))}>Copy the link</button></div>`}
      <p className="muted small" style=${{ margin: 0 }}>The link works once, for 7 days${mailed ? '; keep it in case the email lands in spam' : ''}. Send it only to ${firstName(name) || 'them'}: whoever opens it chooses the password.</p>
    </div>`;
}

/* ---- staff: someone else's sign-in (Roles & access, the team record): lock, two-step sign-in, sessions, reset ---- */
function UserSignInPanel({ uid, name }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState('');
  const [link, setLink] = useState('');
  const [temp, setTemp] = useState('');
  const [run, reauthModal] = useReauth();
  const load = () => api('sec_user', { uid }).then(setD, () => setD({ manage: false, hidden: true }));
  useEffect(() => {
    load();
  }, [uid]);
  const act = async (route, msg, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(route);
    try {
      const r = await run(() => api(route, { uid }));
      if (route === 'sec_user_reset_link') {
        setLink(r.link || '');
        toast(r.mailed ? 'Reset link emailed to ' + (firstName(name) || 'them') + '.' : r.link ? 'Email is not set up: copy the link below and send it to them.' : 'The link could not be emailed.');
      } else if (route === 'admin_reset') {
        setTemp(r.password || '');
      } else toast(msg);
      load();
    } catch (x) {
      if (!x || x.code !== 'cancelled') toast(errText(x), true);
    }
    setBusy('');
  };
  if (!d) return html`<${Spinner} />`;
  if (d.hidden) return null;
  const NAMES = { totp: 'authenticator app', passkey: 'passkey', email: 'email codes', backup: 'backup codes' };
  const methods = (d.methods || []).filter(m => m !== 'backup');
  return html`<div className="stack" style=${{ gap: 8 }}>
      ${reauthModal}
      <div className="small">
        <b>Sign-in:</b> ${methods.length ? 'two-step sign-in with ' + methods.map(m => NAMES[m]).join(' and ') : d.required ? html`<span style=${{ color: 'var(--red-ink)' }}>no second step yet (required for this role${d.due > Date.now() ? ' from ' + fmtDay(d.due) : ''})</span>` : 'password only'}${d.locked ? html` · <span style=${{ color: 'var(--red-ink)' }}>locked until ${fmtTs(d.locked)}</span>` : ''}${d.must ? ' · must choose a new password' : ''} · ${d.sessions} active session${d.sessions === 1 ? '' : 's'}
      </div>
      ${
        d.manage
          ? html`<div className="actions">
              <button type="button" className="btn ghost sm" disabled=${!!busy} onClick=${() => act('sec_user_reset_link', '')}>Email a password reset link</button>
              <button type="button" className="btn ghost sm" disabled=${!!busy} onClick=${() => act('admin_reset', '', 'Set a temporary password? Their sessions end, and they must choose a new password when they next sign in.')}>Set a temporary password</button>
              ${d.locked > 0 && html`<button type="button" className="btn ghost sm" disabled=${!!busy} onClick=${() => act('sec_user_unlock', 'Unlocked.')}>Unlock</button>`}
              ${methods.length > 0 && html`<button type="button" className="btn ghost sm" disabled=${!!busy} onClick=${() => act('sec_user_mfa_reset', 'Two-step sign-in reset; they set it up again at their next sign-in.', 'Reset ' + (firstName(name) || 'their') + '’s two-step sign-in? Do this only after confirming who is asking (a call or a video chat), never because of an email alone.')}>Reset two-step sign-in</button>`}
              ${d.sessions > 0 && html`<button type="button" className="btn ghost sm" disabled=${!!busy} onClick=${() => act('sec_user_revoke', 'Signed out everywhere.')}>Sign out everywhere</button>`}
            </div>`
          : html`<p className="muted small" style=${{ margin: 0 }}>Only an administrator can change the sign-in of staff accounts.</p>`
      }
      ${link && html`<p className="small" style=${{ margin: 0 }}>Reset link (works once, 30 minutes): <code style=${{ overflowWrap: 'anywhere' }}>${link}</code></p>`}
      ${temp && html`<p className="small" style=${{ margin: 0 }}>Temporary password: <code>${temp}</code>. Share it privately; they must choose their own password when they sign in with it.</p>`}
    </div>`;
}
