// #4694: the hand is a screen-space pass - depth cleared with writes ENABLED, on both backends.
// Static (source-order) check: gl.clear honours depthMask, so mask-true must precede the clear.
import fs from 'node:fs';
const gl = fs.readFileSync(new URL('../src/12_gfx_webgl2.js', import.meta.url), 'utf8');
const gpu = fs.readFileSync(new URL('../src/11_gfx_webgpu.js', import.meta.url), 'utf8');
const body = (s, a) => { const i = s.indexOf(a); return i < 0 ? '' : s.slice(i, i + 4500); };
const glOk = (s) => { const b = body(s, 'L.drawHand = function');
  const m = b.indexOf('gl.depthMask(true)'), c = b.indexOf('gl.clear(gl.DEPTH_BUFFER_BIT)');
  return m >= 0 && c > m && b.indexOf('gl.drawArrays') > c; };
const gpuOk = (s) => { const b = body(s, 'P.drawHand = function');
  return /depthLoadOp: 'clear'/.test(b) && /loadOp: 'load'/.test(b); };
let fails = 0, breaks = 0;
const t = (n, v) => { if (!v) { fails++; console.log('FAIL  ' + n); } };
t('webgl2 clears depth after enabling depth writes', glOk(gl));
t('webgpu hand pass clears depth, keeps colour', gpuOk(gpu));
// anti-vacuity: the broken orders must be rejected
const bad1 = gl.replace('gl.depthMask(true);\n    gl.disable(gl.SCISSOR_TEST);', 'gl.disable(gl.SCISSOR_TEST);');
if (!glOk(bad1)) { breaks++; console.log("✓ break caught: mask after clear"); } else t('break: mask after clear not caught', false);
const bad2 = gpu.replaceAll("depthLoadOp: 'clear'", "depthLoadOp: 'load'");
if (!gpuOk(bad2)) { breaks++; console.log("✓ break caught: webgpu load-depth"); } else t('break: webgpu load-depth not caught', false);
console.log(`handdepthcheck\n assertions passed .. ${4 - fails}\n failures ........... ${fails}`);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails ? 1 : 0);
