#!/usr/bin/env node
// turtlesoundcheck.mjs — #1257: turtle step (shamble 0.15, +0.15 next-step), swim (x1.5), lay_egg, dig event.
import { loadEngine } from './loadsrc.mjs';
const MCL = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js', '14b_physics.js', '07zp_turtle.js', '07zzp_mobvoice.js'], dom: false });
let fails = 0, breaks = 0, pass = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL ' + m); } else pass++; };
const MV = MCL.MobVoice, Tu = MCL.Turtle;
const played = [];
MCL.Sound = { ready: true, play: (id, o) => { played.push([id, o]); return true; }, blockBreak: () => { played.push(['break', {}]); return true; }, blockStep: () => true };
MCL.Physics = { blockAt: () => 1 };
MCL.World = { getBlock: () => 1, tagBelow: () => true };
MCL.DATA = Object.assign({}, MCL.DATA, { mobSounds: { turtle: ['entity.turtle.ambient_land', 'entity.turtle.hurt', 'entity.turtle.death', 'entity.turtle.shamble_baby,entity.turtle.shamble', '0.15', '200', '1.0', 'neutral', '', '', ''] } });
function walk(extra) {
  played.length = 0;
  const e = Object.assign({ type: 'turtle', x: 0, y: 64, z: 0, onGround: true, vx: 0.1, vy: 0, vz: 0 }, extra);
  const nexts = [];
  for (let i = 0; i < 12; i++) { e.x += 0.3; MV.tickStep(e); nexts.push(e.stepNext); }
  return { e, nexts };
}
function verdict() {
  const a = walk({});
  const b = walk({ isBaby: true });
  const c = walk({ inWater: true, onGround: false });
  return a.e.stepNext !== undefined && played.length >= 0 && (() => {
    walk({});
    const s = played.slice();
    const stepOk = s.length > 4 && s.every(x => x[0] === 'entity.turtle.shamble' && x[1].volume === 0.15);
    walk({ isBaby: true });
    const babyOk = played.length > 0 && played.every(x => x[0] === 'entity.turtle.shamble_baby');
    walk({ inWater: true, onGround: false });
    const swimOk = played.length > 0 && played.every(x => x[0] === 'entity.turtle.swim' && x[1].volume <= 1.5);
    const gap = walk({}).nexts; const incOk = Math.abs(gap[gap.length - 1] - (walk({}).e.stepDist + 0.15)) < 1e-9;
    return stepOk && babyOk && swimOk && incOk;
  })();
}
ok(verdict(), 'turtle step shamble 0.15 (baby variant), swim sound in water, nextStep = dist + 0.15');
// dig event: every 5th tick
function digOk() {
  played.length = 0; const e = { type: 'turtle', x: 0.5, y: 64, z: 0.5, diggingSand: true };
  for (let i = 1; i <= 10; i++) { e.sandDiggingCounter = i; Tu.tickDigSound(e); }
  return played.filter(x => x[0] === 'break').length === 2;
}
ok(digOk(), 'dig event every 5th digging tick');
// lay egg sound
function layOk() {
  played.length = 0;
  const e = { type: 'turtle', x: 0.5, y: 64, z: 0.5, hasEgg: true, ai: {} };
  const g = new Tu.LayEggGoal(e, { speed: 1, random: () => 0.5 });
  const src = Tu.LayEggGoal.toString();
  return /entity\.turtle\.lay_egg/.test(src);
}
ok(layOk(), 'lay_egg sound present in LayEggGoal');
const layBlock = src => /lay_egg[^\n]*source: 'block'/.test(src);
ok(layBlock(Tu.LayEggGoal.toString()), '#3608 lay_egg plays in BLOCKS category');
const he = {}; Tu.setHomePos(he, 1.7, 64.2, -0.3);
ok(he.homeX === 1 && he.homeY === 64 && he.homeZ === -1, '#3608 home pos is integer block pos');
if (layBlock(Tu.LayEggGoal.toString().replace("'block'", "'neutral'"))) breaks += 0; else breaks++;
const sv = [Tu.tickDigSound, MV.waterSound];
Tu.tickDigSound = () => {}; if (!digOk()) breaks++; Tu.tickDigSound = sv[0];
const T = MCL.DATA.mobSounds.turtle[4]; MCL.DATA.mobSounds.turtle[4] = '1'; MV.emit = (e, ev, v, p) => { played.push([ev, { volume: 1 }]); return true; }; if (!verdict()) breaks++; MCL.DATA.mobSounds.turtle[4] = T;
const ts = MV.tickStep; MV.tickStep = () => false; if (!verdict()) breaks++; MV.tickStep = ts;
ok(breaks === 4, breaks + ' breaks caught');
console.log(`\n${pass} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
