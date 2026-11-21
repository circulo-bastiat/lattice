#!/usr/bin/env node
// endcity04zproofcheck.mjs — #11703: proves 04z_struct_end_city.js's 3 classes through the real chunk path G.genColumn(the_end):
// EndCityGenerator (EC.generate layout: base_floor + towers/ship pieces), SimpleStructurePiece (templatePiece blocks written: purpur),
// EndCityFeature (register 'endcity' start + endHeight gate). Each cut by a source patch.
import { loadEngine } from './loadsrc.mjs';
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const at = (c, wx, wy, wz) => { const s = c.sec[(wy + 64) >> 4], i = (((wy + 64) & 15) << 8) | ((wz & 15) << 4) | (wx & 15);
  if (s.u >= 0) return s.u; const bits = s.b, per = 32 / bits; return s.p[(s.d[Math.floor(i / per)] >>> ((i % per) * bits)) & ((1 << bits) - 1)]; };
function trial(patch) {
  const M = loadEngine(patch ? { patch } : {}), o = {};
  M.Gen.init(12345, { structures: true }); M.Dim.cur = 'the_end';
  let st; try { st = M.Structures.startsNear(-16, -157).find((s) => s.def.name === 'end_city'); } catch { st = null; }
  o.feature = !!st;
  o.generator = !!st && st.pieces.length >= 4 && new Set(st.pieces.map((p) => p.name || p.tpl || '')).size >= 1;
  let purpur = 0;
  if (st) { const p0 = st.pieces[0];
    for (let cx = p0.x0 >> 4; cx <= p0.x1 >> 4; cx++) for (let cz = p0.z0 >> 4; cz <= p0.z1 >> 4; cz++) {
      const c = M.Gen.genColumn(cx, cz);
      for (let y = 0; y < 256; y++) for (let k = 0; k < 256; k++) { const s = at(c, k & 15, y, k >> 4); if (s && /purpur/.test(M.States.name(s))) purpur++; } } }
  o.pieceBlocks = purpur > 0;
  M.Dim.cur = 'overworld';
  return o;
}
const A = trial(null);
for (const k of Object.keys(A)) ok(A[k], 'scenario ' + k + ' ' + JSON.stringify(A));
const F = '04z_struct_end_city.js';
const BR = [
  ['feature', "if (h < 60) return null;", "return null;"],
  ['generator', "return EC.pieces(r, (start.cx << 4) + 8, h, (start.cz << 4) + 8, r.nextInt(4));", "return [];"],
  ['pieceBlocks', "var n = NS.StructSurface.write(SB, cx, cz, p), G = NS.Gen, ms = p.markers;", "var n = 0, G = NS.Gen, ms = p.markers;"],
];
let breaks = 0;
for (const [key, a, b] of BR) {
  let hit = false, B;
  try { B = trial((f, s) => { if (f === F && s.includes(a)) { hit = true; return s.replace(a, b); } return s; }); } catch { B = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  ok(!B[key], 'anti-vacuity: break ' + key);
  if (!B[key]) { breaks++; console.log('  ✓ break caught: ' + key); }
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `endcity04zproofcheck: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
