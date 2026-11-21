#!/usr/bin/env node
// dimskycheck.mjs — #263 G27j. The per-dimension sky frame (DimensionEffects port): no sun/moon/stars/sunrise
// in the Nether or End, fog = biome fog (Nether) or x0.15 (End), thick fog Nether only, overworld unchanged.
// Expected values are the jar's constants (DimensionEffects.java), not read back from the table.
import { loadEngine } from './loadsrc.mjs';

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const near = (a, b) => Math.abs(a - b) < 1e-5;

const M = loadEngine({ extra: ['02f_tags.js', '09b_sky.js'], dom: false });
const Sky = M.Sky, Dim = M.Dim;
Sky.init();
const fogIn = [0.2, 0.03, 0.03];
const frameIn = (d, t) => { Dim.cur = d; Sky.dayTime = t; return Sky.frame([0.5, 0.6, 0.9], fogIn, 12, 0.3); };

function run(tag) {
  const nether = frameIn('the_nether', 12500);          // dusk: the overworld would draw a sunset fan
  ok(nether.celestial === false, tag + 'nether: no sun/moon');
  ok(nether.starBrightness === 0, tag + 'nether: no stars');
  ok(nether.sunrise === null, tag + 'nether: no sunrise fan');
  ok(nether.thickFog === true, tag + 'nether: thick fog');
  ok(fogIn.every((v, i) => near(nether.fog[i], v)), tag + 'nether: fog is the biome fog, unadjusted');
  const end = frameIn('the_end', 18000);
  ok(end.celestial === false && end.skyType === 'end', tag + 'end: skyType END, no sun/moon');
  ok(end.thickFog === false, tag + 'end: no thick fog');
  ok(fogIn.every((v, i) => near(end.fog[i], v * 0.15)), tag + 'end: fog x0.15');
  const ow = frameIn('overworld', 6000);
  ok(ow.celestial === true && ow.skyType === 'normal' && !ow.thickFog, tag + 'overworld: normal sky');
  ok(ow.skyDarken > 0.9, tag + 'overworld noon bright');
  const ow2 = frameIn('overworld', 18000);
  ok(ow2.fog[0] < 0.2 * 0.9 + 0.5 && ow2.starBrightness > 0, tag + 'overworld midnight has stars');
  ok(near(Sky.ambientFor(Sky.EFFECTS.the_nether, 0.06), 0.1), tag + 'nether: ambient_light 0.1');
  ok(near(Sky.ambientFor(Sky.EFFECTS.overworld, 0.06), 0.06) && near(Sky.ambientFor(Sky.EFFECTS.the_end, 0.06), 0.06), tag + 'overworld/end keep the engine floor');
  Dim.cur = 'overworld';
}
run('');
function box(tag) {
  const v = Sky.endSkyVertices();
  ok(v.length === 120, tag + 'box: 24 vertices');
  // each face is a plane at distance 100 along one axis; the six faces cover +-x, +-y, +-z once
  const seen = new Set();
  for (let f = 0; f < 6; f++) {
    const c = [0, 0, 0];
    for (let i = 0; i < 4; i++) for (let k = 0; k < 3; k++) c[k] += v[f * 20 + i * 5 + k] / 4;
    const k = c.findIndex(x => Math.abs(x) > 99.9);
    ok(k >= 0 && c.filter(x => Math.abs(x) < 1e-3).length === 2, tag + 'box: face ' + f + ' on an axis plane');
    seen.add(k + ':' + Math.sign(c[k]));
    ok(v[f * 20 + 3] === 0 && v[f * 20 + 4] === 0 && v[f * 20 + 13] === 16 && v[f * 20 + 14] === 16, tag + 'box: uv 0..16');
  }
  ok(seen.size === 6, tag + 'box: six distinct faces');
  ok(Sky.END_SKY_GREY === 40, tag + 'box: grey 40');
}
function tris(tag) {
  const t = Sky.endSkyTriangles(), q = Sky.endSkyVertices();
  ok(t.verts === 36 && t.pos.length === 108 && t.uv.length === 72, tag + 'tris: 36 vertices');
  let same = true;
  for (let f = 0; f < 6; f++) for (const [j, k] of [[0, 0], [1, 1], [2, 2], [3, 0], [4, 2], [5, 3]]) {
    const a = (f * 6 + j), b = (f * 4 + k) * 5;
    for (let c = 0; c < 3; c++) if (t.pos[a * 3 + c] !== q[b + c]) same = false;
    if (t.uv[a * 2] !== q[b + 3] || t.uv[a * 2 + 1] !== q[b + 4]) same = false;
  }
  ok(same, tag + 'tris: triangulate the quads 0,1,2 / 0,2,3');
  const x = Sky.endSkyTexture();
  ok(x.data.length === x.w * x.h * 4 && x.data.some(v => v !== x.data[0]), tag + 'tex: sized and not flat');
}
tris('');
box('');
// WebGL2 / WebGPU parity: both backends must draw the End box from the same Sky data and feed the same ambient floor
import { readFileSync } from 'node:fs';
const SRC = { webgl2: readFileSync(new URL('../src/12_gfx_webgl2.js', import.meta.url), 'utf8'), webgpu: readFileSync(new URL('../src/11_gfx_webgpu.js', import.meta.url), 'utf8') };
function parity(tag, src = SRC) {
  for (const [n, t] of Object.entries(src)) {
    ok(/Sky\.endSkyTriangles\(\)/.test(t) && /Sky\.endSkyTexture\(\)/.test(t), tag + n + ': draws the End sky box');
    ok(/\.ambient === undefined \? 0\.06 : (s|state)\.ambient/.test(t), tag + n + ': ambient floor from the frame state');
  }
}
parity('');

// anti-vacuity: break the data and require the check to notice
const keep = JSON.stringify(Sky.EFFECTS), origBox = Sky.endSkyVertices, origTri = Sky.endSkyTriangles;
const attempts = [
  ['nether draws a sky', () => { Sky.EFFECTS.the_nether.skyType = 'normal'; }],
  ['end fog not x0.15', () => { Sky.EFFECTS.the_end.fogMul = 1; }],
  ['nether fog thin', () => { Sky.EFFECTS.the_nether.thickFog = false; }],
  ['nether fog dimmed', () => { Sky.EFFECTS.the_nether.fogMul = 0.15; }],
  ['box face duplicated', () => { const o = Sky.endSkyVertices; Sky.endSkyVertices = () => { const v = o(); v.copyWithin(100, 0, 20); return v; }; }],
  ['triangles drop a face', () => { const o = Sky.endSkyTriangles; Sky.endSkyTriangles = () => { const t = o(); t.pos = t.pos.slice(0, 90); return t; }; }],
  ['nether ambient lost', () => { Sky.EFFECTS.the_nether.ambient = null; }],
  ['end draws a sky', () => { Sky.EFFECTS.the_end.skyType = 'normal'; }]
];
const parityBreaks = [
  ['webgl2 drops the End box', { ...SRC, webgl2: SRC.webgl2.replace(/Sky\.endSkyTriangles\(\)/g, 'null') }],
  ['webgpu ignores ambient', { ...SRC, webgpu: SRC.webgpu.replace(/state\.ambient/g, 'x') }]
];
for (const [name, src] of parityBreaks) {
  const before = fails.length;
  parity('[break] ', src);
  const caught = fails.length > before;
  fails.length = before;
  breaks++;
  if (caught) { pass++; console.log("   ✓ break caught: " + name); } else fails.push('anti-vacuity: not caught: ' + name);
}
for (const [name, brk] of attempts) {
  const before = fails.length;
  brk();
  try { run('[break] '); box('[break] '); tris('[break] '); } catch (e) { fails.push('throw'); }
  const caught = fails.length > before;
  fails.length = before;
  Object.assign(Sky.EFFECTS, JSON.parse(keep)); Sky.endSkyVertices = origBox; Sky.endSkyTriangles = origTri;
  breaks++;
  if (caught) { pass++; console.log("   ✓ break caught: " + name); } else fails.push('anti-vacuity: not caught: ' + name);
}
console.log('================ dimskycheck =================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails.slice(0, 20)) console.log('   ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
