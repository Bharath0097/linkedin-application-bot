#!/usr/bin/env node
/* v45.2: smaller bundles. The pages are written as html`…` templates (htm), and the indentation inside them made up a
   large part of every bundle (minifiers keep template text as it is). This removes the whitespace that htm itself
   throws away when it reads a template, so every page renders the same:
     - inside a tag, between attributes: a run of spaces and line breaks becomes one space;
     - text next to a tag or a ${…} value: a run of whitespace with a line break is dropped (htm trims those);
     - inside other text: a run of spaces and line breaks becomes one line break;
     - quoted attribute values and <!-- comments --> stay exactly as written.
   It reads each template the way htm does (text, tag, quoted value, comment) across its ${…} values.
   Usage: node htmsqueeze.cjs <acorn module> file.js [more.js …]    rewrites the files in place
          node htmsqueeze.cjs <acorn module> --check <htm module> before.js after.js
             compares what htm builds from every template in the two files (the release check) */
'use strict';
const fs = require('fs');
const acorn = require(process.argv[2]);

const TEXT = 0;
const TAG = 1;
const QUOTE = 2;
const COMMENT = 3;
const SEP = ' \t\n\r';

// one template's static parts (raw source text) -> the same parts without the whitespace htm ignores
function squeeze(parts) {
  let mode = TEXT;
  let quote = '';
  let pieceStart = true; // TEXT: nothing but whitespace since this text piece began
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const s = parts[i];
    if (i > 0 && mode === TEXT) pieceStart = true; // a ${…} value ends the text piece before it
    let o = '';
    let j = 0;
    while (j < s.length) {
      const ch = s[j];
      if (mode === COMMENT) {
        o += ch;
        j++;
        if (ch === '>' && o.endsWith('-->')) {
          mode = TEXT;
          pieceStart = true;
        }
        continue;
      }
      if (mode === QUOTE) {
        o += ch;
        j++;
        if (ch === quote) mode = TAG;
        continue;
      }
      if (mode === TAG) {
        if (SEP.includes(ch)) {
          let k = j;
          while (k < s.length && SEP.includes(s[k])) k++;
          o += o.endsWith('\\') ? s.slice(j, k) : ' ';
          j = k;
          continue;
        }
        if (ch === '"' || ch === "'") {
          quote = ch;
          mode = QUOTE;
        } else if (ch === '>') {
          mode = TEXT;
          pieceStart = true;
        }
        o += ch;
        j++;
        continue;
      }
      // TEXT
      if (/\s/.test(ch)) {
        let k = j;
        while (k < s.length && /\s/.test(s[k])) k++;
        const run = s.slice(j, k);
        const atEnd = k === s.length || s[k] === '<'; // the piece ends here: a ${…} value, the end, or a tag
        if (!run.includes('\n') || o.endsWith('\\')) o += run;
        else if (pieceStart || atEnd) {
          // htm removes /^\s*\n\s*/ and /\s*\n\s*$/ from every text piece
        } else if (/^[ \t\n\r]+$/.test(run)) o += '\n';
        else o += run;
        j = k;
        continue;
      }
      if (ch === '<') {
        if (s.startsWith('!--', j + 1)) {
          mode = COMMENT;
          o += '<!--';
          j += 4;
          continue;
        }
        mode = TAG;
      } else {
        pieceStart = false;
      }
      o += ch;
      j++;
    }
    out.push(o);
  }
  return out;
}

const parse = src => acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true });
function templates(src) {
  const found = [];
  (function walk(n) {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'TaggedTemplateExpression' && n.tag.type === 'Identifier' && n.tag.name === 'html') found.push(n.quasi.quasis);
    for (const k in n) {
      if (k === 'loc' || k === 'start' || k === 'end') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v.type === 'string') walk(v);
    }
  })(parse(src));
  return found;
}

function run(file) {
  const src = fs.readFileSync(file, 'utf8');
  const edits = [];
  for (const q of templates(src)) {
    const raw = q.map(x => src.slice(x.start, x.end));
    const neu = squeeze(raw);
    q.forEach((x, i) => neu[i] !== raw[i] && edits.push([x.start, x.end, neu[i]]));
  }
  edits.sort((a, b) => b[0] - a[0]);
  let out = src;
  for (const [s, e, t] of edits) out = out.slice(0, s) + t + out.slice(e);
  parse(out); // still valid JavaScript
  fs.writeFileSync(file, out);
  return [src.length, out.length, edits.length];
}

// the release check: htm's view of every template, before and after (text compared with its runs of spaces and
// line breaks made one space, which is how a browser shows them)
function check(htmPath, before, after) {
  global.self = global;
  const htm = require(htmPath);
  const h = (type, props, ...children) => ({ type, props, children });
  const H = (htm.default || htm).bind(h);
  const norm = v => {
    if (Array.isArray(v)) return v.map(norm).filter(x => x !== '');
    if (v && typeof v === 'object') return { type: norm(v.type), props: v.props && Object.fromEntries(Object.entries(v.props).map(([k, x]) => [k, norm(x)])), children: norm(v.children) };
    return typeof v === 'string' ? v.replace(/[ \t\n\r]+/g, ' ') : v;
  };
  const a = templates(fs.readFileSync(before, 'utf8'));
  const b = templates(fs.readFileSync(after, 'utf8'));
  if (a.length !== b.length) throw new Error('template count differs: ' + a.length + ' vs ' + b.length);
  let diff = 0;
  a.forEach((qa, i) => {
    const qb = b[i];
    const fields = qa.slice(1).map((_, k) => '\u0001F' + k + '\u0001');
    const ta = norm(H(Object.assign(qa.map(x => x.value.cooked), { raw: qa.map(x => x.value.raw) }), ...fields));
    const tb = norm(H(Object.assign(qb.map(x => x.value.cooked), { raw: qb.map(x => x.value.raw) }), ...fields));
    if (JSON.stringify(ta) !== JSON.stringify(tb)) {
      if (diff++ < 5) console.log('DIFFERENT #' + i + '\n  ' + JSON.stringify(ta).slice(0, 400) + '\n  ' + JSON.stringify(tb).slice(0, 400));
    }
  });
  console.log('checked ' + a.length + ' templates: ' + (diff ? diff + ' differ' : 'all the same'));
  return diff;
}

if (require.main === module) {
  if (process.argv[3] === '--check') {
    process.exit(check(process.argv[4], process.argv[5], process.argv[6]) ? 1 : 0);
  }
  for (const f of process.argv.slice(3)) {
    const [a, b, n] = run(f);
    console.log('squeezed ' + f + ': ' + a + ' -> ' + b + ' bytes (' + n + ' template parts)');
  }
}
module.exports = { squeeze };
