#!/usr/bin/env node
// pack-mining.mjs — PLAN G3's tool tables. Which item mines what, and how fast.
//
//   node tools/pack-mining.mjs [--out assets] [--pc <project>/.mcdata/pc]
//
// ── THE TWO QUESTIONS G3 ASKS, AND WHERE THE ANSWERS REALLY LIVE ─────────────────────────
// Vanilla's break time is
//
//     speed         = the HELD ITEM's `getDestroySpeed(stack, state)`
//     damagePerTick = speed / hardness / (canHarvest ? 30 : 100)
//
// and both of those inner terms are a Java method call per (item, block) pair:
//
//   * `getDestroySpeed` — `DiggerItem` returns its tier speed when the block is in the tool's
//     `mineable/*` tag and 1.0 otherwise; `SwordItem` returns 15 for cobweb and 1.5 for the
//     plant-ish materials; `ShearsItem` returns 15 for cobweb and leaves, 5 for wool, 2 for
//     vines. Six overrides, no data file.
//   * `isCorrectToolForDrops` — `DiggerItem` compares its TIER LEVEL against the
//     `needs_stone_tool` / `needs_iron_tool` / `needs_diamond_tool` tags and then asks its own
//     `mineable/*` tag; `SwordItem` and `ShearsItem` override it outright for cobweb.
//
// ⚠ **BOTH ARE ALREADY EVALUATED, PAIR BY PAIR, IN THE `pc` DATASET**, which is why this file
// invents nothing (D-201). `materials.json` is `getDestroySpeed` as a table: 16 material
// classes, each a map from item id to the speed that item returns for a block of that class,
// and every block in `blocks.json` carries its class. `harvestTools` is `isCorrectToolForDrops`
// as a table: present exactly when `requiresCorrectToolForDrops` is set (D-102 leaned on the
// same fact), and listing the item ids that answer true — INCLUDING cobweb's swords-and-shears
// override, which no tier comparison would produce.
//
// So the compiled-Java gap that PLAN G3 anticipated is not a gap at all. The tier SPEEDS PLAN
// quotes (wood 2, stone 4, iron 6, diamond 8, netherite 9, gold 12) are reproduced by this
// table rather than typed from PLAN, and `minecheck` §2 asserts that they are.
//
// What is genuinely NOT here: the tier LEVEL integers (wood 0, stone 1, iron 2, diamond 3,
// netherite 4, gold 0) from `Tiers.java`. Nothing needs them — a level exists only to be
// compared against the `needs_*_tool` tags, and `harvestTools` is that comparison's ANSWER.
// A level is therefore neither ported nor guessed.
//
// ── THE FORMAT ───────────────────────────────────────────────────────────────────────────
//   'MCLM'
//   u16 stringCount, then u8 len + ASCII                every item name, material name, block name
//   u8  toolCount, then u16 stringIdx                   the items that appear in ANY table
//   u8  materialCount
//     per material: u16 nameIdx · u8 n · n x (u8 toolIdx · f32 speed)
//   u16 blockCount
//     per block: u16 nameIdx · u8 materialIdx · ceil(toolCount/8) bytes of harvest bitset
// then deflate-raw and base64, like every other payload.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { MCDATA_PC } from './paths.mjs';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const OUT = opt('out', join(MCLITE_ROOT, 'assets'));
const PC = opt('pc', MCDATA_PC);
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const rj = (f) => JSON.parse(readFileSync(join(PC, f), 'utf8'));
const pcBlocks = rj('blocks.json');
const pcItems = rj('items.json');
const pcMaterials = rj('materials.json');
const constants = JSON.parse(readFileSync(join(OUT, 'block-constants.json'), 'utf8')).blocks;

const itemName = new Map();
for (const i of pcItems) itemName.set(i.id, i.name);

// ── the tool item set: every item named by any speed map or any harvest map ──────────────
const tools = new Set();
for (const mat of Object.keys(pcMaterials)) for (const id of Object.keys(pcMaterials[mat])) {
  const n = itemName.get(+id);
  if (!n) throw new Error('pack-mining: materials.json names item id ' + id + ', which items.json does not have');
  tools.add(n);
}
for (const b of pcBlocks) for (const id of Object.keys(b.harvestTools || {})) {
  const n = itemName.get(+id);
  if (!n) throw new Error('pack-mining: harvestTools names item id ' + id + ', which items.json does not have');
  tools.add(n);
}
const toolList = [...tools].sort();
if (toolList.length > 255) throw new Error('pack-mining: more than 255 tool items');
const toolIdx = new Map(toolList.map((n, i) => [n, i]));
const HB = Math.ceil(toolList.length / 8);

const materialList = Object.keys(pcMaterials).sort();
if (materialList.length > 255) throw new Error('pack-mining: more than 255 materials');
const materialIdx = new Map(materialList.map((n, i) => [n, i]));

// ── the blocks, in `block-constants.json`'s own order ────────────────────────────────────
// ⚠ KEYED BY NAME, NOT BY INDEX. `src/02f_tags.js` and `src/07d_mining.js` look these up
// through `Reg.id`, so a registry regeneration that renumbers the roster cannot silently
// re-point a harvest set at the wrong block — the same reason PLAN G14 keys saves by name.
const blockNames = Object.keys(constants);
const pcByName = new Map(pcBlocks.map((b) => [b.name, b]));
const rows = [];
let noMaterial = 0, withHarvest = 0;
for (const name of blockNames) {
  const pc = pcByName.get(name);
  const mat = pc && pc.material ? pc.material : 'default';
  if (!materialIdx.has(mat)) throw new Error('pack-mining: block ' + name + ' has material ' + mat + ', which materials.json does not define');
  if (!pc) noMaterial++;
  const bits = new Uint8Array(HB);
  for (const id of Object.keys((pc && pc.harvestTools) || {})) {
    const t = toolIdx.get(itemName.get(+id));
    bits[t >> 3] |= 1 << (t & 7);
  }
  if (pc && pc.harvestTools && Object.keys(pc.harvestTools).length) withHarvest++;
  rows.push([name, materialIdx.get(mat), bits]);
}

// ── intern ───────────────────────────────────────────────────────────────────────────────
const strings = []; const strIdx = new Map();
const intern = (s) => { if (!strIdx.has(s)) { strIdx.set(s, strings.length); strings.push(s); } return strIdx.get(s); };
for (const t of toolList) intern(t);
for (const m of materialList) intern(m);
for (const [n] of rows) intern(n);
if (strings.length > 65535) throw new Error('pack-mining: more than 65535 strings');

let size = 4 + 2;
for (const s of strings) size += 1 + Buffer.byteLength(s);
size += 1 + toolList.length * 2;
size += 1;
let speedEntries = 0;
for (const m of materialList) { const n = Object.keys(pcMaterials[m]).length; speedEntries += n; size += 2 + 1 + n * 5; }
size += 2 + rows.length * (2 + 1 + HB);

const buf = Buffer.alloc(size);
let o = 0;
buf.write('MCLM', o, 'ascii'); o += 4;
buf.writeUInt16LE(strings.length, o); o += 2;
for (const s of strings) { const b = Buffer.from(s, 'utf8'); buf.writeUInt8(b.length, o); o += 1; b.copy(buf, o); o += b.length; }
buf.writeUInt8(toolList.length, o); o += 1;
for (const t of toolList) { buf.writeUInt16LE(strIdx.get(t), o); o += 2; }
buf.writeUInt8(materialList.length, o); o += 1;
for (const m of materialList) {
  buf.writeUInt16LE(strIdx.get(m), o); o += 2;
  const ent = Object.entries(pcMaterials[m]);
  buf.writeUInt8(ent.length, o); o += 1;
  for (const [id, speed] of ent) {
    buf.writeUInt8(toolIdx.get(itemName.get(+id)), o); o += 1;
    buf.writeFloatLE(speed, o); o += 4;
  }
}
buf.writeUInt16LE(rows.length, o); o += 2;
for (const [name, mi, bits] of rows) {
  buf.writeUInt16LE(strIdx.get(name), o); o += 2;
  buf.writeUInt8(mi, o); o += 1;
  for (let i = 0; i < HB; i++) { buf.writeUInt8(bits[i], o); o += 1; }
}
if (o !== size) throw new Error(`pack-mining wrote ${o} of ${size} bytes`);

const deflated = deflateRawSync(buf, { level: 9 });
if (!inflateRawSync(deflated).equals(buf)) { console.error('FATAL: mining.bin does not round-trip'); process.exit(1); }
writeFileSync(join(OUT, 'mining.bin'), deflated);
writeFileSync(join(OUT, 'mining.meta.json'), JSON.stringify({
  rawBytes: size, packedBytes: deflated.length, strings: strings.length,
  tools: toolList.length, materials: materialList.length, speedEntries,
  blocks: rows.length, requiresTool: withHarvest, noPcEntry: noMaterial, harvestBytes: HB,
}, null, 2) + '\n');

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log('pack-mining');
console.log(` tool items ........ ${toolList.length}`);
console.log(` materials ......... ${materialList.length}, ${speedEntries} (material, item) speeds`);
console.log(` blocks ............ ${rows.length}, ${withHarvest} with a harvest set (requiresCorrectToolForDrops)`);
console.log(` packed ............ ${kb(size)} binary -> ${kb(deflated.length)} deflated -> ${kb(deflated.length * 4 / 3)} base64`);
