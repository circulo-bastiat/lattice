#!/usr/bin/env node
// conduitbecheck.mjs — #5541: ConduitBlockEntity state (isActive from the frame, ticks, ticksActive, eyeOpen).
// Mutates the frame / water and proves the answer flips (anti-vacuity).
import { loadEngine } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
const MCL = loadEngine({ extra: ['02f_tags.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js'], dom: false });
const S = MCL.States, R = MCL.Reg, W = MCL.World, BE = MCL.BlockEntities;
BE.init(); W.init(1); MCL.Behave.init(W);
for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) { const c = W.makeChunk(cx, cz); c.state = MCL.CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
const st = (n) => S.stateOf(n) | 0;
const water = st('water'), pr = st('prismarine'), conduit = st('conduit');
const C = [8, 64, 8];
for (let x = -2; x <= 2; x++) for (let y = -2; y <= 2; y++) for (let z = -2; z <= 2; z++) W.setBlock(C[0] + x, C[1] + y, C[2] + z, water);
const ring = [];
for (let x = -2; x <= 2; x++) for (let y = -2; y <= 2; y++) for (let z = -2; z <= 2; z++) {
  const a = [x, y, z].map(Math.abs);
  if ((a[0] > 1 || a[1] > 1 || a[2] > 1) && ((x === 0 && (a[1] === 2 || a[2] === 2)) || (y === 0 && (a[0] === 2 || a[2] === 2)) || (z === 0 && (a[0] === 2 || a[1] === 2)))) ring.push([x, y, z]);
}
ok(ring.length === 42, 'frame ring has 42 cells, got ' + ring.length);
W.setBlock(...C, conduit);
const e = BE.create(...C, 'conduit');
ok(e && e.type === 'conduit' && e.ticks === 0 && e.active === false, 'fresh conduit state');
for (const [x, y, z] of ring.slice(0, 15)) W.setBlock(C[0] + x, C[1] + y, C[2] + z, pr);
ok(BE.conduitScan(e) === false && e.frame.length === 15, '15 frame blocks: inactive');
W.setBlock(C[0] + ring[15][0], C[1] + ring[15][1], C[2] + ring[15][2], pr);
okAv(BE.conduitScan(e) === true && e.frame.length === 16, '16 frame blocks: active');
MCL.Behave.gameTime = 0; BE.tickConduit(e);
ok(e.active && e.ticks === 1 && e.ticksActive === 1 && !e.eyeOpen, 'tick at gameTime%40==0 activates, eye closed <42');
MCL.Behave.gameTime = 1; BE.tickConduit(e);
ok(e.ticks === 2 && e.ticksActive === 2, 'ticks count');
W.setBlock(C[0] + 1, C[1], C[2], 0);
MCL.Behave.gameTime = 1; BE.tickConduit(e);
ok(e.active, 'no rescan off the 40-tick cadence');
MCL.Behave.gameTime = 40; BE.tickConduit(e);
okAv(!e.active && e.ticksActive === 3, 'air in the 3x3x3 deactivates on rescan');
ok(Math.abs(BE.conduitRotation(e, 0.5) - 3.5 * -0.0375) < 1e-6, 'rotation');
console.log(`${pass} passed, ${fails.length} failed (of which ${breaks} are anti-vacuity checks)`);
console.log(` assertions passed .. ${pass}`);
console.log(` breaks caught ...... ${breaks}`);
for (const f of fails) console.log('FAIL ' + f);
process.exit(fails.length ? 1 : 0);
