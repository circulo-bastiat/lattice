#!/usr/bin/env node
// wolfgoalcheck.mjs — loop/wolfgoals: wolf's full registerGoals() (bje.u(), .decomp, read in
// full, D-477 continued) and spider's own targetSelector priority 3 (IronGolem, .decomp
// SpiderEntity.java:63), both closed off `Ai.OWED`.
//
//   node tools/wolfgoalcheck.mjs [--verbose]
//
// ⚠ WHAT THIS PROVES. `goalcheck.mjs`/`aicheck.mjs` already prove the GoalSelector/pathfinding
// ALGORITHM and the EL.spawn/EL.tick live-wiring shape; this file does not re-litigate either.
// It proves the SIX NEW wolf() entries this pass adds — llama-flee (AvoidLlamaGoal), begging
// (WolfBegGoal), and four TARGET goals (AngryPlayerTargetGoal, UntamedActiveTargetGoal x2,
// AbstractSkeleton NearestAttackableTargetGoal, UniversalAngerGoal) — actually behave the way
// `.decomp/net/minecraft/entity/passive/WolfEntity.java`'s own `initGoals()` says they should,
// against a REALLY spawned wolf (`EL.spawn`), not a hand-built fixture — and that spider's
// targetSelector priority 3 (`.decomp/net/minecraft/entity/mob/SpiderEntity.java:63`) really
// reaches a real iron golem through `EL.aiCtx`'s own `ctx.golems()`.

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

console.log('wolfgoalcheck — loop/wolfgoals: wolf\'s full registerGoals() + spider\'s IronGolem target');

const M = loadEngine({
  extra: ['07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
          '07k_goals.js', '07zj_fox.js', '07l_spawn.js', '07m_breed.js', '07r_mount.js', '07w_passive.js', '14i_hand.js', '14j_combat.js', '14d_survival.js']
});
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8'))
});
M.Entities.init();
M.EntityList.init();
M.Breed.init && M.Breed.init();
M.Mount.init();
M.Ai.init();
M.Combat.init();
ok(M.Entities.ready, 'the entity table loaded');
ok(M.Ai.ready, 'Ai module reports ready');

const EL = M.EntityList, Ai = M.Ai, W = M.World, CH = M.CH;
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
  for (let x = -radius; x <= radius; x++) for (let z = -radius; z <= radius; z++) {
    W.setBlock(x, PLAT_Y, z, STONE);
  }
}
function mkPlayer(over) {
  return Object.assign({
    x: 0, y: PLAT_Y + 1, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0, slot: 0, inventory: null,
    sprinting: false, onGround: true, fallDistance: 0, onClimbable: false, inWater: false,
    walkDist: 0, walkDistO: 0, speed: 0.1, heldItem: null
  }, over || {});
}
function entryAt(gs, priority, flags) {
  for (const en of gs.entries) if (en.priority === priority && en.flags === flags) return en;
  return null;
}

// ═══ 1. Ai.UntamedActiveTargetGoal (generic wrapper, both wolf uses share it) ════════════════
console.log('\n 1. Ai.UntamedActiveTargetGoal refuses outright while the mob is tamed');
freshWorld();
plate(15);
{
  const wolf = EL.spawn('wolf', 0, PLAT_Y + 1, 0);
  const sheep = EL.spawn('sheep', 2, PLAT_Y + 1, 0);
  ok(!!wolf && !!sheep, 'a wolf and a sheep both spawn');
  const getSheep = () => [sheep];

  wolf.tamed = false;
  const rollLands = { nextInt: () => 0 }, rollFails = { nextInt: (n) => n - 1 };   // goals draw from e.random (Ai.nextIntOf), not the injected rand
  wolf.random = rollLands;
  const g = new Ai.UntamedActiveTargetGoal(wolf, getSheep, () => 0);
  ok(g.reciprocalChance === 10 && g.vertical === 4, 'wrapper carries reciprocalChance 10 + vertical 4 (#4149)');
  { const hi = EL.spawn('sheep', 2, PLAT_Y + 7, 0); const h = new Ai.UntamedActiveTargetGoal(wolf, () => [hi], () => 0); wolf.tamed = false; wolf.target = null;
    okAv(h.canUse() === false, 'a sheep 6 blocks above is outside the +-4 box (#4149)');
    const m = new Ai.UntamedActiveTargetGoal(wolf, getSheep, () => 0.99); wolf.target = null; wolf.random = rollFails;
    okAv(m.canUse() === false, 'a failed 1-in-10 roll refuses acquisition (#4149)'); }
  wolf.random = rollLands;
  ok(g.canUse() === true, 'an UNTAMED wolf acquires the nearby sheep');
  ok(wolf.target === sheep, 'and e.target is set to the live sheep object');

  wolf.target = null;
  wolf.tamed = true;
  ok(g.canUse() === false, 'the SAME wolf, now TAMED, refuses to acquire it at all');

  // ANTI-VACUITY: the bare inner goal (no tamed gate) still finds it while tamed — proving the
  // wrapper's own gate, not the sheep being out of range or something else, is what refused above.
  const bare = new Ai.NearestAttackableTargetGoal(wolf, getSheep);
  okAv(bare.canUse() === true,
       'and the UNGATED NearestAttackableTargetGoal still finds the same sheep on the same tamed wolf — the refusal above is UntamedActiveTargetGoal\'s own tamed check, not a fluke');
  wolf.target = null;
  EL.clear();
}

// ═══ 1b. SitGoal control flags: vanilla SitGoal.setControls(EnumSet.of(JUMP, MOVE)) (#911) ═══
console.log('\n 1b. wolf SitGoal registered MOVE|JUMP');
freshWorld();
{
  const wolf = EL.spawn('wolf', 0, PLAT_Y + 1, 0);
  const sit = wolf.ai.entries.find(en => en.goal instanceof Ai.SitGoal);
  ok(!!sit && sit.flags === (Ai.MOVE | Ai.JUMP), 'wolf SitGoal flags are MOVE|JUMP');
  okAv(!!sit && sit.flags !== Ai.MOVE, 'a MOVE-only registration would differ from the real one — the flag assertion can fail');
  EL.clear();
}

// ═══ 2. wolf() MOVE — AvoidLlamaGoal (priority 3): untamed + a strength roll, not automatic ══
console.log('\n 2. wolf()\'s AvoidLlamaGoal: untamed only, strength beats a real roll, clears e.target');
freshWorld();
plate(20);
{
  // KW-45 follow-up: canUse() now genuinely re-derives vanilla FleeEntityGoal's own fuzzed
  // escape-point search (10 candidates, real RNG) instead of a pure distance check, so it is
  // exactly as probabilistic per attempt as the real goal selector's own per-tick retries --
  // `tryCanUse` mirrors test 1's own reciprocalChance retry loop above for the same reason.
  const tryCanUse = (g, tries) => { for (let i = 0; i < (tries || 30); i++) if (g.canUse()) return true; return false; };
  const origRandom = Math.random;
  Math.random = () => 0.9; EL.random = () => Math.random();   // Math.floor(0.9 * 5) === 4 — a fixed, known roll
  const wolf = EL.spawn('wolf', 0, PLAT_Y + 1, 0);
  const llama = EL.spawn('llama', 2, PLAT_Y + 1, 0);
  M.Mount.setStrength(llama, 5);   // 5 >= 4 — this llama SHOULD scare the wolf
  Math.random = origRandom;
  ok(!!wolf && !!llama, 'a wolf and a llama both spawn');
  const avoidLlama = entryAt(wolf.ai, 3, Ai.MOVE);
  ok(!!avoidLlama, 'wolf() carries a priority-3 MOVE entry (AvoidLlamaGoal)');

  wolf.target = 'something';   // AvoidLlamaGoal.start() must clear this, same as the jar's own override
  ok(tryCanUse(avoidLlama.goal) === true, 'the untamed wolf is scared of a strength-5 llama on a fixed roll of 4');
  avoidLlama.goal.start();
  ok(wolf.target === null, 'and start() clears e.target, the same setTarget(null) AvoidLlamaGoal.start()/tick() both call');

  wolf.tamed = true;
  ok(avoidLlama.goal.canUse() === false, 'the SAME wolf, TAMED, never flees the same llama at all');
  wolf.tamed = false;

  M.Mount.setStrength(llama, 1);   // 1 >= 4 is false — this weak llama should NOT scare it
  // the strength roll and the escape-point fuzz search now share the SAME rand source (`ctx.
  // random`, same as vanilla's own `mob.getRandom()` -- both live off one per-mob Random),
  // so freezing it outright (as above) would also break the fuzz search structurally. Fix only
  // the FIRST call (the roll, read once per threat scan) and let every call after it -- the
  // fuzz search's own -- stay real.
  // The roll now comes AFTER the fuzz search (vanilla: super.canStart() && isScaredOf), so count
  // getStrength calls instead of positioning the roll in the RNG stream.
  const realGS = M.Mount.getStrength; let gsCalls = 0;
  M.Mount.getStrength = (l) => { gsCalls++; return realGS(l); };
  Math.random = () => 0.9;   // roll = 4; fuzz draws are all 0.9, so a failed canUse is possible -- loop
  let scared = false; for (let i = 0; i < 30; i++) if (avoidLlama.goal.canUse()) scared = true;
  Math.random = origRandom;
  ok(scared === false, 'and a strength-1 llama, roll of 4, does not scare it');

  // #4615: two llamas -- weak NEAREST (1), strong FAR (5). Vanilla rolls ONCE on the nearest only,
  // so the far strong llama must not make the weak nearest one scary, and getStrength is read
  // at most once per canUse.
  M.Mount.setStrength(llama, 1);
  const far = EL.spawn('llama', 8, PLAT_Y + 1, 0); M.Mount.setStrength(far, 5);
  Math.random = () => 0.9; let scared2 = false, maxPer = 0;
  for (let i = 0; i < 30; i++) { gsCalls = 0; if (avoidLlama.goal.canUse()) scared2 = true; maxPer = Math.max(maxPer, gsCalls); }
  Math.random = origRandom;
  ok(scared2 === false, 'a far strength-5 llama does not make a strength-1 NEAREST llama scary');
  ok(maxPer <= 1, 'canUse rolls getStrength at most once (not per candidate llama)');
  EL.remove ? EL.remove(far) : (far.dead = true);
  M.Mount.getStrength = realGS;

  // ANTI-VACUITY: the SAME threat list through a bare Ai.AvoidEntityGoal (no tame/strength gate)
  // still fires on the weak llama — proving the two refusals above are AvoidLlamaGoal's own
  // gates, not the llama being unreachable or some other accident.
  const bareAvoid = new Ai.AvoidEntityGoal(wolf, 24, 1.5, () => [llama], () => true);
  okAv(tryCanUse(bareAvoid) === true,
       'and an UNGATED AvoidEntityGoal against the same weak llama still flees it — the refusals above are the real gate firing');
  EL.clear();
}

// ═══ 3. wolf() LOOK — WolfBegGoal (priority 9): bone-if-tamed OR its own breeding item ═══════
console.log('\n 3. wolf()\'s WolfBegGoal: attractive food/bone within range sets e.begging');
freshWorld();
plate(15);
{
  M.Player = mkPlayer({ x: 3, y: PLAT_Y + 1, z: 0, heldItem: 'beef' });   // wolf's own breeding item
  const wolf = EL.spawn('wolf', 0, PLAT_Y + 1, 0);
  const beg = entryAt(wolf.ai, 9, Ai.LOOK);
  ok(!!beg, 'wolf() carries a priority-9 LOOK entry (WolfBegGoal)');
  ok(beg.goal.canUse() === true, 'an UNTAMED wolf begs at a player holding beef (its own breeding item, not bone-gated)');
  beg.goal.start();
  ok(wolf.begging === true, 'and start() sets e.begging');
  beg.goal.stop();
  ok(wolf.begging === false, 'stop() clears it again');

  M.Player.heldItem = 'bone';
  ok(beg.goal.canUse() === false, 'the SAME untamed wolf does NOT beg at a bone — bone only counts once tamed');
  wolf.tamed = true;
  ok(beg.goal.canUse() === true, 'but a TAMED wolf does beg at that same bone');

  M.Player.x = 50;   // far outside the 8-block begDistance
  ok(beg.goal.canUse() === false, 'and the same tamed wolf, same bone, refuses once the player is far away');
  EL.clear();
}

// ═══ 4. wolf() TARGET — the four new priorities (4-8), each a live acquisition ═══════════════
console.log('\n 4. wolf() targetSelector priorities 4-8: angry-player reacquire, prey, turtle, skeleton, anger');
freshWorld();
(M.DATA.gameRules = M.DATA.gameRules || {}).universalAnger = { t: 'b', d: 'true' };   // #4571: the goal is gated on this rule (default false)
plate(20);
{
  M.Player = mkPlayer({ x: 4, y: PLAT_Y + 1, z: 0 });
  const wolf = EL.spawn('wolf', 0, PLAT_Y + 1, 0);
  wolf.tamed = false;

  // priority 4 — AngryPlayerTargetGoal (ActiveTargetGoal<Player>(shouldAngerAt))
  const angry = entryAt(wolf.ai, 4, Ai.TARGET);
  ok(!!angry, 'wolf() carries a priority-4 TARGET entry (AngryPlayerTargetGoal)');
  wolf.angerTime = 200; wolf.target = null;
  { let got = false; for (let i = 0; i < 200 && !got; i++) got = angry.goal.canUse(); wolf.target = null;   // 1/5 reciprocal roll (#3677)
  ok(got === true, 'an angry, target-less wolf re-acquires the live player'); }
  wolf.angerTime = 0;
  ok(angry.goal.canUse() === false, 'and refuses once angerTime has run out');

  // priority 5 — UntamedActiveTargetGoal(prey: sheep/rabbit/fox)
  const preyEntry = entryAt(wolf.ai, 5, Ai.TARGET);
  ok(!!preyEntry, 'wolf() carries a priority-5 TARGET entry (prey)');
  const fox = EL.spawn('fox', 2, PLAT_Y + 1, 0);
  wolf.target = null;
  const hit = (g) => { for (let i = 0; i < 300; i++) if (g.canUse()) return true; return false; };   // 1-in-10 roll (#4149)
  ok(hit(preyEntry.goal), 'an untamed wolf acquires a nearby fox as prey (FOLLOW_TAMED_PREDICATE: sheep/rabbit/fox)');
  ok(wolf.target === fox, 'and targets the fox specifically');
  wolf.target = null; wolf.tamed = true;
  ok(preyEntry.goal.canUse() === false, 'a TAMED wolf never acquires the same fox as prey');
  wolf.tamed = false;

  // priority 6 — UntamedActiveTargetGoal(baby turtle on land)
  const turtleEntry = entryAt(wolf.ai, 6, Ai.TARGET);
  ok(!!turtleEntry, 'wolf() carries a priority-6 TARGET entry (baby turtle)');
  const adultTurtle = EL.spawn('turtle', 3, PLAT_Y + 1, 0);
  adultTurtle.isBaby = false; adultTurtle.inWater = false;
  wolf.target = null;
  ok(turtleEntry.goal.canUse() === false, 'an ADULT turtle on land is never targeted');
  const babyTurtle = EL.spawn('turtle', 3, PLAT_Y + 1, 1);
  babyTurtle.isBaby = true; babyTurtle.inWater = false;
  ok(hit(turtleEntry.goal), 'a BABY turtle ON LAND is targeted (BABY_TURTLE_ON_LAND_FILTER)');
  babyTurtle.inWater = true;
  wolf.target = null;
  ok(turtleEntry.goal.canUse() === false, 'the SAME baby turtle, now in water, is refused (!isTouchingWater() half of the filter)');

  // priority 7 — ActiveTargetGoal<AbstractSkeleton> (skeleton/stray/wither_skeleton)
  const skelEntry = entryAt(wolf.ai, 7, Ai.TARGET);
  ok(!!skelEntry, 'wolf() carries a priority-7 TARGET entry (AbstractSkeleton)');
  const stray = EL.spawn('stray', 2, PLAT_Y + 1, 2);
  wolf.target = null;
  ok(skelEntry.goal.canUse() === true, 'a STRAY (an AbstractSkeleton subclass, not just plain skeleton) is targeted too');
  ok(wolf.target === stray, 'and targets the stray specifically');

  // priority 8 — UniversalAngerGoal
  const uag = entryAt(wolf.ai, 8, Ai.TARGET);
  ok(!!uag, 'wolf() carries a priority-8 TARGET entry (UniversalAngerGoal)');
  wolf.lastHurtByEntity = M.Player; wolf.hurtSeq = 1; wolf.angerTime = 0;
  ok(uag.goal.canUse() === true, 'a wolf just hit by the live player is ready to go universally angry');
  uag.goal.start();
  ok(wolf.angerTime > 0, 'and start() actually rolled a fresh angerTime');

  // ANTI-VACUITY: an EMPTY prey list (candidates argument broken) never finds the fox that IS there
  const emptyPreyEntry = new Ai.UntamedActiveTargetGoal(wolf, () => []);
  wolf.tamed = false; wolf.target = null;
  okAv(emptyPreyEntry.canUse() === false,
       'and with the candidate list forced empty, the same UntamedActiveTargetGoal shape correctly finds nothing — priority 5\'s own true above is the real fox, not a goal that always says yes');
  EL.clear();
}

// ═══ 5. spider() targetSelector priority 3 — SpiderTargetGoal(IronGolem), now that it exists ═
console.log('\n 5. spider()\'s own priority-3 TARGET entry reaches a real iron golem via ctx.golems()');
freshWorld();
plate(15);
{
  const origRandom = Math.random;
  Math.random = () => 0.9; EL.random = () => Math.random();   // stays well clear of SpiderTargetGoal's own light-level gate accident
  const spider = EL.spawn('spider', 0, PLAT_Y + 1, 0);
  Math.random = origRandom;
  const golemEntry = entryAt(spider.ai, 3, Ai.TARGET);
  ok(!!golemEntry, 'spider() carries a priority-3 TARGET entry (SpiderTargetGoal against IronGolem)');

  const golem = EL.spawn('iron_golem', 3, PLAT_Y + 1, 0);
  spider.target = null;
  Math.random = () => 0;   // #4288: ActiveTargetGoal 1-in-10 roll lands
  spider.random = { nextInt: () => 0 };
  ok(golemEntry.goal.canUse() === true, 'a real spawned iron golem is acquired by the priority-3 entry');
  ok(spider.target === golem, 'and it targets the golem specifically');
  Math.random = origRandom;

  // ANTI-VACUITY: with no golem in the world, the SAME entry finds nothing
  spider.target = null;
  EL.clear();
  const spider2 = EL.spawn('spider', 0, PLAT_Y + 1, 0);
  const golemEntry2 = entryAt(spider2.ai, 3, Ai.TARGET);
  okAv(golemEntry2.goal.canUse() === false,
       'and with no iron golem anywhere in the world, that same priority-3 entry correctly finds nothing — the true above was a real acquisition, not a goal that always fires');
  EL.clear();
}

// ═══ 6. wolf() MOVE priority 4 — PounceAtTargetGoal(0.4F) == Ai.PounceAtTargetGoal (loop/wolfpounce)
console.log('\n 6. wolf() priority-4 MOVE|JUMP: a real spawned wolf leaps at a target with the jar\'s own 0.4F velocity');
freshWorld();
plate(15);
{
  const origRandom = Math.random;
  Math.random = () => 0;   // Math.floor(0 * 5) === 0 — LEAP_ROLL always lands
  const wolf = EL.spawn('wolf', 0, PLAT_Y + 1, 0);
  const sheep = EL.spawn('sheep', 3, PLAT_Y + 1, 0);   // squaredDistanceTo = 9, inside [4,16]
  ok(!!wolf && !!sheep, 'a wolf and a sheep both spawn');

  const pounce = entryAt(wolf.ai, 4, Ai.MOVE | Ai.JUMP);
  ok(!!pounce, 'wolf() carries a priority-4 MOVE|JUMP entry (PounceAtTargetGoal, bje.u()\'s own slot)');

  wolf.target = sheep;
  wolf.onGround = true;
  ok(pounce.goal.canUse() === true, 'a grounded wolf with a target 3 blocks away (squaredDistanceTo=9, inside 4-16) and a landed roll leaps');

  wolf.vx = 0; wolf.vz = 0;
  pounce.goal.start();
  ok(Math.abs(wolf.vy - 0.4) < 1e-9, 'start() sets vy to the jar\'s own PounceAtTargetGoal(this, 0.4F) literal, not a guessed constant');
  const expectedLen = Math.hypot(sheep.x - wolf.x, sheep.z - wolf.z);
  const nx = ((sheep.x - wolf.x) / expectedLen) * 0.4, nz = ((sheep.z - wolf.z) / expectedLen) * 0.4;
  ok(Math.abs(wolf.vx - nx) < 1e-9 && Math.abs(wolf.vz - nz) < 1e-9,
     'and vx/vz are the horizontal unit vector toward the target scaled 0.4 (bdz.c()\'s own start(), no 0.2×velocity term since wolf started at rest)');

  // priority 4 must be gone once airborne (shouldContinue: !onGround)
  wolf.onGround = false;
  ok(pounce.goal.canContinueToUse() === true, 'and canContinueToUse() holds true while airborne (!mob.isOnGround())');
  wolf.onGround = true;
  ok(pounce.goal.canContinueToUse() === false, 'and drops false the instant it lands again');

  // ANTI-VACUITY #1 — a target OUTSIDE the 4-16 squared-distance window never leaps
  const farSheep = EL.spawn('sheep', 20, PLAT_Y + 1, 0);
  wolf.target = farSheep;
  wolf.onGround = true;
  okAv(pounce.goal.canUse() === false,
       'a target 20 blocks away (squaredDistanceTo=400, outside 4-16) is correctly refused — the true above was the real 4-16 gate, not a goal that always leaps');

  // ANTI-VACUITY #2 — airborne (not on ground) never leaps, even with a perfect target
  wolf.target = sheep;
  wolf.onGround = false;
  okAv(pounce.goal.canUse() === false,
       'the same in-range target is refused while the wolf is airborne — canUse()\'s own isOnGround() gate, not the distance check alone');
  wolf.onGround = true;

  Math.random = origRandom;
  EL.clear();
}

// ═══ 7. Ai.UniversalAngerGoal(triggerOthers) — wolf's own pack alert (loop/wolfpounce) ═══════
console.log('\n 7. wolf()\'s UniversalAngerGoal(triggerOthers=true) spreads anger to a nearby wolf, iron_golem\'s (false) does not');
freshWorld();
plate(20);
{
  M.Player = mkPlayer({ x: 0, y: PLAT_Y + 1, z: 0 });
  const wolf1 = EL.spawn('wolf', 0, PLAT_Y + 1, 0);
  const wolf2 = EL.spawn('wolf', 5, PLAT_Y + 1, 0);     // 5 blocks — inside wolf's own follow range (16)
  const wolf3 = EL.spawn('wolf', 30, PLAT_Y + 1, 0);    // 30 blocks — OUTSIDE follow range (16)
  ok(!!wolf1 && !!wolf2 && !!wolf3, 'three wolves spawn');

  const uag = entryAt(wolf1.ai, 8, Ai.TARGET);
  ok(!!uag, 'wolf() still carries its priority-8 TARGET entry (UniversalAngerGoal)');
  wolf1.lastHurtByEntity = M.Player; wolf1.hurtSeq = 1; wolf1.angerTime = 0;
  ok(uag.goal.canUse() === true, 'wolf1, just hit by the live player, is ready to go universally angry');
  wolf2.angerTime = 0; wolf3.angerTime = 0;
  uag.goal.start();
  ok(wolf1.angerTime > 0, 'start() rolls wolf1\'s own fresh angerTime');
  ok(wolf2.angerTime > 0, 'and (triggerOthers=true, bje.u()\'s own literal) a wolf 5 blocks away, inside follow range 16, is alerted too');
  ok(wolf3.angerTime === 0, 'but a wolf 30 blocks away, OUTSIDE follow range 16, is left alone — getOthersInRange()\'s own box, not every wolf alive');

  // iron_golem's own UniversalAngerGoal passes triggerOthers=false (bin.u()) — a second golem
  // in range must NOT be alerted, the opposite-direction half of this same rule.
  EL.clear();
  const golem1 = EL.spawn('iron_golem', 0, PLAT_Y + 1, 0);
  const golem2 = EL.spawn('iron_golem', 3, PLAT_Y + 1, 0);   // well inside golem's own follow range (16)
  ok(!!golem1 && !!golem2, 'two iron golems spawn');
  const gUag = entryAt(golem1.ai, 4, 0);
  ok(!!gUag, 'iron_golem() carries its own UniversalAngerGoal entry');
  golem1.lastHurtByEntity = M.Player; golem1.hurtSeq = 1; golem1.angerTime = 0; golem2.angerTime = 0;
  ok(gUag.goal.canUse() === true, 'golem1, just hit by the live player, is ready too');
  gUag.goal.start();
  ok(golem1.angerTime > 0, 'golem1 itself still goes angry');
  ok(golem2.angerTime === 0, 'but golem2, right next to it, is NOT alerted — bin.u()\'s own `false` triggerOthers is a real no-op, not silently dropped');

  // ANTI-VACUITY — call Ai.UniversalAngerGoal DIRECTLY with triggerOthers=true but an EMPTY pack
  // (the getPack callback broken/misconfigured): the near wolf must NOT be angered, proving
  // wolf2\'s true above came from the real pack list, not a goal that always alerts everyone.
  EL.clear();
  const w1 = EL.spawn('wolf', 0, PLAT_Y + 1, 0);
  const w2 = EL.spawn('wolf', 5, PLAT_Y + 1, 0);
  w1.lastHurtByEntity = M.Player; w1.hurtSeq = 1; w1.angerTime = 0; w2.angerTime = 0;
  const brokenGoal = new Ai.UniversalAngerGoal(w1, () => 0.999, true, () => []);
  ok(brokenGoal.canUse() === true, 'the direct-construction goal still recognises the same fresh hit');
  brokenGoal.start();
  okAv(w1.angerTime > 0 && w2.angerTime === 0,
       'with the pack callback forced empty, w1 still goes angry but w2 (5 blocks away, real distance) is correctly left alone — the section\'s own true above came from a real pack scan');
  EL.clear();
}

// #908 -- WolfEntity.damage: a hit stands a sitting wolf up; a non-player attacker halves it (d+1)/2.
{
  const Cb = M.Combat;
  ok(!!Cb && !!Cb.hurt, 'Combat.hurt is loaded');
  const hit = (attacker, sit) => {
    freshWorld(); plate(6); EL.clear();
    const w = EL.spawn('wolf', 0, PLAT_Y + 1, 0);
    w.sitting = sit; const h0 = w.health;
    Cb.hurt(w, 5, 100, false, attacker ? { attacker } : {});
    return { w, lost: h0 - w.health };
  };
  const mob = { type: 'zombie', x: 3, y: PLAT_Y + 1, z: 0 };
  const m = hit(mob, true);
  ok(m.w.sitting === false, 'a mob hit stands a sitting wolf up');
  ok(m.lost === 3, 'a mob attacker halves 5 to (5+1)/2 = 3 (lost ' + m.lost + ')');
  const pl = hit(M.Player, true);
  ok(pl.w.sitting === false && pl.lost === 5, 'a player hit stands it up but is NOT halved (lost ' + pl.lost + ')');
  const nat = hit(null, true);
  ok(nat.w.sitting === false && nat.lost === 5, 'an attacker-less hit stands it up, undamped (lost ' + nat.lost + ')');
  okAv(m.lost !== pl.lost, 'mob and player hits differ, so the halving is not vacuous');
  okAv(hit(mob, false).w.sitting === false && hit(mob, true).w.sitting !== true, 'sitting is really cleared, not merely preserved false');
  EL.clear();
}

// #2900 -- WolfEntity.canAttackWithOwner filter on the owner-assist goals.
{
  freshWorld(); plate(6); EL.clear();
  const w = EL.spawn('wolf', 0, PLAT_Y + 1, 0); w.tamed = true; w.owner = 'player';
  const mk = (kind, tamed) => ({ type: kind, tamed: !!tamed });
  const tryGoal = (G, field, t) => { M.Player[field] = t; const g = new G(w, () => [M.Player]); return g.canUse(); };
  for (const [G, field] of [[Ai.OwnerHurtByTargetGoal, 'lastHurtByEntity'], [Ai.OwnerHurtTargetGoal, 'lastHurtMob']]) {
    ok(tryGoal(G, field, mk('zombie')) === true, field + ': a zombie is a valid assist target');
    for (const [k, tm] of [['creeper'], ['ghast'], ['wolf', true], ['cat', true], ['horse', true]]) {
      ok(tryGoal(G, field, mk(k, tm)) === false, field + ': ' + (tm ? 'tamed ' : '') + k + ' is refused');
    }
    okAv(tryGoal(G, field, mk('wolf', false)) === true, field + ': a wild wolf is accepted, so the refusals above are not vacuous');
    M.Player[field] = null;
  }
  EL.clear();
}

console.log(`\n${pass} checks passed, ${breaks} anti-vacuity break(s) confirmed caught, ${fails.length} failed`);
console.log(`wolfgoalcheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
if (fails.length) {
  for (const f of fails) console.log('  FAIL: ' + f);
  process.exit(1);
}
