#!/usr/bin/env node
// spawnpredcheck.mjs — #5124 (G18c-V1): table-driven, bytecode-derived spawn predicates.
//
//   node tools/spawnpredcheck.mjs
//
// tools/golden/spawn-predicates-1.18.2.tsv (tools/extract-spawnpred.mjs, javap on SpawnRestriction.<clinit>)
// lists the class.method each mob's natural-spawn predicate comes from. skeleton and wither_skeleton are
// HostileEntity.canSpawnInDark: no override (D-396's assumption, now proven). For the three shared families
// (canSpawnInDark / isValidNaturalSpawn / canMobSpawn) every Spawn.RULES mob must behave as its family does on
// two probes: a LIT GRASS floor and a DARK STONE floor. Mobs with their own predicate are listed, not probed.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

const VERBOSE = process.argv.includes('--verbose');
let pass = 0;
const TSV = {};
for (const l of readFileSync(join(MCLITE_ROOT, 'tools/golden/spawn-predicates-1.18.2.tsv'), 'utf8').split('\n')) { if (!l || l[0] === '#') continue; const c = l.split('\t'); TSV[c[0]] = c[2]; }

const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => console.log(...a);

say('spawnpredcheck — #5124 (G18c-V1), every mob\'s real spawn predicate vs Spawn.RULES');

const EXTRA = ['02f_tags.js', '07_world.js', '08_lighting.js', '07b_behaviour.js',
               '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js',
               '07l_spawn.js', '07c_blockentity.js', '09b_sky.js', '14j_combat.js',
               '07w_passive.js', '14c_raycast.js', '07zf_bat.js', '07zi_squid.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
initRegistry(M);
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8'))
});
M.Entities.init();
const W = M.World, L = M.Light, CH = M.CH, CFG = M.CFG, T = M.Tags, Spawn = M.Spawn;

ok(T.ready, 'the tag substrate loaded');
ok(T.blockTag('parrots_spawnable_on') >= 0, 'parrots_spawnable_on is a real packed tag column');
ok(T.blockTag('wolves_spawnable_on') >= 0, 'wolves_spawnable_on is a real packed tag column');

const SEED = 3;
W.init(SEED);
L.init();
M.Behave.init(W);
M.EntityList.init();
M.Spawn.init();
ok(Spawn.ready, 'Spawn.init ran');

const stateOf = (n) => M.States.stateOf(n) | 0;
const GRASS = stateOf('grass_block'), STONE = stateOf('stone'), WATER = stateOf('water'),
      SAND = stateOf('sand'), AIR = 0;
const SL = Spawn.SEA_LEVEL;

// ── a lit, grass-floored 3x3 platform at y=60, open to the sky (the same recipe
//    spawncheck.mjs's own §2 fixture uses) ──────────────────────────────────────────────────
for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
  const c = W.getOrCreate(cx, cz);
  c.state = CH.GENERATED;
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
    const gx = cx * 16 + x, gz = cz * 16 + z;
    W.setBlock(gx, 60, gz, GRASS);
    W.setLight(gx, CFG.WORLD_MAX_Y - 1, gz, (15 << 4) | 0);
    L.seed(gx, CFG.WORLD_MAX_Y - 1, gz, 15, L.SKY);
  }
  L.queueBorder(cx, cz);
}
ok(L.settle(4000), 'the lit grass platform settled');

const rnd = (n) => 0; // a fixed, cooperative RNG stub — the dark-cave boundary is not this
                       // file's own test (D-533/spawncheck already own that shape)

// ─────────────────────────────────────────────── 1. horse — shares cow's AnimalEntity rule

// dark stone floor, no light seeded
{ const c = W.getOrCreate(5, 5); c.state = CH.GENERATED; for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) { W.setBlock(80 + x, 40, 80 + z, STONE); } }
const FAM = { 'HostileEntity.canSpawnInDark': [false, true], 'AnimalEntity.isValidNaturalSpawn': [true, false],
              'MobEntity.canMobSpawn': [true, true] };
const sig = (fn) => [!!fn(0, 61, 0, 'natural', rnd), !!fn(88, 41, 88, 'natural', rnd)];
const table = [];
for (const mob of Object.keys(Spawn.RULES).sort()) {
  const fn = Spawn.RULES[mob];
  const pred = TSV[mob];
  if (!ok(typeof fn === 'function', mob + ': rule is a function')) continue;
  if (!pred) { table.push([mob, '(no SpawnRestriction entry)', 'unprobed']); continue; }
  const want = FAM[pred];
  if (!want) { table.push([mob, pred, 'own predicate, unprobed']); continue; }
  const got = sig(fn);
  ok(got[0] === want[0] && got[1] === want[1], mob + ': vanilla ' + pred + ' wants lit-grass/dark-stone ' + want + ' but Spawn.RULES gives ' + got);
  table.push([mob, pred, 'probed ' + got]);
}
for (const [m, p, n] of table) say('  ' + m.padEnd(18) + p.padEnd(40) + n);
ok(TSV.skeleton === 'HostileEntity.canSpawnInDark' && TSV.wither_skeleton === 'HostileEntity.canSpawnInDark', 'skeleton/wither_skeleton predicate is HostileEntity.canSpawnInDark (no override)');
ok(table.filter((r) => r[2].startsWith('probed')).length >= 20, 'the probe covers the shared families');

// anti-vacuity: a wrong rule for skeleton, and a wrong golden family, must both be caught
{
  const sv = Spawn.RULES.skeleton;
  Spawn.RULES.skeleton = Spawn.RULES.cow;
  const g = sig(Spawn.RULES.skeleton), w = FAM[TSV.skeleton];
  okAv(!(g[0] === w[0] && g[1] === w[1]), 'skeleton given the animal rule is caught');
  Spawn.RULES.skeleton = () => true;
  const g2 = sig(Spawn.RULES.skeleton);
  okAv(!(g2[0] === w[0] && g2[1] === w[1]), 'skeleton given an always-true rule is caught');
  Spawn.RULES.skeleton = sv;
  const w3 = FAM['AnimalEntity.isValidNaturalSpawn'], g3 = sig(sv);
  okAv(!(g3[0] === w3[0] && g3[1] === w3[1]), 'a golden row claiming skeleton is an animal predicate is caught');
}
say(`\n${pass} ok, ${fails.length} failed`);
// loop/despawn-s105: the suite's own count format (suite.mjs:877), so this stage's
// assertions reach the total instead of "REPORTED NO ASSERTION COUNT".
say(` assertions passed .. ${pass}`);
say(` failures ........... ${fails.length}`);
say(` breaks caught ...... ${breaks}`);
if (fails.length) { fails.forEach((f) => say('  ✗ ' + f)); process.exit(1); }
