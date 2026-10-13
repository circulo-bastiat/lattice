#!/usr/bin/env node
// despawncheck — loop/despawn-s105 (QUEUE 0.2 G18c, Spawn.OWED's despawn line).
// `MobEntity.checkDespawn` (.decomp MobEntity.java:655-679) as `Spawn.despawnTick` now runs it:
// the >600 idle gate on the 1/800 roll, the despawnCounter's own +1/+2/reset bookkeeping, every
// `canImmediatelyDespawn` override, and the damage reset (LivingEntity.java:1039).
// The per-type table (`Spawn.DESPAWN_TYPES`) is RE-DERIVED here from .decomp every run — the
// check owns none of it (rule 3). Headless, node-only.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ break caught: ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => console.log(...a);
say('despawncheck — G18c, MobEntity.checkDespawn + despawnCounter (loop/despawn-s105)');

const M = loadEngine({ extra: ['02f_tags.js', '07_world.js', '08_lighting.js', '07b_behaviour.js',
  '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js',
  '07c_blockentity.js', '09b_sky.js', '14j_combat.js', '07w_passive.js', '14c_raycast.js', '07zf_bat.js', '07zi_squid.js'], dom: false });
initRegistry(M);
M.EntityList.wr = () => Math.random();   // #6215: despawn/spawn rolls draw from the world stream EL.wr; this check scripts them by stubbing Math.random
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init();
M.World.init(3); M.Gen.init(3, M.Gen.defaults()); M.Light.init(); M.Behave.init(M.World);
M.EntityList.init(); M.Ai.init();
if (M.Passive && M.Passive.init) M.Passive.init();
if (M.Bat && M.Bat.init) M.Bat.init();
M.Spawn.init(); M.Spawn.ready = false;   // D-397: no natural spawning while this check counts
const S = M.Spawn, EL = M.EntityList;
M.Player = { x: 0, y: 64, z: 0 };

// ── 1. the table, re-derived from .decomp ──────────────────────────────────────────────────
say('1. Spawn.DESPAWN_TYPES == .decomp (SpawnGroup, canImmediatelyDespawn override, updateDespawnCounter override)');
function derive() {
  const D = join(MCLITE_ROOT, '.decomp', 'net', 'minecraft', 'entity');
  const et = readFileSync(join(D, 'EntityType.java'), 'utf8');
  const sg = readFileSync(join(D, 'SpawnGroup.java'), 'utf8');
  const g = {}; for (const m of sg.matchAll(/(field_\d+)\("(\w+)"/g)) g[m[1]] = m[2];
  const ext = {}, ov = {}, up = {};
  (function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f.endsWith('.java')) {
    const s = readFileSync(p, 'utf8'); const m = s.match(/class (\w+)(?:<[^{]*?>)? extends (\w+)/); if (m) ext[m[1]] = m[2];
    const c = f.slice(0, -5); if (/boolean canImmediatelyDespawn\(/.test(s) || (c === 'WitherEntity' && /void checkDespawn\(/.test(s))) ov[c] = 1; if (/void updateDespawnCounter\(/.test(s)) up[c] = 1; } } })(D);
  const KIND = { MobEntity: 'mob', AnimalEntity: 'animal', GolemEntity: 'never', WitherEntity: 'never', VillagerEntity: 'never', WanderingTraderEntity: 'never',
    CatEntity: 'cat', OcelotEntity: 'ocelot', ChickenEntity: 'chicken', FishEntity: 'fish', AxolotlEntity: 'fish',
    HoglinEntity: 'unpersisted', PiglinEntity: 'unpersisted', ZombieVillagerEntity: 'zvillager', RaiderEntity: 'raider' };
  const BUMP = { HostileEntity: 'light', RaiderEntity: 'always' };
  const out = {}, unmapped = [];
  for (const m of et.matchAll(/"([a-z_]+)",\s*EntityType\.Builder\.(?:<[^>]*>)?create\(\s*(\w+)::new,\s*SpawnGroup\.(field_\d+)/g)) {
    let c = m[2]; const chain = []; while (c && chain.length < 14) { chain.push(c); if (c === 'MobEntity') break; c = ext[c]; }
    if (!chain.includes('MobEntity')) continue;
    const o = chain.find(x => ov[x]); const u = chain.find(x => up[x]);
    if (!KIND[o]) unmapped.push(m[1] + ':' + o);
    out[m[1]] = [g[m[3]], KIND[o], u ? BUMP[u] : 0];
  }
  return { out, unmapped };
}
const same = (a, b) => { const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  if (ka.join() !== kb.join()) return false; return ka.every(k => JSON.stringify(a[k]) === JSON.stringify(b[k])); };
if (!existsSync(join(MCLITE_ROOT, '.decomp'))) { fails.push('.decomp/ missing — the referee this check reads (STATE §0)'); }
else {
  const { out, unmapped } = derive();
  ok(unmapped.length === 0, `every override class maps to a despawn kind (unmapped: ${unmapped.join(', ')})`);
  ok(Object.keys(out).length > 60, `derived ${Object.keys(out).length} MobEntity types`);
  ok(same(out, S.DESPAWN_TYPES), 'Spawn.DESPAWN_TYPES equals the .decomp derivation, type by type');
  const bad = JSON.parse(JSON.stringify(S.DESPAWN_TYPES)); bad.cow[1] = 'mob';
  okAv(!same(out, bad), 'flipping cow to the MobEntity default is caught by the comparison');
}

// ── helpers ────────────────────────────────────────────────────────────────────────────────
const realRandom = Math.random;
const realLight = M.World.getLight;
function put(type, x, extra) { const e = EL.spawn(type, x, 64, 0); Object.assign(e, extra || {}); return e; }
function tick(rand) { Math.random = () => rand; try { return S.despawnTick(); } finally { Math.random = realRandom; } }
M.World.getLight = () => 0;                          // pitch dark unless a test says otherwise

// ── 2. the >600 idle gate on the 1/800 roll ────────────────────────────────────────────────
say('2. the roll needs despawnCounter > 600 (MobEntity.java:670)');
EL.clear();
let z = put('zombie', 100, { despawnCounter: 0 });
tick(0);
ok(!z.removed, 'a zombie between the bands with despawnCounter 0 survives a winning roll (the idle gate)');
z.despawnCounter = 601; tick(0);
ok(z.removed, 'the same zombie with despawnCounter 601 and a winning roll despawns');
EL.clear(); z = put('zombie', 100, { despawnCounter: 601 }); tick(0.5);
ok(!z.removed, 'a losing roll (0.5 >= 1/800) keeps it');
EL.clear(); z = put('zombie', 100, { despawnCounter: 600 }); tick(0);
ok(!z.removed, 'exactly 600 is not > 600');
{ const real = S.DESPAWN_IDLE_TICKS; S.DESPAWN_IDLE_TICKS = -1;
  EL.clear(); const z2 = put('zombie', 100, { despawnCounter: 0 }); tick(0);
  S.DESPAWN_IDLE_TICKS = real;
  okAv(z2.removed, 'with the gate broken to -1, the counter-0 zombie DOES despawn — assertion 1 of §2 is not vacuous'); }

// ── 3. the counter's own bookkeeping ───────────────────────────────────────────────────────
say('3. despawnCounter: +1 tickNewAi, +2 bright HostileEntity, +2 always RaiderEntity, reset in 32 / persistent / riding');
EL.clear();
const zd = put('zombie', 50, { despawnCounter: 0 }), cw = put('cow', 50, { despawnCounter: 0 }),
      pl = put('pillager', 50, { despawnCounter: 0 }), sl = put('slime', 50, { despawnCounter: 0 });
tick(0.5);
ok(zd.despawnCounter === 1, `dark zombie +1 (got ${zd.despawnCounter})`);
ok(cw.despawnCounter === 1, `cow +1 (got ${cw.despawnCounter})`);
ok(pl.despawnCounter === 3, `pillager +3 even in the dark (RaiderEntity:112) (got ${pl.despawnCounter})`);
M.World.getLight = () => (15 << 4);                  // full sky light, no block light
const zd0 = zd.despawnCounter, sl0 = sl.despawnCounter;
tick(0.5);
ok(zd.despawnCounter === zd0 + 3, `bright zombie +3 (HostileEntity:43-48) (got +${zd.despawnCounter - zd0})`);
ok(sl.despawnCounter === sl0 + 1, `a slime is not a HostileEntity: +1 even in light (got +${sl.despawnCounter - sl0})`);
M.World.getLight = () => (11 << 4);
{ const a = zd.despawnCounter; tick(0.5);
  ok(zd.despawnCounter === a + 1, `light 11 -> brightness 0.379, not > 0.5: +1 only (got +${zd.despawnCounter - a})`); }
M.World.getLight = () => (12 << 4);
{ const a = zd.despawnCounter; tick(0.5);
  // float arithmetic: 0.8f / (4f - 3f*0.8f) = 0.50000006f > 0.5 -- the jar's own rounding
  ok(zd.despawnCounter === a + 3, `light 12 -> 0.50000006f in float, > 0.5: +3 (got +${zd.despawnCounter - a})`); }
M.World.getLight = () => 13;                          // block light 13
{ const a = zd.despawnCounter; tick(0.5);
  ok(zd.despawnCounter === a + 3, `block light 13 -> brightness 0.619: +3 (got +${zd.despawnCounter - a})`); }
M.World.getLight = () => 0;
EL.clear();
const nearZ = put('zombie', 20, { despawnCounter: 500 });
const persZ = put('zombie', 100, { despawnCounter: 500, persistent: true });
const rideZ = put('zombie', 100, { despawnCounter: 500 }); rideZ.vehicle = cw;
tick(0.5);
ok(nearZ.despawnCounter === 1, `inside 32 the counter resets then counts this tick (got ${nearZ.despawnCounter})`);
ok(persZ.despawnCounter === 1 && !persZ.removed, `persistent: reset, kept (got ${persZ.despawnCounter})`);
ok(rideZ.despawnCounter === 1 && !rideZ.removed, `riding (cannotDespawn = hasVehicle): reset, kept (got ${rideZ.despawnCounter})`);
EL.clear();
const carE = put('enderman', 100, { despawnCounter: 500, carriedBlock: 9 });
const emptyE = put('enderman', 100, { despawnCounter: 500, carriedBlock: null });
tick(0.5);
ok(carE.despawnCounter === 1 && !carE.removed, `enderman carrying a block (cannotDespawn): reset, kept (got ${carE.despawnCounter})`);
okAv(emptyE.despawnCounter === 501, `empty-handed enderman is NOT reset (${emptyE.despawnCounter})`);
EL.clear(); const midZ = put('zombie', 100, { despawnCounter: 500 }); tick(0.5);
okAv(midZ.despawnCounter === 501, `between the bands the counter is NOT reset (${midZ.despawnCounter}) — the reset above is the band's, not unconditional`);

// ── 4. canImmediatelyDespawn per override ──────────────────────────────────────────────────
say('4. canImmediatelyDespawn, every override');
EL.clear();
const far = (t, ex) => put(t, 130, ex);
const cases = [
  ['zombie', {}, true], ['cow', {}, false], ['bat', {}, true], ['squid', {}, true],
  ['cat', { age: 3000 }, true], ['cat', { age: 3000, tamed: true }, false], ['cat', { age: 100 }, false],
  ['ocelot', { age: 3000 }, true], ['ocelot', { age: 100 }, false],
  ['chicken', {}, false], ['cod', {}, true], ['cod', { fromBucket: true }, false], ['cod', { customName: 'x' }, false],
  ['axolotl', {}, true], ['axolotl', { fromBucket: true }, false],
  ['zombie_villager', {}, true], ['zombie_villager', { converting: true }, false], ['zombie_villager', { tradeXp: 5 }, false],
  ['pillager', {}, true], ['pillager', { raidId: 1 }, false], ['pillager', { patrolling: true }, true],
  ['iron_golem', {}, false], ['villager', {}, false], ['wandering_trader', {}, false], ['horse', {}, false]
];
const got = cases.map(([t, ex]) => { try { return far(t, Object.assign({ despawnCounter: 0 }, ex)); } catch (err) { return null; } });
tick(0.5);
cases.forEach(([t, ex, want], i) => {
  const e = got[i];
  if (!e) { ok(S.canImmediatelyDespawn(Object.assign({ type: t, age: 0 }, ex), 16900) === want, `${t} ${JSON.stringify(ex)} canImmediatelyDespawn -> ${want} (not spawnable here, asked directly)`); return; }
  ok(e.removed === want, `${t} ${JSON.stringify(ex)} at 130 blocks: ${want ? 'despawns' : 'kept'} (removed=${e.removed})`);
});
ok(S.canImmediatelyDespawn({ type: 'pillager', patrolling: true }, 16384) === false, 'patrolling pillager at exactly 128^2 is kept (PatrolEntity:100, > 16384)');
ok(S.canImmediatelyDespawn({ type: 'pillager', patrolling: true }, 16385) === true, '...and just past it may despawn');
{ const real = S.canImmediatelyDespawn; S.canImmediatelyDespawn = () => true;
  EL.clear(); const c2 = far('cow', {}); tick(0.5); S.canImmediatelyDespawn = real;
  okAv(c2.removed, 'with canImmediatelyDespawn broken to always-true, the far cow IS removed — the cow row above is not vacuous'); }

// ── 4b. wither never despawns (WitherEntity.checkDespawn:485) ──────────────────────────────
say('4b. wither survives despawnTick far away and with a huge counter');
EL.clear();
{ const w = put('wither', 200, { despawnCounter: 10000 }); tick(0); ok(!w.removed, 'wither at 200 blocks, counter 10000, roll 0 survives');
  ok(w.despawnCounter === 0 || w.despawnCounter === 1, `counter reset (got ${w.despawnCounter})`);
  const w2 = put('wither', 40, { despawnCounter: 10000 }); tick(0); ok(!w2.removed, 'wither at 40 blocks, counter 10000, roll 0 survives');
  const z = put('zombie', 200); tick(0); okAv(z.removed, 'a zombie at 200 blocks IS removed — the wither rows are not vacuous'); }
EL.clear();

// ── 5. damage resets the counter ───────────────────────────────────────────────────────────
say('5. LivingEntity.damage zeroes despawnCounter (LivingEntity.java:1039)');
EL.clear();
const hz = put('zombie', 10, { despawnCounter: 700 });
M.Combat.hurt(hz, 1, 0, true);
ok(hz.despawnCounter === 0, `a hit zeroes it (got ${hz.despawnCounter})`);
hz.despawnCounter = 700; M.Combat.hurt(hz, 1, 1, true);
ok(hz.despawnCounter === 0, `even a hit swallowed by the invulnerability window zeroes it (got ${hz.despawnCounter})`);

// ── 6. the two readers of the counter ──────────────────────────────────────────────────────
say('6. WanderAroundGoal (>= 100 refuses, WanderAroundGoal.java:42) and SquidEntity.SwimGoal (> 100 stops, :299)');
{
  const e = { x: 0, y: 64, z: 0, despawnCounter: 100 };
  const g = new M.Ai.WaterAvoidingRandomStrollGoal(e, 1, () => 0);
  ok(g.canUse() === false, 'stroll: despawnCounter 100 refuses even a winning chance roll');
  e.despawnCounter = 99;
  okAv(g.canUse() === true, 'stroll: despawnCounter 99 with the same roll starts — the refusal above is the counter\'s');
  const Sq = M.Squid || M.Sq;
  if (ok(!!(Sq && Sq.swimGoalTick), 'the squid module is loaded (07zi_squid.js)')) {
    const q = { type: 'squid', x: 0, y: 40, z: 0, inWater: true, swimX: 0.1, swimY: 0, swimZ: 0.1, despawnCounter: 101 };
    Sq.swimGoalTick(q);
    ok(q.swimX === 0 && q.swimY === 0 && q.swimZ === 0, 'squid: despawnCounter 101 zeroes the swimming vector');
    const q2 = { type: 'squid', x: 0, y: 40, z: 0, inWater: false, swimX: 0, swimY: 0, swimZ: 0, despawnCounter: 100 };
    Sq.swimGoalTick(q2);
    okAv(q2.swimX !== 0 || q2.swimZ !== 0, 'squid: at exactly 100 (not > 100) a vectorless squid gets a fresh vector');
  }
}

// ── 7. the cap count (SpawnHelper.setupSpawn :65-83) ───────────────────────────────────────
say('7. Spawn.liveCount skips persistent/riding mobs and counts by the type\'s own SpawnGroup');
EL.clear();
{ const a = put('zombie', 50), b = put('zombie', 50, { persistent: true }), c = put('zombie', 50); c.vehicle = a;
  ok(S.liveCount('monster') === 1, `3 zombies, one persistent, one riding -> monster count 1 (got ${S.liveCount('monster')})`);
  b.persistent = false;
  okAv(S.liveCount('monster') === 2, `un-persisting one -> 2: the skip is the flag's (got ${S.liveCount('monster')})`); }
EL.clear();

M.World.getLight = realLight;
say('');
say('================= despawncheck =================');
say(` assertions passed .. ${pass}`);
say(` failures ........... ${fails.length}`);
say(` breaks caught ...... ${breaks}`);
say('===============================================');
for (const f of fails) say('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
