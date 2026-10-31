#!/usr/bin/env node
// platerefcheck.mjs — infra I6 (24 Sept 2026): PRESSURE PLATES, the engine against the REAL 1.18.2 server.
//
//   node tools/referee/runplate.mjs         # once per machine/store (~30 s, the real server)
//   node tools/referee/platerefcheck.mjs [--verbose]
//
// Each scenario of platescen.mjs (an item on an oak plate, one removed after 3 ticks, an item on a STONE plate --
// ignored, only living entities --, an armor stand on a stone plate, 3 items on light/heavy weighted plates removed
// one by one) runs in the engine in a real World (the plate on stone, the entities through EntityList.spawn, a kill
// = `removed`) on the server's clock: events for k -> sample -> Behave.tick + BlockEntities.tick + EntityList.tick.
// The plate's powered / power series must equal the server's EXACTLY (the press tick, the 20-tick (simple) / 10-tick
// (weighted) recheck before it lets go, the weighted signal = entity count).
// Anti-vacuity (D-30/D-305): a golden series shifted one tick, a 10-tick release on the oak plate, and a stone plate
// that also counts items must each be caught; every non-`stat` scenario's golden must move. No golden -> SKIP.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCENARIOS, T } from './platescen.mjs';

const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'plate-timing.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'plate-timing.json')].find((f) => existsSync(f));
if (!GOLDEN) {
  console.log('platerefcheck: SKIP (golden not generated -- run node tools/referee/runplate.mjs)');
  process.exit(0);
}
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const EXTRA = ['07_world.js', '02g_items.js', '14f_inventory.js', '07h_entities.js', '14b_physics.js',
               '07i_entitylist.js', '14i_hand.js', '14j_combat.js', '14d_survival.js', '14l_use.js',
               '02f_tags.js', '07b_behaviour.js', '07c_blockentity.js', '07f_redstone.js'];
const TOL = 2;

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };

function runEngine(sc, hook) {
  const M = loadEngine({ extra: EXTRA, dom: false });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
  M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  M.Entities.init();
  M.EntityList.init();
  if (M.Combat && M.Combat.init) M.Combat.init();
  const EL = M.EntityList, W = M.World, CH = M.CH, S = M.States;
  W.init(1);
  for (let cx = -2; cx <= 4; cx++) for (let cz = -2; cz <= 2; cz++) {
    const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
  }
  const STONE = S.stateOf('stone') | 0;
  for (let x = -8; x <= 72; x++) for (let z = -8; z <= 8; z++) W.setBlock(x, -1, z, STONE);
  for (const [x, y, z, name] of sc.blocks || []) W.setBlock(x, y, z, S.stateOf(name) | 0);
  const w = { get: (x, y, z) => W.getBlock(x, y, z), set: (x, y, z, st) => W.setBlock(x, y, z, st) };
  w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 15 << 4;
  M.Behave.init(w);
  if (M.BlockEntities && M.BlockEntities.init) M.BlockEntities.init();
  M.Redstone.init();
  if (M.Use && M.Use.init) M.Use.init(w);   // plates live in 14l_use.js beside buttons (cloud relaxed-curie)
  const B = M.Behave;
  const plate = S.stateOf(sc.plate) | 0;
  W.setBlock(0, 0, 0, plate); B.changed(0, 0, 0);
  if (hook) hook(M);
  for (let i = 0; i < 20; i++) { B.tick(); M.BlockEntities.tick(); EL.tick(); }
  const out = { plate: [] };
  const live = {};
  for (let k = 1; k <= T; k++) {
    for (const [t, type, px, pz, nbt, tag] of sc.spawns) {
      if (t !== k) continue;
      const opts = { vx: 0, vy: 0, vz: 0 };
      if (type === 'item') { opts.item = /id:"minecraft:(\w+)"/.exec(nbt)[1]; opts.count = 1; }
      const e = EL.spawn(type, px, 0.1, pz, opts);
      if (!e) throw new Error(`EntityList.spawn('${type}') returned null`);
      if (type === 'item') e.pickupDelay = EL.PICKUP_NEVER;
      live[tag] = e;
    }
    for (const [t, tag] of sc.kills) if (t === k && live[tag]) live[tag].removed = true;
    const st = W.getBlock(0, 0, 0);
    const v = sc.prop === 'powered' ? (B.propName(st, 'powered') === 'true' ? 1 : 0) : (parseInt(B.propName(st, 'power'), 10) || 0);
    out.plate.push(v);
    B.tick(); M.BlockEntities.tick(); EL.tick();
  }
  return out;
}

function compare(id, g, e) {
  const a = g.plate, b = e.plate || [];
  const i = a.findIndex((v, k) => v !== b[k]);
  return i < 0 ? [] : [`${id}.plate: first differs at tick ${i}:\n        server ${a.map((v) => v.toString(16)).join('')}\n        engine ${b.map((v) => v.toString(16)).join('')}`];
}

console.log(`platerefcheck — pressure plates vs the real 1.18.2 server (${Object.keys(golden.cases).length} scenarios, ${golden.generatedAt})`);
ok(golden.T === T, `golden T ${golden.T} = scenario T ${T} (regenerate: node tools/referee/runplate.mjs)`);
let nScen = 0;
for (const sc of SCENARIOS) {
  const g = golden.cases[sc.id] && golden.cases[sc.id].probes;
  if (!ok(!!g, `${sc.id}: in the golden (regenerate: node tools/referee/runplate.mjs)`)) continue;
  if (!sc.stat) ok(g.plate.some((v) => v !== 0), `${sc.id}: the server's plate went down`);
  let eng;
  try { eng = runEngine(sc); } catch (err) { ok(false, `${sc.id}: engine threw ${err.message}`); continue; }
  const bad = compare(sc.id, g, eng);
  for (const x of bad) ok(false, x);
  if (!bad.length) pass++;
  nScen++;
}

const breakCaught = (m, c) => { breaks++; if (c) { pass++; console.log('   ✓ break caught: ' + m); } else fails.push('anti-vacuity: ' + m); };
const gp = (id) => golden.cases[id].probes;
{
  const g = gp('oak_plate_item');
  const sh = { plate: [0, ...g.plate.slice(0, -1)] };
  breakCaught('oak_plate_item golden shifted one tick is a mismatch', compare('oak_plate_item', sh, { plate: g.plate }).length > 0);
}
{
  const g = gp('oak_plate_item_brief');
  const early = { plate: g.plate.map((v, k) => (k >= 15 ? 0 : v)) };   // let go 10 ticks after the press, not 20
  breakCaught('an oak plate that lets go after 10 ticks is a mismatch', compare('oak_plate_item_brief', g, early).length > 0);
}
{
  const g = gp('stone_plate_item');
  const counts = { plate: gp('oak_plate_item').plate.slice() };        // a stone plate pressed by an item
  breakCaught('a stone plate that an item presses is a mismatch', compare('stone_plate_item', g, counts).length > 0);
}

console.log(`platerefcheck: ${nScen} scenarios compared, ${fails.length} fail, ${breaks} breaks`);
for (const f of fails.slice(0, 60)) console.log('  ✗ ' + f);
console.log('');
console.log('================ platerefcheck (I6) ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks - fails.filter((f) => f.startsWith('anti-vacuity')).length}`);
process.exit(fails.length ? 1 : 0);
