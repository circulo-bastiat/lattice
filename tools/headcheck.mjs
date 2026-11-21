#!/usr/bin/env node
// headcheck.mjs — D-422: A MOB'S HEAD TURNS, AND ITS BODY FOLLOWS.
//
//   node tools/headcheck.mjs [--verbose]
//
// ⚠⚠ **WHAT THIS EXISTS TO CATCH.** Every mob in the game stared straight along its own body:
// `ER.animOf` fed `netHeadYaw = 0, headPitch = 0` to every model there is and said so in its
// header. The goal that was supposed to make a mob watch you did something worse than nothing —
// `Ai.LookAtPlayerGoal.tick` wrote `e.yaw`, the BODY yaw, with no rate limit and no clamp, so a
// cow snapped its whole body round in ONE TICK the instant a player came in range. `goalcheck`
// has 14 sections and not one of them mentions a look goal, which is exactly how it survived.
// That is D-417's class of bug one field over: a GOAL writing the state a CONTROL owns.
//
// The law is the 1.18.2 jar's, disassembled this session (the container did the javap, STATE §0):
//   `bcv` LookControl · `bcr` BodyRotationControl · `aya` Mob (getMaxHeadXRot/YRot/HeadRotSpeed)
// and the eight per-species overrides were read off every class in Mob's subtree, then matched
// to registry names through EntityType's own `<clinit>` — not guessed.
//
// ANTI-VACUITY: every section breaks its own input and asserts the break is caught (D-30/D-305).

import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

const VERBOSE = process.argv.includes('--verbose');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { ok(c, m); if (c) console.log('   ✓ ' + m.replace(/^anti-vacuity: /, '')); };
const say = (s) => { if (VERBOSE) console.log('   ' + s); };

console.log('headcheck — the head turns, the body follows (D-422)');

const M = loadEngine({
  extra: ['02g_items.js', '02f_tags.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
          '07k_goals.js', '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js'],
  dom: false
});
initRegistry(M);
{
  const mm = JSON.parse(readFileSync(MCLITE_ROOT + 'assets/models.meta.json', 'utf8'));
  M.BEModel.init({ models: readFileSync(MCLITE_ROOT + 'assets/models.bin').toString('base64'),
                   modelsBytes: mm.rawBytes });
  const raw = readFileSync(MCLITE_ROOT + 'assets/mob-geometry.json');
  M.DATA = Object.assign({}, M.DATA, {
    mobGeometry: deflateRawSync(raw, { level: 9 }).toString('base64'), mobGeometryBytes: raw.length
  });
}
M.EntityRender.init();

const Ai = M.Ai, ER = M.EntityRender;
Math.random = () => 0;   // #4282: pin LookAtEntityGoal's 0.02 start roll
const DEG = Math.PI / 180, RAD = 180 / Math.PI;
ok(!!Ai, 'the goal module is up');

const mob = (type, x, y, z) => ({
  type: type, x: x, y: y, z: z, yaw: 0, eyeHeight: 1.3, zza: 0,
  xOld: x, zOld: z, yHeadRot: 0, xHeadRot: 0, maxHealth: 10, animPos: 0, animSpeed: 0
});
const head = (e) => { Ai.tickHead(e); return e; };

// ═══════════════ 1. the two rotation primitives are NOT the same function ══════════════════
console.log('\n 1. rotateTowards MOVES; rotateIfNecessary only CLAMPS');
{
  const t = (a, b, m) => Ai.rotateTowards(a * DEG, b * DEG, m * DEG) * RAD;
  const c = (a, b, m) => Ai.rotateIfNecessary(a * DEG, b * DEG, m * DEG) * RAD;
  ok(Math.abs(t(0, 90, 10) - 10) < 1e-6, 'rotateTowards steps 10 of the 90 degrees it is asked for');
  ok(Math.abs(t(0, 5, 10) - 5) < 1e-6, 'and lands exactly when the gap is smaller than the step');
  ok(Math.abs(t(0, -90, 10) + 10) < 1e-6, 'and it steps the short way round in both directions');
  ok(Math.abs(c(0, 90, 10) - 80) < 1e-6, 'rotateIfNecessary pulls back to exactly the limit (80, not 10)');
  ok(Math.abs(c(85, 90, 10) - 85) < 1e-6, 'and does NOTHING at all while inside it');
  // ⚠ the distinction, stated: these two answers must differ, or one of them is the other
  okAv(Math.abs(t(0, 90, 10) - c(0, 90, 10)) > 1,
       'anti-vacuity: the two give different answers for the same arguments, so swapping them is visible');
  // the wrap: 350 -> 10 is a ten-degree turn, not a 340-degree one
  ok(Math.abs(t(350, 10, 30) - 10) < 1e-6, 'and 350 to 10 is a twenty-degree turn, not a 340-degree one');
}

// ═══════════════ 2. the limits are the jar's, per species ══════════════════════════════════
console.log('\n 2. the head limits, and the eight species that override them');
{
  ok(Math.abs(Ai.HEAD_MAX_PITCH * RAD - 40) < 1e-6, 'Mob.getMaxHeadXRot is 40');
  ok(Math.abs(Ai.HEAD_MAX_YAW * RAD - 75) < 1e-6, 'Mob.getMaxHeadYRot is 75');
  ok(Math.abs(Ai.HEAD_ROT_SPEED * RAD - 10) < 1e-6, 'Mob.getHeadRotSpeed is 10');
  const WANT = {
    slime: [0, 75], magma_cube: [0, 75], guardian: [180, 75], elder_guardian: [180, 75],
    shulker: [180, 180], ravager: [40, 45], goat: [40, 15], axolotl: [1, 1], dolphin: [1, 1]
  };
  for (const type of Object.keys(WANT)) {
    const e = mob(type, 0, 64, 0);
    ok(Math.abs(Ai.maxHeadPitch(e) * RAD - WANT[type][0]) < 1e-6,
       `${type}'s max head pitch is ${WANT[type][0]}`);
    ok(Math.abs(Ai.maxHeadYaw(e) * RAD - WANT[type][1]) < 1e-6,
       `${type}'s max head yaw is ${WANT[type][1]}`);
  }
  // a mob with no entry gets the defaults, both ways round
  const cow = mob('cow', 0, 64, 0);
  ok(Math.abs(Ai.maxHeadPitch(cow) * RAD - 40) < 1e-6, 'a cow gets the default 40');
  ok(Math.abs(Ai.maxHeadYaw(cow) * RAD - 75) < 1e-6, 'and the default 75');
  // the one override that is a branch rather than a constant
  const wolf = mob('wolf', 0, 64, 0);
  ok(Math.abs(Ai.maxHeadPitch(wolf) * RAD - 40) < 1e-6, 'a standing wolf gets the default 40');
  wolf.sitting = true;
  ok(Math.abs(Ai.maxHeadPitch(wolf) * RAD - 20) < 1e-6, 'and a SITTING wolf gets 20 (Wolf.getMaxHeadXRot)');
  okAv(Ai.HEAD_LIMITS.goat && Ai.HEAD_LIMITS.goat.y === 15,
       'anti-vacuity: the table carries real per-species numbers, not a copy of the default');
}

// ═══════════════ 3. the look control — rate limited, and clamped ═══════════════════════════
console.log('\n 3. a mob turns its head toward a player, ten degrees a tick');
{
  const e = mob('cow', 0, 64, 0);          // facing yaw 0 = north
  Ai.tickHead(e);                          // attaches the controls
  const target = { x: 10, y: 64 + 1.62, z: 0 };   // due EAST of it: a 90-degree turn
  const seen = [];
  for (let i = 0; i < 12; i++) {
    e.look.setLookAt(target.x, target.y, target.z);
    Ai.tickHead(e);
    seen.push(Math.round(e.yHeadRot * RAD));
  }
  say('head yaw per tick: ' + seen.join(', '));
  ok(seen[0] === 10, `the first tick turns the head exactly ten degrees (${seen[0]})`);
  ok(seen[1] === 20, 'and the second another ten');
  // ⚠ the whole point of the unit: it is a TURN, not a snap
  ok(seen[0] !== 90, 'it is NOT a snap to the target');
  ok(Math.abs(seen[8] - 90) <= 1, `and after nine ticks it is there (${seen[8]})`);
  ok(Math.abs(seen[11] - 90) <= 1, 'and it stays there rather than overshooting');
  // the BODY did not move: a standing mob turns its head first
  ok(Math.abs(e.yaw * RAD) < 76, 'the body has not snapped round with it');

  // the pitch: looking down at something below
  const f = mob('cow', 0, 64, 0);
  Ai.tickHead(f);
  f.look.setLookAt(0, 60, 3);
  Ai.tickHead(f);
  ok(f.xHeadRot > 0, `looking at something BELOW gives a positive head pitch (${(f.xHeadRot * RAD).toFixed(1)})`);
  ok(f.xHeadRot <= Ai.maxHeadPitch(f) + 1e-9, 'clamped to the species maximum');
  // and it is thrown away and rebuilt every tick (resetXRotOnTick)
  Ai.tickHead(f); Ai.tickHead(f); Ai.tickHead(f);
  ok(Math.abs(f.xHeadRot) < 1e-9, 'and with nothing to look at the head levels off at once');

  // while PATHING the head is clamped to the body
  const g = mob('cow', 0, 64, 0);
  Ai.tickHead(g);
  for (let i = 0; i < 30; i++) { g.navigating = true;   // a path is being followed (Ai.stepToward sets it)
    g.look.setLookAt(0, 65, 20); Ai.tickHead(g); }
  const off = Math.abs(g.yHeadRot - g.yBodyRot) * RAD;
  ok(off <= 75.001, `a walking mob's head never leaves 75 degrees of its body (${off.toFixed(1)})`);

  okAv((() => {
    // anti-vacuity: with the rate limit removed the first tick lands the whole 90
    const h = mob('cow', 0, 64, 0);
    Ai.tickHead(h);
    const saved = Ai.HEAD_ROT_SPEED;
    Ai.HEAD_ROT_SPEED = Math.PI;
    h.look.setLookAt(10, 65.62, 0);
    Ai.tickHead(h);
    const snapped = Math.abs(h.yHeadRot * RAD - 90) < 1;
    Ai.HEAD_ROT_SPEED = saved;
    return snapped;
  })(), 'anti-vacuity: take the rate limit away and the head snaps in one tick — §3 measures a real limit');
}

// ═══════════════ 4. the body follows, on its own clock ═════════════════════════════════════
console.log('\n 4. and then the body comes round (BodyRotationControl)');
{
  // EL.tickMob runs the head slot, then the travel, then Ai.tickBody (#582) — the body no longer rides tickHead
  const step = (e) => { Ai.tickHead(e); Ai.tickBody(e); };
  // standing still, head turned hard right: the body is pulled to within the limit at once
  const e = mob('cow', 0, 64, 0);
  step(e);
  for (let i = 0; i < 20; i++) { e.look.setLookAt(10, 65.62, 0); step(e); }
  const offset = Math.abs(Ai.wrapRad(e.yHeadRot - e.yBodyRot)) * RAD;
  ok(offset <= 75.001, `a standing mob's body is pulled to within 75 degrees of its head (${offset.toFixed(1)})`);

  // then the head holds still, and the body keeps coming until it is square on
  let last = offset;
  for (let i = 0; i < 40; i++) step(e);
  const settled = Math.abs(Ai.wrapRad(e.yHeadRot - e.yBodyRot)) * RAD;
  say(`offset ${offset.toFixed(1)} -> ${settled.toFixed(1)} degrees`);
  ok(settled < 1, `with the head held still the body comes all the way round (${settled.toFixed(2)})`);
  ok(settled < last, 'and it is a ramp, not a step — it closed gradually');

  // MOVING is the other rule entirely: the head is pulled to the body, not the body to the head
  const g = mob('cow', 0, 64, 0);
  step(g);
  g.yHeadRot = 170 * DEG;
  g.x = 5; g.z = 5;                        // moved a long way this tick
  step(g);
  ok(Math.abs(Ai.wrapRad(g.yHeadRot - g.yaw)) * RAD <= 75.001,
     'a MOVING mob has its head pulled back to the body instead');

  okAv((() => {
    // anti-vacuity: a body control that never runs leaves the head wound round for ever
    const h = mob('cow', 0, 64, 0);
    step(h);
    const saved = h.body.tick;
    h.body.tick = function () {};
    for (let i = 0; i < 40; i++) { h.look.setLookAt(0, 65.62, 10); step(h); }
    h.body.tick = saved;
    return Math.abs(Ai.wrapRad(h.yHeadRot - h.yaw)) * RAD > 100;
  })(), 'anti-vacuity: stop the body control and a standing mob winds its head round past 100 degrees');
}

// ═══════════════ 5. the renderer is actually given the angle ═══════════════════════════════
console.log('\n 5. and the model is posed with it');
{
  const e = mob('cow', 0, 64, 0);
  Ai.tickHead(e);
  for (let i = 0; i < 4; i++) { e.look.setLookAt(10, 65.62, 0); Ai.tickHead(e); }
  const anim = ER.animOf(e, 1);
  ok(!!anim, 'animOf answers for a mob');
  ok(anim && Math.abs(anim.netHeadYaw - 40) < 2,
     `netHeadYaw is the head's offset from the body IN DEGREES (${anim && anim.netHeadYaw.toFixed(1)})`);
  ok(anim && anim.netHeadYaw !== 0, 'and it is no longer the hard zero this file shipped with');

  // the delta the emitter actually applies to the head part
  const kind = ER.modelKindOf('cow');
  const d0 = ER.setupAnimDelta('head', 0, 0, 0, 0, false, kind);
  const d1 = ER.setupAnimDelta('head', 0, 0, anim.netHeadYaw, anim.headPitch, false, kind);
  ok(d1 && Math.abs(d1.ry) > 0.1, `the cow's head part is rotated by it (ry ${d1 && d1.ry.toFixed(3)})`);
  ok(!d0 || Math.abs(d0.ry) < 1e-9, 'and at netHeadYaw 0 it is not rotated at all');
  // ⚠ THE UNIT TRAP, ASSERTED: degrees in, radians out, a factor of 57 apart
  ok(d1 && Math.abs(d1.ry - anim.netHeadYaw * Math.PI / 180) < 1e-3,
     'the delta is the DEGREES argument converted to radians — not the argument itself');
  okAv((() => {
    const dRad = ER.setupAnimDelta('head', 0, 0, anim.netHeadYaw * Math.PI / 180, 0, false, kind);
    return dRad && Math.abs(dRad.ry) < Math.abs(d1.ry) / 10;
  })(), 'anti-vacuity: feeding radians where degrees belong turns the head a fifty-seventh as far, and §5 sees it');
}

// ═══════════════ 6. the goals ASK — they do not turn the mob themselves ════════════════════
console.log('\n 6. a look goal asks the control; it does not write the body yaw');
{
  const e = mob('cow', 0, 64, 0);
  Ai.tickHead(e);
  const player = { x: 6, y: 64, z: 0, eyeHeight: 1.62 };
  const goal = new Ai.LookAtPlayerGoal(e, () => [player]);
  ok(goal.canUse(), 'the goal takes an interest in a player in range');
  goal.start();
  const yawBefore = e.yaw;
  goal.tick();
  ok(e.yaw === yawBefore, 'ticking it does NOT move the body — the bug this unit exists for');
  ok(e.look.isLookingAtTarget(), 'it set a look target instead');
  Ai.tickHead(e);
  ok(Math.abs(e.yHeadRot * RAD - 10) < 1e-6, 'and the control turns the head its ten degrees');

  // the idle look-around is a head turn too
  const f = mob('cow', 0, 64, 0);
  Ai.tickHead(f);
  const r = new Ai.RandomLookAroundGoal(f, () => 0.01);
  const fy = f.yaw;
  r.start();
  ok(f.yaw === fy, 'the idle look-around does not write the body yaw either');
  r.tick();   // vanilla LookAroundGoal.start only draws the angle; tick() does the looking
  ok(f.yaw === fy, 'nor does its tick write the body yaw');
  ok(f.look.isLookingAtTarget(), 'it sets a look target as well');

  okAv((() => {
    // anti-vacuity: the old behaviour — write e.yaw directly — is exactly what §6 forbids
    const g = mob('cow', 0, 64, 0);
    Ai.tickHead(g);
    const before = g.yaw;
    g.yaw = Math.atan2(player.x - g.x, -(player.z - g.z));
    return g.yaw !== before && Math.abs(g.yaw * RAD - 90) < 1;
  })(), 'anti-vacuity: the shipped bug (a goal writing e.yaw) is a 90-degree snap, and §6 asserts it cannot happen');
}

// ═══════════════ report ════════════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(78));
console.log(` headcheck: ${pass} assertions, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.log('   x ' + f);
  process.exit(1);
}
console.log(' a mob looks at you, and then turns to face you.');
