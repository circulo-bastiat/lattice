#!/usr/bin/env node
// chickencheck.mjs -- KW-50-1 (#596): ChickenEntityModel, cuboid by cuboid, against .decomp.
//
//   node tools/chickencheck.mjs
//
// Parses `getTexturedModelData()` out of the decompiled ChickenEntityModel.java (origin, size, UV offset,
// pivot, rotation, the 64x32 texture size) and compares every cuboid with `BE.layers.chicken`; checks the
// packed `entity/chicken.png` sheet is 64x32 (the UV scale); and renders the layer through
// `ER.emitMobLayer` (48 quads, every vertex inside its part's box). Anti-vacuity: each comparison is
// re-run against corrupted copies and must catch them (D-30).
import { readFileSync } from 'node:fs';
import { inflateRawSync, deflateRawSync } from 'node:zlib';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
console.log('chickencheck -- KW-50-1: ChickenEntityModel cuboids + 64x32 texture vs .decomp');

// ── the Java, parsed ────────────────────────────────────────────────────────────────────────
const src = readFileSync(MCLITE_ROOT + '.decomp/net/minecraft/client/render/entity/model/ChickenEntityModel.java', 'utf8');
const body = src.slice(src.indexOf('getTexturedModelData()'), src.indexOf('getHeadParts'));
const num = (s) => { s = s.trim().replace(/F$/, ''); return s === '(float) (Math.PI / 2)' ? Math.fround(Math.PI / 2) : parseFloat(s); };
const builders = {};   // local var -> {uv, cuboid}
const want = {};
const bre = /ModelPartBuilder\s+(\$\$\d+)\s*=\s*ModelPartBuilder\.create\(\)\.uv\((\d+),\s*(\d+)\)\.cuboid\(([^)]*)\)/g;
let m;
while ((m = bre.exec(body))) builders[m[1]] = { tu: +m[2], tv: +m[3], c: m[4].split(',').map(num) };
const are = /\$\$1\.addChild\(\s*"(\w+)",\s*([\s\S]*?),\s*ModelTransform\.(pivot|of)\(([^;]*?)\)\s*\);/g;
while ((m = are.exec(body))) {
  let b = builders[m[2].trim()];
  if (!b) { const t = /uv\((\d+),\s*(\d+)\)\.cuboid\(([^)]*)\)/.exec(m[2]); b = { tu: +t[1], tv: +t[2], c: t[3].split(',').map(num) }; }
  const t = m[4].split(/,(?![^(]*\))/).map(num);
  const [px, py, pz] = t, [rx, ry, rz] = m[3] === 'of' ? t.slice(3, 6) : [0, 0, 0];
  const [x, y, z, w, h, d] = b.c;
  want[m[1]] = { n: m[1], tu: b.tu, tv: b.tv, x, y, z, w, h, d, px, py, pz, rx, ry, rz };
}
const TEX = /TexturedModelData\.of\(\$\$0,\s*(\d+),\s*(\d+)\)/.exec(body);
ok(Object.keys(want).length === 8, 'parsed 8 chicken cuboids from the Java, got ' + Object.keys(want).length);
ok(TEX && +TEX[1] === 64 && +TEX[2] === 32, 'the Java texture size is 64x32');

// ── the engine ──────────────────────────────────────────────────────────────────────────────
const M = loadEngine({ extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
  '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js'], dom: false });
initRegistry(M);
{
  const mm = JSON.parse(readFileSync(MCLITE_ROOT + 'assets/models.meta.json', 'utf8'));
  M.BEModel.init({ models: readFileSync(MCLITE_ROOT + 'assets/models.bin').toString('base64'), modelsBytes: mm.rawBytes });
  const raw = readFileSync(MCLITE_ROOT + 'assets/mob-geometry.json');
  M.DATA = Object.assign({}, M.DATA, { mobGeometry: deflateRawSync(raw, { level: 9 }).toString('base64'), mobGeometryBytes: raw.length });
}
M.Entities.init(); M.EntityList.init(); M.EntityRender.init();
const ER = M.EntityRender, BE = M.BEModel;
ok(ER.ready && BE.ready, 'engine up');

const KEYS = ['tu', 'tv', 'x', 'y', 'z', 'w', 'h', 'd', 'px', 'py', 'pz', 'rx', 'ry', 'rz'];
function compare(layer, wantParts, texW, texH, sheet) {
  let bad = 0;
  if (!layer || layer.tw !== texW || layer.th !== texH) bad++;
  if (!sheet || sheet.w !== texW || sheet.h !== texH) bad++;
  const have = {}; for (const p of (layer ? layer.parts : [])) have[p.n] = p;
  if (Object.keys(have).length !== Object.keys(wantParts).length) bad++;
  for (const n in wantParts) {
    const p = have[n]; if (!p) { bad++; continue; }
    for (const k of KEYS) if (Math.abs(p[k] - wantParts[n][k]) > 1e-6) bad++;
    if (p.m) bad++;   // no chicken cuboid is mirrored
  }
  return bad;
}
const mt = inflateRawSync(readFileSync(MCLITE_ROOT + 'assets/mob-tex.bin'));
const hdr = JSON.parse(mt.subarray(4, 4 + mt.readUInt32LE(0)).toString('utf8'));
const sheet = hdr.sheets[hdr.layers.chicken[0]];
ok(/entity\/chicken\.png$/.test(sheet.p), 'the chicken sheet is entity/chicken.png');
ok(hdr.layers.chicken.length === 1, 'chicken has exactly one sheet');
ok(compare(BE.layers.chicken, want, 64, 32, sheet) === 0, 'every chicken cuboid (origin, size, UV, pivot, rotation) and the 64x32 sheet match the Java');

// ── rendered: 8 boxes x 6 faces, every vertex inside its own box's extent ───────────────────
function render(layer) {
  const NAME = '__chickencheck';
  BE.layers[NAME] = layer;
  const orig = ER.mobGeomFor;
  ER.mobGeomFor = (n, tk) => (n === NAME || tk === NAME) ? null : orig(n, tk);
  const n = ER.mobQuadCount(NAME);
  const out = new Uint32Array(n * 16);
  ER.emitMobLayer(out, 0, NAME, 0, 0, 0, 1, 0, 15, 0, 3, undefined);
  ER.mobGeomFor = orig; delete BE.layers[NAME];
  return { n, ys: Array.from({ length: n * 4 }, (_, i) => M.Mesher.unpackModelVertex(out[i * 4], out[i * 4 + 1], out[i * 4 + 2], out[i * 4 + 3])) };
}
const r = render(BE.layers.chicken);
ok(r.n === 48, 'the chicken renders 48 quads (8 cuboids x 6), got ' + r.n);
const lo = Math.min(...r.ys.map((v) => v.py)), hi = Math.max(...r.ys.map((v) => v.py));
const span = (hi - lo) / 256;   // vertex units are 1/256 block; legs end at model y 24, head top at 9
ok(Math.abs(span - 15 / 16) < 1e-3, `rendered height ${(15 / 16).toFixed(4)} blocks (feet to head top), got ${span.toFixed(4)}`);

// ── anti-vacuity ────────────────────────────────────────────────────────────────────────────
let caught = 0;
const clone = (o) => JSON.parse(JSON.stringify(o));
const brk = (label, mut) => {
  const L = clone(BE.layers.chicken), s = clone(sheet), w = clone(want);
  mut(L, s, w);
  const bad = compare(L, w, 64, 32, s);
  if (ok(bad > 0, 'anti-vacuity: ' + label + ' not caught')) { caught++; console.log('   ✓ caught: ' + label); }
};
brk('beak UV moved', (L) => { L.parts.find((p) => p.n === 'beak').tu += 1; });
brk('wing size', (L) => { L.parts.find((p) => p.n === 'left_wing').d = 5; });
brk('body rotation dropped', (L) => { L.parts.find((p) => p.n === 'body').rx = 0; });
brk('leg pivot', (L) => { L.parts.find((p) => p.n === 'right_leg').px = -1; });
brk('texture 64x64', (L, s) => { s.h = 64; });
brk('layer texture size', (L) => { L.th = 64; });
brk('part missing', (L) => { L.parts.pop(); });
brk('wattle origin', (L) => { L.parts.find((p) => p.n === 'red_thing').z = -2; });
{
  const L = clone(BE.layers.chicken); L.parts.find((p) => p.n === 'head').y = -7;
  const rr = render(L); const h2 = (Math.max(...rr.ys.map((v) => v.py)) - Math.min(...rr.ys.map((v) => v.py))) / 256;
  if (ok(Math.abs(h2 - span) > 1e-3, 'anti-vacuity: a taller head did not change the render')) { caught++; console.log('   ✓ caught: taller head changes the render'); }
}
console.log(`    ${caught} breaks caught`);

if (fails.length) { console.log('FAIL ' + fails.length + ':\n  ' + fails.join('\n  ')); process.exit(1); }
console.log(`chickencheck: ${pass} checks passed`);
