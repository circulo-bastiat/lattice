#!/usr/bin/env node
// #4136: endermite ActiveTargetGoal<Player>(true) and enderman ActiveTargetGoal<Endermite>(true,false) use the
// (mob,class,checkVisibility) constructors: respectsVisibility + reciprocalChance 10 (ActiveTargetGoal.java). Breaks its own data.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
          '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js',
          '14j_combat.js', '07zg_enderman.js', '07zx_particle.js', '07zn_silverfish.js', '07zn2_endermite.js', '07zw_mobnbt.js'],
  dom: false
});
initRegistry(M);
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Ai.init();
M.World = Object.assign(M.World || {}, { getBlock: () => 0, setBlock: () => true, get: () => null });
const EL = M.EntityList, Ai = M.Ai;
const targets = (t, pri) => EL.spawn(t, 0.5, 64, 0.5, {}).ai.entries
  .filter((x) => x.priority === pri && (x.flags & Ai.TARGET) && x.goal.getCandidates).map((x) => x.goal);
const mite = targets('endermite', 2), man = targets('enderman', 3);
ok(mite.length === 1 && man.length === 1, 'one ActiveTargetGoal each');
for (const [n, g] of [['endermite', mite[0]], ['enderman', man[0]]]) {
  ok(g && g.sight === true, n + ' respects visibility');
  ok(g && g.reciprocalChance === 10, n + ' reciprocalChance 10, got ' + (g && g.reciprocalChance));
}
// breaks: a goal built without the opts must be caught by the same predicate
const bare = new Ai.NearestAttackableTargetGoal({}, () => [], { sight: false });
for (const f of [bare.sight === true, bare.reciprocalChance === 10]) { breaks++; if (f) fails.push('anti-vacuity: bare goal passed'); else console.log('   ✓ anti-vacuity: bare goal caught'); }
console.log(`endermitetargetcheck: ${pass} assertions, ${fails.length} failed, ${breaks} breaks caught`);
for (const f of fails) console.log('  ✗ ' + f);
process.exit(fails.length ? 1 : 0);
