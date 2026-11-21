#!/usr/bin/env node
// texanimcheck.mjs — #1891 ANIM-1. Animated block tiles tick on vanilla's clock (Sprite.Animation.tick,
// decomp Sprite.java:316-333; Interpolation.apply :396-420). Everything expected is derived here from the
// JAR (.mcmeta + png strip) with its own closed-form clock, never from assets/block-anim.*:
//   A. frame count / frametime / frame order / interpolate in the shipped meta == the jar's .mcmeta
//   B. at every tick t the atlas layer's pixels (and mips) == the expected frame or blend
//   C. only animated layers go dirty (sub-rect upload, no atlas rebuild); GL + WebGPU upload what the CPU holds
// Anti-vacuity: corrupts a frametime, the frame order, interpolate, the clock, and a stray write; counts catches.
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Jar, texturePath } from './jarlib.mjs';
import { decodePng } from './png.mjs';
import { requireJar, skipCheck } from './paths.mjs';
import { loadEngine } from './loadsrc.mjs';

const ASSETS = join(fileURLToPath(new URL('..', import.meta.url)), 'assets');
let jarNew, jarOld = null;
try { jarNew = new Jar(requireJar('1.18.2')); } catch { skipCheck('texanimcheck', 'no 1.18.2 jar'); }
try { jarOld = new Jar(requireJar('1.13.2')); } catch { /* build-atlas prefers it where it has the tile */ }
const T = 16, FB = T * T * 4;
const rd = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const meta = rd('block-anim.meta.json'), bt = rd('block-tiles.meta.json');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

// ── the jar's truth ───────────────────────────────────────────────────────────────
function jarAnim(id) {
  const p = texturePath(id), J = jarOld && jarOld.has(p) ? jarOld : jarNew;
  const img = decodePng(J.read(p)), a = JSON.parse(J.readText(p + '.mcmeta')).animation;
  const W = img.width, n = img.height / W, dflt = a.frametime ?? 1;
  let frames = (a.frames || []).map((f) => typeof f === 'number' ? [f, dflt] : [f.index, f.time ?? dflt]);
  if (!frames.length) for (let i = 0; i < n; i++) frames.push([i, dflt]);
  // #2002: 32x32 fluid-flow frames are packed as their top-left 16x16 quadrant (what vanilla's side UVs sample)
  const strips = []; for (let f = 0; f < n; f++) {
    const o = new Uint8Array(FB);
    for (let y = 0; y < T; y++) for (let x = 0; x < T * 4; x++) o[y * T * 4 + x] = img.data[((f * W + y) * W) * 4 + x];
    strips.push(o);
  }
  return { n, frames, interpolate: !!a.interpolate, strips };
}
// expected pixels at tick t (closed form: no incremental state, so it cannot share a bug with animTick)
function expectAt(J, t) {
  const total = J.frames.reduce((s, f) => s + f[1], 0);
  let pos = t % total, i = 0;
  while (pos >= J.frames[i][1]) { pos -= J.frames[i][1]; i++; }
  const f = J.frames[i], a = J.strips[f[0]], nx = J.frames[(i + 1) % J.frames.length][0];
  if (!J.interpolate || pos === 0 || f[0] === nx) return a;
  const b = J.strips[nx], d = 1 - pos / f[1], o = new Uint8Array(FB);
  for (let k = 0; k < FB; k += 4) { for (let c = 0; c < 3; c++) o[k + c] = Math.trunc(d * a[k + c] + (1 - d) * b[k + c]); o[k + 3] = a[k + 3]; }
  return o;
}
const norm = (px) => { const o = Uint8Array.from(px); for (let k = 0; k < o.length; k += 4) if (!o[k + 3]) o[k] = o[k + 1] = o[k + 2] = 0; return o; };
const fnv = (u) => { let h = 2166136261; for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i], 16777619) >>> 0; return h; };
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
function mipChain(src) {
  const out = [src]; let s = T, prev = src;
  while (s > 1) { const n = s >> 1, nx = new Uint8Array(n * n * 4);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) for (let c = 0; c < 4; c++) {
      const g = (xx, yy) => prev[(yy * s + xx) * 4 + c];
      nx[(y * n + x) * 4 + c] = (g(2 * x, 2 * y) + g(2 * x + 1, 2 * y) + g(2 * x, 2 * y + 1) + g(2 * x + 1, 2 * y + 1) + 2) >> 2; }
    out.push(nx); prev = nx; s = n; }
  return out;
}

globalThis.OffscreenCanvas = class { getContext() { return { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }; } };
const NS = loadEngine({ extra: ['06_atlas.js', '06b_tintmap.js', '10_gfx.js', '11_gfx_webgpu.js', '12_gfx_webgl2.js'], dom: false });
NS.Blocks.init();
const A = NS.Atlas;
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
Object.assign(NS.DATA, { blockTiles: b64('block-tiles.bin'), blockTilesBytes: bt.rawBytes, blockTilesCount: bt.count,
  blockAnim: b64('block-anim.bin'), blockAnimBytes: meta.rawBytes });

// Atlas.build cannot run twice (its TILE_COUNT global drifts), so snapshot the built atlas and restore it per run
A.build(1);
const pristine = A.mips.map((m) => m.data.slice());
const jars = new Map(meta.anims.map((m) => [m.id, jarAnim(m.id)]));
const TICKS = 160;
console.log(`texanimcheck — #1891, ${meta.anims.length} animated tiles vs the jar's .mcmeta, ${TICKS} ticks each`);

/** One full verification with `anims` as the shipped clock data; `skew` drops a tick (break). Returns failure count. */
function verify(anims, { skew = false, stray = false, count = false } = {}) {
  const before = fails.length;
  NS.DATA.blockAnimMeta = anims;
  A.mips.forEach((m, l) => m.data.set(pristine[l]));
  A.animInit();
  // A. meta == jar
  for (const m of anims) {
    const J = jars.get(m.id);
    ok(J && m.n === J.n && m.frames.length === J.frames.length, `${m.id}: frame count ${m.frames.length}/${m.n} != jar`);
    ok(J && JSON.stringify(m.frames) === JSON.stringify(J.frames), `${m.id}: frame order/frametime differ from the jar`);
    ok(J && m.interpolate === J.interpolate, `${m.id}: interpolate differs from the jar`);
  }
  // B + C. tick, compare the layer, track dirty
  A.dynDrain(() => {});
  const others = [3, A.tiles - 1], ref = others.map((l) => fnv(A.mips[0].data.subarray(l * FB, (l + 1) * FB)));
  let uploads = 0;
  for (let t = 0; t <= TICKS; t++) {
    if (t > 0 && !(skew && t === 7)) A.animTick();
    if (stray && t === 3) A.writeTile(others[0], new Uint8Array(FB).fill(9));
    for (const an of A.anims) {
      const J = jars.get(an.id), exp = norm(expectAt(J, t)), got = norm(A.mips[0].data.subarray(an.layer * FB, (an.layer + 1) * FB));
      if (!same(exp, got)) ok(false, `${an.id}: tick ${t} pixels differ (hash ${fnv(got).toString(16)} != ${fnv(exp).toString(16)})`);
      else pass++;
    }
    const dirty = []; A.dynDrain((l) => dirty.push(l)); uploads += dirty.length;
    const animLayers = new Set(A.anims.map((a) => a.layer));
    ok(dirty.every((l) => animLayers.has(l)), `tick ${t}: a non-animated layer went dirty (${dirty.filter((l) => !animLayers.has(l))})`);
  }
  others.forEach((l, i) => ok(fnv(A.mips[0].data.subarray(l * FB, (l + 1) * FB)) === ref[i] || stray, `layer ${l} changed`));
  if (count) { ok(uploads > 0 && uploads < A.anims.length * TICKS, `${uploads} layer uploads over ${TICKS} ticks`); }
  return fails.length - before;
}

const real = meta.anims;
const failsReal = verify(real, { count: true });
for (const need of ['water_still', 'lava_still', 'fire_0', 'fire_1', 'soul_fire_0', 'soul_fire_1', 'campfire_fire', 'soul_campfire_fire', 'magma',
  'sea_lantern', 'prismarine', 'nether_portal', 'kelp', 'seagrass', 'lantern', 'respawn_anchor_top', 'sculk_sensor_tendril_active', 'command_block_front'])
  ok(real.some((m) => m.id === 'block/' + need), `${need} is not animated in the atlas`);
ok(A.anims.length === real.length && real.length >= 35, `only ${real.length} animated tiles`);
ok(real.some((m) => m.interpolate) && real.some((m) => m.frames.some(([, t]) => t !== 1)), 'no interpolated / non-default-frametime tile found');

// C2. the backends upload exactly what the CPU holds for an animated layer
{
  const an = A.anims.find((a) => a.id === 'block/prismarine');           // interpolated, frametime 5+
  A.dynDrain(() => {}); for (let i = 0; i < 9; i++) A.animTick();
  const want = mipChain(Uint8Array.from(A.mips[0].data.subarray(an.layer * FB, (an.layer + 1) * FB)));
  const gl = new Map(), gpu = new Map(); const dirty = A.dynDirty.slice();
  const L = NS.GfxGL, glm = { TEXTURE_2D_ARRAY: 1, RGBA: 2, UNSIGNED_BYTE: 3, bindTexture(_, t) { this.cur = t; },
    texSubImage3D(_t, lvl, _x, _y, z, _w, _h, _d, _f, _ty, data) { gl.set(lvl + '/' + (this.cur.base + z), Uint8Array.from(data)); } };
  L.atlasSplit = A.tiles + 1; L.atlasTex = { base: 0 }; L.atlasTex2 = L.atlasTex3 = L.atlasTex4 = { base: 0 };
  L.syncAtlasDyn(glm);
  A.dynDirty = dirty;
  const P = NS.GfxGPU; P.device = { queue: { writeTexture(d, data) { gpu.set(d.mipLevel + '/' + d.origin[2], Uint8Array.from(data)); } } }; P.atlasTex = {};
  P.syncAtlasDyn();
  ok(want.every((r, l) => same(gl.get(l + '/' + an.layer) || [], r)), 'WebGL2 upload of an animated layer differs from the CPU atlas');
  ok(want.every((r, l) => same(gpu.get(l + '/' + an.layer) || [], r)), 'WebGPU upload of an animated layer differs from the CPU atlas');
  ok(gl.size === dirty.length * want.length && gpu.size === dirty.length * want.length && dirty.length < A.tiles / 10, 'a backend uploaded more than the dirty animated layers');
}
ok(failsReal === 0, `${failsReal} failures on the real data`);

// ── anti-vacuity: each corruption MUST add failures ───────────────────────────────
const clone = () => JSON.parse(JSON.stringify(real));
let caught = 0, tried = 0;
const brk = (name, mutate, opts) => {
  const saved = fails.slice(), p0 = pass; tried++;
  const d = clone(); mutate(d);
  const n = verify(d, opts);
  fails.length = saved.length; pass = p0;                 // the break's own failures are expected, not reported
  if (n > 0) { caught++; console.log('   ✓ break caught: ' + name); } else fails.push(`BREAK NOT CAUGHT: ${name}`);
};
const pick = (d, id) => d.find((m) => m.id === id);
brk('water_still frametime 2 -> 3', (d) => { pick(d, 'block/water_still').frames.forEach((f) => { f[1] = 3; }); });
brk('lava_still frame order (swap 2 frames)', (d) => { const f = pick(d, 'block/lava_still').frames; [f[3], f[4]] = [f[4], f[3]]; });
brk('prismarine interpolate flipped', (d) => { const m = pick(d, 'block/prismarine'); m.interpolate = !m.interpolate; });
brk('fire_0 drops a frame', (d) => { pick(d, 'block/fire_0').frames.pop(); });
brk('clock loses a tick', () => {}, { skew: true });
brk('animation writes outside its layer', () => {}, { stray: true });

console.log(`${tried} breaks tried, ${caught} breaks caught`);
console.log(`texanimcheck: ${pass} assertions, ${fails.length} failed`);
if (fails.length) { for (const f of fails.slice(0, 20)) console.log('  ✗ ' + f); process.exit(1); }
