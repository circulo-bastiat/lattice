#!/usr/bin/env node
// pack-structures.mjs — PLAN W15. The 866 vanilla `.nbt` structure templates into one blob.
//
//   node tools/pack-structures.mjs [--jar <path>] [--out assets]
//
// PLAN W15 specifies the encoding rather than leaving it open, and this is that specification
// implemented: *"the 866 `.nbt` pieces re-encoded: one GLOBAL palette across all pieces, varint
// positions, RLE over sorted positions, DEFLATE, base64."*
//
// ── WHY EACH OF THOSE FOUR ─────────────────────────────────────────────────────────────────
//
//   ONE GLOBAL PALETTE   The 866 templates carry 1,047 DISTINCT block states between them and
//                        about 12,000 palette entries in total, because every village house
//                        repeats oak planks, cobblestone and its own five stair states. A
//                        per-template palette would ship those 12,000; a global one ships 1,047,
//                        and it is the same table the runtime resolves to real states once.
//   VARINT POSITIONS     A block's position is `(y*sz + z)*sx + x`, and the largest template is
//                        46x48x48, so an index fits in three varint bytes at worst and one at
//                        best. Storing three i32s per block would be 8.4 MB before compression.
//   RLE OVER SORTED      Sorted by that index, a template is mostly RUNS: a wall is a row of one
//                        state, a floor is a plane of one state. 699,080 block entries collapse
//                        to a fraction of that in runs.
//   DEFLATE + BASE64     The same shipping form as every other payload (D-12's ceiling is on the
//                        base64, so the +33% is counted).
//
// ── ⚠ WHAT IS DROPPED, AND WHY IT IS NOT A LOSS THIS BUILD CAN SEE ─────────────────────────
//
// A `blocks[]` entry may carry an `nbt` compound. Three kinds appear: JIGSAW blocks (the
// connector graph W15 exists to walk — kept, in a side table per template), and CHESTS and
// SPAWNERS with a `LootTable` or a `SpawnData`. This build has no block entities and no loot
// tables (PLAN G2/G17, D-141), so the second kind keeps its BLOCK and loses its contents, which
// is exactly what D-141 ruled for the dungeon's spawner. `entities[]` — 61 of them across all
// 866, armour stands and the odd villager — is dropped whole for the same reason.

import { writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { Jar } from './jarlib.mjs';
import { requireJar } from './paths.mjs';
import { readTemplate } from './nbt.mjs';
import { makeResolver, stateKey, parseStateString, rotateProps, DIRS } from './statelib.mjs';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const VERSION = opt('version', '1.18.2');
const OUT = opt('out', join(MCLITE_ROOT, 'assets'));
const JAR = opt('jar', requireJar(VERSION));
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const t0 = Date.now();
const jar = new Jar(JAR);

// ── THE BLOCK TAGS THE PROCESSORS NAME (PLAN W15's `tag_match`, D-187) ─────────────────────
//
// ⚠ ONE TAG, AND IT IS NOT OPTIONAL. Five of the 33 `processor_list` files — the five zombie
// village variants — carry a single rule: *anything in `minecraft:doors` becomes air*. That is
// what makes a zombie village a ruin rather than a village with green residents, and there is no
// way to honour it without knowing which blocks are doors. Block tags live in the jar at
// `data/minecraft/tags/blocks/`, not in the worldgen cache, so they are read here the same way
// D-183 read the biome tags — and only the ones a processor actually names, because PLAN G1 owns
// the general block-tag substrate and this is not it.
const PROCDIR = join(MCLITE_ROOT, '.mcdata', VERSION, 'data', 'minecraft', 'worldgen', 'processor_list');
const wantedTags = new Set();
{
  const walk = (n) => {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n && typeof n === 'object') {
      if (n.predicate_type === 'minecraft:tag_match' && typeof n.tag === 'string') wantedTags.add(n.tag.replace('minecraft:', ''));
      for (const k of Object.keys(n)) walk(n[k]);
    }
  };
  for (const f of (existsSync(PROCDIR) ? readdirSync(PROCDIR) : [])) {
    if (f.endsWith('.json')) walk(JSON.parse(readFileSync(join(PROCDIR, f), 'utf8')));
  }
}
const blockTags = new Map();
{
  const raw = new Map();
  for (const e of jar.names()) {
    const m = /^data\/minecraft\/tags\/blocks\/(.+)\.json$/.exec(e);
    if (m) raw.set(m[1], JSON.parse(jar.readText(e)));
  }
  const seen = new Set();
  const resolve = (name) => {
    if (seen.has(name)) return [];
    seen.add(name);
    const node = raw.get(name);
    if (!node) throw new Error('pack-structures: no block tag ' + name + ' in the jar');
    const out = [];
    for (const v of node.values) {
      if (typeof v !== 'string') continue;                 // an optional entry {id, required:false}
      if (v[0] === '#') out.push(...resolve(v.replace(/^#(minecraft:)?/, '')));
      else out.push(v.replace('minecraft:', ''));
    }
    seen.delete(name);
    return [...new Set(out)];
  };
  for (const t of wantedTags) blockTags.set(t, resolve(t));
}
const RE = /^data\/minecraft\/structures\/(.+)\.nbt$/;
const files = jar.names().filter((n) => RE.test(n)).sort();

const blockProps = JSON.parse(readFileSync(join(OUT, 'block-constants.json'), 'utf8')).blocks;
const RES = makeResolver(blockProps);
const strideChecked = RES.verify();

// ── the string table and the global palette ────────────────────────────────────────────────
const strings = new Map();
const intern = (s) => { let i = strings.get(s); if (i === undefined) { i = strings.size; strings.set(s, i); } return i; };
const palette = new Map();                   // canonical key -> palette index
const paletteRows = [];                      // [blockNameStringIndex, localState]
const paletteNodes = [];                     // the {Name, Properties} each row came from

function paletteOf(node) {
  const key = stateKey(node);
  let i = palette.get(key);
  if (i !== undefined) return i;
  i = paletteRows.length;
  palette.set(key, i);
  paletteRows.push([intern(String(node.Name).replace('minecraft:', '')), RES.resolveLocal(node)]);
  paletteNodes.push(node);
  return i;
}

// ── varint writing ─────────────────────────────────────────────────────────────────────────
const bytes = [];
const zz = (n) => (n >= 0 ? n * 2 : -n * 2 - 1);
function v(n) {
  if (n < 0 || !Number.isFinite(n)) throw new Error('pack-structures: cannot varint ' + n);
  n = n >>> 0;
  while (n >= 0x80) { bytes.push((n & 0x7f) | 0x80); n >>>= 7; }
  bytes.push(n);
}

const JOINT = { rollable: 0, aligned: 1 };

/** The front (0) or top (1) direction index of a jigsaw block state's `orientation`. */
function orientOf(node, which) {
  const o = (node.Properties && node.Properties.orientation) || 'north_up';
  const u = o.indexOf('_');
  const d = which === 0 ? o.slice(0, u) : o.slice(u + 1);
  const i = DIRS.indexOf(d);
  if (i < 0) throw new Error('pack-structures: unknown orientation half "' + d + '" in "' + o + '"');
  return i;
}

// ⚠ ONE OF VANILLA'S OWN `final_state` STRINGS DOES NOT PARSE, AND IT IS NOT A BUG HERE (D-186).
// `village/savanna/savanna_lamp_post_01.nbt` carries
//   "minecraft:acacia_fence[east=false,north=false,south=false,waterlogged=false,west=false]]"
// — a doubled closing bracket, in Mojang's shipped 1.18.2 jar. Java's `BlockStateParser` rejects
// it too; `JigsawBlockEntity` catches the parse failure, logs it, and uses AIR. So this does the
// same rather than "fixing" the string, because guessing what Mojang meant would make MC-Lite's
// lamp post differ from the real game's. Recorded by name and counted, so `structcheck` can
// assert it is still exactly one and still that file: a second one appearing is a real bug.
const badFinalStates = [];
function finalStatePalette(str, id) {
  try { return paletteOf(parseStateString(str)); }
  catch (e) { badFinalStates.push(`${id}: ${JSON.stringify(str)}`); return paletteOf({ Name: 'minecraft:air' }); }
}

// ── pass 1: read everything, so the palette is global before a single run is written ──────
const templates = [];
let rawBytes = 0, blockEntries = 0, paletteEntries = 0, droppedNbt = 0, droppedEntities = 0, packedEntities = 0, jigsaws = 0;
for (const f of files) {
  const buf = jar.read(f);
  rawBytes += buf.length;
  const t = readTemplate(buf);
  const id = RE.exec(f)[1];
  const [sx, sy, sz] = t.size;
  const idx = (p) => (p[1] * sz + p[2]) * sx + p[0];
  // ⚠ SORTED BY LINEAR INDEX, WHICH IS THE WHOLE POINT OF THE RLE. Mojang writes `blocks[]` in
  // no particular order; sorted, a wall is one run instead of forty entries.
  const order = t.blocks.map((b, i) => i).sort((a, b) => idx(t.blocks[a].pos) - idx(t.blocks[b].pos));
  for (const p of t.palettes) paletteEntries += p.length;

  const streams = [];
  for (const pal of t.palettes) {
    const runs = [];
    let prevEnd = 0;
    let runStart = -1, runLen = 0, runState = -1;
    const flush = () => { if (runStart >= 0) { runs.push([runStart - prevEnd, runLen, runState]); prevEnd = runStart + runLen; } };
    for (const oi of order) {
      const b = t.blocks[oi];
      const li = idx(b.pos);
      const gi = paletteOf(pal[b.state]);
      if (runStart >= 0 && li === runStart + runLen && gi === runState) { runLen++; continue; }
      flush();
      runStart = li; runLen = 1; runState = gi;
    }
    flush();
    streams.push(runs);
  }
  blockEntries += t.blocks.length;

  // the jigsaw side table, and only the jigsaw side table
  const jig = [], meta = [];
  for (const b of t.blocks) {
    if (!b.nbt) continue;
    if (b.nbt.id === 'minecraft:jigsaw') {
      jig.push({
        pos: idx(b.pos),
        name: intern(String(b.nbt.name).replace('minecraft:', '')),
        target: intern(String(b.nbt.target).replace('minecraft:', '')),
        pool: intern(String(b.nbt.pool).replace('minecraft:', '')),
        joint: JOINT[b.nbt.joint] === undefined ? 0 : JOINT[b.nbt.joint],
        final: finalStatePalette(b.nbt.final_state, id),
        // ⚠ THE CONNECTOR'S FACING IS RESOLVED HERE, NOT AT RUNTIME. It is the jigsaw block
        // state's `orientation` property — `<front>_<top>` — and `orientation` is not one of the
        // six properties the runtime placement table carries (see statelib's note), so the
        // engine could not read it back if it wanted to. Two direction indices instead.
        front: orientOf(t.palettes[0][b.state], 0),
        top: orientOf(t.palettes[0][b.state], 1),
      });
      jigsaws++;
    } else if (b.nbt.id === 'minecraft:structure_block' && typeof b.nbt.metadata === 'string' && b.nbt.metadata) {
      // DATA-mode markers (End City Chest/Sentry/Elytra, ...): the cell itself is never placed (D-212),
      // but SimpleStructurePiece.handleMetadata needs where it was and what it said (#4560).
      meta.push({ pos: idx(b.pos), data: intern(b.nbt.metadata) });
    } else droppedNbt++;
  }
  // the template's entities: id, position (x16, zigzag) and yaw. StructureTemplate.placeEntities
  // reads `pos` (template-relative doubles) and `nbt`; the rest of the NBT is the mob's own
  // freshly-made defaults here, and PersistenceRequired is set on every one at spawn.
  const ents = [];
  for (const e of t.entities) {
    if (!e.nbt || !e.nbt.id || !Array.isArray(e.pos)) { droppedEntities++; continue; }
    ents.push({ id: intern(String(e.nbt.id).replace('minecraft:', '')),
                p: e.pos.map((q) => Math.round(q * 16)),
                yaw: Array.isArray(e.nbt.Rotation) ? Math.round(e.nbt.Rotation[0]) : 0 });
    packedEntities++;
  }
  templates.push({ id, sx, sy, sz, streams, jig, ents, meta });
}

const rotPal = [];

// ── pass 2: write ──────────────────────────────────────────────────────────────────────────
bytes.push(0x4d, 0x4c, 0x53, 0x31);                       // "MLS1"
// the string table comes first and must therefore be complete: interning happened in pass 1,
// plus the template ids, which are interned here in file order.
for (const t of templates) t.nameIdx = intern(t.id);
// and the block tags, whose names and members are strings too
for (const [name, blocks] of blockTags) { intern(name); for (const b of blocks) intern(b); }

const strList = [...strings.keys()];
v(strList.length);
for (const s of strList) { const u = Buffer.from(s, 'utf8'); v(u.length); for (const b of u) bytes.push(b); }
// ── the rotation table (D-187) ────────────────────────────────────────────────────────────
// One clockwise quarter-turn per palette entry, as a palette index. Computed here because the
// runtime registry carries six property names and a template rotates by six DIFFERENT ones —
// see the long note in statelib.mjs. Rotating an entry can introduce a state no template
// contains, so the palette grows while this loop runs and the loop follows it.
let rotAdded = 0;
for (let i = 0; i < paletteRows.length; i++) {
  const node = paletteNodes[i];
  const rp = rotateProps(node.Properties);
  const rn = rp ? { Name: node.Name, Properties: rp } : node;
  const before = paletteRows.length;
  rotPal[i] = paletteOf(rn);
  if (paletteRows.length > before) rotAdded++;
}
// ⚠ THE INVARIANT, ASSERTED HERE RATHER THAN HOPED FOR: four turns is the identity, for every
// entry. A rotation that is not a bijection would turn a fence into a different fence every
// time a village faced a different way, and nothing downstream could tell.
let rotBad = 0;
for (let i = 0; i < paletteRows.length; i++) {
  if (rotPal[rotPal[rotPal[rotPal[i]]]] !== i) rotBad++;
}

v(paletteRows.length);
for (const [nameIdx, local] of paletteRows) { v(nameIdx); v(local < 0 ? 0 : local); }
for (let i = 0; i < paletteRows.length; i++) v(rotPal[i]);
v(blockTags.size);
for (const [name, blocks] of blockTags) {
  v(intern(name)); v(blocks.length);
  for (const b of blocks) v(intern(b));
}

v(templates.length);
let runCount = 0;
for (const t of templates) {
  v(t.nameIdx); v(t.sx); v(t.sy); v(t.sz);
  v(t.streams.length);
  for (const runs of t.streams) {
    v(runs.length);
    runCount += runs.length;
    for (const [gap, len, st] of runs) { v(gap); v(len); v(st); }
  }
  v(t.jig.length);
  for (const j of t.jig) { v(j.pos); v(j.name); v(j.target); v(j.pool); v(j.joint); v(j.final); v(j.front); v(j.top); }
  v(t.ents.length);
  for (const e of t.ents) { v(e.id); for (const q of e.p) v(zz(q)); v(zz(e.yaw)); }
  v(t.meta.length);
  for (const m of t.meta) { v(m.pos); v(m.data); }
}

const blob = Buffer.from(bytes);
const deflated = deflateRawSync(blob, { level: 9 });
// ⚠ Round trip before writing, the same rule pack-worldgen has: a blob that does not inflate
// back to itself fails at boot on a player's machine instead of here.
if (Buffer.compare(inflateRawSync(deflated), blob) !== 0) {
  console.error('FATAL: the structure blob does not round-trip through deflate'); process.exit(1);
}

writeFileSync(join(OUT, 'structures.bin'), deflated);
const meta = {
  version: VERSION, templates: templates.length, rawBytes,
  blobBytes: blob.length, packedBytes: deflated.length,
  base64Bytes: Math.ceil(deflated.length / 3) * 4,
  strings: strList.length, palette: paletteRows.length, paletteEntries,
  blockEntries, runs: runCount, jigsaws, droppedNbt, droppedEntities, packedEntities,
  rotationAdded: rotAdded, rotationNotBijective: rotBad,
  blockTags: [...blockTags.keys()], blockTagBlocks: [...blockTags.values()].reduce((a, l) => a + l.length, 0),
  unresolved: RES.fails.length, strideChecked,
  unparseableFinalStates: badFinalStates,
};
writeFileSync(join(OUT, 'structures.meta.json'), JSON.stringify(meta, null, 2));

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log('');
console.log('============== pack-structures ==============');
console.log(` templates ......... ${templates.length}   ${kb(rawBytes)} of gzip'd NBT in the jar`);
console.log(` block entries ..... ${blockEntries.toLocaleString()}  ->  ${runCount.toLocaleString()} runs (${(blockEntries / runCount).toFixed(1)} blocks a run)`);
console.log(` global palette .... ${paletteRows.length} states, against ${paletteEntries.toLocaleString()} per-template entries`);
console.log(` jigsaw blocks ..... ${jigsaws}`);
console.log(` block tags ........ ${blockTags.size} (${[...blockTags.keys()].join(', ')}) — ${[...blockTags.values()].reduce((a, l) => a + l.length, 0)} blocks`);
console.log(` rotation table .... ${paletteRows.length} entries (${rotAdded} states only a rotation produces); four turns is the identity for ${paletteRows.length - rotBad}/${paletteRows.length}`);
console.log(` dropped ........... ${droppedNbt} block entities, ${packedEntities} entities packed, ${droppedEntities} unreadable dropped (no block entities in this build — D-141)`);
console.log(` packed ............ ${kb(blob.length)} raw -> ${kb(deflated.length)} deflated -> ${kb(meta.base64Bytes)} as base64`);
for (const b of badFinalStates) console.log(`   ! unparseable final_state, air substituted as vanilla does: ${b}`);
for (const f of RES.fails.slice(0, 10)) console.log('   ! ' + f);
console.log(` UNRESOLVED STATES . ${RES.fails.length}`);
console.log(` ${Date.now() - t0} ms  ->  ${join(OUT, 'structures.bin')}`);
console.log('=============================================');
process.exit(RES.fails.length + rotBad ? 1 : 0);
