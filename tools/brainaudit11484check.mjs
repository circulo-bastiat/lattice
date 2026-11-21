#!/usr/bin/env node
// brainaudit11484check.mjs — #11484: the Brain-task classes the audit listed unchecked, driven through the real roster path.
// Vanilla's goat/axolotl Brains are folded onto GoalSelector (07k_goals.js): StayAboveWaterTask -> FloatGoal, WalkTask(2.0) -> PanicGoal,
// BreedTask -> BreedGoal, TemptTask -> TemptGoal, WalkTowardClosestAdultTask -> FollowParentGoal, SeekWaterTask(6, 0.15) -> SeekWaterGoal,
// LookAroundTask(45,90) -> RandomLookAroundGoal, TimeLimitedTask(FollowMobTask(PLAYER, 6.0), 30..60) -> the priority-7 look goal, Memory
// (PLAY_DEAD / BREED_TARGET) gates, BodyControl (BodyRotationControl: 15 deg / 10 ticks / 10-tick ramp, .decomp BodyControl.java).
// Anti-vacuity: each source break must fail its row.
import fs from 'node:fs';
import { loadEngine } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const M = loadEngine({ extra: ['07k_goals.js'], dom: false, ...(patch ? { patch } : {}) });
  const Ai = M.Ai, o = {};
  const ent = (type, x) => ({ type, x: x || 0, y: 64, z: 0, yaw: 0, width: 0.9, height: 1.3 });
  const byPri = (gs, cls) => gs.entries.filter((en) => en.goal instanceof cls).map((en) => en.priority);
  // goat: CORE StayAboveWaterTask, WalkTask(2.0), IDLE BreedTask / TemptTask / WalkTowardClosestAdultTask
  const rnd = () => 0;
  const goat = Ai.ROSTER.goat(ent('goat'), { random: rnd, players: () => [], animals: () => [] });
  o.stayAbove = byPri(goat, Ai.FloatGoal)[0] === 0;
  o.walkTask = byPri(goat, Ai.PanicGoal)[0] === 1;
  o.breedTask = byPri(goat, Ai.BreedGoal)[0] === 3;
  o.temptTask = byPri(goat, Ai.TemptGoal)[0] === 4;
  o.walkAdult = byPri(goat, Ai.FollowParentGoal)[0] === 5;
  // TimeLimitedTask(FollowMobTask(PLAYER,6)): nearest player within 6 only; 30-tick quiet spell, then 30-tick hold, then quiet again
  const pl = { x: 5, y: 64, z: 0, width: 0.6, height: 1.8 };
  let plist = [pl];
  const ge = ent('goat'), g2 = Ai.ROSTER.goat(ge, { random: rnd, players: () => plist, animals: () => [] });
  const look = g2.entries.find((en) => en.priority === 7).goal;
  o.tlQuiet = (() => { let n = 0; while (!look.canUse() && n < 100) n++; return n === 30; })();
  look.start(); let held = 0; while (look.canContinueToUse() && held < 100) { look.tick(); held++; }
  o.tlHold = held === 30;
  look.stop(); o.tlRequiet = (() => { let n = 0; while (!look.canUse() && n < 100) n++; return n === 30; })();
  plist = [{ x: 7, y: 64, z: 0 }]; const l3 = Ai.ROSTER.goat(ent('goat'), { random: rnd, players: () => plist, animals: () => [] }).entries.find((en) => en.priority === 7).goal;
  o.tlRange = (() => { for (let i = 0; i < 80; i++) if (l3.canUse()) return false; return true; })();
  // axolotl IDLE: BreedTask / TemptTask / WalkTowardClosestAdultTask / LookAroundTask, all gated by the PLAY_DEAD Memory
  const ax = ent('axolotl'), ag = Ai.ROSTER.axolotl(ax, { random: rnd, players: () => [], animals: () => [] });
  o.axBreed = byPri(ag, Ai.BreedGoal)[0] === 1;
  o.axTempt = byPri(ag, Ai.TemptGoal)[0] === 2;
  o.axAdult = byPri(ag, Ai.FollowParentGoal)[0] === 2;
  o.axLook = byPri(ag, Ai.RandomLookAroundGoal)[0] === 5;
  const lk = ag.entries.find((en) => en.goal instanceof Ai.RandomLookAroundGoal).goal;
  ax.playingDead = true; o.axPlayDead = lk.canUse() === false && ag.entries.find((en) => en.goal instanceof Ai.BreedGoal).goal.canUse() === false;
  // BodyControl.tick: moving -> body = yaw; head > 15 deg off the stable yaw -> body follows within maxHeadYaw
  const D = Math.PI / 180;
  const mob = () => ({ type: 'cow', x: 0, y: 64, z: 0, xOld: 0, zOld: 0, yaw: 1.0, yHeadRot: 0, yBodyRot: 0 });
  const mv = mob(); mv.xOld = -1; new Ai.BodyRotationControl(mv).tick();
  o.bodyMove = mv.yBodyRot === 1.0;
  const rd = mob(); rd.rider = {}; new Ai.BodyRotationControl(rd).tick(); o.bodyRider = rd.yBodyRot === 1.0 && rd.yHeadRot === 1.0;
  const hd = mob(), bc = new Ai.BodyRotationControl(hd); hd.yaw = 0; hd.yHeadRot = 100 * D; bc.tick();
  o.bodyHead = hd.yBodyRot > 0 && Math.abs(hd.yHeadRot - bc.lastStableHeadYaw) < 1e-9 && bc.headStableTicks === 0;
  const sm = mob(), bs = new Ai.BodyRotationControl(sm); sm.yaw = 0; sm.yHeadRot = 10 * D; bs.tick(); o.bodySmall = sm.yBodyRot === 0 && bs.headStableTicks === 1;
  const st = mob(), bt = new Ai.BodyRotationControl(st); st.yaw = 0; st.yHeadRot = 60 * D; st.yBodyRot = 0; bt.lastStableHeadYaw = 60 * D;
  let k = 0; for (; k < 10; k++) bt.tick(); const pre = st.yBodyRot; bt.tick(); const at11 = bt.headStableTicks;
  o.bodyWait = pre === 0 && at11 === 11;
  const rp = mob(), br = new Ai.BodyRotationControl(rp); rp.yaw = 0; rp.yHeadRot = 60 * D; rp.yBodyRot = 0; br.lastStableHeadYaw = 60 * D;
  for (let i = 0; i < 25; i++) br.tick(); o.bodyRamp = Math.abs(rp.yBodyRot - 60 * D) < 1e-6;
  const pass1 = mob(); pass1.yaw = 0; pass1.yHeadRot = 100 * D; pass1.passenger = {}; const bp = new Ai.BodyRotationControl(pass1); bp.tick(); o.bodyIndep = pass1.yBodyRot === 0;
  return o;
}
const LBL = { stayAbove: 'StayAboveWaterTask -> FloatGoal pri 0', walkTask: 'WalkTask(2.0) -> PanicGoal pri 1', breedTask: 'BreedTask -> BreedGoal', temptTask: 'TemptTask -> TemptGoal', walkAdult: 'WalkTowardClosestAdultTask -> FollowParentGoal',
  tlQuiet: 'TimeLimitedTask 30-tick quiet spell', tlHold: 'TimeLimitedTask 30-tick hold', tlRequiet: 'TimeLimitedTask resetTimeLeft', tlRange: 'FollowMobTask range 6',
  axBreed: 'axolotl BreedTask', axTempt: 'axolotl TemptTask', axAdult: 'axolotl WalkTowardClosestAdultTask', axLook: 'LookAroundTask -> RandomLookAroundGoal', axPlayDead: 'Memory PLAY_DEAD gates IDLE',
  bodyMove: 'BodyControl moving: body = yaw', bodyRider: 'BodyControl ridden', bodyHead: 'BodyControl head > 15 deg', bodySmall: 'BodyControl head within 15 deg', bodyWait: 'BodyControl 10-tick wait', bodyRamp: 'BodyControl ramp to head', bodyIndep: 'BodyControl.isIndependent passenger' };
const A = trial(null);
for (const [k, m] of Object.entries(LBL)) ok(A[k], m);
const BR = [
  ['stayAbove', /gs\.add\(0, Ai\.JUMP, new Ai\.FloatGoal\(e, ctx\.random\)\);\n      gs\.add\(1, Ai\.MOVE, new Ai\.PanicGoal\(e, 2\.0\)\);/, 'gs.add(2, Ai.JUMP, new Ai.FloatGoal(e, ctx.random));\n      gs.add(1, Ai.MOVE, new Ai.PanicGoal(e, 2.0));'],
  ['walkTask', /new Ai\.PanicGoal\(e, 2\.0\)\);   \/\/ CORE WalkTask/, 'new Ai.FloatGoal(e, 2.0));   // CORE WalkTask'],
  ['breedTask', /(Gt\.LongJumpGoal\(e, ctx\)\);\n      )gs\.add\(3, Ai\.MOVE \| Ai\.LOOK, new Ai\.BreedGoal\(e, 1\.0/, '$1gs.add(9, Ai.MOVE | Ai.LOOK, new Ai.BreedGoal(e, 1.0'],
  ['temptTask', /gs\.add\(4, Ai\.MOVE \| Ai\.LOOK, new Ai\.TemptGoal\(e, 1\.25, players, isTempting\)\);\n      gs\.add\(5, Ai\.MOVE, new Ai\.FollowParentGoal\(e, 1\.25, animals\)\);\n      \/\/ #4681/, 'gs.add(9, Ai.MOVE | Ai.LOOK, new Ai.TemptGoal(e, 1.25, players, isTempting));\n      gs.add(5, Ai.MOVE, new Ai.FollowParentGoal(e, 1.25, animals));\n      // #4681'],
  ['walkAdult', /gs\.add\(5, Ai\.MOVE, new Ai\.FollowParentGoal\(e, 1\.25, animals\)\);\n      \/\/ #4681/, '// #4681'],
  ['tlQuiet', /lookT = 0, quiet = 30 \+ Math\.floor\(rnd\(\) \* 31\), lookP/, 'lookT = 0, quiet = 0, lookP'],
  ['tlHold', /start: function \(\) \{ lookT = 30 \+ Math\.floor\(rnd\(\) \* 31\); \}/, 'start: function () { lookT = 60; }'],
  ['tlRequiet', /lookP = null; lookT = 0; quiet = 30 \+ Math\.floor\(rnd\(\) \* 31\);/, 'lookP = null; lookT = 0; quiet = 0;'],
  ['tlRange', /var ps = players\(\), best = 36, f = null;/, 'var ps = players(), best = 400, f = null;'],
  ['axBreed', /gs\.add\(1, Ai\.MOVE \| Ai\.LOOK, idle\(new Ai\.BreedGoal\(e, 0\.2/, 'gs.add(8, Ai.MOVE | Ai.LOOK, idle(new Ai.BreedGoal(e, 0.2'],
  ['axTempt', /gs\.add\(2, Ai\.MOVE \| Ai\.LOOK, idle\(new Ai\.TemptGoal/, 'gs.add(7, Ai.MOVE | Ai.LOOK, idle(new Ai.TemptGoal'],
  ['axAdult', /gs\.add\(2, Ai\.MOVE, idle\(new Ai\.FollowParentGoal/, 'gs.add(7, Ai.MOVE, idle(new Ai.FollowParentGoal'],
  ['axLook', /gs\.add\(5, Ai\.MOVE \| Ai\.LOOK, idle\(new Ai\.RandomLookAroundGoal/, 'gs.add(8, Ai.MOVE | Ai.LOOK, idle(new Ai.RandomLookAroundGoal'],
  ['axPlayDead', /g\.canUse = function \(\) \{ return !e\.playingDead && cu\.apply\(g, arguments\); \};/, 'g.canUse = function () { return cu.apply(g, arguments); };'],
  ['bodyMove', /e\.yBodyRot = e\.yaw \|\| 0;\n        e\.yHeadRot = /, 'e.yBodyRot = 0;\n        e.yHeadRot = '],
  ['bodyRider', /e\.yBodyRot = e\.yHeadRot = e\.yaw \|\| 0; return;/, 'return;'],
  ['bodyHead', /\> Ai\.BODY_STABLE_DEG\) \{\n        self\.headStableTicks = 0;/, '> 9) {\n        self.headStableTicks = 0;'],
  ['bodySmall', /Ai\.BODY_STABLE_DEG = 15 \* DEG;/, 'Ai.BODY_STABLE_DEG = 5 * DEG;'],
  ['bodyWait', /Ai\.BODY_STABLE_TICKS = 10;/, 'Ai.BODY_STABLE_TICKS = 5;'],
  ['bodyRamp', /if \(f > 1\) f = 1;/, 'f = 0;'],
  ['bodyIndep', /if \(e\.passenger\) return;/, ''],
];
const SRC = fs.readFileSync(new URL('../src/07k_goals.js', import.meta.url), 'utf8');
for (const [key, re, rep] of BR) {
  if (!re.test(SRC)) { fails.push('pattern not found: ' + key); continue; }
  breaks++; let hit = false;
  const B = trial((f, src) => { const n = f === '07k_goals.js' ? src.replace(re, rep) : src; if (n !== src) hit = true; return n; });
  ok(hit, 'break pattern matched: ' + key); ok(!B[key], 'break must be caught: ' + key);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `${pass} ok, ${breaks} breaks caught, 0 failed`);
process.exit(fails.length ? 1 : 0);
