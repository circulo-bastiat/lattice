#!/usr/bin/env node
// meleepausecheck.mjs — #4439: MeleeAttackGoal(…, true) users (ravager, iron golem, wolf, dolphin) run pauseWhenMobIdle=true:
// repath without line of sight, and shouldContinue = isInWalkTargetRange.
import { loadEngine } from './loadsrc.mjs';
console.log('meleepausecheck — #4439');
const fails = []; let pass = 0, breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function run(patch) {
  const out = {};
  try {
    const M = loadEngine({ extra: ['02f_tags.js', '07_world.js', '07h_entities.js', '07i_entitylist.js', '07k_goals.js', '07zj2_dolphin.js'], dom: false, patch });
    const Ai = M.Ai, seen = {}, Orig = Ai.MeleeAttackGoal;
    let cur = null;
    Ai.MeleeAttackGoal = function () { const g = new Orig(...arguments); (seen[cur] = seen[cur] || []).push(arguments[5]); return g; };
    for (const t of ['ravager', 'iron_golem', 'wolf']) { cur = t; try { Ai.ROSTER[t]({ type: t, passengers: [] }, { random: Math.random, players: () => [], golems: () => [] }); } catch (e) { } }
    out.flags = JSON.stringify(['ravager', 'iron_golem', 'wolf'].map(t => !!(seen[t] || []).some(Boolean)));
    // behaviour: target out of sight, goal must still repath; out of walk range must stop
    Ai.canSee = () => false;
    let paths = 0; Ai.findPath = () => { paths++; return null; };
    const e = { x: 0, y: 0, z: 0, age: 100, target: { x: 10, y: 0, z: 0 } };
    const g = new Ai.MeleeAttackGoal(e, 1.0, undefined, undefined, undefined, true);
    g.start(); for (let i = 0; i < 40; i++) g.tick();
    out.repaths = paths > 0;
    e.positionTarget = { x: 100, y: 0, z: 0 }; e.positionTargetRange = 5;
    out.cont = g.canContinueToUse();
  } catch (err) { out.err = String(err); }
  return out;
}
const r = run();
if (r.err) { console.log('   ✗ ' + r.err); process.exit(1); }
ok(r.flags === '[true,true,true]', 'ravager/iron_golem/wolf built with pause=true (got ' + r.flags + ')');
ok(r.repaths === true, 'pause=true repaths without line of sight');
ok(r.cont === false, 'pause=true stops when the target is outside the walk range');
const brk = (name, from, to, key, val) => {
  let hit = false, rr = run((f, s) => { if (f === '07k_goals.js' && s.includes(from)) { hit = true; return s.replace(from, to); } return s; });
  if (hit && rr[key] !== val) { breaks++; console.log('   ✓ ' + name + ' caught'); } else fails.push('anti-vacuity: ' + name + ' not caught (matched=' + hit + ')');
};
brk('pause not passed to nav tick', 'distSq, !!pause, Math.random', 'distSq, false, Math.random', 'repaths', true);
brk('walk range test gone', '(!pause || Ai.isInWalkTargetRange', '(true || Ai.isInWalkTargetRange', 'cont', false);
brk('ravager flag gone', "'entity.ravager.attack'); }, undefined, true)", "'entity.ravager.attack'); })", 'flags', '[true,true,true]');
console.log('   ' + pass + ' checks passed, ' + fails.length + ' failures, ' + breaks + ' breaks caught');
if (fails.length) { for (const f of fails) console.log('   ✗ ' + f); process.exit(1); }
