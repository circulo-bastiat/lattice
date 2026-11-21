#!/usr/bin/env node
// gotovillageaudit11484check.mjs — #11484: GoToVillageGoal (FoxEntity.GoToVillageGoal(400, 200)) via Fox.GoToVillageGoal.
// Anti-vacuity: each source break of 07zj_fox.js must fail its row.
import fs from 'node:fs';
import { loadEngine } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const M = loadEngine({ extra: ['07zj_fox.js'], dom: false, ...(patch ? { patch } : {}) });
  const Fx = M.Fox, o = {}; if (!M.Ai) M.Ai = {};
  M.Ai.findPath = () => [{ x: 0, y: 64, z: 0 }, { x: 1, y: 64, z: 0 }];
  const mk = (over) => Object.assign({ x: 8.5, y: 64, z: 8.5 }, over || {});
  const mkGoal = (e, day, rolls, poi) => {
    let i = 0;
    return new Fx.GoToVillageGoal(e, { isDay: () => day, random: () => { const v = rolls[i % rolls.length]; i++; return v; }, occupiedPositions: () => poi });
  };
  const near = [{ x: 8, y: 64, z: 8 }];
  const far = [{ x: 8 + 16 * 7, y: 64, z: 8 }];
  // roll 0 passes floor(rand*100)==0; later rolls pick fuzzy targets
  o.night = mkGoal(mk(), false, [0, 0.5], near).canUse() === true;
  o.day = mkGoal(mk(), true, [0, 0.5], near).canUse() === false;
  o.roll = mkGoal(mk(), false, [0.5], near).canUse() === false;
  o.far = mkGoal(mk(), false, [0, 0.5], far).canUse() === false;
  
  o.sleep = mkGoal(mk({ sleeping: true }), false, [0, 0.5], near).canUse() === false;
  o.target = mkGoal(mk({ target: {} }), false, [0, 0.5], near).canUse() === false;
  o.pass = mkGoal(mk({ passengers: [{}] }), false, [0, 0.5], near).canUse() === false;
  // edge: exactly 6 sections away still counts
  o.edge = mkGoal(mk(), false, [0, 0.5], [{ x: 8 + 16 * 6, y: 64, z: 8 }]).canUse() === true;
  // no path -> refuse
  M.Ai.findPath = () => null;
  o.nopath = mkGoal(mk(), false, [0, 0.5], near).canUse() === false;
  M.Ai.findPath = () => [{ x: 0, y: 64, z: 0 }, { x: 1, y: 64, z: 0 }];
  const g = mkGoal(mk(), false, [0, 0.5], near);
  g.canUse();
  o.cont = g.canContinueToUse() === true;
  g.stop(); o.stop = g.canContinueToUse() === false;
  return o;
}
const LBL = { night: 'starts at night near a POI', day: 'refuses by day', roll: 'refuses on failed 1-in-100 roll', far: 'POI beyond 6 sections refused', sleep: 'sleeping refused', target: 'has target refused', pass: 'passengers refused', edge: '6-section POI accepted', nopath: 'no path refused', cont: 'continues while path remains', stop: 'stop clears path' };
const A = trial(null);
for (const [k, m] of Object.entries(LBL)) ok(A[k], m);
const BR = [
  ['day', /if \(env\.isDay\(\)\) return false;/, ''],
  ['roll', /Math\.floor\(rand\(\) \* searchRange\) !== 0\) return false;/, 'false) return false;'],
  ['far', /\)\) <= 6\) \{ near = true/, ')) <= 9) { near = true'],
  ['edge', /\)\) <= 6\) \{ near = true/, ')) < 6) { near = true'],
  ['sleep', /function can\(\) \{ return !e\.sleeping/, 'function can() { return true'],
  ['target', /&& !e\.aggressive && !e\.target; \}/, '&& !e.aggressive; }'],
  ['pass', /if \(e\.passengers && e\.passengers\.length\) return false;/, ''],
  ['nopath', /return !!\(path && path\.length > 1\);/, 'return true;'],
  ['stop', /this\.stop = function \(\) \{ path = null; target = null; \};\n    this\.tick = function \(\) \{\n      if \(path && idx < path\.length\) \{\n        Ai_stepToward\(e, path\[idx\], 1\.0\)/, 'this.stop = function () { target = null; };\n    this.tick = function () {\n      if (path && idx < path.length) {\n        Ai_stepToward(e, path[idx], 1.0)'],
];
const SRC = fs.readFileSync(new URL('../src/07zj_fox.js', import.meta.url), 'utf8');
for (const [key, re, rep] of BR) {
  if (!re.test(SRC)) { fails.push('pattern not found: ' + key); continue; }
  breaks++; let hit = false;
  const B = trial((f, src) => { const n = f === '07zj_fox.js' ? src.replace(re, rep) : src; if (n !== src) hit = true; return n; });
  ok(hit, 'break pattern matched: ' + key); ok(!B[key], 'break must be caught: ' + key);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `${pass} ok, ${breaks} breaks caught, 0 failed`);
process.exit(fails.length ? 1 : 0);
