#!/usr/bin/env node
// crystalringbookcheck.mjs — D-835: reconciling ED.buildCrystalRing's synthetic alive/
// getAliveEndCrystals() bookkeeping (src/07zzl_enderdragon.js) with a REAL live `end_crystal`
// entity (src/07zzn_endcrystal.js). Before this fix, ED.EnderDragonFight.prototype.
// crystalDestroyed(crystal, source) matched the destroyed crystal against its own synthetic
// ring rows with a bare `this.crystals.indexOf(crystal)` reference lookup -- which only ever
// matched when `crystal` WAS one of the 10 `{x,z,radius,height,guarded,alive}` rows themselves.
// EC.crystalDestroyed (src/07zzn_endcrystal.js) always passes the REAL entity object, never one
// of those rows, so indexOf always returned -1 and a real crystal kill silently never flipped
// its ring row's `alive` flag or moved `getAliveEndCrystals()`.
//
// The fix (ED.EnderDragonFight.prototype._ringIndexForCrystal) keeps the existing reference
// match first (so a synthetic row passed directly, this port's own test convention, is
// unaffected), then falls back -- ONLY for a genuine miss -- to the same column test vanilla's
// own `EnderDragonFight.countAliveCrystals()` performs per `EndSpikeFeature.Spike.
// getBoundingBox()` (.decomp, read verbatim): X within [row.x-radius, row.x+radius] and Z
// within [row.z-radius, row.z+radius] (full world height, no Y test) -- not an invented
// nearest-position heuristic.
//
//   node tools/crystalringbookcheck.mjs [--verbose]
//
// Sections:
//   1. a REAL end_crystal entity spawned at a ring row's exact (x,z) and destroyed through the
//      real EC.damage()/EC.crystalDestroyed() chain flips THAT row's `alive` flag and drops
//      getAliveEndCrystals() by exactly one -- the D-835 bug fixed by this pass.
//   2. anti-vacuity: a synthetic ring row passed directly to fight.crystalDestroyed() (the old,
//      already-working call shape) still works exactly as before -- the fix does not regress
//      the reference-identity path.
//   3. anti-vacuity: destroying a real crystal that is nowhere near any of the 10 ring columns
//      leaves every row's `alive` flag untouched and getAliveEndCrystals() unchanged -- proving
//      the fallback is a real column test, not an unconditional "mark something dead".

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));

const VERBOSE = process.argv.includes('--verbose');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c && VERBOSE) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };

console.log('crystalringbookcheck -- D-835: real end_crystal kills reconcile with ED.buildCrystalRing bookkeeping');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
               '07e_loot.js', '07h_entities.js', '14b_physics.js', '14c_raycast.js',
               '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
               '14j_combat.js', '07za_explosion.js', '07zzl_enderdragon.js', '07zzn_endcrystal.js'];

function freshEngine() {
  const M = loadEngine({ extra: EXTRA, dom: false });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
  const W = M.World, CH = M.CH;
  M.Behave.init(W);
  M.Entities.init();
  M.EntityList.init();
  M.Ai.init();
  M.Spawn.init();
  M.Combat.init();
  M.Explosion.init();
  M.EnderDragon.init();
  M.EndCrystal.init();
  W.init(1);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
    const c = W.makeChunk(cx, cz);
    c.state = CH.GENERATED;
    W.chunks.set(W.key(cx, cz), c);
  }
  return M;
}

// ============ 1. a real end_crystal kill flips its own ring row =================================
{
  say('1. real end_crystal destroyed -> its ring row alive flag flips + getAliveEndCrystals() drops');
  const M = freshEngine();
  const ED = M.EnderDragon, EL = M.EntityList;
  const fight = new ED.EnderDragonFight({ seed: 12345, heightAt: () => 65 });
  ok(fight.getAliveEndCrystals() === 10, `fresh fight starts at 10 -- got ${fight.getAliveEndCrystals()}`);

  // pick ring row 3 and spawn a REAL end_crystal at its exact (x, z) -- exactly how a real
  // crystal placed at a spike position would sit, per EndSpikeFeature.Spike's own column.
  const row = fight.crystals[3];
  const crystal = EL.spawn('end_crystal', row.x, row.height, row.z, {});
  ok(crystal && crystal.type === 'end_crystal', 'spawned a real end_crystal entity at ring row 3\'s own (x,z)');
  ok(crystal !== row, 'sanity: the spawned entity is a SEPARATE object from the synthetic ring row (not the same reference)');

  // destroy it through the real damage chain (EC.damage -> EC.crystalDestroyed ->
  // ED.getActiveFight().crystalDestroyed), exactly the path EC.crystalDestroyed's own header
  // documents -- NOT calling fight.crystalDestroyed(crystal, ...) directly, so this proves the
  // real end-to-end wiring, not just the fixed method in isolation.
  ED.activeFight = fight;
  const activeFight = ED.getActiveFight ? ED.getActiveFight() : null;
  ok(activeFight === fight, 'ED.getActiveFight() returns the fight this section just set active');

  M.EndCrystal.damage(crystal, { attacker: { type: 'player' } });
  ok(crystal.removed === true, 'the real end_crystal entity is genuinely destroyed');
  ok(row.alive === false, 'D-835 fix: destroying the REAL crystal flips its own ring row\'s `alive` flag to false');
  ok(fight.getAliveEndCrystals() === 9, `getAliveEndCrystals() drops from 10 to 9 -- got ${fight.getAliveEndCrystals()}`);

  // every OTHER row must be untouched
  let othersUntouched = true;
  for (let i = 0; i < fight.crystals.length; i++) {
    if (i === 3) continue;
    if (fight.crystals[i].alive !== true) othersUntouched = false;
  }
  okAv(othersUntouched, 'only ring row 3 flipped -- every other row is still alive:true, not a blanket side effect');
}

// ============ 2. anti-vacuity: the old synthetic-row-by-reference call shape still works =======
{
  say('2. a synthetic ring row passed directly (old calling convention) still works unchanged');
  const M = freshEngine();
  const ED = M.EnderDragon;
  const fight = new ED.EnderDragonFight({ seed: 999, heightAt: () => 65 });
  fight.crystalDestroyed(fight.crystals[7]);
  okAv(fight.crystals[7].alive === false && fight.getAliveEndCrystals() === 9,
    'passing a synthetic ring row by reference (this port\'s own pre-existing test convention) still flips it directly -- the fix did not regress the reference-identity fast path');
}

// ============ 3. anti-vacuity: a real crystal FAR from every ring column changes nothing =======
{
  say('3. a real crystal nowhere near any ring column leaves all rows/alive-count untouched');
  const M = freshEngine();
  const ED = M.EnderDragon, EL = M.EntityList;
  const fight = new ED.EnderDragonFight({ seed: 12345, heightAt: () => 65 });
  ED.activeFight = fight;

  // 5000 blocks out on X is far outside every ring row's small (2-5 block) radius column.
  const farCrystal = EL.spawn('end_crystal', 5000, 70, 5000, {});
  M.EndCrystal.damage(farCrystal, { attacker: { type: 'player' } });
  ok(farCrystal.removed === true, 'the far-away real crystal is still genuinely destroyed');

  let allStillAlive = true;
  for (const r of fight.crystals) if (r.alive !== true) allStillAlive = false;
  okAv(allStillAlive && fight.getAliveEndCrystals() === 10,
    'destroying a real crystal that matches NO ring column\'s (x,z,radius) box leaves every row alive:true and getAliveEndCrystals() at 10 -- proving the fallback is a real column test, not an unconditional "mark row N dead"');
}

// ============ 4. D-838: starting a fight actually SPAWNS real end_crystal entities =========
// (ED.EnderDragonFight.prototype._spawnCrystalRing, src/07zzl_enderdragon.js) -- .decomp's own
// EndSpikeFeature.generateSpike() places a REAL end_crystal at every ring position; before this
// pass NOTHING called that real spawn anywhere in this engine, so D-837's own alive-bookkeeping
// fix was reachable only via a manually-placed test crystal, never through real play.
{
  say('4. ED.EnderDragonFight construction spawns REAL end_crystal entities at ring positions');
  const M = freshEngine();
  const ED = M.EnderDragon, EL = M.EntityList;

  // anti-vacuity FIRST: prove this section's own assertion can actually fail -- temporarily
  // disable the real spawn call and confirm a fresh fight then has ZERO live end_crystal
  // entities anywhere in EL, so the positive assertion below is a real break, not vacuous.
  const realSpawn = ED.EnderDragonFight.prototype._spawnCrystalRing;
  ED.EnderDragonFight.prototype._spawnCrystalRing = function () {};
  new ED.EnderDragonFight({ seed: 777, heightAt: () => 65 });
  const noneSpawned = EL.list.filter((e) => e.type === 'end_crystal').length === 0;
  okAv(noneSpawned, 'anti-vacuity: with the real spawn call disabled, starting a fight leaves ZERO live end_crystal entities in EL -- proving the positive assertion below can genuinely fail, not vacuously pass');
  ED.EnderDragonFight.prototype._spawnCrystalRing = realSpawn;

  // now the real path: a fresh fight must spawn one real, live end_crystal entity at EACH of
  // its 10 ring rows' own real jar position (EndSpikeFeature.generateSpike(), .decomp read
  // verbatim: centerX+0.5, height+1, centerZ+0.5) -- REAL entities in EL.list, not just
  // ED.buildCrystalRing's own computed coordinates sitting unused in a synthetic row.
  const fight = new ED.EnderDragonFight({ seed: 777, heightAt: () => 65 });
  let allFound = true;
  for (const row of fight.crystals) {
    const found = EL.list.some((e) => e.type === 'end_crystal' && !e.removed &&
      e.x === row.x + 0.5 && e.y === row.height + 1 && e.z === row.z + 0.5);
    if (!found) allFound = false;
  }
  ok(allFound, 'all 10 ring positions have a REAL, live end_crystal entity at the exact real jar spawn point (centerX+0.5, height+1, centerZ+0.5)');

  // each is born with the real natural-worldgen state (EndConfiguredFeatures.END_SPIKE's own
  // registered config, .decomp read verbatim: crystalInvulnerable=false, crystalBeamTarget=null)
  // -- never an invented beamTarget-setting AI, per this unit's own scope.
  const spawned = EL.list.filter((e) => e.type === 'end_crystal' && !e.removed);
  ok(spawned.length === 10 && spawned.every((e) => !e.invulnerable && e.beamTarget === null),
    'every spawned crystal carries the real natural-spawn state -- not invulnerable, no beam target');
}

console.log(`\n${pass} checks passed, ${breaks} anti-vacuity break(s) proved, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.log('  x ' + f);
  process.exit(1);
}
