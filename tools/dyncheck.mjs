#!/usr/bin/env node
// dyncheck.mjs — #1329. The atlas dynamic tile pool: dynTake/dynFree, dynWrite (+ mip chain, dirty),
// and both backends' syncAtlasDyn pushing EXACTLY the texels the CPU atlas holds. Mock GL / GPU
// device record every upload into shadow textures; the shadow is compared with A.mips.
// Anti-vacuity: breaks its own data (skipped write, skipped mip, stale sync) and counts the catches.
import { loadEngine } from './loadsrc.mjs';

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
console.log('dyncheck — #1329, atlas dynamic tile pool + syncAtlasDyn');

globalThis.OffscreenCanvas = class { getContext() { return { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }; } };
const NS = loadEngine({ extra: ['19_data.gen.js', '06_atlas.js', '06b_tintmap.js', '10_gfx.js', '11_gfx_webgpu.js', '12_gfx_webgl2.js'], dom: false });
NS.Blocks.init(); NS.Atlas.build(1);
const A = NS.Atlas, T = 16;

const tile = (seed) => { const a = new Uint8Array(T * T * 4); for (let i = 0; i < a.length; i++) a[i] = (i * 7 + seed * 31) & 255; return a; };
const mipOf = (src) => { // independent reference chain
  const out = [src]; let s = T, prev = src;
  while (s > 1) { const n = s >> 1, nx = new Uint8Array(n * n * 4);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) for (let c = 0; c < 4; c++) {
      const g = (xx, yy) => prev[(yy * s + xx) * 4 + c];
      nx[(y * n + x) * 4 + c] = (g(2*x, 2*y) + g(2*x+1, 2*y) + g(2*x, 2*y+1) + g(2*x+1, 2*y+1) + 2) >> 2; }
    out.push(nx); prev = nx; s = n; }
  return out;
};

// shadow storage: key "level/layer" -> bytes; both mocks write here
function makeShadow() {
  const sh = new Map();
  for (let l = 0; l < A.mips.length; l++) for (let t = 0; t < A.tiles; t++) {
    const st = A.mips[l].size ** 2 * 4; sh.set(l + '/' + t, A.mips[l].data.slice(t * st, (t + 1) * st));
  }
  return sh;
}
function syncGL(drop, sh) {
  const L = NS.GfxGL;
  const gl = { TEXTURE_2D_ARRAY: 1, RGBA: 2, UNSIGNED_BYTE: 3, bindTexture(_, t) { this.cur = t; },
    texSubImage3D(_t, lvl, _x, _y, z, w, h, d, _f, _ty, data) { if (drop) return; sh.set(lvl + '/' + (this.cur.base + z), Uint8Array.from(data)); } };
  L.atlasSplit = 8 + A.dynTile0; // force sharding: dyn tiles land in shard 1+ with a local offset
  L.atlasTex = { base: 0 }; L.atlasTex2 = { base: L.atlasSplit }; L.atlasTex3 = { base: 2 * L.atlasSplit }; L.atlasTex4 = { base: 3 * L.atlasSplit };
  L.syncAtlasDyn(gl); return sh;
}
function syncGPU(drop, sh) {
  const P = NS.GfxGPU;
  P.device = { queue: { writeTexture(d, data, _l, size) { if (drop) return; sh.set(d.mipLevel + '/' + d.origin[2], Uint8Array.from(data)); } } };
  P.atlasTex = {}; P.syncAtlasDyn(); return sh;
}
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const matches = (sh, t, px) => mipOf(px).every((r, l) => same(sh.get(l + '/' + t), r));

let n = 100;
function scenario(drop, mutateMips) {
  A.dynDirty = [];
  const t = A.dynTake(); const px = tile(++n);
  const g0 = makeShadow(), p0 = makeShadow();   // what the GPU holds BEFORE the write
  A.dynWrite(t, px);
  if (mutateMips) A.mips[3].data[t * 16] ^= 0x55;
  const g = syncGL(drop, g0);
  if (!drop) A.dynDirty = [t];   // the GL sync drained the list; the GPU sync gets its own copy of the write
  const p = syncGPU(drop, p0);
  return { t, px, g, p };
}

// -- pool bookkeeping
ok(A.tiles === A.dynTile0 + A.dynTiles && A.dynTiles > 0, 'pool is the last layers of the atlas');
const taken = []; for (let i = 0; i < A.dynTiles; i++) taken.push(A.dynTake());
ok(taken.every((t, i) => t === A.dynTile0 + i), 'dynTake hands out the pool layers in order');
ok(A.dynTake() === -1, 'exhausted pool returns -1');
A.dynFree(taken[3]); ok(A.dynTake() === taken[3], 'dynFree makes a layer takeable again');
for (const t of taken) A.dynFree(t);
let threw = false; try { A.dynWrite(taken[0], tile(1)); } catch (e) { threw = true; } ok(threw, 'dynWrite on a free layer throws');

// -- write + sync
const good = scenario(false, false);
ok(same(A.mips[0].data.subarray(good.t * 1024, good.t * 1024 + 1024), good.px), 'dynWrite stores level 0');
const ref = mipOf(good.px);
ok(ref.every((r, l) => same(A.mips[l].data.subarray(good.t * r.length, (good.t + 1) * r.length), r)), 'dynWrite rebuilds the whole mip chain');
ok(A.dynDirty.length === 0, 'sync drained the dirty list');
ok(matches(good.g, good.t, good.px), 'WebGL2 sync uploads every level of the dirty layer (sharded)');
ok(matches(good.p, good.t, good.px), 'WebGPU sync uploads every level of the dirty layer');
ok(A.mips.every((m, l) => same(good.g.get(l + '/' + good.t), good.p.get(l + '/' + good.t))), 'both backends hold identical texels');
A.dynFree(good.t);

// -- breaks: each must be caught
let breaks = 0;
const bad1 = scenario(true, false); if (!matches(bad1.g, bad1.t, bad1.px) && !matches(bad1.p, bad1.t, bad1.px)) breaks++; else fails.push('break skipped-write not caught'); A.dynFree(bad1.t);
const bad2 = scenario(false, true); if (!matches(bad2.g, bad2.t, bad2.px)) breaks++; else fails.push('break stale-mip not caught'); A.dynFree(bad2.t);
{ A.dynDirty = []; const t = A.dynTake(); // dirty mark lost
  const g0 = makeShadow(), px = tile(9); A.dynWrite(t, px); A.dynDirty = [];
  const g = syncGL(false, g0); if (!matches(g, t, px)) breaks++; else fails.push('break lost-dirty not caught'); A.dynFree(t); }
// -- #5005: a SECOND build (Main.play) must pass assertTileTable; a real drift must still throw
{ let err = null; try { A.build(1); A.assertTileTable(); } catch (e) { err = e; } ok(!err, 'a second Atlas.build passes assertTileTable' + (err ? ': ' + err.message : ''));
  const keep = NS.Blocks.TILE_COUNT; NS.Blocks.TILE_COUNT = keep + 1;
  let caught = false; try { A.assertTileTable(); } catch (e) { caught = /TILE_COUNT drift/.test(e.message); }
  NS.Blocks.TILE_COUNT = keep; if (caught) breaks++; else fails.push('break TILE_COUNT drift not caught'); }
ok(breaks === 4, 'all 4 breaks caught');
for (let i = 0; i < breaks; i++) console.log('   ✓ anti-vacuity: break ' + (i + 1) + ' caught');

if (fails.length) { console.log('FAIL ' + fails.length + '\n  ' + fails.join('\n  ')); process.exit(1); }
console.log(pass + ' checks passed, 0 failures');
