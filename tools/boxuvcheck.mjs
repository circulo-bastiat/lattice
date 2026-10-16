#!/usr/bin/env node
// boxuvcheck — D-773 cloud unit (beautiful-allen-7isws6): every mob/block-entity box face samples its texture corner
// by corner exactly the way vanilla's `ModelPart.Cuboid` does (.decomp lines 195-219 + `Quad`'s remap, 256-259).
//
// Found by tender-carson-7zokog: `BE.faceRects` gave the box's MAX-y face vanilla's `(u+d, v)` rect and MIN-y
// face `(u+d+w, v)` — swapped — so every living mob (model flipped: min-y = world top) wore its underside patch
// on top. Reading the Cuboid corner by corner showed two more: +Y's v ran toward +z (vanilla: -z), and a
// `mirror` box's u ran the un-mirrored way on every face (vanilla swaps x0/x1 first). And a >16-texel face's
// atlas slices were placed as if every face's texture ran toward +axis.
//
// This check drives REAL boxes through `ER.emitMobLayer` (the join a mob is drawn through), reads every
// emitted vertex back, recovers its model-space position, and compares its sheet uv with an independent port
// of vanilla's Cuboid (bilinear across the face, so it holds for sliced faces too). The old `mobboxcheck` §UV
// compared corners as a SET, which is blind to a flipped face — that is how the swap survived.
//
// Anti-vacuity (D-30): three breaks, each restoring one of the old behaviours inside the engine, must each be
// caught: the ±Y rect swap, the +Y v run, and the +axis-only slice placement (via a mirrored box).

import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
console.log('boxuvcheck — D-773: box face uv vs vanilla ModelPart.Cuboid, corner by corner, through ER.emitMobLayer');

const M = loadEngine({
  extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
          '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js'],
  dom: false
});
initRegistry(M);
{
  const mm = JSON.parse(readFileSync(MCLITE_ROOT + 'assets/models.meta.json', 'utf8'));
  M.BEModel.init({ models: readFileSync(MCLITE_ROOT + 'assets/models.bin').toString('base64'), modelsBytes: mm.rawBytes });
}
{
  const raw = readFileSync(MCLITE_ROOT + 'assets/mob-geometry.json');   // mobboxcheck's own loading
  M.DATA = Object.assign({}, M.DATA, { mobGeometry: deflateRawSync(raw, { level: 9 }).toString('base64'), mobGeometryBytes: raw.length });
}
M.Entities.init(); M.EntityList.init(); M.EntityRender.init();
const ER = M.EntityRender, BE = M.BEModel, MS = M.Mesher;
ok(ER.ready && BE.ready, 'engine up');

// ── vanilla, ported independently off ModelPart.Cuboid (unit box corners; returns uv at a point) ─────────────
// sides: [physicalFace, vertices, u1, v1, u2, v2]; Quad remap: v[0]=(u2,v1) v[1]=(u1,v1) v[2]=(u1,v2) v[3]=(u2,v2)
function vanillaFaces(p) {
  const U = p.tu, V = p.tv, w = p.w, h = p.h, d = p.d;
  let x0 = 0, x1 = 1; if (p.m) { const t = x0; x0 = x1; x1 = t; }
  const vt = { 18: [x0, 0, 0], 19: [x1, 0, 0], 20: [x1, 1, 0], 21: [x0, 1, 0],
               22: [x0, 0, 1], 23: [x1, 0, 1], 24: [x1, 1, 1], 25: [x0, 1, 1] };
  const a = U, b = U + d, c = U + d + w, e = U + d + w + w, g = U + d + w + d, k = U + d + w + d + w;
  const q = V, r = V + d, s = V + d + h;
  const sides = [[[23, 19, 20, 24], c, r, g, s], [[18, 22, 25, 21], a, r, b, s], [[23, 22, 18, 19], b, q, c, r],
                 [[20, 21, 25, 24], c, r, e, q], [[19, 18, 21, 20], b, r, c, s], [[22, 23, 24, 25], g, r, k, s]];
  const out = {};
  for (const [vs, u1, v1, u2, v2] of sides) {
    const uv = [[u2, v1], [u1, v1], [u1, v2], [u2, v2]];
    const P = vs.map((i) => vt[i]);
    let key = null;
    for (let ax = 0; ax < 3; ax++) if (P.every((t) => t[ax] === P[0][ax])) key = ax + ':' + P[0][ax];
    out[key] = P.map((pt, i) => ({ pt, uv: uv[i] }));
  }
  return out;
}
// bilinear uv at unit-box point `t` on face `key`, from its 4 corners (they form an axis-aligned rectangle)
function vanillaUvAt(faces, key, t) {
  const C = faces[key], ax = +key[0];
  const o = [0, 1, 2].filter((i) => i !== ax);
  let u = 0, v = 0;
  for (const { pt, uv } of C) {
    const wgt = o.reduce((acc, i) => acc * (pt[i] ? t[i] : 1 - t[i]), 1);
    u += wgt * uv[0]; v += wgt * uv[1];
  }
  return [u, v];
}

// ── drive one synthetic box through the real emitter ─────────────────────────────────────────────────────────
const NAME = '__boxuvcheck';
const origGeom = ER.mobGeomFor;
function runBox(p, slicesFor) {
  BE.layers[NAME] = { parts: [p] };
  ER.mobGeomFor = (n, tk) => (n === NAME || tk === NAME) ? (slicesFor ? [slicesFor] : null) : origGeom(n, tk);
  const n = ER.mobQuadCount(NAME);
  const out = new Uint32Array(n * 16);
  ER.emitMobLayer(out, 0, NAME, 0, 0, 0, 1, 0, 15, 0, 3, undefined);
  ER.mobGeomFor = origGeom;
  const verts = [];
  for (let i = 0; i < n * 4; i++) verts.push(MS.unpackModelVertex(out[i * 4], out[i * 4 + 1], out[i * 4 + 2], out[i * 4 + 3]));
  return { n, verts };
}
// compare every emitted vertex with vanilla; returns mismatch count
function compareBox(p, slicesFor, rects) {
  const { n, verts } = runBox(p, slicesFor);
  const faces = vanillaFaces(p);
  // world extremes per axis ↔ model min/max; x is flipped iff the (all-positive) box lands at negative world x
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const vt of verts) { const P = [vt.px, vt.py, vt.pz]; for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], P[a]); hi[a] = Math.max(hi[a], P[a]); } }
  const flipX = hi[0] <= 0, flipZ = hi[2] <= 0, flipY = flipX;   // base-pose flip is diag(-1,-1,1) (D-415)
  const flips = [flipX, flipY, flipZ];
  let bad = 0, checked = 0;
  for (let qd = 0; qd < n; qd++) {
    const Q = verts.slice(qd * 4, qd * 4 + 4);
    const T = Q.map((vt) => [vt.px, vt.py, vt.pz].map((val, a) => {
      const f = (val - lo[a]) / ((hi[a] - lo[a]) || 1);
      return flips[a] ? 1 - f : f;
    }));
    let key = null;
    for (let ax = 0; ax < 3; ax++) {
      if (T.every((t) => Math.abs(t[ax] - T[0][ax]) < 1e-6) && (T[0][ax] < 1e-6 || T[0][ax] > 1 - 1e-6)) key = ax + ':' + Math.round(T[0][ax]);
    }
    if (!key) { bad++; continue; }
    for (let c = 0; c < 4; c++) {
      let su = Q[c].u / 16, sv = Q[c].v / 16;
      if (slicesFor) {   // tile id → slice; sheet uv = face rect + slice offset + position within crop
        const hit = slicesFor.flatMap((sl, f) => sl.map((s) => ({ s, f }))).find((z) => z.s.tile === Q[c].tile);
        if (!hit) { bad++; continue; }
        const r = rects[hit.f];
        su = r[0] + hit.s.u0 + (su - hit.s.ox); sv = r[1] + hit.s.v0 + (sv - hit.s.oy);
      }
      const want = vanillaUvAt(faces, key, T[c]);
      checked++;
      if (Math.abs(want[0] - su) > 0.51 || Math.abs(want[1] - sv) > 0.51) bad++;
    }
  }
  return { bad, checked };
}
// slices for a box the way tools/pack-mobtex.mjs cuts them (≤16 texels, texture-space offsets), unique tiles
const ARCH_AXES = [['z', 'y'], ['z', 'y'], ['x', 'z'], ['x', 'z'], ['x', 'y'], ['x', 'y']];
const SK = { x: 'w', y: 'h', z: 'd' };
function slicesOf(p) {
  let tile = 100;
  return ARCH_AXES.map(([ua, va]) => {
    const us = p[SK[ua]], vs = p[SK[va]], out = [];
    for (let v0 = 0; v0 < vs; v0 += 16) for (let u0 = 0; u0 < us; u0 += 16) {
      out.push({ tile: tile++, u0, v0, w: Math.min(16, us - u0), h: Math.min(16, vs - v0), ox: 0, oy: 0 });
    }
    return out;
  });
}

const BOXES = [
  { n: 'b', tu: 3, tv: 5, x: 2, y: 3, z: 4, w: 3, h: 5, d: 7, px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, m: 0 },
  { n: 'b', tu: 3, tv: 5, x: 2, y: 3, z: 4, w: 3, h: 5, d: 7, px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, m: 1 },
];
const BIG = { n: 'b', tu: 0, tv: 0, x: 2, y: 3, z: 4, w: 20, h: 18, d: 22, px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, m: 0 };
function runAll() {
  let bad = 0, checked = 0;
  for (const p of BOXES) { const r = compareBox(p, null, null); bad += r.bad; checked += r.checked; }
  for (const m of [0, 1]) {
    const p = Object.assign({}, BIG, { m });
    const r = compareBox(p, slicesOf(p), BE.faceRects(p)); bad += r.bad; checked += r.checked;
  }
  return { bad, checked };
}

// §1 — the live engine matches vanilla on every corner, plain + mirrored, whole-face + sliced
const live = runAll();
ok(live.checked >= 4 * 6 * 2 + 4 * 30, `only ${live.checked} corners compared`);
ok(live.bad === 0, `${live.bad}/${live.checked} emitted box corners sample a different sheet texel than vanilla's ModelPart.Cuboid`);

// §1b — the real zombie, real baked slices: the head's WORLD-TOP quad samples vanilla's top-of-head patch
// (texOffs + (d, 0) = (8, 0) on zombie.png — the hair), not the chin at (16, 0)
function headTop() {
  const L = BE.layer('zombie'), G = ER.mobGeomFor('zombie');
  const k = L.parts.findIndex((q) => q.n === 'head');
  if (k < 0 || !G) return null;
  const n = ER.mobQuadCount('zombie'), out = new Uint32Array(n * 16);
  // WITH the zombie's real base pose (flip + lift, D-415) (ER.BASE_LIVING: this harness's Entities cannot answer isLiving, so basePoseFor would say BASE_NONE and stay in model space, y down)
  ER.emitMobLayer(out, 0, 'zombie', 0, 0, 0, 1, 0, 15, 0, 3, undefined, ER.BASE_LIVING);
  // quads come out part by part, face by face, one per slice (a face with no slices: one fallback quad)
  let qd = 0;
  for (let j = 0; j < k; j++) for (let f = 0; f < 6; f++) qd += (G[j] && G[j][f] && G[j][f].length) || 1;
  let bestF = -1, bestY = -1e9;
  for (let f = 0; f < 6; f++) {
    const V = [0, 1, 2, 3].map((c) => MS.unpackModelVertex(out[(qd * 4 + c) * 4], out[(qd * 4 + c) * 4 + 1], out[(qd * 4 + c) * 4 + 2], out[(qd * 4 + c) * 4 + 3]));
    if (V.every((x) => x.py === V[0].py) && V[0].py > bestY) { bestY = V[0].py; bestF = f; }
    qd += (G[k][f] && G[k][f].length) || 1;
  }
  if (bestF < 0) return null;
  const r = BE.faceRects(L.parts[k])[bestF];
  return [r[0], r[1]];
}
{
  const top = headTop();
  ok(top && top[0] === 8 && top[1] === 0, `the zombie head's world-top quad samples zombie.png at ${JSON.stringify(top)}, vanilla's top-of-head patch is [8,0]`);
}

// §2 — the three shipped tables agree with the engine's (the packers carry their own copies)
for (const f of ['tools/pack-mobtex.mjs', 'tools/pack-blockentity.mjs', 'tools/mobtexcheck.mjs', 'tools/villagerproftexcheck.mjs']) {
  const src = readFileSync(MCLITE_ROOT + f, 'utf8');
  ok(/return \[east, west, \[u \+ d \+ w, v, w, d\], \[u \+ d, v, w, d\]/.test(src), `${f}'s faceRects copy gives +Y (u+d+w, v) and -Y (u+d, v), as BE.faceRects does`);
}
ok(/VAN_V = \[1, 1, -1, -1, 1, 1\]/.test(readFileSync(MCLITE_ROOT + 'tools/pack-blockentity.mjs', 'utf8')),
   'pack-blockentity.mjs carries the same vanilla face-run table as BE.faceDir');

// §3 — anti-vacuity: each old behaviour, restored, is caught
const saveRects = BE.faceRects, saveUV = BE.faceUV, saveDir = BE.faceDir;
function brk(label, install) {
  install();
  let r;
  try { r = runAll(); } finally { BE.faceRects = saveRects; BE.faceUV = saveUV; BE.faceDir = saveDir; }
  ok(r.bad > 0, `anti-vacuity: ${label} — NOT caught`);
  if (r.bad > 0) console.log(`   ✓ break caught: ${label} (${r.bad} corners wrong)`);
}
brk('±Y rects swapped back (the tender-carson-7zokog bug)', () => {
  BE.faceRects = (p) => { const r = saveRects(p); return [r[0], r[1], r[3], r[2], r[4], r[5]]; };
});
{
  BE.faceRects = (p) => { const r = saveRects(p); return [r[0], r[1], r[3], r[2], r[4], r[5]]; };
  let t; try { t = headTop(); } finally { BE.faceRects = saveRects; }
  ok(!(t && t[0] === 8 && t[1] === 0), 'anti-vacuity: the old ±Y rects put the chin on the zombie\'s head top — NOT caught');
  if (!(t && t[0] === 8 && t[1] === 0)) console.log(`   ✓ break caught: old ±Y rects → zombie head top samples ${JSON.stringify(t)}`);
}
brk('+Y v run toward +z again', () => {
  BE.faceUV = (f, m, u0, v0, u1, v1, us, vs) => saveUV(f, m, u0, f === 2 ? v1 : v0, u1, f === 2 ? v0 : v1, us, vs);
});
brk('mirror ignored within a face', () => {
  BE.faceUV = (f, m, u0, v0, u1, v1, us, vs) => saveUV(f, 0, u0, v0, u1, v1, us, vs);
});
brk('slices placed toward +axis on every face', () => {
  BE.faceDir = () => [1, 1];
});
ok(BE.faceRects === saveRects && BE.faceUV === saveUV && BE.faceDir === saveDir, 'engine restored after the breaks');

console.log(`\n${pass} assertions, ${fails.length} failures`);
for (const f of fails) console.log('   ✗ ' + f);
process.exit(fails.length ? 1 : 0);
