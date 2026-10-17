#!/usr/bin/env node
// mobboxcheck.mjs — PASS 15 JOB 4.3. The world-space mob box renderer: geometry only.
//
//   node tools/mobboxcheck.mjs [--verbose]
//
// ⚠ WHAT THIS EXISTS TO CATCH, AND WHAT IT DOES NOT. JOB 4.3 is `ER.emitMobLayer`/
// `ER.buildMobLayer`/`ER.mobWorstCoord` in `src/07j_entityrender.js`: posing `BE.layers`'
// boxes (D-317, the same table `bemodelcheck` already holds to the jar) as §8 model-stream
// quads, one part at a time, at REST angles — no `setupAnim` (JOB 4.4, not built) and no mob
// texture wired into the GPU atlas (JOB 4.2 packed `mob-tex.bin` but did not wire it in). This
// file proves the GEOMETRY a static posed mob would draw: quad counts agree with the source,
// every quad's winding is CCW as the GPU pipeline requires (the same rule `emitcheck` holds the
// mesher's own writer to, D-133/D-314), a box's own pivot and rotation are both honoured (not
// merged into one rigid mesh), and the ±128-block wrap limit `git 2a8efe1:docs/passes/PASS-15-HISTORY.md` names by name never
// gets spent. It does NOT put a mob on a real screen — there is no browser stage here, no pixel
// is asserted, and no entity type calls any of this yet (`EntityList` spawns no mob; G18c is
// not built). That bar is the one all of JOB 4 (4.1–4.4) is graded against together, not this
// file alone — see `git 2a8efe1:docs/passes/PASS-16-HISTORY.md`'s own account of what is and is not done.

import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

const VERBOSE = process.argv.includes('--verbose');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { ok(c, m); if (c) console.log('   ✓ ' + m.replace(/^anti-vacuity: /, '')); };
const say = (s) => { if (VERBOSE) console.log('   ' + s); };

console.log('mobboxcheck — PASS 15 JOB 4.3, the world-space mob box renderer (D-317)');

const M = loadEngine({
  extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
          '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js'],
  dom: false
});
initRegistry(M);
{
  const mm = JSON.parse(readFileSync(MCLITE_ROOT + 'assets/models.meta.json', 'utf8'));
  M.BEModel.init({ models: readFileSync(MCLITE_ROOT + 'assets/models.bin').toString('base64'),
                    modelsBytes: mm.rawBytes });
}
M.Entities.init();
M.EntityList.init();
M.EntityRender.init();

const ER = M.EntityRender, BE = M.BEModel, CFG = M.CFG;
ok(ER.ready, 'the entity renderer is up');
ok(BE.ready, 'the mob/block-entity model payload decodes');
ok(typeof ER.emitMobLayer === 'function', 'ER.emitMobLayer exists');
ok(typeof ER.buildMobLayer === 'function', 'ER.buildMobLayer exists');
ok(typeof ER.mobWorstCoord === 'function', 'ER.mobWorstCoord exists');
ok(typeof BE.poseBoxCorners === 'function', '15h_bemodel.js exported poseBoxCorners for reuse (D-314)');

// PASS 16 JOB 4.2's own ground truth, read a SECOND time here, independent of `ER.mobGeomFor`'s
// parsed copy (`NS.DATA.mobGeometry`, deflated and re-embedded by `gen-data.mjs`) -- the same
// shape `mobtexcheck.mjs` already insists on for the packing half: never trust the pipeline's
// own arithmetic to grade itself, re-derive from the file it was supposed to produce.
const mobGeomRaw = readFileSync(MCLITE_ROOT + 'assets/mob-geometry.json');
const mobGeomGround = JSON.parse(mobGeomRaw.toString('utf8'));
// This Node harness never loads the real `19_data.gen.js` (it is generated, huge, and this
// file already carries its own `assets/models.bin` load a few lines up) -- so `NS.DATA` has
// no `mobGeometry` unless supplied here, the SAME base64(deflateRaw(...)) shape
// `tools/gen-data.mjs` itself writes, so `ER.mobGeomFor`'s `NS.Z.unpack` path is exercised for
// real rather than skipped.
M.DATA = Object.assign({}, M.DATA, {
  mobGeometry: deflateRawSync(mobGeomRaw, { level: 9 }).toString('base64'),
  mobGeometryBytes: mobGeomRaw.length
});
function groundSlices(name, k, f) {
  const L = mobGeomGround.layers[name];
  const s = L && L[k] && L[k][f];
  return (s && s.length) ? s : null;
}
function expectedQuadCount(name) {
  const L = BE.layer(name);
  if (!L) return 0;
  let n = 0;
  const dh = (M.EntityRender.DEFAULT_HIDDEN || {})[name];   // #211, exact layer like the engine (#2007: piglin #b/#c armour keeps its hat): the player's ear/cloak are never drawn
  for (let k = 0; k < L.parts.length; k++) {
    if (dh && dh[L.parts[k].n]) continue;
    for (let f = 0; f < 6; f++) {
      const s = groundSlices(name, k, f);
      n += (s ? s.length : 1) * (name === 'ender_dragon' && L.parts[k].n === 'neck' ? 17 : 1);   // #1848: neck drawn 17 times
    }
  }
  return n;
}

const layerNames = Object.keys(BE.layers).filter((n) => BE.layer(n) && BE.layer(n).parts && BE.layer(n).parts.length);
ok(layerNames.length > 100, `only ${layerNames.length} usable layers — the payload looks wrong`);
say(`${layerNames.length} layers with real geometry`);
ok(!!mobGeomGround.layers && Object.keys(mobGeomGround.layers).length > 80,
   `assets/mob-geometry.json carries only ${mobGeomGround.layers ? Object.keys(mobGeomGround.layers).length : 0} textured layers — expected ~90`);

// ═══════════════ 1. quad count matches an INDEPENDENT recount, for every layer ═════════════
console.log('\n 1. every layer\'s quad count matches its own face-slice table (PASS 16 JOB 4.2)');
{
  let bad = 0, totalQuads = 0, slicedFaces = 0;
  for (const name of layerNames) {
    // ER.NO_CULL (the shulker's getEntityCutoutNoCullZOffset) draws every quad twice, by rule
    const want = expectedQuadCount(name) * ((ER.NO_CULL && ER.NO_CULL[String(name).split('#')[0]]) ? 2 : 1);
    const got = ER.mobQuadCount(name);
    if (got !== want) bad++;
    totalQuads += got;
    const L = BE.layer(name);
    for (let k = 0; k < L.parts.length; k++) {
      for (let f = 0; f < 6; f++) {
        const s = groundSlices(name, k, f);
        if (s && s.length > 1) slicedFaces++;
      }
    }
  }
  ok(bad === 0, `${bad} layers whose live ER.mobQuadCount disagrees with an INDEPENDENT recount from assets/mob-geometry.json`);
  say(`${totalQuads.toLocaleString()} quads across ${layerNames.length} layers, ${slicedFaces} faces multi-sliced`);

  // ⚠⚠ ANTI-VACUITY -- PASS 15's old assumption ("6 quads per box, always") is provably WRONG
  // now that a face can be sliced into more than one atlas crop (D-376's packing, played on mob
  // box faces): at least one real, shipped layer must need a DIFFERENT total than that old
  // formula, or this section is only re-deriving a number that never actually diverges from it.
  let divergentFromOld = 0;
  for (const name of layerNames) {
    const L = BE.layer(name);
    if (L && ER.mobQuadCount(name) !== L.parts.length * 6) divergentFromOld++;
  }
  okAv(divergentFromOld > 0,
       `anti-vacuity: ${divergentFromOld} layers need a quad count the OLD "6 per box" formula gets wrong — the slice-aware recount is doing real work`);
}

// ═══════════════ 2. creeper and pig, by name (git 2a8efe1:docs/passes/PASS-15-HISTORY.md's own anchors) ════════════════════
console.log('\n 2. the two anchors git 2a8efe1:docs/passes/PASS-15-HISTORY.md names — creeper and pig — draw real geometry');
{
  for (const name of ['creeper', 'pig']) {
    const L = BE.layer(name);
    ok(!!L && L.parts.length > 0, `${name} layer exists with boxes (${L ? L.parts.length : 0})`);
    const n = ER.mobQuadCount(name);
    const buf = ER.buildMobLayer(name, 10, 70, 10, 0, 10, 70, 10, 15, 0, 3, 0);
    ok(buf !== null && buf.quads === n, `${name}: buildMobLayer emits ${n} quads`);
  }
}

// ═══════════════ 3. every quad, of every layer, winds the way the GPU pipeline needs ═══════
console.log('\n 3. winding is CCW-as-seen-from-outside for every emitted quad (D-133/D-314)');
{
  // ⚠ THIS IS THE SAME QUESTION emitcheck.mjs ASKS OF THE MESHER'S WRITER: derive the normal
  // from the winding the GPU will actually see and require it to agree with the face's own
  // declared direction, not merely that the four corners are the right four corners — an
  // inside-out quad has exactly the same corners as a right-way-out one.
  const NRM = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  let windBad = 0, totalWound = 0;
  const yaws = [0, 0.7, Math.PI * 0.5, Math.PI + 0.3, -1.1];
  for (const name of layerNames) {
    const n = ER.mobQuadCount(name);
    if (!n) continue;
    const L = BE.layer(name);
    const yaw = yaws[layerNames.indexOf(name) % yaws.length];
    const out = new Uint32Array(n * 16);
    ER.emitMobLayer(out, 0, name, 0, 0, 0, Math.cos(yaw), Math.sin(yaw), 15, 0, 3);
    // ⚠ PASS 16 JOB 4.2: a part no longer costs a FIXED 6 quads (a sliced face can cost more),
    // so "q % 6" no longer recovers which local face quad `q` belongs to. Walk the SAME
    // (part, face, slice) order `emitMobLayer` itself writes in — k ascending, f 0..5, then one
    // quad per slice (or exactly one fallback quad when a face has no slice table) — using the
    // INDEPENDENT `assets/mob-geometry.json` read (`groundSlices`), not the code under test.
    const partOf = new Array(n), faceOf = new Array(n);
    { let qi = 0;
      for (let k = 0; k < L.parts.length; k++) {
        for (let f = 0; f < 6; f++) {
          const s = groundSlices(name, k, f);
          const cnt = (s ? s.length : 1) * (name === 'ender_dragon' && L.parts[k].n === 'neck' ? 17 : 1);   // #1848: the neck is drawn 17 times
          
          // ER.NO_CULL layers (the shulker, getEntityCutoutNoCullZOffset) write each slice
          // twice: the quad, then its reversed back — same part, same box face, flipped bucket.
          const reps = (ER.NO_CULL && ER.NO_CULL[String(name).split('#')[0]]) ? 2 : 1;
          for (let i = 0; i < cnt * reps && qi < n; i++) { partOf[qi] = k; faceOf[qi] = f; qi++; }
        }
      }
    }
    for (let q = 0; q < n; q++) {
      // ⚠ A BOX WITH ONE DIMENSION ZERO (a flat "fin"/"gill" — axolotl's are real examples)
      // has TWO genuinely zero-area faces, and integer rounding of a near-zero cross product
      // is NOISE, not a winding answer — the fix is to know it is degenerate from the SOURCE
      // GEOMETRY (which pair of dimensions spans this face) rather than from how small the
      // rounded result happens to come out, which is exactly the flaw the `len < 1e-6` guard
      // alone had: a "zero" width can round to a 1-unit sliver whose cross product is neither
      // near zero nor meaningfully directed.
      const part = L.parts[partOf[q]];
      const localFace = faceOf[q];
      // #2058: a grown (g) box stores w/h/d + 2g, so the source size is the stored size less the growth
      const g2 = 2 * (part.g || 0), sw = part.w - g2, sh = part.h - g2, sd = part.d - g2;
      const faceDegenerate = localFace < 2 ? sh * sd === 0
                            : localFace < 4 ? sw * sd === 0
                            : sw * sh === 0;
      const o = q * 16;
      const P = [];
      for (let c = 0; c < 4; c++) {
        const vt = M.Mesher.unpackModelVertex(out[o + c * 4], out[o + c * 4 + 1], out[o + c * 4 + 2], out[o + c * 4 + 3]);
        P.push([vt.px, vt.py, vt.pz]);
        if (c === 0) var face = vt.face;
      }
      if (faceDegenerate) continue; // a genuinely zero-area face — nothing for a GPU to cull
      const ux = P[1][0]-P[0][0], uy = P[1][1]-P[0][1], uz = P[1][2]-P[0][2];
      const vx = P[2][0]-P[0][0], vy = P[2][1]-P[0][1], vz = P[2][2]-P[0][2];
      const nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-6) continue; // a degenerate (zero-area) box edge — not a testable quad
      // ⚠ `vt.face` IS ALREADY THE WORLD-BUCKETED LABEL `emitMobLayer` computes (yaw and the
      // part's own rotation both folded in) — NOT the box's local, pre-pose axis. Rotating
      // `NRM[face]` by `yaw` again here would rotate an already-world vector a second time,
      // which is exactly backwards and was this section's own first bug (found by running it).
      const n0 = NRM[face];
      const dot = (nx * n0[0] + ny * n0[1] + nz * n0[2]) / len;
      totalWound++;
      if (!(dot > 0.05)) windBad++;
    }
  }
  ok(windBad === 0, `${windBad} of ${totalWound} mob-box quads are wound INSIDE OUT — backface-culled and invisible`);
  ok(totalWound > 5000, `only ${totalWound} quads had a testable winding — the scan found too little geometry`);
  say(`${totalWound.toLocaleString()} quads wound correctly across ${layerNames.length} layers`);

  // ⚠ NO SHIPPED LAYER HAS A MIRRORED BOX (verified: 0 of 1102 parts carry `m`) -- the only
  // family that would (a player's arms) is one of the two layers git 2a8efe1:docs/passes/PASS-15-HISTORY.md
  // records as a PINNED negative control, deliberately kept empty. So the mirror path
  // (`BE.faceRects`'s own west/east swap) is exercised synthetically here rather than skipped:
  // a hand-built box with `m: 1` must swap its -X/+X UV rectangles against the same box with
  // `m: 0`, which is the one thing `p.m` is documented to do.
  {
    const base = { x: 0, y: 0, z: 0, w: 4, h: 4, d: 4, tu: 0, tv: 0 };
    const rNorm = BE.faceRects(Object.assign({}, base, { m: 0 }));
    const rMirr = BE.faceRects(Object.assign({}, base, { m: 1 }));
    const sameEastWest = JSON.stringify(rNorm[0]) === JSON.stringify(rMirr[1]) &&
                          JSON.stringify(rNorm[1]) === JSON.stringify(rMirr[0]);
    ok(sameEastWest, 'BE.faceRects swaps the +X/-X (east/west) UV rectangles when m=1, the way a mirrored box must');
    const otherFacesUnchanged = [2, 3, 4, 5].every((i) => JSON.stringify(rNorm[i]) === JSON.stringify(rMirr[i]));
    ok(otherFacesUnchanged, 'mirroring leaves the other four faces\' UV rectangles alone');
  }

  // ⚠⚠ ANTI-VACUITY #1 — THE UNCORRECTED ORDER WOULD FAIL THIS, OFTEN. This is `emitcheck`'s
  // own `srcInverted` idea applied here: run the SAME real corner math (`BE.poseBoxCorners`,
  // `MOB_FACE_CORNERS`) but WITHOUT the winding self-correction `emitMobLayer` applies, and
  // show that a meaningful fraction of real boxes come out wound backward. If this number were
  // ever zero, the correction in the real function would be dead code and this whole section
  // would be proving nothing.
  let uncorrectedBad = 0, uncorrectedTotal = 0;
  const FACE_CORNERS = [[1,5,7,3],[4,0,2,6],[2,3,7,6],[4,5,1,0],[5,4,6,7],[0,1,3,2]];
  const SCALE = CFG.MODEL_UNITS_PER_BLOCK / 16;
  for (const name of layerNames.slice(0, 40)) {
    const L = BE.layer(name);
    for (const p of L.parts) {
      const c8 = new Float64Array(24);
      BE.poseBoxCorners(p, c8);
      for (let f = 0; f < 6; f++) {
        const idx = FACE_CORNERS[f];
        const P = idx.map((ci) => [c8[ci*3]*SCALE, c8[ci*3+1]*SCALE, c8[ci*3+2]*SCALE]);
        const ux2 = P[1][0]-P[0][0], uy2 = P[1][1]-P[0][1], uz2 = P[1][2]-P[0][2];
        const vx2 = P[2][0]-P[0][0], vy2 = P[2][1]-P[0][1], vz2 = P[2][2]-P[0][2];
        const nx2 = uy2*vz2-uz2*vy2, ny2 = uz2*vx2-ux2*vz2, nz2 = ux2*vy2-uy2*vx2;
        const len2 = Math.hypot(nx2, ny2, nz2);
        if (len2 < 1e-6) continue;
        const n0 = NRM[f];
        const dot2 = (nx2*n0[0] + ny2*n0[1] + nz2*n0[2]) / len2;
        uncorrectedTotal++;
        if (!(dot2 > 0.05)) uncorrectedBad++;
      }
    }
  }
  okAv(uncorrectedBad > uncorrectedTotal * 0.2,
       `anti-vacuity: without the correction, ${uncorrectedBad}/${uncorrectedTotal} boxes wind backward — the self-correction in emitMobLayer is doing real work`);
}

// ═══════════════ 4. per-part pose: a box's own pivot/rotation is honoured, not discarded ═══
console.log('\n 4. each part keeps its OWN pivot and rotation (a hierarchy, not one rigid mesh)');
{
  // pick a layer with at least two parts at different pivots — almost all of them qualify
  const name = BE.layer('pig') ? 'pig' : layerNames[0];
  const L = BE.layer(name);
  ok(L.parts.length >= 2, `${name} has at least two parts to distinguish`);
  const n = ER.mobQuadCount(name);
  const out = new Uint32Array(n * 16);
  ER.emitMobLayer(out, 0, name, 0, 0, 0, 1, 0, 15, 0, 3);
  // the centroid of each part's 6 quads (24 verts) must differ from the box's SIBLING part's
  // centroid by roughly the pivot difference the source table itself carries — proving the
  // pivot was actually applied per box, not one shared offset for the whole layer.
  let qOff = 0;
  const centroids = [];
  for (const p of L.parts) {
    let sx = 0, sy = 0, sz = 0, cnt = 0;
    for (let q = 0; q < 6; q++) {
      for (let c = 0; c < 4; c++) {
        const o = (qOff + q) * 16 + c * 4;
        const vt = M.Mesher.unpackModelVertex(out[o], out[o+1], out[o+2], out[o+3]);
        sx += vt.px; sy += vt.py; sz += vt.pz; cnt++;
      }
    }
    centroids.push([sx / cnt, sy / cnt, sz / cnt]);
    qOff += 6;
  }
  let distinctPairs = 0, totalPairs = 0;
  for (let i = 0; i < centroids.length; i++) {
    for (let j = i + 1; j < centroids.length; j++) {
      totalPairs++;
      const dx = centroids[i][0]-centroids[j][0], dy = centroids[i][1]-centroids[j][1], dz = centroids[i][2]-centroids[j][2];
      if (Math.hypot(dx, dy, dz) > 32) distinctPairs++; // 32 fixed-point units = 1/8 block, a generous floor
    }
  }
  ok(distinctPairs > totalPairs * 0.5,
     `${name}: only ${distinctPairs}/${totalPairs} part-pairs sit at visibly different centroids — the per-part pivot looks collapsed to one offset`);

  // anti-vacuity #2 — pig's own four legs are the cleanest case: identical `x/y/z/w/h/d/rx`,
  // differing ONLY in `px`/`py`/`pz` (checked, not assumed, below) — so a renderer that dropped
  // the per-part PIVOT specifically (as opposed to ignoring the pose altogether) would draw all
  // four at the exact same spot, and one that kept it draws four distinct legs. This is a
  // narrower, fully-determined version of the assertion above rather than a second guess at it.
  const legs = L.parts.filter((p) => /_leg$/.test(p.n || ''));
  ok(legs.length === 4, `pig has 4 leg parts, found ${legs.length}`);
  const sameShape = legs.every((p) => ['x','y','z','w','h','d','rx','ry','rz'].every((k) => p[k] === legs[0][k]));
  ok(sameShape, "pig's 4 legs share the same box shape and rotation, differing only in pivot");
  const c8c = new Float64Array(24);
  const legCentroid = (p) => {
    BE.poseBoxCorners(p, c8c);
    let sx = 0, sy = 0, sz = 0;
    for (let i = 0; i < 8; i++) { sx += c8c[i * 3]; sy += c8c[i * 3 + 1]; sz += c8c[i * 3 + 2]; }
    return [sx / 8, sy / 8, sz / 8];
  };
  const realLegCentroids = legs.map(legCentroid);
  const dist = (a, b) => Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]);
  let realLegPairs = 0, realLegDistinct = 0;
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
    realLegPairs++;
    if (dist(realLegCentroids[i], realLegCentroids[j]) > 2) realLegDistinct++;
  }
  ok(realLegDistinct === realLegPairs, `all ${realLegPairs} real leg pairs are at distinct centroids (pivot honoured)`);

  const collapsedLegs = legs.map((p) => Object.assign({}, p, { px: legs[0].px, py: legs[0].py, pz: legs[0].pz }));
  const collapsedLegCentroids = collapsedLegs.map(legCentroid);
  let collapsedLegDistinct = 0;
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
    if (dist(collapsedLegCentroids[i], collapsedLegCentroids[j]) > 2) collapsedLegDistinct++;
  }
  okAv(collapsedLegDistinct === 0,
       `anti-vacuity: share one pivot across pig's 4 legs and all ${realLegPairs} pairs collapse to the same spot ` +
       `(was ${realLegDistinct}/${realLegPairs} distinct) — losing the per-part pivot is exactly what the real assertion above catches`);
}

// ═══════════════ 5. the ±128-block wrap limit git 2a8efe1:docs/passes/PASS-15-HISTORY.md names by name ═════════════════════
console.log('\n 5. no layer, at ER.RANGE, pushes a vertex past the i16 wrap point');
{
  const I16_MAX = 32767;
  let worstAny = 0, worstName = '';
  let over = 0;
  for (const name of layerNames) {
    const w = ER.mobWorstCoord(name);
    if (w > worstAny) { worstAny = w; worstName = name; }
    if (w >= I16_MAX) over++;
  }
  ok(over === 0, `${over} layers can reach or pass the i16 wrap point (32767) at ER.RANGE=${ER.RANGE}`);
  ok(worstAny > 0 && worstAny < I16_MAX,
     `worst real coordinate across all layers is ${worstAny.toFixed(0)} (layer '${worstName}'), under the ${I16_MAX} ceiling`);
  say(`worst layer: ${worstName} reaches ${worstAny.toFixed(0)} of ${I16_MAX} at ER.RANGE=${ER.RANGE} blocks`);

  // ⚠⚠ ANTI-VACUITY #3 — INFLATE ER.RANGE PAST THE FORMAT'S OWN LIMIT AND WATCH IT TRIP.
  // 200 blocks is past the format's hard ±128-block ceiling on its own, before any box size is
  // even added, so every layer must now read as over — proving `mobWorstCoord` actually reads
  // the LIVE `ER.RANGE` rather than a baked-in constant, and that the comparison above is not
  // vacuously true no matter what ER.RANGE is set to.
  const savedRange = ER.RANGE;
  ER.RANGE = 200;
  let overAtBadRange = 0;
  for (const name of layerNames) if (ER.mobWorstCoord(name) >= I16_MAX) overAtBadRange++;
  ER.RANGE = savedRange;
  okAv(overAtBadRange === layerNames.length,
       `anti-vacuity: at ER.RANGE=200 (past the format's own ±128-block ceiling) all ${layerNames.length} layers read as over — restored to ${ER.RANGE}`);
  ok(ER.RANGE === savedRange, 'ER.RANGE was restored after the anti-vacuity mutation');

  // ⚠⚠ ANTI-VACUITY #4 — A LAYER WITH AN OVERSIZED BOX, AT THE REAL RANGE. Not every overflow
  // is a bad ER.RANGE; a single freak box should trip it too, at the real, unmodified range.
  const fakeLayer = { parts: [{ x: -4000, y: 0, z: -4000, w: 8000, h: 8000, d: 8000,
                                 rx: 0, ry: 0, rz: 0, px: 0, py: 0, pz: 0, tu: 0, tv: 0 }] };
  BE.layers.__mobboxcheck_fake = fakeLayer;
  const fakeWorst = ER.mobWorstCoord('__mobboxcheck_fake');
  delete BE.layers.__mobboxcheck_fake;
  okAv(fakeWorst >= I16_MAX,
       `anti-vacuity: an 8000-unit box (500 blocks) reads as over the wrap point at the real ER.RANGE=${ER.RANGE} (${fakeWorst.toFixed(0)})`);
}

// ═══════════════ 6. PASS 16 JOB 4.2's RENDER half: sliced faces draw the right crop, posed ═══
console.log('\n 6. sliced mob faces pose the right sub-box and stamp the right atlas crop (JOB 4.2)');
{
  // Independent of `ER.emitMobLayer`'s own internals: this re-derives, from
  // `assets/mob-geometry.json` (ground truth, not `ER.mobGeomFor`'s parsed copy) plus the SAME
  // public `BE.poseBoxCorners` JOB 4.3 already exported for reuse, what each slice's world
  // sub-box and atlas UV OUGHT to be — trimming a box's own `ARCH_AXES`/`SIZE_KEY` axes the
  // way `tools/pack-mobtex.mjs`'s own packing loop documents (a second, independent copy of
  // that table, not `07j_entityrender.js`'s) — then reads the ACTUAL emitted vertices back and
  // compares. The same shape `mobtexcheck.mjs` uses to cross-check the packing half, one level
  // further down the pipeline: posed, not baked, and — per `anim` below — not just at rest.
  const ARCH_AXES_ = [['z', 'y'], ['z', 'y'], ['x', 'z'], ['x', 'z'], ['x', 'y'], ['x', 'y']];
  const SIZE_KEY_ = { x: 'w', y: 'h', z: 'd' };
  const MOB_FACE_CORNERS_ = [[1, 5, 7, 3], [4, 0, 2, 6], [2, 3, 7, 6], [4, 5, 1, 0], [5, 4, 6, 7], [0, 1, 3, 2]];
  const ANIMS = [
    { label: 'rest', anim: null },
    { label: 'posed', anim: { limbSwing: 1.1, limbSwingAmount: 0.6, netHeadYaw: 12, headPitch: -8, riding: false } }
  ];
  const anchors = ['creeper', 'pig', 'silverfish', 'endermite', 'wither', 'zombie', 'cow', 'skeleton']
    .filter((n) => BE.layer(n) && mobGeomGround.layers[n]);
  ok(anchors.length === 8, `only ${anchors.length}/8 of mobtexcheck.mjs's own G18a anchor layers resolve here`);

  let slicesChecked = 0, posBad = 0, uvBad = 0;
  const restCentroid = {}, posedCentroid = {};
  for (const name of anchors) {
    const L = BE.layer(name);
    const geom = mobGeomGround.layers[name];
    for (const { label, anim } of ANIMS) {
      const n = ER.mobQuadCount(name);
      const out = new Uint32Array(n * 16);
      ER.emitMobLayer(out, 0, name, 0, 0, 0, 1, 0, 15, 0, 3, anim || undefined);
      let qi = 0;
      for (let k = 0; k < L.parts.length; k++) {
        var p = L.parts[k];
        if (anim) {
          // #1533: the engine's own part delta (kind/ctx and pivot shifts included -- the silverfish and
          // endermite wiggle moves pivotX); the independent half of this check is the sub-box maths below
          p = ER.posedPart(p, anim, name);
        }
        for (let f = 0; f < 6; f++) {
          const slices = geom[k] && geom[k][f];
          const cnt = (slices && slices.length) ? slices.length : 0;
          if (!cnt) { qi++; continue; }   // fallback whole-face quad — sections 1/3 already cover it
          for (let si = 0; si < cnt; si++) {
            const s = slices[si];
            slicesChecked++;
            const uAxis = ARCH_AXES_[f][0], vAxis = ARCH_AXES_[f][1];
            const subP = Object.assign({}, p);
            // D-773 (beautiful-allen-7isws6): ModelPart.Cuboid's own texture run per face
            // (u: +z -z +x +x -x +x, reversed on a mirrored box; v: +y +y -z -z +y +y) --
            // an independent copy of BE.faceDir, typed off .decomp, not read from it.
            const du = (p.m ? -1 : 1) * [1, -1, 1, 1, -1, 1][f], dv = [1, 1, -1, -1, 1, 1][f];
            // #633/#1533: slices count texels of the UN-grown box, a dilated (g > 0) box stretches them over its grown size
            const g2 = 2 * (p.g || 0), ku = p[SIZE_KEY_[uAxis]] / (p[SIZE_KEY_[uAxis]] - g2), kv = p[SIZE_KEY_[vAxis]] / (p[SIZE_KEY_[vAxis]] - g2 - (vAxis === 'y' ? 2 * (p.gy || 0) : 0));
            subP[uAxis] = du > 0 ? p[uAxis] + s.u0 * ku : p[uAxis] + p[SIZE_KEY_[uAxis]] - (s.u0 + s.w) * ku; subP[SIZE_KEY_[uAxis]] = s.w * ku;
            subP[vAxis] = dv > 0 ? p[vAxis] + s.v0 * kv : p[vAxis] + p[SIZE_KEY_[vAxis]] - (s.v0 + s.h) * kv; subP[SIZE_KEY_[vAxis]] = s.h * kv;
            const c8x = new Float64Array(24);
            BE.poseBoxCorners(subP, c8x);
            const SCALE = CFG.MODEL_UNITS_PER_BLOCK / 16;
            const exMin = [Infinity, Infinity, Infinity], exMax = [-Infinity, -Infinity, -Infinity];
            let cx = 0, cy = 0, cz = 0;
            // ⚠ ONLY THE 4 CORNERS OF FACE `f` — `MOB_FACE_CORNERS`'s own selection
            // (`07j_entityrender.js`, duplicated here since this file is a Node check and that
            // one loads in the browser). All 8 corners of `subP` would bound its FULL
            // thickness on the axis perpendicular to this face, which is exactly one slice
            // wider than the quad itself on that axis whenever the box has real depth there —
            // this was this section's own first bug, found by running it.
            for (const ci8 of MOB_FACE_CORNERS_[f]) {
              const vx = c8x[ci8 * 3] * SCALE, vy = c8x[ci8 * 3 + 1] * SCALE, vz = c8x[ci8 * 3 + 2] * SCALE;
              if (vx < exMin[0]) exMin[0] = vx; if (vx > exMax[0]) exMax[0] = vx;
              if (vy < exMin[1]) exMin[1] = vy; if (vy > exMax[1]) exMax[1] = vy;
              if (vz < exMin[2]) exMin[2] = vz; if (vz > exMax[2]) exMax[2] = vz;
              cx += vx; cy += vy; cz += vz;
            }
            cx /= 4; cy /= 4; cz /= 4; // NOTE: 4-corner centroid now, not 8-corner — see the /8 below
            const o = qi * 16;
            const obMin = [Infinity, Infinity, Infinity], obMax = [-Infinity, -Infinity, -Infinity];
            let tileOk = true;
            const uvSet = new Set();
            for (let c = 0; c < 4; c++) {
              const vt = M.Mesher.unpackModelVertex(out[o + c * 4], out[o + c * 4 + 1], out[o + c * 4 + 2], out[o + c * 4 + 3]);
              if (vt.px < obMin[0]) obMin[0] = vt.px; if (vt.px > obMax[0]) obMax[0] = vt.px;
              if (vt.py < obMin[1]) obMin[1] = vt.py; if (vt.py > obMax[1]) obMax[1] = vt.py;
              if (vt.pz < obMin[2]) obMin[2] = vt.pz; if (vt.pz > obMax[2]) obMax[2] = vt.pz;
              if (vt.tile !== s.tile) tileOk = false;
              uvSet.add(Math.round(vt.u / 16) + ',' + Math.round(vt.v / 16));
            }
            // position: the emitted quad's own bounding box must match the independently
            // posed sub-box's, within 1 fixed-point unit (rounding, both sides).
            const posOk = [0, 1, 2].every((a) =>
              Math.abs(obMin[a] - Math.round(exMin[a])) <= 1 && Math.abs(obMax[a] - Math.round(exMax[a])) <= 1);
            if (!posOk) { posBad++; if (process.env.DBG) console.log(name, label, p.n, f, JSON.stringify(s), obMin, obMax, exMin, exMax); }
            // UV: the four corners, as a SET (winding order is section 3's question, not this
            // one), must be exactly the slice's own atlas-tile-local rectangle corners.
            const expectUv = new Set([
              s.ox + ',' + s.oy, (s.ox + s.w) + ',' + s.oy,
              (s.ox + s.w) + ',' + (s.oy + s.h), s.ox + ',' + (s.oy + s.h)
            ]);
            const uvOk = tileOk && uvSet.size === expectUv.size && [...uvSet].every((u) => expectUv.has(u));
            if (!uvOk) uvBad++;
            if (label === 'rest') restCentroid[name + '#' + k + '#' + f + '#' + si] = [cx, cy, cz];
            else posedCentroid[name + '#' + k + '#' + f + '#' + si] = [cx, cy, cz];
            qi++;
          }
        }
      }
    }
  }
  ok(slicesChecked > 300, `only ${slicesChecked} slices were cross-checked — expected several hundred across 8 anchors × 2 poses`);
  ok(posBad === 0, `${posBad}/${slicesChecked} slice quads sit at the WRONG world position (independent sub-box pose disagrees)`);
  ok(uvBad === 0, `${uvBad}/${slicesChecked} slice quads sample the WRONG atlas tile/rectangle (independent slice lookup disagrees)`);

  // ⚠⚠ ANTI-VACUITY — "posed, not just rest" is a claim, not a label: at least one animatable
  // slice (head/leg/arm — the two base classes `ER.setupAnimDelta` actually recognizes) must
  // sit at a MEASURABLY different world position between the two `anim` variants above, or the
  // 'posed' pass never actually exercised anything the 'rest' pass didn't already cover.
  let movedSlices = 0, comparedSlices = 0;
  for (const key of Object.keys(restCentroid)) {
    if (!(key in posedCentroid)) continue;
    comparedSlices++;
    const a = restCentroid[key], b = posedCentroid[key];
    const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    if (d > 0.02) movedSlices++;   // 0.02 block ~= a visible fraction of a texel at mob scale
  }
  okAv(movedSlices > 0 && comparedSlices > 0,
       `anti-vacuity: ${movedSlices}/${comparedSlices} sliced-face centroids moved between 'rest' and 'posed' — the posed-frame half of this section is exercising real motion, not re-checking rest twice`);
}

// ═══════════════ 7. G18c step 1 — a LIVE entity actually draws through ER.build ════════════
console.log("\n 7. a live EntityList mob is spawned, rendered by ER.build, and range-gated");
{
  const EL = M.EntityList, ER2 = M.EntityRender;
  // ⚠ `M.Entities.init()` reads `NS.DATA.entities` — never loaded by this file until now,
  // since JOB 4.1-4.4 never needed a SPAWNABLE entity, only `BE.layers`' model table.
  // G18c's own precondition, supplied the same way this file already supplies
  // `assets/mob-geometry.json` above: a real read of the file `pack-entities.mjs` writes,
  // not a hand-typed stand-in for it.
  M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(MCLITE_ROOT + 'assets/entities.json', 'utf8')) });
  M.Entities.init();
  ok(M.Entities.ready, "Entities table decodes from assets/entities.json");
  EL.init();
  ok(EL.ready, 'EntityList initializes in this harness');

  // guardian: one of the few types with BOTH measured motion (tools/golden/entity-motion-
  // 1.18.2.tsv) AND real box geometry (JOB 4.1) — none of mobtexcheck's own 8 anchors
  // (creeper/pig/zombie/...) can be spawned at all today, since `EL.spawn` refuses any type
  // `pack-entities.mjs` never measured gravity/drag for. Said here so the next session does not
  // waste time wondering why `EL.spawn('creeper', ...)` returns null.
  const canSpawn = EL.canSpawn('guardian');
  ok(canSpawn, 'guardian has measured motion, so EntityList.spawn will accept it');
  const g = canSpawn ? EL.spawn('guardian', 10, 64, 10) : null;
  ok(!!g, 'EL.spawn returns a live entity');

  const before = ER2.build(0, 0, 0, 10, 64, 12, 1);
  ok(!!before, 'ER.build returns a buffer when a live mob is in EntityList.list');
  const expectN = ER2.mobQuadCount('guardian');
  ok(expectN > 0, 'ER.mobQuadCount(guardian) is nonzero');
  ok(before && before.drawn === 1, `ER.build drew ${before && before.drawn} entities, expected exactly 1`);
  // D-445: mobs draw through CUTOUT now, not OPAQUE (a mob skin can carry real alpha=0 texels
  // -- skeleton's ribcage is one -- and OPAQUE never alpha-tests, which is exactly how a
  // transparent texel over stored black RGB became a solid black hole). This assertion used to
  // read LAYER_OPAQUE; updated to match the fix rather than left to fail against it.
  ok(before && before.quads[CFG.LAYER_CUTOUT] >= expectN,
     `ER.build allocated ${before && before.quads[CFG.LAYER_CUTOUT]} cutout quads, expected at least ${expectN} for one guardian`);

  // ⚠⚠ ANTI-VACUITY 1 — an entity type with no BE layer (a real spawnable one, `dolphin`'s own
  // sibling `turtle` renamed to something `BE.layer` cannot find) must NOT reach ER.build's
  // count, proving `ER.mobLayerFor`'s gate is actually gating and not letting everything through.
  const ghostType = '__no_such_mob_layer__';
  EL.list.push({ id: EL.nextId++, type: ghostType, x: 10, y: 64, z: 11, px: 10, py: 64, pz: 11,
                 vx: 0, vy: 0, vz: 0, yaw: 0, width: 1, height: 1, gravity: 0, drag: 0,
                 onGround: false, living: false, fallDistance: 0, age: 0, removed: false });
  ok(ER2.mobLayerFor(ghostType) === null, `mobLayerFor refuses a type with no BE layer (${ghostType})`);
  const withGhost = ER2.build(0, 0, 0, 10, 64, 12, 1);
  okAv(withGhost && withGhost.drawn === 1,
       `anti-vacuity: an entity type with no BE layer is still excluded from ER.build's drawn count (${withGhost && withGhost.drawn} drawn, expected 1) — the mob gate is real, not a pass-through`);
  EL.list.pop();

  // ⚠⚠ ANTI-VACUITY 2 — the SAME `ER.RANGE` gate every other entity is held to must apply to a
  // mob too. A second guardian placed well past ER.RANGE must not add to `drawn` or to the
  // opaque quad total.
  const far = EL.spawn('guardian', 10 + ER2.RANGE * 3, 64, 10);
  ok(!!far, 'a second guardian, placed far away, still spawns (motion is unaffected by distance)');
  const withFar = ER2.build(0, 0, 0, 10, 64, 12, 1);
  okAv(withFar && withFar.drawn === 1,
       `anti-vacuity: a guardian past ER.RANGE is excluded from ER.build (drawn=${withFar && withFar.drawn}, expected 1) — the range gate applies to mobs too`);

  // ⚠⚠ ANTI-VACUITY 3 — the light argument reaching `ER.emit`/`ER.emitMobLayer` must be a REAL
  // per-call value threaded through `ER.build`, not a constant this session hard-coded. Proven
  // by monkey-patching `NS.World.getLight` (absent in this harness, so ER.build's own `W &&
  // W.getLight` fallback is what runs today) to a distinctive, position-dependent value and
  // checking the emitted vertices actually carry it back.
  const savedWorld = M.World;
  M.World = { getLight: (wx, wy, wz) => (wx === 10 && wy === 64 && wz === 10) ? 0xA7 : 0xF0 };
  const withRealLight = ER2.build(0, 0, 0, 10, 64, 12, 1);
  ok(!!withRealLight, 'ER.build still returns a buffer once NS.World.getLight exists');
  {
    const hdr = M.Mesher.readHeader(withRealLight.buf);
    const view = new Uint32Array(withRealLight.buf, hdr.modelOff[CFG.LAYER_CUTOUT], expectN * 16); // D-445: guardian's quads live in CUTOUT now
    const vt = M.Mesher.unpackModelVertex(view[0], view[1], view[2], view[3]);
    okAv(vt.sky === (0xA7 >> 4) && vt.blk === (0xA7 & 15),
         `anti-vacuity: a guardian at (10,64,10) draws with the DISTINCTIVE light this test's fake World assigned that exact cell (sky=${vt.sky}, blk=${vt.blk}, expected sky=${0xA7 >> 4}, blk=${0xA7 & 15}) — light is sampled live, not a baked-in constant`);
  }
  M.World = savedWorld;
}

// ── D-596: the LEASH KNOT's base pose (LeashKnotEntityRenderer: scale(-1,-1,1), no lift) ──
console.log('\nknot. the leash knot sits ON its fence post, inside the fence block');
{
  const SCALE = CFG.MODEL_UNITS_PER_BLOCK / ER.MC_UNITS_PER_BLOCK, MU = CFG.MODEL_UNITS_PER_BLOCK;
  const L = BE.layer('leash_knot');
  ok(!!L && L.parts.length > 0, 'the leash_knot layer is baked');
  const span = (bp) => {
    const c8 = new Float64Array(24); let lo = Infinity, hi = -Infinity;
    const bs = bp.flip ? -1 : 1;
    for (const part of L.parts) { BE.poseBoxCorners(part, c8);
      for (let i = 0; i < 8; i++) { const y = (bp.yOffsetFixed + bs * c8[i * 3 + 1] * SCALE) / MU; lo = Math.min(lo, y); hi = Math.max(hi, y); } }
    return [lo, hi];
  };
  // Tm.getOrCreateKnot's own offset — the knot's y above its fence block (read, not owned: 07n_tame.js).
  const src = readFileSync(MCLITE_ROOT + 'src/07n_tame.js', 'utf8');
  const off = Number((src.match(/y: by \+ ([0-9.]+)/) || [])[1]);
  ok(off > 0 && off < 1, 'read the knot\'s own y offset off Tm.getOrCreateKnot (' + off + ')');
  const bp = ER.basePoseFor('leash_knot');
  const [lo, hi] = span(bp);
  ok(bp.flip === true && bp.yOffsetFixed === 0, 'the knot is drawn mirrored (flip) with NO 1.501 living lift');
  ok(off + lo >= -1e-6 && off + hi <= 1 + 1e-6 && hi - lo > 0.1,
     'the knot box spans ' + (off + lo).toFixed(3) + '..' + (off + hi).toFixed(3) + ' of its fence block — inside it');
  const [lo0, hi0] = span(ER.BASE_NONE);
  okAv(off + lo0 < -1e-6, 'anti-vacuity: the OLD unflipped pose puts the knot below its fence block (' + (off + lo0).toFixed(3) + ')');
  const [lo1] = span(ER.BASE_LIVING);
  okAv(off + lo1 > 1, 'anti-vacuity: the living pose (1.501 lift) would float it above the post (' + (off + lo1).toFixed(3) + ')');
}

console.log('\n' + '='.repeat(78));
console.log(` mobboxcheck: ${pass} assertions, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.log('   x ' + f);
  process.exit(1);
}
console.log(' the geometry of a posed, static mob is sound, and G18c step 1 now spawns');
console.log(" one into ER.build's live loop with real per-call light — proven here at the");
console.log(' Node level only. No browser stage has seen a real pixel yet (this session had');
console.log(' no Chromium); that bar is still open.');
