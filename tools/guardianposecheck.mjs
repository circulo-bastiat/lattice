#!/usr/bin/env node
// guardianposecheck.mjs — #2022. GuardianEntityModel.setAngles (.decomp) vs the engine's posed guardian parts:
// spike pivots for spikesExtension 0/.5/1, tail yaws over a tailAngle sweep, eye pivot. Breaks its own engine (rest pose) and must notice.
import { readFileSync } from 'node:fs';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';
const M = loadEngine({ extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js', '07zs_spawner.js', '07zzs_minecartrender.js'], dom: false });
initRegistry(M);
const mm = JSON.parse(readFileSync(MCLITE_ROOT + 'assets/models.meta.json', 'utf8'));
M.BEModel.init({ models: readFileSync(MCLITE_ROOT + 'assets/models.bin').toString('base64'), modelsBytes: mm.rawBytes });
const ER = M.EntityRender;
const J = readFileSync(MCLITE_ROOT + '.decomp/net/minecraft/client/render/entity/model/GuardianEntityModel.java', 'utf8');
const arr = (n) => J.match(new RegExp(n + ' = new float\\[\\]\\{([^}]*)\\}'))[1].split(',').map((s) => parseFloat(s));
const PX = arr('SPIKE_PIVOTS_X'), PY = arr('SPIKE_PIVOTS_Y'), PZ = arr('SPIKE_PIVOTS_Z');
const ang = (i, age, k) => 1 + Math.cos(age * 1.5 + i) * 0.01 - k;
const rest = (n) => ER.findRestPart(M.BEModel.layers.guardian.parts, n);
const fails = []; let n = 0;
const near = (a, b) => Math.abs(a - b) < 1e-4;
function run(label, delta) {
  for (const ext of [0, 0.5, 1]) for (const age of [0, 37.25]) {
    const g = { age, spikeK: (1 - ext) * 0.55, tail: age / 7, eyeX: 0.7, eyeY: 1 };
    for (let i = 0; i < 12; i++) {
      const p = rest('spike' + i), d = delta('spike' + i, g, p);
      n++;
      if (!d || !near(p.px + (d.dpx || 0), PX[i] * ang(i, age, g.spikeK)) || !near(p.py + (d.dpy || 0), 16 + PY[i] * ang(i, age, g.spikeK)) || !near(p.pz + (d.dpz || 0), PZ[i] * ang(i, age, g.spikeK))) fails.push(`${label}: spike${i} ext=${ext} age=${age}`);
    }
    ['tail0', 'tail1', 'tail2'].forEach((t, k) => {
      const d = delta(t, g, rest(t)); n++;
      if (!d || !near(d.ry, Math.sin(g.tail) * Math.PI * [0.05, 0.1, 0.15][k])) fails.push(`${label}: ${t} tail=${g.tail}`);
    });
    const d = delta('eye', g, rest('eye')); n++;
    if (!d || d.dpx !== 0.7 || d.dpy !== 1) fails.push(`${label}: eye`);
  }
}
const real = (name, g, p) => ER.setupAnimDelta(name, 0, 0, 0, 0, false, ER.modelKindOf('guardian'), { rest: p, guardian: g, ageInTicks: 0 });
run('engine', real);
const clean = fails.length;
let caught = 0;
run('break', (name, g, p) => ER.setupAnimDelta(name, 0, 0, 0, 0, false, ER.modelKindOf('guardian'), { rest: p }));   // the rest pose the bug left behind
if (fails.length > clean) caught++; else fails.push('break NOT caught: rest pose passed');
fails.length = clean;
// guardianAnim: a lone guardian facing the camera's side puts the eye at pivotY 1 (camera below its eye) and a nonzero X
const e = { type: 'guardian', x: 0, y: 64, z: 0, yaw: 0, age: 5, spikesExtension: 1, prevSpikesExtension: 0, tailAngle: 2, prevTailAngle: 1 };
ER.camPos = [3, 60, 0];
const a = ER.guardianAnim(e, 0.5); n++;
if (!near(a.spikeK, 0.5 * 0.55) || !near(a.tail, 1.5) || a.eyeY !== 1 || !(Math.abs(a.eyeX) > 0)) fails.push('guardianAnim: ' + JSON.stringify(a));
// pitched: vanilla's getRotationVec xz is NOT renormalised, so |v| = cos(pitch) scales the pupil offset
const e2 = { ...e, xHeadRot: 1 }; n++;
const d0 = ER.guardianAnim(e, 0.5).eyeX, d1 = ER.guardianAnim(e2, 0.5).eyeX, w = Math.sqrt(Math.cos(1)) * d0;
if (!near(d1, w)) fails.push(`pitched eyeX ${d1} != ${w}`); else caught++;
for (const f of fails.slice(0, 10)) console.log('  ✗ ' + f);
console.log(`${n - fails.length} assertions, ${fails.length} failures, ${caught} breaks caught`);
process.exit(fails.length ? 1 : 0);
