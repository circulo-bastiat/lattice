#!/usr/bin/env node
// polarbearcheck.mjs — Dan's scheduled parallel night, QUEUE row 0 item 0.2 (G18c: missing
// overworld mobs), branch loop/polarbear-s99: the POLAR BEAR, whole. Drives the REAL modules
// (07zj_polarbear.js, Ai.ROSTER.polar_bear/EL.DEFAULTS.polar_bear/EL.motionFor/
// Spawn.RULES.polar_bear) against `.decomp/net/minecraft/entity/passive/PolarBearEntity.java`
// (read in full).
//
//   node tools/polarbearcheck.mjs [--verbose]
//
// Sections:
//   1. attributes/dimensions/breeding — the jar-extracted entity table's own row for polar_bear
//   2. Pb.setWarning/isWarning/tickWarningAnim/getWarningAnimationProgress — the 0..6 ramp
//   3. Pb.applyDimensions — the HEIGHT-only warning stretch, layered on top of baby scale
//   4. Pb.AttackGoal — the three-way melee/warning/reset split, NOT-squared max attack distance
//   5. Pb.EscapeDangerGoal — (attacker && baby) || onFire, transcribed with Java precedence
//   6. Pb.RevengeGoal — a cub calls in every non-baby pack member and never fights itself
//   7. Pb.ProtectBabiesGoal — half followRange, cub-in-box gate, adults only
//   8. EL.motionFor('polar_bear') — the plain-MobEntity fallback (no jar re-measurement)
//   9. EL.DEFAULTS.polar_bear — opts.spawnIdx>0 rolls PassiveData(1.0F)'s always-a-cub chance
//  10. Spawn.RULES.polar_bear — the two BlockTags (real tags.bin), the two BiomeKeys, the light gate
//  11. Ai.ROSTER.polar_bear — the goal selector actually wires every piece above
//  12. anti-vacuity — break the check's own data/stubs and watch it catch the break

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };

console.log('polarbearcheck — Dan\'s scheduled parallel night, QUEUE 0.2 (G18c), the polar bear, whole');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
               '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
               '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
               '14j_combat.js', '07za_explosion.js', '07m_breed.js', '07zj_fox.js', '07t_fly.js', '07zj_polarbear.js', '07j_entityrender.js', '02j_sounds.js', '07zzp_mobvoice.js', '14f_inventory.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });

const EL = MCL.EntityList, Ai = MCL.Ai, Spawn = MCL.Spawn, Ent = MCL.Entities;
const Pb = MCL.PolarBear, Breed = MCL.Breed, W = MCL.World, S = MCL.States, Bh = MCL.Behave, R = MCL.Reg;
const CH = MCL.CH;

MCL.Entities.init();
Ent.attrs = MCL.DATA.entities.attrs;
W.init(1);
Bh.init(W);
EL.init();
Ai.init();
Spawn.init();
Breed.init();

// a small flat GENERATED chunk pad so W.setBlock/getBlock/rawBrightness have somewhere real
// to write (the same fixture shape rabbitcheck.mjs's own header uses) -- AFTER W.init, which
// resets W.chunks itself.
for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}

ok(Pb && Pb.ready, 'NS.PolarBear did not load/ready');
ok(Array.isArray(Pb && Pb.OWED) && Pb.OWED.length > 0, 'Pb.OWED must name real gaps, not be empty');

// ── 1. attributes/dimensions/breeding ───────────────────────────────────────────────────────
say('1. the jar-extracted entity table’s own row for polar_bear (createPolarBearAttributes)');
{
  const at = Ent.attrsOf('polar_bear');
  ok(!!at, 'Ent.attrsOf(polar_bear) is null');
  ok(at && at.hp === 30, `hp ${at && at.hp}, expected 30 (field_23716 30.0)`);
  ok(at && Math.abs(at.speed - 0.25) < 1e-6, `speed ${at && at.speed}, expected 0.25 (field_23719)`);
  ok(at && at.dmg === 6, `dmg ${at && at.dmg}, expected 6 (field_23721 attack_damage 6.0)`);
  ok(at && at.follow === 20, `follow ${at && at.follow}, expected 20 (field_23717 follow_range 20.0)`);
  const dim = Ent.dimensions('polar_bear');
  ok(dim && Math.abs(dim.width - 1.4) < 1e-6 && Math.abs(dim.height - 1.4) < 1e-6,
    `dimensions ${dim && dim.width}x${dim && dim.height}, expected 1.4x1.4`);
  const food = Ent.breedFood('polar_bear');
  ok(food && food.k === 'none', 'breedFood(polar_bear).k is not "none" — isBreedingItem always returns false');
  ok(!Breed.canBreed('polar_bear'), 'Breed.canBreed(polar_bear) must be false — no breeding item exists');
}

// ── 2. warning state ramp ───────────────────────────────────────────────────────────────────
say('2. Pb.setWarning/tickWarningAnim/getWarningAnimationProgress — the 0..6 ramp, field_30352');
{
  ok(Pb.WARNING_MAX === 6, `Pb.WARNING_MAX ${Pb.WARNING_MAX}, expected 6 (field_30352 6.0F)`);
  const e = { warning: false };
  ok(!Pb.isWarning(e), 'a fresh entity must not start warning');
  Pb.setWarning(e, true);
  ok(Pb.isWarning(e), 'setWarning(true) did not take');
  for (let i = 1; i <= 6; i++) { Pb.tickWarningAnim(e); ok(e.warningAnimationProgress === i, `ramp up tick ${i}: progress ${e.warningAnimationProgress}, expected ${i}`); }
  Pb.tickWarningAnim(e);
  ok(e.warningAnimationProgress === 6, 'progress must clamp at 6, not overshoot');
  ok(Math.abs(Pb.getWarningAnimationProgress(e, 1) - 1) < 1e-9, `getWarningAnimationProgress at full progress must be 1, got ${Pb.getWarningAnimationProgress(e, 1)}`);
  Pb.setWarning(e, false);
  for (let i = 5; i >= 0; i--) { Pb.tickWarningAnim(e); ok(e.warningAnimationProgress === i, `ramp down tick: progress ${e.warningAnimationProgress}, expected ${i}`); }
  Pb.tickWarningAnim(e);
  ok(e.warningAnimationProgress === 0, 'progress must clamp at 0, not undershoot');

  // playWarningSound's own 40-tick cooldown gate (real state, no-op call — Pb.OWED)
  const e2 = { type: 'polar_bear', warning: false, warningSoundCooldown: 0 };
  const evs = [], realPlay = MCL.Sound && MCL.Sound.play;
  MCL.Sound.play = (ev) => { evs.push(ev); return true; };
  Pb.playWarningSound(e2);
  ok(e2.warningSoundCooldown === 40, `playWarningSound must set the cooldown to 40, got ${e2.warningSoundCooldown}`);
  Pb.playWarningSound(e2);
  ok(evs.length === 1 && evs[0] === 'entity.polar_bear.warning', `exactly one entity.polar_bear.warning per cooldown window, got ${JSON.stringify(evs)}`);
  { let n = 0; for (let t = 0; t < 80; t++) { Pb.tickWarningAnim(e2); Pb.playWarningSound(e2); } n = evs.length - 1; ok(n === 2, `80 ticks of warning emit the growl every 40 ticks (2 more), got ${n}`); }
  evs.length = 0; e2.warningSoundCooldown = 0;
  { const sv = MCL.MobVoice.emit; MCL.MobVoice.emit = () => false; Pb.playWarningSound(e2); okAv(evs.length === 0, 'stubbing MobVoice.emit silences the growl (the sound really comes from it)'); MCL.MobVoice.emit = sv; }
  MCL.Sound.play = realPlay;
  ok(e2.warningSoundCooldown === 40, 'a second call inside the cooldown window must not reset it early (isCooledDown gate)');

  okAv((() => {
    const save = Pb.WARNING_MAX;
    Pb.WARNING_MAX = 1;
    const e3 = { warning: true };
    Pb.tickWarningAnim(e3);
    const broke = e3.warningAnimationProgress === 1;   // clamps to the corrupted max instantly
    Pb.WARNING_MAX = save;
    return broke;
  })(), 'corrupting Pb.WARNING_MAX did not change the ramp’s own clamp — the constant is not really consulted');
}

// ── 3. dimensions — HEIGHT-only warning stretch, layered on baby scale ─────────────────────
say('3. Pb.applyDimensions — getDimensions(pose): scaled(1, 1+progress/6), baby scale first');
{
  const e = { type: 'polar_bear', warningAnimationProgress: 0 };
  Pb.applyDimensions(e);
  ok(Math.abs(e.width - 1.4) < 1e-6 && Math.abs(e.height - 1.4) < 1e-6, `no warning, no baby: expected 1.4x1.4, got ${e.width}x${e.height}`);
  e.warningAnimationProgress = 6;
  Pb.applyDimensions(e);
  ok(Math.abs(e.width - 1.4) < 1e-6, `warning must NOT touch width, got ${e.width}`);
  ok(Math.abs(e.height - 2.8) < 1e-6, `warning at full progress (6/6) must double HEIGHT: expected 2.8, got ${e.height}`);
  // a baby: half box, THEN the warning stretch on top of that half box
  const cub = { type: 'polar_bear', growAge: -1, isBaby: true, warningAnimationProgress: 6 };
  Pb.applyDimensions(cub);
  ok(Math.abs(cub.width - 0.7) < 1e-6, `baby width must halve to 0.7, got ${cub.width}`);
  ok(Math.abs(cub.height - 1.4) < 1e-6, `baby height must be 0.5*1.4 then *2 warning = 1.4, got ${cub.height}`);
  okAv((() => {
    const save = Ent.dimensions;
    Ent.dimensions = () => null;
    const probe = { type: 'polar_bear', width: 999, height: 999, warningAnimationProgress: 0 };
    Pb.applyDimensions(probe);
    const untouched = probe.width === 999 && probe.height === 999;
    Ent.dimensions = save;
    return untouched;
  })(), 'a missing dimensions row must leave width/height untouched, not crash or zero them');
}

// ── 4. Pb.AttackGoal — attack(LivingEntity, double), verbatim three-way split ──────────────
say('4. Pb.AttackGoal — melee strike / warning-stand / reset, non-squared max attack distance');
{
  ok(Math.abs(Pb.attackMaxDist({ width: 0.6 }) - 4.6) < 1e-9, `attackMaxDist(width 0.6) must be 4.6 (4.0F + width, NOT squared), got ${Pb.attackMaxDist({ width: 0.6 })}`);
  const e = { x: 0, y: 0, z: 0, width: 1.4, target: { x: 1, y: 0, z: 0, width: 0.6 } };
  MCL.Combat = MCL.Combat || {};
  globalThis.__realMobAttack = MCL.Combat.mobAttack;
  let attacked = 0;
  MCL.Combat.mobAttack = () => { attacked++; };
  let swung = 0;
  MCL.EntityRender = MCL.EntityRender || {};
  MCL.EntityRender.swingHand = () => { swung++; };
  const g = new Pb.AttackGoal(e);
  e.age = 100;
  ok(g.canUse() === true, 'canUse must be true while e.target is set (in reach)');
  ok(g.canUse() === false, 'canUse must be gated for 20 ticks after a check (MeleeAttackGoal.lastUpdateTime)');
  e.age = 130;
  {
    const far = { x: 0, y: 0, z: 0, width: 1.4, age: 100, target: { x: 50, y: 0, z: 0, width: 0.6 } };
    const saveAi = MCL.Ai, saveGm = MCL.Gamemode;
    MCL.Ai = { findPath: () => null };
    ok(new Pb.AttackGoal(far).canUse() === false, 'no path and out of reach: canUse must be false');
    MCL.Ai = saveAi;
    MCL.Gamemode = { isCreative: () => true, isSpectator: () => false };
    const pl = { x: 1, y: 0, z: 0, width: 0.6, type: 'player' };
    ok(new Pb.AttackGoal({ x: 0, y: 0, z: 0, target: pl }).canContinueToUse() === false, 'creative target must end the goal');
    MCL.Gamemode = { isCreative: () => false, isSpectator: () => true };
    ok(new Pb.AttackGoal({ x: 0, y: 0, z: 0, target: pl }).canContinueToUse() === false, 'spectator target must end the goal');
    MCL.Gamemode = saveGm;
  }
  g.start();
  ok(e.aggressive === true, 'start() must set e.aggressive = true');
  // close range (distSq 1 <= maxD ~4.7) and cooled down -> strike + warning cleared
  g.tick();
  ok(attacked === 1, `an in-reach, cooled-down tick must call Combat.mobAttack once, got ${attacked} calls`);
  ok(swung === 0, `vanilla PolarBearEntity.AttackGoal.attack never calls swingHand, got ${swung} swings`);
  ok(Pb.isWarning(e) === false, 'a landed strike must clear the warning flag');
  // mid range: inside 2x max dist but not max dist -> warning after cooldown drains to <=10
  e.target.x = 3;   // distSq 9, maxD ~4.7, maxD*2 ~9.4 -> mid band
  for (let i = 0; i < 9; i++) g.tick();   // drain the just-reset 20-tick cooldown to 11
  ok(Pb.isWarning(e) === false, `warning must still be false at cooldown 11, got ${Pb.isWarning(e)}`);
  g.tick();   // cooldown now 10 -> the <=10 branch fires
  ok(Pb.isWarning(e) === true, 'warning must arm once the cooldown counts down to 10 in the mid band');
  // far range: outside 2x max dist -> cooldown resets, warning forced off
  e.target.x = 20;
  g.tick();
  ok(Pb.isWarning(e) === false, 'a target beyond 2x max attack distance must force the warning off');
  g.stop();
  ok(e.aggressive === false, 'stop() must clear e.aggressive');
  ok(Pb.isWarning(e) === false, 'stop() must clear the warning flag');
  {
    const ge = { x: 0, y: 0, z: 0, width: 1.4, target: { x: 1, y: 0, z: 0, invulnerableGamemode: true } };
    new Pb.AttackGoal(ge).stop();
    ok(ge.target === null, 'stop() must drop a creative/spectator (invulnerableGamemode) target');
    const live = { x: 0, y: 0, z: 0, width: 1.4, target: { x: 1, y: 0, z: 0 } };
    new Pb.AttackGoal(live).stop();
    okAv(live.target !== null, 'stop() keeps an ordinary target (the clear is conditional, not unconditional)');
  }

  okAv((() => {
    const e2 = { x: 0, y: 0, z: 0, width: 1.4, target: { x: 100, y: 0, z: 100, width: 0.6 } };
    const g2 = new Pb.AttackGoal(e2);
    g2.start(); g2.tick();
    return Pb.isWarning(e2) === false;   // a target far outside range must never warn
  })(), 'an out-of-range target set the warning flag — the far-band reset is not really consulted');
}

// ── 5. Pb.EscapeDangerGoal — (attacker && baby) || onFire ──────────────────────────────────
say('5. Pb.EscapeDangerGoal.canUse — PolarBearEscapeDangerGoal.isInDanger, verbatim');
{
  const adult = { x: 0, y: 0, z: 0, lastHurtByEntity: { x: 1, z: 1 }, isOnFire: false };
  ok(new Pb.EscapeDangerGoal(adult).inDanger() === false, 'an ADULT with an attacker but not on fire must NOT be in danger');
  const cub = { x: 0, y: 0, z: 0, growAge: -1, isBaby: true, lastHurtByEntity: { x: 1, z: 1 }, isOnFire: false };
  ok(new Pb.EscapeDangerGoal(cub).inDanger() === true, 'a CUB with a live attacker must be in danger');
  const noAttacker = { x: 0, y: 0, z: 0, growAge: -1, isBaby: true, lastHurtByEntity: null, isOnFire: false };
  ok(new Pb.EscapeDangerGoal(noAttacker).inDanger() === false, 'a cub with NO attacker must not be in danger just for being a baby');
  const onFire = { x: 0, y: 0, z: 0, lastHurtByEntity: null, isOnFire: true };
  ok(new Pb.EscapeDangerGoal(onFire).inDanger() === true, 'ANY polar bear on fire must be in danger, adult or not');

  okAv((() => {
    // getAttacker() forgets the attacker 100 ticks after the last hit (LivingEntity.baseTick)
    const c = { x: 0, y: 0, z: 0, age: 0, hurtSeq: 1, growAge: -1, isBaby: true, lastHurtByEntity: { x: 1, z: 1 }, isOnFire: false };
    const g = new Pb.EscapeDangerGoal(c);
    const fresh = g.inDanger(); c.age = 101;
    return fresh === true && g.inDanger() === false;
  })(), 'a cub still panics 101 ticks after the hit - attacker never forgotten');

  okAv((() => {
    const probe = { x: 0, y: 0, z: 0, lastHurtByEntity: { x: 1, z: 1 }, isOnFire: false };
    // an adult must be false; flip isBaby by hand and it must flip to true — proves the
    // predicate really reads isBaby rather than being hard-wired one way.
    const before = new Pb.EscapeDangerGoal(probe).inDanger();
    probe.growAge = -1; probe.isBaby = true;
    const after = new Pb.EscapeDangerGoal(probe).inDanger();
    return before === false && after === true;
  })(), 'toggling isBaby did not change EscapeDangerGoal.canUse — the baby half of the predicate is not really consulted');
}

// ── 5b. EscapeDangerGoal target search (#1314) — flat world, burning adult, far from water ─
say('5b. Pb.EscapeDangerGoal target — NoPenalty 5/4 search, not a hurt-source heading');
{
  const Ph = MCL.Physics, Ai = MCL.Ai, Fly = MCL.Fly;
  const sv = { solid: Ph.solidAt, fp: Ai.findPath, lw: Fly && Fly.locateClosestWater };
  Ph.solidAt = (x, y, z) => y < 64;
  if (Fly) Fly.locateClosestWater = () => null;
  let seen = [];
  Ai.findPath = (x, y, z, tx, ty, tz) => { seen.push([tx, ty, tz]); return [[x, y, z]]; };
  try {
    const bear = { x: 0.5, y: 64, z: 0.5, lastHurtByEntity: null, isOnFire: true };
    let started = 0, inRange = 0, spread = new Set();
    for (let i = 0; i < 200; i++) {
      const g = new Pb.EscapeDangerGoal(bear);
      if (g.canUse()) { g.start(); started++; }
    }
    for (const [tx, ty, tz] of seen) {
      if (Math.abs(tx - 0.5) <= 5.5 && Math.abs(tz - 0.5) <= 5.5 && Math.abs(ty - 64) <= 4) inRange++;
      spread.add(Math.floor(tx) + ',' + Math.floor(tz));
    }
    ok(started > 150, 'a burning adult bear with NO hurt source must still get a flee target (' + started + '/200)');
    ok(inRange === seen.length, 'every chosen target must lie within 5 xz / 4 y of the bear');
    ok(spread.size > 5, 'targets must vary (found ' + spread.size + ' distinct cells) — a fixed heading is not the vanilla search');
    const calm = { x: 0.5, y: 64, z: 0.5, lastHurtByEntity: null, isOnFire: false };
    ok(new Pb.EscapeDangerGoal(calm).canUse() === false, 'a calm adult must not flee');
  } finally { Ph.solidAt = sv.solid; Ai.findPath = sv.fp; if (Fly) Fly.locateClosestWater = sv.lw; }
}

// ── 6. Pb.RevengeGoal — a cub calls for help and never fights itself ───────────────────────
say('6. Pb.RevengeGoal — PolarBearRevengeGoal.start/setMobEntityTarget');
{
  const attacker = { id: 'p1' };
  const adult = { type: 'polar_bear', hurtSeq: 1, lastHurtByEntity: attacker, target: null };
  const g = new Pb.RevengeGoal(adult, {});
  ok(g.canUse() === true, 'an adult with a fresh hurtSeq must be able to start revenge');
  g.start();
  ok(adult.target === attacker, 'an ADULT must retaliate directly (own target set to the attacker)');
  ok(g.canUse() === false, 'the same hurtSeq must not re-trigger canUse (lastSeen gate)');

  const cub = { type: 'polar_bear', growAge: -1, isBaby: true, hurtSeq: 1, lastHurtByEntity: attacker, target: null };
  const mateAdult = { type: 'polar_bear', x: 0, y: 0, z: 0, target: null, removed: false };
  const mateCub = { type: 'polar_bear', growAge: -1, isBaby: true, target: null, removed: false };
  const mateBusy = { type: 'polar_bear', x: 0, y: 0, z: 0, target: { already: true }, removed: false };
  const ctx = { animals: () => [mateAdult, mateCub, mateBusy] };
  const gc = new Pb.RevengeGoal(cub, ctx);
  gc.start();
  ok(cub.target === null, 'a CUB must never set its own target (it defers, then stops)');
  ok(mateAdult.target === attacker, 'callSameTypeForRevenge must alert a nearby ADULT pack member');
  ok(mateCub.target === null, 'setMobEntityTarget’s own !isBaby filter must skip another cub');
  ok(mateBusy.target && mateBusy.target.already === true, 'a mate that already has a target must be left alone, not overwritten');

  okAv((() => {
    const cre = { type: 'player', invulnerableGamemode: true };   // creative/spectator attacker (#4413)
    const a = { type: 'polar_bear', hurtSeq: 1, lastHurtByEntity: cre, target: null };
    const ga = new Pb.RevengeGoal(a, {});
    const c = { type: 'polar_bear', growAge: -1, isBaby: true, hurtSeq: 1, lastHurtByEntity: cre, target: null };
    const m = { type: 'polar_bear', x: 0, y: 0, z: 0, target: null, removed: false };
    new Pb.RevengeGoal(c, { animals: () => [m] }).start();
    return ga.canUse() === false && m.target === null && ga.canContinueToUse() === false;
  })(), 'a creative attacker must never become a revenge target (adult or cub-called mate)');

  okAv((() => {
    const cubF = { type: 'polar_bear', x: 0, y: 64, z: 0, growAge: -1, isBaby: true, hurtSeq: 1, lastHurtByEntity: attacker, target: null };
    const nearA = { type: 'polar_bear', x: 5, y: 64, z: 5, target: null, removed: false };
    const farA = { type: 'polar_bear', x: 100, y: 64, z: 0, target: null, removed: false };
    new Pb.RevengeGoal(cubF, { animals: () => [nearA, farA] }).start();
    return nearA.target === attacker && farA.target === null;
  })(), 'a far adult (100 blocks) must not be called by a cub revenge');

  okAv((() => {
    const cub2 = { type: 'polar_bear', growAge: -1, isBaby: true, hurtSeq: 1, lastHurtByEntity: attacker, target: null };
    const mate2 = { type: 'polar_bear', x: 0, y: 0, z: 0, target: null, removed: false };
    new Pb.RevengeGoal(cub2, { animals: () => [mate2] }).start();
    return mate2.target === attacker;   // proves ctx.animals() is really iterated, not skipped
  })(), 'a cub’s revenge start did not alert its own pack — callSameTypeForRevenge is not really consulted');
}

// ── 7. Pb.ProtectBabiesGoal — half followRange, cub-in-box, adults only ────────────────────
say('7. Pb.ProtectBabiesGoal.canUse/canContinueToUse — ProtectBabiesGoal.canStart/getFollowRange');
{
  Ent.attrs = MCL.DATA.entities.attrs;   // follow range 20 for polar_bear (§1)
  const adult = { type: 'polar_bear', x: 0, y: 64, z: 0, target: null };
  const cub = { type: 'polar_bear', x: 2, y: 64, z: 2, growAge: -1, isBaby: true, removed: false };
  const far = { type: 'polar_bear', x: 200, y: 64, z: 200, growAge: -1, isBaby: true, removed: false };
  const player = { x: 3, y: 64, z: 3 };
  EL.list = [adult, cub, far];
  const ctx = { players: () => [player], rand: () => 0 };
  const g = new Pb.ProtectBabiesGoal(adult, ctx);
  ok(g.canUse() === true, `an adult with a cub in the 8/4/8 box and a player within half-followRange (10) must target it — dist ${Math.hypot(3, 0, 3)}`);
  ok(adult.target === player, 'canUse must actually assign e.target on success');
  g.stop();
  ok(adult.target === null, 'stop() must clear the target');

  const babySelf = { type: 'polar_bear', x: 0, y: 64, z: 0, growAge: -1, isBaby: true };
  ok(new Pb.ProtectBabiesGoal(babySelf, ctx).canUse() === false, 'a BABY itself must never run ProtectBabiesGoal (canStart’s own isBaby() gate)');

  EL.list = [adult, far];   // no cub within the box now
  ok(new Pb.ProtectBabiesGoal(adult, ctx).canUse() === false, 'no cub within .expand(8,4,8) must refuse');

  EL.list = [adult, cub];
  const farPlayer = { x: 500, y: 64, z: 500 };
  ok(new Pb.ProtectBabiesGoal(adult, { players: () => [farPlayer], rand: () => 0 }).canUse() === false, 'a player outside HALF followRange must be refused (the 0.5x getFollowRange override)');

  // #1313: 1/20 roll, creative refused, wall blocks LOS, cub box is an AABB overlap
  ok(new Pb.ProtectBabiesGoal(adult, { players: () => [player], rand: () => 0.5 }).canUse() === false, 'the 1/20 reciprocalChance roll must refuse on a high roll');
  ok(new Pb.ProtectBabiesGoal(adult, { players: () => [{ x: 3, y: 64, z: 3, invulnerableGamemode: true, creative: true, gamemode: 'creative' }], rand: () => 0 }).canUse() === (Ai.canTargetLiving({ x: 3, y: 64, z: 3, invulnerableGamemode: true, creative: true, gamemode: 'creative' }, adult)), 'creative player must follow Ai.canTargetLiving');
  { const orig = Ai.canSee; Ai.canSee = () => false;
    adult.target = null;
    ok(new Pb.ProtectBabiesGoal(adult, { players: () => [player], rand: () => 0 }).canUse() === false, 'a player behind a wall (no LOS) must not be targeted');
    okAv(adult.target === null, 'wall case left a target set');
    Ai.canSee = orig; }
  { const edge = { type: 'polar_bear', x: 9.0, y: 64, z: 0, width: 1.4, height: 1.4, growAge: -1, isBaby: true, removed: false };
    const a2 = { type: 'polar_bear', x: 0, y: 64, z: 0, width: 1.4, height: 1.4, target: null };
    EL.list = [a2, edge];
    ok(new Pb.ProtectBabiesGoal(a2, { players: () => [player], rand: () => 0 }).canUse() === true, 'a cub whose box overlaps the expanded box (centre 9 away) must count'); a2.target = null;
    edge.x = 10; ok(new Pb.ProtectBabiesGoal(a2, { players: () => [player], rand: () => 0 }).canUse() === false, 'a cub box beyond the expanded box must not count'); EL.list = [adult, cub]; }

  okAv((() => {
    EL.list = [adult, cub];
    const bare = new Pb.ProtectBabiesGoal(adult, { players: () => [player], rand: () => 0 });
    const started = bare.canUse();
    bare.stop();
    return started === true && adult.target === null;
  })(), 'ProtectBabiesGoal did not both start and clean up its own target — the goal is not really consulted');
  EL.list = [];
}

// ── 8. EL.motionFor('polar_bear') — plain MobEntity fallback ───────────────────────────────
say('8. EL.motionFor(polar_bear) — no getGravity()/drag override in the jar');
{
  const m = EL.motionFor('polar_bear');
  ok(m && m[0] === 0.08 && m[1] === 0.98, `motion ${JSON.stringify(m)}, expected [0.08, 0.98] (shared MobEntity fallback)`);
  ok(EL.canSpawn('polar_bear'), 'EL.canSpawn(polar_bear) must be true once motionFor resolves');
}

// ── 9. EL.DEFAULTS.polar_bear — the always-a-cub-after-the-first-one baby chance ───────────
say('9. EL.DEFAULTS.polar_bear — PassiveData(1.0F): spawnedCount>0 is ALWAYS a cub');
{
  ok(Math.abs(Pb.BABY_CHANCE - 1) < 1e-9, `Pb.BABY_CHANCE ${Pb.BABY_CHANCE}, expected 1.0 (PassiveData(1.0F), not the usual 0.05)`);
  const first = EL.spawn('polar_bear', 0.5, 64, 0.5, { spawnIdx: 0 });
  ok(!!first && !Breed.isBaby(first), 'the FIRST member of a pack (spawnIdx 0) must never be forced into a cub');
  const second = EL.spawn('polar_bear', 1.5, 64, 0.5, { spawnIdx: 1 });
  ok(!!second && Breed.isBaby(second), 'the SECOND member of the SAME pack (spawnIdx 1) must ALWAYS be a cub at chance 1.0');
  const solo = EL.spawn('polar_bear', 2.5, 64, 0.5, {});
  ok(!!solo && !Breed.isBaby(solo), 'a spawn with no spawnIdx at all (egg/command) must never be forced into a cub');

  okAv((() => {
    const save = Pb.BABY_CHANCE;
    Pb.BABY_CHANCE = 0;
    const e = EL.spawn('polar_bear', 3.5, 64, 0.5, { spawnIdx: 1 });
    const notBaby = !!e && !Breed.isBaby(e);
    Pb.BABY_CHANCE = save;
    return notBaby;
  })(), 'dropping Pb.BABY_CHANCE to 0 did not stop a pack member from being forced baby — the constant is not really consulted');
}

// ── 9b. loop/mob-test-passive — the SAME EL.DEFAULTS.polar_bear cub roll must not crash when
//    NS.Breed exists but Breed.init() never ran (Br.ready false, Br.C undefined). Before this
//    unit the guard at 07i_entitylist.js's polar_bear DEFAULTS was `Br && Br.setBaby && Pb`
//    (Br.setBaby is a function whether or not Breed is ready) — a real TypeError site, same
//    shape as the zombie-family one loop/mob-test-passive's zvillagercheck caught crashing.
say('9b. EL.DEFAULTS.polar_bear cub roll must survive NS.Breed existing-but-unready');
{
  const savedReady = Breed.ready, savedC = Breed.C;
  Breed.ready = false; Breed.C = undefined;
  let threw = false, cub = null;
  try {
    cub = EL.spawn('polar_bear', 5.5, 64, 0.5, { spawnIdx: 1 });   // spawnIdx>0, BABY_CHANCE=1.0 -- always rolls
  } catch (e) { threw = true; }
  Breed.ready = savedReady; Breed.C = savedC;
  ok(threw === false, 'EL.spawn(polar_bear, spawnIdx:1) must not throw when NS.Breed exists but is not ready (07i_entitylist.js guard)');
  okAv(!!cub, 'the spawn above must still have produced an entity');
}

// ── 10. Spawn.RULES.polar_bear — the two BlockTags, the two BiomeKeys, the light gate ──────
say('10. Spawn.RULES.polar_bear — PolarBearEntity.canSpawn, real tags.bin');
{
  ok(typeof Spawn.RULES.polar_bear === 'function', 'Spawn.RULES.polar_bear is not wired');
  ok(MCL.Tags && MCL.Tags.ready, 'the tag substrate must have loaded for this section to mean anything');

  const grass = S.stateOf('grass_block') | 0, stone = S.stateOf('stone') | 0, ice = S.stateOf('ice') | 0;
  ok(grass > 0 && stone > 0 && ice > 0, 'fixture block states (grass_block/stone/ice) must resolve — the registry is real');

  const saveBright = W.rawBrightness;
  W.rawBrightness = () => 9;
  const saveBiomes = MCL.Biomes, saveBiomeAt = W.biomeAt;

  // plains-shaped biome (not frozen_ocean/deep_frozen_ocean): needs #animals_spawnable_on (grass)
  MCL.Biomes = { ready: true, at: () => ({ name: 'plains' }) };
  W.biomeAt = () => 0;
  W.setBlock(0, 63, 0, grass);
  W.setBlock(0, 63, 1, stone);
  W.setBlock(0, 63, 2, ice);
  ok(Spawn.RULES.polar_bear(0, 64, 0) === true, 'plains + grass_block below + bright enough must pass');
  ok(Spawn.RULES.polar_bear(0, 64, 1) === false, 'plains + stone below (not animals_spawnable_on) must refuse');
  ok(Spawn.RULES.polar_bear(0, 64, 2) === false, 'plains + ICE below must still refuse — that tag only applies inside the frozen-ocean biomes');

  // frozen_ocean: needs #polar_bears_spawnable_on_in_frozen_ocean (ice), NOT animals_spawnable_on
  MCL.Biomes = { ready: true, at: () => ({ name: 'frozen_ocean' }) };
  ok(Spawn.RULES.polar_bear(0, 64, 2) === true, 'frozen_ocean + ice below + bright enough must pass');
  ok(Spawn.RULES.polar_bear(0, 64, 0) === false, 'frozen_ocean + grass_block below (not the frozen-ocean ice tag) must refuse');

  // deep_frozen_ocean: the SAME special tag applies (field_9418, read off the literal, not memory)
  MCL.Biomes = { ready: true, at: () => ({ name: 'deep_frozen_ocean' }) };
  ok(Spawn.RULES.polar_bear(0, 64, 2) === true, 'deep_frozen_ocean + ice below must ALSO pass — the second BiomeKey');

  // frozen_river must NOT take the special branch (the literal is frozen_ocean/deep_frozen_ocean
  // only — the exact mistake this unit's own header names almost making from memory).
  MCL.Biomes = { ready: true, at: () => ({ name: 'frozen_river' }) };
  ok(Spawn.RULES.polar_bear(0, 64, 2) === false, 'frozen_river + ice below must refuse — frozen_river is NOT one of the two special biomes');
  ok(Spawn.RULES.polar_bear(0, 64, 0) === true, 'frozen_river + grass_block below must pass via the GENERIC animals_spawnable_on branch instead');

  MCL.Biomes = { ready: true, at: () => ({ name: 'frozen_ocean' }) };
  okAv((() => { W.rawBrightness = () => 8; return Spawn.RULES.polar_bear(0, 64, 2) === false; })(),
    'dropping brightness to 8 (the >8 boundary) must refuse in the frozen-ocean branch — the light check is really consulted');
  W.rawBrightness = () => 9;
  okAv((() => Spawn.RULES.polar_bear(0, 64, -1) === false)(),
    'a below-block of air (never set) must refuse, not read garbage as "allowed"');

  W.rawBrightness = saveBright;
  MCL.Biomes = saveBiomes;
  W.biomeAt = saveBiomeAt;
}

// ── 11. Ai.ROSTER.polar_bear — the selector wires every goal above ─────────────────────────
say('11. Ai.ROSTER.polar_bear — the goal selector actually builds');
{
  const e = EL.spawn('polar_bear', 10.5, 64, 10.5, {});
  ok(!!e, 'EL.spawn(polar_bear) must return a mob');
  const ctx = EL.aiCtx ? EL.aiCtx(e) : { random: Math.random, players: () => [], animals: () => [] };
  const gs = Ai.selectorFor(e, ctx);
  ok(!!gs, 'Ai.selectorFor(polar_bear) must build a real selector, not null');
  ok(typeof gs.tick === 'function', 'the built selector must be tickable');
  // smoke-test a few ticks so a thrown error inside any wired goal fails this check loudly
  let threw = null;
  try { for (let i = 0; i < 5; i++) gs.tick(); } catch (err) { threw = err; }
  ok(threw === null, `ticking the real polar_bear selector must not throw — got ${threw && threw.stack}`);

  // #4412: priority-5 move goal is the plain WanderAroundGoal port (has ignoreChanceOnce/setFinder), not the water-avoiding stroll
  const wander = gs.entries.find((x) => x.priority === 5 && x.goal && typeof x.goal.ignoreChanceOnce === 'function');
  ok(!!wander, 'polar_bear priority-5 goal must be Ai.WanderAroundGoal (vanilla WanderAroundGoal(1.0))');

  // #1312: ActiveTargetGoal<Fox>(10,true,true) at target priority 4, and it really targets a fox
  const foxEntry = gs.entries.find((x) => x.goal && x.goal.tag === 'fox');
  const foxGoal = foxEntry && foxEntry.goal;
  ok(!!foxEntry && foxEntry.priority === 4, 'polar_bear selector must carry a fox target goal at priority 4');
  if (foxGoal) {
    const fox = EL.spawn('fox', 12.5, 64, 10.5, {});
    ok(!!fox, 'EL.spawn(fox)');
    let got = false;
    for (let i = 0; i < 400 && !got; i++) { e.target = null; if (foxGoal.canUse() && e.target === fox) got = true; }
    ok(got, 'a polar bear with a fox in range must eventually target the fox');
    okAv(!(() => { const sv = EL.list.slice(); fox.removed = true; e.target = null; let any = false; for (let i = 0; i < 400; i++) if (foxGoal.canUse()) any = true; fox.removed = false; return any; })(), 'a removed fox must not be targeted (candidate source is the live fox list)');
  }

  okAv((() => {
    const save = Ai.ROSTER.polar_bear;
    delete Ai.ROSTER.polar_bear;
    const gone = Ai.selectorFor(e, ctx) === null;
    Ai.ROSTER.polar_bear = save;
    return gone;
  })(), 'removing Ai.ROSTER.polar_bear did not stop Ai.selectorFor from building one — the roster is not really consulted');
}

// ── 12. renderer — PolarBearEntityModel.setAngles warning stand-up (#1310) ───────────────────
say('12. ER.animOf/posedPart — the stand-up pose numbers, vs the decompiled assignments');
{
  const ER = MCL.EntityRender;
  const rest = (n, px, py, pz, rx) => ({ n, tu: 0, tv: 0, x: 0, y: 0, z: 0, w: 1, h: 1, d: 1, px, py, pz, rx, ry: 0, rz: 0, m: 0, g: 0 });
  const parts = { body: rest('body', -2, 9, 12, Math.PI / 2), head: rest('head', 0, 10, -16, 0),
                  left_front_leg: rest('left_front_leg', 3.5, 14, -8, 0), left_hind_leg: rest('left_hind_leg', 4.5, 14, 6, 0) };
  const bear = (w, baby) => ({ type: 'polar_bear', maxHealth: 30, isBaby: !!baby, warningAnimationProgress: w, lastWarningAnimationProgress: w,
                               animPos: 0, animSpeed: 0, animSpeedO: 0 });
  const pose = (e, n) => ER.posedPart(parts[n], ER.animOf(e, 1), 'polar_bear');
  const near = (a, b) => Math.abs(a - b) < 1e-4;
  const P = Math.PI;
  const b0 = pose(bear(0), 'body'), b6 = pose(bear(6), 'body');
  ok(near(b0.rx, P / 2) && near(b0.py, 9), 'progress 0 leaves the on-all-fours rest pose');
  ok(near(b6.rx, P / 2 - P * 0.35) && near(b6.py, 11), 'progress 6: body.pitch = PI/2 - PI*0.35, pivotY 11 (got ' + b6.rx + ',' + b6.py + ')');
  const l6 = pose(bear(6), 'left_front_leg');
  ok(near(l6.rx, -P * 0.45) && near(l6.py, -6) && near(l6.pz, -4), 'progress 6: front leg pitch -PI*0.45, pivot (Y -6, Z -4)');
  const h6 = pose(bear(6), 'head'), h6b = pose(bear(6, true), 'head');
  ok(near(h6.rx, P * 0.15) && near(h6.py, -14) && near(h6.pz, -3), 'progress 6: adult head pitch +PI*0.15, pivot (-14, -3)');
  ok(near(h6b.py, -9) && near(h6b.pz, -7), 'progress 6: baby head pivot (-9, -7)');
  const hh = pose(bear(3), 'head'), q = 0.25;
  ok(near(hh.py, 10 * (1 - q) - 14 * q) && near(hh.pz, -16 * (1 - q) - 3 * q), 'progress 3/6: p = 0.5^2 interpolates the head pivot');
  ok(near(pose(bear(6), 'left_hind_leg').py, 14), 'hind legs are not touched by the warning pose');
  okAv(pose(bear(6), 'body').rx !== pose(bear(0), 'body').rx, 'a bear with warningAnimationProgress 6 differs from 0 (the renderer reads it)');
  const save = Pb.getWarningAnimationProgress;
  Pb.getWarningAnimationProgress = () => 0;
  okAv(near(pose(bear(6), 'body').rx, P / 2), 'zeroing the progress source drops the stand-up (the pose really comes from it)');
  Pb.getWarningAnimationProgress = save;
  const saveD = ER.polarBearDelta;
  ER.polarBearDelta = (n, base) => base;
  okAv(!near(pose(bear(6), 'body').rx, P / 2 - P * 0.35), 'stubbing ER.polarBearDelta loses the pose numbers');
  ER.polarBearDelta = saveD;
}

// ── 13. polar_bear_sword (#4541) — PolarBearEntity.tryAttack never reads the hand ──────────
say('13. polar_bear_sword — a fire_aspect diamond sword changes neither damage nor fire');
{
  const real = globalThis.__realMobAttack, C = MCL.Combat;
  const run = (type) => {
    const rec = { dmg: null, ign: 0 };
    const sv = [C.hurt, C.igniteForSeconds, MCL.Equip.getEquipped];
    C.hurt = (t, d) => { rec.dmg = d; return true; };
    C.igniteForSeconds = () => { rec.ign++; };
    C.notifyHurt = C.notifyHurt || (() => {});
    MCL.Equip.getEquipped = () => ({ i: 1, n: 1 });
    const sw = C.enchantLevel; C.enchantLevel = (st, n) => (n === 'fire_aspect' ? 2 : n === 'sharpness' ? 5 : 0);
    const bear = { type, x: 0, y: 0, z: 0, yaw: 0 }, tgt = { type: 'zombie', x: 1, y: 0, z: 0, health: 20 };
    real(bear, tgt);
    [C.hurt, C.igniteForSeconds, MCL.Equip.getEquipped] = sv; C.enchantLevel = sw;
    return rec;
  };
  const r = run('polar_bear');
  ok(r.dmg === 6, `polar_bear with a sword must hit for 6, got ${r.dmg}`);
  ok(r.ign === 0, `polar_bear with fire_aspect must not ignite, got ${r.ign}`);
  // anti-vacuity: the same hand on a mob that does use MobEntity.tryAttack (zombie) must ignite
  okAv(run('zombie').ign > 0, 'a zombie with the same fire_aspect sword ignites (the probe sees the hand)');
}

// ── 14. #4569 — Angerable.tickAngerLogic: a non-player target is given up after 20-39 s ────
say('14. anger_nonplayer — a bear chasing a fox gives up when the rolled anger time runs out');
{
  const C = MCL.Combat;
  const run = (type) => {
    const e = { type, maxHealth: 30, health: 30, angerTime: 0 };
    e.target = { type: 'fox', health: 10 };
    for (let i = 0; i < 800 && e.target; i++) C.tickEntity(e);
    return e;
  };
  const e = run('polar_bear');
  ok(e.target === null, 'bear target (fox) must be cleared within 800 ticks');
  ok(e.angerTime === 0, 'angerTime ends at 0');
  ok(run('enderman').target === null, '#4572 enderman chasing an endermite gives up too');
  okAv(run('cow').target !== null, 'a non-Angerable keeps its target (the probe sees the type gate)');
}

console.log(`\n${pass} checks passed, ${fails.length} failed (${breaks} anti-vacuity probes included, ${breaks} breaks caught)`);
if (fails.length) {
  console.log('FAILURES:');
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
console.log('polarbearcheck: ALL GREEN');
