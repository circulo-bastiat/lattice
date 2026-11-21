#!/usr/bin/env node
// lockstep-enderman-wander -- #6967: the enderman wander is random (WanderAroundFarGoal(1.0, 0.0F), EndermanEntity.java:96; canStart = nextInt(120)==0 on a goal
// re-evaluated every other tick), and the real server's enderman trace is not repeatable per salt (#5108), so "salt 0 wanders at tick 52 on the server, not in the engine"
// is not a bug. The comparison that CAN be made is the distribution of the first-move tick over many salts: it must be bounded by the nextInt(120) model
// (P(moved by T) <= 1-(119/120)^T), not cluster at the start, and spread over the run. A distribution that breaks these is caught.
import { engineZombieTrace } from './referee/lockstep/zombielane.mjs';
import { T } from './referee/chasescen.mjs';

let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const N = 120;
const firstMove = (R) => R.findIndex((r) => r.pos[0] !== R[0].pos[0] || r.pos[2] !== R[0].pos[2]);
// verdict on a list of first-move ticks (-1 = never moved); returns the list of complaints
const judge = (firsts) => {
  const out = [], n = firsts.length, moved = firsts.filter((f) => f >= 0);
  const upper = 1 - Math.pow(119 / 120, T);
  const sd = Math.sqrt(upper * (1 - upper) / n);
  if (moved.length / n > upper + 3 * sd) out.push('moves more often than nextInt(120) allows');
  if (moved.length / n < 0.05) out.push('almost never wanders');
  if (moved.length && moved.filter((f) => f < 10).length / moved.length > 0.2) out.push('first moves cluster at the start');
  if (moved.length >= 10 && new Set(moved).size < moved.length / 2) out.push('first-move ticks not spread');
  return out;
};
const firsts = Array.from({ length: N }, (_, s) => firstMove(engineZombieTrace(s, { mob: 'enderman' })));
const verdict = judge(firsts);
ok(verdict.length === 0, 'engine distribution: ' + verdict.join('; '));
ok(firsts.some((f) => f < 0), 'every salt moves: no stationary enderman');
const again = firstMove(engineZombieTrace(0, { mob: 'enderman' }));
ok(again === firsts[0], 'salt 0 first-move tick is deterministic');
caught(judge(firsts.map((f, i) => (i % 2 ? 1 : f))).length > 0, 'half the salts move at tick 1');
caught(judge(firsts.map(() => 40 + 0)).length > 0, 'every salt moves at the same tick');
caught(judge(firsts.map((f, i) => (i % 5 ? i % T : f))).length > 0, 'moves far more often than nextInt(120)');
caught(judge(firsts.map(() => -1)).length > 0, 'never wanders');
const moved = firsts.filter((f) => f >= 0);
console.log(`${breaks} breaks caught; enderman wander: ${moved.length}/${N} salts move within ${T} ticks (bound ${(100 * (1 - Math.pow(119 / 120, T))).toFixed(0)}%), ${bad} failures`);
process.exit(bad ? 1 : 0);
