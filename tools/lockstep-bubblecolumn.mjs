#!/usr/bin/env node
// lockstep-bubblecolumn.mjs -- #6713 (G17-L117): lockstep scenario 'bubblecolumn': a 1x1 water column (y 11..17, base y 10) over soul sand
// (up) and over magma (drag), a cow, a zombie, an item and a boat inside, 20 seeds (start height + vy), 60 ticks. Per tick, per entity, vy,
// fallDistance and the boat surface flags are compared with an independent transcription of BubbleColumnBlock.onEntityCollision
// (.decomp): air above -> Entity.onBubbleColumnSurfaceCollision (up min(1.8, vy+0.1), drag max(-0.9, vy-0.03); boat: flags only),
// else Entity.onBubbleColumnCollision (up min(0.7, vy+0.06), drag max(-0.3, vy-0.03), then onLanding = fallDistance 0).
import { loadEngine } from './loadsrc.mjs';

const SEEDS = 20, TICKS = 60, BASE = 10, TOP = 17;
const rng = (s) => () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
const TYPES = [['cow', 0.9, 1.4], ['zombie', 0.6, 1.95], ['item', 0.25, 0.25], ['boat', 1.375, 0.5625]];

function scen(seed, drag) {
  const r = rng(seed * 7919 + (drag ? 17 : 3));
  return TYPES.map(([type, width, height]) => ({ type, width, height, x: 0.5, z: 0.5, y: 11 + r() * 6, vx: 0, vz: 0,
    vy: (r() - 0.5) * 0.6, fallDistance: 3 + Math.floor(r() * 10) }));
}
const clone = (m) => m.map((e) => ({ ...e }));
const snap = (m) => m.map((e) => [e.vy, e.fallDistance, !!e.onBubbleColumnSurface, !!e.bubbleColumnIsDrag, e.bubbleWobbleTicks | 0].join(',')).join('|');
// free movement inside the column: vy applied, clamped to the water column
const move = (e) => { e.y = Math.max(BASE + 1, Math.min(TOP + 0.5, e.y + e.vy)); };

function oracle(m, drag, o = {}) {
  const rows = [], D = o.dragStep === undefined ? 0.03 : o.dragStep;
  for (let t = 0; t < TICKS; t++) {
    for (const e of m) {
      const y0 = Math.floor(e.y + 0.001), y1 = Math.floor(e.y + e.height - 0.001);
      for (let by = y0; by <= y1; by++) {
        if (by < BASE + 1 || by > TOP) continue;
        if (by === TOP) {
          if (e.type === 'boat') { e.onBubbleColumnSurface = true; e.bubbleColumnIsDrag = drag; if (!e.bubbleWobbleTicks) e.bubbleWobbleTicks = 60; }
          else e.vy = drag ? Math.max(-0.9, e.vy - D) : Math.min(1.8, e.vy + 0.1);
        } else {
          e.vy = drag ? Math.max(-0.3, e.vy - D) : Math.min(0.7, e.vy + 0.06);
          e.fallDistance = 0;
        }
      }
    }
    rows.push(snap(m)); m.forEach(move);
  }
  return rows;
}
function engine(m, drag, patch) {
  const M = loadEngine({ patch, extra: ['07_world.js', '07b_behaviour.js', '14b_physics.js', '07zzt_boat.js', '14l_use.js'], dom: false });
  const S = M.States, cells = new Map(), k = (x, y, z) => x + ',' + y + ',' + z;
  const W = { getBlock: (x, y, z) => cells.get(k(x, y, z)) || 0, setBlock: (x, y, z, s) => { cells.set(k(x, y, z), s); return true; } };
  M.World = W; M.Behave.init(W); M.Use.init(W);
  cells.set(k(0, BASE, 0), S.stateOf(drag ? 'magma_block' : 'soul_sand'));
  const col = S.withLocal('bubble_column', drag ? 0 : 1);
  for (let y = BASE + 1; y <= TOP; y++) cells.set(k(0, y, 0), col);
  const rows = [];
  for (let t = 0; t < TICKS; t++) { m.forEach((e) => M.Use.entityCollide(e)); rows.push(snap(m)); m.forEach(move); }
  return rows;
}
function run(o = {}) {
  let bad = 0, first = '';
  for (let seed = 1; seed <= SEEDS; seed++) for (const drag of [false, true]) {
    const a = engine(clone(scen(seed, drag)), drag, o.patch), b = oracle(clone(scen(seed, drag)), drag, o);
    for (let i = 0; i < TICKS; i++) if (a[i] !== b[i]) { bad++; if (!first) first = `seed ${seed} drag ${drag} tick ${i}: engine ${a[i]} oracle ${b[i]}`; break; }
  }
  return { bad, first };
}
let fails = 0, breaks = 0; const notes = [];
const base = run();
if (base.bad) { fails++; console.log(`  FAIL ${base.bad} divergences; first: ${base.first}`); }
const all = (drag) => { const r = []; for (let sd = 1; sd <= SEEDS; sd++) r.push(...oracle(clone(scen(sd, drag)), drag)); return r; };
const up = all(false), dn = all(true);
const col = (rows, i, f) => rows.map((r) => +r.split('|')[i].split(',')[f]);
if (!up.some((r) => r.split('|')[3].includes(',true,false,')) || !dn.some((r) => r.split('|')[3].includes(',true,true,')) ||
    Math.max(...col(up, 1, 0)) <= 0.7 || Math.min(...col(dn, 1, 0)) > -0.3 + 1e-9) {
  fails++; console.log('  FAIL vacuous: caps / surface never reached');
}
const brk = [
  ['oracle drag 0.03->0.04', { dragStep: 0.04 }],
  ['engine drag 0.03->0.04', { patch: (f, s) => f === '14l_use.js' ? s.split('vy0 - 0.03').join('vy0 - 0.04') : s }],
  ['engine up cap 0.7->0.8', { patch: (f, s) => f === '14l_use.js' ? s.replace('Math.min(0.7, vy0 + 0.06)', 'Math.min(0.8, vy0 + 0.06)') : s }],
  ['engine fallDistance kept', { patch: (f, s) => f === '14l_use.js' ? s.replace(/(vy0 \+ 0\.06\);\s*)e\.fallDistance = 0;/, '$1') : s }],
];
for (const [name, o] of brk) {
  const d = run(o);
  if (d.bad) { breaks++; notes.push(`   ✓ ${name} caught: ${d.first}`); } else { fails++; console.log(`  FAIL ${name} not caught`); }
}
console.log(`${brk.length + 2 - fails} assertions, ${fails} failures, ${breaks} breaks caught (${SEEDS} seeds, ${base.bad} divergences)`);
notes.forEach((n) => console.log(n));
process.exit(fails ? 1 : 0);
