"""v40 tax center: builds assets/tax/2025.json and assets/tax/2026.json (what the browser's tax engine reads) from the
research files in research/ (federal, New Jersey, every state; each with its sources). Run after changing research/:
    python3 _source/tax/compile.py
The research files keep the sources and the long notes; the compiled files keep what the calculator needs, plus each
state's notes (shown under "What this state estimate leaves out")."""
import json, pathlib

here = pathlib.Path(__file__).parent
site = here.parent.parent
R = lambda n: json.loads((here / 'research' / n).read_text())

# IRS news releases IR-2024-285 (2025) and IR-2025-111 (2026): traditional IRA deduction phase-outs for people covered
# by a workplace retirement plan (single/HOH; joint, contributor covered; joint, only the spouse covered; MFS covered)
IRA_PHASE = {
    2025: {'single': [79000, 89000], 'mfj': [126000, 146000], 'spouse': [236000, 246000], 'mfs': [0, 10000]},
    2026: {'single': [81000, 91000], 'mfj': [129000, 149000], 'spouse': [242000, 252000], 'mfs': [0, 10000]},
}
# Child and dependent care credit rate (Form 2441 line 8): 2025 35% down 1 point per $2,000 of AGI over $15,000 to 20%;
# 2026 (OBBBA) 50% down to 35%, then down 1 point per $2,000 ($4,000 joint) over $75,000 ($150,000 joint) to 20%
DEP_CARE = {
    2025: {'max': 0.35, 'floor1': 0.20, 'start1': 15000, 'step1': 2000, 'min': 0.20, 'caps': [3000, 6000], 'fsa': 5000},
    2026: {'max': 0.50, 'floor1': 0.35, 'start1': 15000, 'step1': 2000, 'start2': {'mfj': 150000, 'other': 75000}, 'step2': {'mfj': 4000, 'other': 2000}, 'min': 0.20, 'caps': [3000, 6000], 'fsa': 7500},
}
# Ohio's schedule carries a base amount that the bracket rows alone miss (ORC 5747.02)
OH_BASE = {2025: [[0, 0.0], [26050, 0.0275, 342], [100000, 0.03125, 2394.32]], 2026: [[0, 0.0], [26050, 0.0275, 332]]}
LINKS = {
    'freeFile': 'https://www.irs.gov/filing/irs-free-file-do-your-taxes-for-free',
    'fillable': 'https://www.irs.gov/e-file-providers/free-file-fillable-forms',
    'wmr': 'https://www.irs.gov/wheres-my-refund',
    'amended': 'https://www.irs.gov/filing/wheres-my-amended-return',
    'paperWhere': 'https://www.irs.gov/filing/where-to-file-paper-tax-returns-with-or-without-a-payment',
    'preparers': 'https://irs.treasury.gov/rpo/rpo.jsf',
    'vita': 'https://www.irs.gov/individuals/free-tax-return-preparation-for-qualifying-taxpayers',
    'withholding': 'https://www.irs.gov/individuals/tax-withholding-estimator',
    'pay': 'https://www.irs.gov/payments',
    'extension': 'https://www.irs.gov/filing/get-an-extension-to-file-your-tax-return',
    'ipPin': 'https://www.irs.gov/identity-theft-fraud-scams/get-an-identity-protection-pin',
    'transcript': 'https://www.irs.gov/individuals/get-transcript',
    'njFile': 'https://www.njportal.com/Taxation/NJ1040/',
    'njRefund': 'https://www.nj.gov/treasury/taxation/checkrefundstatus.shtml',
    'f8843': 'https://www.irs.gov/forms-pubs/about-form-8843',
    'f1040nr': 'https://www.irs.gov/forms-pubs/about-form-1040-nr',
}


def federal(year):
    f = R(f'federal-{year}.json')
    keep = ['brackets', 'stdDeduction', 'addlStd', 'dependentStd', 'capGains', 'ctc', 'eitc', 'salt', 'ss', 'addlMedicare', 'niit', 'qbi',
            'studentLoanInterest', 'aotc', 'llc', 'saversCredit', 'ira', 'hsa', 'charityNonItemizer', 'itemizedLimits']
    out = {k: f[k] for k in keep if k in f}
    out['ctc'] = {k: v for k, v in out['ctc'].items() if k != 'notes'}
    out['eitc'] = {k: v for k, v in out['eitc'].items() if k != 'ageRulesNoKids'}
    out['obbba'] = {k: {kk: vv for kk, vv in v.items() if kk != 'rules'} for k, v in f['obbba'].items() if isinstance(v, dict)}
    out['ira'] = dict(out['ira'], phase=IRA_PHASE[year])
    out['depCare'] = DEP_CARE[year]
    if 'charityNonItemizer' in out:
        out['charityNonItemizer'] = {k: v for k, v in out['charityNonItemizer'].items() if k != 'notes'}
    if 'itemizedLimits' in out:
        out['itemizedLimits'] = {k: v for k, v in out['itemizedLimits'].items() if k != 'notes'}
    return out


def nj(year):
    n = R('nj.json')[str(year)]
    return {
        'a': [[lo, r] for lo, r in n['tableA']], 'aSub': n['tableASubtract'],
        'b': [[lo, r] for lo, r in n['tableB']], 'bSub': n['tableBSubtract'],
        'file': {k: n['filingThreshold'][k] for k in ['single', 'mfj', 'mfs', 'hoh', 'qss']},
        'ex': {k: n['exemptions'][k] for k in ['regular', 'spouse', 'age65', 'blind', 'veteran', 'dependent', 'collegeStudent']},
        'prop': {k: n['propertyTax'][k] for k in ['deductionMax', 'deductionMaxMfsSameHome', 'credit', 'creditMfsSameHome', 'renterPct']},
        'eitc': n['eitc']['pctOfFederal'], 'ctc': n['childTaxCredit']['table'], 'ctcAge': n['childTaxCredit']['ageLimit'],
        'care': n['dependentCareTable'], 'medFloor': n['medicalFloorPct'],
    }


def states(year):
    d = R(f'states-{year}.json')['states']
    out = {}
    for code, s in d.items():
        notes = ' '.join(x for x in [s.get('notes') or '', (s.get('std') or {}).get('notes') or '', (s.get('exemption') or {}).get('notes') or ''] if x).strip()
        e = s.get('exemption') or {}
        st = s.get('std') or {}
        row = {
            'n': s['name'], 'w': bool(s.get('taxesWages')), 't': s.get('type') or 'none',
            'b': {'s': s['brackets'].get('single') or [], 'm': s['brackets'].get('mfj') or []},
            'sd': {'s': st.get('single') or 0, 'm': st.get('mfj') or 0, 'k': st.get('kind') or ('deduction' if (st.get('single') or 0) else 'none')},
            'ex': {'s': e.get('single') or 0, 'm': e.get('mfj') or 0, 'd': e.get('dependent') or 0, 'k': e.get('kind') or 'none', 'dk': e.get('dependentKind') or e.get('kind') or 'none'},
            'st': s.get('start') or 'federalAGI', 'lo': s.get('local') or '', 'no': notes,
        }
        if code == 'OH':
            row['b'] = {'s': OH_BASE[year], 'm': OH_BASE[year]}
        out[code] = row
    return out


for year in (2025, 2026):
    ff = R('forms-filing.json')
    data = {
        'year': year,
        'fed': federal(year),
        'nj': nj(year),
        'states': states(year),
        'links': LINKS,
        'deadlines': {2025: {'file': '2026-04-15', 'extended': '2026-10-15'}, 2026: {'file': '2027-04-15', 'extended': '2027-10-15'}}[year],
        'freeFileAgi': {2025: 89000, 2026: None}[year],
        'vitaAgi': {2025: 69000, 2026: None}[year],
        'estDue': {2025: ['2025-04-15', '2025-06-16', '2025-09-15', '2026-01-15'], 2026: ['2026-04-15', '2026-06-15', '2026-09-15', '2027-01-15']}[year],
        'forms': year == 2025,
    }
    out = site / 'assets' / 'tax'
    out.mkdir(parents=True, exist_ok=True)
    (out / f'{year}.json').write_text(json.dumps(data, separators=(',', ':')))
    print(year, 'states', len(data['states']), 'bytes', (out / f'{year}.json').stat().st_size)
