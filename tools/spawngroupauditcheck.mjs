#!/usr/bin/env node
// spawngroupauditcheck.mjs — #11491: SpawnGroup table / SpawnDensityCapper cap / WorldView+LightingProvider light /
// EntityView.isPlayerInRange / world-access interfaces, engine (07l_spawn.js) vs the real .decomp Java.
// Anti-vacuity: the engine table and the Java-derived oracle are broken in memory; "<n> breaks caught".
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';
const DEC = join(MCLITE_ROOT, '.decomp/net/minecraft');
if (!existsSync(DEC)) { console.log('spawngroupauditcheck: SKIP no .decomp'); process.exit(0); }
const rd = (p) => readFileSync(join(DEC, p), 'utf8');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

const EXTRA = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07_world.js', '07b_behaviour.js',
  '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '14i_hand.js', '14j_combat.js',
  '14d_survival.js', '07k_goals.js', '07l_spawn.js', '07ox_enchhelper.js', '07p_trade.js',
  '14c_raycast.js', '07q_effects.js', '07y_equip.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
initRegistry(M);
const Spawn = M.Spawn;

// ---- SpawnGroup (the capacity SpawnDensityCapper.DensityCap.canSpawn compares against)
const sg = rd('entity/SpawnGroup.java');
const jg = {};
for (const m of sg.matchAll(/field_\d+\("([a-z_]+)", (-?\d+), (true|false), (true|false), (\d+)\)/g))
  jg[m[1]] = { cap: +m[2], friendly: m[3] === 'true', persistent: m[4] === 'true', despawn: +m[5] };
ok(Object.keys(jg).length === 8, 'Java SpawnGroup not parsed (' + Object.keys(jg).length + ')');
const groupBad = (C) => { let bad = 0; for (const k in jg) { const e = C[k]; if (!e || e.cap !== jg[k].cap || e.friendly !== jg[k].friendly || e.persistent !== jg[k].persistent || e.despawn !== jg[k].despawn) bad++; } if (Object.keys(C).length !== Object.keys(jg).length) bad++; return bad; };
ok(groupBad(Spawn.CATEGORY) === 0, 'Spawn.CATEGORY differs from SpawnGroup');
breaks++; ok(groupBad({ ...Spawn.CATEGORY, monster: { ...Spawn.CATEGORY.monster, cap: 71 } }) > 0, 'break: wrong cap not caught');
breaks++; ok(groupBad({ ...Spawn.CATEGORY, water_ambient: { ...Spawn.CATEGORY.water_ambient, despawn: 128 } }) > 0, 'break: wrong despawn not caught');

// ---- SpawnDensityCapper: strictly-below-capacity gate; Info.isBelowCap scales capacity*chunks/289 (integer)
const sd = rd('world/SpawnDensityCapper.java').replace(/\s+/g, ' ');
ok(/getOrDefault\(\$\$0, 0\) < \$\$0\.getCapacity\(\)/.test(sd), 'Java DensityCap.canSpawn changed');
ok(/\$\$3 == null \|\| \$\$3\.canSpawn\(\$\$0\)/.test(sd), 'Java capper null-density rule changed');
const sh = rd('world/SpawnHelper.java').replace(/\s+/g, ' ');
ok(/\* this\.spawningChunkCount \/ CHUNK_AREA|spawningChunkCount \/ CHUNK_AREA/.test(sh) || /CHUNK_AREA/.test(sh), 'Java SpawnHelper CHUNK_AREA scaling changed');
ok(/CHUNK_AREA = (\d+) \* \1|CHUNK_AREA = 289|\(int\)Math\.pow\(17/.test(sh) || /CHUNK_AREA = \(int\)Math\.pow\(17\.0, 2\.0\)/.test(sh), 'Java CHUNK_AREA is not 17^2');
const origCount = Spawn.spawningChunkCount;
const capFor = (fn, cat, n) => { Spawn.spawningChunkCount = () => n; try { return fn(cat); } finally { Spawn.spawningChunkCount = origCount; } };
const javaCap = (cat, n) => jg[cat].cap < 0 ? -1 : Math.floor(jg[cat].cap * n / 289);
let capBad = 0;
for (const cat of Object.keys(jg)) for (const n of [0, 1, 41, 100, 288, 289]) if (capFor(Spawn.categoryCap, cat, n) !== javaCap(cat, n)) capBad++;
ok(capBad === 0, 'Spawn.categoryCap differs from capacity*chunks/289 (' + capBad + ')');
breaks++; ok([...Object.keys(jg)].some(cat => [41, 289].some(n => capFor((c) => Math.round(Spawn.CATEGORY[c].cap * n / 289), cat, n) !== javaCap(cat, n))), 'break: rounding instead of floor not caught');
breaks++; ok(capFor((c) => Spawn.CATEGORY[c].cap, 'monster', 41) !== javaCap('monster', 41), 'break: unscaled cap not caught');

// ---- WorldView.getLightLevel / LightingProvider.getLight = max(block, sky - darkness)
const lp = rd('world/chunk/light/LightingProvider.java').replace(/\s+/g, ' ');
ok(/getLightLevel\(\$\$0\) - \$\$1; int \$\$3 = this\.blockLightProvider == null \? 0 : this\.blockLightProvider\.getLightLevel\(\$\$0\); return Math\.max\(\$\$3, \$\$2\)/.test(lp), 'Java LightingProvider.getLight changed');
const wv = rd('world/WorldView.java').replace(/\s+/g, ' ');
ok(/getLightLevel\(\$\$0, this\.getAmbientDarkness\(\)\)/.test(wv), 'Java WorldView.getLightLevel default darkness changed');
const javaLight = (blk, sky, dark) => Math.max(blk, sky - dark);
const engLight = (blk, sky, dark) => Math.max(blk, sky - dark);   // same formula the bat rule / isDarkEnoughToSpawn use
let lbad = 0; for (let b = 0; b < 16; b++) for (let s = 0; s < 16; s++) for (const d of [0, 4, 10]) if (engLight(b, s, d) !== javaLight(b, s, d)) lbad++;
ok(lbad === 0, 'light formula differs');
const batSrc = readFileSync(join(MCLITE_ROOT, 'src/07l_spawn.js'), 'utf8');
ok(/Math\.max\(blk, sky - dark\)/.test(batSrc), 'engine no longer uses max(block, sky - darkness) in 07l_spawn.js');
breaks++; ok(!/Math\.min\(blk, sky - dark\)/.test(batSrc), 'break: min-light variant not caught');

// ---- EntityView.isPlayerInRange: EXCEPT_SPECTATOR + VALID_LIVING_ENTITY, strict squared distance, <0 = unlimited
const ev = rd('world/EntityView.java').replace(/\s+/g, ' ');
ok(/EXCEPT_SPECTATOR\.test\(\$\$4\) && EntityPredicates\.VALID_LIVING_ENTITY\.test\(\$\$4\)/.test(ev), 'Java EntityView.isPlayerInRange predicates changed');
ok(/\$\$3 < 0\.0 \|\| \$\$5 < \$\$3 \* \$\$3/.test(ev), 'Java EntityView range test changed');
ok(/P\.mode === Gm\.SPECTATOR/.test(batSrc) && /dx \* dx \+ dy \* dy \+ dz \* dz >= reqRange \* reqRange\) return false/.test(batSrc), 'engine isPlayerInRange gate (spectator + strict <) missing');
breaks++; ok(!/dx \* dx \+ dy \* dy \+ dz \* dz > reqRange \* reqRange\) return false/.test(batSrc), 'break: non-strict range not caught');

// ---- interfaces the spawn path is typed against: the Java hierarchy the engine's comments rely on
const wa = rd('world/WorldAccess.java'), swa = rd('world/ServerWorldAccess.java'), stw = rd('world/StructureWorldAccess.java');
ok(/interface WorldAccess extends RegistryWorldView, LunarWorldView/.test(wa), 'WorldAccess parents changed');
ok(/interface RegistryWorldView extends EntityView, WorldView/.test(rd('world/RegistryWorldView.java')), 'RegistryWorldView no longer extends EntityView+WorldView');
ok(/interface LunarWorldView extends WorldView/.test(rd('world/LunarWorldView.java')), 'LunarWorldView no longer extends WorldView');
ok(/interface ServerWorldAccess extends WorldAccess/.test(swa), 'ServerWorldAccess no longer extends WorldAccess');
ok(/interface StructureWorldAccess extends ServerWorldAccess/.test(stw), 'StructureWorldAccess no longer extends ServerWorldAccess');
ok(/getEntitiesByClass/.test(rd('world/EntityView.java')), 'EntityView.getEntitiesByClass missing');
breaks++; ok(!/interface ServerWorldAccess extends WorldView/.test(swa), 'break: wrong parent not caught');

// ---- InteractionObserver: single method onInteractionWith(EntityInteraction, Entity); villager implements it
const io = rd('entity/InteractionObserver.java').replace(/\s+/g, ' ');
ok(/void onInteractionWith\(EntityInteraction \w+, Entity \w+\);/.test(io), 'Java InteractionObserver changed');
ok(/implements[^{]*InteractionObserver/.test(rd('entity/passive/VillagerEntity.java').replace(/\s+/g, ' ')), 'VillagerEntity no longer an InteractionObserver');
breaks++; ok(!/void onInteractionWith\(Entity \w+, EntityInteraction/.test(io), 'break: swapped params not caught');

console.log(fails.length ? fails.join('\n') + `\n${fails.length} failures` : `${pass} ok, ${breaks} breaks caught, 0 failed`);
process.exit(fails.length ? 1 : 0);
