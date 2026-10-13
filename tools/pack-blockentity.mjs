#!/usr/bin/env node
// pack-blockentity.mjs — PASS 15 JOB 3, G17e: the block-entity items, IN THE WORLD.
//
//   node tools/pack-blockentity.mjs [--out assets]
//
// ── WHAT THIS CLOSES ─────────────────────────────────────────────────────────────────────────
// `15h_bemodel.js` already draws 58 of 60 `builtin/entity` items into a GUI slot, software-
// rasterised. `ER.OWED_ITEM` names the gap this file closes: the SAME 58 items, drawn as real
// §8 model-stream geometry, so a dropped chest and a dropped banner are visible in the world.
//
// ── WHY THIS IS A BAKE STEP, NOT A RUNTIME ONE (D-341's own lesson, one door down) ───────────
// D-341 already answered "how does a texture that isn't the block atlas reach the model
// stream": IT DOESN'T, DIRECTLY — the texture becomes MORE ATLAS LAYERS, appended after the
// item sprites, and the geometry becomes MORE PARTS, appended after the item sprites' parts
// (`spritePart0`/`spriteParts`, D-342). This file is that same trick played a third time:
// `bePart0`/`beParts` name a range in the SAME `R.qPos`/`qUv`/`qTile`/`qFlags` arrays, and
// `ER.emitPart` — already generic over any part index — draws them with NOT ONE LINE CHANGED.
//
// ⚠⚠ **THE ONE REAL PROBLEM: THESE SHEETS ARE 64x64 AND THE ARRAY'S LAYERS ARE 16x16 (D-341).**
// A chest's boxes are all ≤14 units a side, so each FACE's own UV rectangle fits one 16x16
// layer with room to spare. A banner's FLAG does not: `texOffs(0,0)` sized `20 x 40 x 1` puts
// its front/back face at 20x40 PIXELS, which is neither 16 wide nor 16 tall. So a face's UV
// rectangle is sliced into a grid of ≤16x16 PIXEL sub-tiles, and the face's own GEOMETRIC
// rectangle is sliced into the matching grid of sub-quads — computed by calling the exact same
// rotation math on a NARROWER box, not by interpolating corners by hand. A box that already fits
// (chest, bed's `main`, both skulls, the shield's handle) slices into exactly one piece and
// costs nothing extra.
//
// ── D-376: A CROP DOES NOT GET ITS OWN LAYER — IT GETS A SHARE OF ONE (THE 2048-LAYER LESSON) ──
// The first version of this file gave every sliced crop its own atlas layer: 1718 quads, 1718
// layers, on top of the 778 block + 657 item layers already there — 3153 total, and the test
// GPU's real `MAX_ARRAY_TEXTURE_LAYERS` is 2048 (`webgl2: this GPU allows 2048 texture array
// layers...`, `12_gfx_webgl2.js`'s own `uploadAtlas` guard). Almost every crop this file bakes is
// far smaller than the 16x16 layer it was given — a chest hinge is 2x2, a lock is 3x3, even a
// full face tops out at 14x14 — so one-crop-per-layer was spending an entire layer's area to
// hold a handful of pixels. `packTiles` below bin-packs many crops into each shared layer (a
// first-fit-decreasing-height shelf packer) and each quad's `uv` becomes that crop's OWN local
// (0,0)..(w,h) rectangle PLUS its packed placement offset — which needs no format change at all,
// because a quad's uv was always allowed to be a sub-rectangle of the tile it names (a thin block
// model already does this against its own single-content tile). Total: 1718 crops pack into 472
// layers (778+657+472 = 1907, under the 2048 cap with room to spare) against a 462-layer
// theoretical minimum (total crop area ÷ 256) — see `docs/DECISIONS.md` for the one accepted
// trade-off this buys: **shared-layer mip levels above 0 can blend one packed crop's edge into
// its neighbour's**, same as any texture atlas with more than one sprite per page. This is
// rendering, not behaviour (D- charter split), it is a numbered, documented deviation, and it
// only touches a handful of small decorative sub-details on a dropped item's texture, viewed at
// a distance where the blur is exactly what minification is supposed to look like anyway.
//
// ── THE FLIP (D-317's neighbour) ─────────────────────────────────────────────────────────────
// `BannerRenderer`, `BedRenderer` and `ShulkerBoxRenderer` scale their model by -1 on Y before
// drawing (`BE.FLIP`, already true in `15h_bemodel.js`). A single-axis mirror inverts every
// face's winding UNIFORMLY — there is no per-face case to consider — so a flipped layer bakes
// with every face's Y negated and every face's four corners taken in REVERSE order. Getting
// this wrong draws the model turned inside out: hollow, and dark where it should be lit.
//
// ── THE BANNER'S COLOUR IS BAKED, NOT TINTED ─────────────────────────────────────────────────
// The §8 vertex format's tint field is 2 bits — the grass/water/leaves biome LUT, not a 16-way
// palette. `banner_base.png` is multiplied by each of the 16 `DyeColor.textureDiffuseColors`
// AT BUILD TIME instead, exactly as a coloured wool or concrete gets its own baked texture
// rather than a runtime tint. **Declared deviation: patterns are not drawn.** A banner shows
// its base colour only; layering vanilla's pattern compositing is deeper than one job and is
// not what closes `ER.OWED_ITEM` (patterns are per-instance NBT, the base colour is not).
//
// ── WHAT IS NOT HERE ─────────────────────────────────────────────────────────────────────────
// (#594: the conduit is now baked too, from `layers.conduit` in pack-models.)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { deflateRawSync, inflateRawSync, constants as ZLIB } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Jar } from './jarlib.mjs';
import { decodePng } from './png.mjs';
import { JARS as MCLITE_JARS } from './paths.mjs';
import { existsSync } from 'node:fs';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const OUT = opt('out', join(MCLITE_ROOT, 'assets'));
const jarPath = (v) => {
  const flat = MCLITE_JARS + '/' + v + '.jar';
  const nested = MCLITE_JARS + '/' + v + '/' + v + '.jar';
  return existsSync(flat) ? flat : nested;
};
const JAR = opt('jar', jarPath('1.13.2'));
mkdirSync(OUT, { recursive: true });
const TILE = 16;

// ── the dye table, from the bytecode, not typed here (D-313's lesson, same as `build-gui`) ────
const DYES = (() => {
  const f = join(MCLITE_ROOT, 'tools', 'golden', 'dye-colours-1.18.2.tsv');
  const out = [];
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const c = line.split('\t');
    if (c[0]) out.push({ name: c[0], hex: parseInt(c[3].replace('#', ''), 16) });
  }
  return out;
})();
if (DYES.length !== 16) {
  console.error('pack-blockentity: the dye table has ' + DYES.length + ' colours, not 16 — run tools/extract-colours.mjs');
  process.exit(1);
}

// ── models.bin: the boxes, already packed by pack-models.mjs ─────────────────────────────────
const modelsBin = readFileSync(join(OUT, 'models.bin'));
const modelsPayload = JSON.parse(inflateRawSync(modelsBin, { finishFlush: ZLIB.Z_SYNC_FLUSH }).toString('utf8'));
const LAYERS = modelsPayload.layers;

// ── the atlas so far: block tiles + item tiles. be-tiles append after both (D-341's pattern) ──
const atlasIndex = JSON.parse(readFileSync(join(OUT, 'atlas-index.json'), 'utf8'));
const itemMeta = JSON.parse(readFileSync(join(OUT, 'item-tiles.meta.json'), 'utf8'));
const BLOCK_LAYERS = atlasIndex.count;
const ITEM_LAYERS = itemMeta.count;
const TILE_BASE = BLOCK_LAYERS + ITEM_LAYERS;
console.log(`pack-blockentity: appending after block(${BLOCK_LAYERS}) + item(${ITEM_LAYERS}) = layer ${TILE_BASE}`);

// ── the item -> {layer, tex, second, flip, tintDye} table (`BE.RULES`/`BE.FLIP`, ported) ──────
const jar = new Jar(JAR);
// #401: the in-hand trident/spyglass are 1.18.2 assets (the spyglass does not exist in 1.13.2)
const jar18 = new Jar(jarPath('1.18.2'));
const texCache = new Map();
function readTex(path) {
  if (texCache.has(path)) return texCache.get(path);
  const src = path.startsWith('@18:') ? jar18 : jar;
  const rel = path.replace(/^@18:/, '');
  if (!src.has(rel)) { texCache.set(path, null); return null; }
  const img = decodePng(src.read(rel));
  texCache.set(path, img);
  return img;
}
const TEX_PATH = {
  be_chest: 'assets/minecraft/textures/entity/chest/normal.png',
  be_trapped_chest: 'assets/minecraft/textures/entity/chest/trapped.png',
  be_ender_chest: 'assets/minecraft/textures/entity/chest/ender.png',
  be_shulker_box: 'assets/minecraft/textures/entity/shulker/shulker.png',
  be_banner: 'assets/minecraft/textures/entity/banner_base.png',
  be_conduit: 'assets/minecraft/textures/entity/conduit/base.png',
  be_shield: 'assets/minecraft/textures/entity/shield_base_nopattern.png',
  be_skeleton_skull: 'assets/minecraft/textures/entity/skeleton/skeleton.png',
  be_wither_skeleton_skull: 'assets/minecraft/textures/entity/skeleton/wither_skeleton.png',
  be_zombie_head: 'assets/minecraft/textures/entity/zombie/zombie.png',
  be_creeper_head: 'assets/minecraft/textures/entity/creeper/creeper.png',
  be_dragon_head: 'assets/minecraft/textures/entity/enderdragon/dragon.png',
  steve: 'assets/minecraft/textures/entity/steve.png',
  hand_trident: '@18:assets/minecraft/textures/entity/trident.png',
  hand_spyglass: '@18:assets/minecraft/textures/item/spyglass_model.png',
};
for (const d of DYES) {
  TEX_PATH['be_' + d.name + '_bed'] = 'assets/minecraft/textures/entity/bed/' + d.name + '.png';
  TEX_PATH['be_' + d.name + '_shulker_box'] = 'assets/minecraft/textures/entity/shulker/shulker_' + d.name + '.png';
}

// One entry per DRAWABLE ITEM (not per layer — chest/trapped_chest/ender_chest share a layer).
const ITEMS = [];
ITEMS.push({ name: 'chest', layer: 'chest', tex: 'be_chest' });
ITEMS.push({ name: 'trapped_chest', layer: 'chest', tex: 'be_trapped_chest' });
ITEMS.push({ name: 'ender_chest', layer: 'chest', tex: 'be_ender_chest' });
ITEMS.push({ name: 'shulker_box', layer: 'shulker', tex: 'be_shulker_box' });
for (const d of DYES) ITEMS.push({ name: d.name + '_shulker_box', layer: 'shulker', tex: 'be_' + d.name + '_shulker_box' });
for (const d of DYES) ITEMS.push({ name: d.name + '_bed', layer: 'bed', tex: 'be_' + d.name + '_bed' });
for (const d of DYES) ITEMS.push({ name: d.name + '_banner', layer: 'banner', tex: 'be_banner', dyeTint: d.hex });
ITEMS.push({ name: 'shield', layer: 'shield', tex: 'be_shield' });
ITEMS.push({ name: 'player_head', layer: 'player_head', tex: 'steve' });
ITEMS.push({ name: 'zombie_head', layer: 'zombie_head', tex: 'be_zombie_head' });
ITEMS.push({ name: 'creeper_head', layer: 'creeper_head', tex: 'be_creeper_head' });
ITEMS.push({ name: 'skeleton_skull', layer: 'skeleton_skull', tex: 'be_skeleton_skull' });
ITEMS.push({ name: 'wither_skeleton_skull', layer: 'wither_skeleton_skull', tex: 'be_wither_skeleton_skull' });
ITEMS.push({ name: 'dragon_head', layer: 'dragon_head', tex: 'be_dragon_head' });
// #594: the inactive conduit (`ConduitBlockEntityRenderer`: translate(.5,.5,.5), the 6x6x6 shell on base.png)
ITEMS.push({ name: 'conduit', layer: 'conduit', tex: 'be_conduit', center: 8 });
if (ITEMS.length !== 60) {
  console.error(`pack-blockentity: built ${ITEMS.length} drawable items, expected 60 — the roster drifted`);
  process.exit(1);
}

/**
 * #591 -- THE SIX SKULLS. `SkullBlockEntityRenderer.renderSkull(null, 180, 0, ...)` (what
 * `BuiltinModelItemRenderer` calls for an item) is `translate(0.5, 0, 0.5); scale(-1, -1, 1)` and a head
 * yaw of 180 degrees: `diag(-1,-1,1) . Ry(180) = diag(1,-1,-1)`, a rotation of 180 degrees about X. So a
 * skull box baked raw (y -8..0, face on -Z) hung below the block and faced away. The bake is that
 * rotation plus the (8, 0, 8) translate into block-corner coordinates; the dragon's
 * `DragonHeadEntityModel.render` adds `translate(0, -0.374375, 0); scale(0.75)` inside it. A rotation
 * keeps the winding, and swaps the face directions that name a shade (up<->down, north<->south).
 */
const SKULL_LAYERS = { player_head: 1, zombie_head: 1, creeper_head: 1, skeleton_skull: 1, wither_skeleton_skull: 1, dragon_head: 0.75 };
function skullTurn(quads, scale) {
  for (const q of quads) {
    for (let i = 0; i < 12; i += 3) {
      const x = q.p[i] * scale, y = q.p[i + 1] * scale - (scale === 1 ? 0 : 0.374375 * 16), z = q.p[i + 2] * scale;
      q.p[i] = Math.round((x + 8) * 16) / 16;
      q.p[i + 1] = Math.round(-y * 16) / 16 || 0;
      q.p[i + 2] = Math.round((8 - z) * 16) / 16;
    }
    if (q.d < 4) q.d ^= 1;   // DIRS = down,up,north,south,west,east: 0<->1 and 2<->3 swap
  }
  return quads;
}

/** Layers scaled by -1 on Y before their renderer draws (`BE.FLIP`, ported verbatim). */
const FLIP = { banner: true, bed: true, shulker: true, chest: false, shield: false };

// ── the box math — `15h_bemodel.js`'s `corners()`, unchanged ──────────────────────────────────
function corners(p) {
  const x0 = p.x, y0 = p.y, z0 = p.z;
  const x1 = x0 + p.w, y1 = y0 + p.h, z1 = z0 + p.d;
  const cz = Math.cos(p.rz), sz = Math.sin(p.rz);
  const cy = Math.cos(p.ry), sy = Math.sin(p.ry);
  const cx = Math.cos(p.rx), sx = Math.sin(p.rx);
  const out = new Float64Array(24);
  let k = 0;
  for (let i = 0; i < 8; i++) {
    const X = (i & 1) ? x1 : x0, Y = (i & 2) ? y1 : y0, Z = (i & 4) ? z1 : z0;
    const ax = X, ay = Y * cx - Z * sx, az = Y * sx + Z * cx;
    const bx = ax * cy + az * sy, by = ay, bz = -ax * sy + az * cy;
    const rx = bx * cz - by * sz, ry = bx * sz + by * cz, rz = bz;
    out[k++] = rx + p.px; out[k++] = ry + p.py; out[k++] = rz + p.pz;
  }
  return out;
}

/**
 * The six faces, in ARCH order (+X -X +Y -Y +Z -Z) — `15h_bemodel.js`'s own `FACE_CORNERS` and
 * `BE.faceRects`, so the UV-to-corner pairing this file relies on is the SAME pairing that
 * table has always used and `bemodelcheck` already holds against the skin.
 */
const FACE_CORNERS = [
  [1, 5, 7, 3],   // +X (east)
  [4, 0, 2, 6],   // -X (west)
  [2, 3, 7, 6],   // +Y (up)
  [4, 5, 1, 0],   // -Y (down)
  [5, 4, 6, 7],   // +Z (south)
  [0, 1, 3, 2],   // -Z (north)
];
// the vanilla Direction each ARCH face is, for the `d`/`cull` field `pack-geometry.mjs` reads
// (DIRS = ['down','up','north','south','west','east'])
const ARCH_TO_DIR = [5, 4, 1, 0, 3, 2];
// which of the box's own (x,y,z) axes the rect's (u,v) run along, per ARCH face
const ARCH_AXES = [
  ['z', 'y'], ['z', 'y'],   // +X / -X: u~z(d), v~y(h)
  ['x', 'z'], ['x', 'z'],   // +Y / -Y: u~x(w), v~z(d)
  ['x', 'y'], ['x', 'y'],   // +Z / -Z: u~x(w), v~y(h)
];
const SIZE_KEY = { x: 'w', y: 'h', z: 'd' };
// D-773 (beautiful-allen-7isws6) -- `15h_bemodel.js`'s `BE.faceDir`/`BE.faceUV`, the same
// vanilla table (ModelPart.Cuboid): which way each face's texture runs; +Y's v and a mirrored
// box's u run opposite to FACE_CORNERS' natural corner loop.
const VAN_U = [1, -1, 1, 1, -1, 1], VAN_V = [1, 1, -1, -1, 1, 1], NAT_V = [1, 1, 1, -1, 1, 1];

/** `BE.faceRects`, unchanged: the six faces' `[u,v,w,h]` rectangles in the sheet. */
function faceRects(p) {
  const g = p.g || 0, u = p.tu, v = p.tv, w = Math.round((p.w - 2 * g) * 1000) / 1000, h = Math.round((p.h - 2 * g - 2 * (p.gy || 0)) * 1000) / 1000, d = Math.round((p.d - 2 * g) * 1000) / 1000;   // #633: un-grown size
  let west = [u, v + d, d, h];
  let east = [u + d + w, v + d, d, h];
  if (p.m) { const t = west; west = east; east = t; }
  return [east, west, [u + d + w, v, w, d], [u + d, v, w, d],   // ±Y per ModelPart.Cuboid (D-773, beautiful-allen-7isws6)
          [u + d + w + d, v + d, w, h], [u + d, v + d, w, h]];
}

/**
 * One box's quads, sliced to fit ≤16x16 PIXEL crops. Each quad's `t` is a LOCAL index into
 * `tiles.list` (one entry per UNIQUE crop, deduplicated by source rectangle) — resolved to a
 * real shared atlas layer, and its `uv` shifted from local (0,0)..(w,h) to that layer's own
 * placement offset, by `packTiles` below AFTER every item has been baked (D-376).
 */
function bakeBox(p, flip, tiles, tileKeyOf) {
  const rects = p.rects || faceRects(p);
  const quads = [];
  for (let f = 0; f < 6; f++) {
    if (!rects[f]) continue;   // #401: a JSON element that names no such face (`p.rects`, ARCH order)
    const [uAxis, vAxis] = ARCH_AXES[f];
    const [ru, rv, rw, rh] = rects[f];
    // #633: the crop is cut in TEXELS (the un-grown rect, == the extent for an undilated box); the
    // slice's GEOMETRY is those texel ranges stretched by extent/texels (kU/kV, 1 when g = 0).
    const uSize = rw, vSize = rh;
    const kU = !p.rects && rw > 0 ? p[SIZE_KEY[uAxis]] / rw : 1, kV = !p.rects && rh > 0 ? p[SIZE_KEY[vAxis]] / rh : 1;
    // sanity: the rect's own size must match the box's own extent on these two axes, or the
    // ARCH_AXES table is wrong for this face — fail loudly rather than bake a sheared texture.
    if (!p.rects && (Math.abs(rw - p[SIZE_KEY[uAxis]]) > 2 * Math.abs(p.g || 0) + 0.01 || Math.abs(rh - p[SIZE_KEY[vAxis]]) > 2 * Math.abs(p.g || 0) + 0.01)) {
      throw new Error(`face ${f}: rect ${rw}x${rh} != box extent ${p[SIZE_KEY[uAxis]]}x${p[SIZE_KEY[vAxis]]}`);
    }
    const cols = Math.max(1, Math.ceil(uSize / TILE)), rows = Math.max(1, Math.ceil(vSize / TILE));
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const u0 = col * TILE, u1 = Math.min(uSize, u0 + TILE);
        const v0 = row * TILE, v1 = Math.min(vSize, v0 + TILE);
        const subP = Object.assign({}, p);
        const du = p.m ? -VAN_U[f] : VAN_U[f], dv = VAN_V[f];
        subP[uAxis] = du > 0 ? p[uAxis] + u0 * kU : p[uAxis] + (uSize - u1) * kU; subP[SIZE_KEY[uAxis]] = (u1 - u0) * kU;
        subP[vAxis] = dv > 0 ? p[vAxis] + v0 * kV : p[vAxis] + (vSize - v1) * kV; subP[SIZE_KEY[vAxis]] = (v1 - v0) * kV;
        // a `p.rects` face is one un-sliced crop: its geometry is the element's own extent (which is
        // NOT the texture rect's size for the spyglass's 2.2-wide barrel), never shrunk to the rect
        const c8 = corners(p.rects ? p : subP);
        let idx = FACE_CORNERS[f];
        if (flip) idx = idx.slice().reverse();
        // ⚠ ROUNDED TO 1/16 HERE, matching `bakeModel`'s own `Math.round(v*16)/16` (D-314's
        // lesson once more): `pack-geometry.mjs`'s round-trip check compares this JS object
        // against the INT16-decoded binary, which is exact 1/16 by construction, and an
        // unrounded float — inevitable once a box has a non-multiple-of-90 rotation, as the
        // bed's legs do — fails that comparison on a value that never reaches the file wrong.
        const r16 = (v) => Math.round(v * 16) / 16;
        const pos = [];
        for (const ci of idx) {
          pos.push(r16(c8[ci * 3]), r16(flip ? -c8[ci * 3 + 1] : c8[ci * 3 + 1]), r16(c8[ci * 3 + 2]));
        }
        // ⚠ LOCAL to the crop, NOT the sheet (D-376): this crop is about to become its own
        // small region of a SHARED 16x16 atlas layer, packed alongside other items' crops, so
        // its own uv starts at (0,0) and runs to (cropW,cropH) — `packTiles` adds each crop's
        // own placement offset within its shared layer once every item has been baked.
        const cropW = u1 - u0, cropH = v1 - v0;
        const ua = p.m ? cropW : 0, ub = p.m ? 0 : cropW;
        const va = NAT_V[f] !== VAN_V[f] ? cropH : 0, vb = NAT_V[f] !== VAN_V[f] ? 0 : cropH;
        let uvC = [[ua, va], [ub, va], [ub, vb], [ua, vb]];
        if (flip) uvC = uvC.slice().reverse();
        const uv = [];
        for (const [uu, vv] of uvC) uv.push(r16(uu), r16(vv));
        // the dedup/identity key is still the ABSOLUTE sheet rectangle — two quads that read
        // the exact same source pixels are the exact same crop, wherever they end up placed.
        const tileKey = tileKeyOf(ru + u0, rv + v0, cropW, cropH);
        let ti = tiles.indexByKey.get(tileKey);
        if (ti === undefined) {
          ti = tiles.list.length;
          tiles.list.push(tileKey);
          tiles.indexByKey.set(tileKey, ti);
        }
        quads.push({ d: ARCH_TO_DIR[f], cull: -1, t: ti, tint: -1, shade: 1, p: pos, uv });
      }
    }
  }
  return quads;
}

// ── build every item's parts, collecting the sub-tiles each one touches ───────────────────────
const tiles = { list: [], indexByKey: new Map() };   // key -> {tex, dyeTint, u, v, w, h}
const tileMeta = [];   // parallel to tiles.list: the actual crop+tint recipe
function tileKeyFor(texName, dyeTint, u, v, w, h) {
  const key = texName + '|' + (dyeTint === undefined ? '' : dyeTint) + '|' + u + ',' + v + ',' + w + ',' + h;
  if (!tiles.indexByKey.has(key)) tileMeta.push({ tex: texName, dyeTint, u, v, w, h });
  return key;
}

// ── #401: THE IN-HAND MODELS (`ItemRenderer.getModel` -> trident_in_hand / spyglass_in_hand) ────
// Not items: parts under the names `hand_trident` / `hand_spyglass` so `ER.beIndexOf` (which maps a
// real item NAME) never finds them, and a dropped or GUI trident keeps drawing its inventory sprite
// exactly as `ItemRenderer.renderItem` does for GUI/GROUND/FIXED.
//
// TRIDENT: `TridentEntityModel.getTexturedModelData` (.decomp .../model/TridentEntityModel.java),
// 32x32, boxes copied from it. `BuiltinModelItemRenderer` draws it under `scale(1, -1, -1)` after
// `ItemRenderer`'s (-0.5,-0.5,-0.5) shift, so the model origin is the block corner: baked as the
// raw box, then rotated 180 deg about X (x, -y, -z; a rotation, so winding is untouched, and the
// face directions that name a shade swap up<->down and north<->south).
const TRIDENT_BOXES = [
  { n: 'pole',         tu: 0, tv: 6, x: -0.5, y: 2,  z: -0.5, w: 1, h: 25, d: 1 },
  { n: 'base',         tu: 4, tv: 0, x: -1.5, y: 0,  z: -0.5, w: 3, h: 2,  d: 1 },
  { n: 'left_spike',   tu: 4, tv: 3, x: -2.5, y: -3, z: -0.5, w: 1, h: 4,  d: 1 },
  { n: 'middle_spike', tu: 0, tv: 0, x: -0.5, y: -4, z: -0.5, w: 1, h: 4,  d: 1 },
  { n: 'right_spike',  tu: 4, tv: 3, x: 1.5,  y: -3, z: -0.5, w: 1, h: 4,  d: 1, m: 1 },
].map((b) => Object.assign({ px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, m: 0 }, b));
const HAND_ITEMS = [{ name: 'hand_trident', tex: 'hand_trident' }, { name: 'hand_spyglass', tex: 'hand_spyglass' }];
function handParts(it, tileKeyOf) {
  const quads = [];
  if (it.name === 'hand_trident') {
    for (const b of TRIDENT_BOXES) {
      for (const q of bakeBox(b, false, tiles, tileKeyOf)) {
        for (let i = 0; i < 12; i += 3) { q.p[i + 1] = -q.p[i + 1] || 0; q.p[i + 2] = -q.p[i + 2] || 0; }
        if (q.d < 4) q.d ^= 1;   // DIRS = down,up,north,south,west,east: 0<->1 and 2<->3 swap, 4/5 stay
        quads.push(q);
      }
    }
    return quads;
  }
  // SPYGLASS: `models/item/spyglass_in_hand.json`, read from the jar. JSON is y-UP, the box baker's
  // raw space is y-DOWN, so each element is baked with y negated and FLIP (the banner's own path),
  // its faces' `uv` rectangles handed over in ARCH order with up/down exchanged.
  const m = JSON.parse(jar18.read('assets/minecraft/models/item/spyglass_in_hand.json').toString('utf8'));
  for (const el of m.elements) {
    const r = (f) => (el.faces[f] ? el.faces[f].uv.map((v, i, a) => i < 2 ? v : a[i] - a[i - 2]) : null);
    const b = {
      x: el.from[0], y: -el.to[1], z: el.from[2],
      w: el.to[0] - el.from[0], h: el.to[1] - el.from[1], d: el.to[2] - el.from[2],
      px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, m: 0,
      rects: [r('east'), r('west'), r('down'), r('up'), r('south'), r('north')],
    };
    for (const q of bakeBox(b, true, tiles, tileKeyOf)) {
      if (q.d < 2) q.d ^= 1;   // the y mirror: the face that was raw-max-y is physically down
      quads.push(q);
    }
  }
  return quads;
}

const partsOut = [];      // one "quads" array per drawable item, in ITEMS order
const names = {};         // item name -> index into partsOut
const report = { items: 0, quads: 0, tiles: 0, faceMismatch: [] };

for (let i = 0; i < ITEMS.length; i++) {
  const it = ITEMS[i];
  let parts;
  if (it.layer === 'bed') {
    // ⚠ A BED IS TWO LAYERS (see `H.beCanvas`): the head, and the foot offset +16 along Z —
    // the SAME two-layer merge the GUI icon already does, so a dropped bed matches its icon.
    const head = LAYERS.bed_head.parts, foot = LAYERS.bed_foot.parts;
    parts = head.concat(foot.map((p) => Object.assign({}, p, { pz: (p.pz || 0) + 16 })));
  } else {
    const L = LAYERS[it.layer];
    if (!L) { console.error('pack-blockentity: no layer "' + it.layer + '" for ' + it.name); process.exit(1); }
    parts = L.parts;
  }
  const flip = !!FLIP[it.layer];
  const quads = [];
  for (let p of parts) {
    if (it.center) p = Object.assign({}, p, { px: (p.px || 0) + it.center, py: (p.py || 0) + it.center, pz: (p.pz || 0) + it.center });
    quads.push(...bakeBox(p, flip, tiles, (u, v, w, h) => tileKeyFor(it.tex, it.dyeTint, u, v, w, h)));
  }
  if (SKULL_LAYERS[it.layer]) skullTurn(quads, SKULL_LAYERS[it.layer]);
  partsOut.push(quads);
  names[it.name] = i;
  report.items++; report.quads += quads.length;
}

for (const it of HAND_ITEMS) {
  const quads = handParts(it, (u, v, w, h) => tileKeyFor(it.tex, it.dyeTint, u, v, w, h));
  partsOut.push(quads);
  names[it.name] = partsOut.length - 1;
  report.quads += quads.length;
}

// ── D-376: pack the unique crops into SHARED 16x16 atlas layers ───────────────────────────────
// First-fit-decreasing-height shelf packing: sort crops tallest-first (ties broken widest-first),
// then place each one in the first shelf (of any already-open layer) it fits, opening a new
// shelf when no open shelf has room, and a new layer when no open layer has room for a new
// shelf. This is the same well-known bin-packing heuristic font/sprite atlas tools use; it is
// not optimal, but on this crop set it lands at 472 layers against a 462-layer theoretical
// floor (total crop area ÷ 256) — see D-376.
function packTiles(sizes) {
  const order = sizes.map((_, i) => i).sort((a, b) => (sizes[b].h - sizes[a].h) || (sizes[b].w - sizes[a].w));
  const layers = [];   // [{ shelves: [{y,h,usedW}] }]
  const place = new Array(sizes.length);
  for (const idx of order) {
    const { w, h } = sizes[idx];
    let done = false;
    for (let li = 0; li < layers.length && !done; li++) {
      for (const sh of layers[li].shelves) {
        if (h <= sh.h && (TILE - sh.usedW) >= w) {
          place[idx] = { layer: li, x: sh.usedW, y: sh.y };
          sh.usedW += w;
          done = true;
          break;
        }
      }
      if (done) break;
      const usedH = layers[li].shelves.reduce((s, x) => s + x.h, 0);
      if (usedH + h <= TILE) {
        layers[li].shelves.push({ y: usedH, h, usedW: w });
        place[idx] = { layer: li, x: 0, y: usedH };
        done = true;
      }
    }
    if (!done) {
      const li = layers.length;
      layers.push({ shelves: [{ y: 0, h, usedW: w }] });
      place[idx] = { layer: li, x: 0, y: 0 };
    }
  }
  return { place, layerCount: layers.length };
}
const { place, layerCount } = packTiles(tileMeta);
report.tiles = layerCount;

// finalize every quad: local jobId -> {layer, x, y}, shifting its LOCAL uv by that placement
// and turning the layer into the FINAL, ABSOLUTE atlas layer (`pack-geometry.mjs`'s own comment
// on this file: "be-geometry.json's own quads already carry the FINAL atlas layer in `t`" —
// `TILE_BASE` is this file's own number, computed above from the block+item layer counts, so
// nothing downstream has to know how many layers came before a be-item's own).
for (const quads of partsOut) {
  for (const q of quads) {
    const pl = place[q.t];
    q.t = TILE_BASE + pl.layer;
    for (let c = 0; c < 4; c++) { q.uv[c * 2] += pl.x; q.uv[c * 2 + 1] += pl.y; }
  }
}

// ── render each shared layer's pixels: crop, and for a banner, multiply by the dye colour ─────
// #6378: the End portal's two WHOLE textures (rendertype_end_portal samples them), cut into 16x16 layers
// row-major and appended after the shared crops: texture (w,h) starts at layer `first`, tile (tx,ty) = first + ty*(w/16) + tx.
const WHOLE = [
  ['end_portal', '@18:assets/minecraft/textures/entity/end_portal.png'],
  ['end_sky', '@18:assets/minecraft/textures/environment/end_sky.png'],
];
const wholeMeta = {};
let totalLayers = layerCount;
const wholeImgs = WHOLE.map(([name, path]) => {
  const img = readTex(path);
  if (!img || img.width % TILE || img.height % TILE) { console.error('pack-blockentity: ' + path + ' missing or not a multiple of 16'); process.exit(1); }
  wholeMeta[name] = { tex: path.replace(/^@18:/, ''), w: img.width, h: img.height, layer: TILE_BASE + totalLayers };
  totalLayers += (img.width / TILE) * (img.height / TILE);
  return img;
});
const tileBuf = new Uint8Array(totalLayers * TILE * TILE * 4);
WHOLE.forEach(([name], k) => {
  const img = wholeImgs[k], m = wholeMeta[name], cols = img.width / TILE;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const l = m.layer - TILE_BASE + Math.floor(y / TILE) * cols + Math.floor(x / TILE);
    const di = ((l * TILE + (y % TILE)) * TILE + (x % TILE)) * 4, si = (y * img.width + x) * 4;
    tileBuf[di] = img.data[si]; tileBuf[di + 1] = img.data[si + 1]; tileBuf[di + 2] = img.data[si + 2]; tileBuf[di + 3] = img.data[si + 3];
  }
});
for (let i = 0; i < tileMeta.length; i++) {
  const m = tileMeta[i];
  const pl = place[i];
  const img = readTex(TEX_PATH[m.tex]);
  if (!img) continue;   // stays transparent black — a missing texture is a visible bug, not a crash
  const dr = m.dyeTint === undefined ? 1 : ((m.dyeTint >> 16) & 255) / 255;
  const dg = m.dyeTint === undefined ? 1 : ((m.dyeTint >> 8) & 255) / 255;
  const db = m.dyeTint === undefined ? 1 : (m.dyeTint & 255) / 255;
  const layerBase = pl.layer * TILE * TILE * 4;
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      const sx = m.u + x, sy = m.v + y;
      if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) continue;
      const si = (sy * img.width + sx) * 4;
      const dx = pl.x + x, dy = pl.y + y;
      const di = layerBase + (dy * TILE + dx) * 4;
      tileBuf[di] = Math.round(img.data[si] * dr);
      tileBuf[di + 1] = Math.round(img.data[si + 1] * dg);
      tileBuf[di + 2] = Math.round(img.data[si + 2] * db);
      tileBuf[di + 3] = img.data[si + 3];
    }
  }
}

// ── write the atlas append and the geometry payload ────────────────────────────────────────
const packed = deflateRawSync(Buffer.from(tileBuf.buffer, tileBuf.byteOffset, tileBuf.byteLength), { level: 9 });
writeFileSync(join(OUT, 'be-tiles.bin'), packed);
writeFileSync(join(OUT, 'be-tiles.meta.json'), JSON.stringify({
  rawBytes: tileBuf.length, packedBytes: packed.length, tile: TILE, count: totalLayers,
  base: TILE_BASE, whole: wholeMeta,
  // #1508: the crop recipe of every shared tile (source png, rect, dye multiply, placement), so
  // tools/texl1check.mjs can re-derive each texel from the jar. Not shipped (gen-data reads count/base only).
  recipes: tileMeta.map((m, i) => ({ ...m, tex: TEX_PATH[m.tex], layer: place[i].layer, x: place[i].x, y: place[i].y })).concat(
    // #6378: one 16x16 recipe per layer of each whole End texture
    Object.values(wholeMeta).flatMap((w) => { const r = []; for (let ty = 0; ty < w.h / TILE; ty++) for (let tx = 0; tx < w.w / TILE; tx++) r.push({ tex: '@18:' + w.tex, u: tx * TILE, v: ty * TILE, w: TILE, h: TILE, layer: w.layer - TILE_BASE + ty * (w.w / TILE) + tx, x: 0, y: 0 }); return r; })),
}));
writeFileSync(join(OUT, 'be-geometry.json'), JSON.stringify({
  tileBase: TILE_BASE, parts: partsOut, names,
}));

console.log(` items ............. ${report.items} of 60`);
console.log(` quads .............. ${report.quads}`);
console.log(` unique crops ....... ${tileMeta.length}`);
console.log(` be-tiles ........... ${layerCount} (shared ${layerCount} + whole End textures, total ${totalLayers}), ${(packed.length / 1024).toFixed(1)} KB deflated`);
