#!/usr/bin/env node
import { getCachedColumn } from './chunkcache.mjs'; // D-456: shared worldgen chunk cache
// featgroundcheck.mjs — D-418: NOTHING A FEATURE PLACES MAY BE LEFT HANGING IN THE AIR.
//
//   node tools/featgroundcheck.mjs [--verbose] [--print]
//
// ⚠ THE BUG THIS FILE EXISTS TO CATCH, AND WHY IT IS A CLASS. Dan played the shipped build and
// reported azalea trees growing on water. They were: over a pond in a badlands, `heightmapY`
// hands back the cell ABOVE the water, `root_system` planted the tree there, the tree's own
// `isFree` test then refused every LOG (water is not free) and let every LEAF through — and what
// shipped was a canopy hanging in mid-air with no trunk under it at all.
//
// That is not one feature's bug. It is what happens to ANY feature that writes as it goes and
// cannot un-write: `setBlock` refuses the parts that break a rule and keeps the parts that do
// not, so a half-refused feature leaves its debris behind. Vanilla's features are atomic — they
// test their preconditions and `return false` before writing anything — and the observable
// consequence of getting that wrong is always the same shape: **a lump of feature blocks with
// nothing but air around it.**
//
// So the rule is stated on the WORLD, not on any feature:
//
//     Every connected component of feature-placed blocks must touch something that is not air.
//
// It needs no list of features, no per-feature predicate table, and no update when a feature is
// added. A trunk touches dirt. A canopy touches its trunk. A lily pad touches water. An ore vein
// touches stone. A canopy with no trunk touches nothing, and neither does anything else this
// class of bug produces.
//
// ⚠ HOW "FEATURE-PLACED" IS DECIDED, WITHOUT A LIST. The same chunks are generated TWICE — once
// with `features: true` and once with `features: false` — and a cell whose block differs is one a
// feature wrote. Structures run in both passes and cancel. That is a referee rather than a guess:
// it asks the generator itself which blocks it owns.
//
// Sections:
//   1. the sample — one padded region, generated twice
//   2. every feature component touches something
//   3. every feature block that has a SURVIVAL rule satisfies it (at or above sea level; #19)
//   4. anti-vacuity — a hand-made floating canopy must be caught; so must a hand-broken support

import { loadEngine } from './loadsrc.mjs';

const VERBOSE = process.argv.includes('--verbose') || process.argv.includes('--print');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 30) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; if (VERBOSE) console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const p = (...a) => console.log('   ' + a.join(' '));

console.log('featgroundcheck — D-418, no feature may be left hanging in the air');

const SEED = 1337;
const R = 5;                                    // chunk radius: 11x11 = 121 chunks
function engine(features, extra) {
  const M = loadEngine(extra ? { extra } : {});
  M.Gen.init(SEED, Object.assign(M.Gen.defaults(), { climate: 'vanilla', features }));
  return M;
}
const A = engine(true, ['02f_tags.js', '07b_behaviour.js', '07_world.js']), B = engine(false);
const CFG = A.CFG, S = A.Section, SR = A.States, SECY = CFG.SECTIONS_Y, H = CFG.CHUNK_H;
const MINY = CFG.WORLD_MIN_Y;
const names = A.Reg.names;
const nm = (st) => names[SR.block[st]];

// ── 1. the sample ───────────────────────────────────────────────────────────────────────────
console.log('\n1. the sample — 121 chunks at seed 1337, generated with and without features');
const t0 = Date.now();
const NC = 2 * R + 1, W_ = NC * 16;
const on = new Uint16Array(W_ * H * W_), off = new Uint16Array(W_ * H * W_);
const IX = (x, y, z) => (y * W_ + z) * W_ + x;
for (let cx = -R; cx <= R; cx++) for (let cz = -R; cz <= R; cz++) {
  const ca = getCachedColumn(A, cx, cz), cb = getCachedColumn(B, cx, cz); // D-456: shared worldgen chunk cache
  const ox = (cx + R) * 16, oz = (cz + R) * 16;
  for (let sy = 0; sy < SECY; sy++) {
    const sa = ca.sec[sy], sb = cb.sec[sy];
    for (let i = 0; i < 4096; i++) {
      const y = (sy << 4) | (i >> 8), lz = (i >> 4) & 15, lx = i & 15;
      on[IX(ox + lx, y, oz + lz)] = S.get(sa, i);
      off[IX(ox + lx, y, oz + lz)] = S.get(sb, i);
    }
  }
}
const genMs = Date.now() - t0;
let featCells = 0;
const isFeat = new Uint8Array(W_ * H * W_);
// ⚠⚠ **ADDED INTO AIR, NOT MERELY CHANGED.** A feature that REPLACES an existing block inherits
// whatever was holding that block up: an ore vein turns stone into diorite, and a lone stone
// voxel left standing in a cave by the carver becomes a lone diorite voxel — which was already
// floating, as terrain, before any feature ran. Judging those flagged 319 components, every one
// of them a carver artefact and none of them this class of bug. The blocks this rule is about
// are the ones a feature put where there was NOTHING, which is the only way a feature can create
// a floating lump of its own.
for (let i = 0; i < on.length; i++) {
  if (on[i] !== 0 && off[i] === 0) { isFeat[i] = 1; featCells++; }
}
p(`generated in ${(genMs / 1000).toFixed(1)} s · ${featCells} cells a feature owns`);
ok(featCells > 5000, `only ${featCells} feature cells in 121 chunks — the sample is too thin to judge`);

// ── 2. every component touches something ────────────────────────────────────────────────────
console.log('\n2. every connected component of feature blocks touches a non-air block');
function sweep(featMask, blocks) {
  const seen = new Uint8Array(W_ * H * W_);
  const stack = new Int32Array(1 << 16);
  const floating = [];
  let comps = 0;
  for (let y = 1; y < H - 1; y++) for (let z = 1; z < W_ - 1; z++) for (let x = 1; x < W_ - 1; x++) {
    const i0 = IX(x, y, z);
    if (!featMask[i0] || seen[i0]) continue;
    comps++;
    let sp = 0, anchored = false, size = 0, edge = false;
    stack[sp++] = i0; seen[i0] = 1;
    let minX = x, minY = y, minZ = z;
    while (sp > 0) {
      const i = stack[--sp]; size++;
      const cx2 = i % W_, cy2 = (((i / W_) | 0) / W_) | 0, cz2 = (((i / W_) | 0) % W_);
      if (cx2 <= 1 || cx2 >= W_ - 2 || cz2 <= 1 || cz2 >= W_ - 2) edge = true;   // border: unjudgeable
      if (cx2 < minX) minX = cx2; if (cy2 < minY) minY = cy2; if (cz2 < minZ) minZ = cz2;
      const nb = [i - 1, i + 1, i - W_, i + W_, i - W_ * W_, i + W_ * W_];
      for (let k = 0; k < 6; k++) {
        const j = nb[k];
        if (j < 0 || j >= featMask.length) continue;
        if (featMask[j]) { if (!seen[j]) { seen[j] = 1; if (sp < stack.length) stack[sp++] = j; } continue; }
        if (blocks[j] !== 0) anchored = true;
      }
    }
    if (!anchored && !edge) floating.push({ x: minX - R * 16, y: minY + MINY, z: minZ - R * 16, size, st: blocks[i0] });
  }
  return { comps, floating };
}
const r2 = sweep(isFeat, on);
p(`${r2.comps} feature components · ${r2.floating.length} floating`);
if (r2.floating.length && VERBOSE) {
  const by = new Map();
  for (const f of r2.floating) {
    const k = nm(f.st) + ' y' + (f.y < 0 ? '<0' : (f.y < 63 ? '0..62' : '>=63'));
    by.set(k, (by.get(k) || 0) + 1);
  }
  [...by.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, c]) => p(`  ${k}: ${c}`));
  for (const f of r2.floating.filter(f => f.y >= 55).slice(0, 10)) p(`  SURFACE floating ${nm(f.st)} x${f.size} at ${f.x},${f.y},${f.z}`);
}
ok(r2.comps > 2000, `only ${r2.comps} components — the sweep found nothing to judge`);

// ⚠⚠ **THE CLAIM IS SCOPED TO AT-OR-ABOVE SEA LEVEL, AND THE SCOPE IS D-213's, NOT A THRESHOLD
// PICKED OFF TODAY'S NUMBERS.** Above the sea the terrain a placement sees is a pure function of
// position (`Column.height`, D-134) and the verdict here is exact. BELOW it the world is cut by
// carvers — a 240-block random walk that no point query can answer, which 04j's own header and
// 04k's `maxFreeHeight` both already name as the one approximation this pipeline makes — so a
// feature's anchoring underground is being judged against a world its placement never saw. The
// underground count is MEASURED AND PRINTED on every run rather than hidden, and KW-25 carries
// what is owed. Restating the claim with the gap named is D-329's own instruction; moving a
// number until it passes is what D-329 forbids.
const SEA = A.Gen.params.seaLevel;
const above = r2.floating.filter((f) => f.y >= SEA);
const below = r2.floating.length - above.length;
p(`${above.length} floating at or above sea level (y ${SEA}) · ${below} below it (KW-25, carver-cut world)`);
ok(above.length === 0,
   `${above.length} feature component(s) at or above sea level hang in the air with nothing but air around them` +
   (above.length ? ` — first: ${nm(above[0].st)} x${above[0].size} at ${above[0].x},${above[0].y},${above[0].z}` : ''));

// ── 3. THE SECOND CAUSE, CLOSED BY #19 (KW-25) ──────────────────────────────────────────────
//
// ⚠⚠ **THE TWO DOORS USED TO ASK DIFFERENT RULES.** `World.setBlock` asks `States.rule` FIRST — the
// jar-derived table D-346 read out of vanilla's 55 `canSurvive` overrides — and `Features.setBlock`
// asked only the material-derived support CLASS, so a worldgen-placed glow lichen, small dripleaf or
// vine could stand where the live game breaks it the first time anything near it is touched (D-418
// measured 12 of 13,799 in this very sample). #19 wrote the rules once against a LEVEL (`02k`),
// gave worldgen one over its scratch buffer, and shipped the eleven tags the rules ask to the
// workers (`WG.ruleTag`). What this section asserts is the door, in the two ways that can fail:
//
//   a. THE GATE IS OPEN — the same 121 chunks generated with `Survive.eval` stubbed to "no opinion"
//      (the pre-#19 worldgen) leave MORE rule-breaking feature blocks than the real worldgen does,
//      so the count below is a property of the gate and not of the sample. That is also this
//      section's anti-vacuity: the stub is the break, and it must be caught.
//   b. AT OR ABOVE SEA LEVEL NOTHING BREAKS — scoped exactly as §2 is, and for §2's reason: below
//      it the world is cut by carvers that no point query can answer (D-213), so what is left there
//      is measured and PRINTED, not asserted.
console.log('\n3. the two survival doors — #19: worldgen asks the same rule the live game does');
{
  const W = A.World;
  A.Behave.init(W);
  W.init(SEED);
  for (let cx = -R; cx <= R; cx++) for (let cz = -R; cz <= R; cz++) W.installChunk(cx, cz, getCachedColumn(A, cx, cz)); // D-456: reuses section 1's cache
  const SEA3 = A.Gen.params.seaLevel;
  // rule-carrying feature blocks in `arr` (a region laid out like `on`) that the LIVE rule refuses
  function measure(arr, world) {
    let ruled = 0, classOnly = 0, above = 0, below = 0; const bad = [];
    for (let y = 1; y < H - 1; y++) for (let z = 2; z < W_ - 2; z++) for (let x = 2; x < W_ - 2; x++) {
      const i = IX(x, y, z);
      if (!isFeat[i] || arr[i] === 0) continue;
      const st = arr[i];
      const hasClass = SR.support && SR.support[st];
      const hasRule = SR.rule && SR.rule[st];
      if (!hasClass && !hasRule) continue;
      if (hasRule) ruled++; else { classOnly++; continue; }
      const wx = x - R * 16, wy = y + MINY, wz = z - R * 16;
      if (!world.canSurvive(wx, wy, wz, st)) {
        if (wy >= SEA3) above++; else below++;
        if (bad.length < 12) bad.push(`${nm(st)} at ${wx},${wy},${wz}`);
      }
    }
    return { ruled, classOnly, above, below, bad };
  }
  const m = measure(on, W);
  p(`${m.ruled} feature blocks carry a jar RULE the worldgen gate now asks · ${m.classOnly} carry only a class`);
  p(`${m.above} of them break the rule the LIVE game applies at or above sea level · ${m.below} below it (carver-cut, KW-25)` +
    (m.bad.length ? `: ${m.bad.join(' · ')}` : ''));
  ok(m.ruled + m.classOnly > 100, `only ${m.ruled + m.classOnly} ruled feature blocks in the sample — the measurement has no sample`);
  ok(m.ruled > 1000, `only ${m.ruled} feature blocks carry a jar rule — §3 is judging nothing`);
  ok(m.above === 0, `${m.above} feature block(s) at or above sea level break the jar rule the live game applies — first: ${m.bad[0]}`);

  // a. the same region with the pre-#19 worldgen: the rule stubbed to "no opinion", the class alone decides
  const C = engine(true);
  C.Survive.eval = () => -1;
  const off3 = new Uint16Array(W_ * H * W_);
  for (let cx = -R; cx <= R; cx++) for (let cz = -R; cz <= R; cz++) {
    const cc = C.Gen.genColumn(cx, cz), ox = (cx + R) * 16, oz = (cz + R) * 16;
    for (let sy = 0; sy < SECY; sy++) for (let i = 0; i < 4096; i++) {
      off3[IX(ox + (i & 15), (sy << 4) | (i >> 8), oz + ((i >> 4) & 15))] = C.Section.get(cc.sec[sy], i);
    }
  }
  // its feature mask differs from the real one, so judge it on ITS OWN added cells
  const savedFeat = isFeat.slice();
  for (let i = 0; i < on.length; i++) isFeat[i] = (off3[i] !== 0 && off[i] === 0) ? 1 : 0;
  const m0 = measure(off3, W);
  isFeat.set(savedFeat);
  p(`with the rule gate stubbed out (pre-#19): ${m0.above} above sea level · ${m0.below} below`);
  okAv(m0.above + m0.below > m.above + m.below,
       `the pre-#19 worldgen must leave more rule-breaking feature blocks (${m0.above + m0.below}) than the real one (${m.above + m.below})`);
}

// ── 4. anti-vacuity ─────────────────────────────────────────────────────────────────────────
console.log('\n4. anti-vacuity — the sweep must catch a floating lump when there is one');
{
  // Plant the exact bug back: a 3x3x3 lump of azalea leaves in open air, high above the terrain.
  const LEAF = SR.stateOf('azalea_leaves') | 0;
  const mask = Uint8Array.from(isFeat);
  const blocks = Uint16Array.from(on);
  const bx = R * 16, bz = R * 16, by = H - 12;     // well above any terrain, in open air
  let planted = 0;
  for (let dy = 0; dy < 3; dy++) for (let dz = 0; dz < 3; dz++) for (let dx = 0; dx < 3; dx++) {
    const i = IX(bx + dx, by + dy, bz + dz);
    if (blocks[i] !== 0) { planted = -1; break; }
    mask[i] = 1; blocks[i] = LEAF; planted++;
  }
  okAv(planted === 27, `the anti-vacuity lump needs 27 cells of open air at y=${by + MINY} (planted ${planted})`);
  const base = r2.floating.length;
  const broken = sweep(mask, blocks);
  okAv(broken.floating.length === base + 1 && broken.floating.some(f => f.size === 27),
       `a 27-block canopy planted in open air must be reported as floating (baseline ${base}, got ${broken.floating.length})`);
  // and one block of that lump touching the terrain must make it anchored again
  const mask2 = Uint8Array.from(isFeat), blocks2 = Uint16Array.from(on);
  // find a surface cell and stack a leaf directly on it
  let put = false;
  for (let y = H - 2; y > 1 && !put; y--) {
    const i = IX(bx, y, bz);
    if (blocks2[i] !== 0) { const j = IX(bx, y + 1, bz); mask2[j] = 1; blocks2[j] = LEAF; put = true; }
  }
  okAv(put, 'the anchored control needs a surface cell to stand its leaf on');
  const anchored = sweep(mask2, blocks2);
  okAv(anchored.floating.length === base,
       `a leaf standing ON the terrain must NOT be reported as floating (baseline ${base}, got ${anchored.floating.length})`);
}

// ── result ──────────────────────────────────────────────────────────────────────────────────
if (fails.length) {
  console.log('\n=============== featgroundcheck ===============');
  console.log(` assertions passed .. ${pass}`);
  console.log(` failures ........... ${fails.length}`);
  console.log(` breaks caught ...... ${breaks}`);
  console.log('==============================================');
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('\n=============== featgroundcheck ===============');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... 0`);
console.log(` breaks caught ...... ${breaks}`);
console.log('==============================================');
