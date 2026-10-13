#!/usr/bin/env node
// wolfshakecheck.mjs - #909: WolfEntity wet-fur shake (WolfEntity.java tick/tickMovement). A wolf leaving water shakes:
// shakeProgress += 0.05 for ~40 ticks, entity.wolf.shake at volume 0.4 once, splash particles, ends at last>=2.0.
// ANTI-VACUITY: breaks its own step, sound, particles and wet-latch and must fail ("<n> breaks caught").
import { loadEngine, initRegistry } from './loadsrc.mjs';

function scenario(brk) {
  const M = loadEngine({ extra: ['07zx_particle.js', '07zq2_wolfshake.js'], dom: false });
  initRegistry(M);
  const WS = M.WolfShake, calls = [], parts = [];
  M.Sound = { play: (ev, o) => { calls.push({ ev, o }); return true; } };
  M.Particle.spawn = (t, x, y, z) => { parts.push(t); return {}; };
  if (brk === 'step') WS.SPEED = 0.5;
  if (brk === 'silent') M.Sound = { play: () => true };
  if (brk === 'noparts') M.Particle.spawn = () => null;
  const out = [], say = (c, m) => { if (!c) out.push(m); };
  const w = { type: 'wolf', x: 0, y: 64, z: 0, width: 0.6, onGround: true, inWater: true, navigating: false };
  WS.tick(w); say(w.furWet === true, 'wet wolf gets furWet');
  if (brk === 'nolatch') w.furWet = false;
  w.inWater = false;
  let ticks = 0, prev = 0, mono = true;
  while (ticks < 100) {
    WS.tick(w); ticks++;
    if (w.canShakeWaterOff) { if (w.shakeProgress < prev) mono = false; prev = w.shakeProgress; }
    else if (ticks > 1) break;
  }
  say(mono, 'shakeProgress monotonic');
  say(ticks >= 40 && ticks <= 45, `shake lasted ${ticks} ticks (want ~42)`);
  const s = calls.filter((c) => c.ev === 'entity.wolf.shake');
  say(s.length === 1 && Math.abs(s[0].o.volume - 0.4) < 1e-9, `shake sound x${s.length}`);
  say(parts.length > 0 && parts.every((t) => t === 'splash'), `splash particles ${parts.length}`);
  say(w.furWet === false && w.shakeProgress === 0, 'fur dry and reset after shake');
  // re-entering water mid-shake cancels it (status 56)
  const v = { type: 'wolf', x: 0, y: 64, z: 0, width: 0.6, onGround: true, inWater: true };
  WS.tick(v); v.inWater = false; WS.tick(v); WS.tick(v);
  v.inWater = true; WS.tick(v);
  say(v.canShakeWaterOff === false && v.shakeProgress === 0, 'water mid-shake cancels');
  say(Math.abs(WS.shakeAnimation({ lastShakeProgress: 0, shakeProgress: 0 }, 0, 0)) < 1e-9, 'shakeAnimation 0 at rest');
  return out;
}
const fails = scenario(null);
let caught = 0;
const B = ['step', 'silent', 'noparts', 'nolatch'];
for (const b of B) {
  if (scenario(b).length) { caught++; console.log(`  ✓ break caught: ${b}`); } else fails.push(`break NOT caught: ${b}`);
}
for (const f of fails) console.log('  ✗ ' + f);
console.log(`wolfshakecheck: ${fails.length ? 'FAIL' : 'PASS'}`);
console.log(`wolfshakecheck: ${caught} breaks caught (of ${B.length})`);
process.exit(fails.length ? 1 : 0);
