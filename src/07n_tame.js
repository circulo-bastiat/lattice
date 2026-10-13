// 07n_tame.js — PLAN G18e unit 3: TAMING. wolf and cat only — session's own scope ruling below.
// Runs on: MAIN THREAD ONLY. No DOM.
//
// (#1605: an ocelot cannot be TAMED but it DOES have a trust state - `Tm.feedOcelot`, e.trusting.)
// ⚠⚠ WHY WOLF AND CAT, AND NOT OCELOT OR PARROT (D-458, corrected #1615). Vanilla 1.18.2 splits what a pre-1.14
// player would call "a tamed ocelot" into two unrelated mobs: `Ocelot` is now WILD ONLY — it has
// no tame path, but it DOES have a trust roll in `interactMob` (raw cod/salmon, 1/3 -> Trusting;
// `Tm.feedOcelot`, below) — and `Cat` is its own mob, tamed directly, never "upgraded" from an ocelot.
// (The earlier claim here that Ocelot has no interactMob roll was wrong; .decomp OcelotEntity.interactMob.)
// Parrot IS tameable in vanilla, but its taming is wired into `LandOnOwnersShoulderGoal` and a
// flying `FollowOwnerGoal` this engine has no flying-AI substrate for (07k_goals.js's own header:
// pathfinding is ground-only) — approximating a parrot with ground goals would be exactly the
// "silently plausible" wrong default `07i_entitylist.js`'s own header refuses to ship. Named on
// `Tame.OWED`, not guessed around.
//
// ⚠⚠ THE 1-IN-3 ROLL IS READ FROM THE BYTECODE, NOT REMEMBERED. `bje` (Wolf) and `big` (Cat)
// each have exactly one `Random.nextInt(I)` in their `mobInteract` that is fed the literal
// `iconst_3` and gated by `ifne` (branch taken on ANY non-zero result, i.e. the tame succeeds
// on the ZERO case) immediately before the class's own `tame(Player)` call (`f:(Lboj;)V` in
// both disassemblies) and a `setInSittingPose`-shaped write) — the same shape in both classes,
// independently. `Tame.CHANCE_DENOM` is that literal, not a hand-typed "1 in 3" (D-329).
//
// ⚠ WHAT THIS UNIT DOES: the feed-and-roll (wolf: bone; cat: raw cod or salmon, `Breed`'s own
// food table — the SAME list `Br.isFood` already uses, not a second copy of it), marking the
// mob tamed and owned, and sitting (a MOVE-priority goal that holds still while `e.sitting`,
// wired to a plain empty-hand right-click on an already-tamed mob).
//
// ⚠ CLOSED THIS SESSION (`Tm.skinKey`/`Tm.catVariantRoll`/`Tm.collarKey`/`Tm.collarRGB`,
// below), so they are struck from `Tame.OWED` rather than left to look forgotten:
//   * the wolf/cat SKIN swap by state — wild vs tame for wolf, and the cat's eleven
//     `CatVariant` skins, chosen once at spawn (`EL.DEFAULTS.cat`, `07i_entitylist.js`) the
//     way `big`'s own `finalizeSpawn` rolls it (`Random.nextInt(11)` above 0.9f downfall,
//     `nextInt(10)` otherwise — ALL_BLACK excluded outside wet biomes), read by hand this
//     session, not guessed.
//   * the collar's LAYER and its DEFAULT colour. `wolf_collar.png`/`cat_collar.png` draw,
//     tinted red — `DyeColor.RED`, read straight out of `bje`/`big`'s own synced-data
//     default (`bts.o`, javap'd this session, not remembered; see `Tm.COLLAR_DEFAULT_RGB`'s
//     own header for the exact bytecode and TSV row).
// ⚠ WHAT IS STILL NOT HERE, AND IS NAMED RATHER THAN GUESSED (`Tame.OWED`):
//   * ~~wolf's ANGRY skin~~ D-475: `e.angerTime` (`ayf`/`NeutralMob`, javap'd — see
//     `Ai.HurtByTargetGoal`'s own header, 07k_goals.js) now exists and `Tm.skinKey` reads it.
//   * ~~pack behaviour and a wolf defending its owner~~ D-477: `bfp`/`bfq`/`bfk` (`bje.u()`'s
//     own TARGET priorities 1/2/3, javap'd in full) are `Ai.OwnerHurtByTargetGoal`/
//     `Ai.OwnerHurtTargetGoal`/`Ai.HurtByTargetGoal`'s pack-alert arm now — see 07k_goals.js's
//     own header on each.
//   * the collar's DYE, i.e. a PLAYER changing its colour. `e.collarColor` is written once,
//     at spawn, to vanilla's own default, and nothing in this engine ever writes it again.
//   * ⚠⚠ THE GPU ATLAS ITSELF, which is not this unit's gap to close: `07j_entityrender.js`'s
//     own header already names mob texturing as unwired end to end (`mob-tex.bin` is
//     packed, but the box renderer's `tile` argument is caller-supplied and nothing binds
//     a real mob atlas to it) — `Tm.skinKey`/`Tm.collarKey` only answer the RULE, so that
//     wiring is right the day it lands instead of invented twice. `pack-mobtex.mjs` is also
//     still only baking family member `#0` of every texture family (its own header,
//     unchanged this session) — so even once wired, only `cat#0` has a real GPU sheet today.
//   * anger timers, pack behaviour, and a wolf defending its owner (`HurtByTargetGoal`'s target
//     is the ATTACKER only — a wolf does not yet come to a hurt owner's aid).
//   * ~~leashing~~ QUEUE 0.2 — the lead item, attach/detach, `PathAwareEntity.updateLeash`'s
//     break/pull/approach distance rules, `LeashKnotEntity` (fence attach, detach, the
//     100-tick `canStayAttached` break-drop) — all below, `.decomp` read this session. Riding
//     (horses only, G18e's own row 11/G25 territory) is not this unit and stays open.
//   * multiplayer ownership (`e.owner` is a single flag, "the one live player", because this
//     engine has exactly one — same standing simplification `EL.aiCtx`'s own header states).
//   * ~~a tamed mob FOLLOWING its owner~~ D-474: `bdr` (javap'd), the SAME `FollowOwnerGoal`
//     class for BOTH species (not two classes — `big.u()` constructs the identical `bdr`, only
//     its stopDist argument differs), wired into `Ai.ROSTER.wolf`/`.cat` at priority 6. See
//     `07k_goals.js`'s own header comment on `Ai.FollowOwnerGoal` for the full disassembly.

(function (NS) {
  'use strict';
  // fallback stream when a caller passes no rng: the entity list's, else a fixed-seed JRandom (never Math.random, #6440)
  var fbR = null;
  function RNDFB() { var L = NS.EntityList; if (L && L.random) return L.random(); if (!fbR) fbR = NS.JRandom ? new NS.JRandom(0x6440) : { s: 0x6440, nextDouble: function () { this.s = (Math.imul(this.s, 1103515245) + 12345) >>> 0; return this.s / 4294967296; } }; return fbR.nextDouble(); }

  var Tm = NS.Tame = { ready: false };

  // D-458 — `bje`/`big` `mobInteract`, both read by hand: `iconst_3` -> `Random.nextInt` ->
  // `ifne` (branch on non-zero; the ZERO case falls through to `tame()`). One literal, agreeing
  // in both independently-compiled classes.
  Tm.CHANCE_DENOM = 3;

  /** The two species this unit covers. Anything else refuses — see the header ruling. */
  Tm.TAMABLE = { wolf: true, cat: true };

  // ⚠⚠ TAME FOOD IS NOT BREED FOOD, AND WOLF IS WHERE THAT MATTERS. Vanilla feeds a wolf a BONE
  // to tame it and MEAT (`Breed`'s own predicate, `Br.isFood('wolf', ...)`, still unbuilt — see
  // `Breed.OWED`) to breed an ALREADY-tamed one — two different foods, read straight off `bje`'s
  // own `mobInteract`, which checks bone BEFORE it ever asks `isFood()` at all. Cat is the one
  // case where the two happen to coincide (raw cod/salmon tames AND breeds a cat), which is
  // exactly the coincidence that would have hidden this bug if `tamecheck.mjs` had only tried
  // cat — `Tm.FOOD.wolf` exists so this file does not quietly delegate a wrong table to `Breed`.
  Tm.FOOD = { wolf: ['bone'] };
  Tm.isTameFood = function (type, item) {
    var list = Tm.FOOD[type];
    if (list) return list.indexOf(item) >= 0;
    var Br = NS.Breed;
    return !!(Br && Br.ready && Br.isFood(type, item));
  };

  Tm.init = function () {
    var Br = NS.Breed;
    Tm.ready = !!(Br && Br.ready);
    // QUEUE 0.2 (leashing) — `Tags.blockTag('fences')`, resolved once and cached: both the
    // fence-attach use-hook (14l_use.js) and `Tm.knotCanStayAttached` need it every call.
    var Tags = NS.Tags;
    Tm._fencesCol = (Tags && Tags.ready && Tags.blockTag) ? Tags.blockTag('fences') : -1;
    Tm.knots = [];
    Tm.nextKnotId = 1;
    return Tm;
  };

  /**
   * Feed `e` an item named `itemName`. Returns `{ consumed, tamed }` — `consumed` is true
   * whenever the item counts as this species' tame food at all (vanilla consumes the food on
   * every attempt, success or not, outside creative — `Use.entityUse`'s own caller already
   * handles the creative/`instabuild` exemption for `Breed.interact`, and this mirrors it),
   * `tamed` is true only on the roll's zero case. Returns `null` when `e` cannot be tamed at
   * all (wrong species, already tamed, or not this unit's food) — a refusal, not a silent no-op.
   */
  Tm.feed = function (e, itemName, ctx) {
    if (!Tm.ready || !e || e.removed) return null;
    if (!Tm.TAMABLE[e.type]) return null;
    if (e.tamed) return null;
    if (!Tm.isTameFood(e.type, itemName)) return null;
    if (e.type === 'wolf' && e.angerTime > 0) return null;   // WolfEntity.interactMob: bone && !hasAngerTime()
    if (e.type === 'cat') e.persistent = true;   // CatEntity.interactMob: setPersistent() on success AND failure
    var rand = (ctx && ctx.random) || RNDFB;
    var roll = Math.floor(rand() * Tm.CHANCE_DENOM);   // 0..CHANCE_DENOM-1, uniform
    if (roll === 0) {
      e.tamed = true;
      e.owner = 'player';   // D-458 — one flag, one player; see the header's standing note
      // #1696 — WolfEntity/CatEntity.interactMob success: navigation.stop(), setTarget(null), setSitting(true).
      e.sitting = true;
      e.path = null; e.walkTarget = null; e.target = null;
      // loop/mobdefaults (referee finding a) — `WolfEntity.setTamed(true)` (.decomp
      // WolfEntity.java:324-331) sets `generic.max_health`'s base to 20.0 AND calls
      // `this.setHealth(20.0F)` in the SAME branch — a wild wolf's 8.0 jumps to a full-health
      // 20.0 the instant taming succeeds, not merely a higher ceiling on its current (possibly
      // damaged) health. `ATTACK_DAMAGE` is NOT touched here: `setTamed` sets it to 4.0 in
      // BOTH branches (wild and tamed alike, see `EL.DEFAULTS.wolf`'s own header,
      // 07i_entitylist.js), so it was already 4.0 before this roll and stays 4.0 after it.
      if (e.type === 'wolf') { e.maxHealth = 20; e.health = 20; }
    }
    // `TameableEntity.showEmoteParticle` -- `handleStatus(7)` on success (7 HEARTs),
    // `handleStatus(6)` on failure (7 SMOKEs); TameableEntity.java:82-103. loop/hearts
    // (this session) -- `07zx_particle.js`'s substrate, not built when `Tame.OWED` was
    // last written.
    var Br = NS.Breed, Px = NS.Particle;
    if (Br && Px && Br.particlePoint) {
      var pt = Br.particlePoint(e, rand);
      Px.spawnBurst(e.tamed ? 'heart' : 'smoke', pt[0], pt[1], pt[2], rand);
    }
    return { consumed: true, tamed: !!e.tamed };
  };

  /**
   * OcelotEntity.interactMob (.decomp:160): raw cod/salmon within 3 blocks (squared < 9), not yet trusting, tempt goal
   * active -> eat; 1/3 setTrusting(true) + hearts (status 41), else smoke (status 40). Returns null when it does not apply
   * (the item then falls through to breeding, as `super.interactMob` does). ctx.distSq = squared player distance.
   */
  Tm.feedOcelot = function (e, itemName, ctx) {
    if (!Tm.ready || !e || e.removed || e.type !== 'ocelot' || e.trusting) return null;
    if (!e.temptActive) return null;
    if (itemName !== 'cod' && itemName !== 'salmon') return null;
    if (!(ctx && ctx.distSq < 9)) return null;
    var rand = (ctx && ctx.random) || RNDFB;
    if (Math.floor(rand() * Tm.CHANCE_DENOM) === 0) e.trusting = true;
    var Br = NS.Breed, Px = NS.Particle;
    if (Br && Px && Br.particlePoint) {
      var pt = Br.particlePoint(e, rand);
      Px.spawnBurst(e.trusting ? 'heart' : 'smoke', pt[0], pt[1], pt[2], rand);
    }
    return { consumed: true, trusting: !!e.trusting };
  };

  /** Empty-hand right-click on an already-tamed mob: toggle sitting. Refuses anything else. */
  Tm.toggleSit = function (e) {
    if (!Tm.TAMABLE[e.type] || !e.tamed) return false;
    if (e.owner !== 'player') return false;   // `isOwner(player)` -- the one live player owns 'player' (header's standing note)
    e.sitting = !e.sitting;
    e.jumping = false; e.navigating = false; e.target = null;   // setJumping(false); navigation.stop(); setTarget(null)
    return true;
  };

  /**
   * D-458 (closed this session) — WHICH TEXTURE KEY a wolf/cat should draw, once mob
   * texturing itself is wired to the GPU atlas (`07j_entityrender.js`'s own header names that
   * as its own separate, still-owed gap — `mob-tex.bin` is packed, `ER.mobLayerFor` never
   * binds it). This only answers the RULE; wiring it into `ER` is that other gap's job.
   *
   * Wolf: `bje`'s three body skins are wild/tame/angry (`extract-mob-textures.mjs`'s own
   * `wolf`/`wolf_tame`/`wolf_angry` aliases). D-475 closed ANGRY: `e.angerTime` (`ayf`/
   * `NeutralMob`, javap'd) answers it now, tame still checked first (`RenderWolf`'s own order).
   *
   * Cat: `big`'s `CatType` is the `CatVariant` ordinal (0..10), packed as `cat#0`..`cat#10`
   * by `extract-mob-textures.mjs`'s own family idiom. `e.catVariant` is chosen once, at
   * spawn, by `EL.DEFAULTS.cat` (`07i_entitylist.js`) — this function only reads it.
   */
  // D-475 — `ayf.I_()` (`isAngry`, default method, javap'd): `getRemainingPersistentAngerTime()
  // > 0`, nothing else. `e.angerTime` is that field; see `Ai.HurtByTargetGoal`'s own header
  // (07k_goals.js) for the timer's start/decay.
  Tm.isAngry = function (e) { return !!(e && e.angerTime > 0); };

  /** WolfEntity voice: getAmbientSound (angry -> growl; 1/3 roll -> tamed && health < 10 ? whine : pant; else ambient),
   *  getHurtSound/getDeathSound, playStepSound (step, volume 0.15), getSoundVolume 0.4. Returns the event or null. */
  Tm.WOLF_SOUND = { ambient: 'entity.wolf.ambient', growl: 'entity.wolf.growl', pant: 'entity.wolf.pant',
                    whine: 'entity.wolf.whine', hurt: 'entity.wolf.hurt', death: 'entity.wolf.death',
                    step: 'entity.wolf.step' };
  Tm.wolfAmbientEvent = function (e, rnd) {
    var W = Tm.WOLF_SOUND;
    if (Tm.isAngry(e)) return W.growl;
    if (Math.floor((rnd || RNDFB)() * 3) === 0) return (e.tamed && e.health < 10) ? W.whine : W.pant;
    return W.ambient;
  };
  Tm.wolfSound = function (e, kind, rnd) {
    if (!e || e.type !== 'wolf' || e.silent) return null;
    rnd = rnd || RNDFB;
    var ev = kind === 'ambient' ? Tm.wolfAmbientEvent(e, rnd) : Tm.WOLF_SOUND[kind];
    if (!ev) return null;
    var S = NS.Sound;
    if (S && S.play) {
      var step = kind === 'step';
      S.play(ev, { x: e.x, y: e.y, z: e.z, volume: step ? 0.15 : 0.4,
                   pitch: step ? 1 : (rnd() - rnd()) * 0.2 + ((e.growAge | 0) < 0 ? 1.5 : 1.0),
                   source: 'neutral', listener: NS.Player });
    }
    return ev;
  };
  /** MobEntity.baseTick's ambient roll plus Entity.move's step counter; once per EL.tickMob. */
  Tm.tickWolfSounds = function (e, rnd) {
    if (!e || e.type !== 'wolf' || e.dead) return;
    rnd = rnd || RNDFB;
    var chance = e.ambientSoundChance | 0;
    e.ambientSoundChance = chance + 1;
    if (Math.floor(rnd() * 1000) < chance) {
      e.ambientSoundChance = -80;
      Tm.wolfSound(e, 'ambient', rnd);
    }
    if (e.stepDist === undefined) { e.stepDist = 0; e.nextStepDist = 1; e.stepX = e.x; e.stepZ = e.z; }
    var dx = e.x - e.stepX, dz = e.z - e.stepZ;
    e.stepX = e.x; e.stepZ = e.z;
    e.stepDist += Math.sqrt(dx * dx + dz * dz) * 0.6;
    if (e.stepDist > e.nextStepDist && e.onGround && !e.inWater) {
      e.nextStepDist = Math.floor(e.stepDist) + 1;
      Tm.wolfSound(e, 'step', rnd);
    }
  };

  Tm.skinKey = function (e) {
    if (!e) return null;
    // ⚠ TAME COMES FIRST, NOT ANGRY (`RenderWolf`'s own texture pick, read by hand: tame is
    // checked before angry, so a tamed wolf never shows `wolf_angry` even mid-fight) — D-475
    // closes the `Tame.OWED` line this exact comment used to point at.
    if (e.type === 'wolf') return e.tamed ? 'wolf_tame' : (Tm.isAngry(e) ? 'wolf_angry' : 'wolf');
    if (e.type === 'cat') return 'cat#' + (e.catVariant | 0);
    // s101 — MooshroomEntityRenderer.TEXTURES: red -> red_mooshroom.png (the base skin),
    // brown -> brown_mooshroom.png, off e.mooshroomType (07zn_mooshroom.js).
    if (e.type === 'mooshroom') return e.mooshroomType === 'brown' ? 'mooshroom_brown' : null;
    // D-522 — horse: the coat texture off `e.variant`'s low byte (Mnt.horseColor, D-520). Every
    // horse used to draw sheet 0 of the "horse" family, which extract-mob-textures.mjs packs in
    // ALPHABETICAL order — sheet 0 is horse_black, so every horse, white ones included, was black.
    if (e.type === 'horse') {
      var c = (e.variant !== undefined) ? (e.variant & 0xFF) : 0;
      var fam = Tm.HORSE_TEX_FAMILY.indexOf(Tm.HORSE_COLOR_TEX[c] || Tm.HORSE_COLOR_TEX[0]);
      return 'horse#' + (fam < 0 ? 0 : fam);
    }
    return null;
  };
  // HorseEntityRenderer.TEXTURES (.decomp, read in full): HorseColor id -> horse_<name>.png —
  // WHITE 0, CREAMY 1, CHESTNUT 2, BROWN 3, BLACK 4, GRAY 5, DARKBROWN 6.
  Tm.HORSE_COLOR_TEX = ['white', 'creamy', 'chestnut', 'brown', 'black', 'gray', 'darkbrown'];
  // The sheet order tools/extract-mob-textures.mjs's FAMILY.horse packs (horse#i = sheet i);
  // tamecheck compares this list against that file's own text, so the two cannot drift apart.
  Tm.HORSE_TEX_FAMILY = ['black', 'brown', 'chestnut', 'creamy', 'darkbrown', 'gray', 'white'];

  // D-458 (closed this session) — `big.a(Lcbk;Lawf;Layc;Layq;Lok;)` (`finalizeSpawn`, read by
  // hand): if the spawn biome's downfall is > 0.9f the roll is `random.nextInt(11)` (all
  // eleven CatVariant ordinals — ALL_BLACK, ordinal 10, included); otherwise it is
  // `random.nextInt(10)` (ALL_BLACK excluded). One `Random.nextInt(I)` each, immediately
  // followed by `s(I)` (the CatType setter) — the same one-roll shape `Tm.CHANCE_DENOM`'s own
  // header already trusts for a literal this small.
  // ⚠ D-493: the argument is `getMoonSize()`, NOT downfall — see EL.DEFAULTS.cat (07i).
  Tm.catVariantRoll = function (moonSize, rand) {
    var r = rand || RNDFB;
    var n = (moonSize > 0.9) ? 11 : 10;
    return Math.floor(r() * n);
  };

  // D-458 (closed this session) — THE COLLAR LAYER AND ITS DEFAULT COLOUR, READ FROM THE JAR,
  // NOT REMEMBERED. `bje.a_()`/`big.a_()` (both classes' `defineSynchedData`, read by hand)
  // default the `CollarColor` byte to `bts.o.a()`. `bts`'s own `<clinit>` (also read this
  // session) constructs its sixteen constants in vanilla's ordinal order, one per
  // `putstatic`, and `o` is the FIFTEENTH one constructed, with the literal string "red" as
  // its own lowercase name argument — `DyeColor.RED`, ordinal 14, matching
  // `tools/golden/dye-colours-1.18.2.tsv`'s own `id=14` row (that TSV is itself
  // `extract-colours.mjs`'s jar read, not typed either). Collar DYE-CHANGING BY THE PLAYER IS
  // NOT IN SCOPE (still `Tame.OWED`) — this only draws the default.
  Tm.COLLAR_LAYER = { wolf: 'wolf_collar', cat: 'cat_collar' };
  Tm.COLLAR_DEFAULT_COLOR = 'red';
  // tools/golden/dye-colours-1.18.2.tsv row 33: `red id=14 textureDiffuseColor=0xB02E26` —
  // the SAME column vanilla's own collar/wool/leather tint reads
  // (`DyeColor.getTextureDiffuseColor`), not the firework or text colour columns that row also
  // carries (the TSV header names all three and why they differ).
  Tm.COLLAR_DEFAULT_RGB = [0xB0, 0x2E, 0x26];

  /** The `<layer>` key the collar OVERLAY should draw — or null when `e` draws no collar at
   *  all (wild, or not a collared species). */
  Tm.collarKey = function (e) {
    if (!e || !e.tamed) return null;
    return Tm.COLLAR_LAYER[e.type] || null;
  };

  /** The collar's tint, as `[r, g, b]` 0-255, or null when `e` has no collar to tint at all.
   *  Always the jar-read default today — dye-changing is `Tame.OWED`, so `e.collarColor`
   *  never becomes anything but `Tm.COLLAR_DEFAULT_COLOR` yet. */
  Tm.collarRGB = function (e) {
    if (!Tm.collarKey(e)) return null;
    var c = e.collarColor || Tm.COLLAR_DEFAULT_COLOR;
    if (c === Tm.COLLAR_DEFAULT_COLOR) return Tm.COLLAR_DEFAULT_RGB.slice();
    // D-492: any other colour is `DyeColor.textureDiffuseColor` out of the jar — the table
    // `pack-blockentity` already ships for banners (`NS.BEModel.dye`), not a second copy.
    var BE = NS.BEModel, rgb = BE && BE.dye ? BE.dye[c] : undefined;
    return rgb === undefined ? null : [(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255];
  };

  /** The sixteen `DyeColor` names, ordinal order (tools/golden/dye-colours-1.18.2.tsv). */
  Tm.DYES = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
             'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];

  /**
   * #1698 — the heal branch of `WolfEntity.interactMob` (tamed): a breeding item (any meat) on a
   * wolf with `health < maxHealth` heals `food.getHunger()` and spends one item unless creative;
   * it returns SUCCESS before `super.interactMob`, so a hurt wolf never enters love mode.
   * Full health -> `null` (falls through to dye / breed, as vanilla does).
   */
  Tm.healWolf = function (e, itemName, ctx) {
    // #1871: `CatEntity.interactMob` has the same heal branch (cod/salmon), but behind `isOwner`.
    if (!Tm.ready || !e || e.removed || (e.type !== 'wolf' && e.type !== 'cat') || !e.tamed) return null;
    if (e.type === 'cat' && !(ctx && ctx.isOwner)) return null;
    var Br = NS.Breed, IT = NS.Items;
    if (!Br || !Br.isFood(e.type, itemName) || !IT) return null;
    if (!(e.health < e.maxHealth)) return null;
    var id = IT.of(String(itemName).replace('minecraft:', ''));
    var hunger = id < 0 ? 0 : (IT.nutrition[id] | 0);
    e.health = Math.min(e.maxHealth, e.health + hunger);
    return { consumed: true, healed: hunger };
  };

  /**
   * D-492 — the dye branch of `WolfEntity.interactMob` / `CatEntity.interactMob` (Yarn, .decomp):
   * a `DyeItem` on a TAMED wolf/cat whose collar is a different colour sets it and spends one dye
   * unless creative. Wolf asks nothing about the player (any player may dye it); cat requires
   * `isOwner(player)` and also calls `setPersistent()`. Same colour, untamed, or not a dye →
   * `null` (the caller falls through, exactly as vanilla's own branch does).
   */
  Tm.dyeCollar = function (e, itemName, ctx) {
    if (!Tm.ready || !e || e.removed || !e.tamed || !Tm.COLLAR_LAYER[e.type]) return null;
    var n = String(itemName || '').replace('minecraft:', '');
    if (n.slice(-4) !== '_dye') return null;
    var colour = n.slice(0, -4);
    if (Tm.DYES.indexOf(colour) < 0) return null;
    if (e.type === 'cat' && !(ctx && ctx.isOwner)) return null;
    if ((e.collarColor || Tm.COLLAR_DEFAULT_COLOR) === colour) return null;
    e.collarColor = colour;
    if (e.type === 'cat') e.persistent = true;
    return { consumed: true };
  };


  // ═══════════════════════════ LEASHING (closes Tame.OWED's own line) ═══════════════════════
  // ⚠⚠ EVERY NUMBER BELOW IS TRANSCRIBED OUT OF `.decomp` THIS SESSION, NOT REMEMBERED. Four
  // classes, all Yarn-named, all read by hand against `names.tsv`:
  //   `MobEntity` (obf `aya`, names.tsv:21651-21877) — `LEASH_KEY`/`leashNbt`/`holdingEntity`,
  //     `canBeLeashedBy` (method_5931), `attachLeash`/`detachLeash` (method_5954/5932),
  //     `interact`'s own leash-first branch and `interactWithItem`'s lead branch.
  //   `PathAwareEntity` (obf `ayh`) — `updateLeash`'s OWN override (method_5995): the sitting
  //     early-return, the >10 break, the 6..10 pull (the exact `copySign(d*d*0.4, d)` formula,
  //     transcribed verbatim below) and the <=6 approach-goal request.
  //   `LeadItem` (obf `bva`) — `attachHeldMobsToBlock` (method_7994): the 7-block BOX (not a
  //     sphere), reused across every mob it reassigns.
  //   `LeashKnotEntity` (obf `bld`) — `getOrCreate`/`interact`/`canStayAttached`, and
  //     `AbstractDecorationEntity.tick`'s own 100-tick `obstructionCheckCounter` poll, which is
  //     what actually notices a broken fence (there is no block-break event in vanilla's own
  //     leash code either — it is checked, not pushed).
  Tm.LEASH_ITEM = 'lead';

  /**
   * `MobEntity.canBeLeashedBy` (method_5931): `!isLeashed() && !(this instanceof Monster)`.
   * `Monster` is a Java INTERFACE (`HostileEntity implements Monster`, read off
   * `.decomp/net/minecraft/entity/mob/HostileEntity.java`); of the species `Ai.ROSTER`
   * (07k_goals.js) actually spawns with AI, `ZombieEntity`/`AbstractSkeletonEntity`/
   * `SpiderEntity` each `extends HostileEntity` (each file's own class line, read by hand) and
   * nothing else in the roster does — cow/wolf/cat/ocelot/horse/villager/iron_golem all leash.
   * A species this table has never heard of (this engine's roster is not vanilla's whole 113)
   * refuses the same way an unmapped item name refuses elsewhere in this file: not tamable is
   * not a default, it is silence.
   */
  Tm.MONSTER = { piglin: true, ender_dragon: true, shulker: true };   // + Spawn.PEACEFUL_DISALLOWED below
  Tm.isMonster = function (t) {   // every `Monster`; ZoglinEntity (HostileEntity) overrides canBeLeashedBy back to true
    return !!Tm.MONSTER[t] || (t !== 'zoglin' && !!(NS.Spawn && NS.Spawn.PEACEFUL_DISALLOWED && NS.Spawn.PEACEFUL_DISALLOWED[t]));
  };
  /** `canBeLeashedBy` false outright: Panda, Turtle, and WaterCreatureEntity's fish subclasses
   *  (cod/salmon/tropical_fish/pufferfish). SquidEntity/Dolphin/Axolotl override it back to true. */
  Tm.NO_LEASH = { panda: true, turtle: true, cod: true, salmon: true, tropical_fish: true, pufferfish: true,
    bat: true, villager: true, wandering_trader: true };   // AmbientEntity / MerchantEntity
  Tm.isLeashed = function (e) { return !!(e && e.leashHolder); };
  Tm.canLeash = function (e) {
    return !!(e && !e.removed && !Tm.isLeashed(e) && !Tm.isMonster(e.type) && !Tm.NO_LEASH[e.type] &&
      !(e.type === 'wolf' && e.angerTime > 0));   // WolfEntity.canBeLeashedBy: !hasAngerTime()
  };

  /**
   * The registry name of a held item, WITHOUT depending on `Breed` being ready — `Br.
   * itemNameOf`'s own logic (07m_breed.js), kept in step by hand rather than imported, so a
   * lead is still recognised even in a headless caller that never initialised Breed.
   */
  Tm.itemNameOf = function (stack) {
    if (!stack) return '';
    if (typeof stack === 'function') { try { stack = stack(); } catch (err) { return ''; } }
    if (!stack) return '';
    if (typeof stack === 'string') return stack;
    var IT = NS.Items;
    if (IT && stack.i !== undefined && stack.i >= 0) return IT.nameOf(stack.i) || '';
    return '';
  };

  /**
   * `e.leashHolder` is `null`, `{kind:'player'}` or `{kind:'knot', knot}` — this engine's one
   * live player stands in for vanilla's arbitrary `Entity holdingEntity` (the same single-
   * player-player standing simplification `Tm.OWED`'s own multiplayer line already states).
   * `MobEntity.attachLeash(Entity, boolean)` (method_5954) — the boolean is a network
   * broadcast flag, meaningless with no second client, so it is not carried at all.
   */
  Tm.leashToHolder = function (e, holder) {
    if (!Tm.canLeash(e)) return false;
    e.leashHolder = holder;
    return true;
  };
  Tm.leashToPlayer = function (e) { return Tm.leashToHolder(e, { kind: 'player' }); };

  /**
   * `MobEntity.detachLeash(boolean broadcast, boolean dropItem)` (method_5932) — `dropItem`
   * only (the broadcast argument is the same no-op the attach side drops). `Items.field_8719`
   * is `minecraft:lead`, dropped at the mob's own centre the way `EL.dropStack` already drops
   * every other loose item (D-266's `Tame.dyeCollar`-neighbouring idiom, not a new one).
   */
  Tm.unleash = function (e, dropItem) {
    if (!e || !e.leashHolder) return false;
    e.leashHolder = null;
    if (dropItem !== false) {
      var EL = NS.EntityList, IT = NS.Items;
      var idx = IT ? IT.of(Tm.LEASH_ITEM) : -1;
      if (EL && EL.ready && idx >= 0) EL.dropStack(e.x, e.y + e.height * 0.5, e.z, idx, 1);
    }
    return true;
  };

  /** `MobEntity.interact`'s own FIRST branch: `getHoldingEntity() == player`. Checked by the
   *  use-hook (14l_use.js) BEFORE anything item-specific, which is why it is its own function
   *  rather than folded into `Tm.canLeash`. */
  Tm.holderIsPlayer = function (e) { return !!(e && e.leashHolder && e.leashHolder.kind === 'player'); };

  var leashHolderPos = function (holder) {
    if (!holder) return null;
    if (holder.kind === 'player') { var P = NS.Player; return P ? [P.x, P.y, P.z] : null; }
    if (holder.kind === 'knot') return (holder.knot && !holder.knot.removed) ? [holder.knot.x, holder.knot.y, holder.knot.z] : null;
    if (holder.kind === 'entity') { var he = holder.entity; return (he && !he.removed && !he.dead) ? [he.x, he.y, he.z] : null; }
    return null;
  };
  var leashHolderAlive = function (holder) {
    if (!holder) return false;
    if (holder.kind === 'player') return !!NS.Player;
    if (holder.kind === 'knot') return !!(holder.knot && !holder.knot.removed);
    if (holder.kind === 'entity') return !!(holder.entity && !holder.entity.removed && !holder.entity.dead);
    return false;
  };

  Tm.LEASH_BREAK_DIST = 10;     // PathAwareEntity.updateLeash: `$$1 > 10.0F`
  Tm.LEASH_PULL_DIST = 6;       // PathAwareEntity.updateLeash: `$$1 > 6.0F`
  Tm.LEASH_APPROACH_STOP = 2;   // `Math.max($$1 - 2.0F, 0.0F)` — how short of the holder it walks
  Tm.LEASH_PULL_ACCEL = 0.4;    // the `* 0.4` in `copySign($$2 * $$2 * 0.4, $$2)`

  /**
   * `PathAwareEntity.updateLeash` (method_5995), the whole method, in vanilla's own order:
   *   1. `MobEntity.updateLeash`'s own `super` call — holder dead (or this mob dead) detaches
   *      WITH a drop (`detachLeash(true, true)`), before any distance is even measured.
   *   2. a sitting `TameableEntity` only ever gets the break check; the pull/approach code
   *      below never runs on it (`isInSittingPose()`'s own early `return`).
   *   3. `dist > 10` breaks (drop, same call as step 1).
   *   4. `6 < dist <= 10` PULLS: `setVelocity(getVelocity().add(copySign(dx²·0.4,dx), ...))`
   *      on each axis, where `dx/dy/dz` are the UNIT direction components (`($$0.getX() -
   *      this.getX()) / dist`, one division, reused on all three axes — read exactly, not a
   *      normalised-then-scaled guess).
   *   5. `dist <= 6` re-enables the mob's own MOVE goal and asks its pathfinder to walk to a
   *      point 2 blocks short of the holder, at `getRunFromLeashSpeed()` (1.0; LlamaEntity overrides it
   *      to 2.0 — `Tm.RUN_FROM_LEASH`). This engine has no A* substrate outside `Ai`'s own goals
   *      (`Ai.OWED`, 07k_goals.js), so it is approximated as a straight-line velocity nudge
   *      toward that same point, capped at the type's own EXTRACTED movement-speed attribute
   *      (`NS.Entities.attrsOf(type).speed`, `tools/extract-entities.mjs` — a real jar number,
   *      not an invented one) rather than vanilla's real pathfinder. Real pathfinding stays
   *      named below in `Tm.OWED`.
   */
  Tm.RUN_FROM_LEASH = { llama: 2.0, trader_llama: 2.0 };  // LlamaEntity.getRunFromLeashSpeed
  Tm.updateLeash = function (e) {
    if (!e || !e.leashHolder || e.removed) return;
    if (!leashHolderAlive(e.leashHolder)) { Tm.unleash(e, true); return; }
    var hp = leashHolderPos(e.leashHolder);
    if (!hp) { Tm.unleash(e, true); return; }
    var dx = hp[0] - e.x, dy = hp[1] - e.y, dz = hp[2] - e.z;
    var fr = Math.fround;   // Entity.distanceTo is float maths: (float)dx.. squared and summed in float, float sqrt
    var dist = fr(Math.sqrt(fr(fr(fr(fr(dx) * fr(dx)) + fr(fr(dy) * fr(dy))) + fr(fr(dz) * fr(dz)))));
    if (e.sitting) {
      if (dist > Tm.LEASH_BREAK_DIST) Tm.unleash(e, true);
      return;
    }
    if (dist > Tm.LEASH_BREAK_DIST) { Tm.unleash(e, true); return; }
    if (dist < 1e-6) return;
    if (dist > Tm.LEASH_PULL_DIST) {
      var ux = dx / dist, uy = dy / dist, uz = dz / dist;
      var sign = function (v) { return v < 0 ? -1 : (v > 0 ? 1 : 0); };
      e.vx += sign(ux) * (ux * ux * Tm.LEASH_PULL_ACCEL);
      e.vy += sign(uy) * (uy * uy * Tm.LEASH_PULL_ACCEL);
      e.vz += sign(uz) * (uz * uz * Tm.LEASH_PULL_ACCEL);
    } else if (dist > Tm.LEASH_APPROACH_STOP) {
      var short = dist - Tm.LEASH_APPROACH_STOP;
      var Ent = NS.Entities, attrs = Ent && Ent.attrsOf ? Ent.attrsOf(e.type) : null;
      var spd = (attrs && attrs.speed) || 0.2;
      var step = Math.min(short, spd * (Tm.RUN_FROM_LEASH[String(e.type).replace('minecraft:', '')] || 1));
      var nx = dx / dist, nz = dz / dist;
      e.vx += nx * step;
      e.vz += nz * step;
    }
  };

  // ── LEASH KNOTS (`LeashKnotEntity`, obf `bld`) ─────────────────────────────────────────────
  Tm.knots = [];
  Tm.nextKnotId = 1;
  Tm.FENCE_RADIUS = 7;          // both `LeadItem.attachHeldMobsToBlock` and `LeashKnotEntity.
                                 // interact` build the SAME `new Box(..-7 .. +7)`, a BOX not a
                                 // sphere — the jar's own Box ctor, read by hand.
  Tm.KNOT_CHECK_INTERVAL = 100; // `AbstractDecorationEntity.tick`'s own `obstructionCheckCounter`

  /** `LeashKnotEntity.getOrCreate` (method_6932) — reuse the knot already at this exact block,
   *  or make one. Vanilla searches a 1-block box for an EXISTING knot at the SAME block pos
   *  (`getDecorationBlockPos().equals(pos)`); one knot per cell is the same outcome without the
   *  extra box scan, since this engine never has two knots share a cell either. */
  Tm.knotSound = function (knot, id) {
    if (NS.Sound && NS.Sound.play) NS.Sound.play(id, { x: knot.x, y: knot.y, z: knot.z, source: 'neutral', volume: 1, pitch: 1 });
  };
  Tm.getOrCreateKnot = function (bx, by, bz) {
    for (var i = 0; i < Tm.knots.length; i++) {
      var k = Tm.knots[i];
      if (!k.removed && k.bx === bx && k.by === by && k.bz === bz) return k;
    }
    // `AbstractDecorationEntity.updateAttachmentPosition`: `pos + (0.5, 0.375, 0.5)`.
    var knot = {
      id: Tm.nextKnotId++, bx: bx, by: by, bz: bz,
      x: bx + 0.5, y: by + 0.375, z: bz + 0.5,
      width: 0.375, height: 0.5,
      removed: false, obstructionCounter: 0
    };
    Tm.knots.push(knot);
    Tm.knotSound(knot, 'entity.leash_knot.place');   // LeashKnotEntity.onPlace: volume 1, pitch 1
    return knot;
  };

  /** `LeadItem.attachHeldMobsToBlock` (method_7994) — every mob currently leashed to the
   *  PLAYER within the 7-block box of (bx,by,bz) is reassigned to one shared new knot there.
   *  Returns whether anything moved (vanilla's `ActionResult.SUCCESS` vs `PASS` — the caller,
   *  `LeadItem.useOnBlock`, never spends the lead in hand either way: only the ORIGINAL
   *  player-attach spends one). */
  Tm.attachHeldMobsToBlock = function (bx, by, bz) {
    var EL = NS.EntityList;
    if (!EL || !EL.ready) return false;
    var R = Tm.FENCE_RADIUS, knot = null, any = false, list = EL.list;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.removed || !Tm.holderIsPlayer(e)) continue;
      // `new Box((double)bx - 7, (double)by - 7, (double)bz - 7, ..+7)` -- the RAW BlockPos
      // ints, NOT the block's own centre (`getOrCreateKnot`'s `+0.5` is a DIFFERENT number,
      // the knot ENTITY's own attachment point, not this search box's origin).
      if (Math.abs(e.x - bx) > R || Math.abs(e.y - by) > R || Math.abs(e.z - bz) > R) continue;
      if (!knot) knot = Tm.getOrCreateKnot(bx, by, bz);
      e.leashHolder = { kind: 'knot', knot: knot };
      any = true;
    }
    return any;
  };

  /** `LeashKnotEntity.interact` — right-click ON the knot. Reassigns every mob leashed to the
   *  clicking player within the same 7-block box; if NONE moved, the knot is discarded, and
   *  (creative only) every mob still leashed to IT is detached right away, with no drop
   *  (`detachLeash(true, false)`). Outside creative the drop is not skipped here — it happens
   *  on each of those mobs' own next `Tm.updateLeash`, which sees its holder (the now-removed
   *  knot) dead and runs the ordinary break-and-drop path, exactly the way a fence breaking
   *  under an unattended knot does. Returns `true` unconditionally (`ActionResult.CONSUME`). */
  Tm.interactKnot = function (knot, creative) {
    if (!knot || knot.removed) return false;
    var EL = NS.EntityList;
    var R = Tm.FENCE_RADIUS, any = false, list = EL && EL.ready ? EL.list : [];
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.removed || !Tm.holderIsPlayer(e)) continue;
      if (Math.abs(e.x - knot.x) > R || Math.abs(e.y - knot.y) > R || Math.abs(e.z - knot.z) > R) continue;
      e.leashHolder = { kind: 'knot', knot: knot };
      any = true;
    }
    if (!any) {
      knot.removed = true;
      if (creative) {
        for (var j = 0; j < list.length; j++) {
          var m = list[j];
          if (!m.removed && m.leashHolder && m.leashHolder.kind === 'knot' && m.leashHolder.knot === knot) {
            Tm.unleash(m, false);
          }
        }
      }
    }
    return true;
  };

  /** `LeashKnotEntity.canStayAttached` — the block the knot sits on must still carry the
   *  `fences` tag (`tools/tagcheck.mjs` already proves that tag's own membership; this only
   *  asks it). `Tags.blockTag('fences')` is resolved once, in `Tm.init`, and cached. */
  Tm.knotCanStayAttached = function (knot) {
    var W = NS.World, Tags = NS.Tags;
    if (!W || !Tags || !Tags.ready || Tm._fencesCol < 0) return true;
    var st = W.getBlock(knot.bx, knot.by, knot.bz);
    return Tags.stateInCol ? Tags.stateInCol(Tm._fencesCol, st) : true;
  };

  /**
   * ONE call per game tick (hooked from `EntityList.tick`, 07i_entitylist.js — the single
   * cross-file line this unit adds there): every currently-leashed mob's physics, and every
   * knot's 100-tick `canStayAttached` poll. Knots that fail the poll are marked removed; the
   * mob(s) still holding them see it on their OWN next `Tm.updateLeash` call THIS SAME PASS
   * (this loop runs the mob list before the knot list) or the next tick, and drop a lead each
   * — "breaking the fence drops [a lead]" is this path, not a block-break event hook.
   */
  Tm.tickLeash = function () {
    var EL = NS.EntityList;
    if (EL && EL.ready) {
      var list = EL.list;
      for (var i = 0; i < list.length; i++) {
        var e = list[i];
        if (!e.removed && e.leashHolder) Tm.updateLeash(e);
      }
    }
    var w = 0;
    for (var k = 0; k < Tm.knots.length; k++) {
      var knot = Tm.knots[k];
      if (knot.removed) continue;
      // `obstructionCheckCounter++ == 100`: compare BEFORE the increment, so the first poll is the 101st tick
      if ((knot.obstructionCounter = (knot.obstructionCounter || 0)) !== Tm.KNOT_CHECK_INTERVAL) knot.obstructionCounter++;
      else {
        knot.obstructionCounter = 0;
        if (!Tm.knotCanStayAttached(knot)) { knot.removed = true; Tm.knotSound(knot, 'entity.leash_knot.break'); }   // discard() + onBreak(null)
      }
      if (!knot.removed) Tm.knots[w++] = knot;
    }
    Tm.knots.length = w;
  };

  /**
   * The nearest leash knot a ray from (ox,oy,oz) toward (dx,dy,dz) hits within `reach`, or
   * null — knots carry no `EntityList` row (there is no `entity-motion` table entry for
   * `leash_knot`, D-427's own table, so `EL.spawn` refuses it outright; a static decoration
   * has nothing to simulate), so they are not in `Cb.pick`'s own candidate list and need their
   * own tiny ray test. Reuses `Cb.rayBox`, the same slab method, rather than a second copy.
   */
  Tm.pickKnot = function (ox, oy, oz, dx, dy, dz, reach) {
    var Cb = NS.Combat;
    if (!Cb || !Cb.rayBox) return null;
    var best = null, bestT = reach;
    for (var i = 0; i < Tm.knots.length; i++) {
      var k = Tm.knots[i];
      if (k.removed) continue;
      var hw = k.width * 0.5;
      var t = Cb.rayBox(ox, oy, oz, dx, dy, dz,
                         k.x - hw, k.y, k.z - hw, k.x + hw, k.y + k.height, k.z + hw);
      if (t === null || t > bestT) continue;
      bestT = t; best = k;
    }
    return best ? { knot: best, t: bestT } : null;
  };

  Tm.OWED = [
    // struck (QUEUE 0.2, Tame/Breed remainder) — D-497 added an invisibility status effect
    // (src/07q_effects.js, ES.hasStatusEffect); the wolf/cat collar's own !isInvisible() gate
    // is now wired at its render site (src/07j_entityrender.js, the collar overlay push).
    // struck: leashing — 07u_leash.js (QUEUE 0.2, session 92).
    'multiplayer ownership (e.owner is a single flag, "the one live player" — same standing ' +
      'simplification EL.aiCtx\'s own header states; D-477\'s own Ai.OwnerHurtByTargetGoal/' +
      'Ai.OwnerHurtTargetGoal already read through getPlayers()[0] rather than e.owner directly, ' +
      'so this is the one line left to widen the day there is a second player)',
    // parrot taming struck (QUEUE 0.2 "G18e remainder", 07t_fly.js's own Fl.feed/
    // Fl.feedCookie/Fl.toggleSit -- outside Tm.TAMABLE, its own separate roll/food table).
    'ocelot taming, which does not exist in vanilla 1.18.2 at all (see header)',
    // struck (loop/nametag, this session) -- `NameTagItem`'s own `setPersistent()` call
    // (.decomp/net/minecraft/item/NameTagItem.java:20 -- applying a name tag to any MobEntity)
    // now has its matching ACTION: `Use.entityUse`'s own final fallback (14l_use.js, the
    // `itemName === 'name_tag'` branch) sets `e.customName` and `e.persistent = true` together,
    // exactly as `NameTagItem.useOnEntity` does. `e.persistent`'s own DEFAULT/ROLL/save
    // round-trip (EL.mobStateDefaults, 07i_entitylist.js; COMMON, 07zw_mobnbt.js) was already
    // real before this session closed the one action that SETS it; `LeadItem`/trading still do
    // not call `setPersistent()` in vanilla 1.18.2 at all, confirmed against `.decomp` again
    // this pass (only NameTagItem and VillagerEntity's own lightning-conversion branch do).
    // struck (loop/mobpickup, s113) -- `Mob.pickupItem` (MobEntity.java:519-540) is real:
    // Eq.tickPickup/Eq.loot/Eq.tryEquip (07y_equip.js), hooked from EL.tickMob; residue on Eq.OWED.
  ];

})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
