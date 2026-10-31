#!/usr/bin/env node
// tools/canefeaturecheck.mjs — D-441, queue row 0 item 3: sugar cane generated on dry land.
//
//   node tools/canefeaturecheck.mjs [--verbose]
//
// Root cause, audited to ground truth (node tools/_cane-guard.mjs, CANE_TRACE=1; see D-441's
// comment on compilePredicate in 04j_features.js): `patch_sugar_cane`'s water-adjacency check
// (`any_of` over four `matching_fluids:water` offsets) sometimes reads a cell in a NEIGHBOURING,
// not-yet-decorated chunk. `ctxBlock` correctly notices the read is out of bounds and falls back
// to `terrainAt` (the pre-feature, pure-position guess D-213 uses for every other predicate) —
// and at a shallow coastal cell, that guess says "water" while the neighbour's own decoration
// (a sand/gravel disk pulled in by D-217) later leaves it dry. The fix scopes D-213's fallback:
// a FLUID predicate's offset answers "not this fluid" rather than guessing, when it crosses a
// chunk boundary. Every other offset predicate (would_survive, tag_match, matching_blocks) is
// unchanged — this is `matching_fluids` only.
//
// Sections:
//   1. unit — a fluid offset that crosses a chunk boundary answers false, never a guess
//   2. unit — the in-chunk case is UNCHANGED (a real neighbour cell still reads correctly)
//   3. acceptance — a real coastal region at seed 1337: every sugar_cane base has water within
//      one block of the sand it stands on (the queue item's own acceptance test, verbatim)
//   4. anti-vacuity — the exact cell this bug was audited from: `terrainAt` still (wrongly, on
//      its own) calls it water, proving the fallback alone would fire the bug; the shipped
//      predicate, which no longer trusts that guess across a border, does not place cane there

import { loadEngine } from './loadsrc.mjs';
import { getCachedColumn } from './chunkcache.mjs'; // D-456: shared worldgen chunk cache

const VERBOSE = process.argv.includes('--verbose');
let pass = 0;
const fails = [];
const okAv = (c, m) => { if (c) pass++; else fails.push(m); };
const p = (...a) => { if (VERBOSE) console.log('   ' + a.join(' ')); };

console.log('canefeaturecheck — D-441, sugar cane must not generate with no water beside its sand');

const M = loadEngine({});
M.Gen.init(1337, Object.assign(M.Gen.defaults(), { climate: 'vanilla', features: true }));
const F = M.Features, SR = M.States, CFG = M.CFG;
const MINY = CFG.WORLD_MIN_Y, H = CFG.CHUNK_H;
const waterId = M.Gen.ids.water;

// ── 1 & 2: synthetic chunk buffers, no real worldgen needed ────────────────────────────────────
console.log('\n1/2. unit — a fluid offset crossing a chunk boundary never trusts a guess; in-chunk is unchanged');
function makeSB() { return new Uint16Array(H * 256); }
function setLocal(SB, lx, y, lz, state) { SB[((y - MINY) << 8) | (lz << 4) | lx] = state; }
const stoneId = SR.stateOf('stone');

const fluidPredJson = { predicate_type: 'minecraft:matching_fluids', fluids: ['minecraft:water'], offset: [1, 0, 0] };
const compiledFluid = F.compilePredicate(fluidPredJson);
const tagPredJson = { predicate_type: 'minecraft:solid', offset: [1, 0, 0] };
const compiledSolid = F.compilePredicate(tagPredJson);

// a fake column-local inline feature, just to get `guardOk` to set ctx the same way the real
// decoration pipeline does (F.columnLocal({kind:'column'}) === true)
function guardWith(compiled, SB, cx, cz, x, y, z) {
  const inl = { chain: [{ kind: 'predicate', p: compiled }], local: F.columnLocal({ kind: 'column' }), gen: null };
  return F.inlineGuard(inl, SB, cx, cz, x, y, z, { nextInt: () => 0, next: () => 0 });
}

{
  const SB = makeSB();
  const cx = 0, cz = 0;
  // origin at the chunk's own last column (lx=15): offset [1,0,0] lands at lx=16 — OUTSIDE.
  const x = 15, y = 64, z = 5;
  setLocal(SB, 15, y, 5, 0); // origin cell must be air for the predicate itself to run at all
  const r1 = guardWith(compiledFluid, SB, cx, cz, x, y, z);
  okAv(r1 === false, `a fluid offset crossing OUT of the chunk must answer false (got ${r1}) regardless of what pre-feature terrain guesses`);
  p('border fluid offset ->', r1);

  // the SAME border crossing through a non-fluid predicate (solid) must still fall back to the
  // pure guess (D-213's normal behaviour) — proving the D-441 scoping is to fluids only.
  const r2 = guardWith(compiledSolid, SB, cx, cz, x, y, z);
  p('border solid offset (unchanged D-213 fallback) ->', r2, typeof r2);
  okAv(typeof r2 === 'boolean', 'a non-fluid predicate at the same border must still resolve through the D-213 fallback (typeof boolean), not refuse outright');
}
{
  // in-chunk: offset lands INSIDE the same chunk, with real water there — must read it correctly.
  const SB = makeSB();
  const cx = 0, cz = 0;
  const x = 5, y = 64, z = 5;
  setLocal(SB, 5, y, 5, 0);              // origin: air
  setLocal(SB, 6, y, 5, waterId);        // (x+1,y,z): real water, IN this chunk
  const r3 = guardWith(compiledFluid, SB, cx, cz, x, y, z);
  okAv(r3 === true, `an in-chunk fluid offset over real water must still return true (got ${r3}) — D-441 must not touch the in-chunk case`);
  p('in-chunk fluid offset over real water ->', r3);

  setLocal(SB, 6, y, 5, stoneId);        // now stone instead of water
  const r4 = guardWith(compiledFluid, SB, cx, cz, x, y, z);
  okAv(r4 === false, `an in-chunk fluid offset over stone must return false (got ${r4})`);
}

// ── 3. acceptance — the queue item's own acceptance test, at seed 1337 ─────────────────────────
console.log('\n3. acceptance — a real coastal sweep: every sugar_cane base has water within one block');
const R = 20;
const NC = 2 * R + 1, W_ = NC * 16;
const world = new Uint16Array(W_ * H * W_);
const IX = (x, y, z) => (y * W_ + z) * W_ + x;
const t0 = Date.now();
for (let cx = -R; cx <= R; cx++) for (let cz = -R; cz <= R; cz++) {
  const c = getCachedColumn(M, cx, cz); // D-456: shared worldgen chunk cache
  const ox = (cx + R) * 16, oz = (cz + R) * 16;
  for (let sy = 0; sy < CFG.SECTIONS_Y; sy++) {
    const sec = c.sec[sy];
    for (let i = 0; i < 4096; i++) {
      const y = (sy << 4) | (i >> 8), lz = (i >> 4) & 15, lx = i & 15;
      world[IX(ox + lx, y, oz + lz)] = M.Section.get(sec, i);
    }
  }
}
p(`generated ${NC}x${NC} chunks in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
function blockAt(wx, wy, wz) {
  if (wx < 0 || wx >= W_ || wz < 0 || wz >= W_) return -1;
  const ly = wy - MINY;
  if (ly < 0 || ly >= H) return -1;
  return world[IX(wx, wy, wz)];
}
const caneId = SR.stateOf('sugar_cane');
// KW-27: a cell holding seagrass/kelp/a waterlogged block IS water to vanilla's `matching_fluids` (getFluidState),
// so a later feature swapping water for seagrass is not a drying overwrite (SR.waterIn, D-168).
const isWet = (s) => s === waterId || (s > 0 && SR.waterIn[s] === 1);
let bases = 0, dryPredicate = 0, dryOverwrite = 0;
const badList = [];
for (let x = 0; x < W_; x++) for (let z = 0; z < W_; z++) for (let y = 0; y < H; y++) {
  if (world[IX(x, y, z)] !== caneId) continue;
  if (blockAt(x, y - 1, z) === caneId) continue; // not the base of the stack
  bases++;
  const sy = y - 1;
  const wet = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => isWet(blockAt(x + dx, sy, z + dz)));
  if (wet) continue;
  // A dry base: did the predicate stand cane on a cell that was NEVER wet (a real false positive,
  // the thing this check must forbid), or was cardinal water there in the pre-feature terrain and
  // a later feature (a sand disk, D-217) overwrote it AFTER cane ran? The latter is KW-27's
  // decoration-order overwrite -- a separate, tracked bug, not this predicate's fault.
  const gx = x - R * 16, gz = z - R * 16, gy = sy + MINY;
  const preWet = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => isWet(F.terrainAt(gx + dx, gy, gz + dz)));
  if (preWet) dryOverwrite++;
  else { dryPredicate++; if (badList.length < 10) badList.push({ x: gx, y, z: gz }); }
}
p(`sugar_cane bases: ${bases} -- dry: ${dryOverwrite} overwritten [KW-27], ${dryPredicate} predicate false-positive`);

// D-455: carveAwareHeightmapY's waterline off-by-one is fixed, so genuine water-adjacent bases now
// exist (was ZERO -- D-441/D-448). `bases > 0` is now a NON-VACUOUS guarantee: a regression of that
// anchor sends it straight back to zero. The predicate itself must never stand cane on a cell that
// was never wet; the only residual dryness is KW-27's post-placement overwrite, tracked there until
// vanilla's feature order is ported. Section 4 below is this section's anti-vacuity.
okAv(bases > 0, `no sugar_cane bases generated in the ${NC}x${NC} sweep -- carveAwareHeightmapY's waterline anchor has regressed (D-455)`);
okAv(dryOverwrite === 0, `${dryOverwrite} sugar_cane bases lost their water to a later feature (KW-27)`);
okAv(dryPredicate === 0, `${dryPredicate} of ${bases} sugar_cane bases stand on a never-wet cell (a predicate false positive, distinct from KW-27's overwrite): ${JSON.stringify(badList)}`);

// ── 4. anti-vacuity — the exact audited cell ───────────────────────────────────────────────────
console.log('\n4. anti-vacuity — the cell this bug was audited from');
const badX = -309, badY = 64, badZ = 208;
const terrainGuess = F.terrainAt(badX, badY - 1, badZ - 1);
okAv(terrainGuess === waterId, `sanity: the pre-feature terrain guess at (${badX},${badY - 1},${badZ - 1}) must still be water (got ${M.Reg.names[SR.block[terrainGuess]]}) — if this fails the audited scenario no longer reproduces and this check should be re-derived, not deleted`);
const realNeighbour = blockAt(badX + (R * 16), badY - 1, badZ - 1 + (R * 16));
p('terrainAt (the old guess):', M.Reg.names[SR.block[terrainGuess]], ' real built neighbour:', M.Reg.names[SR.block[realNeighbour] || 0] || 'air');
okAv(realNeighbour !== waterId, 'sanity: the real decorated neighbour must NOT be water — this is the exact disagreement D-441 exists to not trust');
const placedThere = blockAt(badX + R * 16, badY, badZ + R * 16) === caneId;
okAv(!placedThere, `anti-vacuity: with the pre-feature guess alone saying "water" at the audited cell, the fixed predicate must still refuse to place cane at (${badX},${badY},${badZ}) — if this fails, D-441's fallback scoping regressed and the bug is back`);

// ── 5. anti-vacuity — D-443/D-446 NEXT (b): the bounded carve-aware heightmap lookup ───────────
// A real, reproducible carved-away anchor at seed 1337 (found by sweeping dry-land columns for
// one where the pure noise guess says solid but `carvedAt` says the real generated block is air
// — the exact D-443 mechanism, patch_sugar_cane_desert's own repro cell no longer reproduces
// after D-441/other changes since that session, so this is a freshly re-found example, not the
// original one). Proves BOTH halves: the OLD `heightmapY` still anchors on the carved-away cell
// (the bug), and the NEW `carveAwareHeightmapY` (D-446's NEXT (b), wired into `heightmapY`'s
// `heightmap` chain step only for placed features `requiresSolidGround` marks) does not.
console.log('\n5. anti-vacuity — a real carved-away anchor: old heightmapY vs the new carve-aware one');
{
  const cvX = -720, cvZ = -720;
  const cvH = M.Column.height(cvX, cvZ);
  const pureGuess = F.terrainAt(cvX, cvH, cvZ);
  okAv(pureGuess > 0 && SR.solid[pureGuess] === 1,
    `sanity: the pure noise guess at (${cvX},${cvH},${cvZ}) must still say solid ground — if this fails the audited cell no longer reproduces and this section should be re-derived, not deleted`);
  okAv(F.carvedAt(cvX, cvH, cvZ) === 0,
    `sanity: the REAL generated block at (${cvX},${cvH},${cvZ}) must be carved to air — same requirement`);
  const oldY = F.heightmapY(0, cvX, cvZ);
  const newY = F.carveAwareHeightmapY(0, cvX, cvZ);
  p('Column.height', cvH, ' old heightmapY ->', oldY, ' new carveAwareHeightmapY ->', newY);
  okAv(oldY === cvH + 1, `old heightmapY must still anchor on the carved-away pure guess (got ${oldY}, expected ${cvH + 1}) — proving the bug this section exists to catch`);
  okAv(newY !== oldY, `new carveAwareHeightmapY must NOT anchor on the same carved-away cell as heightmapY (both returned ${oldY}) — the fix did nothing at this cell`);
  const realFloor = F.carvedAt(cvX, newY - 1, cvZ);
  okAv(realFloor > 0 && SR.solid[realFloor] === 1,
    `new carveAwareHeightmapY's anchor (${newY}) must sit one above a REAL solid (carve-aware) floor (got block ${realFloor} at y=${newY - 1})`);
}

console.log(`\n${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log('  FAIL: ' + f);
process.exit(fails.length ? 1 : 0);
