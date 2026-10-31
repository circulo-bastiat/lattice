#!/usr/bin/env node
// pack-items.mjs — PLAN G7/G8. The item registry, packed for the runtime.
//
//   node tools/pack-items.mjs [--out assets]
//
// ⚠ WHY THIS EXISTS NOW AND NOT IN F8b. `pack-runtime.mjs` has read `item-registry.json` since
// session 1 and shipped NONE of it — it counts the items in its report and stops — because until
// G8 nothing in the engine could hold an item stack. The blocks' registry is indexed by REAL
// STATE and every hot loop reads it; items are a different, smaller table with a different key,
// and welding them into `MCLR` would have made one format serve two questions.
//
// One record per REAL item (1,100 of them), in registry-id order:
//
//   u16 id            vanilla's own item id, which is what a save should key on
//   u8  nameLen + name
//   u8  stackSize     1, 16 or 64
//   u16 durability    0 for anything that does not break
//   u8  flags         1 handheld · 2 block item · 4 edible · 8 fast food · 16 tinted
//                     32|64|128: the EQUIPMENT SLOT (D-266) — 0 mainhand · 1 offhand · 2 feet
//                     3 legs · 4 chest · 5 head, out of the jar's bytecode via
//                     tools/extract-equipment.mjs. Three bits because six values need three.
//   u8  nutrition     0 unless edible
//   u8  defense       armour points in the slot this piece goes in, 0 for everything else
//   u8  toughness     ArmorMaterials.toughness — 0, 2 (diamond) or 3 (netherite)
//   u8  knockback     knockbackResistance x100 — 10 for netherite, 0 for everything else
//                     ⚠ all three out of the jar's BYTECODE via tools/extract-armor.mjs (D-291).
//                     They are in no JSON file: `Sv.afterArmor` carried vanilla's own damage
//                     formula for four stages with nothing able to give it a non-zero input.
//   f32 saturation
//   i32 tint0, i32 tint1     vanilla's per-layer colours (D-259), -1 for "no tint"
//   u16 blockState    the block item's DEFAULT real state, 0xFFFF for a non-block item
//   u8  layerCount + u16 per layer   the item atlas tile of each sprite layer, in draw order
//   u8  handIdx       index into the HAND TRANSFORM table below, 255 for "no transform"
//
// ⚠⚠ **THE HAND TRANSFORM TABLE (D-359).** `firstperson_righthand` out of each item model, which
// is what vanilla poses a held item by. It is DEDUPED because 1,226 items share **nineteen**
// distinct transforms — 591 of them are `item/generated`'s `[0,-90,25]` at 0.68 and 488 are
// `block/block`'s `[0,45,0]` at 0.40 — so the table is 19 x 9 floats and the per-item cost is
// one byte. Until tonight the engine had ONE of the nineteen hard-coded in `15d_blockicon.js`
// and used it for everything, which is why a sword in your hand was a flat plank.
//
// ⚠ THE BLOCK ITEM POINTS AT A REAL STATE, NOT A BLOCK. A hotbar slot, a save file and a
// placement all need the state a click produces, and resolving a name to a state at every use
// is the lookup this table exists to avoid.

import { writeFileSync, readFileSync } from 'node:fs';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));

// ── D-266: the equipment slot per item, out of tools/extract-equipment.mjs ────────────────────
// ⚠ COVERAGE IS NOT ASSERTED HERE and that is deliberate: the table lists only the 34 items that
// are worn, so "missing" is the common case and means MAINHAND. What IS asserted is that the file
// exists and names the four armour slots — a table that had silently emptied would otherwise make
// every helmet un-equippable and nothing would say so.
const EQUIP_NAMES = { MAINHAND: 0, OFFHAND: 1, FEET: 2, LEGS: 3, CHEST: 4, HEAD: 5 };
const EQUIP = new Map();
{
  const f = join(MCLITE_ROOT, 'tools', 'golden', 'item-equipment-1.18.2.tsv');
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const c = line.split('\t');
    if (c.length >= 2 && EQUIP_NAMES[c[1]] !== undefined) EQUIP.set(c[0], EQUIP_NAMES[c[1]]);
  }
  const slots = new Set([...EQUIP.values()]);
  if (EQUIP.size < 20 || !(slots.has(2) && slots.has(3) && slots.has(4) && slots.has(5))) {
    console.error('pack-items: the equipment table has ' + EQUIP.size + ' entries and does not name'
      + ' all four armour slots — run tools/extract-equipment.mjs');
    process.exit(1);
  }
}

// ── PLAN G11b: the creative tab per item, out of tools/extract-creative.mjs ──────────────────
// ⚠ COVERAGE **IS** ASSERTED, and the reason is that "no tab" is a real answer here rather than a
// missing row. Eighteen items are in no creative tab at all — the command blocks, the barrier,
// the jigsaw, the debug stick, the spawner — so a table that failed to parse would be
// indistinguishable from a game where NOTHING is in any tab, and the creative screen would open
// empty with no error anywhere. The row count is pinned to the registry's, so a short table stops
// the build instead of shipping a blank inventory.
const CREATIVE = new Map();
const CREATIVE_TABS = new Map();
{
  const f = join(MCLITE_ROOT, 'tools', 'golden', 'creative-tabs-1.18.2.tsv');
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    if (line.startsWith('# tabs: ')) {
      for (const t of line.slice(8).trim().split(' ')) {
        const m = t.match(/^(\d+)=([A-Za-z]+)\/([a-z0-9_]+)$/);
        if (m) CREATIVE_TABS.set(+m[1], { lang: m[2], icon: m[3] });
      }
      continue;
    }
    if (!line || line.startsWith('#')) continue;
    const c = line.split('\t');
    if (c.length < 3) continue;
    CREATIVE.set(c[0], { tab: c[1], col: +c[2] });
  }
  if (CREATIVE_TABS.size !== 12) {
    console.error('pack-items: the creative table names ' + CREATIVE_TABS.size + ' tabs, vanilla has'
      + ' 12 — run tools/extract-creative.mjs');
    process.exit(1);
  }
  const placed = [...CREATIVE.values()].filter((x) => x.col >= 0).length;
  if (CREATIVE.size < 1000 || placed < 900) {
    console.error('pack-items: the creative table has ' + CREATIVE.size + ' rows and ' + placed
      + ' placed items — run tools/extract-creative.mjs');
    process.exit(1);
  }
}

// ── D-291: armour points, toughness and knockback, out of tools/extract-armor.mjs ────────────
// ⚠ THE COVERAGE IS ASSERTED HERE, unlike the equipment table above, and the reason is the
// difference between the two questions. "Which slot does this go in" legitimately names only the
// 34 items with an answer. "How many points is this piece worth" has an answer for EVERY piece of
// armour, and there are exactly 25 — so a table with 24 rows means a material stopped parsing,
// and shipping it would silently make one set of armour worth nothing.
const ARMOR = new Map();
{
  const f = join(MCLITE_ROOT, 'tools', 'golden', 'armor-1.18.2.tsv');
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const c = line.split('\t');
    if (c.length < 7) continue;
    ARMOR.set(c[0], { material: c[1], slot: c[2], defense: +c[3], toughness: +c[4],
                      knockback: +c[5], maxDamage: +c[6] });
  }
  if (ARMOR.size !== 25) {
    console.error('pack-items: the armour table has ' + ARMOR.size + ' rows, the 1.18.2 roster has'
      + ' 25 — run tools/extract-armor.mjs');
    process.exit(1);
  }
  const slots = new Set([...ARMOR.values()].map((a) => a.slot));
  if (!['feet', 'legs', 'chest', 'head'].every((s2) => slots.has(s2))) {
    console.error('pack-items: the armour table does not name all four slots');
    process.exit(1);
  }
}

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const OUT = opt('out', MCLITE_ROOT + 'assets');

const t0 = Date.now();
const reg = JSON.parse(readFileSync(join(OUT, 'item-registry.json'), 'utf8'));
const items = reg.items;
const atlas = JSON.parse(readFileSync(join(OUT, 'item-atlas-index.json'), 'utf8'));
const constants = JSON.parse(readFileSync(join(OUT, 'block-constants.json'), 'utf8'));
const geometry = JSON.parse(readFileSync(join(OUT, 'block-geometry.json'), 'utf8'));

// The block ORDER is the geometry's, exactly as pack-runtime derives it — the same order the
// runtime's `Reg.names` ends up in, so a state index computed here means the same thing there.
const blockNames = Object.keys(geometry.states);
const realFirst = new Uint32Array(blockNames.length + 1);
{
  let off = 0;
  for (let i = 0; i < blockNames.length; i++) {
    realFirst[i] = off;
    const c = constants.blocks[blockNames[i]];
    off += c ? c.stateCount : 1;
  }
  realFirst[blockNames.length] = off;
}
const blockIndex = new Map(blockNames.map((n, i) => [n, i]));

// ⚠⚠ **WHICH ITEM PLACES WHICH BLOCK IS A FACT ABOUT THE JAR, NOT ABOUT THE ITEM'S MODEL**
// (D-331). This file used to write the placeable state only when `it.kind === 'block'`, and
// `kind` is set in `extract-items.mjs` by whether the item's INVENTORY MODEL inherits from a
// `block/...` parent. That is a RENDERING fact standing in for a GAMEPLAY one, and the two sets
// differ by **224 items**: every BlockItem drawn as a flat sprite or a `builtin/entity` — candles,
// torches, doors, signs, rails, beds, banners, chests — silently became unplaceable.
// `tools/golden/blockitems-1.18.2.tsv` is `Items.<clinit>` itself, and it also carries the twelve
// items whose block is not their own name (`wheat_seeds -> wheat`, `redstone -> redstone_wire`)
// which NO rule over names or models could ever have found.
const BLOCKITEM = new Map();          // item name -> { block, second, egg }
{
  const tsvPath = join(MCLITE_ROOT, 'tools', 'golden', 'blockitems-1.18.2.tsv');
  let tsv = null;
  try { tsv = readFileSync(tsvPath, 'utf8'); } catch { tsv = null; }
  if (!tsv) {
    console.error('pack-items: tools/golden/blockitems-1.18.2.tsv is missing — ' +
                  'run `node tools/extract-blockitems.mjs`. Guessing placeability from the ' +
                  'item MODEL is what D-331 removed and it must not come back.');
    process.exit(1);
  }
  for (const line of tsv.split('\n')) {
    if (!line || line[0] === '#') continue;
    const f = line.split('\t');
    if (f[0] === 'item') continue;
    BLOCKITEM.set(f[0], { block: f[1], second: f[2], egg: f[3] });
  }
}

const real = Object.values(items).filter((x) => x.real).sort((a, b) => (a.id | 0) - (b.id | 0));
const report = { items: real.length, blockItems: 0, eggs: 0, edible: 0, tinted: 0, layers: 0,
                 noState: [], noTile: [] };

// ⚠ THE TAB STRIP TRAVELS WITH THE ITEM TABLE, in a header before the rows, because the two are
// one fact: a column number in a row means nothing without the strip that says what column 6 is.
// Shipping them apart is how the runtime ends up with an item in tab 7 and no tab 7.
const tabHdr = [...CREATIVE_TABS.keys()].sort((a, b) => a - b).map((col) => {
  const t = CREATIVE_TABS.get(col);
  return { col: col, lang: Buffer.from('itemGroup.' + t.lang, 'utf8'), icon: Buffer.from(t.icon, 'utf8') };
});
let size = 4 + 2 + 1;
for (const t of tabHdr) size += 1 + 1 + t.lang.length + 1 + t.icon.length;
const rows = [];
// #10807: ItemColors registers PotionUtil.getColor(stack) for these; their tinted layer also needs its untinted tile at runtime
const PERSTACK = new Set(['potion', 'splash_potion', 'lingering_potion', 'tipped_arrow']);
const STACKBASE = [];   // [itemRow, layerIdx, baseTile]
for (const it of real) {
  const name = it.name;
  const nb = Buffer.from(name, 'utf8');
  // a block item's default REAL state, resolved here rather than at every use
  let state = 0xFFFF;
  {
    const bi2 = BLOCKITEM.get(name);
    const placesBlock = bi2 && bi2.block !== '-';
    if (placesBlock) {
      // ⚠ THE BLOCK IS THE TABLE'S, NOT THE ITEM'S OWN NAME. Twelve items place a block with a
      // different name and every one of them is a thing a player uses constantly: seeds, carrots,
      // potatoes, redstone dust, cocoa beans, sweet berries.
      const bi = blockIndex.get(bi2.block);
      const c = constants.blocks[bi2.block];
      if (bi === undefined || !c) report.noState.push(name + ' -> ' + bi2.block);
      else state = realFirst[bi] + (c.defaultState | 0);
      report.blockItems++;
    }
    if (bi2 && bi2.egg !== '-') report.eggs++;
  }
  const layers = [];
  for (let L = 0; L < (it.layers || []).length; L++) {
    const l = it.layers[L];
    // ⚠ A TINTED LAYER RESOLVES TO ITS PRE-TINTED TILE (D-344). `extract-items.mjs` bakes one
    // atlas layer per distinct (sprite, colour) pair, so a zombie egg's two layers point at
    // green pixels rather than at white pixels plus a colour to be applied later. That is what
    // lets the WORLD draw a spawn egg the same colour the inventory does: the model shader's
    // per-vertex tint field is two bits wide and already carries the grass/foliage/water map,
    // so a runtime multiply was never available to it.
    const colour = it.tint ? it.tint[L] : undefined;
    const tinted = (colour !== undefined && colour !== null && colour >= 0 && atlas.tintIndex)
      ? atlas.tintIndex[l + '@' + colour] : undefined;
    const tile = tinted !== undefined ? tinted : atlas.index[l];
    if (tile === undefined) { report.noTile.push(`${name}:${l}`); continue; }
    if (tinted !== undefined) report.tintedLayers = (report.tintedLayers || 0) + 1;
    // #10807: a per-stack-coloured item (ItemColors -> PotionUtil.getColor) also records its UNTINTED tile
    if (tinted !== undefined && PERSTACK.has(name)) STACKBASE.push([rows.length, layers.length, atlas.index[l]]);
    layers.push(tile);
  }
  report.layers += layers.length;
  if (it.food) report.edible++;
  if (it.tint) report.tinted++;
  rows.push({ it, nb, state, layers });
  //           id  nl  name        ss  dur flg nut  def tou kb tab sat  t0  t1  state lay
  size += 2 + 1 + nb.length + 1 + 2 + 1 + 1 + 1 + 1 + 1 + 1 + 4 + 4 + 4 + 2 + 1 + layers.length * 2;
}

// ── the deduped hand-transform table ────────────────────────────────────────────────────────
const HAND_KEYS = new Map();       // json -> index
const HAND_ROWS = [];              // [rx,ry,rz, tx,ty,tz, sx,sy,sz]
for (const { it } of rows) {
  const h = it.hand;
  if (!h) { it._handIdx = 255; continue; }
  const r = (h.rotation || [0, 0, 0]).map(Number);
  const t = (h.translation || [0, 0, 0]).map(Number);
  const c = (h.scale || [1, 1, 1]).map(Number);
  const row = [r[0], r[1], r[2], t[0], t[1], t[2], c[0], c[1], c[2]];
  const key = JSON.stringify(row);
  let idx = HAND_KEYS.get(key);
  if (idx === undefined) { idx = HAND_ROWS.length; HAND_KEYS.set(key, idx); HAND_ROWS.push(row); }
  it._handIdx = idx;
}
// ⚠ 255 IS THE SENTINEL AND THE TABLE MUST NOT REACH IT. If vanilla ever ships a 255th distinct
// transform this is a silent truncation, so it is an error rather than a clamp.
if (HAND_ROWS.length >= 255) { console.error('pack-items: more than 254 hand transforms'); process.exit(1); }
// ⚠ ANCHORED ON THE TWO CASES THAT CANNOT BE IN DOUBT: a stone block is `block/block`'s
// [0,45,0] at 0.40, and a diamond sword is `item/handheld`'s [0,-90,25] at 0.68. A table built
// from the wrong display key would still have nineteen plausible rows in it.
{
  const anchor = (name, want) => {
    const row = rows.find((r) => r.it.name === name);
    const got = row && row.it._handIdx !== 255 ? HAND_ROWS[row.it._handIdx] : null;
    if (!got || want.some((v, i) => Math.abs(v - got[i]) > 1e-4)) {
      console.error(`pack-items: ${name}'s hand transform is ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
      process.exit(1);
    }
  };
  anchor('stone', [0, 45, 0, 0, 0, 0, 0.4, 0.4, 0.4]);
  anchor('diamond_sword', [0, -90, 25, 1.13, 3.2, 1.13, 0.68, 0.68, 0.68]);
}
size += 1 + HAND_ROWS.length * 9 * 4 + rows.length;   // the table, and one index byte per item
// s134 -- THE THIRD-PERSON HAND TABLE, `thirdperson_righthand` (what a MOB's held item is posed by,
// HeldItemFeatureRenderer). Same dedupe, same 255 sentinel; it TRAILS the rows so every reader of the
// older layout above is unchanged.
const H3_KEYS = new Map(), H3_ROWS = [];
for (const { it } of rows) {
  const h = it.hand3;
  if (!h) { it._h3Idx = 255; continue; }
  const r = (h.rotation || [0, 0, 0]).map(Number), t = (h.translation || [0, 0, 0]).map(Number), c = (h.scale || [1, 1, 1]).map(Number);
  const row = [r[0], r[1], r[2], t[0], t[1], t[2], c[0], c[1], c[2]], key = JSON.stringify(row);
  let idx = H3_KEYS.get(key);
  if (idx === undefined) { idx = H3_ROWS.length; H3_KEYS.set(key, idx); H3_ROWS.push(row); }
  it._h3Idx = idx;
}
if (H3_ROWS.length >= 255) { console.error('pack-items: more than 254 third-person transforms'); process.exit(1); }
{
  const row = rows.find((r) => r.it.name === 'golden_sword'), got = row && row.it._h3Idx !== 255 ? H3_ROWS[row.it._h3Idx] : null;
  const want = [0, -90, 55, 0, 4, 0.5, 0.85, 0.85, 0.85];   // item/handheld.json thirdperson_righthand
  if (!got || want.some((v, i) => Math.abs(v - got[i]) > 1e-4)) { console.error('pack-items: golden_sword third-person transform ' + JSON.stringify(got)); process.exit(1); }
}
size += 1 + H3_ROWS.length * 9 * 4 + rows.length;
// #4982 -- THE ITEM MODEL SECTION, trailing the h3 section so every older reader is unchanged. An
// inventory slot draws the ITEM's own model (`item/small_dripleaf` -> `block/small_dripleaf_top`,
// `item/chorus_plant` -> `block/chorus_plant`, a stair at gui [30,135,0]), NOT the placed block's
// default state: for a multipart or two-state block those are different pictures. Layout:
//   u16 nParts · per part { u16 nQuads · nQuads x 44 bytes (the block-geometry quad record) }
//   u8  nGui · nGui x 9 f32 (the item's `gui` display transform, same row layout as the hand table)
//   per item { u16 part (0xFFFF none) · u8 guiIdx (255 none) }
const IPARTS = [], IPART_MAP = new Map();
const GUI_KEYS = new Map(), GUI_ROWS = [];
for (const r of rows) {
  const it = r.it;
  r.ipart = 0xFFFF; it._guiIdx = 255;
  if (it.kind !== 'block' || it.part === undefined) continue;
  let pi = IPART_MAP.get(it.part);
  if (pi === undefined) { pi = IPARTS.length; IPART_MAP.set(it.part, pi); IPARTS.push(reg.parts[it.part]); }
  r.ipart = pi;
  const g = it.gui;
  if (g) {
    const rr = (g.rotation || [0, 0, 0]).map(Number), t = (g.translation || [0, 0, 0]).map(Number), c = (g.scale || [1, 1, 1]).map(Number);
    const row = [rr[0], rr[1], rr[2], t[0], t[1], t[2], c[0], c[1], c[2]], key = JSON.stringify(row);
    let gi = GUI_KEYS.get(key);
    if (gi === undefined) { gi = GUI_ROWS.length; GUI_KEYS.set(key, gi); GUI_ROWS.push(row); }
    it._guiIdx = gi;
  }
}
if (GUI_ROWS.length >= 255) { console.error('pack-items: more than 254 gui transforms'); process.exit(1); }
size += 2;
for (const q of IPARTS) size += 2 + q.length * 44;
size += 1 + GUI_ROWS.length * 36 + rows.length * 3;
size += 1 + STACKBASE.length * 5;   // #10807 trailing section
report.itemModelParts = IPARTS.length; report.guiTransforms = GUI_ROWS.length;
report.thirdPersonTransforms = H3_ROWS.length;
report.handTransforms = HAND_ROWS.length;

const buf = Buffer.alloc(size);
let o = 0;
buf.write('MCLI', o, 'ascii'); o += 4;
buf.writeUInt16LE(rows.length, o); o += 2;
buf.writeUInt8(HAND_ROWS.length, o); o += 1;
for (const row of HAND_ROWS) for (const v of row) { buf.writeFloatLE(v, o); o += 4; }
buf.writeUInt8(tabHdr.length, o); o += 1;
for (const t of tabHdr) {
  buf.writeUInt8(t.col, o); o += 1;
  buf.writeUInt8(t.lang.length, o); o += 1; t.lang.copy(buf, o); o += t.lang.length;
  buf.writeUInt8(t.icon.length, o); o += 1; t.icon.copy(buf, o); o += t.icon.length;
}
for (const { it, nb, state, layers } of rows) {
  buf.writeUInt16LE(it.id | 0, o); o += 2;
  buf.writeUInt8(nb.length, o); o += 1; nb.copy(buf, o); o += nb.length;
  buf.writeUInt8(Math.min(255, it.stackSize || 64), o); o += 1;
  buf.writeUInt16LE(Math.min(65535, it.durability || 0), o); o += 2;
  let flags = 0;
  if (it.handheld) flags |= 1;
  if (it.kind === 'block') flags |= 2;
  if (it.food) flags |= 4;
  if (it.food && it.food.fast) flags |= 8;
  if (it.tint) flags |= 16;
  // D-266 — which slot this item is WORN in, so shift-click can equip it. Everything that is not
  // armour, a shield, an elytra, a carved pumpkin or a skull is MAINHAND and contributes 0.
  flags |= (EQUIP.get(it.name) || 0) << 5;
  buf.writeUInt8(flags, o); o += 1;
  buf.writeUInt8(it.food ? (it.food.nutrition | 0) : 0, o); o += 1;
  const ar = ARMOR.get(it.name);
  buf.writeUInt8(ar ? ar.defense : 0, o); o += 1;
  buf.writeUInt8(ar ? Math.round(ar.toughness) : 0, o); o += 1;
  buf.writeUInt8(ar ? Math.round(ar.knockback * 100) : 0, o); o += 1;
  // ⚠ 255, NOT 0, FOR "NO TAB". Column 0 is Building Blocks — the tab with 376 items in it — so a
  // sentinel of zero would put the barrier, the jigsaw and all four command blocks in the first
  // page of the creative inventory and look entirely plausible while doing it.
  const cre = CREATIVE.get(it.name);
  buf.writeUInt8(cre && cre.col >= 0 ? cre.col : 255, o); o += 1;
  buf.writeFloatLE(it.food ? (it.food.saturation || 0) : 0, o); o += 4;
  buf.writeInt32LE(it.tint ? (it.tint[0] | 0) : -1, o); o += 4;
  buf.writeInt32LE(it.tint ? (it.tint[1] | 0) : -1, o); o += 4;
  buf.writeUInt16LE(state, o); o += 2;
  buf.writeUInt8(layers.length, o); o += 1;
  for (const t of layers) { buf.writeUInt16LE(t, o); o += 2; }
  buf.writeUInt8(it._handIdx === undefined ? 255 : it._handIdx, o); o += 1;
}
buf.writeUInt8(H3_ROWS.length, o); o += 1;
for (const row of H3_ROWS) for (const v of row) { buf.writeFloatLE(v, o); o += 4; }
for (const { it } of rows) { buf.writeUInt8(it._h3Idx === undefined ? 255 : it._h3Idx, o); o += 1; }
buf.writeUInt16LE(IPARTS.length, o); o += 2;
for (const part of IPARTS) {
  buf.writeUInt16LE(part.length, o); o += 2;
  for (const q of part) {
    const flags = (q.d & 7) | (((q.cull < 0 ? 7 : q.cull) & 7) << 3) | ((q.shade ? 1 : 0) << 6)
      | (((q.tint < 0 ? 0 : q.tint + 1) & 7) << 7);
    buf.writeUInt16LE(flags, o); o += 2;
    buf.writeUInt16LE(q.t, o); o += 2;
    for (let i = 0; i < 12; i++) { buf.writeInt16LE(Math.round(q.p[i] * 16), o); o += 2; }
    for (let i = 0; i < 8; i++) { buf.writeInt16LE(Math.round(q.uv[i] * 16), o); o += 2; }
  }
}
buf.writeUInt8(GUI_ROWS.length, o); o += 1;
for (const row of GUI_ROWS) for (const v of row) { buf.writeFloatLE(v, o); o += 4; }
for (const r of rows) { buf.writeUInt16LE(r.ipart, o); o += 2; buf.writeUInt8(r.it._guiIdx, o); o += 1; }
buf.writeUInt8(STACKBASE.length, o); o += 1;
for (const [ri, li, bt] of STACKBASE) { buf.writeUInt16LE(ri, o); buf.writeUInt8(li, o + 2); buf.writeUInt16LE(bt, o + 3); o += 5; }
if (o !== size) { console.error(`pack-items: wrote ${o} of ${size} bytes`); process.exit(1); }

// ⚠ DEFLATED, like every other payload in `assets/*.bin` — `NS.Z.unpack` inflates what
// `gen-data` base64s, and a raw file here would reach the engine as garbage at boot. The meta's
// `rawBytes` is the INFLATED length, which is what the unpacker is told to expect.
const packed = deflateRawSync(buf, { level: 9 });
const identical = Buffer.compare(inflateRawSync(packed), buf) === 0;
if (!identical) { console.error('pack-items: the deflate round trip does not match'); process.exit(1); }
writeFileSync(join(OUT, 'items.bin'), packed);
writeFileSync(join(OUT, 'items.meta.json'), JSON.stringify({ rawBytes: buf.length, packedBytes: packed.length, items: rows.length }));

// ⚠ THE ROUND TRIP, HERE RATHER THAN IN THE CHECK. `pack-geometry` reads its own output back and
// compares before reporting a number, and the reason is D-30: a packer that cannot decode itself
// has produced a file nobody has read. This one does the same, with the engine's own reader
// shape — u16/u8/f32 little-endian, in the order above.
{
  let p = 6, bad = 0, armorSeen = 0, tabSeen = 0, placed = 0, handSeen = 0;
  // the hand-transform table comes first, and reading it back is how a byte added in the wrong
  // place announces itself — the tab header immediately after it is a strong canary (D-359)
  const nHand = buf.readUInt8(p); p += 1;
  const handBack = [];
  for (let h = 0; h < nHand; h++) {
    const row = [];
    for (let k = 0; k < 9; k++) { row.push(buf.readFloatLE(p)); p += 4; }
    handBack.push(row);
  }
  if (nHand !== HAND_ROWS.length) {
    console.error('pack-items: the hand table read back as ' + nHand + ' of ' + HAND_ROWS.length);
    process.exit(1);
  }
  const nTabs = buf.readUInt8(p); p += 1;
  const cols = [];
  for (let t = 0; t < nTabs; t++) {
    cols.push(buf.readUInt8(p)); p += 1;
    const ll = buf.readUInt8(p); p += 1 + ll;
    const il = buf.readUInt8(p); p += 1 + il;
    tabSeen++;
  }
  if (tabSeen !== 12 || new Set(cols).size !== 12) {
    console.error('pack-items: the tab header read back as ' + tabSeen + ' tabs in '
      + new Set(cols).size + ' columns'); process.exit(1);
  }
  for (let i = 0; i < rows.length; i++) {
    const id = buf.readUInt16LE(p); p += 2;
    const nl = buf.readUInt8(p); p += 1;
    const nm = buf.toString('utf8', p, p + nl); p += nl;
    const ss = buf.readUInt8(p); p += 1;
    p += 2; p += 1; p += 1;                              // durability, flags, nutrition
    const def = buf.readUInt8(p); p += 1;                // D-291: armour points…
    const tou = buf.readUInt8(p); p += 1;                // …toughness…
    const kb = buf.readUInt8(p); p += 1;                 // …and knockback x100
    const tab = buf.readUInt8(p); p += 1;                // G11b: the creative tab column, 255 none
    if (tab !== 255) placed++;
    p += 4; p += 4; p += 4;                              // saturation, tint0, tint1
    p += 2;                                              // state
    const nlay = buf.readUInt8(p); p += 1; p += nlay * 2;
    const hidx = buf.readUInt8(p); p += 1;
    const src = rows[i].it;
    if (hidx !== (src._handIdx === undefined ? 255 : src._handIdx)) bad++;
    if (hidx !== 255) handSeen++;
    if (id !== (src.id | 0) || nm !== src.name || ss !== Math.min(255, src.stackSize || 64)) bad++;
    // ⚠ and the armour bytes specifically, because they are the ones that were added last and
    // the walk above is what noticed they had no room reserved.
    const want = ARMOR.get(nm);
    if (want) {
      if (def !== want.defense || tou !== Math.round(want.toughness) || kb !== Math.round(want.knockback * 100)) bad++;
      armorSeen++;
    } else if (def || tou || kb) bad++;
  }
  // ⚠ AND THE TAB BYTES, read back rather than trusted. `placed` counted through the ENGINE's
  // reader shape, so a byte added in the wrong place shows up here as a number that is not the
  // one the table said — which is exactly how the armour bytes announced they had no room.
  const wantPlaced = rows.filter((r) => { const c = CREATIVE.get(r.it.name); return c && c.col >= 0; }).length;
  if (placed !== wantPlaced || placed < 900) {
    console.error('pack-items: ' + placed + ' items came back with a creative tab, the table places '
      + wantPlaced); process.exit(1);
  }
  if (armorSeen !== ARMOR.size) {
    console.error(`pack-items: ${armorSeen} armour rows made it into the blob, the table has ${ARMOR.size}`);
    process.exit(1);
  }
  // ⚠ AND THE HAND INDEX, COUNTED THROUGH THE ENGINE'S READER SHAPE. Nearly every item in the
  // game has a hand transform; a count that collapses means the byte is being read from the
  // wrong offset, which is precisely the failure the armour bytes taught this block to catch.
  if (handSeen < rows.length * 0.9) {
    console.error('pack-items: only ' + handSeen + ' of ' + rows.length + ' items came back with a hand transform');
    process.exit(1);
  }
  // s134: the trailing third-person table, read back the same way
  { const n3 = buf.readUInt8(p); p += 1; if (n3 !== H3_ROWS.length) bad++; p += n3 * 36;
    let seen3 = 0; for (let i = 0; i < rows.length; i++) { const k = buf.readUInt8(p); p += 1; if (k !== 255) seen3++; if (k !== rows[i].it._h3Idx) bad++; }
    if (seen3 < rows.length * 0.9) { console.error('pack-items: only ' + seen3 + ' items came back with a third-person transform'); process.exit(1); } }
  // #4982: the item model section, read back with the engine's reader shape
  { const np = buf.readUInt16LE(p); p += 2; if (np !== IPARTS.length) bad++;
    for (let k = 0; k < np; k++) { const nq = buf.readUInt16LE(p); p += 2; if (nq !== IPARTS[k].length) bad++; p += nq * 44; }
    const ng = buf.readUInt8(p); p += 1; if (ng !== GUI_ROWS.length) bad++; p += ng * 36;
    let withPart = 0;
    for (let i = 0; i < rows.length; i++) { const ip = buf.readUInt16LE(p); p += 2; const gi = buf.readUInt8(p); p += 1; if (ip !== rows[i].ipart || gi !== rows[i].it._guiIdx) bad++; if (ip !== 0xFFFF) withPart++; }
    if (withPart < 500) { console.error('pack-items: only ' + withPart + ' items came back with an item model'); process.exit(1); } }
  { const nb = buf.readUInt8(p); p += 1; if (nb !== STACKBASE.length || nb < 4) bad++; p += nb * 5; }
  if (bad || p !== size) { console.error(`pack-items: round trip failed (${bad} rows, ${p} of ${size} bytes)`); process.exit(1); }
}

console.log('================ pack-items ================');
console.log(` real items ......... ${report.items}`);
// ⚠ THE REPORT NAMES WHAT WAS ATTEMPTED, NOT ONLY WHAT WORKED (D-331). The old line printed the
// number of items that resolved a state and warned only when `noState` was non-empty — which it
// never was, because an item never classified as a block is never asked for a state. A build that
// reports success while a fifth of the item table is inert is worse than one that says nothing.
console.log(` block items ........ ${report.blockItems} of ${BLOCKITEM.size} in the golden table` +
            `   (${[...BLOCKITEM.values()].filter((v) => v.block !== '-').length} are BlockItems in the jar)`);
console.log(` spawn eggs ......... ${report.eggs}`);
console.log(` edible ............. ${report.edible}`);
console.log(` tinted ............. ${report.tinted}   (D-259)`);
console.log(` sprite layers ...... ${report.layers}`);
console.log(` hand transforms .... ${report.handTransforms} distinct, over ${rows.filter((r) => r.it._handIdx !== 255).length} items   (D-359)`);
console.log(` creative tabs ...... ${tabHdr.length}   (${rows.filter((r) => { const c = CREATIVE.get(r.it.name); return c && c.col >= 0; }).length} of ${rows.length} items placed, the rest in no tab)`);
console.log(` items.bin .......... ${(buf.length / 1024).toFixed(1)} KB raw -> ${(packed.length / 1024).toFixed(1)} KB deflated`);
if (report.noState.length) console.log(` ⚠ block items with no state: ${report.noState.length}  ${report.noState.slice(0, 6).join(' ')}`);
{
  // ⚠ CLOSED AGAINST THE JAR, AT BUILD TIME. Every item the bytecode says is a BlockItem must have
  // come out of this file with a state; the day one does not, the build says so by name.
  const want = [...BLOCKITEM].filter(([, v]) => v.block !== '-').map(([k]) => k);
  const got = new Set(rows.filter((r) => r.state !== 0xFFFF).map((r) => r.it.name));
  const lost = want.filter((n) => !got.has(n) && real.some((it) => it.name === n));
  if (lost.length) {
    console.error(` x ${lost.length} BlockItems did not resolve a state: ${lost.slice(0, 10).join(' ')}`);
    process.exit(1);
  }
}
if (report.noTile.length) console.log(` ⚠ layers with no atlas tile: ${report.noTile.length}  ${report.noTile.slice(0, 6).join(' ')}`);
console.log(` ${Date.now() - t0} ms  ->  ${join(OUT, 'items.bin')}`);
console.log('============================================');
