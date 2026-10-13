#!/usr/bin/env node
// squidcheck — loop/squid-s98 (QUEUE 0.2 G18c): the squid + glow squid. Drives the REAL
// modules (07zi_squid.js through EL.spawn/EL.tickMob, Spawn.RULES.squid/glow_squid, Cb.hurt/
// Cb.notifyHurt) against .decomp/net/minecraft/entity/passive/SquidEntity.java and
// GlowSquidEntity.java (both read in full).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; if (VERBOSE) console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };

console.log('squidcheck — loop/squid-s98 (QUEUE 0.2 G18c): the squid + glow squid');
const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js',
          '07h_entities.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07k_goals.js',
          '07l_spawn.js', '14j_combat.js', '07t_fly.js', '07zi_squid.js']
});
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init(); M.EntityList.init(); M.World.init(1); M.Behave.init(M.World); M.Ai.init();
if (M.Combat && M.Combat.init) M.Combat.init();
M.Squid.init();
const EL = M.EntityList, W = M.World, S = M.States, Sq = M.Squid, Spawn = M.Spawn, Cb = M.Combat;

for (let cx = -1; cx <= 2; cx++) for (let cz = -1; cz <= 2; cz++) {
  const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
const stone = S.stateOf('stone') | 0;
const water = S.stateOf('water') | 0;
// a sealed 7x7x8 stone box, y=0..7, filled with water and a stone floor/ceiling/walls
const box = (fill) => { for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) for (let y = 0; y <= 7; y++) {
  const wall = x === -3 || x === 3 || z === -3 || z === 3 || y === 0 || y === 7;
  W.setBlock(x, y, z, wall ? stone : fill);
} };
box(water);
M.Player = { x: 100, y: 100, z: 100, EYE: 1.62 };

// §1 the closed set, attributes, spawn-time init
{
  const m1 = EL.motionFor('squid'), m2 = EL.motionFor('glow_squid');
  ok(m1 && m1[0] === 0 && m1[1] === 1, `squid motion is the inert [0,1] pair (like vex/evoker_fangs) — got ${JSON.stringify(m1)}`);
  ok(m2 && m2[0] === 0 && m2[1] === 1, `glow_squid motion is the SAME inert [0,1] pair — got ${JSON.stringify(m2)}`);
  { // D-567: the unbuilt witness is picked, not hard-coded — bee got built (D-559) and turned this red
    const VANILLA = ['ender_dragon','wither','giant','ghast','blaze','strider','hoglin','piglin','piglin_brute','zoglin','magma_cube','wither_skeleton','shulker','endermite','guardian','elder_guardian','phantom','warden'];
    const witness = VANILLA.find((t) => !EL.canSpawn(t));
    okAv(witness ? !EL.canSpawn(witness) : !EL.canSpawn('not_a_mob'), `a type nobody built (${witness || 'not_a_mob'}) is still refused — the closed set is real`);
  }

  const e = EL.spawn('squid', 0.5, 3.5, 0.5);
  ok(!!e, 'EL.spawn(squid) returns a mob');
  ok(e && e.maxHealth === 10, `squid max health 10 (createSquidAttributes) — got ${e && e.maxHealth}`);
  ok(e && e.squidAir === 300, 'a new squid is born with a full 300 air (WaterCreatureEntity default)');
  ok(e && e.thrustTimerSpeed > 0 && e.thrustTimerSpeed <= 0.2, `thrustTimerSpeed = 1/(nextFloat()+1)*0.2 in (0,0.2] — got ${e && e.thrustTimerSpeed}`);
  ok(e && e.swimX === 0 && e.swimY === 0 && e.swimZ === 0, 'a new squid has no swimming vector yet');

  const g = EL.spawn('glow_squid', 0.5, 3.5, 0.5);
  ok(g && g.maxHealth === 10, `glow_squid max health 10 — got ${g && g.maxHealth}`);
  ok(g && g.darkTicksRemaining === 0, 'a new glow squid starts with darkTicksRemaining 0');
}

// §2 SwimGoal: rolls a new vector when told to, holds it otherwise
{
  EL.list.length = 0;
  const e = EL.spawn('squid', 0.5, 3.5, 0.5);
  e.inWater = true;
  Sq.random = () => 0.999999;   // rint(50) !== 0, so ONLY the "no vector yet" branch fires here
  Sq.swimGoalTick(e);
  ok(Sq.hasSwimmingVector(e), 'no swimming vector yet forces a fresh roll even off the 1-in-50 chance');
  const [sx, sy, sz] = [e.swimX, e.swimY, e.swimZ];
  Sq.swimGoalTick(e);
  ok(e.swimX === sx && e.swimY === sy && e.swimZ === sz, 'with a vector already set, inWater, and no roll, the vector holds');
  okAv((() => { Sq.random = () => 0; Sq.swimGoalTick(e); return e.swimX !== sx || e.swimZ !== sz; })(),
    'forcing rint(50)===0 (the 1-in-50 roll) really re-rolls the vector — the branch is consulted');
  Sq.random = null;
}

// §3 EscapeAttackerGoal: canStart gates on inWater + a nearby attacker; tick sets an
// away-and-scaled vector; the ESCAPE goal (ticked second) overrides SwimGoal's own vector.
{
  EL.list.length = 0;
  const e = EL.spawn('squid', 0.5, 3.5, 0.5);
  e.inWater = true;
  const attacker = { x: 2.5, y: 3.5, z: 0.5, dead: false, removed: false };
  ok(!Sq.escapeCanStart(e), 'no lastHurtByEntity yet — EscapeAttackerGoal does not start');
  e.lastHurtByEntity = attacker;
  ok(Sq.escapeCanStart(e), 'inWater + a live attacker within 10 blocks — EscapeAttackerGoal starts');
  attacker.x = 100;
  okAv(!Sq.escapeCanStart(e), 'moving the attacker past sqrt(100)=10 blocks away really refuses it');
  attacker.x = 2.5;
  e.hurtSeq = 1; e.age = 10; e.hurtAge = 10;
  ok(Sq.escapeCanStart(e), 'a fresh hit: the attacker is remembered');
  e.age = 10 + 101;
  okAv(!Sq.escapeCanStart(e), '101 ticks after the hit getAttacker() is null — EscapeAttackerGoal does not start');
  e.hurtSeq = 0; e.flAttackSeq = 0; e.hurtAge = 0; e.age = 0;
  e.inWater = false;
  okAv(!Sq.escapeCanStart(e), 'out of water, even with a close attacker, EscapeAttackerGoal does not start');
  e.inWater = true;

  Sq.escapeTick(e);
  ok(e.swimX < 0, `fleeing AWAY from an attacker to the +x side pushes swimX negative — got ${e.swimX}`);
  ok(Math.abs(Math.hypot(e.swimX, e.swimY, e.swimZ) * 20 - 2 * 3.0) < 1e-4, `flee vector is the RAW delta (len 2) * 3.0 / 20, not normalised — got |swim|*20=${Math.hypot(e.swimX, e.swimY, e.swimZ) * 20}`);
  ok(e.squidEscapeTimer === 1, 'the escape goal counts its own ticks');
  for (const [d, want] of [[5, 15], [8, 3.0 * 8 - 0.6 * 8]]) {   // scale 3 - (len-5)/5 past 5 blocks
    attacker.x = 0.5 + d;
    Sq.escapeTick(e);
    const m = Math.hypot(e.swimX, e.swimY, e.swimZ) * 20;
    ok(Math.abs(m - want) < 1e-4, `flee |swim|*20 at ${d} blocks is len*scale=${want} — got ${m}`);
  }
  attacker.x = 2.5; e.squidEscapeTimer = 1;

  // priority order: SwimGoal ticked first, EscapeAttackerGoal ticked second, so an active
  // escape goal's vector wins the tick — Sq.tickAi's own header.
  Sq.random = () => 0;   // forces SwimGoal's own re-roll every call
  Sq.tickAi(e);
  ok(e.swimX < 0, 'EscapeAttackerGoal, ticked SECOND, overwrites whatever SwimGoal just rolled (still fleeing -x)');
  Sq.random = null;
}

// §4 tickMovement: in-water thrust/tentacle ramp and the direct velocity write
{
  EL.list.length = 0;
  const e = EL.spawn('squid', 0.5, 3.5, 0.5);
  e.inWater = true;
  Sq.setSwimmingVector(e, 0.2, -0.05, 0.0);
  e.thrustTimer = 0; e.thrustTimerSpeed = 0.5; e.swimVelocityScale = 1; e.turningSpeed = 1;
  Sq.tickMovement(e);
  ok(Math.abs(e.thrustTimer - 0.5) < 1e-9, `thrustTimer advances by thrustTimerSpeed — got ${e.thrustTimer}`);
  ok(Math.abs(e.vx - 0.2) < 1e-9 && Math.abs(e.vz - 0) < 1e-9,
    `in water, velocity is set DIRECTLY off the swim vector * scale — got vx=${e.vx} vz=${e.vz}`);
  const wantTentacle = Math.sin((0.5 / Math.PI) * (0.5 / Math.PI) * Math.PI) * Math.PI * 0.25;
  ok(Math.abs(e.tentacleAngle - wantTentacle) < 1e-9, `tentacleAngle follows the sin(t0²π)*π/4 ramp — got ${e.tentacleAngle}`);

  // thrust timer wrap: past 2π, subtract 2π exactly (no clamp, no reset to 0 server-side)
  EL.list.length = 0;
  const f = EL.spawn('squid', 0.5, 3.5, 0.5);
  f.inWater = true; f.thrustTimer = Math.PI * 2 - 0.1; f.thrustTimerSpeed = 0.5;
  Sq.tickMovement(f);
  ok(Math.abs(f.thrustTimer - (Math.PI * 2 - 0.1 + 0.5 - Math.PI * 2)) < 1e-9,
    `past 2π the wrap subtracts 2π exactly, no client-only reset to 0 — got ${f.thrustTimer}`);

  // out of water: manual gravity (-0.08) then *0.98, no swim vector consulted at all
  EL.list.length = 0;
  const g = EL.spawn('squid', 0.5, 3.5, 0.5);
  g.inWater = false; g.vx = 1; g.vy = 0; g.vz = 1;
  Sq.setSwimmingVector(g, 5, 5, 5);   // must be IGNORED out of water
  Sq.tickMovement(g);
  ok(g.vx === 0 && g.vz === 0, 'out of water, vx/vz are zeroed (the swim vector is not read at all)');
  ok(Math.abs(g.vy - (-0.08 * 0.98)) < 1e-9, `out of water, vy = (0 - 0.08) * 0.98 — got ${g.vy}`);
  okAv((() => { g.noGravity = true; g.vy = 0; Sq.tickMovement(g); return g.vy === 0; })(),
    'noGravity really skips the -0.08 subtraction (the gate is consulted)');
}

// bubble column over land: not inWater, but tickMovement swims (isInsideWaterOrBubbleColumn)
{
  EL.list.length = 0;
  const h = EL.spawn('squid', 0.5, 3.5, 0.5);
  const orig = W.getBlock;
  W.getBlock = () => S.stateOf('bubble_column');
  h.inWater = false; h.vx = 1; h.vy = 0; h.vz = 1;
  Sq.setSwimmingVector(h, 0.2, 0.1, 0.2); h.swimVelocityScale = 1;
  Sq.tickMovement(h);
  ok(h.vx !== 0 && Math.abs(h.vy - (-0.08 * 0.98)) > 1e-9, 'squid in a bubble_column cell (inWater false) swims, not flops');
  W.getBlock = orig;
  h.vx = 1; h.vz = 1; h.vy = 0;
  Sq.tickMovement(h);
  okAv(h.vx === 0 && h.vz === 0, 'without the bubble column the same squid flops (gate is consulted)');
}

// §5 glow squid: darkTicksRemaining counts down on its own, independent of squid's own state
{
  EL.list.length = 0;
  const e = EL.spawn('glow_squid', 0.5, 3.5, 0.5);
  e.inWater = true;
  e.darkTicksRemaining = 3;
  Sq.tickMovement(e); Sq.tickMovement(e); Sq.tickMovement(e); Sq.tickMovement(e);
  ok(e.darkTicksRemaining === 0, `darkTicksRemaining counts down to 0 and stops (never negative) — got ${e.darkTicksRemaining}`);
  const s = EL.spawn('squid', 2.5, 3.5, 0.5);
  s.inWater = true; s.darkTicksRemaining = 5;   // a plain squid should never even read this field
  Sq.tickMovement(s);
  okAv(s.darkTicksRemaining === 5, 'tickMovement never touches darkTicksRemaining on a plain squid (type-gated)');
}

// §6 air / drowning — WaterCreatureEntity.tickWaterBreathingAir verbatim
{
  EL.list.length = 0;
  const e = EL.spawn('squid', 0.5, 3.5, 0.5);
  e.inWater = false;
  for (let i = 0; i < 320; i++) Sq.tickAir(e);
  ok(e.squidAir === 0 && e.health < e.maxHealth, `air hits -20 -> 2.0 drown damage and air clamps to 0 — air=${e.squidAir} health=${e.health}`);
  const dmgAfter = e.maxHealth - e.health;
  ok(Math.abs(dmgAfter - 2.0) < 1e-9, `exactly 2.0 damage from drowning — got ${dmgAfter}`);
  e.inWater = true;
  Sq.tickAir(e);
  ok(e.squidAir === 300, 'back in water, air resets to 300 immediately');
  okAv((() => { const f = EL.spawn('squid', 1.5, 3.5, 0.5); f.inWater = true; f.squidAir = 1;
    Sq.tickAir(f); return f.squidAir === 300; })(),
    'a squid IN water never decrements air, no matter what it started at');
}

// §7 damage hooks: ink squirt (attacker-gated) vs glow squid dark ticks (unconditional)
{
  EL.list.length = 0;
  const e = EL.spawn('squid', 0.5, 3.5, 0.5);
  const attacker = { x: 1, y: 3.5, z: 0.5 };
  ok(Cb.hurt(e, 1, 0, false), 'Cb.hurt lands on a fresh squid');
  ok(!e.inkSquirts, 'Cb.hurt ALONE (no notifyHurt) does not squirt — attacker-gated, per SquidEntity.damage()');
  Cb.notifyHurt(e, attacker);
  ok(e.inkSquirts === 1, 'Cb.notifyHurt (a real attacker landed the hit) triggers the squirt exactly once');

  EL.list.length = 0;
  const g = EL.spawn('glow_squid', 0.5, 3.5, 0.5);
  ok(g.darkTicksRemaining === 0, 'sanity: starts at 0');
  Cb.hurt(g, 1, 0, false);   // no attacker at all (e.g. fire) -- must STILL dark the glow squid
  ok(g.darkTicksRemaining === 100, `GlowSquidEntity.damage()'s own UNCONDITIONAL half fires even with no attacker — got ${g.darkTicksRemaining}`);
  okAv((() => { const s = EL.spawn('squid', 2.5, 3.5, 0.5); Cb.hurt(s, 1, 0, false);
    return s.darkTicksRemaining === undefined; })(),
    'a PLAIN squid never grows a darkTicksRemaining field at all — the hook is type-gated');
}

// §8 spawn rules — WaterCreatureEntity.canSpawn / GlowSquidEntity.canSpawn verbatim
{
  const SL = 63;
  ok(Sq.canSpawn(0, 50, 0, SL) === false || true, 'sanity call does not throw');
  // build a clean water column at x=10,z=10 for y 40..64, stone everywhere outside it
  for (let y = 30; y <= 70; y++) W.setBlock(10, y, 10, water);
  W.setBlock(10, 29, 10, stone);
  ok(Sq.canSpawn(10, 50, 10, SL), 'mid-column water, within 13 of sea level: squid may spawn');
  ok(!Sq.canSpawn(10, SL - 14, 10, SL), 'one below the -13 band: refused');
  ok(!Sq.canSpawn(10, SL + 1, 10, SL), 'above sea level: refused');
  W.setBlock(10, 51, 10, stone);   // block directly above y=50 is now solid, not water
  okAv(!Sq.canSpawn(10, 50, 10, SL), 'a solid block directly above really refuses it (the block-above test is consulted)');
  W.setBlock(10, 51, 10, water);
  // FluidTags.WATER below: kelp / seagrass / waterlogged slab floors count (vanilla getFluidState(pos.down()))
  for (const nm of ['kelp', 'seagrass', 'oak_slab[waterlogged=true]']) {
    const st = (nm.includes('[') ? (() => { for (let l = 0; l < 6; l++) { const x = S.withLocal('oak_slab', l); if (S.waterIn[x]) return x; } return 0; })() : S.stateOf(nm)) | 0;
    W.setBlock(10, 49, 10, st);
    okAv(st > 0 && Sq.canSpawn(10, 50, 10, SL), `${nm} floor (water fluid) below: squid may spawn`);
  }
  W.setBlock(10, 49, 10, water);

  // deep dark water at x=20,z=20 for the glow squid, fully lightless
  for (let y = 0; y <= 40; y++) W.setBlock(20, y, 20, water);
  const deepY = SL - 40;
  ok(Sq.glowCanSpawn(20, deepY, 20, SL), `y=${deepY} (>=33 below sea level) in dark water: glow squid may spawn`);
  okAv(!Sq.glowCanSpawn(20, SL - 10, 20, SL), 'only 10 below sea level (not deep enough): refused');
  W.setBlock(20, deepY, 20, stone);
  okAv(!Sq.glowCanSpawn(20, deepY, 20, SL), 'a solid block AT the position (not water) really refuses it');
  W.setBlock(20, deepY, 20, water);

  ok(typeof Spawn.RULES.squid === 'function' && Spawn.canPlace('squid'), 'Spawn.RULES.squid is wired');
  ok(typeof Spawn.RULES.glow_squid === 'function' && Spawn.canPlace('glow_squid'), 'Spawn.RULES.glow_squid is wired');
  const save = Sq.canSpawn;
  Sq.canSpawn = () => true;
  const under = Spawn.RULES.squid(10, 50, 10, 'natural', () => 0);
  Sq.canSpawn = () => false;
  const refused = Spawn.RULES.squid(10, 50, 10, 'natural', () => 0);
  Sq.canSpawn = save;
  ok(under === true, 'with Sq.canSpawn passing, Spawn.RULES.squid passes -- no canMobSpawn/solid-ground tail (WaterCreatureEntity.canSpawn never calls it)');
  okAv(refused === false, 'breaking Sq.canSpawn makes Spawn.RULES.squid refuse — the rule is really consulted');
}

// §9 travel: Sq.travelMob is a raw Ph.move with the tick's own velocity, no extra decay
{
  EL.list.length = 0;
  const e = EL.spawn('squid', 0.5, 3.5, 0.5);
  e.vx = 0.1; e.vy = 0; e.vz = 0.1;
  const x0 = e.x, z0 = e.z;
  Sq.travelMob(e);
  ok(e.x !== x0 || e.z !== z0, 'Sq.travelMob actually moves the entity by its current velocity');
  ok(Math.abs(e.vx - 0.1) < 1e-9 && Math.abs(e.vz - 0.1) < 1e-9,
    `travel() applies NO friction/drag of its own — velocity unchanged after one call, got vx=${e.vx} vz=${e.vz}`);
}

// #1617: a velocity set between ticks (knockback) is the velocity move() uses on the NEXT tick;
// the swim vector is written only AFTER the move.
{
  const run = (swap) => {
    EL.list.length = 0;
    const e = EL.spawn('squid', 0.5, 3.5, 0.5);
    e.vx = 0.2; e.vy = 0; e.vz = 0;
    if (swap) { Sq.tickAi(e); Sq.tickAir(e); Sq.tickMovement(e); Sq.travelMob(e); }   // the old (wrong) order
    else Sq.tick(e);
    return e;
  };
  const x0 = 0.5;
  const good = run(false), bad = run(true);
  ok(Math.abs(good.x - x0 - 0.2) < 1e-6, `velocity set between ticks moves the squid by exactly that velocity next tick, moved ${good.x - x0}`);
  okAv(Math.abs(bad.x - x0 - 0.2) >= 1e-6, 'deliberate break (tickMovement before travel) no longer moves by the knockback velocity');
}

// D-707 leftover unit (this pass, mob-test-passive-leftover) -- §10: the LIVE wiring.
// squid/glow_squid have no Ai.ROSTER entry BY DESIGN (07zi_squid.js's own header), and every
// section above drives Sq.swimGoalTick/Sq.tickMovement/Sq.travelMob DIRECTLY -- never through
// EL.tickOne, the one function every OTHER live mob actually ticks through (EL.tickMob's own
// `if (mob) return EL.tickMob(e)` gate in 07i_entitylist.js used `!!e.ai` as its only door in,
// and a squid/glow_squid never gets an `e.ai` -- so a live-spawned one never reached Sq.tick at
// all until this pass). Found by a real browser spawn (tools/petmobpeek.mjs): a summoned
// glow_squid sat dead still in water for 3 real seconds, hasAi:false. This section proves the
// PRODUCTION path (EL.spawn then repeated EL.tickOne, not a direct Sq.* call) actually moves it.
{
  EL.list.length = 0;
  const e = EL.spawn('glow_squid', 0.5, 3.5, 0.5);
  ok(!!e.ai, 'a glow_squid gets a real e.ai (SwimGoal + EscapeAttackerGoal, #2228)');
  ok(EL.WATER_TICK_ONLY && EL.WATER_TICK_ONLY[e.type] === 1,
     'but EL.WATER_TICK_ONLY marks it so EL.tickOne routes it into EL.tickMob anyway');
  const x0 = e.x, y0 = e.y, z0 = e.z;
  for (let t = 0; t < 60; t++) EL.tickOne(e);
  const moved = Math.hypot(e.x - x0, e.y - y0, e.z - z0);
  // anti-vacuity for THIS assertion is a git-stash rerun of 07i_entitylist.js (see the commit
  // this section was added in): with the `EL.WATER_TICK_ONLY` gate reverted, `e.ai` alone is
  // falsy for a glow_squid, `EL.tickOne` never calls `EL.tickMob`, and this line reads 0.000.
  okAv(moved > 0.01, `60 real EL.tickOne() calls through the PRODUCTION dispatch move a glow_squid in water (moved ${moved.toFixed(3)} blocks) -- it used to sit dead still (0.000) with the old !!e.ai-only gate`);
}

// §yaw (#3076): bodyYaw lerp is the raw unwrapped difference and runs at zero velocity
{
  const e = EL.spawn('squid', 0.5, 3.5, 0.5);
  const ref = (y, vx, vz) => y + (Math.PI - Math.atan2(vx, vz) - y) * 0.1;
  e.inWater = true; e.turningSpeed = 0; e.thrustTimerSpeed = 0.5; Sq.setSwimmingVector(e, 0, 0, 0); e.swimVelocityScale = 1; e.yaw = 0.5;
  let y = 0.5, good = true;
  for (let t = 0; t < 5; t++) { Sq.tickMovement(e); y = ref(y, e.vx, e.vz); if (Math.abs(e.yaw - y) > 1e-9) good = false; }
  okAv(good && Math.abs(e.yaw - 0.5) > 0.1, 'zero velocity still eases yaw (toward PI) per the vanilla formula');
  e.yaw = 3.0; y = 3.0; Sq.setSwimmingVector(e, 0.1, 0, -0.05); good = true;
  for (let t = 0; t < 5; t++) { Sq.tickMovement(e); y = ref(y, e.vx, e.vz); if (Math.abs(e.yaw - y) > 1e-9) good = false; }
  okAv(good, 'yaw trace equals unwrapped vanilla formula over 5 ticks');
  e.yaw = -3.0; Sq.setSwimmingVector(e, 0, 0, 0.1); Sq.tickMovement(e);
  okAv(e.yaw > -3.0 + 0.5, 'across the +-180 seam the raw difference (~0.6 rad step) is taken, not the short arc');
}

// #3480: attacker-less damage squirts while the remembered attacker is live, not once forgotten
{
  EL.list.length = 0;
  const e = EL.spawn('squid', 0.5, 3.5, 0.5); e.health = e.maxHealth = 1000;
  Cb.hurt(e, 1, 0, false); e.invulnerableTime = 0;
  ok(!e.inkSquirts, 'no remembered attacker: fire damage does not squirt');
  e.lastHurtByEntity = { x: 0, y: 0, z: 0, health: 20 }; e.hurtSeq = 1; e.age = 0;
  let n = 0; const orig = Sq.squirt; Sq.squirt = () => { n++; };
  Cb.hurt(e, 1, 0, false, { source: 'onFire', fire: true });
  okAv(n === 1, 'fire damage with a remembered attacker squirts once');
  e.invulnerableTime = 0; e.age = 500;
  Cb.hurt(e, 1, 0, false, { source: 'onFire', fire: true });
  okAv(n === 1, 'expired attacker: no squirt');
  Sq.squirt = orig;
}


// ── Sq.OWED #5733: per-instance java.util.Random(entityId) ──
{
  const ref = (seed) => { let st = (BigInt(seed) ^ 0x5DEECE66Dn) & 0xFFFFFFFFFFFFn;
    return () => { st = (st * 0x5DEECE66Dn + 0xBn) & 0xFFFFFFFFFFFFn; return Number(st >> 24n) / 16777216; }; };
  const tent = (id, seedOf) => { const e = { id, type: 'squid' }; const keep = Sq.random; Sq.random = null;
    if (seedOf !== undefined) e.id = seedOf; Sq.spawnInit(e); e.id = id; Sq.random = keep; return e; };
  let bad = 0;
  for (let id = 1; id <= 50; id++) { const e = tent(id); if (e.thrustTimerSpeed !== 1 / (ref(id)() + 1) * 0.2) bad++; }
  ok(bad === 0, 'tentacle speed equals Java LCG reference for ids 1..50 (' + bad + ' bad)');
  const a = tent(7), b = tent(7); const seq = (e) => { const o = []; for (let i = 0; i < 20; i++) { e.swimX = e.swimY = e.swimZ = 0; Sq.swimGoalTick(e); o.push(e.swimX, e.swimY, e.swimZ); } return o.join(); };
  okAv(seq(a) === seq(b), 'same id behaves identically');
  let bad0 = 0;
  for (let id = 1; id <= 50; id++) { const e = tent(id, 0); if (e.thrustTimerSpeed !== 1 / (ref(id)() + 1) * 0.2) bad0++; }
  okAv(bad0 > 0, 'seeding with 0 is caught');
}
console.log('================ squidcheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
console.log('==============================================');
process.exit(fails.length ? 1 : 0);
