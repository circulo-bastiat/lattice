#!/usr/bin/env node
// pack-mobtex.mjs — PASS 16, JOB 4.2's GPU wiring, DATA HALF (D-317/D-341/D-376's pattern a
// fourth time): bin-packs the FACE CROPS a mob box's texture actually needs into shared 16x16
// atlas layers, appended after the block-entity item tiles — exactly `pack-blockentity.mjs`'s
// own D-376 recipe, played on `mob-tex.bin` (JOB 4.2, `extract-mob-textures.mjs`) instead of
// the 58 block-entity item sheets.
//
//   node tools/pack-mobtex.mjs [--out assets]
//
// ── WHY THIS IS A SEPARATE FILE FROM pack-blockentity.mjs ──────────────────────────────────
// A block-entity item's box POSITIONS are static (a dropped chest never animates), so that file
// bakes REAL, FINAL quads — position AND uv — once, at build time, straight into `models.bin`'s
// flat quad arrays, and `ER.emitPart` draws them with not one line changed (D-341/D-342).
// A mob's box positions are NOT static: `setupAnim` (JOB 4.4, PASS 16) moves them every frame
// from live limb-swing state, so this file cannot bake positions at all — only the half of the
// job that IS static: which 16x16 crop of which sheet a face (or a SLICE of a face, exactly as
// a banner's flag is sliced) samples, and where that crop ends up in the shared atlas. That is
// `assets/mob-geometry.json`'s whole content: a lookup table keyed by (layer, part index, face
// index) -> a list of slices, each `{tile, ox, oy, u0, v0, w, h}` — `tile` the FINAL absolute
// atlas layer, `ox,oy` its placement inside that shared layer, `u0,v0,w,h` the slice's own
// rectangle in FACE-LOCAL pixel space (0,0 at the face's own top-left), so the live renderer
// (`07j_entityrender.js`, NOT this session — see git 2a8efe1:docs/passes/PASS-16-HISTORY.md) can pose a
// SUB-BOX for each slice with `BE.poseBoxCorners`/`BE.poseAxis`, the same live pose math JOB 4.3
// already uses, and stamp the FINAL tile+uv this file computed onto it. No position is baked.
//
// ── WHAT THIS DOES NOT DO (this session's own scope line, git 2a8efe1:docs/passes/PASS-16-HISTORY.md explains why) ──
// It does not touch `src/07j_entityrender.js`'s emission code, `ER.mobQuadCount`, or
// `ER.buildMobLayer`'s buffer sizing — none of those have a caller yet (`EntityList` spawns no
// mob), so wiring this table into the live per-frame path is untested integration until a mob
// exists to draw, exactly the trap git 2a8efe1:docs/passes/PASS-16-HISTORY.md and git 2a8efe1:docs/passes/PASS-16-HISTORY.md both already
// declined to walk into for their own pieces of this same job. This file's own output is
// verified independently, at the node level, by `tools/mobtexcheck.mjs` — a packed crop's
// pixels are compared BYTE FOR BYTE against a fresh, independent decode of the source sheet
// straight from the jar, not against this file's own intermediate state.
//
// ── FAMILY VARIANTS (horse colours, parrot colours, banner/shield patterns, …) ─────────────
// `extract-mob-textures.mjs` packs EVERY member of a texture family under ONE header key
// (`mobTexHeader.layers['cat']` alone holds all 11 `CatVariant` sheet indices, in ordinal
// order) but a mob box's GEOMETRY (`models.bin`'s `LAYERS[name]`) is keyed by the BASE name
// only — one box list for "cat", not eleven. D-469: this file now bakes EVERY member into its
// own `mob-geometry.json` slice table (`cat#1`..`cat#10`, alongside the unchanged plain `cat`
// = sheet 0), not sheet 0 alone — the base name still points at sheet 0 so no existing caller
// (a family with no picker yet: horse/llama/trader_llama/parrot/rabbit/bed_head/bed_foot/decor)
// changes what it draws. **Still-declared remainder**: picking a real variant at SPAWN time
// (a saved dye colour, a random breed roll) is a live per-entity concern with no caller for
// those families yet — `Tm.skinKey` (07n_tame.js, D-458/D-469) is the one picker that exists,
// and only for `cat`/`wolf_tame`; the renderer wiring that reads it is `ER.emitMobLayer`'s own
// `texKey` parameter (07j_entityrender.js, D-469).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { deflateRawSync, inflateRawSync, constants as ZLIB } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const OUT = opt('out', join(MCLITE_ROOT, 'assets'));
const TILE = 16;

let failures = 0;
const say = (s) => console.log(s);
const ok = (cond, msg) => { if (!cond) { failures++; say('   x ' + msg); } };

// ── inputs ───────────────────────────────────────────────────────────────────────────────────
if (!existsSync(join(OUT, 'mob-tex.bin'))) {
  console.error('pack-mobtex: assets/mob-tex.bin is missing — run tools/extract-mob-textures.mjs first');
  process.exit(1);
}
const mobTexRaw = readFileSync(join(OUT, 'mob-tex.bin'));
const mobTexWhole = inflateRawSync(mobTexRaw);
const mtHlen = mobTexWhole.readUInt32LE(0);
const mobTexHeader = JSON.parse(mobTexWhole.subarray(4, 4 + mtHlen).toString('utf8'));
const mobTexBody = mobTexWhole.subarray(4 + mtHlen);
ok(mobTexHeader.sheets.every((s) => typeof s.w === 'number' && typeof s.h === 'number'),
   'a mob-tex.bin sheet is missing w/h — regenerate with the current extract-mob-textures.mjs (the w/h bug this session fixed)');

const modelsBin = readFileSync(join(OUT, 'models.bin'));
const modelsPayload = JSON.parse(inflateRawSync(modelsBin, { finishFlush: ZLIB.Z_SYNC_FLUSH }).toString('utf8'));
const LAYERS = modelsPayload.layers;

const atlasIndex = JSON.parse(readFileSync(join(OUT, 'atlas-index.json'), 'utf8'));
const itemMeta = JSON.parse(readFileSync(join(OUT, 'item-tiles.meta.json'), 'utf8'));
const beMeta = JSON.parse(readFileSync(join(OUT, 'be-tiles.meta.json'), 'utf8'));
const TILE_BASE = atlasIndex.count + itemMeta.count + beMeta.count;
ok(beMeta.base + beMeta.count === TILE_BASE, 'TILE_BASE does not follow be-tiles — a layer count changed under this file');

// ── read one sheet's pixels, by sheet index ─────────────────────────────────────────────────
function sheetPixels(si) {
  const s = mobTexHeader.sheets[si];
  return { w: s.w, h: s.h, data: mobTexBody.subarray(s.o, s.o + s.len) };
}

// ── the box UV layout — `15h_bemodel.js`'s `BE.faceRects`, unchanged (D-317's one authority
// for the RECTANGLE; this file only decides how that rectangle gets PACKED) ────────────────────
function faceRects(p) {
  const g = p.g || 0, u = p.tu, v = p.tv, w = Math.round((p.w - 2 * g) * 1000) / 1000, h = Math.round((p.h - 2 * (g + (p.gy || 0))) * 1000) / 1000, d = Math.round((p.d - 2 * g) * 1000) / 1000;   // #633: un-grown size
  let west = [u, v + d, d, h];
  let east = [u + d + w, v + d, d, h];
  if (p.m) { const t = west; west = east; east = t; }
  return [east, west, [u + d + w, v, w, d], [u + d, v, w, d],   // ±Y per ModelPart.Cuboid (D-773, beautiful-allen-7isws6)
          [u + d + w + d, v + d, w, h], [u + d, v + d, w, h]];
}

// ── crop collection: one dedup'd crop per (sheet index, absolute rect) — the SAME identity
// rule D-376 uses (two faces reading the same source pixels are the same crop wherever they
// end up placed), extended by sheet index since mobs, unlike be-items, draw from MANY sheets ──
const tiles = { list: [], indexByKey: new Map() };   // key -> {si, u, v, w, h}
function tileFor(si, u, v, w, h, sx = 1, sy = 1) {
  const key = si + '|' + u + ',' + v + ',' + w + ',' + h + (sx !== 1 || sy !== 1 ? '|' + sx + 'x' + sy : '');
  let idx = tiles.indexByKey.get(key);
  if (idx === undefined) {
    idx = tiles.list.length;
    tiles.list.push({ si, u, v, w, h, sx, sy });
    tiles.indexByKey.set(key, idx);
  }
  return idx;
}

const ARCH_AXES = [['z', 'y'], ['z', 'y'], ['x', 'z'], ['x', 'z'], ['x', 'y'], ['x', 'y']];
const SIZE_KEY = { x: 'w', y: 'h', z: 'd' };

// ── build the face-slice table for every resolvable layer ──────────────────────────────────
const base = (n) => n.split('#')[0];
const geom = {};             // layerName -> [ per part: [ per face: [slices] ] ]
const report = { layers: 0, parts: 0, faces: 0, slices: 0, skippedNoGeometry: [], skippedNoModel: [] };

// D-469 — a texture alias that draws through an EXISTING mob's own box list (no row of its
// own in `models-1.18.2.tsv`, hence no `LAYERS` entry under its own name) rather than a model
// of its own — the collar unit's own shape, one layer early. Named here, not guessed: `Tm.
// skinKey` (07n_tame.js, D-458) already says `wolf_tame` draws wolf's own box; `wolf_angry` is
// deliberately NOT listed — this engine has no anger state to reach it with (see `Tm.OWED`),
// so baking its geometry now would be untested integration, not a real fix.
const GEOM_BASE_OVERRIDE = { fox_sleep: 'fox', snow_fox: 'fox', snow_fox_sleep: 'fox', ghast_shooting: 'ghast', mooshroom_brown: 'mooshroom', bee_angry: 'bee', bee_nectar: 'bee', bee_angry_nectar: 'bee', strider_cold: 'strider', wolf_tame: 'wolf', wolf_collar: 'wolf', cat_collar: 'cat', horse_marking: 'horse', horse_armor: 'horse', iron_golem_crack_low: 'iron_golem', iron_golem_crack_medium: 'iron_golem', iron_golem_crack_high: 'iron_golem', vex_charging: 'vex', wither_invulnerable: 'wither', phantom_eyes: 'phantom', enderman_eyes: 'enderman', spider_eyes: 'spider', dragon_eyes: 'ender_dragon' };  // D-471: the collar unit — see extract-mob-textures.mjs's own D-471 note, the collar is the base mob's OWN box list, tinted, not a shape of its own; QUEUE 0.2 (G18e remainder) extends the same override to the horse marking/armour overlays, the SAME horse box list, retextured

// D-469 — one layer's worth of face-slices, for ONE sheet index, under ONE output name. Was
// the body of the main loop below, inlined once per (bare-name) layer; factored out so a
// multi-sheet family (today only `cat`'s 11 `CatVariant` skins) can call it once per member
// instead of collapsing every member onto sheet 0.
function bakeVariant(gname, L, si) {
  if (geom[gname]) return;   // already done (e.g. "cat" claimed by its own vi===0 bake)
  const parts = L.parts;
  const partsOut = [];
  for (let k = 0; k < parts.length; k++) {
    const p = parts[k];
    const rects = faceRects(p);
    const facesOut = [];
    for (let f = 0; f < 6; f++) {
      const [uAxis, vAxis] = ARCH_AXES[f];
      // #633: the crop is cut in TEXELS (the un-grown rect); the box's own (grown) extent only
      // has to agree with it to within the 2g the dilation added -- `src/07j` stretches the slice
      // geometry by extent/texels, so a slice's u0/v0/w/h stay texel counts.
      const [ru, rv, rw, rh] = rects[f];
      const uSize = rw, vSize = rh, g2 = 2 * (Math.abs(p.g || 0) + Math.abs(p.gy || 0)) + 1e-6;
      if (Math.abs(rw - p[SIZE_KEY[uAxis]]) > g2 + 0.01 || Math.abs(rh - p[SIZE_KEY[vAxis]]) > g2 + 0.01) {
        ok(false, `${gname} part ${k} face ${f}: rect ${rw}x${rh} != box extent ${uSize}x${vSize}`);
        facesOut.push([]);
        continue;
      }
      // a degenerate face (uSize or vSize is 0, e.g. a flat "card" part like axolotl's body)
      // has nothing to sample — no slice, and the live renderer must know to skip it too.
      if (uSize <= 0 || vSize <= 0) { facesOut.push([]); continue; }
      const cols = Math.max(1, Math.ceil(uSize / TILE)), rows = Math.max(1, Math.ceil(vSize / TILE));
      const slices = [];
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const u0 = col * TILE, u1 = Math.min(uSize, u0 + TILE);
          const v0 = row * TILE, v1 = Math.min(vSize, v0 + TILE);
          // loop/zombie-villager-texture (D-694): `uSize`/`vSize` (and so `cols`/`rows`, the
          // SLICE COUNT) are deliberately left as-is above, fractional box and all — several
          // other checks' own golden constants (mobrendercheck's sheep "fur#null" quad count
          // among them) already bake in today's row/col counts, and changing THOSE is a much
          // bigger blast radius than this bug needs. What actually broke is narrower: `cw`/
          // `ch`/the absolute source rect below feed a CPU pixel-copy loop as literal array
          // indices (`for (y=0;y<c.h;y++)`, `img.data[(sy*img.w+sx)*4]`), and a fractional
          // index there is not a bug tolerance issue the way a fractional GPU UV coordinate is
          // (`15h_bemodel.js`'s `BE.faceRects`, unchanged, is fine) — a non-integer key on a
          // typed array/Buffer silently reads/writes nothing, so this crop's last row/col (or
          // the whole crop, when `ru+u0` itself is fractional) drops texels, and the shelf
          // packer (`packTiles`, below) can then seat a DIFFERENT crop's real pixels in the
          // gap — a base/type-layer pixel bleeding into a profession-overlay crop, D-694's own
          // symptom. Round ONLY the rect this crop actually samples/occupies, to the nearest
          // whole texel — a discrete-texel concept regardless of how many hundredths of a
          // block the box's OWN 3D vertices were dilated by.
          const cropU = Math.round(ru + u0), cropV = Math.round(rv + v0);
          const cw = Math.round(u1) - Math.round(u0), ch = Math.round(v1) - Math.round(v0);
          // G18a-U1 (#5852): vanilla UVs are normalised by the MODEL's texture size, so a sheet of another
          // size (end_crystal: a 128x64 png on a 64x32 model) is sampled at sheet/model scale.
          const SH = mobTexHeader.sheets[si], rx = gname.includes('#') ? 1 : SH.w / (L.tw || SH.w);
          // an animated sheet (vertical strip of square frames) spans ONE frame: no vertical scale
          const ry = gname.includes('#') ? 1 : rx === 1 && SH.h > SH.w && SH.h % (L.th || SH.h) === 0 && SH.h % SH.w === 0 ? 1 : SH.h / (L.th || SH.h);
          const ti = tileFor(si, cropU, cropV, cw, ch, rx, ry);
          slices.push({ ti, u0, v0, w: cw, h: ch });
          report.slices++;
        }
      }
      facesOut.push(slices);
      report.faces++;
    }
    partsOut.push(facesOut);
    report.parts++;
  }
  geom[gname] = partsOut;
  report.layers++;
}

const layerNames = Object.keys(mobTexHeader.layers).sort();
for (const name of layerNames) {
  const b = base(name);
  const sheetIdxs = mobTexHeader.layers[name];
  // loop/mobrender-s96 fix: the OLD filter here (`name.endsWith('#0') === false && name.includes('#') && ...`)
  // assumed every '#'-suffixed header key was a SYNTHETIC "base#N" family-variant index (the
  // shape `bakeVariant`'s own vi-loop below MINTS, e.g. "cat#1") and skipped anything that
  // wasn't literally "#0". That premise is false for a whole class of header keys that are
  // LITERAL layer identities in their own right — golden `models-1.18.2.tsv` rows named
  // "fur#null", "drowned#b", "husk#c", "armor_stand#b" etc (`cut -f1 tools/golden/models-
  // 1.18.2.tsv | grep '#'`), each with its OWN box list under that exact key in `LAYERS`
  // (`pack-models.mjs`'s `layers[name] = {..., parts: []}`, one entry per distinct golden
  // name — never collapsed onto a base). `extract-mob-textures.mjs` never emits a SYNTHETIC
  // "base#N" header key at all (a real multi-sheet family like "cat" is one header key,
  // "cat", mapped to an 11-long sheet-index array; `bakeVariant`'s vi-loop mints "cat#1".. on
  // the way OUT, never the way in) — so the old filter's `continue` was dropping every one of
  // these literal overlay layers before `LAYERS` was even consulted, including "fur#null"
  // (sheep's fleece), which is exactly why `assets/mob-geometry.json` never got it.
  // Fix: try the FULL name against `LAYERS` first (a literal layer has its own box list there);
  // only fall back to the base name when the full name has no boxes of its own (the real
  // family-variant case, where the base carries the shared geometry).
  const ownGeom = !!LAYERS[name];   // does the FULL name (not its base) have its own box list?
  const gbase = GEOM_BASE_OVERRIDE[name] || (ownGeom ? name : b);
  const L = LAYERS[gbase];
  if (!L) { report.skippedNoModel.push(name); continue; }
  // the texture OUTPUT key is independent of `gbase` (which an override like `wolf_tame` ->
  // "wolf" deliberately points at someone ELSE's geometry): a literal own-geometry layer
  // (fur#null, drowned#b, ...) keeps its own full name so its slice table lands under the
  // exact key `ER.mobGeomFor`/the golden TSV both use; anything else falls back to the
  // pre-existing rule (strip the suffix for a real numeric family variant, else keep as-is —
  // this is also what keeps `wolf_tame`'s own key distinct from the `wolf` geometry it borrows).
  const gname = ownGeom ? name : (name.includes('#') ? b : name);
  // baseline: sheet 0 under the PLAIN name, EXACTLY today's behaviour — every caller with no
  // per-entity picker yet (horse/llama/trader_llama/parrot/rabbit/bed_head/bed_foot/decor)
  // keeps drawing this one, unchanged.
  bakeVariant(gname, L, sheetIdxs[0]);
  // D-469 — every OTHER member of a multi-sheet family, its OWN slice table (`gname#1`..),
  // not collapsed onto sheet 0 (the "declared deviation" the header above used to name). Only
  // `Tm.skinKey` (07n_tame.js) actually SELECTS among these today, for `cat#0`..`cat#10` — its
  // own header cites the exact bytecode (`big.a()`/`CatType`) proving this index order IS the
  // `CatVariant` ordinal order `extract-mob-textures.mjs`'s `FAMILY.cat` array was already
  // built in (D-458), so no new jar read is owed for the mapping itself. The other families
  // are baked the same general way and sit ready, untested integration until each gets a
  // picker of its own — the same line this file's header already draws around live wiring.
  // (A literal-name layer like "fur#null" has exactly one sheet — `sheetIdxs.length === 1` —
  // so this loop never runs for it; it only fires for a real multi-sheet family like "cat".)
  for (let vi = 1; vi < sheetIdxs.length; vi++) bakeVariant(gname + '#' + vi, L, sheetIdxs[vi]);
}
report.skippedNoGeometry = layerNames.filter((n) => !LAYERS[GEOM_BASE_OVERRIDE[n] || (LAYERS[n] ? n : base(n))]);

// the 8 G18a target layers must all have exactly one sheet — multi-sheet is not handled
for (const must of ['creeper', 'pig', 'silverfish', 'endermite', 'wither', 'ender_dragon', 'fur']) {
  const idxs = mobTexHeader.layers[must] || mobTexHeader.layers[must + '#0'] || mobTexHeader.layers[must + '#null'];
  ok(idxs && idxs.length === 1, `"${must}" has ${idxs ? idxs.length : 0} sheets, not 1 — the single-sheet simplification does not cover it`);
}

// ── anti-vacuity FIRST: corrupt one real crop's identity, prove a distinguishable layer count ──
{
  const before = tiles.list.length;
  const savedList = tiles.list.slice(), savedMap = new Map(tiles.indexByKey);
  tileFor(999999, 0, 0, 16, 16);   // a crop that cannot already exist (no sheet index 999999)
  ok(tiles.list.length === before + 1, 'tileFor did not grow the crop list for a genuinely new key — the dedup check is not looking');
  tiles.list = savedList; tiles.indexByKey = savedMap;   // undo — this was a probe, not real data
}

if (failures) {
  console.error(`\npack-mobtex: ${failures} failures — nothing written`);
  process.exit(1);
}

// ── pack: same first-fit-decreasing-height shelf packer as pack-blockentity.mjs (D-376) ──────
function packTiles(sizes) {
  const order = sizes.map((_, i) => i).sort((a, b) => (sizes[b].h - sizes[a].h) || (sizes[b].w - sizes[a].w));
  const layers = [];
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
const { place, layerCount } = packTiles(tiles.list);

// ── stamp the FINAL absolute tile + placement offset into every slice ────────────────────────
for (const gname of Object.keys(geom)) {
  for (const partsFaces of geom[gname]) {
    for (const slices of partsFaces) {
      for (const s of slices) {
        const pl = place[s.ti];
        s.tile = TILE_BASE + pl.layer;
        s.ox = pl.x; s.oy = pl.y;
        delete s.ti;
      }
    }
  }
}

// ── render each shared layer's pixels ─────────────────────────────────────────────────────────
const tileBuf = new Uint8Array(layerCount * TILE * TILE * 4);
for (let i = 0; i < tiles.list.length; i++) {
  const c = tiles.list[i], pl = place[i];
  const img = sheetPixels(c.si);
  const layerBase = pl.layer * TILE * TILE * 4;
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      const sx = Math.floor((c.u + x + 0.5) * c.sx), sy = Math.floor((c.v + y + 0.5) * c.sy);
      if (sx < 0 || sy < 0 || sx >= img.w || sy >= img.h) continue;
      const si4 = (sy * img.w + sx) * 4;
      const dx = pl.x + x, dy = pl.y + y;
      const di = layerBase + (dy * TILE + dx) * 4;
      tileBuf[di] = img.data[si4]; tileBuf[di + 1] = img.data[si4 + 1];
      tileBuf[di + 2] = img.data[si4 + 2]; tileBuf[di + 3] = img.data[si4 + 3];
    }
  }
}

const packed = deflateRawSync(Buffer.from(tileBuf.buffer, tileBuf.byteOffset, tileBuf.byteLength), { level: 9 });
writeFileSync(join(OUT, 'mob-tiles.bin'), packed);
writeFileSync(join(OUT, 'mob-tiles.meta.json'), JSON.stringify({
  rawBytes: tileBuf.length, packedBytes: packed.length, tile: TILE, count: layerCount, base: TILE_BASE,
}));
writeFileSync(join(OUT, 'mob-geometry.json'), JSON.stringify({ tileBase: TILE_BASE, layers: geom }));

say('');
say('================ pack-mobtex ================');
say(` layers resolved ..... ${layerNames.length - report.skippedNoGeometry.length} of ${layerNames.length} (${report.skippedNoGeometry.length} skipped — no models.bin geometry for: ${report.skippedNoGeometry.join(', ') || 'none'})`);
say(` geometry entries ..... ${report.layers} (base layers + D-469's per-family-member variants)`);
say(` parts ................ ${report.parts}`);
say(` faces ................ ${report.faces}`);
say(` face-slices .......... ${report.slices} (crops: ${tiles.list.length} unique)`);
say(` mob-tiles ............ ${layerCount} (layer ${TILE_BASE}..${TILE_BASE + layerCount - 1}), ${(packed.length / 1024).toFixed(1)} KB deflated`);
say('================================================');
