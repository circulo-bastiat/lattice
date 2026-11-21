#!/usr/bin/env node
// zombieattackgoalcheck.mjs (#2826) -- ZombieAttackGoal arm-raise timing (e.aggressive) vs .decomp ZombieAttackGoal.tick.
import { loadEngine, initRegistry } from './loadsrc.mjs';
const MCL = loadEngine({ extra: ['07k_goals.js'], dom: false });
initRegistry(MCL);
const Ai = MCL.Ai;
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

// adjacent target: in reach, no pathing; with no NS.Combat loaded the strike just resets the cooldown (20).
function run(Goal) {
  const e = { x: 0, y: 0, z: 0, width: 0.6, target: { x: 0.5, y: 0, z: 0, width: 0.6 }, aggressive: false };
  const g = new Goal(e, 1.0);
  g.start();
  const seq = [];
  for (let i = 0; i < 45; i++) { g.tick(); seq.push(e.aggressive); }
  g.stop();
  return { seq, after: e.aggressive };
}
function verdict(Goal) {
  const { seq, after } = run(Goal);
  // strikes at ticks 1,21,41 (cooldown 20, decremented before each compare): cd(t) = 20-((t-1)%20); raised only when t>=5 && cd<10
  const want = seq.map((_, i) => i + 1 >= 5 && 20 - (i % 20) < 10);
  return { seq, after, want };
}
const v = verdict(Ai.ZombieAttackGoal);
ok(v.seq.slice(0, 4).every((x) => x === false), 'aggressive false for ticks 1-4');
ok(JSON.stringify(v.seq) === JSON.stringify(v.want), 'aggressive follows ticks>=5 && cooldown<max/2: ' + v.seq.map(Number).join(''));
ok(v.seq.includes(true) && v.seq.lastIndexOf(false) > v.seq.indexOf(true), 'flips false again after a swing');
ok(v.after === false, 'stop() clears aggressive');
// anti-vacuity: plain MeleeAttackGoal (the old behaviour) must fail the same assertions
const bad = verdict(Ai.MeleeAttackGoal);
breaks++; ok(bad.seq[0] === true, 'anti-vacuity: plain MeleeAttackGoal raises arms at tick 1 (caught)'); console.log('   ✓ anti-vacuity');
breaks++; ok(JSON.stringify(bad.seq) !== JSON.stringify(bad.want), 'anti-vacuity: plain MeleeAttackGoal trace differs from vanilla (caught)'); console.log('   ✓ anti-vacuity');
// roster wiring
for (const n of ['zombie', 'husk', 'zombie_villager', 'zombified_piglin', 'drowned']) ok(!!Ai.ROSTER[n], 'roster has ' + n);
const src = (await import('node:fs')).readFileSync(new URL('../src/07k_goals.js', import.meta.url), 'utf8');
ok((src.match(/new Ai\.ZombieAttackGoal\(/g) || []).length === 3, 'zombie, drowned, zombified_piglin rosters use ZombieAttackGoal');
console.log('================ zombieattackgoalcheck ================');
console.log(` assertions passed .. ${pass}\n failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
