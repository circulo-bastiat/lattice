#!/usr/bin/env node
// pack-painting.mjs — G17-HG7 (#5707): the painting atlas as 16x16 tile layers.
//
//   node tools/pack-painting.mjs [--out assets]
//
// PaintingManager stitches textures/painting/*.png into one atlas; PaintingEntityRenderer.renderPainting
// then draws ONE QUAD PER 16px TILE of a motive. Each of those quads samples exactly one 16x16 square of
// the motive's sheet, so each square is one atlas layer here (the shared model path samples 16x16 layers).
// Layer 0 is back.png (the frame/back sprite); then each motive in Hanging.MOTIVES order, row-major
// (row * cols + col). ER.paintTileIndex (src/07j_entityrender.js) recomputes that numbering.
// The 1.18.2 jar is the source (1.13.2 has the old single-sheet atlas): D-5 only pins mob sheets.

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Jar } from './jarlib.mjs';
import { decodePng } from './png.mjs';
import { JARS } from './paths.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const OUT = opt('out', join(ROOT, 'assets'));
const flat = JARS + '/1.18.2.jar', nested = JARS + '/1.18.2/1.18.2.jar';
const jar = new Jar(opt('jar', existsSync(flat) ? flat : nested));
const TILE = 16;

const src = readFileSync(join(ROOT, 'src/07zzv_hanging.js'), 'utf8');
const motives = [...src.slice(src.indexOf('H.MOTIVES')).split('];')[0].matchAll(/\['(\w+)', (\d+), (\d+)\]/g)]
  .map((m) => ({ id: m[1], w: +m[2], h: +m[3] }));
if (motives.length !== 26) { console.error('pack-painting: expected 26 motives, parsed ' + motives.length); process.exit(1); }

const read = (name) => decodePng(jar.read('assets/minecraft/textures/painting/' + name + '.png'));
const layers = [];
const crop = (img, x0, y0) => {
  const t = new Uint8Array(TILE * TILE * 4);
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const s = ((y0 + y) * img.width + x0 + x) * 4, d = (y * TILE + x) * 4;
    for (let c = 0; c < 4; c++) t[d + c] = img.data[s + c];
  }
  return t;
};
const back = read('back');
if (back.width !== TILE || back.height !== TILE) { console.error('pack-painting: back.png is not 16x16'); process.exit(1); }
layers.push(crop(back, 0, 0));
for (const m of motives) {
  const img = read(m.id);
  if (img.width !== m.w || img.height !== m.h) { console.error(`pack-painting: ${m.id}.png is ${img.width}x${img.height}, motive says ${m.w}x${m.h}`); process.exit(1); }
  for (let r = 0; r < m.h / TILE; r++) for (let c = 0; c < m.w / TILE; c++) layers.push(crop(img, c * TILE, r * TILE));
}
const raw = Buffer.concat(layers.map((l) => Buffer.from(l)));
const packed = deflateRawSync(raw, { level: 9 });
writeFileSync(join(OUT, 'painting-tiles.bin'), packed);
writeFileSync(join(OUT, 'painting-tiles.meta.json'), JSON.stringify({ rawBytes: raw.length, packedBytes: packed.length, tile: TILE, count: layers.length }));
console.log(`pack-painting: ${layers.length} layers (back + ${motives.length} motives), ${(packed.length / 1024).toFixed(1)} KB deflated`);
