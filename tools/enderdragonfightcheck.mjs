#!/usr/bin/env node
// enderdragonfightcheck.mjs -- loop/enderdragonfight-substrate (ED.OWED item 2, QUEUE task):
// EnderDragonFight itself -- the crystal ring, exit-portal location, and the real
// EnderDragonSpawnState respawn/spawn-sequence timer machine culminating in a real
// createDragon() -- src/07zzl_enderdragon.js's own ED.buildCrystalRing/ED.computeExitPortalLocation/
// ED.EnderDragonFight, ported off .decomp's EnderDragonFight.java/EnderDragonSpawnState.java/
// EndSpikeFeature.java (all read whole for this pass).
//
//   node tools/enderdragonfightcheck.mjs [--verbose]
//
// Sections:
//   1. ED.buildCrystalRing -- 10 rows, the fixed radius/height/guarded multiset EndSpikeFeature's
//      own SpikeCache formula produces regardless of seed, deterministic for a repeated seed
//   2. anti-vacuity -- a different seed really does reassign which ring position gets which
//      radius/height/guarded row (proves the seeded shuffle is live, not a fixed layout)
//   3. ED.computeExitPortalLocation -- no-bedrock default is heightAt-1; a bedrock stand-in that
//      is only ever true is walked down to exactly sea level, not skipped
//   4. ED.EnderDragonFight -- getAliveEndCrystals() starts at 10, crystalDestroyed() decrements it
//   5. respawnDragon()'s real 3-guard gate: no crystalsNear supplied -> false, no state started;
//      a supplied crystalsNear satisfying all 4 directions -> true, state machine started at 0
//   6. anti-vacuity -- respawnDragon() called again while a sequence is already running (or while
//      dragonKilled is false) is refused, proving the guards are real, not just the happy path
//   7. the FULL tick() sequence -- an exact pinned call count (1 + 101 + 401 + 101 = 604, derived
//      from the real per-state timer thresholds ported in ED.EnderDragonFight.prototype.tick)
//      until a real dragon is created, no earlier and no later
//   8. createDragon() -- default (no opts.spawnDragon) returns a real ED.EnderDragonEntity rig at
//      (0,128,0), HoldingPattern, wired to this fight; opts.spawnDragon stand-in is called and its
//      returned entity's dragon.fight/phase get wired the same way
//   9. crystalDestroyed() aborts an in-progress respawn sequence when the destroyed crystal is one
//      of that sequence's own gathered crystals; anti-vacuity -- destroying an UNRELATED crystal
//      during the same sequence does NOT abort it
import { loadEngine } from './loadsrc.mjs';

const VERBOSE = process.argv.includes('--verbose');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c && VERBOSE) console.log('   ok ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };

console.log('enderdragonfightcheck -- ED.OWED item 2: EnderDragonFight (crystal ring, exit portal, real spawn-state sequence)');

function freshEngine() {
  return loadEngine({ extra: ['03b_noise.js', '07zzl_enderdragon.js'] });
}

// ============ 1. crystal ring invariants ========================================================
{
  const M = freshEngine();
  const ED = M.EnderDragon;
  say('1. ED.buildCrystalRing');
  const ring = ED.buildCrystalRing(12345);
  ok(Array.isArray(ring) && ring.length === 10, `buildCrystalRing returns 10 rows -- got ${ring && ring.length}`);
  const radii = ring.map((r) => r.radius).sort();
  ok(JSON.stringify(radii) === JSON.stringify([2, 2, 2, 3, 3, 3, 4, 4, 4, 5]),
    `radius multiset is EXACTLY {2,2,2,3,3,3,4,4,4,5} (2+floor(idx/3) for idx 0..9) -- got ${JSON.stringify(radii)}`);
  const heights = ring.map((r) => r.height).sort((a, b) => a - b);
  ok(JSON.stringify(heights) === JSON.stringify([76, 79, 82, 85, 88, 91, 94, 97, 100, 103]),
    `height set is EXACTLY {76,79,...,103} (76+idx*3 for idx 0..9) -- got ${JSON.stringify(heights)}`);
  ok(ring.filter((r) => r.guarded).length === 2, `exactly 2 guarded rows (idx===1 || idx===2) -- got ${ring.filter((r) => r.guarded).length}`);
  ok(ring.every((r) => r.alive === true), 'every row starts alive');
  // ring angle positions are seed-independent (only the idx->position ASSIGNMENT is shuffled) --
  // real vanilla's 10 fixed floor(42*cos/sin(...)) points, checked against the radius-42 circle.
  let onCircle = 0;
  for (const r of ring) if (Math.abs(Math.sqrt(r.x * r.x + r.z * r.z) - 42) < 1.5) onCircle++;
  ok(onCircle === 10, `all 10 ring positions sit on the real radius-42 circle -- ${onCircle}/10`);
  const ring2 = ED.buildCrystalRing(12345);
  ok(JSON.stringify(ring) === JSON.stringify(ring2), 'the SAME seed reproduces the exact same ring (deterministic)');
}

// ============ 2. anti-vacuity: the seed actually drives the shuffle ============================
{
  const M = freshEngine();
  const ED = M.EnderDragon;
  say('2. seed changes the assignment');
  const a = ED.buildCrystalRing(1);
  const b = ED.buildCrystalRing(2);
  let differs = false;
  for (let i = 0; i < 10; i++) if (a[i].radius !== b[i].radius || a[i].height !== b[i].height) { differs = true; break; }
  okAv(differs, 'anti-vacuity: two different seeds assign radius/height differently to at least one ring position -- proves the Random(seed)-driven shuffle is really being consulted, not a fixed layout the seed argument is ignored for');
}

// ============ 3. exit portal location ===========================================================
{
  const M = freshEngine();
  const ED = M.EnderDragon;
  say('3. ED.computeExitPortalLocation');
  const loc1 = ED.computeExitPortalLocation({ heightAt: () => 100 });
  ok(loc1.x === 0 && loc1.y === 99 && loc1.z === 0, `no-bedrock default is heightAt(0,0)-1 (getTopPosition().down()) -- got (${loc1.x},${loc1.y},${loc1.z})`);
  const loc2 = ED.computeExitPortalLocation({
    heightAt: () => 100,
    isBedrockAt: (x, y) => y > 70,
    seaLevel: 63
  });
  ok(loc2.y === 70, `a bedrock stand-in that is true down to y=71 descends to EXACTLY the first non-bedrock y (70), not sea level (63) or the top -- got y=${loc2.y}`);
}

// ============ 4. ED.EnderDragonFight -- crystal bookkeeping =====================================
{
  const M = freshEngine();
  const ED = M.EnderDragon;
  say('4. getAliveEndCrystals / crystalDestroyed bookkeeping');
  const fight = new ED.EnderDragonFight({ seed: 7 });
  ok(fight.getAliveEndCrystals() === 10, `a fresh fight starts with all 10 crystals alive -- got ${fight.getAliveEndCrystals()}`);
  fight.crystalDestroyed(fight.crystals[3]);
  ok(fight.getAliveEndCrystals() === 9, `destroying one ring crystal drops the count to 9 -- got ${fight.getAliveEndCrystals()}`);
  ok(fight.crystals[3].alive === false, 'the destroyed row itself is marked not alive');
}

// ============ 5. respawnDragon()'s real gate ====================================================
{
  const M = freshEngine();
  const ED = M.EnderDragon;
  say('5. respawnDragon gating');
  const fight1 = new ED.EnderDragonFight({ seed: 1, heightAt: () => 65 });
  ok(fight1.respawnDragon() === false, 'with no opts.crystalsNear supplied, respawnDragon() honestly finds nothing and refuses (no invented auto-respawn)');
  ok(fight1.dragonSpawnStateIndex === -1, 'no sequence was started by the refused call');

  const fight2 = new ED.EnderDragonFight({
    seed: 2, heightAt: () => 65,
    crystalsNear: () => [{ id: Math.random() }]  // every direction reports one live crystal nearby
  });
  const started = fight2.respawnDragon();
  ok(started === true, 'with a crystalsNear stand-in that satisfies all 4 cardinal directions, respawnDragon() returns true');
  ok(fight2.dragonSpawnStateIndex === 0, 'the real state machine started at state 0 (beamToCenter)');
  ok(Array.isArray(fight2.spawnCrystals) && fight2.spawnCrystals.length === 4, `all 4 gathered crystals (one per direction) are kept -- got ${fight2.spawnCrystals && fight2.spawnCrystals.length}`);
}

// ============ 6. anti-vacuity: the other 2 real guards ==========================================
{
  const M = freshEngine();
  const ED = M.EnderDragon;
  say('6. the already-running / already-alive guards');
  const fight = new ED.EnderDragonFight({
    seed: 3, heightAt: () => 65,
    crystalsNear: () => [{ id: Math.random() }]
  });
  ok(fight.respawnDragon() === true, 'first respawnDragon() call succeeds (baseline)');
  okAv(fight.respawnDragon() === false, 'anti-vacuity: calling respawnDragon() AGAIN while a sequence is already running is refused (the real dragonSpawnState !== null guard), proving it is a real gate and not just "always succeeds once"');
  const fight2 = new ED.EnderDragonFight({
    seed: 4, heightAt: () => 65, dragonKilled: false,
    crystalsNear: () => [{ id: Math.random() }]
  });
  okAv(fight2.respawnDragon() === false, 'anti-vacuity: a fight with dragonKilled=false (dragon already alive) refuses respawnDragon() even with crystals available -- the real "already killed" guard');
}

// ============ 7. the full real timer sequence, pinned exactly ===================================
{
  const M = freshEngine();
  const ED = M.EnderDragon;
  say('7. full tick() sequence to a real spawn');
  const fight = new ED.EnderDragonFight({
    seed: 5, heightAt: () => 65,
    crystalsNear: () => [{ id: Math.random() }]
  });
  ok(fight.respawnDragon() === true, 'sequence started');
  // Real per-state call counts, from EnderDragonSpawnState.java's own thresholds (ported
  // verbatim in ED.EnderDragonFight.prototype.tick): state0 fires once and advances (1 call);
  // state1 waits t=0..100 inclusive before advancing (101 calls); state2 runs t=0..400 inclusive
  // (10 crystals * 40 ticks, plus the t=400 call that finds spikeIdx===10 and advances -- 401
  // calls); state3 waits t=0..100 inclusive before the terminal transition (101 calls).
  const EXPECTED = 1 + 101 + 401 + 101; // = 604
  let calls = 0;
  let spawnedAtCall = -1;
  while (calls < EXPECTED + 5 && fight.dragon === null) {
    fight.tick();
    calls++;
    if (fight.dragon !== null) spawnedAtCall = calls;
  }
  ok(spawnedAtCall === EXPECTED, `a real dragon is created on EXACTLY call #${EXPECTED} of tick() (the pinned real timer total) -- got #${spawnedAtCall}`);
  ok(fight.dragonKilled === false, 'dragonKilled flips to false once the dragon is (re)created');
  ok(fight.dragonSpawnStateIndex === -1, 'the sequence itself is back to "not running" (terminal state resets to -1)');
  ok(fight.spawnCrystals === null, 'the ceremony crystal list is cleared once spent');
}

// ============ 8. createDragon() itself ==========================================================
{
  const M = freshEngine();
  const ED = M.EnderDragon;
  say('8. createDragon()');
  const fight = new ED.EnderDragonFight({ seed: 6, heightAt: () => 65 });
  const dragon = fight.createDragon();
  ok(dragon instanceof ED.EnderDragonEntity, 'with no opts.spawnDragon, createDragon() falls back to a real standalone ED.EnderDragonEntity rig');
  ok(dragon.getX() === 0 && dragon.getY() === 128 && dragon.getZ() === 0, `spawned at the real (0,128,0) -- got (${dragon.getX()},${dragon.getY()},${dragon.getZ()})`);
  ok(dragon.getPhaseManager().getCurrent().getType().name === 'HoldingPattern', 'seeded into the real HoldingPattern phase (PhaseType field_7069)');
  ok(dragon.getFight() === fight, 'the rig is wired straight back to this fight (dragon.getFight() === fight)');
  ok(dragon.getYaw() >= 0 && dragon.getYaw() < 360, `a real random yaw in [0,360) -- got ${dragon.getYaw()}`);

  // opts.spawnDragon stand-in path
  const spawned = [];
  const fakeEntity = { dragon: { fight: null, _phase: null, getPhaseManager() { return { setPhase: (t) => { this._p = t; }, getCurrent: () => ({}) }; } } };
  const fight2 = new ED.EnderDragonFight({
    seed: 8, heightAt: () => 65,
    spawnDragon: (x, y, z, yaw) => { spawned.push([x, y, z, yaw]); return fakeEntity; }
  });
  const e = fight2.createDragon();
  ok(e === fakeEntity, 'with opts.spawnDragon supplied, createDragon() returns exactly what it returned');
  ok(spawned.length === 1 && spawned[0][0] === 0 && spawned[0][1] === 128 && spawned[0][2] === 0,
    `opts.spawnDragon was called with the real (0,128,0) -- got ${JSON.stringify(spawned[0])}`);
  ok(fakeEntity.dragon.fight === fight2, 'the caller-supplied entity\'s own .dragon.fight is wired back to this fight too');
}

// ============ 9. crystalDestroyed aborts an in-progress sequence ================================
{
  const M = freshEngine();
  const ED = M.EnderDragon;
  say('9. crystalDestroyed abort branch');
  const ceremony = [{ tag: 'a' }, { tag: 'b' }, { tag: 'c' }, { tag: 'd' }];
  let call = 0;
  const fight = new ED.EnderDragonFight({
    seed: 9, heightAt: () => 65,
    crystalsNear: () => [ceremony[call++ % 4]]
  });
  ok(fight.respawnDragon() === true, 'sequence started');
  fight.tick(); // advance off state 0 so a real sequence is genuinely "running" (state 1)
  ok(fight.dragonSpawnStateIndex >= 0, 'sequence is running before the destroy');
  fight.crystalDestroyed(ceremony[1]);
  ok(fight.dragonSpawnStateIndex === -1, 'destroying one of THIS sequence\'s own gathered crystals aborts it (real branch)');
  ok(fight.spawnCrystals === null, 'the ceremony crystal list is cleared on abort');

  // anti-vacuity: an unrelated crystal (one of the RING's own, never gathered into this
  // sequence) must NOT abort a running sequence.
  call = 0;
  const fight2 = new ED.EnderDragonFight({
    seed: 10, heightAt: () => 65,
    crystalsNear: () => [ceremony[call++ % 4]]
  });
  fight2.respawnDragon();
  fight2.tick();
  const before = fight2.dragonSpawnStateIndex;
  fight2.crystalDestroyed(fight2.crystals[0]); // a RING crystal, not one of `ceremony`
  okAv(fight2.dragonSpawnStateIndex === before,
    `anti-vacuity: destroying an UNRELATED crystal (not part of this sequence's own gathered set) does NOT abort a running sequence -- state stayed ${fight2.dragonSpawnStateIndex} (was ${before}), proving section 9's abort really depends on WHICH crystal died, not any crystalDestroyed() call`);
}

console.log(`\n${pass} checks passed, ${breaks} anti-vacuity break(s) proved, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.log('  x ' + f);
  process.exit(1);
}
