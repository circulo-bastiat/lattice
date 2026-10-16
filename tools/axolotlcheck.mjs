#!/usr/bin/env node
// axolotlcheck.mjs — loop/panda-axolotl-s101 (QUEUE 0.2 G18c, missing overworld mob): the
// AXOLOTL, whole. Drives the REAL modules (07zm_axolotl.js, Ai.ROSTER.axolotl/
// EL.DEFAULTS.axolotl/Spawn.RULES.axolotl/Breed.CHILD.axolotl/Cb.hurt's own play-dead hook/
// Use.entityUse+Use's own bucket branches) against `.decomp/net/minecraft/entity/passive/
// AxolotlEntity.java` (634 lines) and `AxolotlBrain.java` (179 lines), both read in full.
//
//   node tools/axolotlcheck.mjs [--verbose]
//
// Sections:
//   1. attributes/dimensions/breeding food — the jar-extracted entity table's own row
//   2. variants — Ax.skinKey's five-sheet family, Ax.randomNaturalVariant excludes blue
//   3. EL.spawn('axolotl', ...) — EL.DEFAULTS.axolotl rolls a natural variant, Ai.ROSTER attaches e.ai
//   4. Spawn.RULES.axolotl — axolotls_spawnable_on tag, deliberately NO light check
//   5. Ax.createChild / Breed.CHILD.axolotl — 1/1200 blue mutation, else a parent's variant
//   6. play dead — Ax.onDamaged's trigger gate, Ax.tickPlayDead's countdown, Cb.canAttack's gate
//   7. Ax.buffPlayer — Regeneration add (capped 2400) + Mining Fatigue clear
//   8. Ax.WanderGoal — cooldown-gated random-point walk, refuses while playing dead
//   9. bucketing — Use.entityUse's capture branch + the axolotl_bucket release branch
//  10. anti-vacuity — break the check's own data/stubs and watch it catch the break

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c && VERBOSE) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };

console.log('axolotlcheck — loop/panda-axolotl-s101 (QUEUE 0.2 G18c), the axolotl, whole');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
               '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
               '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
               '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js', '07z_potion.js',
               '07m_breed.js', '07zh_rabbit.js', '07zj_fox.js', '07zj_goat.js', '07zl_panda.js',
               '07q_effects.js', '07zm_axolotl.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });

const EL = MCL.EntityList, Ai = MCL.Ai, Spawn = MCL.Spawn, Ent = MCL.Entities;
const Ax = MCL.Axolotl, Breed = MCL.Breed, W = MCL.World, S = MCL.States;
const Cb = MCL.Combat, Use = MCL.Use, Iv = MCL.Inventory, ES = MCL.Effects;
const CH = MCL.CH;

MCL.Entities.init();
Ent.attrs = MCL.DATA.entities.attrs;
W.init(1);
MCL.Behave.init(W);
EL.init();
Ai.init();
Spawn.init();
Breed.init();
if (Cb && Cb.init) Cb.init();
if (ES && ES.init) ES.init();
if (Use && Use.init) Use.init(W);

for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}

ok(Ax && Ax.ready, 'NS.Axolotl did not load/ready');

// ── 1. attributes/dimensions/breeding food ──────────────────────────────────────────────────
say('1. the jar-extracted entity table’s own row for axolotl');
{
  const at = Ent.attrsOf('axolotl');
  ok(!!at, 'Ent.attrsOf(axolotl) missing entirely');
  ok(at && at.hp === 14, `axolotl max health 14 — got ${at && at.hp}`);
  ok(at && Math.abs(at.speed - 1.0) < 1e-6, `axolotl movement speed 1.0 — got ${at && at.speed}`);
  ok(at && at.dmg === 2, `axolotl attack damage 2 — got ${at && at.dmg}`);
  const dim = Ent.dimensions('axolotl');
  ok(dim && Math.abs(dim.width - 0.75) < 1e-9 && Math.abs(dim.height - 0.42) < 1e-9,
    `axolotl dims [0.75,0.42] — got ${dim && [dim.width, dim.height]}`);
  const food = Ent.breedFood('axolotl');
  ok(food && food.k === 'tag' && food.t.some((t) => t.indexOf('axolotl_tempt_items') >= 0),
    `axolotl breeds off #axolotl_tempt_items — got ${JSON.stringify(food)}`);
}

// ── 2. variants ──────────────────────────────────────────────────────────────────────────────
say('2. Ax.skinKey / Ax.randomNaturalVariant');
{
  ok(Ax.SKIN.length === 5, `Ax.SKIN must carry all five sheets — got ${Ax.SKIN.length}`);
  ok(Ax.skinKey({ type: 'axolotl', axolotlVariant: 0 }) === 'axolotl', 'variant 0 (lucy) must map to the base "axolotl" sheet');
  ok(Ax.skinKey({ type: 'axolotl', axolotlVariant: 4 }) === 'axolotl#4', 'variant 4 (blue) must map to "axolotl#4"');
  ok(Ax.skinKey({ type: 'cow' }) === null, 'a non-axolotl must get no skin key');

  okAv((() => {
    for (let i = 0; i < 200; i++) {
      const v = Ax.randomNaturalVariant(() => i / 200);
      if (v === Ax.Variant.BLUE) return false;   // blue is UNnatural — must never come out of this roll
    }
    return true;
  })(), 'Ax.randomNaturalVariant must never roll blue (the unnatural variant)');
}

// ── 3. EL.spawn(axolotl) ────────────────────────────────────────────────────────────────────
say('3. EL.spawn(axolotl) — EL.DEFAULTS.axolotl + Ai.ROSTER.axolotl');
{
  ok(EL.canSpawn('axolotl'), 'EL.canSpawn(axolotl) is false — the closed motion set refuses it');
  const m = EL.motionFor('axolotl');
  ok(m && Math.abs(m[0] - 0.08) < 1e-9 && Math.abs(m[1] - 0.98) < 1e-9, `motionFor(axolotl) = ${m}, expected [0.08,0.98]`);
  const e0 = EL.spawn('axolotl', 0, 64, 0, {});
  ok(e0.axolotlVariant !== undefined, 'EL.DEFAULTS.axolotl did not roll e.axolotlVariant');
  ok(!!e0.ai, 'EL.spawn did not attach e.ai for a rostered axolotl');
  ok(e0.maxHealth === 14, `maxHealth ${e0.maxHealth}, expected 14 off the attribute table`);

  const forced = EL.spawn('axolotl', 0, 64, 0, { variant: Ax.Variant.BLUE });
  ok(forced.axolotlVariant === Ax.Variant.BLUE, 'opts.variant (egg/command) did not stick, blue included');

  okAv((() => {
    const seen = new Set();
    for (let i = 0; i < 200; i++) seen.add(EL.spawn('axolotl', 0, 64, 0, {}).axolotlVariant);
    return seen.size > 1;
  })(), 'across 200 natural spawns, e.axolotlVariant never varied — the variant roll is not live');
}

// ── 4. Spawn.RULES.axolotl ──────────────────────────────────────────────────────────────────
say('4. Spawn.RULES.axolotl — axolotls_spawnable_on, deliberately no light check');
{
  ok(typeof Spawn.RULES.axolotl === 'function' && Spawn.canPlace('axolotl'), 'Spawn.RULES.axolotl is not wired');
  // `#axolotls_spawnable_on` is exactly {clay} in the real jar (confirmed against the live
  // tag table, not assumed) — dirt is not a member.
  const clay = S.stateOf('clay') | 0, dirt = S.stateOf('dirt') | 0;
  W.setBlock(0, 63, 0, clay);
  W.setBlock(0, 63, 1, dirt);
  const saveBright = W.rawBrightness;
  W.rawBrightness = () => 0;   // pitch dark, as lush caves actually is
  ok(Spawn.RULES.axolotl(0, 64, 0) === true, 'clay below, ZERO light, must still pass — axolotl has no light gate at all');
  ok(Spawn.RULES.axolotl(0, 64, 1) === false, 'plain dirt below (not in axolotls_spawnable_on) must refuse');
  okAv((() => { W.rawBrightness = () => 15; return Spawn.RULES.axolotl(0, 64, 0) === true; })(),
    'full brightness must ALSO pass — proving light truly plays no part in this rule');
  W.rawBrightness = saveBright;
}

// ── 5. Ax.createChild / Breed.CHILD.axolotl ─────────────────────────────────────────────────
say('5. Ax.createChild — 1/1200 blue mutation, else a parent’s own variant');
{
  const a = { axolotlVariant: Ax.Variant.LUCY }, b = { axolotlVariant: Ax.Variant.GOLD };
  const c1 = {};
  Ax.createChild(c1, a, b, () => 0.5);   // >= 1/1200: no mutation; coin flip 0.5 -> b's variant
  ok(c1.axolotlVariant === Ax.Variant.GOLD, `no-mutation coin flip should pick b’s variant (gold) — got ${Ax.variantName(c1.axolotlVariant)}`);

  okAv((() => {
    const c2 = {};
    Ax.createChild(c2, a, b, () => 0);   // < 1/1200 every call: forced blue mutation
    return c2.axolotlVariant === Ax.Variant.BLUE;
  })(), 'forcing the 1/1200 roll must mutate the child to blue');

  const pa = EL.spawn('axolotl', 0, 64, 0, { variant: Ax.Variant.CYAN });
  const pb = EL.spawn('axolotl', 1, 64, 0, { variant: Ax.Variant.CYAN });
  Breed.setInLove(pa, null); Breed.setInLove(pb, null);
  const kid = Breed.breed(pa, pb, { random: () => 0.9 });
  ok(!!kid && kid.type === 'axolotl', 'Br.breed(axolotl, axolotl) must produce an axolotl child');
  ok(kid && kid.axolotlVariant === Ax.Variant.CYAN, 'the live-spawned child of two cyan parents must inherit cyan (no mutation at 0.9)');
  ok(kid && kid.persistent === true, 'bred axolotl child must be persistent (createChild setPersistent)');
}

// ── 6. play dead ─────────────────────────────────────────────────────────────────────────────
say('6. Ax.onDamaged / Ax.tickPlayDead / Cb.canAttack’s gate');
{
  const dry = { type: 'axolotl', health: 10, maxHealth: 14, inWater: false, playingDead: false };
  ok(Ax.onDamaged(dry, 5, () => 0) === false, 'an axolotl NOT touching water must never trigger play-dead');

  const wet = { type: 'axolotl', health: 10, maxHealth: 14, inWater: true, playingDead: false };
  ok(Ax.onDamaged(wet, 5, () => 0.999) === false, 'random.nextInt(3)!==0 (the 1-in-3 outer gate) must refuse');

  const wetLowHp = { type: 'axolotl', health: 3, maxHealth: 14, inWater: true, playingDead: false };
  // rand sequence: first call is the outer 1/3 gate (0 -> passes), second is the inner
  // nextInt(3)<amount check (irrelevant here since health/maxHealth=3/14<0.5 already satisfies it)
  ok(Ax.onDamaged(wetLowHp, 1, () => 0) === true, 'low health/maxHealth ratio (<0.5) must trigger play-dead even with tiny damage');
  ok(wetLowHp.playingDead === true, 'onDamaged must set e.playingDead');
  ok(wetLowHp.playDeadTicks === Ax.PLAY_DEAD_TICKS, `playDeadTicks must start at ${Ax.PLAY_DEAD_TICKS}`);

  const already = { type: 'axolotl', health: 10, maxHealth: 14, inWater: true, playingDead: true };
  ok(Ax.onDamaged(already, 5, () => 0) === false, 'already playing dead must refuse a second trigger');

  // #2976 canTakeDamage only gates mob TARGETING (LivingEntity.canTarget/TargetPredicate), never damage.
  ok(Cb.canAttack({ type: 'axolotl', removed: false, maxHealth: 14, health: 10, playingDead: true }) === true,
    'Cb.canAttack must still allow a playing-dead axolotl (vanilla damage ignores canTakeDamage)');
  ok(Ai.canTargetLiving({ type: 'axolotl', playingDead: true }, { type: 'drowned' }) === false,
    'mob target predicate must refuse a playing-dead axolotl');
  ok(Ai.canTargetLiving({ type: 'axolotl', playingDead: false }, { type: 'drowned' }) === true,
    'mob target predicate must allow a normal axolotl');
  ok(Cb.canAttack({ type: 'axolotl', removed: false, maxHealth: 14, health: 10, playingDead: false }) === true,
    'Cb.canAttack must allow a normal axolotl');

  const pd = { playingDead: true, inWater: true, playDeadTicks: 2 };
  Ax.tickPlayDead(pd);
  ok(pd.playingDead === true && pd.playDeadTicks === 1, 'tickPlayDead must decrement while > 0');
  Ax.tickPlayDead(pd);
  ok(pd.playingDead === false, 'tickPlayDead must clear playingDead once the counter reaches 0');

  const offWater = { playingDead: true, inWater: false, playDeadTicks: 5 };
  Ax.tickPlayDead(offWater);
  ok(offWater.playingDead === true && offWater.playDeadTicks === 4, 'out of water, playingDead lasts until the memory runs out');

  // through the REAL Cb.hurt pipeline, not the bare function
  const live = EL.spawn('axolotl', 0, 64, 0, { variant: 0 });
  live.health = 2; live.maxHealth = 14; live.inWater = true; live.invulnerableTime = 0;
  const savedRandom = EL.random;
  EL.random = () => 0;   // forces every roll through onDamaged's own gate
  Cb.hurt(live, 1, undefined, false, { source: 'magic' });
  ok(live.playingDead !== true, 'sourceless damage (magic) must never trigger play-dead (#3041)');
  live.invulnerableTime = 0; live.health = 2;
  Cb.hurt(live, 1, undefined, false, { source: 'mob', attacker: { x: 1, y: 64, z: 0 } });
  EL.random = savedRandom;
  ok(live.playingDead === true, 'a real Cb.hurt() call on a low-health, wet axolotl must set playingDead (wired hook)');
  okAv(ES.getStatusEffect(live, 'regeneration') && ES.getStatusEffect(live, 'regeneration').duration === 200,
    'PlayDeadTask.run must give Regeneration 200 ticks');
}

// ── 7. Ax.buffPlayer ─────────────────────────────────────────────────────────────────────────
say('7. Ax.buffPlayer — Regeneration add (capped 2400) + Mining Fatigue clear');
{
  const P = { effects: {} };
  ES.addStatusEffect(P, 'mining_fatigue', 100, 0, false, true);
  ok(ES.hasStatusEffect(P, 'mining_fatigue'), 'setup: player must start fatigued');
  Ax.buffPlayer(P);
  ok(ES.hasStatusEffect(P, 'regeneration'), 'buffPlayer must add Regeneration');
  ok(!ES.hasStatusEffect(P, 'mining_fatigue'), 'buffPlayer must clear Mining Fatigue');
  const inst = ES.getStatusEffect(P, 'regeneration');
  ok(inst.duration === 100, `first buff should add flat 100 — got ${inst.duration}`);
  Ax.buffPlayer(P);
  const inst2 = ES.getStatusEffect(P, 'regeneration');
  ok(inst2.duration === 200, `second buff should stack to 200 (100+100) — got ${inst2.duration}`);

  okAv((() => {
    const P2 = { effects: {} };
    ES.addStatusEffect(P2, 'regeneration', 2399, 0, false, true);
    Ax.buffPlayer(P2);
    return ES.getStatusEffect(P2, 'regeneration').duration === Ax.REGEN_MAX_DURATION;
  })(), 'buffPlayer must cap the duration at 2400, not overshoot to 2499');
}

// ── 8. Ax.WanderGoal ─────────────────────────────────────────────────────────────────────────
say('8. Ax.WanderGoal — cooldown-gated random point, refuses while playing dead');
{
  const e = { x: 0, y: 64, z: 0, inWater: false, playingDead: false };
  const g = new Ax.WanderGoal(e, { random: () => 0.9 });
  ok(g.canUse() === true, 'WanderGoal must accept on its first poll (cooldown starts at 0)');
  ok(g.canUse() === false, 'WanderGoal must refuse immediately after starting (cooldown just reset)');

  const dead = { x: 0, y: 64, z: 0, inWater: false, playingDead: true };
  const g2 = new Ax.WanderGoal(dead, { random: () => 0.9 });
  ok(g2.canUse() === false, 'a playing-dead axolotl must never start WanderGoal');
}

// ── 8b. feeding a tropical_fish_bucket hands back a water_bucket (AxolotlEntity.eat)
{
  const ax = EL.spawn('axolotl', 1, 64, 0, { variant: Ax.Variant.GOLD });
  const inv = Iv.create();
  const st = { i: MCL.Items.of('tropical_fish_bucket'), n: 1 };
  Iv.setItem(inv, 0, st);
  const P = { x: 0, y: 64, z: 0, inventory: inv, slot: 0, instabuild: false };
  Use.entityUse(P, ax, st);
  const h = Iv.getItem(inv, 0);
  okAv(h && MCL.Items.nameOf(h.i) === 'water_bucket', `feeding tropical_fish_bucket must leave a water_bucket in hand — got ${h && MCL.Items.nameOf(h.i)}`);
}

// ── 9. bucketing ─────────────────────────────────────────────────────────────────────────────
say('9. bucketing — capture (Use.entityUse) + release (axolotl_bucket block-use)');
{
  ok(MCL.Items.of('bucket') >= 0 && MCL.Items.of('axolotl_bucket') >= 0,
    'items.bin has no bucket/axolotl_bucket — cannot test bucketing at all');
  const axolotl = EL.spawn('axolotl', 1, 64, 0, { variant: Ax.Variant.GOLD });
  axolotl.huntingCooldown = 1234;
  const inv = Iv.create();
  // Bucketable.tryBucket takes a WATER bucket (interactrefcheck: the real server leaves an EMPTY bucket and the axolotl alone)
  const empty = { i: MCL.Items.of('bucket'), n: 1 };
  Iv.setItem(inv, 0, empty);
  const P = { x: 0, y: 64, z: 0, inventory: inv, slot: 0, instabuild: false };
  Use.entityUse(P, axolotl, empty);
  ok(!axolotl.removed && MCL.Items.nameOf(Iv.getItem(inv, 0).i) === 'bucket', 'an EMPTY bucket must not capture an axolotl (both directions, rule 6)');
  const stack = { i: MCL.Items.of('water_bucket'), n: 1 };
  Iv.setItem(inv, 0, stack);
  const handled = Use.entityUse(P, axolotl, stack);
  ok(handled === true, 'a water bucket on an axolotl must be handled (captured)');
  const slot0 = Iv.getItem(inv, 0);
  ok(slot0 && MCL.Items.nameOf(slot0.i) === 'axolotl_bucket', `slot 0 should now hold axolotl_bucket — got ${slot0 && MCL.Items.nameOf(slot0.i)}`);
  ok(slot0.axolotlVariant === Ax.Variant.GOLD, `the captured stack must remember the variant (gold) — got ${slot0 && Ax.variantName(slot0.axolotlVariant)}`);
  ok(axolotl.removed === true, 'the live axolotl entity must be removed from the world once bucketed');

  // release: `Use.bucketUse` (BucketItem.use, its OWN raycast) aimed straight down at the top of
  // a grass block — EntityBucketItem pours water into the cell above and spawns the axolotl there.
  const groundState = S.stateOf('grass_block') | 0;
  W.setBlock(2, 63, 0, groundState);
  W.setBlock(2, 64, 0, 0); W.setBlock(2, 65, 0, 0);
  Object.assign(P, { ex: 2.5, ey: 64.5, ez: 0.5, eyeHeight: 0.5, lookVec: () => [0, -1, 0] });
  const before = EL.count();
  const released = Use.bucketUse(P, slot0);
  ok(released === true, 'placing axolotl_bucket against a block face must be handled');
  ok(EL.count() === before + 1, 'releasing the bucket must spawn a fresh live axolotl');
  const revived = EL.list[EL.list.length - 1];
  ok(revived.type === 'axolotl' && revived.axolotlVariant === Ax.Variant.GOLD,
    `the released axolotl must keep its captured variant (gold) — got ${revived.type}/${Ax.variantName(revived.axolotlVariant)}`);
  ok(revived.huntingCooldown === 1234, `HuntingCooldown must survive bucket round trip (#1363) — got ${revived.huntingCooldown}`);
  ok(revived.fromBucket === true, 'a bucket-released axolotl must have fromBucket===true');
  ok(MCL.Spawn.canImmediatelyDespawn(revived, 1e6) === false, 'a bucket-released axolotl must not canImmediatelyDespawn');
  okAv(MCL.Spawn.canImmediatelyDespawn(Object.assign({}, revived, { fromBucket: false }), 1e6) === true, 'break: without fromBucket it despawns');
  const invAfter = Iv.getItem(inv, 0);
  okAv(invAfter && MCL.Items.nameOf(invAfter.i) === 'bucket',
    'releasing must empty the bucket back to plain "bucket"');
}

// ── #4072: a BABY axolotl keeps Age + HuntingCooldown through capture/release ──
{
  const b = EL.spawn('axolotl', 1, 64, 0, { variant: Ax.Variant.BLUE });
  b.growAge = -12000; b.huntingCooldown = 1000;
  const inv = Iv.create(), st = { i: MCL.Items.of('water_bucket'), n: 1 };
  Iv.setItem(inv, 0, st);
  const P = { x: 0, y: 64, z: 0, inventory: inv, slot: 0, instabuild: false };
  Use.entityUse(P, b, st);
  const bk = Iv.getItem(inv, 0);
  W.setBlock(2, 63, 0, S.stateOf('grass_block') | 0); W.setBlock(2, 64, 0, 0); W.setBlock(2, 65, 0, 0);
  Object.assign(P, { ex: 2.5, ey: 64.5, ez: 0.5, eyeHeight: 0.5, lookVec: () => [0, -1, 0] });
  Use.bucketUse(P, bk);
  const r = EL.list[EL.list.length - 1];
  ok(r.growAge === -12000, `baby Age must survive the bucket — got ${r.growAge}`);
  ok(r.huntingCooldown === 1000, `HuntingCooldown must survive the bucket — got ${r.huntingCooldown}`);
  okAv(!(EL.spawn('axolotl', 3, 64, 0, { variant: 0 }).growAge < 0), 'break: a plain spawn is an adult');
}

// ── #1035: AxolotlData pack (two shared variants, babies from the 3rd) + raw-amount play-dead ──
{
  const pack = () => { const pd = {}; return [0, 1, 2, 3].map(i => EL.spawn('axolotl', i, 64, 0, { spawnIdx: i, packData: pd })); };
  let good = true;
  for (let t = 0; t < 50; t++) {
    const p = pack(), vs = new Set(p.map(a => a.axolotlVariant));
    const babies = p.filter(a => a.growAge < 0 || a.baby).length;
    if (vs.size > 2 || babies < 2 || p[0].growAge < 0 || p[1].growAge < 0) good = false;
  }
  ok(good, 'a pack of 4 shares <=2 variants and the members after the first two are babies');
  okAv((() => { const p = EL.spawn('axolotl', 0, 64, 0, { spawnIdx: 3, packData: {}, variant: 0 }); return !(p.growAge < 0); })(),
    'a forced-variant (bucket/egg) spawn is never a baby');
  okAv((() => { const p = [0, 1, 2, 3].map(i => EL.spawn('axolotl', i, 64, 0, { spawnIdx: i })); return p.every(a => !(a.growAge < 0)); })(),
    'break: with the pack data removed no member is a baby (the pack check would fail)');
  okAv((() => { const a = EL.spawn('axolotl', 0, 64, 0, {}); a.inWater = true; a.health = 14; let n = 0;
    for (let i = 0; i < 300; i++) { a.playingDead = false; if (Ax.onDamaged(a, 100, () => 0)) n++; } return n === 0; })(),
    'break: a raw amount >= health never triggers play-dead');
}

// ── D-649: tickAir / hydrateFromPotion / getMaxAir (.decomp AxolotlEntity.java:180-209) ──
{
  const Sky = MCL.Sky;
  const mk = () => { const a = EL.spawn('axolotl', 0.5, 64, 0.5); a.inWater = false; a.health = 14; a.air = undefined; return a; };
  if (Sky && !Sky.weather) Sky.weather = { raining: false };
  const rain0 = Sky && Sky.weather ? Sky.weather.raining : false;
  if (Sky && Sky.weather) Sky.weather.raining = false;
  { const a = mk(); Ax.tickAir(a);
    ok(a.air === 5999, `dry: the air starts at getMaxAir 6000 and drops one a tick (got ${a.air})`); }
  { const a = mk(); a.air = -19; Ax.tickAir(a);
    ok(a.air === 0 && a.health === 12, `at -20 the air resets to 0 and DRYOUT deals 2.0 (air ${a.air}, hp ${a.health})`); }
  { const a = mk(); a.air = 10; a.inWater = true; Ax.tickAir(a);
    ok(a.air === 6000 && a.health === 14, 'wet: the air snaps back to 6000, no damage'); }
  { const a = mk(); a.air = 100; Ax.hydrateFromPotion(a);
    ok(a.air === 1900, 'hydrateFromPotion adds 1800'); a.air = 5000; Ax.hydrateFromPotion(a);
    ok(a.air === 6000, 'hydrateFromPotion is capped at getMaxAir 6000'); }
  if (MCL.Potion && MCL.Potion.applyWater) {
    const a = mk(); a.air = 10; MCL.Potion.applyWater(a.x + 4, a.y + 1, a.z, [a], null);
    ok(a.air === 1810, `a water splash 4 blocks off (inside the 4,2,4 box) hydrates the axolotl (air ${a.air})`);
    const b = mk(); b.air = 10; MCL.Potion.applyWater(b.x + 6, b.y, b.z, [b], null);
    ok(b.air === 10, 'a water splash 6 blocks off (outside the box) does not');
  } else ok(false, 'the potion module is loaded for the water splash');
  { let tripped = 0; const a = mk(); a.air = 1;
    for (let i = 0; i < 25; i++) { const h = a.health; Ax.tickAir(a); if (a.health < h) tripped++; }
    ok(tripped === 1 && a.air === -4, `21 dry ticks from air 1 trip DRYOUT exactly once (tripped ${tripped}, air ${a.air})`); }
  const savedWet = Ax.isWet; Ax.isWet = () => true;
  { const a = mk(); Ax.tickAir(a); okAv(a.air === 6000, 'break: an axolotl that is always wet never dries (the dry-tick check would fire)'); }
  Ax.isWet = savedWet;
  if (Sky && Sky.weather) Sky.weather.raining = rain0;
}

// ── 11. FIGHT activity (AxolotlAttackablesSensor + addFightActivities, #1034) ──────────────
say('11. FIGHT — sensor target list, approach, melee 2 dmg, hunting cooldown, appreciatePlayer');
{
  const mkPrey = (type, x) => {
    let p = null;
    try { p = EL.spawn(type, x, 64, 0); } catch (err) { p = null; }
    if (!p) { p = { type, x, y: 64, z: 0, health: 10, maxHealth: 10, width: 0.5, height: 0.5 }; }
    p.inWater = true; p.x = x; p.y = 64; p.z = 0; p.health = p.maxHealth = 10;   // Combat.hurt clamps to maxHealth (#4626): a real cod has 3
    return p;
  };
  const fight = (prey, ticks, tweak) => {
    const ax = EL.spawn('axolotl', 0, 64, 0); ax.inWater = true; ax.playingDead = false; ax.huntingCooldown = 0;
    if (tweak) tweak(ax);
    const g = new Ax.FightGoal(ax, { entities: () => prey.concat([ax]) });
    let used = g.canUse();
    if (used) g.start();
    for (let i = 0; i < ticks && used; i++) { g.tick(); used = g.canContinueToUse(); if (!used) g.stop(); }
    return { ax, g, used };
  };
  { const d = mkPrey('drowned', 3);
    const r = fight([d], 1);
    ok(r.ax.target === d, 'an axolotl targets a drowned in water within 8 blocks (axolotl_always_hostiles)'); }
  { const d = mkPrey('drowned', 3);
    const ax = EL.spawn('axolotl', 0, 64, 0); ax.inWater = true; ax.huntingCooldown = 2000;
    okAv(Ax.canTarget(ax, d), 'break: a hunting cooldown must not stop it attacking an always-hostile drowned'); }
  { const c = mkPrey('cod', 3);
    const ax = EL.spawn('axolotl', 0, 64, 0); ax.inWater = true; ax.huntingCooldown = 0;
    ok(Ax.canTarget(ax, c), 'an axolotl hunts a cod in water (axolotl_hunt_targets)');
    ax.huntingCooldown = 5; ok(!Ax.canTarget(ax, c), 'HUNTING_COOLDOWN blocks hunting fish');
    ax.huntingCooldown = 0; c.inWater = false; ok(!Ax.canTarget(ax, c), 'prey out of water is not a target');
    c.inWater = true; c.x = 9; ok(!Ax.canTarget(ax, c), 'prey beyond 8 blocks (64 sq) is not a target');
    const cow = mkPrey('cow', 2); ok(!Ax.canTarget(ax, cow), 'a cow is in neither tag'); }
  { const c = mkPrey('cod', 4);
    const r = fight([c], 3);
    ok(r.ax.navigating === true && r.ax.navNode && Math.floor(c.x) === r.ax.navNode.x, 'out of reach, the axolotl paths toward its prey');
    okAv(r.ax.navNode !== undefined, 'break: approach must set a navigation node');
    const c2 = mkPrey('cod', 0.8);
    const before = c2.health;
    fight([c2], 3);
    ok(before - c2.health === 2, `in reach it bites for int attack damage 2 (hp ${before} -> ${c2.health})`);
    const c3 = mkPrey('cod', 0.8); const r3 = fight([c3], 10);
    ok(c3.health === 10 - 2 * 1, `MeleeAttackTask(20): only one bite in 10 ticks (hp ${c3.health})`); }
  { const c = mkPrey('cod', 1);
    const r = fight([c], 1);
    c.health = 0; c.dead = true;
    r.g.canContinueToUse(); r.g.stop();
    ok(r.ax.huntingCooldown === 2400, `leaving FIGHT remembers HUNTING_COOLDOWN 2400 (got ${r.ax.huntingCooldown})`);
    Ax.tickPlayDead(r.ax); ok(r.ax.huntingCooldown === 2399, 'the hunting cooldown ticks down'); }
  { const P = MCL.Player || (MCL.Player = { x: 0, y: 64, z: 0 });
    const c = mkPrey('cod', 1); c.dead = true; c.lastAttacker = P;
    const ax = EL.spawn('axolotl', 0, 64, 0);
    let called = 0; const old = Ax.buffPlayer; Ax.buffPlayer = () => { called++; return true; };
    P.x = 10; P.y = 64; P.z = 0; Ax.appreciatePlayer(ax, c);
    P.x = 30; Ax.appreciatePlayer(ax, c);
    Ax.buffPlayer = old;
    ok(called === 1, `appreciatePlayer buffs a killer within 20 blocks only (called ${called})`); }
  { const ax = EL.spawn('axolotl', 0, 64, 0);
    ok(!!ax.ai, 'the roster entry builds');
    okAv(typeof Ax.FightGoal === 'function' && Ax.OWED.every((o) => o.indexOf('FIGHT activity (Range') < 0), 'the FIGHT activity is no longer named OWED'); }
}

// ── #1033: AxolotlBrain.getTemptedSpeed / getAdultFollowingSpeed — 0.5/0.6 in water, 0.15 on land ──
{
  const real = Ai.stepToward, realPath = Ai.findPath;
  let got = null;
  Ai.stepToward = (e, n, sp) => { got = sp; };
  Ai.findPath = () => [{ x: 0, y: 64, z: 0 }, { x: 1, y: 64, z: 1 }];
  const speedOf = (inWater, mk) => {
    const a = EL.spawn('axolotl', 0.5, 64, 0.5); a.inWater = inWater; got = null;
    const pl = { x: 6.5, y: 64, z: 0.5, heldItem: { id: 'tropical_fish_bucket' } };
    const g = mk(a, pl); g.canUse(); g.tick(); return got;
  };
  const tempt = (sp) => (a, pl) => new Ai.TemptGoal(a, sp, () => [pl], () => true);
  const rosterSp = (a) => a.inWater ? 0.5 : 0.15;
  ok(speedOf(false, tempt(rosterSp)) === 0.15, `beached tempted axolotl steps at 0.15 (got ${speedOf(false, tempt(rosterSp))})`);
  ok(speedOf(true, tempt(rosterSp)) === 0.5, 'tempted axolotl in water steps at 0.5');
  const src = readFileSync(join(MCLITE_ROOT, 'src/07k_goals.js'), 'utf8');
  ok(/getAdultFollowingSpeed[\s\S]{0,200}m\.inWater \? 0\.6 : 0\.15/.test(src), 'roster follow-parent speed is 0.6 water / 0.15 land');
  okAv(speedOf(false, tempt(0.5)) !== 0.15, 'break: a constant-0.5 tempt speed on land would not be 0.15');
  Ai.stepToward = real; Ai.findPath = realPath;
}

// ── 10. #1032 PLAY_DEAD replaces IDLE ─────────────────────────────────────────────────────────
say('10. playing dead suspends every IDLE goal (breed/tempt/follow-parent/look/wander)');
{
  const e = EL.spawn('axolotl', 0, 64, 0, {});
  const gs = e.ai && e.ai.entries ? e.ai : (e.ai && e.ai.goals) || null;
  ok(!!gs && gs.entries.length >= 5, 'the axolotl roster has its IDLE goals');
  if (gs) {
    e.playingDead = true;
    const live = gs.entries.filter(en => en.goal.canUse() === true);
    ok(live.length === 0, `no goal may canUse() while playing dead (${live.length} did)`);
    const cont = gs.entries.filter(en => en.goal.canContinueToUse && en.goal.canContinueToUse() === true);
    ok(cont.length === 0, 'no goal may canContinueToUse() while playing dead');
    // anti-vacuity: the same probe must see a goal accept once the gate is open
    e.playingDead = false;
    const tempt = gs.entries.map(en => en.goal).filter(g => g.canContinueToUse || g.canUse);
    okAv(tempt.length >= 5, 'break: the probe enumerates the goals that the gate must close');
    const g = new MCL.Ai.RandomLookAroundGoal({ playingDead: false }, () => 0);
    okAv(g.canUse() === true, 'break: an ungated RandomLookAroundGoal accepts at random()=0, so a gated false is the gate');
  }
}

// ── #3721: an axolotl with a BREED_TARGET neither acquires nor keeps an attack target (BREED_TARGET) ──
{
  const mk = () => { const a = EL.spawn('axolotl', 0, 64, 0); const c = EL.spawn('cod', 2, 64, 0); a.inWater = true; c.inWater = true;
    const g = new Ax.FightGoal(a, { entities: () => [c] }); return { a, c, g }; };
  { const { a, g } = mk(); a.breedTarget = {}; ok(g.canUse() === false && !a.target, 'in-love axolotl does not acquire a hunt target'); }
  { const { a, c, g } = mk(); a.target = c; ok(g.canContinueToUse() === true, 'control: a hunting axolotl continues'); a.breedTarget = {};
    ok(g.canContinueToUse() === false, 'in-love axolotl drops its hunt target'); }
  { const { a, g } = mk(); okAv(g.canUse() === true, 'break: without love the same axolotl does acquire the cod'); }
}

console.log('================ axolotlcheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(` ${breaks} breaks caught`);
console.log('==============================================');
process.exit(fails.length ? 1 : 0);
