#!/usr/bin/env node
// vbseekskycheck.mjs — #5622: createRaidTasks' priority-0 RandomTask (VillagerTaskListProvider.java:229):
// SeekSkyAfterRaidWinTask (weight 5) vs RunAroundAfterRaidTask (weight 2), both only after a won raid.
import { loadEngine } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const M = loadEngine({ extra: ['07_world.js', '07s_raid.js', '07zv_villagerbrain.js'], dom: false });
const VB = M.VB, Rd = M.Raid, RM = M.RaidManager;
M.World.canSeeSky = (x, y, z) => x >= 5;           // sky only east of x=5; villager stands under a roof at x=0
M.World.heightAt = () => 60;                        // getTopY = 61 <= y 64
const raid = { status: Rd.Status.VICTORY, center: { x: 0, y: 64, z: 0 } };
RM.world = { raids: { 1: raid }, nextId: 2 };
let seed = 12345; VB.rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000;
function trial(n) {
  const c = { seekSky: 0, runAround: 0, none: 0 };
  for (let i = 0; i < n; i++) {
    const v = { type: 'villager', x: 0.5, y: 64, z: 0.5, vbWalkTarget: null };
    c[VB.raidWonRandomTick(v) || 'none']++;
    if (c.lastTarget === undefined) c.lastTarget = null;
  }
  return c;
}
const N = 7000;
let c = trial(N);
ok(Math.abs(c.seekSky / N - 5 / 7) < 0.03, 'seekSky ~5/7, got ' + c.seekSky / N);
ok(Math.abs(c.runAround / N - 2 / 7) < 0.03, 'runAround ~2/7, got ' + c.runAround / N);
const v = { type: 'villager', x: 0.5, y: 64, z: 0.5, vbWalkTarget: null };
let found = null; for (let i = 0; i < 50 && !found; i++) { VB.seekSkyStart(v); found = v.vbWalkTarget; }
ok(found && found.x >= 5 && found.range === 0, 'seek sky targets a sky-lit cell');
// anti-vacuity: swapped weights break the split
const rt = VB.raidWonRandomTick; breaks++;
{ const sw = { seekSky: 0 }; const orig = Math.pow; let flip = true;
  Math.pow = (a, b) => orig(a, b === 1 / 5 ? 1 / 2 : b === 1 / 2 ? 1 / 5 : b);
  const c2 = trial(N); Math.pow = orig;
  ok(Math.abs(c2.seekSky / N - 5 / 7) >= 0.03, 'swapped weights must fail the split'); }
M.World.canSeeSky = () => false; seed = 7; c = trial(200);
ok(c.seekSky > 0, 'no sky cell found: seekSky still consumed shouldRun');
raid.status = Rd.Status.ONGOING; breaks++; c = trial(50); ok(c.none === 50, 'ongoing raid: nothing runs');
raid.status = Rd.Status.VICTORY; RM.world.raids = {}; breaks++; c = trial(50); ok(c.none === 50, 'no raid: nothing runs');
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `${pass} ok, ${breaks} breaks caught, 0 failed`);
process.exit(fails.length ? 1 : 0);
