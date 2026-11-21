#!/usr/bin/env node
// offsetshapecheck.mjs -- #11403. Every block's model OFFSET (kind, hash, clamp) and whether its OUTLINE follows it,
// against the 1.18.2 decomp: block name -> class (Blocks.java) -> getOffsetType / getOutlineShape up the class chain.
// Vanilla: only Bamboo, BambooSapling, PointedDripstone and FlowerBlock outlines call getModelOffset; grass, fern, tall plants,
// roots, sprouts, small_dripleaf, hanging_roots and tall_seagrass are DRAWN offset but OUTLINED at the cell centre.
//   node tools/offsetshapecheck.mjs      ("<n> breaks caught")
import { readFileSync, existsSync } from 'node:fs';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const DEC = MCLITE_ROOT + '.decomp/net/minecraft/block/';
const read = (c) => (existsSync(DEC + c + '.java') ? readFileSync(DEC + c + '.java', 'utf8') : null);
const method = (src, name) => { const i = src.indexOf(' ' + name + '('); if (i < 0) return null; let d = 0, j = src.indexOf('{', i); const s = j; for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(s, j); };
const blocksSrc = read('Blocks');
const clsOf = new Map();
for (const m of blocksSrc.matchAll(/"(\w+)",\s*new (\w+)\(/g)) clsOf.set(m[1], m[2]);
const memo = new Map();
function facts(cls) {   // { type: 0|1|2, vmult, hmax, outlineOffset }
  if (memo.has(cls)) return memo.get(cls);
  const src = read(cls); let f;
  if (!src) f = { type: 0, vmult: 0.2, hmax: 0.25, out: false };
  else {
    const sup = (src.match(/class \w+ extends (\w+)/) || [])[1];
    const p = sup && sup !== 'Object' ? facts(sup) : { type: 0, vmult: 0.2, hmax: 0.25, out: false };
    f = { ...p };
    const t = method(src, 'getOffsetType'); if (t) f.type = +t.match(/field_1065([567])/)[1] === 6 ? 0 : +t.match(/field_1065([567])/)[1] === 7 ? 1 : 2;
    const v = method(src, 'getVerticalModelOffsetMultiplier'); if (v) f.vmult = +v.match(/([\d.]+)F/)[1];
    const h = method(src, 'getMaxHorizontalModelOffset'); if (h) f.hmax = +h.match(/([\d.]+)F/)[1];
    const o = method(src, 'getOutlineShape'); if (o) f.out = o.includes('getModelOffset');
  }
  memo.set(cls, f); return f;
}
function vanillaOffset(f, x, z) {
  const M = (1n << 64n) - 1n, s64 = (v) => BigInt.asIntN(64, v);
  const xi = BigInt.asIntN(32, BigInt(x) * 3129871n);
  let h = s64(xi ^ (BigInt(z) * 116129781n));
  h = s64(h * h * 42317861n + h * 11n); h = h >> 16n;
  const fl = Math.fround, cl = (v, m) => Math.max(-m, Math.min(m, v));
  const a = Number(h & 15n), b = Number((h >> 4n) & 15n), c = Number((h >> 8n) & 15n);
  return [cl((fl(a / 15) - 0.5) * 0.5, fl(f.hmax)), f.type === 2 ? (fl(b / 15) - 1) * fl(f.vmult) : 0, cl((fl(c / 15) - 0.5) * 0.5, fl(f.hmax))];
}
const POS = [[0, 0], [1, 0], [0, 1], [7, -3], [-12, 5], [100, 200], [-1234, 987], [33333, -44444], [5, 5], [-1, -1]];
function verify(NS) {
  const R = NS.Reg, S = NS.States, fails = []; let n = 0;
  const no = (c, m) => { n++; if (!c) fails.push(m); };
  const out = [0, 0, 0]; let kinds = 0;
  for (let s = 1; s < S.count; s++) {
    const b = S.block[s], name = R.names[b], cls = clsOf.get(name);
    if (!cls) continue;
    const f = facts(cls);
    if (f.type) kinds++;
    const has = S.modelOffset(s, 0, 0, out);
    no(has === (f.type !== 0), name + ': offset kind (vanilla ' + f.type + ', engine ' + has + ')');
    no(S.outlineFollowsOffset(s) === (f.type !== 0 && f.out), name + ': outline follows offset (vanilla ' + (f.type !== 0 && f.out) + ')');
    if (!f.type) continue;
    if (s > 1 && S.block[s - 1] === b) continue;   // one state per block is enough for the offset maths
    for (const [x, z] of POS) {
      const want = vanillaOffset(f, x, z); S.modelOffset(s, x, z, out);
      no(want.every((v, i) => Math.abs(v - out[i]) < 1e-6), name + ' @' + x + ',' + z + ': offset ' + out.map((v) => v.toFixed(4)) + ' vs vanilla ' + want.map((v) => v.toFixed(4)));
    }
  }
  // shapeAt: an outline that follows the offset moves by (offset(p) - offset(0)); one that does not never moves
  for (let s = 1; s < S.count; s++) {
    const b = S.block[s], cls = clsOf.get(R.names[b]); if (!cls || s > 1 && S.block[s - 1] === b) continue;
    const f = facts(cls); if (!f.type) continue;
    const base = NS.Ray.shapeAt(s, 0, 0, 0), moved = NS.Ray.shapeAt(s, 7, 64, -3);
    if (!base || !moved || base === NS.Physics.FULL_CUBE) continue;
    const o0 = vanillaOffset(f, 0, 0), o1 = vanillaOffset(f, 7, -3);
    const d = (moved[0][0] - base[0][0]);
    const want = f.out ? o1[0] - o0[0] : 0;
    no(Math.abs(d - want) < 1e-6, R.names[b] + ': outline x shift ' + d.toFixed(4) + ', vanilla ' + want.toFixed(4));
  }
  return { fails, n, kinds };
}
const FILES = ['02f_tags.js', '02g_items.js', '14b_physics.js', '14c_raycast.js'];
const BREAKS = [
  ['outline follows every offset block again (the #11403 bug)', (f, s) => (f === '14c_raycast.js' ? s.replace('|| !S.outlineFollowsOffset(id)', '') : s)],
  ['tall_seagrass not offset', (f, s) => (f === '02c_states.js' ? s.replace("'tall_seagrass', 'sunflower'", "'sunflower'") : s)],
  ['hash constant wrong', (f, s) => (f === '02c_states.js' ? s.replace('116129781', '116129783') : s)],
  ['grass loses its vertical offset', (f, s) => (f === '02c_states.js' ? s.replace("var OFFSET_XYZ = ['grass', 'fern', 'small_dripleaf']", "var OFFSET_XYZ = ['fern', 'small_dripleaf']") : s)],
  ['dripstone clamp is 0.25', (f, s) => (f === '02c_states.js' ? s.replace("=== 'pointed_dripstone' ? 0.125", "=== 'pointed_dripstone' ? 0.25") : s)],
];
const good = verify(loadEngine({ extra: FILES }));
console.log('offsetshapecheck: ' + good.kinds + ' offset states, ' + good.n + ' assertions, ' + good.fails.length + ' failures');
good.fails.slice(0, 12).forEach((m) => console.log('  ✗ ' + m));
let caught = 0, bad = good.fails.length;
for (const [why, patch] of BREAKS) {
  const r = verify(loadEngine({ extra: FILES, patch }));
  if (r.fails.length) { caught++; console.log('   ✓ break caught: ' + why + ' (' + r.fails.length + ')'); } else { bad++; console.log('   ✗ NOT caught: ' + why); }
}
console.log('offsetshapecheck: ' + good.n + ' assertions, ' + good.fails.length + ' failures, ' + caught + ' breaks caught');
process.exit(bad ? 1 : 0);
