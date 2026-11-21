#!/usr/bin/env node
// phantomvel.mjs — #759: PhantomMoveControl velocity vs a Java-formula reimplementation; SwoopMovementGoal box.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07d_mining.js', '07e_loot.js', '07b_behaviour.js',
  '07h_entities.js', '07i_entitylist.js', '07k_goals.js', '07zz1_phantom.js'], dom: false });
initRegistry(M);
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init();
const Ph = M.Phantom, D = Math.PI / 180;
// Java reference (vanilla degrees frame), PhantomEntity.PhantomMoveControl.tick
function ref(st, tgt) {
  let dx = tgt[0] - st.x, dy = tgt[1] - st.y, dz = tgt[2] - st.z, h = Math.hypot(dx, dz);
  const f = 1 - Math.abs(dy * 0.7) / h; dx *= f; dz *= f; h = Math.hypot(dx, dz);
  const d5 = Math.sqrt(dx * dx + dz * dz + dy * dy), old = st.yv;
  const wrap = a => { a %= 360; if (a >= 180) a -= 360; if (a < -180) a += 360; return a; };
  const cur = wrap(st.yv + 90), want = wrap(Math.atan2(dz, dx) / D);
  let d = wrap(want - cur); d = Math.max(-4, Math.min(4, d));
  st.yv = cur + d - 90;
  const between = Math.abs(wrap(st.yv - old));
  st.sp = between < 3 ? Math.min(1.8, st.sp + 0.005 * (1.8 / st.sp)) : (st.sp > 0.2 ? Math.max(0.2, st.sp - 0.025) : Math.min(0.2, st.sp + 0.025));
  const p = Math.atan2(dy, h) / D, y1 = (st.yv + 90) * D;
  const t = [st.sp * Math.cos(y1) * Math.abs(dx / d5), st.sp * Math.sin(p * D) * Math.abs(dy / d5), st.sp * Math.sin(y1) * Math.abs(dz / d5)];
  st.v = st.v.map((v, i) => v + (t[i] - v) * 0.2);
}
function run(mut) {
  const e = { x: 0, y: 70, z: 0, yaw: 1.0, vx: 0, vy: 0, vz: 0, targetPosX: 20, targetPosY: 60, targetPosZ: -15 };
  const mc = new Ph.PhantomMoveControl(e);
  // engine yaw θ = vanilla yaw + π
  const st = { x: 0, y: 70, z: 0, yv: 1.0 / D - 180, sp: 0.1, v: [0, 0, 0] };
  let worst = 0;
  for (let i = 0; i < 40; i++) {
    mc.tick(); ref(st, [20, 60, -15]);
    if (mut) e.vx += 0.01 * mut;
    worst = Math.max(worst, Math.abs(e.vx - st.v[0]), Math.abs(e.vy - st.v[1]), Math.abs(e.vz - st.v[2]));
  }
  return worst;
}
let fails = 0, breaks = 0;
const w = run(0);
if (!(w < 1e-4)) { fails++; console.log('FAIL velocity trace diverges from Java formula by', w); }
if (run(1) > 1e-4) breaks++; else { fails++; console.log('FAIL broken trace not caught'); }
// swoop box: target just outside the old half-width test but inside expand(0.2)
function swoop(dxOff) {
  let hit = 0;
  const e = { x: 0, y: 70, z: 0, width: 0.9, height: 0.5, phantomMovementType: 'swoop', target: null };
  e.target = { x: dxOff, y: 70, z: 0, width: 0.6, height: 1.8 };
  M.Combat = { mobAttack() { hit++; } };
  new Ph.SwoopMovementGoal(e, {}).tick();
  return hit;
}
if (swoop(0.9) !== 1) { fails++; console.log('FAIL box inside 0.45+0.2+0.3=0.95 must hit'); }
if (swoop(1.0) !== 0) { fails++; console.log('FAIL box outside must miss'); } else breaks++;
console.log(fails ? fails + ' FAILED' : 'phantomvel OK — ' + breaks + ' breaks caught');
process.exit(fails ? 1 : 0);
