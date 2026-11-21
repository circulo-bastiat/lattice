#!/usr/bin/env node
// pack-colormaps.mjs — PLAN W5. The two biome colour ramps, out of the jar.
//
//   node tools/pack-colormaps.mjs [--jar <1.18.2.jar>] [--out assets]
//
// `assets/minecraft/textures/colormap/grass.png` and `foliage.png` are 256x256 images that
// vanilla indexes by a biome's temperature and downfall. They are the reason a plains is
// yellow-green and a jungle is deep green, and they are in the client jar — not in any data
// file — which is why they arrive here rather than through the worldgen fetch.
//
// ── THE INDEXING, AND WHY IT IS ASSERTED RATHER THAN COMMENTED ────────────────────────────
// Mojang's `GrassColor.get(temperature, downfall)`:
//
//     humidity *= temperature
//     i = (int)((1 - temperature) * 255)
//     j = (int)((1 - humidity)    * 255)
//     colour = pixels[(j << 8) | i]
//
// with both inputs clamped to 0..1 first. It is easy to write that down with i and j the wrong
// way round and get a picture that is still plausibly green, so this tool checks four biomes
// whose vanilla colours are common knowledge — plains grass #91BD59 and foliage #77AB2F,
// desert grass #BFB755 and foliage #AEA42A — and fails the build if the ramp it just packed
// does not produce them. Those four numbers are the acceptance test for the whole file.
//
// ── THE FORMAT ───────────────────────────────────────────────────────────────────────────
// Both maps as raw RGB, 256x256, no alpha. 196,608 bytes each; they are smooth gradients and
// deflate to about 54 KB for the pair. Ninety per cent of a colormap is a triangle and the
// rest is padding, so a triangle-only packing would save perhaps 40% of 54 KB — which against
// D-12's 15 MB ceiling is not worth a second layout to get wrong.
//
//   0   u32  magic 'MCCM'
//   4   u16  format version
//   6   u16  size (256)
//   8   u32  maps (2: grass then foliage)
//   12       maps * size * size * 3 bytes of RGB
//
// deflated, round-tripped, then base64 into 19_data.gen.js like every other blob.

import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { Jar } from './jarlib.mjs';
import { decodePng } from './png.mjs';
import { JARS as MCLITE_JARS } from './paths.mjs';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const VERSION = opt('version', '1.18.2');
/* MCLITE_JARS now comes from tools/paths.mjs (session 5) */
const jarPath = (v) => {
  const flat = MCLITE_JARS + '/' + v + '.jar';
  const nested = MCLITE_JARS + '/' + v + '/' + v + '.jar';
  return existsSync(flat) ? flat : (existsSync(nested) ? nested : flat);
};
const JAR = opt('jar', jarPath(VERSION));
const OUT = opt('out', MCLITE_ROOT + 'assets');
const FORMAT = 1;
const SIZE = 256;
const MAPS = ['grass', 'foliage'];

if (!existsSync(JAR)) { console.error('no jar at ' + JAR + '\n  set MCLITE_JARS or pass --jar'); process.exit(1); }

const t0 = Date.now();
const fail = [];
const jar = new Jar(JAR);

const planes = [];
for (const name of MAPS) {
  const path = 'assets/minecraft/textures/colormap/' + name + '.png';
  if (!jar.has(path)) { console.error('no ' + path + ' in ' + JAR); process.exit(1); }
  const img = decodePng(jar.read(path));
  if (img.width !== SIZE || img.height !== SIZE) fail.push(`${name}.png is ${img.width}x${img.height}, expected ${SIZE}x${SIZE}`);
  const rgb = Buffer.alloc(SIZE * SIZE * 3);
  for (let i = 0; i < SIZE * SIZE; i++) {
    rgb[i * 3] = img.data[i * 4];
    rgb[i * 3 + 1] = img.data[i * 4 + 1];
    rgb[i * 3 + 2] = img.data[i * 4 + 2];
  }
  planes.push(rgb);
}

// ---------------------------------------------------------------- the indexing, checked
const clamp01 = (v) => (v < 0 ? 0 : (v > 1 ? 1 : v));
function sample(plane, temperature, downfall) {
  const t = clamp01(temperature), h = clamp01(downfall) * clamp01(temperature);
  const i = Math.trunc((1 - t) * 255), j = Math.trunc((1 - h) * 255);
  const k = (j << 8) | i;
  if (k < 0 || k >= SIZE * SIZE) return 0xff00ff;            // vanilla's -65281, magenta
  return (plane[k * 3] << 16) | (plane[k * 3 + 1] << 8) | plane[k * 3 + 2];
}
const hex = (c) => '#' + c.toString(16).padStart(6, '0').toUpperCase();

// temperature, downfall, expected grass, expected foliage — the four numbers that pin the
// indexing down. plains is 0.8/0.4; desert is 2.0/0.0, which clamps to 1.0/0.0.
const PROBES = [
  ['plains', 0.8, 0.4, 0x91bd59, 0x77ab2f],
  ['desert', 2.0, 0.0, 0xbfb755, 0xaea42a],
];
for (const [name, t, d, wantG, wantF] of PROBES) {
  const g = sample(planes[0], t, d), f = sample(planes[1], t, d);
  if (g !== wantG) fail.push(`${name} grass came out ${hex(g)}, vanilla is ${hex(wantG)} — the colormap indexing is wrong`);
  if (f !== wantF) fail.push(`${name} foliage came out ${hex(f)}, vanilla is ${hex(wantF)} — the colormap indexing is wrong`);
}

// ---------------------------------------------------------------- pack
const head = 12;
const buf = Buffer.alloc(head + planes.length * SIZE * SIZE * 3);
buf.write('MCCM', 0, 'ascii');
buf.writeUInt16LE(FORMAT, 4);
buf.writeUInt16LE(SIZE, 6);
buf.writeUInt32LE(planes.length, 8);
for (let m = 0; m < planes.length; m++) planes[m].copy(buf, head + m * SIZE * SIZE * 3);

const deflated = deflateRawSync(buf, { level: 9 });
const back = inflateRawSync(deflated);
if (!back.equals(buf)) { console.error('FATAL: colormaps blob does not round-trip through deflate'); process.exit(1); }

writeFileSync(join(OUT, 'colormaps.bin'), deflated);
writeFileSync(join(OUT, 'colormaps.meta.json'), JSON.stringify({
  version: VERSION, format: FORMAT, size: SIZE, maps: MAPS,
  rawBytes: buf.length, packedBytes: deflated.length,
  probes: PROBES.map(([n, t, d]) => ({ biome: n, temperature: t, downfall: d,
    grass: hex(sample(planes[0], t, d)), foliage: hex(sample(planes[1], t, d)) })),
}));

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log('');
console.log('================ pack-colormaps ================');
console.log(` jar ............... ${JAR}`);
console.log(` maps .............. ${MAPS.join(', ')}  ${SIZE}x${SIZE} RGB`);
for (const [name, t, d] of PROBES) {
  console.log(`   ${name.padEnd(8)} t=${t} d=${d}   grass ${hex(sample(planes[0], t, d))}   foliage ${hex(sample(planes[1], t, d))}`);
}
console.log(` packed ............ ${kb(buf.length)} raw -> ${kb(deflated.length)} deflated -> ${kb(deflated.length * 4 / 3)} as base64`);
console.log(` failures .......... ${fail.length}`);
for (const f of fail) console.log('   ! ' + f);
console.log(` ${Date.now() - t0} ms  ->  ${join(OUT, 'colormaps.bin')}`);
console.log('===============================================');
process.exit(fail.length ? 1 : 0);
