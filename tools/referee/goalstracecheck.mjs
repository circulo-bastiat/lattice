// #6216: serverRow fills 'goals' from the goal agent's RunningGoals log; compareTraces reports a changed priority at the right tick.
import { serverRow, engineRow, compareTraces, parseGoals } from './lockstep/trace.mjs';
let bad = 0, n = 0; const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL ' + m); } };
const G = [[[1, 'MeleeAttackGoal'], [2, 'WanderGoal']], [[1, 'MeleeAttackGoal']], [[0, 'SwimGoal'], [2, 'WanderGoal']]];
const S = G.map((g, t) => serverRow(t, { RunningGoals: g.map(([p, n]) => p + ':' + n).join(',') }));
ok(JSON.stringify(S[0].goals) === JSON.stringify(G[0]), 'string form parsed');
ok(parseGoals('') .length === 0 && parseGoals(null) === null, 'empty / absent');
ok(serverRow(0, {}).goals === null, 'no log -> null (skipped)');
const E = G.map((g, t) => engineRow(t, {}, { goals: g }));
ok(compareTraces(S, E, { fields: ['goals'] }) === null, 'identical traces equal');
let caught = 0;
for (let t = 0; t < G.length; t++) for (let i = 0; i < G[t].length; i++) {
  const E2 = G.map((g, k) => engineRow(k, {}, { goals: k === t ? g.map((x, j) => (j === i ? [x[0] + 1, x[1]] : x)) : g }));
  const d = compareTraces(S, E2, { fields: ['goals'] });
  if (d && d.tick === t && d.field === 'goals') caught++; else ok(false, `change at tick ${t} goal ${i} not reported (${JSON.stringify(d)})`);
}

// #6255: live zombie. NS.Ai.runningGoals(e) must equal the jar's roster (all entries) and show priority-2 ZombieAttackGoal once aggroed.
{
  const { readFileSync } = await import('node:fs'); const { join, dirname } = await import('node:path'); const { fileURLToPath } = await import('node:url');
  const { loadEngine } = await import('../loadsrc.mjs');
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const M = loadEngine({ extra: ['07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '14i_hand.js', '14j_combat.js', '14d_survival.js', '07k_goals.js', '07zk_undead.js', '07l_spawn.js'] });
  M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ROOT, 'assets', 'entities.json'), 'utf8')) });
  M.Entities.init(); M.EntityList.init(); M.Hand.init(); M.Combat.init(); M.Ai.init();
  const W = M.World, EL = M.EntityList, STONE = M.States.stateOf('stone') | 0;
  W.init(1);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) { const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
  for (let x = -15; x <= 15; x++) for (let z = -15; z <= 15; z++) for (let y = 1; y <= 8; y++) W.setBlock(x, y, z, STONE);
  M.Player = { x: 5, y: 9, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0, slot: 0, inventory: null, onGround: true, width: 0.6, height: 1.8, health: 20 };
  const jar = (readFileSync(join(ROOT, 'tools/golden/goals-1.18.2.tsv'), 'utf8').split('\n').filter((l) => l.startsWith('zombie\tgoalSelector\t'))
    .map((l) => { const f = l.split('\t'); return [+f[2], f[3].replace(/^ZombieEntity\./, '')]; }));
  const z = EL.spawn('zombie', 0, 9, 0);
  const roster = parseGoals(M.Ai.runningGoals(z, true)).filter((g) => g[1] !== 'BreakDoorGoal'); // #6573: BreakDoorGoal is added only when canBreakDoors rolls true (random), and the jar roster omits it
  const want = parseGoals(jar);
  ok(JSON.stringify(roster) === JSON.stringify(want), 'zombie roster == jar goalSelector ' + JSON.stringify(roster));
  const wrong = want.filter((g) => g[1] !== 'ZombieAttackGoal');
  if (JSON.stringify(roster) !== JSON.stringify(wrong)) caught++; else ok(false, 'roster without ZombieAttackGoal not caught');
  let aggro = false;
  for (let t = 0; t < 40; t++) { EL.tick(); const g = M.Ai.runningGoals(z); if (g.some((x) => x[0] === 2 && x[1] === 'ZombieAttackGoal')) aggro = true; }
  ok(aggro, 'priority-2 ZombieAttackGoal runs once aggroed within 40 ticks');
  const live = engineRow(40, {}, { goals: M.Ai.runningGoals(z) });
  ok(Array.isArray(live.goals), 'engineRow carries the live goals');
  z.ai.entries = z.ai.entries.filter((en) => en.goal.__goalName !== 'ZombieAttackGoal');
  if (!M.Ai.runningGoals(z, true).some((g) => g[1] === 'ZombieAttackGoal')) caught++; else ok(false, 'removed goal still reported');
}
console.log(`${n} assertions, ${bad} failures, ${caught} breaks caught`);
if (bad) process.exit(1);
