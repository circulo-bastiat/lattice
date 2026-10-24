#!/usr/bin/env node
// lightmapdrawcheck.mjs — #9237: static half (default). Live picture proof: node tools/lightmapdrawcheck.mjs --browser (tools/lightmapdrawlive.mjs). Static proof that Settings.gamma reaches both
// renderers' light paths (frame state -> uniform -> shader expr); each requirement is mutated and must fail.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const R = (f) => readFileSync(fileURLToPath(new URL('../src/' + f, import.meta.url)), 'utf8');
const src = { gfx: R('10_gfx.js'), gpu: R('11_gfx_webgpu.js'), gl: R('12_gfx_webgl2.js') };
const reqs = [
  ['frame state carries Settings.gamma', (s) => /fs\.gamma\s*=\s*NS\.Settings/.test(s.gfx)],
  ['gamma expr helper exists', (s) => /G\.gammaLightExpr\s*=/.test(s.gfx)],
  ['WebGL2 uploads gamma in uParams.w', (s) => /uniform4f\(locs\.uParams[^;]*s\.gamma/.test(s.gl)],
  ['WebGL2 shader applies gamma expr', (s) => /lightv = ' \+ Gx\.gammaLightExpr\('lightv', 'uParams\.w'/.test(s.gl)],
  ['WebGPU uploads gamma in params.w', (s) => /f\[27\]\s*=\s*state\.gamma/.test(s.gpu)],
  ['WebGPU shader applies gamma expr', (s) => /gammaLightExpr\('lightv', 'uFrame\.params\.w'/.test(s.gpu) && /fsh \* aosh \* lightg/.test(s.gpu)],
];
let breaks = 0; const fails = [];
for (const [name, t] of reqs) {
  if (!t(src)) fails.push(name);
  const blank = { gfx: '', gpu: '', gl: '' };
  if (t(blank)) fails.push('anti-vacuity: passes on empty source — ' + name); else breaks++;
  const cut = {}; for (const k in src) cut[k] = src[k].replace(/gamma/g, 'gamm_');
  if (t(cut)) fails.push('anti-vacuity: survives gamma removal — ' + name); else breaks++;
}
for (const f of fails) console.log('FAIL  ' + f);
console.log(' lightmapdrawcheck: ' + fails.length + ' failed, ' + breaks + ' breaks caught');
process.exit(fails.length ? 1 : 0);
