/* ================= v40 Tax center: the estimate engine =================
   Pure functions over a year's data (assets/tax/<year>.json, compiled from _source/tax/research with sources) and a
   person's answers. txEstimate(data, prof, facts) returns the federal return line by line (Form 1040 and the schedules
   it needs), the state return, the refund or amount owed and the notes behind them. No network, no page: the same
   file runs in the browser (js/tax.js) and in the unit tests (_source/tests/taxcalc.test.cjs).
   Covered: wages (W-2s from the portal's payroll and others), self-employment (1099-NEC, Schedule C, Schedule SE),
   S-corporation profit (Schedule K-1), interest, dividends, capital gains (0/15/20%), IRA/pension, social security,
   unemployment, the One Big Beautiful Bill Act deductions (tips, overtime, car loan interest, seniors; Schedule 1-A),
   standard or itemized deductions (SALT cap with its phase-down; 2026 charity rules and the 35% limit), the QBI
   deduction, child tax credit / other dependents (Schedule 8812), earned income credit, dependent care, education and
   saver's credits, additional Medicare tax, net investment income tax, excess social security, nonresident aliens
   (Form 1040-NR basics) and every state (New Jersey in full; the others from their rates, deductions and exemptions).
   Not covered (the notes say so when it matters): AMT, the premium tax credit, foreign income, rentals in detail. */

const txN = v => (Number.isFinite(+v) ? +v : 0);
const txP = v => Math.max(0, txN(v));
const txR = v => Math.round(txN(v)); // whole dollars, as the forms allow
const txMfj = st => st === 'mfj';
const txJointish = st => st === 'mfj' || st === 'qss';
/* Tax from a rate schedule: rows [lower bound, rate, base?]; a base is the schedule's own figure at that row. */
function txSched(rows, ti) {
  ti = txN(ti);
  if (!(ti > 0) || !rows || !rows.length) return 0;
  let cum = 0;
  for (let i = 0; i < rows.length; i++) {
    const lo = rows[i][0];
    const rate = rows[i][1];
    if (rows[i][2] != null) cum = rows[i][2];
    const hi = i + 1 < rows.length ? rows[i + 1][0] : Infinity;
    if (ti <= hi) return cum + Math.max(0, ti - lo) * rate;
    cum += (hi - lo) * rate;
  }
  return cum;
}
/* Form 1040 line 16: under $100,000 the Tax Table (the tax at the middle of each $50 row; $25 rows under $3,000 and
   the $0-$5, $5-$15, $15-$25 rows), from $100,000 the rate schedule. */
function txTableTax(rows, ti) {
  ti = txN(ti);
  if (ti <= 0) return 0;
  if (ti >= 100000) return txSched(rows, ti);
  let mid;
  if (ti < 5) return 0;
  if (ti < 15) mid = 10;
  else if (ti < 25) mid = 20;
  else if (ti < 3000) mid = Math.floor((ti - 25) / 25) * 25 + 25 + 12.5;
  else mid = Math.floor(ti / 50) * 50 + 25;
  return Math.round(txSched(rows, mid));
}
/* The Qualified Dividends and Capital Gain Tax Worksheet (25%/28% gains are not modeled). */
function txQdcg(F, st, ti, qd, ncg) {
  const rows = F.brackets[st];
  const l4 = Math.min(ti, txP(qd) + txP(ncg));
  if (l4 <= 0) return { tax: txTableTax(rows, ti), pref: 0 };
  const l5 = Math.max(0, ti - l4);
  const l7 = Math.min(ti, F.capGains.zeroMax[st]);
  const l8 = Math.min(l5, l7);
  const l9 = l7 - l8;
  const l10 = Math.min(ti, l4);
  const l12 = l10 - l9;
  const l14 = Math.min(ti, F.capGains.fifteenMax[st]);
  const l16 = Math.max(0, l14 - (l5 + l9));
  const l17 = Math.min(l12, l16);
  const l20 = l10 - (l9 + l17);
  const l23 = l17 * 0.15 + l20 * 0.2 + txTableTax(rows, l5);
  return { tax: Math.min(l23, txTableTax(rows, ti)), pref: l4, at0: l9, at15: l17, at20: l20 };
}
/* Taxable social security (the Form 1040 worksheet). */
function txSocialSecurity(st, ben, otherInc, taxExempt, adj, livedWithSpouse) {
  ben = txP(ben);
  if (!ben) return 0;
  const l2 = ben / 2;
  const l5 = l2 + txN(otherInc) + txP(taxExempt);
  if (adj >= l5) return 0;
  const l8 = l5 - adj;
  const mfsTogether = st === 'mfs' && livedWithSpouse;
  const base = mfsTogether ? 0 : txMfj(st) ? 32000 : 25000;
  if (base >= l8 && !mfsTogether) return 0;
  const l10 = l8 - base;
  const l11 = mfsTogether ? 0 : txMfj(st) ? 12000 : 9000;
  const l12 = Math.max(0, l10 - l11);
  const l15 = Math.min(l2, Math.min(l10, l11) / 2);
  return Math.min(l15 + l12 * 0.85, ben * 0.85);
}
/* The earned income credit at the middle of the $50 row (as the EIC Table is built). */
function txEicAt(p, x) {
  x = txN(x);
  if (x < 1) return 0;
  const mid = Math.floor(x / 50) * 50 + 25;
  return mid;
}
function txEic(F, st, kids, earned, agi, opts) {
  const p = F.eitc['kids' + Math.min(3, kids)];
  if (!p) return 0;
  const start = txMfj(st) ? p.phaseStartMfj : p.phaseStart;
  const f = x => Math.max(0, Math.min(x, p.earnedAmount) * p.creditRate - Math.max(0, x - start) * p.phaseRate);
  if (earned <= 0) return 0;
  let c = Math.round(f(txEicAt(p, earned)));
  if (agi >= start && agi !== earned) c = Math.min(c, Math.round(f(txEicAt(p, agi))));
  const end = txMfj(st) ? p.completePhaseoutMfj : p.completePhaseout;
  if (agi >= end || earned >= end) c = 0;
  return Math.min(c, p.credit);
}
const txAge = (born, year) => (born ? year - txN(born) : 0);
/* Schedule SE for one person: [tax, net earnings]. */
function txSe(F, profit, ssWages) {
  if (!(profit > 0)) return [0, 0, 0];
  const ne = profit * F.ss.seNetFactor;
  if (ne < 400) return [0, 0, 0];
  const room = Math.max(0, F.ss.wageBase - txP(ssWages));
  const ss = Math.min(ne, room) * 0.124;
  const med = ne * 0.029;
  return [ss + med, ne, ss];
}
/* Residency for tax (a suggestion the person can change): F/J students and scholars are "exempt individuals" for
   their first calendar years in the US (5 for students), so they are nonresident aliens; H-1B, L-1 and similar
   workers become residents once present 183+ days (the substantial presence test). */
function txResidency(prof, year) {
  const visa = String(prof.visa || '').toUpperCase();
  const first = txN(prof.firstYear);
  if (!visa || /USC|CITIZEN|GC|GREEN/.test(visa)) return { res: 'resident', why: '' };
  if (/OPT|CPT|F-1|F1|J-1|J1|STUDENT/.test(visa)) {
    if (first && year - first < 5) return { res: 'nonresident', why: 'F-1/J-1 students are nonresident aliens for their first 5 calendar years in the US (' + first + '–' + (first + 4) + ').', dual: false };
    if (!first) return { res: 'nonresident', why: 'F-1/J-1 students are usually nonresident aliens for their first 5 calendar years in the US. Enter the year you first came on an F or J visa to be sure.' };
    return { res: 'resident', why: 'More than 5 calendar years on an F or J visa: usually a resident if you were in the US 183+ days.' };
  }
  if (first === year) return { res: 'resident', why: 'Your first year in the US is usually a dual-status year (nonresident until you arrived). This estimate treats you as a resident for the whole year; a first-year choice or a dual-status return can change it.', dual: true };
  return { res: 'resident', why: '' };
}

/* ---------------------------------------------------------------- the federal return */
function txFederal(D, prof, facts) {
  const F = D.fed;
  const year = D.year;
  const notes = [];
  const warn = [];
  const resi = prof.res === 'resident' || prof.res === 'nonresident' ? { res: prof.res, why: '' } : txResidency(prof, year);
  const nra = resi.res === 'nonresident';
  if (resi.why) notes.push(resi.why);
  let st = prof.status || 'single';
  if (nra && !['single', 'mfs'].includes(st)) {
    warn.push('Nonresident aliens file as single or married filing separately (Form 1040-NR); the estimate uses ' + (st === 'mfj' ? 'married filing separately' : 'single') + '.');
    st = st === 'mfj' ? 'mfs' : 'single';
  }
  const joint = txMfj(st);
  const you = prof.you || {};
  const sp = joint || st === 'mfs' ? prof.sp || {} : {};
  const deps = (prof.deps || []).filter(d => d && (d.n || d.born));
  const ageYou = txAge(you.born, year);
  const ageSp = joint ? txAge(sp.born, year) : 0;
  const L = {}; // Form 1040 lines
  const S1 = {}; // Schedule 1
  const S1A = {}; // Schedule 1-A
  const S2 = {}; // Schedule 2
  const S3 = {}; // Schedule 3
  const SE = { you: null, sp: null };
  const S8812 = {};
  const SA = {};
  const Q = {}; // Form 8995

  /* W-2s: the portal's payroll (facts.w2, projected to Dec 31 when asked) and the ones entered by hand */
  const w2s = [];
  if (facts && facts.w2 && prof.usePortalW2 !== false) w2s.push({ ...facts.w2, who: 'you', emp: facts.w2.employer || 'StratEdge', portal: true });
  for (const w of prof.w2 || []) if (w && w.on !== false) w2s.push({ ...w, who: w.who === 'sp' && joint ? 'sp' : 'you' });
  const sumW = (k, who) => w2s.filter(w => !who || w.who === who).reduce((a, w) => a + txN(w[k]), 0);
  /* 1099-NEC / self-employment, per person */
  const necs = [];
  if (facts && Array.isArray(facts.nec) && prof.usePortalNec !== false) for (const n of facts.nec) necs.push({ who: 'you', payer: n.payer || 'StratEdge', amt: txP(n.total), portal: true });
  for (const n of prof.nec || []) if (n && n.on !== false) necs.push({ ...n, who: n.who === 'sp' && joint ? 'sp' : 'you', amt: txP(n.amt) });
  const biz = prof.biz || {};
  const profitOf = who => {
    const gross = necs.filter(n => n.who === who).reduce((a, n) => a + n.amt, 0);
    const exp = txP((biz[who] || {}).exp);
    return { gross, exp, net: gross - exp };
  };
  const pYou = profitOf('you');
  const pSp = joint ? profitOf('sp') : { gross: 0, exp: 0, net: 0 };
  const k1s = (prof.k1 || []).filter(k => k && k.on !== false).map(k => ({ ...k, who: k.who === 'sp' && joint ? 'sp' : 'you', ord: txN(k.ord) }));

  /* Income */
  L['1a'] = sumW('b1');
  L['1z'] = L['1a'];
  L['2a'] = txP(prof.taxExemptInt);
  L['2b'] = txP(prof.int);
  L['3a'] = Math.min(txP(prof.divQual), txP(prof.divOrd) || txP(prof.divQual));
  L['3b'] = Math.max(txP(prof.divOrd), L['3a']);
  const ira = prof.ira || {};
  const pens = prof.pens || {};
  L['4a'] = txP(ira.dist);
  L['4b'] = Math.min(txP(ira.taxable), L['4a'] || txP(ira.taxable));
  L['5a'] = txP(pens.gross);
  L['5b'] = Math.min(txP(pens.taxable), L['5a'] || txP(pens.taxable));
  const capNet = txN(prof.capST) + txN(prof.capLT) + txP(prof.capDist);
  const capLossLimit = st === 'mfs' ? -1500 : -3000;
  L['7a'] = capNet < 0 ? Math.max(capLossLimit, capNet) : capNet;
  if (capNet < capLossLimit) notes.push('Your capital loss beyond ' + Math.abs(capLossLimit).toLocaleString('en-US') + ' carries over to next year.');
  const ltcg = txN(prof.capLT) + txP(prof.capDist);
  const ncg = Math.max(0, Math.min(ltcg, capNet)); // net capital gain for the 0/15/20% rates
  // Schedule 1 Part I
  S1['1'] = txP(prof.stateRefund);
  S1['3'] = pYou.net + pSp.net;
  const k1Ord = k1s.reduce((a, k) => a + k.ord, 0);
  S1['5'] = k1Ord + txP(prof.passive); // Schedule E: S corporations, partnerships and net rent (a rental loss is not subtracted: passive loss rules)
  S1['7'] = txP(prof.unemp);
  S1['8z'] = txN(prof.otherInc);
  S1['9'] = S1['8z'];
  S1['10'] = S1['1'] + S1['3'] + S1['5'] + S1['7'] + S1['9'];
  L['8'] = S1['10'];
  // self-employment tax (needed for the adjustments)
  const seYou = nra ? [0, 0, 0] : txSe(F, pYou.net, sumW('b3', 'you'));
  const seSp = nra || !joint ? [0, 0, 0] : txSe(F, pSp.net, sumW('b3', 'sp'));
  SE.you = seYou[0] ? { profit: pYou.net, ne: seYou[1], tax: seYou[0], ssWages: sumW('b3', 'you') } : null;
  SE.sp = seSp[0] ? { profit: pSp.net, ne: seSp[1], tax: seSp[0], ssWages: sumW('b3', 'sp') } : null;
  const seTax = seYou[0] + seSp[0];
  if (nra && pYou.net > 0) notes.push('Nonresident aliens generally do not owe self-employment tax on business income.');
  // Schedule 1 Part II: adjustments
  const adj = prof.adj || {};
  S1['11'] = Math.min(txP(adj.educator), joint ? 600 : 300);
  // HSA: contributions made outside payroll, within the year's limit less what payroll already put in (box 12 W)
  const hsaLimit = (adj.hsaFamily ? F.hsa.family : F.hsa.self) + (ageYou >= 55 ? F.hsa.catchUp55 : 0);
  S1['13'] = Math.min(txP(adj.hsa), Math.max(0, hsaLimit - sumW('b12w')));
  if (txP(adj.hsa) > S1['13']) notes.push('HSA contributions above the year\'s limit (including what payroll put in) are not deductible.');
  S1['15'] = seTax / 2;
  S1['16'] = txP(adj.seRetire);
  S1['17'] = Math.min(txP(adj.seHealth), Math.max(0, S1['3'] - S1['15'] - S1['16']));
  S1['18'] = txP(adj.earlyPenalty);
  S1['19a'] = txP(adj.alimony);
  // the rest of the adjustments decide MAGI for the IRA and student loan phase-outs
  const preIra = L['1z'] + L['2b'] + L['3b'] + L['4b'] + L['5b'] + L['7a'] + L['8'] - (S1['11'] + S1['13'] + S1['15'] + S1['16'] + S1['17'] + S1['18'] + S1['19a']);
  // social security (needs income before the IRA and student loan deductions, close enough for an estimate)
  const ssBen = txP(prof.ss);
  L['6a'] = ssBen;
  const covered = who => (who === 'you' ? adj.coveredYou : adj.coveredSp) ?? w2s.some(w => w.who === who && (txN(w.b12d) > 0 || txN(w.b12aa) > 0 || w.retire));
  const iraDed = (who, amt, age) => {
    const lim = F.ira.limit + (age >= 50 ? F.ira.catchUp50 : 0);
    amt = Math.min(txP(amt), lim);
    if (!amt) return 0;
    const meCovered = covered(who);
    const other = who === 'you' ? 'sp' : 'you';
    let range = null;
    // v83: a qualifying surviving spouse uses the MFJ range (Pub 590-A Table 1-2); the spouse range below stays MFJ-only
    if (meCovered) range = st === 'mfs' ? F.ira.phase.mfs : txJointish(st) ? F.ira.phase.mfj : F.ira.phase.single;
    else if (joint && covered(other)) range = F.ira.phase.spouse;
    if (!range) return amt;
    const magi = preIra + L['6a'] * 0.85;
    if (magi <= range[0]) return amt;
    if (magi >= range[1]) return 0;
    // the IRA deduction worksheet: the limit shrinks in step with income, rounded up to $10, never under $200
    const cut = Math.max(200, Math.ceil((lim * (range[1] - magi)) / (range[1] - range[0]) / 10) * 10);
    return Math.min(amt, cut);
  };
  S1['20'] = iraDed('you', adj.ira, ageYou) + (joint ? iraDed('sp', adj.iraSp, ageSp) : 0);
  if (txP(adj.ira) + txP(adj.iraSp) > S1['20']) notes.push('Part of your traditional IRA contribution is not deductible (workplace retirement plan and income); it can still go in as a nondeductible contribution (Form 8606).');
  // student loan interest
  let sli = Math.min(txP(adj.studentLoan), F.studentLoanInterest.max);
  if (st === 'mfs' || (you.dep && !joint)) sli = 0;
  if (sli) {
    const [a, b] = joint ? F.studentLoanInterest.phase.mfj : F.studentLoanInterest.phase.single;
    const magi = preIra - S1['20'] + L['6a'] * 0.85;
    if (magi >= b) sli = 0;
    else if (magi > a) sli = sli * (1 - (magi - a) / (b - a));
  }
  S1['21'] = Math.round(sli);
  S1['24z'] = txP(adj.other);
  S1['25'] = S1['24z'];
  S1['26'] = S1['11'] + S1['13'] + S1['15'] + S1['16'] + S1['17'] + S1['18'] + S1['19a'] + S1['20'] + S1['21'] + S1['25'];
  const otherForSs = L['1z'] + L['2b'] + L['3b'] + L['4b'] + L['5b'] + L['7a'] + L['8'];
  const adjForSs = S1['26'] - S1['21'];
  L['6b'] = txSocialSecurity(st, ssBen, otherForSs, L['2a'], adjForSs, !prof.livedApart);
  L['9'] = L['1z'] + L['2b'] + L['3b'] + L['4b'] + L['5b'] + L['6b'] + L['7a'] + L['8'];
  L['10'] = S1['26'];
  L['11'] = L['9'] - L['10'];
  const agi = L['11'];
  const magi = agi;

  /* Deductions */
  const dd = prof.ded || {};
  const addlUnits = (ageYou >= 65 ? 1 : 0) + (you.blind ? 1 : 0) + (joint || (st === 'mfs' && prof.spNoIncome) ? (ageSp >= 65 ? 1 : 0) + (sp.blind ? 1 : 0) : 0);
  const married = joint || st === 'mfs' || st === 'qss';
  let std = F.stdDeduction[st] + addlUnits * (married ? F.addlStd.married : F.addlStd.unmarried);
  if (you.dep) {
    const earnedYou = sumW('b1', 'you') + Math.max(0, pYou.net - seYou[0] / 2);
    std = Math.min(F.stdDeduction[st], Math.max(F.dependentStd.min, earnedYou + F.dependentStd.earnedPlus)) + addlUnits * (married ? F.addlStd.married : F.addlStd.unmarried);
  }
  if (nra) std = prof.indiaTreaty ? F.stdDeduction[st] : 0;
  if (st === 'mfs' && sp.itemizes) std = 0;
  // Schedule A
  SA['1'] = txP(dd.medical);
  SA['4'] = Math.max(0, SA['1'] - 0.075 * agi);
  const stateWh = w2s.reduce((a, w) => a + txN(w.b17) + txN(w.b19), 0);
  const incomeTaxes = stateWh + txP((prof.pay || {}).stateEst) + txP((prof.pay || {}).localEst) + txP(dd.priorStateBal);
  SA['5a'] = dd.useSales ? txP(dd.salesTax) : incomeTaxes;
  SA['5b'] = nra ? 0 : txP(dd.propTax);
  SA['5c'] = nra ? 0 : txP(dd.persProp);
  SA['5d'] = SA['5a'] + SA['5b'] + SA['5c'];
  const cap = st === 'mfs' ? F.salt.capMfs : F.salt.cap;
  const ps = st === 'mfs' ? F.salt.phaseStartMfs : F.salt.phaseStart;
  const floor = st === 'mfs' ? F.salt.floorMfs : F.salt.floor;
  const saltCap = Math.max(floor, cap - F.salt.phaseRate * Math.max(0, magi - ps));
  SA['5e'] = Math.min(SA['5d'], saltCap);
  SA['7'] = SA['5e'];
  SA['8a'] = nra ? 0 : txP(dd.mortgage);
  SA['10'] = SA['8a'];
  let gifts = txP(dd.charityCash) + txP(dd.charityOther);
  if (F.itemizedLimits && F.itemizedLimits.charityFloorPctAgi) gifts = Math.max(0, gifts - F.itemizedLimits.charityFloorPctAgi * agi);
  SA['14'] = Math.min(gifts, 0.6 * agi);
  SA['16'] = txP(dd.other);
  SA['17'] = SA['4'] + SA['7'] + SA['10'] + SA['14'] + SA['16'];
  if (nra) SA['17'] = SA['7'] + SA['14'] + SA['16'];
  /* Schedule 1-A (One Big Beautiful Bill Act deductions, 2025-2028; not for married filing separately except car loan
     interest; tips, overtime and seniors need a valid SSN) */
  const ssnOk = you.ssn !== false;
  const over = t => Math.max(0, magi - t);
  const tipsIn = st === 'mfs' || !ssnOk ? 0 : Math.min(txP(prof.tips), F.obbba.tips.cap);
  S1A['13'] = Math.max(0, tipsIn - Math.floor(over(joint ? F.obbba.tips.phaseStart.mfj : F.obbba.tips.phaseStart.other) / 1000) * F.obbba.tips.phasePer1000);
  const otIn = st === 'mfs' || !ssnOk ? 0 : Math.min(txP(prof.otPrem), joint ? F.obbba.overtime.cap.mfj : F.obbba.overtime.cap.other);
  S1A['21'] = Math.max(0, otIn - Math.floor(over(joint ? F.obbba.overtime.phaseStart.mfj : F.obbba.overtime.phaseStart.other) / 1000) * F.obbba.overtime.phasePer1000);
  const carIn = Math.min(txP(prof.carInt), F.obbba.carLoanInterest.cap);
  S1A['30'] = Math.max(0, carIn - Math.ceil(over(joint ? F.obbba.carLoanInterest.phaseStart.mfj : F.obbba.carLoanInterest.phaseStart.other) / 1000) * F.obbba.carLoanInterest.phasePer1000);
  const seniorEach = Math.max(0, F.obbba.senior.amountPerPerson - F.obbba.senior.phaseRate * over(joint ? F.obbba.senior.phaseStart.mfj : F.obbba.senior.phaseStart.other));
  S1A['36a'] = st !== 'mfs' && ageYou >= 65 && ssnOk ? seniorEach : 0;
  S1A['36b'] = joint && ageSp >= 65 && sp.ssn !== false ? seniorEach : 0;
  S1A['37'] = S1A['36a'] + S1A['36b'];
  S1A['38'] = S1A['13'] + S1A['21'] + S1A['30'] + S1A['37'];
  // the 2026 limit on the benefit of itemized deductions (37% bracket): 2/37 of the smaller of the itemized total or
  // income over the 37% bracket's start
  let itemized = SA['17'];
  if (F.itemizedLimits && F.itemizedLimits.benefitCapRate && itemized > 0) {
    const t37 = F.brackets[st][F.brackets[st].length - 1][0];
    const x = agi - S1A['38'];
    const cut = (2 / 37) * Math.min(itemized, Math.max(0, x - t37));
    if (cut > 0) {
      SA['limit'] = cut;
      itemized -= cut;
    }
  }
  SA['17'] = Math.max(0, itemized);
  const mode = dd.mode || 'auto';
  const useItem = st === 'mfs' && sp.itemizes ? true : nra ? SA['17'] > std : mode === 'itemized' ? true : mode === 'standard' ? false : SA['17'] > std;
  L['12e'] = useItem ? SA['17'] : std;
  L.itemized = useItem;
  L.std = std;
  // 2026: cash gifts for people who take the standard deduction
  L['12f'] = 0;
  if (!useItem && F.charityNonItemizer && F.charityNonItemizer.single) L['12f'] = Math.min(txP(dd.charityCash), joint ? F.charityNonItemizer.mfj : F.charityNonItemizer.single);
  // QBI (Form 8995 / 8995-A, one business at a time)
  const qbiIncome = Math.max(0, S1['3'] - S1['15'] - S1['16'] - S1['17']) + Math.max(0, k1Ord);
  const tiBefore = Math.max(0, agi - L['12e'] - L['12f'] - S1A['38']);
  const ncgQ = txP(L['3a']) + ncg;
  let qbi = 0;
  if (qbiIncome > 0) {
    const thr = joint ? F.qbi.threshold.mfj : F.qbi.threshold.other;
    const range = joint ? F.qbi.phaseRange.mfj : F.qbi.phaseRange.other;
    const sstb = !!(biz.you || {}).sstb || k1s.some(k => k.sstb);
    const W = k1s.reduce((a, k) => a + txP(k.w2wages), 0);
    let comp = 0.2 * qbiIncome;
    if (tiBefore > thr) {
      const pct = Math.min(1, (tiBefore - thr) / range);
      const applic = sstb ? 1 - pct : 1;
      const base = 0.2 * qbiIncome * applic;
      const wageLim = 0.5 * W * applic;
      comp = pct >= 1 ? (sstb ? 0 : Math.min(base, wageLim)) : wageLim < base ? base - (base - wageLim) * pct : base;
    }
    qbi = Math.max(0, Math.min(comp, 0.2 * Math.max(0, tiBefore - ncgQ)));
    if (F.qbi.minimumDeduction && qbiIncome >= F.qbi.minimumDeduction.activeIncomeFloor) qbi = Math.max(qbi, Math.min(F.qbi.minimumDeduction.amount, tiBefore));
    Q['4'] = qbiIncome;
    Q['5'] = 0.2 * qbiIncome;
    Q['11'] = tiBefore;
    Q['12'] = ncgQ;
    Q['15'] = qbi;
  }
  // 2025 puts QBI on line 13a and Schedule 1-A on 13b; 2026 swaps them (13a Schedule 1-A, 13b QBI)
  L.qbi = qbi;
  L.s1a = S1A['38'];
  L['14'] = L['12e'] + L['12f'] + qbi + S1A['38'];
  L['15'] = Math.max(0, agi - L['14']);
  const ti = L['15'];

  /* Tax */
  const q = txQdcg(F, st, ti, L['3a'], ncg);
  L['16'] = Math.round(q.tax);
  L.qdcg = q;
  S2['2'] = 0; // AMT not figured
  S2['3'] = S2['2'];
  L['17'] = S2['3'];
  L['18'] = L['16'] + L['17'];

  /* Credits, in the order the forms limit them */
  let left = L['18'];
  const take = v => {
    const t = Math.min(left, Math.max(0, v));
    left -= t;
    return t;
  };
  const cr = prof.cred || {};
  S3['1'] = take(Math.round(txP(cr.foreign)));
  // dependent care (Form 2441)
  const earnedYouAll = sumW('b1', 'you') + Math.max(0, seYou[1] ? pYou.net - seYou[0] / 2 : pYou.net);
  const earnedSpAll = joint ? sumW('b1', 'sp') + Math.max(0, seSp[1] ? pSp.net - seSp[0] / 2 : pSp.net) : 0;
  let care = 0;
  if (txP(cr.careCost) > 0 && st !== 'mfs' && !nra) {
    const n = Math.max(1, txN(cr.careKids) || deps.filter(d => txAge(d.born, year) < 13 || d.disabled).length || 1);
    const dc = F.depCare;
    const fsa = Math.min(w2s.reduce((a, w) => a + txN(w.b10), 0), dc.fsa);
    const capAmt = Math.max(0, dc.caps[n >= 2 ? 1 : 0] - fsa);
    const earnedLim = joint ? Math.min(earnedYouAll, sp.student || sp.disabled ? Math.max(earnedSpAll, (n >= 2 ? 500 : 250) * 12) : earnedSpAll) : earnedYouAll;
    const base = Math.min(txP(cr.careCost), capAmt, earnedLim);
    let rate = dc.max;
    if (agi > dc.start1) rate = Math.max(dc.floor1, dc.max - Math.ceil((agi - dc.start1) / dc.step1) * 0.01);
    if (dc.start2) {
      const s2 = joint ? dc.start2.mfj : dc.start2.other;
      const w = joint ? dc.step2.mfj : dc.step2.other;
      if (agi > s2) rate = Math.max(dc.min, rate - Math.ceil((agi - s2) / w) * 0.01);
    }
    care = Math.round(base * rate);
  }
  S3['2'] = take(care);
  L.careAllowed = care;
  // education credits (Form 8863)
  let aotcTotal = 0;
  let llcExp = 0;
  for (const e of cr.edu || []) {
    if (!e) continue;
    if (e.kind === 'aotc') aotcTotal += Math.min(2000, txP(e.cost)) + 0.25 * Math.max(0, Math.min(2000, txP(e.cost) - 2000));
    else llcExp += txP(e.cost);
  }
  let eduRatio = 1;
  if (aotcTotal || llcExp) {
    const [a, b] = joint ? F.aotc.phase.mfj : F.aotc.phase.single;
    eduRatio = st === 'mfs' || nra ? 0 : magi >= b ? 0 : magi <= a ? 1 : (b - magi) / (b - a);
  }
  const aotc = Math.round(aotcTotal * eduRatio);
  const aotcRefund = you.dep ? 0 : Math.round(aotc * F.aotc.refundablePct);
  const llc = Math.round(Math.min(llcExp, F.llc.expenseCap) * F.llc.rate * eduRatio);
  S3['3'] = take(aotc - aotcRefund + llc);
  // saver's credit (Form 8880)
  let saver = 0;
  if (!you.dep && !nra) {
    const contrib = who => Math.min(F.saversCredit.maxContribution, (who === 'you' ? txP(adj.ira) + txP(cr.saverYou) : txP(adj.iraSp) + txP(cr.saverSp)) + w2s.filter(w => w.who === who).reduce((a, w) => a + txN(w.b12d) + txN(w.b12aa), 0));
    const amt = contrib('you') * (you.student ? 0 : 1) + (joint ? contrib('sp') * (sp.student ? 0 : 1) : 0);
    const key = joint ? 'mfj' : st === 'hoh' ? 'hoh' : 'other';
    const row = F.saversCredit.rows.find(r => agi <= r[key]);
    if (row && amt > 0) saver = Math.round(amt * row.rate);
  }
  S3['4'] = take(saver);
  S3['6z'] = take(Math.round(txP(cr.other) + txP(cr.energy)));
  S3['8'] = S3['1'] + S3['2'] + S3['3'] + S3['4'] + S3['6z'];
  // child tax credit and credit for other dependents (Schedule 8812)
  const ssnFiler = ssnOk || (joint && sp.ssn !== false);
  const ctcKids = nra ? 0 : deps.filter(d => txAge(d.born, year) < 17 && d.ssn !== false && d.rel !== 'other' && (d.months == null || txN(d.months) >= 6) && ssnFiler).length;
  const odcN = nra ? 0 : deps.length - ctcKids;
  S8812['4'] = ctcKids;
  S8812['5'] = ctcKids * F.ctc.perChild;
  S8812['6'] = odcN;
  S8812['7'] = odcN * F.ctc.odc;
  S8812['8'] = S8812['5'] + S8812['7'];
  const ctcOver = Math.max(0, magi - (joint ? F.ctc.phaseStart.mfj : F.ctc.phaseStart.other));
  S8812['10'] = ctcOver > 0 ? Math.ceil(ctcOver / 1000) * 1000 : 0;
  S8812['11'] = S8812['10'] * 0.05;
  S8812['12'] = Math.max(0, S8812['8'] - S8812['11']);
  S8812['13'] = Math.max(0, left); // Credit Limit Worksheet A: line 18 less the Schedule 3 credits taken before it
  S8812['14'] = Math.min(S8812['12'], S8812['13']);
  left -= S8812['14'];
  L['19'] = S8812['14'];
  L['20'] = S3['8'];
  L['21'] = L['19'] + L['20'];
  L['22'] = Math.max(0, L['18'] - L['21']);
  // additional child tax credit (refundable)
  const earned = earnedYouAll + earnedSpAll;
  S8812['16a'] = Math.max(0, S8812['12'] - S8812['14']);
  S8812['16b'] = ctcKids * F.ctc.refundableMax;
  S8812['17'] = Math.min(S8812['16a'], S8812['16b']);
  S8812['18a'] = earned;
  S8812['20'] = Math.max(0, earned - F.ctc.earnedFloor) * F.ctc.refundRate;
  S8812['27'] = Math.round(Math.min(S8812['17'], S8812['20']));
  if (ctcKids >= 3 && S8812['17'] > S8812['20']) notes.push('With three or more children, Schedule 8812 Part II-B (based on social security and Medicare taxes paid) may give a larger additional child tax credit than shown.');

  /* Other taxes (Schedule 2 Part II) */
  S2['4'] = Math.round(seTax);
  S2['8'] = Math.round(0.1 * txP(ira.early));
  const medW = sumW('b5');
  const thr = F.addlMedicare[st];
  const seNe = (seYou[1] || 0) + (seSp[1] || 0);
  const addMed = 0.009 * Math.max(0, medW - thr) + 0.009 * Math.max(0, seNe - Math.max(0, thr - medW));
  S2['11'] = Math.round(addMed);
  const nii = nra ? 0 : L['2b'] + L['3b'] + Math.max(0, L['7a']) + txP(prof.passive);
  S2['12'] = Math.round(nra ? 0 : 0.038 * Math.min(nii, Math.max(0, magi - F.niit[st])));
  S2['21'] = S2['4'] + S2['8'] + S2['11'] + S2['12'];
  L['23'] = S2['21'];
  L['24'] = L['22'] + L['23'];

  /* Payments and refundable credits */
  const pay = prof.pay || {};
  L['25a'] = Math.round(sumW('b2'));
  L['25b'] = Math.round(txP(pay.wh1099) + necs.reduce((a, n) => a + txP(n.wh), 0));
  L['25c'] = Math.round(w2s.reduce((a, w) => a + Math.max(0, txN(w.b6) - 0.0145 * txN(w.b5)), 0));
  L['25d'] = L['25a'] + L['25b'] + L['25c'];
  L['26'] = Math.round((pay.est || []).reduce((a, v) => a + txP(v), 0) + txP(pay.prior));
  // earned income credit
  let eic = 0;
  const kidsEic = deps.filter(d => {
    const a = txAge(d.born, year);
    return d.rel !== 'other' && d.ssn !== false && (a < 19 || (a < 24 && d.student) || d.disabled) && (d.months == null || txN(d.months) >= 6);
  }).length;
  const invInc = L['2a'] + L['2b'] + L['3b'] + Math.max(0, L['7a']);
  const eicAgeOk = kidsEic > 0 || (ageYou >= 25 && ageYou < 65) || (joint && ageSp >= 25 && ageSp < 65);
  const eicBase = !nra && st !== 'mfs' && !you.dep && ssnOk && (!joint || sp.ssn !== false) && invInc <= F.eitc.investmentIncomeLimit;
  if (eicBase && eicAgeOk) eic = txEic(F, st, kidsEic, earned, agi);
  L['27a'] = eic;
  // the federal credit "as if" the age rule were met (New Jersey allows 18+ with no upper age)
  L.eicAsIf = eicBase && !eicAgeOk ? txEic(F, st, kidsEic, earned, agi) : eic;
  L['28'] = S8812['27'];
  L['29'] = aotcRefund;
  // excess social security withheld (two or more employers)
  const excessSs = who => {
    const ws = w2s.filter(w => w.who === who);
    const emps = new Set(ws.map(w => String(w.emp || '').toLowerCase().trim()));
    const tot = ws.reduce((a, w) => a + txN(w.b4), 0);
    const max = F.ss.wageBase * F.ss.employeeRate;
    return emps.size > 1 && tot > max ? tot - max : 0;
  };
  S3['10'] = txP(pay.ext);
  S3['11'] = Math.round(excessSs('you') + (joint ? excessSs('sp') : 0));
  S3['15'] = S3['10'] + S3['11'];
  L['31'] = S3['15'];
  L['32'] = L['27a'] + L['28'] + L['29'] + L['31'];
  L['33'] = L['25d'] + L['26'] + L['32'];
  L['34'] = Math.max(0, L['33'] - L['24']);
  L['37'] = Math.max(0, L['24'] - L['33']);
  // underpayment: a reminder only (Form 2210 figures the penalty)
  if (L['37'] > 1000) {
    const paidIn = L['25d'] + L['26'];
    const prior = txP(prof.priorTax);
    const safe = Math.min(0.9 * L['24'], prior ? (prof.priorAgi > (st === 'mfs' ? 75000 : 150000) ? 1.1 : 1) * prior : Infinity);
    if (paidIn < safe) warn.push('You may owe an underpayment penalty: less than 90% of this year\'s tax' + (prior ? ' (and less than last year\'s tax)' : '') + ' was paid during the year. Form 2210 figures it; paying sooner lowers it.');
  }
  if (deps.length > 4) notes.push('More than four dependents: list the others on a statement with the form.');
  if (L['3a'] > L['3b']) notes.push('Qualified dividends cannot be more than ordinary dividends.');
  const marg = (() => {
    const rows = F.brackets[st];
    let r = rows[0][1];
    for (const row of rows) if (ti > row[0]) r = row[1];
    return r;
  })();
  return { st, nra, resi, joint, L, S1, S1A, S2, S3, SE, S8812, SA, Q, w2s, necs, k1s, pYou, pSp, notes, warn, agi, ti, marg, eff: L['24'] && agi > 0 ? L['24'] / agi : 0, refund: L['34'], owed: L['37'], earned, kidsEic, ctcKids, odcN };
}

/* ---------------------------------------------------------------- New Jersey (NJ-1040, residents) */
function txNJ(D, prof, fed) {
  const N = D.nj;
  const st = fed.st;
  const joint = fed.joint;
  const tableB = ['mfj', 'hoh', 'qss'].includes(st);
  const nj = prof.nj || {};
  const notes = [];
  // NJ gross income: W-2 box 16 (NJ taxes 403(b), 457, Section 125 health premiums, FSA and HSA payroll contributions;
  // only 401(k) deferrals are excluded), interest, dividends, business profit, net gains, pensions/IRAs, S-corp/partnership
  // profit and other income. Unemployment and social security are not taxed; losses in one category stay there.
  const wages = fed.w2s.reduce((a, w) => a + txN(w.b16 != null && w.b16 !== '' ? w.b16 : w.b1), 0);
  const biz = Math.max(0, fed.pYou.net) + Math.max(0, fed.pSp.net);
  const gains = Math.max(0, txN(prof.capST) + txN(prof.capLT) + txP(prof.capDist));
  const pension = fed.L['4b'] + fed.L['5b'];
  const k1 = Math.max(0, fed.S1['5']);
  const gross = wages + fed.L['2b'] + fed.L['3b'] + biz + gains + pension + k1 + Math.max(0, txN(prof.otherInc));
  // pension exclusion (62+ or disabled, NJ total income $150,000 or less)
  let excl = 0;
  const year = D.year;
  const age62 = txAge((prof.you || {}).born, year) >= 62 || (joint && txAge((prof.sp || {}).born, year) >= 62);
  if (age62 && pension > 0 && gross <= 150000) {
    // up to $100,000 joint / $75,000 single, HOH, QW / $50,000 MFS with income up to $100,000; then a share of the pension
    const full = joint ? 100000 : st === 'mfs' ? 50000 : 75000;
    const share = gross <= 125000 ? (joint ? 0.5 : st === 'mfs' ? 0.25 : 0.375) : joint ? 0.25 : st === 'mfs' ? 0.125 : 0.1875;
    excl = gross <= 100000 ? Math.min(pension, full) : pension * share;
  }
  const gi = Math.max(0, gross - excl);
  const thrFile = N.file[st] || N.file.single;
  // exemptions
  const you = prof.you || {};
  const sp = prof.sp || {};
  const deps = (prof.deps || []).filter(d => d && (d.n || d.born));
  let ex = N.ex.regular + (joint ? N.ex.spouse : 0);
  ex += (txAge(you.born, year) >= 65 ? N.ex.age65 : 0) + (joint && txAge(sp.born, year) >= 65 ? N.ex.age65 : 0);
  ex += (you.blind ? N.ex.blind : 0) + (joint && sp.blind ? N.ex.blind : 0);
  ex += (nj.veteranYou ? N.ex.veteran : 0) + (joint && nj.veteranSp ? N.ex.veteran : 0);
  ex += deps.length * N.ex.dependent + deps.filter(d => d.student && txAge(d.born, year) < 22).length * N.ex.collegeStudent;
  const med = Math.max(0, txP((prof.ded || {}).medical) - N.medFloor * gi);
  // property tax: homeowners count the tax; tenants 18% of rent; the deduction (up to $15,000) or the $50 credit
  const propPaid = txP(nj.propTax != null ? nj.propTax : (prof.ded || {}).propTax) + N.prop.renterPct * txP(nj.rent);
  const mfsShare = st === 'mfs' && nj.sameHome;
  const propMax = mfsShare ? N.prop.deductionMaxMfsSameHome : N.prop.deductionMax;
  const propCreditAmt = mfsShare ? N.prop.creditMfsSameHome : N.prop.credit;
  const okProp = propPaid > 0 && (gi > thrFile || txAge(you.born, year) >= 65 || you.blind);
  const taxOf = taxable => {
    const rows = tableB ? N.b : N.a;
    const sub = tableB ? N.bSub : N.aSub;
    let i = 0;
    for (let k = 0; k < rows.length; k++) if (taxable > rows[k][0]) i = k;
    return Math.max(0, taxable * rows[i][1] - sub[i]);
  };
  const base = Math.max(0, gi - ex - med);
  const withDed = okProp ? taxOf(Math.max(0, base - Math.min(propPaid, propMax))) : Infinity;
  const withCredit = taxOf(base);
  const useDed = okProp && withDed + 0 < withCredit - propCreditAmt;
  let taxable = useDed ? Math.max(0, base - Math.min(propPaid, propMax)) : base;
  let tax = gi <= thrFile ? 0 : Math.round(useDed ? withDed : withCredit);
  if (gi <= thrFile) notes.push('NJ gross income at or under $' + thrFile.toLocaleString('en-US') + ': no NJ income tax (file to get back NJ tax withheld or claim the NJ earned income credit).');
  // credit for tax paid to another state (Schedule NJ-COJ)
  let coj = 0;
  if (txP(nj.otherIncome) > 0 && txP(nj.otherTax) > 0 && gi > 0) coj = Math.min(txP(nj.otherTax), tax * Math.min(1, txP(nj.otherIncome) / gi));
  tax = Math.max(0, tax - Math.round(coj));
  // refundable credits
  const propCredit = okProp && !useDed ? propCreditAmt : 0;
  // NJ earned income credit: 40% of the federal credit, from age 18 with no upper age when there is no child
  const adult = txAge(you.born, year) >= 18 || !you.born || (joint && txAge(sp.born, year) >= 18);
  const eitc = fed.kidsEic || adult ? Math.round(N.eitc * txN(fed.L.eicAsIf != null ? fed.L.eicAsIf : fed.L['27a'])) : 0;
  let ctc = 0;
  if (st !== 'mfs') {
    const row = N.ctc.find(r => taxable <= r[0]);
    const kids = deps.filter(d => txAge(d.born, year) <= N.ctcAge).length;
    if (row) ctc = row[1] * kids;
  }
  let care = 0;
  if (fed.L.careAllowed > 0) {
    const row = N.care.find(r => taxable <= r[0]);
    if (row) care = Math.round(fed.L.careAllowed * row[1]);
  }
  const credits = propCredit + eitc + ctc + care;
  const wh = fed.w2s.filter(w => !w.st || String(w.st).toUpperCase() === 'NJ').reduce((a, w) => a + txN(w.b17), 0);
  const est = txP((prof.pay || {}).stateEst);
  const owedTotal = tax;
  const paid = wh + est + credits;
  const lines = { gross: Math.round(gross), excl: Math.round(excl), gi: Math.round(gi), ex, med: Math.round(med), prop: useDed ? Math.round(Math.min(propPaid, propMax)) : 0, taxable: Math.round(taxable), tax: Math.round(tax), coj: Math.round(coj), propCredit, eitc, ctc, care, wh: Math.round(wh), est: Math.round(est) };
  if (fed.S1A && fed.S1A['38'] > 0) notes.push('New Jersey does not follow the federal tips, overtime, car loan interest and senior deductions: that income stays taxable in NJ.');
  if (nj.health === false) notes.push('New Jersey charges a shared responsibility payment for months without health coverage; it is not included here.');
  return {
    code: 'NJ', name: 'New Jersey', full: true, tax: Math.round(owedTotal), credits, paid: Math.round(paid), withheld: Math.round(wh), est: Math.round(est),
    refund: Math.max(0, Math.round(paid - owedTotal)), owed: Math.max(0, Math.round(owedTotal - paid)), lines, notes, local: 0,
  };
}

/* ---------------------------------------------------------------- the other states (rates, deductions, exemptions) */
function txState(D, prof, fed) {
  const code = String(prof.state || '').toUpperCase();
  const s = D.states[code];
  if (!s) return null;
  if (code === 'NJ') return txNJ(D, prof, fed);
  const notes = [];
  const wh = fed.w2s.filter(w => !w.st || String(w.st).toUpperCase() === code).reduce((a, w) => a + txN(w.b17), 0);
  const localWh = fed.w2s.reduce((a, w) => a + txN(w.b19), 0);
  const est = txP((prof.pay || {}).stateEst);
  if (!s.w || s.t === 'none') {
    const paid = wh + est;
    return { code, name: s.n, none: true, tax: 0, credits: 0, paid, withheld: wh, est, refund: Math.round(paid), owed: 0, lines: {}, notes: s.no ? [s.no] : [], local: 0 };
  }
  const st = fed.st;
  const joint = txJointish(st);
  const deps = (prof.deps || []).filter(d => d && (d.n || d.born)).length;
  let start;
  if (s.st === 'federalTaxable') start = fed.ti;
  else if (s.st === 'own') {
    const wages = fed.w2s.reduce((a, w) => a + txN(w.b16 != null && w.b16 !== '' ? w.b16 : w.b1), 0);
    start = wages + fed.L['2b'] + fed.L['3b'] + Math.max(0, fed.pYou.net) + Math.max(0, fed.pSp.net) + Math.max(0, fed.L['7a']) + fed.L['4b'] + fed.L['5b'] + Math.max(0, fed.S1['5']) + Math.max(0, txN(prof.otherInc));
  } else start = fed.agi;
  const std = s.st !== 'federalTaxable' && s.sd.k === 'deduction' ? (joint ? s.sd.m : s.sd.s) : 0;
  const exDed = s.ex.k === 'deduction' ? (joint ? s.ex.m : s.ex.s) : 0;
  const depDed = s.ex.dk === 'deduction' ? s.ex.d * deps : 0;
  const taxable = Math.max(0, start - std - exDed - depDed);
  let tax = txSched(joint ? s.b.m : s.b.s, taxable);
  const stdCredit = s.sd.k === 'credit' ? (joint ? s.sd.m : s.sd.s) : 0;
  const exCredit = (s.ex.k === 'credit' ? (joint ? s.ex.m : s.ex.s) : 0) + (s.ex.dk === 'credit' ? s.ex.d * deps : 0);
  const other = txP((prof.oth || {}).stateCredits);
  const otherState = Math.min(txP((prof.oth || {}).otherStateTax), tax);
  tax = Math.max(0, tax - stdCredit - exCredit - other - otherState);
  const localRate = txP(prof.local) / 100;
  const local = Math.round(localRate * fed.w2s.reduce((a, w) => a + txN(w.b16 != null && w.b16 !== '' ? w.b16 : w.b1), 0));
  if (st === 'hoh' || st === 'mfs') notes.push((st === 'hoh' ? 'Head of household' : 'Married filing separately') + ': figured with the state\'s single-filer rates and amounts; many states have their own.');
  if (s.no) notes.push(s.no);
  if (s.lo && !localRate && !/^(none|no local)/i.test(s.lo)) notes.push('Local income tax: ' + s.lo);
  const paid = wh + localWh + est;
  const total = tax + local;
  return {
    code, name: s.n, tax: Math.round(tax), local, credits: Math.round(stdCredit + exCredit + other + otherState), paid: Math.round(paid), withheld: Math.round(wh + localWh), est: Math.round(est),
    refund: Math.max(0, Math.round(paid - total)), owed: Math.max(0, Math.round(total - paid)),
    lines: { start: Math.round(start), startKind: s.st, std, ex: exDed + depDed, taxable: Math.round(taxable) }, notes, approx: true,
  };
}

/* ---------------------------------------------------------------- the whole estimate */
function txEstimate(D, prof, facts) {
  prof = prof || {};
  const fed = txFederal(D, prof, facts || {});
  const state = prof.state ? txState(D, prof, fed) : null;
  const net = fed.refund - fed.owed + (state ? state.refund - state.owed : 0);
  return { year: D.year, fed, state, net };
}
/* The same estimate with one change, for "what if" answers (e.g. one more dependent, an IRA contribution). */
function txWhatIf(D, prof, facts, change) {
  const p2 = JSON.parse(JSON.stringify(prof || {}));
  change(p2);
  return txEstimate(D, p2, facts);
}
/* How to land near $0 owed for the current year: extra withholding per remaining paycheck (W-4 Step 4c), or what can
   come off. Positive = withhold more; negative = could withhold less. */
function txW4Advice(est, paychecksLeft) {
  const gap = est.fed.owed - est.fed.refund;
  if (!paychecksLeft || paychecksLeft < 1) return { gap, perCheck: 0 };
  return { gap, perCheck: Math.round(gap / paychecksLeft) };
}
if (typeof module !== 'undefined' && module.exports) module.exports = { txEstimate, txFederal, txNJ, txState, txSched, txTableTax, txQdcg, txSocialSecurity, txEic, txResidency, txWhatIf, txW4Advice };
