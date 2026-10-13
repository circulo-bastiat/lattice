#!/usr/bin/env node
// hopperrefcheck.mjs — infra I6 (24 Sept 2026): HOPPER TIMING, the engine against the REAL 1.18.2 server.
//
//   node tools/referee/runhopper.mjs        # once per machine/store (~1 min, the real server)
//   node tools/referee/hopperrefcheck.mjs [--verbose]
//
// Each scenario of hopperscen.mjs (chest -> hopper -> chest, a two-hopper chain placed in both orders -- block-entity
// tick order --, two item kinds, a hopper locked by a redstone block, chest -> hopper -> furnace -> hopper -> chest,
// a side hopper feeding fuel) is placed at tick 1 in the same order and ticked by BlockEntities.tick; every
// watched slot count must equal the server's on EVERY tick (the 8-tick cooldown, the chain's hand-off tick, the
// furnace's slot routing). Anti-vacuity (D-30/D-305): a golden series shifted one tick, the hopper cooldown made 4,
// the lock ignored, the chain's receive cooldown dropped and the furnace's fuel slot made extractable must each be caught; every non-`stat` scenario's golden must move. No golden -> SKIP.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCENARIOS } from './hopperscen.mjs';

const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'hopper-timing.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'hopper-timing.json')].find((f) => existsSync(f));
if (!GOLDEN) {
  console.log('hopperrefcheck: SKIP (golden not generated -- run node tools/referee/runhopper.mjs)');
  process.exit(0);
}
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const EXTRA = ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js', '07b_behaviour.js', '07c_blockentity.js',
               '14b_physics.js', '07f_redstone.js'];

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };

function runEngine(sc, hook) {
  const M = loadEngine({ extra: EXTRA, dom: false });
  M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  M.Recipes.init({ recipes: b64('recipes.bin'), recipesBytes: rdj('recipes.meta.json').jsonBytes });
  const cells = new Map();
  const key = (x, y, z) => x + ',' + y + ',' + z;
  const w = { get: (x, y, z) => cells.get(key(x, y, z)) || 0, set: (x, y, z, s) => { cells.set(key(x, y, z), s); } };
  w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 15 << 4;
  M.Behave.init(w);
  M.BlockEntities.init();
  M.Redstone.init();
  // `BE.hopperFacing` reads the facing through `NS.World.getBlock` (the game's world), not `Behave.w`: hand it
  // the same cells, or every hopper reads as facing down and a horizontal hopper can never eject.
  if (!M.World) M.World = { getBlock: w.get };
  const S = M.States, B = M.Behave, BE = M.BlockEntities, Inv = M.Inventory;
  if (hook) hook(M);
  const out = {};
  for (const wt of sc.watch) out[wt[0]] = [];
  const count = (s) => (Inv.isEmpty(s) ? 0 : s.n);
  for (let k = 1; k <= sc.T; k++) {
    if (k === 1) {
      for (const [x, y, z, name, props, items] of sc.blocks) {
        let st = S.stateOf(name);
        for (const [pk, pv] of Object.entries(props || {})) st = B.setProp(st, pk, pv);
        w.set(x, y, z, st);
        B.changed(x, y, z);
        if (items) {
          const e = BE.get(x, y, z) || BE.create(x, y, z, name);
          for (const s of items) e.items[s.slot] = Inv.stack(s.id, s.n);
        }
      }
    }
    for (const [label, x, y, z, path] of sc.watch) {
      const e = BE.get(x, y, z);
      let v = 0;
      if (e && e.items) {
        if (path === 'first') { const f = e.items.find((s) => !Inv.isEmpty(s)); v = count(f); } else v = count(e.items[path]);
      }
      out[label].push(v);
    }
    BE.tick();
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
      bad.push(`${id}.${p}: first differs at tick ${i}: server ${g.slice(Math.max(0, i - 2), i + 6).join(',')} | engine ${e.slice(Math.max(0, i - 2), i + 6).join(',')} (from tick ${Math.max(0, i - 2)})`);
    }
  }
  return bad;
}

console.log(`hopperrefcheck — hopper timing vs the real 1.18.2 server (${Object.keys(golden.cases).length} scenarios, ${golden.generatedAt})`);
let nScen = 0;
for (const sc of SCENARIOS) {
  const g = golden.cases[sc.id];
  if (!ok(!!g && g.T === sc.T, `${sc.id}: in the golden with T=${sc.T} (regenerate: node tools/referee/runhopper.mjs)`)) continue;
  if (!sc.stat) ok(Object.values(g.probes).some((a) => a.some((v) => v !== a[0])), `${sc.id}: the server moved items`);
  let eng;
  try { eng = runEngine(sc); } catch (e) { ok(false, `${sc.id}: engine threw ${e.message}`); continue; }
  const bad = compare(sc.id, g.probes, eng);
  for (const b of bad) ok(false, b);
  if (!bad.length) pass++;
  nScen++;
}

const breakCaught = (m, c) => { breaks++; if (c) { pass++; console.log('   ✓ break caught: ' + m); } else fails.push('anti-vacuity: ' + m); };
{
  const sc = SCENARIOS.find((s) => s.id === 'chest_hopper_chest');
  const g = golden.cases[sc.id].probes;
  breakCaught('chest_hopper_chest golden `dst` shifted one tick is a mismatch',
    compare(sc.id, { ...g, dst: [g.dst[0], ...g.dst.slice(0, -1)] }, runEngine(sc)).length > 0);
}
{
  const sc = SCENARIOS.find((s) => s.id === 'chest_hopper_chest');
  breakCaught('a 4-tick hopper cooldown is a mismatch',
    compare(sc.id, golden.cases[sc.id].probes, runEngine(sc, (M) => { M.BlockEntities.HOPPER_COOLDOWN = 4; })).length > 0);
}
{
  const sc = SCENARIOS.find((s) => s.id === 'hopper_locked');
  breakCaught('a hopper that ignores its redstone lock is a mismatch',
    compare(sc.id, golden.cases[sc.id].probes, runEngine(sc, (M) => { M.BlockEntities.hopperEnabled = () => true; })).length > 0);
}
{
  const sc = SCENARIOS.find((s) => s.id === 'hopper_chain');
  breakCaught('a hopper that passes a just-received item straight on (no receive cooldown) is a mismatch',
    compare(sc.id, golden.cases[sc.id].probes, runEngine(sc, (M) => { M.BlockEntities.hopperArm = () => {}; })).length > 0);
}
{
  const sc = SCENARIOS.find((s) => s.id === 'hopper_furnace_line');
  breakCaught('a hopper that pulls the coal out of a furnace\'s fuel slot is a mismatch',
    compare(sc.id, golden.cases[sc.id].probes, runEngine(sc, (M) => { M.BlockEntities.hopperMayTake = () => true; })).length > 0);
}

console.log(`hopperrefcheck: ${nScen} scenarios compared, ${fails.length} fail, ${breaks} breaks`);
for (const f of fails.slice(0, 60)) console.log('  ✗ ' + f);
console.log('');
console.log('================ hopperrefcheck (I6) ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks - fails.filter((f) => f.startsWith('anti-vacuity')).length}`);
process.exit(fails.length ? 1 : 0);
