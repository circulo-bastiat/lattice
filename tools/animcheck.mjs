#!/usr/bin/env node
// animcheck.mjs — PASS 16, JOB 4.4. `ER.setupAnimDelta`/the `anim` param on
// `ER.emitMobLayer`/`ER.buildMobLayer`: the two base-class (QuadrupedModel/HumanoidModel)
// angle-delta formulas, bytecode-verified in `tools/golden/setupanim-1.18.2.json` (D-263),
// wired as an OPTIONAL final argument so JOB 4.3's own static REST pose is unchanged when
// `anim` is omitted (`mobboxcheck.mjs` already proves that path byte-for-byte; this file
// proves the NEW path: which named parts move, which stay at rest, and that the two base
// classes' own symmetry — left/right legs and arms a half-cycle apart, quadruped diagonal
// gait, a riding branch that SETS rather than oscillates — all come out of the wiring the
// way `git 2a8efe1:docs/passes/PASS-15-HISTORY.md`'s design says they should.
//
//   node tools/animcheck.mjs [--verbose]
//
// ⚠ WHAT THIS DOES NOT PROVE. No browser stage, no pixel, no entity type wired into
// `EntityList`/`ER.build`'s live loop, no texture. This is Node-level proof that the FORMULA
// wiring moves the right named parts the right way — the bar `git 2a8efe1:docs/passes/PASS-15-HISTORY.md`'s own
// "before this is trusted" section asks for, ahead of the browser stage JOB 4's acceptance
// bar actually needs (still owed).

import { readFileSync } from 'node:fs';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

const VERBOSE = process.argv.includes('--verbose');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { ok(c, m); if (c) console.log('   ✓ ' + m.replace(/^anti-vacuity: /, '')); };
const say = (s) => { if (VERBOSE) console.log('   ' + s); };

console.log('animcheck — PASS 16 JOB 4.4, setupAnim wiring in ER.emitMobLayer (D-263)');

const M = loadEngine({
  extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
          '07j_entityrender.js', '10_gfx.js', '11_gfx_webgpu.js', '12_gfx_webgl2.js', '15h_bemodel.js'],
  dom: false
});
initRegistry(M);
{
  const mm = JSON.parse(readFileSync(MCLITE_ROOT + 'assets/models.meta.json', 'utf8'));
  M.BEModel.init({ models: readFileSync(MCLITE_ROOT + 'assets/models.bin').toString('base64'),
                    modelsBytes: mm.rawBytes });
}
// ⚠ D-429 — THE ENTITY TABLE, WHICH THIS FILE NEVER LOADED. `loadsrc.mjs` builds the
// registry and the models but not `DATA.entities`, so `M.Entities.init()` here has always
// returned not-ready and every assertion below ran without it. That was invisible while
// `setupAnim` needed nothing from it; the zombie-arm layer is IN that table, so a check that
// skipped it would have gone on asserting the pre-D-429 pose and passing.
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(MCLITE_ROOT + 'assets/entities.json', 'utf8'))
});
M.Entities.init();
M.EntityList.init();
M.EntityRender.init();
ok(M.Entities.ready, 'the entity table did not load — the zombie-arm section below would prove nothing');

const ER = M.EntityRender, BE = M.BEModel, CFG = M.CFG;
ok(ER.ready, 'the entity renderer is up');
ok(typeof ER.setupAnimDelta === 'function', 'ER.setupAnimDelta exists');
ok(typeof ER.emitMobLayer === 'function', 'ER.emitMobLayer exists');

/** Emit a layer at rest (yaw=0, no anim vs a given anim) and return, per PART INDEX, the
 *  centroid of that part's 24 emitted vertices — the same q -> Math.floor(q/6) part mapping
 *  `mobboxcheck.mjs` already relies on (fixed loop order, `MOB_FACE_CORNERS`). */
function centroids(layerName, anim) {
  const L = BE.layer(layerName);
  const n = ER.mobQuadCount(layerName);
  const out = new Uint32Array(n * 16);
  ER.emitMobLayer(out, 0, layerName, 0, 0, 0, 1, 0, 15, 0, 3, anim);
  const per = L.parts.map(() => ({ sx: 0, sy: 0, sz: 0, c: 0 }));
  for (let q = 0; q < n; q++) {
    const pi = Math.floor(q / 6);
    const o = q * 16;
    for (let c = 0; c < 4; c++) {
      const vt = M.Mesher.unpackModelVertex(out[o + c*4], out[o + c*4 + 1], out[o + c*4 + 2], out[o + c*4 + 3]);
      per[pi].sx += vt.px; per[pi].sy += vt.py; per[pi].sz += vt.pz; per[pi].c++;
    }
  }
  return per.map((a) => a.c ? [a.sx / a.c, a.sy / a.c, a.sz / a.c] : [0, 0, 0]);
}
function dist(a, b) { return Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]); }

// ═══════════════ 1. anim omitted/null is exactly the JOB-4.3 REST path, unchanged ══════════
console.log('\n 1. omitting `anim` (or passing null) leaves the JOB 4.3 static pose untouched');
{
  for (const name of ['zombie', 'cow']) {
    const n = ER.mobQuadCount(name);
    const outNoArg = new Uint32Array(n * 16), outNull = new Uint32Array(n * 16);
    ER.emitMobLayer(outNoArg, 0, name, 5, 5, 5, 0.8, 0.6, 15, 0, 3);
    ER.emitMobLayer(outNull, 0, name, 5, 5, 5, 0.8, 0.6, 15, 0, 3, null);
    let same = true;
    for (let i = 0; i < outNoArg.length; i++) if (outNoArg[i] !== outNull[i]) { same = false; break; }
    ok(same, `${name}: emitMobLayer(..., anim=omitted) === emitMobLayer(..., anim=null), word for word`);
  }
}

// ═══════════════ 2. the humanoid (zombie): which named parts move, which don't ════════════
console.log('\n 2. zombie (HumanoidModel): head/hat/arms/legs move, body stays at rest');
{
  const rest = centroids('zombie', null);
  const anim = { limbSwing: 1.0, limbSwingAmount: 1.0, netHeadYaw: 30, headPitch: 10, riding: false };
  const posed = centroids('zombie', anim);
  const L = BE.layer('zombie');
  const byName = {};
  L.parts.forEach((p, i) => { byName[p.n] = i; });
  for (const nm of ['body']) {
    ok(dist(rest[byName[nm]], posed[byName[nm]]) < 1e-6, `zombie.${nm} unchanged (not a setupAnim part; D-139)`);
  }
  // ⚠⚠ **THE HAT FOLLOWS THE HEAD, AND THAT IS `HumanoidModel.setupAnim`'S OWN LAST LINE**
  // (`this.hat.copyFrom(this.head)`), which is why `ER.setupAnimDelta` answers for `'head'` and
  // `'hat'` with the same rotation. This file used to assert the opposite — that the hat stays
  // at rest — and it PASSED, for a reason that had nothing to do with the claim: the humanoid
  // layer's hat box was being extracted as a ZERO-SIZED box (its `CubeDeformation.extend(0.5F)`
  // wiped the operand run; D-415), so every vertex of it sat on the same point and no rotation
  // could ever move its centroid. A check that cannot fail is not a check (D-305). The hat is a
  // real 8x8x8 box now and the assertion is the one vanilla actually makes.
  for (const nm of ['head', 'hat', 'left_arm', 'right_arm', 'left_leg', 'right_leg']) {
    ok(dist(rest[byName[nm]], posed[byName[nm]]) > 0.01, `zombie.${nm} moved under a non-trivial anim`);
  }
  // ⚠ QUANTIZATION TOLERANCE, DERIVED — never an arbitrary round number (D-329). Every
  // emitted vertex coordinate is Math.round()-ed to the nearest MODEL UNIT before
  // `M.packModelVertex` stores it (05_mesher.js: positions are plain i16 integers in
  // CFG.MODEL_UNITS_PER_BLOCK units, no fractional bits survive pack/unpack — see
  // 07j_entityrender.js's `wx[c] = ux + Math.round(rx)` / `wy[c] = ... + Math.round(...)` /
  // `wz[c] = ... + Math.round(rz)`), so the quantization step is exactly 1 unit.
  // hat.copyFrom(head) makes hat's CONTINUOUS (unrounded) centroid IDENTICAL to head's — the
  // box grows symmetrically about the same pivot (CubeDeformation(0.5), D-698), and the
  // centroid of a box's own surface vertices is invariant under symmetric growth about that
  // centroid. But head (8-unit box) and hat (9-unit box, D-698) put their vertices at
  // DIFFERENT fractional positions after the same rotation, so the two parts' independent
  // per-vertex roundings no longer cancel to the same subpixel degree. Rounding to the
  // nearest unit moves any one coordinate by at most half a step (0.5 units); a part's
  // centroid — the average of several independently-rounded vertices — inherits that same
  // +-0.5-unit bound on each axis. Two parts, each with up to 0.5 units of error on a given
  // axis in the worst case, can differ by up to 1.0 unit on that axis; `dist()` (already used
  // throughout this file) combines x/y/z in quadrature, so the worst possible 3-axis residual
  // is sqrt(3) * 1.0 units. (An empirical sweep over limbSwingAmount/netHeadYaw/headPitch
  // found nothing worse than ~0.71 units, comfortably inside this bound — the DERIVED bound
  // below is the tolerance, not that empirical number.)
  const QUANT_STEP = 1; // CFG.MODEL_UNITS_PER_BLOCK integer-rounding step (05_mesher.js i16 fields)
  const HAT_HEAD_QUANT_TOLERANCE = Math.sqrt(3) * QUANT_STEP;
  const hatHeadResidual = byName.hat !== undefined
    ? dist(posed[byName.head], posed[byName.hat]) : Infinity;
  ok(hatHeadResidual < HAT_HEAD_QUANT_TOLERANCE,
     `zombie.hat is posed exactly with zombie.head, within vertex-quantization noise ` +
     `(HumanoidModel: hat.copyFrom(head); residual ${hatHeadResidual.toFixed(4)} < ` +
     `${HAT_HEAD_QUANT_TOLERANCE.toFixed(4)}-unit derived bound)`);
  // anti-vacuity: the tolerance above must not be so loose it would swallow a real pose bug.
  // Monkeypatch setupAnimDeltaCore so hat's yaw is silently dropped (what a real regression —
  // e.g. `hatComposed` wired backwards — would look like) and confirm THAT still fails loudly
  // at the same tolerance, then restore the original before anything else runs.
  {
    const origCore = ER.setupAnimDeltaCore;
    ER.setupAnimDeltaCore = function (partName, limbSwing, limbSwingAmount, netHeadYaw, headPitch, riding, kind, ctx) {
      if (partName === 'hat') {
        return origCore.call(this, partName, limbSwing, limbSwingAmount, 0, headPitch, riding, kind, ctx);
      }
      return origCore.apply(this, arguments);
    };
    let brokenResidual;
    try {
      const brokenPosed = centroids('zombie', anim);
      brokenResidual = dist(brokenPosed[byName.head], brokenPosed[byName.hat]);
    } finally {
      ER.setupAnimDeltaCore = origCore;
    }
    okAv(brokenResidual > HAT_HEAD_QUANT_TOLERANCE,
      `anti-vacuity: deliberately zeroing hat's netHeadYaw still fails the quantization ` +
      `tolerance (residual ${brokenResidual.toFixed(4)} > ${HAT_HEAD_QUANT_TOLERANCE.toFixed(4)})`);
  }
  // left/right legs (and arms) swing a half-cycle (pi) apart at this limbSwing — so at
  // limbSwing=1 (where cos(0.6662) != cos(0.6662+pi)) they must NOT have moved the same way.
  const legDeltaL = dist(rest[byName.left_leg], posed[byName.left_leg]);
  const legDeltaR = dist(rest[byName.right_leg], posed[byName.right_leg]);
  ok(Math.abs(legDeltaL - legDeltaR) < 1e-6 === false || (legDeltaL > 0 && legDeltaR > 0),
     'zombie legs: both swung (phase-opposite, not zero)');
  say(`left_leg moved ${legDeltaL.toFixed(4)}, right_leg moved ${legDeltaR.toFixed(4)} (world units)`);

  // riding: legs SET to a fixed angle rather than oscillate — different pose than walking.
  const ridingAnim = { limbSwing: 1.0, limbSwingAmount: 1.0, netHeadYaw: 0, headPitch: 0, riding: true };
  const ridingPosed = centroids('zombie', ridingAnim);
  ok(dist(posed[byName.right_leg], ridingPosed[byName.right_leg]) > 0.01,
     'zombie riding=true poses the legs differently than walking (SET vs oscillate)');
  ok(dist(rest[byName.right_leg], ridingPosed[byName.right_leg]) > 0.01,
     'zombie riding=true still differs from rest (the seated angle is non-zero)');
}

// ═══════════════ 3. the quadruped (cow): diagonal gait, front/back legs half a cycle apart ═
console.log('\n 3. cow (QuadrupedModel): diagonal-pair gait, half a cycle apart (git 2a8efe1:docs/passes/PASS-15-HISTORY.md 4.4)');
{
  const rest = centroids('cow', null);
  const anim = { limbSwing: 1.0, limbSwingAmount: 1.0, netHeadYaw: 0, headPitch: 0, riding: false };
  const posed = centroids('cow', anim);
  const L = BE.layer('cow');
  const idxOf = (nm) => L.parts.findIndex((p) => p.n === nm);
  const lf = idxOf('left_front_leg'), rh = idxOf('right_hind_leg');
  const rf = idxOf('right_front_leg'), lh = idxOf('left_hind_leg');
  ok([lf, rh, rf, lh].every((i) => i >= 0), 'cow has all four leg parts by name');
  for (const [nm, i] of [['left_front_leg', lf], ['right_hind_leg', rh], ['right_front_leg', rf], ['left_hind_leg', lh]]) {
    ok(dist(rest[i], posed[i]) > 0.01, `cow.${nm} moved under a non-trivial anim`);
  }
  // left_front_leg and right_hind_leg share phase 0 -> their DISPLACEMENT VECTORS should be
  // identical (both are the SAME rx delta applied about each leg's own pivot the same way the
  // rest-pose model already keeps distinct per-part pivots, D-317/JOB-4.3's own section 4).
  const dLF = [posed[lf][0]-rest[lf][0], posed[lf][1]-rest[lf][1], posed[lf][2]-rest[lf][2]];
  const dRH = [posed[rh][0]-rest[rh][0], posed[rh][1]-rest[rh][1], posed[rh][2]-rest[rh][2]];
  const dRF = [posed[rf][0]-rest[rf][0], posed[rf][1]-rest[rf][1], posed[rf][2]-rest[rf][2]];
  ok(dist(dLF, dRH) < 1e-6, 'left_front_leg and right_hind_leg carry the SAME angle delta (phase 0 pair)');
  ok(dist(dLF, dRF) > 1e-3, 'the diagonal pair (phase 0) differs from the other pair (phase pi)');
  say(`front-left/hind-right delta ${dLF.map(v=>v.toFixed(4))}, front-right delta ${dRF.map(v=>v.toFixed(4))}`);

  for (const nm of ['body', 'left_horn']) {
    const i = idxOf(nm);
    if (i >= 0) ok(dist(rest[i], posed[i]) < 1e-6, `cow.${nm} unchanged (not a setupAnim part; D-139)`);
  }
}

// ═══════════════ 3b. the SPIDER: its own setupAnim, eight legs, two phases each ════════════
console.log('\n 3b. spider (SpiderModel): eight legs splayed and swinging, from `elg.a`\'s bytecode (D-415)');
{
  const L = BE.layer('spider');
  ok(!!L, 'the spider layer exists');
  if (L) {
    const idxOf = (nm) => L.parts.findIndex((p) => p.n === nm);
    const LEGS = ['right_hind_leg', 'left_hind_leg', 'right_middle_hind_leg', 'left_middle_hind_leg',
                  'right_middle_front_leg', 'left_middle_front_leg', 'right_front_leg', 'left_front_leg'];
    // ⚠ FIRST: the extraction itself. Before D-415 the spider shipped `right_hind_leg` TWICE
    // (a hoisted builder's boxes leaking onto the first part that used it) and seven of its
    // eight legs at texOffs (0, 0). A pose applied to the wrong boxes proves nothing.
    ok(L.parts.length === 11, `the spider has 11 parts (head, two body boxes, eight legs); got ${L.parts.length}`);
    for (const nm of LEGS) ok(idxOf(nm) >= 0, `spider.${nm} exists exactly once`);
    ok(new Set(L.parts.map((p) => p.n)).size === 11, 'and no part name is duplicated');
    ok(L.parts.filter((p) => LEGS.includes(p.n)).every((p) => p.tu === 18 && p.tv === 0),
       'every leg is at texOffs(18, 0) — the one patch of skin all eight share');
    // ⚠ AND the REST pose is all zeros, which is what makes vanilla's ASSIGNMENTS and this
    // file's DELTAS the same number. Asserted, not assumed (see ER.spiderDelta's header).
    ok(L.parts.filter((p) => LEGS.includes(p.n)).every((p) => p.rx === 0 && p.ry === 0 && p.rz === 0),
       'a spider leg\'s rest rotation is zero, so a delta IS the absolute angle vanilla sets');

    const rest = centroids('spider', null);
    const still = { limbSwing: 0, limbSwingAmount: 0, netHeadYaw: 0, headPitch: 0, riding: false };
    const stood = centroids('spider', still);
    const walk = { limbSwing: 1.0, limbSwingAmount: 1.0, netHeadYaw: 0, headPitch: 0, riding: false };
    const posed = centroids('spider', walk);

    // A STANDING spider is not a rest-pose spider: the base splay is applied at amount 0 too.
    for (const nm of LEGS) {
      ok(dist(rest[idxOf(nm)], stood[idxOf(nm)]) > 0.01,
         `spider.${nm} is splayed out even standing still (the base zRot/yRot, not the swing)`);
    }
    // ...and every one of the eight moves again once it is walking.
    for (const nm of LEGS) {
      ok(dist(stood[idxOf(nm)], posed[idxOf(nm)]) > 0.01, `spider.${nm} swings when walking`);
    }
    // The two body boxes never move, and neither does anything at all without an anim.
    for (const nm of ['body0', 'body1']) {
      ok(dist(rest[idxOf(nm)], posed[idxOf(nm)]) < 1e-6, `spider.${nm} is never posed`);
    }
    // ⚠ THE POINT OF `ER.modelKindOf`: four of the spider's leg names are ALSO the quadruped's,
    // and a name-only lookup gave a spider a cow's trot. The two must disagree.
    const asQuad = ER.setupAnimDelta('left_front_leg', 1.0, 1.0, 0, 0, false, 'quadruped');
    const asSpider = ER.setupAnimDelta('left_front_leg', 1.0, 1.0, 0, 0, false, 'spider');
    ok(!!asQuad && !!asSpider && (Math.abs(asQuad.rx - asSpider.rx) > 1e-6 ||
       Math.abs(asQuad.rz - asSpider.rz) > 1e-6),
       'left_front_leg is posed differently as a spider than as a quadruped (D-415)');
    ok(ER.modelKindOf('spider') === 'spider' && ER.modelKindOf('cow') === 'quadruped' &&
       ER.modelKindOf('zombie') === 'humanoid',
       'ER.modelKindOf reads the family off the part names, not off a type list');
    // the hind pair is half a cycle out of phase with the middle-hind pair (phases 0 and pi)
    const dHind = dist(stood[idxOf('right_hind_leg')], posed[idxOf('right_hind_leg')]);
    const dMidHind = dist(stood[idxOf('right_middle_hind_leg')], posed[idxOf('right_middle_hind_leg')]);
    ok(Math.abs(dHind - dMidHind) > 1e-4,
       `the four leg pairs are on four different phases; hind moved ${dHind.toFixed(4)}, middle-hind ${dMidHind.toFixed(4)}`);
  }
}

// ═══════════════ 3c. THE ARMS-OUT POSE (D-429) ═════════════════════════════════
//
// Dan, session 55: *"the zombie doesnt have its arms out pose"*. §2 above proved the zombie was
// posed like a HumanoidModel and it was right — that WAS the bug. The arms-out pose is a second
// layer, `AnimationUtils.animateZombieArms`, applied after the super call, and it OVERWRITES all
// three arm angles rather than adding to them.
//
// ⚠ EVERY NUMBER BELOW COMES OUT OF THE SHIPPED TABLE, not out of this file (rule 3). The only
// things typed here are the SHAPES the table has to have: the two arms mirror, the angry pose is
// higher than the calm one, and the idle bob moves.
console.log('\n 3c. the zombie arms-out pose (D-429)');
{
  const C = ER.zombieArms('zombie');
  ok(!!C, 'zombie has no arms-out layer in the shipped table');
  ok(!ER.zombieArms('cow'), 'a cow was given the zombie arms — the set is not the jar\'s call graph');
  // ⚠ AND IT IS NOT ONLY ZOMBIES. The illager model calls the same helper, which is why a
  // vindicator charges with its arms out. A hand-written list would have missed it.
  ok(!!ER.zombieArms('vindicator'), 'vindicator lost the arms-out layer — the caller walk found only the obvious mob');

  if (C) {
    const rest = { rx: 0, ry: 0, rz: 0 };
    const calmL = ER.zombieArmDelta('left_arm', C, 0, 0, false, rest);
    const calmR = ER.zombieArmDelta('right_arm', C, 0, 0, false, rest);
    const angryL = ER.zombieArmDelta('left_arm', C, 0, 0, true, rest);

    // the pose: arms raised FORWARD, which is a negative xRot of most of a right angle
    ok(calmL.rx < -1.2 && calmL.rx > -1.6,
       `a calm zombie's arm is at ${calmL.rx.toFixed(3)} rad — the table says -PI/${C.calmDiv} = ${(-Math.PI / C.calmDiv).toFixed(3)}`);
    ok(angryL.rx < calmL.rx,
       `an aggressive zombie's arms (${angryL.rx.toFixed(3)}) are not raised higher than a calm one's (${calmL.rx.toFixed(3)})`);
    ok(Math.abs(angryL.rx - calmL.rx) > 0.5,
       'the aggressive and calm poses are within half a radian — the split would not read on screen');

    // the two arms mirror in yaw and in the bob, and agree in pitch
    ok(Math.abs(calmL.ry + calmR.ry) < 1e-9, `the arms do not mirror in yaw: ${calmL.ry} vs ${calmR.ry}`);
    ok(Math.abs(calmL.rz + calmR.rz) < 1e-9, `the arms do not mirror in roll: ${calmL.rz} vs ${calmR.rz}`);
    ok(Math.abs(calmL.rx - calmR.rx) < 1e-9, `the arms disagree in pitch: ${calmL.rx} vs ${calmR.rx}`);

    // the idle bob: it depends on AGE and on nothing else here
    const t0 = ER.zombieArmDelta('left_arm', C, 0, 0, false, rest);
    const t1 = ER.zombieArmDelta('left_arm', C, 17.5, 0, false, rest);
    ok(Math.abs(t0.rz - t1.rz) > 1e-4, 'the arms do not bob — zRot is the same at two different ages');
    ok(Math.abs(t0.rz) <= 2 * C.bobAmp + 1e-9 && Math.abs(t1.rz) <= 2 * C.bobAmp + 1e-9,
       `the bob leaves the +-${2 * C.bobAmp} the table allows: ${t0.rz} / ${t1.rz}`);

    // ⚠⚠ AND THE HUMANOID SWING MUST NOT SURVIVE UNDER IT. This is the bug itself: if the
    // arm delta still moves with `limbSwing`, the zombie is being posed by both layers.
    const ctx = { zarm: C, rest: rest, ageInTicks: 0, attackTime: 0, aggressive: false };
    const a = ER.setupAnimDelta('left_arm', 0, 1, 0, 0, false, 'humanoid', ctx);
    const b = ER.setupAnimDelta('left_arm', 3.7, 1, 0, 0, false, 'humanoid', ctx);
    ok(Math.abs(a.rx - b.rx) < 1e-12,
       `a zombie's arm still swings with the walk (${a.rx} vs ${b.rx}) — the humanoid layer is being added under the pose`);

    // the REST angles are subtracted, so the pose is absolute however the model was built
    const off = ER.zombieArmDelta('left_arm', C, 0, 0, false, { rx: 0.25, ry: -0.1, rz: 0.4 });
    ok(Math.abs((off.rx + 0.25) - calmL.rx) < 1e-12 && Math.abs((off.rz + 0.4) - calmL.rz) < 1e-12,
       'the pose is not absolute: a part with non-zero rest angles ends up somewhere else');

    // ...and it really moves the arms in the built layer
    const posedZ = centroids('zombie', { limbSwing: 0, limbSwingAmount: 0, netHeadYaw: 0, headPitch: 0, riding: false, ageInTicks: 0, attackTime: 0, aggressive: false });
    const restZ = centroids('zombie', null);
    const Lz = BE.layer('zombie'); const bn = {}; Lz.parts.forEach((p, i) => { bn[p.n] = i; });
    ok(dist(restZ[bn.left_arm], posedZ[bn.left_arm]) > 0.1,
       'with NO limb swing at all the zombie\'s arm is still at rest — the arms-out pose is not reaching the built layer');
    ok(dist(restZ[bn.left_leg], posedZ[bn.left_leg]) < 1e-6,
       'the zombie-arm layer moved a LEG — it must touch the two arms and nothing else');
    say(`calm ${calmL.rx.toFixed(3)} rad, angry ${angryL.rx.toFixed(3)} rad, arm moved ${dist(restZ[bn.left_arm], posedZ[bn.left_arm]).toFixed(3)} world units`);

    // ── live anti-vacuity: drop the ctx and the humanoid swing comes back ───────────────
    const na = ER.setupAnimDelta('left_arm', 0, 1, 0, 0, false, 'humanoid');
    const nb = ER.setupAnimDelta('left_arm', 3.7, 1, 0, 0, false, 'humanoid');
    okAv(Math.abs(na.rx - nb.rx) > 1e-6,
         'anti-vacuity: without the zombie-arm ctx the arm swings with the walk again — the "it does not swing" test can fail');
    okAv(Math.abs(na.rx - calmL.rx) > 0.5,
         'anti-vacuity: the humanoid swing and the arms-out pose are nowhere near each other, so the two are really being told apart');
  }
}

// ═══════════════ 3d. ROTATION BETWEEN TICKS (D-430) ════════════════════════════
//
// Dan, session 55: *"all turns of mobs look stuttery and not smooth"*. The CLASS of the bug, not
// the instance: a mob's POSITION has been interpolated between ticks since G17b (`ER.posAt`),
// and its three rotations were read raw — so a mob glided across the ground while its heading
// snapped twenty times a second. Everything else the renderer reads per-tick is already
// interpolated (the item bob and spin off `age + partial`, the limb swing off `animSpeedO`, a
// chest lid off `lidOpenness(e, partial)`); rotation was the one that was not.
console.log('\n 3d. a mob\'s heading is interpolated between ticks (D-430)');
{
  // the wrap, which is the only part of rotLerp that can be subtly wrong
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  ok(near(ER.rotLerp(0.5, 0, Math.PI / 2), Math.PI / 4), 'rotLerp does not lerp at all');
  // ⚠ MODULO 2pi, because the far end is reached BY THE SHORT WAY: lerping 1.2 -> -2.5 goes
  // the other way round and lands on -2.5 + 2pi, which is the same heading and the right path.
  const sameAngle = (x, y) => { let d = (x - y) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d <= -Math.PI) d += 2 * Math.PI; return Math.abs(d) < 1e-9; };
  ok(sameAngle(ER.rotLerp(0, 1.2, -2.5), 1.2) && sameAngle(ER.rotLerp(1, 1.2, -2.5), -2.5),
     'rotLerp does not land on its two ends');
  // ⚠⚠ THE ONE THAT MATTERS: 179° -> -179° is a TWO degree turn, not a 358 degree spin, and
  // a mob walking north crosses exactly that heading over and over.
  const a = Math.PI - 0.02, b = -Math.PI + 0.02;
  const mid = ER.rotLerp(0.5, a, b);
  ok(Math.abs(mid) > Math.PI - 0.03,
     `rotLerp took the long way round the wrap: halfway from ${a.toFixed(3)} to ${b.toFixed(3)} is ${mid.toFixed(3)}, which is a spin`);
  ok(sameAngle(ER.rotLerp(1, a, b), b), 'rotLerp does not reach the far end across the wrap');

  // the body heading
  const e = { yawO: 0, yaw: 1.0, yHeadRotO: 0, yHeadRot: 1.0, xHeadRotO: 0, xHeadRot: 0.5,
              maxHealth: 20, animSpeed: 0, animSpeedO: 0, animPos: 0, age: 0 };
  ok(near(ER.yawAt(e, 0), 0) && near(ER.yawAt(e, 1), 1.0), 'yawAt does not reach both ends of the tick');
  ok(near(ER.yawAt(e, 0.25), 0.25), `yawAt is not linear inside the tick: ${ER.yawAt(e, 0.25)}`);
  // an entity that has never been ticked has no yawO and must not read as pointing at 0
  ok(near(ER.yawAt({ yaw: 2.0 }, 0.3), 2.0), 'an entity with no previous heading was lerped from zero');

  // the head, whose angle is an OFFSET from a body that is also moving
  const half = ER.animOf(e, 0.5);
  ok(Math.abs(half.netHeadYaw) < 1e-6,
     `the head is ${half.netHeadYaw} degrees off a body it is turning WITH — both ends must be interpolated`);
  const pitch0 = ER.animOf(e, 0).headPitch, pitch1 = ER.animOf(e, 1).headPitch;
  // ⚠ 1e-3, not 1e-9: `RAD2DEG` in the renderer is a float32 constant, so the answer is a
  // float32's worth of degrees and an exact-double comparison here would fail on arithmetic.
  ok(Math.abs(pitch0) < 1e-9 && Math.abs(pitch1 - 0.5 * 180 / Math.PI) < 1e-3,
     `the head pitch does not interpolate: ${pitch0} .. ${pitch1}`);
  // ...and a head that really is turned relative to the body still reads as turned
  const e2 = Object.assign({}, e, { yHeadRot: 1.5 });
  ok(ER.animOf(e2, 1).netHeadYaw > 20,
     'a head turned half a radian off the body reads as straight ahead — the offset was lost');

  // ⚠ AND THE CALL SITE. `ER.build` is what hands the model its heading, and a correct
  // `yawAt` that nothing calls fixes nothing. This reads the SHIPPED SOURCE, the way
  // `optionscheck` §5 reads it, because there is no other way to see which expression it used.
  const built = readFileSync(MCLITE_ROOT + 'src/07j_entityrender.js', 'utf8');
  // ⚠ ANCHOR ON THE MOB BRANCH, not on the first `emitMobLayer` in the file — that one is the
  // block-entity branch (a chest), which has its own yaw and must NOT be lerped this way.
  const at = built.lastIndexOf("it.shape === 'mob'");
  ok(at > 0, 'ER.build no longer has a mob branch — this source scan is out of date');
  const emit = built.slice(at, at + 3000);   // s116: the mob branch's comments grew past 1200 chars (sleepPose, D-627 era) -- the call itself is unchanged
  // s134: the mob branch calls ER.bodyYawAt (yawAt + the shaking offset, LivingEntityRenderer.setupTransforms)
  // later: the mob branch calls ER.dragonYaw(it.e, partial), whose fallthrough is ER.bodyYawAt (dragon segment heading otherwise)
  ok(/ER\.dragonYaw\(it\.e, partial\)/.test(emit) && /return ER\.bodyYawAt\(e, partial\);\s*\};\s*ER\.dragonDelta/.test(built) && /ER\.bodyYawAt = function \(e, partial\) \{ return ER\.yawAt\(e, partial\)/.test(built),
     'ER.build still hands emitMobLayer a raw yaw — the interpolation is not reaching the screen');
  ok(!/Math\.cos\(it\.e\.yaw \|\| 0\)/.test(emit),
     'the pre-D-430 raw-yaw expression is still in ER.build');

  // ── live anti-vacuity ────────────────────────────────────────────────────────
  // Take the previous heading away — which is exactly the pre-D-430 state — and the mob must
  // stop moving between ticks.
  const stale = { yaw: 1.0, yHeadRot: 1.0, xHeadRot: 0.5, maxHealth: 20, age: 0, animSpeed: 0, animSpeedO: 0, animPos: 0 };
  okAv(Math.abs(ER.yawAt(stale, 0.1) - ER.yawAt(stale, 0.9)) < 1e-12,
       'anti-vacuity: with no previous heading the mob is drawn at one angle for the whole tick — which is the stutter, and the test above can see it');
  okAv(Math.abs(ER.yawAt(e, 0.1) - ER.yawAt(e, 0.9)) > 0.5,
       'anti-vacuity: ...and WITH one it really does move inside the tick, so the comparison is not always true');
}

// ═══════════════ 4. anti-vacuity — zero amplitude collapses back to rest ═══════════════════
console.log('\n 4. anti-vacuity: the formulas are not vacuously "always different from rest"');
{
  // ⚠ SKELETON, NOT ZOMBIE (D-429). A zombie's arms are posed by `animateZombieArms`, which
  // does not read `limbSwingAmount` at all — so "amplitude 0 collapses to rest" is FALSE for
  // them, correctly, and this break would fail for a reason that has nothing to do with the
  // claim it is making. The skeleton is the same HumanoidModel with no second layer over it.
  const rest = centroids('skeleton', null);
  const zeroAnim = { limbSwing: 1.0, limbSwingAmount: 0, netHeadYaw: 0, headPitch: 0, riding: false };
  const zeroPosed = centroids('skeleton', zeroAnim);
  const L = BE.layer('skeleton');
  ok(!ER.zombieArms('skeleton'), 'skeleton has the zombie-arm layer — pick another humanoid for this break');
  const byName = {}; L.parts.forEach((p, i) => { byName[p.n] = i; });
  let allZero = true;
  for (const nm of ['left_arm', 'right_arm', 'left_leg', 'right_leg']) {
    if (dist(rest[byName[nm]], zeroPosed[byName[nm]]) > 1e-6) allZero = false;
  }
  okAv(allZero, 'anti-vacuity: limbSwingAmount=0 collapses arms/legs back to the REST pose exactly (the formula genuinely depends on amplitude)');

  // and unrecognized part names (a layer with no setupAnim mapping) must return null, not throw
  // or silently move — proven directly against the function, not inferred from a layer that
  // happens to have no such part.
  const d = ER.setupAnimDelta('some_future_part_name', 1, 1, 10, 10, false);
  okAv(d === null, 'anti-vacuity: ER.setupAnimDelta returns null (leaves REST pose) for an unrecognized part name, never a guess (D-139)');
}

// ═══════════════ 5. THE MOB SWING — ER.swingHand/ER.tickHandSwing/ER.getHandSwingProgress (QUEUE 0.2) ═══════════════
console.log('\n 5. the mob swing: swingHand/tickHandSwing/getHandSwingProgress (QUEUE 0.2, ER.ZARM_OWED closed)');
{
  ok(typeof ER.swingHand === 'function', 'ER.swingHand exists');
  ok(typeof ER.tickHandSwing === 'function', 'ER.tickHandSwing exists');
  ok(typeof ER.getHandSwingProgress === 'function', 'ER.getHandSwingProgress exists');

  // a fresh mob is not swinging, and reports zero progress at any partial tick
  const m = { maxHealth: 20, age: 0 };
  ok(ER.getHandSwingProgress(m, 0) === 0 && ER.getHandSwingProgress(m, 1) === 0,
     'an untouched mob has swing progress before ever being swung');

  // swingHand() starts the swing; six ticks (the un-hasted duration, .decomp
  // getHandSwingDuration()) walk handSwingProgress from 0 to 1 and end it
  ER.swingHand(m);
  ok(m.handSwinging === true && m.handSwingTicks === -1, 'swingHand did not start the swing (handSwinging/handSwingTicks)');
  // handSwingTicks starts at -1 (swingHand's own set), so the 6-tick duration is spent
  // reaching 0..5 and the 7th tickHandSwing call is the one that rolls it back to 0 and ends
  // the swing — `LivingEntity.tickHandSwing()` (.decomp): `if (++handSwingTicks >= duration)`.
  const seen = [];
  for (let i = 0; i < 7; i++) { ER.tickHandSwing(m); seen.push(ER.getHandSwingProgress(m, 1)); }
  ok(m.handSwinging === false, `the swing did not end after its own 6-tick duration (still swinging, ticks=${m.handSwingTicks})`);
  // the DISCRETE field resets to 0 the instant the swing ends (.decomp tickHandSwing);
  // `getHandSwingProgress(partial=1)` instead reads 1 here, correctly — it is still
  // completing the swing's LAST tick's motion (`last=5/6 -> +1/6 wraparound -> 1` at
  // partial=1), the same way it reads `last + d*partial` mid-swing.
  ok(m.handSwingProgress === 0, `the discrete handSwingProgress field did not reset to 0 when the swing ended: ${m.handSwingProgress}`);
  ok(seen[6] === 1, `getHandSwingProgress(partial=1) on the ending tick did not complete the swing to 1: ${seen[6]}`);
  let rose = true;
  for (let i = 1; i < 6; i++) if (!(seen[i] >= seen[i - 1])) rose = false;
  ok(rose, `the swing's progress is not monotonic across its own 6 ticks: ${seen.join(',')}`);

  // between two ticks, getHandSwingProgress interpolates by the partial tick
  const m2 = { maxHealth: 20, age: 0 };
  ER.swingHand(m2); ER.tickHandSwing(m2); ER.tickHandSwing(m2);
  const p0 = ER.getHandSwingProgress(m2, 0), p1 = ER.getHandSwingProgress(m2, 1);
  const pHalf = ER.getHandSwingProgress(m2, 0.5);
  ok(Math.abs(pHalf - (p0 + (p1 - p0) * 0.5)) < 1e-9,
     `getHandSwingProgress does not linearly interpolate at partial=0.5: ${pHalf} vs ${(p0 + (p1 - p0) * 0.5)}`);

  // ER.animOf feeds the real value as `attackTime`, not the old hard 0
  const anim0 = ER.animOf({ maxHealth: 20, age: 0 }, 1);
  ok(anim0 && anim0.attackTime === 0, `an untouched mob's animOf().attackTime is not 0: ${anim0 && anim0.attackTime}`);
  const swinger = { maxHealth: 20, age: 0 };
  ER.swingHand(swinger); ER.tickHandSwing(swinger); ER.tickHandSwing(swinger);
  const anim1 = ER.animOf(swinger, 1);
  ok(anim1 && anim1.attackTime > 0, `a mid-swing mob's animOf().attackTime is still 0 — ER.ZARM_OWED's own hole is back`);

  // `EL.tickAnim` (07i_entitylist.js) calls `ER.tickHandSwing`, the same pairing
  // `LivingEntity.tick()` keeps with `aiStep()` — proven through the real entity list, not by
  // re-implementing the call.
  const EL = M.EntityList;
  ok(!!EL && typeof EL.tickAnim === 'function', 'M.EntityList.tickAnim exists (QUEUE 0.2 wires ER.tickHandSwing into it)');
  const e3 = { maxHealth: 20, age: 0, x: 0, z: 0, px: 0, pz: 0 };
  ER.swingHand(e3);
  const before = e3.handSwingTicks;
  EL.tickAnim(e3);
  ok(e3.handSwingTicks === before + 1, `EL.tickAnim did not advance handSwingTicks (still ${e3.handSwingTicks}) — ER.tickHandSwing is not wired into the mob tick`);

  // ⚠ ANTI-VACUITY, BOTH DIRECTIONS (rule 1/3). Break the data and prove the break is caught.
  okAv(ER.getHandSwingProgress({ maxHealth: 20, age: 0 }, 0) === 0,
       'anti-vacuity: an untouched mob really has zero swing progress (the "it rises" assertions above are not vacuously true for every mob)');
  const brokenNoTick = { maxHealth: 20, age: 0 };
  ER.swingHand(brokenNoTick); // never ticked
  okAv(ER.getHandSwingProgress(brokenNoTick, 1) === 0,
       'anti-vacuity: swingHand alone (no tick) leaves progress at 0 — the rise comes from ER.tickHandSwing, not from swingHand itself');
  // deliberately break the wiring the way the deleted ER.ZARM_OWED path looked: feed a hard 0
  // instead of the real read, and prove the check above would have caught it.
  const fakeAnimOf = function (e2) { return { attackTime: 0 }; };
  const swinger2 = { maxHealth: 20, age: 0 };
  ER.swingHand(swinger2); ER.tickHandSwing(swinger2);
  okAv(!(fakeAnimOf(swinger2).attackTime > 0),
       'anti-vacuity: the OLD hard-0 attackTime (what ER.ZARM_OWED described) fails the exact assertion the real animOf() must pass — the check would have caught the regression');
}


console.log('\n 6. QUEUE 0.2 Tame/Breed remainder: the per-entity RGB tint channel (D-503), and the\n' +
            '    leash knot drawn through the shared mob buffer (D-508)');
{
  const Ms = M.Mesher, CFG2 = M.CFG;
  ok(typeof Ms.packModelVertex === 'function' && typeof Ms.unpackModelVertex === 'function',
     'M.Mesher.packModelVertex/unpackModelVertex exist');

  // ⚠ 6a. THE BITS ROUND-TRIP, AND OMITTING THEM IS THE IDENTITY (\u00d71.0, i.e. 7/7/7 eighths).
  // Every existing caller of packModelVertex (emitModelBlock, every OTHER emitMobLayer call
  // before this session) passes no er/eg/eb at all -- this is what proves they still draw
  // unchanged, not just that the new three fields exist.
  const buf1 = new Uint32Array(4);
  Ms.packModelVertex(buf1, 0, 1, 2, 3, 4, 5, 6, 1, 3, 15, 0, 0, 0, 0);
  const u1 = Ms.unpackModelVertex(buf1[0], buf1[1], buf1[2], buf1[3]);
  ok(u1.er === 7 && u1.eg === 7 && u1.eb === 7,
     `packModelVertex with no er/eg/eb round-trips to the (7,7,7) identity, not (${u1.er},${u1.eg},${u1.eb})`);

  const buf2 = new Uint32Array(4);
  Ms.packModelVertex(buf2, 0, 1, 2, 3, 4, 5, 6, 1, 3, 15, 0, 0, 0, 0, 5, 0, 7);
  const u2 = Ms.unpackModelVertex(buf2[0], buf2[1], buf2[2], buf2[3]);
  ok(u2.er === 5 && u2.eg === 0 && u2.eb === 7,
     `packModelVertex(er=5,eg=0,eb=7) round-trips wrong: got (${u2.er},${u2.eg},${u2.eb})`);
  // the OTHER packed fields (face/ao/sky/blk/tint/shade/flag) must survive the new bits
  // landing next to them in the same w3 word -- this is the "no new vertex bytes" claim,
  // tested directly rather than just asserted in a comment.
  ok(u2.face === 1 && u2.ao === 3 && u2.sky === 15 && u2.blk === 0,
     'the entity-tint bits (17-25) did not clobber face/ao/sky/blk (0-12)');

  okAv(u1.er !== u2.er || u1.eg !== u2.eg || u1.eb !== u2.eb,
       'anti-vacuity: the identity triple and the (5,0,7) triple actually decode to DIFFERENT values -- the channel is not a dead field that always reads back the same number');

  // ⚠ 6b. `ER.emitMobLayer`'s OWN new `tintRGB` argument reaches the packed vertices it emits,
  // through the real box-posing path -- not just through packModelVertex called directly.
  const L = BE.layer('leash_knot');
  ok(!!L, "BE.layer('leash_knot') resolves (models.bin carries QUEUE 0.2's leash-knot row)");
  if (L) {
    const nQuads = ER.mobQuadCount('leash_knot');
    okAv(nQuads > 0, 'anti-vacuity: leash_knot really costs a nonzero number of quads (6 faces, 1 slice each)');
    const outA = new Uint32Array(nQuads * 16);
    ER.emitMobLayer(outA, 0, 'leash_knot', 0, 0, 0, 1, 0, 15, 0, 0, null, undefined, null, false, null);
    const outB = new Uint32Array(nQuads * 16);
    ER.emitMobLayer(outB, 0, 'leash_knot', 0, 0, 0, 1, 0, 15, 0, 0, null, undefined, null, false, [1, 0, 0]);
    const vA = Ms.unpackModelVertex(outA[0], outA[1], outA[2], outA[3]);
    const vB = Ms.unpackModelVertex(outB[0], outB[1], outB[2], outB[3]);
    ok(vA.er === 7 && vA.eg === 7 && vA.eb === 7,
       `emitMobLayer with tintRGB=null draws the (7,7,7) identity, not (${vA.er},${vA.eg},${vA.eb})`);
    ok(vB.er === 7 && vB.eg === 0 && vB.eb === 0,
       `emitMobLayer with tintRGB=[1,0,0] (pure red) quantises to (7,0,0), not (${vB.er},${vB.eg},${vB.eb})`);
    okAv(vA.er === vB.er && (vA.eg !== vB.eg || vA.eb !== vB.eb),
         'anti-vacuity: the SAME box, tinted vs. not, really emits DIFFERENT packed vertices -- tintRGB is read, not ignored');
  }

  // ⚠ 6c. THE KNOT JOINS `ER.build`'S SHARED BUFFER (D-421's pattern, D-508's own closing).
  // A world with zero leashed mobs and zero block entities used to return null from
  // `ER.build` outright ("!list.length return null", this file's own header) -- a lone knot,
  // with no rope and no chest anywhere, must now be enough on its own to draw something.
  ok(typeof ER.leashKnotVisible === 'function', 'ER.leashKnotVisible exists');
  const savedTame = M.Tame;
  M.Tame = { ready: true, knots: [
    { x: 5, y: 64, z: 5, removed: false },
    { x: 9999, y: 64, z: 9999, removed: false },  // far outside ER.RANGE
    { x: 6, y: 64, z: 6, removed: true }            // removed -- must be skipped
  ] };
  const vis = ER.leashKnotVisible(0, 64, 0);
  ok(vis.length === 1, `ER.leashKnotVisible returned ${vis.length} items, expected 1 (the range gate and the removed-skip both matter)`);
  ok(vis[0] && vis[0].mobLayer === 'leash_knot' && vis[0].shape === 'mob',
     "the one item ER.leashKnotVisible returns is shaped {shape:'mob', mobLayer:'leash_knot'} — ER.build's own 'mob' branch, not a new one");

  const builtWithKnot = ER.build(0, 60, 0, 0, 64, 0, 1);
  ok(builtWithKnot && builtWithKnot.drawn === 1,
     `ER.build with a lone in-range knot and no entities/block-entities drew ${builtWithKnot ? builtWithKnot.drawn : 'null'}, expected 1`);

  M.Tame = { ready: false, knots: [] };
  const builtNoKnot = ER.build(0, 60, 0, 0, 64, 0, 1);
  okAv(builtNoKnot === null,
       'anti-vacuity: with Tame not ready (no knots offered), the SAME call returns null again — the draw above really came from the knot, not from something ER.build always does');
  M.Tame = savedTame;

  // ⚠ 6d. ALL THREE BACKENDS CARRY THE CHANNEL (D-503's own "needs an RGB channel in 3
  // backends"): the shared JS (10_gfx.js), the WebGL2 GLSL and the WebGPU WGSL.
  ok(typeof M.Gfx.entityTintExpr === 'function', 'M.Gfx.entityTintExpr exists (10_gfx.js, the shared source both shaders emit — D-52)');
  const glsl = M.GfxGL.buildShaders();
  const wgsl = M.GfxGPU.buildWGSL();
  const glslModel = glsl && glsl.VS_MODEL || '';
  ok(glslModel.length > 200, 'GfxGL.buildShaders().VS_MODEL exists and is non-trivial');
  ok(wgsl.length > 200, 'GfxGPU.buildWGSL() exists and is non-trivial');
  const bitPat = /\(\s*d3\s*>>\s*17u?\s*\)\s*&\s*7u?/;
  ok(bitPat.test(glslModel), 'the WebGL2 GLSL model shader decodes bits 17-19 (er) off d3 — entityTintExpr reached vs_model');
  ok(bitPat.test(wgsl), 'the WebGPU WGSL model shader decodes bits 17-19 (er) off d3 — entityTintExpr reached vs_model');
  ok(/etint/.test(glslModel) && /etint/.test(wgsl),
     "both vs_model shaders name the tint 'etint' and multiply it into the vertex's own tint/colour output");
  okAv(!bitPat.test(glsl && glsl.FS || ''),
       'anti-vacuity: the SAME bit pattern is absent from the (unrelated) fragment shader — the regex is not just matching noise it would match anywhere');
  ok(CFG2.MODEL_QUAD_BYTES === 64,
     'the model vertex is still 4 u32 per vertex (64 bytes/quad) — the channel lives in spare bits, it did not grow the layout');
}

// ═══════════════ report ═════════════════════════════════════════════════════════════════════
// s98 — the seated pose (IllagerEntityModel.method_17094 / BipedEntityModel riding branch):
// legs pitch -1.4137167, yaw ±PI/10, roll ±0.07853982; arms -PI/5; and it is fed by e.riding.
{
  const rl = ER.setupAnimDelta('right_leg', 3, 1, 0, 0, true, 'humanoid');
  const ll = ER.setupAnimDelta('left_leg', 3, 1, 0, 0, true, 'humanoid');
  ok(Math.abs(rl.rx + 1.4137167) < 1e-6 && Math.abs(rl.ry - Math.PI / 10) < 1e-6 && Math.abs(rl.rz - 0.07853982) < 1e-6,
    'riding right_leg = (-1.4137167, PI/10, 0.07853982)');
  ok(Math.abs(ll.ry + Math.PI / 10) < 1e-6 && Math.abs(ll.rz + 0.07853982) < 1e-6, 'riding left_leg splays the other way');
  const walk = ER.setupAnimDelta('right_leg', 3, 1, 0, 0, false, 'humanoid');
  okAv(Math.abs(walk.rx - rl.rx) > 0.3 && walk.ry === 0, 'anti-vacuity: the same leg NOT riding swings instead (the flag is read)');
  if (typeof ER.animOf === 'function') {
    const e = { type: 'pillager', yRot: 0, yBodyRot: 0, yHeadRot: 0, riding: true };
    let a = null; try { a = ER.animOf(e, 0.5); } catch (err) { a = null; }
    if (a) ok(a.riding === true, 'ER.animOf hands the model riding=true for a mob with e.riding (Rd.startRiding sets it)');
  }
}

// ═══════════════ bee (#4741): BeeEntityModel.setAngles / animateModel ═══════════════
console.log('\n bee: wings flap, legs/antennae/bone move airborne, stinger hides after a sting');
{
  ok(ER.modelKindOf('bee') === 'bee', 'bee has a model kind');
  const rest = centroids('bee', null), L = BE.layer('bee'), idx = {};
  L.parts.forEach((p, i) => { idx[p.n] = i; });
  const fly = (age, extra) => centroids('bee', Object.assign({ ageInTicks: age, bee: { still: false, angry: false, stung: false, bodyPitch: 0 } }, extra));
  const a = fly(3), b = fly(6);
  ok(dist(a[idx.left_wing], b[idx.left_wing]) > 1e-3, 'airborne wing moves with age');
  ok(dist(a[idx.front_legs], rest[idx.front_legs]) > 1e-3 && dist(a[idx.left_antenna], rest[idx.left_antenna]) > 1e-3, 'legs + antennae leave the rest pose');
  const still = centroids('bee', { ageInTicks: 3, bee: { still: true, angry: false, stung: false, bodyPitch: 0 } });
  ok(dist(still[idx.left_wing], rest[idx.left_wing]) < 1e-3, 'grounded+still wing = rest pose');
  const pitched = fly(3, { bee: { still: false, angry: false, stung: false, bodyPitch: 1 } });
  ok(dist(pitched[idx.body], a[idx.body]) > 1, 'bodyPitch rolls the body');
  const nq = (an) => { const o = new Uint32Array(ER.mobQuadCount('bee') * 16); return ER.emitMobLayer(o, 0, 'bee', 0, 0, 0, 1, 0, 15, 0, 3, an); };
  const q0 = nq({ ageInTicks: 3, bee: { still: false, stung: false, bodyPitch: 0 } }), q1 = nq({ ageInTicks: 3, bee: { still: false, stung: true, bodyPitch: 0 } });
  okAv(q1 < q0, 'anti-vacuity: hasStung drops the stinger quads (' + q0 + ' -> ' + q1 + ')');
}

console.log('\n' + '='.repeat(78));
console.log(` animcheck: ${pass} assertions, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.log('   x ' + f);
  process.exit(1);
}
console.log(' the setupAnim wiring moves the right named parts the right way, at the Node level;');
console.log(' no mob is on a real screen yet — the browser stage (JOB 4 acceptance) is still owed.');
