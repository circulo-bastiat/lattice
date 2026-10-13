#!/usr/bin/env node
// ghastspawncheck.mjs — #645: GhastEntity.canSpawn (.decomp:115-117) = !peaceful && nextInt(20)==0 && canMobSpawn.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

const VERBOSE = process.argv.includes('--verbose');
let pass = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => console.log(...a);

say('ghastspawncheck — #645, GhastEntity.canSpawn 1-in-20 roll');

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


// java.util.Random-shaped seeded stream (mulberry32); nextInt(n) in [0,n)
let st = 645;
const next = () => { st = (st + 0x6D2B79F5) | 0; let t = Math.imul(st ^ (st >>> 15), 1 | st); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const seeded = (n) => Math.floor(next() * n);

const N = 20000;
const rate = (fn) => { let k = 0; for (let i = 0; i < N; i++) if (fn()) k++; return k / N; };
const attempt = () => Spawn.RULES.ghast(0, 61, 0, 'natural', seeded);

say('\n1. ghast passes ~1/20 of attempts on a lit, solid-floored cell (normal difficulty)');
M.Diff.set('normal');
const r = rate(attempt);
ok(r > 0.04 && r < 0.06, 'pass rate ' + r.toFixed(4) + ' is within 4%..6% of 0.05');
ok(Spawn.RULES.ghast(0, 61, 0, 'natural', () => 0) === true, 'rnd(20)=>0 accepted');
ok(Spawn.RULES.ghast(0, 61, 0, 'natural', () => 1) === false, 'rnd(20)=>1 refused');
let asked = 0; Spawn.RULES.ghast(0, 61, 0, 'natural', (n) => { asked = n; return 0; });
ok(asked === 20, 'the roll is nextInt(20), asked ' + asked);

say('\n2. peaceful refuses regardless of the roll');
M.Diff.set('peaceful');
ok(Spawn.RULES.ghast(0, 61, 0, 'natural', () => 0) === false, 'peaceful + rnd 0 refused');
M.Diff.set('normal');

say('\n3. anti-vacuity');
{
  const saved = Spawn.RULES.ghast;
  Spawn.RULES.ghast = (x, y, z, reason) => saved(x, y, z, reason, () => 0);   // roll dropped
  okAv(rate(attempt) > 0.9, 'a roll-less ghast rule passes ~100% -- the 4..6% band catches it');
  Spawn.RULES.ghast = (x, y, z, reason, rnd) => rnd(20) === 0;               // peaceful gate dropped
  M.Diff.set('peaceful');
  okAv(Spawn.RULES.ghast(0, 61, 0, 'natural', () => 0) === true, 'a difficulty-blind rule accepts on peaceful -- §2 catches it');
  M.Diff.set('normal');
  Spawn.RULES.ghast = saved;
  ok(rate(attempt) < 0.06, 'restored');
}

say(`\n${pass} ok, ${fails.length} failed`);
say(` assertions passed .. ${pass}`);
say(` failures ........... ${fails.length}`);
if (fails.length) { fails.forEach((f) => say('  ✗ ' + f)); process.exit(1); }
