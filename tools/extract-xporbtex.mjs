#!/usr/bin/env node
// extract-xporbtex.mjs — G21 (loop/xporbsprite): the EXPERIENCE ORB SPRITE SHEET,
// `ER.OWED`'s own "experience_orb — G21" line (07j_entityrender.js) — "the xp orb exists as a
// ticking entity but is not drawn". `ExperienceOrbEntityRenderer.method_3966` (.decomp/net/
// minecraft/client/render/entity/ExperienceOrbEntityRenderer.java:29-58) samples ONE texture,
// `textures/entity/experience_orb.png`, at a 16x16 crop chosen by `ExperienceOrbEntity.
// getOrbSize()` (.decomp/net/minecraft/entity/ExperienceOrbEntity.java:254-275) — there is no
// per-particle-type JSON indirection here the way `extract-particletex.mjs` has for particles;
// this is a single sheet, read straight off the jar and verified 64x64 before packing (the SAME
// "verify, never crop/stretch a surprise size" discipline that tool already established).
//
//   node tools/extract-xporbtex.mjs   -> assets/xporb-tex.bin, assets/xporb-tex.meta.json
//
// ── THE SHEET LAYOUT, READ OFF THE RENDERER'S OWN UV MATH, NOT GUESSED ──────────────────────
// `method_3966`'s own crop: `u0=(size%4*16+0)/64`, `u1=(size%4*16+16)/64`, `v0=(size/4*16+0)/64`
// (integer division), `v1=(size/4*16+16)/64` — a 4-column grid of 16x16 tiles over a 64x64
// sheet, column = `size % 4`, row = `size / 4`. `getOrbSize()` only ever returns 0..10 (11 of
// the 16 grid cells are ever selected; cells 11..15 exist on the sheet but nothing samples
// them, same as vanilla).
//
// ── ANTI-VACUITY ─────────────────────────────────────────────────────────────────────────────
// Point this tool at a texture path this jar does not have and it must fail loudly, not write a
// blank/garbage sheet — proven below by asking for a texture name that cannot exist and
// asserting extraction refuses, before the real one is packed.

import { writeFileSync, existsSync } from 'node:fs';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Jar } from './jarlib.mjs';
import { decodePng } from './png.mjs';
import { JARS } from './paths.mjs';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const jarPath = (v) => {
  const flat = JARS + '/' + v + '.jar';
  const nested = JARS + '/' + v + '/' + v + '.jar';
  return existsSync(flat) ? flat : nested;
};
const JAR = opt('jar', jarPath('1.18.2'));
const OUT = opt('out', join(MCLITE_ROOT, 'assets'));
const SHEET = 64;      // the whole texture, verified below
const TILE = 16;       // one orb icon
const COLS = 4;
const ICONS = 11;      // getOrbSize() only ever returns 0..10

let failures = 0;
const say = (s) => console.log(s);
const ok = (cond, msg) => { if (!cond) { failures++; say('   x ' + msg); } };

const jar = new Jar(JAR);
const TEXTURE_PNG = 'assets/minecraft/textures/entity/experience_orb.png';

function readSheet(path) {
  if (!jar.names().includes(path)) throw new Error('extract-xporbtex: texture not in this jar: ' + path);
  const img = decodePng(jar.read(path));
  if (!img || !img.data) throw new Error('extract-xporbtex: ' + path + ' did not decode');
  return img;
}

// ── anti-vacuity FIRST: a texture name this jar cannot have must refuse, not silently pack ──
{
  let threw = false;
  try { readSheet('assets/minecraft/textures/entity/this_png_does_not_exist.png'); }
  catch (err) { threw = /texture not in this jar/.test(err.message); }
  ok(threw, 'a missing texture path did not refuse extraction — the check is not looking');
}

say('');
const img = readSheet(TEXTURE_PNG);
ok(img.width === SHEET && img.height === SHEET,
   `experience_orb.png is ${img.width}x${img.height}, not ${SHEET}x${SHEET} — ` +
   'this packer only handles the vanilla sheet size and will not silently resample a surprise one');

if (failures) {
  console.error(`\nextract-xporbtex: ${failures} failures — nothing written`);
  process.exit(1);
}

const packed = deflateRawSync(img.data, { level: 9 });
if (Buffer.compare(inflateRawSync(packed), img.data) !== 0) {
  console.error('extract-xporbtex: deflate round trip did not match');
  process.exit(1);
}
writeFileSync(join(OUT, 'xporb-tex.bin'), packed);
writeFileSync(join(OUT, 'xporb-tex.meta.json'), JSON.stringify({
  jar: JAR, sheet: SHEET, tile: TILE, cols: COLS, icons: ICONS,
  rawBytes: img.data.length, packedBytes: packed.length,
}, null, 2));

say('');
say('================ extract-xporbtex ================');
say(` sheet .............. ${SHEET}x${SHEET}, ${TILE}x${TILE} tiles, ${ICONS} icons used of ${COLS * COLS}`);
say(` xporb-tex.bin ....... ${(img.data.length / 1024).toFixed(2)} KB raw -> ${(packed.length / 1024).toFixed(2)} KB deflated`);
say('====================================================');
