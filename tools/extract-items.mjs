#!/usr/bin/env node
// extract-items.mjs — PLAN G7's data half. Dan: "items perfect too."
//
//   node tools/extract-items.mjs [--jar ...] [--old ...] [--out assets]
//
// 1,235 item models, resolved through the same parent chain as blocks, then split by how
// vanilla actually draws them — because that split is what an inventory has to reproduce and
// getting it wrong is why clone inventories look like a wall of grey squares:
//
//   FLAT   (`builtin/generated`, 488 + 36 handheld + the templates) — the item is a SPRITE,
//          composited from layer0..layerN in order. A potion is potion_overlay under potion;
//          leather armour is a dyed layer under an undyed one; a spawn egg is two layers
//          tinted per mob. Drawing only layer0 loses all of that.
//   BLOCK  (parent is a block/... model) — the item is the BLOCK, rendered in the GUI
//          transform. There is no item sprite for a staircase; there is a small stone
//          staircase drawn at an angle. Those already exist in assets/block-geometry.json,
//          so this file records the link rather than duplicating the geometry.
//   ENTITY (`builtin/entity`) — chests, shulkers, banners, beds, skulls, tridents. Vanilla
//          draws a live entity model. Recorded and counted, not solved here; the honest
//          answer is a hand-made sprite each, and there are only ten of them.
//
// Textures follow the same old-first policy as blocks (D-6): 1.13.2, then 1.18.2, and every
// fallback is named in the report rather than discovered later as a style mismatch.

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Jar, texturePath } from './jarlib.mjs';
import { decodePng, encodePng, alphaClass } from './png.mjs';
import { resolveTextureVar, resolveModel } from './models.mjs';
import { bakeModel } from './bakelib.mjs';
import { spriteElements } from './itemmodelgen.mjs';

// The project root, derived from THIS FILE's location rather than hard-coded. Every tool
// here used to hard-code an absolute path, which meant the whole suite ran
// on exactly one machine — the checks synced to Dan's copy could not be run there at all.
import { fileURLToPath } from 'node:url';
const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));   // ends with a separator
// Jars are Dan's own copies of the game and are NOT in the repo (D-6), so their location is a
// property of the machine, not the project. `--jar` still wins; MCLITE_JARS moves the default.
import { existsSync } from 'node:fs';
import { JARS as MCLITE_JARS, MCDATA_PC } from './paths.mjs';
/* MCLITE_JARS now comes from tools/paths.mjs (session 5) */
// Two layouts are accepted, because Dan's jars live in a launcher directory and the build
// machine's live in a flat one: <JARS>/1.18.2.jar and <JARS>/1.18.2/1.18.2.jar. Point
// MCLITE_JARS at a .minecraft `versions` folder and it just works.
const jarPath = (v) => {
  const flat = MCLITE_JARS + '/' + v + '.jar';
  const nested = MCLITE_JARS + '/' + v + '/' + v + '.jar';
  return existsSync(flat) ? flat : (existsSync(nested) ? nested : flat);
};


const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const JAR = opt('jar', jarPath('1.18.2'));
const OLD = opt('old', jarPath('1.13.2'));
const OUT = opt('out', MCLITE_ROOT + 'assets');
const TILE = 16;
mkdirSync(OUT, { recursive: true });

const t0 = Date.now();
const jar = new Jar(JAR);
const jarOld = new Jar(OLD);
const pcItems = (() => {
  try { return JSON.parse(readFileSync(MCDATA_PC + '/items.json', 'utf8')); } catch { return []; }
})();
const pcFoods = (() => {
  try { return JSON.parse(readFileSync(MCDATA_PC + '/foods.json', 'utf8')); } catch { return []; }
})();
// `FoodComponent.isSnack()` (the 16-tick eat) is not in minecraft-data's foods.json (no `fastFood`
// there), so the vanilla source is the authority: every `FoodComponents.X ... .snack()` constant.
const snackNames = new Set((() => {
  try {
    return readFileSync(new URL('../.decomp/net/minecraft/item/FoodComponents.java', import.meta.url), 'utf8')
      .split('\n').filter((l) => /\.snack\(\)/.test(l))
      .map((l) => (/FoodComponent (\w+) =/.exec(l) || [])[1]).filter(Boolean).map((n) => n.toLowerCase());
  } catch { return []; }
})());
const itemByName = new Map(pcItems.map((i) => [i.name, i]));
const foodByName = new Map(pcFoods.map((f) => [f.name, f]));
let lang = {};
try { lang = jar.readJson('assets/minecraft/lang/en_us.json'); } catch {}

/** Resolve an item model's parent chain, merging `textures` and `display` child-first. */
const cache = new Map();
function resolve(id, seen = new Set()) {
  const key = id.replace('minecraft:', '');
  if (cache.has(key)) return cache.get(key);
  if (seen.has(key)) throw new Error('parent cycle at ' + key);
  seen.add(key);
  const path = `assets/minecraft/models/${key}.json`;
  if (!jar.has(path)) {
    // builtin/generated and builtin/entity have no file - they ARE the terminator
    const out = { chain: [key], textures: {}, display: {}, builtin: key.startsWith('builtin/') ? key : null, elements: [] };
    cache.set(key, out);
    return out;
  }
  const m = jar.readJson(path);
  let base = { chain: [], textures: {}, display: {}, builtin: null, elements: [] };
  if (m.parent) base = resolve(m.parent, seen);
  const out = {
    chain: [key].concat(base.chain),
    textures: Object.assign({}, base.textures, m.textures || {}),
    display: Object.assign({}, base.display, m.display || {}),
    builtin: m.parent && String(m.parent).startsWith('builtin/') ? String(m.parent) : base.builtin,
    elements: m.elements || base.elements,
    overrides: m.overrides || base.overrides || null,
  };
  cache.set(key, out);
  return out;
}

// The block atlas is what an item's 3D model samples — a stone staircase in the inventory
// uses the block texture, not an item sprite — so it is loaded here rather than rebuilt.
let blockAtlas = { index: {} };
try { blockAtlas = JSON.parse(readFileSync(join(OUT, 'atlas-index.json'), 'utf8')); } catch {}

// ⚠ Not every file under models/item/ is an item. Measured: 6 of the 1,235 are TEMPLATES
// (`generated`, `handheld`, `handheld_rod`, `amethyst_bud`) or override targets
// (`spyglass_in_hand`, `air`), and a further ~130 are override VARIANTS selected by an
// `overrides` clause on a real item — `bow_pulling_0..2`, `clock_00..63`, `compass_00..31`.
// They have no stack size and no recipe because they are not items; they are frames of one.
// Requiring layers or constants from them produced 141 phantom "gaps" on the first run.
const REAL = new Set();
for (const it of pcItems) REAL.add(it.name);
// `air` is a block, so blocks.json carries it, but there is no air ITEM — nothing to draw,
// nothing to stack, no slot it can occupy.
const NOT_ITEMS = new Set(['air', 'cave_air', 'void_air']);
try {
  for (const b of JSON.parse(readFileSync(MCDATA_PC + '/blocks.json', 'utf8'))) REAL.add(b.name);
} catch {}

const files = jar.under('assets/minecraft/models/item/').filter((n) => n.endsWith('.json'));
const items = {};
const itemParts = [];
const itemPartKey = new Map();
const blockModelCache = new Map();
// ── the per-item tint colours (D-259) ───────────────────────────────────────────────────────
// `tools/golden/item-tints-1.18.2.tsv` is the reflection dump: one EGG line per spawn egg with
// its `backgroundColor` and `highlightColor`, the five DYEABLE items, and the constants javap
// found. Layer order is vanilla's: a spawn egg tints layer 0 with the background and layer 1
// with the highlight; leather armour dyes layer 0 and leaves the overlay alone; a potion tints
// the OVERLAY, which is layer 0, and leaves the glass bottle alone; a map and a firework star
// tint layer 1. −1 means "no tint", which is vanilla's own sentinel.
const TINT = (() => {
  const t = {};
  const raw = readFileSync(join(MCLITE_ROOT, 'tools', 'golden', 'item-tints-1.18.2.tsv'), 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const c = line.split('\t');
    if (c[0] === 'EGG') t[c[1].replace(/^minecraft:/, '')] = [+c[2], +c[3]];
  }
  // DyeableLeatherItem's own constant, read out of the jar: 10511680 = 0xA06540
  for (const n of ['leather_helmet', 'leather_chestplate', 'leather_leggings', 'leather_boots',
                   'leather_horse_armor']) t[n] = [10511680, -1];
  // PotionUtils: an untagged potion IS the uncraftable one, and vanilla paints it 0xF800F8
  for (const n of ['potion', 'splash_potion', 'lingering_potion', 'tipped_arrow']) t[n] = [16253176, -1];
  // MapItem's default map colour
  t.filled_map = [-1, -12173266];
  // ⚠ HAND-SOURCED, and the only one: ItemColors is client code and not in the server jar.
  t.firework_star = [-1, 9079434];
  // ⚠ THE BLOCK-ITEM TINTS (#4982), read out of the decompiled client `ItemColors.create` and
  // `BlockColors.create` (.decomp/net/minecraft/client/color). ItemColors registers 13 blocks:
  //   tall_grass, large_fern          -> GrassColors.getColor(0.5, 1.0)       (ItemColors itself)
  //   grass_block, grass, fern        -> BlockColors with no level -> GrassColors.getColor(0.5, 1.0)
  //   oak/jungle/acacia/dark_oak leaves, vine -> FoliageColors.getDefaultColor() = 4764952
  //   spruce_leaves -> FoliageColors.getSpruceColor() = 6396257    birch_leaves -> getBirchColor() = 8431445
  //   lily_pad -> BlockColors' no-level branch = 7455580
  // Before this these items drew their raw (grey) texture: fern and grass were grey in the hotbar.
  // GrassColors.getColor(0.5, 1.0) is colormap pixel (x = 127, y = 127) of colormap/grass.png.
  const gc = decodePng(jar.read('assets/minecraft/textures/colormap/grass.png'));
  const gi = (127 * gc.width + 127) * 4;
  const GRASS = (gc.data[gi] << 16) | (gc.data[gi + 1] << 8) | gc.data[gi + 2];
  for (const n of ['grass_block', 'grass', 'fern', 'tall_grass', 'large_fern']) t[n] = [GRASS, -1];
  for (const n of ['oak_leaves', 'jungle_leaves', 'acacia_leaves', 'dark_oak_leaves', 'vine']) t[n] = [4764952, -1];
  t.spruce_leaves = [6396257, -1];
  t.birch_leaves = [8431445, -1];
  t.lily_pad = [7455580, -1];
  return t;
})();

const report = {
  models: files.length, flat: 0, block: 0, entity: 0, unknown: [], templates: 0,
  itemParts: 0, itemQuads: 0, needsTint: 0, tintSourced: 0, tintMissing: [],
  layers: {}, maxLayers: 0, texturesUsed: new Set(), overrides: 0,
  missingBlockGeometry: [], noPcItem: [], noItemGeometry: [],
};

for (const f of files.sort()) {
  const name = f.split('/').pop().replace(/\.json$/, '');
  const m = resolve('item/' + name);
  const entry = {
    name,
    displayName: lang[`item.minecraft.${name}`] || lang[`block.minecraft.${name}`] || name,
    real: REAL.has(name) && !NOT_ITEMS.has(name),
  };
  if (!entry.real) report.templates++;

  // classify
  const blockParent = m.chain.find((c) => c.startsWith('block/'));
  if (m.builtin === 'builtin/entity') { entry.kind = 'entity'; report.entity++; }
  else if (blockParent) {
    // ⚠ The item's model is NOT the blockstates entry. A fence in the inventory is
    // `block/oak_fence_inventory` — one post and one arm — not the sixteen-state multipart
    // thing in the world; a trapdoor item is `block/oak_trapdoor_bottom`. The first version
    // looked the block up in block-geometry.json and reported 59 "missing" blocks that were
    // never missing: they simply have their own inventory model, which is the whole point.
    // So bake the item's own model, exactly as vanilla draws it in the slot.
    entry.kind = 'block';
    entry.block = blockParent.slice('block/'.length);
    if (TINT[name]) entry.tint = TINT[name];      // #4982: ItemColors' block-item tints (grass block, leaves)
    report.block++;
    try {
      const bm = resolveModel(jar, blockParent, blockModelCache);
      const quads = bakeModel(bm, 0, 0, false, (tex) => blockAtlas.index[tex], report);
      if (quads.length) {
        const key = createHash('sha1').update(JSON.stringify(quads)).digest('hex');
        let pi = itemPartKey.get(key);
        if (pi === undefined) { pi = itemParts.length; itemParts.push(quads); itemPartKey.set(key, pi); }
        entry.part = pi;
        report.itemQuads += quads.length;
      } else if (entry.real) report.noItemGeometry.push(name + ' -> ' + blockParent);
    } catch (e) {
      report.noItemGeometry.push(name + ' -> ' + blockParent + ': ' + e.message);
    }
  }
  else {
    entry.kind = 'flat'; report.flat++;
    const layers = [];
    for (let i = 0; i < 8; i++) {
      const v = m.textures['layer' + i];
      if (v === undefined) break;
      const tex = resolveTextureVar(m.textures, v);
      if (!tex) break;
      layers.push(tex.replace('minecraft:', ''));
      report.texturesUsed.add(tex.replace('minecraft:', ''));
    }
    entry.layers = layers;
    // ⚠ A two-layer sprite is almost always a TINTED one: vanilla multiplies one of the
    // layers by a per-item colour that lives in compiled Java, not in any file. Measured
    // 6 Sept 2026: 77 real items, of which 67 are spawn eggs (a grey egg + a grey overlay,
    // coloured per mob), 4 leather armour pieces, 3 potions, plus tipped_arrow,
    // firework_star and filled_map. Until those colours are sourced they render grey, which
    // is exactly what the gallery shows — so the flag exists to make that countable rather
    // than something to notice later and wonder about.
    // counted for REAL items only — a template with two layers is not an item that renders
    // grey, and two counters that disagree by one are worse than no counter at all
    if (layers.length > 1) { entry.needsTint = true; if (entry.real) report.needsTint++; }
    // ⚠ AND THE COLOURS ARE NOW SOURCED (D-259). `SpawnEggItem`'s two int fields were reflected
    // out of the verified 1.18.2 server jar for all 67 eggs, and `DyeableLeatherItem`,
    // `PotionUtils` and `MapItem` gave up their constants to javap. The one that could NOT come
    // from the jar is `firework_star`: item colours are registered in
    // `net.minecraft.client.color.item.ItemColors`, which is CLIENT code and not in a server jar
    // — so that one value is hand-sourced and says so, the way G6's reach distance does.
    const tint = TINT[name];
    if (tint) entry.tint = tint;
    if (entry.real && layers.length > 1) { if (tint) report.tintSourced++; else report.tintMissing.push(name); }
    report.layers[layers.length] = (report.layers[layers.length] || 0) + 1;
    if (layers.length > report.maxLayers) report.maxLayers = layers.length;
    // only a REAL item with no layers is a defect; a template with none is just a template
    if (!layers.length && entry.real) report.unknown.push(name + ' (flat with no layers, chain: ' + m.chain.join(' <- ') + ')');
  }

  entry.handheld = m.chain.some((c) => c.indexOf('handheld') >= 0);
  if (m.overrides) { entry.overrides = m.overrides.length; report.overrides++; }
  // the gui display transform, which is what an inventory slot actually uses
  if (m.display && m.display.gui) entry.gui = m.display.gui;
  // ⚠⚠ **AND THE ONE THE HAND USES, WHICH IS A DIFFERENT TRANSFORM ENTIRELY (D-359).** Dan,
  // 15 Sept 2026: *"items in your hand are still not even close to vanilla."* Until tonight this
  // engine had exactly ONE hand transform — `block/block`'s `[0, 45, 0]` at 0.40, hard-coded in
  // `15d_blockicon.js` — and applied it to everything. Vanilla gives a handheld tool
  // `[0, -90, 25]` with a `[1.13, 3.2, 1.13]` translation, a sprite item `[0, -90, 25]` at
  // `[1.13, 3.2, 1.13]` with scale 0.68, and a rod, a bow and a shield each their own. Rendering
  // a sword at the block transform is a sword held flat, pointing away — which is what "not even
  // close" looks like from the inside.
  // ⚠ IT IS RESOLVED THROUGH THE PARENT CHAIN like every other field here, so `diamond_sword`
  // inherits `item/handheld`'s and a block item inherits `block/block`'s, exactly as the game does.
  if (m.display && m.display.firstperson_righthand) entry.hand = m.display.firstperson_righthand;
  if (m.display && m.display.firstperson_lefthand) entry.handL = m.display.firstperson_lefthand;
  // s134 -- THE THIRD-PERSON HAND: what HeldItemFeatureRenderer poses a MOB's held item by
  // (ModelTransformation.Mode THIRD_PERSON_RIGHT_HAND), resolved through the same parent chain.
  if (m.display && m.display.thirdperson_righthand) entry.hand3 = m.display.thirdperson_righthand;
  // #110 -- the dropped-item (`ground`) and item-frame (`fixed`) transforms, same chain, for the visual sheet
  if (m.display && m.display.ground) entry.ground = m.display.ground;
  if (m.display && m.display.fixed) entry.fixed = m.display.fixed;

  const pc = itemByName.get(name);
  if (pc) {
    entry.id = pc.id;
    entry.stackSize = pc.stackSize;
    if (pc.maxDurability) entry.durability = pc.maxDurability;
    if (pc.enchantCategories) entry.enchantCategories = pc.enchantCategories;
  } else if (entry.real) report.noPcItem.push(name);
  const food = foodByName.get(name);
  if (food) entry.food = { nutrition: food.foodPoints, saturation: food.saturation, fast: !!food.fastFood || snackNames.has(name) };

  items[name] = entry;
}

report.itemParts = itemParts.length;

// ---------------------------------------------------------------- item atlas
const used = [...report.texturesUsed].sort();
const tiles = [];
const byHash = new Map();
const index = {};
const prov = { fromOld: [], fromNew: [], missing: [], animated: [], oversize: [] };

for (const id of used) {
  const path = texturePath(id);
  let src = null, from = null;
  if (jarOld.has(path)) { src = jarOld; from = 'old'; }
  else if (jar.has(path)) { src = jar; from = 'new'; }
  else { prov.missing.push(id); continue; }
  let img;
  try { img = decodePng(src.read(path)); } catch (e) { prov.missing.push(`${id} (${e.message})`); continue; }
  let { width, height, data } = img;
  if (height > width && height % width === 0) {
    prov.animated.push(`${id} (${height / width} frames)`);
    data = data.subarray(0, width * width * 4); height = width;
  }
  if (width !== height) { prov.missing.push(`${id} ${width}x${height}`); continue; }
  if (width !== TILE) { prov.oversize.push(`${id} ${width}x${height}`); continue; }
  const rgba = Buffer.from(data.subarray(0, TILE * TILE * 4));
  const h = createHash('sha1').update(rgba).digest('hex');
  let ti = byHash.get(h);
  if (ti === undefined) { ti = tiles.length; tiles.push(rgba); byHash.set(h, ti); }
  index[id] = ti;
  (from === 'old' ? prov.fromOld : prov.fromNew).push(id);
}

// ── THE TINTED SPRITE LAYERS, BAKED (D-344) ───────────────────────────────────────────────
// ⚠⚠ **A DROPPED SPAWN EGG WAS GREY.** Vanilla multiplies a sprite layer by a colour from
// `ItemColors` at render time — that is how one white egg sprite becomes sixty coloured ones,
// how a leather cap becomes sixteen dyed ones and how a potion gets its tint. The HUD did that
// compositing on a 2D canvas; the WORLD could not, because the model shader's only per-vertex
// tint field is two bits wide and already carries the grass/foliage/water tint map. So the
// inventory showed a green zombie egg and the dropped one was grey — the same item, two
// pictures, which is D-314's warning in its most literal form.
//
// ⚠ THE FIX IS TO BAKE, NOT TO ADD A SHADER PATH. Every one of these colours is STATIC in this
// engine: there is no NBT, so `tint0`/`tint1` are constants per item and a multiply done here is
// bit-for-bit the multiply the shader would do. So each distinct (sprite, colour) pair becomes
// its own atlas layer, and from then on there is exactly ONE set of pixels for an item — the
// HUD blits it and the world samples it, and they cannot disagree.
// ⚠ 123 pairs, not 78 items x 2 layers: every spawn egg shares the same two source sprites, so
// the pairs collapse hard. One kilobyte of pixels each.
const tintIndex = {};
{
  let made = 0;
  for (const name of Object.keys(items)) {
    const it = items[name];
    if (!it || !it.tint || !it.layers) continue;
    for (let L = 0; L < it.layers.length; L++) {
      const colour = it.tint[L];
      if (colour === undefined || colour === null || colour < 0) continue;
      const base = index[it.layers[L]];
      if (base === undefined) continue;
      const key = it.layers[L] + '@' + colour;
      if (tintIndex[key] !== undefined) continue;
      const src = tiles[base];
      const out = Buffer.alloc(src.length);
      const r = (colour >> 16) & 255, g = (colour >> 8) & 255, b = colour & 255;
      for (let o = 0; o < src.length; o += 4) {
        // ⚠ ALPHA IS UNTOUCHED. It is the cutout mask; scaling it by a colour channel would eat
        // the silhouette and put the item in the wrong render pass.
        out[o] = (src[o] * r + 127) / 255 | 0;
        out[o + 1] = (src[o + 1] * g + 127) / 255 | 0;
        out[o + 2] = (src[o + 2] * b + 127) / 255 | 0;
        out[o + 3] = src[o + 3];
      }
      tintIndex[key] = tiles.length;
      tiles.push(out);
      made++;
    }
  }
  report.tintedTiles = made;
}

const cols = Math.ceil(Math.sqrt(tiles.length)), rows = Math.ceil(tiles.length / cols);
const W = cols * TILE, H = rows * TILE;
const atlas = Buffer.alloc(W * H * 4);
for (let i = 0; i < tiles.length; i++) {
  const cx = (i % cols) * TILE, cy = ((i / cols) | 0) * TILE;
  for (let y = 0; y < TILE; y++) tiles[i].copy(atlas, ((cy + y) * W + cx) * 4, y * TILE * 4, (y + 1) * TILE * 4);
}
const png = encodePng(W, H, atlas, { level: 9, palette: true });
writeFileSync(join(OUT, 'item-atlas.png'), png);

// ── THE LAYERED FORM, WHICH IS WHAT THE GPU WANTS (D-341) ─────────────────────────
// ⚠⚠ THE SAME PIXELS, IN THE SAME ORDER, AS A TEXTURE-ARRAY PAYLOAD — exactly what
// `build-atlas.mjs` writes for the block tiles. It exists because a DROPPED ITEM is drawn in the
// WORLD, and the world's model stream samples the block atlas ARRAY by layer index: an item
// sprite living in a separate 2D sheet cannot be sampled by that shader at all, which is why a
// dropped stick was invisible while a dropped cobblestone was not.
// ⚠ Item sprites are 16x16, which is the block atlas's own layer size, so they append to the
// array with no resampling, no padding and no seams. That is the whole reason this is cheap and
// the reason a MOB texture — 64x64 — cannot go the same way.
// ⚠ D-139: the PNG above is NOT a second copy that stays. `gen-data` ships this payload and the
// HUD builds its own 2D sheet from it, so there is exactly one source of item pixels in the file.
const layered = Buffer.alloc(tiles.length * TILE * TILE * 4);
for (let i = 0; i < tiles.length; i++) tiles[i].copy(layered, i * TILE * TILE * 4);
const layeredPacked = deflateRawSync(layered, { level: 9 });
writeFileSync(join(OUT, 'item-tiles.bin'), layeredPacked);
writeFileSync(join(OUT, 'item-tiles.meta.json'), JSON.stringify({
  rawBytes: layered.length, packedBytes: layeredPacked.length, tile: TILE, count: tiles.length
}));

// ── THE EXTRUDED SPRITE MODELS (D-342) ────────────────────────────────────────────────────
// ⚠⚠ THIS IS WHAT MAKES A DROPPED STICK VISIBLE. An item entity holding a BLOCK was always
// drawn — it is that block's model — while an item holding a sprite was drawn as nothing at
// all, because the world's model stream has no billboard. Vanilla has no billboard either: it
// EXTRUDES the sprite into a real model, one sixteenth of a block deep, with a ring of side
// quads around every alpha boundary. `tools/itemmodelgen.mjs` is that algorithm, and every
// constant in it comes out of `tools/golden/itemmodel-1.18.2.tsv`.
//
// ⚠ IT GOES THROUGH `bakeModel`, THE SAME BAKER AS EVERY BLOCK IN THE GAME. The winding rule,
// the corner order and the UV rotation are written once and used here; a second copy is D-314,
// which has cost this project two sessions already.
//
// ⚠ THE TILE INDEX IS ALREADY OFFSET INTO THE COMBINED ATLAS. D-341 appended the item sprites
// to the block texture array as layers `blockCount + t`, so that is the number baked in. It is
// read from the block atlas's own index file rather than typed, because a hand-written 778
// would be a check owning a number the pipeline owns (D-305) and would go wrong the first time
// a texture was added.
const BLOCK_LAYERS = blockAtlas.count;
if (!(BLOCK_LAYERS > 0)) throw new Error('atlas-index.json carries no layer count');
const spriteParts = [];
let spriteQuads = 0, spriteMax = 0;
for (let t = 0; t < tiles.length; t++) {
  const els = spriteElements(tiles[t], TILE, TILE, '@sprite', -1);
  const quads = bakeModel({ elements: els }, 0, 0, false, () => BLOCK_LAYERS + t, null);
  spriteParts.push(quads);
  spriteQuads += quads.length;
  if (quads.length > spriteMax) spriteMax = quads.length;
}
if (spriteParts.length !== tiles.length) {
  throw new Error('sprite parts ' + spriteParts.length + ' != item tiles ' + tiles.length);
}
// ⚠ AND THE RENDER PASS EACH SPRITE BELONGS IN, by the SAME classifier the block atlas uses.
// An item sprite is normally cutout — hard edges, alpha 0 or 255 — but the potion overlays,
// the glass bottle and the spyglass have partial alpha and belong in the blended pass. Getting
// this from `alphaClass` rather than assuming "items are cutout" is what stops a dropped
// potion from having a black fringe.
const spriteAlpha = tiles.map((t) => alphaClass(t));
writeFileSync(join(OUT, 'sprite-geometry.json'),
              JSON.stringify({ blockLayers: BLOCK_LAYERS, parts: spriteParts, alpha: spriteAlpha }));

writeFileSync(join(OUT, 'item-atlas-index.json'),
              JSON.stringify({ tile: TILE, cols, rows, count: tiles.length, index, tintIndex }));
writeFileSync(join(OUT, 'item-registry.json'), JSON.stringify({ items, parts: itemParts }));

const summary = {
  ...report,
  texturesUsed: used.length,
  unknownCount: report.unknown.length,
  unknown: report.unknown.slice(0, 20),
  noPcItemCount: report.noPcItem.length,
  noPcItem: report.noPcItem.slice(0, 20),
  noItemGeometryCount: report.noItemGeometry.length,
  noItemGeometry: report.noItemGeometry.slice(0, 20),
  fromOldCount: prov.fromOld.length, fromNewCount: prov.fromNew.length,
  fallbackList: prov.fromNew, missingTextures: prov.missing, animated: prov.animated,
  uniqueTiles: tiles.length, atlas: `${W}x${H}`, bytes: png.length,
  ms: Date.now() - t0,
};
writeFileSync(join(OUT, 'item-report.json'), JSON.stringify(summary, null, 2));

console.log('');
console.log('================ extract-items ================');
console.log(` item models ....... ${report.models}`);
console.log(`   flat sprites .... ${report.flat}    layers: ${Object.entries(report.layers).map(([k, v]) => k + '->' + v).join('  ')}`);
console.log(`   block models .... ${report.block}    (drawn from the block geometry)`);
console.log(`   entity models ... ${report.entity}    ${report.entity ? '(chests, banners, beds, skulls — hand work, later)' : ''}`);
console.log(`   unclassified .... ${report.unknown.length}`);
console.log('');
console.log(` item textures ..... ${used.length}`);
console.log(` from 1.13.2 (old) . ${prov.fromOld.length}   (${Math.round(100 * prov.fromOld.length / Math.max(1, used.length))}%)`);
console.log(` from 1.18.2 (new) . ${prov.fromNew.length}`);
console.log(` missing ........... ${prov.missing.length}  ${prov.missing.slice(0, 4).join(' ')}`);
console.log(` unique tiles ...... ${tiles.length}   atlas ${W}x${H}   ${(png.length / 1024).toFixed(1)} KB`);
console.log('');
console.log(` 3D item parts ..... ${itemParts.length}   holding ${report.itemQuads} quads`);
console.log(` templates (not items): ${report.templates}`);
console.log(` per-item tint colours, from the 1.18.2 jar (D-259): ${report.tintSourced} of ${report.needsTint}` +
            (report.tintMissing.length ? `  ⚠ still grey: ${report.tintMissing.join(' ')}` : ''));
console.log('');
console.log(` block items with no geometry: ${report.noItemGeometry.length}  ${report.noItemGeometry.slice(0, 4).join(' ')}`);
console.log(` items with no constants ....: ${report.noPcItem.length}  ${report.noPcItem.slice(0, 5).join(' ')}`);
console.log(` ${summary.ms} ms  ->  ${OUT}/item-registry.json`);
console.log('==============================================');
process.exit(prov.missing.length || report.unknown.length || report.noItemGeometry.length ? 1 : 0);
