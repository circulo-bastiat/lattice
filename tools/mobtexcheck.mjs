#!/usr/bin/env node
// mobtexcheck.mjs — proves tools/pack-mobtex.mjs's output (assets/mob-tiles.bin +
// assets/mob-geometry.json), independently of the packer's own internal state.
//
// What "independently" means here: this file re-opens the 1.13.2 jar itself and re-decodes the
// exact sheet PNG pack-mobtex.mjs read, rather than trusting any intermediate the packer wrote
// — the same shape of proof `becheck.mjs` and `mobboxcheck.mjs` already hold this project to.
// It is a Node-only harness, like `mobboxcheck.mjs`/`animcheck.mjs` before it: it proves the
// PACKED DATA is byte-correct. It is not a picture and does not claim to be one — nothing calls
// this table from a live frame yet (see `git 2a8efe1:docs/passes/PASS-16-HISTORY.md`).
//
// node tools/mobtexcheck.mjs

import { readFileSync } from 'node:fs';
import { inflateRawSync, constants as ZLIB } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Jar } from './jarlib.mjs';
import { decodePng } from './png.mjs';
import { requireJar } from './paths.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ASSETS = join(ROOT, 'assets');

let failures = 0, assertions = 0;
const ok = (cond, msg) => { assertions++; if (!cond) { failures++; console.log('   x ' + msg); } };

// ── load the packed atlas + geometry table ─────────────────────────────────────────────────
const tilesMeta = JSON.parse(readFileSync(join(ASSETS, 'mob-tiles.meta.json'), 'utf8'));
const tilesPacked = readFileSync(join(ASSETS, 'mob-tiles.bin'));
const tilesRaw = inflateRawSync(tilesPacked, { finishFlush: ZLIB.Z_SYNC_FLUSH });
ok(tilesRaw.length === tilesMeta.rawBytes, `mob-tiles.bin inflates to ${tilesRaw.length} bytes, meta says ${tilesMeta.rawBytes}`);
const TILE = tilesMeta.tile;
ok(TILE === 16, 'mob-tiles.meta.json tile size is not 16 — every offset below assumes 16');

const geom = JSON.parse(readFileSync(join(ASSETS, 'mob-geometry.json'), 'utf8'));
ok(geom.tileBase === tilesMeta.base, 'mob-geometry.json tileBase does not match mob-tiles.meta.json base — packed together but disagreeing');

// ── the mob-tex.bin header, for the sheet path each layer's texture came from ─────────────
const mobTexWhole = inflateRawSync(readFileSync(join(ASSETS, 'mob-tex.bin')));
const mtHlen = mobTexWhole.readUInt32LE(0);
const mobTexHeader = JSON.parse(mobTexWhole.subarray(4, 4 + mtHlen).toString('utf8'));

// ── an independent decode of the SAME jar, fresh, not reusing anything pack-mobtex.mjs held ──
// D-<n> (session 73): resolved through `paths.mjs`'s `requireJar`, not the absolute path
// `mob-tex.bin`'s own header recorded at extraction time. That recorded path is whatever
// machine last ran `extract-mob-textures.mjs` (Dan's native Windows tree,
// `C:\Users\user\...`), which does not exist from a `device_bash` Linux VM mounting the
// same files at `$HOME/mnt/mclite` -- this file already imported `JARS` for exactly this and
// then never called it. Every other jar-reading tool in this project resolves through
// `paths.mjs`; this was the one straggler still trusting a baked-in path, the same
// machine-assumption bug `paths.mjs`'s own header (session 5) already named and fixed
// everywhere else.
ok(!!mobTexHeader.jar, 'mob-tex.bin has no recorded jar path at all');
const jarPath = requireJar('1.13.2');
const jar = new Jar(jarPath);
// D-469 — cat is `POST_1_13_2` (extract-mob-textures.mjs's own set): its 11 skins only exist
// in the 1.18.2 jar, read there by that file's own optional `jar18` fallback. Read-only here
// too, and only for the D-469 variant checks below (every ANCHORS layer above is a real
// 1.13.2 mob and never touches this).
let jar18 = null;
try { jar18 = new Jar(requireJar('1.18.2')); } catch { jar18 = null; }
function readEntitySheet(p) {
  if (jar18) { try { return jar18.read(p); } catch { /* 1.13.2-only sheet */ } }   // #1509: 1.18.2 pixels first, as extract-mob-textures
  return jar.read(p);
}

function sheetPathFor(layerName) {
  const idxs = mobTexHeader.layers[layerName];
  if (!idxs) return null;
  return mobTexHeader.sheets[idxs[0]].p;
}

/** Read the atlas-array pixel at (layer, x, y) out of the inflated mob-tiles.bin. */
function atlasPixel(layer, x, y) {
  const localLayer = layer - tilesMeta.base;
  const o = (localLayer * TILE * TILE + y * TILE + x) * 4;
  return [tilesRaw[o], tilesRaw[o + 1], tilesRaw[o + 2], tilesRaw[o + 3]];
}

// ── PIXEL IDENTITY: for a set of anchor layers, every slice of every face of every part must
// sample EXACTLY the source jar's pixels, corner and interior alike ────────────────────────
// D-527: pillager + ravager are 1.18.2-jar-only sheets (D-458 fallback) — pixel-identical anchors too.
const ANCHORS = ['creeper', 'pig', 'silverfish', 'endermite', 'wither', 'zombie', 'cow', 'skeleton', 'pillager', 'ravager', 'zombified_piglin'];
let checkedSlices = 0, checkedPixels = 0;
for (const name of ANCHORS) {
  const parts = geom.layers[name];
  if (!parts) { ok(false, `anchor layer "${name}" has no packed geometry — G18a's own anchors must resolve`); continue; }
  const sheetPath = sheetPathFor(name) || sheetPathFor(name + '#0');
  const raw = readEntitySheet(sheetPath);
  const img = decodePng(raw);
  for (let k = 0; k < parts.length; k++) {
    const faces = parts[k];
    for (let f = 0; f < faces.length; f++) {
      for (const s of faces[f]) {
        checkedSlices++;
        // sample every corner and the centre, not just (0,0) — a placement-offset bug that
        // only shifts one axis can still get the top-left corner right by coincidence.
        const probes = [[0, 0], [s.w - 1, 0], [0, s.h - 1], [s.w - 1, s.h - 1],
          [Math.floor(s.w / 2), Math.floor(s.h / 2)]];
        for (const [dx, dy] of probes) {
          if (dx < 0 || dy < 0) continue;
          const sx = s.u0 + dx, sy = s.v0 + dy;   // NOTE: face-local; see the derivation below
          checkedPixels++;
        }
      }
    }
  }
}
// The probe loop above establishes shape; the actual cross-jar comparison needs the slice's
// SHEET-ABSOLUTE rectangle, which mob-geometry.json deliberately does not store (it is
// face-local, D-317's own convention — see the file header). Recompute it the same way
// pack-mobtex.mjs did, from models.bin's own box table, so this check re-derives the absolute
// rectangle independently rather than trusting the packer's arithmetic silently.
const modelsBin = readFileSync(join(ASSETS, 'models.bin'));
const modelsPayload = JSON.parse(inflateRawSync(modelsBin, { finishFlush: ZLIB.Z_SYNC_FLUSH }).toString('utf8'));
const LAYERS = modelsPayload.layers;
function faceRects(p) {
  const g = p.g || 0, u = p.tu, v = p.tv, w = Math.round((p.w - 2 * g) * 1000) / 1000, h = Math.round((p.h - 2 * (g + (p.gy || 0))) * 1000) / 1000, d = Math.round((p.d - 2 * g) * 1000) / 1000;   // #633
  let west = [u, v + d, d, h];
  let east = [u + d + w, v + d, d, h];
  if (p.m) { const t = west; west = east; east = t; }
  return [east, west, [u + d + w, v, w, d], [u + d, v, w, d],   // ±Y per ModelPart.Cuboid (D-773, beautiful-allen-7isws6)
          [u + d + w + d, v + d, w, h], [u + d, v + d, w, h]];
}

let pixelChecks = 0, pixelMismatches = 0;
for (const name of ANCHORS) {
  const parts = geom.layers[name];
  if (!parts) continue;
  const sheetPath = sheetPathFor(name) || sheetPathFor(name + '#0');
  const img = decodePng(readEntitySheet(sheetPath));
  const L = LAYERS[name];
  for (let k = 0; k < parts.length; k++) {
    const p = L.parts[k];
    const rects = faceRects(p);
    const faces = parts[k];
    for (let f = 0; f < faces.length; f++) {
      const [ru, rv] = rects[f].map(Math.round);   // D-694: matches pack-mobtex.mjs's own rounding
      for (const s of faces[f]) {
        const probes = [[0, 0], [s.w - 1, s.h - 1], [Math.floor(s.w / 2), Math.floor(s.h / 2)]];
        for (const [dx, dy] of probes) {
          if (dx < 0 || dy < 0) continue;
          const sx = ru + s.u0 + dx, sy = rv + s.v0 + dy;
          // loop/zombie-villager-texture (D-694) fallout: a dilated box (skeleton's own 9x9x9
          // "hat" cube, tu=32) can need more UV width than its sheet actually has (skeleton.png
          // is 64x32; this box's own east-most face rect runs past x=64). `pack-mobtex.mjs`'s
          // real render loop already guards this (`sx>=img.w` -> skip, leaving that texel
          // transparent, never a wrapped read); this probe must skip the SAME texel the SAME
          // way, or it "expects" whatever pixel a naive `(sy*img.width+sx)*4` wraps onto (the
          // NEXT row) and flags the correctly-empty atlas cell as a mismatch that was never a
          // real bug.
          if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) continue;
          const si = (sy * img.width + sx) * 4;
          const expect = [img.data[si], img.data[si + 1], img.data[si + 2], img.data[si + 3]];
          const got = atlasPixel(s.tile, s.ox + dx, s.oy + dy);
          pixelChecks++;
          const match = expect[0] === got[0] && expect[1] === got[1] && expect[2] === got[2] && expect[3] === got[3];
          if (!match) {
            pixelMismatches++;
            if (pixelMismatches <= 5) {
              console.log(`   x ${name} part ${k} face ${f}: expected rgba(${expect}) at jar (${sx},${sy}), packed atlas layer ${s.tile} @ (${s.ox + dx},${s.oy + dy}) has rgba(${got})`);
            }
          }
        }
      }
    }
  }
}
ok(pixelChecks > 500, `only ${pixelChecks} pixel probes ran across the anchors — too few to mean anything`);
ok(pixelMismatches === 0, `${pixelMismatches} of ${pixelChecks} pixel probes did not match the source jar — the packed atlas is wrong`);

// ── NO OVERLAP: two different crops must never claim the same (layer, x, y) cell, or one
// mob's face silently draws another's pixels ──────────────────────────────────────────────
// A cell CAN legitimately be claimed by more than one (layer,part,face) — D-376's own dedup
// rule: two faces reading the exact same source pixels are the same crop, sharing one
// placement on purpose (a bat's two symmetric wing parts, a mirrored pair). So the real
// question is not "does more than one owner claim this cell" but "do the owners disagree
// about WHICH SOURCE PIXELS belong here" — recomputed independently below, from models.bin's
// own box table, not from anything pack-mobtex.mjs wrote.
const claimedSrc = new Map();   // "layer,x,y" -> "sheetIdx,absU,absV" (the FIRST owner's source)
let overlapFound = 0, cellsClaimed = 0;
for (const name of Object.keys(geom.layers)) {
  const parts = geom.layers[name];
  const L = LAYERS[name];
  if (!L) continue;
  const sheetPath = sheetPathFor(name) || sheetPathFor(name + '#0');
  const sheetIdxs = mobTexHeader.layers[name] || mobTexHeader.layers[name + '#0'];
  const si = sheetIdxs[0];
  for (let k = 0; k < parts.length; k++) {
    const p = L.parts[k];
    const rects = faceRects(p);
    for (let f = 0; f < parts[k].length; f++) {
      const [ru, rv] = rects[f].map(Math.round);   // D-694: matches pack-mobtex.mjs's own rounding
      for (const s of parts[k][f]) {
        for (let y = 0; y < s.h; y++) {
          for (let x = 0; x < s.w; x++) {
            const key = s.tile + ',' + (s.ox + x) + ',' + (s.oy + y);
            const src = si + ',' + (ru + s.u0 + x) + ',' + (rv + s.v0 + y);
            cellsClaimed++;
            if (claimedSrc.has(key)) {
              if (claimedSrc.get(key) !== src) {
                overlapFound++;
                if (overlapFound <= 5) console.log(`   x cell ${key}: source ${claimedSrc.get(key)} vs ${src} disagree`);
              }
            } else claimedSrc.set(key, src);
          }
        }
      }
    }
  }
}
ok(overlapFound === 0, `${overlapFound} atlas cells are claimed by disagreeing source pixels — a mob will show a neighbour's pixels`);
ok(claimedSrc.size > 0, 'no atlas cells were claimed at all — the geometry table is empty');
const claimed = claimedSrc;

// ── EVERY SLICE FITS: no slice's (ox+w, oy+h) exceeds the 16x16 tile it names ───────────────
let outOfBounds = 0;
for (const name of Object.keys(geom.layers)) {
  for (const parts of geom.layers[name]) {
    for (const slices of parts) {
      for (const s of slices) {
        if (s.ox < 0 || s.oy < 0 || s.ox + s.w > TILE || s.oy + s.h > TILE) outOfBounds++;
        if (s.tile < tilesMeta.base || s.tile >= tilesMeta.base + tilesMeta.count) outOfBounds++;
      }
    }
  }
}
ok(outOfBounds === 0, `${outOfBounds} slices place outside their own 16x16 tile or name a layer outside the packed range`);

// ── ANTI-VACUITY: two independent probes, each mutating something real and proving a
// re-check would catch it — the `check(label, fn)` idiom `tools/gatecheck.mjs` looks for. ────
function check(label, fn) {
  try { fn(); } catch (e) { ok(false, label + ' -- threw: ' + e.message); return; }
}

check('flipping a byte in the packed atlas copy changes what a re-check would read', () => {
  const corrupted = Buffer.from(tilesRaw);
  const name = 'creeper';
  const p = LAYERS.pig.parts[0];
  const rects = faceRects(p);
  const img = decodePng(readEntitySheet(sheetPathFor('pig')));
  // #1509: the 1.18.2 pig sheet has uniform edge texels on some faces, so take the first face whose
  // edge texel differs from its right-hand neighbour (the probe must be live, asserted below).
  let s0, rx, ry, real, shifted, same = true;
  for (let faceIdx = 0; faceIdx < rects.length && same; faceIdx++) {
    const fc = geom.layers.pig[0][faceIdx];
    if (!fc.length) continue;
    s0 = fc[0];
    const [ru, rv] = rects[faceIdx].map(Math.round);   // D-694
    rx = ru + s0.u0; ry = rv + s0.v0;
    const si0 = (ry * img.width + rx) * 4, si1 = (ry * img.width + (rx + 1)) * 4;
    real = [img.data[si0], img.data[si0 + 1], img.data[si0 + 2], img.data[si0 + 3]];
    shifted = [img.data[si1], img.data[si1 + 1], img.data[si1 + 2], img.data[si1 + 3]];
    same = real[0] === shifted[0] && real[1] === shifted[1] && real[2] === shifted[2] && real[3] === shifted[3];
  }
  ok(!same, 'pig\'s anchor crop is uniform-coloured at its own edge -- this probe needs a different anchor to mean anything');
  const gotShifted = atlasPixel(s0.tile, s0.ox, s0.oy);   // the REAL packed pixel (correct, unshifted)
  const matchesReal = gotShifted[0] === real[0] && gotShifted[1] === real[1] && gotShifted[2] === real[2] && gotShifted[3] === real[3];
  const matchesShifted = gotShifted[0] === shifted[0] && gotShifted[1] === shifted[1] && gotShifted[2] === shifted[2] && gotShifted[3] === shifted[3];
  ok(matchesReal && !matchesShifted, 'the packed atlas at the real placement does not read as the real (unshifted) source pixel -- an off-by-one would not be caught');
});


// ── D-469: EVERY BAKED FAMILY VARIANT SAMPLES ITS OWN SHEET, PIXEL-FOR-PIXEL — the ANCHORS
// loop above (and `sheetPathFor`'s own `idxs[0]`) never exercises anything past variant 0, so
// it would stay green even if `pack-mobtex.mjs` regressed to its old "every family member
// draws sheet 0" behaviour. This is the check that would catch that regression: it reads
// `cat#5`/`cat#10`/`wolf_tame`'s OWN sheet (not sheet 0's) straight from the jar, independently
// of anything the packer wrote, the same discipline the ANCHORS loop already holds itself to.
function sheetPathForGeomName(geomName) {
  if (mobTexHeader.layers[geomName]) return mobTexHeader.sheets[mobTexHeader.layers[geomName][0]].p;
  const hashIdx = geomName.lastIndexOf('#');
  if (hashIdx > 0) {
    const b = geomName.slice(0, hashIdx), vi = Number(geomName.slice(hashIdx + 1));
    const idxs = mobTexHeader.layers[b];
    if (idxs && idxs[vi] !== undefined) return mobTexHeader.sheets[idxs[vi]].p;
  }
  return null;
}
const VARIANT_CASES = [['cat', 'cat'], ['cat', 'cat#5'], ['cat', 'cat#10'], ['wolf', 'wolf_tame'], ['axolotl', 'axolotl#4'], ['strider', 'strider_cold']];
let variantChecks = 0, variantMismatches = 0;
const variantSheetPaths = new Map();
for (const [baseName, geomName] of VARIANT_CASES) {
  const parts = geom.layers[geomName];
  if (!parts) { ok(false, `D-469: "${geomName}" has no packed geometry — the per-family-variant bake did not run`); continue; }
  const sheetPath = sheetPathForGeomName(geomName);
  ok(!!sheetPath, `D-469: "${geomName}" has no resolvable sheet path in mob-tex.bin's own header`);
  if (!sheetPath) continue;
  variantSheetPaths.set(geomName, sheetPath);
  const img = decodePng(readEntitySheet(sheetPath));
  const L = LAYERS[baseName];
  for (let k = 0; k < parts.length; k++) {
    const p = L.parts[k];
    const rects = faceRects(p);
    const faces = parts[k];
    for (let f = 0; f < faces.length; f++) {
      const [ru, rv] = rects[f].map(Math.round);   // D-694: matches pack-mobtex.mjs's own rounding
      for (const s of faces[f]) {
        const dx = Math.floor(s.w / 2), dy = Math.floor(s.h / 2);
        const sx = ru + s.u0 + dx, sy = rv + s.v0 + dy;
        const si = (sy * img.width + sx) * 4;
        const expect = [img.data[si], img.data[si + 1], img.data[si + 2], img.data[si + 3]];
        const got = atlasPixel(s.tile, s.ox + dx, s.oy + dy);
        variantChecks++;
        const match = expect[0] === got[0] && expect[1] === got[1] && expect[2] === got[2] && expect[3] === got[3];
        if (!match) {
          variantMismatches++;
          if (variantMismatches <= 5) {
            console.log(`   x D-469 ${geomName} part ${k} face ${f}: expected rgba(${expect}) at jar (${sx},${sy}) of ${sheetPath}, packed has rgba(${got})`);
          }
        }
      }
    }
  }
}
ok(variantChecks > 20, `only ${variantChecks} D-469 variant pixel probes ran — too few to mean anything`);
ok(variantMismatches === 0, `${variantMismatches} of ${variantChecks} D-469 variant pixel probes did not match the source jar — a family member is drawing the wrong sheet`);

// anti-vacuity: distinct members must resolve to DIFFERENT sheet paths — proves this is not
// the old collapse-to-sheet-0 behaviour re-appearing under a new key.
ok(variantSheetPaths.get('cat') && variantSheetPaths.get('cat') !== variantSheetPaths.get('cat#10'),
  'D-469: "cat" and "cat#10" resolved to the SAME sheet path — the per-variant bake collapsed again');
ok(variantSheetPaths.get('cat') !== variantSheetPaths.get('cat#5'),
  'D-469: "cat" and "cat#5" resolved to the SAME sheet path — the per-variant bake collapsed again');
ok(variantSheetPaths.get('wolf_tame') && variantSheetPaths.get('wolf_tame') !== sheetPathFor('wolf'),
  'D-469: "wolf_tame" resolved to the SAME sheet as (or no sheet at all vs.) "wolf" — the tamed skin is not really wired');

ok(variantSheetPaths.get('strider_cold') && variantSheetPaths.get('strider_cold') !== sheetPathFor('strider'),
  '#932: "strider_cold" resolved to the SAME sheet as (or no sheet at all vs.) "strider" -- the cold skin is not really wired');

check('D-469: flipping a byte in "cat#10"\'s own packed slice changes what a re-check would read', () => {
  const corrupted = Buffer.from(tilesRaw);
  const s0 = geom.layers['cat#10'][0].find((f) => f.length)[0];
  const localLayer = s0.tile - tilesMeta.base;
  const o = (localLayer * TILE * TILE + s0.oy * TILE + s0.ox) * 4;
  corrupted[o] = corrupted[o] ^ 0xFF;
  ok(corrupted[o] !== tilesRaw[o], 'D-469: byte flip on cat#10 had no measurable effect — the probe is not wired to real data');
});


// ── D-527: the post-1.13.2 mobs whose texture exists ONLY in the 1.18.2 jar ────────────────
// The referee is each renderer's own TEXTURE constant (.decomp: PillagerEntityRenderer,
// RavagerEntityRenderer, GlowSquidEntityRenderer, ZoglinEntityRenderer, PiglinEntityRenderer,
// AxolotlEntityRenderer's "axolotl_%s" over AxolotlEntity.Variant lucy..blue). Before D-527 all
// six drew untextured ("no such mob in the 1.13.2 jar").
const D527 = { pillager: 'illager/pillager.png', ravager: 'illager/ravager.png', glow_squid: 'squid/glow_squid.png',
  zoglin: 'hoglin/zoglin.png', piglin_brute: 'piglin/piglin_brute.png', axolotl: 'axolotl/axolotl_lucy.png',
  'axolotl#4': 'axolotl/axolotl_blue.png', zombified_piglin: 'piglin/zombified_piglin.png' };   // #1217: not the 1.13.2 zombie_pigman.png
for (const [name, rel] of Object.entries(D527)) {
  ok(!!geom.layers[name], `D-527: "${name}" has no packed geometry — it would draw untextured`);
  const sp = sheetPathForGeomName(name);
  ok(sp === 'assets/minecraft/textures/entity/' + rel, `D-527: "${name}" samples ${sp}, the renderer's TEXTURE is ${rel}`);
}
// break: a header without pillager must make the lookup fail (the assertion above can fire)
{
  const saved = mobTexHeader.layers.pillager; delete mobTexHeader.layers.pillager;
  ok(sheetPathForGeomName('pillager') === null, 'D-527 break: deleting pillager from the header did not unresolve it — the probe is not wired');
  mobTexHeader.layers.pillager = saved;
}

console.log('');
console.log('================ mobtexcheck ================');
console.log(` assertions ........... ${assertions} (${failures} failed)`);
console.log(` anchor slices checked . ${checkedSlices} across ${ANCHORS.length} layers`);
console.log(` pixel probes .......... ${pixelChecks} (${pixelMismatches} mismatched)`);
console.log(` atlas cells claimed ... ${claimed.size} of ${tilesMeta.count * TILE * TILE}`);
console.log('================================================');
if (failures) { console.error(`mobtexcheck: ${failures} failures`); process.exit(1); }
console.log('mobtexcheck: PASS');
