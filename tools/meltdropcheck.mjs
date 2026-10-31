#!/usr/bin/env node
// meltdropcheck — "a snow layer that melts must drop its snowballs" (happy-ramanujan-xu3ssh hand-off
// item 5) is WRONG, and this check pins vanilla's real answer in both directions.
//
// `SnowBlock.randomTick` calls the 3-arg `Block.dropStacks(state, world, pos)`, whose loot context has
// NO `this` entity. snow.json's only pool carries `entity_properties{entity:this, predicate:{}}`, and
// `{}` is not `EntityPredicate.ANY`: `fromJson({})` builds a new predicate whose `test` is false for a
// null entity (EntityPredicate.java:137-141). So a melted layer drops nothing; a player-broken one
// drops its snowballs. The engine's loot used to treat `{}` as always-true, so every no-entity break
// (`/setblock|/fill ... destroy` = `breakBlock(pos, true)`) dropped snowballs/chorus flowers it
// should not. Those commands also used the PLAYER's tool + harvest gate; vanilla uses neither.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const DEC = join(MCLITE_ROOT, '.decomp', 'net', 'minecraft');
const JAR = join(MCLITE_ROOT, 'jars', '1.18.2', '1.18.2.jar');
if (!existsSync(join(DEC, 'block', 'SnowBlock.java')) || !existsSync(JAR)) {
  console.log('meltdropcheck: SKIP (.decomp/ or the 1.18.2 jar not present — node tools/cloud/bootstrap.mjs)');
  process.exit(0);
}
let pass = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const dec = (f) => readFileSync(join(DEC, f), 'utf8');
const jarJson = (p) => JSON.parse(execFileSync('unzip', ['-p', JAR, p], { maxBuffer: 1 << 24 }).toString('utf8'));

console.log('meltdropcheck — no-entity block drops (snow melt, /setblock|/fill destroy) vs .decomp + the jar');

// 1. The vanilla facts, read off the sources (never typed here).
const snowSrc = dec('block/SnowBlock.java');
ok(/randomTick[\s\S]{0,200}dropStacks\(\$\$0, \$\$1, \$\$2\);/.test(snowSrc), 'SnowBlock.randomTick uses the 3-arg dropStacks');
ok(/dropStacks\(BlockState \$\$0, World \$\$1, BlockPos \$\$2\) \{[\s\S]{0,160}getDroppedStacks\(\$\$0, \(ServerWorld\)\$\$1, \$\$2, null\)/.test(dec('block/Block.java')),
   'Block.dropStacks(3-arg) builds its context with no entity');
ok(/else if \(\$\$2 == null\) \{\s*return false;/.test(dec('predicate/entity/EntityPredicate.java')), 'EntityPredicate.test: a null entity fails a non-ANY predicate');
ok(/breakBlock\(\$\$1, true\);/.test(dec('server/command/SetBlockCommand.java')), 'SetBlockCommand destroy = breakBlock(pos, true) (no entity)');
ok(/breakBlock\(\$\$1, true\);/.test(dec('server/command/FillCommand.java')), 'FillCommand destroy = breakBlock(pos, true) (no entity)');
const snowTable = jarJson('data/minecraft/loot_tables/blocks/snow.json');
const pc = JSON.stringify(snowTable.pools[0].conditions || []);
ok(pc.includes('"minecraft:entity_properties"') && pc.includes('"entity":"this"'), 'snow.json pool needs a `this` entity: ' + pc);

// 2. The engine, both directions.
const E = loadEngine({ extra: ['02f_tags.js', '07d_mining.js', '07e_loot.js'], dom: false });
const L = E.Loot, R = E.Reg, S = E.States;
ok(L.ready, 'Loot.init ran');
const stateOf = (name) => R.realFirst[R.id[name]] + R.defaultState[R.id[name]];
const snow3 = (() => { const b = R.id.snow; for (let st = R.realFirst[b]; S.block[st] === b; st++) {
  const d = L.drops({ state: st, rng: L.rng(1) }); if (d.length && d[0].count === 3) return st; } return -1; })();
ok(snow3 >= 0, 'a player-context snow state with layers=3 drops 3 snowballs');
const count = (d, item) => d.filter((s) => s.item.replace(/^minecraft:/, '') === item).reduce((a, s) => a + (s.count || 1), 0);
const snowDef = stateOf('snow');
const run = () => ({
  playerSnow: count(L.breakDrops(snow3, { item: 'wooden_shovel', rng: L.rng(2) }), 'snowball'),
  meltSnow: L.drops({ state: snow3, noEntity: true, rng: L.rng(3) }).length,
  playerChorus: count(L.drops({ state: stateOf('chorus_flower'), rng: L.rng(4) }), 'chorus_flower'),
  cmdChorus: L.drops({ state: stateOf('chorus_flower'), noEntity: true, rng: L.rng(5) }).length,
  cmdStone: count(L.drops({ state: stateOf('stone'), noEntity: true, rng: L.rng(6) }), 'cobblestone'),
  handStone: L.breakDrops(stateOf('stone'), { item: '', rng: L.rng(7) }).length,
  explSnowByTnt: count(L.drops({ state: snow3, explosionRadius: 4, noEntity: false, rng: L.rng(8) }), 'snowball')
});
const r = run();
ok(snowDef >= 0, 'snow resolves');
ok(r.playerSnow === 3, 'a player breaking 3 layers gets 3 snowballs (entity present): ' + r.playerSnow);
ok(r.meltSnow === 0, 'a MELTED / command-destroyed snow layer drops nothing (no entity): ' + r.meltSnow);
ok(r.playerChorus === 1, 'a player breaking a chorus flower gets it: ' + r.playerChorus);
ok(r.cmdChorus === 0, '/setblock destroy of a chorus flower drops nothing: ' + r.cmdChorus);
ok(r.cmdStone === 1, 'noEntity does NOT gag a table with no entity condition: /setblock destroy stone -> cobblestone: ' + r.cmdStone);
ok(r.handStone === 0, '...while a bare-handed PLAYER gets nothing from stone (the harvest gate is the player\'s, not the command\'s): ' + r.handStone);
ok(r.explSnowByTnt >= 0, 'explosion path runs');

// 2b. A POOL's own `functions` run on its stacks (LootPool.addGeneratedLoot) — sweet_berry_bush keeps its
// set_count there; the engine used to skip them (every bush gave exactly 1 berry; blockrefdropcheck 6 reds).
const berryCounts = () => {
  const bb = R.id.sweet_berry_bush, rng = L.rng(11), sets = [];
  for (let st = R.realFirst[bb]; S.block[st] === bb; st++) {
    const got = new Set();
    for (let i = 0; i < 200; i++) for (const d of L.drops({ state: st, rng })) got.add(d.count);
    sets.push([...got].sort().join(','));
  }
  return sets;
};
{
  const sets = berryCounts();
  ok(sets.includes('1,2') && sets.includes('2,3'), 'bushes at age 2 / 3 give 1-2 / 2-3 berries (pool set_count): ' + JSON.stringify(sets));
  // anti-vacuity break 1 of 2 (the second is section 4): strip the pool's set_count functions — the 2-3 bush must vanish.
  const pool = L.table('sweet_berry_bush').pools[0], keep = pool.functions;
  delete pool.functions;
  const broken = berryCounts();
  pool.functions = keep;
  ok(!broken.includes('2,3'), 'BREAK: without the pool functions the 2-3 bush is gone: ' + JSON.stringify(broken));
}
// 3. The callers pass the no-entity flag (the join, D-276).
const cmd = readFileSync(join(MCLITE_ROOT, 'src', '15g_commands.js'), 'utf8');
ok((cmd.match(/Loot\.drops\(\{ state: f?[Oo]ld, noEntity: true \}\)/g) || []).length === 2, '/setblock and /fill destroy roll with noEntity and no tool');
ok(!/breakDrops\(f?[Oo]ld, NS\.Player\.miningContext/.test(cmd), 'destroy no longer borrows the player\'s tool/harvest gate');
ok(/noEntity: !source/.test(readFileSync(join(MCLITE_ROOT, 'src', '07za_explosion.js'), 'utf8')), 'explosions carry their source entity into the loot context');

// 4. Anti-vacuity (D-30): break the data and the check must notice.
{
  const pool = L.table('snow').pools[0];
  const keep = pool.conditions;
  pool.conditions = [];
  const broken = L.drops({ state: snow3, noEntity: true, rng: L.rng(3) }).length;
  pool.conditions = keep;
  ok(broken > 0, 'BREAK: without the table\'s entity condition, a melted layer WOULD drop (so the 0 above is the condition, not a dead path): ' + broken);
  const again = L.drops({ state: snow3, noEntity: true, rng: L.rng(3) }).length;
  ok(again === 0, 'restored table drops nothing again');
}

if (fails.length) { for (const f of fails) console.log('  FAIL ' + f); console.log(`meltdropcheck: ${fails.length} FAILED, ${pass} passed`); process.exit(1); }
console.log(`meltdropcheck: OK (${pass} assertions)`);
