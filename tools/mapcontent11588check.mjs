#!/usr/bin/env node
// mapcontent11588check.mjs — #11588: proves 07pm_mapcontent.js (MapColor table/brightness, MapState.of centre snap,
// FilledMapItem.fillExplorationMap, colorsFor memo). Each source break must fail its row.
import { loadEngine } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const M = loadEngine({ extra: ['07pm_mapcontent.js'], dom: false, ...(patch ? { patch } : {}) }).MapContent, o = {};
  o.table = M.COLORS.length === 62 && M.COLORS[15] === 14188339 && M.COLORS[26] === 6704179 && M.COLORS[61] === 8365974 && M.CLEAR === 0 && M.ORANGE === 15 && M.BROWN === 26;
  o.byte = M.colorByte(15, 3) === 63 && M.colorByte(15, 1) === 61 && M.colorByte(63, 3) === 255;
  o.bright = M.renderColor(M.colorByte(15, 2)) === 0xff337fd8 && M.renderColor(M.colorByte(15, 3)) === 0xff1b4372 && M.renderColor(M.colorByte(15, 0)) !== M.renderColor(M.colorByte(15, 1));
  o.clear = M.renderColor(0) === 0 && M.renderColor(3) === 0 && M.renderColor(62 << 2) === 0;
  o.center = M.center(0, 0, 0).x === 0 && M.center(200, -300, 2).x === 192 && M.center(200, -300, 2).z === -320 && M.center(70, 70, 0).x === 128;
  const disc = (x, z) => (x * x + z * z < 900) ? 'ocean' : 'plains';
  const c = M.fillExploration(0, 0, 0, disc);
  o.len = c.length === 16384;
  o.orange = c[64 * 128 + 64] === 61;
  o.brown = c[64 * 128 + 34] === 107 && c[64 * 128 + 35] === 60;
  const h0 = {}; for (const v of c) h0[v] = (h0[v] || 0) + 1; o.brown = o.brown && h0[105] === 32;
  o.land = c[64 * 128 + 33] === 0 && c[2 * 128 + 2] === 0;
  const all = M.fillExploration(0, 0, 0, () => 'ocean'); o.border = all[0] === 0 && all[2 * 128] === 0 && all[127 * 128 + 127] === 0 && all[2 * 128 + 2] !== 0;
  const hist = {}; for (const v of c) hist[v] = (hist[v] || 0) + 1;
  o.hatch = hist[105] === 32 && hist[107] === 208 && hist[60] === 707 && hist[62] === 239 && c[65 * 128 + 64] === 0 && c[64 * 128 + 64] === 61;
  const sq = M.fillExploration(1, 0, 0, (x, z) => (x >= 0 && x < 20 && z >= 0 && z < 20) ? 'swamp' : 'plains');
  o.scale = sq[64 * 128 + 64] === 60 && sq[64 * 128 + 74] === 107 && sq[64 * 128 + 60] === 0;
  let calls = 0; const orig = M.fillExploration;
  M.fillExploration = (s, x, z) => { calls++; return orig(s, x, z, disc); };
  const tag = { scale: 2, target: { x: 10, z: 10 } };
  const a = M.colorsFor(tag), b = M.colorsFor({ scale: 2, target: { x: 100, z: 100 } });
  o.memo = a === b && calls === 1 && M.colorsFor({ scale: 2, target: { x: 600, z: 10 } }) !== a && calls === 2;
  o.nulltag = M.colorsFor(null) === null && M.colorsFor({ scale: 1 }) === null;
  return o;
}
const A = trial(null);
for (const k of Object.keys(A)) ok(A[k], 'scenario ' + k + ' ' + JSON.stringify(A));
const F = '07pm_mapcontent.js';
const BR = [
  ['table', '14188339', '14188340'],
  ['byte', '((id << 2) | (brightnessId & 3))', '((id << 2) | (brightnessId & 2))'],
  ['bright', 'MC.BRIGHTNESS = [180, 220, 255, 135];', 'MC.BRIGHTNESS = [180, 220, 255, 136];'],
  ['clear', 'if (id === 0 || id >= MC.COLORS.length) return 0;', ''],
  ['center', 's / 2 - 64', 's / 2'],
  ['orange', 'col = MC.ORANGE;', 'col = MC.BROWN;'],
  ['brown', 'br = n > 3 ? 1 : 3;', 'br = 3;'],
  ['land', '} else if (n > 0) {', '} else if (n > -1) {'],
  ['border', 'px = 1; px < 127', 'px = 0; px < 127'],
  ['hatch', 'else if (n > 7) col = MC.CLEAR;', 'else if (n > 7) col = MC.ORANGE;'],
  ['scale', 'catAt((x0 + j) * sc, (z0 + i) * sc)', 'catAt(x0 + j, z0 + i)'],
  ['memo', 'return cache[k] ||', 'return '],
  ['nulltag', 'if (!tag || !tag.target) return null;', ''],
];
for (const [key, a, b] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((f, s) => { if (f === F && s.includes(a)) { hit = true; return s.replace(a, b); } return s; }); } catch { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  ok(!X[key], 'anti-vacuity: break ' + key);
  if (!X[key]) console.log('  ✓ break caught: ' + key);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `mapcontent11588check: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
