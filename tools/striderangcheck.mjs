#!/usr/bin/env node
// striderangcheck.mjs — #933: StriderEntityModel.setAngles (ER.striderDelta) vs the .decomp formulas.
import { loadEngine } from './loadsrc.mjs';
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const near = (a, b) => Math.abs(a - b) <= 1e-6;
const M = loadEngine({ extra: ['07j_entityrender.js'], dom: false, initReg: false });
const ER = M.EntityRender;
console.log('striderangcheck — #933: strider setAngles');
function expected(l, a, age, ridden, yaw, pitch) {
  a = Math.min(0.25, a); const D = Math.PI / 180, P = Math.PI, q = l * 1.5 * 0.5, o = {};
  o.body = { rx: ridden ? 0 : pitch * D, ry: ridden ? 0 : yaw * D, rz: 0.1 * Math.sin(l * 1.5) * 4 * a, dpy: 2 - 2 * Math.cos(l * 1.5) * 2 * a - 1 };
  o.left_leg = { rx: Math.sin(q) * 2 * a, rz: P / 18 * Math.cos(q) * a, dpy: 2 * Math.sin(q + P) * 2 * a };
  o.right_leg = { rx: Math.sin(q + P) * 2 * a, rz: P / 18 * Math.cos(q + P) * a, dpy: 2 * Math.sin(q) * 2 * a };
  const c = Math.cos(l * 1.5 + P) * a, w = (k, s) => k * Math.sin(age * s);
  o.right_bottom_bristle = { rz: c * 1.3 + w(0.05, -0.4) }; o.left_bottom_bristle = { rz: c * 1.3 + w(0.05, -0.4) };
  o.right_middle_bristle = { rz: c * 1.2 + w(0.1, 0.2) }; o.left_middle_bristle = { rz: c * 1.2 + w(0.1, 0.2) };
  o.right_top_bristle = { rz: c * 0.6 + w(0.1, 0.4) }; o.left_top_bristle = { rz: c * 0.6 + w(0.1, 0.4) };
  return o;
}
function run(fn) {
  let bad = 0;
  for (const [l, a, age, rid] of [[3.7, 0.6, 41.3, false], [1.1, 0.1, 7, true], [9, 0.25, 100, false]]) {
    const ex = expected(l, a, age, rid, 25, -12);
    for (const p in ex) {
      const d = fn(p, l, a, 25, -12, age, { ridden: rid });
      for (const k in ex[p]) if (!d || !near(d[k], ex[p][k])) bad++;
    }
  }
  return bad;
}
const real = (p, l, a, y, pi, age, s) => ER.striderDelta(p, l, a, y, pi, age, s);
ok(run(real) === 0, 'striderDelta matches the decomp formulas');
ok(ER.setupAnimDelta('body', 3, 0.5, 0, 0, false, 'quadruped', { strider: { ridden: false }, ageInTicks: 0 }).dpy !== undefined, 'setupAnimDelta routes strider');
{ const g = (l) => ER.setupAnimDelta('left_leg', l, 0.25, 0, 0, false, 'quadruped', { strider: { ridden: false }, ageInTicks: 0 });
  ok(g(0).rx !== g(1.5).rx, 'strider leg pose differs at limbSwing 0 vs 1.5'); }
const breakers = [
  (p, ...r) => { const d = real(p, ...r); return d && { ...d, rz: d.rz + 0.01 }; },
  (p, l, a, ...r) => real(p, l, a * 2, ...r),
  (p, l, a, y, pi, age, s) => real(p, l, a, y, pi, age, { ridden: !s.ridden }),
  (p, l, a, y, pi, age, s) => real(p, l, a, y, pi, 0, s),
];
for (const b of breakers) { breaks++; if (run(b) > 0) { pass++; console.log('   ✓ broken model caught'); } else fails.push('anti-vacuity: a broken strider model passed'); }
if (fails.length) { console.log(fails.map((f) => '  ✗ ' + f).join('\n')); console.log(`FAIL ${fails.length}`); process.exit(1); }
console.log(`PASS ${pass} checks (${breaks} breaks caught)`);
