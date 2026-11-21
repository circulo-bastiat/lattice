#!/usr/bin/env node
// structurequadcheck.mjs -- QUEUE 0.0's WORLD item ("Dan can see through the ground"), the gap
// D-692 (session 136) left explicitly open: quadcapcheck.mjs's own header says "KNOWN NOT YET
// DONE: this sweep is natural terrain only ... [it] says nothing about a PLAYER-BUILT structure
// ... which is the one shape of 'surpassed' this check cannot rule out." D-692 measured a 19x19
// chunk window centred on spawn (seed 1337) -- which happened to contain no worldgen structure
// at all, only plain terrain -- and told the next session to try a LIVE repro near a real
// structure instead of assuming the mesher-cap theory explains what Dan saw.
//
// This is that measurement, for the one concrete structure docs/DECISIONS.md already names at
// seed 1337: the plains village at chunk (-79, 90). `G.defaults()` places structures by default
// (04_worldgen.js's `structures: true`), so `G.genColumn` here generates the SAME decorated
// chunks -- houses, wells, paths, fences -- the live game shows a player standing in that
// village, without needing a browser.
//
// ⚠ TWO SEPARATE STREAMS, TWO SEPARATE CAPS, NOT ONE COMBINED ONE. `M.mesh`'s header carries
// `quads` (greedy full-cube faces) and `modelQuads` (fences/stairs/doors/etc, the "part" model
// stream) as independent arrays, and D-692's MAX_QUADS clamp is applied to each SEPARATELY, at
// two different places: `05_mesher.js` clips `quads` against `CFG.MAX_QUADS` inside `M.mesh`
// itself; `modelQuads` is never clipped there at all -- its own clamp lives only in the two gfx
// backends (`11_gfx_webgpu.js`/`12_gfx_webgl2.js`), at GPU-upload time, which this offline,
// browser-less check cannot reach. (session 138's own live browser repro, tools/villagepeek.mjs,
// covers that path instead: it ran the real renderer at this same village and saw neither
// MAX_QUADS console.warn fire.) So this file measures both streams against the cap they are
// ACTUALLY checked against, and its own anti-vacuity proof (D-30) only exercises the `quads`
// clamp, which is the one it can reach -- the `modelQuads` gap is named, not silently assumed
// covered.
//
// MEASURED (seed 1337, 9x9-chunk window around chunk (-79,90)): worst BLOCK-quad section is
// 708/16,383 (4.3%), worst MODEL-quad section is 1,908/16,383 (11.6%) -- both at chunk (-80,93)
// sy=8. Nowhere near either cap; a real, decorated village is no closer to overflowing the
// mesher than the worst plain-terrain pocket D-692 already measured (34.1%). The MAX_QUADS
// theory is ruled out for this real worldgen structure too, not just for plain terrain. The
// see-through-ground report is STILL OPEN; this check only closes the "a structure could push a
// section's face-quad stream over the mesher's own 16-bit cap" branch of the investigation.
//
//   node tools/structurequadcheck.mjs [--print]

import { loadEngine } from './loadsrc.mjs';

const PRINT = process.argv.includes('--print');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); };
const okAv = (c, m) => { ok(c, m); if (c) console.log('   ✓ break caught: ' + m); };

const MCL = loadEngine({ extra: ['16_settings.js'], dom: true });
const G = MCL.Gen, CFG = MCL.CFG, S = MCL.Section, M = MCL.Mesher;

G.init(1337, G.defaults());
M.setOptions({ ao: true, cross: true, fastLeaves: false, realModels: true });

const chunks = new Map();
function chunkAt(cx, cz) {
  const k = cx + ',' + cz;
  let c = chunks.get(k);
  if (!c) { c = G.genColumn(cx, cz); chunks.set(k, c); }
  return c;
}
function snapshotFor(cx, cz, sy) {
  const nb = new Array(27);
  for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const slot = (dy + 1) * 9 + (dz + 1) * 3 + (dx + 1);
    const ny = sy + dy;
    if (ny < 0 || ny >= CFG.SECTIONS_Y) { nb[slot] = null; continue; }
    nb[slot] = S.copy(chunkAt(cx + dx, cz + dz).sec[ny]);
  }
  return { sy, base: CFG.WORLD_MIN_Y + sy * 16, nb, biome: null };
}

// docs/DECISIONS.md: "Seed 1337, plains village at chunk (-79, 90)"
const CCX = -79, CCZ = 90, RANGE = 4;
const SAFETY = 0.5;
let worstBlock = 0, worstBlockLoc = null, worstBlockCx = 0, worstBlockCz = 0, worstBlockSy = 0;
let worstModel = 0, worstModelLoc = null;
let sections = 0, overCapBlock = 0, overSafetyBlock = 0, overCapModel = 0, overSafetyModel = 0;

for (let cx = CCX - RANGE; cx <= CCX + RANGE; cx++) {
  for (let cz = CCZ - RANGE; cz <= CCZ + RANGE; cz++) {
    const c = chunkAt(cx, cz);
    for (let sy = 0; sy < CFG.SECTIONS_Y; sy++) {
      const buf = M.mesh(snapshotFor(cx, cz, sy), null);
      if (!buf) continue;
      sections++;
      const hdr = M.readHeader(buf);
      const blockTotal = hdr.quads[0] + hdr.quads[1] + hdr.quads[2];
      const modelTotal = hdr.modelQuads ? (hdr.modelQuads[0] + hdr.modelQuads[1] + hdr.modelQuads[2]) : 0;
      if (blockTotal > worstBlock) { worstBlock = blockTotal; worstBlockLoc = `${cx},${cz} sy=${sy}`; worstBlockCx = cx; worstBlockCz = cz; worstBlockSy = sy; }
      if (modelTotal > worstModel) { worstModel = modelTotal; worstModelLoc = `${cx},${cz} sy=${sy}`; }
      if (blockTotal > CFG.MAX_QUADS) overCapBlock++;
      if (blockTotal > CFG.MAX_QUADS * SAFETY) overSafetyBlock++;
      if (modelTotal > CFG.MAX_QUADS) overCapModel++;
      if (modelTotal > CFG.MAX_QUADS * SAFETY) overSafetyModel++;
    }
  }
  chunks.clear();
}

ok(sections > 300, `swept a real number of sections around the village (${sections})`);
ok(overCapBlock === 0, `${overCapBlock} of ${sections} sections' BLOCK-quad stream actually crossed MAX_QUADS`);
ok(overSafetyBlock === 0, `${overSafetyBlock} sections' block-quad stream crossed the ${(SAFETY * 100).toFixed(0)}% safety margin (worst: ${worstBlock}/${CFG.MAX_QUADS} at ${worstBlockLoc})`);
ok(overCapModel === 0, `${overCapModel} of ${sections} sections' MODEL-quad stream actually crossed MAX_QUADS`);
ok(overSafetyModel === 0, `${overSafetyModel} sections' model-quad stream crossed the ${(SAFETY * 100).toFixed(0)}% safety margin (worst: ${worstModel}/${CFG.MAX_QUADS} at ${worstModelLoc})`);
if (PRINT) {
  console.log(`   worst village-area BLOCK-quad section: ${worstBlock}/${CFG.MAX_QUADS} (${(100 * worstBlock / CFG.MAX_QUADS).toFixed(1)}%) at ${worstBlockLoc}`);
  console.log(`   worst village-area MODEL-quad section: ${worstModel}/${CFG.MAX_QUADS} (${(100 * worstModel / CFG.MAX_QUADS).toFixed(1)}%) at ${worstModelLoc}, over ${sections} sections swept`);
}

// ── anti-vacuity: shrink the cap under THIS REAL section's own measured block-quad total and
// remesh it. This exercises the one clamp `M.mesh` itself performs (see file header for why the
// model-quad clamp cannot be reached from here). ──
{
  const savedCap = CFG.MAX_QUADS;
  const SHRUNK = Math.max(8, Math.floor(worstBlock * 0.75));
  CFG.MAX_QUADS = SHRUNK;
  const buf = M.mesh(snapshotFor(worstBlockCx, worstBlockCz, worstBlockSy), null);
  const hdr = buf ? M.readHeader(buf) : null;
  const blockTotal = hdr ? hdr.quads[0] + hdr.quads[1] + hdr.quads[2] : 0;
  CFG.MAX_QUADS = savedCap;
  okAv(blockTotal <= SHRUNK, `re-meshing the real worst village section's block-quad stream with MAX_QUADS shrunk to ${SHRUNK} respects the cap (got ${blockTotal})`);
  okAv(blockTotal < worstBlock, `the clamp actually cut real village block-quad geometry (${worstBlock} -> ${blockTotal})`);
  if (PRINT) console.log(`   anti-vacuity: worst village block-quad section clipped from ${worstBlock} to ${blockTotal} quads with MAX_QUADS=${SHRUNK}`);
}

console.log(fails.length ? `${fails.length} FAIL:\n  ` + fails.join('\n  ') : `ok  ${pass} assertions, structurequadcheck`);
process.exit(fails.length ? 1 : 0);
