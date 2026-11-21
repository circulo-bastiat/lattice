#!/usr/bin/env node
// credits11615check.mjs — #11615 (AUDIT-MAP). 15m_credits.js CreditsScreen: build layout, speed, keys, close/finish, entry points.
import { readFileSync } from 'node:fs';
import { loadEngine, SRC } from './loadsrc.mjs';
let N = 0;
const rd = (f) => readFileSync(SRC + '/' + f, 'utf8');
const hud = rd('15_hud.js'), title = rd('15m_title.js'), main = rd('17_main.js');
function run(patch) {
  const f = [];
  const ok = (c, m) => { N++; if (!c) f.push(m); };
  try {
    const E = loadEngine({ extra: ['15m_credits.js'], ...(patch ? { patch: (fn, t) => (fn === '15m_credits.js' ? patch(t) : t) } : {}) });
    const C = E.Credits;
    const data = [{ section: 'S', titles: [{ title: 'T', names: ['a', 'b'] }] }];
    const L = C.build(data, false);
    ok(L.length === 3 + 2 + 1 + 2 + 2 && L[0].t === '============' && L[0].center && L[1].t === 'S' && L[1].color === C.YELLOW, 'section header');
    ok(L[5].t === 'T' && L[5].color === C.GRAY && !L[5].center && L[6].t === ' '.repeat(11) + 'a' && L[6].color === C.WHITE, 'title and names');
    const P = C.build(data, true, ['hello', '']);
    ok(P.length === L.length + 1 + 1 + 8 && P[L.length].t === 'hello', 'postcredits: no trailing blank, 8 empties');
    ok(C.build(data, false, ['x']).length === L.length, 'poem only on end path');
    const w = C.wrap('aaaa bbbb cccc', 30);
    ok(w.length === 3 || w.length === 2, 'wrap splits'); ok(C.wrap('a '.repeat(200).trim(), 274).length > 1, 'wrap long');
    let fin = 0; E.Hud = E.Hud || {}; E.Gui = E.Gui || {}; E.Gui.credits = data;
    C.open(false, () => fin++);
    ok(E.Hud.titleView === 'credits' && C.view.base === 0.75 && C.view.height === L.length * 12, 'open');
    C.open(true); ok(C.view.base === 0.5, 'end base'); C.close();
    C.open(false, () => fin++);
    const v = C.view;
    ok(C.speed(v) === 0.75, 'plain speed');
    C.keyDown(' '); ok(C.speed(v) === 3.75, 'space x5');
    C.keyDown('Control'); ok(Math.abs(C.speed(v) - 0.75 * 20) < 1e-9, 'ctrl +15');
    C.keyUp('Control'); C.keyUp(' '); ok(C.speed(v) === 0.75, 'release');
    C.advance(10, 100); ok(Math.abs(v.time - 7.5) < 1e-9, 'advance');
    C.advance(1e6, 100); ok(C.view === null && fin === 1 && E.Hud.titleView === 'main', 'runs past end closes + finish');
    C.open(false, () => fin++); C.keyDown('Escape'); ok(C.view === null && fin === 2, 'escape closes');
    ok(/NS\.Credits\.open\(\)/.test(title) && /NS\.Credits\.draw\(/.test(hud) && /NS\.Credits\.keyDown\(key\)/.test(hud) && /NS\.Credits\.keyUp/.test(main), 'entry points');
  } catch (e) { f.push('threw: ' + e.message); }
  return f;
}
const base = run(null);
if (base.length) { console.log('FAIL baseline: ' + base.join('; ')); process.exit(1); }
const muts = [
  ['indent', (t) => t.replace("C.INDENT = '           '", "C.INDENT = ''")],
  ['header color', (t) => t.replace('color: C.YELLOW, center: true', 'color: C.WHITE, center: true')],
  ['title gray', (t) => t.replace('color: C.GRAY, center: false', 'color: C.WHITE, center: false')],
  ['trailing blank', (t) => t.replace("postcredits[p] === ''", 'false')],
  ['end padding', (t) => t.replace('e < 8', 'e < 7')],
  ['end only', (t) => t.replace('if (endCredits && postcredits)', 'if (postcredits)')],
  ['end speed', (t) => t.replace('endCredits ? 0.5 : 0.75', '0.75')],
  ['space x5', (t) => t.replace('v.base * (5 + v.ctrl * 15)', 'v.base * 3')],
  ['ctrl', (t) => t.replace('v.ctrl * 15', 'v.ctrl * 5')],
  ['key up space', (t) => t.replace("if (key === ' ') v.space = false;", '')],
  ['escape', (t) => t.replace("if (key === 'Escape') C.close();", '')],
  ['finish', (t) => t.replace('if (v && v.finish) v.finish();', '')],
  ['end close', (t) => t.replace('if (v.time > v.height + gh + gh + 24) C.close();', '')],
  ['advance', (t) => t.replace('v.time += ticks * C.speed(v)', 'v.time += ticks')],
  ['title main', (t) => t.replace("NS.Hud.titleView = 'main'", "NS.Hud.titleView = 'credits'")],
  ['wrap', (t) => t.replace('tw(t) > max', 'false')],
];
let caught = 0; const missed = [];
for (const [name, fn] of muts) {
  const probe = (t) => { const o = fn(t); if (o === t) throw new Error('mutant did not change source: ' + name); return o; };
  let f; try { f = run(probe); } catch (e) { if (/did not change/.test(e.message)) { console.log('FAIL ' + e.message); process.exit(1); } f = ['threw']; }
  if (f.length) { caught++; console.log('   ✓ cutting ' + name + ' fails: ' + f[0].slice(0, 70)); } else { missed.push(name); console.log('  FAIL cutting ' + name + ' went unnoticed'); }
}
console.log(` assertions passed .. ${N / (muts.length + 1) | 0}`);
console.log(` failures ........... ${missed.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(missed.length ? 1 : 0);
