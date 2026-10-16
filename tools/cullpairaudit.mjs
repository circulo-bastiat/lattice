#!/usr/bin/env node
// cullpairaudit.mjs — #1889 KW-CULL: the END-TO-END face-cull audit. Blocks that stay solid but are not drawn
// are a face the mesher DROPPED where vanilla draws it. cullruleaudit proves the static mask; this puts real
// state PAIRS next to each other in a real World, meshes through the real snapshot (so chunk and section
// seams, and a missing neighbour chunk, are the real code paths) and compares the QUADS EMITTED with
// vanilla's Block.shouldRenderFace (1.18.2 Block.java: `!neighbour.canOcclude() || !Block.isFaceFull(neighbour
// .getOcclusionShape, opposite)`; skipRendering = same-block glass/ice/slime/honey/fluid).
//
//   node tools/cullpairaudit.mjs [--stride=16 | --full] [--verbose]   (default samples every 16th state; --full = every state, ~15 min)
//
// culled(A,d,B) = quads(A alone) + quads(B alone) - quads(A and B adjacent). Reference per side: the
// face may go missing only where B.canOcclude (SR.canOcclude, from the bytecode tsv) and B's collision shape
// covers the touching plane (cullruleaudit's two independent references). Any more quads missing than the
// two sides are allowed = an invisible face. (Under-culling is overdraw, not a hole, and greedy merging of look-alike cubes would make an exact count unsound.)
// Placements: interior; across a chunk seam (x/z) or section seam (y); chunk seam with the neighbour chunk absent
// The mesher treats an absent neighbour chunk as solid (its face is dropped), which is safe ONLY because World.stream meshes a
// column when all 8 neighbours are generated (D-147, neighbourhoodReady): asserted below instead of paired.

import { loadEngine } from './loadsrc.mjs';

const STRIDE = +((process.argv.find((a) => a.startsWith('--stride=')) || '=16').split('=')[1]), FULL = process.argv.includes('--full'), VERBOSE = process.argv.includes('--verbose');
const M = loadEngine({ extra: ['07_world.js', '08_lighting.js'], dom: false });
const W = M.World, S = M.Section, Me = M.Mesher, CH = M.CH, CFG = M.CFG, R = M.Reg, SR = M.States;
Me.setOptions({ ao: true, cross: true, fastLeaves: false, realModels: true, smooth: true });
let pass = 0; const fails = [];
const ok = (c, m) => { if (c && /^anti-vacuity/.test(m)) console.log('  ✓ ' + m); if (c) pass++; else if (fails.length < 25) fails.push(m); return c; };

W.init(1); M.Light.init(); M.Light.setAdapter(M.Light.worldAdapter());
for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) W.getOrCreate(cx, cz).state = CH.GENERATED;

const DIR = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const FACE = [[0, 0], [0, 1024], [1, 0], [1, 1024], [2, 0], [2, 1024]];   // as cullruleaudit
const quads = (h) => { if (!h) return 0; const x = Me.readHeader(h); return x.quads[0] + x.quads[1] + x.quads[2] + x.modelQuads[0] + x.modelQuads[1] + x.modelQuads[2]; };
const secOf = (x, y, z) => [x >> 4, z >> 4, (y - CFG.WORLD_MIN_Y) >> 4];
const meshQ = (cells) => {
  const seen = new Set(); let n = 0;
  for (const [x, y, z] of cells) {
    const [cx, cz, sy] = secOf(x, y, z), k = cx + ',' + cz + ',' + sy;
    if (seen.has(k)) continue; seen.add(k);
    const snap = W.snapshotFor(cx, cz, sy); n += quads(Me.mesh(snap, null)); W.releaseSnap(snap);
  }
  return n;
};
// raw section write: W.setBlock would run survival cascades (an unsupported torch/door removes itself) and move the pair
const put = (p, id) => { const ly = p[1] - CFG.WORLD_MIN_Y; S.set(W.get(p[0] >> 4, p[2] >> 4).sec[ly >> 4], ((ly & 15) << 8) | ((p[2] & 15) << 4) | (p[0] & 15), id); };

function covers(state, ax, plane) {   // cullruleaudit's reference: does the collision shape cover the whole touching face?
  const sh = R.shapeOf[state], a = R.shapeOff[sh], b = R.shapeOff[sh + 1], u = (ax + 1) % 3, v = (ax + 2) % 3;
  const cell = new Uint8Array(256);
  for (let i = a; i < b; i++) {
    const o = i * 6, lo = [R.shapeBox[o], R.shapeBox[o + 1], R.shapeBox[o + 2]], hi = [R.shapeBox[o + 3], R.shapeBox[o + 4], R.shapeBox[o + 5]];
    if (plane === 0 ? lo[ax] !== 0 : hi[ax] !== 1024) continue;
    for (let x = Math.floor(lo[u] / 64); x < Math.ceil(hi[u] / 64); x++) for (let y = Math.floor(lo[v] / 64); y < Math.ceil(hi[v] / 64); y++) cell[x * 16 + y] = 1;
  }
  return cell.every((c) => c);
}
/** may a face of a block touching `nb` (at direction f from it) be culled, per vanilla? */
const mayCull = (nb, f) => nb !== 0 && SR.canOcclude[SR.block[nb]] === 1 && covers(nb, FACE[f][0], FACE[f][1]);

// the neighbour roster: the kinds the issue names, first and last state of each
const B = [0];
for (const n of ['stone', 'glass', 'oak_leaves', 'water', 'lava', 'stone_slab', 'oak_stairs', 'oak_fence', 'oak_door', 'oak_trapdoor', 'piston', 'sticky_piston',
  'piston_head', 'cauldron', 'snow', 'farmland', 'dirt_path', 'soul_sand', 'honey_block', 'slime_block', 'ice', 'glowstone', 'chest', 'glass_pane', 'iron_bars', 'hopper', 'composter', 'oak_slab']) {
  const b = R.id[n]; if (b === undefined) continue;
  B.push(R.realFirst[b], R.realFirst[b + 1] - 1);
}
const alone = new Map();
// at the SAME cell as in the pair: weighted-random model variants (chorus plant) are picked by world position
const aloneQ = (s, p) => { const k = s + '@' + p; let q = alone.get(k); if (q === undefined) { put(p, s); q = meshQ([p]); put(p, 0); alone.set(k, q); } return q; };

// placement: where A sits so that A+d crosses the seam; kind 0 interior, 1 seam, 2 seam with the neighbour chunk absent
function place(kind, d) {
  const dv = DIR[d], p = [5, 70, 5];                              // interior: y local (70+64)&15 = 6
  if (kind === 0) return [p, [p[0] + dv[0], p[1] + dv[1], p[2] + dv[2]]];
  if (kind === 2) { const a = [dv[0] > 0 ? 31 : dv[0] < 0 ? 16 : 20, 70, dv[2] > 0 ? 31 : dv[2] < 0 ? 16 : 20]; return [a, [a[0] + dv[0], a[1], a[2] + dv[2]]]; }
  const a = [dv[0] > 0 ? 15 : dv[0] < 0 ? 0 : 5, dv[1] > 0 ? 79 : dv[1] < 0 ? 64 : 70, dv[2] > 0 ? 15 : dv[2] < 0 ? 0 : 5];  // y 79/64 = section-local 15/0
  return [a, [a[0] + dv[0], a[1] + dv[1], a[2] + dv[2]]];
}

let pairs = 0, overCull = 0;
function pair(a, b, d, kind, hook) {
  const [pa, pb] = place(kind, d);
  const qa = aloneQ(a, pa), qb = kind === 2 ? 0 : aloneQ(b, pb);       // kind 2: the neighbour chunk does not exist, B is not placed
  put(pa, a); if (kind !== 2) put(pb, b);
  let q = meshQ(kind === 2 ? [pa] : [pa, pb]);
  put(pa, 0); if (kind !== 2) put(pb, 0);
  if (hook) q = hook(q);
  pairs++;
  const culled = qa + qb - q;
  const allowA = kind === 2 ? false : mayCull(b, d), allowB = kind === 2 ? false : mayCull(a, d ^ 1);
  const sameKind = SR.block[a] === SR.block[b];
  if (sameKind || (SR.fluidKind[a] && SR.fluidKind[b] && kind !== 2)) return 0;   // two fluids (a waterlogged state holds water): FluidRenderer.isSameFluid, not shouldRenderFace
                                           // skipRendering / greedy merge: not this audit's rule
  const cap = (allowA ? qa : 0) + (allowB ? qb : 0);
  if (culled > cap) { overCull++; return `${R.names[SR.block[a]]}#${a} -> ${d} ${R.names[SR.block[b]]}#${b} kind${kind}: ${culled} quads missing, vanilla allows at most ${cap}`; }
  return 0;
}

const run = (hook, k) => {
  const stride = k ? 16 * k : FULL ? 1 : STRIDE;
  const bad = [];
  const seenK = new Set();
  const tally = (r) => { if (!r) return; const k = r.split(' ')[0].replace(/#\d+/, '') + r.split(' kind')[1].slice(0, 1); if (!seenK.has(k)) { seenK.add(k); bad.push(r); } };
  for (let s = 1; s < SR.count; s += stride) {
    const nb = B.length;
    for (let i = 0; i < nb; i++) {
      const d = (s + i) % 6;
      tally(pair(s, B[i], d, 0, hook)); tally(pair(s, B[i], d ^ 1, 0, hook));
    }
  }
  const st2 = k ? 29 * k : FULL ? 1 : 29;
  for (let s = 1; s < SR.count; s += st2) for (let i = 0; i < B.length; i += 3) for (const d of [0, 1, 2, 3, 4, 5]) { tally(pair(s, B[i], d, 1, hook)); }
  return bad;
};

// the guard that makes the absent-neighbour case unreachable: never meshed until the 3x3 is generated, and re-dirtied when it is
ok(W.neighbourhoodReady(0, 0), 'a column whose 8 neighbours are generated is meshable');
ok(!W.neighbourhoodReady(1, 0), 'a column with an absent neighbour chunk is NOT meshed (its seam faces would be dropped)');
W.get(-1, -1).state = CH.NONE !== undefined ? CH.NONE : 0;
ok(!W.neighbourhoodReady(0, 0), 'a column with a not-yet-generated neighbour is NOT meshed');
W.get(-1, -1).state = CH.GENERATED;
const t0 = Date.now();
const bad = run();
ok(bad.length === 0, `${overCull} pair(s) mesh differently from vanilla shouldRenderFace:\n     ` + bad.join('\n     '));
ok(pairs > 1000, `the audit is non-trivial (${pairs} pairs)`);


// ---- light/AO sampling at seams: a face whose light read is 0 draws BLACK and reads as invisible -------------------
// stone S on a chunk/section seam, a glowstone 2 cells out on the open side: the quad of S facing it must carry the
// glowstone's light (the neighbour cell's, 14 next to a source), the same as when no seam is crossed. Also through glass.
const GLOWSTONE = SR.stateOf('glowstone'), STONE = SR.stateOf('stone'), GLASS = SR.stateOf('glass');
const faceLight = (S0, f) => {   // max block light over the cube quads of S0's section whose face is f at S0's cell
  const [cx, cz, sy] = secOf(S0[0], S0[1], S0[2]);
  const snap = W.snapshotFor(cx, cz, sy), buf = Me.mesh(snap, null); W.releaseSnap(snap);
  if (!buf) return -1;
  const h = Me.readHeader(buf), a = new Uint32Array(buf);
  const lx = S0[0] & 15, ly = (S0[1] - CFG.WORLD_MIN_Y) & 15, lz = S0[2] & 15;
  let best = -1;
  for (let L = 0; L < 3; L++) for (let i = 0; i < h.quads[L]; i++) {
    const o = (h.off[L] >> 2) + i * 8, d0 = a[o];
    if (((d0 >>> 18) & 7) !== f || (d0 & 63) < lx || ((d0 >>> 6) & 63) < ly || ((d0 >>> 12) & 63) < lz) continue;
    for (let v = 0; v < 4; v++) { const w = a[o + v * 2]; if (((w & 63) === lx + (f === 0 ? 1 : 0)) || ((w & 63) === lx)) best = Math.max(best, (w >>> 27) & 15); }
  }
  return best;
};
const lightAt = (kind, stale) => {
  const bad = []; let n = 0;
  for (let d = 0; d < 6; d++) for (const glass of [false, true]) {
    const dv = DIR[d];
    const [pa] = place(kind, d);
    const mid = [pa[0] + dv[0], pa[1] + dv[1], pa[2] + dv[2]], far = [pa[0] + 2 * dv[0], pa[1] + 2 * dv[1], pa[2] + 2 * dv[2]];
    const cells = [[pa, STONE], [mid, glass ? GLASS : 0], [far, GLOWSTONE]];
    for (const [p, id] of cells) if (id) W.setBlock(p[0], p[1], p[2], id);
    if (!stale) M.Light.settle(1e6);
    const got = faceLight(pa, d); n++;
    if (got < 12) bad.push(`stone face ${d} at ${pa} ${glass ? 'through glass ' : ''}kind${kind}: light ${got}, glowstone two cells out should give >=12`);
    for (const [p] of cells) W.setBlock(p[0], p[1], p[2], 0);
    M.Light.settle(1e6);
  }
  return { bad, n };
};
let lightN = 0;
for (const kind of [0, 1]) { const r = lightAt(kind); lightN += r.n; ok(r.bad.length === 0, `light at the ${kind ? 'seam' : 'interior'}:\n     ` + r.bad.join('\n     ')); }
ok(lightN === 24, `light cases run (${lightN})`);

// --- anti-vacuity: drop a face the mesher would draw; the audit must notice --------------------------
let breaks = 0;
{
  // a mesher that loses one quad whenever the pair spans a seam, and one on every 5th interior pair
  let n = 0;
  const b1 = (q) => (++n % 5 === 0 ? q - 1 : q);
  const saved = [pairs, overCull]; const b = run(b1, 12); breaks++;
  ok(b.length > 0, 'anti-vacuity: a mesher dropping a drawn face was not caught');
  [pairs, overCull] = saved;
}
{
  // an occluding neighbour wrongly treated as a non-occluder by the reference makes a vanilla cull look like over-culling
  const keep = SR.canOcclude.slice(); SR.canOcclude.fill(0); const sv = [pairs, overCull];
  const b = run(null, 12); breaks++; SR.canOcclude.set(keep); [pairs, overCull] = sv;
  ok(b.length > 0, 'anti-vacuity: a reference that allows no culling was not caught');
}
{
  // the mesher culling against leaves (canOcclude=false) as if they were solid
  const sv = [pairs, overCull], c0 = SR.cull.slice(); for (let s = R.realFirst[R.id.glass]; s < R.realFirst[R.id.glass + 1]; s++) SR.cull[s] = 63;
  const b = run(null, 12); breaks++; SR.cull.set(c0); [pairs, overCull] = sv;
  ok(b.length > 0, 'anti-vacuity: glass given a full cull mask was not caught');
}
{
  // a seam read of light that was never propagated (the face would draw black) must be seen
  const r = lightAt(1, true); breaks++;
  ok(r.bad.length > 0, 'anti-vacuity: an unlit seam face (light 0) was not caught');
  M.Light.settle(1e6);
}
if (VERBOSE) console.log(`   ${pairs} pairs, ${Date.now() - t0} ms`);
if (fails.length) { console.log(fails.map((f) => '  x ' + f).join('\n')); console.log(`\nFAIL cullpairaudit — ${fails.length} failure(s)`); process.exit(1); }
console.log(`cullpairaudit: ${pass} assertions, 0 failures (${breaks} anti-vacuity), ${breaks} breaks caught`);
