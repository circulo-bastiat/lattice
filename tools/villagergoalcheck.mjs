#!/usr/bin/env node
// villagergoalcheck.mjs — #214 (G18b-3): 1.18.2's villager has NO registerGoals().
//   node tools/villagergoalcheck.mjs
// The decomp shows VillagerEntity/MerchantEntity/PassiveEntity/PathAwareEntity/MobEntity never
// add a goal (all of a villager's behaviour is Brain tasks -> NS.VB), so the "goal list +
// priorities equal vanilla" for villager is: nothing to port. Also proves Ai.OWED no longer
// claims a villager goal gap.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const D = join(ROOT, '.decomp/net/minecraft/entity');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };

console.log('villagergoalcheck — #214: villager has no registerGoals() in 1.18.2');
const chain = ['passive/VillagerEntity', 'passive/MerchantEntity', 'passive/PassiveEntity',
               'mob/PathAwareEntity', 'mob/MobEntity'];
for (const c of chain) {
  const f = join(D, c + '.java');
  ok(existsSync(f), c + ' decomp present');
  if (!existsSync(f)) continue;
  const src = readFileSync(f, 'utf8');
  ok(!/goalSelector\s*\.\s*add|targetSelector\s*\.\s*add/.test(src), c + ' adds no goals');
}
const vsrc = readFileSync(join(D, 'passive/VillagerEntity.java'), 'utf8');
ok(/Brain</.test(vsrc) && /BRAIN|brain/.test(vsrc), 'VillagerEntity is Brain-driven');
// the goal-based sibling is the trader, which this scanner MUST flag (anti-vacuity)
const wt = readFileSync(join(D, 'passive/WanderingTraderEntity.java'), 'utf8');
okAv(/goalSelector\s*\.\s*add/.test(wt), 'scanner flags WanderingTraderEntity (real goals)');
okAv(/goalSelector\s*\.\s*add/.test(vsrc + '\nthis.goalSelector.add(1, x);'), 'scanner flags a villager broken to add a goal');
okAv(/goalSelector\s*\.\s*add/.test(vsrc.replace(/Brain/g, 'X') + 'this.goalSelector\n.add(0,y)') , 'scanner flags a split-line add');

const goals = readFileSync(join(ROOT, 'src/07k_goals.js'), 'utf8');
ok(!/villager\\'s real registerGoals\(\) \(trading/.test(goals), 'Ai.OWED no longer claims a villager registerGoals gap');
okAv(/villager\\'s real registerGoals\(\) \(trading/.test(goals + "'villager\\'s real registerGoals() (trading"), 'OWED-claim scanner fires on the old text');

console.log(`\n${pass} checks passed, ${breaks} anti-vacuity break(s) confirmed caught, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log('  FAIL: ' + f); process.exit(1); }
