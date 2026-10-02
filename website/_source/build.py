"""Rebuilds js/app.js and css/styles.css (one folder up) from _source/src."""
import pathlib
here = pathlib.Path(__file__).parent; site = here.parent; src = here / 'src'
(site / 'css' / 'styles.css').write_text((src / 'styles.css').read_text())
(site / 'js' / 'app.js').write_text("'use strict';\n" + '\n'.join((src / f).read_text() for f in ['core.js', 'site.js', 'fx.js', 'portal.js', 'client.js', 'rec.js', 'jobs.js', 'hr.js', 'esign.js', 'invoices.js', 'acct.js', 'ats.js', 'admin.js', 'main.js']))
print('rebuilt js/app.js and css/styles.css')
