#!/usr/bin/env node
// axolotlstrollcheck — #4071: Ax.WanderGoal vs AxolotlBrain IDLE priority 4 composite
// (AquaticStrollTask ladder, StrollTask(0.15,false) 10/7, WaitTask(30,60) water / (200,400) ground).
import { loadEngine } from './loadsrc.mjs';
const MCL = loadEngine({ extra: ['02f_tags.js', '07_world.js', '07k_goals.js', '07zm_axolotl.js'], dom: false });
const Ax = MCL.Axolotl, W = MCL.World, S = MCL.States, R = MCL.Reg;
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };

const run = (inWater, fluid, ticks, seed) => {
  let s = seed; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const wb = W.getBlock; W.getBlock = () => (fluid ? 1 : 0);
  const sb = S.block[1]; S.block[1] = R.id.water;
  const e = { x: 0, y: 64, z: 0, inWater, playingDead: false };
  const g = new Ax.WanderGoal(e, { random: rnd });
  const starts = []; let maxH = 0, maxV = 0;
  for (let t = 0; t < ticks; t++) if (g.canUse()) {
    starts.push(t);
  }
  W.getBlock = wb; S.block[1] = sb;
  return starts;
};
const gaps = (a) => a.slice(1).map((v, i) => v - a[i]);
const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
const mm = (a) => [Math.min(...a), Math.max(...a)];
function suite() {
  const gw = gaps(run(true, true, 4000, 7)), gg = gaps(run(false, false, 20000, 9));
  const [wlo, whi] = mm(gw), [glo, ghi] = mm(gg);
  ok(gw.length > 30 && wlo >= Ax.WAIT_WATER[0] && wlo <= Ax.WAIT_WATER[1] + 5 && med(gw) >= 30 && med(gw) <= 80, `water gaps must start at 30 (re-arm 30..60), got ${wlo}..${whi}`);
  ok(gg.length > 20 && glo >= Ax.WAIT_GROUND[0] && med(gg) >= 200 && med(gg) <= 450, `ground gaps must be >=200 (re-arm 200..400), got ${glo}..${ghi}`);
  // targets: land radius 10/7, water ladder reaches beyond 8 horizontally
  const tg = (inWater, fluid, n) => {
    const wb = W.getBlock; W.getBlock = () => (fluid ? 1 : 0); const sb = S.block[1]; S.block[1] = R.id.water;
    let s = 3; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    let mh = 0, mv = 0;
    for (let i = 0; i < n; i++) {
      const e = { x: 0, y: 64, z: 0, inWater, playingDead: false };
      const g = new Ax.WanderGoal(e, { random: rnd });
      if (!g.canUse()) continue;
      let moved = null;
      const o = MCL.Ai; const ss = o.stepToward; o.stepToward = (m, t) => { moved = t; }; const fp = o.findPath; o.findPath = () => null; const fs = o.findSwimPath; o.findSwimPath = () => null;
      g.tick(); o.stepToward = ss; o.findPath = fp; o.findSwimPath = fs;
      if (moved) { mh = Math.max(mh, Math.abs(moved.x), Math.abs(moved.z)); mv = Math.max(mv, Math.abs(moved.y - 64)); }
    }
    W.getBlock = wb; S.block[1] = sb; return [mh, mv];
  };
  const [lh, lv] = tg(false, false, 2000), [ah, av] = tg(true, true, 2000);
  ok(lh <= 10 && lh > 8 && lv <= 7 && lv > 3, `land targets must reach 10/7 and not exceed it, got ${lh}/${lv}`);
  ok(ah >= 9 && ah <= 11 && av > 3, `water ladder must reach the 10/7 rung, got ${ah}/${av}`);
}
suite();
// anti-vacuity: break the data and watch the check fail
const save = [Ax.WAIT_WATER, Ax.WAIT_GROUND, Ax.WANDER_H];
const caught = (f) => { const b = fails.length; f(); const c = fails.length > b; fails.length = b; return c; };
Ax.WAIT_WATER = [1, 5]; Ax.WAIT_GROUND = [1, 5]; okAv(caught(suite), 'wait ranges 1..5 must fail');
Ax.WAIT_WATER = save[0]; Ax.WAIT_GROUND = save[1];
Ax.WANDER_H = 4; okAv(caught(suite), 'land radius 4 must fail'); Ax.WANDER_H = save[2];
Ax.AQUATIC_LADDER = [[1, 1]]; okAv(caught(suite), 'one-rung ladder must fail');
console.log(` assertions passed .. ${pass}\n failures ........... ${fails.length}`);
for (const f of fails) console.log('  FAIL ' + f);
console.log(` ${breaks} breaks caught`);
console.log('==============================================');
process.exit(fails.length ? 1 : 0);
