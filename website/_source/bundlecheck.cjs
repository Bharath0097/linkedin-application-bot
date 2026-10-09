#!/usr/bin/env node
/* v45.2 build check: js/app.js (the website) is loaded alone until someone opens a portal, so a website file may use a
   name from the member bundle (js/member.js) only inside the functions listed as running in a portal, or through Lazy.
   Usage: node bundlecheck.cjs <acorn module> <src dir> <base files> <member files> <allowed file::function,...>
   Prints the uses that break the rule and exits 1, or a one-line OK. */
'use strict';
const fs = require('fs');
const path = require('path');
const acorn = require(process.argv[2]);
const dir = process.argv[3];
const base = process.argv[4].split(',');
const member = process.argv[5].split(',');
const allowed = new Set(process.argv[6].split(','));
const parse = f => acorn.parse(fs.readFileSync(path.join(dir, f), 'utf8'), { ecmaVersion: 'latest', sourceType: 'script' });
const owner = {};
for (const f of member) {
  for (const n of parse(f).body) {
    if ((n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') && n.id) owner[n.id.name] = f;
    if (n.type === 'VariableDeclaration')
      for (const d of n.declarations) {
        if (d.id.type === 'Identifier') owner[d.id.name] = f;
        if (d.id.type === 'ObjectPattern') for (const p of d.id.properties) if (p.value && p.value.type === 'Identifier') owner[p.value.name] = f;
      }
  }
}
// a website file's own top-level names win over the member bundle's (they are the same global)
const own = new Set();
for (const f of base)
  for (const n of parse(f).body) {
    if ((n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') && n.id) own.add(n.id.name);
    if (n.type === 'VariableDeclaration') for (const d of n.declarations) if (d.id.type === 'Identifier') own.add(d.id.name);
  }
// every identifier in a node, except property names (a.b, { b: 1 })
function idents(node, out) {
  (function visit(n, parent) {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'Identifier') {
      const isProp = parent && ((parent.type === 'MemberExpression' && parent.property === n && !parent.computed) || (parent.type === 'Property' && parent.key === n && !parent.computed && !parent.shorthand) || ((parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') && parent.key === n));
      if (!isProp) out.add(n.name);
      return;
    }
    for (const k in n) {
      if (k === 'type' || k === 'start' || k === 'end' || k === 'loc') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(x => visit(x, n));
      else if (v && typeof v.type === 'string') visit(v, n);
    }
  })(node, null);
  return out;
}
const bad = [];
let checked = 0;
for (const f of base) {
  for (const n of parse(f).body) {
    const name = n.id ? n.id.name : n.type === 'VariableDeclaration' ? n.declarations.map(d => (d.id && d.id.name) || '?').join(',') : '(top level)';
    const used = [...idents(n, new Set())].filter(x => owner[x] && !own.has(x));
    checked++;
    if (used.length && !allowed.has(f + '::' + name)) bad.push(f + ' :: ' + name + ' uses ' + used.map(x => x + ' (' + owner[x] + ')').join(', '));
  }
}
if (bad.length) {
  console.log('the website bundle (js/app.js) uses names from js/member.js outside the portal pages:\n  ' + bad.join('\n  ') + '\nShow them through <${Lazy} load=${loadMember} get=${() => Name} ... /> or move them to a website file.');
  process.exit(1);
}
console.log('bundle check: ' + checked + ' website declarations use the member bundle only where allowed');
