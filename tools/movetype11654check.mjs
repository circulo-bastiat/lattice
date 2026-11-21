#!/usr/bin/env node
// movetype11654check.mjs — #11654: proves 07zz1_phantom.js's MovementType (the circle/swoop state, e.phantomMovementType)
// is REACHED from 07k_goals.js's phantom goal builder and drives goal gating. SOURCE breaks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const M = loadEngine({ extra: ['07zz1_phantom.js'], dom: false, patch: patch ? (f, s) => (f === '07zz1_phantom.js' ? patch(s) : s) : undefined });
  const Ph = M.Phantom, o = {};
  let n = 0; const ctx = { random: () => ((n = (n * 7 + 3) % 10) / 10) };
  const mk = () => ({ type: 'phantom', x: 0, y: 80, z: 0, width: 0.9, height: 0.5, age: 0, target: { x: 0, y: 64, z: 0, width: 0.6, height: 1.8 } });
  // circle -> swoop after the 10-tick cooldown
  let e = mk(); const sa = new Ph.StartAttackGoal(e, ctx); sa.start();
  o.startCircle = e.phantomMovementType === 'circle';
  for (let i = 0; i < 12; i++) sa.tick();
  o.toSwoop = e.phantomMovementType === 'swoop';
  // goal gating by movement type
  const sw = new Ph.SwoopMovementGoal(e, ctx), ci = new Ph.CircleMovementGoal(e, ctx);
  o.gateSwoop = sw.canUse() === true && ci.canUse() === false;
  // a bite returns to circle
  e.x = 0; e.y = 64; e.z = 0; sw.tick();
  o.biteCircle = e.phantomMovementType === 'circle' && ci.canUse() === true && sw.canUse() === false;
  // stopping the swoop returns to circle and drops target
  e.phantomMovementType = 'swoop'; sw.stop();
  o.stopCircle = e.phantomMovementType === 'circle' && e.target === null;
  return o;
}
const A0 = trial(null);
for (const k of Object.keys(A0)) ok(A0[k], 'scenario ' + k);
const gl = readFileSync(join(MCLITE_ROOT, 'src', '07k_goals.js'), 'utf8');
ok(/gs\.add\(1, 0, new Ph\.StartAttackGoal\(e, ctx\)\)/.test(gl) && /new Ph\.SwoopMovementGoal\(e, ctx\)/.test(gl) && /new Ph\.CircleMovementGoal\(e, ctx\)/.test(gl), 'reach: 07k_goals phantom builder adds the three goals');
const BR = [
  ['toswoop', "e.phantomMovementType = 'swoop';\n          startSwoop();", "startSwoop();", ['toSwoop', 'gateSwoop']],
  ['gate', "return !!e.target && e.phantomMovementType === 'swoop'; };", "return !!e.target; };", ['gateSwoop', 'biteCircle']],
  ['circgate', "return !e.target || e.phantomMovementType === 'circle'; };", "return true; };", ['gateSwoop']],
  ['startreset', "cooldown = 10; e.phantomMovementType = 'circle';", "cooldown = 10;", ['startCircle']],
  ['stop', "this.stop = function () { e.target = null; e.phantomMovementType = 'circle'; };", "this.stop = function () { e.target = null; };", ['stopCircle']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((s) => { if (s.includes(a)) { hit = true; return s.split(a).join(b); } return s; }); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key);
  if (caught) console.log('  ✓ break caught: ' + key);
}
for (const f of fails) console.log('FAIL', f);
console.log(`movetype11654check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
