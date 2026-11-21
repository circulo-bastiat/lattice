#!/usr/bin/env node
// snowgolemrendercheck.mjs — #723: the snow golem's RENDER.
//   SnowGolemEntityModel.setAngles: arms never swing with limbSwing; upperBody.yaw = headYaw*0.25, the arms follow it
//   (left yaw = ub, right yaw = ub+PI, pivots +-cos/sin(ub)*5). SnowmanPumpkinFeatureRenderer: a carved_pumpkin is
//   drawn on the head iff hasPumpkin (a sheared golem draws none).
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { loadEngine, initRegistry, MCLITE_ROOT, ASSETS } from './loadsrc.mjs';
import { join } from 'node:path';

let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); };
const near = (a, b) => Math.abs(a - b) < 1e-6;

const M = loadEngine({
  extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
          '07zb_creeper.js', '07q_effects.js', '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js', '07w_passive.js', '14j_combat.js'],
  dom: false
});
initRegistry(M);
{
  const mm = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'models.meta.json'), 'utf8'));
  M.BEModel.init({ models: readFileSync(join(MCLITE_ROOT, 'assets', 'models.bin')).toString('base64'), modelsBytes: mm.rawBytes });
}
const raw = readFileSync(join(MCLITE_ROOT, 'assets', 'mob-geometry.json'));
M.DATA = Object.assign({}, M.DATA, { mobGeometry: deflateRawSync(raw, { level: 9 }).toString('base64'), mobGeometryBytes: raw.length,
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.EntityRender.init(); M.Passive.init();
const ER = M.EntityRender, DEG = Math.PI / 180;
ok(ER.ready, 'entity renderer up');

ok(ER.modelKindOf('snow_golem') === 'snow_golem', `snow_golem's model kind is 'snow_golem' (got ${ER.modelKindOf('snow_golem')})`);
const L = M.BEModel.layer('snow_golem');
const rest = (n) => L.parts.find((p) => p.n === n);
const delta = (n, ls, lsa, yaw, pitch, kind) => ER.setupAnimDelta(n, ls, lsa, yaw, pitch, false, kind === undefined ? 'snow_golem' : kind, { rest: rest(n) });

// arms never swing with limbSwing
for (const n of ['left_arm', 'right_arm']) {
  const d = delta(n, 3.7, 1, 0, 0);
  ok(d && d.rx === 0, `${n} rx == 0 at limbSwing>0 (got ${d && d.rx})`);
}
// upper body / arm yaw + pivots at headYaw 40
const yaw = 40, ub = yaw * DEG * 0.25;
const posed = (n) => { const r = rest(n), d = delta(n, 3.7, 1, yaw, 10); return { ry: r.ry + d.ry, px: r.px + (d.dpx || 0), pz: r.pz + (d.dpz || 0), rx: r.rx + d.rx }; };
ok(near(posed('upper_body').ry, ub), 'upper_body.yaw = headYaw*0.25');
ok(near(posed('left_arm').ry, ub) && near(posed('right_arm').ry, ub + Math.PI), 'left arm yaw = ub, right arm yaw = ub+PI');
ok(near(posed('left_arm').px, Math.cos(ub) * 5) && near(posed('left_arm').pz, -Math.sin(ub) * 5), 'left arm pivot X/Z = cos/-sin(ub)*5');
ok(near(posed('right_arm').px, -Math.cos(ub) * 5) && near(posed('right_arm').pz, Math.sin(ub) * 5), 'right arm pivot X/Z = -cos/sin(ub)*5');
ok(near(posed('head').ry, yaw * DEG) && near(posed('head').rx, 10 * DEG), 'head yaw/pitch follow the head rotation');
okAv(Math.abs(delta('left_arm', 3.7, 1, 0, 0, 'humanoid').rx) > 0.1, 'the generic humanoid arm rule DOES swing here, so the rx==0 assertion is not vacuous');
okAv(Math.abs(posed('left_arm').ry - ub) < 1e-6 && Math.abs(posed('upper_body').ry) > 1e-6, 'a non-turning upper body (yaw 0) would differ from the turned one');

// the pumpkin layer
const pumpkin = M.States.stateOf('carved_pumpkin');
ok(pumpkin > 0, 'carved_pumpkin has a state');
const mk = (over) => Object.assign({ type: 'snow_golem', x: 2, y: 5, z: 0, px: 2, py: 5, pz: 0, yaw: 0, pyaw: 0, age: 0 }, over || {});
M.EntityList.list = [mk({ hasPumpkin: true })];
let vis = ER.visible(0, 5, 0, 1);
const pk = vis.filter((it) => it.pumpkin);
ok(pk.length === 1 && pk[0].state === pumpkin, `a pumpkin golem draws exactly one carved_pumpkin quad group (got ${pk.length})`);
ok(pk.length && ER.quadCount(pk[0].state, 0, 5, 0) > 0, 'the pumpkin has quads');
ok(vis.some((it) => it.shape === 'mob' && it.mobLayer === 'snow_golem'), 'the golem body is still drawn');
M.EntityList.list = [mk({ hasPumpkin: false })];
vis = ER.visible(0, 5, 0, 1);
okAv(!vis.some((it) => it.pumpkin) && vis.some((it) => it.shape === 'mob'), 'a sheared golem draws its body but no pumpkin');
M.EntityList.list = [mk({ hasPumpkin: true }), mk({ hasPumpkin: false })];
vis = ER.visible(0, 5, 0, 1);
okAv(vis.filter((it) => it.pumpkin).length === 1, 'two golems, one sheared -> exactly one pumpkin');
// #1188 -- invisible golem: SnowmanPumpkinFeatureRenderer draws nothing (real effect store)
const invG = mk({ hasPumpkin: true });
M.Effects.addStatusEffect(invG, 'invisibility', 200, 0, false, true);
M.EntityList.list = [invG];
vis = ER.visible(0, 5, 0, 1);
ok(!vis.some((it) => it.pumpkin), 'an invisible pumpkin golem draws no pumpkin');
const visibleG = mk({ hasPumpkin: true });
M.EntityList.list = [visibleG];
vis = ER.visible(0, 5, 0, 1);
okAv(vis.some((it) => it.pumpkin), 'the same golem without the effect draws its pumpkin, so the invisible assertion can fail');
// pumpkin sits above the body's feet: head pivot y 4/16... world y above the golem's origin
M.EntityList.list = [mk({ hasPumpkin: true })];
const p1 = ER.visible(0, 5, 0, 1).find((it) => it.pumpkin);
ok(p1.y > 5 + 1.2 && p1.y < 5 + 2.0, `pumpkin centre is at head height (y=${p1.y})`);

// #4784 ER.eyeHeightStanding must agree with Cb.eyeHeightOf (snow_golem is a fixed 1.7, not 1.9*0.85)
ok(ER.eyeHeightStanding('snow_golem') === 1.7, `ER.eyeHeightStanding(snow_golem) === 1.7 (got ${ER.eyeHeightStanding('snow_golem')})`);
okAv(Math.abs(M.Entities.height('snow_golem') * 0.85 - 1.7) > 0.05, 'the old height*0.85 answer (1.615) differs from 1.7, so the assertion can fail');

console.log(`${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
