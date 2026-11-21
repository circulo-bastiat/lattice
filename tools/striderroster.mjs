#!/usr/bin/env node
// #1180 -- StriderEntity.initGoals roster golden: priorities + classes + tempt/escape sound gating.
import { loadEngine } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log(' ✓ ' + m); };
console.log('striderroster -- #1180');
const M = loadEngine({ extra: ['07b_behaviour.js', '07k_goals.js', '07zzp_mobvoice.js', '07zzj_strider.js'], dom: false });
const Ai = M.Ai;
const e = { type: 'strider', x: 0, y: 70, z: 0 };
const ctx = { players: () => [], random: Math.random, entities: () => [e] };
const VANILLA = [[1, 'PanicGoal'], [2, 'BreedGoal'], [3, 'TemptGoal'], [4, 'GoBackToLavaGoal'], [5, 'FollowParentGoal'],
                 [7, 'WanderAroundGoal'], [8, 'LookAtPlayerGoal'], [8, 'RandomLookAroundGoal'], [9, 'LookAtMobGoal']];
function names(gs) {
  return gs.entries.map((x) => {
    for (const k of Object.keys(Ai)) if (typeof Ai[k] === 'function' && x.goal instanceof Ai[k]) return [x.priority, k];
    return [x.priority, '?'];
  });
}
const gs = Ai.ROSTER.strider(e, ctx);
const got = names(gs);
function cmp(got, want) { return got.length === want.length && want.every((w, i) => got[i][0] === w[0] && got[i][1] === w[1]); }
ok(cmp(got, VANILLA), 'strider roster == StriderEntity.initGoals: ' + JSON.stringify(got));
// break: drop GoBackToLava from the golden comparison input
okAv(!cmp(got.filter((g) => g[1] !== 'GoBackToLavaGoal'), VANILLA), 'roster without GoBackToLava is caught');
okAv(!cmp(got.map((g) => g[1] === 'WanderAroundGoal' ? [60, g[1]] : g), VANILLA), 'wrong priority is caught');
// wander interval 60 -> 1/60 per tick
let n = 0; const w = new Ai.WanderAroundGoal(e, 1, () => 1 / 90, 60);
w.canUse(); // must not throw
const w60 = new Ai.WanderAroundGoal(e, 1, () => 1 / 90, 60), w120 = new Ai.WanderAroundGoal(e, 1, () => 1 / 90);
ok(w60.canUse() === true, 'interval 60 fires at roll 1/90');
okAv(w120.canUse() === false, 'default interval 120 does not fire at roll 1/90');
// ambient gating
M.DATA = M.DATA || {}; M.DATA.mobSounds = { strider: ['entity.strider.ambient', 'entity.strider.hurt', 'entity.strider.death', 'entity.strider.step', '1.0', '120', '1.0', 'neutral'] };
ok(M.MobVoice.pick(e, 'ambient') === 'entity.strider.ambient', 'idle strider ambient plays');
e.ai = { entries: [{ goal: e.striderEscapeGoal, running: true }] };
ok(M.MobVoice.pick(e, 'ambient') === null, 'escaping strider: ambient null');
e.ai = { entries: [{ goal: e.striderTemptGoal, running: true }] };
okAv(M.MobVoice.pick(e, 'ambient') === null, 'tempted strider: ambient null');
console.log(`\nstriderroster: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
if (fails.length) { for (const f of fails) console.log('  x ' + f); process.exit(1); }
