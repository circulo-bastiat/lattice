#!/usr/bin/env node
// withercheck.mjs — QUEUE 0.00 part 2 (mob-wither): src/07zzm_wither.js's own AI slice
// (goal roster + tickMovement homing blend). NOT the ranged attack, the invulnerability timer,
// the summoning-structure detector, or the renderer — Wi.OWED (07zzm_wither.js) names all of
// those as later slices.
//
//   node tools/withercheck.mjs [--verbose]
//
// Sections:
//   1. registry — EL.canSpawn/EL.spawn still real (confident-lamport-mdnl4x's own slice,
//      unchanged here), Ai.ROSTER.wither registered, e.ai/e.flyMove attached on spawn
//   2. candidates — CAN_ATTACK_PREDICATE: players and non-undead mobs are eligible, every
//      undead type (skeleton, wither_skeleton, zombie, the wither itself) is refused, a
//      removed/dead entity is refused
//   3. targeting — a live, in-range, non-undead candidate is acquired by the target selector;
//      an undead one within the same range is NOT (anti-vacuity: a stub predicate that always
//      returns true would pass every other section here but fail this one)
//   4. RevengeGoal — retaliates against whoever hurt it (no group filter, .decomp confirmed:
//      `new RevengeGoal(this)` takes no predicate argument)
//   5. tickMovement — the unconditional vertical 0.6 damp with no target; the horizontal
//      catch-up/steer blend once a target is set, converging toward it over repeated ticks
//      (anti-vacuity: a no-op tickMovement would pass §1 but leave velocity exactly at its
//      pre-call value here)
//   6. end-to-end regression — EL.spawn + EL.tickMob, one full real tick, no throw
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };

console.log('withercheck -- QUEUE 0.00 part 2, the wither AI slice (goal roster + tickMovement homing)');

const EXTRA = ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07q_effects.js',
  '14j_combat.js', '07t_fly.js', '07zzh_blaze.js', '07zzi_ghast.js', '07zzm_wither.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.EntityList.init();
M.Ai.init();

const EL = M.EntityList, Ai = M.Ai, Wi = M.Wither;
ok(Wi.ready === true, 'Wi.ready is true once loaded');

// Parked far outside every follow_range (40) this file uses, so the player never becomes an
// unplanned "nearest candidate" side effect (Ai.NearestAttackableTargetGoal.canUse -- and every
// existing roster that reuses it, e.g. enderman's own -- sets e.target directly as part of ITS
// OWN canUse(), the same "canStart also picks" shape ActiveTargetGoal.canStart has in vanilla;
// a park position keeps each section's own spawns the only real candidates in range).
M.Player = { x: 100000, y: 70, z: 0, eyeHeight: 1.62, type: 'player' };

// ============ 1. registry ====================================================================
say('1. registry');
ok(Ai.ROSTER.wither === Wi.roster, 'Ai.ROSTER.wither is Wi.roster');
ok(EL.canSpawn('wither') === true, 'EL.canSpawn(\'wither\') is still true (confident-lamport-mdnl4x\'s slice, unchanged)');
const probe = EL.spawn('wither', 0, 70, 0, {});
ok(!!probe && probe.type === 'wither', 'EL.spawn(\'wither\', ...) returns a real wither');
ok(probe.health === 300 && probe.maxHealth === 300, 'spawned wither has the real 300 HP (createWitherAttributes)');
ok(!!probe.ai, 'a spawned wither is born with e.ai (the rostered goal selector), not inert');
ok(!!probe.flyMove, 'a spawned wither is born with e.flyMove (Fl.MoveControl), same shape ghast uses');
ok(probe.experiencePoints === 50, 'Wi.initWither sets experiencePoints = 50 (ctor literal)');

// ============ 2. candidates ==================================================================
// Wi.candidates itself has no range gate (that's ActiveTargetGoal's own job, §3) -- position
// does not matter here, so this section stays wherever it lands. §3/§4 below each get their own
// far-apart parking spot (2xx/4xx) so an earlier section's leftover spawns can never fall inside
// a LATER section's 40-block follow_range and skew which candidate is "nearest".
say('2. candidates');
const e = EL.spawn('wither', 0, 70, 0, {});
const skel = EL.spawn('skeleton', 3, 70, 0, {});
const wskel = EL.spawn('wither_skeleton', 4, 70, 0, {});
const zom = EL.spawn('zombie', 5, 70, 0, {});
const cow = EL.spawn('cow', 6, 70, 0, {});
const other = EL.spawn('wither', 7, 70, 0, {});
const ctx = EL.aiCtx(e);
const cands = Wi.candidates(e, ctx);
const types = cands.map((c) => c.type || 'player');
ok(types.indexOf('player') >= 0, 'the player (non-undead) is a candidate');
ok(types.indexOf('cow') >= 0, 'a live cow (non-undead) is a candidate');
okAv(types.indexOf('skeleton') < 0, 'a skeleton (undead) is refused');
okAv(types.indexOf('wither_skeleton') < 0, 'a wither_skeleton (undead) is refused');
okAv(types.indexOf('zombie') < 0, 'a zombie (undead) is refused');
okAv(types.indexOf('wither') < 0, 'ANOTHER wither (undead group itself) is refused');
ok(cands.indexOf(e) < 0, 'the wither never candidates itself');
other.removed = true;
const cands2 = Wi.candidates(e, ctx);
okAv(cands2.indexOf(other) < 0, 'a removed entity is refused even if it were otherwise eligible');

// ============ 3. targeting ===================================================================
say('3. targeting');
{
  const w = EL.spawn('wither', 200, 70, 0, {});
  const nearCow = EL.spawn('cow', 205, 70, 0, {});
  w.target = null;
  w.ai.tick();
  ok(w.target === nearCow, 'ActiveTargetGoal acquires the nearest in-range non-undead candidate (a cow, here)');
}
{
  const w = EL.spawn('wither', 260, 70, 0, {});
  const nearSkel = EL.spawn('skeleton', 265, 70, 0, {});
  w.target = null;
  w.ai.tick();
  okAv(w.target !== nearSkel, 'ActiveTargetGoal does NOT acquire an in-range skeleton (undead group)');
}

// ============ 4. RevengeGoal ==================================================================
say('4. RevengeGoal (no group filter -- .decomp: new RevengeGoal(this), no predicate arg)');
{
  const w = EL.spawn('wither', 400, 70, 0, {});
  const attackerZombie = EL.spawn('zombie', 420, 70, 20, {});   // the ONLY other live entity anywhere near here
  w.target = null;
  w.lastHurtByEntity = attackerZombie;
  w.hurtSeq = 1;
  w.ai.tick();
  ok(w.target === attackerZombie, 'RevengeGoal retaliates against its attacker even though the attacker is undead');
}

// ============ 5. tickMovement ================================================================
// §5's own assertions call Wi.tickMovement DIRECTLY (never e.ai.tick()), so the
// candidate-side-effect quirk §3/§4's own headers describe cannot reach it either way —
// position is not load-bearing here, but a fresh spot keeps the section self-contained anyway.
say('5. tickMovement');
{
  const w = EL.spawn('wither', 600, 70, 0, {});
  w.vy = 1.0; w.target = null;
  Wi.tickMovement(w);
  ok(Math.abs(w.vy - 0.6) < 1e-9, 'no target: vy is damped by exactly 0.6 (the unconditional multiply)');
}
{
  const w = EL.spawn('wither', 600, 70, 0, {});
  w.target = { x: 630, y: 70, z: 0 };
  w.vx = 0; w.vy = 0; w.vz = 0;
  const before = w.vx;
  Wi.tickMovement(w);
  okAv(w.vx > before, 'with a target 30 blocks away on +x, one tick biases vx toward it (not a no-op)');
  for (let i = 0; i < 40; i++) Wi.tickMovement(w);
  ok(w.vx > 0.45 && w.vx < 0.55, 'the horizontal steer converges to its own steady state (~0.5, 0.3/0.6 fixed point)');
  ok(Math.abs(w.yaw - Math.atan2(w.vx, -w.vz)) < 1e-9, 'yaw tracks atan2(vx, -vz) once horizontal speed clears the 0.05 gate (D-415)');
}
{
  const w = EL.spawn('wither', 600, 70, 0, {});
  const deadTarget = EL.spawn('cow', 630, 70, 0, {});
  deadTarget.dead = true;
  w.target = deadTarget;
  w.vx = 0; w.vy = 0; w.vz = 0;
  Wi.tickMovement(w);
  ok(w.vx === 0 && w.vz === 0, 'a dead target is not steered toward (guard mirrors ActiveTargetGoal\'s own liveness check)');
}

// ============ 6. end-to-end regression =======================================================
say('6. end-to-end regression -- one real EL.tickMob tick, no throw');
{
  const w = EL.spawn('wither', 800, 70, 0, {});
  let threw = null;
  try { EL.tickMob(w); } catch (err) { threw = err; }
  ok(threw === null, 'EL.tickMob(wither) runs one full tick with no throw' + (threw ? (': ' + threw.stack) : ''));
}

// ============ 7. #4465 player eye height ======================================================
say('7. player eye height -- skull aim at standing eye*0.5, not height*0.85');
{
  const Cb = M.Combat;
  const pl = { type: 'player', height: 1.8, eyeHeight: 1.62, x: 0, y: 70, z: 0 };
  okAv(Math.abs(Cb.eyeHeightOf(pl) - 1.62) < 1e-6, 'Combat.eyeHeightOf(player) == 1.62');
  okAv(Math.abs(Cb.eyeHeightOf({ ...pl, eyeHeight: 1.27 }) - 1.27) < 1e-6, 'sneaking player eye 1.27');
  const sk = Wi.attack(EL.spawn('wither', 800, 70, 0, {}), pl);
  ok(sk !== undefined, 'Wi.attack at a player runs');
}

console.log(`withercheck: ${pass} assertions, ${fails.length} failed`);
if (fails.length) { fails.forEach((m) => console.log('  FAIL: ' + m)); process.exit(1); }
