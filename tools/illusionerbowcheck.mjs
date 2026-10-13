import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

// #1018 — illusioner's BowAttackGoal interval is the constant 20 (IllusionerEntity.java:67, no
// updateAttackType override); skeleton's is 20 HARD / 40 otherwise. Shot spacing must not depend on difficulty.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = loadEngine({
  extra: ['02f_tags.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js',
          '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14c_raycast.js']
});
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Behave.init(M.World); M.Ai.init();
const Ai = M.Ai;
let diff = 'normal';
M.Diff = { get: () => diff };

function gaps(make, d) {
  diff = d;
  const e = { id: 1, type: 'illusioner', x: 0, y: 9, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, width: 0.6, height: 1.9, target: { x: 10, y: 9, z: 0, height: 1.8 } };
  const shots = []; let now = 0;
  const g = make(e, () => shots.push(now), () => true);
  g.start();
  for (now = 1; now <= 200; now++) { e.x = 0; e.z = 0; g.tick(); }
  return shots.slice(1).map((t, i) => t - shots[i]);
}
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const ill = (e, sh, see) => new Ai.BowAttackGoal(e, 0.5, sh, Math.random, see, 20);
const skel = (e, sh, see) => new Ai.BowAttackGoal(e, 0.5, sh, Math.random, see);

const gn = gaps(ill, 'normal'), gh = gaps(ill, 'hard');
ok(gn.length >= 3 && gn.every(x => x === 40), 'illusioner normal gap is 40: ' + gn);
ok(gh.every(x => x === 40) && gh.length === gn.length, 'illusioner hard gap is 40: ' + gh);
// anti-vacuity: the skeleton goal (no fixed interval) must differ on normal, else this proves nothing
breaks++; const sn = gaps(skel, 'normal');
if (sn.some(x => x === 40)) fails.push('anti-vacuity: skeleton normal gap should be 60: ' + sn); else pass++;
// the roster wiring passes 20
const src = readFileSync(join(ROOT, 'src/07k_goals.js'), 'utf8');
breaks++; if (/BowAttackGoal\(e, 0\.5, ctx\.onShoot, ctx\.random, null, 20\)/.test(src)) pass++; else fails.push('illusioner roster lacks fixed 20');
console.log(pass + ' assertions, ' + fails.length + ' failures, ' + breaks + ' breaks caught');
fails.forEach(f => console.log('  ✗ ' + f));
process.exit(fails.length ? 1 : 0);
