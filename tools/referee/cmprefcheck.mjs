#!/usr/bin/env node
// cmprefcheck.mjs — infra I6 (24 Sept 2026): COMPARATOR READOUT, the engine against the REAL 1.18.2 server.
//
//   node tools/referee/runcmp.mjs           # once per machine/store (~35 s, the real server)
//   node tools/referee/cmprefcheck.mjs [--verbose]
//
// Each scene of cmpscen.mjs (a chest at 0/1/64 items, 2/14/27 stacks, ender pearls (16-stacks) and swords (1-stacks),
// a hopper, a dispenser, a furnace's fuel slot, a half barrel, cauldrons, composters, cakes, an end portal frame with
// an eye, an empty jukebox) is built in the engine: the read block (+ its items), a comparator facing west, a wire;
// settled 30 ticks; the wire's settled power must equal the server's (ScreenHandler.calculateComparatorOutput and
// every block's getComparatorOutput).
// Anti-vacuity (D-30/D-305): the golden off by one, a comparator that reads every container as full, and one that
// ignores the item's max stack size must each be caught; the golden must hold at least 6 distinct powers.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCENARIOS, T } from './cmpscen.mjs';

const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'comparator-readout.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'comparator-readout.json')].find((f) => existsSync(f));
if (!GOLDEN) {
  console.log('cmprefcheck: SKIP (golden not generated -- run node tools/referee/runcmp.mjs)');
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
  for (let x = -1; x <= 4; x++) for (let z = -2; z <= 2; z++) w.set(x, -1, z, S.stateOf('stone'));
  setblock(0, 0, 0, state(sc.block[0], sc.block[1]));
  if (sc.items && sc.items.length) {
    const e = BE.get(0, 0, 0) || BE.create(0, 0, 0, sc.block[0]);
    for (const s of sc.items) e.items[s.slot] = Inv.stack(s.id, s.n);
  }
  setblock(1, 0, 0, state('comparator', { facing: 'west', mode: 'compare' }));
  setblock(2, 0, 0, state('redstone_wire', { east: 'side', west: 'side', north: 'none', south: 'none' }));
  for (let i = 0; i < 30; i++) tick();
  const out = [];
  for (let k = 1; k <= T; k++) { out.push(parseInt(B.propName(w.get(2, 0, 0), 'power'), 10) || 0); tick(); }
  return out;
}

const last = (a) => a[a.length - 1];
console.log(`cmprefcheck — comparator readout vs the real 1.18.2 server (${Object.keys(golden.cases).length} scenes, ${golden.generatedAt})`);
ok(golden.T === T, `golden T ${golden.T} = scenario T ${T} (regenerate: node tools/referee/runcmp.mjs)`);
const want = {};
for (const sc of SCENARIOS) {
  const g = golden.cases[sc.id];
  if (!ok(!!g, `${sc.id}: in the golden`)) continue;
  const a = g.probes.wire;
  ok(a[a.length - 1] === a[a.length - 2], `${sc.id}: the server's reading is steady (${a.join(',')})`);
  want[sc.id] = last(a);
}
ok(new Set(Object.values(want)).size >= 6, `the golden holds >= 6 distinct powers (${[...new Set(Object.values(want))].join(',')})`);
const cmpAll = (got) => SCENARIOS.filter((sc) => want[sc.id] !== undefined && got[sc.id] !== want[sc.id]).map((sc) => `${sc.id}: server ${want[sc.id]} | engine ${got[sc.id]}`);
const engine = {};
let nScen = 0;
for (const sc of SCENARIOS) {
  try { engine[sc.id] = last(runEngine(sc)); nScen++; } catch (e) { ok(false, `${sc.id}: engine threw ${e.message}`); }
}
const bad = cmpAll(engine);
for (const b of bad) ok(false, b);
if (VERBOSE) for (const sc of SCENARIOS) console.log(`   ${sc.id.padEnd(22)} S ${want[sc.id]}  E ${engine[sc.id]}`);

const breakCaught = (m, c) => { breaks++; if (c) { pass++; console.log('   ✓ break caught: ' + m); } else fails.push('anti-vacuity: ' + m); };
{
  const off = Object.fromEntries(Object.entries(want).map(([k, v]) => [k, v + 1]));
  breakCaught('the golden off by one is a mismatch', cmpAll(off).length > 0);
}
{
  const sc = SCENARIOS.find((s) => s.id === 'chest_2_stacks');
  const full = last(runEngine(sc, (M) => { M.Redstone.analogOutput = () => 15; }));
  breakCaught('a comparator that reads a 2-stack chest as full is a mismatch', full !== want[sc.id] || engine[sc.id] !== want[sc.id]);
}
{
  const fake = { ...engine, chest_1_sword: 0 };
  breakCaught('a 1-stack item read as 1/64 of a slot (power 0) is a mismatch', cmpAll(fake).some((m) => m.startsWith('chest_1_sword')));
}

console.log(`cmprefcheck: ${nScen} scenarios compared, ${fails.length} fail, ${breaks} breaks`);
for (const f of fails.slice(0, 60)) console.log('  ✗ ' + f);
console.log('');
console.log('================ cmprefcheck (I6) ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks - fails.filter((f) => f.startsWith('anti-vacuity')).length}`);
process.exit(fails.length ? 1 : 0);
