#!/usr/bin/env node
// undeadcheck.mjs -- loop/zombievariants-s100 (QUEUE 0.2 G18c): HUSK, STRAY and DROWNED, whole.
// Drives the REAL modules (07zk_undead.js, Ai.ROSTER.husk/.stray/.drowned, EL.DEFAULTS.husk/
// .stray/.drowned, Spawn.RULES.husk/.stray/.drowned, Eq.MOB_BASE_ARMOR/Eq.initDrowned,
// Cb.mobShootTrident/tickTrident/tickArrow's own tip payload, Cb.mobAttack's own husk hook)
// against `.decomp/net/minecraft/entity/mob/{HuskEntity,StrayEntity,DrownedEntity,
// ZombieEntity}.java` (all four read in full).
//
//   node tools/undeadcheck.mjs [--verbose]
//
// Sections:
//   1. attributes/dimensions/motion — the jar-extracted entity table's own rows
//   2. EL.spawn — Ai.ROSTER wiring, Eq.MOB_BASE_ARMOR
//   3. Spawn.RULES.husk/.stray/.drowned
//   4. husk: Hunger on an unarmed hit (Cb.mobAttack -> Undead.onHuskHit)
//   5. stray: tipped arrows (Cb.mobShoot's own e.tip payload, Cb.tickArrow applies it)
//   6. water conversion: husk -> zombie, zombie -> drowned (600+300 ticks)
//   7. drowned equipment: Eq.initDrowned's probabilistic trident/fishing_rod + offhand shell
//   8. drowned targeting: Undead.canDrownedAttackTarget/filterDrownedTargets
//   9. drowned trident ranged attack: Cb.mobShootTrident/Cb.tickTrident
//  10. drowned water goals: GoToBeachGoal/SwimUpGoal/GoToWaterGoal canUse gating
//  11. anti-vacuity sweep

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c && VERBOSE) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };

console.log('undeadcheck -- loop/zombievariants-s100 (QUEUE 0.2 G18c), husk + stray + drowned, whole');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
               '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
               '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
               '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js',
               '09b_sky.js', '07q_effects.js', '07zk_undead.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
initRegistry(MCL);
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });

const EL = MCL.EntityList, Ai = MCL.Ai, Spawn = MCL.Spawn, Ent = MCL.Entities;
const Un = MCL.Undead, W = MCL.World, S = MCL.States, R = MCL.Reg, Bh = MCL.Behave;
const Eq = MCL.Equip, Cb = MCL.Combat, IT = MCL.Items, Sky = MCL.Sky, ES = MCL.Effects;
const CH = MCL.CH, B = MCL.Biomes;

MCL.Entities.init();
Ent.attrs = MCL.DATA.entities.attrs;
W.init(1);
Bh.init(W);
EL.init();
Ai.init();
Spawn.init();
if (Cb && Cb.init) Cb.init();
if (Eq && Eq.init) Eq.init();
Sky.init();

for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}

ok(Un && Un.ready, 'NS.Undead did not load/ready');
ok(B && B.ready, 'the biome registry loaded (initRegistry)');

// ── 1. attributes/dimensions/motion ─────────────────────────────────────────────────────────
say('1. the jar-extracted entity table’s own rows for husk/stray/drowned');
{
  const hAt = Ent.attrsOf('husk'), sAt = Ent.attrsOf('stray'), dAt = Ent.attrsOf('drowned');
  ok(hAt && hAt.hp === 20 && Math.abs(hAt.dmg - 3) < 1e-6, `husk hp/dmg off the table -- got ${hAt && [hAt.hp, hAt.dmg]}`);
  ok(sAt && sAt.hp === 20 && Math.abs(sAt.dmg - 2) < 1e-6, `stray hp/dmg off the table -- got ${sAt && [sAt.hp, sAt.dmg]}`);
  ok(dAt && dAt.hp === 20 && Math.abs(dAt.dmg - 3) < 1e-6, `drowned hp/dmg off the table -- got ${dAt && [dAt.hp, dAt.dmg]}`);
  for (const t of ['husk', 'stray', 'drowned']) {
    ok(EL.canSpawn(t), `EL.canSpawn(${t}) is false -- the closed motion set refuses it`);
    const m = EL.motionFor(t);
    ok(m && Math.abs(m[0] - 0.08) < 1e-9 && Math.abs(m[1] - 0.98) < 1e-9, `motionFor(${t}) = ${m}, expected [0.08,0.98]`);
  }
  const tm = EL.motionFor('trident');
  ok(tm && tm.length === 2, `motionFor(trident) missing -- got ${tm}`);
}

// ── 2. EL.spawn wiring ──────────────────────────────────────────────────────────────────────
say('2. EL.spawn -- Ai.ROSTER wiring + Eq.MOB_BASE_ARMOR');
{
  // D-647: hold the dice high for this one spawn -- a ZombieEntity leader roll (a bonus to max
  // health) made this line flaky (55.57 seen s121).
  const rnd0 = Math.random; Math.random = () => 0.99;
  const h = EL.spawn('husk', 0, 64, 0, {});
  Math.random = rnd0;
  ok(!!h && !!h.ai, 'EL.spawn(husk) did not attach e.ai -- Ai.ROSTER.husk missing');
  ok(h.maxHealth === 20, `husk maxHealth ${h && h.maxHealth}, expected 20`);
  ok(Ai.ROSTER.husk === Ai.ROSTER.zombie, 'Ai.ROSTER.husk must be the SAME function reference as Ai.ROSTER.zombie');

  const s = EL.spawn('stray', 0, 64, 0, {});
  ok(!!s && !!s.ai, 'EL.spawn(stray) did not attach e.ai -- Ai.ROSTER.stray missing');
  ok(Ai.ROSTER.stray === Ai.ROSTER.skeleton, 'Ai.ROSTER.stray must be the SAME function reference as Ai.ROSTER.skeleton');

  const d = EL.spawn('drowned', 0, 64, 0, {});
  ok(!!d && !!d.ai, 'EL.spawn(drowned) did not attach e.ai -- Ai.ROSTER.drowned missing');
  ok(Ai.ROSTER.drowned !== Ai.ROSTER.zombie, 'drowned must NOT reuse zombie\'s own roster verbatim -- initCustomGoals is overridden');

  ok(Eq.MOB_BASE_ARMOR.husk === 2, `Eq.MOB_BASE_ARMOR.husk expected 2 (inherited ZombieEntity.createZombieAttributes) -- got ${Eq.MOB_BASE_ARMOR.husk}`);
  ok(Eq.MOB_BASE_ARMOR.drowned === 2, `Eq.MOB_BASE_ARMOR.drowned expected 2 -- got ${Eq.MOB_BASE_ARMOR.drowned}`);
  ok(Eq.MOB_BASE_ARMOR.stray === undefined, 'stray must NOT be in Eq.MOB_BASE_ARMOR -- AbstractSkeletonEntity never adds it');
  ok(Eq.WEAPON_FOR.stray === 'bow', `Eq.WEAPON_FOR.stray expected 'bow' -- got ${Eq.WEAPON_FOR.stray}`);
}

// ── 2b. zombified_piglin -- D-712 (session 141): was ZERO Ai.ROSTER entries (D-709, session
// 140, flagged not fixed) -- confirmed by grep, no goal selector at all, gravity only. Fixed:
// bespoke Ai.ROSTER.zombified_piglin (Angerable substrate: HurtByTargetGoal w/ same-type pack
// alert, AngryPlayerTargetGoal, UniversalAngerGoal triggerOthers=true), per
// `.decomp/net/minecraft/entity/mob/ZombifiedPiglinEntity.java`'s own `initCustomGoals()`.
say('2b. Ai.ROSTER.zombified_piglin -- D-712 wiring fix');
{
  // AngryPlayerTargetGoal/UniversalAngerGoal both read the module-internal `NS.Player` (== this
  // same MCL object every src file closes over, `src/00_ns.js`'s own `(function (NS) {...})(MCL)`
  // wrapper) -- a distinct real object here, matching commandcheck.mjs's own `NS.Player = P`
  // pattern, so an unhurt entity's `undefined lastHurtByEntity` can never accidentally === it.
  MCL.Player = { x: -9999, y: 64, z: -9999, type: 'player' };

  ok(typeof Ai.ROSTER.zombified_piglin === 'function', 'Ai.ROSTER.zombified_piglin must be a function -- was ZERO entries pre-D-712 (D-709)');
  const pg = EL.spawn('zombified_piglin', 0, 64, 0, {});
  ok(!!pg && !!pg.ai, 'EL.spawn(zombified_piglin) did not attach e.ai -- Ai.ROSTER.zombified_piglin missing/not wired');
  // 9 = 5 goalSelector (2 melee, 4 DestroyEgg #1296, 7 stroll, 8 lookAtPlayer, 8 lookAround #213) + 4 targetSelector (revenge, angry player, universal anger, #1246 anger passing)
  ok(pg.ai.entries.length === 9, `zombified_piglin goal count: expected 9 (5 goalSelector incl. inherited DestroyEgg #1296 + LookAround #213, 4 targetSelector incl. #1246 anger passing), got ${pg.ai && pg.ai.entries.length}`);
  ok(Ai.ROSTER.zombified_piglin !== Ai.ROSTER.zombie, 'zombified_piglin must NOT reuse zombie\'s own roster verbatim -- initCustomGoals is overridden (no player-attack-by-default, no door-break/village-move)');

  // an UNPROVOKED zombified piglin must not go hostile on its own (Angerable default: angerTime 0)
  const calm = EL.spawn('zombified_piglin', 10, 64, 10, {});
  for (const en of calm.ai.entries) { if (en.goal.canUse()) ok(false, `zombified_piglin unprovoked goal "${en.priority}/${en.flags}" fired canUse() true with no hurt/anger -- must stay passive`); }

  // hit it -- HurtByTargetGoal must acquire the attacker as e.target (RevengeGoal.setGroupRevenge, priority 1 TARGET)
  const victim = EL.spawn('zombified_piglin', 20, 64, 20, {});
  const attacker = { x: 20, y: 64, z: 20, type: 'player' };
  victim.lastHurtByEntity = attacker;
  victim.ai.tick();
  ok(victim.target === attacker, 'zombified_piglin hit by a player must target that attacker (HurtByTargetGoal/RevengeGoal)');

  // pack alert -- another nearby zombified_piglin (same type, untamed, no target of its own) must be alerted too
  const bystander = EL.spawn('zombified_piglin', 21, 64, 20, {});
  const victim2 = EL.spawn('zombified_piglin', 25, 64, 25, {});
  const attacker2 = { x: 25, y: 64, z: 25, type: 'player' };
  victim2.lastHurtByEntity = attacker2;
  const bystander2 = EL.spawn('zombified_piglin', 26, 64, 25, {});
  victim2.ai.tick();
  ok(bystander2.target === attacker2, 'RevengeGoal.setGroupRevenge() must alert OTHER nearby zombified piglins onto the same attacker (pack alert, matching Ai.ROSTER.wolf\'s own getPack shape)');

  // a hurt zombie (different type) standing just as close must NOT be alerted -- pack alert is same-type only
  const otherZombie = EL.spawn('zombie', 26, 64, 26, {});
  otherZombie.target = null;
  const victim3 = EL.spawn('zombified_piglin', 30, 64, 30, {});
  const attacker3 = { x: 30, y: 64, z: 30, type: 'player' };
  const nearZombie = EL.spawn('zombie', 31, 64, 30, {});
  nearZombie.target = null;
  victim3.lastHurtByEntity = attacker3;
  victim3.ai.tick();
  ok(nearZombie.target !== attacker3, 'a nearby ZOMBIE (different type) must NOT be pulled into a zombified_piglin\'s own group-revenge pack alert');
}

// ── 3. Spawn.RULES ──────────────────────────────────────────────────────────────────────────
say('3. Spawn.RULES.husk/.stray/.drowned');
{
  const sand = S.stateOf('sand') | 0, stone = S.stateOf('stone') | 0, water = S.stateOf('water') | 0;
  const powderSnow = S.stateOf('powder_snow') | 0, snowBlock = S.stateOf('snow_block') | 0;

  // husk: needs the zombie/skeleton dark gate PLUS sky-visible above.
  W.setBlock(0, 63, 0, sand);
  ok(typeof Spawn.RULES.husk === 'function' && Spawn.canPlace('husk'), 'Spawn.RULES.husk is not wired');
  const saveDark = W.getLight, saveSky = W.canSeeSky;
  W.getLight = () => 0; // fully dark: sky=0, block=0
  W.canSeeSky = () => true;
  ok(Spawn.RULES.husk(0, 64, 0, 'natural', () => 0) === true, 'dark + sky-visible must allow a husk to spawn');
  W.canSeeSky = () => false;
  okAv(Spawn.RULES.husk(0, 64, 0, 'natural', () => 0) === false, 'NOT sky-visible must refuse a husk (HuskEntity.canSpawn\'s own isSkyVisible half)');
  ok(Spawn.RULES.husk(0, 64, 0, 'spawner', () => 0) === true, 'a spawner-reason husk skips the sky-visible test entirely');

  // stray: same shape, but climbs through powder_snow first.
  W.canSeeSky = () => true;
  ok(typeof Spawn.RULES.stray === 'function' && Spawn.canPlace('stray'), 'Spawn.RULES.stray is not wired');
  ok(Spawn.RULES.stray(0, 64, 0, 'natural', () => 0) === true, 'dark + sky-visible must allow a stray to spawn (no powder snow above)');
  W.setBlock(0, 65, 0, powderSnow);
  let sawPowderSnowY = null;
  const realCanSeeSky = W.canSeeSky;
  W.canSeeSky = (x, y, z) => { sawPowderSnowY = y; return true; };
  ok(Spawn.RULES.stray(0, 64, 0, 'natural', () => 0) === true, 'a stray still spawns when the sky check is climbed above powder snow');
  ok(sawPowderSnowY === 65, `the sky check must run at the TOP powder-snow cell (65), not the spawn cell -- got ${sawPowderSnowY}`);
  W.setBlock(0, 65, 0, 0);
  W.canSeeSky = realCanSeeSky;
  W.getLight = saveDark; W.canSeeSky = saveSky;

  // drowned: fluid-below required, biome-gated roll, depth for non-river biomes.
  ok(typeof Spawn.RULES.drowned === 'function' && Spawn.canPlace('drowned'), 'Spawn.RULES.drowned is not wired');
  W.setBlock(1, 62, 0, water); // below
  W.setBlock(1, 63, 0, water); // at the position itself
  const saveGetLight2 = W.getLight;
  W.getLight = () => 0;
  const realBiomeAt = W.biomeAt;
  const riverIdx = B.indexOf['minecraft:river'];
  const plainsIdx = B.indexOf['minecraft:plains'];
  ok(riverIdx !== undefined, 'the biome registry has no minecraft:river entry to test against');
  W.biomeAt = () => riverIdx;
  ok(Spawn.RULES.drowned(1, 63, 0, 'natural', () => 0) === true, 'a river biome, nextInt(15)===0, must allow a drowned to spawn');
  okAv(Spawn.RULES.drowned(1, 63, 0, 'natural', () => 5) === false, 'a river biome with a NON-ZERO nextInt(15) roll must refuse -- the roll is really consulted');
  W.biomeAt = () => plainsIdx;
  W.setBlock(1, 20, 0, water); W.setBlock(1, 21, 0, water);
  ok(Spawn.RULES.drowned(1, 21, 0, 'natural', () => 0) === true, `a NON-river biome deep below sea level (y=21 < ${Spawn.SEA_LEVEL - 5}) with nextInt(40)===0 must allow a drowned`);
  okAv(Spawn.RULES.drowned(1, 63, 0, 'natural', () => 0) === false, `a non-river biome at y=63 (>= seaLevel-5) must refuse even with the roll -- isValidSpawnDepth really gates it`);
  W.setBlock(1, 62, 0, 0);
  okAv(Spawn.RULES.drowned(1, 63, 0, 'natural', () => 0) === false, 'no water below the position must refuse a drowned outright');
  W.biomeAt = realBiomeAt;
  W.getLight = saveGetLight2;
  W.setBlock(1, 62, 0, 0); W.setBlock(1, 63, 0, 0); W.setBlock(1, 20, 0, 0); W.setBlock(1, 21, 0, 0);
}
say(`   ${pass} ok`);

// ── 4. husk: Hunger on an unarmed hit ───────────────────────────────────────────────────────
say('4. husk -- Hunger on an unarmed melee hit (HuskEntity.tryAttack)');
{
  MCL.Survival = MCL.Survival || {};
  const hits = [];
  MCL.Survival.hurt = (t, cause, dmg) => { hits.push([cause, dmg]); return true; };
  const effects = [];
  const realAdd = ES.addStatusEffect;
  ES.addStatusEffect = (e, eff, dur, amp, ambient, show) => { effects.push([eff, dur, amp]); return realAdd(e, eff, dur, amp, ambient, show); };

  const mkTarget = () => ({ type: 'zombie', x: 0, y: 64, z: 0, maxHealth: 20, health: 20, invulnerableTime: 0, hurtTime: 0, lastHurt: 0 });
  const husk = { type: 'husk', x: 0, y: 64, z: 0, equip: [] };
  Cb.mobAttack(husk, mkTarget());
  ok(effects.length === 1 && effects[0][0] === 'hunger', `an unarmed husk hit must apply hunger -- got ${JSON.stringify(effects)}`);
  // getLocalDifficulty() is the RAW value: normal at day-time 0 is 2 * 0.75 = 1.5 (LocalDifficulty.java), and HuskEntity.java:57
  // is `140 * (int)$$2` -- truncated FIRST, so 140 * 1 = 140 (the real server: meleerefcheck husk@none), not 210.
  ok(effects[0][1] === 140, `at normal difficulty on day 0 (raw local difficulty 1.5), duration should be 140*(int)1.5 = 140 -- got ${effects[0][1]}`);

  effects.length = 0;
  const stack = Eq.stackOf('iron_sword');
  Eq.setEquipped(husk, IT.MAINHAND, stack);
  Cb.mobAttack(husk, mkTarget());
  okAv(effects.length === 0, 'a husk holding a weapon must NOT apply hunger (HuskEntity.tryAttack\'s own getMainHandStack().isEmpty() gate)');

  effects.length = 0;
  const zombie = { type: 'zombie', x: 0, y: 64, z: 0, equip: [] };
  Cb.mobAttack(zombie, mkTarget());
  okAv(effects.length === 0, 'a plain zombie hit must NOT apply hunger -- only husk does');

  ES.addStatusEffect = realAdd;
}

// ── 5. stray: tipped arrows ──────────────────────────────────────────────────────────────────
say('5. stray -- tipped arrows (createArrowProjectile\'s own Slowness(600))');
{
  EL.clear();
  const stray = EL.spawn('stray', 0, 70, 0, {});
  const target = { x: 5, y: 70, z: 0, width: 0.6, height: 1.8, maxHealth: 20, health: 20 };
  const arrow = Cb.mobShoot(stray, target);
  // s115: loop/tipped (D-618) moved the tip to `{ potionId, custom:[{effect,duration,amplifier}] }`
  // (14j_combat.js, Cb.applyArrowTip's own shape) — the stray's slowness is the one custom entry.
  const tipFx = arrow && arrow.tip && Array.isArray(arrow.tip.custom) ? arrow.tip.custom[0] : null;
  ok(!!tipFx && tipFx.effect === 'slowness', `a stray's own arrow must carry a slowness tip -- got ${arrow && JSON.stringify(arrow.tip)}`);
  ok(!!tipFx && tipFx.duration === 600, `slowness duration must be 600 ticks -- got ${tipFx && tipFx.duration}`);

  const zombieShooter = EL.spawn('zombie', 10, 70, 0, {});
  const arrow2 = Cb.mobShoot(zombieShooter, target);
  okAv(!arrow2.tip, 'a plain zombie/skeleton\'s own arrow must NOT carry a tip -- only stray does');

  // land the tipped arrow on a target and watch the effect actually apply.
  const effects2 = [];
  const realAdd2 = ES.addStatusEffect;
  ES.addStatusEffect = (e, eff, dur, amp, ambient, show) => { effects2.push([eff, dur]); return realAdd2(e, eff, dur, amp, ambient, show); };
  arrow.x = target.x; arrow.y = target.y; arrow.z = target.z; arrow.onGround = false;
  EL.list.push(target);
  Cb.tickArrow(arrow);
  ok(effects2.length === 1 && effects2[0][0] === 'slowness' && effects2[0][1] === 600, `a landed tipped-arrow hit must apply slowness(600) -- got ${JSON.stringify(effects2)}`);
  ES.addStatusEffect = realAdd2;
  EL.clear();
}

// ── 6. water conversion ─────────────────────────────────────────────────────────────────────
say('6. water conversion -- husk -> zombie, zombie -> drowned (600+300 ticks)');
{
  ok(Un.CONVERT_TARGET.zombie === 'drowned' && Un.CONVERT_TARGET.husk === 'zombie', 'Undead.CONVERT_TARGET must map zombie->drowned and husk->zombie');

  EL.clear();
  const husk = EL.spawn('husk', 0, 64, 0, {}); husk.convWarm = true;   // first tick of a fresh mob never sees the submerged state (baseTick lag)
  const realSubmerged = Un.isSubmergedInWater;
  Un.isSubmergedInWater = () => true;
  for (let i = 0; i < Un.WATER_SUBMERGE_TICKS - 1; i++) Un.tickWaterConversion(husk);
  ok(husk.convertCountdown === undefined, `the countdown must NOT start before ${Un.WATER_SUBMERGE_TICKS} full ticks -- got waterConvertTime=${husk.waterConvertTime}`);
  Un.tickWaterConversion(husk);
  ok(husk.convertCountdown === Un.WATER_CONVERT_COUNTDOWN_TICKS, `at exactly ${Un.WATER_SUBMERGE_TICKS} ticks the countdown must start at ${Un.WATER_CONVERT_COUNTDOWN_TICKS} -- got ${husk.convertCountdown}`);
  ok(husk.type === 'husk' && !husk.removed, 'the husk must not convert before the countdown finishes');
  // ZombieEntity.tick(): `ticksUntilWaterConversion--; if (< 0) convertInWater()` -- starting
  // at 300, it takes 301 DECREMENTS to go negative, not 300.
  for (let i = 0; i < Un.WATER_CONVERT_COUNTDOWN_TICKS + 1; i++) Un.tickWaterConversion(husk);
  ok(husk.removed === true, 'the original husk entity must be removed once conversion finishes');
  const converted = EL.list[EL.list.length - 1];
  ok(converted && converted.type === 'zombie', `the converted entity must be a zombie -- got ${converted && converted.type}`);

  EL.clear();
  const zombie = EL.spawn('zombie', 0, 64, 0, {}); zombie.convWarm = true;
  for (let i = 0; i < Un.WATER_SUBMERGE_TICKS; i++) Un.tickWaterConversion(zombie);
  for (let i = 0; i < Un.WATER_CONVERT_COUNTDOWN_TICKS + 1; i++) Un.tickWaterConversion(zombie);
  ok(zombie.removed === true, 'the original zombie must be removed once its own conversion finishes');
  const converted2 = EL.list[EL.list.length - 1];
  ok(converted2 && converted2.type === 'drowned', `zombie must convert to drowned -- got ${converted2 && converted2.type}`);
  // #5140: ZombieVillagerEntity.canConvertInWater() is false -- no row, and submersion never converts
  ok(Un.CONVERT_TARGET.zombie_villager === undefined, 'zombie_villager must have no CONVERT_TARGET row (canConvertInWater false)');
  EL.clear();
  const zvl = EL.spawn('zombie_villager', 0, 64, 0, {}); zvl.convWarm = true;
  Un.isSubmergedInWater = () => true;
  for (let i = 0; i < Un.WATER_SUBMERGE_TICKS + Un.WATER_CONVERT_COUNTDOWN_TICKS + 5; i++) Un.tickWaterConversion(zvl);
  ok(!zvl.removed && zvl.convertCountdown === undefined, 'a submerged zombie_villager must never start a drowned conversion');
  {
    const saved = Un.CONVERT_TARGET.zombie_villager;
    Un.CONVERT_TARGET.zombie_villager = 'drowned';
    const z2 = EL.spawn('zombie_villager', 0, 64, 0, {}); z2.convWarm = true;
    for (let i = 0; i < 700; i++) Un.tickWaterConversion(z2);
    okAv(z2.convertCountdown !== undefined, 'a zombie_villager row would convert (assertion would catch it)');
    if (saved === undefined) delete Un.CONVERT_TARGET.zombie_villager;
  }
  Un.isSubmergedInWater = realSubmerged;
  // skeleton -> stray in powder snow (SkeletonEntity.tick): 140 ticks, shaking, then 300+1, exit resets
  {
    EL.clear();
    W.setBlock(0, 64, 0, S.stateOf("powder_snow"));
    const sk = EL.spawn('skeleton', 0.5, 64, 0.5, {}); sk.convWarm = true;
    for (let i = 0; i < Un.POWDER_SNOW_TICKS - 1; i++) Un.tickStrayConversion(sk);
    ok(sk.strayConversionTime === undefined, 'skeleton: no conversion before 140 powder-snow ticks');
    Un.tickStrayConversion(sk);
    ok(sk.strayConversionTime === 300 && Un.isStrayConverting(sk), 'skeleton: conversion starts at 300 at tick 140 and shakes');
    for (let i = 0; i < 300; i++) Un.tickStrayConversion(sk);
    ok(!sk.removed, 'skeleton: not converted before the countdown goes negative');
    Un.tickStrayConversion(sk);
    ok(sk.removed === true && EL.list[EL.list.length - 1].type === 'stray', 'skeleton: becomes a stray at tick 140+301');
    EL.clear();
    const sk2 = EL.spawn('skeleton', 0.5, 64, 0.5, {}); sk2.convWarm = true;
    for (let i = 0; i < 100; i++) Un.tickStrayConversion(sk2);
    W.setBlock(0, 64, 0, 0); Un.tickStrayConversion(sk2);
    ok(sk2.inPowderSnowTime === -1, 'skeleton: leaving powder snow resets the timer');
    W.setBlock(0, 64, 0, S.stateOf("powder_snow"));
    for (let i = 0; i < 139; i++) Un.tickStrayConversion(sk2);
    ok(sk2.strayConversionTime === undefined, 'skeleton: reset timer needs a fresh 140 ticks');
    const keepIn = Un.isInPowderSnow; Un.isInPowderSnow = () => false;
    const sk3 = EL.spawn('skeleton', 0.5, 64, 0.5, {}); sk3.convWarm = true;
    for (let i = 0; i < 141; i++) Un.tickStrayConversion(sk3);
    okAv(sk3.strayConversionTime === undefined, 'a dead powder-snow test leaves the skeleton unconverting (assertion would catch it)');
    Un.isInPowderSnow = keepIn;
    // head-only powder snow (feet cell clear) counts, and the very first tick counts too
    W.setBlock(0, 64, 0, 0); W.setBlock(0, 65, 0, S.stateOf("powder_snow"));
    const sk4 = EL.spawn('skeleton', 0.5, 64, 0.5, {}); sk4.convWarm = true;
    Un.tickStrayConversion(sk4);
    ok(sk4.inPowderSnowTime === 1, `skeleton: head-cell powder snow counts from the first tick -- got ${sk4.inPowderSnowTime}`);
    W.setBlock(0, 65, 0, 0);
    W.setBlock(0, 64, 0, 0); EL.clear();
  }

  // #858: MobEntity.convertTo -- fresh health, carried name/persistence/AI/invulnerable/loot flag.
  {
    EL.clear();
    const h = EL.spawn('husk', 0, 64, 0, {});
    h.health = 5; h.customName = 'Bob'; h.persistent = true; h.aiDisabled = true; h.invulnerable = true; h.canPickUpLoot = true;
    const z = Un.convertInWater(h, 'zombie');
    ok(z && z.health === z.maxHealth, `converted mob must have full health -- got ${z && z.health}`);
    ok(z.customName === 'Bob', 'customName must carry');
    ok(z.persistent === true, 'persistent must carry');
    ok(z.aiDisabled === true, 'aiDisabled must carry');
    ok(z.invulnerable === true, 'invulnerable must carry');
    ok(z.canPickUpLoot === true, 'canPickUpLoot must carry');
    // #2782: setCanBreakDoors(shouldBreakDoors() && this.canBreakDoors()) -- a true flag carries too
    for (let i = 0; i < 20; i++) {
      const hd = EL.spawn('husk', 0, 64, 0, {}); hd.canBreakDoors = true;
      const zd = Un.convertInWater(hd, 'zombie');
      okAv(zd.canBreakDoors === true, 'a door-breaking husk must convert into a door-breaking zombie');
    }
    EL.clear();
    const h3 = EL.spawn('husk', 0, 64, 0, {});
    h3.aiDisabled = true;
    Un.isSubmergedInWater = () => true;
    for (let i = 0; i < 5; i++) Un.tickWaterConversion(h3);
    okAv(h3.waterConvertTime === undefined || h3.waterConvertTime === 0, 'an AI-disabled husk must not run the water timer');
    Un.isSubmergedInWater = realSubmerged;
    EL.clear();
  }

  // anti-vacuity: leaving the water resets the counter.
  EL.clear();
  const husk2 = EL.spawn('husk', 0, 64, 0, {});
  const realSub2 = Un.isSubmergedInWater;
  Un.isSubmergedInWater = () => true;
  for (let i = 0; i < 100; i++) Un.tickWaterConversion(husk2);
  Un.isSubmergedInWater = () => false;
  Un.tickWaterConversion(husk2);
  okAv(husk2.waterConvertTime === -1, 'stepping out of the water must reset waterConvertTime, not merely pause it');
  Un.isSubmergedInWater = realSub2;
  EL.clear();

  // conversion sound per source type: husk -> 1041, zombie -> 1040
  {
    const hadSound = MCL.Sound, got = [], real = hadSound && hadSound.entitySound;
    if (!MCL.Sound) MCL.Sound = {};
    const snd = MCL.Sound;
    snd.entitySound = (name) => { got.push(name); };
    for (const [src, want] of [['husk', 'entity.husk.converted_to_zombie'], ['zombie', 'entity.zombie.converted_to_drowned']]) {
      EL.clear(); got.length = 0;
      const m = EL.spawn(src, 0, 64, 0, {});
      Un.convertInWater(m, Un.CONVERT_TARGET[src]);
      okAv(got.length === 1 && got[0] === want, `${src} conversion must play ${want} -- got ${got.join(',')}`);
    }
    if (hadSound) snd.entitySound = real; else delete MCL.Sound;
    EL.clear();
  }

  // drowned/stray must NOT be in CONVERT_TARGET at all.
  okAv(Un.CONVERT_TARGET.drowned === undefined && Un.CONVERT_TARGET.stray === undefined,
    'drowned/stray must not themselves be convertible -- only zombie/husk are the SOURCE of a conversion');
}
say(`   ${pass} ok`);

// ── 7. drowned equipment ────────────────────────────────────────────────────────────────────
say('7. Eq.initDrowned -- probabilistic mainhand + separate offhand nautilus shell');
{
  // Eq.initDrowned calls r() in order: [0] weapon-chance gate (> 0.9), [1] the 0..16 roll
  // (only if [0] passed), then Eq.rollArmor (an UNKNOWN number of r() calls of its own),
  // [2] the SEPARATE offhand-shell gate (< 0.03), then Eq.updateEnchantments (more calls) --
  // rollArmor/updateEnchantments are stubbed to no-ops for this section so the exact SEQUENCE
  // under test stays exactly three calls long, not entangled with an unrelated goal's own
  // random consumption.
  const seq = (...vals) => { let i = 0; return () => vals[Math.min(i++, vals.length - 1)]; };
  const realRollArmor = Eq.rollArmor, realUpdateEnchant = Eq.updateEnchantments;
  Eq.rollArmor = function () {};
  Eq.updateEnchantments = function () {};

  let e = { type: 'drowned', equip: [] };
  Eq.initDrowned(e, seq(0.95, 0.0, 0.9));   // weapon: yes; roll floor(0*16)=0<10 -> trident; shell: no
  ok(Eq.getEquipped(e, IT.MAINHAND) && IT.nameOf(Eq.getEquipped(e, IT.MAINHAND).i) === 'trident', `roll<10/16 must equip a trident -- got ${Eq.getEquipped(e, IT.MAINHAND) && IT.nameOf(Eq.getEquipped(e, IT.MAINHAND).i)}`);

  e = { type: 'drowned', equip: [] };
  Eq.initDrowned(e, seq(0.95, 0.9, 0.9));   // weapon: yes; roll floor(0.9*16)=14>=10 -> fishing_rod; shell: no
  ok(Eq.getEquipped(e, IT.MAINHAND) && IT.nameOf(Eq.getEquipped(e, IT.MAINHAND).i) === 'fishing_rod', `roll>=10/16 must equip a fishing_rod -- got ${Eq.getEquipped(e, IT.MAINHAND) && IT.nameOf(Eq.getEquipped(e, IT.MAINHAND).i)}`);

  e = { type: 'drowned', equip: [] };
  Eq.initDrowned(e, seq(0.0, 0.9));         // weapon-chance gate fails (0.0 is not > 0.9): no roll call at all
  okAv(!Eq.getEquipped(e, IT.MAINHAND), 'a roll under the 10% weapon chance must leave the mainhand empty');

  // the offhand shell is a SEPARATE roll from the mainhand one -- no mainhand roll (chance
  // gate fails), then the offhand gate passes.
  e = { type: 'drowned', equip: [] };
  Eq.initDrowned(e, seq(0.0, 0.0));   // weapon gate fails (no roll call); shell gate 0.0 < 0.03 passes
  ok(Eq.getEquipped(e, IT.OFFHAND) && IT.nameOf(Eq.getEquipped(e, IT.OFFHAND).i) === 'nautilus_shell', `offhand should hold a nautilus_shell -- got ${Eq.getEquipped(e, IT.OFFHAND) && IT.nameOf(Eq.getEquipped(e, IT.OFFHAND).i)}`);

  ok(Eq.dropChance(e, IT.OFFHAND) === 2.0, 'drowned shell offhand drop chance is 2.0 (guaranteed)');
  okAv(Eq.dropEquipment(e, () => 0.99, false, 0).some(d => d.item === 'nautilus_shell'), 'shell drops on any death, even not killed by a player');

  e = { type: 'drowned', equip: [] };
  Eq.initDrowned(e, seq(0.0, 0.5));   // weapon gate fails; shell gate 0.5 >= 0.03 fails
  okAv(!Eq.getEquipped(e, IT.OFFHAND), 'a roll over the 3% shell chance must leave the offhand empty');

  Eq.rollArmor = realRollArmor;
  Eq.updateEnchantments = realUpdateEnchant;
}
say(`   ${pass} ok`);

// ── 8. drowned targeting ────────────────────────────────────────────────────────────────────
say('8. Undead.canDrownedAttackTarget / filterDrownedTargets');
{
  Sky.weather = Sky.newWeather();
  Sky.dayTime = 6000; // noon
  const dryPlayer = { x: 0, y: 64, z: 0, inWater: false };
  const wetPlayer = { x: 0, y: 64, z: 0, inWater: true };
  ok(Un.canDrownedAttackTarget(dryPlayer) === false, 'by day, a dry target must be unattackable');
  ok(Un.canDrownedAttackTarget(wetPlayer) === true, 'by day, a WET target must still be attackable');
  Sky.dayTime = 18000; // midnight
  ok(Un.canDrownedAttackTarget(dryPlayer) === true, 'at night, a dry target must be attackable');
  ok(Un.filterDrownedTargets(null, [dryPlayer, wetPlayer]).length === 2, 'at night both dry and wet targets pass the filter');
  Sky.dayTime = 6000;
  ok(Un.filterDrownedTargets(null, [dryPlayer, wetPlayer]).length === 1, 'by day only the wet target survives the filter');
  okAv(Un.canDrownedAttackTarget(null) === false, 'a null target must never be attackable');
}

// ── 9. drowned trident ranged attack ────────────────────────────────────────────────────────
say('9. Cb.mobShootTrident / Cb.tickTrident');
{
  EL.clear();
  const drowned = EL.spawn('drowned', 0, 70, 0, {});
  const target2 = { x: 8, y: 70, z: 0, width: 0.6, height: 1.8, maxHealth: 20, health: 20 };
  const trident = Cb.mobShootTrident(drowned, target2);
  ok(!!trident && trident.type === 'trident', `Cb.mobShootTrident must spawn a real trident entity -- got ${trident && trident.type}`);
  ok(trident.shooter === drowned, 'the trident must carry its own shooter');
  ok(trident.vx > 0, 'the trident must be launched TOWARD the target (+x)');

  trident.x = target2.x; trident.y = target2.y; trident.z = target2.z; trident.onGround = false;
  const before = target2.health;
  EL.list.push(target2);
  const hit = Cb.tickTrident(trident);
  ok(trident.dealtDamage === true && trident.removed !== true, 'a landed trident hit sets dealtDamage and stays as an entity (TridentEntity.onEntityHit, #2908)');
  EL.clear();

  okAv(Un.TRIDENT_ATTACK_RADIUS > 0, 'Undead.TRIDENT_ATTACK_RADIUS must be a real positive radius');
}
say(`   ${pass} ok`);

// ── 10. drowned water goals ─────────────────────────────────────────────────────────────────
say('10. Undead.GoToBeachGoal / SwimUpGoal / GoToWaterGoal -- canUse gating');
{
  Sky.dayTime = 6000; // day
  const eDay = { x: 0, y: 63, z: 0, inWater: true };
  const beachDay = new Un.GoToBeachGoal(eDay, 1.0);
  okAv(beachDay.canUse() === false, 'GoToBeachGoal must refuse by day even while touching water');
  const swimDay = new Un.SwimUpGoal(eDay, 1.0);
  okAv(swimDay.canUse() === false, 'SwimUpGoal must refuse by day even while touching water');
  const eDryDay = { x: 0, y: 63, z: 0, inWater: false };
  const waterGoalDay = new Un.GoToWaterGoal(eDryDay, 1.0, () => 0);
  ok(typeof waterGoalDay.canUse() === 'boolean', 'GoToWaterGoal.canUse must be evaluable by day, out of water');

  // D-712 undead deep-pass bugfix, live-caught: with NO water anywhere near the search area
  // (a walkable stone platform, no fluid within the 10-try 20x8x20 search box), canUse() must
  // actually reflect the failed search (false) -- NOT unconditionally return true and leave
  // the goal "running" with a null path, which permanently blocks the priority-7 plain wander
  // fallback (WaterAvoidingRandomStrollGoal) every tick and freezes the mob in place forever.
  // Mirrors vanilla's own MoveToTargetPosGoal.canStart(), which only starts on a found target.
  // A real (walkable, not floating) platform is needed for Ai.findPath to have anywhere to
  // route through at all -- a bare column of air has no ground for the A* graph to walk.
  const platStone = S.stateOf('stone') | 0, platWater = S.stateOf('water') | 0;
  for (let dx = -12; dx <= 12; dx++) for (let dz = -12; dz <= 12; dz++) {
    W.setBlock(dx, 62, dz, platStone);
    for (let dy = 63; dy <= 68; dy++) W.setBlock(dx, dy, dz, 0);
  }
  const eStranded = { x: 0.5, y: 63, z: 0.5, type: 'drowned', width: 0.6, height: 1.95, inWater: false };
  const waterGoalStranded = new Un.GoToWaterGoal(eStranded, 1.0, () => 0.4);
  okAv(waterGoalStranded.canUse() === false, 'GoToWaterGoal.canUse must return false (not freeze true) when the 10-try search finds no water at all');
  var fallbackCalls = 0;
  const fallback = new Ai.WaterAvoidingRandomStrollGoal(eStranded, 1.0, () => (fallbackCalls++ === 0 ? 0.001 : 0.4));
  const gsStranded = new Ai.GoalSelector();
  gsStranded.add(1, Ai.MOVE, waterGoalStranded);
  gsStranded.add(7, Ai.MOVE, fallback);
  gsStranded.tick();
  okAv(gsStranded.isRunning(fallback) === true, 'a stranded (no-water-nearby) drowned must fall back to the plain wander goal, not freeze with GoToWaterGoal holding the MOVE flag');

  // and the positive case: water actually present at the exact spot the fixed r()=0.4 search
  // lands on (bx+floor(0.4*20)-10, by+2-floor(0.4*8), bz+..) = (-2, 62, -2), reachable at
  // platform level, must be found and used -- canUse() true, not stuck refusing forever.
  W.setBlock(-2, 62, -2, platWater);
  const eNearWater = { x: 0.5, y: 63, z: 0.5, type: 'drowned', width: 0.6, height: 1.95, inWater: false };
  const waterGoalFound = new Un.GoToWaterGoal(eNearWater, 1.0, () => 0.4);
  ok(waterGoalFound.canUse() === true, 'GoToWaterGoal.canUse must return true when water IS within the search box and reachable');
  W.setBlock(-2, 62, -2, platStone);

  Sky.dayTime = 18000; // night
  const eNightWet = { x: 0, y: Spawn.SEA_LEVEL, z: 0, inWater: true };
  const beachNight = new Un.GoToBeachGoal(eNightWet, 1.0);
  ok(beachNight.canUse() === true, 'GoToBeachGoal must accept at night, touching water, y >= seaLevel-3');
  const eDeep = { x: 0, y: Spawn.SEA_LEVEL - 10, z: 0, inWater: true, type: 'drowned' };
  const swimNight = new Un.SwimUpGoal(eDeep, 1.0);
  ok(swimNight.canUse() === true, 'SwimUpGoal must accept at night, touching water, well below sea level');
  const beforeVy = eDeep.vy || 0;
  const wtr = S.stateOf('water') | 0;
  for (let dx = -5; dx <= 5; dx++) for (let dz = -5; dz <= 5; dz++) for (let y = Spawn.SEA_LEVEL - 20; y <= Spawn.SEA_LEVEL; y++) W.setBlock(dx, y, dz, wtr);   // SwimNavigation needs water to path through
  swimNight.tick();
  ok((eDeep.vy || 0) > beforeVy, 'SwimUpGoal.tick must nudge vy upward');
  const eDryNight = { x: 0, y: 63, z: 0, inWater: false };
  const waterGoalNight = new Un.GoToWaterGoal(eDryNight, 1.0, () => 0);
  okAv(waterGoalNight.canUse() === false, 'GoToWaterGoal must refuse at NIGHT (WanderAroundOnSurfaceGoal is a daytime-only goal)');
  Sky.dayTime = 6000;
}
say(`   ${pass} ok`);

// ── §R (s112) — zombie reinforcements + spawn attributes (ZombieEntity.java:274-316, :487-524) ──
say('§R zombie reinforcements');
{
  const seq = (a) => { let i = 0; return () => { if (i >= a.length) throw new Error('rnd exhausted at ' + i); return a[i++]; }; };
  const mk = (type) => ({ type, x: 0.5, y: 64, z: 0.5, maxHealth: 20, health: 20, knockbackResistance: 0 });
  // door 0.05 (<0.1), base 0.5→0.05, kb 0.4→0.02, follow 0.9→1.35 (>1), leader 0.01 (<0.05), +0.4*0.25+0.5, hb 0.5*3+1
  const z = mk('zombie');
  ok(Un.initZombieAttributes(z, seq([0.05, 0.5, 0.4, 0.9, 0.01, 0.4, 0.5]), 1) === true, 'initZombieAttributes runs for a zombie');
  ok(Math.abs(z.reinforceBase - 0.05) < 1e-12, 'initAttributes: spawn_reinforcements base = nextDouble()*0.1 (' + z.reinforceBase + ')');
  ok(Math.abs(z.knockbackResistance - 0.02) < 1e-12, '"Random spawn bonus": knockback_resistance += nextDouble()*0.05');
  ok(Math.abs(z.followRange - 35 * 2.35) < 1e-9, '"Random zombie-spawn bonus" 1.35 > 1: follow_range 35 MULTIPLY_TOTAL -> ' + z.followRange);
  ok(z.zombieLeader === true && Math.abs(z.reinforceMods - 0.6) < 1e-12, 'leader: spawn_reinforcements +[0.5,0.75) ADDITION');
  ok(Math.abs(z.maxHealth - 70) < 1e-9 && z.health === 20, 'leader: max_health x(1+[1,4)) = 70, current health stays 20');
  ok(z.canBreakDoors === true, 'leader: setCanBreakDoors(shouldBreakDoors())');
  ok(Math.abs(Un.spawnReinforcementsOf(z) - 0.65) < 1e-12, 'live spawn_reinforcements = base + modifiers');
  ok(Un.initZombieAttributes(z, seq([]), 1) === false, 'a zombie that already carries its attributes (a reload) is not re-rolled');
  // both directions: follow bonus <= 1 leaves follow_range alone; no leader above the roll
  const z0 = mk('zombie');
  Un.initZombieAttributes(z0, seq([0.5, 0.5, 0, 0.5, 0.5]), 1);
  ok(z0.followRange === 35 && z0.zombieLeader === false && z0.canBreakDoors === false && z0.maxHealth === 20,
     'a 0.75 follow bonus (<= 1) and a 0.5 leader roll change nothing');
  const d = mk('drowned');
  Un.initZombieAttributes(d, seq([0, 0.5, 0, 0, 0, 0, 0]), 1);
  ok(d.zombieLeader === true && d.canBreakDoors === false, 'drowned: shouldBreakDoors() is false — a leader drowned still cannot break doors');
  const pz = mk('zombified_piglin');
  Un.initZombieAttributes(pz, seq([0.5, 0.99, 0, 0.9]), 1);   // no nextDouble() for the base
  ok(pz.reinforceBase === 0, 'ZombifiedPiglinEntity.initAttributes: spawn_reinforcements base 0.0');
  // the clamped-local-difficulty stand-in is clamped to [0,1]: 0.06 is a leader roll only if clamped were 1.2+
  const zc = mk('zombie');
  Un.initZombieAttributes(zc, seq([0.5, 0.5, 0, 0, 0.06]), 1.5);
  ok(zc.zombieLeader === false, 'clamped difficulty is clamped to 1: a 0.06 leader roll fails at "1.5"');
  ok(Un.initZombieAttributes(mk('skeleton'), seq([]), 1) === false, 'a skeleton gets no zombie attributes');

  // ── ZombieEntity.damage ──
  const P = { x: 100, y: 64, z: 100 };
  const base = () => { const c = mk('zombie'); c.reinforceBase = 0.3; c.reinforceMods = 0; c.x = 0.5; c.z = 0.5; return c; };
  const spawned = [];
  const ctxOf = (o) => Object.assign({
    rnd: seq([0.1]), nextInt: (lo, hi) => (lo === -1 ? 1 : lo), isHard: () => true, doMobSpawning: () => true,
    players: () => [P], canPlace: () => true, clearAt: () => true,
    spawn: (t, x, y, zz) => { const n = { type: t, x, y, z: zz, maxHealth: 20, health: 20 }; spawned.push(n); return n; }
  }, o || {});
  const caller = base(); const tgt = { x: 5, y: 64, z: 5, maxHealth: 20 };
  caller.target = tgt;
  const r1 = Un.onZombieDamaged(caller, null, ctxOf({ rnd: seq([0.1, 0.5, 0.5, 0, 0.5, 0.5]) }));
  ok(r1 && r1.type === 'zombie' && r1.x === 7 && r1.y === 71 && r1.z === 7, 'HARD, 0.1 < 0.3: a ZOMBIE is placed at the integer corner +7*1 per axis (' + (r1 && [r1.x, r1.y, r1.z]) + ')');
  ok(r1 && r1.target === tgt, 'the reinforcement targets the caller\'s own target');
  ok(Math.abs(caller.reinforceMods + 0.05) < 1e-12, 'caller charge: spawn_reinforcements -0.05');
  ok(r1 && Math.abs(r1.reinforceBase - 0.05) < 1e-12 && r1.zombieLeader === false && Math.abs(r1.reinforceMods + 0.05) < 1e-12,
     'callee rolls its own attributes (base 0.05, no leader), then the -0.05 callee charge');
  const husk = base(); husk.type = 'husk'; husk.target = tgt;
  const rh = Un.onZombieDamaged(husk, null, ctxOf({ rnd: seq([0.1, 0.5, 0.5, 0, 0.5, 0.5]) }));
  ok(rh && rh.type === 'zombie', 'a HUSK calls a plain zombie (new ZombieEntity(world)), not a husk');
  ok(Un.onZombieDamaged(base(), null, ctxOf()) === null, 'no target and no attacker: no reinforcement');
  const byAtt = base();
  const ra = Un.onZombieDamaged(byAtt, tgt, ctxOf({ rnd: seq([0.1, 0.5, 0.5, 0, 0.5, 0.5]) }));
  ok(ra && ra.target === tgt, 'no target: DamageSource.getAttacker() stands in');
  const nh = base(); nh.target = tgt;
  ok(Un.onZombieDamaged(nh, null, ctxOf({ isHard: () => false })) === null && nh.reinforceMods === 0, 'NORMAL: no reinforcement, no charge');
  const hi = base(); hi.target = tgt;
  ok(Un.onZombieDamaged(hi, null, ctxOf({ rnd: seq([0.3]) })) === null, 'nextFloat 0.3 is not < 0.3: no reinforcement');
  const nm = base(); nm.target = tgt;
  ok(Un.onZombieDamaged(nm, null, ctxOf({ doMobSpawning: () => false })) === null, 'doMobSpawning false: no reinforcement');
  // a player within 7 of every candidate: 50 tries, none placed, no charge
  const near = base(); near.target = tgt;
  const nearP = { x: 7, y: 71, z: 7 };
  ok(Un.onZombieDamaged(near, null, ctxOf({ players: () => [nearP] })) === null && near.reinforceMods === 0,
     'a player within 7 blocks of the spot refuses it (and no charge is paid)');
  {
    // #5317: the box is at the integer corner (x-0.3..x+0.3), so a block in cell x-1 blocks it
    const stone = S.stateOf('stone'), water = S.stateOf('water');
    const probe = (blk, bx) => { W.setBlock(bx, 64, 0, blk); W.setBlock(bx, 65, 0, blk); const r = Un.reinforcementClear(null, 0, 64, 0); W.setBlock(bx, 64, 0, 0); W.setBlock(bx, 65, 0, 0); return r; };
    ok(probe(stone, -1) === false, 'reinforcement: stone in the neighbour cell the corner box overlaps refuses');
    ok(probe(water, -1) === false, 'reinforcement: water in the neighbour cell refuses (containsFluid)');
    ok(probe(stone, 1) === true, 'reinforcement: stone outside the corner box accepts');
    okAv(probe(stone, -1) !== probe(stone, 1), 'neighbour-cell probe discriminates');
  }
  let tries = 0;
  const cnt = base(); cnt.target = tgt;
  Un.onZombieDamaged(cnt, null, ctxOf({ canPlace: () => { tries++; return false; } }));
  ok(tries === 50, 'exactly 50 placement tries (' + tries + ')');

  // ── live wiring: EL.spawn rolls the attributes; Cb.hurt calls the reinforcement ──
  const zl = EL.spawn('zombie', 0.5, 70, 0.5);
  ok(zl && zl.reinforceBase !== undefined && zl.followRange >= 35, 'EL.spawn(zombie) rolls the spawn attributes');
  const Diff = MCL.Diff, keepD = Diff.get(), keepReady = Spawn.ready, keepCP = Spawn.checkPlacement, keepClear = Un.reinforcementClear;
  Diff.set('hard'); Spawn.ready = true; Spawn.checkPlacement = () => true; Un.reinforcementClear = () => true;
  zl.reinforceBase = 1; zl.reinforceMods = 0; zl.target = { x: 30, y: 70, z: 30, maxHealth: 20 };
  const before = EL.list.length;
  Cb.hurt(zl, 1, 0, false);
  ok(EL.list.length === before + 1 && EL.list[EL.list.length - 1].type === 'zombie', 'Cb.hurt on a HARD zombie with spawn_reinforcements 1 spawns a reinforcement');
  zl.invulnerableTime = 0; zl.reinforceBase = 0; zl.reinforceMods = 0;
  const b2 = EL.list.length; Cb.hurt(zl, 1, 0, false);
  ok(EL.list.length === b2, 'spawn_reinforcements 0: Cb.hurt spawns nothing');
  // the joins: Ai.followRangeOf reads the per-entity follow range; BreakDoorGoal honours canBreakDoors
  ok(Ai.followRangeOf({ type: 'zombie', followRange: 82.25 }) === 82.25 && Ai.followRangeOf({ type: 'zombie' }) === 35,
     'Ai.followRangeOf reads a zombie\'s rolled follow_range, else the type\'s 35');
  const doorAt = () => ({ closed: true, iron: false });
  const mkDoorZ = (cbd) => ({ type: 'zombie', x: 0.5, y: 64, z: 0.5, canBreakDoors: cbd, target: { x: 3, y: 64, z: 3 } });
  const gNo = new Ai.BreakDoorGoal(mkDoorZ(false), { isHard: () => true, doorAt, mobGriefing: () => true });
  const gYes = new Ai.BreakDoorGoal(mkDoorZ(true), { isHard: () => true, doorAt, mobGriefing: () => true });
  ok(gNo.canUse() === false && gYes.canUse() === true, 'BreakDoorGoal: only a zombie that rolled canBreakDoors breaks doors (both directions)');
  // anti-vacuity: break the charge and the -0.05 assertion must catch it
  const keepCharge = Un.REINFORCE_CHARGE; Un.REINFORCE_CHARGE = 0;
  const br = base(); br.target = tgt;
  Un.onZombieDamaged(br, null, ctxOf({ rnd: seq([0.1, 0.5, 0.5, 0, 0.5, 0.5]) }));
  okAv(!(Math.abs(br.reinforceMods + 0.05) < 1e-12), 'a zeroed caller charge is caught by the -0.05 assertion');
  Un.REINFORCE_CHARGE = keepCharge;
  // anti-vacuity: break the HARD gate (always true) — the NORMAL assertion must catch it
  const bn = base(); bn.target = tgt;
  const leak = Un.onZombieDamaged(bn, null, ctxOf({ isHard: () => true, rnd: seq([0.1, 0.5, 0.5, 0, 0.5, 0.5]) }));
  okAv(leak !== null, 'a HARD gate that always passes is caught (NORMAL would have spawned)');
  Diff.set(keepD); Spawn.ready = keepReady; Spawn.checkPlacement = keepCP; Un.reinforcementClear = keepClear;
  EL.list.length = 0;
}
say(`   ${pass} ok`);

// ── 12. #994 drowned swimming: updateSwimming / DrownedMoveControl / travel ────────────────
say('12. drowned swim state, move control, travel');
{
  const tgt = { x: 4, y: 70, z: 0, inWater: true };
  const mk = () => ({ type: 'drowned', x: 0.5, y: 70, z: 0.5, yaw: 0, vx: 0, vy: 0, vz: 0, inWater: true, onGround: false,
                      width: 0.6, height: 1.95, target: tgt, navigating: true, navNode: { x: 4, y: 72, z: 0 } });
  const e = mk();
  Un.tickSwim(e);
  ok(e.swimming === true, 'drowned touching water with a water target is swimming (navigation swap)');
  ok(Math.abs(e.leaningPitch - 0.09) < 1e-6, 'leaningPitch rises 0.09 a tick');
  ok(e.vy > 0 && e.vx > 0, 'move control nudges velocity toward the target (vx, and +0.002 up for a target above)');
  ok(Math.abs(e.yaw) > 0.1 && e.yBodyRot === e.yaw, 'yaw turns toward the target and bodyYaw = yaw');
  const y0 = e.y; Un.travelSwim(e);
  ok(e.y > y0 && Math.abs(e.vx) < Math.abs(0.9 * e.vx / 0.9) + 1e-9, 'DrownedEntity.travel moves by velocity');
  ok(e.swimPitch < 0, 'swim pose pitches the body toward a rising velocity');
  const dry = mk(); dry.inWater = false; dry.target = { x: 4, y: 70, z: 0, inWater: false };
  Un.tickSwim(dry);
  ok(dry.swimming === false && dry.leaningPitch === 0, 'out of water: not swimming, no lean');
  ok(dry.vy < 0, 'off ground and not swimming: -0.008 sink');
  okAv(!(dry.swimming === true), 'a dry drowned is caught if the swim flag ignored inWater');
  const dry2 = mk(); dry2.target = { x: 4, y: 70, z: 0, inWater: false };
  Un.tickSwim(dry2);
  ok(dry2.swimming === false, 'a water drowned with a dry target does not swim');
  okAv(dry2.swimming === false, 'a swim flag ignoring the target is caught');
  const idle = mk(); idle.navigating = false; Un.tickSwim(idle);
  ok(idle.mobSpeed === 0, 'no path: movement speed zero');
  okAv(Un.isTargetingUnderwater({ target: null }) === false, 'no target is not targeting underwater');
  const keep = Un.isTargetingUnderwater; Un.isTargetingUnderwater = () => true;
  const forced = mk(); forced.target = null; forced.navNode = { x: 4, y: 70, z: 0 }; Un.tickSwim(forced);
  okAv(forced.swimming === true, 'a forced-underwater stub flips the flag (check sees it)');
  Un.isTargetingUnderwater = keep;
  ok(EL.DEFAULTS && true, 'defaults present');
  const z = EL.spawn('drowned', 0.5, 70, 0.5); ok(z && z.stepHeight === 1.0, 'drowned stepHeight 1.0');
  okAv(!z || z.stepHeight !== 0.6, 'drowned keeps the 1.0 step, not the 0.6 default');
  EL.list.length = 0;
}
// 12. submerged test: Entity.updateSubmergedInWaterState table (eyeY - 1/9 sample, fluid height)
{
  const water = (l) => S.withProp(S.stateOf('water'), R.PROP.level, R.PVAL[String(l)]);
  const wlSlab = S.withProp(S.stateOf('oak_slab'), R.PROP.waterlogged, R.PVAL['true']);
  const dryStone = S.stateOf('stone');
  const mkWorld = (cells) => (x, y, z) => cells[y] || 0;
  const vanilla = (eyeY, cells) => {   // independent re-statement of the formula
    const sy = eyeY - 1 / 9, by = Math.floor(sy), c = cells[by];
    if (!c) return false;
    const up = cells[by + 1];
    const wet = (t) => t && (S.block[t] === R.id.water || S.waterIn[t] === 1);
    if (!wet(c)) return false;
    const h = wet(up) ? 1 : (S.block[c] === R.id.water ? (Bh.fluidLevel(c) >= 8 ? 8 : 8 - Bh.fluidLevel(c)) / 9 : 8 / 9);
    return by + h > sy;
  };
  const cases = [
    [70.5, { 70: water(0) }], [70.95, { 70: water(0) }], [71.0, { 70: water(0) }], [70.9, { 70: water(0) }],
    [70.5, { 70: water(6) }], [70.2, { 70: water(6) }], [70.5, { 70: wlSlab }],
    [70.5, { 70: wlSlab, 71: water(0) }], [70.5, { 70: dryStone }], [70.5, {}],
  ];
  for (const [eyeY, cells] of cases) {
    const want = vanilla(eyeY, cells);
    const got = Un.submergedAt(1.5, eyeY, 1.5, mkWorld(cells));
    ok(got === want, `submergedAt(eyeY=${eyeY}) = ${want} per the vanilla formula (got ${got})`);
  }
  ok(Un.submergedAt(1.5, 71.0, 1.5, mkWorld({ 70: water(0) })) === false, 'eye exactly at 70+8/9+1/9 is not submerged');
  ok(Un.submergedAt(1.5, 70.95, 1.5, mkWorld({ 70: water(0) })) === true, 'eye in [Y+h, Y+h+1/9) still counts (offset)');
  ok(Un.submergedAt(1.5, 70.3, 1.5, mkWorld({ 70: water(6) })) === true, 'shallow flowing level: sample below its height counts');
  ok(Un.submergedAt(1.5, 70.5, 1.5, mkWorld({ 70: water(6) })) === false, 'shallow flowing level: sample above its height does not');
  ok(Un.submergedAt(1.5, 70.5, 1.5, mkWorld({ 70: wlSlab })) === true, 'waterlogged slab counts');
  ok(Un.submergedAt(1.5, 70.9, 1.5, mkWorld({ 70: water(6), 71: water(0) })) === true, 'water above makes the cell full height');
  // anti-vacuity: dropping the 1/9 offset, or the height, flips a case
  const noOff = (x, eyeY, z, g) => Un.submergedAt(x, eyeY + 1 / 9, z, g);
  okAv(noOff(1.5, 70.95, 1.5, mkWorld({ 70: water(0) })) !== Un.submergedAt(1.5, 70.95, 1.5, mkWorld({ 70: water(0) })), 'dropping the 1/9 offset is caught');
  const noH = (eyeY, cells) => { const by = Math.floor(eyeY - 1 / 9); return !!cells[by]; };
  okAv(noH(70.5, { 70: water(6) }) !== Un.submergedAt(1.5, 70.5, 1.5, mkWorld({ 70: water(6) })), 'ignoring fluid height is caught');
  okAv(noH(70.5, { 70: dryStone }) === true, 'a block-present-only test would call stone water (caught)');
}
say(`   ${pass} ok`);

// ── 12. skeleton.canFreeze() = false (.decomp SkeletonEntity.java:91), FREEZE_IMMUNE tag unchanged ──
{
  const sk = EL.spawn('skeleton', 0, 64, 0, {}), zb = EL.spawn('zombie', 4, 64, 0, {});
  const was = Un.isInPowderSnow; Un.isInPowderSnow = () => true;
  ok(Ai.shouldEscapePowderSnow(sk) === false, 'skeleton never escapes powder snow (canFreeze false)');
  ok(!Ai.FREEZE_IMMUNE.skeleton && Object.keys(Ai.FREEZE_IMMUNE).sort().join() === 'polar_bear,snow_golem,stray', 'FREEZE_IMMUNE tag stays stray/polar_bear/snow_golem');
  okAv(Ai.shouldEscapePowderSnow(zb) === true, 'a zombie in powder snow does escape (check can fail)');
  Un.isInPowderSnow = was;
  const tps = Cb.tickPowderSnow; Cb.tickPowderSnow = (m) => { m.inPowderSnow = true; };
  for (const m of [sk, zb]) { m.frozenTicks = 0; for (let i = 0; i < 200; i++) { m.age = i; EL.tickHazards(m); } }
  Cb.tickPowderSnow = tps;
  ok(sk.frozenTicks === 0, 'skeleton frozenTicks stays 0 in powder snow (got ' + sk.frozenTicks + ')');
  okAv(zb.frozenTicks > 0, 'zombie accumulates frozenTicks in the same loop (check can fail)');
}

// 13. AbstractSkeletonEntity.tickRiding: rider bodyYaw = PathAwareEntity vehicle's
{
  for (const t of ['skeleton', 'stray', 'wither_skeleton']) {
    const sp = EL.spawn('spider', 0, 64, 0, {}), sk = EL.spawn(t, 0, 64, 0, {});
    sp.yBodyRot = 1.234; sk.yBodyRot = 0.5;
    Un.placePassenger(sp, sk);
    ok(sk.yBodyRot === sp.yBodyRot, t + ' rider yBodyRot follows the spider after placePassenger');
    const zb = EL.spawn('zombie', 0, 64, 0, {}); zb.yBodyRot = 0.5;
    Un.placePassenger(sp, zb);
    okAv(zb.yBodyRot === 0.5 && sk.yBodyRot !== 0.5, 'a zombie rider keeps its own yBodyRot (check can fail)');
  }
  EL.list.length = 0;
}

console.log('================ undeadcheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
console.log('==============================================');
console.log(`undeadcheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
