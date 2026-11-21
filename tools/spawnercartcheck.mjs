#!/usr/bin/env node
// spawnercartcheck.mjs -- #3682: spawner minecart NBT (MobSpawnerLogic.readNbt/writeNbt) round trip, SpawnPotentials
// weighted pick, entityDataRequiresOperator. Anti-vacuity: edited source must fail.
import { loadEngine } from './loadsrc.mjs';
console.log('spawnercartcheck -- #3682, spawner minecart NBT');

function scenarios(patch) {
  const fails = []; let n = 0;
  const ok = (c, m) => { n++; if (!c) fails.push(m); };
  const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js', '07f_redstone.js', '07zzq_rail.js', '07zzr_minecart.js'], dom: false, patch });
  const Mc = M.Minecart;
  const nbt = { SpawnData: { entity: { id: 'minecraft:zombie' } }, Delay: 7, MinSpawnDelay: 21, MaxSpawnDelay: 22, SpawnCount: 3,
    MaxNearbyEntities: 9, RequiredPlayerRange: 5, SpawnRange: 2 };
  const e = { type: 'spawner_minecart', x: 0, y: 0, z: 0 };
  Mc.init(e, nbt);
  const L = e.spawnerLogic;
  ok(L.entity === 'zombie' && L.delay === 7 && L.minDelay === 21 && L.maxDelay === 22 && L.count === 3 &&
     L.maxNearbyEntities === 9 && L.requiredPlayerRange === 5 && L.spawnRange === 2, 'all seven fields read');
  const w = Mc.writeSpawnerNbt(e);
  ok(w.Delay === 7 && w.MinSpawnDelay === 21 && w.MaxSpawnDelay === 22 && w.SpawnCount === 3 && w.MaxNearbyEntities === 9 &&
     w.RequiredPlayerRange === 5 && w.SpawnRange === 2 && w.SpawnData.entity.id === 'minecraft:zombie', 'all fields written back');
  const e2 = { type: 'spawner_minecart', x: 0, y: 0, z: 0 }; Mc.init(e2, w);
  ok(JSON.stringify(Mc.writeSpawnerNbt(e2)) === JSON.stringify(w), 'round trip stable');
  const d = { type: 'spawner_minecart' }; Mc.init(d, {});
  ok(d.spawnerLogic.minDelay === 200 && d.spawnerLogic.maxDelay === 800 && d.spawnerLogic.count === 4 && d.spawnerLogic.requiredPlayerRange === 16, 'vanilla defaults');
  ok(d.spawnerLogic.delay === 0, 'missing Delay reads 0 (getShort)');
  const p = { type: 'spawner_minecart' };
  Mc.init(p, { SpawnData: { entity: { id: 'pig' } }, SpawnPotentials: [{ data: { entity: { id: 'minecraft:cow' } }, weight: 0 }, { data: { entity: { id: 'minecraft:sheep' } }, weight: 5 }] });
  const seen = new Set(); for (let i = 0; i < 50; i++) seen.add(Mc.pickPotential(p.spawnerLogic));
  ok(seen.size === 1 && seen.has('sheep'), 'weighted pick skips weight 0');
  ok(Mc.entityDataRequiresOperator('spawner_minecart') && !Mc.entityDataRequiresOperator('minecart'), 'requires operator');
  ok(Mc.writeSpawnerNbt(p).SpawnPotentials.length === 2, 'potentials persisted');
  return { fails, n };
}

const real = scenarios();
const fails = real.fails.slice(); let breaks = 0;
for (const [label, a, b] of [
  ['SpawnRange ignored', 'if (n.SpawnRange !== undefined)', 'if (false)'],
  ['Delay ignored', 'L.delay = sh(n.Delay);', ''],
  ['Delay guarded', 'L.delay = sh(n.Delay);', 'if (n.Delay !== undefined) L.delay = sh(n.Delay);'],
  ['operator flag off', "return type === 'spawner_minecart' ||", 'return false ||'],
  ['weights ignored', 'Math.max(0, L.potentials[i].weight); if (r < 0)', '1; if (r < 0)'],
  ['count not written', 'SpawnCount: L.count', 'SpawnCount: 0'],
]) {
  let matched = false;
  const patch = (f, src) => { if (f !== '07zzr_minecart.js') return src; if (src.includes(a)) matched = true; return src.split(a).join(b); };
  let r; try { r = scenarios(patch); } catch (err) { r = { fails: ['threw'] }; }
  if (!matched) fails.push('edit matched nothing: ' + label);
  else if (r.fails.length) { breaks++; console.log('   ✓ break caught: ' + label); } else fails.push('unnoticed break: ' + label);
}
if (fails.length) { console.log('FAIL'); fails.forEach((f) => console.log('  ' + f)); process.exit(1); }
console.log(`spawnercartcheck: ${real.n} assertions, 0 failures, ${breaks} breaks caught`);
