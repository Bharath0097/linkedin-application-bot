// v40 tax center: the estimate engine against figures worked by hand from the IRS and NJ rules (each case shows its
// arithmetic). Run: node --test _source/tests/taxcalc.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const T = require('../src/taxcalc.js');
const D25 = JSON.parse(fs.readFileSync(path.join(__dirname, '../../assets/tax/2025.json'), 'utf8'));
const D26 = JSON.parse(fs.readFileSync(path.join(__dirname, '../../assets/tax/2026.json'), 'utf8'));
const W2 = (b1, extra) => ({ emp: 'A', b1, b2: 0, b3: b1, b4: +(b1 * 0.062).toFixed(2), b5: b1, b6: +(b1 * 0.0145).toFixed(2), ...(extra || {}) });

test('tax table: the tax at the middle of the $50 row under $100,000; the schedule from $100,000', () => {
  const r = D25.fed.brackets.single;
  // 59,275 midpoint: 1,192.50 + 12% x 36,550 + 22% x 10,800 = 7,954.50 -> 7,955
  assert.equal(T.txTableTax(r, 59250), 7955);
  assert.equal(T.txTableTax(r, 59299.99), 7955);
  // 99,975 midpoint: 5,578.50 + 22% x 51,500 = 16,908.50 -> 16,909; 100,000 exactly: 5,578.50 + 22% x 51,525 = 16,914
  assert.equal(T.txTableTax(r, 99999), 16909);
  assert.equal(Math.round(T.txTableTax(r, 100000)), 16914);
  assert.equal(T.txTableTax(r, 4), 0);
  assert.equal(T.txTableTax(r, 10), 1); // $5-$15 row, tax on $10
});

test('single, $75,000 of wages, 2025: federal $7,955 on $59,250; New Jersey $2,651', () => {
  const e = T.txEstimate(D25, { status: 'single', state: 'NJ', you: { born: 1990 }, w2: [W2(75000, { b2: 7000, b16: 76000, b17: 2500, st: 'NJ' })] }, {});
  assert.equal(e.fed.ti, 59250);
  assert.equal(e.fed.L['16'], 7955);
  assert.equal(e.fed.owed, 955);
  // NJ: 76,000 - 1,000 exemption = 75,000 x 5.525% - 1,492.50 = 2,651.25
  assert.equal(e.state.lines.taxable, 75000);
  assert.equal(e.state.tax, 2651);
  assert.equal(e.state.owed, 151);
});

test('married, two children, $120,000 of wages, 2025: child tax credit $4,400, refund $3,254', () => {
  const e = T.txEstimate(D25, { status: 'mfj', you: { born: 1988 }, sp: { born: 1989 }, deps: [{ n: 'A', born: 2016 }, { n: 'B', born: 2019 }], w2: [W2(120000, { b2: 9000 })] }, {});
  // TI 88,500 -> midpoint 88,525: 2,385 + 12% x 64,675 = 10,146
  assert.equal(e.fed.L['16'], 10146);
  assert.equal(e.fed.L['19'], 4400);
  assert.equal(e.fed.L['24'], 5746);
  assert.equal(e.fed.refund, 3254);
});

test('1099 consultant, 2025: self-employment tax, half of it off, the QBI deduction', () => {
  const e = T.txEstimate(D25, { status: 'single', you: { born: 1985 }, nec: [{ payer: 'Client', amt: 100000 }], biz: { you: { exp: 10000 } } }, {});
  // net 90,000; x 92.35% = 83,115; 12.4% + 2.9% = 12,716.60
  assert.equal(e.fed.S2['4'], 12717);
  assert.ok(Math.abs(e.fed.agi - 83641.7) < 0.02, String(e.fed.agi));
  // QBI: 20% of 83,641.70 = 16,728.34, limited to 20% of 67,891.70 = 13,578.34
  assert.ok(Math.abs(e.fed.L.qbi - 13578.34) < 0.02, String(e.fed.L.qbi));
  // TI 54,313.36 -> midpoint 54,325: 1,192.50 + 4,386 + 22% x 5,850 = 6,865.50 -> 6,866
  assert.equal(e.fed.L['16'], 6866);
  assert.equal(e.fed.L['24'], 6866 + 12717);
});

test('no tax on overtime (Schedule 1-A), 2025', () => {
  const e = T.txEstimate(D25, { status: 'single', you: { born: 1990 }, w2: [W2(60000)], otPrem: 5000 }, {});
  assert.equal(e.fed.S1A['21'], 5000);
  // 60,000 - 15,750 - 5,000 = 39,250 -> midpoint 39,275: 1,192.50 + 12% x 27,350 = 4,474.50 -> 4,475
  assert.equal(e.fed.ti, 39250);
  assert.equal(e.fed.L['16'], 4475);
  // over $150,000: $100 off per full $1,000 over
  const hi = T.txEstimate(D25, { status: 'single', you: { born: 1990 }, w2: [W2(160500)], otPrem: 5000 }, {});
  assert.equal(hi.fed.S1A['21'], 4000);
  // married filing separately cannot take it
  const mfs = T.txEstimate(D25, { status: 'mfs', you: { born: 1990 }, w2: [W2(60000)], otPrem: 5000 }, {});
  assert.equal(mfs.fed.S1A['21'], 0);
});

test('seniors, 2025: social security worksheet, extra standard deduction and the $6,000 senior deduction each', () => {
  const e = T.txEstimate(D25, { status: 'mfj', you: { born: 1959 }, sp: { born: 1958 }, ss: 40000, pens: { gross: 50000, taxable: 50000 } }, {});
  assert.equal(Math.round(e.fed.L['6b']), 28100);
  assert.equal(e.fed.L.std, 31500 + 2 * 1600);
  assert.equal(e.fed.S1A['37'], 12000);
  // 78,100 - 34,700 - 12,000 = 31,400 -> midpoint 31,425: 2,385 + 12% x 7,575 = 3,294
  assert.equal(e.fed.L['16'], 3294);
});

test('earned income credit and additional child tax credit, head of household, one child, 2025', () => {
  const e = T.txEstimate(D25, { status: 'hoh', you: { born: 1992 }, deps: [{ n: 'K', born: 2020 }], w2: [W2(20000, { b2: 300 })] }, {});
  assert.equal(e.fed.L['27a'], 4328);
  assert.equal(e.fed.L['28'], 1700);
  assert.equal(e.fed.refund, 300 + 4328 + 1700);
  // phase-out: $35,000 -> midpoint 35,025: 4,328.20 - 15.98% x 11,675 = 2,462.54 -> 2,463
  const p = T.txEstimate(D25, { status: 'hoh', you: { born: 1992 }, deps: [{ n: 'K', born: 2020 }], w2: [W2(35000)] }, {});
  assert.equal(p.fed.L['27a'], 2463);
});

test('long-term gains in the 0% band, 2025', () => {
  const e = T.txEstimate(D25, { status: 'single', you: { born: 1990 }, w2: [W2(50000)], capLT: 10000 }, {});
  // TI 44,250, of which 10,000 at 0%; tax on 34,250 (midpoint 34,275): 1,192.50 + 12% x 22,350 = 3,874.50 -> 3,875
  assert.equal(e.fed.ti, 44250);
  assert.equal(e.fed.L['16'], 3875);
});

test('nonresident alien (F-1 student from India): standard deduction only under the treaty', () => {
  const base = { status: 'single', visa: 'OPT', firstYear: 2023, you: { born: 2000 }, w2: [W2(30000)] };
  const e = T.txEstimate(D25, { ...base, indiaTreaty: true }, {});
  assert.equal(e.fed.nra, true);
  // 30,000 - 15,750 = 14,250 -> midpoint 14,275: 1,192.50 + 12% x 2,350 = 1,474.50 -> 1,475
  assert.equal(e.fed.L['16'], 1475);
  const n = T.txEstimate(D25, base, {});
  // no standard deduction: 30,000 -> midpoint 30,025: 1,192.50 + 12% x 18,100 = 3,364.50 -> 3,365
  assert.equal(n.fed.L['16'], 3365);
  assert.equal(n.fed.L['27a'], 0);
});

test('SALT cap phases down to $10,000 at high income, 2025', () => {
  const e = T.txEstimate(D25, { status: 'mfj', you: { born: 1980 }, w2: [W2(600000, { b17: 50000 })], ded: { propTax: 20000, mode: 'itemized' } }, {});
  assert.equal(e.fed.SA['5e'], 10000);
  const mid = T.txEstimate(D25, { status: 'mfj', you: { born: 1980 }, w2: [W2(300000, { b17: 30000 })], ded: { propTax: 15000, mode: 'itemized' } }, {});
  assert.equal(mid.fed.SA['5e'], 40000);
});

test('2026: new brackets and standard deduction; cash gifts for people who do not itemize', () => {
  const e = T.txEstimate(D26, { status: 'single', you: { born: 1990 }, w2: [W2(75000)], ded: { charityCash: 1500 } }, {});
  assert.equal(e.fed.L['12f'], 1000);
  // 75,000 - 16,100 - 1,000 = 57,900 -> midpoint 57,925: 1,240 + 4,560 + 22% x 7,525 = 7,455.50 -> 7,456
  assert.equal(e.fed.ti, 57900);
  assert.equal(e.fed.L['16'], 7456);
});

test('child tax credit phase-out ($50 per $1,000 over $400,000 joint, rounded up)', () => {
  const e = T.txEstimate(D25, { status: 'mfj', you: { born: 1980 }, deps: [{ n: 'A', born: 2015 }, { n: 'B', born: 2017 }], w2: [W2(450000)] }, {});
  assert.equal(e.fed.S8812['12'], 4400 - 2500);
  const r = T.txEstimate(D25, { status: 'mfj', you: { born: 1980 }, deps: [{ n: 'A', born: 2015 }], w2: [W2(400001)] }, {});
  assert.equal(r.fed.S8812['11'], 50);
});

test('additional Medicare tax and what payroll already withheld for it', () => {
  const e = T.txEstimate(D25, { status: 'single', you: { born: 1980 }, w2: [W2(250000, { b6: 3625 + 450 })] }, {});
  assert.equal(e.fed.S2['11'], 450);
  assert.equal(e.fed.L['25c'], 450);
});

test('self-employment tax stops at the social security wage base (W-2 wages count first)', () => {
  const e = T.txEstimate(D25, { status: 'single', you: { born: 1980 }, w2: [W2(170000)], nec: [{ amt: 50000 }] }, {});
  // 46,175 x 2.9% = 1,339.08 + 12.4% x (176,100 - 170,000) = 756.40 -> 2,095
  assert.equal(e.fed.S2['4'], 2095);
});

test('excess social security from two employers comes back (Schedule 3, line 11)', () => {
  const e = T.txEstimate(D25, { status: 'single', you: { born: 1980 }, w2: [W2(100000, { emp: 'One', b4: 6200 }), W2(90000, { emp: 'Two', b4: 5580 })] }, {});
  // 11,780 - 176,100 x 6.2% (10,918.20) = 861.80
  assert.equal(e.fed.S3['11'], 862);
});

test('dependent care: 20% in 2025; 35% at $100,000 joint in 2026', () => {
  const p = { status: 'mfj', you: { born: 1985 }, sp: { born: 1986 }, deps: [{ n: 'A', born: 2020 }, { n: 'B', born: 2022 }], w2: [W2(60000), W2(40000, { who: 'sp', emp: 'B' })], cred: { careCost: 8000, careKids: 2 } };
  assert.equal(T.txEstimate(D25, p, {}).fed.S3['2'], 1200);
  assert.equal(T.txEstimate(D26, p, {}).fed.L.careAllowed, 2100);
});

test('student loan interest and IRA deductions phase out with income, 2025', () => {
  const s = T.txEstimate(D25, { status: 'single', you: { born: 1990 }, w2: [W2(92500)], adj: { studentLoan: 2500 } }, {});
  assert.equal(s.fed.S1['21'], 1250);
  // covered by a workplace plan, $84,000: $7,000 x 5,000/10,000 = $3,500
  const i = T.txEstimate(D25, { status: 'single', you: { born: 1990 }, w2: [W2(84000, { b12d: 5000 })], adj: { ira: 7000 } }, {});
  assert.equal(i.fed.S1['20'], 3500);
});

test('Ohio 2026: the schedule\'s $332 base above $26,050', () => {
  assert.equal(T.txSched(D26.states.OH.b.s, 50000), 332 + 0.0275 * (50000 - 26050));
});

test('California 2025, single, $100,000: brackets less the $153 exemption credit', () => {
  const e = T.txEstimate(D25, { status: 'single', state: 'CA', you: { born: 1990 }, w2: [W2(100000, { st: 'CA' })] }, {});
  // 94,294 taxable: 110.79 + 303.70 + 607.52 + 965.40 + 1,214.56 + 9.3% x 21,570 = 5,207.98; - 153
  assert.equal(e.state.tax, 5055);
});

test('New Jersey: property tax deduction when it beats the $50 credit; the NJ child tax credit and earned income credit', () => {
  const e = T.txEstimate(D25, { status: 'mfj', state: 'NJ', you: { born: 1985 }, sp: { born: 1986 }, deps: [{ n: 'A', born: 2022 }, { n: 'B', born: 2017 }], w2: [W2(150000, { b16: 150000, st: 'NJ' })], nj: { propTax: 12000 } }, {});
  // 150,000 - 5,000 exemptions - 12,000 = 133,000 x 5.525% - 2,775 = 4,573.25
  assert.equal(e.state.lines.prop, 12000);
  assert.equal(e.state.tax, 4573);
  assert.equal(e.state.lines.ctc, 0);
  const low = T.txEstimate(D25, { status: 'hoh', state: 'NJ', you: { born: 1992 }, deps: [{ n: 'K', born: 2021 }], w2: [W2(35000, { b16: 35000, st: 'NJ' })] }, {});
  // 35,000 - 2,500 = 32,500 x 1.75% - 70 = 498.75; NJ CTC $800 (taxable income $30,001-$40,000); NJEITC 40% of 2,463
  assert.equal(low.state.tax, 499);
  assert.equal(low.state.lines.ctc, 800);
  assert.equal(low.state.lines.eitc, 985);
  // 2026: the NJ child tax credit is 25% higher
  const l26 = T.txEstimate(D26, { status: 'hoh', state: 'NJ', you: { born: 1992 }, deps: [{ n: 'K', born: 2022 }], w2: [W2(35000, { b16: 35000, st: 'NJ' })] }, {});
  assert.equal(l26.state.lines.ctc, 1000);
});

test('no-income-tax state: what was withheld comes back, nothing else', () => {
  const e = T.txEstimate(D25, { status: 'single', state: 'TX', you: { born: 1990 }, w2: [W2(80000)] }, {});
  assert.equal(e.state.none, true);
  assert.equal(e.state.tax, 0);
});

test('residency suggestion: OPT in the first five years is nonresident; H-1B is resident', () => {
  assert.equal(T.txResidency({ visa: 'STEM OPT', firstYear: 2022 }, 2025).res, 'nonresident');
  assert.equal(T.txResidency({ visa: 'OPT', firstYear: 2019 }, 2025).res, 'resident');
  assert.equal(T.txResidency({ visa: 'H-1B', firstYear: 2020 }, 2025).res, 'resident');
});
