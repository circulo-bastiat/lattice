#!/usr/bin/env node
// boatcheck.mjs — G18a-1 (#209): the boat model + its animation, headless. The PICTURE is spritecheck §3b.
//
//   node tools/boatcheck.mjs
//
//   1. tools/golden/boat-model-1.18.2.tsv is what BoatEntityModel.getTexturedModelData (.decomp) says
//      (re-parsed here) and the layer the engine loaded (assets/models.bin) is that table.
//   2. setPaddleAngle / interpolatePaddlePhase / the PoseStack matrix are BoatEntityModel /
//      BoatEntityRenderer / BoatEntity, re-derived independently in this file.
//   3. all six woods have a sheet in the atlas (FAMILY.boat), 'boat — G17c' is off ER.OWED.
// Every section breaks its own data and must notice ("✓" lines: the suite counts them as breaks caught).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { loadEngine, initRegistry, MCLITE_ROOT, ASSETS } from './loadsrc.mjs';
import { parseBoat } from './extract-boat.mjs';

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };

const M = loadEngine({
  extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07j_entityrender.js',
          '10_gfx.js', '15h_bemodel.js', '07zzt_boat.js', '02j_sounds.js'],
  dom: false
});
initRegistry(M);
{
  const mm = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'models.meta.json'), 'utf8'));
  M.BEModel.init({ models: readFileSync(join(MCLITE_ROOT, 'assets', 'models.bin')).toString('base64'), modelsBytes: mm.rawBytes });
}
const geo = readFileSync(join(MCLITE_ROOT, 'assets', 'mob-geometry.json'));
M.DATA = Object.assign({}, M.DATA, { mobGeometry: deflateRawSync(geo).toString('base64'), mobGeometryBytes: geo.length,
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.EntityRender.init();
const ER = M.EntityRender;
const near = (a, b, t = 1e-5) => Math.abs(a - b) <= t;

// ── 1. the boxes ────────────────────────────────────────────────────────────────────────────
console.log('boatcheck — G18a-1, boat model / paddle animation / pose');
const src = readFileSync(join(MCLITE_ROOT, '.decomp/net/minecraft/client/render/entity/model/BoatEntityModel.java'), 'utf8');
const rows = parseBoat(src);
ok(rows.length === 9, 'BoatEntityModel has 9 cuboids outside water_patch (' + rows.length + ')');
const L = M.BEModel.layer('boat');
ok(!!L && L.parts.length === 9, 'the engine loaded a `boat` layer of 9 boxes (' + (L && L.parts.length) + ')');
if (L) {
  rows.forEach((r, i) => {
    const p = L.parts[i];
    ok(p && p.n === r[1] && p.tu === +r[2] && p.tv === +r[3] && near(p.x, r[4]) && near(p.w, r[7]) && near(p.d, r[9]) &&
       near(p.px, r[10]) && near(p.ry, r[14]) && near(p.rz, r[15]), 'box ' + i + ' (' + r[1] + ') matches the decompiled model');
  });
  const bottom = L.parts.find((p) => p.n === 'bottom');
  ok(bottom && bottom.w === 28 && bottom.h === 16 && bottom.d === 3 && near(bottom.rx, Math.PI / 2), 'bottom is 28x16x3 rotated pitch pi/2');
  const wrong = rows.map((r) => r.slice()); wrong[0][7] = 27;
  okAv(!(L.parts[0] && near(L.parts[0].w, wrong[0][7])), 'a 27-wide bottom no longer matches the loaded layer');
}
okAv(parseBoat(src.replace('28.0F, 16.0F, 3.0F', '28.0F, 16.0F, 4.0F'))[0][9] === 4, 'the parser sees an edited box (d 3 -> 4)');
ok(parseBoat(src).every((r) => r[1] !== 'water_patch'), 'water_patch (depth-only mask) is not a drawn box');
ok(ER.OWED_BOAT.length === 0 && typeof ER.buildWaterMask === 'function', 'and it is drawn depth-only by ER.buildWaterMask (#5723), nothing owed on ER.OWED_BOAT');

// ── 2. the animation ────────────────────────────────────────────────────────────────────────
const cl = (a, b, t) => a + (b - a) * Math.min(1, Math.max(0, t));
for (const phase of [0, 0.7, 1.9, 3.3, 5.0]) for (const i of [0, 1]) {
  const a = ER.boatPaddleAngles(phase, i);
  const pitch = cl(-Math.PI / 3, -Math.PI / 12, (Math.sin(-phase) + 1) / 2);
  let yaw = cl(-Math.PI / 4, Math.PI / 4, (Math.sin(-phase + 1) + 1) / 2);
  if (i === 1) yaw = Math.PI - yaw;
  ok(near(a.pitch, pitch) && near(a.yaw, yaw), 'paddle ' + i + ' at phase ' + phase + ' matches setPaddleAngle');
}
{
  const e = { paddlePhases: [2, 3], paddleMoving: [true, false] };
  ok(near(ER.boatPaddlePhase(e, 0, 0.5), 2 - Math.PI / 16), 'a moving paddle interpolates phase-pi/8 .. phase');
  ok(ER.boatPaddlePhase(e, 1, 0.5) === 0, 'a still paddle is at phase 0');
  okAv(!near(ER.boatPaddlePhase({ paddlePhases: [2, 3], paddleMoving: [false, false] }, 0, 0.5), 2 - Math.PI / 16),
       'a paddle that is not moving is NOT at the moving phase');
}
{
  const an = ER.boatAnimOf({ type: 'boat', paddlePhases: [1, 2], paddleMoving: [true, true] }, 1);
  const d = an.deltaFor('left_paddle'), a = ER.boatPaddleAngles(1, 0);
  ok(near(d.rx, a.pitch) && near(d.ry, a.yaw) && d.rz === 0, 'the left paddle delta is absolute pitch/yaw over a zero rest');
  const dr = an.deltaFor('right_paddle'), ar = ER.boatPaddleAngles(2, 1);
  ok(near(dr.ry, ar.yaw - Math.PI), 'the right paddle delta subtracts its rest yaw (pi)');
  ok(an.deltaFor('bottom') === null && an.deltaFor('front') === null, 'no other part is posed');
}
// the matrix: a rotation (det +1, orthonormal); wobble and bubble change it; damage wobble ends at 0 ticks
const det = (R) => R[0] * (R[4] * R[8] - R[5] * R[7]) - R[1] * (R[3] * R[8] - R[5] * R[6]) + R[2] * (R[3] * R[7] - R[4] * R[6]);
{
  const flat = ER.boatMatrix({ type: 'boat', yaw: 0.4 }, 1);
  ok(near(det(flat), 1, 1e-9), 'boat matrix is a proper rotation (det ' + det(flat).toFixed(9) + ')');
  const wob = ER.boatMatrix({ type: 'boat', yaw: 0.4, damageWobbleTicks: 8, damageWobbleStrength: 20, damageWobbleSide: 1 }, 0.5);
  const bub = ER.boatMatrix({ type: 'boat', yaw: 0.4, lastBubbleWobble: 2, bubbleWobble: 6 }, 0.5);
  okAv(wob.some((v, i) => !near(v, flat[i], 1e-4)), 'damage wobble changes the pose');
  okAv(bub.some((v, i) => !near(v, flat[i], 1e-4)), 'bubble wobble changes the pose');
  ok(near(det(wob), 1, 1e-9) && near(det(bub), 1, 1e-9), 'wobbling poses are still rotations');
  const spent = ER.boatMatrix({ type: 'boat', yaw: 0.4, damageWobbleTicks: 0, damageWobbleStrength: 20, damageWobbleSide: 1 }, 0);
  ok(spent.every((v, i) => near(v, flat[i], 1e-9)), 'with no wobble ticks left there is no wobble');
  const yaw = ER.boatMatrix({ type: 'boat', yaw: 1.4 }, 1);
  okAv(yaw.some((v, i) => !near(v, flat[i], 1e-4)), 'the entity heading turns the boat');
}

// ── 3. the woods and the roster ─────────────────────────────────────────────────────────────
ok(ER.boatTexKey({ boatType: 0 }) === null && ER.boatTexKey({}) === null, 'oak is the plain "boat" sheet');
ok(ER.boatTexKey({ boatType: 5 }) === 'boat#5' && ER.boatTexKey({ boatType: 'birch' }) === 'boat#2', 'boat#5 is dark oak, birch by name is boat#2');
ok(ER.boatTexKey({ boatType: 99 }) === null, 'an out-of-range type falls back to oak');
{
  const g = JSON.parse(geo.toString('utf8')).layers;
  for (const k of ['boat', 'boat#1', 'boat#2', 'boat#3', 'boat#4', 'boat#5']) ok(!!g[k], k + ' has a baked slice table in mob-geometry.json');
  okAv(!g['boat#6'], 'and there is no seventh wood');
  const tiles = (k) => JSON.stringify(g[k]);
  ok(tiles('boat') !== tiles('boat#5'), 'oak and dark oak sample different atlas tiles');
}
ok(!ER.OWED.some((s) => /^boat /.test(s)), "'boat — G17c' is struck from ER.OWED");
ok(ER.mobLayerFor('boat') === 'boat', 'a boat draws through the mob path (mobLayerFor)');
okAv(M.EntityList.spawn('boat', 0, 64, 0) !== null, 'the engine can spawn a boat, so drawing it is not vacuous');

// ── 4. paddle sounds (BoatEntity.tick, .decomp lines 308-338) ───────────────────────────────
{
  const Bt = M.Boat;
  if (!ok(!!Bt && !!M.Sound, 'Boat and Sound modules are loaded')) { /* reported below */ }
  else {
    const run = (loc, silent) => {
      const heard = [], play0 = M.Sound.play, cl0 = Bt.checkLocation;
      M.Sound.play = (id, o) => heard.push([id, o.volume, o.pitch]);
      Bt.checkLocation = () => loc;
      const e = { paddleMoving: [true, true], paddlePhases: [0, 0], passengers: [{}], yawDeg: 0, x: 0, y: 64, z: 0, silent, random: () => 0.5 };
      const ticks = [];
      for (let t = 0; t < 20; t++) { const n = heard.length; Bt.tickPaddlePhases(e); if (heard.length > n) ticks.push(t); }
      M.Sound.play = play0; Bt.checkLocation = cl0;
      return { heard, ticks };
    };
    const w = run(Bt.IN_WATER, false), l = run(Bt.ON_LAND, false);
    ok(w.ticks.join() === '1,2,17' && w.heard.length === 6 && w.heard.every((h) => h[0] === 'entity.boat.paddle_water' && h[1] === 1 && near(h[2], 1.0)), 'water: both paddles stroke on ticks 1, 2, 17 (paddle_water, vol 1, pitch 1.0): ' + w.ticks);
    ok(l.ticks.join() === '1,2,17' && l.heard.every((h) => h[0] === 'entity.boat.paddle_land'), 'land: paddle_land on the same ticks');
    okAv(run(Bt.IN_AIR, false).heard.length === 0 && run(Bt.IN_WATER, true).heard.length === 0, 'in air or silent: no sound');
  }
}

console.log(`\n${pass} checks passed, ${fails.length} failures`);
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
