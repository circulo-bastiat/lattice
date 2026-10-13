#!/usr/bin/env node
// itemframedrawcheck.mjs — G17-HG8 (#5708): ItemFrameEntityRenderer's held-item matrix.
// Rotation 0..7 on all four facings equals vanilla's formula (.decomp ItemFrameEntityRenderer.render),
// computed here point-by-point, independent of ER's matrix algebra. Anti-vacuity: 360/7 per step must fail.
import { loadEngine } from './loadsrc.mjs';
console.log('itemframedrawcheck — G17-HG8, item frame held-item matrix');
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07h_entities.js', '07i_entitylist.js', '07j_entityrender.js'], initReg: false });
M.EntityRender.init();
const ER = M.EntityRender;
let bad = 0, n = 0;
const FX = [0, -1, 0, 1], FZ = [1, 0, -1, 0], P = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.3, -0.7, 0.9]];
function vanilla(p, facing, rot, inv, map) {
  const r = map ? (rot % 4) * 2 : rot, a = r * 360 / 8 * Math.PI / 180, th = (180 - facing * 90) * Math.PI / 180;
  let x = p[0] * 0.5, y = p[1] * 0.5, z = p[2] * 0.5;
  [x, y] = [Math.cos(a) * x - Math.sin(a) * y, Math.sin(a) * x + Math.cos(a) * y];
  z += inv ? 0.5 : 0.4375;
  [x, z] = [Math.cos(th) * x + Math.sin(th) * z, -Math.sin(th) * x + Math.cos(th) * z];
  return [x + FX[facing] * 0.46875 - 0.3 * FX[facing], y + 0.25, z + FZ[facing] * 0.46875 - 0.3 * FZ[facing]];
}
function run(step) {
  let fails = 0;
  for (let f = 0; f < 4; f++) for (let r = 0; r < 8; r++) for (const inv of [false, true]) for (const map of [false, true]) {
    const A = ER.itemFrameItemAffine(f, r, inv, map, step);
    for (const p of P) {
      const w = vanilla(p, f, r, inv, map), R = A.R;
      const g = [R[0] * p[0] + R[1] * p[1] + R[2] * p[2] + A.t[0], R[3] * p[0] + R[4] * p[1] + R[5] * p[2] + A.t[1], R[6] * p[0] + R[7] * p[1] + R[8] * p[2] + A.t[2]];
      n++; if (g.some((v, i) => Math.abs(v - w[i]) > 1e-5)) fails++;
    }
  }
  return fails;
}
bad += run();
console.log(' ' + n + ' points, ' + bad + ' mismatches');
if (ER.itemFrameItemLight('glow_item_frame', 0) !== (15 << 4 | 15 << 20) || ER.itemFrameItemLight('item_frame', 77) !== 77 ||
    ER.itemFrameBlockLight('glow_item_frame', 2) !== 5 || ER.itemFrameBlockLight('glow_item_frame', 9) !== 9 || ER.itemFrameBlockLight('item_frame', 2) !== 2) { bad++; console.log(' light wrong'); }
const broken = run(360 / 7);
console.log(' ✓ ' + (broken > 0 ? 1 : 0) + ' breaks caught (360/7 per step: ' + broken + ' mismatches)');
if (!broken) bad++;
console.log((bad ? "FAIL" : "PASS") + "  itemframedrawcheck: " + n + " assertions, " + bad + " failures, 1 breaks caught");
process.exit(bad ? 1 : 0);
