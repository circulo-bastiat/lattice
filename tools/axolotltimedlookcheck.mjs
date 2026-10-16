#!/usr/bin/env node
// axolotltimedlookcheck.mjs — #5736: TimeLimitedTask(FollowMobTask(PLAYER,6), 30..60) window + getTargetApproachingSpeed.
import { loadEngine } from './loadsrc.mjs';
const MCL = loadEngine({ extra: ['07k_goals.js', '07zm_axolotl.js'], dom: false });
const Ax = MCL.Axolotl;
let fails = 0, breaks = 0, pass = 0;
const ok = (c, m) => { if (c) pass++; else { fails++; console.log(' x ' + m); } };
function run(window, seed) {
  let s = seed; const rand = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const inner = { canUse: () => true, canContinueToUse: () => true, tick() {} };
  const g = new Ax.TimedLookGoal({}, inner, rand, window);
  const wins = [], quiets = [];
  for (let i = 0; i < 40; i++) {
    g.start(); wins.push(g.lastWindow);
    let n = 0; while (g.canContinueToUse()) { g.tick(); n++; }
    ok(n === g.lastWindow, 'ran exactly the drawn window');
    g.stop(); quiets.push(g.lastQuiet);
    let q = 0; while (!g.canUse()) q++;
    ok(q === g.lastQuiet, 'cooldown equals drawn quiet');
  }
  return { wins, quiets };
}
const inRange = (r) => r.wins.every(w => w >= 30 && w <= 60) && r.quiets.every(w => w >= 30 && w <= 60) && new Set(r.wins).size > 5;
ok(inRange(run(null, 7)), 'windows drawn in [30,60] and varied');
breaks++; ok(!inRange(run([100, 100], 7)), 'anti-vacuity: fixed window 100 fails'); console.log(' ✓ fixed window 100 rejected');
ok(Ax.approachSpeed({ inWater: true }) === 0.6 && Ax.approachSpeed({ inWater: false }) === 0.15, 'approach speed 0.6 water / 0.15 land (jar)');
breaks++; ok(Ax.approachSpeed({ inWater: true }) !== 0.15, 'anti-vacuity: wrong speed rejected'); console.log(' ✓ wrong speed rejected');
console.log(` assertions passed .. ${pass}\n failures ........... ${fails}\n ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
