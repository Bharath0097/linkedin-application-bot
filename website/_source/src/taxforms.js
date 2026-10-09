/* ================= v40 Tax center: the 2025 federal forms, filled in =================
   The IRS's own fillable PDFs (assets/tax/forms/2025, downloaded from irs.gov/pub/irs-prior) filled in from the
   estimate with pdf-lib: Form 1040 and, when needed, Schedules 1, 1-A, 2, 3, 8812, SE and C and Form 8995. Names,
   social security numbers, the address and the bank account for the refund are typed in the browser just before and go
   only into the PDF (never to the server). The field names come from the forms' own field descriptions
   (_source/tax/forms-map.py style extraction; see the v40 notes). The forms stay fillable so anything can be fixed
   in a PDF reader before printing or filing. */
const TX_MAP_2025 = {"f1040":{"first":"Page1[0].f1_14[0]","last":"Page1[0].f1_15[0]","ssn":"Page1[0].f1_16[0]","spFirst":"Page1[0].f1_17[0]","spLast":"Page1[0].f1_18[0]","spSsn":"Page1[0].f1_19[0]","addr":"Page1[0].Address_ReadOrder[0].f1_20[0]","apt":"Page1[0].Address_ReadOrder[0].f1_21[0]","city":"Page1[0].Address_ReadOrder[0].f1_22[0]","state":"Page1[0].Address_ReadOrder[0].f1_23[0]","zip":"Page1[0].Address_ReadOrder[0].f1_24[0]","usHome":"Page1[0].c1_5[0]","st_single":"Page1[0].Checkbox_ReadOrder[0].c1_8[0]","st_mfj":"Page1[0].Checkbox_ReadOrder[0].c1_8[1]","st_mfs":"Page1[0].Checkbox_ReadOrder[0].c1_8[2]","mfsName":"Page1[0].Checkbox_ReadOrder[0].f1_28[0]","st_hoh":"Page1[0].c1_8[0]","st_qss":"Page1[0].c1_8[1]","hohChild":"Page1[0].f1_29[0]","digYes":"Page1[0].c1_10[0]","digNo":"Page1[0].c1_10[1]","depMore":"Page1[0].Dependents_ReadOrder[0].c1_11[0]","L1a":"Page1[0].f1_47[0]","L1z":"Page1[0].f1_57[0]","L2a":"Page1[0].f1_58[0]","L2b":"Page1[0].f1_59[0]","L3a":"Page1[0].f1_60[0]","L3b":"Page1[0].f1_61[0]","L4a":"Page1[0].f1_62[0]","L4b":"Page1[0].f1_63[0]","L5a":"Page1[0].f1_65[0]","L5b":"Page1[0].f1_66[0]","L6a":"Page1[0].f1_68[0]","L6b":"Page1[0].f1_69[0]","L7a":"Page1[0].f1_70[0]","L7bNoD":"Page1[0].c1_43[0]","L8":"Page1[0].f1_72[0]","L9":"Page1[0].f1_73[0]","L10":"Page1[0].f1_74[0]","L11a":"Page1[0].f1_75[0]","L11b":"Page2[0].f2_01[0]","L12aYou":"Page2[0].c2_1[0]","L12aSp":"Page2[0].c2_2[0]","L12b":"Page2[0].c2_3[0]","L12dYouBorn":"Page2[0].c2_5[0]","L12dYouBlind":"Page2[0].c2_6[0]","L12dSpBorn":"Page2[0].c2_7[0]","L12dSpBlind":"Page2[0].c2_8[0]","L12e":"Page2[0].f2_02[0]","L13a":"Page2[0].f2_03[0]","L13b":"Page2[0].f2_04[0]","L14":"Page2[0].f2_05[0]","L15":"Page2[0].f2_06[0]","L16":"Page2[0].f2_08[0]","L17":"Page2[0].f2_09[0]","L18":"Page2[0].f2_10[0]","L19":"Page2[0].f2_11[0]","L20":"Page2[0].f2_12[0]","L21":"Page2[0].f2_13[0]","L22":"Page2[0].f2_14[0]","L23":"Page2[0].f2_15[0]","L24":"Page2[0].f2_16[0]","L25a":"Page2[0].f2_17[0]","L25b":"Page2[0].f2_18[0]","L25c":"Page2[0].f2_19[0]","L25d":"Page2[0].f2_20[0]","L26":"Page2[0].f2_21[0]","L27a":"Page2[0].f2_23[0]","L28":"Page2[0].f2_24[0]","L29":"Page2[0].f2_25[0]","L30":"Page2[0].f2_26[0]","L31":"Page2[0].f2_27[0]","L32":"Page2[0].f2_28[0]","L33":"Page2[0].f2_29[0]","L34":"Page2[0].f2_30[0]","L35a":"Page2[0].f2_31[0]","routing":"Page2[0].RoutingNo[0].f2_32[0]","checking":"Page2[0].c2_16[0]","savings":"Page2[0].c2_16[1]","account":"Page2[0].AccountNo[0].f2_33[0]","L36":"Page2[0].f2_34[0]","L37":"Page2[0].f2_35[0]","L38":"Page2[0].f2_36[0]","tpNo":"Page2[0].c2_17[1]","occ":"Page2[0].f2_40[0]","ipPin":"Page2[0].f2_41[0]","spOcc":"Page2[0].f2_42[0]","spIpPin":"Page2[0].f2_43[0]","phone":"Page2[0].f2_44[0]","email":"Page2[0].f2_45[0]","dep1First":"Page1[0].Table_Dependents[0].Row1[0].f1_31[0]","dep1Last":"Page1[0].Table_Dependents[0].Row2[0].f1_35[0]","dep1Ssn":"Page1[0].Table_Dependents[0].Row3[0].f1_39[0]","dep1Rel":"Page1[0].Table_Dependents[0].Row4[0].f1_43[0]","dep1Lived":"Page1[0].Table_Dependents[0].Row5[0].Dependent1[0].c1_12[0]","dep1Us":"Page1[0].Table_Dependents[0].Row5[0].Dependent1[0].c1_13[0]","dep1Student":"Page1[0].Table_Dependents[0].Row6[0].Dependent1[0].c1_20[0]","dep1Disabled":"Page1[0].Table_Dependents[0].Row6[0].Dependent1[0].c1_21[0]","dep1Ctc":"Page1[0].Table_Dependents[0].Row7[0].Dependent1[0].c1_28[0]","dep1Odc":"Page1[0].Table_Dependents[0].Row7[0].Dependent1[0].c1_28[1]","dep2First":"Page1[0].Table_Dependents[0].Row1[0].f1_32[0]","dep2Last":"Page1[0].Table_Dependents[0].Row2[0].f1_36[0]","dep2Ssn":"Page1[0].Table_Dependents[0].Row3[0].f1_40[0]","dep2Rel":"Page1[0].Table_Dependents[0].Row4[0].f1_44[0]","dep2Lived":"Page1[0].Table_Dependents[0].Row5[0].Dependent2[0].c1_14[0]","dep2Us":"Page1[0].Table_Dependents[0].Row5[0].Dependent2[0].c1_15[0]","dep2Student":"Page1[0].Table_Dependents[0].Row6[0].Dependent2[0].c1_22[0]","dep2Disabled":"Page1[0].Table_Dependents[0].Row6[0].Dependent2[0].c1_23[0]","dep2Ctc":"Page1[0].Table_Dependents[0].Row7[0].Dependent2[0].c1_29[0]","dep2Odc":"Page1[0].Table_Dependents[0].Row7[0].Dependent2[0].c1_29[1]","dep3First":"Page1[0].Table_Dependents[0].Row1[0].f1_33[0]","dep3Last":"Page1[0].Table_Dependents[0].Row2[0].f1_37[0]","dep3Ssn":"Page1[0].Table_Dependents[0].Row3[0].f1_41[0]","dep3Rel":"Page1[0].Table_Dependents[0].Row4[0].f1_45[0]","dep3Lived":"Page1[0].Table_Dependents[0].Row5[0].Dependent3[0].c1_16[0]","dep3Us":"Page1[0].Table_Dependents[0].Row5[0].Dependent3[0].c1_17[0]","dep3Student":"Page1[0].Table_Dependents[0].Row6[0].Dependent3[0].c1_24[0]","dep3Disabled":"Page1[0].Table_Dependents[0].Row6[0].Dependent3[0].c1_25[0]","dep3Ctc":"Page1[0].Table_Dependents[0].Row7[0].Dependent3[0].c1_30[0]","dep3Odc":"Page1[0].Table_Dependents[0].Row7[0].Dependent3[0].c1_30[1]","dep4First":"Page1[0].Table_Dependents[0].Row1[0].f1_34[0]","dep4Last":"Page1[0].Table_Dependents[0].Row2[0].f1_38[0]","dep4Ssn":"Page1[0].Table_Dependents[0].Row3[0].f1_42[0]","dep4Rel":"Page1[0].Table_Dependents[0].Row4[0].f1_46[0]","dep4Lived":"Page1[0].Table_Dependents[0].Row5[0].Dependent4[0].c1_18[0]","dep4Us":"Page1[0].Table_Dependents[0].Row5[0].Dependent4[0].c1_19[0]","dep4Student":"Page1[0].Table_Dependents[0].Row6[0].Dependent4[0].c1_26[0]","dep4Disabled":"Page1[0].Table_Dependents[0].Row6[0].Dependent4[0].c1_27[0]","dep4Ctc":"Page1[0].Table_Dependents[0].Row7[0].Dependent4[0].c1_31[0]","dep4Odc":"Page1[0].Table_Dependents[0].Row7[0].Dependent4[0].c1_31[1]"},"f1040s1":{"name":"Page1[0].f1_01[0]","ssn":"Page1[0].f1_02[0]","L1":"Page1[0].f1_04[0]","L3":"Page1[0].f1_07[0]","L5":"Page1[0].f1_09[0]","L7":"Page1[0].f1_12[0]","L8zType":"Page1[0].Line8z_ReadOrder[0].f1_35[0]","L8z":"Page1[0].f1_36[0]","L9":"Page1[0].f1_37[0]","L10":"Page1[0].f1_38[0]","L11":"Page2[0].f2_01[0]","L13":"Page2[0].f2_03[0]","L15":"Page2[0].f2_05[0]","L16":"Page2[0].f2_06[0]","L17":"Page2[0].f2_07[0]","L18":"Page2[0].f2_08[0]","L19a":"Page2[0].f2_09[0]","L20":"Page2[0].f2_12[0]","L21":"Page2[0].f2_13[0]","L24zType":"Page2[0].Line24z_ReadOrder[0].f2_27[0]","L24z":"Page2[0].f2_28[0]","L25":"Page2[0].f2_29[0]","L26":"Page2[0].f2_30[0]"},"f1040s1a":{"name":"form1[0].Page1[0].f1_01[0]","ssn":"form1[0].Page1[0].f1_02[0]","L1":"form1[0].Page1[0].f1_03[0]","L2e":"form1[0].Page1[0].f1_08[0]","L3":"form1[0].Page1[0].f1_09[0]","L4a":"form1[0].Page1[0].f1_10[0]","L4b":"form1[0].Page1[0].f1_11[0]","L4c":"form1[0].Page1[0].f1_12[0]","L5":"form1[0].Page1[0].f1_13[0]","L6":"form1[0].Page1[0].f1_14[0]","L7":"form1[0].Page1[0].f1_15[0]","L8":"form1[0].Page1[0].f1_16[0]","L9":"form1[0].Page1[0].f1_17[0]","L10":"form1[0].Page1[0].f1_18[0]","L11":"form1[0].Page1[0].f1_19[0]","L12":"form1[0].Page1[0].f1_20[0]","L13":"form1[0].Page1[0].f1_21[0]","L14a":"form1[0].Page1[0].f1_22[0]","L14b":"form1[0].Page1[0].f1_23[0]","L14c":"form1[0].Page1[0].f1_24[0]","L15":"form1[0].Page1[0].f1_25[0]","L16":"form1[0].Page1[0].f1_26[0]","L17":"form1[0].Page1[0].f1_27[0]","L18":"form1[0].Page1[0].f1_28[0]","L19":"form1[0].Page1[0].f1_29[0]","L20":"form1[0].Page1[0].f1_30[0]","L21":"form1[0].Page1[0].f1_31[0]","L22aVin":"form1[0].Page2[0].Table_Line22[0].Line22a[0].VIN-1_Comb[0].f2_01[0]","L22aIII":"form1[0].Page2[0].Table_Line22[0].Line22a[0].f2_03[0]","L23":"form1[0].Page2[0].f2_07[0]","L24":"form1[0].Page2[0].f2_08[0]","L25":"form1[0].Page2[0].f2_09[0]","L26":"form1[0].Page2[0].f2_10[0]","L27":"form1[0].Page2[0].f2_11[0]","L28":"form1[0].Page2[0].f2_12[0]","L29":"form1[0].Page2[0].f2_13[0]","L30":"form1[0].Page2[0].f2_14[0]","L31":"form1[0].Page2[0].f2_15[0]","L32":"form1[0].Page2[0].f2_16[0]","L33":"form1[0].Page2[0].f2_17[0]","L34":"form1[0].Page2[0].f2_18[0]","L35":"form1[0].Page2[0].f2_19[0]","L36a":"form1[0].Page2[0].f2_20[0]","L36b":"form1[0].Page2[0].f2_21[0]","L37":"form1[0].Page2[0].f2_22[0]","L38":"form1[0].Page2[0].f2_23[0]"},"f1040s2":{"name":"form1[0].Page1[0].f1_01[0]","ssn":"form1[0].Page1[0].f1_02[0]","L1z":"form1[0].Page1[0].f1_11[0]","L2":"form1[0].Page1[0].f1_12[0]","L3":"form1[0].Page1[0].f1_13[0]","L4":"form1[0].Page1[0].f1_15[0]","L8":"form1[0].Page1[0].f1_19[0]","L11":"form1[0].Page1[0].f1_22[0]","L12":"form1[0].Page1[0].f1_23[0]","L21":"form1[0].Page2[0].f2_24[0]"},"f1040s3":{"name":"Page1[0].f1_01[0]","ssn":"Page1[0].f1_02[0]","L1":"Page1[0].f1_03[0]","L2":"Page1[0].f1_04[0]","L3":"Page1[0].f1_05[0]","L4":"Page1[0].f1_06[0]","L6zType":"Page1[0].Line6z_ReadOrder[0].f2_22[0]","L6z":"Page1[0].f1_23[0]","L7":"Page1[0].f1_24[0]","L8":"Page1[0].f1_25[0]","L10":"Page1[0].f1_27[0]","L11":"Page1[0].f1_28[0]","L15":"Page1[0].f1_37[0]"},"f1040sse":{"name":"Page1[0].f1_1[0]","ssn":"Page1[0].f1_2[0]","L2":"Page1[0].f1_5[0]","L3":"Page1[0].f1_6[0]","L4a":"Page1[0].f1_7[0]","L4c":"Page1[0].f1_9[0]","L6":"Page1[0].f1_12[0]","L7":"Page1[0].f1_13[0]","L8a":"Page1[0].Line8a_ReadOrder[0].f1_14[0]","L8d":"Page1[0].f1_17[0]","L9":"Page1[0].f1_18[0]","L10":"Page1[0].f1_19[0]","L11":"Page1[0].f1_20[0]","L12":"Page1[0].f1_21[0]","L13":"Page1[0].f1_22[0]"},"f1040s8":{"name":"Page1[0].f1_1[0]","ssn":"Page1[0].f1_2[0]","L1":"Page1[0].f1_3[0]","L2d":"Page1[0].f1_7[0]","L3":"Page1[0].f1_8[0]","L4":"Page1[0].f1_9[0]","L5":"Page1[0].f1_10[0]","L6":"Page1[0].Line6ReadOrder[0].f1_11[0]","L7":"Page1[0].f1_12[0]","L8":"Page1[0].f1_13[0]","L9":"Page1[0].f1_14[0]","L10":"Page1[0].f1_15[0]","L11":"Page1[0].f1_16[0]","L12":"Page1[0].f1_17[0]","L12no":"Page1[0].c1_1[0]","L12yes":"Page1[0].c1_1[1]","L13":"Page1[0].f1_18[0]","L14":"Page1[0].f1_19[0]","L16a":"Page2[0].f2_2[0]","L16bN":"Page2[0].f2_3[0]","L16b":"Page2[0].f2_4[0]","L17":"Page2[0].f2_5[0]","L18a":"Page2[0].f2_6[0]","L19no":"Page2[0].c2_1[0]","L19yes":"Page2[0].c2_1[1]","L19":"Page2[0].f2_8[0]","L20":"Page2[0].f2_9[0]","L27":"Page2[0].f2_16[0]"},"f8995":{"name":"Page1[0].f1_01[0]","tin":"Page1[0].f1_02[0]","r1Name":"Page1[0].Table[0].Row1i[0].f1_03[0]","r1Tin":"Page1[0].Table[0].Row1i[0].f1_04[0]","r1Qbi":"Page1[0].Table[0].Row1i[0].f1_05[0]","L2":"Page1[0].Line2_ReadOrder[0].f1_18[0]","L4":"Page1[0].f1_20[0]","L5":"Page1[0].f1_21[0]","L10":"Page1[0].f1_26[0]","L11":"Page1[0].f1_27[0]","L12":"Page1[0].f1_28[0]","L13":"Page1[0].f1_29[0]","L14":"Page1[0].f1_30[0]","L15":"Page1[0].f1_31[0]"},"f1040sc":{"name":"Page1[0].f1_1[0]","ssn":"Page1[0].f1_2[0]","A":"Page1[0].f1_3[0]","B":"Page1[0].BComb[0].f1_4[0]","C":"Page1[0].f1_5[0]","cash":"Page1[0].c1_1[0]","Gyes":"Page1[0].c1_2[0]","Ino":"Page1[0].c1_4[1]","L1":"Page1[0].f1_10[0]","L3":"Page1[0].f1_12[0]","L5":"Page1[0].f1_14[0]","L7":"Page1[0].f1_16[0]","L27b":"Page1[0].Lines18-27[0].f1_39[0]","L28":"Page1[0].f1_41[0]","L29":"Page1[0].f1_42[0]","L31":"Page1[0].f1_46[0]","pv1":"Page2[0].PartVTable[0].Item1[0].f2_15[0]","pv1Amt":"Page2[0].PartVTable[0].Item1[0].f2_16[0]","L48":"Page2[0].f2_33[0]"}};
const TX_PREFIX = 'topmostSubform[0].';
const txField = n => (/^(form1|topmostSubform)\[/.test(n) ? n : TX_PREFIX + n); // Schedules 1-A and 2 are built on form1[0]
const txAmt = v => {
  const n = Math.round(+v || 0);
  return n ? String(n) : '';
};
const txAmt0 = v => String(Math.round(+v || 0));
const txFormBytes = async (year, form) => (await fetch('assets/tax/forms/' + year + '/' + form + '.pdf?v=' + (typeof APP_BUILD === 'string' ? APP_BUILD : '1'))).arrayBuffer();
async function txFillForm(lib, year, form, values, checks, getBytes) {
  const bytes = await (getBytes || txFormBytes)(year, form);
  const doc = await lib.PDFDocument.load(bytes, { updateMetadata: false });
  const f = doc.getForm();
  try {
    f.deleteXFA(); // the AcroForm fields are the ones a reader then shows
  } catch (e) {
    /* not every copy carries XFA */
  }
  const map = TX_MAP_2025[form] || {};
  for (const [k, v] of Object.entries(values || {})) {
    if (!map[k] || v == null || v === '') continue;
    try {
      const fld = f.getTextField(txField(map[k]));
      let t = String(v);
      const max = fld.getMaxLength();
      if (max && t.length > max) t = t.replace(/[^0-9A-Za-z]/g, '').slice(0, max); // SSN, routing and ZIP boxes are digits only
      fld.setText(t);
    } catch (e) {
      /* a field this copy of the form does not have */
    }
  }
  for (const k of checks || []) {
    if (!map[k]) continue;
    try {
      f.getCheckBox(txField(map[k])).check();
    } catch (e) {
      /* as above */
    }
  }
  return doc;
}
/* Every form the estimate needs, filled and joined into one PDF. pii: what is typed in just for the printout. */
async function txBuildReturn(est, prof, pii, opts) {
  opts = opts || {};
  const lib = opts.lib || (await loadPdfLib());
  const gb = opts.getBytes;
  const fill = (form, values, checks) => txFillForm(lib, year, form, values, checks, gb).then(d => [form, d]);
  const year = est.year;
  const F = est.fed;
  const L = F.L;
  const joint = F.joint;
  const deps = (prof.deps || []).filter(d => d && (d.n || d.born));
  const nm = (pii.first || '') + ' ' + (pii.last || '');
  const names = joint ? (pii.first || '') + ' & ' + (pii.spFirst || '') + ' ' + (pii.last || '') : nm;
  const head = { name: names.trim(), ssn: pii.ssn || '' };
  const docs = [];
  // Form 1040
  const v = {
    first: pii.first, last: pii.last, ssn: pii.ssn, addr: pii.addr, apt: pii.apt, city: pii.city, state: pii.state, zip: pii.zip,
    L1a: txAmt(L['1a']), L1z: txAmt(L['1z']), L2a: txAmt(L['2a']), L2b: txAmt(L['2b']), L3a: txAmt(L['3a']), L3b: txAmt(L['3b']), L4a: txAmt(L['4a']), L4b: txAmt(L['4b']),
    L5a: txAmt(L['5a']), L5b: txAmt(L['5b']), L6a: txAmt(L['6a']), L6b: txAmt(L['6b']), L7a: L['7a'] ? txAmt(L['7a']) : '', L8: txAmt(L['8']), L9: txAmt0(L['9']), L10: txAmt(L['10']), L11a: txAmt0(L['11']),
    L11b: txAmt0(L['11']), L12e: txAmt0(L['12e']), L13a: txAmt(L.qbi), L13b: txAmt(L.s1a), L14: txAmt0(L['14']), L15: txAmt0(L['15']), L16: txAmt0(L['16']), L17: txAmt(L['17']), L18: txAmt0(L['18']),
    L19: txAmt(L['19']), L20: txAmt(L['20']), L21: txAmt(L['21']), L22: txAmt0(L['22']), L23: txAmt(L['23']), L24: txAmt0(L['24']), L25a: txAmt(L['25a']), L25b: txAmt(L['25b']), L25c: txAmt(L['25c']), L25d: txAmt(L['25d']),
    L26: txAmt(L['26']), L27a: txAmt(L['27a']), L28: txAmt(L['28']), L29: txAmt(L['29']), L31: txAmt(L['31']), L32: txAmt(L['32']), L33: txAmt0(L['33']), L34: txAmt(L['34']), L35a: txAmt(L['34']), L37: txAmt(L['37']),
    occ: pii.occ, spOcc: joint ? pii.spOcc : '', phone: pii.phone, email: pii.email, ipPin: pii.ipPin, spIpPin: joint ? pii.spIpPin : '',
  };
  if (joint || F.st === 'mfs') Object.assign(v, { spFirst: pii.spFirst, spLast: pii.spLast || pii.last, spSsn: pii.spSsn });
  if (F.st === 'mfs') v.mfsName = ((pii.spFirst || '') + ' ' + (pii.spLast || '')).trim();
  if (L['34'] > 0 && pii.routing && pii.account) Object.assign(v, { routing: pii.routing, account: pii.account });
  const checks = ['st_' + F.st, pii.digital === 'yes' ? 'digYes' : 'digNo', 'tpNo'];
  if (!F.nra) checks.push('usHome');
  if (L['34'] > 0 && pii.routing && pii.account) checks.push(pii.acctType === 'savings' ? 'savings' : 'checking');
  const by = year - 64; // born before Jan 2 of the year 64 years earlier: 65 by year-end
  const you = prof.you || {};
  const sp = prof.sp || {};
  if (you.dep) checks.push('L12aYou');
  if (F.st === 'mfs' && sp.itemizes) checks.push('L12b');
  if (you.born && +you.born < by) checks.push('L12dYouBorn');
  if (you.blind) checks.push('L12dYouBlind');
  if (joint && sp.born && +sp.born < by) checks.push('L12dSpBorn');
  if (joint && sp.blind) checks.push('L12dSpBlind');
  if (L['7a'] && !(+prof.capST) && !(+prof.capLT) && +prof.capDist) checks.push('L7bNoD');
  deps.slice(0, 4).forEach((d, i) => {
    const n = i + 1;
    const parts = String(d.n || '').trim().split(/\s+/);
    v['dep' + n + 'First'] = parts[0] || '';
    v['dep' + n + 'Last'] = parts.slice(1).join(' ') || pii.last || '';
    v['dep' + n + 'Ssn'] = (pii.depSsn || [])[i] || '';
    v['dep' + n + 'Rel'] = d.relText || (d.rel === 'other' ? 'Relative' : 'Child');
    if (d.months == null || +d.months >= 6) checks.push('dep' + n + 'Lived', 'dep' + n + 'Us');
    if (d.student) checks.push('dep' + n + 'Student');
    if (d.disabled) checks.push('dep' + n + 'Disabled');
    const age = d.born ? year - +d.born : 99;
    checks.push(age < 17 && d.ssn !== false && d.rel !== 'other' ? 'dep' + n + 'Ctc' : 'dep' + n + 'Odc');
  });
  if (deps.length > 4) checks.push('depMore');
  docs.push(await fill('f1040', v, checks));
  // Schedule 1
  const S1 = F.S1;
  if (L['8'] || L['10']) {
    docs.push(await fill('f1040s1', {
      ...head, L1: txAmt(S1['1']), L3: S1['3'] ? txAmt(S1['3']) : '', L5: S1['5'] ? txAmt(S1['5']) : '', L7: txAmt(S1['7']), L8zType: S1['8z'] ? prof.otherIncDesc || 'Other income' : '', L8z: txAmt(S1['8z']), L9: txAmt(S1['9']), L10: txAmt0(S1['10']),
      L11: txAmt(S1['11']), L13: txAmt(S1['13']), L15: txAmt(S1['15']), L16: txAmt(S1['16']), L17: txAmt(S1['17']), L18: txAmt(S1['18']), L19a: txAmt(S1['19a']), L20: txAmt(S1['20']), L21: txAmt(S1['21']),
      L24zType: S1['24z'] ? 'Other adjustments' : '', L24z: txAmt(S1['24z']), L25: txAmt(S1['25']), L26: txAmt0(S1['26']),
    }));
  }
  // Schedule 1-A
  const A = F.S1A;
  if (A['38'] > 0) {
    const magi = Math.round(F.agi);
    const jt = joint;
    const tips = Math.min(+prof.tips || 0, 25000);
    const ot = Math.min(+prof.otPrem || 0, jt ? 25000 : 12500);
    const car = Math.min(+prof.carInt || 0, 10000);
    const o = t => Math.max(0, magi - t);
    const s = {
      ...head, L1: txAmt0(magi), L2e: '0', L3: txAmt0(magi),
      L35: '', L36a: txAmt(A['36a']), L36b: txAmt(A['36b']), L37: txAmt(A['37']), L38: txAmt0(A['38']),
    };
    const lim = (over, unit, up) => (over > 0 ? (up ? Math.ceil(over / 1000) : Math.floor(over / 1000)) : 0) * unit;
    const tOver = o(jt ? 300000 : 150000);
    const cOver = o(jt ? 200000 : 100000);
    const sOver = o(jt ? 150000 : 75000);
    if (A['13'] > 0 || tips) Object.assign(s, { L4a: txAmt(tips), L4b: '0', L4c: txAmt(tips), L6: txAmt(tips), L7: txAmt(tips), L8: txAmt0(magi), L9: jt ? '300000' : '150000', L10: txAmt0(tOver), L13: txAmt0(A['13']) }, tOver > 0 ? { L11: String(Math.floor(tOver / 1000)), L12: txAmt0(lim(tOver, 100)) } : {});
    if (A['21'] > 0 || ot) Object.assign(s, { L14a: txAmt(ot), L14c: txAmt(ot), L15: txAmt(ot), L16: txAmt0(magi), L17: jt ? '300000' : '150000', L18: txAmt0(tOver), L21: txAmt0(A['21']) }, tOver > 0 ? { L19: String(Math.floor(tOver / 1000)), L20: txAmt0(lim(tOver, 100)) } : {});
    if (A['30'] > 0 || car) Object.assign(s, { L22aVin: pii.vin || '', L22aIII: txAmt(car), L23: txAmt(car), L24: txAmt(car), L25: txAmt0(magi), L26: jt ? '200000' : '100000', L27: txAmt0(cOver), L30: txAmt0(A['30']) }, cOver > 0 ? { L28: String(Math.ceil(cOver / 1000)), L29: txAmt0(lim(cOver, 200, true)) } : {});
    if (A['37'] > 0) Object.assign(s, { L31: txAmt0(magi), L32: jt ? '150000' : '75000', L33: txAmt0(sOver), L35: txAmt0(Math.max(0, 6000 - 0.06 * sOver)) }, sOver > 0 ? { L34: txAmt0(0.06 * sOver) } : {});
    docs.push(await fill('f1040s1a', s));
  }
  // Schedule 2
  if (L['17'] || L['23']) docs.push(await fill('f1040s2', { ...head, L3: txAmt(F.S2['3']), L4: txAmt(F.S2['4']), L8: txAmt(F.S2['8']), L11: txAmt(F.S2['11']), L12: txAmt(F.S2['12']), L21: txAmt0(F.S2['21']) }));
  // Schedule 3
  const S3 = F.S3;
  if (L['20'] || L['31']) docs.push(await fill('f1040s3', { ...head, L1: txAmt(S3['1']), L2: txAmt(S3['2']), L3: txAmt(S3['3']), L4: txAmt(S3['4']), L6zType: S3['6z'] ? 'Other credits' : '', L6z: txAmt(S3['6z']), L7: txAmt(S3['6z']), L8: txAmt(S3['8']), L10: txAmt(S3['10']), L11: txAmt(S3['11']), L15: txAmt(S3['15']) }));
  // Schedule 8812
  const C = F.S8812;
  if (C['8'] > 0) {
    const add = C['4'] > 0 && C['16a'] > 0;
    docs.push(await fill('f1040s8', {
      ...head, L1: txAmt0(F.agi), L2d: '0', L3: txAmt0(F.agi), L4: String(C['4']), L5: txAmt0(C['5']), L6: String(C['6']), L7: txAmt0(C['7']), L8: txAmt0(C['8']), L9: joint ? '400000' : '200000', L10: txAmt0(C['10']), L11: txAmt0(C['11']),
      L12: txAmt0(C['12']), L13: txAmt0(C['13']), L14: txAmt0(C['14']), L16a: C['4'] ? txAmt0(C['16a']) : '',
      // Part II-A only when line 16a is more than zero (the form says stop there otherwise)
      ...(add ? { L16bN: String(C['4']), L16b: txAmt0(C['16b']), L17: txAmt0(C['17']), L18a: txAmt0(C['18a']), L19: C['18a'] > 2500 ? txAmt0(C['18a'] - 2500) : '', L20: txAmt0(C['20']), L27: txAmt0(C['27']) } : {}),
    }, [C['12'] > 0 ? 'L12yes' : 'L12no', ...(add ? [C['18a'] > 2500 ? 'L19yes' : 'L19no'] : [])]));
  }
  // Schedule SE, one per person with self-employment tax
  for (const [who, se] of [['you', F.SE.you], ['sp', F.SE.sp]]) {
    if (!se) continue;
    const D = opts.data || est.data;
    const room = Math.max(0, D.fed.ss.wageBase - se.ssWages);
    docs.push(await fill('f1040sse', {
      name: who === 'sp' ? ((pii.spFirst || '') + ' ' + (pii.spLast || pii.last || '')).trim() : nm.trim(), ssn: who === 'sp' ? pii.spSsn : pii.ssn,
      L2: txAmt0(se.profit), L3: txAmt0(se.profit), L4a: txAmt0(se.ne), L4c: txAmt0(se.ne), L6: txAmt0(se.ne), L7: txAmt0(D.fed.ss.wageBase), L8a: txAmt0(se.ssWages), L8d: txAmt0(se.ssWages), L9: txAmt0(room),
      L10: txAmt0(Math.min(se.ne, room) * 0.124), L11: txAmt0(se.ne * 0.029), L12: txAmt0(se.tax), L13: txAmt0(se.tax / 2),
    }));
  }
  // Schedule C, one per person with business income
  for (const [who, p] of [['you', F.pYou], ['sp', F.pSp]]) {
    if (!p || !(p.gross > 0)) continue;
    const b = (prof.biz || {})[who] || {};
    docs.push(await fill('f1040sc', {
      name: who === 'sp' ? ((pii.spFirst || '') + ' ' + (pii.spLast || pii.last || '')).trim() : nm.trim(), ssn: who === 'sp' ? pii.spSsn : pii.ssn,
      A: b.what || 'Information technology consulting', B: b.code || '541510', C: b.name || '',
      L1: txAmt0(p.gross), L3: txAmt0(p.gross), L5: txAmt0(p.gross), L7: txAmt0(p.gross), L27b: txAmt(p.exp), L28: txAmt(p.exp), L29: txAmt0(p.net), L31: txAmt0(p.net),
      pv1: p.exp ? 'Business expenses (see your records)' : '', pv1Amt: txAmt(p.exp), L48: txAmt(p.exp),
    }, ['cash', 'Gyes', 'Ino']));
  }
  // Form 8995
  if (L.qbi > 0) {
    const Q = F.Q;
    docs.push(await fill('f8995', { name: head.name, tin: pii.ssn, r1Name: (prof.biz && prof.biz.you && prof.biz.you.name) || 'Schedule C business', r1Tin: pii.ssn, r1Qbi: txAmt0(Q['4']), L2: txAmt0(Q['4']), L4: txAmt0(Q['4']), L5: txAmt0(Q['5']), L10: txAmt0(Q['5']), L11: txAmt0(Q['11']), L12: txAmt0(Q['12']), L13: txAmt0(Math.max(0, Q['11'] - Q['12'])), L14: txAmt0(0.2 * Math.max(0, Q['11'] - Q['12'])), L15: txAmt0(Q['15']) }));
  }
  // each form on its own, still fillable (to fix anything in a PDF reader), and all of them in one PDF to print, in the
  // order the IRS wants them attached (1040, then the schedules); the printing copy is flattened so every reader shows it
  const seq = { f1040: 0, f1040s1: 1, f1040s1a: 1.5, f1040s2: 2, f1040s3: 3, f1040sc: 9, f1040sse: 17, f1040s8: 47, f8995: 55 }; // attachment sequence numbers
  docs.sort((a, b) => seq[a[0]] - seq[b[0]]);
  const parts = [];
  for (const [form, d] of docs) parts.push({ form, bytes: await d.save() });
  const out = await lib.PDFDocument.create();
  for (const [, d] of docs) {
    try {
      d.getForm().flatten();
    } catch (e) {
      /* a form that cannot be flattened is copied as it is */
    }
    const pages = await out.copyPages(d, d.getPageIndices());
    pages.forEach(p => out.addPage(p));
  }
  return { merged: await out.save(), parts, forms: docs.map(([form]) => form) };
}
if (typeof module !== 'undefined' && module.exports) module.exports = { txBuildReturn, TX_MAP_2025 };
