#!/usr/bin/env node
// treefeature11605check.mjs — #11605: proves 04k_feat_trees.js's TreeFeature driver (the `minecraft:tree` run: height draw,
// free test, trunk + foliage placers, ground dirt, leaf distances) through its entry Features.compile('oak').run, with SOURCE breaks.
import { loadEngine } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const F = '04k_feat_trees.js';
function trial(patch) {
  const M = loadEngine({ extra: ['02f_tags.js'], ...(patch ? { patch } : {}) });
  M.Gen.init(1337, Object.assign(M.Gen.defaults(), { climate: 'vanilla' }));
  const SR = M.States, R = M.Reg, Ft = M.Features, H = M.CFG.CHUNK_H, MINY = M.CFG.WORLD_MIN_Y;
  const st = (n) => SR.stateOf(n), name = (s) => R.names[SR.block[s]];
  const idx = (x, y, z) => ((y - MINY) << 8) | (z << 4) | x;
  const mk = (stoneAt) => {
    const SB = new Uint16Array(256 * H);
    for (let y = MINY + 1; y < 64; y++) for (let i = 0; i < 256; i++) SB[((y - MINY) << 8) | i] = st('dirt');
    if (stoneAt) SB[idx(8, 63, 8)] = st('stone');
    return SB;
  };
  const o = {};
  const logsOf = (SB) => { const l = []; for (let y = 64; y < 90; y++) for (let i = 0; i < 256; i++) if (name(SB[((y - MINY) << 8) | i]) === 'oak_log') l.push([i & 15, y, i >> 4]); return l; };
  const dist = (s) => +R.valueNames[SR.propValue(s, R.PROP.distance)];
  const heights = new Set(); let leavesMin = 1e9, allBase = true, allDist = true, adj1 = true, leavesN = 0, anyD7 = false, nonzeroRet = true, trunkCol = true;
  for (let seed = 1; seed <= 12; seed++) {
    const SB = mk(false), r = new M.Carvers.Rng(seed, seed * 31 + 7, 99);
    const n = Ft.compile('oak').run(SB, 0, 0, 8, 64, 8, r);
    const logs = logsOf(SB); heights.add(logs.length);
    nonzeroRet = nonzeroRet && n > 0; trunkCol = trunkCol && logs.every((l) => l[0] === 8 && l[2] === 8);
    allBase = allBase && name(SB[idx(8, 64, 8)]) === 'oak_log';
    let lv = 0;
    for (let y = 64; y < 100; y++) for (let i = 0; i < 256; i++) {
      const s = SB[((y - MINY) << 8) | i];
      if (name(s) !== 'oak_leaves') continue;
      lv++; const d = dist(s); if (d === 7) anyD7 = true;
      const x = i & 15, z = i >> 4;
      const touch = logs.some((l) => Math.abs(l[0] - x) + Math.abs(l[1] - y) + Math.abs(l[2] - z) === 1);
      if (touch && d !== 1) adj1 = false;
    }
    leavesMin = Math.min(leavesMin, lv); leavesN += lv;
  }
  o.heights = [...heights].every((h) => h >= 4 && h <= 6) && heights.size >= 2;   // oak: base 4 + rand(0..2)
  o.shape = nonzeroRet && trunkCol && allBase && leavesMin >= 50;   // the 4-row blob is 54+ in every seed; dropping a row gives 32
  o.dist = adj1 && !anyD7;
  // the ground under the trunk becomes dirt (vanilla dirt_provider) when it is stone
  { const SB = mk(true); Ft.compile('oak').run(SB, 0, 0, 8, 64, 8, new M.Carvers.Rng(3, 100, 99)); o.dirt = name(SB[idx(8, 63, 8)]) === 'dirt'; }
  // a solid block in the trunk's way is not overwritten (validTreePos), a leaf is
  { const SB = mk(false); SB[idx(8, 65, 8)] = st('stone'); Ft.compile('oak').run(SB, 0, 0, 8, 64, 8, new M.Carvers.Rng(3, 100, 99)); o.solid = name(SB[idx(8, 65, 8)]) === 'stone'; }
  // the same rng gives the same tree; another seed another one (rng order is fixed)
  const sig = (seed) => { const SB = mk(false); Ft.compile('oak').run(SB, 0, 0, 8, 64, 8, new M.Carvers.Rng(seed, seed * 31 + 7, 99)); let h = 0; for (let i = 0; i < SB.length; i++) h = (h * 31 + SB[i]) | 0; return h; };
  o.determ = sig(5) === sig(5) && new Set([1, 2, 3, 4, 5, 6].map(sig)).size > 2;
  return o;
}
const A = trial(null);
for (const k of Object.keys(A)) ok(A[k], 'scenario ' + k + ' ' + JSON.stringify(A));
const BR = [
  ['height', 'for (var i = 0; i < h; i++) logAt(T, x, y + i, z);\n        return [{ x: x, y: y + h, z: z, ro: 0', 'for (var i = 0; i < h - 1; i++) logAt(T, x, y + i, z);\n        return [{ x: x, y: y + h, z: z, ro: 0', ['heights', 'shape']],
  ['heightRoll', 'return base + r.nextInt(ra + 1) + r.nextInt(rb + 1);', 'return base + ra;', ['heights']],
  ['leafDist', 'F.LEAF_DISTANCES = true;', 'F.LEAF_DISTANCES = false;', ['dist']],
  ['freeSolid', 'return leafSet()[s] === 1;', 'return true;', ['solid']],
  ['groundDirt', "if (!T.forceDirt && T.isDirt(cur, x, y, z)) return;\n    T.n +=", "return;\n    T.n +=", ['dirt']],
  ['blobRows', 'for (var i = off; i >= off - fh; i--) {\n          var rad = bush ?', 'for (var i = off; i >= off - fh + 1; i--) {\n          var rad = bush ?', ['shape']],
  ['leafWrite', 'if (isFree(T, x, y, z)) T.n += A.setBlock(T.SB, T.cx, T.cz, x, y, z, st);\n  }\n\n  /**', 'if (false) T.n += A.setBlock(T.SB, T.cx, T.cz, x, y, z, st);\n  }\n\n  /**', ['shape']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((f, s) => { if (f === F && s.includes(a)) { hit = true; return s.replace(a, b); } return s; }); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key + ' ' + JSON.stringify(X));
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `treefeature11605check: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
