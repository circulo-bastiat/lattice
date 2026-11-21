import { loadEngine } from './loadsrc.mjs';
// #4266: wither skull in water drags at 0.8 (charged or not), in air 0.95 / 0.73.
const MCL = loadEngine({ extra: ['07zzh_blaze.js', '07zzm_wither.js'], dom: false });
const Wi = MCL.Wither;
let bad = 0, breaks = 0;
const run = (charged, wet) => {
  const e = { type: 'wither_skull', charged, inWater: wet, vx: 0, vy: 0, vz: 0, powerX: 0.1, powerY: 0, powerZ: 0, x: 0, y: 200, z: 0 };
  try { Wi.tickSkull(e); } catch (x) { return NaN; }
  return e.vx;
};
const want = (c, w) => 0.1 * (w ? 0.8 : (c ? 0.73 : 0.95));
for (const c of [false, true]) for (const w of [false, true]) {
  const got = run(c, w);
  if (Math.abs(got - want(c, w)) > 1e-9) { bad++; console.log('FAIL charged=' + c + ' wet=' + w + ' vx=' + got); }
  breaks++; if (!(Math.abs(got - want(c, !w)) > 1e-9)) bad++; // anti-vacuity: wrong drag is distinguishable
}
console.log((4 + breaks) + ' assertions, ' + bad + ' failures, ' + breaks + ' breaks caught');
process.exit(bad ? 1 : 0);
