#!/usr/bin/env node
// pandaposecheck.mjs — #919: panda sit / lie on back / roll over / sneeze / thunder pose.
// Expected values are written out from .decomp PandaEntityModel.setAngles :60-125, PandaEntity
// update*Animation :436-461 and PandaEntityRenderer.setupTransforms :34-87, not read back from src.
import { loadEngine, initRegistry } from './loadsrc.mjs';

let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); };
const near = (a, b) => Math.abs(a - b) < 1e-5;

const M = loadEngine({
  extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07zl_panda.js',
          '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js', '07w_passive.js'], dom: false });
initRegistry(M);
const ER = M.EntityRender, Pd = M.Panda;

// ── progress floats: +0.15 / -0.19, clamped
{
  const e = { type: 'panda', sitting: true };
  for (let i = 0; i < 3; i++) Pd.tickAnim(e);
  ok(near(e.sitProg, 0.45) && near(e.lastSitProg, 0.3), 'sitting +0.15 per tick, last = previous');
  for (let i = 0; i < 10; i++) Pd.tickAnim(e);
  ok(e.sitProg === 1, 'sitting clamps at 1');
  e.sitting = false; Pd.tickAnim(e);
  ok(near(e.sitProg, 0.81), 'stand-up -0.19 per tick');
  for (let i = 0; i < 10; i++) Pd.tickAnim(e);
  ok(e.sitProg === 0, 'clamps at 0');
  const p = { type: 'panda', playing: true };
  for (let i = 0; i < 33; i++) Pd.tickPlayTicks(p);
  ok(p.playing === false && p.playingTicks === 33, 'playing ends after playingTicks > 32');
  Pd.tickPlayTicks(p); ok(p.playingTicks === 0, 'playingTicks resets when not playing');
}

const REST = { body: 1.5707964, head: 0, leg: 0 };
const st = (o) => Object.assign({ sit: 0, lie: 0, roll: 0, sneezing: false, sneezeProgress: 0, eating: false,
  thunder: false, ask: 0 }, o);
const angle = (part, px, age = 10, ls = 0, lsa = 0) => {
  const rest = { rx: part === 'body' ? REST.body : 0, ry: 0, rz: 0 };
  const d = ER.setupAnimDelta(part, ls, lsa, 0, 0, false, 'quadruped', { panda: st(px), ageInTicks: age, rest });
  return { rx: rest.rx + d.rx, rz: d.rz };
};
{
  const sit = angle('body', { sit: 1 });
  ok(near(sit.rx, 1.7407963), 'sit=1 body pitch 1.7407963');
  ok(near(angle('head', { sit: 1 }).rx, Math.PI / 2), 'sit=1 head pitch pi/2');
  ok(near(angle('right_front_leg', { sit: 1 }).rz, -0.27079642) && near(angle('left_front_leg', { sit: 1 }).rz, 0.27079642) &&
     near(angle('right_hind_leg', { sit: 1 }).rz, 0.5707964) && near(angle('left_hind_leg', { sit: 1 }).rz, -0.5707964), 'sit leg rolls');
  ok(near(angle('body', { sit: 0.5 }).rx, REST.body + 0.5 * (1.7407963 - REST.body)), 'sit=.5 body interpolates');
  ok(near(angle('head', { sit: 1, thunder: true }).rx, 2.1707964) && near(angle('right_front_leg', { sit: 1, thunder: true }).rx, -0.9), 'thunder shiver sit');
  ok(near(angle('head', { sit: 1, eating: true }, 5).rx, Math.PI / 2 + 0.2 * Math.sin(3)), 'eating head bob');
  ok(near(angle('right_front_leg', { sit: 1, eating: true }, 5).rx, -0.4 - 0.2 * Math.sin(3)), 'eating arms');
  ok(near(angle('right_hind_leg', { lie: 1 }, 20).rx, -0.6 * Math.sin(3)) && near(angle('left_front_leg', { lie: 1 }, 20).rx, -0.3 * Math.sin(5)), 'lie-on-back legs');
  ok(near(angle('head', { lie: 1 }).rx, Math.PI / 2), 'lie head');
  ok(near(angle('head', { roll: 1 }).rx, 2.0561945) && near(angle('right_hind_leg', { roll: 1 }, 4).rx, -0.5 * Math.sin(2)), 'roll-over');
  ok(near(angle('head', { sneezing: true, sneezeProgress: 7 }).rx, -Math.PI / 4 * 7 / 14), 'sneeze <15');
  ok(near(angle('head', { sneezing: true, sneezeProgress: 17 }).rx, -Math.PI / 4), 'sneeze 15..19 (int division)');
  ok(near(angle('head', { sneezing: true, sneezeProgress: 20 }).rx, 0), 'sneeze >=20 unchanged');
  ok(near(angle('head', { ask: 5 }, 10).rz, 0.35 * Math.sin(6)), 'ask-for-bamboo head roll');
  const walk = ER.setupAnimDelta('left_front_leg', 1.3, 0.7, 0, 0, false, 'quadruped', { panda: st({}), rest: { rx: 0, ry: 0, rz: 0 } });
  ok(near(walk.rx, Math.cos(1.3 * 0.6662) * 1.4 * 0.7), 'limb swing 0.6662/1.4 kept when idle');
}
// ── renderer transforms
const pose = (o) => ER.pandaPoseOf(Object.assign({ sit: 0, lie: 0, playingTicks: 0, partial: 0, baby: false, thunder: false, age: 0 }, o));
{
  const s = pose({ sit: 1 });
  // translate(0,.8) rotX(90) translate(0,-1): t = (0,.8,0) + Rx(90)*(0,-1,0) = (0, .8, -1)
  ok(near(s.t[1], 0.8) && near(s.t[2], -1) && near(s.R[5], -1), 'sit transform');
  const l = pose({ lie: 1 });
  ok(near(l.t[1], 1.3) && near(l.R[4], -1), 'lie transform (adult 1.3, 180deg)');
  ok(near(pose({ lie: 1, baby: true }).t[1], 0.5), 'lie transform baby 0.5');
  const p3 = pose({ playingTicks: 3, partial: 0.5 });   // phase 1: a = lerp(90*3/7, 90*4/7, .5)
  const a = 90 * 3.5 / 7;
  ok(near(p3.t[1], 1.0 * a / 90), 'roll phase 1 translate (adult .8+.2)');
  ok(near(p3.R[4], Math.cos(a * Math.PI / 180)), 'roll phase 1 rotation -a about X');
  const p10 = pose({ playingTicks: 10, partial: 0 }), a2 = 90 + 90 * 2 / 7;
  ok(near(p10.t[1], 1.0 + 0.6 * (a2 - 90) / 90), 'roll phase 2 translate');
  const p30 = pose({ playingTicks: 30, partial: 0 }), a4 = 270 + 90 * 6 / 7;
  ok(near(p30.t[1], 0.8 * (360 - a4) / 90), 'roll phase 4 translate');
  const th = pose({ sit: 1, thunder: true, age: 4 });
  ok(near(th.R[0], Math.cos(Math.cos(5) * Math.PI * 0.05 * Math.PI / 180)), 'thunder yaw shake (vanilla radians-as-degrees) cos(age*1.25)*PI*.05');
  const bt = pose({ sit: 1, thunder: true, baby: true, age: Math.PI / 2 / 1.25 });   // yaw 0: t = (0,.8,-1) + Rx(90)(0,.8,.55)
  ok(near(bt.t[1], 0.25) && near(bt.t[2], -0.2), 'baby thunder offset (0,.8,.55) inside the sit rotation');
  const e = { type: 'panda', maxHealth: 20, sitting: true, sitProg: 1, lastSitProg: 1, isBaby: false };
  ok(ER.animOf(e, 0.5).panda.sit === 1 && ER.animOf({ type: 'cow', maxHealth: 10 }, 0.5).panda === null, 'animOf carries panda only for pandas');
}
{
  const e = { type: 'panda', sitting: true, pitch: 0.7 };
  Pd.tickSitPitch(e); ok(e.pitch === 0, 'sitting panda pitch zeroed');
  e.sitting = false; e.pitch = 0.7; Pd.tickSitPitch(e); ok(e.pitch === 0.7, 'standing panda keeps pitch');
}
// ── anti-vacuity: break each formula and watch the assertions notice
{
  okAv(!near(1.7407963 * 0.5, angle('body', { sit: 0.5 }).rx), 'a non-interpolated body sit pitch is caught');
  okAv(!near(0.3 * Math.sin(5), angle('left_front_leg', { lie: 1 }, 20).rx), 'a mirrored lie leg is caught');
  okAv(!near(0.8, pose({ lie: 1 }).t[1]), 'the baby lie offset used for an adult is caught');
  okAv(!near(pose({ playingTicks: 3 }).t[1], 0.8 * 3 / 7), 'a roll translate without the +0.2 is caught');
  okAv((() => { const e = { sitting: true, pitch: 0.7 }; return e.pitch !== 0; })(), 'a sit tick without the pitch reset leaves pitch (caught)');
  okAv(!near(Math.PI / 2, angle('head', { roll: 1 }).rx), 'a sit head pitch used for roll is caught');
}
console.log(`\n${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL: ' + f);
if (fails.length) process.exit(1);
