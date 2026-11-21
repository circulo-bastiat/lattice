#!/usr/bin/env node
// fireblockmodelcheck.mjs - #1893 FIRE-1. The fire block is a MODEL, not a cube, and it is lit and animated.
// Expected values come from the JAR (blockstates/fire.json + soul_fire.json multiparts, the template_fire_* models)
// and from the decompiled Java (.decomp FireBlock / AbstractFireBlock / Blocks), never from assets/:
//   A. every one of the 512 fire states + soul_fire: multipart groups/variants/quads == the baked geometry
//      (group order, alternative count, quads per alternative, fire_0/fire_1 tile per variant, side UVs, side plane = y rotation)
//   B. collision empty (Blocks.java:505 noCollision), never opaque / never culls / no light attenuation / not a cube
//   C. outline == FireBlock.getShapeForState (FireBlock.java:79-110, BASE_SHAPE when no face), soul_fire = AbstractFireBlock.BASE_SHAPE
//   D. light 15 / 10 (Blocks.java:505, 511)
//   E. the quads' tiles ARE animated layers (fire_0/fire_1/soul_fire_0/1: 32 frames, the jar's .mcmeta) and the sprite advances
// Anti-vacuity: corrupts quad count, tile, UV, plane, collision, opacity, outline, light and the animation link; counts catches.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Jar } from './jarlib.mjs';
import { requireJar, skipCheck } from './paths.mjs';
import { loadEngine } from './loadsrc.mjs';

const ASSETS = join(fileURLToPath(new URL('..', import.meta.url)), 'assets');
let jar; try { jar = new Jar(requireJar('1.18.2')); } catch { skipCheck('fireblockmodelcheck', 'no 1.18.2 jar'); }
const rd = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const jj = (p) => JSON.parse(jar.readText(p));
const NS = loadEngine({ dom: false });
NS.Blocks.init();
const R = NS.Reg, S = NS.States;
const atlas = rd('atlas-index.json').index, animMeta = rd('block-anim.meta.json').anims;

let pass = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 30) fails.push(m); };

// ── the jar's truth ──────────────────────────────────────────────────────────
function modelOf(name) {      // resolve parent chain: elements from template, texture from the leaf
  let m = jj(`assets/minecraft/models/${name.replace('minecraft:', '')}.json`), tex = { ...(m.textures || {}) };
  while (m.parent) { m = jj(`assets/minecraft/models/${m.parent.replace('minecraft:', '')}.json`); tex = { ...(m.textures || {}), ...tex }; if (m.elements) break; }
  return { elements: m.elements, fire: tex.fire.replace('minecraft:', '') };
}
function applies(bs, st) {    // multipart "when" evaluation (OR / AND of property equalities); no "when" = always
  const match = (c) => Object.entries(c).every(([k, v]) => k === 'OR' ? v.some(match) : k === 'AND' ? v.every(match) : String(st[k]) === v);
  return bs.multipart.filter((p) => !p.when || match(p.when)).map((p) => p.apply);
}
const expectState = (bs, st) => applies(bs, st).map((alts) => alts.map((a) => {
  const m = modelOf(a.model), quads = m.elements.reduce((n, e) => n + Object.keys(e.faces).length, 0);
  const f = m.elements[0].faces, first = f[Object.keys(f)[0]];
  return { quads, tile: atlas[m.fire], y: a.y || 0, uv: m.elements.length === 1 ? first.uv : null, elements: m.elements.length };
}));

const names = ['fire', 'soul_fire'];
const bstates = { fire: jj('assets/minecraft/blockstates/fire.json'), soul_fire: jj('assets/minecraft/blockstates/soul_fire.json') };

// ── the engine's view, as a plain snapshot a break can corrupt ─────────────────────
function snapshot(name) {
  const b = R.names.indexOf(name), first = R.realFirst[b], cnt = R.realFirst[b + 1] - first, out = [];
  for (let s = first; s < first + cnt; s++) {
    const v = S.vis[s], groups = [];
    for (let g = 0; g < R.groupCount(v); g++) {
      const a0 = R.grpAltOff[R.stGroupOff[v] + g], a1 = R.grpAltOff[R.stGroupOff[v] + g + 1], alts = [];
      for (let a = a0; a < a1; a++) {
        const p = R.altPart[a], q0 = R.partOff[p], q1 = R.partOff[p + 1];
        const pos = Array.from(R.qPos.slice(q0 * 12, q0 * 12 + 12)), xs = [0, 1, 2, 3].map((k) => pos[k * 3]), zs = [0, 1, 2, 3].map((k) => pos[k * 3 + 2]);
        const uv = Array.from(R.qUv.slice(q0 * 8, q0 * 8 + 8));
        alts.push({ quads: q1 - q0, tile: R.qTile[q0], uv, flatX: xs.every((x) => x === xs[0]) ? xs[0] : null, flatZ: zs.every((z) => z === zs[0]) ? zs[0] : null });
      }
      groups.push(alts);
    }
    out.push({ s, groups, solid: S.solid[s], opaque: S.opaque[s], cull: S.cull[s], atten: S.atten[s], emit: S.emit[s],
      geom: S.geom[s], collisionBoxes: R.shapeOff[R.shapeOf[s] + 1] - R.shapeOff[R.shapeOf[s]], outline: R.outlineShape(s) });
  }
  return out;
}
const cells = (boxes) => { const set = new Set(); for (const b of boxes || []) for (let x = Math.round(b[0] * 16); x < Math.round(b[3] * 16); x++)
  for (let y = Math.round(b[1] * 16); y < Math.round(b[4] * 16); y++) for (let z = Math.round(b[2] * 16); z < Math.round(b[5] * 16); z++) set.add(x + ',' + y + ',' + z); return set; };
const boxCells = (x0, y0, z0, x1, y1, z1) => cells([[x0 / 16, y0 / 16, z0 / 16, x1 / 16, y1 / 16, z1 / 16]]);
const FACES = { up: [0, 15, 0, 16, 16, 16], west: [0, 0, 0, 1, 16, 16], east: [15, 0, 0, 16, 16, 16], north: [0, 0, 0, 16, 16, 1], south: [0, 0, 15, 16, 16, 16] };
const PLANE_Y = { 0: ['flatZ', 0], 90: ['flatX', 256], 180: ['flatZ', 256], 270: ['flatX', 0] };   // side model rotated about y: north plane z=0, east x=1, ...
const sameSet = (a, b) => a.size === b.size && [...a].every((k) => b.has(k));
const LIGHT = { fire: 15, soul_fire: 10 };

function verify(snap, name, { animLink = true } = {}) {
  const before = fails.length, bs = bstates[name], b = R.names.indexOf(name), first = R.realFirst[b];
  for (const e of snap) {
    const st = {};
    for (const p of ['age', 'north', 'east', 'south', 'west', 'up']) { const id = R.PROP[p]; if (id !== undefined) { const v = S.propValue(e.s, id); if (v !== -1) st[p] = R.valueNames[v]; } }
    const want = expectState(bs, st);
    const tag = `${name}#${e.s - first} ${JSON.stringify(st)}`;
    // A. model
    ok(e.groups.length === want.length, `${tag}: ${e.groups.length} groups, jar multipart applies ${want.length}`);
    want.forEach((alts, g) => {
      const got = e.groups[g] || [];
      ok(got.length === alts.length, `${tag} g${g}: ${got.length} variants != jar ${alts.length}`);
      alts.forEach((w, k) => {
        const a = got[k]; if (!a) return;
        ok(a.quads === w.quads, `${tag} g${g}.${k}: ${a.quads} quads != jar ${w.quads}`);
        ok(a.tile === w.tile, `${tag} g${g}.${k}: tile ${a.tile} != jar ${w.tile}`);
        if (w.uv) {        // side models: one element, uv [x1,y1,x2,y2] -> corners (x1,y1)(x2,y1)(x2,y2)(x1,y2) x16 (sides are not face-rotated)
          const [u1, v1, u2, v2] = w.uv.map((n) => n * 16), ex = [u1, v1, u2, v1, u2, v2, u1, v2];
          ok(a.uv.every((n, i) => Math.abs(n - ex[i]) <= 1), `${tag} g${g}.${k}: uv ${a.uv} != jar ${ex}`);
          const [key, at] = PLANE_Y[w.y]; ok(a[key] !== null && Math.abs(a[key] - at) <= 1, `${tag} g${g}.${k}: plane ${key}=${a[key]} for y=${w.y}`);
        }
      });
    });
    // B. collision / light transport
    ok(e.collisionBoxes === 0 && !e.solid, `${tag}: has a collision box (Blocks.java:505 noCollision)`);
    ok(!e.opaque && e.cull === 0 && e.atten === 0, `${tag}: opaque=${e.opaque} cull=${e.cull} atten=${e.atten} - fire must never occlude`);
    ok(e.geom === S.GEOM_MODEL, `${tag}: geom ${e.geom} - fire is a model, never a cube`);
    // D. light
    ok(e.emit === LIGHT[name], `${tag}: emits ${e.emit}, vanilla ${LIGHT[name]}`);
    // C. outline
    let wantCells;
    if (name === 'fire') { wantCells = new Set(); for (const f of Object.keys(FACES)) if (st[f] === 'true' || st[f] === true) for (const c of boxCells(...FACES[f])) wantCells.add(c); if (!wantCells.size) wantCells = boxCells(0, 0, 0, 16, 1, 16); }
    else wantCells = boxCells(0, 0, 0, 16, 1, 16);
    ok(e.outline && sameSet(cells(e.outline), wantCells), `${tag}: outline differs from getShapeForState`);
  }
  // E. animation link
  const tiles = new Set(snap.flatMap((e) => e.groups.flat().map((a) => a.tile)));
  for (const t of tiles) {
    const an = animMeta.find((m) => m.layer === t);
    ok(animLink && an && an.n === 32 && an.frames.length === 32 && /fire_[01]$/.test(an.id) && an.id.startsWith('block/' + (name === 'fire' ? 'fire' : 'soul_fire')), `${name}: tile ${t} is not an animated fire sprite`);
  }
  return fails.length - before;
}

// the sprite advances: fire_0 frames in the jar are 16..31,0..15 at frametime 1 (fire_0.png.mcmeta)
{
  const meta0 = animMeta.find((m) => m.id === 'block/fire_0'), jarMeta = JSON.parse(jar.readText('assets/minecraft/textures/block/fire_0.png.mcmeta')).animation;
  ok(meta0 && JSON.stringify(meta0.frames.map((f) => f[0])) === JSON.stringify(jarMeta.frames.map((f) => typeof f === 'number' ? f : f.index)) || !jarMeta.frames, 'fire_0 frame order != jar mcmeta');
  ok(meta0 && meta0.frames.length === 32 && meta0.frames.every((f) => f[1] === (jarMeta.frametime ?? 1)), 'fire_0 frametime != jar');
  ok(new Set(meta0.frames.map((f) => f[0])).size === 32, 'fire_0 does not visit 32 distinct frames');
}
{
  globalThis.OffscreenCanvas = class { getContext() { return { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }; } };
  const NS2 = loadEngine({ extra: ['06_atlas.js', '06b_tintmap.js', '10_gfx.js', '11_gfx_webgpu.js', '12_gfx_webgl2.js'], dom: false });
  NS2.Blocks.init();
  const A = NS2.Atlas, bt = rd('block-tiles.meta.json'), am = rd('block-anim.meta.json'), b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
  Object.assign(NS2.DATA, { blockTiles: b64('block-tiles.bin'), blockTilesBytes: bt.rawBytes, blockTilesCount: bt.count, blockAnim: b64('block-anim.bin'), blockAnimBytes: am.rawBytes, blockAnimMeta: am.anims });
  A.build(1); A.animInit();
  const FB = 16 * 16 * 4, layer = atlas['block/fire_0'], px = () => Buffer.from(A.mips[0].data.subarray(layer * FB, (layer + 1) * FB)).toString('hex');
  const seen = new Set([px()]);
  for (let t = 0; t < 40; t++) { A.animTick(); seen.add(px()); }
  ok(seen.size >= 16, `fire_0 showed only ${seen.size} distinct images in 40 ticks`);
}

// ── run: real data must pass, every corruption must be caught ───────────────────
console.log('fireblockmodelcheck - #1893, fire (512 states) + soul_fire vs the jar blockstates, decomp shapes and light');
const snaps = Object.fromEntries(names.map((n) => [n, snapshot(n)]));
ok(snaps.fire.length === 512 && snaps.soul_fire.length === 1, `state counts ${snaps.fire.length}/${snaps.soul_fire.length}`);
for (const n of names) verify(snaps[n], n);
const realFails = fails.length;

const clone = (o) => JSON.parse(JSON.stringify(o));
const breaks = [
  ['a side variant loses a quad', (s) => { s.fire[5].groups[1][0].quads = 1; }],
  ['a floor variant uses the wrong frame tile', (s) => { s.fire[0].groups[0][1].tile = s.fire[0].groups[0][0].tile; }],
  ['alt side UV unflipped', (s) => { const g = s.fire.find((e) => e.groups.some((gr) => gr[2] && gr[2].flatZ !== null)).groups.find((gr) => gr[2]); g[2].uv = g[0].uv; }],
  ['a side plane is rotated wrong', (s) => { const g = s.fire.find((e) => e.groups.length > 1).groups[1]; g[0].flatZ = g[0].flatX = 100; }],
  ['a group is dropped', (s) => { s.fire[300].groups.pop(); }],
  ['fire gains a collision box', (s) => { s.fire[7].collisionBoxes = 1; }],
  ['fire becomes opaque', (s) => { s.fire[9].opaque = 1; }],
  ['fire culls a face', (s) => { s.fire[11].cull = 4; }],
  ['fire attenuates light', (s) => { s.fire[12].atten = 1; }],
  ['fire becomes a cube', (s) => { s.fire[13].geom = S.GEOM_CUBE; }],
  ['fire emits 14', (s) => { s.fire[14].emit = 14; }],
  ['soul fire emits 15', (s) => { s.soul_fire[0].emit = 15; }],
  ['outline is empty', (s) => { s.fire[20].outline = []; }],
  ['outline is the full cube', (s) => { s.fire[21].outline = [[0, 0, 0, 1, 1, 1]]; }],
  ['soul fire outline is a full cube', (s) => { s.soul_fire[0].outline = [[0, 0, 0, 1, 1, 1]]; }],
];
let caught = 0;
for (const [label, mut] of breaks) {
  const s = clone(snaps); s.fire.forEach((e, i) => { e.s = snaps.fire[i].s; }); s.soul_fire[0].s = snaps.soul_fire[0].s;
  mut(s);
  let c = 0; for (const nm of names) c += verify(s[nm], nm);
  if (c > 0) { caught++; console.log('  ✓ caught: ' + label); } else console.log('NOT CAUGHT:', label);
}
// the animation link: a snapshot whose tile is not an animated layer
{ const s = clone(snaps); s.fire.forEach((e) => e.groups.forEach((g) => g.forEach((a) => { a.tile = 3; })));
  if (verify(s.fire, 'fire') > 0) { caught++; console.log('  ✓ caught: tile not animated'); } else console.log('NOT CAUGHT: tile not animated'); }
const total = breaks.length + 1;

const real = fails.slice(0, realFails);
console.log(`${pass} assertions, ${real.length} failures, ${caught} breaks caught`);
real.forEach((f) => console.log('FAIL', f));
console.log(` assertions passed .. ${pass}\n failures ........... ${real.length}\n breaks caught ...... ${caught}`);
console.log(`${caught} breaks caught (of ${total})`);
if (real.length || caught !== total) process.exit(1);
