#!/usr/bin/env node
// pillageraudit11484check.mjs — #11484: Ai.ROSTER.pillager goal table (PillagerEntity.initGoals, PillagerEntity.java:66-79) plus
// PatrolEntity's inherited PatrolGoal(4) / RaiderEntity goals. Anti-vacuity: source breaks of 07k_goals.js must fail their row.
import fs from 'node:fs';
import { loadEngine } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const M = loadEngine({ extra: ['07k_goals.js'], dom: false, ...(patch ? { patch } : {}) });
  const Ai = M.Ai, o = {};
  const gs = Ai.ROSTER.pillager({ type: 'pillager', x: 0, y: 64, z: 0, width: 0.6 }, { random: () => 0.5, players: () => [] });
  const row = (p, name, nth = 0) => gs.entries.filter(e => e.priority === p && e.goal.__goalName === name)[nth];
  const r = (p, n, k) => row(p, n, k);
  o.swim = !!r(0, 'SwimGoal') && r(0, 'SwimGoal').flags === Ai.JUMP;
  o.approach = !!r(2, 'PatrolApproachGoal') && r(2, 'PatrolApproachGoal').flags === (Ai.MOVE | Ai.LOOK);
  o.crossbow = !!r(3, 'CrossbowAttackGoal') && r(3, 'CrossbowAttackGoal').flags === (Ai.MOVE | Ai.LOOK);
  o.wander = !!r(8, 'WanderAroundGoal');
  o.lookPlayer = !!r(9, 'LookAtEntityGoal');
  o.lookMob = !!r(10, 'LookAtMobGoal');
  o.revenge = !!r(1, 'RevengeGoal') && r(1, 'RevengeGoal').goal.group === true;
  o.tplayer = !!r(2, 'ActiveTargetGoal') && r(2, 'ActiveTargetGoal').goal.mustSee === true;
  o.merchant = !!r(3, 'ActiveTargetGoal', 0) && r(3, 'ActiveTargetGoal', 0).goal.mustSee === false;   // ActiveTargetGoal(Merchant, false)
  o.golem = !!r(3, 'ActiveTargetGoal', 1) && r(3, 'ActiveTargetGoal', 1).goal.mustSee === true;
  o.patrol = !!r(4, 'PatrolGoal') && r(4, 'PatrolGoal').flags === Ai.MOVE;                       // PatrolEntity.initGoals priority 4
  o.count = gs.entries.length === 15;
  return o;
}
const LBL = { swim: 'SwimGoal(0)', approach: 'PatrolApproachGoal(2)', crossbow: 'CrossbowAttackGoal(3)', wander: 'WanderAroundGoal(8)', lookPlayer: 'LookAtEntityGoal(9)', lookMob: 'LookAtMobGoal(10)', revenge: 'RevengeGoal(1) group', tplayer: 'ActiveTarget player checkVisibility', merchant: 'ActiveTarget merchant checkVisibility=false', golem: 'ActiveTarget iron golem checkVisibility', patrol: 'PatrolGoal(4) inherited', count: 'goal count (pillager 6 + raider 5 + targets 4)' };
const A = trial(null);
for (const [k, m] of Object.entries(LBL)) ok(A[k], m + (A[k] ? '' : ' (baseline)'));
// simple, verified-by-grep source breaks (pillager block only)
const SRC = fs.readFileSync(new URL('../src/07k_goals.js', import.meta.url), 'utf8');
const i0 = SRC.indexOf('    pillager: function (e, ctx) {'), i1 = SRC.indexOf('Ai.addRaiderGoals(gs, e, ctx);', i0);
const blk = SRC.slice(i0, i1);
const mut = (k, a, b) => {
  if (!blk.includes(a)) { fails.push('pattern not found: ' + k); return; }
  breaks++; let hit = false;
  const B = trial((f, src) => { if (f !== '07k_goals.js') return src; hit = true; return src.slice(0, i0) + blk.replace(a, b) + src.slice(i1); });
  ok(hit, 'break applied: ' + k); ok(!B[k], 'break must be caught: ' + k);
};
mut('merchant', 'mustSee: false', 'mustSee: true');
mut('approach', 'gs.add(2, Ai.MOVE | Ai.LOOK, new Ai.PatrolApproachGoal', 'gs.add(2, Ai.MOVE, new Ai.PatrolApproachGoal');
mut('wander', 'gs.add(8, Ai.MOVE, new Ai.WanderAroundGoal', 'gs.add(7, Ai.MOVE, new Ai.WanderAroundGoal');
mut('revenge', 'group: true', 'group: false');
mut('swim', 'gs.add(0, Ai.JUMP, new Ai.FloatGoal', 'gs.add(1, Ai.JUMP, new Ai.FloatGoal');
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `${pass} ok, ${breaks} breaks caught, 0 failed`);
process.exit(fails.length ? 1 : 0);
