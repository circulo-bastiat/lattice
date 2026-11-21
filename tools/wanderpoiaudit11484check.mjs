#!/usr/bin/env node
// wanderpoiaudit11484check.mjs — #11484: Ai.WanderAroundPointOfInterestGoal (PointOfInterest section distance, CuboidBlockIterator
// scan order, <=1 refusal). Anti-vacuity: source breaks of 07k_goals.js must fail their row.
import fs from 'node:fs';
import { loadEngine } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const M = loadEngine({ extra: ['07k_goals.js'], dom: false, ...(patch ? { patch } : {}) });
  const Ai = M.Ai, o = {};
  let seen = null;
  Ai.findTowardPositionTarget = (e) => { seen = e.positionTarget; return { x: 1, y: 64, z: 1 }; };
  Ai.findPath = () => [{ x: 0, y: 64, z: 0 }, { x: 1, y: 64, z: 0 }];
  const run = (pois, pos) => {
    seen = null; M.Poi = { occupiedPositions: () => pois };
    const e = Object.assign({ x: 8, y: 64, z: 8, despawnCounter: 0 }, pos || {});
    const g = new Ai.WanderAroundPointOfInterestGoal(e, 1.0, () => 0);
    return { r: g.canUse(), seen, g };
  };
  // POI in same section (dist 0) and neighbour section (dist 1): refuse
  o.same = run([{ x: 8, y: 64, z: 8 }]).r === false;
  o.adj = run([{ x: 24, y: 64, z: 8 }]).r === false;
  // no POIs at all: dist 7 everywhere -> nothing closer -> refuse
  o.none = run([]).r === false;
  // POI 2 sections away: accepted, target is centre of the nearest-to-POI cell (sx+1)
  const a = run([{ x: 40, y: 64, z: 8 }]);
  o.near = a.r === true && a.seen && a.seen.x === 40 && a.seen.y === 72 && a.seen.z === 8;
  // 7 sections away: out of the +-2 scan window still sees dist 7-2=5 < 7 -> goes
  const b = run([{ x: 8 + 16 * 5, y: 64, z: 8 }]);
  o.win = b.r === true && b.seen.x === 8 + 32;
  // tie: POIs symmetric either side; x fastest from -2 so the earliest cell (dx=-1 .. ) wins
  const t = run([{ x: -40, y: 64, z: 8 }, { x: 56, y: 64, z: 8 }]);
  o.tie = t.r === true && t.seen.x === -24 && t.seen.y === 56 && t.seen.z === -8;
  // despawn counter refusal from the inner stroll goal
  o.desp = run([{ x: 40, y: 64, z: 8 }], { despawnCounter: 100 }).r === false;
  // y axis matters
  const c = run([{ x: 8, y: 64 + 16 * 3, z: 8 }]);
  o.yaxis = c.r === true && c.seen.y === 104 && c.seen.x === -8;
  // positionTarget restored after the lookup
  const d = run([{ x: 40, y: 64, z: 8 }], { positionTarget: { x: 1, y: 2, z: 3 } });
  o.restore = d.r === true;
  o.finder = (() => { const g = run([{ x: 40, y: 64, z: 8 }]).g; return g.canContinueToUse() === false; })();
  return o;
}
const LBL = { same: 'POI in own section refused', adj: 'POI in adjacent section refused', none: 'no POI refused', near: 'targets nearer-to-POI section centre', win: 'scan window +-2 picks nearest', tie: 'tie goes to first cell in x-fastest order', desp: 'despawn counter refuses', yaxis: 'y axis counted', restore: 'accepted with preset positionTarget', finder: 'idle before start' };
const A = trial(null);
for (const [k, m] of Object.entries(LBL)) ok(A[k], m + (A[k] ? '' : ' (baseline)'));
const BR = [
  ['adj', /dist\(sx, sy, sz\) <= 1 \|\| !inner\.canUse\(\)/, 'dist(sx, sy, sz) <= 0 || !inner.canUse()'],
  ['win', /for \(var dz = -2; dz <= 2; dz\+\+\) for \(var dy = -2; dy <= 2; dy\+\+\) for \(var dx = -2; dx <= 2; dx\+\+\)/, 'for (var dz = -1; dz <= 1; dz++) for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++)'],
  ['tie', /if \(d < bd\) \{ bd = d; best =/, 'if (d <= bd) { bd = d; best ='],
  ['desp', /if \(\(e\.despawnCounter \| 0\) >= 100\) return false;/, ''],
  ['yaxis', /Math\.abs\(sec\(ps\[i\]\.y\) - sy\), /, ''],
];
const SRC = fs.readFileSync(new URL('../src/07k_goals.js', import.meta.url), 'utf8');
for (const [key, re, rep] of BR) {
  if (!re.test(SRC)) { fails.push('pattern not found: ' + key); continue; }
  breaks++; let hit = false;
  const B = trial((f, src) => { const n = f === '07k_goals.js' ? src.replace(re, rep) : src; if (n !== src) hit = true; return n; });
  const caught = !B[key];
  ok(hit, 'break pattern matched: ' + key); ok(caught, 'break must be caught: ' + key);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `${pass} ok, ${breaks} breaks caught, 0 failed`);
process.exit(fails.length ? 1 : 0);
