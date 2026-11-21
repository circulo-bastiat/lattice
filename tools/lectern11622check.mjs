#!/usr/bin/env node
// lectern11622check.mjs - #11622 (AUDIT-MAP). 14n_book.js LecternScreen state (Book.openLectern) and its entry points.
import { readFileSync } from 'node:fs';
import { loadEngine, SRC } from './loadsrc.mjs';
const rd = (f) => readFileSync(SRC + '/' + f, 'utf8');
const hud = rd('15_hud.js'), use = rd('14l_use.js');
let N = 0;
function run(patch) {
  const f = [];
  const ok = (c, m) => { N++; if (!c) f.push(m); };
  try {
    const M = loadEngine({ extra: ['14n_book.js'], dom: false, ...(patch ? { patch: (fn, t) => (fn === '14n_book.js' ? patch(t) : t) } : {}) });
    const bes = {}, calls = [];
    M.BlockEntities = { get: (x, y, z) => bes[x + ',' + y + ',' + z] || null };
    M.Use = M.Use || {};
    M.Use.lecternButton = (x, y, z, P, id) => { calls.push([x, y, z, P, id]); const b = bes[x + ',' + y + ',' + z]; if (id === 2) b.page++; if (id === 3) { b.book = null; } return true; };
    const B = M.Book;
    ok(B.openLectern(1, 2, 3) === null, 'no BE -> null');
    bes['1,2,3'] = { book: null, page: 0 };
    ok(B.openLectern(1, 2, 3) === null, 'no book -> null');
    bes['1,2,3'] = { book: { t: { title: 't', author: 'a', pages: ['a', 'b', 'c'] } }, page: 1 };
    const r = B.openLectern(1, 2, 3);
    ok(r && r.x === 1 && r.y === 2 && r.z === 3 && r.page === 1 && r.pages === 3, 'state');
    ok(r.stack === bes['1,2,3'].book, 'stack is the BE book');
    ok(r.button(2) === true && calls.length === 1 && calls[0].join() === '1,2,3,,2' && calls[0][3] === null, 'button forwards to Use.lecternButton');
    ok(r.page === 2, 'page re-read from BE');
    r.button(3); ok(r.page === 2, 'taken book keeps page');
    M.Use.onLecternScreen(1, 2, 3);
    ok(B.screen === null, 'onLecternScreen sets B.screen (BE now empty)');
    bes['1,2,3'] = { book: { t: { pages: ['a'] } }, page: 0 };
    M.Use.onLecternScreen(1, 2, 3);
    ok(B.screen && B.screen.pages === 1, 'onLecternScreen opens');
  } catch (e) { f.push('threw ' + e.message); }
  return f;
}
const wired = /NS\.Use\.onLecternScreen = function \(x, y, z, P\) \{[^}]*NS\.Book\.openLectern\(x, y, z\)/.test(hud)
  && /Use\.onLecternScreen\(x, y, z, P\)/.test(use) && /NS\.Use\.lecternButton\(r\.x, r\.y, r\.z/.test(hud);
const base = run(null);
if (base.length) { console.log('FAIL baseline: ' + base.join('; ')); process.exit(1); }
if (!wired) { console.log('FAIL entry point not wired (15_hud.js / 14l_use.js)'); process.exit(1); }
const muts = [
  ['null BE', (t) => t.replace('if (!be || !be.book) return null;', '')],
  ['page', (t) => t.replace('page: be.page | 0,', 'page: 0,')],
  ['pages', (t) => t.replace('pages: B.pageCount(be.book), sounds: [] };\n    r.button', 'pages: 0, sounds: [] };\n    r.button')],
  ['coords', (t) => t.replace('{ x: x, y: y, z: z, stack', '{ x: 0, y: y, z: z, stack')],
  ['button fwd', (t) => t.replace('NS.Use.lecternButton(x, y, z, null, id)', 'true')],
  ['page reread', (t) => t.replace('r.page = b && b.book ? b.page | 0 : r.page;', '')],
  ['screen hook', (t) => t.replace('B.screen = B.openLectern(x, y, z)', 'B.screen = null')],
];
let caught = 0; const missed = [];
for (const [name, fn] of muts) {
  const probe = (t) => { const o = fn(t); if (o === t) throw new Error('mutant did not change source: ' + name); return o; };
  let f; try { f = run(probe); } catch (e) { if (/did not change/.test(e.message)) { console.log('FAIL ' + e.message); process.exit(1); } f = ['threw']; }
  if (f.length) { caught++; console.log('   ✓ cutting ' + name + ' fails: ' + f[0].slice(0, 70)); } else { missed.push(name); console.log('  FAIL cutting ' + name + ' went unnoticed'); }
}
console.log(` assertions passed .. ${N / (muts.length + 1) | 0}`);
console.log(`${caught} breaks caught`);
if (missed.length) { console.log('FAIL missed: ' + missed.join(', ')); process.exit(1); }
