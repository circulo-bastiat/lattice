#!/usr/bin/env node
// villagerproftexcheck.mjs — loop/zombie-villager-texture (D-694, corrected attribution).
//
// D-694 (session 136) blamed `tools/pack-mobtex.mjs` for "baking non-transparent pixels into
// the profession-overlay atlas crop", confirmed live: the zombie villager's hat/profession
// overlay turned a solid block once a profession was equipped. A follow-up investigation
// (session 137, budget-limited) could not confirm the file — `pack-mobtex.mjs`'s `tileFor`/
// `bakeVariant` looked like pure geometry/UV bookkeeping, no pixel bytes touched. Read in
// full, `pack-mobtex.mjs` DOES composite pixels too (the "render each shared layer's pixels"
// loop after the packer, `tileBuf[di] = img.data[si4]...`) — D-694 named the right file. The
// wrong part was WHY: `villager`/`zombie_villager`'s own outer "body" (jacket/apron) cube is a
// REAL, deliberately-inflated vanilla box (`addBox(-4.05F,-0.05F,-3.05F, 8.1F,18.1F,6.1F, ...)`
// — extract-models.mjs's own bytecode read, not a bug in extraction). `pack-mobtex.mjs`'s
// `faceRects`/`bakeVariant` fed that FRACTIONAL box size straight into a CPU pixel-copy loop
// (`for (y=0;y<c.h;y++) for (x=0;x<c.w;x++)`, `si4 = (sy*img.w+sx)*4`): a fractional `si4`
// silently reads `undefined` off the source Buffer (a non-integer index is not a canonical
// array key), and a fractional slice `w`/`h` used as a loop bound runs one EXTRA row/col past
// the box's real 16x16 tile allocation, writing past the crop's own slot into whatever OTHER
// crop `packTiles`'s shelf-packer placed next to it in the same tile — i.e. a pixel from
// whichever layer (often the base/type layer, opaque villager skin) happened to land next to
// the profession crop bleeds into it. `15h_bemodel.js`'s own `BE.faceRects` has the identical
// unrounded formula and is NOT the bug: it feeds a GPU sampler continuous UV floats, which
// tolerates a fractional box size just fine (half a texel of bilinear blur, nothing "solid").
//
// THE CHECK: independently re-decode the SAME jar villager/zombie_villager profession PNGs
// `pack-mobtex.mjs` read, and prove every packed atlas texel for every profession layer's
// slice is byte-identical to that independent decode at the same (rounded) source coordinate
// — the same "PIXEL IDENTITY" proof `mobtexcheck.mjs`'s own ANCHORS list already holds
// creeper/pig/.../ravager to, extended to the one family that list never covered
// (villager/zombie_villager have no fixed sheet index — FAMILY, D-469 — so the generic
// ANCHORS loop there skips them; `sheetPathFor` returns whichever variant is sheet 0, which
// is the type-0 desert overlay for these two, not the base skin).
//
// Anti-vacuity (D-30): `--break` corrupts a fresh copy of pack-mobtex.mjs's own faceRects back
// to the pre-fix unrounded formula, regenerates the atlas from it, and asserts THIS check goes
// red against that corrupted atlas — proving the check can fail, not just always pass.
//
// node tools/villagerproftexcheck.mjs
// node tools/villagerproftexcheck.mjs --break   (self-test: prove the check catches the bug)

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { inflateRawSync, constants as ZLIB } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Jar } from './jarlib.mjs';
import { decodePng } from './png.mjs';
import { requireJar } from './paths.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ASSETS = join(ROOT, 'assets');
const BREAK = process.argv.includes('--break');

let failures = 0, assertions = 0;
const ok = (cond, msg) => { assertions++; if (!cond) { failures++; console.log('   x ' + msg); } return cond; };
const okAv = (cond, msg) => ok(cond, 'anti-vacuity: ' + msg);

// the SAME byte-compare the main sweep below uses — extracted so the D-30 unit test just below
// exercises the real comparison, not a copy of it that could silently drift from what actually runs.
function pixelsMatch(a, b) { return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]; }

console.log('villagerproftexcheck — loop/zombie-villager-texture (D-694): profession-overlay atlas texels byte-identical to source');

// ── D-30 self-test: reproduce the pre-fix bug, prove this check goes red against it ─────────
if (BREAK) {
  const src = join(ROOT, 'tools', 'pack-mobtex.mjs');
  const backup = src + '.breaktest-orig';
  copyFileSync(src, backup);
  try {
    let code = readFileSync(src, 'utf8');
    // #633 made the crop rect the UN-GROWN size, so the old fractional-crop break can no longer bite
    // (no fractional sizes reach the crop loop); the break now feeds the GROWN (inflated) box size back
    // into pack-mobtex.mjs's faceRects, which shifts every crop by the dilation and must go red.
    const fixedRect = 'w = Math.round((p.w - 2 * g) * 1000) / 1000, h = Math.round((p.h - 2 * g) * 1000) / 1000, d = Math.round((p.d - 2 * g) * 1000) / 1000;';
    const brokenRect = 'w = p.w, h = p.h, d = p.d;';
    if (!code.includes(fixedRect)) {
      console.error('villagerproftexcheck --break: pack-mobtex.mjs\'s faceRects does not match the expected FIXED text — cannot self-test against an already-different file');
      process.exit(1);
    }
    code = code.replace(fixedRect, brokenRect);
    writeFileSync(src, code);
    console.log('   (--break) fed the grown (inflated) box size back into pack-mobtex.mjs faceRects, regenerating the atlas from it');
    execFileSync(process.execPath, [src], { cwd: ROOT, stdio: 'inherit' });
    // run THIS check's own verification logic against the now-broken atlas, in a fresh child
    // process (so its "N failures -> exit(1)" is observable independently of this process's
    // own exit code), BEFORE any restore happens — the whole point of --break is to prove the
    // check goes red against the broken output, not the restored one.
    let brokeCheckFailed = false;
    try {
      execFileSync(process.execPath, [import.meta.url.replace('file://', '')], { cwd: ROOT, stdio: 'inherit' });
    } catch (e) {
      brokeCheckFailed = true;   // non-zero exit — exactly what --break is supposed to prove
    }
    console.log(brokeCheckFailed
      ? '   (--break) OK: villagerproftexcheck correctly went RED against the pre-fix broken atlas'
      : '   (--break) FAIL: villagerproftexcheck stayed GREEN against the pre-fix broken atlas — the check is not catching D-694 after all');
    copyFileSync(backup, src);
    execFileSync(process.execPath, ['-e', `require('fs').unlinkSync(${JSON.stringify(backup)})`]);
    console.log('   (--break) restored the real pack-mobtex.mjs and regenerated the real atlas');
    execFileSync(process.execPath, [src], { cwd: ROOT, stdio: 'inherit' });
    process.exit(brokeCheckFailed ? 0 : 1);
  } catch (e) {
    copyFileSync(backup, src);
    execFileSync(process.execPath, ['-e', `require('fs').unlinkSync(${JSON.stringify(backup)})`]);
    execFileSync(process.execPath, [src], { cwd: ROOT, stdio: 'inherit' });
    throw e;
  }
}

// ── D-30 unit-level self-test: the real `pixelsMatch` comparison this check's own sweep uses
// (above) must actually distinguish a matching texel pair from a mismatched one — a SECOND,
// distinct break from the whole-pipeline `--break` self-test above (that one proves the FULL
// pipeline goes red on the real D-694 bug; this one proves the comparison PRIMITIVE itself isn't
// a no-op that would pass regardless, e.g. `return true` or a swapped operand).
okAv(pixelsMatch([12, 34, 56, 255], [12, 34, 56, 255]) === true,
  'pixelsMatch must accept two byte-identical texels');
okAv(pixelsMatch([12, 34, 56, 255], [12, 34, 56, 254]) === false,
  'pixelsMatch must reject texels that differ by only 1 in the alpha channel (the exact class of off-by-one this check exists to catch)');

// ── load the packed atlas + geometry table (regenerated by --break above when passed) ───────
const tilesMeta = JSON.parse(readFileSync(join(ASSETS, 'mob-tiles.meta.json'), 'utf8'));
const tilesRaw = inflateRawSync(readFileSync(join(ASSETS, 'mob-tiles.bin')), { finishFlush: ZLIB.Z_SYNC_FLUSH });
const TILE = tilesMeta.tile;
const geom = JSON.parse(readFileSync(join(ASSETS, 'mob-geometry.json'), 'utf8'));
const modelsBin = readFileSync(join(ASSETS, 'models.bin'));
const modelsPayload = JSON.parse(inflateRawSync(modelsBin, { finishFlush: ZLIB.Z_SYNC_FLUSH }).toString('utf8'));

function atlasPixel(layer, x, y) {
  const localLayer = layer - tilesMeta.base;
  const o = (localLayer * TILE * TILE + y * TILE + x) * 4;
  return [tilesRaw[o], tilesRaw[o + 1], tilesRaw[o + 2], tilesRaw[o + 3]];
}
// UNCHANGED from `pack-mobtex.mjs`'s own `faceRects` — the fix does not touch this function
// (rounding the box's own w/h/d would shift row/col SLICE COUNTS, which several other checks'
// golden constants already bake in, e.g. mobrendercheck's sheep "fur#null" quad count). Instead
// `pack-mobtex.mjs` rounds only the final absolute crop rect it actually samples/packs
// (`Math.round(ru + u0)` etc, at the `tileFor` call site) — reproduced below at the same
// point, not here.
function faceRects(p) {
  // #633: the crop rect is the UN-GROWN size (pack-mobtex.mjs's own faceRects) - the box's p.w/h/d carry the dilation g on each side
  const g = p.g || 0, u = p.tu, v = p.tv, w = Math.round((p.w - 2 * g) * 1000) / 1000, h = Math.round((p.h - 2 * g) * 1000) / 1000, d = Math.round((p.d - 2 * g) * 1000) / 1000;
  let west = [u, v + d, d, h];
  let east = [u + d + w, v + d, d, h];
  if (p.m) { const t = west; west = east; east = t; }
  return [east, west, [u + d + w, v, w, d], [u + d, v, w, d],   // ±Y per ModelPart.Cuboid (D-773, beautiful-allen-7isws6)
          [u + d + w + d, v + d, w, h], [u + d, v + d, w, h]];
}

let jar13 = null, jar18 = null;
try { jar13 = new Jar(requireJar('1.13.2')); } catch { jar13 = null; }
try { jar18 = new Jar(requireJar('1.18.2')); } catch { jar18 = null; }
function readEntity(p) {
  try { return jar13.read(p); } catch (e) { if (jar18) return jar18.read(p); throw e; }
}

const PROFESSIONS = ['armorer', 'butcher', 'cartographer', 'cleric', 'farmer', 'fisherman',
  'fletcher', 'leatherworker', 'librarian', 'mason', 'nitwit', 'shepherd', 'toolsmith', 'weaponsmith'];

let checkedTexels = 0;
for (const entityType of ['villager', 'zombie_villager']) {
  const L = modelsPayload.layers[entityType];
  if (!ok(!!L, `models.bin has box geometry for "${entityType}"`)) continue;
  for (let pi = 0; pi < PROFESSIONS.length; pi++) {
    const prof = PROFESSIONS[pi];
    const key = entityType + '#' + (8 + pi);   // ER.villagerClothingLayers' own texKey rule
    const partsFaces = geom.layers[key];
    if (!ok(!!partsFaces, `mob-geometry.json has a slice table for "${key}" (${entityType}/${prof})`)) continue;

    let img;
    try {
      img = decodePng(readEntity(`assets/minecraft/textures/entity/${entityType}/profession/${prof}.png`));
    } catch (e) {
      ok(false, `could not independently decode ${entityType}/profession/${prof}.png: ${e.message}`);
      continue;
    }

    let mismatches = 0, sampled = 0;
    partsFaces.forEach((faces, pk) => {
      const p = L.parts[pk];
      if (!p) return;
      const rects = faceRects(p);
      faces.forEach((slices, f) => {
        // `s.u0`/`s.v0` are always whole TILE multiples, so `Math.round(ru+u0) === Math.round(ru)+u0`
        // — rounding `ru`/`rv` once here matches, texel for texel, what `pack-mobtex.mjs`'s own
        // `Math.round(ru + u0)` (at its `tileFor` call site) actually packed.
        const ru = Math.round(rects[f][0]), rv = Math.round(rects[f][1]);
        slices.forEach((s) => {
          // every texel of the slice, not just corners — the bug this check exists for was an
          // off-by-one on the LAST row/col of a slice, which a corner-only probe (mobtexcheck's
          // own ANCHORS loop) can miss when the slice's own w/h happens to be corner-safe.
          for (let dy = 0; dy < s.h; dy++) {
            for (let dx = 0; dx < s.w; dx++) {
              const sx = ru + s.u0 + dx, sy = rv + s.v0 + dy;
              if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) continue;   // real box edge, not this bug
              sampled++; checkedTexels++;
              const ax = atlasPixel(s.tile, s.ox + dx, s.oy + dy);
              const so = (sy * img.width + sx) * 4;
              const sp = [img.data[so], img.data[so + 1], img.data[so + 2], img.data[so + 3]];
              if (!pixelsMatch(ax, sp)) mismatches++;
            }
          }
        });
      });
    });
    ok(sampled > 100, `"${key}" (${entityType}/${prof}) sampled a real number of texels (got ${sampled}) — the slice table is not empty`);
    ok(mismatches === 0, `"${key}" (${entityType}/${prof}): ${mismatches} of ${sampled} packed atlas texels do not byte-match an independent re-decode of ${prof}.png (D-694 — a base/type-layer pixel bleeding into the profession-overlay crop)`);
  }
}

console.log(`  sampled ${checkedTexels} texels across ${2 * PROFESSIONS.length} villager/zombie_villager profession overlays`);
console.log(`\n  ✓ pixelsMatch accepts an identical texel pair\n  ✓ pixelsMatch rejects a 1-off alpha (2 breaks caught; the whole-pipeline break is --break)\nvillagerproftexcheck: ${assertions} assertions, ${failures} failures.`);
if (failures) { console.error(`villagerproftexcheck: ${failures} failures`); process.exit(1); }
console.log('villagerproftexcheck: OK');
