#!/usr/bin/env node
// zoglinlookcheck.mjs — #4048: ZoglinEntity.addIdleTasks FollowMobTask(8.0F) (any living entity) -> the roster looks at a non-player mob within 8.
import { loadEngine, initRegistry } from './loadsrc.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '09b_sky.js', '14b_physics.js',
  '14f_inventory.js', '07h_entities.js', '07y_equip.js', '07ox_enchhelper.js', '07i_entitylist.js', '07l_spawn.js',
  '07m_breed.js', '14i_hand.js', '14j_combat.js', '14d_survival.js', '07zk_undead.js', '07q_effects.js', '07k_goals.js',
  '07zz_xporb.js', '07zzf_piglin.js', '07zf_bat.js', '07zzg_hoglin.js', '07zzp_mobvoice.js'], dom: false });
if (initRegistry) initRegistry(M);
const Ai = M.Ai;
Math.random = () => 0;   // #4282: LookAtEntityGoal rolls 0.02 to start; pin the roll
let fails = 0, breaks = 0;
let rnd = 0.5;
// drive the zoglinIdle goal for n ticks with a scripted rng; returns {gs, e, g, ticks:[{x,wait}]}
function idle(type, dist, rng) {
  const e = { type, x: 0, y: 64, z: 0, look: { setLookAt() {} } }, cow = { type: 'cow', x: dist, y: 64, z: 0 };
  const gs = Ai.ROSTER[type](e, { players: () => [], entities: () => [e, cow], random: rng, animals: () => [] });
  return { e, g: gs.entries.find((g) => g.flags === Ai.MOVE && g.priority === 7 && g.goal.zoglinIdle) };
}
// rng 0.5 over weights 2:2:1 with a look target -> r=2.5 = GoTowardsLookTarget; it starts walking when the cow is > 3 away
function walksTo(type, dist) {
  const { e, g } = idle(type, dist, () => 0.5);
  if (!g) return false;
  g.goal.tick();   // the draw
  g.goal.tick();
  return !!e.navigating;
}
// #4318 idle cadence: every WaitTask run is 30-60 ticks, and waits do happen (old 1/120 goal never waited)
function waitRuns(type, dist, seed) {
  let s = seed; const rng = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const { e, g } = idle(type, dist, rng);
  if (!g) return null;
  const runs = []; let n = 0;
  for (let t = 0; t < 3000; t++) {
    g.goal.tick();
    if (g.goal.waiting()) n++; else if (n) { runs.push(n); n = 0; }
  }
  return runs;
}
function looksAt(type, dist, mobType) {
  const e = { type, x: 0, y: 64, z: 0, look: { setLookAt() {} } };
  const cow = { type: mobType, x: dist, y: 64, z: 0 };
  const gs = Ai.ROSTER[type](e, { players: () => [], entities: () => [e, cow], random: () => rnd, animals: () => [] });
  return gs.entries.some((g) => g.flags === Ai.LOOK && g.priority === 8 && g.goal.canUse());
}
const want = (c, m) => { if (!c) { fails++; console.log('FAIL ' + m); } };
want(looksAt('zoglin', 5, 'cow'), 'zoglin looks at a cow within 8');
want(!looksAt('zoglin', 9, 'cow'), 'zoglin ignores a cow at 9');
want(walksTo('zoglin', 5), 'zoglin walks toward a cow at 5 (GoTowardsLookTarget range 3)');
want(!walksTo('zoglin', 2), 'zoglin already within 3 of the cow stays put');
const runs = waitRuns('zoglin', 5, 12345);
want(runs && runs.length > 5 && runs.every((n) => n >= 30 && n <= 60), 'zoglin idle waits are WaitTask(30,60) runs: ' + (runs && runs.length) + ' runs');
breaks++; if (waitRuns('hoglin', 5, 12345)) { fails++; console.log('FAIL wait probe cannot fail'); } else console.log('✓ break caught: hoglin has no WaitTask idle goal');
breaks++; if (walksTo('hoglin', 5)) { fails++; console.log('FAIL walk probe cannot fail'); } else console.log('✓ break caught: hoglin does not walk to a cow');
// anti-vacuity: the hoglin roster (player-only look) must NOT pass the same probe
breaks++; if (looksAt('hoglin', 5, 'cow')) { fails++; console.log('FAIL probe cannot fail'); } else console.log('✓ break caught: hoglin does not look at a cow');
console.log(fails ? `zoglinlookcheck: ${fails} failed` : `zoglinlookcheck: 6 assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
