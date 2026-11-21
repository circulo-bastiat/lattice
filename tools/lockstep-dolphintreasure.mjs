#!/usr/bin/env node
// lockstep-dolphintreasure -- #6888 (G17-L171): dolphin out of water for 400 ticks, 20 salts, per-tick compare.
// Reference = DolphinEntity.tick (.decomp): wet -> moistness 2400; else -1, <= 0 -> damage(DRYOUT, 1.0), and onGround -> velocity += (r*2-1)*0.2, 0.5, (r*2-1)*0.2,
// yaw = r*360 (engine keeps radians: r*2pi), onGround=false. One scripted stream, draw-for-draw. Swim-to-treasure/play-with-items goals are owed (need a pool world).
import { loadEngine } from './loadsrc.mjs';
const M = loadEngine({ extra: ['07zz2_dolphin.js'] });
const Dol = M.Dolphin, TICKS = 400;
const hurts = [];
M.Combat = { hurt: (e, amt, a, b, o) => hurts.push([e.t, amt, o.source]) };
M.SnowGolem = { isWet: (e) => !!e.inWater };
const stream = (salt) => { const j = new M.JRandom(salt * 7919 + 17); return () => j.nextDouble(); };
function engine(salt) {
  const r = stream(salt), e = { moistness: 150, vx: 0, vy: 0, vz: 0, onGround: true, yaw: 0, inWater: false }, out = [];
  hurts.length = 0;
  for (let t = 0; t < TICKS; t++) {
    e.t = t; e.inWater = (t >= 200 && t < 205);
    if (t % 7 === 0) e.onGround = true;
    Dol.tickMoist(e, r);
    out.push(JSON.stringify([e.moistness, e.vx, e.vy, e.vz, e.yaw, e.onGround, hurts.length]));
  }
  return out;
}
function reference(salt) {
  const r = stream(salt), e = { m: 150, vx: 0, vy: 0, vz: 0, g: true, yaw: 0 }, out = []; let h = 0;
  for (let t = 0; t < TICKS; t++) {
    const wet = (t >= 200 && t < 205);
    if (t % 7 === 0) e.g = true;
    if (wet) e.m = 2400;
    else {
      e.m -= 1; if (e.m <= 0) h++;
      if (e.g) { e.vx += (r() * 2 - 1) * 0.2; e.vy += 0.5; e.vz += (r() * 2 - 1) * 0.2; e.yaw = r() * Math.PI * 2; e.g = false; }
    }
    out.push(JSON.stringify([e.m, e.vx, e.vy, e.vz, e.yaw, e.g, h]));
  }
  return out;
}
function run(dry) {
  for (let s = 0; s < 20; s++) {
    const a = engine(s, dry), b = reference(s);
    for (let t = 0; t < TICKS; t++) if (a[t] !== b[t]) return `salt ${s} tick ${t}: engine ${a[t]} != ref ${b[t]}`;
  }
  return null;
}
const old = Dol.tickMoist;
let fails = 0, breaks = 0;
const base = run();
if (base) { fails++; console.log('  FAIL ' + base); }
const mut = (name, fn) => { const old = Dol.tickMoist; Dol.tickMoist = fn; const r = run(); Dol.tickMoist = old;
  if (r) { breaks++; console.log('   ✓ break caught: ' + name); } else { fails++; console.log('  ✗ break NOT caught: ' + name); } };
mut('moistness -2 per tick', (e, r) => { const w = e.inWater; if (!w) e.moistness -= 1; old(e, r); });
mut('no hop velocity', (e, r) => { const g = e.onGround; old(e, r); if (g) e.vy -= 0.5; });
mut('no dryout hurt', (e, r) => { const h = M.Combat.hurt; M.Combat.hurt = () => {}; old(e, r); M.Combat.hurt = h; });
console.log(`lockstep-dolphintreasure: ${20 * TICKS + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
