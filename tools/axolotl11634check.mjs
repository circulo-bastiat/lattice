#!/usr/bin/env node
// axolotl11634check.mjs — #11634: proves 07zm_axolotl.js (AxolotlBrain's PlayDeadTask/ForgetTask/RangedApproachTask speed, AxolotlEntityRenderer skin picker) + reachability, SOURCE breaks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const MCL = loadEngine({ extra: ['07zm_axolotl.js'], dom: false, patch: patch ? (f, s) => (f === '07zm_axolotl.js' ? patch(s) : s) : undefined });
  MCL.Entities = MCL.Entities || { bare: (t) => String(t).replace(/^minecraft:/, '') };
  const Ax = MCL.Axolotl, o = {};
  o.skin = [0, 1, 2, 3, 4].every((i) => Ax.skinKey({ type: 'axolotl', axolotlVariant: i }) === (i ? 'axolotl#' + i : 'axolotl'));
  o.speed = Ax.approachSpeed({ inWater: true }) === 0.6 && Ax.approachSpeed({ inWater: false }) === 0.15;
  const mk = () => ({ type: 'axolotl', inWater: true, health: 14, maxHealth: 14 });
  const zero = () => 0;
  let a = mk(); const r = Ax.onDamaged(a, 2, zero);
  o.start = r === true && a.playingDead === true && a.playDeadTicks === 200;
  o.gate = Ax.onDamaged({ ...mk(), inWater: false }, 2, zero) === false && Ax.onDamaged({ ...mk(), playingDead: true }, 2, zero) === false
    && Ax.onDamaged(mk(), 14, zero) === false && Ax.onDamaged({ type: 'cow', inWater: true, health: 14 }, 2, zero) === false;
  o.roll = (() => { const q = [0.9, 0]; return Ax.onDamaged({ ...mk(), health: 5 }, 2, () => q.shift()) === false; })();
  o.clear = (a.walkTarget === null && a.lookTarget === null && a.path === null);
  a.huntingCooldown = 5; Ax.tickPlayDead(a);
  o.tick = a.playDeadTicks === 199 && a.playingDead && a.huntingCooldown === 4;
  a.playDeadTicks = 1; Ax.tickPlayDead(a);
  o.expire = a.playingDead === false && a.playDeadTicks === 0;
  const b = { playingDead: true, playDeadTicks: 100, breedTarget: {} }; Ax.tickPlayDead(b);
  o.forget = b.playingDead === false && b.playDeadTicks === 0;
  return o;
}
const A0 = trial(null);
for (const k of Object.keys(A0)) ok(A0[k], 'scenario ' + k);
const rd = (f) => readFileSync(join(MCLITE_ROOT, 'src', f), 'utf8');
ok(/Axolotl\.tickPlayDead\(e\)/.test(rd('07i_entitylist.js')), 'reach: entity tick calls tickPlayDead');
ok(/Ax\.skinKey/.test(rd('07j_entityrender.js')), 'reach: renderer uses skinKey');
ok(/axolotl: function \(e, ctx\)/.test(rd('07k_goals.js')), 'reach: Ai roster axolotl');
const BR = [
  ['skin', "Ax.SKIN[e.axolotlVariant | 0] || Ax.SKIN[0]", "Ax.SKIN[0]", ['skin']],
  ['speedw', 'Ax.APPROACH_SPEED_WATER = 0.6', 'Ax.APPROACH_SPEED_WATER = 0.5', ['speed']],
  ['speedl', 'Ax.APPROACH_SPEED_LAND = 0.15', 'Ax.APPROACH_SPEED_LAND = 0.2', ['speed']],
  ['ticks', 'Ax.PLAY_DEAD_TICKS = 200', 'Ax.PLAY_DEAD_TICKS = 100', ['start']],
  ['water', 'if (!e.inWater) return false;', '', ['gate']],
  ['already', 'if (e.playingDead) return false;\n    if (!e.inWater)', 'if (!e.inWater)', ['gate']],
  ['lethal', '!(amount < (e.health || 0))', 'false', ['gate']],
  ['roll', 'Math.floor(rand() * 3) !== 0', 'false', ['roll']],
  ['forget', 'if (e.breedTarget) {', 'if (false) {', ['forget']],
  ['cool', 'e.huntingCooldown--', 'e.huntingCooldown', ['tick']],
  ['dec', 'e.playDeadTicks = (e.playDeadTicks | 0) - 1;', '', ['tick']],
  ['expire', 'if (e.playDeadTicks <= 0) {', 'if (e.playDeadTicks < 0) {', ['expire']],
  ['clear', 'e.path = null; e.walkTarget = null; e.lookTarget = null;', '', ['clear']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((s) => { if (s.includes(a)) { hit = true; return s.split(a).join(b); } return s; }); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key);
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(`axolotl11634check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
