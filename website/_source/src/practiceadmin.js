/* ================= v35: Practice & training (administrators, HR and managers) =================
   Who practises, how much and how well: practice calls and voice drills per person (this week against the team goal,
   the last 30 days, the trend and the weakest area), the last eight weeks for the team, every session with its
   transcript and feedback, reminders by email, and the settings (weekly goal, the organization's own questions per
   call). Managers see the people who report to them. Server: api/practice.php (pr_team, pr_person, pr_get,
   pr_remind, pr_settings_save). */
function PracticeAdminPage() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState('team');
  const [filter, setFilter] = useState('all');
  const [find, setFind] = useState('');
  const [open, setOpen] = useState(null);
  const [sel, setSel] = useState({});
  const [remind, setRemind] = useState(null);
  const load = () => api('pr_team', {}).then(setD, setErr);
  useEffect(() => {
    load();
  }, []);
  if (err) return html`<${LoadError} error=${err} onRetry=${() => (setErr(null), load())} />`;
  if (!d) return html`<${Spinner} />`;
  const goal = d.goal || 0;
  const ppl = d.people;
  const started = ppl.filter(p => p.total > 0);
  const weekActive = ppl.filter(p => p.week > 0).length;
  const metGoal = goal ? ppl.filter(p => p.week >= goal).length : 0;
  const avgs = ppl.filter(p => p.avg30 != null).map(p => p.avg30);
  const teamAvg = avgs.length ? Math.round(avgs.reduce((a, b) => a + b, 0) / avgs.length) : null;
  const FILTERS = [
    ['all', 'Everyone', () => true],
    ['below', 'Below the weekly goal', p => goal > 0 && p.week < goal],
    ['none', 'Not started', p => p.total === 0],
    ['help', 'Needs support', p => p.avg30 != null && p.avg30 < 60],
    ['up', 'Improving', p => p.trend != null && p.trend > 0],
  ];
  const f = (FILTERS.find(x => x[0] === filter) || FILTERS[0])[2];
  const needle = find.trim().toLowerCase();
  const shown = ppl.filter(p => f(p) && (!needle || (p.n + ' ' + p.e).toLowerCase().includes(needle)));
  const chosen = Object.keys(sel).filter(k => sel[k] && shown.some(p => p.uid === k));
  const exportCsv = () => {
    const head = ['Name', 'Email', 'Calls this week', 'Weekly goal', 'Calls (30 days)', 'Drills (30 days)', 'Minutes (30 days)', 'Average call score (30 days)', 'Best call (30 days)', 'Trend', 'Weakest area', 'Last practice', 'All sessions'];
    const cell = v => '"' + String(v == null ? '' : /^\s*[=+@-]/.test(String(v)) ? "'" + v : v).replace(/"/g, '""') + '"';
    const rows = shown.map(p => [p.n, p.e, p.week, goal, p.calls30, p.drills30, p.minutes30, p.avg30, p.best30, p.trend, p.weak ? PR_DIM_NAMES[p.weak] : '', p.last ? new Date(p.last).toISOString().slice(0, 10) : '', p.total]);
    saveDownload('practice-and-training.csv', new Blob([[head, ...rows].map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv' }));
  };
  const maxW = Math.max(1, ...d.weeks.map(w => w.calls + w.drills));
  const TABS = [['team', 'Team'], ['weeks', 'Last 8 weeks'], ...(d.canEdit ? [['settings', 'Settings']] : [])];
  return html`<div className="stack">
      <p className="muted small" style=${{ margin: 0, maxWidth: 760 }}>Consultants practise vendor screening calls, technical screens, client interviews, rate negotiation and visa questions out loud in Grow › Practice calls, plus listen-and-repeat and spoken flashcards. ${d.scope === 'team' ? 'You see the people who report to you.' : 'You see everyone who practises and every active consultant and student.'} Only words are saved, never audio.</p>
      <${KitStats} items=${[
        { v: weekActive, l: 'Practised this week' },
        { v: goal ? metGoal : d.weeks[7].calls, l: goal ? 'Met the goal of ' + goal + ' call' + (goal === 1 ? '' : 's') + ' this week' : 'Calls this week', tone: goal && metGoal ? 'ok' : '' },
        { v: teamAvg == null ? '—' : teamAvg, l: 'Average call score (30 days)', tone: teamAvg == null ? '' : teamAvg >= 75 ? 'ok' : teamAvg < 55 ? 'warn' : '' },
        { v: ppl.length - started.length, l: 'Not started', tone: ppl.length - started.length ? 'warn' : '', onClick: () => (setTab('team'), setFilter('none')) },
      ]} />
      <${KitTabs} wrap tabs=${TABS} tab=${tab} onTab=${setTab} />
      ${tab === 'team' &&
      html`<section className="panel stack" style=${{ gap: 10 }}>
          <div className="ph-row" style=${{ margin: 0, flexWrap: 'wrap', gap: 8 }}>
            <div className="actions">${FILTERS.map(([k, n, fn]) => html`<button key=${k} type="button" className=${'btn sm ' + (filter === k ? '' : 'ghost')} onClick=${() => setFilter(k)}>${n} <span className="muted">${ppl.filter(fn).length}</span></button>`)}</div>
            <div className="actions">
              <input type="search" value=${find} onChange=${e => setFind(e.target.value)} placeholder="Find a person" aria-label="Find a person" style=${{ width: 180 }} />
              <button type="button" className="btn ghost sm" disabled=${!chosen.length} onClick=${() => setRemind(chosen)}><${Icon} n="mail" />Remind${chosen.length ? ' ' + chosen.length : ''}</button>
              <button type="button" className="btn ghost sm" disabled=${!shown.length} onClick=${exportCsv}><${Icon} n="down" />Export</button>
            </div>
          </div>
          ${shown.length === 0
            ? html`<${Empty} title=${ppl.length ? 'Nobody here' : 'No consultants yet'}>${ppl.length ? 'Choose another filter.' : 'Active consultants and students show up here, with everyone who has practised.'}<//>`
            : html`<div className="tblwrap"><table className="tbl prteam">
                <thead><tr>
                  <th style=${{ width: 30 }}><input type="checkbox" aria-label="Select everyone shown" checked=${chosen.length > 0 && chosen.length === shown.length} onChange=${e => setSel(e.target.checked ? Object.fromEntries(shown.map(p => [p.uid, true])) : {})} /></th>
                  <th>Person</th><th>This week</th><th className="r">Calls</th><th className="r">Drills</th><th className="r">Minutes</th><th className="r">Avg score</th><th>Trend</th><th>Work on</th><th>Last practice</th>
                </tr></thead>
                <tbody>${shown.map(
                  p => html`<tr key=${p.uid} className="click" onClick=${e => e.target.type !== 'checkbox' && setOpen(p)}>
                    <td><input type="checkbox" aria-label=${'Select ' + p.n} checked=${!!sel[p.uid]} onChange=${e => setSel(x => ({ ...x, [p.uid]: e.target.checked }))} /></td>
                    <td><b>${p.n}</b><span className="muted small" style=${{ display: 'block' }}>${p.e}</span></td>
                    <td>${goal ? html`<${Chip} s=${p.week >= goal ? 'ok' : p.week ? 'amber' : ''}>${p.week} of ${goal}<//>` : p.week}</td>
                    <td className="r">${p.calls30}</td>
                    <td className="r">${p.drills30}</td>
                    <td className="r">${p.minutes30}</td>
                    <td className="r">${p.avg30 == null ? html`<span className="muted">—</span>` : html`<${Chip} s=${prTone(p.avg30)}>${p.avg30}<//>`}</td>
                    <td className="small">${p.trend == null ? html`<span className="muted">—</span>` : p.trend > 0 ? html`<span style=${{ color: 'var(--teal-ink)' }}>▲ ${p.trend}</span>` : p.trend < 0 ? html`<span style=${{ color: 'var(--red-ink)' }}>▼ ${-p.trend}</span>` : 'steady'}</td>
                    <td className="small">${p.weak ? PR_DIM_NAMES[p.weak] : html`<span className="muted">—</span>`}</td>
                    <td className="small">${p.last ? fmtDay(p.last) : html`<span className="muted">Not started</span>`}</td>
                  </tr>`
                )}</tbody>
              </table></div>
              <p className="muted small" style=${{ margin: 0 }}>Calls, drills, minutes and scores cover the last 30 days. Trend compares the last five calls with the five before. ${Object.entries(PR_DIM_HELP).map(([k, v]) => PR_DIM_NAMES[k] + ': ' + v.toLowerCase()).join('; ')}.</p>`}
        </section>`}
      ${tab === 'weeks' &&
      html`<section className="panel">
          <h2 className="ph">The last eight weeks</h2>
          <div className="prweeks" role="img" aria-label="Practice sessions per week">
            ${d.weeks.map(
              w => html`<div key=${w.from} className="prweek" title=${w.calls + ' calls, ' + w.drills + ' drills, ' + w.min + ' minutes, ' + w.people + ' people' + (w.avg != null ? ', average call score ' + w.avg : '')}>
                <span className="small"><b>${w.calls + w.drills}</b></span>
                <div className="prweek-bar"><i style=${{ height: Math.round((100 * w.calls) / maxW) + '%' }} /><i className="dr" style=${{ height: Math.round((100 * w.drills) / maxW) + '%' }} /></div>
                <span className="small muted">${fmtDate(w.from, { month: 'short', day: 'numeric' })}</span>
                <span className="small">${w.avg != null ? html`<${Chip} s=${prTone(w.avg)}>${w.avg}<//>` : html`<span className="muted">—</span>`}</span>
              </div>`
            )}
          </div>
          <p className="muted small"><span className="prkey" /> Calls <span className="prkey dr" /> Drills · the chip is the week’s average call score.</p>
          <div className="tblwrap"><table className="tbl">
            <thead><tr><th>Week of</th><th className="r">People</th><th className="r">Calls</th><th className="r">Drills</th><th className="r">Minutes</th><th className="r">Avg call score</th></tr></thead>
            <tbody>${[...d.weeks].reverse().map(w => html`<tr key=${w.from}><td>${fmtDate(w.from, { month: 'short', day: 'numeric', year: 'numeric' })}</td><td className="r">${w.people}</td><td className="r">${w.calls}</td><td className="r">${w.drills}</td><td className="r">${w.min}</td><td className="r">${w.avg == null ? '—' : w.avg}</td></tr>`)}</tbody>
          </table></div>
        </section>`}
      ${tab === 'settings' && d.canEdit && html`<${PrSettingsForm} d=${d} onSaved=${() => (toast('Saved.'), load())} />`}
      ${open && html`<${PrPersonModal} person=${open} onClose=${() => setOpen(null)} />`}
      ${remind &&
      html`<${PrRemindModal}
        uids=${remind}
        people=${ppl}
        onClose=${() => setRemind(null)}
        onSent=${r => (setRemind(null), setSel({}), toast(r.sent + ' reminder' + (r.sent === 1 ? '' : 's') + ' sent' + (r.skipped ? '; ' + r.skipped + ' skipped (reminded in the last day, or not active)' : '') + '.'))}
      />`}
    </div>`;
}
function PrPersonModal({ person, onClose }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [s, setS] = useState(null);
  useEffect(() => {
    api('pr_person', { uid: person.uid }).then(setD, e => (toast(errText(e), true), onClose()));
  }, []);
  const openS = id => api('pr_get', { id }).then(r => setS(r.session), e => toast(errText(e), true));
  return html`<${Modal} title=${person.n + ': practice'} onClose=${onClose} wide>
      ${!d
        ? html`<${Spinner} />`
        : s
          ? html`<div className="stack">
              <div><button type="button" className="btn link sm" onClick=${() => setS(null)}><${Icon} n="left" />All of ${firstName(person.n)}’s practice</button></div>
              ${s.kind === 'call' ? html`<${PrReport} s=${s} staff />` : html`<${PrDrillView} s=${s} />`}
            </div>`
          : html`<div className="stack">
              <${KitStats} items=${[
                { v: d.stats.calls30, l: 'Calls (30 days)' },
                { v: d.stats.drills30, l: 'Drills (30 days)' },
                { v: d.stats.minutes30, l: 'Minutes (30 days)' },
                { v: d.stats.avg30 == null ? '—' : d.stats.avg30, l: 'Average call score', tone: d.stats.avg30 == null ? '' : d.stats.avg30 >= 75 ? 'ok' : d.stats.avg30 < 55 ? 'warn' : '' },
              ]} />
              <${PrDims} scores=${d.stats.dims} />
              ${d.sessions.length === 0
                ? html`<${Empty} title="No practice yet">${firstName(person.n)} has not tried a practice call or drill.<//>`
                : html`<div className="tblwrap"><table className="tbl">
                    <thead><tr><th>When</th><th>Practice</th><th className="r">Score</th><th className="r">Answers</th><th className="r">Time</th></tr></thead>
                    <tbody>${d.sessions.map(
                      x => html`<tr key=${x.id} className="click" onClick=${() => openS(x.id)}>
                        <td className="small">${fmtTs(x.at)}</td>
                        <td><b>${x.title}</b>${x.kind === 'call' && html`<span className="muted small"> · ${(PR_LEVELS.find(l => l[0] === x.lvl) || [])[1] || ''}${x.ai ? ' · AI' : ''}</span>`}</td>
                        <td className="r"><${Chip} s=${prTone(x.score)}>${x.score}<//></td>
                        <td className="r">${x.turns}</td>
                        <td className="r small">${prDur(x.dur)}</td>
                      </tr>`
                    )}</tbody>
                  </table></div>`}
            </div>`}
    <//>`;
}
function PrRemindModal({ uids, people, onClose, onSent }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const names = people.filter(p => uids.includes(p.uid)).map(p => p.n);
  const send = async () => {
    setBusy(true);
    try {
      onSent(await api('pr_remind', { uids, note }));
    } catch (e) {
      toast(errText(e), true);
      setBusy(false);
    }
  };
  return html`<${Modal} title="Send a practice reminder" onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Cancel</button><button type="button" className="btn" disabled=${busy} onClick=${send}><${Icon} n="send" />${busy ? 'Sending…' : 'Send ' + uids.length + ' email' + (uids.length === 1 ? '' : 's')}</button>`}>
      <p className="small">To: ${names.slice(0, 8).join(', ')}${names.length > 8 ? ' and ' + (names.length - 8) + ' more' : ''}.</p>
      <p className="muted small">Each person gets an email with their own numbers (calls in the last 30 days, this week against the goal) and a link to start a practice call. Someone reminded in the last day is skipped.</p>
      <div className="form"><${Field} label="Your note (optional)"><textarea rows="3" maxLength="400" value=${note} onChange=${e => setNote(e.target.value)} placeholder="For example: the vendor calls next week are for a Java role, try the technical screen."></textarea><//></div>
    <//>`;
}
function PrSettingsForm({ d, onSaved }) {
  const toast = useToast();
  const [goal, setGoal] = useState(d.goal);
  const [extra, setExtra] = useState(() => Object.fromEntries(d.scenarios.map(s => [s.k, (d.extra[s.k] || []).map(x => ({ ...x }))])));
  const [busy, setBusy] = useState(false);
  const setRow = (k, i, f, v) => setExtra(x => ({ ...x, [k]: x[k].map((r, j) => (j === i ? { ...r, [f]: v } : r)) }));
  const save = async () => {
    setBusy(true);
    try {
      await api('pr_settings_save', { goal: +goal || 0, extra: Object.fromEntries(Object.entries(extra).map(([k, rows]) => [k, rows.filter(r => r.q.trim())])) });
      onSaved();
    } catch (e) {
      toast(errText(e), true);
    } finally {
      setBusy(false);
    }
  };
  return html`<section className="panel stack" style=${{ gap: 14 }}>
      <div className="form">
        <${Field} label="Weekly goal: practice calls per person" hint="Shown to consultants on their Practice calls page and used for “Below the weekly goal”. 0 means no goal."><input type="number" min="0" max="20" value=${goal} onChange=${e => setGoal(e.target.value)} style=${{ maxWidth: 120 }} /><//>
      </div>
      <div>
        <h2 className="ph">Your own questions</h2>
        <p className="muted small">Add up to five questions to a call; the caller asks them before the closing questions. The key words are what a good answer mentions (comma-separated); the feedback lists the ones that were missing.${d.ai ? ' The StratEdge AI words them naturally.' : ''}</p>
      </div>
      ${d.scenarios.map(
        s => html`<div key=${s.k} className="prextra">
          <div className="ph-row" style=${{ margin: 0 }}><b>${s.t}</b><button type="button" className="btn ghost sm" disabled=${extra[s.k].length >= 5} onClick=${() => setExtra(x => ({ ...x, [s.k]: [...x[s.k], { q: '', pts: '' }] }))}><${Icon} n="plus" />Add a question</button></div>
          ${extra[s.k].map(
            (r, i) => html`<div key=${i} className="row3" style=${{ alignItems: 'end' }}>
              <${Field} label="Question"><input value=${r.q} maxLength="300" onChange=${e => setRow(s.k, i, 'q', e.target.value)} placeholder="Why are you looking for a change now?" /><//>
              <${Field} label="Key words"><input value=${r.pts} maxLength="300" onChange=${e => setRow(s.k, i, 'pts', e.target.value)} placeholder="growth, project ending, new skills" /><//>
              <div className="actions" style=${{ paddingBottom: 12 }}><button type="button" className="btn ghost sm" onClick=${() => setExtra(x => ({ ...x, [s.k]: x[s.k].filter((_, j) => j !== i) }))}><${Icon} n="trash" />Remove</button></div>
            </div>`
          )}
        </div>`
      )}
      <div className="actions"><button type="button" className="btn" disabled=${busy} onClick=${save}><${Icon} n="check" />${busy ? 'Saving…' : 'Save the settings'}</button></div>
    </section>`;
}
