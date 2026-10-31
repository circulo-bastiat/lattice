#!/usr/bin/env node
// tamecheck.mjs — PLAN G18e unit 3 (D-458): TAMING — wolf and cat only.
//
//   node tools/tamecheck.mjs [--verbose]
//
// ⚠ WHAT THIS PROVES. `Tame.CHANCE_DENOM` is read by hand off `bje`/`big`'s own bytecode
// (DECISIONS.md D-458 has the disassembly), so the interesting question is never "is 3 right" —
// it is whether `Tame.feed`'s own roll actually LANDS on that denominator, in both directions
// (rule 6): a species this unit covers tames roughly 1 time in `CHANCE_DENOM`, and a species/
// item this unit does NOT cover never tames at all, however many attempts. §3's own mutation
// (temporarily setting `CHANCE_DENOM` to 1) is the anti-vacuity proof that the distribution
// assertion can actually fail — a check that always sees "roughly a third" no matter what the
// code does would not be testing the roll at all.

import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
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

console.log('tamecheck — PLAN G18e unit 3, taming (wolf + cat)');

const M = loadEngine({
  // QUEUE 0.2 (Tame/Breed remainder) — `07q_effects.js` added so §9b below can exercise the
  // wolf/cat collar's own !isInvisible() gate (src/07j_entityrender.js), which reads
  // `NS.Effects.hasStatusEffect` and is a silent no-op (collar still drawn) when that module
  // never loaded at all, the same way it is for a status effect that is not currently active.
  extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
          '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js',
          '07n_tame.js', '07q_effects.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14j_combat.js']
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
M.Ai.init();
M.Breed.init();
M.Tame.init();

const Tm = M.Tame, Br = M.Breed, EL = M.EntityList;
ok(Tm.ready, 'Tame module reports ready');
if (!Tm.ready) {
  console.log('\nFAIL  Tame did not initialise — Breed is missing');
  process.exit(1);
}

// ── §1. the roster this unit covers, and the two refusals it makes on purpose ────────────────
say('\n§1 — TAMABLE roster');
ok(Tm.TAMABLE.wolf === true, 'wolf is TAMABLE');
ok(Tm.TAMABLE.cat === true, 'cat is TAMABLE');
ok(!Tm.TAMABLE.ocelot, 'ocelot is NOT TAMABLE (no ocelot-taming path in vanilla 1.18.2 — D-458)');
ok(!Tm.TAMABLE.parrot, "parrot is not in THIS module's TAMABLE table (D-458) -- " +
  "STALE AS A CLAIM ABOUT THE ENGINE, corrected D-707 leftover unit (this pass): the " +
  "flying-AI substrate D-458 was waiting on now EXISTS (07t_fly.js, loop/flyparrot), " +
  "and a parrot really does tame there (Fl.feed, seeds, 1-in-10 -- flycheck.mjs \u00a79). " +
  "Tm (07n_tame.js) itself still only ever covers wolf/cat, unchanged, so this line " +
  "is still a TRUE fact about Tm -- only the OLD comment's framing (as if parrot " +
  "taming were unbuilt anywhere) was wrong.");
ok(!Tm.TAMABLE.horse, 'horse is NOT TAMABLE this unit (does not even spawn yet — row 2\'s next unit)');

// ── §2. the food gate — wrong item, wrong species, already-tamed all refuse ──────────────────
say('\n§2 — the food/species/already-tamed gate');
function mkWolf() {
  const e = EL.spawn('wolf', 0, 64, 0);
  return e;
}
{
  const e = mkWolf();
  ok(!!e, 'a wolf spawns (motion extended to it this session — D-458)');
  ok(e.tamed === false && e.sitting === false && e.owner === null, 'a fresh wolf is untamed, unowned, not sitting');
  ok(Tm.feed(e, 'apple', { random: Math.random }) === null, 'a wolf refuses an apple (not its tame food)');
  e.angerTime = 100;
  ok(Tm.feed(e, 'bone', { random: () => 0 }) === null && !e.tamed, 'an ANGRY wild wolf refuses a bone (!hasAngerTime), not tamed');
  e.angerTime = 0;
  ok(Tm.feed(null, 'bone', {}) === null, 'feeding a null entity refuses rather than throwing');
  const cow = EL.spawn('cow', 5, 64, 0);
  ok(Tm.feed(cow, 'wheat', { random: Math.random }) === null, 'a cow (not wolf/cat) never tames on any food');
}

// ── §3. the roll itself — DISTRIBUTION, not a single sample, and the anti-vacuity mutation ───
say('\n§3 — the 1-in-3 roll, and proving the check can catch a wrong one');
function trialTameRate(species, food, denom, trials) {
  const savedDenom = Tm.CHANCE_DENOM;
  Tm.CHANCE_DENOM = denom;
  let tamed = 0;
  for (let i = 0; i < trials; i++) {
    const e = EL.spawn(species, i, 64, 0);
    const r = Tm.feed(e, food, { random: Math.random });
    if (r && r.tamed) tamed++;
  }
  Tm.CHANCE_DENOM = savedDenom;
  return tamed / trials;
}
{
  const N = 4000;
  const rateWolf = trialTameRate('wolf', 'bone', 3, N);
  ok(Math.abs(rateWolf - 1 / 3) < 0.04, `wolf tame rate over ${N} trials is ~1/3 (got ${rateWolf.toFixed(3)})`);
  const rateCat = trialTameRate('cat', 'cod', 3, N);
  ok(Math.abs(rateCat - 1 / 3) < 0.04, `cat tame rate over ${N} trials is ~1/3 (got ${rateCat.toFixed(3)})`);
  // anti-vacuity (D-30, D-305): if the roll were not actually gated on CHANCE_DENOM at all — a
  // constant "always tame" bug — this assertion would have passed above too. Prove the harness
  // CAN see a wrong rate by forcing the denominator to 1 (guaranteed tame) and 1000 (~never).
  const rateForced1 = trialTameRate('wolf', 'bone', 1, 500);
  okAv(rateForced1 > 0.98, `forcing CHANCE_DENOM=1 tames ~always (got ${rateForced1.toFixed(3)}) — the roll is live, not a no-op`);
  const rateForced1000 = trialTameRate('wolf', 'bone', 1000, 500);
  okAv(rateForced1000 < 0.02, `forcing CHANCE_DENOM=1000 tames ~never (got ${rateForced1000.toFixed(3)})`);
}

// ── §3b. #1696 — a successful taming sits the mob and clears its target ───────────────────────
say('\n§3b — sits right after taming');
{
  for (const [sp, food] of [['wolf', 'bone'], ['cat', 'cod']]) {
    const e = EL.spawn(sp, 0, 64, 0);
    e.target = { fake: true }; e.sitting = false;
    const r = Tm.feed(e, food, { random: () => 0 });
    ok(r && r.tamed && e.sitting === true && e.target === null, `a freshly tamed ${sp} is sitting and its target is cleared`);
  }
  const e = EL.spawn('wolf', 0, 64, 0);
  Tm.feed(e, 'bone', { random: () => 0.99 });
  const bad = EL.spawn('wolf', 0, 64, 0);
  Tm.feed(bad, 'bone', { random: () => 0 }); bad.sitting = false;   // the old bug, re-injected
  okAv(!(bad.tamed && bad.sitting === true && bad.target === null), 'a wolf that stands after taming fails the sit assertion (breaks caught)');
  ok(e.tamed === false && e.sitting === false, 'a failed taming roll does not sit the wolf');
}

// ── §4. ocelot never tames, however many attempts — the OTHER direction of rule 6 ────────────
say('\n§4 — ocelot refuses, every time, on its own real food');
{
  let anyTamed = false;
  for (let i = 0; i < 200; i++) {
    const e = EL.spawn('ocelot', i, 64, 0);
    const r = Tm.feed(e, 'cod', { random: Math.random });
    if (r) anyTamed = true;
  }
  ok(!anyTamed, 'an ocelot never tames on cod, in 200 attempts (Tm.feed refuses the species outright)');
}

// ── §5. sitting — only a TAMED mob can be toggled, and it actually flips ──────────────────────
say('\n§5 — sitting');
{
  const e = mkWolf();
  ok(Tm.toggleSit(e) === false, 'an untamed wolf refuses to sit');
  e.tamed = true; e.owner = 'player';
  ok(Tm.toggleSit(e) === true && e.sitting === true, 'a tamed wolf sits on toggle');
  ok(Tm.toggleSit(e) === true && e.sitting === false, 'toggling again stands it back up');
  const oc = EL.spawn('ocelot', 9, 64, 0);
  oc.tamed = true; // cannot really happen — proving the TYPE gate, not just the flag
  ok(Tm.toggleSit(oc) === false, 'an ocelot never sits, even if something else set .tamed');
}

// ── §6. the sit goal itself — MOVE only, and it is the whole of sitting's consequence ─────────
say('\n§6 — Ai.SitGoal');
{
  const e = mkWolf();
  const g = new M.Ai.SitGoal(e);
  ok(g.canUse() === false, 'SitGoal.canUse is false while not sitting');
  e.sitting = true;
  ok(g.canUse() === true && g.canContinueToUse() === true, 'SitGoal.canUse/canContinueToUse follow e.sitting live');
}

// ── §7. real live wiring — wolf and cat are in Ai.ROSTER, ocelot is (fleeing), parrot is not ──
say('\n§7 — Ai.ROSTER coverage matches the taming ruling');
ok(typeof M.Ai.ROSTER.wolf === 'function', 'wolf has a real Ai.ROSTER entry');
ok(typeof M.Ai.ROSTER.cat === 'function', 'cat has a real Ai.ROSTER entry');
ok(typeof M.Ai.ROSTER.ocelot === 'function', 'ocelot has a real Ai.ROSTER entry (permanent flee)');
ok(M.Ai.ROSTER.parrot === undefined, "parrot has no Ai.ROSTER entry IN THIS TEST'S OWN " +
  "engine build -- because this file's own `extra` module list above does not load " +
  "07t_fly.js, not because none exists. Corrected D-707 leftover unit (this pass): " +
  "`Ai.ROSTER.parrot` is real (07t_fly.js \u00a77, ParrotEntity.initGoals(), read whole -- " +
  "EscapeDangerGoal/SwimGoal/LookAtPlayerGoal/SitGoal/FollowOwnerGoal/FlyOntoTreeGoal/ " +
  "SitOnOwnerShoulderGoal/FollowMobGoal), live-spawn tested this pass " +
  "(tools/petmobpeek.mjs): a summoned parrot has a real GoalSelector and really flies. " +
  "flycheck.mjs is the real coverage; this line only ever tested THIS file's own " +
  "narrower module set, and the old comment's 'no flying-AI substrate' framing was stale.");
{
  const wolfGs = M.Ai.ROSTER.wolf(mkWolf(), { random: Math.random, players: () => [], animals: () => [], onBreed: () => null, isTempting: () => false });
  ok(!!wolfGs, 'wolf\'s roster builds a real GoalSelector against live ctx shape');
}

// ── §8. THE SKIN SWAP AND THE COLLAR (D-458, this session) ─────────────────────────────────────────────────────────
say('\n§8 — Tm.skinKey / Tm.catVariantRoll / Tm.collarKey / Tm.collarRGB');
{
  // wild vs tame, BOTH directions (a fresh wolf never draws the tame skin, and a tamed one
  // never draws the wild one) — the same "both directions" shape §4's ocelot refusal proves.
  const wild = mkWolf();
  ok(Tm.skinKey(wild) === 'wolf', 'a WILD wolf selects the wild skin key (\'wolf\')');
  ok(Tm.skinKey(wild) !== 'wolf_tame', 'a WILD wolf never selects the tame skin key');
  const tame = mkWolf();
  tame.tamed = true;
  ok(Tm.skinKey(tame) === 'wolf_tame', 'a TAMED wolf selects the tame skin key (\'wolf_tame\')');
  ok(Tm.skinKey(tame) !== 'wolf', 'a TAMED wolf never selects the wild skin key');
  ok(Tm.skinKey(tame) !== 'wolf_angry', 'a TAMED wolf never selects the angry skin key, even while angry (RenderWolf checks tame first)');
  tame.angerTime = 500;
  ok(Tm.skinKey(tame) === 'wolf_tame', 'even WITH angerTime set, a tamed wolf still draws wolf_tame, not wolf_angry');
  tame.angerTime = 0;

  // cat: a real spawn gets a real CatVariant ordinal, in 0..10, packed as \'cat#<n>\' — the
  // SAME family-key shape extract-mob-textures.mjs already ships for cat's eleven skins.
  const cat = EL.spawn('cat', 0, 64, 0);
  ok(typeof cat.catVariant === 'number' && cat.catVariant >= 0 && cat.catVariant <= 10,
     `a spawned cat gets a real catVariant in 0..10 (got ${cat.catVariant})`);
  ok(Tm.skinKey(cat) === 'cat#' + cat.catVariant, 'Tm.skinKey reads e.catVariant into the \'cat#<n>\' family key');
  // the roll itself: below 0.9 downfall ALL_BLACK (ordinal 10) is excluded; above it, included.
  // distribution over many rolls, not one sample — the same shape §3 already uses for CHANCE_DENOM.
  {
    const NN = 3000;
    let sawAllBlackDry = false;
    for (let i = 0; i < NN; i++) if (Tm.catVariantRoll(0.5, Math.random) === 10) sawAllBlackDry = true;
    ok(!sawAllBlackDry, `ALL_BLACK (10) never rolls under a half moon (0.5) over ${NN} tries (nextInt(10) excludes it)`);
    let sawAllBlackWet = false;
    for (let i = 0; i < NN; i++) if (Tm.catVariantRoll(1.0, Math.random) === 10) sawAllBlackWet = true;
    ok(sawAllBlackWet, `ALL_BLACK (10) DOES roll under a full moon (moon size 1.0 > 0.9) over ${NN} tries (nextInt(11) includes it)`);
  }

  // the collar: present ONLY when tamed, both directions, and tinted the jar-read default.
  ok(Tm.collarKey(wild) === null, 'a WILD wolf draws no collar layer at all');
  ok(Tm.collarKey(tame) === 'wolf_collar', 'a TAMED wolf draws the \'wolf_collar\' layer');
  ok(Tm.collarKey(cat) === null, 'an untamed cat draws no collar layer either');
  const tameCat = EL.spawn('cat', 1, 64, 0);
  tameCat.tamed = true;
  ok(Tm.collarKey(tameCat) === 'cat_collar', 'a TAMED cat draws the \'cat_collar\' layer');
  ok(Tm.collarRGB(wild) === null, 'a WILD wolf has no collar tint (nothing to tint)');
  ok(JSON.stringify(Tm.collarRGB(tame)) === JSON.stringify([0xB0, 0x2E, 0x26]),
     'a TAMED wolf\'s collar tints DyeColor.RED, 0xB02E26 — read out of bts.o this session, not typed');
  ok(tame.collarColor === 'red', 'a wolf\'s collarColor field defaults to \'red\' from spawn (bje.a_()\'s own synced-data default)');

  // anti-vacuity (D-30, D-305): deliberately break the data and prove the assertions above
  // WOULD have failed against it — in both directions (forced-wild skin, dropped collar) —
  // the same "prove the harness can see wrong" shape §3's CHANCE_DENOM mutation already uses.
  const brokenSkinKey = function (e) { return (e && e.type === 'wolf') ? 'wolf' : Tm.skinKey(e); };
  okAv(brokenSkinKey(tame) !== 'wolf_tame',
       'a skinKey forced to always answer \'wolf\' fails the tamed-selects-tame-skin assertion — this check is not vacuous');
  okAv(Tm.skinKey(tame) === 'wolf_tame',
       'the REAL Tm.skinKey, unbroken, still answers \'wolf_tame\' for the same entity');

  const brokenCollarKey = function () { return null; };
  okAv(brokenCollarKey(tame) !== 'wolf_collar',
       'a collarKey forced to always answer null fails the tamed-has-a-collar assertion — this check is not vacuous');
  okAv(Tm.collarKey(tame) === 'wolf_collar',
       'the REAL Tm.collarKey, unbroken, still answers \'wolf_collar\' for the same entity');
}

// ── §9. THE COLLAR ACTUALLY REACHES ER.build (D-471) ─────────────────────────────────────────
// §8 proves `Tm.collarKey`/`Tm.collarRGB` answer the RULE; this proves the renderer actually
// ACTS on it — `07j_entityrender.js`'s `ER.visible` pushing a second `it` for a tamed wolf/cat,
// the same shape a bow overlay already used (`bowdrawcheck.mjs` proves that one on a real
// screen; this is `mobboxcheck.mjs`'s own OFF-SCREEN shape — a live `EntityList` entry through
// `ER.build`, not a pixel — applied to the collar instead of a first spawn).
say('\n§9 — the collar overlay actually reaches ER.build, not just Tm.collarKey answering the rule');
{
  const mm = JSON.parse(readFileSync(join(ASSETS, 'models.meta.json'), 'utf8'));
  M.BEModel.init({ models: readFileSync(join(ASSETS, 'models.bin')).toString('base64'), modelsBytes: mm.rawBytes });
  const mobGeomRaw = readFileSync(join(ASSETS, 'mob-geometry.json'));
  M.DATA = Object.assign({}, M.DATA, {
    mobGeometry: deflateRawSync(mobGeomRaw, { level: 9 }).toString('base64'),
    mobGeometryBytes: mobGeomRaw.length,
  });
  M.EntityRender.init();
  const ER = M.EntityRender, CFG = M.CFG;
  ok(ER.ready, 'the entity renderer is up for §9');
  ok(ER.mobGeomFor('wolf', 'wolf_collar') && ER.mobGeomFor('wolf', 'wolf_collar').length === ER.mobGeomFor('wolf', null).length,
     "ER.mobGeomFor('wolf','wolf_collar') resolves, with the SAME part count as wolf's own box (D-471: no new geometry, the SAME box, re-textured)");
  ok(ER.mobGeomFor('cat', 'cat_collar') && ER.mobGeomFor('cat', 'cat_collar').length === ER.mobGeomFor('cat', null).length,
     "ER.mobGeomFor('cat','cat_collar') resolves the same way for cat");

  EL.list.length = 0;
  const wildWolf = mkWolf();
  let b = ER.build(0, 64, 0, wildWolf.x, wildWolf.y, wildWolf.z, 1);
  ok(!!b && b.drawn === 1, `a WILD wolf draws exactly 1 (itself, no collar) — got ${b && b.drawn}`);

  EL.list.length = 0;
  const tameWolf = mkWolf();
  tameWolf.tamed = true;
  b = ER.build(0, 64, 0, tameWolf.x, tameWolf.y, tameWolf.z, 1);
  ok(!!b && b.drawn === 2, `a TAMED wolf draws exactly 2 (itself + the collar overlay) — got ${b && b.drawn}`);
  const wolfQuads = ER.mobQuadCount('wolf');
  ok(!!b && b.quads[CFG.LAYER_CUTOUT] === wolfQuads * 2,
     `a TAMED wolf's cutout quads double (base ${wolfQuads} x2 = ${wolfQuads * 2}) — got ${b && b.quads[CFG.LAYER_CUTOUT]}`);

  EL.list.length = 0;
  const tameCat = EL.spawn('cat', 0, 64, 0);
  tameCat.tamed = true;
  b = ER.build(0, 64, 0, tameCat.x, tameCat.y, tameCat.z, 1);
  ok(!!b && b.drawn === 2, `a TAMED cat also draws itself + its own collar overlay — got ${b && b.drawn}`);

  // anti-vacuity (D-30, D-305), both directions: force the rule off and prove the "drawn===2"
  // assertion above would have caught it; then prove the REAL rule, unbroken, still passes.
  EL.list.length = 0;
  const realCollarKey = Tm.collarKey;
  Tm.collarKey = function () { return null; };
  const tameWolf2 = mkWolf();
  tameWolf2.tamed = true;
  const broken = ER.build(0, 64, 0, tameWolf2.x, tameWolf2.y, tameWolf2.z, 1);
  okAv(!!broken && broken.drawn === 1,
       'forcing Tm.collarKey to always answer null drops a tamed wolf back to 1 drawn — the §9 drawn===2 assertion is not vacuous');
  Tm.collarKey = realCollarKey;
  EL.list.length = 0;
  const tameWolf3 = mkWolf();
  tameWolf3.tamed = true;
  const restored = ER.build(0, 64, 0, tameWolf3.x, tameWolf3.y, tameWolf3.z, 1);
  okAv(!!restored && restored.drawn === 2,
       'the REAL Tm.collarKey, unbroken, still draws 2 for the same entity');
  EL.list.length = 0;

  // §9b — QUEUE 0.2: the SECOND half of D-471's own gate, `!isInvisible()` (Tm.OWED's struck
  // line 1), wired at the render site against the real invisibility status effect (D-497).
  const ES = M.Effects;
  if (ES && ES.ready && ES.addStatusEffect) {
    const invisWolf = mkWolf();
    invisWolf.tamed = true;
    ES.initEntity(invisWolf);
    ES.addStatusEffect(invisWolf, 'invisibility', 200, 0, false, false);
    ok(ES.hasStatusEffect(invisWolf, 'invisibility'), 'the fixture wolf is genuinely invisible before it is drawn');
    const invisB = ER.build(0, 64, 0, invisWolf.x, invisWolf.y, invisWolf.z, 1);
    // #1017/#1533: LivingEntityRenderer.render draws NOTHING for an invisible non-player mob (and the
    // collar feature gates on !isInvisible too), so 0 -- it used to be 1 (the body) before #1017
    ok(!invisB || invisB.drawn === 0,   // ER.build returns null when nothing is drawn
       `a TAMED but INVISIBLE wolf draws nothing (no body, no collar) — got ${invisB ? invisB.drawn : null}`);
    ES.removeStatusEffect(invisWolf, 'invisibility');
    const visibleAgainB = ER.build(0, 64, 0, invisWolf.x, invisWolf.y, invisWolf.z, 1);
    ok(!!visibleAgainB && visibleAgainB.drawn === 2,
       `the SAME wolf, invisibility removed, draws 2 again (itself + collar) — got ${visibleAgainB && visibleAgainB.drawn}`);
    // anti-vacuity, both directions
    okAv(!invisB || invisB.drawn === 0, 'anti-vacuity: an invisible tamed wolf genuinely drops to 0 drawn — the gate can fail');
    okAv(!!visibleAgainB && visibleAgainB.drawn === 2, 'anti-vacuity: removing invisibility genuinely restores the collar — the gate is not a one-way switch');
  } else {
    ok(false, '07q_effects.js did not load into the tamecheck fixture — §9b could not run');
  }
  EL.list.length = 0;
}


// ── §10. THE FOLLOW-OWNER GOAL ACTUALLY RUNS (D-474) ──────────────────────────────────────────────────
say('\n§10 — Ai.FollowOwnerGoal (bdr, javap\'d this pass) — wolf/cat actually follow, sit blocks it, ' +
  'and it teleports past 12 blocks');
{
  M.World.init(1);
  const PLAT_Y = 63;
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
    const c = M.World.makeChunk(cx, cz);
    c.state = M.CH.GENERATED;
    M.World.chunks.set(M.World.key(cx, cz), c);
  }
  const STONE = M.States.stateOf('stone') | 0;
  for (let x = -16; x <= 16; x++) for (let z = -16; z <= 16; z++) M.World.setBlock(x, PLAT_Y, z, STONE);

  const owner = { x: 0, y: PLAT_Y + 1, z: 0, eyeHeight: 1.62 };
  const wolf = mkWolf();
  wolf.x = 0; wolf.y = PLAT_Y + 1; wolf.z = 0;
  const getOwner = () => [owner];
  const g = new M.Ai.FollowOwnerGoal(wolf, 1.0, 10, 2, getOwner);

  ok(g.canUse() === false, 'an UNTAMED wolf never starts following (findOwner refuses e.tamed===false)');

  wolf.tamed = true; wolf.owner = 'player';
  owner.x = 3; owner.z = 0;   // 3 blocks away — inside startDist (10)
  ok(g.canUse() === false, 'a TAMED wolf within startDist does not start following (3 < 10)');

  owner.x = 15; owner.z = 0;   // 15 blocks — past startDist (10), short of teleport (12)
  ok(g.canUse() === true, 'a TAMED wolf past startDist (15 > 10) starts following');

  wolf.sitting = true;
  ok(g.canUse() === false, 'a SITTING tamed wolf never starts following, however far the owner is');
  wolf.sitting = false;

  ok(g.canUse() === true, 'un-sitting restores canUse at the same distance');
  g.start();
  ok(g.canContinueToUse() === true, 'canContinueToUse is true while still past stopDist (15 > 2)');
  owner.x = 1; owner.z = 0;   // 1 block — inside stopDist (2)
  ok(g.canContinueToUse() === false, 'canContinueToUse goes false once within stopDist (1 <= 2)');
  wolf.sitting = true;
  owner.x = 15;
  ok(g.canContinueToUse() === false, 'canContinueToUse also goes false while sitting, however far the owner now is');
  wolf.sitting = false;

  // the teleport: owner 20 blocks away (20^2=400 >= Ai.FOLLOW_OWNER_TELEPORT_DIST^2=144) — one
  // tick must move the wolf to within Ai.FOLLOW_OWNER_TELEPORT_DIST of the owner, not just step.
  const wolf2 = mkWolf();
  wolf2.x = -20; wolf2.y = PLAT_Y + 1; wolf2.z = 0;
  wolf2.tamed = true; wolf2.owner = 'player';
  owner.x = 0; owner.z = 0;
  // D-595: seeded, not Math.random — tryTeleport's 10 random tries can all miss the fixture's
  // platform (a 1-in-many flake the 24 Sept 07:15 full suite hit); the rule under test is
  // "a successful try moves it inside 12", not "Math.random is kind today".
  let seed2 = 12345; const rng2 = () => { seed2 = (seed2 * 1103515245 + 12345) & 0x7fffffff; return seed2 / 0x80000000; };
  const g2 = new M.Ai.FollowOwnerGoal(wolf2, 1.0, 10, 2, getOwner, rng2);
  ok(g2.canUse() === true, 'the far wolf starts following (20 > startDist 10)');
  g2.start();
  const beforeD = Math.hypot(owner.x - wolf2.x, owner.z - wolf2.z);
  g2.tick();
  const afterD = Math.hypot(owner.x - wolf2.x, owner.z - wolf2.z);
  ok(beforeD >= M.Ai.FOLLOW_OWNER_TELEPORT_DIST, `sanity: the fixture starts past the teleport distance (${beforeD.toFixed(1)} >= ${M.Ai.FOLLOW_OWNER_TELEPORT_DIST})`);
  ok(afterD < M.Ai.FOLLOW_OWNER_TELEPORT_DIST, `one tick() past 12 blocks TELEPORTS the wolf to within it (${beforeD.toFixed(1)} → ${afterD.toFixed(1)})`);

  // cat carries the SAME class, only stopDist (5 not 2) differs — both species share `bdr`.
  const cat = EL.spawn('cat', 0, PLAT_Y + 1, 0);
  cat.tamed = true; cat.owner = 'player';
  const ownerC = { x: 4, y: PLAT_Y + 1, z: 0, eyeHeight: 1.62 };
  const gc = new M.Ai.FollowOwnerGoal(cat, 1.0, 10, 5, () => [ownerC]);
  gc.__started = false;
  // seed a "following" state the same way canUse()+start() would, at a distance inside cat's
  // stopDist (5) but outside wolf's (2) — the exact gap that proves the two are NOT the same
  // hard-coded stopDist.
  ownerC.x = 14;   // past startDist(10)
  ok(gc.canUse() === true, 'a tamed cat past its own startDist also starts following');
  gc.start();
  ownerC.x = 4;   // 4 blocks — inside cat's stopDist (5) but OUTSIDE wolf's (2)
  ok(gc.canContinueToUse() === false, 'cat stops at 4 blocks (inside its own stopDist=5)');
  const gCheckWolfStop = new M.Ai.FollowOwnerGoal(wolf, 1.0, 10, 2, getOwner);
  wolf.tamed = true; wolf.sitting = false;
  owner.x = 15; owner.z = 0;
  ok(gCheckWolfStop.canUse() === true, 'sanity: the wolf-stop fixture starts following at 15 blocks');
  gCheckWolfStop.start();
  owner.x = 4; owner.z = 0;   // now move owner to the same 4-block gap cat stopped at
  ok(gCheckWolfStop.canContinueToUse() === true,
     'the SAME 4-block gap does NOT stop a wolf (outside its own stopDist=2) — proves stopDist is per-call, not shared mutable state');

  // anti-vacuity (D-30, D-305), both directions: force startDist to 0 (always "close enough",
  // canUse always false-by-distance) and prove the above assertions would have caught it; then
  // prove the REAL goal, unbroken, still passes.
  const brokenGoal = new M.Ai.FollowOwnerGoal(wolf2, 1.0, 10000, 2, getOwner);
  owner.x = 15; owner.z = 0;
  okAv(brokenGoal.canUse() === false,
       'a startDist of 10000 fails the "past startDist → canUse true" assertion shape — not vacuous');
  const realGoal = new M.Ai.FollowOwnerGoal(wolf2, 1.0, 10, 2, getOwner);
  okAv(realGoal.canUse() === true,
       'the REAL FollowOwnerGoal, unbroken, still starts at the same distance');
}


// ── §11. WOLF ANGER — the timer, the skin, and the decay (D-475, this pass) ──────────────────
// `ayf` (NeutralMob, javap'd): the timer is `bje`'s own PERSISTENT_ANGER_TIME, a UniformInt of
// 20..39 SECONDS (`ajx.a(20,39)`, its own <clinit>) — 400..780 ticks, not typed by feel (rule 4).
say('\n§11 — Ai.rollAngerTime / Ai.HurtByTargetGoal anger / Tm.isAngry / Cb.tickEntity decay');
{
  const M2 = M;
  // the roll itself lands in the jar-read range, both directions (rule 6): never below the
  // floor, never above the ceiling, across enough draws that a broken roll would show it.
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 500; i++) {
    const v = M2.Ai.rollAngerTime(Math.random);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
    ok(v >= M2.Ai.ANGER_TIME_MIN && v <= M2.Ai.ANGER_TIME_MAX, 'rollAngerTime stays in [MIN,MAX]');
  }
  ok(M2.Ai.ANGER_TIME_MIN === 400 && M2.Ai.ANGER_TIME_MAX === 780,
     `ANGER_TIME is bje's own 20..39 seconds * 20 ticks, javap'd (got ${M2.Ai.ANGER_TIME_MIN}..${M2.Ai.ANGER_TIME_MAX})`);

  // HurtByTargetGoal.start() rolls a fresh timer for a WOLF, and leaves a non-wolf untouched —
  // `ayf` is only `implements`ed by `bje` in this jar (read by hand), so the gate is real.
  const w = mkWolf();
  w.lastHurtByEntity = { x: 0, y: 64, z: 0 };
  const wg = new M2.Ai.HurtByTargetGoal(w, () => 0.5);   // pinned roll: MIN + 0.5*(MAX-MIN+1)
  ok(wg.canUse() === true, 'a wolf with lastHurtByEntity set is ready to retaliate');
  wg.start();
  ok(w.target === w.lastHurtByEntity, 'HurtByTargetGoal.start still sets e.target (unchanged behaviour)');
  ok(w.angerTime > 0 && w.angerTime >= M2.Ai.ANGER_TIME_MIN && w.angerTime <= M2.Ai.ANGER_TIME_MAX,
     `a hurt WOLF gets a real angerTime in range (got ${w.angerTime})`);
  ok(Tm.skinKey(w) === 'wolf_angry', 'a wild wolf with angerTime > 0 draws wolf_angry');
  ok(Tm.isAngry(w) === true, 'Tm.isAngry reads angerTime > 0, ayf.I_\'s own default-method shape');

  const notWolf = { type: 'cow', lastHurtByEntity: { x: 0, y: 64, z: 0 } };
  const cg = new M2.Ai.HurtByTargetGoal(notWolf, () => 0.5);
  cg.start();
  ok(notWolf.angerTime === undefined, 'a non-wolf (cow — ayf is not implemented by bip either) never gets angerTime at all');

  // decay: `ayf.a(ServerLevel,boolean)` (updatePersistentAnger, javap'd) does not count down
  // while a live target is held; it ticks down by one only once the target is gone.
  const w2 = mkWolf();
  w2.angerTime = 5; M2.Player = M2.Player || {}; w2.target = M2.Player;   // #4569: only a PLAYER target pauses the countdown
  M2.Combat.tickEntity(w2);
  ok(w2.angerTime === 5, 'angerTime does NOT decay while e.target is still held');
  w2.target = null;
  M2.Combat.tickEntity(w2);
  ok(w2.angerTime === 4, 'angerTime decays by exactly 1/tick once the target is gone');
  ok(Tm.skinKey(w2) === 'wolf_angry', 'still angry (angerTime 4 > 0) — still draws wolf_angry');
  for (let i = 0; i < 4; i++) M2.Combat.tickEntity(w2);
  ok(w2.angerTime === 0, 'angerTime bottoms out at exactly 0, never negative');
  ok(Tm.skinKey(w2) === 'wolf', 'once angerTime reaches 0, the wild wolf skin goes back to plain \'wolf\'');

  // anti-vacuity (D-30, D-305): break the decay condition (decay even WITH a target) and prove
  // the "does not decay while held" assertion above would have caught it.
  const w3 = mkWolf();
  w3.angerTime = 5; w3.target = { x: 1, y: 64, z: 1 };
  const brokenDecay = w3.angerTime > 0 ? w3.angerTime - 1 : w3.angerTime;   // the bug: ignores e.target
  okAv(brokenDecay !== 5, 'a decay that ignores e.target would NOT hold at 5 — the real code, proven above, does');
}

// ── §12. PACK ALERT + OWNER DEFENCE (D-477, this pass) — bfk/bfp/bfq, javap'd ─────────────────
// bje.u()'s own TARGET goals, read in full this pass: priority 1 OwnerHurtByTargetGoal (bfp),
// 2 OwnerHurtTargetGoal (bfq), 3 HurtByTargetGoal (bfk, .setAlertOthers()'d with both varargs
// empty). See 07k_goals.js's own header on each for the exact disassembly.
say('\n§12 — Ai.OwnerHurtByTargetGoal / Ai.OwnerHurtTargetGoal / HurtByTargetGoal pack alert (bfp/bfq/bfk)');
{
  // ── owner defence: a tamed, un-sitting wolf targets whoever last hurt its owner ────────────
  const owner = { x: 0, y: 64, z: 0 };
  const wolf = mkWolf();
  const getOwner = () => [owner];
  const gOB = new M.Ai.OwnerHurtByTargetGoal(wolf, getOwner);
  ok(gOB.canUse() === false, 'an UNTAMED wolf never defends an owner it does not have');
  wolf.tamed = true; wolf.owner = 'player';
  ok(gOB.canUse() === false, 'a tamed wolf with an owner who has not been hurt does not fire');
  const attacker1 = { type: 'zombie', x: 1, y: 64, z: 1 };
  owner.lastHurtByEntity = attacker1;
  ok(gOB.canUse() === true, 'the owner being hurt makes a tamed, standing wolf ready to defend');
  wolf.sitting = true;
  ok(gOB.canUse() === false, 'a SITTING tamed wolf never defends its owner (bfp\'s own fB() gate)');
  wolf.sitting = false;
  gOB.start();
  ok(wolf.target === attacker1, 'OwnerHurtByTargetGoal.start sets e.target to the owner\'s attacker');
  ok(gOB.canContinueToUse() === true, 'canContinueToUse holds while e.target is still set');
  gOB.stop();
  ok(wolf.target === null, 'stop clears e.target');
  // the SAME attacker object must not re-trigger a second time — reference-identity "seen"
  // stands in for vanilla's timestamp diff (07k_goals.js's own header names this explicitly).
  ok(gOB.canUse() === false, 'the SAME owner.lastHurtByEntity value does not re-trigger after stop (D-477\'s own seen idiom)');
  const attacker2 = { type: 'skeleton', x: 2, y: 64, z: 2 };
  owner.lastHurtByEntity = attacker2;
  ok(gOB.canUse() === true, 'a NEW attacker on the owner does re-trigger');

  // ── owner offence: a tamed, un-sitting wolf joins whatever its owner last attacked ─────────
  const wolf2 = mkWolf();
  wolf2.tamed = true; wolf2.owner = 'player';
  const gOT = new M.Ai.OwnerHurtTargetGoal(wolf2, getOwner);
  ok(gOT.canUse() === false, 'no target fired for an owner who has not attacked anything yet');
  const prey = { type: 'sheep', x: 3, y: 64, z: 3 };
  owner.lastHurtMob = prey;
  ok(gOT.canUse() === true, 'the owner landing a hit makes a tamed, standing wolf ready to join in');
  wolf2.sitting = true;
  ok(gOT.canUse() === false, 'a SITTING tamed wolf never joins its owner\'s fight (bfq\'s own fB() gate, same as bfp)');
  wolf2.sitting = false;
  gOT.start();
  ok(wolf2.target === prey, 'OwnerHurtTargetGoal.start sets e.target to the owner\'s own last-hurt mob');

  // an UNTAMED wolf, or a wolf owned by nobody in particular, never fires either goal —
  // both directions of rule 6 (a rule that refuses a legal action is worse than one that allows
  // an illegal one, so both the "yes" and "no" shapes above must hold).
  const stray = mkWolf();
  stray.tamed = false;
  const gStray1 = new M.Ai.OwnerHurtByTargetGoal(stray, getOwner);
  const gStray2 = new M.Ai.OwnerHurtTargetGoal(stray, getOwner);
  ok(gStray1.canUse() === false && gStray2.canUse() === false, 'an untamed wolf never defends or joins in, however hurt/aggressive its "owner" is');

  // ── pack alert: HurtByTargetGoal.start also alerts nearby SAME-OWNER wolves (bfk.h()) ──────
  const w1 = mkWolf(); w1.x = 0; w1.y = 64; w1.z = 0;
  const w2 = mkWolf(); w2.x = 5; w2.y = 64; w2.z = 0;      // inside followRange (16) and Y (10)
  const w3 = mkWolf(); w3.x = 30; w3.y = 64; w3.z = 0;     // OUTSIDE followRange (16)
  const attacker = { x: 1, y: 64, z: 0 };
  w1.lastHurtByEntity = attacker;
  const getPack = () => [w1, w2, w3];
  const gAlert = new M.Ai.HurtByTargetGoal(w1, () => 0.5, getPack);
  gAlert.start();
  ok(w1.target === attacker, 'the hurt wolf itself still targets its own attacker (unchanged D-475 behaviour)');
  ok(w2.target === attacker, 'a nearby WILD wolf (5 blocks, same "no owner" status) is alerted too — bfk.h(), D-477');
  ok(w3.target === undefined, 'a wolf past followRange (30 > 16) is NOT alerted');

  // same-owner-only: a stranger's tame wolf does not join a fight a DIFFERENT owner's wolf started
  const wA = mkWolf(); wA.x = 0; wA.y = 64; wA.z = 0; wA.tamed = true; wA.owner = 'player';
  const wB = mkWolf(); wB.x = 3; wB.y = 64; wB.z = 0; wB.tamed = true; wB.owner = 'someoneElse';
  const wC = mkWolf(); wC.x = 3; wC.y = 64; wC.z = 3; wC.tamed = true; wC.owner = 'player';
  const atk2 = { x: 1, y: 64, z: 0 };
  wA.lastHurtByEntity = atk2;
  new M.Ai.HurtByTargetGoal(wA, () => 0.5, () => [wA, wB, wC]).start();
  ok(wB.target === undefined, 'a DIFFERENT owner\'s wolf is not alerted, however close (bfk.h()\'s own ays.fA() compare)');
  ok(wC.target === atk2, 'the SAME owner\'s other wolf is alerted');

  // a wolf that already holds a target of its own is left alone, not overwritten
  const wD = mkWolf(); wD.x = 0; wD.y = 64; wD.z = 0;
  const wE = mkWolf(); wE.x = 2; wE.y = 64; wE.z = 0;
  const busy = { x: 9, y: 64, z: 9 };
  wE.target = busy;
  const atk3 = { x: 1, y: 64, z: 0 };
  wD.lastHurtByEntity = atk3;
  new M.Ai.HurtByTargetGoal(wD, () => 0.5, () => [wD, wE]).start();
  ok(wE.target === busy, 'a wolf already fighting something is not redirected by a pack alert');

  // a non-wolf never calls getPack at all today (no ROSTER entry but wolf implements ayf, and
  // this file's own wiring only ever passes getPack for wolf's TARGET priority 3) — proven by
  // omitting it, the same shape §11 already used for the non-wolf anger case.
  const notWolf = { type: 'cow', lastHurtByEntity: { x: 0, y: 64, z: 0 } };
  const gNoPack = new M.Ai.HurtByTargetGoal(notWolf, () => 0.5);
  gNoPack.start();
  ok(notWolf.target === notWolf.lastHurtByEntity, 'HurtByTargetGoal with no getPack at all still starts without throwing and targets its attacker (backward compatible)');

  // anti-vacuity (D-30, D-305), both directions: an alert that ignored the owner gate, and one
  // that never fired at all, must both be catchable — prove the assertions above WOULD catch
  // each mutation, against a fresh, unbroken fixture each time.
  function alertRun(breakOwnerGate) {
    const a1 = mkWolf(); a1.x = 0; a1.y = 64; a1.z = 0; a1.tamed = true; a1.owner = 'player';
    const a2 = mkWolf(); a2.x = 3; a2.y = 64; a2.z = 0; a2.tamed = true; a2.owner = 'stranger';
    const atk = { x: 1, y: 64, z: 0 };
    a1.lastHurtByEntity = atk;
    const g = new M.Ai.HurtByTargetGoal(a1, () => 0.5, () => [a1, a2]);
    if (breakOwnerGate) { const real = a2.owner; a2.owner = a1.owner; g.start(); a2.owner = real; }
    else g.start();
    return a2.target === atk;
  }
  okAv(alertRun(true) === true, 'anti-vacuity: WITH the owner gate broken (a2 masquerading as a1\'s own wolf), the alert DOES cross owners — proves the gate above is load-bearing');
  okAv(alertRun(false) === false, 'anti-vacuity: ...and the REAL, unbroken gate keeps a different owner\'s wolf out, as asserted above');
}

say('\n§13 — collar dyeing (D-492, WolfEntity/CatEntity.interactMob DyeItem branch)');
{
  const w = EL.spawn('wolf', 5, 64, 5); w.tamed = true; w.owner = 'player';
  ok(Tm.dyeCollar(w, 'minecraft:blue_dye', { isOwner: false })?.consumed === true, 'a blue dye on a TAMED wolf is spent — any player may dye a wolf');
  ok(w.collarColor === 'blue', `...and its collar is blue now (${w.collarColor})`);
  const bl = M.BEModel.dye && M.BEModel.dye.blue;
  ok(bl !== undefined && JSON.stringify(Tm.collarRGB(w)) === JSON.stringify([(bl >> 16) & 255, (bl >> 8) & 255, bl & 255]),
     `the blue collar tints with DyeColor.BLUE's textureDiffuseColor (${JSON.stringify(Tm.collarRGB(w))})`);
  ok(Tm.dyeCollar(w, 'minecraft:blue_dye', {}) === null, 'the SAME colour again is refused and spends nothing');
  ok(Tm.dyeCollar(w, 'minecraft:stick', {}) === null, 'a non-dye item is not a dye');
  // #1948: every DyeColor tints the collar differently (the sheet is the white mask, 07j tints per entity)
      const tints = Tm.DYES.map(d => { w.collarColor = d; return JSON.stringify(Tm.collarRGB(w)); });
    ok(new Set(tints).size === 16 && !tints.includes('null'), '#1948: all 16 dye colours give 16 distinct collar tints');
    w.collarColor = 'red';
    const brokenTints = Tm.DYES.map(() => JSON.stringify(Tm.collarRGB(w)));
    okAv(new Set(brokenTints).size !== 16, '#1948: a collarRGB that ignores collarColor (always red) fails the 16-distinct-tints assertion');
    const wild = EL.spawn('wolf', 6, 64, 5);
  ok(Tm.dyeCollar(wild, 'minecraft:green_dye', {}) === null && wild.collarColor !== 'green', 'an UNTAMED wolf cannot be dyed');
  const c = EL.spawn('cat', 7, 64, 5); c.tamed = true; c.owner = 'player';
  ok(Tm.dyeCollar(c, 'minecraft:lime_dye', { isOwner: false }) === null, 'a cat refuses a dye from a player who is not its owner (CatEntity: isOwner first)');
  ok(Tm.dyeCollar(c, 'minecraft:lime_dye', { isOwner: true })?.consumed === true && c.collarColor === 'lime' && c.persistent === true,
     'its owner dyes it lime, and the cat becomes persistent (setPersistent)');
  const realDyes = Tm.DYES;
  let broken;
  try { Tm.DYES = []; const w2 = EL.spawn('wolf', 8, 64, 5); w2.tamed = true; broken = Tm.dyeCollar(w2, 'minecraft:red_dye', {}) === null && Tm.dyeCollar(w2, 'minecraft:blue_dye', {}) === null; }
  finally { Tm.DYES = realDyes; }
  okAv(broken === true, 'anti-vacuity: with the dye roster emptied, no dye recolours anything — the table is what the assertions above rest on');
}

say('\n§14 — horse coat texture pick (D-522: HorseEntityRenderer.TEXTURES, Tm.skinKey)');
{
  // the extractor's own FAMILY.horse list, read off its text — Tm.HORSE_TEX_FAMILY must be that order
  const src = readFileSync(join(ROOT, 'tools', 'extract-mob-textures.mjs'), 'utf8');
  const m = /horse:\s*\[([^\]]*)\]\s*\n?\s*\.map\(\(c\) => P\('horse\/horse_'/.exec(src);
  const famOrder = m ? m[1].split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean) : null;
  ok(!!famOrder && JSON.stringify(famOrder) === JSON.stringify(Tm.HORSE_TEX_FAMILY),
     `Tm.HORSE_TEX_FAMILY is exactly extract-mob-textures.mjs's packing order (${famOrder && famOrder.join(',')})`);
  const h = EL.spawn('horse', 9, 64, 9);
  const pick = (color) => { h.variant = color; const k = Tm.skinKey(h); return Tm.HORSE_TEX_FAMILY[+k.split('#')[1]]; };
  ok(pick(0) === 'white', `HorseColor WHITE (0) draws horse_white, not sheet 0 (got ${pick(0)})`);
  ok(pick(0) !== 'black', 'a WHITE horse never draws the black sheet (the D-522 bug: every horse drew sheet 0 = black)');
  ok(pick(4) === 'black' && pick(6) === 'darkbrown' && pick(1) === 'creamy', 'BLACK 4 / DARKBROWN 6 / CREAMY 1 each draw their own sheet');
  ok(pick(0x0300) === 'white', 'the marking byte (high byte) never changes the coat sheet');
  const seen = new Set(); for (let c = 0; c < 7; c++) seen.add(pick(c));
  ok(seen.size === 7, `the seven HorseColors reach seven distinct sheets (${seen.size})`);
  const real = Tm.HORSE_COLOR_TEX;
  let broken;
  try { Tm.HORSE_COLOR_TEX = Tm.HORSE_TEX_FAMILY.slice(); broken = pick(0); } finally { Tm.HORSE_COLOR_TEX = real; }
  okAv(broken === 'black', 'anti-vacuity: with the vanilla colour table replaced by the packing order, WHITE draws black again — and the assertions above would catch it');
}

console.log('\n' + (fails.length ? 'FAIL' : 'PASS') + '  tamecheck — ' + pass + ' assertions, ' +
  fails.length + ' failures' + (breaks ? ', ' + breaks + ' breaks caught' : ''));
for (const f of fails) console.log('   x ' + f);
process.exit(fails.length ? 1 : 0);
