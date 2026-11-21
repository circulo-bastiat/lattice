#!/usr/bin/env node
// bedbouncecheck.mjs -- #5678: BedBlock.fallOn halves the fall distance, bounceUp returns -vy*0.66
// (x0.8 non-living), a sneaking entity does not bounce. All 16 colours, through the real Ph.landed.
import { loadEngine } from './loadsrc.mjs';
const MCL = loadEngine({ extra: ['07_world.js', '07b_behaviour.js', '14b_physics.js'], dom: false });
const Ph = MCL.Physics, W = MCL.World, R = MCL.Reg;
W.init(1);
MCL.Reg.init && 0;
const CH = MCL.CH;
for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const COLS = ['white','orange','magenta','light_blue','yellow','lime','pink','gray','light_gray','cyan','purple','blue','brown','green','red','black'];
const stateOf = (n) => MCL.States.stateOf(n) | 0;
const place = (n) => W.setBlock(0, 63, 0, stateOf(n));
const land = (name, o) => {
  place(name);
  const e = Object.assign({ x: 0.5, y: 63.5625, z: 0.5, living: true, type: 'zombie' }, o);
  Ph.landed(e, 10, -1.0); return e;
};
const run = (tag) => {
  const res = [];
  for (const c of COLS) {
    const n = c + '_bed';
    const z = land(n, {}), it = land(n, { living: false, type: 'item' }), sn = land(n, { edgeGuard: true });
    res.push([n, z, it, sn]);
  }
  return res;
};
for (const [n, z, it, sn] of run()) {
  ok(z.landedOn === n, n + ': landed on ' + z.landedOn);
  ok(z.pendingFallDamage === 2, n + ': damage ' + z.pendingFallDamage + ' != 2');
  ok(Math.abs(z.bounceVy - 0.66) < 1e-9, n + ': bounce ' + z.bounceVy);
  ok(Math.abs(it.bounceVy - 0.528) < 1e-9, n + ': item bounce ' + it.bounceVy);
  ok(!sn.bounceVy, n + ': sneaking bounced');
}
// anti-vacuity: a non-bed block (stone) must read full damage and no bounce
{ const s = stateOf('stone'); W.setBlock(0, 63, 0, s);
  const e = { x: 0.5, y: 64, z: 0.5, living: true, type: 'zombie' }; Ph.landed(e, 10, -1);
  breaks++; if (e.pendingFallDamage === 7 && !e.bounceVy) console.log('   ✓ stone reads full damage, no bounce'); ok(e.pendingFallDamage === 7 && !e.bounceVy, 'anti-vacuity: stone reads ' + e.pendingFallDamage + ' / ' + e.bounceVy); }
console.log(`bedbouncecheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log(' FAIL ' + f);
process.exit(fails.length ? 1 : 0);
