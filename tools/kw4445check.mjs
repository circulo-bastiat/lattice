#!/usr/bin/env node
// kw4445check.mjs — session 152, loop/kw44-45-llama-wolf: two related LlamaEntity/WolfEntity
// goal bugs sharing src/07k_goals.js.
//
//   node tools/kw4445check.mjs [--verbose]
//
// KW-44 (docs/archive/KNOWN-WRONG.md) — `Ai.ChaseWolvesGoal` was missing `ActiveTargetGoal`'s own
// `reciprocalChance` gate (`.decomp/net/minecraft/entity/ai/goal/ActiveTargetGoal.java`
// ctor + `canStart`: `toGoalTicks(16) = 8`, so vanilla only even ATTEMPTS `findClosestTarget()`
// on ~1/8 of ticks) and was giving `canContinueToUse()` an invented ×1.5 leash-slack widening
// that `.decomp/net/minecraft/entity/ai/goal/TrackTargetGoal.java#shouldContinue` never has —
// vanilla drops the target the INSTANT `squaredDistanceTo > getFollowRange()^2`, no slack at
// all (that ×1.5 idiom belongs only to the generic `Ai.NearestAttackableTargetGoal` helper).
//
// KW-45 (docs/archive/KNOWN-WRONG.md) — `Ai.AvoidEntityGoal`'s escape point was a single deterministic
// point exactly `range` blocks directly away from the threat (reusing the DETECTION radius as
// the flee-target distance), where vanilla's `.decomp/net/minecraft/entity/ai/goal/
// FleeEntityGoal.java#canStart` always searches via `NoPenaltyTargeting.findFrom(mob, 16, 7,
// threatPos)` — a FIXED 16-block/7-block/PI-2-cone fuzzed, pathfinding-validated search,
// completely independent of the caller's detection `range`. In a bounded pen the old straight-
// line point can land outside the walls, `Ai.findPath` then legitimately returns `null` (proven
// below), and the goal silently stops making any progress at all the very next tick even though
// the threat is still right there — this check proves that failure mode directly and proves the
// fixed fuzzy search actually finds a path in the exact same pen. Cloud feed (a) (session 152's
// own follow-up) made the fixed search the ONE always-on behaviour for every `Ai.AvoidEntityGoal`
// caller, not just `AvoidLlamaGoal`'s opt-in — `fleeOpts` no longer changes WHICH algorithm runs,
// only which RNG/LOS/favor function it uses (default `Math.random`/`Ai.canSee`/
// `Ai.animalPathfindingFavor`).

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');

let pass = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); if (VERBOSE) console.log((c ? '   ✓ ' : '   ✗ ') + m); return c; };
const okAv = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push('anti-vacuity: ' + m); if (VERBOSE) console.log((c ? '   ✓ ' : '   ✗ ') + m); return c; };

console.log('kw4445check — KW-44 (ChaseWolvesGoal reciprocalChance + hard follow-range cutoff) + KW-45 (AvoidEntityGoal flee-point search)');

const M = loadEngine({
  extra: ['02f_tags.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js',
          '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07r_mount.js', '14c_raycast.js']
});
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
M.Entities.init();
M.EntityList.init();
M.Behave.init(M.World);
M.Mount.init();
M.Ai.init();
ok(M.Entities.ready, 'the entity table loaded');

const EL = M.EntityList, Ai = M.Ai, W = M.World, CH = M.CH;
const stateOf = (n) => M.States.stateOf(n) | 0;
const STONE = stateOf('stone');
const PLAT_Y = 8;

function freshWorld() {
  W.init(1);
  for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) {
    const c = W.makeChunk(cx, cz);
    c.state = CH.GENERATED;
    W.chunks.set(W.key(cx, cz), c);
  }
}
function plate(radius) {
  for (let x = -radius; x <= radius; x++) for (let z = -radius; z <= radius; z++) W.setBlock(x, PLAT_Y, z, STONE);
}
// a pen exactly like tools/referee/runllama.mjs's own ENT pens: stone floor, R-block half-size,
// 2-high stone walls right at the boundary.
function pen(R) {
  for (let x = -R - 1; x <= R + 1; x++) for (let z = -R - 1; z <= R + 1; z++) {
    W.setBlock(x, PLAT_Y, z, STONE);
    if (x === -R - 1 || x === R + 1 || z === -R - 1 || z === R + 1) {
      W.setBlock(x, PLAT_Y + 1, z, STONE);
      W.setBlock(x, PLAT_Y + 2, z, STONE);
    }
  }
}
let breaks = 0;
const constRandom = (v) => () => v;

// ═════════════════════ KW-44a: reciprocalChance gate on canUse() ═══════════════════════════
console.log('\n 1. KW-44: ChaseWolvesGoal.canUse() is gated by reciprocalChance (toGoalTicks(16) = 1/8), not unconditional');
freshWorld();
plate(15);
{
  const llama = EL.spawn('llama', 0, PLAT_Y + 1, 0);
  const wolf = EL.spawn('wolf', 3, PLAT_Y + 1, 0);      // well inside the 10-block chase range
  ok(!!llama && !!wolf, 'a llama and a wolf both spawn');
  wolf.tamed = false;

  // a random source that ALWAYS fails the 1/8 roll (0.5 >= 1/8): canUse() must refuse every
  // single time, never falling through to the range scan at all.
  const gated = new Ai.ChaseWolvesGoal(llama, { random: constRandom(0.5) });
  let anyTrue = false;
  for (let i = 0; i < 30; i++) { llama.target = null; if (gated.canUse()) anyTrue = true; }
  ok(anyTrue === false, 'a random source that always fails the reciprocalChance roll (0.5 >= 1/8) never acquires the wolf, even 30 tries in range');

  // ANTI-VACUITY: the SAME wolf, SAME range, but a random source that always PASSES the roll
  // (0 < 1/8) — canUse() must succeed, proving the refusal above was the gate, not the wolf
  // being unreachable/out of range/some other accident.
  llama.target = null;
  const ungated = new Ai.ChaseWolvesGoal(llama, { random: constRandom(0) });
  okAv(ungated.canUse() === true, 'the identical wolf, a roll of 0 (always passes), DOES get acquired');
  ok(llama.target === wolf, 'and e.target is set to the live wolf object');
  EL.clear();
}

// ══════════════════ KW-44b: canContinueToUse() is a hard cutoff, no leash slack ═════════════
console.log('\n 2. KW-44: ChaseWolvesGoal.canContinueToUse() drops the target the instant it clears the 10-block range — no ×1.5 slack');
freshWorld();
plate(20);
{
  const llama = EL.spawn('llama', 0, PLAT_Y + 1, 0);
  const wolf = EL.spawn('wolf', 3, PLAT_Y + 1, 0);
  ok(!!llama && !!wolf, 'a llama and a wolf both spawn (test 2)');
  if (llama) llama.followBonus = 0;   // the spawn spread (MobEntity.initialize) is mobrefattrcheck's; this pins the base 40
  const g = new Ai.ChaseWolvesGoal(llama, { random: constRandom(0) });
  const fr = Ai.followRangeOf(llama) * Ai.CHASE_WOLVES_RANGE_MULT;   // 40 * 0.25 = 10
  ok(fr === 10, 'the follow-range attribute resolves to the known 40, so the chase range is 10 (' + fr + ')');
  llama.target = wolf;

  wolf.x = fr - 0.5;   // just inside 10 blocks
  ok(g.canContinueToUse() === true, 'a wolf just INSIDE the 10-block range is still a valid target');

  wolf.x = fr + 0.5;   // just past 10 blocks -- vanilla drops it here, immediately
  ok(g.canContinueToUse() === false, 'a wolf just PAST the 10-block range is dropped immediately (no leash slack)');

  wolf.x = fr * 1.2;   // 12 blocks -- inside the OLD (buggy) 1.5x=15 slack window
  ok(g.canContinueToUse() === false, 'a wolf at 1.2x the chase range (still inside the old, wrong 1.5x=15 slack) is correctly dropped too');
  EL.clear();
}

// ══════════════════ KW-45: AvoidEntityGoal's flee-point search vs a bounded pen ═════════════
console.log('\n 3. KW-45: AvoidEntityGoal\'s escape-point search actually finds a path inside a bounded pen; the old straight-line point does not');
freshWorld();
{
  const R = 24;
  pen(R);
  const llama = EL.spawn('llama', 0, PLAT_Y + 1, 0);
  const wolf = EL.spawn('wolf', 12, PLAT_Y + 1, 0);     // wild_s5_dx12's own placement
  ok(!!llama && !!wolf, 'a llama and a wolf both spawn inside the pen');

  // ANTI-VACUITY, pins the actual mechanism: the OLD straight-line target (12 + range(24) = 36.5
  // in x) really is outside this pen's walls, so Ai.findPath really does return null for it —
  // proving the pen geometry genuinely exercises the bug, not a fluke of this harness.
  const straightLineTarget = wolf.x + 24;
  const rawPath = Ai.findPath(wolf.x, wolf.y, wolf.z, straightLineTarget, wolf.y, wolf.z, { maxDrop: 1, mob: wolf });
  okAv(rawPath === null, 'a straight path to 24 blocks directly away from the wolf\'s own position really is unreachable in this pen');

  // the fuzzy search is now the ONE always-on behaviour -- no fleeOpts.random needed -- so a
  // plain call (default Math.random) must ALSO find a reachable candidate inside the pen.
  // Each attempt is a fresh set of 10 fuzzed candidates (same as a real goal selector
  // re-invoking canUse() every tick it stays inactive), so retry the same way test 1 above
  // retries a reciprocalChance roll.
  let seed = 0.123456;
  const seededRandom = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const defaultGoal = new Ai.AvoidEntityGoal(wolf, 24, 1.5, () => [llama], () => true);
  let defaultOk = false;
  for (let i = 0; i < 30 && !defaultOk; i++) defaultOk = defaultGoal.canUse();
  ok(defaultOk === true, 'FIXED: even with the default (Math.random) RNG, the goal starts by finding a fuzzed, reachable escape point -- not the old unreachable straight-line one');
  defaultGoal.start();
  wolf.mobSpeed = 0;
  defaultGoal.tick();
  ok(defaultGoal.canContinueToUse() === true, 'and is still actively fleeing after its first tick (the escape path was not exhausted immediately)');
  ok(wolf.mobSpeed > 0, 'and the wolf was actually aimed and given a real movement speed this tick (Ai.stepToward ran)');
  defaultGoal.stop();

  // ANTI-VACUITY, with a seeded RNG so the run is reproducible: same fixed 16/7/PI-2 fuzzed
  // search, explicit rand source, same result. Each attempt is a fresh set of 10 fuzzed
  // candidates (same as a real goal selector re-invoking canUse() every tick it stays
  // inactive), so a retry loop here mirrors test 1's own reciprocalChance retries above.
  const newGoal = new Ai.AvoidEntityGoal(wolf, 24, 1.5, () => [llama], () => true, { random: seededRandom });
  let seededOk = false;
  for (let i = 0; i < 30 && !seededOk; i++) seededOk = newGoal.canUse();
  okAv(seededOk === true, 'a seeded RNG source finds the same kind of reachable candidate (not a fluke of Math.random)');
  newGoal.start();
  wolf.mobSpeed = 0;
  newGoal.tick();
  ok(newGoal.canContinueToUse() === true, 'and keeps fleeing after its first tick with the seeded RNG too');
  ok(wolf.mobSpeed > 0, 'and the wolf was actually aimed and given a real movement speed this tick');
  EL.clear();
}

// ══════════════ #3525: ActiveTargetGoal.getSearchBox = bbox.expand(range, 4, range) ═════════
console.log('\n 4. #3525: a wolf 7 blocks straight above is outside the +-4 vertical search box (3D dist 7 <= 10, still refused)');
freshWorld();
plate(15);
{
  const llama = EL.spawn('llama', 0, PLAT_Y + 1, 0);
  const wolf = EL.spawn('wolf', 0, PLAT_Y + 8, 0);
  wolf.tamed = false;
  const g = new Ai.ChaseWolvesGoal(llama, { random: constRandom(0) });
  ok(g.canUse() === false && !llama.target, 'wolf at dy=7, dx=0 is not targeted');
  wolf.y = PLAT_Y + 4;   // within the box
  okAv(g.canUse() === true, 'the same wolf at dy=3 IS targeted (the refusal was the vertical box)');
  // break: a llama tall enough to widen the box over the wolf must make the refusal fail
  wolf.y = PLAT_Y + 8; llama.target = null; llama.height = 20;
  if (g.canUse() === true) breaks++;
  EL.clear();
}

// ══════════════ #3726: eye-origin tie-break + canNavigateToEntity ═════════════
console.log('\n 5. #3726: closest wolf is measured from the llama EYE; an unreachable wolf is refused');
freshWorld();
plate(15);
{
  const llama = EL.spawn('llama', 0, PLAT_Y + 1, 0);
  const eye = Ai.eyeOf(llama);
  // A at dy=0 horizontal 3.0 (feet 3.0, eye ~sqrt(9+eye^2)); B directly 3.0 apart in 3D from the eye is nearer in eye terms
  const A = EL.spawn('wolf', 3, PLAT_Y + 1, 0);
  const B = EL.spawn('wolf', 0, PLAT_Y + 1 + eye, 2.9);   // eye-distance 2.9, feet-distance > 3
  A.tamed = false; B.tamed = false;
  const g = new Ai.ChaseWolvesGoal(llama, { random: constRandom(0) });
  llama.target = null;
  g.canUse();
  ok(llama.target === B, 'the wolf nearer the llama EYE wins even though the other is nearer the feet');
  // break: a feet-distance picker would choose A here, so the case can fail
  if (Math.hypot(A.x, A.y - llama.y, A.z) < Math.hypot(B.x, B.y - llama.y, B.z)) breaks++;
  EL.clear();
}
freshWorld();
plate(15);
{
  const llama = EL.spawn('llama', 0, PLAT_Y + 1, 0);
  const wolf = EL.spawn('wolf', 6, PLAT_Y + 1, 0);
  wolf.tamed = false;
  const g = new Ai.ChaseWolvesGoal(llama, { random: constRandom(0) });
  okAv(g.canUse() === true, 'an open-floor wolf 6 blocks away is targeted');
  llama.target = null;
  for (let y = PLAT_Y + 1; y <= PLAT_Y + 3; y++) for (let z = -15; z <= 15; z++) { W.setBlock(3, y, z, STONE); }
  for (let y = PLAT_Y + 1; y <= PLAT_Y + 3; y++) for (let x = 3; x <= 15; x++) { W.setBlock(x, y, 15, STONE); W.setBlock(x, y, -15, STONE); }
  if (g.canUse() === true) breaks++;
  ok(g.canUse() === false && !llama.target, 'the same wolf behind a sealed wall (no path) is NOT targeted');
  EL.clear();
}

console.log('\n' + pass + ' checks passed, ' + fails.length + ' failed; ' + breaks + ' breaks caught');
if (fails.length) {
  console.log('\nFAILURES:');
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
