#!/usr/bin/env node
// losgatecheck.mjs — #5118: NearestAttackableTargetGoal's line-of-sight gate is the DEFAULT for every caller
// (TargetPredicate.respectsVisibility is true unless ignoreVisibility() is called; ActiveTargetGoal never calls it).
// Unseen candidate not acquired; seen-then-hidden target dropped after exactly maxNoSight ticks (60 default, 300 evoker).
//   node tools/losgatecheck.mjs
import { loadEngine } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const M = loadEngine({ extra: ['02g_items.js', '02f_tags.js', '07_world.js', '07b_behaviour.js', '07h_entities.js',
  '07y_equip.js', '07i_entitylist.js', '14b_physics.js', '14d_survival.js', '14f_inventory.js', '14i_hand.js',
  '07q_effects.js', '14j_combat.js', '07v_spell.js', '07k_goals.js', '07l_spawn.js', '07s_raid.js', '07t_fly.js', '07zx_particle.js'] });
const Ai = M.Ai;
let visible = true;
Ai.canSee = () => visible;
const mk = (opts) => {
  const e = { type: 'zombie', x: 0, y: 0, z: 0, followRange: 16, width: 0.6, height: 1.8 };
  const t = { type: 'cow', x: 5, y: 0, z: 0, width: 0.9, height: 1.4 };
  return { e, t, g: new Ai.NearestAttackableTargetGoal(e, () => [t], opts) };
};
function dropTicks(opts) {
  visible = true; const { e, t, g } = mk(opts);
  if (!g.canUse()) return -1;
  g.start(); visible = false;
  for (let i = 1; i < 1000; i++) if (!g.canContinueToUse()) return i - 1;
  return -2;
}
function run(tag, sightOpt, exp) {
  visible = false; let m = mk(sightOpt);
  ok(m.g.canUse() === exp.hidden, tag + ': hidden candidate acquired=' + exp.hidden);
  visible = true; m = mk(sightOpt);
  ok(m.g.canUse() === true, tag + ': visible candidate acquired');
}
run('default', {}, { hidden: false });
run('mustSee', { mustSee: true }, { hidden: false });
ok(dropTicks({ mustSee: true }) === 60, 'default: dropped after 60 unseen ticks, got ' + dropTicks({ mustSee: true }));
ok(dropTicks({ mustSee: true, maxNoSight: 300 }) === 300, 'evoker: dropped after 300 unseen ticks, got ' + dropTicks({ mustSee: true, maxNoSight: 300 }));
ok(dropTicks({ mustSee: false }) === -2, 'mustSee false: never dropped for sight');
// anti-vacuity: break the data, the assertions must fail
const before = fails.length;
run('BREAK sight:false', { sight: false }, { hidden: false }); breaks++;
ok(dropTicks({ mustSee: true, maxNoSight: 299 }) === 300, 'BREAK maxNoSight 299'); breaks++;
const caught = fails.length - before; fails.splice(before);
ok(caught >= 2, 'deliberate breaks were not caught (' + caught + ')');
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : 'losgatecheck: ' + pass + ' passed, ' + breaks + ' breaks caught');
process.exit(fails.length ? 1 : 0);
