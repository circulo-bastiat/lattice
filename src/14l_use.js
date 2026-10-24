// 14l_use.js — PLAN G19: RIGHT-CLICK. The block's own `use`, then the item's (D-361).
// Runs on: MAIN THREAD ONLY. No DOM, no GL — every rule is a state change plus a sound.
//
// ⚠⚠ **WHY THIS FILE EXISTS, AND THE HOLE IS BIGGER THAN THE REPORT.** Dan, 15 Sept 2026:
// *"there are no in hand models for items like zombie eggs and candles neither do they place."*
// The in-hand half is D-359. The placing half turned out to be one true case inside a much
// larger absence: **this engine had no right-click dispatch at all.** `Player.act`'s entire
// right-button branch was `P.placeBlock()`, which reads `P.hotbar[slot]` — a BLOCK STATE — so:
//
//   · a door could be PLACED and never OPENED. Nor could a trapdoor, a fence gate, a lever, a
//     button, a repeater or a comparator: **no block in the game had a right-click behaviour**,
//     and G15 shipped four redstone stages whose only switch could not be thrown by hand.
//   · every item whose right-click is not "place a block" did nothing at all — flint and steel,
//     both buckets, the hoe, the shovel, the axe, spawn eggs, boats, paintings.
//
// ⚠ The audit that found it also cleared six things Dan may have suspected: candles, doors,
// beds, rails, banners, chests, signs, stairs, slabs, panes and saplings all PLACE correctly,
// and ladders, seeds and sugar cane refuse for reasons that are vanilla's own (a ladder needs a
// wall, seeds need farmland). **The placement path was fine; the interaction path did not exist.**
//
// ── THE ORDER IS VANILLA'S AND IT IS THE WHOLE ARCHITECTURE ──────────────────────────────────
// `MultiPlayerGameMode.useItemOn`:
//
//     if (!secondaryUseActive || hands are empty)  -> blockState.use(...)   ; if it consumed, stop
//     if the stack is not empty                    -> item.useOn(context)   ; if it consumed, stop
//     (no block hit, or both passed)               -> item.use(...)
//
// ⚠ **THE SNEAK CLAUSE IS NOT A DETAIL.** Crouching with something in your hand SKIPS the block's
// own use, which is how you place a block against a chest instead of opening it. A clone without
// it makes half the game's furniture impossible to build next to.
//
// ── WHAT IS HERE, AND WHAT IS NAMED AS OWED ─────────────────────────────────────────────────
// `Use.OWED` carries every interaction that needs a system this engine has not built — a screen
// for a chest, a mob for a spawn egg — and `usecheck` holds the list closed, so a silent "nothing
// happened" is always either a failure or a written-down deviation. Dan's rule, session 11:
// *"do not half do a feature"*.

(function (NS) {
  'use strict';

  var Use = NS.Use = { ready: false };
  // RNG owners (#6447): player-side rolls (sounds, throw spread, shield, food effects) draw from the
  // player's own JRandom (P.random); block-side rolls (tripwire, bubble columns, block dust) from the
  // world's (Behave.rng, else the world seed). Never Math.random.
  function pRand() { var P = NS.Player || Use; if (!P.random) P.random = new NS.JRandom(BigInt.asIntN(64, ((NS.World && NS.World.seed64) || 0n) ^ 0x5DEECE66Dn)); return P.random.nextDouble(); }
  function wRand() { var B = NS.Behave; if (B && B.rng) return B.rng(); var W = NS.World; if (!W) return pRand(); if (!W.useRandom) W.useRandom = new NS.JRandom(BigInt.asIntN(64, (W.seed64 || 0n) ^ 0x7F4A7C15n)); return W.useRandom.nextDouble(); }
  var CFG = NS.CFG;
  var R, S, B, W;

  /**
   * ⚠ EVERY ENTRY NAMES THE STAGE IT WAITS FOR. An entry may only leave this list when the thing
   * it names is implemented — `usecheck` asserts the list is exactly this long and that nothing
   * on it is silently working.
   */
  Use.OWED = [
    'spawn eggs for wither and ender_dragon — PERMANENTLY absent regardless of engine progress: ' +
      'neither has ever HAD a spawn egg in vanilla (no SpawnEggItem registration for either in ' +
      '.decomp/net/minecraft/item/Items.java), so there is no egg to test even once the mob ' +
      'itself is built (wither_skeleton spawns since D-673, piglin/piglin_brute since s133, ' +
      'hoglin/zoglin since s134, strider since s135, shulker since cloud unit ' +
      'confident-lamport-asj6ue, wither\'s own motion substrate since cloud unit ' +
      'confident-lamport-mdnl4x — EL.canSpawn(\'wither\') is true, ender_dragon still refuses ' +
      'the same way EL.spawn refuses it, EntityList.owed; neither ever gets a spawn-egg test ' +
      'because vanilla never gave either one) ' +
      '— every built mob\'s egg is SpawnEggItem whole (s119: useOnBlock position/originY/yaw, ' +
      'use() into a fluid, spawnBaby)',
    'container screens — G19b, PASS 17 JOB 1 ' +
      '(the BREWING STAND screen is done: Menu.brewingMenu/Hud.openBrewing/Hud.drawBrewing, ' +
      'brewingcheck.mjs/guicheck §4k — the brewing TICK is G23\'s) ' +
      '(the DISPENSER and DROPPER are done, D-420: Menu.dispenserMenu/Hud.openDispenser/' +
      'Hud.drawDispenser, the firing in BlockEntities.dispenseFrom, dispensercheck.mjs/guicheck §4h) ' +
      '(the HOPPER is done, D-419: Menu.hopperMenu/Hud.openHopper/Hud.drawHopper, the transfer ' +
      'in BlockEntities.tickHopper, hoppercheck.mjs/guicheck §4g) ' +
      '(the furnace, blast furnace and smoker are done, D-414: Menu.furnaceMenu/Hud.openFurnace/' +
      'Hud.drawFurnace; a plain single chest, the double chest ' +
      '(D-413: Hud.chestPair + Menu.chestMenu\'s `be2`, placement and pairing in ' +
      'Player.withChestType/Behave.chestShape), the barrel, the ' +
      'ender chest and the shulker box are done: Menu.chestMenu/Hud.openChest/Hud.drawChest, ' +
      'chestcheck.mjs/usecheck.mjs; barrel is D-403, the same menu/screen over a barrel block ' +
      'entity; ender chest is D-404, the same menu/screen but over the PLAYER\'s own shared ' +
      '27-slot inventory rather than the block\'s own; shulker box is D-406, the same menu ' +
      'again but with its own screen artwork and the "no shulker in a shulker" nesting ' +
      'refusal — see Hud.openChest and Menu.chestMenu\'s own `noNest` argument)',
    // KW-5 -- STRUCK: crafting-remainder items are built. `Item.getRecipeRemainder`'s own
    // five-item table (water/lava/milk bucket -> bucket, dragon_breath/honey_bottle ->
    // glass_bottle, read off .decomp Items.java's `.recipeRemainder(...)` calls -- a plain
    // potion has none, so it stays fully consumed exactly like vanilla) now lives in
    // `Menu.craftingTaken` (14g_menu.js) and leaves the vacated grid cell holding the
    // remainder instead of going empty, for both the player's 2x2 and the table's 3x3.
    // struck s116: throwables (snowball/egg/ender_pearl/splash_potion/lingering_potion) --
    // Use.rightClick's own fallback above now calls Throw.use (07zzd_throw.js), reusing the
    // existing snowball/potion substrates (14j_combat.js/07z_potion.js) and adding the egg
    // hatch + ender-pearl teleport this file's own header names. Sound/particles remain on
    // Throw.OWED (07zzd_throw.js), not silently claimed.
    // loop/beds-s116 -- STRUCK: sleeping, the night skip and the spawn point are built
    // whole in `Sleep.use`/`Sleep.tick`/`Sleep.respawnPos` (14m_sleep.js), hooked below in
    // `Use.blockUse` -- see that file's own header for what is still named as owed.
    'armour stands — G25 (boats struck: Use.entityUse -> Boat.interact, #308); also on EntityList.owed()',
        'written book, spyglass — G19e (fire charge done, #186: Use.spendIgniter/igniteSound) (honeycomb waxing done s128) (lead is done, D-49x, ' +
      'Tm.leashToPlayer/07u_leash.js; name tag\'s ITEM-side use is done, loop/nametag: ' +
      'Use.entityUse\'s own final fallback, above)',
    'a way to actually WRITE `display.Name` onto a stack — no anvil (G22; no anvil UI at all, ' +
      'any of this engine\'s builds) and `/give` (15g_commands.js) takes an item and a ' +
      'count only, no NBT suffix — loop/nametag built the READ half (the use-action refuses ' +
      'an unnamed tag exactly like `NameTagItem.useOnEntity`\'s own `hasCustomName()` guard) ' +
      'against a stack built with a tag directly (`Iv.withTag`, 14f_inventory.js), which is ' +
      'the only way a named name tag exists in this build today',
    'jukeboxes, the bell — G19e (note block, daylight detector, cake, berries, flower pot, cauldron buckets/bottles and water potions, composter, pumpkin carving, lecterns: cloud zealous-dirac)',
  ];

  // ── lectern (LecternBlock / LecternBlockEntity / LecternScreenHandler) ─────────────────────────────────
  function lecPages(book) { return (book && book.t && book.t.pages && book.t.pages.length) | 0; }
  /** LecternBlock.setHasBook: POWERED reset, HAS_BOOK set, then the block below is told. */
  function lecSetHasBook(x, y, z, on) {
    var st = W.getBlock(x, y, z);
    W.setBlock(x, y, z, setProp(setProp(st, 'powered', false), 'has_book', on));
    changed(x, y, z); changed(x, y - 1, z);
  }
  /** LecternBlock.putBook: the BE takes ONE of the held stack, page 0, sound, HAS_BOOK. */
  Use.lecternPut = function (x, y, z, P, held) {
    var Iv = NS.Inventory, be = NS.BlockEntities.get(x, y, z) || NS.BlockEntities.create(x, y, z, 'lectern');
    var one = Iv.withTag(held, held.t); one.n = 1;
    be.book = one; be.page = 0;
    if (!P || !P.instabuild) { Iv.shrink(held, 1); if (Iv.isEmpty(held) && P && P.inventory) Iv.setItem(P.inventory, P.slot, Iv.EMPTY); if (P && P.syncHotbar) P.syncHotbar(); }
    lecSetHasBook(x, y, z, true);
    playAt('item.book.put', x, y, z);
    return true;
  };
  /** openScreen: stat + the screen. The book screen itself is drawn by the hosting UI (owed); it reads Use.lectern. */
  Use.lecternOpen = function (x, y, z, P) {
    Use.lectern = { x: x, y: y, z: z };
    if (NS.Stats && NS.Stats.inc) NS.Stats.inc('interact_with_lectern');
    if (Use.onLecternScreen) Use.onLecternScreen(x, y, z, P);
    return true;
  };
  /** WrittenBookItem.use (#8067): a valid signed book opens the reading screen (Use.reading, shown by the hosting UI); else PASS. */
  Use.bookUse = function (P, stack) {
    if (!NS.Book || !stack || NS.Items.nameOf(stack.i | 0) !== 'written_book') return false;
    var r = NS.Book.open(stack);
    if (!r) return false;
    Use.reading = r;
    if (Use.onBookScreen) Use.onBookScreen(r, P);
    return true;
  };
  /** LecternScreenHandler.onButtonClick: 1 prev, 2 next, 3 take the book, >=100 jump to page n-100. */
  Use.lecternButton = function (x, y, z, P, id) {
    var be = NS.BlockEntities.get(x, y, z);
    if (!be || !be.book || prop(W.getBlock(x, y, z), 'has_book') !== 'true') return false;
    if (id >= 100) return Use.lecternSetPage(x, y, z, id - 100);
    if (id === 1) return Use.lecternSetPage(x, y, z, be.page - 1);
    if (id === 2) return Use.lecternSetPage(x, y, z, be.page + 1);
    if (id === 3) {
      if (P && P.mayBuild === false) return false;
      var book = be.book; be.book = null; be.page = 0;
      lecSetHasBook(x, y, z, false);
      if (P && P.inventory && NS.Inventory.add && NS.Inventory.add(P.inventory, book) === 0) { /* taken */ }
      else if (NS.EntityList && NS.EntityList.dropStack) NS.EntityList.dropStack(x + 0.5, y + 1.0, z + 0.5, book, 1);
      return true;
    }
    return false;
  };
  /** LecternBlockEntity.setCurrentPage: clamp to the page count; a CHANGE pulses POWERED for 2 ticks. */
  Use.lecternSetPage = function (x, y, z, n) {
    var be = NS.BlockEntities.get(x, y, z), cnt = lecPages(be.book);
    var pg = Math.max(0, Math.min(n | 0, cnt - 1));
    if (pg === be.page) return true;
    be.page = pg;
    var st = W.getBlock(x, y, z);
    W.setBlock(x, y, z, setProp(st, 'powered', true));
    changed(x, y, z); changed(x, y - 1, z);
    B.schedule(x, y, z, 2);
    return true;
  };
  /** LecternBlockEntity.getComparatorOutput */
  Use.lecternComparator = function (x, y, z) {
    var be = NS.BlockEntities.get(x, y, z);
    if (!be || !be.book) return 0;
    var cnt = lecPages(be.book);
    return Math.floor((cnt > 1 ? be.page / (cnt - 1) : 1) * 14) + 1;
  };

  // ── the families, resolved once from the TAGS rather than from name suffixes ───────────────
  // ⚠ A NAME SUFFIX WOULD WORK FOR DOORS AND FAIL FOR THE REST. `iron_door` ends in `_door` and
  // must NOT open by hand; `lever` ends in nothing at all. The tag registry already carries the
  // families the game itself uses, so they are read from there, and the ones with no tag are a
  // short NAMED list whose length the check asserts.
  // ⚠ ARCH §3's face order is +X -X +Y -Y +Z -Z, so DOWN is 3. It is named because `face !== 3`
  // in the middle of a tilling rule is exactly the kind of literal that survives a refactor into
  // a different face convention and starts tilling ceilings.
  Use.FACE_DOWN = 3;

  var col = {};
  var id = {};
  var Tm_LEASH_NAME = 'lead';   // QUEUE 0.2 (leashing) -- Tm.LEASH_ITEM's own value, prevented
                                // in step by hand (Tame may not be loaded/ready yet here).
  function column(name) { return NS.Tags && NS.Tags.ready ? NS.Tags.blockTag(name) : -1; }
  function inCol(c, state) {
    return c >= 0 && NS.Tags && NS.Tags.stateInCol ? NS.Tags.stateInCol(c, state) : false;
  }
  function blockId(name) { var i = R.names.indexOf(name); return i < 0 ? -1 : i; }
  /**
   * ⚠ WRITTEN ONCE, BECAUSE THE HAND-COUNTED VERSION WAS WRONG THE FIRST TIME.
   * `'diamond_shovel'.slice(-8)` is `'d_shovel'`, not `'_shovel'` — the suffix is seven
   * characters and the literal said eight, so **the shovel silently did nothing** while the hoe
   * and the axe beside it worked. A miscounted suffix is not a typo a reader can see.
   */
  function endsWith(name, suffix) {
    return name.length > suffix.length && name.slice(-suffix.length) === suffix;
  }
  // ⚠ Any name resolves on first ask: a name missing from init's list used to read `undefined` and answer "no" forever —
  // which is how chest/trapped_chest/barrel/ender_chest/composter right-clicks did nothing (blockuserefcheck open_*, composter_full).
  function isBlock(state, name) {
    if (id[name] === undefined && R && R.names) id[name] = blockId(name);
    return state > 0 && S.block[state] === id[name];
  }

  Use.init = function (world) {
    R = NS.Reg; S = NS.States; B = NS.Behave; W = world || NS.World;
    if (!R || !R.ready || !S || !S.ready) { Use.ready = false; return Use; }
    col.doors = column('doors');
    col.woodenDoors = column('wooden_doors');
    col.trapdoors = column('trapdoors');
    col.woodenTrapdoors = column('wooden_trapdoors');
    col.fenceGates = column('fence_gates');
    col.beds = column('beds');   // loop/beds (G19c) -- `Sleep.use`'s own bed dispatch, below
    // QUEUE 0.2 (leashing) -- `BlockTags.field_16584`/'fences' (LeadItem.useOnBlock,
    // LeashKnotEntity.canStayAttached), NOT 'fence_gates' above -- tagcheck.mjs already
    // proves nether_brick_fence is IN this tag and OUT of wooden_fences.
    col.fences = column('fences');
    col.buttons = column('buttons');
    col.woodenButtons = column('wooden_buttons');
    col.candles = column('candles');
    col.candleCakes = column('candle_cakes');
    col.logs = column('logs');
    ['lever', 'repeater', 'comparator', 'tnt', 'fire', 'campfire', 'soul_campfire',
     'iron_door', 'iron_trapdoor', 'farmland', 'dirt_path', 'dirt', 'grass_block',
     'coarse_dirt', 'rooted_dirt', 'podzol', 'mycelium', 'water', 'lava', 'air',
     'crafting_table', 'powder_snow', 'bubble_column', 'kelp', 'kelp_plant', 'seagrass', 'tall_seagrass']
      .forEach(function (n) { id[n] = blockId(n); });
    // ⚠⚠ **A RULE THAT CANNOT BE EVALUATED MUST SAY SO, NOT SAY NO** (D-351, and this is its
    // second use). Six of the families above are TAG lookups, and `02f_tags.js` is optional: with
    // no tag payload every one of them would answer "not a door", "not a button", "not a candle"
    // — and the whole of G19 would go quiet with a green `ready` flag beside it, which is exactly
    // the shape this project has paid for three times. The flag is published and `usecheck`
    // asserts it, so the silence is a failure rather than a mystery.
    Use.tagsReady = !!(NS.Tags && NS.Tags.ready);
    Use.tagFamilies = ['doors', 'trapdoors', 'fence_gates', 'buttons', 'wooden_buttons', 'candles']
      .filter(function (n) { return column(n) < 0; });
    Use.ready = true;
    return Use;
  };

  // ── small helpers over the state table ────────────────────────────────────────────────────
  function prop(state, name) { return B && B.propName ? B.propName(state, name) : null; }
  function setProp(state, name, value) { return B && B.setProp ? B.setProp(state, name, value) : state; }
  function has(state, name) {
    var p = R.PROP[name];
    return p !== undefined && S.propValue(state, p) >= 0;
  }
  function sound(state, x, y, z, P, role) {
    if (NS.Sound && NS.Sound.blockEvent) {
      // ⚠ A DOOR'S CLICK IS ITS OWN SOUND TYPE, not a generic UI beep. `blockPlace` is the
      // nearest event this engine's sound table carries for a state, and it is the one vanilla
      // uses for the open/close of every wooden thing in the list.
      if (role === 'place' && NS.Sound.blockPlace) NS.Sound.blockPlace(state, x + 0.5, y + 0.5, z + 0.5, P);
    }
  }
  /**
   * The redstone click sounds (#344), `.decomp`'s: LeverBlock.onUse, AbstractButtonBlock.playClickSound,
   * PressurePlateBlock.playPressSound/playDepressSound, WeightedPressurePlateBlock. All volume 0.3;
   * the pitch is fixed (no jitter). kind: lever | wooden_button | stone_button | wooden_plate |
   * stone_plate | metal_plate.
   */
  Use.CLICK = {
    lever:         { on: 'block.lever.click', off: 'block.lever.click', volume: 0.3, pitchOn: 0.6, pitchOff: 0.5 },
    wooden_button: { on: 'block.wooden_button.click_on', off: 'block.wooden_button.click_off', volume: 0.3, pitchOn: 0.6, pitchOff: 0.5 },
    stone_button:  { on: 'block.stone_button.click_on', off: 'block.stone_button.click_off', volume: 0.3, pitchOn: 0.6, pitchOff: 0.5 },
    wooden_plate:  { on: 'block.wooden_pressure_plate.click_on', off: 'block.wooden_pressure_plate.click_off', volume: 0.3, pitchOn: 0.8, pitchOff: 0.7 },
    stone_plate:   { on: 'block.stone_pressure_plate.click_on', off: 'block.stone_pressure_plate.click_off', volume: 0.3, pitchOn: 0.6, pitchOff: 0.5 },
    metal_plate:   { on: 'block.metal_pressure_plate.click_on', off: 'block.metal_pressure_plate.click_off', volume: 0.3, pitchOn: Math.fround(0.90000004), pitchOff: 0.75 }
  };
  Use.clickKind = function (state) {
    if (isBlock(state, 'lever')) return 'lever';
    if (inCol(col.buttons, state)) return inCol(col.woodenButtons, state) ? 'wooden_button' : 'stone_button';
    var k = plateKind(state);
    if (k === 'weighted') return 'metal_plate';
    if (k === 'everything') return 'wooden_plate';
    if (k === 'mobs') return 'stone_plate';
    return null;
  };
  function click(state, x, y, z, on) {
    var c = Use.CLICK[Use.clickKind(state)];
    if (c && NS.Sound && NS.Sound.play) {
      NS.Sound.play(on ? c.on : c.off, { volume: c.volume, pitch: on ? c.pitchOn : c.pitchOff,
                                         x: x + 0.5, y: y + 0.5, z: z + 0.5, source: 'block' });
    }
  }
  /** Tell redstone and the neighbours that a cell changed, exactly as a placement would. */
  function changed(x, y, z) {
    if (B && B.changed) B.changed(x, y, z);
    if (NS.Redstone && NS.Redstone.ready && NS.Redstone.update) NS.Redstone.update(x, y, z);
  }

  // ═══════════════ the block's own `use` ═══════════════════════════════════════════════════
  /**
   * `BlockState.use`. Returns true when the interaction CONSUMED the click, which is what stops
   * the item's own use from also running — a door that opens must not also place the block you
   * are holding into the doorway.
   */
  Use.blockUse = function (P, x, y, z, state, held) {
    if (!Use.ready || !(state > 0)) return false;

    // ── ChestBlock.use / TrappedChestBlock.use / BarrelBlock.use / ShulkerBoxBlock.use ──────
    // PASS 17 JOB 1 (G19b).
    // ⚠ The crouch-skips-use rule (build against a chest instead of opening it) is the CALLER's
    // job — `Use.rightClick`'s `secondary` check runs before this function is even reached — so
    // this only says what a non-crouching click on one of these DOES: open its own screen.
    // `trapped_chest` shares the plain chest's screen, and as of D-432 its redstone-on-open
    // signal is LIVE: `Rs.signal` reads the very same `e.open` opener count this call site
    // increments through `Hud.openChest`, which is how vanilla keeps a trapped chest's lid and
    // its power from ever disagreeing. Its `Rs.OWED_SOURCES` row is deleted, not annotated. `barrel` is D-403: vanilla's own
    // `BarrelScreen.CONTAINER_BACKGROUND` is `generic_54.png` — THE SAME FILE `ChestScreen` uses
    // (confirmed against the 1.18.2 jar: there is no `gui/container/barrel.png` at all) — so a
    // barrel is a plain 27-slot `Menu.chestMenu` over a differently-typed block entity, not a
    // second screen. `ender_chest` is D-404: same screen again, but `Hud.openChest` rebinds the
    // clicked block entity's `.items` to the PLAYER's own shared 27-slot ender inventory first —
    // this call site does not know or care, which is the point.
    // `shulker_box` is D-406: the ONE block here matched by TYPE rather than by name — there are
    // 17 of them (the plain one plus all 16 dyed colours) and `BlockEntities.typeOf` already
    // folds every one down to the single block-entity type `'shulker_box'` (07c_blockentity.js's
    // own TYPES table, `#shulker_boxes`), so that is what is asked here rather than listing all
    // 17 block names by hand — the same generalisation `isBlock`'s single-name check cannot do.
    // Vanilla DOES ship its own `shulker_box.png` (unlike barrel), so its screen looks different,
    // but it is still the same 27-slot `Menu.chestMenu`, just with `noNest` set — see that
    // function's own header for the "no shulker in a shulker" rule. `Hud.openChest` is the
    // shared opener for all five block types.
    var beTypeHere = (NS.BlockEntities && NS.BlockEntities.ready)
      ? NS.BlockEntities.typeOf(S.block[state]) : undefined;
    if (isBlock(state, 'chest') || isBlock(state, 'trapped_chest') || isBlock(state, 'barrel') ||
        isBlock(state, 'ender_chest') || beTypeHere === 'shulker_box') {
      var Hd = NS.Hud;
      return !!(Hd && Hd.openChest && Hd.openChest(x, y, z));
    }

    // ── AbstractFurnaceBlock.use — the furnace, blast furnace and smoker (D-414) ────────────
    // Matched by BLOCK-ENTITY TYPE like the shulker box: `Hud.openFurnace` asks the entity at the
    // cell, so it opens over the LIVE counters and refuses a cell that lost its entity.
    if (beTypeHere === 'furnace' || beTypeHere === 'blast_furnace' || beTypeHere === 'smoker') {
      var HdF = NS.Hud;
      return !!(HdF && HdF.openFurnace && HdF.openFurnace(x, y, z));
    }

    // ── AnvilBlock.createScreenHandlerFactory — G22d: all three damage states open the same screen.
    if (isBlock(state, 'anvil') || isBlock(state, 'chipped_anvil') || isBlock(state, 'damaged_anvil')) {
      var HdA = NS.Hud;
      return !!(HdA && HdA.openAnvil && HdA.openAnvil(x, y, z));
    }

    // ── EnchantingTableBlock.use — PLAN G22: a fresh `EnchantmentScreenHandler` over the table's cell
    // (the shelves are counted from the world when the item goes in, not stored on the block).
    if (isBlock(state, 'enchanting_table')) {
      var HdE = NS.Hud;
      return !!(HdE && HdE.openEnchanting && HdE.openEnchanting(x, y, z));
    }

    // ── HopperBlock.use — PASS 17 JOB 1 (G19b), D-419 ──────────────────────────────────────
    // Matched by BLOCK-ENTITY TYPE like the furnace: `Hud.openHopper` asks the entity at the
    // cell, so it opens over the LIVE five slots and refuses a cell that lost its entity.
    // ⚠ A POWERED HOPPER STILL OPENS. `ENABLED` stops it MOVING items, not you reaching into it.
    if (beTypeHere === 'hopper') {
      var HdH = NS.Hud;
      return !!(HdH && HdH.openHopper && HdH.openHopper(x, y, z));
    }

    // ── DispenserBlock.use / DropperBlock.use — PASS 17 JOB 1 (G19b), D-420 ────────────────
    // One screen for both, matched by block-entity TYPE. ⚠ A TRIGGERED DISPENSER STILL OPENS:
    // `triggered` is the scheduler's own latch, not a lock on the container.
    if (beTypeHere === 'dispenser' || beTypeHere === 'dropper') {
      var HdD = NS.Hud;
      return !!(HdD && HdD.openDispenser && HdD.openDispenser(x, y, z));
    }

    // ── BrewingStandBlock.use — PASS 17 JOB 1 (G19b) ───────────────────────────────────────
    // Matched by block-entity TYPE. The screen is live; the brewing tick that fills it is G23's.
    if (beTypeHere === 'brewing_stand') {
      var HdB = NS.Hud;
      return !!(HdB && HdB.openBrewing && HdB.openBrewing(x, y, z));
    }

    // ── GrindstoneBlock.onUse — G22e (#197). No block entity: a fresh menu every open.
    if (isBlock(state, 'grindstone')) {
      var HdG = NS.Hud;
      return !!(HdG && HdG.openGrindstone && HdG.openGrindstone(x, y, z));
    }

    // ── StonecutterBlock.onUse — #8055. No block entity: a fresh menu every open.
    if (isBlock(state, 'stonecutter')) {
      var HdS = NS.Hud;
      var openedS = !!(HdS && HdS.openStonecutter && HdS.openStonecutter(x, y, z));
      if (openedS && NS.Stats && NS.Stats.inc) NS.Stats.inc('interact_with_stonecutter');
      return openedS;
    }

    // ── LoomBlock.onUse — G19e-loom. No block entity: a fresh menu every open.
    if (isBlock(state, 'loom')) {
      var HdL = NS.Hud;
      return !!(HdL && HdL.openLoom && HdL.openLoom(x, y, z));
    }

    // ── CartographyTableBlock.onUse: a fresh menu every open.
    if (isBlock(state, 'cartography_table')) {
      var HdK = NS.Hud;
      return !!(HdK && HdK.openCartography && HdK.openCartography(x, y, z));
    }

    // ── CraftingTableBlock.use — PASS 17 JOB 1 (G19b), session 44 ──────────────────────────
    // ⚠ Unlike a chest, this opens a FRESH `CraftingMenu` every time rather than looking at any
    // per-position state — the table itself has none (see `Menu.craftingMenu`'s own header).
    if (isBlock(state, 'crafting_table')) {
      var HdC = NS.Hud;
      return !!(HdC && HdC.openCraftingTable && HdC.openCraftingTable(x, y, z));
    }

    // ── ComposterBlock.use — loop/composter, 07zy_composter.js (.decomp:219-241) ────────────
    // LIVE (D-591): `composter` is in the registry with its `level` 0..8 states; the worker's
    // "no block registered" note read the legacy 02_blocks.js table, not NS.Reg.
    // `Composter.onUse` decides consumed-vs-not and extracted-vs-not; THIS site owns the real
    // inventory stack (`Iv.shrink`) exactly like every other branch below it.
    if (isBlock(state, 'composter')) {
      var Cm = NS.Composter;
      if (!Cm || !Cm.ready) return false;
      var ItC = NS.Items, IvC = NS.Inventory;
      var itemName = (!IvC || !IvC.isEmpty(held)) && ItC && ItC.ready ? ItC.nameOf(held.i | 0) : '';
      var res = Cm.onUse(x, y, z, itemName);
      if (!res) return false;
      if (res.consumed && !P.instabuild && IvC && IvC.shrink) IvC.shrink(held, 1);
      return true;
    }

    // ── BedBlock.use — sleeping, the night skip and the spawn point (loop/beds, G19c) ──────
    // Kept OUT of this file's own big switch on purpose, the same shape the composter branch
    // above takes with `Composter.onUse`: `Sleep.use` (14m_sleep.js) IS the whole mechanic,
    // this is the one hook line naming it. Always consumes (returns true) once matched — see
    // `Sleep.use`'s own header for why.
    if (inCol(col.beds, state)) {
      return !!(NS.Sleep && NS.Sleep.ready && NS.Sleep.use(P, x, y, z, state));
    }

    // ── DoorBlock.use ───────────────────────────────────────────────────────────────────────
    // ⚠ **THE METAL CHECK IS A MATERIAL, NOT A NAME.** `if (this.material == Material.METAL)
    // return InteractionResult.PASS` — an iron door is opened by redstone and never by hand, and
    // a clone that opens it by hand has broken every iron-door trap ever built.
    if (inCol(col.doors, state) && has(state, 'open')) {
      if (isBlock(state, 'iron_door')) return false;
      var openNow = prop(state, 'open') === 'true';
      var half = prop(state, 'half');
      var oy = half === 'upper' ? y - 1 : y + 1;
      var other = W.getBlock(x, oy, z);
      W.setBlock(x, y, z, setProp(state, 'open', !openNow));
      // ⚠ BOTH HALVES, IN THE SAME CALL. Vanilla's halves stay in step through `updateShape`;
      // this engine's placement already writes both (D-332), so its opening writes both too —
      // otherwise the top half of every door stays shut and looks like a rendering bug.
      if (other > 0 && S.block[other] === S.block[state] && has(other, 'open')) {
        W.setBlock(x, oy, z, setProp(other, 'open', !openNow));
        changed(x, oy, z);
      }
      sound(state, x, y, z, P, 'place');
      changed(x, y, z);
      return true;
    }

    // ── TrapDoorBlock.use ───────────────────────────────────────────────────────────────────
    if (inCol(col.trapdoors, state) && has(state, 'open')) {
      if (isBlock(state, 'iron_trapdoor')) return false;
      W.setBlock(x, y, z, setProp(state, 'open', prop(state, 'open') !== 'true'));
      sound(state, x, y, z, P, 'place');
      changed(x, y, z);
      return true;
    }

    // ── FenceGateBlock.use ──────────────────────────────────────────────────────────────────
    // ⚠ AND IT TURNS TO FACE YOU. Vanilla: if the gate is being OPENED and its facing is the
    // opposite of the player's, the facing is flipped first — so a gate always swings away from
    // you rather than through you. It is two lines and it is the difference between a gate that
    // feels right and one that occasionally shuts you in.
    if (inCol(col.fenceGates, state) && has(state, 'open')) {
      var st = state;
      var isOpen = prop(st, 'open') === 'true';
      if (!isOpen) {
        var facing = prop(st, 'facing');
        if (facing && Use.playerFacing(P) === Use.opposite(facing)) st = setProp(st, 'facing', Use.playerFacing(P));
      }
      W.setBlock(x, y, z, setProp(st, 'open', !isOpen));
      sound(state, x, y, z, P, 'place');
      changed(x, y, z);
      return true;
    }

    // ── cloud zealous-dirac (referee-placement, blockuserefcheck): the one-line block uses, each its .decomp onUse ──
    var bname = R.names[S.block[state]];
    var heldName = (held && !(NS.Inventory && NS.Inventory.isEmpty(held)) && NS.Items) ? NS.Items.nameOf(held.i | 0) : '';
    // PumpkinBlock.onUse: shears carve it facing the clicked side (a top/bottom click faces the player: the opposite of
    // their horizontal facing), drop 4 pumpkin seeds out of that face, shears take 1 (useonrefcheck shears_pumpkin_top)
    if (bname === 'pumpkin' && heldName === 'shears' && P.lastHitFace !== undefined) {
      var FD = ['east', 'west', 'up', 'down', 'south', 'north'], OPPD = { north: 'south', south: 'north', east: 'west', west: 'east' };
      var cf = FD[P.lastHitFace];
      if (cf === 'up' || cf === 'down') cf = OPPD[['north', 'east', 'south', 'west'][Math.round(P.yaw / (Math.PI / 2)) & 3]];
      W.setBlock(x, y, z, setProp(S.stateOf('carved_pumpkin'), 'facing', cf));
      var sx = { east: 0.65, west: -0.65 }[cf] || 0, sz = { south: 0.65, north: -0.65 }[cf] || 0;
      if (NS.EntityList && NS.EntityList.dropStack && NS.Items) NS.EntityList.dropStack(x + 0.5 + sx, y + 0.1, z + 0.5 + sz, NS.Items.of('pumpkin_seeds'), 4);
      playAt('block.pumpkin.carve', x, y, z);
      Use.damage(P, held, 1);
      changed(x, y, z);
      return true;
    }
    // BeehiveBlock.onUse (#3021): at honey_level 5 shears -> 3 honeycomb (+1 damage), glass bottle -> honey_bottle; then takeHoney
    if ((bname === 'beehive' || bname === 'bee_nest') && NS.Bee && prop(state, 'honey_level') === '5' &&
        (heldName === 'shears' || heldName === 'glass_bottle')) {
      var Iv2 = NS.Inventory;
      if (heldName === 'shears') {
        playAt('block.beehive.shear', x, y, z);
        if (NS.EntityList && NS.EntityList.dropStack) NS.EntityList.dropStack(x + 0.5, y + 0.5, z + 0.5, NS.Items.of('honeycomb'), 3);
        Use.damage(P, held, 1);
      } else {
        playAt('item.bottle.fill', x, y, z);
        if (!P.instabuild) Iv2.shrink(held, 1);
        if (!P.instabuild && held.n <= 0) Iv2.setItem(P.inventory, P.slot, Iv2.stack('honey_bottle', 1, 0)); else giveRemainder(P, 'honey_bottle');
      }
      NS.Bee.takeHoney(x, y, z, P);
      changed(x, y, z);
      return true;
    }
    // SignBlock.onUse (1.18.2): a dye recolours the text (not when already that colour), a glow ink sac makes it
    // glow (not when already glowing); each plays its sound, the stack shrinks by 1 outside creative.
    if (/_sign$/.test(bname) && NS.BlockEntities && P.mayBuild !== false && (/_dye$/.test(heldName) || heldName === 'glow_ink_sac')) {
      var sBE = NS.BlockEntities.get(x, y, z) || NS.BlockEntities.create(x, y, z, 'sign');
      var sGlow = heldName === 'glow_ink_sac', sCol = sGlow ? null : heldName.slice(0, -4);
      if (!sGlow && NS.BlockEntities.SIGN_COLORS[sCol] === undefined) return false;
      if (sGlow ? sBE.glowing : sBE.color === sCol) return false;
      if (sGlow) sBE.glowing = true; else sBE.color = sCol;
      playAt(sGlow ? 'item.glow_ink_sac.use' : 'item.dye.use', x, y, z);
      if (!P.instabuild) { NS.Inventory.shrink(held, 1); if (P.syncHotbar) P.syncHotbar(); }
      changed(x, y, z);
      return true;
    }
    // JukeboxBlock.onUse / MusicDiscItem.useOnBlock: eject a record, or insert the held disc; WorldRenderer.playSong
    // then calls setNearbySongPlaying on every living entity within 3 blocks (parrots dance)
    if (bname === 'jukebox' && has(state, 'has_record') && NS.BlockEntities && P.mayBuild !== false) {
      var jIv = NS.Inventory, jBE = NS.BlockEntities.get(x, y, z) || NS.BlockEntities.create(x, y, z, 'jukebox');
      var jOn = prop(state, 'has_record') === 'true';
      if (!jOn && !/^music_disc_/.test(heldName)) return false;
      if (jOn) {
        NS.BlockEntities.jukeboxRemoveRecord(x, y, z);
      } else {
        jBE.record = heldName;
        if (!P.instabuild) { jIv.shrink(held, 1); if (jIv.isEmpty(held)) jIv.setItem(P.inventory, P.slot, jIv.EMPTY); if (P.syncHotbar) P.syncHotbar(); }
        if (NS.Sound && NS.Sound.play) NS.Sound.play('music_disc.' + heldName.slice(11), { x: x + 0.5, y: y + 0.5, z: z + 0.5, source: 'record' });
      }
      W.setBlock(x, y, z, setProp(state, 'has_record', !jOn));
      var jL = NS.EntityList && NS.EntityList.list || [];
      for (var ji = 0; ji < jL.length; ji++) {
        var jE = jL[ji];
        if (jE.type === 'parrot' && jE.x > x - 3 && jE.x < x + 4 && jE.y > y - 3 && jE.y < y + 4 && jE.z > z - 3 && jE.z < z + 4) NS.Fly.setNearbySongPlaying(jE, x, y, z, !jOn);
      }
      changed(x, y, z);
      return true;
    }
    // LecternBlock.onUse: HAS_BOOK -> open the screen (CONSUME/success); empty lectern + a held item that is not in
    // #lectern_books -> CONSUME; otherwise PASS, and WritableBookItem/WrittenBookItem.useOnBlock then putBookIfAbsent
    if (bname === 'lectern' && has(state, 'has_book')) {
      if (prop(state, 'has_book') === 'true') { Use.lecternOpen(x, y, z, P); return true; }
      if (heldName === 'writable_book' || heldName === 'written_book') {
        if (P.mayBuild === false) return false;
        Use.lecternPut(x, y, z, P, held);
        return true;
      }
      return !!heldName;
    }
    // NoteBlock.onUse: `state.cycle(NOTE)` (0..24, wraps), CONSUME
    if (bname === 'note_block' && has(state, 'note') && NS.Note && NS.Note.ready) return NS.Note.use(x, y, z);
    // RedstoneWireBlock.onUse (#339): `allowModifyWorld` -> a cross turns dot, a dot turns cross, anything else PASSes
    if (bname === 'redstone_wire' && NS.Redstone && NS.Redstone.ready) {
      if (P.mayBuild === false) return false;
      return NS.Redstone.wireUse(x, y, z);
    }
    // DaylightDetectorBlock.onUse: `player.canModifyBlocks()` -> cycle INVERTED (the power re-reads next tick)
    if (bname === 'daylight_detector' && has(state, 'inverted')) {
      if (P.mayBuild === false) return false;
      W.setBlock(x, y, z, setProp(state, 'inverted', prop(state, 'inverted') !== 'true'));
      changed(x, y, z);
      return true;
    }
    // CakeBlock.tryEat: `player.canConsume(false)` (invulnerable, i.e. creative, always may) -> food +2, sat 0.1,
    // bites+1, the seventh bite removes the cake; PASS when full (a held item may then be used/placed)
    // CakeBlock.onUse first: a candle in hand on an uneaten cake becomes the matching candle cake
    if (bname === 'cake' && has(state, 'bites') && +prop(state, 'bites') === 0 && (heldName === 'candle' || /_candle$/.test(heldName))
        && R.names.indexOf(heldName + '_cake') >= 0) {
      if (P.mayBuild === false) return false;
      if (!P.instabuild && NS.Inventory) { NS.Inventory.shrink(held, 1); if (NS.Inventory.isEmpty(held)) NS.Inventory.setItem(P.inventory, P.slot, NS.Inventory.EMPTY); if (P.syncHotbar) P.syncHotbar(); }
      if (NS.Sound && NS.Sound.entitySound) NS.Sound.entitySound('block.cake.add_candle', x + 0.5, y + 0.5, z + 0.5, 1, 1, 'block', NS.Player);
      W.setBlock(x, y, z, S.stateOf(heldName + '_cake'));
      changed(x, y, z);
      return true;
    }
    // CandleBlock.onUse / CandleCakeBlock.onUse: empty hand + lit -> extinguish (a candle cake only when the click is
    // on the candle, y > 0.5); a candle cake otherwise is eaten as a plain cake and drops its candle
    var isCandleCake = inCol(col.candleCakes, state);
    if ((isCandleCake || inCol(col.candles, state)) && has(state, 'lit') && prop(state, 'lit') === 'true' && !heldName
        && (isCandleCake ? (P.thy === undefined || P.thy - y > 0.5) : P.mayBuild !== false)) {
      if (NS.Sound && NS.Sound.entitySound) NS.Sound.entitySound('block.candle.extinguish', x + 0.5, y + 0.5, z + 0.5, 1, 1, 'block', NS.Player);
      W.setBlock(x, y, z, setProp(state, 'lit', false));
      changed(x, y, z);
      return true;
    }
    if (isCandleCake && !Use.isIgniter(held)) {
      var SvC = NS.Survival;
      if (!P.invulnerableGamemode && !(SvC && SvC.canEat && P.food !== undefined && SvC.canEat(P, false))) return false;
      if (SvC && SvC.eat && P.food !== undefined) SvC.eat(P, 2, 0.1);
      W.setBlock(x, y, z, setProp(S.stateOf('cake'), 'bites', '1'));
      if (NS.EntityList && NS.EntityList.dropStack && NS.Items) NS.EntityList.dropStack(x + 0.5, y + 0.5, z + 0.5, NS.Items.of(bname.replace(/_cake$/, '')), 1);
      changed(x, y, z);
      return true;
    }
    if (bname === 'cake' && has(state, 'bites')) {
      var Sv = NS.Survival;
      if (!P.invulnerableGamemode && !(Sv && Sv.canEat && P.food !== undefined && Sv.canEat(P, false))) return false;
      if (Sv && Sv.eat && P.food !== undefined) Sv.eat(P, 2, 0.1);
      var bites = +prop(state, 'bites') | 0;
      W.setBlock(x, y, z, bites < 6 ? setProp(state, 'bites', String(bites + 1)) : 0);
      changed(x, y, z);
      return true;
    }
    // SweetBerryBushBlock.onUse: age 2..3 drops 1+rand(2) berries (+1 at age 3) and resets to age 1; an unripe bush
    // with bone meal in hand PASSes to the item
    if (bname === 'sweet_berry_bush' && has(state, 'age')) {
      var age = +prop(state, 'age') | 0;
      if (age !== 3 && heldName === 'bone_meal') return false;
      if (age <= 1) return false;
      var berries = 1 + Math.floor(pRand() * 2) + (age === 3 ? 1 : 0);
      if (NS.EntityList && NS.EntityList.dropStack && NS.Items) NS.EntityList.dropStack(x + 0.5, y + 0.5, z + 0.5, NS.Items.of('sweet_berries'), berries);
      // ITEM_SWEET_BERRIES_PICK_FROM_BUSH, BLOCKS, vol 1.0, pitch 0.8 + rand * 0.4
      if (NS.Sound && NS.Sound.play) NS.Sound.play('item.sweet_berries.pick_from_bush', { x: x + 0.5, y: y + 0.5, z: z + 0.5, source: 'block', volume: 1, pitch: 0.8 + pRand() * 0.4 });
      W.setBlock(x, y, z, setProp(state, 'age', '1'));
      changed(x, y, z);
      return true;
    }
    // ShearsItem.useOnBlock (#184): an AbstractPlantStemBlock (kelp, weeping/twisting vines, cave vines head) below max age
    // is set to age 25 (withMaxAge) with `block.growing_plant.crop`, shears take 1. The block's own onUse goes first: a
    // cave_vines head with berries is picked instead.
    if (heldName === 'shears' && (bname === 'kelp' || bname === 'weeping_vines' || bname === 'twisting_vines' || bname === 'cave_vines') &&
        has(state, 'age') && +prop(state, 'age') < 25 && !(bname === 'cave_vines' && prop(state, 'berries') === 'true')) {
      playAt('block.growing_plant.crop', x, y, z);
      W.setBlock(x, y, z, setProp(state, 'age', '25'));
      Use.damage(P, held, 1);
      changed(x, y, z);
      return true;
    }
    // CaveVinesHead/BodyBlock.onUse -> CaveVines.pickBerries (#305): BERRIES -> Block.dropStack one glow_berries,
    // `block.cave_vines.pick_berries` at pitch nextBetween(0.8, 1.2), BERRIES=false; no berries PASSes (bone meal may follow)
    if ((bname === 'cave_vines' || bname === 'cave_vines_plant') && has(state, 'berries')) {
      if (prop(state, 'berries') !== 'true') return false;
      if (NS.EntityList && NS.EntityList.popResource && NS.Items) NS.EntityList.popResource(x, y, z, NS.Items.of('glow_berries'), 1);
      if (NS.Sound && NS.Sound.play) NS.Sound.play('block.cave_vines.pick_berries', { x: x + 0.5, y: y + 0.5, z: z + 0.5, source: 'block', volume: 1, pitch: 0.8 + pRand() * 0.4 });
      W.setBlock(x, y, z, setProp(state, 'berries', false));
      changed(x, y, z);
      return true;
    }
    // FlowerPotBlock.onUse: an empty pot takes a block item that has a `potted_<name>` (CONTENT_TO_POTTED); a full pot
    // with an empty-for-potting hand gives its plant back; anything else CONSUMEs and does nothing
    if (bname === 'flower_pot' || bname.indexOf('potted_') === 0) {
      var potted = heldName && R.names.indexOf('potted_' + heldName) >= 0 && NS.Items.stateOf && NS.Items.stateOf(held.i | 0) > 0
        ? S.stateOf('potted_' + heldName) : 0;
      var potEmpty = bname === 'flower_pot';
      if ((potted === 0) === potEmpty) return true;
      if (potEmpty) {
        W.setBlock(x, y, z, potted);
        if (!P.instabuild && NS.Inventory) { NS.Inventory.shrink(held, 1); if (NS.Inventory.isEmpty(held)) NS.Inventory.setItem(P.inventory, P.slot, NS.Inventory.EMPTY); if (P.syncHotbar) P.syncHotbar(); }
      } else {
        var plant = NS.Items ? NS.Items.of(bname.slice(7)) : -1;
        if (plant >= 0 && NS.Inventory) {
          if (NS.Inventory.isEmpty(held)) NS.Inventory.setItem(P.inventory, P.slot, { i: plant, n: 1 });
          else if (NS.Inventory.add(P.inventory, { i: plant, n: 1 }) > 0 && NS.EntityList && NS.EntityList.dropStack) NS.EntityList.dropStack(P.x, P.y + 1.32, P.z, plant, 1);
          if (P.syncHotbar) P.syncHotbar();
        }
        W.setBlock(x, y, z, S.stateOf('flower_pot'));
      }
      changed(x, y, z);
      return true;
    }
    // CauldronBehavior (EMPTY/WATER/LAVA/POWDER_SNOW maps): fill from a bucket, empty a FULL one into a bucket, a
    // glass bottle takes a water potion and one level -- every hand change is ItemUsage.exchangeStack
    if (/^(cauldron|water_cauldron|lava_cauldron|powder_snow_cauldron)$/.test(bname) && heldName) {
      var level = has(state, 'level') ? (+prop(state, 'level') | 0) : 3;
      var fillTo = { water_bucket: 'water_cauldron', lava_bucket: 'lava_cauldron', powder_snow_bucket: 'powder_snow_cauldron' }[heldName];
      if (fillTo && bname === 'cauldron') {
        var fs = S.stateOf(fillTo);
        W.setBlock(x, y, z, fillTo === 'lava_cauldron' ? fs : setProp(fs, 'level', '3'));
        Use.exchangeStack(P, held, 'bucket');
        playAt(fillTo === 'lava_cauldron' ? 'item.bucket.empty_lava' : fillTo === 'powder_snow_cauldron' ? 'item.bucket.empty_powder_snow' : 'item.bucket.empty', x, y, z);
        changed(x, y, z);
        return true;
      }
      if (heldName === 'bucket' && bname !== 'cauldron' && level === 3) {
        var got = { water_cauldron: 'water_bucket', lava_cauldron: 'lava_bucket', powder_snow_cauldron: 'powder_snow_bucket' }[bname];
        W.setBlock(x, y, z, S.stateOf('cauldron'));
        Use.exchangeStack(P, held, got);
        if (NS.GameEvent) NS.GameEvent.emit('fluid_pickup', x, y, z, null);   // FluidDrainable -> FLUID_PICKUP
      playAt(got === 'lava_bucket' ? 'item.bucket.fill_lava' : got === 'powder_snow_bucket' ? 'item.bucket.fill_powder_snow' : 'item.bucket.fill', x, y, z);
        changed(x, y, z);
        return true;
      }
      var cStat = function (id) { if (NS.Stats && NS.Stats.inc) NS.Stats.inc(id); };
      var dropLevel = function () {   // LeveledCauldronBlock.decrementFluidLevel
        W.setBlock(x, y, z, level > 1 ? setProp(state, 'level', String(level - 1)) : S.stateOf('cauldron'));
        changed(x, y, z);
      };
      var Ivc = NS.Inventory, heldTag = Ivc && Ivc.tagOf ? Ivc.tagOf(held) : null;
      var isWaterPotion = heldName === 'potion' && !!heldTag && heldTag.Potion === 'minecraft:water';
      if (heldName === 'glass_bottle' && bname === 'water_cauldron') {
        Use.exchangeStack(P, held, 'potion', false, { Potion: 'minecraft:water' });
        cStat('use_cauldron');
        dropLevel();
        playAt('item.bottle.fill', x, y, z);
        if (NS.GameEvent) NS.GameEvent.emit('fluid_pickup', x, y, z, null);   // FLUID_PICKUP
        return true;
      }
      // a water potion: EMPTY_CAULDRON_BEHAVIOR fills to level 1, WATER_CAULDRON_BEHAVIOR cycles level +1 (not at 3)
      if (isWaterPotion && (bname === 'cauldron' || (bname === 'water_cauldron' && level !== 3))) {
        Use.exchangeStack(P, held, 'glass_bottle');
        cStat('use_cauldron');
        W.setBlock(x, y, z, bname === 'cauldron' ? setProp(S.stateOf('water_cauldron'), 'level', '1') : setProp(state, 'level', String(level + 1)));
        playAt('item.bottle.empty', x, y, z);
        if (NS.GameEvent) NS.GameEvent.emit('fluid_place', x, y, z, null);   // FLUID_PLACE
        changed(x, y, z);
        return true;
      }
      if (bname === 'water_cauldron') {
        // CLEAN_DYEABLE_ITEM: leather armour with display.color loses it
        if (/^leather_(helmet|chestplate|leggings|boots|horse_armor)$/.test(heldName) && heldTag && heldTag.display && heldTag.display.color !== undefined) {
          delete heldTag.display.color;
          if (!Object.keys(heldTag.display).length) delete heldTag.display;
          if (!Object.keys(heldTag).length) delete held.t;
          cStat('clean_armor'); dropLevel();
          return true;
        }
        // CLEAN_BANNER: a banner with patterns loses them, one banner at a time
        var bpat = heldTag && heldTag.BlockEntityTag && heldTag.BlockEntityTag.Patterns;
        if (/_banner$/.test(heldName) && bpat && bpat.length > 0 && Ivc) {
          var clean = Ivc.withTag(Ivc.copy ? Ivc.copy(held) : { i: held.i, n: 1, d: held.d }, heldTag);
          clean.n = 1;
          var ct = clean.t; delete ct.BlockEntityTag.Patterns;
          if (!Object.keys(ct.BlockEntityTag).length) delete ct.BlockEntityTag;
          if (!Object.keys(ct).length) delete clean.t;
          if (!P.instabuild) Ivc.shrink(held, 1);
          if (Ivc.isEmpty(held)) Ivc.setItem(P.inventory, P.slot, clean);
          else if (Ivc.add(P.inventory, clean) > 0 && NS.EntityList && NS.EntityList.dropStack) NS.EntityList.dropStack(P.x, P.y + 1.32, P.z, clean.i, 1);
          if (P.syncHotbar) P.syncHotbar();
          cStat('clean_banner'); dropLevel();
          return true;
        }
        // CLEAN_SHULKER_BOX: any coloured box becomes a plain shulker_box carrying a copy of the NBT
        if (/_shulker_box$/.test(heldName) && Ivc && NS.Items.of('shulker_box') >= 0) {
          var plain = { i: NS.Items.of('shulker_box'), n: held.n, d: 0 };
          if (heldTag) plain = Ivc.withTag(plain, heldTag);
          Ivc.setItem(P.inventory, P.slot, plain);
          if (P.syncHotbar) P.syncHotbar();
          cStat('clean_shulker_box'); dropLevel();
          return true;
        }
      }
    }

    // CauldronBehavior WATER_/EMPTY_ potion rows + CLEAN_DYEABLE_ITEM / CLEAN_BANNER / CLEAN_SHULKER_BOX
    if (heldName && /^(cauldron|water_cauldron)$/.test(bname)) {
      var Ivc = NS.Inventory, ctag = Ivc.tagOf(held);
      var isWaterPotion = heldName === 'potion' && ctag && ctag.Potion === 'minecraft:water';
      var wlevel = bname === 'water_cauldron' ? (+prop(state, 'level') | 0) : 0;
      if (isWaterPotion && (bname === 'cauldron' || wlevel !== 3)) {
        Use.exchangeStack(P, held, 'glass_bottle');
        W.setBlock(x, y, z, bname === 'cauldron' ? setProp(S.stateOf('water_cauldron'), 'level', '1') : setProp(state, 'level', String(wlevel + 1)));
        playAt('item.bottle.empty', x, y, z);
        if (NS.GameEvent) NS.GameEvent.emit('fluid_place', x, y, z, null);
        changed(x, y, z);
        return true;
      }
      if (bname === 'water_cauldron') {
        var dec = function () { W.setBlock(x, y, z, wlevel > 1 ? setProp(state, 'level', String(wlevel - 1)) : S.stateOf('cauldron')); changed(x, y, z); };
        if (/^leather_(helmet|chestplate|leggings|boots|horse_armor)$/.test(heldName) && ctag && ctag.display && ctag.display.color !== undefined) {
          var nt = Ivc.cloneTag(ctag); delete nt.display.color;
          if (!Object.keys(nt.display).length) delete nt.display;
          Ivc.setItem(P.inventory, P.slot, { i: held.i, n: held.n, d: held.d, t: Object.keys(nt).length ? nt : undefined });
          if (P.syncHotbar) P.syncHotbar();
          dec(); return true;
        }
        if (/_banner$/.test(heldName) && ctag && ctag.BlockEntityTag && ctag.BlockEntityTag.Patterns && ctag.BlockEntityTag.Patterns.length > 0) {
          var bt = Ivc.cloneTag(ctag); delete bt.BlockEntityTag.Patterns;
          if (!Object.keys(bt.BlockEntityTag).length) delete bt.BlockEntityTag;
          var one = { i: held.i, n: 1, d: held.d, t: Object.keys(bt).length ? bt : undefined };
          if (!P.instabuild) Ivc.shrink(held, 1);
          if (Ivc.isEmpty(held)) Ivc.setItem(P.inventory, P.slot, one);
          else if (Ivc.add(P.inventory, one) > 0 && NS.EntityList && NS.EntityList.dropStack) NS.EntityList.dropStack(P.x, P.y + 1.32, P.z, one.i, 1);
          if (P.syncHotbar) P.syncHotbar();
          dec(); return true;
        }
        if (/_shulker_box$/.test(heldName)) {
          var sb = NS.Items.of('shulker_box');
          Ivc.setItem(P.inventory, P.slot, { i: sb, n: held.n, d: held.d, t: ctag ? Ivc.cloneTag(ctag) : undefined });
          if (P.syncHotbar) P.syncHotbar();
          dec(); return true;
        }
      }
    }

    // ── LeverBlock.use ──────────────────────────────────────────────────────────────────────
    if (isBlock(state, 'lever') && has(state, 'powered')) {
      var leverOn = prop(state, 'powered') !== 'true';
      W.setBlock(x, y, z, setProp(state, 'powered', leverOn));
      click(state, x, y, z, leverOn);
      changed(x, y, z);
      return true;
    }

    // ── ButtonBlock.use ─────────────────────────────────────────────────────────────────────
    // ⚠ A PRESSED BUTTON RETURNS **CONSUME**, NOT PASS: clicking a button that is already down
    // must not fall through and place the block in your hand into the wall beside it.
    if (inCol(col.buttons, state) && has(state, 'powered')) {
      if (prop(state, 'powered') === 'true') return true;
      W.setBlock(x, y, z, setProp(state, 'powered', true));
      click(state, x, y, z, true);
      changed(x, y, z);
      // ⚠ THE UNPRESS IS A SCHEDULED TICK, and the duration is per material: **30 ticks for a
      // wooden button, 20 for a stone one** (`ButtonBlock.getPressDuration`). A single constant
      // is wrong for half the roster.
      if (B && B.schedule) B.schedule(x, y, z, Use.pressDuration(state), 0);
      return true;
    }

    // ── RepeaterBlock.use — the delay cycles 1 -> 2 -> 3 -> 4 -> 1 ──────────────────────────
    if (isBlock(state, 'repeater') && has(state, 'delay')) {
      if (P.mayBuild === false) return false;
      var d = parseInt(prop(state, 'delay'), 10) || 1;
      W.setBlock(x, y, z, setProp(state, 'delay', d >= 4 ? 1 : d + 1));   // RepeaterBlock.onUse plays NO sound
      changed(x, y, z);
      return true;
    }

    // ── ComparatorBlock.use — compare <-> subtract ──────────────────────────────────────────
    if (isBlock(state, 'comparator') && has(state, 'mode')) {
      if (P.mayBuild === false) return false;
      var mode = prop(state, 'mode') === 'subtract' ? 'compare' : 'subtract';
      W.setBlock(x, y, z, setProp(state, 'mode', mode));
      // ComparatorBlock.onUse: block.comparator.click, volume 0.3, pitch 0.55 entering SUBTRACT else 0.5
      if (NS.Sound && NS.Sound.play) NS.Sound.play('block.comparator.click', {
        x: x + 0.5, y: y + 0.5, z: z + 0.5, source: 'block', volume: 0.3, pitch: mode === 'subtract' ? 0.55 : 0.5 });
      changed(x, y, z);
      return true;
    }

    // ── TntBlock.use — flint and steel primes it ───────────────────────────────────────────
    // ⚠ THIS IS A **BLOCK** USE, NOT THE ITEM'S. `TntBlock.use` tests the held item, removes the
    // block and spawns the primed entity; the flint-and-steel item never sees the click. Putting
    // it on the item side is how a clone ends up setting a fire on top of the TNT instead.
    if (isBlock(state, 'tnt') && Use.isIgniter(held)) {
      Use.primeTnt(P, x, y, z, state);
      Use.spendIgniter(P, held);   // TntBlock.onUse: flint damages 1, a fire charge decrements 1, creative neither
      return true;
    }

    // ── CampfireBlock/CandleBlock/CandleCakeBlock.canBeLit, lit by FlintAndSteelItem / FireChargeItem.useOnBlock ──
    if (Use.canBeLit(state) && Use.isIgniter(held)) {
      Use.igniteSound(held, x, y, z);
      W.setBlock(x, y, z, setProp(state, 'lit', true));
      changed(x, y, z);
      Use.spendIgniter(P, held);
      return true;
    }

    return false;
  };

  /** `ButtonBlock.getPressDuration` — 30 ticks wooden, 20 stone. */
  Use.pressDuration = function (state) {
    return inCol(col.woodenButtons, state) ? 30 : 20;
  };

  /** A primed TNT entity where the block was, with vanilla's own fuse.
   *  ⚠ `P` MAY BE `null` (loop/tnt-s96) — `TntBlock.neighborUpdate`/`onBlockAdded`'s own
   *  redstone-ignition path (`07f_redstone.js`'s own `Rs.updateTnt`) primes a TNT block with NO
   *  player involved at all, exactly as vanilla's `primeTnt(World, BlockPos)` overload (no
   *  `LivingEntity` argument) takes none either — `Use.damage` already refuses a falsy player
   *  on its own first line, but reading `P.heldItem` to decide WHAT to hand it crashed before
   *  ever reaching that guard, which `tntcheck.mjs`'s own redstone section caught. */
  Use.primeTnt = function (P, x, y, z, state) {
    W.setBlock(x, y, z, 0);
    changed(x, y, z);
    var EL = NS.EntityList;
    if (EL && EL.ready && EL.canSpawn('tnt')) {
      // ⚠ THE ENTITY IS CENTRED ON THE CELL AND LIFTED HALF A BLOCK, which is `PrimedTnt`'s own
      // spawn position — a TNT that appears at the cell CORNER visibly jumps when it is primed.
      EL.spawn('tnt', x + 0.5, y, z + 0.5, { fuse: 80, igniter: P || undefined });
      if (NS.GameEvent) NS.GameEvent.emit('prime_fuse', x + 0.5, y, z + 0.5, P);
    }
  };

  /** `CampfireBlock.canBeLit` / `CandleBlock.canBeLit` / `CandleCakeBlock.canBeLit`: not lit, and (campfire, candle) not waterlogged. */
  Use.canBeLit = function (state) {
    var cake = inCol(col.candleCakes, state);
    if (!cake && !inCol(col.candles, state) && !isBlock(state, 'campfire') && !isBlock(state, 'soul_campfire')) return false;
    if (!has(state, 'lit') || prop(state, 'lit') === 'true') return false;
    return cake || !has(state, 'waterlogged') || prop(state, 'waterlogged') !== 'true';
  };

  /** FlintAndSteelItem: item.flintandsteel.use, pitch random*0.4+0.8. FireChargeItem: item.firecharge.use, (r-r)*0.2+1. */
  Use.igniteSound = function (stack, x, y, z) {
    if (!NS.Sound || !NS.Sound.play) return;
    var charge = NS.Items.nameOf(stack.i | 0) === 'fire_charge';
    NS.Sound.play(charge ? 'item.firecharge.use' : 'item.flintandsteel.use', {
      x: x + 0.5, y: y + 0.5, z: z + 0.5, source: 'block',
      pitch: charge ? (pRand() - pRand()) * 0.2 + 1 : pRand() * 0.4 + 0.8 });
  };

  /** What a successful ignition costs: flint and steel 1 durability, a fire charge 1 item; creative pays neither. */
  Use.spendIgniter = function (P, stack) {
    if (!P || P.instabuild || !stack) return;
    if (NS.Items.nameOf(stack.i | 0) === 'fire_charge') {
      if (NS.Inventory && NS.Inventory.shrink) NS.Inventory.shrink(stack, 1);
      if (P.syncHotbar) P.syncHotbar();
    } else Use.damage(P, stack, 1);
  };

  Use.isIgniter = function (stack) {
    var IT = NS.Items, Iv = NS.Inventory;
    if (!stack || (Iv && Iv.isEmpty(stack)) || !IT || !IT.ready) return false;
    var n = IT.nameOf(stack.i | 0);
    return n === 'flint_and_steel' || n === 'fire_charge';
  };

  /** Durability. ⚠ Creative does not spend it, which is `Player.abilities.instabuild`. */
  Use.damage = function (P, stack, amount) {
    var Iv = NS.Inventory, IT = NS.Items;
    if (!P || P.instabuild || !stack || !Iv || Iv.isEmpty(stack) || !IT) return false;
    var max = IT.durability ? IT.durability[stack.i | 0] : 0;
    if (!max) return false;
    // ItemStack.damage(int, Random, player): each point is negated when rand(level+1) > 0 (UnbreakingEnchantment.shouldPreventDamage, non-armor)
    var ub = NS.Combat && NS.Combat.enchantLevel ? NS.Combat.enchantLevel(stack, 'unbreaking') : 0;
    amount = amount | 0;
    for (var k = (amount > 0 ? amount : 0), prevented = 0; ub > 0 && k > 0; k--) if (pRand() * (ub + 1) | 0) prevented++;
    if (ub > 0 && amount > 0) { amount -= prevented; if (amount <= 0) return true; }
    // ItemStack.damage(int, Random, ServerPlayerEntity): Criteria.ITEM_DURABILITY_CHANGED.trigger(player, this, newDamage), before the damage is stored
    if (amount !== 0 && NS.Adv && NS.Adv.trigger && P.advancements) NS.Adv.trigger(P, 'minecraft:item_durability_changed', { player: P, origin: [P.x, P.y, P.z],
      newDamage: (stack.d | 0) + amount, item: { id: 'minecraft:' + IT.nameOf(stack.i | 0), count: stack.n | 0, damage: stack.d | 0, maxDamage: max, nbt: stack.t } });
    stack.d = (stack.d | 0) + amount;
    if (stack.d >= max && Iv.setItem && P.inventory) {
      // LivingEntity.sendToolBreakStatus: ENTITY_ITEM_BREAK
      if (NS.Sound && NS.Sound.entitySound) NS.Sound.entitySound('entity.item.break', P.x, P.y, P.z, 0.8, 0.8 + pRand() * 0.4, 'player', NS.Player);
      Iv.setItem(P.inventory, P.slot, null);
      if (P.syncHotbar) P.syncHotbar();
    }
    return true;
  };

  // ── directions, in this engine's own face numbering ───────────────────────────────────────
  var OPP = { north: 'south', south: 'north', east: 'west', west: 'east', up: 'down', down: 'up' };
  Use.opposite = function (d) { return OPP[d] || d; };
  /**
   * The horizontal direction the player is facing, as vanilla names it.
   * ⚠ YAW 0 IS **SOUTH** IN VANILLA AND **-Z (NORTH)** IN THIS ENGINE'S CAMERA, which is why this
   * is a table and not an arithmetic expression: every clone that writes the formula from memory
   * gets a gate that swings the wrong way exactly half the time.
   */
  Use.playerFacing = function (P) {
    var y = ((P && P.yaw) || 0) * 180 / Math.PI;
    y = ((y % 360) + 360) % 360;
    if (y >= 45 && y < 135) return 'east';
    if (y >= 135 && y < 225) return 'south';
    if (y >= 225 && y < 315) return 'west';
    return 'north';
  };

  // ═══════════════ the item's own `useOn` ══════════════════════════════════════════════════
  /**
   * `Item.useOn(UseOnContext)` for the items whose right-click changes the world but does not
   * place their own block. Returns true when it consumed the click.
   */
  Use.itemUseOn = function (P, x, y, z, face, state, stack) {
    var IT = NS.Items, Iv = NS.Inventory;
    if (!IT || !IT.ready || !stack || (Iv && Iv.isEmpty(stack))) return false;
    var name = IT.nameOf(stack.i | 0);
    var above = W.getBlock(x, y + 1, z);

    // ── DecorationItem.useOnBlock (G17-HG3)
    if ((name === 'painting' || name === 'item_frame' || name === 'glow_item_frame') && NS.Hanging)
      return NS.Hanging.useOnBlock(P, x, y, z, face, name, stack);

    // ── FireworkRocketItem.useOnBlock (#5081): spawns at the hit point + face*0.15 and always spends one.
    if (name === 'firework_rocket' && NS.Firework) return NS.Firework.useOnBlock(P, P.thx, P.thy, P.thz, face, stack);

    // ── LeadItem.useOnBlock: a fence face reattaches every mob leashed to the clicking
    // player, at that block, to a new (or shared) knot. `attachHeldMobsToBlock` never spends
    // the lead in hand itself (only the ORIGINAL player-attach does) -- return value here is
    // only whether the click was CONSUMED (`ActionResult.SUCCESS` vs `PASS`), same as vanilla.
    if (name === Tm_LEASH_NAME) {
      var TmL = NS.Tame;
      if (TmL && TmL.ready && col.fences >= 0 && inCol(col.fences, state)) {
        return TmL.attachHeldMobsToBlock(x, y, z);
      }
      return false;
    }

    // ── HoeItem: the TILLABLES table, and the rule that guards it ──────────────────────────
    // ⚠ **THE CELL ABOVE MUST BE AIR, AND COARSE DIRT GOES TO DIRT RATHER THAN TO FARMLAND.**
    // Both are vanilla's; the second is the one a clone invents wrongly, because "hoe makes
    // farmland" is the rule everybody remembers.
    if (endsWith(name, '_hoe')) {
      if (face !== Use.FACE_DOWN && above === 0) {
        var to = -1;
        if (isBlock(state, 'grass_block') || isBlock(state, 'dirt') || isBlock(state, 'podzol')
            || isBlock(state, 'mycelium') || isBlock(state, 'rooted_dirt')) to = id.farmland;
        else if (isBlock(state, 'coarse_dirt')) to = id.dirt;
        else if (isBlock(state, 'dirt_path')) to = id.farmland;
        if (to >= 0) {
          var st = S.stateOf(R.names[to]);
          W.setBlock(x, y, z, st);
          changed(x, y, z);
          Use.damage(P, stack, 1);
          return true;
        }
      }
      return false;
    }

    // ── ShovelItem: grass -> path ──────────────────────────────────────────────────────────
    // BoneMealItem.useOnFertilizable (.decomp), the crop/stem/sapling Fertilizables: `isFertilizable` (not yet mature)
    // -> `canGrow` (crops/stems always, SaplingBlock `nextFloat() < 0.45`) -> `grow`; the stack spends one on ANY
    // fertilizable click, grown or not (creative keeps it: the server restores a creative stack). CropBlock/StemBlock
    // grow `MathHelper.nextInt(2, 5)` ages (BeetrootsBlock: that / 3), capped at the max. A stage-1 sapling's grow is
    // SaplingGenerator's tree (Behave.growTree, #7736; Behave.grownSaplings counts it).
    // Brown/red mushrooms: Fertilizable.mushroomGrow. Kelp/sweet berries/cave vines: Fertilizable.plantStep. Grass block / grass / fern: Fertilizable.growGrassBlock/growPlant (biome flower feature still owed). Dripleaf: Use.fertilizeOther. Cocoa/flowers/bamboo/sea pickle/vines in Use.fertilizeOther; world event 1505 fires from the Use.itemUseOn wrapper.
    if (name === 'bone_meal') {
      if (col.crops === undefined) col.crops = column('crops');
      if (col.saplings === undefined) col.saplings = column('saplings');
      var pn = R.names[state], plant = (pn === 'sweet_berry_bush' || pn === 'cave_vines' || pn === 'cave_vines_plant' || pn === 'kelp');
      if (plant) {
        var abv = pn === 'kelp' && isBlock(W.getBlock(x, y + 1, z), 'water');
        var stp = NS.Fertilizable.plantStep(pn, +prop(state, 'age') | 0, prop(state, 'berries') === 'true', abv);
        if (stp) {
          if (stp.placeAge !== undefined) { W.setBlock(x, y + 1, z, setProp(state, 'age', String(stp.placeAge))); changed(x, y + 1, z); }
          else {
            var ns = state;
            if (stp.age !== undefined) ns = setProp(ns, 'age', String(stp.age));
            if (stp.berries) ns = setProp(ns, 'berries', 'true');
            W.setBlock(x, y, z, ns); changed(x, y, z);
          }
        } else return false;
        if (!P.instabuild && Iv) { Iv.shrink(stack, 1); if (Iv.isEmpty(stack)) Iv.setItem(P.inventory, P.slot, Iv.EMPTY); if (P.syncHotbar) P.syncHotbar(); }
        return true;
      }
      var azm = isBlock(state, 'azalea') || isBlock(state, 'flowering_azalea'), mossB = isBlock(state, 'moss_block');
      if (azm || mossB) {
        var gw = W.getBlock(x, y + 1, z), gwn = gw > 0 ? R.names[S.block[gw]] : 'air';
        if (azm ? (gwn === 'water' || gwn === 'lava') : gw !== 0) return false;   // isFertilizable: no fluid above / air above
        var gr = (NS.EntityList && NS.EntityList.random) || pRand;
        if (azm) { if (gr() < 0.45 && B && B.growFeature) { B.growFeature('azalea_tree', x, y, z, gr, true); changed(x, y, z); } }
        else if (B && B.growFeature) { B.growFeature('moss_patch_bonemeal', x, y + 1, z, gr, false); changed(x, y + 1, z); }
        if (!P.instabuild && Iv) { Iv.shrink(stack, 1); if (Iv.isEmpty(stack)) Iv.setItem(P.inventory, P.slot, Iv.EMPTY); if (P.syncHotbar) P.syncHotbar(); }
        return true;
      }
      if (isBlock(state, 'brown_mushroom') || isBlock(state, 'red_mushroom')) {
        // MushroomPlantBlock.grow: canGrow 0.4, the mushroom removed, the huge_*_mushroom feature (W track's own, with its
        // HugeMushroomFeature.canGenerate) placed there, the mushroom put back when it does not fit
        var mr = (NS.EntityList && NS.EntityList.random) || pRand;
        if (mr() < 0.4 && B && B.growFeature) {
          W.setBlock(x, y, z, 0);
          if (B.growFeature(isBlock(state, 'red_mushroom') ? 'huge_red_mushroom' : 'huge_brown_mushroom', x, y, z, mr, false)) changed(x, y, z);
          else W.setBlock(x, y, z, state);
        }
        if (!P.instabuild && Iv) { Iv.shrink(stack, 1); if (Iv.isEmpty(stack)) Iv.setItem(P.inventory, P.slot, Iv.EMPTY); if (P.syncHotbar) P.syncHotbar(); }
        return true;
      }
      var fgn = R.names[S.block[state]];
      if (fgn === 'crimson_fungus' || fgn === 'warped_fungus' || fgn === 'crimson_nylium' || fgn === 'warped_nylium') {
        var fnm = function (a, b, c) { var q = W.getBlock(a, b, c); return q > 0 ? R.names[S.block[q]] : 'air'; };
        var fenv = {
          bottom: -64, top: 320, name: fnm,
          replaceable: function (a, b, c) { return /^(air|cave_air|void_air|water|lava|grass|fern|tall_grass|large_fern|vine|snow|fire|seagrass|tall_seagrass|dead_bush)$/.test(fnm(a, b, c)); },
          plant: function (a, b, c) { return /^(crimson_fungus|warped_fungus|crimson_roots|warped_roots|nether_sprouts|weeping_vines|weeping_vines_plant|twisting_vines|twisting_vines_plant|brown_mushroom|red_mushroom)$/.test(fnm(a, b, c)); },
          canPlace: function (a, b, c, n) { var q = S.stateOf(n); var BW = NS.World; return !BW || !BW.canSurvive || BW.canSurvive(a, b, c, q); },
          set: function (a, b, c, n, pr) { var q = S.stateOf(n); if (pr) for (var kk in pr) q = setProp(q, kk, String(pr[kk])); W.setBlock(a, b, c, q); changed(a, b, c); }
        };
        var frnd = (NS.EntityList && NS.EntityList.random) || pRand;
        if (/nylium/.test(fgn)) { if (above !== 0) return false; NS.Fertilizable.nyliumGrow(fenv, frnd, x, y, z); }
        else if (NS.Fertilizable.fungusGrow(fenv, x, y, z, frnd, fgn === 'warped_fungus') === 2) return false;
        if (!P.instabuild && Iv) { Iv.shrink(stack, 1); if (Iv.isEmpty(stack)) Iv.setItem(P.inventory, P.slot, Iv.EMPTY); if (P.syncHotbar) P.syncHotbar(); }
        return true;
      }
      var ageMax = -1, isSap = inCol(col.saplings, state) && has(state, 'stage');
      if (!isSap && inCol(col.crops, state) && has(state, 'age')) ageMax = isBlock(state, 'beetroots') ? 3 : 7;
      var gname = R.names[S.block[state]], gGrass = gname === 'grass_block', gPlant = gname === 'grass' || gname === 'fern';
      var rnd = (NS.EntityList && NS.EntityList.random) || pRand;
      if (ageMax < 0 && !isSap && !gPlant && !gGrass) {
        if (!Use.fertilizeOther(state, x, y, z, rnd)) return false;
        if (!P.instabuild && Iv) { Iv.shrink(stack, 1); if (Iv.isEmpty(stack)) Iv.setItem(P.inventory, P.slot, Iv.EMPTY); if (P.syncHotbar) P.syncHotbar(); }
        return true;
      }
      if (ageMax < 0 && !isSap && !gPlant && !(gGrass && above === 0)) return false;   // GrassBlock.isFertilizable: air above
      if (gPlant || gGrass) {
        var genv = {
          name: function (a, b, c) { var q = W.getBlock(a, b, c); return q > 0 ? R.names[S.block[q]] : 'air'; },
          full: function (a, b, c) { var q = W.getBlock(a, b, c); return q > 0 && S.fullCubeCollision ? !!S.fullCubeCollision(q) : false; },
          canPlace: function (a, b, c, n) { var q = S.stateOf(n); var BW = NS.World; return !BW || !BW.canSurvive || BW.canSurvive(a, b, c, q); },
          set: function (a, b, c, n, half) { var q = S.stateOf(n); if (half) q = setProp(q, 'half', half); W.setBlock(a, b, c, q); changed(a, b, c); },
          // GrassBlock.grow: the biome's FIRST flower feature (Biome.getFlowerFeatures) places its own simple_block state
          flower: function (a, b, c, rr) {
            var Fe = NS.Features, bi = W.biomeAt ? W.biomeAt(a, c) : -1;
            if (!Fe || !Fe.bonemealFlower || bi < 0) return false;
            var rg = new NS.Carvers.Rng((rr() * 2147483647) | 0, (rr() * 2147483647) | 0, (rr() * 2147483647) | 0);
            var fs = Fe.bonemealFlower(bi, a, b, c, rg);
            if (!fs || W.getBlock(a, b, c) !== 0) return false;
            if (NS.World && NS.World.canSurvive && !NS.World.canSurvive(a, b, c, fs)) return false;
            W.setBlock(a, b, c, fs); changed(a, b, c); return true;
          }
        };
        if (gGrass) NS.Fertilizable.growGrassBlock(genv, rnd, x, y, z);
        else NS.Fertilizable.growPlant(genv, x, y, z, gname);
      } else if (isSap) {
        if (rnd() < 0.45) {
          if (prop(state, 'stage') === '0') { W.setBlock(x, y, z, setProp(state, 'stage', '1')); changed(x, y, z); }
          else if (B) { B.grownSaplings = (B.grownSaplings | 0) + 1; if (B.growTree) { B.growTree(x, y, z, state, rnd); changed(x, y, z); } }
        }
      } else {
        var ageNow = +prop(state, 'age') | 0;
        if (ageNow >= ageMax) return false;                              // isFertilizable: a mature crop PASSes
        W.setBlock(x, y, z, setProp(state, 'age', String(NS.Fertilizable.cropGrowAge(ageNow, ageMax, rnd))));
        changed(x, y, z);
      }
      if (!P.instabuild && Iv) { Iv.shrink(stack, 1); if (Iv.isEmpty(stack)) Iv.setItem(P.inventory, P.slot, Iv.EMPTY); if (P.syncHotbar) P.syncHotbar(); }
      return true;
    }

    if (endsWith(name, '_shovel')) {
      if (face !== Use.FACE_DOWN && above === 0 && isBlock(state, 'grass_block')) {
        W.setBlock(x, y, z, S.stateOf('dirt_path'));
        changed(x, y, z);
        Use.damage(P, stack, 1);
        return true;
      }
      // ShovelItem.useOnBlock's second branch: a LIT campfire (either kind) is put out -- `CampfireBlock.extinguish`,
      // world event 1009 -- whatever is above it, and the shovel takes 1 (useonrefcheck shovel_lit_campfire)
      if (face !== Use.FACE_DOWN && (isBlock(state, 'campfire') || isBlock(state, 'soul_campfire')) && prop(state, 'lit') === 'true') {
        W.setBlock(x, y, z, setProp(state, 'lit', false));
        playAt('entity.generic.extinguish_fire', x, y, z);
        changed(x, y, z);
        Use.damage(P, stack, 1);
        return true;
      }
      return false;
    }

    // ── AxeItem: STRIPPABLES ───────────────────────────────────────────────────────────────
    // ⚠ THE STRIPPED BLOCK KEEPS THE LOG'S `axis`, which is why this goes through the property
    // rather than through the default state: a stripped log that snaps back to vertical is the
    // tell that somebody wrote `stateOf(name)` here.
    //
    // s128 — `AxeItem.useOnBlock`'s other two branches, in its own order: strip, else SCRAPE one
    // oxidation tier off (`Oxidizable.getDecreasedOxidationState`), else WAX OFF
    // (`HoneycombItem.WAXED_TO_UNWAXED_BLOCKS`). Each plays its own sound and costs 1 durability.
    if (endsWith(name, '_axe')) {
      var stripped = Use.strippedOf(state), axeOut = -1, axeSound = null, axeEvent = 0;
      var Ox = NS.Oxidize;
      if (stripped > 0) {
        axeOut = stripped;
        if (has(state, 'axis') && has(axeOut, 'axis')) axeOut = setProp(axeOut, 'axis', prop(state, 'axis'));
        axeSound = 'item.axe.strip';
      } else if (Ox && Ox.decreased(state) !== null) {
        axeOut = Ox.decreased(state); axeSound = 'item.axe.scrape'; axeEvent = 3005;
      } else if (Ox && Ox.unwaxed(state) !== null) {
        axeOut = Ox.unwaxed(state); axeSound = 'item.axe.wax_off'; axeEvent = 3004;
      }
      if (axeOut > 0) {
        if (NS.Sound && NS.Sound.play) NS.Sound.play(axeSound, { x: x + 0.5, y: y + 0.5, z: z + 0.5, source: 'block' });
        // AxeItem.java:62/66 — syncWorldEvent(player, 3005 scrape / 3004 wax off, pos, 0) (D-664)
        if (axeEvent && NS.Particle && NS.Particle.worldEvent) NS.Particle.worldEvent(axeEvent, x, y, z, 0);
        W.setBlock(x, y, z, axeOut);
        changed(x, y, z);
        Use.damage(P, stack, 1);
        return true;
      }
      return false;
    }

    // ── HoneycombItem.useOnBlock (s128): an unwaxed copper block becomes its waxed twin, every
    // property carried; the honeycomb is spent (`decrement(1)` — creative restores the count).
    if (name === 'honeycomb') {
      var OxH = NS.Oxidize, waxedSt = OxH ? OxH.waxed(state) : null;
      if (waxedSt === null) return false;
      if (!P.instabuild && NS.Inventory && NS.Inventory.shrink) NS.Inventory.shrink(stack, 1);
      W.setBlock(x, y, z, waxedSt);
      changed(x, y, z);
      // HoneycombItem.java:59 — syncWorldEvent(player, 3003, pos, 0): the wax_on glow (D-664)
      if (NS.Particle && NS.Particle.worldEvent) NS.Particle.worldEvent(3003, x, y, z, 0);
      if (NS.Sound && NS.Sound.play) NS.Sound.play('item.honeycomb.wax_on', { x: x + 0.5, y: y + 0.5, z: z + 0.5, source: 'block' });
      return true;
    }

    // ── BucketItem / EntityBucketItem have NO useOnBlock (Item's default PASS) — every bucket
    // is `Use.bucketUse` below, in rightClick's plain-`use()` slot, with its OWN raycast.

    // ── FlintAndSteelItem: fire on the face ────────────────────────────────────────────────
    if (name === 'flint_and_steel' || name === 'fire_charge') {
      var ax = x + CFG.FACE_DX[face], ay = y + CFG.FACE_DY[face], az = z + CFG.FACE_DZ[face];
      if (W.getBlock(ax, ay, az) !== 0) return false;
      // ⚠ VANILLA ASKS THE FIRE BLOCK ITSELF whether it may be there, and this engine already
      // has that rule from G15's fire work — reusing it is what keeps a hand-lit fire and a
      // spread fire under one law.
      if (B && B.fireCanSurvive && !B.fireCanSurvive(ax, ay, az)) return false;
      Use.igniteSound(stack, ax, ay, az);
      W.setBlock(ax, ay, az, S.stateOf('fire'));
      changed(ax, ay, az);
      if (B && B.schedule) B.schedule(ax, ay, az, 30, 0);
      Use.spendIgniter(P, stack);
      return true;
    }

    // ── ArmorStandItem.useOnBlock (#4391): never on a floor-facing click; spot = the clicked cell if replaceable else its face neighbour.
    if (name === 'armor_stand') {
      if (face === CFG.FACE_DY.indexOf(-1)) return false;
      var ae = S.canBeReplacedBy(state, 0, face, y + 1, true);
      return NS.ArmorStand ? NS.ArmorStand.place(P, stack, ae ? x : x + CFG.FACE_DX[face], ae ? y : y + CFG.FACE_DY[face], ae ? z : z + CFG.FACE_DZ[face]) : false;
    }

    // ── EnderEyeItem.useOnBlock (#5084): fill an empty end_portal_frame; a completed 12-frame ring opens the 3x3 end_portal.
    if (name === 'ender_eye' && state && NS.Reg && NS.States.block[state] === NS.Reg.id.end_portal_frame && prop(state, 'eye') !== 'true') {
      W.setBlock(x, y, z, setProp(state, 'eye', true));
      if (NS.Redstone && NS.Redstone.updateComparators) NS.Redstone.updateComparators(x, y, z);
      if (!P.instabuild && Iv && Iv.shrink) Iv.shrink(stack, 1);
      if (NS.Particle && NS.Particle.worldEvent) NS.Particle.worldEvent(1503, x, y, z, 0);
      var FR = NS.Reg.id.end_portal_frame, portal = NS.Reg.realFirst[NS.Reg.id.end_portal] + NS.Reg.defaultState[NS.Reg.id.end_portal];
      var inward = { '-2,0': 'east', '2,0': 'west', '0,-2': 'south', '0,2': 'north' };
      for (var cx = x - 2; cx <= x + 2; cx++) for (var cz = z - 2; cz <= z + 2; cz++) {
        var okRing = true;
        for (var rx = -2; rx <= 2 && okRing; rx++) for (var rz = -2; rz <= 2 && okRing; rz++) {
          if (Math.abs(rx) !== 2 && Math.abs(rz) !== 2) continue;
          if (Math.abs(rx) === 2 && Math.abs(rz) === 2) continue;
          var fs = W.getBlock(cx + rx, y, cz + rz);
          if (NS.States.block[fs] !== FR || prop(fs, 'eye') !== 'true' || prop(fs, 'facing') !== inward[(rx / (Math.abs(rx) || 1)) * (Math.abs(rx) === 2 ? 2 : 0) + ',' + (rz / (Math.abs(rz) || 1)) * (Math.abs(rz) === 2 ? 2 : 0)]) okRing = false;
        }
        if (!okRing) continue;
        for (var px = -1; px <= 1; px++) for (var pz = -1; pz <= 1; pz++) W.setBlock(cx + px, y, cz + pz, portal);
        if (NS.Particle && NS.Particle.worldEvent) NS.Particle.worldEvent(1038, cx, y, cz, 0);
        return true;
      }
      return true;
    }

    // ── EndCrystalItem.useOnBlock: obsidian/bedrock with air above and no entity in the 1x2 column; one item spent.
    if (name === 'end_crystal' && NS.EndCrystal && NS.EndCrystal.useOnBlock) {
      if (!NS.EndCrystal.useOnBlock(x, y, z)) return false;
      if (!P.instabuild && Iv && Iv.shrink) Iv.shrink(stack, 1);
      return true;
    }

    // ── MinecartItem.useOnBlock (#4828): only on a rail; y + 0.0625 (+0.5 on an ascending shape); one item spent (creative keeps it).
    if (NS.Minecart && NS.Minecart.isCart(name)) {
      if (!NS.Rail || !NS.Rail.isRail(state)) return false;
      var cart = NS.EntityList && NS.EntityList.spawn(name, x + 0.5, y + 0.0625 + (NS.Rail.isAscending(NS.Rail.shapeOf(state)) ? 0.5 : 0), z + 0.5);
      if (!cart) return false;
      var cartTag = NS.Inventory && NS.Inventory.tagOf ? NS.Inventory.tagOf(stack) : null;   // stack.hasCustomName -> setCustomName
      if (cartTag && cartTag.display && typeof cartTag.display.Name === 'string') cart.customName = cartTag.display.Name;
      if (!P.instabuild && NS.Inventory && NS.Inventory.shrink) NS.Inventory.shrink(stack, 1);
      return true;
    }

    // ── spawn egg ON A SPAWNER — `SpawnEggItem.useOnBlock` (well-known 1.18.2 mechanic;
    // this file's `.decomp` subset carries no `SpawnEggItem.java` to cite line numbers
    // from, named rather than guessed). Clicking a spawn egg on the SPAWNER BLOCK ITSELF
    // (not the face it was clicked on — `state`/`x,y,z` here, unlike the offset `sx,sy,sz`
    // the generic branch below spawns AT) sets that spawner's entity and spawns nothing;
    // it does not require `EL.canSpawn` — a spawner may be set for a type this engine
    // cannot yet simulate, the same as vanilla accepts any registered EntityType.
    if (endsWith(name, '_spawn_egg') && R && S && R.names[S.block[state]] === 'spawner') {
      var spawnerEggType = name.slice(0, name.length - '_spawn_egg'.length);
      if (NS.Spawner && NS.Spawner.assign && NS.Spawner.assign(x, y, z, spawnerEggType)) {
        var IvSp = NS.Inventory;
        if (!P.instabuild && IvSp && IvSp.shrink) IvSp.shrink(stack, 1);
        return true;
      }
      return false;
    }

    // ── SpawnEggItem.useOnBlock (s119, .decomp item/SpawnEggItem.java + EntityType.create/
    // getOriginY, all read whole). ⚠ THE CLICKED BLOCK DECIDES WHERE: a block with NO collision
    // shape (tall grass, a flower, a torch) takes the mob INTO its own cell;
    // anything else puts it on the clicked FACE's neighbour. Then `create(..., alignPosition=true,
    // invertY = moved && face == UP)`: the mob is dropped from pos.y+1 onto whatever collides in
    // that cell (and the one below when invertY), so an egg on a slab stands ON the slab, not
    // half a block above it (`Use.eggOriginY`). Yaw is `wrapDegrees(random*360)`, head = body.
    // Every type `EL.canSpawn` refuses (the Nether/End mobs no stage has built) still refuses,
    // named on `Use.OWED`, not silently.
    if (endsWith(name, '_spawn_egg')) {
      var eggType = name.slice(0, name.length - '_spawn_egg'.length);
      var EL = NS.EntityList;
      if (EL && EL.canSpawn(eggType)) {
        var empty = Use.collisionEmpty(state);
        var px = empty ? x : x + CFG.FACE_DX[face];
        var py = empty ? y : y + CFG.FACE_DY[face];
        var pz = empty ? z : z + CFG.FACE_DZ[face];
        var invertY = !empty && face === Use.eggFaceUp();
        var mob = Use.spawnFromEgg(eggType, px, py, pz, true, invertY);
        if (mob) {
          // ⚠ CREATIVE DOES NOT SPEND IT — `P.instabuild` (ServerPlayerInteractionManager restores
          // the count after `useOnBlock` in creative), the SAME flag `Use.damage` reads.
          var Iv = NS.Inventory;
          if (!P.instabuild && Iv && Iv.shrink) Iv.shrink(stack, 1);
          return true;
        }
      }
      Use.lastRefusal = 'spawn eggs wait on G18c for ' + eggType +
        ' \u2014 EntityList has no measured motion for it yet (D-307)';
      return false;
    }

    return false;
  };

  // ── s119: SpawnEggItem's shared substrate ────────────────────────────────────────────────
  Use.FACE_UP = null;   // resolved in Use.eggFaceUp() off CFG (the face whose FACE_DY is +1)
  Use.eggFaceUp = function () {
    if (Use.FACE_UP === null && CFG && CFG.FACE_DY) {
      for (var f = 0; f < CFG.FACE_DY.length; f++) if (CFG.FACE_DY[f] === 1) Use.FACE_UP = f;
    }
    return Use.FACE_UP;
  };
  /** `BlockState.getCollisionShape(...).isEmpty()` — air, and every non-solid state. */
  Use.collisionEmpty = function (state) {
    if (!(state > 0)) return true;
    if (S.solid && S.solid[state] !== 1) return true;
    var Ph = NS.Physics;
    var sh = Ph && Ph.shapesForState ? Ph.shapesForState(state) : true;
    return !sh || sh.length === 0;
  };
  /**
   * `EntityType.getOriginY(world, pos, invertY, box)` — `1 + VoxelShapes.calculateMaxOffset(Y,
   * box, collisions in Box(pos) [stretched down 1 when invertY], invertY ? -2 : -1)`, with `box`
   * the mob's own box at (pos.x+.5, pos.y+1, pos.z+.5). Only shapes that INTERSECT the query
   * box count (BlockCollisionSpliterator's own `intersects`); of those, only ones overlapping
   * the mob horizontally and at or below its feet can stop the fall.
   */
  Use.eggOriginY = function (px, py, pz, width, invertY) {
    var Ph = NS.Physics;
    var limit = invertY ? -2 : -1;
    var off = limit;
    var qMinY = invertY ? py - 1 : py, qMaxY = py + 1;
    var feet = py + 1, hw = width / 2, cx = px + 0.5, cz = pz + 0.5;
    var EPS = 1e-7;
    for (var by = py - 2; by <= py; by++) {
      var st = W.getBlock(px, by, pz);
      if (Use.collisionEmpty(st)) continue;
      var boxes = Ph && Ph.shapesForState ? Ph.shapesForState(st) : null;
      if (!boxes) continue;
      for (var i = 0; i < boxes.length; i++) {
        var b = boxes[i];
        var bx0 = px + b[0], by0 = by + b[1], bz0 = pz + b[2], bx1 = px + b[3], by1 = by + b[4], bz1 = pz + b[5];
        // intersects the query box Box(pos) (stretched)?
        if (!(bx1 > px + EPS && bx0 < px + 1 - EPS && bz1 > pz + EPS && bz0 < pz + 1 - EPS &&
              by1 > qMinY + EPS && by0 < qMaxY - EPS)) continue;
        // overlaps the mob horizontally, and lies at or below its feet
        if (!(bx1 > cx - hw + EPS && bx0 < cx + hw - EPS && bz1 > cz - hw + EPS && bz0 < cz + hw - EPS)) continue;
        if (by1 > feet + EPS) continue;
        var d = by1 - feet;
        if (d > off) off = d;
      }
    }
    return 1 + off;
  };
  /**
   * `EntityType.spawnFromItemStack` -> `create`: position (x+.5, y + originY, z+.5) — originY is
   * 0 unless `alignPosition` — and yaw `wrapDegrees(world.random.nextFloat()*360)`, with
   * `headYaw = bodyYaw = yaw` for a mob (engine yaw is radians, D-415).
   */
  Use.spawnFromEgg = function (type, px, py, pz, alignPosition, invertY, rand) {
    var EL = NS.EntityList, E = NS.Entities;
    if (!EL || !EL.canSpawn(type)) return null;
    var dim = E && E.dimensions ? E.dimensions(E.bare(type)) : null;
    if (Use.eggFaceUp() === null) { /* CFG not ready: no UP face to compare */ }
    var oy = alignPosition ? Use.eggOriginY(px, py, pz, dim ? dim.width : 0.6, !!invertY) : 0;
    var mob = EL.spawn(type, px + 0.5, py + oy, pz + 0.5);
    if (!mob) return null;
    var r = (rand || EL.random || pRand)();
    var deg = r * 360; deg = deg % 360; if (deg >= 180) deg -= 360; if (deg < -180) deg += 360;  // MathHelper.wrapDegrees
    mob.yaw = deg * Math.PI / 180;
    mob.yHeadRot = mob.yaw; mob.yawO = mob.yaw; mob.yHeadRotO = mob.yaw;
    return mob;
  };
  /**
   * `SpawnEggItem.use` (air click): a SOURCE_ONLY raycast; only when the hit block is a
   * `FluidBlock` (water/lava) does the mob spawn IN it, `alignPosition=false` (y = pos.y exactly).
   * Creative keeps the egg. Reached from `Use.rightClick`'s fallback slot — i.e. only when the
   * crosshair (which ignores fluids) found no block, the same place vanilla's `use()` runs.
   */
  Use.spawnEggInFluid = function (P, stack) {
    var IT = NS.Items, Ray = NS.Ray;
    if (!IT || !Ray || !P || !P.lookVec) return false;
    var name = IT.nameOf(stack.i | 0) || '';
    if (!endsWith(name, '_spawn_egg')) return false;
    var type = name.slice(0, name.length - '_spawn_egg'.length);
    var f = P.lookVec();
    var hit = Ray.cast(P.ex, P.ey + (P.eyeHeight || P.EYE), P.ez, f[0], f[1], f[2], P.reach,
                       function (id) { return Ray.targetable(id) || Use.isFluidSource(id); });
    if (!hit) return false;
    var hx = hit.x, hy = hit.y, hz = hit.z;
    var st = W.getBlock(hx, hy, hz);
    if (!isBlock(st, 'water') && !isBlock(st, 'lava')) return false;
    var mob = Use.spawnFromEgg(type, hx, hy, hz, false, false);
    if (!mob) { Use.lastRefusal = 'spawn eggs wait on G18c for ' + type; return false; }
    var Iv = NS.Inventory;
    if (!P.instabuild && Iv && Iv.shrink) Iv.shrink(stack, 1);
    return true;
  };
  /**
   * `BoatItem.use` (#5230, .decomp read whole): a fluid-ANY raycast at reach; MISS -> PASS. A collidable entity
   * (RIDERS: boat, minecart, any living) whose box (margin 0) contains the EYE passes. Otherwise the boat of the
   * item's wood is built at the exact hit point with the player's yaw; a box that overlaps a solid cell fails
   * (isSpaceEmpty). Creative keeps the stack. Returns true only when a boat was placed.
   */
  Use.boatUse = function (P, stack) {
    var IT = NS.Items, Ray = NS.Ray, EL = NS.EntityList, Bt = NS.Boat;
    if (!IT || !Ray || !EL || !Bt || !P || !P.lookVec || !stack) return false;
    var name = IT.nameOf(stack.i | 0) || '';
    if (!endsWith(name, '_boat') || Bt.TYPES.indexOf(name.slice(0, name.length - 5)) < 0) return false;
    var wood = name.slice(0, name.length - 5);
    var f = P.lookVec(), ex = P.ex, ey = P.ey + (P.eyeHeight || P.EYE), ez = P.ez;
    var hit = Ray.cast(ex, ey, ez, f[0], f[1], f[2], P.reach,
                       function (id) { return Ray.targetable(id) || Use.isFluidSource(id); });
    if (!hit) return false;
    var hx = hit.hx, hy = hit.hy, hz = hit.hz;
    for (var i = 0; i < EL.list.length; i++) {
      var o = EL.list[i];
      if (o.removed || o.dead || o.spectator) continue;
      if (!(o.maxHealth > 0 || o.type === 'boat' || (o.type && o.type.indexOf('minecart') >= 0))) continue;
      var hw = (o.width || 0.6) / 2, h = o.height || 1;
      if (ex >= o.x - hw && ex <= o.x + hw && ey >= o.y && ey <= o.y + h && ez >= o.z - hw && ez <= o.z + hw) return false;
    }
    var e = EL.spawn('boat', hx, hy, hz, { boatType: wood });
    if (!e) return false;
    var Ph = NS.Physics, hw2 = e.width / 2, clear = true;
    for (var x = Math.floor(hx - hw2); x <= Math.floor(hx + hw2) && clear; x++)
      for (var y = Math.floor(hy); y <= Math.floor(hy + e.height) && clear; y++)
        for (var z = Math.floor(hz - hw2); z <= Math.floor(hz + hw2); z++)
          if (Ph.shapeAt(x, y, z) && Ph.boxIntersectsCell(e, x, y, z)) { clear = false; break; }
    if (!clear) { e.removed = true; var k = EL.list.indexOf(e); if (k >= 0) EL.list.splice(k, 1); return false; }
    e.yaw = P.yaw; e.yawO = P.yaw;
    var Iv = NS.Inventory;
    if (!P.instabuild && Iv && Iv.shrink) Iv.shrink(stack, 1);
    return true;
  };
  /**
   * `MobEntity.interactWithItem`'s spawn-egg branch -> `SpawnEggItem.spawnBaby` (.decomp, read
   * whole): an egg of the SAME type on a mob makes a baby at the mob's position, yaw/pitch 0.
   * A `PassiveEntity` makes it with `createChild(world, this)` (this engine: `Breed.CHILD_SPECIES`
   * + `Breed.CHILD` with the mob as BOTH parents); any other mob with `EntityType.create`. It
   * must then really BE a baby (`setBaby(true)` then `isBaby()`), which is exactly
   * `Use.EGG_BABY` — the PassiveEntity subclasses plus the zombie/piglin/zoglin families that
   * override setBaby (derived from .decomp's class tree; `eggcheck` re-derives it). Parrot,
   * wandering trader and the bare horse base return null from createChild -> PASS.
   */
  Use.EGG_BABY_PASSIVE = ['axolotl', 'bee', 'cat', 'chicken', 'cow', 'donkey', 'fox', 'goat', 'hoglin',
    'horse', 'llama', 'mooshroom', 'mule', 'ocelot', 'panda', 'pig', 'polar_bear', 'rabbit',
    'sheep', 'skeleton_horse', 'strider', 'trader_llama', 'turtle', 'villager', 'wolf', 'zombie_horse'];
  Use.EGG_BABY_SETBABY = ['drowned', 'husk', 'piglin', 'zoglin', 'zombie', 'zombie_villager', 'zombified_piglin'];
  Use.EGG_BABY_NULLCHILD = ['parrot', 'wandering_trader'];
  /** VillagerEntity.sayNo: setHeadRollingTimeLeft(40) + entity.villager.no (ticked down in VB.tick). */
  Use.villagerSayNo = function (e) {
    e.headRollingTimeLeft = 40;
    if (NS.Sound && NS.Sound.play) NS.Sound.play('entity.villager.no', {
      x: e.x, y: e.y, z: e.z, source: 'neutral', volume: 1, pitch: e.isBaby || e.baby ? (pRand() - pRand()) * 0.2 + 1.5 : (pRand() - pRand()) * 0.2 + 1 });
  };
  Use.spawnEggBaby = function (P, e, stack) {
    var IT = NS.Items, EL = NS.EntityList, Br = NS.Breed, E = NS.Entities;
    if (!IT || !EL || !e || !stack) return false;
    var name = IT.nameOf(stack.i | 0) || '';
    if (!endsWith(name, '_spawn_egg')) return false;
    var type = name.slice(0, name.length - '_spawn_egg'.length);
    var et = E && E.bare ? E.bare(e.type) : e.type;
    if (type !== et) return false;                                   // isOfSameEntityType
    var passive = Use.EGG_BABY_PASSIVE.indexOf(et) >= 0;
    if (!passive && Use.EGG_BABY_SETBABY.indexOf(et) < 0) return false;   // setBaby is a no-op
    if (Use.EGG_BABY_NULLCHILD.indexOf(et) >= 0) return false;
    var childType = (passive && Br && Br.CHILD_SPECIES) ? Br.CHILD_SPECIES(et, et) : et;
    if (!EL.canSpawn(childType)) return false;
    var child = EL.spawn(childType, e.x, e.y, e.z);
    if (!child) return false;
    if (passive && Br && Br.CHILD) {
      var ch = Br.CHILD[E.bare(childType)];
      if (ch) ch(child, e, e, EL.random || pRand);
    }
    if (Br && Br.setBaby) Br.setBaby(child, true); else child.growAge = -24000;
    child.yaw = 0; child.yHeadRot = 0; child.yawO = 0; child.yHeadRotO = 0;
    var Iv = NS.Inventory;
    if (!P.instabuild && Iv && Iv.shrink) Iv.shrink(stack, 1);
    return true;
  };

  /** The stripped counterpart of a log, or -1. Derived from the registry, not from a table. */
  Use.strippedOf = function (state) {
    if (!(state > 0)) return -1;
    var n = R.names[S.block[state]];
    if (!n || n.indexOf('stripped_') === 0) return -1;
    var want = 'stripped_' + n;
    var b = R.names.indexOf(want);
    if (b < 0) return -1;
    return S.stateOf(want);
  };

  /**
   * `BoneMealItem.useOnGround` (.decomp) for the seagrass half: a water SOURCE at (x,y,z) -> 128 tries, each a random walk of
   * `i/16` steps (`nextInt(3)-1, (nextInt(3)-1)*nextInt(3)/2, nextInt(3)-1`, a full cube ends the try); water source over a
   * solid floor becomes seagrass, an existing seagrass grows (1 in 10) into tall_seagrass when water is above. Returns true
   * when the click counts (the caller spends one).  The warm_ocean coral / dead-coral wall fan branch is in (`face` = the clicked side).
   */
  Use.boneMealGround = function (x, y, z, rnd, face) {
    rnd = rnd || pRand;
    var ni = function (n) { return Math.floor(rnd() * n); };
    if (!Use.isFluidSource(W.getBlock(x, y, z)) || !isBlock(W.getBlock(x, y, z), 'water')) return false;
    var CF = NS.CFG, T = NS.Tags, B = NS.Biomes;
    var horiz = face !== undefined && face >= 0 && CF.FACE_DY[face] === 0;
    var FACING = ['east', 'west', null, null, 'south', 'north'];
    var pick = function (tag) {
      var m = T && T.ready ? T.blocks(tag) : null;
      return m && m.length ? S.stateOf(String(m[ni(m.length)]).replace('minecraft:', '')) : 0;
    };
    for (var i = 0; i < 128; i++) {
      var px = x, py = y, pz = z, blocked = false, st = S.stateOf('seagrass');
      for (var j = 0; j < (i >> 4); j++) {
        px += ni(3) - 1; py += Math.trunc((ni(3) - 1) * ni(3) / 2); pz += ni(3) - 1;
        if (S.solidRender(W.getBlock(px, py, pz))) { blocked = true; break; }
      }
      if (blocked) continue;
      // BoneMealItem.useOnGround: in a warm_ocean the first try on a side face is a dead-coral wall fan, a quarter of the
      // others an underwater_bonemeals plant (corals, fans, seagrass) (tag draws via the world random, exactly as `getEntryList(..).getRandom`)
      if (B && W.biomeAt && String(B.name(W.biomeAt(px, pz))).replace('minecraft:', '') === 'warm_ocean') {
        var cs = 0;
        if (i === 0 && horiz) { cs = pick('wall_corals'); if (cs && FACING[face]) cs = setProp(cs, 'facing', FACING[face]); }
        else if (ni(4) === 0) cs = pick('underwater_bonemeals');
        if (cs) st = cs;
      }
      if (has(st, 'facing') && /_wall_fan$/.test(R.names[S.block[st]])) {
        var dirs = ['north', 'south', 'west', 'east'];
        for (var t = 0; !(W.canSurvive ? W.canSurvive(px, py, pz, st) : true) && t < 4; t++) st = setProp(st, 'facing', dirs[ni(4)]);
      }
      if (!(W.canSurvive ? W.canSurvive(px, py, pz, st) : S.solidRender(W.getBlock(px, py - 1, pz)))) continue;
      var here = W.getBlock(px, py, pz);
      if (isBlock(here, 'water') && Use.isFluidSource(here)) { W.setBlock(px, py, pz, st); changed(px, py, pz); }
      else if (isBlock(here, 'seagrass') && ni(10) === 0) {
        var up = W.getBlock(px, py + 1, pz);
        if (isBlock(up, 'water') && Use.isFluidSource(up)) {
          W.setBlock(px, py, pz, setProp(S.stateOf('tall_seagrass'), 'half', 'lower'));
          W.setBlock(px, py + 1, pz, setProp(S.stateOf('tall_seagrass'), 'half', 'upper'));
          changed(px, py, pz); changed(px, py + 1, pz);
        }
      }
    }
    return true;
  };

  /**
   * The rest of `Fertilizable` (.decomp): TallFlowerBlock (grow = drop the item), AbstractPlantStemBlock (twisting/weeping
   * vines: age+1 capped 25, `VineLogic.getGrowthLength` = nextDouble() < 0.826^n, into air along the growth direction),
   * BambooSaplingBlock (-> bamboo above), BambooBlock (1 + nextInt(2) segments, `updateLeaves`), SeaPickleBlock (the
   * 5-wide diamond of `nextInt(6)==0` tries over coral floor, then this one to 4). Returns true when the block is
   * fertilizable (the click counts), false otherwise.
   */
  Use.fertilizeOther = function (state, x, y, z, rnd) {
    var ni = function (n) { return Math.floor(rnd() * n); };
    var air = function (px, py, pz) { return W.getBlock(px, py, pz) === 0; };
    var set = function (px, py, pz, st) { W.setBlock(px, py, pz, st); changed(px, py, pz); };
    if (isBlock(state, 'sunflower') || isBlock(state, 'lilac') || isBlock(state, 'rose_bush') || isBlock(state, 'peony')) {
      if (NS.EntityList && NS.EntityList.dropStack && NS.Items) {
        var nm = R.names[S.block[state]];
        NS.EntityList.dropStack(x + 0.5, y + 0.5, z + 0.5, NS.Items.of(nm), 1);
      }
      return true;
    }
    // ── BigDripleafBlock / SmallDripleafBlock .grow (#9261): `nextInt(2,5)` draws ONE int; stems below, a leaf on top
    var bigD = isBlock(state, 'big_dripleaf'), smallD = isBlock(state, 'small_dripleaf');
    if (bigD || smallD) {
      var okInto = function (px, py, pz) {
        if (py < -64 || py >= 320) return false;
        var q = W.getBlock(px, py, pz);
        return q === 0 || isBlock(q, 'water') || isBlock(q, 'small_dripleaf');
      };
      var stillW = function (px, py, pz) {
        var q = W.getBlock(px, py, pz);
        return q > 0 && ((isBlock(q, 'water') && Use.isFluidSource(q)) || (has(q, 'waterlogged') && String(prop(q, 'waterlogged')) === 'true'));
      };
      var wl = function (px, py, pz) { return stillW(px, py, pz) ? 'true' : 'false'; };
      var fcOf = prop(state, 'facing');
      if (bigD) {
        if (!okInto(x, y + 1, z)) return false;
        var upw = wl(x, y + 1, z);
        var stw = wl(x, y, z);
        W.setBlock(x, y + 1, z, setProp(setProp(S.stateOf('big_dripleaf'), 'waterlogged', upw), 'facing', fcOf), true);
        W.setBlock(x, y, z, setProp(setProp(S.stateOf('big_dripleaf_stem'), 'waterlogged', stw), 'facing', fcOf), true);
        changed(x, y, z); changed(x, y + 1, z);
        return true;
      }
      var by = prop(state, 'half') === 'upper' ? y - 1 : y;
      var bs = W.getBlock(x, by, z);
      fcOf = prop(bs, 'facing');
      set(x, by + 1, z, stillW(x, by + 1, z) ? S.stateOf('water') : 0);
      var nGrow = 2 + Math.floor(rnd() * 4), cnt = 0, gy = by;
      while (cnt < nGrow && okInto(x, gy, z)) { cnt++; gy++; }
      var topY = by + cnt - 1;
      // placed whole (noGate): stem and leaf only survive each other; vanilla flag 3 schedules a tick instead
      var wls = []; for (gy = by; gy <= topY; gy++) wls.push(wl(x, gy, z));
      var mk = function (nm, w) { return setProp(setProp(S.stateOf(nm), 'waterlogged', w), 'facing', fcOf); };
      W.setBlock(x, topY, z, mk('big_dripleaf', wls[topY - by]), true);
      for (gy = topY - 1; gy >= by; gy--) W.setBlock(x, gy, z, mk('big_dripleaf_stem', wls[gy - by]), true);
      for (gy = by; gy <= topY; gy++) changed(x, gy, z);
      return true;
    }
    // CocoaBlock.isFertilizable (age < 2) / grow: age + 1
    if (isBlock(state, 'cocoa')) {
      var cage = +prop(state, 'age') | 0;
      if (cage >= 2) return false;
      set(x, y, z, setProp(state, 'age', String(cage + 1)));
      return true;
    }
    var up = isBlock(state, 'twisting_vines');
    if (up || isBlock(state, 'weeping_vines')) {
      var dy = up ? 1 : -1;
      if (!air(x, y + dy, z)) return false;
      var age = Math.min((+prop(state, 'age') | 0) + 1, 25), py = y + dy;
      var len = 0, lim = 1;
      while (rnd() < lim) { len++; lim *= 0.826; }
      for (var i = 0; i < len && air(x, py, z); i++) {
        set(x, py, z, setProp(state, 'age', String(age)));
        py += dy; age = Math.min(age + 1, 25);
      }
      return true;
    }
    if (isBlock(state, 'bamboo_sapling')) {
      if (!air(x, y + 1, z)) return false;
      set(x, y + 1, z, setProp(S.stateOf('bamboo'), 'leaves', 'small'));
      return true;
    }
    if (isBlock(state, 'bamboo')) {
      var isB = function (px, py) { return isBlock(W.getBlock(px, py, z), 'bamboo'); };
      var above = 0, below = 0;
      while (above < 16 && isB(x, y + above + 1)) above++;
      while (below < 16 && isB(x, y - below - 1)) below++;
      if (above + below + 1 >= 16 || prop(W.getBlock(x, y + above, z), 'stage') === '1') return false;
      var total = above + below + 1, n = 1 + ni(2);
      for (var k = 0; k < n; k++) {
        var cy = y + above, cur = W.getBlock(x, cy, z);
        if (total >= 16 || prop(cur, 'stage') === '1' || !air(x, cy + 1, z)) break;
        var under = W.getBlock(x, cy - 1, z), st2 = W.getBlock(x, cy - 2, z), lv = 'none';
        if (!isBlock(under, 'bamboo') || prop(under, 'leaves') === 'none') lv = 'small';
        else {
          lv = 'large';
          if (isBlock(st2, 'bamboo')) {
            set(x, cy - 1, z, setProp(under, 'leaves', 'small'));
            set(x, cy - 2, z, setProp(st2, 'leaves', 'none'));
          }
        }
        var a2 = prop(cur, 'age') !== '1' && !isBlock(st2, 'bamboo') ? 0 : 1;
        var stg = (total < 11 || !(rnd() < 0.25)) && total !== 15 ? 0 : 1;
        var nb = setProp(setProp(setProp(S.stateOf('bamboo'), 'age', String(a2)), 'leaves', lv), 'stage', String(stg));
        set(x, cy + 1, z, nb);
        above++; total++;
      }
      return true;
    }
    if (isBlock(state, 'sea_pickle')) {
      var coral = column('coral_blocks');
      if (String(prop(state, 'waterlogged')) === 'true' && inCol(coral, W.getBlock(x, y - 1, z))) {
        var w = 5, h = 1, off = 0, cnt = 0, x0 = x - 2;
        var pick = S.stateOf('sea_pickle');
        for (var a = 0; a < 5; a++) {
          for (var b = 0; b < h; b++) {
            var top = 2 + y - 1;
            for (var yy = top - 2; yy < top; yy++) {
              var qx = x0 + a, qz = z - off + b;
              if (!(qx === x && yy === y && qz === z) && ni(6) === 0 && isBlock(W.getBlock(qx, yy, qz), 'water') &&
                  inCol(coral, W.getBlock(qx, yy - 1, qz))) {
                set(qx, yy, qz, setProp(setProp(pick, 'pickles', String(ni(4) + 1)), 'waterlogged', 'true'));
              }
            }
          }
          if (cnt < 2) { h += 2; off++; } else { h -= 2; off--; }
          cnt++;
        }
        set(x, y, z, setProp(state, 'pickles', '4'));
      }
      return true;
    }
    return false;
  };

  // BoneMealItem.useOnFertilizable: a spent click syncs world event 1505 (particles + sound) at the clicked cell
  var itemUseOnInner = Use.itemUseOn;
  Use.itemUseOn = function (P, x, y, z, face, state, stack) {
    var isBM = !!(stack && NS.Items && NS.Items.ready && NS.Items.nameOf(stack.i | 0) === 'bone_meal');
    var ok = itemUseOnInner.apply(this, arguments);
    if (!ok && isBM && !P.dispenser && face >= 0 && face < 6 && state > 0 && S.solidRender(state)) {
      // BoneMealItem.useOnBlock's else branch: a solid side -> useOnGround at the neighbour (seagrass / warm-ocean coral)
      var gx = x + NS.CFG.FACE_DX[face], gy = y + NS.CFG.FACE_DY[face], gz = z + NS.CFG.FACE_DZ[face];
      if (Use.boneMealGround(gx, gy, gz, (NS.EntityList && NS.EntityList.random) || pRand, face)) {
        if (P && !P.instabuild && NS.Inventory) { NS.Inventory.shrink(stack, 1); if (NS.Inventory.isEmpty(stack) && P.inventory) NS.Inventory.setItem(P.inventory, P.slot, NS.Inventory.EMPTY); if (P.syncHotbar) P.syncHotbar(); }
        if (NS.Particle && NS.Particle.worldEvent) NS.Particle.worldEvent(1505, gx, gy, gz, 0);
        return true;
      }
    }
    if (ok && isBM && NS.Particle && NS.Particle.worldEvent) NS.Particle.worldEvent(1505, x, y, z, 0);
    return ok;
  };

  /** A fluid SOURCE — level 0 — which is the only thing a bucket may pick up. */
  Use.isFluidSource = function (state) {
    if (!(state > 0)) return false;
    if (!isBlock(state, 'water') && !isBlock(state, 'lava')) return false;
    if (!has(state, 'level')) return true;
    return prop(state, 'level') === '0';
  };

  // ═══════════════ BucketItem.use — .decomp BucketItem.java + EntityBucketItem.java ═══════════
  // ⚠⚠ **A BUCKET CASTS ITS OWN RAY.** `Item.raycast` (Item.java:298) — the eye, the look vector,
  // a FIXED 5.0 blocks (not the player's reach), OUTLINE shapes, and fluid handling SOURCE_ONLY
  // for the empty bucket / NONE for a full one. The crosshair ray skips fluids, so a bucket that
  // acted on the crosshair block (this file until s-ptolemy) could never pick anything up: aimed
  // straight down at a water source it saw the stone underneath (bucketrefcheck, 37 reds).
  var BUCKET_FLUID = { bucket: '', water_bucket: 'water', lava_bucket: 'lava', cod_bucket: 'water',
    salmon_bucket: 'water', pufferfish_bucket: 'water', tropical_fish_bucket: 'water', axolotl_bucket: 'water' };
  var BUCKET_ENTITY = { cod_bucket: 'cod', salmon_bucket: 'salmon', pufferfish_bucket: 'pufferfish',
    tropical_fish_bucket: 'tropical_fish', axolotl_bucket: 'axolotl' };
  // blocks whose fluid state is ALWAYS still water (their getFluidState returns WATER.getStill(false))
  var ALWAYS_WATER = ['kelp', 'kelp_plant', 'seagrass', 'tall_seagrass', 'bubble_column'];
  // FluidFillable: Waterloggable + KelpBlock/KelpPlantBlock/SeagrassBlock/TallSeagrassBlock (their canFillWithFluid is false)
  var FILLABLE_PLANTS = ['kelp', 'kelp_plant', 'seagrass', 'tall_seagrass'];
  function anyOf(state, names) { for (var i = 0; i < names.length; i++) if (isBlock(state, names[i])) return true; return false; }
  function waterlogged(state) { return state > 0 && has(state, 'waterlogged') && String(prop(state, 'waterlogged')) === 'true'; }
  /** The fluid a state carries ('water' | 'lava' | ''), and whether it is STILL (`FluidState.isStill`). */
  function fluidOf(state) {
    if (!(state > 0)) return { f: '', still: false };
    if (isBlock(state, 'water') || isBlock(state, 'lava')) return { f: isBlock(state, 'water') ? 'water' : 'lava', still: Use.isFluidSource(state) };
    if (waterlogged(state) || anyOf(state, ALWAYS_WATER)) return { f: 'water', still: true };
    return { f: '', still: false };
  }
  Use.fluidOf = fluidOf;
  /**
   * The SOURCE_ONLY half of vanilla's `BlockView.raycast`: walk the cells the ray crosses and
   * intersect each still fluid's OWN shape — `FluidState.getShape`, a box 0..h high where h is
   * 1 when the same fluid sits above and 8/9 (a source's `getHeight`) otherwise. Returns
   * {x,y,z,face,dist} of the nearest hit, or null. Faces in ARCH §3 numbering.
   */
  function fluidRay(ox, oy, oz, dx, dy, dz, maxDist) {
    var x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    var sx = dx > 0 ? 1 : (dx < 0 ? -1 : 0), sy = dy > 0 ? 1 : (dy < 0 ? -1 : 0), sz = dz > 0 ? 1 : (dz < 0 ? -1 : 0);
    var tdx = sx ? Math.abs(1 / dx) : Infinity, tdy = sy ? Math.abs(1 / dy) : Infinity, tdz = sz ? Math.abs(1 / dz) : Infinity;
    var tmx = sx > 0 ? (x + 1 - ox) / dx : (sx < 0 ? (x - ox) / dx : Infinity);
    var tmy = sy > 0 ? (y + 1 - oy) / dy : (sy < 0 ? (y - oy) / dy : Infinity);
    var tmz = sz > 0 ? (z + 1 - oz) / dz : (sz < 0 ? (z - oz) / dz : Infinity);
    for (var guard = (maxDist * 3 + 8) | 0; guard-- > 0;) {
      var fl = fluidOf(W.getBlock(x, y, z));
      if (fl.still) {
        var h = fluidOf(W.getBlock(x, y + 1, z)).f === fl.f ? 1 : 8 / 9;
        var box = [x, y, z, x + 1, y + h, z + 1], o = [ox, oy, oz], d = [dx, dy, dz], tIn = -Infinity, tOut = Infinity, ax = -1;
        for (var a = 0; a < 3; a++) {
          if (d[a] === 0) { if (o[a] < box[a] || o[a] > box[a + 3]) { tIn = Infinity; break; } continue; }
          var t1 = (box[a] - o[a]) / d[a], t2 = (box[a + 3] - o[a]) / d[a];
          if (t1 > t2) { var tt = t1; t1 = t2; t2 = tt; }
          if (t1 > tIn) { tIn = t1; ax = a; }
          if (t2 < tOut) tOut = t2;
        }
        if (tIn <= tOut && tOut >= 0 && tIn <= maxDist) {
          var face = ax < 0 ? 2 : ax * 2 + (d[ax] > 0 ? 1 : 0);   // entering +X side through its -X face = 1, etc.
          return { x: x, y: y, z: z, face: face, dist: Math.max(0, tIn) };
        }
      }
      var t;
      if (tmx < tmy && tmx < tmz) { x += sx; t = tmx; tmx += tdx; }
      else if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; }
      else { z += sz; t = tmz; tmz += tdz; }
      if (t > maxDist) return null;
    }
    return null;
  }
  /** `Item.raycast(world, player, sourceOnly ? SOURCE_ONLY : NONE)` — the nearer of the block hit and the fluid hit. */
  Use.bucketRaycast = function (P, sourceOnly) {
    if (!P || !P.lookVec || !NS.Ray) return null;
    var f = P.lookVec(), ox = P.ex, oy = P.ey + (P.eyeHeight || P.EYE || 1.62), oz = P.ez;
    var bh = NS.Ray.cast(ox, oy, oz, f[0], f[1], f[2], 5.0, null);
    var hit = bh ? { x: bh.x, y: bh.y, z: bh.z, face: bh.face, dist: bh.dist === undefined ? 0 : bh.dist } : null;
    if (sourceOnly) {
      var fh = fluidRay(ox, oy, oz, f[0], f[1], f[2], 5.0);
      if (fh && (!hit || fh.dist <= hit.dist)) hit = fh;
    }
    return hit;
  };
  /** `FluidDrainable.tryDrainFluid` — FluidBlock, Waterloggable, PowderSnowBlock, BubbleColumnBlock. Returns the filled item's name or ''. */
  Use.tryDrainFluid = function (x, y, z, state) {
    if (isBlock(state, 'water') || isBlock(state, 'lava')) {
      if (!Use.isFluidSource(state)) return '';
      W.setBlock(x, y, z, 0); changed(x, y, z);
      return isBlock(state, 'lava') ? 'lava_bucket' : 'water_bucket';
    }
    if (isBlock(state, 'powder_snow')) { W.setBlock(x, y, z, 0); changed(x, y, z); return 'powder_snow_bucket'; }
    if (isBlock(state, 'bubble_column')) { W.setBlock(x, y, z, 0); changed(x, y, z); return 'water_bucket'; }
    if (state > 0 && has(state, 'waterlogged')) {
      if (!waterlogged(state)) return '';
      W.setBlock(x, y, z, setProp(state, 'waterlogged', 'false')); changed(x, y, z);
      // (Waterloggable: `if (!canPlaceAt) breakBlock` — a waterlogged block that only survives wet, none in 1.18.2's survival table today)
      return 'water_bucket';
    }
    return '';
  };
  /** `ItemUsage.exchangeStack(input, player, output)` (creativeOverride true). */
  Use.exchangeStack = function (P, stack, outName, noCreativeOverride, tag) {
    var IT = NS.Items, Iv = NS.Inventory, out = IT ? IT.of(outName) : -1;
    if (!Iv || !P.inventory || !(out >= 0)) return;
    var mk = function () { var o = { i: out, n: 1 }; return tag && Iv.withTag ? Iv.withTag(o, tag) : o; };
    if (P.instabuild && !noCreativeOverride) {
      if (!(Iv.countOf(P.inventory, out) > 0)) Iv.add(P.inventory, mk());
    } else {
      if (!P.instabuild) Iv.shrink(stack, 1);   // exchangeStack(.., false): creative is not exempt, but spends nothing
      if (Iv.isEmpty(stack)) Iv.setItem(P.inventory, P.slot, mk());
      else {
        var left = Iv.add(P.inventory, mk());
        if (left > 0 && NS.EntityList && NS.EntityList.dropStack) NS.EntityList.dropStack(P.x, P.y + 1.32, P.z, out, left);
      }
    }
    if (P.syncHotbar) P.syncHotbar();
  };
  /** `Criteria.FILLED_BUCKET.trigger(serverPlayer, filledStack)` (BucketItem.use, Bucketable.tryBucket). */
  Use.filledBucketTrigger = function (P, outName) {
    if (NS.Adv && NS.Adv.trigger && P.advancements) NS.Adv.trigger(P, 'minecraft:filled_bucket', { stack: { id: 'minecraft:' + outName, count: 1 } });
  };
  function playAt(snd, x, y, z) { if (snd && NS.Sound && NS.Sound.play) NS.Sound.play(snd, { x: x + 0.5, y: y + 0.5, z: z + 0.5, source: 'block' }); }
  /**
   * `BucketItem.placeFluid(player, world, pos, hit)`. ⚠ `canBucketPlace` is vanilla's
   * `Material.isReplaceable() || !Material.isSolid()`; this engine carries only the first half at
   * runtime (`S.replaceable`, D-263), so a torch/flower still blocks the pour — named, owed.
   */
  function breakForFluid(x, y, z, st) {
    if (st === 0) return;
    var nm = NS.Reg.names[S.block[st]];
    if (nm === 'water' || nm === 'lava') return;                // a liquid cell is overwritten, no drop
    if (NS.Sound && NS.Sound.blockBreak) NS.Sound.blockBreak(st, x + 0.5, y + 0.5, z + 0.5, null);   // worldEvent 2001
    var Px = NS.Particle;
    if (Px && Px.spawnBlockDust) for (var pi = 0; pi < 8; pi++)
      Px.spawnBlockDust(x + wRand(), y + wRand(), z + wRand(), 0, 0.1, 0, st, x, y, z, wRand);
    var L = NS.Loot, EL = NS.EntityList, IT = NS.Items;
    var drops = (L && L.ready) ? L.breakDrops(st, {}) : [];     // no tool
    W.setBlock(x, y, z, 0);
    if (drops.length && EL && EL.popResource && IT) for (var di = 0; di < drops.length; di++) {
      var ii = IT.of(drops[di].item);
      if (ii >= 0) EL.popResource(x, y, z, ii, drops[di].count || 1);
    }
  }
  Use.breakForFluid = breakForFluid;
  function placeFluid(fluid, x, y, z, hit) {
    var st = W.getBlock(x, y, z);
    var canBP = st > 0 && ((S.replaceable && S.replaceable[st] === 1) || S.solidMat[S.block[st]] === 0);   // Material.isReplaceable() || !isSolid()
    var isWL = st > 0 && has(st, 'waterlogged'), fillable = isWL || anyOf(st, FILLABLE_PLANTS);
    var canFill = isWL && !waterlogged(st) && fluid === 'water';
    if (!(st === 0 || canBP || canFill)) {
      return hit ? placeFluid(fluid, hit.x + CFG.FACE_DX[hit.face], hit.y + CFG.FACE_DY[hit.face], hit.z + CFG.FACE_DZ[hit.face], null) : false;
    }
    // (vanilla: an ultrawarm dimension — the Nether — hisses the water away here; this engine has no dimension flag yet — owed)
    if (fillable && fluid === 'water') {                        // FluidFillable.tryFillWithFluid — waterlog in place
      if (canFill) { W.setBlock(x, y, z, setProp(st, 'waterlogged', 'true')); changed(x, y, z); }
      playAt('item.bucket.empty', x, y, z);
      if (NS.GameEvent) NS.GameEvent.emit('fluid_place', x, y, z, null);
      return true;
    }
    breakForFluid(x, y, z, st);                                 // BucketItem.placeFluid: breakBlock(pos, true) BEFORE setBlockState
    W.setBlock(x, y, z, S.stateOf(fluid));
    changed(x, y, z);
    playAt(fluid === 'lava' ? 'item.bucket.empty_lava' : 'item.bucket.empty', x, y, z);
    if (NS.GameEvent) NS.GameEvent.emit('fluid_place', x, y, z, null);   // BucketItem.placeFluid -> FLUID_PLACE
    return true;
  }
  Use.placeFluid = placeFluid;                                   // the dispenser's hit-free call (BE.dispenseBucket)
  /** `BucketItem.use` — every bucket's right-click. Returns true on SUCCESS; PASS/FAIL both false. */
  /**
   * `GlassBottleItem.use` (.decomp): its own SOURCE_ONLY raycast; a water source (or a waterlogged block) in reach fills
   * ONE bottle of the stack into a water potion via `ItemUsage.exchangeStack` (useonrefcheck glass_bottle_water). The
   * dragon's-breath cloud branch needs area-effect clouds, which this engine does not have.
   */
  Use.glassBottleUse = function (P, stack) {
    var IT = NS.Items;
    if (!IT || !stack || IT.nameOf(stack.i | 0) !== 'glass_bottle') return false;
    var hit = Use.bucketRaycast(P, true);
    if (!hit || P.mayBuild === false) return false;
    var st = W.getBlock(hit.x, hit.y, hit.z);
    if (!(isBlock(st, 'water') || (has(st, 'waterlogged') && prop(st, 'waterlogged') === 'true'))) return false;
    playAt('item.bottle.fill', hit.x, hit.y, hit.z);
    Use.exchangeStack(P, stack, 'potion', false, { Potion: 'minecraft:water' });
    return true;
  };
  Use.bucketUse = function (P, stack) {
    var IT = NS.Items;
    if (!IT || !stack) return false;
    var name = IT.nameOf(stack.i | 0);
    if (!(name in BUCKET_FLUID)) return false;
    var fluid = BUCKET_FLUID[name];
    var hit = Use.bucketRaycast(P, fluid === '');
    if (!hit) return false;                                            // MISS -> pass
    if (P.mayBuild === false) return false;                            // canPlaceOn: adventure without CanPlaceOn
    var x = hit.x, y = hit.y, z = hit.z, state = W.getBlock(x, y, z);
    if (fluid === '') {
      var got = Use.tryDrainFluid(x, y, z, state);
      if (!got) return false;                                          // FAIL
      playAt(got === 'lava_bucket' ? 'item.bucket.fill_lava' : got === 'powder_snow_bucket' ? 'item.bucket.fill_powder_snow' : 'item.bucket.fill', x, y, z);
      Use.exchangeStack(P, stack, got);
      Use.filledBucketTrigger(P, got);
      return true;
    }
    var fillHere = fluid === 'water' && state > 0 && (has(state, 'waterlogged') || anyOf(state, FILLABLE_PLANTS));
    var px = fillHere ? x : x + CFG.FACE_DX[hit.face], py = fillHere ? y : y + CFG.FACE_DY[hit.face], pz = fillHere ? z : z + CFG.FACE_DZ[hit.face];
    if (!placeFluid(fluid, px, py, pz, hit)) return false;
    // EntityBucketItem.onEmptied -> spawnFromItemStack(..., BUCKET, alignPosition) at the block the fluid went into
    var ent = BUCKET_ENTITY[name], EL = NS.EntityList;
    if (ent && EL && EL.canSpawn && EL.canSpawn(ent)) {
      var opts = { fromBucket: true };
      if (stack.axolotlVariant !== undefined) opts.variant = stack.axolotlVariant;
      if (stack.axolotlGrowAge !== undefined) opts.growAge = stack.axolotlGrowAge;   // copyDataFromNbt "Age"
      if (stack.puffState !== undefined) opts.puffState = stack.puffState;           // PufferfishEntity.copyDataFromNbt "PuffState"
      if (name === 'tropical_fish_bucket' && stack.t && stack.t.BucketVariantTag !== undefined) opts.variant = stack.t.BucketVariantTag | 0;   // TropicalFishEntity "BucketVariantTag"
      var rel = EL.spawn(ent, px + 0.5, py, pz + 0.5, opts);
      if (rel && opts.growAge !== undefined && NS.Breed && NS.Breed.setAge) NS.Breed.setAge(rel, opts.growAge);   // EL.spawn ignores opts.growAge
      var bk = stack.bucketData;
      if (rel && bk) {   // Bucketable.copyDataFromNbt (+ the stack's custom name)
        if (bk.CustomName) rel.customName = bk.CustomName;
        if (bk.NoAI) rel.aiDisabled = true;
        if (bk.Silent) rel.silent = true;
        if (bk.NoGravity) rel.noGravity = true;
        if (bk.Glowing) rel.glowing = true;
        if (bk.Invulnerable) rel.invulnerable = true;
        if (typeof bk.Health === 'number') rel.health = bk.Health;
      }
      if (rel && stack.axolotlHuntingCooldown > 0) rel.huntingCooldown = stack.axolotlHuntingCooldown;   // copyDataFromNbt: cooldown restored as memory TTL
    }
    Use.swapHeld(P, stack, 'bucket');                                  // getEmptiedStack: creative keeps the full bucket
    return true;
  };

  /** Replace the held stack with another item — a bucket emptying or filling. */
  Use.swapHeld = function (P, stack, toName) {
    var IT = NS.Items, Iv = NS.Inventory;
    if (!IT || !Iv || !P || !P.inventory) return false;
    if (P.instabuild) return true;             // creative neither empties nor fills
    var to = IT.of(toName);
    if (to < 0) return false;
    Iv.setItem(P.inventory, P.slot, { i: to, n: 1 });
    if (P.syncHotbar) P.syncHotbar();
    return true;
  };

  /**
   * `OnAStickItem.use` (.decomp, read in full), the `target == PigEntity`/damagePerUse == 7
   * instance (`Items.field_8184` "carrot_on_a_stick", `.decomp/net/minecraft/item/Items.java`
   * line 722-724) -- refuses unless the player has this exact vehicle as a passenger, is holding
   * this item, and `ItemSteerable.consumeOnAStickItem()` (`Passive.pigBoost`, 07w_passive.js)
   * actually rolls (refuses mid-boost, matching `SaddledComponent.boost`'s own re-entry guard).
   * On success the stack takes 7 damage; at max durability (25, `items.bin`'s own generated
   * table -- confirmed against the jar's own `maxDamage(25)` rather than assumed) it becomes a
   * plain `fishing_rod` (`Items.field_8378`) instead of vanishing -- this engine's stacks carry
   * no NBT to preserve across that swap, the one simplification `Use.swapHeld`'s own header
   * already stands on for the bucket-empty/-fill pair this reuses. Creative's own
   * `!P.instabuild` durability exemption matches `Use.damage`'s.
   */
  Use.pigBoostOnAStick = function (P, stack) {
    var IT = NS.Items, Ps = NS.Passive;
    if (!P || !P.vehicle || P.vehicle.dead || P.vehicle.type !== 'pig') return false;
    if (!Ps || !Ps.ready || !Ps.pigIsSaddled(P.vehicle)) return false;
    if (!IT || !IT.ready || !stack) return false;
    if (IT.nameOf(stack.i | 0) !== 'carrot_on_a_stick') return false;
    if (!Ps.pigCanBeControlledByRider(P.vehicle)) return false;
    if (!Ps.pigBoost(P.vehicle, pRand)) return false;
    if (!P.instabuild) {
      stack.d = (stack.d | 0) + 7;
      var max = IT.durability ? IT.durability[stack.i | 0] : 0;
      if (max && stack.d >= max) Use.swapHeld(P, stack, 'fishing_rod');
    }
    return true;
  };
  /**
   * s135 (KW-33) -- the SAME `OnAStickItem.use` shape `Use.pigBoostOnAStick` implements,
   * ported to `warped_fungus_on_a_stick` (`Items.field_23254` -- .decomp/net/minecraft/item/
   * Items.java:725-726, `maxDamage(100)`, damagePerUse `1`, NOT 25/7 -- a different
   * `OnAStickItem` construction from carrot on a stick's, read off the jar rather than
   * assumed equal). `Strider.canBeControlledByRider` in place of `Passive.
   * pigCanBeControlledByRider`; `Passive.pigBoost` is the SAME shared `SaddledComponent`
   * roll both mobs' own boost reuses (07zzj_strider.js's own header explains why).
   */
  Use.striderBoostOnAStick = function (P, stack) {
    var IT = NS.Items, St = NS.Strider;
    if (!P || !P.vehicle || P.vehicle.dead || P.vehicle.type !== 'strider') return false;
    if (!St || !St.ready || !St.isSaddled(P.vehicle)) return false;
    if (!IT || !IT.ready || !stack) return false;
    if (IT.nameOf(stack.i | 0) !== 'warped_fungus_on_a_stick') return false;
    if (!St.canBeControlledByRider(P.vehicle)) return false;
    if (!NS.Passive || !NS.Passive.pigBoost || !NS.Passive.pigBoost(P.vehicle, pRand)) return false;
    if (!P.instabuild) {
      stack.d = (stack.d | 0) + 1;
      var max = IT.durability ? IT.durability[stack.i | 0] : 0;
      if (max && stack.d >= max) Use.swapHeld(P, stack, 'fishing_rod');
    }
    return true;
  };


  // ═══════════════ the dispatch ════════════════════════════════════════════════════════════
  /**
   * One right-click. Returns 'block' | 'item' | 'place' | false — the name of what consumed it,
   * which is what `usecheck` asserts and what a future stage will want for the hand animation.
   *
   * ⚠ THE SWING IS THE CALLER'S BUSINESS, not this function's: vanilla swings the hand for a
   * SUCCESS and not for a PASS, and `Player.act` is where that belongs.
   */
  Use.rightClick = function (P, hand) {
    if (!Use.ready || !P) return false;
    if (hand === undefined) {
      // `Minecraft.startUseItem` walks MAIN_HAND then OFF_HAND; the offhand is tried only after a PASS.
      return Use.rightClick(P, 0) || Use.rightClick(P, 1);
    }
    if (NS.Gamemode && P.mode === NS.Gamemode.SPECTATOR) return false;
    if (hand !== 1) Use.lastRefusal = null;   // the offhand pass keeps the main hand's refusal
    var Iv = NS.Inventory;
    var stack = hand === 1 ? (Iv && P.inventory ? Iv.getItem(P.inventory, Iv.OFFHAND) : null) : (P.heldItem ? P.heldItem() : null);
    var empty = !stack || (Iv && Iv.isEmpty(stack));

    // QUEUE 0.2 (leashing) -- `LeashKnotEntity` is an ordinary ENTITY in vanilla's own ray
    // (`AbstractDecorationEntity`), tried in the SAME "entity under crosshair first" slot as
    // any mob below. Knots carry no `EntityList` row at all (07n_tame.js's own `Tm.pickKnot`
    // header: there is no `entity-motion` table entry for a static decoration), so they get
    // their own tiny ray test here rather than `Cb.pick`'s. It only wins the slot when it is
    // at least as near as whatever `P.targetEntity`/`P.hasTarget` already found.
    if (hand !== 1 && NS.Tame && NS.Tame.ready) {
      var f = P.lookVec ? P.lookVec() : null;
      if (f) {
        var kox = P.ex, koy = P.ey + (P.eyeHeight || P.EYE || 1.62), koz = P.ez;
        var kh = NS.Tame.pickKnot(kox, koy, koz, f[0], f[1], f[2], P.reach || 4.5);
        if (kh && (!P.targetEntity || kh.t <= P.targetEntityDist)
                && (!P.hasTarget || P.blockDist === null || P.blockDist === undefined || kh.t <= P.blockDist)) {
          if (NS.Tame.interactKnot(kh.knot, !!P.instabuild)) return 'entity';
        }
      }
    }

    // ⚠⚠ **AN ENTITY UNDER THE CROSSHAIR IS TRIED FIRST, AND UNTIL D-423 NOTHING IN THIS
    // ENGINE COULD BE RIGHT-CLICKED AT ALL.** `Minecraft.startUseItem` switches on the hit
    // result in exactly this order — ENTITY, then BLOCK, then the item in hand — and this file
    // was written for the last two only: the attack path had `P.targetEntity` wired since
    // D-338 and the use path did not, so a cow could be hit and never fed. `P.retargetEntity`
    // has already decided the entity is NEARER than the block, so there is no distance
    // comparison to redo here.
    if (P.targetEntity && Use.entityUse(P, P.targetEntity, stack)) return 'entity';

    if (P.hasTarget) {
      var state = W.getBlock(P.tx, P.ty, P.tz);
      // ⚠ `isSecondaryUseActive() && hands are not empty` — crouching with something in hand
      // skips the block's use, which is how you build against a chest instead of opening it.
      var secondary = !!P.crouching && !empty;
      P.lastHitFace = P.tface;
      // ServerPlayerInteractionManager.interactBlock: ItemStack copy taken BEFORE the use, then
      // Criteria.ITEM_USED_ON_BLOCK.trigger(player, pos, copy) once the use is accepted.
      var iubStack = P.advancements && NS.Adv && NS.Adv.trigger && !empty ? { id: 'minecraft:' + NS.Items.nameOf(stack.i | 0), count: stack.n | 0, damage: stack.d || 0, nbt: stack.t } : null;
      var iubDone = function (r) {
        if (iubStack) NS.Adv.trigger(P, 'minecraft:item_used_on_block', { player: P, x: P.tx, y: P.ty, z: P.tz, state: state, stack: iubStack });
        return r;
      };
      if (!secondary && Use.blockUse(P, P.tx, P.ty, P.tz, state, stack)) return iubDone('block');
      if (!empty) {
        if (Use.itemUseOn(P, P.tx, P.ty, P.tz, P.tface, state, stack)) return iubDone('item');
        // ...and `BlockItem.useOn` IS an item useOn: placement is the last thing tried, not the
        // first. That ordering is the entire bug this file fixes.
        if (hand !== 1 && P.placeBlock && P.placeBlock()) return iubDone('place');
      }
    }
    // loop/pigride-s98 -- `OnAStickItem.use` (.decomp): a plain `Item.use()`, tried whenever
    // neither the block nor the entity under the crosshair (nor placement) already consumed the
    // click -- the SAME fallback slot vanilla's own `useOnBlock`-defaults-to-PASS-then-`use()`
    // ordering puts it in. Named simplification: a targeted, consumable BLOCK/ENTITY always
    // wins the click first in this engine (as it does in vanilla too, just via a different
    // internal route) -- there is no separate "used-item, still also right-clicked a block"
    // double-fire to reproduce.
    // loop/bow -- `BowItem.use` (.decomp BowItem.java:104-113), the SAME fallback slot
    // `OnAStickItem.use` immediately above already sits in: a plain `Item.use()`, tried once
    // nothing targeted (block/entity) and no placement consumed the click. Starts the HOLD,
    // does not fire -- `Use.bowRelease` (below) is vanilla's own `onStoppedUsing`, driven by
    // `P.act`'s own hold-tick branch (14_player.js) rather than this click-dispatch function,
    // which only ever sees the PRESS.
    // BucketItem.use / EntityBucketItem (.decomp BucketItem.java) -- the SAME plain-`use()` slot:
    // a bucket has no useOnBlock, so it only ever acts here, through its own raycast.
    if (!empty && Use.bucketUse(P, stack)) return 'item';
    if (!empty && Use.glassBottleUse(P, stack)) return 'item';
    if (!empty && NS.Firework && NS.Items.nameOf(stack.i | 0) === 'firework_rocket' && NS.Firework.useInAir(P, stack)) return 'use';   // #5081 FireworkRocketItem.use
    if (!empty && Use.bowStart(P, stack, hand)) return 'use';
    if (!empty && Use.crossbowStart(P, stack)) return 'use';   // #6741 CrossbowItem.use
    if (!empty && Use.tridentStart(P, stack)) return 'use';   // #5614 TridentItem.use
    if (!empty && Use.bookStart(P, stack)) return 'use';   // #8066 WritableBookItem.use
    if (!empty && Use.spyglassStart(P, stack, hand)) return 'use';  // #188 SpyglassItem.use
    if (!empty && Use.shieldStart(P, stack, hand)) return 'use';
    if (!empty && Use.drinkStart(P, stack, hand)) return 'use';
    if (!empty && Use.pigBoostOnAStick(P, stack)) return 'item';
    if (!empty && Use.striderBoostOnAStick(P, stack)) return 'item';   // s135 (KW-33)
    // loop/throwables-s116 -- SnowballItem/EggItem/EnderPearlItem/SplashPotionItem/
    // LingeringPotionItem.use are all plain `Item.use()` (.decomp, every one read in full,
    // 07zzd_throw.js's own header), the SAME fallback slot the bow/pig-stick just above
    // already occupy -- tried once nothing targeted (block/entity/placement) consumed the
    // click. `Th.use` handles its own cooldown/decrement; the caller (P.act) swings the
    // hand on any non-'place' result, same as every other case here.
    if (!empty && NS.Fishing && NS.Fishing.use(P, stack)) return 'use';   // G17-F1 FishingRodItem.use
    if (!empty && NS.Throw && NS.Throw.ready && NS.Throw.useEye && NS.Throw.useEye(P, stack)) return 'use';   // #5083
    if (!empty && NS.Throw && NS.Throw.ready && NS.Throw.use(P, stack)) return 'use';
    // s119 -- `SpawnEggItem.use`: the same plain-`use()` fallback slot; spawns only in a fluid.
    if (!empty && Use.spawnEggInFluid(P, stack)) return 'use';
    if (!empty && Use.boatUse(P, stack)) return 'use';   // #5230 BoatItem.use
    if (!empty && Use.bookUse(P, stack)) return 'use';   // #8067 WrittenBookItem.use
    // MinecraftClient.doItemUse: a PASS from the main hand's use() tries Hand.OFF_HAND -- a bow
    // carried in the off hand draws (BowItem.use takes the hand).
    var offStack = (Iv && P.inventory) ? Iv.getItem(P.inventory, Iv.OFFHAND) : null;
    if (offStack && !Iv.isEmpty(offStack) && Use.bowStart(P, offStack, 1)) return 'use';
    return false;
  };

  /**
   * `Entity.interact` — what a right-click ON A MOB does. Today that is `Animal.mobInteract`
   * and nothing else, which is G18e's own scope; taming, shearing, milking, saddling, leading,
   * naming and the boat and minecart are each their own stage and each refuse here rather than
   * being half-answered (`Use.OWED`).
   *
   * ⚠ THE ITEM IS SPENT BY THE CALLBACK, NOT HERE, because `Animal.mobInteract` spends it in
   * two different branches and not in a third, and a caller that spent it up front would feed
   * an adult cow on a full stomach for free.
   */
  Use.entityUse = function (P, e, stack) {
    // ServerPlayNetworkHandler.onPlayerInteractEntity: the stack is copied BEFORE interact (it may be spent)
    var held = stack && NS.Items ? { id: 'minecraft:' + NS.Items.nameOf(stack.i | 0), count: stack.n | 0, damage: stack.d || 0, nbt: stack.t } : null;
    var r = Use.entityUseInner(P, e, stack);
    if (r && NS.Adv && NS.Adv.trigger && P.advancements) {   // Criteria.PLAYER_INTERACTED_WITH_ENTITY.trigger(player, stack, entity)
      var sub = function (st) { return st && NS.Items && !(NS.Inventory && NS.Inventory.isEmpty(st)) ? { id: 'minecraft:' + NS.Items.nameOf(st.i | 0), count: st.n | 0, damage: st.d || 0, nbt: st.t } : { id: 'minecraft:air', count: 0 }; };
      var iv = P.inventory || [], A = NS.Inventory ? NS.Inventory.ARMOR_START : 36;
      var who = { type: 'minecraft:player', x: P.x, y: P.y, z: P.z, equipment: { feet: sub(iv[A]), legs: sub(iv[A + 1]), chest: sub(iv[A + 2]), head: sub(iv[A + 3]), mainhand: held || sub(null), offhand: sub(iv[40]) } };
      NS.Adv.trigger(P, 'minecraft:player_interacted_with_entity', { stack: held || sub(null), entity: e, player: who, origin: [P.x, P.y, P.z] });
    }
    // MobEntity.interact / AnimalEntity.interactMob success: emitGameEvent(MOB_INTERACT) at the mob (sculk 8)
    if (r && e && e.maxHealth > 0 && NS.GameEvent) NS.GameEvent.emit('mob_interact', e.x, e.y, e.z, P);
    return r;
  };
  Use.entityUseInner = function (P, e, stack) {
    var Br = NS.Breed, Tm = NS.Tame, Iv = NS.Inventory, Mnt = NS.Mount;
    if (!e || e.removed) return false;
    // QUEUE 0.2 (leashing) -- `MobEntity.interact`'s own FIRST branch, javap'd: a mob held
    // by the CLICKING PLAYER unleashes on ANY right-click, whatever is in hand, before the
    // villager-trade branch below (a villager is a MobEntity too and is just as leashable).
    if (Tm && Tm.ready && Tm.holderIsPlayer(e)) {
      Tm.unleash(e, !P.instabuild);   // `!getAbilities().creativeMode`, MobEntity.interact
      return true;
    }
    // QUEUE 0.2 (leashing) -- `MobEntity.interactWithItem`'s own lead branch, which ALSO runs
    // before `interactMob`/the villager trade: a lead in hand on a leashable, unleashed mob
    // attaches it instead of opening a trade screen or feeding it.
    if (Tm && Tm.ready && stack) {
      var leadName = Tm.itemNameOf(stack);
      if (leadName === Tm.LEASH_ITEM && Tm.canLeash(e)) {
        Tm.leashToPlayer(e);
        if (Iv && Iv.shrink) Iv.shrink(stack, 1);
        return true;
      }
    }
    // s119 -- `MobEntity.interactWithItem`'s spawn-egg branch: after the lead, BEFORE
    // `interactMob` (so a villager egg on a villager makes a baby rather than opening trades).
    // PASS (false) falls through to interactMob exactly as vanilla's `isPresent() ? SUCCESS : PASS`.
    if (stack && Use.spawnEggBaby(P, e, stack)) return true;
    // D-48x — a villager is not an Animal: right-clicking one (any held item, vanilla never
    // spends it) opens its trades instead of falling into the feed/breed dispatch below.
    // WanderingTraderEntity.interactMob: alive, not baby, no customer -> opens trades
    // VillagerEntity.interactMob: dead/customer/sleeping -> no screen; baby -> sayNo; else talked_to_villager.
    if (e && e.type === 'villager') {
      if (e.removed || e.dead || e.health <= 0 || e.customer || e.vbSleeping) return false;
      if (e.isBaby || e.baby) { Use.villagerSayNo(e); return true; }
      if (NS.Stats && NS.Stats.inc) NS.Stats.inc('talked_to_villager');
      if (NS.Trade && NS.Trade.ready) {
        var vo = NS.Trade.ensure(e);
        if (!vo || !vo.length) { Use.villagerSayNo(e); return true; }
      }
    }
    if (e && (e.type === 'villager' || (e.type === 'wandering_trader' && !e.removed && !e.baby && !e.customer && !(e.health <= 0) && !(stack && NS.Items && NS.Items.ready && NS.Items.nameOf(stack.i | 0) === 'villager_spawn_egg'))) && NS.Trade && NS.Trade.ready) {
      var offers = NS.Trade.ensure(e);
      if (e.type === 'wandering_trader') {   // interactMob: TALKED_TO_VILLAGER (main hand), empty offers -> ActionResult.success
        if (NS.Stats && NS.Stats.inc) NS.Stats.inc('talked_to_villager');
        if (!(offers && offers.length)) return true;
      }
      if (offers && offers.length && NS.Hud && NS.Hud.openTrading) return NS.Hud.openTrading(e);
      return false;    // no profession / no offers yet — an empty screen is not built (Trade.OWED)
    }
    // #1043 -- `ZombieVillagerEntity.interactMob`: a golden apple with weakness starts the cure.
    if (e.type === 'zombie_villager' && NS.ZVillager && stack && !(Iv && Iv.isEmpty(stack)) && NS.Items && NS.Items.ready) {
      var zr = NS.ZVillager.interact(P, e, NS.Items.nameOf(stack.i | 0));
      if (zr && zr.consumed) {
        if (!P.instabuild && Iv && Iv.shrink) Iv.shrink(stack, 1);
        return true;
      }
      if (NS.Items.nameOf(stack.i | 0) === NS.ZVillager.CURE_ITEM) return true;   // ActionResult.CONSUME
    }
    // loop/tnt-s96 -- `CreeperEntity.interactMob`'s own flint-and-steel branch (.decomp, read
    // whole): checked BEFORE `super.interactMob`/the breed dispatch below, exactly where vanilla
    // returns early on a match. ONLY `flint_and_steel` ignites a creeper directly this way --
    // unlike `TntBlock.onUse` (`Use.isIgniter`, just above in this file), a fire charge is NOT
    // in this branch's own `if` at all, so this does not reuse that helper. `Cr.ignite`
    // (07zb_creeper.js) sets the SAME latch `Cr.tick`'s own `e.ignited` read already drives --
    // this was that module's only missing live caller (`Cr.OWED`).
    if (e.type === 'creeper' && NS.Creeper && NS.Creeper.ready && stack &&
        !(Iv && Iv.isEmpty(stack)) && NS.Items && NS.Items.ready &&
        NS.Items.nameOf(stack.i | 0) === 'flint_and_steel') {
      // CreeperEntity.interactMob: ITEM_FLINTANDSTEEL_USE at the creeper, getSoundCategory() = HOSTILE.
      if (NS.Sound && NS.Sound.play) NS.Sound.play('item.flintandsteel.use', {
        x: e.x, y: e.y, z: e.z, source: 'hostile', volume: 1, pitch: pRand() * 0.4 + 0.8 });
      NS.Creeper.ignite(e);
      Use.damage(P, stack, 1);
      return true;
    }
    // #719 -- `DolphinEntity.interactMob`: an ItemTags.FISHES stack sets GotFish and shrinks by one.
    if (e.type === 'dolphin' && NS.Dolphin && NS.Dolphin.interact && stack &&
        !(Iv && Iv.isEmpty(stack)) && NS.Items && NS.Items.ready) {
      if (NS.Dolphin.interact(e, NS.Items.nameOf(stack.i | 0), !!P.instabuild)) {
        if (!P.instabuild && Iv && Iv.shrink) Iv.shrink(stack, 1);
        return true;
      }
    }
    // s135 (KW-32 follow-up) -- `PiglinBrain.playerInteract`: a gold ingot handed directly to an
    // adult, non-admiring piglin is swapped to its offhand and admired, consuming ONE ingot the
    // same way the creeper branch just above consumes its flint and steel.
    if (e.type === 'piglin' && NS.Piglin && NS.Piglin.ready && stack &&
        !(Iv && Iv.isEmpty(stack)) && NS.Items && NS.Items.ready) {
      if (NS.Piglin.playerInteract(e, NS.Items.nameOf(stack.i | 0))) {
        if (Iv && Iv.shrink) Iv.shrink(stack, 1);
        return true;
      }
    }
    if (!Br || !Br.ready || !e || e.removed) return false;
    var empty = !stack || (Iv && Iv.isEmpty(stack));
    var itemName = Br.itemNameOf(stack);
    // loop/pigride-s98 -- `PigEntity.interactMob` (.decomp, read in full): saddled + no rider
    // yet + not sneaking + NOT holding this pig's own breeding food mounts UNCONDITIONALLY,
    // whatever else is (or is not) in hand -- checked here, ahead of the `Mnt`/breed/saddle
    // dispatch below, exactly where vanilla's own override sits ahead of `super.interactMob`'s
    // fallthrough. `shouldCancelInteraction()` is `PlayerEntity.isSneaking()` verbatim, this
    // engine's own `P.crouching`. `Passive.pigMount` is the state change alone (07w_passive.js,
    // this session's own file) -- it sets the SAME `e.rider` field `P.mountVehicle` below and
    // every `Mnt.*` read already understand, so nothing else in this dispatch needs to change.
    if (e.type === 'pig' && !P.crouching && NS.Passive && NS.Passive.ready) {
      var pigBreedFood = !empty && Br.isFood('pig', itemName);
      if (!pigBreedFood && NS.Passive.pigMount(e)) {
        if (P.mountVehicle) P.mountVehicle(e);
        return true;
      }
    }
    // s135 (KW-33) -- `StriderEntity.interactMob` (.decomp, read in full): the SAME shape
    // pig's own mount block above draws -- not-breeding-food + saddled + no passenger yet +
    // not crouching mounts UNCONDITIONALLY, checked ahead of the generic `Mnt`/breed/saddle
    // dispatch below. `Strider.mount` (07zzj_strider.js) is the state change alone.
    if (e.type === 'strider' && !P.crouching && NS.Strider && NS.Strider.ready) {
      var striderBreedFood = !empty && Br.isFood('strider', itemName);
      if (!striderBreedFood && NS.Strider.mount(e)) {
        if (P.mountVehicle) P.mountVehicle(e);
        return true;
      }
    }
    // QUEUE 0.2 (G18e remainder) — `HorseEntity.interactMob` is its OWN dispatch, not
    // `Animal.mobInteract`: it owns taming (via mounting, not feed-and-roll), riding, saddling
    // and armour, and it must run BEFORE `Br.interact`'s generic love-mode path — a horse's own
    // breeding food (wheat) is NOT an instant-love item the way it is for a cow (`Breed.SPECIAL.
    // horse`'s own header), so falling through to `Br.interact` for a mountable type would
    // silently mis-breed it. `Mnt.interact` is the WHOLE of what a right-click on this type
    // does; nothing below this block runs for it, matched or not.
    if (e.type === 'armor_stand' && NS.ArmorStand && P.targetEntity === e) {   // #4391 interactAt: click height off the pick ray
      var asf = P.lookVec();
      return NS.ArmorStand.interact(e, P, stack, P.ey + (P.eyeHeight || P.EYE) + asf[1] * P.targetEntityDist - e.y);
    }
    if (e.type === 'boat' && NS.Boat) return NS.Boat.interact(e, P);   // BoatEntity.interact (#308)
    if (e.type === 'minecart' && NS.Minecart && NS.Minecart.interact) return NS.Minecart.interact(e, P);   // MinecartEntity.interact (#4829)
    if (e.type === 'chest_minecart' && NS.Minecart && NS.Minecart.storageInteract) return NS.Minecart.storageInteract(e, P);
    if (e.type === 'furnace_minecart' && NS.Minecart && NS.Minecart.furnaceInteract) {   // FurnaceMinecartEntity.interact (#4837)
      if (NS.Minecart.furnaceInteract(e, P.x, P.z, itemName) && !P.instabuild && Iv && Iv.shrink) Iv.shrink(stack, 1);
      return true;
    }
    if (e.type === 'command_block_minecart' && NS.Hud && NS.Hud.openCommandBlock) return NS.Hud.openCommandBlock({ cart: e });   // CommandBlockMinecartEntity.interact (#4433)
    if (Mnt && Mnt.ready && Mnt.isMountable(e)) {
      var mres =Mnt.interact(e, empty ? '' : itemName, { crouching: !!P.crouching, player: P });
      if (mres) {
        if (mres.consumed && !P.instabuild && Iv && Iv.shrink) Iv.shrink(stack, 1);
        // QUEUE 0.2 (G18e remainder) — the one line that actually seats the live player: everything
        // else about riding (camera follow, input, dismount, the jump bar) is 14_player.js's own,
        // owned file, reached only through this single call (Use.entityUse is not this unit's file).
        if (mres.mounted && P.mountVehicle) P.mountVehicle(e);
        // QUEUE 0.2 (G18e remainder) -- the one line that opens the real horse screen:
        // `Mnt.interact`'s own `opened: true` (sneak-use tame, or horse-armour-in-hand tame)
        // was named but unwired until now -- `H.openHorse` is 15_hud.js's own file (owned by
        // this unit), reached only through this single call, matching `mres.mounted`'s pattern.
        if (mres.opened && NS.Hud && NS.Hud.openHorse) NS.Hud.openHorse(e);
        return true;
      }
      return false;
    }
    // D-458 — an EMPTY hand on an already-tamed wolf/cat toggles sitting. Checked before the
    // food path (which refuses on an empty hand anyway) so a bare-handed click never falls
    // through to breeding's own refusal.
    if (empty) {
      if (Tm && Tm.ready && Tm.toggleSit(e)) return true;
      // QUEUE 0.2 "G18e remainder" -- a parrot's own empty-hand toggle (grounded only --
      // `Fl.toggleSit` refuses in the air, `ParrotEntity.isInAir()`'s own gate; `Tm.TAMABLE`
      // never lists parrot at all, see 07n_tame.js's own header).
      if (NS.Fly && NS.Fly.ready && NS.Fly.toggleSit(e)) return true;
      return false;
    }
    // D-458 — the tame roll runs BEFORE breeding: an untamed wolf/cat fed its tame food is
    // being tamed, not bred (vanilla's own `mobInteract` checks `isTame()` first) — and once
    // tamed, `Tm.feed` refuses (already tamed), so a later feed of the same item falls through
    // to `Br.interact`'s own love-mode path unchanged.
    // QUEUE 0.2 (G18c item 2) — `SheepEntity.interactMob`'s own FIRST check (.decomp, read in
    // full): a shears in hand shears an unsheared, non-baby sheep BEFORE any of `AnimalEntity`'s
    // own feed/breed dispatch runs (`super.interactMob` is only reached in the ELSE branch).
    // `DyeItem.useOnEntity` (.decomp/net/minecraft/item/DyeItem.java) is Item-side, and vanilla's
    // own dispatch tries it BEFORE `Entity.interact`/`interactMob` runs at all
    // (`PlayerEntity.interact`'s own item-then-entity order) — mirrored here in the same slot
    // this file already uses for the wolf/cat collar dye immediately below (`Tm.dyeCollar`,
    // D-492), the one place a held item recolours an entity ahead of feed/breed. `Passive.shear`/
    // `Passive.dyeSheep` (07w_passive.js) are the real colour/drop math; the durability spend
    // (`Use.damage`, `ItemStack.damage(1, ...)`) and the stack-shrink are this file's own, the
    // same split `Tm.dyeCollar`'s own consume flag already draws two branches down.
    if (!empty && e.type === 'sheep' && NS.Passive && NS.Passive.ready) {
      if (itemName === 'shears') {
        var sh = NS.Passive.shear(e, pRand);
        if (sh) {
          // SheepEntity.sheared: ENTITY_SHEEP_SHEAR 1.0/1.0, then N count-1 items each with a velocity add
          if (NS.Sound && NS.Sound.entitySound) NS.Sound.entitySound('entity.sheep.shear', e.x, e.y, e.z, 1, 1, 'player', NS.Player);
          if (NS.EntityList && NS.EntityList.dropStack) {
            for (var si = 0; si < sh.count; si++) {
              var wi = NS.EntityList.dropStack(e.x, e.y + 1, e.z, sh.item, 1);
              if (wi) {
                wi.vx += (pRand() - pRand()) * 0.1;   // Vec3d.add(x, y, z) argument order: x, y, z
                wi.vy += pRand() * 0.05;
                wi.vz += (pRand() - pRand()) * 0.1;
              }
            }
          }
          Use.damage(P, stack, 1);
        }
        return true;   // SheepEntity.interactMob: shears in hand => CONSUME even when not shearable
      } else if (itemName && itemName.length > 4 && itemName.slice(-4) === '_dye') {
        var dyed = NS.Passive.dyeSheep(e, itemName.slice(0, itemName.length - 4));
        if (dyed) {
          if (NS.Sound && NS.Sound.entitySound) NS.Sound.entitySound('item.dye.use', e.x, e.y, e.z, 1, 1, 'player', NS.Player);
          if (!P.instabuild && Iv && Iv.shrink) Iv.shrink(stack, 1);
          return true;
        }
      }
    }
    // loop/fleece-s97 (QUEUE 0.2 G18c, pig saddle) — `SaddleItem.useOnEntity` (.decomp, read
    // whole): unlike the sheep branch above (an ITEM-side override ahead of `interactMob`),
    // vanilla's own pig dispatch tries this ONLY inside `super.interactMob`'s fallback
    // (`PigEntity.interactMob`, .decomp lines 138-156: breeding food and the already-saddled
    // mount branch are both checked FIRST and neither applies to a saddle item in hand, so this
    // slot — after the sheep-only branch, same as the wolf/cat collar dye below it — is where
    // vanilla itself would actually reach `SaddleItem`). `Passive.pigSaddle` is the equip fact;
    // the stack-consume half (creative's own exemption) is this file's own, the same split
    // `Passive.shear`'s durability spend already draws above.
    if (!empty && e.type === 'pig' && itemName === 'saddle' && NS.Passive && NS.Passive.ready) {
      if (NS.Passive.pigSaddle(e)) {
        if (!P.instabuild && Iv && Iv.shrink) Iv.shrink(stack, 1);
        return true;
      }
    }
    // s135 (KW-33) -- `SaddleItem.useOnEntity` off a strider (.decomp, read whole): same
    // shape the pig block above already draws, `Strider.canBeSaddled`/`Strider.saddle`
    // (07zzj_strider.js) in place of `Passive.pig*`.
    if (!empty && e.type === 'strider' && itemName === 'saddle' && NS.Strider && NS.Strider.ready) {
      if (NS.Strider.saddle(e)) {
        if (!P.instabuild && Iv && Iv.shrink) Iv.shrink(stack, 1);
        return true;
      }
    }
    // #735 -- `IronGolemEntity.interactMob`: an iron_ingot heals 25; unchanged health PASSes (no
    // sound, no consume); else golem.repair at pitch 1 + (r-r)*0.2, stack -1 unless creative.
    if (!empty && e.type === 'iron_golem' && itemName === 'iron_ingot' && !e.dead && e.maxHealth) {
      var hp0 = e.health;
      e.health = Math.min(e.maxHealth, e.health + 25);
      if (e.health === hp0) return false;
      if (NS.Sound && NS.Sound.play) {
        NS.Sound.play('entity.iron_golem.repair', { x: e.x, y: e.y, z: e.z, source: 'neutral',
                                                    volume: 1, pitch: 1 + (pRand() - pRand()) * 0.2 });
      }
      if (!P.instabuild && Iv && Iv.shrink) Iv.shrink(stack, 1);
      return true;
    }
    // loop/snowgolem -- `SnowGolemEntity.interactMob` (.decomp, read whole): a shears in hand
    // on a golem still carrying/wearing its pumpkin (`isShearable()`) drops the SAME
    // `carved_pumpkin` a sheep-shear drops wool, before any other dispatch -- the same slot
    // (after the sheep/pig-only blocks, ahead of the wolf/cat dye) this file's own idiom
    // already establishes for a held item recolouring/altering an entity ahead of feed/breed.
    if (!empty && e.type === 'snow_golem' && itemName === 'shears' && NS.SnowGolem && NS.SnowGolem.ready) {
      var sg = NS.SnowGolem.shearAt(e);
      if (sg) {
        Use.damage(P, stack, 1);
        return true;
      }
    }
    // #1698 -- `WolfEntity.interactMob`: a tamed, hurt wolf fed meat heals by the food's hunger,
    // before the dye branch and before `super.interactMob` (no love mode while hurt).
    if (!empty && Tm && Tm.ready && Tm.healWolf) {
      var wh = Tm.healWolf(e, itemName, { isOwner: e.owner === 'player' });
      if (wh) {
        if (e.type === 'cat' && NS.MobVoice) NS.MobVoice.emit(e, 'entity.cat.eat', 1.0, 1.0);   // CatEntity.eat
        if (!P.instabuild && Iv && Iv.shrink) Iv.shrink(stack, 1);
        return true;
      }
    }
    // D-492 — a dye on a tamed wolf/cat recolours its collar (`interactMob`'s DyeItem branch),
    // ahead of the feed/breed paths the same way vanilla's own tamed branch tests it first.
    if (Tm && Tm.ready && Tm.dyeCollar) {
      var dy = Tm.dyeCollar(e, itemName, { isOwner: e.owner === 'player' });
      if (dy) {
        if (dy.consumed && !P.instabuild && Iv && Iv.shrink) Iv.shrink(stack, 1);
        return true;
      }
    }
    if (Tm && Tm.ready && Tm.feedOcelot) {
      var ot = Tm.feedOcelot(e, itemName, { random: pRand,
        distSq: (e.x - P.x) * (e.x - P.x) + (e.y - P.y) * (e.y - P.y) + (e.z - P.z) * (e.z - P.z) });
      if (ot) {
        if (!P.instabuild && Iv && Iv.shrink) Iv.shrink(stack, 1);
        return true;
      }
    }
    if (Tm && Tm.ready) {
      var t = Tm.feed(e, itemName, { player: P, random: pRand });
      if (t) {
        if (e.type === 'cat' && NS.MobVoice) NS.MobVoice.emit(e, 'entity.cat.eat', 1.0, 1.0);   // CatEntity.eat
        if (t.consumed && !P.instabuild && Iv && Iv.shrink) Iv.shrink(stack, 1);
        return true;
      }
    }
    // QUEUE 0.2 "G18e remainder" -- parrot taming (07t_fly.js). A cookie kills EITHER a tamed
    // or an untamed parrot (`ParrotEntity.interactMob`'s own cookie branch never checks
    // `isTamed()`), checked first so a cookie never falls through to Br.interact's own refusal.
    if (NS.Fly && NS.Fly.ready) {
      var fc = NS.Fly.feedCookie(e, itemName, { player: P });
      if (fc) {
        if (fc.consumed && !P.instabuild && Iv && Iv.shrink) Iv.shrink(stack, 1);
        return true;
      }
      var ft = NS.Fly.feed(e, itemName, { random: pRand });
      if (ft) {
        if (ft.consumed && !P.instabuild && Iv && Iv.shrink) Iv.shrink(stack, 1);
        return true;
      }
    }
    // loop/goat-s99 (QUEUE 0.2 G18c) -- `GoatEntity.interactMob` (.decomp, read in full):
    // a bucket on a non-baby goat milks it (`ItemUsage.exchangeStack` -- `Use.swapHeld`'s own
    // bucket<->water_bucket exchange, this file's own precedent, just above), checked BEFORE
    // `super.interactMob`'s (`Br.interact`'s) own feed/breed dispatch, exactly where vanilla's
    // own override sits.
    // s101 -- CowEntity.interactMob (bucket -> milk, cow AND mooshroom) and MooshroomEntity.
    // interactMob (bowl -> stew, shears -> cow + 5 mushrooms, brown + small flower -> stored
    // stew effect), both checked BEFORE super.interactMob's feed/breed, where vanilla's sit.
    if (!empty && (e.type === 'cow' || e.type === 'mooshroom') && NS.Mooshroom) {
      var mo = NS.Mooshroom.interact(e, itemName, {});
      if (mo) {
        if (mo.swapTo) {
          // CowEntity/MooshroomEntity.interactMob: ItemUsage.exchangeStack -- ONE bowl/bucket of a stack is spent and
          // the stew/milk goes to the inventory (interactrefcheck mooshroom_bowl_stack8/cow_bucket_stack16).
          Use.exchangeStack(P, stack, mo.swapTo, itemName === 'bowl', mo.tag);
          return true;
        }
        if (mo.replaceWith) { NS.Mooshroom.applyShear(e, mo); Use.damage(P, stack, mo.damage); return true; }
        if (mo.consume) { if (!P.instabuild && Iv && Iv.shrink) Iv.shrink(stack, mo.consume); return true; }
        if (mo.particlesOnly) return true;
      }
    }
    if (!empty && e.type === 'goat' && !e.isBaby && itemName === 'bucket') {
      // GoatEntity.interactMob: the milking sound on the player (1.0, 1.0), then exchangeStack, as the cow
      if (NS.Sound && NS.Sound.play) NS.Sound.play('entity.goat.' + (e.screaming ? 'screaming.' : '') + 'milk', { x: P.x, y: P.y, z: P.z, volume: 1, pitch: 1, source: 'player' });
      Use.exchangeStack(P, stack, 'milk_bucket'); return true;
    }
    // `Bucketable.tryBucket` (.decomp Bucketable.java): a WATER bucket on a bucketable mob (axolotl, cod, salmon,
    // pufferfish, tropical fish) -- `ItemUsage.exchangeStack(stack, player, bucketItem, false)` (creative too) and the
    // entity discarded. ⚠ It used to take an EMPTY bucket for the axolotl and nothing at all for fish (interactrefcheck).
    // The VARIANT is the one piece of NBT this engine's bucket can carry (stamped onto the fresh stack directly).
    var bucketOf = e.type === 'axolotl' ? 'axolotl_bucket' : (NS.Fish && NS.Fish.bucketItemFor ? NS.Fish.bucketItemFor(e.type) : null);
    if (!empty && bucketOf && itemName === 'water_bucket' && !e.removed && !(e.health <= 0)) {
      // Bucketable.tryBucket: playSound(getBucketedSound(), 1, 1) before the exchange (fish: fill_fish, axolotl: fill_axolotl)
      if (NS.Sound && NS.Sound.play) NS.Sound.play(e.type === 'axolotl' ? 'item.bucket.fill_axolotl' : 'item.bucket.fill_fish', { x: P.x, y: P.y, z: P.z, volume: 1, pitch: 1, source: 'player' });
      Use.exchangeStack(P, stack, bucketOf, true);
      Use.filledBucketTrigger(P, bucketOf);
      var slotStack = P.inventory && P.inventory.slots && P.inventory.slots[P.slot];
      if (slotStack && e.type === 'axolotl') { slotStack.axolotlVariant = e.axolotlVariant | 0; slotStack.axolotlGrowAge = e.growAge | 0; if (e.huntingCooldown > 0) slotStack.axolotlHuntingCooldown = e.huntingCooldown | 0; else delete slotStack.axolotlHuntingCooldown; }   // copyDataToStack "HuntingCooldown"
      if (slotStack && e.type === 'pufferfish') slotStack.puffState = e.puffState | 0;   // copyDataToStack "PuffState"
      if (slotStack && e.type === 'tropical_fish') (slotStack.t || (slotStack.t = {})).BucketVariantTag = e.fishVariant | 0;   // copyDataToStack putInt
      if (slotStack) {   // Bucketable.copyDataToStack: CustomName, NoAI, Silent, NoGravity, Glowing, Invulnerable, Health
        var bd = slotStack.bucketData = { Health: e.health };
        if (e.customName) bd.CustomName = e.customName;
        if (e.aiDisabled) bd.NoAI = true;
        if (e.silent) bd.Silent = true;
        if (e.noGravity) bd.NoGravity = true;
        if (e.glowing) bd.Glowing = true;
        if (e.invulnerable) bd.Invulnerable = true;
      }
      var EL2 = NS.EntityList;
      if (EL2 && EL2.remove) EL2.remove(e);
      return true;
    }
    if (e.type === 'panda' && NS.Panda && NS.Panda.ready) {
      // PandaEntity.interactMob (thunder PASS, lyingOnBack wake, bamboo branches) replaces Br.interact
      if (NS.Panda.interact(e, itemName, {
        player: P, instabuild: !!P.instabuild,
        consume: function (n) { if (Iv && Iv.shrink) Iv.shrink(stack, n); }
      })) return true;
    }
    var r = (e.type === 'panda' && NS.Panda && NS.Panda.ready) ? false : Br.interact(e, itemName, {   // panda PASS never reaches generic breeding
      player: P,
      instabuild: !!P.instabuild,       // D-433: the ABILITY's own name, all the way through
      consume: function (n) { if (Iv && Iv.shrink) Iv.shrink(stack, n); },
      // AxolotlEntity.eat: a tropical_fish_bucket is replaced in hand by a water_bucket (whole stack, creative too)
      eat: e.type === 'axolotl' && itemName === 'tropical_fish_bucket' ? function () {
        if (Iv && Iv.setItem && P.inventory && NS.Items) { Iv.setItem(P.inventory, P.slot, { i: NS.Items.of('water_bucket'), n: 1 }); if (P.syncHotbar) P.syncHotbar(); }
      } : null
    });
    if (r && e.type === 'strider' && NS.Strider && NS.Strider.playEat) NS.Strider.playEat(e);   // #935
    if (r && e.type === 'cat' && (itemName === 'cod' || itemName === 'salmon') && NS.MobVoice) NS.MobVoice.emit(e, 'entity.cat.eat', 1.0, 1.0);   // CatEntity.eat: breeding item -> cat.eat
    // WolfEntity/CatEntity.interactMob tamed branch: `(!super.interactMob.isAccepted() || isBaby()) && isOwner` toggles
    // sitting -- any non-dye item (stick, block, non-food) and a fed baby also sit/stand the pet.
    if ((!r || Br.isBaby(e)) && Tm && Tm.ready && itemName.slice(-4) !== '_dye' && Tm.toggleSit(e)) return true;   // a DyeItem never reaches the toggle (same colour -> super only)
    // ParrotEntity.interactMob last branch: a grounded tamed parrot's owner toggles sitting with ANY held item
    // (cookie/taming food were handled above) -- the item is not consumed.
    if (!r && e.type === 'parrot' && NS.Fly && NS.Fly.ready && NS.Fly.toggleSit(e)) return true;
    if (r) {
      // GoatEntity.interactMob: a accepted breeding item (wheat) -> getEatSound, NEUTRAL, 1.0, nextBetween(.8, 1.2)
      if (e.type === 'goat' && itemName === 'wheat' && NS.Goat) NS.Goat.sound(e, 'eat', 1, 0.8 + pRand() * 0.4);
      return true;
    }
    // loop/nametag -- `NameTagItem.useOnEntity` (.decomp/net/minecraft/item/NameTagItem
    // .java:15-28) is an ITEM-side fallback, tried only once the entity's own `interact()`
    // dispatch (leash, trade, feed/breed -- every branch above, ending with `Br.interact` just
    // above) has PASSed -- `PlayerEntity.interact`'s own two-stage order (.decomp
    // /net/minecraft/entity/player/PlayerEntity.java:975-993: `entity.interact()` first,
    // `stack.useOnEntity()` only `if ($$4` -- the first result -- `.isAccepted()` is false).
    // `$$0.hasCustomName() && !($$2 instanceof PlayerEntity)` -- a stack with no custom name
    // NBT tag PASSes exactly like vanilla, and `e` here is never a player (`Use.entityUse` is
    // never called on one from this file's own caller, 14l_use.js:700) so that half of the
    // guard is always satisfied. The tag itself is this engine's own generic stack-NBT
    // mechanism (`Iv.tagOf`, 14f_inventory.js:91) under the SAME `display.*` shape dyed
    // leather's `display.color` already uses (02h_recipes.js:568-569) -- `display.Name` is
    // vanilla's own path (`ItemStack.hasCustomName`/`getName`, unread elsewhere in src/ before
    // this branch: there is still no UI that WRITES one, named precisely in `Use.OWED` above).
    if (itemName === 'name_tag') {
      var ntTag = Iv && Iv.tagOf ? Iv.tagOf(stack) : null;
      var ntName = (ntTag && ntTag.display && typeof ntTag.display.Name === 'string')
        ? ntTag.display.Name : null;
      if (!ntName) return false;                 // ActionResult.PASS — no custom name on the stack
      e.customName = ntName;
      // `MobEntity.setPersistent()` (.decomp NameTagItem.java:20, MobEntity.java) -- every
      // mob `Use.entityUse` is ever called on IS a `MobEntity` in this engine (no armor stand,
      // the one non-MobEntity LivingEntity vanilla ships), so the `instanceof MobEntity` guard
      // is unconditionally true here and is not re-checked.
      e.persistent = true;
      // `VindicatorEntity.setCustomName()`'s own override (.decomp/net/minecraft/entity/mob/
      // VindicatorEntity.java:151-155): naming a vindicator exactly "Johnny" latches `johnny`
      // (never re-cleared, same `!this.johnny &&` one-shot guard) -- `Ai.VindicatorTargetGoal`
      // (07k_goals.js:1348-1356) already reads `e.johnny` and was REAL but VACUOUS because
      // nothing ever set it; this is that setter, at the one call site vanilla itself hangs it
      // off (`setCustomName`, not a species-generic branch -- a "Johnny" cow stays a plain cow).
      if (e.type === 'vindicator' && ntName === 'Johnny') e.johnny = true;
      if (!P.instabuild && Iv && Iv.shrink) Iv.shrink(stack, 1);
      return true;
    }
    return false;
  };


  // ══════════════════════ loop/bow: THE PLAYER'S OWN BOW ═══════════════════════════════════
  // `BowItem` (.decomp/net/minecraft/item/BowItem.java, read in full) plus the ammo search it
  // calls out to, `PlayerEntity.getArrowType`/`RangedWeaponItem.getHeldProjectile`
  // (.decomp/net/minecraft/entity/player/PlayerEntity.java:1977-1996,
  // .decomp/net/minecraft/item/RangedWeaponItem.java, both read in full). Closes `Po.OWED`'s
  // and `Trade.OWED`'s own closing lines and the "never fired" half of `tippedcheck.mjs`'s own
  // scope note: a tipped or spectral arrow item now reaches a LIVE, IN-FLIGHT arrow entity
  // through the exact same `EntityList.spawn('arrow'/'spectral_arrow', ...)`/`Cb.tickArrow`
  // path a skeleton's own shot already uses (`Cb.mobShoot`, 14j_combat.js).
  //
  // ⚠ WHAT IS NOT MODELLED, NAMED RATHER THAN SILENT. `ProjectileEntity.setVelocity(shooter,
  // pitch, yaw, roll, speed, divergence)` (BowItem's own call, `.setVelocity($$4, pitch, yaw,
  // 0.0F, pull*3.0F, 1.0F)`) has NO `.decomp` source this worktree carries at all -- `boz.java`
  // (`ProjectileEntity`) was never emitted, the same missing-class gap `Cb.mobShootTrident`'s
  // own header already names for `TridentEntity`. Rather than re-derive the degrees-based
  // pitch/yaw trig from memory (rule 3), this reuses `P.lookVec()` -- this engine's OWN forward
  // vector, already the ground truth every other aim path in this file trusts (`P.retarget`,
  // the knot pick just above) -- as the pre-normalize direction, then applies the SAME
  // gaussian-divergence spread `Cb.mobShoot` already does off the one formula that IS
  // `.decomp`-cited (`Cb.ARROW_GAUSS_SCALE`, 14j_combat.js's own header, ProjectileEntity.java
  // :114-123 per that file's own citation). `divergence` is the bow's own literal `1.0F`.
  // ⚠ A DRAW ONLY EVER STARTS FROM THE MAIN HAND (`P.slot`), not the off hand -- this engine's
  // whole right-click dispatch (`Use.rightClick` above) only ever reads `P.heldItem()`, and
  // widening every caller to try both hands is `Use.OWED`'s own kind of gap, named here rather
  // than half-built. The AMMO search (`Use.getArrowSlot` below) still checks the off hand
  // FIRST, exactly as `RangedWeaponItem.getHeldProjectile` does -- only WHICH HAND HOLDS THE
  // BOW is narrowed, not where the arrow itself may live.
  Use.BOW_MAX_USE_TICKS = 72000;   // BowItem.getMaxUseTime (.decomp :98-100)
  Use.BOW_SPEED = 3.0;             // BowItem.use's own `pullProgress * 3.0F`
  Use.BOW_DIVERGENCE = 1.0;        // BowItem.use's own literal `1.0F`

  /** `BowItem.getPullProgress` (.decomp :91-98) -- exact, static, no entity needed. */
  Use.bowPullProgress = function (useTicks) {
    // BowItem.getPullProgress is FLOAT arithmetic end to end: `(float)i / 20.0F`, then
    // `(f*f + f*2.0F) / 3.0F`; every intermediate is rounded to float (lockstep-exact velocity).
    var fr = Math.fround;
    var t = fr((useTicks | 0) / 20);
    t = fr(fr(fr(t * t) + fr(t * 2)) / 3);
    if (t > 1) t = 1;
    return t;
  };

  /**
   * `PlayerEntity.getArrowType`'s own ammo search, SLOT form (the stack alone cannot be
   * written back to when it is spent) -- off hand first (`RangedWeaponItem.getHeldProjectile`'s
   * own `Hand.field_5810` == OFF_HAND, tried before `field_5808` == MAIN_HAND, names.tsv-
   * verified: field_5808 is Hand's first declared constant, field_5810 its second), then the
   * whole 41-slot inventory in index order (`PlayerInventory.size()`/`getStack`, main+armor+
   * off again -- harmless, armour never matches and the off hand is simply re-found). Vanilla's
   * own predicate is a TAG (`ItemTags.field_18317`, "arrows") this engine has no item-tag table
   * for (`02f_tags.js` only resolves BLOCK tags) -- the three members are named directly
   * instead, which is exactly what the tag itself always was for 1.18.2's own three arrow
   * items.
   */
  Use.isArrowItem = function (stack) {
    var Iv = NS.Inventory, IT = NS.Items;
    if (!stack || (Iv && Iv.isEmpty(stack)) || !IT) return false;
    var n = IT.nameOf(stack.i | 0);
    return n === 'arrow' || n === 'tipped_arrow' || n === 'spectral_arrow';
  };
  Use.getArrowSlot = function (P) {
    var Iv = NS.Inventory;
    if (!P || !P.inventory || !Iv) return -1;
    var off = Iv.getItem(P.inventory, Iv.OFFHAND);
    if (Use.isArrowItem(off)) return Iv.OFFHAND;
    var main = P.heldItem ? P.heldItem() : null;
    if (Use.isArrowItem(main)) return P.slot;
    for (var i = 0; i < Iv.SIZE; i++) {
      if (Use.isArrowItem(Iv.getItem(P.inventory, i))) return i;
    }
    return -1;
  };
  /** The resolved ammo STACK, or a virtual 1-count plain arrow in creative when none is
   *  carried (`PlayerEntity.getArrowType`'s own closing ternary), or null in survival. */
  Use.getArrowType = function (P) {
    var Iv = NS.Inventory;
    var slot = Use.getArrowSlot(P);
    if (slot >= 0) return Iv.getItem(P.inventory, slot);
    return (P.instabuild && Iv) ? Iv.stack('arrow', 1) : null;
  };

  // ── the generic use-item hold (G19d-a, #176) ───────────────────────────────────────────────
  // `LivingEntity`'s active-item machine: `Item.getMaxUseTime`/`getUseAction`/`finishUsing`/
  // `onStoppedUsing` (.decomp Item.java:146,247-260 and the per-item overrides). The bow's own
  // hold is one row of it now. `P.useTicks` counts UP as whole ticks; vanilla's countdown is
  // `getMaxUseTime - useTicks` and the item FINISHES when that reaches 0. Letting go early calls
  // `onStoppedUsing` only -- never `finishUsing`.
  /** `UseAction` in .decomp declaration order (field_8952 .. field_27079). */
  Use.UseAction = { NONE: 0, EAT: 1, DRINK: 2, BLOCK: 3, BOW: 4, SPEAR: 5, CROSSBOW: 6, SPYGLASS: 7 };
  // The per-item overrides (.decomp PotionItem/HoneyBottleItem/MilkBucketItem/ShieldItem/BowItem/
  // TridentItem/CrossbowItem/SpyglassItem); [maxUseTime, action]. Anything not listed falls to
  // `Item`'s own rule: food is EAT for 32 ticks (16 for a snack), everything else NONE for 0.
  var HOLD = {
    potion: [32, 2], honey_bottle: [40, 2], milk_bucket: [32, 2],
    shield: [72000, 3], bow: [72000, 4], trident: [72000, 5], spyglass: [1200, 7]
  };
  function holdName(stack) {
    var IT = NS.Items, Iv = NS.Inventory;
    if (!stack || !IT || (Iv && Iv.isEmpty(stack))) return null;
    return IT.nameOf(stack.i | 0);
  }
  function isFoodStack(stack) {
    var IT = NS.Items;
    return !!(IT && IT.flags && (IT.flags[stack.i | 0] & 4));
  }
  /** `ItemStack.getMaxUseTime` -> `Item.getMaxUseTime(stack)`. */
  Use.getMaxUseTime = function (stack) {
    var n = holdName(stack);
    if (n === null) return 0;
    if (n === 'crossbow') {
      var q = NS.Combat ? NS.Combat.enchantLevel(stack, 'quick_charge') : 0;
      return (q === 0 ? 25 : 25 - 5 * q) + 3;     // CrossbowItem.getPullTime + 3
    }
    if (HOLD[n]) return HOLD[n][0];
    if (isFoodStack(stack)) return (NS.Items.flags[stack.i | 0] & 8) ? 16 : 32;
    return 0;
  };
  /** `ItemStack.getUseAction` -> `Item.getUseAction(stack)`. */
  Use.getUseAction = function (stack) {
    var n = holdName(stack);
    if (n === null) return Use.UseAction.NONE;
    if (n === 'crossbow') return Use.UseAction.CROSSBOW;
    if (HOLD[n]) return HOLD[n][1];
    return isFoodStack(stack) ? Use.UseAction.EAT : Use.UseAction.NONE;
  };
  /** Per-item `finishUsing(stack, world, user)` and `onStoppedUsing(stack, world, user, remaining)`
   *  overrides, keyed by item name; later G19d rows (food, potion, milk...) register here. */
  Use.finishHandlers = Object.create(null);
  Use.stoppedHandlers = Object.create(null);
  Use.stoppedHandlers.bow = function (P) { return Use.bowRelease(P); };
  // #188 SpyglassItem (.decomp): use() plays item.spyglass.use; finishUsing and onStoppedUsing both play stop_using.
  function spyglassSound(P, name) {
    if (NS.Sound && NS.Sound.play) NS.Sound.play(name, { x: P.x, y: P.y, z: P.z, volume: 1, pitch: 1, source: 'player' });
  }
  Use.stoppedHandlers.spyglass = function (P) { spyglassSound(P, 'item.spyglass.stop_using'); return false; };
  Use.finishHandlers.spyglass = function (P) { spyglassSound(P, 'item.spyglass.stop_using'); };
  // #8066 WritableBookItem.use + BookEditScreen model + ServerPlayNetworkHandler.onBookUpdate (.decomp).
  var Book = Use.Book = { MAX_PAGES: 100, MAX_PAGE_CHARS: 1024, MAX_TITLE: 15, MAX_NBT_PAGE: 32767 };
  /** WritableBookItem.isValid: a "pages" list whose every string is <= 32767 chars. */
  Book.isValid = function (tag) {
    if (!tag || !Array.isArray(tag.pages)) return false;
    for (var i = 0; i < tag.pages.length; i++) if (typeof tag.pages[i] !== 'string' || tag.pages[i].length > Book.MAX_NBT_PAGE) return false;
    return true;
  };
  /** BookEditScreen: a page edit is refused at >= 1024 chars (`length() < 1024` filter) and no 101st page. */
  Book.pageAccepts = function (text) { return text.length < Book.MAX_PAGE_CHARS; };
  Book.canAddPage = function (pages) { return pages.length < Book.MAX_PAGES; };
  /** Client edit: returns the page list after typing `ch` on page `n`, or the same list when refused. */
  Book.type = function (pages, n, ch) {
    var cur = pages[n] || '', next = cur + ch;
    if (!Book.pageAccepts(next)) return pages;
    var out = pages.slice(); out[n] = next; return out;
  };
  Book.addPage = function (pages) { if (!Book.canAddPage(pages)) return pages; return pages.concat(['']); };
  /** WritableBookItem.use: open the edit screen on the held slot. */
  Use.bookStart = function (P, stack) {
    if (!P || !stack || NS.Items.nameOf(stack.i | 0) !== 'writable_book') return false;
    var tag = NS.Inventory.tagOf(stack);
    P.bookScreen = { slot: P.slot | 0, pages: (tag && Array.isArray(tag.pages)) ? tag.pages.slice() : [''], title: '', page: 0, signing: false, dirty: false };
    if (!P.bookScreen.pages.length) P.bookScreen.pages = [''];
    if (NS.Hud && NS.Hud.openBook) NS.Hud.openBook(P.bookScreen, P);
    return true;
  };
  /**
   * onBookUpdate: slot must be hotbar 0-8 or 40; at most 100 pages kept; a title (<= 15 chars,
   * trimmed by the client) signs it: written_book, copied tag, author, title, pages, generation 0.
   * Returns the stack now in the slot, or null when refused.
   */
  Book.update = function (P, slot, pages, title) {
    var Iv = NS.Inventory;
    if (!((slot >= 0 && slot <= 8) || slot === 40)) return null;
    var cur = Iv.getItem(P.inventory, slot);
    if (Iv.isEmpty(cur) || NS.Items.nameOf(cur.i) !== 'writable_book') return null;
    pages = pages.slice(0, Book.MAX_PAGES);
    for (var k = 0; k < pages.length; k++) if (pages[k].length > Book.MAX_NBT_PAGE) return null;
    if (title !== undefined && title !== null) {
      if (title.length > Book.MAX_TITLE) return null;
      var tag = Iv.cloneTag(Iv.tagOf(cur) || {});
      tag.author = P.name || 'Player'; tag.title = title; tag.pages = pages.map(function (t) { return JSON.stringify(t); });
      tag.generation = 0;
      var out = Iv.withTag(Iv.stack('written_book', 1, 0), tag);
      Iv.setItem(P.inventory, slot, out);
      return out;
    }
    var t2 = Iv.cloneTag(Iv.tagOf(cur) || {}); t2.pages = pages;
    var out2 = Iv.withTag(cur, t2);
    Iv.setItem(P.inventory, slot, out2);
    return out2;
  };

  /** BookEditScreen.finalizeBook: only when dirty; trailing empty pages dropped; the title is trimmed. */
  Book.finish = function (P, scr, sign) {
    if (!scr || !scr.dirty) return null;
    var pages = scr.pages.slice();
    while (pages.length && pages[pages.length - 1] === '') pages.pop();
    return Book.update(P, scr.slot, pages, sign ? String(scr.title).trim() : undefined);
  };
  /** BookEditScreen type/backspace on the page (or, when signing, on the title: < 16 chars). */
  Book.input = function (scr, ch) {
    if (scr.signing) { if (scr.title.length < Book.MAX_TITLE) { scr.title += ch; scr.dirty = true; } return; }
    var n = Book.type(scr.pages, scr.page, ch);
    if (n !== scr.pages) { scr.pages = n; scr.dirty = true; }
  };
  Book.backspace = function (scr) {
    if (scr.signing) scr.title = scr.title.slice(0, -1);
    else scr.pages[scr.page] = (scr.pages[scr.page] || '').slice(0, -1);
    scr.dirty = true;
  };
  /** openNextPage: past the last page appends one (<= 100). */
  Book.nextPage = function (scr) {
    if (scr.page < scr.pages.length - 1) scr.page++;
    else { var n = Book.addPage(scr.pages); if (n !== scr.pages) { scr.pages = n; scr.dirty = true; scr.page++; } }
  };

  Use.spyglassStart = function (P, stack, hand) {
    if (!P || !stack || holdName(stack) !== 'spyglass' || P.usingItem) return false;
    spyglassSound(P, 'item.spyglass.use');
    P.useKind = null;
    return Use.holdBegin(P, stack, hand | 0);
  };
  /** `LivingEntity.isUsingSpyglass`: holding a spyglass in the active hand. */
  Use.isUsingSpyglass = function (P) {
    var Iv = NS.Inventory;
    if (!P || !P.usingItem || !P.inventory || !Iv) return false;
    return holdName(Iv.getItem(P.inventory, (P.useHand === 1) ? Iv.OFFHAND : P.slot)) === 'spyglass';
  };
  /** Use ticks while the active hand holds a bow, else -1 (`isUsingItem` + `getActiveItem().isOf(BOW)`). */
  Use.bowUseTicks = function (P) {
    var Iv = NS.Inventory;
    if (!P || !P.usingItem || !P.inventory || !Iv) return -1;
    return holdName(Iv.getItem(P.inventory, (P.useHand === 1) ? Iv.OFFHAND : P.slot)) === 'bow' ? (P.useTicks | 0) : -1;
  };
  function clearHold(P) {
    P.usingItem = false; P.handsBusy = false; P.useTicks = 0; P.useAcc = 0; P.useMax = 0;
  }
  /** `LivingEntity.setCurrentHand` -- begin holding `stack`. False when it has no use time. */
  Use.holdBegin = function (P, stack, hand) {
    var max = Use.getMaxUseTime(stack);
    if (max <= 0 || P.usingItem) return false;
    P.usingItem = true;
    P.useHand = hand | 0;
    P.useTicks = 0; P.useAcc = 0; P.useMax = max;
    P.handsBusy = true;
    return true;
  };
  /** `LivingEntity.stopUsingItem` -- the early release: `onStoppedUsing` ONLY, then clear. */
  Use.holdStop = function (P) {
    var Iv = NS.Inventory;
    var remaining = (P.useMax | 0) - (P.useTicks | 0);
    var stack = (P.inventory && Iv) ? Iv.getItem(P.inventory, (P.useHand === 1) ? Iv.OFFHAND : P.slot) : null;
    var n = holdName(stack);
    var h = n && Use.stoppedHandlers[n];
    var res = false;
    if (h) res = h(P, stack, remaining);
    clearHold(P);
    return res;
  };
  /** `LivingEntity.consumeItem` -- the countdown reached 0: `finishUsing`, then clear. */
  Use.holdFinish = function (P) {
    var Iv = NS.Inventory;
    var stack = (P.inventory && Iv) ? Iv.getItem(P.inventory, (P.useHand === 1) ? Iv.OFFHAND : P.slot) : null;
    var n = holdName(stack);
    var h = n && Use.finishHandlers[n];
    clearHold(P);
    if (h) h(P, stack);
    return true;
  };
  /**
   * `LivingEntity.tickActiveItemStack`, one call per game tick (`ticks` whole ticks; the frame
   * loop feeds it `Use.holdAdvance`). Returns 'finish' when the countdown hit 0, else 'hold'.
   */
  Use.holdTick = function (P, ticks) {
    // ServerPlayerEntity.tick: Criteria.USING_ITEM.trigger(this, activeItemStack) while isUsingItem
    if (P.usingItem && NS.Adv && NS.Adv.trigger && P.advancements) {
      var Iv0 = NS.Inventory, st0 = (P.inventory && Iv0) ? Iv0.getItem(P.inventory, (P.useHand === 1) ? Iv0.OFFHAND : P.slot) : null;
      if (st0 && !(Iv0.isEmpty && Iv0.isEmpty(st0))) NS.Adv.trigger(P, 'minecraft:using_item', { player: P, item: { id: 'minecraft:' + NS.Items.nameOf(st0.i | 0), count: st0.n | 0, damage: st0.d || 0, nbt: st0.t } });
    }
    P.useTicks = (P.useTicks | 0) + (ticks | 0);
    if ((P.useMax | 0) - P.useTicks <= 0) { Use.holdFinish(P); return 'finish'; }
    return 'hold';
  };
  /** Frame-time form: accumulate `dt` seconds into whole 20 Hz ticks, then `holdTick`. */
  Use.holdAdvance = function (P, dt) {
    P.useAcc = (P.useAcc || 0) + dt * 20;
    var whole = Math.floor(P.useAcc);
    P.useAcc -= whole;
    return whole > 0 ? Use.holdTick(P, whole) : 'hold';
  };

  /**
   * `BowItem.use` (.decomp :104-113) -- starts the hold, does not fire. Fails (no swing, no
   * hold) in SURVIVAL with no ammo anywhere; creative always starts (it fires a virtual arrow
   * regardless, `Use.getArrowType`'s own fallback).
   */
  Use.bowStart = function (P, stack, hand) {
    var IT = NS.Items, Iv = NS.Inventory;
    if (!P || !stack || !IT || !Iv || Iv.isEmpty(stack)) return false;
    if (IT.nameOf(stack.i | 0) !== 'bow') return false;
    if (P.usingItem) return false;              // already drawing (D-361 re-click guard)
    var hasAmmo = Use.isArrowItem(Use.getArrowType(P));
    if (!P.instabuild && !hasAmmo) return false;
    P.useKind = null;
    return Use.holdBegin(P, stack, hand | 0);   // BowItem.use(world, player, hand): either hand draws
  };


  // ── #6741: CrossbowItem for the PLAYER (.decomp CrossbowItem.java, read whole). The charge lives
  // in the stack's NBT like vanilla: t.Charged (bool) and t.ChargedProjectiles (list of stacks).
  Use.CROSSBOW_SPEED = Math.fround(3.15);      // field_30869
  Use.CROSSBOW_FIREWORK_SPEED = Math.fround(1.6);   // field_30870
  Use.crossbowIsCharged = function (s) { return !!(s && s.t && s.t.Charged); };
  Use.crossbowSetCharged = function (s, v) { s.t = s.t || {}; s.t.Charged = !!v; };
  Use.crossbowProjectiles = function (s) { return (s && s.t && s.t.ChargedProjectiles) || []; };
  Use.crossbowHas = function (s, name) {
    var IT = NS.Items;
    return Use.crossbowProjectiles(s).some(function (p) { return IT.nameOf(p.i | 0) === name; });
  };
  Use.crossbowPullTime = function (s) {
    var q = NS.Combat ? NS.Combat.enchantLevel(s, 'quick_charge') : 0;
    return q === 0 ? 25 : 25 - 5 * q;
  };
  /** `PlayerEntity.getArrowType(crossbow)`: held arrow/firework (off hand first), then any arrow in the inventory. */
  Use.crossbowAmmoSlot = function (P) {
    var Iv = NS.Inventory, IT = NS.Items;
    var held = function (st) { return Use.isArrowItem(st) || (st && !Iv.isEmpty(st) && IT.nameOf(st.i | 0) === 'firework_rocket'); };
    var off = Iv.getItem(P.inventory, Iv.OFFHAND);
    if (held(off)) return Iv.OFFHAND;
    var main = P.heldItem ? P.heldItem() : null;
    if (held(main)) return P.slot;
    return Use.getArrowSlot(P);
  };
  Use.crossbowStart = function (P, stack) {
    var IT = NS.Items, Iv = NS.Inventory;
    if (!P || !stack || !IT || !Iv || Iv.isEmpty(stack) || IT.nameOf(stack.i | 0) !== 'crossbow') return false;
    if (P.usingItem) return false;
    if (Use.crossbowIsCharged(stack)) {
      Use.crossbowShootAll(P, stack, Use.crossbowHas(stack, 'firework_rocket') ? Use.CROSSBOW_FIREWORK_SPEED : Use.CROSSBOW_SPEED, 1.0);
      Use.crossbowSetCharged(stack, false);
      return true;
    }
    if (Use.crossbowAmmoSlot(P) < 0 && !P.instabuild) return false;   // creative: virtual arrow
    P.useKind = null;
    return Use.holdBegin(P, stack, 0);
  };
  /** `CrossbowItem.loadProjectiles`: 1 projectile, 3 with Multishot; only the first is taken from the stack. */
  Use.crossbowLoad = function (P, stack) {
    var Iv = NS.Inventory, Cb = NS.Combat;
    var n = Cb.enchantLevel(stack, 'multishot') === 0 ? 1 : 3, creative = !!P.instabuild;
    var slot = Use.crossbowAmmoSlot(P);
    var ammo = slot >= 0 ? Iv.getItem(P.inventory, slot) : null;
    var proto = (ammo && !Iv.isEmpty(ammo)) ? ammo : null;
    var list = [];
    for (var k = 0; k < n; k++) {
      var src = proto;
      if (!src && creative) { src = Iv.stack('arrow', 1); proto = src; }
      if (!src) return false;
      var isArrow = Use.isArrowItem(src);
      var copy = { i: src.i, n: 1, d: src.d | 0, t: src.t || null };
      if (!(creative && isArrow) && !creative && k === 0) {
        src.n = (src.n | 0) - 1;
        if (src.n <= 0) Iv.setItem(P.inventory, slot, null); else Iv.setItem(P.inventory, slot, src);
        if (k === 0) proto = { i: copy.i, n: 1, d: copy.d, t: copy.t };   // later shots copy the first (even if emptied)
      }
      list.push(copy);
    }
    stack.t = stack.t || {};
    stack.t.ChargedProjectiles = (stack.t.ChargedProjectiles || []).concat(list);
    if (P.syncHotbar) P.syncHotbar();
    return true;
  };
  Use.stoppedHandlers.crossbow = function (P, stack, remaining) {
    var useTicks = (P.useMax | 0) - (remaining | 0);
    var pull = Math.min(useTicks / Use.crossbowPullTime(stack), 1);
    if (pull >= 1 && !Use.crossbowIsCharged(stack) && Use.crossbowLoad(P, stack)) {
      Use.crossbowSetCharged(stack, true);
      if (NS.Sound && NS.Sound.play) NS.Sound.play('item.crossbow.loading_end', { x: P.ex, y: P.ey, z: P.ez, volume: 1, pitch: Math.fround(1 / (pRand() * 0.5 + 1.0) + 0.2), source: 'player' });
      return true;
    }
    return false;
  };
  /** `CrossbowItem.shootAll`: projectile 0 straight, 1 at -10 deg, 2 at +10 deg; pitches rolled once up front. */
  Use.crossbowShootAll = function (P, stack, speed, div) {
    var Cb = NS.Combat, list = Use.crossbowProjectiles(stack);
    var flag = pRand() < 0.5;
    var sp = function (f) { return Math.fround((f ? 0.63 : 0.43) + 1 / (pRand() * 0.5 + 1.8)); };
    var pitches = [1, sp(flag), sp(!flag)], angles = [0, -10, 10];
    for (var k = 0; k < list.length && k < 3; k++) {
      Use.crossbowShoot(P, stack, list[k], pitches[k], !!P.instabuild, speed, div, angles[k]);
    }
    if (NS.Adv && NS.Adv.trigger && P.advancements) {   // postShoot: Criteria.SHOT_CROSSBOW.trigger(player, stack)
      NS.Adv.trigger(P, 'minecraft:shot_crossbow', { stack: { id: 'minecraft:' + NS.Items.nameOf(stack.i | 0), count: stack.n | 0, damage: stack.d || 0, nbt: stack.t } });
    }
    stack.t.ChargedProjectiles = [];   // postShoot clearProjectiles
  };
  Use.crossbowShoot = function (P, stack, proj, pitch, creative, speed, div, angle) {
    var Cb = NS.Combat, EL = NS.EntityList, IT = NS.Items;
    var name = IT.nameOf(proj.i | 0), isFw = name === 'firework_rocket';
    var f = P.lookVec ? P.lookVec() : [0, 0, -1];
    // rotate the look vector by `angle` deg about getOppositeRotationVector (look pitch - 90)
    var h = Math.sqrt(f[0] * f[0] + f[2] * f[2]), k = h > 1e-9 ? [-f[0] * f[1] / h, h, -f[2] * f[1] / h] : [0, 1, 0];
    var th = angle * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
    var cx = k[1] * f[2] - k[2] * f[1], cy = k[2] * f[0] - k[0] * f[2], cz = k[0] * f[1] - k[1] * f[0];
    var dx = f[0] * c + cx * s, dy = f[1] * c + cy * s, dz = f[2] * c + cz * s;
    var len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1, g = Cb.ARROW_GAUSS_SCALE * div;
    var vx = (dx / len + Cb.gauss(pRand) * g) * speed + (P.vx || 0);
    var vy = (dy / len + Cb.gauss(pRand) * g) * speed + (P.onGround ? 0 : (P.vy || 0));
    var vz = (dz / len + Cb.gauss(pRand) * g) * speed + (P.vz || 0);
    var eye = P.ey + (P.eyeHeight || P.EYE || 1.62), a;
    if (isFw) {
      a = EL.spawn('firework_rocket', P.ex, eye - 0.15, P.ez, { vx: vx, vy: vy, vz: vz, shooter: P, tag: proj.t || undefined });
      if (a) a.shotAtAngle = true;
    } else {
      var arrowType = name === 'spectral_arrow' ? 'spectral_arrow' : 'arrow';
      var tip = (name === 'tipped_arrow' && NS.Potion && NS.Potion.tipFromTag) ? NS.Potion.tipFromTag(proj.t) : null;
      a = EL.spawn(arrowType, P.ex, eye - Cb.ARROW_SPAWN_BELOW_EYE, P.ez, { vx: vx, vy: vy, vz: vz, shooter: P, tip: tip });
      if (a) {
        a.critical = true; a.hitSound = 'item.crossbow.hit'; a.shotFromCrossbow = true;
        var pierce = Cb.enchantLevel(stack, 'piercing');
        if (pierce > 0) a.pierceLevel = pierce;
        a.pickupType = (creative || angle !== 0) ? Cb.PICKUP_CREATIVE_ONLY : Cb.PICKUP_ALLOWED;
        a.pickupItem = (Use.isArrowItem(proj) ? name : 'arrow');
        a.pickupTag = proj.t || null;
      }
    }
    Use.damage(P, stack, isFw ? 3 : 1);
    if (NS.Sound && NS.Sound.play) NS.Sound.play('item.crossbow.shoot', { x: P.ex, y: P.ey, z: P.ez, volume: 1, pitch: pitch, source: 'player' });
    return a;
  };

  // ── #862: SHIELD BLOCKING — ShieldItem.use / LivingEntity.isBlocking / blockedByShield /
  // PlayerEntity.damageShield / takeShieldHit / disableShield (.decomp, read whole). Rides the
  // bow's hold (`P.usingItem`, `P.useKind='shield'`); `P.shieldCooldown` is ItemCooldownManager's
  // 100-tick row for the shield, counted down by `Use.tickShieldCooldown`. Main hand only (the
  // hold's own header). Only attackers with a position (a LivingEntity source) can be blocked
  // here: an unattributed explosion/fireball has no `getPosition()` in this engine's Sv.hurt.
  Use.SHIELD_WARMUP_TICKS = 5;       // ShieldItem field_30918 / isBlocking's `>= 5`
  Use.SHIELD_DISABLE_COOLDOWN = 100;
  /** The inventory slot of the hand the running hold started from (activeHand). */
  Use.useSlot = function (P) { return (P.useHand === 1) ? NS.Inventory.OFFHAND : P.slot; };
  Use.shieldStart = function (P, stack, hand) {
    var IT = NS.Items, Iv = NS.Inventory;
    if (!P || !stack || !IT || !Iv || Iv.isEmpty(stack) || P.usingItem) return false;
    if (IT.nameOf(stack.i | 0) !== 'shield') return false;
    if ((P.shieldCooldown | 0) > 0) return false;              // cooling down: use() is not offered
    P.usingItem = true; P.useKind = 'shield'; P.useHand = hand === 1 ? 1 : 0; P.useTicks = 0; P.handsBusy = true;
    return true;
  };
  Use.shieldStack = function (P) {
    var Iv = NS.Inventory, IT = NS.Items;
    if (!P || !P.inventory || !Iv || !IT) return null;
    var st = Iv.getItem(P.inventory, Use.useSlot(P));
    return (st && !Iv.isEmpty(st) && IT.nameOf(st.i | 0) === 'shield') ? st : null;
  };
  Use.isBlocking = function (P) {
    return !!(P && P.usingItem && P.useKind === 'shield' && P.useTicks >= Use.SHIELD_WARMUP_TICKS && Use.shieldStack(P));
  };
  Use.shieldCancel = function (P) {
    P.usingItem = false; P.useKind = null; P.handsBusy = false; P.useTicks = 0;
  };
  Use.tickShieldCooldown = function (P) { if ((P.shieldCooldown | 0) > 0) P.shieldCooldown--; };
  /** LivingEntity.blockedByShield: not a bypassArmor source, blocking, attacker in front (dot < 0). */
  Use.blockedByShield = function (P, src, attacker) {
    if (!attacker || (src && src.bypassArmor) || !Use.isBlocking(P)) return false;
    var dx = attacker.x - P.x, dz = attacker.z - P.z;           // $$4.relativize(pos) = pos - attacker, flipped below
    var len = Math.sqrt(dx * dx + dz * dz);
    if (!(len > 0)) return false;
    var fx = Math.sin(P.yaw || 0), fz = -Math.cos(P.yaw || 0);  // horizontal look (dot with y-zeroed vec)
    // vanilla: dot(normalize(self - attacker) with y zeroed, look) < 0. The normalize happens BEFORE
    // the y is zeroed, so the horizontal part is scaled by cos(elevation); the SIGN is unchanged.
    return -(dx * fx + dz * fz) / len < 0;
  };
  /** LivingEntity.handleStatus 29 (block, vol 1.0) / 30 (break, vol 0.8): pitch 0.8 + random*0.4. */
  Use.shieldSound = function (P, ev, vol) {
    if (NS.Sound && NS.Sound.play) NS.Sound.play(ev, { x: P.x, y: P.y, z: P.z, volume: vol, pitch: 0.8 + pRand() * 0.4, source: 'player' });
  };
  /** PlayerEntity.damageShield: a hit of 3+ costs 1 + floor(amount) durability; a broken shield is removed. */
  Use.damageShield = function (P, amount) {
    if (!(amount >= 3)) return;
    var Iv = NS.Inventory, st = Use.shieldStack(P);
    if (!st) return;
    var n = 1 + Math.floor(amount), max = NS.Items.durability ? NS.Items.durability[st.i | 0] : 0;
    if (P.instabuild || !max) return;
    st.d = (st.d | 0) + n;
    if (st.d >= max) {
      Iv.setItem(P.inventory, Use.useSlot(P), null);
      Use.shieldCancel(P);
      if (P.syncHotbar) P.syncHotbar();
    }
  };
  /** PlayerEntity.disableShield: chance 0.25 + 0.05*efficiency (+0.75 for an axe hit) to drop the guard for 100 ticks. */
  Use.disableShield = function (P, axeHit, rand) {
    var Cb = NS.Combat, st = Use.shieldStack(P);
    var eff = st && Cb && Cb.enchantLevel ? Cb.enchantLevel(st, 'efficiency') : 0;
    var chance = 0.25 + eff * 0.05 + (axeHit ? 0.75 : 0);
    if ((rand || pRand)() < chance) { P.shieldCooldown = Use.SHIELD_DISABLE_COOLDOWN; Use.shieldCancel(P); Use.shieldSound(P, 'item.shield.break', 0.8); return true; }
    return false;
  };
  /** LivingEntity.takeShieldHit -> attacker.knockback(P); PlayerEntity adds the axe disable. */
  Use.takeShieldHit = function (P, attacker, rand) {
    var Cb = NS.Combat, Ai = NS.Ai, Hg = NS.Hoglin;
    var ty = attacker.type;
    if (ty === 'ravager' && Ai && Ai.ravagerAttackBlockedByShield) Ai.ravagerAttackBlockedByShield(attacker, P, { random: rand });
    else if ((ty === 'hoglin' || ty === 'zoglin') && Hg && Hg.TYPES) {
      // Hoglin.tryAttack: a blocked hit reaches takeShieldHit, so the ATTACKER is pushed back (LivingEntity.knockback 0.5), not the target
      attacker.hgBlocked = true;
      if (Cb && Cb.knockback) Cb.knockback(attacker, 0.5, P.x - attacker.x, P.z - attacker.z);
    } else if (Cb && Cb.knockback) Cb.knockback(P, 0.5, P.x - attacker.x, P.z - attacker.z);   // LivingEntity.knockback
    var IT = NS.Items;
    var Eq = NS.Equip, mh = Eq && IT ? Eq.getEquipped(attacker, IT.MAINHAND) : null;
    var nm = mh && IT ? IT.nameOf(mh.i | 0) : '';
    if (/_axe$/.test(nm)) Use.disableShield(P, true, rand);
  };

  // ── G19d-d: DRINKING — PotionItem / MilkBucketItem / HoneyBottleItem / StewItem / SuspiciousStewItem
  // (.decomp net/minecraft/item/*.java, each read in full). Rides the SAME hold as the bow
  // (`P.usingItem`/`P.useTicks`); `P.useKind` says which finisher owns it. Releasing early does
  // NOTHING (`Use.drinkCancel`) — vanilla's `onStoppedUsing` for these items is the empty default.
  // ⚠ The stack is consumed only in `finishUsing`, after `getMaxUseTime` ticks (32; honey 40).
  // Named simplification: main hand only (see this section's header), no sip particles/sound.
  Use.DRINK_ITEMS = {
    potion: 32, milk_bucket: 32, honey_bottle: 40,
    mushroom_stew: 32, rabbit_stew: 32, beetroot_soup: 32, suspicious_stew: 32
  };
  // FoodComponents.SUSPICIOUS_STEW is alwaysEdible; the plain stews and honey are not. Potion and
  // milk are not food at all (`ItemUsage.consumeHeldItem` starts the hold unconditionally).
  Use.DRINK_ALWAYS = { potion: true, milk_bucket: true, suspicious_stew: true,
    golden_apple: true, enchanted_golden_apple: true, chorus_fruit: true };   // .alwaysEdible() in FoodComponents
  Use.SUSPICIOUS_STEW_DEFAULT = 160;   // SuspiciousStewItem.finishUsing's `int $$7 = 160`

  Use.drinkStart = function (P, stack, hand) {
    var IT = NS.Items, Iv = NS.Inventory;
    if (!P || !stack || !IT || !Iv || Iv.isEmpty(stack) || P.usingItem) return false;
    var name = IT.nameOf(stack.i | 0);
    if (!Use.DRINK_ITEMS.hasOwnProperty(name) && !isFoodStack(stack)) return false;   // plain food: Item.use -> FoodComponent
    if (!Use.DRINK_ALWAYS[name] && !(P.food < 20 || P.instabuild)) return false;   // FoodComponents/canConsume
    if ((P.itemCooldowns && P.itemCooldowns[name] > 0)) return false;   // ItemCooldownManager.isCoolingDown (chorus fruit: 20)
    P.usingItem = true; P.useKind = 'drink'; P.useHand = hand === 1 ? 1 : 0; P.useTicks = 0; P.handsBusy = true;
    return true;
  };

  /** Ticks left of the hold before `finishUsing` (vanilla `getMaxUseTime`), or -1 when not drinking. */
  Use.drinkMaxTicks = function (P) {
    var Iv = NS.Inventory, IT = NS.Items;
    if (!P || P.useKind !== 'drink' || !P.inventory) return -1;
    var st = Iv.getItem(P.inventory, Use.useSlot(P));
    if (Iv.isEmpty(st)) return -1;
    var n = IT.nameOf(st.i | 0);
    if (Use.DRINK_ITEMS.hasOwnProperty(n)) return Use.DRINK_ITEMS[n];
    return isFoodStack(st) ? Use.getMaxUseTime(st) : -1;
  };

  /** Item.getDrinkSound / getEatSound: only the honey bottle overrides them. */
  function consumeSound(name) {
    if (name === 'honey_bottle') return 'item.honey_bottle.drink';
    return name === 'potion' || name === 'milk_bucket' ? 'entity.generic.drink' : 'entity.generic.eat';   // UseAction.DRINK vs EAT
  }
  /** Vec3d.rotateX / rotateY as .decomp Vec3d.java has them. */
  function rotX(v, a) { var c = Math.cos(a), s = Math.sin(a); return [v[0], v[1] * c + v[2] * s, v[2] * c - v[1] * s]; }
  function rotY(v, a) { var c = Math.cos(a), s = Math.sin(a); return [v[0] * c + v[2] * s, v[1], v[2] * c - v[0] * s]; }
  /**
   * LivingEntity.spawnItemParticles(stack, count): per particle a velocity (rand-0.5)*0.1, Math.random()*0.1+0.1, 0
   * and a position (rand-0.5)*0.3, -rand*0.6-0.3, 0.6, both rotated by -pitch (X) then -yaw (Y), position from the eye.
   * P.pitch is positive UP here, vanilla's is positive down; both angles are radians in this engine.
   */
  Use.spawnItemParticles = function (P, stack, count, rnd) {
    var r = rnd || pRand, Px = NS.Particles || NS.Particle, n = 0;
    if (!Px || !Px.spawn) return 0;
    var pit = -(-(P.pitch || 0)), yw = -(P.yaw || 0), name = NS.Items.nameOf(stack.i | 0);
    var eyeY = P.y + (P.eyeHeight || P.EYE || 1.62);
    for (var i = 0; i < count; i++) {
      var v = [(r() - 0.5) * 0.1, r() * 0.1 + 0.1, 0];
      v = rotY(rotX(v, pit), yw);
      var py = -r() * 0.6 - 0.3;
      var q = [(r() - 0.5) * 0.3, py, 0.6];
      q = rotY(rotX(q, pit), yw);
      if (Px.spawn('item_crack', q[0] + P.x, q[1] + eyeY, q[2] + P.z, v[0], v[1] + 0.05, v[2], r, name)) n++;
    }
    return n;
  };
  /** LivingEntity.spawnConsumptionEffects(stack, count): DRINK -> sound only; EAT -> particles + eat sound. */
  Use.spawnConsumptionEffects = function (P, stack, count, rnd) {
    var r = rnd || pRand, act = Use.getUseAction(stack), S = NS.Sound;
    if (!stack || act === Use.UseAction.NONE) return false;
    var name = NS.Items.nameOf(stack.i | 0), o = { x: P.x, y: P.y, z: P.z, source: 'neutral' };
    if (act === Use.UseAction.DRINK) {
      o.volume = 0.5; o.pitch = r() * 0.1 + 0.9;
      if (S && S.play) S.play(consumeSound(name), o);
    } else if (act === Use.UseAction.EAT) {
      Use.spawnItemParticles(P, stack, count, r);
      o.volume = 0.5 + 0.5 * Math.floor(r() * 2); o.pitch = (r() - r()) * 0.2 + 1;
      if (S && S.play) S.play(consumeSound(name), o);
    }
    return true;
  };
  /** LivingEntity.shouldSpawnConsumptionEffects: (snack || left <= max-7) && left % 4 == 0. */
  Use.shouldSpawnConsumptionEffects = function (stack, left) {
    var snack = isFoodStack(stack) && (NS.Items.flags[stack.i | 0] & 8) !== 0;
    return (snack || left <= Use.getMaxUseTime(stack) - 7) && left % 4 === 0;
  };
  /** One tickItemStackUsage per call (dedup'd per whole tick): effects with count 5. */
  Use.consumeTick = function (P, rnd) {
    var left = Use.drinkMaxTicks(P) - Math.floor(P.useTicks);
    if (left <= 0 || P.lastConsumeFx === left) return false;
    var stack = NS.Inventory.getItem(P.inventory, Use.useSlot(P));
    if (!Use.shouldSpawnConsumptionEffects(stack, left)) return false;
    P.lastConsumeFx = left;
    Use.spawnConsumptionEffects(P, stack, 5, rnd);
    return true;
  };

  Use.drinkCancel = function (P) {
    P.lastConsumeFx = null;
    P.usingItem = false; P.useKind = null; P.handsBusy = false; P.useTicks = 0;
  };

  /** Hand `bottle` to the inventory; whatever does not fit is dropped (HoneyBottleItem's dropItem). */
  function giveRemainder(P, name) {
    var Iv = NS.Inventory, left = Iv.add(P.inventory, Iv.stack(name, 1, 0));
    if (left > 0 && NS.EntityList && NS.EntityList.dropStack) NS.EntityList.dropStack(P.x, P.y + 1.3, P.z, name, left);
  }

  /** The `finishUsing` half. Returns the item name finished, or false when the hold was stale. */
  Use.drinkFinish = function (P) {
    var IT = NS.Items, Iv = NS.Inventory, ES = NS.Effects, Sv = NS.Survival, Po = NS.Potion;
    var slot = Use.useSlot(P), stack = P.inventory ? Iv.getItem(P.inventory, slot) : Iv.EMPTY;
    var name = (!Iv.isEmpty(stack)) ? IT.nameOf(stack.i | 0) : '';
    var need = Use.DRINK_ITEMS.hasOwnProperty(name) || (name !== '' && isFoodStack(stack));
    Use.drinkCancel(P);
    if (!need) return false;
    // LivingEntity.consumeItem: UseAction.DRINK -> DRINKING_FINISH (7), EAT -> EAT (8); honey is DRINK, stews are EAT
    if (NS.GameEvent) NS.GameEvent.emit(name === 'potion' || name === 'milk_bucket' || name === 'honey_bottle' ? 'drinking_finish' : 'eat', P.x, P.y, P.z, P);
    var creative = !!P.instabuild, tag = stack.t || null, i;
    var Snd = NS.Sound;
    Use.spawnConsumptionEffects(P, stack, 16);   // LivingEntity.consumeItem: spawnConsumptionEffects(activeItemStack, 16)
    if (NS.Adv && NS.Adv.trigger && P.advancements) {   // ServerPlayerEntity.consumeItem: Criteria.CONSUME_ITEM.trigger(player, stack)
      NS.Adv.trigger(P, 'minecraft:consume_item', { stack: { id: 'minecraft:' + name, count: stack.n | 0, damage: stack.d || 0, nbt: stack.t } });
    }
    // Player.eatFood: burp (0.5, rand*0.1+0.9) + LivingEntity.eatFood's eat sound; both for every isFood stack (not potion/milk)
    if (isFoodStack(stack) && Snd && Snd.play) {
      Snd.play('entity.player.burp', { x: P.x, y: P.y, z: P.z, volume: 0.5, pitch: pRand() * 0.1 + 0.9, source: 'player' });
      Snd.play(consumeSound(name), { x: P.x, y: P.y, z: P.z, volume: 1, pitch: 1 + (pRand() - pRand()) * 0.4, source: 'neutral' });
    }
    var setSlot = function (nm) { Iv.setItem(P.inventory, slot, Iv.stack(nm, 1, 0)); };
    // items.bin's saturation column is the ABSOLUTE gain (hunger * modifier * 2), Sv.eat wants the modifier
    var eatIt = function () { var nu = IT.nutrition[stack.i] | 0; if (Sv && nu > 0) Sv.eat(P, nu, IT.saturation[stack.i] / (2 * nu)); };
    if (name === 'potion') {
      var effs = Po ? Po.effectsOf(tag && tag.Potion ? String(tag.Potion).replace('minecraft:', '') : '', tag && tag.CustomPotionEffects) : [];
      for (i = 0; i < effs.length; i++) {
        var f = effs[i];
        if (f.effect === 'instant_health' || f.effect === 'instant_damage') ES.applyInstantEffect(P, f.effect, f.amplifier | 0, 1.0, P);
        else ES.addStatusEffect(P, f.effect, f.duration, f.amplifier | 0, false, true);
      }
      if (!creative) { Iv.shrink(stack, 1); if (stack.n <= 0) setSlot('glass_bottle'); else giveRemainder(P, 'glass_bottle'); }
    } else if (name === 'milk_bucket') {
      if (!creative) { Iv.shrink(stack, 1); if (stack.n <= 0) setSlot('bucket'); }
      ES.clearStatusEffects(P);                                 // MilkBucketItem.finishUsing
    } else if (name === 'honey_bottle') {
      eatIt();                                                  // Item.finishUsing -> eatFood (6, 0.1)
      if (!creative) { Iv.shrink(stack, 1); if (stack.n <= 0) setSlot('glass_bottle'); else giveRemainder(P, 'glass_bottle'); }
      ES.removeStatusEffect(P, 'poison');
    } else if (!Use.DRINK_ITEMS.hasOwnProperty(name)) {        // plain food: Item.finishUsing -> eatFood
      eatIt();
      var fe = (NS.Fox && NS.Fox.FOOD_EFFECTS[name]) || [];     // FoodComponent status effects [id, ticks, amp, chance]
      for (i = 0; i < fe.length; i++) if (pRand() < fe[i][3]) ES.addStatusEffect(P, fe[i][0], fe[i][1], fe[i][2], false, true);
      if (!creative) Iv.shrink(stack, 1);
      if (stack.n <= 0) Iv.setItem(P.inventory, slot, null);
      if (name === 'chorus_fruit') Use.chorusTeleport(P);
    } else {                                                    // StewItem / SuspiciousStewItem
      eatIt();
      if (name === 'suspicious_stew' && tag && tag.Effects) {
        for (i = 0; i < tag.Effects.length; i++) {
          var row = tag.Effects[i], en = ES.NAMES[row.EffectId | 0];
          if (en) ES.addStatusEffect(P, en, row.EffectDuration !== undefined ? row.EffectDuration | 0 : Use.SUSPICIOUS_STEW_DEFAULT, 0, false, true);
        }
      }
      if (!creative) { Iv.shrink(stack, 1); setSlot('bowl'); }  // stew stacks to 1: always replaced by the bowl
    }
    return name;
  };

  /** ChorusFruitItem.finishUsing: up to 16 tries at +-8 xz / -8..7 y, then a 20-tick cooldown (creative too). */
  Use.chorusTeleport = function (P, rnd) {
    var r = rnd || pRand, E = NS.Enderman;
    if (E && E.chorusTeleport) E.chorusTeleport(P, r, { source: 'player' });
    (P.itemCooldowns = P.itemCooldowns || {}).chorus_fruit = 20;
  };
  /** ItemCooldownManager.update: one tick. */
  Use.tickItemCooldowns = function (P) {
    var c = P.itemCooldowns; if (!c) return;
    for (var k in c) if (c[k] > 0) c[k]--;
  };

  /**
   * `BowItem.onStoppedUsing` (.decomp :26-84, read whole) -- the release. Called from
   * `P.act`'s own hold-tick branch (14_player.js) the frame the button is no longer held.
   * Returns whether an arrow actually left the bow (false covers every one of vanilla's own
   * silent PASSes: pull under 0.1, no ammo and not creative/Infinity, the bow having left the
   * drawing hand mid-hold).
   */
  // #5614 -- TridentItem (.decomp): use() starts the SPEAR hold (72000), onStoppedUsing needs
  // >= 10 ticks held, damages the stack 1 and throws a TridentEntity at 2.5 (+0.5/riptide level
  // when not riptiding); survival removes the thrown stack, creative gets no pickup.
  Use.TRIDENT_MIN_USE_TICKS = 10;
  Use.TRIDENT_SPEED = 2.5;
  Use.tridentStart = function (P, stack) {
    var IT = NS.Items, Iv = NS.Inventory, Cb = NS.Combat;
    if (!P || !stack || !IT || !Iv || Iv.isEmpty(stack) || P.usingItem) return false;
    if (IT.nameOf(stack.i | 0) !== 'trident') return false;
    var max = IT.durability ? IT.durability[stack.i | 0] : 0;
    if (max && (stack.d | 0) >= max - 1) return false;                  // TridentItem.use: getDamage >= getMaxDamage-1 -> fail
    if (Cb && Cb.enchantLevel(stack, 'riptide') > 0 && !Use.touchingWaterOrRain(P)) return false;   // TridentItem.use: riptide needs water/rain
    P.useKind = null;
    return Use.holdBegin(P, stack, 0);
  };
  /** Entity.isTouchingWaterOrRain: in water, or rained on (B.hasRain at the feet / head block). */
  Use.touchingWaterOrRain = function (P) {
    if (P.inWater) return true;
    var B = NS.Behave;
    if (!B || !B.hasRain) return false;
    var x = Math.floor(P.ex), y = Math.floor(P.ey), z = Math.floor(P.ez);
    return B.hasRain(x, y, z) || B.hasRain(x, Math.floor(P.ey + (P.height || 1.8)), z);
  };
  /** TridentItem.onStoppedUsing riptide branch: look * 3*(1+level)/4, 20 riptide ticks, +1.2 hop on ground. */
  Use.tridentRiptide = function (P, stack, rip) {
    if (!Use.touchingWaterOrRain(P)) return false;
    Use.damage(P, stack, 1);
    var f = P.lookVec ? P.lookVec() : [0, 0, -1];
    var n = Math.sqrt(f[0] * f[0] + f[1] * f[1] + f[2] * f[2]) || 1;
    var k = 3 * ((1 + rip) / 4) / n;
    P.vx = (P.vx || 0) + f[0] * k; P.vy = (P.vy || 0) + f[1] * k; P.vz = (P.vz || 0) + f[2] * k;
    P.riptideTicks = 20;                                                 // PlayerEntity.useRiptide; pose SPIN_ATTACK while > 0
    if (P.onGround) { P.ey += 1.1999999; P.onGround = false; }
    var ev = rip >= 3 ? 'item.trident.riptide_3' : rip === 2 ? 'item.trident.riptide_2' : 'item.trident.riptide_1';
    if (NS.Sound && NS.Sound.entitySound) NS.Sound.entitySound(ev, P.ex, P.ey, P.ez, 1, 1, 'player', NS.Player);
    return true;
  };
  /** LivingEntity.tickRiptide (from baseTick): count down; a living mob in the box => player attack, stop, v*-0.2; wall => stop. */
  Use.tickRiptide = function (P) {
    if (!(P.riptideTicks > 0)) return;
    P.riptideTicks--;
    var Ph = NS.Physics, list = NS.EntityList && NS.EntityList.list, hit = null;
    for (var i = 0; list && i < list.length; i++) {
      var o = list[i];
      if (o === P || o.removed || o.dead || o.maxHealth === undefined) continue;
      if (Ph && Ph.boxesOverlap && Ph.boxesOverlap(P, o)) { hit = o; break; }
    }
    if (hit) {
      if (NS.Combat && NS.Combat.attack) NS.Combat.attack(P, hit);    // PlayerEntity.attackLivingEntity = attack()
      P.riptideTicks = 0;
      P.vx = (P.vx || 0) * -0.2; P.vy = (P.vy || 0) * -0.2; P.vz = (P.vz || 0) * -0.2;
    } else if (P.horizontalCollision) P.riptideTicks = 0;
  };
  Use.tridentRelease = function (P, stack, useTicks, slot) {
    var Iv = NS.Inventory, Cb = NS.Combat, EL = NS.EntityList;
    if (useTicks < Use.TRIDENT_MIN_USE_TICKS) return false;
    var rip = Cb.enchantLevel(stack, 'riptide') | 0;
    if (rip > 0) return Use.tridentRiptide(P, stack, rip);
    if (!EL.canSpawn('trident')) return false;
    var thrown = Iv.stack('trident', 1, stack.d | 0, stack.t || null);
    Use.damage(P, stack, 1);
    thrown.d = stack.d | 0;
    var f = P.lookVec ? P.lookVec() : [0, 0, -1];
    var sp = Use.TRIDENT_SPEED, g = Cb.ARROW_GAUSS_SCALE, rnd = pRand;
    var vx = (f[0] + Cb.gauss(rnd) * g) * sp + (P.vx || 0);
    var vy = (f[1] + Cb.gauss(rnd) * g) * sp + (P.onGround ? 0 : (P.vy || 0));
    var vz = (f[2] + Cb.gauss(rnd) * g) * sp + (P.vz || 0);
    var ay = (P.ey + (P.eyeHeight || P.EYE || 1.62)) - Cb.ARROW_SPAWN_BELOW_EYE;
    var t = EL.spawn('trident', P.ex, ay, P.ez, { vx: vx, vy: vy, vz: vz, shooter: P });
    if (!t) return false;
    t.loyalty = Cb.enchantLevel(thrown, 'loyalty');   // dataTracker LOYALTY (#5615)
    t.pickupType = P.instabuild ? Cb.PICKUP_CREATIVE_ONLY : Cb.PICKUP_ALLOWED;
    t.pickupItem = 'trident'; t.pickupTag = thrown.t || null; t.pickupDamage = thrown.d | 0;
    if (NS.Sound && NS.Sound.entitySound) NS.Sound.entitySound('item.trident.throw', P.ex, P.ey, P.ez, 1, 1, 'player', NS.Player);
    if (!P.instabuild && !Iv.isEmpty(Iv.getItem(P.inventory, slot))) {
      Iv.setItem(P.inventory, slot, null);
      if (P.syncHotbar) P.syncHotbar();
    }
    return true;
  };
  Use.bowRelease = function (P) {
    if (P.useKind === 'shield') { Use.shieldCancel(P); return false; }
    if (P.useKind === 'drink') { Use.drinkCancel(P); return false; }   // early release: nothing (G19d-d)
    var Iv = NS.Inventory, IT = NS.Items, Cb = NS.Combat, EL = NS.EntityList;
    var useTicks = P.useTicks | 0;
    P.usingItem = false;
    P.handsBusy = false;
    P.useTicks = 0;
    if (!P.inventory || !Iv || !IT || !Cb || !EL) return false;
    var slot = (P.useHand === 1) ? Iv.OFFHAND : P.slot;
    var stack = Iv.getItem(P.inventory, slot);
    // the bow left this hand mid-draw (dropped, swapped, hotbar scrolled) -- PASS, nothing
    // fires; vanilla's own `onStoppedUsing` is called on whatever stack IS still in the hand,
    // so a non-bow there means this call should never have reached BowItem at all.
    if (stack && !Iv.isEmpty(stack) && IT.nameOf(stack.i | 0) === 'trident') return Use.tridentRelease(P, stack, useTicks, slot);
    if (!stack || Iv.isEmpty(stack) || IT.nameOf(stack.i | 0) !== 'bow') return false;

    var creative = !!P.instabuild;
    var infinityLvl = Cb.enchantLevel(stack, 'infinity');
    var noConsumeCandidate = creative || infinityLvl > 0;     // BowItem's own `$$5`

    var arrowSlot = Use.getArrowSlot(P);
    var arrowStack = arrowSlot >= 0 ? Iv.getItem(P.inventory, arrowSlot) : null;
    var hasRealAmmo = !!(arrowStack && !Iv.isEmpty(arrowStack));
    if (!hasRealAmmo && !noConsumeCandidate) return false;    // BowItem's own outer `if`, PASS

    var ammoName = hasRealAmmo ? IT.nameOf(arrowStack.i | 0) : 'arrow';   // virtual plain arrow
    var ammoTag = hasRealAmmo ? (arrowStack.t || null) : null;

    var pull = Use.bowPullProgress(useTicks);
    if (pull < 0.1) return false;                              // BowItem's own `if (!(pull<0.1))`

    // `$$9`: the pickup-permission flag (BowItem.java's own local), true when a NON-CONSUMING
    // draw (creative or Infinity) fired a PLAIN arrow specifically.
    var dollar9 = noConsumeCandidate && ammoName === 'arrow';
    var pickupType = (dollar9 || (creative && (ammoName === 'spectral_arrow' || ammoName === 'tipped_arrow')))
      ? 'creative_only' : 'allowed';

    var arrowType = (ammoName === 'spectral_arrow') ? 'spectral_arrow' : 'arrow';
    var tip = (ammoName === 'tipped_arrow' && NS.Potion && NS.Potion.tipFromTag)
      ? NS.Potion.tipFromTag(ammoTag) : null;

    // ── velocity — see this section's own header for what `ProjectileEntity.setVelocity` is
    // reconstructed from (no `.decomp` source for that class exists in this worktree) ────────
    var f = P.lookVec ? P.lookVec() : [0, 0, -1];
    var speed = Math.fround(pull * Use.BOW_SPEED), div = Use.BOW_DIVERGENCE;
    var rnd = pRand;
    var gx = Cb.gauss(rnd) * Cb.ARROW_GAUSS_SCALE * div;
    var gy = Cb.gauss(rnd) * Cb.ARROW_GAUSS_SCALE * div;
    var gz = Cb.gauss(rnd) * Cb.ARROW_GAUSS_SCALE * div;
    var vx = (f[0] + gx) * speed, vy = (f[1] + gy) * speed, vz = (f[2] + gz) * speed;
    // `ProjectileEntity.setVelocity`'s own tail (the same reconstructed method): the shooter's
    // OWN motion is added on top, vertical dropped while grounded.
    vx += P.vx || 0; vy += (P.onGround ? 0 : (P.vy || 0)); vz += P.vz || 0;

    var ax = P.ex, ay = (P.ey + (P.eyeHeight || P.EYE || 1.62)) - Cb.ARROW_SPAWN_BELOW_EYE, az = P.ez;
    if (!EL.canSpawn(arrowType)) return false;
    var a = EL.spawn(arrowType, ax, ay, az, { vx: vx, vy: vy, vz: vz, shooter: P, tip: tip });
    if (!a) return false;

    // ── damage/Power/Punch/Flame -- BowItem's own three enchant reads, off THIS stack directly
    // (not `Cb.arrowEnchantEffects`, which reads a MOB's `e.equip[]` array the player entity
    // never populates -- `07y_equip.js`'s own storage note) ──────────────────────────────────
    var power = Cb.enchantLevel(stack, 'power');
    var punch = Cb.enchantLevel(stack, 'punch');
    var flame = Cb.enchantLevel(stack, 'flame');
    a.arrowDamage = Cb.ARROW_BASE_DAMAGE + (power > 0 ? power * 0.5 + 0.5 : 0);
    if (punch > 0) a.punch = punch;
    if (pull === 1) a.critical = true;                          // BowItem's own `$$8 == 1.0F`
    if (flame > 0) Cb.igniteForSeconds(a, 100);                  // `setOnFireFor(100)`
    a.pickupType = pickupType;
    // loop/arrows -- `Cb.tryArrowPickup` (14j_combat.js)'s own two extra reads: WHICH item a
    // touch gives back (`ammoName`, plain/spectral/tipped -- the arrow's own ENTITY type stays
    // `arrow` even for tipped ammo, D-402) and its real Potion tag, so a picked-up tipped arrow
    // is the SAME tagged stack that was nocked, not a bare re-rolled one.
    a.pickupItem = ammoName;
    a.pickupTag = ammoTag;
    // BowItem.onStoppedUsing: ENTITY_ARROW_SHOOT, PLAYERS, volume 1, pitch 1/(rand*0.4+1.2)+pull*0.5
    if (NS.Sound && NS.Sound.play) NS.Sound.play('entity.arrow.shoot', { x: P.ex, y: P.ey, z: P.ez, volume: 1, pitch: Math.fround(1 / (pRand() * 0.4 + 1.2) + pull * 0.5), source: 'player' });

    // durability — `Use.damage`'s own creative exemption, reused as-is (the drawing hand is
    // always `P.slot`, so its `stack.d`/removal write-back is exactly this call's own target).
    Use.damage(P, stack, 1);

    // ammo consumption — skipped when `dollar9` (a non-consuming draw of a PLAIN arrow) or
    // outright creative; a real ammo stack is decremented and cleared at zero.
    if (!dollar9 && !creative && hasRealAmmo) {
      var left = (arrowStack.n | 0) - 1;
      if (left <= 0) Iv.setItem(P.inventory, arrowSlot, null);
      else { arrowStack.n = left; Iv.setItem(P.inventory, arrowSlot, arrowStack); }
      if (P.syncHotbar) P.syncHotbar();
    }

    // BowItem.java:84 `player.incrementStat(Stats.USED.getOrCreateStat(this))` -> minecraft.used:minecraft.bow
    if (NS.Stats && NS.Stats.increase && NS.Stats.statName) NS.Stats.increase(NS.Stats.statName('used', 'bow'), 1);

    return true;
  };

  /**
   * `AbstractButtonBlock.scheduledTick`, dispatched from `Behave.scheduledTick`.
   * ⚠ A WOODEN BUTTON DOES NOT JUST POP UP (cloud relaxed-curie): its branch is
   * `tryPowerWithProjectiles` — it stays down, and re-schedules itself, for as long as an arrow is
   * still inside its outline box. A stone button releases unconditionally.
   */
  Use.buttonTick = function (x, y, z) {
    if (!Use.ready) return false;
    var state = W.getBlock(x, y, z);
    if (!(state > 0) || !inCol(col.buttons, state)) return false;
    if (prop(state, 'powered') !== 'true') return false;
    if (inCol(col.woodenButtons, state)) { tryPowerWithProjectiles(x, y, z, state); return true; }
    W.setBlock(x, y, z, setProp(state, 'powered', false));
    changed(x, y, z);
    click(state, x, y, z, false);
    return true;
  };

  // ── pressure plates + a wooden button's arrow (cloud relaxed-curie, buttonrefcheck/platerefcheck) ──
  // Until this, NOTHING sensed an entity: a plate was a block you could only flip with /setblock,
  // and an arrow shot into a wooden button fell out of it at the 30-tick mark. Vanilla's shape is
  // `Entity.checkBlockCollision` (every move, every cell the box touches -> `onEntityCollision`)
  // plus each block's own scheduled re-check. Every number below is `.decomp`'s and
  // `platecheck.mjs` re-reads them from there, so a hand edit here fails the suite:
  //   AbstractPressurePlateBlock.BOX, getTickRate() 20 / WeightedPressurePlateBlock 10,
  //   Blocks.java's WeightedPressurePlateBlock(15 | 150) weights, AbstractButtonBlock's outline shapes.
  Use.PLATE_BOX = [0.125, 0, 0.125, 0.875, 0.25, 0.875];
  Use.PLATE_TICKS = 20;
  Use.WEIGHTED_TICKS = 10;
  Use.PLATE_WEIGHT = { light_weighted_pressure_plate: 15, heavy_weighted_pressure_plate: 150 };
  // AbstractButtonBlock's shapes, in 16ths, [unpressed, pressed]; wall buttons keyed by `facing`.
  Use.BUTTON_SHAPES = {
    floor_x: [[6, 0, 5, 10, 2, 11], [6, 0, 5, 10, 1, 11]],
    floor_z: [[5, 0, 6, 11, 2, 10], [5, 0, 6, 11, 1, 10]],
    ceiling_x: [[6, 14, 5, 10, 16, 11], [6, 15, 5, 10, 16, 11]],
    ceiling_z: [[5, 14, 6, 11, 16, 10], [5, 15, 6, 11, 16, 10]],
    north: [[5, 6, 14, 11, 10, 16], [5, 6, 15, 11, 10, 16]],
    south: [[5, 6, 0, 11, 10, 2], [5, 6, 0, 11, 10, 1]],
    west: [[14, 6, 5, 16, 10, 11], [15, 6, 5, 16, 10, 11]],
    east: [[0, 6, 5, 2, 10, 11], [0, 6, 5, 1, 10, 11]]
  };
  // `PersistentProjectileEntity`'s subclasses — the only things a wooden button feels.
  Use.PERSISTENT_PROJECTILES = { arrow: 1, spectral_arrow: 1, trident: 1 };

  function blockName(state) { return state > 0 ? R.names[S.block[state]] : ''; }
  /** 'weighted' | 'everything' | 'mobs' | null — PressurePlateBlock.ActivationRule by the vanilla tags. */
  function plateKind(state) {
    if (!(state > 0)) return null;
    if (Use.PLATE_WEIGHT[blockName(state)]) return 'weighted';
    if (col.woodenPlates === undefined) {
      col.woodenPlates = column('wooden_pressure_plates');
      col.stonePlates = column('stone_pressure_plates');
    }
    if (inCol(col.woodenPlates, state)) return 'everything';
    if (inCol(col.stonePlates, state)) return 'mobs';
    return null;
  }
  Use.plateKind = plateKind;

  function plateOutputOf(state) {
    return plateKind(state) === 'weighted' ? (parseInt(prop(state, 'power'), 10) || 0)
                                           : (prop(state, 'powered') === 'true' ? 15 : 0);
  }
  function withPlateOutput(state, out) {
    return plateKind(state) === 'weighted' ? setProp(state, 'power', String(out)) : setProp(state, 'powered', out > 0);
  }

  /** `World.getOtherEntities`/`getNonSpectatingEntities` over the live list and the player. */
  function entitiesIn(x0, y0, z0, x1, y1, z1, pred) {
    var out = [], EL = NS.EntityList, Ph = NS.Physics, Gm = NS.Gamemode;
    var list = (EL && EL.list) ? EL.list.slice() : [];
    if (NS.Player) list.push(NS.Player);
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (!e || e.removed) continue;
      if (e === NS.Player && Gm && Gm.isSpectator && Gm.isSpectator(e)) continue;
      var hw = (e.width !== undefined ? e.width : (Ph ? Ph.W : 0.6)) * 0.5;
      var h = e.height || (Ph ? Ph.H : 1.8);
      if (e.x - hw < x1 && e.x + hw > x0 && e.y < y1 && e.y + h > y0 && e.z - hw < z1 && e.z + hw > z0 &&
          (!pred || pred(e))) out.push(e);
    }
    return out;
  }
  function isLiving(e) { return e === NS.Player || e.maxHealth !== undefined; }

  /** `AbstractPressurePlateBlock.getRedstoneOutput(World, BlockPos)` for each subclass. */
  Use.plateSense = function (x, y, z, state) {
    var b = Use.PLATE_BOX, kind = plateKind(state);
    var es = entitiesIn(x + b[0], y + b[1], z + b[2], x + b[3], y + b[4], z + b[5],
                        kind === 'mobs' ? isLiving : null);
    if (kind === 'weighted') {
      var wt = Use.PLATE_WEIGHT[blockName(state)], n = Math.min(es.length, wt);
      return n > 0 ? Math.ceil(Math.fround(Math.fround(Math.fround(Math.min(wt, n)) / Math.fround(wt)) * 15)) : 0;   // float math: 0.2f*15f is 3.0f, not 3.00000004
    }
    for (var i = 0; i < es.length; i++) if (es[i].type !== 'bat') return 15;   // Bat.canAvoidTraps
    return 0;
  };

  /** `AbstractPressurePlateBlock.updatePlateState`. */
  function updatePlate(x, y, z, state, old) {
    var now = Use.plateSense(x, y, z, state);
    if (old !== now) {
      W.setBlock(x, y, z, withPlateOutput(state, now));
      changed(x, y, z);
      if ((now > 0) !== (old > 0)) {
        click(state, x, y, z, now > 0);
        if (NS.GameEvent) NS.GameEvent.emit(now > 0 ? 'block_press' : 'block_unpress', x + 0.5, y, z + 0.5, null);   // emitGameEvent(BLOCK_PRESS / BLOCK_UNPRESS)
      }
    }
    if (now > 0 && B && B.schedule) {
      B.schedule(x, y, z, plateKind(state) === 'weighted' ? Use.WEIGHTED_TICKS : Use.PLATE_TICKS, 0);
    }
  }

  /** `AbstractPressurePlateBlock.scheduledTick`, dispatched from `Behave.scheduledTick`. */
  Use.plateTick = function (x, y, z) {
    if (!Use.ready) return false;
    var state = W.getBlock(x, y, z);
    if (!plateKind(state)) return false;
    var old = plateOutputOf(state);
    if (old > 0) updatePlate(x, y, z, state, old);
    return true;
  };

  // ── tripwire + tripwire hook (#5610) — TripwireBlock.java / TripwireHookBlock.java, ported whole ──
  Use.TRIPWIRE_TICKS = 10;
  Use.TRIPWIRE_MAX = 42;
  Use.TRIPWIRE_SHAPES = { attached: [0, 1, 0, 16, 2.5, 16], detached: [0, 0, 0, 16, 8, 16] };
  var HDIR = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };
  var HOPP = { north: 'south', south: 'north', west: 'east', east: 'west' };
  function isNamed(state, name) { return state > 0 && R.id[name] !== undefined && S.block[state] === R.id[name]; }
  function tripPlay(ev, x, y, z, vol, pitch) {
    if (NS.Sound && NS.Sound.play) NS.Sound.play(ev, { volume: vol, pitch: pitch, x: x + 0.5, y: y + 0.5, z: z + 0.5, source: 'block' });
  }
  /** `TripwireHookBlock.playSound` */
  function hookSound(x, y, z, attached, powered, wasAttached, wasPowered) {
    if (NS.GameEvent && attached !== wasAttached) NS.GameEvent.emit(attached ? 'block_attach' : 'block_detach', x + 0.5, y, z + 0.5, null);
    if (powered && !wasPowered) tripPlay('block.tripwire.click_on', x, y, z, 0.4, 0.6);
    else if (!powered && wasPowered) tripPlay('block.tripwire.click_off', x, y, z, 0.4, 0.5);
    else if (attached && !wasAttached) tripPlay('block.tripwire.attach', x, y, z, 0.4, 0.7);
    else if (!attached && wasAttached) tripPlay('block.tripwire.detach', x, y, z, 0.4, 1.2 / (wRand() * 0.2 + 0.9));
  }
  function setQuiet(x, y, z, st) { W.setBlock(x, y, z, st); changed(x, y, z); }

  /** `TripwireHookBlock.update(world, pos, state, destroyed, updateNeighbors, stringIndex, stringOverride)` */
  Use.hookUpdate = function (x, y, z, state, destroyed, updateNeighbors, idx, override) {
    var f = prop(state, 'facing'), d = HDIR[f];
    var wasAtt = prop(state, 'attached') === 'true', wasPow = prop(state, 'powered') === 'true';
    var attached = !destroyed, anyPow = false, end = 0, strs = [];
    for (var i = 1; i < Use.TRIPWIRE_MAX; i++) {
      var px = x + d[0] * i, pz = z + d[1] * i, st = W.getBlock(px, y, pz);
      if (isNamed(st, 'tripwire_hook')) {
        if (prop(st, 'facing') === HOPP[f]) end = i;
        break;
      }
      if (!isNamed(st, 'tripwire') && i !== idx) { strs[i] = null; attached = false; continue; }
      if (i === idx && override) st = override;
      var armed = prop(st, 'disarmed') !== 'true', pw = prop(st, 'powered') === 'true';
      anyPow = anyPow || (armed && pw);
      strs[i] = st;
      if (i === idx) { if (B && B.schedule) B.schedule(x, y, z, Use.TRIPWIRE_TICKS, 0); attached = attached && armed; }
    }
    attached = attached && end > 1;
    anyPow = anyPow && attached;
    var mk = function (face) {
      return setProp(setProp(setProp((R.realFirst[R.id.tripwire_hook] + R.defaultState[R.id.tripwire_hook]), 'facing', face), 'attached', attached), 'powered', anyPow);
    };
    if (end > 0) {
      var ex = x + d[0] * end, ez = z + d[1] * end;
      setQuiet(ex, y, ez, mk(HOPP[f]));
      hookSound(ex, y, ez, attached, anyPow, wasAtt, wasPow);
    }
    hookSound(x, y, z, attached, anyPow, wasAtt, wasPow);
    if (!destroyed) setQuiet(x, y, z, mk(f));
    if (wasAtt !== attached) {
      for (var j = 1; j < end; j++) {
        var s2 = strs[j];
        if (s2) setQuiet(x + d[0] * j, y, z + d[1] * j, setProp(s2, 'attached', attached));
      }
    }
  };

  /** `TripwireBlock.update` — tell the hook at each end of a string. */
  function stringUpdate(x, y, z, state) {
    var dirs = ['south', 'west'];
    for (var k = 0; k < 2; k++) {
      var d = HDIR[dirs[k]];
      for (var i = 1; i < Use.TRIPWIRE_MAX; i++) {
        var px = x + d[0] * i, pz = z + d[1] * i, st = W.getBlock(px, y, pz);
        if (isNamed(st, 'tripwire_hook')) {
          if (prop(st, 'facing') === HOPP[dirs[k]]) Use.hookUpdate(px, y, pz, st, false, true, i, state);
          break;
        }
        if (!isNamed(st, 'tripwire')) break;
      }
    }
  }

  /** `TripwireBlock.updatePowered` */
  function stringPowered(x, y, z) {
    var state = W.getBlock(x, y, z), was = prop(state, 'powered') === 'true', now = false;
    var b = Use.TRIPWIRE_SHAPES[prop(state, 'attached') === 'true' ? 'attached' : 'detached'];
    var es = entitiesIn(x + b[0] / 16, y + b[1] / 16, z + b[2] / 16, x + b[3] / 16, y + b[4] / 16, z + b[5] / 16);
    for (var i = 0; i < es.length; i++) if (es[i].type !== 'bat') { now = true; break; }   // Entity.canAvoidTraps
    if (now !== was) {
      state = setProp(state, 'powered', now);
      setQuiet(x, y, z, state);
      stringUpdate(x, y, z, state);
    }
    if (now && B && B.schedule) B.schedule(x, y, z, Use.TRIPWIRE_TICKS, 0);
  }

  /** `scheduledTick` of both blocks, from `Behave.scheduledTick`. */
  Use.tripwireTick = function (x, y, z) {
    if (!Use.ready) return false;
    var st = W.getBlock(x, y, z);
    if (isNamed(st, 'tripwire')) { if (prop(st, 'powered') === 'true') stringPowered(x, y, z); return true; }
    if (isNamed(st, 'tripwire_hook')) { Use.hookUpdate(x, y, z, st, false, true, -1, null); return true; }
    return false;
  };

  /** onBlockAdded / onPlaced / onStateReplaced of the two blocks; `old` is the state replaced. */
  Use.tripwireChanged = function (x, y, z, old) {
    if (!Use.ready) return;
    var now = W.getBlock(x, y, z);
    var nowStr = isNamed(now, 'tripwire'), oldStr = isNamed(old, 'tripwire');
    var nowHook = isNamed(now, 'tripwire_hook'), oldHook = isNamed(old, 'tripwire_hook');
    if (nowStr && !oldStr) stringUpdate(x, y, z, now);
    else if (oldStr && !nowStr) stringUpdate(x, y, z, setProp(old, 'powered', true));
    if (nowHook && !oldHook) Use.hookUpdate(x, y, z, now, false, false, -1, null);
    else if (oldHook && !nowHook) {
      var a = prop(old, 'attached') === 'true', p = prop(old, 'powered') === 'true';
      if (a || p) Use.hookUpdate(x, y, z, old, true, false, -1, null);
    }
  };

  function buttonBox(state) {
    var face = prop(state, 'face'), facing = prop(state, 'facing');
    var xAxis = facing === 'east' || facing === 'west';
    var key = face === 'floor' ? (xAxis ? 'floor_x' : 'floor_z')
            : face === 'ceiling' ? (xAxis ? 'ceiling_x' : 'ceiling_z') : facing;
    var s = Use.BUTTON_SHAPES[key] || Use.BUTTON_SHAPES.north;
    return s[prop(state, 'powered') === 'true' ? 1 : 0];
  }

  /** `AbstractButtonBlock.tryPowerWithProjectiles`. */
  function tryPowerWithProjectiles(x, y, z, state) {
    var s = buttonBox(state);
    var hit = entitiesIn(x + s[0] / 16, y + s[1] / 16, z + s[2] / 16, x + s[3] / 16, y + s[4] / 16, z + s[5] / 16,
                         function (e) { return !!Use.PERSISTENT_PROJECTILES[e.type]; }).length > 0;
    var was = prop(state, 'powered') === 'true';
    if (hit !== was) {
      W.setBlock(x, y, z, setProp(state, 'powered', hit));
      changed(x, y, z);
      click(state, x, y, z, hit);
    }
    if (hit && B && B.schedule) B.schedule(x, y, z, Use.pressDuration(state), 0);
  }

  /** HoneyBlock.isSliding (.decomp): airborne, below the top (0.9375), falling faster than -0.08, hugging a side face. */
  Use.honeySliding = function (e, bx, by, bz) {
    if (e.onGround) return false;
    if (e.y > by + 0.9375 - 1.0E-7) return false;
    if ((e.vy || 0) >= -0.08) return false;
    var dx = Math.abs(bx + 0.5 - e.x), dz = Math.abs(bz + 0.5 - e.z);
    var lim = 0.4375 + (e.width !== undefined ? e.width : 0.6) / 2;
    return dx + 1.0E-7 > lim || dz + 1.0E-7 > lim;
  };
  /** HoneyBlock.updateSlidingVelocity: vy -> -0.05 (horizontal scaled by -0.05/vy when faster than -0.13), then onLanding. */
  Use.honeySlideVelocity = function (e) {
    var vy = e.vy || 0;
    if (vy < -0.13) { var k = -0.05 / vy; e.vx *= k; e.vz *= k; }
    e.vy = -0.05;
    e.fallDistance = 0;
  };

  /**
   * `Entity.checkBlockCollision` — called by `Physics.move` after every move: each cell the box
   * (shrunk 0.001) touches gets its block's `onEntityCollision`. Only the two families above have
   * one here; everything else is a no-op, so it costs a few `getBlock`s per moving entity.
   */
  Use.entityCollide = function (e) {
    if (!Use.ready || !e || e.removed) return;
    if (e === NS.Player && NS.Gamemode && NS.Gamemode.isSpectator && NS.Gamemode.isSpectator(e)) return;
    var Ph = NS.Physics;
    var hw = (e.width !== undefined ? e.width : (Ph ? Ph.W : 0.6)) * 0.5, h = e.height || (Ph ? Ph.H : 1.8);
    var x0 = Math.floor(e.x - hw + 0.001), x1 = Math.floor(e.x + hw - 0.001);
    var y0 = Math.floor(e.y + 0.001), y1 = Math.floor(e.y + h - 0.001);
    var z0 = Math.floor(e.z - hw + 0.001), z1 = Math.floor(e.z + hw - 0.001);
    for (var bx = x0; bx <= x1; bx++) for (var by = y0; by <= y1; by++) for (var bz = z0; bz <= z1; bz++) {
      var st = W.getBlock(bx, by, bz);
      if (!(st > 0)) continue;
      if (e === NS.Player && NS.Adv && NS.Adv.trigger && e.advancements)    // ServerPlayerEntity.onBlockCollision
        NS.Adv.trigger(e, 'minecraft:enter_block', { block: 'minecraft:' + R.names[S.block[st]], prop: function (n) { return prop(st, n); } });
      if (e.type === 'item' && R.id.hopper !== undefined && S.block[st] === R.id.hopper) {
        if (NS.BlockEntities && NS.BlockEntities.hopperEntityCollided)    // HopperBlock.onEntityCollision
          NS.BlockEntities.hopperEntityCollided(NS.BlockEntities.get(bx, by, bz), e);
      } else if (R.id.cobweb !== undefined && S.block[st] === R.id.cobweb) {
        if (Ph && Ph.slowMovement) Ph.slowMovement(e, [0.25, 0.05, 0.25], true);   // CobwebBlock.onEntityCollision
      } else if (R.id.sweet_berry_bush !== undefined && S.block[st] === R.id.sweet_berry_bush) {
        // SweetBerryBushBlock.onEntityCollision: living, not fox/bee -> slow (0.8,0.75,0.8); age>0 and
        // moved >= 0.003 horizontally since last tick -> 1 damage.
        if (isLiving(e) && e.type !== 'fox' && e.type !== 'bee') {
          if (Ph && Ph.slowMovement) Ph.slowMovement(e, [0.8, 0.75, 0.8]);
          if (has(st, 'age') && prop(st, 'age') !== '0' && e.px !== undefined &&
              (Math.abs(e.x - e.px) >= 0.003 || Math.abs(e.z - e.pz) >= 0.003)) {
            if (e === NS.Player) { if (NS.Survival && NS.Survival.hurt) NS.Survival.hurt(e, 'sweetBerryBush', 1); }
            else if (NS.Combat && NS.Combat.hurt) NS.Combat.hurt(e, 1, undefined, false, { source: 'sweetBerryBush' });
          }
        }
      } else if (R.id.powder_snow !== undefined && S.block[st] === R.id.powder_snow) {
        // PowderSnowBlock.entityInside: non-living, or feet inside the block -> stuck (0.9,1.5,0.9); a burning
        // entity is put out and (mobGriefing or player) the block is destroyed.
        var feetIn = W.getBlock(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z)) === st;
        if (!isLiving(e) || feetIn) { if (Ph && Ph.slowMovement) Ph.slowMovement(e, [Math.fround(0.9), 1.5, Math.fround(0.9)]); }
        e.inPowderSnow = true;
        if (e.isOnFire || e.remainingFireTicks > 0) {
          var grief = e === NS.Player || !NS.EntityList || !NS.EntityList.aiCtx || NS.EntityList.aiCtx(e).mobGriefing();
          if (grief) { W.setBlock(bx, by, bz, 0); changed(bx, by, bz); }
          e.remainingFireTicks = 0; e.isOnFire = false;
        }
      } else if (R.id.cactus !== undefined && S.block[st] === R.id.cactus) {
        // CactusBlock.entityInside: entity.hurt(DamageSource.CACTUS, 1.0F); invulnerableTime gates repeats.
        if (e === NS.Player) { if (NS.Survival && NS.Survival.hurt) NS.Survival.hurt(e, 'cactus', 1); }
        else if (NS.Combat && NS.Combat.hurt) NS.Combat.hurt(e, 1, undefined, false, { source: 'cactus' });
      } else if (R.id.honey_block !== undefined && S.block[st] === R.id.honey_block) {
        // HoneyBlock.onEntityCollision (slide particles owed)
        if (Use.honeySliding(e, bx, by, bz)) {
          // triggerAdvancement: a server player, once per second of game time
          if (e === NS.Player && NS.Adv && NS.Adv.trigger && ((B && B.gameTime) | 0) % 20 === 0)
            NS.Adv.trigger(e, 'minecraft:slide_down_block', { player: e, state: { id: R.names[S.block[st]], state: {} } });
          Use.honeySlideVelocity(e);
          if (wRand() < 0.2 && NS.Sound && NS.Sound.play)
            NS.Sound.play('block.honey_block.slide', { volume: 1, pitch: 1, x: e.x, y: e.y, z: e.z, source: 'block' });
        }
      } else if (R.id.bubble_column !== undefined && S.block[st] === R.id.bubble_column) {
        // BubbleColumnBlock.onEntityCollision: air above -> Entity.onBubbleColumnSurfaceCollision (+ splash/bubble
        // particles), else Entity.onBubbleColumnCollision (vy clamp, then onLanding = fallDistance 0).
        var drag = prop(st, 'drag') === 'true', vy0 = e.vy || 0;
        if (W.getBlock(bx, by + 1, bz) === 0) {
          if (e.type === 'boat' && NS.Boat) NS.Boat.onBubbleColumnSurfaceCollision(e, drag);
          else e.vy = drag ? Math.max(-0.9, vy0 - 0.03) : Math.min(1.8, vy0 + 0.1);
          var Px = NS.Particle;
          if (Px && Px.spawn) for (var pi = 0; pi < 2; pi++) {
            Px.spawn('bubble_column_up', bx + wRand(), by + 1, bz + wRand(), 0, 0, 0);
            Px.spawn('splash', bx + wRand(), by + 1, bz + wRand(), 0, 0.01, 0);
          }
        } else {
          e.vy = drag ? Math.max(-0.3, vy0 - 0.03) : Math.min(0.7, vy0 + 0.06);
          e.fallDistance = 0;
        }
      } else if (R.id.lily_pad !== undefined && S.block[st] === R.id.lily_pad) {
        // LilyPadBlock.onEntityCollision: only a BoatEntity (server world) breaks it: world.breakBlock(pos, true, entity)
        if (e.type === 'boat') Use.breakForFluid(bx, by, bz, st);
      } else if (R.id.water_cauldron !== undefined && (S.block[st] === R.id.water_cauldron || S.block[st] === R.id.powder_snow_cauldron || S.block[st] === R.id.lava_cauldron)) {
        // LayeredCauldronBlock/LavaCauldronBlock.entityInside: isEntityInsideContent = y < pos.y + (6+level*3)/16 && maxY > pos.y + 0.25
        var isLava = S.block[st] === R.id.lava_cauldron, clv = isLava ? 3 : parseInt(prop(st, 'level'), 10) || 1;
        if (e.y < by + (6 + clv * 3) / 16 && e.y + h > by + 0.25) {
          var Cb = NS.Combat;
          if (isLava) {
            if (Cb && Cb.igniteForSeconds && !(Cb.fireImmuneOf && Cb.fireImmuneOf(e))) {
              Cb.igniteForSeconds(e, 15);                                   // Entity.lavaHurt: setOnFireFor(15) + LAVA 4
              if (e === NS.Player) { if (NS.Survival && NS.Survival.hurt) NS.Survival.hurt(e, 'lava', 4); }
              else if (Cb.hurt) Cb.hurt(e, 4, undefined, false, { source: 'lava', fire: true });
            }
          } else if (e.isOnFire) {
            e.remainingFireTicks = 0; e.isOnFire = false;                   // clearFire
            var lowered = clv > 1 ? setProp(st, 'level', String(clv - 1)) : S.stateOf('cauldron');
            W.setBlock(bx, by, bz, lowered);                                // handleEntityOnFireInside: lowerFillLevel
            if (S.block[st] === R.id.water_cauldron) playAt('entity.generic.extinguish_fire', bx, by, bz);
          }
        }
      } else if (isNamed(st, 'tripwire')) {
        if (prop(st, 'powered') !== 'true') stringPowered(bx, by, bz);   // TripwireBlock.onEntityCollision
      } else if (plateKind(st)) {
        var old = plateOutputOf(st);
        if (old === 0) updatePlate(bx, by, bz, st, old);
      } else if (inCol(col.woodenButtons, st) && prop(st, 'powered') !== 'true') {
        tryPowerWithProjectiles(bx, by, bz, st);
      }
    }
  };
})(MCL);
