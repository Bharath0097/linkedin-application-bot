/* Small shims so the site behaves the same in older browsers, and a plain message for ones that cannot run it. */
(function () {
  'use strict';
  var ok =
    typeof Promise === 'function' &&
    typeof fetch === 'function' &&
    typeof Symbol === 'function' &&
    typeof Object.fromEntries === 'function' &&
    typeof Array.prototype.flat === 'function' &&
    typeof String.prototype.padStart === 'function';
  if (!ok) {
    var show = function () {
      var el = document.getElementById('app') || document.getElementById('root') || document.body;
      el.innerHTML =
        '<div style="font:16px/1.6 Arial,sans-serif;max-width:560px;margin:60px auto;padding:24px;border:1px solid #ddd;border-radius:12px">' +
        '<h1 style="font-size:22px;margin:0 0 8px">Please update your browser</h1>' +
        '<p>This site needs a current version of Chrome, Edge, Firefox or Safari. Update your browser, or open the site on your phone, and it will work normally.</p>' +
        '<p>Email <a href="mailto:info@stratedgeitconsulting.com">info@stratedgeitconsulting.com</a> if you need help.</p></div>';
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show);
    else show();
    return;
  }
  if (!String.prototype.replaceAll) {
    String.prototype.replaceAll = function (a, b) {
      return a instanceof RegExp ? this.replace(a, b) : this.split(a).join(b);
    };
  }
  if (!Array.prototype.at) {
    Array.prototype.at = function (i) {
      i = Math.trunc(i) || 0;
      if (i < 0) i += this.length;
      return i < 0 || i >= this.length ? undefined : this[i];
    };
  }
  if (!String.prototype.at) {
    String.prototype.at = function (i) {
      i = Math.trunc(i) || 0;
      if (i < 0) i += this.length;
      return i < 0 || i >= this.length ? undefined : this.charAt(i);
    };
  }
  if (!Array.prototype.findLast) {
    Array.prototype.findLast = function (fn) {
      for (var i = this.length - 1; i >= 0; i--) if (fn(this[i], i, this)) return this[i];
      return undefined;
    };
  }
  if (!Object.hasOwn) {
    Object.hasOwn = function (o, k) {
      return Object.prototype.hasOwnProperty.call(o, k);
    };
  }
  if (!Promise.allSettled) {
    Promise.allSettled = function (list) {
      return Promise.all(
        Array.from(list).map(function (p) {
          return Promise.resolve(p).then(
            function (value) { return { status: 'fulfilled', value: value }; },
            function (reason) { return { status: 'rejected', reason: reason }; }
          );
        })
      );
    };
  }
  if (typeof window.structuredClone !== 'function') {
    window.structuredClone = function (v) {
      return JSON.parse(JSON.stringify(v));
    };
  }
  if (window.crypto && !window.crypto.randomUUID) {
    window.crypto.randomUUID = function () {
      var b = new Uint8Array(16);
      window.crypto.getRandomValues(b);
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      var h = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
      return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
    };
  }
  if (!Element.prototype.replaceChildren) {
    Element.prototype.replaceChildren = function () {
      while (this.lastChild) this.removeChild(this.lastChild);
      for (var i = 0; i < arguments.length; i++) this.appendChild(arguments[i]);
    };
  }
  // If a script file fails to load or cannot be parsed, say so instead of leaving the "Loading…" line forever.
  // Only the start-up phase is watched; once the app has drawn the page it reports its own problems.
  window.addEventListener(
    'error',
    function (e) {
      var app = document.getElementById('app');
      if (!app || !app.querySelector('[data-boot]')) return;
      var t = e.target;
      var msg = '';
      var detail = '';
      if (t && t !== window && t.tagName === 'SCRIPT' && t.src) {
        msg = 'The file ' + t.src.replace(/^.*\/(js\/)/, '$1').replace(/\?.*$/, '') + ' could not be loaded. Check that the js folder was uploaded completely, then reload.';
      } else if (e.message && /SyntaxError|Unexpected token|Invalid or unexpected|expected expression/i.test(e.message)) {
        msg = 'This browser could not read the site’s script. Update the browser, or open the site on your phone.';
        detail = e.message;
      } else if (e.message) {
        msg = 'Something went wrong while the site was starting. Reload the page; if it happens again, send the details below to info@stratedgeitconsulting.com.';
        detail = e.message + (e.error && e.error.stack ? '\n' + String(e.error.stack).split('\n').slice(0, 4).join('\n') : '') + '\n' + location.href + '\n' + navigator.userAgent;
      } else return;
      var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); };
      app.innerHTML =
        '<div style="font:16px/1.6 Arial,sans-serif;max-width:620px;margin:60px auto;padding:24px;border:1px solid #ddd;border-radius:12px">' +
        '<h1 style="font-size:22px;margin:0 0 8px">The site could not start</h1><p>' + esc(msg) + '</p>' +
        '<p><button type="button" onclick="location.reload()" style="font:inherit;padding:8px 16px;border-radius:8px;border:1px solid #999;background:#fff;cursor:pointer">Reload</button></p>' +
        (detail ? '<pre style="font:12px/1.5 monospace;white-space:pre-wrap;word-break:break-word;background:#f3f4f6;padding:10px;border-radius:8px">' + esc(detail) + '</pre>' : '') +
        '<p>Email <a href="mailto:info@stratedgeitconsulting.com">info@stratedgeitconsulting.com</a> if you need help.</p></div>';
    },
    true
  );
  // Older browsers can't use the :has() selector the stylesheet relies on for the public pages, so a class stands in.
  var sync = function () {
    var on = !!document.querySelector('.site');
    document.documentElement.classList.toggle('site-on', on);
    if (document.body) document.body.classList.toggle('site-on', on);
  };
  var start = function () {
    sync();
    window.addEventListener('hashchange', function () { setTimeout(sync, 0); });
    if (window.MutationObserver) new MutationObserver(sync).observe(document.body, { childList: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
