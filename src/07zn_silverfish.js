// 07zn_silverfish.js — loop/silverfish + loop/infested: SilverfishEntity + all SEVEN
// InfestedBlock pairs (stone/cobblestone/deepslate, plus the stone_bricks/mossy/cracked/
// chiseled family closed by loop/infested). Runs on: MAIN THREAD ONLY. No DOM.
//
// .decomp/net/minecraft/entity/mob/SilverfishEntity.java (247 lines, read in full) and
// .decomp/net/minecraft/block/InfestedBlock.java (79 lines, read in full) are this file's whole
// source for the mob and the block. Both classes were read WHOLE before a line of this file was
// written (D-139's rule).
//
// ⚠ THE STONE-BRICK FAMILY WAS ONCE THOUGHT OWED, AND WAS NOT. loop/silverfish's own pass
// left `stone_bricks`/`mossy_stone_bricks`/`cracked_stone_bricks`/`chiseled_stone_bricks` out on
// the theory that `src/02_blocks.js` (`B`, the legacy 49-id mesher table) not defining them made
// them unplaceable. `B` stopped being the world's id space at D-100 (src/02c_states.js:5-14,
// long before this file existed) — the world cell IS a real registry state, mining reads
// `SR.hard[id]` off it directly (07d_mining.js), rendering bakes geometry off the registry's own
// model data (02c_states.js's GEOM_CUBE/GEOM_MODEL), and `04x_struct_stronghold.js:55-58` was
// already calling `A.stateOf('stone_bricks')`/mossy/cracked/chiseled for its walls and getting
// back real, breakable, renderable states the whole time. `B` today feeds nothing but the
// atlas's tile NAME constants (`B.T`; 04_worldgen.js:75, 06_atlas.js:815-834, 17_main.js:308 all
// say so). So SF.PAIRS below now carries all seven, and mining (14_player.js's `P.breakBlock`,
// unchanged — it already calls `SF.isInfested`/`SF.onBreak` by NAME, not by a fixed list) and
// the two goals below apply to the stone-brick family exactly as they already did to stone/
// cobblestone/deepslate.
//
// ⚠ WORLDGEN PLACEMENT: THE ORE ALREADY WORKS: nothing here places it. `ore_infested`
// (`.mcdata/1.18.2/data/minecraft/worldgen/{configured_feature,placed_feature}/ore_infested.
// json`: size 9, discard_chance 0, count 14, in_square, y -0..63, biome-gated) is a plain
// `minecraft:ore` feature, and `src/04j_features.js`'s `GENERATORS.ore` compiles ANY ore feature
// generically off its own JSON — there was never a per-feature-name list to extend. It was
// already reachable the moment `tools/pack-worldgen.mjs` packed the whole `worldgen/` directory
// (it globs, D-100-era design) and the nine biomes that list it (frozen_peaks, grove,
// jagged_peaks, meadow, snowy_slopes, stony_peaks, windswept_forest/gravelly_hills/hills) parsed
// clean. `tools/infestedcheck.mjs` section 4 proves this rather than assuming it.
//
// s115: STRONGHOLD WALLS DO ROLL INFESTED now — StoneBrickRandomizer (.decomp/net/minecraft/structure/
// StrongholdGenerator.java) read whole; 04x_struct_stronghold.js ST.WALL_MIX carries its 0.2/0.5/0.55 split.
(function (NS) {
  'use strict';

  var SF = NS.Silverfish = {};
  // Named gaps, not silently missing (D-30). Read together with the header's own ⚠ notes.
  SF.OWED = [
    'PowderSnowJumpGoal (priority 1) -- no generic Ai.PowderSnowJumpGoal exists yet (Rb.OWED)'
    // struck s115: stronghold walls roll infested_stone_bricks at StoneBrickRandomizer's own 5%
    // (04x_struct_stronghold.js ST.WALL_MIX) -- StrongholdGenerator.java IS in .decomp after all.
  ];
  // `NS.Ai` is already fully built by the time this module's own goal constructors run (this
  // file loads AFTER 07k_goals.js in build.mjs, and a goal's body only executes at spawn time,
  // long after every module has finished loading) — the same lazy-reference convention rabbit/
  // fox/goat's own late modules already use for `NS.Rabbit.*`/etc from inside `Ai.ROSTER`.
  function Ai_() { return NS.Ai; }

  // InfestedBlock.java:20 `REGULAR_TO_INFESTED_BLOCK` — all SEVEN pairs. The stone-brick-family
  // four (stone_bricks/mossy/cracked/chiseled) were left out of this array in the first pass of
  // this file (this file's own header used to say why) on the theory that their HOST was not a
  // placeable block in `src/02_blocks.js` (`B`, the LEGACY 49-id mesher-fast-path table). That
  // theory does not survive D-100 (src/02c_states.js:5-14): the legacy table was retired as the
  // world's id space that same session, and every hot path since — mining (07d_mining.js reads
  // `SR.hard[id]` off the REAL state, no `B` lookup), rendering (02c_states.js's own baked
  // GEOM_CUBE/GEOM_MODEL tables, derived from the registry's model data, not `B.T`) and worldgen
  // (`src/04x_struct_stronghold.js:55-58` already calls `A.stateOf('stone_bricks')`/mossy/
  // cracked/chiseled and gets back real, breakable, renderable states — a stronghold's corridor
  // walls are made of exactly this "unplaceable" family today) — already goes through the real
  // registry (`NS.Reg`/`NS.States`) alone. `B` today is read for nothing but `B.T`'s atlas tile
  // NAME constants (`src/04_worldgen.js:75`, `src/06_atlas.js:815-834`, `src/17_main.js:308`, all
  // three say so in their own comments). So the stone-brick family's HOST was never actually
  // missing; the substrate this array needed already existed, and closing the gap is just
  // adding the four pairs `assets/block-registry.json` already carries states for.
  SF.PAIRS = [
    ['stone', 'infested_stone'],
    ['cobblestone', 'infested_cobblestone'],
    ['deepslate', 'infested_deepslate'],
    ['stone_bricks', 'infested_stone_bricks'],
    ['mossy_stone_bricks', 'infested_mossy_stone_bricks'],
    ['cracked_stone_bricks', 'infested_cracked_stone_bricks'],
    ['chiseled_stone_bricks', 'infested_chiseled_stone_bricks']
  ];
  SF.TO_INFESTED = Object.create(null);
  SF.TO_REGULAR = Object.create(null);
  (function () {
    for (var i = 0; i < SF.PAIRS.length; i++) {
      SF.TO_INFESTED[SF.PAIRS[i][0]] = SF.PAIRS[i][1];
      SF.TO_REGULAR[SF.PAIRS[i][1]] = SF.PAIRS[i][0];
    }
  })();

  /** InfestedBlock.isInfestable (.decomp:34-36) — true for a REGULAR block with an infested twin. */
  SF.isInfestable = function (name) { return SF.TO_INFESTED[name] !== undefined; };
  /** Not a decomp name — the reverse test the break hook and CallForHelpGoal both need. */
  SF.isInfested = function (name) { return SF.TO_REGULAR[name] !== undefined; };

  /**
   * `InfestedBlock.fromRegularState`/`toRegularState` (.decomp:60-78) — copy every property
   * from `state` onto the paired block's default state. Vanilla walks the property LIST and
   * copies by VALUE; this registry has no per-block property-name table at runtime (02c_states.
   * js's own `SR.withLocal` header: "40 KB nobody needs"), so this ports the same practical
   * result the only way the runtime data supports it — the LOCAL state index (state minus its
   * block's own `realFirst`) carried over unchanged onto the paired block. That is exactly
   * right for stone/cobblestone (each is a single real state, local index 0 either way) and for
   * deepslate/infested_deepslate, which are schema mirrors of each other (both declare exactly
   * one property, `axis`, in the same order — the infested variant is generated FROM the host's
   * own blockstate file, not written separately). The state-count guard below is what makes
   * this safe rather than assumed: a mismatch falls back to the plain default state instead of
   * reading garbage.
   */
  function pairedState(state, fromMap) {
    var R = NS.Reg, SR = NS.States;
    if (!R || !R.ready || !SR || !SR.ready) return null;
    var block = SR.block[state];
    var fromName = R.names[block];
    var toName = fromMap[fromName];
    if (toName === undefined) return null;
    var toBlock = R.id[toName];
    if (toBlock === undefined) return null;
    var fromCount = R.realFirst[block + 1] - R.realFirst[block];
    var toCount = R.realFirst[toBlock + 1] - R.realFirst[toBlock];
    var local = state - R.realFirst[block];
    if (fromCount !== toCount || local < 0 || local >= toCount) local = R.defaultState[toBlock];
    return R.realFirst[toBlock] + local;
  }
  SF.toInfestedState = function (state) { return pairedState(state, SF.TO_INFESTED); };
  SF.toRegularState = function (state) { return pairedState(state, SF.TO_REGULAR); };

  /**
   * `InfestedBlock.spawnSilverfish` (.decomp:38-43) — `refreshPositionAndAngles(x+0.5, y, z+0.5,
   * 0, 0)`: centred on the block, Y at the FLOOR (not +0.5 — vanilla passes the bare `pos.getY()`),
   * facing +Z. `playSpawnEffects()` = 20 POOF particles (`Px.spawnEffects`).
   */
  SF.spawn = function (x, y, z) {
    if (!NS.EntityList || !NS.EntityList.ready) return null;
    var e = NS.EntityList.spawn('silverfish', x + 0.5, y, z + 0.5, {});
    if (e && NS.Particle && NS.Particle.spawnEffects) NS.Particle.spawnEffects(e);   // playSpawnEffects()
    return e;
  };

  /**
   * `InfestedBlock.onStacksDropped` (.decomp:45-51) — the ONE block-break hook: fires when
   * `doTileDrops` is on AND the tool had no Silk Touch. `silkTouch` mirrors the shorthand every
   * other caller into `NS.Loot` already uses (07e_loot.js:238's own `ctx.silkTouch`).
   *
   * ⚠ THIS ENGINE'S PLAYER MINING PATH DOES NOT YET COMPUTE `silkTouch` AT ALL (`P.miningContext`,
   * 14_player.js, has no enchant field — a pre-existing gap this unit does not own: there is no
   * player-tool-enchantment system wired into mining yet, `07y_equip.js`'s own enchant table is
   * MOB equipment only). So `silkTouch` is always falsy from that one caller today, and this
   * always fires on a survival break of an infested block — which is already the CORRECT answer
   * for every other silk-touch-gated block this engine's loot tables handle the same way.
   */
  SF.onBreak = function (x, y, z, silkTouch) {
    var doTileDrops = true;
    if (NS.Commands && NS.Commands.ruleGet) doTileDrops = NS.Commands.ruleGet('doTileDrops') !== 'false';
    if (!doTileDrops || silkTouch) return;
    SF.spawn(x, y, z);
  };

  // ── goals (SilverfishEntity.initGoals, .decomp:44-54) ─────────────────────────────────────

  /**
   * `SilverfishEntity.CallForHelpGoal` (.decomp:142-191, inner class `bmk$b`). `onHurt()` arms a
   * 20-tick delay (`getTickCount(20)`, this engine ticks 1:1 so that is 20 real ticks, unlike the
   * `toGoalTicks` collapse `Ai.*` roll-based goals use elsewhere in this file — this one is a
   * plain countdown, not a per-tick chance, so nothing to collapse); at zero it walks a
   * 21x11x11 box (dy -5..5 outer, dx/dz -10..10 inner, EXACT `.decomp:169-171` nesting and
   * traversal order — the zig-zag `($$3<=0?1:0)-$$3` walk visits 0,1,-1,2,-2… same as every
   * other ported box-walk in this codebase) for an infested block: `mobGriefing` on breaks it
   * (which — same InfestedBlock.onStacksDropped hook, `SF.onBreak` below — releases ANOTHER
   * silverfish, the goal's whole point) or off just reverts it to plain stone/cobblestone/
   * deepslate; either way a coin flip (`nextBoolean()`) decides whether to keep scanning.
   */
  SF.CALL_FOR_HELP_DELAY = 20;   // getTickCount(20)
  SF.CallForHelpGoal = function (e, ctx) {
    var rand = (ctx && ctx.random) || Math.random;
    var mobGriefing = (ctx && ctx.mobGriefing) || function () { return true; };
    var delay = 0;
    this.onHurt = function () { if (delay === 0) delay = SF.CALL_FOR_HELP_DELAY; };
    this.canUse = function () { return delay > 0; };
    this.canContinueToUse = this.canUse;
    this.start = function () {};
    this.stop = function () {};
    this.tick = function () {
      delay--;
      if (delay > 0) return;
      var W = NS.World, SR = NS.States;
      if (!W || !SR || !SR.ready) return;
      var ex = Math.floor(e.x), ey = Math.floor(e.y), ez = Math.floor(e.z);
      for (var dy = 0; dy <= 5 && dy >= -5; dy = (dy <= 0 ? 1 : 0) - dy) {
        for (var dx = 0; dx <= 10 && dx >= -10; dx = (dx <= 0 ? 1 : 0) - dx) {
          for (var dz = 0; dz <= 10 && dz >= -10; dz = (dz <= 0 ? 1 : 0) - dz) {
            var bx = ex + dx, by = ey + dy, bz = ez + dz;
            var st = W.getBlock(bx, by, bz);
            if (!st) continue;
            var nm = SR.name(st);
            if (SF.isInfested(nm)) {
              if (mobGriefing()) {
                // world.breakBlock: worldEvent 2001 (break sound + dust) before the cell clears
                if (NS.Sound && NS.Sound.blockBreak) NS.Sound.blockBreak(st, bx + 0.5, by + 0.5, bz + 0.5, null);
                if (NS.Particle && NS.Particle.addBlockBreakParticles) NS.Particle.addBlockBreakParticles(bx, by, bz, st, null, rand);
                W.setBlock(bx, by, bz, 0);
                SF.onBreak(bx, by, bz, false);   // onStacksDropped — releases a fresh silverfish
              } else {
                var reg = SF.toRegularState(st);
                if (reg !== null) W.setBlock(bx, by, bz, reg);
              }
              if (rand() < 0.5) return;   // nextBoolean()
            }
          }
        }
      }
    };
  };

  /**
   * `SilverfishEntity.WanderAndInfestGoal` (.decomp:193-246, inner class `bmk$a`, extends
   * `WanderAroundGoal(this, 1.0, 10)`). Two independent `nextInt(toGoalTicks(10)) == 0` rolls in
   * vanilla — the override's own infest check and `WanderAroundGoal.canStart`'s inherited wander
   * check — collapsed to the SAME flat 1-in-10-per-tick this file already uses for every other
   * `toGoalTicks(10)` roll (07k_goals.js:1338's own precedent, cited there as the house rule).
   *
   * ⚠ INFESTING IS INSTANT, NOT A WALK. `.decomp:232-244`'s own `start()` for the infest branch
   * never touches the navigation — it converts the ADJACENT block state right there and discards
   * the silverfish. There is nothing to path toward; the mob simply picks one of the six
   * neighbour cells uniformly (vanilla: `Direction.random`) and disappears into it if that one
   * cell is infestable. The non-infest branch falls back to a plain random stroll, ported off
   * this file's own `Ai.WaterAvoidingRandomStrollGoal` machinery (`Ai.groundLevel`/`Ai.findPath`/
   * `Ai.stepToward`/`Ai.closeTo`) via `SF.pickWanderTarget` (NoPenaltyTargeting(10,7) scored by SilverfishEntity.getPathfindingFavor: 10 over an infestable floor) with no water-avoidance term — `WanderAroundGoal`'s own target
   * picker (`NoPenaltyTargeting.find`) has no such term either, unlike the water-avoiding goal
   * this engine already ported for surface animals.
   */
  SF.WANDER_DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  /** `SilverfishEntity.getPathfindingFavor(pos)`: 10 when the block below is infestable, else 0. */
  SF.pathFavor = function (x, y, z) {
    var W = NS.World, SR = NS.States;
    if (!W || !SR || !SR.ready) return 0;
    var st = W.getBlock(x, y - 1, z);
    return st && SF.isInfestable(SR.name(st)) ? 10 : 0;
  };
  /** `NoPenaltyTargeting.find(mob, 10, 7)`: 10 `localFuzz` samples, valid ones scored by
   *  `SF.pathFavor`, highest wins (strict `>`). Returns {x,y,z} block coords or null. */
  SF.pickWanderTarget = function (e, rand) {
    var Ai = Ai_(), Ph = NS.Physics, best = null, bestScore = -Infinity;
    for (var i = 0; i < 10; i++) {
      var x = Math.floor(e.x) + Math.floor(rand() * 21) - 10;
      var y = Math.floor(e.y) + Math.floor(rand() * 15) - 7;
      var z = Math.floor(e.z) + Math.floor(rand() * 21) - 10;
      if (y < -64 || y > 319) continue;
      if (!Ph.solidAt(x, y - 1, z)) continue;
      if (Ai.pathPenalty(e, Ai.pathTypeAt(x, y, z)) !== 0) continue;
      var sc = SF.pathFavor(x, y, z);
      if (sc > bestScore) { bestScore = sc; best = { x: x, y: y, z: z }; }
    }
    return best;
  };
  SF.WanderAndInfestGoal = function (e, speed, ctx) {
    var rand = (ctx && ctx.random) || Math.random;
    var mobGriefing = (ctx && ctx.mobGriefing) || function () { return true; };
    var canInfest = false, hit = null;   // hit: [bx, by, bz, state]
    var path = null, idx = 1;

    function pickInfestable() {
      var W = NS.World, SR = NS.States;
      if (!W || !SR || !SR.ready) return null;
      var d = SF.WANDER_DIRS[(rand() * 6) | 0];
      var bx = Math.floor(e.x) + d[0], by = Math.floor(e.y + 0.5) + d[1], bz = Math.floor(e.z) + d[2];
      var st = W.getBlock(bx, by, bz);
      if (!st) return null;
      if (!SF.isInfestable(SR.name(st))) return null;
      return [bx, by, bz, st];
    }

    this.canUse = function () {
      if (e.target) return false;
      if (path) return false;   // `!navigation.isIdle()` — this engine's own analogue (D-…)
      if (mobGriefing() && rand() < 0.1) {
        hit = pickInfestable();
        if (hit) { canInfest = true; return true; }
      }
      canInfest = false;
      // WanderAroundGoal.canStart (canDespawn 3-arg ctor): hasPassengers / despawnCounter >= 100 refuse the stroll
      if ((e.passengers && e.passengers.length > 0) || e.despawnCounter >= 100) return false;
      if (!(rand() < 0.1)) return false;
      var tg = SF.pickWanderTarget(e, rand);
      if (tg) {
        var p = Ai_().findPath(e.x, e.y, e.z, tg.x + 0.5, tg.y, tg.z + 0.5, { mob: e });
        if (p && p.length > 1) { path = p; idx = 1; return true; }
      }
      return false;
    };
    this.canContinueToUse = function () { return canInfest ? false : (!!path && idx < path.length); };
    this.start = function () {
      if (canInfest && hit) {
        var W = NS.World;
        var inf = SF.toInfestedState(hit[3]);
        if (inf !== null && W.setBlock(hit[0], hit[1], hit[2], inf)) {
          if (NS.Particle && NS.Particle.spawnEffects) NS.Particle.spawnEffects(e);   // playSpawnEffects()
          e.removed = true;   // discard()
        }
        return;
      }
    };
    this.stop = function () { path = null; };
    this.tick = function () {
      if (canInfest) return;
      if (!path || idx >= path.length) { this.stop(); return; }
      var Ai = Ai_();
      Ai.stepToward(e, path[idx], speed);
      if (Ai.closeTo(e, path[idx])) idx++;
    };
  };
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
