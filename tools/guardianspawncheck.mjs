#!/usr/bin/env node
// guardianspawncheck — #1600: Spawn.RULES.guardian = GuardianEntity.canSpawn (.decomp GuardianEntity.java:323-328),
// and the ocean monument's spawn_overrides.monster list (guardian 1, 2..4) is what places it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
import { MCDATA } from './paths.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) pass++; else fails.push('anti-vacuity: ' + m); };

const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js',
          '07h_entities.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js']
});
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init(); M.EntityList.init(); M.World.init(1); M.Behave.init(M.World); M.Ai.init();
const W = M.World, Spawn = M.Spawn, Diff = M.Diff || Spawn.Diff;
const water = M.States.stateOf('water') | 0, stone = M.States.stateOf('stone') | 0;
for (let cx = -1; cx <= 2; cx++) for (let cz = -1; cz <= 2; cz++) {
  const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
const SL = Spawn.SEA_LEVEL, X = 10, Z = 10, Y = SL - 20;

ok(typeof Spawn.RULES.guardian === 'function' && Spawn.canPlace('guardian'), 'Spawn.RULES.guardian is wired');
for (let y = Y - 2; y <= SL + 2; y++) W.setBlock(X, y, Z, y < SL ? water : 0);
const G = (reason, r) => Spawn.RULES.guardian(X, Y, Z, reason || 'natural', () => r === undefined ? 0 : r);

// open sky over the sea: only the 1-in-20 roll lets it through
W.canSeeSky = () => true;
ok(G('natural', 0), 'sky visible, roll 0: spawns');
okAv(!G('natural', 7), 'sky visible, roll != 0: refused (the nextInt(20) gate is read)');
// a solid roof above the water: sky not visible -> roll irrelevant
W.canSeeSky = () => false;
ok(G('natural', 7), 'no sky: roll irrelevant, spawns');
// water test on the cell and the cell below
W.setBlock(X, Y - 1, Z, stone);
okAv(!G('natural'), 'stone under the cell: refused (fluid(pos.down()) must be water)');
W.setBlock(X, Y - 1, Z, water);
W.setBlock(X, Y, Z, 0);
okAv(!G('natural'), 'air at the cell: refused for a natural spawn');
ok(G('spawner'), 'air at the cell but reason SPAWNER: accepted');
W.setBlock(X, Y, Z, water);
// peaceful
Diff.set('peaceful');
okAv(!G('natural'), 'PEACEFUL: refused');
Diff.set('normal');
ok(G('natural'), 'normal again: spawns');

// the ocean monument list (structspawncheck proves Structures.spawnOverride serves it inside a real monument)
const mon = JSON.parse(readFileSync(join(MCDATA, '1.18.2', 'data', 'minecraft', 'worldgen', 'configured_structure_feature', 'monument.json'), 'utf8'));
const sp = mon.spawn_overrides.monster.spawns;
okAv(sp.length === 1 && sp[0].type === 'minecraft:guardian' && sp[0].weight === 1 && sp[0].minCount === 2 && sp[0].maxCount === 4,
  'monument monster list is guardian 1 (2..4)');
ok(Spawn.RULES[sp[0].type.replace('minecraft:', '')] === Spawn.RULES.guardian, 'every type the monument list names has a rule');

console.log(`guardianspawncheck: ${pass} passed, ${fails.length} failed, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
