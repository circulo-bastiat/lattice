#!/usr/bin/env node
// offhandeatanimcheck.mjs — G19d-c: the OFFHAND eat/drink pose vs HeldItemRenderer.applyEatOrDrinkTransformation
// + applyEquipOffset (arm sign = arm == RIGHT ? 1 : -1; the offhand arm is the opposite of the main arm).
// Reference: an independent row-major matrix build straight from the .decomp formulas.
import { loadEngine } from './loadsrc.mjs';
const MCL = loadEngine({ extra: ['02g_items.js', '14f_inventory.js', '14i_hand.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07j_entityrender.js', '14k_hand3d.js'], dom: false });
const H3 = MCL.Hand3D;
const I = () => [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]];
const mul = (a, b) => a.map((r, i) => b[0].map((_, j) => r.reduce((s, _v, k) => s + a[i][k] * b[k][j], 0)));
const T = (x, y, z) => { const m = I(); m[0][3] = x; m[1][3] = y; m[2][3] = z; return m; };
const R = (ax, d) => { const a = d * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), m = I();
  if (ax === 'x') { m[1][1] = c; m[1][2] = -s; m[2][1] = s; m[2][2] = c; }
  if (ax === 'y') { m[0][0] = c; m[0][2] = s; m[2][0] = -s; m[2][2] = c; }
  if (ax === 'z') { m[0][0] = c; m[0][1] = -s; m[1][0] = s; m[1][1] = c; } return m; };
function ref(left, max, equipped, sg) {
  let m = I(); const f = left / max;
  if (f < 0.8) m = mul(m, T(0, Math.abs(Math.cos(left / 4 * Math.PI) * 0.1), 0));
  const g = 1 - Math.pow(f, 27);
  m = mul(m, T(g * 0.6 * sg, g * -0.5, 0));
  m = mul(m, R('y', sg * g * 90)); m = mul(m, R('x', g * 10)); m = mul(m, R('z', sg * g * 30));
  return mul(m, T(sg * 0.56, -0.52 + equipped * -0.6, -0.72));
}
function maxDiff(m16, r) { let d = 0; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) d = Math.max(d, Math.abs(m16[j * 4 + i] - r[i][j])); return d; }
let fails = [], pass = 0, breaks = 0;
const cases = [[32, 32, 0], [20, 32, 0.3], [10, 32, 0], [4, 32, 0.5], [1.5, 32, 0], [16, 16, 1]];
function run(label, fn) {
  let bad = 0;
  for (const [l, mx, eq] of cases) for (const main of [1, -1]) {
    const m = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
    fn(m, l, mx, eq, main);
    if (maxDiff(m, ref(l, mx, eq, -main)) > 1e-4) bad++;
  }
  return bad;
}
const real = (m, l, mx, eq, main) => H3.offhandEatPose(m, l, mx, eq, main);
const b0 = run('real', real);
if (b0) fails.push(b0 + ' offhand pose cases differ from the formulas'); else pass++;
if (H3.offhandSide(1) !== -1 || H3.offhandSide(-1) !== 1) fails.push('offhandSide');
// the main-hand (right, +1) path is unchanged
{ const m = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]); H3.applyEatOrDrinkTransformation(m, 10, 32); H3.applyItemArmTransform(m, 0.2);
  if (maxDiff(m, ref(10, 32, 0.2, 1)) > 1e-4) fails.push('main hand path changed'); else pass++; }
// anti-vacuity: each mutation must be caught
const muts = {
  'mirror sign wrong (main arm sign used)': (m, l, mx, eq, main) => { H3.applyEatOrDrinkTransformation(m, l, mx, main); },
  'x not mirrored': (m, l, mx, eq, main) => { H3.applyEatOrDrinkTransformation(m, l, mx, 1); },
  'equip offset not mirrored': (m, l, mx, eq, main) => { H3.applyEatOrDrinkTransformation(m, l, mx, -main); H3.applyItemArmTransform(m, eq); },
  'no eat transform': (m, l, mx, eq, main) => { H3.applyItemArmTransform(m, eq); },
};
for (const [n, fn] of Object.entries(muts)) { breaks++; if (run(n, fn) === 0) fails.push("anti-vacuity: mutation not caught: " + n); else console.log("   ✓ caught: " + n); }
console.log("\n================ offhandeatanimcheck ===============");
console.log(` assertions passed .. ${pass}\n failures ........... ${fails.length}\n breaks caught ...... ${breaks}\n==============================================`);
if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
