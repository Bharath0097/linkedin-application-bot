// v40 tax center: the 2025 IRS forms filled in from an estimate (taxforms.js on the forms in assets/tax/forms/2025).
// A busy return: married filing jointly in New Jersey, a W-2 and a 1099 business, two children, overtime, a spouse over
// 65, student loan interest, estimated payments. Each form is read back field by field.  node --test _source/tests/
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const site = path.join(__dirname, '..', '..');
const PDFLib = require(path.join(site, 'js/vendor/pdf-lib.min.js'));
const T = require(path.join(site, '_source/src/taxcalc.js'));
const src = fs.readFileSync(path.join(site, '_source/src/taxforms.js'), 'utf8');
const m = { exports: {} };
new Function('module', 'exports', 'loadPdfLib', 'fetch', 'APP_BUILD', src)(m, m.exports, async () => PDFLib, null, 'test');
const { txBuildReturn, TX_MAP_2025 } = m.exports;
const D = JSON.parse(fs.readFileSync(path.join(site, 'assets/tax/2025.json'), 'utf8'));
const getBytes = async (y, f) => fs.readFileSync(path.join(site, 'assets/tax/forms', String(y), f + '.pdf'));
const prof = {
  status: 'mfj',
  state: 'NJ',
  you: { born: 1980 },
  sp: { born: 1959 },
  deps: [
    { n: 'Asha Kumar', born: 2015, rel: 'child', relText: 'Daughter' },
    { n: 'Ravi Kumar', born: 2008, rel: 'child', relText: 'Son', student: true },
  ],
  w2: [{ emp: 'StratEdge', b1: 95000, b2: 8000, b3: 95000, b4: 5890, b5: 95000, b6: 1377.5, b16: 98000, b17: 3100, st: 'NJ' }],
  nec: [{ payer: 'Client Co', amt: 40000 }],
  biz: { you: { exp: 4000 } },
  otPrem: 3000,
  int: 800,
  divOrd: 1200,
  divQual: 1000,
  adj: { studentLoan: 1800 },
  pay: { est: [1000, 1000, 1000, 1000] },
};
const pii = { first: 'Sam K', last: 'Kumar', ssn: '400001234', spFirst: 'Lata', spLast: 'Kumar', spSsn: '400001235', addr: '10 Main St', apt: '2B', city: 'Somerset', state: 'NJ', zip: '08873', occ: 'Engineer', spOcc: 'Retired', phone: '7325550100', email: 'sam@example.com', routing: '021000021', account: '123456789', acctType: 'checking', depSsn: ['400001236', '400001237'], digital: 'no' };

let built = null;
const build = async () => {
  if (!built) {
    const est = T.txEstimate(D, prof, {});
    built = { est, out: await txBuildReturn(est, prof, pii, { lib: PDFLib, getBytes, data: D }) };
  }
  return built;
};
const read = async (bytes, form) => {
  const doc = await PDFLib.PDFDocument.load(bytes);
  const f = doc.getForm();
  const map = TX_MAP_2025[form];
  const full = n => (/^(form1|topmostSubform)\[/.test(n) ? n : 'topmostSubform[0].' + n);
  return {
    t: k => f.getTextField(full(map[k])).getText() || '',
    c: k => f.getCheckBox(full(map[k])).isChecked(),
  };
};
const part = (out, form, i) => out.parts.filter(p => p.form === form)[i || 0];

test('the forms the return needs, in the IRS attachment order', async () => {
  const { out } = await build();
  assert.deepStrictEqual(out.forms, ['f1040', 'f1040s1', 'f1040s1a', 'f1040s2', 'f1040sc', 'f1040sse', 'f1040s8', 'f8995']);
  const merged = await PDFLib.PDFDocument.load(out.merged);
  assert.strictEqual(merged.getPageCount(), 15);
  assert.strictEqual(merged.getForm().getFields().length, 0, 'the printing copy is flattened');
});

test('Form 1040: who, filing status, dependents, income, tax, payments, refund', async () => {
  const { est, out } = await build();
  const r = await read(part(out, 'f1040').bytes, 'f1040');
  assert.strictEqual(r.t('first'), 'Sam K');
  assert.strictEqual(r.t('ssn'), '400001234');
  assert.strictEqual(r.t('spSsn'), '400001235');
  assert.strictEqual(r.t('zip'), '08873');
  assert.ok(r.c('st_mfj') && !r.c('st_single'));
  assert.ok(r.c('digNo') && !r.c('digYes'));
  assert.strictEqual(r.t('dep1First'), 'Asha');
  assert.strictEqual(r.t('dep1Ssn'), '400001236');
  assert.ok(r.c('dep1Ctc'), 'a child under 17: the child tax credit box');
  assert.ok(r.c('dep2Odc'), 'a 17-year-old: the credit for other dependents box');
  assert.ok(r.c('L12dSpBorn') && !r.c('L12dYouBorn'), 'the spouse was born before January 2, 1961');
  assert.strictEqual(r.t('L1a'), '95000');
  assert.strictEqual(r.t('L2b'), '800');
  assert.strictEqual(r.t('L3a'), '1000');
  assert.strictEqual(r.t('L3b'), '1200');
  assert.strictEqual(r.t('L11a'), String(Math.round(est.fed.L['11'])));
  assert.strictEqual(r.t('L13a'), String(Math.round(est.fed.L.qbi)), '2025: line 13a is the QBI deduction');
  assert.strictEqual(r.t('L13b'), '9000', '2025: line 13b is Schedule 1-A (overtime 3,000 + senior 6,000)');
  assert.strictEqual(r.t('L16'), String(est.fed.L['16']));
  assert.strictEqual(r.t('L25a'), '8000');
  assert.strictEqual(r.t('L26'), '4000');
  assert.strictEqual(r.t('L34'), String(est.fed.L['34']));
  assert.ok(est.fed.L['34'] > 0, 'a refund');
  assert.strictEqual(r.t('routing'), '021000021');
  assert.ok(r.c('checking'));
  assert.ok(r.c('tpNo'));
});

test('Schedules 1, 1-A, 2, SE and C and Form 8995 agree with the estimate', async () => {
  const { est, out } = await build();
  const F = est.fed;
  const s1 = await read(part(out, 'f1040s1').bytes, 'f1040s1');
  assert.strictEqual(s1.t('L3'), '36000');
  assert.strictEqual(s1.t('L15'), String(Math.round(F.S1['15'])));
  assert.strictEqual(s1.t('L21'), '1800');
  const a = await read(part(out, 'f1040s1a').bytes, 'f1040s1a');
  assert.strictEqual(a.t('L14a'), '3000');
  assert.strictEqual(a.t('L21'), '3000');
  assert.strictEqual(a.t('L36b'), '6000');
  assert.strictEqual(a.t('L36a'), '', 'not 65: no senior deduction for the filer');
  assert.strictEqual(a.t('L38'), '9000');
  assert.strictEqual(a.t('L19'), '', 'under the limit: the division lines stay blank');
  const s2 = await read(part(out, 'f1040s2').bytes, 'f1040s2');
  assert.strictEqual(s2.t('L4'), String(F.S2['4']));
  assert.strictEqual(s2.t('L21'), String(F.S2['21']));
  const se = await read(part(out, 'f1040sse').bytes, 'f1040sse');
  assert.strictEqual(se.t('L2'), '36000');
  assert.strictEqual(se.t('L8a'), '95000');
  assert.strictEqual(se.t('L12'), String(Math.round(F.SE.you.tax)));
  const sc = await read(part(out, 'f1040sc').bytes, 'f1040sc');
  assert.strictEqual(sc.t('L1'), '40000');
  assert.strictEqual(sc.t('L28'), '4000');
  assert.strictEqual(sc.t('L31'), '36000');
  assert.strictEqual(sc.t('B'), '541510');
  const q = await read(part(out, 'f8995').bytes, 'f8995');
  assert.strictEqual(q.t('L15'), String(Math.round(F.L.qbi)));
  const c = await read(part(out, 'f1040s8').bytes, 'f1040s8');
  assert.strictEqual(c.t('L13'), String(Math.round(F.S8812['13'])), 'Credit Limit Worksheet A');
  assert.strictEqual(c.t('L14'), String(Math.round(F.S8812['14'])));
  assert.strictEqual(c.t('L16b'), '', 'no additional child tax credit: Part II-A stays blank');
});

test('without a refund there is no bank account on the form; a single filer has no spouse fields', async () => {
  const p2 = { status: 'single', state: 'NJ', you: { born: 1990 }, w2: [{ emp: 'X', b1: 60000, b2: 5000, b3: 60000, b5: 60000, b16: 60000, b17: 1500 }] };
  const est = T.txEstimate(D, p2, {});
  const out = await txBuildReturn(est, p2, { ...pii, spFirst: 'Nobody', spSsn: '999999999' }, { lib: PDFLib, getBytes, data: D });
  assert.deepStrictEqual(out.forms, ['f1040']);
  const r = await read(out.parts[0].bytes, 'f1040');
  assert.ok(r.c('st_single'));
  assert.strictEqual(r.t('spSsn'), '');
  if (est.fed.L['34'] > 0) assert.strictEqual(r.t('routing'), '021000021');
  else assert.strictEqual(r.t('routing'), '');
});
