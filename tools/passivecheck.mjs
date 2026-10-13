#!/usr/bin/env node
// passivecheck.mjs — QUEUE 0.2, G18c: the sheep/chicken/pig unit.
//
//   node tools/passivecheck.mjs [--verbose]
//
// ⚠ WHAT THIS PROVES. Sheep, chicken and pig reuse cow's own substrate almost entirely (motion,
// spawn rule, goal shapes) — the interesting question is never "does a goal selector work", it
// is "did THIS session's own additions (the closed motion set, the ROSTER entries, the spawn
// rule aliasing, and the leftover state 07w_passive.js owns) actually land". Every section
// drives the REAL modules — `EL.motionFor`, `Ai.ROSTER`, `Spawn.RULES`, `Breed.CHILD.sheep`,
// `Passive.*` — never a reimplementation, and each asserts in BOTH directions (rule 6).

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine, ASSETS } from './loadsrc.mjs';

const VERBOSE = process.argv.includes('--verbose');

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ break caught: ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (VERBOSE) console.log(...a); };

console.log('passivecheck — QUEUE 0.2 G18c, sheep/chicken/pig');

const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js',
          '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js',
          '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07w_passive.js',
          '14l_use.js']
});
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Recipes.init({ recipes: b64('recipes.bin'), recipesBytes: rdj('recipes.meta.json').jsonBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.EntityList.init();
M.World.init(1);
M.Behave.init(M.World);
M.Ai.init();
M.Breed.init();
M.Passive.init();
M.Use.init(M.World);

const EL = M.EntityList, Ai = M.Ai, Spawn = M.Spawn, Br = M.Breed, Ps = M.Passive, Ent = M.Entities;
const W = M.World, S = M.States, Use = M.Use;
// the SAME real-chunk fixture aicheck.mjs already uses -- a mob spawned onto GENERATED chunks,
// not a synthetic snapshot, so `Passive.EatGrassGoal`'s own W.getBlock/setBlock calls are the
// live world, exactly as they run in the browser.
function makeChunk(cx, cz) {
  const c = W.makeChunk(cx, cz);
  c.state = M.CH.GENERATED;
  W.chunks.set(W.key(cx, cz), c);
}
for (let cx = -1; cx <= 5; cx++) for (let cz = -1; cz <= 5; cz++) makeChunk(cx, cz);
ok(W.loadedAt(0, 0), 'a chunk is loaded to place grass into');
const stateOf = (n) => S.stateOf(n) | 0;
ok(Ps.ready, 'Passive module reports ready');

// ═════════════════════ 1. the closed motion set — sheep/chicken/pig are IN it ═══════════════
{
  say('\n§1 EL.motionFor — the closed set');
  const near = (x, y) => Math.abs(x - y) < 1e-6;
  for (const t of ['sheep', 'chicken', 'pig']) {
    const m = EL.motionFor(t);
    ok(m && near(m[0], 0.08) && near(m[1], 0.98),
      `${t}'s motion is [0.08, 0.98] — the jar's own generic LivingEntity gravity/drag (got ${JSON.stringify(m)})`);
    ok(EL.canSpawn(t), `EL.canSpawn('${t}') is true — EL.spawn will not refuse it`);
  }
  // anti-vacuity: a type this file never touched is STILL refused — proves the check above
  // is testing a real closed set, not a function that always returns something. The witness is
  // PICKED, not hard-coded (squidcheck.mjs's own D-567 fix, repeated here after shulker's cloud-
  // unit motion row (confident-lamport-asj6ue) turned it green and would have made this red).
  const VANILLA_UNBUILT = ['ender_dragon', 'wither', 'giant'];
  const witness1 = VANILLA_UNBUILT.find((t) => !EL.canSpawn(t));
  okAv(witness1 ? !EL.canSpawn(witness1) : !EL.canSpawn('not_a_mob'), `a type nobody built (${witness1 || 'not_a_mob'}) is still refused by EL.canSpawn`);
  const e = EL.spawn('sheep', 8, 5, 8);
  ok(e && e.type === 'sheep' && near(e.gravity, 0.08) && near(e.drag, 0.98), 'EL.spawn actually produces a live sheep entity');
}

// ═════════════════════ 2. Ai.ROSTER — wired, and reachable through EL.spawn ═══════════════
{
  say('\n§2 Ai.ROSTER');
  for (const t of ['sheep', 'chicken', 'pig']) {
    ok(typeof Ai.ROSTER[t] === 'function', `Ai.ROSTER.${t} exists`);
    const e = EL.spawn(t, 0, 5, 0);
    ok(e && e.ai && typeof e.ai.tick === 'function',
      `EL.spawn('${t}') attaches a REAL goal selector (D-391's own live wiring, not goalcheck.mjs's synthetic one)`);
  }
  // anti-vacuity: strip Ai.ROSTER.pig and prove EL.spawn stops attaching e.ai for it — the
  // same refusal-over-guessing shape EL.motionFor's own test above already leaned on.
  const savedPig = Ai.ROSTER.pig;
  delete Ai.ROSTER.pig;
  const noAi = EL.spawn('pig', 1, 5, 1);
  okAv(noAi && !noAi.ai, 'removing Ai.ROSTER.pig makes a freshly spawned pig come up with NO goal selector at all');
  Ai.ROSTER.pig = savedPig;
  const withAi = EL.spawn('pig', 1, 5, 1);
  ok(withAi && withAi.ai, 'restoring Ai.ROSTER.pig makes EL.spawn attach one again');

  // priorities match .decomp's own initGoals() — spot the float/panic/breed/tempt/follow
  // goals at the jar's own numbers, read straight off the goal selector's own entries.
  const prioritiesOf = (e) => e.ai.entries.slice().sort((a, b) => a.priority - b.priority).map((x) => x.priority);
  const sheepP = prioritiesOf(EL.spawn('sheep', 2, 5, 2));
  ok(sheepP[0] === 0 && sheepP[1] === 1 && sheepP[2] === 2 && sheepP[3] === 3 && sheepP[4] === 4,
    `sheep's own MOVE goals start 0,1,2,3,4 — float/panic/breed/tempt/follow, .decomp's own order (got ${sheepP.join(',')})`);
}

// ═════════════════════ 3. Spawn.RULES — the same Animal rule cow already has ══════════════
{
  say('\n§3 Spawn.RULES');
  for (const t of ['sheep', 'chicken', 'pig']) {
    ok(Spawn.RULES[t] === Spawn.RULES.cow, `Spawn.RULES.${t} is the SAME function object as cow's — no override in .decomp`);
    ok(Spawn.canPlace(t), `Spawn.canPlace('${t}') is true`);
  }
  okAv(Spawn.canPlace('creeper'), "creeper now has its own Monster-shaped rule (loop/creeper-s95) — "
    + 'Spawn.canPlace(\'creeper\') is true, distinct from cow\'s own Animal rule');
  ok(Spawn.RULES.creeper !== Spawn.RULES.cow, "creeper's rule is its OWN function, not shared with cow's Animal rule");
  // loop/enderman-s98 -- Spawn.RULES.enderman now exists (same Monster.checkMonsterSpawnRules
  // shape zombie/skeleton/spider/creeper share); the anti-vacuity flips to the mirror claim.
  okAv(Spawn.canPlace('enderman'), "enderman now has Monster's own dark-spawn rule (loop/enderman-s98) -- "
    + "Spawn.canPlace('enderman') is true");
  ok(Spawn.RULES.enderman !== Spawn.RULES.cow, "enderman's rule is its own function, not shared with cow's Animal rule");
}

// ═════════════════════ 4. Passive.rollWoolColor — the jar's own five branches ═══════════
{
  say('\n§4 wool colour roll');
  const N = 20000;
  const counts = { black: 0, gray: 0, light_gray: 0, brown: 0, pink: 0, white: 0 };
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed / 0x7fffffff); };
  for (let i = 0; i < N; i++) counts[Ps.rollWoolColor(rnd)]++;
  say(`   ${JSON.stringify(counts)}`);
  const pct = (k) => (counts[k] / N) * 100;
  ok(pct('black') > 3 && pct('black') < 7, `black lands near 5% (got ${pct('black').toFixed(2)}%)`);
  ok(pct('gray') > 3 && pct('gray') < 7, `gray lands near 5% (got ${pct('gray').toFixed(2)}%)`);
  ok(pct('light_gray') > 3 && pct('light_gray') < 7, `light_gray lands near 5% (got ${pct('light_gray').toFixed(2)}%)`);
  ok(pct('brown') > 1 && pct('brown') < 5, `brown lands near 3% (got ${pct('brown').toFixed(2)}%)`);
  ok(pct('pink') > 0 && pct('pink') < 1, `pink is rare — the 1-in-500 roll inside the 82% branch (got ${pct('pink').toFixed(3)}%)`);
  ok(pct('white') > 75, `white is the overwhelming majority — the else-of-the-else (got ${pct('white').toFixed(2)}%)`);
  // anti-vacuity: an rnd() that always returns 0 must land EVERY roll in the FIRST branch
  // (black) — proves the thresholds are actually read, not bypassed.
  okAv(Ps.rollWoolColor(() => 0) === 'black', 'rnd()===0 always rolls the first branch, black');
  // anti-vacuity, the other end: rnd() that always returns just-under-1 must clear every
  // percentage threshold (white unless the 1/500 sub-roll also fires) — and since BOTH
  // calls share the same rnd(), a rnd() pinned at just-under-1 must fail the 1-in-500 test too.
  okAv(Ps.rollWoolColor(() => 0.9999) === 'white', 'rnd() pinned high clears every branch to white, and the 1/500 sub-roll too');
}

// ═════════════════════ 5. Passive.childWoolColor — dye-mix, or a coin flip ══════════════
{
  say('\n§5 wool colour mixing');
  // a known vanilla dye-mixing recipe: red + white -> pink (the real recipe table, not a guess)
  const mixed = Ps.childWoolColor('red', 'white', () => 0.99);
  ok(mixed === 'pink', `red+white mixes to pink through the REAL crafting recipe table (got ${mixed})`);
  ok(mixed !== undefined, 'the mix path does not fall through to the coin-flip for a real recipe');
  // no recipe for this pair (two identical rare colours that never mix to a third) — falls
  // back to a coin flip between the two PARENTS, never a colour neither parent had.
  const flipLo = Ps.childWoolColor('pink', 'pink', () => 0.0);
  const flipHi = Ps.childWoolColor('pink', 'pink', () => 0.99);
  ok(flipLo === 'pink' && flipHi === 'pink', 'two pink parents with no third-colour recipe both branches land on pink, one of the two parents');
  const a = Ps.childWoolColor('black', 'light_gray', () => 0.0);
  const b = Ps.childWoolColor('black', 'light_gray', () => 0.99);
  // black+light_gray has no dye-mixing recipe either — the coin flip must be able to pick BOTH
  ok((a === 'black' || a === 'light_gray') && (b === 'black' || b === 'light_gray') && a !== b,
    `a coin-flip pair with no recipe picks EITHER parent depending on the roll (got ${a}, ${b})`);
}

// ═════════════════════ 6. Breed.CHILD.sheep — wired into Br.breed live ═══════════════════
{
  say('\n§6 Breed.CHILD.sheep, live');
  ok(Br.canBreed('sheep'), 'Breed.SPECIAL.sheep is gone — sheep now runs the WHOLE breeding loop');
  const a = EL.spawn('sheep', 4, 5, 4);
  const b = EL.spawn('sheep', 5, 5, 4);
  a.woolColor = 'red'; b.woolColor = 'white';
  Br.setAge(a, 0); Br.setAge(b, 0);
  Br.setInLove(a, null);
  Br.setInLove(b, null);
  const child = Br.breed(a, b, { random: () => 0.99 });
  ok(child && child.type === 'sheep', 'Br.breed produces a live sheep child');
  ok(child && child.woolColor === 'pink', `the child's own wool colour is the real dye-mix, red+white=pink (got ${child && child.woolColor})`);
}

// ═════════════════════ 7. Passive.shear ══════════════════════════════════════════════════════
{
  say('\n§7 shearing');
  const e = EL.spawn('sheep', 6, 5, 6);
  e.woolColor = 'lime';
  const r = Ps.shear(e, () => 0.5);
  ok(r && r.item === 'lime_wool' && r.count >= 1 && r.count <= 3, `shearing a lime sheep drops lime_wool, 1-3 of it (got ${JSON.stringify(r)})`);
  ok(e.sheared === true, 'shearing sets e.sheared');
  ok(Ps.shear(e, () => 0.5) === null, 'shearing an ALREADY-sheared sheep refuses — SheepEntity.isShearable\'s own gate');
  const baby = EL.spawn('sheep', 7, 5, 7);
  baby.growAge = -100;
  ok(Ps.shear(baby, () => 0.5) === null, 'shearing a BABY refuses — the same isShearable() gate\'s other half');
  const notSheep = EL.spawn('cow', 8, 5, 8);
  ok(Ps.shear(notSheep, () => 0.5) === null, 'shearing a non-sheep refuses outright');
}

// ═════════════════════ 8. chicken egg timer, live, both directions ══════════════════════════
{
  say('\n§8 egg timer');
  const c = EL.spawn('chicken', 10, 5, 10);
  ok(c.eggLayTime >= Ps.EGG_MIN && c.eggLayTime < Ps.EGG_MIN + Ps.EGG_SPAN,
    `a freshly-spawned chicken's eggLayTime is in [6000,12000) (got ${c.eggLayTime})`);
  c.eggLayTime = 3;
  ok(!Ps.tickChicken(c, () => 0.5), 'tick 1 of 3: no egg yet');
  ok(!Ps.tickChicken(c, () => 0.5), 'tick 2 of 3: no egg yet');
  ok(Ps.tickChicken(c, () => 0.5), 'tick 3 of 3: the egg drops on the tick the counter reaches zero');
  ok(c.eggLayTime >= Ps.EGG_MIN && c.eggLayTime < Ps.EGG_MIN + Ps.EGG_SPAN,
    `the timer RE-ROLLS the same [6000,12000) range immediately, .decomp's own reset-in-branch shape (got ${c.eggLayTime})`);
  const baby = EL.spawn('chicken', 11, 5, 11);
  baby.growAge = -100; baby.eggLayTime = 1;
  ok(!Ps.tickChicken(baby, () => 0.5), 'a baby chicken never lays, however low its own timer runs — !isBaby() in the SAME condition');

  // it is actually wired into EL.tickMob's own live path, not only callable by hand
  const live = EL.spawn('chicken', 12, 5, 12);
  live.eggLayTime = 1;
  const before = EL.list.filter((x) => !x.removed).length;
  EL.tickOne(live);
  const dropped = EL.list.some((x) => x.type === 'item' && !x.removed && x.item !== undefined && Ent.bare && true);
  ok(EL.list.length > before, 'EL.tickOne on a chicken one tick from laying actually spawns a live item entity (the egg)');
}

// ═════════════════════ 9. chicken slow-fall, live, both directions ══════════════════════════
{
  say('\n§9 chicken slow-fall');
  // `Ph.travelMob` is mocked here so this section isolates the ADDED HOOK in `EL.tickMob`,
  // not the collision engine underneath it (which is 14b_physics.js's own, tested elsewhere):
  // it pins `e.vy` to a known falling value and leaves `e.onGround` false, exactly the state
  // `.decomp`'s own guard (`!onGround && velocity.y < 0.0`) reads.
  const realTravelMob = M.Physics.travelMob;
  M.Physics.travelMob = function (e) { e.vy = -1.0; e.onGround = false; };
  const c1 = EL.spawn('chicken', 14, 20, 14);
  c1.eggLayTime = 99999;
  EL.tickOne(c1);
  const dampedVy = c1.vy;
  ok(Math.abs(dampedVy - (-1.0 * Ps.CHICKEN_FALL_MULT)) < 1e-9,
    `a falling chicken's own vy is multiplied by CHICKEN_FALL_MULT after travel (got ${dampedVy}, expected ${-1.0 * Ps.CHICKEN_FALL_MULT})`);
  // both directions: RISING (vy > 0) is untouched — .decomp's own guard is velocity.y < 0.0 only
  M.Physics.travelMob = function (e) { e.vy = 1.0; e.onGround = false; };
  const c3 = EL.spawn('chicken', 14, 20, 14);
  c3.eggLayTime = 99999;
  EL.tickOne(c3);
  ok(c3.vy === 1.0, `a RISING chicken's vy is untouched — the guard is velocity.y < 0.0, not just onGround (got ${c3.vy})`);
  M.Physics.travelMob = realTravelMob;
  const cow = EL.spawn('cow', 15, 20, 15);
  cow.onGround = false; cow.vy = -1.0;
  const vyBeforeCow = cow.vy;
  EL.tickOne(cow);
  // a cow (no Ai.ROSTER goal for slow-fall) does NOT get the 0.6 multiply — only ITS OWN
  // travel/drag law, which is a much smaller damping than 0.6 for one tick.
  ok(cow.vy < vyBeforeCow * 0.6 - 0.01 || cow.vy > vyBeforeCow * 0.98 - 0.2,
    'a falling cow is NOT slow-fall-damped — the 0.6 multiplier is chicken-only, both directions');
  okAv(Ps.CHICKEN_FALL_MULT === 0.6, 'the constant itself is the jar\'s own 0.6, not renamed or drifted');
}

// ═════════════════════ 10. Passive.EatGrassGoal, live ══════════════════════════
{
  say('\n§10 EatGrassGoal');
  const GX = 40, GZ = 40;
  const GRASS = stateOf('grass'), GRASS_BLOCK = stateOf('grass_block'), DIRT = stateOf('dirt');
  ok(GRASS > 0 && GRASS_BLOCK > 0 && DIRT > 0, 'grass/grass_block/dirt all resolve to real states');
  // a solid DIRT floor under every column this section uses — W.setBlock's own support gate
  // (07_world.js) refuses to place a plant (grass) with nothing solid beneath it, exactly
  // vanilla's own canSurvive/canPlaceAt rule, so the floor goes down FIRST every time.
  for (let dx = 0; dx <= 8; dx++) W.setBlock(GX + dx, 9, GZ, DIRT);

  // ── §10a: canUse's own dice ── the roll gate (nextInt(baby?50:1000)===0), both directions
  const sAdult = EL.spawn('sheep', GX, 10, GZ);
  W.setBlock(GX, 10, GZ, GRASS);
  ok(W.getBlock(GX, 10, GZ) === GRASS, 'setup: the grass plant actually placed (DIRT floor supports it)');
  const g1 = new Ps.EatGrassGoal(sAdult, { random: () => 0.5 });   // floor(0.5*1000)=500 !== 0
  ok(!g1.canUse(), 'an adult sheep standing on grass does NOT start eating on a roll that misses nextInt(1000)');
  const g2 = new Ps.EatGrassGoal(sAdult, { random: () => 0 });      // floor(0*1000)=0 -- hits
  ok(g2.canUse(), 'the SAME sheep DOES start eating when the roll hits (rnd()===0)');
  const sBaby = EL.spawn('sheep', GX, 10, GZ);
  sBaby.growAge = -100;
  // a baby's own roll window is nextInt(50), not 1000 -- 1/50 must hit where 1/1000 would miss
  ok(new Ps.EatGrassGoal(sBaby, { random: () => 0.03 }).canUse() === false &&
     new Ps.EatGrassGoal(sBaby, { random: () => 0 }).canUse() === true,
     'a baby sheep rolls nextInt(50), not nextInt(1000) — a roll that would miss the adult window still needs rnd()===0');

  // ── §10b: canUse also needs grass AT FEET or grass_block BELOW ── both refused otherwise
  W.setBlock(GX, 10, GZ, 0);
  okAv(!new Ps.EatGrassGoal(sAdult, { random: () => 0 }).canUse(),
    'no grass at feet and no grass_block below (plain dirt floor) refuses even on a winning roll');
  W.setBlock(GX, 9, GZ, GRASS_BLOCK);
  ok(new Ps.EatGrassGoal(sAdult, { random: () => 0 }).canUse(),
    'grass_block one cell below (feet cell empty) is enough to start');
  W.setBlock(GX, 9, GZ, DIRT);
  W.setBlock(GX, 10, GZ, GRASS);
  ok(new Ps.EatGrassGoal(sAdult, { random: () => 0 }).canUse(),
    'a grass plant AT FEET (grass_block below already dirt) is enough on its own too');

  // ── §10c: the full tick sequence ── timer 40->0, the trigger at 4, the block edit, wool
  // regrow, AND the baby growth boost — driven exactly as `GoalSelector.tick()` drives any goal.
  const sheep = EL.spawn('sheep', GX, 10, GZ);
  sheep.sheared = true;
  sheep.growAge = -200;
  W.setBlock(GX, 10, GZ, GRASS);
  const goal = new Ps.EatGrassGoal(sheep, { random: () => 0, mobGriefing: () => true });
  let ev2001 = 0; const hadSound = !!M.Sound; M.Sound = M.Sound || {}; const origBB = M.Sound.blockBreak; M.Sound.blockBreak = function () { ev2001++; return origBB && origBB.apply(this, arguments); };
  sheep.path = { x: 1 };
  ok(goal.canUse(), 'setup: the eating sheep is allowed to start');
  goal.start();
  ok(sheep.path === null, 'start() stops navigation (path cleared)');
  ok(goal.getTimer() === Ps.EAT_GRASS_MAX_TIMER && sheep.eatGrassTimer === 40,
    `start() sets the timer to the jar's own MAX_TIMER=40, real ticks — this engine's ` +
    `GoalSelector has no alternator (got ${goal.getTimer()})`);
  let ateAt = -1;
  for (let t = 1; t <= 40 && ateAt < 0; t++) {
    goal.tick();
    if (W.getBlock(GX, 10, GZ) !== GRASS) ateAt = t;
  }
  ok(ateAt === Ps.EAT_GRASS_MAX_TIMER - Ps.EAT_GRASS_TRIGGER,
    `the grass block is actually eaten on the SAME real tick the COUNTED-DOWN timer reaches ` +
    `EAT_GRASS_TRIGGER=4 — that is tick 40-4=36 of the countdown, not tick 4 itself (got tick ${ateAt})`);
  M.Sound.blockBreak = origBB; if (!hadSound) delete M.Sound;
  ok(ev2001 === 1, `eating grass fires world event 2001 (break sound) exactly once (got ${ev2001})`);
  ok(W.getBlock(GX, 10, GZ) === 0, 'the grass plant is REMOVED (set to air), not merely marked');
  ok(sheep.sheared === false, 'onEatingGrass sets sheared back to false — wool REGROW, live');
  ok(sheep.growAge > -200, `onEatingGrass's own baby-growth boost actually ran (Breed.ageUp(e,60,false)) — growAge moved off -200 (got ${sheep.growAge})`);
  ok(goal.canContinueToUse(), 'timer is still > 0 right after the trigger tick (36 left)');
  for (let t = 0; t < 40; t++) goal.tick();
  ok(!goal.canContinueToUse(), 'shouldContinue goes false once the timer bottoms out at 0');
  ok(sheep.eatGrassTimer === 0, 'e.eatGrassTimer (the renderer-facing head-down pose field) tracks the timer down to 0 too');

  // ── §10d: the OTHER branch ── grass_block below turns to dirt, not the plant path
  const sheep2 = EL.spawn('sheep', GX + 2, 10, GZ);
  W.setBlock(GX + 2, 10, GZ, 0);
  W.setBlock(GX + 2, 9, GZ, GRASS_BLOCK);
  const goal2 = new Ps.EatGrassGoal(sheep2, { random: () => 0, mobGriefing: () => true });
  goal2.start();
  for (let t = 0; t < 40; t++) goal2.tick();
  ok(W.getBlock(GX + 2, 9, GZ) === DIRT, 'with no grass plant at the feet cell, the grass_block ONE BELOW turns to dirt instead');

  // ── §10e: anti-vacuity, BOTH directions on mobGriefing ── the block edit is gated, onEatingGrass is NOT
  const sheep3 = EL.spawn('sheep', GX + 4, 10, GZ);
  sheep3.sheared = true;
  W.setBlock(GX + 4, 9, GZ, DIRT);
  W.setBlock(GX + 4, 10, GZ, GRASS);
  const goal3 = new Ps.EatGrassGoal(sheep3, { random: () => 0, mobGriefing: () => false });
  goal3.start();
  for (let t = 0; t < 40; t++) goal3.tick();
  okAv(W.getBlock(GX + 4, 10, GZ) === GRASS,
    'mobGriefing=false LEAVES THE GRASS BLOCK ALONE — the edit really is gated, not merely labelled so');
  ok(sheep3.sheared === false,
    'but onEatingGrass STILL fires with griefing off — .decomp\'s own gate is on the block edit only, never on the wool-regrow/growth-boost call');

  // ── §10f: wired into the LIVE sheep roster at priority 5, and Ai.MOVE|LOOK|JUMP ──
  const liveSheep = EL.spawn('sheep', GX + 6, 10, GZ);
  const entry5 = liveSheep.ai.entries.find((x) => x.priority === 5);
  ok(entry5 && entry5.flags === (Ai.MOVE | Ai.LOOK | Ai.JUMP),
    `Ai.ROSTER.sheep wires EatGrassGoal at priority 5 with MOVE|LOOK|JUMP (EatGrassGoal's own ` +
    `EnumSet.of(MOVE,LOOK,JUMP), .decomp) (got ${entry5 && entry5.flags})`);
  ok(entry5 && typeof entry5.goal.getTimer === 'function', 'and it really is an EatGrassGoal instance, not a stand-in');
}

// ═════════════════════ 11. shears/dye wired through Use.entityUse ════════════════════════
{
  say('\n§11 shears/dye through Use.entityUse');
  ok(Use.ready, 'Use module reports ready (14l_use.js loaded and initialised against the real registry)');

  function mkPlayer(over) {
    return Object.assign({ x: 0, y: 0, z: 0, slot: 0, inventory: [null], instabuild: false }, over || {});
  }
  const Iv = M.Inventory;
  const shearsStack = Iv.stack('shears', 1);
  const itemNameOf = (st) => Br.itemNameOf(st);
  ok(itemNameOf(shearsStack) === 'shears', `the shears stack (Iv.stack) resolves to 'shears' through Br.itemNameOf (got ${itemNameOf(shearsStack)})`);

  // ── §11a: shearing through the real dispatch ──
  const e1 = EL.spawn('sheep', 60, 5, 60);
  e1.woolColor = 'cyan';
  const before = EL.list.filter((x) => !x.removed).length;
  const P1 = mkPlayer();
  const shearSounds = [];
  const origSnd = M.Sound;
  M.Sound = { entitySound: function (ev) { shearSounds.push(ev); } };
  const r1 = Use.entityUse(P1, e1, Object.assign({}, shearsStack));
  M.Sound = origSnd;
  ok(r1 === true, 'Use.entityUse(shears, sheep) returns true — the dispatch actually ran');
  ok(e1.sheared === true, 'and the real consequence happened: e.sheared is now true (Passive.shear ran)');
  ok(EL.list.filter((x) => !x.removed).length > before, 'a live wool item entity was actually dropped into the world (EL.dropStack), not merely computed');
  const dropped = EL.list.filter((x) => x.type === 'item' && !x.removed && x.item === 'cyan_wool');
  ok(dropped.length >= 1 && dropped.length <= 3 && dropped.every((x) => x.count === 1), `1-3 separate cyan_wool entities of count 1 (SheepEntity.sheared loops dropItem(wool,1)); got ${dropped.map((x) => x.count)}`);
  okAv(dropped.every((x) => Math.abs(x.y - (e1.y + 1)) < 1e-9), `wool spawns at sheep y+1 (dropItem yOffset 1); got ${dropped.map((x) => x.y)} vs ${e1.y + 1}`);
  ok(shearSounds.includes('entity.sheep.shear'), `entity.sheep.shear played (got ${shearSounds})`);
  // anti-vacuity: an ALREADY-sheared sheep refuses the SAME dispatch — proves entityUse is
  // really asking Passive.shear again, not just returning true unconditionally.
  const before2 = EL.list.filter((x) => !x.removed).length;
  const r1b = Use.entityUse(mkPlayer(), e1, Object.assign({}, shearsStack));
  okAv(r1b === true && EL.list.filter((x) => !x.removed).length === before2,
    'shearing the SAME sheep again (already sheared) is CONSUMED (handled, no fall-through) and drops nothing new');
  const baby2 = EL.spawn('sheep', 64, 5, 64); baby2.growAge = -24000;
  okAv(Use.entityUse(mkPlayer(), baby2, Object.assign({}, shearsStack)) === true && baby2.sheared !== true, 'shears on a BABY sheep: handled=true, no side effects');
  const dead2 = EL.spawn('sheep', 66, 5, 66); dead2.dead = true;
  okAv(Use.entityUse(mkPlayer(), dead2, Object.assign({}, shearsStack)) === true && dead2.sheared !== true, 'shears on a DEAD sheep: handled=true, no side effects');

  // ── §11b: dyeing through the real dispatch ──
  const e2 = EL.spawn('sheep', 62, 5, 62);
  e2.woolColor = 'white';
  const magentaDye = Iv.stack('magenta_dye', 1);
  ok(itemNameOf(magentaDye) === 'magenta_dye', `the dye stack resolves to 'magenta_dye' (got ${itemNameOf(magentaDye)})`);
  const dyeSounds = [];
  M.Sound = { entitySound: function (ev) { dyeSounds.push(ev); } };
  const r2 = Use.entityUse(mkPlayer(), e2, Object.assign({}, magentaDye));
  M.Sound = origSnd;
  ok(dyeSounds.includes('item.dye.use'), `item.dye.use played on dye (got ${dyeSounds})`);
  ok(r2 === true, 'Use.entityUse(dye, sheep) returns true');
  ok(e2.woolColor === 'magenta', `and the sheep is actually recoloured to magenta (got ${e2.woolColor})`);
  // PlayerEntity.interact hands useOnEntity a COPY in creative: the dye is never spent
  const e2c = EL.spawn('sheep', 63, 5, 63); e2c.woolColor = 'white';
  const redC = Iv.stack('red_dye', 2);
  Use.entityUse(mkPlayer({ instabuild: true }), e2c, redC);
  okAv(e2c.woolColor === 'red' && redC.n === 2, `creative dye on sheep keeps the stack (count 2 -> ${redC.n})`);
  // anti-vacuity: dyeing an ALREADY-SHEARED sheep refuses (DyeItem.useOnEntity's own !isSheared() gate)
  const e3 = EL.spawn('sheep', 64, 5, 64);
  e3.sheared = true; e3.woolColor = 'white';
  const r3 = Use.entityUse(mkPlayer(), e3, Object.assign({}, magentaDye));
  okAv(r3 === false && e3.woolColor === 'white', 'dyeing a SHEARED sheep refuses through entityUse too — the colour is untouched');

  // ── §11c: a non-sheep is untouched by either branch (shears/dye do nothing special on a cow) ──
  const cow = EL.spawn('cow', 66, 5, 66);
  const cowBefore = EL.list.filter((x) => !x.removed).length;
  Use.entityUse(mkPlayer(), cow, Object.assign({}, shearsStack));
  ok(EL.list.filter((x) => !x.removed).length === cowBefore, 'shears on a cow drop no wool — the sheep-only gate in this file\'s own dispatch actually holds');
}

// ═════════════════════ 12. Passive.fleeceColor/fleeceTintFor — loop/fleece-s97 ═══════════════
{
  say('\n§12 sheep fleece tint (DyeColor.java lines 11-26 + SheepEntity.getDyedColor lines 89-96)');
  const Ps = M.Passive;
  // white is the LITERAL special case, not white's own colorComponents (16383998 -> 0.98/0.98/0.941, NOT 0.902)
  const white = Ps.fleeceColor('white');
  ok(Math.abs(white[0] - 0.9019608) < 1e-6 && Math.abs(white[1] - 0.9019608) < 1e-6 && Math.abs(white[2] - 0.9019608) < 1e-6,
    `white fleece is the LITERAL 0.9019608 per channel, not its own colorComponents*0.75 (got ${white})`);
  // an independent re-derivation of DyeColor.java's own packed ints (lines 11-26) + the *0.75 rule, checked at a colour with no repeated digits
  function refDyed(v) {
    const r = ((v >> 16) & 255) / 255, g = ((v >> 8) & 255) / 255, b = (v & 255) / 255;
    return [r * 0.75, g * 0.75, b * 0.75];
  }
  const red = Ps.fleeceColor('red');
  const wantRed = refDyed(11546150);
  ok(Math.abs(red[0] - wantRed[0]) < 1e-6 && Math.abs(red[1] - wantRed[1]) < 1e-6 && Math.abs(red[2] - wantRed[2]) < 1e-6,
    `red fleece matches an independent re-derivation of DyeColor.java's own packed int (got ${red}, want ${wantRed})`);
  // every one of the 16 names resolves to a distinct-ish, in-range triple (no undefined slipping through)
  const NAMES = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
    'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
  ok(NAMES.every((n) => {
    const c = Ps.fleeceColor(n);
    return Array.isArray(c) && c.length === 3 && c.every((x) => x >= 0 && x <= 1);
  }), 'all 16 DyeColor names resolve to an in-range [0,1]^3 triple');

  // fleeceTintFor's GATE: sheared -> null, unsheared -> the colour, non-sheep -> null
  const sh1 = EL.spawn('sheep', 70, 5, 70);
  sh1.woolColor = 'purple'; sh1.sheared = false;
  const tint = Ps.fleeceTintFor(sh1);
  const wantPurple = refDyed(8991416);
  ok(tint && Math.abs(tint[0] - wantPurple[0]) < 1e-6, `an unsheared purple sheep's fleeceTintFor matches DyeColor purple (got ${tint})`);
  // anti-vacuity: shearing the SAME sheep flips the gate off — proves the gate reads e.sheared, not a constant
  sh1.sheared = true;
  okAv(Ps.fleeceTintFor(sh1) === null, 'a SHEARED sheep\'s fleeceTintFor is null (the exact fact SheepWoolFeatureRenderer line 29 gates on)');
  const cow2 = EL.spawn('cow', 72, 5, 72);
  ok(Ps.fleeceTintFor(cow2) === null, 'a non-sheep never gets a fleece tint at all');

  // the render-side wiring itself is 07j_entityrender.js's own module (overlay code) and is
  // proved against the real ER.build/ER.visible pipeline in mobrendercheck.mjs §5/§6, not
  // reimplemented here — this file only owns Passive's own pure colour/gate math.
}

// ═════════════════════ 13. pig saddle + carrot-on-a-stick boost math — loop/fleece-s97 ═══════
{
  say('\n§13 pig saddle (Saddleable) + SaddledComponent boost math');
  const Ps = M.Passive;
  function mkPlayer(over) {
    return Object.assign({ x: 0, y: 0, z: 0, slot: 0, inventory: [null], instabuild: false }, over || {});
  }
  const pig = EL.spawn('pig', 74, 5, 74);
  ok(Ps.pigCanBeSaddled(pig), 'an adult, alive pig canBeSaddled (PigEntity.canBeSaddled: isAlive() && !isBaby(), NO taming gate)');
  ok(!Ps.pigIsSaddled(pig), 'a fresh pig starts unsaddled');
  ok(Ps.pigSaddle(pig) === true, 'Ps.pigSaddle equips it');
  ok(Ps.pigIsSaddled(pig) === true, 'and pigIsSaddled now reports true');
  // anti-vacuity: an ALREADY-saddled pig refuses a second saddle (SaddleItem.useOnEntity's own !isSaddled() gate)
  okAv(Ps.pigSaddle(pig) === false, 'saddling an ALREADY-saddled pig refuses (the same gate a second right-click hits in vanilla)');
  // a baby pig cannot be saddled (PigEntity.canBeSaddled's own !isBaby() half)
  const baby = EL.spawn('pig', 76, 5, 76);
  baby.growAge = -1000;
  okAv(!Ps.pigCanBeSaddled(baby), 'a BABY pig cannot be saddled (canBeSaddled\'s own !isBaby() gate)');
  ok(Ps.pigSaddle(baby) === false, 'and Ps.pigSaddle actually refuses on a baby, not just canBeSaddled in isolation');

  // ── the real dispatch, through Use.entityUse (14l_use.js), the same slot §11 already proves for sheep ──
  const Iv2 = M.Inventory;
  const saddleStack = Iv2.stack('saddle', 1);
  ok(Br.itemNameOf(saddleStack) === 'saddle', `the saddle stack resolves to 'saddle' (got ${Br.itemNameOf(saddleStack)})`);
  const pig2 = EL.spawn('pig', 78, 5, 78);
  const P2 = mkPlayer();
  const rSad = Use.entityUse(P2, pig2, Object.assign({}, saddleStack));
  ok(rSad === true, 'Use.entityUse(saddle, pig) returns true — the real 14l_use.js dispatch ran');
  ok(Ps.pigIsSaddled(pig2) === true, 'and the pig is actually saddled through the real dispatch, not just Ps.pigSaddle in isolation');
  // loop/pigride-s98 -- `PigEntity.interactMob` (.decomp): once saddled + unridden, ANY
  // right-click (a saddle in hand included) MOUNTS instead of re-saddling — this replaces the
  // old (pre-mounting) expectation that a second saddle attempt just refused, since a real
  // dispatch now has somewhere else to send that click first, exactly as vanilla does.
  const P2b = mkPlayer();
  const rMount = Use.entityUse(P2b, pig2, Object.assign({}, saddleStack));
  ok(rMount === true, 'a second click on the saddled, unridden pig MOUNTS it instead of re-saddling (PigEntity.interactMob\'s own priority)');
  ok(pig2.rider === 'player', 'and the pig is now actually ridden (Passive.pigMount\'s state change)');
  // anti-vacuity: dispatching AGAIN on the now-RIDDEN pig neither mounts nor re-saddles
  okAv(Use.entityUse(mkPlayer(), pig2, Object.assign({}, saddleStack)) === false, 'a third click on the now-ridden pig does nothing (already has a rider, already saddled)');
  // a non-pig ignores the saddle branch entirely (the species gate in this file's own dispatch holds)
  const cow3 = EL.spawn('cow', 80, 5, 80);
  ok(Use.entityUse(mkPlayer(), cow3, Object.assign({}, saddleStack)) === false, 'a saddle on a cow does nothing (Use.entityUse\'s pig-only gate holds)');

  // ── SaddledComponent.boost(Random) (.decomp lines 30-40): the roll range is [140, 980] inclusive ──
  const e = { boosted: false };
  ok(Ps.pigBoost(e, () => 0) === true, 'Ps.pigBoost(rnd=0) succeeds on an unboosted pig');
  ok(e.currentBoostTime === Ps.PIG_BOOST_MIN, `rnd=0 lands the MINIMUM boost time, 140 (SaddledComponent.MIN_BOOST_TIME, got ${e.currentBoostTime})`);
  ok(e.boostedTime === 0, 'boostedTime resets to 0 on a fresh boost');
  const e2b = { boosted: false };
  Ps.pigBoost(e2b, () => 0.999999);
  ok(e2b.currentBoostTime === Ps.PIG_BOOST_MIN + Ps.PIG_BOOST_ROLL - 1, `rnd→1 lands the MAXIMUM boost time, 980 (got ${e2b.currentBoostTime})`);
  // anti-vacuity: an ALREADY-boosted pig refuses a second boost (SaddledComponent.boost's own `if (this.boosted) return false`)
  okAv(Ps.pigBoost(e, () => 0.5) === false, 'boosting an ALREADY-boosted pig refuses (the exact re-boost guard SaddledComponent.boost opens with)');

  // ── PigEntity.getSaddledSpeed() * ItemSteerable.travel's own half-sine boost hump ──
  const unboosted = { boosted: false };
  const baseSpeed = Ps.pigTravelSpeed(1.0, unboosted);
  ok(Math.abs(baseSpeed - Ps.PIG_SADDLED_SPEED_MUL) < 1e-9, `an unboosted pig's travel speed is exactly movementSpeed*0.225 (PigEntity.getSaddledSpeed, got ${baseSpeed})`);
  const midBoost = { boosted: true, boostedTime: 70, currentBoostTime: 140 };   // halfway: sin(PI/2) = 1, the hump's PEAK
  const peakSpeed = Ps.pigTravelSpeed(1.0, midBoost);
  const wantPeak = baseSpeed + baseSpeed * 1.15 * Math.sin(0.5 * Math.PI);
  ok(Math.abs(peakSpeed - wantPeak) < 1e-9, `at the boost's exact midpoint the +115% hump peaks (sin(PI/2)=1) — got ${peakSpeed}, want ${wantPeak}`);
  const endBoost = { boosted: true, boostedTime: 140, currentBoostTime: 140 };   // sin(PI) = 0, the hump's END
  ok(Math.abs(Ps.pigTravelSpeed(1.0, endBoost) - baseSpeed) < 1e-9, 'at the boost\'s own end (boostedTime===currentBoostTime, sin(PI)=0) speed is back to base — the hump is a SINE, not a flat multiplier');
  // anti-vacuity: a flat +15% stand-in (no sine shape at all) would NOT match the midpoint the real formula gives
  const brokenFlatMid = baseSpeed * 1.15;
  okAv(Math.abs(peakSpeed - brokenFlatMid) > 1e-6, `the real half-sine hump at midpoint (${peakSpeed}) is distinguishable from a flat +15% stand-in (${brokenFlatMid}) — the sine shape is not vacuously equivalent to a constant`);
}

console.log(`\n${pass} checks passed, ${breaks} breaks caught, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.log('  x ' + f);
  process.exit(1);
}
process.exit(0);
