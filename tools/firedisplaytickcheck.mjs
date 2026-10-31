#!/usr/bin/env node
// firedisplaytickcheck.mjs — #1893 FIRE-1: AbstractFireBlock.randomDisplayTick (.decomp AbstractFireBlock.java:47-107):
// 1/24 crackle block.fire.ambient (vol 1+r, pitch r*0.7+0.3), LARGE_SMOKE 2 per flammable side / 3 over a bare floor.
// Breaks its own gates and prints "<n> breaks caught".
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
const fire = SR.stateOf('fire'), stone = SR.stateOf('stone'), planks = SR.stateOf('oak_planks');
const world = (map) => { W.getBlock = (x, y, z) => map[x + ',' + y + ',' + z] || 0; W.get = W.getBlock; };
const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };
const tick = (r) => { snd.length = 0; parts.length = 0; return B.fireDisplayTick(fire, 5, 5, 5, r); };

world({ '5,4,5': stone });
ok(tick(() => 0.5) === 3 && parts.length === 3 && parts.every(p => p.n === 'large_smoke'), 'sturdy floor: 3 large_smoke');
ok(parts.every(p => p.y >= 5.5 && p.y <= 6), 'floor smoke at y+0.5..1');
ok(snd.length === 0, 'rand 0.5 -> nextInt(24)=12 no crackle');
tick(() => 0);
ok(snd.length === 1 && snd[0].e === 'block.fire.ambient' && snd[0].v === 1 && Math.abs(snd[0].p - 0.3) < 1e-9, 'roll 0 -> crackle vol 1 pitch 0.3');
world({ '5,5,5': 0, '4,5,5': planks });
ok(tick(() => 0.5) === 2, 'no floor, flammable west: 2 smoke');
ok(parts.every(p => p.x < 5.1), 'west smoke hugs the west face');
world({ '4,5,5': planks, '5,6,5': planks, '5,5,6': planks });
ok(tick(() => 0.5) === 6, 'three flammable faces: 6 smoke');
world({});
ok(tick(() => 0.5) === 0, 'nothing flammable, bare air floor: none');
ok(B.fireDisplayTick(stone, 5, 5, 5, () => 0) === 0, 'non-fire block ignored');

// anti-vacuity
world({ '5,4,5': stone });
const o = B.fireDisplayTick;
B.fireDisplayTick = (s, x, y, z, r) => o(s, x, y, z, () => 0.5);
tick(() => 0); okAv(snd.length === 0, 'forcing the roll to 0.5 silences the crackle (gate is live)');
B.fireDisplayTick = o;
world({ '5,4,5': 0 });
okAv(tick(() => 0.5) === 0, 'removing the floor removes the floor smoke (gate is live)');
world({ '4,5,5': stone });
okAv(tick(() => 0.5) === 0, 'a non-flammable side makes no smoke (gate is live)');
console.log(fails.length ? fails.join('\n') : '');
console.log(`${pass + breaks} assertions, ${fails.length} failures, ${breaks} breaks caught`);
console.log(`${breaks} breaks caught (of ${breaks})`);
process.exit(fails.length ? 1 : 0);
