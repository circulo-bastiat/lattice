#!/usr/bin/env node
// inwalloverlaycheck.mjs — #7876 G17-O2. Physics.inWallState vs InGameOverlayRenderer.getInWallBlockState:
// 8 sample points round the eye, first suffocating (full cube, not glass/leaves) state wins; fluids pick nothing.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js', '07_world.js', '14b_physics.js'] });
const Ph = M.Physics, W = M.World, CH = M.CH, st = (n) => M.States.stateOf(n) | 0;
W.init(1);
for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
const P = { x: 0, y: 10, z: 0, width: 0.6, height: 1.8 }; P.y = 12 - P.height * Ph.EYE_FRACTION;
const ey = P.y + P.height * Ph.EYE_FRACTION, EY = Math.floor(ey);
const clear = () => { for (let x = -2; x <= 2; x++) for (let y = EY - 2; y <= EY + 2; y++) for (let z = -2; z <= 2; z++) W.setBlock(x, y, z, 0); };
const STONE = st('stone'), SAND = st('sand'), GLASS = st('glass'), LEAVES = st('oak_leaves'), WATER = st('water'), LAVA = st('lava');
const pick = () => { const r = Ph.inWallState(P); return r && r.state; };
clear();
ok(pick() === null, 'open air picks nothing');
W.setBlock(-1, EY - 1, -1, STONE); ok(pick() === STONE, 'stone at the eye cell picks stone');
W.setBlock(-1, EY - 1, -1, SAND); ok(pick() === SAND, 'sand picks sand');
for (const [n, id] of [['glass', GLASS], ['leaves', LEAVES], ['water', WATER], ['lava', LAVA]]) { W.setBlock(-1, EY - 1, -1, id); ok(pick() === null, n + ' picks nothing'); }
W.setBlock(-1, EY - 1, -1, 0);
// each of the 8 sample points: the sample's own cell holds a distinct block, then only it is solid
const samples = Ph.inWallSamples(P);
ok(samples.length === 8, '8 sample points');
const cells = new Set();
samples.forEach((s, i) => {
  const c = [Math.floor(s[0]), Math.floor(s[1]), Math.floor(s[2])];
  
  clear(); W.setBlock(c[0], c[1], c[2], STONE);
  ok(pick() === STONE, 'sample ' + i + ' cell ' + c + ' picks stone'); cells.add(c.join());
});
ok(cells.size === 8, 'some sample points leave the eye cell');
// order: first sample wins
clear(); const s0 = samples[0], s7 = samples[7];
W.setBlock(Math.floor(s0[0]), Math.floor(s0[1]), Math.floor(s0[2]), SAND);
W.setBlock(Math.floor(s7[0]), Math.floor(s7[1]), Math.floor(s7[2]), STONE);
ok(pick() === SAND, 'lowest-index sample wins');
// noclip draws nothing
clear(); W.setBlock(-1, EY - 1, -1, STONE); P.noclip = true; ok(pick() === null, 'noclip picks nothing'); P.noclip = false;
// anti-vacuity: swapped offsets (vertical 0.1 -> 1.0) must change the answer for a block just above the eye
const orig = Ph.inWallSamples;
clear(); W.setBlock(0, EY + 1, 0, STONE);
ok(pick() === null, 'block one above the eye is outside the 0.1 band');
Ph.inWallSamples = (e) => orig(e).map(s => [s[0], s[1] + (s[1] > ey ? 1.0 : 0), s[2]]);
breaks++; if (pick() === STONE) pass++; else fails.push('anti-vacuity: swapped offsets did not change the pick');
Ph.inWallSamples = (e) => orig(e).map(s => [s[0] + 3, s[1], s[2]]);
clear(); W.setBlock(-1, EY - 1, -1, STONE);
breaks++; if (pick() === null) pass++; else fails.push('anti-vacuity: shifted samples still picked');
Ph.inWallSamples = orig;
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `inwalloverlaycheck OK — ${pass} cases; ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
