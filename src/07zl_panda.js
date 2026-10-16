// 07zl_panda.js — loop/panda-axolotl-s101 (QUEUE 0.2 G18c, missing overworld mob): the PANDA,
// whole. Runs on: MAIN THREAD ONLY. No DOM.
//
// Everything below is read off `.decomp/net/minecraft/entity/passive/PandaEntity.java` (1134
// lines, read in full this session) unless a comment says otherwise. Dimensions ([1.3, 1.25]),
// the two attributes (MAX_HEALTH 20.0, MOVEMENT_SPEED 0.15 — `createPandaAttributes`'s own
// `.add(MOVEMENT_SPEED, 0.15F)`, ATTACK_DAMAGE 6.0 — its own `.add(ATTACK_DAMAGE, 6.0)`) and
// the breeding food (bamboo — `PandaEntity.isBreedingItem`) are NOT re-declared here: they come
// out of the jar-bytecode-extracted entity table generically (`NS.Entities.attrsOf('panda')`/
// `NS.Entities.breedFood('panda')`), the same "a constant here would be a D-263" standing
// `07zj_goat.js`'s own header already states — `pandacheck` asserts those rows directly against
// `assets/entities.json` rather than duplicating a number the table already owns.
//
// WHAT IS HERE, PER THE UNIT'S OWN SPEC:
//   1. `Pd.canSpawn`/`Spawn.RULES.panda` (07l_spawn.js's own one-line hook) — PANDA HAS NO
//      `canSpawn` OVERRIDE OF ITS OWN (`.decomp`, read in full — grepped for it, none present):
//      it falls all the way through to `AnimalEntity.isValidNaturalSpawn` verbatim, the SAME
//      `#minecraft:animals_spawnable_on` + `isLightLevelValidForNaturalSpawn` rule `cow`'s own
//      `Spawn.RULES.cow` already implements — `Spawn.RULES.panda` is that SAME function object,
//      shared, not retyped (§ SPAWN). Which BIOME ever offers a panda (bamboo_jungle/jungle) is
//      the biome's own spawner-list weight, read generically off `assets/` the same way every
//      other rostered animal's biome placement already is (07zj_goat.js's own header names the
//      identical split between "can this block+light host it" and "does a biome even try").
//   2. genes: `Pd.Gene` (the 7-value table, `createRandom`'s own 16-roll and `getProductGene`'s
//      own recessive/dominant fold), `Pd.rollGenes`/`Pd.initGenes` (spawn/breeding rolls,
//      `PandaEntity.initialize`/`initGenes`, verbatim including the two independent 1/32
//      mutation rolls) and the five `isX` readers (§ GENES)
//   3. `Ai.ROSTER.panda` (07k_goals.js) — `initGoals` folded onto `GoalSelector` (this engine's
//      ONLY goal substrate, same standing as every prior QUEUE 0.2 mob): `SwimGoal`->
//      `Ai.FloatGoal`, `PandaEscapeDangerGoal`->`Ai.PanicGoal`, `PandaMateGoal`->`Pd.MateGoal` (bamboo gate over `Ai.BreedGoal`),
//      `TemptGoal`(bamboo)->`Ai.TemptGoal`, `PandaFleeGoal`(player)/(hostile)->TWO
//      `Ai.AvoidEntityGoal`s gated on `Pd.isWorried`, `LookAtEntityGoal`->`Ai.LookAtPlayerGoal`,
//      `LookAroundGoal`->`Ai.RandomLookAroundGoal`, `FollowParentGoal`/`WanderAroundFarGoal`->
//      the same generic goals every other rostered animal uses. `Pd.AttackGoal`/
//      `Pd.RevengeGoal` (§ ATTACK/REVENGE) are this file's own two bespoke goals, for the one
//      pair `GoalSelector` has no generic equivalent of.
//   4. `Pd.SneezeGoal`/`Pd.sneeze` — a baby's own sneeze roll (weak: 1/500, else 1/6000), the
//      particle-less consequence (nearby non-baby, grounded, dry, idle pandas jump — `Pd.jump`
//      hook) and the 1/700 slime_ball drop (§ SNEEZE)
//   5. `Pd.LieOnBackGoal` — the lazy-gene lying-on-back idle animation trigger (§ LIE ON BACK)
//   6. breeding: `Breed.CHILD.panda`/`Breed.SPECIAL.panda` removed (07m_breed.js, this unit's
//      own registration line) — `Pd.createChild` IS `initGenes`, verbatim
//   7. `EL.motionFor('panda')`/`EL.DEFAULTS.panda` (07i_entitylist.js, this unit's own
//      registration lines) — the gravity/drag fallback and the spawn-time gene roll
//
// NOT HERE (this unit's own OWED, at the bottom, `Pd.OWED`):
//   (#923 closed: PandaEscapeDangerGoal = Ai.PanicGoal with inDanger=on fire, stopWhen=sitting.)
//   - `PickUpFoodGoal`/`PlayGoal` (carrying a dropped bamboo/cake home, the baby/playful
//     rolling-jump animation) — no generic "pick up and carry a mainhand item" goal beyond
//     fox's own bespoke one exists at the scope this pass had time for; named here rather than
//     forked a third time.
//   - sitting/eating held food, `interactMob`'s own hand-feeding-while-sitting branch
//     (`stop()`/`setEating`/`equipStack`) — this engine's generic `Br.interact` (love mode +
//     grow-up) is what a bamboo interaction runs instead, the same fallback every other
//     rostered animal's non-milk/non-saddle feed path already uses.
//   - every sound, every animation progress float (`sittingAnimationProgress`,
//     `lieOnBackAnimationProgress`, `rollOverAnimationProgress`), the eating-particle spray —
//     no rostered goal in this codebase plays a sound or drives a render-only float yet
//     (`07zj_goat.js`/`07zh_rabbit.js` own the same standing gap, `Ai.OWED`).
//   - `resetAttributes` (a weak panda's max health rolled down to 10, a lazy panda's move speed
//     rolled down to 0.07) — this engine's attribute table (`Ent.attrsOf`) is read-only shared
//     data, not a per-entity override substrate; no rostered mob overrides its own base
//     attribute post-spawn anywhere in this codebase yet.
//   - `canEquip`, (the mainhand-food render layer is ER.pandaHeldItems, #1136)
//     (damage()'s sitting-cancel: done, Cb.hurt) — minor, and downstream of the PickUpFoodGoal gap above.
//   - `PandaRevengeGoal`'s own `setGroupRevenge`/`setMobEntityTarget` (an aggressive panda
//     nearby joins a fight another aggressive panda started) — `Pd.RevengeGoal` below is a
//     single-panda goal only, no pack-alert substrate.

(function (NS) {
  'use strict';
  // fallback stream when a caller passes no rng: the entity list's, else a fixed-seed JRandom (never Math.random, #6438)
  var fbR = null;
  function RNDFB() { var L = NS.EntityList; if (L && L.random) return L.random(); if (!fbR) fbR = new NS.JRandom(0x6438); return fbR.nextDouble(); }

  var Pd = NS.Panda = {};

  Pd.OWED = [
    'canEquip/the mainhand-food render layer -- ' +
      'minor, and downstream of the PickUpFoodGoal gap above.',
    'PandaRevengeGoal: none owed (#928).'
  ];

  Pd.ready = true;

  // ── § RENDER PROGRESS FLOATS — `PandaEntity.update{Sitting,LieOnBack,RollOver}Animation` + `updatePlaying`
  // (.decomp PandaEntity.java :436-461, :474-477): +0.15 clamped to 1 while the flag holds, -0.19 clamped to 0
  // otherwise; `last*` is the previous tick's value (the renderer lerps last->current by partialTick).
  // `playingTicks` counts 1..32 while `playing`, else resets to 0 (tick() :359-361).
  // #4511: vanilla runs the counter (in updatePlaying) BEFORE the three floats, which run LAST in tick().
  Pd.tickPlayTicks = function (e) {
    if (e.playing) {
      e.playingTicks = (e.playingTicks | 0) + 1;
      if (e.playingTicks > 32) e.playing = false;
    } else e.playingTicks = 0;
  };
  // PandaEntity.tick :363-365 -- after super.tick (LookControl), a sitting panda's pitch is zeroed.
  Pd.tickSitPitch = function (e) { if (e.sitting) e.pitch = 0; };

  Pd.tickAnim = function (e) {
    if (!e) return;
    e.lastSitProg = e.sitProg || 0;
    e.lastLieProg = e.lieProg || 0;
    e.lastRollProg = e.rollProg || 0;
    e.sitProg = e.sitting ? Math.min(1, (e.sitProg || 0) + 0.15) : Math.max(0, (e.sitProg || 0) - 0.19);
    e.lieProg = e.lyingOnBack ? Math.min(1, (e.lieProg || 0) + 0.15) : Math.max(0, (e.lieProg || 0) - 0.19);
    e.rollProg = e.playing ? Math.min(1, (e.rollProg || 0) + 0.15) : Math.max(0, (e.rollProg || 0) - 0.19);
  };

  // ── § SPAWN ──────────────────────────────────────────────────────────────────────────────
  // No `canSpawn` override in the jar (grepped `.decomp/net/minecraft/entity/passive/
  // PandaEntity.java` for it, none) -- falls through to `AnimalEntity.isValidNaturalSpawn`,
  // wired as `Spawn.RULES.panda = Spawn.RULES.cow` (07l_spawn.js, the same shared-function-
  // object precedent `Spawn.RULES.sheep = Spawn.RULES.chicken = Spawn.RULES.pig = Spawn.RULES.
  // cow` already sets).

  // ── § GENES — `PandaEntity.Gene` (.decomp lines ~700-770), verbatim ────────────────────────
  Pd.Gene = {
    NORMAL: 0, LAZY: 1, WORRIED: 2, PLAYFUL: 3, BROWN: 4, WEAK: 5, AGGRESSIVE: 6
  };
  Pd.GENE_NAMES = ['normal', 'lazy', 'worried', 'playful', 'brown', 'weak', 'aggressive'];
  // `Gene.recessive` -- only brown(4) and weak(5) are recessive; every other gene is dominant.
  Pd.GENE_RECESSIVE = [false, false, false, false, true, true, false];

  Pd.geneName = function (id) { return Pd.GENE_NAMES[id | 0] || Pd.GENE_NAMES[0]; };
  Pd.geneByName = function (name) {
    var i = Pd.GENE_NAMES.indexOf(name);
    return i < 0 ? Pd.Gene.NORMAL : i;
  };

  /** `Gene.createRandom(Random)` (.decomp lines 762-776), verbatim `nextInt(16)` switch:
   *  0->lazy, 1->worried, 2->playful, 4->aggressive, [3,9)->weak, [9,11)->brown, [11,16)->normal.
   *  Read the jar's own `if` chain literally, not "everything else is evenly split": roll 3
   *  falls into the weak band (6 of 16 rolls are weak in total), only 2 of 16 are brown, and
   *  only [11,16) -- 5 of 16 -- is normal. */
  Pd.randomGene = function (rnd) {
    rnd = rnd || RNDFB;
    var n = Math.floor(rnd() * 16);
    if (n === 0) return Pd.Gene.LAZY;
    if (n === 1) return Pd.Gene.WORRIED;
    if (n === 2) return Pd.Gene.PLAYFUL;
    if (n === 4) return Pd.Gene.AGGRESSIVE;
    if (n < 9) return Pd.Gene.WEAK;
    if (n < 11) return Pd.Gene.BROWN;
    return Pd.Gene.NORMAL;
  };

  /** `Gene.getProductGene(main, hidden)` (.decomp lines 733-739), verbatim: a RECESSIVE main
   *  gene only expresses when the hidden gene matches it exactly; a DOMINANT main gene always
   *  expresses, whatever the hidden gene is. */
  Pd.productGene = function (main, hidden) {
    if (Pd.GENE_RECESSIVE[main | 0]) return (main === hidden) ? main : Pd.Gene.NORMAL;
    return main | 0;
  };

  // #918 -- `PandaEntityRenderer.getTexture`: one sheet per PRODUCT gene, Gene ordinal order;
  // `extract-mob-textures.mjs`'s `panda` family bakes them in that order (index 0 = panda.png).
  Pd.SKIN = ['panda', 'panda#1', 'panda#2', 'panda#3', 'panda#4', 'panda#5', 'panda#6'];
  Pd.skinKey = function (e) {
    if (!e || NS.Entities.bare(e.type) !== 'panda') return null;
    return Pd.SKIN[Pd.productGene(e.mainGene | 0, e.hiddenGene | 0)] || Pd.SKIN[0];
  };
  Pd.isLazy = function (e) { return e && Pd.productGene(e.mainGene | 0, e.hiddenGene | 0) === Pd.Gene.LAZY; };
  Pd.isWorried = function (e) { return e && Pd.productGene(e.mainGene | 0, e.hiddenGene | 0) === Pd.Gene.WORRIED; };
  Pd.isPlayful = function (e) { return e && Pd.productGene(e.mainGene | 0, e.hiddenGene | 0) === Pd.Gene.PLAYFUL; };
  Pd.isBrown = function (e) { return e && Pd.productGene(e.mainGene | 0, e.hiddenGene | 0) === Pd.Gene.BROWN; };
  Pd.isWeak = function (e) { return e && Pd.productGene(e.mainGene | 0, e.hiddenGene | 0) === Pd.Gene.WEAK; };
  Pd.isAttacking = function (e) { return e && Pd.productGene(e.mainGene | 0, e.hiddenGene | 0) === Pd.Gene.AGGRESSIVE; };

  /** `initialize` (.decomp lines 543-553): a fresh natural/egg/command spawn rolls BOTH genes
   *  independently. Wired as `EL.DEFAULTS.panda` (07i_entitylist.js). */
  Pd.rollGenes = function (e, rnd) {
    if (!e) return;
    rnd = rnd || RNDFB;
    e.mainGene = Pd.randomGene(rnd);
    e.hiddenGene = Pd.randomGene(rnd);
    Pd.resetAttributes(e);
  };

  /** `initGenes(a, b)` (.decomp lines 553-575), verbatim, including the trailing INDEPENDENT
   *  1/32 mutation roll on EACH slot (so a child can mutate main, hidden, both, or neither,
   *  after the parent-inheritance coin flips already ran). `b` may be null (a solo `createChild`
   *  call with no second parent, per the jar's own signature) -- this file's own caller
   *  (`Breed.CHILD.panda`, 07m_breed.js) always passes both real parents, so that branch is
   *  reachable but not exercised by this engine's one live call site; kept because dropping it
   *  would silently narrow a public function's own contract. */
  Pd.initGenes = function (child, a, b, rnd) {
    rnd = rnd || RNDFB;
    function randomGeneOf(p) { return (rnd() < 0.5) ? p.mainGene | 0 : p.hiddenGene | 0; }
    if (!b) {
      if (rnd() < 0.5) { child.mainGene = randomGeneOf(a); child.hiddenGene = Pd.randomGene(rnd); }
      else { child.mainGene = Pd.randomGene(rnd); child.hiddenGene = randomGeneOf(a); }
    } else if (rnd() < 0.5) {
      child.mainGene = randomGeneOf(a); child.hiddenGene = randomGeneOf(b);
    } else {
      child.mainGene = randomGeneOf(b); child.hiddenGene = randomGeneOf(a);
    }
    if (rnd() < 1 / 32) child.mainGene = Pd.randomGene(rnd);
    if (rnd() < 1 / 32) child.hiddenGene = Pd.randomGene(rnd);
  };

  /** `Breed.CHILD.panda` (07m_breed.js, this unit's own registration line) calls straight
   *  through -- `createChild` (.decomp lines 546-553) IS `initGenes`, nothing else. */
  Pd.createChild = function (child, a, b, rand) { Pd.initGenes(child, a, b, rand); Pd.resetAttributes(child); };

  /** `resetAttributes` (.decomp lines 585-593): weak -> max_health base 10, lazy -> movement_speed
   *  base 0.07. Only the BASE moves: `health` is not clamped (vanilla `setBaseValue` never calls
   *  setHealth). `Ai.movementSpeedOf` reads `e.speedAttr`. Called from spawn and createChild. */
  Pd.resetAttributes = function (e) {
    if (!e) return;
    if (Pd.isWeak(e)) e.maxHealth = 10;
    if (Pd.isLazy(e)) e.speedAttr = 0.07;
  };

  /** `isScaredByThunderstorm()`: worried gene AND a thunderstorm (`Sky.isThundering`). */
  /** `World.isThundering()` via `Sky` (absent in node checks -> false; `Pd.thundering` overrides). */
  Pd.thundering = null;
  Pd.isThundering = function () {
    if (typeof Pd.thundering === 'function') return !!Pd.thundering();
    return !!(NS.Sky && NS.Sky.isThundering && NS.Sky.isThundering());
  };
  /** `isScaredByThunderstorm`: `isWorried() && world.isThundering()`. */
  Pd.isScaredByThunderstorm = function (e) { return Pd.isWorried(e) && Pd.isThundering(); };
  /** `tick()`'s worried branch (.decomp 320-326): thunder + dry -> sit, stop eating; else stand
   *  unless eating. */
  Pd.tickWorried = function (e) {
    if (!Pd.isWorried(e)) return;
    if (Pd.isThundering() && !e.inWater) { e.sitting = true; e.eating = false; e.eatingTicks = 0; }
    else if (!e.eating) e.sitting = false;
  };

  // ── § VOICE — PandaEntity getAmbientSound/getHurtSound/getDeathSound/playStepSound/tryAttack/
  //    tick (pre_sneeze at progress 1)/sneeze()/playEatingAnimation ──────────────────────────────
  Pd.SOUND = { ambient: 'entity.panda.ambient', aggressive: 'entity.panda.aggressive_ambient',
               worried: 'entity.panda.worried_ambient', hurt: 'entity.panda.hurt', death: 'entity.panda.death',
               step: 'entity.panda.step', bite: 'entity.panda.bite', eat: 'entity.panda.eat',
               preSneeze: 'entity.panda.pre_sneeze', sneeze: 'entity.panda.sneeze' };
  Pd.playSound = function (e, ev, volume, pitch) {
    var MV = NS.MobVoice;
    if (!NS.Sound || !NS.Sound.play || e.silent || (MV && MV.GATED && !MV.AUDITED[e.type])) return false;   // #4003: silent until audited
    if (pitch === undefined) pitch = (RNDFB() - RNDFB()) * 0.2 + ((e.isBaby || e.baby || (e.growAge | 0) < 0) ? 1.5 : 1);   // LivingEntity.getSoundPitch
    return NS.Sound.play(ev, { x: e.x, y: e.y, z: e.z, volume: volume === undefined ? 1 : volume, pitch: pitch, source: 'neutral' });
  };
  /** `playEatingAnimation`: every 5th eating tick, volume 0.5 + 0.5*nextInt(2). */
  Pd.eatSound = function (e, eatingTicks, rnd) {
    rnd = rnd || RNDFB;
    if (eatingTicks % 5 !== 0) return false;
    return Pd.playSound(e, Pd.SOUND.eat, 0.5 + 0.5 * Math.floor(rnd() * 2), (rnd() - rnd()) * 0.2 + 1);
  };
  Pd.isIdle = function (e) {
    return !!e && !e.lyingOnBack && !Pd.isScaredByThunderstorm(e) && !e.eating && !e.playing && !e.sitting;
  };

  // ── § FOOD / HELD ITEM — `IS_FOOD`, `loot`, `stop`, `updateEatingAnimation` ───────────────────
  Pd.isFoodName = function (name) { return name === 'bamboo' || name === 'cake'; };
  Pd.mainhand = function (e) {
    var Eq = NS.Equip, IT = NS.Items;
    return (Eq && IT && IT.ready) ? Eq.getEquipped(e, IT.MAINHAND) : null;
  };
  Pd.setMainhand = function (e, stack) {
    var Eq = NS.Equip, IT = NS.Items;
    if (Eq && IT && IT.ready) Eq.setEquipped(e, IT.MAINHAND, stack);
  };
  Pd.heldName = function (e) {
    var st = Pd.mainhand(e);
    return st && NS.Items ? NS.Items.nameOf(st.i) : null;
  };
  /** `IS_FOOD` on an item entity: bamboo/cake, alive, !cannotPickup (pickupDelay > 0). */
  Pd.isFoodEntity = function (o) {
    if (!o || o.removed || o.type !== 'item' || !NS.Items) return false;
    if (o.pickupDelay > 0) return false; // cannotPickup(); covers PICKUP_NEVER too
    return Pd.isFoodName(NS.Items.nameOf(o.item));
  };
  Pd.foodNear = function (e, r) {
    var EL = NS.EntityList, out = [];
    if (!EL || !EL.list) return out;
    for (var i = 0; i < EL.list.length; i++) {
      var o = EL.list[i];
      if (!Pd.isFoodEntity(o)) continue;
      // getBoundingBox().expand(r) intersects the item's box (strict, like Box.intersects)
      var hx = r + ((e.width || 0) + (o.width || 0)) / 2;
      if (Math.abs(o.x - e.x) < hx && Math.abs(o.z - e.z) < hx &&
          o.y + (o.height || 0) > e.y - r && o.y < e.y + (e.height || 0) + r) out.push(o);
    }
    return out;
  };
  Pd.dropHeld = function (e) {
    var st = Pd.mainhand(e), EL = NS.EntityList;
    if (!st) return;
    if (EL && EL.dropStack) EL.dropStack(e.x, e.y, e.z, NS.Items.nameOf(st.i), st.n || 1);
    Pd.setMainhand(e, null);
  };
  /** `PandaEntity.stop()`: not in water -> halt and sit. */
  Pd.stop = function (e) {
    if (e.inWater) return;
    e.forwardSpeed = 0; e.navigating = false; e.sitting = true;
  };
  /** `PandaEntity.loot(ItemEntity)`: empty hand + food -> equip it whole, handDropChance 2.0. */
  Pd.loot = function (e, o) {
    if (Pd.mainhand(e) || !Pd.isFoodEntity(o)) return false;
    var Eq = NS.Equip, IT = NS.Items;
    var st = Eq.stackOf(IT.nameOf(o.item));
    if (!st) return false;
    st.n = o.count || 1;
    Pd.setMainhand(e, st);
    Eq.setDropChance(e, IT.MAINHAND, 2.0);
    if (NS.EntityList && NS.EntityList.remove) NS.EntityList.remove(o);
    return true;
  };
  /** `updateEatingAnimation` (.decomp 377-407); `ctx.particle(e, name)` is the 5-tick spray. */
  Pd.updateEating = function (e, ctx) {
    ctx = ctx || {};
    var rand = ctx.random || RNDFB;
    var held = Pd.mainhand(e);
    if (!e.eating && e.sitting && !Pd.isScaredByThunderstorm(e) && held && Math.floor(rand() * 80) === 1) {
      e.eating = true; e.eatingTicks = 1;   // setEating(true): EATING_TICKS=1
    } else if (!held || !e.sitting) {
      e.eating = false; e.eatingTicks = 0;
    }
    if (!e.eating) return;
    if ((e.eatingTicks | 0) % 5 === 0) {
      if (ctx.particle) ctx.particle(e, Pd.heldName(e));
      if (Pd.eatSound) Pd.eatSound(e, e.eatingTicks | 0, rand);   // playEatingAnimation's sound, same 5-tick beat
    }
    if ((e.eatingTicks | 0) > 80 && Math.floor(rand() * 20) === 1) {
      if ((e.eatingTicks | 0) > 100 && Pd.isFoodName(Pd.heldName(e))) {
        Pd.setMainhand(e, null);
        e.sitting = false;
      }
      e.eating = false;
      e.eatingTicks = 0;
      return;
    }
    e.eatingTicks = (e.eatingTicks | 0) + 1;
  };

  // ── § PLAY — `PlayGoal` + `updatePlaying` (.decomp 475-496, 1060-1106) ──────────────────────
  // `Pd.tickPlayTicks` owns the 1..32 `playingTicks` counter (it runs just before this, 07i_entitylist.js); this is the
  // velocity script for the tick that counter names.
  Pd.updatePlaying = function (e) {
    if (!e.playing || !(e.playingTicks >= 1)) return;
    var vx = e.vx || 0, vy = e.vy || 0, vz = e.vz || 0;
    if (e.playingTicks === 1) {
      var k = e.isBaby ? 0.1 : 0.2;
      // engine yaw: forward = (sin y, -cos y) (D-415); vanilla's (-sin, cos) in its own degrees
      e.playingJump = { x: vx + Math.sin(e.yaw || 0) * k, z: vz - Math.cos(e.yaw || 0) * k };
      e.vx = e.playingJump.x; e.vy = 0.27; e.vz = e.playingJump.z;
    } else if (e.playingTicks !== 7 && e.playingTicks !== 15 && e.playingTicks !== 23) {
      if (e.playingJump) { e.vx = e.playingJump.x; e.vz = e.playingJump.z; }
    } else {
      e.vx = 0; e.vz = 0; e.vy = e.onGround ? 0.27 : vy;
    }
  };
  Pd.PlayGoal = function (e, ctx) {
    var rand = (ctx && ctx.random) || RNDFB;
    this.canUse = function () {
      if (!((e.isBaby || Pd.isPlayful(e)) && e.onGround)) return false;
      if (!Pd.isIdle(e)) return false;
      var y = e.yaw || 0;
      var fx = Math.sin(y), fz = -Math.cos(y);
      var dx = Math.abs(fx) > 0.5 ? Math.sign(fx) : 0, dz = Math.abs(fz) > 0.5 ? Math.sign(fz) : 0;
      var W = NS.World;
      if (W && W.getBlock && W.getBlock(Math.floor(e.x) + dx, Math.floor(e.y) - 1, Math.floor(e.z) + dz) === 0) return true;
      return (Pd.isPlayful(e) && Math.floor(rand() * 60) === 1) ? true : Math.floor(rand() * 500) === 1;
    };
    this.canContinueToUse = function () { return false; };
    this.start = function () { e.playing = true; };
    this.stop = function () {};
    this.tick = function () {};
  };

  // ── § PICK UP FOOD — `PickUpFoodGoal` (.decomp 997-1058) ────────────────────────────────────
  Pd.PickUpFoodGoal = function (e, ctx) {
    var rand = (ctx && ctx.random) || RNDFB;
    var startAge = 0, path = null, idx = 1;
    this.canUse = function () {
      if (startAge <= (e.age | 0) && !e.isBaby && !e.inWater && Pd.isIdle(e) && !((e.askForBambooTicks | 0) > 0)) {
        return Pd.foodNear(e, 6).length > 0 || !!Pd.mainhand(e);
      }
      return false;
    };
    this.canContinueToUse = function () {
      if (!e.inWater && (Pd.isLazy(e) || Math.floor(rand() * 600) !== 1)) return Math.floor(rand() * 2000) !== 1;
      return false;
    };
    this.start = function () {
      var items = Pd.foodNear(e, 8);
      if (items.length && !Pd.mainhand(e)) {
        e.pickupTarget = items[0];   // navigation.startMovingTo(item, 1.2): one path, walked each tick
        var it = items[0];
        path = NS.Ai.findPath(e.x, e.y, e.z, it.x, it.y, it.z, { mob: e }); idx = 1;
      } else if (Pd.mainhand(e)) Pd.stop(e);
      startAge = 0;
    };
    this.tick = function () {
      if (!e.sitting && Pd.mainhand(e)) { Pd.stop(e); return; }
      var t = e.pickupTarget;
      if (t && !t.removed && !Pd.mainhand(e)) {
        if (Math.hypot(t.x - e.x, t.y - e.y, t.z - e.z) < 1.5) Pd.loot(e, t);   // `loot()` via mob pickup box
        else if (path && idx < path.length) {
          NS.Ai.stepToward(e, path[idx], 1.2);
          if (NS.Ai.closeTo(e, path[idx])) idx++;
        }
      }
    };
    this.stop = function () {
      e.pickupTarget = null; path = null;
      if (Pd.mainhand(e)) {
        Pd.dropHeld(e);
        var n = Pd.isLazy(e) ? Math.floor(rand() * 50) + 10 : Math.floor(rand() * 150) + 10;
        startAge = (e.age | 0) + n * 20;
      }
      e.sitting = false;
    };
  };

  // ── § INTERACT — `PandaEntity.interactMob` (.decomp 604-650) ────────────────────────────────
  /** `itemName` held by the player. `opts`: {instabuild, consume(n), dropStack(name)} as `Br.interact`.
   *  Returns false for PASS (caller falls through), true when handled. */
  Pd.interact = function (e, itemName, opts) {
    var Br = NS.Breed;
    opts = opts || {};
    if (Pd.isScaredByThunderstorm(e)) return false;
    if (e.lyingOnBack) { e.lyingOnBack = false; return true; }
    if (itemName !== 'bamboo') return false;
    if (e.target) e.shouldGetRevenge = true;
    if (Br.isBaby(e)) {
      if (!opts.instabuild) Br.consume(opts);
      var age = Br.getAge(e);
      Br.ageUp(e, Math.trunc(Math.fround(Math.trunc(-age / 20) * Math.fround(0.1))), true);
    } else if (Br.getAge(e) === 0 && Br.canFallInLove(e)) {
      if (!opts.instabuild) Br.consume(opts);
      Br.lovePlayer(e, opts.player || null);
    } else {
      if (e.sitting || e.inWater) return false;
      Pd.stop(e);
      e.eating = true; e.eatingTicks = 1;
      if (Pd.mainhand(e) && !opts.instabuild) Pd.dropHeld(e);
      Pd.setMainhand(e, NS.Equip.stackOf('bamboo'));
      if (!opts.instabuild) Br.consume(opts);
    }
    return true;
  };

  // ── § SNEEZE — `SneezeGoal` + `PandaEntity.sneeze()` (.decomp lines 500-520, 893-916) ──────
  Pd.SNEEZE_CHANCE_WEAK = 1 / 500;
  Pd.SNEEZE_CHANCE_NORMAL = 1 / 6000;
  Pd.SLIME_BALL_DROP_CHANCE = 1 / 700;

  /** `SneezeGoal.canStart` (.decomp lines 1108-1114), verbatim: baby + idle, then weak rolls
   *  1/500, anything else rolls 1/6000. */
  Pd.SneezeGoal = function (e, ctx) {
    var rand = (ctx && ctx.random) || RNDFB;
    this.canUse = function () {
      if (!e.isBaby || !Pd.isIdle(e)) return false;
      // `isWeak && nextInt(500)==1 ? true : nextInt(6000)==1` -- a failed weak roll still rolls 1/6000
      if (Pd.isWeak(e) && rand() < Pd.SNEEZE_CHANCE_WEAK) return true;
      return rand() < Pd.SNEEZE_CHANCE_NORMAL;
    };
    this.canContinueToUse = function () { return false; };
    this.start = function () { e.sneezing = true; e.sneezeProgress = 0; };
    this.stop = function () {};
    this.tick = function () {};
  };

  /** `tick()`'s own sneeze-progress branch (.decomp lines 346-354) + `sneeze()` (.decomp lines
   *  893-916): 20 ticks of progress, then the consequence -- every OTHER non-baby, grounded, dry,
   *  idle panda within 10 blocks jumps (`Pd.jump`, injected: this engine's jump substrate is
   *  per-caller, not a method on `e`), and a 1/700 roll drops one slime_ball
   *  (`GameRules.DO_MOB_LOOT` gate is `Pd.dropsAllowed`, defaulted true the same way every
   *  other loot-table drop in this engine defaults it absent a live game-rule reader). Returns
   *  true the tick the sneeze actually resolved (for `pandacheck` to poll without a full loop).
   */
  Pd.SNEEZE_DURATION = 20;
  Pd.SNEEZE_JUMP_RANGE = 10;
  Pd.tickSneeze = function (e, ctx) {
    if (!e || !e.sneezing) return false;
    ctx = ctx || {};
    e.sneezeProgress = (e.sneezeProgress | 0) + 1;
    if (e.sneezeProgress === 1) Pd.playSound(e, Pd.SOUND.preSneeze, 1, 1);
    if (e.sneezeProgress <= Pd.SNEEZE_DURATION) return false;
    e.sneezing = false;
    e.sneezeProgress = 0;
    // PandaEntity.sneeze(): the particle (behind the body, eyeY-0.1, carrying the panda's velocity) precedes the sound
    if (ctx.particle) {
      var by = e.bodyYaw !== undefined ? e.bodyYaw : (e.yaw || 0), k = ((e.width || 1.3) + 1) * 0.5;   // engine yaw: forward = (sin y, -cos y) (D-415)
      ctx.particle(e, 'sneeze', e.x + k * Math.sin(by), (e.y + (e.eyeHeight || (e.height || 1.25) * 0.85)) - 0.1, e.z - k * Math.cos(by), e.vx || 0, 0, e.vz || 0);
    }
    Pd.playSound(e, Pd.SOUND.sneeze, 1, 1);
    var rand = ctx.random || RNDFB;
    var nearby = ctx.pandas || function () { return []; };
    var list = nearby();
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (!o || o === e || o.isBaby || !o.onGround || o.inWater) continue;
      if (!Pd.isIdle(o)) continue;
      // `getBoundingBox().expand(10.0)` intersects: an AABB overlap, not a sphere (panda 1.3 x 1.25)
      var R = Pd.SNEEZE_JUMP_RANGE, hw = 0.65, hh = 1.25;
      if (Math.abs(o.x - e.x) >= R + 2 * hw || Math.abs(o.z - e.z) >= R + 2 * hw) continue;
      if (o.y >= e.y + hh + R || o.y + hh <= e.y - R) continue;
      if (ctx.jump) ctx.jump(o);
    }
    var dropsAllowed = ctx.dropsAllowed === undefined ? true : ctx.dropsAllowed;
    if (dropsAllowed && rand() < Pd.SLIME_BALL_DROP_CHANCE && ctx.dropItem) {
      ctx.dropItem(e, 'slime_ball', 1);
    }
    return true;
  };

  // ── § MATE — `PandaMateGoal` + `tick()`'s askForBambooTicks countdown (.decomp lines 335-345, 907-950)
  Pd.ASK_TICKS = 32;
  Pd.ASK_INTERVAL = 600;
  Pd.ASK_RANGE = 8;

  /** `isBambooClose` (.decomp lines 934-950): the 3(y) x 8-ring search around the panda's block
   *  covers |dx|,|dz| <= 7 at dy 0..2, so a bamboo block anywhere in that box counts. */
  Pd.isBambooClose = function (e) {
    var W = NS.World, S = NS.States, R = NS.Reg;
    if (!W || !S || !R || R.id.bamboo === undefined) return false;
    var bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
    for (var dy = 0; dy < 3; dy++) for (var dx = -7; dx <= 7; dx++) for (var dz = -7; dz <= 7; dz++) {
      var st = W.getBlock(bx + dx, by + dy, bz + dz);
      if (st !== 0 && S.block[st] === R.id.bamboo) return true;
    }
    return false;
  };

  /** `PandaMateGoal.canStart`: mating (the generic `Ai.BreedGoal`) only with bamboo close; else
   *  every 600 ticks start the 32-tick "ask" and aim the look goal at the nearest player. */
  /** `PandaEntity.LookAtEntityGoal` (.decomp 812-): chance-rolled, `isIdle()`-gated, and `setTarget`
   *  lets PandaMateGoal's ask aim it; `shouldContinue` needs a target. */
  Pd.LookAtEntityGoal = function (e, getPlayers, range, ctx) {
    var rand = (ctx && ctx.random) || RNDFB, target = null, lookTime = 0;
    this.setTarget = function (t) { target = t; };
    this.getTarget = function () { return target; };
    this.canUse = function () {
      if (rand() >= 0.02) return false;
      if (!target) {
        var ps = getPlayers ? getPlayers() : [], bd = Infinity;
        for (var i = 0; i < ps.length; i++) {
          var d = Math.hypot(ps[i].x - e.x, ps[i].y - e.y, ps[i].z - e.z);
          if (d <= range && d < bd) { target = ps[i]; bd = d; }
        }
      }
      return Pd.isIdle(e) && !!target;
    };
    this.canContinueToUse = function () {
      return !!target && !target.dead && Math.hypot(target.x - e.x, target.y - e.y, target.z - e.z) <= range && lookTime > 0;
    };
    this.start = function () { lookTime = 40 + Math.floor(rand() * 40); };
    this.stop = function () { target = null; };
    this.tick = function () {
      if (!target || !e.look) return;
      e.look.setLookAt(target.x, target.y + (target.eyeHeight || 0), target.z);
      lookTime--;
    };
  };

  Pd.MateGoal = function (e, speed, getPartners, onBreed, getPlayers) {
    var inner = new NS.Ai.BreedGoal(e, speed, getPartners, onBreed);
    var nextAsk = 0;
    this.inner = inner;
    this.canUse = function () {
      if (!inner.canUse() || (e.askForBambooTicks | 0) !== 0) return false;
      if (Pd.isBambooClose(e)) return true;
      if (nextAsk <= (e.age | 0)) {
        e.askForBambooTicks = Pd.ASK_TICKS;
        nextAsk = (e.age | 0) + Pd.ASK_INTERVAL;
        if (!e.aiDisabled && e.pdLookGoal) {   // canMoveVoluntarily()
          var best = null, bestD = Pd.ASK_RANGE;
          var ps = getPlayers ? getPlayers() : [];
          for (var i = 0; i < ps.length; i++) {
            var d = Math.hypot(ps[i].x - e.x, ps[i].y - e.y, ps[i].z - e.z);
            if (d <= bestD) { best = ps[i]; bestD = d; }
          }
          e.pdLookGoal.setTarget(best);
        }
      }
      return false;
    };
    this.canContinueToUse = function () { return inner.canContinueToUse(); };
    this.start = function () { inner.start(); };
    this.stop = function () { inner.stop(); };
    this.tick = function () { inner.tick(); };
  };

  /** `tick()`'s askForBambooTicks branch: look at the asked player, cant_breed at 29 and 14. */
  Pd.tickAskForBamboo = function (e) {
    if (!e || (e.askForBambooTicks | 0) <= 0) return;
    if (e.askForBambooTicks === 29 || e.askForBambooTicks === 14) {
      Pd.playSound(e, 'entity.panda.cant_breed', 1, 1);
    }
    // vanilla tick(): lookAtEntity(getTarget(), 90, 90) - the ATTACK target; the asked player is only
    // looked at via LookAtEntityGoal
    var t = e.target;
    if (t && e.look) e.look.setLookAt(t.x, t.y + (t.eyeHeight || 0), t.z, Math.PI / 2, Math.PI / 2);
    e.askForBambooTicks--;
  };

  // ── § LIE ON BACK — `LieOnBackGoal` (.decomp lines 780-802) ─────────────────────────────────
  Pd.LIE_ON_BACK_START_CHANCE = 1 / 400;   // `random.nextInt(toGoalTicks(400)) == 1` -- goal
                                            // ticks run 1-per-tick in this engine (no vanilla
                                            // "every 20th real tick" throttle exists here yet),
                                            // so this is that same odds re-based on 1-per-tick.
  Pd.LIE_ON_BACK_STOP_CHANCE_LAZY_EXEMPT = 1 / 600;  // non-lazy: 1/600 chance to even consider stopping
  Pd.LIE_ON_BACK_STOP_CHANCE = 1 / 2000;             // then 1/2000 to actually stop
  Pd.LieOnBackGoal = function (e, ctx) {
    var rand = (ctx && ctx.random) || RNDFB;
    var nextAge = 0;
    this.canUse = function () {
      return nextAge < (e.age | 0) && Pd.isLazy(e) && Pd.isIdle(e) && rand() < Pd.LIE_ON_BACK_START_CHANCE;
    };
    this.canContinueToUse = function () {
      if (e.inWater) return false;
      if (!Pd.isLazy(e) && rand() < Pd.LIE_ON_BACK_STOP_CHANCE_LAZY_EXEMPT) return false;
      return rand() >= Pd.LIE_ON_BACK_STOP_CHANCE;
    };
    this.start = function () { e.lyingOnBack = true; };
    this.stop = function () { e.lyingOnBack = false; nextAge = (e.age | 0) + 200; };
    this.tick = function () {};
  };

  // ── § ATTACK / REVENGE — `AttackGoal extends MeleeAttackGoal` + `PandaRevengeGoal extends
  // RevengeGoal` (.decomp lines 495-518, 967-988), folded onto this engine's own melee-goal
  // shape (`Gt.RamGoal`'s own inline precedent, 07zj_goat.js) since neither has a
  // `GoalSelector`-generic equivalent: `MeleeAttackGoal`'s own `canStart` gate (`isIdle()`) is
  // a PANDA override, and `RevengeGoal`'s own `shouldContinue` reads two fields
  // (`shouldGetRevenge`/`shouldAttack`) nothing else in this engine writes. ──────────────────
  Pd.ATTACK_RANGE = 1.6;   // this engine's own melee-reach constant (no generic one exists to
                            // read off -- Gt.RAM_HIT_RANGE's own sibling gap, goat's own file).
  Pd.ATTACK_SPEED = 1.2;

  /** `RevengeGoal`'s own generic half: whoever hits this panda becomes its target, UNLESS
   *  `shouldGetRevenge`/`shouldAttack` is set, in which case (`PandaRevengeGoal.shouldContinue`,
   *  verbatim, however backwards it reads) the target is cleared INSTEAD of pursued -- a
   *  non-aggressive panda that fought back once (`tryAttack`'s own `shouldAttack = true` when
   *  NOT `isAttacking()`) gives up the chase on the very next poll; an AGGRESSIVE panda's
   *  `tryAttack` never sets that flag, so it keeps fighting normally. TARGET-flag goal. */
  Pd.REVENGE_WINDOW = 100;   // TrackTargetGoal/LivingEntity.getAttacker: 100 ticks since the hit
  Pd.RevengeGoal = function (e, ctx) {
    var lastSeen = 0;
    this.canUse = function () {
      var seq = e.hurtSeq || 0;
      if (seq <= lastSeen) return false;
      var att = e.lastHurtByEntity;
      if (!att || att.removed) return false;
      if (NS.Ai.canTargetLiving && !NS.Ai.canTargetLiving(att, e)) return false;   // #3659 RevengeGoal.canTrack
      if ((e.age || 0) - (e.hurtAge || 0) > Pd.REVENGE_WINDOW) return false;
      return true;
    };
    this.canContinueToUse = function () {
      if (!e.shouldGetRevenge && !e.shouldAttack) {
        return !!(e.target && !e.target.removed && e.target.health > 0);
      }
      e.target = null;
      return false;
    };
    this.start = function () {
      var att = e.lastHurtByEntity;
      e.target = att;
      lastSeen = e.hurtSeq || 0;
      // callSameTypeForRevenge (setGroupRevenge()): every other panda within followRange x 10 x
      // followRange with no target is alerted; PandaRevengeGoal.setMobEntityTarget lets only
      // AGGRESSIVE pandas take the target.
      var mates = (ctx && ctx.animals) ? ctx.animals() : [];
      var fr = (NS.Ai && NS.Ai.followRangeOf) ? NS.Ai.followRangeOf(e) : 16;
      for (var i = 0; i < mates.length; i++) {
        var o = mates[i];
        if (!o || o === e || o.removed || o.target || o.type !== 'panda') continue;
        if (Math.abs(o.x - e.x) > fr || Math.abs(o.z - e.z) > fr || Math.abs(o.y - e.y) > 10) continue;
        if (Pd.isAttacking(o)) o.target = att;
      }
    };
    this.stop = function () {};
    this.tick = function () {};
  };

  /** `tick()`'s own `if (target == null) { shouldGetRevenge = false; shouldAttack = false; }`
   *  (.decomp lines 328-332) -- reset the two flags the instant the target clears, wired as
   *  part of `Ai.ROSTER.panda`'s own per-tick housekeeping (07k_goals.js). */
  Pd.tickRevengeFlags = function (e) {
    if (e && !e.target) { e.shouldGetRevenge = false; e.shouldAttack = false; }
  };

  /** `AttackGoal.canStart` (.decomp lines 918-926): `panda.isIdle() && super.canStart()`
   *  (a live, reachable target within melee range). `MeleeAttackGoal`'s own generic close-and-
   *  swing shape (`Gt.RamGoal`'s inline precedent, goat) is reused rather than forked again. */
  Pd.AttackGoal = function (e, ctx) {
    ctx = ctx || {};
    var rand = ctx.random || RNDFB;
    this.canUse = function () {
      return Pd.isIdle(e) && !!e.target && !e.target.removed &&
        e.target.health !== undefined && e.target.health > 0;
    };
    // MeleeAttackGoal.shouldContinue has no isIdle test (only canStart does)
    this.canContinueToUse = function () {
      return !!e.target && !e.target.removed && e.target.health !== undefined && e.target.health > 0;
    };
    // `AttackGoal extends MeleeAttackGoal(1.2, true)`: the generic goal owns pathing, the
    // (w*2)^2+targetW reach and the 20-tick cooldown; `tryAttack` (.decomp lines 502-509) plays
    // ENTITY_PANDA_BITE, sets `shouldAttack` if !isAttacking(), then the standard mobAttack path.
    var melee = new NS.Ai.MeleeAttackGoal(e, Pd.ATTACK_SPEED, null, function () {
      Pd.playSound(e, Pd.SOUND.bite, 1, 1);
      if (!Pd.isAttacking(e)) e.shouldAttack = true;
    });
    this.start = function () { melee.start(); };
    this.stop = function () { melee.stop(); };
    this.tick = function () { melee.tick(); };
  };

})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
