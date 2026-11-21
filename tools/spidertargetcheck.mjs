#!/usr/bin/env node
// spidertargetcheck.mjs — #4288: spider/cave_spider targetSelector Player + IronGolem entries are
// ActiveTargetGoal(mob,cls,checkVisibility=true): sight, mustSee (unseen>60 drop), reciprocalChance 10.
import { loadEngine } from './loadsrc.mjs';

const run = (broken) => {
  const MCL = loadEngine({ extra: ['07k_goals.js'], dom: false,
    patch: broken ? (f, s) => f === '07k_goals.js' ? s.replace('{ sight: true, mustSee: true, reciprocalChance: 10, rand: ctx.random }', '{}') : s : undefined });
  const Ai = MCL.Ai, r = [];
  for (const t of ['spider', 'cave_spider']) {
    const e = { type: t, x: 0.5, y: 64, z: 0.5, followRange: 16 };
    const g = new Ai.SpiderTargetGoal(e, {}, () => []);
    r.push([g.sight === true && g.mustSee === true && g.reciprocalChance === 10, t + ' SpiderTargetGoal has sight, mustSee, reciprocalChance 10']);
  }
  return r;
};
const good = run(false); const fails = good.filter(c => !c[0]).map(c => c[1]);
let caught = 0;
if (run(true).some(c => !c[0])) caught++; else fails.push('break (no opts) not caught');
if (fails.length) { console.log('FAIL ' + fails.join('; ')); process.exit(1); }
console.log(`spidertargetcheck: ${good.length} checks, ${caught} breaks caught`);
