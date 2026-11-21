#!/usr/bin/env node
// tools/dissolvecheck.mjs — #1849: the per-vertex alpha / dissolve cutoff (w3 bits 27-31).
// Packer round-trip, and both backends read it identically with vanilla's entityAlpha rule
// (discard where texel alpha < vertex alpha). Each assertion is re-run on broken data and must fail.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const FILES = ['00_ns.js', '01_util.js', '02_blocks.js', '03_section.js', '04_worldgen.js',
  '05_mesher.js', '06_atlas.js', '10_camera.js', '10_gfx.js', '11_gfx_webgpu.js', '12_gfx_webgl2.js'];
const load = (mut) => new Function("'use strict';\n" + FILES.map(f => { let t = readFileSync(join(SRC, f), 'utf8'); return mut ? mut(f, t) : t; }).join('\n') + '\nreturn MCL;\n')();

function run(M) {
  const errs = [];
  const need = (c, w) => { if (!c) errs.push(w); };
  const Me = M.Mesher, o = new Uint32Array(4);
  const rt = (ea) => { Me.packModelVertex(o, 0, 100, 200, -300, 5, 7, 9, 3, 2, 15, 9, 2, 1, 1, 3, 4, 5, ea); return Me.unpackModelVertex(o[0], o[1], o[2], o[3]); };
  need(rt().alpha === 0, 'default alpha is 0 (no discard)');
  need(rt(1).alpha === 1, 'alpha 1 round-trips');
  need(Math.abs(rt(0.5).alpha - 16 / 31) < 1e-9, 'alpha 0.5 quantises to 16/31');
  const v = rt(1);
  need(v.er === 3 && v.eg === 4 && v.eb === 5 && v.flag === 1 && v.face === 3 && v.px === 100 && v.pz === -300, 'alpha does not disturb other fields');
  const g = M.GfxGL.buildShaders(), w = M.GfxGPU.buildWGSL();
  const glVS = g.VS_MODEL || '', glFS = g.FS || '';
  need(/vCut\s*=\s*float\(\(d3 >> 27u\) & 31u\) \* /.test(glVS), 'GLSL vs_model decodes bits 27-31');
  need(/o\.cut\s*=\s*f32\(\(d3 >> 27u\) & 31u\) \* /.test(w), 'WGSL vs_model decodes bits 27-31');
  const lit = (s) => (s.match(/\(d3 >> 27u\) & 31u\) \* ([0-9.e+-]+)/) || [])[1];
  need(lit(glVS) && lit(glVS) === lit(w), 'both read the same scale constant');
  need(/if \(mode != 2 && t\.a < vCut\) discard;/.test(glFS), 'GLSL fragment discards where texel alpha < vertex alpha');
  need(/if \(mode != 2 && t\.a < i\.cut\) \{\s*discard;/.test(w), 'WGSL fragment discards where texel alpha < vertex alpha');
  return errs;
}
let bad = run(load());
if (bad.length) { for (const e of bad) console.error('FAIL  ' + e); process.exit(1); }
const breaks = [
  ['pack drops alpha', (f, t) => f === '05_mesher.js' ? t.replace('| (al << 27)', '') : t],
  ['GLSL reads bits 26', (f, t) => f === '10_gfx.js' ? t.replace("' >> 27'", "' >> 26'") : t],
  ['GLSL fragment lost discard', (f, t) => f === '12_gfx_webgl2.js' ? t.replace("if (mode != 2 && t.a < vCut) discard;", "") : t],
  ['WGSL discard inverted', (f, t) => f === '11_gfx_webgpu.js' ? t.replace("t.a < i.cut) {", "t.a > i.cut) {") : t],
  ['WGSL ignores cutoff', (f, t) => f === '11_gfx_webgpu.js' ? t.replace("o.cut = ' + Gx.entityAlphaExpr", "o.cut = 0.0 * ' + Gx.entityAlphaExpr") : t],
];
let caught = 0;
for (const [name, m] of breaks) {
  let e; try { e = run(load(m)); } catch (x) { e = ['threw']; }
  if (e.length) { caught++; console.log('  ✓ caught: ' + name); } else console.error('NOT CAUGHT: ' + name);
}
if (caught !== breaks.length) process.exit(1);
console.log('OK  9 checks passed, 0 failures; dissolve cutoff packed and read identically by both backends; ' + caught + ' breaks caught');
