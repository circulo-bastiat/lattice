#!/usr/bin/env node
// spawnerpotentialscheck.mjs -- #5722: mob_spawner SpawnPotentials (MobSpawnerLogic.readNbt/updateSpawns).
// Weighted pick, JSON save round trip, entry NBT reaching the mob. Anti-vacuity: edited source must fail.
import { readFileSync } from 'node:fs';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
console.log('spawnerpotentialscheck -- #5722, spawner SpawnPotentials');

function scenarios(patch) {
  const fails = []; let n = 0;
  const ok = (c, m) => { n++; if (!c) fails.push(m); };
  const M = loadEngine({ extra: ['07zs_spawner.js'], dom: false, patch });
  const Sp = M.Spawner;
  const list = [
    { data: { entity: { id: 'minecraft:zombie', Health: 7 } }, weight: 1 },
    { data: { entity: { id: 'minecraft:skeleton' } }, weight: 3 },
    { data: { entity: { id: 'minecraft:spider' } }, weight: 6 }];
  const e = { type: 'mob_spawner', entity: 'pig' };
  Sp.setPotentials(e, list);
  ok(e.potentials.length === 3 && e.potentials[0].id === 'zombie', 'list read');
  const saved = JSON.parse(JSON.stringify({ potentials: e.potentials, spawnData: e.spawnData }));
  const e2 = { type: 'mob_spawner', potentials: saved.potentials };
  ok(JSON.stringify(e2.potentials) === JSON.stringify(e.potentials), 'save/load round trip');
  let s = 12345; const rnd = (b) => { s = (s * 1103515245 + 12345) & 0x7fffffff; return Math.floor((s / 0x80000000) * b); };
  const cnt = { zombie: 0, skeleton: 0, spider: 0 };
  for (let i = 0; i < 1000; i++) { Sp.updateSpawnEntry(e, rnd); cnt[e.entity]++; }
  ok(cnt.zombie > 60 && cnt.zombie < 150 && cnt.skeleton > 240 && cnt.skeleton < 360 && cnt.spider > 520 && cnt.spider < 680, 'weights 1:3:6 ' + JSON.stringify(cnt));
  ok(Sp.pickEntry(e, () => 0).id === 'zombie' && Sp.pickEntry(e, () => 1).id === 'skeleton' && Sp.pickEntry(e, () => 9).id === 'spider', 'weight order');
  const d = { entity: 'pig', spawnData: { entity: { id: 'pig' } } };
  ok(!Sp.updateSpawnEntry(d, rnd) && d.entity === 'pig', 'empty list keeps SpawnData');
  const mob = { health: 20 };
  Sp.applyEntityNbt(mob, list[0].data);
  ok(mob.health === 7, 'entry NBT Health reaches the mob');
  return { fails, n };
}
const real = scenarios();
const fails = real.fails.slice(); let breaks = 0;
for (const [label, a, b] of [
  ['weight order reversed', 'for (i = 0; i < p.length; i++) { r -= Math.max(0, p[i].weight | 0); if (r < 0) return p[i]; }', 'for (i = p.length - 1; i >= 0; i--) { r -= Math.max(0, p[i].weight | 0); if (r < 0) return p[i]; }'],
  ['NBT not applied', "ent.health = n.Health;", ''],
  ['weights ignored', 'tot += Math.max(0, p[i].weight | 0)', 'tot += 1'],
]) {
  let matched = false;
  const patch = (f, src) => { if (f !== '07zs_spawner.js') return src; if (src.includes(a)) matched = true; return src.split(a).join(b); };
  let r; try { r = scenarios(patch); } catch (err) { r = { fails: ['threw'] }; }
  if (!matched) fails.push('edit matched nothing: ' + label);
  else if (r.fails.length) { breaks++; console.log('   ✓ break caught: ' + label); } else fails.push('unnoticed break: ' + label);
}
const be = readFileSync(MCLITE_ROOT + '/src/07c_blockentity.js', 'utf8');
if (!/mob_spawner: \[[^\]]*'potentials', 'spawnData'\]/.test(be)) fails.push('BE.FIELDS mob_spawner lacks potentials');
else { breaks++; console.log('   ✓ BE.FIELDS persists potentials'); }
if (fails.length) { console.log('FAIL'); fails.forEach((f) => console.log('  ' + f)); process.exit(1); }
console.log(`spawnerpotentialscheck: ${real.n} assertions, 0 failures, ${breaks} breaks caught`);
