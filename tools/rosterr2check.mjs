#!/usr/bin/env node
// rosterr2check.mjs — #5121 (G18b-R2): the zombie DestroyEgg, iron golem WanderAroundPointOfInterest, the
// LookAtEntityGoal(MobEntity) rows of raiders/vex/wandering trader, zombie_horse and the four fish mobs are rostered
// at the jar's own priorities (tools/golden/goals-1.18.2.tsv). Anti-vacuity: each row is removed in turn; each must be flagged.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODS = []; for (const m of readFileSync(join(ROOT, 'build.mjs'), 'utf8').matchAll(/'(07[0-9a-z_]+\.js)'/g)) if (!MODS.includes(m[1])) MODS.push(m[1]);
const M = loadEngine({ extra: ['14b_physics.js', '07_world.js'].concat(MODS.filter((f) => f !== '07_world.js')) });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Breed.init && M.Breed.init(); M.Mount.init(); M.Ai.init();
const EL = M.EntityList, Ai = M.Ai, W = M.World, CH = M.CH;
W.init(1);
for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
const STONE = M.States.stateOf('stone') | 0;
for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) W.setBlock(x, 8, z, STONE);

const golden = new Map();
for (const l of readFileSync(join(ROOT, 'tools/golden/goals-1.18.2.tsv'), 'utf8').split('\n')) {
  if (!l || l[0] === '#') continue;
  const f = l.split('\t'); if (f[1] !== 'goalSelector') continue;
  (golden.get(f[0]) || golden.set(f[0], []).get(f[0])).push({ pri: +f[2], goal: f[3], args: f[4] || '' });
}
// mob -> [jar goal class, engine constructor test]
const WANT = {
  zombie: [['ZombieEntity.DestroyEggGoal', 4, (g) => g instanceof M.Undead.DestroyEggGoal]],
  iron_golem: [['WanderAroundPointOfInterestGoal', 2, (g) => g instanceof Ai.WanderAroundPointOfInterestGoal]],
  vex: [['LookAtEntityGoal', 10, (g) => g instanceof Ai.LookAtMobGoal]],
  pillager: [['LookAtEntityGoal', 10, (g) => g instanceof Ai.LookAtMobGoal]],
  vindicator: [['LookAtEntityGoal', 10, (g) => g instanceof Ai.LookAtMobGoal]],
  evoker: [['LookAtEntityGoal', 10, (g) => g instanceof Ai.LookAtMobGoal]],
  illusioner: [['LookAtEntityGoal', 10, (g) => g instanceof Ai.LookAtMobGoal]],
  wandering_trader: [['LookAtEntityGoal', 10, (g) => g instanceof Ai.LookAtMobGoal]],
};
const prios = (rows) => rows.map((r) => r.pri).sort((a, b) => a - b).join(',');
function run(drop) {   // drop: a "mob|pri" row to remove from the built selector (the break)
  const fails = []; let n = 0;
  const ok = (c, m) => { n++; if (!c) fails.push(m); };
  for (const type in WANT) {
    const e = EL.spawn(type, 0.5, 9, 0.5);
    const ents = e.ai.entries.filter((x) => drop !== type + '|' + x.priority || !WANT[type].some((w) => w[1] === x.priority && w[2](x.goal)));
    for (const [jar, pri, test] of WANT[type]) {
      ok(golden.get(type).some((r) => r.goal.endsWith(jar) && r.pri === pri), type + ': jar has no ' + jar + ' at ' + pri);
      ok(ents.some((x) => x.priority === pri && test(x.goal)), type + ': no ' + jar + ' at priority ' + pri);
    }
  }
  const zh = EL.spawn('zombie_horse', 0.5, 9, 0.5);
  const zhEnt = drop === 'zombie_horse|any' ? zh.ai.entries.slice(1) : zh.ai.entries;
  ok(prios(zhEnt.map((x) => ({ pri: x.priority }))) === prios(golden.get('zombie_horse')), 'zombie_horse: priorities ' + zhEnt.map((x) => x.priority) + ' != jar ' + prios(golden.get('zombie_horse')));
  for (const t of ['cod', 'salmon', 'tropical_fish', 'pufferfish']) {
    const f = EL.spawn(t, 0.5, 9, 0.5), es = M.Fish.buildGoals(f).entries;
    const got = drop === 'fish|any' ? es.slice(1) : es;
    ok(prios(got.map((x) => ({ pri: x.priority }))) === prios(golden.get(t)), t + ': fish goal priorities ' + got.map((x) => x.priority) + ' != jar ' + prios(golden.get(t)));
  }
  return { fails, n };
}
const base = run(null);
if (base.fails.length) { console.log('FAIL (' + base.fails.length + '):\n x ' + base.fails.join('\n x ')); process.exit(1); }
let caught = 0, total = 0;
const breaks = []; for (const t in WANT) for (const w of WANT[t]) breaks.push(t + '|' + w[1]); breaks.push('zombie_horse|any', 'fish|any');
for (const b of breaks) { total++; if (run(b).fails.length) { caught++; console.log(' ✓ break caught: ' + b); } else console.log(' x break not noticed: ' + b); }
if (caught !== total) { console.log('FAIL anti-vacuity: ' + caught + '/' + total); process.exit(1); }
console.log(`rosterr2check: ${base.n} assertions, 0 failures, ${caught} breaks caught`);
