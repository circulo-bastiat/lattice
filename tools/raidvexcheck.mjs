#!/usr/bin/env node
// raidvexcheck.mjs — QUEUE 0.2 raid loop (loop/raidvex-s96): THE VEX, and the witch's real
// raid-ally heal targeting. Proves:
//   (a) `vex` is a real, moving, flying, targeting, life-ticked mob — `Fl.VexMoveControl`
//       (07t_fly.js, `VexEntity.VexMoveControl`), its goals (`Ai.ROSTER.vex`, 07k_goals.js:
//       SwimGoal/ChargeTargetGoal/LookAtTargetGoal/TrackOwnerTargetGoal/RevengeGoal/player
//       targeting), and `EvokerEntity.SummonVexGoal` (`SP.SummonVexGoal`, 07v_spell.js) —
//       already proven end-to-end by `spellcheck.mjs`'s own §6, not repeated here.
//   (b) `Ai.RaidGoal`/`Ai.DisableableFollowTargetGoal` (07k_goals.js's own witch roster entry)
//       really hand a witch a nearby raider ally to heal/buff, gated on an ONGOING raid the
//       same way `WitchEntity.tickMovement()`'s own `raidGoal`/`attackPlayerGoal` toggle is.
//
// Against REAL `EL.spawn`'d mobs run through the live `EL.tick()` loop, the same standard
// `raidmobcheck.mjs`/`spellcheck.mjs`/`witchpotioncheck.mjs` already hold themselves to.
//
//   node tools/raidvexcheck.mjs [--verbose]

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

console.log('raidvexcheck — QUEUE 0.2 raid loop: the vex, and the witch\'s real raid-ally heal targeting');

const M = loadEngine({
  extra: ['07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
          '14i_hand.js', '14j_combat.js', '14d_survival.js', '07q_effects.js', '07z_potion.js',
          '07v_spell.js', '07k_goals.js', '07t_fly.js', '07s_raid.js']
});
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8'))
});
M.Entities.init();
M.EntityList.init();
M.Hand.init();
M.Combat.init();
M.Ai.init();
M.Raid.init();
ok(M.Entities.ready, 'the entity table loaded');
ok(M.Ai.ready, 'Ai module reports ready');
ok(M.Fly.ready, 'Fly module reports ready');
ok(M.Raid.ready, 'Raid module reports ready');

const EL = M.EntityList, Ai = M.Ai, Cb = M.Combat, W = M.World, CH = M.CH, Fl = M.Fly;
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
function mkPlayer(over) {
  return Object.assign({
    x: 0, y: PLAT_Y + 1, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0, slot: 0, inventory: null,
    sprinting: false, onGround: true, fallDistance: 0, onClimbable: false, inWater: false,
    walkDist: 0, walkDistO: 0, speed: 0.1, health: 20
  }, over || {});
}

// ═══ 1. Fl.VexMoveControl — VexEntity.VexMoveControl, unit-level ═══════════════════════════
console.log('\n 1. Fl.VexMoveControl — moveTo steers, stops within avgSide, halves velocity on arrival');
{
  const e = { x: 0, y: 10, z: 0, vx: 0, vy: 0, vz: 0, width: 0.4, height: 0.8, noGravity: false };
  const mc = new Fl.VexMoveControl(e);
  ok(!mc.isMoving(), 'a fresh control is not moving');
  mc.moveTo(10, 10, 0, 1.0);
  ok(mc.isMoving(), 'moveTo() sets isMoving() true');
  mc.tick();
  ok(e.noGravity === true, 'a single tick() sets e.noGravity — VexEntity.tick()\'s own unconditional setNoGravity(true)');
  ok(e.vx > 0 && Math.abs(e.vz) < 1e-9, 'velocity gained a real +x component toward the target, and no z drift toward a straight-x target');
  const yawAtStep1 = e.yaw;
  ok(typeof yawAtStep1 === 'number' && !Number.isNaN(yawAtStep1), 'yaw is set off the real velocity vector (no target)');
  // Run it to (near) arrival.
  // `mc.tick()` only ever updates VELOCITY (`e.vx`/`vy`/`vz`) — vanilla's own split between
  // a MoveControl and the entity's real `move()`/travel step (`Fl.travelMob`, in live play);
  // integrate position by hand here, the same plain Euler step `Ph.move` does when nothing
  // is in the way, so this unit test does not need the whole Physics/World substrate.
  let arrived = false;
  for (let i = 0; i < 2000 && !arrived; i++) {
    mc.tick();
    e.x += e.vx; e.y += e.vy; e.z += e.vz;
    if (!mc.isMoving()) arrived = true;
  }
  ok(arrived, 'repeated tick()s eventually arrive (isMoving() goes false) rather than oscillating forever');
  ok(Math.hypot(e.x - 10, e.y - 10, e.z - 0) < 1.0, 'the control actually converges near its target, not just flips a flag');
}
// ANTI-VACUITY — a control given a target it ALREADY occupies stops on the very first tick,
// proving the avgSide arrival test is a real distance check, not one that never fires.
{
  const e = { x: 5, y: 5, z: 5, vx: 1, vy: 1, vz: 1, width: 0.4, height: 0.8, noGravity: false };
  const mc = new Fl.VexMoveControl(e);
  mc.moveTo(5, 5, 5, 1.0);
  mc.tick();
  okAv(!mc.isMoving() && e.vx === 0.5 && e.vy === 0.5 && e.vz === 0.5,
    'moveTo() to the control\'s own current position arrives immediately and halves existing velocity (0.5x), not full-speed-forever');
}

// ═══ 2. a live vex — noGravity really holds it up, contrasted with a mob that falls ════════
console.log('\n 2. a live-spawned vex does not fall (noGravity); a live-spawned vindicator does');
{
  freshWorld();
  const vex = EL.spawn('vex', 0, 30, 0);
  ok(!!vex, 'EL.spawn(\'vex\') returns a live entity with no platform below it at all');
  ok(!!vex.ai && vex.ai instanceof Ai.GoalSelector, 'the spawned vex carries a real GoalSelector (Ai.ROSTER.vex wired)');
  ok(!!vex.flyMove, 'the spawned vex carries a real Fl.VexMoveControl (e.flyMove)');
  // #4301: vanilla SwimGoal.setControls(EnumSet.of(JUMP)) only — MOVE would preempt ChargeTargetGoal/LookAtTargetGoal in water
  const sw = vex.ai.entries.find((en) => en.goal instanceof Ai.SwimGoal);
  ok(!!sw && sw.priority === 0 && sw.flags === Ai.JUMP, 'vex SwimGoal is priority 0 and controls JUMP only (vanilla SwimGoal.java:12)');
  okAv(!!sw && sw.flags !== (Ai.MOVE | Ai.JUMP), 'anti-vacuity: the pre-fix MOVE|JUMP mask is distinguishable from the vex flags');
  const y0 = vex.y;
  for (let t = 0; t < 60; t++) EL.tick();
  // `Ai.VexLookAtTargetGoal` legitimately wanders it (real vanilla behaviour, no ground
  // below to bias it toward) — the bound below is loose ON PURPOSE, wide enough to absorb
  // that wander yet far tighter than real freefall (`Ph.GRAVITY` accelerates a falling mob
  // roughly 60+ blocks over 60 ticks, the §2b anti-vacuity assertion below proves that scale).
  ok(Math.abs(vex.y - y0) < 15, `a vex with nothing to chase drifts only within a bounded wander over 60 ticks (${y0.toFixed(2)} -> ${vex.y.toFixed(2)}), not free-falling`);
  EL.clear();
}
{
  // ANTI-VACUITY — a vindicator dropped from the same height DOES fall, proving the harness
  // can tell "held up" from "nothing was ticking" at all.
  freshWorld();
  const vind = EL.spawn('vindicator', 0, 30, 0);
  const y0 = vind.y;
  for (let t = 0; t < 60; t++) EL.tick();
  okAv(vind.y < y0 - 5, 'a live vindicator with nothing below it DOES fall over 60 ticks — the vex\'s own stillness above is noGravity, not a frozen world');
  EL.clear();
}

// ═══ 3. Ai.ChargeTargetGoal — a live vex closes on and strikes the real player ══════════════
console.log('\n 3. a live vex targets, charges and strikes the real player (Combat.mobAttack)');
{
  freshWorld(); plate(20);
  M.Player = mkPlayer({ x: 3, y: PLAT_Y + 1, z: 0, health: 20 });
  // `Ai.VexLookAtTargetGoal`'s own wander (real vanilla priority-8 MOVE goal) can win the
  // MOVE flag for long stretches at a slow 0.25 speed, starving `ChargeTargetGoal`'s own
  // `!isMoving()` gate of the instant its 1/7 roll needs — genuinely bad luck over a FIXED
  // tick budget, not a broken goal (`Math.random()` is not seeded). Biasing the SAME roll
  // both goals share toward an immediate pass removes that luck without touching either
  // goal's own logic — `nextInt(7)===0` on a constant `rand()<1/7` is always true. This
  // MUST be set BEFORE `EL.spawn` — `Ai.ChargeTargetGoal`/`Ai.VexLookAtTargetGoal` each
  // capture `ctx.random` ONCE in their own closure at construction (spawn) time, the same
  // "goals aim" split this file's own header cites, so overriding it any later never reaches them.
  const origRandom = Math.random;
  Math.random = () => 0.01;
  const vex = EL.spawn('vex', 0, PLAT_Y + 1, 0);
  let hit = false;
  for (let t = 0; t < 400 && !hit; t++) { EL.tick(); if (M.Player.health < 20) hit = true; }
  Math.random = origRandom;
  ok(hit, 'the player takes real damage from a live vex within 400 ticks (ChargeTargetGoal + Combat.mobAttack)');
  EL.clear();
}
// #762: ChargeTargetGoal aims at the target's EYE y and only hits on real AABB overlap.
{
  freshWorld(); plate(20);
  M.Player = mkPlayer({ x: 3, y: PLAT_Y + 1, z: 0, health: 20 });
  const origRandom = Math.random; Math.random = () => 0.01;
  const vex = EL.spawn('vex', 0, PLAT_Y + 1, 0);
  const calls = []; const mt = vex.flyMove.moveTo;
  vex.flyMove.moveTo = function (x, y, z, s) { if (vex.charging) calls.push(y); return mt.apply(this, arguments); };
  let dmgDist = -1;
  for (let t = 0; t < 400 && dmgDist < 0; t++) {
    EL.tick();
    if (M.Player.health < 20) dmgDist = Math.hypot(vex.x - M.Player.x, vex.z - M.Player.z);
  }
  Math.random = origRandom; // the loop stays biased: unbiased wander drift made the 400-tick strike a coin flip (#2082)
  const eyeY = PLAT_Y + 1 + (M.Survival && M.Survival.eyeHeight ? M.Survival.eyeHeight(M.Player) : 1.62);
  ok(calls.length > 0 && calls.every((y) => Math.abs(y - eyeY) < 1e-6), 'ChargeTargetGoal moveTo y == target EYE y');
  okAv(calls.some((y) => Math.abs(y - (PLAT_Y + 1)) < 1e-6) === false, 'no moveTo aims at the target feet y');
  ok(dmgDist >= 0 && dmgDist <= (vex.width + (M.Player.width || 0.6)) / 2 + 1e-6, 'a vex hit needs AABB overlap (horizontal gap <= half widths)');
  EL.clear();
}
// ANTI-VACUITY — a vex with no reachable target (player far outside followRange) never
// strikes, proving the hit above is the real targeting/charge gate, not free damage.
{
  freshWorld(); plate(20);
  M.Player = mkPlayer({ x: 500, y: PLAT_Y + 1, z: 500, health: 20 });
  const vex = EL.spawn('vex', 0, PLAT_Y + 1, 0);
  for (let t = 0; t < 400; t++) EL.tick();
  okAv(M.Player.health === 20, 'with the player far outside followRange, the same vex never lands a hit in 400 ticks');
  EL.clear();
}

// ═══ 3b. Ai.VexLookAtTargetGoal — moveTo at block CENTRE (y+0.5), look via LookControl ═════
console.log('\n 3b. Ai.VexLookAtTargetGoal moves to (x+.5, y+.5, z+.5) and looks with 180/20');
{
  freshWorld();
  const calls = [], looks = [];
  const e = { type: 'vex', x: 0.5, y: 40, z: 0.5, target: null, bounds: null,
    flyMove: { isMoving: () => false, moveTo: (...a) => calls.push(a) },
    look: { setLookAt: (...a) => looks.push(a) } };
  const g = new Ai.VexLookAtTargetGoal(e, { random: () => 0.5 });
  g.tick();
  // rand 0.5 -> nextInt(15)-7 = 0, nextInt(11)-5 = 0, nextInt(15)-7 = 0: the vex's own block
  ok(calls.length === 1 && calls[0][0] === 0.5 && calls[0][1] === 40.5 && calls[0][2] === 0.5 && calls[0][3] === 0.25,
    'moveTo target is the block centre incl. y+0.5, speed 0.25 (' + JSON.stringify(calls[0]) + ')');
  ok(looks.length === 1 && looks[0][1] === 40.5 && looks[0][3] === Math.PI && Math.abs(looks[0][4] - 20 * Math.PI / 180) < 1e-9,
    'no target: LookControl.setLookAt(x+.5,y+.5,z+.5, 180, 20) is used');
  const yaw0 = e.yaw;
  ok(yaw0 === undefined, 'the goal does not assign e.yaw directly');
  e.target = { x: 1, y: 1, z: 1 }; looks.length = 0; g.tick();
  okAv(looks.length === 0, 'with a combat target the goal does not look at the wander point');
}

// ═══ 4. Ai.TrackOwnerTargetGoal — a vex without its own target inherits its owner's ═════════
console.log('\n 4. Ai.TrackOwnerTargetGoal — a vex with no target of its own tracks its live owner\'s target');
{
  const owner = { type: 'evoker', x: 0, y: 0, z: 0, removed: false, target: { x: 5, y: 0, z: 0, id: 999 } };
  const vex = { type: 'vex', x: 0, y: 0, z: 0, target: null, owner };
  const goal = new Ai.TrackOwnerTargetGoal(vex);
  ok(goal.canUse(), 'canUse() is true while the owner is alive and has its own target');
  goal.start();
  ok(vex.target === owner.target, 'start() copies the owner\'s own target onto the vex');
  ok(goal.canContinueToUse(), 'canContinueToUse() holds while the target stays within followRange');
  vex.target.x = 10000;
  ok(!goal.canContinueToUse(), 'canContinueToUse() fails once the target leaves followRange');
}
// s765: an owner whose target is a creative-mode player is not adopted (canTrack's TargetPredicate).
{
  const pl = { type: 'player', id: 7, invulnerableGamemode: true, x: 5, y: 0, z: 0 };
  const owner = { type: 'evoker', x: 0, y: 0, z: 0, removed: false, target: pl };
  const vex = { type: 'vex', x: 0, y: 0, z: 0, target: null, owner };
  okAv(!new Ai.TrackOwnerTargetGoal(vex).canUse(), 'canUse() refuses a creative-mode owner target');
  pl.invulnerableGamemode = false;
  ok(new Ai.TrackOwnerTargetGoal(vex).canUse(), 'canUse() accepts the same player in survival');
  vex.target = pl; pl.invulnerableGamemode = true;
  okAv(!new Ai.TrackOwnerTargetGoal(vex).canContinueToUse(), 'canContinueToUse() drops a target that turned creative');
}
// ANTI-VACUITY — with no owner (or an owner with no target), the goal never starts.
{
  const vex = { type: 'vex', x: 0, y: 0, z: 0, target: null, owner: null };
  okAv(!new Ai.TrackOwnerTargetGoal(vex).canUse(), 'with no owner at all, TrackOwnerTargetGoal.canUse() is false');
  const vex2 = { type: 'vex', x: 0, y: 0, z: 0, target: null, owner: { removed: false, target: null } };
  okAv(!new Ai.TrackOwnerTargetGoal(vex2).canUse(), 'with an owner that has no target of its own, canUse() is false');
}

// ═══ 5. Ai.RevengeGoal — group revenge among vex, and the RAIDER_TYPES exclusion ═══════════
console.log('\n 5. Ai.RevengeGoal — a hurt vex avenges, and alerts every OTHER idle vex nearby');
{
  const player = { type: 'player', id: 1 };
  const e = { type: 'vex', x: 0, y: 0, z: 0, target: null, lastHurtByEntity: player, hurtSeq: 1, removed: false };
  const mate = { type: 'vex', x: 1, y: 0, z: 0, target: null, removed: false };
  const busyMate = { type: 'vex', x: 1, y: 0, z: 0, target: { fake: true }, removed: false };
  const ctx = { animals: () => [mate, busyMate] };
  const goal = new Ai.RevengeGoal(e, ctx, { noRevengeTypes: Ai.RAIDER_TYPES, group: true });
  ok(goal.canUse(), 'canUse() is true on a fresh hit (hurtSeq advanced past last-seen)');
  goal.start();
  ok(e.target === player, 'start() sets the vex\'s own target to its attacker');
  ok(mate.target === player, 'group revenge alerts an OTHER idle vex to the same attacker');
  ok(busyMate.target !== player, 'group revenge does NOT overwrite a mate that already has its own target');
  ok(!goal.canUse(), 'canUse() is false again right after — the same hurtSeq is not a fresh hit twice');
}
// ANTI-VACUITY — an attacker of a RAIDER_TYPES type is excluded (currently unreachable in live
// play, named on Ai.RevengeGoal's own header, but the CODE PATH itself must still be real).
{
  const attacker = { type: 'witch' };
  const e = { type: 'vex', x: 0, y: 0, z: 0, target: null, lastHurtByEntity: attacker, hurtSeq: 1 };
  const goal = new Ai.RevengeGoal(e, {}, { noRevengeTypes: Ai.RAIDER_TYPES, group: true });
  okAv(!goal.canUse(), 'an attacker of a RAIDER_TYPES type (witch) is excluded — noRevengeTypes actually filters, not just documents');
}

// ═══ 6. VexEntity.tick()'s life-ticks half — Fl.tickVexLife (SUMMONED vex only) ═════════════
console.log('\n 6. Fl.tickVexLife — a summoned vex starves for 1.0 damage every 20 ticks; an unsummoned one never does');
{
  const hurts = [];
  const ctx = { hurt: (t, amt) => hurts.push(amt) };
  const e = { vexAlive: true, vexLifeTicks: 3, health: 14 };
  for (let t = 0; t < 3; t++) Fl.tickVexLife(e, ctx);
  ok(hurts.length === 1 && hurts[0] === 1.0, 'exactly one 1.0-damage starve call fires the tick lifeTicks reaches 0');
  ok(e.vexLifeTicks === 20, 'lifeTicks resets to 20 after the starve tick, matching VexEntity.tick()\'s own literal');
}
// #4404 -- the starve hit carries STARVE's flags and lands as exactly 1.0 on an armoured, Resistant vex.
{
  freshWorld();
  let seen;
  Fl.tickVexLife({ vexAlive: true, vexLifeTicks: 1 }, { hurt: (t, amt, src) => { seen = src; } });
  ok(seen && seen.bypassArmor === true && seen.unblockable === true && seen.source === 'starve', 'tickVexLife passes {bypassArmor, unblockable, source:starve}');
  const v = EL.spawn('vex', 0, PLAT_Y + 1, 0);
  v.armorBonus = 20; v.health = 10; v.vexAlive = true; v.vexLifeTicks = 1;
  M.Effects.addStatusEffect(v, 'resistance', 200, 3);
  Fl.tickVexLife(v, EL.aiCtx(v));
  ok(v.health === 9, 'armoured Resistance-IV vex loses exactly 1.0 to starve, got ' + (10 - v.health));
  const w = EL.spawn('vex', 4, PLAT_Y + 1, 0);
  w.armorBonus = 20; w.health = 10;
  Cb.hurt(w, 1.0, undefined, false, undefined);
  okAv(w.health > 9, 'the same vex hit by a plain blow IS reduced by armour (check can fail)');
}
// ANTI-VACUITY — a vex never summoned (e.vexAlive unset) never starves, no matter how long it ticks.
{
  const hurts = [];
  const ctx = { hurt: (t, amt) => hurts.push(amt) };
  const e = { vexLifeTicks: 1 };
  for (let t = 0; t < 100; t++) Fl.tickVexLife(e, ctx);
  okAv(hurts.length === 0, 'a vex with no e.vexAlive flag never takes starve damage in 100 ticks');
}

// ═══ 7. Ai.RaidGoal / Ai.DisableableFollowTargetGoal — the witch's real raid-ally heal ═════
console.log('\n 7. a live witch, mid-ONGOING-raid, targets and heals a nearby hurt raider ally');
{
  freshWorld(); plate(20);
  M.Player = mkPlayer({ x: 2, y: PLAT_Y + 1, z: 0, health: 20 });
  // `Ai.RaidGoal`'s own 50% `nextBoolean()` roll (`RaidGoal.canStart`, javap'd) reads
  // `ctx.random`, captured ONCE by `Ai.ROSTER.witch` at SPAWN time (the same construction-
  // time-capture shape `Ai.ChargeTargetGoal`'s own header two sections up already hit) —
  // bias it BEFORE `EL.spawn('witch', ...)`, not after, or the override never reaches it.
  // `Ai.RaidGoal.canUse`'s own gate is `if (rand() < 0.5) return false;` (refuses on the
  // LOW half) — 0.99 always clears it, the opposite bias `Ai.ChargeTargetGoal`'s own
  // `Math.floor(rand()*7)===0` gate two sections up needed (that one needed a LOW value).
  const origRandom = Math.random;
  Math.random = () => 0.99;
  const witch = EL.spawn('witch', 0, PLAT_Y + 1, 0);
  const ally = EL.spawn('vindicator', -3, PLAT_Y + 1, 0);
  ally.health = 4; ally.maxHealth = 24;
  const raidId = M.RaidManager.world.nextId++;
  // `center` -- `RaiderEntity.addRaiderGoals`' own `MoveToRaidCenterGoal` (every raider
  // roster entry gets it, `Ai.addRaiderGoals`) reads `raid.center` the instant its own
  // `!e.target` gate is still open; a minimal fixture raid needs it too, not just `status`.
  M.RaidManager.world.raids[raidId] = { status: M.Raid.Status.ONGOING, center: { x: 0, y: PLAT_Y + 1, z: 0 } };
  witch.raidId = raidId;
  let healed = false;
  for (let t = 0; t < 600 && !healed; t++) { EL.tick(); if (witch.target === ally || ally.health > 4) healed = true; }
  Math.random = origRandom;
  ok(healed, 'the witch targets (or has already healed) the hurt raider ally within 600 ticks, mid-ONGOING raid');
  EL.clear();
}
// ANTI-VACUITY — with no active raid at all, the same setup never targets the ally (falls
// back to ordinary player targeting instead) — proving RaidGoal's own gate is real.
{
  freshWorld(); plate(20);
  M.Player = mkPlayer({ x: 2, y: PLAT_Y + 1, z: 0, health: 20 });
  const witch = EL.spawn('witch', 0, PLAT_Y + 1, 0);
  const ally = EL.spawn('vindicator', -3, PLAT_Y + 1, 0);
  ally.health = 4; ally.maxHealth = 24;
  // no raidId assigned to either mob, and RaidManager.world.raids stays empty.
  let sawAllyTarget = false;
  for (let t = 0; t < 600; t++) { EL.tick(); if (witch.target === ally) sawAllyTarget = true; }
  okAv(!sawAllyTarget, 'with no active raid, the witch never targets the raider ally in 600 ticks');
  EL.clear();
}
// ANTI-VACUITY — Ai.RaidGoal itself, unit-level: canUse() is false while e.witchRaidCooldown
// is still positive, even with an ongoing raid and a reachable ally.
{
  const ally = { type: 'vindicator', x: 1, y: 0, z: 0, dead: false, removed: false };
  const witch = { type: 'witch', x: 0, y: 0, z: 0, target: null, witchRaidCooldown: 50 };
  const raidId = 7;
  M.RaidManager.world.raids[raidId] = { status: M.Raid.Status.ONGOING };
  witch.raidId = raidId;
  const savedList = EL.list.slice();
  EL.list.length = 0; EL.list.push(ally);
  const goal = new Ai.RaidGoal(witch, { random: () => 0 });
  okAv(!goal.canUse(), 'Ai.RaidGoal.canUse() is false while e.witchRaidCooldown is still positive, even with a reachable ally');
  EL.list.length = 0; EL.list.push(...savedList);
}

// ═══ 8. Fl.travelMob — a vex's own noClip bracket (VexEntity.tick()'s `this.noClip = true` ..
// `super.tick()` .. `this.noClip = false`, .decomp VexEntity.java:68-72) ═══════════════════
console.log('\n 8. Fl.travelMob — a vex passes clean through a solid wall (noClip); a non-vex mob does not');
{
  freshWorld();
  plate(20);
  // a solid stone wall spanning the mob's whole AABB height, one block thick, at x=5
  for (let z = -3; z <= 3; z++) for (let y = PLAT_Y + 1; y <= PLAT_Y + 4; y++) W.setBlock(5, y, z, STONE);

  // dx=5 from x=3 asks for x=8, well past the wall at x=5 — big enough that a REAL collision
  // clip (not just "hasn't reached the wall yet") is what tells the two cases apart.
  const vex = { type: 'vex', x: 3, y: PLAT_Y + 2, z: 0, vx: 5.0, vy: 0, vz: 0, zza: 0, yya: 0,
    width: 0.4, height: 0.8, onGround: false, noGravity: true, mobSpeed: 0, yaw: 0 };
  Fl.travelMob(vex);
  ok(vex.x > 5, `a vex's own Fl.travelMob call passes straight through the wall (VexEntity.java:68-72's own noClip bracket), got x=${vex.x}`);
  ok(!vex.noclip, 'and e.noclip is restored to falsy afterward — "restore after tick like the source", not left permanently true');

  // anti-vacuity(direction): the SAME wall, the SAME dx=5, the SAME Fl.travelMob call, a
  // NON-vex mob — proves the pass-through above is the vex's own bypass, and that dx=5 really
  // would have hit the wall for anything that does not carry it.
  const other = { type: 'vindicator', x: 3, y: PLAT_Y + 2, z: 0, vx: 5.0, vy: 0, vz: 0, zza: 0, yya: 0,
    width: 0.6, height: 1.95, onGround: false, noGravity: true, mobSpeed: 0, yaw: 0 };
  Fl.travelMob(other);
  okAv(other.x < 5, `anti-vacuity: the identical wall really blocks a non-vex mob run through the SAME Fl.travelMob call (dx=5), got x=${other.x}`);

  // anti-vacuity(state): a vex that already had e.noclip=true for some OTHER reason keeps it
  // true afterward — Fl.travelMob restores the PRIOR value, it does not force it false.
  const vex2 = { type: 'vex', x: 3, y: PLAT_Y + 2, z: 0, vx: 5.0, vy: 0, vz: 0, zza: 0, yya: 0,
    width: 0.4, height: 0.8, onGround: false, noGravity: true, mobSpeed: 0, yaw: 0, noclip: true };
  Fl.travelMob(vex2);
  okAv(vex2.noclip === true, 'anti-vacuity: a vex with a pre-existing e.noclip=true keeps it true after the call — the wrap restores the PRIOR value, not a hard-coded false');
}

// ════════════════════════════════════════════════════════════════════════════════════════
console.log('');
if (fails.length) {
  console.log(`FAILED (${fails.length}):`);
  for (const f of fails) console.log('  - ' + f);
  console.log(`\n${pass} checks passed, ${breaks} anti-vacuity breaks proven, ${fails.length} FAILED`);
  process.exit(1);
} else {
  console.log(`PASS raidvexcheck — ${pass} assertions, ${breaks} breaks caught, 0 failure(s)`);
}
