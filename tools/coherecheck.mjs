#!/usr/bin/env node
// coherecheck.mjs — two GENERAL audits the suite has never had: is a TREE whole, and is the
// world unaware of its own chunk grid?
//
//   node tools/coherecheck.mjs [--print]
//
// ⚠ WHY THIS CHECK EXISTS.
//
// Dan, playing at the MEDIUM preset, twice in two sessions: *"some trees have half their leaves
// cut off."* The first report was diagnosed as D-178 — leaves self-culled in both graphics modes
// — and declared fixed. He reported the same sentence again. Two things were true of that fix:
// it was correct, and NO CHECK HAD EVER DRAWN IT. `fancyLeaves` is false below the medium preset
// and every browser check in this project's history ran clamped to CELERON (D-196), so the fancy
// leaf path — D-178's entire subject — had never been rendered by a test. Nor had anything ever
// asked the other half of the question: whether the canopy the mesher is given is a WHOLE canopy.
//
// So this file answers both halves headlessly and with numbers, and it does it without a browser:
//
//   the WORLDGEN half   every generated leaf is one vanilla would have left there (its decay
//                       distance from a log is at most 6), and every canopy is symmetric about
//                       its own trunk — a canopy whole on one side and clipped on the other is
//                       exactly the picture Dan is describing, and the asymmetry is a number.
//   the MESHER half     the leaf faces actually emitted, against the faces the GEOMETRY says
//                       must exist, in BOTH leaf modes, on real terrain. D-178's own measurement
//                       is the template: a 5x5x5 leaf blob emits 750 faces in vanilla and emitted
//                       150 with the bug.
//
// ── ⚠ THE SECOND AUDIT, AND WHY IT IS THE GENERAL FORM OF THE FIRST ──────────────────────────
//
// "Half a tree cut off at a chunk edge" is one member of a family this project keeps meeting:
// a feature clipped at a chunk boundary, a decoration that only runs inside its own chunk, a
// seam in lighting or in the surface rules. Nothing here has ever tested the general claim that
// THE WORLD DOES NOT KNOW WHERE ITS CHUNK BOUNDARIES ARE. Section 5 does: over a large sample it
// builds, for each interesting block class, the histogram of its positions by `x & 15` and by
// `z & 15` and asks whether that histogram is flat.
//
// ⚠ AND FLATNESS IS NOT TESTED AGAINST A POISSON EXPECTATION, because blocks are not independent.
// A leaf blob is fifty cells that arrive together; an ore vein is nine. The counts are massively
// over-dispersed, so `chi2` against `N/16` runs at 5-20 per degree of freedom on a world with no
// bug in it at all, and any threshold picked off that number would be a threshold picked off
// today's numbers — the mistake with three decision numbers here already (D-152, D-178, D-194).
//
// The null distribution is measured instead, FROM THE SAME DATA: the identical statistic at four
// CONTROL MODULI — 13, 15, 17 and 19 — none of which the chunk grid can possibly know about.
// Whatever clustering inflates chi2 at modulus 16 inflates it just as much at modulus 17, so the
// question becomes "is 16 special?" rather than "is 16 flat?", and that question has an answer
// that does not depend on a constant anybody chose. Section 7 breaks the world and shows the
// bound has teeth.
//
// Sections:
//   1.  the sample — one padded world, generated once, and its census
//   2.  leaf decay — every leaf has a log within vanilla's 6, with the border excluded properly
//   2b. and three more worlds — different seeds, and one of them nowhere near the origin
//   3.  canopy wholeness — trees clustered, canopies owned, and tested for chunk-edge asymmetry
//   4.  the mesher, in BOTH leaf modes, against the geometry rather than against its own tables
//   4a.   leaf-only volumes: fancy emits every face, fast emits exactly the exposed surface
//   4b.   real terrain: the leaf faces emitted, attributed by atlas tile
//   5.  the chunk grid in x and z — against four control moduli and against sixteen sub-regions
//   5b. the chunk grid at CHUNK resolution — the 4x4 structure region block, same treatment
//   6.  the section grid in y — the boundary rows against a smooth local baseline
//   7.  anti-vacuity — break the world six ways and prove 2, 3, 4, 5 and 6 catch it
//
// Everything measured is printed, including the numbers no assertion rests on.

import { loadEngine } from './loadsrc.mjs';
import { getCachedColumn } from './chunkcache.mjs'; // D-463: shared worldgen chunk cache

const PRINT = process.argv.includes('--print');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); };
const p = (...a) => console.log('   ' + a.join(' '));

const MCL = loadEngine({});
const G = MCL.Gen, CFG = MCL.CFG, S = MCL.Section, SR = MCL.States, M = MCL.Mesher;
const H = CFG.CHUNK_H, MINY = CFG.WORLD_MIN_Y, SECY = CFG.SECTIONS_Y;
const SEED = 1337;
G.init(SEED, G.defaults());

// ── the block classes, derived from the registry rather than listed by hand where possible ──
// A class is a question about the world, not a list of blocks: "leaves" is every `*_leaves`
// state there is, so a roster change cannot quietly shrink the sample this check walks.
const CL_LEAF = 1, CL_LOG = 2, CL_ORE = 3, CL_PLANT = 4, CL_WATER = 5, CL_STRUCT = 6, CL_SOLID = 7;
const CLASS_NAME = ['', 'leaves', 'logs', 'ores', 'plants', 'water', 'structure', 'solid'];
// The structure class is a NAMED list on purpose: these are the blocks a structure writes and
// worldgen almost never does, so a mineshaft or a village clipped at a chunk edge shows here.
const STRUCT_BLOCKS = new Set(['cobweb', 'spawner', 'chest', 'rail', 'oak_planks', 'stone_bricks',
  'mossy_cobblestone', 'infested_stone', 'cobblestone_stairs', 'stone_brick_stairs',
  'chiseled_stone_bricks', 'cracked_stone_bricks', 'bookshelf', 'crafting_table', 'furnace',
  'barrel', 'oak_fence', 'torch', 'wall_torch', 'lantern', 'cobblestone_wall']);

const cls = new Uint8Array(SR.count);
const isLeaf = new Uint8Array(SR.count);
const isLog = new Uint8Array(SR.count);
for (let s = 1; s < SR.count; s++) {
  const n = SR.name(s); if (!n) continue;
  if (n.length > 7 && n.slice(-7) === '_leaves') { isLeaf[s] = 1; cls[s] = CL_LEAF; }
  else if ((n.length > 4 && n.slice(-4) === '_log') || (n.length > 5 && n.slice(-5) === '_wood')) { isLog[s] = 1; cls[s] = CL_LOG; }
  else if ((n.length > 4 && n.slice(-4) === '_ore') || n === 'ancient_debris') cls[s] = CL_ORE;
  else if (SR.decor[s] === 1 && SR.support[s] === 1) cls[s] = CL_PLANT;
  else if (n === 'water') cls[s] = CL_WATER;
  else if (STRUCT_BLOCKS.has(n)) cls[s] = CL_STRUCT;
  else if (SR.solid[s] === 1) cls[s] = CL_SOLID;
}

// ─────────────────────────────────────────────── 1. the sample
console.log('1. one padded sample world, generated once and shared by every section below');

// ⚠ THE BORDER, AND WHY THE FIRST SWEEP OF THIS WAS WRONG. A first pass over 81 chunks at seed
// 1337 found 51 leaves of 24,248 with no log within 6 — and every one of them was a leaf at the
// edge of the SAMPLE whose log sat in the chunk next door, which had never been generated. The
// answer is not a tolerance, it is a margin: generate PAD chunks more in every direction than
// the region that is judged. Vanilla's decay distance is 6 blocks and a tree's own reach is a
// few more, so two chunks of margin is a factor of five more than the question needs.
const PAD = 2, INNER = 4;
const R2 = INNER + PAD, NC = 2 * R2 + 1, W = NC * 16;
const tGen = Date.now();
const cols = new Map();
const ckey = (a, b) => a + ',' + b;
for (let cx = -R2; cx <= R2; cx++) for (let cz = -R2; cz <= R2; cz++) cols.set(ckey(cx, cz), getCachedColumn(MCL, cx, cz)); /* D-463 */
const genMs = Date.now() - tGen;

// The leaf/log VOLUME, cut to the y band those blocks actually occupy. The full column is 320
// blocks tall and a canopy lives in about a hundred of them; carrying the other 220 would cost
// 60 MB for nothing. Every section that needs the whole column reads `cols` directly.
let yLo = H, yHi = -1;
for (const [, col] of cols) for (let sy = 0; sy < SECY; sy++) {
  const sec = col.sec[sy];
  for (let i = 0; i < 4096; i++) {
    const st = S.get(sec, i); if (!isLeaf[st] && !isLog[st]) continue;
    const y = (sy << 4) | (i >> 8);
    if (y < yLo) yLo = y; if (y > yHi) yHi = y;
  }
}
yLo = Math.max(0, yLo - 8); yHi = Math.min(H - 1, yHi + 8);
const VH = yHi - yLo + 1;
const vol = new Uint16Array(W * VH * W);
const VI = (x, y, z) => ((y - yLo) * W + z) * W + x;
for (let cx = -R2; cx <= R2; cx++) for (let cz = -R2; cz <= R2; cz++) {
  const col = cols.get(ckey(cx, cz)), ox = (cx + R2) * 16, oz = (cz + R2) * 16;
  for (let sy = 0; sy < SECY; sy++) {
    const sec = col.sec[sy];
    for (let i = 0; i < 4096; i++) {
      const st = S.get(sec, i); if (!isLeaf[st] && !isLog[st]) continue;
      const y = (sy << 4) | (i >> 8); if (y < yLo || y > yHi) continue;
      vol[VI(ox + (i & 15), y, oz + ((i >> 4) & 15))] = st;
    }
  }
}
const LO = PAD * 16, HI = W - PAD * 16;          // the judged window, in volume coordinates
const inJudged = (x, z) => x >= LO && x < HI && z >= LO && z < HI;

let nLeaf = 0, nLog = 0;
for (let y = yLo; y <= yHi; y++) for (let z = LO; z < HI; z++) for (let x = LO; x < HI; x++) {
  const st = vol[VI(x, y, z)]; if (isLeaf[st]) nLeaf++; else if (isLog[st]) nLog++;
}
p(`${NC}x${NC} = ${NC * NC} chunks generated in ${genMs} ms, ${(2 * INNER + 1) ** 2} judged`);
p(`leaf/log band y ${yLo + MINY}..${yHi + MINY} (${VH} rows) · ${nLeaf.toLocaleString()} leaves · ${nLog.toLocaleString()} logs in the judged window`);
ok(nLeaf > 5000, `only ${nLeaf} leaves in the sample — sections 2 and 3 would prove nothing`);
ok(nLog > 500, `only ${nLog} logs in the sample`);
{
  let leafStates = 0, logStates = 0;
  for (let s = 1; s < SR.count; s++) { if (isLeaf[s]) leafStates++; if (isLog[s]) logStates++; }
  ok(leafStates > 20, `${leafStates} leaf states — the class is empty, every leaf test below is vacuous`);
  ok(logStates > 20, `${logStates} log states — the class is empty`);
  p(`${leafStates} leaf states · ${logStates} log states`);
}

// ── the shared tree machinery ────────────────────────────────────────────────────────────────
//
// ⚠ VANILLA'S RULE, NOT A BALL OF RADIUS 6. `LeavesBlock` carries a DISTANCE property, 1..7: a
// leaf next to a log is 1, a leaf next to a distance-d leaf is d+1, and distance 7 decays. So
// the invariant is a breadth-first search from every log THROUGH LEAVES, not a Chebyshev or
// Euclidean ball — a leaf six blocks from a log with a gap in between is a leaf vanilla would
// have deleted, and a ball test would have called it fine.
//
// The same walk names the OWNER of every leaf, which is what section 3 needs: whichever log
// cluster reached it first. That is not vanilla (vanilla has no notion of a tree at all), but it
// is a well-defined partition of the canopy and it is the only way to ask whether one tree's
// canopy is lopsided.
//
// ⚠ THE CANOPY IS ACCUMULATED OVER THE WHOLE VOLUME AND ONLY THE TRUNK IS WINDOWED. Counting a
// tree's leaves inside the judged window instead cost this check a false positive on its first
// run: the window's own edge is chunk-aligned, so clipping the canopy at it manufactured exactly
// the correlation section 3 exists to detect. The trunk decides whether a tree is judged; every
// leaf the walk reaches is then counted wherever it lies, and the two chunks of margin guarantee
// the whole canopy is inside the generated sample.
const DECAY = 6;
function treeAudit(v, w, ylo, yhi, lo, hi) {
  const vh = yhi - ylo + 1, n = w * vh * w;
  const ix = (x, y, z) => ((y - ylo) * w + z) * w + x;
  const STEP = [1, -1, w, -w, w * w, -w * w];
  const inb = (i, k) => {
    const x = i % w, z = ((i / w) | 0) % w, y = ((i / (w * w)) | 0);
    return k === 0 ? x < w - 1 : k === 1 ? x > 0 : k === 2 ? z < w - 1 : k === 3 ? z > 0
         : k === 4 ? y < vh - 1 : y > 0;
  };
  // cluster the logs (6-connected) — one cluster is one tree
  const cid = new Int32Array(n).fill(-1);
  const baseOf = [];
  for (let i = 0; i < n; i++) {
    if (!isLog[v[i]] || cid[i] >= 0) continue;
    const id = baseOf.length, cells = [i]; cid[i] = id;
    for (let h = 0; h < cells.length; h++) {
      const c = cells[h];
      for (let k = 0; k < 6; k++) {
        if (!inb(c, k)) continue; const j = c + STEP[k];
        if (cid[j] < 0 && isLog[v[j]]) { cid[j] = id; cells.push(j); }
      }
    }
    let by = 1e9, bi = -1;
    for (const c of cells) { const y = (c / (w * w)) | 0; if (y < by) { by = y; bi = c; } }
    baseOf.push({ x: bi % w, y: by, z: ((bi / w) | 0) % w, logs: cells.length });
  }
  // BFS the canopy, carrying the owner
  const owner = new Int32Array(n).fill(-1);
  let q = [];
  for (let i = 0; i < n; i++) if (isLog[v[i]]) { owner[i] = cid[i]; q.push(i); }
  for (let d = 0; d < DECAY && q.length; d++) {
    const nq = [];
    for (const i of q) for (let k = 0; k < 6; k++) {
      if (!inb(i, k)) continue; const j = i + STEP[k];
      if (owner[j] < 0 && isLeaf[v[j]]) { owner[j] = owner[i]; nq.push(j); }
    }
    q = nq;
  }
  // which trees are judged: trunk base inside the window
  const judged = new Int8Array(baseOf.length);
  for (let t = 0; t < baseOf.length; t++) {
    const b = baseOf[t];
    judged[t] = (b.x >= lo && b.x < hi && b.z >= lo && b.z < hi) ? 1 : 0;
  }
  const acc = baseOf.map(() => ({ n: 0, sx: 0, sz: 0, xm: 0, xp: 0, zm: 0, zp: 0, cross: new Float64Array(16) }));
  for (let i = 0; i < n; i++) {
    const o = owner[i];
    if (o < 0 || !judged[o] || !isLeaf[v[i]]) continue;
    const x = i % w, z = ((i / w) | 0) % w;
    const b = baseOf[o], a = acc[o], dx = x - b.x, dz = z - b.z;
    a.n++; a.sx += dx; a.sz += dz;
    if (-dx > a.xm) a.xm = -dx; if (dx > a.xp) a.xp = dx;
    if (-dz > a.zm) a.zm = -dz; if (dz > a.zp) a.zp = dz;
    // ⚠ THE CROSSING TALLY, AND ITS OWN NULL. For each of the sixteen possible offsets of the
    // chunk grid, does the boundary fall between this leaf and its trunk? Offset 0 is the real
    // grid; the other fifteen are the same question about a grid the world cannot know about,
    // and their mean is the expected crossing rate under "the canopy does not know where the
    // boundary is". No constant, no table, no assumption about tree shape.
    for (let s = 0; s < 16; s++) {
      if (((x + s) >> 4) !== ((b.x + s) >> 4)) a.cross[s]++;
      if (((z + s) >> 4) !== ((b.z + s) >> 4)) a.cross[s]++;
    }
  }
  // orphans, inside the judged window only (a leaf at the sample's own edge has its log outside)
  let leaves = 0, orphans = 0; const orphanBy = new Map(), orphanAt = [];
  for (let y = ylo; y <= yhi; y++) for (let z = lo; z < hi; z++) for (let x = lo; x < hi; x++) {
    const i = ix(x, y, z); if (!isLeaf[v[i]]) continue;
    leaves++;
    if (owner[i] >= 0) continue;
    orphans++; const nm = SR.name(v[i]);
    orphanBy.set(nm, (orphanBy.get(nm) || 0) + 1);
    if (orphanAt.length < 6) orphanAt.push(`${nm} at ${x - (w >> 1)},${y + MINY},${z - (w >> 1)}`);
  }
  const rows = [];
  for (let t = 0; t < baseOf.length; t++) {
    if (!judged[t]) continue;
    const b = baseOf[t], a = acc[t];
    if (a.n < 8) continue;                                          // a stump, not a canopy
    rows.push({ rx: b.x & 15, rz: b.z & 15, n: a.n, cdx: a.sx / a.n, cdz: a.sz / a.n,
                xm: a.xm, xp: a.xp, zm: a.zm, zp: a.zp, cross: a.cross, logs: b.logs });
  }
  return { leaves, orphans, orphanBy, orphanAt, trees: rows };
}

/** Generate a padded sample around (ccx, ccz) on a fresh engine and audit its trees. */
function sampleAt(seed, ccx, ccz, pad, inner) {
  const M2 = loadEngine({});
  const G2 = M2.Gen, S2 = M2.Section;
  G2.init(seed, G2.defaults());
  const r = pad + inner, nc = 2 * r + 1, w = nc * 16;
  const got = [];
  let lo2 = H, hi2 = -1;
  for (let cx = -r; cx <= r; cx++) for (let cz = -r; cz <= r; cz++) got.push([cx, cz, getCachedColumn(M2, ccx + cx, ccz + cz) /* D-463 */]);
  for (const [, , col] of got) for (let sy = 0; sy < SECY; sy++) {
    const sc = col.sec[sy];
    for (let i = 0; i < 4096; i++) {
      const st = S2.get(sc, i); if (!isLeaf[st] && !isLog[st]) continue;
      const y = (sy << 4) | (i >> 8); if (y < lo2) lo2 = y; if (y > hi2) hi2 = y;
    }
  }
  if (hi2 < 0) return null;
  lo2 = Math.max(0, lo2 - 8); hi2 = Math.min(H - 1, hi2 + 8);
  const v2 = new Uint16Array(w * (hi2 - lo2 + 1) * w);
  for (const [cx, cz, col] of got) {
    const ox = (cx + r) * 16, oz = (cz + r) * 16;
    for (let sy = 0; sy < SECY; sy++) {
      const sc = col.sec[sy];
      for (let i = 0; i < 4096; i++) {
        const st = S2.get(sc, i); if (!isLeaf[st] && !isLog[st]) continue;
        const y = (sy << 4) | (i >> 8); if (y < lo2 || y > hi2) continue;
        v2[((y - lo2) * w + oz + ((i >> 4) & 15)) * w + ox + (i & 15)] = st;
      }
    }
  }
  // ⚠ the residue of a trunk is its WORLD residue, so the sample's own origin must be carried
  // into it: `ccx * 16` shifts every column, and a check centred on the origin would only ever
  // test residues that happen to line up with the origin (D-148).
  const a = treeAudit(v2, w, lo2, hi2, pad * 16, w - pad * 16);
  const shift = ((ccx * 16) % 16 + 16) % 16, shiftZ = ((ccz * 16) % 16 + 16) % 16;
  if (shift || shiftZ) for (const t of a.trees) { t.rx = (t.rx + shift) & 15; t.rz = (t.rz + shiftZ) & 15; }
  return a;
}

// ─────────────────────────────────────────────── 2. leaf decay
console.log('2. every generated leaf is a leaf vanilla would have left there (decay distance <= 6)');
const A2 = treeAudit(vol, W, yLo, yHi, LO, HI);
//
// ⚠ NOT ASSERTED AT ZERO, AND THE REASON MATTERS. Vanilla's `TreeFeature` does not delete a leaf
// it cannot reach: it LABELS every leaf with its distance and lets the first random tick decay
// the sevens. MC-Lite has no random tick, so a leaf clump whose connecting logs were never
// written stays there forever. The population is therefore expected to be small and non-zero,
// and what this section holds is its SIZE — a rate, printed per seed, that a regression turning
// one tree in five into a detached blob could not slip past. Section 3 is the sharp instrument.
const ORPHAN_RATE = 0.015;
{
  p(`${A2.leaves.toLocaleString()} leaves judged · ${A2.orphans} with no log within ${DECAY} ` +
    `(${(100 * A2.orphans / A2.leaves).toFixed(3)}%)`);
  if (A2.orphans) p('  ' + A2.orphanAt.join(' | '));
  ok(A2.leaves > 5000, `only ${A2.leaves} leaves judged — this section is vacuous`);
  ok(A2.orphans / A2.leaves < ORPHAN_RATE,
     `${A2.orphans} of ${A2.leaves} leaves have no log within ${DECAY} — vanilla would decay every one: ` +
     [...A2.orphanBy].map(([n, c]) => `${c} ${n}`).join(', '));
  ok(A2.trees.length > 200, `only ${A2.trees.length} trees with a canopy — section 3 needs a population`);
  p(`${A2.trees.length} trees with a canopy · mean canopy ${(A2.trees.reduce((a, t) => a + t.n, 0) / A2.trees.length).toFixed(1)} leaves`);
}

// ─────────────────────────────────────────────── 2b. three more seeds, none at the origin
console.log('2b. three more worlds — one seed is an anecdote, and a sample at the origin tests the origin');
const moreTrees = [];
{
  // ⚠ D-148's lesson, applied: three different seeds AND three different places. A sample
  // centred on chunk 0 puts every trunk residue in a fixed relationship with the world origin,
  // and two of this project's worst bugs were only visible away from it.
  for (const [seed, ccx, ccz] of [[4242, 0, 0], [777777, 0, 0], [20250908, 40, 40]]) {
    const a = sampleAt(seed, ccx, ccz, 2, 3);
    if (!a) { p(`seed ${seed} at chunk ${ccx},${ccz}: no trees in the sample, contributes nothing`); continue; }
    for (const t of a.trees) moreTrees.push(t);
    p(`seed ${String(seed).padStart(8)} at chunk ${ccx},${ccz} · ${String(a.leaves).padStart(6)} leaves · ` +
      `${a.orphans} orphaned (${(100 * a.orphans / Math.max(1, a.leaves)).toFixed(2)}%) · ${a.trees.length} trees`);
    ok(a.leaves > 300, `seed ${seed}: only ${a.leaves} leaves — vacuous`);
    ok(a.orphans / Math.max(1, a.leaves) < ORPHAN_RATE,
       `seed ${seed}: ${a.orphans} of ${a.leaves} leaves have no log within ${DECAY}: ` +
       [...a.orphanBy].map(([n, c]) => `${c} ${n}`).join(', '));
  }
}

// ─────────────────────────────────────────────── 3. canopy wholeness and symmetry
console.log('3. a canopy is whole, and does not know where the chunk boundary is');
const TREES = A2.trees.concat(moreTrees);
//
// ⚠ WHY "IS THE CANOPY SYMMETRIC" IS THE WRONG QUESTION ASKED PLAINLY. A fancy oak is not
// symmetric, an acacia leans, a dark oak's trunk is 2x2 so its own base cell is a corner.
// Individual trees are lopsided for good reasons. The bug has a shape the honest asymmetry does
// not: it is a function of where the trunk sits INSIDE ITS CHUNK.
//
// 3a is the sharp instrument and it needs no model of a tree at all. For every leaf, ask whether
// a chunk boundary lies between it and its own trunk — then ask the same question of the fifteen
// OTHER offsets the same grid could have had. If the world is unaware of its chunk grid the true
// offset is one of sixteen equals; if a tree is being clipped at the boundary, the true offset
// crosses far less often than its own controls. Per TREE, because leaves within one canopy are
// not independent draws, and a t-test over trees is the honest degrees of freedom.
const T_MAX = 4;
{
  const tstat = (xs) => {
    const n = xs.length, mu = xs.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mu) ** 2, 0) / (n - 1));
    return { mu, sd, n, t: mu / (sd / Math.sqrt(n)) };
  };
  ok(TREES.length > 400, `only ${TREES.length} trees pooled — section 3 has no power`);

  // 3a. the crossing residual
  const resid = TREES.map((t) => {
    let m = 0; for (let s = 0; s < 16; s++) m += t.cross[s];
    return (t.cross[0] - m / 16) / t.n;         // per leaf, so a big tree does not dominate
  });
  const r = tstat(resid);
  let trueRate = 0, ctrlRate = 0, cells = 0;
  for (const t of TREES) { trueRate += t.cross[0]; cells += 2 * t.n; for (let s = 0; s < 16; s++) ctrlRate += t.cross[s] / 16; }
  p(`${TREES.length} trees pooled over four worlds · ${(cells / 2).toLocaleString()} owned leaves`);
  p(`canopy cells separated from their trunk by a chunk boundary: ${(100 * trueRate / cells).toFixed(2)}% ` +
    `· the same grid at its fifteen other offsets: ${(100 * ctrlRate / cells).toFixed(2)}%`);
  p(`per-tree residual ${(100 * r.mu).toFixed(3)} pp, sd ${(100 * r.sd).toFixed(2)}, t = ${r.t.toFixed(2)} over ${r.n} trees`);
  if (process.env.CTRLDUMP) {
    const raw = TREES.map((t)=>{let m=0;for(let s2=0;s2<16;s2++)m+=t.cross[s2];return t.cross[0]-m/16;});
    const rr = tstat(raw);
    p(`     raw-count per-tree t = ${rr.t.toFixed(2)}`);
    const num = raw.reduce((a,b)=>a+b,0), den = TREES.map((t)=>2*t.n).reduce((a,b)=>a+b,0);
    const th = num/den; let jv=0; const N2=TREES.length;
    for (let i=0;i<N2;i++){const ji=(num-raw[i])/(den-2*TREES[i].n); jv+=(ji-th)**2;}
    p(`     weighted ratio ${(100*th).toFixed(3)} pp, jackknife t = ${(th/Math.sqrt(jv*(N2-1)/N2)).toFixed(2)}`);
    const big = TREES.filter((t)=>Math.max(t.xm,t.xp,t.zm,t.zp)>=2);
    const rb = tstat(big.map((t)=>{let m=0;for(let s2=0;s2<16;s2++)m+=t.cross[s2];return (t.cross[0]-m/16)/t.n;}));
    p(`     trees with extent >= 2 only: ${big.length} trees, t = ${rb.t.toFixed(2)}`);
  }
  ok(Math.abs(r.t) < T_MAX,
     `a canopy crosses its own chunk boundary at ${(100 * trueRate / cells).toFixed(2)}% where the same grid at ` +
     `its other fifteen offsets says ${(100 * ctrlRate / cells).toFixed(2)}% (t = ${r.t.toFixed(2)}): trees are being clipped at the chunk edge`);

  // 3b. and the blunter form of the same thing — a canopy that STOPS flush against the boundary
  {
    let flush = 0, dirs = 0; const ctrl = new Float64Array(16);
    for (const t of TREES) {
      const cases = [[t.xm, t.rx], [t.xp, 15 - t.rx], [t.zm, t.rz], [t.zp, 15 - t.rz]];
      for (const [ext] of cases) if (ext >= 1) dirs++;
      for (let s = 0; s < 16; s++) {
        const rx = (t.rx + s) & 15, rz = (t.rz + s) & 15;
        const cs = [[t.xm, rx], [t.xp, 15 - rx], [t.zm, rz], [t.zp, 15 - rz]];
        for (const [ext, d] of cs) if (ext >= 1 && ext === d) ctrl[s]++;
      }
      for (const [ext, d] of cases) if (ext >= 1 && ext === d) flush++;
    }
    let mu = 0; for (let s = 1; s < 16; s++) mu += ctrl[s]; mu /= 15;
    let sd = 0; for (let s = 1; s < 16; s++) sd += (ctrl[s] - mu) ** 2; sd = Math.sqrt(sd / 14);
    const z = (flush - mu) / (sd || 1);
    p(`a canopy stops flush against the chunk edge ${flush} times in ${dirs} directions ` +
      `(${(100 * flush / dirs).toFixed(2)}%); at the fifteen other offsets ${mu.toFixed(1)} +- ${sd.toFixed(1)} — z = ${z.toFixed(2)}`);
    ok(Math.abs(z) < 5, `a canopy stops flush against the chunk edge ${flush} times against ${mu.toFixed(1)} at its own controls (z = ${z.toFixed(2)})`);
  }

  // 3c. and the centroid, which is what a player actually sees: a canopy heavy on one side
  const corr = (a, b) => {
    const n = a.length;
    const ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
    let sab = 0, sa = 0, sb = 0;
    for (let i = 0; i < n; i++) { const da = a[i] - ma, db = b[i] - mb; sab += da * db; sa += da * da; sb += db * db; }
    const rr = sa && sb ? sab / Math.sqrt(sa * sb) : 0;
    return { r: rr, t: rr * Math.sqrt((n - 2) / Math.max(1e-12, 1 - rr * rr)) };
  };
  const rx = TREES.map((t) => t.rx), rz = TREES.map((t) => t.rz);
  for (const [label, c] of [
    ['centroid offset x vs (x&15)-7.5', corr(rx.map((v) => v - 7.5), TREES.map((t) => t.cdx))],
    ['centroid offset z vs (z&15)-7.5', corr(rz.map((v) => v - 7.5), TREES.map((t) => t.cdz))],
    ['canopy size vs distance to the x chunk edge', corr(rx.map((v) => Math.min(v, 15 - v)), TREES.map((t) => t.n))],
    ['canopy size vs distance to the z chunk edge', corr(rz.map((v) => Math.min(v, 15 - v)), TREES.map((t) => t.n))]]) {
    p(`${(label + ' ').padEnd(46, '.')} r=${c.r.toFixed(4)} t=${c.t.toFixed(2)}`);
    ok(Math.abs(c.t) < T_MAX, `${label}: t=${c.t.toFixed(2)} — the canopy knows where the chunk edge is`);
  }

  // 3d. and the sixteen bucket means, so a bug confined to ONE residue cannot hide in an average
  for (const [axis, key] of [['x', 'rx'], ['z', 'rz']]) {
    const all = TREES.reduce((a, t) => a + t.n, 0) / TREES.length;
    let worst = 0;
    for (let rr = 0; rr < 16; rr++) {
      const g = TREES.filter((t) => t[key] === rr);
      if (g.length < 8) continue;
      const mn = g.reduce((a, t) => a + t.n, 0) / g.length;
      const sd = Math.sqrt(g.reduce((a, t) => a + (t.n - mn) ** 2, 0) / (g.length - 1));
      const z = (mn - all) / (sd / Math.sqrt(g.length));
      if (Math.abs(z) > Math.abs(worst)) worst = z;
      ok(Math.abs(z) < 4.5, `${axis}&15 = ${rr}: mean canopy ${mn.toFixed(1)} leaves against ${all.toFixed(1)} overall (z=${z.toFixed(2)})`);
    }
    p(`${axis}&15 bucket means: worst z = ${worst.toFixed(2)} against ${all.toFixed(1)} leaves overall`);
  }
}

// ─────────────────────────────────────────────── 4. the mesher, in both leaf modes
console.log('4. the leaf faces the mesher emits, against the faces the geometry says exist');
//
// ⚠ THE EXPECTATION IS NOT DERIVED FROM THE MESHER'S OWN TABLES, and that is the whole point.
// D-178 lived through three sessions because `gencheck` asserted the number the BUG produces —
// "fancy leaves are 6 cutout quads (self-culling already merges the inside)" — and a check whose
// expectation comes out of the table under test agrees with whatever that table says. So the two
// counts below come from vanilla's rule and from the block data alone:
//
//   a leaf face against AIR  is drawn in BOTH modes. Air occludes nothing in any renderer.
//   a leaf face against LEAF is drawn in FANCY and culled in FAST. Fancy leaves are cutout and
//                            occlude nothing (D-178); fast leaves are solid-render, so vanilla's
//                            ordinary opaque-neighbour rule removes exactly these faces (D-93).
//
// Neither number reads `SR.selfCull`, `SR.cull`, `SR.opaque` or `SR.layer`. If any of them says
// something a graphics setting should not have made it say, this section fails.
{
  // the atlas tiles a leaf wears, so a merged quad can be attributed without decoding positions
  const leafTiles = new Set();
  for (let s = 1; s < SR.count; s++) {
    if (!isLeaf[s]) continue;
    const part = SR.partAt(s, 0, 0, 0);
    for (let f = 0; f < 6; f++) leafTiles.add(SR.partTiles[part * 6 + f]);
  }
  // ⚠ attribution by tile is only exact if nothing else wears a leaf's tile. Assert it rather
  // than assume it: a resource change that put oak leaves' texture on another cube block would
  // silently inflate every number below.
  const shared = [];
  for (let s = 1; s < SR.count; s++) {
    if (isLeaf[s] || SR.geom[s] !== SR.GEOM_CUBE) continue;
    const part = SR.partAt(s, 0, 0, 0);
    for (let f = 0; f < 6; f++) if (leafTiles.has(SR.partTiles[part * 6 + f])) { shared.push(SR.name(s)); break; }
  }
  ok(shared.length === 0, `${shared.length} non-leaf cube blocks wear a leaf tile (${shared.slice(0, 5)}) — attribution by tile is not exact`);
  p(`${leafTiles.size} leaf tiles: ${[...leafTiles].sort((a, b) => a - b).join(', ')}`);

  /** Total leaf FACE AREA in a mesh buffer. A greedy quad covers uRep*vRep faces (ARCH 8). */
  const leafArea = (buf) => {
    if (!buf) return 0;
    const h = M.readHeader(buf), u = new Uint32Array(buf); let a = 0;
    for (let L = 0; L < 3; L++) {
      let o = h.off[L] >> 2;
      for (let q = 0; q < h.quads[L]; q++, o += 8) {
        const d1 = u[o + 1];
        if (leafTiles.has(d1 & 4095)) a += ((d1 >>> 12) & 255) * ((d1 >>> 20) & 255);
      }
    }
    return a;
  };
  const snapOf = (nb, sy) => ({ sy, base: MINY + sy * 16, nb, biome: null });
  const AIR = S.makeUniform(0, S.packLight(15, 0));
  const uniformNb = (centre, around) => {
    const nb = new Array(27);
    for (let i = 0; i < 27; i++) nb[i] = i === 13 ? centre : around;
    return nb;
  };
  const MRAD = 1;    // mesh this many chunks each way about the origin; needs one more loaded
  const realNb = (cx, cz, sy) => {
    const nb = new Array(27);
    for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const slot = (dy + 1) * 9 + (dz + 1) * 3 + (dx + 1), ny = sy + dy;
      if (ny < 0 || ny >= SECY) { nb[slot] = null; continue; }
      const c = cols.get(ckey(cx + dx, cz + dz));
      nb[slot] = c ? S.copy(c.sec[ny]) : null;
    }
    return nb;
  };

  // ── 4a. leaf-only volumes: every occluder removed, so the expectation is pure geometry ──────
  console.log('4a. the same terrain with every non-leaf block deleted');
  //
  // With nothing but leaves and air in the volume there is no third case to argue about: FANCY
  // must emit all six faces of every leaf (6N exactly — D-178's 5x5x5 blob generalised to real
  // canopies), and FAST must emit exactly the volume's EXPOSED SURFACE, which is counted here by
  // walking the cells, not by asking the mesher.
  let leafCells = 0, exposed = 0;
  const leafSecs = [];
  for (let cx = -MRAD; cx <= MRAD; cx++) for (let cz = -MRAD; cz <= MRAD; cz++) {
    for (let sy = 0; sy < SECY; sy++) {
      const src = cols.get(ckey(cx, cz)).sec[sy];
      let any = 0;
      const sec = S.makeUniform(0, S.packLight(15, 0));
      for (let i = 0; i < 4096; i++) { const st = S.get(src, i); if (isLeaf[st]) { S.set(sec, i, st); any++; } }
      if (any) leafSecs.push([cx, cz, sy, sec]);
    }
  }
  const leafOnly = new Map(leafSecs.map(([cx, cz, sy, sec]) => [cx + ',' + cz + ',' + sy, sec]));
  const lget = (cx, cz, sy, x, y, z) => {
    // y,z,x are section-local and may be -1..16; walk out to the neighbouring section
    let ncx = cx, ncz = cz, nsy = sy;
    if (x < 0) { ncx--; x += 16; } else if (x > 15) { ncx++; x -= 16; }
    if (z < 0) { ncz--; z += 16; } else if (z > 15) { ncz++; z -= 16; }
    if (y < 0) { nsy--; y += 16; } else if (y > 15) { nsy++; y -= 16; }
    if (nsy < 0 || nsy >= SECY) return 0;
    const s = leafOnly.get(ncx + ',' + ncz + ',' + nsy);
    return s ? S.get(s, (y << 8) | (z << 4) | x) : 0;
  };
  const D6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (const [cx, cz, sy, sec] of leafSecs) {
    for (let i = 0; i < 4096; i++) {
      if (!isLeaf[S.get(sec, i)]) continue;
      leafCells++;
      const x = i & 15, z = (i >> 4) & 15, y = i >> 8;
      for (const [dx, dy, dz] of D6) if (!isLeaf[lget(cx, cz, sy, x + dx, y + dy, z + dz)]) exposed++;
    }
  }
  const leafOnlyNb = (cx, cz, sy) => {
    const nb = new Array(27);
    for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const slot = (dy + 1) * 9 + (dz + 1) * 3 + (dx + 1), ny = sy + dy;
      if (ny < 0 || ny >= SECY) { nb[slot] = null; continue; }
      nb[slot] = leafOnly.get((cx + dx) + ',' + (cz + dz) + ',' + ny) || AIR;
    }
    return nb;
  };
  const measureLeafOnly = (fast) => {
    M.setOptions({ ao: true, cross: true, fastLeaves: fast, realModels: true });
    let area = 0;
    for (const [cx, cz, sy] of leafSecs) area += leafArea(M.mesh(snapOf(leafOnlyNb(cx, cz, sy), sy), null));
    return area;
  };
  const fancyOnly = measureLeafOnly(false), fastOnly = measureLeafOnly(true);
  p(`${leafCells.toLocaleString()} leaf cells in ${leafSecs.length} sections · exposed surface ${exposed.toLocaleString()} faces · 6N = ${(leafCells * 6).toLocaleString()}`);
  p(`fancy emitted ${fancyOnly.toLocaleString()} (want ${(leafCells * 6).toLocaleString()}) · fast emitted ${fastOnly.toLocaleString()} (want ${exposed.toLocaleString()})`);
  ok(leafCells > 500, `only ${leafCells} leaf cells — section 4a is vacuous`);
  ok(fancyOnly === leafCells * 6,
     `fancy leaves emitted ${fancyOnly} of ${leafCells * 6} leaf faces — ${(100 * (1 - fancyOnly / (leafCells * 6))).toFixed(1)}% missing (D-178)`);
  ok(fastOnly === exposed,
     `fast leaves emitted ${fastOnly} leaf faces where the volume's exposed surface is ${exposed}`);
  ok(fancyOnly > fastOnly, 'fancy leaves emit strictly more than fast leaves on the same volume');

  // ── 4b. real terrain, with the stone and the trunks back in ─────────────────────────────────
  console.log('4b. and the same sections with the world around them');
  let cells = 0, vAir = 0, vLeaf = 0, vOther = 0;
  const rget = (cx, cz, y, x, z) => {
    let gx = cx * 16 + x, gz = cz * 16 + z;
    const ccx = Math.floor(gx / 16), ccz = Math.floor(gz / 16);
    if (y < 0 || y >= H) return 0;
    const c = cols.get(ckey(ccx, ccz));
    if (!c) return -1;
    return S.get(c.sec[y >> 4], ((y & 15) << 8) | ((((gz % 16) + 16) % 16) << 4) | (((gx % 16) + 16) % 16));
  };
  for (let cx = -MRAD; cx <= MRAD; cx++) for (let cz = -MRAD; cz <= MRAD; cz++) {
    const col = cols.get(ckey(cx, cz));
    for (let sy = 0; sy < SECY; sy++) {
      const sec = col.sec[sy];
      for (let i = 0; i < 4096; i++) {
        if (!isLeaf[S.get(sec, i)]) continue;
        cells++;
        const x = i & 15, z = (i >> 4) & 15, y = (sy << 4) | (i >> 8);
        for (const [dx, dy, dz] of D6) {
          const nn = rget(cx, cz, y + dy, x + dx, z + dz);
          if (nn === 0) vAir++; else if (nn > 0 && isLeaf[nn]) vLeaf++; else vOther++;
        }
      }
    }
  }
  const measureReal = (fast) => {
    M.setOptions({ ao: true, cross: true, fastLeaves: fast, realModels: true });
    let area = 0;
    for (let cx = -MRAD; cx <= MRAD; cx++) for (let cz = -MRAD; cz <= MRAD; cz++)
      for (let sy = 0; sy < SECY; sy++) area += leafArea(M.mesh(snapOf(realNb(cx, cz, sy), sy), null));
    return area;
  };
  const fancyReal = measureReal(false), fastReal = measureReal(true);
  p(`${cells.toLocaleString()} leaf cells · faces against air ${vAir.toLocaleString()} · against leaves ${vLeaf.toLocaleString()} · against everything else ${vOther.toLocaleString()}`);
  p(`fancy emitted ${fancyReal.toLocaleString()} (floor ${(vAir + vLeaf).toLocaleString()}) · fast emitted ${fastReal.toLocaleString()} (floor ${vAir.toLocaleString()})`);
  ok(cells > 500, `only ${cells} leaf cells in the real-terrain sample — section 4b is vacuous`);
  ok(fancyReal >= vAir + vLeaf,
     `fancy leaves emitted ${fancyReal} leaf faces where air and leaf neighbours alone demand ${vAir + vLeaf} (D-178)`);
  ok(fastReal >= vAir,
     `fast leaves emitted ${fastReal} leaf faces where air neighbours alone demand ${vAir}`);
  ok(fastReal < fancyReal * 0.75,
     `fast leaves emitted ${fastReal} against fancy's ${fancyReal} — fast is not culling leaf against leaf, so the two modes have collapsed into one`);
  // the ratio Dan's setting turns on: fancy must be several times fast on real canopies
  p(`fancy/fast = ${(fancyReal / Math.max(1, fastReal)).toFixed(2)}x`);

  // ⚠ and the synthetic blob D-178 is written in terms of, kept because it is the number in the
  // decision record and a reader can check it by hand: 5x5x5 = 125 leaves, 6 faces each = 750.
  {
    const box = S.makeUniform(0, S.packLight(15, 0));
    const leaf = SR.stateOf('oak_leaves');
    for (let y = 5; y < 10; y++) for (let z = 5; z < 10; z++) for (let x = 5; x < 10; x++) S.set(box, S.index(x, y, z), leaf);
    M.setOptions({ ao: true, cross: true, fastLeaves: false, realModels: true });
    const f = leafArea(M.mesh(snapOf(uniformNb(box, AIR), 4), null));
    M.setOptions({ fastLeaves: true });
    const g = leafArea(M.mesh(snapOf(uniformNb(box, AIR), 4), null));
    M.setOptions({ fastLeaves: false });
    p(`the D-178 blob: fancy ${f} faces (vanilla 750, the bug 150) · fast ${g} faces (the 5x5x5 shell is 150)`);
    ok(f === 750, `the 5x5x5 leaf blob emits ${f} faces in fancy mode, not 750 (D-178)`);
    ok(g === 150, `the 5x5x5 leaf blob emits ${g} faces in fast mode, not its 150-face shell`);
  }
}

// ─────────────────────────────────────────────── 5. the chunk grid
console.log('5. the world does not know where its chunk boundaries are (x & 15, z & 15)');
//
// ⚠ HOW THE BOUND IS CALIBRATED, because this is the part that is easy to get wrong. Blocks are
// not independent draws: a leaf blob is fifty cells that arrive together and an ore vein is
// nine, so the residue counts are hugely over-dispersed and a chi2 against a Poisson expectation
// runs at 5 to 20 per degree of freedom on a world with nothing wrong with it. A threshold read
// off that number would be a threshold read off today's numbers.
//
// So the null is MEASURED FROM THE SAME DATA, at four moduli the chunk grid cannot know about:
// 13, 15, 17 and 19 — all within three of 16, so their bins are the same size and the clustering
// inflates them the same way. Whatever inflates the statistic at modulus 16 inflates it at 17 as
// well; what a chunk-boundary bug does, it does at 16 alone.
// ⚠ 11 and 23 were tried first and dropped: chi2 per degree of freedom rises with the number of
// bins under over-dispersion (smaller bins average less), so a modulus far from 16 is a biased
// control rather than a fair one — mod 11 ran systematically low and mod 23 systematically high. The bound is therefore relative
// — "16 is not an outlier among its controls" — and it has no constant in it that anyone chose
// by looking at a passing run. Section 7 clips a class at one residue and shows what that scores.
//
// ⚠ AND THE EXPECTATION IS COVERAGE-CORRECTED. The sample spans a whole number of CHUNKS, so
// modulus 16 divides it exactly and modulus 17 does not; without correcting for how many x
// values actually land in each bin, the controls carry a spurious chi2 of several hundred and
// modulus 16 looks unnaturally good. `cov[]` below is that correction, and it is exact.
const MODS = [16, 13, 15, 17, 19];
const CTRL = MODS.slice(1);
const NCLS = 8;
const X0 = -R2 * 16, SPAN = NC * 16;
const binOf = {}, cov = {};
for (const m of MODS) {
  const b = new Uint8Array(SPAN), c = new Float64Array(m);
  for (let i = 0; i < SPAN; i++) { const r = (((X0 + i) % m) + m) % m; b[i] = r; c[r]++; }
  binOf[m] = b; cov[m] = c;
}
const mk = (m) => { const a = []; for (let c = 0; c < NCLS; c++) a.push(new Float64Array(m)); return a; };
const HX = {}, HZ = {};
for (const m of MODS) { HX[m] = mk(m); HZ[m] = mk(m); }
const NY = []; for (let c = 0; c < NCLS; c++) NY.push(new Float64Array(H));
// ⚠ AND A SECOND, SHARPER NULL: the same residue fractions computed inside sixteen disjoint
// SUB-REGIONS of the sample. The scatter of a residue's share ACROSS sub-regions is the real
// standard error of that share — clustering and all — where a Poisson expectation is not. A
// boundary bug is consistent from sub-region to sub-region and a leaf blob is not, so this is
// the statistic with the power; the control moduli above stay as the shape test.
const KSUB = 16;
const SUBX = [], SUBZ = [];
for (let k = 0; k < KSUB; k++) {
  const ax = [], az = [];
  for (let c = 0; c < NCLS; c++) { ax.push(new Float64Array(16)); az.push(new Float64Array(16)); }
  SUBX.push(ax); SUBZ.push(az);
}
const CHTOT = []; for (let c = 0; c < NCLS; c++) CHTOT.push(new Float64Array(NC * NC));
{
  const t = Date.now();
  for (let cx = -R2; cx <= R2; cx++) for (let cz = -R2; cz <= R2; cz++) {
    const col = cols.get(ckey(cx, cz));
    const ci = (cx + R2) * NC + (cz + R2);
    const ksub = Math.min(3, ((cx + R2) * 4 / NC) | 0) * 4 + Math.min(3, ((cz + R2) * 4 / NC) | 0);
    const bx = [], bz = [];
    for (const m of MODS) { bx.push(binOf[m]); bz.push(binOf[m]); }
    const ox = cx * 16 - X0, oz = cz * 16 - X0;
    for (let sy = 0; sy < SECY; sy++) {
      const sec = col.sec[sy];
      for (let i = 0; i < 4096; i++) {
        const st = S.get(sec, i); if (!st) continue;
        const c = cls[st]; if (!c) continue;
        const x = ox + (i & 15), z = oz + ((i >> 4) & 15);
        for (let k = 0; k < MODS.length; k++) { const m = MODS[k]; HX[m][c][bx[k][x]]++; HZ[m][c][bz[k][z]]++; }
        NY[c][(sy << 4) | (i >> 8)]++;
        CHTOT[c][ci]++;
        SUBX[ksub][c][(cx * 16 + (i & 15)) & 15]++;
        SUBZ[ksub][c][(cz * 16 + ((i >> 4) & 15)) & 15]++;
      }
    }
  }
  p(`census walked in ${Date.now() - t} ms`);
}
/** chi2 per degree of freedom and the worst standardised bin, against a coverage-corrected mean. */
function gridStat(h, m) {
  const N = h.reduce((a, b) => a + b, 0);
  if (!N) return null;
  let chi = 0, mz = 0;
  for (let r = 0; r < m; r++) {
    const e = N * cov[m][r] / SPAN;
    if (e <= 0) continue;
    const d = h[r] - e, z = d / Math.sqrt(e);
    chi += d * d / e;
    if (Math.abs(z) > Math.abs(mz)) mz = z;
  }
  return { N, chi: chi / (m - 1), mz };
}
// ⚠ THE HEADROOM FACTORS, stated before any number was looked at and never moved afterwards:
// modulus 16 may score up to CHI_K times the WORST of its four controls, and its worst bin up to
// BIN_K times the worst control bin. A world with a chunk-boundary bug in it does not score 3x
// its controls, it scores hundreds of times them — section 7 measures exactly that.
const CHI_K = 3.0, BIN_K = 2.0;
// ⚠ AND THE SUB-REGION BOUND. Sixteen sub-regions give fifteen degrees of freedom, and this
// check makes about two hundred of these tests, so a t of 6 is the family-wise line and not a
// number read off a passing run. Section 7 reports the smallest clip it catches.
const SUB_T = 6.0;
/** The share of a class at one residue, and how far it is from 1/16 in units of its OWN scatter. */
function subT(SUB, c, r) {
  const ps = [];
  for (let k = 0; k < SUB.length; k++) {
    let tot = 0; for (let j = 0; j < 16; j++) tot += SUB[k][c][j];
    if (tot > 32) ps.push(SUB[k][c][r] / tot);
  }
  if (ps.length < 6) return null;
  const mu = ps.reduce((a, b) => a + b, 0) / ps.length;
  const sd = Math.sqrt(ps.reduce((a, b) => a + (b - mu) ** 2, 0) / (ps.length - 1));
  return { mu, k: ps.length, t: (mu - 1 / 16) / ((sd || 1e-12) / Math.sqrt(ps.length)) };
}
function gridSection(label, HH, SUB) {
  for (let c = 1; c < NCLS; c++) {
    const s16 = gridStat(HH[16][c], 16);
    if (!s16 || s16.N < 500) continue;
    const ctrl = CTRL.map((m) => gridStat(HH[m][c], m)).filter(Boolean);
    const chiMax = Math.max(...ctrl.map((s) => s.chi));
    const binMax = Math.max(...ctrl.map((s) => Math.abs(s.mz)));
    if (process.env.CTRLDUMP) p('     controls chi ' + ctrl.map((s)=>s.chi.toFixed(2)).join(' ') + ' | bins ' + ctrl.map((s)=>Math.abs(s.mz).toFixed(2)).join(' '));
    p(`${(CLASS_NAME[c] + ' ' + label).padEnd(20)} N=${String(s16.N).padStart(9)} ` +
      `chi2/dof 16:${s16.chi.toFixed(2).padStart(7)} controls max ${chiMax.toFixed(2).padStart(7)} · ` +
      `worst bin 16:${s16.mz.toFixed(2).padStart(6)} controls max ${binMax.toFixed(2).padStart(6)}`);
    ok(s16.chi <= CHI_K * chiMax,
       `${CLASS_NAME[c]} by ${label}: chi2/dof ${s16.chi.toFixed(2)} at modulus 16 against ${chiMax.toFixed(2)} at its worst control — the chunk grid is visible in the distribution`);
    ok(Math.abs(s16.mz) <= BIN_K * binMax,
       `${CLASS_NAME[c]} by ${label}: worst bin z=${s16.mz.toFixed(2)} at modulus 16 against ${binMax.toFixed(2)} at its worst control`);
    // and the sub-region test, one assertion per residue
    let worst = 0, wr = -1;
    for (let r = 0; r < 16; r++) {
      const st = subT(SUB, c, r); if (!st) continue;
      if (Math.abs(st.t) > Math.abs(worst)) { worst = st.t; wr = r; }
      ok(Math.abs(st.t) < SUB_T,
         `${CLASS_NAME[c]} by ${label}: residue ${r} holds ${(100 * st.mu).toFixed(3)}% of the class where every residue must hold 6.25%, t = ${st.t.toFixed(2)} over ${st.k} sub-regions`);
    }
    if (wr >= 0) p(`     sub-region worst residue ${wr}: t = ${worst.toFixed(2)} (bound ${SUB_T})`);
  }
}
gridSection('x & 15', HX, SUBX);
gridSection('z & 15', HZ, SUBZ);

// ── 5b. the same question one grid up: the 4x4 region block structures are placed in ─────────
console.log('5b. and at chunk resolution — the 4x4 region block, against controls 3, 5 and 7');
{
  const CMODS = [4, 3, 5, 7];
  const stat = (c, m, axis) => {
    const h = new Float64Array(m), cv = new Float64Array(m);
    for (let a = -R2; a <= R2; a++) for (let b = -R2; b <= R2; b++) {
      const r = (((a % m) + m) % m);
      h[axis === 0 ? r : (((b % m) + m) % m)] += CHTOT[c][(a + R2) * NC + (b + R2)];
      cv[axis === 0 ? r : (((b % m) + m) % m)]++;
    }
    const N = h.reduce((x, y) => x + y, 0); if (!N) return null;
    const tot = cv.reduce((x, y) => x + y, 0);
    let chi = 0;
    for (let r = 0; r < m; r++) { const e = N * cv[r] / tot; if (e > 0) chi += (h[r] - e) ** 2 / e; }
    return chi / (m - 1);
  };
  for (let c = 1; c < NCLS; c++) {
    for (const axis of [0, 1]) {
      const s4 = stat(c, 4, axis); if (s4 === null) continue;
      const ctrl = [3, 5, 7].map((m) => stat(c, m, axis));
      const worst = Math.max(...ctrl);
      p(`${(CLASS_NAME[c] + ' c' + (axis ? 'z' : 'x') + '&3').padEnd(20)} chi2/dof 4:${s4.toFixed(2).padStart(8)} controls max ${worst.toFixed(2).padStart(8)}`);
      ok(s4 <= CHI_K * worst,
         `${CLASS_NAME[c]} per chunk by c${axis ? 'z' : 'x'} & 3: chi2/dof ${s4.toFixed(2)} against ${worst.toFixed(2)} at its worst control`);
    }
  }
}

// ─────────────────────────────────────────────── 6. the section grid in y
console.log('6. and the SECTION grid in y — the boundary rows against a smooth local baseline');
//
// ⚠ y IS NOT TESTED FOR FLATNESS, and it must not be: the vertical distribution of every one of
// these classes is real physics. Ores follow triangle providers, the ocean surface is one row,
// the canopy band is ninety rows wide. `y & 15` is wildly non-uniform in a perfectly correct
// world — measured here at chi2/dof in the thousands for surface blocks — so a flatness test
// would fail on the truth and could only ever be "calibrated" by loosening it until it passed.
//
// The right statistic is LOCAL. A section seam is a discontinuity at y & 15 == 0 or 15; real
// physics is smooth over three rows. So take r(y) = n(y) / mean(n(y-1), n(y+1)) — one for a
// smooth distribution, whatever its shape — and group the median of ln r by y & 15. The two
// boundary residues are then compared against the spread of the fourteen interior ones, which
// is the null this world measures for itself.
{
  const med = (a) => { const b = a.slice().sort((x, y) => x - y); const h = b.length >> 1; return b.length % 2 ? b[h] : (b[h - 1] + b[h]) / 2; };
  const Y_K = 4.0;   // boundary residues may sit at 4 interior standard deviations, no further
  for (let c = 1; c < NCLS; c++) {
    const n = NY[c];
    const byRes = []; for (let r = 0; r < 16; r++) byRes.push([]);
    let used = 0;
    for (let y = 1; y < H - 1; y++) {
      const a = n[y - 1], b = n[y], d = n[y + 1];
      if (a < 5 || b < 5 || d < 5) continue;
      byRes[y & 15].push(Math.log(b / ((a + d) / 2))); used++;
    }
    if (used < 32) { p(`${CLASS_NAME[c]}: only ${used} usable rows, skipped`); continue; }
    const m = byRes.map((v) => (v.length ? med(v) : NaN));
    const inter = m.filter((v, i) => i > 0 && i < 15 && !isNaN(v));
    if (inter.length < 10) { p(`${CLASS_NAME[c]}: too few interior residues, skipped`); continue; }
    const mu = inter.reduce((a, b) => a + b, 0) / inter.length;
    const sd = Math.sqrt(inter.reduce((a, b) => a + (b - mu) ** 2, 0) / (inter.length - 1));
    const z0 = (m[0] - mu) / sd, z15 = (m[15] - mu) / sd;
    const wi = Math.max(...inter.map((v) => Math.abs((v - mu) / sd)));
    p(`${CLASS_NAME[c].padEnd(10)} ${String(used).padStart(3)} rows · median ln r: y&15=0 z=${z0.toFixed(2).padStart(6)} · y&15=15 z=${z15.toFixed(2).padStart(6)} · worst interior residue ${wi.toFixed(2)}`);
    ok(Math.abs(z0) < Y_K, `${CLASS_NAME[c]}: the row at the bottom of every section sits ${z0.toFixed(2)} interior sigma off a smooth baseline — a section seam`);
    ok(Math.abs(z15) < Y_K, `${CLASS_NAME[c]}: the row at the top of every section sits ${z15.toFixed(2)} interior sigma off a smooth baseline — a section seam`);
  }
}

// ─────────────────────────────────────────────── 7. anti-vacuity
console.log('7. anti-vacuity — break the world six ways and prove the sections above catch it');
//
// ⚠ THE THRESHOLDS ABOVE ARE CALIBRATED HERE, NOT BY LOOKING AT A PASSING RUN. Each break below
// injects the bug the section claims to catch, at a size a player could see, and reports the
// smallest injection that still trips the bound. A bound whose smallest caught break is bigger
// than the bug it exists for is a bound with no teeth, and it is visible in this output.
{
  const av = [];
  const shows = (label, fn) => { let caught = false; try { caught = !!fn(); } catch (e) { caught = false; } av.push([label, caught]); };

  // 7a. a leaf vanilla would have decayed. Section 2 must name it.
  shows('a leaf with no log within 6 (section 2)', () => {
    const v = vol.slice();
    let put = 0;
    for (let y = yLo + 4; y <= yHi - 4 && put < 20; y += 7) {
      for (let z = LO + 8; z < HI - 8 && put < 20; z += 37) {
        for (let x = LO + 8; x < HI - 8 && put < 20; x += 41) {
          const i = VI(x, y, z);
          if (v[i]) continue;
          let clear = true;
          for (let dy = -8; dy <= 8 && clear; dy++) for (let dz = -8; dz <= 8 && clear; dz++)
            for (let dx = -8; dx <= 8 && clear; dx++) {
              const yy = y + dy; if (yy < yLo || yy > yHi) continue;
              if (v[VI(x + dx, yy, z + dz)]) clear = false;
            }
          if (!clear) continue;
          v[i] = SR.stateOf('oak_leaves'); put++;
        }
      }
    }
    const a = treeAudit(v, W, yLo, yHi, LO, HI);
    return put >= 5 && a.orphans >= put;
  });

  // 7b. the canopy clipped at the chunk edge — the exact picture Dan describes. Section 3 must
  // see the correlation, and the smallest clip that trips it is printed.
  shows('a canopy clipped at x & 15 < 2 (section 3)', () => {
    const corrT = (rows) => {
      const a = rows.map((t) => t.rx - 7.5), b = rows.map((t) => t.cdx), n = a.length;
      const ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
      let sab = 0, sa = 0, sb = 0;
      for (let i = 0; i < n; i++) { const da = a[i] - ma, db = b[i] - mb; sab += da * db; sa += da * da; sb += db * db; }
      const r = sab / Math.sqrt(sa * sb);
      return Math.abs(r * Math.sqrt((n - 2) / Math.max(1e-12, 1 - r * r)));
    };
    let smallest = 0;
    for (const width of [1, 2]) {
      const v = vol.slice();
      for (let y = yLo; y <= yHi; y++) for (let z = 0; z < W; z++) for (let x = 0; x < W; x++) {
        if ((x & 15) < width && isLeaf[v[VI(x, y, z)]]) v[VI(x, y, z)] = 0;
      }
      const t = corrT(treeAudit(v, W, yLo, yHi, LO, HI).trees);
      p(`   clipping ${width} column${width > 1 ? 's' : ''} of leaves at every chunk edge scores t = ${t.toFixed(1)} against the bound of 4`);
      if (t >= 4 && !smallest) smallest = width;
    }
    return smallest > 0;
  });

  // 7c. D-178 itself, reinstated on the very tables the fix cleared. Section 4 must fail.
  shows("leaves put back into the self-cull set (D-178's own bug, section 4)", () => {
    const saved = [];
    for (let s = 1; s < SR.count; s++) if (isLeaf[s]) { saved.push([s, SR.selfCull[s]]); SR.selfCull[s] = 1; }
    let broke = false;
    try {
      const box = S.makeUniform(0, S.packLight(15, 0));
      const leaf = SR.stateOf('oak_leaves');
      for (let y = 5; y < 10; y++) for (let z = 5; z < 10; z++) for (let x = 5; x < 10; x++) S.set(box, S.index(x, y, z), leaf);
      const nb = new Array(27); const AIR2 = S.makeUniform(0, S.packLight(15, 0));
      for (let i = 0; i < 27; i++) nb[i] = i === 13 ? box : AIR2;
      M.setOptions({ ao: true, cross: true, fastLeaves: false, realModels: true });
      const buf = M.mesh({ sy: 4, base: MINY + 64, nb, biome: null }, null);
      const h = M.readHeader(buf), u = new Uint32Array(buf);
      let area = 0;
      for (let L = 0; L < 3; L++) { let o = h.off[L] >> 2; for (let q = 0; q < h.quads[L]; q++, o += 8) { const d1 = u[o + 1]; area += ((d1 >>> 12) & 255) * ((d1 >>> 20) & 255); } }
      p(`   with leaves self-culling again the 5x5x5 blob emits ${area} faces, not 750`);
      broke = area !== 750;
    } finally {
      for (const [s, v] of saved) SR.selfCull[s] = v;
      M.setOptions({ ao: true, cross: true, fastLeaves: false, realModels: true });
    }
    return broke;
  });

  // 7d. a feature clipped at a chunk boundary, injected straight into section 5's histogram.
  // The smallest clip that trips the control-calibrated bound is the number that says whether
  // that bound is worth anything.
  shows('a class thinned at x & 15 == 0 (section 5)', () => {
    // ⚠ THE SENSITIVITY DEPENDS ON HOW CLUMPED THE CLASS IS, and that is worth printing rather
    // than hiding. Leaves arrive fifty at a time, so the sample's own error on one residue's
    // share is about a seventh of it and no statistic can resolve better; stone arrives in
    // millions of independent cells and the same instrument sees a per-cent seam in it. Both
    // numbers are on the record so nobody has to guess what this section can and cannot see.
    let best = 1;
    for (const c of [CL_LEAF, CL_ORE, CL_SOLID]) {
      const base = HX[16][c];
      const ctrl = CTRL.map((m) => gridStat(HX[m][c], m));
      const chiMax = Math.max(...ctrl.map((s) => s.chi));
      const binMax = Math.max(...ctrl.map((s) => Math.abs(s.mz)));
      let smallest = 0;
      for (const frac of [0.30, 0.15, 0.08, 0.04, 0.02, 0.01, 0.005]) {
        const h = base.slice();
        const moved = h[0] * frac;
        h[0] -= moved;
        for (let r = 1; r < 16; r++) h[r] += moved / 15;
        const st = gridStat(h, 16);
        const SUB2 = SUBX.map((k) => { const a2 = []; for (let cc = 0; cc < NCLS; cc++) a2.push(k[cc].slice()); return a2; });
        for (const k of SUB2) {
          const mv = k[c][0] * frac; k[c][0] -= mv;
          for (let r = 1; r < 16; r++) k[c][r] += mv / 15;
        }
        const sub = subT(SUB2, c, 0);
        if (st.chi > CHI_K * chiMax || Math.abs(st.mz) > BIN_K * binMax || (sub && Math.abs(sub.t) > SUB_T)) smallest = frac;
      }
      p(`   ${CLASS_NAME[c]}: the smallest clip of one residue section 5 catches is ` +
        (smallest ? `${(smallest * 100).toFixed(1)}%` : 'NONE of 30% or less'));
      if (smallest && smallest < best) best = smallest;
    }
    return best <= 0.05;
  });

  // 7e. a section seam in y, injected into section 6's own statistic.
  shows('a row thinned at every section boundary (section 6)', () => {
    const med = (a) => { const b = a.slice().sort((x, y) => x - y); const h = b.length >> 1; return b.length % 2 ? b[h] : (b[h - 1] + b[h]) / 2; };
    const score = (n) => {
      const byRes = []; for (let r = 0; r < 16; r++) byRes.push([]);
      for (let y = 1; y < H - 1; y++) {
        const a = n[y - 1], b = n[y], d = n[y + 1];
        if (a < 5 || b < 5 || d < 5) continue;
        byRes[y & 15].push(Math.log(b / ((a + d) / 2)));
      }
      const m = byRes.map((v) => (v.length ? med(v) : NaN));
      const inter = m.filter((v, i) => i > 0 && i < 15 && !isNaN(v));
      const mu = inter.reduce((a, b) => a + b, 0) / inter.length;
      const sd = Math.sqrt(inter.reduce((a, b) => a + (b - mu) ** 2, 0) / (inter.length - 1));
      return Math.abs((m[0] - mu) / sd);
    };
    let smallest = 0;
    for (const frac of [0.20, 0.10, 0.05, 0.02]) {
      const n = NY[CL_SOLID].slice();
      for (let y = 0; y < H; y++) if ((y & 15) === 0) n[y] *= (1 - frac);
      const z = score(n);
      p(`   thinning the bottom row of every section by ${(frac * 100).toFixed(0)}% scores z = ${z.toFixed(1)} against the bound of 4${z >= 4 ? '  CAUGHT' : ''}`);
      if (z >= 4) smallest = frac;
    }
    return smallest > 0 && smallest <= 0.10;
  });

  // 7f. and the class tables themselves, because every count above is indexed by them
  shows('the leaf and log classes read as empty', () => {
    let leafN = 0, logN = 0, clsN = 0;
    for (let s = 1; s < SR.count; s++) { if (isLeaf[s]) leafN++; if (isLog[s]) logN++; if (cls[s]) clsN++; }
    return leafN > 20 && logN > 20 && clsN > 1000;
  });

  for (const [label, caught] of av) {
    ok(caught, `ANTI-VACUITY FAILURE: "${label}" was not caught — this check proves nothing`);
    console.log(`   ${caught ? '✓' : '✗'} ${label}`);
  }
}

console.log('');
console.log('=============== coherecheck ==============');
console.log(` assertions passed .. ${pass.toLocaleString()}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails.slice(0, 20)) console.log('   ✗ ' + f);
console.log('==========================================');
process.exit(fails.length ? 1 : 0);
