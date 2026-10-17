#!/usr/bin/env node
// beaconrendercheck.mjs — #5574: BeaconBlockEntityRenderer.renderBeam (.decomp): the quad prisms, radii 0.2/0.25,
// alpha 1 / 0.125, the 1024 cut, the time-based texture scroll, for a white and a red-glass beam.
import { loadEngine } from './loadsrc.mjs';
const M = loadEngine({ extra: ['07j_entityrender.js'], dom: false });
const ER = M.EntityRender, f = Math.fround;
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
console.log('beaconrendercheck — #5574: beacon beam vertex list');

const near = (a, b) => Math.abs(a - b) < 1e-5;
// values straight from the decomp, one segment [y0,y1], colour c, time t
function expect(y0, h, t, rIn, rOut) {
  const T = (t % 40), tt = -(T), q = f(tt * f(0.2)) - Math.floor(f(tt * f(0.1)));
  return { v2: -1 + (q - Math.floor(q)), y1: y0 + h, rIn, rOut, v1In: h * (0.5 / rIn) + (-1 + (q - Math.floor(q))) };
}
function verify(segs, time, rIn, rOut, label, strict) {
  const v = ER.beaconBeamVerts(segs, time, 0, rIn, rOut), bad = [];
  if (v.length !== segs.length * 32) bad.push('count ' + v.length);
  let y0 = 0;
  segs.forEach((s, i) => {
    const h = i === segs.length - 1 ? 1024 : s[3], e = expect(y0, h, time, 0.2, 0.25), b = i * 32;
    for (let k = 0; k < 32; k++) {
      const p = v[b + k]; if (!p) { bad.push('missing'); break; }
      const inner = k < 16, r = inner ? e.rIn : e.rOut;
      if (!(p[3] === s[0] && p[4] === s[1] && p[5] === s[2])) bad.push('colour');
      if (p[6] !== (inner ? 1 : 0.125)) bad.push('alpha');
      if (!near(p[1], k % 4 === 0 || k % 4 === 3 ? e.y1 : y0)) bad.push('y');
      const dx = p[0] - 0.5, dz = p[2] - 0.5;
      if (!near(Math.hypot(dx, dz), inner ? r : r * Math.SQRT2) && !near(Math.max(Math.abs(dx), Math.abs(dz)), r)) bad.push('radius');
      if (!(Math.abs(p[8] - ((k % 4 === 0 || k % 4 === 3) ? (inner ? e.v1In : h + e.v2) : e.v2)) < 1e-3)) bad.push('v');
      if (p[7] !== (k % 4 < 2 ? 1 : 0)) bad.push('u');
    }
    y0 += h;
  });
  if (strict) ok(!bad.length, label + ': ' + [...new Set(bad)].join(','));
  return bad.length === 0;
}
verify([[1, 1, 1, 5]], 7, 0.2, 0.25, 'white beam t=7', true);
const red = [[1, 1, 1, 3], [f(0.9764706), f(0.2901961), f(0.2), 4], [f(0.9), f(0.3), f(0.2), 2]];
verify(red, 23, 0.2, 0.25, 'red glass beam t=23', true);
verify(red, 0, 0.2, 0.25, 'red glass beam t=0', true);
// 1024 cut: only the last segment, regardless of its own height
{ const v = ER.beaconBeamVerts([[1, 1, 1, 2]], 0, 0); ok(Math.max(...v.map(p => p[1])) === 1024, 'last segment is 1024 tall'); }
// scroll: v moves with time and repeats every 40 ticks
{ const a = ER.beaconBeamVerts([[1, 1, 1, 1]], 3, 0), b = ER.beaconBeamVerts([[1, 1, 1, 1]], 43, 0), c = ER.beaconBeamVerts([[1, 1, 1, 1]], 4, 0);
  ok(a[1][8] === b[1][8] && a[1][8] !== c[1][8], 'texture scroll is time based, period 40'); }
// anti-vacuity: a changed radius must fail
for (const [ri, ro] of [[0.21, 0.25], [0.2, 0.26]]) {
  breaks++; ok(!verify([[1, 1, 1, 5]], 7, ri, ro, 'x', false), 'changed radius ' + ri + '/' + ro + ' is caught');
}
console.log(`assertions passed .. ${pass}\nfailures .. ${fails.length}`);
for (let i = 0; i < breaks; i++) console.log("✓ break caught");
console.log(`${breaks} breaks caught`);
if (fails.length) { fails.forEach((x) => console.log('  FAIL: ' + x)); process.exit(1); }
