#!/usr/bin/env node
// spideraudit11484check.mjs — #11484: SpiderNavigation idle tick (SpiderAttackGoal no-path branch) vs .decomp SpiderNavigation.java.
// Anti-vacuity: source breaks of 07k_goals.js must fail their row.
import fs from 'node:fs';
import { loadEngine } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const M = loadEngine({ extra: ['07k_goals.js'], dom: false, ...(patch ? { patch } : {}) });
  const Ai = M.Ai;
  let moved = null;
  Ai.findPath = () => null; Ai.meleeNavTick = () => {};
  Ai.stepToward = (e, p) => { moved = p; };
  const run = (e, t) => {
    moved = null;
    const g = new Ai.SpiderAttackGoal(Object.assign({ width: 1, age: 100 }, e), { random: () => 0.5 });
    g.start(); g.tick(); return moved;
  };
  const o = {};
  const sp = { x: 0.5, y: 64, z: 0.5 };
  const far = run(sp, null); // no target -> nothing
  o.notarget = far === null;
  const spT = (e, t) => { const ee = Object.assign({ width: 1, age: 100 }, e); ee.target = t; moved = null;
    const g = new Ai.SpiderAttackGoal(ee, { random: () => 0.5 }); g.start(); g.tick(); return moved; };
  const m1 = spT(sp, { x: 10.5, y: 64, z: 0.5, width: 0.6 });
  o.walk = !!m1 && m1.x === 10 && m1.y === 64 && m1.z === 0;
  o.near = spT(sp, { x: 0.5, y: 64, z: 0.5, width: 0.6 }) === null;       // inside its own width: stop
  o.edge = !!spT({ x: 0.5, y: 64.5, z: 0.5 }, { x: 1.5, y: 64, z: 0.5, width: 0.6 });               // exactly width away: strict <, keeps moving
  o.above = spT({ x: 0.5, y: 70, z: 0.5 }, { x: 0.5, y: 64, z: 0.5, width: 0.6 }) === null;   // level above, within width horizontally
  o.aboveFar = !!spT({ x: 5.5, y: 70, z: 0.5 }, { x: 0.5, y: 64, z: 0.5, width: 0.6 });
  o.below = !!spT({ x: 0.5, y: 58, z: 0.5 }, { x: 0.5, y: 64, z: 0.5, width: 0.6 });         // not above: no level shortcut
  return o;
}
const LBL = { notarget: 'no target idle', walk: 'walks straight at unreachable target block', near: 'stops within own width', edge: 'width test is strict <', above: 'stops level above target within width', aboveFar: 'above but far still walks', below: 'below target keeps climbing' };
const A = trial(null);
for (const [k, m] of Object.entries(LBL)) ok(A[k], m + (A[k] ? '' : ' (baseline)'));
const BR = [
  ['edge', /return ddx \* ddx \+ ddy \* ddy \+ ddz \* ddz < w \* w;/, 'return ddx * ddx + ddy * ddy + ddz * ddz <= w * w;'],
  ['above', /\|\| \(e\.y > ty && near\(Math\.floor\(e\.y\)\)\)/, ''],
  ['below', /e\.y > ty && near/, 'e.y !== ty && near'],
  ['near', /if \(!\(near\(ty\) \|\|/, 'if (!(false ||'],
  ['walk', /Ai\.stepToward\(e, \{ x: tx, y: ty, z: tz \}, speed\);/, ''],
];
const SRC = fs.readFileSync(new URL('../src/07k_goals.js', import.meta.url), 'utf8');
for (const [key, re, rep] of BR) {
  if (!re.test(SRC)) { fails.push('pattern not found: ' + key); continue; }
  breaks++; let hit = false;
  const B = trial((f, src) => { const n = f === '07k_goals.js' ? src.replace(re, rep) : src; if (n !== src) hit = true; return n; });
  ok(hit, 'break pattern matched: ' + key); ok(!B[key], 'break must be caught: ' + key);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `${pass} ok, ${breaks} breaks caught, 0 failed`);
process.exit(fails.length ? 1 : 0);
