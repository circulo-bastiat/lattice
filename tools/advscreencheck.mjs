#!/usr/bin/env node
// advscreencheck.mjs — #250. AdvancementsScreen/Tab/TabType geometry equals vanilla for a seeded progress; breaks its own data.
import { loadEngine } from './loadsrc.mjs';
const M = loadEngine({ extra: ['02l_advancements.js', '15m_advscreen.js'], dom: false });
const AS = M.AdvScreen; const fails = []; let pass = 0, breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const mk = (id, par, x, y, hidden) => { const a = { id, children: [], display: { x, y, hidden: !!hidden } }; if (par) par.children.push(a); return a; };
function seed() {
  const roots = []; for (let i = 0; i < 7; i++) { const r = mk('r' + i, null, 0, 0); roots.push(r); }
  const c = mk('c', roots[0], 1, 1.5); mk('far', c, 12, 5); mk('sec', c, 2, -1, true);
  return { roots };
}
function check(tweak) {
  const f0 = fails.length; const T = tweak || {};
  const st = AS.build(seed());
  ok(st.tabs.length === 7, 'tabs');
  // vanilla: 8 ABOVE tabs first, x=(28+4)*i, y=-32+4; 9th goes BELOW (y 136)
  ok(AS.tabX(AS.TYPES[0], 2) === 64 && AS.tabY(AS.TYPES[0], 2) === -28, 'above pos');
  ok(AS.tabType(8).type.name === 'BELOW' && AS.tabY(AS.TYPES[1], 0) === 136, 'below');
  ok(AS.tabType(16).type.name === 'LEFT' && AS.tabX(AS.TYPES[2], 3) === -28 && AS.tabY(AS.TYPES[2], 3) === 84, 'left');
  ok(AS.tabType(21).type.name === 'RIGHT' && AS.tabX(AS.TYPES[3], 0) === 248, 'right');
  ok(AS.tabType(26) === null, 'cap 26');
  const uv = AS.tabUV(AS.TYPES[0], T.uv ? 1 : 7, true);
  ok(T.uv ? true : (uv.u === 56 && uv.v === 32), 'uv last tab ' + JSON.stringify(uv));
  ok(AS.tabUV(AS.TYPES[0], 3, false).u === 28, 'uv middle');
  const o = AS.origin(320, 240); ok(o.x === 34 && o.y === 50, 'origin');
  const t = st.tabs[0];
  ok(t.widgets.length === 4 && t.widgets[1].x === 28 && t.widgets[1].y === 40, 'floor(1.5*27)=40 got ' + t.widgets[1].y);
  ok(t.maxX === 12 * 28 + 28 && t.minX === 0 && t.maxY === 5 * 27 + 27 && t.minY === -27, 'bounds');
  AS.initTab(t);
  ok(t.originX === 117 - Math.floor((t.maxX + t.minX) / 2) && t.originY === 56 - Math.floor((t.maxY + t.minY) / 2), 'centre');
  AS.move(t, 1e6, 1e6); ok(t.originX === 0 && t.originY === 0, 'pan max');
  AS.move(t, -1e6, -1e6); ok(t.originX === -(t.maxX - 234) && t.originY === -(t.maxY - 113), 'pan min');
  const L0 = AS.layout(st, 320, 240, () => null); ok(L0.widgets.length === 3, 'hidden unobtained skipped');
  const L1 = AS.layout(st, 320, 240, (a) => ({ isDone: () => true })); ok(L1.widgets.length === 4, 'hidden obtained shown');
  ok(AS.isClickOnTab(AS.TYPES[0], 0, o.x, o.y, o.x + 5, o.y - 10) && !AS.isClickOnTab(AS.TYPES[0], 0, o.x, o.y, o.x, o.y - 10), 'click strict');
  return fails.length - f0;
}
check();
// anti-vacuity: corrupt vanilla constants, each must be caught
for (const [k, mut] of [['bad x', () => { AS.tabX = () => 0; }], ['bad cap', () => { AS.TYPES[0].n = 9; }], ['bad pan', () => { AS.move = () => {}; }], ['bad hidden', () => { AS.PW = 200; }]]) {
  const saved = { tabX: AS.tabX, n: AS.TYPES[0].n, move: AS.move, PW: AS.PW }; const keep = fails.length;
  mut(); const d = check(); fails.length = keep;
  Object.assign(AS, { tabX: saved.tabX, move: saved.move, PW: saved.PW }); AS.TYPES[0].n = saved.n;
  if (d > 0) { breaks++; console.log('   ✓ ' + k + ' caught'); } else fails.push(k + ' not caught');
}
console.log(' assertions passed .. ' + pass);
console.log(' failures ........... ' + fails.length);
console.log(' ' + breaks + ' breaks caught');
if (fails.length) { fails.forEach((f) => console.log('   ✗ ' + f)); process.exitCode = 1; }
