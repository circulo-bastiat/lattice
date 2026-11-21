#!/usr/bin/env node
// golemposcheck.mjs — loop/golempos (QUEUE 0.2, Village.OWED): where a summoned iron golem lands.
//   VillagerEntity.getHighestOpenPositionOnOffset (.decomp VillagerEntity.java:922-938) walks a
//   column DOWN from +6 to -6 for an air-or-liquid cell over a light-blocking MATERIAL, and
//   spawnIronGolem (:898-919) then asks IronGolemEntity.canSpawn (IronGolemEntity.java:324-341).
//   §1 re-derives Village's two Material.blocksLight lists from the jar data (Material.java +
//   tools/golden/block-materials-1.18.2.tsv + .decomp/names.tsv) — the code owns the lists, this
//   stage referees them. §2-§5 drive the real column walk and canSpawn, both directions.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); };
console.log('golemposcheck — getHighestOpenPositionOnOffset + IronGolemEntity.canSpawn');

const M = loadEngine({ extra: ['02f_tags.js', '07_world.js', '07b_behaviour.js', '07h_entities.js', '14b_physics.js',
  '07i_entitylist.js', '07l_spawn.js'], dom: false });
initRegistry(M);
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init();
M.EntityList.init();
const W = M.World, V = M.Village, CH = M.CH, st = (n) => M.States.stateOf(n) | 0;

// §1 the two Material.blocksLight lists, re-derived from the jar's own data
{
  const names = {};
  for (const l of readFileSync(join(MCLITE_ROOT, '.decomp', 'names.tsv'), 'utf8').split('\n')) {
    const c = l.split('\t');
    if (c[0] === 'field' && c[1] === 'djb' && c[3] === 'Ldjb;') names[c[2]] = c[6];
  }
  const src = readFileSync(join(MCLITE_ROOT, '.decomp', 'net', 'minecraft', 'block', 'Material.java'), 'utf8');
  const mats = {}; const re = /public static final Material (\w+) = new Material\.Builder\([^)]*\)([\s\S]*?)\.build\(\);/g; let m;
  while ((m = re.exec(src))) mats[m[1]] = { light: !/lightPassesThrough/.test(m[2]), solid: !/notSolid/.test(m[2]) };
  ok(Object.keys(mats).length >= 40, `Material.java parsed ${Object.keys(mats).length} materials`);
  const rows = readFileSync(join(MCLITE_ROOT, 'tools', 'golden', 'block-materials-1.18.2.tsv'), 'utf8').split('\n')
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('block\t'));
  const solidPass = [], nonsolidBlock = []; let unresolved = 0;
  for (const r of rows) {
    const [b, o] = r.split('\t'); const M2 = mats[names[o]];
    if (!M2) { unresolved++; continue; }
    if (M2.solid && !M2.light) solidPass.push(b);
    if (!M2.solid && M2.light) nonsolidBlock.push(b);
  }
  ok(unresolved === 0 && rows.length > 800, `every block's material resolves (${rows.length} rows, ${unresolved} unresolved)`);
  const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  ok(same(V.SOLID_LIGHT_PASSES, solidPass), `Village.SOLID_LIGHT_PASSES matches the jar (${solidPass.length})`);
  ok(same(V.NONSOLID_BLOCKS_LIGHT, nonsolidBlock), `Village.NONSOLID_BLOCKS_LIGHT matches the jar (${nonsolidBlock.join(',')})`);
  okAv(!same(V.SOLID_LIGHT_PASSES.filter((n) => n !== 'glass'), solidPass), 'dropping glass from the list is caught');
  ok(V.materialBlocksLight(st('stone')) && V.materialBlocksLight(st('oak_slab')) && V.materialBlocksLight(st('dirt')),
    'stone/slab/dirt block light');
  ok(!V.materialBlocksLight(st('glass')) && !V.materialBlocksLight(st('oak_leaves')) && !V.materialBlocksLight(st('grass'))
    && !V.materialBlocksLight(st('white_carpet')) && !V.materialBlocksLight(0), 'glass/leaves/grass/carpet/air do not');
}

function freshWorld() {
  W.init(1); M.Behave.init(W);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
    const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
  }
  M.EntityList.clear();
}
const Y = 8;
// §2 the column walk: first open cell from +6 down, over a light-BLOCKING material
freshWorld();
{
  W.setBlock(3, Y, 3, st('stone'));
  let p = V.highestOpenOnOffset(0, Y + 1, 0, 3, 3);
  ok(p && p.x === 3 && p.y === Y + 1 && p.z === 3, `air over stone at y=${Y} -> y=${Y + 1}, got ${JSON.stringify(p)}`);
  W.setBlock(3, Y + 4, 3, st('glass'));
  p = V.highestOpenOnOffset(0, Y + 1, 0, 3, 3);
  ok(p && p.y === Y + 1, `glass above does not stop the walk (glass lets light through), got ${JSON.stringify(p)}`);
  W.setBlock(3, Y + 4, 3, st('oak_planks'));
  p = V.highestOpenOnOffset(0, Y + 1, 0, 3, 3);
  ok(p && p.y === Y + 5, `a plank roof at +4 is the highest answer (y=${Y + 5}), got ${JSON.stringify(p)}`);
  W.setBlock(3, Y + 4, 3, 0);
  W.setBlock(3, Y + 1, 3, st('water'));
  p = V.highestOpenOnOffset(0, Y + 1, 0, 3, 3);
  ok(p && p.y === Y + 1, `water over stone: the water cell itself is the answer (isLiquid) -> y=${Y + 1}, got ${JSON.stringify(p)}`);
  W.setBlock(3, Y + 2, 3, st('stone'));
  p = V.highestOpenOnOffset(0, Y + 1, 0, 3, 3);
  ok(p && p.y === Y + 3, `a stone cap over the water puts the answer on the cap, got ${JSON.stringify(p)}`);
  W.setBlock(3, Y + 2, 3, 0);
  W.setBlock(3, Y + 1, 3, 0);
  W.setBlock(3, Y, 3, st('oak_leaves'));
  p = V.highestOpenOnOffset(0, Y + 1, 0, 3, 3);
  okAv(p === null, `leaves only (light passes) within +-6: no answer, got ${JSON.stringify(p)}`);
  W.setBlock(3, Y, 3, st('stone'));
  p = V.highestOpenOnOffset(0, Y + 8, 0, 3, 3);
  okAv(p === null, `stone 8 below the villager is out of the -6 reach, got ${JSON.stringify(p)}`);
}
// §3 water ABOVE a floor: the lowest water cell over stone is the answer (liquid counts as open)
freshWorld();
{
  W.setBlock(0, Y, 0, st('stone'));
  for (let y = Y + 1; y <= Y + 2; y++) W.setBlock(0, y, 0, st('water'));
  const p = V.highestOpenOnOffset(0, Y + 1, 0, 0, 0);
  ok(p && p.y === Y + 1, `water cell over stone is open (isLiquid) -> y=${Y + 1}, got ${JSON.stringify(p)}`);
  ok(V.golemCanSpawnAt(0, Y + 1, 0) === false, 'but a golem cannot spawn with water in the two cells above its feet');
}
// §4 IronGolemEntity.canSpawn, both directions
freshWorld();
{
  for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) W.setBlock(x, Y, z, st('stone'));
  ok(V.golemCanSpawnAt(0, Y + 1, 0), 'open ground over stone: a golem may spawn');
  W.setBlock(0, Y + 3, 0, st('stone'));
  okAv(!V.golemCanSpawnAt(0, Y + 1, 0), 'a full block two above the feet refuses it (y+2 not clear)');
  W.setBlock(0, Y + 3, 0, 0);
  W.setBlock(0, Y + 1, 0, st('water'));
  ok(V.golemCanSpawnAt(0, Y + 1, 0), 'water at the FEET is allowed (Fluids.EMPTY for the feet cell)');
  W.setBlock(0, Y + 1, 0, 0);
  W.setBlock(0, Y, 0, 0);
  okAv(!V.golemCanSpawnAt(0, Y + 1, 0), 'no floor: refused (hasSolidTopSurface)');
  W.setBlock(0, Y, 0, st('stone'));
  const v = M.EntityList.spawn('villager', 0.5, Y + 1, 0.5);
  ok(!!v, 'a villager spawned');
  okAv(!V.golemCanSpawnAt(0, Y + 1, 0), 'a villager standing in the golem box refuses it (doesNotIntersectEntities)');
  ok(V.golemCanSpawnAt(3, Y + 1, 3), 'three blocks away it is fine');
  M.EntityList.clear();
  M.EntityList.dropStack && M.EntityList.dropStack(0.5, Y + 1, 0.5, 'stone', 1);
  ok(V.golemCanSpawnAt(0, Y + 1, 0), 'a dropped ITEM does not block (not intersectionChecked)');
  M.EntityList.clear();
}
// §5 findGolemSpawnPos: a refused column is skipped to the next try, not walked further
freshWorld();
{
  for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) W.setBlock(x, Y, z, st('stone'));
  // rand sequence: try 1 -> offset (-8,-8), a 2-deep water pool (the column answers the water
  // cell, canSpawn refuses: water above the feet); try 2 -> (0,0)
  W.setBlock(-8, Y + 1, -8, st('water')); W.setBlock(-8, Y + 2, -8, st('water'));
  ok(JSON.stringify(V.highestOpenOnOffset(0, Y + 1, 0, -8, -8)) === JSON.stringify({ x: -8, y: Y + 1, z: -8 }), 'the pool column answers its bottom water cell');
  const seq = [0, 0, 0.5, 0.5]; let i = 0; const rand = () => seq[i++ % seq.length];
  const p = V.findGolemSpawnPos({ x: 0.5, y: Y + 1, z: 0.5 }, rand);
  ok(p && p.x === 8.5 - 8 && p.z === 0.5 && p.y === Y + 1, `a roofed first try is discarded and the second try's column wins, got ${JSON.stringify(p)}`);
  okAv(i === 4, `exactly two tries were drawn (4 rand calls), got ${i}`);
  const q = V.findGolemSpawnPos({ x: 0.5, y: Y + 30, z: 0.5 }, () => 0.5);
  okAv(q === null, 'a villager 30 above the ground finds nothing in ten tries');
}
console.log(`\n${pass} ok, ${breaks} anti-vacuity breaks caught, ${fails.length} failed`);
if (fails.length) { fails.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
