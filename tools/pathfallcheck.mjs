#!/usr/bin/env node
// pathfallcheck.mjs — #5056: MobEntity.getSafeFallDistance (MobEntity.java:793-805) is the pathfinder's max drop.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js',
  '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14c_raycast.js'] });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Behave.init(M.World); M.Ai.init();
const Ai = M.Ai, W = M.World, CH = M.CH, Diff = M.Diff;
const STONE = M.States.stateOf('stone') | 0;
const TOP = 20;
function world(drop) {
  W.init(1);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
    const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
  }
  for (let x = -6; x <= 6; x++) for (let z = -3; z <= 3; z++) W.setBlock(x, x <= 0 ? TOP : TOP - drop, z, STONE);
}
const reach = (drop, mob, opts) => {
  world(drop);
  mob.x = -0.5; mob.z = 0.5; mob.y = TOP + 1; mob.id = 1; mob.width = 0.6; mob.height = 1.8;
  const p = Ai.findPath(mob.x, mob.y, mob.z, 3.5, TOP - drop + 1, 0.5, Object.assign({ mob }, opts || {}));
  return !!p && !p.partial && p.length > 0 && Math.floor(p[p.length - 1].y !== undefined ? p[p.length - 1].y : 0) <= TOP + 1 - drop + 0;
};
function run(tag) {
  const tgt = { type: 'zombie', health: 20, maxHealth: 20 };
  const nt = { type: 'zombie', health: 5, maxHealth: 20 };
  const set = (d) => Diff.set(d);
  // formula grid: [health, max, difficulty, expected]
  const grid = [[20, 20, 'hard', 3 + 13 + 0 + 0 - 0], [20, 20, 'normal', 3 + 9], [20, 20, 'easy', 3 + 5], [20, 20, 'peaceful', 3 + 1],
    [5, 20, 'hard', 3], [10, 20, 'hard', 3 + 3], [20, 20, 'hard', 16], [6.6, 20, 'normal', 3], [8, 20, 'hard', 3 + 1]];
  grid[0][3] = 3 + 13; grid[3][3] = 3 + Math.max(0, 13 - 12);
  for (const [h, mh, d, want] of grid) {
    set(d);
    const got = Ai.safeFallDistance({ target: {}, health: h, maxHealth: mh });
    ok(got === want, tag + ' grid ' + h + '/' + mh + ' ' + d + ' want ' + want + ' got ' + got);
  }
  set('hard');
  ok(Ai.safeFallDistance({ health: 1, maxHealth: 20 }) === 3, tag + ' no target = 3');
  ok(reach(3, { type: 'zombie' }), tag + ' no target walks down 3');
  ok(!reach(4, { type: 'zombie' }), tag + ' no target refuses 4');
  ok(reach(3, Object.assign({ target: {} }, tgt)), tag + ' target full health hard walks down 3');
  ok(!reach(3, Object.assign({ target: {} }, nt)) || Ai.safeFallDistance(Object.assign({ target: {} }, nt)) >= 3, tag + ' hurt');
  set('easy');
  ok(Ai.safeFallDistance({ target: {}, health: 8, maxHealth: 20 }) === 3, tag + ' easy hurt = 3');
  ok(reach(3, { type: 'zombie', health: 8, maxHealth: 20 }), tag + ' hurt, no target still drops 3');
  ok(!reach(3, { type: 'zombie' }, { maxDrop: 1 }), tag + ' explicit maxDrop overrides');
  set('hard');
}
// formula-driven low-health refusal needs max drop < 3, which vanilla's +3 floor never gives; the grid pins the numbers.
const orig = Ai.safeFallDistance;
run('real');
let breaks = 0;
const mutants = {
  'fixed maxDrop 1': () => 1,
  'drop the difficulty term': (m) => !m.target ? 3 : 3 + Math.max(0, Math.trunc(m.health - m.maxHealth * Math.fround(0.33))),
  'ignore target': (m) => { const i = Math.trunc(m.health - m.maxHealth * Math.fround(0.33)) - (3 - Diff.LEVELS.indexOf(Diff.value)) * 4; return Math.max(0, i) + 3; }
};
const base = pass, baseFails = fails.length;
for (const [name, fn] of Object.entries(mutants)) {
  Ai.safeFallDistance = fn;
  const f0 = fails.length; run(name);
  if (fails.length > f0) { breaks++; console.log('   ✓ caught: ' + name); } else fails.push('mutant survived: ' + name);
  fails.splice(f0, fails.length - f0, ...(fails.length > f0 && fails[fails.length - 1].startsWith('mutant') ? [fails[fails.length - 1]] : []));
}
Ai.safeFallDistance = orig;
console.log('');
console.log('================ pathfallcheck ==================');
console.log(' assertions passed .. ' + pass);
console.log(' failures ........... ' + fails.length);
console.log(' ' + breaks + ' breaks caught');
if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
