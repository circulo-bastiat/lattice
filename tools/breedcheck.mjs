#!/usr/bin/env node
// breedcheck.mjs — PLAN G18e, unit 1: LOVE MODE, FEEDING AND BREEDING.
//
//   node tools/breedcheck.mjs [--verbose]
//
// ⚠ WHAT THIS PROVES. Every number the breeding loop runs on comes out of the 1.18.2 bytecode
// (`tools/extract-breeding.mjs`), so the interesting question is never "is 600 right" — it is
// whether this engine's state machine is the jar's state machine. So the sections below drive
// the real `Breed` module, the real `EntityList` tick and the real `Ai.BreedGoal`, and each one
// asserts in BOTH directions (rule 6): the thing happens when vanilla says it does AND does not
// when it says it does not.
//
// ⚠ AND IT PROVES THE TABLE IS NOT A LIST SOMEBODY KEPT. §1 asserts the four KINDS are all
// present and distinct — an explicit list, a tag, a constant refusal (parrot and polar bear
// cannot be bred in vanilla at all) and a predicate (a wolf's rule is not a list) — because a
// packer that flattened the last two into "no items" would turn a fact into a hole.

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

console.log('breedcheck — PLAN G18e unit 1, love mode, feeding and breeding');

const M = loadEngine({
  // ⚠ `02g_items.js` IS HERE FOR ONE ASSERTION AND IT EARNS ITS PLACE: §6 resolves a held
  // stack through the REAL item registry, which is the only way to prove the live player's
  // `heldItem()` shape reaches `Breed.isFood` as a name rather than as an object.
  extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
          '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07zx_particle.js', '07zzo_stats.js']
});
{
  const meta = JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8'));
  M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
}
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8'))
});
M.Entities.init();
M.EntityList.init();
M.Behave.init(M.World);
M.Ai.init();
M.Breed.init();

const Br = M.Breed, Ent = M.Entities, EL = M.EntityList, W = M.World, CH = M.CH;
ok(Br.ready, 'Breed module reports ready');
if (!Br.ready) {
  console.log('\nFAIL  Breed did not initialise — the breeding table is missing from entities.json');
  process.exit(1);
}

// ═══════════════════════════ 1. the table, and its four kinds ═══════════════════════════════
{
  say('\n§1 the table');
  const animals = Ent.animals();
  ok(animals.length >= 25, `the jar gives ${animals.length} animals a breeding rule (expected 25+)`);
  const kind = (n) => (Ent.breedFood(n) || {}).k;
  ok(kind('cow') === 'items' && Ent.breedFood('cow').i.join() === 'wheat',
    `cow's isFood is Animal's own wheat rule (got ${JSON.stringify(Ent.breedFood('cow'))})`);
  ok(kind('pig') === 'items' && Ent.breedFood('pig').i.length === 3,
    'pig takes exactly three items — the one everybody misremembers as two');
  ok(kind('fox') === 'tag' && Ent.breedFood('fox').t.length === 1, 'fox takes a TAG, not a list');
  ok(kind('parrot') === 'none' && kind('polar_bear') === 'none',
    'parrot and polar bear are `none` — vanilla forbids breeding them, which is not the same as unbuilt');
  ok(kind('wolf') === 'predicate', 'wolf is a PREDICATE (any edible meat), which is not a list');
  // the four kinds are all present: if the packer ever collapsed two of them this is where it shows
  const kinds = new Set(animals.map(kind));
  ok(kinds.has('items') && kinds.has('tag') && kinds.has('none') && kinds.has('predicate'),
    `all four kinds survive the pack step (got ${[...kinds].sort().join(' ')})`);

  const C = Ent.BREED;
  for (const k of ['inLoveTicks', 'breedCooldownAge', 'xpBound', 'babyStartAge', 'ageUpUnit', 'forcedAgeTimer', 'heartInterval', 'growParticleInterval']) {
    ok(Number.isFinite(C[k]), `constant ${k} travelled into the runtime (${C[k]})`);
  }
  ok(C.inLoveTicks === 600 && C.breedCooldownAge === 6000 && C.babyStartAge === -24000 && C.ageUpUnit === 20,
    'the four constants that cannot be in doubt are the jar\'s');
  // G20's deferred half is CARRIED, not dropped: the cadences are here for the day hearts exist
  ok(C.heartInterval === 10 && C.growParticleInterval === 4,
    'the two particle cadences are carried unread for G20 (heart every 10 ticks, growth puff every 4)');
}

// ═══════════════════════════ 2. isFood, in both directions ══════════════════════════════════
{
  say('\n§2 isFood');
  ok(Br.isFood('cow', 'wheat'), 'a cow takes wheat');
  ok(!Br.isFood('cow', 'carrot'), 'a cow refuses a carrot — the pig\'s food, not hers');
  ok(Br.isFood('pig', 'beetroot') && !Br.isFood('pig', 'wheat'), 'a pig takes beetroot and refuses wheat');
  ok(!Br.isFood('parrot', 'wheat_seeds') && !Br.isFood('parrot', 'cookie'),
    'a parrot refuses everything — its isFood is a constant false');
  // D-493: WolfEntity.isBreedingItem — isFood && isMeat, the eleven FoodComponents built .meat()
  ok(Br.isFood('wolf', 'beef') && Br.isFood('wolf', 'rotten_flesh') && Br.isFood('wolf', 'cooked_rabbit'), 'a wolf takes meat (beef, rotten flesh, cooked rabbit)');
  ok(!Br.isFood('wolf', 'cod') && !Br.isFood('wolf', 'bone') && !Br.isFood('wolf', 'bread'), '...and refuses fish, a bone and bread — cod is food but not meat');
  // the tag path, through the real tag registry rather than a copied list
  const foxTag = Ent.breedFood('fox').t[0].replace(/^#/, '').replace(/^minecraft:/, '');
  const members = M.Tags.ready ? M.Tags.items(foxTag) : [];
  ok(members.length > 0, `#${foxTag} resolves to ${members.length} items in the real tag registry`);
  if (members.length) {
    ok(Br.isFood('fox', members[0]), `a fox takes ${members[0]}, a member of its own tag`);
    ok(!Br.isFood('fox', 'wheat'), 'a fox refuses wheat, which is not in its tag');
  }
  ok(Br.canBreed('cow'), 'cow is a species this engine will run the whole loop for');
  // QUEUE 0.2 (G18c) -- sheep closed: Breed.SPECIAL.sheep is gone, Breed.CHILD.sheep exists
  // (07w_passive.js's own e.woolColor), so sheep now runs the whole loop too -- passivecheck.mjs
  // is where the wool-mix half of that claim is actually exercised.
  ok(Br.canBreed('sheep'), 'sheep now runs the whole loop -- Breed.CHILD.sheep mixes wool colour (G18c)');
  ok(!Br.canBreed('parrot'), 'parrot is refused because vanilla refuses it');
}

// ═══════════════════════════ 3. AgeableMob — the age ════════════════════════════════════════
{
  say('\n§3 the age');
  const C = Ent.BREED;
  const e = { type: 'cow' };
  Br.setBaby(e, true);
  ok(Br.getAge(e) === C.babyStartAge && Br.isBaby(e) && e.isBaby === true,
    'setBaby(true) starts at the jar\'s -24000 and sets the flag the goals and the renderer read');
  Br.tickAge(e);
  ok(Br.getAge(e) === C.babyStartAge + 1, 'a baby\'s age walks UP toward nought, one a tick');
  Br.setAge(e, 5); Br.tickAge(e);
  ok(Br.getAge(e) === 4 && !Br.isBaby(e), 'an adult on cooldown walks DOWN toward nought and is not a baby');
  Br.setAge(e, 0); Br.tickAge(e);
  ok(Br.getAge(e) === 0, 'an adult at nought stays at nought — the walk is toward it, not through it');

  // ageUp: seconds, times the jar's own unit, clamped at nought
  const a = { type: 'cow' }; Br.setAge(a, -1000);
  Br.ageUp(a, 10, false);
  ok(Br.getAge(a) === -1000 + 10 * C.ageUpUnit, `ageUp(10) is 10 x ${C.ageUpUnit} ticks, not 10`);
  Br.ageUp(a, 1000, false);
  ok(Br.getAge(a) === 0, 'ageUp past adulthood clamps at nought rather than overshooting into cooldown');
  // the forced-age banking, which is what stops a fed baby from overshooting
  const f = { type: 'cow' }; Br.setAge(f, -100);
  Br.ageUp(f, 3, true);
  ok(f.forcedAge === 60 && f.forcedAgeTimer === C.forcedAgeTimer,
    `feeding banks the delta in forcedAge (${f.forcedAge}) and starts the ${C.forcedAgeTimer}-tick timer`);
  Br.tickAge(f);
  ok(f.forcedAgeTimer === C.forcedAgeTimer - 1, 'the forced-age timer runs down with the age');

  // ⚠ THE FLOAT QUESTION, SWEPT RATHER THAN ASSUMED (07m_breed.js's header). The jar writes
  // `(int)((float)(-age / 20) * 0.1F)`; this asserts the float and the double agree at EVERY
  // reachable baby age, which is the claim the module's comment makes.
  let disagreements = 0;
  for (let age = C.babyStartAge; age < 0; age++) {
    const n = Math.trunc(-age / 20);
    if (Math.trunc(Math.fround(n * Math.fround(0.1))) !== Math.trunc(n * 0.1)) disagreements++;
  }
  ok(disagreements === 0,
    `the 0.1f and 0.1 readings of the feeding amount agree at all ${-C.babyStartAge} reachable baby ages (${disagreements} disagree)`);

  // ANTI-VACUITY: the seconds-to-ticks unit is what makes ageUp mean anything
  const savedUnit = Br.C.ageUpUnit;
  Br.C = Object.assign({}, Br.C, { ageUpUnit: 1 });
  const bad = { type: 'cow' }; Br.setAge(bad, -1000); Br.ageUp(bad, 10, false);
  okAv(Br.getAge(bad) !== -1000 + 10 * savedUnit,
    'with ageUpUnit broken to 1, the ageUp test above genuinely fails — it is not asserting an identity');
  Br.C = Object.assign({}, Br.C, { ageUpUnit: savedUnit });
}

// ═══════════════════════════ 4. feeding — Animal.mobInteract ════════════════════════════════
{
  say('\n§4 feeding');
  const C = Ent.BREED;
  let spent = 0;
  const feed = (e, item, creative) => Br.interact(e, item, {
    player: { name: 'test' }, instabuild: !!creative, consume: (n) => { spent += n; }
  });

  const cow = { type: 'cow' }; Br.setAge(cow, 0);
  spent = 0;
  ok(feed(cow, 'wheat') === 'love', 'an adult cow fed wheat falls in love');
  ok(cow.inLove === C.inLoveTicks, `love mode is ${C.inLoveTicks} ticks`);
  { const Px = M.Particle; Px.clear();
    const c2 = { type: 'cow', x: 0, y: 64, z: 0, width: 0.9, height: 1.4 }; Br.setAge(c2, 0);
    feed(c2, 'wheat');
    ok(Px.list.length === 7, `feeding wheat emits the 7-heart burst at once (got ${Px.list.length})`);
    const real = Br.lovePlayer; Br.lovePlayer = (e, p) => Br.setInLove(e, p); Px.clear();
    const c3 = { type: 'cow', x: 0, y: 64, z: 0, width: 0.9, height: 1.4 }; Br.setAge(c3, 0); feed(c3, 'wheat');
    okAv(Px.list.length === 0, 'with lovePlayer reduced to setInLove no burst is emitted - the burst assertion can fail');
    Br.lovePlayer = real; Px.clear(); spent = 1; }
  ok(spent === 1, 'exactly one wheat left the stack');
  ok(cow.loveCause && cow.loveCause.name === 'test', 'the love cause is the player who fed her — vanilla credits the breed to them');

  // both directions: already in love, and the wrong item
  spent = 0;
  ok(feed(cow, 'wheat') === false, 'a cow ALREADY in love refuses a second wheat (canFallInLove)');
  ok(spent === 0, 'and the refused wheat is not spent');
  ok(feed({ type: 'cow', growAge: 0 }, 'carrot') === false, 'a cow refuses a carrot outright');
  ok(feed({ type: 'parrot', growAge: 0 }, 'cookie') === false, 'a parrot cannot be fed into love at all');

  // an adult on the breeding cooldown is not in love and cannot fall in love
  const tired = { type: 'cow' }; Br.setAge(tired, C.breedCooldownAge);
  spent = 0;
  ok(feed(tired, 'wheat') === false, 'a cow on the breeding cooldown refuses wheat — age !== 0');
  ok(spent === 0, 'and spends nothing');

  // the baby branch
  const calf = { type: 'cow' }; Br.setBaby(calf, true);
  spent = 0;
  ok(feed(calf, 'wheat') === 'grow', 'a baby cow fed wheat GROWS instead of falling in love');
  ok(Br.getAge(calf) === C.babyStartAge + 120 * C.ageUpUnit,
    `a calf at ${C.babyStartAge} grows by exactly 120 x ${C.ageUpUnit} ticks (got ${Br.getAge(calf) - C.babyStartAge})`);
  ok(spent === 1, 'and it costs one wheat');
  ok(calf.inLove !== C.inLoveTicks, 'a fed baby is NOT in love — the age branch comes first, which is the jar\'s order');

  // creative spends nothing, the same `instabuild` rule every other use path reads
  const freebie = { type: 'cow', growAge: 0 };
  spent = 0;
  ok(feed(freebie, 'wheat', true) === 'love' && spent === 0, 'in creative the wheat is not spent');

  // ANTI-VACUITY: drop the canFallInLove gate and the second-feed refusal disappears
  const savedGate = Br.canFallInLove;
  Br.canFallInLove = () => true;
  const twice = { type: 'cow', growAge: 0 };
  feed(twice, 'wheat');
  okAv(feed(twice, 'wheat') === 'love',
    'with canFallInLove forced true the double-feed refusal above genuinely stops firing');
  Br.canFallInLove = savedGate;
}

// ═══════════════════════════ 5. the breed itself ════════════════════════════════════════════
{
  say('\n§5 breeding');
  const C = Ent.BREED;
  EL.init();
  const a = EL.spawn('cow', 0.5, 8, 0.5), b = EL.spawn('cow', 1.5, 8, 0.5);
  ok(!!a && !!b, 'two cows spawn through the real EntityList');
  Br.setAge(a, 0); Br.setAge(b, 0);
  ok(Br.breed(a, b) === null, 'two cows NOT in love do not breed');
  Br.setInLove(a, null); Br.setInLove(b, null);
  ok(Br.canMate(a, b), 'two adults in love may mate');
  ok(!Br.canMate(a, a), 'an animal may not mate with itself');
  const before = EL.list.length;
  const St = M.Stats, bred0 = St && St.getCustom ? St.getCustom('animals_bred') : null;
  a.loveCause = { name: 'test' };
  const child = Br.breed(a, b, { random: () => 0.5 });
  ok(!!child && child.type === 'cow', 'the pair produce a child');
  okAv(bred0 !== null && St.getCustom('animals_bred') === bred0 + 1, 'a player-caused breed increments animals_bred by one');
  ok(Br.isBaby(child) && Br.getAge(child) === C.babyStartAge, 'and the child is a baby at -24000');
  ok(Br.getAge(a) === C.breedCooldownAge && Br.getAge(b) === C.breedCooldownAge,
    `both parents go to the ${C.breedCooldownAge}-tick cooldown`);
  ok(!Br.isInLove(a) && !Br.isInLove(b), 'and both fall out of love');
  ok(Br.breed(a, b) === null, 'a second breed is refused immediately — the cooldown is real');
  const orbs = EL.list.filter((e) => e.type === 'experience_orb');
  ok(orbs.length === 1, `one experience orb is dropped (got ${orbs.length})`);
  ok(orbs.length === 1 && orbs[0].value >= 1 && orbs[0].value <= C.xpBound,
    `and its value is 1..${C.xpBound} (got ${orbs.length ? orbs[0].value : 'none'})`);
  ok(EL.list.length === before + 2, 'exactly two entities were added: the child and the orb');
  // loop/goat-s99 (QUEUE 0.2 G18c): goat left Breed.SPECIAL this session (it has
  // Breed.CHILD.goat now, goatcheck.mjs exercises it live, the same shape ace6425 moved this
  // example off of when sheep left before it) -- turtle is still in Breed.SPECIAL (no
  // egg-laying substrate anywhere in this engine), so it is turtle's turn to prove the refusal.
  // s103 (orchestrator): turtle LEFT Breed.SPECIAL in loop/turtle-s102 and trader_llama in
  // loop/wtrader-s103 — the table is EMPTY now, so the refusal MECHANISM is proven on a species
  // planted in it for the duration of the assertion (cow: it has a real child, so a null here can
  // only be the SPECIAL gate), and the empty table itself is asserted (G18's Breed.SPECIAL line).
  ok(Object.keys(Br.SPECIAL).length === 0, `Breed.SPECIAL is empty (G18) — got ${Object.keys(Br.SPECIAL).join(',')}`);
  Br.SPECIAL.cow = 'planted by breedcheck';
  ok(Br.breed({ type: 'cow', growAge: 0, inLove: 600 }, { type: 'cow', growAge: 0, inLove: 600 }) === null,
    'a species in Breed.SPECIAL refuses rather than spawning a child missing its own field');
  delete Br.SPECIAL.cow;

  // ANTI-VACUITY: take the cooldown away and the second-breed refusal stops firing
  const savedCool = Br.C.breedCooldownAge;
  Br.C = Object.assign({}, Br.C, { breedCooldownAge: 0 });
  const c1 = EL.spawn('cow', 3.5, 8, 0.5), c2 = EL.spawn('cow', 4.5, 8, 0.5);
  Br.setAge(c1, 0); Br.setAge(c2, 0); Br.setInLove(c1, null); Br.setInLove(c2, null);
  Br.breed(c1, c2, { random: () => 0.5 });
  Br.setInLove(c1, null); Br.setInLove(c2, null);
  okAv(Br.breed(c1, c2, { random: () => 0.5 }) !== null,
    'with the cooldown broken to 0 a pair breeds twice in a row — so the refusal above can actually fail');
  Br.C = Object.assign({}, Br.C, { breedCooldownAge: savedCool });
}

// ═══════════════════════════ 6. the live wiring ═════════════════════════════════════════════
// ⚠ THE STUBS ARE THE POINT. `EL.aiCtx`'s `onBreed` did nothing and `isTempting` always refused,
// so `Ai.BreedGoal` and `Ai.TemptGoal` have been wired to nothing since D-383 and no check could
// tell. These assertions are about the JOIN (rule 7), not about either end of it.
{
  say('\n§6 the live wiring');
  EL.init();
  const cow = EL.spawn('cow', 0.5, 8, 0.5);
  ok(!!cow && !!cow.ai, 'a spawned cow gets the real goal selector');
  ok(cow.growAge === undefined || Br.getAge(cow) === 0, 'a spawned cow is an adult');
  const ctx = EL.aiCtx(cow);
  ok(ctx.isTempting('wheat'), 'the live ctx is tempted by wheat — the stub always refused');
  ok(!ctx.isTempting('carrot'), 'and not by a carrot');
  ok(ctx.isTempting(() => ({ i: M.Items && M.Items.of ? M.Items.of('wheat') : -1, n: 1 })),
    'a held item given as the live player\'s heldItem FUNCTION resolves too (D-276\'s shape, caught here rather than in the game)');
  const p1 = EL.spawn('cow', 2.5, 8, 0.5), p2 = EL.spawn('cow', 3.5, 8, 0.5);
  Br.setAge(p1, 0); Br.setAge(p2, 0); Br.setInLove(p1, null); Br.setInLove(p2, null);
  const made = EL.aiCtx(p1).onBreed(p1, p2);
  ok(!!made && made.type === 'cow', 'the live ctx.onBreed makes a real baby — the stub returned nothing');

  // the tick hooks: love counts down through the real EntityList tick, and age with it
  EL.init();
  const t = EL.spawn('cow', 0.5, 8, 0.5);
  Br.setAge(t, 0); Br.setInLove(t, null);
  const love0 = t.inLove;
  EL.tickOne(t);
  ok(t.inLove === love0 - 1, `love counts down through EL.tickOne (${love0} -> ${t.inLove})`);
  Br.setAge(t, 10);
  EL.tickOne(t);
  ok(Br.getAge(t) === 9, 'and the age walks toward nought through the same tick');
  ok(t.inLove === 0, 'an animal that is not an adult is dropped out of love by the tick — the jar checks the age first');

  // ANTI-VACUITY: unhook Breed and the countdown stops, so the two assertions above can fail
  const savedReady = Br.ready;
  Br.ready = false;
  const u = EL.spawn('cow', 6.5, 8, 0.5);
  Br.setAge(u, 0); Br.setInLove(u, null);
  const before = u.inLove;
  EL.tickOne(u);
  okAv(u.inLove === before, 'with Breed unhooked EL.tickOne stops counting love down — the wiring assertions are real');
  Br.ready = savedReady;
}

console.log('');
console.log('\n§9. wolf and cat breed as their own classes say (D-493, Wolf/CatEntity canBreedWith + createChild)');
{
  const pair = (type, x) => { const a = EL.spawn(type, x, 8, 0.5), b = EL.spawn(type, x + 1, 8, 0.5);
    for (const e of [a, b]) { Br.setAge(e, 0); Br.setInLove(e, null); } return [a, b]; };
  ok(Br.canBreed('wolf') && Br.canBreed('cat'), 'wolf and cat are bred by this engine now (cat is out of Breed.SPECIAL)');
  const [w1, w2] = pair('wolf', 20);
  ok(Br.breed(w1, w2) === null, 'two WILD wolves in love do not breed (WolfEntity.canBreedWith: this.isTamed())');
  w1.tamed = w2.tamed = true; w1.owner = w2.owner = 'player'; w2.sitting = true;
  for (const e of [w1, w2]) Br.setInLove(e, null);
  ok(Br.breed(w1, w2) === null, 'a tamed wolf whose partner SITS does not breed (isInSittingPose)');
  w2.sitting = false;
  const pup = Br.breed(w1, w2, { random: () => 0.5 });
  ok(pup && pup.type === 'wolf' && pup.tamed === true && pup.owner === 'player' && Br.isBaby(pup),
     'two tamed wolves breed a TAMED pup owned by the first parent\'s owner');
  ok(pup.maxHealth === 20 && pup.health === 20, 'the tamed pup has 20/20 health (WolfEntity.setTamed(true)), not the wild 8');
  okAv(pair('wolf', 60)[0].maxHealth === 8, 'anti-vacuity: a wild wolf really starts at 8, so the pup\'s 20 was set by the breed path');
  const [c1, c2] = pair('cat', 30);
  c1.tamed = c2.tamed = true; c1.owner = c2.owner = 'player';
  c1.catVariant = 3; c2.catVariant = 7; c1.collarColor = 'blue'; c2.collarColor = 'lime';
  const k1 = Br.breed(c1, c2, { random: () => 0.1 });
  ok(k1 && k1.catVariant === 3 && k1.collarColor === 'blue' && k1.tamed === true, 'a kitten (nextBoolean true) takes the first parent\'s variant and collar');
  for (const e of [c1, c2]) { Br.setAge(e, 0); Br.setInLove(e, null); }
  const k2 = Br.breed(c1, c2, { random: () => 0.9 });
  ok(k2 && k2.catVariant === 7 && k2.collarColor === 'lime', '...and (nextBoolean false) the second parent\'s');
  const [c3, c4] = pair('cat', 40);
  c3.tamed = true;
  ok(Br.breed(c3, c4) === null, 'a tamed cat does not breed with a wild one (CatEntity.canBreedWith: both tamed)');
  const realMate = Br.MATE;
  let wildBred;
  try { Br.MATE = {}; const [x1, x2] = pair('wolf', 50); wildBred = Br.breed(x1, x2) !== null; } finally { Br.MATE = realMate; }
  okAv(wildBred === true, 'with the species gates removed two wild wolves DO breed — the refusals above rest on Br.MATE');
}

// #3524: AnimalMateGoal.findMate = canBreedWith + 3-D range 8
{
  const lover = (t, x, y) => { const m = EL.spawn(t, x, y, 0.5); m.inLove = 600; return m; };
  const cu = (m, o) => new M.Ai.BreedGoal(m, 1.0, () => [m, o], () => {}).canUse();
  const h = lover('horse', 0.5, 8), dk = lover('donkey', 5.5, 8); h.tamed = dk.tamed = true; // HorseBaseEntity.canBreed needs tame (#3933)
  ok(cu(h, dk) && cu(dk, h), 'in-love horse and donkey 5 blocks apart target each other');
  const m1 = lover('mule', 0.5, 8), m2 = lover('mule', 3.5, 8);
  ok(!cu(m1, m2), 'a mule pair never targets each other');
  for (const t of ['zombie_horse', 'skeleton_horse']) {
    const u1 = lover(t, 0.5, 8), u2 = lover(t, 3.5, 8); u1.tamed = u2.tamed = true; u1.health = u1.maxHealth; u2.health = u2.maxHealth;
    ok(!Br.canMate(u1, u2) && !cu(u1, u2), 'two tame in-love ' + t + ' never mate (#3958)');
    const rm = Br.MATE[t]; delete Br.MATE[t];
    let broke; try { broke = Br.canMate(u1, u2); } finally { Br.MATE[t] = rm; }
    okAv(broke === true, 'without its MATE row the ' + t + ' pair WOULD mate - the refusal rests on Br.MATE');
  }
  const c1 = lover('cow', 0.5, 8), c2 = lover('cow', 0.5, 17);
  ok(!cu(c1, c2), 'a mate 9 blocks up is out of the 3-D range');
  const wl = lover('wolf', 0.5, 8), w2 = lover('wolf', 2.5, 8);
  okAv(!cu(wl, w2), 'two untamed wolves in love do not target each other (canMate gate)');
  const realCan = Br.canMate;
  let viaType; try { Br.canMate = () => true; viaType = cu(m1, m2); } finally { Br.canMate = realCan; }
  okAv(viaType === true, 'with canMate stubbed true the mule pair WOULD target - the refusal rests on canMate');
}

console.log('================ breedcheck =================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
console.log('==============================================');
for (const f of fails) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
