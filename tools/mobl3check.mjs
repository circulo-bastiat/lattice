#!/usr/bin/env node
// mobl3check.mjs — GATE M, layer L3 (RENDERED PIXELS), #1507, node half: every complained mob, isolated, fullbright,
// flat-lit, six axis views, drawn by TWO software rasterisers and compared pixel for pixel.
//
//   node tools/mobl3check.mjs [--print] [--mob <name>] [--png] [--file]
//
//   REFERENCE  built from the jar + .decomp only: the model is `EntityModels.getModels()` evaluated through
//              tools/vanillamodel.mjs (every Part's ModelTransform, every cuboid's grown box, mirror, uv), each face's
//              corner uv from ModelPart.Cuboid's layout, the texels decoded fresh from the 1.18.2 jar PNG.
//   ENGINE     ER.emitMobLayer — the live quad writer, posed by BE.poseBoxCorners — unpacked, its (tile, u, v) sampled
//              from the PACKED mob tiles (assets/mob-tiles.bin), i.e. exactly what the GPU is handed.
// Both are drawn by ONE rasteriser here (orthographic, pixel centre sampling, z-buffer, nearest texel, alpha < 0.1
// discarded like RenderLayer.getEntityCutoutNoCull, no culling, no light, no tint), 64 px per block = 4 px per model
// texel. Tolerance is 0 except the measured EDGE BAND, sized from the engine's own quanta (a packed position is 1/256
// block = 1/4 px here = 1/16 texel; a baked uv is 1/16 texel): a pixel within 0.75 px of any face's outline, a sample
// within 0.07 texel of a texel boundary, or a depth tie within 1/256 block between differently coloured faces. The band is COUNTED and printed,
// never hidden; outside it every pixel (colour, alpha, coverage) must be identical.
// Pose: the model's rest pose (getTexturedModelData transforms, no setAngles, no renderer scale()) on both sides; the
// LivingEntityRenderer chain at yaw 0, as mobshapecheck. The GPU half (both backends, headless Chromium) is the
// background render job (#1507 commander ruling): it compares the browser's pixels against THIS engine raster.
// Mismatching mobs are RATCHETED (tools/mobl3-known.json): a new one fails, a fixed one must be removed.
// --png writes a diff PNG per failing mob to assets/l3/ (red = mismatch, yellow = edge band); --file files one
// `bug,mobs` issue per mismatching mob, de-duplicated by "L3 render: <mob>" (never run by the suite).
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { inflateRawSync, deflateRawSync, constants as ZLIB } from 'node:zlib';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';
import { vanillaEval, loadDecomp } from './vanillamodel.mjs';
import { Jar } from './jarlib.mjs';
import { decodePng, encodePng } from './png.mjs';
import { requireJar, skipCheck } from './paths.mjs';

// imported (tools/texauditjob.mjs, the GPU half) the audit/ratchet/breaks run does not happen and a SKIP throws instead of exiting
const MAIN = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
const skip = (m) => { if (MAIN) { skipCheck('mobl3check', m); } throw new Error('mobl3check: ' + m); };
const ROOT = MCLITE_ROOT, A = join(ROOT, 'assets');
const PRINT = process.argv.includes('--print'), PNG = process.argv.includes('--png'), FILE = process.argv.includes('--file');
const ONLY = (() => { const i = process.argv.indexOf('--mob'); return i > 0 ? process.argv[i + 1] : null; })();
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 60) fails.push(m); return c; };
if (MAIN) console.log('mobl3check — GATE M L3: complained mobs, six axis views, jar+.decomp reference raster vs engine-emitted raster');
if (!existsSync(join(A, 'mob-tex.bin')) || !existsSync(join(ROOT, '.decomp'))) skip('assets or .decomp missing');
let jar; try { jar = new Jar(requireJar('1.18.2')); } catch (e) { skip('no 1.18.2 jar'); }

// the audit table (tools/mobl3-mobs.json): the ten complained mobs (#1507) + every further translatable mob (#1529) -> engine layers
export const MOBS = JSON.parse(readFileSync(new URL('./mobl3-mobs.json', import.meta.url), 'utf8')).mobs;   // shared with mobaudit4check (L4) and texauditjob (L3b)
const EXTRA_KEYS = { sheep: ['fur#null'], slime: ['slime_outer'], fox: ['snow_fox','snow_fox_sleep'] };   // feature textures drawn on a base layer whose key does not start with it

// ── the vanilla side: EntityModels.getModels(), evaluated (uvl2check's join) ─────────────────────────────────────
const MD = '.decomp/net/minecraft/client/render/entity/model/';
const FIELD = {};
for (const m of readFileSync(join(ROOT, MD, 'EntityModelLayers.java'), 'utf8').matchAll(/EntityModelLayer (\w+) = (registerMain|register|createInnerArmor|createOuterArmor)\("(\w+)"(?:, "(\w+)")?\)/g))
  FIELD[m[1]] = m[2] === 'registerMain' ? m[3] : m[2] === 'register' ? `${m[3]}/${m[4]}` : `${m[3]}/${m[2] === 'createInnerArmor' ? 'inner_armor' : 'outer_armor'}`;
const modelsSrc = readFileSync(join(ROOT, MD, 'EntityModels.java'), 'utf8');
const CONST = {};
for (const m of modelsSrc.matchAll(/static final Dilation (\w+) = (new Dilation\([^;]*\));/g)) CONST[m[1]] = m[2];
const subst = (e) => e.replace(/\b[A-Z][A-Z_]+_DILATION\b/g, (k) => CONST[k] || k);
const index = new Map();
(function walk(d) { for (const f of readdirSync(join(ROOT, '.decomp', d))) { const p = d + '/' + f; if (statSync(join(ROOT, '.decomp', p)).isDirectory()) walk(p); else if (f.endsWith('.java')) index.set(f.slice(0, -5), p); } })('net/minecraft/client/render');
for (const m of modelsSrc.matchAll(/\b([A-Z]\w+)\.get\w+\(/g)) if (index.has(m[1]) && !/Model$/.test(m[1])) loadDecomp(index.get(m[1]));
const VAN = {}, env = {};
for (const line of modelsSrc.split('\n')) {
  let m = /^\s*TexturedModelData (\$\$\d+) = (.*);\s*$/.exec(line);
  if (m) { try { env[m[1]] = vanillaEval(subst(m[2]), env); } catch (e) { env[m[1]] = { error: e.message }; } continue; }
  m = /^\s*\$\$0\.put\(EntityModelLayers\.(\w+), (.*)\);\s*$/.exec(line);
  if (!m || !FIELD[m[1]]) continue;
  try { VAN[FIELD[m[1]]] = /^\$\$\d+$/.test(m[2]) ? env[m[2]] : vanillaEval(subst(m[2]), env); } catch (e) { /* not translatable: reported per key */ }
}
try { VAN.boat = vanillaEval('BoatEntityModel.getTexturedModelData()'); } catch (e) { /* reported per key */ }   // #5846: createBoat(type) is a factory; all six woods share this one model
// texture key -> the EntityModelLayer it is drawn with (a feature layer's own model where vanilla has one)
const OWN_LAYER = { 'fur#null': 'sheep/fur', cat_collar: 'cat/collar', strider_saddle: 'strider/saddle', slime_outer: 'slime/outer', 'saddle#null': 'pig/saddle' };
const vanLayerOf = (texKey, base) => OWN_LAYER[texKey] || (/^decor#null(#\d+)?$/.test(texKey) ? 'llama/decor' : 0) || (/^tropical_fish_(small|large)_pattern(#\d)?$/.test(texKey) ? texKey.split('#')[0].replace(/_pattern$/, '/pattern') : base);   // #2717: TROPICAL_FISH_*_PATTERN layers
// #1548: `<mob>#b` / `<mob>#c` are the mob's own inner / outer ARMOUR model layers (BipedEntityModel.getModelData(dilation)), not
// texture variants of `<mob>` - join them as their own engine layer against EntityModelLayers <MOB>_INNER_ARMOR / _OUTER_ARMOR
const armorJoin = (t, layer) => { const m = /^(.*)#([bc])(#\d)?$/.exec(t), bl = m && m[1] + '#' + m[2];   // #2124: <mob>#b#N = material sheet N on the same model
  return m && m[1] === layer && BE.layer(bl) && BE.layer(bl).parts ? { layer: bl, vk: layer + '/' + (m[2] === 'b' ? 'inner' : 'outer') + '_armor' } : null; };
// the collar feature renderers tint a white mask by the entity's DyeColor, RED by default (WolfEntity/CatEntity
// COLLAR_COLOR) — DyeColor's colorComponents, read from .decomp, multiplied in as the vertex colour
// #1948: --dye <name> renders the collar in that DyeColor (the engine tints per entity via Tm.collarRGB, the vanilla side by DyeColor)
const DYE = (() => { const i = process.argv.indexOf('--dye'); return i > 0 ? process.argv[i + 1] : 'red'; })();
const dyeRGB = (() => { const m = new RegExp('\\(\\d+, "' + DYE + '", (\\d+),').exec(readFileSync(join(ROOT, '.decomp/net/minecraft/util/DyeColor.java'), 'utf8')); if (!m) throw new Error('mobl3check: unknown --dye ' + DYE); const c = +m[1]; return [(c >> 16) & 255, (c >> 8) & 255, c & 255].map((x) => Math.round(x / 255 * 7) / 7); })();   // the packed vertex tint is 3 bits a channel (eighths): the reference is quantised the same way, a rendering-side deviation
const TINT = { wolf_collar: dyeRGB, cat_collar: dyeRGB };

// ModelPart.Cuboid (.decomp ModelPart.java): six faces, each 4 corners (unit-box point, uv) — uvl2check's vanFaces
function vanFaces(b) {
  const U = b.tu, V = b.tv, w = b.w, h = b.h, d = b.d;
  let x0 = 0, x1 = 1; if (b.m) { const t = x0; x0 = x1; x1 = t; }
  const vt = { 18: [x0, 0, 0], 19: [x1, 0, 0], 20: [x1, 1, 0], 21: [x0, 1, 0], 22: [x0, 0, 1], 23: [x1, 0, 1], 24: [x1, 1, 1], 25: [x0, 1, 1] };
  const a = U, bb = U + d, c = U + d + w, e = U + d + w + w, g = U + d + w + d, k = U + d + w + d + w, q = V, r = V + d, s = V + d + h;
  const sides = [[[23, 19, 20, 24], c, r, g, s], [[18, 22, 25, 21], a, r, bb, s], [[23, 22, 18, 19], bb, q, c, r],
                 [[20, 21, 25, 24], c, r, e, q], [[19, 18, 21, 20], bb, r, c, s], [[22, 23, 24, 25], g, r, k, s]];
  return sides.map(([vs, u1, v1, u2, v2]) => { const uv = [[u2, v1], [u1, v1], [u1, v2], [u2, v2]]; return vs.map((i, j) => ({ pt: vt[i], uv: uv[j] })); });
}
const rz = (a) => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
const ry = (a) => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
const rx = (a) => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
const mm = (P, Q) => { const o = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = P[i * 3] * Q[j] + P[i * 3 + 1] * Q[3 + j] + P[i * 3 + 2] * Q[6 + j]; return o; };
const mv = (P, v) => [P[0] * v[0] + P[1] * v[1] + P[2] * v[2], P[3] * v[0] + P[4] * v[1] + P[5] * v[2], P[6] * v[0] + P[7] * v[1] + P[8] * v[2]];
/** vanilla quads in entity blocks: [{p:[[x,y,z]x4], uv:[[u,v]x4] (texels of the PNG), img}] — ModelPart.rotate order, LivingEntityRenderer at yaw 0 */
// TurtleEntityModel.setAngles: plastron.visible = !child && hasEgg - false at the rest pose (the engine gates egg_belly the same way, ER.emitMobLayer)
// HorseEntityModel.setAngles shows the baby legs only for a child: an adult at rest has them hidden (they are coplanar with the adult legs, a z-fight)
const babyLegs = (ER, layer) => ER.HORSE_MODEL[layer.split('#')[0]] ? ER.HORSE_BABY_LEGS : null;
const hiddenFor = (ER, layer) => layer.split('#')[0] === 'turtle' ? Object.assign({ egg_belly: 1 }, ER.DEFAULT_HIDDEN[layer]) : babyLegs(ER, layer) ? Object.assign({}, babyLegs(ER, layer), ER.DEFAULT_HIDDEN[layer]) : ER.DEFAULT_HIDDEN[layer];
export function vanillaQuads(root, img, hidden, tint, rt, cart, spit, mirror, upright, trident) {   // rt = the renderer's own scale() translate (ER.RENDER_TRANSLATE, phantom #1541)
  const T = rt || [0, 0, 0], out = [], sx = img.w / root.tw, sy = img.h / root.th;
  (function walk(p, R, t, name) {
    const R2 = mm(R, mm(mm(rz(p.xf.r[2]), ry(p.xf.r[1])), rx(p.xf.r[0]))), t2 = mv(R, p.xf.p).map((v, i) => v + t[i]);
    if (!(hidden && hidden[name])) for (const b of p.boxes) {
      const lo = [b.x - b.g[0], b.y - b.g[1], b.z - b.g[2]], hi = [b.x + b.w + b.g[0], b.y + b.h + b.g[1], b.z + b.d + b.g[2]];
      for (const F of vanFaces(b)) {
        out.push({ p: F.map(({ pt }) => { const q = mv(R2, pt.map((u, i) => (u ? hi[i] : lo[i]))); return upright ? [-(q[0] + t2[0]) / 16, (q[1] + t2[1]) / 16, -(q[2] + t2[2]) / 16] : mirror ? [   /* scale(-1,-1,1) only, seen at the checker's yaw 180 */ (q[0] + t2[0]) / 16, -(q[1] + t2[1]) / 16, -(q[2] + t2[2]) / 16] : trident ? [-(q[2] + t2[2]) / 16, (q[0] + t2[0]) / 16, -(q[1] + t2[1]) / 16] : spit ? [-(q[2] + t2[2]) / 16, 0.15 + (q[1] + t2[1]) / 16, (q[0] + t2[0]) / 16] : cart === 'boat' ? [(q[2] + t2[2]) / 16, 0.375 - (q[1] + t2[1]) / 16, (q[0] + t2[0]) / 16] : cart ? [-(q[0] + t2[0]) / 16, 0.375 - (q[1] + t2[1]) / 16, (q[2] + t2[2]) / 16] : [(q[0] + t2[0]) / 16 - T[0], 1.501 - (q[1] + t2[1]) / 16 - T[1], -(q[2] + t2[2]) / 16 - T[2]]; }),
          uv: F.map(({ uv }) => [uv[0] * sx / b.ts[0], uv[1] * sy / b.ts[1]]), img, tint });
      }
    }
    p.kids.forEach((k, i) => walk(k, R2, t2, p.names[i]));
  })(root, [1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 0], 'root');
  return out;
}

// ── the engine ───────────────────────────────────────────────────────────────────────────────────────────────────
const M = loadEngine({ extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07v_spell.js', '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js', '07zs_spawner.js', '07zzs_minecartrender.js'], dom: false });
initRegistry(M);
{
  const mmeta = JSON.parse(readFileSync(join(A, 'models.meta.json'), 'utf8'));
  M.BEModel.init({ models: readFileSync(join(A, 'models.bin')).toString('base64'), modelsBytes: mmeta.rawBytes });
}
const geomRaw = readFileSync(join(A, 'mob-geometry.json'));
M.DATA = Object.assign({}, M.DATA, { mobGeometry: deflateRawSync(geomRaw, { level: 9 }).toString('base64'), mobGeometryBytes: geomRaw.length,
  entities: JSON.parse(readFileSync(join(A, 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.EntityRender.init();
const ER = M.EntityRender, BE = M.BEModel, MS = M.Mesher, U = M.CFG.MODEL_UNITS_PER_BLOCK;
export const engineHandles = { ER, MS, U, geom: null };   // #1895: chickenpixelcheck poses the engine itself
export const hiddenOf = (layer) => hiddenFor(ER, layer);
ok(ER.ready && BE.ready, 'engine up');
const geom = JSON.parse(geomRaw.toString('utf8'));
const whole = inflateRawSync(readFileSync(join(A, 'mob-tex.bin')));
const hl = whole.readUInt32LE(0), H = JSON.parse(whole.subarray(4, 4 + hl).toString('utf8'));
const TILE = JSON.parse(readFileSync(join(A, 'mob-tiles.meta.json'), 'utf8')).tile;
export const tilesReal = inflateRawSync(readFileSync(join(A, 'mob-tiles.bin')), { finishFlush: ZLIB.Z_SYNC_FLUSH });
const known = JSON.parse(readFileSync(join(ROOT, 'tools', 'mobl3-known.json'), 'utf8'));
function sheetPathFor(name) {   // texture key -> the jar path of its sheet (texl1check's join; the CONTENT is read from the jar)
  let i = H.layers[name] ? H.layers[name][0] : null;
  const m = /^(.*)#(\d+)$/.exec(name);
  if (i == null && m && H.layers[m[1]] && H.layers[m[1]][+m[2]] != null) i = H.layers[m[1]][+m[2]];
  return i == null ? null : H.sheets[i].p;
}
// #5847 ruling: the jar's end_crystal sheet is 128x64 under a 64x32 model (vanilla samples it at 2x); the engine's tile packer
// cuts model texels (tools/pack-mobtex.mjs sheetPixels), so the reference is point-sampled at each texel centre the same way.
function halve(r) { const o = new Uint8Array(r.w / 2 * r.h / 2 * 4); for (let y = 0; y < r.h / 2; y++) for (let x = 0; x < r.w / 2; x++) for (let c = 0; c < 4; c++) o[(y * r.w / 2 + x) * 4 + c] = r.data[((2 * y + 1) * r.w + 2 * x + 1) * 4 + c]; return { w: r.w / 2, h: r.h / 2, data: o }; }
const jarCache = new Map();
function jarImg(p) {
  const m = /^(assets\/minecraft\/textures\/entity\/)(squid|iron_golem)\.png$/.exec(p || '');
  if (m && !jar.names().includes(p) && jar.names().includes(`${m[1]}${m[2]}/${m[2]}.png`)) p = `${m[1]}${m[2]}/${m[2]}.png`;   // squid lives at entity/squid/squid.png
  if (!jarCache.has(p)) { let r = null; try { const d = decodePng(jar.read(p)); r = { w: d.width, h: d.height, data: d.data }; if (/\/end_crystal\/end_crystal\.png$/.test(p) && r.w === 128) r = halve(r); } catch (e) { /* absent */ } jarCache.set(p, r); }
  return jarCache.get(p);
}
const entOf = (layer) => layer.split('#')[0].replace(/^decor$/, 'llama').replace(/^saddle$/, 'pig').replace(/^strider_saddle$/, 'strider').replace(/^slime_outer$/, 'slime').replace(/^(pufferfish|tropical_fish)_(small|medium|big|large)(_pattern)?$/, '$1');
/** engine quads in entity blocks, sampling the packed tiles: [{p, uv (tile-local texels), tile}] */
export function engineQuads(layer, texKey, tiles, tintRGB) {
  const dh0 = ER.DEFAULT_HIDDEN[layer], bl = babyLegs(ER, layer);
  if (bl) ER.DEFAULT_HIDDEN[layer] = Object.assign({}, bl, dh0);
  try { return engineQuads1(layer, texKey, tiles, tintRGB); } finally { if (bl) { if (dh0) ER.DEFAULT_HIDDEN[layer] = dh0; else delete ER.DEFAULT_HIDDEN[layer]; } }
}
const isCart = (layer) => layer.split('#')[0] === 'boat' ? 'boat' : !!(M.MinecartRender && M.MinecartRender.is(layer.split('#')[0]));   // #5846: the boat's pose frame (BoatEntityRenderer) is drawn like a cart's: its own sleepPose, not the living one
function engineQuads1(layer, texKey, tiles, tintRGB) {
  const n = ER.mobQuadCount(layer, texKey); if (!n) return null;
  const buf = MS.allocBuffer(0, 0, 0, [n, 0, 0]), hdr = MS.readHeader(buf), w = new Uint32Array(buf, hdr.modelOff[0], n * 16);
  const cartAnim = layer === 'trident' ? ER.tridentAnimOf({}, 1) : isCart(layer) === 'boat' ? { sleepPose: { R: ER.boatMatrix({ yaw: 3.14159265 }, 1), dx: 0, dy: 0.375, dz: 0 } } : isCart(layer) ? M.MinecartRender.animOf({ type: layer, cartYaw: 180, cartPitch: 0 }, 1, [0, 0, 0]) : undefined;   // #3497: MinecartEntityRenderer's frame, not LivingEntityRenderer's
  ER.emitMobLayer(w, 0, layer, 0, 0, 0, layer === 'llama_spit' ? Math.cos(ER.spitYaw({}, 1)) : cartAnim ? 1 : Math.cos(Math.PI), layer === 'llama_spit' ? Math.sin(ER.spitYaw({}, 1)) : cartAnim ? 0 : Math.sin(Math.PI), 15, 0, 3, cartAnim, ER.basePoseFor(entOf(layer)), texKey, 0, tintRGB || null, null);
  const out = [];
  for (let q = 0; q < n; q++) {
    const p = [], uv = []; let tile = 0, tint;
    for (let c = 0; c < 4; c++) { const o = q * 16 + c * 4, v = MS.unpackModelVertex(w[o], w[o + 1], w[o + 2], w[o + 3]); p.push([v.px / U, v.py / U + (cartAnim ? cartAnim.sleepPose.dy : 0), v.pz / U]); uv.push([v.u / 16, v.v / 16]); tile = v.tile; tint = [v.er / 7, v.eg / 7, v.eb / 7]; }
    out.push({ p, uv, tile, tiles, tint: tintRGB ? tint : undefined });
  }
  return out;
}

// ── the rasteriser ───────────────────────────────────────────────────────────────────────────────────────────────
export const RES = 64;
const PAD = 2, EPS_T = 0.07, QZ = 1 / 256 + 1e-4, BAND = 0.5 + RES / 256;   // a packed model position is 1/256 block: depth and outline may move that much
// camera on +n looking -n, right x up == n
export const VIEWS = [['+x', [1, 0, 0], [0, 0, -1], [0, 1, 0]], ['-x', [-1, 0, 0], [0, 0, 1], [0, 1, 0]], ['+y', [0, 1, 0], [1, 0, 0], [0, 0, -1]],
               ['-y', [0, -1, 0], [1, 0, 0], [0, 0, 1]], ['+z', [0, 0, 1], [1, 0, 0], [0, 1, 0]], ['-z', [0, 0, -1], [-1, 0, 0], [0, 1, 0]]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function sample(q, u, v) {   // -> [r,g,b,a] or null (outside / transparent), plus fragility
  let r, g, b, a;
  if (q.img) {
    const X = Math.floor(u), Y = Math.floor(v);
    if (X < 0 || Y < 0 || X >= q.img.w || Y >= q.img.h) return null;
    const o = (Y * q.img.w + X) * 4, d = q.img.data; r = d[o]; g = d[o + 1]; b = d[o + 2]; a = d[o + 3];
    if (q.tint) { r = Math.round(r * q.tint[0]); g = Math.round(g * q.tint[1]); b = Math.round(b * q.tint[2]); }
  } else {
    const X = Math.floor(u), Y = Math.floor(v);
    if (X < 0 || Y < 0 || X >= TILE || Y >= TILE) return null;
    const o = ((q.tile - geom.tileBase) * TILE * TILE + Y * TILE + X) * 4, d = q.tiles; r = d[o]; g = d[o + 1]; b = d[o + 2]; a = d[o + 3];
    if (q.tint) { r = Math.round(r * q.tint[0]); g = Math.round(g * q.tint[1]); b = Math.round(b * q.tint[2]); }
  }
  return a < 25.5 ? null : [r, g, b, a];
}
export function frame(sets, V) {
  let r0 = 1e9, r1 = -1e9, u0 = 1e9, u1 = -1e9;
  for (const qs of sets) for (const q of qs) for (const p of q.p) { const r = dot(p, V[2]), u = dot(p, V[3]); r0 = Math.min(r0, r); r1 = Math.max(r1, r); u0 = Math.min(u0, u); u1 = Math.max(u1, u); }
  const W = Math.ceil((r1 - r0) * RES) + 2 * PAD, Hh = Math.ceil((u1 - u0) * RES) + 2 * PAD;
  return { V, r0: r0 - PAD / RES, u1: u1 + PAD / RES, W, H: Hh };
}
export function raster(qs, F) {
  const N = F.W * F.H, col = new Uint8Array(N * 4), z = new Float64Array(N).fill(-Infinity), line = new Uint8Array(N), tie = new Uint8Array(N), tex = new Uint8Array(N);
  const [, n, R, Up] = F.V;
  for (const q of qs) {
    const s = q.p.map((p) => [(dot(p, R) - F.r0) * RES, (F.u1 - dot(p, Up)) * RES, dot(p, n)]);
    const area = (s[1][0] - s[0][0]) * (s[2][1] - s[0][1]) - (s[2][0] - s[0][0]) * (s[1][1] - s[0][1]);
    if (Math.abs(area) < 1e-6 && Math.abs((s[2][0] - s[0][0]) * (s[3][1] - s[0][1]) - (s[3][0] - s[0][0]) * (s[2][1] - s[0][1])) < 1e-6) continue;   // edge-on
    const x0 = Math.max(0, Math.floor(Math.min(...s.map((v) => v[0])))), x1 = Math.min(F.W - 1, Math.ceil(Math.max(...s.map((v) => v[0]))));
    const y0 = Math.max(0, Math.floor(Math.min(...s.map((v) => v[1])))), y1 = Math.min(F.H - 1, Math.ceil(Math.max(...s.map((v) => v[1]))));
    // every pixel whose centre lies within half a pixel of this face's outline is in the band, covered or not
    for (let y = Math.max(0, y0 - 1); y <= Math.min(F.H - 1, y1 + 1); y++) for (let x = Math.max(0, x0 - 1); x <= Math.min(F.W - 1, x1 + 1); x++) {
      const X = x + 0.5, Y = y + 0.5;
      for (let e = 0; e < 4; e++) {
        const P = s[e], Q = s[(e + 1) & 3], dx = Q[0] - P[0], dy = Q[1] - P[1], L2 = dx * dx + dy * dy;
        const t = L2 > 1e-12 ? Math.max(0, Math.min(1, ((X - P[0]) * dx + (Y - P[1]) * dy) / L2)) : 0;
        if (Math.hypot(X - P[0] - t * dx, Y - P[1] - t * dy) < BAND) { line[y * F.W + x] = 1; break; }
      }
    }
    for (const [i, j, k] of [[0, 1, 2], [0, 2, 3]]) {
      const P = s[i], Q = s[j], S = s[k], den = (Q[1] - S[1]) * (P[0] - S[0]) + (S[0] - Q[0]) * (P[1] - S[1]);
      if (Math.abs(den) < 1e-9) continue;
      // a 1/256 position quantum moves the sampled point along a tilted face by QZ*tan(tilt) blocks (tan = |grad depth| per block): a grazing face
      // (phantom tail tip under body pitch -0.1) can slide several texels, so its texel-boundary fragility grows by that many texels
      const g1 = [(Q[1] - S[1]) / den, (S[0] - Q[0]) / den], g2 = [(S[1] - P[1]) / den, (P[0] - S[0]) / den], g3 = [-g1[0] - g2[0], -g1[1] - g2[1]];
      const grad = (a, b, c) => [0, 1].map((m) => a * g1[m] + b * g2[m] + c * g3[m]);
      const gd = grad(P[2], Q[2], S[2]), slide = QZ * RES * RES * Math.hypot(gd[0], gd[1]);
      const gu = Math.hypot(...grad(q.uv[i][0], q.uv[j][0], q.uv[k][0])), gv = Math.hypot(...grad(q.uv[i][1], q.uv[j][1], q.uv[k][1]));
      const epsU = EPS_T + slide * gu, epsV = EPS_T + slide * gv;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const X = x + 0.5, Y = y + 0.5;
        const l1 = ((Q[1] - S[1]) * (X - S[0]) + (S[0] - Q[0]) * (Y - S[1])) / den, l2 = ((S[1] - P[1]) * (X - S[0]) + (P[0] - S[0]) * (Y - S[1])) / den, l3 = 1 - l1 - l2;
        if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
        const u = l1 * q.uv[i][0] + l2 * q.uv[j][0] + l3 * q.uv[k][0], v = l1 * q.uv[i][1] + l2 * q.uv[j][1] + l3 * q.uv[k][1];
        const c = sample(q, u, v); if (!c) continue;
        const d = l1 * P[2] + l2 * Q[2] + l3 * S[2], o = y * F.W + x;
        const fu = u - Math.round(u), fv = v - Math.round(v);
        const frag = Math.abs(fu) < epsU || Math.abs(fv) < epsV;
        if (d > z[o] + QZ) { z[o] = d; col.set(c, o * 4); tex[o] = frag ? 1 : 0; }
        else if (d > z[o] - QZ) {   // a depth tie within the engine's position quantum: either surface may win
          const same = c[0] === col[o * 4] && c[1] === col[o * 4 + 1] && c[2] === col[o * 4 + 2] && c[3] === col[o * 4 + 3];
          if (!same) tie[o] = 1;
          if (d > z[o]) { z[o] = d; col.set(c, o * 4); tex[o] = frag ? 1 : 0; }
        }
      }
    }
  }
  const edge = new Uint8Array(N); for (let o = 0; o < N; o++) edge[o] = line[o] | tie[o] | tex[o];
  return { col, edge, z };
}
export function compare(van, eng) {   // -> { px, mism, band, views: [{name, W, H, a, b}] }
  const R = { px: 0, mism: 0, band: 0, views: [] };
  for (const V of VIEWS) {
    const F = frame([van, eng], V), a = raster(van, F), b = raster(eng, F);
    let mism = 0, band = 0;
    const diff = new Uint8Array(F.W * F.H);
    for (let o = 0; o < F.W * F.H; o++) {
      const ca = a.z[o] > -Infinity, cb = b.z[o] > -Infinity;
      if (!ca && !cb) continue;
      R.px++;
      let same = ca === cb;
      if (same) for (let c = 0; c < 4; c++) if (a.col[o * 4 + c] !== b.col[o * 4 + c]) same = false;
      if (same) continue;
      if (a.edge[o] || b.edge[o]) { band++; diff[o] = 2; } else { mism++; diff[o] = 1; if (process.env.L3DBG) console.log("       px", V[0], o % F.W, Math.floor(o / F.W), "ref", ca ? [...a.col.subarray(o * 4, o * 4 + 4)] + " z" + a.z[o].toFixed(4) : "-", "eng", cb ? [...b.col.subarray(o * 4, o * 4 + 4)] + " z" + b.z[o].toFixed(4) : "-"); }
    }
    R.mism += mism; R.band += band; R.views.push({ name: V[0], W: F.W, H: F.H, a, b, diff, mism });
  }
  return R;
}
export function diffPng(name, R) {   // per view: reference | engine | diff, stacked
  const W = Math.max(...R.views.map((v) => v.W)) * 3 + 8, Hh = R.views.reduce((s, v) => s + v.H + 4, 0), img = new Uint8Array(W * Hh * 4);
  let y0 = 0;
  for (const v of R.views) {
    for (let y = 0; y < v.H; y++) for (let x = 0; x < v.W; x++) {
      const o = y * v.W + x;
      for (const [k, src] of [[0, v.a], [1, v.b]]) { const d = ((y0 + y) * W + k * (v.W + 4) + x) * 4; img.set(src.col.subarray(o * 4, o * 4 + 4), d); }
      const d = ((y0 + y) * W + 2 * (v.W + 4) + x) * 4;
      if (v.diff[o] === 1) img.set([255, 0, 0, 255], d); else if (v.diff[o] === 2) img.set([255, 220, 0, 255], d);
      else if (v.a.z[o] > -Infinity) img.set([80, 80, 80, 255], d);
    }
    y0 += v.H + 4;
  }
  mkdirSync(join(A, 'l3'), { recursive: true });
  const p = join(A, 'l3', name.replace(/[#/]/g, '_') + '.png');
  writeFileSync(p, encodePng(W, Hh, img, { palette: false }));
  return p;
}

// ── the audit ────────────────────────────────────────────────────────────────────────────────────────────────────
export function texKeysOf(layer) {   // the base texture key and every variant / feature texture drawn on the same model layer
  return (EXTRA_KEYS[layer] || []).concat(Object.keys(geom.layers).filter((t) => t === layer || t.startsWith(layer + '#') || (t.startsWith(layer + '_') && (geom.layers[t] || []).length === (BE.layer(layer).parts || []).length))
    .filter((t) => !(t !== layer && ((BE.layer(t) && BE.layer(t).parts) || /#[bc]#\d$/.test(t)) && t.split('#')[0] !== layer)));
}
// vanilla's resting visibility: the engine's DEFAULT_HIDDEN, plus IllagerEntityModel.setAngles' tail for state CROSSED
// (.decomp IllagerEntityModel.java:148-151: arms.visible = true, leftArm/rightArm.visible = false)
const vanHidden = (layer) => layer === 'boat' ? { water_patch: 1 } : /^decor#null/.test(layer) ? {} : ER.ILLAGERS[layer] ? Object.assign({ left_arm: 1, right_arm: 1 }, { hat: 1 }) : hiddenFor(ER, layer);
function audit(opt = {}) {
  const out = {};
  for (const [mob, layers] of Object.entries(MOBS)) {
    if (opt.only && !opt.only.includes(mob)) continue;
    const r = out[mob] = { keys: [], px: 0, mism: 0, band: 0, unjoined: [], worst: null };
    if (mob === 'evoker_fangs') { r.keys.push('evoker_fangs#posed'); continue; }   // never drawn at rest (EvokerFangsEntityRenderer): fangsSection() compares the posed raster
    for (const layer of layers) {
      if (!BE.layer(layer)) { r.unjoined.push(`${layer}: no engine layer`); continue; }
      for (const t of texKeysOf(layer)) {
        const aj = armorJoin(t, layer), eL = aj ? aj.layer : t === 'slime_outer' ? t : layer;   // #1869: its own box list
        const vk = aj ? aj.vk : vanLayerOf(t, layer), root = (opt.root || ((k) => VAN[k]))(vk);
        if (!root || root.error) { r.unjoined.push(`${t}: no translatable EntityModelLayer ${vk}`); continue; }
        const sp = (opt.sheetPath || sheetPathFor)(t), img = sp && jarImg(sp);
        if (!img) { r.unjoined.push(`${t}: no jar sheet (${sp})`); continue; }
        const eq = engineQuads(eL, t === eL ? undefined : t, opt.tiles || tilesReal, TINT[t]);
        if (!eq) { r.unjoined.push(`${t}: engine emits nothing`); continue; }
        const vq = vanillaQuads(root, img, vanHidden(eL), TINT[t], ER.RENDER_TRANSLATE[layer.split("#")[0]], isCart(eL), eL === 'llama_spit', !!ER.MIRROR_ONLY[eL.split('#')[0]], eL === 'end_crystal', eL === 'trident');
        const C = compare(vq, eq);
        r.keys.push(t); r.px += C.px; r.mism += C.mism; r.band += C.band;
        if (C.mism && (!r.worst || C.mism > r.worst.C.mism)) r.worst = { t, C };
        if (PRINT && C.mism) console.log(`     ${t}: ${C.views.map((v) => `${v.name} ${v.mism}`).join(', ')}`);
      }
    }
  }
  return out;
}

// ── #1839: evoker_fangs POSED: EvokerFangsEntityRenderer.render + EvokerFangsEntityModel.setAngles, several animation progress values ──
// Not a living mob (no LivingEntityRenderer flip), so the rest-pose roster cannot hold it. VANILLA side from .decomp: setAngles'
// jaw rolls / shared pivotY lift on the evaluated model, then rotateY(90 - yaw), scale(-s,-s,s), translate(0,-0.626,0), scale(0.5)
// with s = 2 shrinking over the last tenth. ENGINE side: ER.fangsAnim / fangsScale / fangsYaw / FANGS_BASE through ER.emitMobLayer.
const fangsVan = (prog, yawDeg, vo = {}) => {
  const root = VAN['evoker_fangs'], img = jarImg(sheetPathFor('evoker_fangs'));
  const t0 = Math.min(prog * 2, 1), t = 1 - t0 * t0 * t0, lift = (prog + Math.sin(prog * 2.7)) * 0.6 * 12 * (vo.noLift ? 0 : 1);
  const up = Math.PI - t * 0.35 * Math.PI * (vo.flipJaw ? -1 : 1), lo = Math.PI + t * 0.35 * Math.PI * (vo.flipJaw ? -1 : 1);
  const kids = root.kids.map((p, i) => {
    const n = root.names[i], r = p.xf.r.slice(), pp = p.xf.p.slice();
    if (n === 'upper_jaw') r[2] = up; else if (n === 'lower_jaw') r[2] = lo;
    pp[1] = 24 - lift;
    return Object.assign(Object.create(Object.getPrototypeOf(p)), p, { xf: { p: pp, r } });
  });
  const posed = Object.assign(Object.create(Object.getPrototypeOf(root)), root, { kids });
  const s = (prog > 0.9 && !vo.noShrink ? 2 * (1 - prog) / 0.1 : 2), R = ry((90 - yawDeg + (vo.yawOff || 0)) * DEG_);
  return vanillaQuads(posed, img, undefined, undefined, undefined).map((f) => {
    f.p = f.p.map((o) => { const m = [o[0] * 0.5, (1.501 - o[1]) * 0.5 - 0.626, -o[2] * 0.5]; return mv(R, [-s * m[0], -s * m[1], s * m[2]]); });   // (o -> raw model blocks) -> renderer chain
    return f;
  });
};
const DEG_ = Math.PI / 180;
function fangsEng(prog, yawDeg) {
  const n = ER.mobQuadCount('evoker_fangs'), buf = MS.allocBuffer(0, 0, 0, [n, 0, 0]), hdr = MS.readHeader(buf), w = new Uint32Array(buf, hdr.modelOff[0], n * 16);
  const yw = ER.fangsYaw({ yaw: yawDeg });
  ER.emitMobLayer(w, 0, 'evoker_fangs', 0, 0, 0, Math.cos(yw), Math.sin(yw), 15, 0, 0, ER.fangsAnim(prog), ER.FANGS_BASE, undefined, false, undefined, ER.fangsScale(prog));
  const out = [];
  for (let q = 0; q < n; q++) {
    const p = [], uv = []; let tile = 0;
    for (let c = 0; c < 4; c++) { const o = q * 16 + c * 4, v = MS.unpackModelVertex(w[o], w[o + 1], w[o + 2], w[o + 3]); p.push([v.px / U, v.py / U, v.pz / U]); uv.push([v.u / 16, v.v / 16]); tile = v.tile; }
    out.push({ p, uv, tile, tiles: tilesReal });
  }
  return out;
}
const FANG_CASES = [[0.05, 0], [0.3, 37], [0.5, 90], [0.8, -50], [0.95, 20]];   // [animation progress, yaw degrees]; 0.95 is inside the shrink
function fangsRun(vo, only) {
  const R = { px: 0, mism: 0, band: 0 };
  for (const [pr, yw] of FANG_CASES) { if (only && only !== pr) continue; const C = compare(fangsVan(pr, yw, vo), fangsEng(pr, yw)); R.px += C.px; R.mism += C.mism; R.band += C.band; }
  return R;
}
function fangsSection() {
  const r = fangsRun();
  console.log(`  ${r.mism ? '✗' : '✓'} evoker_fangs posed (${FANG_CASES.length} progress/yaw cases x 6 views): ${r.px} px, ${r.mism} mismatched, ${r.band} in the edge band`);
  ok(r.mism === 0 && r.px > 10000, `evoker_fangs posed: ${r.mism} px differ from EvokerFangsEntityRenderer/Model (${r.px} compared)`);
  let c = 0;
  for (const [label, vo] of [['jaw rolls reversed', { flipJaw: 1 }], ['lift dropped', { noLift: 1 }], ['renderer shrink dropped', { noShrink: 1 }], ['yaw off by 10 degrees', { yawOff: 10 }]]) {
    const b = fangsRun(vo);
    if (ok(b.mism > 0, `anti-vacuity: evoker_fangs ${label} NOT caught`)) { c++; console.log(`   ✓ break caught: evoker_fangs ${label} (${b.mism} px)`); }
  }
  return { r, caught: c };
}

// ── #3032: shulker_bullet POSED: ShulkerBulletEntityRenderer.render (first pass; the alpha-0.15 x1.5 halo is not drawn) + ShulkerBulletEntityModel.setAngles ──
// VANILLA side from .decomp: translate(0,0.15), Ry(sin(a*.1)*180) Rx(cos(a*.1)*180) Rz(sin(a*.15)*360), scale(-.5,-.5,.5), part yaw/pitch.
const bulletVan = (age, yawDeg, pitchDeg, vo = {}) => {
  const root = VAN['shulker_bullet'], img = jarImg(sheetPathFor('shulker_bullet'));
  const kids = root.kids.map((p) => { const r = p.xf.r.slice(); r[0] = pitchDeg * DEG_; r[1] = (yawDeg + (vo.yawOff || 0)) * DEG_; return Object.assign(Object.create(Object.getPrototypeOf(p)), p, { xf: { p: p.xf.p, r } }); });
  const posed = Object.assign(Object.create(Object.getPrototypeOf(root)), root, { kids });
  const R = mm(mm(ry(Math.sin(age * 0.1) * Math.PI), rx(Math.cos(age * 0.1) * Math.PI)), rz(Math.sin(age * (vo.noSpinZ ? 0 : 0.15)) * 2 * Math.PI));
  return vanillaQuads(posed, img, undefined, undefined, undefined).map((f) => {
    f.p = f.p.map((o) => { const m = mv(R, [-0.5 * o[0], -0.5 * (1.501 - o[1]), -0.5 * o[2]]); return [m[0], m[1] + 0.15, m[2]]; });
    return f;
  });
};
function bulletEng(age, yawDeg, pitchDeg) {
  const n = ER.mobQuadCount('shulker_bullet'), buf = MS.allocBuffer(0, 0, 0, [n, 0, 0]), hdr = MS.readHeader(buf), w = new Uint32Array(buf, hdr.modelOff[0], n * 16);
  const y = yawDeg * DEG_, pt = pitchDeg * DEG_, v = [Math.sin(y) * Math.cos(pt), Math.sin(pt), Math.cos(y) * Math.cos(pt)];
  const e = { type: 'shulker_bullet', age: Math.floor(age), vx: v[0], vy: v[1], vz: v[2] }, an = ER.animOf(e, age - Math.floor(age));
  ER.emitMobLayer(w, 0, 'shulker_bullet', 0, Math.round(0.15 * U), 0, 1, 0, 15, 15, 0, an, undefined, undefined, false, undefined, ER.mobScale(e, 0));
  const out = [];
  for (let q = 0; q < n; q++) {
    const p = [], uv = []; let tile = 0;
    for (let c = 0; c < 4; c++) { const o = q * 16 + c * 4, vv = MS.unpackModelVertex(w[o], w[o + 1], w[o + 2], w[o + 3]); p.push([vv.px / U, vv.py / U, vv.pz / U]); uv.push([vv.u / 16, vv.v / 16]); tile = vv.tile; }
    out.push({ p, uv, tile, tiles: tilesReal });
  }
  return out;
}
const BULLET_CASES = [[0, 0, 0], [7.3, 40, 20], [15.5, -110, -35], [33.25, 170, 60]];   // [age + partial, yaw, pitch degrees]
function bulletRun(vo) {
  const R = { px: 0, mism: 0, band: 0 };
  for (const [a, yw, pt] of BULLET_CASES) { const C = compare(bulletVan(a, yw, pt, vo), bulletEng(a, yw, pt)); R.px += C.px; R.mism += C.mism; R.band += C.band; }
  return R;
}
function bulletSection() {
  const r = bulletRun();
  console.log(`  ${r.mism > 2 ? '✗' : '✓'} shulker_bullet posed (${BULLET_CASES.length} age/yaw/pitch cases x 6 views): ${r.px} px, ${r.mism} mismatched, ${r.band} in the edge band`);
  ok(r.mism <= 2 && r.px > 1000, `shulker_bullet posed: ${r.mism} px differ from ShulkerBulletEntityRenderer/Model (${r.px} compared)`);
  let c = 0;
  for (const [label, vo] of [['model yaw off by 10 degrees', { yawOff: 10 }], ['Rz spin dropped', { noSpinZ: 1 }]]) {
    const b = bulletRun(vo);
    if (ok(b.mism > 0, `anti-vacuity: shulker_bullet ${label} NOT caught`)) { c++; console.log(`   ✓ break caught: shulker_bullet ${label} (${b.mism} px)`); }
  }
  return { r, caught: c };
}

if (MAIN) {
if (ONLY === 'shulker_bullet') { const f = bulletSection(); console.log(`${f.caught} breaks caught`); process.exit(fails.length ? 1 : 0); }
if (ONLY === 'evoker_fangs') { const f = fangsSection(); console.log(`${f.caught} breaks caught`); process.exit(fails.length ? 1 : 0); }
if (ONLY && !(ONLY in MOBS)) { console.error(`mobl3check: unknown --mob ${ONLY} (roster: ${Object.keys(MOBS).join(', ')})`); process.exit(2); }
const live = audit(ONLY ? { only: [ONLY] } : {});
const failing = [];
for (const [mob, r] of Object.entries(live)) {
  const png = r.worst && (PNG || ONLY) ? '  diff: ' + diffPng(`${mob}-${r.worst.t}`, r.worst.C).slice(ROOT.length) : '';
  console.log(`  ${r.mism ? '✗' : '✓'} ${mob.padEnd(8)} ${String(r.keys.length).padStart(2)} texture keys x 6 views, ${String(r.px).padStart(7)} px: ${r.mism} mismatched, ${r.band} in the edge band${r.unjoined.length ? `, ${r.unjoined.length} unjoined (${r.unjoined.join('; ')})` : ''}${r.worst ? ` — worst ${r.worst.t}` : ''}${png}`);
  if (r.mism) failing.push(mob);
}
// HuskEntityRenderer.scale: 1.0625 (the rest-pose raster above carries no renderer scale, so it is pinned here)
ok(ER.renderScaleOf({ type: 'husk' }) === 1.0625, `husk render scale ${ER.renderScaleOf({ type: 'husk' })}, vanilla 1.0625`);
if (ONLY) process.exit(failing.length ? 1 : 0);
if (FILE) await fileBugs(failing, live, { source: 'node' });
// ratchet: a mob may only leave tools/mobl3-known.json
for (const mob of failing) ok(mob in known.mismatch, `NEW L3 pixel mismatch: ${mob} (${live[mob].mism} px, worst ${live[mob].worst.t}) — node tools/mobl3check.mjs --mob ${mob} writes the diff PNG`);
for (const mob of Object.keys(known.mismatch)) ok(failing.includes(mob), `tools/mobl3-known.json lists ${mob} but it now renders pixel-identical — remove it (ratchet only goes down)`);
const totalKeys = Object.values(live).reduce((s, r) => s + r.keys.length, 0), totalPx = Object.values(live).reduce((s, r) => s + r.px, 0);
ok(totalKeys >= known.minKeys, `only ${totalKeys} texture keys rendered (ratchet ${known.minKeys})`);
ok(totalPx > 200000, `too few pixels compared: ${totalPx}`);
// #1753: a texture FAMILY is judged key by key. Shulker's 16 dyed sheets are COLORED_TEXTURES[DyeColor id] = "shulker#<id+1>"
// (Sh.skinKey): the jar sheet each key points at must be shulker_<dye>.png in DyeColor id order, which the pixel join alone cannot tell
const DYE_IDS = readFileSync(join(MCLITE_ROOT, 'tools', 'golden', 'dye-colours-1.18.2.tsv'), 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t')[0]);
const shulkerSheets = (pathOf) => DYE_IDS.filter((d, i) => pathOf('shulker#' + (i + 1)) !== `assets/minecraft/textures/entity/shulker/shulker_${d}.png`);
if (!ONLY || ONLY === 'shulker') {
  ok(DYE_IDS.length === 16, `dye-colours tsv lists ${DYE_IDS.length} dyes, not 16`);
  ok(!live.shulker || live.shulker.keys.length === 17, `shulker: ${live.shulker && live.shulker.keys.length} texture keys judged, want the undyed + 16 dyed`);
  ok(shulkerSheets(sheetPathFor).length === 0, `shulker#k does not point at shulker_<dye>.png in DyeColor order: ${shulkerSheets(sheetPathFor).join(', ')}`);
}
for (const [mob, r] of Object.entries(live)) ok(r.keys.length > 0, `${mob}: nothing rendered (${r.unjoined.join('; ')})`);
for (const [mob, r] of Object.entries(live)) ok(r.unjoined.length === 0, `${mob}: ${r.unjoined.length} texture keys unjoined (#2717): ${r.unjoined.join('; ')}`);

// ── #1848: the ender dragon's CHAINED pose: 5 neck draws, head, 12 tail draws, body roll, root pitch, wing/leg clock ─────────
// DragonEntityModel.render() (.decomp EnderDragonEntityRenderer :339-450) transcribed on the VANILLA side from a fixed set of
// segment properties (a closed-form ring buffer, seg7 yaw 0: the renderer's own -seg7.yaw is not ported, ER.dragonAnim header),
// the same properties handed to the engine's ER.dragonAnim. Compared quad-for-quad (six views) like the rest pose.
const DEG = Math.PI / 180, fwd = (d) => { d %= 360; if (d >= 180) d -= 360; if (d < -180) d += 360; return d; };
const segF = (n) => 14 * Math.sin(n * 0.5 + 0.3) + n;
const SEG = (n) => [segF(n) - segF(7), 90 + 3 * Math.sin(n * 0.6) + 0.4 * n, 0];   // [yaw, y, z] of getSegmentProperties(n)
const NECK_PITCH = (i, a, b) => (i === 6 ? 0 : b[1] - a[1]);   // getChangeInNeckPitch, the default branch (no portal/sitting phase)
const dragonRig = { prevWingPosition: 3.1, wingPosition: 3.4, getSegmentProperties: (n) => SEG(n), getChangeInNeckPitch: NECK_PITCH };
function dragonVanQuads(root, img, vo = {}) {
  const sp = vo.sp || SEG, t = 0.5, wing = dragonRig.prevWingPosition + (dragonRig.wingPosition - dragonRig.prevWingPosition) * t, tau = wing * Math.PI * 2;
  let b = Math.sin(tau - 1) + 1; b = (b * b + b * 2) * 0.05;
  const kid = (n) => root.kids[root.names.indexOf(n)], clone = (p, xf) => Object.assign(Object.create(Object.getPrototypeOf(p)), p, { xf: { p: xf.p, r: xf.r } });
  const s6 = sp(6), d15 = fwd(sp(5)[0] - sp(10)[0]), d16 = fwd(sp(5)[0] + d15 / 2), pitch = (sp(5)[1] - sp(10)[1]) * 10 * DEG;
  const draws = [], neck = kid('neck'), head = clone(kid('head'), kid('head').xf);
  const jaw = head.kids.findIndex((_, i) => head.names[i] === 'jaw');
  head.kids = head.kids.map((k, i) => (i === jaw ? clone(k, { p: k.xf.p, r: [(Math.sin(tau) + 1) * 0.2, k.xf.r[1], k.xf.r[2]] }) : k));
  let px = 0, py = 20, pz = -12;
  for (let i = 0; i < 5; i++) {
    const s = sp(5 - i), ry = fwd(s[0] - s6[0]) * DEG * 1.5, rx = Math.cos(i * 0.45 + tau) * 0.15 + NECK_PITCH(i, s6, s) * DEG * 1.5 * 5, rz = -fwd(s[0] - d16) * DEG * 1.5;
    draws.push(clone(neck, { p: [px, py, pz], r: [rx, ry, rz] }));
    py += Math.sin(rx) * 10; pz -= Math.cos(ry) * Math.cos(rx) * 10; px -= Math.sin(ry) * Math.cos(rx) * 10;
  }
  const s0 = sp(0);
  head.xf = { p: [px, py, pz], r: [fwd(NECK_PITCH(6, s6, s0)) * DEG * 1.5 * 5, fwd(s0[0] - s6[0]) * DEG, -fwd(s0[0] - d16) * DEG] };
  draws.push(head);
  const rest = ['body', 'left_wing', 'right_wing', 'left_front_leg', 'right_front_leg', 'left_hind_leg', 'right_hind_leg'].map(kid);
  const lw = [0.125 - Math.cos(tau) * 0.2, -0.25, -(Math.sin(tau) + 0.125) * 0.8], tipRoll = (Math.sin(tau + 2) + 0.5) * 0.75;
  const posed = rest.map((p) => {
    const n = root.names[root.kids.indexOf(p)], side = n.startsWith('right') ? -1 : 1;
    if (n === 'body') return clone(p, { p: p.xf.p, r: [p.xf.r[0], p.xf.r[1], 0] });
    const leg = n.includes('leg'), hind = n.includes('hind'), lp = hind ? 1.0 : 1.3;
    const q = clone(p, { p: p.xf.p, r: leg ? [lp + b * 0.1, p.xf.r[1], p.xf.r[2]] : [lw[0], lw[1] * side, lw[2] * side] });
    // every tip / foot is a child; wing tip rolls, leg tips and feet pitch (setLimbRotation)
    const tipP = hind ? [0.5 + b * 0.1, 0.75 + b * 0.1] : [-0.5 - b * 0.1, 0.75 + b * 0.1];
    const deep = (k, f) => (k.names.length ? Object.assign(clone(k, k.xf), { kids: k.kids.map((c, i) => f(c, k.names[i])) }) : k);
    return deep(q, (c) => leg ? deep(clone(c, { p: c.xf.p, r: [tipP[0], c.xf.r[1], c.xf.r[2]] }), (f) => clone(f, { p: f.xf.p, r: [tipP[1], f.xf.r[1], f.xf.r[2]] }))
                              : clone(c, { p: c.xf.p, r: [c.xf.r[0], c.xf.r[1], tipRoll * side] }));
  });
  const grpB = { xf: { p: [0, -16, 0], r: [0, 0, 0] }, boxes: [], kids: posed, names: posed.map((p) => root.names[root.kids.findIndex((k) => k.boxes === p.boxes)]) };   // part names for the hidden lookup
  const grpA = { xf: { p: [0, 16, 0], r: [0, 0, -d15 * 1.5 * DEG] }, boxes: [], kids: [grpB], names: ['grpB'] };
  draws.push(grpA);
  let tp = 0; px = 0; py = 10; pz = 60;
  const s11 = sp(11);
  for (let i = 0; i < 12; i++) {
    const s = sp(12 + i); tp += Math.sin(i * 0.45 + tau) * 0.05;
    const ry = (fwd(s[0] - s11[0]) * 1.5 + 180) * DEG, rx = tp + (s[1] - s11[1]) * DEG * 1.5 * 5, rz = fwd(s[0] - d16) * DEG * 1.5;
    draws.push(clone(neck, { p: [px, py, pz], r: [rx, ry, rz] }));
    py += Math.sin(rx) * 10; pz -= Math.cos(ry) * Math.cos(rx) * 10; px -= Math.sin(ry) * Math.cos(rx) * 10;
  }
  const grp = { xf: { p: [0, (b - 2) * 16, -48], r: [b * 2 * DEG, 0, 0] }, boxes: [], kids: draws, names: draws.map((d) => (d === head ? 'head' : d === grpA ? 'grpA' : 'neck')), tw: root.tw, th: root.th };
  // renderer: Rx(pitch*10) about the entity origin, then translate(0,0,1): in the engine frame (yaw pi) that is Rx(-pitch) after rt = [0,0,1]
  const q = vanillaQuads(grp, img, vanHidden('ender_dragon'), undefined, [0, 0, 1]), R = rx(-pitch);
  for (const f of q) f.p = f.p.map((v) => mv(R, v));
  return q;
}
function dragonEngineQuads(img) {
  const layer = 'ender_dragon', anim = { limbSwing: 0, limbSwingAmount: 0, netHeadYaw: 0, headPitch: 0, ageInTicks: 0, dragon: ER.dragonAnim(dragonRig, 0.5) };
  const n = ER.mobQuadCount(layer) + 17 * 60, buf = MS.allocBuffer(0, 0, 0, [n, 0, 0]), hdr = MS.readHeader(buf), w = new Uint32Array(buf, hdr.modelOff[0], n * 16);
  const end = ER.emitMobLayer(w, 0, layer, 0, 0, 0, Math.cos(Math.PI), Math.sin(Math.PI), 15, 0, 3, anim, ER.basePoseFor(layer), undefined, 0, null, null, undefined), out = [];
  for (let q = 0; q < end / 16; q++) {
    const p = [], uv = []; let tile = 0;
    for (let c = 0; c < 4; c++) { const o = q * 16 + c * 4, v = MS.unpackModelVertex(w[o], w[o + 1], w[o + 2], w[o + 3]); p.push([v.px / U, v.py / U, v.pz / U]); uv.push([v.u / 16, v.v / 16]); tile = v.tile; }
    out.push({ p, uv, tile, tiles: tilesReal });
  }
  return out;
}
const dragonImg = jarImg(sheetPathFor('ender_dragon')), dragonRoot = VAN['ender_dragon'];
const dragonEng = dragonEngineQuads(), dragonRun = (vo) => compare(dragonVanQuads(dragonRoot, dragonImg, vo), dragonEng);
const dragonOk = dragonRun();
console.log(`  ${dragonOk.mism > dragonOk.px / 5000 ? '✗' : '✓'} ender_dragon posed chain (5 neck, head, 12 tail, roll, pitch, wings): ${dragonOk.px} px, ${dragonOk.mism} mismatched, ${dragonOk.band} in the edge band`);
// the engine rounds every vertex of each of the 17 neck copies and the rotated wings to 1/256 block AFTER composing; a grazing membrane texel can flip, so up to 0.02% of pixels may differ (the breaks below move 1.5%+)
ok(dragonOk.mism <= dragonOk.px / 5000 && dragonOk.px > 5000, `ender_dragon posed chain: ${dragonOk.mism} px differ from the .decomp DragonEntityModel (${dragonOk.px} compared)`);
ok(dragonEng.length > 17 * 6, `ender_dragon posed chain emitted only ${dragonEng.length} quads`);

// ── deliberate breaks (D-30): each corrupts one input of a CLEAN mob and must produce mismatches ────────────────
let caught = 0;
{ const f = fangsSection(); caught += f.caught; const g = bulletSection(); caught += g.caught; }
const clean = Object.keys(live).filter((m) => !live[m].mism);
const brk = (label, mob, run) => {
  if (!ok(!!mob, `anti-vacuity: no clean mob for "${label}"`)) return;
  const r = run(mob)[mob];
  if (ok(r && r.mism > 0, `anti-vacuity: ${label} (${mob}) NOT caught`)) { caught++; console.log(`   ✓ break caught: ${label} on ${mob} (${r.mism} px)`); }
};
const pick = (f) => clean.find(f) || clean[0];
const baseKey = (mob) => MOBS[mob].find((l) => BE.layer(l));
const cloneRoot = (root, f) => { const c = (p) => { const q = Object.assign(Object.create(Object.getPrototypeOf(p)), p); q.boxes = p.boxes.map((b) => ({ ...b })); q.kids = p.kids.map(c); return q; }; const r = c(root); f(r); return r; };
const firstBoxPart = (p) => (p.boxes.length ? p : p.kids.map(firstBoxPart).find(Boolean));
brk('one packed tile texel flipped under every key', pick(() => true), (mob) => {
  const t = Buffer.from(tilesReal);
  for (const k of texKeysOf(baseKey(mob))) for (const P of geom.layers[k] || []) for (const F of P) for (const s of F || []) {
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) { const o = ((s.tile - geom.tileBase) * TILE * TILE + (s.oy + y) * TILE + s.ox + x) * 4; t[o] ^= 0x40; t[o + 3] = 255; }
  }
  return audit({ only: [mob], tiles: t });
});
brk('vanilla mirror flag inverted on one cuboid', pick(() => true), (mob) => audit({ only: [mob], root: (k) => VAN[k] && !VAN[k].error ? cloneRoot(VAN[k], (r) => { const p = firstBoxPart(r); p.boxes[0].m = !p.boxes[0].m; }) : VAN[k] }));
brk('one part pivot moved 1 px', pick(() => true), (mob) => audit({ only: [mob], root: (k) => VAN[k] && !VAN[k].error ? cloneRoot(VAN[k], (r) => { const p = firstBoxPart(r); p.xf = { p: [p.xf.p[0] + 1, p.xf.p[1], p.xf.p[2]], r: p.xf.r }; }) : VAN[k] }));
brk('texture offset of one cuboid moved 1 texel', pick(() => true), (mob) => audit({ only: [mob], root: (k) => VAN[k] && !VAN[k].error ? cloneRoot(VAN[k], (r) => { const p = firstBoxPart(r); p.boxes[0].tu += 1; }) : VAN[k] }));
brk('cat drawn with the wrong variant sheet', clean.includes('cat') ? 'cat' : null, (mob) => audit({ only: [mob], sheetPath: (n) => sheetPathFor(n === 'cat#3' ? 'cat#4' : n) }));
brk('a rotation dropped (rest pose ignored)', pick((m) => { let has = false; (function w(p) { if (p.xf.r.some((x) => x)) has = true; p.kids.forEach(w); })(VAN[vanLayerOf(baseKey(m), baseKey(m))]); return has; }),
  (mob) => audit({ only: [mob], root: (k) => VAN[k] && !VAN[k].error ? cloneRoot(VAN[k], (r) => { (function w(p) { if (p.xf.r.some((x) => x)) p.xf = { p: p.xf.p, r: [0, 0, 0] }; p.kids.forEach(w); })(r); }) : VAN[k] }));
if (!ONLY || ONLY === 'shulker') {
  if (ok(shulkerSheets((n) => sheetPathFor(n === 'shulker#5' ? 'shulker#6' : n)).length > 0, 'anti-vacuity: swapped shulker#5/#6 sheets NOT caught')) { caught++; console.log('   ✓ break caught: shulker dyed sheet off by one'); }
}
for (const [label, vo] of [['tail yaw property changed', { sp: (n) => (n >= 12 ? [SEG(n)[0] + 9, SEG(n)[1], 0] : SEG(n)) }],
                           ['neck pitch property changed', { sp: (n) => (n >= 1 && n <= 5 ? [SEG(n)[0], SEG(n)[1] + 2, 0] : SEG(n)) }],
                           ['head yaw property changed', { sp: (n) => (n === 0 ? [SEG(n)[0] + 20, SEG(n)[1], 0] : SEG(n)) }],
                           ['root pitch property changed', { sp: (n) => (n === 5 ? [SEG(n)[0], SEG(n)[1] + 0.5, 0] : SEG(n)) }]]) {
  const r = dragonRun(vo);
  if (ok(r.mism > r.px / 5000, `anti-vacuity: dragon ${label} NOT caught`)) { caught++; console.log(`   ✓ break caught: dragon ${label} (${r.mism} px)`); }
}
console.log(`${caught} breaks caught`);
console.log(`\nmobl3check: ${pass} assertions, ${fails.length} failed`);
for (const f of fails) console.log('   ✗ ' + f);
process.exit(fails.length ? 1 : 0);
}

/** every (layer, texture key) of a mob that joins the reference, with the ENGINE raster of its six views, on the frame mobl3check's own compare uses (over [vanilla, engine]) */
export function l3Targets(mob) {
  const out = [];
  for (const layer of MOBS[mob] || []) {
    if (!BE.layer(layer)) continue;
    for (const t of texKeysOf(layer)) {
      const aj = armorJoin(t, layer), eL = aj ? aj.layer : t === 'slime_outer' ? t : layer;   // #1869: its own box list
      const vk = aj ? aj.vk : vanLayerOf(t, layer), root = VAN[vk], sp = sheetPathFor(t), img = sp && jarImg(sp);
      const eq = engineQuads(eL, t === eL ? undefined : t, tilesReal); if (!eq) continue;
      const vq = root && !root.error && img ? vanillaQuads(root, img, vanHidden(eL), TINT[t], ER.RENDER_TRANSLATE[layer.split("#")[0]], isCart(eL), eL === 'llama_spit', !!ER.MIRROR_ONLY[eL.split('#')[0]], eL === 'trident') : [];
      const views = VIEWS.map((V) => {
        const F = frame([vq, eq], V), b = raster(eq, F), cov = new Uint8Array(F.W * F.H);
        for (let o = 0; o < cov.length; o++) cov[o] = b.z[o] > -Infinity ? 1 : 0;
        return { name: V[0], n: V[1], R: V[2], Up: V[3], r0: F.r0, u1: F.u1, W: F.W, H: F.H, col: b.col, edge: b.edge, cov };
      });
      out.push({ layer: eL, texKey: t === eL ? undefined : t, key: t, views });
    }
  }
  return out;
}
/** the GPU's pixels (RGBA, row 0 = top, cleared to 0,0,0,0) against one engine view: coverage must agree, RGB within 1/255 (the shader's float multiply); a mismatch inside view.edge is band */
export function compareGpu(view, rgba) {
  const N = view.W * view.H, diff = new Uint8Array(N); let px = 0, mism = 0, band = 0;
  for (let o = 0; o < N; o++) {
    const ca = view.cov[o] === 1, cb = rgba[o * 4 + 3] > 0;
    if (!ca && !cb) continue;
    px++;
    let same = ca === cb;
    if (same) for (let c = 0; c < 3; c++) if (Math.abs(view.col[o * 4 + c] - rgba[o * 4 + c]) > 1) same = false;
    if (same) continue;
    if (view.edge[o]) { band++; diff[o] = 2; } else { mism++; diff[o] = 1; }
  }
  return { px, mism, band, diff };
}
/** views: [{W, H, col (engine), gpu (rgba), diff}] -> engine | gpu | diff, stacked per view (red mismatch, yellow band) */
export function gpuDiffPng(path, views) {
  const W = Math.max(...views.map((v) => v.W)) * 3 + 8, Hh = views.reduce((s, v) => s + v.H + 4, 0), img = new Uint8Array(W * Hh * 4);
  let y0 = 0;
  for (const v of views) {
    for (let y = 0; y < v.H; y++) for (let x = 0; x < v.W; x++) {
      const o = y * v.W + x;
      img.set(v.col.subarray(o * 4, o * 4 + 4), ((y0 + y) * W + x) * 4);
      img.set(v.gpu.subarray(o * 4, o * 4 + 4), ((y0 + y) * W + (v.W + 4) + x) * 4);
      const d = ((y0 + y) * W + 2 * (v.W + 4) + x) * 4;
      if (v.diff[o] === 1) img.set([255, 0, 0, 255], d); else if (v.diff[o] === 2) img.set([255, 220, 0, 255], d);
      else if (v.col[o * 4 + 3]) img.set([80, 80, 80, 255], d);
    }
    y0 += v.H + 4;
  }
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, encodePng(W, Hh, img, { palette: false }));
  return path;
}
/** one `bug,mobs` issue per mob, de-duplicated by title "L3 render: <mob> "; rows[mob] = { mism, worst: { t } }, opt.source = 'node' | 'webgl2' | 'webgpu' */
export async function fileBugs(mobs, rows, opt = {}) {
  const source = opt.source || 'node', repro = source === 'node' ? '`node tools/mobl3check.mjs --mob <mob>` (writes the diff PNG to assets/l3/)' : `the ${source} texture audit job (tools/texauditjob.mjs); the diff PNG is in its status folder`;
  const tok = process.env.GH_TOKEN || process.env.GITHUB_TOKEN; if (!tok) { console.log('  --file: no GH_TOKEN, nothing filed'); return; }
  const api = (m, p, b) => fetch('https://api.github.com/repos/owner/mclite' + p, { method: m, headers: { authorization: 'Bearer ' + tok, accept: 'application/vnd.github+json' }, body: b ? JSON.stringify(b) : undefined }).then((r) => r.json());
  const open = await api('GET', '/issues?state=open&labels=mobs&per_page=100');
  for (const mob of mobs) {
    const what = source === 'node' ? 'the jar+.decomp reference' : `the engine raster (${source} GPU)`;
    const title = `L3 render: ${mob} — ${rows[mob].mism} px differ from ${what}`;
    if ((open || []).some((i) => i.title.startsWith(`L3 render: ${mob} `))) { console.log(`  --file: ${mob} already filed`); continue; }
    const i = await api('POST', '/issues', { title, labels: ['bug', 'mobs'], body: `mobl3check (GATE M L3, #1507), source ${source}: ${rows[mob].mism} pixels outside the edge band differ, worst texture key ${rows[mob].worst.t}.\n\nReproduce: ${repro.replace('<mob>', mob)}.\n\nPart of #1507.` });
    console.log(`  --file: filed #${i.number} ${title}`);
  }
}
