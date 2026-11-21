#!/usr/bin/env node
// tools/swirlcheck.mjs — #2627: the additive scrolling-UV pass (vanilla RenderLayer.getEnergySwirl, wither armor).
// Pins: the scroll-offset golden (CFG.swirlOffset, EnergySwirlOverlayFeatureRenderer: x = cos(f*0.02)*3 % 1, y = f*0.01 % 1),
// the 4th model bucket surviving the mesh header round trip, the ONE,ONE blend + no-depth-write in BOTH backends, the shader
// scroll maths agreeing with the golden's formula in both shaders, and wither_armor being routed into LAYER_ADDITIVE.
// Then it breaks each of those and proves the check fails ("<n> breaks caught").
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const FILES = ['00_ns.js', '01_util.js', '02_blocks.js', '03_section.js', '04_worldgen.js', '05_mesher.js',
               '06_atlas.js', '07j_entityrender.js', '10_camera.js', '10_gfx.js', '11_gfx_webgpu.js', '12_gfx_webgl2.js'];
const base = Object.fromEntries(FILES.map(f => [f, readFileSync(join(SRC, f), 'utf8')]));

// golden: f -> [x, y]  (Java float remainder keeps the sign: cos*3 is negative half the time)
const GOLD = [[0, 0, 0], [10, Math.cos(0.2) * 3 % 1, 0.1], [50, Math.cos(1) * 3 % 1, 0.5], [100, Math.cos(2) * 3 % 1, 0],
              [157.5, Math.cos(3.15) * 3 % 1, 1.575 % 1]];

function run(text) {
  const errs = [], need = (c, w) => { if (!c) errs.push(w); };
  let MCL;
  try { MCL = new Function("'use strict';\n" + FILES.map(f => text[f]).join('\n') + '\nreturn MCL;\n')(); }
  catch (e) { return ['load: ' + e.message]; }
  const C = MCL.CFG;
  need(C.LAYER_ADDITIVE === 3 && C.LAYER_COUNT === 3, 'LAYER_ADDITIVE is the 4th model bucket, LAYER_COUNT stays 3');
  for (const [f, x, y] of GOLD) {
    const o = C.swirlOffset(f);
    need(Math.abs(o[0] - x) < 1e-9 && Math.abs(o[1] - y) < 1e-9, 'swirlOffset(' + f + ') = ' + o + ' want ' + [x, y]);
  }
  for (const f of [0, 10, 157.5, 250]) {
    const o = C.swirlOffset(f, true);   // #4402: charged creeper, x = f*0.01
    need(Math.abs(o[0] - f * 0.01 % 1) < 1e-9 && Math.abs(o[1] - f * 0.01 % 1) < 1e-9, 'creeper swirlOffset(' + f + ') = ' + o);
  }
  const M = MCL.Mesher, buf = M.allocBuffer(1, 2, 3, [4, 5, 6, 7]), h = M.readHeader(buf);
  need(h && h.modelQuads.join() === '4,5,6,7', 'header carries the 4th model bucket count');
  need(h && h.modelOff[3] + 7 * C.MODEL_QUAD_BYTES === buf.byteLength, '4th bucket ends exactly at the buffer end');
  need(h && h.modelOff[3] === h.modelOff[2] + 6 * C.MODEL_QUAD_BYTES, '4th bucket follows the 3rd');
  const gl = text['12_gfx_webgl2.js'], gpu = text['11_gfx_webgpu.js'], er = text['07j_entityrender.js'];
  need(/case 'additive':[^]*?gl\.depthMask\(false\);[^]*?gl\.blendFunc\(gl\.ONE, gl\.ONE\);[^]*?L\.layerMode = 3;/.test(gl), 'GL additive pass: ONE,ONE, no depth write, mode 3');
  need(/modelAdditive: [^]*?color: \{ srcFactor: 'one', dstFactor: 'one'[^]*?depth\(false,/.test(gpu), 'WebGPU modelAdditive: one,one, no depth write');
  need(/P\.layerMode = 3/.test(gpu) && /layer === 3 \? 'modelAdditive'/.test(gpu), 'WebGPU routes layer 3 to modelAdditive in mode 3');
  need(gl.includes('cos(sf * 0.02) * 3.0, sf * 0.01') && gl.includes('uCamTime.w * 20.0'), 'GL vertex scroll = golden formula');
  need(gpu.includes('cos(sf * 0.02) * 3.0, sf * 0.01') && gpu.includes('uFrame.camTime.w * 20.0'), 'WebGPU vertex scroll = golden formula');
  need(gl.includes('mix(0.5, 1.0, vCut) * (1.0 - fg)') && gpu.includes('mix(0.5, 1.0, i.cut) * (1.0 - fg)'), 'both fragment shaders: colour 0.5, fog to black');
  need(/texKey: 'wither_armor'/.test(er) && /layer: ER\.mobBlendLayer\('wither_armor'\),[^]{0,200}texKey: 'wither_armor'/.test(er), 'wither_armor routed into LAYER_ADDITIVE');
  need(/layer: ER\.mobBlendLayer\('creeper_armor'\),[^]{0,200}texKey: 'creeper_armor'/.test(er), 'creeper_armor routed into LAYER_ADDITIVE (#4402)');
  need(/layer: ER\.mobBlendLayer\('spider_eyes'\)/.test(er) && /\/_eyes\$\/\.test\(texKey\) \? 1 : gl >= 0/.test(er), '#8082 eye layers routed additive with the static-UV alpha mark');
  need(gl.includes('!= 31u') && gpu.includes('!= 31u'), '#8082 both shaders: alpha field 31 = getEyes, static UV, colour 1.0 (ONE,ONE sums over the backdrop)');
  need(gl.includes('cr > 0.5 ? sf * 0.01 : cos(sf') && gpu.includes('sf * 0.01, cr > 0.5'), 'both shaders: bit 26 selects the creeper x = f*0.01');
  need(/texKey === 'creeper_armor' \? \(1 << 26\)/.test(er), 'creeper quads carry w3 bit 26');
  need(/setPass\('additive'\)/.test(text['10_gfx.js']), 'frontend draws the additive pass');
  return errs;
}

const errs = run(base);
for (const e of errs) console.log('FAIL ' + e);
const breaks = [
  ['00_ns.js', 'Math.cos(f * 0.02) * 3', 'Math.cos(f * 0.02) * 2'],
  ['00_ns.js', 'y = f * 0.01', 'y = f * 0.02'],
  ['05_mesher.js', 'h[15] = m3;', 'h[15] = 0;'],
  ['12_gfx_webgl2.js', 'gl.blendFunc(gl.ONE, gl.ONE);\n        gl.disable(gl.CULL_FACE);\n        L.layerMode = 3;', 'gl.blendFunc(gl.SRC_ALPHA, gl.ONE);\n        gl.disable(gl.CULL_FACE);\n        L.layerMode = 3;'],
  ['12_gfx_webgl2.js', 'cos(sf * 0.02) * 3.0, sf * 0.01', 'cos(sf * 0.02) * 3.0, sf * 0.02'],
  ['11_gfx_webgpu.js', "srcFactor: 'one', dstFactor: 'one', operation: 'add' },\n          alpha", "srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },\n          alpha"],
  ['11_gfx_webgpu.js', "layer === 3 ? 'modelAdditive'", "layer === 3 ? 'modelTranslucent'"],
  ['07j_entityrender.js', "layer: ER.mobBlendLayer('wither_armor'),", "layer: CFG.LAYER_CUTOUT,"],
  ['07j_entityrender.js', "texKey === 'creeper_armor' ? (1 << 26)", "texKey === 'creeper_armor' ? (1 << 25)"],
  ['00_ns.js', 'creeper ? f * 0.01', 'creeper ? f * 0.02'],
  ['12_gfx_webgl2.js', 'cr > 0.5 ? sf * 0.01 : cos(sf', 'cr > 0.5 ? sf * 0.02 : cos(sf'],
  ['12_gfx_webgl2.js', '((d3 >> 27u) & 31u) != 31u', '((d3 >> 27u) & 31u) != 30u'],
  ['11_gfx_webgpu.js', '((d3 >> 27u) & 31u) != 31u', '((d3 >> 27u) & 31u) != 30u'],
  ['07j_entityrender.js', "layer: ER.mobBlendLayer('spider_eyes')", 'layer: CFG.LAYER_CUTOUT'],
  ['07j_entityrender.js', '/_eyes$/.test(texKey) ? 1 : gl >= 0', '/_eyes$/.test(texKey) ? 0 : gl >= 0'],
  ['10_gfx.js', "setPass('additive')", "setPass('translucent')"],
];
let caught = 0;
for (const [f, a, b] of breaks) {
  if (!base[f].includes(a)) { console.log('FAIL break target missing in ' + f + ': ' + a.slice(0, 40)); errs.push('break'); continue; }
  const t = { ...base, [f]: base[f].replace(a, b) };
  if (run(t).length) { caught++; console.log('  ✓ break caught: ' + f + ' ' + a.slice(0, 30).replace(/\n/g, ' ')); } else console.log('FAIL break not caught: ' + f + ' ' + a.slice(0, 40));
}
const bad = errs.length || caught !== breaks.length;
console.log(caught + ' breaks caught');
console.log((bad ? 0 : GOLD.length + 12) + ' checks passed, ' + (bad ? 1 : 0) + ' failures');
process.exit(bad ? 1 : 0);
