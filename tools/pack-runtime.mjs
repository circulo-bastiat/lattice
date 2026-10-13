#!/usr/bin/env node
// pack-runtime.mjs — PLAN F8b step 2. The block constants, in the shape the ENGINE needs.
//
//   node tools/pack-runtime.mjs [--out assets]
//
// `block-constants.json` is 900 blocks × 20,342 real states with everything the build knows.
// The runtime needs a subset, indexed differently, and in typed arrays rather than objects:
// the mesher reads this in its inner loop, and an object graph there is the difference
// between a chunk in 4 ms and a chunk in 40 (docs/archive/ARCH.md §3).
//
// Two indexings, and keeping them straight is the whole job:
//   VISUAL state — what the block looks like. What the mesher and the occlusion mask use.
//                  8,933 of them. Comes from the blockstates files.
//   REAL state   — what the block IS. What placement, collision and saving use. 20,342 of
//                  them. Comes from blocks.json, because blockstates JSON does not carry
//                  `waterlogged` or `powered` (D-29).
// Every real state maps to exactly one visual state; never the reverse.
//
// Collision boxes are stored as i16 in 1/1024 of a block. Vanilla's shapes are multiples of
// 1/16, so that is exact for every one of them, and it leaves room for the fence and wall
// boxes that stand 1.5 blocks tall.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

// The project root, derived from THIS FILE's location rather than hard-coded. Every tool
// here used to hard-code an absolute path, which meant the whole suite ran
// on exactly one machine — the checks synced to Dan's copy could not be run there at all.
import { fileURLToPath } from 'node:url';
const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));   // ends with a separator


const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const OUT = opt('out', MCLITE_ROOT + 'assets');

const t0 = Date.now();
const C = JSON.parse(readFileSync(join(OUT, 'block-constants.json'), 'utf8'));
const G = JSON.parse(readFileSync(join(OUT, 'block-geometry.json'), 'utf8'));
const items = JSON.parse(readFileSync(join(OUT, 'item-registry.json'), 'utf8'));

// The geometry file is the authority on block ORDER and on visual state counts, because it
// is what the mesher indexes into. Everything else is joined onto it.
const names = Object.keys(G.states);
const blocks = names.map((n) => C.blocks[n] || null);

// The standing/wall pairs, vanilla's `StandingAndWallBlockItem`: one ITEM, two blocks, chosen by
// whether you clicked a side. Derived by name rather than listed, so a block added to the data
// is picked up without editing this file.
const WALL_OF = [['_torch', '_wall_torch'], ['_sign', '_wall_sign'], ['_banner', '_wall_banner'],
                 ['_head', '_wall_head'], ['_skull', '_wall_skull'], ['_fan', '_wall_fan']];
const nameIndex = new Map(names.map((n, i) => [n, i]));
const pairs = [];
for (let i = 0; i < names.length; i++) {
  const n = names[i];
  if (n === 'torch' && nameIndex.has('wall_torch')) { pairs.push([i, nameIndex.get('wall_torch')]); continue; }
  for (const [suf, rep] of WALL_OF) {
    if (n.length <= suf.length || n.lastIndexOf(suf) !== n.length - suf.length) continue;
    const wall = n.slice(0, n.length - suf.length) + rep;
    const j = nameIndex.get(wall);
    if (j !== undefined) { pairs.push([i, j]); break; }
  }
}


// ---------------------------------------------------------------- shapes
const shapeIds = [...new Set(Object.values(C.blocks).flatMap((b) => b.collision))].sort((a, b) => a - b);
const shapeIndex = new Map(shapeIds.map((s, i) => [s, i]));
const shapes = shapeIds.map((s) => C.shapes[String(s)] || []);
let maxBoxes = 0, minQ = 0, maxQ = 0;
for (const sh of shapes) {
  maxBoxes = Math.max(maxBoxes, sh.length);
  for (const box of sh) for (const v of box) {
    const q = Math.round(v * 1024);
    if (Math.abs(q / 1024 - v) > 1e-9) throw new Error(`collision value ${v} is not a multiple of 1/1024`);
    minQ = Math.min(minQ, q); maxQ = Math.max(maxQ, q);
  }
}
if (maxBoxes > 255) throw new Error('a collision shape has more than 255 boxes');
if (minQ < -32768 || maxQ > 32767) throw new Error(`collision quantisation ${minQ}..${maxQ} does not fit i16`);

// ---------------------------------------------------------------- tools bitfield
const TOOLS = ['pickaxe', 'axe', 'shovel', 'hoe'];
const TIERS = [null, 'stone', 'iron', 'diamond'];

// ---------------------------------------------------------------- support class (D-140)
//
// ⚠ WHY THIS EXISTS. Session 4 measured **5,684 blocks in 169 chunks standing on nothing** —
// 2,864 dead bushes, 1,934 grass, 427 glow lichen, 47 mushrooms — because the feature pipeline
// asks only "is the target cell air?" before writing a plant, and W7's carvers may have taken
// the ground out from under the pre-carve heightmap the placement used (D-127, D-134). Vanilla
// does not have that bug because `SimpleBlockFeature.place` calls `state.canSurvive`, which is
// each block's own rule in compiled Java.
//
// What CAN be derived here is the class of rule, out of `material` in the pc dataset, which is
// vanilla's own `BlockTags`-adjacent grouping and not a guess:
//
//   1 FLOOR    material contains `plant` — grass, dead bush, flowers, saplings, mushrooms,
//              sugar cane, sweet berry bush: needs something under it.
//   2 CEILING  the six blocks that hang the other way up. `material` cannot tell them apart —
//              cave vines are `plant` exactly like grass — so they are NAMED, and a wrong list
//              is a visible wrong list rather than a silent one.
//   3 ANY      `vine_or_glow_lichen` — vanilla's own material name for the two multiface
//              blocks, which need one solid neighbour on any of the six faces.
//   4 BEHIND   a WALL-MOUNTED block: its support is the neighbour OPPOSITE its `facing`, which
//              is the wall it hangs on. Derived, not listed — it is exactly the wall half of a
//              standing/wall pair (D-157's table below) plus the two blocks whose facing follows
//              the clicked face. Vanilla's `WallTorchBlock.canSurvive` is this rule, and without
//              it a wall torch stays hanging in the air after you mine the wall (D-158).
//   0 none     everything else. The default is "no rule", so a block this build cannot classify
//              is placed exactly as it was before this change.
//
// Two blocks are deliberately left at 0 because the class here cannot express their rule:
// `pointed_dripstone` grows from a floor OR a ceiling (and nothing places it yet, featcheck §5),
// and `lily_pad` stands on WATER, which is not solid — its own feature already checks for it.
const NO_RULE_BLOCKS = new Set(['lily_pad', 'pointed_dripstone']);
const CEILING_BLOCKS = new Set([
  'cave_vines', 'cave_vines_plant', 'hanging_roots', 'spore_blossom',
  'weeping_vines', 'weeping_vines_plant',
]);
// The two halves of a standing/wall pair, from the table built above. The WALL half hangs on the
// block behind it (class 4, D-158); the STANDING half needs a floor under it (class 1) — and
// without that a torch had NO RULE AT ALL and stuck to the underside of blocks, which is what Dan
// found from play (D-167). `material` can say neither: a torch is not a plant.
const WALL_MOUNTED = new Set(['ladder', 'tripwire_hook', ...pairs.map(([, w]) => names[w])]);
const STANDING_HALF = new Set(pairs.map(([a]) => names[a]));
function supportClass(name, b) {
  if (NO_RULE_BLOCKS.has(name)) return 0;
  if (WALL_MOUNTED.has(name)) return 4;
  if (STANDING_HALF.has(name)) return 1;
  const m = b && b.material ? String(b.material) : '';
  if (m.indexOf('vine_or_glow_lichen') >= 0) return 3;
  if (CEILING_BLOCKS.has(name)) return 2;
  if (m.split(';').indexOf('plant') >= 0) return 1;
  return 0;
}

// ---------------------------------------------------------------- size
// ── the push-reaction table ─────────────────────────────────────────────────────────────────
// ⚠ READ, NOT RE-DERIVED. `tools/extract-push.mjs` owns the derivation (the material's default
// plus fourteen block overrides, out of the bytecode); this only joins it on. A block missing
// from it is a packing error, not a NORMAL block — the assertion below is the difference
// between the two.
const PUSH_CODE = { NORMAL: 0, DESTROY: 1, BLOCK: 2, IGNORE: 3, PUSH_ONLY: 4 };
const PUSH_TSV = join(MCLITE_ROOT, 'tools', 'golden', 'push-reaction-1.18.2.tsv');
const PUSH = new Map();
if (existsSync(PUSH_TSV)) {
  for (const line of readFileSync(PUSH_TSV, 'utf8').split('\n')) {
    if (!line || line[0] === '#') continue;
    const f = line.split('\t');
    PUSH.set(f[0], f[1]);
  }
}
// ⚠ TWO BLOCKS IN THIS ENGINE'S REGISTRY ARE NOT BLOCKS IN VANILLA. `item_frame` and
// `glow_item_frame` are ENTITIES there (`tools/models.mjs` calls them "entities wearing a
// block's clothes"), so the golden table — which is the jar's own `Blocks` roster — has no row
// for them, and it should not. They are named here with their vanilla answer rather than
// falling through a default: a piston DESTROYS an item frame, because in vanilla it collides
// with the entity and breaks it. Anything else missing is a packing error.
const NOT_IN_VANILLA_BLOCKS = { item_frame: 'DESTROY', glow_item_frame: 'DESTROY' };
for (const [n, r] of Object.entries(NOT_IN_VANILLA_BLOCKS)) if (!PUSH.has(n)) PUSH.set(n, r);
if (PUSH.size) {
  const missing = names.filter((n) => !PUSH.has(n));
  if (missing.length) {
    throw new Error(`push-reaction table is missing ${missing.length} blocks, first: ${missing.slice(0, 5).join(' ')}`);
  }
} else {
  console.log(' ⚠ no push-reaction table — every block will pack as NORMAL (run extract-push)');
}

let size = 0;
size += 2 + 2 + 4;                                  // blockCount, shapeCount, magic
for (const sh of shapes) size += 1 + sh.length * 12;
for (let i = 0; i < names.length; i++) {
  const b = blocks[i];
  size += 1 + Buffer.byteLength(names[i]);          // name
  size += 2 + 2;                                    // visual states, real states
  size += 4 + 4;                                    // hardness, resistance
  size += 1 + 1 + 1 + 1 + 1 + 1;                    // emit, filterLight, flags, stackSize, toolBits, push
  size += 2;                                        // defaultState
  size += G.states[names[i]].length;                // occlusion, one byte per VISUAL state
  const real = b ? b.stateCount : 1;
  size += real * 4;                                 // toVisual u16 + shape u16, per REAL state
}
const buf = Buffer.alloc(size);
let o = 0;
buf.write('MCLR', o, 'ascii'); o += 4;
buf.writeUInt16LE(names.length, o); o += 2;
buf.writeUInt16LE(shapes.length, o); o += 2;
for (const sh of shapes) {
  buf.writeUInt8(sh.length, o); o += 1;
  for (const box of sh) for (const v of box) { buf.writeInt16LE(Math.round(v * 1024), o); o += 2; }
}
const report = { blocks: 0, noConstants: [], realStates: 0, visualStates: 0, support: [0, 0, 0, 0, 0, 0, 0, 0] };
for (let i = 0; i < names.length; i++) {
  const name = names[i], b = blocks[i];
  if (!b) report.noConstants.push(name);
  const nb = Buffer.from(name, 'utf8');
  buf.writeUInt8(nb.length, o); o += 1; nb.copy(buf, o); o += nb.length;
  const vis = G.states[name].length;
  const real = b ? b.stateCount : 1;
  buf.writeUInt16LE(vis, o); o += 2;
  buf.writeUInt16LE(real, o); o += 2;
  buf.writeFloatLE(b && b.hardness != null ? b.hardness : Infinity, o); o += 4;
  buf.writeFloatLE(b && b.resistance != null ? b.resistance : Infinity, o); o += 4;
  buf.writeUInt8(b ? Math.min(15, b.emitLight | 0) : 0, o); o += 1;
  buf.writeUInt8(b ? Math.min(15, b.filterLight | 0) : 15, o); o += 1;
  // flags: 1 transparent · 2 diggable · 4 has a loot table · 8 requires a correct tool
  //
  // ⚠ bit 8 is vanilla's `requiresCorrectToolForDrops`, and it is what turns raw hardness into
  // a break time: `seconds = hardness * (requiresTool ? 100 : 30) / 20`. Without it stone
  // breaks bare-handed in 2.25 s instead of 7.5 s — a third of the real time, on the most
  // common block in the game. See the long note in tools/merge-constants.mjs.
  let flags = 0;
  if (b && b.transparent) flags |= 1;
  if (b && b.diggable) flags |= 2;
  if (b && b.lootTable) flags |= 4;
  if (b && b.requiresTool) flags |= 8;
  // bits 16|32: the support class (D-140), 0..3. See supportClass() above.
  const sup = supportClass(name, b) & 7;
  report.support[sup]++;
  flags |= sup << 4;
  // bit 128: vanilla's `Material.isReplaceable()` — may a placed block overwrite this one
  // (D-263). Bits 16|32|64 are the support class, so 128 is the only one left and it is the
  // right size for the question: replaceability is a MATERIAL property, therefore per block.
  // The state-level exceptions vanilla overrides in Java (snow layers, slab stacking, sea
  // pickles, candles, scaffolding) are `States.canBeReplacedBy` in src/02c_states.js.
  if (b && b.replaceable) flags |= 128;
  buf.writeUInt8(flags, o); o += 1;
  buf.writeUInt8(b ? Math.min(255, b.stackSize || 64) : 64, o); o += 1;
  // toolBits: low nibble = which tools mine it, high nibble = the tier it needs
  let toolBits = 0;
  if (b) {
    for (let t = 0; t < TOOLS.length; t++) if (b.tools.indexOf(TOOLS[t]) >= 0) toolBits |= (1 << t);
    toolBits |= (Math.max(0, TIERS.indexOf(b.needsTier)) & 15) << 4;
  }
  buf.writeUInt8(toolBits, o); o += 1;
  // ⚠ `PushReaction`, ONE BYTE PER BLOCK, from `tools/golden/push-reaction-1.18.2.tsv` (D-298).
  // It is a BLOCK property, not a state one: the fourteen block-level overrides in the jar are
  // per class, and no block in 1.18.2 gives two of its states different answers. G15c asks it
  // once per candidate cell of a slime blob, so it is a flat array and not a name lookup.
  buf.writeUInt8(PUSH_CODE[PUSH.get(name) || 'NORMAL'], o); o += 1;
  buf.writeUInt16LE(b ? b.defaultState : 0, o); o += 2;
  const occ = b ? b.occlusion : new Array(vis).fill(0);
  for (let s = 0; s < vis; s++) { buf.writeUInt8(occ[s] | 0, o); o += 1; }
  for (let s = 0; s < real; s++) {
    buf.writeUInt16LE(b ? b.toVisual[s] : 0, o); o += 2;
    buf.writeUInt16LE(b ? shapeIndex.get(b.collision[s]) : 0, o); o += 2;
  }
  report.blocks++; report.realStates += real; report.visualStates += vis;
}
if (o !== size) throw new Error(`wrote ${o} of ${size} bytes — the size calculation is wrong`);


// ---------------------------------------------------------------- the placement table (D-157)
//
// ⚠ WHY THIS EXISTS. A block id is a REAL STATE, so "place a torch" has to decide WHICH torch:
// vanilla's items resolve the state at placement time out of the clicked face, the player's
// facing and where on the face the click landed. Without that, `Player.placeBlock` wrote the
// hotbar's default state verbatim — a stair always faced north, a log was always vertical, and a
// torch clicked onto a WALL stayed the standing `torch`, which has no wall to stand on.
//
// The runtime deliberately does not carry property NAMES (900 blocks of them is 40 KB nobody
// needs), so this packs the SUBSET placement actually resolves, as numbers: for each block and
// each of five properties, the stride to multiply a value index by, and which of the shared
// values that property offers. Vanilla's local-state arithmetic is positional — properties in
// declaration order, the LAST varying fastest — so `local` decomposes into digits and one digit
// can be replaced without touching the others. That is `States.withProp`, and it is the whole
// primitive: everything placement needs is built on top of it.
// ⚠ THE TABLE IS NOW EVERY PROPERTY, NOT THE SIX PLACEMENT NEEDS (D-204). D-157 built it for
// placement alone — `facing`, `axis`, `half`, `type`, `face`, `waterlogged` — and hard-coded the
// two name lists, so `States.propValue(state, PROP.age)` returned -1 for every crop in the game.
// PLAN G2 and G3 both fall over on that: `age` is what a random tick advances and what
// `wheat`'s loot table reads to decide between wheat and seeds, `type=double` is why a double
// slab drops two, `part=head` is why a bed drops once, and 180 of the 835 loot tables carry a
// `block_state_property` condition naming one of them.
//
// The names are therefore DERIVED from `block-constants.json` rather than typed. The original
// six and nineteen are kept FIRST and in their original order so nothing that cached a numeric
// id across a rebuild can be surprised — ids are always looked up through `R.PROP` by name, but
// a stable table is cheaper to reason about than a proof that nothing depends on it.
const PROP_SEED = ['facing', 'axis', 'half', 'type', 'face', 'waterlogged'];
const VALUE_SEED = ['north', 'south', 'west', 'east', 'up', 'down',
                    'top', 'bottom', 'double', 'x', 'y', 'z', 'floor', 'wall', 'ceiling',
                    'true', 'false', 'upper', 'lower'];
const PROP_NAMES = [...PROP_SEED];
const VALUE_NAMES = [...VALUE_SEED];
{
  const p = new Set(PROP_SEED), v = new Set(VALUE_SEED);
  for (let i = 0; i < names.length; i++) {
    const b = blocks[i];
    for (const pr of (b && b.props) || []) {
      if (!p.has(pr.name)) { p.add(pr.name); PROP_NAMES.push(pr.name); }
      for (const val of pr.values) { const sv = String(val); if (!v.has(sv)) { v.add(sv); VALUE_NAMES.push(sv); } }
    }
  }
  // Both counts are written as a u8 by the format below, and both are checked rather than
  // assumed: 1.18.2 has 69 properties over 120 value strings, so the headroom is real but the
  // day a version bump crosses 255 must be a build failure and not a wrapped byte.
  if (PROP_NAMES.length > 255) throw new Error(`${PROP_NAMES.length} property names does not fit a u8`);
  if (VALUE_NAMES.length > 255) throw new Error(`${VALUE_NAMES.length} value names does not fit a u8`);
}
const PROP_ID = new Map(PROP_NAMES.map((n, i) => [n, i]));
const VALUE_ID = new Map(VALUE_NAMES.map((n, i) => [n, i]));

const placeEntries = [];
let strideMismatch = 0;
for (let i = 0; i < names.length; i++) {
  const b = blocks[i];
  if (!b || !b.props || !b.props.length) continue;
  // stride of property k = the product of the state counts of every property AFTER it
  let stride = 1;
  const strides = new Array(b.props.length);
  for (let k = b.props.length - 1; k >= 0; k--) { strides[k] = stride; stride *= b.props[k].values.length; }
  // ⚠ if the properties do not multiply out to the state count, the positional arithmetic this
  // table rests on is not true for that block, so it is SKIPPED and COUNTED rather than packed
  // with strides that would silently address the wrong state.
  if (stride !== b.stateCount) { strideMismatch++; continue; }
  for (let k = 0; k < b.props.length; k++) {
    const pid = PROP_ID.get(b.props[k].name);
    if (pid === undefined) continue;
    const vals = b.props[k].values.map((v) => VALUE_ID.get(v));
    if (vals.some((v) => v === undefined)) continue;      // a domain this table does not model
    placeEntries.push({ block: i, pid, stride: strides[k], vals });
  }
}

let psize = 4 + 1 + 1;
for (const n of PROP_NAMES) psize += 1 + Buffer.byteLength(n);
for (const n of VALUE_NAMES) psize += 1 + Buffer.byteLength(n);
psize += 2; for (const e of placeEntries) psize += 2 + 1 + 2 + 1 + e.vals.length;
psize += 2 + pairs.length * 4;
const pbuf = Buffer.alloc(psize);
let po = 0;
pbuf.write('MCLP', po, 'ascii'); po += 4;
pbuf.writeUInt8(PROP_NAMES.length, po); po += 1;
pbuf.writeUInt8(VALUE_NAMES.length, po); po += 1;
for (const n of [...PROP_NAMES, ...VALUE_NAMES]) {
  const nb = Buffer.from(n, 'utf8');
  pbuf.writeUInt8(nb.length, po); po += 1; nb.copy(pbuf, po); po += nb.length;
}
pbuf.writeUInt16LE(placeEntries.length, po); po += 2;
for (const e of placeEntries) {
  pbuf.writeUInt16LE(e.block, po); po += 2;
  pbuf.writeUInt8(e.pid, po); po += 1;
  pbuf.writeUInt16LE(e.stride, po); po += 2;
  pbuf.writeUInt8(e.vals.length, po); po += 1;
  for (const v of e.vals) { pbuf.writeUInt8(v, po); po += 1; }
}
pbuf.writeUInt16LE(pairs.length, po); po += 2;
for (const [a, w] of pairs) { pbuf.writeUInt16LE(a, po); po += 2; pbuf.writeUInt16LE(w, po); po += 2; }
if (po !== psize) throw new Error(`placement table wrote ${po} of ${psize} bytes`);
report.placeEntries = placeEntries.length;
report.placePairs = pairs.length;
report.strideMismatch = strideMismatch;

const packed = deflateRawSync(Buffer.concat([buf, pbuf]), { level: 9 });
writeFileSync(join(OUT, 'block-runtime.bin'), packed);
writeFileSync(join(OUT, 'block-runtime.meta.json'), JSON.stringify({
  rawBytes: buf.length + pbuf.length, packedBytes: packed.length,
  placeEntries: report.placeEntries, placePairs: report.placePairs,
  propNames: PROP_NAMES.length, valueNames: VALUE_NAMES.length,
  placeStrideMismatch: report.strideMismatch,
  blocks: report.blocks, realStates: report.realStates, visualStates: report.visualStates,
  shapes: shapes.length, maxBoxes, quantRange: [minQ, maxQ],
  support: { none: report.support[0], floor: report.support[1], ceiling: report.support[2], any: report.support[3], behind: report.support[4] },
  noConstants: report.noConstants,
  items: Object.keys(items.items).length,
}));

// round trip against the source, the same way pack-geometry does
const back = inflateRawSync(packed);
const identical = Buffer.compare(back, Buffer.concat([buf, pbuf])) === 0;

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log('');
console.log('================ pack-runtime ================');
console.log(` blocks ............ ${report.blocks}`);
console.log(` visual states ..... ${report.visualStates}`);
console.log(` real states ....... ${report.realStates}`);
console.log(` collision shapes .. ${shapes.length}   (max ${maxBoxes} boxes, quantised ${minQ}..${maxQ} in 1/1024)`);
console.log(` without constants . ${report.noConstants.length}  ${report.noConstants.join(' ')}`);
console.log(` placement table ... ${report.placeEntries} property entries over ${PROP_NAMES.length} properties and ${VALUE_NAMES.length} values · ${report.placePairs} standing/wall pairs · ${report.strideMismatch} blocks skipped (D-157, D-204)`);
console.log(` support classes ... floor ${report.support[1]} · ceiling ${report.support[2]} · any ${report.support[3]} · behind ${report.support[4]}   (D-140, D-158)`);
console.log('');
console.log(` raw ............... ${kb(buf.length)}`);
console.log(` deflated .......... ${kb(packed.length)}`);
console.log(` base64 ............ ${kb(packed.toString('base64').length)}`);
console.log(` deflate round trip  ${identical ? 'IDENTICAL' : 'MISMATCH'}`);
console.log(` ${Date.now() - t0} ms  ->  ${OUT}/block-runtime.bin`);
console.log('=============================================');
process.exit(identical ? 0 : 1);
