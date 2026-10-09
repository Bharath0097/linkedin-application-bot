/* ================= Share requirements: email, the careers page and social feeds (v31) =================
   Opened from the requirements desk for one requirement or several. The server (api/reqshare.php) makes the public
   version of each one (the vendor's name, contacts, emails, phone numbers and links never go out; the end client and
   a rate only when switched on here), sends the email as a campaign where each person gets the list without the
   requirements that came from their own company, posts on the careers page and keeps the share history. Social
   buttons open each network's own share window with the role's link; job.php gives the networks its title and picture. */
const RS_OPEN = ['open', 'working', 'submitted', 'interview'];
const RS_NETS = [
  { k: 'linkedin', n: 'LinkedIn', c: '#0A66C2', copy: true, url: link => 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(link) },
  { k: 'facebook', n: 'Facebook', c: '#1877F2', copy: true, url: link => 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(link) },
  { k: 'x', n: 'X', c: '#0F1419', url: (link, text, short) => 'https://x.com/intent/tweet?text=' + encodeURIComponent(short) + '&url=' + encodeURIComponent(link) },
  { k: 'whatsapp', n: 'WhatsApp', c: '#1DA851', url: (link, text) => 'https://wa.me/?text=' + encodeURIComponent(text) },
  { k: 'telegram', n: 'Telegram', c: '#229ED9', url: (link, text, short) => 'https://t.me/share/url?url=' + encodeURIComponent(link) + '&text=' + encodeURIComponent(short) },
  { k: 'instagram', n: 'Instagram', c: '#D62976', image: true },
  { k: 'mailto', n: 'Email', c: '#2B3993', url: (link, text, short, subject) => 'mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(text) },
];
const RS_PAGES = [
  ['linkedin', 'LinkedIn page'],
  ['facebook', 'Facebook page'],
  ['x', 'X profile'],
  ['instagram', 'Instagram'],
  ['youtube', 'YouTube'],
];
const rsUniq = l => l.filter((x, i, a) => x && a.findIndex(y => String(y || '').toLowerCase() === String(x).toLowerCase()) === i);
const rsMeta = p => rsUniq([p.loc, p.md, p.ty, p.dur]).join(' · ');
function rsTags(items) {
  const tags = [];
  items.forEach(i =>
    String(i.pub.sk || '')
      .split(/[,/|;]+/)
      .forEach(s => {
        const t = s.trim().replace(/\+/g, 'Plus').replace(/#/g, 'Sharp').replace(/[^A-Za-z0-9]/g, '');
        if (t.length > 1 && t.length < 24 && !tags.includes('#' + t)) tags.push('#' + t);
      })
  );
  const out = tags.slice(0, items.length > 1 ? 3 : 4);
  if (items.some(i => /c2c/i.test(i.pub.ty || ''))) out.push('#C2C');
  return [...out, '#hiring', '#StratEdge'].join(' ');
}
/* The post for LinkedIn, Facebook, WhatsApp and Instagram (link included), the short one for X and Telegram. */
function rsPostText(items, link) {
  if (items.length === 1) {
    const p = items[0].pub;
    const meta = rsMeta(p);
    return [
      `🚀 We're hiring: ${p.ti}`,
      meta ? `📍 ${meta}` : '',
      p.rate ? `💵 ${p.rate}` : '',
      p.sk ? `🛠 ${p.sk}` : '',
      p.visa ? `🪪 ${p.visa}` : '',
      p.client ? `🏢 Client: ${p.client}` : '',
      '',
      `Apply in one click: ${link}`,
      '',
      rsTags(items),
    ]
      .filter((l, i, a) => l !== '' || (a[i - 1] !== '' && i > 0))
      .join('\n');
  }
  const list = items.slice(0, 12).map(i => {
    const more = rsUniq([i.pub.md, i.pub.ty]).filter(x => x.toLowerCase() !== String(i.pub.loc || '').toLowerCase());
    return `• ${i.pub.ti}${i.pub.loc ? ' — ' + i.pub.loc : ''}${more.length ? ' (' + more.join(', ') + ')' : ''}`;
  });
  return [`📢 ${items.length} open requirements at StratEdge IT Consulting:`, '', ...list, items.length > 12 ? `…and ${items.length - 12} more` : '', '', `See them all and apply in one click: ${link}`, '', rsTags(items)].filter((l, i, a) => l !== '' || (a[i - 1] !== '' && i > 0)).join('\n');
}
function rsShortText(items) {
  const tags = rsTags(items).split(' ').filter(t => t !== '#StratEdge').slice(-3).join(' ');
  let t;
  if (items.length === 1) {
    const p = items[0].pub;
    const where = rsUniq([p.loc, p.md]);
    t = `Hiring: ${p.ti}${where.length ? ' (' + where.join(', ') + ')' : ''}${p.ty ? ', ' + p.ty : ''}. Apply in one click 👉`;
  } else {
    t = `${items.length} open roles: ${items.map(i => i.pub.ti).join(', ')}`;
    if (t.length > 200) t = t.slice(0, 197).replace(/,?\s*\S*$/, '') + '…';
    t += '. Apply 👉';
  }
  return (t + ' ' + tags).slice(0, 255); // X adds the link (23 characters)
}
function rsMailDefaults(items, me, kind) {
  const one = items.length === 1;
  const p = one && items[0] ? items[0].pub : null;
  const subject = one && p ? `Requirement: ${p.ti}${p.loc ? ', ' + p.loc : ''}${p.md && p.md !== 'Onsite' ? ' (' + p.md + ')' : ''}` : `Open requirements: ${items.slice(0, 2).map(i => i.pub.ti).join(', ')}${items.length > 2 ? ' +' + (items.length - 2) + ' more' : ''}`;
  const intro =
    kind === 'consultants'
      ? `${one ? 'This role' : 'These roles'} might be a fit for you. If ${one ? 'it fits' : 'one fits'}, reply with your updated resume, your expected rate and when you can start${one ? '' : ', and tell us which role'}.`
      : `${one ? 'We have an open requirement to fill.' : 'Here are open requirements we need to fill.'} If you have a matching consultant, reply with their resume, rate and availability${one ? '' : ', and tell us which requirement it is for'}.`;
  const sign = ['Thanks,', me.name || '', 'StratEdge IT Consulting', me.email || ''].filter(Boolean).join('\n');
  return { subject: subject.slice(0, 200), body: `Hi {first_name},\n\n${intro}\n\n{requirements}\n\n${sign}`, fromName: '', replyTo: me.email || '' };
}
/* A square picture for Instagram and phone sharing (1080×1080): one role, or a list of up to six. */
async function rsSquareImage(items, site) {
  const c = document.createElement('canvas');
  c.width = 1080;
  c.height = 1080;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 1080, 1080);
  g.addColorStop(0, '#0f1b4d');
  g.addColorStop(0.55, '#2b3993');
  g.addColorStop(1, '#0e8f8a');
  x.fillStyle = g;
  x.fillRect(0, 0, 1080, 1080);
  x.globalAlpha = 0.08;
  x.fillStyle = '#fff';
  for (let i = 0; i < 6; i++) {
    x.beginPath();
    x.arc(930 - i * 36, 120 + i * 20, 230 - i * 30, 0, Math.PI * 2);
    x.fill();
  }
  x.globalAlpha = 1;
  const font = (w, s) => `${w} ${s}px Archivo, "Segoe UI", Arial, sans-serif`;
  const wrap = (text, max, size, weight) => {
    x.font = font(weight, size);
    const words = String(text).split(/\s+/);
    const lines = [];
    let line = '';
    words.forEach(w => {
      const t = line ? line + ' ' + w : w;
      if (x.measureText(t).width > max && line) {
        lines.push(line);
        line = w;
      } else line = t;
    });
    lines.push(line);
    return lines;
  };
  x.fillStyle = '#7ff0e3';
  x.font = font(700, 30);
  x.fillText(items.length === 1 ? "WE'RE HIRING" : `${items.length} OPEN REQUIREMENTS`, 72, 150);
  let y = 240;
  if (items.length === 1) {
    const p = items[0].pub;
    x.fillStyle = '#fff';
    wrap(p.ti, 930, 76, 800)
      .slice(0, 4)
      .forEach(l => {
        x.fillText(l, 72, y);
        y += 88;
      });
    y += 10;
    x.fillStyle = '#d6dcff';
    wrap(rsMeta(p), 930, 36, 500)
      .slice(0, 2)
      .forEach(l => {
        x.fillText(l, 72, y);
        y += 50;
      });
    if (p.rate) {
      x.fillStyle = '#7ff0e3';
      x.font = font(700, 34);
      x.fillText(p.rate, 72, y + 6);
      y += 60;
    }
    let cx = 72;
    y += 24;
    x.font = font(600, 28);
    String(p.sk || '')
      .split(/,\s*/)
      .filter(Boolean)
      .slice(0, 6)
      .forEach(s => {
        const w = x.measureText(s).width + 40;
        if (cx + w > 1008) {
          cx = 72;
          y += 66;
        }
        if (y > 860) return;
        x.fillStyle = 'rgba(255,255,255,0.14)';
        x.beginPath();
        x.roundRect ? x.roundRect(cx, y - 38, w, 54, 27) : x.rect(cx, y - 38, w, 54);
        x.fill();
        x.fillStyle = '#fff';
        x.fillText(s, cx + 20, y);
        cx += w + 14;
      });
  } else {
    // fewer roles get bigger type, so the picture reads well on a phone
    const few = items.length <= 3;
    const [ts, tl, ms, gap] = few ? [60, 70, 34, 96] : [44, 52, 28, 66];
    y = few ? 280 : 240;
    items.slice(0, 6).forEach(i => {
      if (y > 840) return;
      x.fillStyle = '#fff';
      const ls = wrap(i.pub.ti, 930, ts, 800).slice(0, 2);
      ls.forEach(l => {
        x.fillText(l, 72, y);
        y += tl;
      });
      x.fillStyle = '#d6dcff';
      x.font = font(500, ms);
      x.fillText(rsMeta(i.pub).slice(0, 60), 72, y - (few ? 8 : 0));
      y += gap;
    });
    if (items.length > 6) {
      x.fillStyle = '#7ff0e3';
      x.font = font(700, 30);
      x.fillText(`+${items.length - 6} more`, 72, y);
    }
  }
  x.fillStyle = '#fff';
  x.beginPath();
  x.roundRect ? x.roundRect(72, 948, 380, 70, 35) : x.rect(72, 948, 380, 70);
  x.fill();
  x.fillStyle = '#0f1b4d';
  x.font = font(800, 28);
  x.fillText('Apply in one click →', 100, 993);
  x.fillStyle = '#d6dcff';
  x.font = font(600, 24);
  x.textAlign = 'right';
  x.fillText(site, 1008, 993);
  x.textAlign = 'left';
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = LOGO_D;
    });
    const h = 58;
    const w = (img.width / img.height) * h;
    x.drawImage(img, 1008 - w, 62, w, h);
  } catch (e) {
    /* no logo, still a good picture */
  }
  return new Promise(res => c.toBlob(res, 'image/png'));
}
const rsCopy = async (toast, text, msg) => {
  try {
    await navigator.clipboard.writeText(text);
    toast(msg || 'Copied.');
    return true;
  } catch (e) {
    toast('Select the text and copy it (the browser did not allow copying).', true);
    return false;
  }
};
const rsLog = (ids, ch) => api('rs_log', { ids, ch }).catch(() => {});
const RS_CH = { email: 'Email', careers: 'Careers page', 'careers-off': 'Taken off the careers page', linkedin: 'LinkedIn', facebook: 'Facebook', x: 'X', whatsapp: 'WhatsApp', telegram: 'Telegram', instagram: 'Instagram', mailto: 'Email app', copy: 'Link copied', native: 'Shared from the phone', image: 'Picture saved' };

/* ---- the dialog ---- */
function ReqShareModal({ ids, onClose, onChanged }) {
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState(null);
  const [ov, setOv] = useState({}); // what is sent: the choices per requirement (title, description, rate, client)
  const [ed, setEd] = useState({}); // what the person typed, shown in the fields
  const [on, setOn] = useState(ids);
  const [edit, setEdit] = useState(ids.length === 1 ? ids[0] : null);
  const [tab, setTab] = useState(Cap.mail ? 'email' : 'careers');
  const ovKey = JSON.stringify(ov);
  const load = () =>
    api('rs_info', { ids, ps: ov })
      .then(r => {
        setInfo(r);
        setErr(null);
        return r;
      })
      .catch(e => {
        setErr(e);
        return null;
      });
  useEffect(() => {
    const t = setTimeout(load, info ? 450 : 0);
    return () => clearTimeout(t);
  }, [ovKey]);
  const title = ids.length === 1 ? 'Share this requirement' : `Share ${ids.length} requirements`;
  if (!info)
    return html`<${Modal} wide title=${title} onClose=${onClose}>${err ? html`<${LoadError} error=${err} onRetry=${load} />` : html`<${Spinner} label="Preparing the public version…" />`}<//>`;
  const okItems = info.items.filter(i => i.ok);
  const items = okItems.filter(i => on.includes(i.id));
  const skipped = info.items.filter(i => !i.ok);
  const change = (id, k, v) => {
    setEd(s => ({ ...s, [id]: { ...(s[id] || {}), [k]: v } }));
    setOv(s => ({ ...s, [id]: { ...(s[id] || {}), [k]: v } }));
  };
  const reset = id => {
    setEd(s => {
      const n = { ...s };
      delete n[id];
      return n;
    });
    setOv(s => ({ ...s, [id]: { ti: '', d: '', rate: '', client: false } }));
  };
  const shown = (i, k) => (ed[i.id] && ed[i.id][k] !== undefined ? ed[i.id][k] : k === 'rate' ? i.ps.rate : i.pub[k]);
  const withRates = () =>
    okItems.forEach(i => {
      if (i.raw.rate && !i.pub.rate) change(i.id, 'rate', i.raw.rate);
    });
  const psOut = Object.fromEntries(items.map(i => [i.id, { ...i.ps, ...(ov[i.id] || {}) }]));
  const refresh = () => {
    load();
    onChanged && onChanged();
  };
  return html`<${Modal} wide title=${title} onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Close</button>`}>
      <div className="stack rshare" style=${{ gap: 14 }}>
        ${skipped.length > 0 && html`<div className="note amber"><span>${skipped.map(i => i.ti).join(', ')} ${skipped.length === 1 ? 'is' : 'are'} not open (only accepted, open requirements are shared) and ${skipped.length === 1 ? 'is' : 'are'} left out.</span></div>`}
        <section className="panel stack" style=${{ gap: 10 }}>
          <div className="toolbar" style=${{ gap: 8 }}>
            <h3 className="ph" style=${{ margin: 0 }}>What people see</h3>
            <span className="muted small">Vendor names, contacts, emails, phone numbers and links are always taken out. Replies come to you.</span>
            <div className="push">${okItems.some(i => i.raw.rate && !i.pub.rate) && html`<button type="button" className="btn ghost sm" onClick=${withRates} title="Fill the rate to show from the desk; change it before sharing">Show rates</button>`}</div>
          </div>
          ${okItems.map(
            i => html`<div key=${i.id} className=${'rsitem' + (on.includes(i.id) ? '' : ' off')}>
                <div className="rsrow">
                  ${okItems.length > 1 && html`<input type="checkbox" aria-label=${'Include ' + i.pub.ti} checked=${on.includes(i.id)} onChange=${e => setOn(e.target.checked ? [...on, i.id] : on.filter(x => x !== i.id))} />`}
                  <div className="rsmain">
                    <b>${i.pub.ti}</b>
                    <div className="muted small">${[rsMeta(i.pub), i.pub.rate ? 'Rate shown: ' + i.pub.rate : 'Rate hidden', i.pub.client ? 'Client shown: ' + i.pub.client : ''].filter(Boolean).join(' · ')}</div>
                  </div>
                  ${i.job && i.job.open && html`<${Chip} s="ok">On the careers page<//>`}
                  <button type="button" className="btn ghost sm" onClick=${() => setEdit(edit === i.id ? null : i.id)}>${edit === i.id ? 'Done' : 'Edit'}</button>
                </div>
                ${
                  edit === i.id &&
                  html`<div className="form rsedit">
                    <div className="row2">
                      <${Field} label="Title people see"><input value=${shown(i, 'ti')} onInput=${e => change(i.id, 'ti', e.target.value)} /><//>
                      <${Field} label="Rate to show" hint=${i.raw.rate ? 'On the desk: ' + i.raw.rate + '. Empty hides the rate.' : 'Empty hides the rate.'}><input value=${shown(i, 'rate')} onInput=${e => change(i.id, 'rate', e.target.value)} placeholder="e.g. $60/hr C2C" /><//>
                    </div>
                    ${i.raw.client && html`<label className="check"><input type="checkbox" checked=${!!i.ps.client} onChange=${e => change(i.id, 'client', e.target.checked)} /><span>Show the client's name (${i.raw.client})</span></label>`}
                    <${Field} label="Description people see" hint="Taken from the requirement with contact details, links and the vendor's name removed. Edit freely.">
                      <textarea value=${shown(i, 'd')} onInput=${e => change(i.id, 'd', e.target.value)} style=${{ minHeight: 150 }} />
                    <//>
                    <div className="actions"><button type="button" className="btn ghost sm" onClick=${() => reset(i.id)}>Start again from the requirement</button></div>
                  </div>`
                }
              </div>`
          )}
        </section>
        <div className="tabs" role="tablist">
          ${[
            ['email', 'Email clients, vendors & everyone', 'mail'],
            ['careers', 'Careers page & link', 'globe'],
            ['social', 'Social media', 'send'],
          ].map(([k, n, ic]) => html`<button key=${k} role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}><${Icon} n=${ic} />${n}</button>`)}
        </div>
        ${!items.length ? html`<${Empty} title="Nothing picked">Tick at least one requirement above.<//>` : tab === 'email' ? html`<${RsEmail} info=${info} items=${items} ps=${psOut} onSent=${refresh} />` : tab === 'careers' ? html`<${RsCareers} items=${items} ps=${psOut} onChanged=${refresh} />` : html`<${RsSocial} info=${info} items=${items} onCareers=${() => setTab('careers')} />`}
        ${
          info.items.some(i => i.sh && i.sh.length) &&
          html`<details className="rshist">
            <summary className="muted small">Share history</summary>
            <ul className="list">
              ${info.items.flatMap(i => (i.sh || []).map((h, k) => html`<li key=${i.id + k}><span><b>${RS_CH[h.ch] || h.ch}</b>${h.n ? ' · ' + plural(h.n, 'person', 'people') : ''} <span className="muted small">${i.pub.ti} · ${h.byn || ''}</span></span><span className="muted small">${fmtTs(h.at)}</span></li>`))}
            </ul>
          </details>`
        }
      </div>
    <//>`;
}

/* ---- email: vendors and clients on file, client contacts, consultants, the contacts list ---- */
function RsEmail({ info, items, ps, onSent }) {
  const toast = useToast();
  const me = Cap.me || {};
  const [src, setSrc] = useState(null);
  const [a, setA] = useState({ vms: true, vmsTypes: [], groups: [], rec: false, contacts: false, tags: [], paste: '', lists: [] });
  const [kind, setKind] = useState('vendors');
  const [m, setM] = useState(() => rsMailDefaults(items, me, 'vendors'));
  const [touched, setTouched] = useState(false);
  const [count, setCount] = useState(null);
  const [busy, setBusy] = useState('');
  const [preview, setPreview] = useState(null);
  const [run, setRun] = useState(null);
  useEffect(() => {
    api('mail_sources')
      .then(setSrc)
      .catch(e => toast(errText(e), true));
  }, []);
  const itemsKey = items.map(i => i.id + ':' + i.pub.ti + ':' + i.pub.loc).join('|');
  useEffect(() => {
    if (!touched) setM(x => ({ ...rsMailDefaults(items, me, kind), fromName: x.fromName, replyTo: x.replyTo }));
  }, [itemsKey, kind]);
  const ids = items.map(i => i.id);
  const audKey = JSON.stringify([a, ids, ps]);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      api('rs_mail', { mode: 'count', ids, ps, aud: a })
        .then(r => live && setCount(r))
        .catch(() => live && setCount(null));
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [audKey]);
  // after sending: keep the sender going while this window is open (cron sends the rest)
  useEffect(() => {
    if (!run || run.done) return;
    let live = true;
    (async () => {
      while (live) {
        try {
          const r = await api('mail_campaign_run', {});
          const c = await api('mail_campaign', { id: run.id });
          if (!live) return;
          const k = c.campaign || c;
          const done = ['done', 'cancelled', 'stopped'].includes(k.status) || (k.sent || 0) + (k.failed || 0) + (k.skipped || 0) >= (k.total || 0);
          setRun({ ...run, sent: k.sent || 0, failed: k.failed || 0, total: k.total || run.total, status: k.status, state: r.state, done });
          if (done || r.state === 'limit' || r.state === 'waiting') return;
        } catch (e) {
          return;
        }
        await sleep(2500);
      }
    })();
    return () => {
      live = false;
    };
  }, [run && run.id, run && run.done]);
  const upM = k => e => {
    setTouched(true);
    setM({ ...m, [k]: e.target.value });
  };
  const toggle = (list, v) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);
  // v37.5: a distribution list; the first one chosen replaces the starting choice (all vendors) and sets the sender
  // name and reply address unless they were changed
  const toggleList = l => {
    const on = !a.lists.includes(l.id);
    const lists = on ? [...a.lists, l.id] : a.lists.filter(x => x !== l.id);
    const untouched = a.vms && !a.vmsTypes.length && !a.groups.length && !a.rec && !a.contacts && !a.paste.trim() && !a.lists.length;
    setA({ ...a, lists, ...(on && untouched ? { vms: false } : {}) });
    if (on && lists.length === 1 && !touched) setM(x => ({ ...x, fromName: l.fromName || l.name, replyTo: dlReplyOf(l) || x.replyTo }));
  };
  const label = () =>
    [
      ((src && src.lists) || []).filter(l => a.lists.includes(l.id)).map(l => 'list ' + l.name).join(', '),
      a.vms ? (a.vmsTypes.length ? a.vmsTypes.join(', ').toLowerCase() : 'vendors & clients') : '',
      a.groups.includes('clients') ? 'client contacts' : '',
      a.groups.includes('consultants') ? 'portal consultants' : '',
      a.rec ? 'recruiting consultants' : '',
      a.contacts ? (a.tags.length ? 'contacts tagged ' + a.tags.join(', ') : 'all contacts') : '',
      a.paste.trim() ? 'pasted addresses' : '',
    ]
      .filter(Boolean)
      .join(', ');
  const everyone = () =>
    setA({
      ...a,
      vms: true,
      vmsTypes: [],
      groups: src && src.staff ? ['clients', 'consultants'] : [],
      rec: true,
      contacts: true,
      tags: [],
    });
  const body = mode => ({ mode, ids, ps, aud: a, subject: m.subject, body: m.body, fromName: m.fromName, replyTo: m.replyTo, label: label() });
  const check = () => {
    if (!m.subject.trim() || !m.body.trim()) {
      toast('Add a subject and a message.', true);
      return false;
    }
    return true;
  };
  const showPreview = async () => {
    if (!check()) return;
    setBusy('preview');
    try {
      setPreview(await api('rs_mail', body('preview')));
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const sendTest = async () => {
    if (!check()) return;
    setBusy('test');
    try {
      const r = await api('rs_mail', body('test'));
      toast(r.ok ? `Test sent to ${r.to}. Check that inbox (and the spam folder).` : `The test did not send: ${r.error}${r.hint ? ' ' + r.hint : ''}`, !r.ok);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const send = async () => {
    if (!check()) return;
    if (!count || !count.count) {
      toast('Choose who should get it first.', true);
      return;
    }
    const days = info.limit ? Math.ceil(count.count / info.limit) : 1;
    if (!confirm(`Email ${items.length === 1 ? 'this requirement' : items.length + ' requirements'} to ${plural(count.count, 'person', 'people')}? Each person gets their own copy.${days > 1 ? ` At ${info.limit} emails a day this takes about ${days} days.` : ''}`)) return;
    setBusy('send');
    try {
      const r = await api('rs_mail', body('send'));
      setRun({ id: r.campaign.id, total: r.campaign.total, sent: 0, failed: 0, done: false });
      toast(`Queued for ${plural(r.campaign.total, 'person', 'people')}. Sending has started.`);
      onSent && onSent();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  if (!info.mail)
    return html`<div className="note amber"><span>Email, inbox & campaigns is not switched on for your account, so requirements can't be emailed from here. Post them on the careers page and share the link instead, or ask an administrator.</span></div>`;
  if (!src) return html`<${Spinner} />`;
  if (run)
    return html`<div className="stack" style=${{ gap: 10 }}>
        <div className=${'note ' + (run.done ? 'ok' : 'info')}>
          <span>
            <b>${run.done ? 'Sent.' : 'Sending…'}</b> ${run.sent} of ${run.total} delivered${run.failed ? `, ${run.failed} failed` : ''}.
            ${!run.done && (run.state === 'limit' ? ' The daily sending limit was reached; the rest go out tomorrow.' : run.state === 'waiting' ? ' Sending paused for a few minutes; it carries on by itself.' : ' You can close this window: the rest go out in the background.')}
          </span>
        </div>
        <p className="muted small">Follow it, retry failures or stop it under Email, inbox & campaigns › Campaigns.</p>
        <div><button className="btn ghost sm" onClick=${() => setRun(null)}>Send to another group</button></div>
      </div>`;
  const vt = Object.entries((src.vms && src.vms.types) || {});
  const tagList = Object.entries(src.tags || {});
  return html`<div className="stack" style=${{ gap: 14 }}>
      ${!info.mailReady && html`<div className="note amber"><span>Email is not connected to a mailbox yet, so nothing can go out. An administrator sets it up under Email, inbox & campaigns › Sending setup.</span></div>`}
      <section className="panel stack" style=${{ gap: 12 }}>
        <div className="toolbar" style=${{ gap: 8 }}>
          <h3 className="ph" style=${{ margin: 0 }}>Who gets it</h3>
          <div className="push"><button type="button" className="btn ghost sm" onClick=${everyone}>Everyone</button></div>
        </div>
        ${
          (src.lists || []).length > 0 &&
          html`<div className="actions" style=${{ alignItems: 'center' }}>
            <span className="muted small">Distribution lists:</span>
            ${src.lists.map(l => html`<button key=${l.id} type="button" className=${'chip' + (a.lists.includes(l.id) ? ' new' : '')} style=${{ border: 0, cursor: 'pointer' }} aria-pressed=${a.lists.includes(l.id)} title=${l.descr || ''} onClick=${() => toggleList(l)}>${l.name} · ${(l.n || 0).toLocaleString()}</button>`)}
          </div>`
        }
        ${
          src.vms &&
          html`<div className="stack" style=${{ gap: 6 }}>
            <label className="check"><input type="checkbox" checked=${a.vms} onChange=${e => setA({ ...a, vms: e.target.checked })} /><span>Vendors & clients on file (${src.vms.n.toLocaleString()} contacts)</span></label>
            ${
              vt.length > 0 &&
              html`<div className="actions" style=${{ marginLeft: 28 }}>
                <span className="muted small">Only:</span>
                ${vt.map(([t, n]) => html`<button key=${t} type="button" className=${'chip' + (a.vmsTypes.includes(t) ? ' new' : '')} style=${{ border: 0, cursor: 'pointer' }} aria-pressed=${a.vmsTypes.includes(t)} onClick=${() => setA({ ...a, vms: true, vmsTypes: toggle(a.vmsTypes, t) })}>${t} · ${n}</button>`)}
              </div>`
            }
          </div>`
        }
        ${
          src.staff &&
          html`<div className="actions">
            <label className="check"><input type="checkbox" checked=${a.groups.includes('clients')} onChange=${() => setA({ ...a, groups: toggle(a.groups, 'clients') })} /><span>Client contacts in the client portal (${(src.clients || 0).toLocaleString()})</span></label>
            <label className="check"><input type="checkbox" checked=${a.groups.includes('consultants')} onChange=${() => setA({ ...a, groups: toggle(a.groups, 'consultants') })} /><span>Consultants in the portal (${(src.consultants || 0).toLocaleString()})</span></label>
          </div>`
        }
        <label className="check"><input type="checkbox" checked=${a.rec} onChange=${e => setA({ ...a, rec: e.target.checked })} /><span>Consultants in the recruiting workspace (${src.rec.toLocaleString()})</span></label>
        <div className="stack" style=${{ gap: 6 }}>
          <label className="check"><input type="checkbox" checked=${a.contacts} onChange=${e => setA({ ...a, contacts: e.target.checked, tags: e.target.checked ? a.tags : [] })} /><span>Contacts list (${src.contacts.toLocaleString()})${a.contacts && !a.tags.length ? ': everyone' : ''}</span></label>
          ${
            tagList.length > 0 &&
            html`<div className="actions" style=${{ marginLeft: 28 }}>
              <span className="muted small">Only these tags:</span>
              ${tagList.map(([t, n]) => html`<button key=${t} type="button" className=${'chip' + (a.tags.includes(t) ? ' new' : '')} style=${{ border: 0, cursor: 'pointer' }} aria-pressed=${a.tags.includes(t)} onClick=${() => setA({ ...a, contacts: true, tags: toggle(a.tags, t) })}>${t} · ${n}</button>`)}
            </div>`
          }
        </div>
        <${Field} label="Or paste addresses" hint="One per line: name@company.com or Jane Smith <jane@company.com>.">
          <textarea value=${a.paste} onInput=${e => setA({ ...a, paste: e.target.value })} style=${{ minHeight: 70 }} placeholder="recruiter@partner.com" />
        <//>
        <div className=${'note ' + (count && count.count ? 'info' : '')} style=${count && count.count ? null : { background: 'var(--surface-2)' }}>
          <span>
            <b>${count ? plural(count.count, 'recipient') : 'Counting…'}</b>
            ${count && count.own ? `. ${plural(count.own, 'person')} at the company ${items.length === 1 ? 'this requirement' : 'these requirements'} came from ${count.own === 1 ? 'is' : 'are'} left out` : ''}${count && count.partial ? `. ${plural(count.partial, 'person', 'people')} get a shorter list (without their own company's requirements, or roles their consultant type may not take)` : ''}${count && count.ruled ? `. ${plural(count.ruled, 'consultant')} ${count.ruled === 1 ? 'is' : 'are'} left out by the job rules (Consultant types & job rules)` : ''}${count && count.suppressed ? `. ${count.suppressed} unsubscribed ${count.suppressed === 1 ? 'address is' : 'addresses are'} left out` : ''}
            ${count && count.sample && count.sample.length ? html`<br /><span className="small">${count.sample.join(', ')}${count.count > count.sample.length ? ', …' : ''}</span>` : ''}
          </span>
        </div>
      </section>
      <section className="panel stack" style=${{ gap: 12 }}>
        <div className="toolbar" style=${{ gap: 8 }}>
          <h3 className="ph" style=${{ margin: 0 }}>Message</h3>
          <div className="seg" role="group" aria-label="Written for">
            ${[
              ['vendors', 'For vendors & clients'],
              ['consultants', 'For consultants'],
            ].map(([k, n]) => html`<button key=${k} type="button" className=${kind === k ? 'on' : ''} onClick=${() => {
              setKind(k);
              setTouched(false);
            }}>${n}</button>`)}
          </div>
        </div>
        <div className="row2">
          <${Field} label="From name" hint="Leave blank for the company name."><input value=${m.fromName} onInput=${upM('fromName')} placeholder="StratEdge IT Consulting" /><//>
          <${Field} label="Replies go to"><input type="email" value=${m.replyTo} onInput=${upM('replyTo')} /><//>
        </div>
        <${Field} label="Subject"><input value=${m.subject} onInput=${upM('subject')} maxLength="200" /><//>
        <${Field} label="Message" hint="{requirements} is where the list goes: each person gets it without the ones from their own company. {first_name} and {company} are filled in for each person.">
          <textarea value=${m.body} onInput=${upM('body')} style=${{ minHeight: 210 }} />
        <//>
        <p className="muted small">Each person gets their own copy, with your company address and an unsubscribe link at the bottom. ${items.some(i => i.job && i.job.open) ? 'Roles on the careers page get a Details and apply link.' : 'Post them on the careers page first if you want a Details and apply link in the email.'}</p>
        <div className="actions">
          <button className="btn ghost" disabled=${!!busy} onClick=${showPreview}><${Icon} n="eye" />Preview</button>
          <button className="btn ghost" disabled=${!!busy} onClick=${sendTest}>${busy === 'test' ? 'Sending test…' : `Send a test to ${me.email || 'me'}`}</button>
          <button className="btn" disabled=${!!busy || !count || !count.count} onClick=${send}><${Icon} n="send" />${busy === 'send' ? 'Queuing…' : count && count.count ? `Email ${plural(count.count, 'person', 'people')}` : 'Send'}</button>
        </div>
      </section>
      ${
        preview &&
        html`<${Modal} wide title=${preview.subject || 'Preview'} onClose=${() => setPreview(null)} foot=${html`<button className="btn" onClick=${() => setPreview(null)}>Close</button>`}>
          <p className="muted small" style=${{ marginBottom: 10 }}>Shown for a sample person, "Alex Morgan at Example Corp", with every requirement.</p>
          <iframe title="Email preview" srcDoc=${preview.html} sandbox="" style=${{ width: '100%', height: 540, border: '1px solid var(--line)', borderRadius: 12, background: '#fff' }} />
        <//>`
      }
    </div>`;
}

/* ---- the careers page: post, update, take down ---- */
function RsCareers({ items, ps, onChanged }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const site = location.host;
  const post = async list => {
    setBusy(list.length === 1 ? list[0].id : 'all');
    let n = 0;
    for (const i of list) {
      try {
        const fd = new FormData();
        fd.append('data', JSON.stringify({ id: i.id, ps: ps[i.id] }));
        try {
          const img = await adImage({ t: i.pub.ti, loc: i.pub.loc, ty: i.pub.ty, md: i.pub.md, sk: i.pub.sk }, site, 'image/jpeg');
          if (img) fd.append('img', img, 'card.jpg');
        } catch (e) {
          /* the posting works without its picture (the default one is used) */
        }
        await upload('rs_publish', fd);
        n++;
      } catch (e) {
        toast(`${i.pub.ti}: ${errText(e)}`, true);
      }
    }
    if (n) toast(n === 1 ? 'Posted on the careers page.' : `${n} roles posted on the careers page.`);
    setBusy('');
    onChanged();
  };
  const down = async i => {
    if (!confirm(`Take "${i.pub.ti}" off the careers page? The link then says the role is no longer open.`)) return;
    setBusy(i.id);
    try {
      await api('rs_unpublish', { ids: [i.id] });
      toast('Taken off the careers page.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
    onChanged();
  };
  const notPosted = items.filter(i => !(i.job && i.job.open));
  return html`<div className="stack" style=${{ gap: 12 }}>
      <p className="muted small" style=${{ margin: 0 }}>The careers page shows the public version above. People apply with one click and applications land in the ATS (Candidates). Postings come down by themselves when a requirement is filled, closed or dismissed.</p>
      ${notPosted.length > 1 && html`<div><button className="btn" disabled=${!!busy} onClick=${() => post(notPosted)}><${Icon} n="globe" />${busy === 'all' ? 'Posting…' : `Post ${notPosted.length} on the careers page`}</button></div>`}
      <div className="tblwrap">
        <table className="tbl">
          <thead><tr><th>Role</th><th>On the careers page</th><th className="r">Applications</th><th /></tr></thead>
          <tbody>
            ${items.map(i => {
              const j = i.job;
              const live = j && j.open;
              return html`<tr key=${i.id}>
                  <td><b style=${{ fontWeight: 600 }}>${i.pub.ti}</b><div className="muted small">${rsMeta(i.pub)}</div></td>
                  <td className="small">${live ? html`<${Chip} s="ok">Live<//> <span className="muted">since ${fmtDay(j.at)}</span><div className="rslink"><code>${j.link}</code></div>` : j ? html`<span className="muted">Taken down</span>` : html`<span className="muted">Not posted</span>`}</td>
                  <td className="r num">${j ? j.apps : '—'}</td>
                  <td className="r"><div className="actions" style=${{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                    ${live && html`<button className="btn ghost sm" onClick=${() => rsCopy(toast, j.link, 'Link copied.').then(okc => okc && rsLog([i.id], 'copy'))}>Copy link</button><a className="btn ghost sm" href=${j.page} target="_blank" rel="noopener">Open</a>`}
                    <button className="btn sm" disabled=${!!busy} onClick=${() => post([i])}>${busy === i.id ? 'Posting…' : live ? 'Update' : 'Post'}</button>
                    ${live && html`<button className="btn ghost sm" disabled=${!!busy} onClick=${() => down(i)}>Take down</button>`}
                  </div></td>
                </tr>`;
            })}
          </tbody>
        </table>
      </div>
    </div>`;
}

/* ---- social media: each network's own share window, the company's pages, a picture for Instagram ---- */
function RsSocial({ info, items, onCareers }) {
  const toast = useToast();
  const P = usePortal();
  const ids = items.map(i => i.id);
  const one = items.length === 1;
  const posted = items.filter(i => i.job && i.job.open);
  const ready = posted.length === items.length;
  const base = siteBase();
  const linkFor = k => (one ? jobShareLink(items[0].key, k) : jobShareLink('', k));
  const shareLink = linkFor('share');
  const auto = rsPostText(items, shareLink);
  const [text, setText] = useState(auto);
  const [edited, setEdited] = useState(false);
  const autoKey = items.map(i => i.id + i.pub.ti + i.pub.rate + i.pub.loc + i.pub.sk).join('|');
  useEffect(() => {
    if (!edited) setText(rsPostText(items, shareLink));
  }, [autoKey, shareLink]);
  const short = rsShortText(items);
  const subject = one ? `${items[0].pub.ti}${items[0].pub.loc ? ', ' + items[0].pub.loc : ''}` : `${items.length} open roles at StratEdge IT Consulting`;
  const textFor = k => text.split(shareLink).join(linkFor(k));
  const square = () => rsSquareImage(items, location.host);
  const go = async net => {
    const link = linkFor(net.k);
    if (net.image) {
      try {
        const blob = await square();
        await saveDownload(`stratedge-${one ? (items[0].pub.ti || 'role').toLowerCase().replace(/[^a-z0-9]+/g, '-') : 'open-roles'}.png`, blob);
        await rsCopy(toast, textFor(net.k), 'Picture saved and the caption copied. Post the picture in Instagram and paste the caption.');
        rsLog(ids, 'instagram');
      } catch (e) {
        if (!e || e.code !== 'declined') toast(errText(e), true);
      }
      return;
    }
    if (net.copy) await rsCopy(toast, textFor(net.k), `Post text copied. Paste it into your ${net.n} post; the role's card is attached.`);
    window.open(net.url(link, textFor(net.k), short, subject), '_blank', 'noopener,noreferrer,width=680,height=640');
    rsLog(ids, net.k);
  };
  const native = async () => {
    try {
      const blob = await square();
      const file = new File([blob], 'open-role.png', { type: 'image/png' });
      const data = { title: subject, text: textFor('native'), url: linkFor('native') };
      if (navigator.canShare && navigator.canShare({ files: [file] })) data.files = [file];
      await navigator.share(data);
      rsLog(ids, 'native');
    } catch (e) {
      /* cancelled */
    }
  };
  const saveImage = async () => {
    try {
      await saveDownload(`stratedge-${one ? 'role' : 'open-roles'}.png`, await square());
      rsLog(ids, 'image');
    } catch (e) {
      if (!e || e.code !== 'declined') toast(errText(e), true);
    }
  };
  const pages = RS_PAGES.filter(([k]) => info.social && info.social[k]);
  if (!ready)
    return html`<div className="stack" style=${{ gap: 10 }}>
        <div className="note info"><span>Social posts link to the role on your careers page, where people apply in one click. ${posted.length ? `${items.length - posted.length} of the ${items.length} picked ${items.length - posted.length === 1 ? 'is' : 'are'} not posted yet.` : 'Post it there first.'}</span></div>
        <div><button className="btn" onClick=${onCareers}><${Icon} n="globe" />Go to Careers page & link</button></div>
      </div>`;
  return html`<div className="stack" style=${{ gap: 14 }}>
      <section className="panel stack" style=${{ gap: 10 }}>
        <h3 className="ph" style=${{ margin: 0 }}>Share to your feed</h3>
        <div className="rsnets">
          ${RS_NETS.map(n => html`<button key=${n.k} type="button" className="btn rsnet" style=${{ '--net': n.c }} onClick=${() => go(n)}><${Icon} n=${n.image ? 'down' : n.k === 'mailto' ? 'mail' : 'send'} />${n.n}</button>`)}
          ${typeof navigator.share === 'function' && html`<button type="button" className="btn ghost" onClick=${native}><${Icon} n="more" />More apps…</button>`}
        </div>
        <p className="muted small" style=${{ margin: 0 }}>LinkedIn and Facebook take only the link (they show the role's title and picture): the post text is copied for you to paste. X, WhatsApp, Telegram and email open with the text filled in. Instagram gets a square picture and the caption.</p>
        <div className="actions">
          <button type="button" className="btn ghost sm" onClick=${() => rsCopy(toast, linkFor('copy'), 'Link copied.').then(okc => okc && rsLog(ids, 'copy'))}>Copy link</button>
          <button type="button" className="btn ghost sm" onClick=${() => rsCopy(toast, textFor('copy'), 'Post text copied.')}>Copy post text</button>
          <button type="button" className="btn ghost sm" onClick=${saveImage}><${Icon} n="down" />Download picture</button>
        </div>
      </section>
      <section className="panel stack" style=${{ gap: 8 }}>
        <div className="toolbar" style=${{ gap: 8 }}>
          <h3 className="ph" style=${{ margin: 0 }}>Post text</h3>
          ${edited && html`<div className="push"><button type="button" className="btn ghost sm" onClick=${() => { setEdited(false); setText(rsPostText(items, shareLink)); }}>Rewrite from the requirements</button></div>`}
        </div>
        <textarea value=${text} onInput=${e => { setEdited(true); setText(e.target.value); }} style=${{ minHeight: 200, fontFamily: 'inherit' }} aria-label="Post text" />
        <p className="muted small" style=${{ margin: 0 }}>X gets a shorter version: <i>${short}</i></p>
      </section>
      <section className="panel stack" style=${{ gap: 8 }}>
        <h3 className="ph" style=${{ margin: 0 }}>Your company's pages</h3>
        ${
          pages.length
            ? html`<div className="actions">${pages.map(([k, n]) => html`<a key=${k} className="btn ghost sm" href=${info.social[k]} target="_blank" rel="noopener">${n}</a>`)}</div>
              <p className="muted small" style=${{ margin: 0 }}>To post as the company, open its page (you need to be one of its admins), start a post and paste the text; the share buttons above post as you.</p>`
            : html`<p className="muted small" style=${{ margin: 0 }}>No company pages saved yet. ${P.roleName === 'admin' ? html`Add them under <a href="#/portal/admin/website?tab=social">Website & messages › Social pages</a>.` : 'An administrator adds them under Website & messages › Social pages.'}</p>`
        }
      </section>
    </div>`;
}

/* ---- Admin › Website & messages › Social pages: the company's pages (also linked from the website footer) ---- */
function SocialPagesSettings() {
  const toast = useToast();
  const d = useDoc('org/site/x/social');
  const [f, setF] = useState(null);
  useEffect(() => {
    if (!d.loading && !f) setF({ linkedin: CO.linkedin, facebook: '', x: '', instagram: '', youtube: '', ...((d.data && typeof d.data === 'object') ? d.data : {}) });
  }, [d.loading]);
  if (!f) return html`<${Spinner} />`;
  const save = async () => {
    const out = {};
    for (const [k, n] of RS_PAGES) {
      const v = String(f[k] || '').trim();
      if (v && !/^https:\/\/[^\s]+\.[^\s]+/i.test(v)) {
        toast(`${n}: use the full address starting with https://`, true);
        return;
      }
      out[k] = v;
    }
    try {
      await dbSet('org/site/x/social', { ...out, u: Date.now() });
      toast('Saved. The website footer and the share window use these now.');
    } catch (e) {
      toast(errText(e), true);
    }
  };
  return html`<section className="panel form" style=${{ maxWidth: 720 }}>
      <h2 className="ph">Social pages</h2>
      <p className="muted small">Your company's own pages. They are linked from the website footer, and the share window for requirements offers them so the team can post there as the company.</p>
      ${RS_PAGES.map(([k, n]) => html`<${Field} key=${k} label=${n}><input type="url" value=${f[k] || ''} onInput=${e => setF({ ...f, [k]: e.target.value })} placeholder=${{ linkedin: 'https://www.linkedin.com/company/your-company/', facebook: 'https://www.facebook.com/yourcompany', x: 'https://x.com/yourcompany', instagram: 'https://www.instagram.com/yourcompany/', youtube: 'https://www.youtube.com/@yourcompany' }[k]} /><//>`)}
      <div className="actions"><button className="btn" onClick=${save}>Save</button></div>
    </section>`;
}
