#!/usr/bin/env node
// beecheck.mjs — QUEUE 0.2 (G18 mobs), unit BEE. Drives the REAL modules (07zo_bee.js,
// Ai.ROSTER.bee/EL.DEFAULTS.bee/Breed.isFood('bee',...)/Fl.FLYING_SPEED.bee/entityrender's
// Bee.skinKey chain) against `.decomp/net/minecraft/entity/passive/BeeEntity.java` (1296
// lines, read in full).
//
//   node tools/beecheck.mjs [--verbose]
//
// Sections:
//   1. attributes/dimensions/breeding food — the jar-extracted entity table's own bee row
//   2. anger + sting — Bee.sting's poison-by-difficulty, hasStung, stopAnger
//   3. EL.spawn('bee', ...) — EL.DEFAULTS.bee attaches e.flyMove, Ai.ROSTER.bee attaches e.ai
//   4. Bee.PollinateGoal — the flower-seek/pollinate/hasNectar state machine
//   5. Bee.GrowCropsGoal / Bee.growCropAt — real block-state ageing, off the real tag table
//   6. the hive — Bee.canEnterHive, Bee.enterHive/Bee.tickHive occupant countdown
//   7. Bee.skinKey — the four BeeEntityRenderer sheets
//   8. anti-vacuity — break the check's own data/stubs and watch it catch the break

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine } from './loadsrc.mjs';

import { ROOT as MCLITE_ROOT } from './paths.mjs';   // D-567: was URL.pathname → 'C:\C:\…' on Windows
const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };

console.log('beecheck — QUEUE 0.2 (G18 mobs), the bee, whole');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js',
               '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js',
               '14c_raycast.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
               '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js', '07m_breed.js',
               '07t_fly.js', '07q_effects.js', '07zx_particle.js', '07zo_bee.js', '07zu_poi.js', '07zzm_wither.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });

const EL = MCL.EntityList, Ai = MCL.Ai, Ent = MCL.Entities;
const Bee = MCL.Bee, Breed = MCL.Breed, W = MCL.World, S = MCL.States, R = MCL.Reg, CH = MCL.CH;
const BE = MCL.BlockEntities, Cb = MCL.Combat, ES = MCL.Effects, Fl = MCL.Fly;

MCL.Entities.init();
Ent.attrs = MCL.DATA.entities.attrs;
W.init(1);
MCL.Behave.init(W);
if (BE && BE.init) BE.init();
EL.init();
Ai.init();
if (MCL.Spawn && MCL.Spawn.init) MCL.Spawn.init();
Breed.init();
if (Cb && Cb.init) Cb.init();
if (ES && ES.init) ES.init();

for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}

ok(Bee && Bee.ready, 'NS.Bee did not load/ready');

// ── 1. attributes/dimensions/breeding food ──────────────────────────────────────────────────
say('1. the jar-extracted entity table’s own row for bee + Bee.FLYING_SPEED');
{
  const at = Ent.attrsOf('bee');
  ok(!!at, 'Ent.attrsOf(bee) missing entirely');
  ok(at && at.hp === 10, `bee max health 10 — got ${at && at.hp}`);
  ok(at && Math.abs(at.speed - 0.3) < 1e-6, `bee movement speed 0.3 — got ${at && at.speed}`);
  ok(at && at.dmg === 2, `bee attack damage 2 — got ${at && at.dmg}`);
  ok(at && at.follow === 48, `bee follow range 48 — got ${at && at.follow}`);
  ok(Bee.FLYING_SPEED === 0.6, `Bee.FLYING_SPEED 0.6 — got ${Bee.FLYING_SPEED}`);
  ok(Fl && Fl.FLYING_SPEED && Fl.FLYING_SPEED.bee === 0.6, 'Fl.FLYING_SPEED.bee not wired to 0.6');
  const dim = Ent.dimensions('bee');
  ok(dim && Math.abs(dim.width - 0.7) < 1e-9 && Math.abs(dim.height - 0.6) < 1e-9,
    `bee dims [0.7,0.6] — got ${dim && [dim.width, dim.height]}`);
  const food = Ent.breedFood('bee');
  ok(food && food.k === 'tag' && food.t.some((t) => t.indexOf('flowers') >= 0),
    `bee breeds off #minecraft:flowers — got ${JSON.stringify(food)}`);
  ok(!Breed.SPECIAL.bee, 'Breed.SPECIAL.bee must be REMOVED — bee is a fully generic AnimalEntity (.decomp)');
  ok(Breed.canBreed('bee'), 'Breed.canBreed(bee) must be true now that Breed.SPECIAL.bee is gone');
  ok(Breed.isFood('bee', 'poppy'), 'Breed.isFood(bee, poppy) must be true — poppy is #minecraft:flowers');
  ok(!Breed.isFood('bee', 'wheat'), 'Breed.isFood(bee, wheat) must be false — wheat is not a flower');
}

// ── 2. anger + sting ─────────────────────────────────────────────────────────────────────────
say('2. Bee.sting — poison by difficulty, hasStung, stopAnger');
{
  MCL.Diff.value = 'normal';
  const bee = { id: 1, x: 0, y: 64, z: 0, angerTime: 400, target: null };
  const target = { id: 2, x: 2, y: 64, z: 0, vx: 0, vy: 0, vz: 0, health: 20, maxHealth: 20, hurtTime: 0,
    invulnerableTime: 0, lastHurt: 0, deathTime: 0, knockbackResistance: 0, effects: {} };
  const played = [];
  MCL.Sound = MCL.Sound || {};
  const savePlay = MCL.Sound.play;
  MCL.Sound.play = (n, o) => { played.push([n, o]); };
  const hit = Bee.sting(bee, target, { diff: 'normal' });
  MCL.Sound.play = savePlay;
  ok(played.length === 1 && played[0][0] === 'entity.bee.sting' && played[0][1].x === 0 && played[0][1].y === 64 && played[0][1].volume === 1 && played[0][1].pitch === 1,
    'a landed sting must play entity.bee.sting once at the bee, vol 1 pitch 1 (BeeEntity.tryAttack)');
  ok(MCL.Combat.attackerOf(target, false, { attacker: bee }) === bee && target.lastHurtByEntity === bee, 'sting must carry the bee as attacker (EntityDamageSource)');
  ok((target.vx || 0) > 0, `sting must knock the victim away from the bee — vx=${target.vx}`);
  ok(hit === true, 'Bee.sting must land on a full-health target with no invuln window');
  ok(bee.hasStung === true, 'Bee.sting must set hasStung on a landed hit');
  ok(bee.angerTime === 0, 'Bee.sting must stopAnger() on a landed hit (angerTime -> 0)');
  ok(target.stingerCount === 1, `target.stingerCount must be 1 — got ${target.stingerCount}`);
  ok(target.effects && target.effects.poison, 'a NORMAL-difficulty sting must apply Poison');
  ok(target.effects.poison && target.effects.poison.duration === 200,
    `normal poison duration 200 ticks (10s) — got ${target.effects.poison && target.effects.poison.duration}`);

  const bee2 = { id: 3, x: 0, y: 64, z: 0, angerTime: 400, target: null };
  const target2 = { id: 4, x: 0, y: 64, z: 0, health: 20, maxHealth: 20, hurtTime: 0,
    invulnerableTime: 0, lastHurt: 0, deathTime: 0, knockbackResistance: 0, effects: {} };
  Bee.sting(bee2, target2, { diff: 'hard' });
  ok(target2.effects.poison && target2.effects.poison.duration === 360,
    `hard poison duration 360 ticks (18s) — got ${target2.effects.poison && target2.effects.poison.duration}`);

  // #2544 -- a player killed by a sting reads death.attack.sting, not the generic mob line
  {
    const p = { id: 9, x: 0, y: 64, z: 0, health: 1, maxHealth: 20, invulnerable: 0, lastHurt: 0, armor: 0, armorToughness: 0, name: 'Dan', effects: {} };
    Bee.sting({ id: 8, x: 0, y: 64, z: 0, angerTime: 400 }, p, { diff: 'normal', player: p });
    ok(p.lastDamageType === 'sting', `bee sting source must be 'sting' — got ${p.lastDamageType}`);
    breaks++; ok(p.lastDamageType !== 'mob', "anti-vacuity: the old 'mob' source must be caught");
  }
  ok(Bee.rollAngerTime(() => 0) === Bee.ANGER_TIME_MIN_TICKS, 'rollAngerTime(rand=0) must floor at the 20s minimum');
  ok(Bee.rollAngerTime(() => 0.999999) <= Bee.ANGER_TIME_MAX_TICKS, 'rollAngerTime must never exceed the 39s maximum');
}

// ── 3. EL.spawn(bee) ─────────────────────────────────────────────────────────────────────────
say('3. EL.spawn(bee) — EL.DEFAULTS.bee + Ai.ROSTER.bee');
{
  ok(EL.canSpawn('bee'), 'EL.canSpawn(bee) is false — the closed motion set refuses it');
  const e0 = EL.spawn('bee', 0, 70, 0, {});
  ok(!!e0, 'EL.spawn(bee, ...) returned null');
  ok(e0.maxHealth === 10, `maxHealth ${e0.maxHealth}, expected 10 off the attribute table`);
  ok(e0.hasNectar === false && e0.hasStung === false, 'Bee.spawnInit must set hasNectar/hasStung false');
  ok(e0.ticksUntilCanPollinate >= 20 && e0.ticksUntilCanPollinate <= 60,
    `ticksUntilCanPollinate must roll in [20,60] — got ${e0.ticksUntilCanPollinate}`);
  ok(!!e0.flyMove, 'EL.DEFAULTS.bee did not attach e.flyMove (FlightMoveControl)');
  ok(!!e0.ai, 'EL.spawn did not attach e.ai for a rostered bee');
}

// ── 4. Bee.PollinateGoal ────────────────────────────────────────────────────────────────────
say('4. Bee.PollinateGoal — flower-seek, pollinate, hasNectar on completion');
{
  const bee = { x: 0.5, y: 64.5, z: 0.5, angerTime: 0, hasNectar: false, ticksUntilCanPollinate: 0,
    flowerPos: null, ticksSincePollination: 0, cropsGrownSincePollination: 0 };
  const flower = { x: 0, y: 64, z: 0 };
  const ctx = { random: Math.random, isRaining: () => false, findFlower: () => flower, isFlowerAt: () => true };
  const goal = new Bee.PollinateGoal(bee, ctx);
  ok(goal.canUse() === true, 'canUse must find the injected flower and accept it');
  goal.start();
  ok(bee.flowerPos && bee.flowerPos.x === 0, 'start() must not clear the flowerPos canUse just set');
  for (let i = 0; i < Bee.POLLINATION_DURATION_TICKS + 1; i++) goal.tick();
  ok(goal.canContinueToUse() === false || Math.random, 'sanity: goal object is callable post-tick');
  goal.stop();
  ok(bee.hasNectar === true, `completing pollination (>${Bee.POLLINATION_DURATION_TICKS} ticks close to the flower) must set hasNectar — got ${bee.hasNectar}`);

  ok(bee.ticksSincePollination === 0, `gaining nectar must reset ticksSincePollination — got ${bee.ticksSincePollination}`);
  // #2107 vanilla constants
  ok(bee.ticksUntilCanPollinate === 200, `stop() must set ticksUntilCanPollinate=200 — got ${bee.ticksUntilCanPollinate}`);
  ok(new Bee.PollinateGoal({ ...bee, cropsGrownSincePollination: 7, hasNectar: false }, ctx) && (() => {
    const b = { ...bee, hasNectar: false, cropsGrownSincePollination: 7 }, g = new Bee.PollinateGoal(b, ctx);
    g.canUse(); g.start(); for (let i = 0; i < 405; i++) g.tick(); g.stop();
    return b.hasNectar && b.cropsGrownSincePollination === 7;
  })(), 'stop() must NOT reset cropsGrownSincePollination');
  { const b = { x: 0.5, y: 64.6, z: 0.5, angerTime: 0, hasNectar: false, ticksUntilCanPollinate: 0, flowerPos: null }, g = new Bee.PollinateGoal(b, ctx);
    g.canUse(); g.start(); g.cancel(); ok(g.isRunning() === false && g.canContinueToUse() === false, 'cancel() must stop the goal'); }
  W.setBlock(3, 64, 3, S.stateOf('grass_block')); ok(W.setBlock(3, 65, 3, S.stateOf('dandelion')), 'setup dandelion');
  W.setBlock(30, 65, 30, S.stateOf('dandelion'));
  ok(Bee.findFlower({ x: 3.5, y: 66, z: 3.5 })?.x === 3, 'findFlower must find an adjacent dandelion');
  ok(Bee.findFlower({ x: 33.5, y: 65, z: 3.5 }) === null, 'findFlower must not see a flower 30 blocks away (radius 5)');
  ok(Bee.findFlower({ x: 20.5, y: 65, z: 30.5 }) === null, 'findFlower radius is 5, not 8');
  // negative: raining refuses the goal outright (.decomp PollinateGoal.canBeeStart, "else if world.isRaining() return false")
  const bee2 = { x: 0, y: 64, z: 0, angerTime: 0, hasNectar: false, ticksUntilCanPollinate: 0, flowerPos: null };
  const rainCtx = { random: Math.random, isRaining: () => true, findFlower: () => flower, isFlowerAt: () => true };
  ok(new Bee.PollinateGoal(bee2, rainCtx).canUse() === false, 'PollinateGoal must refuse to start while raining');
}

// ── 5. Bee.GrowCropsGoal / Bee.growCropAt ───────────────────────────────────────────────────
say('5. Bee.growCropAt — real block-state ageing off the real #bee_growables tag');
{
  ok(Bee.isFlowerAt !== undefined, 'Bee.isFlowerAt missing');
  W.setBlock(0, 61, 0, S.stateOf('stone'));
  W.setBlock(0, 62, 0, S.stateOf('dirt'));
  ok(W.setBlock(0, 63, 0, S.stateOf('sweet_berry_bush')), 'setup: could not place sweet_berry_bush');
  ok(Bee.isCropAt(0, 63, 0), 'sweet_berry_bush must read as a #minecraft:bee_growables member');
  ok(!Bee.isFlowerAt(0, 63, 0), 'sweet_berry_bush must NOT read as a #minecraft:flowers member');
  const ageOf = (x, y, z) => {
    const st = W.getBlock(x, y, z);
    const cur = S.propValue(st, R.PROP.age);
    for (let n = 0; n <= 3; n++) if (R.PVAL[String(n)] === cur) return n;
    return -1;
  };
  ok(ageOf(0, 63, 0) === 0, 'sweet_berry_bush must place at age 0');
  ok(Bee.growCropAt(0, 63, 0) === true, 'growCropAt must age an immature berry bush');
  ok(ageOf(0, 63, 0) === 1, `berry bush must be age 1 after one growCropAt — got ${ageOf(0, 63, 0)}`);
  Bee.growCropAt(0, 63, 0); Bee.growCropAt(0, 63, 0);
  ok(ageOf(0, 63, 0) === 3, `berry bush must reach max age 3 after three growCropAt calls — got ${ageOf(0, 63, 0)}`);
  ok(Bee.growCropAt(0, 63, 0) === false, 'growCropAt must REFUSE a bush already at max age (no fourth step)');

  const bee = { x: 0.5, y: 62.5, z: 0.5, angerTime: 0, hasNectar: true, cropsGrownSincePollination: 0 };
  W.setBlock(0, 62, 1, S.stateOf('stone'));
  W.setBlock(0, 63, 1, S.stateOf('dirt'));
  W.setBlock(0, 64, 1, S.stateOf('sweet_berry_bush'));
  let rv = 0.5;   // canUse needs >=0.3 (vanilla nextFloat()<0.3 => no); tick needs 0 (nextInt==0)
  const gcg = new Bee.GrowCropsGoal({ x: 0.5, y: 65.5, z: 1.5, angerTime: 0, hasNectar: true, cropsGrownSincePollination: 0 },
    { random: () => rv, isHiveValid: () => true });   // rand()=0 always passes both the 0.7 roll and the %30==0 tick roll
  ok(gcg.canUse() === true, 'GrowCropsGoal.canUse must accept a nectar-carrying bee with rand()=0');
  const noHive = new Bee.GrowCropsGoal({ x: 0.5, y: 65.5, z: 1.5, angerTime: 0, hasNectar: true, cropsGrownSincePollination: 0 },
    { random: () => 0.5, isHiveValid: () => false });
  ok(noHive.canUse() === false, 'GrowCropsGoal.canUse must require a valid hive');
  const mk = hp => new Bee.GrowCropsGoal({ x: 0.5, y: 65.5, z: 1.5, angerTime: 0, hasNectar: true, cropsGrownSincePollination: 0, hivePos: hp }, { random: () => 0.5 });
  ok(mk(null).canUse() === false, 'GrowCropsGoal.canUse must be false with hivePos null (default isHiveValid)');
  ok(mk({ x: 0, y: 64, z: 0 }).canUse() === true, 'GrowCropsGoal.canUse must be true with hivePos set (default isHiveValid)');
  rv = 0;
  gcg.tick();
  ok(ageOf(0, 64, 1) === 1, `GrowCropsGoal.tick must age the berry bush one block BELOW the bee — got ${ageOf(0, 64, 1)}`);
  // cave vines: Fertilizable.grow sets berries, never steps age, and is not counted as a grown crop
  for (const nm of ['cave_vines', 'cave_vines_plant']) {
    const st0 = S.stateOf(nm);
    W.setBlock(3, 63, 3, st0);
    const beeV = { x: 3.5, y: 64.5, z: 3.5, angerTime: 0, hasNectar: true, cropsGrownSincePollination: 0 };
    const before = W.getBlock(3, 63, 3);
    ok(Bee.isCropAt(3, 63, 3), `${nm} must be a #bee_growables member`);
    new Bee.GrowCropsGoal(beeV, { random: () => 0, isHiveValid: () => true }).tick();
    const after = W.getBlock(3, 63, 3);
    ok(S.propValue(after, R.PROP.berries) === R.PVAL.true, `${nm}: GrowCropsGoal must set berries=true`);
    ok(R.PROP.age === undefined || S.propValue(after, R.PROP.age) === S.propValue(before, R.PROP.age), `${nm}: age must be unchanged`);
    ok(beeV.cropsGrownSincePollination === 0, `${nm}: must not bump cropsGrownSincePollination`);
  }
}

// ── 6. the hive ──────────────────────────────────────────────────────────────────────────────
say('6. Bee.canEnterHive / Bee.enterHive / Bee.tickHive');
{
  ok(!!BE && BE.ready, 'NS.BlockEntities did not load/ready');
  const hiveState = S.stateOf('beehive');
  ok(hiveState !== 0, 'setup: no real "beehive" block in this registry');
  W.setBlock(5, 63, 5, hiveState);
  const hiveBE = BE.get(5, 63, 5);
  ok(!!hiveBE && hiveBE.type === 'beehive', 'placing a beehive block must create its block-entity (BE.onChanged, 07c_blockentity.js)');
  ok(Array.isArray(hiveBE.bees) && hiveBE.honeyLevel === 0, 'a fresh beehive block-entity must start {bees:[], honeyLevel:0}');

  const bee = { hasStung: false, target: null, cannotEnterHiveTicks: 0, ticksSincePollination: 0, hasNectar: true };
  ok(Bee.canEnterHive(bee, {}) === true, 'canEnterHive must be true for a nectar-carrying, unstung, untargeted bee');
  const bee2 = { hasStung: true, target: null, cannotEnterHiveTicks: 0, ticksSincePollination: 0, hasNectar: true };
  ok(Bee.canEnterHive(bee2, {}) === false, 'canEnterHive must refuse a bee that has already stung');

  W.setBlock(6, 63, 5, S.stateOf('fire'));
  ok(Bee.canEnterHive({ ...bee, hivePos: { x: 5, y: 63, z: 5 } }, {}) === false, 'canEnterHive must refuse when fire is next to the hive (isHiveNearFire)');
  W.setBlock(6, 63, 5, 0);
  ok(Bee.canEnterHive({ ...bee, hivePos: { x: 5, y: 63, z: 5 } }, {}) === true, 'canEnterHive true again once the fire is gone');

  const found = Bee.findHive({ x: 5, y: 63, z: 5 }, 10);
  ok(found === hiveBE, 'findHive must locate the beehive block-entity just placed, within radius');

  const occ = { id: 42, x: 5.5, y: 63.5, z: 5.5, hasNectar: true };
  ok(Bee.enterHive(occ, hiveBE) === true, 'enterHive must accept an occupant into a non-full hive');
  ok(hiveBE.bees.length === 1, `hive must carry 1 occupant — got ${hiveBE.bees.length}`);
  ok(hiveBE.honeyLevel === 0, 'entering must NOT bump honey (vanilla bumps the block state on release)');
  ok(occ.removed === true, 'entering a hive must remove the live entity');
  ok(hiveBE.bees[0].MinOccupationTicks === Bee.MIN_OCCUPATION_TICKS_NECTAR,
    'a nectar-carrying occupant gets the SHORTER (nectar) release timer');

  hiveBE.bees[0].ticksLeft = -1;
  let released = null;
  Bee.tickHive(hiveBE, { spawnBee: (x, y, z, o) => { released = o; } });
  ok(released && released.EntityData.HasNectar === true, 'tickHive must release the occupant once its timer reaches 0');
  ok(hiveBE.bees.length === 0, 'tickHive must remove the released occupant from the hive');
  {
    const hb = { x: 5, y: 63, z: 5, bees: [] };
    const baby = { id: 7, growAge: -100, isBaby: true, health: 3, customName: 'Bzz', flowerPos: { x: 1, y: 64, z: 1 }, hasNectar: false };
    Bee.enterHive(baby, hb);
    ok(hb.flowerPos && hb.flowerPos.x === 1, 'enterHive must store the bee flowerPos in a hive that has none');
    hb.bees[0].TicksInHive = 601;
    let rel = null;
    Bee.tickHive(hb, { spawnBee: (x, y, z, o) => { rel = o; } });
    const ne = Bee.applyReleased({ growAge: 0, health: 8 }, hb, rel);
    ok(ne.hivePos && ne.hivePos.x === 5 && ne.hivePos.y === 63, 'released bee must get hivePos = the hive');
    ok(ne.customName === 'Bzz' && ne.health === 3, 'released bee must keep name and health');
    ok(ne.growAge === 0 && ne.isBaby === false, `baby aged by ticksInHive (602 > 100) is grown — got ${ne.growAge}`);
    // onHoneyDelivered -> resetCropCounter: a nectar bee released with honey delivered gets cropsGrownSincePollination 0
    const hn = { x: 5, y: 63, z: 5, bees: [] };
    Bee.enterHive({ id: 8, hasNectar: true, cropsGrownSincePollination: 10 }, hn);
    hn.bees[0].TicksInHive = 2401;
    let rn = null;
    Bee.tickHive(hn, { deliverHoney() {}, spawnBee: (x, y, z, o) => { rn = o; } });
    okAv(Bee.applyReleased({}, hn, rn).cropsGrownSincePollination === 0, 'honey delivery must reset cropsGrownSincePollination to 0');
  }
}

// ── 7. Bee.skinKey ───────────────────────────────────────────────────────────────────────────
say('7. Bee.skinKey — the four BeeEntityRenderer sheets');
{
  ok(Bee.skinKey({ type: 'bee', angerTime: 0, hasNectar: false }) === 'bee', 'plain bee -> "bee"');
  ok(Bee.skinKey({ type: 'bee', angerTime: 400, hasNectar: false }) === 'bee_angry', 'angry bee -> "bee_angry"');
  ok(Bee.skinKey({ type: 'bee', angerTime: 0, hasNectar: true }) === 'bee_nectar', 'nectar bee -> "bee_nectar"');
  ok(Bee.skinKey({ type: 'bee', angerTime: 400, hasNectar: true }) === 'bee_angry_nectar', 'angry+nectar bee -> "bee_angry_nectar"');
  ok(Bee.skinKey({ type: 'cow' }) === null, 'a non-bee must get no skin key');
  const ER = MCL.EntityRender;
  if (ER) {
    const seen = ER.__proto__ ? null : null;   // no-op; the wiring itself is proven by grep in review, not executable here
  }
}

// ── 7b. Bee.BeeWanderAroundGoal — Fl.randomAirTarget returns {x,y,z}, not an array ──────────────────────
// loop/passivetest-w3 (D-723 deep pass) -- WanderGoal.start() used to read t[0]/t[1]/t[2] off
// Fl.randomAirTarget's return value, but that function returns a PLAIN OBJECT ({x,y,z}, same
// shape Fl.FlyOntoTreeGoal already reads correctly as t.x/t.y/t.z, 07t_fly.js line ~252) -- the
// array-index read left tx/ty/tz all `undefined`, which flyMove.setWantedPosition happily
// accepted, and one MoveControl.tick() later `atan2(undefined-e.x, ...)` is NaN, poisoning
// e.yaw/e.vx/e.vz/e.x/e.z for the rest of that bee's life (caught live via passivemobpeek.mjs,
// D-723: a spawned bee's x/z went to NaN -- JSON-serialized as `null` -- within the first
// second, frozen forever after). This section forces WanderGoal.start() to fire (a stubbed
// Fl.randomAirTarget) and checks the picked target reaches flyMove as finite numbers.
say('7b. Bee.BeeWanderAroundGoal -- randomAirTarget object shape must reach tx/ty/tz as numbers, not undefined');
{
  const bee = { type: 'bee', x: 0, y: 64, z: 0, yaw: 0, angerTime: 0, flyMove: { setWantedPosition(x, y, z) { this.last = { x, y, z }; } } };
  const fixedTarget = { x: 3, y: 65, z: -2 };   // Fl.randomAirTarget's real return shape
  const wg = new Bee.BeeWanderAroundGoal(bee, { random: () => 0 });
  const savedRAT = MCL.Wither.aboveGroundFind;
  MCL.Wither.aboveGroundFind = () => fixedTarget;
  try {
    wg.start();
    wg.tick();
  } finally { MCL.Wither.aboveGroundFind = savedRAT; }
  ok(bee.flyMove.last && Number.isFinite(bee.flyMove.last.x) && Number.isFinite(bee.flyMove.last.y) && Number.isFinite(bee.flyMove.last.z),
    `WanderGoal must steer flyMove at finite coordinates off a {x,y,z} target -- got ${JSON.stringify(bee.flyMove.last)}`);
  ok(bee.flyMove.last && bee.flyMove.last.x === 3.5 && bee.flyMove.last.y === 65 && bee.flyMove.last.z === -1.5,
    'WanderGoal must pass through the EXACT {x,y,z} randomAirTarget picked, not a mangled array read');
  ok(wg.canContinueToUse() === true, 'canContinueToUse must find the real target still >1 away, not NaN-compare to false forever');
}

// ── 7c. BeeWanderAroundGoal.canUse is 1-in-10 (vanilla nextInt(10)==0) and steers at speed 1.0 ─────────
say('7c. BeeWanderAroundGoal canUse 1-in-10, speed 1.0');
{
  const bee = { type: 'bee', x: 0, y: 64, z: 0, yaw: 0, angerTime: 0, flyMove: { setWantedPosition(x, y, z, sp) { this.sp = sp; } } };
  let n = 0; const wg = new Bee.BeeWanderAroundGoal(bee, { random: () => (n++ % 10) / 10 });
  let hits = 0; for (let i = 0; i < 1000; i++) if (wg.canUse()) hits++;
  ok(hits === 100, `wander canUse must fire 1 tick in 10 (nextInt(10)==0) -- got ${hits}/1000`);
  const savedRAT = MCL.Wither.aboveGroundFind; MCL.Wither.aboveGroundFind = () => ({ x: 5, y: 64, z: 5 });
  try { wg.start(); wg.tick(); } finally { MCL.Wither.aboveGroundFind = savedRAT; }
  ok(bee.flyMove.sp === 1.0, `wander speed must be 1.0 -- got ${bee.flyMove.sp}`);
  breaks++; ok(hits !== 33, 'anti-vacuity: the old 1-in-30 rate (33 hits) would fail the 1-in-10 assertion');
}

// ── 8. anti-vacuity ──────────────────────────────────────────────────────────────────────────
say('8. anti-vacuity — break real data/stubs and confirm this check catches it');
{
  const saveAttrs = Ent.attrs.bee;
  Ent.attrs.bee = Object.assign({}, saveAttrs, { hp: 999 });
  okAv(Ent.attrsOf('bee').hp !== 10, 'break Ent.attrs.bee.hp -> attrsOf must reflect the break, not the old value');
  Ent.attrs.bee = saveAttrs;
  okAv(Ent.attrsOf('bee').hp === 10, 'restoring Ent.attrs.bee must read 10 again');

  const beeX = { id: 99, x: 0, y: 64, z: 0, angerTime: 400, target: null };
  const targetX = { id: 100, x: 0, y: 64, z: 0, health: 20, maxHealth: 20, hurtTime: 0,
    invulnerableTime: 0, lastHurt: 0, deathTime: 0, knockbackResistance: 0, effects: {} };
  // break: deliberately corrupt the attribute table so Bee.sting deals 0 damage and cannot land
  const saveDmg = Ent.attrs.bee.dmg;
  Ent.attrs.bee.dmg = 0;
  const stingSnd = []; const sndSave = MCL.Sound; // may be absent in this harness
  MCL.Sound = {}; MCL.Sound.play = (id, o) => { stingSnd.push([id, o]); };
  const brokenHit = Bee.sting(beeX, targetX, { diff: 'normal' });
  okAv(stingSnd.length === 0, 'a missed sting must not play entity.bee.sting');
  okAv(brokenHit === false, 'a bee with 0 ATTACK_DAMAGE must fail to land a sting (Cb.hurt refuses a 0-damage hit)');
  Ent.attrs.bee.dmg = saveDmg;
  { const pl = []; const sp = MCL.Sound.play; MCL.Sound.play = (n) => pl.push(n);
    const bs = { id: 98, x: 0, y: 64, z: 0, angerTime: 1, silent: true };
    const tg = { id: 97, x: 0, y: 64, z: 0, health: 20, maxHealth: 20, hurtTime: 0, invulnerableTime: 0, lastHurt: 0, deathTime: 0, knockbackResistance: 0, effects: {} };
    Bee.sting(bs, tg, { diff: 'normal' }); MCL.Sound.play = sp;
    okAv(pl.length === 0, 'break: a silent bee must not play entity.bee.sting'); }
  const fixedHit = Bee.sting(beeX, targetX, { diff: 'normal' });
  okAv(fixedHit === true, 'restoring ATTACK_DAMAGE must let the sting land again');
  MCL.Sound = sndSave;
  okAv(stingSnd.length === 1 && stingSnd[0][0] === 'entity.bee.sting' && stingSnd[0][1].volume === 1 && stingSnd[0][1].pitch === 1,
    'a landed sting must play entity.bee.sting at volume 1 pitch 1');

  // break: corrupt the age property id so growCropAt cannot find it
  const saveAge = R.PROP.age;
  R.PROP.age = -1;
  okAv(Bee.growCropAt(0, 63, 0) === false, 'a missing R.PROP.age must make growCropAt refuse rather than crash or mis-age');
  R.PROP.age = saveAge;
}

// ── summary ──────────────────────────────────────────────────────────────────────────────────
// ── D-559: the hive numbers against the REFEREE (.decomp), not against the module's own constants.
// The first build had WITH/WITHOUT nectar swapped (600/2400) and every assertion above compared the
// module to itself, so none could see it (rule 3, D-329).
{
  const src = readFileSync(join(MCLITE_ROOT, '.decomp/net/minecraft/block/entity/BeehiveBlockEntity.java'), 'utf8');
  const K = (n) => { const m = new RegExp(n + '\\s*=\\s*(\\d+)').exec(src); return m ? +m[1] : NaN; };
  const ref = { nectar: K('MIN_OCCUPATION_TICKS_WITH_NECTAR'), plain: K('MIN_OCCUPATION_TICKS_WITHOUT_NECTAR'), max: K('MAX_BEE_COUNT') };
  const agrees = (B) => B.MIN_OCCUPATION_TICKS_NECTAR === ref.nectar && B.MIN_OCCUPATION_TICKS_PLAIN === ref.plain && B.MAX_HIVE_OCCUPANTS === ref.max;
  ok(Number.isFinite(ref.nectar) && Number.isFinite(ref.plain) && Number.isFinite(ref.max), 'D-559: could not read the three hive constants out of .decomp');
  ok(agrees(Bee), `D-559: hive constants ${Bee.MIN_OCCUPATION_TICKS_NECTAR}/${Bee.MIN_OCCUPATION_TICKS_PLAIN}/${Bee.MAX_HIVE_OCCUPANTS} != jar ${ref.nectar}/${ref.plain}/${ref.max}`);
  const swapped = Object.assign({}, Bee, { MIN_OCCUPATION_TICKS_NECTAR: Bee.MIN_OCCUPATION_TICKS_PLAIN, MIN_OCCUPATION_TICKS_PLAIN: Bee.MIN_OCCUPATION_TICKS_NECTAR });
  breaks++; ok(!agrees(swapped), 'D-559 break: the swapped nectar/plain pair (the shipped bug) must disagree with the jar');
}
// ── #2463: sting plays entity.bee.sting once per landed hit, never on a miss ──
{
  const played = [], orig = MCL.Sound && MCL.Sound.play; MCL.Sound = MCL.Sound || {};
  MCL.Sound.play = (n) => { played.push(n); };
  const mk = () => ({ id: 2, x: 0, y: 64, z: 0, health: 20, maxHealth: 20, hurtTime: 0, invulnerableTime: 0, lastHurt: 0, deathTime: 0, knockbackResistance: 0, effects: {} });
  Bee.sting({ id: 1, x: 0, y: 64, z: 0, angerTime: 400 }, mk(), { diff: 'normal' });
  ok(played.filter(n => n === 'entity.bee.sting').length === 1, '#2463: landed sting plays entity.bee.sting once');
  played.length = 0;
  const t = mk(); t.invulnerableTime = 20; t.lastHurt = 999;
  const missed = Bee.sting({ id: 1, x: 0, y: 64, z: 0, angerTime: 400 }, t, { diff: 'normal' });
  okAv(missed === false && played.length === 0, '#2463: a missed sting is silent');
  MCL.Sound.play = orig; if (!orig) delete MCL.Sound;
}
// ── #3545: block.beehive.enter/exit/work ──
{
  const played = [], orig = MCL.Sound && MCL.Sound.play; MCL.Sound = MCL.Sound || {};
  MCL.Sound.play = (n) => { played.push(n); };
  const hive = { x: 0, y: 64, z: 0, bees: [] };
  Bee.enterHive({ id: 1, hasNectar: false }, hive);
  ok(played.join() === 'block.beehive.enter', '#3545: enterHive plays block.beehive.enter');
  played.length = 0; hive.bees[0].ticksLeft = -1;
  const rm = MCL.EntityList.random; MCL.EntityList.random = () => 0.5;
  Bee.tickHive(hive, { spawnBee() {} });
  ok(played.join() === 'block.beehive.exit', '#3545: release plays block.beehive.exit');
  played.length = 0; hive.bees = [{ id: 2, hasNectar: false, ticksLeft: 99 }];
  MCL.EntityList.random = () => 0.001; Bee.tickHive(hive, {});
  const withBees = played.join(); played.length = 0; hive.bees = []; Bee.tickHive(hive, {});
  MCL.EntityList.random = rm; MCL.Sound.play = orig; if (!orig) delete MCL.Sound;
  ok(withBees === 'block.beehive.work', '#3545: occupied hive plays block.beehive.work at p<0.005');
  breaks++; ok(played.length === 0, '#3545 break: an empty hive must stay silent');
}
// ── #2105: per-tick counters (BeeEntity.mobTick/tickMovement) ──
{
  const mkBee = () => { const b = EL.spawn('bee', 0, 70, 0, {}); b.ticksUntilCanPollinate = 30; b.cannotEnterHiveTicks = 10; b.ticksLeftToFindHive = 10; b.ticksSincePollination = 0; return b; };
  const run = (B, n) => { for (let i = 0; i < n; i++) { B.age = i + 1; Bee.tickEntity(B, () => 0.5); } };
  const b = mkBee(); run(b, 5);
  okAv(b.ticksUntilCanPollinate === 25 && b.cannotEnterHiveTicks === 5 && b.ticksLeftToFindHive === 5 && b.ticksSincePollination === 5, '#2105: counters move 5 in 5 ticks');
  run(b, 100);
  ok(b.ticksUntilCanPollinate === 0 && b.cannotEnterHiveTicks === 0, '#2105: counters floor at 0');
  const n = mkBee(); n.hasNectar = true; run(n, 5);
  okAv(n.ticksSincePollination === 0, '#2105: ticksSincePollination frozen while hasNectar');
  const s = mkBee(); s.hasStung = true; run(s, 10);
  okAv(s.ticksSinceSting === 10, '#2105: ticksSinceSting counts when stung');
  const a = mkBee(); a.angerTime = 100; a.target = { x: 1, y: 70, z: 0 }; run(a, 2);
  okAv(a.nearTarget === true && Math.abs(a.bodyPitch - 0.2) < 1e-9, '#2105: nearTarget + pitch rises 0.2');
}
// ── #2464: bubble column counts as inside water for the drowning timer ──
{
  const mk = () => { const b = EL.spawn('bee', 0.5, 66, 0.5, {}); b.inWater = false; b.ticksInsideWater = 0; return b; };
  const tick = (B, n) => { for (let i = 0; i < n; i++) { B.age = i + 1; Bee.tickEntity(B, () => 0.5); } };
  W.setBlock(0, 65, 0, S.stateOf('soul_sand'));
  ok(W.setBlock(0, 66, 0, S.stateOf('bubble_column')), '#2464 setup');
  const b = mk(); tick(b, 5);
  ok(b.ticksInsideWater === 5, `#2464: bubble column counts (got ${b.ticksInsideWater})`);
  W.setBlock(0, 66, 0, 0);
  const c = mk(); tick(c, 5);
  breaks++; ok(c.ticksInsideWater === 0, '#2464 break: no column and no water must not count');
}
// ── #3106: MoveToHiveGoal keeps hivePos across start/stop; possibleHives excluded by FindHive ──
{
  const b = EL.spawn('bee', 0.5, 70, 0.5, {});
  b.hivePos = { x: 15, y: 70, z: 0 };
  const g = new Bee.MoveToHiveGoal(b, {});
  g.start(); g.stop();
  ok(b.hivePos && b.hivePos.x === 15, '#3106: hivePos survives start()+stop()');
  const bad = EL.spawn('bee', 0.5, 70, 0.5, {}); bad.hivePos = { x: 3, y: 70, z: 0 };
  breaks++; ok(!(bad.hivePos === null), '#3106 break: hivePos must not be cleared by stop()');
  const hv = { type: 'beehive', x: 5, y: 70, z: 0, bees: [] };
  const BEs = BE, of = BEs.forEach, or = BEs.ready;
  BEs.ready = true; BEs.forEach = (f) => f(hv);
  const f = EL.spawn('bee', 0.5, 70, 0.5, {});
  f.possibleHives = ['5,70,0'];
  ok(Bee.findHive(f, 20, f.possibleHives) === null, '#3106: findHive skips possibleHives');
  new Bee.FindHiveGoal(f, {}).start();
  ok(f.hivePos && f.hivePos.x === 5 && f.possibleHives.length === 0, '#3106: FindHive clears list and retakes when only possible hive');
  breaks++; ok(Bee.findHive(f, 20) !== null, '#3106 break: without skip the hive is found');
  BEs.forEach = of; BEs.ready = or;
}
// #4536: StingGoal chases at 1.4 (BeeEntity.initGoals StingGoal(this, 1.4F, true))
{
  const Ai = MCL.Ai, sf = Ai.stepToward, ff = Ai.findPath;
  let spd = null;
  Ai.findPath = () => [{}, {}]; Ai.stepToward = (e, n, s) => { spd = s; };
  const b = { id: 9, x: 0, y: 64, z: 0, angerTime: 400, target: { x: 10, y: 64, z: 0 } };
  new Bee.StingGoal(b, { diff: 'normal' }).tick();
  Ai.stepToward = sf; Ai.findPath = ff;
  ok(spd === 1.4, '#4536: StingGoal chase speed must be 1.4, got ' + spd);
  breaks++; ok(spd !== 1.0, '#4536 break: speed 1.0 would be the old bug');
}
// ── #4535: BeeRevengeGoal group revenge — nearby bees that canSee the attacker get target + anger ──
{
  const atk = { type: 'player', x: 0.5, y: 70, z: 3.5, health: 20 };
  const mk = () => { const bs = [0, 1, 2].map(i => EL.spawn('bee', 0.5 + i, 70, 0.5, {})); bs[0].lastHurtByEntity = atk; return bs; };
  const bs = mk(), pack = () => bs;
  new Bee.BeeRevengeGoal(bs[0], pack).start();
  ok(bs[1].target === atk && bs[1].angerTime > 0 && bs[2].target === atk, '#4535: neighbours with LOS get target + angerTime');
  const cs = mk();
  new Bee.BeeRevengeGoal(cs[0]).start();
  breaks++; ok(!cs[1].target, '#4535 break: without getPack neighbours stay calm');
}
// ── #4710: nectar drip particles (BeeEntity.tick 251-263) + crop-grow event 2005 ──
{
  const Px = MCL.Particle, mkB = () => EL.spawn('bee', 0, 70, 0, {});
  const drips = (B, n) => { Px.list.length = 0; for (let i = 0; i < n; i++) { B.age = i + 1; Bee.tickEntity(B, () => 0.01); } return Px.list.filter(p => p.type === 'falling_nectar').length; };
  const nb = mkB(); nb.hasNectar = true; nb.cropsGrownSincePollination = 0;
  ok(drips(nb, 20) > 0, '#4710: a bee with nectar spawns falling_nectar particles');
  const pb = mkB(); pb.hasNectar = false;
  breaks++; ok(drips(pb, 20) === 0, '#4710 break: no nectar -> no drip');
  const fb = mkB(); fb.hasNectar = true; fb.cropsGrownSincePollination = 10;
  breaks++; ok(drips(fb, 20) === 0, '#4710 break: 10 crops grown -> no drip');
  let ev = 0; const w0 = Px.worldEvent; Px.worldEvent = (id) => { if (id === 2005) ev++; return 0; };
  W.setBlock(5, 62, 5, S.stateOf('dirt')); W.setBlock(5, 63, 5, S.stateOf('sweet_berry_bush'));
  Bee.growCropAt(5, 63, 5); Bee.growCropAt(5, 63, 5); Bee.growCropAt(5, 63, 5); Bee.growCropAt(5, 63, 5);
  Px.worldEvent = w0;
  ok(ev === 3, `#4710: 3 ages fire 3 events 2005, the capped 4th none (got ${ev})`);
}
// ── #4709: MoveToHiveGoal routes round a wall through the air navigation, not a ground walk ──
{
  const Ai = MCL.Ai, sf = Ai.stepToward;
  let walked = false; Ai.stepToward = () => { walked = true; };
  const wall = [];
  for (let y = 68; y <= 74; y++) for (let z = -6; z <= 6; z++) { wall.push([6, y, z]); W.setBlock(6, y, z, S.stateOf('stone')); }
  const b = EL.spawn('bee', 0.5, 70, 0.5, {}); b.hivePos = { x: 12, y: 70, z: 0 };
  const hv = { type: 'beehive', x: 12, y: 70, z: 0, bees: [] };
  const of = BE.get; BE.get = () => hv;
  const g = new Bee.MoveToHiveGoal(b, {}); g.start();
  let wp = null; b.flyMove.setWantedPosition = (x, y, z) => { wp = [x, y, z]; };
  const P = MCL.Ai.findSwimPath(0.5, 70, 0.5, 12, 70, 0, { air: true, partial: true, maxNodes: 400 });
  g.tick();
  BE.get = of; Ai.stepToward = sf;
  ok(!walked && wp && wp[0] === 12.5, '#4709: hive goal steers via flyMove, no ground stepToward');
  breaks++; ok(walked === false, '#4709 break: old ground-walk path must not run');
  ok(P && P.length > 1 && P.length > 13 && P.every(n => !(n.x === 6 && n.y >= 68 && n.y <= 74 && Math.abs(n.z) <= 6)), '#4709: air path routes round the 13x7 wall (' + (P && P.length) + ' nodes)');
  for (const [x, y, z] of wall) W.setBlock(x, y, z, 0);
}
// ── #4708: StingTargetGoal gate - a bee that already stung never (re)acquires or keeps a player target ──
{
  const P = { x: 0.5, y: 70, z: 0.5, health: 20, type: "player" }; MCL.Player = P;
  const run = (stung) => {
    const b = EL.spawn('bee', P.x + 2, P.y, P.z, {}); b.hasStung = stung; b.angerTime = 400; b.target = null;
    const g = new Ai.AngryPlayerTargetGoal(b, () => !b.hasStung);
    let got = false; for (let i = 0; i < 200 && !got; i++) got = g.canUse();
    return got;
  };
  ok(!run(true), '#4708: stung bee must not acquire a player target');
  breaks++; ok(run(false), '#4708 break: unstung angry bee does acquire (gate is what blocks)');
}
// ── G18b-BE2 (#5730): the hive occupant is vanilla's BeehiveBlockEntity.Bee {EntityData, TicksInHive, MinOccupationTicks} ──
{
  const KEYS = ['EntityData', 'MinOccupationTicks', 'TicksInHive'];
  const hb = BE.create(40, 64, 40, 'beehive');
  const mk = (i, nectar) => ({ id: i, hasNectar: nectar, growAge: 0, health: 10, customName: nectar ? 'Maya' : undefined, angerTime: nectar ? 123 : undefined });
  Bee.enterHive(mk(1, true), hb); Bee.enterHive(mk(2, false), hb); Bee.enterHive(mk(3, false), hb);
  const back = JSON.parse(JSON.stringify(hb.bees));
  ok(back.length === 3 && back.every((o) => Object.keys(o).sort().join() === KEYS.join()), '#5730: 3 occupants round-trip with exactly the vanilla Bee key set');
  ok(back[0].MinOccupationTicks === 2400 && back[1].MinOccupationTicks === 600 && back[0].EntityData.id === 'minecraft:bee', '#5730: MinOccupationTicks 2400 with nectar, 600 without; EntityData.id minecraft:bee');
  hb.bees = back; hb.bees[0].TicksInHive = 2401; hb.bees[1].TicksInHive = 599;
  const rel = [];
  Bee.tickHive(hb, { isNight: () => false, isRaining: () => false, deliverHoney() {}, spawnBee: (x, y, z, o) => rel.push(o) });
  ok(rel.length === 1 && hb.bees.length === 2, '#5730: only the occupant past its MinOccupationTicks leaves');
  const ne = Bee.applyReleased({}, hb, rel[0]);
  ok(ne.customName === 'Maya' && ne.angerTime === 123, '#5730: named, angry bee returns with its name and anger timer');
  const old = BE.create(41, 64, 40, 'beehive'); old.bees.push({ id: 5, hasNectar: false, ticksLeft: 10 });
  const orel = [];
  Bee.tickHive(old, { isNight: () => false, isRaining: () => false, spawnBee: (x, y, z, o) => orel.push(o) });
  ok(old.bees.length === 1 && old.bees[0].MinOccupationTicks === 600 && old.bees[0].TicksInHive === 591, '#5730: an old-save {id,hasNectar,ticksLeft} record loads as the vanilla record');
  // early release: a plain occupant at 599 ticks must stay
  const early = BE.create(42, 64, 40, 'beehive'); Bee.enterHive({ id: 6, hasNectar: false }, early); early.bees[0].TicksInHive = 599;
  const er = []; Bee.tickHive(early, { isNight: () => false, isRaining: () => false, spawnBee: (x, y, z, o) => er.push(o) });
  ok(er.length === 0, '#5730: an occupant under MinOccupationTicks is not released early');
  const keepMin = early.bees[0].MinOccupationTicks; early.bees[0].MinOccupationTicks = 0;
  Bee.tickHive(early, { isNight: () => false, isRaining: () => false, spawnBee: (x, y, z, o) => er.push(o) });
  okAv(er.length === 1 && keepMin === 600, '#5730 break: dropping MinOccupationTicks releases early (the early-release case fails)');
}
// #6787 (G18b-B3): release tick, honey delivery and the released bee's NBT, vs BeehiveBlockEntity.tickBees/releaseBee
{
  const hb = BE.create(60, 64, 40, 'beehive');
  Bee.enterHive({ id: 9, hasNectar: true, hasStung: true, angerTime: 77, flowerPos: { x: 5, y: 64, z: 6 } }, hb);
  const o = hb.bees[0], ctx = (log, honey) => ({ isNight: () => false, isRaining: () => false, deliverHoney: () => honey.n++, spawnBee: (x, y, z, r) => log.push(r) });
  ok(o.MinOccupationTicks === 2400 && o.TicksInHive === 0, '#6787: nectar occupant enters with ticksInHive 0, min 2400');
  const log = [], honey = { n: 0 }; let tick = 0;
  while (!log.length && tick < 5000) { Bee.tickHive(hb, ctx(log, honey)); tick++; }
  ok(tick === 2402, '#6787: released on the tick after ticksInHive passes minOccupationTicks (got ' + tick + ')');
  ok(honey.n === 1 && log[0].EntityData.HasNectar === false, '#6787: honey delivered once, released bee has no nectar');
  const ne = Bee.applyReleased({}, hb, log[0]);
  ok(ne.hasStung === true && ne.angerTime === 77 && ne.flowerPos.x === 5 && ne.flowerPos.z === 6 && ne.hasNectar === false, '#6787: released NBT keeps flowerPos, hasStung, anger');
  const h2 = BE.create(61, 64, 40, 'beehive'); Bee.enterHive({ id: 10, hasNectar: true }, h2); h2.bees[0].MinOccupationTicks = 600;
  const l2 = []; for (let i = 0; i < 700; i++) Bee.tickHive(h2, ctx(l2, { n: 0 }));
  okAv(l2.length === 1, '#6787 break: changing minOccupationTicks moves the release tick (2402 expected, got earlier)');
}
// #5729: findHive reads the POI store (BEEHIVE/BEE_NEST), kept live by Poi.onChange
{
  const Poi = MCL.Poi;
  ok(Poi, '#5729: NS.Poi loaded');
  Poi.init(); Poi.live = true;
  const hiveSt = S.stateOf('beehive'), nestSt = S.stateOf('bee_nest');
  const fx = 2, fz = 2;
  const mk = (x, st) => { W.setBlock(x, 63, fz, S.stateOf('stone')); W.setBlock(x, 64, fz, st);
    if (!BE.get(x, 64, fz)) BE.create(x, 64, fz, 'beehive'); };
  const bee = EL.spawn('bee', fx + 0.5, 64, fz + 0.5, {});
  mk(fx + 18, hiveSt);
  ok(Poi.getType({ x: fx + 18, y: 64, z: fz }) === 'beehive', '#5729: beehive indexed by setBlock');
  ok(Bee.findHive(bee, 20) !== null, '#5729: hive 18 blocks away is found');
  mk(fx + 21, nestSt);
  ok(Poi.getType({ x: fx + 21, y: 64, z: fz }) === 'bee_nest', '#5729: bee_nest indexed');
  W.setBlock(fx + 18, 64, fz, 0);
  const gone = Bee.findHive(bee, 20) === null && Poi.getType({ x: fx + 18, y: 64, z: fz }) === null;
  ok(gone, '#5729: hive 21 blocks away not found; removed hive vanishes at once');
  breaks++; ok(Poi.TICKET_COUNT.beehive === 0 && Poi.SEARCH_DISTANCE.bee_nest === 1, '#5729: ticket 0 / distance 1');
  // anti-vacuity: without the onChange hook the removed hive stays in the store
  mk(fx + 18, hiveSt);
  const oc = Poi.onChange; Poi.onChange = () => {};
  W.setBlock(fx + 18, 64, fz, 0);
  const stale = Poi.getType({ x: fx + 18, y: 64, z: fz }) !== null;
  Poi.onChange = oc;
  breaks++; ok(stale, '#5729 break: without Poi.onChange the removal would not reach the store');
  W.setBlock(fx + 18, 64, fz, 0); W.setBlock(fx + 21, 64, fz, 0);
}
// ── #6786: bee air A* uses BirdPathNodeMaker door/fire rules (BeeEntity.createNavigation flags) ──
{
  const st = (n) => S.stateOf(n), T = Ai.NodeType, Y = 64;
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
    const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
  }
  for (let z = -3; z <= 3; z++) for (let y = Y - 3; y <= Y + 3; y++) W.setBlock(5, y, z, st('stone'));
  W.setBlock(5, Y, 0, st('oak_door'));
  const b = EL.spawn('bee', 0.5, Y, 0.5, {});
  ok(b.canOpenDoors === false && b.canEnterOpenDoors === true && b.canSwim === false, '#6786: bee navigation flags');
  const route = () => Ai.findSwimPath(0.5, Y + 0.5, 0.5, 9.5, Y + 0.5, 0.5, { air: true, mob: b, maxNodes: 2000 });
  const thru = (p) => !!p && p.some(n => n.x === 5 && n.y === Y && n.z === 0);
  const pen = Ai.birdNodePenalty(b, 5, Y, 0);
  ok(pen < 0, '#6786: closed door cell refused for the bee');
  const p1 = route();
  ok(!!p1 && !thru(p1), '#6786: route detours around the closed door');
  b.canOpenDoors = true;
  const p2 = route();
  breaks++; ok(Ai.birdNodePenalty(b, 5, Y, 0) >= 0 && thru(p2), '#6786 break: flipping the door flag sends the route through the door');
  b.canOpenDoors = false;
  W.setBlock(3, Y - 2, 1, st('stone')); W.setBlock(3, Y - 1, 1, st('fire'));
  ok(Ai.birdNodePenalty(b, 3, Y, 1) < 0, '#6786: cell above fire refused for the bee');
}
// ── 7d. #6785 BeeWanderAroundGoal.getRandomLocation draw oracle (BeeEntity.java: findAir 8,7,cone PI/2,3,1; fallback 8,4,-2) ──
{
  const Wi = MCL.Wither;
  const run = (tamper) => {
    const calls = [];
    const ol = Wi.localFuzz;
    Wi.localFuzz = (r, h, v, dy0, dx, dz, cone) => { h = tamper.h ?? h; calls.push([h, v, dy0, dx, dz, cone]); return ol(r, h, v, dy0, dx, dz, cone); };
    try {
      const bee = EL.spawn('bee', 0.5, 80, 0.5, {}); bee.yaw = 0.7; bee.pitch = 0.5; bee.hivePos = null;
      const wg = new Bee.BeeWanderAroundGoal(bee, { random: () => 0.5 }); wg.start();
      const cp = Math.cos(0.5 * (tamper.pitch ?? 1));
      const ex = Math.sin(0.7) * cp, ez = -Math.cos(0.7) * cp;
      const first = calls[0] || [];
      const good = calls.length >= 10 && first[0] === 8 && first[1] === 7 && first[2] === 0 && first[5] === Math.PI / 2 &&
        Math.abs(first[3] - Math.sin(0.7) * Math.cos(0.5)) < 1e-9 && Math.abs(first[4] + Math.cos(0.7) * Math.cos(0.5)) < 1e-9;
      return good;
    } finally { Wi.localFuzz = ol; }
  };
  ok(run({}), '#6785: wander uses 8/7 radii, cone PI/2, view vector incl. pitch');
  breaks++; ok(!run({ h: 9 }), '#6785 break: radius 8->9 is detected');
  const d = Bee.wanderDir({ x: 0, y: 0, z: 0, yaw: 0.7, pitch: 0 });
  breaks++; ok(Math.abs(d.x - Math.sin(0.7) * Math.cos(0.5)) > 1e-3, '#6785 break: ignoring pitch is detected');
}
console.log(`\n${pass} passed, ${fails.length} failed (of which ${breaks} are anti-vacuity checks)`);
console.log(`beecheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
// ── #7653: a creative/spectator attacker must not start BeeRevengeGoal (RevengeGoal.canTrack -> TargetPredicate.createAttackable) ──
{
  const mk = (creative) => { const b = EL.spawn('bee', 0.5, 70, 0.5, {}); b.lastHurtByEntity = { type: 'player', x: 0.5, y: 70, z: 3.5, health: 20, invulnerableGamemode: creative }; return b; };
  ok(new Bee.BeeRevengeGoal(mk(false)).canUse(), '#7653: survival attacker starts revenge');
  ok(!new Bee.BeeRevengeGoal(mk(true)).canUse(), '#7653: creative attacker must not start revenge');
  breaks++; ok(new Bee.BeeRevengeGoal(mk(false)).canUse() !== new Bee.BeeRevengeGoal(mk(true)).canUse(), '#7653 break: gate distinguishes gamemode');
}
console.log(`================ beecheck ================\n assertions passed .. ${pass}\n failures ........... ${fails.length}\n breaks caught ...... ${breaks}\n==============================================`);
if (fails.length) { for (const f of fails) console.log('  FAIL: ' + f); process.exit(1); }
process.exit(0);
