#!/usr/bin/env node
// gen-panorama.mjs — #11265: emit src/15m_panorama.gen.js (gitignored; build.mjs runs this), the title screen's cube map.
//
//   node tools/gen-panorama.mjs [--equirect photo.png] [--size 256]
//
// Source order (first with a REAL face, i.e. wider than 1x1, wins):
//   1. jars/1.18.2/panorama/panorama_0..5.png (+ panorama_overlay.png)
//   2. assets/minecraft/textures/gui/title/background/panorama_N.png inside jars/1.18.2/1.18.2.jar
//   3. the custom set: tools/panorama-custom/panorama_0..5.png, else ONE equirectangular photo
//      tools/panorama-custom/equirect.png (or --equirect) converted to six faces here
//   4. nothing real -> PanoramaData.faces = null, source 'stub'; the screen keeps the stub fill and panoramacheck prints PANORAMA STUBBED.
// Faces are box-downscaled to --size (default 256: the picture is blurred 4x in vanilla anyway, and one html must stay small).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { decodePng, encodePng } from './png.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SIZE = Number(opt('--size', 256));
const OUT = join(ROOT, 'src', '15m_panorama.gen.js');

function toRgba(img) {   // png.mjs decodePng -> {width,height,rgba}
  return { w: img.width, h: img.height, d: img.data };
}
function dec(buf) { try { return toRgba(decodePng(buf)); } catch { return null; } }

function box(img, n) {   // box-filter resample to n x n
  const o = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const x0 = Math.floor(x * img.w / n), x1 = Math.max(x0 + 1, Math.floor((x + 1) * img.w / n));
    const y0 = Math.floor(y * img.h / n), y1 = Math.max(y0 + 1, Math.floor((y + 1) * img.h / n));
    let r = 0, g = 0, b = 0, a = 0, c = 0;
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const i = (yy * img.w + xx) * 4; r += img.d[i]; g += img.d[i + 1]; b += img.d[i + 2]; a += img.d[i + 3]; c++; }
    const j = (y * n + x) * 4; o[j] = r / c; o[j + 1] = g / c; o[j + 2] = b / c; o[j + 3] = a / c;
  }
  return { w: n, h: n, d: o };
}

// Face directions as CubeMapRenderer draws them (vertex order u=0..1 along first->last edge, v=0..1): face -> [origin, uAxis, vAxis]
// (x,y,z) of the texel (u,v), taken from the decomp quads; y is flipped by the renderer's 180deg X rotation, handled in the page.
export const FACE_QUADS = [
  [[-1, -1, 1], [2, 0, 0], [0, 2, 0]],
  [[1, -1, 1], [0, 0, -2], [0, 2, 0]],
  [[1, -1, -1], [-2, 0, 0], [0, 2, 0]],
  [[-1, -1, -1], [0, 0, 2], [0, 2, 0]],
  [[-1, -1, -1], [2, 0, 0], [0, 0, 2]],
  [[-1, 1, 1], [2, 0, 0], [0, 0, -2]],
];

function equirectFaces(img, n) {   // photo (lon 0..360 across, lat +90..-90 down) -> six faces, bilinear-free nearest of a box-averaged source
  const faces = [];
  for (let f = 0; f < 6; f++) {
    const [o, U, V] = FACE_QUADS[f], d = new Uint8Array(n * n * 4);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, v = (y + 0.5) / n;
      // the page's y is flipped (X rotated 180), so world-up = -quad y
      const X = o[0] + U[0] * u + V[0] * v, Y = -(o[1] + U[1] * u + V[1] * v), Z = o[2] + U[2] * u + V[2] * v;
      const lon = Math.atan2(X, Z), lat = Math.atan2(Y, Math.hypot(X, Z));
      const sx = Math.min(img.w - 1, Math.floor(((lon / (2 * Math.PI)) + 0.5) * img.w));
      const sy = Math.min(img.h - 1, Math.floor((0.5 - lat / Math.PI) * img.h));
      const i = (sy * img.w + sx) * 4, j = (y * n + x) * 4;
      d[j] = img.d[i]; d[j + 1] = img.d[i + 1]; d[j + 2] = img.d[i + 2]; d[j + 3] = 255;
    }
    faces.push({ w: n, h: n, d });
  }
  return faces;
}

function real(faces) { return faces.length === 6 && faces.every((f) => f && f.w > 1 && f.h > 1); }
function rd(p) { return existsSync(p) ? readFileSync(p) : null; }

let faces = null, overlay = null, source = 'stub';
const jarDir = join(ROOT, 'jars', '1.18.2'), custom = join(ROOT, 'tools', 'panorama-custom');
const tryDir = (dir, name) => {
  const f = [0, 1, 2, 3, 4, 5].map((i) => { const b = rd(join(dir, 'panorama_' + i + '.png')); return b && dec(b); });
  if (real(f)) { faces = f; source = name; const o = rd(join(dir, 'panorama_overlay.png')); overlay = o && dec(o); return true; }
  return false;
};
if (!tryDir(join(jarDir, 'panorama'), 'jars/1.18.2/panorama')) {
  const jar = join(jarDir, '1.18.2.jar');
  let f = null;
  if (existsSync(jar)) {
    try {
      const P = 'assets/minecraft/textures/gui/title/background/';
      f = [0, 1, 2, 3, 4, 5].map((i) => dec(execFileSync('unzip', ['-p', jar, P + 'panorama_' + i + '.png'], { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] })));
      if (real(f)) { faces = f; source = 'jar'; try { overlay = dec(execFileSync('unzip', ['-p', jar, P + 'panorama_overlay.png'], { stdio: ['ignore', 'pipe', 'ignore'] })); } catch { /* none */ } }
    } catch { /* unzip missing or entries absent */ }
  }
  if (!faces && !tryDir(custom, 'custom faces')) {
    const eq = opt('--equirect', null) || join(custom, 'equirect.png');
    const b = rd(eq), img = b && dec(b);
    if (img && img.w > 1) { faces = equirectFaces(img, Math.min(SIZE, 512)); source = 'custom equirect'; }
  }
}
const url = (im) => 'data:image/png;base64,' + encodePng(im.w, im.h, im.d, { level: 9, palette: false }).toString('base64');
let body;
if (faces) {
  const small = faces.map((f) => (f.w > SIZE ? box(f, SIZE) : f));
  const ov = overlay && overlay.w > 1 && overlay.d.some((v, i) => i % 4 === 3 && v > 0) ? url(box(overlay, Math.min(overlay.w, 64))) : null;
  body = JSON.stringify({ source, faces: small.map(url), overlay: ov });
} else body = JSON.stringify({ source: 'stub', faces: null, overlay: null });
writeFileSync(OUT, '// GENERATED by tools/gen-panorama.mjs (#11265) - not kept in git.\nMCL.PanoramaData = ' + body + ';\n');
console.log('gen-panorama: source=' + source + ' (' + (body.length / 1024 | 0) + ' KB)');
