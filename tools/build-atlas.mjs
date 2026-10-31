#!/usr/bin/env node
// build-atlas.mjs — build MC-Lite's texture atlas from Dan's own game files.
//
//   node tools/build-atlas.mjs [--old 1.13.2.jar] [--new 1.18.2.jar] [--out assets]
//
// Policy, decided 6 Sept 2026 (DECISIONS D-6):
//   old textures where they exist, modern textures where they do not, and a GENERATED
//   REPORT naming every single fallback so the seam is auditable instead of a mystery.
//
// "Exact quality, smaller in the game" (D-7) means LOSSLESS. So the size work is:
//   1. only pack textures the block models actually reference
//   2. deduplicate identical tiles by content hash - many blocks share pixels
//   3. indexed colour with a shared palette, which old Minecraft art suits perfectly
//   4. per-scanline filter selection before deflate
// No quantisation, no resampling, no colour loss anywhere.

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Jar, texturePath } from './jarlib.mjs';
import { decodePng, encodePng, alphaClass } from './png.mjs';

// The project root, derived from THIS FILE's location rather than hard-coded. Every tool
// here used to hard-code an absolute path, which meant the whole suite ran
// on exactly one machine — the checks synced to Dan's copy could not be run there at all.
import { fileURLToPath } from 'node:url';
const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));   // ends with a separator
// Jars are Dan's own copies of the game and are NOT in the repo (D-6), so their location is a
// property of the machine, not the project. `--jar` still wins; MCLITE_JARS moves the default.
import { existsSync } from 'node:fs';
import { JARS as MCLITE_JARS } from './paths.mjs';
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

const OLD = opt('old', jarPath('1.13.2'));
const NEW = opt('new', jarPath('1.18.2'));
const OUT = opt('out', MCLITE_ROOT + 'assets');
const TILE = 16;
mkdirSync(OUT, { recursive: true });

const t0 = Date.now();
const jarOld = new Jar(OLD);
const jarNew = new Jar(NEW);

// ANIM-2 (#2002): the fluid renderer's own tiles are in no block model, so they are added here, FIRST, so they
// land on the first free layers after the 57 legacy ones (57, 58, 59 - src/02c_states.js pins those numbers;
// fluidtilecheck proves them). Flow frames are 32x32; vanilla's side UVs (FluidRenderer, getFrameU/V 0..8 of 16)
// sample only the top-left 16x16 quadrant of a frame, so that quadrant is the tile.
const FLUID_EXTRA = ['block/water_flow', 'block/lava_flow', 'block/water_overlay'];
const used = [...FLUID_EXTRA, ...JSON.parse(readFileSync(join(OUT, 'textures-used.json'), 'utf8')).filter((u) => !FLUID_EXTRA.includes(u))];
console.log(`textures referenced by block models: ${used.length}`);

const report = {
  requested: used.length,
  fromOld: [], fromNew: [], missing: [], animated: [], nonSquare: [], oversize: [],
};
const tiles = [];               // { key, rgba }
const byHash = new Map();       // content hash -> tile index
const index = {};               // texture id -> tile index
const anims = [];               // ANIM-1 (#1891): { id, layer, frames:[[index,time]], interpolate, n } + strips -> block-anim.bin
const animStrips = [];          // one { rgba } per strip frame, in anims order (the bleed pass below treats them as tiles)

// ── LAYER ORDER IS AN INTERFACE ──────────────────────────────────────────────────
// The atlas is uploaded as a texture ARRAY and the mesher writes layer numbers straight
// into the vertex data, so the order of these layers is part of the format.
//
// src/02_blocks.js has a hand-written table `B.T` mapping 57 names to layer indices, and
// the engine's whole legacy path uses it. Rather than remap those at runtime — which would
// mean shipping the map to every worker and getting it right in two places — the 57 legacy
// tiles are simply placed FIRST, in their existing order. The engine's numbers stay
// correct, the model stream's numbers are baked from THIS index so they follow
// automatically, and there is one atlas instead of two.
//
// Layer 0 is the missing-texture checkerboard and is generated, not sourced: "no texture"
// has to look like a bug rather than like a block.
const LEGACY = JSON.parse(readFileSync(new URL('./legacy-tiles.json', import.meta.url), 'utf8')).tiles;
{
  const check = Buffer.alloc(TILE * TILE * 4);
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const on = ((x >> 3) ^ (y >> 3)) & 1;
    const o = (y * TILE + x) * 4;
    check[o] = on ? 0xff : 0x20; check[o + 1] = 0; check[o + 2] = on ? 0xff : 0x20; check[o + 3] = 255;
  }
  tiles.push({ key: '__missing__', rgba: check });
  byHash.set(createHash('sha1').update(check).digest('hex'), 0);
}
// reserve layers 1..56 in the legacy order; they are filled by the normal pass below
const reserved = new Map();     // texture id -> the layer it must land on
for (let i = 1; i < LEGACY.length; i++) if (LEGACY[i][1]) reserved.set(LEGACY[i][1], i);
for (let i = 1; i < LEGACY.length; i++) tiles.push(null);

// ANIM-1 (#1891): the .mcmeta beside a strip, read the way vanilla's Sprite.createAnimation does
// (Sprite.java:85-130; AnimationResourceMetadata.java: frametime default 1, frames [n] | {index,time}).
// Returns null when vanilla would not animate it (no .mcmeta, or <= 1 valid frame).
function readAnim(jar, path, w, n) {
  if (w !== 16 || !jar.has(path + '.mcmeta')) return null;
  const a = JSON.parse(jar.readText(path + '.mcmeta')).animation;
  if (!a) return null;
  if ((a.width ?? w) !== w || (a.height ?? w) !== w) return null;   // non-square frames: none among 16x tiles
  const dflt = a.frametime ?? 1;
  let frames = (a.frames || []).map((f) => typeof f === 'number' ? [f, dflt] : [f.index, f.time ?? dflt]);
  if (!frames.length) for (let i = 0; i < n; i++) frames.push([i, dflt]);
  else frames = frames.filter(([i, t]) => t > 0 && i >= 0 && i < n);          // Sprite.java:100-118 drops invalid frames
  if (frames.length <= 1) return null;
  return { frames, interpolate: !!a.interpolate, n };
}

for (const id of used) {
  const path = texturePath(id);
  let src = null, from = null;
  if (jarOld.has(path)) { src = jarOld; from = 'old'; }
  else if (jarNew.has(path)) { src = jarNew; from = 'new'; }
  else { report.missing.push(id); continue; }

  let img;
  try { img = decodePng(src.read(path)); }
  catch (e) { report.missing.push(`${id} (decode: ${e.message})`); continue; }

  // Animated textures are a vertical strip of frames with a .mcmeta beside them.
  // Take frame 0 for now and RECORD it, rather than packing a 16x512 strip into a
  // 16x16 slot and wondering later why water looks like a barcode.
  if (img.width === 32 && FLUID_EXTRA.includes(id)) {
    const n = img.height / 32, out = Buffer.alloc(16 * 16 * n * 4);
    for (let f = 0; f < n; f++) for (let y = 0; y < 16; y++)
      Buffer.from(img.data.buffer, img.data.byteOffset + ((f * 32 + y) * 32) * 4, 16 * 4).copy(out, (f * 16 + y) * 16 * 4);
    img = { width: 16, height: 16 * n, data: out };
  }
  let { width, height, data } = img;
  let anim = null;
  if (height > width && height % width === 0) {
    report.animated.push(`${id} (${height / width} frames)`);
    anim = readAnim(src, path, width, height / width);
    if (anim) for (let f = 0; f < height / width; f++) animStrips.push({ rgba: Buffer.from(data.subarray(f * width * width * 4, (f + 1) * width * width * 4)) });
    data = data.subarray(0, width * width * 4);
    height = width;
  }
  if (width !== height) { report.nonSquare.push(`${id} ${width}x${height}`); continue; }

  // Higher-resolution textures exist in some packs; ours are 16x16. Downscaling would be
  // lossy, which D-7 forbids, so record and skip rather than silently degrade.
  if (width !== TILE) {
    if (width % TILE === 0) { report.oversize.push(`${id} ${width}x${height}`); }
    else { report.nonSquare.push(`${id} ${width}x${height}`); continue; }
  }

  const rgba = Buffer.from(data.subarray(0, TILE * TILE * 4));
  const hash = createHash('sha1').update(rgba).digest('hex');
  const slot = reserved.get(id);
  let ti;
  if (slot !== undefined) {
    // a legacy tile: it goes on its reserved layer whatever else shares its pixels
    tiles[slot] = { key: id, rgba };
    ti = slot;
    if (!anim && !byHash.has(hash)) byHash.set(hash, slot);
  } else if (anim) {
    // an animated tile owns its layer: a dedup onto another tile would animate that tile too
    ti = tiles.length; tiles.push({ key: id, rgba });
  } else {
    ti = byHash.get(hash);
    if (ti === undefined) { ti = tiles.length; tiles.push({ key: id, rgba }); byHash.set(hash, ti); }
  }
  index[id] = ti;
  if (anim) anims.push({ id, layer: ti, ...anim });
  (from === 'old' ? report.fromOld : report.fromNew).push(id);
}

// Every reserved legacy layer must have been filled. An empty one means the engine's tile
// table names a texture the roster never references, and layer N would draw nothing.
const holes = [];
for (let i = 0; i < LEGACY.length; i++) if (!tiles[i]) holes.push(`${i} ${LEGACY[i][0]} -> ${LEGACY[i][1]}`);
if (holes.length) {
  console.log('');
  console.log('✗ reserved legacy atlas layers were never filled:');
  for (const h of holes) console.log('   ' + h);
  console.log('  src/02_blocks.js names a texture that no block model references. Either the');
  console.log('  name is wrong or the tile should be dropped from B.T.');
  process.exit(1);
}

// ---------------------------------------------------------------- alpha bleed (D-146)
//
// ⚠ WHAT THIS FIXES, AND WHY IT IS A BUILD STEP RATHER THAN A SHADER FLAG.
//
// A cutout texture stores a colour under every texel, including the ones it has made
// transparent — and in the 1.13.2 jar those hidden colours are BLACK. Nothing reads them while
// the texel is discarded, so for most of the roster it does not matter. Two things read them:
//
//   * `fastLeaves` (D-93, the default on the low presets) moves leaves into the OPAQUE layer,
//     where nothing is discarded. Session 4 photographed the result: every tree in the world
//     mottled with black holes, 101 of the 256 texels of `acacia_leaves` among them. That is
//     the "awful" Dan reported, and no assertion in the suite could see it.
//   * bilinear filtering and mipmaps average a texel with its neighbours, so a black texel one
//     step outside a leaf bleeds a dark fringe INTO the leaf at any distance.
//
// Vanilla's own textures carry sensible colour under their transparent texels; ours do not, and
// the standard fix is the same one every atlas packer uses — flood the colour outward from the
// opaque texels into the transparent ones, leaving alpha alone. Cutout rendering is unchanged
// by construction (those texels are still discarded); everything that reads through alpha gets
// the leaf's own green instead of black.
{
  let bled = 0, tilesTouched = 0;
  for (const t of [...tiles, ...animStrips]) {
    if (!t) continue;
    const px = t.rgba;
    // which texels have colour to give: alpha > 0 to start with, and then whatever we filled
    const has = new Uint8Array(TILE * TILE);
    let holes = 0;
    for (let i = 0; i < TILE * TILE; i++) { if (px[i * 4 + 3] > 0) has[i] = 1; else holes++; }
    if (!holes || holes === TILE * TILE) continue;      // fully opaque, or nothing to bleed from
    let touched = false;
    // Four passes is enough for a 16x16 tile in practice; the loop stops early when a pass
    // fills nothing, so a texture with one isolated hole costs one pass.
    for (let pass = 0; pass < 8 && holes > 0; pass++) {
      const filled = [];
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          const i = y * TILE + x;
          if (has[i]) continue;
          // ⚠ COPY A NEIGHBOUR'S COLOUR, DO NOT AVERAGE. Averaging invents colours the texture
          // never had, and the atlas PNG is stored INDEXED — 289 tiles' worth of new averaged
          // colours cost 140 KB in the shipped file and bought nothing, because every texel this
          // touches is either discarded or filtered anyway. The first neighbour in a fixed order
          // is deterministic and keeps the palette exactly as large as it was.
          let found = -1;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= TILE || ny < 0 || ny >= TILE) continue;
            const j = ny * TILE + nx;
            if (!has[j]) continue;
            found = j; break;
          }
          if (found < 0) continue;
          filled.push([i, px[found * 4], px[found * 4 + 1], px[found * 4 + 2]]);
        }
      }
      if (!filled.length) break;
      for (const [i, r, g, b] of filled) {
        px[i * 4] = r; px[i * 4 + 1] = g; px[i * 4 + 2] = b;   // alpha untouched, on purpose
        has[i] = 1; holes--; bled++; touched = true;
      }
    }
    if (touched) tilesTouched++;
  }
  report.alphaBleed = { tiles: tilesTouched, texels: bled };
}

// ---------------------------------------------------------------- pack
const count = tiles.length;
const cols = Math.ceil(Math.sqrt(count));
const rows = Math.ceil(count / cols);
const W = cols * TILE, H = rows * TILE;
const atlas = Buffer.alloc(W * H * 4);
for (let i = 0; i < count; i++) {
  const cx = (i % cols) * TILE, cy = Math.floor(i / cols) * TILE;
  const t = tiles[i].rgba;
  for (let y = 0; y < TILE; y++) {
    t.copy(atlas, ((cy + y) * W + cx) * 4, y * TILE * 4, (y + 1) * TILE * 4);
  }
}

// ── the LAYERED form, which is what the GPU actually wants ────────────────────────
// The engine uploads the atlas as a 2D TEXTURE ARRAY, one tile per layer (D-50): layers
// cannot bleed into each other, so REPEAT wrapping makes the greedy mesher's tile counts
// exact with no UV inset and no textureGrad tricks. The packed PNG above is for the
// gallery and for looking at; this is what ships.
const layered = Buffer.alloc(count * TILE * TILE * 4);
for (let i = 0; i < count; i++) tiles[i].rgba.copy(layered, i * TILE * TILE * 4);
const layeredPacked = deflateRawSync(layered, { level: 9 });
writeFileSync(join(OUT, 'block-tiles.bin'), layeredPacked);

// ── per-tile ALPHA CLASS, one byte a tile (D-105) ─────────────────────────────────
// 0 = opaque      every pixel a=255. Draws in the opaque pass, no alpha test, early-Z works.
// 1 = cutout      only a=0 and a=255. Needs the alpha test; still no sorting.
// 2 = blend       at least one pixel strictly between. Needs back-to-front sorting.
//
// This exists because the render layer of a block is decided in Java (`RenderType`) and is
// in no data file anywhere — it is the one piece of "which pass does this draw in?" that
// cannot be extracted from the jar's JSON. The old 49-block table hand-wrote it per block,
// which does not scale to 900. Reading it off the PIXELS is both derivable and honest: a
// texture with a hole needs the alpha test whatever anyone writes in a table, and a texture
// with no hole does not.
//
// It is not the whole answer — vanilla puts a few blocks with fully opaque textures in the
// translucent pass anyway (stained glass, ice, honey, slime), and that short list is Java's
// alone. src/02c_states.js carries it explicitly and says so. This byte decides everything
// else, which is 890-odd blocks.
const tileAlpha = Buffer.alloc(count);
const alphaCounts = [0, 0, 0];
// ⚠ D-139: the loop that used to be written out here is GONE, not commented out. It is
// `alphaClass` in tools/png.mjs now, because tools/extract-items.mjs needs the same answer for
// the item sprites and two copies of a threshold is two thresholds.
for (let i = 0; i < count; i++) {
  tileAlpha[i] = alphaClass(tiles[i].rgba);
  alphaCounts[tileAlpha[i]]++;
}

writeFileSync(join(OUT, 'block-tiles.meta.json'), JSON.stringify({
  rawBytes: layered.length, packedBytes: layeredPacked.length, tile: TILE, count,
  alpha: Array.from(tileAlpha),
  alphaCounts: { opaque: alphaCounts[0], cutout: alphaCounts[1], blend: alphaCounts[2] },
}));

{ // ANIM-1: the strips (post alpha-bleed) and the per-tile clock data
  const raw = Buffer.concat(animStrips.map((t) => t.rgba));
  writeFileSync(join(OUT, 'block-anim.bin'), deflateRawSync(raw, { level: 9 }));
  writeFileSync(join(OUT, 'block-anim.meta.json'), JSON.stringify({ rawBytes: raw.length, anims }));
}

const png = encodePng(W, H, atlas, { level: 9, palette: true });
const rgbaPng = encodePng(W, H, atlas, { level: 9, palette: false });
writeFileSync(join(OUT, 'atlas.png'), png);
writeFileSync(join(OUT, 'atlas-index.json'), JSON.stringify({ tile: TILE, cols, rows, count, index }));

// distinct colours across the whole atlas - the number that decides whether indexed works
const colours = new Set();
for (let i = 0; i < atlas.length; i += 4) {
  colours.add((atlas[i] << 24) | (atlas[i+1] << 16) | (atlas[i+2] << 8) | atlas[i+3]);
}

const b64 = png.toString('base64');
const summary = {
  ...report,
  fromOldCount: report.fromOld.length,
  fromNewCount: report.fromNew.length,
  fromOld: undefined, fromNew: undefined,
  fallbackList: report.fromNew,
  uniqueTiles: count,
  atlas: `${W}x${H}`,
  distinctColours: colours.size,
  bytesIndexed: png.length,
  bytesRgba: rgbaPng.length,
  bytesBase64: b64.length,
  ms: Date.now() - t0,
};
writeFileSync(join(OUT, 'atlas-report.json'), JSON.stringify(summary, null, 2));

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log('');
console.log('================ build-atlas ================');
console.log(` requested ......... ${report.requested}`);
console.log(` from 1.13.2 (old) . ${summary.fromOldCount}   (${Math.round(100 * summary.fromOldCount / report.requested)}%)`);
console.log(` from 1.18.2 (new) . ${summary.fromNewCount}   <- the fallback list`);
console.log(` alpha classes ..... opaque ${alphaCounts[0]} · cutout ${alphaCounts[1]} · blend ${alphaCounts[2]}`);
console.log(` missing ........... ${report.missing.length}`);
console.log(` animated (frame 0)  ${report.animated.length}`);
console.log('');
console.log(` unique tiles ...... ${count}   (deduplicated from ${Object.keys(index).length} references)`);
console.log(` atlas ............. ${W}x${H}`);
console.log(` distinct colours .. ${colours.size}${colours.size <= 256 ? '  -> indexed colour fits' : '  -> too many for one palette'}`);
console.log('');
console.log(` PNG, indexed ...... ${kb(png.length)}`);
console.log(` alpha bleed ....... ${report.alphaBleed.texels} texels in ${report.alphaBleed.tiles} tiles   (D-146)`);
console.log(` PNG, RGBA ......... ${kb(rgbaPng.length)}   (${Math.round(100 - 100 * png.length / rgbaPng.length)}% saved by indexing)`);
console.log(` base64 in the file  ${kb(b64.length)}`);
console.log('');
console.log(` layered (GPU form)  ${kb(layered.length)} raw  ->  ${kb(layeredPacked.length)} deflated  ->  ${kb(layeredPacked.toString('base64').length)} base64`);
console.log('');
console.log(` ${summary.ms} ms  ->  ${OUT}/atlas.png`);
console.log('=============================================');
