#!/usr/bin/env node
// golemflowercheck.mjs — #733: the iron golem's poppy-offering pose.
//
//   node tools/golemflowercheck.mjs
//
// Vanilla (.decomp): IronGolemEntity.lookingAtVillagerTicksLeft = 400 (setLookingAtVillager / status 11),
// 0 (status 34), -1 per tickMovement; IronGolemEntityModel.method_17095: look>0 -> rightArm.pitch =
// -0.8 + 0.025*wrap(look,70), leftArm.pitch = 0; IronGolemFlowerFeatureRenderer draws Blocks.POPPY at
// scale 0.5 whenever the ticks != 0. Expected numbers are recomputed here from MathHelper.wrap's formula.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
let pass = 0; const fails = [];
const M = loadEngine({ extra: ['07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07j_entityrender.js',
  '10_gfx.js', '15h_bemodel.js', '07k_goals.js'], dom: false });
initRegistry(M);
{
  const mm = JSON.parse(readFileSync(join(ASSETS, 'models.meta.json'), 'utf8'));
  M.BEModel.init({ models: readFileSync(join(ASSETS, 'models.bin')).toString('base64'), modelsBytes: mm.rawBytes });
}
const ER = M.EntityRender, EL = M.EntityList, Ai = M.Ai;
const wrap = (a, b) => (Math.abs(a % b - b * 0.5) - b * 0.25) / (b * 0.25);
const golem = (ticks) => ({ type: 'iron_golem', x: 0, y: 64, z: 0, px: 0, py: 64, pz: 0, maxHealth: 100, age: 5,
  yaw: 0, lookingAtVillagerTicks: ticks });

function run(o, impl) {
  // 1. counter: status 11 / 34, goal setter, decay in tickAnim
  const e = golem(0);
  impl.status(e, 11); o(e.lookingAtVillagerTicks === 400, 'status 11 sets 400');
  EL.tickAnim(e); o(e.lookingAtVillagerTicks === 399, 'tickMovement counts down ' + e.lookingAtVillagerTicks);
  impl.status(e, 34); o(e.lookingAtVillagerTicks === 0, 'status 34 clears');
  EL.tickAnim(e); o(e.lookingAtVillagerTicks === 0, 'counter stops at 0');
  Ai.setLookingAtVillager(e, true); o(e.lookingAtVillagerTicks === 400, 'setLookingAtVillager(true) = 400');
  // 2. arm pose
  for (const t of [1, 17, 35, 70, 123, 400]) {
    const g = golem(t), an = ER.animOf(g, 0);
    const r = ER.setupAnimDelta('right_arm', 0, 0, 0, 0, false, ER.modelKindOf('iron_golem'),
      { golem: impl.golemCtx(an), ageInTicks: 0 });
    const l = ER.setupAnimDelta('left_arm', 0, 0, 0, 0, false, ER.modelKindOf('iron_golem'),
      { golem: impl.golemCtx(an), ageInTicks: 0 });
    o(!!r && Math.abs(r.rx - (-0.8 + 0.025 * wrap(t, 70))) < 1e-9, 'right arm pitch at t=' + t);
    o(!!l && l.rx === 0, 'left arm pitch 0 at t=' + t);
  }
  // 3. the poppy
  const g = golem(100), f = impl.flower(g);
  o(!!f && f.state > 0 && M.Reg && ER.quadCount(f.state, 0, 0, 0) > 0, 'a poppy quad is emitted');
  if (f) {
    const m = f.m, det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
    o(Math.abs(Math.abs(det) - 0.125 * ER.renderScaleOf(g) ** 3) < 1e-6, 'poppy scale is 0.5, |det|=' + det);
    o(f.y > 64 && f.y < 66.7 && Math.abs(f.x) < 2.5, 'poppy sits at the right arm: ' + [f.x, f.y, f.z]);
  }
  o(!impl.flower(golem(0)), 'no poppy at ticks 0');
}
const real = {
  status: (e, s) => Ai.golemStatus(e, s),
  golemCtx: (an) => an.golem,
  flower: (e) => { const it = ER.visible ? ER.ironGolemFlowerFor(e, 'iron_golem', e.x, e.y, e.z, 0) : null; return e.lookingAtVillagerTicks > 0 ? it : null; },
};
run((c, m) => { if (c) pass++; else fails.push(m); }, real);
const passMain = pass;

// anti-vacuity: each broken implementation must fail
const breaks = [
  { ...real, status: (e, s) => { if (s === 11) e.lookingAtVillagerTicks = 200; } },
  { ...real, golemCtx: (an) => ({ ...an.golem, look: 0 }) },
  { ...real, flower: () => null },
  { ...real, status: () => {} },
];
let caught = 0;
for (const b of breaks) {
  let f = 0; run((c) => { if (!c) f++; }, b); if (f) caught++;
}
console.log(passMain + ' assertions, ' + fails.length + ' failures, ' + caught + ' breaks caught');
if (fails.length) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
process.exit(caught === breaks.length ? 0 : 1);
