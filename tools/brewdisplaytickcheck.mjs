#!/usr/bin/env node
// brewdisplaytickcheck.mjs — #10809: BrewingStandBlock.randomDisplayTick (.decomp BrewingStandBlock.java:93-98):
// one SMOKE at (x+0.4+f*0.2, y+0.7+f*0.3, z+0.4+f*0.2), velocity 0. Breaks its own offsets/type, prints "<n> breaks caught".
import { loadEngine } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); };
const M = loadEngine({ extra: ['02f_tags.js', '07_world.js', '07b_behaviour.js', '07zx_particle.js'], dom: false });
const W = M.World, SR = M.States, B = M.Behave;
W.init(1); B.init(W);
const parts = [];
M.Particle = Object.assign(M.Particle || {}, { spawn: (n, x, y, z, vx, vy, vz) => parts.push({ n, x, y, z, vx, vy, vz }) });
const stand = SR.stateOf('brewing_stand'), stone = SR.stateOf('stone');
const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };
const near = (a, b) => Math.abs(a - b) < 1e-9;
const run = (st, r) => { parts.length = 0; return B.brewingDisplayTick(st, 10, 20, 30, r); };

let n = run(stand, seq(0.25, 0.5, 0.75));
const p = parts[0];
ok(n === 1 && parts.length === 1, 'one particle per tick');
ok(p.n === 'smoke', 'type is smoke');
ok(near(p.x, 10 + 0.4 + 0.25 * 0.2) && near(p.y, 20 + 0.7 + 0.5 * 0.3) && near(p.z, 30 + 0.4 + 0.75 * 0.2), 'positions follow decomp order x,y,z');
ok(p.vx === 0 && p.vy === 0 && p.vz === 0, 'zero velocity');
ok(run(stone, () => 0) === 0 && parts.length === 0, 'non-stand emits none');
// rate: the sampler (Lgt.doRandomBlockDisplayTicks) calls once per sampled stand
run(stand, () => 0); ok(near(parts[0].x, 10.4) && near(parts[0].y, 20.7), 'roll 0 -> lower corner');
run(stand, () => 0.999); ok(parts[0].y < 21 && parts[0].x < 10.6, 'roll ~1 stays inside the stand');

run(stand, seq(0.25, 0.5, 0.75));
okAv(!near(parts[0].y, 20.7 + 0.25 * 0.3), 'swapped y roll would be caught');
okAv(parts[0].n !== 'large_smoke', 'wrong type would be caught');
okAv(!near(parts[0].x, 10 + 0.5 + 0.25 * 0.2), 'wrong x base would be caught');
okAv(run(stone, () => 0) === 0, 'stone gate is live');
console.log(fails.length ? fails.join('\n') : '');
console.log(`${pass + breaks} assertions, ${fails.length} failures, ${breaks} breaks caught`);
console.log(`${breaks} breaks caught (of ${breaks})`);
process.exit(fails.length ? 1 : 0);
