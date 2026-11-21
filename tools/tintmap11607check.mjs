#!/usr/bin/env node
// tintmap11607check.mjs — #11607: proves 06b_tintmap.js BiomeColors/ColorResolver stand-in (Tint.blendColor, the
// (2r+1)^2 per-channel integer mean) through the entry point Tint.fillChunk -> Tint.sample, with SOURCE breaks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const F = '06b_tintmap.js';
const FILES = ['00_ns.js', '01_util.js', '01b_inflate.js', '02d_wgdata.js', '03b_noise.js', '04g_biomes.js', '10_gfx.js', F];
const meta = (f) => JSON.parse(readFileSync(join(ROOT, 'assets', f), 'utf8'));
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const NS = { CFG: {} }; globalThis.MCL = NS; NS.Settings = { biomeBlendRadius: 0 };
  for (const f of FILES) { let s = readFileSync(join(ROOT, 'src', f), 'utf8'); if (patch) s = patch(f, s); new Function('MCL', s)(NS); }
  NS.WG.init({ worldgen: readFileSync(join(ROOT, 'assets/worldgen.bin')).toString('base64'), worldgenBytes: meta('worldgen.meta.json').jsonBytes });
  NS.Biomes.initColormaps({ colormaps: readFileSync(join(ROOT, 'assets/colormaps.bin')).toString('base64'), colormapsBytes: meta('colormaps.meta.json').rawBytes });
  NS.Biomes.init();
  const B = NS.Biomes, T = NS.Tint, o = {};
  T.init();
  let A = -1, Bb = -1;
  for (let i = 0; i < 60 && Bb < 0; i++) { try { if (A < 0) A = i; else if (B.tintColor(1, i, 0, 0) !== B.tintColor(1, A, 0, 0) && B.tintColor(3, i, 0, 0) !== B.tintColor(3, A, 0, 0)) Bb = i; } catch (e) {} }
  const bAt = (x, z) => (x < 100 ? A : Bb);
  const mean = (ch, wx, wz, r) => { let R = 0, G = 0, Q = 0, n = 0;
    for (let z = wz - r; z <= wz + r; z++) for (let x = wx - r; x <= wx + r; x++) { const c = B.tintColor(ch, bAt(x, z), x, z); R += c >> 16 & 255; G += c >> 8 & 255; Q += c & 255; n++; }
    return (Math.floor(R / n) << 16) | (Math.floor(G / n) << 8) | Math.floor(Q / n); };
  NS.World = { biomeAt: bAt };
  T.anchor(96, 0);
  const col = new Uint8Array(256); for (let i = 0; i < 256; i++) col[i] = bAt(96 + (i & 15), i >> 4);
  const fill = (r) => { NS.Settings.biomeBlendRadius = r; return T.fillChunk(6, 0, col); };
  o.distinct = Bb >= 0;
  o.filled = fill(0) === true;
  o.r0 = [1, 2, 3].every((ch) => T.sample(ch, 98, 2) === B.tintColor(ch, A, 98, 2));
  let all = true;
  for (const r of [1, 2, 3, 7]) { fill(r); for (const ch of [1, 2, 3]) if (T.sample(ch, 98, 2) !== mean(ch, 98, 2, r)) all = false; }
  o.mean = all;
  fill(2); o.r2border = T.sample(1, 98, 2) !== B.tintColor(1, A, 98, 2) && T.sample(2, 98, 2) === mean(2, 98, 2, 2);
  NS.Settings = undefined; o.defaultRadius = T.radius() === 2;
  NS.Settings = { biomeBlendRadius: 99 }; o.clampHi = T.radius() === 7;
  NS.Settings = { biomeBlendRadius: -3 }; o.clampLo = T.radius() === 0;
  return o;
}
const A = trial(null);
for (const k of Object.keys(A)) ok(A[k], 'scenario ' + k + ' ' + JSON.stringify(A));
const BR = [
  ['sumDivide', '((R / n) | 0) << 16', '((R / (n + 1)) | 0) << 16', ['mean']],
  ['greenChan', '((G / n) | 0) << 8', '((R / n) | 0) << 8', ['mean']],
  ['loopRadius', 'for (var dx = -r; dx <= r; dx++)', 'for (var dx = -r; dx < r; dx++)', ['mean']],
  ['r0Shortcut', 'if (r <= 0) return B.tintColor(channel, biomeAt(wx, wz), wx, wz);', 'if (r <= 0) return B.tintColor(channel, biomeAt(wx + 4, wz), wx, wz);', ['r0']],
  ['radiusDefault', "r === undefined ? 2 :", "r === undefined ? 1 :", ['defaultRadius']],
  ['radiusClamp', 'Math.min(7, r | 0)', 'Math.min(9, r | 0)', ['clampHi']],
  ['fillRadius', 'r = T.radius();', 'r = 0;', ['mean', 'r2border']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((f, s) => { if (f === F && s.includes(a)) { hit = true; return s.replace(a, b); } return s; }); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key + ' ' + JSON.stringify(X));
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `tintmap11607check: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
