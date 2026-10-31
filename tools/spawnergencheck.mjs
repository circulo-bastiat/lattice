#!/usr/bin/env node
// spawnergencheck.mjs — #167 (G18c-d): Spawner.OWED #1. A spawner generated in the WORKER bundle
// (no NS.Spawner, no NS.BlockEntities) must still end up with its entity id on the main thread,
// via Gen.spawnerLog -> genColumn().spawners -> gen:done -> World.installChunk -> Spawner.assign.
//
//   node tools/spawnergencheck.mjs [--verbose]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const VERBOSE = process.argv.includes('--verbose');
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { if (ok(c, 'anti-vacuity: ' + m)) { breaks++; console.log('  ✓ break caught: ' + m); } };
console.log('spawnergencheck -- #167, worker-generated spawners get their entity id');

const SEED = 20260924, R = 8;
// ---- worker side: the bare worker bundle, exactly what chunk.worker.js runs
const WK = loadEngine({});
ok(!WK.Spawner && !WK.BlockEntities, 'the worker bundle has neither NS.Spawner nor NS.BlockEntities');
WK.Gen.init(SEED, Object.assign(WK.Gen.defaults(), { climate: 'vanilla', features: true }));
const SP = WK.States.stateOf('spawner');
const results = [];
for (let cx = -R; cx < R; cx++) for (let cz = -R; cz < R; cz++) {
  const col = WK.Gen.genColumn(cx, cz);
  if (col.spawners && col.spawners.length) results.push({ cx, cz, col, spawners: col.spawners.map((s) => s.slice()) });
}
const all = results.flatMap((r) => r.spawners);
if (VERBOSE) console.log('   spawners found:', all.length);
ok(all.length > 0, 'worker-mode genColumn recorded at least one spawner over ' + (2 * R) ** 2 + ' chunks');
const DUN = new Set(['skeleton', 'zombie', 'spider']);
ok(all.every((s) => DUN.has(s[3]) || s[3] === 'cave_spider'), 'every recorded id is a dungeon mob or cave_spider');
ok(all.some((s) => DUN.has(s[3])), 'a dungeon spawner id (zombie/skeleton/spider) was recorded');
ok(all.some((s) => s[3] === 'cave_spider'), 'a mineshaft cave_spider id was recorded');

// ---- main side: World.installChunk with the worker result
function mainWorld() {
  const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '02h_recipes.js', '07_world.js', '07b_behaviour.js',
    '07c_blockentity.js', '07zs_spawner.js'], dom: false });
  M.BlockEntities.init();
  return M;
}
function install(cutChannel) {
  const M = mainWorld();
  let placed = 0, withId = 0, wrong = 0;
  for (const r of results.slice(0, 12)) {
    const res = { sec: r.col.sec, hmap: r.col.hmap, biome: r.col.biome || null, spawners: cutChannel ? null : r.col.spawners };
    M.World.installChunk(r.cx, r.cz, res);
    for (const s of r.spawners) {
      if (M.World.getBlock(s[0], s[1], s[2]) !== SP) continue;
      placed++;
      const e = M.BlockEntities.get(s[0], s[1], s[2]);
      if (e && e.type === 'mob_spawner' && e.entity === s[3]) withId++; else if (e && e.entity !== 'pig') wrong++;
    }
  }
  return { placed, withId, wrong };
}
try {
  const good = install(false);
  ok(good.placed > 0, 'spawner blocks are present in the installed chunks (' + good.placed + ')');
  ok(good.withId === good.placed, 'every installed worker spawner carries its entity id (' + good.withId + '/' + good.placed + ')');
  const cut = install(true);
  okAv(cut.withId === 0, 'channel cut (res.spawners dropped): no spawner gets its id (' + cut.withId + ')');
} catch (e) { fails.push('threw: ' + (e && e.stack || e)); }

// the wiring: cutting any hop breaks it
const rd = (f) => readFileSync(join(MCLITE_ROOT, 'src', f), 'utf8');
for (const [f, needle] of [['workers/chunk.worker.js', 'spawners: col.spawners'], ['09_jobs.js', 'spawners: m.spawners'],
  ['09_jobs.js', 'spawners: col.spawners'], ['07_world.js', 'res.spawners']]) {
  ok(rd(f).includes(needle), f + ' carries the spawners channel');
}

console.log(`\nspawnergencheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
if (fails.length) { for (const f of fails.slice(0, 40)) console.log('  x ' + f); process.exit(1); }
