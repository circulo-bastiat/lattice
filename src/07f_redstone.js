// 07f_redstone.js — PLAN G15a: THE SIGNAL. Power sources, wire, and what conducts.
//
// ⚠ WHAT IS HERE AND WHAT IS NOT (D-294). This is the SIGNAL half of G15: how much power a block
// emits, how wire carries it, and what a solid block does to it. Repeaters and comparators
// (G15b), pistons (G15c) and observers (G15d) are deliberately not started — PLAN's acceptance
// asks for twenty circuits including a piston door, and pistons alone are block-moving, a
// `moving_piston` block entity, push limits and sticky retraction. Half a redstone stage that
// looks finished is worse than none.
//
// ⚠⚠ EVERY RULE BELOW IS READ OUT OF THE 1.18.2 BYTECODE, NOT REMEMBERED. Redstone is pure code
// in vanilla: none of it is in a JSON file, a tag or `minecraft-data`. Each class was located BY
// USE — `Blocks.<clinit>` puts the block's own name literal immediately before its `new <class>`,
// so `redstone_wire -> cjb`, `redstone_torch -> cjd`, `lever -> chr`, `redstone_block -> ciu` with
// nothing guessed (D-263's method, sixth and seventh time).
//
// THE THREE THINGS A CLONE GETS WRONG, all of which this file gets from the jar:
//
//   1. ⚠ A WIRE SWITCHES ITS OWN SIGNAL OFF WHILE ASKING ITS NEIGHBOURS. `RedStoneWireBlock`
//      carries a `shouldSignal` field, clears it around `getBestNeighborSignal`, and every one of
//      its `getSignal`/`getDirectSignal` answers returns 0 while it is clear. Without that a wire
//      reads its own power back through the block beside it and latches at 15 for ever.
//   2. ⚠ THE DECAY IS ON THE WIRE TERM ONLY: `max(blockSignal, wireMax − 1)`, not
//      `max(everything) − 1`. A lever beside a wire makes it 15, not 14.
//   3. ⚠ THE VERTICAL RULES ARE ASYMMETRIC. Wire climbs UP the side of a block only if the block
//      ABOVE THE WIRE is not a conductor; it steps DOWN to a lower wire only if the side block is
//      not a conductor. Getting one of the two backwards gives circuits that work on flat ground
//      and fail on every staircase.

(function (NS) {
  'use strict';

  var Rs = NS.Redstone = {
    ready: false,
    /** `RedStoneWireBlock.MAX_SIGNAL`, and every source's literal `bipush 15`. */
    MAX: 15,

    // ⚠ THE CONDUCTOR TEST IS `AbstractBlock.Settings.solidBlockPredicate` (#337, .decomp
    // AbstractBlock.java:840). Its DEFAULT is `material.blocksLight() && isFullCube` — the
    // collision cube AND a material that stops light — and `Blocks.java` overrides it with
    // `solidBlock(Blocks::never)` on exactly the blocks below: glass (244), moving_piston (379),
    // beacon (1142), redstone_block (1328), observer (2001), tinted_glass (3184), all sixteen
    // stained glass (createStainedGlassBlock, 3495) and both pistons (createPistonBlock, 3521).
    // `Settings.copy` does not carry the predicate, so nothing inherits these.
    NEVER_CONDUCTS: ['beacon', 'glass', 'moving_piston', 'observer', 'redstone_block', 'tinted_glass',
                     'piston', 'sticky_piston',
                     'white_stained_glass', 'orange_stained_glass', 'magenta_stained_glass',
                     'light_blue_stained_glass', 'yellow_stained_glass', 'lime_stained_glass',
                     'pink_stained_glass', 'gray_stained_glass', 'light_gray_stained_glass',
                     'cyan_stained_glass', 'purple_stained_glass', 'blue_stained_glass',
                     'brown_stained_glass', 'green_stained_glass', 'red_stained_glass',
                     'black_stained_glass'],
    // `solidBlock(Blocks::always)` — soul_sand (Blocks.java:803). Its collision is 14/16 tall, so
    // the default would say no; the override makes it conduct anyway.
    ALWAYS_CONDUCTS: ['soul_sand'],
    // The blocks whose `Material` is `lightPassesThrough()` and that could be a full collision cube:
    // every TNT, LEAVES, GLASS, ICE and CACTUS block (Material.java:93-97), from
    // tools/golden/block-materials-1.18.2.tsv, plus chorus_flower — Material.PLANT with a full
    // collision cube. Every other light-passing block (air, fluids, plants, fire, snow layer...)
    // has no full collision cube in any state; conductorcheck asserts that per state.
    LIGHT_PASSES: ['chorus_flower', 'tnt', 'cactus', 'ice', 'frosted_ice', 'glowstone', 'sea_lantern', 'conduit',
                   'beacon', 'glass', 'glass_pane', 'tinted_glass',
                   'oak_leaves', 'spruce_leaves', 'birch_leaves', 'jungle_leaves', 'acacia_leaves',
                   'dark_oak_leaves', 'azalea_leaves', 'flowering_azalea_leaves',
                   'white_stained_glass', 'orange_stained_glass', 'magenta_stained_glass',
                   'light_blue_stained_glass', 'yellow_stained_glass', 'lime_stained_glass',
                   'pink_stained_glass', 'gray_stained_glass', 'light_gray_stained_glass',
                   'cyan_stained_glass', 'purple_stained_glass', 'blue_stained_glass',
                   'brown_stained_glass', 'green_stained_glass', 'red_stained_glass',
                   'black_stained_glass',
                   'white_stained_glass_pane', 'orange_stained_glass_pane', 'magenta_stained_glass_pane',
                   'light_blue_stained_glass_pane', 'yellow_stained_glass_pane', 'lime_stained_glass_pane',
                   'pink_stained_glass_pane', 'gray_stained_glass_pane', 'light_gray_stained_glass_pane',
                   'cyan_stained_glass_pane', 'purple_stained_glass_pane', 'blue_stained_glass_pane',
                   'brown_stained_glass_pane', 'green_stained_glass_pane', 'red_stained_glass_pane',
                   'black_stained_glass_pane'],

    // ⚠ EVERY BLOCK WHOSE `isSignalSource` IS TRUE IN 1.18.2 — SIXTEEN CLASSES, NAMED (D-295).
    // Derived mechanically, not recalled: `BlockStateBase.isSignalSource()` delegates to
    // `cdq.f_(Lcov;)Z`, so disassembling all 6,352 classes and keeping every override of that
    // exact descriptor gives the closed set (`cou`, the base, is the one returning `false`).
    // Each class is then named by `Blocks.<clinit>`'s literal-immediately-before-`new` — the
    // same anchor the seven earlier golden tables use — and the four abstract ones (button,
    // pressure plate, diode, torch) are expanded through their subclasses, which is where the
    // twenty-two button and plate names below come from. Nothing here is a name pattern:
    // `polished_blackstone_button` and `light_weighted_pressure_plate` are on the list because
    // the jar puts them there, and `note_block` is off it for the same reason.
    SIGNAL_SOURCES: [
      'daylight_detector', 'detector_rail', 'lectern', 'lever', 'lightning_rod', 'observer',
      'redstone_block', 'redstone_wire', 'redstone_torch', 'redstone_wall_torch',
      'sculk_sensor', 'target', 'trapped_chest', 'tripwire_hook',
      'repeater', 'comparator',
      'stone_button', 'polished_blackstone_button',
      'oak_button', 'spruce_button', 'birch_button', 'jungle_button', 'acacia_button',
      'dark_oak_button', 'crimson_button', 'warped_button',
      'stone_pressure_plate', 'polished_blackstone_pressure_plate',
      'oak_pressure_plate', 'spruce_pressure_plate', 'birch_pressure_plate',
      'jungle_pressure_plate', 'acacia_pressure_plate', 'dark_oak_pressure_plate',
      'crimson_pressure_plate', 'warped_pressure_plate',
      'light_weighted_pressure_plate', 'heavy_weighted_pressure_plate'
    ],

    // directions, in this engine's own order: 0 down, 1 up, 2 north, 3 south, 4 west, 5 east
    DOWN: 0, UP: 1
  };

  var R = null, S = null, B = null, w = null;
  var DX, DY, DZ, OPP, HORIZ;
  var isWire = null, isSource = null, neverConducts = null, fullCube = null;
  var P = null, V = null;
  var blkWire = -1, blkTorch = -1, blkWallTorch = -1, blkBlock = -1, blkLamp = -1;
  var consumerKind = null, K_DOOR = 1, K_TRAPDOOR = 2, K_GATE = 3, K_NOTE = 4, K_RAIL = 5, K_BELL = 6;
  var blkRepeater = -1, blkComparator = -1, blkObserver = -1;
  // D-420 — the three blocks that react to a signal without being wire, a diode or a piston.
  var blkDispenser = -1, blkDropper = -1, blkHopper = -1;
  // D-432 — the last two owed sources on `Rs.OWED_SOURCES` that G19b is responsible for.
  var blkTrappedChest = -1, blkLectern = -1, blkRod = -1, blkTarget = -1;
  var blkTnt = -1;   // loop/tnt-s96
  var isSignalSrc = null;                     // block -> 1 when `isSignalSource` is true
  var BE = null;                              // the block-entity store, where a comparator keeps its output

  /**
   * ⚠ `shouldSignal`, VANILLA'S OWN FIELD, and it is a field here for the same reason it is one
   * there: the suppression has to reach `getSignal` through code that does not know it is being
   * called on behalf of a wire. Passing a flag down would mean threading it through
   * `bestNeighbourSignal`, every source's answer and the conductor test — which is exactly the
   * refactor that loses it in one branch.
   */
  var shouldSignal = true;

  /**
   * ⚠ NO `world` PARAMETER ANY MORE, AND ITS ABSENCE IS THE POINT (D-302). It used to take one
   * and `Main` passed `NS.World` — whose `get(cx, cz)` is the CHUNK getter — so every read in
   * this module answered with a chunk. A parameter that can be passed the wrong object is a
   * parameter that will be; there is exactly one right answer and it is `Behave.w`.
   */
  Rs.init = function () {
    R = NS.Reg; S = NS.States; B = NS.Behave;
    if (!R || !R.ready || !S || !S.ready || !B) { Rs.ready = false; return Rs; }
    // ⚠⚠ THE WORLD THIS MODULE READS IS `Behave`'s ADAPTER, NOT `NS.World` (D-302). `NS.World.get`
    // takes CHUNK coordinates and returns a chunk; the block accessors are `getBlock`/`setBlock`.
    // `Redstone.init(NS.World)` therefore stored an object whose `get(x, y, z)` answered with a
    // chunk object or `undefined` for every read — so in the GAME, every wire read 0, every
    // torch saw nothing and no circuit did anything at all. `Behave` already publishes exactly
    // the right adapter as `B.w`, and taking it is the whole fix.
    // ⚠ EVERY CHECK WAS GREEN, because each fixture hands in an object whose `get` IS the block
    // getter — and `redcheck` went further and overwrote `B.w` with it. A fixture that makes the
    // interface easier than the game's is a fixture that cannot see an interface bug.
    var bw = (B && B.w) || null;
    if (!bw) { w = null; Rs.ready = false; return Rs; }
    // ⚠ EVERY STATE THIS MODULE WRITES IS SEEN BY THE OBSERVERS WATCHING IT. Vanilla's
    // `setBlockState` (any flags without 16) runs the shape-update pass on all six neighbours,
    // which is how `ObserverBlock.getStateForNeighborUpdate` hears a torch flip, a lamp light, a
    // repeater click or another observer pulse. This module's writes went straight to the
    // store, so an observer watching an observer never fired (redrefcheck `observer_chain`).
    w = Object.create(bw);
    w.set = function (x, y, z, st) {
      var old = bw.get(x, y, z);
      bw.set(x, y, z, st);
      if (old !== st && Rs.ready) Rs.notifyObservers(x, y, z);
    };
    DX = B.DX; DY = B.DY; DZ = B.DZ; OPP = B.OPP; HORIZ = B.HORIZ;
    P = R.PROP; V = R.PVAL;

    blkWire = R.id.redstone_wire;
    blkTorch = R.id.redstone_torch;
    blkWallTorch = R.id.redstone_wall_torch;
    blkBlock = R.id.redstone_block;
    blkLamp = R.id.redstone_lamp;
    // the OPENERS: blocks whose `neighborUpdate` reads `isReceivingRedstonePower` into a
    // `powered` property (DoorBlock, TrapdoorBlock, FenceGateBlock, NoteBlock, PoweredRailBlock —
    // activator_rail is a PoweredRailBlock too). Every door/trapdoor/gate, wooden or iron.
    consumerKind = new Uint8Array(R.blockCount);
    for (var cb = 0; cb < R.blockCount; cb++) {
      var cn = R.names[cb];
      if (!cn) continue;
      if (/_trapdoor$/.test(cn)) consumerKind[cb] = K_TRAPDOOR;
      else if (/_door$/.test(cn)) consumerKind[cb] = K_DOOR;
      else if (/_fence_gate$/.test(cn)) consumerKind[cb] = K_GATE;
      else if (cn === 'note_block') consumerKind[cb] = K_NOTE;
      else if (cn === 'bell') consumerKind[cb] = K_BELL;
      else if (cn === 'powered_rail' || cn === 'activator_rail') consumerKind[cb] = K_RAIL;
    }
    blkRepeater = R.id.repeater;
    blkComparator = R.id.comparator;
    blkObserver = R.id.observer;
    blkDispenser = R.id.dispenser;
    blkDropper = R.id.dropper;
    blkHopper = R.id.hopper;
    blkTrappedChest = R.id.trapped_chest;
    blkLectern = R.id.lectern;
    blkRod = R.id.lightning_rod === undefined ? -1 : R.id.lightning_rod;
    blkTarget = R.id.target === undefined ? -1 : R.id.target;
    blkTnt = R.id.tnt;   // loop/tnt-s96 -- TntBlock.neighborUpdate/onBlockAdded, Rs.updateTnt
    BE = (NS.BlockEntities && NS.BlockEntities.ready) ? NS.BlockEntities : null;
    Rs.comparatorStore = BE ? 'blockentity' : 'none';

    // ⚠ `BlockBehaviour.isSignalSource`, READ OUT OF THE JAR AND NOT GUESSED (D-295). It is
    // overridden to `true` on exactly SIXTEEN classes in 1.18.2 — found by disassembling all
    // 6,352 classes and keeping every override of `cdq.f_(Lcov;)Z`, then naming each one
    // through `Blocks.<clinit>`'s name-literal-before-`new` (D-263's method). The wrong test
    // is the tempting one: G15a asked "does this state have a `powered` property", which is
    // true of doors, trapdoors, fence gates, note blocks, rails, tripwire and bells — none of
    // which is a source, all of which would have made wire connect to them.
    isSignalSrc = new Uint8Array(R.blockCount);
    for (var si = 0; si < Rs.SIGNAL_SOURCES.length; si++) {
      var sb = R.id[Rs.SIGNAL_SOURCES[si]];
      if (sb !== undefined) isSignalSrc[sb] = 1;
    }

    // ⚠ PER-STATE TABLES, BUILT ONCE. Redstone asks "is this a conductor" several times per
    // wire per update, and a wire run of fifteen with a few branches is thousands of asks a
    // tick. A `shapesFor` call and a name comparison at each would be the kind of cost that
    // only shows up on the 2200G, which is this project's real target.
    // 0 default · 1 never (override, or a light-passing material) · 2 always (override)
    neverConducts = new Uint8Array(R.blockCount);
    var marks = [[Rs.LIGHT_PASSES, 1], [Rs.NEVER_CONDUCTS, 1], [Rs.ALWAYS_CONDUCTS, 2]];
    for (var mi = 0; mi < marks.length; mi++) {
      for (var i = 0; i < marks[mi][0].length; i++) {
        var b = R.id[marks[mi][0][i]];
        if (b !== undefined) neverConducts[b] = marks[mi][1];
      }
    }
    var Ph = NS.Physics;
    fullCube = new Uint8Array(S.count);
    for (var st = 1; st < S.count; st++) {
      var sh = Ph && Ph.shapesFor ? Ph.shapesFor(st) : null;
      // ⚠ vanilla's own default is `isCollisionShapeFullBlock`, so deriving this from the
      // COLLISION geometry is quoting vanilla rather than inventing a rule from our own shapes
      // (the D-263 trap, avoided by checking what vanilla actually asks).
      fullCube[st] = (sh && sh.length === 1 && sh[0][0] === 0 && sh[0][1] === 0 && sh[0][2] === 0
                      && sh[0][3] === 1 && sh[0][4] === 1 && sh[0][5] === 1) ? 1 : 0;
    }
    buildAnalogTable();
    isWire = function (state) { return state !== 0 && S.block[state] === blkWire; };
    Rs.ready = true;
    return Rs;
  };

  // ⚠ `Rs.attach(world)` IS GONE (D-302, D-139). It existed so a caller could swap the world in,
  // and swapping the world in is exactly how this module came to be reading chunks as block
  // states. There is one right object and `init` takes it; a door that only a mistake walks
  // through is a door to remove, not to document.
  // the observer-notifying wrapper (init) delegates to `B.w` itself, so the answer is its prototype
  Rs.worldIsBehaveAdapter = function () { return !!B && !!w && Object.getPrototypeOf(w) === B.w; };

  /**
   * ⚠ A BOOLEAN PROPERTY COMES BACK AS THE STRING `'true'`, NOT AS `true`. `Behave.propName`
   * returns the registry's own VALUE NAME, which is how a property whose values are `north` or
   * `side` can share one accessor with one whose values are `true` and `false`. Writing
   * `propName(state, 'powered') === true` therefore compares a string to a boolean, is false for
   * every state in the game, and silently makes every lever, button and torch emit nothing —
   * which is exactly what the first run of `redcheck` found, in §3, in one minute. It is the
   * `!!undefined` failure of D-290 wearing different clothes: a comparison that cannot ever be
   * true reads as "this feature is off" rather than as an error.
   */
  function boolProp(state, name) {
    var v = B.propName(state, name);
    return v === true || v === 'true';
  }
  Rs.boolProp = function (state, name) { return boolProp(state, name); };

  // ── what conducts ─────────────────────────────────────────────────────────────────────────
  /**
   * `BlockState.isRedstoneConductor` — a full collision cube of a light-blocking material, unless
   * `NEVER_CONDUCTS` / `ALWAYS_CONDUCTS` override it (#337). ⚠ It is NOT "opaque" and NOT "solid": glass is a full collision cube and does
   * not conduct, and a slab conducts nothing while being perfectly solid to stand on.
   */
  Rs.isConductor = function (state) {
    if (state === 0 || !Rs.ready) return false;
    var o = neverConducts[S.block[state]];
    return o === 2 || (o === 0 && fullCube[state] === 1);
  };

  /** Whether a state is wire. Exposed because every caller below asks it. */
  Rs.isWire = function (state) { return Rs.ready && state !== 0 && S.block[state] === blkWire; };

  Rs.powerOf = function (state) {
    return Rs.isWire(state) ? (B.propName(state, 'power') | 0) : 0;
  };

  // ── what a block emits ────────────────────────────────────────────────────────────────────
  /**
   * `BlockState.getSignal(level, pos, dir)` — the WEAK power this block gives the neighbour that
   * lies in direction `dir` from it.
   *
   * ⚠ THE DIRECTION IS FROM THE SOURCE TOWARD THE ASKER, which is the single most confusing
   * thing in redstone and the reason the torch's rule reads backwards at first glance. A block
   * standing ON a torch asks `getSignal(torchPos, UP)` and gets 0 — a torch does not power what
   * it stands on. A block ABOVE a torch asks `getSignal(torchPos, DOWN)` and gets 15.
   */
  Rs.signal = function (state, dir, x, y, z) {
    if (state === 0 || !Rs.ready) return 0;
    var b = S.block[state];

    if (b === blkBlock) return Rs.MAX;                       // `ciu.a` is a bare `bipush 15`

    // ── D-432: the last two of G19b's owed sources ─────────────────────────────────
    //
    // ⚠ `clg.a` (TrappedChestBlock.getSignal) is, in full:
    //     Mth.clamp(ChestBlockEntity.getOpenCount(level, pos), 0, 15)
    // and `clg.b` (getDirectSignal) is `dir == UP ? state.getSignal(...) : 0`. So a trapped
    // chest's power is literally HOW MANY PLAYERS HAVE IT OPEN, and it strongly powers only the
    // block beneath it. The opener count is the SAME `e.open` the lid animation already keeps
    // (D-403/D-413) — vanilla shares it too, which is why a trapped chest's lid and its signal
    // can never disagree.
    if (b === blkTrappedChest) return Rs.chestOpenSignal(x, y, z);
    // ⚠ `chp.a` (LecternBlock.getSignal) is `state.getValue(POWERED) ? 15 : 0` — a BLOCK STATE
    // property, not a block entity, so the rule is complete here. What is still owed is what
    // SETS it: vanilla pulses POWERED for two ticks when a page is turned, and turning a page
    // needs the lectern screen (G19e). The signal is live the day that screen exists, rather
    // than being a second thing to remember.
    if (b === blkLectern) return boolProp(state, 'powered') ? Rs.MAX : 0;
    // s128 (G20) — `LightningRodBlock.getWeakRedstonePower`: `POWERED ? 15 : 0`, every direction.
    // What sets POWERED is a strike (`Lgt.setRodPowered`, 07zzc_lightning.js), for 8 ticks.
    if (b === blkRod) return boolProp(state, 'powered') ? Rs.MAX : 0;
    // `TargetBlock.getWeakRedstonePower`: the POWER property, every direction (set by `Rs.targetHit`).
    if (b === blkTarget) return B.propName(state, 'power') | 0;

    if (b === blkTorch) {
      // `cjd.a`: lit && dir != UP ? 15 : 0
      return (boolProp(state, 'lit') && dir !== Rs.UP) ? Rs.MAX : 0;
    }
    if (b === blkWallTorch) {
      // ⚠⚠ A WALL TORCH IS NOT A STANDING TORCH WITH A DIFFERENT MODEL (D-296). `cje` overrides
      // `getSignal` to `lit && state.getValue(FACING) != direction ? 15 : 0`, and FACING points
      // AWAY from the block it hangs on — so `direction == FACING` is exactly the ask that comes
      // from its own support. G15a used the standing torch's `dir != UP` for both, which made
      // every wall torch power the block it is stuck to, read that power back as its own input
      // and go out for ever. No check saw it because every torch in G15a's twenty circuits
      // stood on the floor.
      return (boolProp(state, 'lit') && facingDir(state) !== dir) ? Rs.MAX : 0;
    }

    if (b === blkWire) {
      // `cjb.a`, written out: `shouldSignal && dir != DOWN` , then the power, then
      // `dir == UP || connected(dir.getOpposite())`.
      if (!shouldSignal || dir === Rs.DOWN) return 0;
      var p = B.propName(state, 'power') | 0;
      if (p === 0) return 0;
      if (dir === Rs.UP) return p;
      // ⚠⚠ `OPP[dir]`, AND THE **COMPLETED** CONNECTION STATE — BOTH WRONG IN G15a (D-296).
      // `dir` points FROM THE ASKER TO THIS WIRE, so the side that faces the asker is the
      // opposite one; asking `dir` instead lets a wire power the thing behind it and not the
      // thing in front. And vanilla asks `getConnectionState(...)`, not the wire's own stored
      // sides: a wire with connections on ONE axis only grows the other axis back to SIDE
      // (`getConnectionState`'s four `if (!x && noOtherAxis) setValue(x, SIDE)` lines), which
      // is the whole reason a run of dust ending at a lamp lights it. A straight run cannot
      // see either bug — both ends are wire — which is why G15a's twenty circuits passed.
      return (Rs.wireSides(x, y, z, state) & (1 << OPP[dir])) !== 0 ? p : 0;
    }

    // the observer — `cil.a(cov,cab,gj,go)` (D-299): `powered && FACING == dir ? 15 : 0`.
    // ⚠ FACING IS THE EYE, so the output comes out of the BACK, and the block behind it asks
    // with `dir == FACING` — the same convention the diodes use, for the same reason.
    if (b === blkObserver) {
      if (!boolProp(state, 'powered')) return 0;
      return facingDir(state) === dir ? Rs.MAX : 0;
    }

    // repeaters and comparators — `cfi.a(cov,cab,gj,go)` (D-297). ⚠ THIS BRANCH MUST COME
    // BEFORE THE `powered` FALLBACK BELOW: a powered repeater has a `powered` property, so
    // without it a repeater emitted 15 in all six directions, including backwards into its
    // own input, which is a latch rather than a repeater.
    if (b === blkRepeater || b === blkComparator) {
      if (!boolProp(state, 'powered')) return 0;
      return facingDir(state) === dir ? Rs.outputSignal(state, x, y, z) : 0;
    }

    // ⚠ A WEIGHTED PRESSURE PLATE HAS NO `powered` PROPERTY — IT HAS `power`, 0..15.
    // `WeightedPressurePlateBlock.getSignalForState` returns that number, and the generic
    // boolean rule below reads `powered` on a state that has none, gets `null`, and emits
    // nothing. Both weighted plates were silent for exactly that reason until `redcheck` §8
    // started asking every source in the golden table whether it emits ANYTHING (D-299). It is
    // the third member of the family D-290 names: a test that cannot come out true reads as
    // "this feature is off".
    // ⚠ ONLY A SIGNAL SOURCE EMITS (`isSignalSource`, the jar's sixteen classes). A door, a
    // trapdoor, a fence gate, a note block or a powered rail has `powered` too — the generic rule
    // below made each one a 15-source the moment redstone powered it, so it held itself (and its
    // neighbours) on forever after the power went (redrefcheck `iron_door`/`note_block`/
    // `powered_rail` turn-off, D-773 cloud unit).
    if (!isSignalSrc[b]) return 0;
    var pw = B.propName(state, 'power');
    if (pw !== null && pw !== undefined) return pw | 0;

    // levers, buttons and pressure plates: `chr.a` is `powered ? 15 : 0`, in every direction
    if (boolProp(state, 'powered')) return Rs.MAX;
    return 0;
  };

  /**
   * `TargetBlock.onProjectileHit` -> `trigger` (.decomp TargetBlock.java). `face` is the Ray face
   * index (0/1 = x, 2/3 = y, 4/5 = z), (hx,hy,hz) the hit point. Power is
   * `max(1, ceil(15 * clamp((0.5 - d) / 0.5, 0, 1)))`, d the larger of the two in-face offsets
   * from the face centre; `persistent` (arrow/trident) holds 20 ticks, anything else 8. A hit while
   * a tick is already queued changes nothing. Returns the power set, or -1 when nothing happened.
   */
  Rs.targetHit = function (x, y, z, face, hx, hy, hz, persistent, proj) {
    var W = NS.World;
    if (!W || blkTarget < 0) return -1;
    var st = W.getBlock(x, y, z);
    if (NS.States.block[st] !== blkTarget) return -1;
    var fx = Math.abs(hx - Math.floor(hx) - 0.5), fy = Math.abs(hy - Math.floor(hy) - 0.5), fz = Math.abs(hz - Math.floor(hz) - 0.5);
    var axis = face >> 1;
    var d = axis === 1 ? Math.max(fx, fz) : axis === 2 ? Math.max(fx, fy) : Math.max(fy, fz);
    var pw = Math.max(1, Math.ceil(15 * Math.min(1, Math.max(0, (0.5 - d) / 0.5))));
    // TargetBlock.trigger: Criteria.TARGET_HIT for a ServerPlayerEntity owner (before the queued-tick early-out)
    if (proj && proj.shooter && proj.shooter === NS.Player && NS.Adv && NS.Adv.trigger) NS.Adv.trigger(proj.shooter, 'minecraft:target_hit', { player: proj.shooter, projectile: proj, hitPos: [hx, hy, hz], signal: pw });
    if (B.isQueued && B.isQueued(x, y, z)) return pw;
    W.setBlock(x, y, z, B.setProp(st, 'power', pw));
    if (B.changed) B.changed(x, y, z);
    if (B.schedule) B.schedule(x, y, z, persistent ? 20 : 8, 0);
    return pw;
  };
  /** `TargetBlock.scheduledTick`: POWER back to 0. Claimed from `Behave.scheduledTick`. */
  Rs.targetTick = function (x, y, z) {
    var W = NS.World;
    if (!W || blkTarget < 0) return false;
    var st = W.getBlock(x, y, z);
    if (NS.States.block[st] !== blkTarget) return false;
    if ((B.propName(st, 'power') | 0) !== 0) {
      W.setBlock(x, y, z, B.setProp(st, 'power', 0));
      if (B.changed) B.changed(x, y, z);
    }
    return true;
  };

  /**
   * ⚠ WHICH OF THE THIRTY-EIGHT SOURCES ARE NOT BUILT, AND WHAT EACH IS WAITING FOR (D-299).
   * The set is closed by `redcheck`: every row of `signal-sources-1.18.2.tsv` is either answered
   * by a branch above or named here. A source that quietly emits 0 for ever is D-290's failure,
   * and "the list is short" is not a reason to leave it uncounted.
   */
  Rs.OWED_SOURCES = {
    // lectern: BUILT #187 — Use.lecternSetPage pulses POWERED for 2 ticks when a page turns (14l_use.js).
    // lightning_rod: BUILT s128 — a strike powers it for 8 ticks (07zzc_lightning.js).
    // target: BUILT #5609 — `Rs.targetHit`, called from the arrow/trident/snowball/egg hit paths (14j_combat.js).
    // tripwire_hook: BUILT #5610 — an entity on the string powers it (Use.hookUpdate, 14l_use.js).
  };

  /**
   * `ChestBlockEntity.getOpenCount(level, pos)`, clamped 0..15 — a trapped chest's whole signal.
   *
   * ⚠⚠ **IT IS THE OPENER COUNT AND NOT A BOOLEAN.** Vanilla returns the NUMBER of players
   * with the chest open, clamped, so two players on a trapped chest emit 2. This engine has one
   * player, so the value is 0 or 1 today — but writing it as `open ? 15 : 0` would have been a
   * different rule that happens to agree in the single-player case, and the comparator reading
   * it would then be wrong the day anything else opens a chest (a hopper does not, a second
   * player would). The count is already kept: `e.open` is what the LID animation reads.
   * ⚠ `null` block entity — a trapped chest placed before its entity exists — is 0, not an
   * error: `getOpenCount` returns 0 for a pos with no `ChestBlockEntity` too.
   */
  Rs.chestOpenSignal = function (x, y, z) {
    var be = BE || ((NS.BlockEntities && NS.BlockEntities.ready) ? NS.BlockEntities : null);
    if (!be || !be.get) return 0;
    var e = be.get(x, y, z);
    var n = (e && e.open) | 0;
    return n < 0 ? 0 : (n > Rs.MAX ? Rs.MAX : n);
  };

  /**
   * `BlockState.getDirectSignal(level, pos, dir)` — STRONG power, the kind that a solid block
   * re-emits to everything touching it. ⚠ This is the difference between a lever on a block
   * lighting a lamp on the far side of it and not.
   */
  Rs.directSignal = function (state, dir, x, y, z) {
    if (state === 0 || !Rs.ready) return 0;
    var b = S.block[state];

    if (b === blkBlock) return 0;                            // `ciu` has no override: 0

    // D-432 — both of these strongly power ONLY the block beneath them (`dir == UP`), which is
    // `clg.b` and `chp.b` written out. A trapped chest under a block does not power what that
    // block touches sideways, and that is the difference between a working hidden door and a
    // circuit that fires when anybody walks past the chest.
    if (b === blkTrappedChest) {
      return dir === Rs.UP ? Rs.chestOpenSignal(x, y, z) : 0;
    }
    if (b === blkLectern) {
      return (dir === Rs.UP && boolProp(state, 'powered')) ? Rs.MAX : 0;
    }
    // s128 — `LightningRodBlock.getStrongRedstonePower`: `POWERED && FACING == direction ? 15 : 0`.
    // FACING can be UP or DOWN, which `facingDir` (horizontal only) does not answer, so it is
    // spelled out: a floor rod (facing up) strongly powers the block it stands on.
    if (b === blkRod) {
      if (!boolProp(state, 'powered')) return 0;
      var rf = B.propName(state, 'facing');
      var rd = rf === 'up' ? Rs.UP : rf === 'down' ? Rs.DOWN : facingDir(state);
      return rd === dir ? Rs.MAX : 0;
    }
    if (b === blkTorch || b === blkWallTorch) {
      // `cjd.b`: dir == DOWN ? getSignal(DOWN) : 0 — a torch strongly powers only the block
      // above it, which is why a torch under a block lights wire on top of that block.
      return dir === Rs.DOWN ? Rs.signal(state, dir, x, y, z) : 0;
    }
    if (b === blkWire) {
      // `cjb.b`: `shouldSignal ? getSignal(dir) : 0`
      return shouldSignal ? Rs.signal(state, dir, x, y, z) : 0;
    }
    // `cfi.b` is a bare delegate to `state.getSignal(...)` — a diode's STRONG power is its weak
    // power, which is why a repeater into a block powers everything that block touches. The
    // observer's `cil.b` is the same bare delegate.
    if (b === blkRepeater || b === blkComparator || b === blkObserver) {
      return Rs.signal(state, dir, x, y, z);
    }
    // ⚠ ONLY A SIGNAL SOURCE (same gate, same reason as `Rs.signal`'s fallback): a powered note
    // block strongly powered the stone under it, which powered it back — on forever.
    if (!isSignalSrc[b]) return 0;
    // ⚠ A PRESSURE PLATE IS EXPLICIT AND NOT A FALL-THROUGH. `cdf.b` is
    // `dir == UP ? getSignalForState(state) : 0` — it strongly powers only the block BENEATH it.
    // The generic lever rule below happens to give the same answer, because `attachedDir`
    // returns UP when a state has neither `face` nor `facing`; a right answer reached by a
    // default is the shape D-290 is about, so the plate says so itself.
    if (B.propName(state, 'face') == null && B.propName(state, 'facing') == null) {
      // `AbstractPressurePlateBlock.getStrongRedstonePower`: `UP ? getRedstoneOutput(state) : 0` — the
      // plate's OUTPUT, so a weighted plate (`power`, no `powered`) strongly powers at its power.
      if (dir !== Rs.UP) return 0;
      var ppw = B.propName(state, 'power');
      if (ppw !== null && ppw !== undefined) return ppw | 0;
      return boolProp(state, 'powered') ? Rs.MAX : 0;
    }
    // `chr.b`: powered && getConnectedDirection(state) == dir ? 15 : 0
    if (boolProp(state, 'powered')) {
      return Rs.attachedDir(state) === dir ? Rs.MAX : 0;
    }
    return 0;
  };

  /**
   * `FaceAttachedHorizontalDirectionalBlock.getConnectedDirection` — the direction a lever or
   * button pushes its STRONG power into, which is the direction of the block it is stuck to.
   * FLOOR -> UP, CEILING -> DOWN, WALL -> the block's own `facing`.
   */
  Rs.attachedDir = function (state) {
    var face = B.propName(state, 'face');
    if (face === 'floor') return Rs.UP;
    if (face === 'ceiling') return Rs.DOWN;
    var f = B.propName(state, 'facing');
    return f === 'north' ? 2 : f === 'south' ? 3 : f === 'west' ? 4 : f === 'east' ? 5 : Rs.UP;
  };

  // ── what a position receives ──────────────────────────────────────────────────────────────
  /**
   * `Level.getBestNeighborSignal(pos)` — the strongest WEAK signal any of the six neighbours
   * offers this cell. ⚠ It is the max of `getSignal`, not of `getDirectSignal`: a solid block
   * with a lever on it hands on the lever's STRONG power through `getSignal` of the block
   * itself, which is what `Rs.receivedPower` below adds.
   */
  Rs.bestNeighbourSignal = function (x, y, z) {
    var best = 0;
    for (var d = 0; d < 6; d++) {
      var nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d];
      var st = w.get(nx, ny, nz);
      if (st === 0) continue;
      // ⚠⚠ THE DIRECTION PASSED IS `d`, THE ONE POINTING FROM US TO THE NEIGHBOUR — NOT `OPP[d]`.
      // This file had it the other way round for its first run, on reasoning that sounds
      // airtight ("the neighbour gives power in the direction pointing back at us") and is
      // wrong. `Level.getBestNeighborSignal` is written out longhand in vanilla and reads
      // `getSignal(pos.below(), Direction.DOWN)` — the neighbour BELOW is asked with DOWN.
      // ⚠ The wire-run test could not see it, because a redstone block answers 15 in every
      // direction and wire-to-wire propagation goes through the horizontal scan below rather
      // than through here. It took a LEVER — the first direction-sensitive source — to show it,
      // and then it broke a torch too: with the directions swapped, a torch fed its own power
      // into the block it stands on and read it straight back as its input.
      var s = Rs.signal(st, d, nx, ny, nz);
      if (s > best) best = s;
      if (best >= Rs.MAX) return Rs.MAX;
    }
    return best;
  };

  /**
   * `Level.hasNeighborSignal`-style total for a CONSUMER: the direct signal of the six
   * neighbours, plus the strong power any adjacent conductor is carrying. A lamp asks this.
   */
  Rs.receivedPower = function (x, y, z) {
    var best = Rs.bestNeighbourSignal(x, y, z);
    if (best >= Rs.MAX) return Rs.MAX;
    for (var d = 0; d < 6; d++) {
      var nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d];
      var st = w.get(nx, ny, nz);
      if (st === 0 || !Rs.isConductor(st)) continue;
      // a conductor re-emits the STRONG power reaching it from its own six sides
      var s = Rs.strongPowerTo(nx, ny, nz);
      if (s > best) best = s;
      if (best >= Rs.MAX) return Rs.MAX;
    }
    return best;
  };

  /**
   * `Level.getSignal(pos, dir)` — what a cell OFFERS in direction `dir`, which is the block's own
   * weak signal, OR, **if the block is a conductor**, the best signal reaching it from anywhere.
   *
   * ⚠ THIS IS THE LINE THAT MAKES A SOLID BLOCK CARRY REDSTONE AT ALL, and it is easy to leave
   * out because nothing looks wrong without it until you try to power something through a wall:
   *
   *     int direct = state.getWeakRedstonePower(this, pos, dir);
   *     return state.isSolidBlock(this, pos)
   *          ? Math.max(direct, this.getReceivedStrongRedstonePower(pos)) : direct;
   *
   * ⚠ STRONG power only (`World.getEmittedRedstonePower`, .decomp). This read the WEAK best
   * neighbour signal until the D-773 cloud unit, so a stone block beside a redstone block — or a
   * retracted piston, which is a solid block — "carried" 15 it never has: redrefcheck's
   * `piston_pushes_power` piston fired itself off the block it was about to push.
   */
  Rs.signalAt = function (x, y, z, dir) {
    var st = w.get(x, y, z);
    if (st === 0) return 0;
    var direct = Rs.signal(st, dir, x, y, z);
    if (!Rs.isConductor(st)) return direct;
    var best = Rs.strongPowerTo(x, y, z);
    return best > direct ? best : direct;
  };

  Rs.hasSignalAt = function (x, y, z, dir) { return Rs.signalAt(x, y, z, dir) > 0; };

  /** The strongest STRONG power arriving at a cell from its six neighbours. */
  Rs.strongPowerTo = function (x, y, z) {
    var best = 0;
    for (var d = 0; d < 6; d++) {
      var nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d];
      var st = w.get(nx, ny, nz);
      if (st === 0) continue;
      var s = Rs.directSignal(st, d, nx, ny, nz);   // `d`, not OPP[d] — see bestNeighbourSignal
      if (s > best) best = s;
      if (best >= Rs.MAX) return Rs.MAX;
    }
    return best;
  };

  // ── the wire ──────────────────────────────────────────────────────────────────────────────
  /**
   * Whether the wire at (x,y,z) connects horizontally in direction `dir` — the RAW side, before
   * axis completion: `getRenderConnectionType(...).isConnected()` (#339, `wireRender` below).
   *
   * `RedstoneWireBlock.getRenderConnectionType`:
   *
   *     if (!above.isSolidBlock && canRunOnTop(side) && connectsTo(side.up())) -> UP/SIDE
   *     return !connectsTo(side, dir) && (side.isSolidBlock || !connectsTo(side.down())) ? NONE : SIDE
   *
   * ⚠ THE UP TEST IS `canRunOnTop`, NOT THE CONDUCTOR TEST (#340): `isSideSolidFullSquare(UP) ||
   * isOf(HOPPER)`, the same rule that lets dust be placed there (02k_survive case 19). Glass,
   * glowstone and a hopper are not conductors but dust on top of them IS a connection, and
   * `wireSides`' axis completion reads this — get it wrong and the wire powers the wrong axis.
   * The POWER rule (`wireTarget`) is different and does use `isSolidBlock` for the climb, so
   * power does not flow up a glass staircase even though the dust draws the connection.
   */
  Rs.wireConnects = function (x, y, z, dir) {
    if (dir === Rs.UP || dir === Rs.DOWN) return false;
    return wireRender(x, y, z, dir, !Rs.isConductor(w.get(x, y + 1, z))) !== 'none';
  };

  /**
   * `RedStoneWireBlock.shouldConnectTo(state, dir)`, verbatim (D-295):
   *
   *     if (state.is(REDSTONE_WIRE)) return true;
   *     if (state.is(REPEATER))      { d = state.getValue(FACING); return d == dir || d.getOpposite() == dir; }
   *     if (state.is(OBSERVER))      return dir == state.getValue(FACING);
   *     return state.isSignalSource() && dir != null;
   *
   * ⚠ WHAT CAME OUT OF THIS LIST MATTERS AS MUCH AS WHAT WENT IN. G15a's version returned true
   * for a REDSTONE LAMP, and that was masking the missing connection-completion rule above: a
   * run of dust reached a lamp only because the lamp claimed to be a connection. A lamp is not
   * a source and vanilla's dust does not connect to it; it lights because a one-axis wire grows
   * its other axis back. Deleting the mask and adding the real rule has to happen together,
   * which is D-139's shape — the replacement is not done until the thing it replaces is gone.
   *
   * ⚠ A COMPARATOR IS NOT SPECIAL-CASED, and that is vanilla: it falls through to
   * `isSignalSource()` and so accepts a wire on all four sides, which is exactly what its side
   * input needs. A repeater's axis test is the one exception, and an observer's single face.
   */
  Rs.connectsToRedstone = function (state, dir) {
    if (state === 0 || !Rs.ready) return false;
    var b = S.block[state];
    if (b === blkWire) return true;
    if (b === blkRepeater) { var f = facingDir(state); return f === dir || OPP[f] === dir; }
    if (b === blkObserver) return facingDir(state) === dir;
    return Rs.isSignalSource(state);
  };

  /** `BlockStateBase.isSignalSource()` (Yarn `emitsRedstonePower`), off the table `init` builds from
   *  `SIGNAL_SOURCES`. Also read outside this file (D-488's spawn test). */
  Rs.isSignalSource = function (state) {
    return !!(Rs.ready && state !== 0 && isSignalSrc && isSignalSrc[S.block[state]] === 1);
  };

  /**
   * `RedStoneWireBlock.getConnectionState` — the four sides a wire ACTUALLY signals along,
   * as a bitmask over this engine's direction numbers.
   *
   * ⚠ THE RAW SIDES ARE NOT THE ANSWER. Vanilla computes the four sides, and then, for each
   * horizontal AXIS that came out with nothing on it, sets BOTH of that axis's sides to SIDE:
   *
   *     if (!west  && !north && !south) west  = SIDE;   if (!east  && !north && !south) east  = SIDE;
   *     if (!north && !east  && !west ) north = SIDE;   if (!south && !east  && !west ) south = SIDE;
   *
   * That is why a dust with a single neighbour to the west renders and behaves as a straight
   * LINE rather than as a stub, and it is the rule that lets a run of dust light the lamp it
   * ends at. The one exception is a wire with no raw connections at all: `getConnectionState`
   * returns early for a dot, and a lone dot powers nothing horizontally.
   * ⚠ "A DOT" IS THE STORED STATE (#339): a lone dust that was PLACED is a cross and powers all
   * four sides; only one right-clicked (or /setblock'd) to all-none is the early-return dot.
   */
  Rs.wireSides = function (x, y, z, state) {
    var st = state === undefined ? w.get(x, y, z) : state;
    if (!Rs.isWire(st)) return 0;
    var shaped = Rs.wireShape(x, y, z, st), out = 0;
    for (var h = 0; h < HORIZ.length; h++) if (wireConn(shaped, HORIZ[h]) !== 'none') out |= 1 << HORIZ[h];
    return out;
  };

  // ══ #339: THE WIRE'S OWN SHAPE — north/east/south/west = none | side | up ════════════════
  //
  // `RedstoneWireBlock` (.decomp) stores its four connections in the STATE, and the model draws
  // them: all four `none` is the DOT, all four `side` (Yarn's misnamed `dotState`) is the CROSS a
  // freshly placed lone dust shows, `up` is the line climbing the face of the block beside it.
  // Before #339 nothing ever wrote them, so every dust in the game drew as a dot.
  //
  // ⚠ THE DOT/CROSS DISTINCTION IS STATE, NOT GEOMETRY. A lone dust is a cross or a dot depending
  // on how it got there (placed -> cross; right-clicked -> dot; /setblock -> dot), and
  // `getWeakRedstonePower` asks `getPlacementState(world, STORED state, pos)`, so a lone cross
  // powers all four sides and a lone dot powers none. `Rs.wireSides` above reads it that way.
  var WIRE_PROP = [null, null, 'north', 'south', 'west', 'east'];
  function wireConn(state, dir) { return B.propName(state, WIRE_PROP[dir]); }
  function withConn(state, dir, v) { return B.setProp(state, WIRE_PROP[dir], v); }
  function allConn(state, v) {
    for (var h = 0; h < HORIZ.length; h++) state = withConn(state, HORIZ[h], v);
    return state;
  }
  function isNotConnected(state) {
    for (var h = 0; h < HORIZ.length; h++) if (wireConn(state, HORIZ[h]) !== 'none') return false;
    return true;
  }
  function isFullyConnected(state) {
    for (var h = 0; h < HORIZ.length; h++) if (wireConn(state, HORIZ[h]) === 'none') return false;
    return true;
  }
  /** `canRunOnTop`: a sturdy top face, or a hopper. On `Rs` so redcheck §9b can swap it out. */
  Rs.canRunOnTop = function (st) { return st !== 0 && (B.faceSturdy(st, Rs.UP) || S.block[st] === blkHopper); };

  /**
   * `getRenderConnectionType(world, pos, dir, aboveOpen)`, verbatim:
   *
   *     if (aboveOpen && canRunOnTop(side) && connectsTo(sideUp))
   *        return side.isSideSolidFullSquare(dir.opposite) ? UP : SIDE;
   *     return !connectsTo(side, dir) && (side.isSolidBlock || !connectsTo(sideDown)) ? NONE : SIDE;
   *
   * `connectsTo(state)` with no direction is true for wire alone (a repeater or observer needs a
   * direction, and `emitsRedstonePower && dir != null` is false), so the climb and the step-down
   * only ever join dust to dust. `aboveOpen` = the block above THIS wire is not a conductor.
   */
  function wireRender(x, y, z, dir, aboveOpen) {
    var sx = x + DX[dir], sy = y + DY[dir], sz = z + DZ[dir];
    var side = w.get(sx, sy, sz);
    if (aboveOpen && Rs.canRunOnTop(side) && Rs.isWire(w.get(sx, sy + 1, sz))) {
      return B.faceSturdy(side, OPP[dir]) ? 'up' : 'side';
    }
    return (!Rs.connectsToRedstone(side, dir) && (Rs.isConductor(side) || !Rs.isWire(w.get(sx, sy - 1, sz))))
      ? 'none' : 'side';
  }

  /**
   * `getPlacementState(world, seed, pos)`: every side recomputed from a blank (all-none) state
   * carrying the seed's power, then — unless the seed was a dot and still nothing connects — each
   * horizontal axis with nothing on it gets BOTH its sides set to SIDE. That completion is why one
   * neighbour draws a straight line and none at all (from a cross seed) draws the cross.
   */
  Rs.wireShape = function (x, y, z, seed) {
    var wasDot = isNotConnected(seed);
    var aboveOpen = !Rs.isConductor(w.get(x, y + 1, z));
    var out = seed;
    for (var h = 0; h < HORIZ.length; h++) out = withConn(out, HORIZ[h], wireRender(x, y, z, HORIZ[h], aboveOpen));
    if (wasDot && isNotConnected(out)) return out;
    var n = wireConn(out, 2) !== 'none', s = wireConn(out, 3) !== 'none';
    var e = wireConn(out, 5) !== 'none', we = wireConn(out, 4) !== 'none';
    var noNS = !n && !s, noEW = !e && !we;
    if (!we && noNS) out = withConn(out, 4, 'side');
    if (!e && noNS) out = withConn(out, 5, 'side');
    if (!n && noEW) out = withConn(out, 2, 'side');
    if (!s && noEW) out = withConn(out, 3, 'side');
    return out;
  };

  /** `getPlacementState(ItemPlacementContext)`: the shape grown from the CROSS (`dotState`, power 0). */
  Rs.wirePlace = function (x, y, z, state) {
    return Rs.wireShape(x, y, z, allConn(B.setProp(state, 'power', 0), 'side'));
  };

  /**
   * `getStateForNeighborUpdate(state, dir, ...)` — `dir` points FROM this wire TO the neighbour
   * that changed. Below: nothing. Above: the whole shape again (the ceiling decides every climb).
   * A side: that one side is rewritten in place when its connected-ness did not flip and the wire
   * is not a cross; otherwise the shape is regrown from the cross with that side preset.
   */
  Rs.wireNeighbourShape = function (state, x, y, z, dir) {
    if (dir === Rs.DOWN) return state;
    if (dir === Rs.UP || dir === undefined) return Rs.wireShape(x, y, z, state);
    var c = wireRender(x, y, z, dir, !Rs.isConductor(w.get(x, y + 1, z)));
    if ((c !== 'none') === (wireConn(state, dir) !== 'none') && !isFullyConnected(state)) return withConn(state, dir, c);
    return Rs.wireShape(x, y, z, withConn(allConn(state, 'side'), dir, c));
  };

  /**
   * `prepare(state, world, pos)` — the DIAGONAL update, run for the old and the new state of every
   * wire write. For each connected side whose neighbour is not wire, the cell below and the cell
   * above that neighbour get `getStateForNeighborUpdate(dir.opposite)`; it is how dust stepping
   * down or climbing learns about a dust it does not touch face to face.
   * ⚠ Vanilla asks every block there except an observer; only WIRE answers anything but its
   * current state from a direction whose neighbour did not change, so only wire is asked here.
   */
  Rs.wirePrepare = function (state, x, y, z) {
    if (!Rs.isWire(state)) return 0;
    var n = 0;
    for (var h = 0; h < HORIZ.length; h++) {
      var dir = HORIZ[h];
      if (wireConn(state, dir) === 'none') continue;
      var sx = x + DX[dir], sy = y + DY[dir], sz = z + DZ[dir];
      if (Rs.isWire(w.get(sx, sy, sz))) continue;
      for (var dy = -1; dy <= 1; dy += 2) {
        var st = w.get(sx, sy + dy, sz);
        if (!Rs.isWire(st)) continue;
        var nw = Rs.wireNeighbourShape(st, sx, sy + dy, sz, OPP[dir]);
        if (nw !== st) { w.set(sx, sy + dy, sz, nw); n++; }
      }
    }
    return n;
  };

  /**
   * `onUse`: a cross (fully connected) becomes a dot and a dot (unconnected) becomes a cross, each
   * regrown through `getPlacementState`; anything else, or no change, PASSes. Then
   * `updateForNewState`: a conductor on a side whose connected-ness flipped has its neighbours
   * told, because what the wire strongly powers through it just changed. Returns true on SUCCESS.
   */
  Rs.wireUse = function (x, y, z) {
    var st = w.get(x, y, z);
    if (!Rs.isWire(st)) return false;
    var full = isFullyConnected(st);
    if (!full && !isNotConnected(st)) return false;
    var nw = Rs.wireShape(x, y, z, allConn(st, full ? 'none' : 'side'));
    if (nw === st) return false;
    w.set(x, y, z, nw);
    Rs.update(x, y, z);
    for (var h = 0; h < HORIZ.length; h++) {
      var dir = HORIZ[h];
      if ((wireConn(st, dir) !== 'none') === (wireConn(nw, dir) !== 'none')) continue;
      var sx = x + DX[dir], sy = y + DY[dir], sz = z + DZ[dir];
      if (Rs.isConductor(w.get(sx, sy, sz))) Rs.update(sx, sy, sz);
    }
    return true;
  };

  /**
   * `RedStoneWireBlock.calculateTargetStrength` — what this wire's power SHOULD be.
   *
   *     shouldSignal = false; blockSignal = bestNeighbourSignal(pos); shouldSignal = true;
   *     wireMax = 0;
   *     if (blockSignal < 15) for each horizontal dir: … max over the three reachable wires
   *     return max(blockSignal, wireMax - 1)
   *
   * ⚠ THE `blockSignal < 15` SHORT-CIRCUIT IS NOT AN OPTIMISATION TO SKIP. It is why a wire
   * sitting next to a lever reads 15 rather than looking at its neighbours at all — and the
   * three vertical cases below are only evaluated in that branch.
   */
  Rs.wireTarget = function (x, y, z) {
    shouldSignal = false;
    var blockSignal = Rs.bestNeighbourSignal(x, y, z);
    // a conductor beside the wire hands on the strong power reaching it
    if (blockSignal < Rs.MAX) {
      for (var d = 0; d < 6; d++) {
        var cx = x + DX[d], cy = y + DY[d], cz = z + DZ[d];
        var cst = w.get(cx, cy, cz);
        if (cst === 0 || !Rs.isConductor(cst)) continue;
        var sp = Rs.strongPowerTo(cx, cy, cz);
        if (sp > blockSignal) blockSignal = sp;
      }
    }
    shouldSignal = true;

    var wireMax = 0;
    if (blockSignal < Rs.MAX) {
      var aboveIsConductor = Rs.isConductor(w.get(x, y + 1, z));
      for (var h = 0; h < HORIZ.length; h++) {
        var dir = HORIZ[h];
        var sx = x + DX[dir], sy = y + DY[dir], sz = z + DZ[dir];
        var side = w.get(sx, sy, sz);
        var p = Rs.powerOf(side);
        if (p > wireMax) wireMax = p;
        if (Rs.isConductor(side)) {
          // ⚠ UP over the block, but only if our own ceiling is open
          if (!aboveIsConductor) {
            var up = Rs.powerOf(w.get(sx, sy + 1, sz));
            if (up > wireMax) wireMax = up;
          }
        } else {
          // ⚠ DOWN beside the block, and only because the side is NOT a conductor
          var dn = Rs.powerOf(w.get(sx, sy - 1, sz));
          if (dn > wireMax) wireMax = dn;
        }
      }
    }
    var t = wireMax - 1;
    return blockSignal > t ? blockSignal : (t > 0 ? t : 0);
  };

  // ── propagation ───────────────────────────────────────────────────────────────────────────
  /**
   * Bring every wire reachable from (x,y,z) to its target power.
   *
   * ⚠ ITERATIVE, NOT RECURSIVE, AND THE REASON IS `Behave.MAX_UPDATE_DEPTH`. Vanilla recurses
   * through `updateNeighborsAt` and caps at 512; this engine caps neighbour recursion at EIGHT,
   * a number chosen for connection families like fences where nothing new happens after one
   * hop. A wire run of fifteen needs fifteen, and raising the cap for everybody would let a
   * rule that oscillates take the frame with it (the reason the cap exists). So the wire gets
   * its own work queue and the general recursion is left alone.
   *
   * ⚠ THE ORDER INSIDE A QUEUE PASS DOES NOT CHANGE THE ANSWER, because the target of each wire
   * is a pure function of its neighbours and the whole thing is run to a fixpoint. It DOES
   * change vanilla's update ORDER, which matters for a handful of timing-sensitive contraptions
   * built on the quirk — G15b's repeaters are where that starts to bite, and it is declared
   * there rather than silently inherited here.
   */
  Rs.MAX_PASSES = 64;
  /**
   * ⚠ THE CELLS THIS UPDATE ACTUALLY CHANGED, kept so that the consumers and torches can be
   * swept around THEM rather than around the cell the player touched. The first version scanned
   * a fixed box around the origin, which meant a lamp four blocks down a wire run never lit:
   * the wire carried the signal perfectly and nothing looked at the far end. A radius is a
   * threshold, and this is the same lesson as everywhere else in this project — follow what
   * changed, do not guess how far it reached.
   */
  var touched = [];
  Rs.updateWires = function (x, y, z) {
    if (!Rs.ready) return 0;
    touched = [];
    var queue = [], seen = Object.create(null), changed = 0;
    var push = function (px, py, pz) {
      var k = px + ',' + py + ',' + pz;
      if (seen[k]) return;
      seen[k] = 1;
      queue.push(px, py, pz);
    };
    // the cell itself and its 26-ish redstone neighbourhood: wire reaches one step up and down
    for (var d = -1; d <= 1; d++) push(x, y + d, z);
    for (var h = 0; h < HORIZ.length; h++) {
      var dir = HORIZ[h];
      for (var dy = -1; dy <= 1; dy++) push(x + DX[dir], y + dy, z + DZ[dir]);
    }

    var pass = 0;
    while (queue.length && pass < Rs.MAX_PASSES) {
      pass++;
      var work = queue;
      queue = [];
      seen = Object.create(null);
      for (var i = 0; i < work.length; i += 3) {
        var wx = work[i], wy = work[i + 1], wz = work[i + 2];
        var st = w.get(wx, wy, wz);
        if (!Rs.isWire(st)) continue;
        var want = Rs.wireTarget(wx, wy, wz);
        var have = B.propName(st, 'power') | 0;
        if (want === have) continue;
        w.set(wx, wy, wz, B.setProp(st, 'power', want));
        changed++;
        touched.push(wx, wy, wz);
        // anything that could read this wire is now stale
        for (var dd = -1; dd <= 1; dd++) push(wx, wy + dd, wz);
        for (var hh = 0; hh < HORIZ.length; hh++) {
          var dir2 = HORIZ[hh];
          for (var ddy = -1; ddy <= 1; ddy++) push(wx + DX[dir2], wy + ddy, wz + DZ[dir2]);
        }
      }
    }
    Rs.lastPasses = pass;
    return changed;
  };

  // ── the torch ─────────────────────────────────────────────────────────────────────────────
  /**
   * `RedstoneTorchBlock.hasNeighborSignal` — the torch is lit when what it is ATTACHED TO is not
   * powered. A standing torch reads the block below it; a wall torch reads the block behind it.
   *
   * ⚠ IT IS `Level.getSignal` AND NOT `getBestNeighborSignal`, which is why a torch on a stone
   * block goes out when wire ANYWHERE on that block is powered: the conductor branch of
   * `signalAt` is what carries the wire's power into the block the torch is standing on.
   */
  Rs.torchInput = function (x, y, z) {
    var st = w.get(x, y, z);
    if (st === 0) return false;
    if (S.block[st] === blkWallTorch) {
      // the wall torch's `facing` points AWAY from the block it is stuck to
      var f = B.propName(st, 'facing');
      var d = f === 'north' ? 2 : f === 'south' ? 3 : f === 'west' ? 4 : 5;
      var bx = x - DX[d], by = y - DY[d], bz = z - DZ[d];
      // asked FROM the torch TO the support (facing.getOpposite()), as the standing torch asks DOWN
      return Rs.hasSignalAt(bx, by, bz, d ^ 1);
    }
    return Rs.hasSignalAt(x, y - 1, z, Rs.DOWN);
  };

  /**
   * ⚠ TWO GAME TICKS, out of `RedstoneTorchBlock.neighborChanged`'s own `iconst_2` — the torch
   * does not flip on the tick its input changes, it SCHEDULES the flip. That delay is not a
   * detail: it is what makes a torch a one-tick inverter rather than an instantaneous one, and
   * every clock and flip-flop in the game is built out of it.
   */
  Rs.TORCH_DELAY = 2;

  /**
   * ── TORCH BURNOUT (D-354) ────────────────────────────────────────────────────────────────
   *
   * Vanilla keeps a per-LEVEL list of recent toggles and, once a position has `BURNOUT_TOGGLES`
   * of them inside `BURNOUT_WINDOW` game ticks, the torch stops coming back on until the window
   * clears. Both constants are read out of the same class (`ldc2_w 60L`, and the count the loop
   * breaks at), so they are recorded rather than guessed.
   *
   * ⚠⚠ **A TOGGLE IS LOGGED ONLY WHEN THE TORCH GOES OUT, AND COUNTED WITHOUT LOGGING WHEN IT
   * WANTS TO COME BACK ON.** Vanilla's `isToggledTooFrequently(level, pos, logToggle)` takes that
   * boolean for exactly this reason, and it is the whole behaviour: logging on BOTH edges would
   * fill the window twice as fast and burn a torch out in half the time, while logging on
   * neither would never burn one out at all. The two call sites pass `true` and `false`, and
   * this file keeps them distinct.
   * ⚠ **AND THE COUNT IS PER POSITION WHILE THE LIST IS PER LEVEL** — a hundred torches toggling
   * elsewhere do not burn this one out, but they do share the list, and the list is trimmed by
   * TIME, not by length.
   *
   * ⚠ ITS ONLY EFFECT IS ON A TORCH DRIVEN BY ITS OWN OUTPUT, which is exactly G15b's clock: the
   * clock that used to run for ever now burns out the way vanilla's does.
   */
  Rs.BURNOUT_WINDOW = 60;
  Rs.BURNOUT_TOGGLES = 8;

  /** The level-wide list of recent toggles: x, y, z, gameTime, four numbers per entry. */
  var toggles = [];
  Rs.toggleCount = function () { return toggles.length / 4; };
  Rs.BURNOUT_RETICK = 160;
  /** world event 1502 log: x,y,z triples, for the check. */
  Rs.burnoutEvents = [];
  Rs.clearToggles = function () { toggles.length = 0; Rs.burnoutEvents.length = 0; };

  /**
   * `RedstoneTorchBlock.isToggledTooFrequently(level, pos, logToggle)`.
   *
   * ⚠ THE TRIM HAPPENS FIRST AND IT IS `> BURNOUT_WINDOW`, not `>=`: vanilla drops entries whose
   * age has PASSED sixty, so an entry exactly sixty ticks old still counts. One tick either way
   * is the difference between a clock that burns out and one that does not, at the boundary.
   */
  Rs.tooFrequent = function (x, y, z, log) {
    var now = B.gameTime | 0, i;
    // trim from the FRONT, which is the oldest: the list is appended in time order
    var cut = 0;
    while (cut < toggles.length && (now - toggles[cut + 3]) > Rs.BURNOUT_WINDOW) cut += 4;
    if (cut) toggles.splice(0, cut);
    if (log) toggles.push(x, y, z, now);
    var n = 0;
    for (i = 0; i < toggles.length; i += 4) {
      if (toggles[i] === x && toggles[i + 1] === y && toggles[i + 2] === z) {
        if (++n >= Rs.BURNOUT_TOGGLES) return true;
      }
    }
    return false;
  };

  /** Settle every torch near (x,y,z), scheduling the two-tick flip. Returns how many scheduled. */
  Rs.updateTorches = function (x, y, z, range) {
    if (!Rs.ready) return 0;
    var r = range === undefined ? 2 : range, n = 0;
    for (var dx = -r; dx <= r; dx++) {
      for (var dy = -r; dy <= r; dy++) {
        for (var dz = -r; dz <= r; dz++) {
          var tx = x + dx, ty = y + dy, tz = z + dz;
          var st = w.get(tx, ty, tz);
          if (st === 0) continue;
          var b = S.block[st];
          if (b !== blkTorch && b !== blkWallTorch) continue;
          var lit = boolProp(st, 'lit');
          if (lit === Rs.torchInput(tx, ty, tz)) { B.schedule(tx, ty, tz, Rs.TORCH_DELAY); n++; }
        }
      }
    }
    return n;
  };

  /** The scheduled flip itself. `Behave.scheduledTick` routes here for a torch. */
  Rs.torchTick = function (x, y, z) {
    var st = w.get(x, y, z);
    if (st === 0) return false;
    var b = S.block[st];
    if (b !== blkTorch && b !== blkWallTorch) return false;
    var lit = boolProp(st, 'lit');
    var input = Rs.torchInput(x, y, z);
    if (lit === input) {
      // ⚠⚠ **THE TWO EDGES ARE NOT SYMMETRICAL** (D-354). Going OUT always happens and LOGS the
      // toggle; coming back ON is REFUSED while the position is over its budget, and counts
      // without logging. Vanilla's own `tick` is shaped exactly this way and the asymmetry is
      // the behaviour: a torch burns out by being switched off too often, and what burning out
      // MEANS is that it will not light again until the window clears.
      if (lit) {
        w.set(x, y, z, B.setProp(st, 'lit', false));
        // `if (isBurnedOut(true)) { syncWorldEvent(1502); createAndScheduleBlockTick(pos, this, 160) }`
        // — the 160-tick retick is what relights a burnt-out torch with nothing else changing.
        if (Rs.tooFrequent(x, y, z, true)) {
          Rs.burnoutEvents.push(x, y, z);
          var Snd = NS.Sound;
          if (Snd && Snd.entitySound) Snd.entitySound('block.redstone_torch.burnout', x + 0.5, y + 0.5, z + 0.5, 0.5, 2.6 + (Math.random() - Math.random()) * 0.8, 'block', NS.Player);
          B.schedule(x, y, z, Rs.BURNOUT_RETICK);
        }
      } else {
        if (Rs.tooFrequent(x, y, z, false)) return false;
        w.set(x, y, z, B.setProp(st, 'lit', true));
      }
      Rs.update(x, y, z);
      Rs.updateTorches(x, y, z);
      return true;
    }
    return false;
  };

  /**
   * ── DAYLIGHT DETECTOR (PASS 15 JOB 2) ───────────────────────────────────────────────────
   *
   * `Rs.OWED_SOURCES.daylight_detector` used to say "sky light and a time of day — G16 builds
   * both" — and G16 has been complete for five sessions, so this was the exact shape `stagecheck`
   * now catches on its own: an excuse whose reason expired. Both halves ARE built (`Sky.sunAngle`,
   * `Sky.weather`), so this is wiring, not a new system.
   *
   * ⚠⚠ EVERY LINE BELOW IS `DaylightDetectorBlock` FROM THE 1.18.2 BYTECODE, NOT RECALLED —
   * class `cff`, found the same way every class in this file is (D-263): `Blocks.<clinit>`'s
   * name-literal-before-`new`, confirmed against `tools/golden/signal-sources-1.18.2.tsv`'s own
   * `daylight_detector -> cff` row. `javap -p -c` on the real jar gives the private static
   * `d(cov state, cav level, gj pos)` vanilla calls `updateSignalStrength`, written out here
   * exactly as it disassembles:
   *
   *     int i = level.getBrightness(SKY, pos) - level.getSkyDarken();     // cav.a(SKY,pos) - cav.o_()
   *     float f = level.getSunAngle(1.0F);                                // cav.a(1.0F)
   *     if (state.getValue(INVERTED)) {
   *       i = 15 - i;
   *     } else if (i > 0) {
   *       float f1 = f < PI ? 0.0F : TAU;
   *       f += (f1 - f) * 0.2F;
   *       i = Math.round((float) i * Mth.cos(f));
   *     }
   *     i = Mth.clamp(i, 0, 15);
   *
   * and `level.getSkyDarken()` is itself compiled Java on the SAME class (`cav.R()`, the field
   * `o_()` just returns), read the same way:
   *
   *     double d1 = 1.0 - level.getRainLevel(1.0F) * 5.0F / 16.0;         // cav.d(1.0F)
   *     double d2 = 1.0 - level.getThunderLevel(1.0F) * 5.0F / 16.0;      // cav.b(1.0F)
   *     double d3 = 0.5 + 2.0 * Mth.clamp(Math.cos(level.getSunAngle(1.0F)), -0.25, 0.25);
   *     return (int) ((1.0 - d3 * d1 * d2) * 11.0);
   *
   * ⚠ THE TICKER, ALSO READ RATHER THAN GUESSED: `cff`'s block-entity ticker (`getTicker`, gated
   * `!level.isClientSide`) runs a static helper every game tick that no-ops unless
   * `level.getGameTime() % 20 == 0` — once a second, not every tick. That gate is `BE.tick`'s
   * job below (D-139: the caller owns the schedule; the arithmetic does not know what a tick is,
   * so a test can call it on any tick without faking the clock).
   *
   * ⚠ NEITHER `Sky.sunAngle` NOR `Sky.weather` IS REBUILT HERE — one source of truth (D-139).
   * Weather's RENDER half (rain/thunder level, already tracked for fog and sky colour by G16)
   * answers `getRainLevel`/`getThunderLevel` exactly; G20's gameplay half (rain sound, wetting,
   * lightning) is unbuilt and irrelevant to this arithmetic.
   */
  Rs.skyDarken = function (dayTime, rain, thunder) {
    var Sky = NS.Sky;
    var f = Sky && Sky.ready !== false ? Sky.sunAngle(dayTime) : 0;
    var d1 = 1 - (rain || 0) * 5 / 16;
    var d2 = 1 - (thunder || 0) * 5 / 16;
    var cosF = Math.cos(f);
    var clamped = cosF < -0.25 ? -0.25 : (cosF > 0.25 ? 0.25 : cosF);
    var d3 = clamped * 2 + 0.5;
    return Math.floor((1 - d3 * d1 * d2) * 11);
  };

  /** The pure 0..15 arithmetic, given the RAW sky light at the cell (unscaled by time of day —
   *  the lighting system's own number) and whether this instance is inverted. */
  Rs.daylightSignal = function (skyLight, inverted, dayTime, rain, thunder) {
    var Sky = NS.Sky;
    var i = skyLight - Rs.skyDarken(dayTime, rain, thunder);
    if (inverted) {
      i = 15 - i;
    } else if (i > 0) {
      var f = Sky && Sky.ready !== false ? Sky.sunAngle(dayTime) : 0;
      var TAU = 6.2831855;
      var f1 = f < Math.PI ? 0 : TAU;
      f += (f1 - f) * 0.2;
      i = Math.round(i * Math.cos(f));
    }
    return i < 0 ? 0 : (i > 15 ? 15 : i);
  };

  /**
   * Recompute one daylight detector's stored `power` and write it back if it changed.
   * ⚠ NO BLOCK-ENTITY READ HERE: vanilla's ticker hangs off a block entity, but the POWER
   * ITSELF is a BLOCK-STATE property (`state.setValue(POWER, i)`), same as every analog block
   * in this file — the block entity is only how vanilla schedules the once-a-second check.
   */
  Rs.updateDaylightDetector = function (x, y, z) {
    if (!Rs.ready) return false;
    var st = w.get(x, y, z);
    if (st === 0 || S.block[st] !== R.id.daylight_detector) return false;
    var Sky = NS.Sky;
    // ⚠ SKY LIGHT COMES FROM `B.world`, NOT `w` (`B.w`). `B.w` is Behave's OWN block-access
    // wrapper (D-302) — it exposes `get`/`set`/`light`, and `light` is BLOCK light with a
    // hardcoded no-engine fallback of 15, never sky. `B.world` is the raw adapter this module
    // was initialized with — `NS.World` in the game, a fixture's own object in a check — and
    // that is where the real `getLight` (sky<<4 | block, same packing as `07_world.js`) lives.
    var sky = (B.world && B.world.getLight) ? ((B.world.getLight(x, y, z) >> 4) & 15) : 15;
    var inverted = boolProp(st, 'inverted');
    var wx = Sky ? (Sky.weather || Sky.newWeather()) : null;
    var rain = wx ? wx.rainLevel : 0;
    var thunder = wx ? Sky.thunderLevelOf(wx) : 0;
    var i = Rs.daylightSignal(sky, inverted, Sky ? Sky.dayTime : 0, rain, thunder);
    var cur = B.propName(st, 'power') | 0;
    if (cur === i) return false;
    w.set(x, y, z, B.setProp(st, 'power', i));
    Rs.update(x, y, z);
    return true;
  };

  /**
   * ⚠⚠ **THE DISPENSER'S TRIGGER, AND THE QUASI-CONNECTIVITY THAT COMES WITH IT — D-420.**
   * `DispenserBlock.neighborChanged` is, in full:
   *     boolean flag  = level.hasNeighborSignal(pos) || level.hasNeighborSignal(pos.above());
   *     boolean flag1 = state.getValue(TRIGGERED);
   *     if (flag && !flag1) { level.scheduleTick(pos, this, 4);
   *                           level.setBlock(pos, state.setValue(TRIGGERED, true), 4); }
   *     else if (!flag && flag1) level.setBlock(pos, state.setValue(TRIGGERED, false), 4);
   *
   * ⚠ **THE `pos.above()` TERM IS NOT A TYPO AND IT IS NOT OPTIONAL.** It is Java Edition's
   * famous quasi-connectivity: a dispenser fires when the cell ABOVE it is powered, which is
   * what every BUD and every piston-door clock in the game is built on. A clone that dropped it
   * would look identical on a lever and break every contraption.
   * ⚠ `TRIGGERED` IS A LATCH, NOT A STATE OF BEING POWERED: it is what makes a dispenser fire
   * ONCE on the rising edge instead of every tick the lever is down.
   */
  Rs.DISPENSER_DELAY = 4;
  /**
   * How far the neighbour update from a change at (x,y,z) reaches a DISPENSER/DROPPER. Vanilla's
   * `neighborChanged` is only called by a real neighbour update: a plain block (stone, a chest, a
   * redstone BLOCK — `setBlock` flag 3 is `updateNeighbors`, six cells) reaches Manhattan 1; a
   * component (wire, torch, diode, lever/button/plate, observer — they update their neighbours'
   * neighbours too) reaches Manhattan 2. An emptied cell may have been a component, so it gets 2.
   * The old 5x5x5 box woke a dropper diagonally below a new redstone block, which the server
   * never does: quasi-connectivity waits for a LATER update (dispenserefcheck `dropper_quasi`).
   */
  Rs.dispenserReach = function (x, y, z) {
    var st = w.get(x, y, z);
    if (st === 0) return 2;
    var b = S.block[st];
    if (b === blkBlock) return 1;
    return (isWire(st) || isSignalSrc[b]) ? 2 : 1;
  };
  Rs.updateDispensers = function (x, y, z) {
    if (!Rs.ready) return 0;
    var n = 0, reach = Rs.dispenserReach(x, y, z);
    for (var dx = -2; dx <= 2; dx++) {
      for (var dy = -2; dy <= 2; dy++) {
        for (var dz = -2; dz <= 2; dz++) {
          var cx = x + dx, cy = y + dy, cz = z + dz;
          var st = w.get(cx, cy, cz);
          if (st === 0) continue;
          var b = S.block[st];
          if (b === blkDispenser || b === blkDropper) {
            if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > reach) continue;
            var live = Rs.receivedPower(cx, cy, cz) > 0 || Rs.receivedPower(cx, cy + 1, cz) > 0;
            var latched = boolProp(st, 'triggered');
            if (live && !latched) {
              w.set(cx, cy, cz, B.setProp(st, 'triggered', true));
              B.schedule(cx, cy, cz, Rs.DISPENSER_DELAY);
              n++;
            } else if (!live && latched) {
              w.set(cx, cy, cz, B.setProp(st, 'triggered', false));
              n++;
            }
          } else if (b === blkHopper) {
            // D-420 — the hopper's `ENABLED` property, WRITTEN rather than only read. It was on
            // `BE.HOPPER_OWED` because the transfer asked the signal directly and the property
            // was left lying: a hopper that behaved as powered while F3 said otherwise. One
            // question, one answer, one place — the transfer still asks the signal, and this
            // keeps the property honest about it.
            var on = Rs.receivedPower(cx, cy, cz) === 0;
            if (boolProp(st, 'enabled') !== on) { w.set(cx, cy, cz, B.setProp(st, 'enabled', on)); n++; }
          }
        }
      }
    }
    return n;
  };

  /**
   * The scheduled half: four ticks after the latch, the block fires ONCE. Returns true if this
   * cell was a dispenser or dropper, so `Behave.scheduledTick`'s chain can stop here.
   */
  Rs.dispenserTick = function (x, y, z) {
    if (!Rs.ready) return false;
    var st = w.get(x, y, z);
    if (st === 0) return false;
    var b = S.block[st];
    if (b !== blkDispenser && b !== blkDropper) return false;
    var Be = NS.BlockEntities;                 // ⚠ NOT the module-level `BE`, which is set once
    var be = (Be && Be.ready) ? Be.get(x, y, z) : null;
    if (be) Be.dispenseFrom(be, Rs.rng || Math.random);
    return true;
  };

  /**
   * `TntBlock.neighborUpdate`/`onBlockAdded` (.decomp/net/minecraft/block/TntBlock.java:34-50):
   * both overrides are the SAME one-liner, `if (world.isReceivingRedstonePower(pos)) { primeTnt
   * (world, pos); world.removeBlock(pos, false); }` — called whenever the TNT cell itself OR a
   * neighbour of it changes. This engine has no per-block neighborUpdate dispatch at all (see
   * `Rs.updateDispensers`'s own header reasoning, just above, which this copies exactly): every
   * consumer instead re-polls a small radius around WHATEVER changed, so one `Rs.settle` catches
   * both vanilla entry points — a TNT block freshly placed on live redstone (`onBlockAdded`, the
   * placement itself is the "something changed" `07_world.js:957` already funnels through
   * `B.changed`) and a TNT block whose neighbour just got powered (`neighborUpdate`).
   * `Use.primeTnt` (14l_use.js, this unit's own file) is reused rather than re-typed — it already
   * does exactly `removeBlock` + `spawnEntity`, `P: null` is safe (`Use.damage` early-returns on
   * a falsy player) since redstone has no player to credit.
   */
  Rs.updateTnt = function (x, y, z) {
    if (!Rs.ready || blkTnt < 0) return 0;
    var Use = NS.Use;
    if (!Use || !Use.ready || !Use.primeTnt) return 0;
    var n = 0;
    for (var dx = -2; dx <= 2; dx++) {
      for (var dy = -2; dy <= 2; dy++) {
        for (var dz = -2; dz <= 2; dz++) {
          var cx = x + dx, cy = y + dy, cz = z + dz;
          var st = w.get(cx, cy, cz);
          if (st === 0 || S.block[st] !== blkTnt) continue;
          if (Rs.receivedPower(cx, cy, cz) > 0) {
            Use.primeTnt(null, cx, cy, cz, st);
            n++;
          }
        }
      }
    }
    return n;
  };

  /** Re-light every redstone lamp near (x,y,z). Lamps are the one pure consumer G15a ships. */
  Rs.updateConsumers = function (x, y, z) {
    if (!Rs.ready) return 0;
    var n = 0;
    for (var dx = -2; dx <= 2; dx++) {
      for (var dy = -2; dy <= 2; dy++) {
        for (var dz = -2; dz <= 2; dz++) {
          var st = w.get(x + dx, y + dy, z + dz);
          if (st === 0) continue;
          if (consumerKind[S.block[st]]) { n += updateOpener(x + dx, y + dy, z + dz, st); continue; }
          if (S.block[st] !== blkLamp) continue;
          // `RedstoneLampBlock.neighborUpdate`: turning ON is immediate, turning OFF is a
          // scheduled tick 4 later (`createAndScheduleBlockTick(pos, this, 4)`), re-checked in
          // `Rs.lampTick` — which is why a 1-tick pulse keeps a lamp lit for 5 ticks.
          var on = Rs.receivedPower(x + dx, y + dy, z + dz) > 0;
          if (boolProp(st, 'lit') !== on) {
            if (on) { w.set(x + dx, y + dy, z + dz, B.setProp(st, 'lit', true)); n++; }
            else B.schedule(x + dx, y + dy, z + dz, 4);
          }
        }
      }
    }
    return n;
  };

  // ── the openers ────────────────────────────────────────────────────────────────────────
  // All five are inline (`setBlockState` in `neighborUpdate`, no scheduled tick), so the change
  // lands in the same tick as the power — redrefcheck's `iron_door`/`fence_gate`/... goldens.
  function recv(x, y, z) { return Rs.receivedPower(x, y, z) > 0; }
  function updateOpener(x, y, z, st) {
    var kind = consumerKind[S.block[st]];
    var powered = boolProp(st, 'powered');
    if (kind === K_DOOR) {
      // `DoorBlock.neighborUpdate`: this half OR the other half receiving power; both halves
      // take `powered` and `open` (the other through `getStateForNeighborUpdate`'s copy).
      var up = B.propName(st, 'half') === 'upper';
      var oy = up ? y - 1 : y + 1;
      var on = recv(x, y, z) || recv(x, oy, z);
      if (on === powered) return 0;
      w.set(x, y, z, B.setProp(B.setProp(st, 'powered', on), 'open', on));
      var ost = w.get(x, oy, z);
      if (ost !== 0 && S.block[ost] === S.block[st] && B.propName(ost, 'half') !== B.propName(st, 'half')) {
        w.set(x, oy, z, B.setProp(B.setProp(ost, 'powered', on), 'open', on));
      }
      return 1;
    }
    if (kind === K_RAIL) return updateRails(x, y, z);
    var p = recv(x, y, z);
    if (p === powered) return 0;
    var next = B.setProp(st, 'powered', p);
    // trapdoor and fence gate open with the power; a note block only records it (and plays)
    if (kind === K_TRAPDOOR || kind === K_GATE) next = B.setProp(next, 'open', p);
    // `NoteBlock.neighborUpdate`: a RISING edge plays (`playNote`, air above) before the POWERED write
    if (kind === K_NOTE && p && NS.Note && NS.Note.ready) NS.Note.playNote(x, y, z);
    // `BellBlock.neighborUpdate`: a RISING edge rings (facing direction) before the POWERED write
    if (kind === K_BELL && p && NS.Bell && NS.Bell.ringBlock) NS.Bell.ringBlock(x, y, z, -1, null, false);
    w.set(x, y, z, next);
    return 1;
  }

  // `PoweredRailBlock.updateBlockState` + `isPoweredByOtherRails`: a rail is powered by a
  // signal, or by a POWERED rail of the same block up to 8 rails along its line that is itself
  // powered by a signal. Each change notifies its neighbours (flag 3), so the line settles as
  // a cascade — run here as a work list rather than recursion.
  var RAIL_SHAPES = ['north_south', 'east_west', 'ascending_east', 'ascending_west', 'ascending_north', 'ascending_south'];
  function railShape(st) { return RAIL_SHAPES.indexOf(B.propName(st, 'shape')); }
  function poweredByRails(x, y, z, st, fwd, depth) {
    if (depth >= 8) return false;
    var shape = railShape(st), flat = true, nx = x, ny = y, nz = z, axis = shape;
    switch (shape) {
      case 0: nz += fwd ? 1 : -1; break;
      case 1: nx += fwd ? -1 : 1; break;
      case 2: if (fwd) nx--; else { nx++; ny++; flat = false; } axis = 1; break;
      case 3: if (fwd) { nx--; ny++; flat = false; } else nx++; axis = 1; break;
      case 4: if (fwd) nz++; else { nz--; ny++; flat = false; } axis = 0; break;
      case 5: if (fwd) { nz++; ny++; flat = false; } else nz--; axis = 0; break;
      default: return false;
    }
    return railAt(nx, ny, nz, S.block[st], fwd, depth, axis) || (flat && railAt(nx, ny - 1, nz, S.block[st], fwd, depth, axis));
  }
  function railAt(x, y, z, blk, fwd, depth, axis) {
    var st = w.get(x, y, z);
    if (st === 0 || S.block[st] !== blk) return false;
    var sh = railShape(st);
    if (axis === 1 && (sh === 0 || sh === 4 || sh === 5)) return false;
    if (axis === 0 && (sh === 1 || sh === 2 || sh === 3)) return false;
    if (!boolProp(st, 'powered')) return false;
    return recv(x, y, z) ? true : poweredByRails(x, y, z, st, fwd, depth + 1);
  }
  function updateRails(x0, y0, z0) {
    var work = [x0, y0, z0], n = 0, guard = 0;
    while (work.length && guard++ < 512) {
      var z = work.pop(), y = work.pop(), x = work.pop();
      var st = w.get(x, y, z);
      if (st === 0 || consumerKind[S.block[st]] !== K_RAIL) continue;
      var was = boolProp(st, 'powered');
      var on = recv(x, y, z) || poweredByRails(x, y, z, st, true, 0) || poweredByRails(x, y, z, st, false, 0);
      if (on === was) continue;
      w.set(x, y, z, B.setProp(st, 'powered', on));
      n++;
      for (var d = -1; d <= 1; d += 2) {
        for (var dy = -1; dy <= 1; dy++) work.push(x + d, y + dy, z, x, y + dy, z + d);
      }
    }
    return n;
  }

  /** `RedstoneLampBlock.scheduledTick`: still lit and still unpowered -> goes out. */
  Rs.lampTick = function (x, y, z) {
    var st = w.get(x, y, z);
    if (st === 0 || S.block[st] !== blkLamp) return false;
    if (boolProp(st, 'lit') && !(Rs.receivedPower(x, y, z) > 0)) {
      w.set(x, y, z, B.setProp(st, 'lit', false));
    }
    return true;
  };

  /**
   * One entry point for "something at (x,y,z) changed" — wires first, then everything that
   * reads a wire.
   *
   * ⚠ RE-ENTRANT, AND THE GUARD IS NOT OPTIONAL. `Rs.updateInFront` calls back in here, so a
   * repeater feeding a second repeater feeding the first would recurse for ever; vanilla is
   * saved by its scheduler (the diodes only ever SCHEDULE from a neighbour change, they do not
   * settle inline) and this needs the same floor under it. The depth is small on purpose: a
   * legitimate chain hands off through `B.schedule`, so anything deeper than this is a loop.
   */
  Rs.MAX_UPDATE_DEPTH = 8;
  var updateDepth = 0;
  Rs.update = function (x, y, z) {
    if (!Rs.ready) return 0;
    if (updateDepth >= Rs.MAX_UPDATE_DEPTH) return 0;
    updateDepth++;
    try { return updateInner(x, y, z); } finally { updateDepth--; }
  };
  function settle(x, y, z) {
    var n = Rs.updateConsumers(x, y, z);
    Rs.updateTorches(x, y, z);
    Rs.updateDiodes(x, y, z);
    // PASS 17 JOB 1 (G19b), D-420 — the dispenser, the dropper and the hopper's own gate settle
    // here too, and for `Piston.update`'s reason: one door marked "something near this cell
    // changed". A second entry point would arm a dispenser twice on one change, and a dispenser
    // armed twice fires twice off one lever.
    Rs.updateDispensers(x, y, z);
    // loop/tnt-s96 -- the TNT block's own redstone ignition, same settle-radius slot the
    // dispenser/dropper/hopper gate above already occupies (D-420's own reasoning).
    Rs.updateTnt(x, y, z);
    if (NS.CmdBlock && NS.CmdBlock.ready) NS.CmdBlock.update(x, y, z);   // #8300 CommandBlock.neighborUpdate
    // PLAN G15c — a piston is a redstone CONSUMER and settles here with the rest of them
    // (D-298). ⚠ It is called from HERE and not from `Behave.changed`, so that there is exactly
    // one door marked "something near this cell changed": a second entry point would fire every
    // piston twice per change, and a piston that fires twice retracts into its own push.
    if (NS.Piston && NS.Piston.ready) NS.Piston.update(x, y, z);
    // the LOCKED property is cosmetic but must not lie about the rule (see `refreshLocked`)
    for (var dx = -2; dx <= 2; dx++) {
      for (var dz = -2; dz <= 2; dz++) {
        for (var dy = -1; dy <= 1; dy++) Rs.refreshLocked(x + dx, y + dy, z + dz);
      }
    }
    return n;
  }
  function updateInner(x, y, z) {
    var n = Rs.updateWires(x, y, z);
    var moved = touched.slice();           // ⚠ `touched` is clobbered by a nested update
    n += settle(x, y, z);
    for (var i = 0; i < moved.length; i += 3) n += settle(moved[i], moved[i + 1], moved[i + 2]);
    return n;
  }

  /** What the last `update` changed, as a flat [x,y,z,...] list. The check reads it. */
  Rs.lastTouched = function () { return touched.slice(); };

  /** Flip a lever/button/plate and let the signal settle. Returns the new state. */
  Rs.setPowered = function (x, y, z, on) {
    var st = w.get(x, y, z);
    if (st === 0) return 0;
    var next = B.setProp(st, 'powered', !!on);
    if (next !== st) w.set(x, y, z, next);
    Rs.update(x, y, z);
    return next;
  };

  // ══ G15b: THE DIODES ═══════════════════════════════════════════════════════════════════
  //
  // ⚠⚠ `FACING` POINTS AT THE **INPUT**, NOT AT THE OUTPUT, and getting that backwards makes
  // every circuit in this section run the wrong way while still looking alive. It is not a
  // matter of taste — `DiodeBlock.getInputSignal` reads `pos.relative(state.getValue(FACING))`
  // and `DiodeBlock.updateNeighborsInFront` writes to `pos.relative(FACING.getOpposite())`.
  // The two together pin it: the block the repeater READS is on its FACING side. The output
  // neighbour therefore asks with `dir == FACING` (its own direction toward the repeater is
  // the repeater's facing), which is why `Rs.signal`'s diode branch compares against `dir`
  // directly and agrees with the `d`-not-`OPP[d]` convention G15a had to learn the hard way.

  /** vanilla's `Direction.getClockWise()` / `getCounterClockWise()`, in this engine's numbers. */
  var CW = [-1, -1, 5, 4, 2, 3];              // north->east  south->west  west->north  east->south
  var CCW = [-1, -1, 4, 5, 3, 2];             // north->west  west->south  south->east  east->north

  function facingDir(state) {
    var f = B.propName(state, 'facing');
    return f === 'north' ? 2 : f === 'south' ? 3 : f === 'west' ? 4 : f === 'east' ? 5 : -1;
  }
  Rs.facingDir = facingDir;

  /** `DiodeBlock.isDiode(state)` — `state.getBlock() instanceof DiodeBlock`, i.e. these two. */
  Rs.isDiode = function (state) {
    if (state === 0 || !Rs.ready) return false;
    var b = S.block[state];
    return b === blkRepeater || b === blkComparator;
  };
  Rs.isRepeater = function (st) { return st !== 0 && Rs.ready && S.block[st] === blkRepeater; };
  Rs.isComparator = function (st) { return st !== 0 && Rs.ready && S.block[st] === blkComparator; };

  /**
   * `RepeaterBlock.getDelay` = `DELAY * 2`, from the literal `iconst_2; imul`. The property runs
   * 1..4, so the four right-click settings are 2, 4, 6 and 8 GAME ticks — the "one to four
   * redstone ticks" a player counts.
   */
  Rs.repeaterDelay = function (state) { return (B.propName(state, 'delay') | 0) * 2; };
  /** `ComparatorBlock.getDelay` is a bare `iconst_2`. A comparator has no delay setting. */
  Rs.COMPARATOR_DELAY = 2;
  Rs.diodeDelay = function (state) {
    return S.block[state] === blkComparator ? Rs.COMPARATOR_DELAY : Rs.repeaterDelay(state);
  };

  // ── the comparator's stored output ────────────────────────────────────────────────────────
  /**
   * ⚠ A COMPARATOR'S OUTPUT IS NOT IN ITS BLOCK STATE. The state carries one boolean, `powered`,
   * and the analog strength lives in a `ComparatorBlockEntity` — vanilla's own split, and the
   * reason a comparator can hold 7 while its state says only "on". This engine already has the
   * per-position entity store from G2, and the `comparator` type was already registered there,
   * so the number goes where vanilla puts it rather than into a second map that could drift.
   */
  function comparatorEntity(x, y, z) {
    if (!BE) return null;
    var e = BE.get(x, y, z);
    if (e && e.type === 'comparator') return e;
    var st = w.get(x, y, z);
    if (st === 0 || S.block[st] !== blkComparator) return null;
    return BE.create(x, y, z, 'comparator');       // placed before the store existed: make it now
  }
  Rs.comparatorOutput = function (x, y, z) {
    var e = comparatorEntity(x, y, z);
    return e ? (e.output | 0) : 0;
  };
  Rs.setComparatorOutput = function (x, y, z, v) {
    var e = comparatorEntity(x, y, z);
    if (e) e.output = v | 0;
    return e ? e.output : 0;
  };

  /** `DiodeBlock.getOutputSignal` — 15 for a repeater, the stored number for a comparator. */
  Rs.outputSignal = function (state, x, y, z) {
    return S.block[state] === blkComparator ? Rs.comparatorOutput(x, y, z) : Rs.MAX;
  };

  // ── what a diode reads ────────────────────────────────────────────────────────────────────
  /**
   * `DiodeBlock.getInputSignal`:
   *
   *     Direction facing = state.getValue(FACING);
   *     BlockPos back = pos.relative(facing);
   *     int i = level.getSignal(back, facing);
   *     if (i >= 15) return i;
   *     return Math.max(i, backState.is(REDSTONE_WIRE) ? backState.getValue(POWER) : 0);
   *
   * ⚠ THE SECOND TERM IS NOT REDUNDANT. `level.getSignal(back, facing)` asks the wire behind
   * the repeater whether it is connected TOWARD the repeater; if the wire runs past the back of
   * the repeater without turning into it, that answer is 0 — and vanilla still takes the wire's
   * raw power. That is why a repeater picks up a dust line that merely passes its back face.
   */
  Rs.diodeInput = function (x, y, z, state) {
    var f = facingDir(state);
    if (f < 0) return 0;
    var bx = x + DX[f], by = y + DY[f], bz = z + DZ[f];
    var i = Rs.signalAt(bx, by, bz, f);
    var back = w.get(bx, by, bz);
    if (i < Rs.MAX) {
      var p = Rs.isWire(back) ? (B.propName(back, 'power') | 0) : 0;
      if (p > i) i = p;
    }
    if (S.block[state] !== blkComparator) return i;

    // `ComparatorBlock.getInputSignal`'s override: an ANALOG block behind the comparator
    // REPLACES the redstone reading outright — a chest holding one item reads 1 even if a
    // fully lit wire also touches the comparator's back.
    if (Rs.hasAnalogOutput(back)) return Rs.analogOutput(bx, by, bz, back);
    if (i < Rs.MAX && Rs.isConductor(back)) {
      // ⚠ THE ONE-BLOCK GAP IS REAL AND IS NOT A BUG: a comparator reads a container through a
      // single solid block. `back = back.relative(facing)` in vanilla, then the same question.
      var cx = bx + DX[f], cy = by + DY[f], cz = bz + DZ[f];
      var far = w.get(cx, cy, cz);
      if (Rs.hasAnalogOutput(far)) return Rs.analogOutput(cx, cy, cz, far);
      // ComparatorBlock.getAttachedItemFrame: a frame in the far cell facing the comparator's
      // way (ItemFrameEntity.getComparatorPower); the larger of it and the far block's reading wins.
      var fp = NS.Hanging && NS.Hanging.frameComparatorPower ? NS.Hanging.frameComparatorPower(cx, cy, cz, DX[f], DZ[f]) : -1;
      if (fp >= 0) return fp;
    }
    return i;
  };

  /**
   * `DiodeBlock.getAlternateSignalAt` — one side of a diode.
   *
   * ⚠ THE TWO DIODES DISAGREE ABOUT WHAT COUNTS, and this is the whole difference between
   * locking and side-input. `RepeaterBlock.isAlternateInput` is `isDiode(state)` — ONLY another
   * repeater or comparator can reach a repeater's side, which is what makes the repeater lock a
   * latch rather than a thing any stray dust can jam. `DiodeBlock.isAlternateInput` (which the
   * comparator inherits) is `state.isSignalSource()` — so a comparator's side takes dust, a
   * torch, a lever, anything.
   */
  Rs.alternateSignalAt = function (x, y, z, dir, forBlock) {
    var st = w.get(x, y, z);
    if (st === 0) return 0;
    var accepted = (forBlock === blkRepeater) ? Rs.isDiode(st) : Rs.isSignalSource(st);
    if (!accepted) return 0;
    if (S.block[st] === blkBlock) return Rs.MAX;
    if (Rs.isWire(st)) return B.propName(st, 'power') | 0;
    return Rs.directSignal(st, dir, x, y, z);
  };

  /** `DiodeBlock.getAlternateSignal` — the larger of the two sides. */
  Rs.alternateSignal = function (x, y, z, state) {
    var f = facingDir(state);
    if (f < 0) return 0;
    var b = S.block[state];
    var a = CW[f], c = CCW[f];
    var s1 = Rs.alternateSignalAt(x + DX[a], y + DY[a], z + DZ[a], a, b);
    var s2 = Rs.alternateSignalAt(x + DX[c], y + DY[c], z + DZ[c], c, b);
    return s1 > s2 ? s1 : s2;
  };

  /** `RepeaterBlock.isLocked` — a diode pointing into either side, at all. */
  Rs.isLocked = function (x, y, z, state) {
    if (S.block[state] !== blkRepeater) return false;       // `DiodeBlock.isLocked` is `false`
    return Rs.alternateSignal(x, y, z, state) > 0;
  };

  /**
   * `ComparatorBlock.calculateOutputSignal`:
   *     int input = getInputSignal(); if (input == 0) return 0;
   *     int side  = getAlternateSignal(); if (side > input) return 0;
   *     return mode == SUBTRACT ? input - side : input;
   */
  Rs.comparatorValue = function (x, y, z, state) {
    var input = Rs.diodeInput(x, y, z, state);
    if (input === 0) return 0;
    var side = Rs.alternateSignal(x, y, z, state);
    if (side > input) return 0;
    if (B.propName(state, 'mode') === 'subtract') return input - side;
    return input;
  };

  /**
   * `shouldTurnOn`. ⚠ THE COMPARATOR'S IS NOT `value > 0`, and the difference is visible: in
   * COMPARE mode an input EQUAL to the side still turns it on (`input == side && COMPARE`),
   * whereas SUBTRACT mode at equal strength gives 0 and goes dark.
   */
  Rs.diodeShouldTurnOn = function (x, y, z, state) {
    var input = Rs.diodeInput(x, y, z, state);
    if (S.block[state] !== blkComparator) return input > 0;
    if (input === 0) return false;
    var side = Rs.alternateSignal(x, y, z, state);
    if (input > side) return true;
    return input === side && B.propName(state, 'mode') === 'compare';
  };

  // ── the tick ──────────────────────────────────────────────────────────────────────────────
  /**
   * ⚠ VANILLA'S TICK PRIORITIES, READ FROM `TickPriority`'s own `<clinit>` (EXTREMELY_HIGH −3,
   * VERY_HIGH −2, HIGH −1, NORMAL 0). They are not decoration: `DiodeBlock.checkTickOnNeighbor`
   * picks EXTREMELY_HIGH when this diode faces into another diode, VERY_HIGH when it is turning
   * OFF, and HIGH otherwise — which is what makes two repeaters pointed at each other settle
   * the same way every time instead of by array order.
   */
  Rs.PRIO_EXTREMELY_HIGH = -3;
  Rs.PRIO_VERY_HIGH = -2;
  Rs.PRIO_HIGH = -1;
  Rs.PRIO_NORMAL = 0;

  /** `DiodeBlock.shouldPrioritize` — the block in FRONT of us is a diode not aligned with us. */
  Rs.shouldPrioritize = function (x, y, z, state) {
    var f = facingDir(state);
    if (f < 0) return false;
    var d = OPP[f];
    var other = w.get(x + DX[d], y + DY[d], z + DZ[d]);
    return Rs.isDiode(other) && facingDir(other) !== d;
  };

  /**
   * `DiodeBlock.checkTickOnNeighbor` and `ComparatorBlock`'s override of it — the "something
   * near me changed, do I need to schedule" question. Returns true when it scheduled.
   */
  Rs.diodeCheck = function (x, y, z) {
    var state = w.get(x, y, z);
    if (state === 0 || !Rs.isDiode(state)) return false;
    if (Rs.isLocked(x, y, z, state)) return false;          // the repeater's early return
    var powered = boolProp(state, 'powered');
    var want = Rs.diodeShouldTurnOn(x, y, z, state);
    var prio;
    if (S.block[state] === blkComparator) {
      // the comparator also reschedules when only its NUMBER moved, which is how a container
      // filling one item at a time walks a comparator up without ever toggling `powered`.
      var value = Rs.comparatorValue(x, y, z, state);
      if (value === Rs.comparatorOutput(x, y, z) && powered === want) return false;
      prio = Rs.shouldPrioritize(x, y, z, state) ? Rs.PRIO_HIGH : Rs.PRIO_NORMAL;
      return B.schedule(x, y, z, Rs.COMPARATOR_DELAY, prio);
    }
    if (powered === want) return false;
    prio = Rs.shouldPrioritize(x, y, z, state) ? Rs.PRIO_EXTREMELY_HIGH
         : (powered ? Rs.PRIO_VERY_HIGH : Rs.PRIO_HIGH);
    return B.schedule(x, y, z, Rs.repeaterDelay(state), prio);
  };

  /**
   * The scheduled tick. `DiodeBlock.tick` for a repeater, `ComparatorBlock.refreshOutputState`
   * for a comparator.
   *
   * ⚠ THE REPEATER'S "TURN ON AND RE-SCHEDULE" BRANCH IS WHAT MAKES A PULSE SHORTER THAN THE
   * DELAY COME OUT AS A FULL-LENGTH PULSE: turning on, it checks whether the input is STILL
   * there, and if it is not it schedules its own turn-off `delay` ticks later rather than
   * dropping immediately. Leaving that out gives a repeater that swallows short pulses.
   */
  Rs.diodeTick = function (x, y, z) {
    var state = w.get(x, y, z);
    if (state === 0 || !Rs.isDiode(state)) return false;

    if (S.block[state] === blkComparator) {
      var value = Rs.comparatorValue(x, y, z, state);
      var had = Rs.comparatorOutput(x, y, z);
      Rs.setComparatorOutput(x, y, z, value);
      if (had === value && B.propName(state, 'mode') !== 'compare') return false;
      var want = Rs.diodeShouldTurnOn(x, y, z, state);
      var powered = boolProp(state, 'powered');
      if (powered !== want) w.set(x, y, z, B.setProp(state, 'powered', want));
      Rs.updateInFront(x, y, z, state);
      return true;
    }

    if (Rs.isLocked(x, y, z, state)) return false;
    var pw = boolProp(state, 'powered');
    var on = Rs.diodeShouldTurnOn(x, y, z, state);
    if (pw && !on) {
      w.set(x, y, z, B.setProp(state, 'powered', false));
      Rs.updateInFront(x, y, z, state);
      return true;
    }
    if (!pw) {
      w.set(x, y, z, B.setProp(state, 'powered', true));
      if (!on) B.schedule(x, y, z, Rs.repeaterDelay(state), Rs.PRIO_VERY_HIGH);
      Rs.updateInFront(x, y, z, state);
      return true;
    }
    return false;
  };

  /**
   * `DiodeBlock.updateNeighborsInFront` — the diode does not tell its NEIGHBOURS it changed, it
   * tells the ONE cell in front of it, and then that cell's own neighbours. Here that is a
   * `Rs.update` at the front cell, which is this module's single "something changed" door.
   */
  Rs.updateInFront = function (x, y, z, state) {
    var f = facingDir(state);
    if (f < 0) return;
    var d = OPP[f];
    Rs.update(x + DX[d], y + DY[d], z + DZ[d]);
  };

  /** Settle every diode near (x,y,z), the way `updateTorches` settles torches. */
  Rs.updateDiodes = function (x, y, z, range) {
    if (!Rs.ready) return 0;
    var r = range === undefined ? 2 : range, n = 0;
    for (var dx = -r; dx <= r; dx++) {
      for (var dy = -r; dy <= r; dy++) {
        for (var dz = -r; dz <= r; dz++) {
          if (Rs.diodeCheck(x + dx, y + dy, z + dz)) n++;
        }
      }
    }
    return n;
  };

  /**
   * `LEVEL.setBlock` on a repeater also has to LOCK it: `RepeaterBlock.updateShape` recomputes
   * `LOCKED` whenever a neighbour on the other axis changes. The property is cosmetic — every
   * rule above asks `Rs.isLocked` rather than reading it — but a locked repeater draws its bar
   * down, so a state that disagrees with the rule is a visible lie.
   */
  Rs.refreshLocked = function (x, y, z) {
    var st = w.get(x, y, z);
    if (st === 0 || S.block[st] !== blkRepeater) return false;
    var want = Rs.isLocked(x, y, z, st);
    if (boolProp(st, 'locked') === want) return false;
    w.set(x, y, z, B.setProp(st, 'locked', want));
    return true;
  };

  // ══ G15d: THE OBSERVER ═════════════════════════════════════════════════════════════════
  //
  // ⚠ AN OBSERVER IS NOT A SENSOR, IT IS A ONE-SHOT. `ObserverBlock.updateShape` fires only when
  // the block it FACES changes state, only when the observer is not already powered, and what it
  // does is SCHEDULE — two ticks later it goes high, and two ticks after that it goes low. So
  // its output is a fixed two-tick pulse no matter how long the thing it watched stayed changed,
  // and a "while the neighbour differs" implementation is a different block.
  //
  // ⚠ AND IT DOES NOT CONDUCT. `observer` is on `NEVER_CONDUCTS` for the same reason
  // `redstone_block` is: it is a source, and a source that also carried power through itself
  // would feed its own output back into its input.

  Rs.OBSERVER_DELAY = 2;                   // `startSignal`'s own `iconst_2`, twice over

  Rs.isObserver = function (st) { return st !== 0 && Rs.ready && S.block[st] === blkObserver; };

  /**
   * `ObserverBlock.updateShape`'s guard, as a question: does the observer at (ox,oy,oz) WATCH
   * the cell (x,y,z)? Its `facing` is the eye, so the watched cell is one step along it.
   */
  Rs.observerWatches = function (ox, oy, oz, x, y, z) {
    var st = w.get(ox, oy, oz);
    if (!Rs.isObserver(st)) return false;
    var f = facingDir(st);
    if (f < 0) return false;
    return ox + DX[f] === x && oy + DY[f] === y && oz + DZ[f] === z;
  };

  /**
   * `ObserverBlock.startSignal` — the neighbour it is looking at changed. ⚠ THE `!powered` GUARD
   * IS THE WHOLE BLOCK: without it a stream of changes re-arms the pulse every tick and the
   * observer never drops, which turns a one-shot into a level detector.
   */
  Rs.observerNoticed = function (x, y, z) {
    var st = w.get(x, y, z);
    if (!Rs.isObserver(st)) return false;
    if (boolProp(st, 'powered')) return false;
    return B.schedule(x, y, z, Rs.OBSERVER_DELAY);
  };

  /** `ObserverBlock.tick` — flip, and if it just turned ON, book the turn-off. */
  Rs.observerTick = function (x, y, z) {
    var st = w.get(x, y, z);
    if (!Rs.isObserver(st)) return false;
    var on = boolProp(st, 'powered');
    w.set(x, y, z, B.setProp(st, 'powered', !on));
    if (!on) B.schedule(x, y, z, Rs.OBSERVER_DELAY);
    // `updateNeighborsInFront`: the cell BEHIND the eye is the one that hears about it
    var f = facingDir(st);
    if (f >= 0) Rs.update(x - DX[f], y - DY[f], z - DZ[f]);
    return true;
  };

  /**
   * Called from `Behave.changed` for every cell that changes: wake any observer looking at it.
   * ⚠ IT IS THE SIX NEIGHBOURS OF THE CHANGED CELL, NOT A BOX. An observer two away cannot see
   * anything, and sweeping a radius would make one fire on a change it never watched.
   */
  Rs.notifyObservers = function (x, y, z) {
    if (!Rs.ready) return 0;
    var n = 0;
    for (var d = 0; d < 6; d++) {
      var ox = x + DX[d], oy = y + DY[d], oz = z + DZ[d];
      if (Rs.observerWatches(ox, oy, oz, x, y, z) && Rs.observerNoticed(ox, oy, oz)) n++;
    }
    return n;
  };

  // ── analog output (the comparator's other input) ───────────────────────────────────────────
  /**
   * ⚠ THE SIXTY-ONE BLOCKS A COMPARATOR CAN READ A NUMBER OUT OF, and the FORMULA for each
   * (D-295). The set comes out of `tools/golden/analog-output-1.18.2.tsv`, which
   * `tools/extract-analog.mjs` derives from every `hasAnalogOutputSignal` override in the jar;
   * the shapes below are that table's third column. `redcheck` reads the same TSV and asserts
   * that every row here is either implemented or on the OWED list, so a block cannot quietly
   * read 0 for ever — which is exactly the failure D-290 named.
   *
   * ⚠ THE OWED ROWS ARE NOT A SHRUG. Five shapes need something this engine has not built:
   * a command block's success count, a jukebox's record, a lectern's page, a sculk sensor's
   * vibration and a detector rail's minecart are all ENTITY or ITEM state from stages that
   * have not happened. They are listed by name so the gap is countable.
   */
  var ANALOG = null, analogKind = null, analogArg = null;
  Rs.ANALOG_CONTAINER = 1; Rs.ANALOG_LEVEL = 2; Rs.ANALOG_CONST = 3;
  Rs.ANALOG_CAKE = 4; Rs.ANALOG_ANCHOR = 5; Rs.ANALOG_BOOL = 6; Rs.ANALOG_OWED = 7; Rs.ANALOG_CART = 8; Rs.ANALOG_SCULK = 9; Rs.ANALOG_CMD = 10; Rs.ANALOG_RECORD = 11; Rs.ANALOG_LECTERN = 12;
  Rs.ANALOG_SHAPES = [
    // [block(s), kind, argument]
    [['chest', 'trapped_chest', 'barrel', 'hopper', 'dispenser', 'dropper',
      'furnace', 'blast_furnace', 'smoker', 'brewing_stand', 'shulker_box'], 'container', null],
    [['composter', 'water_cauldron', 'powder_snow_cauldron'], 'level', 'level'],
    [['beehive', 'bee_nest'], 'level', 'honey_level'],
    [['cauldron'], 'const', 0],
    [['lava_cauldron'], 'const', 3],
    [['cake'], 'cake', 'bites'],
    [['respawn_anchor'], 'anchor', 'charges'],
    [['end_portal_frame'], 'bool', 'eye'],
    // ⚠ OWED — named, not forgotten:
    [['command_block', 'chain_command_block', 'repeating_command_block'], 'cmd', null],   // #8303 CommandBlock.getComparatorOutput
    [['jukebox'], 'record', null],                                                        // JukeboxBlock.getComparatorOutput
    [['lectern'], 'lectern', null],   // #8064 LecternBlockEntity.getComparatorOutput
    [['sculk_sensor'], 'sculk', null],
    [['detector_rail'], 'cart', null]
  ];
  /** the sixteen dyed shulker boxes and the seventeen candle cakes, without typing 33 names. */
  Rs.DYES = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
             'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];

  function buildAnalogTable() {
    ANALOG = new Uint8Array(R.blockCount);
    analogKind = new Uint8Array(R.blockCount);
    analogArg = new Array(R.blockCount);
    var KIND = { container: Rs.ANALOG_CONTAINER, level: Rs.ANALOG_LEVEL, 'const': Rs.ANALOG_CONST,
                 cake: Rs.ANALOG_CAKE, anchor: Rs.ANALOG_ANCHOR, bool: Rs.ANALOG_BOOL,
                 owed: Rs.ANALOG_OWED, cart: Rs.ANALOG_CART, sculk: Rs.ANALOG_SCULK, cmd: Rs.ANALOG_CMD, record: Rs.ANALOG_RECORD, lectern: Rs.ANALOG_LECTERN };
    var mark = function (name, kind, arg) {
      var b = R.id[name];
      if (b === undefined) return;
      ANALOG[b] = 1; analogKind[b] = KIND[kind]; analogArg[b] = arg;
    };
    for (var i = 0; i < Rs.ANALOG_SHAPES.length; i++) {
      var row = Rs.ANALOG_SHAPES[i];
      for (var j = 0; j < row[0].length; j++) {
        mark(row[0][j], row[1], row[2]);
        if (row[0][j] === 'shulker_box') {
          for (var d = 0; d < Rs.DYES.length; d++) mark(Rs.DYES[d] + '_shulker_box', row[1], row[2]);
        }
      }
    }
    // the candle cakes: `CandleCakeBlock.getAnalogOutputSignal` is `CakeBlock.FULL_CAKE_SIGNAL`,
    // the static `(7 - 0) * 2`, so all seventeen are a constant 14 regardless of the candle.
    mark('candle_cake', 'const', 14);
    for (var k = 0; k < Rs.DYES.length; k++) mark(Rs.DYES[k] + '_candle_cake', 'const', 14);
  }

  Rs.hasAnalogOutput = function (state) {
    return Rs.ready && state !== 0 && ANALOG[S.block[state]] === 1;
  };
  Rs.analogKindOf = function (state) {
    return (Rs.ready && state !== 0) ? analogKind[S.block[state]] : 0;
  };

  /**
   * `AbstractContainerMenu.getRedstoneSignalFromContainer`, verbatim:
   *
   *     int i = 0; float f = 0;
   *     for each slot: if (!stack.isEmpty()) { f += count / min(container.getMaxStackSize(), stack.getMaxStackSize()); i++; }
   *     f /= size;
   *     return floor(f * 14) + (i > 0 ? 1 : 0);
   *
   * ⚠ THE `+1` IS WHAT MAKES ONE ITEM IN A DOUBLE CHEST READ 1 AND NOT 0, and the division by
   * the SLOT COUNT rather than by the item total is why a stack of 64 in a 27-slot chest reads
   * 1 as well. Both are the parts a from-memory version gets wrong.
   */
  Rs.containerSignal = function (e) {
    if (!e || !e.items) return 0;
    var size = e.items.length;
    if (size === 0) return 0;
    var IT = NS.Items, n = 0, f = 0;
    for (var i = 0; i < size; i++) {
      var st = e.items[i];
      if (!st || !st.n) continue;
      var cap = (IT && IT.maxStack) ? IT.maxStack(st.i) : 64;   // `Inv.stack`'s item id is `i`
      if (!cap || cap < 1) cap = 64;
      var lim = cap < 64 ? cap : 64;        // `min(container.getMaxStackSize(), stack.getMaxStackSize())`
      f += st.n / lim;
      n++;
    }
    f /= size;
    return Math.floor(f * 14) + (n > 0 ? 1 : 0);
  };

  /** `BlockState.getAnalogOutputSignal(level, pos)` for the shapes this engine can answer. */
  Rs.analogOutput = function (x, y, z, state) {
    if (!Rs.hasAnalogOutput(state)) return 0;
    var b = S.block[state], kind = analogKind[b], arg = analogArg[b];
    if (kind === Rs.ANALOG_CONST) return arg | 0;
    if (kind === Rs.ANALOG_LEVEL) return B.propName(state, arg) | 0;
    if (kind === Rs.ANALOG_BOOL) return boolProp(state, arg) ? Rs.MAX : 0;
    if (kind === Rs.ANALOG_CAKE) return (7 - (B.propName(state, arg) | 0)) * 2;
    if (kind === Rs.ANALOG_ANCHOR) return Math.floor((B.propName(state, arg) | 0) / 4 * 15);
    if (kind === Rs.ANALOG_CONTAINER) return BE ? Rs.containerSignal(BE.get(x, y, z)) : 0;
    if (kind === Rs.ANALOG_CART) return (NS.Minecart && NS.Minecart.detectorComparator) ? NS.Minecart.detectorComparator(x, y, z) : 0;
    if (kind === Rs.ANALOG_SCULK) return NS.Sculk ? NS.Sculk.comparator(x, y, z, state) : 0;
    if (kind === Rs.ANALOG_RECORD) return BE ? BE.jukeboxSignal(x, y, z) : 0;
    if (kind === Rs.ANALOG_CMD) return NS.CmdBlock ? NS.CmdBlock.comparator(x, y, z) : 0;
    if (kind === Rs.ANALOG_LECTERN) return NS.Use && NS.Use.lecternComparator ? NS.Use.lecternComparator(x, y, z) : 0;
    return 0;                                // OWED — and `redcheck` asserts the list is closed
  };

  /** Exposed for the check: the suppression flag really is observable. */
  Rs.__shouldSignal = function () { return shouldSignal; };
})(MCL);
