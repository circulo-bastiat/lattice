// 07c_blockentity.js — PLAN G2 layer 5: block entities.
// Runs on: MAIN THREAD ONLY. No DOM.
//
// A block entity is the state a BLOCK STATE cannot hold: a chest's 27 stacks, a furnace's burn
// and cook counters, a sign's four lines, a spawner's mob and timer, a hopper's cooldown. The
// world stores one 16-bit real state per cell (02c's header), so all of that lives here, in a
// per-chunk map keyed by position — which is also how vanilla stores it.
//
// ⚠ **WHICH BLOCKS HAVE ONE IS COMPILED JAVA, AND THIS TABLE IS THEREFORE HAND-SOURCED**
// (D-208). `BlockEntityType.java` registers 34 types against explicit block lists; there is no
// tag, no `blocks.json` field and nothing in the jar's data that names them. Four of the lists
// ARE tags and are read as tags — `signs`, `beds`, `banners`, `shulker_boxes`, `campfires` — and
// the rest are named here. A wrong entry is visible (a chest with no inventory, or a stone block
// that thinks it has one) rather than silent, and `behavcheck` §6 asserts every named block
// exists in the registry, so a rename cannot rot the list into silence.
//
// What is NOT here, and why: the BEHAVIOUR of most of these. A furnace's smelting needs G9's
// recipes, a hopper's transfer needs G8's slot model, a spawner needs G18's mobs. This stage
// owns the STORE — creation, destruction, persistence shape and the tick loop — and each type
// carries the fields its owner stage will fill. `Furnace.tick` below is the exception: its burn
// and cook counters are pure timing, they are the part that is G2's, and they run now.
(function (NS) {
  'use strict';

  var BE = NS.BlockEntities = {};
  BE.ready = false;

  /**
   * The 1.18.2 block-entity types. Each entry is `[type, blocks..., '#tag'...]`; a `#name` entry
   * is resolved through PLAN G1's tag registry, which is why the sign, bed, banner, shulker and
   * campfire families are one token each instead of 60 hand-typed names.
   */
  var TYPES = [
    ['furnace', 'furnace'],
    ['blast_furnace', 'blast_furnace'],
    ['smoker', 'smoker'],
    ['chest', 'chest'],
    ['trapped_chest', 'trapped_chest'],
    ['ender_chest', 'ender_chest'],
    ['barrel', 'barrel'],
    ['hopper', 'hopper'],
    ['dropper', 'dropper'],
    ['dispenser', 'dispenser'],
    ['brewing_stand', 'brewing_stand'],
    ['enchanting_table', 'enchanting_table'],
    ['beacon', 'beacon'],
    ['jukebox', 'jukebox'],
    ['mob_spawner', 'spawner'],
    ['piston', 'moving_piston'],
    ['command_block', 'command_block', 'chain_command_block', 'repeating_command_block'],
    ['structure_block', 'structure_block'],
    ['jigsaw', 'jigsaw'],
    ['comparator', 'comparator'],
    ['daylight_detector', 'daylight_detector'],
    ['end_portal', 'end_portal'],
    ['end_gateway', 'end_gateway'],
    ['conduit', 'conduit'],
    ['bell', 'bell'],
    ['lectern', 'lectern'],
    ['sculk_sensor', 'sculk_sensor'],
    ['skull', 'skeleton_skull', 'skeleton_wall_skull', 'wither_skeleton_skull',
      'wither_skeleton_wall_skull', 'zombie_head', 'zombie_wall_head', 'player_head',
      'player_wall_head', 'creeper_head', 'creeper_wall_head', 'dragon_head', 'dragon_wall_head'],
    ['beehive', 'beehive', 'bee_nest'],
    ['sign', '#signs', '#wall_signs', '#standing_signs'],
    ['bed', '#beds'],
    ['banner', '#banners'],
    ['shulker_box', '#shulker_boxes'],
    ['campfire', '#campfires'],
  ];

  var typeOfBlock = null;      // block index -> type name
  var storeByChunk = null;     // chunk key -> Map(packed pos -> entity)

  BE.missing = [];

  BE.init = function () {
    var R = NS.Reg;
    if (!R || !R.ready) { BE.ready = false; return BE; }
    typeOfBlock = Object.create(null);
    BE.missing = [];
    BE.typeCount = 0;
    for (var i = 0; i < TYPES.length; i++) {
      var row = TYPES[i], type = row[0], any = false;
      for (var j = 1; j < row.length; j++) {
        var token = row[j];
        if (token.charCodeAt(0) === 35) {
          var list = (NS.Tags && NS.Tags.ready) ? NS.Tags.blocks(token) : null;
          if (!list) continue;
          for (var k = 0; k < list.length; k++) {
            var bi = R.id[list[k]];
            if (bi !== undefined) { typeOfBlock[bi] = type; any = true; }
          }
        } else {
          var b = R.id[token];
          if (b === undefined) { BE.missing.push(type + '/' + token); continue; }
          typeOfBlock[b] = type; any = true;
        }
      }
      if (any) BE.typeCount++;
    }
    storeByChunk = new Map();
    BE.ready = true;
    return BE;
  };

  /** The block-entity type a block has, or undefined. */
  BE.typeOf = function (block) { return typeOfBlock ? typeOfBlock[block] : undefined; };
  BE.stateHasEntity = function (state) {
    return state !== 0 && NS.States.ready && BE.typeOf(NS.States.block[state]) !== undefined;
  };

  function chunkKey(x, z) { return ((x >> 4) & 0x3FFFFF) * 4194304 + ((z >> 4) & 0x3FFFFF); }
  function posKey(x, y, z) { return (x & 15) | ((z & 15) << 4) | ((y + 64) << 8); }

  /** A fresh entity of one type, with the fields its owning stage will use. */
  function make(type, x, y, z) {
    var e = { type: type, x: x, y: y, z: z };
    switch (type) {
      case 'chest': case 'trapped_chest': case 'barrel': case 'shulker_box': case 'ender_chest':
        e.items = new Array(27); e.open = 0; break;
      case 'hopper':
        e.items = new Array(5); e.cooldown = 0; break;                    // 8 ticks, set on transfer
      case 'dropper': case 'dispenser':
        e.items = new Array(9); break;
      // `BrewingStandBlockEntity` — 0..2 the bottles, 3 the ingredient, 4 the blaze powder; `brewTime`
      // counts DOWN from 400 and `fuel` is 0..20 (the two properties its menu shows). The brewing
      // TICK itself is G23's.
      case 'brewing_stand':
        e.items = new Array(5); e.brewTime = 0; e.fuel = 0; break;
      case 'furnace': case 'blast_furnace': case 'smoker':
        // burnTime counts DOWN from the fuel's value; cookTime counts UP to cookTimeTotal.
        // 200 ticks is the furnace's, 100 the blast furnace's and the smoker's — the value comes
        // from the recipe (`cookingtime`) in G9, and this is the default the recipe overrides.
        e.items = new Array(3); e.burnTime = 0; e.burnDuration = 0; e.cookTime = 0;
        e.cookTimeTotal = (type === 'furnace') ? 200 : 100; e.recipesUsed = {}; break;
      case 'command_block': e.command = ''; e.trackOutput = true; e.lastOutput = null; e.successCount = 0; e.auto = false; e.powered = false; e.conditionMet = false; break;
      case 'sign': e.lines = ['', '', '', '']; e.color = 'black'; e.glowing = false; break;
      // D-395 — BaseSpawner's own field defaults (1.18.2): spawnDelay starts at 20
      // (re-rolled to [minDelay,maxDelay] after its first tick), spawnRange 4, spawnCount 4,
      // maxNearbyEntities 6, requiredPlayerRange 16 — every one a public default field on
      // BaseSpawner, not something that varies by mob or by block state.
      case 'mob_spawner':
        e.entity = 'pig'; e.delay = 20; e.minDelay = 200; e.maxDelay = 800; e.count = 4;
        e.spawnRange = 4; e.maxNearbyEntities = 6; e.requiredPlayerRange = 16; break;
      case 'beehive': e.bees = []; e.honeyLevel = 0; break;
      case 'banner': e.patterns = []; break;
      case 'bed': e.color = 'red'; break;
      case 'campfire': e.items = new Array(4); e.cookingTimes = [0, 0, 0, 0]; break;
      case 'beacon': e.levels = 0; e.primary = null; e.secondary = null; break;
      case 'lectern': e.book = null; e.page = 0; break;
      case 'jukebox': e.record = null; break;
      case 'skull': e.owner = null; break;
      case 'end_gateway': e.age = 0; e.teleportCooldown = 0; e.exitPortal = null; e.exactTeleport = false; break;
      case 'bell': e.ringing = false; e.ticks = 0; break;
      // `ConduitBlockEntity` — `ticks` counts every tick, `ticksActive` only the active ones (the
      // renderer's spin), `active`/`eyeOpen` are re-scanned every 40th game tick from the frame.
      case 'conduit': e.ticks = 0; e.ticksActive = 0; e.active = false; e.eyeOpen = false; e.frame = []; break;
      // PLAN G15b — `ComparatorBlockEntity.outputSignal`. A comparator's block state carries
      // one boolean; the 0..15 it actually emits lives here, which is vanilla's own split and
      // the reason a comparator can hold 7 while its state says only "on" (D-297).
      case 'comparator': e.output = 0; break;
      // PLAN G15c — `PistonMovingBlockEntity`. `movedState` is the block in flight, `progress`
      // the 0 -> 1 the two-tick animation walks, `source` marks the piston HEAD's own entity
      // rather than a block being carried (D-298).
      case 'piston':
        e.movedState = undefined; e.dir = 0; e.extending = true; e.source = false;
        e.progress = 0; e.lastProgress = 0; break;
      default: break;
    }
    return e;
  }

  BE.get = function (x, y, z) {
    if (!BE.ready) return undefined;
    var m = storeByChunk.get(chunkKey(x, z));
    return m ? m.get(posKey(x, y, z)) : undefined;
  };

  BE.create = function (x, y, z, type) {
    var ck = chunkKey(x, z);
    var m = storeByChunk.get(ck);
    if (!m) { m = new Map(); storeByChunk.set(ck, m); }
    var e = make(type, x, y, z);
    m.set(posKey(x, y, z), e);
    return e;
  };

  /**
   * `AbstractFurnaceBlock.onStateReplaced` (.decomp:66-76) -> `getRecipesUsedAndDropExperience`
   * (AbstractFurnaceBlockEntity.java:468-480): the unclaimed recipesUsed ledger drops as orbs at
   * the block centre when a furnace/blast furnace/smoker is removed or replaced.
   */
  BE.popFurnaceXp = function (e) {
    if (!e || !e.recipesUsed || (e.type !== 'furnace' && e.type !== 'blast_furnace' && e.type !== 'smoker')) return 0;
    var M = NS.Menu, total = M && M.furnaceAwardXp ? M.furnaceAwardXp(e, null) : 0;
    if (total > 0 && NS.Xp && NS.Xp.ready) NS.Xp.spawn(e.x + 0.5, e.y + 0.5, e.z + 0.5, total);
    return total;
  };

  BE.remove = function (x, y, z) {
    var m = storeByChunk.get(chunkKey(x, z));
    if (!m) return false;
    return m.delete(posKey(x, y, z));
  };

  /**
   * Called from `Behave.changed` at the one place a block can change. Creating and destroying the
   * entity HERE rather than at each call site is the same argument `World.setBlock` makes for the
   * save journal: a future caller that forgets cannot leave a chest's contents attached to a
   * cell that is now air.
   */
  BE.onChanged = function (x, y, z, state) {
    if (!BE.ready) return;
    var want = state === 0 ? undefined : BE.typeOf(NS.States.block[state]);
    var have = BE.get(x, y, z);
    var isNewSkull = !!want && want === 'skull' && (!have || have.type !== 'skull');
    if (!want) { if (have) { BE.popFurnaceXp(have); BE.remove(x, y, z); } return; }
    if (!have) { BE.create(x, y, z, want); }
    else if (have.type !== want) { BE.popFurnaceXp(have); BE.remove(x, y, z); BE.create(x, y, z, want); }
    // D-803 -- `WitherSkullBlock.onPlaced` (.decomp net/minecraft/block/WitherSkullBlock.java:
    // 34-85, read whole) runs the ONE in-play caller of `Wi.onSummoned` right after a skull
    // block ENTITY is freshly created -- exactly the moment `BE.onChanged` above just handled.
    // Gated on the newly-placed state actually being a wither skull (standing OR wall variant)
    // the same way `$$4` above does before it ever builds/searches a `BlockPattern`.
    if (isNewSkull) {
      var skullName = NS.States.name ? NS.States.name(state) : '';
      if (skullName === 'wither_skeleton_skull' || skullName === 'wither_skeleton_wall_skull') {
        BE.checkWitherSummon(x, y, z);
      }
    }
  };

  /**
   * `WitherSkullBlock.onPlaced` / `getWitherBossPattern` (.decomp, read whole): the real
   * soul-sand(or soul-soil)-plus-3-skull structure. Ported as the SAME 3-row aisle the jar's own
   * `BlockPatternBuilder` describes ("^^^" / "###" / "~#~", read top-to-bottom): a 3-wide row of
   * `wither_skeleton_skull`/`wither_skeleton_wall_skull` states directly above a 3-wide row of
   * `#wither_summon_base_blocks` states, with ONE MORE `#wither_summon_base_blocks` state below
   * the row's own MIDDLE column and AIR below its two ends -- rather than a guessed "any 3
   * skulls near any soul sand" shape. Tries both horizontal axes (a row can run east-west or
   * north-south, `Direction.Axis.field_11048`/its perpendicular -- vanilla's own multi-facing
   * `searchAround`) and all three positions the JUST-PLACED skull (`x,y,z`) could occupy within
   * that row (either end, or the middle) -- the jar does not know in advance which one a player
   * just placed either, hence its own `BlockPattern.searchAround`. On a match: clears the whole
   * 3x3 pattern to air (`$$0.setBlockState(..., AIR, 2)`, the SAME 9-cell grid the jar's own
   * double loop walks -- the two already-air bottom corners are a harmless no-op) and spawns a
   * REAL `wither` through `EL.spawn` centred over the row's middle column, `Wi.onSummoned`
   * (loop/wither-invuln) applied immediately after -- the jar's own `$$10.onSummoned()` call,
   * right before `spawnEntity`. `bodyYaw`/`yaw` mirror `$$6.getForwards().getAxis() ==
   * Direction.Axis.field_11048 ? 0.0F : 90.0F` (X-axis row faces 0 deg, Z-axis row faces 90).
   * Difficulty PEACEFUL and a skull placed below the world's own bottom Y both refuse to search
   * at all (`$$0.getDifficulty() != Difficulty.field_5801`, `$$1.getY() >= $$0.getBottomY()`).
   */
  BE.checkWitherSummon = function (x, y, z) {
    var W = NS.World, S = NS.States, T = NS.Tags, Wi = NS.Wither, EL = NS.EntityList;
    if (!W || !S || !T || !T.ready || !Wi || !Wi.ready || !EL || !EL.ready) return false;
    if (NS.Diff && NS.Diff.isPeaceful && NS.Diff.isPeaceful()) return false;
    var minY = (NS.CFG && NS.CFG.WORLD_MIN_Y !== undefined) ? NS.CFG.WORLD_MIN_Y : -64;
    if (y < minY) return false;
    function isSkull(sx, sy, sz) {
      var n = S.name(W.getBlock(sx, sy, sz));
      return n === 'wither_skeleton_skull' || n === 'wither_skeleton_wall_skull';
    }
    function isBase(sx, sy, sz) {
      return T.stateIn('wither_summon_base_blocks', W.getBlock(sx, sy, sz));
    }
    function isAir(sx, sy, sz) { return W.getBlock(sx, sy, sz) === 0; }

    var AXES = [{ dx: 1, dz: 0, yaw: Math.PI / 2 }, { dx: 0, dz: 1, yaw: 0 }];
    for (var a = 0; a < AXES.length; a++) {
      var dx = AXES[a].dx, dz = AXES[a].dz;
      for (var idx = 0; idx < 3; idx++) {
        var ox = x - idx * dx, oz = z - idx * dz;   // row origin (column 0), y stays the skull's own
        var ok = true;
        for (var i = 0; i < 3 && ok; i++) { if (!isSkull(ox + i * dx, y, oz + i * dz)) ok = false; }
        for (var j = 0; j < 3 && ok; j++) { if (!isBase(ox + j * dx, y - 1, oz + j * dz)) ok = false; }
        if (ok && !isBase(ox + dx, y - 2, oz + dz)) ok = false;                 // middle pedestal
        if (ok && !isAir(ox, y - 2, oz)) ok = false;                            // left end, air
        if (ok && !isAir(ox + 2 * dx, y - 2, oz + 2 * dz)) ok = false;          // right end, air
        if (!ok) continue;

        // Real match: clear the whole 3x3 pattern (skull row + base row + the two-cell-plus-
        // pedestal bottom row) to air, same as `$$0.setBlockState(..., AIR, 2)` above.
        var cells = [[ox + dx, y - 2, oz + dz]];
        for (var cx = 0; cx < 3; cx++) { cells.push([ox + cx * dx, y, oz + cx * dz], [ox + cx * dx, y - 1, oz + cx * dz]); }
        cells.forEach(function (c) {   // setBlockState(AIR, 2) + syncWorldEvent(2001, pos, rawId)
          var st = W.getBlock(c[0], c[1], c[2]);
          if (NS.Sound && NS.Sound.blockBreak) NS.Sound.blockBreak(st, c[0] + 0.5, c[1] + 0.5, c[2] + 0.5, null);
          if (NS.Particle && NS.Particle.addBlockBreakParticles) NS.Particle.addBlockBreakParticles(c[0], c[1], c[2], st, null);
          W.setBlock(c[0], c[1], c[2], 0);
        });

        var midX = ox + dx, midZ = oz + dz;
        var w = EL.spawn('wither', midX + 0.5, y + 0.55, midZ + 0.5, {});
        if (w) {
          w.yaw = AXES[a].yaw; w.yBodyRot = AXES[a].yaw;   // vanilla WitherSkullBlock.onPlaced: row along X -> 90deg
          Wi.onSummoned(w);
          // Criteria.SUMMONED_ENTITY for players within the pattern box expanded by 50
          var P = NS.Player;
          if (P && !(NS.Gamemode && NS.Gamemode.isSpectator(P)) && NS.Adv && NS.Adv.trigger &&
              Math.abs(P.x - (midX + 0.5)) <= (dx ? 51.5 : 50.5) && Math.abs(P.z - (midZ + 0.5)) <= (dz ? 51.5 : 50.5) &&
              P.y >= y - 52 && P.y <= y + 51)
            NS.Adv.trigger(P, 'minecraft:summoned_entity', { entity: w });
        }
        if (NS.Behave && NS.Behave.changed) cells.forEach(function (c) { NS.Behave.changed(c[0], c[1], c[2], 0); });   // updateNeighbors(pos, AIR)
        return true;
      }
    }
    return false;
  };

  BE.count = function () {
    var n = 0;
    if (storeByChunk) storeByChunk.forEach(function (m) { n += m.size; });
    return n;
  };
  BE.forEach = function (fn) {
    if (storeByChunk) storeByChunk.forEach(function (m) { m.forEach(fn); });
  };
  BE.dropChunk = function (cx, cz) {
    if (storeByChunk) storeByChunk.delete((cx & 0x3FFFFF) * 4194304 + (cz & 0x3FFFFF));
  };
  BE.clear = function () { if (storeByChunk) storeByChunk.clear(); };

  /**
   * One game tick over every ticking entity.
   *
   * ⚠⚠ THE TWO HOOKS THIS FUNCTION USED TO CALL WERE NEVER FILLED (session 9, D-289). G2 left
   * `BE.smeltResult` and `BE.fuelValue` for "the later stage", G9 then shipped 1,058 recipes and
   * the compiled-Java fuel map (D-269) — and nothing ever assigned either hook. `BE.smeltResult`
   * was `undefined` in every build, so `recipe` was always null and NO FURNACE HAS EVER SMELTED
   * ANYTHING. `behavcheck` was green across it because it supplied its own two-item stub and
   * then set both back to null: it proved the COUNTERS, honestly said so, and nobody asked who
   * filled the hooks in the game. A hook is a promise, and an unkept one looks exactly like a
   * working feature from inside the module that offers it.
   *
   * The hooks are GONE (D-139 — the replaced thing is deleted, not left beside its replacement).
   * `tickFurnace` now calls `Recipes.cookingFor` and `Recipes.fuelTime` directly, which is what
   * G9 built them for, and `behavcheck` runs against those real tables rather than a fake.
   */
  // ── THE CHEST LID (D-421) ───────────────────────────────────────────────────────────────
  //
  // ⚠⚠ **A PLACED CHEST HAS NEVER BEEN DRAWN AT ALL**, and this is half of why: `chest`'s block
  // model is `builtin/entity` and bakes ZERO quads (measured: `stone` bakes 6, `chest`,
  // `trapped_chest`, `ender_chest`, every bed, every banner, every sign and every shulker box
  // bake 0), so the mesher has never had anything to put in a section. Vanilla draws them from a
  // BLOCK-ENTITY RENDERER instead, and a block-entity renderer needs a lid angle, which needs a
  // lid CONTROLLER, which is this.
  //
  // ⚠ **THE LAW IS THE JAR'S** (`cmx`, ChestLidController, disassembled this session — the
  // container did the javap, STATE §0's sanctioned reason). It is three fields and one method:
  //
  //     latch = openness;                                              // the PREVIOUS tick's value
  //     if (!shouldBeOpen && openness > 0) openness = max(openness - 0.1, 0);
  //     else if (shouldBeOpen && openness < 1) openness = min(openness + 0.1, 1);
  //     getOpenness(partial) = lerp(partial, latch, openness)
  //
  // so a chest takes exactly TEN TICKS to open and ten to close, and the renderer reads a value
  // interpolated between two ticks rather than the tick's own — which is why a vanilla lid is
  // smooth at 60 fps off a 20 Hz simulation. Storing `latch` is not an optimisation: drop it and
  // the lid moves in ten visible steps.
  //
  // ⚠ `e.open` — the opener COUNT `Hud.openChest` already increments and `Hud.open` already
  // decrements (D-403/D-413) — is `shouldBeOpen`. Nothing new counts openers; this reads the
  // counter that has been maintained since the chest screen shipped.
  BE.LID_STEP = Math.fround(0.1);

  /** The block-entity types whose lid animates. ⚠ The shulker box is NOT one of them: vanilla
   *  animates it through `ShulkerBoxBlockEntity`'s own progress/progressOld pair with a
   *  different curve and a peek offset, and claiming this controller for it would be a guess.
   *  `BE.LID_OWED` names that rather than leaving it silent. */
  var LID = { chest: 1, trapped_chest: 1, ender_chest: 1 };
  BE.LID_OWED = [];
  /**
   * `BarrelBlockEntity.openersCounter` (onOpen/onClose): the opener count `e.open` going 0 -> n flips
   * BarrelBlock.OPEN true and plays block.barrel.open, n -> 0 flips it back and plays block.barrel.close,
   * at the block centre pushed half a block toward FACING, volume 0.5, pitch 0.9 + 0.1 * random.
   * The state lives in the world, so a chunk reload keeps it; `barrelWas` is only the edge detector.
   */
  var BARREL_DIR = { north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0], up: [0, 1, 0], down: [0, -1, 0] };
  /** ViewerCountManager / ChestStateManager onOpen/onClose: first opener emits CONTAINER_OPEN (SHULKER_OPEN), last closer the close. */
  BE.openEdge = function (e) {
    var now = (e.open | 0) > 0;
    if (now === !!e.geOpenWas) return;
    e.geOpenWas = now;
    var G = NS.GameEvent;
    if (!G || !G.emit) return;
    var sb = e.type === 'shulker_box';
    G.emit(now ? (sb ? 'shulker_open' : 'container_open') : (sb ? 'shulker_close' : 'container_close'), e.x + 0.5, e.y + 0.5, e.z + 0.5, null);
  };
  BE.barrelSync = function (e) {
    BE.openEdge(e);
    var now = (e.open | 0) > 0;
    if (now === !!e.barrelWas) return;
    e.barrelWas = now;
    var B = NS.Behave;
    if (!B || !B.w || !B.setProp) return;
    var st = B.w.get(e.x, e.y, e.z);
    if (st === 0 || BE.typeOf(NS.States.block[st]) !== 'barrel') return;
    var d = BARREL_DIR[B.propName(st, 'facing')] || BARREL_DIR.north;
    B.w.set(e.x, e.y, e.z, B.setProp(st, 'open', now));
    if (NS.Sound && NS.Sound.play) {
      var rf = (NS.EntityList && NS.EntityList.random) || Math.random;
      NS.Sound.play(now ? 'block.barrel.open' : 'block.barrel.close', {
        x: e.x + 0.5 + d[0] / 2, y: e.y + 0.5 + d[1] / 2, z: e.z + 0.5 + d[2] / 2,
        source: 'block', volume: 0.5, pitch: rf() * 0.1 + 0.9 });
    }
  };
  /**
   * #887 -- `ShulkerBoxBlockEntity`'s own controller (.decomp:63-94, 130-145): a 4-stage machine,
   * `sbStage` 0 closed / 1 opening / 2 opened / 3 closing, `sbProg` moving 0.1f a tick (float32, as
   * `tickLid`'s note). The viewer count reaches it as vanilla's synced block event: 0 starts closing,
   * exactly 1 starts opening, anything else changes nothing. `e.open` is the opener count.
   */
  BE.tickShulkerBox = function (e) {
    BE.openEdge(e);
    var v = e.open | 0, was = e.sbViewers | 0;
    if (v !== was) {
      e.sbViewers = v;
      if (v === 0) e.sbStage = 3; else if (v === 1) e.sbStage = 1;
    }
    e.sbProgO = e.sbProg || 0;
    var p = e.sbProg || 0, st = e.sbStage | 0;
    if (st === 0) p = 0;
    else if (st === 1) { p = Math.fround(p + BE.LID_STEP); if (p >= 1) { e.sbStage = 2; p = 1; } }
    else if (st === 3) { p = Math.fround(p - BE.LID_STEP); if (p <= 0) { e.sbStage = 0; p = 0; } }
    else p = 1;
    e.sbProg = p;
  };
  /** `getAnimationProgress(partial)`: a plain lerp of the two ticks. */
  BE.shulkerProgress = function (e, partial) {
    var a = e.sbProgO === undefined ? (e.sbProg || 0) : e.sbProgO, b = e.sbProg || 0;
    return a + (b - a) * partial;
  };

  BE.hasLid = function (type) { return LID[type] === 1; };

  /**
   * `ChestLidController.tickLid` — the jar's, above.
   *
   * ⚠⚠ **IN FLOAT32, AND THAT IS NOT PEDANTRY — IT IS A WHOLE TICK.** `openness` is a Java
   * `float`, and `0.1f` is 0.100000001490116, which is slightly MORE than a tenth: ten of them
   * land on 1.0 exactly and the lid is open on tick ten. JavaScript's number is a double, and
   * 0.1 there is slightly LESS than a tenth: ten of them land on 0.9999999999999999, the clamp
   * never fires, and the chest takes ELEVEN ticks to open — 10% slow, in both directions, for
   * as long as the engine lives. `beworldcheck` §2 counts the ticks, which is how this was
   * found rather than argued about. `Math.fround` is the whole fix.
   */
  BE.tickLid = function (e) {
    BE.openEdge(e);
    var o = e.lid || 0;
    e.lidLatch = o;
    if (!((e.open | 0) > 0)) { if (o > 0) e.lid = Math.max(Math.fround(o - BE.LID_STEP), 0); }
    else if (o < 1) e.lid = Math.min(Math.fround(o + BE.LID_STEP), 1);
  };

  /** `ChestLidController.getOpenness(partial)` — the lerp, for the renderer's own frame. */
  BE.lidOpenness = function (e, partial) {
    var a = e.lidLatch === undefined ? (e.lid || 0) : e.lidLatch, b = e.lid || 0;
    return a + (b - a) * partial;
  };

  /**
   * Every block entity in the chunks within `rc` chunks of the cell `(x, z)`, for a caller that
   * wants what is NEAR it rather than every block entity in the world.
   *
   * ⚠ IT EXISTS BECAUSE THE RENDERER IS A PER-FRAME CALLER. `BE.forEach` walks the whole store,
   * which is the right shape for `BE.tick` (every one of them ticks) and the wrong shape for a
   * draw loop that only ever wants a 64-block ball: a player with a big base would pay for every
   * chest they have ever placed, sixty times a second, to draw the nine in front of them.
   */
  BE.forEachNear = function (x, z, rc, fn) {
    if (!BE.ready || !storeByChunk) return;
    var cx = x >> 4, cz = z >> 4, r = rc | 0;
    for (var dx = -r; dx <= r; dx++) {
      for (var dz = -r; dz <= r; dz++) {
        var m = storeByChunk.get((((cx + dx) & 0x3FFFFF) * 4194304) + ((cz + dz) & 0x3FFFFF));
        if (m) m.forEach(fn);
      }
    }
  };

  /**
   * #1163 — a block entity whose cell no longer holds its block. Dan saw a pig spawner's spinning
   * silhouette and smoke hanging in open ocean with no cage: `World.setBlock` drops the entity
   * through `Behave.changed`, but the writers that go through `Section.set` (save replay, worldgen
   * overwrites, a replayed journal) never tell `BE.onChanged`, so an entity outlived its block and
   * the renderer/ticker kept serving it. Vanilla only ever ticks or draws a BE its block still owns.
   * Answers false for an unloaded/ungenerated chunk (nothing to judge against).
   */
  BE.stale = function (e) {
    var W = NS.World, c = W && W.get ? W.get(e.x >> 4, e.z >> 4) : null;
    if (!c || c.state < NS.CH.GENERATED) return false;
    var st = W.getBlock(e.x, e.y, e.z);
    return st === 0 || BE.typeOf(NS.States.block[st]) !== e.type;
  };

  /**
   * `ConduitBlockEntity.updateActivatingBlocks` (.decomp): the 3x3x3 around the conduit must be all
   * water, then the 5x5x5 shell's edge/face-centre ring (not the corners) is scanned for prismarine,
   * prismarine_bricks, sea_lantern and dark_prismarine. Fills `e.frame`; true when >= 16.
   */
  var CONDUIT_FRAME = ['prismarine', 'prismarine_bricks', 'sea_lantern', 'dark_prismarine'];
  BE.conduitScan = function (e) {
    var W = NS.World, S = NS.States, R = NS.Reg, x, y, z, i;
    e.frame = [];
    for (x = -1; x <= 1; x++) for (y = -1; y <= 1; y++) for (z = -1; z <= 1; z++) {
      var st = W.getBlock(e.x + x, e.y + y, e.z + z);
      if (!(S.waterIn[st] || S.name(st) === 'water')) return false;
    }
    for (x = -2; x <= 2; x++) for (y = -2; y <= 2; y++) for (z = -2; z <= 2; z++) {
      var ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
      if ((ax > 1 || ay > 1 || az > 1) &&
          ((x === 0 && (ay === 2 || az === 2)) || (y === 0 && (ax === 2 || az === 2)) || (z === 0 && (ax === 2 || ay === 2)))) {
        var nm = S.name(W.getBlock(e.x + x, e.y + y, e.z + z));
        for (i = 0; i < 4; i++) if (nm === CONDUIT_FRAME[i]) e.frame.push([e.x + x, e.y + y, e.z + z]);
      }
    }
    return e.frame.length >= 16;
  };
  /**
   * `ConduitBlockEntity.serverTick` (.decomp): every 40 ticks rescan (activate/deactivate sound on a change),
   * then while active give players conduit_power and attack; while active ambient 80-tick + random short sound.
   */
  BE.conduitSound = function (ev, x, y, z) {
    if (NS.Sound && NS.Sound.play) NS.Sound.play(ev, { x: x, y: y, z: z, source: 'block', pitch: 1, volume: 1 });
  };
  BE.conduitWet = function (o) {
    var U = NS.Use;
    if (o === NS.Player) return !!(U && U.touchingWaterOrRain && U.touchingWaterOrRain(o));
    return !!o.inWater;
  };
  /** `givePlayersEffects`: range = frame/7*16; within distance of the block pos (feet block), wet. */
  BE.conduitGiveEffects = function (e) {
    var F = NS.Effects, P = NS.Player;
    var r = Math.floor(e.frame.length / 7) * 16;
    if (!P || P.dead || P.spectator || !F || !F.addStatusEffect) return;
    var dx = Math.floor(P.x) - e.x, dy = Math.floor(P.y) - e.y, dz = Math.floor(P.z) - e.z;
    if (dx * dx + dy * dy + dz * dz < r * r && BE.conduitWet(P)) F.addStatusEffect(P, 'conduit_power', 260, 0, true, true);
  };
  /** `attackHostileEntity`: target kept while alive and within 8; else a random wet Monster in the 8-expanded box. */
  BE.conduitAttack = function (e) {
    var EL = NS.EntityList, Tm = NS.Tame, rnd = (EL && EL.random) || Math.random;
    var t = e.target || null, old = t;
    var near = function (o, r) {
      var dx = Math.floor(o.x) - e.x, dy = Math.floor(o.y) - e.y, dz = Math.floor(o.z) - e.z;
      return dx * dx + dy * dy + dz * dz < r * r;
    };
    if (e.frame.length < 42) t = null;
    else if (!t) {
      var c = [];
      if (EL && EL.list) for (var i = 0; i < EL.list.length; i++) {
        var o = EL.list[i];
        if (!o || o.dead || o.removed || !(Tm && Tm.isMonster && Tm.isMonster(o.type)) || !BE.conduitWet(o)) continue;
        var hw = (o.width || 0.6) / 2, hh = o.height || 1.8;   // Box.intersects: the entity's bounding box, not its point
        if (o.x - hw < e.x + 9 && o.x + hw > e.x - 8 && o.y < e.y + 9 && o.y + hh > e.y - 8 && o.z - hw < e.z + 9 && o.z + hw > e.z - 8) c.push(o);
      }
      if (c.length) t = c[Math.floor(rnd() * c.length)];
    } else if (t.dead || t.removed || !near(t, 8)) t = null;
    e.target = t;
    if (t) {
      BE.conduitSound('block.conduit.attack.target', t.x, t.y, t.z);
      if (NS.Combat && NS.Combat.hurt) NS.Combat.hurt(t, 4, undefined, false, { bypassArmor: true, source: 'magic' });
    }
    return old !== t;
  };
  BE.tickConduit = function (e) {
    var gt = NS.Behave ? NS.Behave.gameTime : 0, cx = e.x + 0.5, cy = e.y + 0.5, cz = e.z + 0.5;
    e.ticks++;
    if (gt % 40 === 0) {
      var on = BE.conduitScan(e);
      if (on !== !!e.active) BE.conduitSound(on ? 'block.conduit.activate' : 'block.conduit.deactivate', cx, cy, cz);
      e.active = on;
      e.eyeOpen = e.frame.length >= 42;
      if (on) { BE.conduitGiveEffects(e); BE.conduitAttack(e); }
    }
    if (e.active) {
      e.ticksActive++;
      if (gt % 80 === 0) BE.conduitSound('block.conduit.ambient', cx, cy, cz);
      if (gt > (e.nextAmbientSoundTime || 0)) {
        var rn = (NS.EntityList && NS.EntityList.random) || Math.random;
        e.nextAmbientSoundTime = gt + 60 + Math.floor(rn() * 40);
        BE.conduitSound('block.conduit.ambient.short', cx, cy, cz);
      }
    }
  };
  /** `getRotation(partial)`. */
  BE.conduitRotation = function (e, partial) { return Math.fround((e.ticksActive + partial) * -0.0375); };

  /**
   * EndGatewayBlockEntity.serverTick / tryTeleportingEntity / startTeleportCooldown / onSyncedBlockEvent.
   * Age counts every tick; while teleportCooldown > 0 it counts down and nothing teleports; else one
   * random entity inside the block's box is moved to the exit (cooldown 100, then the synced event 1
   * sets the 40-tick beam cooldown). Every 2400 ticks the 40-tick cooldown starts by itself.
   * OWED (#5576): the exit-less path (setupExitPortalLocation: walk to the far End island, spawn
   * END_ISLAND, EndGatewayFeature) -- a gateway with no ExitPortal teleports nothing here.
   */
  BE.gateway = {
    entities: function (x, y, z) {          // entities whose position is inside Box(pos), spectators excluded
      var out = [], EL = NS.EntityList, P = NS.Player;
      var inb = function (o) { return o && !o.dead && !o.spectator && o.x >= x && o.x < x + 1 && o.y >= y && o.y < y + 1 && o.z >= z && o.z < z + 1; };
      if (EL && EL.list) for (var i = 0; i < EL.list.length; i++) if (inb(EL.list[i]) && !(EL.list[i].netherPortalCooldown > 0)) out.push(EL.list[i]);
      if (inb(P) && !(P.netherPortalCooldown > 0)) out.push(P);
      return out;
    },
    isFull: function (x, y, z) {            // findExitPortalPos: isFullCube && not bedrock
      var W = NS.World; var b = W && W.getBlock ? W.getBlock(x, y, z) : 0;
      return b !== 0 && !(NS.States && NS.States.isFluid && NS.States.isFluid[b]);
    },
    teleport: function (ent, x, y, z) { ent.x = x; ent.y = y; ent.z = z; },
    events: []                              // addSyncedBlockEvent(pos, block, 1, 0) log
  };
  BE.tickGateway = function (e) {
    var G = BE.gateway;
    var wasCd = e.teleportCooldown > 0;
    e.age++;
    if (wasCd) { e.teleportCooldown--; return; }
    var list = G.entities(e.x, e.y, e.z);
    if (list.length) BE.gatewayTeleport(e, list[Math.floor(((NS.EntityList && NS.EntityList.random) || Math.random)() * list.length)]);
    if (e.age % 2400 === 0) BE.gatewayStartCooldown(e);
  };
  BE.gatewayStartCooldown = function (e) {
    e.teleportCooldown = 40;
    BE.gateway.events.push({ x: e.x, y: e.y, z: e.z, type: 1, data: 0 });
  };
  BE.gatewayTeleport = function (e, ent) {
    if (e.teleportCooldown > 0) return false;
    e.teleportCooldown = 100;
    if (e.exitPortal) {
      var G = BE.gateway, p = e.exitPortal;
      if (!e.exactTeleport) {               // findBestPortalExitPos: highest full cube within 5 (not the centre column), +1
        var best = null;
        for (var dx = -5; dx <= 5; dx++) for (var dz = -5; dz <= 5; dz++) {
          if (!dx && !dz) continue;
          var top = (NS.World && NS.World.TOP_Y) || 256;
          for (var y = top - 1; y > (best === null ? -64 : best); y--) if (G.isFull(p.x + dx, y, p.z + dz)) { best = y; break; }
        }
        p = { x: p.x, y: (best === null ? e.exitPortal.y : best) + 1, z: p.z };
      }
      ent.netherPortalCooldown = 10;
      G.teleport(ent, p.x + 0.5, p.y, p.z + 0.5);
    }
    BE.gatewayStartCooldown(e);
    return true;
  };
  BE.gatewayEvent = function (e, id) { if (id === 1) { e.teleportCooldown = 40; return true; } return false; };
  BE.gatewayRecentlyGenerated = function (e) { return e.age < 200; };
  BE.gatewayBeamHeight = function (e, pt) { return Math.min(1, Math.max(0, (e.age + pt) / 200)); };
  BE.gatewayCooldownBeamHeight = function (e, pt) { return 1 - Math.min(1, Math.max(0, (e.teleportCooldown - pt) / 40)); };

  // #5571 — BeaconBlockEntity.tick / updateLevel (.decomp). The beam is scanned up to 10 blocks a
  // tick (`minY` is the resume height, `pending` is vanilla's `field_19178`), published as
  // `beamSegments` when the scan reaches the heightmap. The 80-tick effect cadence is B7.
  var DYE_RGB = [16383998, 16351261, 13061821, 3847130, 16701501, 8439583, 15961002, 4673362,
                 10329495, 1481884, 8991416, 3949738, 8606770, 6192150, 11546150, 1908001];
  var DYE_NAMES = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
                   'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
  var GLASS_COLOR = null;
  function glassColor(name) {
    if (!GLASS_COLOR) {
      GLASS_COLOR = Object.create(null);
      for (var i = 0; i < 16; i++) {
        var c = DYE_RGB[i], f = Math.fround;
        var rgb = [f(((c >> 16) & 255) / 255), f(((c >> 8) & 255) / 255), f((c & 255) / 255)];
        GLASS_COLOR[DYE_NAMES[i] + '_stained_glass'] = rgb;
        GLASS_COLOR[DYE_NAMES[i] + '_stained_glass_pane'] = rgb;
      }
    }
    return GLASS_COLOR[name];
  }
  /** `World.getTopY(MOTION_BLOCKING)`: the first free y over the column (replaceable by a heightmap). */
  BE.beaconTopY = function (x, z) {
    var W = NS.World;
    for (var y = 255; y >= -64; y--) if (W.getBlock(x, y, z) !== 0) return y + 1;
    return -64;
  };
  BE.updateLevel = function (x, y, z) {
    var W = NS.World, T = NS.Tags, lv = 0;
    for (var k = 1; k <= 4; lv = k++) {
      var yy = y - k;
      if (yy < -64) break;
      var all = true;
      for (var xx = x - k; xx <= x + k && all; xx++)
        for (var zz = z - k; zz <= z + k; zz++)
          if (!T.stateIn('beacon_base_blocks', W.getBlock(xx, yy, zz))) { all = false; break; }
      if (!all) break;
    }
    return lv;
  };
  /** `BeaconBlockEntity.EFFECTS_BY_LEVEL` (.decomp 42) as registry names, by raw id from BEACON_EFFECTS. */
  BE.BEACON_EFFECT_NAMES = { 1: 'speed', 3: 'haste', 11: 'resistance', 8: 'jump_boost', 5: 'strength', 10: 'regeneration' };
  BE.beaconSound = function (e, ev) {
    if (NS.Sound && NS.Sound.play) NS.Sound.play(ev, { x: e.x + 0.5, y: e.y + 0.5, z: e.z + 0.5, source: 'block', pitch: 1, volume: 1 });
  };
  /** `applyPlayerEffects` (.decomp 224): range levels*10+10, stretched up the world height; amplifier 1 only when level 4 and primary == secondary. */
  BE.applyPlayerEffects = function (e, lv, primary, secondary) {
    var N = BE.BEACON_EFFECT_NAMES, F = NS.Effects;
    if (primary == null || !F || !F.addStatusEffect) return;
    var r = lv * 10 + 10, amp = (lv >= 4 && primary === secondary) ? 1 : 0, dur = (9 + lv * 2) * 20;
    var pl = NS.Player ? [NS.Player] : [], got = [];
    for (var i = 0; i < pl.length; i++) {
      var p = pl[i], hw = 0.3;
      if (!p || p.dead || p.spectator) continue;
      if (p.x + hw >= e.x - r && p.x - hw <= e.x + 1 + r && p.z + hw >= e.z - r && p.z - hw <= e.z + 1 + r &&
          p.y + 1.8 >= e.y - r && p.y <= e.y + 1 + r + 320) got.push(p);
    }
    for (var a = 0; a < got.length; a++) F.addStatusEffect(got[a], N[primary], dur, amp, true, true);
    if (lv >= 4 && primary !== secondary && secondary != null)
      for (var b = 0; b < got.length; b++) F.addStatusEffect(got[b], N[secondary], dur, 0, true, true);
  };
  BE.tickBeacon = function (e) {
    var W = NS.World, S = NS.States, x = e.x, y = e.y, z = e.z;
    if (e.minY === undefined) { e.minY = -65; e.beamSegments = []; e.pending = []; }
    var cy;
    if (e.minY < y) { cy = y; e.pending = [[1, 1, 1, 1]]; e.minY = y - 1; }  // [r,g,b,height]
    else cy = e.minY + 1;
    var seg = e.pending.length ? e.pending[e.pending.length - 1] : null;
    var top = BE.beaconTopY(x, z);
    for (var i = 0; i < 10 && cy <= top; i++) {
      var st = W.getBlock(x, cy, z), col = glassColor(S.name(st));
      if (col) {
        if (e.pending.length <= 1) { seg = [col[0], col[1], col[2], 1]; e.pending.push(seg); }
        else if (seg) {
          if (col[0] === seg[0] && col[1] === seg[1] && col[2] === seg[2]) seg[3]++;
          else {
            seg = [Math.fround((seg[0] + col[0]) / 2), Math.fround((seg[1] + col[1]) / 2),
                   Math.fround((seg[2] + col[2]) / 2), 1];
            e.pending.push(seg);
          }
        }
      } else {
        if (!seg || (S.atten[st] >= 15 && S.name(st) !== 'bedrock')) {
          e.pending = []; e.minY = top; break;
        }
        seg[3]++;
      }
      cy++; e.minY++;
    }
    var before = e.levels;
    var t = NS.Behave ? NS.Behave.gameTime : BE.tickNo;
    if (t % 80 === 0) {
      if (e.beamSegments.length) e.levels = BE.updateLevel(x, y, z);
      if (e.levels > 0 && e.beamSegments.length) {
        BE.applyPlayerEffects(e, e.levels, e.primary, e.secondary);
        BE.beaconSound(e, 'block.beacon.ambient');
      }
    }
    if (e.minY >= top) {
      e.minY = -65; e.beamSegments = e.pending;
      if (before === 0 && e.levels > 0) BE.beaconSound(e, 'block.beacon.activate');
      else if (before > 0 && e.levels === 0) BE.beaconSound(e, 'block.beacon.deactivate');
    }
    return before;
  };

  BE.tickNo = 0;                          // `HopperBlockEntity.lastTickTime`'s clock (see hopperArm)
  BE.tick = function () {
    if (!BE.ready) return 0;
    BE.tickNo++;
    var n = 0, moving = [], stale = [];
    BE.forEach(function (e) {
      // D-421 — the lid animates on its own cadence and is NOT part of `n`. `n` is "how many
      // block entities did work this tick", the number `behavcheck` reads; a chest that is
      // merely closing did no work, and inflating that count to include it would quietly
      // redefine what every existing assertion about it means.
      if (LID[e.type] === 1) BE.tickLid(e);
      else if (e.type === 'shulker_box') BE.tickShulkerBox(e);
      else if (e.type === 'barrel') BE.barrelSync(e);
      if (e.type === 'furnace' || e.type === 'blast_furnace' || e.type === 'smoker') { tickFurnace(e); n++; }
      else if (e.type === 'hopper') { tickHopper(e); n++; }
      else if (e.type === 'conduit') { BE.tickConduit(e); n++; }
      else if (e.type === 'beacon') { BE.tickBeacon(e); n++; }
      // G25-bell-resonate -- BellBlockEntity.serverTick (.decomp): Bell.tick owns the logic (07s_raid.js).
      else if (e.type === 'bell') { if (NS.RaidManager && NS.Bell) NS.Bell.tick(e); n++; }
      else if (e.type === 'campfire') {
        for (var i = 0; i < 4; i++) if (e.items[i]) e.cookingTimes[i]++;
        n++;
      }
      // PASS 15 JOB 2 — vanilla's OWN cadence for `cff`'s ticker (javap'd, not guessed): a
      // no-op unless `level.getGameTime() % 20 == 0`, i.e. once a second, not every tick. The
      // arithmetic lives in `Redstone.updateDaylightDetector`; this is only the schedule.
      else if (e.type === 'daylight_detector') {
        if (NS.Behave && (NS.Behave.gameTime % 20) === 0 && NS.Redstone && NS.Redstone.ready) {
          NS.Redstone.updateDaylightDetector(e.x, e.y, e.z);
        }
        n++;
      }
      // PLAN G15c — the block in flight. ⚠ COLLECTED FIRST AND FINISHED AFTER THE WALK: landing
      // a moving block REMOVES its entity and writes a cell, and mutating the store from inside
      // its own iteration is how a piston loses half its structure (D-298).
      else if (e.type === 'piston' && e.movedState !== undefined) { moving.push(e.x, e.y, e.z); n++; }
      // D-395 — PLAN G18c JOB 2.3: the monster spawner block. The substrate stage (this file)
      // only dispatches; delay/range/count/cap logic is `Spawn`'s own, same split `tickFurnace`
      // and `Recipes` already keep (G2 owns the store and the tick LOOP, G9/G18 own the rules).
      else if (e.type === 'mob_spawner') { if (BE.stale(e)) { stale.push(e.x, e.y, e.z); return; } if (NS.Spawn && NS.Spawn.tickSpawner) NS.Spawn.tickSpawner(e); if (NS.Spawner && NS.Spawner.clientTick) NS.Spawner.clientTick(e); n++; }
      // loop/beenest-s103 -- `BeehiveBlockEntity.serverTick` (.decomp lines 295-303): the store
      // only dispatches (same split every ticker above already keeps), `Bee.tickHiveBE` (07zo_bee
      // .js) owns the day/rain release gate and the occupant countdown itself.
      else if (e.type === 'end_gateway') { BE.tickGateway(e); n++; }
      else if (e.type === 'beehive') { if (NS.Bee && NS.Bee.tickHiveBE) NS.Bee.tickHiveBE(e); n++; }
    });
    for (var sk = 0; sk < stale.length; sk += 3) BE.remove(stale[sk], stale[sk + 1], stale[sk + 2]);
    if (moving.length && NS.Piston && NS.Piston.ready) {
      for (var k = 0; k < moving.length; k += 3) NS.Piston.tickMoving(moving[k], moving[k + 1], moving[k + 2]);
    }
    return n;
  };

  /**
   * Which recipe family a furnace block looks in. ⚠ There is NO INHERITANCE: a blast furnace
   * does not fall back to the smelting recipe, it only sees recipes tagged `blasting`, which is
   * why iron ore blasts and raw beef does not (D-270's note in `02h_recipes.js`).
   */
  function cookType(type) {
    var R = NS.Recipes;
    if (!R) return -1;
    if (type === 'blast_furnace') return R.BLASTING;
    if (type === 'smoker') return R.SMOKING;
    return R.SMELTING;
  }

  /**
   * `AbstractFurnaceBlockEntity.canBurn` — may this recipe run RIGHT NOW? An input, a recipe, and
   * an output slot that is empty or holds the same item with room. ⚠ A FULL OUTPUT SLOT STOPS THE
   * FURNACE OUTRIGHT: it does not light, it does not spend fuel, it does not cook. (This function
   * was "merge and clamp" until D-414 — a furnace that smelted into a full slot and threw the
   * ingot away, which the check beside it had turned into a requirement.)
   */
  function canBurn(e, recipe) {
    var Iv = NS.Inventory;
    if (!recipe || Iv.isEmpty(e.items[0])) return false;
    var res = recipe.result;
    if (Iv.isEmpty(res)) return false;
    var out = e.items[2];
    if (Iv.isEmpty(out)) return true;
    if (out.i !== res.i) return false;
    if (out.n < 64 && out.n < Iv.maxStackSize(out)) return true;
    return out.n < Iv.maxStackSize(res);
  }

  /** `AbstractFurnaceBlockEntity.burn` — the finished item lands, the input is spent. */
  function burnOne(e, recipe) {
    var Iv = NS.Inventory, input = e.items[0], res = recipe.result, out = e.items[2];
    if (Iv.isEmpty(out)) e.items[2] = Iv.copy(res);
    else if (out.i === res.i) out.n += res.n;
    // a wet sponge dries into a sponge and turns the bucket in the fuel slot into a water bucket
    if (NS.Items.nameOf(input.i) === 'wet_sponge' && !Iv.isEmpty(e.items[1]) &&
        NS.Items.nameOf(e.items[1].i) === 'bucket') e.items[1] = Iv.stack('water_bucket', 1);
    input.n--;
    if (input.n <= 0) e.items[0] = null;
  }

  /**
   * `AbstractFurnaceBlockEntity.serverTick`, in vanilla's own order.
   * ⚠ THE COUNTERS ARE THE SCREEN'S (D-414): `burnTime` is `litTime`, `burnDuration` is
   * `litDuration`, `cookTime` and `cookTimeTotal` are the arrow — `Menu.furnaceMenu` draws them
   * directly, so what these do on each tick is what a player watching the furnace sees.
   * ⚠ THE COOK RESETS TO 0 (NOT COOLS) whenever the furnace is lit and cannot burn — an output that
   * filled, an input that was taken. It only cools by 2 a tick when the furnace is UNLIT and has
   * progress, which is what a re-fuel within a few ticks resumes from. Both were one branch before.
   */
  function tickFurnace(e) {
    var R = NS.Recipes, Iv = NS.Inventory;
    var wasLit = e.burnTime > 0;
    if (e.burnTime > 0) e.burnTime--;
    var input = e.items[0], fuel = e.items[1];
    // ⚠ THE SLOTS HOLD `Inventory.stack`s, the same shape the player's 41 slots hold. They held
    // `{item: name, count}` until session 9, which is the reason the two halves could not be
    // joined: G9's `cookingFor`/`fuelTime` take a stack and return a stack, and no amount of
    // wiring reconciles two representations at the call site.
    var hasInput = !Iv.isEmpty(input), hasFuel = !Iv.isEmpty(fuel);
    if (e.burnTime > 0 || (hasFuel && hasInput)) {
      var recipe = (hasInput && R && R.ready) ? R.cookingFor(input, cookType(e.type)) : null;
      if (e.burnTime === 0 && canBurn(e, recipe)) {
        var v = R.fuelTime(fuel);
        // `BlastFurnaceBlockEntity`/`SmokerBlockEntity.getFuelTime` = `super / 2` (.decomp:24-25):
        // they cook twice as fast AND burn fuel twice as fast (furnacerefcheck blast/smoker `burn`)
        if (e.type !== 'furnace') v = (v / 2) | 0;
        e.burnTime = v; e.burnDuration = v;
        if (v > 0) {
          var kind = fuel.i;
          fuel.n--;
          // `Item.getCraftingRemainingItem` — the only fuel that leaves something behind is lava
          if (fuel.n <= 0) e.items[1] = (NS.Items.nameOf(kind) === 'lava_bucket') ? Iv.stack('bucket', 1) : null;
        }
      }
      if (e.burnTime > 0 && canBurn(e, recipe)) {
        // ⚠ `cookTimeTotal` is NOT rewritten here (#410): vanilla sets it in `setItem` (Menu.furnaceSetItem)
        // and after a craft, and completes on `==` — a stored total that differs from the recipe is kept
        e.cookTime++;
        if (e.cookTime === e.cookTimeTotal) {
          e.cookTime = 0;
          burnOne(e, recipe);
          var nx = e.items[0], nr = (!Iv.isEmpty(nx) && R.ready) ? R.cookingFor(nx, cookType(e.type)) : null;
          e.cookTimeTotal = (nr && nr.time) ? nr.time : 200;
          // `setRecipeUsed` — the ledger `Menu.furnaceAwardXp` pays out when the output is taken
          if (!e.recipesUsed) e.recipesUsed = {};
          var u = e.recipesUsed[recipe.id] || (e.recipesUsed[recipe.id] = { n: 0, xp: recipe.xp || 0 });
          u.n++;
        }
      } else {
        e.cookTime = 0;
      }
    } else if (e.burnTime === 0 && e.cookTime > 0) {
      e.cookTime = Math.max(0, Math.min(e.cookTimeTotal, e.cookTime - 2));
    }
    e.lit = e.burnTime > 0;
    if (wasLit !== e.lit && NS.Behave && NS.Behave.setProp) {
      var st = NS.Behave.w.get(e.x, e.y, e.z);
      if (st !== 0) NS.Behave.w.set(e.x, e.y, e.z, NS.Behave.setProp(st, 'lit', e.lit));
    }
  }

  // ══════════════════════ THE HOPPER — PASS 17 JOB 1 (G19b), D-419 ════════════════════════════
  //
  // ⚠⚠ **A HOPPER IS A CLOCK, NOT A PIPE.** `HopperBlockEntity.tryMoveItems` moves **exactly one
  // item** and then sets an eight-tick cooldown, so a hopper's throughput is 2.5 items a second
  // and nothing else. A version that drains a stack in one tick looks the same in a screenshot
  // and is a different machine: every item sorter, every smelter feed and every clock built on a
  // hopper depends on the eight, which is why it is the first number in this block.
  //
  // ⚠ THE ORDER IS PUSH, THEN PULL, AND BOTH RUN IN THE SAME TICK. Vanilla's own body is:
  //     if (!isOnCooldown() && state.getValue(ENABLED)) {
  //       boolean flag = false;
  //       if (!hopper.isEmpty())        flag  = ejectItems(...);
  //       if (!hopper.inventoryFull())  flag |= suckInItems(...);
  //       if (flag) { setCooldown(8); setChanged(); }
  //     }
  // — `|=`, not `else`, so a hopper in a chain both gives and takes on the tick it fires.
  //
  // ⚠ `ENABLED` IS THE REDSTONE GATE and it is inverted from the intuition: a hopper is enabled
  // when it is NOT powered. `HopperBlock.neighborChanged` writes the property; this reads the
  // received signal directly through `Rs.bestNeighbourSignal`, because the property is only ever
  // a cache of that question and a cache that can disagree is D-164's own trap.
  //
  // ⚠ WHAT IS NOT HERE, AND IS NAMED RATHER THAN SILENTLY MISSING: a hopper does not yet pick up
  // ITEM ENTITIES lying on top of it (`suckInItems`'s other half, `getItemsAtAndAbove`), it does
  // not pull from a composter or a jukebox (neither is a container this engine can address), and
  // it does not pull from a minecart above. `BE.HOPPER_OWED` carries the list and
  // `hoppercheck` asserts the list is exactly that long, so it cannot quietly grow or shrink.
  BE.HOPPER_COOLDOWN = 8;
  BE.HOPPER_OWED = [
    'a hopper does not push into a DROPPER\'s or DISPENSER\'s 3x3 through a face table of ' +
      'their own — both are plain 9-slot containers here, which is what vanilla\'s ' +
      '`DispenserBlockEntity` is too, so this is a watch rather than a gap'
  ];

  /** The block-entity types a hopper may move items into or out of, and how big they are. */
  var HOPPER_TARGETS = {
    chest: 27, trapped_chest: 27, barrel: 27, shulker_box: 27, ender_chest: 27,
    hopper: 5, dropper: 9, dispenser: 9,
    furnace: 3, blast_furnace: 3, smoker: 3, brewing_stand: 5
  };
  BE.isHopperTarget = function (type) { return HOPPER_TARGETS[type] !== undefined; };

  /** Face indices, in the order `Redstone` uses them: 0 up, 1 down, 2 north, 3 south, 4 west, 5 east. */
  var HOP_DX = [0, 0, 0, 0, -1, 1], HOP_DY = [1, -1, 0, 0, 0, 0], HOP_DZ = [0, 0, -1, 1, 0, 0];
  var HOP_FACE = { up: 0, down: 1, north: 2, south: 3, west: 4, east: 5 };

  /**
   * `HopperBlock`'s `facing` property, as a face index. ⚠ A hopper can face DOWN or sideways and
   * never up — vanilla's own `FACING_HOPPER` — so an unreadable property is `down`, which is the
   * block's own default state, not a refusal.
   */
  BE.hopperFacing = function (e) {
    var B = NS.Behave, W = NS.World;
    if (!B || !B.propName || !W) return 1;
    var st = W.getBlock(e.x, e.y, e.z);
    if (!(st > 0)) return 1;
    var f = B.propName(st, 'facing');
    var i = HOP_FACE[f];
    return i === undefined ? 1 : i;
  };

  /**
   * `HopperBlockEntity.canPlaceItemInContainer` — the WorldlyContainer half, which is the whole
   * reason a hopper on a furnace's side feeds it COAL and one on its top feeds it ORE.
   * `face` is the side of the TARGET the item enters through, in this file's own face indices.
   * ⚠ THE FURNACE'S TABLE IS `AbstractFurnaceBlockEntity.getSlotsForFace`: UP -> {0} the
   * ingredient, DOWN -> {2, 1} the result then the bucket, any side -> {1} the fuel.
   */
  function hopperSlotsFor(type, face) {
    if (type === 'furnace' || type === 'blast_furnace' || type === 'smoker') {
      if (face === 0) return [0];          // entering through the top
      if (face === 1) return [2, 1];       // entering through the bottom
      return [1];
    }
    if (type === 'brewing_stand') {        // BrewingStandBlockEntity.getAvailableSlots
      if (face === 0) return [3];
      if (face === 1) return [0, 1, 2, 3];
      return [0, 1, 2, 4];
    }
    var n = HOPPER_TARGETS[type] || 0, out = [];
    for (var i = 0; i < n; i++) out.push(i);
    return out;
  }

  BE.hopperSlotsFor = hopperSlotsFor;

  /** `Container.canPlaceItem` — only the furnace family has an opinion. */
  function hopperMayPlace(be, slot, st) {
    if (be.type === 'brewing_stand') {     // BrewingStandBlockEntity.canPlaceItem
      var Br = NS.Brewing, nm = NS.Items.nameOf(st.i);
      if (slot === 3) return !!Br && Br.isValidIngredient(st);
      if (slot === 4) return nm === 'blaze_powder';
      return (nm === 'glass_bottle' || (!!Br && Br.isPotionType(st))) && NS.Inventory.isEmpty(be.items[slot]);
    }
    if (be.type !== 'furnace' && be.type !== 'blast_furnace' && be.type !== 'smoker') return true;
    if (slot === 2) return false;                                  // nothing goes INTO the result
    if (slot === 0) return true;
    var R = NS.Recipes, I = NS.Inventory;
    var isFuel = !!(R && R.ready && R.isFuel(st));
    var isBucket = !I.isEmpty(st) && NS.Items.nameOf(st.i) === 'bucket';
    return isFuel || isBucket;
  }

  /**
   * Put a stack into one slot of a target. ⚠ IT GOES THROUGH `Menu.furnaceSetItem` FOR A FURNACE
   * and through a plain write for anything else: that door is what restarts the cook and re-reads
   * its length when a DIFFERENT item lands in the ingredient slot, and a hopper that wrote
   * `be.items[0]` directly would feed a furnace that never noticed (D-414 named this door for
   * exactly this caller). Returns true if the item moved.
   */
  function hopperPut(target, slot, stack) {
    var I = NS.Inventory, M = NS.Menu;
    var cur = target.items[slot];
    var isFurnace = (target.type === 'furnace' || target.type === 'blast_furnace' || target.type === 'smoker');
    if (I.isEmpty(cur)) {
      if (isFurnace && M && M.furnaceSetItem) M.furnaceSetItem(target, slot, stack);
      else target.items[slot] = stack;
      return true;
    }
    if (!I.isSameItemSameTags(cur, stack)) return false;
    var cap = Math.min(I.maxStackSize(cur), I.MAX_STACK);
    if (cur.n >= cap) return false;
    cur.n++;
    return true;
  }

  /**
   * `HopperBlockEntity.transfer`'s tail (.decomp:267-275): an item landing in a hopper that was
   * EMPTY puts that hopper on an 8-tick cooldown — 7 when the giver is a hopper that ticked no
   * later than it this tick (`lastTickTime >= source.lastTickTime`). Without it a dropper's item
   * went straight through the hopper on the tick it arrived (dispenserefcheck
   * `dropper_hopper_chest`). `wasEmpty` is asked BEFORE the put, as vanilla's `$$7` is.
   */
  BE.hopperArm = function (target, wasEmpty, source) {
    if (!wasEmpty || target.type !== 'hopper' || target.cooldown > BE.HOPPER_COOLDOWN) return;
    var late = (source && source.type === 'hopper' && (target.lastTick || 0) >= (source.lastTick || 0)) ? 1 : 0;
    target.cooldown = BE.HOPPER_COOLDOWN - late;
  };

  /** `AbstractFurnaceBlockEntity.canExtract` (.decomp:369-371): through the DOWN face the fuel
   *  slot gives up only a water bucket or a bucket — never the coal still burning in it. */
  BE.hopperMayTake = function (be, slot, st) {
    if (be.type === 'brewing_stand') return slot !== 3 || NS.Items.nameOf(st.i) === 'glass_bottle';
    if (slot !== 1 || (be.type !== 'furnace' && be.type !== 'blast_furnace' && be.type !== 'smoker')) return true;
    var nm = NS.Items.nameOf(st.i);
    return nm === 'water_bucket' || nm === 'bucket';
  };

  /** `ComposterBlock.InputInventory` reached through `getInventoryAt`'s block branch: a composter
   *  at (x,y,z) with level < 7 takes ONE compostable item (consumed, chance roll inside
   *  `Composter.addItem`); null = no composter here, 0 = refuses, 1 = took it. */
  BE.composterInsert = function (x, y, z, name, rng) {
    var W = NS.World, S = NS.States, C = NS.Composter;
    if (!W || !S || !C || S.name(W.getBlock(x, y, z)) !== 'composter') return null;
    return C.addItem(x, y, z, name, rng || Math.random) ? 1 : 0;
  };

  /**
   * `HopperBlockEntity.ejectItems` — one item, into the container the hopper FACES, through the
   * face opposite the one it points along. Returns true if something moved.
   */
  function hopperEjectCart(e, tx, ty, tz) {
    var I = NS.Inventory, Mc = NS.Minecart, ES = NS.EntityList && NS.EntityList.list;
    if (!Mc || !ES) return false;
    var c = [];
    for (var q = 0; q < ES.length; q++) {                         // getInventoryAt: VALID_INVENTORIES in the output cell's box
      var o = ES[q];
      if (o.removed || !Mc.INVENTORY[o.type] || !o.inventory) continue;
      if (o.x + 0.49 < tx || o.x - 0.49 > tx + 1 || o.z + 0.49 < tz || o.z - 0.49 > tz + 1 || o.y + 0.7 < ty || o.y > ty + 1) continue;
      c.push(o);
    }
    if (!c.length) return false;
    var rf = (NS.EntityList && NS.EntityList.random) || Math.random;
    var cart = c[Math.floor(rf() * c.length)], size = Mc.INVENTORY[cart.type];
    Mc.generateLoot(cart, null);
    for (var i = 0; i < 5; i++) {
      var src = e.items[i];
      if (I.isEmpty(src)) continue;
      var nm = NS.Items.nameOf(src.i), cap = Math.min(I.maxStackSize(I.stack(nm, 1)), I.MAX_STACK);
      for (var k = 0; k < size; k++) {
        var cs = cart.inventory[k];
        if (!cs || !(cs.count > 0)) cart.inventory[k] = { item: nm, count: 1, tag: src.tag || undefined };
        else if (cs.item === nm && JSON.stringify(cs.tag || null) === JSON.stringify(src.tag || null) && cs.count < cap) cs.count++;
        else continue;
        src.n--;
        if (src.n <= 0) e.items[i] = null;
        return true;
      }
    }
    return false;
  }

  function hopperEject(e) {
    var I = NS.Inventory;
    var f = BE.hopperFacing(e);
    var tx = e.x + HOP_DX[f], ty = e.y + HOP_DY[f], tz = e.z + HOP_DZ[f];
    var target = BE.get(tx, ty, tz);
    if (!target) {
      for (var ci = 0; ci < 5; ci++) {
        var cs = e.items[ci];
        if (I.isEmpty(cs)) continue;
        var cr = BE.composterInsert(tx, ty, tz, NS.Items.nameOf(cs.i));
        if (cr === null) break;
        if (cr === 0) continue;
        cs.n--;
        if (cs.n <= 0) e.items[ci] = null;
        return true;
      }
    }
    if (!target) return hopperEjectCart(e, tx, ty, tz);
    if (!BE.isHopperTarget(target.type) || !target.items) return false;
    // the face the item ENTERS by is the opposite of the one the hopper points along
    var entry = (f === 0) ? 1 : (f === 1) ? 0 : (f === 2) ? 3 : (f === 3) ? 2 : (f === 4) ? 5 : 4;
    var slots = hopperSlotsFor(target.type, entry);
    for (var i = 0; i < 5; i++) {
      var src = e.items[i];
      if (I.isEmpty(src)) continue;
      var one = I.stack(NS.Items.nameOf(src.i), 1);
      for (var k = 0; k < slots.length; k++) {
        var sl = slots[k];
        if (!hopperMayPlace(target, sl, one)) continue;
        var wasEmpty = target.type === 'hopper' && hopperEmpty(target);
        if (!hopperPut(target, sl, one)) continue;
        BE.hopperArm(target, wasEmpty, e);
        src.n--;
        if (src.n <= 0) e.items[i] = null;
        return true;
      }
    }
    return false;
  }

  /**
   * `HopperBlockEntity.suckInItems` — one item, out of the container directly ABOVE, through that
   * container's DOWN face. ⚠ DOWN, not up: the item leaves the source through its underside,
   * which is why a hopper under a furnace takes the RESULT (slot 2) and the spent bucket (slot 1)
   * and never the ingredient.
   */
  /** ComposterBlock.FullInventory: LEVEL 8 offers 1 bone_meal at slot 0 (DOWN); taking it runs
   *  emptyComposter (LEVEL -> 0, composter.empty sound, no item entity). */
  function hopperSuckComposter(e) {
    var C = NS.Composter, I = NS.Inventory;
    if (!C || !C.level || C.level(e.x, e.y + 1, e.z) !== C.LEVEL_MAX) return false;
    var one = I.stack('bone_meal', 1);
    for (var i = 0; i < 5; i++) {
      if (!hopperPut(e, i, one)) continue;
      C.setLevel(e.x, e.y + 1, e.z, 0);
      var Snd = NS.Sound;
      if (Snd && Snd.play) Snd.play('block.composter.empty', { x: e.x + 0.5, y: e.y + 1.5, z: e.z + 0.5 });
      return true;
    }
    return false;
  }

  function hopperSuck(e) {
    var I = NS.Inventory, M = NS.Menu;
    var src = BE.get(e.x, e.y + 1, e.z);
    if (!src) return hopperSuckComposter(e) || hopperSuckEntities(e) || hopperSuckCart(e);
    if (!BE.isHopperTarget(src.type) || !src.items) return hopperSuckEntities(e) || hopperSuckCart(e);
    var slots = hopperSlotsFor(src.type, 1);                       // leaving through the bottom
    for (var k = 0; k < slots.length; k++) {
      var sl = slots[k], st = src.items[sl];
      if (I.isEmpty(st) || !BE.hopperMayTake(src, sl, st)) continue;
      var one = I.stack(NS.Items.nameOf(st.i), 1);
      for (var i = 0; i < 5; i++) {
        if (!hopperPut(e, i, one)) continue;
        st.n--;
        if (st.n <= 0) {
          var isFurnace = (src.type === 'furnace' || src.type === 'blast_furnace' || src.type === 'smoker');
          if (isFurnace && M && M.furnaceSetItem) M.furnaceSetItem(src, sl, null);
          else src.items[sl] = null;
        }
        return true;
      }
    }
    return false;
  }

  /**
   * `HopperBlockEntity.extract(World, Hopper)` item branch (.decomp:183-189) — with no container
   * above, the first ItemEntity whose box meets INPUT_AREA_SHAPE (INSIDE x/z 2..14 y 11..16 /16,
   * ABOVE x/z 0..1 y 1..2) is `extract(Inventory, ItemEntity)`: the WHOLE stack goes through
   * `transfer` as far as it fits, the entity is discarded when nothing is left and otherwise
   * shrunk to the remainder; one entity per attempt, and `pickupDelay` is not consulted.
   */
  function hopperSuckEntities(e, only) {
    var EL = NS.EntityList, I = NS.Inventory;
    if (!EL || !EL.list || !I) return false;
    var HW = 0.125, HH = 0.25;                     // ItemEntity 0.25 x 0.25
    for (var n = 0; n < (only ? 1 : EL.list.length); n++) {
      var it = only || EL.list[n];
      if (!it || it.type !== 'item' || it.removed || !(it.count > 0)) continue;
      var x0 = it.x - HW, x1 = it.x + HW, z0 = it.z - HW, z1 = it.z + HW, y0 = it.y, y1 = it.y + HH;
      var inside = x1 > e.x + 0.125 && x0 < e.x + 0.875 && z1 > e.z + 0.125 && z0 < e.z + 0.875 &&
                   y1 > e.y + 11 / 16 && y0 < e.y + 1;
      var above = x1 > e.x && x0 < e.x + 1 && z1 > e.z && z0 < e.z + 1 && y1 > e.y + 1 && y0 < e.y + 2;
      if (!inside && !above) continue;
      var left = it.count | 0, wasEmpty = hopperEmpty(e), cap = I.MAX_STACK, name = it.item;
      var proto = I.stack(name, 1), mx = Math.min(I.maxStackSize(proto), cap);
      for (var i = 0; i < 5 && left > 0; i++) {
        var cur = e.items[i];
        if (I.isEmpty(cur)) { var m = Math.min(left, mx); e.items[i] = I.stack(name, m); left -= m; }
        else if (I.isSameItemSameTags(cur, proto) && cur.n < mx) { var a = Math.min(left, mx - cur.n); cur.n += a; left -= a; }
      }
      if (left === (it.count | 0)) continue;
      BE.hopperArm(e, wasEmpty, null);
      if (left > 0) { it.count = left; continue; }     // a partial merge is NOT a success (.decomp:209-221): the scan goes on
      EL.remove(it);
      return true;
    }
    return false;
  }

  /**
   * `HopperBlockEntity.getInputInventory` entity fallback (`getInventoryAt` -> `getEntities` over the cell
   * above, VALID_INVENTORIES): a chest_minecart / hopper_minecart there gives up its first non-empty slot,
   * one item, no sided limit. Only reached when the cell above has no block container.
   */
  function hopperSuckCart(e) {
    var I = NS.Inventory, EL = NS.EntityList, Mc = NS.Minecart;
    if (!EL || !EL.list || !Mc) return false;
    for (var n = 0; n < EL.list.length; n++) {
      var c = EL.list[n];
      if (!c || c.removed || !c.inventory || (c.type !== 'chest_minecart' && c.type !== 'hopper_minecart')) continue;
      if (Math.abs(c.x - (e.x + 0.5)) >= 1 || Math.abs(c.z - (e.z + 0.5)) >= 1 ||
          c.y >= e.y + 2 || c.y + 0.7 <= e.y + 1) continue;      // the cart's box meets the cell above
      var size = Mc.INVENTORY[c.type];
      for (var k = 0; k < size; k++) {
        var st = c.inventory[k];
        if (!st || !(st.count > 0)) continue;
        var one = I.stack(st.item, 1);
        for (var i = 0; i < 5; i++) {
          if (!hopperPut(e, i, one)) continue;
          st.count--;
          if (st.count <= 0) c.inventory[k] = null;
          return true;
        }
        return false;                                           // first non-empty slot only
      }
    }
    return false;
  }

  /** `Container.isEmpty` / the `inventoryFull` test, over the hopper's own five. */
  function hopperEmpty(e) {
    var I = NS.Inventory;
    for (var i = 0; i < 5; i++) if (!I.isEmpty(e.items[i])) return false;
    return true;
  }
  function hopperFull(e) {
    var I = NS.Inventory;
    for (var i = 0; i < 5; i++) {
      var s = e.items[i];
      if (I.isEmpty(s)) return false;
      if (s.n < Math.min(I.maxStackSize(s), I.MAX_STACK)) return false;
    }
    return true;
  }

  /** True when no neighbour is feeding this hopper a redstone signal. `HopperBlock`'s `ENABLED`. */
  BE.hopperEnabled = function (e) {
    var Rs = NS.Redstone;
    if (!Rs || !Rs.ready || !Rs.bestNeighbourSignal) return true;
    return Rs.bestNeighbourSignal(e.x, e.y, e.z) === 0;
  };

  /**
   * `HopperBlockEntity.serverTick` (.decomp:91-98) — ⚠ DECREMENTS FIRST, THEN CHECKS THE SAME
   * TICK, not "check, and only decrement while still cooling down": `transferCooldown--` runs
   * unconditionally every tick (even while redstone-locked, even while already <= 0 — the field
   * just goes further negative, which reads identically to 0 by `needsCooldown()`'s own `> 0`),
   * and the tick where the decrement brings it to exactly 0 is ALSO the tick a transfer is tried
   * on. The old shape here (`if (e.cooldown > 0) { e.cooldown--; return; }`) instead spent that
   * exact tick on the decrement alone and tried nothing until the NEXT one — one tick later than
   * vanilla, every single 8-tick cycle, forever (`hopperrefcheck`'s own 22/39 reds, all "2 ticks
   * early on the server / late here").
   */
  function tickHopper(e) {
    e.cooldown--;
    e.lastTick = BE.tickNo;
    if (e.cooldown > 0) return;
    e.cooldown = 0;
    if (!NS.Inventory) return;
    if (!BE.hopperEnabled(e)) return;
    var moved = false;
    if (!hopperEmpty(e)) moved = hopperEject(e);
    if (!hopperFull(e)) moved = hopperSuck(e) || moved;
    if (moved) e.cooldown = BE.HOPPER_COOLDOWN;
  }
  BE.tickHopper = tickHopper;

  /**
   * `HopperBlockEntity.onEntityCollided` -> `insertAndExtract(..., () -> extract(hopper, itemEntity))`:
   * an ItemEntity whose box meets INPUT_AREA_SHAPE is taken at once when the hopper is off cooldown
   * and enabled (insert first when non-empty), and a successful move starts the 8-tick cooldown.
   */
  BE.hopperEntityCollided = function (e, item) {
    if (!e || e.type !== 'hopper' || !item || item.type !== 'item' || item.removed || !NS.Inventory) return false;
    if (e.cooldown > 0 || !BE.hopperEnabled(e)) return false;
    var moved = false;
    if (!hopperEmpty(e)) moved = hopperEject(e);
    if (!hopperFull(e)) moved = hopperSuckEntities(e, item) || moved;
    if (moved) e.cooldown = BE.HOPPER_COOLDOWN;
    return moved;
  };

  // ══════════════ THE DISPENSER AND THE DROPPER — PASS 17 JOB 1 (G19b), D-420 ═════════════════
  //
  // ⚠⚠ **THEY ARE THE SAME BLOCK WITH TWO ENDINGS.** `DispenserBlock` and `DropperBlock` share
  // their state, their screen, their 3x3 container, their trigger and their four-tick delay; they
  // differ only in what `dispenseFrom` does with the one item it picked:
  //
  //   DROPPER    if the cell it faces holds a container, put ONE item in it; otherwise throw it.
  //   DISPENSER  look the item up in `DispenseItemBehavior`'s registry and run that; with no
  //              entry, `DefaultDispenseItemBehavior` throws it — and a dispenser NEVER inserts
  //              into a container, which is the whole difference a player feels.
  //
  // ⚠ THE SPECIAL BEHAVIOURS ARE NOT HERE AND ARE NAMED. An arrow fired, a bucket emptied, a
  // boat placed, shears sheared, TNT primed, a firework launched, armour equipped on the mob in
  // front — that registry is a table of about thirty entries over stages this engine has not
  // built (projectiles, buckets, boats, mobs to equip). `BE.DISPENSER_OWED` carries the list and
  // `dispensercheck` asserts it is exactly that long, so it cannot quietly grow or shrink.
  BE.DISPENSER_DELAY = 4;                 // `level.scheduleTick(pos, this, 4)` on the rising edge
  BE.DISPENSER_OWED = [
    'every `DispenseItemBehavior` registry entry but the water/lava/empty bucket (`dispenseBucket`) and ' +
      'the eight `ProjectileDispenserBehavior`s (`BE.DISPENSE_BEHAVIORS`: arrow, tipped/spectral arrow, snowball, egg, experience bottle, splash/lingering potion, bone meal, glass bottle) and fire_charge (SmallFireball) — ' +
      'other projectiles (G17 D2..D10), minecarts (built; shears and the saddle are built), armor stands (built), ' +
      'spawn eggs (honeycomb, horse armour and llama carpets are built). Without them a dispenser THROWS ' +
      'every item, which is `DefaultDispenseItemBehavior` and is what vanilla does for anything ' +
      'the registry has no entry for',
    '(fallible-failure 1001 is built) (1000/1001-empty/1002/1004/1018/2000 are built: `BE.dispenseEvent`)',
    'a dispenser firing into a container does NOT insert — that is correct and is asserted, ' +
      'but the dropper\'s own `HopperBlockEntity.addItem` face argument is not modelled: a ' +
      'dropper inserts through the target\'s plain slot list rather than its per-face one'
  ];

  /**
   * `DispenserBlockEntity.getRandomSlot` — reservoir sampling over the non-empty slots, so every
   * one of them is equally likely. ⚠ NOT "the first non-empty": a dispenser with two stacks fires
   * from both, which is what makes a dispenser full of different items a randomiser.
   */
  BE.dispenserRandomSlot = function (e, rnd) {
    var I = NS.Inventory, pick = -1, n = 0;
    var r = rnd || Math.random;
    for (var i = 0; i < 9; i++) {
      if (I.isEmpty(e.items[i])) continue;
      n++;
      if (r() * n < 1) pick = i;
    }
    return pick;
  };

  /** `DispenserBlock.getDispensePosition` — the block centre, 0.7 of a block along its facing. */
  BE.dispensePosition = function (e, face) {
    return [e.x + 0.5 + 0.7 * HOP_DX[face], e.y + 0.5 + 0.7 * HOP_DY[face], e.z + 0.5 + 0.7 * HOP_DZ[face]];
  };

  /** The facing of a dispenser or dropper, as a face index. Unlike a hopper's, it may be UP. */
  BE.dispenserFacing = function (e) {
    var B = NS.Behave, W = NS.World;
    if (!B || !B.propName || !W) return 2;
    var st = W.getBlock(e.x, e.y, e.z);
    if (!(st > 0)) return 2;
    var i = HOP_FACE[B.propName(st, 'facing')];
    return i === undefined ? 2 : i;
  };

  /**
   * `DefaultDispenseItemBehavior.spawnItem` — throw one item out of the front face.
   * ⚠ Transcribed: the position is `getDispensePosition` lowered by 0.125 on a vertical facing
   * and 0.15625 otherwise, and the velocity is `random.triangle(step * d3, 0.0172275 * 6)` per
   * axis with `d3 = random * 0.1 + 0.2` — a spread, not a straight line, which is why a
   * dispenser scatters. Named as a transcription because there is no javap on these machines.
   */
  BE.DISPENSE_SPEED = 6;
  BE.DISPENSE_SPREAD = 0.0172275;
  function triangle(rnd, mid, dev) { return mid + dev * (rnd() - rnd()); }
  BE.dispenseThrow = function (e, face, name, rnd) {
    var EL = NS.EntityList;
    if (!EL || !EL.ready) return false;
    var r = rnd || Math.random;
    var p = BE.dispensePosition(e, face);
    var dy = (face === 0 || face === 1) ? 0.125 : 0.15625;
    var d3 = r() * 0.1 + 0.2;
    var dev = BE.DISPENSE_SPREAD * BE.DISPENSE_SPEED;
    return !!EL.dropStack(p[0], p[1] - dy, p[2], name, 1, {
      vx: triangle(r, HOP_DX[face] * d3, dev),
      vy: triangle(r, 0.2, dev),
      vz: triangle(r, HOP_DZ[face] * d3, dev)
    });
  };

  /**
   * The bucket entries of `DispenserBehavior.registerDefaults` (.decomp:343-395), for a dispenser.
   * WATER/LAVA BUCKET: `placeFluid` at the cell in front (air or a replaceable block, as the
   * player's `BucketItem` in 14l_use.js), and the slot becomes an empty BUCKET; a blocked cell
   * falls back to throwing the bucket. EMPTY BUCKET: `FluidDrainable.tryDrainFluid` in front — a
   * fluid SOURCE (level 0) becomes air, a waterlogged block loses its water — and the filled
   * bucket replaces a lone bucket, or goes to the first free slot of a stack (thrown if none).
   * Nothing drainable: thrown. Returns null when the item has no bucket entry, else true/false.
   */
  BE.dispenseBucket = function (e, slot, name, face, rnd) {
    var FISH = { cod_bucket: 'cod', salmon_bucket: 'salmon', pufferfish_bucket: 'pufferfish',
      tropical_fish_bucket: 'tropical_fish', axolotl_bucket: 'axolotl' };
    if (name !== 'water_bucket' && name !== 'lava_bucket' && name !== 'bucket' &&
        name !== 'powder_snow_bucket' && !FISH[name]) return null;
    var Bh = NS.Behave, I = NS.Inventory, S = NS.States;
    if (!Bh || !Bh.w || !S) return null;
    var w = Bh.w, tx = e.x + HOP_DX[face], ty = e.y + HOP_DY[face], tz = e.z + HOP_DZ[face];
    var st = w.get(tx, ty, tz);
    var src = e.items[slot];
    if (name !== 'bucket') {
      var plantFill = name === 'water_bucket' && /^(kelp|kelp_plant|seagrass|tall_seagrass)$/.test(NS.Reg.names[S.block[st]]);
      if (st !== 0 && (plantFill || !((S.replaceable && S.replaceable[st]) || S.solidMat[S.block[st]] === 0))) {
        // BucketItem.placeFluid(null, world, pos, null): FluidFillable.tryFillWithFluid waterlogs in place
        var fl = name === 'water_bucket' ? 'water' : name === 'lava_bucket' ? 'lava' : '';
        if (fl && NS.Use && NS.Use.placeFluid && NS.Use.placeFluid(fl, tx, ty, tz, null)) {
          e.items[slot] = I.stack('bucket', 1);
          return true;
        }
        return BE.dispenseThrowFrom(e, slot, name, face, rnd);
      }
      if (st !== 0 && NS.Use && NS.Use.breakForFluid) NS.Use.breakForFluid(tx, ty, tz, st);   // placeFluid: breakBlock(pos, true) first
      w.set(tx, ty, tz, S.stateOf(name === 'lava_bucket' ? 'lava' : name === 'powder_snow_bucket' ? 'powder_snow' : 'water'));
      Bh.changed(tx, ty, tz);
      // BucketItem.playEmptyingSound (lava -> empty_lava; EntityBucketItem: empty_fish / axolotl's; powder snow bucket's own)
      if (NS.Sound && NS.Sound.play) NS.Sound.play(name === 'lava_bucket' ? 'item.bucket.empty_lava' : name === 'powder_snow_bucket' ? 'item.bucket.empty_powder_snow' :
        name === 'axolotl_bucket' ? 'item.bucket.empty_axolotl' : FISH[name] ? 'item.bucket.empty_fish' : 'item.bucket.empty',
        { x: tx + 0.5, y: ty + 0.5, z: tz + 0.5, source: 'block' });
      var mob = FISH[name], EL = NS.EntityList;     // EntityBucketItem.onEmptied
      if (mob && EL && EL.canSpawn && EL.canSpawn(mob)) {
        var opts = { fromBucket: true };
        if (src.axolotlVariant !== undefined) opts.variant = src.axolotlVariant;
        if (src.puffState !== undefined) opts.puffState = src.puffState;
        if (name === 'tropical_fish_bucket' && src.t && src.t.BucketVariantTag !== undefined) opts.variant = src.t.BucketVariantTag | 0;
        var rel = EL.spawn(mob, tx + 0.5, ty, tz + 0.5, opts);
        if (rel && mob === 'axolotl' && opts.variant !== undefined) rel.axolotlVariant = opts.variant | 0;
      }
      e.items[slot] = I.stack('bucket', 1);
      return true;
    }
    var filled = st !== 0 && NS.Use && NS.Use.tryDrainFluid ? NS.Use.tryDrainFluid(tx, ty, tz, st) : '';   // FluidDrainable.tryDrainFluid (it calls changed itself)
    if (!filled) return BE.dispenseThrowFrom(e, slot, name, face, rnd);
    src.n--;
    if (src.n <= 0) { e.items[slot] = I.stack(filled, 1); return true; }
    for (var i = 0; i < 9; i++) if (I.isEmpty(e.items[i])) { e.items[i] = I.stack(filled, 1); return true; }
    BE.dispenseThrow(e, face, filled, rnd);
    return true;
  };

  /**
   * `ProjectileDispenserBehavior.dispenseSilently` (force 1.1 `getForce`, variation 6.0 `getVariation`):
   * the entity appears at `getOutputLocation` (`BE.dispensePosition`), velocity = facing with y + 0.1
   * through `ProjectileEntity.setVelocity` (`Potion.throwVelocity`). Shooter none; arrows are pickup ALLOWED.
   */
  BE.PROJECTILE_FORCE = 1.1;
  BE.PROJECTILE_VARIATION = 6.0;
  function projectileBehavior(type, scaled, lingering) {
    var force = scaled ? BE.PROJECTILE_FORCE * 1.25 : BE.PROJECTILE_FORCE;      // `getForce() * 1.25F`
    var variation = scaled ? BE.PROJECTILE_VARIATION * 0.5 : BE.PROJECTILE_VARIATION; // `getVariation() * 0.5F`
    var fn = function (e, slot, name, face, rnd) {
      var EL = NS.EntityList, Po = NS.Potion;
      if (!EL || !EL.ready || !Po || !EL.canSpawn(type)) return null;
      var p = BE.dispensePosition(e, face);
      var v = Po.throwVelocity(HOP_DX[face], HOP_DY[face] + 0.1, HOP_DZ[face],
                               force, variation, rnd);
      var src = e.items[slot];
      var opts = { vx: v.vx, vy: v.vy, vz: v.vz };
      if (type === 'potion') {
        var tip = Po.tipFromTag ? Po.tipFromTag(src.t || null) : null;
        opts.potionId = tip && tip.potionId ? tip.potionId : null;
        if (tip && tip.custom) opts.custom = tip.custom;
        opts.lingering = !!lingering;
      }
      var arrow = type === 'arrow' || type === 'spectral_arrow';
      if (name === 'tipped_arrow' && Po.tipFromTag) opts.tip = Po.tipFromTag(src.t || null);
      var ent = EL.spawn(type, p[0], p[1], p[2], opts);
      if (!ent) return null;
      if (arrow) {
        ent.pickupType = 'allowed';
        ent.pickupItem = name;
        ent.pickupTag = src.t || null;
      }
      src.n--;
      if (src.n <= 0) e.items[slot] = null;
      return true;
    };
    fn.projectile = true;                 // ProjectileDispenserBehavior.playSound: 1002, not 1000
    return fn;
  }
  /**
   * `ShearsDispenserBehavior` (FallibleItemDispenserBehavior): `tryShearBlock(cell) || tryShearEntity(cell)`.
   * A full (5) beehive/bee_nest drops 3 honeycomb + `takeHoney` (no player); else the first shearable sheep whose
   * box meets the cell. Success costs the shears 1 durability (broken at max); failure keeps the item (false).
   */
  function shearsBehavior(e, slot, name, face, rnd) {
    var B = NS.Behave, W = NS.World, EL = NS.EntityList, IT = NS.Items, Pa = NS.Passive;
    if (!B || !W || !EL || !IT) return null;
    var tx = e.x + HOP_DX[face], ty = e.y + HOP_DY[face], tz = e.z + HOP_DZ[face];
    var st = W.getBlock(tx, ty, tz), bn = st === 0 ? 'air' : NS.Reg.names[NS.States.block[st]];
    var done = false;
    if ((bn === 'beehive' || bn === 'bee_nest') && B.propName(st, 'honey_level') === '5' && NS.Bee) {
      EL.dropStack(tx + 0.5, ty + 0.5, tz + 0.5, IT.of('honeycomb'), 3);
      NS.Bee.takeHoney(tx, ty, tz, null);
      done = true;
    }
    for (var i = 0; !done && i < EL.list.length; i++) {
      var m = EL.list[i];
      if ((m.type !== 'sheep' && m.type !== 'mooshroom' && m.type !== 'snow_golem') || m.removed || m.dead || m.spectator) continue;
      var hw = (m.width || 0.9) / 2;
      if (m.x + hw <= tx || m.x - hw >= tx + 1 || m.z + hw <= tz || m.z - hw >= tz + 1 ||
          m.y + (m.height || 1.3) <= ty || m.y >= ty + 1) continue;
      if (m.type === 'mooshroom') {
        var mr = NS.Mooshroom && NS.Mooshroom.shear(m);
        if (!mr) continue;
        NS.Mooshroom.applyShear(m, mr);
        done = true;
        continue;
      }
      if (m.type === 'snow_golem') {
        if (!NS.SnowGolem || !NS.SnowGolem.shearAt(m)) continue;
        done = true;
        continue;
      }
      var r = Pa && Pa.shear(m, rnd);
      if (!r) continue;
      EL.dropStack(m.x, m.y + (m.height || 1.3) * 1.0, m.z, IT.of(r.item), r.count);
      done = true;
    }
    if (!done) return false;
    var src = e.items[slot], max = IT.durability ? IT.durability[src.i | 0] : 0;
    src.d = (src.d | 0) + 1;
    if (max && src.d >= max) e.items[slot] = null;
    return true;
  }
  /**
   * `DispenserBehavior` GLASS_BOTTLE (tryPutFilledBottle): a beehive/bee_nest at honey_level >= 5 -> `takeHoney` and a
   * honey_bottle; else water (block or waterlogged) in front -> a water potion; else the default throw. The filled bottle
   * replaces a lone bottle, else goes to the first free slot (thrown if full).
   */
  function glassBottleBehavior(e, slot, name, face, rnd) {
    var B = NS.Behave, W = NS.World, I = NS.Inventory;
    if (!B || !W || !I) return null;
    var tx = e.x + HOP_DX[face], ty = e.y + HOP_DY[face], tz = e.z + HOP_DZ[face];
    var st = W.getBlock(tx, ty, tz), bn = st === 0 ? 'air' : NS.Reg.names[NS.States.block[st]];
    var filled = null, fname = null;
    if ((bn === 'beehive' || bn === 'bee_nest') && +B.propName(st, 'honey_level') >= 5 && NS.Bee) {
      NS.Bee.takeHoney(tx, ty, tz, null);
      fname = 'honey_bottle';
      filled = I.stack(fname, 1);
    } else if (bn === 'water' || (st !== 0 && B.propName(st, 'waterlogged') === 'true')) {
      fname = 'potion';
      filled = I.stack(fname, 1, 0, { Potion: 'minecraft:water' });
    }
    if (!filled) return BE.dispenseThrowFrom(e, slot, name, face, rnd);
    var src = e.items[slot];
    src.n--;
    if (src.n <= 0) { e.items[slot] = filled; return true; }
    for (var i = 0; i < 9; i++) if (I.isEmpty(e.items[i])) { e.items[i] = filled; return true; }
    BE.dispenseThrow(e, face, fname, rnd);
    return true;
  }
  /**
   * `DispenserBehavior` SADDLE (Fallible): the FIRST unsaddled Saddleable that canBeSaddled in the front
   * cell is saddled (pig / strider via their own modules, the horse family via `Mount.trySaddleItem`),
   * one saddle spent; otherwise null -> the default throw.
   */
  function saddleBehavior(e, slot, name, face, rnd) {
    var EL = NS.EntityList, Ps = NS.Passive, St = NS.Strider, Mn = NS.Mount;
    if (!EL) return null;
    var tx = e.x + HOP_DX[face], ty = e.y + HOP_DY[face], tz = e.z + HOP_DZ[face];
    for (var i = 0; i < EL.list.length; i++) {
      var m = EL.list[i];
      if (m.removed || m.dead || m.spectator) continue;
      var hw = (m.width || 0.9) / 2;
      if (m.x + hw <= tx || m.x - hw >= tx + 1 || m.z + hw <= tz || m.z - hw >= tz + 1 ||
          m.y + (m.height || 1) <= ty || m.y >= ty + 1) continue;
      var ok = false;
      if (m.type === 'pig') ok = !!(Ps && Ps.pigSaddle(m));
      else if (m.type === 'strider') ok = !!(St && St.saddle(m));
      else if (Mn && Mn.isMountable(m)) ok = !!Mn.trySaddleItem(m);
      else continue;
      if (!ok) continue;           // not saddleable / already saddled: keep looking
      var src = e.items[slot];
      src.n--;
      if (src.n <= 0) e.items[slot] = null;
      return true;
    }
    return null;
  }
  /**
   * `DispenserBehavior` FLINT_AND_STEEL (FallibleItemDispenserBehavior): target = the cell in front; fire if
   * it may stand there, else a campfire/candle/candle cake is lit, else TNT is primed; else the click fails
   * (`levelEvent` 1001, the item stays). Success costs the steel 1 durability and a broken one empties the slot.
   */
  function flintAndSteelBehavior(e, slot, name, face) {
    var Use = NS.Use, W = NS.World, B = NS.Behave, S = NS.States;
    if (!Use || !W || !S) return null;
    var tx = e.x + HOP_DX[face], ty = e.y + HOP_DY[face], tz = e.z + HOP_DZ[face];
    var st = W.getBlock(tx, ty, tz), ok = false;
    if (st === 0 && (!B || !B.fireCanSurvive || B.fireCanSurvive(tx, ty, tz))) {
      W.setBlock(tx, ty, tz, S.stateOf('fire'));
      if (B && B.changed) B.changed(tx, ty, tz);
      if (B && B.schedule) B.schedule(tx, ty, tz, 30, 0);
      ok = true;
    } else if (st !== 0 && Use.canBeLit(st)) {
      W.setBlock(tx, ty, tz, B.setProp(st, 'lit', true));
      if (B.changed) B.changed(tx, ty, tz);
      ok = true;
    } else if (st !== 0 && NS.Reg.names[S.block[st]] === 'tnt') {
      Use.primeTnt(null, tx, ty, tz, st);
      ok = true;
    }
    if (!ok) return false;
    var src = e.items[slot], max = NS.Items.durability ? NS.Items.durability[src.i | 0] : 0;
    if (max) {
      src.d = (src.d | 0) + 1;
      if (src.d >= max) e.items[slot] = null;
    }
    return true;
  }
  /**
   * FIRE_CHARGE (.decomp DispenserBehavior:310): output location + facing * 0.3 (float), power = facing +
   * `random.nextGaussian() * 0.05` per axis (Box-Muller over `rnd`), a `SmallFireballEntity`; one item used.
   */
  BE.FIRE_CHARGE_SPREAD = 0.05;
  BE.FIRE_CHARGE_OFFSET = 0.3;
  function fireChargeBehavior(e, slot, name, face, rnd) {
    var EL = NS.EntityList;
    if (!EL || !EL.ready || !EL.canSpawn('small_fireball')) return null;
    var g = function () { return NS.U.polarGaussian(rnd); };
    var p = BE.dispensePosition(e, face), o = BE.FIRE_CHARGE_OFFSET;
    var px = g() * BE.FIRE_CHARGE_SPREAD + HOP_DX[face];
    var py = g() * BE.FIRE_CHARGE_SPREAD + HOP_DY[face];
    var pz = g() * BE.FIRE_CHARGE_SPREAD + HOP_DZ[face];
    var ent = EL.spawn('small_fireball', p[0] + Math.fround(HOP_DX[face] * o), p[1] + Math.fround(HOP_DY[face] * o),
                       p[2] + Math.fround(HOP_DZ[face] * o), { power: [px, py, pz] });
    if (!ent) return null;
    var src = e.items[slot];
    src.n--;
    if (src.n <= 0) e.items[slot] = null;
    return true;
  }
  /**
   * `ArmorItem.dispenseArmor` (shared by the ArmorItem, ElytraItem, carved pumpkin and skull entries): the
   * first non-spectator LivingEntity in the facing block whose preferred slot for the item is EMPTY
   * (`EntityPredicates.Equipable`) gets a copy of one; a MobEntity then has that slot's drop chance set to
   * 2.0 and is made persistent. None -> null, so the item is thrown (FallibleItemDispenserBehavior).
   */
  BE.ARMOUR_DROP_CHANCE = 2.0;
  function equipBehavior(e, slot, name, face) {
    var IT = NS.Items, Eq = NS.Equip, I = NS.Inventory, P = NS.Player, EL = NS.EntityList;
    if (!IT || !IT.ready || !Eq || !I) return null;
    var src = e.items[slot], es = Eq.preferredSlot(src);
    if (es < IT.FEET) return null;
    var x0 = e.x + HOP_DX[face], y0 = e.y + HOP_DY[face], z0 = e.z + HOP_DZ[face];
    function hits(x, y, z, w, h) {
      return x + w / 2 > x0 && x - w / 2 < x0 + 1 && y + h > y0 && y < y0 + 1 && z + w / 2 > z0 && z - w / 2 < z0 + 1;
    }
    var cands = [];
    if (P && P.inventory && P.mode !== 3 && hits(P.x, P.y, P.z, P.width || 0.6, P.height || 1.8)) cands.push(P);
    var list = (EL && EL.list) || [];
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (m.dead || m.removed || m.mode === 3 || !(m.type === 'armor_stand' || NS.Entities.isLiving(m.type))) continue;
      if (hits(m.x, m.y, m.z, m.width || 0.6, m.height || 1.8)) cands.push(m);
    }
    for (var k = 0; k < cands.length; k++) {
      var t = cands[k], one = I.stack(name, 1, src.d || 0, src.t || null);
      if (t === P) {
        var idx = I.ARMOR_START + (es - IT.FEET);
        if (!I.isEmpty(P.inventory.slots[idx])) continue;
        P.inventory.slots[idx] = one;
      } else {
        if (Eq.getEquipped(t, es)) continue;
        Eq.setEquipped(t, es, one);
        if (t.type !== 'armor_stand') { Eq.setDropChance(t, es, BE.ARMOUR_DROP_CHANCE); t.persistent = true; }
      }
      src.n--;
      if (src.n <= 0) e.items[slot] = null;
      return true;
    }
    return null;
  }
  /**
   * `DispenserBehavior` horse armour + 16 carpets (FallibleItemDispenserBehavior): the first living
   * `HorseBaseEntity` in the front cell with `hasArmorSlot()` (horse armour; a llama's carpet slot)
   * that accepts the item, has slot 1 empty and is tame gets `stack.split(1)` in slot 1. Else null (thrown).
   */
  function horseArmourBehavior(e, slot, name, face) {
    var Mnt = NS.Mount, EL = NS.EntityList, I = NS.Inventory;
    if (!Mnt || !EL || !I) return null;
    var x0 = e.x + HOP_DX[face], y0 = e.y + HOP_DY[face], z0 = e.z + HOP_DZ[face];
    for (var i = 0; i < EL.list.length; i++) {
      var m = EL.list[i];
      if (m.dead || m.removed || m.spectator || !(Mnt.hasArmorSlot(m) || Mnt.hasDecorSlot(m))) continue;
      var hw = (m.width || 0.9) / 2, h = m.height || 1.6;
      if (m.x + hw <= x0 || m.x - hw >= x0 + 1 || m.z + hw <= z0 || m.z - hw >= z0 + 1 || m.y + h <= y0 || m.y >= y0 + 1) continue;
      var ok = Mnt.hasDecorSlot(m) ? Mnt.isCarpetItem(name) : Mnt.isHorseArmor(name);
      if (!ok || !m.tamed || (m.mountItems && m.mountItems[1])) continue;
      var bank = m.mountItems = m.mountItems || [null, null];
      var src = e.items[slot];
      bank[1] = I.split(src, 1);
      if (src.n <= 0) e.items[slot] = null;
      if (Mnt.hasDecorSlot(m)) {
        var before = m.carpetColor, ci = Mnt.carpetColorIndex(name);
        m.carpetColor = ci >= 0 ? ci : null;
        if (NS.Llama) NS.Llama.onCarpetChanged(m, before);
      } else Mnt.equipArmor(m, name);
      return true;
    }
    return null;
  }
  /**
   * `DispenserBehavior` Items.WITHER_SKELETON_SKULL (Fallible): front cell air AND `WitherSkullBlock.canDispense`
   * (y >= bottom+2, not peaceful, the wither pattern completes with this skull) -> standing skull, rotation
   * 0 for vertical else opposite-facing horizontal index * 4, shrink 1; else `ArmorItem.dispenseArmor`. The
   * other five heads are plain dispenseArmor (equipBehavior). canDispense is tried by placing: `BE.onChanged`
   * runs the summon, which clears the skull; a skull still standing means no pattern, so it is taken back.
   */
  var SKULL_ROT = [0, 0, 8, 0, 12, 4];   // dispenser face (D,U,N,S,W,E) -> opposite.getHorizontal()*4 (S0 W4 N8 E12)
  function witherSkullBehavior(e, slot, name, face) {
    var W = NS.World, S = NS.States, Bh = NS.Behave;
    var x = e.x + HOP_DX[face], y = e.y + HOP_DY[face], z = e.z + HOP_DZ[face];
    if (W && S && Bh && Bh.setProp && W.getBlock(x, y, z) === 0 && y >= NS.CFG.WORLD_MIN_Y + 2 && y < NS.CFG.WORLD_MAX_Y) {
      var st = Bh.setProp(S.stateOf('wither_skeleton_skull') | 0, 'rotation', SKULL_ROT[face]);
      if (W.setBlock(x, y, z, st)) {
        if (S.name(W.getBlock(x, y, z)) === 'wither_skeleton_skull') W.setBlock(x, y, z, 0);   // no pattern: canDispense was false
        else {
          var src = e.items[slot];
          src.n--;
          if (src.n <= 0) e.items[slot] = null;
          return true;
        }
      }
    }
    return equipBehavior(e, slot, name, face);
  }
  function registerEquipables() {
    var IT = NS.Items;
    if (!IT || !IT.ready) return;
    for (var i = 0; i < IT.count; i++) {
      var n = IT.nameOf(i);
      if (IT.equipSlot(i) >= IT.FEET && !BE.DISPENSE_BEHAVIORS[n]) BE.DISPENSE_BEHAVIORS[n] = equipBehavior;
    }
    BE.DISPENSE_BEHAVIORS.wither_skeleton_skull = witherSkullBehavior;
  }
  /**
   * `DispenserBehavior` Items.CHEST (Fallible): the first live, tame, chestless `AbstractDonkeyEntity`
   * (donkey, mule, llama, trader llama) in the front cell gets the chest (`getStackReference(499).set`); else null = thrown.
   */
  function chestBehavior(e, slot, name, face) {
    var Mnt = NS.Mount || NS.Mnt, EL = NS.EntityList;
    if (!Mnt || !Mnt.addChest || !EL) return null;
    var tx = e.x + HOP_DX[face], ty = e.y + HOP_DY[face], tz = e.z + HOP_DZ[face];
    for (var i = 0; i < EL.list.length; i++) {
      var m = EL.list[i];
      if (m.removed || m.dead || m.hasChest || !m.tamed || !Mnt.isChestable(m)) continue;
      var hw = (m.width || 0.9) / 2;
      if (m.x + hw <= tx || m.x - hw >= tx + 1 || m.z + hw <= tz || m.z - hw >= tz + 1 ||
          m.y + (m.height || 1.6) <= ty || m.y >= ty + 1) continue;
      Mnt.addChest(m);
      var src = e.items[slot];
      src.n--;
      if (src.n <= 0) e.items[slot] = null;
      return true;
    }
    return null;
  }
  /**
   * `BlockPlacementDispenserBehavior` (jack_o_lantern and the 17 shulker boxes): `BlockItem.place` with an
   * `AutomaticItemPlacementContext(front, facing, stack, side)`, side = facing when the cell below the front cell is
   * air, else UP. Fails (click, item kept) when the front cell is not replaceable. The state is the player-side
   * `P.placementState` (shulker: the side; carved pumpkin: opposite of the horizontal facing, NORTH-based for UP/DOWN),
   * hit at the cell's bottom centre. The stack's `BlockEntityTag` Items/CustomName go into the placed block entity.
   */
  var PLACE_PFACE = [2, 3, 5, 4, 1, 0];                   // dispenser face -> Player.placementState face numbering
  var PLACE_YAW = [0, 0, 0, Math.PI, 3 * Math.PI / 2, Math.PI / 2];   // horizontal facing as an engine yaw (vertical -> north)
  function blockPlacementBehavior(e, slot, name, face) {
    var W = NS.World, P = NS.Player, S = NS.States, I = NS.Inventory;
    if (!W || !P || !P.placementState || !S || !I) return null;
    var id = S.stateOf(name) | 0;
    if (id <= 0) return false;
    var x = e.x + HOP_DX[face], y = e.y + HOP_DY[face], z = e.z + HOP_DZ[face];
    if (y < NS.CFG.WORLD_MIN_Y || y >= NS.CFG.WORLD_MAX_Y) return false;
    var side = W.getBlock(x, y - 1, z) === 0 ? face : 0;
    var pf = PLACE_PFACE[side];
    if (!S.canBeReplacedBy(W.getBlock(x, y, z), id, pf, y, true)) return false;
    var st = P.placementState(id, pf, x + 0.5, y, z + 0.5, PLACE_YAW[face]);
    if (NS.Behave && NS.Behave.ready) st = NS.Behave.place(st, x, y, z);
    if (!W.setBlock(x, y, z, st)) return false;
    if (NS.Save && NS.Save.record) NS.Save.record(x, y, z, st);
    var src = e.items[slot], tag = src.t && src.t.BlockEntityTag;
    var be = BE.get(x, y, z);
    if (be && be.items && tag) {
      if (tag.CustomName !== undefined) be.customName = tag.CustomName;
      var its = tag.Items || [];
      for (var k = 0; k < its.length; k++) {
        var it = its[k], nm = String(it.id || '').replace(/^minecraft:/, ''), sl = it.Slot | 0;
        if (sl >= 0 && sl < be.items.length) { var os = I.stack(nm, (it.Count | 0) || 1, 0, it.tag || null); if (!I.isEmpty(os)) be.items[sl] = os; }
      }
    }
    if (NS.SnowGolem && NS.SnowGolem.onBlockAdded) NS.SnowGolem.onBlockAdded(x, y, z);
    if (NS.Sound) NS.Sound.blockPlace(st, x + 0.5, y + 0.5, z + 0.5, P);
    src.n--;
    if (src.n <= 0) e.items[slot] = null;
    return true;
  }
  /** `DispenserBehavior.registerDefaults`' registry, by item name; each entry returns null (= not handled), or true/false. */
  /**
   * `BoatDispenserBehavior` (the six boat items): spawn point = dispenser centre + facing * fround(1.125); water in the
   * front cell -> y + 1.0, else air in front over water -> y + 0.0, else null (ItemDispenserBehavior throws it).
   */
  function boatBehavior(wood) {
    return function (e, slot, name, face) {
      var EL = NS.EntityList, W = NS.World, SR = NS.States, Bt = NS.Boat;
      if (!EL || !EL.ready || !W || !SR || !Bt) return null;
      var dx = HOP_DX[face], dy = HOP_DY[face], dz = HOP_DZ[face];
      var fx = e.x + dx, fy = e.y + dy, fz = e.z + dz, oy;
      if (SR.fluidKind[W.getBlock(fx, fy, fz)] === 1) oy = 1.0;
      else if (W.getBlock(fx, fy, fz) === 0 && SR.fluidKind[W.getBlock(fx, fy - 1, fz)] === 1) oy = 0.0;
      else return null;
      var r = Math.fround(1.125);
      var ent = EL.spawn('boat', e.x + 0.5 + Math.fround(dx * r), e.y + 0.5 + Math.fround(dy * r) + oy,
                         e.z + 0.5 + Math.fround(dz * r), { boatType: wood });
      if (!ent) return null;
      ent.boatType = wood;
      ent.yaw = dx > 0 ? 270 : dx < 0 ? 90 : dz < 0 ? 180 : dz > 0 ? 0 : 270;   // Direction.asRotation ((idHorizontal & 3) * 90)
      var src = e.items[slot];
      src.n--;
      if (src.n <= 0) e.items[slot] = null;
      return true;
    };
  }
  /** `DispenserBehavior` Items.CARVED_PUMPKIN (Fallible): front cell air and `CarvedPumpkinBlock.canDispense`
   *  (snow or iron golem pattern would complete with a pumpkin there) -> place it (onBlockAdded builds the golem);
   *  else `ArmorItem.dispenseArmor`. */
  function carvedPumpkinBehavior(e, slot, name, face) {
    var W = NS.World, SR = NS.States, R = NS.Reg, SG = NS.SnowGolem;
    if (W && SR && R && SG && SG.searchGolemPattern) {
      var x = e.x + HOP_DX[face], y = e.y + HOP_DY[face], z = e.z + HOP_DZ[face];
      if (W.getBlock(x, y, z) === 0) {
        var nameAt = function (bx, by, bz) {
          if (bx === x && by === y && bz === z) return 'carved_pumpkin';
          var st = W.getBlock(bx, by, bz); return st > 0 ? R.names[SR.block[st]] : 'air';
        };
        var ok = !!SG.searchIronGolemPattern(nameAt, x, y, z) ||
          !!SG.searchGolemPattern(nameAt, function (n) { return !!SG.HEAD_BLOCKS[n]; }, x, y, z);
        if (ok) return blockPlacementBehavior(e, slot, name, face);
      }
    }
    return equipBehavior(e, slot, name, face);
  }
  /**
   * `MinecartItem.DISPENSER_BEHAVIOR`: spawn x/z = centre + facing * 1.125, y = block y + facing.y + d, where d is
   * 0.1 on a rail (0.6 ascending), or over a rail with air in front -0.9 (-0.4 when the rail below ascends and the
   * dispenser does not face down); anything else is null (thrown as an item).
   */
  var MINECARTS = { minecart: 'minecart', chest_minecart: 'chest_minecart', furnace_minecart: 'furnace_minecart',
    hopper_minecart: 'hopper_minecart', tnt_minecart: 'tnt_minecart', command_block_minecart: 'command_block_minecart' };
  function minecartBehavior(type) {
    return function (e, slot, name, face) {
      var EL = NS.EntityList, W = NS.World, Rl = NS.Rail;
      if (!EL || !EL.ready || !W || !Rl) return null;
      var dx = HOP_DX[face], dy = HOP_DY[face], dz = HOP_DZ[face];
      var fx = e.x + dx, fy = e.y + dy, fz = e.z + dz, st = W.getBlock(fx, fy, fz), d;
      if (Rl.isRail(st)) d = Rl.isAscending(Rl.shapeOf(st)) ? 0.6 : 0.1;
      else {
        var below = W.getBlock(fx, fy - 1, fz);
        if (st !== 0 || !Rl.isRail(below)) return null;
        d = (face !== 0 && Rl.isAscending(Rl.shapeOf(below))) ? -0.4 : -0.9;
      }
      var src = e.items[slot];
      var ent = EL.spawn(type, e.x + 0.5 + dx * 1.125, e.y + dy + d, e.z + 0.5 + dz * 1.125, {});
      if (!ent) return null;
      var nm = src.nbt && src.nbt.name;
      if (!nm && src.t && src.t.display && src.t.display.Name) { try { nm = JSON.parse(src.t.display.Name).text; } catch (x) { nm = null; } }
      if (nm) ent.cartName = nm;
      src.n--;
      if (src.n <= 0) e.items[slot] = null;
      return true;
    };
  }
  BE.DISPENSE_BEHAVIORS = {
    carved_pumpkin: carvedPumpkinBehavior,
    arrow: projectileBehavior('arrow'),
    tipped_arrow: projectileBehavior('arrow'),
    spectral_arrow: projectileBehavior('spectral_arrow'),
    snowball: projectileBehavior('snowball'),
    egg: projectileBehavior('egg'),
    // `FallibleItemDispenserBehavior` for BONE_MEAL: useOnFertilizable, else useOnGround, else fail (item kept, click only)
    bone_meal: function (e, slot, name, face, rnd) {
      var U = NS.Use, W = NS.World;
      if (!U || !W) return null;
      var tx = e.x + HOP_DX[face], ty = e.y + HOP_DY[face], tz = e.z + HOP_DZ[face];
      var src = e.items[slot];
      var probe = { i: src.i, n: 1, d: src.d, t: src.t || null };
      var prev = NS.EntityList && NS.EntityList.random;
      if (NS.EntityList) NS.EntityList.random = rnd;
      var hit;
      try {
        hit = U.itemUseOn({ instabuild: true }, tx, ty, tz, 1, W.getBlock(tx, ty, tz), probe) || U.boneMealGround(tx, ty, tz, rnd);
      } finally { if (NS.EntityList) NS.EntityList.random = prev; }
      if (!hit) return false;                           // setSuccess(false): the click, the item stays
      var s0 = e.items[slot];
      s0.n--;
      if (s0.n <= 0) e.items[slot] = null;
      return true;
    },
    // `SpawnEggItem` entries (every `*_spawn_egg`, looked up by `dispenseFrom`): spawnFromItemStack(
    // pos.offset(facing), DISPENSER, alignPosition = facing != UP, invertY = false) — the cell in FRONT.
    _spawn_egg: function (e, slot, name, face, rnd) {
      var U = NS.Use, EL = NS.EntityList;
      var type = name.slice(0, name.length - 10);
      if (!U || !U.spawnFromEgg || !EL || !EL.ready || !EL.canSpawn(type)) return null;
      var mob = U.spawnFromEgg(type, e.x + HOP_DX[face], e.y + HOP_DY[face], e.z + HOP_DZ[face], face !== 0, false, rnd);
      if (!mob) return null;
      var src = e.items[slot];
      src.n--;
      if (src.n <= 0) e.items[slot] = null;
      return true;
    },
    // ArmorStand (DispenserBehavior:202): spawn at front+0.5, EntityTag loaded, yaw = facing.asRotation()
    armor_stand: function (e, slot, name, face, rnd) {
      var EL = NS.EntityList, AS = NS.ArmorStand;
      if (!EL || !EL.ready || !AS || face < 2 || !EL.canSpawn('armor_stand')) return null;
      var src = e.items[slot];
      var ent = EL.spawn('armor_stand', e.x + HOP_DX[face] + 0.5, e.y + HOP_DY[face], e.z + HOP_DZ[face] + 0.5);
      if (!ent) return null;
      if (src.t && src.t.EntityTag) AS.readNbt(ent, src.t.EntityTag);
      var rot = [0, 0, 180, 0, 90, 270][face];             // Direction.asRotation (south 0, west 90, north 180, east 270)
      ent.yaw = (rot + 180) * Math.PI / 180;               // engine yaw = vanilla + 180deg (D-415)
      src.n--;
      if (src.n <= 0) e.items[slot] = null;
      return true;
    },
    flint_and_steel: flintAndSteelBehavior,
    fire_charge: fireChargeBehavior,
    oak_boat: boatBehavior('oak'), spruce_boat: boatBehavior('spruce'), birch_boat: boatBehavior('birch'),
    jungle_boat: boatBehavior('jungle'), acacia_boat: boatBehavior('acacia'), dark_oak_boat: boatBehavior('dark_oak'),
    // FireworkRocketDispenserBehavior: force 0.5, uncertainty 1.0, stack tag kept (#5163)
    firework_rocket: function (e, slot, name, face, rnd) {
      var EL = NS.EntityList, Po = NS.Potion;
      if (!EL || !EL.ready || !Po || !NS.Firework || !EL.canSpawn('firework_rocket')) return null;
      var p = BE.dispensePosition(e, face);
      var v = Po.throwVelocity(HOP_DX[face], HOP_DY[face], HOP_DZ[face], 0.5, 1.0, rnd);
      var src = e.items[slot];
      var ent = EL.spawn('firework_rocket', p[0], p[1], p[2], { vx: v.vx, vy: v.vy, vz: v.vz });
      if (!ent) return null;
      ent.tag = src.t || { Fireworks: { Flight: 1, Explosions: [] } };
      NS.Firework.init(ent);
      src.n--;
      if (src.n <= 0) e.items[slot] = null;
      return true;
    },
    experience_bottle: projectileBehavior('experience_bottle', true),
    splash_potion: projectileBehavior('potion', true, false),
    lingering_potion: projectileBehavior('potion', true, true),
    shears: shearsBehavior,
    glass_bottle: glassBottleBehavior,
    // DispenserBehavior.java:589 HONEYCOMB (Fallible): HoneycombItem.getWaxedState(front) -> setBlockState, event 3003, decrement; else the default throw
    honeycomb: function (e, slot, name, face, rnd) {
      var Ox = NS.Oxidize, W = NS.World;
      if (!Ox || !W) return null;
      var tx = e.x + HOP_DX[face], ty = e.y + HOP_DY[face], tz = e.z + HOP_DZ[face];
      var waxed = Ox.waxed(W.getBlock(tx, ty, tz));
      if (waxed === null) return null;
      W.setBlock(tx, ty, tz, waxed);
      if (NS.Particle && NS.Particle.worldEvent) NS.Particle.worldEvent(3003, tx, ty, tz, 0);
      var src = e.items[slot];
      src.n--;
      if (src.n <= 0) e.items[slot] = null;
      return true;
    },
    // DispenserBehavior GLOWSTONE (OptionalDispenseItemBehavior): respawn_anchor in front with CHARGES != 4 -> RespawnAnchorBlock.charge (+1, respawn_anchor.charge), shrink 1; else the default throw
    glowstone: function (e, slot, name, face, rnd) {
      var Bh = NS.Behave, W = NS.World, S = NS.States;
      if (!Bh || !W || !Bh.setProp || !Bh.propName) return null;
      var tx = e.x + HOP_DX[face], ty = e.y + HOP_DY[face], tz = e.z + HOP_DZ[face];
      var st = W.getBlock(tx, ty, tz);
      if (S.name(st) !== 'respawn_anchor') return null;
      var c = +Bh.propName(st, 'charges');
      if (!(c < 4)) return null;
      W.setBlock(tx, ty, tz, Bh.setProp(st, 'charges', c + 1));
      if (NS.Sound && NS.Sound.play) NS.Sound.play('block.respawn_anchor.charge', { x: tx + 0.5, y: ty + 0.5, z: tz + 0.5, source: 'block', pitch: 1, volume: 1 });
      var src = e.items[slot];
      src.n--;
      if (src.n <= 0) e.items[slot] = null;
      return true;
    },
    saddle: saddleBehavior,
    // DispenserBehavior TNT: new TntEntity(front.x+.5, front.y, front.z+.5, null), fuse 80, TNT_PRIMED sound
    tnt: function (e, slot, name, face, rnd) {
      var EL = NS.EntityList;
      if (!EL || !EL.ready || !EL.canSpawn('tnt')) return null;
      var x = e.x + HOP_DX[face], y = e.y + HOP_DY[face], z = e.z + HOP_DZ[face];
      if (!EL.spawn('tnt', x + 0.5, y, z + 0.5, { fuse: 80 })) return null;
      if (NS.GameEvent) NS.GameEvent.emit('prime_fuse', x + 0.5, y, z + 0.5, null);
      if (NS.Sound && NS.Sound.play) NS.Sound.play('entity.tnt.primed', { x: x + 0.5, y: y, z: z + 0.5, source: 'block', pitch: 1, volume: 1 });
      var src = e.items[slot];
      src.n--;
      if (src.n <= 0) e.items[slot] = null;
      return true;
    },
    leather_horse_armor: horseArmourBehavior,
    iron_horse_armor: horseArmourBehavior,
    golden_horse_armor: horseArmourBehavior,
    diamond_horse_armor: horseArmourBehavior,
    chest: chestBehavior,
    jack_o_lantern: blockPlacementBehavior
  };
  ['', 'white_', 'orange_', 'magenta_', 'light_blue_', 'yellow_', 'lime_', 'pink_', 'gray_', 'light_gray_', 'cyan_', 'purple_',
   'blue_', 'brown_', 'green_', 'red_', 'black_'].forEach(function (c) { BE.DISPENSE_BEHAVIORS[c + 'shulker_box'] = blockPlacementBehavior; });
  ['white','orange','magenta','light_blue','yellow','lime','pink','gray','light_gray','cyan','purple','blue','brown','green','red','black']
    .forEach(function (c) { BE.DISPENSE_BEHAVIORS[c + '_carpet'] = horseArmourBehavior; });
  Object.keys(MINECARTS).forEach(function (k) { BE.DISPENSE_BEHAVIORS[k] = minecartBehavior(MINECARTS[k]); });
  BE.DISPENSE_BEHAVIORS.fire_charge.event = 1018;        // playSound: syncWorldEvent(1018)
  BE.DISPENSE_BEHAVIORS.firework_rocket.event = 1004;    // playSound: syncWorldEvent(1004)
  BE.registerEquipables = registerEquipables;

  /** `ItemDispenserBehavior` for one item of `slot`: throw it and take it out of the slot. */
  BE.dispenseThrowFrom = function (e, slot, name, face, rnd) {
    if (!BE.dispenseThrow(e, face, name, rnd)) return false;
    var src = e.items[slot];
    src.n--;
    if (src.n <= 0) e.items[slot] = null;
    return true;
  };

  /**
   * `DispenserBlock.dispenseFrom` / `DropperBlock.dispenseFrom` — one slot, one item, one ending.
   * Returns true if anything left the block.
   */
  /** `syncWorldEvent` 1000/1001/1002/2000 for a dispenser at `e`: the sound (WorldRenderer 2742-2750) and,
   *  for 2000, the smoke along `face` (a BE face index -> Direction id). `BE.eventLog` records when an array. */
  BE.dispenseEvent = function (e, id, face, rnd) {
    if (BE.eventLog) BE.eventLog.push({ id: id, x: e.x, y: e.y, z: e.z, face: face });
    var Snd = NS.Sound, ev = id === 1000 ? ['block.dispenser.dispense', 1] : id === 1001 ? ['block.dispenser.fail', 1.2] :
      id === 1002 ? ['block.dispenser.launch', 1.2] : id === 1004 ? ['entity.firework_rocket.shoot', 1.2] : null;
    if (ev && Snd && Snd.entitySound) Snd.entitySound(ev[0], e.x + 0.5, e.y + 0.5, e.z + 0.5, 1, ev[1], 'block', NS.Player);
    // 1029 anvil.destroy / 1031 anvil.land: pitch rand * 0.1 + 0.9 (WorldRenderer), volumes 1 / 0.3
    if ((id === 1029 || id === 1031) && Snd && Snd.entitySound)
      Snd.entitySound(id === 1029 ? 'block.anvil.destroy' : 'block.anvil.land', e.x + 0.5, e.y + 0.5, e.z + 0.5, id === 1029 ? 1 : 0.3, (rnd || Math.random)() * 0.1 + 0.9, 'block', NS.Player);
    // 1018: blaze shoot at volume 2.0, pitch (r - r) * 0.2 + 1.0 (WorldRenderer 2806)
    if (id === 1018 && Snd && Snd.entitySound) Snd.entitySound('entity.blaze.shoot', e.x + 0.5, e.y + 0.5, e.z + 0.5, 2, ((rnd || Math.random)() - (rnd || Math.random)()) * 0.2 + 1, 'hostile', NS.Player);
    // 1017: ender dragon shoot at volume 10.0, pitch (r - r) * 0.2 + 1.0 (WorldRenderer case 1017)
    if (id === 1017 && Snd && Snd.entitySound) Snd.entitySound('entity.ender_dragon.shoot', e.x + 0.5, e.y + 0.5, e.z + 0.5, 10, ((rnd || Math.random)() - (rnd || Math.random)()) * 0.2 + 1, 'hostile', NS.Player);
    if (id === 2000 && NS.Particle && NS.Particle.worldEvent) NS.Particle.worldEvent(2000, e.x, e.y, e.z, face === 0 ? 1 : face === 1 ? 0 : face, rnd);
  };

  BE.dispenseFrom = function (e, rnd) {
    var I = NS.Inventory;
    if (!I) return false;
    var slot = BE.dispenserRandomSlot(e, rnd);
    if (slot < 0) { BE.dispenseEvent(e, 1001, 0, rnd); if (NS.GameEvent) NS.GameEvent.emit('dispense_fail', e.x, e.y, e.z, null); return false; }   // the empty click
    var src = e.items[slot];
    var name = NS.Items.nameOf(src.i);
    var face = BE.dispenserFacing(e);
    var moved = false;
    if (e.type === 'dropper') {
      var tx = e.x + HOP_DX[face], ty = e.y + HOP_DY[face], tz = e.z + HOP_DZ[face];
      var target = BE.get(tx, ty, tz);
      var cr = target ? null : BE.composterInsert(tx, ty, tz, name, rnd);
      if (cr !== null) {
        if (!cr) return false;                        // level 7/8 or not compostable: keeps its item
        moved = true;
      } else if (target && BE.isHopperTarget(target.type) && target.items) {
        var one = I.stack(name, 1);
        var wasEmpty = target.type === 'hopper' && hopperEmpty(target);
        var slots = hopperSlotsFor(target.type, (face === 0) ? 1 : (face === 1) ? 0 : (face === 2) ? 3 : (face === 3) ? 2 : (face === 4) ? 5 : 4);
        for (var k = 0; k < slots.length && !moved; k++) {
          if (!hopperMayPlace(target, slots[k], one)) continue;
          if (hopperPut(target, slots[k], one)) moved = true;
        }
        if (!moved) return false;                     // a full target: the dropper keeps its item
        BE.hopperArm(target, wasEmpty, e);
      } else {
        var Mc = NS.Minecart, inv = !target && Mc && Mc.getInventoryAt ? Mc.getInventoryAt(tx, ty, tz) : null;
        if (inv && inv.cart) {                        // getInventoryAt's entity branch (VALID_INVENTORIES)
          var cart = inv.cart, size = Mc.INVENTORY[cart.type], cap = I.maxStackSize(I.stack(name, 1));
          var tagA = JSON.stringify(src.t || null);
          for (var ci = 0; ci < size && !moved; ci++) {
            var cs = cart.inventory[ci];
            if (!cs || !(cs.count > 0)) { cart.inventory[ci] = { item: name, count: 1, tag: src.t || undefined }; moved = true; }
            else if (cs.item === name && JSON.stringify(cs.tag || null) === tagA && cs.count < cap) { cs.count++; moved = true; }
          }
          if (!moved) return false;                   // a full cart: the dropper keeps its item
        } else {
          moved = BE.dispenseThrow(e, face, name, rnd);
          if (moved) { BE.dispenseEvent(e, 1000, face, rnd); BE.dispenseEvent(e, 2000, face, rnd); }
        }
      }
    } else {
      var bucket = BE.dispenseBucket(e, slot, name, face, rnd);
      if (bucket !== null) return bucket;
      if (!BE.equipablesDone) { registerEquipables(); BE.equipablesDone = true; }
      var beh = BE.DISPENSE_BEHAVIORS[name] ||
        (/_spawn_egg$/.test(name) ? BE.DISPENSE_BEHAVIORS._spawn_egg : null);
      var done = beh ? beh(e, slot, name, face, rnd || Math.random) : null;
      if (done === true) { BE.dispenseEvent(e, beh.event || (beh.projectile ? 1002 : 1000), face, rnd); BE.dispenseEvent(e, 2000, face, rnd); }
      if (done === false) BE.dispenseEvent(e, 1001, face, rnd);   // FallibleItemDispenserBehavior.playSound: !success -> 1001
      if (done !== null) return done;
      // ⚠ A DISPENSER NEVER INSERTS. With no registry entry it is `DefaultDispenseItemBehavior`,
      // which throws — into the chest's face if there is one, and out onto the floor.
      moved = BE.dispenseThrow(e, face, name, rnd);
      if (moved) { BE.dispenseEvent(e, 1000, face, rnd); BE.dispenseEvent(e, 2000, face, rnd); }
    }
    if (!moved) return false;
    src.n--;
    if (src.n <= 0) e.items[slot] = null;
    return true;
  };

  // ---------------------------------------------------------------------------
  // Persistence — loop/besave-s105. Closes the QUEUE G18e remainder "hive/block-entity
  // contents (16b_save persists no BE contents)". ONE GENERIC MECHANISM, the same shape
  // 07zw_mobnbt.js already uses for mobs: a per-TYPE field table for the plain-data fields
  // (`BE.FIELDS`) plus a shared item-array path for every type `make()` above gives an
  // `e.items` array (`Inventory.stackToJSON`/`stackFromJSON`, 14f_inventory.js — the SAME
  // `{i,n,d,t}` <-> `{n,c,d,t}` converter the player's own 41 slots already round-trip
  // through, so a chest slot and a hotbar slot are one format, not two).
  //
  // ⚠ SCOPE (D-1 style, named not silent): chest/trapped_chest/ender_chest/barrel/
  // shulker_box (27-or-fewer item slots, no other state), hopper/dropper/dispenser (items +
  // hopper's cooldown), furnace/blast_furnace/smoker (items + the burn/cook counters and
  // `recipesUsed`), beehive (the `bees` occupant list + `honeyLevel`), sign (lines/color/
  // glowing) and banner (patterns) — every kind named in the QUEUE row this unit closes.
  // beacon/lectern/jukebox/skull/bell/comparator/piston/mob_spawner keep no player-facing
  // state worth a save slot yet (comparator/piston are redstone-tick transients that settle
  // back out within a few ticks of reload; a spawner's roll is cosmetic) and are left named
  // here rather than silently included half-tested.
  // ⚠ loop/besave-s105's own OWED: what this pass's persistence does NOT reach, named rather
  // than silently included half-tested. Every one of these types keeps only COSMETIC or
  // pending-future-feature state today (no interaction path sets it beyond `make()`'s default),
  // so nothing is lost yet -- but a future unit that DOES fill one of these must add it here
  // AND to `BE.FIELDS`/`ITEM_TYPES` below, the same two-table shape sign/banner already prove.
  BE.PERSIST_OWED = [
      'bell (ringing/ticks), mob_spawner ' +
      '(entity/delay/...) -- none has a live in-game path that ' +
      'sets it away from make()\'s default yet (no beacon UI, no book-in-lectern placement, no ' +
      'player-placed head, no comparator subtract-mode reader, redstone-tick ' +
      'transients that settle within a few ticks of reload for comparator/piston) -- when one of those ships, its fields join BE.FIELDS the same way ' +
      'this pass added hopper/furnace/beehive/sign/banner.'
  ];

  BE.FIELDS = {
    hopper: ['cooldown'],
    furnace: ['burnTime', 'burnDuration', 'cookTime', 'cookTimeTotal', 'recipesUsed'],
    blast_furnace: ['burnTime', 'burnDuration', 'cookTime', 'cookTimeTotal', 'recipesUsed'],
    smoker: ['burnTime', 'burnDuration', 'cookTime', 'cookTimeTotal', 'recipesUsed'],
    // `BeehiveBlockEntity.writeNbt`/`readNbt` (.decomp lines 308-330): `Bees` (this engine's
    // `bees`, Bee.enterHive's own {id,hasNectar,ticksLeft} substrate — Bee.OWED §1 already
    // names why it is not a real `EntityData`/`TicksInHive`/`MinOccupationTicks` NBT copy, so
    // there is no per-bee mob record to thread through 07zw_mobnbt.js here) and `FlowerPos`
    // (this engine has no per-hive flowerPos field yet — Bee.findFlower re-scans live instead
    // of caching one, so there is nothing of that key to persist). `HoneyLevel` is the block
    // STATE's own property (persisted by 16b_save.js's ordinary block-edit blob already, not
    // this file), so only the block entity's own two fields are listed.
    beehive: ['bees', 'honeyLevel'],
    // `PistonBlockEntity.writeNbt`/`readNbt`: blockState, facing, progress, extending, source.
    piston: ['movedState', 'dir', 'extending', 'source', 'progress', 'lastProgress'],
    sign: ['lines', 'color', 'glowing'],
    // LecternBlockEntity.writeNbt: Book (item stack, via stackToJSON below) + Page
    lectern: ['page'],
    banner: ['patterns'],
    // SculkSensorBlockEntity.writeNbt/readNbt 'last_vibration_frequency' (int); SculkSensorBlock.getComparatorOutput reads it
    sculk_sensor: ['lastVibrationFrequency'],
    // ComparatorBlockEntity.writeNbt/readNbt 'OutputSignal'; Rs.comparatorOutput reads e.output.
    comparator: ['output'],
    // SkullBlockEntity.writeNbt SkullOwner (profile {Name,Id,...}); SkullItem copies the stack's on placement
    skull: ['owner'],
    // MobSpawnerLogic.writeNbt: SpawnData/Delay/Min,MaxSpawnDelay/SpawnCount/MaxNearbyEntities/
    // RequiredPlayerRange/SpawnRange. SpawnPotentials = e.potentials, SpawnData entity NBT = e.spawnData (#5722).
    mob_spawner: ['entity', 'delay', 'minDelay', 'maxDelay', 'count', 'spawnRange', 'maxNearbyEntities', 'requiredPlayerRange', 'potentials', 'spawnData'],
    // JukeboxBlockEntity.writeNbt RecordItem: the disc is held as its plain item name here
    jukebox: ['record'],
    // `BrewingStandBlockEntity.writeNbt`: Items, BrewTime, Fuel (ingredient re-derived from slot 3)
    brewing_stand: ['brewTime', 'fuel'],
    // `CampfireBlockEntity.writeNbt`: Items + CookingTimes (no CookingTotalTimes array here; the total is the recipe's own)
    campfire: ['cookingTimes'],
    // EndGatewayBlockEntity.writeNbt: Age, ExitPortal, ExactTeleport (teleportCooldown is not saved in vanilla)
    end_gateway: ['age', 'exitPortal', 'exactTeleport'],
    // `BeaconBlockEntity.writeNbt` (.decomp 284): Primary/Secondary (raw effect ids, null = none),
    // Levels, CustomName. The beam is recomputed by the tick, never saved.
    beacon: ['levels', 'primary', 'secondary', 'customName'],
    // BaseCommandBlock.writeNbt + CommandBlockEntity.writeNbt: Command, SuccessCount, LastOutput, TrackOutput, powered, conditionMet, auto
    command_block: ['command', 'successCount', 'lastOutput', 'trackOutput', 'powered', 'conditionMet', 'auto']
  };

  /** `BeaconBlockEntity.EFFECTS` raw ids: speed, haste, resistance, jump boost, strength, regeneration. */
  var BEACON_EFFECTS = { 1: 1, 3: 1, 11: 1, 8: 1, 5: 1, 10: 1 };
  /** `getPotionEffectById`: an id outside EFFECTS reads back as null. */
  BE.beaconEffectById = function (id) { return (typeof id === 'number' && BEACON_EFFECTS[id]) ? id : null; };

  /** Types whose `make()` gives them an `e.items` array — the shared item-slot path below. */
  var ITEM_TYPES = {
    chest: 1, trapped_chest: 1, ender_chest: 1, barrel: 1, shulker_box: 1,
    hopper: 1, dropper: 1, dispenser: 1, furnace: 1, blast_furnace: 1, smoker: 1, brewing_stand: 1, campfire: 1
  };

  /** Every block entity in the live store -> plain JSON records, keyed by position (16b_save.js's
   *  own S.save is the only caller, mirroring `MobNbt.serializeAll`'s shape exactly). */
  BE.serializeAll = function () {
    if (!BE.ready) return [];
    var Iv = NS.Inventory;
    var out = [];
    BE.forEach(function (e) {
      var rec = { x: e.x, y: e.y, z: e.z, type: e.type };
      if (ITEM_TYPES[e.type] && e.items) {
        var arr = new Array(e.items.length);
        for (var i = 0; i < e.items.length; i++) {
          arr[i] = (Iv && Iv.stackToJSON) ? Iv.stackToJSON(e.items[i]) : null;
        }
        rec.items = arr;
      }
      if (e.type === 'lectern' && e.book && Iv && Iv.stackToJSON) rec.book = Iv.stackToJSON(e.book);
      var fields = BE.FIELDS[e.type];
      if (fields) {
        for (var j = 0; j < fields.length; j++) {
          var f = fields[j];
          if (e[f] !== undefined) rec[f] = e[f];
        }
      }
      out.push(rec);
    });
    return out;
  };

  /**
   * Reload every record. ⚠ UNLIKE `MobNbt.restoreAll` THIS DOES NOT GO THROUGH A "NATURAL
   * SPAWN" PATH, because there is none: a block entity's ONLY creation path today is
   * `BE.onChanged` reacting to a block SET, and `S.applyTo` (16b_save.js) replays saved block
   * edits straight into a section array without going through `Behave.changed` at all (ARCH's
   * own "one place a block can change" is about the LIVE game, not chunk load-in) — so a
   * reloaded chest's block STATE comes back correct but no `BlockEntities` object exists for
   * it until something asks. This mirrors the exact lazy-create fallback `BE.tryComparator`/
   * `Piston.movePiston`/`Bee.enterHive` already use for a block placed directly into `sec`
   * (07f_redstone.js:1197, 07g_piston.js:333, 07zo_bee.js:463): `BE.create` at the saved
   * position regardless of whether that chunk is generated yet — the store is a position-keyed
   * Map, not something that requires the chunk object to exist first. A record whose `type`
   * this build no longer recognises (`BE.FIELDS`/`ITEM_TYPES` both silent on it AND it is not a
   * bare recognised TYPES entry either — `TYPES` above still names it) is skipped via the same
   * `make()` default case every other unknown type already falls through to, so a renamed type
   * costs that one entity, not the load. Returns the count actually restored.
   */
  BE.restoreAll = function (records) {
    if (!BE.ready || !records || !records.length) return 0;
    var Iv = NS.Inventory;
    var n = 0;
    for (var r = 0; r < records.length; r++) {
      var rec = records[r];
      if (!rec || !rec.type || typeof rec.x !== 'number') continue;
      var e = BE.get(rec.x, rec.y, rec.z);
      if (!e || e.type !== rec.type) e = BE.create(rec.x, rec.y, rec.z, rec.type);
      if (!e) continue;
      if (rec.items && e.items) {
        for (var i = 0; i < e.items.length; i++) e.items[i] = null;
        var lim = Math.min(rec.items.length, e.items.length);
        for (var k = 0; k < lim; k++) {
          e.items[k] = (Iv && Iv.stackFromJSON) ? Iv.stackFromJSON(rec.items[k]) : null;
        }
      }
      var fields = BE.FIELDS[rec.type];
      if (fields) {
        for (var j = 0; j < fields.length; j++) {
          var f = fields[j];
          if (rec[f] !== undefined) e[f] = rec[f];
        }
      }
      if (rec.type === 'lectern') {
        var bk = (rec.book && Iv && Iv.stackFromJSON) ? Iv.stackFromJSON(rec.book) : null;
        e.book = (bk && !Iv.isEmpty(bk)) ? bk : null;
        // readNbt: Page clamped to the book's page count
        var np = (e.book && e.book.t && e.book.t.pages && e.book.t.pages.length) | 0;
        e.page = Math.max(0, Math.min(e.page | 0, Math.max(0, np - 1)));
      }
      if (rec.type === 'beacon') {
        e.primary = BE.beaconEffectById(e.primary);
        e.secondary = BE.beaconEffectById(e.secondary);
        e.levels = (e.levels | 0);
      }
      n++;
    }
    return n;
  };
})(MCL);
