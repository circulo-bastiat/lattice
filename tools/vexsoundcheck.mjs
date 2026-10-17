#!/usr/bin/env node
// vexsoundcheck.mjs — #761: VexEntity ambient/hurt/death/charge sounds. Ends with "<n> breaks caught".
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const fails = []; let pass = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const M = loadEngine({ extra: ['07h_entities.js', '07_world.js', '07b_behaviour.js', '14b_physics.js',
  '07i_entitylist.js', '07k_goals.js', '07zzp_mobvoice.js'], dom: false });
const Ai = M.Ai;
const table = JSON.parse(readFileSync(join(MCLITE_ROOT, '.mcsnd/sounds.json'), 'utf8'));
const played = [];
M.Sound = { play: (ev, o) => { played.push([ev, o]); return true; } };

function run(ai) {
  const res = {};
  for (const v of Object.values(ai.VEX_SOUNDS)) res['has:' + v] = !!table[v];
  const e = { x: 1, y: 2, z: 3 };
  for (const k of ['hurt', 'death', 'ambient', 'charge']) {
    played.length = 0; ai.vexSound(e, k, () => 0.7); res[k] = played.length ? [played[0][0], played[0][1].source, played[0][1].pitch] : null;
  }
  { const q = [0.9, 0.1]; played.length = 0; ai.vexSound(e, 'charge', () => q.shift()); res.chargePitch = played[0][1].pitch; }
  played.length = 0; ai.vexSound({ x: 0, y: 0, z: 0, silent: true }, 'hurt'); res.silent = played.length;
  played.length = 0; const v = { x: 0, y: 0, z: 0 };
  const g = new ai.VexAmbientGoal(v, { random: () => 0 });
  for (let i = 0; i < 200; i++) g.tick();
  res.rolled = played.length;
  played.length = 0;
  const c = new ai.ChargeTargetGoal({ x: 0, y: 0, z: 0, target: { x: 9, y: 0, z: 0 }, flyMove: { moveTo() {}, isMoving: () => false } }, { random: () => 0 });
  c.start(); res.chargeStart = played.length ? played[0][0] : null;
  return res;
}
const good = run(Ai);
ok(Object.entries(good).every(([k, v]) => !k.startsWith('has:') || v), 'all four vex events exist in the sound table');
ok(good.hurt[0] === 'entity.vex.hurt' && good.death[0] === 'entity.vex.death' && good.ambient[0] === 'entity.vex.ambient', 'hurt/death/ambient events');
ok(good.charge[0] === 'entity.vex.charge' && good.chargeStart === 'entity.vex.charge', 'charge event, played by ChargeTargetGoal.start');
ok(good.hurt[1] === 'hostile', 'hostile category');
ok(Math.abs(good.hurt[2] - 1) < 1e-9, 'pitch (r-r)*0.2+1');
ok(good.chargePitch === 1, 'charge pitch is fixed 1.0 (ChargeTargetGoal.start explicit)');
ok(good.silent === 0, 'silent vex plays nothing');
ok(good.rolled >= 1, 'ambient roll fires within 200 ticks');
const cb = readFileSync(join(MCLITE_ROOT, 'src/14j_combat.js'), 'utf8');
ok(/e\.type === 'vex'[^\n]*vexSound\(e, e\.dead \? 'death' : 'hurt'\)/.test(cb), 'Cb.hurt calls vexSound');
const gl = readFileSync(join(MCLITE_ROOT, 'src/07k_goals.js'), 'utf8');
ok(/new Ai\.VexAmbientGoal\(e, ctx\)/.test(gl), 'vex goal set includes the ambient roll');

// #4798: the vex voice is played by Ai.vexSound / VexAmbientGoal only, so the generic MobVoice path must skip it
const MVo = M.MobVoice;
ok(MVo.OWN.vex === 1, 'vex is MobVoice.OWN (no double hurt/death/ambient)');
ok(MVo.onDamage({ type: 'vex' }, false) === false && MVo.tickAmbient({ type: 'vex', health: 5 }) === false, 'MobVoice skips vex');
ok(/e\.ambientChance = -80/.test(cb), 'a hit resets the goal ambient counter');

let breaks = 0;
const catches = (mut) => { let r; try { r = run(Object.assign({}, Ai, mut)); } catch (x) { breaks++; console.log('  ✓ break caught'); return; }
  if (JSON.stringify(r) !== JSON.stringify(good)) { breaks++; console.log('  ✓ break caught'); } };
catches({ vexSound: (e, k, r) => Ai.vexSound(e, k === 'hurt' ? 'death' : k, r) });
catches({ VEX_SOUNDS: Object.assign({}, Ai.VEX_SOUNDS, { charge: 'entity.vex.nope' }) });
catches({ VexAmbientGoal: function () { this.tick = () => {}; } });
catches({ vexSound: () => false });
catches({ vexSound: (e, k, r) => Ai.vexSound(e, k === 'charge' ? 'hurt' : k, r) && Ai.vexSound(e, k, r) });
ok(breaks === 5, 'all 5 mutations detected');

console.log(`vexsoundcheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  x ' + f);
process.exit(fails.length ? 1 : 0);
