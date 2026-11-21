#!/usr/bin/env node
// advscreen11619check.mjs — #11619 (AUDIT-MAP). 15m_advscreen.js: AdvancementTab/TabType/Widget/Screen geometry and entry points.
import { readFileSync } from 'node:fs';
import { loadEngine, SRC } from './loadsrc.mjs';
let N = 0;
const opt = readFileSync(SRC + '/15f_options.js', 'utf8');
const node = (x, y, kids = [], extra = {}) => ({ display: { x, y, ...extra }, children: kids });
function run(patch) {
  const f = [];
  const ok = (c, m) => { N++; if (!c) f.push(m); };
  try {
    const E = loadEngine({ extra: ['15m_advscreen.js'], ...(patch ? { patch: (fn, t) => (fn === '15m_advscreen.js' ? patch(t) : t) } : {}) });
    const A = E.AdvScreen;
    ok(A.tabType(0).type.name === 'ABOVE' && A.tabType(7).type.name === 'ABOVE' && A.tabType(8).type.name === 'BELOW' && A.tabType(16).type.name === 'LEFT' && A.tabType(21).type.name === 'RIGHT' && A.tabType(26) === null, 'tab type allocation');
    ok(A.tabType(16).index === 0 && A.tabType(25).index === 4, 'tab index within type');
    const T = A.TYPES;
    ok(A.tabX(T[0], 2) === 64 && A.tabY(T[0], 2) === -28 && A.tabY(T[1], 0) === 136 && A.tabX(T[2], 0) === -28 && A.tabX(T[3], 0) === 248 && A.tabY(T[2], 2) === 56, 'tab positions');
    ok(A.tabUV(T[0], 0, false).u === 0 && A.tabUV(T[0], 3, false).u === 28 && A.tabUV(T[0], 7, true).u === 56 && A.tabUV(T[0], 3, true).v === 32, 'tab uv');
    const o = A.origin(400, 300);
    ok(o.x === 74 && o.y === 80, 'origin');
    ok(A.isClickOnTab(T[0], 0, 10, 100, 20, 80) && !A.isClickOnTab(T[0], 0, 10, 100, 10, 80), 'click on tab (exclusive edges)');
    const child = node(1, 2);
    const mgr = { roots: [node(0, 0, [child, node(3, 1, [], { hidden: true })]), { display: null, children: [] }, node(0, 0)] };
    const st = A.build(mgr);
    ok(st.tabs.length === 2 && st.selected === st.tabs[0], 'one tab per displayed root');
    const t = st.tabs[0];
    ok(t.widgets.length === 3 && t.widgets[1].x === 28 && t.widgets[1].y === 54, 'widget position floor(x*28),floor(y*27)');
    ok(t.minX === 0 && t.maxX === 112 && t.minY === 0 && t.maxY === 81, 'bounds');
    A.initTab(t); ok(t.originX === 117 - 56 && t.originY === 56 - 40 && t.init, 'centering');
    t.originX = 5; A.initTab(t); ok(t.originX === 5, 'init once'); t.originX = 61;
    const big = { minX: 0, maxX: 500, minY: 0, maxY: 400, originX: 0, originY: 0 };
    A.move(big, -1000, -1000); ok(big.originX === -(500 - 234) && big.originY === -(400 - 113), 'move clamps');
    A.move(big, 5000, 5000); ok(big.originX === 0 && big.originY === 0, 'move clamps top');
    const small = { minX: 0, maxX: 100, minY: 0, maxY: 50, originX: 3, originY: 4 };
    A.move(small, 10, 10); ok(small.originX === 3 && small.originY === 4, 'small tab does not pan');
    const L = A.layout(st, 400, 300, (a) => (a === child ? { isDone: () => false } : null));
    ok(L.tabs.length === 2 && L.tabs[0].selected && !L.tabs[1].selected && L.tabs[0].x === o.x + A.tabX(T[0], 0), 'layout tabs');
    ok(L.widgets.length === 2 && L.widgets[0].x === o.x + 9 + 61 && L.widgets[0].y === o.y + 18 + 16, 'layout widgets hide hidden');
    const L2 = A.layout(st, 400, 300, (a) => ({ isDone: () => true }));
    ok(L2.widgets.length === 3, 'hidden shown when done');
    A.state = A.build(mgr); A.state.selected = A.state.tabs[0];
    ok(A.selectAt(400, 300, o.x + 28 + 4 + 14, o.y - 10) && A.state.selected === A.state.tabs[1], 'selectAt switches tab');
    ok(!A.selectAt(400, 300, 0, 0), 'selectAt miss');
    A.state = A.build({ roots: [node(0, 0)] }); ok(!A.selectAt(400, 300, o.x + 14, o.y - 10), 'single tab not selectable');
    A.state = null; E.Adv = { manager: mgr }; A.open(); ok(A.state && A.state.tabs.length === 2, 'open builds from manager');
    ok(/NS\.AdvScreen\.open\(\)/.test(opt) && /NS\.AdvScreen\.draw\(c, w, h, s\)/.test(opt) && /NS\.AdvScreen\.selectAt\(/.test(opt), 'entry points');
  } catch (e) { f.push('threw: ' + e.message); }
  return f;
}
const base = run(null);
if (base.length) { console.log('FAIL baseline: ' + base.join('; ')); process.exit(1); }
const muts = [
  ['above type', (t) => t.replace("{ name: 'ABOVE', u: 0, v: 0, w: 28, h: 32, n: 8 }", "{ name: 'ABOVE', u: 0, v: 0, w: 28, h: 32, n: 7 }")],
  ['tab count', (t) => t.replace("w: 32, h: 28, n: 5 },\n    { name: 'RIGHT'", "w: 32, h: 28, n: 4 },\n    { name: 'RIGHT'")],
  ['tabX left', (t) => t.replace('-t.w + 4 : t.name', '-t.w : t.name')],
  ['tabY below', (t) => t.replace('? 136 :', '? 140 :')],
  ['tabY above', (t) => t.replace('-t.h + 4', '-t.h')],
  ['uv last', (t) => t.replace('if (index === t.n - 1) u += t.w;', '')],
  ['uv selected', (t) => t.replace('t.v + t.h : t.v', 't.v : t.v')],
  ['click bounds', (t) => t.replace('mx > x && mx', 'mx >= x && mx')],
  ['origin', (t) => t.replace('Math.floor((gh - AS.H) / 2)', 'Math.floor(gh / 2)')],
  ['skip no display', (t) => t.replace('if (!root.display) return;\n      var tt', 'var tt')],
  ['widget x', (t) => t.replace('a.display.x * 28', 'a.display.x * 27')],
  ['widget y', (t) => t.replace('a.display.y * 27', 'a.display.y * 28')],
  ['bounds max', (t) => t.replace('w.x + 28)', 'w.x)')],
  ['center x', (t) => t.replace('117 - ', '118 - ')],
  ['center y', (t) => t.replace('56 - Math.floor((tab.maxY', '57 - Math.floor((tab.maxY')],
  ['init once', (t) => t.replace('if (tab.init) return;', '')],
  ['move x clamp', (t) => t.replace('Math.min(0, Math.max(-(tab.maxX - AS.PW)', 'Math.min(0, Math.max(-(tab.maxX)')],
  ['move y gate', (t) => t.replace('tab.maxY - tab.minY > AS.PH', 'true')],
  ['hidden', (t) => t.replace('w.adv.display.hidden && !(p && p.isDone())', 'false')],
  ['layout offset', (t) => t.replace('o.x + AS.PX + ox + w.x', 'o.x + ox + w.x')],
  ['selectAt single', (t) => t.replace('st.tabs.length < 2', 'false')],
  ['selectAt set', (t) => t.replace('{ st.selected = st.tabs[i]; return true; }', '{ return true; }')],
  ['open manager', (t) => t.replace('NS.Adv && NS.Adv.manager', 'null')],
  ['selected default', (t) => t.replace('selected: tabs.length ? tabs[0] : null', 'selected: null')],
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
