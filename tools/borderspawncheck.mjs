#!/usr/bin/env node
// borderspawncheck.mjs — #645: GhastEntity.canSpawn (.decomp:115-117) = !peaceful && nextInt(20)==0 && canMobSpawn.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

const VERBOSE = process.argv.includes('--verbose');
let pass = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => console.log(...a);

say('borderspawncheck — #8311, natural spawns respect the world border');

const EXTRA = ['02f_tags.js', '07_world.js', '08_lighting.js', '07b_behaviour.js',
               '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js',
               '07l_spawn.js', '07c_blockentity.js', '09b_sky.js', '14j_combat.js',
               '07w_passive.js', '14c_raycast.js', '07zf_bat.js'];
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

let PLAINS = 0; for (let i = 0; i < M.Biomes.count; i++) if (M.Biomes.name(i).endsWith(":plains")) PLAINS = i;
const SEED = 3;
W.init(SEED); M.Gen.init(SEED, M.Gen.defaults());
L.init();
M.Behave.init(W);
M.EntityList.init(); M.Ai.init(); if (M.Passive && M.Passive.init) M.Passive.init(); if (M.Bat && M.Bat.init) M.Bat.init();
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
  c.state = CH.GENERATED; c.biome = new Uint8Array(256).fill(PLAINS);
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
    const gx = cx * 16 + x, gz = cz * 16 + z;
    W.setBlock(gx, 60, gz, GRASS); c.hmap[z * 16 + x] = 60 - CFG.WORLD_MIN_Y;
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
  c.state = CH.GENERATED; c.biome = new Uint8Array(256).fill(PLAINS);
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
    const gx = cx * 16 + x, gz = cz * 16 + z;
    W.setBlock(gx, 60, gz, GRASS); c.hmap[z * 16 + x] = 60 - CFG.WORLD_MIN_Y;
    W.setLight(gx, CFG.WORLD_MAX_Y - 1, gz, (15 << 4) | 0);
    L.seed(gx, CFG.WORLD_MAX_Y - 1, gz, 15, L.SKY);
  }
  L.queueBorder(cx, cz);
}
ok(L.settle(4000), 'the lit grass platform settled');



let st = 8311;
const next = () => { st = (st + 0x6D2B79F5) | 0; let t = Math.imul(st ^ (st >>> 15), 1 | st); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const rng = { nextInt: (n) => n === 127 ? 125 : Math.floor(next() * n), nextFloat: () => next() };
M.Player = { x: -20.5, y: 61, z: -20.5 }; W.camCx = 0; W.camCz = 0;
const outside = (e) => Math.abs(e.x) >= 16 || Math.abs(e.z) >= 16;
M.Spawn.ready = false;
const run = () => {
  let made = 0, out = 0;
  for (let i = 0; i < 2000; i++) {
    const cx = (i % 3) - 1, cz = (Math.floor(i / 3) % 3) - 1;
    const before = M.EntityList.list ? M.EntityList.list.length : 0;
    made += Spawn.spawnForChunk(cx, cz, 'creature', { rng });
  }
  const all = M.EntityList.list || [];
  for (const e of all) if (e && e.x !== undefined && outside(e)) out++;
  return { made, out };
};
W.border.setSize(32); W.border.centerX = 0; W.border.centerZ = 0;
say('\n1. border of 32: nothing spawns outside');
const a = run();
ok(a.made > 0, 'something spawned inside (' + a.made + ')');
ok(a.out === 0, a.out + ' spawned outside the border');
say('\n2. anti-vacuity: no border, some spawn outside');
M.EntityList.clear();
W.border.setSize(59999968);
W.border.setSize(32);
const saved = W.border.contains;
W.border.contains = () => true;
const b = run();
okAv(b.out > 0, 'with the contains test removed ' + b.out + ' spawned outside');
W.border.contains = saved;
say(`\n${pass} ok, ${fails.length} failed`);
say(` assertions passed .. ${pass}`);
say(` failures ........... ${fails.length}`);
if (fails.length) { fails.forEach((f) => say('  ✗ ' + f)); process.exit(1); }
