#!/usr/bin/env node
// lockstep-lilypadboat.mjs -- #8764 (G17-L234): lockstep scenario 'lilypadboat': a row of lily pads (y 11) on water (y 10); a boat, a pig
// and a zombie travel along it, 20 seeds (speeds), 80 ticks. Per tick the block-edit list and the dropped stacks are compared with an
// independent transcription of LilyPadBlock.onEntityCollision (.decomp): world.breakBlock(pos, true, entity) only for a BoatEntity.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

const SEEDS = 20, TICKS = 80, LEN = 24;
const rng = (s) => () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
const TYPES = [['boat', 1.375, 0.5625, 2], ['pig', 0.9, 0.9, 5], ['zombie', 0.6, 1.95, 8]];
function scen(seed) {
  const r = rng(seed * 7919 + 5);
  return TYPES.map(([type, width, height, z]) => ({ type, width, height, x: 0.5, z: z + 0.5, y: 11, vx: 0.1 + r() * 0.2, vy: 0, vz: 0 }));
}
const clone = (m) => m.map((e) => ({ ...e }));
const cellsOf = (e) => { const hw = e.width / 2, o = [];
  for (let x = Math.floor(e.x - hw + 0.001); x <= Math.floor(e.x + hw - 0.001); x++) for (let y = Math.floor(e.y + 0.001); y <= Math.floor(e.y + e.height - 0.001); y++)
    for (let z = Math.floor(e.z - hw + 0.001); z <= Math.floor(e.z + hw - 0.001); z++) o.push([x, y, z]); return o; };

function oracle(m, o = {}) {
  const pads = new Set(); for (let x = 0; x < LEN; x++) for (const z of [2, 5, 8]) pads.add(x + ',11,' + z);
  const rows = [];
  for (let t = 0; t < TICKS; t++) {
    const ed = [];
    for (const e of m) for (const [x, y, z] of cellsOf(e)) {
      const k = x + ',' + y + ',' + z;
      if (pads.has(k) && (e.type === 'boat' || o.any)) { pads.delete(k); ed.push(k + (o.nodrop ? '' : ':lily_pad')); }
    }
    rows.push(ed.sort().join(';') + '|' + m.filter((e) => e.type === 'boat').map((e) => e.x.toFixed(3)).join()); m.forEach((e) => { e.x += e.vx; });
  }
  return rows;
}
function engine(m, patch) {
  const M = loadEngine({ patch, extra: ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js', '07e_loot.js', '07h_entities.js', '14b_physics.js', '07zzt_boat.js', '14l_use.js'], dom: false });
  const S = M.States, cells = new Map(), k = (x, y, z) => x + ',' + y + ',' + z, ed = [], pop = [];
  const W = { getBlock: (x, y, z) => cells.get(k(x, y, z)) || 0, setBlock: (x, y, z, s) => { cells.set(k(x, y, z), s); if (s === 0) ed.push(k(x, y, z)); return true; } };
  M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  M.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });
  M.World = W; M.Behave.init(W); M.Use.init(W);
  M.EntityList = Object.assign(M.EntityList || {}, { popResource: (x, y, z, it, n) => pop.push(k(x, y, z) + ':' + M.Items.nameOf(it)) });
  for (let x = 0; x < LEN; x++) { for (let z = 0; z < 12; z++) cells.set(k(x, 10, z), S.stateOf('water')); for (const z of [2, 5, 8]) cells.set(k(x, 11, z), S.stateOf('lily_pad')); }
  const rows = [];
  for (let t = 0; t < TICKS; t++) {
    ed.length = 0; pop.length = 0; m.forEach((e) => M.Use.entityCollide(e));
    rows.push(ed.map((c, i) => c + (pop[i] ? ':' + pop[i].split(':')[1] : '')).sort().join(';') + '|' + m.filter((e) => e.type === 'boat').map((e) => e.x.toFixed(3)).join());
    m.forEach((e) => { e.x += e.vx; });
  }
  return rows;
}
function run(o = {}) {
  let bad = 0, first = '', broke = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const a = engine(clone(scen(seed)), o.patch), b = oracle(clone(scen(seed)), o);
    for (let i = 0; i < TICKS; i++) if (a[i] !== b[i]) { bad++; if (!first) first = `seed ${seed} tick ${i}: engine ${a[i]} oracle ${b[i]}`; break; }
  }
  return { bad, first };
}
let fails = 0, breaks = 0; const notes = [];
const base = run();
if (base.bad) { fails++; console.log(`  FAIL ${base.bad} divergences; first: ${base.first}`); }
if (!oracle(clone(scen(1))).some((r) => r.startsWith(' ') ? false : r.split('|')[0].includes('lily_pad'))) { fails++; console.log('  FAIL vacuous: no pad ever broken'); }
const brk = [
  ['oracle: any entity breaks', { any: true }],
  ['oracle: drop suppressed', { nodrop: true }],
  ['engine: any entity breaks', { patch: (f, s) => f === '14l_use.js' ? s.replace("if (e.type === 'boat') Use.breakForFluid", 'if (true) Use.breakForFluid') : s }],
];
for (const [name, o] of brk) {
  const d = run(o);
  if (d.bad) { breaks++; notes.push(`   ✓ ${name} caught: ${d.first}`); } else { fails++; console.log(`  FAIL ${name} not caught`); }
}
console.log(`${brk.length + 2 - fails} assertions, ${fails} failures, ${breaks} breaks caught (${SEEDS} seeds, ${base.bad} divergences)`);
notes.forEach((n) => console.log(n));
process.exit(fails ? 1 : 0);
