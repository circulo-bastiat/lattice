#!/usr/bin/env node
// slimeblockcheck.mjs — #5679: SlimeBlock.onEntityLand (non-living rebound 0.8x) and onSteppedOn
// (x/z * (0.4+|vy|*0.2) when |vy|<0.1 and not sneaking), against .decomp SlimeBlock.java.
import { loadEngine } from './loadsrc.mjs';
const M = loadEngine({ extra: ['07_world.js', '14b_physics.js'] });
const Ph = M.Physics, W = M.World, CH = M.CH;
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const near = (a, b) => Math.abs(a - b) < 1e-6;
W.init(1);
for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) W.setBlock(x, 8, z, M.States.stateOf('slime_block'));
const ent = (o) => Object.assign({ x: 0.5, y: 9, z: 0.5, width: 0.25, height: 0.25, vx: 0, vy: 0, vz: 0, onGround: false }, o);
const rebound = (o, vy) => { const e = ent(Object.assign({ y: 9.2, fallDistance: 1 }, o)); e.vy = vy; Ph.move(e, 0, -0.3, 0); Ph.move(e, 0, 0, 0); return e.vy; };
// 1. rebound
const item = rebound({ living: false }, -0.5), zomb = rebound({ maxHealth: 20, width: 0.6, height: 1.8 }, -0.5);
ok(near(item, 0.4), 'item rebounds at 0.4, got ' + item);
ok(near(zomb, 0.5), 'zombie rebounds at 0.5, got ' + zomb);
const av = (c, m) => { breaks++; ok(c, m); console.log('   ✓ ' + m); };
av(!near(item, 0.5), 'item not 1.0x'); av(!near(zomb, 0.4), 'zombie not 0.8x');
// 2. step-on slowdown
const walk = (sneak) => { const e = ent({ maxHealth: 20, width: 0.6, height: 1.8, y: 9, vx: 0.2, vy: -0.0784, onGround: true, edgeGuard: sneak }); Ph.move(e, 0, -0.0784, 0); return e.vx; };
const w = walk(false), s = walk(true);
ok(near(w, 0.2 * (0.4 + 0.0784 * 0.2)), 'walking vx scaled, got ' + w);
ok(near(s, 0.2), 'sneaking vx untouched, got ' + s);
av(w < 0.2, 'slowdown present'); av(s === 0.2, 'sneak differs');
if (fails.length) { console.log('FAIL\n' + fails.join('\n')); process.exit(1); }
console.log(`slimeblockcheck: ${pass} checks passed, 0 failed`);
console.log(`${breaks} breaks caught`);
