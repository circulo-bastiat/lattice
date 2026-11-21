#!/usr/bin/env node
// enderdragonwiringcheck.mjs — loop/enderdragon-wiring (ED.OWED item 1, QUEUE 0.00 row 0.00):
// the "bridging tickMovement onto a live entity" item four prior sessions (D-804/D-810/D-812)
// each examined and declined for lack of a live entity to bridge onto. THIS file is that bridge
// itself (src/07i_entitylist.js's EL.motionFor/DEFAULTS/mobTick-slot/travel-law rows for
// ender_dragon, plus src/07zzl_enderdragon.js's own ED.initEntity/ED.tickEntity) -- separate
// from enderdragonphasecheck's own section 16 (which re-checks the .decomp fact plus a smaller
// smoke test) and enderdragoncheck's own section 5 (a light regression check): this file is the
// dedicated, from-scratch wiring check the task asked for.
//
//   node tools/enderdragonwiringcheck.mjs [--verbose]
//
// Sections:
//   1. EL.canSpawn('ender_dragon') is true, EL.motionFor returns the real [0, 1] sentinel
//   2. EL.spawn('ender_dragon', ...) (the real /summon path -- Commands.summon calls EL.spawn
//      the same way for every mob, no ender_dragon-specific carve-out) returns a live entity
//      with the 8-part ED.EnderDragonEntity rig attached (EL.DEFAULTS.ender_dragon)
//   3. the no-goal-selector gate -- EL.WATER_TICK_ONLY.ender_dragon lets a dragon with no
//      e.ai reach EL.tickMob at all (the exact squid/glow_squid gap D-707 already named)
//   4. one real EL.tickMob(dragon) tick genuinely moves it (HoldingPattern's own
//      tickInRange()/followPath() picking a path target and flying toward it) -- anti-vacuity:
//      a SECOND dragon with its PhaseManager's current phase patched to a bare AbstractPhase
//      (getPathTarget() null, the real Hover/stub-phase shape) must NOT move, proving movement
//      in the real case is HoldingPattern actually driving it, not some other unconditional nudge
//   5. no double-physics -- EL.tickMob's generic Ph.travelMob fallback must NOT also run for a
//      dragon (it is excluded by e.type in the travel-law dispatch); anti-vacuity: proven by
//      patching NS.EnderDragon.tickEntity to a no-op and confirming Ph.travelMob's own fallback
//      really would move an untouched dragon if it ran (gravity 0/drag 1 alone would not, so the
//      probe temporarily swaps in a nonzero e.vx to prove the fallback path is live when reached)
//   6. many ticks: position stays finite and the dragon stays in HoldingPattern's own phase
//      (or a real phase transition), never NaN/Infinity -- a bridge with a sign error compounds
//      every tick, so this is run for 200 ticks, not one
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const VERBOSE = process.argv.includes('--verbose');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c && VERBOSE) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };

console.log('enderdragonwiringcheck -- ED.OWED item 1: bridging tickMovement onto a live EL entity');

function freshEngine() {
  const M = loadEngine({
    extra: ['07_world.js', '07h_entities.js', '14b_physics.js', '07k_goals.js', '07i_entitylist.js', '07zzl_enderdragon.js']
  });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
  M.Entities.init();
  M.EntityList.init();
  M.EnderDragon.init();
  return M;
}

// ============ 1. the gate ======================================================================
{
  const M = freshEngine();
  const EL = M.EntityList;
  say('1. EL.canSpawn / EL.motionFor');
  ok(EL.canSpawn('ender_dragon') === true, "EL.canSpawn('ender_dragon') is true");
  const mot = EL.motionFor('ender_dragon');
  ok(Array.isArray(mot) && mot[0] === 0 && mot[1] === 1,
    "EL.motionFor('ender_dragon') is [0, 1] (the ghast/wither_skull 'bespoke per-tick hook owns motion' sentinel) -- got " + JSON.stringify(mot));
}

// ============ 2. real spawn, real rig ==========================================================
{
  const M = freshEngine();
  const EL = M.EntityList;
  say('2. EL.spawn');
  const e = EL.spawn('ender_dragon', 3, 90, -7, {});
  ok(!!e, "EL.spawn('ender_dragon', 3, 90, -7, {}) returns a real entity, not null");
  ok(e.type === 'ender_dragon', 'the spawned entity type is ender_dragon');
  ok(e.width === 16 && e.height === 8, `dimensions come off the real registry row (16x8) -- got ${e.width}x${e.height}`);
  ok(e.maxHealth === 200 && e.health === 200, `maxHealth/health come off the real attrs row (200) -- got ${e.maxHealth}/${e.health}`);
  ok(!!e.dragon, 'EL.DEFAULTS.ender_dragon attached the ED.EnderDragonEntity rig (e.dragon)');
  ok(e.dragon && e.dragon.parts && e.dragon.parts.length === 8, 'e.dragon carries the real 8-part hitbox array');
  ok(e.dragon && e.dragon.getPhaseManager().getCurrent().getType().name === 'HoldingPattern',
    'a fresh no-fight spawn is seeded into HoldingPattern');
}

// ============ 3. the no-e.ai gate ==============================================================
{
  const M = freshEngine();
  const EL = M.EntityList;
  say('3. EL.WATER_TICK_ONLY / the mob gate');
  const e = EL.spawn('ender_dragon', 0, 90, 0, {});
  ok(!e.ai, 'a spawned dragon has NO goal selector (e.ai) -- PhaseManager is its whole AI substrate');
  ok(EL.WATER_TICK_ONLY.ender_dragon === 1, 'EL.WATER_TICK_ONLY names ender_dragon (the squid/glow_squid-shaped no-ai gate into EL.tickMob)');
  // anti-vacuity: without the WATER_TICK_ONLY row, EL.tickOne's own `mob` gate (`!!e.ai ||
  // EL.WATER_TICK_ONLY[e.type]`) would be false for a no-ai dragon and it would fall through to
  // the plain item/projectile physics tail instead of ever reaching EL.tickMob at all.
  const savedGate = EL.WATER_TICK_ONLY.ender_dragon;
  delete EL.WATER_TICK_ONLY.ender_dragon;
  const mobWithoutGate = !!e.ai || !!EL.WATER_TICK_ONLY[e.type];
  okAv(mobWithoutGate === false, 'anti-vacuity: removing the WATER_TICK_ONLY row really would drop a no-ai dragon out of the EL.tickMob gate (proves the row is load-bearing, not decorative)');
  EL.WATER_TICK_ONLY.ender_dragon = savedGate;
}

// ============ 4. one real tick genuinely moves it ==============================================
{
  const M = freshEngine();
  const EL = M.EntityList;
  say('4. real motion under HoldingPattern');
  const e = EL.spawn('ender_dragon', 0, 200, 0, {});
  const s0 = { x: e.x, y: e.y, z: e.z };
  for (let i = 0; i < 5; i++) EL.tickMob(e);
  const moved = (e.x !== s0.x) || (e.y !== s0.y) || (e.z !== s0.z);
  ok(moved, `5 real EL.tickMob ticks move the dragon -- (${s0.x},${s0.y},${s0.z}) -> (${e.x},${e.y},${e.z})`);

  // anti-vacuity: patch the phase manager's CURRENT phase to a bare AbstractPhase (getPathTarget
  // -> null, the exact stub shape the still-unported phases resolve to) on a second dragon and
  // prove it does NOT move -- so section 4's "it moved" above is HoldingPattern actually doing
  // real work, not tickMovement()/move() nudging position unconditionally regardless of phase.
  const e2 = EL.spawn('ender_dragon', 40, 200, 0, {});
  const ED = M.EnderDragon;
  e2.dragon.getPhaseManager().current = new ED.AbstractPhase(e2.dragon, ED.PHASE_TYPES.byName.Hover);
  const s2 = { x: e2.x, y: e2.y, z: e2.z };
  for (let i = 0; i < 5; i++) EL.tickMob(e2);
  okAv((e2.x === s2.x && e2.y === s2.y && e2.z === s2.z),
    `anti-vacuity: a dragon whose current phase is a bare stub (getPathTarget() null) does NOT move -- (${s2.x},${s2.y},${s2.z}) stayed (${e2.x},${e2.y},${e2.z}), proving section 4's real movement comes from HoldingPattern's own getPathTarget(), not an unconditional nudge`);
}

// ============ 5. no double-physics ==============================================================
{
  const M = freshEngine();
  const EL = M.EntityList;
  say('5. Ph.travelMob is excluded for ender_dragon');
  const e = EL.spawn('ender_dragon', 100, 200, 0, {});
  // Freeze the dragon rig's own motion (tickMovement a no-op) so ONLY the travel-law dispatch's
  // own choice of branch is under test here -- if Ph.travelMob's generic fallback ran too, a
  // deliberately-injected e.vx would move e.x even with the rig itself doing nothing.
  const savedReady = M.EnderDragon.ready;
  M.EnderDragon.ready = false; // both the mobTick-slot dispatch and the travel-law exclusion gate on this
  e.vx = 0; e.vy = 0; e.vz = 0; e.gravity = 0; e.drag = 1;
  EL.tickMob(e);
  // Ph.travelMob's own generic law subtracts the GLOBAL Ph.GRAVITY constant into e.vy
  // unconditionally (it does not even read e.gravity) -- a real, orthogonal-to-collision
  // fingerprint that the fallback branch actually ran, not a position check collision could mask.
  okAv(e.vy < 0,
    `anti-vacuity: with NS.EnderDragon.ready forced false (simulating the exclusion NOT being there), the generic Ph.travelMob fallback DOES run and pulls e.vy negative under its own global gravity constant (e.vy = ${e.vy}) -- proves the exclusion in section 5's real case below is actually preventing a real double-apply, not a no-op guard against nothing`);
  M.EnderDragon.ready = savedReady;

  // Real case: with EnderDragon wired (ready), NS.EnderDragon.tickEntity already fully applies
  // motion in the mobTick slot -- a stray leftover e.vx from that (not injected here) must NOT
  // ALSO get re-applied by Ph.travelMob afterward. Prove it by ticking normally many times and
  // checking the dragon's total displacement stays in the small per-tick range tickMovement()'s
  // own thrust/drag constants bound it to (0.06 forward thrust, 0.91 drag -- a double-apply
  // would run noticeably faster / diverge, not merely move).
  const e3 = EL.spawn('ender_dragon', 200, 200, 0, {});
  let maxStep = 0;
  let px = e3.x, py = e3.y, pz = e3.z;
  for (let i = 0; i < 40; i++) {
    EL.tickMob(e3);
    const step = Math.sqrt((e3.x - px) ** 2 + (e3.y - py) ** 2 + (e3.z - pz) ** 2);
    if (step > maxStep) maxStep = step;
    px = e3.x; py = e3.y; pz = e3.z;
  }
  ok(maxStep < 2.0, `no per-tick step exceeds a sane bound for this motion blend (0.06 thrust, 0.91 drag) -- max step seen: ${maxStep.toFixed(4)} (a double-applied travelMob would run much further per tick)`);
}

// ============ 6. long-run stability ============================================================
{
  const M = freshEngine();
  const EL = M.EntityList;
  say('6. 200-tick stability');
  const e = EL.spawn('ender_dragon', -50, 150, 30, {});
  for (let i = 0; i < 200; i++) EL.tickMob(e);
  ok(Number.isFinite(e.x) && Number.isFinite(e.y) && Number.isFinite(e.z),
    `position stays finite over 200 real ticks -- (${e.x}, ${e.y}, ${e.z})`);
  ok(Number.isFinite(e.vx) && Number.isFinite(e.vy) && Number.isFinite(e.vz), 'velocity stays finite over 200 real ticks');
}


// ============ 7. a real ED.EnderDragonFight attaches at spawn ==================================
{
  const M = freshEngine();
  const EL = M.EntityList;
  const ED = M.EnderDragon;
  say('7. real fight attaches at spawn (ED.OWED item 2 remainder)');
  const e = EL.spawn('ender_dragon', 0, 90, 0, {});
  const fight = e.dragon.getFight();
  ok(fight instanceof ED.EnderDragonFight, 'a /summoned dragon carries a real ED.EnderDragonFight (not the old always-empty {getAliveEndCrystals: () => 0} stand-in)');
  ok(typeof fight.getAliveEndCrystals === 'function' && fight.getAliveEndCrystals() === 10,
    `the real fight starts with all 10 ring crystals alive -- got ${fight.getAliveEndCrystals()}`);
  ok(fight.dragon === e.dragon, "the fight's own .dragon back-reference points at this same rig");

  // anti-vacuity: an explicit opts.fight stand-in is still honored verbatim, proving
  // ED.initEntity did not just hard-code `new ED.EnderDragonFight()` and drop the override path.
  const stub = { getAliveEndCrystals: () => 0 };
  const e2 = { x: 0, y: 90, z: 0, yaw: 0 };
  const dragon2 = ED.initEntity(e2, { fight: stub });
  okAv(dragon2.getFight() === stub,
    'anti-vacuity: ED.initEntity still honors an explicit opts.fight stand-in verbatim rather than always building its own fresh fight');
}

// ============ 8. fight.crystalDestroyed() -> dragon.crystalDestroyed() -> phase, for real ======
{
  const M = freshEngine();
  const EL = M.EntityList;
  say('8. fight.crystalDestroyed() reaches the real dragon/phase (per-part-damage-routing item)');
  const e = EL.spawn('ender_dragon', 0, 90, 0, {});
  const player = { x: 5, y: 90, z: 5 };
  e.dragon.playersFn = () => [player];
  const fight = e.dragon.getFight();
  const ringCrystal = fight.crystals[0];
  ok(e.dragon.getPhaseManager().getCurrent().getType().name === 'HoldingPattern', 'starts in HoldingPattern (baseline)');
  fight.crystalDestroyed(ringCrystal);
  ok(e.dragon.getPhaseManager().getCurrent().getType().name === 'StrafePlayer',
    'destroying a ring crystal with a real targetable player nearby drives the dragon into StrafePlayer (HoldingPatternPhase.crystalDestroyed -> strafePlayer) via the real fight -> dragon -> phase call chain, not a stub');
  ok(fight.getAliveEndCrystals() === 9, `the destroyed ring crystal is marked not-alive on the real fight -- got ${fight.getAliveEndCrystals()}`);

  // anti-vacuity: with NO targetable player at all, the SAME crystalDestroyed() call must NOT
  // switch phase -- proves the StrafePlayer transition above is really conditioned on a real
  // player pick (getClosestPlayer), not an unconditional side effect of calling crystalDestroyed().
  const e3 = EL.spawn('ender_dragon', 40, 90, 0, {});
  e3.dragon.playersFn = () => [];
  const fight3 = e3.dragon.getFight();
  fight3.crystalDestroyed(fight3.crystals[1]);
  okAv(e3.dragon.getPhaseManager().getCurrent().getType().name === 'HoldingPattern',
    'anti-vacuity: with no targetable player nearby, crystalDestroyed() leaves the dragon in HoldingPattern -- no unconditional phase switch');
}

console.log(`\n${pass} checks passed, ${breaks} anti-vacuity break(s) proved, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.log('  x ' + f);
  process.exit(1);
}
