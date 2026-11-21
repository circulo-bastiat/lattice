#!/usr/bin/env node
// spidereyelightcheck.mjs — #1854: SpiderAttackGoal/SpiderTargetGoal read light at the EYE block
// (Entity.getBrightnessAtEyes; spider 0.65, cave spider 0.45), not the feet block.
import { loadEngine } from './loadsrc.mjs';

const run = (broken) => {
  const MCL = loadEngine({ extra: ['07k_goals.js'], dom: false,
    patch: broken ? (f, s) => f === '07k_goals.js' ? s.replace('e.y + (e.type === \'cave_spider\' ? 0.45 : 0.65)', 'e.y') : s : undefined });
  const Ai = MCL.Ai, r = [];
  // feet cell y=64 dark, eye cell y=65 block-light 15 (a lit gap over a dark floor)
  MCL.World = { getLight: (x, y, z) => (y >= 65 ? 15 : 0) };
  const sp = (type, y) => ({ type, x: 0.5, y, z: 0.5, target: {}, followRange: 16 });
  r.push([Ai.spiderEyeBrightness(sp('spider', 64.5)) === 1, 'spider eyes at 65.15 read the lit cell']);
  r.push([Ai.spiderEyeBrightness(sp('spider', 64.2)) === 0, 'spider eyes at 64.85 read the dark cell']);
  r.push([Ai.spiderEyeBrightness(sp('cave_spider', 64.6)) === 1, 'cave spider eyes at 65.05 read the lit cell']);
  r.push([Ai.spiderEyeBrightness(sp('cave_spider', 64.5)) === 0, 'cave spider eyes at 64.95 read the dark cell']);
  const e = sp('spider', 64.5);
  r.push([new Ai.SpiderTargetGoal(e, {}, () => []).canUse() === false, 'target goal refuses when the eye block is bright']);
  return r;
};
const good = run(false); const fails = good.filter(c => !c[0]).map(c => c[1]);
let caught = 0;
const bad = run(true);
if (bad.some(c => !c[0])) caught++; else fails.push('break (feet light) not caught');
if (fails.length) { console.log('FAIL ' + fails.join('; ')); process.exit(1); }
console.log(`spidereyelightcheck: ${good.length} checks, ${caught} breaks caught`);
