#!/usr/bin/env node
// tools/decalcheck.mjs -- #1850: the depth-EQUAL decal draw (vanilla DRAGON_DECAL) in both backends.
// A software depth buffer is driven by the depth state the REAL setPass('opaque'/'decal') code sets
// (WebGL2: the switch cases are lifted from src/12 and run against a recording gl; WebGPU: the
// modelDecal pipeline's depthStencil is lifted from src/11). A quad is "rendered" twice; the second
// pass must touch ONLY pixels the first wrote. Then each part is broken (LESS, LEQUAL, depth write on,
// missing case) and the check must go red: "<n> breaks caught".
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const gl2 = readFileSync(join(SRC, '12_gfx_webgl2.js'), 'utf8');
const gpu = readFileSync(join(SRC, '11_gfx_webgpu.js'), 'utf8');
let bad = 0, caught = 0;
const need = (c, w) => { if (!c) { bad++; console.error('FAIL  ' + w); } };

const GL = { LESS: 'less', LEQUAL: 'less-equal', EQUAL: 'equal', ALWAYS: 'always' };
function glState(src, pass) {
  const m = src.match(new RegExp("case '" + pass + "':[^\\n]*\\n([\\s\\S]*?)break;"));
  if (!m) return null;
  const st = { write: true, func: 'less' };   // GL defaults
  const gl = { ...GL, depthMask: v => { st.write = v; }, depthFunc: f => { st.func = f; },
    colorMask() {}, enable() {}, disable() {}, blendFunc() {}, SRC_ALPHA: 0, ONE_MINUS_SRC_ALPHA: 0, BLEND: 0, CULL_FACE: 0 };
  new Function('gl', 'useProgram', 'L', m[1])(gl, () => {}, {});
  return st;
}
function gpuState(src) {
  const m = src.match(/modelDecal:[\s\S]*?depthStencil: depth\((true|false), '([a-z-]+)'\)/);
  return m ? { write: m[1] === 'true', func: m[2] } : null;
}
const pass = (f, z, zi) => f === 'less' ? z < zi : f === 'less-equal' ? z <= zi : f === 'equal' ? z === zi : f === 'always';
// Render quad A (z=.5 on pixels 0..5) with `first`, then a quad B (same geometry + a wider footprint 0..9,
// as a decal of a mesh that overlaps nothing else) with `second`; return which pixels the second pass wrote.
function sim(first, second) {
  const depth = new Float32Array(10).fill(1), color = new Uint8Array(10);
  const draw = (st, lo, hi, c) => { for (let x = lo; x <= hi; x++) if (pass(st.func, 0.5, depth[x])) { color[x] = c; if (st.write) depth[x] = 0.5; } };
  draw(first, 0, 5, 1);
  draw(second, 0, 9, 2);
  return [...color];
}
function run(label, src2, srcG) {
  const opaque = glState(src2, 'opaque'), decalGL = glState(src2, 'decal'), decalGPU = gpuState(srcG);
  const errs = [];
  for (const [n, d] of [['webgl2', decalGL], ['webgpu', decalGPU]]) {
    if (!d) { errs.push(n + ': no decal state'); continue; }
    if (d.write) errs.push(n + ': decal writes depth');
    const px = sim(opaque, d);
    const want = [2, 2, 2, 2, 2, 2, 0, 0, 0, 0];
    if (px.join() !== want.join()) errs.push(n + ': second pass wrote ' + px.join(''));
  }
  if (decalGL && decalGPU && decalGL.func !== decalGPU.func) errs.push('backends disagree: ' + decalGL.func + ' vs ' + decalGPU.func);
  return errs;
}

const good = run('real', gl2, gpu);
need(good.length === 0, 'decal draw only touches pixels the first pass wrote, both backends: ' + good.join('; '));

const breaks = [
  ['webgl2 depthFunc LESS', gl2.replace('gl.depthFunc(gl.EQUAL)', 'gl.depthFunc(gl.LESS)'), gpu],
  ['webgl2 depthFunc LEQUAL', gl2.replace('gl.depthFunc(gl.EQUAL)', 'gl.depthFunc(gl.LEQUAL)'), gpu],
  ['webgl2 decal writes depth', gl2.replace(/(case 'decal':[^\n]*\n[^\n]*\n[^\n]*\n)(\s*gl\.depthMask\()false/, '$1$2true'), gpu],
  ['webgl2 decal case removed', gl2.replace("case 'decal':", "case 'decalX':"), gpu],
  ["webgpu 'less'", gl2, gpu.replace("depth(false, 'equal')", "depth(false, 'less')")],
  ["webgpu 'less-equal'", gl2, gpu.replace("depth(false, 'equal')", "depth(false, 'less-equal')")],
  ['webgpu depth write on', gl2, gpu.replace("depth(false, 'equal')", "depth(true, 'equal')")],
  ['webgpu pipeline removed', gl2, gpu.replace('modelDecal:', 'modelDecalX:')],
];
for (const [label, a, b] of breaks) {
  if (a === gl2 && b === gpu) { bad++; console.error('FAIL  break "' + label + '" changed nothing'); continue; }
  if (run(label, a, b).length) { caught++; console.log('  ✓ caught: ' + label); } else { bad++; console.error('FAIL  break NOT caught: ' + label); }
}
if (bad) { console.error('decalcheck: ' + bad + ' FAILED'); process.exit(1); }
console.log('decalcheck: ' + (2 + breaks.length) + ' assertions, 0 failures -- decal pass touches only first-pass pixels in both backends, ' + caught + ' breaks caught');
