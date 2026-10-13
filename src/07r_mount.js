// 07r_mount.js — QUEUE 0.2 "G18e remainder": HORSE, the equip/tame/ride substrate.
// Runs on: MAIN THREAD ONLY. No DOM.
//
// ⚠⚠ SCOPE, READ FIRST. Horse's MOTION and PLACEMENT-TIER GOAL SELECTOR already exist
// (07k_goals.js's own `Ai.ROSTER.horse`, session 66/D-459) and are NOT this file's job. This
// file is everything `Ai.ROSTER.horse`'s own header named as still missing: "no taming, no
// riding, no saddle, no jump-charge". Off `.decomp/net/minecraft/entity/passive/
// HorseBaseEntity.java`, `HorseEntity.java` and `net/minecraft/entity/ai/goal/
// HorseBondWithPlayerGoal.java`, all javap'd in full this session, not remembered.
//
// ⚠⚠ DONKEY/MULE NOW BUILT (loop/donkey-s96, QUEUE 0.2 G18e remainder close) — LLAMA STILL
// ONLY NAMED (`Mount.OWED`). Donkey and mule share `AbstractHorseEntity`'s taming/riding/saddle
// shape almost exactly (`Mnt.MOUNTABLE`/`Mnt.hasArmorSlot` below), have their own placement-tier
// goal selector now (`Ai.ROSTER.donkey`/`.mule`, 07k_goals.js — literally `Ai.ROSTER.horse`
// reused, nothing in that list is horse-specific), and their own chest inventory (`e.hasChest`,
// `Mnt.CHESTABLE`, `Mnt.interact`'s chest branch, `Mnt.menu`'s 2->17-slot resize) in place of
// horse's armour slot. Horse x donkey -> mule breeding is real too (`Breed.CHILD_SPECIES`,
// 07m_breed.js). Llama is further still: no jump-strength/travel shape at all (a llama ridden
// without a saddle just sits there — `LlamaEntity` overrides `travel` to refuse steering even
// when saddled, because llamas are never player-steerable in vanilla — D-46x-shaped decision
// this file does not make), a decoration/carpet slot, and a spit attack. Named on `Mount.OWED`,
// not guessed around.
//
// ⚠⚠ THE RENDERED INVENTORY SCREEN IS NOW BUILT (QUEUE 0.2 G18e remainder, this session).
// `Mount.menu` is the real `AbstractContainerMenu` shape — two equip slots (`saddle`,
// `HorseArmorItem`) over the horse's own 2-slot inventory, plus the player's 27+9 — built off
// the SAME `NS.Menu` primitives `Menu.chestMenu` already uses (`Menu.container`/`Menu.slot`/
// `Menu.create`), exercised headlessly by `mountcheck.mjs` without a browser. `horse.png` (the
// real vanilla GUI SHEET, `tools/build-gui.mjs`) is extracted, and `Gui.HORSE`/`H.drawHorse`/
// `H.horseClick` (`15_hud.js`, this unit's own GUI-module file) draw the real panel, the real
// saddle/armour slot icons and the real `Mount.menu` slots over it — the same pattern
// `H.drawChest`/`H.drawCrafting` already use for a real, tested container. `Use.entityUse`'s
// horse branch now calls `Hud.openHorse` on `Mnt.interact`'s own `opened: true` (a one-line
// hook in `14l_use.js`, not this unit's file — see this session's summary), and the inventory
// key opens the same screen while ridden (`17_main.js`, likewise a small out-of-unit hook).
// Left OWED (`Mount.OWED`): the screen's own 3D ENTITY PREVIEW box — D-278's own precedent
// (the player screen's flat-skin declared deviation) does not extend cleanly to a mesh entity,
// so the box is left blank rather than guessed. Saddling does not need the screen at all (see
// below); armour equip is real in the MODEL/MENU and now reachable in play through this screen.
//
// ⚠⚠ SADDLING NEEDS NO SCREEN — read by hand, not assumed. `SaddleItem.useOnEntity` (.decomp)
// equips the saddle DIRECTLY on a plain right-click of a tame, unsaddled, non-baby horse; only
// `HorseArmorItem` (no `useOnEntity` override, so `Item.useOnEntity` PASSes) falls through to
// `HorseEntity.interactMob`'s `openInventory` branch. `Mount.interact` reproduces exactly this
// split.
//
// ⚠⚠ THE LIVE PLAYER IS NOW WIRED TO RIDE (QUEUE 0.2 G18e remainder, this session). `Mount.mount`/
// `Mount.dismount` set `e.rider`/`P.vehicle`-shaped state; `14_player.js`'s own `P.tickMounted`
// (called from `P.tick` whenever `P.vehicle` is ridden, in place of ground `Physics.tick`) is
// what redirects the PLAYER's own camera/position onto the horse (`10_gfx.js` already reads
// `P.ex/ey/ez` for the eye every frame, unchanged) and feeds `cmd.fwd`/`cmd.strafe`/the
// jump-charge duration into `e.riderInput`, the new default `Mount.travelRidden` reads when
// `07i_entitylist.js`'s own per-mob tick calls it with no second argument, exactly as before.
// `mountcheck.mjs`'s own §11/§12/§13 drive `P.tickMounted` directly (no browser needed — see
// that function's header for why); §6 still drives `Mount.travelRidden` against a SYNTHETIC
// rider object for the arithmetic itself. Left OWED: the dismount safety SEARCH (`Mount.OWED`)
// and the screen's own 3D entity-preview box (`Mount.OWED`, unrelated to riding — the screen
// ITSELF is built this session, see the header above).
//
// ⚠⚠ TEMPER FOOD VALUES ARE READ, NOT REMEMBERED. `HorseBaseEntity.receiveFood` (javap'd) has
// one `if/else if` chain keyed on FIVE items, each with its OWN heal/grow-ticks/temper literal;
// `Mount.FOOD`'s numbers are transcribed straight off that chain (`Items.field_8861`=wheat,
// `field_8479`=sugar, `Blocks.field_10359`=hay_block, `field_8279`=apple, `field_8071`=
// golden_carrot, `field_8463`/`field_8367`=golden_apple/enchanted_golden_apple — every one
// resolved against `Items.java`'s own `register(...)` calls this session, not guessed from the
// obfuscated field name). `growUp(int)` (`PassiveEntity.java`, javap'd) is `age += ticks*20`,
// UNFORCED — the SAME `ageUpUnit` `Breed.ageUp`'s own `forced` path uses, so `Br.ageUp(e,
// food.grow, false)` is exact reuse, not a second copy of the constant.

(function (NS) {
  'use strict';
  // fallback stream when a caller passes no rng: the entity list's, else a fixed-seed JRandom (never Math.random, #6440)
  var fbR = null;
  function RNDFB() { var L = NS.EntityList; if (L && L.random) return L.random(); if (!fbR) fbR = NS.JRandom ? new NS.JRandom(0x6440) : { s: 0x6440, nextDouble: function () { this.s = (Math.imul(this.s, 1103515245) + 12345) >>> 0; return this.s / 4294967296; } }; return fbR.nextDouble(); }

  var Mnt = NS.Mount = { ready: false };

  Mnt.init = function () {
    Mnt.ready = !!(NS.Breed && NS.Entities);
    return Mnt;
  };

  /** `AbstractHorseEntity`'s ridable family: horse (this session's own prior pass), donkey/mule
   *  (loop/donkey-s96) and now LLAMA too (loop/llama-s97) -- `AbstractDonkeyEntity`/`LlamaEntity`
   *  share taming/mounting with `HorseBaseEntity` almost verbatim (`Mnt.MOUNTABLE` only gates
   *  "can be put on someone's back at all", not "can be STEERED once there" -- see
   *  `Mnt.canBeSaddled`'s own header for why a llama never actually reaches `travelRidden`). */
  Mnt.MOUNTABLE = { horse: true, donkey: true, mule: true, llama: true, skeleton_horse: true, zombie_horse: true };
  /** `SkeletonHorseEntity`/`ZombieHorseEntity.interactMob` (.decomp): their own dispatch -- untamed PASS
   *  (no mount, no angry sound, no bonding), no food/armour/chest branches. */
  Mnt.isUndeadHorse = function (e) { return !!(e && (e.type === 'skeleton_horse' || e.type === 'zombie_horse')); };

  /** `AbstractDonkeyEntity`'s own extra state -- `e.hasChest` (`CHEST` tracked boolean,
   *  .decomp) -- neither `HorseEntity` nor a plain `HorseBaseEntity` has this at all. `LlamaEntity`
   *  never overrides `getInventorySize`/the CHEST flag itself either (it inherits both from
   *  `AbstractDonkeyEntity` verbatim, loop/llama-s97, .decomp read in full) -- only its own
   *  `getInventoryColumns()` override (`Mnt.inventoryColumns` below) makes a llama's chest a
   *  different SIZE than donkey/mule's fixed 5-column one. */
  Mnt.CHESTABLE = { donkey: true, mule: true, llama: true };
  /** `getStackReference(499).set(chest)` + the chest-added sound: shared by `Mnt.interact` and the dispenser. */
  Mnt.addChest = function (e) {
    e.hasChest = true;
    if (NS.Llama && NS.Llama.isLlama(e)) NS.Llama.playAddChest(e);   // playAddChestSound (#680)
    else if (NS.Sound && NS.Sound.play && !e.silent && (e.type === 'donkey' || e.type === 'mule'))   // (#1357)
      // `DonkeyEntity`/`MuleEntity.playAddChestSound`: entity.<type>.chest, 1.0, (rand-rand)*0.2+1
      NS.Sound.play('entity.' + e.type + '.chest', { x: e.x, y: e.y, z: e.z, volume: 1,
        pitch: 1 + (RNDFB() - RNDFB()) * 0.2, source: 'neutral' });
  };
  Mnt.isChestable = function (e) { return !!(e && Mnt.CHESTABLE[e.type]); };
  /** QUEUE 0.2 (G18e remainder, Mnt.OWED close) -- the RENDER half of `e.hasChest`:
   *  `AbstractDonkeyEntity`'s/`LlamaEntity`'s own model (`DonkeyEntityModel.leftChest`/
   *  `rightChest`, `LlamaEntityModel`'s own two chest cubes, .decomp, both read in full) bakes
   *  the chest boxes into every donkey/mule/llama model UNCONDITIONALLY and the LIVE RENDERER
   *  hides them with `ModelPart.visible = hasChest` in `setupAnim` -- this engine's part table
   *  (`tools/golden/models-1.18.2.tsv`'s own `left_chest`/`right_chest` rows) has no per-part
   *  visibility flag of its own, so `07j_entityrender.js`'s emitter is handed this NAME set
   *  to skip instead, the same shape `mobtexcheck`'s callers already use for a skin key. Only
   *  the two PART NAMES actually named `left_chest`/`right_chest` in that TSV are ever hidden
   *  -- a species with no chest row at all (horse) never calls this, since `Mnt.isChestable`
   *  gates it. */
  Mnt.CHEST_PART_NAMES = { left_chest: 1, right_chest: 1 };
  Mnt.hideChestParts = function (e) {
    return (Mnt.isChestable(e) && !e.hasChest) ? Mnt.CHEST_PART_NAMES : null;
  };
  /** `AbstractDonkeyEntity.getInventoryColumns()` is a flat `5`; `LlamaEntity` overrides it to
   *  `getStrength()` (1..5, loop/llama-s97, .decomp) -- this is what makes a llama's chest
   *  2+3*columns slots instead of donkey/mule's fixed 17 (`Mnt.menu` below). */
  Mnt.inventoryColumns = function (e) {
    return Mnt.isLlama(e) ? Mnt.getStrength(e) : 5;
  };
  /** `HorseEntity.hasArmorSlot()` overrides the base `false` to `true`; `AbstractDonkeyEntity`
   *  does not override it at all, so donkey/mule stay at `AbstractHorseEntity`'s own `false`
   *  (.decomp, both classes read this pass). `LlamaEntity` ALSO overrides it to `true` (.decomp,
   *  loop/llama-s97) but repurposes that same slot for the carpet decoration, not horse armour
   *  -- kept as its OWN predicate (`Mnt.hasDecorSlot`) rather than folded into this one, so
   *  every existing caller of `Mnt.hasArmorSlot` (donkeycheck.mjs/mountcheck.mjs included) keeps
   *  meaning exactly "has the horse-armour-bonus slot", unchanged by this pass. */
  Mnt.hasArmorSlot = function (e) { return !!(e && e.type === 'horse'); };
  Mnt.isLlama = function (e) { return !!(e && (e.type === 'llama' || e.type === 'trader_llama')); };
  Mnt.hasDecorSlot = function (e) { return Mnt.isLlama(e); };

  /** `LlamaEntity`'s own `STRENGTH` tracked int (1..5, .decomp `initializeStrength`/
   *  `setStrength` both read in full, loop/llama-s97). `MAX_STRENGTH` is the class's own literal
   *  `private static final int MAX_STRENGTH = 5`. */
  Mnt.MAX_STRENGTH = 5;
  Mnt.getStrength = function (e) { return (e && e.strength) || 1; };
  /** `setStrength(int)` -- `Math.max(1, Math.min(5, n))`, the class's own clamp, verbatim. */
  Mnt.setStrength = function (e, n) {
    var v = n | 0;
    if (v < 1) v = 1; else if (v > Mnt.MAX_STRENGTH) v = Mnt.MAX_STRENGTH;
    e.strength = v;
    return v;
  };
  /** `initializeStrength()` (.decomp): `int n = random.nextFloat() < 0.04F ? 5 : 3; setStrength(1
   *  + random.nextInt(n))` -- a flat 1..3 roll 96% of the time, 1..5 the other 4%, TWO separate
   *  random draws (this engine's usual convention: each `rand()` call is its own draw). */
  Mnt.rollStrength = function (rand) {
    rand = rand || RNDFB;
    var n = rand() < 0.04 ? 5 : 3;
    return 1 + Math.floor(rand() * n);
  };

  /** `LlamaEntity`'s own `VARIANT` tracked int (0..3 creamy/white/brown/gray, .decomp
   *  `private static final int VARIANTS = 4`) -- a SEPARATE, smaller encoding from horse's own
   *  7-colour x 5-marking `Mnt.rollVariant`/`Mnt.HORSE_COLOR_COUNT` above; llama tracks no
   *  marking at all, so this is its own plain 0..3 roll, not a second call into that one. */
  Mnt.LLAMA_VARIANT_COUNT = 4;
  Mnt.rollLlamaVariant = function (rand) {
    rand = rand || RNDFB;
    return Math.floor(rand() * Mnt.LLAMA_VARIANT_COUNT);
  };
  /** `LlamaEntity.method_6804`'s own child-strength roll (.decomp, the class's real
   *  `getBreedOffspring`/`createChild` pairing, read in full): `random.nextInt(max(a.strength,
   *  b.strength)) + 1`, then a further +1 on a flat 3% roll -- TWO draws, same "each rand() call
   *  is its own" convention as `rollStrength` above. */
  Mnt.rollChildStrength = function (a, b, rand) {
    rand = rand || RNDFB;
    var s = Math.floor(rand() * Math.max(Mnt.getStrength(a), Mnt.getStrength(b))) + 1;
    if (rand() < 0.03) s++;
    return s;
  };
  /** The SAME method's variant half: a coin flip onto whichever parent's own `variant`, no fresh
   *  roll -- `this.random.nextBoolean() ? this.getVariant() : other.getVariant()`. */
  Mnt.rollChildLlamaVariant = function (a, b, rand) {
    rand = rand || RNDFB;
    return rand() < 0.5 ? a.variant : b.variant;
  };

  /**
   * `LlamaEntity.isHorseArmor`/`getColorFromCarpet` (.decomp, loop/llama-s97): a llama's own
   * "armour" slot (`Mnt.hasDecorSlot`) only ever accepts a `DyedCarpetBlock` item -- this
   * engine's carpet items are already real blocks named `<colour>_carpet` (16 of them, the
   * villager-trade table already spends/sells them, `19_data.gen.js`) -- `moss_carpet` is NOT
   * one of the sixteen (it is undyed, no `DyeColor` at all, .decomp: `DyedCarpetBlock` is not
   * its class), which is exactly why the colour lookup below refuses it rather than a second,
   * separate name-suffix exclusion.
   */
  Mnt.isCarpetItem = function (item) {
    return Mnt.carpetColorIndex(item) >= 0;
  };
  /** `getColorFromCarpet`'s own `DyeColor` ordinal, read off `Tame.DYES` (07n_tame.js, the same
   *  sixteen-name ordinal table D-492's own wolf/cat collar-dye code already built) rather than
   *  a second copy of the list. -1 for anything that is not one of the sixteen dyed carpets. */
  Mnt.carpetColorIndex = function (item) {
    var m = /^(.*)_carpet$/.exec(String(item || ''));
    if (!m) return -1;
    var Tm = NS.Tame;
    var dyes = Tm && Tm.DYES;
    if (!dyes) return -1;
    var i = dyes.indexOf(m[1]);
    return i;
  };
  /** `Blocks.field_10034` == `chest` (.decomp `Blocks.java` register call, read this pass) --
   *  the one item `AbstractDonkeyEntity.interactMob`'s own chest-attach branch recognises. */
  Mnt.CHEST_ITEM = 'chest';

  // `HorseBaseEntity.getMaxTemper()` — literal 100, every subtype.
  Mnt.MAX_TEMPER = 100;
  /** `LlamaEntity.getMaxTemper()` (.decomp, loop/llama-s97) overrides horse/donkey/mule's flat 100 down to 30 -- `Mnt.maxTemperOf` is what `Mnt.addTemper`/`Mnt.feed` actually clamp against, `Mnt.MAX_TEMPER` staying the shared horse-family default. */
  Mnt.maxTemperOf = function (e) { return Mnt.isLlama(e) ? 30 : Mnt.MAX_TEMPER; };
  // `HorseBondWithPlayerGoal.tick` — the flat `addTemper(5)` on a failed bond roll.
  Mnt.BOND_FAIL_TEMPER = 5;

  Mnt.SADDLE_ITEM = 'saddle';

  // `HorseBaseEntity.receiveFood` — heal (half-hearts... no, FULL hearts, `LivingEntity.heal`
  // takes whole HP same as this engine's own `e.health`), grow-ticks-in-SECONDS (`growUp(int)`
  // multiplies by 20 itself), and temper, per item. `love: true` marks the two items whose
  // branch also calls `lovePlayer` when the horse is already tame and of breeding age.
  Mnt.FOOD = {
    wheat:                 { heal: 2,  grow: 20,  temper: 3 },
    sugar:                 { heal: 1,  grow: 30,  temper: 3 },
    hay_block:             { heal: 20, grow: 180, temper: 0 },
    apple:                 { heal: 3,  grow: 60,  temper: 3 },
    golden_carrot:         { heal: 4,  grow: 60,  temper: 5,  love: true },
    golden_apple:          { heal: 10, grow: 240, temper: 10, love: true },
    enchanted_golden_apple:{ heal: 10, grow: 240, temper: 10, love: true }
  };

  // `LlamaEntity.receiveFood` (.decomp, loop/llama-s97) -- its OWN if/else-if chain, only two
  // items, DIFFERENT numbers from horse's shared `Mnt.FOOD` table above (wheat's own grow is 10
  // seconds here, not horse's 20; hay_block heals 10 and tempers 6, not horse's 20/0) -- reusing
  // `Mnt.FOOD` verbatim for a llama would silently feed it horse's numbers, so it gets its own
  // table, read the same way (`Mnt.feed` below picks whichever table `Mnt.isLlama` says).
  Mnt.LLAMA_FOOD = {
    wheat:     { heal: 2,  grow: 10, temper: 3 },
    hay_block: { heal: 10, grow: 90, temper: 6, love: true }
  };
  Mnt.foodTable = function (e) { return Mnt.isLlama(e) ? Mnt.LLAMA_FOOD : Mnt.FOOD; };

  // `Items.java`, javap'd: `HorseArmorItem(bonus, ...)` — leather=3 (`DyeableHorseArmorItem`,
  // same base class field), iron=5, golden=7, diamond=11.
  Mnt.ARMOR_BONUS = {
    leather_horse_armor: 3,
    iron_horse_armor: 5,
    golden_horse_armor: 7,
    diamond_horse_armor: 11
  };

  // QUEUE 0.2 (G18e remainder, Mnt.OWED close) -- which `FAMILY.horse_armor` sheet
  // (tools/extract-mob-textures.mjs, leather/iron/gold/diamond order) each armour ITEM name
  // draws -- note the ITEM is "golden_horse_armor" but the jar's own texture file is
  // "horse_armor_gold.png", not "horse_armor_golden.png" (checked against the real 1.18.2
  // jar this pass, not guessed).
  Mnt.HORSE_ARMOR_TEX_INDEX = {
    leather_horse_armor: 0,
    iron_horse_armor: 1,
    golden_horse_armor: 2,
    diamond_horse_armor: 3
  };

  // `EntityAttributes.field_23728` ("horse.jump_strength") registers with base 0.7 — the flat
  // vanilla DEFAULT, kept as the fallback `Mnt.travelRidden` reads when `e.jumpStrengthAttr` is
  // absent (an unrolled fixture or a pre-this-session save). `HorseEntity.initialize`'s own
  // per-spawn random roll, and the per-child attribute averaging, are now built —
  // `Mnt.rollAttributes`/`Breed.CHILD.horse` (QUEUE 0.2 G18e remainder, this session).
  Mnt.JUMP_STRENGTH_ATTR = 0.7;
  // `createBaseHorseAttributes().add(EntityAttributes.field_23719, 0.225F)` — the ridden-only
  // movement-speed attribute `travel()`'s own `setMovementSpeed` reads; distinct from the
  // GENERIC movement speed `Ent.attrsOf('horse').speed` already carries for the AI-walk case.
  Mnt.RIDDEN_MOVEMENT_SPEED = 0.225;
  // `LivingEntity.getJumpVelocity()` — `0.42F * getJumpVelocityMultiplier()`; multiplier
  // defaults 1.0 (no potion/attribute override wired — `Mount.OWED`).
  Mnt.JUMP_VELOCITY_BASE = 0.42;

  /**
   * QUEUE 0.2 (G18e remainder) -- `HorseBaseEntity`'s own three `getChildXBonus()` methods
   * (.decomp, javap'd): each is used TWICE in the jar -- directly, as `HorseEntity.
   * initAttributes()`'s per-SPAWN roll for a wild horse, and again inside `setChildAttributes`
   * (`Mnt.rollChildAttributes` below) as the random THIRD term a bred foal's two parents are
   * averaged against. One set of formulas, two call sites, exactly like the jar.
   */
  Mnt.childHealthBonus = function (rand) {
    // `getChildHealthBonus()`: `15.0F + nextInt(8) + nextInt(9)`.
    return 15 + Math.floor(rand() * 8) + Math.floor(rand() * 9);
  };
  Mnt.childJumpStrengthBonus = function (rand) {
    // `getChildJumpStrengthBonus()`: `0.4F + nextDouble()*0.2 + nextDouble()*0.2 + nextDouble()*0.2`.
    return Math.fround(0.4) + rand() * 0.2 + rand() * 0.2 + rand() * 0.2;   // 0.4F is a float literal
  };
  Mnt.childMovementSpeedBonus = function (rand) {
    // `getChildMovementSpeedBonus()`: `(0.45F + nextDouble()*0.3*3) * 0.25`.
    return (Math.fround(0.45) + rand() * 0.3 + rand() * 0.3 + rand() * 0.3) * 0.25;
  };

  /**
   * `HorseEntity.initAttributes()` (.decomp) -- a horse born WILD (natural spawn or `/summon`,
   * never a bred foal) gets its three roamable attributes straight off the bonus rolls above,
   * no averaging. Call once, right after `EL.spawn` builds the entity (`EL.DEFAULTS.horse`,
   * `07i_entitylist.js` -- a two-line hook, not this file, see this session's own summary).
   * Overwrites the FLAT table default (`Ent.attrsOf('horse').hp`, `Mnt.JUMP_STRENGTH_ATTR`,
   * `Mnt.RIDDEN_MOVEMENT_SPEED`) `EL.spawn`'s own generic health init already set moments
   * earlier -- those three constants remain the pre-roll fallback a headless fixture with no
   * rng (or a stale save from before this session) can still read (`e.xAttr === undefined`).
   */
  // `createAbstractDonkeyAttributes()` (.decomp, `AbstractDonkeyEntity`): `field_23719`
  // (ridden movement speed) registers at flat 0.175, `field_23728` (jump strength) at flat
  // 0.5 -- NEITHER is re-rolled by `AbstractDonkeyEntity.initAttributes()`, which touches ONLY
  // health (`getChildHealthBonus()`, the SAME roll `HorseEntity.initAttributes()` uses). A
  // donkey/mule's jump and speed are therefore always exactly these two literals, never rolled.
  Mnt.DONKEY_JUMP_STRENGTH_ATTR = 0.5;
  Mnt.DONKEY_RIDDEN_MOVEMENT_SPEED = 0.175;

  // ⚠ loop/nbtsave-s104: this function itself STILL ALWAYS ROLLS -- `mountcheck`'s own §15
  // pins it to an exact draw by calling it directly, twice in a row, on the same entity, and a
  // "skip if already set" guard IN HERE would break that pre-existing contract. The reload-safe
  // guard lives one level up, in `EL.DEFAULTS.horse`/`.donkey`/`.mule`/`.llama` below (each now
  // reads `e.maxHealthAttr === undefined` before calling this, the SAME "spawner opts already
  // supplied it" shape `e.variant === undefined` next to the horse entry already uses) -- that
  // is the one call path `EL.spawn`'s generic opts-copy step (07i_entitylist.js) actually feeds.
  Mnt.rollAttributes = function (e, rand) {
    rand = rand || RNDFB;
    e.maxHealthAttr = Mnt.childHealthBonus(rand);
    if (Mnt.CHESTABLE[e.type]) {
      e.movementSpeedAttr = Mnt.DONKEY_RIDDEN_MOVEMENT_SPEED;
      e.jumpStrengthAttr = Mnt.DONKEY_JUMP_STRENGTH_ATTR;
    } else {
      e.movementSpeedAttr = Mnt.childMovementSpeedBonus(rand);
      e.jumpStrengthAttr = Mnt.childJumpStrengthBonus(rand);
    }
    e.maxHealth = e.maxHealthAttr;
    // `initAttributes` re-rolls only the max_health BASE; the constructor already set Health to the
    // un-rolled `createBaseHorseAttributes` 53 and nothing clamps it (LivingEntity.setHealth is never
    // called), so a fresh /summon'ed horse reads Health 53 over a 15..30 max — golden/mob-attributes.json.
    if (e.health === undefined) {
      var at = NS.Entities && NS.Entities.attrsOf ? NS.Entities.attrsOf(e.type) : null;
      e.health = at && at.hp ? at.hp : e.maxHealth;
    }
    return e;
  };

  /**
   * `HorseBaseEntity.setChildAttributes` (.decomp), the three-attribute averaging alone, no
   * variant -- factored out of `Breed.CHILD.horse` (07m_breed.js) so donkey/mule breeding
   * (`Breed.CHILD.donkey`/`.mule`, same file) can share the exact same arithmetic without a
   * second copy of it. `HorseEntity.createChild`'s own EXTRA half (the colour/marking roll)
   * stays only on the horse path, in `Breed.CHILD.horse` itself -- donkeys/mules have no
   * variant at all (.decomp: neither class tracks one).
   */
  Mnt.setChildAttributes = function (child, a, b, rand) {
    var aHealth = a.maxHealthAttr !== undefined ? a.maxHealthAttr : a.maxHealth;
    var bHealth = b.maxHealthAttr !== undefined ? b.maxHealthAttr : b.maxHealth;
    child.maxHealthAttr = (aHealth + bHealth + Mnt.childHealthBonus(rand)) / 3;
    child.maxHealth = child.maxHealthAttr;
    child.health = child.maxHealth;

    var aJump = a.jumpStrengthAttr !== undefined ? a.jumpStrengthAttr : Mnt.JUMP_STRENGTH_ATTR;
    var bJump = b.jumpStrengthAttr !== undefined ? b.jumpStrengthAttr : Mnt.JUMP_STRENGTH_ATTR;
    child.jumpStrengthAttr = (aJump + bJump + Mnt.childJumpStrengthBonus(rand)) / 3;

    var aSpeed = a.movementSpeedAttr !== undefined ? a.movementSpeedAttr : Mnt.RIDDEN_MOVEMENT_SPEED;
    var bSpeed = b.movementSpeedAttr !== undefined ? b.movementSpeedAttr : Mnt.RIDDEN_MOVEMENT_SPEED;
    child.movementSpeedAttr = (aSpeed + bSpeed + Mnt.childMovementSpeedBonus(rand)) / 3;
  };

  /**
   * QUEUE 0.2 (G18e remainder, Mnt.OWED close) -- `HorseColor`/`HorseMarking` (.decomp, both
   * javap'd in full): 7-entry and 5-entry enums, `byIndex` reading a plain ordinal off
   * `HorseEntity.setVariant(HorseColor, HorseMarking)`'s own bit layout -- color in the low
   * byte, marking shifted into the next: `color.getIndex() & 0xFF | marking.getIndex() << 8 &
   * 0xFF00`. `Mnt.encodeVariant`/`horseColor`/`horseMarking` are that same pack/unpack; this
   * engine keeps the plain 0..6 / 0..4 indices rather than named enum objects, same convention
   * `e.catVariant` already uses for cat (07n_tame.js). The RENDERED base-texture-plus-overlay
   * (the 7 `FAMILY.horse` sheets `tools/extract-mob-textures.mjs` already resolves, plus the
   * marking overlay layer `HorseMarkingFeatureRenderer` draws on top) is a separate, presentation
   * -layer unit -- named on `Mnt.OWED` below, not guessed at without the jar's own texture
   * filenames to check an extraction against.
   */
  Mnt.HORSE_COLOR_COUNT = 7;
  Mnt.HORSE_MARKING_COUNT = 5;
  Mnt.encodeVariant = function (color, marking) {
    return (color & 0xFF) | ((marking << 8) & 0xFF00);
  };
  Mnt.horseColor = function (e) { return (e && e.variant !== undefined) ? (e.variant & 0xFF) : 0; };
  Mnt.horseMarking = function (e) { return (e && e.variant !== undefined) ? ((e.variant & 0xFF00) >> 8) : 0; };

  /** `HorseEntity.initialize` (.decomp): a wild spawn rolls BOTH color and marking uniformly at
   *  random (`Util.getRandom(HorseColor.values(), random)`/same for marking -- a plain
   *  `nextInt(n)` draw over each enum's own length, this file's usual `Math.floor(rand()*n)`
   *  convention). Vanilla's own `HorseEntity.HorseData` re-rolls only the MARKING per individual
   *  spawned this way while sharing one COLOR roll across a whole spawn group -- that group-level
   *  sharing is `EL`'s own spawn-batch machinery to thread through, not this function's job (see
   *  `Mnt.OWED`); called per-entity, `Mnt.rollVariant` alone is exactly `HorseEntity.initialize`'s
   *  fallback branch (`$$3 instanceof HorseData` false), which is every spawn this engine drives
   *  today (no spawn-group batching exists to share a HorseData between siblings).
   */
  Mnt.rollVariant = function (rand) {
    rand = rand || RNDFB;
    var color = Math.floor(rand() * Mnt.HORSE_COLOR_COUNT);
    var marking = Math.floor(rand() * Mnt.HORSE_MARKING_COUNT);
    return Mnt.encodeVariant(color, marking);
  };

  /** `HorseEntity.createChild` (.decomp), the horse+horse half verbatim (the horse+donkey->mule
   *  half needs a mule entity this engine does not build yet -- `Mnt.OWED`, `Breed.CHILD.horse`
   *  itself never runs for a donkey parent, `Br.canMate`'s own `a.type !== b.type` refusal).
   *  Color: `nextInt(9)`, `<4` this parent's own color / `<8` the other parent's / else a fresh
   *  uniform roll. Marking: the SAME three-way shape off `nextInt(5)`, `<2`/`<4`/else.
   */
  Mnt.rollChildVariant = function (a, b, rand) {
    rand = rand || RNDFB;
    var colorRoll = Math.floor(rand() * 9);
    var color = colorRoll < 4 ? Mnt.horseColor(a) : colorRoll < 8 ? Mnt.horseColor(b) : Math.floor(rand() * Mnt.HORSE_COLOR_COUNT);
    var markRoll = Math.floor(rand() * 5);
    var marking = markRoll < 2 ? Mnt.horseMarking(a) : markRoll < 4 ? Mnt.horseMarking(b) : Math.floor(rand() * Mnt.HORSE_MARKING_COUNT);
    return Mnt.encodeVariant(color, marking);
  };

  function isBaby(e) { return !!(NS.Breed && NS.Breed.ready && NS.Breed.isBaby(e)); }

  Mnt.isMountable = function (e) { return !!(e && Mnt.MOUNTABLE[e.type]); };

  // `AbstractHorseEntity.isSaddled` — `HORSE_FLAGS` bit 4, driven by `updateSaddle()` off
  // whether inventory slot 0 is occupied; this engine keeps the one boolean directly rather
  // than re-deriving it from a slot array every read, which is the observable vanilla asks for.
  Mnt.isSaddled = function (e) { return !!(e && e.saddled); };

  // `AbstractHorseEntity.canBeSaddled` — alive, not a baby, tame. `LlamaEntity.canBeSaddled()`
  // (.decomp, loop/llama-s97) overrides this to a flat `false` -- a llama is NEVER saddleable at
  // all, which is exactly what keeps it out of `Mnt.travelRidden`'s steering branch (that call
  // site gates on `isRidden(e) && isSaddled(e)`, 07i_entitylist.js -- `isSaddled` can never
  // become true for a llama once `canBeSaddled` refuses first, so a mounted llama just sits
  // there under its rider, exactly like `LlamaEntity.canBeControlledByRider() == false`).
  Mnt.canBeSaddled = function (e) {
    if (Mnt.isLlama(e)) return false;
    return !!e && e.dead !== true && !isBaby(e) && !!e.tamed;
  };

  // `07u_leash.js`'s own truthy leash state (`e.leashHolder`) -- `FormCaravanGoal.canStart`'s
  // `isLeashed()` question, read from the leash module directly rather than a second flag.
  Mnt.isLeashed = function (e) { return !!(e && e.leashHolder); };

  /** `AbstractHorseEntity.saddle(SoundCategory)`: ENTITY_HORSE_SADDLE, NEUTRAL, 0.5F, 1.0F. */
  Mnt.saddle = function (e) {
    e.saddled = true;
    if (!e.silent && NS.Sound && NS.Sound.entitySound)
      NS.Sound.entitySound('entity.horse.saddle', e.x, e.y, e.z, 0.5, 1, 'neutral', NS.Player);
  };

  Mnt.getTemper = function (e) { return (e && e.temper) | 0; };
  /** `AbstractHorseEntity.addTemper` — clamped to [0, getMaxTemper()], both directions.
   *  `getMaxTemper()` is per-species (`Mnt.maxTemperOf`) — 30 for llama, 100 for everything
   *  else this file mounts (loop/llama-s97). */
  Mnt.addTemper = function (e, n) {
    var t = Mnt.getTemper(e) + (n | 0);
    var max = Mnt.maxTemperOf(e);
    if (t < 0) t = 0; else if (t > max) t = max;
    e.temper = t;
    return t;
  };

  /** `AbstractHorseEntity.bondWithPlayer` — owner + tame, the single-live-player
   *  simplification `EL.aiCtx`'s own header and `Tame.OWED` both already stand on. */
  Mnt.bondWithPlayer = function (e) {
    e.tamed = true;
    e.owner = 'player';
  };

  /** `TraderLlamaEntity.putPlayerOnBack`: held by a WanderingTraderEntity -> no rider. */
  Mnt.isTraderHeld = function (e) {
    var h = e && e.type === 'trader_llama' && e.leashHolder;
    return !!(h && h.kind === 'entity' && h.entity && h.entity.type === 'wandering_trader');
  };

  Mnt.isRidden = function (e) { return !!(e && e.rider); };

  /** `HorseEntity.interactMob`'s bottom fall-through — `putPlayerOnBack`, gated on
   *  `!hasPassengers()` (checked earlier in `interact`) and `!isBaby()`. Mounts an UNTAMED
   *  horse too — vanilla always does; taming is `Ai.HorseBondWithPlayerGoal`'s job, not this
   *  gate's. */
  Mnt.mount = function (e) {
    if (!Mnt.isMountable(e) || isBaby(e) || Mnt.isRidden(e) || Mnt.isTraderHeld(e)) return false;
    e.rider = 'player';
    e.jumpStrength = 0;
    e.inAir = false;
    return true;
  };

  /** `HorseBondWithPlayerGoal.tick`'s own `removeAllPassengers()` on a failed bond roll, and
   *  the ordinary "get off" case (`Mount.OWED`: no dismount KEY is wired to call this from the
   *  live player yet — see the file header). */
  Mnt.dismount = function (e) {
    e.rider = null;
    if (e.cartPassengers) e.cartPassengers.length = 0;
  };

  /**
   * `HorseBaseEntity.receiveFood` — heal, grow (baby only), love (golden carrot/apple, tame
   * and of breeding age only), then temper (ANY of the three items' effects, or simply being
   * UNTAMED, gates it — read off the jar's own `($$2 || !this.isTame())`). Always reports
   * consumed: `interactHorse` decrements the stack unconditionally (outside creative) once the
   * item was recognised as breeding food at all, whether or not any effect actually fired.
   */
  Mnt.feed = function (e, item, ctx) {
    if (!Mnt.ready || !Mnt.isMountable(e)) return null;
    var food = Mnt.foodTable(e)[item];
    if (!food) return null;
    var Br = NS.Breed;
    var did = false;
    if (food.heal > 0 && Br && Br.ready) {
      var max = e.maxHealth, hp = e.health;   // float, as `getHealth() < getMaxHealth()` (#1355)
      if (hp < max) { e.health = Math.min(max, hp + food.heal); did = true; }
    }
    var baby = isBaby(e);
    if (baby && food.grow > 0 && Br && Br.ready) {
      Br.ageUp(e, food.grow, false);
      did = true;
    }
    if (food.love && e.tamed && Br && Br.ready && Br.getAge(e) === 0 && Br.canFallInLove(e)) {
      Br.lovePlayer(e, (ctx && ctx.player) || null);
      did = true;
    }
    if (food.temper > 0 && (did || !e.tamed) && Mnt.getTemper(e) < Mnt.maxTemperOf(e)) {
      Mnt.addTemper(e, food.temper);
      did = true;
    }
    if (did) Mnt.setEating(e);   // receiveFood -> playEatingAnimation -> setEating (flag 64)
    if (did) {   // playEatingAnimation: getEatSound() unless silent (#3577)
      if (NS.Llama && NS.Llama.isLlama(e)) NS.Llama.playEat(e);   // LlamaEntity.receiveFood's eat sound (#680)
      else if (NS.MobVoice) NS.MobVoice.playEat(e);
    }
    return { consumed: true };
  };

  Mnt.isHorseArmor = function (item) { return !!Mnt.ARMOR_BONUS[item]; };

  /** `SaddleItem.useOnEntity` — refuses unless `canBeSaddled() && !isSaddled()`, in which case
   *  it equips directly and reports the item spent. Returns null (PASS) otherwise, exactly as
   *  the jar's `ActionResult.PASS` falls through to the caller's own next branch. */
  Mnt.trySaddleItem = function (e) {
    if (!Mnt.isMountable(e) || Mnt.isSaddled(e) || !Mnt.canBeSaddled(e)) return null;
    Mnt.saddle(e);
    return { consumed: true };
  };

  /**
   * `equipArmor`/`setArmorTypeFromStack` — the MODEL half only (the attribute bonus is stored,
   * not wired into `Combat`'s own damage-reduction path — `Mount.OWED`, real scope, not a slot
   * this unit's `Combat` edits touch). `null`/empty clears the slot exactly as placing nothing
   * over an occupied armour slot does in the real menu.
   */
  Mnt.equipArmor = function (e, itemName) {
    if (!itemName) { e.armorItem = null; e.armorBonus = 0; return; }
    var before = e.armorItem;
    e.armorItem = itemName;
    e.armorBonus = Mnt.ARMOR_BONUS[itemName] || 0;
    // `HorseEntity.onInventoryChanged`: age > 20, new armour is horse armour and differs -> ENTITY_HORSE_ARMOR 0.5, 1.0
    if (before !== itemName && (e.ticksAlive | 0) > 20 && NS.MobVoice && NS.MobVoice.emit) NS.MobVoice.emit(e, 'entity.horse.armor', 0.5, 1.0);
  };

  /**
   * `HorseEntity.interactMob` (javap'd in full, both the base and horse-specific halves),
   * reproduced branch for branch:
   *   1. not baby: sneaking+tame -> "open inventory" (armour screen; `Mount.OWED`, not built —
   *      still consumes the click so a sneak-click on a tame horse never also mounts it);
   *      already ridden -> `super.interactMob` (nothing this engine models, refuses).
   *   2. item in hand: breeding food -> `Mount.feed`; saddle -> `Mount.trySaddleItem` (falls
   *      through on refusal, exactly like `useOnEntity`'s own `PASS`); horse armour -> refuses
   *      untamed (angry, no consume) or "opens" the armour screen tame (`Mount.OWED`, no
   *      consume — the real consumption only happens inside that unbuilt screen); anything
   *      else while untamed -> refuses (angry, no consume).
   *   3. baby -> refuses (no default here); otherwise -> `Mount.mount`.
   * Returns `{ consumed, mounted, opened }` or `null` when this unit has nothing to say (the
   * caller's own fallback, e.g. `Breed.interact`, should not run either way once this returns
   * non-null OR once the entity is a mountable type at all — see `Use.entityUse`'s own call
   * site for why it never falls through past this function for a horse).
   */
  Mnt.interact = function (e, item, ctx) {
    if (!Mnt.ready || !Mnt.isMountable(e)) return null;
    ctx = ctx || {};
    var baby = isBaby(e);
    if (Mnt.isUndeadHorse(e)) {
      if (!e.tamed) return null;
      if (!baby && ctx.crouching) return { consumed: false, opened: true };
      // tamed baby / ridden -> `super.interactMob` (HorseBaseEntity): the generic path below.
      // (Name tag/lead `useOnEntity` is item-side, tried before entityUse.)
      if (!baby && !Mnt.isRidden(e)) {
        if (item === Mnt.SADDLE_ITEM && !Mnt.isSaddled(e)) return { consumed: false, opened: true };
        Mnt.mount(e);
        return { consumed: false, mounted: true };
      }
    }
    if (!baby) {
      if (e.tamed && ctx.crouching) return { consumed: false, opened: true };
      if (Mnt.isRidden(e)) return { consumed: false };
    }
    if (item) {
      var food = Mnt.foodTable(e)[item];
      if (food) return Mnt.feed(e, item, ctx);
      if (item === Mnt.SADDLE_ITEM) {
        var sad = Mnt.trySaddleItem(e);
        if (sad) return sad;
      } else if (Mnt.hasArmorSlot(e) && Mnt.isHorseArmor(item)) {
        if (!e.tamed) { Mnt.playAngrySound(e); return { consumed: false }; }
        return { consumed: false, opened: true };
      } else if (Mnt.hasDecorSlot(e) && Mnt.isCarpetItem(item)) {
        // `LlamaEntity.isHorseArmor`/`hasArmorSlot` (.decomp, loop/llama-s97): the SAME
        // "recognised, tame required, opens the screen, no direct equip" shape the horse-armour
        // branch just above already runs -- the real placement happens inside `Mnt.menu`'s own
        // slot-1 `mayPlace`/`onChanged` (below), never here (see that branch's own header for
        // why: `HorseArmorItem`/carpet both have no `useOnEntity` override, so both always PASS
        // through to `interactMob`, which only ever *opens* the screen for either one).
        if (!e.tamed) { Mnt.playAngrySound(e); return { consumed: false }; }
        return { consumed: false, opened: true };
      } else if (Mnt.isChestable(e) && !e.hasChest && item === Mnt.CHEST_ITEM) {
        // `AbstractDonkeyEntity.interactMob` (.decomp): tame, chestless, holding a `chest` ->
        // `setHasChest(true)`, consumed, no screen (the untamed case falls through to the
        // ordinary "refuse" branch immediately below, same as the jar's own earlier
        // `!this.isTame()` check that this engine folds into the one shared gate).
        if (e.tamed) {
          Mnt.addChest(e);
          return { consumed: true };
        }
      }
      if (!e.tamed) { Mnt.playAngrySound(e); return { consumed: false }; }
    }
    if (baby) return null;
    if (Mnt.isTraderHeld(e)) return { consumed: false };
    Mnt.mount(e);
    return { consumed: false, mounted: true };
  };

  /**
   * `HorseBaseEntity.travel()`'s RIDDEN+SADDLED branch, verbatim arithmetic: rotation sync
   * (yaw from the rider, pitch halved), the on-ground/angry/no-charge freeze, the charged jump
   * (injected velocity + the forward horizontal kick, `jumpStrength` reset to 0 either way),
   * `setMovementSpeed` to the ridden-only attribute, then the SAME `Ph.travelMob` every AI-
   * driven mob already runs for friction/gravity/collision — now given the rider's `sideways`
   * as its new `xxa` parameter instead of always 0. `rider` is `{forwardSpeed, sidewaysSpeed,
   * yaw, pitch}` — real player input in the browser, `Mount.OWED` for the wiring that supplies
   * it (see the file header) and a plain object in `mountcheck.mjs`.
   */
  Mnt.travelRidden = function (e, rider) {
    // QUEUE 0.2 G18e remainder -- `e.riderInput` is the live wiring: `14_player.js`'s own tick
    // writes `{forwardSpeed, sidewaysSpeed, yaw, pitch}` onto the mount entity every tick while
    // ridden by the live player, the same shape `mountcheck.mjs` already drives this function
    // with directly (a plain object). Falling back to `{}` is what kept a ridden horse standing
    // dead still before this session -- `07i_entitylist.js`'s own call site (`Ai`'s per-mob
    // tick, `HorseBaseEntity.travel`'s call site) has never passed a second argument at all.
    rider = rider || e.riderInput || {};
    var Ph = NS.Physics;
    if (rider.yaw !== undefined) e.yaw = rider.yaw;
    e.pitch = (rider.pitch || 0) * 0.5;
    var sideways = (rider.sidewaysSpeed || 0) * 0.5;
    var forward = rider.forwardSpeed || 0;
    if (forward <= 0) { forward *= 0.25; e.soundTicks = 0; }

    if (e.onGround && (e.jumpStrength || 0) === 0 && e.angry && !e.jumping) {
      sideways = 0; forward = 0;
    }

    if ((e.jumpStrength || 0) > 0 && !e.inAir && e.onGround) {
      // `HorseBaseEntity.travel()`: `getJumpStrength() * this.jumpStrength *
      // getJumpVelocityMultiplier()` -- `getJumpStrength()` is THIS horse's own per-spawn-rolled
      // `jump_strength` attribute (QUEUE 0.2 G18e remainder, `Mnt.rollAttributes`), not the
      // flat `LivingEntity.getJumpVelocity()` constant `Mnt.JUMP_VELOCITY_BASE` names (that one
      // is the ordinary two-legged jump, a different method the horse overrides away) -- the
      // fallback keeps a fixture/save with no roll on it jumping at the attribute's own default.
      var jumpAttr = e.jumpStrengthAttr !== undefined ? e.jumpStrengthAttr : Mnt.JUMP_STRENGTH_ATTR;
      var jv = jumpAttr * e.jumpStrength * Ph.jumpFactorOf(e); // getJumpVelocityMultiplier(): honey 0.5
      jv += Mnt.jumpBoostVelocityModifier(e);           // D-550: LivingEntity.getJumpBoostVelocityModifier
      e.vy = jv;
      e.inAir = true;
      if (forward > 0) {
        var sy = Math.sin(e.yaw), cy = Math.cos(e.yaw);
        e.vx += -0.4 * sy * e.jumpStrength;
        e.vz += 0.4 * cy * e.jumpStrength;
      }
      e.jumpStrength = 0;
    }

    // `setMovementSpeed` to THIS horse's own rolled `movement_speed` attribute (QUEUE 0.2
    // G18e remainder), falling back to the flat default for an unrolled fixture/save.
    var tbl = NS.Entities.attrsOf(e.type);   // zombie/skeleton horse base is 0.2, not the horse's 0.225
    e.mobSpeed = e.movementSpeedAttr !== undefined ? e.movementSpeedAttr : (tbl && tbl.speed ? tbl.speed : Mnt.RIDDEN_MOVEMENT_SPEED);
    e.jumping = false;   // the charged jump above already applied vy — Ph.travelMob's own
                          // flat-0.42 jump gate must not ALSO fire this tick.
    e.zza = forward;
    e.airStrafingSpeed = e.mobSpeed * 0.1;   // HorseBaseEntity.travel: airStrafingSpeed = getMovementSpeed() * 0.1F
    Ph.travelMob(e, sideways);
    e.airStrafingSpeed = 0;

    if (e.onGround) { e.jumpStrength = 0; e.inAir = false; }
  };

  /**
   * `AbstractHorseEntity.setJumpStrength(int 0..90)` — `canJump()`/gate on `isSaddled()`
   * folded in here rather than left to the caller, same as the jar's own method does.
   */
  /**
   * `Entity.getMountedHeightOffset()` -- unoverridden by `HorseBaseEntity`/`HorseEntity`
   * (only `updatePassengerPosition`'s angry-buck wobble reads it, at the SAME value), so the
   * jar's own default -- `dimensions.height * 0.75` -- is the real number for a plain,
   * non-bucking mount. `getHeightOffset()` of the PASSENGER (the player) is `Entity`'s own
   * default `0.0`, never overridden by `PlayerEntity`, so it does not appear here at all.
   */
  Mnt.mountedHeightOffset = function (e) {
    var Ent = NS.Entities;
    var h = (Ent && e && Ent.height(e.type)) || 0;
    // SkeletonHorseEntity.getMountedHeightOffset = super - 0.1875 (#4228)
    // AbstractDonkeyEntity.getMountedHeightOffset = super - 0.25 (#4531)
    var t = e && e.type;
    if (t && /minecart$/.test(t)) return 0;   // AbstractMinecartEntity.getMountedHeightOffset
    return h * 0.75 - (t === 'skeleton_horse' ? 0.1875 : (t === 'donkey' || t === 'mule') ? 0.25 : 0);
  };

  /** `HorseBaseEntity.updatePassengerPosition` (l.927-936): while `lastAngryAnim` > 0 the rider swings back 0.7*p along the body yaw and up 0.15*p. */
  Mnt.riderOffset = function (e) {
    var p = e.lastAngryAnim || 0;
    if (!(p > 0)) return { x: 0, y: 0, z: 0 };
    var by = e.yBodyRot !== undefined ? e.yBodyRot : (e.yaw || 0);
    return { x: 0.7 * p * Math.sin(by), y: 0.15 * p, z: -0.7 * p * Math.cos(by) };
  };

  /**
   * `Entity.getPassengerDismountOffset(double mountWidth, double riderWidth, float yaw)`
   * (`Entity.java`), verbatim: half the combined width (plus vanilla's own float-precision
   * epsilon), rotated by `yaw` and rescaled so the LARGER of |sin|,|cos| is exactly 1 -- which
   * is what makes the offset always land just past the mount's own hitbox on whichever side
   * the yaw points, not a diagonal corner short of it.
   */
  Mnt.dismountOffset = function (mountWidth, riderWidth, yaw) {
    var half = ((mountWidth || 0) + (riderWidth || 0) + 1e-5) / 2;
    var sx = -Math.sin(yaw), cz = Math.cos(yaw);
    var scale = Math.max(Math.abs(sx), Math.abs(cz)) || 1;
    return { x: sx * half / scale, z: cz * half / scale };
  };

  /**
   * QUEUE 0.2 (G18e remainder, Mount.OWED close) -- `Dismounting.canDismountInBlock`/
   * `BlockView.getDismountHeight`/`Dismounting.canPlaceEntityAt`, folded into one column probe
   * because this engine's own collision (`Ph.solidAt`, `14b_physics.js`) is already boolean
   * full-block, not a VoxelShape -- there is no partial-height slab/stair collider anywhere in
   * this engine's physics, so `getDismountHeight`'s own "empty here, take the block-below's
   * shape top" branch collapses to exactly one case: empty here AND solid below => stand at
   * this cell's own floor (height 0 within the cell); anything else (`hereSolid`, or nothing
   * solid below) is what `canDismountInBlock`/`getDismountHeight`'s own -Infinity branch both
   * refuse. `canPlaceEntityAt` is the SAME boolean check one cell further up -- a standing
   * rider is two blocks tall (`EntityPose` in this engine is only ever "standing"; no crouch/
   * swim bounding-box variant exists to iterate `LivingEntity.getPoses()` over -- named, not
   * guessed past). Scans `HorseBaseEntity.locateSafeDismountingPos`'s own column, from the
   * mount's own feet up to its height+0.75, lowest valid cell wins (do-while, jar-verbatim).
   */
  Mnt.locateSafeDismountingPos = function (e, offset, Physics) {
    if (!e || !offset || !Physics || !Physics.solidAt) return null;
    var Ent = NS.Entities;
    var bx = e.x + offset.x, bz = e.z + offset.z;
    var fx = Math.floor(bx), fz = Math.floor(bz);
    var minY = Math.floor(e.y);
    var h = (Ent && Ent.height(e.type)) || 1.6;
    var maxY = e.y + h + 0.75;
    for (var y = minY; y < maxY; y++) {
      var hereSolid = Physics.solidAt(fx, y, fz);
      var floorSolid = Physics.solidAt(fx, y - 1, fz);
      var aboveSolid = Physics.solidAt(fx, y + 1, fz);
      if (!hereSolid && floorSolid && !aboveSolid) return { x: bx, y: y, z: bz };
    }
    return null;
  };

  /**
   * `AbstractHorseEntity.updatePassengerForDismount` (.decomp) -- main-arm side first (yaw+90),
   * then the other side (yaw-90), each run through the column probe above; `null` on BOTH (the
   * jar's own final `this.getPos()` fallback) is left to the caller, `P.dismountVehicle`
   * (14_player.js), same shape as before this pass -- only the probe itself changed.
   */
  Mnt.findDismountPos = function (e, riderWidth, Physics) {
    if (!e) return null;
    var Ent = NS.Entities;
    if (e.type === 'strider' && NS.Strider && NS.Strider.findDismountPos)
      return NS.Strider.findDismountPos(e, riderWidth, NS.Player ? NS.Player.yaw : e.yaw, Physics);
    if (/minecart$/.test(e.type) && NS.Minecart && NS.Minecart.findDismountPos && Physics) return NS.Minecart.findDismountPos(e, Physics);
    var mw = (Ent && Ent.width(e.type)) || 0;
    var tries = [e.yaw + Math.PI / 2, e.yaw - Math.PI / 2];
    for (var i = 0; i < tries.length; i++) {
      var off = Mnt.dismountOffset(mw, riderWidth, tries[i]);
      var pos = Mnt.locateSafeDismountingPos(e, off, Physics);
      if (pos) return pos;
    }
    return null;
  };

  Mnt.setJumpStrength = function (e, charge) {
    if (!Mnt.isSaddled(e)) return;
    if (charge < 0) charge = 0;
    else { e.jumping = true; Mnt.updateAnger(e); }   // HorseBaseEntity.setJumpStrength (.decomp 865-872)
    if (charge >= 90) e.jumpStrength = 1.0;
    else e.jumpStrength = Math.fround(Math.fround(0.4) + Math.fround(Math.fround(Math.fround(0.4) * charge) / 90));   // float math, as `0.4F + 0.4F * (float)$$0 / 90.0F`
  };

  /**
   * `Menu.horseMenu`-shaped container: slot 0 saddle, slot 1 horse armour (only meaningful
   * for `hasArmorSlot()` — true for `HorseEntity`, the only type this session builds), then
   * the player's own 27+9. Built off `NS.Menu`'s primitives the exact way `Menu.chestMenu`
   * already is — see the file header for why nothing calls this from `Use.entityUse` yet.
   */
  /**
   * `HorseScreenHandler` (.decomp): saddle (0) and armour (1) always exist as SLOTS (armour's
   * own `isEnabled()`/`canInsert` both gate on `hasArmorSlot()`, false for donkey/mule, so this
   * engine simply never lets one accept an item rather than modelling a disabled-but-present
   * slot no interaction can ever reach). `AbstractDonkeyEntity.getInventorySize()` is 17 with a
   * chest, `HorseBaseEntity`'s own base 2 otherwise -- `bank`'s length IS `Mnt.isChestable(e) &&
   * e.hasChest ? 17 : 2`, re-sized in place (old contents kept by index) the moment a chest is
   * attached mid-session (`Mnt.interact`'s own chest branch above never touches `mountItems`
   * itself, only `e.hasChest` -- this is the one place the array actually grows).
   */
  Mnt.menu = function (e, inventory) {
    var M = NS.Menu;
    if (!M) return null;
    var I = NS.Inventory;
    var chest = Mnt.isChestable(e) && !!e.hasChest;
    // `getInventorySize()` (.decomp): `hasChest() ? 2 + 3*getInventoryColumns() : 2` -- donkey/
    // mule's own columns is a flat 5 (17 slots total, unchanged from loop/donkey-s96); a llama's
    // is `getStrength()` (1..5, loop/llama-s97, `Mnt.inventoryColumns` above), so ITS chest can
    // be 5/8/11/14/17 slots depending on the roll -- and the screen draws/clicks exactly that
    // many columns (`Gui.horseSlotXY(i, cols)`, D-550).
    var size = chest ? (2 + 3 * Mnt.inventoryColumns(e)) : 2;
    var bank = e.mountItems;
    if (!bank || bank.length !== size) {
      var old = bank || [];
      bank = new Array(size).fill(null);
      for (var oi = 0; oi < old.length && oi < size; oi++) bank[oi] = old[oi];
      e.mountItems = bank;
    }
    var mountC = M.container(
      function (i) { return bank[i] || null; },
      function (i, s) { bank[i] = (I && I.isEmpty(s)) ? null : s; },
      function (i, count) {
        var s = bank[i];
        if (!s || (I && I.isEmpty(s))) return null;
        var out = I.split(s, count);
        if (s.n <= 0) bank[i] = null;
        return out;
      },
      size
    );
    var saddleName = function (s) { return s && NS.Items ? NS.Items.nameOf(s.i) : null; };
    var slots = [];
    slots.push(M.slot(mountC, 0, {
      mayPlace: function (s) { return saddleName(s) === Mnt.SADDLE_ITEM; },
      onChanged: function () { e.saddled = !!bank[0]; }
    }));
    // Slot 1 -- horse armour for `HorseEntity`, the CARPET decoration for a llama
    // (`Mnt.hasDecorSlot`, loop/llama-s97: `LlamaEntity.hasArmorInSlot()`/`updateSaddle()` read
    // this SAME slot 1, .decomp) -- never both, `Mnt.hasArmorSlot`/`Mnt.hasDecorSlot` are
    // mutually exclusive per `Mnt.isLlama`.
    slots.push(M.slot(mountC, 1, {
      mayPlace: function (s) {
        var n = saddleName(s);
        if (Mnt.hasDecorSlot(e)) return Mnt.isCarpetItem(n);
        return Mnt.hasArmorSlot(e) && Mnt.isHorseArmor(n);
      },
      onChanged: function () {
        if (Mnt.hasDecorSlot(e)) {
          // `updateSaddle()`'s own llama half: `setCarpetColor(getColorFromCarpet(items.get(1)))`.
          var ci = bank[1] ? Mnt.carpetColorIndex(saddleName(bank[1])) : -1;
          var before = e.carpetColor;
          e.carpetColor = ci >= 0 ? ci : null;
          if (NS.Llama) NS.Llama.onCarpetChanged(e, before);
        } else if (Mnt.hasArmorSlot(e)) {
          Mnt.equipArmor(e, bank[1] ? saddleName(bank[1]) : null);
        }
      }
    }));
    // `HorseScreenHandler`'s own `hasChest` branch: 3 rows x `getInventoryColumns()`,
    // starting at inventory index 2 -- plain slots, no `canInsert` restriction in the jar.
    if (chest) for (var ci2 = 2; ci2 < size; ci2++) slots.push(M.slot(mountC, ci2, {}));
    var invC = M.inventoryContainer(inventory);
    for (var p = 9; p < 36; p++) slots.push(M.slot(invC, p));
    for (var h = 0; h < 9; h++) slots.push(M.slot(invC, h));
    var m = M.create(slots, {});
    m.horse = e;
    m.inventory = inventory;
    m.chest = chest;
    return m;
  };

  /**
   * D-550 -- the whole `dropInventory()` chain a dying mount runs from `LivingEntity.drop`
   * (.decomp line 1343: called UNCONDITIONALLY, outside the `shouldDropLoot && doMobLoot` gate
   * the loot table and equipment sit behind -- so a mount's inventory drops even with
   * doMobLoot off). `HorseBaseEntity.dropInventory` (.decomp 531-541): every non-empty stack in
   * `items` -- slot 0 saddle, slot 1 armour/carpet, slots 2.. the chest -- EXCEPT one carrying
   * Curse of Vanishing. Then `AbstractDonkeyEntity.dropInventory` (.decomp 64-73): a chested
   * donkey/mule/llama drops one `chest` and clears the flag.
   * ⚠ THE SADDLE MAY LIVE IN THE FLAG ONLY: `Mnt.saddle` (the right-click path) sets `e.saddled`
   * without ever writing slot 0 (the menu's slot 0 `onChanged` is the only writer), where
   * vanilla's `saddle()` puts the stack IN `items`. So an empty slot 0 on a saddled mount drops
   * one saddle -- the same item vanilla's slot 0 would hold -- and a filled one drops its stack;
   * never both. Returns [{item, count}] (the caller spawns them -- `Cb.dropLoot`, 14j).
   */
  Mnt.dropInventory = function (e) {
    var out = [];
    if (!e) return out;
    var bank = e.mountItems || [];
    var Items = NS.Items, Cb = NS.Combat;
    var nameOf = function (s) { return s && Items && Items.nameOf ? Items.nameOf(s.i) : null; };
    var vanishing = function (s) { return !!(Cb && Cb.enchantLevel && Cb.enchantLevel(s, 'vanishing_curse') > 0); };
    if (Mnt.isMountable(e) && e.saddled && !bank[0] && Mnt.canBeSaddled(e)) out.push({ item: Mnt.SADDLE_ITEM, count: 1 });
    for (var i = 0; i < bank.length; i++) {
      var st = bank[i];
      if (!st || !(st.n > 0) || vanishing(st)) continue;
      var nm = nameOf(st); if (nm) out.push({ item: nm, count: st.n });
    }
    e.mountItems = bank.length ? new Array(bank.length).fill(null) : e.mountItems;
    e.saddled = false;   // the saddle left with the rest -- a second call (none in play: one death) drops nothing
    if (Mnt.isChestable(e) && e.hasChest) { out.push({ item: Mnt.CHEST_ITEM, count: 1 }); e.hasChest = false; }
    return out;
  };

  /** `LivingEntity.getJumpBoostVelocityModifier` (.decomp 1977-1981): `0.1F * (amplifier + 1)`
   *  in FLOAT, widened to double, while Jump Boost is active; 0 otherwise (D-550). */
  Mnt.jumpBoostVelocityModifier = function (e) {
    var ES = NS.Effects || NS.StatusEffects;
    var amp = ES && ES.amplifierOf ? ES.amplifierOf(e, 'jump_boost') : -1;
    return amp >= 0 ? Math.fround(Math.fround(0.1) * (amp + 1)) : 0;
  };

  /**
   * D-550 -- `HorseBaseEntity.playAngrySound` -> `updateAnger` (.decomp 671-693): if not already
   * angry, `angryTicks = 1` and `setAngry(true)` (which also clears the eat-grass flag). Vanilla
   * calls it from an untamed mount refusing a non-food item (`HorseEntity`/`AbstractDonkeyEntity.
   * interactMob`, both .decomp) and from a failed `HorseBondWithPlayerGoal` buck. The sound
   * itself is `Use.OWED`'s standing sound gap, the STATE is exact.
   */
  Mnt.playAngrySound = function (e) {
    if (!e || e.angry) return;
    if (NS.Llama && NS.Llama.isLlama(e)) NS.Llama.playAngry(e);   // getAngrySound (#680)
    else if (NS.MobVoice && NS.MobVoice.playAngry) NS.MobVoice.playAngry(e);   // horse/donkey/mule getAngrySound (#3576)
    e.angryTicks = 1;
    e.angry = true;
    e.eatingGrass = false;
  };
  /** `HorseBaseEntity.updateAnger` (.decomp 671-): the state half of playAngrySound, no angry voice. */
  Mnt.updateAnger = function (e) {
    if (!e) return;   // unconditional: an already-angry mount restarts its 20-tick timer (.decomp 678-683)
    e.angryTicks = 1;
    e.angry = true;
    e.eatingGrass = false;
  };
  /** `HorseBaseEntity.startJumping` (.decomp 888-892): jumping, updateAnger, playJumpSound (0.4, 1.0). */
  Mnt.startJumping = function (e) {
    e.jumping = true;
    Mnt.updateAnger(e);
    if (NS.MobVoice && NS.MobVoice.emit) NS.MobVoice.emit(e, e.type === 'skeleton_horse' && e.inWater ? 'entity.skeleton_horse.jump_water' : 'entity.horse.jump', 0.4, 1.0);   // SkeletonHorseEntity.playJumpSound (#4229)
  };
  /** `HorseBaseEntity.tick` (.decomp 597-600): `angryTicks > 0 && ++angryTicks > 20` clears the
   *  flag -- the rear-up lasts 20 ticks, then the horse calms (D-550). Called per tick from
   *  `Cb.tickEntity` for every mountable. */
  Mnt.ANGRY_TICKS = 20;
  Mnt.tickAnger = function (e) {
    if (e && e.angryTicks > 0 && ++e.angryTicks > Mnt.ANGRY_TICKS) { e.angryTicks = 0; e.angry = false; }
  };

  /** `HorseBaseEntity.isImmobile` (.decomp l.517), the part this engine models: eating grass or angry. */
  Mnt.isImmobile = function (e) { return !!(e && (e.eatingGrass || e.angry)); };

  /** `HorseBaseEntity.setEating` (flag 64 + eatingTicks = 1), as `receiveFood` -> `playEatingAnimation` does. */
  Mnt.setEating = function (e) { if (e) { e.eatingFlag = true; e.eatingTicks = 1; } };

  /** `HorseBaseEntity.tickMovement` (.decomp l.544-571), server half. `rand` = `nextInt(n)` source
   *  (a function n -> 0..n-1; default Math.random based), `blockBelow` = state id under the feet. */
  Mnt.tickMovement = function (e, rand, blockBelowIsGrass) {
    if (!e) return;
    var nextInt = rand || function (n) { return Math.floor(RNDFB() * n); };
    if (nextInt(200) === 0) e.tailWagTicks = 1;
    if (e.dead || !(e.health > 0)) return;
    if (nextInt(900) === 0 && !(e.deathTime > 0)) {
      e.health = Math.min(e.maxHealth, e.health + 1);
      e.healCount = (e.healCount | 0) + 1;
    }
    var grass = typeof blockBelowIsGrass === 'function' ? blockBelowIsGrass : function () { return !!blockBelowIsGrass; };
    if (!Mnt.isLlama(e)) {   // LlamaEntity.eatsGrass() == false
    if (!e.eatingGrass && !e.rider && nextInt(300) === 0 && grass()) e.eatingGrass = true;
    if (e.eatingGrass && ++e.eatingGrassTicks > 50) { e.eatingGrassTicks = 0; e.eatingGrass = false; }
    }
    Mnt.walkToParent(e);
  };

  /** `HorseBaseEntity.walkToParent` (l.573): a bred baby not eating grass paths toward the nearest bred horse within 16 if > 2 away. */
  Mnt.walkToParent = function (e) {
    var EL = NS.EntityList, Ai = NS.Ai;
    if (NS.Llama && NS.Llama.isFollowing(e)) return;   // LlamaEntity.walkToParent: only when !isFollowing()
    if (!e.bred || !isBaby(e) || e.eatingGrass || !EL || !EL.list || !Ai || !Ai.findPath || !Ai.stepToward) return;
    var best = null, bd = 256;
    for (var i = 0; i < EL.list.length; i++) {
      var o = EL.list[i];
      if (o === e || o.removed || o.dead || !o.bred || !Mnt.isMountable(o)) continue;
      var d = (o.x - e.x) * (o.x - e.x) + (o.y - e.y) * (o.y - e.y) + (o.z - e.z) * (o.z - e.z);
      if (d <= bd) { bd = d; best = o; }
    }
    if (!best || bd <= 4) return;
    var path = Ai.findPath(e.x, e.y, e.z, best.x, best.y, best.z, { mob: e, partial: true });
    if (path && path.length > 1) Ai.stepToward(e, path[1], 1.0);
  };

  /** `HorseBaseEntity.tick` (l.590-658): eating flag timeout, tail wag and the three animation progress lerps. */
  Mnt.tick = function (e) {
    if (!e) return;
    if (e.eatingTicks > 0 && ++e.eatingTicks > 30) { e.eatingTicks = 0; e.eatingFlag = false; }
    if (e.tailWagTicks > 0 && ++e.tailWagTicks > 8) e.tailWagTicks = 0;
    var lerp = function (cur, on, k, c) {
      if (on) return Math.min(1, cur + (1 - cur) * k + c);
      return Math.max(0, cur + ((0 - cur) * k - c));
    };
    e.eatingGrassAnim = e.eatingGrassAnim || 0;
    e.lastEatingGrassAnim = e.eatingGrassAnim;
    e.eatingGrassAnim = lerp(e.eatingGrassAnim, !!e.eatingGrass, 0.4, 0.05);
    e.angryAnim = e.angryAnim || 0;
    e.lastAngryAnim = e.angryAnim;
    if (e.angry) {
      e.eatingGrassAnim = 0; e.lastEatingGrassAnim = 0;
      e.angryAnim = Math.min(1, e.angryAnim + (1 - e.angryAnim) * 0.4 + 0.05);
    } else {
      var a = e.angryAnim;
      e.angryAnim = Math.max(0, a + ((0.8 * a * a * a - a) * 0.6 - 0.05));
    }
    e.eatingAnim = e.eatingAnim || 0;
    e.lastEatingAnim = e.eatingAnim;
    e.eatingAnim = lerp(e.eatingAnim, !!e.eatingFlag, 0.7, 0.05);
  };

  Mnt.OWED = [
    // loop/donkey-s96 (QUEUE 0.2 G18e remainder close) -- donkey/mule\'s placement tier
    // (Ai.ROSTER.donkey/.mule, 07k_goals.js -- the SAME goal list as horse, reusing
    // Ai.ROSTER.horse itself: nothing in it names a species), taming/riding/saddle
    // (Mnt.MOUNTABLE/Mnt.hasArmorSlot above -- horse\'s own code was already
    // species-generic, exactly as the prior pass\'s own note said it would need to be), the
    // CHEST (e.hasChest, Mnt.interact\'s chest branch, Mnt.menu\'s 2->17-slot resize, the
    // real horse-screen grid at Gui.HORSE.chest/Gui.horseSlotXY) and horse x donkey -> mule
    // breeding (Breed.CHILD_SPECIES, Breed.MATE.mule always false -- mule is infertile,
    // MuleEntity never overrides canBreedWith at all, .decomp confirmed this pass) are now
    // BUILT, not merely named. Left for a later pass, still named rather than guessed:
    // loop/nbtsave-s104 -- CLOSED. e.hasChest/e.mountItems/e.saddled/e.tamed/e.variant/
    // e.catVariant/e.woolColor and every other live mob field this engine sets now round-trips
    // through 16b_save.js (07zw_mobnbt.js's own generic per-species field table + EL.spawn's
    // generic opts-copy step; mobnbtcheck.mjs proves it, species by species, off a real
    // S.save()/S.load() round trip). AbstractDonkeyEntity.writeCustomDataToNbt's own
    // ChestedHorse + Items-list-with-Slot-byte NBT shape was read this pass too, but this
    // engine's save format is JSON, not real NBT, so the shape informed the field LIST
    // (hasChest/mountItems) rather than being reproduced byte-for-byte -- named here rather
    // than silently dropped. e.shooter on a live arrow remains the one documented
    // non-persisted reference field (07i_entitylist.js's own pre-existing note, unchanged and
    // unwidened by this pass).

    // loop/llama-s97 (QUEUE 0.2 G18e remainder close) -- llama\'s own taming/mounting
    // (Mnt.MOUNTABLE.llama, canBeSaddled always false so it never reaches travelRidden\'s
    // steering branch -- llamas are never player-steerable in vanilla, LlamaEntity.
    // canBeControlledByRider()==false, .decomp confirmed this pass, not a gap), the CHEST at
    // Mnt.inventoryColumns\'s own per-strength size (2+3*strength, not donkey/mule\'s flat 17),
    // the carpet DECORATION slot (Mnt.hasDecorSlot/isCarpetItem/carpetColorIndex, the same
    // slot 1 horse armour uses), its own per-species FOOD/temper table (Mnt.LLAMA_FOOD,
    // Mnt.maxTemperOf==30) and breeding (Breed.CHILD.llama, 07m_breed.js) are now BUILT.
    // 07k_goals.js\'s own Ai.ROSTER.llama adds the placement tier, the spit attack
    // (Ai.ProjectileAttackGoal + Ll.spit, 07ze_llama.js) and FormCaravanGoal
    // (Ai.FormCaravanGoal + Ll.canStartCaravan/canFollowChain). Left for a later pass:
    // QUEUE 0.2 (G18e remainder, unit A, RENDER close) -- the two bullets that used to sit
    // here (the llama carpet/variant-colour RENDER layer, and the horse/donkey/mule colour-
    // marking RENDER + donkey/mule/llama CHEST-model overlay) are now BUILT:
    // Ll.skinKey/Mnt.HORSE_ARMOR_TEX_INDEX/Mnt.hideChestParts (this file, 07ze_llama.js) plus
    // the overlay pushes + hideParts channel in 07j_entityrender.js, verified by
    // tools/mountrendercheck.mjs. Horse ARMOUR overlay (HorseArmorFeatureRenderer) was not
    // previously named here at all -- also built, same pass.
    // loop/wtrader-s103 -- TRADER_LLAMA's own escort/spawn substrate this bullet used to name
    // as entirely missing now EXISTS: `wandering_trader` has a real Ai.ROSTER entry and a real
    // WanderingTraderManager port (WT.tickManager, 07zt_wtrader.js), a trader llama really
    // spawns leashed to a real trader (WT.spawnLlama), `e.leashHolder`'s `{kind:'entity'}` case
    // renders (Ls.holderAnchor, 07u_leash.js), DefendTraderGoal is a real targetSelector entry
    // (Ll.DefendTraderGoal, 07ze_llama.js) and despawn ties to the holding trader
    // (Ll.tickTraderLlamaDespawn). Left for a later pass, still named rather than guessed:
    // (`putPlayerOnBack` refusal while trader-held is now wired: Mnt.isTraderHeld, #679.) Formerly: NOT wired this pass
    // (this file's own `Mnt.canBeSaddled` already refuses a llama passenger mount before that
    // branch could ever be reached, so tracing whether `Mnt.mount` has a live llama-riding path
    // at all was out of this unit's own scope) -- named on `WT.OWED`/`Ll.OWED`
    // (07zt_wtrader.js/07ze_llama.js), not silently dropped.
    'the cosmetic wander-to-a-random-point half of HorseBondWithPlayerGoal while bucking ' +
      '(NoPenaltyTargeting); the jump/angry/chest-attach SOUND effects (the angry STATE and its ' +
      '20-tick clear are built, D-550)',
  ];

})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
