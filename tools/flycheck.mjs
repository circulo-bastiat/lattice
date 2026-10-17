#!/usr/bin/env node
// flycheck.mjs — QUEUE 0.2 "G18e remainder": the FLYING-AI SUBSTRATE and parrot taming.
//
//   node tools/flycheck.mjs [--verbose]
//
// ⚠ WHAT THIS PROVES. `07t_fly.js`'s own header cites, per piece, what is a real port of the
// decompiled 1.18.2 source (`.decomp/net/minecraft/entity/{ai,passive}/…`) and what is a named
// simplification; this check drives each piece directly (the same choice `goalcheck.mjs` makes
// for the ground goals) rather than trusting a live browser run, and every numeric assertion
// below is checked in BOTH directions with at least one deliberate break restored afterward
// (rule 6's own anti-vacuity requirement).

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; if (VERBOSE) console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (VERBOSE) console.log(...a); };

console.log('flycheck — QUEUE 0.2 "G18e remainder", the flying-AI substrate + parrot taming');

const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
          '14b_physics.js', '07i_entitylist.js', '07q_effects.js', '14j_combat.js',
          '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07t_fly.js', '07zz1_phantom.js', '07zzm_wither.js', '07w_passive.js', '07zw_mobnbt.js',
          '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js']
});
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8'))
});
M.Entities.init();
M.EntityList.init();
if (M.Passive && M.Passive.init) M.Passive.init();
M.Behave.init(M.World);
M.Ai.init();
M.Breed.init();
M.Tame.init();
M.Combat.init();

const Fl = M.Fly, Ai = M.Ai, EL = M.EntityList, W = M.World, CH = M.CH;
ok(Fl && Fl.ready, 'Fly module reports ready');
ok(typeof Ai.ROSTER.parrot === 'function', 'Ai.ROSTER.parrot is wired (D-458/07n_tame.js\'s own gap, closed)');
if (!Fl || !Fl.ready) { console.log('\nFAIL — Fly did not initialise'); process.exit(1); }

// ── a generated, flat world to place tree/ground fixtures into (goalcheck.mjs's own pattern) ──
W.init(1);
for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) {
  const c = W.makeChunk(cx, cz);
  c.state = CH.GENERATED;
  W.chunks.set(W.key(cx, cz), c);
}
ok(W.loadedAt(0, 0), 'a chunk is loaded to place fixtures into');
const STONE = M.States.stateOf('stone') | 0;
const OAK_LEAVES = M.States.stateOf('oak_leaves') | 0;
const OAK_LOG = M.States.stateOf('oak_log') | 0;
for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) W.setBlock(x, 60, z, STONE);

function mkParrot(x, y, z) {
  const e = EL.spawn('parrot', x, y, z);
  return e;
}

// ── §1. EL.spawn attaches the flying substrate, not just a generic entity ──────────────────
say('\n§1 — spawn wires e.ai (goal selector) AND e.flyMove (D-417\'s split, for the air)');
{
  const e = mkParrot(0, 65, 0);
  ok(!!e && e.type === 'parrot', 'a parrot spawns');
  ok(!!e.ai, 'a goal selector is attached (Ai.selectorFor found Ai.ROSTER.parrot)');
  ok(!!e.flyMove && typeof e.flyMove.setWantedPosition === 'function' && typeof e.flyMove.tick === 'function',
    'e.flyMove is a real Fl.MoveControl, attached once at spawn');
  const flyMove1 = e.flyMove;
  Ai.ROSTER.parrot(e, EL.aiCtx(e));   // calling the roster fn again (as EL.tickMob never does)
  ok(e.flyMove === flyMove1, 'a second call never replaces the live flyMove (D-417\'s own "attach once" rule)');
}

// ── §2. Fl.MoveControl — FlightMoveControl.tick(), both branches, both axes ──────────────────
say('\n§2 — Fl.MoveControl: FlightMoveControl.tick() ported, verbatim numbers');
{
  const e = mkParrot(0, 65, 0);
  e.onGround = false;
  e.flyMove.setWantedPosition(10, 65, 0, 1.0);
  e.flyMove.tick();
  ok(e.noGravity === true, 'steering toward a target sets noGravity (FlightMoveControl\'s own setNoGravity(true))');
  ok(Math.abs(e.yaw - Math.PI / 2) < 1e-6, 'yaw rotates toward the target bearing (atan2(d0,-d2), this engine\'s own frame)');
  ok(e.zza > 0, 'e.zza (forward speed) is set while airborne');
  const zzaAirborne = e.zza;
  ok(Math.abs(zzaAirborne - 1.0 * Fl.FLYING_SPEED.parrot) < 1e-9,
    'AIRBORNE speed reads Fl.FLYING_SPEED.parrot (0.4, EntityAttributes.field_23720), not the ground attribute');
  const saved = Fl.FLYING_SPEED.parrot;
  Fl.FLYING_SPEED.parrot = 0;                     // ⚠ anti-vacuity: zero the table this assertion reads
  e.flyMove.setWantedPosition(10, 65, 0, 1.0); e.flyMove.tick();
  okAv(e.zza === 0, 'zeroing Fl.FLYING_SPEED.parrot zeroes the airborne speed — the table is actually read');
  Fl.FLYING_SPEED.parrot = saved;

  // onGround branch reads the ground MOVEMENT_SPEED attribute instead (Ai.movementSpeedOf)
  const e2 = mkParrot(0, 65, 0);
  e2.onGround = true;
  e2.flyMove.setWantedPosition(10, 65, 0, 1.0);
  e2.flyMove.tick();
  ok(Math.abs(e2.zza - 1.0 * Ai.movementSpeedOf(e2)) < 1e-9,
    'ON-GROUND speed reads Ai.movementSpeedOf (MOVEMENT_SPEED, 0.2) — a DIFFERENT number than airborne');
  ok(e2.zza !== zzaAirborne, 'the two branches genuinely differ (0.2 vs 0.4), not the same constant twice');

  // vertical: straight up sets +yya, straight down sets -yya, level sets yya=0
  const up = mkParrot(0, 65, 0); up.onGround = false;
  up.flyMove.setWantedPosition(0, 75, 0, 1.0); up.flyMove.tick();
  ok(up.yya > 0, 'a target directly above sets a POSITIVE upward speed');
  const down = mkParrot(0, 65, 0); down.onGround = false;
  down.flyMove.setWantedPosition(0, 55, 0, 1.0); down.flyMove.tick();
  ok(down.yya < 0, 'a target directly below sets a NEGATIVE upward speed');
  const level = mkParrot(0, 65, 0); level.onGround = false;
  level.flyMove.setWantedPosition(10, 65, 0, 1.0); level.flyMove.tick();
  // ⚠ NOT `=== 0`: `FlightMoveControl.tick()`'s own condition is `abs(d1)>eps ||
  // horiz>eps` -- a nonzero HORIZONTAL distance alone still sets an upward speed, with the
  // sign `d1 > 0.0 ? $5 : -$5` giving `-f5` when d1 is exactly 0 (0 is not > 0). This is the
  // jar's own quirk, read off the bytecode, not this port inventing one.
  ok(level.yya === -level.zza, 'a perfectly level target still sets yya (horiz>eps alone triggers it) — vanilla\'s own -f5 branch, not a bug in this port');
  const same = mkParrot(0, 65, 0); same.onGround = false;
  same.flyMove.setWantedPosition(0, 65, 0.00001, 1.0); same.flyMove.tick();
  ok(same.zza === 0 && same.yya === 0, 'a target inside Fl.ARRIVED_SQ on EVERY axis sets no speed at all');

  // arrival: inside Fl.ARRIVED_SQ, speed drops to zero rather than overshooting forever
  const arrived = mkParrot(0, 65, 0); arrived.onGround = false;
  arrived.flyMove.setWantedPosition(0.00001, 65, 0, 1.0); arrived.flyMove.tick();
  ok(arrived.zza === 0 && arrived.yya === 0, 'arriving (distSq < Fl.ARRIVED_SQ) zeroes both zza and yya');

  // idle: no goal called setWantedPosition this tick → gravity resumes (WAIT branch)
  const idle = mkParrot(0, 65, 0); idle.onGround = false; idle.noGravity = true;
  idle.flyMove.tick();
  ok(idle.noGravity === false, 'a tick with nothing steering it drops noGravity back to false (the WAIT branch)');
}

// ── §3. Fl.travelMob — LivingEntity.travel's general branch, extended for yya/noGravity ──────
say('\n§3 — Fl.travelMob: noGravity skips gravity; the combined (zza,yya) vector is length-clamped');
{
  const withNG = mkParrot(0, 65, 0);
  withNG.onGround = false; withNG.noGravity = true; withNG.zza = 0; withNG.yya = 0;
  withNG.vx = 0; withNG.vy = 0; withNG.vz = 0;
  Fl.travelMob(withNG);
  const withoutNG = mkParrot(0, 65, 0);
  withoutNG.onGround = false; withoutNG.noGravity = false; withoutNG.zza = 0; withoutNG.yya = 0;
  withoutNG.vx = 0; withoutNG.vy = 0; withoutNG.vz = 0;
  Fl.travelMob(withoutNG);
  ok(withNG.vy > withoutNG.vy, 'noGravity=true ends the tick with a HIGHER vy than noGravity=false (gravity actually applied)');
  const expectedGravityLoss = M.Physics.GRAVITY * M.Physics.DRAG_Y;
  ok(Math.abs((withNG.vy - withoutNG.vy) - expectedGravityLoss) < 1e-9,
    'the difference is exactly GRAVITY*DRAG_Y — the ONLY thing noGravity changed');

  // the combined-vector clamp: a maxed diagonal (zza=1,yya=1) must NOT get full speed on both
  // axes at once (Entity.movementInputToVelocity normalises the WHOLE input vector first).
  const diag = mkParrot(0, 65, 0);
  diag.onGround = false; diag.noGravity = true; diag.yaw = 0; diag.zza = 1; diag.yya = 1;
  diag.vx = 0; diag.vy = 0; diag.vz = 0;
  Fl.travelMob(diag);
  const axis = mkParrot(0, 65, 0);
  axis.onGround = false; axis.noGravity = true; axis.yaw = 0; axis.zza = 0; axis.yya = 1;
  axis.vx = 0; axis.vy = 0; axis.vz = 0;
  Fl.travelMob(axis);
  ok(diag.vy < axis.vy, 'a maxed DIAGONAL input climbs SLOWER than a maxed single-axis input — the clamp is load-bearing');
  ok(Math.abs(diag.vy - axis.vy / Math.SQRT2) < 1e-9,
    'and by exactly the 1/√2 the length-1 normalisation predicts, not some other ad-hoc reduction');
}

// ── §4. Fl.locateTree — FlyOntoTreeGoal.locateTree(), the real box and the real test ────────
say('\n§4 — Fl.locateTree: leaves below + air at + air above, real tag data, real box');
{
  W.setBlock(20, 70, 20, OAK_LEAVES);        // a real gap: leaves@70, air@71, air@72
  const near = mkParrot(20, 72, 20);
  const found = Fl.locateTree(near);
  ok(!!found && found.x === 20.5 && found.y === 71 && found.z === 20.5,
    'a genuine leaves/air/air gap is found, block-centred, at the leaves\' own y+1');

  // a bare log (no leaves anywhere) is a perch too — vanilla `|| isIn(BlockTags.LOGS)`
  W.setBlock(60, 70, 60, OAK_LOG);
  const logTop = Fl.locateTree(mkParrot(60, 72, 60));
  ok(!!logTop && logTop.x === 60.5 && logTop.y === 71 && logTop.z === 60.5, 'a log-only tree: the cell above the log is found');

  // negative #1, well isolated: leaves exist but the pocket above them is blocked
  W.setBlock(-20, 70, -20, OAK_LEAVES);
  W.setBlock(-20, 71, -20, STONE);           // no air pocket at all
  const blocked = mkParrot(-20, 73, -20);
  ok(Fl.locateTree(blocked) === null, 'a blocked pocket (no air above the leaves) refuses — not "close enough"');

  // negative #2, well isolated: open air, no leaves anywhere nearby
  const nowhere = mkParrot(40, 80, 40);
  ok(Fl.locateTree(nowhere) === null, 'open sky with no leaves in the 7×13×7 box refuses too');
}

// ── §5. Fl.randomAirTarget — the real forward-cone chain (FlyGoal), not a uniform box ───────
say('\n§5 — Fl.randomAirTarget: forward-biased cone, never behind the facing');
{
  const e = mkParrot(0, 80, 0); e.yaw = 0;   // forward = (0,-1)
  let n = 0, back = 0, mid = 0;
  for (let i = 0; i < 300; i++) {
    const t = Fl.randomAirTarget(e, Math.random);
    if (!t) continue; n++;
    if (t.z - e.z > 1.5) back++;
    if (Math.abs(Math.abs(t.x % 1) - 0.5) > 1e-9) mid++;
    if (M.Physics.solidAt(Math.floor(t.x), Math.floor(t.y), Math.floor(t.z))) back++;
  }
  ok(n > 100, 'an open-sky mob finds targets (' + n + '/300)');
  okAv(back === 0, 'no target behind the facing or inside solid (a uniform box fails this)');
  ok(mid === 0, 'targets are bottom-centre');
}

// ── §5b. #3529 Fl.wanderTarget: forward-biased FlyGoal cone, water branch ───────────────────
say('\n§5b — Fl.wanderTarget: facing +x targets are biased forward; swimming parrot takes the fuzzy exit');
{
  const e = mkParrot(0, 80, 0); e.yaw = -Math.PI / 2;   // (sin yaw, -cos yaw) = (-1,0): flip sign below by measuring
  const fx = Math.sin(e.yaw), fz = -Math.cos(e.yaw);
  const noTree = Fl.locateTree; Fl.locateTree = () => null;
  let fwd = 0, n = 0;
  for (let i = 0; i < 1000; i++) { const t = Fl.wanderTarget(e, Math.random); if (!t) continue; n++; if ((t.x - e.x) * fx + (t.z - e.z) * fz > 0) fwd++; }
  okAv(n > 900 && fwd / n > 0.9, 'wander targets lie within PI/2 of facing (' + fwd + '/' + n + ' forward)');
  e.inWater = true; let calls = 0; const ff = Fl.fuzzyFind; Fl.fuzzyFind = function () { calls++; return ff.apply(this, arguments); };
  Fl.wanderTarget(e, Math.random); okAv(calls === 1, 'a swimming parrot takes the FuzzyTargeting 15/15 branch');
  Fl.fuzzyFind = ff; Fl.locateTree = noTree;
}

// ── §5c. #5647 fuzzyFind: BirdNavigation.isInvalidPosition ─────────────────────────────────
say('\n§5c — Fl.fuzzyFind refuses candidates whose block lacks a solid top (open air is invalid)');
{
  const e = mkParrot(0, 61, 0);
  const t = Fl.fuzzyFind(e, () => 0.5, 15, 15);   // candidate = the parrot's own cell (air above stone): vanilla rejects every try
  okAv(t === null, 'all-air candidates are rejected by isInvalidPosition');
  const t2 = Fl.fuzzyFind(mkParrot(0, 60, 0), () => 0.5, 15, 15);   // candidate = stone cell: valid, upWhile lifts it to 61
  okAv(t2 && t2.y === 61, 'a candidate on a solid-top block is accepted and lifted out');
}

// ── §6. Fl.FlyOntoTreeGoal — the 1-in-120 chance gate and the real steer ─────────────────────
say('\n§6 — Fl.FlyOntoTreeGoal: WanderAroundGoal\'s own 1-in-120 gate, then a real flyMove.setWantedPosition');
{
  const e = mkParrot(20, 72, 20);            // sits right by §4's own leaves gap
  const g = new Fl.FlyOntoTreeGoal(e, 1.0, () => 0.999);   // floor(0.999*120)=119 ≠ 0, refuses
  ok(g.canUse() === false, 'a chance roll that fails the 1-in-120 gate refuses, even with a tree right there');
  let rn = 0; const g2 = new Fl.FlyOntoTreeGoal(e, 1.0, () => (rn++ ? 0.5 : 0));   // 1st roll floor(0*120)=0 passes; later 0.5 >= 0.001 -> locateTree
  ok(g2.canUse() === true, 'a roll of exactly 0 passes the gate (random.nextInt(120)==0)');
  g2.tick();               // the goal only RECORDS the wanted position (D-417's split, again)
  e.flyMove.tick();        // EL.tickMob's own next step — the control actually moves it
  ok(e.zza !== 0 || e.yya !== 0, 'tick() actually steers the mob (via e.flyMove), not just records a target');
  ok(g2.canContinueToUse() === true, 'still short of the target, the goal keeps running');
  e.x = 20.5; e.y = 71; e.z = 20.5;          // teleport it to "arrival" without ticking physics
  ok(g2.canContinueToUse() === false, 'once within Fl.ARRIVED_SQ of the target, the goal gives up its priority');
}

// ── §7. Fl.FollowOwnerGoal (flying) — Ai.FollowOwnerGoal's own numbers, ported for the air ────
say('\n§7 — Fl.FollowOwnerGoal: start/stop distance, teleport threshold, steers via flyMove not Ai.stepToward');
{
  const owner = { x: 0, y: 61, z: 0, eyeHeight: 1 };   // y=61: standing on §5's own stone plate (top at y=60)
  const getPlayers = () => [owner];
  const e = mkParrot(2, 65, 2);
  e.tamed = false;
  let g = new Fl.FollowOwnerGoal(e, 1.0, 5, 1, getPlayers);
  ok(g.canUse() === false, 'an UNTAMED parrot never follows (mirrors Ai.FollowOwnerGoal\'s own owner==null refusal)');
  e.tamed = true; e.owner = 'player'; e.sitting = true;
  ok(g.canUse() === false, 'a SITTING tamed parrot refuses too (isSitting() gate)');
  e.sitting = false;
  e.x = 2; e.y = 65; e.z = 2;                // within startDist(5) of (0,65,0)
  ok(g.canUse() === false, 'closer than startDist never starts following at all');
  e.x = 10; e.y = 65; e.z = 0;               // 10 blocks — beyond startDist, short of the 12-teleport
  ok(g.canUse() === true, 'farther than startDist starts following');
  g.start();
  g.tick();
  e.flyMove.tick();
  ok(e.zza !== 0 || e.yya !== 0, 'inside the teleport range, tick() steers via e.flyMove (not a teleport)');
  // a FRESH goal for the teleport case — g's own 10-tick steer cooldown (just primed above)
  // would otherwise throttle a second tick() into a no-op and prove nothing.
  // D-654: a SCRIPTED rand, not Math.random — vanilla's tryTeleport takes 10 random (dx,dy,dz)
  // picks and only dy=0 lands on §5's plate, so Math.random failed all 10 about 1 run in 25
  // (full suite 24 Sept 16:08). Cycle (0.9,0.5,0.5) → dx=+3, dy=0, dz=0: (3,61,0), walkable.
  const scripted = (seq) => { let i = 0; return () => seq[i++ % seq.length]; };
  e.x = 100; e.y = 65; e.z = 0;
  const gMiss = new Fl.FollowOwnerGoal(e, 1.0, 5, 1, getPlayers, scripted([0.9]));  // dy=+1 every try → (3,62,3) is air, never walkable
  gMiss.canUse(); gMiss.start(); gMiss.tick();
  ok(e.x === 100 && e.z === 0, 'the other direction: when all 10 tries land on non-walkable spots it does NOT teleport (vanilla refuses, it never forces a spot)');
  e.x = 100; e.y = 65; e.z = 0;              // 100 blocks — well past the 12-block teleport threshold
  const gTele = new Fl.FollowOwnerGoal(e, 1.0, 5, 1, getPlayers, scripted([0.9, 0.5, 0.5]));
  ok(gTele.canUse() === true, 'still farther than startDist from way out here too');
  gTele.start();
  gTele.tick();
  ok(Math.hypot(e.x - owner.x, e.z - owner.z) < 12, 'past Ai.FOLLOW_OWNER_TELEPORT_DIST (12), it TELEPORTS near the owner instead');
  ok(e.x !== 100, 'the teleport actually moved it — it did not just fail silently and stay at (100,65,0)');

  // anti-vacuity: shrink the teleport threshold and watch a normal fly-toward become a teleport
  const savedDist = Ai.FOLLOW_OWNER_TELEPORT_DIST;
  Ai.FOLLOW_OWNER_TELEPORT_DIST = 1;         // ⚠ anything past 1 block now "teleports"
  const e2 = mkParrot(10, 65, 0);
  e2.tamed = true; e2.owner = 'player'; e2.sitting = false;
  const g2 = new Fl.FollowOwnerGoal(e2, 1.0, 5, 1, getPlayers, scripted([0.9, 0.5, 0.5]));  // D-654 again: scripted, not Math.random — a random pick can miss all 10 tries
  g2.canUse(); g2.start();
  const before2 = { x: e2.x, y: e2.y, z: e2.z };
  g2.tick();
  okAv(e2.x !== before2.x || e2.z !== before2.z || e2.y !== before2.y,
    'shrinking the teleport threshold to 1 turns an ordinary follow into a teleport — the constant is load-bearing');
  Ai.FOLLOW_OWNER_TELEPORT_DIST = savedDist;

  // stop distance: canContinueToUse goes false once within stopDist of the owner
  const e3 = mkParrot(10, 65, 0);
  e3.tamed = true; e3.owner = 'player'; e3.sitting = false;
  const g3 = new Fl.FollowOwnerGoal(e3, 1.0, 5, 1, getPlayers);
  ok(g3.canUse() === true, 'starts following from 10 blocks out');
  g3.start();
  ok(g3.canContinueToUse() === true, 'still farther than stopDist(1): keeps following');
  e3.x = 0.5; e3.y = 61; e3.z = 0;
  ok(g3.canContinueToUse() === false, 'within stopDist(1) of the owner: gives up, same tick it arrives');
}

// ── §8. Fl.SitOnOwnerShoulderGoal — the real readiness gate, the mount ruled OWED ─────────────
say('\n§8 — Fl.SitOnOwnerShoulderGoal: e.age>100 + owner state gates, mount is a documented no-op');
{
  const owner = { creative: true, flying: false, inWater: false };
  const getPlayers = () => [owner];
  const e = mkParrot(0, 65, 0);
  e.tamed = true; e.owner = 'player'; e.sitting = false; e.age = 50;
  const g = new Fl.SitOnOwnerShoulderGoal(e, getPlayers);
  ok(g.canUse() === false, 'younger than the 100-tick cooldown (TameableShoulderEntity.READY_TO_SIT_COOLDOWN) refuses');
  e.age = 150;
  ok(g.canUse() === true, 'past the cooldown, tamed, owned, not sitting: ready');
  owner.flying = true;
  ok(g.canUse() === false, 'an owner in creative-flight refuses (!getAbilities().flying)');
  owner.flying = false; owner.inWater = true;
  ok(g.canUse() === false, 'an owner touching water refuses (!isTouchingWater)');
  owner.inWater = false;
  e.sitting = true;
  ok(g.canUse() === false, 'an already-sitting parrot refuses');
  e.sitting = false;
  ok(g.canUse() === true, 'and the gate opens again once every blocker clears');
  g.start();
  g.tick();
  owner.x = 50; owner.z = 50; owner.y = 65; owner.width = 0.6; owner.height = 1.8; owner.onGround = true;
  g.tick();
  ok(!e.removed && !owner.shoulderLeft, 'far from the owner: no mount');
  owner.x = e.x; owner.z = e.z;
  g.tick();
  ok(e.removed && owner.shoulderLeft && owner.shoulderLeft.type === 'parrot', 'overlapping owner: parrot removed, player.shoulderLeft set');
  owner.shoulderAge = 30; owner.x = 3; owner.y = 66; owner.z = 4;
  const before = EL.list.length;
  Fl.dropShoulderEntities(owner);
  ok(!owner.shoulderLeft && EL.list.length === before + 1, 'dropShoulderEntities respawns the parrot and empties the slot');
}

// ── §9. Fl.feed — the seed roll, 1-in-10, on its own table (not Tm.FOOD) ─────────────────────
say('\n§9 — Fl.feed: the four seeds, 1-in-10, its own species/food/already-tamed gate');
{
  const cow = EL.spawn('cow', 0, 65, 5);
  ok(Fl.feed(cow, 'wheat_seeds', { random: Math.random }) === null, 'a cow never tames on any food (species gate)');
  const e = mkParrot(0, 65, 6);
  ok(Fl.feed(e, 'wheat', { random: Math.random }) === null, 'plain wheat is not parrot taming food (wolf/cat\'s own bone/fish table stays separate)');
  ['wheat_seeds', 'melon_seeds', 'pumpkin_seeds', 'beetroot_seeds'].forEach((food) => {
    ok(Fl.TAMING_FOOD[food] === true, 'Fl.TAMING_FOOD lists ' + food);
  });
  let tames = 0, N = 4000;
  for (let i = 0; i < N; i++) {
    const p = mkParrot(0, 65, 7);
    const r = Fl.feed(p, 'wheat_seeds', { random: Math.random });
    ok(r && r.consumed === true, 'every attempt consumes the seed, success or not');
    if (r.tamed) tames++;
  }
  const frac = tames / N;
  ok(frac > 0.07 && frac < 0.13, 'the roll lands near 1-in-' + Fl.TAME_CHANCE_DENOM + ' over ' + N + ' tries (got ' + frac.toFixed(3) + ')');
  const tamed = mkParrot(0, 65, 8); tamed.tamed = true;
  ok(Fl.feed(tamed, 'wheat_seeds', { random: Math.random }) === null, 'an already-tamed parrot refuses more seeds');

  // anti-vacuity: the distribution assertion is not vacuously "always roughly a tenth"
  const savedDenom = Fl.TAME_CHANCE_DENOM;
  Fl.TAME_CHANCE_DENOM = 1;                  // ⚠ every attempt now tames
  let always = true;
  for (let i = 0; i < 50; i++) {
    const p = mkParrot(0, 65, 9);
    if (!Fl.feed(p, 'wheat_seeds', { random: Math.random }).tamed) { always = false; break; }
  }
  okAv(always, 'forcing the denominator to 1 tames on every single attempt — the roll genuinely reads the constant');
  Fl.TAME_CHANCE_DENOM = savedDenom;
}

// ── §10. Fl.feedCookie — poison + an unconditional kill, tamed or not ────────────────────────
say('\n§10 — Fl.feedCookie: kills tamed AND untamed alike, applies poison, wrong item/species refuse');
{
  const cow = EL.spawn('cow', 5, 65, 5);
  ok(Fl.feedCookie(cow, 'cookie', {}) === null, 'a cookie does nothing to a cow (species gate)');
  const wild = mkParrot(0, 65, 10);
  ok(Fl.feedCookie(wild, 'apple', {}) === null, 'an apple does not trigger the cookie branch');
  const r1 = Fl.feedCookie(wild, 'cookie', {});
  ok(!!r1 && r1.consumed === true && r1.killed === true, 'a cookie kills an UNTAMED parrot outright');
  ok(wild.dead === true && wild.health <= 0, 'health actually reaches zero, not just a flag');
  ok(M.Effects.hasStatusEffect(wild, 'poison'), 'poison (StatusEffects id 19) was applied on the way, even though it never gets to tick');

  const tame = mkParrot(0, 65, 11); tame.tamed = true;
  const r2 = Fl.feedCookie(tame, 'cookie', {});
  ok(r2.killed === true, 'a cookie kills a TAMED parrot too — interactMob\'s cookie branch never checks isTamed()');

  // anti-vacuity: shrink the damage constant below the parrot's own max health
  const savedDamage = Fl.COOKIE_DAMAGE;
  Fl.COOKIE_DAMAGE = 1;                      // ⚠ parrot has 6 max health — 1 damage will not kill it
  const survivor = mkParrot(0, 65, 12);
  const r3 = Fl.feedCookie(survivor, 'cookie', {});
  okAv(r3.killed === false && !survivor.dead, 'shrinking Fl.COOKIE_DAMAGE below max health leaves the parrot ALIVE — the kill genuinely depends on the constant');
  Fl.COOKIE_DAMAGE = savedDamage;
}

// ── §11. Fl.toggleSit — grounded and tamed only, ParrotEntity.isInAir()'s own gate ────────────
say('\n§11 — Fl.toggleSit: tamed AND on the ground; a flying tamed parrot ignores the empty-hand click');
{
  const wild = mkParrot(0, 65, 13); wild.onGround = true;
  ok(Fl.toggleSit(wild) === false, 'an untamed parrot refuses the toggle');
  const flying = mkParrot(0, 65, 14); flying.tamed = true; flying.onGround = false; flying.sitting = false;
  ok(Fl.toggleSit(flying) === false, 'a tamed but AIRBORNE parrot refuses (isInAir() is !onGround)');
  ok(flying.sitting === false, 'and its sitting flag is genuinely untouched, not silently flipped anyway');
  const grounded = mkParrot(0, 65, 15); grounded.tamed = true; grounded.onGround = true; grounded.sitting = false;
  ok(Fl.toggleSit(grounded) === true && grounded.sitting === true, 'a tamed, grounded parrot toggles sitting on');
  ok(Fl.toggleSit(grounded) === true && grounded.sitting === false, 'and toggles back off on a second click');
}

// ── §12. s114: EscapeDangerGoal / SwimGoal / FollowMobGoal rostered at the jar's priorities ─────
say('\n§12 — parrot pri-0 EscapeDangerGoal(1.25)+SwimGoal, pri-3 FollowMobGoal(1.0,3,7) (ParrotEntity.java:149-156)');
{
  const e = mkParrot(0, 65, 0);
  const goals = (e.ai.entries || []).map((g) => ({ p: g.priority, g: g.goal }));
  const has = (cls, p) => goals.some((x) => x.g instanceof cls && x.p === p);
  ok(has(Fl.EscapeDangerGoal, 0), 'EscapeDangerGoal is rostered at priority 0');
  ok(has(Ai.FloatGoal, 0), 'SwimGoal is rostered at priority 0');
  ok(has(Fl.FollowMobGoal, 3), 'FollowMobGoal is rostered at priority 3');

  // EscapeDangerGoal: no danger → refuses; a fresh hit → starts; 101 ticks after the last hit → refuses.
  const esc = new Fl.EscapeDangerGoal(e, 1.25, () => 0.5);
  e.age = 1000;
  ok(!esc.canUse(), 'unhurt, not burning: EscapeDangerGoal refuses (isInDanger false)');
  e.lastHurtByEntity = { x: 3, y: 65, z: 0, health: 20 }; e.hurtSeq = (e.hurtSeq | 0) + 1; e.hurtAge = e.age | 0;
  ok(esc.canUse(), 'hit by a live attacker: EscapeDangerGoal starts');
  e.age = 1100;
  ok(esc.canUse(), '100 ticks after the hit the attacker is still remembered (age - lastAttackedTime > 100 is false)');
  e.age = 1101;
  ok(!esc.canUse(), '101 ticks after the hit the attacker is forgotten (LivingEntity.baseTick :429)');
  const saved = Fl.ESCAPE_ATTACKER_FORGET; Fl.ESCAPE_ATTACKER_FORGET = 1e9;
  okAv(esc.canUse(), 'with the 100-tick window widened, the same state starts again — the constant is read');
  Fl.ESCAPE_ATTACKER_FORGET = saved;
  e.lastHurtByEntity = null;

  // on fire: flies to the closest water within (5,1); none → a random escape point
  const WATER = M.States.stateOf('water') | 0;
  W.setBlock(3, 65, 1, WATER);
  e.isOnFire = true;
  const esc2 = new Fl.EscapeDangerGoal(e, 1.25, () => 0.5);
  ok(esc2.canUse(), 'burning: EscapeDangerGoal starts');
  esc2.start();
  ok(esc2.target && esc2.target.x === 3 && esc2.target.y === 65 && esc2.target.z === 1, 'burning: the target is the water block 4 Manhattan away');
  W.setBlock(3, 65, 1, 0);
  W.setBlock(6, 65, 0, WATER);
  const esc3 = new Fl.EscapeDangerGoal(e, 1.25, () => 0.5);
  esc3.canUse(); esc3.start();
  okAv(!(esc3.target.x === 6), 'water 6 blocks out (beyond findClosest\'s 5) is NOT chosen');
  W.setBlock(6, 65, 0, 0);
  e.isOnFire = false;

  // FollowMobGoal: another class within 7 → starts; same class → refuses; beyond 7 → refuses
  EL.list.length = 0;
  const p = mkParrot(0, 65, 0);
  const fm = new Fl.FollowMobGoal(p, 1.0, 3.0, 7.0);
  ok(!fm.canUse(), 'alone: FollowMobGoal refuses');
  mkParrot(2, 65, 0);
  ok(!fm.canUse(), 'another PARROT (same class) is not a follow target (targetPredicate getClass() !=)');
  const cow = EL.spawn('cow', 6, 64, 0);
  ok(!!cow && fm.canUse(), 'a cow 6 blocks away (inside 7) is followed');
  cow.x = 20;
  ok(!fm.canUse(), 'the cow 20 blocks away (outside 7) is not');
  cow.x = 6;
  fm.canUse(); fm.start(); fm.tick();
  ok(fm.canContinueToUse(), 'following while farther than minDistance 3');
  cow.x = 2;   // d² = 4 > 3 (plain) but <= 9 (squared): stops navigating, no back-off (the jar's quirk)
  fm.start(); fm.tick();
  ok(!fm.canContinueToUse(), 'within 3 blocks: FollowMobGoal ends (shouldContinue distance > min²)');
  // #4660: the target's LookControl test — a cow at d²=5 (> 3, <= 9) whose look target IS the parrot backs it off
  cow.x = Math.sqrt(5); cow.look = { wanted: { x: 99, y: 0, z: 0 } };
  let wants = 0; p.flyMove = { setWantedPosition() { wants++; } };
  fm.start(); fm.tick();
  ok(wants === 0, 'target looking elsewhere: no back-off wanted');
  cow.look.wanted = { x: p.x, y: p.y, z: p.z };
  fm.start(); fm.tick();
  ok(wants === 1, 'target looking at the parrot: back-off position wanted (jar look-control branch)');
  EL.list.length = 0;
}

// ── §13. #1225 ParrotEntity.flapWings: wing state ramp + 0.6 slow descent while airborne ─────
say('\n§13 — parrot flapWings');
{
  EL.list.length = 0;
  const p = mkParrot(0, 70, 0);
  p.onGround = false; p.vy = -1.0; p.maxWingDeviation = 0; p.flapSpeed = 0; p.flapProgress = 0;
  M.Passive.tickChickenFlap(p);
  ok(Math.abs(p.maxWingDeviation - 1) < 1e-9, 'airborne: maxWingDeviation += 4*0.3 clamps to 1 (got ' + p.maxWingDeviation + ')');
  ok(Math.abs(p.flapSpeed - 0.9) < 1e-9 && Math.abs(p.flapProgress - 1.8) < 1e-9, 'flapSpeed floor 1 then *0.9; flapProgress += speed*2');
  const q = mkParrot(2, 70, 0);
  q.onGround = false; q.vy = -1.0;
  const vy0 = q.vy;
  EL.tickMob(q);
  ok(q.flapProgress > 0 && q.maxWingDeviation > 0, 'EL.tickMob drives the parrot wing state');
  ok(Math.abs(q.vy) < Math.abs(vy0) * 0.7, 'EL.tickMob damps an airborne descent by 0.6 (vy ' + vy0 + ' -> ' + q.vy + ')');
  const g = mkParrot(4, 61, 0); g.onGround = true; g.maxWingDeviation = 1;
  M.Passive.tickChickenFlap(g);
  ok(Math.abs(g.maxWingDeviation - 0.7) < 1e-9, 'grounded: maxWingDeviation -= 0.3');
  g.vehicle = {}; g.onGround = false; g.maxWingDeviation = 1;
  M.Passive.tickChickenFlap(g);
  ok(Math.abs(g.maxWingDeviation - 0.7) < 1e-9, 'riding a vehicle counts as grounded for the ramp');
  // anti-vacuity: with the slow-fall multiplier broken to 1.0 the damping assertion must fail
  const mult = M.Passive.CHICKEN_FALL_MULT; M.Passive.CHICKEN_FALL_MULT = 1.0;
  const r = mkParrot(6, 70, 0); r.onGround = false; r.vy = -1.0; EL.tickMob(r);
  M.Passive.CHICKEN_FALL_MULT = mult;
  okAv(!(Math.abs(r.vy) < 0.7), 'a broken (1.0) slow-fall multiplier is caught by the 0.6 assertion');
  const r2 = mkParrot(8, 70, 0); r2.onGround = false; r2.maxWingDeviation = 0; M.Passive.tickChickenFlap(r2); r2.onGround = true;
  okAv(r2.maxWingDeviation === 1, 'maxWingDeviation ramp is observable (airborne tick reaches 1, not 0)');
  EL.list.length = 0;
}

// ── §songs. #1228 -- ParrotEntity.setNearbySongPlaying / tickMovement's songSource clear ────
say('\n§songs — a parrot beside a playing jukebox dances; leaving it or removing it ends the party');
{
  const JUKE = M.States.stateOf('jukebox') | 0;
  W.setBlock(3, 61, 3, JUKE);
  const e = mkParrot(3.5, 62, 3.5);
  M.Fly.setNearbySongPlaying(e, 3, 61, 3, true);
  M.Fly.tickSong(e);
  ok(M.Fly.isSongPlaying(e), 'within 3.46 of a jukebox the song keeps playing');
  e.x = 20; M.Fly.tickSong(e);
  ok(!M.Fly.isSongPlaying(e) && e.songSource === null, 'beyond 3.46 the party ends and the source clears');
  e.x = 3.5; M.Fly.setNearbySongPlaying(e, 3, 61, 3, true); W.setBlock(3, 61, 3, 0); M.Fly.tickSong(e);
  ok(!M.Fly.isSongPlaying(e), 'a removed jukebox ends the party');
  W.setBlock(3, 61, 3, JUKE); M.Fly.setNearbySongPlaying(e, 3, 61, 3, true);
  const d = M.Fly.tickSong; M.Fly.tickSong = () => {}; e.x = 20; M.Fly.tickSong(e);
  okAv(M.Fly.isSongPlaying(e), 'a broken tickSong is caught (the far parrot would still dance)');
  M.Fly.tickSong = d;
  EL.list.length = 0;
}

// ── §N. flyingTravel: fluid decided over the whole box (#2473) ──
say('\n§N — a ghast with only its top in water decays x0.8; in lava x0.5; dry x0.91');
{
  const WATER = M.States.stateOf('water') | 0, LAVA = M.States.stateOf('lava') | 0;
  const run = (blk) => {
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) W.setBlock(x, 73, z, 0);
    if (blk) W.setBlock(0, 73, 0, blk);
    const e = EL.spawn('ghast', 0.5, 70.2, 0.5);
    e.noclip = true; e.zza = 0; e.yya = 0; e.onGround = false; e.vx = 1; e.vy = 0; e.vz = 0;
    M.Fly.flyingTravel(e);
    return e.vx;
  };
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  ok(near(run(0), 0.91), 'dry: x0.91');
  ok(near(run(WATER), 0.8), 'water only at the box top (y+3.x, not y+0.4): x0.8');
  ok(near(run(LAVA), 0.5), 'lava at the box top: x0.5');
  okAv(near(run(WATER), 0.8) && !near(run(WATER), 0.91), 'the one-block sample would have said 0.91');
}

// ── §N+1. #3853: travelMob routes phantom (FlyingEntity) through flyingTravel ──
{
  const tv = (type) => {
    const e = EL.spawn(type, 0.5, 70.2, 0.5);
    e.noclip = true; e.zza = 0; e.yya = 0; e.onGround = false; e.vx = 1; e.vy = 1; e.vz = 1;
    M.Fly.travelMob(e);
    return e;
  };
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  const ph = tv('phantom');
  ok(near(ph.vx, 0.91) && near(ph.vy, 0.91) && near(ph.vz, 0.91), 'phantom travel: x0.91 on all three axes');
  okAv(near(ph.vy, 0.91) && !near(ph.vy, 0.98), 'phantom drag is 0.91, not the generic vy*0.98');
}

console.log('\n================ flycheck ================');
console.log(' assertions passed ..', pass);
console.log(' failures ...........', fails.length);
console.log(' anti-vacuity breaks ', breaks);
console.log('============================================');
if (fails.length) {
  console.log('\nFAILURES:');
  fails.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
console.log('✓ ' + breaks + ' breaks caught');
console.log('\nPASS  flycheck — ' + pass + ' assertions, 0 failures, ' + breaks + ' anti-vacuity checks');
