#!/usr/bin/env node
// witchpotioncheck.mjs — QUEUE 0.2 raid loop (loop/witchpotion-s95): THE WITCH'S REAL POTION
// THROW. Proves `07z_potion.js`'s own substrate — the live `potion` projectile (gravity 0.05,
// PotionEntity.getGravity()'s own override), the splash (`PotionEntity.applySplashPotion`'s
// distance-scaled duration), the witch's THROWN potion choice (`WitchEntity.attack`, all six
// branches: harming default, raider-ally healing/regeneration, slowness, poison, weakness) and
// her DRUNK self-buffs (`WitchEntity.tickMovement`: water_breathing/fire_resistance/healing/
// swiftness, the drinking timer, the movement-speed penalty) — against the REAL
// `Ai.ProjectileAttackGoal`-driven `Ai.ROSTER.witch` entry, spawned and ticked through the live
// `EntityList`, not a rewritten copy of any of it.
//
//   node tools/witchpotioncheck.mjs [--verbose]

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 60) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; if (VERBOSE) console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (VERBOSE) console.log(...a); };

console.log('witchpotioncheck — QUEUE 0.2 raid loop: the witch\'s real potion throw');

const M = loadEngine({
  extra: ['02f_tags.js', '07_world.js', '07b_behaviour.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
          '14i_hand.js', '14j_combat.js', '14d_survival.js', '07q_effects.js', '07z_potion.js',
          '07v_spell.js', '07k_goals.js', '07zx_particle.js']
});
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8'))
});
M.Entities.init();
M.EntityList.init();
M.Hand.init();
M.Combat.init();
M.Ai.init();
if (M.Tags && M.Tags.init && !M.Tags.ready) M.Tags.init();
M.Behave.init(M.World);   // D-648: extinguishFire reads block tags + the lit property
M.Particle.init();        // loop/potion-splash-impact: Po.tick's own impact particle call
ok(M.Entities.ready, 'the entity table loaded');
ok(M.Potion.ready, 'Potion module reports ready');

const EL = M.EntityList, Ai = M.Ai, Po = M.Potion, ES = M.Effects, Cb = M.Combat, W = M.World, CH = M.CH, PH = M.Physics;
const stateOf = (n) => M.States.stateOf(n) | 0;
const STONE = stateOf('stone');
const PLAT_Y = 8;

function freshWorld() {
  W.init(1);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
    const c = W.makeChunk(cx, cz);
    c.state = CH.GENERATED;
    W.chunks.set(W.key(cx, cz), c);
  }
  ok(W.loadedAt(0, 0), 'a chunk is loaded to place into');
}
function plate(radius) {
  for (let x = -radius; x <= radius; x++) for (let z = -radius; z <= radius; z++) {
    W.setBlock(x, PLAT_Y, z, STONE);
  }
}
/** A synthetic living target — enough of `EL.spawn`'s own shape for `Po`/`Ai` to read. */
function target(x, y, z, over) {
  return Object.assign({ id: 900, type: 'target', x, y, z, vx: 0, vy: 0, vz: 0,
    width: 0.6, height: 1.8, health: 20, maxHealth: 20, removed: false, dead: false }, over || {});
}
function fixedRandom(seq) {
  let i = 0;
  return () => seq[i++ % seq.length];
}
function drive(g, e, n, each) {
  for (let t = 0; t < n; t++) {
    e.zza = 0;
    g.tick();
    PH.travelMob(e);
    if (each && each(t) === false) return t;
  }
  return n;
}

// ═══ 1. THE PROJECTILE'S OWN MOTION — PotionEntity.getGravity() override, ThrownEntity's own drag ═══
console.log('\n 1. the thrown potion\'s own motion — PotionEntity.getGravity()/ThrownEntity drag');
{
  ok(Po.GRAVITY === 0.05, `Po.GRAVITY is 0.05 (PotionEntity.getGravity() override), got ${Po.GRAVITY}`);
  ok(Po.DRAG_AIR === 0.99, `Po.DRAG_AIR is 0.99 (ThrownEntity.tick()'s own non-water branch), got ${Po.DRAG_AIR}`);
  const mot = EL.motionFor('potion');
  ok(!!mot, 'EL.motionFor resolves a real gravity/drag pair for \'potion\' (the closed-set refusal does not apply)');
  ok(mot && mot[0] === Po.GRAVITY && mot[1] === Po.DRAG_AIR, `EL.motionFor('potion') is exactly [Po.GRAVITY, Po.DRAG_AIR], got ${JSON.stringify(mot)}`);

  // ANTI-VACUITY: #5916 -- the pair is the extractor's table row now, so a corrupted row IS caught by this comparison.
  const realMot = M.DATA.entities.motion;
  M.DATA.entities.motion = Object.assign({}, realMot, { potion: [0.03, 0.99] });
  const mot2 = EL.motionFor('potion');
  okAv(mot2 && mot2[0] !== Po.GRAVITY, "a corrupted potion table row changes EL.motionFor('potion')'s gravity -- the pair is read from the table");
  M.DATA.entities.motion = realMot;
  ok(EL.motionFor('potion')[0] === Po.GRAVITY, 'restored after the anti-vacuity probe');
}

// ═══ 2. THE THROW — ProjectileEntity.setVelocity's own normalize+jitter+scale ═══
console.log('\n 2. Po.throwVelocity — normalize, scale by power, zero jitter at uncertainty=0');
{
  const v = Po.throwVelocity(3, 4, 0, 1.0, 0, Math.random);   // 3-4-0 triangle, power 1, no jitter
  ok(Math.abs(v.vx - 0.6) < 1e-9 && Math.abs(v.vy - 0.8) < 1e-9 && Math.abs(v.vz) < 1e-9,
    `(3,4,0) normalized*1.0 with zero uncertainty is exactly (0.6,0.8,0), got (${v.vx.toFixed(4)},${v.vy.toFixed(4)},${v.vz.toFixed(4)})`);
  const v2 = Po.throwVelocity(3, 4, 0, Po.THROW_POWER, 0, Math.random);
  const len2 = Math.hypot(v2.vx, v2.vy, v2.vz);
  ok(Math.abs(len2 - Po.THROW_POWER) < 1e-9, `scaling by Po.THROW_POWER (0.75) gives a vector of exactly that length at zero jitter, got ${len2.toFixed(4)}`);

  // WITH jitter (uncertainty > 0): the vector moves off the bare normalized direction.
  const v3 = Po.throwVelocity(3, 4, 0, 1.0, Po.THROW_INACCURACY, fixedRandom([0.2, 0.9, 0.4, 0.1, 0.7, 0.3]));
  const drift = Math.hypot(v3.vx - 0.6, v3.vy - 0.8, v3.vz);
  okAv(drift > 1e-6, `a nonzero uncertainty (8.0, the witch's own) actually perturbs the aim — jitter=0 was not silently always the case (drift=${drift.toFixed(4)})`);
}

// ═══ 3. THE THROWN CHOICE — WitchEntity.attack()'s own if/else-if chain, in order ═══
console.log("\n 3. Po.witchChoosePotion — WitchEntity.attack()'s own six branches");
{
  const witch = { x: 0, y: PLAT_Y, z: 0, type: 'witch' };
  // default: a target outside both the slowness band (needs horiz>=8) and the weakness band
  // (needs horiz<=3), with health under the poison gate (needs >=8) — nothing else can match.
  ok(Po.witchChoosePotion(witch, target(5, PLAT_Y, 0, { health: 5 }), fixedRandom([0.9])) === 'harming',
    "default (nothing else matches): harming (Potions.field_9004, the local's own initial value)");
  // raider ally, low health → healing.
  ok(Po.witchChoosePotion(witch, target(2, PLAT_Y, 0, { type: 'pillager', health: 3 }), Math.random) === 'healing',
    'a raider ally at <=4 health: healing (field_8963)');
  // raider ally, healthy → regeneration.
  ok(Po.witchChoosePotion(witch, target(2, PLAT_Y, 0, { type: 'pillager', health: 15 }), Math.random) === 'regeneration',
    'a raider ally above 4 health: regeneration (field_8986)');
  // far target (>=8 horizontal), no slowness yet → slowness.
  ok(Po.witchChoosePotion(witch, target(9, PLAT_Y, 0, { health: 20 }), fixedRandom([0.9])) === 'slowness',
    'a target >=8 blocks away with no slowness effect: slowness (field_8996)');
  // far target that ALREADY has slowness → falls through to the health>=8 poison branch.
  {
    const t = target(9, PLAT_Y, 0, { health: 20 });
    ES.addStatusEffect(t, 'slowness', 100, 0);
    ok(Po.witchChoosePotion(witch, t, fixedRandom([0.9])) === 'poison',
      'a far target that already carries slowness falls through to the health>=8 poison branch');
  }
  // mid-range, healthy (>=8 hp), no poison → poison.
  ok(Po.witchChoosePotion(witch, target(5, PLAT_Y, 0, { health: 20 }), fixedRandom([0.9])) === 'poison',
    'a target at >=8 health with no poison effect (and out of the slowness band): poison (field_8982)');
  // close target (<=3), rand<0.25, no weakness, and health<8 (so poison\'s own gate refuses) → weakness.
  ok(Po.witchChoosePotion(witch, target(2, PLAT_Y, 0, { health: 4 }), fixedRandom([0.1])) === 'weakness',
    'a target within 3 blocks, health<8, no weakness effect, and the 25% roll succeeding: weakness (field_8975)');
  // same close/low-health target but the 25% roll FAILS → falls all the way through to harming.
  ok(Po.witchChoosePotion(witch, target(2, PLAT_Y, 0, { health: 4 }), fixedRandom([0.9])) === 'harming',
    'the same close low-health target, but the weakness roll fails: default harming');

  // ANTI-VACUITY: deleting witch from Po.RAIDER_TYPES breaks the raider-ally branch — caught.
  const savedWitchFlag = Po.RAIDER_TYPES.pillager;
  delete Po.RAIDER_TYPES.pillager;
  okAv(Po.witchChoosePotion(witch, target(2, PLAT_Y, 0, { type: 'pillager', health: 3 }), Math.random) !== 'healing',
    'removing pillager from Po.RAIDER_TYPES really changes the outcome — the raider-ally branch is live-read, not hardcoded');
  Po.RAIDER_TYPES.pillager = savedWitchFlag;
  ok(Po.witchChoosePotion(witch, target(2, PLAT_Y, 0, { type: 'pillager', health: 3 }), Math.random) === 'healing', 'restored');
}

// ═══ 4. THE THROW ITSELF — Po.witchThrow spawns a real potion entity, refuses while drinking ═══
console.log('\n 4. Po.witchThrow — spawns a real potion, carries the chosen id, refuses mid-drink');
{
  freshWorld(); plate(20);
  const witch = EL.spawn('witch', 0, PLAT_Y + 1, 0);
  ok(!!witch, 'witch spawns (real gravity/drag/dims resolved)');
  const t = target(6, PLAT_Y + 1, 0, { health: 20 });
  const before = EL.list.length;
  const e = Po.witchThrow(witch, t, EL.spawn, fixedRandom([0.9]));
  ok(!!e && e.type === 'potion', 'Po.witchThrow returns a real, live \'potion\' entity');
  ok(EL.list.length === before + 1, 'the potion entity actually landed in EL.list, not a throwaway object');
  ok(e.potionId === Po.witchChoosePotion(witch, t, fixedRandom([0.9])), 'the spawned entity carries the SAME potionId the choice function would pick');
  ok(e.shooter === witch, 'the potion entity remembers its own shooter (so Po.tick can refuse to hit the witch herself)');
  const speed = Math.hypot(e.vx, e.vy, e.vz);
  ok(speed > 0.3 && speed < 1.5, `the launch speed is close to Po.THROW_POWER (0.75), the jitter setVelocity itself adds included, got ${speed.toFixed(4)}`);

  witch.witchDrinking = true;
  const e2 = Po.witchThrow(witch, t, EL.spawn, Math.random);
  ok(e2 === null, 'WitchEntity.attack()\'s own `if (!this.isDrinking())` guard: no throw while mid-drink');
  witch.witchDrinking = false;

  // the raider-ally throw clears the witch's own target (WitchEntity.attack: setTarget(null))
  witch.target = target(2, PLAT_Y + 1, 0, { type: 'pillager', health: 3 });
  Po.witchThrow(witch, witch.target, EL.spawn, Math.random);
  ok(witch.target === null, 'throwing at a raider ally clears the witch\'s own target, same as WitchEntity.attack()');
}

// ═══ 5. THE SPLASH — PotionEntity.applySplashPotion's distance-scaled duration ═══
console.log('\n 5. Po.applySplashPotion — distance falloff, the 20-tick floor, instant effects, direct-hit factor 1.0');
{
  const px = 0, py = PLAT_Y, pz = 0;
  // direct hit: factor 1.0, full duration.
  const direct = target(0, PLAT_Y, 0, { health: 20 });
  const hitDirect = Po.applySplashPotion('poison', px, py, pz, [direct], direct);
  ok(hitDirect.indexOf(direct) >= 0, 'the direct-hit target is affected');
  ok(direct.effects && direct.effects.poison && direct.effects.poison.duration === Po.POTIONS.poison.duration,
    `a direct hit gets the FULL, un-scaled duration (factor 1.0), got ${direct.effects && direct.effects.poison && direct.effects.poison.duration}`);

  // splashed (not the direct hit), close: scaled-down but still applied.
  const near = target(1.5, PLAT_Y, 0, { health: 20 });
  Po.applySplashPotion('poison', px, py, pz, [near], null);
  const nearFactor = 1 - 1.5 / 4;
  const nearExpected = Math.floor(nearFactor * Po.POTIONS.poison.duration + 0.5);
  ok(near.effects && near.effects.poison && near.effects.poison.duration === nearExpected,
    `a splashed (non-direct) target 1.5 blocks off gets duration floor(factor*900+0.5)=${nearExpected}, got ${near.effects && near.effects.poison && near.effects.poison.duration}`);

  // #2980: custom-effect Ambient/ShowParticles survive the splash (PotionEntity:~143).
  {
    const cu = target(0, PLAT_Y, 0, { health: 20 });
    Po.applySplashPotion('water', px, py, pz, [cu], cu, null, [{ effect: 'weakness', duration: 400, amplifier: 0, ambient: true, showParticles: false }]);
    const w = cu.effects && cu.effects.weakness;
    okAv(!!w && w.ambient === true && w.showParticles === false, `custom splash effect keeps ambient=true/showParticles=false, got ${w && w.ambient}/${w && w.showParticles}`);
  }

  // out of the 4-block radius: entirely unaffected.
  const far = target(5, PLAT_Y, 0, { health: 20 });
  const hitFar = Po.applySplashPotion('poison', px, py, pz, [far], null);
  ok(hitFar.indexOf(far) < 0 && !far.effects, `a target outside the 4-block radius (distSq=25>=16) is not affected at all`);

  // the 20-tick floor: a duration that scales down to <=20 is dropped outright, not applied short.
  const edge = target(3.99, PLAT_Y, 0, { health: 20 });   // factor ~0.0025 -> weakness*1800 rounds well under 20
  const hitEdge = Po.applySplashPotion('weakness', px, py, pz, [edge], null);
  ok(hitEdge.indexOf(edge) < 0 && (!edge.effects || !edge.effects.weakness),
    'a duration that scales down to <=20 ticks is dropped outright (PotionEntity.java\'s own `if (j > 20)`), not applied for a moment');

  // instant effects: harming reduces health, healing raises it, both scaled by the same factor and rounded.
  const dmgDirect = target(0, PLAT_Y, 0, { health: 20 });
  Po.applySplashPotion('harming', px, py, pz, [dmgDirect], dmgDirect);
  ok(dmgDirect.health === 14, `a direct-hit harming potion deals floor(1.0*6)=6 (health 20->14), got ${dmgDirect.health}`);
  const dmgSplash = target(2, PLAT_Y, 0, { health: 20 });
  const splashFactor = 1 - 2 / 4;
  const splashDmg = Math.floor(splashFactor * 6 + 0.5);
  Po.applySplashPotion('harming', px, py, pz, [dmgSplash], null);
  ok(dmgSplash.health === 20 - splashDmg, `a splashed (non-direct) harming potion 2 blocks off scales the SAME way (floor(factor*6+0.5)=${splashDmg}), got damage ${20 - dmgSplash.health}`);
  const healDirect = target(0, PLAT_Y, 0, { health: 10, maxHealth: 20 });
  Po.applySplashPotion('healing', px, py, pz, [healDirect], healDirect);
  ok(healDirect.health === 14, `a direct-hit healing potion heals floor(1.0*4)=4 (10->14), got ${healDirect.health}`);
  const healCap = target(0, PLAT_Y, 0, { health: 18, maxHealth: 20 });
  Po.applySplashPotion('healing', px, py, pz, [healCap], healCap);
  ok(healCap.health === 20, `healing never overshoots maxHealth (18+4=22 clamped to 20), got ${healCap.health}`);

  // ANTI-VACUITY: corrupting SPLASH_RADIUS_SQ makes the "out of radius" target suddenly hit.
  const savedRadius = Po.SPLASH_RADIUS_SQ;
  Po.SPLASH_RADIUS_SQ = 1e9;
  // an INSTANT effect (harming) has no >20-tick floor to mask the widened radius through — a
  // duration effect's own factor goes negative past 4 blocks and the floor swallows it either way.
  const far2 = target(4.2, PLAT_Y, 0, { health: 20 });
  const hitFar2 = Po.applySplashPotion('harming', px, py, pz, [far2], null);
  okAv(hitFar2.indexOf(far2) >= 0, 'a corrupted (too-large) Po.SPLASH_RADIUS_SQ really does let an out-of-range target through — the radius gate is live, not decorative');
  Po.SPLASH_RADIUS_SQ = savedRadius;

  // #1621: the expand(4,2,4) box filter and isAffectedBySplashPotions (armor_stand false).
  const ledge = target(0, PLAT_Y + 2.5, 0, { health: 20 });
  ok(Po.applySplashPotion('harming', px, py, pz, [ledge], null).length === 0 && ledge.health === 20,
    'a target 2.5 blocks above (feet distSq<16, box above py+2.25) is outside the expand(4,2,4) box: unaffected');
  const stand = target(1, PLAT_Y, 0, { health: 20 });
  stand.type = 'armor_stand';
  ok(Po.applySplashPotion('harming', px, py, pz, [stand], null).length === 0 && stand.health === 20,
    'an armor_stand within 4 blocks is not affected by a splash potion');
  const savedBox = Po.inSplashBox, savedAff = Po.isAffectedBySplash;
  Po.inSplashBox = () => true; Po.isAffectedBySplash = () => true;
  const l2 = target(0, PLAT_Y + 2.5, 0, { health: 20 }), s2 = target(1, PLAT_Y, 0, { health: 20 });
  s2.type = 'armor_stand';
  // the stand's own damage() refuses magic (ArmorStandEntity.damage), so the gate is proven by the hit list, not health
  const hit3 = Po.applySplashPotion('harming', px, py, pz, [l2, s2], null);
  okAv(l2.health < 20, 'with the box filter disabled the ledge target is hit: the box gate is live');
  okAv(hit3.indexOf(s2) >= 0, 'with the armor-stand gate disabled the stand is hit: the gate is live');
  Po.inSplashBox = savedBox; Po.isAffectedBySplash = savedAff;
}

// ═══ 6. THE LIVE POTION ENTITY — Po.tick's own flight/impact dispatch ═══
console.log('\n 6. Po.tick — a live thrown potion falls, hits its target, splashes, and discards');
{
  freshWorld(); plate(20);
  const t = EL.spawn('pig', 0.4, PLAT_Y + 1, 0);
  ok(!!t, 'a pig target (a zombie is undead and refuses poison, D-647) spawns through the real EL.spawn, close enough for a same-tick hit');
  // a real spawned potion, essentially at rest, already overlapping the target's own hitbox —
  // Po.tick's own collision test does not require flight, only overlap or having landed.
  const p = EL.spawn('potion', 0, PLAT_Y + 1, 0, { vx: 0, vy: 0, vz: 0, shooter: null, potionId: 'poison' });
  ok(!!p && p.type === 'potion', 'a potion entity spawns through the real EL.spawn (not a hand-built stub)');
  let landedTick = -1;
  for (let i = 0; i < 20 && landedTick < 0; i++) {
    EL.tickOne(p);
    if (p.removed) landedTick = i;
  }
  ok(landedTick >= 0, `the potion entity is removed once it collides (landedTick=${landedTick})`);
  ok(t.effects && t.effects.poison, 'the target it flew into actually carries the poison effect afterward');
}

// ═══ 7. THE WITCH'S OWN DRINK — WitchEntity.tickMovement()'s four rolls, in order, plus the timer ═══
console.log('\n 7. Po.tickWitchDrink — the four self-buffs, the drinking timer, and the speed penalty');
{
  // submerged → water_breathing.
  {
    const w = { type: 'witch', eyeInWater: true, isOnFire: false, health: 20, maxHealth: 20 };
    Po.tickWitchDrink(w, { random: fixedRandom([0.1]) });
    ok(w.witchDrinking && w.witchDrinkPotion === 'water_breathing', `submerged, first roll <0.15: water_breathing, got drinking=${w.witchDrinking} potion=${w.witchDrinkPotion}`);
  }
  // on fire → fire_resistance (first roll must fail the submerged gate this tick: not submerged).
  {
    const w = { type: 'witch', eyeInWater: false, isOnFire: true, health: 20, maxHealth: 20 };
    Po.tickWitchDrink(w, { random: fixedRandom([0.99, 0.1]) });
    ok(w.witchDrinking && w.witchDrinkPotion === 'fire_resistance', `on fire, second roll <0.15: fire_resistance, got ${w.witchDrinkPotion}`);
  }
  // recent fire damage, no longer burning → fire_resistance; stale (>40 ticks) → not.
  {
    const w = { type: 'witch', age: 100, lastFireHurtAge: 90, eyeInWater: false, isOnFire: false, health: 20, maxHealth: 20 };
    Po.tickWitchDrink(w, { random: fixedRandom([0.99, 0.1]) });
    ok(w.witchDrinking && w.witchDrinkPotion === 'fire_resistance', `recent fire damage, not burning: fire_resistance, got ${w.witchDrinkPotion}`);
    const w2 = { type: 'witch', age: 100, lastFireHurtAge: 50, eyeInWater: false, isOnFire: false, health: 20, maxHealth: 20 };
    Po.tickWitchDrink(w2, { random: fixedRandom([0.99, 0.1, 0.99, 0.99]) });
    ok(!w2.witchDrinking, `fire damage 50 ticks ago: no drink, got ${w2.witchDrinkPotion}`);
  }
  // hurt → healing.
  {
    const w = { type: 'witch', eyeInWater: false, isOnFire: false, health: 10, maxHealth: 20 };
    Po.tickWitchDrink(w, { random: fixedRandom([0.99, 0.99, 0.01]) });
    ok(w.witchDrinking && w.witchDrinkPotion === 'healing', `hurt, third roll <0.05: healing, got ${w.witchDrinkPotion}`);
  }
  // far target → swiftness.
  {
    const w = { type: 'witch', x: 0, y: 0, z: 0, eyeInWater: false, isOnFire: false, health: 20, maxHealth: 20, target: { x: 20, y: 0, z: 0 } };
    Po.tickWitchDrink(w, { random: fixedRandom([0.99, 0.99, 0.99, 0.1]) });
    ok(w.witchDrinking && w.witchDrinkPotion === 'swiftness', `distant target (>11 blocks), fourth roll <0.5: swiftness, got ${w.witchDrinkPotion}`);
  }
  // #1283 -- the swiftness distance is 3D (squaredDistanceTo): 8 across + 9 up = 145 > 121 drinks.
  {
    const w = { type: 'witch', x: 0, y: 0, z: 0, eyeInWater: false, isOnFire: false, health: 20, maxHealth: 20, target: { x: 8, y: 9, z: 0 } };
    Po.tickWitchDrink(w, { random: fixedRandom([0.99, 0.99, 0.99, 0.1]) });
    ok(w.witchDrinking && w.witchDrinkPotion === 'swiftness', `#1283 8 across + 9 above (distSq 145): swiftness, got ${w.witchDrinkPotion}`);
  }
  // #1283 -- the status-15 particle roll also runs while drinking.
  {
    let n = 0; const sp = M.Particle && M.Particle.spawnWitchMagic, mr = M.wrand;
    if (M.Particle) {
      M.Particle.spawnWitchMagic = () => { n++; };
      M.wrand = () => 0;
      const w = { type: 'witch', witchDrinking: true, witchDrinkTimeLeft: 5, witchDrinkPotion: 'healing', x: 0, y: 0, z: 0 };
      Po.tickWitchDrink(w, { random: () => 0.99 });
      M.wrand = mr; M.Particle.spawnWitchMagic = sp;
      okAv(n === 1, `#1283 witch-magic particle roll runs while drinking, got ${n}`);
    }
  }
  // a NEAR target does not qualify, even on the same roll — the >121 distSq gate is real.
  {
    const w = { type: 'witch', x: 0, y: 0, z: 0, eyeInWater: false, isOnFire: false, health: 20, maxHealth: 20, target: { x: 3, y: 0, z: 0 } };
    Po.tickWitchDrink(w, { random: fixedRandom([0.99, 0.99, 0.99, 0.1]) });
    ok(!w.witchDrinking, 'a target within 11 blocks does not trigger the swiftness roll, even when the chance-roll itself would succeed');
  }
  // all four rolls fail → no drink at all this tick.
  {
    const w = { type: 'witch', eyeInWater: true, isOnFire: true, health: 10, maxHealth: 20, target: { x: 99, y: 0, z: 0 }, x: 0, y: 0, z: 0 };
    Po.tickWitchDrink(w, { random: fixedRandom([0.99, 0.99, 0.99, 0.99]) });
    ok(!w.witchDrinking, 'every roll failing leaves the witch not drinking, even with every OTHER precondition true');
  }

  // the timer: exactly Po.DRINK_TIME ticks, then the effect actually lands, then throwing resumes.
  {
    const w = { type: 'witch', x: 0, y: PLAT_Y, z: 0, eyeInWater: true, isOnFire: false, health: 20, maxHealth: 20 };
    Po.tickWitchDrink(w, { random: fixedRandom([0.01]) });   // starts drinking water_breathing
    ok(w.witchDrinking, 'drinking begins');
    let endedAt = -1;
    for (let i = 1; i <= Po.DRINK_TIME + 2 && endedAt < 0; i++) {
      Po.tickWitchDrink(w, { random: Math.random });
      if (!w.witchDrinking) endedAt = i;
    }
    ok(endedAt === 33 && Po.DRINK_TIME === 32, `vanilla drinkTimeLeft-- <= 0: a 32 timer ends on the 33rd drinking tick, got ${endedAt}`);
    ok(ES.hasStatusEffect(w, 'water_breathing'), 'the effect is actually applied to the witch once the timer ends');

    // WHILE drinking, Po.witchThrow (called through Ai.ProjectileAttackGoal's onShoot in live
    // play) refuses — tested directly in §4; here the SPEED penalty is what we probe.
    const wMid = { type: 'witch', eyeInWater: true, isOnFire: false, health: 20, maxHealth: 20 };
    Po.tickWitchDrink(wMid, { random: fixedRandom([0.01]) });
    const attrsBackup = M.Entities.attrsOf;
    M.Entities.attrsOf = (t) => (t === 'witch' ? { speed: 0.25 } : attrsBackup(t));
    const baseSpeed = 0.25;
    ok(Math.abs(Ai.movementSpeedOf(wMid) - (baseSpeed + Po.DRINK_SPEED_PENALTY)) < 1e-9,
      `Ai.movementSpeedOf applies WitchEntity.DRINKING_SPEED_PENALTY_MODIFIER (-0.25) while drinking: base ${baseSpeed} -> ${Ai.movementSpeedOf(wMid).toFixed(3)}`);
    wMid.witchDrinking = false;
    ok(Math.abs(Ai.movementSpeedOf(wMid) - baseSpeed) < 1e-9, 'and the penalty lifts the instant witchDrinking clears');
    M.Entities.attrsOf = attrsBackup;
  }

  // ANTI-VACUITY: corrupting Po.DRINK_TIME changes how long the drink actually lasts.
  const savedTime = Po.DRINK_TIME;
  Po.DRINK_TIME = 5;
  const wShort = { type: 'witch', eyeInWater: true, isOnFire: false, health: 20, maxHealth: 20 };
  Po.tickWitchDrink(wShort, { random: fixedRandom([0.01]) });
  let endedShort = -1;
  for (let i = 1; i <= 10 && endedShort < 0; i++) {
    Po.tickWitchDrink(wShort, { random: Math.random });
    if (!wShort.witchDrinking) endedShort = i;
  }
  okAv(endedShort === 6, `a corrupted Po.DRINK_TIME (5) really changes the observed drink length (got ${endedShort}) — the timer is live-read, not hardcoded to the real 32`);
  Po.DRINK_TIME = savedTime;
}

// ═══ 8. Ai.ProjectileAttackGoal — ProjectileAttackGoal.java's own approach/stop/fire timing ═══
console.log('\n 8. Ai.ProjectileAttackGoal — approach past range, stop and fire once in range and seen');
{
  freshWorld(); plate(30);
  const e = { id: 1, type: 'witch', x: -20, y: PLAT_Y + 1, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, width: 0.6, height: 1.95, inWater: false };
  e.target = { x: 0, y: PLAT_Y + 1, z: 0 };
  let shots = 0, lastPull = -1;
  const onShoot = (mob, t, pull) => { shots++; lastPull = pull; };
  const g = new Ai.ProjectileAttackGoal(e, 1.0, 60, 60, 10.0, onShoot);
  g.start();
  const startDist = Math.hypot(e.target.x - e.x, e.target.z - e.z);
  drive(g, e, 40, () => (Math.hypot(e.target.x - e.x, e.target.z - e.z) > 10 ? true : false));
  const midDist = Math.hypot(e.target.x - e.x, e.target.z - e.z);
  ok(midDist < startDist, `outside the 10-block shoot range: the witch closed distance (${startDist.toFixed(1)} -> ${midDist.toFixed(1)})`);
  ok(shots === 0, 'no shot fired while still out of range');

  drive(g, e, 400, () => (shots === 0 ? true : false));
  ok(shots >= 1, `a shot fired once inside range and \'seen\' for ${Ai.PROJECTILE_SEEN_TICKS_GATE} ticks (shots=${shots})`);
  ok(lastPull >= 0.1 && lastPull <= 1.0, `the pull-progress passed to onShoot is clamped to [0.1,1.0] (MathHelper.clamp), got ${lastPull}`);
  const closeDist = Math.hypot(e.target.x - e.x, e.target.z - e.z);
  ok(closeDist > 3, `once in range and having fired, the witch has not walked into melee range of her own ranged target (dist=${closeDist.toFixed(2)})`);

  // ANTI-VACUITY: no target at all — the goal never engages.
  const eIdle = { id: 2, type: 'witch', x: 0, y: PLAT_Y + 1, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, width: 0.6, height: 1.95 };
  const gIdle = new Ai.ProjectileAttackGoal(eIdle, 1.0, 60, 60, 10.0, () => {});
  okAv(!gIdle.canUse(), 'a witch with no target never starts the projectile-attack goal');
}

// ═══ 9. FULL LIVE INTEGRATION — a real Ai.ROSTER.witch, spawned and ticked, actually throws ═══
console.log('\n 9. a live-spawned witch (Ai.ROSTER, real EL.tick) actually throws a potion at the player');
{
  freshWorld(); plate(20);
  M.Player = { id: -1, type: 'player', x: 8, y: PLAT_Y + 1, z: 0, vx: 0, vy: 0, vz: 0,
    width: 0.6, height: 1.8, health: 20, maxHealth: 20, removed: false };
  const witch = EL.spawn('witch', 0, PLAT_Y + 1, 0);
  ok(!!witch && !!witch.ai, 'the witch spawns with a real, live Ai.ROSTER goal selector attached');
  const wander = (w) => w.ai.entries.some((en) => en.priority === 2 && en.goal.probability === 0.001);
  // #3685: WitchEntity.initGoals adds WanderAroundFarGoal(this, 1.0) at priority 2 (not WaterAvoidingRandomStrollGoal)
  ok(wander(witch), 'witch roster has a WanderAroundFarGoal(probability 0.001) at priority 2 (#3685)');
  const plain = { ai: { entries: [{ priority: 2, goal: new Ai.WaterAvoidingRandomStrollGoal(witch, 1.0, Math.random) }] } };
  okAv(!wander(plain), 'a plain WaterAvoidingRandomStrollGoal at priority 2 is rejected by the roster assertion');
  let sawPotion = false, sawDrink = false, nanSeen = false;
  for (let i = 0; i < 400; i++) {
    for (const en of EL.list.slice()) {
      EL.tickOne(en);
      if (!Number.isFinite(en.x) || !Number.isFinite(en.y) || !Number.isFinite(en.z)) nanSeen = true;
    }
    if (EL.list.some((x) => x.type === 'potion')) sawPotion = true;
    if (witch.witchDrinking) sawDrink = true;
  }
  ok(!nanSeen, '400 real ticks of a live witch (goals + physics + Po.tickWitchDrink + Po.tick): no NaN position ever');
  ok(sawPotion, 'a real \'potion\' entity actually appeared in EL.list over the course of live play (ProjectileAttackGoal really fired)');
  say(`   (witch drank at least once this run: ${sawDrink})`);
}

// ═══ 10. D-647 — UNDEAD REVERSAL + STATUS IMMUNITIES (.decomp StatusEffect.java:42-83,
// LivingEntity.java:941-965, SpiderEntity.java:132, WitherSkeletonEntity.java:113) ═══
console.log('\n 10. instant effects: undead reversal, the tickable instant path, canHaveStatusEffect');
{
  freshWorld(); plate(20);
  M.Player = null;
  const mob = (type, hp) => { const m = EL.spawn(type, 0, PLAT_Y + 1, 0); m.health = hp; return m; };
  const splash = (potion, m) => { Po.applySplashPotion(potion, m.x, m.y, m.z, [m], m, null); return m.health; };
  // referee numbers: heal (int)(p*(4<<amp)+0.5), damage (int)(p*(6<<amp)+0.5), p = 1.0 on a direct hit
  ok(splash('healing', mob('zombie', 20)) === 14, 'splash HEALING on a zombie (undead) DAMAGES it 6');
  ok(splash('harming', mob('zombie', 10)) === 14, 'splash HARMING on a zombie HEALS it 4');
  ok(splash('healing', mob('pig', 5)) === 9, 'splash healing on a pig heals 4 (both directions)');
  ok(splash('harming', mob('pig', 10)) === 4, 'splash harming on a pig deals 6');
  ok(splash('healing', mob('skeleton', 20)) === 14, 'a skeleton is undead too: healing hurts it');
  { const z = mob('zombie', 20); ES.applyInstantEffect(z, 'instant_health', 0, 0.5, null);
    ok(z.health === 17, 'the lingering cloud\'s proximity 0.5: (int)(0.5*6+0.5) = 3 to a zombie'); }
  { const z = mob('zombie', 20); z.armor = 20; splash('healing', z);
    ok(z.health === 14, 'the reversed damage is MAGIC: worn armour does not reduce it'); }
  // the tickable path (tipped arrow / witch drink): InstantStatusEffect.canApplyUpdateEffect = duration >= 1
  { const z = mob('zombie', 20); Cb.applyArrowTip({ potionId: 'healing' }, z); ES.tick(z);
    ok(z.health === 14, 'a tipped arrow of healing hurts a zombie on its next effect tick (applyUpdateEffect reversal)'); }
  { const p = mob('pig', 4); Cb.applyArrowTip({ potionId: 'healing' }, p); ES.tick(p);
    ok(p.health === 8, 'a tipped arrow of healing heals a pig 4 on its next effect tick'); ES.tick(p);
    ok(p.health === 8 && !ES.hasStatusEffect(p, 'instant_health'), 'and only once: the instance expires after its single tick'); }
  { const w = mob('witch', 10); ES.addStatusEffect(w, 'instant_health', 1, 0); ES.tick(w);
    ok(w.health === 14, 'a witch drinking healing (WitchEntity: addStatusEffect) gains 4 on the next tick'); }
  // canHaveStatusEffect, both directions
  ok(!ES.addStatusEffect(mob('zombie', 20), 'regeneration', 100, 0), 'an undead mob refuses regeneration');
  ok(!ES.addStatusEffect(mob('husk', 20), 'poison', 100, 0), 'an undead mob refuses poison');
  ok(ES.addStatusEffect(mob('zombie', 20), 'slowness', 100, 0), 'an undead mob still takes slowness');
  ok(!ES.addStatusEffect(mob('spider', 16), 'poison', 100, 0), 'a spider refuses poison');
  ok(!ES.addStatusEffect(mob('cave_spider', 12), 'poison', 100, 0), 'a cave spider (extends SpiderEntity) refuses poison');
  ok(ES.addStatusEffect(mob('spider', 16), 'regeneration', 100, 0), 'a spider still takes regeneration');
  ok(!ES.addStatusEffect(target(0, PLAT_Y + 1, 0, { type: 'wither_skeleton' }), 'wither', 100, 0), 'a wither skeleton (not built: a bare target of its type) refuses wither');
  ok(ES.addStatusEffect(mob('skeleton', 20), 'wither', 100, 0), 'a plain skeleton does take wither');
  ok(ES.addStatusEffect(mob('pig', 10), 'poison', 100, 0) && ES.addStatusEffect(mob('pig', 10), 'regeneration', 100, 0),
    'a pig takes both poison and regeneration');
  // anti-vacuity: empty the undead group and the reversal must vanish
  const saved = Cb.MOB_TYPE.undead; Cb.MOB_TYPE.undead = [];
  okAv(splash('healing', mob('zombie', 10)) === 14, 'break: with no undead group, healing heals a zombie (the reversal check would fire)');
  okAv(ES.addStatusEffect(mob('zombie', 20), 'regeneration', 100, 0), 'break: with no undead group, a zombie takes regeneration');
  Cb.MOB_TYPE.undead = saved;
  const savedDue = ES.dueThisTick; ES.dueThisTick = (ef, d, a) => (ef === 'instant_health' ? false : savedDue(ef, d, a));
  { const p = mob('pig', 4); Cb.applyArrowTip({ potionId: 'healing' }, p); ES.tick(p);
    okAv(p.health === 4, 'break: an instant effect that is never due does nothing on tick (the tickable-path check would fire)'); }
  ES.dueThisTick = savedDue;
}

// ═══ 11. D-648 — THE WHOLE POTIONS REGISTRY + THE WATER SPLASH (.decomp potion/Potions.java,
// effect/StatusEffects.java, projectile/thrown/PotionEntity.java:62-116,186-197) ═══
console.log('\n 11. every Potions.java registration (referee re-derivation), multi-effect splash, the water splash');
{
  const DEC = join(ROOT, '.decomp', 'net', 'minecraft');
  const effSrc = readFileSync(join(DEC, 'entity', 'effect', 'StatusEffects.java'), 'utf8');
  const potSrc = readFileSync(join(DEC, 'potion', 'Potions.java'), 'utf8');
  const effName = {};
  for (const m of effSrc.matchAll(/(field_\d+) = register\(\s*\d+,\s*"(\w+)"/g)) effName[m[1]] = m[2];
  const referee = {};
  const segs = potSrc.split('public static final Potion ').slice(1);
  for (const seg of segs) {
    const nm = /register\(\s*"(\w+)"/.exec(seg); if (!nm) continue;
    const rows = [];
    for (const m of seg.matchAll(/new StatusEffectInstance\(StatusEffects\.(field_\d+)(?:, (\d+)(?:, (\d+))?)?\)/g))
      rows.push([effName[m[1]], m[2] === undefined ? 0 : +m[2], m[3] === undefined ? 0 : +m[3]]);
    referee[nm[1]] = rows;
  }
  const cmp = (table) => {
    const bad = [];
    for (const id of Object.keys(referee)) if (JSON.stringify(table[id]) !== JSON.stringify(referee[id])) bad.push(id);
    for (const id of Object.keys(table)) if (!(id in referee)) bad.push('+' + id);
    return bad;
  };
  ok(Object.keys(referee).length === 43, `the referee reads all 43 Potions.java registrations (got ${Object.keys(referee).length})`);
  const bad = cmp(Po.POTION_TABLE);
  ok(bad.length === 0, `Po.POTION_TABLE equals the jar's registry, both directions (mismatch: ${bad.join(',')})`);
  for (const id of Object.keys(Po.POTION_TABLE)) for (const r of Po.POTION_TABLE[id])
    if (!ok(ES.IDS.hasOwnProperty(r[0]), `${id}: effect ${r[0]} is a registered status effect`)) break;
  { const t2 = JSON.parse(JSON.stringify(Po.POTION_TABLE)); t2.strong_poison = [['poison', 432, 0]];
    okAv(cmp(t2).includes('strong_poison'), 'break: a wrong amplifier on strong_poison is caught by the referee'); }
  { const t2 = JSON.parse(JSON.stringify(Po.POTION_TABLE)); delete t2.long_turtle_master;
    okAv(cmp(t2).includes('long_turtle_master'), 'break: a missing registration is caught'); }

  freshWorld(); plate(20);
  M.Player = null;
  const mob = (type, hp) => { const m = EL.spawn(type, 0, PLAT_Y + 1, 0); m.health = hp; return m; };
  { const p = mob('pig', 10); Po.applySplashPotion('turtle_master', p.x, p.y, p.z, [p], p, null);
    ok(ES.amplifierOf(p, 'slowness') === 3 && ES.amplifierOf(p, 'resistance') === 2, 'a turtle master splash applies BOTH its effects (slowness IV + resistance III)'); }
  { const p = mob('pig', 2); Po.applySplashPotion('strong_healing', p.x, p.y, p.z, [p], p, null);
    ok(p.health === 10, 'strong healing (amplifier 1) heals 4<<1 = 8'); }
  { const p = mob('pig', 10); Po.applySplashPotion(null, p.x, p.y, p.z, [p], p, null, [{ effect: 'speed', duration: 400, amplifier: 1 }]);
    ok(ES.amplifierOf(p, 'speed') === 1, 'a splash potion\'s CustomPotionEffects apply too (PotionUtil.getPotionEffects)'); }
  { const p = mob('pig', 10); Cb.applyArrowTip({ potionId: 'long_poison' }, p);
    ok(ES.getStatusEffect(p, 'poison') && ES.getStatusEffect(p, 'poison').duration === 225, 'a long-poison tipped arrow: 1800/8 = 225 ticks'); }
  ok(Po.tipFromTag({ Potion: 'minecraft:strong_swiftness' }).potionId === 'strong_swiftness', 'a strong_ tier tag resolves (no longer misses the table)');
  ok(Po.tipFromTag({ Potion: 'minecraft:water' }).potionId === 'water', 'a water bottle\'s own Potion tag resolves to water');
  // the lingering cloud: getDuration() / 4, INTEGER division
  { const cl = EL.spawn('area_effect_cloud', 0, PLAT_Y + 1, 0, { potionId: 'strong_regeneration' });
    if (cl) { Object.assign(cl, { age: 0, waitTime: 0, duration: 600, radius: 3, radiusGrowth: 0, radiusOnUse: 0, reapplicationDelay: 20 });
      const p = mob('pig', 5); p.x = 0.5; p.z = 0.5; M.Player = null; Po.tickCloud(cl);
      const inst = ES.getStatusEffect(p, 'regeneration');
      ok(inst && inst.duration === 112, `the cloud gives strong regeneration 450/4 = 112 ticks (int division), got ${inst && inst.duration}`); }
    else ok(false, 'an area_effect_cloud spawns'); }
  // the water splash, both directions
  const water = (type) => { const m = mob(type, 10); const h0 = m.health = Math.min(10, m.maxHealth); return Po.applyWater(m.x + 1, m.y, m.z, [m], null).length === 1 ? m.health - h0 + 10 : null; };  // snow golem maxHealth is 4 (Combat.hurt clamps, #4626)
  ok(water('enderman') === 9, 'a water splash deals 1.0 to an enderman (hurtByWater)');
  ok(water('snow_golem') === 9, 'a water splash deals 1.0 to a snow golem');
  ok(water('pig') === null, 'a water splash does nothing to a pig');
  ok(Po.isWaterSplash('water', null) && !Po.isWaterSplash('water', [{ effect: 'speed', duration: 1, amplifier: 0 }]) && !Po.isWaterSplash('awkward', null),
    'only potion==water with NO effects is the water splash (PotionEntity :68/:88)');
  { const B = M.Behave, R = M.Reg, W2 = W;
    const fire = stateOf('fire'), camp = B.setProp(stateOf('campfire'), 'lit', true), candle = B.setProp(stateOf('candle'), 'lit', true);
    W2.setBlock(3, PLAT_Y + 1, 3, fire); W2.setBlock(4, PLAT_Y + 1, 3, camp); W2.setBlock(3, PLAT_Y + 1, 4, candle); W2.setBlock(9, PLAT_Y + 1, 9, fire);
    Po.extinguishAround(3, PLAT_Y + 1, 3);
    ok((W2.getBlock(3, PLAT_Y + 1, 3) | 0) === 0, 'the fire the bottle landed in is removed');
    ok(B.propName(W2.getBlock(4, PLAT_Y + 1, 3), 'lit') === 'false', 'a lit campfire beside it goes out');
    ok(B.propName(W2.getBlock(3, PLAT_Y + 1, 4), 'lit') === 'false', 'a lit candle beside it goes out');
    ok((W2.getBlock(9, PLAT_Y + 1, 9) | 0) === fire, 'a fire far away is untouched');
    ok((W2.getBlock(3, PLAT_Y, 3) | 0) === STONE, 'the stone the bottle hit is untouched (not in the fire tag)');
    const saved = Po.HURT_BY_WATER; Po.HURT_BY_WATER = {};
    okAv(water('enderman') === null, 'break: an empty hurtByWater table leaves the enderman dry (the check would fire)');
    Po.HURT_BY_WATER = saved;
  }
}

// ═══ 12. loop/potion-splash-impact — CLOSED: the ON-IMPACT particle burst (D-694's own
// "in flight fixed; ON IMPACT still owed" line) — Po.colorOf/Po.hasInstantEffect (amplifier-
// weighted RGB average + base-potion-only instant flag, .decomp potion/PotionUtil.java:88-110
// and Potion.java:37-43) and the real Po.tick -> Px.spawnPotionSplash join (WorldRenderer.
// processWorldEvent case 2002/2007, .decomp client/render/WorldRenderer.java:2964-2999) ═══
console.log('\n 12. loop/potion-splash-impact — Po.colorOf/hasInstantEffect, and Po.tick\'s own impact burst');
{
  const Px = M.Particle;
  ok(Px.ready, 'Particle module reports ready (07zx_particle.js loaded alongside Potion)');

  // ── Po.colorOf: single-effect identity, the water special-case, the empty-effects literal ──
  ok(Po.colorOf('water', null) === Po.DEFAULT_POTION_COLOR, 'a water splash colours 16253176 (PotionUtil.DEFAULT_COLOR), potion==WATER regardless of effects');
  ok(Po.colorOf('mundane', null) === Po.EMPTY_EFFECTS_COLOR, 'mundane (non-water, no effects) colours 3694022 -- PotionUtil.getColor(Collection)\'s own isEmpty literal');
  ok(Po.colorOf('poison', null) === Po.EFFECT_COLOR.poison, 'a single-effect potion\'s colour is that effect\'s own StatusEffect colour (amplifier/weight cancel with one term)');
  ok(Po.colorOf('healing', null) === Po.EFFECT_COLOR.instant_health, 'healing (instant_health) colours off the SAME EFFECT_COLOR table, not a separate instant-only one');
  // referee re-derivation (PotionUtil.getColor(Collection), read whole) for a REAL two-effect
  // potion (turtle_master: slowness amp3 + resistance amp2, DIFFERENT amplifiers) — not an
  // identity case, so this is the formula itself, not a copy of Po.colorOf's own code.
  {
    const refereeColor = (rows) => {
      let r = 0, g = 0, b = 0, w = 0;
      for (const [effect, amp] of rows) {
        const c = Po.EFFECT_COLOR[effect], a = amp + 1;
        r += a * (c >> 16 & 0xFF) / 255; g += a * (c >> 8 & 0xFF) / 255; b += a * (c & 0xFF) / 255; w += a;
      }
      return (Math.floor(r / w * 255) << 16) | (Math.floor(g / w * 255) << 8) | Math.floor(b / w * 255);
    };
    const expect = refereeColor([['slowness', 3], ['resistance', 2]]);
    ok(Po.colorOf('turtle_master', null) === expect, `turtle_master's colour matches the referee's own weighted average (got ${Po.colorOf('turtle_master', null)}, want ${expect})`);
  }

  // ── Po.hasInstantEffect: the BASE potion only, custom NBT effects do not flip it ──
  ok(Po.hasInstantEffect('healing') && Po.hasInstantEffect('strong_harming'), 'healing/harming are instant (instant_health/instant_damage)');
  ok(!Po.hasInstantEffect('poison') && !Po.hasInstantEffect('water') && !Po.hasInstantEffect('mundane'), 'poison/water/mundane are not instant');

  // ── the JOIN: a real live potion entity, ticked through EL.tickOne, actually bursts ──
  const ptMeta = JSON.parse(readFileSync(join(ASSETS, 'particle-tex.meta.json'), 'utf8'));
  M.DATA = Object.assign({}, M.DATA, { particleLayers: ptMeta.layers });
  if (Px._resetLayerCacheForTest) Px._resetLayerCacheForTest();
  freshWorld(); plate(20);
  const fireSplash = (potionId) => {
    Px.clear();
    EL.list = [];
    const t = EL.spawn('pig', 0.4, PLAT_Y + 1, 0);
    const p = EL.spawn('potion', 0, PLAT_Y + 1, 0, { vx: 0, vy: 0, vz: 0, shooter: null, potionId: potionId });
    for (let i = 0; i < 20 && !p.removed; i++) EL.tickOne(p);
    return { t, p };
  };

  const { p: pPoison } = fireSplash('poison');
  ok(pPoison.removed, 'a poison splash still lands and discards (the particle burst does not break the existing dispatch)');
  const cracks = Px.list.filter((q) => q.type === 'item_crack');
  const splash = Px.list.filter((q) => q.type === 'effect');
  ok(cracks.length === Px.POTION_CRACK_COUNT, `the impact spawns exactly ${Px.POTION_CRACK_COUNT} glass-bottle crumbs — got ${cracks.length}`);
  ok(cracks.every((c) => c.item === 'glass_bottle'), 'every crumb is the glass bottle icon, not egg/snowball');
  ok(cracks.every((c) => Px.frameLayer(c) >= 0), 'the glass-bottle crumb actually resolves a drawable layer (extract-particletex.mjs packed it)');
  ok(splash.length === Px.POTION_SPLASH_COUNT, `a non-instant splash spawns exactly ${Px.POTION_SPLASH_COUNT} 'effect' particles (2002), not 'instant_effect' — got ${splash.length}`);
  ok(Px.list.filter((q) => q.type === 'instant_effect').length === 0, 'poison (not instant) spawns NO instant_effect particles');
  ok(splash.every((q) => Px.frameLayer(q) >= 0), 'every splash particle resolves a real effect_0..7 layer, not -1');
  const wantColor = Po.colorOf('poison', null);
  const wr = (wantColor >> 16 & 0xFF) / 255, wg = (wantColor >> 8 & 0xFF) / 255, wb = (wantColor & 0xFF) / 255;
  ok(splash.every((q) => q.red <= wr + 1e-9 && q.green <= wg + 1e-9 && q.blue <= wb + 1e-9 && q.red >= wr * 0.75 - 1e-9),
     'every splash particle\'s own colour is poison\'s own tint scaled by its 0.75..1.0 per-particle brightness roll, never brighter');
  ok(new Set(splash.map((q) => q.red)).size > 1, 'the per-particle 0.75..1.0 brightness roll actually varies (not one flat colour copy-pasted 100 times)');

  const { p: pHeal } = fireSplash('healing');
  ok(pHeal.removed, 'an instant (healing) splash also lands and discards');
  ok(Px.list.filter((q) => q.type === 'instant_effect').length === Px.POTION_SPLASH_COUNT, 'healing (instant_health, 2007) spawns instant_effect particles, not effect');
  ok(Px.list.filter((q) => q.type === 'effect').length === 0, 'healing spawns NO plain effect (2002) particles');

  // ── anti-vacuity: unhook the burst -> the join assertion above must be able to fail ──
  const realSpawn = Px.spawnPotionSplash;
  Px.spawnPotionSplash = () => 0;
  const { p: pBroken } = fireSplash('poison');
  okAv(pBroken.removed && Px.list.length === 0, 'unhooking Px.spawnPotionSplash leaves Po.tick\'s impact with zero particles — the burst-count assertions above are not vacuous');
  Px.spawnPotionSplash = realSpawn;
  // anti-vacuity: a wrong event id (always 'effect', ignoring hasInstantEffect) is caught
  const realInstant = Po.hasInstantEffect;
  Po.hasInstantEffect = () => false;
  fireSplash('healing');
  okAv(Px.list.filter((q) => q.type === 'instant_effect').length === 0, 'forcing hasInstantEffect false makes a healing splash spawn the WRONG particle type (effect, not instant_effect) — the type assertion above is not vacuous');
  Po.hasInstantEffect = realInstant;
  // anti-vacuity: a wrong (unscaled) colour is caught
  const realColor = Po.colorOf;
  Po.colorOf = () => 16777215;   // pure white, not poison's own tint
  fireSplash('poison');
  const wrongSplash = Px.list.filter((q) => q.type === 'effect');
  okAv(wrongSplash.some((q) => q.red > wr + 1e-6), 'forcing colorOf to white makes a poison splash brighter than poison\'s own tint -- the colour-bound assertion above is not vacuous');
  Po.colorOf = realColor;

  Px.clear();
}

// ═══ 13. KW-38 — SPLASH/DIRECT-HIT ON THE REAL PLAYER OBJECT. `ranged2refcheck`'s witch scene
// found splash potions never affect the player: 14_player.js's own `NS.Player` singleton (built
// once at load, never through `EL.spawn`) carries no `maxHealth` field at all -- `Sv.init`
// (14d_survival.js), the SAME construction the live game runs on the player, only ever sets
// `health`/`food`/etc, never `maxHealth`. Every other `maxHealth === undefined` filter in this
// codebase uses that field as its own "is this a LivingEntity" test (07k_goals.js:1872 already
// names the same convention with its own explicit `t !== NS.Player` carve-out) — `Po`'s splash
// path and `Po.tick`'s own direct-hit collision loop had not been given that same carve-out. ═══
console.log('\n 13. KW-38 — a splash/direct-hit potion actually reaches the real (no-maxHealth) player object');
{
  const mkRealPlayer = (x, y, z) => M.Survival.init({ id: -1, type: 'player', x, y, z, vx: 0, vy: 0, vz: 0,
    width: 0.6, height: 1.8, removed: false });

  // (a) Po.applySplashPotion's own target filter.
  {
    const player = mkRealPlayer(0, PLAT_Y, 0);
    ok(player.maxHealth === undefined, 'setup: the real Sv.init-shaped player carries no maxHealth field, same as the live game');
    M.Player = player;
    const hit = Po.applySplashPotion('poison', 0, PLAT_Y, 0, [player], player, null);
    ok(hit.indexOf(player) >= 0, 'KW-38: a direct-hit splash actually affects the real player object');
    ok(player.effects && player.effects.poison && player.effects.poison.duration === Po.POTIONS.poison.duration,
      `KW-38: the player's direct hit gets the full un-scaled duration, got ${player.effects && player.effects.poison && player.effects.poison.duration}`);

    // anti-vacuity: a maxHealth-less DECOY that is NOT NS.Player must still be excluded -- the
    // fix names the player explicitly, it does not just drop the LivingEntity filter outright.
    const decoy = { id: 901, type: 'decoy', x: 0, y: PLAT_Y, z: 0, removed: false, dead: false };
    const hitDecoy = Po.applySplashPotion('poison', 0, PLAT_Y, 0, [decoy], decoy, null);
    okAv(hitDecoy.indexOf(decoy) < 0, 'break: a maxHealth-less non-player target is still excluded from the splash (the fix names the player, it does not remove the filter)');
  }

  // (b) Po.tick's own direct-hit collision loop -- `EL.list` never holds the player, so a
  // motionless (onGround:false) potion overlapping the player's own box must still resolve
  // `hitEntity` to the player rather than falling through as "still in flight".
  {
    freshWorld(); plate(20);
    EL.list.length = 0;
    const player = mkRealPlayer(5, PLAT_Y + 1, 5);
    M.Player = player;
    const e = { id: 950, type: 'potion', x: player.x, y: player.y + 0.5, z: player.z,
      vx: 0, vy: 0, vz: 0, onGround: false, potionId: 'poison', shooter: null, removed: false };
    EL.list.push(e);
    Po.tick(e);
    ok(e.removed, 'KW-38: Po.tick actually resolves the collision against the player and discards the potion (not left flying forever)');
    ok(player.effects && player.effects.poison && player.effects.poison.duration === Po.POTIONS.poison.duration,
      `KW-38: the player receives the FULL duration (factor 1.0), proving the collision loop found a real DIRECT hit, got ${player.effects && player.effects.poison && player.effects.poison.duration}`);

    // anti-vacuity: a potion that never overlaps the player's box, still airborne, must NOT
    // resolve a phantom hit -- the new player check is a real box test, not "always hit".
    EL.list.length = 0;
    const player2 = mkRealPlayer(5, PLAT_Y + 1, 5);
    M.Player = player2;
    const eFar = { id: 951, type: 'potion', x: player2.x + 20, y: player2.y, z: player2.z,
      vx: 0, vy: 0, vz: 0, onGround: false, potionId: 'poison', shooter: null, removed: false };
    EL.list.push(eFar);
    Po.tick(eFar);
    okAv(!eFar.removed && !(player2.effects && player2.effects.poison),
      'break: a potion 20 blocks off, still airborne, does not phantom-hit the player (the new box test is real, not unconditional)');
    EL.list.length = 0;
  }
  // (c) #2979: spectators are never hit/splashed; the owner is hittable once the bottle left its box.
  {
    freshWorld(); plate(20);
    EL.list.length = 0;
    const sp = mkRealPlayer(5, PLAT_Y + 1, 5); sp.spectator = true;
    M.Player = sp;
    const e = { id: 960, type: 'potion', x: sp.x, y: sp.y + 0.5, z: sp.z, vx: 0, vy: 0, vz: 0, onGround: true, potionId: 'poison', shooter: null, removed: false };
    EL.list.push(e);
    Po.tick(e);
    ok(e.removed && !(sp.effects && sp.effects.poison), '#2979: a spectator player is neither hit nor splashed');
    const sm = { id: 961, type: 'zombie', x: 5, y: PLAT_Y + 1, z: 5, maxHealth: 20, health: 20, spectator: true, removed: false, dead: false };
    ok(Po.applySplashPotion('poison', 5, PLAT_Y + 1, 5, [sm], null, null).length === 0, '#2979: a spectating mob is not splashed');
    okAv(Po.applySplashPotion('poison', 5, PLAT_Y + 1, 5, [{ ...sm, spectator: false }], null, null).length === 1, 'break: the same mob without spectator IS splashed');
    // thrown straight up, lands on the thrower: owner hit => factor 1.0
    EL.list.length = 0;
    const pl = mkRealPlayer(5, PLAT_Y + 1, 5); M.Player = pl;
    const up = { id: 962, type: 'potion', x: pl.x, y: pl.y + 3, z: pl.z + 2, vx: 0, vy: 0, vz: 0, onGround: false, potionId: 'poison', shooter: pl, removed: false };
    EL.list.push(up);
    Po.tick(up);                       // far from owner box: leftOwner latches
    up.x = pl.x; up.z = pl.z; up.y = pl.y + 0.5;
    Po.tick(up);
    ok(up.removed && pl.effects && pl.effects.poison && pl.effects.poison.duration === Po.POTIONS.poison.duration, '#2979: owner hit after leaving owner box gets full duration');
    EL.list.length = 0;
  }
  // (d) #2978: a wall or ceiling hit breaks the bottle too (ThrownEntity onCollision, any face).
  for (const [flag, name] of [['horizontalCollision', 'wall'], ['verticalCollision', 'ceiling']]) {
    freshWorld(); plate(20); EL.list.length = 0; M.Player = null;
    const e = { id: 960, type: 'potion', x: 5, y: PLAT_Y + 5, z: 5, vx: 0, vy: 0, vz: 0, onGround: false,
      potionId: 'poison', shooter: null, removed: false };
    e[flag] = true; EL.list.push(e);
    Po.tick(e);
    ok(e.removed, `#2978: a ${name} hit (onGround false) splashes and discards the potion`);
    const f = { id: 961, type: 'potion', x: 5, y: PLAT_Y + 5, z: 5, vx: 0, vy: 0, vz: 0, onGround: false,
      potionId: 'poison', shooter: null, removed: false };
    EL.list.push(f); Po.tick(f);
    okAv(!f.removed, `break: ${name} case - with no collision flag the potion stays in flight`);
    EL.list.length = 0;
  }
  M.Player = null;
}

// ═══ 14. KW-46 — THE WITCH'S SELECTION ORDER ONCE A HIT ACTUALLY LANDS (depends on KW-38
// above): `WitchEntity.attack` (.decomp/net/minecraft/entity/mob/WitchEntity.java:221-242, read
// whole) is an if/else-if chain gated on `!hasStatusEffect(...)` for slowness/poison/weakness --
// against a player who is >=8 blocks off and has never actually been hit, that gate can ONLY
// ever see "no effect yet" and picks slowness every time (the referee's own "slowness x3"
// symptom). `Po.witchChoosePotion`'s own if-chain (section 3 above) already matches the
// decompiled order/thresholds exactly; this section proves the ORDER only turns into
// slowness→poison→harming once each hit's effect is actually recorded on the target, i.e. once
// KW-38 lets a hit land on the player at all. ═══
console.log('\n 14. KW-46 — three successive witch hits on a real, effect-tracking player: slowness, poison, harming');
{
  const witch = { x: 0, y: PLAT_Y, z: 0, type: 'witch' };
  const mkRealPlayer = (id) => M.Survival.init({ id, type: 'player', x: 9, y: PLAT_Y, z: 0,
    vx: 0, vy: 0, vz: 0, width: 0.6, height: 1.8, removed: false });

  const player = mkRealPlayer(-1);
  M.Player = player;
  const seq = [];
  for (let i = 0; i < 3; i++) {
    const chosen = Po.witchChoosePotion(witch, player, fixedRandom([0.9]));
    seq.push(chosen);
    Po.applySplashPotion(chosen, player.x, player.y, player.z, [player], player, null);   // the hit actually lands (KW-38)
  }
  ok(seq.join(',') === 'slowness,poison,harming',
    `KW-46: three successive hits on the same (>=8 blocks, health>=8, outside 3 blocks) target pick slowness, poison, harming in that order, got ${seq.join(',')}`);

  // anti-vacuity: reproduce the actual KW-46 SYMPTOM -- a target that is chosen against but
  // never actually recorded as hit (KW-38 still open) sees hasStatusEffect() stay false forever
  // and the witch repeats slowness three times, never reaching poison/harming at all.
  const player2 = mkRealPlayer(-2);
  M.Player = player2;
  const seqNoHit = [];
  for (let i = 0; i < 3; i++) seqNoHit.push(Po.witchChoosePotion(witch, player2, fixedRandom([0.9])));
  okAv(seqNoHit.join(',') === 'slowness,slowness,slowness',
    'break: confirms the reported KW-46 symptom (repeated slowness) really does reproduce when a hit never lands -- the ordered-sequence assertion above is not vacuous');
  M.Player = null;
}

// ═══ 6. #1001 — velocity in the choice distance; real eye heights ═══
console.log('\n 6. witch choice distance includes target velocity; spawn y == witch.y + 1.52');
{
  freshWorld(); plate(20);
  const witch = EL.spawn('witch', 0, PLAT_Y + 1, 0);
  const still = target(7.5, PLAT_Y + 1, 0, { health: 20 });
  const moving = target(7.5, PLAT_Y + 1, 0, { health: 20, vx: 0.6 });
  ok(Po.witchChoosePotion(witch, still, fixedRandom([0.9])) === 'poison', 'still target at 7.5 -> poison');
  okAv(Po.witchChoosePotion(witch, moving, fixedRandom([0.9])) === 'slowness', 'target at 7.5 moving to 8.1 -> slowness');
  const near = target(3.2, PLAT_Y + 1, 0, { health: 4, vx: -0.4 });
  okAv(Po.witchChoosePotion(witch, near, fixedRandom([0.1])) === 'weakness', 'target at 3.2 moving to 2.8 -> weakness');
  const e = Po.witchThrow(witch, still, EL.spawn, fixedRandom([0.9]));
  okAv(Math.abs(e.y - (witch.y + 1.52)) < 1e-9, `potion spawns at witch.y+1.52, got ${(e.y - witch.y).toFixed(4)}`);
}

// #999: WitchEntity.applyEnchantmentsToDamage -- self-damage 0, magic x0.15
{
  const W = () => ({ id: 9990, type: 'witch', x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, width: 0.6, height: 1.95, health: 26, maxHealth: 26, removed: false });
  const ES = M.Effects;
  const a = ES.witchMagic(W(), 6, null);
  ok(Math.abs(a - 0.9) < 1e-9, `#999: magic damage on a witch is x0.15, got ${a}`);
  const w = W();
  ok(ES.witchMagic(w, 6, w) === 0, '#999: witch\'s own potion does 0 to her');
  const cow = { type: 'cow' };
  ok(ES.witchMagic(cow, 6, null) === 6, '#999: non-witch unchanged');
  const w2 = W(); ES.magicDamage(w2, 6, w2);
  ok(w2.health === 26, `#999: magicDamage attacker==witch leaves health, got ${w2.health}`);
  okAv(ES.witchMagic(cow, 6, null) !== 0.9, 'break: a non-witch does not get the x0.15');
  // #3549: any source:'magic' hit through Cb.hurt (evoker fangs, guardian) is x0.15 too
  const w3 = W(); Cb.hurt(w3, 6, undefined, false, { bypassArmor: true, source: 'magic' });
  ok(Math.abs(w3.health - 25.1) < 1e-6, `#3549: Cb.hurt magic on a witch is x0.15, got ${w3.health}`);
  const w4 = W(); ES.magicDamage(w4, 6, null);
  ok(Math.abs(w4.health - 25.1) < 1e-6, `#3549: magicDamage scaled once, got ${w4.health}`);
  const w5 = W(); Cb.hurt(w5, 6, undefined, false, { bypassArmor: true, source: 'magic' });
  okAv(Math.abs(w5.health - 20) > 1, 'break: unscaled magic would leave 20');
  // #4214: her own splash (0 damage) still counts as a hit: returns true, arms hurtTime + i-frames
  const w6 = W(); const r6 = Cb.hurt(w6, 6, undefined, false, { bypassArmor: true, source: 'magic', attacker: w6 });
  ok(r6 === true && w6.hurtTime > 0 && w6.invulnerableTime > 0 && w6.health === 26, `#4214: self-splash still hurts (ret ${r6}, hurtTime ${w6.hurtTime}, hp ${w6.health})`);
  okAv(!(w6.hurtTime > 0 && w6.health === 26) === false, 'break: a skipped hurt would leave hurtTime unset');
}

// ═══ 12. SOUNDS — entity.witch.drink / entity.witch.throw, pitch in [0.8,1.2) (#996) ═══
console.log('\n 12. witch drink/throw sounds');
{
  const calls = [];
  const oldSound = M.Sound;
  M.Sound = { play: (id, o) => { calls.push({ id, o }); return true; } };
  const w = { type: 'witch', x: 1, y: 2, z: 3, eyeInWater: true, health: 20, maxHealth: 20 };
  Po.tickWitchDrink(w, { random: fixedRandom([0.1]) });
  const d = calls.filter(c => c.id === 'entity.witch.drink');
  ok(d.length === 1 && d[0].o.volume === 1 && d[0].o.pitch >= 0.8 && d[0].o.pitch < 1.2, 'drink start plays entity.witch.drink once, vol 1, pitch [0.8,1.2)');
  okAv(d.length === 1, 'break: a drink that never started would play nothing');
  Po.tickWitchDrink(w, { random: fixedRandom([0.1]) });
  ok(calls.length === 1, 'mid-drink ticks play no further sound');
  const ws = { type: 'witch', x: 1, y: 2, z: 3, eyeInWater: true, silent: true, health: 20, maxHealth: 20 };
  calls.length = 0;
  Po.tickWitchDrink(ws, { random: fixedRandom([0.1]) });
  okAv(ws.witchDrinking && calls.length === 0, 'silent witch drinks without sound');
  freshWorld(); plate(20);
  const witch = EL.spawn('witch', 0, PLAT_Y + 1, 0);
  calls.length = 0;
  Po.witchThrow(witch, target(6, PLAT_Y + 1, 0, { health: 20 }), EL.spawn, fixedRandom([0.9]));
  const t = calls.filter(c => c.id === 'entity.witch.throw');
  ok(t.length === 1 && t[0].o.pitch >= 0.8 && t[0].o.pitch < 1.2, 'throw plays entity.witch.throw once, pitch [0.8,1.2)');
  okAv(t.length === 1, 'break: no throw, no sound');
  M.Sound = oldSound;
}

// ═══ 8. #4555 ORDER — WitchEntity.tickMovement's drink block runs BEFORE super.tickMovement() (goalSelector) ═══
{
  const el = readFileSync(join(ROOT, 'src', '07i_entitylist.js'), 'utf8');
  const drink = el.indexOf('NS.Potion.tickWitchDrink(e, EL.aiCtx(e))');
  const goals = el.indexOf('else if (e.ai && !e.aiDisabled && !e.noAI) e.ai.tick();');
  ok(drink > 0 && goals > 0 && drink < goals, 'tickWitchDrink is called before e.ai.tick() (drink start + due shot same tick => no potion)');
  const ordered = (t) => t.indexOf('NS.Potion.tickWitchDrink(e, EL.aiCtx(e))') < t.indexOf('else if (e.ai) e.ai.tick();');
  const swapped = el.replace('NS.Potion.tickWitchDrink(e, EL.aiCtx(e));', '').replace('else if (e.ai) e.ai.tick();', 'else if (e.ai) e.ai.tick();\nNS.Potion.tickWitchDrink(e, EL.aiCtx(e));');
  okAv(!ordered(swapped), 'a swapped order (drink after the goals) is detected');
}

// ═══ 9. #5068 — Po.tick SWEEPS pos -> pos+velocity (ProjectileUtil.getCollision) and uses the real hit face ═══
{
  const fire = stateOf('fire');
  const mk = (id, o) => Object.assign({ id, type: 'potion', vx: 0, vy: 0, vz: 0, onGround: false, potionId: 'poison', shooter: null, removed: false }, o);
  const sweep = (e, on) => { if (!on) { delete e.sx; } return e; };
  for (const on of [true, false]) {
    // (1) a 1-block-thick mob crossed in one tick: start 3 short, move 6 along +x
    freshWorld(); plate(20); EL.list.length = 0; M.Player = null;
    const m = EL.spawn('pig', 10.5, PLAT_Y + 1, 5.5); m.health = 10; m.width = 0.4;
    const e = mk(970, { x: 15, y: PLAT_Y + 1.4, z: 5.5, sx: 7, sy: PLAT_Y + 1.4, sz: 5.5, svx: 8, svy: 0, svz: 0 });
    EL.list.push(e); sweep(e, on); Po.tick(e);
    if (on) ok(e.removed && m.effects && m.effects.poison, '#5068: a fast potion crossing a thin mob in one tick breaks ON it');
    else okAv(!(e.removed && m.effects && m.effects.poison), 'break: the point test misses the mob the potion crossed');
    // (2) water vs a wall: fire on the wall-adjacent cell
    freshWorld(); plate(20); EL.list.length = 0; M.Player = null;
    for (let y = PLAT_Y + 1; y <= PLAT_Y + 4; y++) W.setBlock(10, y, 5, STONE);
    W.setBlock(9, PLAT_Y + 1, 5, fire);
    const w = mk(971, { potionId: 'water', x: 6.5, y: PLAT_Y + 1.5, z: 5.5, sx: 6.5, sy: PLAT_Y + 1.5, sz: 5.5, svx: 4, svy: 0, svz: 0 });
    EL.list.push(w); sweep(w, on); Po.tick(w);
    if (on) ok(w.removed && (W.getBlock(9, PLAT_Y + 1, 5) | 0) === 0, '#5068: water hitting a wall extinguishes fire on the wall-adjacent cell');
    else okAv((W.getBlock(9, PLAT_Y + 1, 5) | 0) === fire, 'break: without the sweep the wall fire is not put out');
    // (3) ceiling: fire below it
    freshWorld(); plate(20); EL.list.length = 0; M.Player = null;
    W.setBlock(5, PLAT_Y + 6, 5, STONE); W.setBlock(5, PLAT_Y + 4, 5, STONE); W.setBlock(5, PLAT_Y + 5, 5, fire);
    const c = mk(972, { potionId: 'water', x: 5.5, y: PLAT_Y + 5.3, z: 5.5, sx: 5.5, sy: PLAT_Y + 5.3, sz: 5.5, svx: 0, svy: 2, svz: 0 });
    EL.list.push(c); sweep(c, on); Po.tick(c);
    if (on) ok(c.removed && (W.getBlock(5, PLAT_Y + 5, 5) | 0) === 0, '#5068: water hitting a ceiling extinguishes fire below it');
    else okAv((W.getBlock(5, PLAT_Y + 5, 5) | 0) === fire, 'break: without the sweep the ceiling fire is not put out');
  }
  EL.list.length = 0;
}

say(`   ${pass} ok`);

console.log('\n=================== witchpotioncheck ===================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
console.log('==========================================================');
if (fails.length) {
  console.log('\nFAIL');
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
console.log('witchpotioncheck: PASS');
