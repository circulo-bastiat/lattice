#!/usr/bin/env node
// #11528: net/minecraft/util/math/BlockBox (BlockBox.rotated / intersects, in 04y_struct_nether_fortress.js) is wired:
// NetherFortress.generate -> tryCreate builds every piece box with rotated() and rejects overlaps with intersects().
//   1. every generated piece box has the BOX size, rotated per direction (N/S: sx x sz; E/W: sz x sx)
//   2. no two pieces of one fortress overlap (BlockBox.intersects)
//   3. anti-vacuity: cutting the W case of rotated, or making intersects always false, fails 1 / 2
import { loadEngine } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const M = loadEngine({ dom: false, ...(patch ? { patch } : {}) });
  const F = M.NetherFortress; let sizeBad = 0, overlap = 0, n = 0;
  for (let s = 0; s < 12; s++) {
    const g = F.generate(new M.Noise.LegacyRandom(BigInt(s * 7919 + 1)), s * 3 - 5, s - 4);
    const P = g.pieces;
    for (const p of P) {
      n++;
      const o = F.BOX[p.kind]; if (!o) continue;
      const dx = p.bb[3] - p.bb[0] + 1, dz = p.bb[5] - p.bb[2] + 1, ns = p.dir === 0 || p.dir === 2;
      if (dx !== (ns ? o[3] : o[5]) || dz !== (ns ? o[5] : o[3]) || p.bb[4] - p.bb[1] + 1 !== o[4]) sizeBad++;
    }
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
      const a = P[i].bb, b = P[j].bb;
      if (a[3] >= b[0] && a[0] <= b[3] && a[5] >= b[2] && a[2] <= b[5] && a[4] >= b[1] && a[1] <= b[4]) overlap++;
    }
  }
  return { n, sizeBad, overlap };
}
const A = trial();
ok(A.n > 100, 'fortresses generate pieces (' + A.n + ')');
ok(A.sizeBad === 0, 'piece boxes match BlockBox.rotated sizes (' + A.sizeBad + ' bad)');
ok(A.overlap === 0, 'no piece boxes intersect (' + A.overlap + ')');
const cuts = [
  ['case W: return [x - sz + 1 + oz, y + oy, z + ox, x + oz,', 'case W: return [x - sz + oz, y + oy, z + ox, x + oz,'],
  ['return a[3] >= b[0] &&', 'return false && a[3] >= b[0] &&'],
];
for (const [a, b] of cuts) {
  breaks++;
  let got;
  try { got = trial((f, t) => f === '04y_struct_nether_fortress.js' ? (t.includes(a) ? t.replace(a, b) : (() => { throw new Error('cut not found: ' + a); })()) : t); }
  catch (e) { if (/cut not found/.test(e.message)) { fails.push(e.message); continue; } got = { sizeBad: 1 }; }
  ok(got.sizeBad > 0 || got.overlap > 0, 'anti-vacuity: cutting `' + a + '` must fail');
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `${pass} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
