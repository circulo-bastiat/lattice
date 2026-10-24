#!/usr/bin/env node
// whiteflashcheck.mjs — #2679: CreeperEntityRenderer.method_23154's white flash overlay.
//   ER.creeperScale().white (odd tenth of the fuse -> clamp(f,.5,1) in 15ths) -> packModelVertex `ew`
//   (w1 bits 29-31) -> both shaders' white mix. Breaks its own data and prints "<n> breaks caught".
import { readFileSync } from 'node:fs';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const M = loadEngine({
  extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
          '07zb_creeper.js', '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js', '07w_passive.js', '07zzj_strider.js'],
  dom: false
});
const ER = M.EntityRender, Mesh = M.Mesher;
let bad = 0, caught = 0;
let n = 0;
const need = (c, m) => { n++; if (!c) { bad++; console.log('FAIL: ' + m); } };
const breaks = (c, m) => { if (c) caught++; else { bad++; console.log('NOT CAUGHT: ' + m); } };

const white = (f) => { M.Creeper = { swellFraction: () => f }; return ER.creeperScale({ type: 'creeper' }, 0).white; };
function run(white) {
  const out = [];
  out.push(['f=0.05 (even tenth) none', white(0.05) === 0]);
  out.push(['f=0.15 (odd, <.5) clamps to .5 -> 7/15', white(0.15) === 7 / 15]);
  out.push(['f=0.25 (even tenth) none', white(0.25) === 0]);
  out.push(['f=0.35 -> 7/15', white(0.35) === 7 / 15]);
  out.push(['f=0.75 (odd) -> 11/15', white(0.75) === 11 / 15]);
  out.push(['f=0.95 -> 14/15', white(0.95) === 14 / 15]);
  out.push(['f=0.85 (even tenth) none', white(0.85) === 0]);
  out.push(['f=0.65 (even tenth) none', white(0.65) === 0]);
  return out;
}
for (const [m, c] of run(white)) need(c, m);

const buf = new Uint32Array(8);
Mesh.packModelVertex(buf, 0, 0, 0, 0, 4650, 0, 0, 0, 3, 15, 15, 0, 0, 0, undefined, undefined, undefined, undefined, 6 / 7);
const u = Mesh.unpackModelVertex(buf[0], buf[1], buf[2], buf[3]);
need(u.tile === 4650 && Math.abs(u.white - 6 / 7) < 1e-9, 'pack round-trip keeps tile and white');
Mesh.packModelVertex(buf, 0, 0, 0, 0, 777, 0, 0, 0, 3, 15, 15, 0, 0, 0);
need(Mesh.unpackModelVertex(buf[0], buf[1], buf[2], buf[3]).white === 0, 'no ew -> white 0');

const src = (f) => readFileSync(MCLITE_ROOT + 'src/' + f, 'utf8');
const gpu = src('11_gfx_webgpu.js'), gl = src('12_gfx_webgl2.js');
need(/o\.white = f32\(\(m\.y >> 29u\)/.test(gpu) && /mix\(t\.rgb, .*i\.white\)/.test(gpu), 'WGSL decodes and mixes white');
need(/vWhite = float\(\(aModel\.y >> 29u\)/.test(gl) && /mix\(t\.rgb, vec3\(1\.0, 1\.0, 1\.0\), vWhite\)/.test(gl), 'GLSL decodes and mixes white');

// breaks: a wrong quantiser, a wrong parity, a shader that drops the mix
const orig = ER.creeperScale;
breaks(run((f) => Math.round(white(f) * 15) / 15 + (white(f) ? 1 / 15 : 0)).some(([, c]) => !c), 'off-by-one weight');
breaks(run((f) => (Math.floor(f * 10) % 2 ? 0 : white(f))).some(([, c]) => !c), 'inverted parity');
breaks(!/mix\(t\.rgb, .*i\.white\)/.test(gpu.replace('i.white', '0.0')), 'WGSL without the white mix');
breaks(!/vWhite\)/.test(gl.replace('vWhite)', '0.0)')), 'GLSL without the white mix');
buf[1] = 0;
breaks(Mesh.unpackModelVertex(buf[0], buf[1], buf[2], buf[3]).white !== 6 / 7, 'zeroed w1 loses the weight');

console.log(bad ? bad + ' failed' : `whiteflashcheck: OK — ${n} assertions, ${caught} breaks caught`);
process.exit(bad ? 1 : 0);
