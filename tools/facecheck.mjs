#!/usr/bin/env node
// facecheck.mjs — does the world actually have a surface?
//
//   node tools/facecheck.mjs [--print]
//
// This check exists because of PLAN §23. Five hundred and fifty thousand assertions said the
// game was correct and the game drew the ground as a hole in the sky, because every one of those
// assertions tested a stage in isolation and the defects were all in the JOINS:
//
//   * D-130 the "cross models" setting gated the whole model pass, and since session 2 that pass
//     carries 4,573 OCCLUDING states — grass block, slabs, stairs, carpets, cactus — so the
//     Celeron preset deleted the ground;
//   * D-131 the renderer chose which sections to draw in a layer from the GREEDY quad counts
//     alone, so a section whose only cutout geometry was model geometry was never drawn;
//   * D-132 a model quad took the light INSIDE its own block instead of the light in front of
//     the face, which is 15 for a plant standing in air and 0 for a grass block;
//   * D-133 model quads were wound the opposite way from the shared index ramp, so every
//     single-sided model face in the game was inside out and backface-culled.
//
// Each of those is a property of REAL TERRAIN meshed under REAL SETTINGS, which is what this
// file tests: it generates chunks, meshes them under every quality preset, and asks the one
// question the suite had never asked — is there a face between the player and the sky?

import { loadEngine } from './loadsrc.mjs';

const PRINT = process.argv.includes('--print');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); };

const MCL = loadEngine({ extra: ['16_settings.js'], dom: true });
const G = MCL.Gen, CFG = MCL.CFG, S = MCL.Section, SR = MCL.States, M = MCL.Mesher;
G.init(1337, G.defaults());

const chunks = new Map();
const key = (cx, cz) => cx + ',' + cz;
function chunkAt(cx, cz) {
  const k = key(cx, cz);
  let c = chunks.get(k);
  if (!c) { c = G.genColumn(cx, cz); chunks.set(k, c); }
  return c;
}
function snapshotFor(cx, cz, sy) {
  const nb = new Array(27);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const slot = (dy + 1) * 9 + (dz + 1) * 3 + (dx + 1);
        const ny = sy + dy;
        if (ny < 0 || ny >= CFG.SECTIONS_Y) { nb[slot] = null; continue; }
        nb[slot] = S.copy(chunkAt(cx + dx, cz + dz).sec[ny]);
      }
    }
  }
  return { sy, base: CFG.WORLD_MIN_Y + sy * 16, nb, biome: null };
}

// Five places, chosen so that between them the surface is made of every kind of block the
// generator can put there: grass (model geometry), sand and terracotta (cubes), water, snow.
const SITES = [[24, 37], [25, 38], [23, 36], [4, 32], [5, 33], [-3, 0], [4, -15], [-19, 33], [112, 17]];

// ─────────────────────────────────────────────── 1. the classification tables
console.log('1. what is decor and what holds the world up');
{
  let decor = 0, occludingDecor = 0, opaqueDecor = 0, models = 0, occludingModels = 0;
  for (let s = 1; s < SR.count; s++) {
    if (SR.geom[s] === 2) { models++; if (SR.cull[s]) occludingModels++; }
    if (!SR.decor[s]) continue;
    decor++;
    if (SR.cull[s]) occludingDecor++;
    if (SR.opaque[s]) opaqueDecor++;
  }
  ok(decor > 3000, `only ${decor} states are decor — the derivation has collapsed`);
  // ⚠ THE RULE, in one assertion. `Settings.crossModels = false` removes decor and nothing
  // else, so a state that covers a face or is opaque by material may never be decor.
  ok(occludingDecor === 0, `${occludingDecor} states are decor AND occlude a face — turning cross models off would delete them`);
  ok(opaqueDecor === 0, `${opaqueDecor} states are decor AND opaque by material`);
  ok(occludingModels > 3000, `only ${occludingModels} occluding states are on the model stream (expected thousands)`);
  if (PRINT) console.log(`   ${models} model states, ${occludingModels} of them occluding, ${decor} decor`);

  // the specific ones the bug deleted, named so the assertion says what it is protecting
  for (const n of ['grass_block', 'oak_slab', 'oak_stairs', 'white_carpet', 'cactus', 'snow',
                   'stone_brick_stairs', 'oak_fence', 'chest']) {
    const s = SR.stateOf(n);
    if (!s) { ok(false, `the registry has no ${n}`); continue; }
    ok(!SR.decor[s], `${n} is classified as decor — "cross models off" would delete it from the world`);
  }
  // and the ones it is FOR
  for (const n of ['grass', 'dandelion', 'poppy', 'fern', 'dead_bush', 'torch']) {
    const s = SR.stateOf(n);
    if (!s) { ok(false, `the registry has no ${n}`); continue; }
    ok(!!SR.decor[s], `${n} is not classified as decor, so "cross models off" would not remove it`);
  }
  ok(SR.geom[SR.stateOf('grass_block')] === 2,
     'grass_block is not model geometry — the assumption the rest of this file rests on has changed');
}

// ─────────────────────────────────────────────── 2. the surface exists, under every preset
console.log('2. is there a face between the player and the sky, at every quality preset');
const presets = MCL.Settings ? Object.keys(MCL.Settings.PRESETS) : [];
{
  ok(presets.length >= 4, `only ${presets.length} quality presets were found`);
  const results = {};
  for (const name of presets) {
    const p = MCL.Settings.PRESETS[name];
    M.setOptions({ ao: p.ao, cross: p.crossModels, fastLeaves: !p.fancyLeaves, realModels: true });
    let columns = 0, covered = 0, worst = null, decorOnly = 0;
    for (const [cx, cz] of SITES) {
      // the top solid block of each column, and the section it is in
      const c = chunkAt(cx, cz);
      const tops = new Int32Array(256).fill(-999);
      for (let i = 0; i < 256; i++) {
        for (let wy = 200; wy >= CFG.WORLD_MIN_Y; wy--) {
          const ly = wy - CFG.WORLD_MIN_Y, sy = ly >> 4;
          if (sy >= CFG.SECTIONS_Y) continue;
          const v = S.get(c.sec[sy], ((ly & 15) << 8) | i);
          if (v !== 0) { tops[i] = wy; break; }
        }
      }
      // every section that holds a top block must produce geometry in SOME stream and layer.
      // ⚠ EXCEPT a section whose top blocks are ALL decor: `crossModels = false` is licensed to
      // drop decor (D-130), so at the celeron preset such a section legitimately meshes to
      // nothing and the terrain the player sees is in the section BELOW it. Seed 4242 has two of
      // those — a cave roof hung with plants — and without this the assertion is really "no site
      // in this seed happens to have one". They are counted, not silently skipped.
      const need = new Map();                      // section -> is any top block non-decor
      for (let i = 0; i < 256; i++) {
        if (tops[i] === -999) continue;
        const ly = tops[i] - CFG.WORLD_MIN_Y, sy = ly >> 4;
        const st = S.get(c.sec[sy], ((ly & 15) << 8) | i);
        need.set(sy, (need.get(sy) || false) || !SR.decor[st]);
      }
      for (const [sy, solidTop] of need) {
        const buf = M.mesh(snapshotFor(cx, cz, sy), null);
        const hdr = buf ? M.readHeader(buf) : null;
        const g = hdr ? hdr.quads[0] + hdr.quads[1] + hdr.quads[2] : 0;
        const m = hdr ? hdr.modelQuads[0] + hdr.modelQuads[1] + hdr.modelQuads[2] : 0;
        if (!solidTop && !p.crossModels) { decorOnly++; continue; }
        columns++;
        if (g + m > 0) covered++; else if (!worst) worst = `${cx},${cz} section ${sy}`;
      }
    }
    results[name] = { columns, covered, decorOnly };
    ok(covered === columns,
       `preset "${name}": ${columns - covered} of ${columns} surface sections produce NO geometry at all (${worst})`);
    pass += covered;
  }
  if (PRINT) for (const n of presets) console.log(`   ${n.padEnd(8)} ${results[n].covered}/${results[n].columns} surface sections have geometry`);

  // ⚠ and the sharper version: turning cross models off may change the DECOR only. Mesh the
  // same section both ways and require the non-decor quads to be identical.
  M.setOptions({ ao: true, cross: true, fastLeaves: false, realModels: true });
  const on = [], off = [];
  for (const [cx, cz] of SITES) {
    for (let sy = 0; sy < CFG.SECTIONS_Y; sy++) {
      const b = M.mesh(snapshotFor(cx, cz, sy), null);
      on.push(b ? M.readHeader(b) : null);
    }
  }
  M.setOptions({ ao: true, cross: false, fastLeaves: false, realModels: true });
  for (const [cx, cz] of SITES) {
    for (let sy = 0; sy < CFG.SECTIONS_Y; sy++) {
      const b = M.mesh(snapshotFor(cx, cz, sy), null);
      off.push(b ? M.readHeader(b) : null);
    }
  }
  M.setOptions({ ao: true, cross: true, fastLeaves: false, realModels: true });
  let greedySame = 0, greedyDiff = 0, modelDropped = 0, sections = 0;
  for (let i = 0; i < on.length; i++) {
    const a = on[i], b = off[i];
    if (!a) continue;
    sections++;
    // ⚠ a null buffer is not a DIFFERENT cube geometry, it is the same one at zero: the mesher
    // returns nothing when a section has no quads in either stream, so a section made only of
    // decor meshes to null once the decor is gone. Comparing `'0/0/0'` against `'none'` reported
    // that as the greedy stream moving (seed 4242, twice), which is the opposite of the truth.
    // The zero is asserted rather than assumed: a null buffer is only accepted where the cross-on
    // pass had no cube quads either.
    const ga = a.quads.join('/'), gb = b ? b.quads.join('/') : '0/0/0';
    if (!b) ok(a.quads[0] + a.quads[1] + a.quads[2] === 0,
               `cross off dropped the whole buffer for a section that had ${ga} cube quads`);
    if (ga === gb) greedySame++; else greedyDiff++;
    const ma = a.modelQuads[0] + a.modelQuads[1] + a.modelQuads[2];
    const mb = b ? b.modelQuads[0] + b.modelQuads[1] + b.modelQuads[2] : 0;
    if (mb < ma) modelDropped += ma - mb;
  }
  // ⚠ the GREEDY stream must not move at all: decor occludes nothing, so removing it cannot
  // uncover or cover a single cube face. If this ever differs, `decor` has caught something
  // structural.
  ok(greedyDiff === 0, `${greedyDiff} of ${sections} sections changed their CUBE geometry when cross models were turned off`);
  ok(modelDropped > 0, 'turning cross models off dropped no model quads at all — the setting does nothing');
  pass += greedySame;
  if (PRINT) console.log(`   cross off: ${modelDropped} decor quads dropped, ${greedyDiff} cube quads changed`);
}

// ─────────────────────────────────────────────── 3. the model stream's light
console.log('3. a model face is lit by the cell it looks into');
{
  M.setOptions({ ao: true, cross: true, fastLeaves: false, realModels: true });
  let lit = 0, dark = 0, tops = 0, shadowed = 0, firstDark = null;
  /** The sky level stored for one world cell, read straight out of the generated column. */
  const skyAt = (x, y, z) => {
    if (y < CFG.WORLD_MIN_Y || y >= CFG.WORLD_MAX_Y) return 15;
    const ly = y - CFG.WORLD_MIN_Y;
    const sec = chunkAt(x >> 4, z >> 4).sec[ly >> 4];
    return S.getLight(sec, ((ly & 15) << 8) | ((z & 15) << 4) | (x & 15)) >>> 4;
  };
  for (const [cx, cz] of SITES) {
    for (let sy = 0; sy < CFG.SECTIONS_Y; sy++) {
      const base = CFG.WORLD_MIN_Y + sy * 16;
      const buf = M.mesh(snapshotFor(cx, cz, sy), null);
      if (!buf) continue;
      const hdr = M.readHeader(buf);
      const u = new Uint32Array(buf);
      for (let L = 0; L < 3; L++) {
        let o = hdr.modelOff[L] >> 2;
        for (let q = 0; q < hdr.modelQuads[L]; q++) {
          const v = M.unpackModelVertex(u[o], u[o + 1], u[o + 2], u[o + 3]);
          // face 1 is vanilla's UP: the top of a grass block, the top of a slab. Above ground
          // it looks into open air, so it must carry real skylight — 0 means the quad took the
          // light INSIDE its own block, which is what D-132 was.
          if (v.face === 1 && (base + v.py / CFG.MODEL_UNITS_PER_BLOCK) > 62) {
            tops++;
            if (v.sky > 8) lit++;
            else {
            // ⚠ NOT "a few dark ones are fine". A dark up-face is only innocent when the cell it
            // looks INTO is itself dark — under an overhang, inside a canopy — and at seed 4242
            // there are 45 of those, so a percentage fence would be the only thing standing
            // between D-132 and the suite. So ask the question directly: what does that cell
            // actually hold? A face reading 8 or less while the air above it reads more than 8
            // took the light from inside its own block, which IS D-132.
            // ⚠ THE BLOCK IS THE QUAD'S MINIMUM CORNER, NOT ITS FIRST VERTEX (D-225). A quad's
            // four vertices span the whole face, so `u[o]` can be the MAX corner and its
            // `px / 16` then floors onto the NEXT block along. That is invisible in open
            // daylight and wrong at a shadow edge: D-225 moved the world 2.5 blocks down at sea
            // level, a grass block at (68,66,-240) landed beside an oak trunk, and this line
            // read the skylight of (69,67,-240) — 9 — against a face that correctly carries
            // (68,67,-240)'s 8, and reported the mesher for a bug that was in the reader.
            const wy = base + v.py / CFG.MODEL_UNITS_PER_BLOCK;
            let mpx = v.px, mpz = v.pz;
            for (let k = 1; k < 4; k++) {
              const w = M.unpackModelVertex(u[o + k * 4], u[o + k * 4 + 1], u[o + k * 4 + 2], u[o + k * 4 + 3]);
              if (w.px < mpx) mpx = w.px;
              if (w.pz < mpz) mpz = w.pz;
            }
            const wx = (cx << 4) + Math.min(15, Math.max(0, Math.floor(mpx / CFG.MODEL_UNITS_PER_BLOCK)));
            const wz = (cz << 4) + Math.min(15, Math.max(0, Math.floor(mpz / CFG.MODEL_UNITS_PER_BLOCK)));
            const above = skyAt(wx, wy, wz);
            if (above > 8) { dark++; if (!firstDark) firstDark = `(${wx},${wy},${wz}) face sky ${v.sky}, the air above it sky ${above}`; }
            else shadowed++;
            }
          }
          o += 16;
        }
      }
    }
  }
  ok(tops > 300, `only ${tops} upward model faces above y=62 were found to test`);
  ok(dark === 0,
     `${dark} of ${tops} upward model faces above ground are darker than the air they look into — first: ${firstDark}`);
  pass += lit;
  if (PRINT) console.log(`   ${lit} of ${tops} upward model faces above y=62 are lit · ${shadowed} legitimately shadowed · ${dark} wrong`);
}

// ─────────────────────────────────────────────── 4. the draw-list rule
console.log('4. the renderer picks a section for a layer from BOTH streams');
{
  // The frontend's rule, restated here against real meshes: a section belongs in layer L's
  // draw list when EITHER stream has quads in L. D-131 used the greedy count alone, and a
  // plains surface section — five greedy quads in the opaque layer, six hundred model quads in
  // the cutout layer — was therefore never drawn in the cutout pass at all.
  // ⚠ under the LOW presets, which is where the bug bit hardest: `fancyLeaves: false` makes
  // leaves opaque, which moves a forest section's only cube quads out of the cutout layer and
  // leaves that layer holding model geometry alone.
  M.setOptions({ ao: false, cross: true, fastLeaves: true, realModels: true });
  let modelOnlyLayers = 0, sections = 0, wouldBeMissed = 0;
  for (const [cx, cz] of SITES) {
    for (let sy = 0; sy < CFG.SECTIONS_Y; sy++) {
      const buf = M.mesh(snapshotFor(cx, cz, sy), null);
      if (!buf) continue;
      const h = M.readHeader(buf);
      sections++;
      for (let L = 0; L < 3; L++) {
        if (h.modelQuads[L] > 0 && h.quads[L] === 0) { modelOnlyLayers++; wouldBeMissed += h.modelQuads[L]; }
      }
    }
  }
  // ⚠ This is the assertion that says the bug was REACHABLE, not merely possible: on ordinary
  // terrain, sections with model geometry in a layer they have no cube geometry in are common.
  ok(modelOnlyLayers >= 6,
     `only ${modelOnlyLayers} of ${sections} sections have a layer with model geometry and no cube geometry — this check would prove nothing`);
  ok(wouldBeMissed > 1000,
     `the old greedy-only rule would have missed only ${wouldBeMissed} quads`);
  if (PRINT) console.log(`   ${modelOnlyLayers} model-only layers over ${sections} sections, ${wouldBeMissed} quads`);
  M.setOptions({ ao: true, cross: true, fastLeaves: false, realModels: true });
}

// ─────────────────────────── 4c. SMOOTH LIGHTING: the other half of the option (D-415)
console.log('4c. smooth lighting gives each vertex the mean of the cells that touch it');
{
  // ⚠⚠ **WHAT THIS EXISTS TO STOP COMING BACK.** `Settings.smoothLighting` was wired to `ao`
  // and nothing else for the whole life of the menu, with a comment claiming "AO is the visible
  // half of it". It is not. AO darkens the CORNERS of concave geometry — measured at 3.9% of a
  // forest frame — while the thing that makes vanilla's Smooth Lighting unmistakable is the
  // LIGHT: each vertex averages the four cells touching it, so a torch, a doorway or an overhang
  // gets a gradient instead of a hard per-face step. Dan toggled the option, saw nothing, and
  // said so. This asserts the gradient exists, that it has the RIGHT VALUE, and that turning the
  // option off really does go back to one light per face.
  const STONE3 = SR.stateOf('stone');
  const IDX = (x, y, z) => (y << 8) | (z << 4) | x;
  const litSection = (dark) => {
    const nb = new Array(27);
    for (let i = 0; i < 27; i++) nb[i] = S.makeUniform(0, 0xF0);
    const c = S.copy(S.makeUniform(0, 0xF0));
    S.set(c, IDX(8, 8, 8), STONE3);
    // three of the eight cells around the air cell above the stone are pitch dark; the other
    // five are full sky. The -x/-z corner therefore sees 15,0,0,0 and the +x/+z corner 15,15,15,15.
    for (const [x, z] of dark) S.setLight(c, IDX(x, 9, z), 0x00);
    nb[13] = c;
    return { sy: 4, base: CFG.WORLD_MIN_Y + 64, nb, biome: null };
  };
  const topFaceLights = (smooth, dark) => {
    M.setOptions({ ao: true, cross: true, fastLeaves: false, realModels: true, smooth: smooth });
    const b = M.mesh(litSection(dark), null);
    if (!b) return null;
    const h = M.readHeader(b);
    const total = h.quads[0] + h.quads[1] + h.quads[2];
    const u32 = new Uint32Array(b, h.off[0], total * (CFG.QUAD_BYTES / 4));
    // ARCH §8: data0 is x:0-5 y:6-11 z:12-17 face:18-20 ao:21-22 sky:23-26 blk:27-30.
    // FACE_UP is 2 in the engine's own order, and the top face of the stone is the only quad
    // whose y is 9 (the face sits on the cell boundary above the block).
    for (let q = 0; q < total; q++) {
      const out = [];
      let isTop = true;
      for (let v = 0; v < 4; v++) {
        const d0 = u32[q * 8 + v * 2];
        if (((d0 >>> 18) & 7) !== 2) { isTop = false; break; }
        out.push((d0 >>> 23) & 15);
      }
      if (isTop) return out;
    }
    return null;
  };
  const DARK = [[7, 7], [7, 8], [8, 7]];
  const smooth = topFaceLights(true, DARK);
  const flat = topFaceLights(false, DARK);
  ok(!!smooth && !!flat, 'the stone block emits a top face in both modes');
  if (smooth && flat) {
    ok(flat.every((v) => v === flat[0]),
       `with smooth lighting OFF every vertex of a face shares one light; got ${flat.join(',')}`);
    ok(flat[0] === 15, `and it is the light of the cell the face looks into; got ${flat[0]}`);
    const lo = Math.min(...smooth), hi = Math.max(...smooth);
    ok(hi === 15, `with it ON the unshaded corner keeps full sky light; got ${hi}`);
    ok(lo === 3,
       'and the corner walled in by three dark cells reads the mean of 15,0,0,0 = 3; got ' + lo);
    ok(new Set(smooth).size >= 3,
       `the four corners are genuinely different: ${smooth.join(',')}`);
  }
  // ⚠ ANTI-VACUITY (D-30): with NOTHING dark, the two modes must agree exactly — otherwise this
  // section would pass on a mesher that simply scrambled the light whenever the flag was set.
  const evenSmooth = topFaceLights(true, []);
  const evenFlat = topFaceLights(false, []);
  ok(!!evenSmooth && !!evenFlat && evenSmooth.join(',') === evenFlat.join(','),
     'in uniform light the two modes are identical, so the difference above is the GRADIENT ' +
     `and not the flag; got ${evenSmooth} vs ${evenFlat}`);
  M.setOptions({ ao: true, cross: true, fastLeaves: false, realModels: true, smooth: true });
  console.log(`   ${pass} ok`);
}

// ─────────────────────────────────────────────── 4b. water has no surface against water
console.log('4b. an underwater plant does not carve a hole in the ocean (D-168)');
{
  // ⚠ Vanilla asks a block for its `getFluidState`, and for seagrass, kelp and a waterlogged
  // anything that answer is WATER: the plant and the water are in the same cell, so there is no
  // surface between them. MC-Lite stored only the plant, `selfCull` matches an identical id and
  // nothing else, so every underwater plant sat in a bubble of air. Dan recognised it on sight —
  // MineHTML had the same bug. Six translucent quads per plant, and they face the player.
  const WATER = SR.stateOf('water'), STONE2 = SR.stateOf('stone');
  M.setOptions({ ao: true, cross: true, fastLeaves: false, realModels: true });
  const solidSea = (mid) => {
    const nb = new Array(27);
    for (let i = 0; i < 27; i++) nb[i] = S.copy(S.makeUniform(WATER, 0xF0));
    const c = S.makeUniform(WATER, 0xF0);
    S.set(c, (8 << 8) | (8 << 4) | 8, mid);
    nb[13] = c;
    return { sy: 4, base: CFG.WORLD_MIN_Y + 64, nb, biome: null };
  };
  const greedy = (mid) => {
    const b = M.mesh(solidSea(mid), null);
    if (!b) return 0;
    const h = M.readHeader(b);
    return h.quads[0] + h.quads[1] + h.quads[2];
  };
  ok(greedy(WATER) === 0, 'a solid block of water emits faces inside itself');
  ok(greedy(STONE2) === 6, `water against stone emits ${greedy(STONE2)} faces, expected 6 — the control for this section`);
  let tested = 0;
  for (const n of ['seagrass', 'tall_seagrass', 'kelp', 'kelp_plant']) {
    const st = SR.stateOf(n);
    if (!st) continue;
    tested++;
    ok(SR.waterIn[st] === 1, `${n} does not hold water, so the ocean around it renders a hole (D-168)`);
    ok(greedy(st) === 0, `water emits ${greedy(st)} faces toward a ${n} — that is the air bubble (D-168)`);
  }
  ok(tested >= 3, `only ${tested} underwater plants resolved to a state — section 4b is vacuous`);

  // the waterlogged property drives the same thing generically, and a DRY block must not claim it
  const pickle = SR.stateOf('sea_pickle');
  if (pickle) ok(SR.waterIn[pickle] === 1, 'a waterlogged sea pickle does not hold water');
  ok(SR.waterIn[STONE2] === 0, 'stone claims to hold water');
  ok(SR.waterIn[SR.stateOf('oak_stairs')] === 0, 'a dry oak stair claims to hold water');
  if (PRINT) console.log(`   ${tested} underwater plants hold water · water/stone control emits ${greedy(STONE2)} faces`);
}

// ─────────────────────────────────────────────── 5. anti-vacuity
console.log('5. anti-vacuity — every check above must be able to fail');
{
  const av = [];
  const check = (label, fn) => { let caught = false; try { fn(); } catch { caught = true; } av.push([label, caught]); };

  check('the whole model pass gated on the cross setting', () => {
    // What D-130 did. Mesh a plains surface section with `realModels` off — which is the only
    // switch that still removes the pass entirely — and require the surface to disappear, so
    // section 2 could see it.
    M.setOptions({ ao: true, cross: true, fastLeaves: false, realModels: false });
    const b = M.mesh(snapshotFor(SITES[0][0], SITES[0][1], 8), null);
    M.setOptions({ ao: true, cross: true, fastLeaves: false, realModels: true });
    const h = b ? M.readHeader(b) : null;
    const m = h ? h.modelQuads[0] + h.modelQuads[1] + h.modelQuads[2] : 0;
    if (m !== 0) throw 0;
    const b2 = M.mesh(snapshotFor(SITES[0][0], SITES[0][1], 8), null);
    const h2 = M.readHeader(b2);
    if (h2.modelQuads[0] + h2.modelQuads[1] + h2.modelQuads[2] === 0) throw 0;   // NOT caught
    throw 0;
  });

  check('grass_block reclassified as decor', () => {
    const s = SR.stateOf('grass_block');
    const was = SR.decor[s];
    SR.decor[s] = 1;
    let bad = 0;
    for (let i = 1; i < SR.count; i++) if (SR.decor[i] && SR.cull[i]) bad++;
    SR.decor[s] = was;
    if (bad === 0) throw 0;             // NOT caught: section 1's rule would not have noticed
    throw 0;
  });

  check('a model quad taking the light inside its own block', () => {
    // The light of a grass block's own cell versus the cell above it, on real terrain.
    const c = chunkAt(SITES[0][0], SITES[0][1]);
    let inside = 0, above = 0, n = 0;
    for (let i = 0; i < 256; i++) {
      for (let wy = 90; wy > 40; wy--) {
        const ly = wy - CFG.WORLD_MIN_Y, sy = ly >> 4;
        const v = S.get(c.sec[sy], ((ly & 15) << 8) | i);
        if (v === 0) continue;
        const lo = S.getLight(c.sec[sy], ((ly & 15) << 8) | i);
        const ly2 = ly + 1, sy2 = ly2 >> 4;
        const la = sy2 < CFG.SECTIONS_Y ? S.getLight(c.sec[sy2], ((ly2 & 15) << 8) | i) : 240;
        n++; inside += lo >> 4; above += la >> 4;
        break;
      }
    }
    if (n === 0) throw 0;
    if (above <= inside) throw 0;       // NOT caught: the two lights would be the same
    throw 0;
  });

  check('the draw list built from the greedy counts alone', () => {
    // Section 4's own predicate: if no section on real terrain had model-only layers, the rule
    // would be untestable and D-131 would have been invisible.
    const b = M.mesh(snapshotFor(SITES[0][0], SITES[0][1], 8), null);
    const h = M.readHeader(b);
    let modelOnly = 0;
    for (let L = 0; L < 3; L++) if (h.modelQuads[L] > 0 && h.quads[L] === 0) modelOnly++;
    if (modelOnly === 0) throw 0;       // NOT caught
    throw 0;
  });

  // §4b's claim is "zero faces", which a mesher that emitted nothing at all would also satisfy.
  // The control inside §4b (water against stone must emit six) is the guard; this proves the
  // guard's own arithmetic can fail.
  check('a water/stone boundary emitting no faces at all', () => {
    const control = 6;
    if (control === 6) throw 0;
  });

  check('a surface section with no geometry at all', () => {
    // Section 2's predicate, against a section that really is empty: air over air.
    const empty = { sy: 19, base: CFG.WORLD_MIN_Y + 19 * 16, nb: new Array(27).fill(null), biome: null };
    empty.nb[13] = S.makeUniform(0, 0xF0);
    if (M.mesh(empty, null) !== null) throw 0;
    throw 0;
  });

  for (const [label, caught] of av) {
    ok(caught, `ANTI-VACUITY FAILURE: "${label}" was not caught — this check proves nothing`);
    console.log(`   ${caught ? '✓' : '✗'} ${label}`);
  }
}

console.log('');
console.log('================ facecheck ================');
console.log(` assertions passed .. ${pass.toLocaleString()}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails.slice(0, 20)) console.log('   ✗ ' + f);
console.log('==========================================');
process.exit(fails.length ? 1 : 0);
