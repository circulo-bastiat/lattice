#!/usr/bin/env node
// vbcelebratecheck.mjs — #4410: CelebrateRaidWinTask (.decomp CelebrateRaidWinTask.java:26-60) via VB.celebrateRaidWin.
// Raid VICTORY + sky visible -> 1/100 entity.villager.celebrate sound, 1/200 firework (flight 0-2).
import { loadEngine } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const M = loadEngine({ extra: ['07_world.js', '07s_raid.js', '07zv_villagerbrain.js'], dom: false });
const VB = M.VB, Rd = M.Raid, RM = M.RaidManager;
const sounds = [];
M.Sound = { play: (ev) => sounds.push(ev) };
let sky = true;
M.World.canSeeSky = () => sky;
const raid = { status: Rd.Status.VICTORY, center: { x: 0, y: 64, z: 0 } };
RM.world = { raids: { 1: raid }, nextId: 2 };
const v = { type: 'villager', x: 1.5, y: 64, z: 1.5 };
function run(n, rolls) {
  let i = 0; VB.rand = () => rolls[i++ % rolls.length]; sounds.length = 0; VB.fireworks = 0;
  for (let k = 0; k < n; k++) VB.celebrateRaidWin(v);
}
// rolls: sound roll, (pitch x2), firework roll, color, flight.  0 -> hits; 0.5 -> misses
run(1, [0, 0.5, 0.5, 0, 0.99, 0.99]);
ok(sounds[0] === 'entity.villager.celebrate', 'sound on nextInt(100)==0');
ok(VB.fireworks === 1 && VB.lastFirework.color === 15 && VB.lastFirework.flight === 2, 'firework on nextInt(200)==0, colour/flight picked');
run(1, [0.5]); ok(!sounds.length && !VB.fireworks, 'no sound/firework on a miss roll');
const hit = [0, 0.5, 0.5, 0, 0, 0];
raid.status = Rd.Status.ONGOING; run(1, hit); ok(!sounds.length && !VB.fireworks, 'ongoing raid: silent'); breaks++;
raid.status = Rd.Status.LOSS; run(1, hit); ok(!sounds.length && !VB.fireworks, 'lost raid: silent'); breaks++;
raid.status = Rd.Status.VICTORY; sky = false; run(1, hit); ok(!sounds.length && !VB.fireworks, 'no sky: silent'); breaks++;
sky = true; RM.world.raids = {}; run(1, hit); ok(!sounds.length && !VB.fireworks, 'no raid: silent'); breaks++;
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `${pass} ok, ${breaks} anti-vacuity breaks caught, ${breaks} breaks caught, 0 failed`);
process.exit(fails.length ? 1 : 0);
