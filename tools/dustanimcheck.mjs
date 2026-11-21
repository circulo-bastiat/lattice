#!/usr/bin/env node
// dustanimcheck.mjs - #5774. Block-dust particles sample the LIVE atlas, so an animated sprite steps with
// Sprite.Animation.tick (decomp Sprite.java:316-333). A magma_block dust particle's 16x16 at tick 0 and tick 40 must
// equal the .mcmeta frame table (closed form, from assets/block-anim.*) at that tick; static stone's must not change.
// Both backends upload through Px._dustDirty, so this reads exactly the bytes either one would write.
// Anti-vacuity: a frozen first frame (no re-upload) and a wrong frame table are each caught.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, ASSETS } from './loadsrc.mjs';

globalThis.OffscreenCanvas = class { getContext() { return { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }; } };
const NS = loadEngine({ extra: ['06_atlas.js', '06b_tintmap.js', '07zx_particle.js'], dom: false });
NS.Blocks.init();
const A = NS.Atlas, Px = NS.Particle, R = NS.Reg;
const rd = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
const meta = rd('block-anim.meta.json'), bt = rd('block-tiles.meta.json');
Object.assign(NS.DATA, { blockTiles: b64('block-tiles.bin'), blockTilesBytes: bt.rawBytes, blockTilesCount: bt.count,
  blockAnim: b64('block-anim.bin'), blockAnimBytes: meta.rawBytes, blockAnimMeta: meta.anims });
{
  const pm = rd('particle-tex.meta.json');
  Object.assign(NS.DATA, { particleLayers: pm.layers, particleTile: pm.tile, particleTiles: b64('particle-tex.bin'), particleTilesBytes: pm.rawBytes });
}
A.build(1);
const pristine = A.mips.map((m) => m.data.slice());
const FB = 1024;
const st = (n) => R.realFirst[R.id[n]] + R.defaultState[R.id[n]];

let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

// expected pixels at tick t, closed form from the meta (no incremental state)
const strip = (() => { A.animInit(); const o = {}; for (const an of A.anims) o[an.id] = an; return o; })();
function expected(id, t, table) {
  const an = strip[id], fr = table || an.frames, total = fr.reduce((s, f) => s + f[1], 0);
  let r = t % total, i = 0;
  while (r >= fr[i][1]) { r -= fr[i][1]; i++; }
  const f = fr[i], a = A.animPix(an, f[0]);
  const nx = fr[(i + 1) % fr.length][0];
  if (!an.interpolate || r === 0 || f[0] === nx) return Uint8Array.from(a);
  const b = A.animPix(an, nx), d = 1 - r / f[1], out = new Uint8Array(FB);
  for (let k = 0; k < FB; k += 4) for (let c = 0; c < 3; c++) out[k + c] = d * a[k + c] + (1 - d) * b[k + c];
  for (let k = 3; k < FB; k += 4) out[k] = a[k];
  return out;
}

/** The bytes the particle's dust cell holds after `ticks` client ticks. `frozen` re-uploads nothing after tick 0. */
function sampled(blockName, ticks, { frozen = false } = {}) {
  A.mips.forEach((m, l) => m.data.set(pristine[l]));
  A.animInit();
  Px._resetLayerCacheForTest();
  Px.list.length = 0;
  const p = Px.spawnBlockDust(0, 0, 0, 0, 0, 0, st(blockName), 0, 0, 0, () => 0.5);
  const up = [], got = {};
  const grab = (layer, x, y, rgba) => { got.rgba = Uint8Array.from(rgba); };
  const slotOf = () => { Px.frameLayer(p); };
  slotOf();
  Px._dustDirty(up, grab);
  for (let t = 0; t < ticks; t++) { A.animTick(); if (!frozen) { slotOf(); Px._dustDirty(up, grab); } }
  return { tile: p.tile, rgba: got.rgba };
}
const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => v === b[i]);
const run = (opts = {}, table) => {
  const f = [];
  const t = (c, m) => { if (!c) f.push(m); };
  const s0 = sampled('magma_block', 0, opts), s40 = sampled('magma_block', 40, opts);
  t(s0.tile === strip['block/magma'].layer, 'magma_block dust tile is the animated magma tile');
  t(same(s0.rgba, expected('block/magma', 0, table)), 'tick 0 equals frame table at 0');
  t(same(s40.rgba, expected('block/magma', 40, table)), 'tick 40 equals frame table at 40');
  t(!same(s0.rgba, s40.rgba), 'tick 0 and tick 40 differ');
  const l0 = sampled('sea_lantern', 0, opts), l40 = sampled('sea_lantern', 40, opts);
  t(same(l40.rgba, expected('block/sea_lantern', 40, table)), 'sea_lantern tick 40 equals frame table');
  const a = sampled('stone', 0, opts), b = sampled('stone', 40, opts);
  t(same(a.rgba, b.rgba), 'static stone does not change');
  return f;
};
const real = run();
ok(real.length === 0, 'real run: ' + real.join('; '));
const frozen = run({ frozen: true });
if (frozen.length) { breaks++; console.log("   ✓ anti-vacuity: frozen first frame caught"); } else fails.push('frozen first frame was NOT caught');
const bad = strip['block/magma'].frames.map((f) => [f[0], f[1] + 1]);
const wrongTable = run({}, bad);
if (wrongTable.length) { breaks++; console.log("   ✓ anti-vacuity: wrong frame table caught"); } else fails.push('wrong frame table was NOT caught');
console.log(` assertions passed .. ${pass}\n failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(` ${breaks} breaks caught`);
process.exit(fails.length || breaks < 2 ? 1 : 0);
