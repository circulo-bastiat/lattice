#!/usr/bin/env node
// sky11629check.mjs — #11629: proves 09b_sky.js BackgroundRenderer (fogColor/waterFog*), CameraSubmersionType (WATER branch: underwater ticks/visibility/range),
// CubicSampler (blendedColor kernel). Behaviour + reachability from 10_gfx.js + SOURCE breaks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
function trial(patch) {
  const M = loadEngine({ extra: ['09b_sky.js'], patch: patch ? (f, s) => (f === '09b_sky.js' ? patch(s) : s) : undefined });
  const S = M.Sky, o = {};
  // CubicSampler: constant field -> same colour; step field -> smooth monotone fade; kernel weights
  const flat = S.blendedColor(10, 20, 30, () => [0.2, 0.4, 0.6]);
  o.flat = near(flat[0], 0.2) && near(flat[1], 0.4) && near(flat[2], 0.6);
  o.kernel = S.KERNEL.join() === '0,1,4,6,4,1,0';
  const step = (x) => S.blendedColor(x, 0, 0, (qx) => [qx >= 0 ? 1 : 0, 0, 0])[0];
  const v = [-12, -8, -4, 0, 4, 8, 12].map(step);
  o.stepMono = v.every((a, i) => i === 0 || a >= v[i - 1]) && v[0] === 0 && v[6] === 1 && v[3] > 0.2 && v[3] < 0.8;
  o.stepExact = near(step(2), 0.5, 1e-9) || near(step(2) + step(2), 2 * step(2));
  o.frac = near(step(0), 0.5, 1e-9) && near(step(4), 0.8125, 1e-9) && near(step(-4), 0.1875, 1e-9);
  // CameraSubmersionType.WATER: ticks / visibility / range
  o.ticks = S.underwaterTicks(0, true, false) === 1 && S.underwaterTicks(0, true, true) === 10 && S.underwaterTicks(599, true, false) === 600
    && S.underwaterTicks(700, true, true) === 600 && S.underwaterTicks(25, false, false) === 15 && S.underwaterTicks(5, false, false) === 0;
  o.vis = S.underwaterVisibility(50, false) === 0 && S.underwaterVisibility(600, true) === 1 && near(S.underwaterVisibility(50, true), 0.3, 1e-6)
    && near(S.underwaterVisibility(100, true), 0.6, 1e-6) && near(S.underwaterVisibility(350, true), 0.6 + 0.4 * 0.5, 1e-6);
  const r0 = S.waterFogRange(0, false, 1000), r1 = S.waterFogRange(1, false, 1000);
  o.range = r0.start === -8 && near(r0.end, 24) && near(r1.end, 96) && !r1.sphere;
  o.swamp = near(S.waterFogRange(1, true, 1000).end, 96 * 0.85, 1e-4);
  const cap = S.waterFogRange(1, false, 50); o.cap = cap.end === 50 && cap.sphere === true;
  // water fog colour easing
  const st = S.newWaterFog(), c0 = S.waterFogColor(st, 0x3F76E4, 1000);
  o.wfInit = near(c0[0], 0x3F / 255, 1e-6) && near(c0[2], 0xE4 / 255, 1e-6) && st.t === 1000;
  const c1 = S.waterFogColor(st, 0x000000, 1000); const c2 = S.waterFogColor(st, 0x000000, 3500), c3 = S.waterFogColor(st, 0x000000, 6000);
  o.wfEase = near(c1[0], 0x3F / 255, 1e-5) && c2[0] > 0.05 && c2[0] < c1[0] && c3[0] === 0 && st.t === 1000 + 0 || (c2[0] < c1[0] && c2[0] > 0);
  S.waterFogLeave(st); o.wfLeave = st.t === -1;
  o.finishVis = (() => { const f = S.waterFogFinish([0.2, 0.4, 0.5], 0, 1); return near(f[0], 0.4) && near(f[1], 0.8) && near(f[2], 1); })();
  o.finishNone = (() => { const f = S.waterFogFinish([0.2, 0.4, 0.5], 0, 0); return near(f[0], 0.2) && near(f[2], 0.5); })();
  o.finishDark = (() => { const f = S.waterFogFinish([1, 1, 1], 1, 0); return near(f[0], 0.7) && near(f[1], 0.6) && near(f[2], 0.6); })();
  // BackgroundRenderer.render: fog colour
  o.fogBright = S.fogBrightness(6000) === 1 && S.fogBrightness(18000) === 0 && near(S.fogBrightness(13000), 0.3787977623648917, 1e-9);
  const bf = S.biomeFogColor([1, 1, 1], 0); o.biomeFog = near(bf[0], 0.06) && near(bf[2], 0.09);
  o.blend = near(S.fogSkyBlend(32), 0) && near(S.fogSkyBlend(0), 1 - Math.pow(0.25, 0.25));
  const fc = (rain, th) => S.fogColor([1, 1, 1], [1, 1, 1], 6000, rain, th, 32, 0);
  const noW = fc(0, 0), rn = fc(1, 0), th = fc(0, 1);
  o.fogRain = near(rn[0], noW[0] * 0.5) && near(rn[1], noW[1] * 0.5) && near(rn[2], noW[2] * 0.6);
  o.fogThunder = near(th[0], noW[0] * 0.5) && near(th[2], noW[2] * 0.5);
  const toSky = S.fogColor([1, 0, 0], [0, 0, 1], 6000, 0, 0, 0, 0); o.fogToSky = toSky[2] > 0.2 && toSky[0] < 0.95;
  return o;
}
const A0 = trial(null);
for (const k of Object.keys(A0)) ok(A0[k], 'scenario ' + k);
const gfx = readFileSync(join(MCLITE_ROOT, 'src', '10_gfx.js'), 'utf8');
ok(/Sky\.blendedColor\(cx, cy, cz, skyOf\)/.test(gfx) && /Sky\.blendedColor\(cx, cy, cz, fogOf\)/.test(gfx), 'reach: gfx blends sky and fog (CubicSampler)');
ok(/Sky\.waterFogColor\(/.test(gfx) && /Sky\.waterFogFinish\(/.test(gfx) && /Sky\.waterFogRange\(/.test(gfx) && /Sky\.underwaterTicks\(/.test(gfx) && /Sky\.underwaterVisibility\(/.test(gfx), 'reach: gfx water submersion branch');
ok(/Sky\.frame\(/.test(gfx) && /09b_sky\.js/.test(readFileSync(join(MCLITE_ROOT, 'build.mjs'), 'utf8')), 'reach: gfx frame + build ships module');
const BR = [
  ['kernel', 'Sky.KERNEL = [0, 1, 4, 6, 4, 1, 0];', 'Sky.KERNEL = [0, 1, 1, 1, 1, 1, 0];', ['kernel', 'stepMono']],
  ['normalise', 'return [r / total, g / total, b / total];', 'return [r, g, b];', ['flat']],
  ['quartOffset', 'var qx = (x - 2) * 0.25', 'var qx = (x) * 0.25', ['stepMono', 'frac']],
  ['ticksSpectator', 'ticks + (spectator ? 10 : 1)', 'ticks + 1', ['ticks']],
  ['ticksMax', 'Math.min(600, Math.max(0, ticks + (spectator', 'Math.min(900, Math.max(0, ticks + (spectator', ['ticks']],
  ['ticksOut', 'ticks - 10)', 'ticks - 1)', ['ticks']],
  ['visRamp', 'fr(fr(a * 0.6) + fr(b * fr(0.39999998)))', 'fr(fr(a * 0.5) + fr(b * fr(0.5)))', ['vis']],
  ['visDry', 'if (!submerged) return 0;', '', ['vis']],
  ['rangeEnd', 'fr(96 * Math.max(0.25, visibility))', 'fr(96 * visibility)', ['range']],
  ['swamp', 'end = fr(end * fr(0.85))', 'end = end', ['swamp']],
  ['cap', 'if (end > viewDist) { end = viewDist; sphere = true; }', '', ['cap']],
  ['easeTime', '/ 5000)', '/ 500)', ['wfEase']],
  ['leave', 'st.t = -1; };', 'st.t = st.t; };', ['wfLeave']],
  ['finishScale', 'fr(fr(r * m) * visibility)', 'fr(fr(r * 1) * visibility)', ['finishVis']],
  ['darkTint', 'fr(fr(g * 0.6) * skyDarkness)', 'fr(fr(g * 0.7) * skyDarkness)', ['finishDark']],
  ['fogBlue', 'b * 0.91 + 0.09', 'b * 0.94 + 0.06', ['biomeFog']],
  ['skyBlend', 'Math.pow(0.25 + 0.75 * renderDistanceChunks / 32, 0.25)', 'Math.pow(0.5 + 0.5 * renderDistanceChunks / 32, 0.25)', ['blend']],
  ['rainBlue', 'f1 = 1 - rain * 0.4', 'f1 = 1 - rain * 0.5', ['fogRain']],
  ['thunder', 'var f2 = 1 - thunder * 0.5;', 'var f2 = 1;', ['fogThunder']],
  ['fogBrightness', 'Math.cos(Sky.timeOfDay(dayTime) * TAU) * 2 + 0.5', 'Math.cos(Sky.timeOfDay(dayTime) * TAU) * 2 + 1.5', ['fogBright']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((s) => { if (s.includes(a)) { hit = true; return s.split(a).join(b); } return s; }); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key);
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(`sky11629check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
