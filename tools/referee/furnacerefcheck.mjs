#!/usr/bin/env node
// furnacerefcheck.mjs — infra I6 (24 Sept 2026): FURNACE TIMING, the engine against the REAL 1.18.2 server.
//
//   node tools/referee/runfurnace.mjs        # once per machine/store (~1 min, the real server)
//   node tools/referee/furnacerefcheck.mjs [--verbose]
//
// Each scenario of furnacescen.mjs (furnace / blast furnace / smoker; coal, sticks running out, two sticks back to
// back, a lava bucket leaving its bucket, an output slot that is full or holds something else, food refused by a
// blast furnace) is placed at tick 1 with the same three slots, then ticked by BlockEntities.tick exactly as the
// server's block-entity pass ticks it; per tick BurnTime, CookTime, the three slot counts, the block's `lit` and
// "the fuel slot holds a bucket" must equal the server's EXACTLY (a cook that finishes a tick late is red).
// Anti-vacuity (D-30/D-305): a golden series shifted one tick, the blast furnace's halved fuel undone, and the
// cool-down's -2 made -1 must each be caught. Every non-`stat` scenario's golden must move its cook or output.
// No golden -> SKIP, exit 0. Golden is generated, never committed (D-6).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCENARIOS, PROBES } from './furnacescen.mjs';

const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'furnace-timing.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'furnace-timing.json')].find((f) => existsSync(f));
if (!GOLDEN) {
  console.log('furnacerefcheck: SKIP (golden not generated -- run node tools/referee/runfurnace.mjs)');
  process.exit(process.env.MCLITE_REQUIRE_REFEREE ? 1 : 0);
}
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const EXTRA = ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js', '07b_behaviour.js', '07c_blockentity.js', '14g_menu.js'];

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
  const S = M.States, B = M.Behave, BE = M.BlockEntities, Inv = M.Inventory;
  if (hook) hook(M);
  const out = {};
  for (const p of PROBES) out[p] = [];
  let e = null;
  const count = (s) => (Inv.isEmpty(s) ? 0 : s.n);
  for (let k = 1; k <= sc.T; k++) {
    if (k === 1) {
      w.set(0, 0, 0, B.setProp(B.setProp(S.stateOf(sc.block), 'facing', 'north'), 'lit', 'false'));
      e = BE.create(0, 0, 0, sc.block);
      e.cookTimeTotal = sc.total;
      for (const s of sc.items) e.items[s.slot] = Inv.stack(s.id, s.n);
    }
    out.burn.push(e.burnTime | 0);
    out.cook.push(e.cookTime | 0);
    out.in.push(count(e.items[0]));
    out.fuel.push(count(e.items[1]));
    out.out.push(count(e.items[2]));
    out.lit.push(B.propName(w.get(0, 0, 0), 'lit') === 'true' ? 1 : 0);
    out.bucket.push(!Inv.isEmpty(e.items[1]) && M.Items.nameOf(e.items[1].i) === 'bucket' ? 1 : 0);
    BE.tick();
  }
  return out;
}

function compare(id, van, eng) {
  const bad = [];
  for (const p of PROBES) {
    const g = van[p], e = eng[p];
    if (!g) { bad.push(`${id}.${p}: not in the golden`); continue; }
    let i = 0;
    while (i < g.length && g[i] === e[i]) i++;
    if (i < g.length || e.length !== g.length) {
      bad.push(`${id}.${p}: first differs at tick ${i}: server ${g.slice(Math.max(0, i - 2), i + 4).join(',')} | engine ${e.slice(Math.max(0, i - 2), i + 4).join(',')} (from tick ${Math.max(0, i - 2)})`);
    }
  }
  return bad;
}

console.log(`furnacerefcheck — furnace timing vs the real 1.18.2 server (${Object.keys(golden.cases).length} scenarios, ${golden.generatedAt})`);
let nScen = 0;
for (const sc of SCENARIOS) {
  const g = golden.cases[sc.id];
  if (!ok(!!g && g.T === sc.T, `${sc.id}: in the golden with T=${sc.T} (regenerate: node tools/referee/runfurnace.mjs)`)) continue;
  if (!sc.stat) {
    const moves = (a) => a.some((v) => v !== a[0]);
    ok(moves(g.probes.cook) || moves(g.probes.out), `${sc.id}: the server's furnace actually cooked (cook or output moves)`);
  }
  let eng;
  try { eng = runEngine(sc); } catch (e) { ok(false, `${sc.id}: engine threw ${e.message}`); continue; }
  const bad = compare(sc.id, g.probes, eng);
  for (const b of bad) ok(false, b);
  if (!bad.length) pass++;
  nScen++;
  if (VERBOSE) for (const p of PROBES) console.log(`   ${sc.id}.${p}\n     S ${g.probes[p].slice(0, 40).join(',')}\n     E ${eng[p].slice(0, 40).join(',')}`);
}

const breakCaught = (m, c) => { breaks++; if (c) { pass++; console.log('   ✓ break caught: ' + m); } else fails.push('anti-vacuity: ' + m); };
{
  const sc = SCENARIOS.find((s) => s.id === 'furnace_ore2_coal');
  const g = golden.cases[sc.id].probes;
  breakCaught('furnace_ore2_coal golden `out` shifted one tick is a mismatch',
    compare(sc.id, { ...g, out: [g.out[0], ...g.out.slice(0, -1)] }, runEngine(sc)).length > 0);
}
{
  const sc = SCENARIOS.find((s) => s.id === 'blast_raw3_coal');
  const eng = runEngine(sc, (M) => { const real = M.Recipes.fuelTime; M.Recipes.fuelTime = (s) => real(s) * 2; });
  breakCaught('a blast furnace burning coal for 1600 is a mismatch', compare(sc.id, golden.cases[sc.id].probes, eng).length > 0);
}
{
  const sc = SCENARIOS.find((s) => s.id === 'furnace_raw2_stick');
  const eng = runEngine(sc);
  const i = eng.cook.findIndex((v, j) => j > 0 && v < eng.cook[j - 1]);
  if (i > 0) for (let j = i; j < eng.cook.length; j++) eng.cook[j] = Math.max(0, eng.cook[i - 1] - (j - i + 1));
  breakCaught('a cook that cools by 1 a tick instead of 2 is a mismatch', compare(sc.id, golden.cases[sc.id].probes, eng).length > 0);
}

// BREAK SCENE (#409): AbstractFurnaceBlock.onStateReplaced drops the unclaimed recipesUsed XP as orbs at the block
// centre. 10 iron ingots at 0.7 = exactly 7 (float), so 7 orbs' worth must be spawned at (0.5,0.5,0.5).
function breakScene(hook) {
  const M = loadEngine({ extra: EXTRA, dom: false });
  M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  M.Recipes.init({ recipes: b64('recipes.bin'), recipesBytes: rdj('recipes.meta.json').jsonBytes });
  const cells = new Map();
  const w = { get: (x, y, z) => cells.get(x + ',' + y + ',' + z) || 0, set: (x, y, z, st) => { cells.set(x + ',' + y + ',' + z, st); } };
  w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 15 << 4;
  M.Behave.init(w);
  M.BlockEntities.init();
  const spawned = [];
  M.Xp = { ready: true, spawn: (x, y, z, t) => { spawned.push({ x, y, z, t }); return []; } };
  if (hook) hook(M);
  const S = M.States;
  w.set(0, 0, 0, S.stateOf('furnace'));
  const e = M.BlockEntities.create(0, 0, 0, 'furnace');
  e.recipesUsed = { iron_ingot: { n: 10, xp: 0.7 } };
  M.BlockEntities.onChanged(0, 0, 0, 0);
  return spawned;
}
{
  const sp = breakScene();
  ok(sp.length === 1 && sp[0].t === 7 && sp[0].x === 0.5 && sp[0].y === 0.5 && sp[0].z === 0.5, `break furnace: 7 XP dropped at the centre (got ${JSON.stringify(sp)})`);
  breakCaught('a furnace break that pays nothing is a mismatch', breakScene((M) => { M.BlockEntities.popFurnaceXp = () => 0; }).length === 0);
}

console.log(`furnacerefcheck: ${nScen} scenarios compared, ${fails.length} fail, ${breaks} breaks`);
for (const f of fails.slice(0, 60)) console.log('  ✗ ' + f);
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks - fails.filter((f) => f.startsWith('anti-vacuity')).length}`);
process.exit(fails.length ? 1 : 0);
