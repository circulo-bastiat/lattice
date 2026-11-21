#!/usr/bin/env node
// fluidrefcheck.mjs — infra I6 (24 Sept 2026): FLUID FLOW TIMING, the engine against the REAL 1.18.2 server.
//
//   node tools/referee/runfluid.mjs         # once per machine/store (~45 s, the real server)
//   node tools/referee/fluidrefcheck.mjs [--verbose]
//
// Each scenario of fluidscen.mjs (water down a 1-wide channel, on an open floor incl. diagonals, a source removed
// and the flow receding, off a 3-high ledge, toward a hole 3 blocks away (getSpread's shortest-way-down), two
// sources making a third, lava down a channel (30-tick steps), lava meeting water, water poured on a lava source)
// is built in the engine on a stone floor, settled, then run on the SAME clock as the server's tick function:
// events for tick k -> sample every probe -> one world tick (Behave.tick). Every probe's series -- the fluid's
// `level` each tick, -1 when absent, or a 0/1 block bit -- must equal the server's exactly.
// Anti-vacuity (D-30/D-305): a golden series shifted one tick, water's tick delay forced to 10, and the
// infinite-source rule removed must each be caught; every scenario's golden must move. No golden -> SKIP.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCENARIOS } from './fluidscen.mjs';

const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'fluid-timing.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'fluid-timing.json')].find((f) => existsSync(f));
if (!GOLDEN) {
  console.log('fluidrefcheck: SKIP (golden not generated -- run node tools/referee/runfluid.mjs)');
  process.exit(process.env.MCLITE_REQUIRE_REFEREE ? 1 : 0);
}
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const EXTRA = ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js', '07b_behaviour.js', '07c_blockentity.js',
               '14b_physics.js', '07f_redstone.js', '07h_entities.js', '07i_entitylist.js'];

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };

/** Run one scenario in a fresh engine; returns { label: [values..] }. `hook(M)` may break the engine. */
function runEngine(sc, hook) {
  const M = loadEngine({ extra: EXTRA, dom: false });
  M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  M.Recipes.init({ recipes: b64('recipes.bin'), recipesBytes: rdj('recipes.meta.json').jsonBytes });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
  const cells = new Map();
  const key = (x, y, z) => x + ',' + y + ',' + z;
  const w = { get: (x, y, z) => cells.get(key(x, y, z)) || 0, set: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); } };
  w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 15 << 4;
  M.Behave.init(w);
  M.BlockEntities.init();
  M.Redstone.init();
  if (M.Entities && M.Entities.init) M.Entities.init();
  if (M.EntityList && M.EntityList.init) M.EntityList.init();
  // the same join hopperrefcheck names: `BE.hopperFacing` reads NS.World.getBlock, not Behave.w
  if (!M.World) M.World = { getBlock: w.get };
  const S = M.States, B = M.Behave, BE = M.BlockEntities, Inv = M.Inventory;
  if (hook) hook(M);
  const state = (name, props) => {
    let st = S.stateOf(name);
    if (!st) throw new Error('no state ' + name);
    for (const [k, v] of Object.entries(props || {})) if (v !== null && v !== undefined) st = B.setProp(st, k, v);
    return st;
  };
  const setblock = (x, y, z, st) => { w.set(x, y, z, st); B.changed(x, y, z); };
  const tick = () => { B.tick(); BE.tick(); };
  for (let x = -8; x <= 16; x++) for (let z = -8; z <= 8; z++) { w.set(x, -1, z, S.stateOf('stone')); w.set(x, -2, z, S.stateOf('stone')); }
  for (const [x, y, z, name] of sc.blocks) setblock(x, y, z, name === 'air' ? 0 : state(name));
  for (let i = 0; i < 30; i++) tick();
  const nameAt = (x, y, z) => { const st = w.get(x, y, z); return st === 0 ? 'air' : M.Reg.names[S.block[st]]; };
  const out = {};
  for (const p of sc.probes) out[p[0]] = [];
  for (let k = 1; k <= sc.T; k++) {
    for (const [t, x, y, z, name] of sc.events) if (t === k) setblock(x, y, z, name === 'air' ? 0 : state(name));
    for (const p of sc.probes) {
      const [label, x, y, z, kind] = p;
      const n = nameAt(x, y, z);
      let v;
      if (kind === 'bit') v = n === p[5] ? 1 : 0;
      else v = n === kind ? parseInt(B.propName(w.get(x, y, z), 'level'), 10) : -1;
      out[label].push(v);
    }
    tick();
  }
  return out;
}

const hex = (a) => a.map((v) => (v < 0 ? '.' : v.toString(16))).join('');
function compare(id, van, eng) {
  const bad = [];
  for (const [p, g] of Object.entries(van)) {
    const e = eng[p] || [];
    let i = 0;
    while (i < g.length && g[i] === e[i]) i++;
    if (i < g.length || e.length !== g.length) {
      const from = Math.max(0, i - 2);
      bad.push(`${id}.${p}: first differs at tick ${i}: server ${g.slice(from, i + 8).join(',')} | engine ${e.slice(from, i + 8).join(',')} (from tick ${from})`);
    }
  }
  return bad;
}

console.log(`fluidrefcheck — fluid flow timing vs the real 1.18.2 server (${Object.keys(golden.cases).length} scenarios, ${golden.generatedAt})`);
let nScen = 0;
for (const sc of SCENARIOS) {
  const g = golden.cases[sc.id];
  if (!ok(!!g && g.T === sc.T, `${sc.id}: in the golden with T=${sc.T} (regenerate: node tools/referee/runfluid.mjs)`)) continue;
  ok(Object.values(g.probes).some((a) => a.some((v) => v !== a[0])), `${sc.id}: the server's series moved`);
  let eng;
  try { eng = runEngine(sc); } catch (e) { ok(false, `${sc.id}: engine threw ${e.message}`); continue; }
  const bad = compare(sc.id, g.probes, eng);
  for (const b of bad) ok(false, b);
  if (!bad.length) pass++;
  nScen++;
  if (VERBOSE) for (const [l, a] of Object.entries(eng)) console.log(`   ${sc.id}.${l}\n     S ${hex(g.probes[l])}\n     E ${hex(a)}`);
}

const breakCaught = (m, c) => { breaks++; if (c) { pass++; console.log('   ✓ break caught: ' + m); } else fails.push('anti-vacuity: ' + m); };
{
  const sc = SCENARIOS.find((s) => s.id === 'water_channel');
  const g = golden.cases[sc.id].probes;
  breakCaught('water_channel golden `w3` shifted one tick is a mismatch',
    compare(sc.id, { ...g, w3: [g.w3[0], ...g.w3.slice(0, -1)] }, runEngine(sc)).length > 0);
}
{
  const sc = SCENARIOS.find((s) => s.id === 'water_channel');
  const eng = runEngine(sc, (M) => { const real = M.Behave.schedule; M.Behave.schedule = (x, y, z, d, p) => real(x, y, z, d === 5 ? 10 : d, p); });
  breakCaught('water flowing every 10 ticks (not 5) is a mismatch', compare(sc.id, golden.cases[sc.id].probes, eng).length > 0);
}
{
  const sc = SCENARIOS.find((s) => s.id === 'water_infinite');
  const eng = runEngine(sc);
  eng.mid = eng.mid.map((v) => (v === 0 ? 1 : v));
  breakCaught('no infinite source between two sources is a mismatch', compare(sc.id, golden.cases[sc.id].probes, eng).length > 0);
}

console.log(`fluidrefcheck: ${nScen} scenarios compared, ${fails.length} fail, ${breaks} breaks`);
for (const f of fails.slice(0, 60)) console.log('  ✗ ' + f);
console.log('');
console.log('================ fluidrefcheck (I6) ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks - fails.filter((f) => f.startsWith('anti-vacuity')).length}`);
process.exit(fails.length ? 1 : 0);
