/* The first script on every page (v34: moved out of index.html so the Content-Security-Policy can forbid inline
   scripts). It asks the server who is signed in while the other scripts download, shows a clear message when a script
   cannot load or run instead of spinning forever, and reports anything the security policy blocks (Admin > Security
   center > Monitoring) so a blocked feature is noticed. */
(function () {
  'use strict';
  // v38: the portals' look (Glass, or Classic when the person or the administrator chose it) and which part of the site
  // this is, set before anything is drawn so no page flashes in the other look (core.js applyLook and lookArea keep them
  // up to date afterwards)
  try {
    var de = document.documentElement;
    var look = '';
    try {
      look = localStorage.getItem('look') || localStorage.getItem('lookSite:' + location.pathname) || '';
    } catch (e) {
      /* storage blocked: Glass */
    }
    de.setAttribute('data-look', look === 'classic' ? 'classic' : 'glass');
    var hp = (location.hash || '').replace(/^#/, '').split('?')[0];
    de.setAttribute('data-area', /^\/(portal|client)(\/|$)/.test(hp) ? 'app' : /^\/(login|forgot|reset|stop-change|ws-setup|get-portal)$/.test(hp) ? 'auth' : 'site');
  } catch (e) {
    /* very old browser */
  }
  // Ask the server who is signed in while the scripts are still downloading; app.js picks the answer up (core.js reloadCaps).
  try {
    window.__earlyMe = fetch('api/index.php?r=me', { credentials: 'same-origin', cache: 'no-store', headers: { 'X-Requested-With': 'fetch' } })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .catch(function () {
        return null;
      });
  } catch (e) {
    /* very old browser */
  }
  // v45.2: what this address needs next downloads right after the main script, one part after the other in the order
  // the page runs them (on a slow line the main script and the stylesheet get the whole line first): the portals
  // (js/member.js), the staff pages (js/staff.js), the work boards (js/work.js). For someone signed in on the website or
  // on the sign-in page, the portals once the page is up.
  try {
    var bv = /[?&]v=([^&]+)/.exec((document.currentScript && document.currentScript.src) || '');
    var queue = [];
    var busy = false;
    var go = false;
    var have = function (f) {
      return !!document.querySelector('link[data-pre="' + f + '"]');
    };
    var next = function () {
      if (!go || busy || !bv) return;
      var f = queue.shift();
      while (f && have(f)) f = queue.shift();
      if (!f) return;
      var l = document.createElement('link');
      l.rel = 'preload';
      l.as = 'script';
      l.href = 'js/' + f + '.js?v=' + bv[1];
      l.setAttribute('data-pre', f);
      busy = true;
      l.onload = l.onerror = function () {
        busy = false;
        next();
      };
      document.head.appendChild(l);
    };
    var pre = function (f) {
      if (queue.indexOf(f) < 0 && !have(f)) queue.push(f);
      next();
    };
    var start = function () {
      if (go) return;
      go = true;
      next();
    };
    // once the stylesheet has arrived (the main script is well on its way then; a browser that cannot tell starts at once)
    try {
      var po = new PerformanceObserver(function (list) {
        var es = list.getEntries();
        for (var i = 0; i < es.length; i++)
          if (/\/css\/styles\.css/.test(es[i].name)) {
            po.disconnect();
            start();
          }
      });
      po.observe({ type: 'resource', buffered: true });
    } catch (e) {
      start();
    }
    addEventListener('load', start);
    var later = function () {
      addEventListener('load', function () {
        setTimeout(function () {
          pre('member');
        }, 1500);
      });
    };
    var hp2 = (location.hash || '').replace(/^#/, '').split('?')[0];
    var inPortal = /^\/(portal|client)(\/|$)/.test(hp2);
    // v62: the sign-in and link pages (js/site2.js) on their own addresses, and before the portals (which need it)
    if (inPortal || /^\/(sign|invoice)\//.test(hp2) || hp2 === '/id' || /^\/(login|forgot|reset|stop-change|plans|pricing|verify|confirm|rtr|my-details|get-portal|security|support|privacy|ws-setup)$/.test(hp2)) pre('site2');
    if (inPortal || /^\/(sign|invoice)\//.test(hp2) || hp2 === '/id') pre('member');
    if (/^\/portal\/(admin|hr|acct|mgr)(\/|$)/.test(hp2)) pre('staff');
    if (/^\/portal\/(admin|hr|acct|mgr)\/(books|idscan|sources|compliance|learning|exams|billing|jobrules|trust|governance|privacy|practice|workspaces|phone)(\/|$|\?)/.test(hp2) || /^\/portal\/tools\/idscan/.test(hp2)) pre('staff2');
    if (/^\/portal\/[^/?]+\/(work|claims|goals|immig|expenses)(\/|$)|^\/portal\/(work|claims|goals|expenses)(\/|$)|^\/atty$/.test(hp2)) pre('work');
    if (window.__earlyMe)
      window.__earlyMe.then(function (r) {
        if (!r || !r.user) return;
        if (!inPortal) return later();
        var roles = r.user.roles || [];
        for (var i = 0; i < roles.length; i++) if (/^(admin|hr|acct|manager)$/.test(roles[i])) { pre('staff'); return pre('staff2'); }
      });
    if (hp2 === '/login') later();
  } catch (e) {
    /* the pages load what they need themselves */
  }
  // v37: a company workspace's address (/w/<name>/, a subdomain or the company's own domain) shows the company's name
  // while the page loads, never StratEdge's
  try {
    var bootName = function (t) {
      var b = document.querySelector('[data-boot] b');
      if (b) b.textContent = t;
      // v45.2: if boot.js ever runs before the loading screen exists
      else if (document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded', function () {
          var b2 = document.querySelector('[data-boot] b');
          if (b2) b2.textContent = t;
        });
    };
    var host = location.hostname.replace(/^www\./, '');
    if (/^\/w\/[a-z0-9-]{1,30}\//.test(location.pathname) || (host !== 'stratedgeitconsulting.com' && host !== 'localhost' && host !== '127.0.0.1')) {
      bootName('');
      if (window.__earlyMe)
        window.__earlyMe.then(function (r) {
          bootName(r && r.ws && r.ws.name ? r.ws.name : r && r.ws ? '' : 'StratEdge IT Consulting');
        });
    }
  } catch (e) {
    /* cosmetic only */
  }
  var shown = false;
  function failed(what) {
    var el = document.querySelector('[data-boot]');
    if (shown || !el) return;
    shown = true;
    el.innerHTML =
      '<div style="max-width:520px;padding:0 20px"><b>The site could not start</b><div style="font-size:15px;line-height:1.55">' +
      what +
      '</div><div style="margin-top:16px"><button type="button" data-retry style="font:inherit;font-weight:700;padding:10px 18px;border-radius:10px;border:0;background:#2b3993;color:#fff;cursor:pointer">Try again</button></div><div style="margin-top:14px;font-size:13px;color:#6e7c96">If it keeps happening, tell us: info@stratedgeitconsulting.com</div></div>';
    var b = el.querySelector('[data-retry]');
    if (b)
      b.addEventListener('click', function () {
        location.reload();
      });
  }
  window.__bootFail = function (name) {
    failed('The file <code>' + String(name).replace(/[<>&"]/g, '') + '</code> did not load. This is usually a server or hosting setting (for example scripts being compressed twice), not your connection.');
  };
  // a script file that cannot be fetched (the capturing listener sees load errors of every <script> on the page)
  window.addEventListener(
    'error',
    function (e) {
      var t = e && e.target;
      if (t && t.tagName === 'SCRIPT' && document.querySelector('[data-boot]')) {
        var src = (t.getAttribute('src') || '').split('?')[0];
        if (src && src.indexOf('http') !== 0) window.__bootFail(src);
        return;
      }
      // a script that downloaded but cannot even be parsed (a corrupted or half-uploaded file)
      var se = e && e.error && e.error.name === 'SyntaxError';
      if (se && document.querySelector('[data-boot]')) failed('The main script downloaded but could not be read (' + (e.message || 'syntax error') + '). The upload may be incomplete or the host may be altering the file.');
    },
    true
  );
  setTimeout(function () {
    if (document.querySelector('[data-boot]')) failed('The page is taking much longer than it should. The server may be busy or a script may be blocked.');
  }, 25000);
  // what the Content-Security-Policy blocked, a few per page at most
  var sent = 0;
  var seen = {};
  document.addEventListener('securitypolicyviolation', function (e) {
    try {
      var key = (e.effectiveDirective || e.violatedDirective || '') + '|' + (e.blockedURI || '');
      if (seen[key] || sent >= 5) return;
      seen[key] = 1;
      sent++;
      var body = JSON.stringify({ dir: e.effectiveDirective || e.violatedDirective || '', blocked: String(e.blockedURI || '').slice(0, 300), page: location.pathname + location.hash.split('?')[0], line: e.lineNumber || 0, src: String(e.sourceFile || '').slice(0, 200) });
      fetch('api/index.php?r=csp_report', { method: 'POST', credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function () {});
    } catch (x) {
      /* reporting never breaks the page */
    }
  });
})();
