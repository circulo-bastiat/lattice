#!/usr/bin/env node
// navtimeoutcheck.mjs — #8563: EntityNavigation.checkTimeouts (100-tick idle window / 1.5 distance) in Ai.advancePathNode.
import { loadEngine } from './loadsrc.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js',
  '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14c_raycast.js'] });
const Ai = M.Ai;
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function run(moveDist) {
  const e = { type: 'zombie', x: 0.5, y: 20, z: 0.5, width: 0.6, id: 1 };
  const path = [{ x: 0, y: 20, z: 0 }, { x: 50, y: 20, z: 0 }, { x: 60, y: 20, z: 0 }];
  let idx = 1, dropped = -1;
  for (let t = 1; t <= 130; t++) {
    e.x += moveDist;
    idx = Ai.advancePathNode(e, path, idx);
    if (idx >= path.length) { dropped = t; break; }
  }
  return dropped;
}
const real = run(0);
ok(real === 101, 'stuck mob drops the path on tick 101, got ' + real);
ok(run(0.05) === -1, 'a mob moving 0.05/tick (5 blocks per window) keeps its path');
let breaks = 0;
const orig = Ai.checkTimeouts;
const mut = {
  'never drop': (e, nv, p, i) => i,
  'window 50': (e, nv, p, i) => (nv.tick > 50 ? Ai.dropPath(e, p) : i),
};
for (const [n, f] of Object.entries(mut)) {
  Ai.checkTimeouts = f;
  const f0 = fails.length; const a = run(0) === 101, b = run(0.05) === -1;
  if (!(a && b)) { breaks++; console.log('   ✓ caught: ' + n); } else fails.push('mutant survived: ' + n);
}
Ai.checkTimeouts = orig;
console.log(' assertions passed .. ' + pass + '\n failures ........... ' + fails.length + '\n ' + breaks + ' breaks caught');
if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
