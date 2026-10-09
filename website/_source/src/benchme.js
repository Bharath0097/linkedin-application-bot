/* ================= v36: the consultant's side of the bench desk ================= */
// "My submissions" in the portal, and the two links a recruiter emails: approve a submission (#/rtr?t=…) and
// confirm your details (#/my-details?t=…). Nothing here shows the recruiter's internal notes or other people.
const BDM_FIELDS = [
  ['avail', 'Availability'],
  ['rate', 'Rate'],
  ['loc', 'Location and work mode'],
  ['auth', 'Work authorization'],
];
const BDM_MD = ['Onsite', 'Hybrid', 'Remote', 'Any'];
const BDM_RELOC = ['Open', 'Remote only', 'Local only', 'Specific states'];
const bdmDate = k => (k ? fmtDate(k, { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const bdmScope = v => (v.scope === 'client' ? 'any role at ' + (v.client || 'this end client') + (v.vendor ? ' through ' + v.vendor : '') : 'this role only');

/* Approve or decline a submission: the role, the vendor chain, the rate, the scope and the end date. */
function BdRtrForm({ v, onAnswer }) {
  const [name, setName] = useState('');
  const [other, setOther] = useState('');
  const [otherWho, setOtherWho] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async ok => {
    setErr('');
    if (ok && name.trim().length < 3) return setErr('Type your full name to approve.');
    if (ok && !other) return setErr('Say whether anyone else already submitted you for this role.');
    setBusy(true);
    try {
      await onAnswer({ ok: ok ? 1 : 0, name: name.trim(), note: note.trim(), other: ok ? other : '', otherWho: ok && other === 'yes' ? otherWho.trim() : '' });
    } catch (e) {
      setErr(errText(e));
    }
    setBusy(false);
  };
  return html`<div className="stack bdrtr" style=${{ gap: 14 }}>
      <dl className="bddl">
        <dt>Role</dt><dd><b>${v.role}</b></dd>
        ${v.chain && html`<dt>Your profile goes to</dt><dd>${v.chain}</dd>`}
        ${(v.loc || v.md) && html`<dt>Where</dt><dd>${[v.loc, v.md].filter(Boolean).join(' · ')}</dd>`}
        ${(v.ty || v.dur) && html`<dt>Type</dt><dd>${[v.ty, v.dur].filter(Boolean).join(' · ')}</dd>`}
        ${v.rate && html`<dt>Rate</dt><dd>${v.rate}</dd>`}
        <dt>Scope</dt><dd>${bdmScope(v)}</dd>
        <dt>Until</dt><dd>${bdmDate(v.until)}</dd>
      </dl>
      ${v.note && html`<div className="note info"><span><b>From ${v.by || 'your recruiter'}:</b> ${v.note}</span></div>`}
      <p className="small">By approving, you allow StratEdge IT Consulting to submit your profile for ${bdmScope(v)}, at the rate shown, until ${bdmDate(v.until)}, and you agree not to be submitted for the same role through anyone else during that time. Nothing is sent before you approve.</p>
      <div className="stack" style=${{ gap: 6 }}>
        <span className="lbl">Has anyone else (another company or recruiter) submitted you for this role in the last 90 days?</span>
        <div className="seg" role="group" aria-label="Submitted by anyone else">
          ${[
            ['no', 'No'],
            ['yes', 'Yes'],
          ].map(([k, l]) => html`<button key=${k} type="button" className=${other === k ? 'on' : ''} onClick=${() => setOther(k)}>${l}</button>`)}
        </div>
        ${other === 'yes' && html`<${Field} label="Who submitted you, and when (as far as you know)"><input value=${otherWho} onInput=${e => setOtherWho(e.target.value)} placeholder="e.g. another vendor, last week" /><//>`}
      </div>
      <${Field} label="Type your full name to approve"><input value=${name} onInput=${e => setName(e.target.value)} autoComplete="name" placeholder=${v.full || ''} /><//>
      <${Field} label="A note for your recruiter (optional)"><input value=${note} onInput=${e => setNote(e.target.value)} placeholder="e.g. available for interviews after 2 pm ET" /><//>
      ${err && html`<div className="note red" role="alert"><span>${err}</span></div>`}
      <div className="actions">
        <button type="button" className="btn ghost" disabled=${busy} onClick=${() => go(false)}>Decline</button>
        <button type="button" className="btn go" disabled=${busy} onClick=${() => go(true)}>${busy ? 'Saving…' : 'Approve'}</button>
      </div>
    </div>`;
}

/* Confirm or correct the details a recruiter asked about. Each one: still correct, or change it. */
function BdDetailsForm({ d, onSave, fields }) {
  const ask = fields || d.fields;
  const [v, setV] = useState({ ...d.v });
  const [mode, setMode] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const up = k => e => setV({ ...v, [k]: e.target.value });
  const cur = k =>
    k === 'avail'
      ? [d.v.avail, d.v.availDate ? 'from ' + bdmDate(d.v.availDate) : ''].filter(Boolean).join(', ')
      : k === 'loc'
        ? [d.v.loc, d.v.md, d.v.reloc ? 'relocation: ' + d.v.reloc : ''].filter(Boolean).join(' · ')
        : d.v[k];
  const save = async () => {
    setErr('');
    const left = ask.filter(k => !mode[k]);
    if (left.length) return setErr('Answer each one: ' + left.map(k => (BDM_FIELDS.find(x => x[0] === k) || [k, k])[1].toLowerCase()).join(', ') + '.');
    const keys = { avail: ['avail', 'availDate'], rate: ['rate'], loc: ['loc', 'md', 'reloc'], auth: ['auth'] };
    const out = {};
    const same = {};
    ask.forEach(k => {
      if (mode[k] === 'same') same[k] = 1;
      else keys[k].forEach(x => (out[x] = v[x] || ''));
    });
    setBusy(true);
    try {
      await onSave({ v: out, same });
    } catch (e) {
      setErr(errText(e));
    }
    setBusy(false);
  };
  return html`<div className="stack" style=${{ gap: 12 }}>
      ${ask.map(k => {
        const label = (BDM_FIELDS.find(x => x[0] === k) || [k, k])[1];
        return html`<div key=${k} className="bdmfield">
          <div className="bdmfh">
            <div><b>${label}</b><div className="muted small">${cur(k) || 'Not recorded yet'}</div></div>
            <div className="seg" role="group" aria-label=${label}>
              <button type="button" className=${mode[k] === 'same' ? 'on' : ''} disabled=${!cur(k)} onClick=${() => setMode({ ...mode, [k]: 'same' })}>Still correct</button>
              <button type="button" className=${mode[k] === 'change' ? 'on' : ''} onClick=${() => setMode({ ...mode, [k]: 'change' })}>${cur(k) ? 'Change it' : 'Add it'}</button>
            </div>
          </div>
          ${
            mode[k] === 'change' &&
            (k === 'avail'
              ? html`<div className="row2 form"><${Field} label="When can you start?"><input value=${v.avail} onInput=${up('avail')} placeholder="e.g. Immediately, 2 weeks’ notice" /><//><${Field} label="Available from (optional)"><input type="date" value=${v.availDate} onInput=${up('availDate')} /><//></div>`
              : k === 'rate'
                ? html`<div className="form"><${Field} label="Your rate" hint="Hourly or yearly, and the terms (W2, C2C, 1099)."><input value=${v.rate} onInput=${up('rate')} placeholder="e.g. $70/hr C2C" /><//></div>`
                : k === 'loc'
                  ? html`<div className="row3 form"><${Field} label="Where you live"><input value=${v.loc} onInput=${up('loc')} placeholder="City, state" /><//><${Field} label="Work mode"><select value=${v.md} onChange=${up('md')}><option value="">Choose…</option>${BDM_MD.map(x => html`<option key=${x}>${x}</option>`)}</select><//><${Field} label="Relocation"><select value=${v.reloc} onChange=${up('reloc')}><option value="">Choose…</option>${BDM_RELOC.map(x => html`<option key=${x}>${x}</option>`)}</select><//></div>`
                  : html`<div className="form"><${Field} label="Work authorization"><select value=${v.auth} onChange=${up('auth')}><option value="">Choose…</option>${AUTH_TYPES.map(x => html`<option key=${x}>${x}</option>`)}</select><//></div>`)
          }
        </div>`;
      })}
      ${err && html`<div className="note red" role="alert"><span>${err}</span></div>`}
      <div className="actions"><button type="button" className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Send my answers'}</button></div>
    </div>`;
}

/* v83: a recruiting record under this account's email links only after a one-time code sent to that email. */
function BdLinkPanel({ onLinked }) {
  const toast = useToast();
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const run = async body => {
    setBusy(true);
    setErr('');
    try {
      const r = await api('bd_my_link', body);
      if (r.sent) {
        setSent(true);
        toast('We emailed you a code.');
      } else {
        toast('Linked.');
        onLinked();
      }
    } catch (e) {
      setErr(errText(e));
    }
    setBusy(false);
  };
  return html`<section className="panel">
      <h2>Link your recruiting record</h2>
      <p className="muted small">Your recruiter has a record under this account's email. To show your submissions here, confirm the code we send to that email.</p>
      ${
        sent
          ? html`<div className="actions"><label className="fld" style=${{ margin: 0 }}><span>Code from the email</span><input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength="6" value=${code} onInput=${e => setCode(e.target.value.replace(/\D/g, ''))} /></label><button type="button" className="btn" disabled=${busy || code.length !== 6} onClick=${() => run({ code })}>${busy ? 'Checking…' : 'Link my record'}</button><button type="button" className="btn ghost sm" disabled=${busy} onClick=${() => run({})}>Send a new code</button></div>`
          : html`<div className="actions"><button type="button" className="btn" disabled=${busy} onClick=${() => run({})}>${busy ? 'Sending…' : 'Email me a code'}</button></div>`
      }
      ${err && html`<div className="note red" role="alert"><span>${err}</span></div>`}
    </section>`;
}

/* The portal page: approvals to give, details, and every submission in plain words. */
function MySubsPage() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const load = () =>
    api('bd_my', {}).then(
      r => {
        setD(r);
        setErr(null);
      },
      e => setErr(e)
    );
  useEffect(() => {
    load();
  }, []);
  if (err) return html`<div className="note red"><span>${errText(err)}</span><div className="actions"><button className="btn sm" onClick=${load}>Try again</button></div></div>`;
  if (!d) return html`<${Spinner} />`;
  const det = d.details;
  const due = det ? BDM_FIELDS.map(x => x[0]).filter(k => det.fresh[k] && det.fresh[k].st !== 'fresh') : [];
  return html`<div className="stack">
      ${!d.linked && d.claim && html`<${BdLinkPanel} onLinked=${load} />`}
      ${d.pending.map(
        p => html`<section key=${p.sid} className="panel">
          <h2>Needs your approval: ${p.role}</h2>
          <p className="muted small">${p.by || 'Your recruiter'} would like to submit you for this role.</p>
          <${BdRtrForm} v=${p} onAnswer=${async a => {
            await api('bd_my_rtr', { sid: p.sid, ...a });
            toast(a.ok ? 'Approved. Your recruiter sends it next.' : 'Declined. Your recruiter was told.');
            load();
          }} />
        </section>`
      )}
      ${
        det &&
        html`<section className="panel">
          <div className="bdsech"><h2>Your details</h2>${!confirming && html`<button className="btn ghost sm" onClick=${() => setConfirming(true)}>${due.length ? 'Confirm what is due' : 'Review my details'}</button>`}</div>
          ${
            confirming
              ? html`<${BdDetailsForm} d=${det} fields=${due.length ? due : BDM_FIELDS.map(x => x[0])} onSave=${async a => {
                  await api('bd_my_confirm', { cid: det.cid, ...a });
                  toast('Thank you. Your recruiter has your answers.');
                  setConfirming(false);
                  load();
                }} />`
              : html`<ul className="bdlist">${BDM_FIELDS.map(
                  ([k, l]) => html`<li key=${k} className="bdrow"><div className="bdmain"><b>${l}</b><div className="muted small">${k === 'avail' ? [det.v.avail, det.v.availDate ? 'from ' + bdmDate(det.v.availDate) : ''].filter(Boolean).join(', ') || 'Not recorded' : k === 'loc' ? [det.v.loc, det.v.md].filter(Boolean).join(' · ') || 'Not recorded' : det.v[k] || 'Not recorded'}</div></div>${det.fresh[k] && det.fresh[k].st !== 'fresh' ? html`<${Chip} s="amber">Please confirm<//>` : html`<${Chip} s="ok">Up to date<//>`}</li>`
                )}</ul>`
          }
        </section>`
      }
      <section className="panel">
        <h2>My submissions</h2>
        ${
          d.subs.length
            ? html`<ul className="bdlist">${d.subs.map(
                s => html`<li key=${s.id} className="bdrow">
                  <div className="bdmain">
                    <b>${s.role}</b>
                    ${s.hc ? html`<div className="small">${s.hc}</div>` : ''}
                    <div className="muted small">${[s.vendor && (s.client ? s.vendor + ' → ' + s.client : s.vendor), s.loc, s.md, s.d ? 'sent ' + bdmDate(s.d) : '', s.intv ? 'interview ' + s.intv : '', s.by ? 'recruiter ' + s.by : ''].filter(Boolean).join(' · ')}</div>
                    <div className="small">${s.desc}</div>
                  </div>
                  <${Chip} s=${s.st === 'placed' ? 'ok' : ['rejected', 'withdrawn', 'closed'].includes(s.st) ? 'red' : ['interview', 'offer'].includes(s.st) ? 'new' : s.st === 'approval' ? 'amber' : ''}>${s.label}<//>
                </li>`
              )}</ul>`
            : html`<${Empty} title="Nothing yet">${d.linked ? 'When your recruiter prepares or sends a submission for you, it shows here with its status.' : d.claim ? 'Your recruiting record is not linked to this account yet. It links once you enter the code we email to you (above).' : 'Your recruiting record is not linked to this account yet. It links by the email your recruiter has for you; ask them to check it.'}<//>`
        }
      </section>
    </div>`;
}

/* The email link: approve or decline a submission (no account needed). */
function RtrPage({ q }) {
  const t = (q && q.t) || '';
  const [v, setV] = useState(null);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);
  useEffect(() => {
    if (!/^[A-Za-z0-9_-]{1,40}\.[a-f0-9]{24}$/.test(t)) {
      setErr('This link is not complete. Open it from the email again.');
      return;
    }
    api('bd_rtr_get', { t }).then(setV, e => setErr(errText(e)));
  }, [t]);
  const shell = body => html`<${Fragment}>
      <${PageHead} title="Approve a submission" intro="StratEdge IT Consulting asks for your approval before submitting your profile." />
      <section className="sec"><div className="wrap" style=${{ maxWidth: 760 }}>${body}</div></section>
    <//>`;
  if (err) return shell(html`<div className="note red"><span>${err}</span></div>`);
  if (!v) return shell(html`<${Spinner} />`);
  if (done || v.st === 'approved' || v.st === 'declined') {
    const ok = done ? done.ok : v.st === 'approved';
    return shell(html`<div className="panel stack" style=${{ gap: 10 }}>
        <h2>${ok ? 'Thank you, ' + v.name + '. You approved it.' : 'You declined this submission.'}</h2>
        <p>${ok ? 'Your recruiter sends your profile for ' + v.role + ' next and keeps you posted.' : 'Your recruiter was told and will not submit you for ' + v.role + '.'}</p>
        <p className="muted small">If you have a StratEdge portal account, “My submissions” shows every submission and its status. <a href="#/login">Sign in</a></p>
      </div>`);
  }
  return shell(html`<div className="panel">
      <p>Hi ${v.name}, ${v.by || 'your recruiter'} would like to submit you for this role. Please read it and answer.</p>
      <${BdRtrForm} v=${v} onAnswer=${async a => {
        await api('bd_rtr_answer', { t, ...a });
        setDone({ ok: !!a.ok });
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }} />
    </div>`);
}

/* The email link: confirm or correct the details a recruiter asked about (no account needed). */
function MyDetailsPage({ q }) {
  const t = (q && q.t) || '';
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!/^[A-Za-z0-9_-]{1,40}\.[a-f0-9]{24}$/.test(t)) {
      setErr('This link is not complete. Open it from the email again.');
      return;
    }
    api('bd_confirm_get', { t }).then(setD, e => setErr(errText(e)));
  }, [t]);
  const shell = body => html`<${Fragment}>
      <${PageHead} title="Confirm your details" intro="So that StratEdge IT Consulting only submits you with up-to-date availability, rate and location." />
      <section className="sec"><div className="wrap" style=${{ maxWidth: 760 }}>${body}</div></section>
    <//>`;
  if (err) return shell(html`<div className="note red"><span>${err}</span></div>`);
  if (!d) return shell(html`<${Spinner} />`);
  if (done || d.done)
    return shell(html`<div className="panel stack" style=${{ gap: 10 }}>
        <h2>Thank you${d.name ? ', ' + d.name : ''}.</h2>
        <p>Your recruiter has your answers. You can close this page.</p>
      </div>`);
  return shell(html`<div className="panel stack" style=${{ gap: 12 }}>
      <p>Hi ${d.name}, please check each of these. Say what is still correct and change only what is not.</p>
      <${BdDetailsForm} d=${d} onSave=${async a => {
        await api('bd_confirm_answer', { t, ...a });
        setDone(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }} />
    </div>`);
}
