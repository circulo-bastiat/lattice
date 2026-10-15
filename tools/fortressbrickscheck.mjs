#!/usr/bin/env node
// fortressbrickscheck.mjs — #3768: SpawnHelper.shouldUseNetherFortressSpawns. A monster spawn over
// nether_bricks inside the fortress START box gets the fortress list even outside every piece box.
import { loadEngine } from './loadsrc.mjs';
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const M = loadEngine({ extra: ['07l_spawn.js'], dom: false });
M.Gen.init(1337, Object.assign(M.Gen.defaults(), { climate: 'vanilla' }));
const ST = M.Structures, R = M.Reg, S = M.States;
M.Dim.cur = 'the_nether'; M.World = {};
let s = null, gap = null;
const inPiece = (x, y, z) => s.pieces.some((p) => x >= p.x0 && x <= p.x1 && y >= p.y0 && y <= p.y1 && z >= p.z0 && z <= p.z1);
for (let cz = -120; cz <= 120 && !gap; cz += 8) for (let cx = -120; cx <= 120 && !gap; cx += 8)
  for (const t of ST.startsNear(cx, cz)) {
    if (t.def.name !== 'fortress') continue;
    s = t;
    for (let x = t.x0; x <= t.x1 && !gap; x++) for (let z = t.z0; z <= t.z1 && !gap; z++) for (let y = t.y0; y <= t.y1; y++) if (!inPiece(x, y, z)) { gap = [x, y, z]; break; }
    if (gap) break;
  }
ok(gap, 'no fortress start with a point in its box but in no piece');
const nbId = (() => { for (let i = 1; i < S.block.length; i++) if (S.block[i] === R.id.nether_bricks) return i; })();
ok(nbId > 0, 'nether_bricks state not found');
const bi = M.Biomes.indexOf['nether_wastes'];
const run = (tag) => {
  const [x, y, z] = gap;
  const types = (l) => l ? l.map((e) => e.type).join() : 'null';
  M.World.getBlock = () => nbId;
  ok(types(M.Spawn.spawnList(bi, 'monster', x, y, z)).includes('wither_skeleton'), tag + 'nether_bricks below, in start box, no piece: fortress list');
  ok(types(M.Spawn.spawnList(bi, 'creature', x, y, z)).includes('wither_skeleton') === false, tag + 'non-monster category stays biome list');
  M.World.getBlock = () => 0;
  ok(!types(M.Spawn.spawnList(bi, 'monster', x, y, z)).includes('wither_skeleton'), tag + 'other block below, outside pieces: biome list');
  M.World.getBlock = () => nbId;
  ok(!types(M.Spawn.spawnList(bi, 'monster', s.x1 + 1, y, s.z0)).includes('wither_skeleton'), tag + 'outside start box: biome list');
};
run('');
const realO = ST.spawnOverride; let caught = 0;
for (const [nm, fn] of Object.entries({
  'flag ignored': (x, y, z, c) => realO(x, y, z, c, false),
  'flag always on': (x, y, z, c) => realO(x, y, z, c, true) || null
})) {
  const before = fails.length; ST.spawnOverride = fn; try { run('[' + nm + '] '); } catch (e) { fails.push('x'); }
  ST.spawnOverride = realO;
  if (fails.length > before) { caught++; fails.length = before; console.log('  ✓ break caught: ' + nm); } else fails.push('break not caught: ' + nm);
}
console.log(`${caught} breaks caught`);
for (const f of fails) console.log('   ✗ ' + f);
console.log('fortressbrickscheck: ' + pass + ' assertions, ' + caught + ' breaks caught' + (fails.length ? ', ' + fails.length + ' FAILED' : ''));
process.exit(fails.length ? 1 : 0);
