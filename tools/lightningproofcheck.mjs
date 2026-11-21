#!/usr/bin/env node
// lightningproofcheck.mjs — #11682: 07zzc_lightning.js classes SkeletonHorseEntity (trap timeout 18000, mounted
// offset -0.1875), BiomeParticleConfig + TheNetherBiomeCreator (Lgt.BIOME_PARTICLE reached via biomeDisplayParticle).
import { loadEngine } from './loadsrc.mjs';
const M = loadEngine({ extra: ['07zzc_lightning.js'], dom: false });
const L = M.Lightning || M.Lgt;
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const run = () => {
  const out = [];
  if (!L) return ['nolgt'];
  const savedB = M.Biomes, savedW = M.World, savedP = M.Particle, savedS = M.States;
  let cur = 'soul_sand_valley', spawned = [];
  M.States = { solidRender: () => false, fullCubeCollision: () => false };
  M.Biomes = { ready: true, name: () => 'minecraft:' + cur };
  M.World = { biomeAt3: () => 0 };
  M.Particle = { spawn: (n) => spawned.push(n) };
  for (const [b, p] of [['soul_sand_valley', 'ash'], ['basalt_deltas', 'white_ash'], ['crimson_forest', 'crimson_spore'], ['warped_forest', 'warped_spore']]) {
    cur = b; spawned = [];
    const n = L.biomeDisplayParticle(1, 0, 0, 0, () => 0.001);
    out.push(n === 1 && spawned[0] === p ? 'ok' : 'bad:' + b);
    spawned = [];
    out.push(L.biomeDisplayParticle(1, 0, 0, 0, () => 0.9) === 0 ? 'ok' : 'bad-hi:' + b);
  }
  cur = 'plains'; out.push(L.biomeDisplayParticle(1, 0, 0, 0, () => 0) === 0 ? 'ok' : 'bad-plains');
  M.Biomes = savedB; M.World = savedW; M.Particle = savedP; M.States = savedS;
  // SkeletonHorseEntity trap timeout
  const removed = [];
  const savedE = M.EntityList;
  M.EntityList = { remove: (e) => removed.push(e) };
  const h = { trapped: true, trapTime: 18000, x: 0, y: 0, z: 0 };
  L.tickTrap(h);
  out.push(removed.length === 1 ? 'ok' : 'bad-timeout');
  const h2 = { trapped: true, trapTime: 17999, x: 0, y: 0, z: 0 };
  try { L.tickTrap(h2); } catch (e) {}
  out.push(removed.length === 1 ? 'ok' : 'bad-early');
  M.EntityList = savedE;
  // mounted offset
  const savedR = M.Raid; M.Raid = { startRiding() {} };
  const r = { x: 0, y: 0, z: 0 }, v = { x: 1, y: 10, z: 2, height: 1.6 };
  L.mountTrapRider(r, v);
  out.push(Math.abs(r.y - (10 + 1.2 - 0.1875 - 0.6)) < 1e-9 ? 'ok' : 'bad-offset');
  M.Raid = savedR;
  return out;
};
const good = () => { try { return run().every(x => x === 'ok'); } catch (e) { return false; } };
ok(good(), 'biome particle config + skeleton horse trap behave');
ok(L.BIOME_PARTICLE.basalt_deltas[1] === 0.118093334, 'basalt prob');
const caught = (label, fn, restore) => {
  fn(); const bad = !good(); restore();
  if (bad) { breaks++; console.log(`   ✓ break caught: ${label}`); } else fails.push('anti-vacuity: ' + label);
};
const bp = JSON.stringify(L.BIOME_PARTICLE), tt = L.TRAP_TIMEOUT, dd = L.SKELETON_HORSE_MOUNTED_OFFSET_DELTA;
caught('crimson particle swapped', () => { L.BIOME_PARTICLE.crimson_forest[0] = 'ash'; }, () => { L.BIOME_PARTICLE = JSON.parse(bp); });
caught('nether biome removed', () => { delete L.BIOME_PARTICLE.warped_forest; }, () => { L.BIOME_PARTICLE = JSON.parse(bp); });
caught('timeout 0', () => { L.TRAP_TIMEOUT = 99999; }, () => { L.TRAP_TIMEOUT = tt; });
caught('offset 0', () => { L.SKELETON_HORSE_MOUNTED_OFFSET_DELTA = 0; }, () => { L.SKELETON_HORSE_MOUNTED_OFFSET_DELTA = dd; });
console.log('\n================ lightningproofcheck ================');
console.log(` assertions passed .. ${pass}\n failures ........... ${fails.length}`);
for (const f of fails) console.log('  ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
