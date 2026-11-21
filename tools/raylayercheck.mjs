#!/usr/bin/env node
// tools/raylayercheck.mjs — #1851: the additive, untextured colour-ray layer (vanilla
// RenderLayer.getLightning: POSITION_COLOR, LIGHTNING_TRANSPARENCY = SRC_ALPHA, ONE) in both backends.
//
// No GPU here, so the picture is made in software: the ray triangle (white centre alpha a, magenta
// rim alpha 0) is rasterised over a KNOWN background using the blend factors each backend actually
// declares (GfxGL.RAY_BLEND, GfxGPU.RAY_BLEND — the same objects the draw calls read), and the pixels
// are compared with the closed-form additive result. An alpha blend or a ONE,ONE blend gives other
// pixels and fails. Then the check breaks its own blend and geometry to prove it can fail.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const FILES = ['00_ns.js', '01_util.js', '02_blocks.js', '03_section.js', '04_worldgen.js',
               '05_mesher.js', '06_atlas.js', '10_camera.js', '10_gfx.js', '11_gfx_webgpu.js', '12_gfx_webgl2.js'];
const text = Object.fromEntries(FILES.map(f => [f, readFileSync(join(SRC, f), 'utf8')]));
const MCL = new Function("'use strict';\n" + FILES.map(f => text[f]).join('\n') + '\nreturn MCL;\n')();

const BG = [0.2, 0.3, 0.4], A = 0.5, W = 64;
const tri = [[2, 2, 0], [60, 4, 0], [4, 60, 0]];   // x,y used as pixels

// factor(name, src rgba, dst rgba) -> scalar, for both the GL and the WebGPU spellings
const FACT = {
  SRC_ALPHA: s => s[3], ONE: () => 1, ONE_MINUS_SRC_ALPHA: s => 1 - s[3], ZERO: () => 0, SRC_COLOR: s => s,
  'src-alpha': s => s[3], 'one': () => 1, 'one-minus-src-alpha': s => 1 - s[3], 'zero': () => 0
};
const glBlend = b => ({ src: FACT[b.src], dst: FACT[b.dst] });
const gpuBlend = b => ({ src: FACT[b.color.srcFactor], dst: FACT[b.color.dstFactor] });

function render(verts, blend) {
  const fb = new Float32Array(W * W * 3);
  for (let i = 0; i < W * W; i++) fb.set(BG, i * 3);
  const P = i => [verts[i * 7], verts[i * 7 + 1]], C = i => verts.slice(i * 7 + 3, i * 7 + 7);
  const [a, b, c] = [P(0), P(1), P(2)];
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const px = x + 0.5, py = y + 0.5;
    const w1 = ((px - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (py - a[1])) / area;
    const w2 = ((b[0] - a[0]) * (py - a[1]) - (px - a[0]) * (b[1] - a[1])) / area;
    const w0 = 1 - w1 - w2;
    if (w0 < 0 || w1 < 0 || w2 < 0) continue;
    const s = [0, 0, 0, 0];
    for (let k = 0; k < 4; k++) s[k] = w0 * C(0)[k] + w1 * C(1)[k] + w2 * C(2)[k];
    const f = blend.src(s), g = blend.dst(s);
    for (let k = 0; k < 3; k++) fb[(y * W + x) * 3 + k] = Math.min(1, s[k] * f + fb[(y * W + x) * 3 + k] * g);
  }
  return fb;
}

function run(opt) {
  const errs = [];
  const need = (c, what) => { if (!c) errs.push(what); };
  const G = MCL.Gfx;
  const verts = new Float32Array(21);
  G.pushRayTri(verts, 0, tri[0], tri[1], tri[2], opt.alpha ?? A);
  if (opt.geom) opt.geom(verts);
  // geometry: white centre alpha a, magenta rim alpha 0
  need(G.RAY_FLOATS === 7, 'seven floats per vertex');
  need([...verts.slice(3, 7)].join() === [1, 1, 1, A].join(), 'centre vertex is white with alpha a');
  for (const v of [1, 2]) need([...verts.slice(v * 7 + 3, v * 7 + 7)].join() === '1,0,1,0', 'rim vertex ' + v + ' is magenta alpha 0');
  const blends = { webgl2: glBlend(opt.gl || MCL.GfxGL.RAY_BLEND), webgpu: gpuBlend(opt.gpu || MCL.GfxGPU.RAY_BLEND) };
  for (const [name, bl] of Object.entries(blends)) {
    const fb = render(verts, bl);
    const at = (x, y) => [...fb.slice((y * W + x) * 3, (y * W + x) * 3 + 3)];
    // a pixel next to the centre vertex: src ~ (white, a) -> bg + a*white
    const near = at(3, 3);
    for (let k = 0; k < 3; k++) need(Math.abs(near[k] - Math.min(1, BG[k] + A * 0.97 * 1.0 * 0.97)) < 0.06, name + ': near the centre the result is bg + a*white (additive), got ' + near.map(v => v.toFixed(3)));
    // a pixel in the middle of the triangle: closed form with barycentrics 1/3 each
    const x = 22, y = 22, px = x + .5, py = y + .5;
    const [a, b, c] = tri, area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    const w1 = ((px - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (py - a[1])) / area;
    const w2 = ((b[0] - a[0]) * (py - a[1]) - (px - a[0]) * (b[1] - a[1])) / area, w0 = 1 - w1 - w2;
    const sa = w0 * A, srgb = [w0 + w1 + w2, w0, w0 + w1 + w2];
    const exp = srgb.map((v, k) => Math.min(1, BG[k] + v * sa));
    const got = at(x, y);
    for (let k = 0; k < 3; k++) need(Math.abs(got[k] - exp[k]) < 1e-4, name + ': mid-triangle pixel is dst + src.rgb*src.a (' + exp.map(v => v.toFixed(3)) + '), got ' + got.map(v => v.toFixed(3)));
    // the rim fades to nothing: a pixel right on the rim vertex's corner is the background
    const rim = at(59, 5);
    for (let k = 0; k < 3; k++) need(Math.abs(rim[k] - BG[k]) < 0.06, name + ': at the rim vertex the background shows (alpha 0), got ' + rim.map(v => v.toFixed(3)));
    // outside the triangle untouched
    need(at(62, 62).every((v, k) => v === Math.fround(BG[k])), name + ': outside the triangle untouched');
  }
  // the draw calls read the declared blend, test depth without writing it, and use no texture
  need(/gl\[L\.RAY_BLEND\.src\], gl\[L\.RAY_BLEND\.dst\]/.test(text['12_gfx_webgl2.js']), 'GL draw reads L.RAY_BLEND');
  need(/L\.drawColourRays[\s\S]*?gl\.depthMask\(false\)/.test(text['12_gfx_webgl2.js']), 'GL ray draw writes no depth');
  need(/blend: P\.RAY_BLEND/.test(text['11_gfx_webgpu.js']) && /label: 'colour-ray'/.test(text['11_gfx_webgpu.js']), 'WebGPU ray pipeline uses P.RAY_BLEND');
  need(/depthWriteEnabled: false, depthCompare: 'less-equal' \},\s*label: 'colour-ray'/.test(text['11_gfx_webgpu.js']), 'WebGPU ray pipeline writes no depth');
  return errs;
}

let bad = 0;
const base = run({});
if (base.length) { console.error('FAIL raylayercheck:\n  ' + base.join('\n  ')); bad++; }
else console.log('ok    additive blend over known background, both backends (' + 'GL ' + JSON.stringify(MCL.GfxGL.RAY_BLEND) + ')');

const breaks = {
  'GL alpha blend (SRC_ALPHA, ONE_MINUS_SRC_ALPHA)': { gl: { src: 'SRC_ALPHA', dst: 'ONE_MINUS_SRC_ALPHA' } },
  'GL ONE, ONE (alpha ignored)': { gl: { src: 'ONE', dst: 'ONE' } },
  'WebGPU alpha blend': { gpu: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' } } },
  'WebGPU ONE, ONE (alpha ignored)': { gpu: { color: { srcFactor: 'one', dstFactor: 'one' } } },
  'rim alpha not 0': { geom: v => { v[13] = 1; } },
  'centre not white': { geom: v => { v[4] = 0; } },
  'centre alpha wrong': { alpha: 0.9 }
};
let caught = 0;
for (const [name, o] of Object.entries(breaks)) {
  const e = run(o);
  if (e.length) { caught++; console.log('   ✓ anti-vacuity: caught ' + name); } else { console.error('FAIL break not caught: ' + name); bad++; }
}
console.log(caught + ' breaks caught');
console.log((1 + caught) + ' checks passed, ' + bad + ' failures');
process.exit(bad ? 1 : 0);
