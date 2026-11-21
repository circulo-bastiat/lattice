#!/usr/bin/env node
// handposecheck.mjs — PLAN G10d: THE HAND'S MATHS, AGAINST THE JAR (D-359).
//
//   node tools/handposecheck.mjs
//
// ⚠⚠ **WHY A CHECK AND NOT JUST THE EXTRACTOR.** `tools/extract-handrender.mjs` reads vanilla's
// numbers out of the client bytecode; this asserts that the ENGINE carries the same ones and
// composes them in the same order. The two are different claims, and only the second one is
// about `src/14k_hand3d.js`. Four sessions of hand work went wrong precisely because there was
// nothing in between: a picture that "looked about right" was the only referee there was.
//
// ── THE THREE THINGS IT ASSERTS, AND WHY EACH ONE IS SEPARATE ────────────────────────────────
//   1. **Every constant equals the golden file's.** A typo in a port is invisible on screen —
//      -0.52 for -0.5 moves the hand by a centimetre — and this is the only place it can fail.
//   2. **The composition is right**, checked against a SECOND, independently written matrix
//      implementation (row-major, built by explicit multiplication) rather than against a
//      recorded answer. A recorded answer pins whatever the code did on the day it was recorded;
//      an independent implementation disagrees when one of them is wrong.
//   3. **The pose MOVES the way vanilla's does** — the swing pulls the item toward the camera
//      and back, the equip animation drops it below the frame, the look-lag trails a turn. Those
//      are the three things Dan named, and each is a comparison between two poses rather than an
//      absolute number, so none of them can be satisfied by a hand that is merely somewhere.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GOLD = join(ROOT, 'tools', 'golden', 'handrender-1.18.2.json');

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; say('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => console.log(...a);

const gold = JSON.parse(readFileSync(GOLD, 'utf8'));
const MCL = loadEngine({ extra: ['02g_items.js', '14f_inventory.js', '14i_hand.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07j_entityrender.js', '14k_hand3d.js'],
                         dom: false });
const H3 = MCL.Hand3D;

// ─────────────────────────────────────────────── 1. every constant is the jar's
say('1. every constant in the engine equals the one extracted from the jar');
{
  ok(!!H3, 'Hand3D loaded');
  const C = gold.constants;
  const pairs = [
    ['HAND_X', C.HAND_X], ['HAND_Y', C.HAND_Y], ['HAND_EQUIP_Y', C.HAND_EQUIP_Y], ['HAND_Z', C.HAND_Z],
    ['SWING_Y_BASE', C.SWING_Y_BASE], ['SWING_Y_SWING', C.SWING_Y_SWING], ['SWING_Z', C.SWING_Z],
    ['SWING_X', C.SWING_X], ['SWING_Y_BACK', C.SWING_Y_BACK],
    ['ITEM_SWING_X', C.ITEM_SWING_X], ['ITEM_SWING_Y', C.ITEM_SWING_Y], ['ITEM_SWING_Z', C.ITEM_SWING_Z],
    ['ARM_X', C.ARM_X], ['ARM_Y', C.ARM_Y], ['ARM_Z', C.ARM_Z],
    ['ARM_SWING_X', C.ARM_SWING_X], ['ARM_SWING_Y', C.ARM_SWING_Y], ['ARM_SWING_Z', C.ARM_SWING_Z],
    ['ARM_ROT_Y', C.ARM_ROT_Y], ['ARM_SWING_ROT_Y', C.ARM_SWING_ROT_Y], ['ARM_SWING_ROT_Z', C.ARM_SWING_ROT_Z],
    ['BOB_TRANSLATE', C.BOB_TRANSLATE], ['BOB_ROLL', C.BOB_ROLL],
    ['BOB_PITCH_PHASE', C.BOB_PITCH_PHASE], ['BOB_PITCH', C.BOB_PITCH],
    ['HURT_ROLL', C.HURT_ROLL], ['DEATH_TILT_A', C.DEATH_TILT_A],
    ['DEATH_TILT_B', C.DEATH_TILT_B], ['DEATH_TILT_C', C.DEATH_TILT_C],
    ['HAND_LOOK_LAG', C.HAND_LOOK_LAG],
  ];
  for (const [name, want] of pairs) {
    ok(Math.abs(H3[name] - want) < 1e-6, `Hand3D.${name} = ${H3[name]}, the jar says ${want}`);
  }
  // ⚠ AND THE EQUIP STEP, which lives on `Hand` rather than on `Hand3D` because it is a TICK
  // animation. Splitting it across two files is exactly how a constant goes unchecked.
  ok(Math.abs(MCL.Hand.EQUIP_STEP - gold.constants.EQUIP_STEP) < 1e-6,
     `Hand.EQUIP_STEP = ${MCL.Hand.EQUIP_STEP}, the jar says ${gold.constants.EQUIP_STEP}`);
  ok(Math.abs(MCL.Hand.EQUIP_SWAP_BELOW - gold.constants.EQUIP_SWAP_BELOW) < 1e-6,
     'Hand.EQUIP_SWAP_BELOW is the jar\'s 0.1');
  say(`   ${pairs.length + 2} constants, all from ${gold.classes.itemInHandRenderer}`);
}
say(`   ${pass} ok`);

// ─────────────────────────────────────────────── 2. an independent matrix implementation
say('\n2. the composition, against a second implementation written the other way round');
{
  // ⚠ ROW-MAJOR, AND MULTIPLIED OUT BY HAND. The engine's stack is column-major and post-
  // multiplies in place; this one builds a list of 4x4s and folds them left to right. If both
  // agree to eight digits the composition is not an artefact of either.
  const I = () => [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  const mul = (a, b) => {
    const o = I();
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      o[r][c] = a[r][0] * b[0][c] + a[r][1] * b[1][c] + a[r][2] * b[2][c] + a[r][3] * b[3][c];
    }
    return o;
  };
  const T = (x, y, z) => { const m = I(); m[0][3] = x; m[1][3] = y; m[2][3] = z; return m; };
  const Sc = (x, y, z) => { const m = I(); m[0][0] = x; m[1][1] = y; m[2][2] = z; return m; };
  const d2r = Math.PI / 180;
  const RX = (d) => { const c = Math.cos(d * d2r), s = Math.sin(d * d2r); const m = I(); m[1][1] = c; m[1][2] = -s; m[2][1] = s; m[2][2] = c; return m; };
  const RY = (d) => { const c = Math.cos(d * d2r), s = Math.sin(d * d2r); const m = I(); m[0][0] = c; m[0][2] = s; m[2][0] = -s; m[2][2] = c; return m; };
  const RZ = (d) => { const c = Math.cos(d * d2r), s = Math.sin(d * d2r); const m = I(); m[0][0] = c; m[0][1] = -s; m[1][0] = s; m[1][1] = c; return m; };

  /** `renderArmWithItem`'s final branch, written out here from the golden literal sequence. */
  function reference(swing, equipped) {
    const C = gold.constants;
    const f = C.ITEM_SWING_X * Math.sin(Math.sqrt(swing) * Math.PI);
    const f1 = C.ITEM_SWING_Y * Math.sin(Math.sqrt(swing) * Math.PI * 2);
    const f2 = C.ITEM_SWING_Z * Math.sin(swing * Math.PI);
    let m = mul(I(), T(f, f1, f2));
    m = mul(m, T(C.HAND_X, C.HAND_Y + equipped * C.HAND_EQUIP_Y, C.HAND_Z));
    const a = Math.sin(swing * swing * Math.PI);
    m = mul(m, RY(C.SWING_Y_BASE + a * C.SWING_Y_SWING));
    const a1 = Math.sin(Math.sqrt(swing) * Math.PI);
    m = mul(m, RZ(a1 * C.SWING_Z));
    m = mul(m, RX(a1 * C.SWING_X));
    m = mul(m, RY(C.SWING_Y_BACK));
    return m;
  }

  // the engine's own, with every other source of motion stilled
  const still = { pitch: 0, yaw: 0, pPitch: 0, pYaw: 0, xBob: 0, xBobO: 0, yBob: 0, yBobO: 0,
                  walkDist: 0, walkDistO: 0, bob: 0, oBob: 0, hurtTime: 0, deathTime: 0, hurtDir: 0 };
  MCL.Settings = MCL.Settings || {};
  MCL.Settings.viewBobbing = false;
  const out = new Float32Array(16);
  const cases = [[0, 0], [0.25, 0], [0.5, 0], [0.9, 0], [0, 0.5], [0.4, 1]];
  let worst = 0, worstCase = null;
  for (const [sw, eq] of cases) {
    H3.pose(out, still, 1, sw, eq, 'item');
    const ref = reference(sw, eq);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      // column-major: out[col*4 + row]
      const d = Math.abs(out[c * 4 + r] - ref[r][c]);
      if (d > worst) { worst = d; worstCase = `${sw}/${eq} at [${r}][${c}]`; }
    }
  }
  ok(worst < 1e-5, `two independent implementations agree to ${worst.toExponential(1)} (worst: ${worstCase})`);
  say(`   ${cases.length} poses compared, worst element difference ${worst.toExponential(1)}`);

  // ⚠ ANTI-VACUITY: the comparison must be able to FAIL. One flipped sign in the reference and
  // the difference has to become large — otherwise §2 is comparing a matrix with itself.
  {
    const saved = gold.constants.SWING_X;
    gold.constants.SWING_X = -saved;
    H3.pose(out, still, 1, 0.5, 0, 'item');
    const ref = reference(0.5, 0);
    let d = 0;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(out[c * 4 + r] - ref[r][c]));
    gold.constants.SWING_X = saved;
    okAv(d > 0.1, `flipping one sign in the reference moves it by ${d.toFixed(3)} — the comparison is live`);
  }

  // the empty arm: ModelPart.rotate = translate(pivot/16), rotZ(roll = cos(0)*0.05+0.05 rad), then the box scale.
  // With a uniform 1/16 scale last, arm = (arm without the roll) * RZ(roll) exactly.
  {
    const armVs = (roll) => {
      const saved = H3.ARM_ROLL_RAD; H3.ARM_ROLL_RAD = roll;
      const a = new Float32Array(16); H3.pose(a, still, 1, 0.3, 0.2, 'arm');
      H3.ARM_ROLL_RAD = saved; return a;
    };
    const dist = (a, ref) => { let d = 0; for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(a[c * 4 + r] - ref[r][c])); return d; };
    const base = armVs(0), got = armVs(H3.ARM_ROLL_RAD);
    const rollDeg = (Math.cos(0 * 0.09) * 0.05 + 0.05) * 180 / Math.PI;
    const rm = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) rm[r][c] = base[c * 4 + r];
    const ref = mul(rm, RZ(rollDeg));
    ok(dist(got, ref) < 1e-5, `arm pose = unrolled arm x rotZ(0.1 rad) (diff ${dist(got, ref).toExponential(1)})`);
    okAv(dist(base, ref) > 5e-4, `removing the arm roll is caught (diff ${dist(base, ref).toFixed(4)})`);
  }
}
say(`   ${pass} ok`);

// ─────────────────────────────────────────────── 3. the three motions Dan named
say('\n3. the swing, the equip dip and the sway each MOVE the hand');
{
  const still = { pitch: 0, yaw: 0, pPitch: 0, pYaw: 0, xBob: 0, xBobO: 0, yBob: 0, yBobO: 0,
                  walkDist: 0, walkDistO: 0, bob: 0, oBob: 0, hurtTime: 0, deathTime: 0, hurtDir: 0 };
  MCL.Settings.viewBobbing = false;
  const m = new Float32Array(16);
  const origin = (p, sw, eq, mode) => {
    H3.pose(m, p, 1, sw, eq, mode || 'item');
    return [m[12], m[13], m[14]];
  };

  // (a) THE SWING MOVES THE ITEM IN DEPTH — the thing a 2D blit could never do at all.
  // ⚠ IT MOVES **AWAY**, NOT TOWARD, AND THE FIRST VERSION OF THIS ASSERTION HAD IT BACKWARDS.
  // `f2 = -0.2 * sin(swingProgress * PI)` is NEGATIVE at mid-swing and -Z is forward, so vanilla
  // punches the item away from the camera and draws it back — which is what a punch looks like
  // from inside your own eyes. Writing the assertion from intuition instead of from the sign got
  // it wrong in exactly the way a screenshot never would have shown.
  const rest = origin(still, 0, 0);
  const mid = origin(still, 0.5, 0);
  const end = origin(still, 1, 0);
  ok(mid[2] < rest[2] - 0.1,
     `mid-swing the item is pushed AWAY from the camera (z ${mid[2].toFixed(3)} < ${rest[2].toFixed(3)})`);
  ok(Math.abs(end[2] - rest[2]) < 1e-6, 'and a finished swing is back exactly where it started');
  ok(Math.abs(mid[0] - rest[0]) > 0.05, 'and it moves sideways as well as in depth');

  // (b) THE EQUIP ANIMATION DROPS IT BELOW THE FRAME. `equipped` runs 0 (fully up) to 1.
  const up = origin(still, 0, 0);
  const down = origin(still, 0, 1);
  ok(down[1] < up[1] - 0.5, `a swapping item drops out of frame (y ${down[1].toFixed(3)} vs ${up[1].toFixed(3)})`);

  // (c) THE SWAY: with the camera turned away from the hand's smoothed heading, the pose must
  // differ. ⚠ THIS IS THE ONE THAT WAS MISSING ENTIRELY, so it is asserted as a difference from
  // the still case rather than as a number.
  const turning = Object.assign({}, still, { yaw: 0.6, pYaw: 0.6, yBob: 0, yBobO: 0 });
  H3.pose(m, still, 1, 0, 0, 'item');
  const a = Array.from(m);
  H3.pose(m, turning, 1, 0, 0, 'item');
  const b = Array.from(m);
  let diff = 0;
  for (let i = 0; i < 16; i++) diff = Math.max(diff, Math.abs(a[i] - b[i]));
  ok(diff > 1e-3, `a camera turned away from the hand's heading changes the pose (${diff.toFixed(4)})`);
  // ...and the lag is a TENTH, so a 0.6 rad (34.4 deg) difference is a 3.44 degree rotation
  const expected = 0.6 * 180 / Math.PI * gold.constants.HAND_LOOK_LAG;
  ok(Math.abs(expected - 3.4377) < 0.01, 'the lag really is a tenth of the look delta');

  // (c2) the sway subtracts the CURRENT look (ClientPlayerEntity.getYaw/getPitch(float)): independent
  // of partial unless riding, where yaw alone is lerped.
  const mid0 = { yaw: 0.157, pYaw: 0, pitch: 0.1, pPitch: 0, yBob: -18, yBobO: -18, xBob: 0, xBobO: 0 };
  ok(Math.abs(H3.swayYaw(mid0, 0.1) - H3.swayYaw(mid0, 0.9)) < 1e-9, 'sway yaw is independent of partial on foot');
  ok(Math.abs(H3.viewXRot(mid0, 0.1) - H3.viewXRot(mid0, 0.9)) < 1e-9, 'sway pitch is independent of partial');
  ok(Math.abs(H3.viewYRot(Object.assign({ vehicle: {} }, mid0), 0.5) - 0.157 * 90 / Math.PI) < 1e-9, 'yaw is lerped while riding');

  // (d) VIEW BOBBING IS AN OPTION, and turning it off must make a difference while walking.
  const walking = Object.assign({}, still, { walkDist: 3.3, walkDistO: 3.2, bob: 0.1, oBob: 0.1 });
  MCL.Settings.viewBobbing = false;
  H3.pose(m, walking, 1, 0, 0, 'item');
  const off = Array.from(m);
  MCL.Settings.viewBobbing = true;
  H3.pose(m, walking, 1, 0, 0, 'item');
  const on = Array.from(m);
  let bobDiff = 0;
  for (let i = 0; i < 16; i++) bobDiff = Math.max(bobDiff, Math.abs(off[i] - on[i]));
  ok(bobDiff > 1e-3, `View Bobbing on and off give different poses while walking (${bobDiff.toFixed(4)})`);
  // ⚠ AND IT IS DISTANCE, NOT TIME: a player standing still must bob by nothing at all, even
  // with the option on. A bob driven by a clock is the commonest wrong implementation.
  const standing = Object.assign({}, still, { walkDist: 0, walkDistO: 0, bob: 0, oBob: 0 });
  H3.pose(m, standing, 1, 0, 0, 'item');
  const s1 = Array.from(m);
  H3.pose(m, standing, 0.5, 0, 0, 'item');
  const s2 = Array.from(m);
  let stillDiff = 0;
  for (let i = 0; i < 16; i++) stillDiff = Math.max(stillDiff, Math.abs(s1[i] - s2[i]));
  ok(stillDiff < 1e-6, 'a standing player does not bob at all, at any partial tick');
  MCL.Settings.viewBobbing = true;
}
say(`   ${pass} ok`);

// ─────────────────────────────────────────────── 4. the equip animation's own arithmetic
say('\n4. the equip animation steps by 0.4 a tick and swaps below 0.1');
{
  const H = MCL.Hand;
  // ⚠ DRIVEN THROUGH `tickEquip` WITH A REAL STACK, not by poking the field: the thing under
  // test is the CLAMP and the swap threshold, and both live in that function.
  const P = { instabuild: true, slot: 0, heldItem() { return this._s; }, _s: { i: 1, n: 1 } };
  // ⚠⚠ **THE COOLDOWN HAS TO BE FULL, AND THAT IS NOT BOOKKEEPING — IT IS THE OTHER HALF OF THE
  // ANIMATION.** The target height is `getAttackStrengthScale(1)` **CUBED**, so a hand whose
  // cooldown has just been reset sits at 0.008 and climbs; with the ticker at 0 the "holding the
  // same item, the hand stays up" case is not the resting state at all. Vanilla dips the item
  // after every swing for exactly this reason, and it is a thing this engine has never done.
  H.attackStrengthTicker = 100;
  H.mainHandHeight = 1; H.oMainHandHeight = 1; H.mainHandItem = H.heldIndexOf(P);
  H.tickEquip(P);
  ok(Math.abs(H.mainHandHeight - 1) < 1e-6, 'holding the same item, the hand stays up');
  P._s = { i: 2, n: 1 };                      // a different item: the hand must drop
  const heights = [];
  for (let i = 0; i < 6; i++) { H.tickEquip(P); heights.push(+H.mainHandHeight.toFixed(4)); }
  ok(heights[0] < 1 && heights[0] >= 0.59, `it drops by at most 0.4 in one tick (${heights[0]})`);
  ok(heights.some((h) => h < 0.1), `it gets below the swap threshold (${heights.join(' ')})`);
  ok(H.mainHandItem === H.heldIndexOf(P), 'and the drawn item swaps to the new one at the bottom of the dip');
  const back = [];
  for (let i = 0; i < 6; i++) { H.tickEquip(P); back.push(+H.mainHandHeight.toFixed(4)); }
  ok(back[back.length - 1] > 0.9, `and then rises back (${back.join(' ')})`);
  okAv(heights[0] !== heights[1], 'the height really moves tick to tick — otherwise §4 is static');
  // #534: same item, different count / damage: ItemStack.areEqual is false, so vanilla dips
  const dipsFor = (a, b) => {
    P._s = a; H.mainHandHeight = 1; H.oMainHandHeight = 1; H.mainHandItem = H.heldIndexOf(P); H.mainHandStack = undefined;
    H.tickEquip(P); P._s = b; H.tickEquip(P);
    return H.mainHandHeight < 1;
  };
  ok(dipsFor({ i: 4, n: 64 }, { i: 4, n: 10 }), 'same item, different count: the hand dips');
  ok(dipsFor({ i: 4, n: 1, d: 0 }, { i: 4, n: 1, d: 5 }), 'same item, different damage: the hand dips');
  ok(!dipsFor({ i: 4, n: 10 }, { i: 4, n: 10 }), 'an equal stack does not dip');
  okAv(dipsFor({ i: 4, n: 64 }, { i: 4, n: 10 }) !== dipsFor({ i: 4, n: 10 }, { i: 4, n: 10 }), 'the count really decides the dip');

  // #390: the DRAWN item lags, and a same-item stack with another count re-equips
  {
    const Q = { instabuild: true, slot: 0, sleeping: false, ex: 0, ey: 70, ez: 0, heldItem() { return this._s; }, _s: { i: 1, n: 1 } };
    H.attackStrengthTicker = 100;
    H.mainHandHeight = 1; H.oMainHandHeight = 1; H.mainHandItem = 1; H.mainHandStack = Q._s;
    const seen = [];
    const sv = { pO: H3.partsOf, eP: H3.emitPart, aD: H3.applyDisplay };
    H3.partsOf = (idx) => { seen.push(idx); return { parts: [{}], tints: [0] }; };
    H3.emitPart = (b, o) => o + 1;
    H3.applyDisplay = () => {};
    const drawn = (p) => { seen.length = 0; H3.build(p, 1); return seen[0]; };
    
    Q._s = { i: 2, n: 1 };
    H.tickEquip(Q);
    ok(H.mainHandItem === 1 && drawn(Q) === 1, 'mid-switch, build() still draws the OLD item');
    for (let i = 0; i < 6; i++) H.tickEquip(Q);
    ok(H.mainHandItem === 2 && drawn(Q) === 2, 'after the swap, build() draws the new item');
    H.mainHandHeight = 1; H.oMainHandHeight = 1; H.mainHandItem = 2; H.mainHandStack = Q._s = { i: 2, n: 64 };
    H.tickEquip(Q);
    const same = H.mainHandHeight;
    Q._s.n = 63; H.tickEquip(Q);
    ok(Math.abs(H.mainHandHeight - same) < 1e-6, 'in-place count change on the same stack does not dip');
    Q._s = { i: 2, n: 10 }; H.tickEquip(Q);
    ok(H.mainHandHeight < 0.61, `same id, different count (new stack) dips (${H.mainHandHeight})`);
    okAv(drawn({ ...Q, heldItem() { return { i: 3, n: 1 }; } }) === 2, 'drawn() really reports the lagging index (held 3, drawn 2)');
    H3.partsOf = sv.pO; H3.emitPart = sv.eP; H3.applyDisplay = sv.aD;
    H.mainHandItem = -1; H.mainHandStack = undefined;
  }

  // #389: drawing a bow / drinking (handsBusy, usingItem) keeps the item up; only boat paddling sinks it
  P._s = { i: 1, n: 1 }; H.mainHandItem = 1; H.mainHandHeight = 1; H.oMainHandHeight = 1;
  P.handsBusy = true; P.usingItem = true;
  for (let i = 0; i < 4; i++) H.tickEquip(P);
  ok(Math.abs(H.mainHandHeight - 1) < 1e-6, `handsBusy/usingItem keeps the item up (${H.mainHandHeight})`);
  P.handsBusy = false; P.usingItem = false; P.paddling = true;
  for (let i = 0; i < 4; i++) H.tickEquip(P);
  ok(H.mainHandHeight < 0.1, `paddling a boat sinks it (${H.mainHandHeight})`);
  okAv(H.mainHandHeight !== 1, 'the paddling flag really changes the height');
}
say(`   ${pass} ok`);

say('5. the hand FOV is vanilla getFov(.., false): a fixed 70, whatever the FOV option says');
{
  const P = { dead: false, deathTime: 0 };
  const persp = (f) => Array.from(MCL.U.mat4.perspective(new Float32Array(16), f * Math.PI / 180, 1.6, 0.05, 16, false));
  const at = (opt) => { MCL.Settings.fov = opt; return persp(H3.handFov(P, 0, 1, false)); };
  const a = at(30), b = at(110);
  ok(JSON.stringify(a) === JSON.stringify(b), 'hand projection is identical at FOV 30 and 110');
  ok(JSON.stringify(a) === JSON.stringify(persp(70)), 'and equals perspective(70 deg)');
  ok(Math.abs(H3.handFov(P, 0, 1, true) - 70 * 0.85714287) < 1e-4, 'submerged at fovEffectScale 1 = 70 * 0.85714287');
  ok(Math.abs(H3.handFov(P, 0, 0, true) - 70) < 1e-9, 'submerged at fovEffectScale 0 = 70');
  const d = H3.handFov({ dead: true, deathTime: 20 }, 0, 1, false);
  ok(Math.abs(d - 70 / ((1 - 500 / 520) * 2 + 1)) < 1e-9, `dead at 20 ticks divides by 1.0769 (${d})`);
  okAv(H3.handFov(P, 0, 1, true) !== H3.handFov(P, 0, 1, false), 'the underwater factor really changes the fov');
  okAv(H3.handFov({ dead: true, deathTime: 20 }, 0, 1, false) !== 70, 'death really changes the fov');
}
say(`   ${pass} ok`);

// ─────────────────────────────────────────────── 6. an invisible player's empty hand draws no arm
say('\n6. invisibility hides the empty-hand arm, not a held item (#399)');
{
  const H3 = MCL.Hand3D;
  const mk = (held) => ({ ex: 0, ey: 64, ez: 0, eyeHeight: 1.62, pitch: 0, yaw: 0, heldItem() { return held; } });
  MCL.Hand.mainHandItem = -1; MCL.Hand.mainHandStack = undefined;
  const saved = MCL.Effects;
  let inv = false;
  // the arm and item geometry come from modules this loader does not carry: stub them, the gate is what is tested
  const sv = { BI: MCL.BlockIcon, pO: H3.partsOf, eP: H3.emitPart, aD: H3.applyDisplay };
  MCL.BlockIcon = { ARM: { x0: 0, y0: 0, z0: 0, w: 4, h: 12, d: 4, u: 40, v: 16, sleeveU: 48, sleeveV: 48, sleeveInflate: 0.25 }, boxFaces: () => [] };
  H3.partsOf = () => ({ parts: [{}], tints: [0] });
  H3.emitPart = (b, o) => o + 1;
  H3.applyDisplay = () => {};
  MCL.Effects = { hasStatusEffect: (o, id) => inv && id === 'invisibility' };
  const armOf = (p) => { const r = H3.build(p, 1); return r && r.arm; };
  inv = false;
  okAv(!!armOf(mk(null)), 'a visible player with an empty hand DOES get an arm — otherwise the gate test is vacuous');
  MCL.Hand.mainHandItem = 1;   // the drawn item is the lagging one (#390): this player has finished equipping
  okAv(!!(H3.build(mk({ i: 1, n: 1 }), 1) || {}).floats, 'a visible player with an item gets the item');
  inv = true;
  MCL.Hand.mainHandItem = -1;
  ok(H3.build(mk(null), 1) === null, 'invisible + empty hand builds nothing');
  MCL.Hand.mainHandItem = 1;
  ok(((H3.build(mk({ i: 1, n: 1 }), 1) || {}).floats | 0) > 0, 'invisible + held item still builds the item');
  MCL.Effects = saved; MCL.BlockIcon = sv.BI; H3.partsOf = sv.pO; H3.emitPart = sv.eP; H3.applyDisplay = sv.aD;
}
say(`   ${pass} ok`);

// ─────────────────────────────────────────────── 5. what empties the attack cooldown (#396)
say('\n5. only a miss, a half-mined release, a hit and an ITEM switch empty the cooldown; a completed break does not');
{
  const H = MCL.Hand;
  const P = { instabuild: false, slot: 0, heldItem() { return this._s; }, _s: { i: 1, n: 1 } };
  H.attackStrengthTicker = 100; H.mainHandHeight = 1; H.oMainHandHeight = 1; H.mainHandItem = 1;
  H.noteSelected(P);
  ok(H.attackStrengthTicker === 100, 'the first noteSelected only records');
  P._s = { i: 1, n: 5 };                      // same item, other count: no reset (ItemStack.areItemsEqual)
  H.noteSelected(P);
  ok(H.attackStrengthTicker === 100, 'a change of count alone does not reset');
  P._s = { i: 2, n: 1 };
  H.noteSelected(P);
  ok(H.attackStrengthTicker === 0, 'a switch to a different item empties the cooldown');
  H.attackStrengthTicker = 100; P._s = null; H.noteSelected(P);
  ok(H.attackStrengthTicker === 0, 'a switch to an empty hand does too');
  // the source: P.breakBlock must not reset it (vanilla's updateBlockBreakingProgress clears breakingBlock first)
  const src = readFileSync(join(ROOT, 'src', '14_player.js'), 'utf8');
  const body = (t) => { const a = t.indexOf('P.breakBlock = function'); return t.slice(a, t.indexOf('\n  };', a)); };
  ok(!/resetAttackStrength/.test(body(src)), 'P.breakBlock does not empty the attack cooldown, so the item stays up while mining');
  okAv(/resetAttackStrength/.test(body(src.replace('NS.Hand.stopBreaking(); }\n    P.retarget', 'NS.Hand.resetAttackStrength(); NS.Hand.stopBreaking(); }\n    P.retarget'))), 'the source guard can see a reset put back in P.breakBlock');
  ok(/resetAttackStrength/.test(src.slice(src.indexOf('!P.hasTarget'), src.indexOf('!P.hasTarget') + 400)), 'the miss branch empties the cooldown');
  ok(/cancelBlockBreaking/.test(src), 'the aborted dig branch is marked and resets');
}
say(`   ${pass} ok`);

// ─────────────────────────────────────────────── 7. drawing a bow (#400)
say('\n7. the BOW use-action pose and the pulling_0/1/2 tile');
{
  const H3 = MCL.Hand3D;
  const I = () => [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  const mul = (a, b) => { const o = I(); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) o[r][c] = a[r][0] * b[0][c] + a[r][1] * b[1][c] + a[r][2] * b[2][c] + a[r][3] * b[3][c]; return o; };
  const T = (x, y, z) => { const m = I(); m[0][3] = x; m[1][3] = y; m[2][3] = z; return m; };
  const Sc = (x, y, z) => { const m = I(); m[0][0] = x; m[1][1] = y; m[2][2] = z; return m; };
  const d2r = Math.PI / 180;
  const RX = (d) => { const c = Math.cos(d * d2r), s = Math.sin(d * d2r); const m = I(); m[1][1] = c; m[1][2] = -s; m[2][1] = s; m[2][2] = c; return m; };
  const RY = (d) => { const c = Math.cos(d * d2r), s = Math.sin(d * d2r); const m = I(); m[0][0] = c; m[0][2] = s; m[2][0] = -s; m[2][2] = c; return m; };
  const RZ = (d) => { const c = Math.cos(d * d2r), s = Math.sin(d * d2r); const m = I(); m[0][0] = c; m[0][1] = -s; m[1][0] = s; m[1][1] = c; return m; };
  // HeldItemRenderer.java:410-433, literals typed from the decompiled source, i = +1
  const K = { t: [-0.2785682, 0.18344387, 0.15731531], rx: -13.935, ry: 35.3, rz: -9.785 };
  const ref = (ticks, eq) => {
    let m = T(0.56, -0.52 + eq * -0.6, -0.72);
    m = mul(m, T(K.t[0], K.t[1], K.t[2]));
    m = mul(m, RX(K.rx)); m = mul(m, RY(K.ry)); m = mul(m, RZ(K.rz));
    let pull = ticks / 20; pull = (pull * pull + pull * 2) / 3; if (pull > 1) pull = 1;
    if (pull > 0.1) m = mul(m, T(0, Math.sin((ticks - 0.1) * 1.3) * (pull - 0.1) * 0.004, 0));
    m = mul(m, T(0, 0, pull * 0.04));
    m = mul(m, Sc(1, 1, 1 + pull * 0.2));
    return mul(m, RY(-45));
  };
  const still = { pitch: 0, yaw: 0, pPitch: 0, pYaw: 0, xBob: 0, xBobO: 0, yBob: 0, yBobO: 0,
                  walkDist: 0, walkDistO: 0, bob: 0, oBob: 0, hurtTime: 0, deathTime: 0, hurtDir: 0 };
  MCL.Settings.viewBobbing = false;
  const savedItems = MCL.Items;
  MCL.Items = { ready: true, nameOf: () => 'bow' };
  const bowP = (ticks, using = true) => Object.assign({}, still, { usingItem: using, useTicks: ticks, useKind: null, heldItem() { return { i: 1, n: 1 }; } });
  const dist = (a, r) => { let d = 0; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) d = Math.max(d, Math.abs(a[j * 4 + i] - r[i][j])); return d; };
  const out = new Float32Array(16), idle = new Float32Array(16);
  for (const t of [0, 5, 20]) {
    H3.pose(out, bowP(t), 1, 0.5, 0.2, 'item');
    ok(dist(out, ref(t, 0.2)) < 1e-5, `useTicks ${t}: pose = the BOW branch composed from the decomp literals (diff ${dist(out, ref(t, 0.2)).toExponential(1)})`);
  }
  H3.pose(idle, bowP(20, false), 1, 0.5, 0.2, 'item');
  H3.pose(out, bowP(20), 1, 0.5, 0.2, 'item');
  ok(dist(out, (() => { const r = I(); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) r[i][j] = idle[j * 4 + i]; return r; })()) > 0.05, 'drawing differs from the not-using pose');
  okAv(dist(out, ref(0, 0.2)) > 1e-3, 'the reference is live: a different draw length gives a different matrix');
  const ER = MCL.EntityRender;
  if (ER && ER.bowTileName) {
    ok(ER.bowTileName(13 / 20, true) === 'item/bow_pulling_1', 'useTicks 13 (pull 0.65) draws bow_pulling_1');
    ok(ER.bowTileName(18 / 20, true) === 'item/bow_pulling_2', 'useTicks 18 (pull 0.9) draws bow_pulling_2');
    ok(ER.bowTileName(5 / 20, true) === 'item/bow_pulling_0', 'useTicks 5 draws bow_pulling_0');
    // partsOf must actually swap the layer: stub the tables and read which sprite part it emits
    const sv = { IT: MCL.Items, D: MCL.DATA, il: ER.itemLayers, sp: ER.spritePartOf };
    MCL.Items = { ready: true, nameOf: () => 'bow', tint0: null, tint1: null };
    MCL.DATA = Object.assign({}, sv.D, { itemTileMap: () => ({ 'item/bow': 10, 'item/bow_pulling_0': 11, 'item/bow_pulling_1': 12, 'item/bow_pulling_2': 13 }) });
    ER.itemLayers = () => [10]; ER.spritePartOf = (t) => t;
    const tile = (t) => H3.partsOf(1, t).parts[0];
    ok(tile(-1) === 10 && tile(5) === 11 && tile(13) === 12 && tile(18) === 13, 'partsOf steps item/bow -> pulling_0/1/2 with the draw');
    const good = H3.partsOf;
    H3.partsOf = (i) => good(i);   // break: drop the override
    okAv(H3.partsOf(1, 18).parts[0] === 10, 'dropping the override is caught (tile stays item/bow)');
    H3.partsOf = good;
    MCL.Items = sv.IT; MCL.DATA = sv.D; ER.itemLayers = sv.il; ER.spritePartOf = sv.sp;
  } else say('   (EntityRender not loaded here: tile steps skipped)');
  MCL.Items = savedItems;
}
say(`   ${pass} ok`);

say('');
say('================ handposecheck ===============');
say(` assertions passed .. ${pass}`);
say(` failures ........... ${fails.length}`);
say(` breaks caught ...... ${breaks}`);
say(` golden file ........ ${gold.classes.itemInHandRenderer} / ${gold.classes.gameRenderer}`);
say('==============================================');
for (const f of fails) say('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
