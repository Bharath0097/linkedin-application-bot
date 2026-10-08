/* ================= v33: the candidate's secure form (#/confirm?t=…) =================
   The screening agent emails a personal link; the candidate (or the vendor who sent them) confirms the basics,
   LinkedIn and two references, answers a few questions about the job, and adds a copy of their work authorization.
   No login: the token in the link is the key, it works once and runs out after a few days. */
const CF_AUTH = ['US Citizen', 'Green Card', 'GC EAD', 'H-1B', 'H-4 EAD', 'L-2 EAD', 'OPT EAD', 'STEM OPT', 'TN', 'E-3', 'Other'];
const CF_REL = ['Manager', 'Client contact', 'Team lead', 'Peer'];
function ConfirmPage({ q }) {
  const tok = (q && q.t) || '';
  const [d, setD] = useState(null);
  const [f, setF] = useState({ ph: '', loc: '', auth: '', authUntil: '', avail: '', rate: '', emp: '', reloc: '', li: '', consent: false });
  const [refs, setRefs] = useState([{ n: '', ti: '', co: '', e: '', ph: '', rel: 'Manager' }, { n: '', ti: '', co: '', e: '', ph: '', rel: 'Client contact' }]);
  const [qa, setQa] = useState([]);
  const [pastes, setPastes] = useState([]);
  const [files, setFiles] = useState({ wa: null, id: null });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState(false);
  const t0 = useRef(Date.now());
  useEffect(() => {
    if (!/^[a-f0-9]{32}$/.test(tok)) {
      setD({ state: 'gone' });
      return;
    }
    api('ag_form', { t: tok })
      .then(r => {
        setD(r);
        setQa((r.qs || []).map(() => ''));
        setPastes((r.qs || []).map(() => 0));
        t0.current = Date.now();
      })
      .catch(e => setD({ state: 'error', err: errText(e) }));
  }, [tok]);
  const up = k => e => {
    setErr('');
    setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  };
  const setRef = (i, k, v) => setRefs(refs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const noExpiry = f.auth === 'US Citizen' || f.auth === 'Green Card';
  const submit = async () => {
    setErr('');
    const ask = d.ask || {};
    if (ask.basics) {
      if (String(f.ph).replace(/\D/g, '').length < 10) return setErr('Add a phone number we can reach you on.');
      if (!f.loc.trim() || !f.auth) return setErr('Add where you live and your work authorization.');
      if (!f.consent) return setErr('Please confirm the details are accurate.');
    }
    if (ask.refs && refs.filter(r => r.n.trim()).length < 2) return setErr('Add two references (a manager or a client contact you worked with).');
    if (qa.some(a => a.trim().length < 20)) return setErr('Please answer each question in a few sentences.');
    if (ask.docs && !files.wa) return setErr('Add a copy of your work authorization (or a passport for US citizens).');
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('t', tok);
      fd.append('answers', JSON.stringify({ ...f, authUntil: noExpiry ? '' : f.authUntil, refs, qa, pastes, secs: Math.round((Date.now() - t0.current) / 1000) }));
      if (files.wa) fd.append('wa', files.wa);
      if (files.id) fd.append('id', files.id);
      await api('ag_submit', fd, { timeout: 120000 });
      setSent(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setErr(errText(e));
    }
    setBusy(false);
  };
  const shell = (title, body) => html`<${Fragment}>
      <${PageHead} title=${title} intro=${d && d.job ? 'For the ' + d.job + ' role' + (d.loc ? ' in ' + d.loc : '') + ' at StratEdge IT Consulting.' : 'StratEdge IT Consulting'} />
      <section className="sec"><div className="wrap" style=${{ maxWidth: 820 }}>${body}</div></section>
    <//>`;
  if (!d) return shell('Confirm your details', html`<div className="panel"><${Spinner} /></div>`);
  if (sent) return shell('Thank you', html`<div className="panel"><div className="note ok"><span><b>Received.</b> Thank you${d.first && !d.vendor ? ', ' + d.first : ''}. Our recruiting team has your details and will be in touch about the ${d.job || 'role'}. You can close this page.</span></div></div>`);
  if (d.state === 'done') return shell('Already received', html`<div className="panel"><div className="note ok"><span>We already have these details. Thank you! If something changed, reply to the email and the recruiter will update it.</span></div></div>`);
  if (d.state === 'expired') return shell('This link has run out', html`<div className="panel"><div className="note amber"><span>The link was valid for a few days only. Reply to the email you received and the recruiter will send a new one.</span></div></div>`);
  if (d.state !== 'open') return shell('Link not valid', html`<div className="panel"><div className="note red"><span>${d.err || 'This link is not valid. Check that the whole link was copied, or reply to the email you received.'}</span></div></div>`);
  const ask = d.ask || {};
  return shell(
    d.vendor ? 'Details for ' + d.name : 'Hi ' + d.first + ', please confirm your details',
    html`<div className="stack cform">
      <div className="note info"><span>${d.vendor ? html`You (or ${d.name}) can fill this in. ` : ''}It takes about 5 to 10 minutes. The link is personal and works until ${fmtDay(d.exp)}. Only our recruiting team sees your answers.</span></div>
      ${
        ask.basics &&
        html`<section className="panel form">
          <h3 className="ph">1. The basics</h3>
          <div className="row2">
            <${Field} label="Phone"><input type="tel" autoComplete="tel" value=${f.ph} onInput=${up('ph')} placeholder="(201) 555-0100" /><//>
            <${Field} label="Where you live" hint="City, State"><input autoComplete="address-level2" value=${f.loc} onInput=${up('loc')} placeholder="Edison, NJ" /><//>
          </div>
          <div className="row2">
            <${Field} label="Work authorization"><select value=${f.auth} onChange=${up('auth')}><option value="">Choose…</option>${CF_AUTH.map(a => html`<option key=${a}>${a}</option>`)}</select><//>
            ${!noExpiry && html`<${Field} label="Valid until" hint="The end date on your visa or EAD"><input type="date" value=${f.authUntil} onInput=${up('authUntil')} /><//>`}
          </div>
          <div className="row3">
            <${Field} label="Available from"><input value=${f.avail} onInput=${up('avail')} placeholder="Immediately / 2 weeks notice" /><//>
            <${Field} label="Expected rate"><input value=${f.rate} onInput=${up('rate')} placeholder="$70/hr C2C" /><//>
            <${Field} label="Open to relocate?"><select value=${f.reloc} onChange=${up('reloc')}><option value="">—</option><option>Yes</option><option>No</option><option>Depends on the role</option></select><//>
          </div>
          <${Field} label="Current or last employer"><input value=${f.emp} onInput=${up('emp')} /><//>
        </section>`
      }
      ${
        ask.refs &&
        html`<section className="panel form">
          <h3 className="ph">2. LinkedIn and two references</h3>
          <${Field} label="LinkedIn profile" hint="linkedin.com/in/your-name"><input type="url" value=${f.li} onInput=${up('li')} placeholder="https://www.linkedin.com/in/your-name" /><//>
          ${refs.map(
            (r, i) => html`<div key=${i} className="cfref">
              <b className="small">Reference ${i + 1}</b>
              <div className="row3">
                <${Field} label="Name"><input value=${r.n} onInput=${e => setRef(i, 'n', e.target.value)} /><//>
                <${Field} label="Title"><input value=${r.ti} onInput=${e => setRef(i, 'ti', e.target.value)} /><//>
                <${Field} label="Company"><input value=${r.co} onInput=${e => setRef(i, 'co', e.target.value)} /><//>
              </div>
              <div className="row3">
                <${Field} label="Work email"><input type="email" value=${r.e} onInput=${e => setRef(i, 'e', e.target.value)} /><//>
                <${Field} label="Phone"><input type="tel" value=${r.ph} onInput=${e => setRef(i, 'ph', e.target.value)} /><//>
                <${Field} label="Worked together as"><select value=${r.rel} onChange=${e => setRef(i, 'rel', e.target.value)}>${CF_REL.map(x => html`<option key=${x}>${x}</option>`)}</select><//>
              </div>
            </div>`
          )}
          <p className="muted small" style=${{ margin: 0 }}>We contact references only after we speak with you.</p>
        </section>`
      }
      ${
        (d.qs || []).length > 0 &&
        html`<section className="panel form">
          <h3 className="ph">3. A few questions about the role</h3>
          <p className="muted small" style=${{ marginTop: 0 }}>Answer from your own work, in your own words: a few sentences each. There are no trick questions.</p>
          ${d.qs.map(
            (qq, i) => html`<${Field} key=${i} label=${i + 1 + '. ' + qq}><textarea rows="4" value=${qa[i] || ''} onInput=${e => setQa(qa.map((x, j) => (j === i ? e.target.value : x)))} onPaste=${() => setPastes(pastes.map((x, j) => (j === i ? x + 1 : x)))} /><//>`
          )}
        </section>`
      }
      ${
        ask.docs &&
        html`<section className="panel form">
          <h3 className="ph">${(d.qs || []).length ? '4' : '3'}. Documents</h3>
          <div className="row2">
            <${Field} label="Work authorization" hint="Visa stamp, EAD or green card; US citizens: passport. PDF or photo, up to 10 MB."><input type="file" accept=".pdf,.jpg,.jpeg,.png,image/*,application/pdf" onChange=${e => setFiles({ ...files, wa: e.target.files[0] || null })} /><//>
            <${Field} label="Photo ID (optional)" hint="Driver's license or state ID."><input type="file" accept=".pdf,.jpg,.jpeg,.png,image/*,application/pdf" onChange=${e => setFiles({ ...files, id: e.target.files[0] || null })} /><//>
          </div>
          <p className="muted small" style=${{ margin: 0 }}>Only our recruiting team can open these, and they are deleted automatically after a few months. You may cover any numbers except the last four digits.</p>
        </section>`
      }
      <section className="panel form">
        ${ask.basics && html`<label className="check"><input type="checkbox" checked=${f.consent} onChange=${up('consent')} /><span>I confirm these details are accurate${d.vendor ? ' (on behalf of ' + d.name + ')' : ''}, and StratEdge IT Consulting may represent ${d.vendor ? 'them' : 'me'} for the ${d.job || 'role'}.</span></label>`}
        ${err && html`<div className="note red"><span>${err}</span></div>`}
        <div className="actions"><button type="button" className="btn lg" disabled=${busy} onClick=${submit}>${busy ? 'Sending…' : 'Send my details'}</button></div>
      </section>
    </div>`
  );
}
