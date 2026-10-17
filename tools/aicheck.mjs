#!/usr/bin/env node
// aicheck.mjs — D-391 (PASS 16 JOB 1, live wiring): Ai.selectorFor/GoalSelector.tick() on an
// ACTUALLY SPAWNED cow/zombie, through the real EntityList.tick() loop — not the synthetic
// fixture goalcheck.mjs drives the same algorithm against.
//
//   node tools/aicheck.mjs [--verbose]
//
// ⚠⚠ WHAT THIS PROVES, AND WHY IT IS A SEPARATE FILE FROM goalcheck.mjs. `07k_goals.js`'s own
// GoalSelector/pathfinding/goal ALGORITHM is goalcheck.mjs's question and stays there — this
// file does not re-litigate the flag-conflict rule or the cliff refusal, both already proven.
// What goalcheck.mjs's own header says it cannot do is the question here: does a mob spawned by
// `EL.spawn` actually get a goal selector, does `EL.tick()` actually run it, and does the LIVE
// world context (`EL.aiCtx`, D-391) behave like the live world rather than a snapshot of it.
//
// ⚠ THE JOIN THIS FOUND (D-276's shape, again): `Cb.hurt` computes damage and nothing else, and
// nothing else in the engine ever set `justHurt`/`hurtFromX`/`hurtFromZ`/`lastHurtByEntity` —
// the exact three fields `PanicGoal` and `HurtByTargetGoal` read. Both sides were already
// tested (`combatcheck.mjs` for the damage math, `goalcheck.mjs` for the goals against
// hand-set fields) and the seam between them was simply empty until `Cb.notifyHurt` (D-391).
// Section 4 below is the one that would have failed had that seam stayed open.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; if (VERBOSE) console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (VERBOSE) console.log(...a); };

console.log('aicheck — D-391: Ai wired into a live per-tick loop against an actually spawned mob');

const M = loadEngine({
  extra: ['07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
          '14i_hand.js', '14j_combat.js', '14d_survival.js', '07k_goals.js', '07l_spawn.js']
});
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8'))
});
M.Entities.init();
M.EntityList.init();
M.Hand.init();
M.Combat.init();
M.Ai.init();
ok(M.Entities.ready, 'the entity table loaded');
ok(M.Ai.ready, 'Ai module reports ready');
ok(M.Combat.ready, 'Combat module reports ready');

const EL = M.EntityList, Ai = M.Ai, Cb = M.Combat, W = M.World, CH = M.CH, Sv = M.Survival;
const stateOf = (n) => M.States.stateOf(n) | 0;
const STONE = stateOf('stone');
const PLAT_Y = 8;

function freshWorld() {
  W.init(1);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
    const c = W.makeChunk(cx, cz);
    c.state = CH.GENERATED;
    W.chunks.set(W.key(cx, cz), c);
  }
  ok(W.loadedAt(0, 0), 'a chunk is loaded to place into');
}
function plate(radius) {
  // #1495: solid ground under the plate, as in any real world -- FuzzyTargeting (WanderAroundFarGoal) only keeps a
  // candidate with an opaque block under it, and its vertical fuzz reaches 7 below the mob.
  for (let x = -radius; x <= radius; x++) for (let z = -radius; z <= radius; z++) {
    for (let y = PLAT_Y - 7; y <= PLAT_Y; y++) W.setBlock(x, y, z, STONE);
  }
}
/** The same fixture combatcheck.mjs uses to drive `Cb.attack` with real player fields. */
function mkPlayer(over) {
  return Object.assign({
    x: 0, y: PLAT_Y + 1, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0, slot: 0, inventory: null,
    sprinting: false, onGround: true, fallDistance: 0, onClimbable: false, inWater: false,
    walkDist: 0, walkDistO: 0, speed: 0.1
  }, over || {});
}

// ═══ 1. EL.spawn attaches a real goal selector — and only where the roster says to ═══════════
console.log('\n 1. EL.spawn attaches a real goal selector — and only where the roster says to');
freshWorld();
plate(15);
{
  const cow = EL.spawn('cow', 0, PLAT_Y + 1, 0);
  ok(!!cow, 'a cow could be spawned');
  ok(cow.ai instanceof Ai.GoalSelector, 'the spawned cow carries a real GoalSelector, not a stub');
  const zom = EL.spawn('zombie', 3, PLAT_Y + 1, 0);
  ok(!!zom && zom.ai instanceof Ai.GoalSelector, 'the spawned zombie carries a real GoalSelector too');
  const item = EL.spawn('item', 0, PLAT_Y + 1, 0, { item: 0, count: 1 });
  ok(!!item && item.ai === undefined, 'a type Ai.ROSTER does not cover gets no e.ai at all — no silent stub');
  EL.clear();

  // ANTI-VACUITY: empty the roster and prove the gate above is what attached `e.ai`, not luck
  const savedRoster = Ai.ROSTER;
  Ai.ROSTER = {};
  const noAi = EL.spawn('cow', 0, PLAT_Y + 1, 0);
  okAv(!!noAi && noAi.ai === undefined,
       'with Ai.ROSTER emptied, a cow spawns with no goal selector at all — the gate is real');
  Ai.ROSTER = savedRoster;
  EL.clear();
}

// ═══ 2. a live-spawned cow actually walks, ticked through EL.tick — not just BUILT ═══════════
console.log('\n 2. a live-spawned cow actually walks, driven by EntityList.tick, not just built');
freshWorld();
plate(12);
{
  const origRandom = Math.random;
  Math.random = () => 0.001;   // forces WaterAvoidingRandomStrollGoal's roll every idle tick
  const cow = EL.spawn('cow', 0, PLAT_Y + 1, 0);
  const x0 = cow.x, z0 = cow.z;
  for (let t = 0; t < 300; t++) EL.tick();
  Math.random = origRandom;
  const moved = Math.hypot(cow.x - x0, cow.z - z0);
  ok(moved > 0.5,
     `the cow's own position moved ${moved.toFixed(2)} blocks over 300 real EntityList.tick() calls — the goal object was actually driven, not merely built and left untouched`);
  ok(Math.abs(cow.x) <= 13 && Math.abs(cow.z) <= 13,
     'and it stayed on the 12-block plate it was told to path within — findPath/groundLevel refused every target beyond the edge, exactly as goalcheck.mjs already proves the algorithm does');
  EL.clear();
}

// ═══ 3. NearestAttackableTargetGoal targets the LIVE player, not a snapshot of it ═════════════
console.log('\n 3. a zombie targets the LIVE player object, and re-reads it, not a snapshot');
freshWorld();
plate(15);
{
  M.Player = mkPlayer({ x: 5, y: PLAT_Y + 1, z: 0 });
  const zom = EL.spawn('zombie', 0, PLAT_Y + 1, 0);
  for (let t = 0; t < 200 && !zom.target; t++) EL.tick();   // #4450: vanilla 1-in-10 acquire roll
  ok(zom.target === M.Player,
     "the zombie's own e.target IS the live Player object, by reference — EL.aiCtx's own header says this is deliberate");
  M.Player.x = 30;   // move the player far away, mid-test, without re-spawning or re-wiring anything
  for (let t = 0; t < 5; t++) EL.tick();
  ok(!!zom.target && zom.target.x === 30,
     "and the goal reads the player's CURRENT position next tick — a context that had snapshotted the player would still say 5");
  EL.clear();
}

// ═══ 4. the join D-276 warns about: a REAL Cb.attack is what makes a hurt mob react ══════════
console.log('\n 4. a real Cb.attack — not a hand-set field — is what makes a hurt mob react');
freshWorld();
plate(15);
{
  const P = mkPlayer({ x: 0, y: PLAT_Y + 1, z: 5 });
  const cow = EL.spawn('cow', 0, PLAT_Y + 1, 0);
  const res = Cb.attack(P, cow);
  ok(!!(res && res.hit), 'Cb.attack actually landed on the cow');
  ok(cow.justHurt === true, "and Cb.notifyHurt set justHurt — the field PanicGoal's canUse reads");
  ok(cow.lastHurtByEntity === P, 'and recorded the LIVE attacker — the field HurtByTargetGoal reads');
  ok(cow.hurtFromX === P.x && cow.hurtFromZ === P.z, 'and the position it was hurt FROM, for PanicGoal to flee opposite it');
  // Vanilla EscapeDangerGoal runs to RANDOM 5x4-box spots -- no away-from-attacker term (goalcheck s4,
  // cloud unit referee-mob-avoid-panic) -- so the join is proven by the cow RUNNING at all (displacement
  // from where it stood), not by direction. Measured from tick 10, once the knockback has spent itself:
  // knockback alone carries the cow a block and dies out in a few ticks.
  for (let t = 0; t < 10; t++) EL.tick();
  const x0 = cow.x, z0 = cow.z;
  let ran = 0;
  for (let t = 0; t < 40; t++) { EL.tick(); ran = Math.max(ran, Math.hypot(cow.x - x0, cow.z - z0)); }
  ok(ran > 1.5,
     `PanicGoal actually ran off a REAL Cb.attack hit: up to ${ran.toFixed(2)} blocks in ticks 10..50 after the hit`);
  EL.clear();

  const P2 = mkPlayer({ x: 0, y: PLAT_Y + 1, z: 5 });
  const zom = EL.spawn('zombie', 0, PLAT_Y + 1, 0);
  Cb.attack(P2, zom);
  EL.tick();
  ok(zom.target === P2,
     "HurtByTargetGoal set the zombie's e.target to its own live attacker off a real hit alone");
  EL.clear();

  // ANTI-VACUITY: silence the hook Cb.attack calls, and the SAME real hit no longer reaches a goal
  const savedNotify = Cb.notifyHurt;
  Cb.notifyHurt = function () {};
  const P3 = mkPlayer({ x: 0, y: PLAT_Y + 1, z: 5 });
  const cow2 = EL.spawn('cow', 0, PLAT_Y + 1, 0);
  const res2 = Cb.attack(P3, cow2);
  okAv(!!(res2 && res2.hit) && !cow2.justHurt,
       'with Cb.notifyHurt silenced, the same real hit still lands (damage keeps working) but the cow never learns of it — proving section 4 above is driven by the hook, not by Cb.hurt itself');
  Cb.notifyHurt = savedNotify;
  EL.clear();
}


// ═══ 5. D-394 — the strike itself: Cb.mobAttack lands through MeleeAttackGoal, on cooldown ═══
console.log('\n 5. the strike: a zombie in reach actually hits the live player, on a real cooldown');
freshWorld();
plate(15);
{
  const P = M.Survival.init(mkPlayer({ x: 0, y: PLAT_Y + 1, z: 0.5, width: 0.6, height: 1.8 }));
  P.naturalRegen = false;   // isolate the strike from Sv.tick's own unrelated regen system
  M.Player = P;
  const zom = EL.spawn('zombie', 0, PLAT_Y + 1, 0);   // 0.5 blocks away — inside attackReachSqr
  zom.target = P;
  const dmg = M.Entities.attrsOf('zombie').dmg;
  ok(dmg > 0, `zombie's own ATTACK_DAMAGE row is a real positive number (${dmg}), not a guess`);

  // Sv.tick(P) is the real per-tick decrement of P.invulnerable (LivingEntity.hurt's own grace
  // window) — the wider game loop calls it every tick alongside EL.tick(); this test drives it
  // explicitly so a SECOND real strike is not swallowed by the invulnerability window that
  // 20-tick attack cooldown and 20-tick hurt grace happen to share the same number for.
  const tick = () => { EL.tick(); Sv.tick(P); };

  const h0 = P.health;
  tick();
  ok(P.health === h0 - dmg,
     `one tick in reach cost the player exactly the zombie's own attack damage (${h0} -> ${P.health}, expected ${h0 - dmg})`);
  ok(P.killedBy && P.killedBy.length > 0, `the player's killedBy is now set to the attacker's own name: ${JSON.stringify(P.killedBy)}`);

  const h1 = P.health;
  tick();
  ok(P.health === h1, 'and the VERY NEXT tick does not hit again — the 20-tick cooldown gates it, not just distance');

  for (let t = 0; t < 18; t++) tick();   // 19 ticks since the first hit; still on cooldown
  ok(P.health === h1, 'still no second hit at 19 ticks — one tick short of the real 20-tick interval');
  tick();                                 // the 20th tick since the first hit
  ok(P.health === h1 - dmg,
     'and the 20th tick lands the second hit exactly on schedule — Ai.MOB_ATTACK_INTERVAL is really 20, not approximate');
  EL.clear();

  // ANTI-VACUITY: push the target out of Ai.attackReachSqr and the same live loop must not hit
  const P2 = M.Survival.init(mkPlayer({ x: 0, y: PLAT_Y + 1, z: 6, width: 0.6, height: 1.8 }));
  P2.naturalRegen = false;
  M.Player = P2;
  const zom2 = EL.spawn('zombie', 0, PLAT_Y + 1, 0);
  zom2.target = P2;   // in range for pathing/targeting, but well outside the STRIKE reach formula
  const h2 = P2.health;
  for (let t = 0; t < 5; t++) EL.tick();
  okAv(P2.health === h2,
       'out of Ai.attackReachSqr, five real EL.tick() calls land no strike at all — proving section 5 above is the reach gate firing, not luck');
  EL.clear();
}

// ═══ 6. D-402 — the live arrow: a spawned skeleton's own onShoot actually lands ═══════════════
console.log('\n 6. D-402: a live skeleton\'s onShoot spawns a real arrow, and it actually lands');
freshWorld();
plate(20);
{
  const P = M.Survival.init(mkPlayer({ x: 6, y: PLAT_Y + 1, z: 0, width: 0.6, height: 1.8 }));
  P.naturalRegen = false;
  M.Player = P;
  const skel = EL.spawn('skeleton', 0, PLAT_Y + 1, 0);
  ok(!!skel, 'a skeleton could be spawned');
  skel.target = P;
  const before = EL.list.length;
  const ctx = EL.aiCtx(skel);
  ok(typeof ctx.onShoot === 'function', 'EL.aiCtx wires a real onShoot, not undefined (goalcheck.mjs\'s own synthetic one is separate)');
  // D-597: the shot now carries setVelocity's gaussian spread and applyEnchantmentEffects'
  // gaussian damage roll; pin java's nextGaussian to 0 (Box-Muller at v=0.25 -> cos(pi/2)) so
  // this section tests the WIRING, not the dice. The spread itself: combatcheck-free, §6b below.
  const realRandom = Math.random; Math.random = () => 0.25;
  const arrow = ctx.onShoot(skel, P);
  Math.random = realRandom;
  ok(!!arrow && arrow.type === 'arrow', 'onShoot actually spawned a live arrow entity');
  ok(EL.list.length === before + 1, 'and it is really in the live EntityList, not a detached object');
  ok(arrow.shooter === skel, 'the arrow remembers its own shooter, so Combat.tickArrow can refuse to hit it');
  const aimedAtTarget = (arrow.x - skel.x) * (P.x - skel.x) >= 0 || Math.hypot(P.x - skel.x, P.z - skel.z) < 1;
  ok(aimedAtTarget, 'and it left the bow heading toward the target, not an arbitrary direction');

  const h0 = P.health;
  let landed = false;
  // D-597: the damage is onEntityHit's ceil(|velocity| * arrow.damage) — record what the code
  // computed at the hit and hold the health drop to THAT (the check owns no number).
  const realHitDmg = Cb.arrowHitDamage; let lastHitDmg = null;
  Cb.arrowHitDamage = function (a) { lastHitDmg = realHitDmg(a); return lastHitDmg; };
  for (let t = 0; t < 60 && !landed; t++) {
    EL.tick(); Sv.tick(P);
    if (P.health < h0) landed = true;
  }
  ok(landed, `the live arrow actually reduced the player's health within 60 ticks (still ${P.health}/${h0} otherwise)`);
  Cb.arrowHitDamage = realHitDmg;
  ok(lastHitDmg !== null && P.health === h0 - lastHitDmg, `and by exactly the velocity-scaled hit damage (${lastHitDmg}): ${h0} -> ${P.health}`);
  ok(arrow.arrowDamage > 1.2 && arrow.arrowDamage < 3.5, `the arrow's own damage field was rolled by applyEnchantmentEffects (2*pull + N(0,0.25) + 0.22 at normal): ${arrow.arrowDamage}`);
  okAv(lastHitDmg > Cb.ARROW_BASE_DAMAGE, `a 1.6-speed arrow hits for MORE than the flat field default ${Cb.ARROW_BASE_DAMAGE} (got ${lastHitDmg}) — the old unscaled damage would fail this`);
  EL.clear();

  // §6b D-597: the spread is real — 14 - difficulty*4 (normal: 6) * 0.0075 per axis. Two shots
  // from the same pose with different dice leave in different directions; with the dice pinned
  // to gaussian 0 they are identical. And HARD narrows it (divergence 2).
  {
    const sk = EL.spawn('skeleton', 0, PLAT_Y + 1, 0), tg = { x: 10, y: PLAT_Y + 1, z: 0, height: 1.8 };
    const z0 = () => 0.5;
    const a1 = Cb.mobShoot(sk, tg, 1, z0), a2 = Cb.mobShoot(sk, tg, 1, z0);
    ok(a1.vx === a2.vx && a1.vy === a2.vy && a1.vz === a2.vz, 'pinned dice: two shots are identical');
    ok(Math.abs(Math.hypot(a1.vx, a1.vy, a1.vz) - Math.fround(1.6)) < 1e-9, 'with no jitter the launch speed is exactly setVelocity\'s 1.6');
    let seq = [0.9, 0.9, 0.3, 0.1, 0.7, 0.6, 0.2, 0.8], k = 0; const dice = () => seq[(k++) % seq.length];
    const a3 = Cb.mobShoot(sk, tg, 1, dice);
    okAv(Math.abs(a3.vz - a1.vz) > 1e-4, 'anti-vacuity: real dice move the shot sideways (vz ' + a3.vz.toFixed(4) + ' vs ' + a1.vz.toFixed(4) + ')');
    const spreadAt = (lvl) => { M.Diff.set(lvl); k = 0; dice.haveG = false; const a = Cb.mobShoot(sk, tg, 1, dice); return Math.abs(a.vz - a1.vz); };
    const sNormal = spreadAt('normal'), sHard = spreadAt('hard'), sEasy = spreadAt('easy');
    M.Diff.set('normal');
    ok(sHard < sNormal && sNormal < sEasy, `spread scales with 14 - difficulty*4: easy ${sEasy.toFixed(4)} > normal ${sNormal.toFixed(4)} > hard ${sHard.toFixed(4)}`);
    ok(Math.abs(sEasy / sNormal - 10 / 6) < 0.02, `the easy:normal spread ratio is 10:6 (${(sEasy / sNormal).toFixed(3)})`);
    EL.clear();
  }

  // ANTI-VACUITY: an arrow aimed straight down must freeze into the ground, not fly forever
  const stray = EL.spawn('arrow', 0, PLAT_Y + 3, 0, { vx: 0, vy: -0.01, vz: 0, shooter: null });
  okAv(!!stray, 'a bare arrow could be spawned for the ground-freeze case');
  for (let t = 0; t < 40; t++) EL.tick();
  const restX = stray.x, restY = stray.y, restZ = stray.z;
  const wasStuck = stray.stuck === true;
  for (let t = 0; t < 10; t++) EL.tick();
  okAv(wasStuck && stray.x === restX && stray.y === restY && stray.z === restZ,
       'and once it lands it FREEZES — still at the same position ten ticks later, proving Combat.tickArrow\'s onGround branch actually fires rather than the arrow just happening to stop');
  EL.clear();

  // ANTI-VACUITY: an arrow must not hit its own shooter, even standing directly inside it
  const skel2 = EL.spawn('skeleton', 0, PLAT_Y + 1, 0);
  const selfArrow = EL.spawn('arrow', skel2.x, skel2.y + 0.5, skel2.z, { vx: 0, vy: 0, vz: 0, shooter: skel2 });
  const hp0 = skel2.health;
  for (let t = 0; t < 5; t++) EL.tick();
  okAv(skel2.health === hp0 && !selfArrow.removed,
       'an arrow sitting inside its own shooter does not hurt it and is not consumed — Combat.tickArrow\'s own shooter exclusion is real, not vacuous overlap logic that happens never to trigger');
  EL.clear();
}


// ═══ 7. D-486 — iron golem's real registerGoals(): retaliation + hostile-mob attack AI ═══════
console.log('\n 7. D-486: a live iron golem actually fights back and attacks nearby hostile mobs');
freshWorld();
plate(15);
{
  // retaliation: a real Cb.attack on the golem sets its target AND its (now golem-shared) anger timer
  const P = mkPlayer({ x: 0, y: PLAT_Y + 1, z: 1 });
  const golem = EL.spawn('iron_golem', 0, PLAT_Y + 1, 0);
  ok(!!golem, 'an iron golem could be spawned');
  Cb.attack(P, golem);
  EL.tick();
  ok(golem.target === P, "HurtByTargetGoal set the golem's target to its own live attacker");
  ok(golem.angerTime > 0, 'and the anger timer actually started — golem is now gated into the shared wolf/golem anger range, not left at 0');
  EL.clear();

  // ANTI-VACUITY: with the hurt hook silenced, the same real hit leaves the golem un-angered
  const savedNotify = Cb.notifyHurt;
  Cb.notifyHurt = function () {};
  const P2 = mkPlayer({ x: 0, y: PLAT_Y + 1, z: 1 });
  const golem2 = EL.spawn('iron_golem', 0, PLAT_Y + 1, 0);
  Cb.attack(P2, golem2);
  EL.tick();
  okAv(!golem2.target && !golem2.angerTime,
       "with Cb.notifyHurt silenced, the same real hit lands but the golem never learns of it or gets angry — section 7's retaliation above is the hook firing, not luck");
  Cb.notifyHurt = savedNotify;
  EL.clear();

  // proactive hostile-mob targeting: Ai.ROSTER.iron_golem's own candidate function reads
  // Spawn.categoryOf — mocked here to isolate this JOIN from biome/spawn data correctness,
  // which categorycheck/spawncheck already own.
  M.Spawn = { categoryOf: (t) => (t === 'zombie' ? 'monster' : null) };
  const zom = EL.spawn('zombie', 3, PLAT_Y + 1, 0);
  const golem3 = EL.spawn('iron_golem', 0, PLAT_Y + 1, 0);
  // vanilla: the golem's monster target goal starts on a 1-in-5 roll each tick (reciprocalChance 5, #3676), so ONE tick is not enough
  for (let t = 0; t < 100 && golem3.target !== zom; t++) EL.tick();
  ok(golem3.target === zom, "NearestAttackableTargetGoal picked the nearby 'monster'-category mob with no hit needed at all");
  const zh0 = zom.health;
  for (let t = 0; t < 40 && zom.health === zh0; t++) EL.tick();
  ok(zom.health < zh0, "and MeleeAttackGoal actually landed a real strike on it within 40 ticks (still {$zh0} otherwise)".replace('{$zh0}', zh0));
  EL.clear();

  // ANTI-VACUITY: the SAME nearby zombie is ignored once nothing classifies it as hostile
  M.Spawn = { categoryOf: () => null };
  const zom2 = EL.spawn('zombie', 3, PLAT_Y + 1, 0);
  const golem4 = EL.spawn('iron_golem', 0, PLAT_Y + 1, 0);
  for (let t = 0; t < 5; t++) EL.tick();
  okAv(golem4.target !== zom2,
       "with Spawn.categoryOf answering null for everything, the same nearby zombie is never targeted — proving the targeting above reads the category, not just proximity");
  EL.clear();
  delete M.Spawn;
}

console.log(`\n${pass} ok, ${breaks} anti-vacuity breaks caught, ${fails.length} failed`);
if (fails.length) { fails.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
process.exit(0);
