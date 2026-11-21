#!/usr/bin/env node
// waterfogcheck.mjs — #1892 ANIM-2 item 5: underwater fog colour/range vs BackgroundRenderer + ClientPlayerEntity.
//   BackgroundRenderer.java:30-63 (water colour, 5000 ms ease), 151-175 (tail), 219-233 (range);
//   ClientPlayerEntity.java:749-754 (ticks), 1029-1046 (visibility).
// Expected values are written out independently in doubles/by hand, not by calling the engine twice.
import { loadEngine } from './loadsrc.mjs';
const NS = loadEngine({ extra: ['02f_tags.js', '09b_sky.js'], dom: false });
const Sky = NS.Sky;
let n = 0, breaks = 0; const fails = [];
const eq = (a, b, m, eps = 1e-6) => { n++; if (!(Math.abs(a - b) <= eps)) fails.push(m + ': got ' + a + ' want ' + b); };
const trial = (name, fn) => { breaks++; const b = fails.length; fn(); if (fails.length === b) fails.push('anti-vacuity: ' + name + ' did not break'); else { fails.length = b; console.log('   ✓ caught: ' + name); } };
const run = (bias) => {
  // visibility ladder
  eq(Sky.underwaterVisibility(0, false), 0 + bias, 'out of water');
  eq(Sky.underwaterVisibility(0, true), 0, 'ticks 0');
  eq(Sky.underwaterVisibility(50, true), 0.5 * 0.6, 'ticks 50');
  eq(Sky.underwaterVisibility(100, true), 0.6, 'ticks 100');
  eq(Sky.underwaterVisibility(350, true), 0.6 + 0.5 * 0.39999998, 'ticks 350');
  eq(Sky.underwaterVisibility(600, true), 1, 'ticks 600');
  eq(Sky.underwaterTicks(599, true, false), 600, 'cap'); eq(Sky.underwaterTicks(5, false, false), 0, 'drain clamps at 0');
  eq(Sky.underwaterTicks(100, false, false), 90, 'drain 10'); eq(Sky.underwaterTicks(10, true, true), 20, 'spectator +10');
  // range
  let r = Sky.waterFogRange(0, false, 192); eq(r.end, 24, 'vis 0 -> 96*0.25'); eq(r.start, -8, 'start');
  r = Sky.waterFogRange(1, false, 192); eq(r.end, 96, 'vis 1'); eq(+r.sphere, 0, 'no sphere');
  r = Sky.waterFogRange(1, true, 192); eq(r.end, 96 * 0.85, 'swamp', 1e-4);
  r = Sky.waterFogRange(1, false, 64); eq(r.end, 64, 'capped'); eq(+r.sphere, 1, 'sphere when capped');
  // colour: first frame is the biome colour exactly, then eases over 5 s toward a new biome
  const st = Sky.newWaterFog();
  let c = Sky.waterFogColor(st, 0x3F76E4, 1000);   // plains water fog 0x050533 would differ; any colour works
  eq(c[0] * 255, 0x3F, 'r0', 1e-4); eq(c[2] * 255, 0xE4, 'b0', 1e-4);
  c = Sky.waterFogColor(st, 0x000000, 3500);       // biome changed: still the old colour this frame
  eq(c[0] * 255, 0x3F, 'still old on change frame', 1e-4);
  c = Sky.waterFogColor(st, 0x000000, 6000);       // 2500 ms after the change: halfway to the new one
  eq(c[0] * 255, 0x3F / 2, 'half way r', 1e-3); eq(c[1] * 255, 0x76 / 2, 'half way g', 1e-3);
  c = Sky.waterFogColor(st, 0x000000, 20000); eq(c[2], 0, 'settled', 1e-6);
  Sky.waterFogLeave(st); c = Sky.waterFogColor(st, 0x112233, 30000); eq(c[0] * 255, 0x11, 'reset after leaving', 1e-4);
  // tail: visibility 1 rescales the brightest channel to 1; darkness 0.5 tints (0.85, 0.8, 0.8)
  c = Sky.waterFogFinish([0.2, 0.1, 0.4], 0, 1); eq(c[2], 1, 'rescale max channel', 1e-6); eq(c[0], 0.5, 'rescale r', 1e-6);
  c = Sky.waterFogFinish([0.5, 0.5, 0.5], 0.5, 0); eq(c[0], 0.425, 'dark r', 1e-6); eq(c[1], 0.4, 'dark g', 1e-6);
};
run(0);
const real = Sky.underwaterVisibility;
trial('visibility off by 0.1', () => { Sky.underwaterVisibility = (t, s) => real(t, s) + 0.1; run(0); Sky.underwaterVisibility = real; });
const realR = Sky.waterFogRange;
trial('swamp factor dropped', () => { Sky.waterFogRange = (v, s, d) => realR(v, false, d); run(0); Sky.waterFogRange = realR; });
const realC = Sky.waterFogColor;
trial('no ease', () => { Sky.waterFogColor = (st, b, t) => { st.t = -1; return realC(st, b, t); }; run(0); Sky.waterFogColor = realC; });
const realF = Sky.waterFogFinish;
trial('no darkness tint', () => { Sky.waterFogFinish = (c, d, v) => realF(c, 0, v); run(0); Sky.waterFogFinish = realF; });
console.log(`waterfogcheck: ${n} assertions, ${breaks} breaks caught`);
if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
