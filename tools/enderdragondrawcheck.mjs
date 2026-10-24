#!/usr/bin/env node
// enderdragondrawcheck.mjs — G18 leftover (D-788 residue, QUEUE.md row 0.00 part 2): the ender
// dragon's real per-part animated renderer, replacing the generic-box fallback
// (07zzm_wither.js's own name for the plain-rest-pose box path every unregistered mob draws
// through). Node-only — no canvas, no pixel, no live entity in `EntityList`; proves the FORMULA
// wiring (`ER.modelKindOf`, `ER.setupAnimDelta` -> `ER.dragonDelta`) the way `animcheck.mjs`
// proves the humanoid/quadruped one, ahead of any browser-kind acceptance bar.
//
//   node tools/enderdragondrawcheck.mjs [--verbose]

import { readFileSync } from 'node:fs';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

const VERBOSE = process.argv.includes('--verbose');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const say = (s) => { if (VERBOSE) console.log('   ' + s); };

console.log('enderdragondrawcheck — G18 leftover, the ender dragon\'s real 8-part animated renderer (D-788)');

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
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(MCLITE_ROOT + 'assets/entities.json', 'utf8'))
});
M.Entities.init();
M.EntityList.init();
M.EntityRender.init();

const ER = M.EntityRender, BE = M.BEModel;
ok(ER.ready, 'the entity renderer is up');
ok(BE.ready, 'the block-entity/mob box model table is up');
ok(typeof ER.dragonDelta === 'function', 'ER.dragonDelta exists');
ok(typeof ER.modelKindOf === 'function', 'ER.modelKindOf exists');

// ═══ 1. the real geometry is there (tools/golden/models-1.18.2.tsv, pack-models.mjs) ═══════
console.log('\n 1. the golden model table really shipped a full ender_dragon layer');
const L = BE.layer('ender_dragon');
ok(!!(L && L.parts && L.parts.length), 'BE.layer("ender_dragon") has boxes');
const partNames = {};
if (L) for (const p of L.parts) partNames[p.n] = 1;
for (const need of ['head', 'jaw', 'neck', 'body', 'left_wing', 'left_wing_tip',
                     'right_wing', 'right_wing_tip', 'left_front_leg', 'right_hind_leg']) {
  ok(!!partNames[need], `ender_dragon layer has a "${need}" part (ported from .decomp, not guessed)`);
}

// ═══ 2. THE CRUX -- it is not classified as a generic quadruped any more ═══════════════════
console.log('\n 2. modelKindOf recognizes the dragon as its own kind, not a cow with a bigger tag');
ok(ER.modelKindOf('ender_dragon') === 'ender_dragon',
   'ER.modelKindOf("ender_dragon") === "ender_dragon"');
// anti-vacuity: the dragon's own left_front_leg/left_hind_leg NAMES are the same ones a real
// quadruped uses (that is WHY modelKindOf needs the jaw/wing-tip check at all -- see the
// comment on that branch in 07j_entityrender.js). Simulating the OLD (pre-fix) dispatch by
// forcing kind='quadruped' through the exact same entry point proves the two paths really
// disagree — so a regression that let 'ender_dragon' fall through to 'quadruped' again would
// fail assertion 2 above AND give a visibly different (wrong) leg pose here.
{
  const ctx = { ageInTicks: 7, rest: null };
  const dragonLeg = ER.setupAnimDeltaCore('left_front_leg', 0.6, 0.9, 0, 0, false, 'ender_dragon', ctx);
  const quadrupedLeg = ER.setupAnimDeltaCore('left_front_leg', 0.6, 0.9, 0, 0, false, 'quadruped', ctx);
  ok(!!dragonLeg && !!quadrupedLeg, 'both dispatches return a pose for left_front_leg');
  const differ = dragonLeg && quadrupedLeg && Math.abs(dragonLeg.rx - quadrupedLeg.rx) > 0.05;
  ok(differ, 'anti-vacuity: the dragon-kind dispatch gives left_front_leg a DIFFERENT pitch than ' +
             'the generic quadruped walk-cycle formula would (the bug this closes: a real quadruped ' +
             'gait, `cos(limbSwing*0.6662)*1.4*limbSwingAmount`, ignoring the dragon\'s own flight-tuck ' +
             'pose entirely) — a regression that let the kind check fall through would collapse this ' +
             'back to `differ === false` and get caught here');
  say(`dragon left_front_leg.rx=${dragonLeg.rx.toFixed(4)} vs quadruped-gait ${quadrupedLeg.rx.toFixed(4)}`);
}

// ═══ 3. wing flap: real decomp trig, genuinely time-varying, genuinely mirrored ════════════
console.log('\n 3. wings/wing-tips/jaw really move (EnderDragonEntityRenderer.render, ported verbatim)');
{
  const a = { ageInTicks: 0 }, b = { ageInTicks: 5 };
  for (const part of ['left_wing', 'right_wing', 'left_wing_tip', 'right_wing_tip', 'jaw', 'neck']) {
    const da = ER.dragonDelta(part, a, 0, 0), db = ER.dragonDelta(part, b, 0, 0);
    ok(!!da && !!db, `ER.dragonDelta("${part}") returns a pose at two different ages`);
    const moved = da && db && (Math.abs(da.rx - db.rx) > 1e-6 || Math.abs(da.rz - db.rz) > 1e-6);
    ok(moved, `anti-vacuity: "${part}"'s pose at ageInTicks=0 differs from ageInTicks=10 — ` +
              `the wing-flap clock genuinely drives it, this is not a frozen rest-pose copy`);
  }
  // mirror symmetry the decomp source states explicitly (rightWing = leftWing.pitch / -yaw / -roll)
  for (const ctx of [a, b]) {
    const lw = ER.dragonDelta('left_wing', ctx, 0, 0), rw = ER.dragonDelta('right_wing', ctx, 0, 0);
    ok(Math.abs(lw.rx - rw.rx) < 1e-9, 'left_wing/right_wing share the same pitch (decomp: rightWing.pitch = leftWing.pitch)');
    ok(Math.abs(lw.ry + rw.ry) < 1e-9, 'left_wing/right_wing yaw are negatives of each other (decomp: rightWing.yaw = -leftWing.yaw)');
    ok(Math.abs(lw.rz + rw.rz) < 1e-9, 'left_wing/right_wing roll are negatives of each other (decomp: rightWing.roll = -leftWing.roll)');
    const lt = ER.dragonDelta('left_wing_tip', ctx, 0, 0), rt = ER.dragonDelta('right_wing_tip', ctx, 0, 0);
    ok(Math.abs(lt.rz + rt.rz) < 1e-9, 'left_wing_tip/right_wing_tip roll are negatives of each other');
  }
}

// ═══ 4. legs: setLimbRotation's six pitches, front/hind, tip vs main, all driven by the same clock ═
console.log('\n 4. all eight leg-related parts get a real (not rest-zero) flight-tuck pose');
{
  const ctx = { ageInTicks: 3 };
  for (const part of ['left_front_leg', 'right_front_leg', 'left_front_leg_tip', 'right_front_leg_tip',
                       'left_front_foot', 'right_front_foot', 'left_hind_leg', 'right_hind_leg',
                       'left_hind_leg_tip', 'right_hind_leg_tip', 'left_hind_foot', 'right_hind_foot']) {
    const d = ER.dragonDelta(part, ctx, 0, 0);
    ok(!!d && Math.abs(d.rx) > 0.3, `"${part}" gets a real (non-rest) pitch, not left at the model's 0 rest rotation`);
  }
  // left/right of the SAME leg segment must match (decomp's setLimbRotation takes no side flag)
  const lf = ER.dragonDelta('left_front_leg', ctx, 0, 0), rf = ER.dragonDelta('right_front_leg', ctx, 0, 0);
  ok(Math.abs(lf.rx - rf.rx) < 1e-9, 'left_front_leg and right_front_leg get IDENTICAL pitch (decomp: one setLimbRotation call shape, no per-side sign flip)');
}

// ═══ 5. head still gets ordinary head-tracking (this unit did not have to reinvent that part) ═
console.log('\n 5. head still tracks netHeadYaw/headPitch like every other mob');
{
  const d = ER.dragonDelta('head', {}, 33, -12);
  ok(!!d && Math.abs(d.ry - 33 * 0.017453292) < 1e-6, 'head.ry follows netHeadYaw*DEG2RAD');
  ok(!!d && Math.abs(d.rx - (-12) * 0.017453292) < 1e-6, 'head.rx follows headPitch*DEG2RAD');
}

// ═══ 6. body/unknown parts are left at rest, never guessed ═════════════════════════════════
ok(ER.dragonDelta('body', {}, 0, 0) === null, 'ER.dragonDelta("body") returns null (decomp assigns roll=0, which rest already is)');
ok(ER.dragonDelta('nonexistent_part', {}, 0, 0) === null, 'ER.dragonDelta of an unknown part name returns null, never a guess (D-139)');

// ═══ 7. end to end: emitMobLayer actually moves real emitted vertices, not just the delta table ═
console.log('\n 7. emitMobLayer really moves the dragon\'s vertices when given a live anim');
{
  const n = ER.mobQuadCount('ender_dragon');
  ok(n > 0, 'ender_dragon has emittable quads');
  const outRest = new Uint32Array(n * 16), outPosed = new Uint32Array(n * 16);
  const anim = { deltaFor: (name) => ER.dragonDelta(name, { ageInTicks: 5 }, 20, 5) };
  ER.emitMobLayer(outRest, 0, 'ender_dragon', 0, 0, 0, 1, 0, 15, 0, 3, null);
  ER.emitMobLayer(outPosed, 0, 'ender_dragon', 0, 0, 0, 1, 0, 15, 0, 3, anim);
  let same = true;
  for (let i = 0; i < outRest.length; i++) if (outRest[i] !== outPosed[i]) { same = false; break; }
  ok(!same, 'anti-vacuity: the posed emit is byte-different from the rest emit — the dragon' +
            '\'s own wings/jaw/legs genuinely move real emitted geometry, not just an unused delta table');
}

console.log(`\npassed: ${pass}`);
console.log(`failed: ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
process.exit(fails.length ? 1 : 0);
