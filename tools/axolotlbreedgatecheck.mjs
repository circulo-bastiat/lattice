#!/usr/bin/env node
// #3723: Ai.BreedGoal sets e.breedTarget; Ax.tickPlayDead clears playingDead and Ax.FightGoal refuses while it is set.
import { loadEngine } from './loadsrc.mjs';
const MCL = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07h_entities.js', '07i_entitylist.js', '07k_goals.js', '07m_breed.js', '07zm_axolotl.js'], dom: false });
const Ai = MCL.Ai, Ax = MCL.Axolotl;
let fails = 0, breaks = 0, pass = 0;
const ok = (c, m) => { if (c) pass++; else { fails++; console.log('FAIL ' + m); } };
const av = (c, m) => { breaks++; ok(c, m); if (c) console.log('   ✓ ' + m); };
const mk = () => ({ type: 'axolotl', x: 0, y: 0, z: 0, inLove: true, inWater: true });
function run(gate) {
  const a = mk(), b = mk(); b.x = 2;
  const bg = new Ai.BreedGoal(a, 0.2, () => [a, b], null);
  ok(bg.canUse(), 'breed goal finds partner');
  const findPath = Ai.findPath; Ai.findPath = () => null;
  try { bg.start(); } finally { Ai.findPath = findPath; }
  if (!gate) a.breedTarget = null;
  a.playingDead = true; a.playDeadTicks = 100;
  Ax.tickPlayDead(a);
  const cleared = !a.playingDead;
  a.playingDead = false; a.target = { type: 'cod', x: 1, y: 0, z: 0, inWater: true };
  const fg = new Ax.FightGoal(a, { entities: () => [] });
  const blocked = !fg.canUse();
  bg.stop();
  return { cleared, blocked, cleaned: !a.breedTarget };
}
const r = run(true);
ok(r.cleared, 'play dead cleared while breeding'); ok(r.blocked, 'FightGoal.canUse false while breeding'); ok(r.cleaned, 'breedTarget cleared on stop');
// anti-vacuity: without the memory the gates do not fire
const v = run(false);
av(!v.cleared, 'anti-vacuity: without breedTarget play dead is not cleared');
av(!v.blocked, 'anti-vacuity: without breedTarget FightGoal is not blocked');
console.log(` assertions passed .. ${pass}\n failures ........... ${fails}\n ${breaks} breaks caught`);

console.log('==============================================');
process.exit(fails ? 1 : 0);
