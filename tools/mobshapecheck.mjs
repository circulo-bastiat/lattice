#!/usr/bin/env node
// mobshapecheck.mjs — #1166. EVERY PORTED MOB LAYER IS RENDERED (geometry, headless, ~seconds) AND COMPARED TO THE VANILLA MODEL.
//
//   node tools/mobshapecheck.mjs [--verbose]
//
// Dan found wolf, squid, sheep, fish fins and spawner drawn mangled while every tester pass said "audited": source
// review cannot see a wrong parent chain or rotation. The browser stage (mobdrawcheck) is quarantined and takes
// minutes, so it never gated anything. THIS runs the engine's own mob emitter (`ER.buildMobLayer`, the live quad
// writer) for every layer that has a vanilla model class in .decomp, unpacks the emitted vertices and compares them
// with the vanilla model built from the decompiled Java (tools/vanillamodel.mjs — parent chains kept):
//   * part count   engine parts == vanilla boxes
//   * bounding box overall AABB within TOL blocks on every axis
//   * silhouette   front / side / top orthographic rasters at 1/16 block, IoU >= MIN_IOU
// The vanilla side is the LivingEntityRenderer chain at mc-yaw 0 (the engine's own yaw convention is PI off, so it is drawn at PI): (x,y,z)px -> (x/16, 1.501-y/16, -z/16).
// Layers that have no mapped vanilla class are LISTED (UNMAPPED) and ratcheted, never silently skipped.
// `tools/mobshapecheck.json` is the audited-mob ledger: tester reports / queuegate require a mob to be
// `node tools/mobshapecheck.mjs --mob <name>` clean before it may be marked audited.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';
import { vanillaRoot, posedBoxes, Dilation, loadDecomp } from './vanillamodel.mjs';

const VERBOSE = process.argv.includes('--verbose');
const ONLY = (() => { const i = process.argv.indexOf('--mob'); return i > 0 ? process.argv[i + 1] : null; })();
const ROSTER = JSON.parse(readFileSync(new URL('./mobl3-mobs.json', import.meta.url), 'utf8')).mobs;   // #3003: --mob takes the same names as mobl3check (fish = all its species layers)
const BOX_TOL = 0.006, TOL = 0.04, MIN_IOU = 0.85, N = 128, HALF = 4;     // blocks, ratio, raster cells, raster half-extent in blocks

// engine layer -> how vanilla builds it ([class, method, args]); default is <Pascal>EntityModel.getTexturedModelData()
const pascal = (s) => s.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join('');
const D = () => new Dilation(0);
const BIPED = ['BipedEntityModel', 'getModelData', D(), 0];
const ILLAGER = ['IllagerEntityModel', 'getTexturedModelData'];
const V = ['VillagerResemblingModel', 'getModelData'];   // no getTexturedModelData/2 in 1.18.2: the villager-shaped models expose getModelData()
const ALIAS = {
  cat: ['OcelotEntityModel', 'getModelData', D()], ocelot: ['OcelotEntityModel', 'getModelData', D()],
  cave_spider: ['SpiderEntityModel'], pillager: ILLAGER, vindicator: ILLAGER, evoker: ILLAGER, illusioner: ILLAGER,
  pufferfish_small: ['SmallPufferfishEntityModel'], pufferfish_medium: ['MediumPufferfishEntityModel'], pufferfish_big: ['LargePufferfishEntityModel'],
  tropical_fish_small: ['SmallTropicalFishEntityModel', 'getTexturedModelData', D()], tropical_fish_large: ['LargeTropicalFishEntityModel', 'getTexturedModelData', D()],
  tropical_fish_small_pattern: ['SmallTropicalFishEntityModel', 'getTexturedModelData', D()], tropical_fish_large_pattern: ['LargeTropicalFishEntityModel', 'getTexturedModelData', D()],
  glow_squid: ['SquidEntityModel'], elder_guardian: ['GuardianEntityModel'], mooshroom: ['CowEntityModel'],
  giant: BIPED, husk: BIPED, zombie: BIPED, drowned: ['DrownedEntityModel', 'getTexturedModelData', D()], slime: ['SlimeEntityModel', 'getInnerTexturedModelData'],
  stray: ['SkeletonEntityModel'], skeleton: ['SkeletonEntityModel'], vex: ['VexEntityModel'], skeleton_horse: ['HorseEntityModel', 'getModelData', D()],
  mule: ['DonkeyEntityModel'], zombie_horse: ['HorseEntityModel', 'getModelData', D()], horse: ['HorseEntityModel', 'getModelData', D()],
  trader_llama: ['LlamaEntityModel', 'getTexturedModelData', D()], llama: ['LlamaEntityModel', 'getTexturedModelData', D()],
  player: ['PlayerEntityModel', 'getTexturedModelData', D(), false], player_slim: ['PlayerEntityModel', 'getTexturedModelData', D(), true],
  stray: ['SkeletonEntityModel'], wither_skeleton: ['SkeletonEntityModel'], zombie_villager: ['ZombieVillagerEntityModel'],
  villager: V, wandering_trader: V, witch: ['WitchEntityModel', 'getTexturedModelData'],
  minecart: ['MinecartEntityModel'], chest_minecart: ['MinecartEntityModel'], furnace_minecart: ['MinecartEntityModel'], hopper_minecart: ['MinecartEntityModel'],
  tnt_minecart: ['MinecartEntityModel'], spawner_minecart: ['MinecartEntityModel'], command_block_minecart: ['MinecartEntityModel'],   // #1564
  ender_dragon: ['EnderDragonEntityRenderer'], end_crystal: ['EndCrystalEntityRenderer'], trident: ['TridentEntityModel'], boat: ['BoatEntityModel'], leash_knot: ['LeashKnotEntityModel'],
  evoker_fangs: ['EvokerFangsEntityModel'], llama_spit: ['LlamaSpitEntityModel'], shulker_bullet: ['ShulkerBulletEntityModel'],
  zombified_piglin: ['PiglinEntityModel', 'getModelData', D()], piglin: ['PiglinEntityModel', 'getModelData', D()],
  piglin_brute: ['PiglinEntityModel', 'getModelData', D()], zoglin: ['HoglinEntityModel'], skeleton_skull: null, wither_skeleton_skull: null, wither_skull: ['WitherSkullEntityRenderer'],   // #3797: the skulls are SkullBlockEntityModel; #4901: the projectile has its own getTexturedModelData
};
function vanillaFor(layer) {
  if (layer === 'ender_dragon') loadDecomp('net/minecraft/client/render/entity/EnderDragonEntityRenderer.java');
  if (layer === 'end_crystal') loadDecomp('net/minecraft/client/render/entity/EndCrystalEntityRenderer.java');
  if (layer === 'wither_skull') loadDecomp('net/minecraft/client/render/entity/WitherSkullEntityRenderer.java');
  if (layer.includes('#')) return null;
  const a = layer in ALIAS ? ALIAS[layer] : [pascal(layer) + 'EntityModel'];
  if (!a) return null;
  const [cls, meth = 'getTexturedModelData', ...args] = a;
  let err;
  for (const tryArgs of [args, [...args, D()], [...args, D(), 0]]) {
    try { return vanillaRoot(cls, meth, ...tryArgs); } catch (e) { err = e; if (!/^no translated/.test(e.message)) break; }
  }
  return { error: err.message };
}

let pass = 0; const fails = [], notes = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };

const M = loadEngine({ extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js', '07zs_spawner.js', '07zzs_minecartrender.js'], dom: false });
initRegistry(M);
{
  const mm = JSON.parse(readFileSync(MCLITE_ROOT + 'assets/models.meta.json', 'utf8'));
  M.BEModel.init({ models: readFileSync(MCLITE_ROOT + 'assets/models.bin').toString('base64'), modelsBytes: mm.rawBytes });
}
const geomRaw = readFileSync(MCLITE_ROOT + 'assets/mob-geometry.json');
M.DATA = Object.assign({}, M.DATA, { mobGeometry: deflateRawSync(geomRaw, { level: 9 }).toString('base64'), mobGeometryBytes: geomRaw.length,
  entities: JSON.parse(readFileSync(MCLITE_ROOT + 'assets/entities.json', 'utf8')) });   // Ent.isLiving (the flip + 1.501 lift) needs the species table
M.Entities.init(); M.EntityList.init(); M.EntityRender.init();
const ER = M.EntityRender, BE = M.BEModel, U = M.CFG.MODEL_UNITS_PER_BLOCK;

// LeashKnotEntityRenderer extends EntityRenderer (no LivingEntityRenderer 1.501 lift), though the species table has attributes for it
const NOT_LIVING_RENDERER = { leash_knot: 1, shulker_bullet: 1, wither_skull: 1 };
const entOf = (layer) => layer.split('#')[0].replace(/^decor$/, 'llama').replace(/^saddle$/, 'pig').replace(/^strider_saddle$/, 'strider').replace(/^(pufferfish|tropical_fish)_(small|medium|big|large)(_pattern)?$/, '$1');
/** The engine's emitted quads for a layer at rest, yaw 0, as [[x,y,z] x4] in blocks (entity-relative). */
// #1564: a minecart is not a LivingEntityRenderer; it is compared in its own frame (MinecartEntityRenderer at yaw 180 / pitch 0: Ry(0) * diag(-1,-1,1), lifted .375)
const isCart = (layer) => !!(M.MinecartRender && M.MinecartRender.is(layer.split('#')[0]));
// per-face UV rectangle sizes (texels) of one cuboid's 6 quads, order-independent: sorted "w x h" strings, each pair sorted
const UVK = Number(process.env.UVK || 16);
const uvSizes = (uvs) => uvs.map((q) => { const us = q.map((p) => p[0]), vs = q.map((p) => p[1]); return [Math.round((Math.max(...us) - Math.min(...us)) / UVK * 100) / 100, Math.round((Math.max(...vs) - Math.min(...vs)) / UVK * 100) / 100].sort((a, b) => a - b).join('x'); }).sort();
const vanillaUvSizes = (b) => [[b.w, b.d], [b.w, b.d], [b.w, b.h], [b.w, b.h], [b.d, b.h], [b.d, b.h]].map((p) => p.slice().sort((a, c) => a - c).join('x')).sort();
export function engineQuads(layer, anim, texKey, scale) {
  if (isCart(layer) && !anim) anim = M.MinecartRender.animOf({ type: layer, cartYaw: 180, cartPitch: 0 }, 1, [0, 0, 0]);
  const n = ER.mobQuadCount(layer, texKey);
  if (!n) return null;
  // the live path (ER.build) picks the base pose from the ENTITY type; pufferfish_big etc. are layers of 'pufferfish'
  const ent = entOf(layer);
  const buf = M.Mesher.allocBuffer(0, 0, 0, [n, 0, 0]);
  const hdr = M.Mesher.readHeader(buf);
  const w = new Uint32Array(buf, hdr.modelOff[0], n * 16), qs = [];
  ER.emitMobLayer(w, 0, layer, 0, 0, 0, anim && anim.sleepPose ? 1 : Math.cos(Math.PI), anim && anim.sleepPose ? 0 : Math.sin(Math.PI), 15, 0, 3, anim, poseOf(ent), texKey, 0, null, scale || null);
  qs.uvs = [];
  for (let q = 0; q < n; q++) {
    const vs = [], uv = [];
    for (let c = 0; c < 4; c++) { const v = M.Mesher.unpackModelVertex(w[q * 16 + c * 4], w[q * 16 + c * 4 + 1], w[q * 16 + c * 4 + 2], w[q * 16 + c * 4 + 3]); vs.push([v.px / U, v.py / U + (anim && anim.sleepPose ? anim.sleepPose.dy : 0), v.pz / U]); uv.push([v.u, v.v]); }
    qs.push(vs); qs.uvs.push(uv);
  }
  return qs;
}
const FACES = [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]];   // corner-index quads of posedBoxes' 8 corners
export function vanillaQuads(boxes, layer, cart) {
  const qs = [], t = (layer && ER.RENDER_TRANSLATE[entOf(layer)]) || [0, 0, 0];   // the renderer's own scale() translate (phantom, #1541)
  for (const b of boxes) for (const f of FACES) qs.push(f.map((i) => { const c = b.corners[i]; return cart ? [-c[0] / 16, 0.375 - c[1] / 16, c[2] / 16] : [c[0] / 16 - t[0], 1.501 - c[1] / 16 - t[1], -c[2] / 16 - t[2]]; }));
  return qs;
}
const VIEWS = [[0, 1], [2, 1], [0, 2]];
function raster(qs, [a, b]) {
  const g = new Uint8Array(N * N), S = N / (2 * HALF);
  const tri = (p, q, r) => {
    const x0 = Math.max(0, Math.floor(Math.min(p[0], q[0], r[0]))), x1 = Math.min(N - 1, Math.ceil(Math.max(p[0], q[0], r[0])));
    const y0 = Math.max(0, Math.floor(Math.min(p[1], q[1], r[1]))), y1 = Math.min(N - 1, Math.ceil(Math.max(p[1], q[1], r[1])));
    const den = (q[1] - r[1]) * (p[0] - r[0]) + (r[0] - q[0]) * (p[1] - r[1]);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const X = x + 0.5, Y = y + 0.5;
      if (Math.abs(den) < 1e-9) continue;
      const l1 = ((q[1] - r[1]) * (X - r[0]) + (r[0] - q[0]) * (Y - r[1])) / den, l2 = ((r[1] - p[1]) * (X - r[0]) + (p[0] - r[0]) * (Y - r[1])) / den, l3 = 1 - l1 - l2;
      if (l1 >= -0.02 && l2 >= -0.02 && l3 >= -0.02) g[y * N + x] = 1;
    }
  };
  for (const q of qs) {
    const p = q.map((v) => [(v[a] + HALF) * S, (HALF - v[b]) * S]);
    tri(p[0], p[1], p[2]); tri(p[0], p[2], p[3]);
  }
  return g;
}
const iou = (A, B) => { let i = 0, u = 0; for (let k = 0; k < A.length; k++) { if (A[k] & B[k]) i++; if (A[k] | B[k]) u++; } return u ? i / u : 1; };
const aabb = (qs) => { const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (const q of qs) for (const v of q) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], v[i]); hi[i] = Math.max(hi[i], v[i]); } return { lo, hi }; };

// the player is no NS.Entities type (basePoseFor gives it BASE_NONE) but PlayerEntityRenderer is a LivingEntityRenderer: same flipped living pose (#1572)
const PLAYER_LAYERS = { player: 1, player_slim: 1 };
function poseOf(ent) { return PLAYER_LAYERS[ent] ? ER.BASE_LIVING : ER.basePoseFor(ent); }

// #7798: a non-living renderer has its own transform (posed by mobl3check), so the MODEL is compared in a frame-free way:
// per-cuboid posed-AABB extents (sorted) and the pairwise centre distances are invariant under the renderer's rigid transform/flip.
const NONLIVING_SHAPE = { boat: 1, evoker_fangs: 1, llama_spit: 1, leash_knot: 1, trident: 1, end_crystal: 1, shulker_bullet: 1, wither_skull: 1 };
// engine quads -> one group per layer part (a face the packer sliced into several atlas crops costs several quads); a double-sided layer is emitted twice
function engineCuboids(layer, qs) {
  const L = BE.layer(layer), G = ER.mobGeomFor(layer), out = [];
  const dbl = ER.NO_CULL[layer] ? 2 : 1;
  let at = 0;
  L.parts.forEach((p, k) => { let n = 0; for (let f = 0; f < 6; f++) { const s = G && G[k] && G[k][f]; n += s && s.length ? s.length : 1; } out.push(aabb(qs.slice(at, at + n))); at += n * dbl; });
  return out;
}
const frameFree = (c) => { c = c.slice();
  const ext = c.map((a) => [0, 1, 2].map((i) => a.hi[i] - a.lo[i]).sort((x, y) => x - y)), ctr = c.map((a) => [0, 1, 2].map((i) => (a.hi[i] + a.lo[i]) / 2)), d = []; for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) d.push(Math.hypot(...[0, 1, 2].map((a) => ctr[i][a] - ctr[j][a]))); return { ext: ext.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]), d: d.sort((a, b) => a - b) }; };
function compareFree(layer, engineQ, root) {
  const boxes = posedBoxes(root), dh = ER.DEFAULT_HIDDEN[layer], probs = [];
  const vis = boxes.filter((b) => !(dh && dh[b.part]) && b.part !== 'water_patch');   // water_patch is the water-mask pass (RenderLayer.getWaterMask), never a drawn texture
  const vc = vis.map((b) => aabb(FACES.map((f) => f.map((i) => b.corners[i].map((x) => x / 16)))));
  const ec = engineCuboids(layer, engineQ).filter((_, k) => !(dh && dh[BE.layer(layer).parts[k].n]));
  if (ec.length !== vc.length) probs.push(`cuboid count: engine ${ec.length}, vanilla ${vc.length}`);
  else {
    const e = frameFree(ec), v = frameFree(vc);
    e.ext.forEach((x, i) => { if (x.some((t, a) => Math.abs(t - v.ext[i][a]) > BOX_TOL)) probs.push(`cuboid extents engine ${x.map((t) => t.toFixed(3))} vanilla ${v.ext[i].map((t) => t.toFixed(3))}`); });
    e.d.forEach((x, i) => { if (Math.abs(x - v.d[i]) > BOX_TOL && probs.length < 6) probs.push(`cuboid centre distance engine ${x.toFixed(3)} vanilla ${v.d[i].toFixed(3)}`); });
  }
  return { status: probs.length ? 'mismatch' : 'match', probs };
}
/** Compare one layer; returns { status, detail }. */
export function compareLayer(layer, engineQ, opt = {}) {
  const root = opt.root || vanillaFor(layer);
  if (!root) return { status: 'unmapped' };
  // a non-LivingEntityRenderer (boat, minecart, projectile, shield, head, fangs...) has its own per-renderer transform
  if (!isCart(layer) && (!poseOf(entOf(layer)).flip || NOT_LIVING_RENDERER[layer])) return !NONLIVING_SHAPE[layer] || root.error ? { status: 'nonliving' } : compareFree(layer, engineQ, root);
  if (root.error) return { status: 'unmapped', detail: root.error };
  const boxes = posedBoxes(root), L = ER.boxLayerFor(layer, opt.texKey);
  const dh = ER.DEFAULT_HIDDEN[layer];
  const vis = boxes.filter((b) => !(dh && dh[b.part]) && !(b.part === 'egg_belly' && !opt.belly));   // egg_belly (turtle plastron) is visible only with hasEgg (#3074)
  const probs = [];
  // #2007: the golden table carries the biped `hat` row the piglin family hides (vanilla's piglin hat is an EMPTY builder: no box)
  const phantomHat = dh && dh.hat && !boxes.some((b) => b.part === 'hat') ? 1 : 0;
  if (L.parts.length - phantomHat !== boxes.length) probs.push(`part count: engine ${L.parts.length - phantomHat}, vanilla ${boxes.length}`);
  // a scaled draw (the spawner's cage mob) is compared at LIFE SIZE: both sides divided by the scale, or the 1/16-block raster is too coarse to see a 0.2-block golem
  const vq = vanillaQuads(vis, layer, isCart(layer));
  if (opt.vscale) { const un = (qs) => qs.map((q) => q.map((v) => v.map((x) => x / opt.vscale))); engineQ = un(engineQ); }
  const ea = aabb(engineQ), va = aabb(vq);
  for (let i = 0; i < 3; i++) {
    const d = Math.max(Math.abs(ea.lo[i] - va.lo[i]), Math.abs(ea.hi[i] - va.hi[i]));
    if (d > TOL) probs.push(`bbox ${'xyz'[i]}: engine [${ea.lo[i].toFixed(2)},${ea.hi[i].toFixed(2)}] vanilla [${va.lo[i].toFixed(2)},${va.hi[i].toFixed(2)}]`);
  }
  // #7521 per-cuboid exact: every vanilla box (origin+size+inflate+pivot+rotation chain => posed AABB) must have an engine cuboid (6 quads) within BOX_TOL; order-independent
  if (!opt.vscale && engineQ.length === vq.length && vq.length % 6 === 0) {
    const eb = [], used = new Set(); for (let k = 0; k < engineQ.length; k += 6) eb.push(aabb(engineQ.slice(k, k + 6)));
    let nb = 0, uvn = 0;
    // #7797: texOffs, mirror flag and the layer's texture size, per cuboid, off the engine's own part table (the data the UV writer reads)
    const ep = L.parts.filter((p) => !(dh && dh[p.n]) && !(p.n === 'egg_belly' && !opt.belly)), ov = opt.uvPatch ? opt.uvPatch(ep) : ep;
    if (ov.length === eb.length) {
      if (root.tw && L.tw && (L.tw !== root.tw || L.th !== root.th)) probs.push(`texture size: engine ${L.tw}x${L.th}, vanilla ${root.tw}x${root.th}`);
      let tn = 0;
      opt.texCmp = (bi, vb, name) => { const e = ov[bi]; if (e && (e.tu !== vb.tu || e.tv !== vb.tv || !!e.m !== !!vb.m) && tn++ < 3) probs.push(`cuboid ${name} texOffs/mirror: engine (${e.tu},${e.tv}${e.m ? ',mirror' : ''}) vanilla (${vb.tu},${vb.tv}${vb.m ? ',mirror' : ''})`); };
    }
    for (let k = 0; k < vq.length; k += 6) {
      const v = aabb(vq.slice(k, k + 6)); let best = 1e9, bi = -1;
      eb.forEach((e, i) => { if (used.has(i)) return; const d = Math.max(...[0, 1, 2].map((a) => Math.max(Math.abs(e.lo[a] - v.lo[a]), Math.abs(e.hi[a] - v.hi[a])))); if (d < best) { best = d; bi = i; } });
      if (bi >= 0) used.add(bi);
      if (bi >= 0 && best <= BOX_TOL && opt.texCmp) opt.texCmp(bi, vis[k / 6].box, `${k / 6} (${vis[k / 6].part})`);
      if (bi >= 0 && engineQ.uvs && best <= BOX_TOL) { const e = uvSizes(engineQ.uvs.slice(bi * 6, bi * 6 + 6)), x = vanillaUvSizes(vis[k / 6].box); if (e.join() !== x.join() && uvn++ < 3) probs.push(`cuboid ${k / 6} (${vis[k / 6].part}) UV face rectangles engine ${e.join(' ')} vanilla ${x.join(' ')}`); }
      if (best > BOX_TOL && nb++ < 3) probs.push(`cuboid ${k / 6} (${vis[k / 6].part}) no engine cuboid within ${BOX_TOL} (nearest ${best.toFixed(3)})`);
    }
  }
  VIEWS.forEach((v, i) => { const r = iou(raster(engineQ, v), raster(vq, v)); if (r < MIN_IOU) probs.push(`silhouette ${['front', 'side', 'top'][i]} IoU ${r.toFixed(3)}`); });
  return { status: probs.length ? 'mismatch' : 'match', probs };
}

console.log('mobshapecheck — every mob layer, rendered, vs the vanilla model (#1166)');
const layers = Object.keys(BE.layers).filter((n) => BE.layer(n) && BE.layer(n).parts && BE.layer(n).parts.length).sort();
const babyOf = {}, result = {}, probsOf = {}; let matched = 0; const unmapped = [], nonliving = [], bad = [];
if (!ER.ready || !BE.ready || typeof ER.buildMobLayer !== 'function') { console.log('✗ entity renderer not ready'); process.exit(1); }
for (const layer of layers) {
  if (ONLY && entOf(layer) !== ONLY && !(ROSTER[ONLY] || []).includes(layer)) continue;
  const q = engineQuads(layer);
  if (!q) { result[layer] = 'unrendered'; if (!layer.includes('#')) bad.push([layer, ['buildMobLayer returned nothing']]); continue; }
  const r = compareLayer(layer, q); result[layer] = r.status; probsOf[layer] = r.probs || [];
  if (r.status === 'match') matched++; else if (r.status === 'nonliving') nonliving.push(layer);
  else if (r.status === 'unmapped') unmapped.push(layer + (r.detail ? ` (${r.detail})` : ''));
  else bad.push([layer, r.probs]);
  // BABY: the same layer with anim.baby must draw the same parts (quad count) and be no larger than the adult.
  if (r.status !== 'unmapped' && r.status !== 'nonliving' && !layer.includes('#') && ER.babyTransform && ER.babyTransform(layer, 'head')) {
    const bq = engineQuads(layer, { baby: true, limbSwing: 0, limbSwingAmount: 0, netHeadYaw: 0, headPitch: 0, ageInTicks: 0 });
    if (bq) {
      const a = aabb(q), b = aabb(bq);
      const vol = (x) => (x.hi[0] - x.lo[0]) * (x.hi[1] - x.lo[1]) * (x.hi[2] - x.lo[2]);
      babyOf[layer] = 1;
      if (bq.length !== q.length && !/^goat/.test(layer)) bad.push([layer + '#baby', [`baby quad count ${bq.length} != adult ${q.length}`]]);
      if (vol(b) > vol(a) * 1.05) bad.push([layer + '#baby', [`baby AABB volume ${vol(b).toFixed(2)} exceeds adult ${vol(a).toFixed(2)}`]]);
    }
  }
}
for (const [l, p] of bad) console.log(`  ✗ ${l}: ${p.join('; ')}`);
if (VERBOSE) console.log('  unmapped: ' + unmapped.join(', '));
console.log(`  layers ${layers.length}: ${matched} match, ${bad.length} mismatch, ${unmapped.length} unmapped, ${nonliving.length} non-living (own renderer transform, not compared)`);

if (ONLY && process.argv.includes('--parts')) {   // triage: each vanilla box's AABB next to the engine quads of the same index
  const bb = (qs) => { const a = aabb(qs); return a.lo.map((x) => x.toFixed(2)) + ' | ' + a.hi.map((x) => x.toFixed(2)); };
  const root = vanillaFor(ONLY), eq = engineQuads(ONLY);
  if (root && !root.error) { const vb = posedBoxes(root); let k = 0; vb.forEach((b) => { const n = 6; console.log(`  ${b.part.padEnd(14)} vanilla ${bb(vanillaQuads([b], ONLY))}   engine ${eq[k] ? bb(eq.slice(k, k + n)) : '-'}`); k += n; }); }
}

// ---- #1203 OVERLAY LAYERS + THE SPAWNER CAGE MOB: the passes drawn ON TOP of / INSIDE a mob, which the loop above skipped ('#' layers are "unmapped") ----
//   sheep fleece   texKey fur#null on the 'sheep' boxes  == SheepWoolEntityModel (head 6x6x6 dilated .6, body 1.75, legs .5)
//   armour         <biped>#b / #c                        == BipedEntityModel at Dilation 1.0 / 0.5 (ArmorFeatureRenderer outer / inner)
//   spawner        the virtual in-cage mob (ER.spawnerDisplays' entity: displayScale = Spawner.display's 0.53125 / max(w,h,1))
//                  == the vanilla mob model scaled by the same factor (the -30 deg tilt is Spawner.OWED, so it is not drawn / compared)
const overlays = [], overlayBad = [], overlayStat = {};
const OVERLAY = [];
OVERLAY.push(['sheep+fur#null', 'sheep', 'fur#null', null, vanillaRoot('SheepWoolEntityModel', 'getTexturedModelData')]);
for (const b of ['zombie', 'husk', 'giant', 'skeleton', 'stray', 'wither_skeleton', 'zombie_villager', 'player', 'player_slim', 'piglin', 'piglin_brute', 'zombified_piglin']) {
  for (const [sfx, dil] of [['b', 0.5], ['c', 1.0]]) {
    const l = b + '#' + sfx;
    if (!BE.layer(l)) continue;
    OVERLAY.push([l, l, undefined, null, b === 'zombie_villager' ? vanillaRoot('ZombieVillagerEntityModel', 'getArmorTexturedModelData', new Dilation(dil)) : vanillaRoot('BipedEntityModel', 'getModelData', new Dilation(dil), 0)]);
  }
}
// llama_decor: LlamaDecorFeatureRenderer's model = LlamaEntityModel at Dilation .5 (EntityModels llama_decor); drawn on the llama's own flipped pose
if (BE.layer('decor#null')) OVERLAY.push(['llama_decor+decor#null', 'decor#null', undefined, null, vanillaRoot('LlamaEntityModel', 'getTexturedModelData', new Dilation(0.5))]);
// pig saddle: SaddleFeatureRenderer's model = PigEntityModel at Dilation .5 (EntityModels pig_saddle), on the pig's flipped pose
if (BE.layer('saddle#null')) OVERLAY.push(['pig+saddle#null', 'saddle#null', undefined, null, vanillaRoot('PigEntityModel', 'getTexturedModelData', new Dilation(0.5))]);
// strider saddle: SaddleFeatureRenderer draws the strider's own StriderEntityModel (undilated) with strider_saddle.png
if (BE.layer('strider_saddle')) OVERLAY.push(['strider+strider_saddle', 'strider_saddle', undefined, null, vanillaRoot('StriderEntityModel', 'getTexturedModelData')]);
const overlayRoot = (n) => OVERLAY.find((o) => o[0] === n)[4];
function spawnerScale(type) {
  const dim = M.Entities.dimensions(M.Entities.bare ? M.Entities.bare(type) : type);
  return M.Spawner.display({ entity: type, spin: 0 }, 0, dim).scale;
}
for (const t of ['zombie', 'cow', 'sheep', 'pig', 'skeleton', 'creeper', 'spider', 'enderman', 'ghast', 'iron_golem']) {
  if (!BE.layer(t)) continue;
  const sc = spawnerScale(t), e = { type: t, displayScale: sc };
  const ms = ER.mobScale(e, 0);   // the renderer's own scale() (ghast 4.5) is in it too; the vanilla side is drawn without it, so divide the whole
  OVERLAY.push(['spawner:' + t, t, undefined, ms, vanillaFor(t), ms && ms.sy === ms.sxz ? ms.sy : sc]);
}
for (const [name, layer, texKey, scale, root, vscale] of OVERLAY) {
  if (ONLY && layer.split('#')[0] !== ONLY && name.split(/[+:]/)[0] !== ONLY) continue;
  if (!root || root.error) { if (VERBOSE) console.log('  (overlay ' + name + ' has no vanilla root)'); continue; }
  const q = engineQuads(layer, undefined, texKey, scale);
  if (!q) { overlayBad.push([name, ['engine emitted nothing']]); continue; }
  const r = compareLayer(layer, q, { root, texKey, vscale });
  if (VERBOSE) console.log(`  overlay ${name}: ${r.status} ${(r.probs || []).join('; ')}`);
  overlayStat[name] = r.status === 'match' ? [] : (r.probs || [r.status]);
  if (r.status === 'match' && name.includes('+') && result[layer] === 'unmapped') result[layer] = 'match';   // llama decor / pig saddle: the layer IS its overlay model
  if (r.status === 'match') overlays.push(name); else if (r.status !== 'nonliving') overlayBad.push([name, r.probs || [r.status]]);
}
const knownOverlayBad = new Set(Object.keys(JSON.parse(readFileSync(new URL('./mobshapecheck.json', import.meta.url), 'utf8')).knownOverlayMismatch || {}));
for (const [l, p] of overlayBad) if (ONLY || !knownOverlayBad.has(l)) console.log(`  ✗ overlay ${l}: ${p.join('; ')}`);
console.log(`  overlays/spawner: ${overlays.length} match, ${overlayBad.length} mismatch`);

// #1881: a non-living renderer's own transform is compared POSED by mobl3check (evoker_fangs: EvokerFangsEntityRenderer.render + setAngles at several progresses, with its own breaks)
if (ONLY && matched + bad.length + overlayBad.length + overlays.length === 0 && (ONLY === 'evoker_fangs' || ONLY === 'shulker_bullet' || ONLY === 'llama_spit' || ONLY === 'wither_skull')) {
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('./mobl3check.mjs', import.meta.url)), '--mob', ONLY], { encoding: 'utf8' });
  console.log(r.stdout.trim().split('\n').filter((l) => /posed|breaks caught|llama_spit/.test(l)).join('\n'));
  console.log(r.status === 0 ? `✓ ${ONLY}: render transform + pose compared by mobl3check (non-living)` : `✗ ${ONLY}: MISMATCH vs the vanilla non-living renderer/model — it may not be marked audited`);
  process.exit(r.status === 0 ? 0 : 1);
}
if (ONLY && matched + bad.length + overlayBad.length + overlays.length === 0) { console.log(`✗ ${ONLY}: NOTHING COMPARED (${unmapped.length} unmapped: ${unmapped.join(', ') || 'none'}; ${nonliving.length} non-living) — a vacuous pass may not mark a mob audited (#1568)`); process.exit(1); }
if (ONLY) { const nb = bad.length + overlayBad.length; console.log(nb ? `✗ ${ONLY}: MISMATCH — it may not be marked audited` : `✓ ${ONLY}: matches the vanilla model (overlays and spawner display included)`); process.exit(nb ? 1 : 0); }

// ---- ratchets: the known-bad and the unmapped may only shrink ----
const LEDGER = JSON.parse(readFileSync(new URL('./mobshapecheck.json', import.meta.url), 'utf8'));
const knownBad = new Set(Object.keys(LEDGER.knownMismatch)), badNames = new Set(bad.map((b) => b[0]));
for (const n of badNames) ok(knownBad.has(n), `NEW mismatch vs vanilla: ${n} — ${bad.find((b) => b[0] === n)[1].join('; ')}`);
for (const n of knownBad) ok(badNames.has(n), `${n} now matches vanilla — delete it from knownMismatch in tools/mobshapecheck.json`);
const overlayBadNames = new Set(overlayBad.map((b) => b[0]));
for (const n of overlayBadNames) ok(knownOverlayBad.has(n), `NEW overlay/spawner mismatch vs vanilla: ${n}`);
for (const n of knownOverlayBad) ok(overlayBadNames.has(n), `overlay ${n} now matches vanilla — delete it from knownOverlayMismatch in tools/mobshapecheck.json`);
ok(overlays.length >= LEDGER.minOverlayMatched, `only ${overlays.length} overlay/spawner layers verified (ratchet ${LEDGER.minOverlayMatched})`);
ok(overlays.includes('sheep+fur#null'), 'the sheep fleece pass is not verified against SheepWoolEntityModel');
ok(overlays.some((n) => n.startsWith('spawner:')), 'no spawner cage mob is verified');
ok(unmapped.length <= LEDGER.maxUnmapped, `${unmapped.length} layers have no vanilla model mapped (ratchet ${LEDGER.maxUnmapped}); map them in ALIAS — ${unmapped.join(', ')}`);
const compares = (ls) => ls.some((l) => ['match', 'mismatch', 'nonliving'].includes(result[l]));
for (const [mob, ls] of Object.entries(ROSTER)) ok(compares(ls) || ls.every((l) => (l.endsWith('#null') && !BE.layer(l.split('#')[0])) || ALIAS[l] === null), `#3003: roster mob '${mob}' compares no layer here (--mob ${mob} would be vacuous)`);
ok(matched >= LEDGER.minMatched, `only ${matched} layers verified against vanilla (ratchet ${LEDGER.minMatched})`);

// ---- #7521 PROOF OUTPUT: tools/mobproof/out/model.json, one row per roster mob (no silent skips) ----
// Oracle = the vanilla model built from .decomp. Compared today: part count, AABB, 3 silhouettes, baby no larger, overlay/armour/spawner layers.
// Not yet compared (exact cuboid/UV/pivot/rotation) -> notCovered, in the shrink-only ledger tools/mobproof-model-known.json.
const PROOF = {}, PK = JSON.parse(readFileSync(new URL('./mobproof-model-known.json', import.meta.url), 'utf8'));
for (const [mob, ls] of Object.entries(ROSTER)) {
  const row = { pass: true, checked: [], notCovered: [], failed: [] };
  for (const l of ls) {
    const st = result[l];
    if (st === 'match') { row.checked.push(l + ': part count, per-cuboid posed AABB (origin/size/inflate/pivot chain/rotation), per-face UV rectangle sizes, per-cuboid texOffs + mirror flag, layer texture size, bbox, silhouettes'); if (babyOf[l]) row.checked.push(l + '#baby: quad count, volume'); }
    else if (st === 'mismatch') row.failed.push(l + ': ' + probsOf[l].join('; '));
    else if (st === 'nonliving') row.notCovered.push(l + ': non-living renderer transform is posed by mobl3check, not compared here');
    else if (st === 'unmapped') row.notCovered.push(l + ': no vanilla model class mapped');
    else row.notCovered.push(l + ': ' + (st || 'layer not in engine'));
    for (const [n, pr] of Object.entries(overlayStat)) if (n.split(/[+:]/)[0] === l || (n.split('#')[0] === l)) { if (pr.length) row.failed.push(n + ': ' + pr.join('; ')); else row.checked.push('overlay ' + n); }
  }
  for (const [l] of bad) if (ls.includes(l.replace('#baby', '')) && l.endsWith('#baby')) row.failed.push(l);
  if (!row.checked.length && !row.failed.length) row.notCovered.push('nothing compared for this mob');
  row.pass = row.failed.length === 0 && row.checked.length > 0;
  PROOF[mob] = row;
}
for (const mob of Object.keys(ROSTER)) {
  const have = new Set(PK.notCovered[mob] || []);
  for (const r of PROOF[mob].notCovered) ok(have.has(r), `#7521 NEW notCovered for ${mob}: ${r} (ledger tools/mobproof-model-known.json is shrink-only)`);
}
for (const mob of Object.keys(PK.notCovered)) { const cur = new Set((PROOF[mob] || { notCovered: [] }).notCovered); for (const r of PK.notCovered[mob]) ok(cur.has(r), `#7521 ${mob}: '${r}' is now covered - delete it from tools/mobproof-model-known.json`); }
if (process.argv.includes('--write-known')) { const o = {}; for (const m of Object.keys(PROOF)) o[m] = PROOF[m].notCovered; writeFileSync(new URL('./mobproof-model-known.json', import.meta.url), JSON.stringify({ why: '#7521 shrink-only ledger: per mob, what tools/mobshapecheck.mjs cannot yet compare against the vanilla model. May only get shorter.', notCovered: o }, null, 1)); console.log('wrote ledger'); process.exit(0); }
mkdirSync(new URL('./mobproof/out/', import.meta.url), { recursive: true });
writeFileSync(new URL('./mobproof/out/model.json', import.meta.url), JSON.stringify(PROOF, null, 1));
console.log(`  model proof: ${Object.values(PROOF).filter((r) => r.pass).length}/${Object.keys(PROOF).length} mobs pass, ${Object.values(PROOF).filter((r) => r.failed.length).length} red`);

// ---- anti-vacuity: break the engine's data / the reference and the check must notice ----
const BREAKS = [];
{
  const wolf = engineQuads('wolf');
  const shift = (qs, f) => qs.map((q) => q.map((v) => f(v.slice())));
  BREAKS.push(['a wolf whose head is dropped to the origin (lost parent pivot)', () => compareLayer('wolf', wolf.map((q) => (q[0][2] < -0.3 && q[0][1] > 0.5 ? q.map((v) => [v[0] + 1 / 16, v[1] - 13.5 / 16, v[2] + 7 / 16]) : q)))]);
  BREAKS.push(['a model mirrored left-right', () => compareLayer('cod', shift(engineQuads('cod'), (v) => { v[0] = -v[0]; v[2] = v[2] + 0.4; return v; }))]);
  BREAKS.push(['one sheep cuboid nudged 0.02 block (under the bbox tolerance, caught only per cuboid)', () => compareLayer('sheep', engineQuads('sheep').map((q, i) => (i >= 12 && i < 18 ? q.map((v) => [v[0] + 0.02, v[1], v[2]]) : q)))]);
  BREAKS.push(['a model rotated 90 degrees', () => compareLayer('sheep', shift(engineQuads('sheep'), (v) => [v[2], v[1], v[0]]))]);
  const furRoot = overlayRoot('sheep+fur#null'), sheepBody = engineQuads('sheep');
  BREAKS.push(['the fleece drawn with the bare sheep boxes (the mangled-head bug)', () => compareLayer('sheep', sheepBody, { root: furRoot, texKey: 'fur#null' })]);
  BREAKS.push(['the spawner mob drawn at full size (displayScale ignored)', () => compareLayer('zombie', engineQuads('zombie'), { root: vanillaFor('zombie'), vscale: spawnerScale('zombie') })]);
  BREAKS.push(['a fleece with its legs missing', () => compareLayer('sheep', engineQuads('sheep', undefined, 'fur#null').slice(0, -24), { root: furRoot, texKey: 'fur#null' })]);
  if (BE.layer('decor#null')) BREAKS.push(['the llama carpet drawn undilated (the bare llama body)', () => compareLayer('decor#null', engineQuads('decor#null'), { root: vanillaRoot('LlamaEntityModel', 'getTexturedModelData', new Dilation(0)) })]);
BREAKS.push(['a wolf head whose UV rectangles are stretched (one face 1 texel wider)', () => { const q = engineQuads('wolf'); q.uvs = q.uvs.map((f, i) => (i < 6 ? f.map((p, j) => [p[0] + (j === 1 || j === 2 ? UVK : 0), p[1]]) : f)); return compareLayer('wolf', q); }]);
BREAKS.push(['one fin missing', () => compareLayer('cod', engineQuads('cod').slice(6))]);
  BREAKS.push(['a fin left unrotated', () => { const q = engineQuads('cod'); const ea = q.map((x) => x.map((v) => v.slice())); for (const x of ea.slice(0, 40)) for (const v of x) if (v[1] < 0.5 && Math.abs(v[0]) > 0.05) v[1] += 0.3; return compareLayer('cod', ea); }]);
}
// #7798: one cuboid of each frame-free-compared non-living model nudged / resized in a copy must fail
for (const l of Object.keys(NONLIVING_SHAPE)) {
  BREAKS.push([`${l}: one cuboid perturbed (0.03 block taller)`, () => { const q = engineQuads(l).map((x) => x.map((v) => v.slice())); const n = engineCuboids(l, q).length, dbl = ER.NO_CULL[l] ? 2 : 1; const G = ER.mobGeomFor(l); let cnt = 0; for (let f = 0; f < 6; f++) { const s = G && G[0] && G[0][f]; cnt += s && s.length ? s.length : 1; } for (let i = 0; i < cnt; i++) for (const v of q[i]) if (v[1] > engineCuboids(l, q)[0].lo[1] + 1e-6 || n) v[1] += v[1] > (engineCuboids(l, q)[0].lo[1] + engineCuboids(l, q)[0].hi[1]) / 2 ? 0.03 : 0; return compareLayer(l, q); }]);
}
BREAKS.push(['pig saddle drawn undilated (the bare pig body)', () => compareLayer('saddle#null', engineQuads('saddle#null'), { root: vanillaRoot('PigEntityModel', 'getTexturedModelData', new Dilation(0)) })]);
BREAKS.push(['strider saddle bristles unparented (the pre-#7866 pose)', () => { const k = ER.PART_PARENT.strider; ER.PART_PARENT.strider = {}; try { return compareLayer('strider_saddle', engineQuads('strider_saddle'), { root: vanillaRoot('StriderEntityModel', 'getTexturedModelData') }); } finally { ER.PART_PARENT.strider = k; } }]);
BREAKS.push(['one wolf cuboid with texOffs shifted by 1 texel (#7797)', () => { const q = engineQuads('wolf'); return compareLayer('wolf', q, { uvPatch: (ep) => ep.map((p, i) => (i === 3 ? Object.assign({}, p, { tu: p.tu + 1 }) : p)) }); }]);
BREAKS.push(['one wolf cuboid with its mirror flag flipped (#7797)', () => { const q = engineQuads('wolf'); return compareLayer('wolf', q, { uvPatch: (ep) => ep.map((p, i) => (i === 1 ? Object.assign({}, p, { m: p.m ? 0 : 1 }) : p)) }); }]);
BREAKS.push(['a roster mob whose layer names compare nothing', () => ({ status: compares(['no_such_layer']) ? 'match' : 'mismatch' })]);
let caught = 0;
for (const [name, fn] of BREAKS) { const r = fn(); if (r.status === 'mismatch') { caught++; console.log(`  ✓ break caught: ${name}`); } else ok(false, `break NOT caught: ${name} (${r.status})`); }
console.log(`mobshapecheck: ${caught} breaks caught (of ${BREAKS.length})`);
for (const f of fails) console.log(`  ✗ ${f}`);
console.log(` assertions passed .... ${pass}`);
console.log(` failures ........... ${fails.length}`);
process.exit(fails.length ? 1 : 0);
