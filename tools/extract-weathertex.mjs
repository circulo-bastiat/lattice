#!/usr/bin/env node
// extract-weathertex.mjs — G20 weather (D-655): the RAIN and SNOW sheets `WorldRenderer.renderWeather`
// binds (.decomp/net/minecraft/client/render/WorldRenderer.java:141-142, `textures/environment/
// rain.png` / `snow.png`). Both are read straight off the jar and verified 64x256 (the size
// renderWeather's own UV math assumes: u spans the whole width 0..1, v = y*0.25 + scroll, i.e. a
// 256-tall sheet is 64 blocks of fall before it repeats). Packed one after the other, rain first.
//
//   node tools/extract-weathertex.mjs   -> assets/weather-tex.bin, assets/weather-tex.meta.json
//
// Anti-vacuity: a texture name this jar cannot have must refuse, not silently pack.

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
const W = 64, H = 256;
const NAMES = ['rain', 'snow'];
const PNG = (n) => 'assets/minecraft/textures/environment/' + n + '.png';

let failures = 0;
const say = (s) => console.log(s);
const ok = (cond, msg) => { if (!cond) { failures++; say('   x ' + msg); } };
const jar = new Jar(JAR);

function readSheet(path) {
  if (!jar.names().includes(path)) throw new Error('extract-weathertex: texture not in this jar: ' + path);
  const img = decodePng(jar.read(path));
  if (!img || !img.data) throw new Error('extract-weathertex: ' + path + ' did not decode');
  return img;
}

{
  let threw = false;
  try { readSheet(PNG('this_png_does_not_exist')); }
  catch (err) { threw = /texture not in this jar/.test(err.message); }
  ok(threw, 'a missing texture path did not refuse extraction — the check is not looking');
}

const imgs = NAMES.map((n) => readSheet(PNG(n)));
imgs.forEach((img, i) => {
  ok(img.width === W && img.height === H, `${NAMES[i]}.png is ${img.width}x${img.height}, not ${W}x${H} — refusing to resample a surprise size`);
  let lit = 0; for (let k = 3; k < img.data.length; k += 4) if (img.data[k]) lit++;
  ok(lit > 0, `${NAMES[i]}.png has no visible texel — the sheet decoded blank`);
});
if (failures) { console.error(`\nextract-weathertex: ${failures} failures — nothing written`); process.exit(1); }

const body = Buffer.concat(imgs.map((i) => Buffer.from(i.data)));
const packed = deflateRawSync(body, { level: 9 });
if (Buffer.compare(inflateRawSync(packed), body) !== 0) { console.error('extract-weathertex: deflate round trip did not match'); process.exit(1); }
writeFileSync(join(OUT, 'weather-tex.bin'), packed);
writeFileSync(join(OUT, 'weather-tex.meta.json'), JSON.stringify({
  jar: JAR, width: W, height: H, layers: NAMES, rawBytes: body.length, packedBytes: packed.length,
}, null, 2));
say('');
say('================ extract-weathertex ================');
say(` sheets ............. ${NAMES.join(', ')} (${W}x${H} each)`);
say(` weather-tex.bin ..... ${(body.length / 1024).toFixed(2)} KB raw -> ${(packed.length / 1024).toFixed(2)} KB deflated`);
say('=====================================================');
