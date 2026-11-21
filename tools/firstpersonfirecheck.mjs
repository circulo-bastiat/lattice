#!/usr/bin/env node
// firstpersonfirecheck.mjs -- #7952: InGameOverlayRenderer.renderFireOverlay. Pure vertex list against the vanilla
// numbers, the gate (burning / spectator / fire-immune), and anti-vacuity ("<n> breaks caught").
import { loadEngine, initRegistry } from './loadsrc.mjs';
const M = loadEngine({ extra: ['14e_gamemode.js', '14k_hand3d.js'], dom: false });
initRegistry(M);
const H3 = M.Hand3D, F = H3.FLOATS_PER_VERTEX;
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL ' + m); } };
const near = (a, b) => Math.abs(a - b) < 1e-5;

// vanilla: translate(-(i*2-1)*0.24, -0.3, 0), rotateY((i*2-1)*10deg), corners (+-0.5, +-0.5, -0.5)
function expected(i) {
  const s = i * 2 - 1, a = s * 10 * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a), out = [];
  for (const [x, y, u, v] of [[-.5, -.5, 1, 1], [.5, -.5, 0, 1], [.5, .5, 0, 0], [-.5, .5, 1, 0]])
    out.push([-s * 0.24 + c * x + sn * -0.5, -0.3 + y, -sn * x + c * -0.5, u, v]);
  return out;
}
function verts() {
  const v = H3.fireOverlayVerts(338), bad = [];
  for (let i = 0; i < 2; i++) {
    const e = expected(i);
    [0, 1, 2, 0, 2, 3].forEach((j, k) => {
      const o = (i * 6 + k) * F;
      for (let d = 0; d < 5; d++) if (!near(v[o + d], e[j][d])) bad.push(`q${i}v${k}d${d}`);
      if (v[o + 5] !== 338) bad.push('layer');
    });
  }
  return bad;
}
function gates() {
  const S = M.Gamemode.SPECTATOR, bad = [];
  if (H3.fireOverlay({ isOnFire: false, mode: 0 }, 338)) bad.push('not burning drew');
  if (H3.fireOverlay({ isOnFire: true, mode: S }, 338)) bad.push('spectator drew');
  const p = { isOnFire: false, mode: 1, flying: true, remainingFireTicks: 0 };
  if (H3.fireOverlay(p, 338)) bad.push('immune creative flyer drew');
  p.isOnFire = true;
  const f = H3.fireOverlay(p, 338);
  if (!f || f.quads !== 2 || f.floats !== 2 * 6 * F) bad.push('burning did not draw');
  p.isOnFire = false;
  if (H3.fireOverlay(p, 338)) bad.push('drew after extinguish');
  return bad;
}
const b1 = verts(), b2 = gates();
ok(!b1.length, 'vertex list: ' + b1.slice(0, 4));
ok(!b2.length, 'gate: ' + b2);
// anti-vacuity: break the offset, the gate; each must be caught
let caught = 0;
const old = H3.FIRE_OFFSET_X; H3.FIRE_OFFSET_X = 0.25; if (verts().length) caught++; H3.FIRE_OFFSET_X = old;
const oldF = H3.fireOverlay; H3.fireOverlay = (p, l) => oldF({ isOnFire: true, mode: 0 }, l);
if (gates().length) caught++; H3.fireOverlay = oldF;
const oldR = H3.FIRE_ROT_Y; H3.FIRE_ROT_Y = 11; if (verts().length) caught++; H3.FIRE_ROT_Y = oldR;
ok(caught === 3, 'breaks caught ' + caught);
console.log(fails ? `${fails} FAILED` : `firstpersonfirecheck: ok, ${caught} breaks caught`);
process.exit(fails ? 1 : 0);
