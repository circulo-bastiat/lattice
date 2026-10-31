#!/usr/bin/env node
// lavadisplaytickcheck.mjs — #263: LavaFluid.randomDisplayTick (.decomp LavaFluid.java:46-72): with air above, 1/100 a
// LAVA ember + block.lava.pop, 1/200 block.lava.ambient. Breaks its own gates and prints "<n> breaks caught".
import { loadEngine } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); };
const M = loadEngine({ extra: ['02f_tags.js', '07_world.js', '07b_behaviour.js', '07zx_particle.js'], dom: false });
const W = M.World, SR = M.States, B = M.Behave;
W.init(1); B.init(W);
const snd = [], parts = [];
M.Sound = { entitySound: (e, x, y, z, v, p) => snd.push({ e, v, p }) };
M.Particle = Object.assign(M.Particle || {}, { spawn: (n, x, y, z) => parts.push({ n, x, y, z }) });
const lava = SR.stateOf('lava'), stone = SR.stateOf('stone'), water = SR.stateOf('water');
const world = (map) => { W.getBlock = (x, y, z) => map[x + ',' + y + ',' + z] || 0; W.get = W.getBlock; };
const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };
const tick = (st, r) => { snd.length = 0; parts.length = 0; return B.lavaDisplayTick(st, 5, 5, 5, r); };

world({});
ok(tick(lava, () => 0) === 1 && parts.length === 1 && parts[0].n === 'lava' && parts[0].y === 6, 'roll 0: one lava ember on the surface');
ok(snd.length === 2 && snd[0].e === 'block.lava.pop' && Math.abs(snd[0].v - 0.2) < 1e-9 && Math.abs(snd[0].p - 0.9) < 1e-9, 'pop vol 0.2 pitch 0.9');
ok(snd[1].e === 'block.lava.ambient', 'roll 0 also hits the 1/200 ambient');
ok(tick(lava, () => 0.5) === 0 && snd.length === 0, 'roll 0.5: nothing');
tick(lava, seq(0.5, 0.0, 0.5, 0.5));            // 1/100 misses (50), ambient nextInt(200)=0 on the 2nd int roll
ok(snd.length === 1 && snd[0].e === 'block.lava.ambient', 'ambient fires alone');
ok(B.lavaDisplayTick(stone, 5, 5, 5, () => 0) === 0 && B.lavaDisplayTick(water, 5, 5, 5, () => 0) === 0, 'non-lava ignored');
world({ '5,6,5': stone });
ok(tick(lava, () => 0) === 0 && snd.length === 0, 'covered lava is silent');

world({});
okAv(tick(lava, () => 0.5) === 0, 'roll 0.5 makes no ember (gate is live)');
world({ '5,6,5': stone });
okAv(tick(lava, () => 0) === 0, 'a block above silences it (gate is live)');
okAv(B.lavaDisplayTick(water, 5, 5, 5, () => 0) === 0, 'water does not ember (gate is live)');
console.log(fails.length ? fails.join('\n') : '');
console.log(`${pass + breaks} assertions, ${fails.length} failures, ${breaks} breaks caught`);
console.log(`${breaks} breaks caught (of ${breaks})`);
process.exit(fails.length ? 1 : 0);
