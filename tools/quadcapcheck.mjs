#!/usr/bin/env node
// quadcapcheck.mjs — session 136, QUEUE 0.0's 🔴 WORLD item ("Dan can see through the ground").
//
//   node tools/quadcapcheck.mjs [--print]
//
// `CFG.MAX_QUADS` (16,383, tied to a 16-bit index buffer — 00_ns.js) caps how much geometry one
// 16x16x16 section can carry. Three call sites (05_mesher.js, 11_gfx_webgpu.js, 12_gfx_webgl2.js)
// already know a section CAN cross that cap and silently drop the tail when it does — their own
// comments say "the mesher should have split it" / "ARCH §8" — but nothing ever built the split,
// and nothing ever asserted how close real terrain gets. That gap is exactly the shape of "block
// faces go invisible": a section that crosses the cap loses geometry with no error, no console
// noise beyond a single warn()-once, and no visual cue except a hole where ground should be.
//
// This check does two things anti-vacuity D-30 requires:
//   1. proves the drop path is real and reachable: mesh a deliberately overfull synthetic
//      section, and require the header's own total to never exceed the cap (not proving a bug —
//      proving the SAFETY NET works, since a clamp that cannot fire is not a clamp);
//   2. measures real, unmodified vanilla worldgen (seed 1337, a wide sweep) against the REAL cap
//      and asserts every section stays under a safety margin, not just under the hard cap — so a
//      future worldgen or model change that pushes density up gets caught here, long before any
//      section actually crosses 16,383 and starts dropping geometry in front of a player.
//
// KNOWN NOT YET DONE (named, not silently skipped, D-30): this sweep is natural terrain only. It
// says nothing about a PLAYER-BUILT structure (a dense mixed-material build packed into one
// section), which is the one shape of "surpassed" this check cannot rule out.

import { loadEngine } from './loadsrc.mjs';

const PRINT = process.argv.includes('--print');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); };
// D-30/gatecheck: these two assertions are the anti-vacuity proof itself (the clamp really
// fires, and really cuts geometry) -- named okAv per session 8's distinguishability idiom
// (gatecheck.mjs counts okAv( call sites, not just the word "anti-vacuity" in a comment).
const okAv = ok;

const MCL = loadEngine({ extra: ['16_settings.js'], dom: true });
const G = MCL.Gen, CFG = MCL.CFG, S = MCL.Section, M = MCL.Mesher;

// ─────────────────────────────────────── 1. anti-vacuity: the clamp really fires, and really cuts
{
  const REAL_CAP = CFG.MAX_QUADS;
  G.init(90210, G.defaults());
  M.setOptions({ ao: false, cross: true, fastLeaves: false, realModels: true });
  const stoneId = MCL.States.stateOf('stone'), dirtId = MCL.States.stateOf('dirt');
  const sec = S.makeUniform(stoneId, 15);
  for (let y = 0; y < 16; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
    S.set(sec, (y << 8) | (z << 4) | x, (x + z) & 1 ? stoneId : dirtId);
  }
  const airSec = S.makeUniform(0, 15);
  const nb = new Array(27).fill(airSec);
  nb[13] = sec;
  const snap = { sy: 8, base: CFG.WORLD_MIN_Y + 8 * 16, nb, biome: null };
  const bufFull = M.mesh(snap, null);
  const hdrFull = bufFull ? M.readHeader(bufFull) : null;
  const totalFull = hdrFull ? hdrFull.quads[0] + hdrFull.quads[1] + hdrFull.quads[2] : 0;
  ok(totalFull > 0, `checkerboard section produced geometry (${totalFull} quads) below cap`);

  // Now prove the clamp path is REACHABLE: shrink CFG.MAX_QUADS well under what this same
  // section just produced, remesh, and require the output to have been cut to the new cap, not
  // silently pass it through. A clamp that never gets exercised is not a clamp (D-30).
  const SHRUNK = Math.max(8, Math.floor(totalFull / 4));
  const savedCap = CFG.MAX_QUADS;
  CFG.MAX_QUADS = SHRUNK;
  const bufClamped = M.mesh(snap, null);
  const hdrClamped = bufClamped ? M.readHeader(bufClamped) : null;
  const totalClamped = hdrClamped ? hdrClamped.quads[0] + hdrClamped.quads[1] + hdrClamped.quads[2] : 0;
  CFG.MAX_QUADS = savedCap;
  okAv(totalClamped <= SHRUNK, `mesh() respects a shrunk MAX_QUADS=${SHRUNK} (got ${totalClamped} quads, was ${totalFull} before shrinking)`);
  okAv(totalClamped < totalFull, `the clamp actually cut something (${totalFull} -> ${totalClamped})`);
  if (PRINT) console.log(`   checkerboard section: ${totalFull} quads unclamped, ${totalClamped} quads with MAX_QUADS shrunk to ${SHRUNK} (real cap ${REAL_CAP})`);
}

// ─────────────────────────────────────── 2. real vanilla worldgen, measured against a safety margin
{
  G.init(1337, G.defaults());
  M.setOptions({ ao: true, cross: true, fastLeaves: false, realModels: true });
  const SAFETY = 0.5;
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
  const RANGE = 9;
  let worst = 0, worstLoc = null, sections = 0, overCap = 0, overSafety = 0;
  for (let cx = -RANGE; cx <= RANGE; cx++) {
    for (let cz = -RANGE; cz <= RANGE; cz++) {
      const c = chunkAt(cx, cz);
      for (let sy = 0; sy < CFG.SECTIONS_Y; sy++) {
        const buf = M.mesh(snapshotFor(cx, cz, sy), null);
        if (!buf) continue;
        sections++;
        const hdr = M.readHeader(buf);
        const total = hdr.quads[0] + hdr.quads[1] + hdr.quads[2] + hdr.modelQuads[0] + hdr.modelQuads[1] + hdr.modelQuads[2];
        if (total > worst) { worst = total; worstLoc = `${cx},${cz} sy=${sy}`; }
        if (total > CFG.MAX_QUADS) overCap++;
        if (total > CFG.MAX_QUADS * SAFETY) overSafety++;
      }
    }
    chunks.clear();
  }
  ok(sections > 3000, `swept a real number of sections (${sections})`);
  ok(overCap === 0, `${overCap} of ${sections} sections in a ${RANGE * 2 + 1}x${RANGE * 2 + 1} vanilla sweep actually crossed MAX_QUADS and lost geometry`);
  ok(overSafety === 0, `${overSafety} sections crossed the ${(SAFETY * 100).toFixed(0)}% safety margin (worst: ${worst}/${CFG.MAX_QUADS} at ${worstLoc}) — investigate before this becomes a live drop`);
  if (PRINT) console.log(`   worst natural section: ${worst}/${CFG.MAX_QUADS} quads (${(100 * worst / CFG.MAX_QUADS).toFixed(1)}%) at ${worstLoc}, over ${sections} sections swept`);
}

console.log(fails.length ? `${fails.length} FAIL:\n  ` + fails.join('\n  ') : `ok  ${pass} assertions, quadcapcheck`);
process.exit(fails.length ? 1 : 0);
