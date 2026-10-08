/* ================= v35: Team messaging (the Messages button and the Messages page) =================
   Direct messages, groups and channels for the StratEdge team (and, when an administrator switches them on,
   consultants, students and client contacts). One store keeps the conversation list and the open conversations and
   polls the server: every few seconds while a conversation is open, every half minute for the badge otherwise.
   Server: api/chat.php. */
Object.assign(IP, {
  clip: 'M20.5 11.5l-8.4 8.4a5 5 0 0 1-7.1-7.1l8.4-8.4a3.3 3.3 0 0 1 4.7 4.7l-8.4 8.4a1.7 1.7 0 0 1-2.4-2.4l7.7-7.7',
  reply: 'M9 7 4 12l5 5M4 12h10a6 6 0 0 1 6 6v1',
  pin: 'M9 3h6l-1 6 4 3v2H6v-2l4-3zM12 14v7',
  smile: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01',
  bellx: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0M3 3l18 18',
});
const CHAT_POLL_OPEN = 3000;
const CHAT_POLL_IDLE = 25000;
const ChatDrafts = new Map();

const ChatStore = {
  boot: null, // { me, people, online, emoji, canChannel, team, admin, edit, prefs }
  people: new Map(),
  names: new Map(), // people outside my list who wrote in a shared channel: their names only
  convs: [],
  h: '',
  online: new Set(),
  views: new Map(), // id -> { msgs: Map(seq -> message), since, more, members, myRead, reads, typing, loaded, pins, newFrom }
  open: new Map(), // id -> number of mounted views (the panel and the page)
  focus: '',
  href: '#/portal/messages',
  subs: new Set(),
  t: null,
  busy: false,
  started: false,
  err: null,
  sub(f) {
    this.subs.add(f);
    return () => this.subs.delete(f);
  },
  emit() {
    this.subs.forEach(f => {
      try {
        f();
      } catch (e) {
        /* a closed view */
      }
    });
  },
  start() {
    if (!this.started) {
      this.started = true;
      this.bootP = this.load();
    }
    return this.bootP;
  },
  async load() {
    try {
      const r = await api('chat_boot', {});
      this.boot = r;
      this.people = new Map(r.people.map(p => [p.id, p]));
      this.people.set(r.me.id, { id: r.me.id, n: r.me.n, k: r.me.k, t: 'You' });
      this.convs = r.convs;
      this.online = new Set(r.online || []);
      this.err = null;
    } catch (e) {
      this.err = e;
      this.started = false; // a later page opens it again
    }
    this.emit();
    this.schedule(1500);
  },
  person(id) {
    return this.people.get(id) || { id, n: this.names.get(id) || 'Someone', t: '' };
  },
  learn(names) {
    Object.entries(names || {}).forEach(([id, n]) => this.names.set(id, n));
  },
  conv(id) {
    return this.convs.find(c => c.id === id);
  },
  setConvs(list) {
    this.notify(list);
    this.convs = list;
  },
  /** A desktop notification for a new direct message or mention that isn't on screen (when switched on). */
  notify(list) {
    let allow = false;
    try {
      allow = localStorage.getItem('se.chat.desk') === '1';
    } catch (e) {}
    if (!allow || typeof Notification === 'undefined' || Notification.permission !== 'granted' || !this.boot) return;
    const prev = new Map(this.convs.map(c => [c.id, c]));
    list.forEach(c => {
      const p = prev.get(c.id);
      if (!p || c.muted) return;
      const more = c.kind === 'channel' ? c.mention > p.mention : c.unread > p.unread;
      if (!more || (!document.hidden && this.open.has(c.id))) return;
      try {
        const n = new Notification(c.kind === 'channel' ? '#' + c.name : c.name, { body: c.lastText, tag: 'se-chat-' + c.id });
        n.onclick = () => {
          window.focus();
          location.hash = this.href + '?c=' + c.id;
          n.close();
        };
      } catch (e) {}
    });
  },
  view(id) {
    let v = this.views.get(id);
    if (!v) {
      v = { msgs: new Map(), since: 0, more: false, members: [], myRead: 0, reads: new Map(), typing: [], loaded: false, loading: false, pins: 0, newFrom: 0 };
      this.views.set(id, v);
    }
    return v;
  },
  async loadView(id) {
    const v = this.view(id);
    if (v.loading) return;
    v.loading = true;
    v.err = '';
    try {
      const r = await api('chat_history', { conv: id });
      this.learn(r.names);
      v.msgs = new Map(r.msgs.map(m => [m.s, m]));
      v.since = Math.max(r.top || 0, ...r.msgs.map(m => m.v));
      v.more = r.more;
      v.members = r.members;
      v.myRead = r.myRead;
      v.reads = new Map(r.members.map(x => [x.id, x.read]));
      v.pins = r.pins;
      const me = this.boot.me.id;
      const first = r.msgs.find(m => m.s > r.myRead && m.u !== me && m.k === 'msg');
      v.newFrom = first ? first.s : 0;
      v.loaded = true;
    } catch (e) {
      v.err = errText(e);
    }
    v.loading = false;
    this.emit();
  },
  async older(id) {
    const v = this.view(id);
    if (!v.more || v.loadingOlder) return 0;
    v.loadingOlder = true;
    let n = 0;
    try {
      const before = Math.min(...v.msgs.keys());
      const r = await api('chat_history', { conv: id, before });
      this.learn(r.names);
      r.msgs.forEach(m => v.msgs.set(m.s, m));
      v.more = r.more;
      n = r.msgs.length;
    } catch (e) {}
    v.loadingOlder = false;
    this.emit();
    return n;
  },
  merge(id, msgs) {
    const v = this.view(id);
    msgs.forEach(m => {
      v.msgs.set(m.s, m);
      v.since = Math.max(v.since, m.v);
    });
  },
  afterSend(id, m) {
    this.merge(id, [m]);
    const v = this.view(id);
    v.myRead = Math.max(v.myRead, m.s);
    v.newFrom = 0;
    const c = this.conv(id);
    if (c) {
      c.lastAt = m.at;
      c.lastText = this.boot.me.n + ': ' + (m.b || (m.a[0] ? '[' + m.a[0].n + ']' : ''));
      c.unread = 0;
      c.mention = 0;
      this.convs = [c, ...this.convs.filter(x => x !== c)];
    }
    this.emit();
    this.schedule(800);
  },
  markRead(id) {
    const v = this.views.get(id);
    if (!v || !v.loaded) return;
    let last = 0;
    v.msgs.forEach(m => {
      if (m.s > last) last = m.s;
    });
    if (last <= v.myRead) return;
    v.myRead = last;
    const c = this.conv(id);
    if (c && (c.unread || c.mention)) {
      c.unread = 0;
      c.mention = 0;
      this.emit();
    }
    api('chat_read', { conv: id, seq: last }).catch(() => {});
  },
  openView(id) {
    this.open.set(id, (this.open.get(id) || 0) + 1);
    this.focus = id;
    this.schedule(400);
  },
  closeView(id) {
    const n = (this.open.get(id) || 1) - 1;
    if (n > 0) this.open.set(id, n);
    else this.open.delete(id);
    if (this.focus === id) this.focus = [...this.open.keys()].pop() || '';
    this.schedule();
  },
  schedule(ms) {
    clearTimeout(this.t);
    if (!this.started) return;
    const opened = this.open.size > 0;
    const base = opened ? CHAT_POLL_OPEN : CHAT_POLL_IDLE;
    this.t = setTimeout(() => this.poll(), ms != null ? ms : document.hidden ? base * (opened ? 5 : 2.4) : base);
  },
  async poll() {
    if (this.busy || !this.boot) {
      if (!this.boot && !this.started) return;
      return this.schedule();
    }
    this.busy = true;
    const id = this.open.has(this.focus) ? this.focus : [...this.open.keys()][0] || '';
    const v = id ? this.views.get(id) : null;
    try {
      const r = await api('chat_poll', { h: this.h, open: v && v.loaded ? id : '', since: v ? v.since : 0 });
      this.h = r.h;
      if (r.convs) this.setConvs(r.convs);
      this.online = new Set(r.online || []);
      this.learn(r.names);
      if (v && r.msgs) this.merge(id, r.msgs);
      if (v && r.reads) v.reads = new Map(r.reads);
      if (v) v.typing = r.typing || [];
      this.emit();
    } catch (e) {
      /* the next poll tries again */
    }
    this.busy = false;
    this.schedule();
  },
  /** Conversation actions answer with the new list. */
  async act(route, body) {
    const r = await api(route, body);
    if (r.convs) {
      this.convs = r.convs;
      this.h = '';
    }
    this.emit();
    return r;
  },
};
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && ChatStore.started) ChatStore.schedule(300);
});
function useChat() {
  const [, setT] = useState(0);
  useEffect(() => ChatStore.sub(() => setT(t => t + 1)), []);
  return ChatStore;
}
const chatBadge = convs => {
  let n = 0;
  let dot = false;
  convs.forEach(c => {
    if (c.muted) return;
    if (c.kind === 'channel') {
      n += c.mention;
      if (c.unread) dot = true;
    } else n += c.unread;
  });
  return { n, dot };
};
const chatAvatar = (id, size) => {
  const p = ChatStore.person(id);
  return html`<img className="chatav" src=${avatarFor(p.n, id).url} alt="" width=${size || 28} height=${size || 28} />`;
};
const chatSize = n => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
const chatFileUrl = (m, a, dl) => API + 'chat_file&s=' + m.s + '&i=' + a.i + (dl ? '&dl=1' : '');
const chatDayLabel = ts => {
  const d = new Date(ts);
  const t = new Date();
  const y = new Date(Date.now() - 86400000);
  if (d.toDateString() === t.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric', ...(d.getFullYear() !== t.getFullYear() ? { year: 'numeric' } : {}) });
};
const chatTitle = c => (c.kind === 'channel' ? '#' + c.name : c.name);

/* ---- message text: links, `code`, **bold**, @mentions ---- */
function chatInline(s, names, kb) {
  const out = [];
  const me = ChatStore.boot ? ChatStore.boot.me.id : '';
  let n = 0;
  const text = t => {
    let pos = 0;
    while (pos < t.length) {
      const at = t.indexOf('@', pos);
      if (at < 0) break;
      const rest = t.slice(at + 1);
      const hit = names.find(([, nm]) => rest.toLowerCase().startsWith(nm.toLowerCase()));
      if (hit && (at === 0 || /[\s(]/.test(t[at - 1]))) {
        if (at > pos) out.push(t.slice(pos, at));
        out.push(html`<span key=${kb + 'm' + n++} className=${'chatmention' + (hit[0] === me || hit[0] === '*' ? ' atme' : '')}>@${rest.slice(0, hit[1].length)}</span>`);
        pos = at + 1 + hit[1].length;
      } else {
        out.push(t.slice(pos, at + 1));
        pos = at + 1;
      }
    }
    if (pos < t.length) out.push(t.slice(pos));
  };
  const re = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])|`([^`\n]+)`|\*\*([^*\n]+)\*\*/g;
  let last = 0;
  let m;
  while ((m = re.exec(s))) {
    if (m.index > last) text(s.slice(last, m.index));
    if (m[1]) out.push(html`<a key=${kb + 'a' + n++} href=${m[1]} target="_blank" rel="noopener noreferrer">${m[1]}</a>`);
    else if (m[2]) out.push(html`<code key=${kb + 'c' + n++}>${m[2]}</code>`);
    else out.push(html`<b key=${kb + 'b' + n++}>${m[3]}</b>`);
    last = m.index + m[0].length;
  }
  if (last < s.length) text(s.slice(last));
  return out;
}
function chatRender(body, mentions) {
  const names = (mentions || [])
    .map(id => (id === '*' ? ['*', 'everyone'] : [id, ChatStore.person(id).n]))
    .sort((a, b) => b[1].length - a[1].length);
  return String(body)
    .split('\n')
    .map((line, i) => html`<${Fragment} key=${i}>${i > 0 && html`<br />`}${chatInline(line, names, 'l' + i)}<//>`);
}

/* ---- people picker ---- */
function ChatPeoplePick({ picked, onChange, multi, exclude, only, label }) {
  const S = ChatStore;
  const [q, setQ] = useState('');
  const me = S.boot.me.id;
  const all = [...S.people.values()].filter(p => p.id !== me && !(exclude || []).includes(p.id) && (!only || only(p)));
  const needle = q.trim().toLowerCase();
  const list = needle ? all.filter(p => (p.n + ' ' + p.t).toLowerCase().includes(needle)) : all;
  const toggle = id => onChange(multi ? (picked.includes(id) ? picked.filter(x => x !== id) : [...picked, id]) : [id]);
  return html`<div className="chatpick">
      ${
        picked.length > 0 &&
        html`<div className="deskpeople">${picked.map(id => html`<span key=${id} className="chip new">${S.person(id).n}<button type="button" aria-label=${'Remove ' + S.person(id).n} onClick=${() => toggle(id)}><${Icon} n="x" /></button></span>`)}</div>`
      }
      <input type="search" value=${q} onInput=${e => setQ(e.target.value)} placeholder="Find people by name" aria-label=${label || 'Find people'} />
      <div className="chatpick-list">
        ${list.length === 0 && html`<p className="muted small" style=${{ margin: 8 }}>Nobody matches.</p>`}
        ${list.slice(0, 80).map(
          p => html`<button key=${p.id} type="button" className=${picked.includes(p.id) ? 'on' : ''} aria-pressed=${picked.includes(p.id)} onClick=${() => toggle(p.id)}>
            <span className="chatavw">${chatAvatar(p.id, 28)}${S.online.has(p.id) && html`<i className="chaton"></i>`}</span>
            <span className="chatpick-name"><b>${p.n}</b><span className="muted small">${p.t}</span></span>
            ${picked.includes(p.id) && html`<${Icon} n="check" />`}
          </button>`
        )}
      </div>
    </div>`;
}

/* ---- the conversation list ---- */
function ChatList({ active, onOpen, compact, onBrowse }) {
  const S = useChat();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [found, setFound] = useState(null);
  const needle = q.trim().toLowerCase();
  useEffect(() => {
    if (needle.length < 3) {
      setFound(null);
      return;
    }
    const t = setTimeout(
      () =>
        api('chat_search', { q: needle }).then(
          r => {
            S.learn(r.names);
            setFound(r.msgs);
          },
          () => setFound([])
        ),
      350
    );
    return () => clearTimeout(t);
  }, [needle]);
  const convs = S.convs.filter(c => !needle || c.name.toLowerCase().includes(needle));
  const channels = convs.filter(c => c.kind === 'channel').sort((a, b) => a.name.localeCompare(b.name));
  const direct = convs.filter(c => c.kind !== 'channel');
  const withDm = new Set(S.convs.filter(c => c.kind === 'dm').map(c => c.other));
  const people = needle ? [...S.people.values()].filter(p => p.id !== S.boot.me.id && !withDm.has(p.id) && p.n.toLowerCase().includes(needle)).slice(0, 6) : [];
  const startDm = async uid => {
    try {
      const r = await S.act('chat_dm', { uid });
      setQ('');
      onOpen({ id: r.id });
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const row = c => {
    const n = c.kind === 'channel' ? c.mention : c.unread;
    return html`<button key=${c.id} type="button" className=${'chatrow' + (active === c.id ? ' on' : '') + (c.unread ? ' unread' : '') + (c.muted ? ' muted' : '')} onClick=${() => onOpen(c)} aria-current=${active === c.id ? 'true' : undefined}>
        ${
          c.kind === 'channel'
            ? html`<span className="chatglyph" aria-hidden="true">${c.private ? html`<${Icon} n="key" />` : '#'}</span>`
            : c.kind === 'dm'
              ? html`<span className="chatavw">${chatAvatar(c.other, compact ? 26 : 30)}${S.online.has(c.other) && html`<i className="chaton" title="Online"></i>`}</span>`
              : html`<span className="chatglyph" aria-hidden="true"><${Icon} n="users" /></span>`
        }
        <span className="chatrow-main"><b>${c.name}</b>${!compact && c.lastText ? html`<span className="small">${c.lastText}</span>` : null}</span>
        ${c.muted && html`<span className="chatmute" title="Muted"><${Icon} n="bellx" /></span>`}
        ${n > 0 ? html`<span className="badge">${n > 99 ? '99+' : n}</span>` : c.unread > 0 && !c.muted ? html`<i className="chatdot" aria-label="New messages"></i>` : null}
      </button>`;
  };
  return html`<div className="chatlist">
      <div className="chatlist-find"><input type="search" value=${q} onInput=${e => setQ(e.target.value)} placeholder="Find a conversation, person or message" aria-label="Find a conversation, person or message" /></div>
      <div className="chatlist-scroll">
        ${
          people.length > 0 &&
          html`<div className="chatsec">People</div>${people.map(
            p => html`<button key=${'p' + p.id} type="button" className="chatrow" onClick=${() => startDm(p.id)}>
              <span className="chatavw">${chatAvatar(p.id, 28)}${S.online.has(p.id) && html`<i className="chaton"></i>`}</span>
              <span className="chatrow-main"><b>${p.n}</b><span className="small">${p.t} · start a conversation</span></span>
            </button>`
          )}`
        }
        <div className="chatsec">Direct messages</div>
        ${direct.length ? direct.map(row) : html`<p className="muted small chatnone">${needle ? 'None match.' : 'No conversations yet. Press New to message someone.'}</p>`}
        <div className="chatsec">Channels${onBrowse && html` <button type="button" className="linkbtn small" onClick=${onBrowse}>Browse</button>`}</div>
        ${channels.length ? channels.map(row) : html`<p className="muted small chatnone">${needle ? 'None match.' : 'You are in no channel yet.'}</p>`}
        ${
          found &&
          html`<div className="chatsec">Messages</div>${
            found.length
              ? found.map(m => {
                  const c = S.conv(m.c);
                  return html`<button key=${'s' + m.s} type="button" className="chatrow chatfound" onClick=${() => onOpen({ id: m.c, seq: m.s })}>
                    <span className="chatavw">${chatAvatar(m.u, 26)}</span>
                    <span className="chatrow-main"><b>${S.person(m.u).n}${c ? html` <span className="muted small">in ${chatTitle(c)}</span>` : ''}</b><span className="small">${(m.b || (m.a[0] ? '[' + m.a[0].n + ']' : '')).slice(0, 120)}</span></span>
                    <span className="muted small nw">${fmtTs(m.at)}</span>
                  </button>`;
                })
              : html`<p className="muted small chatnone">No message has those words.</p>`
          }`
        }
      </div>
    </div>`;
}

/* ---- one message ---- */
function ChatEditBox({ m, conv, onDone }) {
  const toast = useToast();
  const [t, setT] = useState(m.b);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api('chat_edit', { seq: m.s, body: t });
      ChatStore.merge(conv.id, [r.msg]);
      ChatStore.emit();
      onDone();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<div className="chatedit">
      <textarea rows="2" value=${t} onInput=${e => setT(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); } if (e.key === 'Escape') onDone(); }} aria-label="Edit the message" />
      <div className="actions"><span className="muted small">Enter saves · Esc cancels</span><button type="button" className="btn ghost sm" onClick=${onDone}>Cancel</button><button type="button" className="btn sm" disabled=${busy} onClick=${save}>Save</button></div>
    </div>`;
}
function ChatMsg({ m, conv, grouped, mine, seen, editing, onEdit, onReply, flash }) {
  const S = ChatStore;
  const toast = useToast();
  const [pick, setPick] = useState(false);
  const [tools, setTools] = useState(false); // phones: a tap on the message shows its actions
  const me = S.boot.me.id;
  const act = async (route, body, msg) => {
    try {
      const r = await api(route, { seq: m.s, ...body });
      S.merge(conv.id, [r.msg]);
      if (route === 'chat_pin') S.view(conv.id).pins += body.on ? 1 : -1;
      S.emit();
      msg && toast(msg);
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const canEdit = mine && S.boot.edit && !m.d;
  const canDelete = !m.d && ((mine && S.boot.edit) || (S.boot.admin && conv.kind === 'channel'));
  const p = S.person(m.u);
  const toMe = (m.m || []).includes(me) || ((m.m || []).includes('*') && !mine);
  const reacts = Object.entries(m.x || {});
  return html`<div className=${'chatmsg' + (grouped ? ' grouped' : '') + (mine ? ' mine' : '') + (m.d ? ' deleted' : '') + (toMe ? ' tome' : '') + (flash ? ' flash' : '') + (tools ? ' showtools' : '')} id=${'chatm' + m.s} onClick=${e => window.innerWidth <= 900 && !e.target.closest('a,button,textarea') && setTools(!tools)}>
      <div className="chatmsg-av">${grouped ? html`<span className="chatmsg-time">${fmtTime(m.at)}</span>` : chatAvatar(m.u, 34)}</div>
      <div className="chatmsg-main">
        ${!grouped && html`<div className="chatmsg-head"><b>${p.n}</b><span className="muted small">${fmtTime(m.at)}${m.e ? ' · edited' : ''}</span>${m.p ? html`<span className="chatpinned"><${Icon} n="pin" />pinned</span>` : null}</div>`}
        ${m.rp && html`<div className="chatquote"><b>${S.person(m.rp.u).n}</b> ${m.rp.d ? html`<i>deleted message</i>` : m.rp.b || (m.rp.f ? '(a file)' : '')}</div>`}
        ${
          m.d
            ? html`<p className="chattext muted small"><i>This message was deleted.</i></p>`
            : editing
              ? html`<${ChatEditBox} m=${m} conv=${conv} onDone=${() => onEdit(null)} />`
              : m.b && html`<div className="chattext">${chatRender(m.b, m.m)}${grouped && m.e ? html` <span className="muted small">(edited)</span>` : null}</div>`
        }
        ${
          m.a.length > 0 &&
          html`<div className="chatfiles">${m.a.map(a =>
            a.ty.indexOf('image/') === 0
              ? html`<a key=${a.i} className="chatimg" href=${chatFileUrl(m, a)} target="_blank" rel="noopener"><img src=${chatFileUrl(m, a)} alt=${a.n} loading="lazy" /></a>`
              : html`<a key=${a.i} className="chatfile" href=${chatFileUrl(m, a, a.ty !== 'application/pdf')} target="_blank" rel="noopener"><${Icon} n="file" /><span><b>${a.n}</b><span className="muted small">${chatSize(a.sz)}</span></span></a>`
          )}</div>`
        }
        ${
          reacts.length > 0 &&
          html`<div className="chatreacts">${reacts.map(
            ([e, ids]) => html`<button key=${e} type="button" className=${ids.includes(me) ? 'on' : ''} title=${ids.map(id => S.person(id).n).join(', ')} aria-label=${e + ' ' + ids.length + (ids.includes(me) ? ', including you' : '')} onClick=${() => act('chat_react', { e })}>${e} <b>${ids.length}</b></button>`
          )}</div>`
        }
        ${seen && html`<div className="chatseen muted small">Seen</div>`}
      </div>
      ${
        !m.d &&
        !editing &&
        html`<div className="chatmsg-tools" role="toolbar" aria-label="Message actions">
          <button type="button" title="React" aria-label="React" onClick=${() => setPick(!pick)}><${Icon} n="smile" /></button>
          <button type="button" title="Reply" aria-label="Reply" onClick=${() => onReply(m)}><${Icon} n="reply" /></button>
          <button type="button" title=${m.p ? 'Unpin' : 'Pin'} aria-label=${m.p ? 'Unpin' : 'Pin'} onClick=${() => act('chat_pin', { on: !m.p }, m.p ? 'Unpinned.' : 'Pinned for everyone here.')}><${Icon} n="pin" /></button>
          ${canEdit && html`<button type="button" title="Edit" aria-label="Edit" onClick=${() => onEdit(m.s)}><${Icon} n="pen" /></button>`}
          ${canDelete && html`<button type="button" title="Delete" aria-label="Delete" onClick=${() => confirm(mine ? 'Delete this message for everyone?' : 'Remove this message from the channel?') && act('chat_delete', {}, 'Deleted.')}><${Icon} n="trash" /></button>`}
        </div>`
      }
      ${pick && html`<div className="chatreactpick" role="menu">${S.boot.emoji.map(e => html`<button key=${e} type="button" role="menuitem" onClick=${() => { setPick(false); act('chat_react', { e }); }}>${e}</button>`)}</div>`}
    </div>`;
}

/* ---- writing a message ---- */
function ChatComposer({ conv, reply, onReply, members }) {
  const S = ChatStore;
  const toast = useToast();
  const [text, setText] = useState(() => ChatDrafts.get(conv.id) || '');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [men, setMen] = useState(null); // { start, list, i }
  const ta = useRef(null);
  const fileIn = useRef(null);
  const typed = useRef(0);
  const me = S.boot.me.id;
  useEffect(() => {
    if (reply && ta.current) ta.current.focus();
  }, [reply]);
  useEffect(() => {
    // grow with the text, up to about eight lines
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 180) + 'px';
  }, [text]);
  const others = members.filter(id => id !== me);
  const onInput = e => {
    const val = e.target.value;
    setText(val);
    ChatDrafts.set(conv.id, val);
    const before = val.slice(0, e.target.selectionStart);
    const mm = before.match(/(^|\s)@([^\s@][^@\n]{0,30})?$/);
    if (mm) {
      const q = (mm[2] || '').toLowerCase();
      const list = [...(conv.kind !== 'dm' ? [{ id: '*', n: 'everyone', t: 'Everyone in this conversation' }] : []), ...others.map(id => S.person(id))]
        .filter(p => !q || p.n.toLowerCase().startsWith(q) || p.n.toLowerCase().includes(' ' + q))
        .slice(0, 6);
      setMen(list.length ? { start: before.length - (mm[2] || '').length - 1, list, i: 0 } : null);
    } else setMen(null);
    if (val.trim()) {
      if (Date.now() - typed.current > 3000) {
        typed.current = Date.now();
        api('chat_typing', { conv: conv.id }).catch(() => {});
      }
    } else if (typed.current) {
      // the text was cleared: stop showing "is typing" straight away
      typed.current = 0;
      api('chat_typing', { conv: conv.id, stop: 1 }).catch(() => {});
    }
  };
  const pickMention = p => {
    const el = ta.current;
    const end = el ? el.selectionStart : text.length;
    const val = text.slice(0, men.start) + '@' + p.n + ' ' + text.slice(end);
    setText(val);
    ChatDrafts.set(conv.id, val);
    const caret = men.start + p.n.length + 2;
    setMen(null);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };
  const send = async () => {
    const body = text.trim();
    if ((!body && !files.length) || busy) return;
    // a mention is a name still written in the text
    const ids = [...(conv.kind !== 'dm' && /(^|\s)@everyone\b/i.test(body) ? ['*'] : []), ...others.filter(id => body.toLowerCase().includes('@' + S.person(id).n.toLowerCase()))];
    setBusy(true);
    try {
      let r;
      if (files.length) {
        const fd = new FormData();
        fd.append('conv', conv.id);
        fd.append('body', body);
        fd.append('reply', reply ? String(reply.s) : '0');
        fd.append('mentions', JSON.stringify(ids));
        files.forEach((f, i) => fd.append('f' + i, f));
        r = await upload('chat_send', fd);
      } else r = await api('chat_send', { conv: conv.id, body, reply: reply ? reply.s : 0, mentions: ids });
      setText('');
      ChatDrafts.delete(conv.id);
      setFiles([]);
      onReply(null);
      // sending ends "is typing" on the server, so the next keystroke announces it again
      typed.current = 0;
      S.afterSend(conv.id, r.msg);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
    requestAnimationFrame(() => ta.current && ta.current.focus());
  };
  const onKey = e => {
    if (men) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setMen({ ...men, i: (men.i + (e.key === 'ArrowDown' ? 1 : men.list.length - 1)) % men.list.length });
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pickMention(men.list[men.i]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMen(null);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    } else if (e.key === 'Escape' && reply) onReply(null);
  };
  const onPaste = e => {
    const fl = [...((e.clipboardData && e.clipboardData.files) || [])];
    if (fl.length) {
      e.preventDefault();
      setFiles([...files, ...fl].slice(0, 5));
    }
  };
  if (!conv.canPost) return html`<div className="chatcompose chatreadonly muted small">Only StratEdge staff post in ${chatTitle(conv)}. Reply to a post in a direct message.</div>`;
  return html`<div className="chatcompose">
      ${
        reply &&
        html`<div className="chatreplying"><${Icon} n="reply" /><span>Replying to <b>${S.person(reply.u).n}</b>: ${(reply.b || (reply.a[0] ? '[' + reply.a[0].n + ']' : '')).slice(0, 90)}</span><button type="button" className="btn ghost icon sm" aria-label="Cancel the reply" onClick=${() => onReply(null)}><${Icon} n="x" /></button></div>`
      }
      ${
        files.length > 0 &&
        html`<div className="chatpending">${files.map((f, i) => html`<span key=${i} className="chip"><${Icon} n="file" />${f.name} <span className="muted">${chatSize(f.size)}</span><button type="button" aria-label=${'Remove ' + f.name} onClick=${() => setFiles(files.filter((_, j) => j !== i))}><${Icon} n="x" /></button></span>`)}</div>`
      }
      <div className="chatcompose-row">
        <button type="button" className="btn ghost icon sm" title="Attach files (up to 5)" aria-label="Attach files" onClick=${() => fileIn.current && fileIn.current.click()}><${Icon} n="clip" /></button>
        <input ref=${fileIn} type="file" multiple hidden onChange=${e => { setFiles([...files, ...e.target.files].slice(0, 5)); e.target.value = ''; }} />
        <textarea ref=${ta} rows="1" value=${text} onInput=${onInput} onKeyDown=${onKey} onPaste=${onPaste} placeholder=${'Message ' + chatTitle(conv)} aria-label="Message" />
        <button type="button" className="btn sm chatsend" disabled=${busy || (!text.trim() && !files.length)} onClick=${send} aria-label="Send"><${Icon} n="send" /></button>
      </div>
      ${
        men &&
        html`<div className="chatmentions" role="listbox" aria-label="People to mention">${men.list.map(
          (p, i) => html`<button key=${p.id} type="button" role="option" aria-selected=${i === men.i} className=${i === men.i ? 'on' : ''} onMouseDown=${e => { e.preventDefault(); pickMention(p); }}>
            ${p.id === '*' ? html`<span className="chatglyph">@</span>` : chatAvatar(p.id, 22)}<b>${p.id === '*' ? '@everyone' : p.n}</b><span className="muted small">${p.t || ''}</span>
          </button>`
        )}</div>`
      }
    </div>`;
}

/* ---- a conversation ---- */
function ChatView({ id, compact, onBack, seq }) {
  const S = useChat();
  const toast = useToast();
  const conv = S.conv(id);
  const v = S.view(id);
  const list = useRef(null);
  const bottom = useRef(true);
  const [reply, setReply] = useState(null);
  const [edit, setEdit] = useState(null);
  const [info, setInfo] = useState(false);
  const [pins, setPins] = useState(null);
  const [flash, setFlash] = useState(seq || 0);
  useEffect(() => {
    S.openView(id);
    if (!v.loaded) S.loadView(id);
    return () => S.closeView(id);
  }, [id]);
  const msgs = [...v.msgs.values()].sort((a, b) => a.s - b.s);
  const lastSeq = msgs.length ? msgs[msgs.length - 1].s : 0;
  useEffect(() => {
    const el = list.current;
    if (!el || !v.loaded) return;
    if (flash) {
      const target = document.getElementById('chatm' + flash);
      if (target) {
        // centre it inside the message list only (scrollIntoView would also scroll the page behind)
        const r = target.getBoundingClientRect();
        const c = el.getBoundingClientRect();
        el.scrollTop += r.top - c.top - (c.height - r.height) / 2;
        bottom.current = false;
        setTimeout(() => setFlash(0), 2500);
        return;
      }
    }
    if (bottom.current) {
      el.scrollTop = el.scrollHeight;
      if (!document.hidden) S.markRead(id);
    }
  }, [lastSeq, v.loaded]);
  useEffect(() => {
    const onVis = () => !document.hidden && bottom.current && S.markRead(id);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [id]);
  const onScroll = e => {
    const el = e.currentTarget;
    bottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (bottom.current) S.markRead(id);
  };
  const earlier = async () => {
    const el = list.current;
    const h = el ? el.scrollHeight : 0;
    const top = el ? el.scrollTop : 0;
    const n = await S.older(id);
    if (n && el) requestAnimationFrame(() => (el.scrollTop = el.scrollHeight - h + top));
  };
  if (!conv)
    return html`<div className="chatview"><div className="chatempty"><${Empty} title="This conversation is not available" action=${onBack && html`<button type="button" className="btn ghost" onClick=${onBack}>Back</button>`}>You may have left it, or it was archived.<//></div></div>`;
  const me = S.boot.me.id;
  const members = conv.kind === 'channel' ? v.members.map(x => x.id) : conv.members;
  const lastMine = [...msgs].reverse().find(m => m.u === me && m.k === 'msg' && !m.d);
  const otherRead = conv.kind === 'dm' ? v.reads.get(conv.other) || 0 : 0;
  const rows = [];
  let day = '';
  let prev = null;
  msgs.forEach(m => {
    const d = new Date(m.at).toDateString();
    if (d !== day) {
      rows.push(html`<div key=${'d' + m.s} className="chatday"><span>${chatDayLabel(m.at)}</span></div>`);
      day = d;
      prev = null;
    }
    if (v.newFrom && m.s === v.newFrom) rows.push(html`<div key=${'n' + m.s} className="chatnew"><span>New</span></div>`);
    if (m.k === 'sys') {
      rows.push(html`<div key=${m.s} className="chatsys">${m.b} · ${fmtTime(m.at)}</div>`);
      prev = null;
      return;
    }
    const grouped = !!prev && prev.u === m.u && m.at - prev.at < 300000 && !m.r && !prev.d;
    rows.push(html`<${ChatMsg} key=${m.s} m=${m} conv=${conv} grouped=${grouped} mine=${m.u === me} seen=${!!lastMine && m.s === lastMine.s && otherRead >= m.s} editing=${edit === m.s} onEdit=${setEdit} onReply=${setReply} flash=${flash === m.s} />`);
    prev = m;
  });
  const sub =
    conv.kind === 'dm'
      ? (S.online.has(conv.other) ? 'Online · ' : '') + (S.person(conv.other).t || '')
      : conv.kind === 'channel'
        ? conv.topic || conv.n + ' members'
        : conv.n + ' people';
  const showPins = () =>
    api('chat_pins', { conv: id }).then(
      r => setPins(r.msgs),
      e => toast(errText(e), true)
    );
  return html`<div className=${'chatview' + (compact ? ' compact' : '')}>
      <div className="chathead">
        ${onBack && html`<button type="button" className="btn ghost icon sm chatback" aria-label="Back to the conversations" onClick=${onBack}><${Icon} n="left" /></button>`}
        ${conv.kind === 'dm' ? html`<span className="chatavw">${chatAvatar(conv.other, 32)}${S.online.has(conv.other) && html`<i className="chaton"></i>`}</span>` : html`<span className="chatglyph big" aria-hidden="true">${conv.kind === 'channel' ? (conv.private ? html`<${Icon} n="key" />` : '#') : html`<${Icon} n="users" />`}</span>`}
        <div className="chathead-main"><b>${conv.name}</b><span className="muted small">${sub}</span></div>
        <div className="actions">
          ${v.pins > 0 && html`<button type="button" className="btn ghost sm" onClick=${showPins} title="Pinned messages"><${Icon} n="pin" />${v.pins}</button>`}
          <button type="button" className="btn ghost icon sm" title="Details, people and settings" aria-label="Details" onClick=${() => setInfo(true)}><${Icon} n="more" /></button>
        </div>
      </div>
      <div className="chatmsgs" ref=${list} onScroll=${onScroll} role="log" aria-live="polite" aria-label=${'Messages in ' + chatTitle(conv)}>
        ${!v.loaded && !v.err && html`<${Spinner} />`}
        ${v.err && html`<${Empty} title="The messages did not load">${v.err}<//>`}
        ${v.loaded && v.more && html`<div className="chatearlier"><button type="button" className="btn ghost sm" disabled=${!!v.loadingOlder} onClick=${earlier}>${v.loadingOlder ? 'Loading…' : 'Earlier messages'}</button></div>`}
        ${v.loaded && !msgs.length && html`<div className="chatstart"><b>${conv.kind === 'dm' ? 'This is the start of your conversation with ' + conv.name + '.' : 'This is the start of ' + chatTitle(conv) + '.'}</b><span className="muted small">${conv.kind === 'channel' && conv.topic ? conv.topic : 'Say hello.'}</span></div>`}
        ${rows}
      </div>
      ${v.typing.length > 0 && html`<div className="chattyping muted small">${v.typing.join(', ')} ${v.typing.length === 1 ? 'is' : 'are'} typing…</div>`}
      <${ChatComposer} key=${id} conv=${conv} reply=${reply} onReply=${setReply} members=${members} />
      ${info && html`<${ChatInfo} conv=${conv} v=${v} onClose=${() => setInfo(false)} onLeft=${() => { setInfo(false); onBack && onBack(); }} />`}
      ${
        pins &&
        html`<${Modal} title=${'Pinned in ' + chatTitle(conv)} onClose=${() => setPins(null)}>
          ${pins.length === 0 ? html`<p className="muted">Nothing is pinned.</p>` : html`<div className="chatpins">${pins.map(m => html`<div key=${m.s} className="chatpinrow"><div className="small"><b>${S.person(m.u).n}</b> <span className="muted">${fmtTs(m.at)}</span></div><div className="chattext">${chatRender(m.b, m.m)}${m.a.length ? ' [' + m.a.map(a => a.n).join(', ') + ']' : ''}</div></div>`)}</div>`}
        <//>`
      }
    </div>`;
}

/* ---- details: people, mute, rename, channel settings, leave ---- */
function ChatInfo({ conv, v, onClose, onLeft }) {
  const S = useChat();
  const toast = useToast();
  const [add, setAdd] = useState(null);
  const [f, setF] = useState({ name: conv.name, topic: conv.topic, private: conv.private, aud: conv.aud, posting: conv.posting });
  const [busy, setBusy] = useState(false);
  const me = S.boot.me.id;
  const owner = conv.role === 'owner' || S.boot.admin;
  const ids = conv.kind === 'channel' ? v.members.map(x => x.id) : conv.members;
  const run = async (route, body, msg, after) => {
    setBusy(true);
    try {
      await S.act(route, { conv: conv.id, ...body });
      msg && toast(msg);
      if (conv.kind === 'channel') S.loadView(conv.id);
      after && after();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const canAdd = conv.kind === 'group' || (conv.kind === 'channel' && (!conv.private || owner));
  return html`<${Modal} title=${chatTitle(conv)} onClose=${onClose} foot=${html`${conv.kind !== 'dm' && html`<button className="btn ghost" style=${{ marginRight: 'auto' }} disabled=${busy} onClick=${() => confirm('Leave ' + chatTitle(conv) + '?') && run('chat_leave', {}, 'You left.', onLeft)}>Leave</button>`}<button className="btn ghost" onClick=${onClose}>Close</button>`}>
      <div className="stack" style=${{ gap: 14 }}>
        ${
          conv.kind === 'dm' &&
          html`<div className="chatwho">${chatAvatar(conv.other, 48)}<div><b>${conv.name}</b><div className="muted small">${S.person(conv.other).t}${S.online.has(conv.other) ? ' · online' : ''}</div></div></div>`
        }
        <label className="check"><input type="checkbox" checked=${conv.muted} disabled=${busy} onChange=${e => run('chat_mute', { on: e.target.checked }, e.target.checked ? 'Muted: no badge or emails for it.' : 'Unmuted.')} /><span>Mute: no badge count and no emails from this conversation</span></label>
        ${
          conv.kind === 'group' &&
          html`<div className="form row2" style=${{ alignItems: 'end' }}><${Field} label="Group name (optional)"><input value=${f.name} onInput=${e => setF({ ...f, name: e.target.value })} maxLength="80" /><//><div className="actions"><button type="button" className="btn sm" disabled=${busy} onClick=${() => run('chat_rename', { name: f.name }, 'Renamed.')}>Save name</button></div></div>`
        }
        ${
          conv.kind === 'channel' &&
          (owner
            ? html`<div className="form stack" style=${{ gap: 10 }}>
                <div className="row2">
                  <${Field} label="Channel name"><input value=${f.name} onInput=${e => setF({ ...f, name: e.target.value })} maxLength="40" /><//>
                  <${Field} label="Topic"><input value=${f.topic} onInput=${e => setF({ ...f, topic: e.target.value })} maxLength="300" /><//>
                </div>
                <label className="check"><input type="checkbox" checked=${f.private} onChange=${e => setF({ ...f, private: e.target.checked })} /><span>Private: only the people added see it</span></label>
                ${S.boot.me.k === 'staff' && html`<label className="check"><input type="checkbox" checked=${f.aud === 'all'} onChange=${e => setF({ ...f, aud: e.target.checked ? 'all' : 'team' })} /><span>Open to everyone who uses Messages (consultants, students and clients too, when switched on), not only the team</span></label>`}
                ${S.boot.me.k === 'staff' && html`<label className="check"><input type="checkbox" checked=${f.posting === 'staff'} onChange=${e => setF({ ...f, posting: e.target.checked ? 'staff' : 'all' })} /><span>Only staff post (an announcement channel)</span></label>`}
                <div className="actions"><button type="button" className="btn sm" disabled=${busy} onClick=${() => run('chat_channel_save', { id: conv.id, ...f }, 'Channel saved.')}>Save channel</button>${(S.boot.admin || !conv.def) && html`<button type="button" className="btn ghost sm" disabled=${busy} onClick=${() => confirm('Archive #' + conv.name + '? It disappears from everyone\'s list; its messages are kept.') && run('chat_archive', {}, 'Archived.', onLeft)}>Archive</button>`}</div>
              </div>`
            : html`<p className="muted small" style=${{ margin: 0 }}>${conv.topic || 'No topic.'} ${conv.private ? 'Private channel.' : 'Public channel.'}${conv.posting === 'staff' ? ' Only staff post here.' : ''}</p>`)
        }
        <div>
          <div className="ph-row" style=${{ margin: '0 0 6px' }}><b>${ids.length} ${ids.length === 1 ? 'person' : 'people'}</b>${canAdd && html`<button type="button" className="btn ghost sm" onClick=${() => setAdd(add ? null : [])}><${Icon} n="plus" />Add people</button>`}</div>
          ${
            add &&
            html`<div className="stack" style=${{ gap: 8, marginBottom: 10 }}>
              <${ChatPeoplePick} multi picked=${add} onChange=${setAdd} exclude=${ids} only=${conv.kind === 'channel' && conv.aud === 'team' ? p => ['staff', 'employee'].includes(p.k) : null} />
              <div className="actions"><button type="button" className="btn sm" disabled=${busy || !add.length} onClick=${() => run('chat_members_add', { uids: add }, 'Added.', () => setAdd(null))}>Add ${add.length || ''}</button></div>
            </div>`
          }
          <div className="chatmembers">${ids.map(
            id => html`<div key=${id} className="chatmember">
              <span className="chatavw">${chatAvatar(id, 26)}${S.online.has(id) && html`<i className="chaton"></i>`}</span>
              <span className="chatpick-name"><b>${S.person(id).n}${id === me ? ' (you)' : ''}</b><span className="muted small">${S.person(id).t}</span></span>
              ${owner && conv.kind !== 'dm' && id !== me && html`<button type="button" className="btn ghost sm" disabled=${busy} onClick=${() => confirm('Remove ' + S.person(id).n + '?') && run('chat_members_remove', { uid: id }, 'Removed.')}>Remove</button>`}
            </div>`
          )}</div>
        </div>
      </div>
    <//>`;
}

/* ---- starting something: a direct message, a group, a channel; browsing channels ---- */
function ChatNew({ tab: tab0, onClose, onOpen }) {
  const S = useChat();
  const toast = useToast();
  const [tab, setTab] = useState(tab0 || 'dm');
  const [picked, setPicked] = useState([]);
  const [name, setName] = useState('');
  const [ch, setCh] = useState({ name: '', topic: '', private: false, aud: 'team', posting: 'all' });
  const [chPeople, setChPeople] = useState([]);
  const [browse, setBrowse] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (tab === 'browse')
      api('chat_channels', {}).then(
        r => setBrowse(r.channels),
        e => toast(errText(e), true)
      );
  }, [tab]);
  const go = async (route, body) => {
    setBusy(true);
    try {
      const r = await S.act(route, body);
      onOpen(r.id);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const tabs = [['dm', 'Message people'], ...(S.boot.canChannel ? [['channel', 'New channel']] : []), ['browse', 'Browse channels']];
  return html`<${Modal} title="New conversation" onClose=${onClose} wide>
      <div className="stack" style=${{ gap: 12 }}>
        <${KitTabs} tabs=${tabs} tab=${tab} onTab=${setTab} />
        ${
          tab === 'dm' &&
          html`<${Fragment}>
            <p className="muted small" style=${{ margin: 0 }}>Pick one person for a direct message, or several for a group conversation.</p>
            <${ChatPeoplePick} multi picked=${picked} onChange=${setPicked} />
            ${picked.length > 1 && html`<${Field} label="Group name (optional)"><input value=${name} onInput=${e => setName(e.target.value)} maxLength="80" placeholder="e.g. Java bench team" /><//>`}
            <div className="actions"><button type="button" className="btn" disabled=${busy || !picked.length} onClick=${() => (picked.length === 1 ? go('chat_dm', { uid: picked[0] }) : go('chat_group', { uids: picked, name }))}>${picked.length > 1 ? 'Start the group (' + (picked.length + 1) + ' people)' : 'Open the conversation'}</button></div>
          <//>`
        }
        ${
          tab === 'channel' &&
          html`<div className="form stack" style=${{ gap: 10 }}>
            <div className="row2">
              <${Field} label="Name" hint="Lowercase, numbers and dashes: recruiting, java-bench, payroll-help"><input value=${ch.name} onInput=${e => setCh({ ...ch, name: e.target.value })} maxLength="40" /><//>
              <${Field} label="Topic (optional)"><input value=${ch.topic} onInput=${e => setCh({ ...ch, topic: e.target.value })} maxLength="300" /><//>
            </div>
            <label className="check"><input type="checkbox" checked=${ch.private} onChange=${e => setCh({ ...ch, private: e.target.checked })} /><span>Private: only the people you add see it</span></label>
            ${S.boot.me.k === 'staff' && html`<label className="check"><input type="checkbox" checked=${ch.aud === 'all'} onChange=${e => setCh({ ...ch, aud: e.target.checked ? 'all' : 'team' })} /><span>Open to everyone who uses Messages, not only the StratEdge team</span></label>`}
            ${S.boot.me.k === 'staff' && html`<label className="check"><input type="checkbox" checked=${ch.posting === 'staff'} onChange=${e => setCh({ ...ch, posting: e.target.checked ? 'staff' : 'all' })} /><span>Only staff post (announcements)</span></label>`}
            <div className="fld"><span>Add people now (optional)</span><${ChatPeoplePick} multi picked=${chPeople} onChange=${setChPeople} only=${ch.aud === 'team' ? p => ['staff', 'employee'].includes(p.k) : null} /></div>
            <div className="actions"><button type="button" className="btn" disabled=${busy || !ch.name.trim()} onClick=${() => go('chat_channel_save', { ...ch, uids: chPeople })}>Create #${(ch.name || 'channel').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}</button></div>
          </div>`
        }
        ${
          tab === 'browse' &&
          (!browse
            ? html`<${Spinner} />`
            : browse.length
              ? html`<div className="chatbrowse">${browse.map(
                  c => html`<div key=${c.id} className="chatbrowse-row">
                    <span className="chatglyph">#</span>
                    <span className="chatpick-name"><b>${c.name}</b><span className="muted small">${c.topic || ''}${c.topic ? ' · ' : ''}${c.n} ${c.n === 1 ? 'member' : 'members'}</span></span>
                    ${c.mine ? html`<button type="button" className="btn ghost sm" onClick=${() => onOpen(c.id)}>Open</button>` : html`<button type="button" className="btn sm" disabled=${busy} onClick=${() => go('chat_join', { conv: c.id })}>Join</button>`}
                  </div>`
                )}</div>`
              : html`<${Empty} title="No public channels yet">${S.boot.canChannel ? 'Create the first one.' : 'Channels are created by StratEdge staff.'}<//>`)
        }
      </div>
    <//>`;
}

/* ---- settings: my emails and notifications; Messages for administrators ---- */
function ChatPrefs({ onClose }) {
  const S = useChat();
  const toast = useToast();
  const [email, setEmail] = useState(!!S.boot.prefs.email);
  const [desk, setDesk] = useState(() => {
    try {
      return localStorage.getItem('se.chat.desk') === '1' && typeof Notification !== 'undefined' && Notification.permission === 'granted';
    } catch (e) {
      return false;
    }
  });
  const saveEmail = async on => {
    setEmail(on);
    try {
      const r = await api('chat_prefs_save', { email: on });
      S.boot.prefs = r.prefs;
      toast(on ? 'You get an email about unread direct messages and mentions.' : 'No emails about messages.');
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const saveDesk = async on => {
    if (on && typeof Notification === 'undefined') return toast('This browser has no notifications.', true);
    if (on && Notification.permission !== 'granted') {
      const p = await Notification.requestPermission();
      if (p !== 'granted') return toast('The browser did not allow notifications. Allow them for this site in the browser settings.', true);
    }
    try {
      localStorage.setItem('se.chat.desk', on ? '1' : '0');
    } catch (e) {}
    setDesk(on);
  };
  return html`<${Modal} title="Your message settings" onClose=${onClose}>
      <div className="stack" style=${{ gap: 12 }}>
        <label className="check"><input type="checkbox" checked=${email} onChange=${e => saveEmail(e.target.checked)} /><span>Email me about direct messages and mentions I haven't read for a while (never for muted conversations)</span></label>
        <label className="check"><input type="checkbox" checked=${desk} onChange=${e => saveDesk(e.target.checked)} /><span>Show a notification on this device when a message arrives while the portal is open in another tab</span></label>
        <p className="muted small" style=${{ margin: 0 }}>Mute a single conversation from its details (the … button).</p>
      </div>
    <//>`;
}
function ChatAdmin({ onClose }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () =>
    api('chat_admin', {}).then(
      r => {
        setD(r);
        setF(r.settings);
      },
      e => toast(errText(e), true)
    );
  useEffect(() => {
    load();
  }, []);
  const save = async () => {
    setBusy(true);
    try {
      await api('chat_admin_save', f);
      toast('Messages settings saved. People see the change when their page reloads.');
      onClose();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const archive = async (c, undo) => {
    try {
      await ChatStore.act('chat_archive', { conv: c.id, undo });
      load();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  return html`<${Modal} wide title="Messages settings" onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Cancel</button><button className="btn" disabled=${busy || !f} onClick=${save}>${busy ? 'Saving…' : 'Save'}</button>`}>
      ${
        !f
          ? html`<${Spinner} />`
          : html`<div className="stack form" style=${{ gap: 14 }}>
              <div className="fld"><span>Who uses Messages</span>
                <div className="stack" style=${{ gap: 6 }}>
                  <label className="check"><input type="checkbox" checked disabled /><span>StratEdge staff and employees (always) · ${(d.counts.staff || 0) + (d.counts.employee || 0)} people</span></label>
                  ${['consultant', 'outside', 'student', 'client'].map(k => html`<label key=${k} className="check"><input type="checkbox" checked=${!!f.who[k]} onChange=${e => setF({ ...f, who: { ...f.who, [k]: e.target.checked } })} /><span>${d.kinds[k]}${d.counts[k] ? ' · ' + d.counts[k] + ' now' : ''}</span></label>`)}
                </div>
                <small>People outside the team see only the team (and whoever they already talk to) in the people list.</small>
              </div>
              <div className="row2">
                <${Field} label="Who creates channels"><select value=${f.channels} onChange=${e => setF({ ...f, channels: e.target.value })}><option value="employee">Staff and employees</option><option value="staff">Staff only</option></select><//>
                <label className="check" style=${{ alignSelf: 'end' }}><input type="checkbox" checked=${!!f.edit} onChange=${e => setF({ ...f, edit: e.target.checked })} /><span>People may edit and delete their own messages</span></label>
              </div>
              <div className="row2">
                <${Field} label="Email about unread messages after (minutes)" hint="Direct messages and mentions only, to people who have not been back since. 0 = no emails."><input type="number" min="0" max="1440" value=${f.mailAfter} onInput=${e => setF({ ...f, mailAfter: +e.target.value })} /><//>
                <${Field} label="Delete messages older than (months)" hint="With their files. 0 keeps everything. Check your retention policy first."><input type="number" min="0" max="120" value=${f.retention} onInput=${e => setF({ ...f, retention: +e.target.value })} /><//>
              </div>
              <div>
                <b>Channels</b>
                <div className="tblwrap"><table className="tbl mini">
                  <thead><tr><th>Channel</th><th>For</th><th>People</th><th>Last message</th><th className="r"><span className="sr">Archive</span></th></tr></thead>
                  <tbody>${d.channels.map(
                    c => html`<tr key=${c.id} className=${c.archived ? 'muted' : ''}>
                      <td><b>#${c.name}</b>${c.private ? ' (private)' : ''}${c.def ? ' · default' : ''}${c.posting === 'staff' ? ' · staff post' : ''}<div className="muted small">${c.topic}</div></td>
                      <td className="small">${c.aud === 'all' ? 'Everyone' : 'The team'}</td>
                      <td className="small">${c.n}</td>
                      <td className="small">${c.lastAt ? fmtTs(c.lastAt) : '—'}</td>
                      <td className="r"><button type="button" className="btn ghost sm" onClick=${() => archive(c, c.archived)}>${c.archived ? 'Restore' : 'Archive'}</button></td>
                    </tr>`
                  )}</tbody>
                </table></div>
              </div>
            </div>`
      }
    <//>`;
}

/* ---- the Messages button at the top of the portal, with its side panel ---- */
function ChatPanel({ href, onClose }) {
  const S = useChat();
  const [id, setId] = useState(null);
  const [seq, setSeq] = useState(0);
  const [neu, setNeu] = useState(null);
  return html`<div className="askai chatpanel" role="dialog" aria-label="Messages">
      <div className="askai-head">
        <div style=${{ minWidth: 0 }}><b className="askai-title"><${Icon} n="chat" /> Messages</b><div className="muted small">${id && S.conv(id) ? chatTitle(S.conv(id)) : 'Your team conversations'}</div></div>
        <div className="actions">
          <button type="button" className="btn ghost sm" onClick=${() => setNeu('dm')}><${Icon} n="plus" />New</button>
          <a className="btn ghost sm" href=${href + (id ? '?c=' + id : '')} onClick=${onClose}>Full page</a>
          <button type="button" className="btn ghost icon sm" aria-label="Close" onClick=${onClose}><${Icon} n="x" /></button>
        </div>
      </div>
      <div className="chatpanel-body">
        ${
          !S.boot
            ? S.err
              ? html`<${Empty} title="Messages did not load">${errText(S.err)}<//>`
              : html`<${Spinner} />`
            : id
              ? html`<${ChatView} key=${id} id=${id} seq=${seq} compact onBack=${() => setId(null)} />`
              : html`<${ChatList} compact onOpen=${c => { setSeq(c.seq || 0); setId(c.id); }} onBrowse=${() => setNeu('browse')} />`
        }
      </div>
      ${neu && html`<${ChatNew} tab=${neu} onClose=${() => setNeu(null)} onOpen=${cid => { setNeu(null); setSeq(0); setId(cid); }} />`}
    </div>`;
}
function MessagesButton({ href }) {
  const S = useChat();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    S.href = href;
    S.start();
  }, [href]);
  useEffect(() => {
    const other = e => e.detail !== 'chat' && setOpen(false);
    window.addEventListener('se-panel', other);
    return () => window.removeEventListener('se-panel', other);
  }, []);
  useEffect(() => {
    if (!open) return;
    window.dispatchEvent(new CustomEvent('se-panel', { detail: 'chat' }));
    const onKey = e => e.key === 'Escape' && !document.querySelector('.modal') && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  // the full page has the conversations already: the panel closes when it opens
  useEffect(() => {
    const onHash = () => /\/messages(\?|$)/.test(location.hash) && setOpen(false);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const b = chatBadge(S.convs);
  return html`<${Fragment}>
    <button type="button" className="btn ghost sm chatbtn" onClick=${() => setOpen(!open)} aria-expanded=${open} title="Messages: chat with your team" aria-label=${'Messages' + (b.n ? ', ' + b.n + ' unread' : '')}>
      <${Icon} n="chat" /><span className="askai-label">Messages</span>${b.n > 0 ? html`<span className="badge chatbadge">${b.n > 99 ? '99+' : b.n}</span>` : b.dot ? html`<span className="chatdot chatbtndot"></span>` : null}
    </button>
    ${open && html`<${ChatPanel} href=${href} onClose=${() => setOpen(false)} />`}
  <//>`;
}

/* ---- the Messages page ---- */
function MessagesPage({ q }) {
  const S = useChat();
  const [id, setId] = useState(q && q.c ? q.c : null);
  const [seq, setSeq] = useState(0);
  const [neu, setNeu] = useState(null);
  const [prefs, setPrefs] = useState(false);
  const [admin, setAdmin] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    S.start();
  }, []);
  useEffect(() => {
    // fill the screen down to the bottom (above the phone tab bar), whatever notices sit above the page
    const fit = () => {
      const el = box.current;
      if (!el) return;
      const bar = document.querySelector('.app .tabbar');
      const below = bar && getComputedStyle(bar).display !== 'none' ? bar.getBoundingClientRect().height : 0;
      const top = el.getBoundingClientRect().top + window.scrollY;
      const h = Math.max(window.innerWidth > 900 ? 460 : 380, Math.floor(window.innerHeight - top - below - 18)) + 'px';
      if (el.style.height !== h) el.style.height = h;
    };
    fit();
    const ro = window.ResizeObserver ? new ResizeObserver(fit) : null;
    if (ro && box.current && box.current.parentElement) ro.observe(box.current.parentElement);
    window.addEventListener('resize', fit);
    return () => {
      window.removeEventListener('resize', fit);
      if (ro) ro.disconnect();
    };
  }, [!!S.boot]);
  useEffect(() => {
    if (q && q.c) setId(q.c);
  }, [q && q.c]);
  useEffect(() => {
    // a wide screen opens the latest conversation straight away
    if (!id && S.boot && S.convs.length && window.innerWidth > 900) setId(S.convs[0].id);
  }, [!!S.boot]);
  if (!S.boot)
    return S.err
      ? html`<section className="panel"><${Empty} title="Messages did not load" action=${html`<button type="button" className="btn" onClick=${() => S.start()}>Try again</button>`}>${errText(S.err)}<//></section>`
      : html`<${Spinner} />`;
  return html`<div ref=${box} className=${'chatpage' + (id ? ' has-open' : '')}>
      <aside className="chatside">
        <div className="chatside-head">
          <b>Conversations</b>
          <div className="actions">
            <button type="button" className="btn sm" onClick=${() => setNeu('dm')}><${Icon} n="plus" />New</button>
            <button type="button" className="btn ghost icon sm" title="Your message settings" aria-label="Your message settings" onClick=${() => setPrefs(true)}><${Icon} n="user" /></button>
            ${S.boot.admin && html`<button type="button" className="btn ghost icon sm" title="Messages settings (administrators)" aria-label="Messages settings" onClick=${() => setAdmin(true)}><${Icon} n="key" /></button>`}
          </div>
        </div>
        <${ChatList} active=${id} onOpen=${c => { setSeq(c.seq || 0); setId(c.id); }} onBrowse=${() => setNeu('browse')} />
      </aside>
      <section className="chatmain">
        ${id ? html`<${ChatView} key=${id} id=${id} seq=${seq} onBack=${() => setId(null)} />` : html`<div className="chatempty"><${Empty} title="Pick a conversation" action=${html`<button type="button" className="btn" onClick=${() => setNeu('dm')}>Start one</button>`}>Message a colleague, start a group, or join a channel.<//></div>`}
      </section>
      ${neu && html`<${ChatNew} tab=${neu} onClose=${() => setNeu(null)} onOpen=${cid => { setNeu(null); setSeq(0); setId(cid); }} />`}
      ${prefs && html`<${ChatPrefs} onClose=${() => setPrefs(false)} />`}
      ${admin && html`<${ChatAdmin} onClose=${() => setAdmin(false)} />`}
    </div>`;
}
