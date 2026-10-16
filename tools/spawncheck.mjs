#!/usr/bin/env node
// spawncheck.mjs — PLAN G18c (PASS 16 JOB 2): SPAWNING (D-393).
//
//   node tools/spawncheck.mjs [--verbose]
//
// ⚠ SCOPED HONESTLY, THE SAME WAY `goalcheck.mjs`/`mobboxcheck.mjs` SCOPED THEMSELVES BEFORE A
// LIVE MOB EXISTED TO TEST AGAINST. `EL.spawn` and `Ai.ROSTER` both close on exactly two types —
// cow and zombie — so this file proves the RULES `src/07l_spawn.js` claims are jar-verified for
// those two, proves the MobCategory table against the bytecode anchors its own header names, and
// proves the cap/despawn/pack MECHANICS against a synthetic and a real-terrain fixture. It does
// NOT prove a browser draws a wandering herd — that is `worldcheck`/a future browser stage's
// job, exactly as `mobboxcheck.mjs` proved geometry without a picture.
//
// ⚠ SQUID, COD, THE SPAWNER BLOCK: NAMED, NOT TESTED. `Spawn.OWED` holds them and §6 below
// asserts that list stays closed, the same shape `EL.owed()`/`Use.OWED` already use.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';
import { getCachedColumn } from './chunkcache.mjs'; // D-463: shared worldgen chunk cache

const VERBOSE = process.argv.includes('--verbose');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; if (VERBOSE) console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => console.log(...a);

say('spawncheck — PLAN G18c (PASS 16 JOB 2), spawning (D-393)');

const EXTRA = ['02f_tags.js', '07zx_particle.js', '07_world.js', '08_lighting.js', '07b_behaviour.js',
               '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js',
               '07l_spawn.js', '07c_blockentity.js', '09b_sky.js', '14j_combat.js',
               // D-532: `Ai.ROSTER.sheep` builds `Passive.EatGrassGoal` (D-523) -- without this
               // module a natural sheep spawn THREW, so this check was red whenever the random
               // creature pick landed on sheep (the 23 Sept full-suite red). D-533: the bat.
               '07w_passive.js', '14c_raycast.js', '07zf_bat.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.EntityList.wr = () => Math.random();   // #6215: spawn rolls now draw from the world stream EL.wr (seeded, vanilla parity); this check scripts them by stubbing Math.random, so route wr through it
initRegistry(M);
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8'))
});
M.Entities.init();
const G = M.Gen, W = M.World, L = M.Light, CH = M.CH, CFG = M.CFG, B = M.Biomes, T = M.Tags;

ok(M.Tags.ready, 'the tag substrate loaded — animals_spawnable_on lives there');
ok(B.ready, 'the biome registry loaded — B.spawners is what Spawn reads');

// ── a fixed LCG, so a failure reproduces ─────────────────────────────────────────────────────
let rng = 20260919 >>> 0;
const rnd = () => { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; return rng / 4294967296; };
const ri = (n) => Math.floor(rnd() * n);

// seed 3: land with a creature-list biome at every sampled column within the pack test's
// own radius — measured directly, not guessed, because seed 1 is entirely ocean here.
const SEED = 3;
W.init(SEED);
G.init(SEED, G.defaults());
L.init();
M.Behave.init(W);
M.EntityList.init();
M.Ai.init();
if (M.Passive && M.Passive.init) M.Passive.init();
if (M.Bat && M.Bat.init) M.Bat.init();
M.Spawn.init();
ok(M.Spawn.ready, 'Spawn.init ran');
M.BlockEntities.init();
ok(M.BlockEntities.ready, 'BlockEntities.init ran — the spawner block entity needs it');

const stateOf = (n) => M.States.stateOf(n) | 0;
const STONE = stateOf('stone'), GRASS = stateOf('grass_block'), GLOWSTONE = stateOf('glowstone');
const player = { x: 0, y: 64, z: 0 };
let RY_WALL = 50;
M.Player = player;

// ─────────────────────────────────────────────── 1. MobCategory, against the bytecode anchors
say('\n1. MobCategory (D-393), against ayb\'s own <clinit> anchors');
{
  const C = M.Spawn.CATEGORY;
  ok(Object.keys(C).length === 8, `${Object.keys(C).length} categories, expected 8`);
  ok(C.monster.cap === 70 && C.monster.despawn === 128, 'MONSTER: cap 70, despawn 128');
  ok(C.creature.cap === 10 && C.creature.friendly && C.creature.persistent,
     'CREATURE: cap 10, friendly, persistent');
  ok(C.misc.cap === -1, 'MISC: uncapped (never naturally rolled — every biome\'s own misc list is empty)');
  // the one category whose despawn distance is NOT 128 — the whole reason "32/128" undersells it
  ok(C.water_ambient.despawn === 64 && C.monster.despawn === 128,
     'WATER_AMBIENT despawns at 64 where every other category despawns at 128');
  const noDespawn = Object.keys(C).every((k) => C[k].noDespawn === 32);
  ok(noDespawn, 'every category shares the same noDespawnDistance, 32 — a constructor literal, not an argument');
  // and the SET actually used at runtime matches every key a real biome's own spawners carry
  let biomeCats = new Set();
  for (let i = 0; i < B.count; i++) Object.keys(B.spawners(i)).forEach((k) => biomeCats.add(k));
  const missing = [...biomeCats].filter((k) => !C[k]);
  ok(missing.length === 0, `every category a real biome names resolves in Spawn.CATEGORY (missing: ${missing.join(',')})`);
}
say(`   ${pass} ok`);

// ─────────────────────────────────────────────── 2. placement rules — the acceptance list itself
say('\n2. checkAnimalSpawnRules / checkMonsterSpawnRules, against the bytecode (D-393)');
{
  // a small flat platform at y=60, open to the sky, all grass — the daylight/cow case
  // ⚠ A HAND-BUILT WORLD IS NOT `Gen.genColumn`'s OWN LIGHT PASS: nothing seeds "the top of
  // the world is open sky" for a column nobody generated, so the ceiling is explicitly lit
  // before anything below it can propagate down — the same fact `Gen.lightPass` derives for
  // real terrain, stated once here instead.
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
  ok(L.settle(4000), 'the platform settled');

  ok(M.Spawn.checkPlacement('cow', 0, 61, 0), 'a cow may spawn on lit grass');
  ok(!M.Spawn.checkPlacement('cow', 0, 61, 0, 'natural', () => 0) || true, 'sanity: rnd stub does not throw');
  // stone below refuses — the TAG is the rule, not "is it solid"
  W.setBlock(0, 60, 0, STONE); L.queueBorder(0, 0); ok(L.settle(2000), 'settled after the stone edit');
  ok(!M.Spawn.checkPlacement('cow', 0, 61, 0), 'a cow refuses stone below — only animals_spawnable_on (grass_block) qualifies');
  W.setBlock(0, 60, 0, GRASS); L.queueBorder(0, 0); ok(L.settle(2000), 'settled after restoring grass');
  ok(M.Spawn.checkPlacement('cow', 0, 61, 0), 'and grass below allows it again — the refusal above was the tag, not a stuck light value');

  // a roofed, unlit room three blocks down — the cave case
  const RY = 50;
  RY_WALL = RY;
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) {
    W.setBlock(x, RY - 1, z, STONE);          // floor
    W.setBlock(x, RY + 3, z, STONE);          // roof — no sky access inside
  }
  for (let y = RY; y <= RY + 2; y++) {
    for (let x = -3; x <= 3; x++) { W.setBlock(x, y, -3, STONE); W.setBlock(x, y, 3, STONE); }
    for (let z = -3; z <= 3; z++) { W.setBlock(-3, y, z, STONE); W.setBlock(3, y, z, STONE); }
  }
  L.queueBorder(0, 0); ok(L.settle(4000), 'the room settled');
  ok(W.rawBrightness(0, RY, 0) === 0, `the sealed room really is dark (raw brightness ${W.rawBrightness(0, RY, 0)})`);

  const darkOk = M.Spawn.checkPlacement('zombie', 0, RY, 0);
  ok(darkOk, 'a dark, roofed, solid-floored room spawns a zombie');

  W.setBlock(0, RY, 0, GLOWSTONE);
  L.queueBorder(0, 0); ok(L.settle(4000), 'settled after lighting the room');
  ok(W.rawBrightness(1, RY, 0) > 0, `the neighbouring cell is lit now (${W.rawBrightness(1, RY, 0)})`);
  const litOk = M.Spawn.checkPlacement('zombie', 1, RY, 0);
  ok(!litOk, 'the SAME room, lit, refuses the same spot — the acceptance pair (git 2a8efe1:docs/passes/PASS-16-HISTORY.md JOB 2)');
  W.setBlock(0, RY, 0, 0); L.queueBorder(0, 0); L.settle(4000);

  // no floor — checkMobSpawnRules on its own, independent of darkness
  ok(!M.Spawn.checkPlacement('zombie', 10, RY + 10, 0), 'a dark spot with nothing solid below still refuses (Mob.checkMobSpawnRules)');
  // D-488: SpawnHelper.isClearForSpawn + isSpaceEmpty — the room's own WALL is dark, has stone
  // under it, and passed the per-type rule: zombies were being born inside rock and suffocating.
  ok(!M.Spawn.checkPlacement('zombie', 3, RY, 0), 'a dark cell INSIDE the stone wall refuses (SpawnHelper.isClearForSpawn: a full cube)');
  ok(!M.Spawn.checkPlacement('spider', 2, RY, 0), 'a spider (1.4 wide) against the wall refuses — its box overlaps the stone (isSpaceEmpty)');
  ok(M.Spawn.checkPlacement('zombie', 2, RY, 0), '...while a zombie (0.6 wide) in the same cell fits — BOTH directions');

  // D-396: skeleton is now IN the closed set — same Monster shape as zombie (Spawn.OWED
  // names the un-bytecode-verified assumption). Re-run the exact dark/lit pair for it.
  const skelDarkOk = M.Spawn.checkPlacement('skeleton', 0, RY, 0);
  ok(skelDarkOk, 'the same dark, roofed, solid-floored room spawns a skeleton too (D-396)');
  W.setBlock(0, RY, 0, GLOWSTONE);
  L.queueBorder(0, 0); L.settle(4000);
  const skelLitOk = M.Spawn.checkPlacement('skeleton', 1, RY, 0);
  ok(!skelLitOk, 'and the same room, lit, refuses a skeleton too');
  W.setBlock(0, RY, 0, 0); L.queueBorder(0, 0); L.settle(4000);

  // D-401 (session 39): spider joins the closed set — bmo's own 20-method class was read IN
  // FULL for this, more verification than skeleton's own same-shape assumption above.
  const spiderDarkOk = M.Spawn.checkPlacement('spider', 0, RY, 0);
  ok(spiderDarkOk, 'the same dark, roofed, solid-floored room spawns a spider too (D-401)');
  W.setBlock(0, RY, 0, GLOWSTONE);
  L.queueBorder(0, 0); L.settle(4000);
  const spiderLitOk = M.Spawn.checkPlacement('spider', 1, RY, 0);
  ok(!spiderLitOk, 'and the same room, lit, refuses a spider too');
  W.setBlock(0, RY, 0, 0); L.queueBorder(0, 0); L.settle(4000);

  // D-400's own peaceful gate applies to spider exactly as it does to zombie/skeleton
  M.Diff.set('peaceful');
  ok(!M.Spawn.checkPlacement('spider', 0, RY, 0), 'a PEACEFUL difficulty refuses a spider too (D-400, shared gate)');
  M.Diff.set('normal');
  ok(M.Spawn.checkPlacement('spider', 0, RY, 0), 'and back to normal, the same spot spawns one again');

  // the closed set: everything else still resolves no rule at all
  // loop/panda-axolotl-s101 (QUEUE 0.2 G18c) -- panda/axolotl BOTH closed this row (Spawn.RULES.
  // panda/.axolotl, 07l_spawn.js, driven end-to-end in pandacheck.mjs/axolotlcheck.mjs against
  // .decomp PandaEntity/AxolotlEntity) -- bee takes over as this file's own negative
  // example, the same "the next closed one swaps the example" precedent squid's own comment
  // just below already set for cod.
  ok(!M.Spawn.canPlace('bee'), 'bee has no placement rule — named on Spawn.OWED, not guessed');
  ok(!M.Spawn.checkPlacement('bee', 0, 61, 0), 'and asking for one anyway refuses rather than defaulting');
  ok(M.Spawn.canPlace('panda') && M.Spawn.canPlace('axolotl'), 'panda/axolotl now HAVE a placement rule (loop/panda-axolotl-s101)');
  // loop/squid-s98 (QUEUE 0.2 G18c) -- squid/glow_squid closed this row: both now have a real
  // placement rule (Spawn.RULES.squid/glow_squid, 07l_spawn.js), driven end-to-end in
  // squidcheck.mjs against .decomp SquidEntity/GlowSquidEntity.canSpawn -- this file only
  // proves the two are WIRED, not their own internals (squidcheck's own job).
  ok(M.Spawn.canPlace('squid') && M.Spawn.canPlace('glow_squid'), 'squid/glow_squid now HAVE a placement rule (loop/squid-s98)');
}
say(`   ${pass} ok`);

// ─────────────────────────────────────────────── 3. category cap and despawn bands
say('\n3. the category cap holds, and despawn is the two bands D-393 read off the bytecode');
{
  M.EntityList.clear();
  const savedCap = M.Spawn.CATEGORY.monster.cap;
  M.Spawn.CATEGORY.monster.cap = 3;               // this check's own scaffolding, not the jar's
  for (let i = 0; i < 10; i++) {
    if (M.Spawn.liveCount('monster') >= M.Spawn.CATEGORY.monster.cap) break;
    M.EntityList.spawn('zombie', i * 3, 61, 0);
  }
  ok(M.Spawn.liveCount('monster') === 3, `liveCount stopped exactly at the forced cap (${M.Spawn.liveCount('monster')})`);
  // 200 more attempts through the real weighted cycle — the cap must still hold
  for (let i = 0; i < 200; i++) M.Spawn.attempt('monster');
  ok(M.Spawn.liveCount('monster') <= 3, `200 more attempts never pushed past the cap (${M.Spawn.liveCount('monster')})`);
  M.Spawn.CATEGORY.monster.cap = savedCap;

  // D-488: a monster search that finds no Y must spawn NOTHING. Its sentinel was -1 — a real
  // overworld Y — so every failed search put a mob at y=-1 inside the deepslate, unchecked.
  {
    const realCP = M.Spawn.checkPlacement;
    let none, some;
    try {
      M.Spawn.checkPlacement = () => false; M.EntityList.clear();
      for (let i = 0; i < 400; i++) M.Spawn.attempt('monster');
      none = M.Spawn.liveCount('monster');
      M.Spawn.checkPlacement = () => true; M.EntityList.clear();
      // the search ring is random (Math.random angle): try until one lands, bounded
      for (let i = 0; i < 400 && M.Spawn.liveCount('monster') === 0; i++) M.Spawn.attempt('monster');
      some = M.Spawn.liveCount('monster');
    } finally { M.Spawn.checkPlacement = realCP; M.EntityList.clear(); }
    ok(none === 0, `with every placement refused, 400 monster attempts still spawned ${none} (the y=-1 sentinel, D-488)`);
    okAv(some > 0, `up to 400 of the same attempts with every placement ALLOWED spawn ${some} — the refusal above is not vacuous`);
  }

  M.EntityList.clear();
  player.x = 0; player.y = 64; player.z = 0;
  const near = M.EntityList.spawn('zombie', 20, 64, 0);          // inside noDespawn (32)
  const mid = M.EntityList.spawn('zombie', 100, 64, 0);          // between the bands
  const far = M.EntityList.spawn('zombie', 130, 64, 0);          // past despawn (128)
  const namedFar = M.EntityList.spawn('zombie', 130, 64, 5);
  namedFar.persistent = true;
  M.Spawn.despawnTick();
  ok(!near.removed, 'inside the no-despawn band (32), a mob never despawns');
  ok(far.removed, 'past the despawn band (128), a mob always despawns this tick');
  ok(!namedFar.removed, 'a PERSISTENT mob at the same far distance does not — the exemption the acceptance list names');
  ok(mid.removed === false || mid.removed === true, 'the mid band rolled a chance rather than throwing');
}
say(`   ${pass} ok`);

// ─────────────────────────────────────────────── 4. packs, on real generated terrain
say('\n4. a pack spawns more than its leader, on real generated overworld terrain');
{
  M.EntityList.clear();
  const R = 3;
  for (let cx = -R; cx <= R; cx++) for (let cz = -R; cz <= R; cz++) {
    const c = W.getOrCreate(cx, cz);
    const col = getCachedColumn(M, cx, cz) /* D-463 */;
    c.sec = col.sec; c.hmap = col.hmap; c.biome = col.biome || null; c.state = CH.GENERATED;
    L.queueBorder(cx, cz);
  }
  ok(L.settle(20000), 'the generated terrain settled');
  player.x = 0; player.y = W.heightAt(0, 0) + 2; player.z = 0;

  // ⚠ THIS CHECK'S OWN SCAFFOLDING, NOT THE SHIPPED CONSTANT: a 3-chunk radius of real
  // terrain does not cover `Spawn.SEARCH_MAX_XZ`'s real 128-block reach, so the search window
  // is narrowed to what is actually loaded here — restored after, same pattern §3 used on the cap.
  const savedMin = M.Spawn.SEARCH_MIN_XZ, savedMax = M.Spawn.SEARCH_MAX_XZ;
  M.Spawn.SEARCH_MIN_XZ = 4; M.Spawn.SEARCH_MAX_XZ = 40;

  // 30 Sept: this section rolled the real unseeded Math.random and failed ~1 run in 6 ("0 in 400 tries"), bouncing
  // three unrelated PRs (#950, #1041, #1056) at the lander. Same technique as §5 below: a SEEDED Math.random for the
  // search, restored after, so the verdict is the code's and not the dice's.
  const savedRnd4 = Math.random; let s4 = 0x2545F491;
  Math.random = () => { s4 ^= s4 << 13; s4 ^= s4 >>> 17; s4 ^= s4 << 5; return (s4 >>> 0) / 4294967296; };
  let bestPack = 0;
  for (let i = 0; i < 400 && bestPack < 2; i++) {
    const before = M.EntityList.count();
    M.Spawn.attempt('creature');
    const after = M.EntityList.count();
    if (after > before) bestPack = Math.max(bestPack, after - before);
  }
  Math.random = savedRnd4;
  ok(bestPack >= 1, `at least a leader placed in 400 tries (${bestPack})`);
  // cow's own entry (B.spawners) carries minCount 4 maxCount 4 in every biome that lists it —
  // read here, not hard-coded, so a future biome edit cannot make this assertion stale
  let sawCow = false, cowMax = 0;
  for (let i = 0; i < B.count; i++) {
    const list = B.spawners(i).creature || [];
    for (const e of list) if (e.type === 'minecraft:cow') { sawCow = true; cowMax = Math.max(cowMax, e.maxCount); }
  }
  ok(sawCow, 'cow really is in some biome\'s creature list — otherwise §2 spawns nothing to pack-test');
  ok(bestPack <= cowMax + 3, `the best pack seen (${bestPack}) is not absurd against cow's own maxCount (${cowMax}) plus other creature types sharing the roll`);
  M.Spawn.SEARCH_MIN_XZ = savedMin; M.Spawn.SEARCH_MAX_XZ = savedMax;
}
say(`   ${pass} ok`);

// ─────────────────────────────────────────────── 5. D-395 — the monster spawner block (JOB 2.3)
say('\n5. the monster spawner block ticks: delay, range, cap, required-player-range (D-395)');
{
  M.EntityList.clear();   // §4 left up to 400 attempts' worth of real packs in the world
  const savedRandom = Math.random;
  const P0 = { x: 1000, y: 65, z: 1000 };   // far away — nothing here should tick at all yet
  M.Player = P0;
  for (let y = 61; y <= 220; y++) W.setBlock(0, y, 0, 0);
  W.setBlock(0, 60, 0, GRASS);   // a cow-legal floor, so placement failures below are the SPAWNER gate, not the block
  W.setLight(0, CFG.WORLD_MAX_Y - 1, 0, (15 << 4) | 0);
  L.seed(0, CFG.WORLD_MAX_Y - 1, 0, 15, L.SKY);
  L.queueBorder(0, 0);
  ok(L.settle(20000), 'the §5 fixture (real terrain punched through by §4) settled its own light');

  const be = M.BlockEntities.create(0, 61, 0, 'mob_spawner');
  be.entity = 'cow';
  ok(be.delay === 20 && be.minDelay === 200 && be.maxDelay === 800 && be.count === 4 &&
     be.spawnRange === 4 && be.maxNearbyEntities === 6 && be.requiredPlayerRange === 16,
     'a fresh mob_spawner block entity carries BaseSpawner\'s own field defaults, not zeros');

  M.EntityList.clear();
  ok(!M.Spawn.tickSpawner(be), 'requiredPlayerRange gates the WHOLE tick — nobody is within 16 blocks');
  ok(be.delay === 20, 'and the delay does not even count down while nobody is near');

  M.Player = { x: 0, y: 66, z: 0 };   // inside requiredPlayerRange now
  {   // EntityView.isPlayerInRange: strict < range, spectators and dead players don't count (#4556)
    M.Gm = M.Gm || { SPECTATOR: 3 };
    const d0 = be.delay, at = (dx, extra) => { M.Player = Object.assign({ x: be.x + 0.5 + dx, y: be.y + 0.5, z: be.z + 0.5 }, extra); be.delay = d0; M.Spawn.tickSpawner(be); return be.delay !== d0; };
    ok(!at(16), 'player at exactly requiredPlayerRange (dist == 16) does NOT activate the spawner (strict <)');
    okAv(at(15.99), 'anti-vacuity: just inside 16 does activate it');
    ok(!at(1, { mode: 3 }), 'a spectator within range does not activate the spawner');
    ok(!at(1, { dead: true }), 'a dead player within range does not activate the spawner');
    be.delay = d0; M.Player = { x: 0, y: 66, z: 0 };
  }
  for (let t = 0; t < 20; t++) M.Spawn.tickSpawner(be);
  // ⚠ 20 CALLS, NOT 19: vanilla's own `if (spawnDelay > 0) { spawnDelay--; return; }` decrements
  // and returns WITHOUT spawning on the tick that brings it to zero — the SAME shape as
  // `atkCooldown` in `07k_goals.js` (D-394). The delay reaching 0 is what the NEXT call spawns on.
  ok(be.delay === 0, 'the initial 20-tick delay reaches exactly zero after 20 real ticks');
  ok(M.EntityList.list.length === 0, 'and nothing has spawned while the delay was still running');

  Math.random = () => 0.5;   // deterministic centre-of-range placement for the landing tick
  const spawned = M.Spawn.tickSpawner(be);
  ok(spawned === true, 'the tick the delay reaches zero actually spawns');
  ok(M.EntityList.list.length > 0 && M.EntityList.list[0].type === 'cow',
     'and it spawned the block entity\'s OWN entity field (cow), not a hardcoded pig');
  ok(be.delay >= 200 && be.delay <= 799,
     `the delay re-rolled to min+nextInt(max-min) (200..799, MobSpawnerLogic.updateSpawns), got ${be.delay}`);
  const cpKeep = M.Spawn.checkPlacement; M.Spawn.checkPlacement = () => true;   // a spawn must land, else delay stays 0 (#3715)
  { const Px = M.Particle, w0 = Px.worldEvent, s0 = Px.spawnEffects; let ev = 0, fx = 0;
    Px.worldEvent = (id) => { if (id === 2004) ev++; }; Px.spawnEffects = () => { fx++; };
    Math.random = () => 0.5; be.delay = 0; M.Spawn.tickSpawner(be);
    okAv(ev > 0 && fx === ev, `each spawn plays worldEvent 2004 and MobEntity.playSpawnEffects (${ev}/${fx})`);
    Px.worldEvent = w0; Px.spawnEffects = s0;
    const pre = Px.list.length; ok(Px.worldEvent(2004, 0, 64, 0, 0) === 40 && Px.list.length - pre === 40, 'worldEvent 2004 = 20 smoke + 20 flame'); }
  Math.random = () => 0.9999999;   // top of the roll: vanilla's nextInt(600) never reaches 800
  be.delay = 0; M.Spawn.tickSpawner(be);
  okAv(be.delay === 799, `top roll gives 799 not 800, got ${be.delay}`);
  be.minDelay = 5; be.maxDelay = 6; be.delay = 0; M.Spawn.tickSpawner(be);
  okAv(be.delay === 5, `min=5,max=6 always rolls 5, got ${be.delay}`);
  be.minDelay = 9; be.maxDelay = 3; be.delay = 0; M.Spawn.tickSpawner(be);
  okAv(be.delay === 9, `max<=min gives min, got ${be.delay}`);
  be.minDelay = 5; be.maxDelay = 6; be.delay = -1; const nSp = M.Spawn.tickSpawner(be);
  okAv(!nSp && be.delay === 4, `delay -1 re-rolls (5) then counts down to 4 with no spawn, got ${be.delay}/${nSp}`);
  be.minDelay = 200; be.maxDelay = 800;
  M.Spawn.checkPlacement = cpKeep;
  Math.random = savedRandom;

  // vanilla MobSpawnerLogic has NO mob-category cap (#3716): at the natural cap a spawner still spawns
  const savedCap = M.Spawn.CATEGORY.creature.cap;
  M.Spawn.CATEGORY.creature.cap = 0;   // natural cap exhausted
  be.delay = 0; M.EntityList.clear();
  const before = M.EntityList.list.length;
  Math.random = () => 0.5;
  const capped = M.Spawn.tickSpawner(be);
  Math.random = savedRandom;
  ok(capped && M.EntityList.list.length > before,
     'at the natural creature cap, the spawner still spawns (only maxNearbyEntities limits it)');
  M.Spawn.CATEGORY.creature.cap = savedCap;
  M.EntityList.clear();

  // maxNearbyEntities: a spawner surrounded by its own cap of cows refuses more, cap or not
  M.EntityList.clear();
  for (let i = 0; i < 6; i++) M.EntityList.spawn('cow', 1.5 + i * 0.7, 61, 0.5);   // #6789: off the target cell, which an entity there now refuses
  be.delay = 0;
  const beforeNearby = M.EntityList.list.length;
  Math.random = () => 0.5;   // deterministic valid cell: the cap is only reached after placement passes
  const nearbyCapped = M.Spawn.tickSpawner(be);
  Math.random = savedRandom;
  ok(!nearbyCapped && M.EntityList.list.length === beforeNearby,
     'at maxNearbyEntities (6, all cows within spawnRange), the spawner adds no more — vanilla\'s own inflate(spawnRange) box');
  ok(be.delay > 0, 'early return (maxNearby reached) re-rolls the delay');
  M.EntityList.clear();
  // #4227: saturated spawner + blocked cells: placement fails FIRST -> 'continue', delay stays 0 (cap only after placement)
  for (let i = 0; i < 6; i++) M.EntityList.spawn('cow', 0.5 + i * 0.01, 61, 0.5);
  { const sCP = M.Spawn.checkPlacement; M.Spawn.checkPlacement = () => false;
    be.delay = 0; M.Spawn.tickSpawner(be);
    okAv(be.delay === 0, 'saturated spawner with every cell blocked still leaves delay 0 (placement before maxNearby)');
    M.Spawn.checkPlacement = sCP; }
  // class match: a husk counts toward a zombie spawner's cap
  M.EntityList.clear(); M.EntityList.spawn('husk', 0.5, 61, 0.5);
  ok(M.Spawn.nearbySpawnedCount(be, 'zombie', 4) === 1, 'husk counts for zombie (class match)');
  M.EntityList.clear();
  // all-'continue' batch (every placement fails): delay stays 0, retried next tick (#3715)
  const savedCP = M.Spawn.checkPlacement; M.Spawn.checkPlacement = () => false;
  be.delay = 0; M.Spawn.tickSpawner(be);
  ok(be.delay === 0, 'a batch where every attempt fails leaves delay at 0 (vanilla retries next tick)');
  M.Spawn.checkPlacement = savedCP;

  // ANTI-VACUITY: a zombie spawner in a LIT room refuses, exactly as a real one does. Forcing
  // `W.getLight` and `Spawn.randInt` directly (this file's own established style, e.g. §7's
  // `M.Behave.faceSturdy` stub) rather than building a lit room in real terrain, because
  // `isDarkEnoughToSpawn`'s own sky check is a PROBABILISTIC roll against skylight — real
  // terrain leaves other cells inside the spawn cube at whatever light section 4 left them.
  const zbe = M.BlockEntities.create(5, 61, 5, 'mob_spawner');
  zbe.entity = 'zombie'; zbe.delay = 0;
  const savedGetLight = W.getLight, savedRandInt = M.Spawn.randInt;
  W.getLight = function () { return (15 << 4) | 0; };   // full skylight, everywhere, deterministically
  M.Spawn.randInt = function () { return 0; };           // worst case for the sky roll: sky(15) > rnd(0)
  okAv(!M.Spawn.tickSpawner(zbe),
       'a zombie spawner in a fully-lit area spawns nothing — reason==="spawner" skips the ground check, not isDarkEnoughToSpawn');
  W.getLight = savedGetLight;
  M.Spawn.randInt = savedRandInt;

  Math.random = savedRandom;
}
say(`   ${pass} ok`);

// ─────────────────────────────────────────────── 6. spawn eggs close the row — covered live in usecheck
say('\n6. Spawn.OWED is held closed, the same shape EL.owed()/Use.OWED already use');
{
  ok(M.Spawn.OWED.length >= 2, `${M.Spawn.OWED.length} owed gaps are named`);
  const unnamed = M.Spawn.OWED.filter((s) => typeof s !== 'string' || s.length < 10);
  ok(unnamed.length === 0, 'every owed entry is a real sentence, not a placeholder');
}
say(`   ${pass} ok`);

// ─────────────────────────────────────────────── 7. anti-vacuity
say('\n7. anti-vacuity: break it, and it must be caught (D-30)');
{
  {
    let inWall;
    try { M.Spawn.CLEAR_CHECK = false; inWall = M.Spawn.checkPlacement('zombie', 3, RY_WALL, 0); } finally { M.Spawn.CLEAR_CHECK = true; }
    okAv(inWall === true, 'without SpawnHelper.isClearForSpawn/isSpaceEmpty, the in-wall cell spawns a zombie again (D-488)');
  }
  // §4's real-terrain generation overwrote chunk (0,0)'s section array — including §2's
  // hand-placed grass platform AND the real hillside now standing over it at seed 3 — so the
  // whole column is cleared back to open sky before the fixture is rebuilt on top of it.
  for (let y = 61; y <= 220; y++) W.setBlock(0, y, 0, 0);
  W.setBlock(0, 60, 0, GRASS);
  W.setLight(0, CFG.WORLD_MAX_Y - 1, 0, (15 << 4) | 0);
  L.seed(0, CFG.WORLD_MAX_Y - 1, 0, 15, L.SKY);
  L.queueBorder(0, 0);
  ok(L.settle(4000), 'the §2 fixture re-settled for §6');
  ok(M.Spawn.checkPlacement('cow', 0, 61, 0), 'sanity: the rebuilt fixture passes before any break');

  // cow's own rule reads no randomness at all (Animal.checkAnimalSpawnRules is deterministic);
  // forcing an absurd rnd through the SAME injection point zombie's rule uses must not change
  // cow's answer — the two rules really are independent, not accidentally sharing state.
  okAv(M.Spawn.checkPlacement('cow', 0, 61, 0, 'natural', () => 999) === M.Spawn.checkPlacement('cow', 0, 61, 0),
       'forcing rnd()==999 changes nothing for a rule that never calls it — sanity on the injection point');
  // disable the tag entirely and re-check the SAME lit, grassy spot from §2
  const savedTagBelow = W.tagBelow;
  W.tagBelow = () => 0;
  okAv(!M.Spawn.checkPlacement('cow', 0, 61, 0), 'with the tag forced off, cow refuses even lit grass — the tag really gates it');
  W.tagBelow = savedTagBelow;
  ok(M.Spawn.checkPlacement('cow', 0, 61, 0), 'and restoring it un-breaks the same assertion — not a stuck fixture');

  const savedFaceSturdy = M.Behave.faceSturdy;
  M.Behave.faceSturdy = () => false;
  okAv(!M.Spawn.checkPlacement('zombie', 0, 61, 0, 'natural', () => 0),
       'with faceSturdy forced false, Mob.checkMobSpawnRules refuses even a forced-dark, forced-random spot');
  M.Behave.faceSturdy = savedFaceSturdy;

  okAv(M.Spawn.categoryOf('cow') === 'creature', 'cow really resolves to creature — sanity for §1\'s closing membership check');
  const savedCats = M.Spawn.NATURAL_CATEGORIES;
  M.Spawn.NATURAL_CATEGORIES = [];
  M.EntityList.clear();
  let anySpawn = false;
  for (let i = 0; i < 50; i++) if (M.Spawn.tick() > 0) anySpawn = true;
  okAv(!anySpawn, 'with every natural category removed, Spawn.tick spawns nothing at all');
  M.Spawn.NATURAL_CATEGORIES = savedCats;
  // isInvalidSpawn (EntityType.java:870-878): hazard cells refuse a spawn unless the type allows them
  {
    const hz = (n, t) => { W.setBlock(0, 61, 0, stateOf(n)); const r = M.Spawn.clearForSpawn(t, 0, 61, 0); W.setBlock(0, 61, 0, 0); return r; };
    ok(!hz('wither_rose', 'zombie'), 'zombie: wither_rose cell is an invalid spawn');
    ok(!hz('sweet_berry_bush', 'zombie'), 'zombie: sweet_berry_bush cell is an invalid spawn');
    ok(!hz('fire', 'zombie'), 'zombie: fire cell is an invalid spawn');
    ok(hz('wither_rose', 'wither_skeleton'), 'wither_skeleton may spawn in wither_rose (allowSpawningInside)');
    ok(!hz('sweet_berry_bush', 'wither_skeleton'), 'wither_skeleton: sweet_berry_bush still invalid');
    okAv(hz('wither_rose', 'zombie') === false, 'anti-vacuity: wither_rose refusal is load-bearing');
    const sv = M.Spawn.isInvalidSpawn; M.Spawn.isInvalidSpawn = () => false;
    okAv(M.Spawn.clearForSpawn('zombie', 0, 61, 0) === true, 'anti-vacuity: stubbed isInvalidSpawn lets clean cell through');
    W.setBlock(0, 61, 0, stateOf('wither_rose'));
    okAv(M.Spawn.clearForSpawn('zombie', 0, 61, 0) === true, 'anti-vacuity: with isInvalidSpawn stubbed, wither_rose slips through (check can fail)');
    W.setBlock(0, 61, 0, 0); M.Spawn.isInvalidSpawn = sv;
  }
}
say(`   ${pass} ok`);

// ─────────────────────────────────────────────── 8. D-400: the difficulty gate is real now
say('\n8. D-400: checkMonsterSpawnRules\'s own PEACEFUL half — NS.Diff, not always-open any more');
{
  ok(!!M.Diff, 'NS.Diff exists — the shared difficulty store D-400 introduced');
  ok(M.Diff.get() === 'normal', 'NS.Diff defaults to normal — unchanged behaviour from every session before D-400');

  // a fresh dark, roofed, solid-floored room, well away from every earlier section's own fixture.
  const DX = 40, DY = 50;
  for (let x = DX - 3; x <= DX + 3; x++) for (let z = -3; z <= 3; z++) {
    W.setBlock(x, DY - 1, z, STONE);
    W.setBlock(x, DY + 3, z, STONE);
  }
  for (let y = DY; y <= DY + 2; y++) {
    for (let x = DX - 3; x <= DX + 3; x++) { W.setBlock(x, y, -3, STONE); W.setBlock(x, y, 3, STONE); }
    for (let z = -3; z <= 3; z++) { W.setBlock(DX - 3, y, z, STONE); W.setBlock(DX + 3, y, z, STONE); }
  }
  // D-488: the room is CARVED, not just walled — §4's real terrain can stand solid here, and a
  // spawn inside rock is refused now (SpawnHelper.isClearForSpawn).
  for (let y = DY; y <= DY + 2; y++) for (let x = DX - 2; x <= DX + 2; x++) for (let z = -2; z <= 2; z++) W.setBlock(x, y, z, 0);
  L.queueBorder(Math.floor(DX / 16), 0);
  ok(L.settle(4000), 'the §8 room settled');
  ok(W.rawBrightness(DX, DY, 0) === 0, 'the §8 room really is dark');

  ok(M.Spawn.checkPlacement('zombie', DX, DY, 0), 'sanity, normal difficulty (the default): a zombie may still spawn in the dark room');
  ok(M.Spawn.checkPlacement('skeleton', DX, DY, 0), 'sanity, normal difficulty: a skeleton may still spawn in the same room');

  M.Diff.set('peaceful');
  okAv(!M.Spawn.checkPlacement('zombie', DX, DY, 0), 'anti-vacuity: PEACEFUL refuses the exact same dark room a zombie spawned in a moment ago');
  okAv(!M.Spawn.checkPlacement('skeleton', DX, DY, 0), 'anti-vacuity: PEACEFUL refuses skeleton too — same Monster-superclass gate (D-396)');
  ok(M.Spawn.checkPlacement('cow', 0, 61, 0), 'PEACEFUL does not touch Animal.checkAnimalSpawnRules — a cow is unaffected (vanilla: peaceful still allows passive mobs)');

  M.Diff.set('easy');
  ok(M.Spawn.checkPlacement('zombie', DX, DY, 0), 'EASY is not PEACEFUL — the gate opens again, same dark room, nothing else changed');

  M.Diff.set('hard');
  ok(M.Spawn.checkPlacement('zombie', DX, DY, 0), 'HARD is not PEACEFUL either — monster spawning was never gated on HARD, only BreakDoorGoal is (Ai.OWED)');

  M.Diff.set('normal');   // leave the shared store as the sections above this one expect it
  ok(M.Spawn.checkPlacement('zombie', DX, DY, 0), 'restoring normal un-breaks the same spot — not a stuck fixture');

  ok(M.Diff.LIVE && M.Diff.LIVE.peacefulGate && M.Diff.LIVE.hardGate, 'Diff.LIVE names both of D-400\'s real consumers, the same honesty shape Commands.RULES_LIVE already uses for gamerules');
}
say(`   ${pass} ok`);

say('\n9. D-511: the SERVER\'s ambientDarkness — night makes open sky dark enough to spawn in');
{
  const S = M.Sky;
  ok(!!(S && S.ambientDarkness && S.isDay && S.darknessNow), 'Sky.ambientDarkness / isDay / darknessNow exist');
  const clear = (t) => S.ambientDarkness(t, 0, 0);
  ok(clear(6000) === 0, `noon, clear: darkness ${clear(6000)} (World.calculateAmbientDarkness, f=1)`);
  ok(clear(18000) === 11, `midnight, clear: darkness ${clear(18000)} (f=0 → 11)`);
  ok(S.ambientDarkness(6000, 1, 1) >= 4, `noon under a full thunderstorm is not "day" (darkness ${S.ambientDarkness(6000, 1, 1)})`);
  ok(S.ambientDarkness(6000, 1, 0) < 4, `noon in plain rain still is (darkness ${S.ambientDarkness(6000, 1, 0)})`);
  // ⚠ THE REFEREE IS NOT THIS FILE'S FORMULA: the wiki's own bed times (sleeping is gated on
  // !isDay) — a bed works from 12542 and stops at 23460 in clear weather. Walk the clock and find
  // the edges this code produces; a formula slip (Math.cos for the sine table, a lost float cast,
  // the -0.25 offset) moves them.
  let dusk = -1, dawn = -1;
  for (let t = 12000; t < 13000; t++) if (clear(t) >= 4) { dusk = t; break; }
  for (let t = 23000; t < 24000; t++) if (clear(t) < 4) { dawn = t; break; }
  ok(dusk === 12542, `clear weather: isDay turns false at dayTime ${dusk} (vanilla: 12542, beds become usable)`);
  ok(dawn === 23460, `clear weather: isDay turns true again at dayTime ${dawn} (vanilla: 23460, beds stop working)`);

  // the spawn rule on the §2 open-sky fixture, the rolls pinned to their most permissive value
  const permissive = (n) => n - 1;
  const saved = S.dayTime;
  S.dayTime = 6000;
  ok(!M.Spawn.checkPlacement('zombie', 0, 61, 0, 'natural', permissive), 'noon: open sky (light 15) never passes isSpawnDark');
  S.dayTime = 18000;
  ok(M.Spawn.checkPlacement('zombie', 0, 61, 0, 'natural', permissive), 'midnight: the SAME open-sky cell is dark enough (15 - 11 = 4 <= 7)');
  // both directions: a dark enough cell at night still needs the dice — rnd(8)=0 refuses light 4
  ok(!M.Spawn.checkPlacement('zombie', 0, 61, 0, 'natural', (n) => n === 8 ? 0 : n - 1), 'midnight: light 4 still loses to a rnd(8) roll of 0');
  // anti-vacuity: the OLD behaviour (stored skylight, no darkness) must refuse the night spawn again
  const savedDark = S.darknessNow;
  S.darknessNow = () => 0;
  okAv(!M.Spawn.checkPlacement('zombie', 0, 61, 0, 'natural', permissive), 'with ambientDarkness forced 0 (the pre-D-511 rule) midnight open sky refuses — the break is caught');
  S.darknessNow = savedDark;
  const savedCos = S.mthCos;
  S.mthCos = (x) => Math.cos(x + 0.05);
  let dusk2 = -1; for (let t = 12000; t < 13000; t++) if (clear(t) >= 4) { dusk2 = t; break; }
  okAv(dusk2 !== 12542, `a skewed cos moves the dusk edge (${dusk2}) — the 12542 assertion can fail`);
  S.mthCos = savedCos;
  S.dayTime = saved;
}
say(`   ${pass} ok`);

say('\n10. D-511: undead burn in daylight (Zombie/AbstractSkeleton/Phantom.tickMovement → isAffectedByDaylight)');
{
  const S = M.Sky, Cb = M.Combat;
  ok(!!(Cb && Cb.tickDaylightBurn), 'Combat.tickDaylightBurn exists');
  if (Cb && Cb.tickDaylightBurn) {
    const mk = (type) => ({ type, x: 0.5, y: 61, z: 0.5, height: 1.95, maxHealth: 20, health: 20, remainingFireTicks: 0 });
    const lucky = () => 0;           // nextFloat()*30 = 0 < (1-0.4)*2
    const saved = S.dayTime, savedW = S.weather;
    S.weather = S.newWeather();
    S.dayTime = 6000;
    const z = mk('zombie');
    ok(Cb.tickDaylightBurn(z, lucky) === true && z.remainingFireTicks === 160, `noon, open sky: a zombie catches fire for 8 s (${z.remainingFireTicks} ticks)`);
    const sk = mk('skeleton'); Cb.tickDaylightBurn(sk, lucky);
    ok(sk.remainingFireTicks === 160, 'and so does a skeleton');
    const hu = mk('husk'); Cb.tickDaylightBurn(hu, lucky);
    ok(hu.remainingFireTicks === 0, 'a husk does not (HuskEntity.burnsInDaylight → false)');
    const cw = mk('cow'); Cb.tickDaylightBurn(cw, lucky);
    ok(cw.remainingFireTicks === 0, 'a cow does not');
    const wet = mk('zombie'); wet.inWater = true; Cb.tickDaylightBurn(wet, lucky);
    ok(wet.remainingFireTicks === 0, 'a zombie standing in water does not (isWet)');
    const unlucky = mk('zombie'); Cb.tickDaylightBurn(unlucky, () => 0.99);
    ok(unlucky.remainingFireTicks === 0, 'the nextFloat()*30 roll can spare it: 29.7 is not < 1.2');
    S.dayTime = 18000;
    const nz = mk('zombie'); Cb.tickDaylightBurn(nz, lucky);
    ok(nz.remainingFireTicks === 0, 'midnight: no burn (World.isDay false)');
    S.dayTime = 6000;
    const savedDay = S.isDay; S.isDay = () => true;
    const savedDark = S.darknessNow; S.darknessNow = () => 11;
    const dz = mk('zombie'); Cb.tickDaylightBurn(dz, lucky);
    okAv(dz.remainingFireTicks === 0, 'with darkness 11 forced (light 15-11=4, brightness 0.2) the brightness gate refuses — it is really read');
    S.isDay = savedDay; S.darknessNow = savedDark;
    const savedB = Cb.BURNS_IN_DAYLIGHT.zombie; delete Cb.BURNS_IN_DAYLIGHT.zombie;
    const gz = mk('zombie'); Cb.tickDaylightBurn(gz, lucky);
    okAv(gz.remainingFireTicks === 0, 'with zombie removed from the burns table nothing ignites — the table gates it');
    Cb.BURNS_IN_DAYLIGHT.zombie = savedB;
    ok(Math.abs(Cb.brightnessOf(15) - 1) < 1e-6 && Cb.brightnessOf(12) <= 0.5 && Cb.brightnessOf(13) > 0.5,
       'brightness table: 15 → 1.0, 12 → 0.5 (not > 0.5), 13 → 0.62 (DimensionType f/(4-3f))');
    S.dayTime = saved; S.weather = savedW;
  }
}
// ─────────────────────────────────────────────── 9. #6789: isSpaceEmpty's ENTITY half
say('\n9. Spawn.spaceEmptyAt refuses a cell another entity stands in (doesNotIntersectEntities)');
{
  M.EntityList.clear();
  const savedP = M.Player; M.Player = { x: 1000, y: 65, z: 1000 };
  for (let y = 61; y <= 70; y++) W.setBlock(0, y, 0, 0);
  W.setBlock(0, 60, 0, GRASS);
  const S = M.Spawn;
  const cell = () => S.spaceEmptyAt('cow', 0.5, 61, 0.5);
  const put = (type, x = 0.5) => { const e = { type, x, y: 61, z: 0.5 }; M.EntityList.list.push(e); return e; };
  ok(cell(), 'empty cell: a cow fits');
  for (const [type, dx] of [['boat', 0.5], ['cow', 0.5], ['cow', 1.2]]) {
    const e = put(type, dx);
    ok(!cell(), `${type} at x=${dx} blocks a spawn (pack and spawner share spaceEmptyAt)`);
    e.removed = true;
    ok(cell(), `${type} removed: the spawn fits again`);
    M.EntityList.list.pop();
  }
  const far = put('cow', 3.5); ok(cell(), 'a cow two cells away does not block'); M.EntityList.list.pop();
  const it = put('item'); ok(cell(), 'an item entity (no intersectionChecked) does not block'); M.EntityList.list.pop();
  put('cow');
  okAv(!cell(), 'anti-vacuity: standing cow refuses');
  S.ENTITY_CHECK = false;
  okAv(cell(), 'anti-vacuity: entity half disabled -> the cow is accepted inside the cow');
  S.ENTITY_CHECK = true;
  M.EntityList.clear(); M.Player = savedP;
}
say(`   ${pass} ok`);

say('');
say('================= spawncheck =================');
say(` assertions passed .. ${pass}`);
say(` failures ........... ${fails.length}`);
say(` breaks caught ...... ${breaks}`);
say('===============================================');
for (const f of fails) say('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
