#!/usr/bin/env node
// spawncapcheck.mjs — loop/spawn-cap (QUEUE 0.2 G18c, Spawn.OWED's category-cap/checkMobSpawnRules
// lines, Diff.OWED's PEACEFUL-despawn line).
//
//   node tools/spawncapcheck.mjs [--verbose]
//
// Three independent mechanics this file's own header names, each proven against its own
// .decomp anchor and each given an anti-vacuity break:
//   1. Spawn.spawningChunkCount / Spawn.categoryCap — SpawnHelper.Info.isBelowCap
//      (.decomp/net/minecraft/world/SpawnHelper.java:484-486): capacity * spawningChunkCount / 289.
//   2. checkMobSpawnRules's per-block allowsSpawning overrides (Spawn.NO_SPAWN_BLOCKS) —
//      .decomp/net/minecraft/block/Blocks.java's glass/ice/frosted_ice/magma_block/leaves rows.
//   3. Spawn.despawnTick's PEACEFUL branch (Spawn.PEACEFUL_DISALLOWED) —
//      MobEntity.checkDespawn (.decomp MobEntity.java:656-657), HostileEntity.
//      isDisallowedInPeaceful, re-derived from .decomp class chains (slime included, piglin excluded)
//      (SlimeEntity extends MobEntity implements Monster, no override).
// Headless, node-only — same harness shape as spawncheck.mjs/despawncheck.mjs (loadsrc.mjs).

import { readFileSync } from 'node:fs';
import * as require_fs from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

const VERBOSE = process.argv.includes('--verbose');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ break caught: ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => console.log(...a);

say('spawncapcheck — loop/spawn-cap: category cap scaling, per-block spawn rules, PEACEFUL despawn');

const EXTRA = ['16_settings.js', '02f_tags.js', '07_world.js', '08_lighting.js', '07b_behaviour.js',
               '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js',
               '07l_spawn.js', '07c_blockentity.js', '09b_sky.js', '14j_combat.js',
               '07w_passive.js', '14c_raycast.js', '07zf_bat.js', '07zi_squid.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
initRegistry(M);
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8'))
});
M.Entities.init();
const W = M.World, CH = M.CH, CFG = M.CFG, S = M.Settings, EL = M.EntityList, Sp = M.Spawn, Diff = M.Diff;

W.init(1337);
M.Gen.init(1337, M.Gen.defaults());
M.Light.init();
M.Behave.init(W);
EL.init();
M.Ai.init();
if (M.Passive && M.Passive.init) M.Passive.init();
if (M.Bat && M.Bat.init) M.Bat.init();
if (M.Squid && M.Squid.init) M.Squid.init();
Sp.init();
ok(Sp.ready, 'Spawn.init ran');
Sp.ready = false;   // no natural spawning racing the fixtures below (despawncheck's own D-397 precedent)

const stateOf = (n) => M.States.stateOf(n) | 0;
M.Player = { x: 0, y: 64, z: 0 };

// ═══════════════════════════════════════════════ 1. spawningChunkCount / categoryCap
say('\n1. Spawn.categoryCap — SpawnHelper.Info.isBelowCap (capacity * spawningChunkCount / 289)');
{
  ok(typeof Sp.spawningChunkCount === 'function', 'Spawn.spawningChunkCount exists');
  ok(typeof Sp.categoryCap === 'function', 'Spawn.categoryCap exists');

  // a controlled 5x5 chunk fixture, all GENERATED, centred on the camera.
  W.camCx = 0; W.camCz = 0;
  S.setRenderDistance(10);
  S.setSimDistance(2);
  ok(S.effectiveSimDistance() === 2, `effectiveSimDistance is ${S.effectiveSimDistance()}, expected 2 for this fixture`);
  let expected = 0;
  for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) {
    const c = W.getOrCreate(cx, cz);
    c.state = CH.GENERATED;
    if (cx * cx + cz * cz <= 2 * 2) expected++;   // the SAME circle test W.tickingAt itself runs
  }
  ok(expected > 0 && expected < 49, `sanity: the fixture's own expected ticking count (${expected}) is a proper subset of the 7x7 grid`);
  ok(Sp.spawningChunkCount() === expected, `spawningChunkCount() = ${Sp.spawningChunkCount()}, expected ${expected} (independently counted off the same W.tickingAt circle)`);

  const monsterCap = Sp.CATEGORY.monster.cap;   // 70
  ok(monsterCap === 70, `sanity: monster's raw cap is ${monsterCap}, expected 70 (ayb's own <clinit>)`);
  const floorExpected = Math.floor(monsterCap * expected / 289);
  ok(Sp.categoryCap('monster') === floorExpected, `categoryCap('monster') = ${Sp.categoryCap('monster')}, expected floor(70*${expected}/289) = ${floorExpected}`);
  ok(Sp.categoryCap('monster') < monsterCap, 'at this small a resident chunk set, the scaled cap is strictly BELOW the raw cap — the scaling really bites');
  ok(Sp.categoryCap('misc') === -1, "categoryCap('misc') stays -1 (uncapped) — never scaled, matching isBelowCap's own int-cap==-1 no-op shape");

  // anti-vacuity 1: a fixed chunk count of exactly 289 (CHUNK_AREA) must give back the RAW cap
  // unchanged — proves the multiply/divide, not a hardcoded fraction.
  const savedCount = Sp.spawningChunkCount;
  Sp.spawningChunkCount = () => 289;
  okAv(Sp.categoryCap('monster') === 70, 'stubbing spawningChunkCount() to exactly 289 (CHUNK_AREA) gives back the unscaled raw cap 70');
  Sp.spawningChunkCount = () => 0;
  okAv(Sp.categoryCap('monster') === 0, 'stubbing spawningChunkCount() to 0 (no ticking chunks at all) floors the cap to 0');
  Sp.spawningChunkCount = savedCount;

  // anti-vacuity 2: Spawn.attempt's own cap GATE must really read categoryCap, not the raw
  // rule.cap it used to — break it back to the OLD flat-cap comparison and watch the
  // small-world refusal above disappear.
  EL.clear();
  // fabricate `expected` (>0, from the fixture above) live monsters so liveCount(monster) ==
  // the SCALED cap but is still well under the RAW cap of 70 — the exact gap the scaling closes.
  const liveNeeded = Sp.categoryCap('monster');
  ok(liveNeeded < monsterCap, 'sanity: the scaled cap sits below the raw cap for this fixture (precondition for the gate test below)');
  for (let i = 0; i < liveNeeded; i++) EL.spawn('zombie', 0, 64, i * 2);
  ok(Sp.liveCount('monster') === liveNeeded, `fabricated ${Sp.liveCount('monster')} live monsters, expected ${liveNeeded}`);
  ok(!Sp.attempt('monster'), 'Spawn.attempt(monster) refuses — liveCount already meets the SCALED cap, below the raw cap of 70');
  // anti-vacuity, on the EXACT boolean expression Spawn.attempt/tickSpawner both gate on
  // (`rule.cap >= 0 && Spawn.liveCount(category) >= Spawn.categoryCap(category)`), not on a
  // full successful placement — a real spawn also needs biome/ground data this small hand-built
  // fixture never populated, which would make a placement-based break vacuous for the WRONG
  // reason (no eligible biome), not the right one (the cap gate).
  const gateRefuses = (cat) => Sp.CATEGORY[cat].cap >= 0 && Sp.liveCount(cat) >= Sp.categoryCap(cat);
  ok(gateRefuses('monster'), 'the real call-site gate expression itself refuses, matching Spawn.attempt above');
  const savedCap = Sp.categoryCap;
  Sp.categoryCap = (cat) => Sp.CATEGORY[cat].cap;   // the pre-loop/spawn-cap behaviour, verbatim
  okAv(!gateRefuses('monster'), 'reverting categoryCap to the raw (unscaled) rule.cap flips the SAME gate expression to "allow" — the refusal above is not vacuous');
  Sp.categoryCap = savedCap;
  EL.clear();
}
say(`   ${pass} ok`);

// ═══════════════════════════════════════════════ 2. checkMobSpawnRules's per-block overrides
say('\n2. checkMobSpawnRules — BlockBehaviour.isValidSpawn per-block overrides (Spawn.NO_SPAWN_BLOCKS)');
{
  Sp.ready = false;
  ok(typeof Sp.NO_SPAWN_BLOCKS === 'object', 'Spawn.NO_SPAWN_BLOCKS exists');
  for (const nm of ['glass', 'tinted_glass', 'ice', 'frosted_ice', 'magma_block', 'oak_leaves', 'birch_leaves', 'spruce_leaves']) {
    ok(Sp.NO_SPAWN_BLOCKS[nm] === 1, `NO_SPAWN_BLOCKS names ${nm}`);
  }

  // a dark, roofed, carved room (spawncheck's own §8 fixture shape) so ONLY the floor block
  // changes between assertions — isDarkEnoughToSpawn/isClearForSpawn stay constant throughout.
  const DX = 200, STONE = stateOf('stone');
  // an EXPLICITLY created, hand-lit chunk (spawncheck's own §2 fixture shape) rather than relying
  // on real Gen terrain existing at this column — nothing ever asked Gen to generate chunk
  // (DX>>4, 0), so without this it stays an empty, ungenerated stub and rawBrightness defaults
  // to "unknown = lit", not dark.
  const roomChunk = W.getOrCreate(DX >> 4, 0);
  roomChunk.state = CH.GENERATED;
  for (let x = DX - 3; x <= DX + 3; x++) for (let z = -3; z <= 3; z++) W.setLight(x, CFG.WORLD_MAX_Y - 1, z, (15 << 4) | 0);
  for (let x = DX - 3; x <= DX + 3; x++) for (let z = -3; z <= 3; z++) { W.setBlock(x, 49, z, STONE); W.setBlock(x, 53, z, STONE); }
  for (let y = 50; y <= 52; y++) {
    for (let x = DX - 3; x <= DX + 3; x++) { W.setBlock(x, y, -3, STONE); W.setBlock(x, y, 3, STONE); }
    for (let z = -3; z <= 3; z++) { W.setBlock(DX - 3, y, z, STONE); W.setBlock(DX + 3, y, z, STONE); }
  }
  for (let y = 50; y <= 52; y++) for (let x = DX - 2; x <= DX + 2; x++) for (let z = -2; z <= 2; z++) W.setBlock(x, y, z, 0);
  M.Light.queueBorder(Math.floor(DX / 16), 0);
  ok(M.Light.settle(4000), 'the §2 room settled');
  ok(W.rawBrightness(DX, 50, 0) === 0, 'the §2 room really is dark');

  // faceSturdy forced TRUE everywhere: the OLD approximation would accept every block below
  // — isolating the NEW per-block override as the only thing that can still refuse.
  const savedFaceSturdy = M.Behave.faceSturdy;
  M.Behave.faceSturdy = () => true;

  W.setBlock(DX, 49, 0, STONE);
  ok(Sp.checkPlacement('zombie', DX, 50, 0), 'sanity: plain stone floor, faceSturdy forced true → zombie placement accepted');

  const glassSt = stateOf('glass'), iceSt = stateOf('ice'), magmaSt = stateOf('magma_block'),
        leavesSt = stateOf('oak_leaves'), tintedSt = stateOf('tinted_glass');
  ok(glassSt > 0 && iceSt > 0 && magmaSt > 0 && leavesSt > 0, 'sanity: glass/ice/magma_block/oak_leaves all resolve to real states');

  W.setBlock(DX, 49, 0, glassSt);
  ok(!Sp.checkPlacement('zombie', DX, 50, 0), 'glass floor refuses — even with faceSturdy forced true (Blocks.java:243 .allowsSpawning(Blocks::never))');
  W.setBlock(DX, 49, 0, tintedSt);
  ok(!Sp.checkPlacement('zombie', DX, 50, 0), 'tinted_glass floor refuses too (Blocks.java:3186, same never predicate)');
  W.setBlock(DX, 49, 0, iceSt);
  ok(!Sp.checkPlacement('zombie', DX, 50, 0), 'ice floor refuses — the real predicate allows only PolarBearEntity, which this engine never spawns');
  W.setBlock(DX, 49, 0, magmaSt);
  ok(!Sp.checkPlacement('zombie', DX, 50, 0), 'magma_block floor refuses — the real predicate allows only fire-immune types, none of which this engine spawns');
  W.setBlock(DX, 49, 0, leavesSt);
  ok(!Sp.checkPlacement('zombie', DX, 50, 0), 'oak_leaves floor refuses a zombie — canSpawnOnLeaves allows only ocelot/parrot, and zombie is neither');

  W.setBlock(DX, 49, 0, STONE);
  ok(Sp.checkPlacement('zombie', DX, 50, 0), 'restoring stone un-refuses the same spot — not a stuck fixture');

  // anti-vacuity: delete the glass entry and watch the refusal above disappear.
  W.setBlock(DX, 49, 0, glassSt);
  const savedGlass = Sp.FLOOR_PRED.glass, savedNo = Sp.NO_SPAWN_BLOCKS.glass;
  delete Sp.FLOOR_PRED.glass; delete Sp.NO_SPAWN_BLOCKS.glass;
  okAv(Sp.checkPlacement('zombie', DX, 50, 0), 'with the glass entry removed (faceSturdy still forced true), the SAME glass floor now WRONGLY accepts — the refusal above is not vacuous');
  Sp.FLOOR_PRED.glass = savedGlass; Sp.NO_SPAWN_BLOCKS.glass = savedNo;
  ok(!Sp.checkPlacement('zombie', DX, 50, 0), 'restoring the table un-breaks the same assertion');

  M.Behave.faceSturdy = savedFaceSturdy;
  W.setBlock(DX, 49, 0, STONE);
}
say(`   ${pass} ok`);

// ═══════════════════════════════════════════════ 3. Spawn.despawnTick's PEACEFUL branch
say('\n3. Spawn.despawnTick — MobEntity.checkDespawn\'s PEACEFUL branch (Spawn.PEACEFUL_DISALLOWED)');
{
  ok(typeof Sp.PEACEFUL_DISALLOWED === 'object', 'Spawn.PEACEFUL_DISALLOWED exists');
  // Re-derived from .decomp every run (rule 3, D-329 -- the check owns none of the list): walk each
  // DESPAWN_TYPES entry's class (EntityType.java's `create(X::new`) up its extends-chain to the first
  // `isDisallowedInPeaceful()` override; `true` or `getSize() > 0` (SlimeEntity -- setSize clamps
  // to >= 1, SlimeEntity.java:76) means disallowed; none / `false` means allowed.
  const expectDis = (() => {
    const { readdirSync, statSync } = require_fs;
    const root = join(MCLITE_ROOT, '.decomp', 'net', 'minecraft', 'entity');
    const cls = {};
    const walk = d => { for (const f of readdirSync(d)) { const q = join(d, f);
      if (statSync(q).isDirectory()) walk(q); else if (f.endsWith('.java')) {
        const src = readFileSync(q, 'utf8');
        const m = src.match(/public (?:abstract )?class (\w+)(?:<[^>]*>)?\s+extends (\w+)/);
        if (m) { const o = src.match(/boolean isDisallowedInPeaceful\(\) \{\s*return ([^;]+);/);
          cls[m[1]] = { sup: m[2], over: o ? o[1] : null }; } } } };
    walk(root);
    const et = readFileSync(join(root, 'EntityType.java'), 'utf8');
    const out = {};
    for (const m of et.matchAll(/"(\w+)",\s*EntityType\.Builder\.(?:<\w+>)?create\((\w+)::new/g)) {
      let x = m[2], v = null;
      while (cls[x]) { if (cls[x].over !== null) { v = cls[x].over; break; } x = cls[x].sup; }
      out[m[1]] = v === 'true' || v === 'this.getSize() > 0';
    }
    return out;
  })();
  let nDis = 0;
  for (const nm of Object.keys(Sp.DESPAWN_TYPES)) {
    ok(nm in expectDis, `.decomp EntityType registers ${nm}`);
    if (expectDis[nm]) nDis++;
    ok(!!Sp.PEACEFUL_DISALLOWED[nm] === !!expectDis[nm],
      `PEACEFUL_DISALLOWED[${nm}] == .decomp isDisallowedInPeaceful (${!!expectDis[nm]})`);
  }
  ok(nDis >= 25, `the .decomp walk found ${nDis} disallowed types (>= 25 -- the walk is not vacuous)`);
  ok(expectDis.slime === true && expectDis.piglin === false && expectDis.cow === false,
    'walk spot-checks: slime disallowed (getSize() > 0), piglin re-allowed (PiglinEntity:213), cow never');
  ok(!Sp.PEACEFUL_DISALLOWED.cow, 'cow (not a MobEntity subclass override at all) is not in the table either');

  // the player must be NEAR every fixture mob below — otherwise `checkDespawn`'s own DISTANCE
  // branch (immediate despawn past the despawn range) removes them for an unrelated reason and
  // the PEACEFUL assertions below would pass vacuously.
  M.Player = { x: 300, y: 64, z: 0 };

  Diff.set('normal');
  EL.clear();
  const zn = EL.spawn('zombie', 300, 64, 0);
  Sp.despawnTick();
  ok(zn && !zn.removed, 'sanity, normal difficulty: a zombie survives a despawnTick untouched');

  Diff.set('peaceful');
  EL.clear();
  const z = EL.spawn('zombie', 300, 64, 0);
  const w = EL.spawn('witch', 300, 64, 4);
  const sl = EL.spawn('slime', 300, 64, 8);
  const zp = EL.spawn('zombie', 300, 64, 12); zp.persistent = true;   // PEACEFUL ignores persistent
  Sp.despawnTick();
  ok(z.removed, 'PEACEFUL discards an existing zombie (MobEntity.checkDespawn’s own first branch)');
  ok(w.removed, 'PEACEFUL discards an existing witch too (RaiderEntity -> HostileEntity)');
  ok(sl.removed, 'PEACEFUL discards an existing slime too (SlimeEntity.isDisallowedInPeaceful: getSize() > 0, always true)');
  ok(zp.removed, 'PEACEFUL discards a PERSISTENT zombie too — the real branch runs before the persistent check, unconditionally');

  Diff.set('normal');   // leave the shared store as every other check file expects it
  EL.clear();
  const zr = EL.spawn('zombie', 300, 64, 0);
  Sp.despawnTick();
  ok(zr && !zr.removed, 'restoring normal un-breaks the same spot — not a stuck fixture');

  // anti-vacuity: empty the table and watch PEACEFUL stop discarding.
  Diff.set('peaceful');
  EL.clear();
  const z2 = EL.spawn('zombie', 300, 64, 0);
  const savedTable = Sp.PEACEFUL_DISALLOWED;
  Sp.PEACEFUL_DISALLOWED = {};
  Sp.despawnTick();
  okAv(!z2.removed, 'with PEACEFUL_DISALLOWED emptied, the SAME zombie WRONGLY survives PEACEFUL — the discards above are not vacuous');
  Sp.PEACEFUL_DISALLOWED = savedTable;
  Diff.set('normal');
  EL.clear();
}
say(`   ${pass} ok`);

// ═══════════════════════════════════════════════ 4. despawnCounter freezes while AI is disabled
say('\n4. despawnTick — despawnCounter freezes while e.aiDisabled (MobEntity:1272 canMoveVoluntarily gate)');
{
  const savedLight = W.getLight;
  W.getLight = () => 0;   // pitch dark: brightAtEyes() false, so a normal tick bumps by exactly +1
  M.Player = { x: 300, y: 64, z: 0 };

  // between noDespawn (32) and despawn (128): far enough that `d2 < near` never resets the
  // counter back to 0, close enough that the distance branch never immediately discards it —
  // isolating the counter bookkeeping this section is actually testing.
  EL.clear();
  const on = EL.spawn('zombie', 300, 64, 50);
  on.despawnCounter = 500;
  Sp.despawnTick();
  ok(on.despawnCounter === 501, `an ordinary zombie's despawnCounter climbed to ${on.despawnCounter}, expected 501 (tickNewAi's own +1)`);

  EL.clear();
  const off = EL.spawn('zombie', 300, 64, 50);
  off.despawnCounter = 500;
  off.aiDisabled = true;
  Sp.despawnTick();
  okAv(off.despawnCounter === 500, `an AI-disabled zombie's despawnCounter stayed at ${off.despawnCounter} (expected frozen at 500) — canMoveVoluntarily never reaches tickNewAi for it`);

  W.getLight = savedLight;
  EL.clear();
}
say(`   ${pass} ok`);

say('');
say('================= spawncapcheck =================');
say(` assertions passed .. ${pass}`);
say(` failures ........... ${fails.length}`);
say(` breaks caught ...... ${breaks}`);
say('===================================================');
for (const f of fails) say('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
