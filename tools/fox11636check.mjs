#!/usr/bin/env node
// fox11636check.mjs — #11636: proves 07zj_fox.js (FoxEntityRenderer skinKey, Type.fromBiome, JumpChasingGoal dive, canJumpChase), reachability, SOURCE breaks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const MCL = loadEngine({ extra: ['07zj_fox.js'], dom: false, patch: patch ? (f, s) => (f === '07zj_fox.js' ? patch(s) : s) : undefined });
  const F = MCL.Fox, o = {};
  MCL.Entities = MCL.Entities || { bare: (t) => String(t).replace('minecraft:', '') };
  o.skinRed = F.skinKey({ type: 'fox', foxType: 0 }) === 'fox';
  o.skinSnow = F.skinKey({ type: 'minecraft:fox', foxType: 1 }) === 'snow_fox';
  o.sleepRed = F.skinKey({ type: 'fox', foxType: 0, sleeping: true }) === 'fox_sleep';
  o.sleepSnow = F.skinKey({ type: 'fox', foxType: 1, sleeping: true }) === 'snow_fox_sleep';
  o.notFox = F.skinKey({ type: 'cow', foxType: 1 }) === null;
  o.biome = F.fromBiome(2) === 1 && F.fromBiome(0) === 0 && F.fromBiome(1) === 0;
  const e = {}; F.setType(e, 1); const e2 = {}; F.setType(e2, 7);
  o.setType = e.foxType === 1 && e2.foxType === 0;
  const clear = () => true;
  const t = { x: 6, y: 0, z: 0 };
  o.chase = F.canJumpChase({ x: 0, y: 0, z: 0 }, t, clear) === true && F.canJumpChase({ x: 0, y: 0, z: 0 }, t, (x, y) => !(y === 2 && x >= 4)) === false;
  const fox = { x: 0, y: 0, z: 0, crouchTicks: 15, target: t, onGround: true };
  const g = new F.JumpChasingGoal(fox, { isReplaceable: clear });
  o.canUse = g.canUse() === true;
  o.notCrouched = new F.JumpChasingGoal({ x: 0, y: 0, z: 0, crouchTicks: 14, target: t }, { isReplaceable: clear }).canUse() === false;
  g.start();
  o.start = fox.jumping === true && fox.chasing === true && Math.abs(fox.vy - 0.9) < 1e-9 && Math.abs(fox.vx - 0.8) < 1e-9;
  return o;
}
const A0 = trial(null);
for (const k of Object.keys(A0)) ok(A0[k], 'scenario ' + k);
const rd = (f) => readFileSync(join(MCLITE_ROOT, 'src', f), 'utf8');
ok(/new Fx\.JumpChasingGoal\(e, ctx\)/.test(rd('07k_goals.js')), 'reach: 07k_goals adds JumpChasingGoal');
ok(/NS\.Fox\.skinKey\(e\)/.test(rd('07j_entityrender.js')), 'reach: 07j_entityrender calls Fox.skinKey');
ok(/NS\.Fox\.typeAt\(e\.x, e\.z\)/.test(rd('07i_entitylist.js')), 'reach: 07i_entitylist calls Fox.typeAt');
const BR = [
  ['snowskin', "Fx.SKIN = ['fox', 'snow_fox']", "Fx.SKIN = ['fox', 'fox']", ['skinSnow', 'sleepSnow']],
  ['sleepsuf', "(e.sleeping ? '_sleep' : '')", "''", ['sleepRed']],
  ['notfox', "!== 'fox') return null", "!== 'foxx') return null", ['notFox', 'skinRed']],
  ['biome', 'precip === 2 /* PRECIP_SNOW */', 'precip === 1', ['biome']],
  ['settype', '(type === Fx.TYPE.SNOW) ? Fx.TYPE.SNOW : Fx.TYPE.RED', 'type', ['setType']],
  ['crouch', 'return (e.crouchTicks | 0) >= 15;', 'return (e.crouchTicks | 0) >= 14;', ['notCrouched']],
  ['six', 'i < 6; i++', 'i < 1; i++', ['chase']],
  ['three', 'h < 4; h++', 'h < 2; h++', ['chase']],
  ['vy', 'e.vy = (e.vy || 0) + 0.9', 'e.vy = (e.vy || 0) + 0.5', ['start']],
  ['vxz', 'dx / l * 0.8', 'dx / l * 0.4', ['start']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((s) => { if (s.includes(a)) { hit = true; return s.split(a).join(b); } return s; }); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key);
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(`fox11636check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
