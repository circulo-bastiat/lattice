#!/usr/bin/env node
// seekwateraudit11484check.mjs — #11484: SeekWaterTask(6, 0.15F) (AxolotlBrain IDLE) via Axolotl.SeekWaterGoal / seekWaterScan.
// Anti-vacuity: each source break of 07zm_axolotl.js must fail its row.
import fs from 'node:fs';
import { loadEngine } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const M = loadEngine({ extra: ['07zm_axolotl.js'], dom: false, ...(patch ? { patch } : {}) });
  const Ax = M.Axolotl, o = {};
  const water = new Set(['3,64,0', '0,64,-5', '2,64,2']);
  const isW = (x, y, z) => water.has(x + ',' + y + ',' + z);
  const air = (x, y, z) => !isW(x, y, z);
  o.consts = Ax.SEEK_WATER_RANGE === 6 && Ax.SEEK_WATER_SPEED === 0.15;
  // an air-topped water block wins over any other; first found in outward order
  // nearer water (3,64,0) is covered, farther (2,64,2) has air above: the air one wins
  let r = Ax.seekWaterScan(0, 64, 0, 6, isW, (x, y, z) => !(x === 3 && z === 0), 0.5, 64, 0.5);
  o.air = !!r && r.x === 2.5 && r.z === 2.5;
  // no water in range 6 -> null
  o.none = Ax.seekWaterScan(0, 64, 0, 6, (x, y, z) => x === 7 && y === 64 && z === 0, air, 0.5, 64, 0.5) === null;
  // own column is skipped
  o.col = Ax.seekWaterScan(0, 64, 0, 6, (x, y, z) => x === 0 && z === 0, air, 0.5, 64, 0.5) === null;
  // covered water (no air above) is the fallback
  const cov = (x, y, z) => x === 3 && z === 0 && (y === 64 || y === 65);
  r = Ax.seekWaterScan(0, 64, 0, 6, cov, () => false, 0.5, 64, 0.5);
  o.fallback = !!r && r.x === 3.5 && r.z === 0.5;
  // fallback skips water within 1.5 of the entity
  o.near = Ax.seekWaterScan(0, 64, 0, 6, (x, y, z) => x === 1 && y === 64 && z === 0, () => false, 1.0, 64, 0.5) === null;
  // iterateOutwards visits (2r+1)^3 positions for a cube radius
  let n = 0; Ax.iterateOutwards(0, 0, 0, 2, 2, 2, () => { n++; return false; }); o.iter = n === 125;
  const seen = new Set(); Ax.iterateOutwards(0, 0, 0, 1, 1, 1, (x, y, z) => { seen.add(x + ',' + y + ',' + z); return false; }); o.iterUniq = seen.size === 27;
  return o;
}
const LBL = { consts: 'range 6 speed 0.15', air: 'prefers water with air above', none: 'range 6 limit', col: 'own column skipped', fallback: 'covered water fallback', near: 'fallback ignores <1.5 away', iter: 'iterateOutwards count', iterUniq: 'iterateOutwards unique' };
const A = trial(null);
for (const [k, m] of Object.entries(LBL)) ok(A[k], m);
const BR = [
  ['consts', /Ax\.SEEK_WATER_RANGE = 6;/, 'Ax.SEEK_WATER_RANGE = 5;'],
  ['air', /if \(isAirAt\(x, y \+ 1, z\)\) \{ air = /, 'if (false) { air = '],
  ['none', /Ax\.iterateOutwards\(bx, by, bz, n, n, n,/, 'Ax.iterateOutwards(bx, by, bz, n + 2, n, n,'],
  ['col', /if \(x === bx && z === bz\) return false;/, ''],
  ['fallback', /if \(!any\) \{/, 'if (false) {'],
  ['near', /dz \* dz >= 2\.25\)/, 'dz * dz >= 0)'],
  ['iter', /if \(md > total\) return;/, 'if (md >= total) return;'],
  ['iterUniq', /swap = k !== 0;/, 'swap = false;'],
];
const SRC = fs.readFileSync(new URL('../src/07zm_axolotl.js', import.meta.url), 'utf8');
for (const [key, re, rep] of BR) {
  if (!re.test(SRC)) { fails.push('pattern not found: ' + key); continue; }
  breaks++; let hit = false;
  const B = trial((f, src) => { const n = f === '07zm_axolotl.js' ? src.replace(re, rep) : src; if (n !== src) hit = true; return n; });
  ok(hit, 'break pattern matched: ' + key); ok(!B[key], 'break must be caught: ' + key);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `${pass} ok, ${breaks} breaks caught, 0 failed`);
process.exit(fails.length ? 1 : 0);
