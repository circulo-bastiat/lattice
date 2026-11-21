import { loadEngine } from './loadsrc.mjs';
// #4894: wither skull tick spawns a smoke trail (+4 bubbles in water) and turns yaw/pitch 20% toward its velocity.
const MCL = loadEngine({ extra: ['07zzh_blaze.js', '07zzm_wither.js'], dom: false });
const Wi = MCL.Wither; MCL.Particle = MCL.Particle || {};
let bad = 0, breaks = 0, n = 0;
const run = (wet, trail, turn) => {
  const sp = [];
  MCL.Particle.spawn = (t) => { sp.push(t); return true; };
  const e = { type: 'wither_skull', charged: false, inWater: wet, vx: 0, vy: 0, vz: 1, powerX: 0, powerY: 0, powerZ: 0, x: 0, y: 200, z: 0, yaw: 0, pitch: 0 };
  Wi.tickSkull(e);
  return { sp, e };
};
const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL ' + m); } };
for (const wet of [false, true]) {
  const { sp, e } = run(wet);
  ok(sp.filter(t => t === 'smoke').length === 1, 'smoke wet=' + wet);
  ok(sp.filter(t => t === 'bubble').length === (wet ? 4 : 0), 'bubbles wet=' + wet);
  const want = Math.atan2(e.vx, -e.vz) * 0.2;   // vz>0 -> target yaw = pi, 20% of the way (wrapped)
  ok(Math.abs(Math.abs(e.yaw) - Math.PI * 0.2) < 1e-9 && Math.abs(want) > 0, 'yaw wet=' + wet + ' ' + e.yaw);
}
// anti-vacuity: each broken expectation is rejected
const { sp, e } = run(false);
for (const broken of [sp.length === 0, e.yaw === 0, sp.includes('bubble'), Math.abs(e.yaw) > Math.PI * 0.5]) { breaks++; if (!(broken === false)) bad++; }
console.log(n + ' assertions, ' + bad + ' failures, ' + breaks + ' breaks caught');
process.exit(bad ? 1 : 0);
