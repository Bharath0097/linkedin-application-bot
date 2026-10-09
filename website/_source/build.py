"""Rebuilds js/app.js and css/styles.css (one folder up) from _source/src, and stamps a build id into
index.html (?v=...) so browsers never keep an old copy after an update."""
import hashlib, pathlib, re, time, json, os
VERSION = 'v82'   # StratEdge-managed workspaces: phone, assistant & Dice/iLabor set up centrally and inherited
here = pathlib.Path(__file__).parent; site = here.parent; src = here / 'src'
# Two bundles. js/app.js is what everyone downloads: the website, the logins and the member portals (consultant,
# employee, bench, client). js/staff.js holds the admin, HR, accounting, manager and recruiting pages and is fetched
# on demand (loadStaff() in core.js) — about half the code, which consultants and clients never need.
# v45.2: the old js/app.js is now two bundles. BASE is js/app.js (the website, the sign-in pages, the pages people open
# from a link: plans, pricing, certificate checks, support, workspace pages); MEMBER is js/member.js, fetched with the
# portals (loadMember() in core.js; boot.js starts it early). A name used by the website from the member bundle must be
# shown through Lazy, or the build stops (see the check at the end).
# v62: js/app.js keeps only what the website's first page needs; the pages people open from a link (plans, pricing,
# certificate checks, applications, confirmations, the public security and support pages, password resets, the bench
# desk's consultant links, a company workspace's own website and sign-up) are js/site2.js, fetched when one is opened (loadSite2() in
# core.js; boot.js starts it early on those addresses). The portals load it before js/member.js, so a member page may
# use its names freely; a website file in BASE may use them only through Lazy or inside the portal-only functions below.
BASE = ['core.js', 'site.js', 'fx.js', 'pub.js', 'cwsite.js', 'main.js']
SITE2 = ['apply.js', 'exams.js', 'billing.js', 'pricing.js', 'confirm.js', 'security.js', 'benchme.js', 'wsite.js', 'wsjoin.js']
MEMBER = ['portal.js', 'hrqme.js', 'client.js', 'jobs.js', 'appbot.js', 'esign.js', 'invoices.js', 'kit.js', 'taxes.js', 'mkt.js', 'grow.js', 'ai.js', 'tailor.js', 'desk.js', 'chat.js', 'phone.js', 'practice.js', 'idkit.js', 'look.js', 'shell.js']
# v62: js/staff.js is the staff pages people open all day; js/staff2.js (loadStaff2() in core.js, fetched after it) is
# the ones opened now and then: the books, the learning and compliance administration, certifications, plans and
# payments, job rules, the Security center, governance and privacy, practice calls, ID checks, Portal integrations,
# workspaces and the phone setup. A staff.js file never uses a staff2.js name (the build checks); shell.js fetches
# staff2.js before it draws one of its pages (STAFF2_KEYS).
STAFF = ['rec.js', 'hr.js', 'acct.js', 'ats.js', 'atsjob.js', 'admin.js', 'mail.js', 'maillists.js', 'crm.js', 'crm2.js', 'acct2.js', 'hrms.js', 'hrqadmin.js', 'ads.js', 'mymail.js', 'check.js', 'vms.js', 'reqshare.js', 'box.js', 'pay.js', 'place.js', 'agent.js', 'talent.js', 'pricingadmin.js', 'deskadmin.js', 'bench.js', 'imports.js']
STAFF2 = ['intel.js', 'books.js', 'growadmin.js', 'examsadmin.js', 'billadmin.js', 'rulesadmin.js', 'sources.js', 'trust.js', 'govui.js', 'practiceadmin.js', 'idscan.js', 'workspaces.js', 'phoneadmin.js']
# v40: js/tax.js is the tax center (My taxes): the estimate engine, the IRS forms map and the page, fetched on demand
# (loadTax() in core.js). taxcalc.js also runs on its own in the unit tests (_source/tests/taxcalc.test.cjs).
TAX = ['taxcalc.js', 'taxforms.js', 'taxcenter.js']
# v42: js/work.js is the work boards (agile projects, sprints, stand-ups, retrospectives, reports), fetched on demand
# (loadWork() in core.js) by staff and member portals alike
WORK = ['work.js', 'claims.js', 'goals.js', 'immig.js', 'seq.js', 'corp.js', 'corpsl.js', 'corpq.js', 'corpdd.js', 'corprv.js', 'corpst.js', 'cwstaff.js']  # v43 claims, v44 goals & reviews, v45 immigration cases, v46 sequences, v47 client requests & proposals, v48 the shortlist room, v49 supplier qualification and v50 service pages & cases ride in the same on-demand bundle
files = BASE + SITE2 + MEMBER + STAFF + STAFF2 + TAX + WORK
# Every file shares one global scope: a name declared twice silently replaces the first (v32 caught a PlanCards clash
# this way), so the build stops and names them.
import collections
_seen = collections.defaultdict(list)
for _f in files:
    for _i, _l in enumerate((src / _f).read_text().split('\n'), 1):
        _m = re.match(r'^(?:async\s+)?function\s+(\w+)|^(?:const|let|var|class)\s+(\w+)', _l)
        if _m:
            _seen[_m.group(1) or _m.group(2)].append(_f + ':' + str(_i))
_dups = {k: v for k, v in _seen.items() if len(v) > 1}
if _dups:
    raise SystemExit('build stopped: names declared more than once: ' + '; '.join(k + ' (' + ', '.join(v) + ')' for k, v in _dups.items()))
js = '\n'.join((src / f).read_text() for f in BASE); site2_js = '\n'.join((src / f).read_text() for f in SITE2); member_js = '\n'.join((src / f).read_text() for f in MEMBER); staff_js = '\n'.join((src / f).read_text() for f in STAFF); staff2_js = '\n'.join((src / f).read_text() for f in STAFF2); tax_js = '\n'.join((src / f).read_text() for f in TAX); work_js = '\n'.join((src / f).read_text() for f in WORK)
# v38: glass.css (the Glass look, and the Appearance menu in both looks) comes last so it can restyle the rest
css = (src / 'styles.css').read_text() + '\n' + (src / 'refresh.css').read_text() + '\n' + (src / 'theme.css').read_text() + '\n' + (src / 'glass.css').read_text()
build = time.strftime('%Y%m%d') + '.' + hashlib.md5((js + site2_js + member_js + staff_js + staff2_js + tax_js + work_js + css).encode()).hexdigest()[:6]
def mincss(s):
    # safe minify: comments, indentation and blank lines go; everything inside rules stays as written
    s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
    s = re.sub(r'\n[ \t]+', '\n', s)
    s = re.sub(r'\n{2,}', '\n', s)
    s = re.sub(r'([{;,])\n', r'\1', s)
    s = re.sub(r'\n}', '}', s)
    return s.strip() + '\n'
(site / 'css' / 'styles.css').write_text(mincss(css))
(site / 'js' / 'app.js').write_text("'use strict';\nconst APP_BUILD = '" + build + "';\nconst APP_VERSION = '" + VERSION + "';\n" + js)
(site / 'js' / 'site2.js').write_text("'use strict';\n" + site2_js + "\nwindow.__SE_SITE2 = true;\n")
(site / 'js' / 'member.js').write_text("'use strict';\n" + member_js + "\nwindow.__SE_MEMBER = true;\n")
(site / 'js' / 'staff.js').write_text("'use strict';\n" + staff_js + "\nwindow.__SE_STAFF = true;\n")
(site / 'js' / 'staff2.js').write_text("'use strict';\n" + staff2_js + "\nwindow.__SE_STAFF2 = true;\n")
(site / 'js' / 'tax.js').write_text("'use strict';\n" + tax_js + "\nwindow.__SE_TAX = true;\n")
(site / 'js' / 'work.js').write_text("'use strict';\n" + work_js + "\nwindow.__SE_WORK = true;\n")
# v33: the service worker's cache is named after the build, so each upload starts a fresh one (old ones are removed)
_sw = site / 'sw.js'
if _sw.is_file():
    _sw.write_text(re.sub(r"const CACHE = '[^']*';", "const CACHE = 'se-shell-" + build + "';", _sw.read_text()))
h = site / 'index.html'; html = h.read_text()
for name in ['css/styles.css', 'css/fonts.css', 'js/config.js', 'js/app.js', 'js/boot.js', 'js/compat.js', 'js/vendor/react.production.min.js', 'js/vendor/react-dom.production.min.js', 'js/vendor/htm.umd.js']:
    html = re.sub(re.escape(name) + r'(\?v=[^"]*)?"', name + '?v=' + build + '"', html)
h.write_text(html)
print('rebuilt js/app.js and css/styles.css, build ' + build)

# Smaller download: when terser is installed (npm install -g terser) the bundle is minified in place;
# otherwise the readable build ships, which works the same but is about twice the size.
import shutil, subprocess, pathlib as _pl
_root = _pl.Path(__file__).resolve().parent.parent
if shutil.which('terser'):
    for _name in ['js/app.js', 'js/site2.js', 'js/member.js', 'js/staff.js', 'js/staff2.js', 'js/tax.js', 'js/work.js']:
        _r = subprocess.run(['terser', str(_root / _name), '--compress', '--mangle', '--comments', 'false', '-o', str(_root / _name)], capture_output=True, text=True)
        print('minified ' + _name if _r.returncode == 0 else 'terser failed on ' + _name + ', kept the readable build: ' + _r.stderr[:200])

# v45.2: smaller bundles: the indentation htm throws away inside html`...` templates is taken out (htmsqueeze.cjs), then
# htm's own reading of every template is compared before and after; if anything differs the unsqueezed build stays.
_acorn = None
if shutil.which('node') and shutil.which('terser'):
    _tdir = _pl.Path(shutil.which('terser')).resolve().parent.parent
    for _cand in [_tdir / 'node_modules' / 'acorn', _tdir.parent / 'acorn', _pl.Path('/opt/npm-tools/node_modules/acorn'), _pl.Path(os.path.expanduser('~/.npm-global/lib/node_modules/acorn'))]:
        if (_cand / 'package.json').is_file():
            _acorn = str(_cand)
            break
if _acorn:
    import tempfile
    _sq = str(_root / '_source' / 'htmsqueeze.cjs')
    _htm = str(_root / 'js' / 'vendor' / 'htm.umd.js')
    for _name in ['js/app.js', 'js/site2.js', 'js/member.js', 'js/staff.js', 'js/staff2.js', 'js/tax.js', 'js/work.js']:
        _f = _root / _name
        _before = _f.read_text()
        with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False) as _tmp:
            _tmp.write(_before)
        _r = subprocess.run(['node', _sq, _acorn, str(_f)], capture_output=True, text=True)
        _c = subprocess.run(['node', _sq, _acorn, '--check', _htm, _tmp.name, str(_f)], capture_output=True, text=True) if _r.returncode == 0 else _r
        os.unlink(_tmp.name)
        if _r.returncode != 0 or _c.returncode != 0:
            _f.write_text(_before)
            print('templates of ' + _name + ' kept as they were: ' + (_c.stdout + _c.stderr)[-300:])
        else:
            print(_r.stdout.strip() + '; ' + _c.stdout.strip())
    # the website bundle may use names from the member bundle only inside the pages that run in a portal (listed here);
    # anything else must go through Lazy (load=${loadMember}) or the website would break before the portal loads
    _allowed = 'core.js::usTaxes,apply.js::ApplyProfilePage,apply.js::ApplyProfilesTab,exams.js::exCertPdf,exams.js::ExamRunner,exams.js::TestsPage,exams.js::CertsPage,billing.js::PlanNote,billing.js::PlanGate,billing.js::BillingPage,billing.js::PlanCard,billing.js::StudentHome,security.js::MySecurityPage,security.js::MustChangePassword,main.js::App,main.js::MemberHost,main.js::Site2Host,wsite.js::WsApp,site.js::LoginPage,site.js::PrivacyPage,site.js::QuickApply,site.js::EasyApply'
    # v62: the website's first bundle against the link pages and the portals; the link pages against the portals; the
    # staff bundle against the pages it fetches later (never: it would break at run time)
    for _what, _a, _b, _ok in [('website vs site2+member', BASE, SITE2 + MEMBER, _allowed), ('site2 vs member', SITE2, MEMBER, _allowed), ('staff vs staff2', STAFF, STAFF2, '')]:
        _g = subprocess.run(['node', str(_root / '_source' / 'bundlecheck.cjs'), _acorn, str(src), ','.join(_a), ','.join(_b), _ok], capture_output=True, text=True)
        if _g.returncode != 0:
            raise SystemExit('build stopped (' + _what + '): ' + _g.stdout + _g.stderr)
        print(_what + ': ' + _g.stdout.strip())

# No pre-compressed .gz copies any more: LiteSpeed hosts compressed them a second time (see .htaccess). Any left over
# from an older build are removed so they never ship again.
for _old in list(_root.rglob('*.gz')):
    if 'storage' not in _old.parts and 'node_modules' not in _old.parts:
        _old.unlink()
print('old gzip copies removed')

# v35: the browser companion people download from the Application bot page is zipped from browser-companion/ on every
# build (fixed dates and order, so an unchanged companion gives the same zip and the upload check stays quiet)
import zipfile
_comp = _root / 'browser-companion'
_zip = _root / 'application-bot' / 'companion.zip'
_zip.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(_zip, 'w', zipfile.ZIP_DEFLATED) as _z:
    for _p in sorted(_comp.rglob('*')):
        if _p.is_file() and _p.name != '.DS_Store':
            _info = zipfile.ZipInfo('stratedge-companion/' + _p.relative_to(_comp).as_posix(), date_time=(2026, 1, 1, 0, 0, 0))
            _info.compress_type = zipfile.ZIP_DEFLATED
            _info.external_attr = 0o644 << 16
            _z.writestr(_info, _p.read_bytes())
print('companion zipped: ' + str(_zip.stat().st_size) + ' bytes')

# The upload check (Admin > System health > Version & upload) compares every shipped file with this list, so an
# incomplete or stale upload shows up by name. Files people edit by hand are listed without a size.
EDITED = {'api/config.php', 'js/config.js', '.htaccess'}   # hosts add their own lines to .htaccess (PHP handler), so presence only
SKIP_DIRS = {'storage', 'node_modules', '__pycache__', '.git'}
_files = {}
_sha = {}
for _p in sorted(_root.rglob('*')):
    if not _p.is_file(): continue
    _rel = _p.relative_to(_root).as_posix()
    if any(part in SKIP_DIRS for part in _p.relative_to(_root).parts) or _rel == 'api/manifest.json' or _rel.endswith('.pyc') or _rel == '.DS_Store': continue
    _files[_rel] = None if _rel in EDITED else _p.stat().st_size
    # v34: the daily file integrity check compares every shipped file with its SHA-256 from this build
    if _rel not in EDITED:
        _sha[_rel] = hashlib.sha256(_p.read_bytes()).hexdigest()
# the main .htaccess: the integrity check compares it without the lines cPanel adds itself (PHP handler blocks)
_ht = _root / '.htaccess'
if _ht.is_file():
    _sha['.htaccess#core'] = hashlib.sha256(_ht.read_text().replace('\r\n', '\n').strip().encode()).hexdigest()
for _rel in ['storage/.htaccess', 'storage/files/.htaccess']:   # protect the data folder; checked for presence only
    if (_root / _rel).is_file(): _files[_rel] = None
(_root / 'api' / 'manifest.json').write_text(json.dumps({'version': VERSION, 'build': build, 'files': _files, 'sha': _sha}, indent=0))
print('manifest: ' + str(len(_files)) + ' files, ' + VERSION)
