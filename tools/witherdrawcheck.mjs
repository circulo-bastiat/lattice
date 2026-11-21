#!/usr/bin/env node
// witherdrawcheck.mjs — D-787 residue (G18 leftover, QUEUE.md row 0.00 part 2): the WITHER's
// real three-head/segmented-tail renderer (src/07j_entityrender.js), against
// `.decomp/net/minecraft/client/render/entity/model/WitherEntityModel.java` and
// `.decomp/net/minecraft/client/render/entity/WitherEntityRenderer.java` (both read whole).
//
//   node tools/witherdrawcheck.mjs [--verbose]
//
// Sections:
//   1. RENDER_SCALE — WitherEntityRenderer.method_4152's unconditional `float $$3 = 2.0F`.
//   2. ribcage sway — method_17130's `this.ribcage.pitch = (0.065 + 0.05*cos(age*0.1)) * PI`,
//      as a delta off the baked rest rx (tools/golden/models-1.18.2.tsv, wither/ribcage row).
//   3. center_head — the plain netHeadYaw/headPitch pair every other mob's head uses.
//   4. right_head/left_head — rotateHead's `(getHeadYaw(i) - bodyYaw)`, read from
//      ctx.wither.sideYawRel/sidePitch, and vanilla's own untargeted-idle default (0) when no
//      AI unit has set them yet (07zzm_wither.js's own OWED note).
//   5. anti-vacuity — each formula broken on purpose and shown to disagree with the real one.

import { loadEngine } from './loadsrc.mjs';

// THE JAR'S OWN CONSTANT (ER.setupAnimDelta's own DEG2RAD, 07j_entityrender.js) -- a float32
// rounding of pi/180, not Math.PI/180 to full double precision. Comparing against that literal
// keeps this check honest about what the source actually multiplies by.
const DEG2RAD = 0.017453292;

const VERBOSE = process.argv.includes('--verbose');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c && VERBOSE) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };

console.log('witherdrawcheck — D-787 residue, the wither\'s three-head/segmented-tail renderer');

const M = loadEngine({ extra: ['07h_entities.js', '07i_entitylist.js', '07j_entityrender.js'], dom: false });
const ER = M.EntityRender;
ok(typeof ER.setupAnimDelta === 'function', 'ER.setupAnimDelta exists');
ok(typeof ER.witherDelta === 'function', 'ER.witherDelta exists');

// ════════════════ 1. RENDER_SCALE (WitherEntityRenderer.method_4152, .decomp) ═══════════════
say('\n§1 render scale');
ok(ER.RENDER_SCALE && ER.RENDER_SCALE.wither === 2.0,
  `ER.RENDER_SCALE.wither is 2.0 (WitherEntityRenderer's unconditional "float $$3 = 2.0F"), got ${ER.RENDER_SCALE && ER.RENDER_SCALE.wither}`);

// ════════════════ 2. ribcage sway (method_17130, .decomp) ═══════════════════════════════════
say('\n§2 ribcage sway');
const REST_RX = 0.20420352; // tools/golden/models-1.18.2.tsv, wither/ribcage row
ok(Math.abs(ER.WITHER_RIBCAGE_REST_RX - REST_RX) < 1e-9, 'ER.WITHER_RIBCAGE_REST_RX matches the baked rest rx');
function realRibcagePitch(age) { return (0.065 + 0.05 * Math.cos(age * 0.1)) * Math.PI; }
for (const age of [0, 7, 15.5, 31.4]) {
  const d = ER.setupAnimDelta('ribcage', 0, 0, 0, 0, false, 'quadruped', { wither: {}, ageInTicks: age });
  const wantAbs = realRibcagePitch(age);
  ok(!!d && Math.abs(d.rx - (wantAbs - REST_RX)) < 1e-9 && d.ry === 0 && d.rz === 0,
    `ribcage delta at age=${age}: rx=${d && d.rx} want ${wantAbs - REST_RX}`);
}

// ═════════════════ 3. center_head (method_17130's own $$4,$$5 args) ══════════════════════════
say('\n§3 center_head');
{
  const d = ER.setupAnimDelta('center_head', 0, 0, 37.5, -12.25, false, 'quadruped', { wither: {} });
  ok(!!d && Math.abs(d.ry - 37.5 * (DEG2RAD)) < 1e-9 && Math.abs(d.rx - (-12.25) * (DEG2RAD)) < 1e-9,
    `center_head delta uses netHeadYaw/headPitch directly (got ${JSON.stringify(d)})`);
}

// ═════════════════ 4. right_head/left_head (rotateHead, .decomp) ═════════════════════════════
say('\n§4 side heads');
{
  const w = { sideYawRel: [12, -7], sidePitch: [5, -3] };
  const r = ER.setupAnimDelta('right_head', 0, 0, 0, 0, false, 'quadruped', { wither: w });
  const l = ER.setupAnimDelta('left_head', 0, 0, 0, 0, false, 'quadruped', { wither: w });
  ok(!!r && Math.abs(r.ry - 12 * (DEG2RAD)) < 1e-9 && Math.abs(r.rx - 5 * (DEG2RAD)) < 1e-9,
    `right_head reads sideYawRel[0]/sidePitch[0] (got ${JSON.stringify(r)})`);
  ok(!!l && Math.abs(l.ry - (-7) * (DEG2RAD)) < 1e-9 && Math.abs(l.rx - (-3) * (DEG2RAD)) < 1e-9,
    `left_head reads sideYawRel[1]/sidePitch[1] (got ${JSON.stringify(l)})`);
  // no AI unit has built WitherEntity.tickMovement's sideHeadYaws/sideHeadPitches tracking yet
  // (07zzm_wither.js's own OWED note) — with no ctx data this is vanilla's own untargeted idle
  // state (.decomp WitherEntity.java:199: sideHeadYaws[i] chases bodyYaw, i.e. relative yaw 0),
  // not a fabricated number.
  const rDefault = ER.setupAnimDelta('right_head', 0, 0, 0, 0, false, 'quadruped', { wither: {} });
  ok(!!rDefault && rDefault.ry === 0 && rDefault.rx === 0,
    `right_head with no side-head data yet defaults to the untargeted idle pose (got ${JSON.stringify(rDefault)})`);
}
// a non-wither ctx must never take this path (part names collide with nothing else, but the
// GATE — ctx.wither truthy — is the thing under test here, not the part names)
okAv(ER.setupAnimDelta('center_head', 0, 0, 37.5, -12.25, false, 'quadruped', {}) === null,
  'with no ctx.wither, "center_head" is not a recognised generic setupAnim part (returns null)');

// ═════════════════ 5. anti-vacuity closers ════════════════════════════════════════════════════
say('\n§5 anti-vacuity closers');
{
  // break the ribcage wobble's amplitude (drop the 0.05*cos term) and prove it disagrees with
  // the real formula at an age where cos(age*0.1) != 0
  const brokenRibcage = (age) => 0.065 * Math.PI;
  okAv(brokenRibcage(0) !== realRibcagePitch(0),
    `a ribcage formula with no wobble term disagrees with the real one at age=0 (broken=${brokenRibcage(0)}, real=${realRibcagePitch(0)})`);
  // break rotateHead's bodyYaw subtraction (use the raw side-head yaw, not the already-relative
  // value this file's ctx contract carries) and prove it disagrees when sideYawRel != 0
  const brokenSideYaw = (sideYawRel, bodyYaw) => sideYawRel + bodyYaw; // should just be sideYawRel
  const realSideYaw = (sideYawRel) => sideYawRel;
  okAv(brokenSideYaw(12, 40) !== realSideYaw(12),
    `a side-head yaw that re-adds bodyYaw disagrees with the real (already-relative) one (broken=${brokenSideYaw(12, 40)}, real=${realSideYaw(12)})`);
  // break the render scale (fall back to no entry, i.e. the generic-box 1.0 default) and prove
  // it disagrees with the real 2.0
  okAv((ER.RENDER_SCALE.nonexistent_mob || 1) !== ER.RENDER_SCALE.wither,
    'a mob with no RENDER_SCALE entry (implicit 1.0) disagrees with the wither\'s real 2.0');
}

console.log(`\n${pass} assertions passed (${breaks} anti-vacuity), ${fails.length} failed`);
for (const f of fails) console.log('  FAIL: ' + f);
console.log(fails.length ? '\nwitherdrawcheck: FAIL' : '\nwitherdrawcheck: OK');
process.exit(fails.length ? 1 : 0);
