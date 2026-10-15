#!/usr/bin/env node
// pack-biomeparams.mjs — PLAN W4. The compiled overworld multi-noise climate parameter table.
//
//   node tools/pack-biomeparams.mjs [--data <mcdata>] [--out assets]
//
// ── WHAT THIS IS, AND WHY IT WAS THE PLAN'S LONGEST-STANDING OPEN ITEM (D-112) ───────────
// `MultiNoiseBiomeSource.Preset.OVERWORLD` is the table that turns six climate numbers into a
// biome. In 1.18.2 it is BUILT IN JAVA — `OverworldBiomeBuilder` writes it out with a hundred
// hand-written `addSurfaceBiome` calls — so it is in no jar, and it is in none of the eleven
// `worldgen/*` registries `fetch-vanilla-data.mjs` mirrors. PLAN W4 named three routes to it
// and the risk register carried it as risk #2 for two sessions.
//
// All three routes were wrong or blocked. The one that works was a twelfth registry nobody
// had looked in: **`data/minecraft/dimension/overworld.json`**. The data generator writes the
// overworld dimension out too, and a dimension carries its `biome_source` fully expanded —
// which is the preset, already compiled, verbatim from Mojang's own generator.
//
// Measured on the 1.18.2 mirror: **7,578 entries over 50 biomes**, 4.3 MB of JSON.
//
// (The third route PLAN listed — "derive it from the 61 biome files' own `climate` blocks" —
// would have produced a wrong table quietly. Those blocks carry the 1.17 fields
// `temperature`/`downfall`/`precipitation`, which are the *rendering* climate, not these six
// noise axes. Recording that here so nobody re-opens it.)
//
// ── THE FORMAT, AND WHY IT IS INTEGERS ───────────────────────────────────────────────────
// Vanilla does not compare these as floats. `Climate.quantizeCoord(float f) = (long)(f*10000)`
// and every comparison downstream is long arithmetic. So the packer quantises the same way and
// ASSERTS that every one of the 106,092 numbers in the table is an exact multiple of 1/10000 —
// it is, all of them — which means the quantisation is lossless here rather than a rounding
// this build chose. The range comes out −12000..10000, so i16 holds it with room to spare.
//
// Seven axes are stored, not six. The seventh is `offset`, which is 0 for every entry in this
// table and contributes 0 to every distance. It is stored anyway, and asserted to be zero,
// because a version where it is not zero should change the numbers rather than be silently
// dropped by a packer that "knew" it was always zero.
//
// ── THE R-TREE IS BAKED, NOT BUILT AT BOOT (D-113) ───────────────────────────────────────
// Vanilla answers "which biome" with `Climate.RTree`: a 7-dimensional bounding-volume tree
// over the 7,578 entries, searched by branch-and-bound. Measured here: searching it costs
// **2.5 us** against **37 us** for a linear scan of all 7,578 — a 15x difference that decides
// whether a chunk's 1,536 biome lookups cost 4 ms or 57 ms.
//
// But BUILDING it costs 92 ms, and it would have to be built on the main thread AND in every
// worker, every launch, to produce a structure that is a pure function of data that never
// changes. So it is built once, here, and shipped flat. That is the governing principle
// applied to an index instead of to geometry: bake the expensive part.
//
// The build is Mojang's, not a reinvention: 10 children per node, choose the split axis by
// minimising the summed bounding-box edge length over all 7 axes, bucket into
// 10^floor(log10(n-0.01)) groups, recurse. `tools/climcheck.mjs` proves the shipped tree
// returns the true nearest entry by testing it against a brute-force scan of all 7,578, and
// proves the test is not vacuous by corrupting the tree and watching it fail.
//
// One deliberate difference from Java. Vanilla's `RTree.search` seeds its search with a
// ThreadLocal `lastResult` — the previous query's answer — as the initial best. That is a
// pure speed hack for the nearest-neighbour bound EXCEPT when two entries are exactly
// equidistant, where it makes the answer depend on WHICH QUERY CAME BEFORE. This project's
// determinism rule (PLAN W0: the same coordinate gives the same answer in any order, on any
// thread, forever) forbids that, so it is not ported. Ties are broken by traversal order
// instead, which is a pure function of the tree. Measured: 279 of 20,000 random queries land
// on a tie at all, and the tree's pick is at the same distance in every one of them.
//
// Layout, little-endian:
//
//   0   u32   magic 'MCBP'
//   4   u16   format version
//   6   u16   biomeCount
//   8   u32   entryCount
//   12  u32   nameBytes
//   16  u32   nodeCount        internal R-tree nodes
//   20  u32   kidCount         total child slots
//   24        the biome names, UTF-8, '\n'-separated, in index order
//   ...       padded to a 2-byte boundary
//   +   i16 x entryCount x 14   min,max for T,H,C,E,D,W,O  (quantised, x10000)
//   +   i16 x nodeCount  x 14   the same, for each internal node's bounding box
//   +   u16 x entryCount        biome index
//   +   u32 x (nodeCount+1)     first child slot per node, plus the end sentinel
//   +   i32 x kidCount          a child: >= 0 an internal node, < 0 the entry ~n
//
// The root is node 0. Leaves are not stored as nodes: a leaf's bounding box IS its entry's
// parameter ranges, so storing them again would be 212 KB of duplication.
//
// deflated, then base64 into `19_data.gen.js` like every other blob. Round-tripped before it
// is written, for the same reason `pack-worldgen.mjs` does it: a blob that does not inflate
// back to itself fails at boot on a player's machine instead of here.

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { MCDATA } from './paths.mjs';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const VERSION = opt('version', '1.18.2');
const DATADIR = join(opt('data', MCDATA), VERSION);   // session 5: was a second 'MCDATA', now the shared one from paths.mjs
const DIM = join(DATADIR, 'data', 'minecraft', 'dimension', 'overworld.json');
const BIOMEDIR = join(DATADIR, 'data', 'minecraft', 'worldgen', 'biome');
const OUT = opt('out', MCLITE_ROOT + 'assets');
const FORMAT = 1;

if (!existsSync(DIM)) {
  console.error('no dimension cache at ' + DIM + '\n  run: node tools/fetch-vanilla-data.mjs');
  process.exit(1);
}

const t0 = Date.now();
const fail = [];
const raw = readFileSync(DIM, 'utf8');
const dim = JSON.parse(raw);

// ---------------------------------------------------------------- read and check
if (dim.type !== 'minecraft:overworld') fail.push(`dimension type is ${dim.type}, not minecraft:overworld`);
const gen = dim.generator || {};
if (gen.type !== 'minecraft:noise') fail.push(`generator type is ${gen.type}, not minecraft:noise`);
if (gen.settings !== 'minecraft:overworld') fail.push(`generator settings is ${gen.settings}, not minecraft:overworld`);
const bs = gen.biome_source || {};
if (bs.type !== 'minecraft:multi_noise') fail.push(`biome_source type is ${bs.type}, not minecraft:multi_noise`);
const entries = bs.biomes;
if (!Array.isArray(entries) || !entries.length) { console.error('no biome entries in ' + DIM); process.exit(1); }

// The seven axes, in vanilla's `ParameterPoint.parameterSpace()` order. That order is not
// cosmetic: the R-tree sorts on axis INDEX, so a different order builds a different tree.
const AXES = ['temperature', 'humidity', 'continentalness', 'erosion', 'depth', 'weirdness', 'offset'];

const biomeNames = [...new Set(entries.map((e) => e.biome))].sort();
const biomeIndex = new Map(biomeNames.map((n, i) => [n, i]));

// Cross-source check, and the only one available here: every biome this table dispatches to
// must exist in the 61-file biome registry W5 is going to read. A table that names a biome the
// build does not have is a table that will place a biome-shaped hole.
if (existsSync(BIOMEDIR)) {
  const have = new Set(readdirSync(BIOMEDIR).filter((f) => f.endsWith('.json')).map((f) => 'minecraft:' + f.replace(/\.json$/, '')));
  for (const n of biomeNames) if (!have.has(n)) fail.push(`biome not in worldgen/biome registry: ${n}`);
} else {
  fail.push('no worldgen/biome cache at ' + BIOMEDIR);
}

// ---------------------------------------------------------------- quantise
const Q = 10000;
const N = entries.length;
const par = new Int16Array(N * 14);
const bio = new Uint16Array(N);

let nonIntegral = 0, offsetNonZero = 0, inverted = 0, qmin = Infinity, qmax = -Infinity;
const distinct = AXES.map(() => new Set());

for (let i = 0; i < N; i++) {
  const e = entries[i];
  const p = e.parameters || {};
  bio[i] = biomeIndex.get(e.biome);
  for (let a = 0; a < 7; a++) {
    const v = p[AXES[a]];
    if (v === undefined) { fail.push(`entry ${i}: no ${AXES[a]}`); continue; }
    const lo = Array.isArray(v) ? v[0] : v;
    const hi = Array.isArray(v) ? v[1] : v;
    distinct[a].add(JSON.stringify(v));
    // The lossless-quantisation assertion. Not decoration: if a future version's table carries
    // a value that is not a multiple of 1/10000, this build would round it silently and place
    // a biome one cell wide in the wrong place.
    const ql = lo * Q, qh = hi * Q;
    if (Math.abs(ql - Math.round(ql)) > 1e-6 || Math.abs(qh - Math.round(qh)) > 1e-6) nonIntegral++;
    const l = Math.round(ql), h = Math.round(qh);
    if (h < l) inverted++;
    if (AXES[a] === 'offset' && (l !== 0 || h !== 0)) offsetNonZero++;
    if (l < qmin) qmin = l;
    if (h > qmax) qmax = h;
    if (l < -32768 || h > 32767) fail.push(`entry ${i} ${AXES[a]}: ${l}..${h} does not fit i16`);
    par[i * 14 + a * 2] = l;
    par[i * 14 + a * 2 + 1] = h;
  }
}
if (nonIntegral) fail.push(`${nonIntegral} parameter values are not exact multiples of 1/${Q} — quantisation would be lossy`);
if (inverted) fail.push(`${inverted} parameter ranges have max < min`);
if (offsetNonZero) fail.push(`${offsetNonZero} entries have a non-zero offset — the runtime's 7th axis assumption needs re-reading`);

// Duplicate entries would be harmless but would mean the mirror had drifted; say so rather
// than absorb it.
const seen = new Set();
let dup = 0;
for (const e of entries) { const k = JSON.stringify(e); if (seen.has(k)) dup++; seen.add(k); }

// ---------------------------------------------------------------- build the R-tree
// Mojang's `Climate.RTree.build`, on the quantised integers. A node here is a plain object
// while the tree is being built and disappears into flat arrays below.
const CHILDREN_PER_NODE = 10;

function entrySpace(i) { const sp = new Int32Array(14); for (let a = 0; a < 14; a++) sp[a] = par[i * 14 + a]; return sp; }
function unionSpace(ns) {
  const sp = new Int32Array(14);
  for (let a = 0; a < 7; a++) { sp[a * 2] = Infinity; sp[a * 2 + 1] = -Infinity; }
  for (const n of ns) for (let a = 0; a < 7; a++) {
    if (n.space[a * 2] < sp[a * 2]) sp[a * 2] = n.space[a * 2];
    if (n.space[a * 2 + 1] > sp[a * 2 + 1]) sp[a * 2 + 1] = n.space[a * 2 + 1];
  }
  return sp;
}
const mid = (n, a) => (n.space[a * 2] + n.space[a * 2 + 1]) / 2;
// ⚠ Java sorts on the chosen axis and then on the other six CYCLICALLY as tie-breakers.
// deepslate's port drops the tie-breakers and leans on sort stability. The tie-breakers are
// kept here: they cost nothing at pack time and they make the tree a pure function of the
// table rather than of the sort implementation.
function cmpOn(axis, abs) {
  return (x, y) => {
    for (let k = 0; k < 7; k++) {
      const a = (axis + k) % 7;
      let vx = mid(x, a), vy = mid(y, a);
      if (abs) { vx = Math.abs(vx); vy = Math.abs(vy); }
      if (vx !== vy) return vx - vy;
    }
    return 0;
  };
}
const edgeSum = (sp) => { let f = 0; for (let a = 0; a < 7; a++) f += Math.abs(sp[a * 2 + 1] - sp[a * 2]); return f; };
function bucketize(ns) {
  const out = [];
  let cur = [];
  const n = Math.pow(CHILDREN_PER_NODE, Math.floor(Math.log(ns.length - 0.01) / Math.log(CHILDREN_PER_NODE)));
  for (const x of ns) { cur.push(x); if (cur.length >= n) { out.push({ children: cur, space: unionSpace(cur) }); cur = []; } }
  if (cur.length) out.push({ children: cur, space: unionSpace(cur) });
  return out;
}
function buildNode(ns) {
  if (ns.length === 1) return ns[0];
  if (ns.length <= CHILDREN_PER_NODE) {
    const sorted = ns.slice().sort((x, y) => {
      let kx = 0, ky = 0;
      for (let a = 0; a < 7; a++) { kx += Math.abs(mid(x, a)); ky += Math.abs(mid(y, a)); }
      return kx - ky;
    });
    return { children: sorted, space: unionSpace(sorted) };
  }
  let bestCost = Infinity, bestAxis = -1;
  for (let a = 0; a < 7; a++) {
    const bk = bucketize(ns.slice().sort(cmpOn(a, false)));
    let c = 0;
    for (const b of bk) c += edgeSum(b.space);
    if (c < bestCost) { bestCost = c; bestAxis = a; }
  }
  const bk = bucketize(ns.slice().sort(cmpOn(bestAxis, false))).sort(cmpOn(bestAxis, true));
  const kids = bk.map((b) => buildNode(b.children));
  return { children: kids, space: unionSpace(kids) };
}

const tBuild = Date.now();
const leaves = [];
for (let i = 0; i < N; i++) leaves.push({ space: entrySpace(i), entry: i });
const root = buildNode(leaves);
const buildMs = Date.now() - tBuild;
if (root.entry !== undefined) fail.push('the R-tree root is a leaf — a one-entry table would break the flat layout');

// Flatten. Internal nodes get an index in visit order; a child slot holds the node index, or
// ~entryIndex for a leaf.
const nodeList = [];
(function assign(n) { n.idx = nodeList.length; nodeList.push(n); for (const c of n.children) if (c.children) assign(c); })(root);
const nodeCount = nodeList.length;
const kidTotal = nodeList.reduce((a, n) => a + n.children.length, 0);
const nspace = new Int16Array(nodeCount * 14);
const koff = new Uint32Array(nodeCount + 1);
const kid = new Int32Array(kidTotal);
let kp = 0, maxKids = 0;
for (let i = 0; i < nodeCount; i++) {
  const n = nodeList[i];
  for (let a = 0; a < 14; a++) nspace[i * 14 + a] = n.space[a];
  koff[i] = kp;
  if (n.children.length > maxKids) maxKids = n.children.length;
  for (const c of n.children) kid[kp++] = c.children ? c.idx : ~c.entry;
}
koff[nodeCount] = kp;
if (kp !== kidTotal) fail.push(`child slots written ${kp} != ${kidTotal}`);

// Structural invariants, asserted rather than trusted:
//   * every entry is a leaf exactly once — a lost entry is a biome that can never be chosen
//   * every node's box contains every child's box — the branch-and-bound prune is only valid
//     if that holds, and a violated one would silently return a wrong-but-plausible biome
{
  const seenLeaf = new Uint8Array(N);
  let dupLeaf = 0, containment = 0;
  for (let i = 0; i < nodeCount; i++) {
    for (let k = koff[i]; k < koff[i + 1]; k++) {
      const c = kid[k];
      const cs = c >= 0 ? nspace : par;
      const cb = (c >= 0 ? c : ~c) * 14;
      if (c < 0) { if (seenLeaf[~c]) dupLeaf++; seenLeaf[~c] = 1; }
      for (let a = 0; a < 7; a++) {
        if (cs[cb + a * 2] < nspace[i * 14 + a * 2] || cs[cb + a * 2 + 1] > nspace[i * 14 + a * 2 + 1]) containment++;
      }
    }
  }
  let missing = 0;
  for (let i = 0; i < N; i++) if (!seenLeaf[i]) missing++;
  if (missing) fail.push(`${missing} entries are in no leaf of the R-tree`);
  if (dupLeaf) fail.push(`${dupLeaf} entries appear as more than one leaf`);
  if (containment) fail.push(`${containment} child bounds escape their parent's box — branch-and-bound would prune wrongly`);
  if (maxKids > CHILDREN_PER_NODE) fail.push(`a node has ${maxKids} children, more than CHILDREN_PER_NODE=${CHILDREN_PER_NODE}`);
}

// ---------------------------------------------------------------- pack
const nameBuf = Buffer.from(biomeNames.join('\n'), 'utf8');
let head = 24 + nameBuf.length;
if (head & 1) head++;                       // i16 view must start aligned
const parOff = head;
const nspOff = parOff + N * 14 * 2;
const bioOff = nspOff + nodeCount * 14 * 2;
let koffOff = bioOff + N * 2;
if (koffOff & 3) koffOff += 4 - (koffOff & 3);   // u32 view must start 4-aligned
const kidOff = koffOff + (nodeCount + 1) * 4;
const total = kidOff + kidTotal * 4;
const buf = Buffer.alloc(total);
buf.write('MCBP', 0, 'ascii');
buf.writeUInt16LE(FORMAT, 4);
buf.writeUInt16LE(biomeNames.length, 6);
buf.writeUInt32LE(N, 8);
buf.writeUInt32LE(nameBuf.length, 12);
buf.writeUInt32LE(nodeCount, 16);
buf.writeUInt32LE(kidTotal, 20);
nameBuf.copy(buf, 24);
const put = (ta, off) => Buffer.from(ta.buffer, ta.byteOffset, ta.byteLength).copy(buf, off);
put(par, parOff); put(nspace, nspOff); put(bio, bioOff); put(koff, koffOff); put(kid, kidOff);

const deflated = deflateRawSync(buf, { level: 9 });
const back = inflateRawSync(deflated);
if (!back.equals(buf)) { console.error('FATAL: biome-params blob does not round-trip through deflate'); process.exit(1); }

// And a read-back of the packed bytes against the source JSON, entry by entry, because the
// round-trip above only proves deflate works — not that the writer and the reader agree on
// the layout. This is the same shape of check `pack-geometry.mjs` runs.
{
  const p2 = new Int16Array(back.buffer, back.byteOffset + parOff, N * 14);
  const b2 = new Uint16Array(back.buffer, back.byteOffset + bioOff, N);
  const k2 = new Int32Array(back.buffer, back.byteOffset + kidOff, kidTotal);
  const names2 = back.slice(24, 24 + nameBuf.length).toString('utf8').split('\n');
  let bad = 0;
  for (let i = 0; i < N && bad < 5; i++) {
    if (names2[b2[i]] !== entries[i].biome) { fail.push(`read-back entry ${i}: biome ${names2[b2[i]]} != ${entries[i].biome}`); bad++; continue; }
    for (let a = 0; a < 7; a++) {
      const v = entries[i].parameters[AXES[a]];
      const lo = Math.round((Array.isArray(v) ? v[0] : v) * Q), hi = Math.round((Array.isArray(v) ? v[1] : v) * Q);
      if (p2[i * 14 + a * 2] !== lo || p2[i * 14 + a * 2 + 1] !== hi) {
        fail.push(`read-back entry ${i} ${AXES[a]}: ${p2[i * 14 + a * 2]}..${p2[i * 14 + a * 2 + 1]} != ${lo}..${hi}`); bad++; break;
      }
    }
  }
  for (let k = 0; k < kidTotal; k++) if (k2[k] !== kid[k]) { fail.push(`read-back child slot ${k}: ${k2[k]} != ${kid[k]}`); break; }
}

writeFileSync(join(OUT, 'biome-params.bin'), deflated);
const meta = {
  version: VERSION, format: FORMAT, quantum: Q,
  entries: N, biomes: biomeNames.length,
  nodes: nodeCount, kids: kidTotal, maxKids, childrenPerNode: CHILDREN_PER_NODE, buildMs,
  offsets: { par: parOff, nspace: nspOff, bio: bioOff, koff: koffOff, kid: kidOff },
  rawBytes: buf.length, packedBytes: deflated.length, sourceBytes: raw.length,
  distinctRanges: Object.fromEntries(AXES.map((a, i) => [a, distinct[i].size])),
  qmin, qmax, duplicateEntries: dup,
  names: biomeNames,
};
writeFileSync(join(OUT, 'biome-params.meta.json'), JSON.stringify(meta));

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log('');
console.log('================ pack-biomeparams ================');
console.log(` source ............ ${kb(raw.length)}  dimension/overworld.json`);
console.log(` entries ........... ${N}   over ${biomeNames.length} biomes`);
for (let a = 0; a < 7; a++) console.log(`   ${AXES[a].padEnd(18)} ${String(distinct[a].size).padStart(3)} distinct ranges`);
console.log(` R-tree ............ ${nodeCount} internal nodes, ${kidTotal} child slots, max ${maxKids}/node, built in ${buildMs} ms`);
console.log(` quantised range ... ${qmin} .. ${qmax}  (i16 holds -32768..32767)`);
console.log(` duplicate entries . ${dup}`);
console.log(` packed ............ ${kb(buf.length)} raw -> ${kb(deflated.length)} deflated -> ${kb(deflated.length * 4 / 3)} as base64`);
console.log(` failures .......... ${fail.length}`);
for (const f of fail.slice(0, 20)) console.log('   ! ' + f);
console.log(` ${Date.now() - t0} ms  ->  ${join(OUT, 'biome-params.bin')}`);
console.log('==================================================');
process.exit(fail.length ? 1 : 0);
