/* ================= v40 Tax center: My taxes =================
   Everyone's own page, in every portal (members and staff): how much comes back (or is owed) for 2025 and 2026,
   federal and state, worked out in this browser by taxcalc.js from
     - the pay recorded in this portal (paystubs of the year; for the year in progress, projected to December 31 from
       the last paystubs and the company's pay schedule, so the figure moves every payday), and
     - the person's own answers (filing status, family, other income, deductions, credits, payments).
   The 2025 return is filled in on the IRS's own forms (taxforms.js); 2026 gets withholding and estimated payment
   advice; a refund tracker follows the return once it is filed. Answers are saved sealed for the person only
   (api/tax.php: administrators cannot open them); social security numbers, bank details and the address for the
   forms are typed here just before the PDF is made and are never sent anywhere. Loaded on demand as js/tax.js. */
const TX_YEARS = [2025, 2026];
const TX_STATUS = [
  ['single', 'Single'],
  ['mfj', 'Married filing jointly'],
  ['mfs', 'Married filing separately'],
  ['hoh', 'Head of household'],
  ['qss', 'Qualifying surviving spouse'],
];
const TX_STATUS_N = Object.fromEntries(TX_STATUS);
const TX_VISA = [
  ['', 'US citizen or green card holder'],
  ['WORK', 'H-1B, L-1, TN, E-3, O-1, or a work permit (EAD)'],
  ['F1', 'F-1 student (including CPT and OPT)'],
  ['J1', 'J-1 exchange visitor'],
];
// the work authorization on the person's record (rules.php AUTH_KINDS) as the residency question's answer
const txVisaOf = auth => (/OPT|CPT/.test(auth || '') ? 'F1' : !auth || /^(USC|GC)$/.test(auth) ? '' : 'WORK');
const txUsd = n => (n < -0.5 ? '−' : '') + '$' + Math.round(Math.abs(+n || 0)).toLocaleString('en-US');
const txPct = n => (Math.round((+n || 0) * 1000) / 10).toLocaleString('en-US') + '%';
const txLong = dk => fmtDate(dk, { month: 'long', day: 'numeric', year: 'numeric' });
const txGet = (o, path) => String(path).split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
/* A copy of o with path set to v (undefined removes it); objects and arrays on the way are copied, not changed. */
function txSet(o, path, v) {
  const ks = String(path).split('.');
  const out = Array.isArray(o) ? [...o] : { ...(o || {}) };
  let cur = out;
  for (let i = 0; i < ks.length - 1; i++) {
    const nxt = cur[ks[i]];
    cur[ks[i]] = Array.isArray(nxt) ? [...nxt] : nxt && typeof nxt === 'object' ? { ...nxt } : /^\d+$/.test(ks[i + 1]) ? [] : {};
    cur = cur[ks[i]];
  }
  const last = ks[ks.length - 1];
  if (v === undefined && !Array.isArray(cur)) delete cur[last];
  else cur[last] = v;
  return out;
}

/* The year's tax tables (assets/tax/<year>.json, compiled from _source/tax/research with their sources). */
const txDataP = {};
function txData(year) {
  if (!txDataP[year])
    txDataP[year] = fetch('assets/tax/' + year + '.json?v=' + (typeof APP_BUILD === 'string' ? APP_BUILD : '1'))
      .then(r => {
        if (!r.ok) throw { message: 'The ' + year + ' tax tables did not load (' + r.status + '). Reload the page to try again.' };
        return r.json();
      })
      .catch(e => {
        delete txDataP[year];
        throw e;
      });
  return txDataP[year];
}

/* The year in progress: what the paystubs so far add up to by December 31. Each box grows by the average of the last
   three paystubs for every payday left on the company's pay schedule (W-2 pay is counted by the day it is paid). A
   paystub older than two pay periods means pay has stopped, so nothing is added. */
function txProject(D, facts, prof) {
  const out = { ...(facts || {}), proj: null };
  if (!facts) return out;
  const year = D.year;
  const today = dkey();
  const end = year + '-12-31';
  if (prof.project === false || +today.slice(0, 4) !== year) return out;
  let sch;
  try {
    sch = paySched(facts.sched || {});
  } catch (e) {
    return out;
  }
  const gap = 365 / (sch.ppy || 12);
  const left = last => {
    if (!last) return [];
    if (daysBetween(last, today) > 2 * gap + 10) return null;
    try {
      return payCalendar(sch, 60, last)
        .map(c => c.payDate)
        .filter(d => d > last && d <= end);
    } catch (e) {
      return [];
    }
  };
  const avg = (rows, k) => {
    const r = rows.slice(-3);
    return r.length ? r.reduce((a, x) => a + (+x[k] || 0), 0) / r.length : 0;
  };
  const proj = {};
  if (facts.w2 && Array.isArray(facts.stubs) && facts.stubs.length) {
    const days = left(facts.w2.last);
    if (days === null) proj.w2Stale = facts.w2.last;
    else if (days.length) {
      const w2 = { ...facts.w2 };
      const per = {};
      for (const k of ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b10', 'b12d', 'b12aa', 'b12w', 'b16', 'b17', 'b19']) {
        per[k] = avg(facts.stubs, k);
        w2[k] = Math.round(((+facts.w2[k] || 0) + per[k] * days.length) * 100) / 100;
      }
      const base = D.fed.ss.wageBase;
      if (w2.b3 > base) {
        w2.b3 = base;
        w2.b4 = Math.min(w2.b4, Math.round(base * D.fed.ss.employeeRate * 100) / 100);
      }
      out.w2 = w2;
      proj.w2 = { n: days.length, next: days[0], per };
    }
  }
  if (Array.isArray(facts.necStubs) && facts.necStubs.length && Array.isArray(facts.nec) && facts.nec.length) {
    const lastN = facts.necStubs[facts.necStubs.length - 1].d;
    const days = left(lastN);
    if (days === null) proj.necStale = lastN;
    else if (days.length) {
      const per = avg(facts.necStubs, 'amt');
      out.nec = facts.nec.map((x, i) => (i === 0 ? { ...x, total: Math.round((+x.total + per * days.length) * 100) / 100 } : x));
      proj.nec = { n: days.length, next: days[0], per };
    }
  }
  out.proj = Object.keys(proj).length ? proj : null;
  return out;
}
/* The answers as the engine reads them: a W-2 typed in with blank social security or Medicare wages uses box 1. */
const txForEngine = prof => ({
  ...prof,
  w2: (prof.w2 || []).map(w => ({ ...w, b3: w.b3 == null || w.b3 === '' ? w.b1 : w.b3, b5: w.b5 == null || w.b5 === '' ? w.b1 : w.b5 })),
});
/* Where a new year's answers start: what the portal already knows (year of birth, state, work authorization). */
function txStart(srv, D) {
  const a = (srv && srv.about) || {};
  const f = (srv && srv.facts) || {};
  const st = a.state || (f.w2 && f.w2.st) || '';
  return { v: 1, status: 'single', state: D.states[st] ? st : '', you: a.born ? { born: a.born } : {}, visa: txVisaOf(a.auth), deps: [], w2: [], nec: [], k1: [], done: {} };
}
const txFirstYear = () => {
  const m = /[?&]y=(\d{4})/.exec(location.hash);
  if (m && TX_YEARS.includes(+m[1])) return +m[1];
  const t = dkey();
  const cy = +t.slice(0, 4);
  // January to April 15 is the season for last year's return; after that the year in progress
  if (TX_YEARS.includes(cy - 1) && t <= cy + '-04-15') return cy - 1;
  return TX_YEARS.includes(cy) ? cy : TX_YEARS[TX_YEARS.length - 1];
};

/* "How we figured it", line by line (the page and the summary PDF). Line numbers are the 2025 forms'. */
function txFedRows(est) {
  const F = est.fed;
  const L = F.L;
  const y25 = est.year === 2025;
  const rows = [];
  const add = (l, v, o) => rows.push({ l, v, ...(o || {}) });
  const ln = s => (y25 ? s : '');
  const proj = est.facts && est.facts.proj;
  if (L['1a'])
    add('Wages (W-2 box 1)', L['1a'], {
      ln: ln('1a'),
      sub: F.w2s.map(w => (w.emp || 'Employer') + (w.who === 'sp' ? ' (spouse)' : '') + (w.portal && proj && proj.w2 ? ' (projected to Dec 31)' : '')).join(', '),
    });
  if (L['2b']) add('Taxable interest', L['2b'], { ln: ln('2b') });
  if (L['3b']) add('Dividends', L['3b'], { ln: ln('3b'), sub: L['3a'] ? txUsd(L['3a']) + ' of them qualified (taxed at 0%, 15% or 20%)' : '' });
  if (L['4b']) add('IRA distributions (taxable part)', L['4b'], { ln: ln('4b') });
  if (L['5b']) add('Pensions and annuities (taxable part)', L['5b'], { ln: ln('5b') });
  if (L['6a']) add('Social security (taxable part)', L['6b'], { ln: ln('6b'), sub: 'of ' + txUsd(L['6a']) + ' received' });
  if (L['7a']) add('Capital gain or (loss)', L['7a'], { ln: ln('7a') });
  if (L['8']) {
    const S1 = F.S1;
    const parts = [
      [S1['3'], 'business profit'],
      [S1['5'], 'S corporation, partnership or rental'],
      [S1['7'], 'unemployment'],
      [S1['1'], 'state tax refund'],
      [S1['9'], 'other'],
    ].filter(p => p[0]);
    add('Additional income (Schedule 1)', L['8'], { ln: ln('8'), sub: parts.map(p => p[1] + ' ' + txUsd(p[0])).join(', ') });
  }
  add('Total income', L['9'], { ln: ln('9'), strong: true });
  if (L['10']) {
    const S1 = F.S1;
    const parts = [
      [S1['15'], 'half of self-employment tax'],
      [S1['20'], 'IRA'],
      [S1['13'], 'HSA'],
      [S1['21'], 'student loan interest'],
      [S1['17'], 'self-employed health insurance'],
      [S1['16'], 'SEP / solo 401(k)'],
      [S1['11'], 'educator expenses'],
      [S1['18'], 'early withdrawal penalty'],
      [S1['19a'], 'alimony'],
      [S1['25'], 'other'],
    ].filter(p => p[0]);
    add('Adjustments to income', -L['10'], { ln: ln('10'), op: '−', sub: parts.map(p => p[1] + ' ' + txUsd(p[0])).join(', ') });
  }
  add('Adjusted gross income (AGI)', L['11'], { ln: ln('11'), strong: true });
  add(L.itemized ? 'Itemized deductions (Schedule A)' : 'Standard deduction', -L['12e'], { ln: ln('12e'), op: '−', sub: L.itemized ? 'larger than the standard deduction of ' + txUsd(L.std) : '' });
  if (L['12f']) add('Cash gifts to charity (with the standard deduction)', -L['12f'], { op: '−' });
  if (L.qbi) add('Qualified business income deduction', -L.qbi, { ln: ln('13a'), op: '−', sub: '20% of business profit (Form 8995)' });
  if (L.s1a) {
    const A = F.S1A;
    const parts = [
      [A['13'], 'tips'],
      [A['21'], 'overtime'],
      [A['30'], 'car loan interest'],
      [A['37'], 'seniors'],
    ].filter(p => p[0]);
    add('New deductions (Schedule 1-A)', -L.s1a, { ln: ln('13b'), op: '−', sub: parts.map(p => p[1] + ' ' + txUsd(p[0])).join(', ') });
  }
  add('Taxable income', L['15'], { ln: ln('15'), strong: true });
  const q = L.qdcg || {};
  add('Income tax', L['16'], { ln: ln('16'), sub: 'top rate ' + txPct(F.marg) + (q.pref ? '; ' + txUsd(q.pref) + ' of dividends and gains at 0%, 15% or 20%' : '') });
  if (L['19']) add('Child tax credit and credit for other dependents', -L['19'], { ln: ln('19'), op: '−', sub: [F.ctcKids ? F.ctcKids + ' child' + (F.ctcKids === 1 ? '' : 'ren') : '', F.odcN ? F.odcN + ' other dependent' + (F.odcN === 1 ? '' : 's') : ''].filter(Boolean).join(', ') });
  if (L['20']) {
    const S3 = F.S3;
    const parts = [
      [S3['1'], 'foreign tax'],
      [S3['2'], 'child and dependent care'],
      [S3['3'], 'education'],
      [S3['4'], "saver's"],
      [S3['6z'], 'other'],
    ].filter(p => p[0]);
    add('Other credits', -L['20'], { ln: ln('20'), op: '−', sub: parts.map(p => p[1] + ' ' + txUsd(p[0])).join(', ') });
  }
  if (L['23']) {
    const S2 = F.S2;
    const parts = [
      [S2['4'], 'self-employment tax'],
      [S2['11'], 'additional Medicare tax'],
      [S2['12'], 'net investment income tax'],
      [S2['8'], '10% early withdrawal tax'],
    ].filter(p => p[0]);
    add('Other taxes (Schedule 2)', L['23'], { ln: ln('23'), op: '+', sub: parts.map(p => p[1] + ' ' + txUsd(p[0])).join(', ') });
  }
  add('Total tax', L['24'], { ln: ln('24'), strong: true, sub: L['9'] > 0 ? txPct(F.eff) + ' of your adjusted gross income' : '' });
  if (L['25d']) add('Federal tax withheld', L['25d'], { ln: ln('25d'), sub: proj && proj.w2 ? 'includes the paydays left this year' : '' });
  if (L['26']) add('Estimated tax payments', L['26'], { ln: ln('26') });
  if (L['27a']) add('Earned income credit', L['27a'], { ln: ln('27a') });
  if (L['28']) add('Additional child tax credit', L['28'], { ln: ln('28') });
  if (L['29']) add('American opportunity credit (refundable part)', L['29'], { ln: ln('29') });
  if (L['31']) add('Extension payment and excess social security tax', L['31'], { ln: ln('31') });
  add('Total payments and refundable credits', L['33'], { ln: ln('33'), strong: true });
  if (F.refund > 0) add('Refund', F.refund, { ln: ln('34'), strong: true, tone: 'ok' });
  else add('Amount you owe', F.owed, { ln: ln('37'), strong: true, tone: F.owed > 0 ? 'bad' : '' });
  return rows;
}
function txStateRows(est) {
  const S = est.state;
  if (!S) return [];
  const rows = [];
  const add = (l, v, o) => rows.push({ l, v, ...(o || {}) });
  const x = S.lines || {};
  if (S.none) {
    add(S.name + ' has no income tax on wages', 0, { strong: true });
    if (S.withheld) add('State tax withheld (comes back in full)', S.withheld);
  } else if (S.full) {
    add('NJ gross income', x.gross, { sub: 'wages from W-2 box 16 (NJ taxes some pay the federal return does not)' });
    if (x.excl) add('Pension exclusion', -x.excl, { op: '−' });
    add('Exemptions', -x.ex, { op: '−' });
    if (x.med) add('Medical expenses over 2% of income', -x.med, { op: '−' });
    if (x.prop) add('Property tax deduction', -x.prop, { op: '−' });
    add('NJ taxable income', x.taxable, { strong: true });
    add('NJ income tax', x.tax + x.coj, {});
    if (x.coj) add('Credit for tax paid to another state', -x.coj, { op: '−' });
    if (x.propCredit) add('Property tax credit', x.propCredit);
    if (x.eitc) add('NJ earned income credit', x.eitc);
    if (x.ctc) add('NJ child tax credit', x.ctc);
    if (x.care) add('NJ child and dependent care credit', x.care);
    if (x.wh) add('NJ tax withheld', x.wh);
    if (x.est) add('Estimated payments', x.est);
  } else {
    add(x.startKind === 'federalTaxable' ? 'Federal taxable income' : x.startKind === 'own' ? 'Income as the state counts it' : 'Federal adjusted gross income', x.start);
    if (x.std) add('Standard deduction', -x.std, { op: '−' });
    if (x.ex) add('Exemptions', -x.ex, { op: '−' });
    add('Taxable income (approximate)', x.taxable, { strong: true });
    add('State income tax', S.tax + S.credits, {});
    if (S.credits) add('Credits', -S.credits, { op: '−' });
    if (S.local) add('Local income tax', S.local, { op: '+' });
    if (S.withheld) add('State and local tax withheld', S.withheld);
    if (S.est) add('Estimated payments', S.est);
  }
  if (S.refund > 0) add('Refund', S.refund, { strong: true, tone: 'ok' });
  else if (!S.none) add('Amount you owe', S.owed, { strong: true, tone: S.owed > 0 ? 'bad' : '' });
  return rows;
}
/* Every note behind the figures, warnings first. */
const txNotes = est => [...est.fed.warn.map(t => ({ t, w: true })), ...est.fed.notes.map(t => ({ t })), ...((est.state && est.state.notes) || []).map(t => ({ t: (est.state.code || '') + ': ' + t }))];

/* A one-page-or-more summary for the person or their tax preparer (no social security numbers in it). */
async function txSummaryPdf(est, prof, about, D) {
  const lib = await loadPdfLib();
  const doc = await lib.PDFDocument.create();
  const font = await doc.embedFont(lib.StandardFonts.Helvetica);
  const bold = await doc.embedFont(lib.StandardFonts.HelveticaBold);
  const W = 612;
  const H = 792;
  const M = 50;
  let page = doc.addPage([W, H]);
  let y = H - M;
  const clean = s => ascii(String(s == null ? '' : s).replace(/−/g, '-'));
  const wrap = (s, f, size, width) => {
    const out = [];
    let line = '';
    for (const w of clean(s).split(/\s+/)) {
      const t = line ? line + ' ' + w : w;
      if (f.widthOfTextAtSize(t, size) > width && line) {
        out.push(line);
        line = w;
      } else line = t;
    }
    if (line) out.push(line);
    return out;
  };
  const need = h => {
    if (y - h < M) {
      page = doc.addPage([W, H]);
      y = H - M;
    }
  };
  const text = (s, o) => {
    o = o || {};
    const f = o.bold ? bold : font;
    const size = o.size || 10;
    for (const l of wrap(s, f, size, o.width || W - 2 * M)) {
      need(size + 4);
      page.drawText(l, { x: o.x || M, y: y - size, size, font: f, color: o.grey ? lib.rgb(0.35, 0.38, 0.45) : lib.rgb(0.06, 0.1, 0.2) });
      y -= size + 4;
    }
  };
  const table = rows => {
    for (const r of rows) {
      const size = 10;
      const f = r.strong ? bold : font;
      const label = (r.ln ? 'Line ' + r.ln + '  ' : '') + r.l;
      const lines = wrap(label, f, size, W - 2 * M - 110);
      need((size + 4) * lines.length + (r.sub ? 12 : 0) + 2);
      lines.forEach((l, i) => page.drawText(l, { x: M, y: y - size - i * (size + 4), size, font: f, color: lib.rgb(0.06, 0.1, 0.2) }));
      const amt = clean(txUsd(r.v));
      page.drawText(amt, { x: W - M - f.widthOfTextAtSize(amt, size), y: y - size, size, font: f, color: lib.rgb(0.06, 0.1, 0.2) });
      y -= (size + 4) * lines.length;
      if (r.sub) text(r.sub, { size: 8, grey: true, x: M + 10, width: W - 2 * M - 120 });
      if (r.strong) {
        page.drawLine({ start: { x: M, y: y + 1 }, end: { x: W - M, y: y + 1 }, thickness: 0.4, color: lib.rgb(0.75, 0.78, 0.84) });
        y -= 3;
      }
    }
  };
  const F = est.fed;
  text(est.year + ' tax estimate' + (about && about.name ? ' for ' + about.name : ''), { bold: true, size: 16 });
  text('Made ' + new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) + ' in the ' + wsName() + ' portal. An estimate from paystubs and answers, not a filed return.', { size: 9, grey: true });
  y -= 6;
  text('Filing status: ' + (TX_STATUS_N[F.st] || F.st) + (F.nra ? ' (nonresident alien: Form 1040-NR)' : '') + (prof.state && D.states[prof.state] ? '   State: ' + D.states[prof.state].n : ''), { size: 10 });
  const deps = (prof.deps || []).filter(d => d && (d.n || d.born));
  if (deps.length) text('Dependents: ' + deps.map(d => (d.n || 'Dependent') + (d.born ? ' (born ' + d.born + ')' : '')).join(', '), { size: 10 });
  y -= 8;
  text('Federal' + (F.nra ? ' (Form 1040-NR)' : ' (Form 1040)'), { bold: true, size: 12 });
  table(txFedRows(est));
  if (est.state) {
    y -= 10;
    text(est.state.name + (est.state.approx ? ' (approximate)' : ''), { bold: true, size: 12 });
    table(txStateRows(est));
  }
  const notes = txNotes(est);
  if (notes.length) {
    y -= 10;
    text('Notes', { bold: true, size: 12 });
    for (const n of notes) text('- ' + n.t, { size: 9 });
  }
  y -= 10;
  text('This is an estimate under the ' + est.year + ' federal and state rules as entered, not tax advice. Check every figure against your W-2s, 1099s and other records before filing, or have a tax professional review it.', { size: 8, grey: true });
  return doc.save();
}

/* ---------------------------------------------------------------- the answers */
/* One answer. Kinds: m money, mn money that can be below zero, y year, n count, p percent, c yes (checkbox),
   cf "has no social security number" (stores false), s list, b yes / no / let the page decide, t text. */
function TxField({ f, v, on }) {
  if (f.t === 'c' || f.t === 'cf') {
    const checked = f.t === 'cf' ? v === false : !!v;
    return html`<label className="check txwide"><input type="checkbox" checked=${checked} onChange=${e => on(e.target.checked ? (f.t === 'cf' ? false : true) : undefined)} /><span>${f.l}${f.h ? html` <small className="muted">${f.h}</small>` : null}</span></label>`;
  }
  let input;
  if (f.t === 's')
    input = html`<select value=${v == null ? '' : String(v)} onChange=${e => on(e.target.value === '' ? undefined : e.target.value)}>
        ${f.o.map(([val, n]) => html`<option key=${val} value=${val}>${n}</option>`)}
      </select>`;
  else if (f.t === 'b')
    input = html`<select value=${v === true ? 'y' : v === false ? 'n' : ''} onChange=${e => on(e.target.value === 'y' ? true : e.target.value === 'n' ? false : undefined)}>
        <option value="">${f.auto || 'Work it out for me'}</option>
        <option value="y">Yes</option>
        <option value="n">No</option>
      </select>`;
  else if (f.t === 't') input = html`<input value=${v || ''} maxLength=${f.max || 80} placeholder=${f.ph || ''} onInput=${e => on(e.target.value || undefined)} />`;
  else
    input = html`<input type="number" inputMode=${f.t === 'y' || f.t === 'n' ? 'numeric' : 'decimal'} step=${f.t === 'p' ? '0.01' : '1'} min=${f.t === 'mn' ? undefined : '0'} max=${f.t === 'n' && f.max ? String(f.max) : undefined} value=${v == null ? '' : v} placeholder=${f.ph || (f.t === 'm' || f.t === 'mn' ? '0' : '')} onInput=${e => on(e.target.value === '' ? undefined : +e.target.value)} />`;
  const fld = html`<${Field} label=${f.l} hint=${f.h}>${f.t === 'm' || f.t === 'mn' ? html`<span className="txmoney">${input}</span>` : input}<//>`;
  return f.w ? html`<div className="txw2">${fld}</div>` : fld;
}
const txF = (k, l, t, o) => ({ k, l, t: t || 'm', ...(o || {}) });
function TxGrid({ fields, obj, on, ctx }) {
  return html`<div className="txgrid">
      ${fields.filter(f => !f.when || f.when(obj, ctx)).map(f => html`<${TxField} key=${f.k} f=${f} v=${txGet(obj, f.k)} on=${v => on(f.k, v)} />`)}
    </div>`;
}
/* A list of W-2s, 1099s, dependents... each with its own answers. */
function TxList({ items, fields, onChange, addLabel, empty, title, ctx, max }) {
  const list = Array.isArray(items) ? items : [];
  return html`<div className="txlist">
      ${
        list.length
          ? list.map(
              (it, i) => html`<div key=${i} className="txitem">
                <div className="txitem-h">
                  <b>${title(it || {}, i)}</b>
                  <button type="button" className="btn ghost sm danger" onClick=${() => onChange(list.filter((x, j) => j !== i))}>Remove</button>
                </div>
                <${TxGrid} fields=${fields} obj=${it || {}} ctx=${ctx} on=${(k, v) => onChange(list.map((x, j) => (j === i ? txSet(x || {}, k, v) : x)))} />
              </div>`
            )
          : empty
            ? html`<p className="muted small" style=${{ margin: 0 }}>${empty}</p>`
            : null
      }
      ${list.length < (max || 12) && html`<div className="actions"><button type="button" className="btn ghost sm" onClick=${() => onChange([...list, {}])}><${Icon} n="plus" />${addLabel}</button></div>`}
    </div>`;
}
function TxSection({ id, title, sum, open, onToggle, done, onDone, children }) {
  return html`<section className=${'panel txsec' + (open ? ' open' : '')} id=${'tx-' + id}>
      <button type="button" className="txsec-h" aria-expanded=${open ? 'true' : 'false'} onClick=${onToggle}>
        <span className=${'txsec-dot' + (done ? ' done' : '')} aria-label=${done ? 'Done' : 'Not done yet'}>${done ? html`<${Icon} n="check" />` : null}</span>
        <span className="txsec-t"><b>${title}</b>${sum ? html`<small>${sum}</small>` : null}</span>
        <${Icon} n="chev" cls=${open ? 'txflip' : ''} />
      </button>
      ${
        open &&
        html`<div className="txsec-b form">
          ${children}
          <div className="actions txsec-f">
            <button type="button" className=${done ? 'btn ghost sm' : 'btn sm'} onClick=${onDone}>${done ? 'Done' : 'This part is done'}</button>
          </div>
        </div>`
      }
    </section>`;
}
const TxSub = ({ title, children, note }) =>
  html`<div className="txsub">
      <h3>${title}</h3>
      ${note ? html`<p className="muted small">${note}</p>` : null}
      ${children}
    </div>`;

/* What payroll in this portal says for the year, with the switches to use it and to project it. */
function TxPortalPay({ facts, raw, prof, up, year, D }) {
  const w2 = raw.w2;
  const p = facts.proj || {};
  const nec = (raw.nec || [])[0];
  const live = +dkey().slice(0, 4) === year;
  if (!w2 && !nec && !(raw.c2c > 0))
    return html`<p className="muted small" style=${{ margin: 0 }}>No ${year} pay is recorded for you in this portal. Add your W-2s and 1099s below.</p>`;
  return html`<div className="txportal stack">
      ${
        w2 &&
        html`<div className="txcard">
          <div className="txcard-h"><b>W-2 from ${w2.employer || 'your employer'}</b><span className="muted small">${w2.runs} paystub${w2.runs === 1 ? '' : 's'}, last paid ${txLong(w2.last)}</span></div>
          <div className="txfacts">
            <span><small>Wages (box 1)</small><b>${txUsd(w2.b1)}</b></span>
            <span><small>Federal tax withheld</small><b>${txUsd(w2.b2)}</b></span>
            ${w2.b17 > 0 && html`<span><small>${w2.st || 'State'} tax withheld</small><b>${txUsd(w2.b17)}</b></span>`}
            ${w2.b12d + w2.b12aa > 0 && html`<span><small>401(k) / 403(b)</small><b>${txUsd(w2.b12d + w2.b12aa)}</b></span>`}
          </div>
          ${
            p.w2 &&
            html`<p className="small txproj"><${Icon} n="chart" />Projected to December 31: ${p.w2.n} more payday${p.w2.n === 1 ? '' : 's'} (next ${txLong(p.w2.next)}) at about ${txUsd(p.w2.per.b1)} each → wages about <b>${txUsd(facts.w2.b1)}</b>, federal tax withheld about <b>${txUsd(facts.w2.b2)}</b>.</p>`
          }
          ${p.w2Stale && html`<p className="small muted">Your last paystub was on ${txLong(p.w2Stale)}, so nothing more is added for the rest of the year.</p>`}
          <div className="txchecks">
            <label className="check"><input type="checkbox" checked=${prof.usePortalW2 !== false} onChange=${e => up('usePortalW2', e.target.checked ? undefined : false)} /><span>Include this W-2</span></label>
            ${live && html`<label className="check"><input type="checkbox" checked=${prof.project !== false} onChange=${e => up('project', e.target.checked ? undefined : false)} /><span>Project my pay to December 31</span></label>`}
          </div>
          ${!live && html`<p className="muted small" style=${{ margin: 0 }}>Your W-2 for ${year} can be downloaded under Earnings › Tax documents. If it differs from these figures, untick "Include this W-2" and add it below as it is printed.</p>`}
        </div>`
      }
      ${
        nec &&
        html`<div className="txcard">
          <div className="txcard-h"><b>1099-NEC payments from ${nec.payer}</b><span className="muted small">${nec.runs} payment${nec.runs === 1 ? '' : 's'}, last ${txLong(nec.last)}</span></div>
          <div className="txfacts"><span><small>Paid to you</small><b>${txUsd(nec.total)}</b></span>${p.nec && html`<span><small>Projected to Dec 31</small><b>${txUsd(facts.nec[0].total)}</b></span>`}</div>
          <p className="muted small" style=${{ margin: 0 }}>No tax is taken out of 1099 pay: the estimate adds self-employment tax (social security and Medicare) and income tax on the profit. Your business expenses go under "Your business" below.</p>
          <div className="txchecks"><label className="check"><input type="checkbox" checked=${prof.usePortalNec !== false} onChange=${e => up('usePortalNec', e.target.checked ? undefined : false)} /><span>Include these payments</span></label></div>
        </div>`
      }
      ${
        raw.c2c > 0 &&
        html`<div className="note info" style=${{ margin: 0 }}>
          <span><b>${txUsd(raw.c2c)} paid to your company (corp-to-corp) in ${year}.</b> That is your company's income, not yet yours. If it is an S corporation, it pays you a salary on a W-2 and gives you a Schedule K-1 for the rest: add both below. If it is a single-member LLC, its income and expenses go on your Schedule C: add it under "Self-employment and 1099 income" with your business expenses.</span>
        </div>`
      }
    </div>`;
}
const txStateOpts = D => [['', 'None, or outside the US'], ...Object.entries(D.states).sort((a, b) => a[1].n.localeCompare(b[1].n)).map(([k, s]) => [k, s.n])];
const txWho = (prof, it) => (it.who === 'sp' && prof.status === 'mfj' ? ' (spouse)' : '');
function TxAnswers({ D, prof, up, upList, est, facts, raw, year, open, setOpen }) {
  const joint = prof.status === 'mfj';
  const married = joint || prof.status === 'mfs';
  const S = D.states[prof.state];
  const fed = est.fed;
  const toggle = id => setOpen({ ...open, [id]: !open[id] });
  const done = id => !!(prof.done && prof.done[id]);
  const markDone = id => () => {
    up('done.' + id, done(id) ? undefined : true);
    if (!done(id)) setOpen({ ...open, [id]: false });
  };
  const sec = (id, title, sum, body) => html`<${TxSection} key=${id} id=${id} title=${title} sum=${sum} open=${!!open[id]} onToggle=${() => toggle(id)} done=${done(id)} onDone=${markDone(id)}>${body}<//>`;
  const who = [txF('who', 'Whose', 's', { o: [['you', 'Yours'], ['sp', "Your spouse's"]], when: () => joint })];
  const deps = (prof.deps || []).filter(d => d && (d.n || d.born));
  const w2n = (prof.w2 || []).length + (raw.w2 && prof.usePortalW2 !== false ? 1 : 0);
  const necAll = [...((raw.nec || []).length && prof.usePortalNec !== false ? [{ who: 'you' }] : []), ...(prof.nec || [])];
  const hasBiz = whom => necAll.some(n => (n.who === 'sp' && joint ? 'sp' : 'you') === whom);
  const est4 = D.estDue || [];
  const lo = S && S.lo && !/^(none|no local)/i.test(S.lo) ? S.lo : '';
  return html`<div className="stack txanswers">
      ${sec(
        'about',
        'You and your filing status',
        [TX_STATUS_N[prof.status] || 'Single', S ? S.n : 'no state', prof.you && prof.you.born ? 'born ' + prof.you.born : '', fed.nra ? 'nonresident' : ''].filter(Boolean).join(' · '),
        html`<${TxGrid}
            obj=${prof}
            on=${up}
            fields=${[
              txF('status', 'Filing status', 's', { o: TX_STATUS, w: 2, h: 'Your status on December 31. Married couples usually pay less filing jointly. Head of household: unmarried, and you paid more than half the cost of a home for a child or relative who lived with you.' }),
              txF('you.born', 'Your year of birth', 'y'),
              txF('state', 'State you lived in', 's', { o: txStateOpts(D), h: 'Where you lived on December 31. Lived in two states during the year? The estimate uses this one; the notes say what changes.' }),
              txF('local', 'Local income tax rate (%)', 'p', { when: () => !!lo, h: lo.slice(0, 220) }),
              txF('you.blind', 'You are legally blind', 'c'),
              txF('you.dep', 'Someone else (a parent, for example) can claim you as a dependent', 'c'),
              txF('you.student', 'You were a full-time student (at least five months of the year)', 'c'),
              txF('you.ssn', "You don't have a social security number valid for work (you use an ITIN)", 'cf'),
            ]}
          />
          ${
            married &&
            html`<${TxSub} title="Your spouse">
              <${TxGrid}
                obj=${prof}
                on=${up}
                fields=${[
                  txF('sp.born', "Your spouse's year of birth", 'y'),
                  txF('sp.blind', 'Your spouse is legally blind', 'c'),
                  txF('sp.student', 'Your spouse was a full-time student', 'c', { when: () => joint }),
                  txF('sp.ssn', "Your spouse doesn't have a social security number valid for work", 'cf'),
                  txF('sp.itemizes', 'Your spouse itemizes deductions on their own return (then you must itemize too)', 'c', { when: () => prof.status === 'mfs' }),
                  txF('spNoIncome', 'Your spouse had no income and nobody else can claim them', 'c', { when: () => prof.status === 'mfs' }),
                  txF('livedApart', 'You lived apart from your spouse all year', 'c', { when: () => prof.status === 'mfs' }),
                ]}
              />
            <//>`
          }
          <${TxSub} title="Visa and tax residency" note="Your visa decides which return you file. Citizens, green card holders and most people on work visas file Form 1040 like everyone else; F-1 and J-1 students are usually nonresidents for their first five calendar years and file Form 1040-NR.">
            <${TxGrid}
              obj=${prof}
              on=${up}
              fields=${[
                txF('visa', 'Your status in the US', 's', { o: TX_VISA, w: 2 }),
                txF('firstYear', 'Year you first came to the US on this visa', 'y', { when: o => !!o.visa }),
                txF('res', 'File as', 's', { o: [['', 'Work it out for me'], ['resident', 'A resident (Form 1040)'], ['nonresident', 'A nonresident (Form 1040-NR)']], when: o => !!o.visa, w: 2 }),
                txF('indiaTreaty', 'You came from India as a student or business apprentice (the treaty allows the standard deduction)', 'c', { when: () => fed.nra }),
              ]}
            />
            ${fed.resi && fed.resi.why ? html`<p className="small txwhy"><${Icon} n="help" />${fed.resi.why}</p>` : null}
            ${fed.nra ? html`<p className="small txwhy"><${Icon} n="help" />As a nonresident you file single or married filing separately, with no standard deduction (except the India treaty) and no child tax credit; social security and Medicare are usually not taken from F-1 and J-1 student pay.</p>` : null}
          <//>`
      )}
      ${sec(
        'family',
        'Family and dependents',
        deps.length ? deps.length + ' dependent' + (deps.length === 1 ? '' : 's') + (prof.cred && prof.cred.careCost ? ' · child care' : '') : 'No dependents',
        html`<${TxSub} title="Dependents" note="Children under 19 (under 24 if a full-time student) who lived with you more than half the year, and relatives you supported. Children under 17 with a social security number get the child tax credit.">
            <${TxList}
              items=${prof.deps}
              onChange=${l => upList('deps', l, 'family')}
              addLabel="Add a dependent"
              empty="No dependents added."
              title=${(d, i) => d.n || 'Dependent ' + (i + 1)}
              fields=${[
                txF('n', 'Name', 't'),
                txF('born', 'Year of birth', 'y'),
                txF('rel', 'Relationship', 's', { o: [['child', 'Child, stepchild, foster child, brother or sister (or their child)'], ['other', 'Parent or another relative I support']], w: 2 }),
                txF('relText', 'As it goes on the form', 't', { ph: 'Son, Daughter, Mother…' }),
                txF('months', 'Months they lived with you', 'n', { ph: '12', max: 12 }),
                txF('student', 'Full-time student', 'c'),
                txF('disabled', 'Permanently and totally disabled', 'c'),
                txF('ssn', "Doesn't have a social security number", 'cf'),
              ]}
            />
          <//>
          <${TxSub} title="Child and dependent care">
            <${TxGrid}
              obj=${prof}
              on=${(k, v) => up(k, v, 'family')}
              fields=${[
                txF('cred.careCost', 'Care you paid for while you worked', 'm', { h: 'Daycare, a sitter, before and after school care, summer day camp, for children under 13 or a dependent who cannot care for themselves. Dependent care paid through payroll (W-2 box 10) is taken off automatically.' }),
                txF('cred.careKids', 'People cared for', 'n', { when: o => +txGet(o, 'cred.careCost') > 0, max: 9 }),
              ]}
            />
          <//>`
      )}
      ${sec(
        'income',
        'Income',
        txUsd(fed.L['9']) + ' total' + (w2n ? ' · ' + w2n + ' W-2' + (w2n === 1 ? '' : 's') : '') + (necAll.length ? ' · self-employment' : ''),
        html`<${TxSub} title="From payroll in this portal"><${TxPortalPay} facts=${facts} raw=${raw} prof=${prof} up=${(k, v) => up(k, v, 'income')} year=${year} D=${D} /><//>
          <${TxSub} title="Other W-2 jobs" note=${joint ? "Yours and your spouse's: every W-2 for the year, from any employer." : 'Every other W-2 for the year (another employer, or a job before this one).'}>
            <${TxList}
              items=${prof.w2}
              onChange=${l => upList('w2', l, 'income')}
              addLabel="Add a W-2"
              title=${(w, i) => (w.emp || 'W-2 ' + (i + 1)) + txWho(prof, w)}
              ctx=${prof}
              fields=${[
                ...who,
                txF('emp', 'Employer', 't'),
                txF('b1', 'Box 1 · Wages'),
                txF('b2', 'Box 2 · Federal tax withheld'),
                txF('b3', 'Box 3 · Social security wages', 'm', { ph: 'Same as box 1' }),
                txF('b4', 'Box 4 · Social security tax'),
                txF('b5', 'Box 5 · Medicare wages', 'm', { ph: 'Same as box 1' }),
                txF('b6', 'Box 6 · Medicare tax'),
                txF('b10', 'Box 10 · Dependent care benefits'),
                txF('b12d', 'Box 12 D, E or G · 401(k), 403(b), 457'),
                txF('b12aa', 'Box 12 AA or BB · Roth 401(k), 403(b)'),
                txF('b12w', 'Box 12 W · HSA'),
                txF('st', 'Box 15 · State', 's', { o: [['', '—'], ...Object.keys(D.states).sort().map(k => [k, k])] }),
                txF('b16', 'Box 16 · State wages'),
                txF('b17', 'Box 17 · State income tax'),
                txF('b19', 'Box 19 · Local income tax'),
              ]}
            />
          <//>
          <${TxSub} title="Self-employment and 1099 income" note="1099-NEC payments, or money you invoiced yourself as a sole proprietor or single-member LLC.">
            <${TxList}
              items=${prof.nec}
              onChange=${l => upList('nec', l, 'income')}
              addLabel="Add a 1099 or other business income"
              title=${(n, i) => (n.payer || 'Payer ' + (i + 1)) + txWho(prof, n)}
              ctx=${prof}
              fields=${[...who, txF('payer', 'Who paid you', 't'), txF('amt', 'Amount (1099-NEC box 1)'), txF('wh', 'Federal tax withheld (box 4)')]}
            />
            ${['you', 'sp'].filter(w => hasBiz(w) && (w === 'you' || joint)).map(
              w => html`<${TxSub} key=${w} title=${w === 'sp' ? "Your spouse's business" : 'Your business'}>
                <${TxGrid}
                  obj=${prof}
                  on=${(k, v) => up(k, v, 'income')}
                  fields=${[
                    txF('biz.' + w + '.exp', 'Business expenses for the year', 'm', { h: 'Software, equipment, a home office used only for work, business mileage, training, phone and internet for work, insurance, accounting fees.' }),
                    txF('biz.' + w + '.what', 'What the business does', 't', { ph: 'Information technology consulting' }),
                    txF('biz.' + w + '.code', 'Business code (Schedule C, line B)', 't', { ph: '541510', max: 6 }),
                    txF('biz.' + w + '.name', 'Business name (if any)', 't'),
                    txF('biz.' + w + '.sstb', 'Mostly advice-giving consulting, law, health, accounting or financial services (a "specified service" business)', 'c', { h: 'Only matters at higher incomes, for the 20% business deduction. Writing software or doing the technical work for a client usually is not.' }),
                  ]}
                />
              <//>`
            )}
          <//>
          <${TxSub} title="S corporation or partnership (Schedule K-1)" note="Your share of the profit of your own S corporation (corp-to-corp) or a partnership. Its salary to you is a W-2 above.">
            <${TxList}
              items=${prof.k1}
              onChange=${l => upList('k1', l, 'income')}
              addLabel="Add a K-1"
              title=${(k, i) => (k.n || 'K-1 ' + (i + 1)) + txWho(prof, k)}
              ctx=${prof}
              fields=${[...who, txF('n', 'Company', 't'), txF('ord', 'Box 1 · Ordinary business income (loss)', 'mn'), txF('w2wages', 'W-2 wages the company paid (everyone, including you)'), txF('sstb', 'A "specified service" business', 'c')]}
            />
          <//>
          <${TxSub} title="Interest, dividends and investments">
            <${TxGrid}
              obj=${prof}
              on=${(k, v) => up(k, v, 'income')}
              fields=${[
                txF('int', 'Taxable interest (1099-INT box 1)'),
                txF('taxExemptInt', 'Tax-exempt interest (box 8)'),
                txF('divOrd', 'Ordinary dividends (1099-DIV box 1a)'),
                txF('divQual', 'Qualified dividends (box 1b)'),
                txF('capDist', 'Capital gain distributions (box 2a)'),
                txF('capST', 'Short-term gain or (loss): held a year or less', 'mn', { h: 'From your 1099-B: sale price minus what you paid.' }),
                txF('capLT', 'Long-term gain or (loss): held more than a year', 'mn'),
              ]}
            />
          <//>
          <${TxSub} title="Retirement, social security and unemployment">
            <${TxGrid}
              obj=${prof}
              on=${(k, v) => up(k, v, 'income')}
              fields=${[
                txF('ira.dist', 'IRA distributions (1099-R box 1)'),
                txF('ira.taxable', 'Taxable part (box 2a)'),
                txF('ira.early', 'Taken before age 59½ with no exception', 'm', { h: 'Adds the 10% early withdrawal tax.' }),
                txF('pens.gross', 'Pensions and annuities (1099-R box 1)'),
                txF('pens.taxable', 'Taxable part (box 2a)'),
                txF('ss', 'Social security benefits (SSA-1099 box 5)'),
                txF('unemp', 'Unemployment compensation (1099-G)'),
              ]}
            />
          <//>
          <${TxSub} title="Tips, overtime and car loan interest" note="For 2025 through 2028 these come off your income (Schedule 1-A), within limits that shrink at higher incomes. Tips and overtime need a social security number valid for work and are not available married filing separately; car loan interest needs the car's VIN.">
            <${TxGrid}
              obj=${prof}
              on=${(k, v) => up(k, v, 'income')}
              fields=${[
                txF('tips', 'Qualified tips', 'm', { h: 'Cash and card tips in a job where people usually tip (included in your wages).' }),
                txF('otPrem', 'Overtime premium', 'm', { h: 'Only the extra "half" of time-and-a-half pay that federal law requires, not the whole overtime pay.' }),
                txF('carInt', 'Interest on a car loan', 'm', { h: 'A new car, SUV, van, pickup or motorcycle for personal use, assembled in the US, bought after 2024.' }),
              ]}
            />
          <//>
          <${TxSub} title="Other income">
            <${TxGrid}
              obj=${prof}
              on=${(k, v) => up(k, v, 'income')}
              fields=${[
                txF('stateRefund', 'State or local tax refund received this year', 'm', { h: 'Only if you itemized deductions on last year’s federal return.' }),
                txF('passive', 'Rental income, after expenses', 'mn', { h: 'Net rent from Schedule E. Rental losses are limited, so a loss is not subtracted here.' }),
                txF('otherInc', 'Other taxable income', 'mn', { h: 'Prizes, jury duty pay, gambling winnings and similar.' }),
                txF('otherIncDesc', 'What it was', 't', { when: o => !!o.otherInc }),
              ]}
            />
          <//>`
      )}
      ${sec(
        'ded',
        'Deductions and adjustments',
        (fed.L.itemized ? 'Itemized ' : 'Standard deduction ') + txUsd(fed.L['12e']) + (fed.L['10'] ? ' · adjustments ' + txUsd(fed.L['10']) : ''),
        html`<${TxGrid}
            obj=${prof}
            on=${(k, v) => up(k, v, 'ded')}
            fields=${[txF('ded.mode', 'Deduction', 's', { o: [['', 'Whichever is larger (recommended)'], ['standard', 'The standard deduction'], ['itemized', 'Itemize (Schedule A)']], w: 2 })]}
          />
          <p className="small txwhy"><${Icon} n="help" />Your standard deduction is ${txUsd(fed.L.std)}; what you could itemize comes to ${txUsd(fed.SA['17'] || 0)}${fed.SA['5d'] > fed.SA['5e'] ? ' (state and local taxes are capped at ' + txUsd(fed.SA['5e']) + ')' : ''}. ${fed.L.itemized ? 'Itemizing is larger.' : 'The standard deduction is larger.'}</p>
          <${TxSub} title="What you could itemize" note="State income tax withheld on your W-2s and your state estimated payments are counted already.">
            <${TxGrid}
              obj=${prof}
              on=${(k, v) => up(k, v, 'ded')}
              fields=${[
                txF('ded.mortgage', 'Mortgage interest (Form 1098)'),
                txF('ded.propTax', 'Property tax on your home'),
                txF('ded.persProp', 'Car registration fee based on value'),
                txF('ded.charityCash', 'Gifts to charity by cash, check or card'),
                txF('ded.charityOther', 'Gifts of clothing, goods or stock'),
                txF('ded.medical', 'Medical and dental costs you paid', 'm', { h: 'Only the part over 7.5% of your income counts.' }),
                txF('ded.priorStateBal', "State tax you paid this year for last year's return"),
                txF('ded.useSales', 'Deduct sales tax instead of state income tax', 'c'),
                txF('ded.salesTax', 'Sales tax you paid', 'm', { when: o => !!txGet(o, 'ded.useSales') }),
                txF('ded.other', 'Other itemized deductions'),
              ]}
            />
          <//>
          <${TxSub} title="Adjustments (these lower your income either way)">
            <${TxGrid}
              obj=${prof}
              on=${(k, v) => up(k, v, 'ded')}
              ctx=${prof}
              fields=${[
                txF('adj.ira', 'Traditional IRA contribution (yours)', 'm', { h: 'For ' + year + ', made by April 15, ' + (year + 1) + '.' }),
                txF('adj.iraSp', "Traditional IRA contribution (your spouse's)", 'm', { when: () => joint }),
                txF('adj.coveredYou', 'Covered by a retirement plan at work', 'b', { auto: 'Go by my W-2s' }),
                txF('adj.coveredSp', 'Spouse covered by a retirement plan at work', 'b', { auto: 'Go by the W-2s', when: () => joint }),
                txF('adj.hsa', 'HSA contributions you made yourself (not through payroll)'),
                txF('adj.hsaFamily', 'Your HSA health plan covers family (not just you)', 'c', { when: o => +txGet(o, 'adj.hsa') > 0 }),
                txF('adj.studentLoan', 'Student loan interest (Form 1098-E)'),
                txF('adj.educator', 'Teacher classroom expenses (K-12)'),
                txF('adj.seHealth', 'Health insurance you paid as self-employed', 'm', { when: () => necAll.length > 0 }),
                txF('adj.seRetire', 'SEP-IRA or solo 401(k) contributions', 'm', { when: () => necAll.length > 0 }),
                txF('adj.earlyPenalty', 'Penalty for an early savings withdrawal (1099-INT box 2)'),
                txF('adj.alimony', 'Alimony paid (divorce before 2019)'),
                txF('adj.other', 'Other adjustments'),
              ]}
            />
          <//>`
      )}
      ${sec(
        'cred',
        'Credits',
        fed.L['20'] ? 'Credits ' + txUsd(fed.L['20']) : 'Education, savings and others',
        html`<${TxSub} title="College and courses" note="American opportunity credit: the first four years of college, up to $2,500 each, part of it paid even with no tax. Lifetime learning credit: any courses, 20% of up to $10,000. Use Form 1098-T and your receipts; take off scholarships.">
            <${TxList}
              items=${prof.cred && prof.cred.edu}
              onChange=${l => up('cred.edu', l, 'cred')}
              addLabel="Add a student"
              title=${(e, i) => e.n || 'Student ' + (i + 1)}
              fields=${[txF('n', 'Student', 't'), txF('kind', 'Credit', 's', { o: [['aotc', 'American opportunity (first 4 years of college)'], ['llc', 'Lifetime learning (any courses)']], w: 2 }), txF('cost', 'Tuition, fees and course materials paid')]}
              max=${4}
            />
          <//>
          <${TxGrid}
            obj=${prof}
            on=${(k, v) => up(k, v, 'cred')}
            fields=${[
              txF('cred.saverYou', 'Roth IRA or ABLE contributions (yours)', 'm', { h: "Counts for the saver's credit at lower incomes, with your 401(k) and IRA contributions." }),
              txF('cred.saverSp', 'Roth IRA or ABLE contributions (your spouse’s)', 'm', { when: () => joint }),
              txF('cred.foreign', 'Foreign tax paid (1099-DIV box 7, 1099-INT box 6)'),
              txF('cred.energy', 'Home energy credits (Form 5695)', 'm', { h: year >= 2026 ? 'Most home energy credits ended after 2025.' : 'Insulation, windows, heat pumps (30%), solar and batteries.' }),
              txF('cred.other', 'Other credits'),
            ]}
          />`
      )}
      ${sec(
        'pay',
        'Payments you made',
        txUsd(fed.L['26'] + (fed.S3['10'] || 0)) + ' paid besides withholding',
        html`<${TxGrid}
          obj=${prof}
          on=${(k, v) => up(k, v, 'pay')}
          fields=${[
            ...[0, 1, 2, 3].map(i => txF('pay.est.' + i, 'Estimated payment ' + (i + 1) + (est4[i] ? ' (due ' + fmtDate(est4[i], { month: 'short', day: 'numeric', year: 'numeric' }) + ')' : ''))),
            txF('pay.prior', "Last year's refund applied to this year"),
            txF('pay.ext', 'Paid with an extension (Form 4868)'),
            txF('pay.wh1099', 'Federal tax withheld on other 1099s', 'm', { h: '1099-R, SSA-1099, 1099-G, 1099-INT or 1099-DIV.' }),
            txF('pay.stateEst', 'State estimated payments'),
            txF('pay.localEst', 'Local estimated payments', 'm', { when: () => !!lo }),
            txF('priorTax', "Last year's total tax (Form 1040, line 24)", 'm', { h: 'For the underpayment check: paying at least this much during the year avoids the penalty (110% above $150,000 of income).' }),
            txF('priorAgi', "Last year's adjusted gross income (line 11)", 'm', { h: 'You also need it to sign a return you e-file yourself.' }),
          ]}
        />`
      )}
      ${
        S &&
        S.t !== 'none' &&
        S.w &&
        sec(
          'state',
          S.n,
          est.state ? (est.state.refund > 0 ? 'Refund ' + txUsd(est.state.refund) : est.state.owed > 0 ? 'Owe ' + txUsd(est.state.owed) : 'Even') : '',
          prof.state === 'NJ'
            ? html`<${TxGrid}
                obj=${prof}
                on=${(k, v) => up(k, v, 'state')}
                fields=${[
                  txF('nj.propTax', 'Property tax on your main home (homeowners)', 'm', { ph: txGet(prof, 'ded.propTax') ? String(txGet(prof, 'ded.propTax')) : '0' }),
                  txF('nj.rent', 'Rent you paid for your main home (tenants)', 'm', { h: '18% of the rent counts as property tax.' }),
                  txF('nj.veteranYou', 'You are a veteran (honorably discharged)', 'c'),
                  txF('nj.veteranSp', 'Your spouse is a veteran', 'c', { when: () => joint }),
                  txF('nj.sameHome', 'You and your spouse share a home', 'c', { when: () => prof.status === 'mfs' }),
                  txF('nj.otherIncome', 'Income also taxed by another state (New York wages, for example)'),
                  txF('nj.otherTax', 'Income tax you paid that state', 'm', { when: o => +txGet(o, 'nj.otherIncome') > 0 }),
                  txF('nj.health', 'Everyone on the return had health coverage all year', 'b', { auto: 'Yes' }),
                ]}
              />`
            : html`<p className="muted small" style=${{ margin: 0 }}>${S.n} is figured from its tax rates, standard deduction and exemptions${S.st === 'federalTaxable' ? ', starting from your federal taxable income' : S.st === 'own' ? ', from income as the state counts it' : ', starting from your federal adjusted gross income'}. Credits the state gives on top can be entered here.</p>
                <${TxGrid}
                  obj=${prof}
                  on=${(k, v) => up(k, v, 'state')}
                  fields=${[txF('oth.otherStateTax', 'Income tax you paid another state on income also taxed here'), txF('oth.stateCredits', 'Other state credits you qualify for')]}
                />`
        )
      }
    </div>`;
}

/* ---------------------------------------------------------------- the result */
function TxHero({ est, year, live, facts }) {
  const F = est.fed;
  const S = est.state;
  const p = facts.proj;
  const big = F.refund > 0 ? F.refund : F.owed;
  const lbl = F.refund > 0 ? (live ? 'Expected federal refund' : 'Federal refund') : F.owed > 0 ? (live ? 'Expected to owe the IRS' : 'You owe the IRS') : 'Federal: about even';
  const why = !(F.L['9'] > 0) && !(F.L['33'] > 0)
    ? 'No ' + year + ' income here yet: add your W-2s, 1099s and other income under Your answers.'
    : live
    ? p && (p.w2 || p.nec)
      ? 'From your paystubs so far plus ' + ((p.w2 || p.nec).n) + ' more payday' + ((p.w2 || p.nec).n === 1 ? '' : 's') + ' to December 31, and your answers. It changes every payday.'
      : 'From your ' + year + ' pay so far and your answers.'
    : 'From your ' + year + ' pay and your answers.';
  return html`<section className=${'panel txhero ' + (F.refund > 0 ? 'up' : F.owed > 0 ? 'down' : '')} aria-live="polite">
      <div className="txhero-main">
        <span className="txhero-l">${lbl}</span>
        <b className="txhero-n" data-tx="fed">${txUsd(big)}</b>
        <span className="txhero-s">${why}</span>
      </div>
      <div className="txhero-side">
        ${
          S
            ? html`<div><small>${S.name}${S.approx ? ' (approximate)' : ''}</small><b data-tx="state">${S.none ? (S.refund > 0 ? txUsd(S.refund) + ' back' : 'No income tax') : S.refund > 0 ? txUsd(S.refund) + ' refund' : S.owed > 0 ? txUsd(S.owed) + ' to pay' : 'About even'}</b></div>`
            : html`<div><small>State</small><b>Not chosen</b></div>`
        }
        <div><small>Altogether</small><b data-tx="net">${est.net >= 0.5 ? txUsd(est.net) + ' back' : est.net <= -0.5 ? txUsd(-est.net) + ' to pay' : 'Even'}</b></div>
      </div>
    </section>
    <${KitStats}
      items=${[
        { v: txUsd(F.L['9']), l: 'Total income' },
        { v: txUsd(F.L['15']), l: 'Taxable income' },
        { v: txUsd(F.L['24']), l: 'Federal tax for the year' },
        { v: txUsd(F.L['25d'] + F.L['26']), l: live ? 'Withheld and paid by Dec 31' : 'Withheld and paid' },
      ]}
    />`;
}
function TxRows({ rows }) {
  return html`<div className="tblwrap"><table className="tbl txrows">
      <tbody>
        ${rows.map(
          (r, i) => html`<tr key=${i} className=${(r.strong ? 'txtot' : '') + (r.tone ? ' tx-' + r.tone : '')}>
            <td>
              <span className="txrl"><span>${r.op ? html`<span className="txop">${r.op}</span>` : null}${r.l}</span>${r.ln ? html`<small className="txln">Line ${r.ln}</small>` : null}</span>
              ${r.sub ? html`<small className="txrs">${r.sub}</small>` : null}
            </td>
            <td className="r num">${txUsd(r.v)}</td>
          </tr>`
        )}
      </tbody>
    </table></div>`;
}
function TxNotes({ est }) {
  const n = txNotes(est);
  if (!n.length) return null;
  return html`<section className="panel stack">
      <h3 className="ph" style=${{ fontSize: 16 }}>Worth knowing</h3>
      <ul className="txnotes">${n.map((x, i) => html`<li key=${i} className=${x.w ? 'w' : ''}>${x.t}</li>`)}</ul>
    </section>`;
}
function TxEstimateView({ est, year }) {
  const F = est.fed;
  return html`<div className="stack">
      <section className="panel stack">
        <div className="ph-row"><h3 className="ph" style=${{ fontSize: 16 }}>How the federal figure is worked out</h3><span className="muted small">${F.nra ? 'Form 1040-NR' : 'Form 1040'}${year === 2025 ? ', line by line' : ''}</span></div>
        <${TxRows} rows=${txFedRows(est)} />
      </section>
      ${
        est.state &&
        html`<section className="panel stack">
          <div className="ph-row"><h3 className="ph" style=${{ fontSize: 16 }}>${est.state.name}</h3><span className="muted small">${est.state.full ? 'NJ-1040' : est.state.none ? 'No state income tax' : 'From the state’s rates, deductions and exemptions'}</span></div>
          <${TxRows} rows=${txStateRows(est)} />
        </section>`
      }
      <${TxNotes} est=${est} />
    </div>`;
}

/* ---------------------------------------------------------------- the year in progress: withholding and estimates */
function TxPlan({ est, D, prof, facts, raw, year, goTab }) {
  const F = est.fed;
  const p = facts.proj && facts.proj.w2;
  const n = p ? p.n : 0;
  const adv = txW4Advice(est, n);
  const tax = F.L['24'];
  const refundable = F.L['27a'] + F.L['28'] + F.L['29'] + (F.S3['11'] || 0);
  const withheld = F.L['25d'];
  const prior = +prof.priorTax || 0;
  const hiAgi = (+prof.priorAgi || 0) > (F.st === 'mfs' ? 75000 : 150000);
  const safe = Math.min(0.9 * tax, prior ? (hiAgi ? 1.1 : 1) * prior : Infinity);
  const need = Math.max(0, safe - withheld - refundable);
  const owesAfterWh = tax - withheld - refundable;
  const today = dkey();
  const paidEst = ((prof.pay || {}).est || []).map(v => +v || 0);
  const quarter = need / 4;
  // ways to lower the bill before the year ends
  const ideas = [];
  if (!F.nra) {
    const you = prof.you || {};
    const lim = D.fed.ira.limit + (you.born && year - you.born >= 50 ? D.fed.ira.catchUp50 : 0);
    const have = +txGet(prof, 'adj.ira') || 0;
    if (have < lim) {
      const alt = txEstimate(D, txForEngine(txSet(prof, 'adj.ira', lim)), facts);
      const save = alt.net - est.net;
      if (save >= 50) ideas.push({ t: 'Put ' + txUsd(lim - have) + ' more in a traditional IRA (by April 15, ' + (year + 1) + ')', v: save });
    }
    if (facts.w2 && raw.w2 && prof.usePortalW2 !== false && n > 0) {
      const w = facts.w2;
      const alt = txEstimate(D, txForEngine(prof), { ...facts, w2: { ...w, b1: Math.max(0, w.b1 - 1000), b16: Math.max(0, (+w.b16 || 0) - 1000), b12d: (+w.b12d || 0) + 1000 } });
      const save = alt.net - est.net;
      if (save >= 50) ideas.push({ t: 'Put $1,000 more in your 401(k) through payroll before December 31', v: save });
    }
  }
  return html`<div className="stack">
      <section className="panel stack">
        <h3 className="ph" style=${{ fontSize: 16 }}>Your withholding</h3>
        ${
          raw.w2 && n > 0
            ? Math.abs(adv.gap) < 200
              ? html`<p style=${{ margin: 0 }}><${Chip} s="ok">On track<//> Your withholding should land within ${txUsd(Math.max(100, Math.abs(adv.gap)))} of your federal tax. Nothing to change.</p>`
              : adv.gap > 0
                ? html`<p style=${{ margin: 0 }}>At this pace you would owe about <b>${txUsd(adv.gap)}</b> in April. Adding about <b>${txUsd(adv.perCheck)}</b> of extra federal withholding to each of your ${n} remaining paycheck${n === 1 ? '' : 's'} (W-4 step 4(c)) brings it close to zero.</p>`
                : html`<p style=${{ margin: 0 }}>You are on course for a refund of about <b>${txUsd(-adv.gap)}</b>. If you would rather have that money in your paychecks, you could withhold about <b>${txUsd(-adv.perCheck)}</b> less on each of your ${n} remaining paycheck${n === 1 ? '' : 's'}. Keeping a small refund is fine too.</p>`
            : html`<p className="muted" style=${{ margin: 0 }}>${raw.w2 ? 'No more paydays are expected this year, so withholding cannot change much now.' : 'No paychecks from this portal for ' + year + '. For another job, the IRS Tax Withholding Estimator works out a new W-4.'}</p>`
        }
        <div className="actions">
          ${raw.w2 && html`<a className="btn sm" href="#/portal/pay">Change my W-4 (Earnings › Tax withholding)</a>`}
          <a className="btn ghost sm" href=${D.links.withholding} target="_blank" rel="noopener">IRS Tax Withholding Estimator</a>
        </div>
        <p className="muted small" style=${{ margin: 0 }}>A new W-4 applies from the first payroll that ends 30 days or more after your employer gets it, often sooner here. Check this page again after the next paystub.</p>
      </section>
      ${
        owesAfterWh >= 1000 &&
        need > 0 &&
        html`<section className="panel stack">
          <h3 className="ph" style=${{ fontSize: 16 }}>Estimated tax payments</h3>
          <p style=${{ margin: 0 }}>With income that has no tax taken out (1099 or your own company), the IRS expects tax during the year. To avoid the underpayment penalty, pay at least <b>${txUsd(need)}</b> beyond your withholding: ${prior ? 'the smaller of 90% of this year’s tax and ' + (hiAgi ? '110%' : '100%') + ' of last year’s' : '90% of this year’s tax (enter last year’s tax under Payments: paying that much may be less)'}.</p>
          <div className="tblwrap"><table className="tbl">
            <thead><tr><th>Due</th><th className="r">Suggested</th><th className="r">You paid</th><th /></tr></thead>
            <tbody>${(D.estDue || []).map(
              (d, i) => html`<tr key=${d}><td>${txLong(d)}</td><td className="r num">${txUsd(quarter)}</td><td className="r num">${paidEst[i] ? txUsd(paidEst[i]) : '—'}</td><td>${paidEst[i] >= quarter - 1 ? html`<${Chip} s="ok">Paid<//>` : d < today ? html`<${Chip} s="amber">Was due<//>` : null}</td></tr>`
            )}</tbody>
          </table></div>
          <div className="actions">
            <a className="btn sm" href=${D.links.pay} target="_blank" rel="noopener">Pay the IRS online</a>
            <button type="button" className="btn ghost sm" onClick=${() => goTab('ans', 'pay')}>Record a payment</button>
          </div>
          <p className="muted small" style=${{ margin: 0 }}>A late quarter costs interest-like penalty for the days it is late; paying it now still lowers it. Your state has its own estimated payments if you owe it too.</p>
        </section>`
      }
      ${
        ideas.length > 0 &&
        html`<section className="panel stack">
          <h3 className="ph" style=${{ fontSize: 16 }}>Ways to lower your ${year} tax</h3>
          <ul className="txideas">${ideas.map((x, i) => html`<li key=${i}><span>${x.t}</span><b>saves about ${txUsd(x.v)}</b></li>`)}</ul>
          <p className="muted small" style=${{ margin: 0 }}>Worked out on your own figures (federal and state). Retirement money is yours, but it is locked away until retirement except for penalties.</p>
        </section>`
      }
    </div>`;
}

/* ---------------------------------------------------------------- filing */
const TX_DOCS = [
  ['w2', 'W-2 from each employer', (e, p, r) => e.fed.w2s.length > 0],
  ['nec', '1099-NEC (or your own records) for business income', e => e.fed.necs.length > 0],
  ['k1', 'Schedule K-1 from your S corporation or partnership', e => e.fed.k1s.length > 0],
  ['int', '1099-INT and 1099-DIV for interest and dividends', e => e.fed.L['2b'] + e.fed.L['3b'] + e.fed.L['2a'] > 0],
  ['b', '1099-B (or your broker’s summary) for sales of stock or funds', e => e.fed.L['7a'] !== 0],
  ['r', '1099-R for IRA and pension money', e => e.fed.L['4a'] + e.fed.L['5a'] > 0],
  ['ssa', 'SSA-1099 for social security', e => e.fed.L['6a'] > 0],
  ['g', '1099-G for unemployment (and any state refund)', (e, p) => +p.unemp > 0 || +p.stateRefund > 0],
  ['1098', 'Form 1098 for mortgage interest', (e, p) => +txGet(p, 'ded.mortgage') > 0],
  ['1098e', 'Form 1098-E for student loan interest', (e, p) => +txGet(p, 'adj.studentLoan') > 0],
  ['1098t', 'Form 1098-T from each college', (e, p) => ((p.cred || {}).edu || []).length > 0],
  ['care', 'Name, address and tax ID of each child care provider', (e, p) => +txGet(p, 'cred.careCost') > 0],
  ['ssn', 'Social security numbers (or ITINs) for everyone on the return', () => true],
  ['agi', 'Last year’s adjusted gross income, or your IRS Identity Protection PIN, to sign an e-filed return', () => true],
  ['bank', 'Bank routing and account numbers for the refund (the IRS has mostly stopped mailing paper checks)', e => e.fed.refund > 0],
  ['1095a', 'Form 1095-A if you had Marketplace health insurance (not figured here)', () => true],
  ['8843', 'Form 8843 for each F-1 or J-1 student in the family, even with no income', e => e.fed.nra],
];
function TxFile({ est, D, prof, up, srv, year, facts }) {
  const toast = useToast();
  const F = est.fed;
  const [pii, setPii] = useState(false);
  const [busy, setBusy] = useState(false);
  const live = +dkey().slice(0, 4) <= year;
  const chk = prof.chk || {};
  const docs = TX_DOCS.filter(d => d[2](est, prof, srv));
  const summary = async () => {
    setBusy(true);
    try {
      const bytes = await txSummaryPdf(est, prof, srv.about, D);
      await saveDownload('tax-summary-' + year + '.pdf', new Blob([bytes], { type: 'application/pdf' }));
    } catch (e) {
      if (!e || e.code !== 'declined') toast(errText(e), true);
    }
    setBusy(false);
  };
  const S = est.state;
  const nj = prof.state === 'NJ';
  const agiOk = D.freeFileAgi && F.agi <= D.freeFileAgi;
  if (live)
    return html`<div className="stack">
        <section className="panel stack">
          <h3 className="ph" style=${{ fontSize: 16 }}>Filing your ${year} return</h3>
          <p style=${{ margin: 0 }}>The IRS opens filing for ${year} in late January ${year + 1}, once your W-2s and 1099s have arrived (employers send them by January 31). The ${year} forms are not out yet; this page fills them in once they are. Until then, keep your estimate current and start collecting what you will need:</p>
          <ul className="txchk">${docs.map(d => html`<li key=${d[0]}>${d[1]}</li>`)}</ul>
          <div className="actions"><button type="button" className="btn ghost sm" disabled=${busy} onClick=${summary}><${Icon} n="down" />${busy ? 'Making it…' : 'Download a summary (PDF)'}</button></div>
        </section>
      </div>`;
  return html`<div className="stack">
      ${pii && html`<${TxPiiModal} est=${est} D=${D} prof=${prof} about=${srv.about || {}} onClose=${() => setPii(false)} />`}
      <section className="panel stack">
        <h3 className="ph" style=${{ fontSize: 16 }}>1. Have these ready</h3>
        <ul className="txchk on">
          ${docs.map(
            d => html`<li key=${d[0]}><label className="check"><input type="checkbox" checked=${!!chk[d[0]]} onChange=${e => up('chk.' + d[0], e.target.checked ? true : undefined)} /><span>${d[1]}${d[0] === 'w2' && facts.w2 ? html` · <a href="#/portal/pay">yours from ${facts.w2.employer || 'payroll'} is under Earnings › Tax documents</a>` : null}</span></label></li>`
          )}
        </ul>
      </section>
      <section className="panel stack">
        <h3 className="ph" style=${{ fontSize: 16 }}>2. Your return, filled in</h3>
        ${
          F.nra
            ? html`<p style=${{ margin: 0 }}>You file <b>Form 1040-NR</b> as a nonresident. This page does not fill in the 1040-NR: use the figures under "Your estimate" with the IRS form or software that handles nonresident returns, or a preparer.${' '}<a href=${D.links.f1040nr} target="_blank" rel="noopener">About Form 1040-NR</a> · <a href=${D.links.f8843} target="_blank" rel="noopener">Form 8843</a></p>`
            : D.forms
              ? html`<p style=${{ margin: 0 }}>Your Form 1040 and the schedules it needs, on the IRS's own ${year} forms, filled in from your estimate. You add your name, social security numbers, address and bank account in the next step: they go into the PDF on this device only and are never sent or saved.</p>
                <div className="actions"><button type="button" className="btn" onClick=${() => setPii(true)}><${Icon} n="file" />Fill in my ${year} Form 1040</button></div>`
              : html`<p className="muted" style=${{ margin: 0 }}>The ${year} forms are not available here yet.</p>`
        }
        <div className="actions"><button type="button" className="btn ghost sm" disabled=${busy} onClick=${summary}><${Icon} n="down" />${busy ? 'Making it…' : 'Download a summary for you or your preparer (PDF)'}</button></div>
      </section>
      <section className="panel stack">
        <h3 className="ph" style=${{ fontSize: 16 }}>3. Send it</h3>
        ${
          F.owed > 0 &&
          html`<div className="note amber" style=${{ margin: 0 }}>
            <span><b>You owe ${txUsd(F.owed)}.</b> Pay it online (or send a check with a paper return). ${dkey() > D.deadlines.file ? 'Interest and a late-payment penalty (usually 0.5% a month) have been adding up since ' + txLong(D.deadlines.file) + ', so paying now keeps them down. An extension gave more time to file, not to pay.' : 'It is due by ' + txLong(D.deadlines.file) + ', even with an extension to file.'}</span>
            <div className="actions"><a className="btn sm" href=${D.links.pay} target="_blank" rel="noopener">Pay the IRS online</a></div>
          </div>`
        }
        <div className="txways">
          ${
            D.freeFileAgi &&
            html`<div className=${'txway' + (agiOk ? ' best' : '')}>
              <b>IRS Free File</b>
              <span>Guided tax software from IRS partners, free with ${year} income (AGI) of ${txUsd(D.freeFileAgi)} or less; yours is ${txUsd(F.agi)}${agiOk ? ', so you qualify' : ', above the limit'}. Some partners include the state return.</span>
              <a className="btn sm" href=${D.links.freeFile} target="_blank" rel="noopener">IRS Free File</a>
            </div>`
          }
          <div className="txway">
            <b>Free File Fillable Forms</b>
            <span>Any income. The IRS forms on line, without the interview: type in the figures from your filled-in return. Federal only.</span>
            <a className="btn ghost sm" href=${D.links.fillable} target="_blank" rel="noopener">Fillable Forms</a>
          </div>
          <div className="txway">
            <b>A tax professional</b>
            <span>Take the summary PDF and your documents. Check a preparer's credentials in the IRS directory. Free help (VITA) for people who generally make ${txUsd(D.vitaAgi || 69000)} or less.</span>
            <span className="actions"><a className="btn ghost sm" href=${D.links.preparers} target="_blank" rel="noopener">IRS preparer directory</a><a className="btn ghost sm" href=${D.links.vita} target="_blank" rel="noopener">Free help (VITA)</a></span>
          </div>
          <div className="txway">
            <b>By mail</b>
            <span>Print the filled-in return, sign and date page 2 (both of you when filing jointly), attach your W-2s and mail it to the address for your state. Refunds take 6 weeks or more.</span>
            <a className="btn ghost sm" href=${D.links.paperWhere} target="_blank" rel="noopener">Where to mail it</a>
          </div>
        </div>
        ${
          S &&
          html`<div className="note info" style=${{ margin: 0 }}>
            <span><b>${S.name}:</b> ${S.none ? 'no state income tax return is needed for wages.' : nj ? html`file the NJ-1040 for free with NJ Online Filing, or through your tax software. ` : html`file with ${S.name}'s tax department or through your tax software; many Free File partners include the state.`}${!S.none && S.approx ? ' The state figure here is approximate: your state return works it out exactly.' : ''}</span>
            ${nj && html`<div className="actions"><a className="btn sm" href=${D.links.njFile} target="_blank" rel="noopener">NJ Online Filing</a></div>`}
          </div>`
        }
      </section>
    </div>`;
}
/* Names, social security numbers, address and bank account: typed here, put in the PDF on this device, never sent. */
function TxPiiModal({ est, D, prof, about, onClose }) {
  const toast = useToast();
  const F = est.fed;
  const joint = F.joint;
  const mfs = F.st === 'mfs';
  const nm = String(about.name || '').trim().split(/\s+/).filter(Boolean);
  const ad = about.addr || {};
  const deps = (prof.deps || []).filter(d => d && (d.n || d.born)).slice(0, 4);
  const [p, setP] = useState(() => ({
    first: nm.length > 1 ? nm.slice(0, -1).join(' ') : nm[0] || '',
    last: nm.length > 1 ? nm[nm.length - 1] : '',
    addr: ad.line || '',
    apt: ad.apt || '',
    city: ad.city || '',
    state: ad.state || '',
    zip: ad.zip || '',
    phone: about.phone || '',
    email: about.email || '',
    acctType: 'checking',
    digital: '',
    depSsn: deps.map(() => ''),
  }));
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState(null);
  const set = k => e => setP({ ...p, [k]: e.target.value });
  const digits = s => String(s || '').replace(/\D/g, '');
  const make = async () => {
    if (!p.first.trim() || !p.last.trim()) return toast('Enter your name as it is on your social security card.', true);
    if (digits(p.ssn).length !== 9) return toast('Your social security number (or ITIN) has 9 digits.', true);
    if ((joint || mfs) && (!String(p.spFirst || '').trim() || digits(p.spSsn).length !== 9)) return toast("Enter your spouse's name and 9-digit social security number.", true);
    if (!p.digital) return toast('Answer the digital assets question (it is on every Form 1040).', true);
    if (p.routing && digits(p.routing).length !== 9) return toast('Routing numbers have 9 digits.', true);
    if (p.routing && !/^\d{4,17}$/.test(digits(p.account))) return toast('Account numbers have 4 to 17 digits.', true);
    setBusy(true);
    try {
      const r = await txBuildReturn(
        est,
        txForEngine(prof),
        { ...p, ssn: digits(p.ssn), spSsn: digits(p.spSsn), routing: digits(p.routing), account: digits(p.account), zip: String(p.zip || '').trim(), depSsn: (p.depSsn || []).map(digits), phone: String(p.phone || '').trim() },
        { data: D }
      );
      setOut(r);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const dl = (name, bytes) =>
    saveDownload(name, new Blob([bytes], { type: 'application/pdf' })).catch(e => {
      if (!e || e.code !== 'declined') toast(errText(e), true);
    });
  const FORM_N = { f1040: 'Form 1040', f1040s1: 'Schedule 1', f1040s1a: 'Schedule 1-A', f1040s2: 'Schedule 2', f1040s3: 'Schedule 3', f1040s8: 'Schedule 8812', f1040sse: 'Schedule SE', f1040sc: 'Schedule C', f8995: 'Form 8995' };
  if (out)
    return html`<${Modal} title=${'Your ' + est.year + ' return is ready'} onClose=${onClose} wide=${true}>
        <div className="stack">
          <p style=${{ margin: 0 }}>${out.forms.length} form${out.forms.length === 1 ? '' : 's'}: ${out.forms.map(f => FORM_N[f] || f).join(', ')}.</p>
          <div className="actions"><button type="button" className="btn" onClick=${() => dl('form-1040-' + est.year + '.pdf', out.merged)}><${Icon} n="down" />Download the whole return (to print)</button></div>
          <p className="muted small" style=${{ margin: 0 }}>Each form on its own, still fillable, if anything needs fixing in a PDF reader:</p>
          <div className="actions">${out.parts.map((x, i) => html`<button key=${i} type="button" className="btn ghost sm" onClick=${() => dl(x.form + '-' + est.year + (out.parts.filter(y => y.form === x.form).length > 1 ? '-' + (i + 1) : '') + '.pdf', x.bytes)}>${FORM_N[x.form] || x.form}</button>`)}</div>
          <div className="note amber" style=${{ margin: 0 }}><span><b>Before you file:</b> check every figure against your W-2s and 1099s, sign and date page 2${joint ? ' (both of you)' : ''}, and keep a copy. The PDF holds your social security number: store it somewhere safe and don't email it.</span></div>
        </div>
      <//>`;
  const row = (k, l, o) => html`<${Field} label=${l} hint=${o && o.h}><input value=${p[k] || ''} onInput=${set(k)} autoComplete="off" inputMode=${o && o.num ? 'numeric' : undefined} type=${o && o.secret ? 'password' : 'text'} maxLength=${(o && o.max) || 60} /><//>`;
  return html`<${Modal}
      title=${'Fill in my ' + est.year + ' Form 1040'}
      onClose=${onClose}
      wide=${true}
      foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Cancel</button><button type="button" className="btn" disabled=${busy} onClick=${make}>${busy ? 'Filling in the forms…' : 'Make the PDF'}</button>`}
    >
      <div className="stack form">
        <div className="note ok" style=${{ margin: 0 }}><span><${Icon} n="shield" /> What you type here goes into the PDF on this device only. It is not sent to the portal or saved anywhere; close this window and it is gone.</span></div>
        <div className="txgrid">
          ${row('first', 'Your first name and middle initial')}
          ${row('last', 'Last name')}
          ${row('ssn', 'Your social security number', { num: true, secret: true, max: 11 })}
          ${row('occ', 'Your occupation', { h: 'For example: Software engineer' })}
          ${(joint || mfs) && row('spFirst', "Spouse's first name and middle initial")}
          ${(joint || mfs) && row('spLast', "Spouse's last name")}
          ${(joint || mfs) && row('spSsn', "Spouse's social security number", { num: true, secret: true, max: 11 })}
          ${joint && row('spOcc', "Spouse's occupation")}
          ${row('addr', 'Home address (number and street)')}
          ${row('apt', 'Apartment')}
          ${row('city', 'City')}
          ${row('state', 'State', { max: 2 })}
          ${row('zip', 'ZIP code', { num: true, max: 10 })}
          ${row('phone', 'Phone')}
          ${row('email', 'Email')}
          ${row('ipPin', 'Identity Protection PIN (if the IRS gave you one)', { num: true, max: 6 })}
          ${joint && row('spIpPin', "Spouse's Identity Protection PIN", { num: true, max: 6 })}
        </div>
        ${
          deps.length > 0 &&
          html`<div className="txgrid">${deps.map(
            (d, i) => html`<${Field} key=${i} label=${'Social security number: ' + (d.n || 'dependent ' + (i + 1))}><input type="password" autoComplete="off" inputMode="numeric" maxLength=${11} value=${(p.depSsn || [])[i] || ''} onInput=${e => setP({ ...p, depSsn: (p.depSsn || []).map((x, j) => (j === i ? e.target.value : x)) })} /><//>`
          )}</div>`
        }
        <${Field} label="At any time during the year, did you receive, sell, exchange or otherwise dispose of a digital asset (cryptocurrency, NFTs)?">
          <div className="seg">
            <button type="button" className=${p.digital === 'yes' ? 'on' : ''} onClick=${() => setP({ ...p, digital: 'yes' })}>Yes</button>
            <button type="button" className=${p.digital === 'no' ? 'on' : ''} onClick=${() => setP({ ...p, digital: 'no' })}>No</button>
          </div>
        <//>
        ${
          F.refund > 0 &&
          html`<div className="txgrid">
            ${row('routing', 'Bank routing number (for the refund)', { num: true, max: 9 })}
            ${row('account', 'Account number', { num: true, secret: true, max: 17 })}
            <${Field} label="Account type"><select value=${p.acctType} onChange=${set('acctType')}><option value="checking">Checking</option><option value="savings">Savings</option></select><//>
          </div>`
        }
        ${+prof.carInt > 0 && row('vin', 'Vehicle identification number (VIN) of the car with the loan', { max: 17 })}
      </div>
    <//>`;
}

/* ---------------------------------------------------------------- after filing */
function TxTrack({ est, D, year, srv, prof }) {
  const toast = useToast();
  const [t, setT] = useState(() => ({ ...(srv.track || {}) }));
  const [busy, setBusy] = useState(false);
  const F = est.fed;
  const S = est.state;
  const set = (k, v) => setT(o => txSet(o, k, v));
  const save = async () => {
    setBusy(true);
    try {
      await api('tax_track', { year, track: t });
      toast('Saved.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const filed = /^\d{4}-\d{2}-\d{2}$/.test(t.filedOn || '');
  const fedBy = filed ? addDays(t.filedOn, t.how === 'paper' ? 42 : 21) : '';
  const stBy = filed && S && !S.none ? addDays(t.filedOn, prof.state === 'NJ' ? (t.how === 'paper' ? 84 : 28) : t.how === 'paper' ? 56 : 28) : '';
  const steps = [
    ['fedRecv', 'Return received'],
    ['fedOk', 'Refund approved'],
    ['fedSent', 'Refund sent'],
  ];
  if (+dkey().slice(0, 4) <= year)
    return html`<section className="panel"><p className="muted" style=${{ margin: 0 }}>You file your ${year} return in ${year + 1}. Once it is filed, follow your refund here.</p></section>`;
  return html`<div className="stack">
      <section className="panel stack form">
        <h3 className="ph" style=${{ fontSize: 16 }}>Your filed return</h3>
        <div className="txgrid">
          <${Field} label="Filed on"><input type="date" value=${t.filedOn || ''} onInput=${e => set('filedOn', e.target.value || undefined)} /><//>
          <${Field} label="How"><select value=${t.how || 'efile'} onChange=${e => set('how', e.target.value)}><option value="efile">Electronically (e-file)</option><option value="paper">By mail</option></select><//>
          <${Field} label="Federal refund on the return"><span className="txmoney"><input type="number" min="0" value=${t.fedAmt != null ? t.fedAmt : ''} placeholder=${String(Math.round(F.refund))} onInput=${e => set('fedAmt', e.target.value === '' ? undefined : +e.target.value)} /></span><//>
          ${S && !S.none && html`<${Field} label=${S.name + ' refund on the return'}><span className="txmoney"><input type="number" min="0" value=${t.stAmt != null ? t.stAmt : ''} placeholder=${String(Math.round(S.refund))} onInput=${e => set('stAmt', e.target.value === '' ? undefined : +e.target.value)} /></span><//>`}
        </div>
        <div className="txsteps">
          ${steps.map(
            ([k, l], i) => html`<label key=${k} className=${'check' + (t[k] ? ' on' : '')}><input type="checkbox" checked=${!!t[k]} onChange=${e => set(k, e.target.checked ? dkey() : undefined)} /><span><b>${i + 1}. ${l}</b>${t[k] ? html` <small className="muted">${txLong(t[k])}</small>` : null}</span></label>`
          )}
        </div>
        ${
          filed &&
          html`<p style=${{ margin: 0 }}>${t.fedSent ? 'Your federal refund was sent ' + txLong(t.fedSent) + '. A direct deposit usually shows in a few days.' : 'Most ' + (t.how === 'paper' ? 'mailed returns are refunded 6 weeks or more after the IRS receives them' : 'e-filed refunds arrive within 3 weeks') + ': expect yours around ' + txLong(fedBy) + '.'}${stBy && !t.stSent ? ' ' + S.name + ': ' + (prof.state === 'NJ' ? (t.how === 'paper' ? 'at least 12 weeks' : '4 weeks or more') : 'usually several weeks') + ', around ' + txLong(stBy) + '.' : ''}</p>`
        }
        ${S && !S.none && html`<label className="check"><input type="checkbox" checked=${!!t.stSent} onChange=${e => set('stSent', e.target.checked ? dkey() : undefined)} /><span>${S.name} refund received</span></label>`}
        <${Field} label="Notes (letters from the IRS, amounts changed…)"><textarea rows="2" maxLength="600" value=${t.note || ''} onInput=${e => set('note', e.target.value || undefined)} /><//>
        <div className="actions"><button type="button" className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save'}</button></div>
      </section>
      <section className="panel stack">
        <h3 className="ph" style=${{ fontSize: 16 }}>Check where it is</h3>
        <p style=${{ margin: 0 }}>The IRS tool shows the same three steps, from 24 hours after an e-filed return (4 weeks after a mailed one). It needs your social security number, filing status and the exact refund amount. It updates once a day, overnight; the IRS app (formerly IRS2Go) shows the same.</p>
        <div className="actions">
          <a className="btn sm" href=${D.links.wmr} target="_blank" rel="noopener">Where's My Refund?</a>
          ${prof.state === 'NJ' && html`<a className="btn ghost sm" href=${D.links.njRefund} target="_blank" rel="noopener">New Jersey refund status</a>`}
          <a className="btn ghost sm" href=${D.links.amended} target="_blank" rel="noopener">Where's My Amended Return?</a>
        </div>
        <p className="muted small" style=${{ margin: 0 }}>Changed something after filing? An amended return (Form 1040-X) usually takes 8 to 12 weeks, sometimes up to 16.</p>
      </section>
    </div>`;
}
function TxPrivacy({ year, onDeleted }) {
  const toast = useToast();
  const [ask, setAsk] = useState(null);
  const [busy, setBusy] = useState(false);
  const del = async () => {
    setBusy(true);
    try {
      await api('tax_delete', ask === 'all' ? { all: true } : { year });
      toast(ask === 'all' ? 'All your tax answers are deleted.' : 'Your ' + year + ' answers are deleted.');
      setAsk(null);
      onDeleted();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<section className="panel stack txprivacy">
      ${
        ask &&
        html`<${Modal}
          title=${ask === 'all' ? 'Delete all your tax answers?' : 'Delete your ' + year + ' answers?'}
          onClose=${() => setAsk(null)}
          foot=${html`<button type="button" className="btn ghost" onClick=${() => setAsk(null)}>Keep them</button><button type="button" className="btn danger" disabled=${busy} onClick=${del}>${busy ? 'Deleting…' : 'Delete'}</button>`}
        >
          <p style=${{ margin: 0 }}>Your answers${ask === 'all' ? ' for every year' : ' for ' + year} and the refund tracker are removed for good. Your pay records stay as they are, and the estimate starts again from them.</p>
        <//>`
      }
      <h3 className="ph" style=${{ fontSize: 16 }}><${Icon} n="shield" /> Your privacy</h3>
      <p className="small" style=${{ margin: 0 }}>Your answers are saved for you alone, sealed on the server: nobody at ${wsName()} can open them, administrators included. Social security numbers, bank details and your address for the forms are never saved. The figures are worked out in your browser.</p>
      <div className="actions">
        <button type="button" className="btn ghost sm danger" onClick=${() => setAsk('year')}>Delete my ${year} answers</button>
        <button type="button" className="btn ghost sm danger" onClick=${() => setAsk('all')}>Delete all my tax answers</button>
      </div>
    </section>`;
}

/* ---------------------------------------------------------------- the page */
function TxDeadline({ year, D, onYear }) {
  const today = dkey();
  const cy = +today.slice(0, 4);
  const dl = D.deadlines || {};
  if (year < cy) {
    const left = daysBetween(today, dl.extended);
    if (today <= dl.file) return html`<div className="note info"><span><b>${year} returns are due ${txLong(dl.file)}.</b> Need more time? An extension to ${txLong(dl.extended)} is free, but any tax owed is still due on ${txLong(dl.file)}.</span></div>`;
    if (today <= dl.extended)
      return html`<div className="note amber"><span><b>${year} returns were due ${txLong(dl.file)}; with an extension, by ${txLong(dl.extended)} (${left === 0 ? 'today' : left + ' day' + (left === 1 ? '' : 's') + ' left'}).</b> No extension? File as soon as you can: when you are owed a refund there is no penalty for filing late, and you have three years to claim it. When you owe, penalties and interest grow every month.</span></div>`;
    return html`<div className="note amber"><span><b>The ${year} deadline has passed.</b> You can still file: a refund can be claimed for three years, and when you owe, filing and paying soon keeps the penalties and interest down.</span></div>`;
  }
  const prev = year - 1;
  const prevExt = prev + 1 + '-10-15';
  const prevOpen = TX_YEARS.includes(prev) && today <= prevExt;
  return html`<div className="note info">
      <span><b>${year} is still under way.</b> The estimate adds the paydays left until December 31 and changes every payday. You file in ${year + 1}, by ${txLong(dl.file)}.${prevOpen ? html` Still need to file for ${prev}? Extended returns are due ${txLong(prevExt)}.` : null}</span>
      ${prevOpen && html`<div className="actions"><button type="button" className="btn sm" onClick=${() => onYear(prev)}>Open ${prev}</button></div>`}
    </div>`;
}
function TaxCenter() {
  const toast = useToast();
  const [year, setYear] = useState(txFirstYear);
  const [tick, setTick] = useState(0);
  const [D, setD] = useState(null);
  const [srv, setSrv] = useState(null);
  const [prof, setProf] = useState(null);
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState(() => (/[?&]t=(\w+)/.exec(location.hash) || [])[1] || 'est');
  const [open, setOpen] = useState({});
  const [saved, setSaved] = useState({ at: 0, busy: false, err: '' });
  const dirty = useRef(false);
  const cur = useRef({});
  cur.current = { year, prof };
  useEffect(() => {
    let live = true;
    setD(null);
    setSrv(null);
    setProf(null);
    setErr(null);
    dirty.current = false;
    Promise.all([txData(year), api('tax_get', { year })]).then(
      ([d, s]) => {
        if (!live) return;
        const start = txStart(s, d);
        const p = s.prof && typeof s.prof === 'object' && !Array.isArray(s.prof) ? { ...start, ...s.prof } : start;
        setD(d);
        setSrv(s);
        setProf(p);
        setSaved({ at: s.u || 0, busy: false, err: '' });
        // a first visit opens the first part to answer
        if (!s.prof) setOpen({ about: true });
      },
      e => live && setErr(e)
    );
    return () => {
      live = false;
    };
  }, [year, tick]);
  const save = async () => {
    const { year: y, prof: p } = cur.current;
    if (!p || !dirty.current) return;
    dirty.current = false;
    setSaved(s => ({ ...s, busy: true, err: '' }));
    try {
      const r = await api('tax_save', { year: y, prof: p });
      if (cur.current.year === y) setSaved({ at: r.u, busy: false, err: '', pending: dirty.current });
    } catch (e) {
      dirty.current = true;
      setSaved(s => ({ ...s, busy: false, pending: false, err: errText(e) }));
    }
  };
  // answers are saved a moment after the last change, and right away when leaving the page or the year
  useEffect(() => {
    if (!prof || !dirty.current) return;
    const t = setTimeout(save, 1200);
    return () => clearTimeout(t);
  }, [prof]);
  useEffect(() => {
    // closing the tab or reloading within a moment of a change: the last answers still reach the server
    const flush = () => {
      const { year: y, prof: p } = cur.current;
      if (!p || !dirty.current) return;
      dirty.current = false;
      try {
        fetch(API + 'tax_save', { method: 'POST', keepalive: true, credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'application/json' }, body: JSON.stringify({ year: y, prof: p }) });
      } catch (e) {
        /* best effort */
      }
    };
    addEventListener('pagehide', flush);
    return () => {
      removeEventListener('pagehide', flush);
      save();
    };
  }, []);
  const switchYear = y => {
    if (y === year) return;
    save();
    setYear(y);
    setTab('est');
  };
  const up = (k, v) => {
    dirty.current = true;
    setProf(p => txSet(p, k, v));
    setSaved(s => (s.pending ? s : { ...s, pending: true }));
  };
  const upList = (k, list) => up(k, list);
  const facts = useMemo(() => (D && srv && prof ? txProject(D, srv.facts, prof) : null), [D, srv, prof && prof.project]);
  const est = useMemo(() => {
    if (!D || !prof || !facts) return null;
    try {
      return { ...txEstimate(D, txForEngine(prof), facts), facts };
    } catch (e) {
      console.error('tax estimate', e);
      return { error: e };
    }
  }, [D, prof, facts]);
  const goTab = (t, sec) => {
    setTab(t);
    if (sec) {
      setOpen(o => ({ ...o, [sec]: true }));
      setTimeout(() => {
        const el = document.getElementById('tx-' + sec);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 60);
    }
  };
  const live = +dkey().slice(0, 4) === year;
  const done = prof ? Object.keys(prof.done || {}).filter(k => prof.done[k]).length : 0;
  const parts = D && prof && D.states[prof.state] && D.states[prof.state].t !== 'none' && D.states[prof.state].w ? 7 : 6;
  const tabs = [
    ['est', 'Your estimate'],
    ['ans', 'Your answers', done < parts ? done + '/' + parts : ''],
    ...(live ? [['plan', 'Withholding & payments']] : []),
    ['file', live ? 'Filing' : 'File your return'],
    ...(!live ? [['track', 'Refund tracker']] : []),
  ];
  const tabOk = tabs.some(t => t[0] === tab) ? tab : 'est';
  const savedText = saved.err ? 'Not saved: ' + saved.err : saved.busy || saved.pending ? 'Saving…' : saved.at ? 'Saved ' + fmtTs(saved.at) : '';
  return html`<div className="stack txpage">
      <div className="ph-row">
        <span className="txyl">Tax year</span>
        <div className="seg" role="tablist" aria-label="Tax year">${TX_YEARS.map(y => html`<button key=${y} type="button" role="tab" aria-selected=${y === year} className=${y === year ? 'on' : ''} onClick=${() => switchYear(y)}>${y}</button>`)}</div>
        <span className=${'small txsaved' + (saved.err ? ' bad' : ' muted')} aria-live="polite">${savedText}</span>
      </div>
      ${
        err
          ? html`<${LoadError} error=${err} onRetry=${() => setTick(t => t + 1)} />`
          : !D || !prof || !est
            ? html`<${Spinner} label="Working out your taxes…" />`
            : est.error
              ? html`<${LoadError} title="The estimate could not be worked out." error=${est.error} onRetry=${() => setTick(t => t + 1)} />`
              : html`<${Fragment}>
                  <${TxDeadline} year=${year} D=${D} onYear=${switchYear} />
                  <${TxHero} est=${est} year=${year} live=${live} facts=${facts} />
                  ${
                    done < 2 &&
                    tabOk !== 'ans' &&
                    html`<div className="note info txstart"><span><b>Make it yours:</b> the figure above uses ${srv.facts && (srv.facts.w2 || (srv.facts.nec || []).length) ? 'your pay in this portal' : 'what you have entered'} and assumes you file single with no other income. Your filing status, family, other jobs and deductions can change it a lot.</span><div className="actions"><button type="button" className="btn sm" onClick=${() => goTab('ans', done ? null : 'about')}>Answer the questions</button></div></div>`
                  }
                  <${KitTabs} tabs=${tabs} tab=${tabOk} onTab=${setTab} />
                  ${tabOk === 'est' && html`<${TxEstimateView} est=${est} year=${year} />`}
                  ${tabOk === 'ans' && html`<${TxAnswers} D=${D} prof=${prof} up=${up} upList=${upList} est=${est} facts=${facts} raw=${srv.facts || {}} year=${year} open=${open} setOpen=${setOpen} />`}
                  ${tabOk === 'plan' && html`<${TxPlan} est=${est} D=${D} prof=${prof} facts=${facts} raw=${srv.facts || {}} year=${year} goTab=${goTab} />`}
                  ${tabOk === 'file' && html`<${TxFile} est=${est} D=${D} prof=${prof} up=${up} srv=${srv} year=${year} facts=${facts} />`}
                  ${tabOk === 'track' && html`<${TxTrack} key=${year} est=${est} D=${D} year=${year} srv=${srv} prof=${prof} />`}
                  ${(tabOk === 'ans' || tabOk === 'file') && html`<${TxPrivacy} year=${year} onDeleted=${() => setTick(t => t + 1)} />`}
                  <p className="muted small txdisc">An estimate under the ${year} federal and state rules from the figures here, not tax advice. Not included: the alternative minimum tax, the premium tax credit for Marketplace insurance, foreign income and a few rarer items. Check the figures against your W-2s and 1099s before you file, or ask a tax professional.</p>
                <//>`
      }
    </div>`;
}
