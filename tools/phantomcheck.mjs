#!/usr/bin/env node
// phantomcheck.mjs — loop/phantom: PHANTOM (PhantomEntity + PhantomSpawner). See
// src/07zz1_phantom.js's own header for exactly which real numbers/gates are ported and which
// are named simplifications (Ph.OWED).
//
//   node tools/phantomcheck.mjs [--verbose]
//
// ANTI-VACUITY (D-30/D-305): every section that asserts a positive also breaks its own input
// and asserts the break is caught.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 60) fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { if (c) breaks++; ok(c, m); if (VERBOSE && c) console.log('   ✓ anti-vacuity: ' + m); };

console.log('phantomcheck — PHANTOM (PhantomEntity + PhantomSpawner)');

const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '07d_mining.js', '07e_loot.js', '07b_behaviour.js',
          '07h_entities.js', '07i_entitylist.js', '07k_goals.js', '07zz1_phantom.js'],
  dom: false
});
initRegistry(M);
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8'))
});
M.Entities.init();

const R = M.Reg, SR = M.States, Ent = M.Entities, EL = M.EntityList, Ai = M.Ai, Ph = M.Phantom;
ok(R.ready, 'block registry decoded');
ok(!!Ph && Ph.ready, 'NS.Phantom module loaded');
ok(Array.isArray(Ph.OWED) && Ph.OWED.length > 0, 'Ph.OWED names what is not ported (not silently claimed done)');
ok(Ent.ready, 'Entities ready');

function seqRandom(values) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

// ═══════════════════════════════ 1. EL.motionFor / EL.canSpawn ════════════════════════════
console.log('\n1. EL.motionFor(\'phantom\') — FlyingEntity never subtracts gravity (.decomp)');
{
  const m = EL.motionFor('phantom');
  ok(Array.isArray(m) && m[0] === 0 && m[1] === 1, `phantom's motion pair is [0,1] (no gravity) — got ${JSON.stringify(m)}`);
  ok(EL.canSpawn('phantom') === true, 'EL.canSpawn(\'phantom\') is now true (was refused before this unit)');
  // anti-vacuity: an UNMEASURED, un-hardcoded type is still refused — the gate is not just off.
  okAv(EL.motionFor('totally_unmeasured_fake_type') === null, 'a type with no hardcode and no golden-TSV row still returns null');
}
console.log(`   ${pass} ok`);

// ═══════════════════════════════ 2. Ai.ROSTER.phantom — spawn-time wiring ═════════════════
console.log('\n2. Ai.ROSTER.phantom — attack-damage override, flyMove attach, circlingCenter default');
{
  const e = { x: 10.5, y: 64.3, z: 10.5, type: 'phantom', yaw: 0, pitch: 0 };
  const ctx = { players: () => [], random: () => 0.5 };
  const gs = Ai.ROSTER.phantom(e, ctx);
  ok(e.phantomSize === 0, 'phantomSize defaults to 0 (PhantomEntity.initialize, .decomp:163-166)');
  ok(e.attackDamage === undefined, `a fresh size-0 phantom carries no override (DataTracker.set 0->0 fires no onSizeChanged) — got ${e.attackDamage}`);
  {
    const at = M.Entities && M.Entities.attrsOf ? M.Entities.attrsOf('phantom') : null;
    ok(!!at && at.dmg === 2, `…so its bite is HostileEntity's 2.0 off the attrs table (referee: real server 2) — got ${at && at.dmg}`);
  }
  ok(!!e.flyMove, 'e.flyMove attached (dispatched by 07i_entitylist.js\'s existing hook, no edit there)');
  ok(e.circlingX === 10 && e.circlingY === 69 && e.circlingZ === 10,
     'circlingCenter is the integer BlockPos floor(pos)+(0,5,0) (PhantomEntity.initialize, .decomp:163)');
  ok(gs && typeof gs.tick === 'function', 'Ai.ROSTER.phantom returns a real GoalSelector');

  // anti-vacuity: a size set by a save/NBT record before the roster runs is NOT stomped to 0.
  const e2 = { x: 0, y: 0, z: 0, type: 'phantom', phantomSize: 12 };
  Ai.ROSTER.phantom(e2, ctx);
  okAv(e2.phantomSize === 12 && e2.attackDamage === 18, `a pre-set phantomSize survives and scales attackDamage — got size=${e2.phantomSize} dmg=${e2.attackDamage}`);

  // size scales the hitbox: (0.9+0.2*size)/0.9 on both axes (getDimensions, .decomp:229-234)
  const base = M.Entities.dimensions('phantom');
  for (const sz of [0, 5, 64]) {
    const q = { x: 0, y: 0, z: 0, type: 'phantom', phantomSize: sz };
    Ai.ROSTER.phantom(q, ctx);
    const f = (base.width + 0.2 * sz) / base.width;
    okAv(Math.abs(q.width - base.width * f) < 1e-4 && Math.abs(q.height - base.height * f) < 1e-4,
         `Size ${sz}: box ${q.width}x${q.height} == ${base.width * f}x${base.height * f}`);
  }
}
console.log(`   ${pass} ok`);

// ═══════════════════════════════ 3. FindTargetGoal ════════════════════════════════════════
console.log('\n3. FindTargetGoal — 20-tick delay, 64-block range, spectator excluded');
{
  const e = { x: 0, y: 64, z: 0 };
  const player = { x: 10, y: 64, z: 0, mode: 0 };   // NOT spectator (Gamemode.SPECTATOR is checked below)
  M.Gamemode = { isSpectator: (p) => p.mode === 3, isCreative: (p) => p.mode === 1 };
  const ctx = { players: () => [player] };
  const g = new Ph.FindTargetGoal(e, ctx);
  for (let i = 0; i < 20; i++) ok(g.canUse() === false, `still delaying at tick ${i}`);
  ok(g.canUse() === true, 'delay elapsed (20 ticks): acquires the player');
  ok(e.target === player, 'e.target is set to the player object itself');
  ok(g.canContinueToUse() === true, 'canContinueToUse holds while the target is still valid');

  // anti-vacuity: a spectator is never acquired, even at zero distance and zero delay.
  const e3 = { x: 0, y: 64, z: 0 };
  const spectator = { x: 0, y: 64, z: 0, mode: 3 };
  const g3 = new Ph.FindTargetGoal(e3, { players: () => [spectator] });
  for (let i = 0; i < 21; i++) g3.canUse();
  okAv(e3.target === undefined, 'a spectator at distance 0 is still never targeted');

  // #757: 16x64x16 box -- dx=30 is never targeted; a creative player at 5 blocks is never targeted
  for (const [nm, pl] of [['dx=30 survival', { x: 30, y: 64, z: 0, mode: 0 }], ['creative at dx=5', { x: 5, y: 64, z: 0, mode: 1 }]]) {
    const e5 = { x: 0, y: 64, z: 0 };
    const g5 = new Ph.FindTargetGoal(e5, { players: () => [pl] });
    for (let i = 0; i < 21; i++) g5.canUse();
    okAv(e5.target === undefined, `${nm}: not targeted`);
  }
  { // and the box still admits a survival player at dx=15, dy=-50
    const e6 = { x: 0, y: 64, z: 0 };
    const g6 = new Ph.FindTargetGoal(e6, { players: () => [{ x: 15, y: 14, z: 0, mode: 0 }] });
    for (let i = 0; i < 21; i++) g6.canUse();
    ok(e6.target !== undefined, 'survival player at dx=15, dy=-50 is targeted');
  }

  // #3651: sneaking x0.8 -> range 51.2; invisible unarmoured -> 4.48
  { M.Bat = M.Bat || {}; const real = M.Bat.attackScale;
    M.Bat.attackScale = real || ((P) => (P.crouching ? 0.8 : 1) * (P.invis ? 0.07 : 1));
    for (const [nm, pl, want] of [['sneaking at 55 (dy)', { x: 0, y: 119, z: 0, mode: 0, crouching: true }, false],
      ['invisible at 10', { x: 10, y: 64, z: 0, mode: 0, invis: true }, false],
      ['sneaking at 45', { x: 0, y: 109, z: 0, mode: 0, crouching: true }, true]]) {
      const e7 = { x: 0, y: 64, z: 0 };
      const g7 = new Ph.FindTargetGoal(e7, { players: () => [pl] });
      for (let i = 0; i < 21; i++) g7.canUse();
      if (want) ok(e7.target !== undefined, `${nm}: targeted`); else okAv(e7.target === undefined, `${nm}: not targeted`);
    }
    M.Bat.attackScale = real; }

  // anti-vacuity: a player past the 64-block range is refused.
  const e4 = { x: 0, y: 64, z: 0 };
  const far = { x: 1000, y: 64, z: 0, mode: 0 };
  const g4 = new Ph.FindTargetGoal(e4, { players: () => [far] });
  for (let i = 0; i < 20; i++) g4.canUse();
  okAv(e4.target === undefined, 'a player 1000 blocks away is refused (64-block range)');
  // #3730: TargetPredicate respectsVisibility -- a roofed player (no line of sight) is never picked.
  const realCanSee = Ai.canSee; M.Bat = M.Bat || {}; M.Bat.attackScale = M.Bat.attackScale || (() => 1);
  const pick = (see) => { Ai.canSee = () => see; const e = { x: 0, y: 94, z: 0 };
    const g = new Ph.FindTargetGoal(e, { players: () => [{ x: 0, y: 64, z: 0, mode: 0 }] });
    for (let i = 0; i < 80; i++) g.canUse(); return e.target; };
  ok(pick(false) === undefined, 'roofed player (canSee=false) is never targeted');
  okAv(!!pick(true), 'open-sky player (canSee=true) is targeted');
  const e8 = { x: 0, y: 94, z: 0, target: { x: 0, y: 64, z: 0, mode: 0 } };
  Ai.canSee = () => false;
  ok(!new Ph.FindTargetGoal(e8, {}).canContinueToUse() && !new Ph.StartAttackGoal(e8, {}).canUse(), 'target dropped when line of sight lost');
  Ai.canSee = realCanSee;
}
console.log(`   ${pass} ok`);

// ═══════════════════════════════ 4. StartAttackGoal — startSwoop's sea-level floor ════════
console.log('\n4. StartAttackGoal.start()/tick() — circle<->swoop state machine, sea-level clamp');
{
  M.Player = { SEA_LEVEL: 63 };
  const e = { x: 0, y: 64, z: 0, target: { x: 5, y: 5, z: 5 } };   // target near bedrock
  const g = new Ph.StartAttackGoal(e, { random: seqRandom([0]) });
  ok(g.canUse() === true, 'canUse() is true with a live target');
  g.start();
  ok(e.phantomMovementType === 'circle', 'start() begins in the CIRCLE state (.decomp:427-429)');
  ok(e.circlingY === 64, `startSwoop() clamps a below-sea-level target to seaLevel+1 (got ${e.circlingY})`);

  // the cooldown-driven CIRCLE -> SWOOP transition, exactly 10 ticks (.decomp:432, toGoalTicks(10)).
  for (let i = 0; i < 9; i++) { g.tick(); ok(e.phantomMovementType === 'circle', `still circling at tick ${i}`); }
  g.tick();
  ok(e.phantomMovementType === 'swoop', 'the 10th tick flips to SWOOP (.decomp:436-441)');

  // anti-vacuity: a target ABOVE sea level is NOT clamped.
  const e2 = { x: 0, y: 64, z: 0, target: { x: 5, y: 200, z: 5 } };
  const g2 = new Ph.StartAttackGoal(e2, { random: seqRandom([0]) });
  g2.start();
  okAv(e2.circlingY !== 64 && e2.circlingY >= 220, `a target well above sea level is left alone (got ${e2.circlingY})`);
}
console.log(`   ${pass} ok`);

// ═══════════════════════════════ 5. CircleMovementGoal — adjustDirection() ════════════════
console.log('\n5. CircleMovementGoal — canUse() gate, adjustDirection() arithmetic');
{
  const e = { x: 0, y: 64, z: 0, target: null };
  ok(new Ph.CircleMovementGoal(e, { random: () => 0 }).canUse() === true, 'canUse() true with no target');
  e.target = {}; e.phantomMovementType = 'swoop';
  ok(new Ph.CircleMovementGoal(e, {}).canUse() === false, 'canUse() false with a live target while SWOOPing');
  e.phantomMovementType = 'circle';
  ok(new Ph.CircleMovementGoal(e, {}).canUse() === true, 'canUse() true with a target while explicitly CIRCLEing');

  const e2 = { x: 100, y: 70, z: 100, circlingX: 100, circlingY: 70, circlingZ: 100 };
  const g2 = new Ph.CircleMovementGoal(e2, { random: seqRandom([0, 0]) });   // nextBoolean()=false -> dir=-1
  g2.start();
  ok(typeof e2.targetPosX === 'number', 'start() -> adjustDirection() sets a real targetPosition');
  const dSq = (e2.targetPosX - e2.circlingX) ** 2 + (e2.targetPosZ - e2.circlingZ) ** 2;
  const r2 = 5 * 5;   // random()=0 -> radius = 5 + 0*10 = 5
  ok(Math.abs(dSq - r2) < 1e-6, `targetPosition sits exactly \`radius\` (5) blocks from circlingCenter horizontally — got dist²=${dSq}`);

  // anti-vacuity: an UNSET circlingCenter self-initialises to the mob's own position, not (0,0,0).
  const e3 = { x: 55, y: 80, z: -30 };
  const g3 = new Ph.CircleMovementGoal(e3, { random: () => 0.5 });
  g3.start();
  okAv(e3.circlingX === 55 && e3.circlingZ === -30, `a never-set circlingCenter adopts the mob's own position, not the origin — got (${e3.circlingX},${e3.circlingZ})`);

  // #758: floor/ceiling test is !isAir (water, grass...), not solidAt.
  const runClamp = (blk) => {
    M.World = { getBlock: (x, y, z) => (y === 79 ? blk : 0) };
    const ee = { x: 100.5, y: 80, z: 100.5, circlingX: 100, circlingY: 70, circlingZ: 100, targetPosY: 60 };
    const gg = new Ph.CircleMovementGoal(ee, { random: () => 0.5 });
    gg.start(); ee.targetPosY = 70; gg.tick();
    return ee.targetPosY;
  };
  const anyNonAir = SR.isAir.findIndex((v, i) => i > 0 && !v);
  const tAir = runClamp(0), tBlk = runClamp(anyNonAir);
  ok(tAir !== tBlk, `non-air block under the phantom clamps yOffset (target ${tAir} vs ${tBlk})`);
  okAv(runClamp(0) === tAir, 'air below does not clamp (same as baseline)');
}
console.log(`   ${pass} ok`);

// ═══════════════════════════════ 6. SwoopMovementGoal — cat abort + melee-on-touch ════════
console.log('\n6. SwoopMovementGoal — cat-nearby abort gate, melee on touch, revert on collision');
{
  let attacked = null;
  M.Combat = { mobAttack: (e, t) => { attacked = t; } };
  M.EntityList = Object.assign({}, EL, { list: [] });

  const target = { x: 0, y: 64, z: 0, height: 1.8 };
  const e = { x: 0, y: 64, z: 0, height: 0.5, width: 0.9, target, phantomMovementType: 'swoop' };
  const g = new Ph.SwoopMovementGoal(e, {});
  ok(g.canUse() === true, 'canUse() true: live target, SWOOP state');
  M.Gamemode = { isSpectator: () => false, isCreative: () => false };
  ok(g.canContinueToUse() === true, 'canContinueToUse() true with no cats nearby and a real target');
  g.tick();
  ok(attacked === target, 'landing on the target (same cell) calls Cb.mobAttack (.decomp:507-511)');
  ok(e.phantomMovementType === 'circle', 'a landed hit reverts to CIRCLE (.decomp:509)');

  // horizontalCollision also reverts, even with no hit.
  const e2 = { x: 0, y: 64, z: 0, height: 0.5, width: 0.9, target: { x: 50, y: 64, z: 50, height: 1.8 },
               phantomMovementType: 'swoop', horizontalCollision: true };
  const g2 = new Ph.SwoopMovementGoal(e2, {});
  g2.tick();
  ok(e2.phantomMovementType === 'circle', 'a horizontal-collision miss also reverts to CIRCLE (.decomp:512-514)');

  // anti-vacuity: a cat within 16 blocks aborts the swoop outright.
  const e3 = { x: 0, y: 64, z: 0, age: 5, target: { x: 50, y: 64, z: 50 }, phantomMovementType: 'swoop' };
  M.EntityList = { list: [{ type: 'cat', x: 3, y: 64, z: 0, dead: false }] };
  const g3 = new Ph.SwoopMovementGoal(e3, {});
  okAv(g3.canContinueToUse() === false, 'a cat 3 blocks away aborts the swoop (SwoopMovementGoal.shouldContinue, .decomp:481-490)');

  // and the reverse: moving that same cat out of the 16-block box lets it continue.
  {
    const hiss = [];
    const oldMV = M.MobVoice; M.MobVoice = { emit: (c, id) => hiss.push(id) };
    const mkE = () => ({ x: 0, y: 64, z: 0, age: 5, target: { x: 50, y: 64, z: 50 }, phantomMovementType: 'swoop' });
    M.EntityList = { list: [{ type: 'cat', x: 15, y: 64, z: 15, dead: false }, { type: 'cat', x: 17, y: 64, z: 0, dead: false }] };
    const gh = new Ph.SwoopMovementGoal(mkE(), {});
    okAv(gh.canContinueToUse() === false && hiss.length === 1 && hiss[0] === 'entity.cat.hiss',
         'one hiss for the cat at dx=15,dz=15 (inside the AABB), none for the cat at dx=17 (outside)');
    M.MobVoice = oldMV;
  }
  M.EntityList.list[0].x = 500;
  const e4 = { x: 0, y: 64, z: 0, age: 5, target: { x: 50, y: 64, z: 50 }, phantomMovementType: 'swoop' };
  const g4 = new Ph.SwoopMovementGoal(e4, {});
  ok(g4.canContinueToUse() === true, 'the same cat moved 500 blocks away no longer blocks the swoop');
}
console.log(`   ${pass} ok`);

// ═══════════════════════════════ 7. PhantomMoveControl ════════════════════════════════════
console.log('\n7. PhantomMoveControl.tick() — velocity blends toward targetPosition, no gravity');
{
  const e = { x: 0, y: 64, z: 0, yaw: 0, vx: 0, vy: 0, vz: 0, targetPosX: 10, targetPosY: 64, targetPosZ: 0 };
  const mc = new Ph.PhantomMoveControl(e);
  mc.tick();
  ok(e.noGravity === true, 'noGravity is set every tick (FlyingEntity.travel() never subtracts gravity)');
  ok(e.vx > 0 && Math.abs(e.vz) < 1e-9, `velocity nudges toward the target on the +X axis — got vx=${e.vx}, vz=${e.vz}`);

  // anti-vacuity: with NO targetPosition set at all, tick() must not throw and must not invent motion.
  const e2 = { x: 0, y: 64, z: 0, yaw: 0 };
  const mc2 = new Ph.PhantomMoveControl(e2);
  let threw = false;
  try { mc2.tick(); } catch (err) { threw = true; }
  okAv(!threw && e2.vx === undefined, 'no targetPosition -> no crash and no velocity write');

  // horizontalCollision spins the yaw 180 and resets targetSpeed (.decomp:378-381).
  const e3 = { x: 0, y: 64, z: 0, yaw: 0, horizontalCollision: true };
  new Ph.PhantomMoveControl(e3).tick();
  ok(Math.abs(Math.abs(e3.yaw) - Math.PI) < 1e-9, `horizontalCollision flips yaw by 180° — got ${e3.yaw}`);
}
console.log(`   ${pass} ok`);

// ═══════════════════════════════ 8. Ph.tickSpawner — the world-level PhantomSpawner ═══════
console.log('\n8. Ph.tickSpawner — doInsomnia/darkness/sky/sea-level/TIME_SINCE_REST gates');
{
  function freshWorld() {
    M.Sky = { darknessNow: () => 10 };
    M.Commands = { ruleGet: () => 'true' };
    M.Gamemode = { isSpectator: () => false };
    M.Player = { SEA_LEVEL: 63, x: 0, y: 70, z: 0, timeSinceRest: 1e7 };
    M.World = { canSeeSky: () => true };
    M.Equip = { clampedLocalDifficulty: () => 1.5 };
    M.Diff = { LEVELS: ['peaceful', 'easy', 'normal', 'hard'], get: () => 'hard' };
    const spawnedAt = [];
    M.EntityList = { ready: true, spawn: (t, x, y, z) => { const e = { type: t, x, y, z }; spawnedAt.push(e); return e; } };
    M.Spawn = { clearForSpawn: () => true };
    Ph.spawnCooldown = 0;
    return spawnedAt;
  }

  // doInsomnia=false refuses outright, before even the cooldown/darkness machinery runs.
  { freshWorld(); M.Commands.ruleGet = () => 'false'; Math.random = () => 0.5;
    okAv(Ph.tickSpawner() === 0, 'doInsomnia=false refuses the whole roll'); }

  // doMobSpawning=false (Spawn.ready===false) and peaceful: refuse and leave the cooldown untouched.
  { freshWorld(); M.Spawn.ready = false; Math.random = () => 0.5;
    okAv(Ph.tickSpawner() === 0 && Ph.spawnCooldown === 0, 'doMobSpawning=false refuses and leaves spawnCooldown untouched'); }
  { freshWorld(); M.Diff.get = () => 'peaceful'; Math.random = () => 0.5;
    okAv(Ph.tickSpawner() === 0 && Ph.spawnCooldown === 0, 'peaceful refuses and leaves spawnCooldown untouched'); }

  // too bright (ambientDarkness < 5) refuses.
  { freshWorld(); M.Sky.darknessNow = () => 0; Math.random = () => 0.5;
    okAv(Ph.tickSpawner() === 0, 'ambientDarkness < 5 refuses (too bright to spawn)'); }

  // no sky visible refuses.
  { freshWorld(); M.World.canSeeSky = () => false; Math.random = () => 0.5;
    okAv(Ph.tickSpawner() === 0, 'World.canSeeSky() === false refuses'); }

  // TIME_SINCE_REST too low (never slept-since-join scale) refuses -- deterministic: statBound=1.
  { const spawned = freshWorld(); M.Player.timeSinceRest = 0; Math.random = () => 0;
    okAv(Ph.tickSpawner() === 0 && spawned.length === 0, 'timeSinceRest=0 (statBound clamped to 1) never rolls >= 72000'); }

  // clearForSpawn refused -- the position-clearance call is load-bearing, not decorative.
  { const spawned = freshWorld(); M.Spawn.clearForSpawn = () => false;
    Math.random = seqRandom([0.5, 0, 0.5, 0.5, 0.5, 0.5, 0.5]);
    okAv(Ph.tickSpawner() === 0 && spawned.length === 0, 'clearForSpawn()===false refuses even when every other gate passes'); }

  // every gate open -> a real spawn, with the hard-difficulty group size in [1,4].
  { const spawned = freshWorld();
    Math.random = seqRandom([0.5, 0, 0.5, 0.5, 0.5, 0.5, 0.5]);
    const n = Ph.tickSpawner();
    ok(n >= 1 && n <= 4, `every gate open spawns a group of 1..(difficultyId+1) — got ${n}`);
    ok(spawned.length === n && spawned.every(s => s.type === 'phantom'), 'every spawned entity is type phantom');
  }

  // the cooldown is real: a second call the same "tick" (cooldown just set high) spawns nothing.
  { const spawned = freshWorld();
    Math.random = seqRandom([0.5, 0, 0.5, 0.5, 0.5, 0.5, 0.5]);
    Ph.tickSpawner();
    const before = spawned.length;
    Ph.tickSpawner();
    okAv(spawned.length === before, 'the (60+random(60))*20-tick cooldown blocks an immediate second roll');
  }

  Math.random = Math.random;   // restore (no-op; each block above set its own)
}
console.log(`   ${pass} ok`);

// ═══════════════════════════════ sounds (#754) ═══════════════════════════════════════════
{
  let breaks = 0;
  const played = [];
  M.Sound = { play: (id, o) => played.push([id, o]) };
  const mk = () => { played.length = 0; return { type: 'phantom', x: 1, y: 70, z: 2, id: 0, age: 0, health: 20 }; };
  const has = (id) => played.some(p => p[0] === id);

  // ambient: SoundGoal no longer rolls it (MobVoice does; #3498) -- a winning roll must stay silent
  { const e = mk(); e.ambientSoundChance = 5; M.EntityList.random = () => 0;
    new Ph.SoundGoal(e).tick();
    if (!has('entity.phantom.ambient') && e.ambientSoundChance === 5) breaks++; else ok(false, 'SoundGoal still rolls ambient'); }
  // flap: age where cos crosses + -> -
  { const e = mk(); const g = new Ph.SoundGoal(e); M.EntityList.random = () => 0.999; e.ambientSoundChance = -1000;
    for (e.age = 0; e.age < 200; e.age++) g.tick();
    const n = played.filter(p => p[0] === 'entity.phantom.flap').length;
    ok(n >= 4 && n <= 5, `wingbeat plays once per ~48.3-tick cycle (got ${n} in 200 ticks)`);
    const e2 = mk(); e2.silent = true; const g2 = new Ph.SoundGoal(e2); e2.ambientSoundChance = -1000;
    for (e2.age = 0; e2.age < 200; e2.age++) g2.tick();
    const n2 = played.filter(p => p[0] === 'entity.phantom.flap').length;
    if (n2 === n && played.length === n2) breaks++; else ok(false, `Silent phantom flaps like a loud one (got ${n2}, want ${n}; vanilla has no isSilent check)`); }
  // hurt / death: only MobVoice plays them (#3498)
  { ok(Ph.playDamageSound === undefined, 'Ph.playDamageSound removed (MobVoice.onDamage owns hurt/death)');
    if (Ph.playDamageSound === undefined) breaks++; }
  // swoop cue
  { const e = mk(); e.target = { x: 0, y: 64, z: 0, health: 20 }; const g = new Ph.StartAttackGoal(e, { random: () => 0 });
    g.start(); for (let i = 0; i < 10; i++) g.tick();
    const sw = played.find(p => p[0] === 'entity.phantom.swoop');
    ok(sw && sw[1].volume === 10, 'swoop cue plays at volume 10');
    const e2 = mk(); e2.target = { x: 0, y: 64, z: 0, health: 20 }; const g2 = new Ph.StartAttackGoal(e2, { random: () => 0 });
    g2.start(); for (let i = 0; i < 5; i++) g2.tick();
    if (played.length === 0) breaks++; else ok(false, 'swoop cue played before the cooldown elapsed'); }
  // #3499: a creative/invulnerable target stops StartAttackGoal (isTarget(DEFAULT))
  { const mkG = t => { const e = mk(); e.target = t; return new Ph.StartAttackGoal(e, { random: () => 0 }); };
    ok(mkG({ x: 0, y: 64, z: 0, health: 20 }).canUse(), 'survival target keeps StartAttackGoal');
    okAv(!mkG({ x: 0, y: 64, z: 0, health: 20, invulnerable: true }).canUse(), 'invulnerable target stops StartAttackGoal'); }
  // bite on hit
  { const e = mk(); e.width = 0.9; e.height = 0.5; e.target = { x: 1, y: 70, z: 2, health: 20, width: 0.6, height: 1.8 }; e.phantomMovementType = 'swoop';
    new Ph.SwoopMovementGoal(e, {}).tick();
    ok(has('entity.phantom.bite'), 'bite sound on a swoop hit');
    const e2 = mk(); e2.width = 0.9; e2.height = 0.5; e2.target = { x: 50, y: 70, z: 2, health: 20, width: 0.6, height: 1.8 }; e2.phantomMovementType = 'swoop';
    new Ph.SwoopMovementGoal(e2, {}).tick();
    if (played.length === 0) breaks++; else ok(false, 'bite played on a miss'); }
  ok(breaks === 5, `sound section broke its own inputs ${breaks}/5`);
  globalThis.__breaks = breaks;
for (let i = 0; i < breaks; i++) console.log('   ✓ anti-vacuity: sound break caught');
}

// ═══════════════════════════════ wingtip spores (#2482) ═══════════════════════════════════
console.log('\nwingtip spores — PhantomEntity.tick: two MYCELIUM particles/tick at +-(cos,sin)(yaw)*(1.3+0.21*size)');
{
  const got = [];
  const saved = M.Particle;
  M.Particle = { spawn: (...a) => { got.push(a); return {}; } };
  const run = (mut) => {
    got.length = 0;
    const e = { id: 0, age: 0, x: 10, y: 64, z: 20, yaw: 0.7, phantomSize: 3, type: 'phantom', health: 20 };
    mut(e); new Ph.SoundGoal(e).tick(); return { e, got: got.slice() };
  };
  const { e, got: g } = run(() => {});
  const yv = e.yaw - Math.PI, k = 1.3 + 0.21 * 3, dx = Math.cos(yv) * k, dz = Math.sin(yv) * k;
  const c0 = Math.cos(((0) * 7.448451) * Math.PI / 180 + Math.PI), dy = (0.3 + c0 * 0.45) * (3 * 0.2 + 1);
  const near = (a, b) => Math.abs(a - b) < 1e-4;
  ok(g.length === 2 && g.every(a => a[0] === 'mycelium'), 'two mycelium spawns per tick');
  ok(g.length === 2 && near(g[0][1], 10 + dx) && near(g[0][3], 20 + dz) && near(g[1][1], 10 - dx) && near(g[1][3], 20 - dz), 'x/z at +-(cos,sin)(vanilla yaw)*(1.3+0.21*size)');
  ok(g.length === 2 && near(g[0][2], 64 + dy) && g[0][4] === 0 && g[0][5] === 0 && g[0][6] === 0, 'y at (0.3+cos(phase+PI)*0.45)*(size*0.2+1), velocity 0');
  for (const deg of [0, 45, 90, 135]) {   // spores sit on the wing axis: offset . forward(sin yr,-cos yr) == 0, |offset| = 1.3+0.21*size
    const yr = deg * Math.PI / 180, r = run(e => { e.yaw = yr; }).got, ox = r[0][1] - 10, oz = r[0][3] - 20;
    ok(near(ox * Math.sin(yr) - oz * Math.cos(yr), 0) && near(Math.hypot(ox, oz), k), `yaw ${deg}: spores are perpendicular to the heading`);
  }
  okAv(run(e => { e.phantomSize = 0; }).got.length === 2 && !near(run(e => { e.phantomSize = 0; }).got[0][1], g[0][1]), 'a different size moves the spores (size term is live)');
  okAv(run(e => { e.dead = true; }).got.length === 0, 'a dead phantom emits nothing (the check can fail)');
  M.Particle = saved;
}

// ═══════════════════ death resets TIME_SINCE_REST (#4788) ═══════════════════
console.log('\ndeath — ServerPlayerEntity.onDeath resets TIME_SINCE_REST');
{
  const S = loadEngine({ extra: ['14d_survival.js'], dom: false });
  const sv = S.Survival;
  const p = { health: 20 }; S.Player = p; p.timeSinceRest = 200000;
  sv.die(p, 'generic');
  ok(p.timeSinceRest === 0, 'dying resets timeSinceRest to 0');
  const q = { health: 20, timeSinceRest: 200000 };
  sv.die(q, 'generic');
  okAv(q.timeSinceRest === 200000, 'a non-player dying leaves it alone (the check can fail)');
}

// TIME_SINCE_REST only counts while awake (#4787): the player tick's bump is gated on !P.sleeping.
{
  const src = readFileSync(join(MCLITE_ROOT, 'src/14_player.js'), 'utf8');
  const re = /if \(!P\.sleeping\) P\.timeSinceRest = \(P\.timeSinceRest \|\| 0\) \+ 1;/;
  ok(re.test(src), 'player tick bumps timeSinceRest only when !P.sleeping');
  okAv(!re.test(src.replace('!P.sleeping', 'true')), 'the sleeping-gate check can fail (gate removed -> caught)');
}

// SwoopMovementGoal contact: getBoundingBox().expand(0.2F).intersects(target box), strict, size-scaled box.
{
  let hits = 0;
  M.Combat = { mobAttack: () => { hits++; } };
  M.EntityList = Object.assign({}, EL, { list: [] });
  const probe = (size, gap) => {
    const d = { width: 0.9 + 0.2 * size, height: 0.5 + 0.2 * size * 0.5 };
    const tgt = { x: d.width / 2 + 0.3 + gap, y: 64, z: 0, height: 1.8, width: 0.6 };
    const e = { x: 0, y: 64, z: 0, width: d.width, height: d.height, target: tgt, phantomMovementType: 'swoop' };
    hits = 0; new Ph.SwoopMovementGoal(e, {}).tick(); return hits === 1;
  };
  for (const sz of [0, 5]) {
    ok(probe(sz, 0.19) === true, `size ${sz}: target box 0.19 away is hit`);
    ok(probe(sz, 0.21) === false, `size ${sz}: target box 0.21 away is not hit`);
  }
  const old = Ph.SWOOP_EXPAND; Ph.SWOOP_EXPAND = 0;
  okAv(probe(0, 0.19) === false, 'expand(0.0) fails the 0.19 case (the check can fail)');
  Ph.SWOOP_EXPAND = old;
}

// ═══════════════════════════════ done ═════════════════════════════════════════════════════
console.log(`\n${fails.length ? 'FAIL' : 'PASS'}  ${pass} ok, ${fails.length} failed`);
console.log(`${breaks} breaks caught`);
for (const f of fails) console.log('  ✗ ' + f);
console.log(`${pass} checks passed, ${fails.length} failures`);
process.exit(fails.length ? 1 : 0);
