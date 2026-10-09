/* ================= v38 Appearance and quick jump =================
   The Appearance button in the portal's top bar: the look (Glass, the starting look, or Classic), light / dark / as the
   device is set, and for administrators the look everyone starts with. A person's own choice stays on their device;
   without one the administrator's choice applies.
   Quick jump (Ctrl+K or ⌘K, or the search button in the top bar): type a few letters of any page in the portal and press
   Enter. */
Object.assign(IP, {
  palette: 'M12 3.2c-5 0-9 3.7-9 8.4 0 4.5 3.7 8.2 8.4 8.2 1.1 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.8-1.7 1.8-1.7h2.1c2.7 0 4.9-2.1 4.9-4.7 0-4.4-4-8.1-9-8.1zM7.6 12.3h.01M9.4 8.1h.01M14.4 7.8h.01M17 11h.01',
  jump: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zm4.8 11.3L20 20M8 10.5h5m-2.5-2.5v5',
});
const JUMP_KEY = /Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘K' : 'Ctrl+K';
// switching the look or light / dark cross-fades the page where the browser can (and motion is welcome)
const lookFade = fn => {
  try {
    if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.startViewTransition(fn);
      return;
    }
  } catch (e) {
    /* fall through */
  }
  fn();
};
const themeMine = () => {
  try {
    const t = localStorage.getItem('theme');
    return t === 'dark' || t === 'light' ? t : '';
  } catch (e) {
    return '';
  }
};
function setThemeAuto() {
  document.documentElement.removeAttribute('data-theme');
  try {
    localStorage.removeItem('theme');
  } catch (e) {}
}
// a little picture of each look for the menu (drawn with CSS: a sidebar, a card and a button)
const LookSwatch = ({ k }) => html`<span className=${'lookswatch ' + k} aria-hidden="true"><i /><b /><em /></span>`;
function Appearance() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [look, setLookS] = useState(lookMine() || lookNow());
  const [mode, setMode] = useState(themeMine());
  const [site, setSite] = useState(Cap.look === 'classic' ? 'classic' : 'glass');
  const [busy, setBusy] = useState(false);
  const wrap = useRef(null);
  const isAdmin = !!Cap.isOwner;
  useEffect(() => {
    if (!open) return;
    const away = e => {
      if (wrap.current && !wrap.current.contains(e.target)) setOpen(false);
    };
    const esc = e => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      const b = wrap.current && wrap.current.querySelector('button');
      b && b.focus();
    };
    addEventListener('mousedown', away);
    addEventListener('keydown', esc);
    return () => {
      removeEventListener('mousedown', away);
      removeEventListener('keydown', esc);
    };
  }, [open]);
  const pickLook = v => {
    lookFade(() => setLook(v));
    setLookS(v);
  };
  const pickMode = v => {
    lookFade(() => (v ? setTheme(v) : setThemeAuto()));
    setMode(v);
  };
  const saveSite = async v => {
    if (busy || v === site) return;
    setBusy(true);
    try {
      await api('look_default', { look: v });
      Cap.look = v;
      setSite(v);
      applyLook();
      setLookS(lookMine() || lookNow());
      toast(v === 'classic' ? 'Everyone now starts with the Classic look.' : 'Everyone now starts with the Glass look.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<div className="lookwrap" ref=${wrap}>
      <button type="button" className="btn ghost icon lookbtn" aria-haspopup="dialog" aria-expanded=${open ? 'true' : 'false'} aria-label="Appearance" title="Appearance" onClick=${e => {
        // on a phone the menu is fixed to the screen, just under this button wherever the top bar is
        const r = e.currentTarget.getBoundingClientRect();
        wrap.current && wrap.current.style.setProperty('--lookpop-top', Math.round(r.bottom + 10) + 'px');
        setOpen(!open);
      }}>
        <${Icon} n="palette" />
      </button>
      ${
        open &&
        html`<div className="lookpop" role="dialog" aria-label="Appearance">
            <div className="lookh">Appearance</div>
            <div className="looklbl" id="look-l">Look</div>
            <div className="lookopts" role="radiogroup" aria-labelledby="look-l">
              ${[
                ['glass', 'Glass', 'Frosted glass and bubbles'],
                ['classic', 'Classic', 'The look before v38'],
              ].map(
                ([k, n, d]) => html`<button key=${k} type="button" role="radio" aria-checked=${look === k ? 'true' : 'false'} className=${'lookopt' + (look === k ? ' on' : '')} onClick=${() => pickLook(k)}>
                    <${LookSwatch} k=${k} />
                    <span><b>${n}</b><small>${d}</small></span>
                  </button>`
              )}
            </div>
            <div className="looklbl" id="mode-l">Light or dark</div>
            <div className="seg lookmodes" role="radiogroup" aria-labelledby="mode-l">
              ${[
                ['light', 'Light', 'sun'],
                ['dark', 'Dark', 'moon'],
                ['', 'Auto', 'grid'],
              ].map(
                ([k, n, i]) => html`<button key=${k || 'auto'} type="button" role="radio" aria-checked=${mode === k ? 'true' : 'false'} className=${mode === k ? 'on' : ''} title=${k ? '' : "Follow this device's light or dark setting"} onClick=${() => pickMode(k)}>
                    <${Icon} n=${i} />${n}
                  </button>`
              )}
            </div>
            ${
              lookMine() &&
              html`<p className="muted small lookmine">This is your own choice on this device. <button type="button" className="btn link" onClick=${() => {
                setLook('');
                setLookS(lookNow());
              }}>Use the portal's look instead</button></p>`
            }
            ${
              isAdmin &&
              html`<div className="lookadmin">
                  <div className="looklbl" id="site-l">Everyone starts with</div>
                  <div className="seg" role="radiogroup" aria-labelledby="site-l">
                    ${[
                      ['glass', 'Glass'],
                      ['classic', 'Classic'],
                    ].map(
                      ([k, n]) => html`<button key=${k} type="button" role="radio" aria-checked=${site === k ? 'true' : 'false'} className=${site === k ? 'on' : ''} disabled=${busy} onClick=${() => saveSite(k)}>${n}</button>`
                    )}
                  </div>
                  <small className="muted">For people who haven't picked a look themselves. Only administrators see this.</small>
                </div>`
            }
            <p className="muted small lookkeys">Tip: press ${JUMP_KEY.split('+').map((k, i) => html`${i ? ' ' : ''}<kbd key=${k}>${k}</kbd>`)} to jump to any page.</p>
          </div>`
      }
    </div>`;
}

/* Quick jump: every page of the portal(s) the person has, found by a few letters */
const jumpNorm = s => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
function jumpScore(item, q) {
  const n = jumpNorm(item.n);
  const g = jumpNorm(item.g);
  const words = q.split(' ').filter(Boolean);
  if (!words.length) return 1;
  let sc = 0;
  for (const w of words) {
    if (n.startsWith(w)) sc += 6;
    else if ((' ' + n).includes(' ' + w)) sc += 4;
    else if (n.includes(w)) sc += 2;
    else if (g.includes(w)) sc += 1;
    else return 0;
  }
  return sc + (n === q ? 10 : 0);
}
function QuickJump({ items, onClose }) {
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const list = useRef(null);
  const nq = jumpNorm(q);
  const found = useMemo(
    () =>
      items
        .map(x => ({ ...x, sc: jumpScore(x, nq) }))
        .filter(x => x.sc > 0)
        .sort((a, b) => b.sc - a.sc)
        .slice(0, 40),
    [items, nq]
  );
  useEffect(() => setI(0), [nq]);
  useEffect(() => {
    const el = list.current && list.current.querySelector('[aria-selected="true"]');
    el && el.scrollIntoView({ block: 'nearest' });
  }, [i, found.length]);
  const go = x => {
    if (!x) return;
    onClose();
    if (x.run) x.run();
    else location.hash = x.href.replace(/^#/, '');
  };
  const key = e => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setI(Math.min(i + 1, found.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setI(Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(found[i]);
    }
  };
  return html`<${Modal} title="Jump to a page" onClose=${onClose}>
      <div className="jump">
        <label className="jumpin">
          <${Icon} n="search" />
          <input autoFocus value=${q} onInput=${e => setQ(e.target.value)} onKeyDown=${key} placeholder="Type a page, for example timesheets" aria-label="Page to open" role="combobox" aria-expanded="true" aria-controls="jump-list" aria-activedescendant=${found[i] ? 'jump-' + i : undefined} autoComplete="off" spellCheck="false" />
        </label>
        <ul className="jumplist" id="jump-list" role="listbox" aria-label="Pages" ref=${list}>
          ${found.map(
            (x, k) => html`<li key=${x.href} id=${'jump-' + k} role="option" aria-selected=${k === i ? 'true' : 'false'} className=${k === i ? 'on' : ''} onMouseEnter=${() => setI(k)} onMouseDown=${e => {
              e.preventDefault();
              go(x);
            }}>
                <span className="jumpico"><${Icon} n=${x.i || 'right'} /></span>
                <span className="jumpt"><b>${x.n}</b>${x.g ? html`<small>${x.g}</small>` : null}</span>
                <${Icon} n="right" cls="jumpgo" />
              </li>`
          )}
          ${!found.length && html`<li className="jumpnone muted">No page matches “${q}”.</li>`}
        </ul>
        <p className="muted small jumpkeys"><kbd>↑</kbd> <kbd>↓</kbd> to choose, <kbd>Enter</kbd> to open, <kbd>Esc</kbd> to close</p>
      </div>
    <//>`;
}
// Ctrl+K / ⌘K anywhere in the portal (not while typing in another field's own shortcut)
function useJumpKey(open) {
  useEffect(() => {
    const k = e => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        open();
      }
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, []);
}
