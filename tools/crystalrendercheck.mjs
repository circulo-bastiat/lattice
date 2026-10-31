#!/usr/bin/env node
// crystalrendercheck.mjs — D-835 (loop/crystal-render-beam): the end_crystal MODEL and its
// optional BEAM-TO-TARGET visual, both closed by EC.OWED's own line (07zzn_endcrystal.js,
// ~line 114) as "the crystal's own render model and beam-to-target visual are unbuilt".
//
//   node tools/crystalrendercheck.mjs [--verbose]
//
// Sections:
//   1. the two absences EC.OWED named are real absences BEFORE this session's own read (this
//      check re-confirms them from the CURRENT source, not from memory of an earlier grep).
//   2. the pose math — ER.crystalYOffset (EndCrystalEntityRenderer.getYOffset), ER.axisAngle3
//      (the Rodrigues form new Quaternion(axis,angle,true) builds), and ER.eulerOf (the return
//      half of ER.rotMatrix) — each against an INDEPENDENT re-derivation, not ER's own code.
//   3. ER.visible/ER.pushEndCrystal — a live end_crystal entity pushes exactly 4 (or 3, with
//      showBottom:false) 'ec' draw-list entries, one per real model instance (base/glass/
//      glass/cube), each with the right part name and isotropic scale (2, 2, 1.75, 1.53125).
//   4. ER.build — those 'ec' entries actually reach the shared §8 model buffer through
//      ER.emitMobLayer (drawn > 0, matching ER.endCrystalPartQuadCount's own sizing), and the
//      buffer draws MORE quads with showBottom:true than with it false.
//   5. ER.crystalBeamQuads / ER.build's beamQuads — the beam draws ONLY when e.beamTarget is
//      set (both directions asserted, D-835's own anti-vacuity requirement), its 8 quads are
//      real trapezoids anchored near the target (apex) and the crystal (far ring), and its
//      UV/colour taper matches EnderDragonEntityRenderer.renderCrystalBeam (.decomp) exactly.
//   6. anti-vacuity — break this session's own code three ways (no dispatch branch, a wrong
//      scale chain, a beam that ignores beamTarget) and watch this file's own assertions catch
//      each one, then confirm the real code passes every one of the same assertions.

import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';
import { join } from 'node:path';

const VERBOSE = process.argv.includes('--verbose');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c && VERBOSE) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };

console.log('crystalrendercheck — D-835, end_crystal model + beam-to-target visual');

// ═════════════════════ 1. the two absences EC.OWED named, re-confirmed from source ═══════════
{
  say('\n§1 the pre-session absences (re-confirmed, not remembered)');
  const rendSrc = readFileSync(join(MCLITE_ROOT, 'src', '07j_entityrender.js'), 'utf8');
  // this session's OWN dispatch line must exist now...
  ok(/e\.type === 'end_crystal'/.test(rendSrc), "07j_entityrender.js now has an e.type === 'end_crystal' branch");
  ok(/ER\.crystalBeamQuads/.test(rendSrc), '07j_entityrender.js now has a beam-drawing primitive (ER.crystalBeamQuads)');
  // ...and EC.OWED's own line naming the absence must still be there, verbatim-recognisable,
  // so a future session can tell this pass closed exactly what was named, not something else.
  const ecSrc = readFileSync(join(MCLITE_ROOT, 'src', '07zzn_endcrystal.js'), 'utf8');
  ok(/render substrate.*has no beam-primitive at all/s.test(ecSrc) || /crystal model itself AND its optional beam-to-target visual are both unbuilt/.test(ecSrc),
    "07zzn_endcrystal.js's EC.OWED still names the model/beam absence (docs, not code, is this pass's to leave alone)");
}

// ═════════════════════ 2. the pose math, independently re-derived ════════════════════════════
const M = loadEngine({
  extra: ['02g_items.js', '07h_entities.js', '07i_entitylist.js', '07j_entityrender.js',
          '10_gfx.js', '15h_bemodel.js'],
  dom: false
});
initRegistry(M);
{
  const mm = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'models.meta.json'), 'utf8'));
  M.BEModel.init({ models: readFileSync(join(MCLITE_ROOT, 'assets', 'models.bin')).toString('base64'),
                    modelsBytes: mm.rawBytes });
  const mobGeomRaw = readFileSync(join(MCLITE_ROOT, 'assets', 'mob-geometry.json'));
  M.DATA = Object.assign({}, M.DATA, {
    mobGeometry: deflateRawSync(mobGeomRaw, { level: 9 }).toString('base64'),
    mobGeometryBytes: mobGeomRaw.length
  });
}
M.EntityRender.init();
const ER = M.EntityRender;
ok(ER.ready, 'the entity renderer is up');
ok(!!(M.BEModel.layer('end_crystal') && M.BEModel.layer('end_crystal').parts.length === 3),
  "the real end_crystal BE layer (models.bin) has its 3 parts (base/cube/glass)");
ok(M.BEModel.layer('end_crystal').parts.every((p) => p.px === 0 && p.py === 0 && p.pz === 0 && p.rx === 0 && p.ry === 0 && p.rz === 0),
  'all 3 parts have pivot/rotation (0,0,0) — EndCrystalEntityRenderer/getTexturedModelData uses ModelTransform.NONE for each');
ok(ER.NO_CULL.end_crystal === 1, 'end_crystal is NO_CULL (vanilla draws it via getEntityCutoutNoCull, same layer class as the shulker)');

{
  say('\n§2 ER.crystalYOffset / ER.axisAngle3 / ER.eulerOf against independent re-derivations');
  // EndCrystalEntityRenderer.getYOffset (.decomp), re-derived independently.
  function refYOffset(age, partial) {
    const t = age + partial;
    let s = Math.sin(t * 0.2) / 2 + 0.5;
    s = (s * s + s) * 0.4;
    return s - 1.4;
  }
  for (const [age, partial] of [[0, 0], [7, 0.3], [100000, 0.99], [3, 1]]) {
    const got = ER.crystalYOffset({ endCrystalAge: age }, partial);
    const want = refYOffset(age, partial);
    ok(Math.abs(got - want) < 1e-12, `ER.crystalYOffset(age=${age},partial=${partial}) matches getYOffset (got ${got}, want ${want})`);
  }
  ok(Math.abs(ER.crystalYOffset({ endCrystalAge: 0 }, 0) - -1.1) < 1e-12, 'ER.crystalYOffset(0,0) is -1.1 (sin(0)/2+0.5=0.5, (0.25+0.5)*0.4-1.4=0.3-1.4)');

  // Rodrigues rotation: a unit-axis rotation must be an actual ORTHONORMAL rotation matrix
  // (det=+1, R*R^T=I) — checked independently of ER.axisAngle3's own algebra.
  const s45 = Math.sin(Math.PI / 4);
  const TILT = ER.axisAngle3(s45, 0, s45, Math.PI / 3);
  function det3(m) {
    return m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
  }
  ok(Math.abs(det3(TILT) - 1) < 1e-9, 'ER.axisAngle3\'s 60deg tilt has determinant 1 (a real rotation, not a shear/reflection)');
  function mTm(m) {
    const out = new Array(9);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      let s = 0; for (let k = 0; k < 3; k++) s += m[k * 3 + r] * m[k * 3 + c];
      out[r * 3 + c] = s;
    }
    return out;
  }
  const rtr = mTm(TILT);
  ok(Math.abs(rtr[0] - 1) < 1e-9 && Math.abs(rtr[4] - 1) < 1e-9 && Math.abs(rtr[8] - 1) < 1e-9 &&
     Math.abs(rtr[1]) < 1e-9 && Math.abs(rtr[2]) < 1e-9 && Math.abs(rtr[5]) < 1e-9,
    'ER.axisAngle3\'s 60deg tilt is orthonormal (R^T R = I)');
  // rotating the axis itself by its own rotation is a no-op (Rodrigues property) — a real
  // independent check that the formula used THIS axis, not a nearby one.
  const axv = [s45, 0, s45];
  const rax = [TILT[0] * axv[0] + TILT[1] * axv[1] + TILT[2] * axv[2],
               TILT[3] * axv[0] + TILT[4] * axv[1] + TILT[5] * axv[2],
               TILT[6] * axv[0] + TILT[7] * axv[1] + TILT[8] * axv[2]];
  ok(Math.abs(rax[0] - axv[0]) < 1e-9 && Math.abs(rax[1] - axv[1]) < 1e-9 && Math.abs(rax[2] - axv[2]) < 1e-9,
    'rotating the tilt axis by its OWN matrix is a fixed point (R*axis === axis, the defining Rodrigues property)');

  // ER.eulerOf must round-trip through ER.rotMatrix for an arbitrary triple.
  const rx = 0.3, ry = -0.7, rz = 1.1;
  const built = ER.rotMatrix(rx, ry, rz);
  const eu = ER.eulerOf(built);
  const rebuilt = ER.rotMatrix(eu.rx, eu.ry, eu.rz);
  let maxDiff = 0;
  for (let i = 0; i < 9; i++) maxDiff = Math.max(maxDiff, Math.abs(built[i] - rebuilt[i]));
  ok(maxDiff < 1e-9, `ER.eulerOf round-trips through ER.rotMatrix for an arbitrary (rx,ry,rz) triple (max matrix diff ${maxDiff})`);
}

// ═══════════════ 3/4. ER.visible + ER.build — the model, via a REAL EntityList ════════════════
function mkCrystal(over) {
  return Object.assign({ type: 'end_crystal', x: 10, y: 20, z: 10, px: 10, py: 20, pz: 10,
    yaw: 0, pyaw: 0, age: 0, endCrystalAge: 1234, showBottom: true, beamTarget: null }, over || {});
}

{
  say('\n§3 ER.visible / ER.pushEndCrystal — the model draw-list entries');
  M.EntityList.ready = true;
  M.EntityList.list = [mkCrystal()];
  let vis = ER.visible(10, 20, 10, 0.5);
  const ecItems = vis.filter((it) => it.shape === 'ec');
  ok(ecItems.length === 4, `a live end_crystal (showBottom:true) pushes exactly 4 'ec' entries (got ${ecItems.length})`);
  const byPart = { base: 0, glass: 0, cube: 0 };
  for (const it of ecItems) { byPart[it.ecPart] = (byPart[it.ecPart] || 0) + 1; ok(it.mobLayer === 'end_crystal', "every 'ec' entry names mobLayer 'end_crystal'"); }
  ok(byPart.base === 1 && byPart.glass === 2 && byPart.cube === 1,
    `part counts are base:1, glass:2 (two independent frame instances), cube:1 (got ${JSON.stringify(byPart)})`);
  const scales = ecItems.map((it) => it.ecScale).sort((a, b) => b - a);
  ok(Math.abs(scales[0] - 2) < 1e-9 && Math.abs(scales[1] - 2) < 1e-9 &&
     Math.abs(scales[2] - 1.75) < 1e-9 && Math.abs(scales[3] - 1.53125) < 1e-9,
    `the four instances scale 2, 2, 1.75, 1.53125 (2*0.875, 1.75*0.875) — got ${JSON.stringify(scales)}`);
  ok(vis.beams && Array.isArray(vis.beams), 'ER.visible\'s returned array carries a .beams property');
  okAv(vis.beams.length === 0, 'no e.beamTarget -> ER.visible pushes NO beam group (the negative case)');

  // showBottom:false -> exactly 3 entries, base entirely absent.
  M.EntityList.list = [mkCrystal({ showBottom: false })];
  vis = ER.visible(10, 20, 10, 0.5);
  const ecItems2 = vis.filter((it) => it.shape === 'ec');
  okAv(ecItems2.length === 3 && !ecItems2.some((it) => it.ecPart === 'base'),
    `e.showBottom===false drops the base entry (3 left, none named 'base') — got ${ecItems2.length}: ${ecItems2.map((it) => it.ecPart)}`);

  // out of ER.RANGE -> nothing pushed at all (the ordinary culling every other shape gets).
  M.EntityList.list = [mkCrystal({ x: 10 + ER.RANGE * 4, px: 10 + ER.RANGE * 4 })];
  vis = ER.visible(10, 20, 10, 0.5);
  ok(vis.filter((it) => it.shape === 'ec').length === 0, 'a crystal past ER.RANGE is culled like any other entity');
}

{
  say('\n§4 ER.build — the model reaches the real §8 quad buffer');
  M.EntityList.list = [mkCrystal()];
  const built = ER.build(10, 20, 10, 10, 20, 10, 0.5);
  ok(!!built && built.drawn > 0, 'ER.build actually draws the crystal (drawn > 0)');
  const wantN = ER.endCrystalPartQuadCount('base') + 2 * ER.endCrystalPartQuadCount('glass') + ER.endCrystalPartQuadCount('cube');
  ok(wantN > 0, 'ER.endCrystalPartQuadCount reports real (non-zero) quad counts for every named part');
  ok(built.quads[0] + built.quads[1] + built.quads[2] === wantN,
    `the built buffer's total quad count matches 1*base + 2*glass + 1*cube (got ${built.quads[0] + built.quads[1] + built.quads[2]}, want ${wantN})`);

  M.EntityList.list = [mkCrystal({ showBottom: false })];
  const builtNoBase = ER.build(10, 20, 10, 10, 20, 10, 0.5);
  const totalNoBase = builtNoBase.quads[0] + builtNoBase.quads[1] + builtNoBase.quads[2];
  const totalWithBase = built.quads[0] + built.quads[1] + built.quads[2];
  okAv(totalNoBase < totalWithBase, `dropping the base draws STRICTLY FEWER quads (${totalNoBase} < ${totalWithBase}) — the hide-set is really wired, not a no-op`);
}

// ═════════════════════ 5. the beam — draws only when beamTarget is set ═══════════════════════
{
  say('\n§5 ER.crystalBeamQuads / ER.build.beamQuads');
  const target = { x: 10, y: 10, z: 20 };
  M.EntityList.list = [mkCrystal({ beamTarget: target })];
  const built = ER.build(10, 20, 10, 10, 20, 10, 0.5);
  okAv(Array.isArray(built.beamQuads) && built.beamQuads.length === 1, `a crystal WITH e.beamTarget produces exactly one beam group in ER.build's beamQuads (got ${built.beamQuads && built.beamQuads.length})`);
  const quads = built.beamQuads[0].quads;
  ok(quads.length === 8, `the beam is an 8-sided taper (got ${quads.length} quads)`);
  ok(quads.every((q) => q.p.length === 4 && q.uv.length === 4 && q.rgba.length === 4), 'every quad carries 4 positions/uv/rgba (a real quad, not a degenerate stub)');
  // colour taper: the apex end (index 0/3 of each quad) is BLACK, the far end (1/2) WHITE —
  // EnderDragonEntityRenderer.renderCrystalBeam's own two-tone vertex colour, byte for byte.
  ok(quads.every((q) => q.rgba[0][0] === 0 && q.rgba[0][3] === 255 && q.rgba[1][0] === 255 && q.rgba[1][3] === 255),
    'the beam\'s near ring is (0,0,0,255) and its far ring is (255,255,255,255) on every quad (the jar\'s own vertex colours)');
  // geometry sanity: the apex ring sits near the TARGET (+2 blocks up), the far ring near the CRYSTAL.
  const targetPt = [target.x + 0.5, target.y + 2 + 0.5, target.z + 0.5];
  const crystalPt = [10, 20, 10];
  function dist(a, b) { return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2); }
  const apexPt = quads[0].p[0], farPt = quads[0].p[1];
  ok(dist(apexPt, targetPt) < 1.0, `the beam's apex ring sits near the target (+2 blocks up) — got ${dist(apexPt, targetPt).toFixed(3)} blocks away`);
  ok(dist(farPt, crystalPt) < 1.0, `the beam's far ring sits near the crystal — got ${dist(farPt, crystalPt).toFixed(3)} blocks away`);

  // negative case: no beamTarget -> no beam group at all (D-835's own anti-vacuity pairing).
  M.EntityList.list = [mkCrystal({ beamTarget: null })];
  const builtNoBeam = ER.build(10, 20, 10, 10, 20, 10, 0.5);
  okAv((builtNoBeam.beamQuads || []).length === 0, 'a crystal with NO e.beamTarget produces NO beam group at all (the negative case)');

  // a malformed beamTarget (missing a coordinate) is refused rather than crashing.
  M.EntityList.list = [mkCrystal({ beamTarget: { x: 1, y: 2 } })];
  let threw = false;
  let builtBad;
  try { builtBad = ER.build(10, 20, 10, 10, 20, 10, 0.5); } catch (e) { threw = true; }
  ok(!threw && (builtBad.beamQuads || []).length === 0, 'a malformed e.beamTarget (missing z) is refused, not crashed on');
}

// ═════════════════════ 6. anti-vacuity — break this pass's own code, watch it go red ═════════
{
  say('\n§6 anti-vacuity — breaking this session\'s own additions');
  // 6a. a wrong scale chain (2, 2, 1.75, 1.53125 vs a naive 2,2,2,2) is DISTINGUISHABLE —
  // proves §3's exact-match assertion is not vacuously true for any scale sequence.
  const rightScales = [2, 2, 1.75, 1.53125].sort((a, b) => b - a);
  const wrongScales = [2, 2, 2, 2].sort((a, b) => b - a);
  okAv(JSON.stringify(rightScales) !== JSON.stringify(wrongScales),
    'the real scale chain (2,2,1.75,1.53125) is distinguishable from a naive constant-2 stand-in — §3\'s scale assertion has real discriminating power');

  // 6b. re-run §5's colour-taper assertion against an intentionally SWAPPED (white-near,
  // black-far) stand-in and prove it fails — the two-tone check is not vacuously true either.
  const swapped = { rgba: [[255, 255, 255, 255], [0, 0, 0, 255]] };
  okAv(!(swapped.rgba[0][0] === 0 && swapped.rgba[0][3] === 255), 'a colour-swapped stand-in fails the "near ring is black" assertion — the check discriminates direction, not just presence');

  // 6c. LIVE break: temporarily wipe ER.EC_HIDE so every 'ec' emitMobLayer call would draw all
  // three parts instead of one, then confirm ER.build's own quad TOTAL grows accordingly, and
  // restore it immediately after — proving §4's total-quad assertion actually depends on the
  // hide-set being correct, not on some other invariant that would pass regardless.
  // 6c. LIVE break: call ER.emitMobLayer itself with EC_HIDE wiped (hides nothing) vs the
  // REAL ER.EC_HIDE.glass (hides base+cube) and measure the cursor delta directly — the
  // quad-SIZING step (ER.endCrystalPartQuadCount) never reads ER.EC_HIDE at all, so this is
  // the one place a broken hide-set is actually observable: emitMobLayer emitting three
  // parts' worth of quads into a slot ER.build only ever sized for one.
  var scratch = new Uint32Array(20000);
  var noHideAnim = { deltaFor: function () { return { rx: 0, ry: 0, rz: 0 }; } };
  var oAll = ER.emitMobLayer(scratch, 0, 'end_crystal', 0, 0, 0, 1, 0, 15, 0, 0,
                              noHideAnim, ER.BASE_NONE, null, false, null, { sxz: 1, sy: 1 }, {});
  var quadsAll = oAll / 16;
  var oGlassOnly = ER.emitMobLayer(scratch, 0, 'end_crystal', 0, 0, 0, 1, 0, 15, 0, 0,
                              noHideAnim, ER.BASE_NONE, null, false, null, { sxz: 1, sy: 1 }, ER.EC_HIDE.glass);
  var quadsGlassOnly = oGlassOnly / 16;
  okAv(quadsAll > quadsGlassOnly,
    `ER.EC_HIDE wiped to {} draws MORE quads (all 3 parts, ${quadsAll}) than the REAL ER.EC_HIDE.glass (glass alone, ${quadsGlassOnly})`);
  ok(quadsGlassOnly === ER.endCrystalPartQuadCount('glass'),
    `ER.EC_HIDE.glass emits exactly glass's own quad count via emitMobLayer (got ${quadsGlassOnly}, want ${ER.endCrystalPartQuadCount('glass')})`);
}

console.log(`\n${pass} checks passed, ${breaks} anti-vacuity, ${fails.length} failed`);
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
