#!/usr/bin/env node
// shadowtilecheck.mjs — G18a-SD0 (#7065): misc/shadow.png is a packed mob tile (layer `shadow`) and the model
// shaders treat vertex alpha as OPACITY in the translucent pass. Anti-vacuity: a blanked tile / un-patched shader fails.
import fs from 'node:fs';
import { inflateRawSync } from 'node:zlib';
console.log('shadowtilecheck — G18a-SD0, shadow tile + translucent model opacity');
const geo = JSON.parse(fs.readFileSync('assets/mob-geometry.json', 'utf8'));
const meta = JSON.parse(fs.readFileSync('assets/mob-tiles.meta.json', 'utf8'));
const raw = inflateRawSync(fs.readFileSync('assets/mob-tiles.bin'));
const T = meta.tile;
function run(buf, glSrc, gpuSrc) {
  const bad = [];
  const sl = (geo.layers.shadow && geo.layers.shadow[0] && geo.layers.shadow[0][3] || [])[0];
  if (!sl) return ['no shadow slice'];
  const li = sl.tile - geo.tileBase;
  if (li < 0 || li >= meta.count) bad.push('tile index out of range');
  const px = (x, y) => buf[(li * T * T + y * T + x) * 4 + 3];
  if (!(px(8, 8) > 100)) bad.push('centre texel not opaque: ' + px(8, 8));
  if (!(px(0, 0) < px(8, 8))) bad.push('corner not fainter than centre');
  if (!/mode != 2 && t\.a < vCut/.test(glSrc) || !/t\.a \* vCut/.test(glSrc)) bad.push('GL shader lacks mode-2 opacity');
  if (!/mode != 2 && t\.a < i\.cut/.test(gpuSrc) || !/i\.cut > 0\.0/.test(gpuSrc)) bad.push('WebGPU shader lacks mode-2 opacity');
  return bad;
}
const gl = fs.readFileSync('src/12_gfx_webgl2.js', 'utf8'), gpu = fs.readFileSync('src/11_gfx_webgpu.js', 'utf8');
const good = run(raw, gl, gpu);
good.forEach((b) => console.log(' x ' + b));
let caught = 0;
if (run(Buffer.alloc(raw.length), gl, gpu).length) caught++;
if (run(raw, gl.replace('t.a * vCut', 't.a'), gpu).length) caught++;
if (run(raw, gl, gpu.replace('i.cut > 0.0', 'true')).length) caught++;
console.log(' ✓ ' + caught + ' breaks caught');
const n = 4 + caught;
console.log((good.length || caught < 3 ? 'FAIL' : 'PASS') + '  shadowtilecheck: ' + n + ' assertions, ' + good.length + ' failures, ' + caught + ' breaks caught');
process.exit(good.length || caught < 3 ? 1 : 0);
