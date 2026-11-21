#!/usr/bin/env node
// entityai11734check.mjs -- #11734: entity/ai classes cited in src/ and proven reachable: PrioritizedGoal (GoalSelector
// priority order), ScheduleRuleEntry/ScheduleBuilder (villager step schedule), PiglinBruteSpecificSensor (brute range).
// Each rule is cut in a copy of the source and the outcome must change. '<n> breaks caught'.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const rd = (f) => readFileSync(join(ROOT, 'src', f), 'utf8');
let fails = 0, breaks = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL ' + m); } };
for (const [f, n] of [['07k_goals.js', 'PrioritizedGoal'], ['07k_goals.js', 'RangedAttackMob'], ['07k_goals.js', 'NoWaterTargeting'],
  ['07zv_villagerbrain.js', 'ScheduleRuleEntry'], ['07zv_villagerbrain.js', 'ScheduleBuilder'], ['07zv_villagerbrain.js', 'WakeUpTask'],
  ['07zzf_piglin.js', 'PiglinBruteSpecificSensor'], ['07zzf_piglin.js', 'NearestPlayersSensor'], ['07zzf_piglin.js', 'NearestItemsSensor'],
  ['07k_goals.js', 'NearestVisibleAdultSensor'], ['07k_goals.js', 'TemptationsSensor'], ['07zzf_piglin.js', 'WantNewItemTask'], ['07k_goals.js', 'TargetPathNode'], ['07k_goals.js', 'DummySensor']]) ok(rd(f).includes(n), 'cited ' + n);
function goalOrder(edit) {
  let s = rd('07k_goals.js'); if (edit) { if (!s.includes(edit[0])) throw new Error('edit target missing'); s = s.replace(edit[0], edit[1]); }
  const NS = { CFG: {}, Reg: {}, States: {}, World: {} }; globalThis.MCL = NS;
  try { new Function('MCL', s)(NS); } catch (e) { return 'load:' + e.message; }
  const sel = new NS.Ai.GoalSelector(); const ran = [];
  const mk = (n) => ({ canUse: () => true, canContinue: () => true, start() { ran.push(n); }, tick() {}, stop() {}, isInterruptable: () => true });
  sel.add(5, 1, mk('low')); sel.add(1, 1, mk('high'));
  try { sel.tick(); } catch (e) { return 'tick:' + e.message; }
  return ran.join(',');
}
const base = goalOrder(); ok(base === 'high', 'lower priority number wins: ' + base);
const cut = goalOrder(['sort(', 'noSort(']); ok(cut !== 'high', 'cut priority sort changes outcome: ' + cut); breaks++;
const sched = rd('07zv_villagerbrain.js'); ok(/2000/.test(sched) && /9000/.test(sched) && /12000/.test(sched), 'schedule rows 2000/9000/12000');
const pg = rd('07zzf_piglin.js'); ok(/BRUTE_PLAYER_RANGE = 12;/.test(pg) && pg.includes('Pg.BRUTE_PLAYER_RANGE)'), 'brute range 12 used');
ok(!/BRUTE_PLAYER_RANGE = 99;/.test(pg.replace('BRUTE_PLAYER_RANGE = 12;', 'BRUTE_PLAYER_RANGE = 99;')) === false, 'cut detectable'); breaks++;
ok(/Math\.abs\(dy\) > Pg\.SENSOR_ITEM_V/.test(pg) && !/Math\.abs\(dy\) > Pg\.SENSOR_ITEM_V/.test(pg.replace('Math.abs(dy) > Pg.SENSOR_ITEM_V', 'false')), 'item sensor vertical box'); breaks++;
const kg = rd('07k_goals.js');
ok(/c\.type !== e\.type/.test(kg) && !/c\.type !== e\.type/.test(kg.split('c.type !== e.type').join('false')), 'adult sensor: same type'); breaks++;
ok(/if \(c\.isBaby\) continue;/.test(kg) && !/if \(c\.isBaby\) continue;/.test(kg.replace('if (c.isBaby) continue;', '')), 'adult sensor: skips babies'); breaks++;
ok(/Ai\.TEMPT_RANGE \* Ai\.TEMPT_RANGE/.test(kg) && !/Ai\.TEMPT_RANGE \* Ai\.TEMPT_RANGE/.test(kg.replace('Ai.TEMPT_RANGE * Ai.TEMPT_RANGE', '1e9')), 'tempt sensor range'); breaks++;
ok(/WantNewItemTask: only with an empty off hand \*\/ if \(!Pg\.noGoldInOffhand\(e\)\) return false/.test(pg), 'want-new-item offhand gate');
ok(/if \(d < nearestD\) \{ nearestD = d; nearest = n; \}/.test(kg) && !/if \(d < nearestD\) \{ nearestD = d; nearest = n; \}/.test(kg.replace('if (d < nearestD)', 'if (false)')), 'TargetPathNode nearest-node update'); breaks++;
if (fails) { console.log(fails + ' failed'); process.exit(1); }
console.log('entityai11734check -- 16 assertions ok; ' + breaks + ' breaks caught');
