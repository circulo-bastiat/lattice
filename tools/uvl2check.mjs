#!/usr/bin/env node
// uvl2check.mjs — GATE M, layer L2 (UV), #1505: every mob model part's six face UV rects, computed independently from
// the decompiled Java, against what the engine bakes and draws.
//
//   node tools/uvl2check.mjs [--print] [--layer <name>]
//
// The vanilla side is NOT the engine's table: `EntityModels.getModels()` (.decomp) is evaluated here — every
// `put(EntityModelLayers.X, …)` run through tools/vanillamodel.mjs's translated getTexturedModelData()s — so each
// layer has its own Part tree, every cuboid with its uv()/mirror/Dilation/texture scale and the TexturedModelData
// size. (The engine's models.bin comes from the BYTECODE, tools/extract-models.mjs: a different route.)
// Each engine layer (and every texture variant / overlay drawn on it: cat#3, zombie#b, fur#null, fox_sleep, …) is
// joined to its EntityModelLayer and every part to its vanilla cuboid, then four joins, every one on every face:
//   A. DATA     tu, tv, mirror, un-grown size, Dilation, texture size == the vanilla cuboid / TexturedModelData.
//   B. RECTS    BE.faceRects(part) == the rect ModelPart.Cuboid gives the SAME physical face (vertex based, so a
//               mirrored box's swapped sides are compared where they land, not by list position).
//   C. CORNERS  every vertex ER.emitMobLayer emits (all slices, all parts): its baked uv (tile-local -> face-local
//               via the slice) == vanilla's uv at that corner of the box (bilinear over Cuboid's quad). Babies: the
//               baby emission's (tile, u, v) stream == the adult's.
//   D. TEXELS   every texel of every emitted slice: the packed tile texel == the shipped sheet's texel under the
//               VANILLA rect (scaled by sheet size / (texture size x texture scale)). texl1check B uses the engine's own
//               rect (and owns sheet-vs-jar content, L1); this one cannot inherit a wrong rect.
// Layers that cannot be joined (no EntityModelLayer, part count off) are listed and RATCHETED (tools/uvl2-known.json):
// a new one fails, a fixed one must be removed. Breaks (D-30): each corrupts one input and must be caught.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { inflateRawSync, deflateRawSync, constants as ZLIB } from 'node:zlib';
import { join } from 'node:path';
import { skipCheck } from './paths.mjs';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';
import { vanillaEval, loadDecomp, Dilation } from './vanillamodel.mjs';

const ROOT = MCLITE_ROOT, A = join(ROOT, 'assets');
const PRINT = process.argv.includes('--print');
const ONLY = (() => { const i = process.argv.indexOf('--layer'); return i > 0 ? process.argv[i + 1] : null; })();
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 60) fails.push(m); return c; };
console.log('uvl2check — GATE M L2: every mob part face UV, .decomp ModelPart.Cuboid vs baked vertices vs texels');
if (!existsSync(join(A, 'mob-tex.bin')) || !existsSync(join(ROOT, '.decomp'))) { skipCheck('uvl2check', 'assets or .decomp missing'); }

// ── the vanilla side: EntityModels.getModels(), evaluated ────────────────────────────────────────────────────────
const MD = '.decomp/net/minecraft/client/render/entity/model/';
const layersSrc = readFileSync(join(ROOT, MD, 'EntityModelLayers.java'), 'utf8');
const FIELD = {};   // EntityModelLayers field -> "id" | "id/sub"
for (const m of layersSrc.matchAll(/EntityModelLayer (\w+) = (registerMain|register|createInnerArmor|createOuterArmor)\("(\w+)"(?:, "(\w+)")?\)/g))
  FIELD[m[1]] = m[2] === 'registerMain' ? m[3] : m[2] === 'register' ? `${m[3]}/${m[4]}` : `${m[3]}/${m[2] === 'createInnerArmor' ? 'inner_armor' : 'outer_armor'}`;
const modelsSrc = readFileSync(join(ROOT, MD, 'EntityModels.java'), 'utf8');
const CONST = {};
for (const m of modelsSrc.matchAll(/static final Dilation (\w+) = (new Dilation\([^;]*\));/g)) CONST[m[1]] = m[2];
const subst = (e) => e.replace(/\b[A-Z][A-Z_]+_DILATION\b/g, (k) => CONST[k] || k);
const index = new Map();   // class name -> path under .decomp
(function walk(d) { for (const f of readdirSync(join(ROOT, '.decomp', d))) { const p = d + '/' + f; if (statSync(join(ROOT, '.decomp', p)).isDirectory()) walk(p); else if (f.endsWith('.java')) index.set(f.slice(0, -5), p); } })('net/minecraft/client/render');
for (const m of modelsSrc.matchAll(/\b([A-Z]\w+)\.get\w+\(/g)) if (index.has(m[1]) && !/Model$/.test(m[1])) loadDecomp(index.get(m[1]));
const VAN = {}, vanErr = {}, env = {};
for (const line of modelsSrc.split('\n')) {
  let m = /^\s*TexturedModelData (\$\$\d+) = (.*);\s*$/.exec(line);
  if (m) { try { env[m[1]] = vanillaEval(subst(m[2]), env); } catch (e) { env[m[1]] = { error: e.message }; } continue; }
  m = /^\s*\$\$0\.put\(EntityModelLayers\.(\w+), (.*)\);\s*$/.exec(line);
  if (!m || !FIELD[m[1]]) continue;
  try { VAN[FIELD[m[1]]] = /^\$\$\d+$/.test(m[2]) ? env[m[2]] : vanillaEval(subst(m[2]), env); } catch (e) { vanErr[FIELD[m[1]]] = e.message; }
}
try { VAN.boat = vanillaEval('BoatEntityModel.getTexturedModelData()'); } catch (e) { vanErr.boat = e.message; }   // createBoat(type): one shared model
console.log(`vanilla: ${Object.keys(VAN).length} EntityModelLayers evaluated from .decomp EntityModels.getModels() (${Object.keys(vanErr).length} not translatable)`);
ok(Object.keys(VAN).length > 100, `only ${Object.keys(VAN).length} vanilla layers evaluated`);

/** a Part tree -> [{part, box}] in tree order, tex size from TexturedModelData.of */
function vanBoxes(root) {
  const out = [];
  (function walk(p, name) { for (const b of p.boxes) out.push({ part: name, ...b }); p.kids.forEach((k, i) => walk(k, p.names[i])); })(root, 'root');
  return out;
}
// ModelPart.Cuboid (.decomp ModelPart.java 157-217): corner uv per PHYSICAL face, key "axis:side" over the grown unit box
function vanFaces(b) {
  const U = b.tu, V = b.tv, w = b.w, h = b.h, d = b.d;   // texture layout uses the UN-grown size
  let x0 = 0, x1 = 1; if (b.m) { const t = x0; x0 = x1; x1 = t; }
  const vt = { 18: [x0, 0, 0], 19: [x1, 0, 0], 20: [x1, 1, 0], 21: [x0, 1, 0], 22: [x0, 0, 1], 23: [x1, 0, 1], 24: [x1, 1, 1], 25: [x0, 1, 1] };
  const a = U, bb = U + d, c = U + d + w, e = U + d + w + w, g = U + d + w + d, k = U + d + w + d + w, q = V, r = V + d, s = V + d + h;
  const sides = [[[23, 19, 20, 24], c, r, g, s], [[18, 22, 25, 21], a, r, bb, s], [[23, 22, 18, 19], bb, q, c, r],
                 [[20, 21, 25, 24], c, r, e, q], [[19, 18, 21, 20], bb, r, c, s], [[22, 23, 24, 25], g, r, k, s]];
  const out = {};
  for (const [vs, u1, v1, u2, v2] of sides) {
    const uv = [[u2, v1], [u1, v1], [u1, v2], [u2, v2]], P = vs.map((i) => vt[i]);
    let key = null;
    for (let ax = 0; ax < 3; ax++) if (P.every((t) => t[ax] === P[0][ax])) key = ax + ':' + P[0][ax];
    out[key] = P.map((pt, i) => ({ pt, uv: uv[i] }));
  }
  return out;
}
function vanUvAt(F, key, t) {
  const C = F[key], ax = +key[0], o = [0, 1, 2].filter((i) => i !== ax);
  let u = 0, v = 0;
  for (const { pt, uv } of C) { const wg = o.reduce((acc, i) => acc * (pt[i] ? t[i] : 1 - t[i]), 1); u += wg * uv[0]; v += wg * uv[1]; }
  return [u, v];
}
const FKEY = ['0:1', '0:0', '1:1', '1:0', '2:1', '2:0'];   // engine face order +X -X +Y -Y +Z -Z
const vanRect = (F, f) => { const C = F[FKEY[f]]; const us = C.map((c) => c.uv[0]), vs = C.map((c) => c.uv[1]); return [Math.min(...us), Math.min(...vs), Math.max(...us) - Math.min(...us), Math.max(...vs) - Math.min(...vs)]; };

// ── the engine ───────────────────────────────────────────────────────────────────────────────────────────────────
const M = loadEngine({ extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js'], dom: false });
initRegistry(M);
{
  const mm = JSON.parse(readFileSync(join(A, 'models.meta.json'), 'utf8'));
  M.BEModel.init({ models: readFileSync(join(A, 'models.bin')).toString('base64'), modelsBytes: mm.rawBytes });
}
const geomRaw = readFileSync(join(A, 'mob-geometry.json'));
M.DATA = Object.assign({}, M.DATA, { mobGeometry: deflateRawSync(geomRaw, { level: 9 }).toString('base64'), mobGeometryBytes: geomRaw.length,
  entities: JSON.parse(readFileSync(join(A, 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.EntityRender.init();
const ER = M.EntityRender, BE = M.BEModel, MS = M.Mesher, U = M.CFG.MODEL_UNITS_PER_BLOCK;
ok(ER.ready && BE.ready, 'engine up');
const SC = U / 16;   // model px -> packed position units
const geom = JSON.parse(geomRaw.toString('utf8'));
const whole = inflateRawSync(readFileSync(join(A, 'mob-tex.bin')));
const hl = whole.readUInt32LE(0), H = JSON.parse(whole.subarray(4, 4 + hl).toString('utf8')), body = whole.subarray(4 + hl);
const tm = JSON.parse(readFileSync(join(A, 'mob-tiles.meta.json'), 'utf8'));
const tilesReal = inflateRawSync(readFileSync(join(A, 'mob-tiles.bin')), { finishFlush: ZLIB.Z_SYNC_FLUSH });
const TILE = tm.tile;
const known = JSON.parse(readFileSync(join(ROOT, 'tools', 'uvl2-known.json'), 'utf8'));
function sheetIdxFor(name) {   // texl1check's join: layer (or layer#k variant) -> shipped sheet
  if (H.layers[name]) return H.layers[name][0];
  const m = /^(.*)#(\d+)$/.exec(name);
  if (m && H.layers[m[1]] && H.layers[m[1]][+m[2]] != null) return H.layers[m[1]][+m[2]];
  return null;
}

// engine layer -> vanilla EntityModelLayer key
const VAN_ALIAS = { dragon_head: 'dragon_skull' };   // engine layer name -> EntityModelLayers id (SkullBlockEntityRenderer uses field_27553 "dragon_skull")
function vanKeyFor(layer) {
  if (VAN_ALIAS[layer]) return [VAN_ALIAS[layer]];
  if (Object.values(FIELD).includes(layer) || layer === 'boat') return [layer];
  let m = /^(\w+)#([bc])$/.exec(layer);
  if (m) return [`${m[1]}/${m[2] === 'b' ? 'inner_armor' : 'outer_armor'}`];
  m = /^(\w+)_(outer|saddle|pattern|armor)$/.exec(layer); if (m) return [`${m[1]}/${m[2]}`];
  if (layer === 'drowned_outer#null') return ['drowned/outer'];   // #5855: its own key; plain outer#null is the other `outer` layers
  m = /^(\w+)#null$/.exec(layer); if (m) return Object.keys(VAN).filter((k) => k.endsWith('/' + m[1]) && k !== 'drowned/outer');
  return [];
}
// the base model layer a texture key draws on: itself, `name#k` -> name, else the model layer it extends (cat_collar -> cat)
const TEX_BASE = { dragon_eyes: 'ender_dragon', dragon_exploding: 'ender_dragon' };   // EnderDragonEntityRenderer's eyes layer re-draws the same model with dragon_eyes.png / dragon_exploding.png (#1589)
function baseOf(texKey) {
  if (TEX_BASE[texKey] && BE.layer(TEX_BASE[texKey])) return TEX_BASE[texKey];
  if (BE.layer(texKey) && BE.layer(texKey).parts) return texKey;
  const m = /^(.*)#\d+$/.exec(texKey); if (m && BE.layer(m[1])) return m[1];
  const n = (geom.layers[texKey] || []).length;
  const c = Object.keys(BE.layers).filter((b) => BE.layer(b) && BE.layer(b).parts && BE.layer(b).parts.length === n && !b.includes('#') && ('_' + texKey + '_').includes('_' + b + '_'));
  return c.sort((a, b) => b.length - a.length)[0] || null;
}

// join engine parts to vanilla cuboids (name + un-grown box; then box alone, for parts the bytecode named differently)
const near = (a, b) => Math.abs(a - b) < 1e-3;
function joinParts(L, boxes) {
  const used = new Set(), out = [];
  const key = (p, b) => { const g = p.g || 0, gy = g + (p.gy || 0); return near(p.x + g, b.x) && near(p.y + gy, b.y) && near(p.z + g, b.z) && near(p.w - 2 * g, b.w) && near(p.h - 2 * gy, b.h) && near(p.d - 2 * g, b.d); };
  for (const byName of [true, false]) {
    L.parts.forEach((p, k) => {
      if (out[k]) return;
      const i = boxes.findIndex((b, j) => !used.has(j) && (!byName || b.part === p.n) && key(p, b) && b.tu === p.tu && b.tv === p.tv);
      const i2 = i >= 0 ? i : boxes.findIndex((b, j) => !used.has(j) && (!byName || b.part === p.n) && key(p, b));
      if (i2 >= 0) { used.add(i2); out[k] = boxes[i2]; }
    });
  }
  // last: same name + same texture offset, the only one left — joined so its size difference is REPORTED (A), not hidden
  L.parts.forEach((p, k) => {
    if (out[k]) return;
    const c = boxes.map((b, j) => j).filter((j) => !used.has(j) && boxes[j].part === p.n && boxes[j].tu === p.tu && boxes[j].tv === p.tv);
    if (c.length === 1) { used.add(c[0]); out[k] = boxes[c[0]]; }
  });
  return out;
}
function resolve(layer) {
  const keys = vanKeyFor(layer).filter((k) => VAN[k] && !VAN[k].error);
  if (!keys.length) return { why: vanErr[vanKeyFor(layer)[0]] ? 'vanilla not translatable: ' + vanErr[vanKeyFor(layer)[0]] : 'no EntityModelLayer' };
  const L = BE.layer(layer);
  let best = null;
  // #5855: plain outer#null is two vanilla layers sharing one engine key (stray/outer's clothes + slime/outer's cube): join against both
  const cands = layer === 'outer#null' ? [keys.join('+')] : keys;
  for (const k of cands) {
    const root = VAN[k] || VAN[keys[0]], boxes = layer === 'outer#null' ? keys.flatMap((kk) => vanBoxes(VAN[kk])) : vanBoxes(root), J = joinParts(L, boxes), dh = ER.DEFAULT_HIDDEN[layer] || {};
    const n = L.parts.filter((p, i) => J[i] || dh[p.n]).length;   // a part the engine never draws need not join
    if (!best || n > best.n) best = { key: k, root, boxes, J, n };
  }
  if (best.n !== L.parts.length) return { why: `${L.parts.length - best.n}/${L.parts.length} parts have no vanilla cuboid in ${best.key} (${L.parts.filter((p, k) => !best.J[k] && !(ER.DEFAULT_HIDDEN[layer] || {})[p.n]).map((p) => p.n).join(',')})`, ...best };
  return best;
}

// ── emission with the box UN-posed: BE.poseBoxCorners is wrapped to write each sub-box's local corners and log it ─
const realCorners = BE.poseBoxCorners;
function emit(layer, texKey, anim) {
  const n = ER.mobQuadCount(layer, texKey); if (!n) return null;
  const out = new Uint32Array(n * 16), calls = [];
  BE.poseBoxCorners = (p, c8) => {
    calls.push({ n: p.n, x: p.x, y: p.y, z: p.z, w: p.w, h: p.h, d: p.d });
    for (let i = 0; i < 8; i++) { c8[i * 3] = (i & 1) ? p.x + p.w : p.x; c8[i * 3 + 1] = (i & 2) ? p.y + p.h : p.y; c8[i * 3 + 2] = (i & 4) ? p.z + p.d : p.z; }
    return c8;
  };
  try { ER.emitMobLayer(out, 0, layer, 0, 0, 0, 1, 0, 15, 0, 3, anim, ER.BASE_NONE, texKey); } finally { BE.poseBoxCorners = realCorners; }
  const per = ER.NO_CULL[layer.split("#")[0]] ? 2 : 1, quads = [];
  for (let c = 0; c < calls.length; c++) {
    const q = c * per, V = [];
    for (let i = 0; i < 4; i++) { const o = (q * 4 + i) * 4; V.push(MS.unpackModelVertex(out[o], out[o + 1], out[o + 2], out[o + 3])); }
    quads.push(V);
  }
  return { n, calls, quads, per };
}

// ── the audit ────────────────────────────────────────────────────────────────────────────────────────────────────
const TOL = 0.07;   // a baked uv is 1/16 texel fixed point
function audit(opt = {}) {
  const tiles = opt.tiles || tilesReal, sheetOf = opt.sheetOf || sheetIdxFor;
  const R = { layers: 0, keys: 0, parts: 0, rects: 0, corners: 0, texels: 0, babies: 0, bad: {}, unjoined: {}, unverif: 0, joined: [] };
  const bad = (layer, what) => { (R.bad[layer] = R.bad[layer] || {}); R.bad[layer][what] = (R.bad[layer][what] || 0) + 1; };
  const resolved = {};
  const texKeys = Object.keys(geom.layers).filter((t) => !opt.only || opt.only.includes(t));
  for (const t of texKeys) {
    const base = baseOf(t);
    if (!base) { R.unjoined[t] = 'no model layer'; continue; }
    if (!(base in resolved)) resolved[base] = (opt.resolve || resolve)(base);
    const V = resolved[base];
    if (V.why) { R.unjoined[t] = V.why; continue; }
    const L = BE.layer(base);
    R.keys++; R.joined.push(t);
    // A + B, once per model layer
    if (!V.done) {
      V.done = true; R.layers++;
      const tw = V.root.tw, th = V.root.th;
      L.parts.forEach((p, k) => {
        const b = V.J[k]; if (!b || (ER.DEFAULT_HIDDEN[base] || {})[p.n]) return;   // never drawn (DEFAULT_HIDDEN)
        R.parts++;
        const g = p.g || 0;
        const un = [p.w - 2 * g, p.h - 2 * (g + (p.gy || 0)), p.d - 2 * g].map((x) => Math.round(x * 1000) / 1000);
        if (!near(un[0], b.w) || !near(un[1], b.h) || !near(un[2], b.d)) bad(base, `un-grown size of ${p.n} (the uv layout's w,h,d): engine ${un} vanilla ${[b.w, b.h, b.d]}`);
        if (b.g && /^decor/.test(base) && (!near(g, b.g[0]) || !near(g + (p.gy || 0), b.g[1]) || !near(g, b.g[2]))) bad(base, `Dilation of ${p.n}: engine ${[g, g + (p.gy || 0), g]} vanilla ${b.g}`);   // #3928: the decor layer shipped ungrown (ponytail: decor only - axolotl/bee/elytra/fox/saddle#null also differ, see #3928 note)
        if (b.tu !== p.tu || b.tv !== p.tv) bad(base, `texture offset of ${p.n}: engine (${p.tu},${p.tv}) vanilla (${b.tu},${b.tv})`);
        if (!!b.m !== !!p.m) bad(base, `mirror of ${p.n}: engine ${!!p.m} vanilla ${b.m}`);
        if (L.tw !== tw * b.ts[0] || L.th !== th * b.ts[1]) bad(base, `texture size: engine ${L.tw}x${L.th} vanilla ${tw * b.ts[0]}x${th * b.ts[1]}`);
        const F = vanFaces(b), E = BE.faceRects(p);
        for (let f = 0; f < 6; f++) {
          const r = vanRect(F, f); R.rects++;
          if (E[f].some((x, i) => !near(x, r[i]))) bad(base, `face ${f} rect of ${p.n}: engine ${JSON.stringify(E[f])} vanilla ${JSON.stringify(r)}`);
        }
      });
    }
    // C: corners of every emitted quad (the base layer with this texture key)
    const em = emit(base, t === base ? undefined : t);
    if (!em) { bad(t, 'nothing emitted'); continue; }
    const G = ER.mobGeomFor(base, t === base ? undefined : t);
    const dh = Object.assign({}, ER.DEFAULT_HIDDEN[base], ER.ILLAGERS[base.split('#')[0]] ? { left_arm: 1, right_arm: 1 } : null);   // an illager with no anim rests CROSSED (illagerArmHide)
    const seq = [];
    L.parts.forEach((p, k) => { if (dh && dh[p.n]) return; if (p.n === 'egg_belly') return; for (let f = 0; f < 6; f++) { const sl = G && G[k] && G[k][f]; if (sl && sl.length) sl.forEach((s) => seq.push({ k, f, s })); else seq.push({ k, f, s: null }); } });
    if (seq.length !== em.calls.length || em.n < em.calls.length * em.per) { bad(t, `emission layout: ${em.calls.length} boxes posed for ${seq.length} expected slices, ${em.n} quads`); continue; }
    // D samples the SHIPPED sheet (what the packer cut tiles from): its content vs the jar is texl1check's L1 join
    const si = sheetOf(t); const S = si != null ? H.sheets[si] : null; const J = S ? { w: S.w, h: S.h, data: body.subarray(S.o, S.o + S.len) } : null;
    if (!J) R.unverif++;
    seq.forEach(({ k, f, s }, qi) => {
      const p = L.parts[k], b = V.J[k];
      if (!b) return;
      const F = vanFaces(b), vr = vanRect(F, f);
      if (em.calls[qi].n !== p.n) { bad(t, `quad ${qi} posed part ${em.calls[qi].n}, expected ${p.n}`); return; }
      if (vr[2] <= 0 || vr[3] <= 0) return;   // a zero-area face (a card's edge) samples nothing
      const ax = f >> 1, ext = [p.x, p.y, p.z], sz = [p.w, p.h, p.d];
      for (const vtx of em.quads[qi]) {
        const P = [vtx.px / SC, vtx.py / SC, vtx.pz / SC];
        const tt = P.map((x, a) => (a === ax ? (f & 1 ? 0 : 1) : sz[a] > 0 ? (x - ext[a]) / sz[a] : 0));
        const want = vanUvAt(F, FKEY[f], tt);
        let got;
        if (s) got = [vr[0] + s.u0 + (vtx.u / 16 - s.ox), vr[1] + s.v0 + (vtx.v / 16 - s.oy)];
        else got = [vtx.u / 16, vtx.v / 16];
        R.corners++;
        if (Math.abs(got[0] - want[0]) > TOL || Math.abs(got[1] - want[1]) > TOL) bad(t, `corner uv of ${p.n} face ${f}: baked ${got.map((x) => +x.toFixed(3))} vanilla ${want.map((x) => +x.toFixed(3))}`);
      }
      // D: texels under the slice — packed tile vs the shipped sheet under the VANILLA rect
      if (!s || !J) return;
      const sx = J.w / (V.root.tw * b.ts[0]);
      // an animated sheet (a vertical strip of frames, the sprite atlas's .mcmeta rule): the uv spans ONE frame
      const sy = sx === 1 && J.h > J.w && J.h % (V.root.th * b.ts[1]) === 0 && J.h % J.w === 0 ? 1 : J.h / (V.root.th * b.ts[1]);
      // a sheet of another size than the model's texture is sampled at sheet/model scale (pack-mobtex, #5852): the texel compare below applies the same scale
      for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
        const X = Math.floor((vr[0] + s.u0 + x + 0.5) * sx), Y = Math.floor((vr[1] + s.v0 + y + 0.5) * sy);
        let e = [0, 0, 0, 0];
        if (X >= 0 && Y >= 0 && X < J.w && Y < J.h) { const q = (Y * J.w + X) * 4; e = [J.data[q], J.data[q + 1], J.data[q + 2], J.data[q + 3]]; }
        const o = ((s.tile - geom.tileBase) * TILE * TILE + (s.oy + y) * TILE + s.ox + x) * 4;
        R.texels++;
        if (e[3] === 0 && tiles[o + 3] === 0) continue;
        if (e[0] !== tiles[o] || e[1] !== tiles[o + 1] || e[2] !== tiles[o + 2] || e[3] !== tiles[o + 3]) bad(t, `texels of ${p.n} face ${f} differ from ${S.p} under the vanilla rect`);
      }
    });
    // baby: the same (tile, u, v) stream as the adult
    if (t === base && ER.babyTransform(base, 'head')) {
      const kid = emit(base, undefined, { baby: true, limbSwing: 0, limbSwingAmount: 0, netHeadYaw: 0, headPitch: 0, ageInTicks: 0 });
      if (kid && kid.quads.length === em.quads.length) {
        R.babies++;
        kid.quads.forEach((Q, i) => Q.forEach((v, c) => { const a = em.quads[i][c]; if (v.tile !== a.tile || v.u !== a.u || v.v !== a.v) bad(t, 'baby uv differs from the adult'); }));
      }
    }
  }
  return R;
}

if (ONLY && !geom.layers[ONLY]) { console.log(`--layer ${ONLY}: no such texture key. Keys containing it: ${Object.keys(geom.layers).filter((t) => t.includes(ONLY.replace(/^llama_/, ''))).join(', ') || '(none)'}`); process.exit(1); }   // #3953: a typo'd/mob-named layer joined 0 keys and exited 0
const live = audit(ONLY ? { only: [ONLY] } : {});
const badKeys = Object.keys(live.bad);
console.log(`joined: ${live.keys} texture keys on ${live.layers} model layers, ${live.parts} parts — ${live.rects} face rects, ${live.corners} baked corners, ${live.texels} texels compared, ${live.babies} baby layers (${live.unverif} keys with no shipped sheet: corners only)`);
console.log(`unjoined: ${Object.keys(live.unjoined).length} texture keys (no vanilla EntityModelLayer / parts unmatched)`);
if (PRINT || ONLY) {
  for (const [k, w] of Object.entries(live.unjoined)) console.log(`   unjoined ${k}: ${w}`);
  for (const k of badKeys) for (const [w, c] of Object.entries(live.bad[k]).slice(0, 8)) console.log(`   ✗ ${k}: ${w}${c > 1 ? ` (x${c})` : ''}`);
}
if (ONLY) process.exit(badKeys.length ? 1 : 0);
// ratchets
const kb = new Set(Object.keys(known.mismatch)), ku = new Set(Object.keys(known.unjoined));
for (const k of badKeys) ok(kb.has(k), `NEW UV mismatch vs vanilla: ${k} — ${Object.keys(live.bad[k]).slice(0, 3).join('; ')}`);
for (const k of kb) ok(badKeys.includes(k), `tools/uvl2-known.json lists ${k} as mismatching but it now matches vanilla — remove it (ratchet only goes down)`);
for (const k of Object.keys(live.unjoined)) ok(ku.has(k), `NEW unjoined texture key ${k}: ${live.unjoined[k]}`);
for (const k of ku) ok(k in live.unjoined, `tools/uvl2-known.json lists ${k} as unjoined but it now joins — remove it`);
ok(live.layers >= known.minLayers, `only ${live.layers} model layers joined (ratchet ${known.minLayers})`);
ok(live.texels > 100000 && live.corners > 10000, `too little compared: ${live.corners} corners, ${live.texels} texels`);
// #3928: vanilla EntityModelLayers.LLAMA_DECOR (llama/decor, Dilation 0.5) joined to every shipped decor key (16 dyes + trader_llama.png)
for (let k = 0; k <= 16; k++) { const t = k ? `decor#null#${k}` : 'decor#null'; ok(live.joined.includes(t) && !live.bad[baseOf(t)], `${t} not joined to vanilla llama/decor (${live.unjoined[t] || 'mismatch'})`); }
ok(live.babies > 10, `only ${live.babies} baby layers compared`);

// ── deliberate breaks ────────────────────────────────────────────────────────────────────────────────────────────
let caught = 0;
const CLEAN = Object.keys(geom.layers).filter((t) => !live.unjoined[t] && !live.bad[t] && !live.bad[baseOf(t)]);
const pick = (f) => CLEAN.find(f);
const brk = (label, run, base) => {
  let r; try { r = run(); } finally { BE.faceRects = saveRects; BE.faceUV = saveUV; BE.faceDir = saveDir; }
  const hit = Object.keys(r.bad).length > 0;
  if (ok(hit, `anti-vacuity: ${label} NOT caught`)) { caught++; console.log(`   ✓ break caught: ${label} (${Object.values(r.bad).reduce((a, o) => a + Object.values(o).reduce((x, y) => x + y, 0), 0)} findings)`); }
};
const saveRects = BE.faceRects, saveUV = BE.faceUV, saveDir = BE.faceDir;
const zomb = pick((t) => t === 'zombie'), cow = pick((t) => t === 'cow'), catv = pick((t) => /^cat#\d+$/.test(t));
const mir = pick((t) => BE.layer(baseOf(t)) && BE.layer(baseOf(t)).parts.some((p) => p.m) && geom.layers[t].some((P) => P.some((sl) => sl.length)));
brk('±Y rects swapped back (D-773)', () => { BE.faceRects = (p) => { const r = saveRects(p); return [r[0], r[1], r[3], r[2], r[4], r[5]]; }; return audit({ only: [zomb] }); });
brk(`${mir}: mirror ignored within a face`, () => { BE.faceUV = (f, m, ...a) => saveUV(f, 0, ...a); return audit({ only: [mir] }); });
const big = pick((t) => geom.layers[t].some((P) => P.some((sl) => sl.length > 1)));   // a face cut into several ≤16 slices
brk(`${big}: slices placed toward +axis on every face`, () => { BE.faceDir = () => [1, 1]; return audit({ only: [big] }); });
brk(`${cow}: one part's engine texture offset moved by one texel`, () => {
  const L = BE.layer(cow), save = L.parts[0]; L.parts[0] = Object.assign({}, save, { tu: save.tu + 1 });
  try { return audit({ only: [cow], resolve: (b) => { const r = resolve(b); return r; } }); } finally { L.parts[0] = save; }
});
brk('drowned_outer: one part shifted by one texel', () => {
  const L = BE.layer('drowned_outer#null'), save = L.parts[0]; L.parts[0] = Object.assign({}, save, { tu: save.tu + 1 });
  try { return audit({ only: ['drowned_outer#null'] }); } finally { L.parts[0] = save; }
});
brk(`${mir}: the vanilla side's mirror flag dropped`, () => audit({ only: [mir], resolve: (b) => { const r = resolve(b); if (!r.why) r.J = r.J.map((x) => (x.m ? { ...x, m: false } : x)); return r; } }));
brk(`${catv} bound to the wrong variant's sheet`, () => audit({ only: [catv], sheetOf: (n) => (n === catv ? sheetIdxFor('cat#' + (((+catv.split('#')[1]) % 10) + 1)) : sheetIdxFor(n)) }));
brk(`${zomb}: one packed texel changed`, () => {
  const t = Buffer.from(tilesReal); const s0 = geom.layers[zomb][0].flat().find(Boolean);
  const o = ((s0.tile - geom.tileBase) * TILE * TILE + s0.oy * TILE + s0.ox) * 4; t[o] ^= 0x20; t[o + 3] = 255;
  return audit({ only: [zomb], tiles: t });
});
brk(`${cow}: texture size halved on the vanilla side`, () => audit({ only: [cow], resolve: (b) => { const r = resolve(b); if (!r.why) r.root = Object.assign(Object.create(Object.getPrototypeOf(r.root)), r.root, { th: r.root.th / 2 }); return r; } }));
console.log(`${caught} breaks caught`);
console.log(`\nuvl2check: ${pass} assertions, ${fails.length} failed`);
for (const f of fails) console.log('   ✗ ' + f);
process.exit(fails.length ? 1 : 0);
