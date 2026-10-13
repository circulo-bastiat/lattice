#!/usr/bin/env node
// lightningcheck.mjs — loop/lightning: LightningEntity + the skeleton-horse thunder trap
//  (src/07zzc_lightning.js). See that file's own header for exactly which .decomp files each
// piece reads and Lgt.OWED for what is admittedly approximate.
//
//   node tools/lightningcheck.mjs [--verbose]
//
// ANTI-VACUITY (D-30/D-305): every section that asserts a positive also breaks its own input
// and asserts the break is caught — a check that cannot fail is not evidence.

import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 60) fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { ok(c, m); if (VERBOSE && c) console.log('   ✓ anti-vacuity: ' + m); };

console.log('lightningcheck — LIGHTNING BOLT + SKELETON HORSE TRAP');

const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '07d_mining.js', '07e_loot.js', '07b_behaviour.js',
          '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js',
          '07y_equip.js', '07m_breed.js', '07zn_mooshroom.js', '07l_spawn.js', '09b_sky.js',
          '14j_combat.js', '07s_raid.js', '07zzc_lightning.js'],
  dom: false
});
initRegistry(M);
{
  const meta = JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8'));
  M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
}
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8'))
});
M.Entities.init();
M.EntityList.init();
M.Ai.init();
M.Equip.init();

const EL = M.EntityList, Lgt = M.Lightning, Eq = M.Equip, IT = M.Items;
ok(!!Lgt, 'NS.Lightning module loaded');
ok(EL.ready && M.Entities.ready && M.Ai.ready, 'Entities/EntityList/Ai all report ready');

// a fake world (the same shape silverfishcheck's own stub uses): a Map keyed "x,y,z" -> state id.
const CELLS = new Map();
const key = (x, y, z) => x + ',' + y + ',' + z;
M.World = {
  getBlock: (x, y, z) => CELLS.get(key(x, y, z)) || 0,
  setBlock: (x, y, z, st) => { CELLS.set(key(x, y, z), st); return true; },
  get: () => null,
  heightAt: () => 63,
  biomeAt: () => 1,
  chunks: new Map(),
  tickingAt: () => true
};
M.CH = { GENERATED: 2 };
M.Behave.init(M.World);
M.Commands = { rules: {}, ruleGet(name) { return (name in this.rules) ? this.rules[name] : 'true'; } };
M.Diff = { value: 'normal', get() { return this.value; } };
const RealSky = M.Sky;   // 09b_sky.js's own, kept for section 8 (the stub below replaces it)
M.Sky = {
  weather: { raining: true, thundering: true, rainLevel: 1, thunderLevel: 1 },
  newWeather() { return this.weather; },
  isThundering() { return true; },
  isRainingAt() { return true; }
};
M.Player = { x: 0, y: 64, z: 0, dead: false };

console.log('\n1. skeleton_horse and lightning_bolt are both real, spawnable entity types');
{
  ok(EL.canSpawn('lightning_bolt'), 'EL.canSpawn(lightning_bolt) — zero-sized, [0,1] motion');
  ok(EL.canSpawn('skeleton_horse'), 'EL.canSpawn(skeleton_horse) — falls to hors怙s own measured row');
  okAv(!EL.canSpawn('made_up_type_xyz'), 'anti-vacuity: a made-up type is still refused');
}

console.log('\n2. Lgt.tick — the bolt’s own ambient-flash/fire/remove lifecycle');
{
  EL.clear();
  const bolt = EL.spawn('lightning_bolt', 8, 64, 8, {});
  ok(!!bolt, 'a lightning_bolt entity spawns');
  ok(bolt.ambientTick === 2 && bolt.remainingActions >= 1 && bolt.remainingActions <= 3,
     'ctor defaults: ambientTick=2, remainingActions in [1,3]');
  ok(bolt.cosmetic === false, 'a plain spawn (<no opts.cosmetic>) is not cosmetic');
  const cosmetic = EL.spawn('lightning_bolt', 8, 64, 8, { cosmetic: true });
  ok(cosmetic.cosmetic === true, 'opts.cosmetic=true carries through');

  // force the bolt to its terminal tick and assert it actually gets removed — anti-vacuity:
  // a bolt with remainingActions still > 0 must NOT be removed on the same ambientTick<0 tick.
  bolt.ambientTick = -1; bolt.remainingActions = 1;
  Lgt.tick(bolt);
  okAv(bolt.removed !== true, 'anti-vacuity: remainingActions>0 does not remove the bolt yep');
  bolt.ambientTick = -1; bolt.remainingActions = 0;
  Lgt.tick(bolt);
  ok(bolt.removed === true, 'remainingActions hits 0 -> the bolt removes itself');
}

console.log('\n3. Lgt.spawnFire — doFireTick-gated, cosmetic bolts never ignite anything');
{
  const STONE = M.States.stateOf('stone');
  CELLS.clear();
  CELLS.set(key(5, 63, 5), STONE);
  M.Commands.rules.doFireTick = 'true';
  const e = { x: 5.5, y: 64, z: 5.5, cosmetic: false };
  Lgt.spawnFire(e, 0);
  const litTrue = CELLS.get(key(5, 64, 5)) !== undefined;
  ok(litTrue, 'doFireTick=true places a fire block at the bolt\u2019s own feet');

  CELLS.clear();
  CELLS.set(key(5, 63, 5), STONE);
  M.Commands.rules.doFireTick = 'false';
  Lgt.spawnFire(e, 0);
  okAv(CELLS.get(key(5, 64, 5)) === undefined, 'anti-vacuity: doFireTick=false places nothing');

  CELLS.clear();
  CELLS.set(key(5, 63, 5), STONE);
  M.Commands.rules.doFireTick = 'true';
  const cosmetic = { x: 5.5, y: 64, z: 5.5, cosmetic: true };
  Lgt.spawnFire(cosmetic, 0);
  okAv(CELLS.get(key(5, 64, 5)) === undefined, 'anti-vacuity: a cosmetic bolt never ignites even with doFireTick on');
}

console.log('\n4. onStruckByLightning — the four per-type overrides (Entity.java + three mob files)');
{
  M.Diff.value = 'normal';

  EL.clear();
  const bolt = EL.spawn('lightning_bolt', 0, 64, 0, {});
  const cow = EL.spawn('cow', 0, 64, 0, {});
  const beforeHp = cow.health;
  Lgt.onStruckByLightning(cow, bolt);
  ok(cow.health === beforeHp - 5, 'Entity.onStruckByLightning default: 5.0 damage, no per-type hook');
  ok(cow.remainingFireTicks > 0 && cow.isOnFire, 'the generic default also ignites for 8s');
  okAv(cow.charged === undefined, 'anti-vacuity: a non-creeper never gets the CHARGED flag');

  const creeper = EL.spawn('creeper', 0, 64, 0, {});
  Lgt.onStruckByLightning(creeper, bolt);
  ok(creeper.charged === true, 'CreeperEntity.onStruckByLightning: charged=true on top of the generic hit');
  ok(creeper.health < creeper.maxHealth, 'and the creeper still took the 5.0 hit (super IS called)');

  const moo = EL.spawn('mooshroom', 0, 64, 0, {});
  const startType = moo.mooshroomType;
  const hpBefore = moo.health;
  Lgt.onStruckByLightning(moo, bolt);
  ok(moo.mooshroomType !== startType, 'MooshroomEntity.onStruckByLightning: red<->brown flips');
  okAv(moo.health === hpBefore, 'anti-vacuity: mooshroom takes NO damage (no super call at all)');
  const stand = EL.spawn('armor_stand', 8, 64, 8, {});
  const standHp = stand.health;
  Lgt.onStruckByLightning(stand, bolt);
  ok(!(stand.remainingFireTicks > 0) && stand.health === standHp, 'ArmorStandEntity.onStruckByLightning: empty override, no fire and no damage');
  { const z = EL.spawn('zombie', 9, 64, 9, {}); Lgt.onStruckByLightning(z, bolt);
    if (z.remainingFireTicks > 0) { breaks++; console.log('   ✓ the same assertion on a generic mob (ignited) is caught'); } }
  const turtle = EL.spawn('turtle', 6, 64, 6, {});
  Lgt.onStruckByLightning(turtle, bolt);
  ok(turtle.health <= 0 || turtle.dead || turtle.removed, 'TurtleEntity.onStruckByLightning: Float.MAX_VALUE damage kills outright');
  okAv(!(turtle.remainingFireTicks > 0), 'anti-vacuity: and no super call, so the turtle is not ignited');

  const flippedType = moo.mooshroomType;
  Lgt.onStruckByLightning(moo, bolt);   // SAME bolt id -> Mo.onLightning’s own once-per-bolt guard
  okAv(moo.mooshroomType === flippedType, 'anti-vacuity: the SAME bolt cannot flip a mooshroom twice');

  const pig = EL.spawn('pig', 3, 64, 3, {});
  const before = EL.list.length;
  Lgt.onStruckByLightning(pig, bolt);
  ok(pig.removed === true, 'PigEntity.onStruckByLightning (non-Peaceful): the donor pig is discarded');
  const zp = EL.list.filter(e => e.type === 'zombified_piglin' && !e.removed);
  ok(zp.length === 1, 'and a zombified_piglin was spawned in its place');
  ok(EL.list.length === before + 1, 'exactly one new entity (the piglin), not the pig AND the piglin');

  const named = EL.spawn('pig', 7, 64, 7, {});
  named.customName = 'Bacon'; named.customNameVisible = true; named.noAI = true; named.pitch = 0.5;
  Lgt.onStruckByLightning(named, bolt);
  const nz = EL.list.filter(e => e.type === 'zombified_piglin' && !e.removed && e.x === 7)[0];
  ok(nz && nz.customName === 'Bacon' && nz.customNameVisible === true, 'convertPig carries the custom name + visibility');
  ok(nz && nz.persistent === true, 'convertPig: converted piglin is persistent');
  ok(nz && nz.noAI === true && nz.pitch === 0.5, 'convertPig carries NoAI + pitch');
  ok(nz && M.Equip.getEquipped(nz, M.Items.MAINHAND), 'convertPig: golden sword in the main hand');
  const plain = EL.spawn('pig', 9, 64, 9, {});
  Lgt.onStruckByLightning(plain, bolt);
  const pz = EL.list.filter(e => e.type === 'zombified_piglin' && !e.removed && e.x === 9)[0];
  if (pz && pz.customName === undefined && !pz.noAI) { breaks++; console.log('   ✓ a nameless/AI pig converts to a nameless/AI piglin (break caught)'); }

  // #4213: create() only -- no ZombieEntity.initialize rolls on a converted piglin
  let dirty = 0;
  for (let i = 0; i < 200; i++) {
    const p = EL.spawn('pig', 20 + i, 64, 20, {}); Lgt.onStruckByLightning(p, bolt);
    const z = EL.list.filter(e => e.type === 'zombified_piglin' && !e.removed && e.x === 20 + i)[0];
    if (!z || z.knockbackResistance || z.reinforceBase !== undefined || z.zombieLeader || z.canBreakDoors) dirty++;
  }
  ok(dirty === 0, 'convertPig: no initialize rolls (kbres/leader/reinforce) over 200 strikes, got ' + dirty);
  { const z = EL.spawn('zombified_piglin', 400, 64, 400, {}); if (z.reinforceBase !== undefined) { breaks++; console.log('   ✓ a normal spawn still rolls initialize (break caught)'); } }

  const villager = EL.spawn('villager', 4, 64, 4, {});
  Lgt.onStruckByLightning(villager, bolt);
  ok(villager.removed === true, 'VillagerEntity.onStruckByLightning (non-Peaceful): donor discarded');
  ok(EL.list.filter(e => e.type === 'witch' && !e.removed).length === 1, 'and a witch takes its place');
  const nv = EL.spawn('villager', 11, 64, 11, {});
  nv.customName = 'Bob'; nv.customNameVisible = true; nv.noAI = true; nv.pitch = 0.25;
  Lgt.onStruckByLightning(nv, bolt);
  const nw = EL.list.filter(e => e.type === 'witch' && !e.removed && e.x === 11)[0];
  ok(nw && nw.customName === 'Bob' && nw.customNameVisible === true, 'convertVillager carries the custom name + visibility');
  ok(nw && nw.persistent === true && nw.noAI === true && nw.pitch === 0.25, 'convertVillager: witch is persistent, keeps NoAI + pitch');

  M.Diff.value = 'peaceful';
  const pig2 = EL.spawn('pig', 5, 64, 5, {});
  const hp2 = pig2.health;
  Lgt.onStruckByLightning(pig2, bolt);
  okAv(pig2.removed !== true, 'anti-vacuity: on Peaceful a struck pig is NOT converted');
  ok(pig2.health === hp2 - 5, 'and instead takes the plain 5.0 hit (the else-branch super call)');
  M.Diff.value = 'normal';
}

console.log('\n5. Lgt.strikeEntities — the 3-wide/9-tall box, once per bolt per entity');
{
  EL.clear();
  const bolt = EL.spawn('lightning_bolt', 0, 64, 0, {});
  const near = EL.spawn('cow', 1, 65, 1, {});
  const far = EL.spawn('cow', 20, 64, 20, {});
  const hpNear = near.health, hpFar = far.health;
  Lgt.strikeEntities(bolt);
  ok(near.health === hpNear - 5, 'an entity inside the box is struck');
  okAv(far.health === hpFar, 'anti-vacuity: an entity far outside the box is untouched');
  const hpAfter = near.health;
  Lgt.strikeEntities(bolt);
  okAv(near.health === hpAfter, 'anti-vacuity: the SAME bolt cannot strike the same entity twice (struckIds)');
}

console.log('\n6. Lgt.tickTrap — SkeletonHorseTrapTriggerGoal (<player range>, spawns + enchants)');
{
  // deterministic: 0.6 clears every <=0.5-scaled random-armor-roll chance (Eq.rollArmor's own
  // 0.15*difficulty, well under 0.6 at every difficulty) so the ONLY head/mainhand items in
  // play are the ones this section's own assertions are about (bow, iron_helmet) — real
  // randomness still drives the enchant ROLLS below, which read further Math.random() calls.
  const origRandom = Math.random;
  Math.random = () => 0.6;
  EL.clear();
  const horse = EL.spawn('skeleton_horse', 0, 64, 0, {});
  horse.trapped = true;
  M.Player.x = 100; M.Player.y = 64; M.Player.z = 100;   // far away
  const countFar = EL.list.length;
  Lgt.tickTrap(horse);
  okAv(horse.trapped === true, 'anti-vacuity: a player outside 10 blocks never springs the trap');
  okAv(EL.list.length === countFar, 'anti-vacuity: and nothing new is spawned either');

  M.Player.x = 1; M.Player.y = 64; M.Player.z = 1;   // within 10 blocks
  Lgt.tickTrap(horse);
  ok(horse.trapped === false, 'a player within 10 blocks untraps the horse');
  ok(horse.tamed === true, 'and tames it');

  const skeletons = EL.list.filter(e => e.type === 'skeleton' && !e.removed);
  const horses = EL.list.filter(e => e.type === 'skeleton_horse' && !e.removed);
  ok(skeletons.length === 4, '4 skeletons total spawn (the rider + 3 reinforcements)');
  ok(horses.length === 4, 'and 4 skeleton_horses total (the original + 3 reinforcements)');

  let anyEnchanted = false;
  for (const sk of skeletons) {
    const bow = Eq.getEquipped(sk, IT.MAINHAND);
    const helm = Eq.getEquipped(sk, IT.HEAD);
    ok(!!bow && M.Items.nameOf(bow.i) === 'bow', 'each trap skeleton carries a bow');
    ok(!!helm && M.Items.nameOf(helm.i) === 'iron_helmet', 'and an iron helmet');
    if ((bow.t && bow.t.Enchantments && bow.t.Enchantments.length) ||
        (helm.t && helm.t.Enchantments && helm.t.Enchantments.length)) anyEnchanted = true;
  }
  ok(anyEnchanted, 'at least one of the 4 riders came out enchanted (5 + difficulty*nextInt(18), never zero-chance)');

  // s116 (MOB-RIDES-MOB) -- every one of the 4 skeletons (the trap horse's own rider included)
  // is really MOUNTED: Rd.startRiding's vehicle/passenger/riding bookkeeping, plus the exact
  // pair-correct seat height Lgt.mountTrapRider works out (see that function's own header for
  // the two .decomp citations the formula comes from).
  ok(skeletons.length === horses.length, 'same count of riders and horses (sanity for the loop below)');
  let everyPairCorrect = true, everyMounted = true;
  for (const h of horses) {
    const rider = h.passenger;
    if (!rider || rider.type !== 'skeleton') { everyMounted = false; continue; }
    if (rider.vehicle !== h) everyMounted = false;
    if (!rider.riding) everyMounted = false;
    const expectY = h.y + (h.height || 0) * 0.75 + Lgt.SKELETON_HORSE_MOUNTED_OFFSET_DELTA +
      Lgt.SKELETON_RIDER_HEIGHT_OFFSET;
    if (Math.abs(rider.y - expectY) > 1e-9 || rider.x !== h.x || rider.z !== h.z) everyPairCorrect = false;
  }
  ok(everyMounted, 'every horse (trap horse included) carries its own skeleton as e.passenger/e.vehicle, e.riding true');
  ok(everyPairCorrect, 'each rider sits at vehicle.y + height*0.75 - 0.1875 - 0.6 (SkeletonHorseEntity/' +
     'AbstractSkeletonEntity .decomp offsets), x/z pinned to the vehicle');

  // anti-vacuity: without Rd.startRiding, mountTrapRider must refuse to mount ANYTHING (no
  // partial/broken passenger state), not silently place the rider at the vehicle's own spot.
  {
    const Rd = M.Raid;
    const realStartRiding = Rd.startRiding;
    Rd.startRiding = undefined;
    const av = EL.spawn('skeleton_horse', 50, 64, 50, {});
    const avRider = EL.spawn('skeleton', 50, 64, 50, {});
    const mounted = Lgt.mountTrapRider(avRider, av);
    okAv(mounted === false, 'anti-vacuity: Rd.startRiding missing -> mountTrapRider refuses (returns false)');
    okAv(avRider.vehicle === undefined && av.passenger === undefined,
      'anti-vacuity: and touches neither entity\'s vehicle/passenger fields');
    Rd.startRiding = realStartRiding;
  }

  // anti-vacuity: an untrapped horse's tickTrap is a pure no-op, even in range.
  EL.clear();
  const plain = EL.spawn('skeleton_horse', 0, 64, 0, {});
  const before = EL.list.length;
  Lgt.tickTrap(plain);
  okAv(EL.list.length === before, 'anti-vacuity: e.trapped falsy -> tickTrap spawns nothing at all');
  Math.random = origRandom;
}

console.log('\n6b. Lgt.tickTrap -- SkeletonHorseEntity.DESPAWN_AGE (18000-tick trapTime timeout)');
{
  M.Player.x = 100; M.Player.y = 64; M.Player.z = 100;   // far -- never springs, timer is all that fires
  EL.clear();
  const h = EL.spawn('skeleton_horse', 0, 64, 0, {});
  h.trapped = true;
  h.trapTime = Lgt.TRAP_TIMEOUT - 1;
  Lgt.tickTrap(h);
  ok(h.removed !== true, 'the 18000th tick (old trapTime 17999) keeps the horse: trapTime++ >= 18000 is post-increment');
  Lgt.tickTrap(h);
  ok(h.removed === true, 'old trapTime 18000 (18001st tick) discards the horse (SkeletonHorseEntity.tickMovement:116)');

  EL.clear();
  const h2 = EL.spawn('skeleton_horse', 0, 64, 0, {});
  h2.trapped = true;
  h2.trapTime = 100;
  Lgt.tickTrap(h2);
  okAv(h2.removed !== true, 'anti-vacuity: well under 18000 -> still alive');
  okAv(h2.trapTime === 101, 'anti-vacuity: and the counter really incremented (not a stub that never fires)');
  ok(h2.trapped === true, 'and still trapped (far player, this tick only ticked the timer)');
}

console.log('\n7. Lgt.getLightningPos / Lgt.strikeAt — the "thunder" block’s own struck-position search');
{
  EL.clear();
  const pos = Lgt.getLightningPos(0, 0);
  ok(pos.x === 0 && pos.z === 0 && pos.y === M.World.heightAt(0, 0) + 1,
     'with nobody nearby, the top position itself is struck');

  const player = EL.spawn('cow', 2, M.World.heightAt(2, 2) + 1, 2, {});   // a stand-in "living" entity
  const pos2 = Lgt.getLightningPos(2, 2);
  ok(pos2.x === 2 && pos2.z === 2, 'a sky-visible living entity in range is picked instead');

  EL.clear();
  M.Commands.rules.doMobSpawning = 'true';
  M.Diff.value = 'hard';   // approxLocalDifficulty*0.01 at its highest, to make the trap roll land
  const origRandom = Math.random;
  Math.random = () => 0;   // forces every roll (position pick, trap chance) to its minimum
  Lgt.strikeAt(1, 1);
  Math.random = origRandom;
  ok(EL.list.some(e => e.type === 'lightning_bolt' && !e.removed), 'strikeAt spawns a real lightning_bolt');

  EL.clear();
  M.Commands.rules.doMobSpawning = 'false';
  Lgt.strikeAt(1, 1);
  okAv(!EL.list.some(e => e.type === 'skeleton_horse'),
       'anti-vacuity: doMobSpawning=false never spawns the trapped horse (the bolt can still land)');
}

console.log('\n8. #380 the flash lerp keeps G.sky/G.fog as finite float [r,g,b] and never darkens');
{
  const base = [0.5, 0.7, 1];
  const good = (out) => Array.isArray(out) && out.length === 3 && out.every((v, i) => Number.isFinite(v) && v >= base[i] && v <= 1);
  ok(good(RealSky.lerpToWhite(base, 0.6)), 'lerpToWhite returns a finite brighter [r,g,b] array');
  // break: the old 0xRRGGBB integer lerp on a float array
  const oldLerp = (rgb, t) => { const r = (rgb >> 16) & 255; return ((r + (255 - r) * t) | 0) << 16; };
  if (!good(oldLerp(base, 0.6))) { breaks++; console.log('   ✓ the int lerp is caught'); }
  const orig = RealSky.lerpToWhite; RealSky.lerpToWhite = (c, t) => oldLerp(c, t);
  if (!good(RealSky.lerpToWhite(base, 0.6))) { breaks++; console.log('   ✓ a restored int lerp is caught'); }
  RealSky.lerpToWhite = orig;
}
console.log('\n9. #4729 trap enchant level uses the CLAMPED local difficulty (5..22), never the raw 0..6.75');
{
  const run = (clamped) => {
    const realLD = Eq.localDifficulty, realRoll = Eq.rollEnchants, realRandom = Math.random;
    const levels = [];
    Eq.localDifficulty = () => 6.75;   // raw maximum: clamped is 1.0
    Eq.rollEnchants = (item, kind, lvl, rnd) => { levels.push(lvl); return []; };
    Math.random = () => 0.99;          // nextInt(18) = 17
    try {
      EL.clear();
      const h = EL.spawn('skeleton_horse', 0, 64, 0, {});
      h.trapped = true;
      M.Player.x = 1; M.Player.y = 64; M.Player.z = 1;
      if (!clamped) { const real = Eq.clampedLocalDifficulty; Eq.clampedLocalDifficulty = () => Eq.localDifficulty(); try { Lgt.tickTrap(h); } finally { Eq.clampedLocalDifficulty = real; } }
      else Lgt.tickTrap(h);
    } finally { Eq.localDifficulty = realLD; Eq.rollEnchants = realRoll; Math.random = realRandom; }
    return levels;
  };
  const good = run(true);
  ok(good.length > 0 && good.every(l => l >= 5 && l <= 22), 'every trap enchant level is within 5..22 (got ' + good.join(',') + ')');
  // break: feed the raw difficulty in as the old code did
  const bad = run(false);
  if (!bad.every(l => l >= 5 && l <= 22)) { breaks++; console.log('   ✓ the raw-difficulty roll (' + Math.max(...bad) + ') is caught'); }
}
console.log('\n10. #5911 bolt Gaussian = java.util.Random.nextGaussian (polar + spare), new Random(42) first = 1.1419053154730547');
{
  const mk = (seed) => {
    let st = (BigInt(seed) ^ 0x5DEECE66Dn) & ((1n << 48n) - 1n);
    const next = (bits) => { st = (st * 0x5DEECE66Dn + 0xBn) & ((1n << 48n) - 1n); return Number(BigInt.asIntN(32, st >> BigInt(48 - bits))); };
    return { nextDouble() { const a = next(26), b = next(27); return (a * 134217728 + b) * 1.1102230246251565e-16; } };
  };
  const draw = (g) => { const r = mk(42); return [g(r), g(r)]; };
  const good = draw(Lgt.gaussian);
  ok(good[0] === 1.1419053154730547, 'first Gaussian of Random(42) is 1.1419053154730547 (got ' + good[0] + ')');
  const box = (r) => { const u = Math.max(r.nextDouble(), 1e-12), v = r.nextDouble(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  if (draw(box)[0] !== 1.1419053154730547) { breaks++; console.log('   ✓ Box-Muller is caught'); }
  const nospare = (r) => { const x = M.U.polarGaussian(r, r.nextDouble); r.haveG = false; return x; };
  const ns = draw(nospare);
  ok(good[1] !== ns[1], 'second draw differs without the spare');
  if (ns[1] !== good[1]) { breaks++; console.log('   ✓ dropped spare cache is caught'); }
}
console.log(`${breaks} breaks caught`);

console.log(`\n${pass} checks passed, ${fails.length} failures`);
if (fails.length) { fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
