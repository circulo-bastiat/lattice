#!/usr/bin/env node
// dispenserefcheck.mjs — infra I6 (24 Sept 2026): DISPENSER / DROPPER TIMING, the engine against the REAL 1.18.2 server.
//
//   node tools/referee/rundispense.mjs      # once per machine/store (~40 s, the real server)
//   node tools/referee/dispenserefcheck.mjs [--verbose]
//
// Each scenario of dispensescen.mjs (a dropper pulsed into a chest, a dropper chain, dropper -> hopper -> chest, a
// 2-tick clock, a dropper feeding a furnace from below and from the side, a QUASI-CONNECTED dropper that fires only
// when a later neighbour update reaches it, a dispenser at a chest -- it throws, never inserts --, arrows on a clock,
// a water bucket) is built in the engine on a stone floor, settled, then run on the SAME clock as the server's tick
// function: events for tick k -> sample every probe -> one world tick (Behave.tick, then BlockEntities.tick).
// Every probe's 60-tick series must equal the server's exactly (the 4-tick fire delay, the rising edge, the
// hand-off into the next container).
// Anti-vacuity (D-30/D-305): a golden series shifted one tick, the fire delay forced to 1, and a dropper that
// ignores its target container must each be caught -- and so must each of the quasi reach, the hopper's arrival
// cooldown and the bucket behaviour undone; every non-`stat` scenario's golden must move. No golden -> SKIP.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCENARIOS, T } from './dispensescen.mjs';

const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'dispense-timing.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'dispense-timing.json')].find((f) => existsSync(f));
if (!GOLDEN) {
  console.log('dispenserefcheck: SKIP (golden not generated -- run node tools/referee/rundispense.mjs)');
  process.exit(0);
}
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const EXTRA = ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js', '07b_behaviour.js', '07c_blockentity.js',
               '14b_physics.js', '07f_redstone.js', '07h_entities.js', '07i_entitylist.js', '14l_use.js'];

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
  if (M.Use && M.Use.init) M.Use.init(w);   // dispenseBucket drains through Use.tryDrainFluid
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
  for (let x = -1; x <= 8; x++) for (let z = -2; z <= 2; z++) w.set(x, -1, z, S.stateOf('stone'));
  for (const [x, y, z, name, props, items] of sc.blocks) {
    setblock(x, y, z, state(name, props));
    if (items && items.length) {
      const e = BE.get(x, y, z) || BE.create(x, y, z, name);
      for (const s of items) e.items[s.slot] = Inv.stack(s.id, s.n);
    }
  }
  for (let i = 0; i < 30; i++) tick();
  const nameAt = (x, y, z) => { const st = w.get(x, y, z); return st === 0 ? 'air' : M.Reg.names[S.block[st]]; };
  const out = {};
  for (const p of sc.probes) out[p[0]] = [];
  for (let k = 1; k <= T; k++) {
    for (const ev of sc.events) {
      if (ev[0] !== k) continue;
      if (ev.length === 2) setblock(0, 0, 0, ev[1] ? S.stateOf('redstone_block') : 0);
      else setblock(ev[1], ev[2], ev[3], state(ev[4]));
    }
    for (const p of sc.probes) {
      const [label, x, y, z, kind] = p;
      let v = 0;
      if (kind === 'count') {
        const e = BE.get(x, y, z);
        if (e && e.items) {
          const s = p[5] === 'first' ? e.items.find((q) => !Inv.isEmpty(q)) : e.items[p[5]];
          v = s && !Inv.isEmpty(s) ? s.n : 0;
        }
      } else {
        v = nameAt(x, y, z) === p[5] && (!p[6] || B.propName(w.get(x, y, z), p[6]) === p[7]) ? 1 : 0;
      }
      out[label].push(v);
    }
    tick();
  }
  return out;
}

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

console.log(`dispenserefcheck — dispenser/dropper timing vs the real 1.18.2 server (${Object.keys(golden.cases).length} scenarios, ${golden.generatedAt})`);
ok(golden.T === T, `golden T ${golden.T} = scenario T ${T} (regenerate: node tools/referee/rundispense.mjs)`);
let nScen = 0;
for (const sc of SCENARIOS) {
  const g = golden.cases[sc.id];
  if (!ok(!!g, `${sc.id}: in the golden (regenerate: node tools/referee/rundispense.mjs)`)) continue;
  if (!sc.stat) ok(Object.values(g.probes).some((a) => a.some((v) => v !== a[0])), `${sc.id}: the server's series moved`);
  let eng;
  try { eng = runEngine(sc); } catch (e) { ok(false, `${sc.id}: engine threw ${e.message}`); continue; }
  const bad = compare(sc.id, g.probes, eng);
  for (const b of bad) ok(false, b);
  if (!bad.length) pass++;
  nScen++;
  if (VERBOSE) for (const [l, a] of Object.entries(eng)) console.log(`   ${sc.id}.${l}\n     S ${g.probes[l].join('')}\n     E ${a.join('')}`);
}

const breakCaught = (m, c) => { breaks++; if (c) { pass++; console.log('   ✓ break caught: ' + m); } else fails.push('anti-vacuity: ' + m); };
{
  const sc = SCENARIOS.find((s) => s.id === 'dropper_chest_pulses');
  const g = golden.cases[sc.id].probes;
  breakCaught('dropper_chest_pulses golden `dst` shifted one tick is a mismatch',
    compare(sc.id, { ...g, dst: [g.dst[0], ...g.dst.slice(0, -1)] }, runEngine(sc)).length > 0);
}
{
  const sc = SCENARIOS.find((s) => s.id === 'dropper_fast_clock');
  const eng = runEngine(sc, (M) => { const real = M.Behave.schedule; M.Behave.schedule = (x, y, z, d, p) => real(x, y, z, 1, p); });
  breakCaught('a dropper firing 1 tick after power (not 4) is a mismatch', compare(sc.id, golden.cases[sc.id].probes, eng).length > 0);
}
{
  const sc = SCENARIOS.find((s) => s.id === 'dropper_chain');
  const eng = runEngine(sc, (M) => { M.BlockEntities.isHopperTarget = () => false; });
  breakCaught('a dropper that throws instead of inserting is a mismatch', compare(sc.id, golden.cases[sc.id].probes, eng).length > 0);
}
// the three causes fixed by cloud unit fervent-darwin-i2fi6n: each undone must turn its scenario red
for (const [id, msg, hook] of [
  ['dropper_quasi', 'a dropper woken by a change it is not a neighbour of (the old 5x5x5 box) is a mismatch',
    (M) => { M.Redstone.dispenserReach = () => 3; }],
  ['dropper_hopper_chest', 'a hopper that passes a dropped item on without its 8-tick arrival cooldown is a mismatch',
    (M) => { M.BlockEntities.hopperArm = () => {}; }],
  ['dispenser_water_bucket', 'a dispenser that throws a water bucket instead of pouring it is a mismatch',
    (M) => { M.BlockEntities.dispenseBucket = () => null; }],
]) {
  const sc = SCENARIOS.find((s) => s.id === id);
  breakCaught(msg, compare(sc.id, golden.cases[sc.id].probes, runEngine(sc, hook)).length > 0);
}

console.log(`dispenserefcheck: ${nScen} scenarios compared, ${fails.length} fail, ${breaks} breaks`);
for (const f of fails.slice(0, 60)) console.log('  ✗ ' + f);
console.log('');
console.log('================ dispenserefcheck (I6) ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks - fails.filter((f) => f.startsWith('anti-vacuity')).length}`);
process.exit(fails.length ? 1 : 0);
