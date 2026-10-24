// 07b_behaviour.js — PLAN G2: what a block DOES. Placement, neighbours, ticks.
// Runs on: MAIN THREAD ONLY. No DOM.
//
// ── THE FIVE LAYERS, IN PLAN's ORDER, AND WHERE EACH ONE LIVES ───────────────────────────
//   1. placement        `Behave.place`   — the state a block takes from the placing context
//   2. neighbour update `Behave.updateShape` / `Behave.changed` — connections and survival
//   3. random ticks     `Behave.randomTick` — crops, grass, leaves, ice, cane, farmland
//   4. scheduled ticks  `Behave.schedule` / `Behave.tick` — water and lava
//   5. block entities   src/07c_blockentity.js, driven from `Behave.changed`
//
// ⚠ **REDSTONE IS NOT HERE, BY PLAN.** Wire power, repeaters, comparators, pistons and observers
// are PLAN G15, deliberately placed after the survival loop is stable. What G2 owes G15 is the
// SCHEDULER, and that is layer 4: `Behave.schedule(x, y, z, delay, priority)` is vanilla's
// `LevelTicks`, ordered by (tick, priority, insertion), and it is what a repeater will hang off.
//
// ── THE WORLD ADAPTER, AND WHY ───────────────────────────────────────────────────────────
// Every rule below reads and writes the world through `B.world` — an object with `getBlock`,
// `setBlock` and optionally `getLight`. In the game that is `NS.World`. In `behavcheck` it is a
// 32x32x32 array, because a check that has to stream real chunks to grow one wheat plant is a
// check nobody runs. The adapter is four methods wide on purpose: anything wider would let a
// rule reach for chunk internals and stop being testable.
//
// ── SHAPES ARE REAL HERE ─────────────────────────────────────────────────────────────────
// Vanilla asks `isFaceSturdy` and `Shapes.joinIsNotEmpty` — questions about the block's actual
// collision voxels — and MC-Lite HAS those voxels: 4,105 shapes, quantised to 1/1024 of a block
// by `pack-runtime.mjs`. So `faceSturdy` below is a real coverage test over the boxes touching
// that face and not a proxy for "is it opaque", which would have made a bottom slab connect a
// fence on its top half (D-205).
(function (NS) {
  'use strict';

  var B = NS.Behave = {};

  // vanilla Direction order: 0 DOWN 1 UP 2 NORTH 3 SOUTH 4 WEST 5 EAST — the same order the
  // registry uses for occlusion and for the model stream, so no translation table is needed.
  var DX = [0, 0, 0, 0, -1, 1], DY = [-1, 1, 0, 0, 0, 0], DZ = [0, 0, -1, 1, 0, 0];
  var OPP = [1, 0, 3, 2, 5, 4];
  var HORIZ = [2, 3, 4, 5];                       // north south west east
  B.DX = DX; B.DY = DY; B.DZ = DZ; B.OPP = OPP; B.HORIZ = HORIZ;

  var P = null, V = null;                          // property / value id shorthands
  var R = null, S = null;
  var propOfDir = null;                            // direction -> the boolean property id
  var faceSturdyCache = null;                      // state*8 + dir -> 0 unknown, 1 yes, 2 no

  B.ready = false;
  B.world = null;

  // ── families ───────────────────────────────────────────────────────────────────────────
  // ⚠ A FAMILY IS A JAVA CLASS, AND A JAVA CLASS IS NOT IN ANY DATA FILE. What IS in the data
  // is a tag that names the same set — `fences`, `walls`, `fence_gates`, `wooden_fences`,
  // `stairs`, `slabs`, `doors`, `beds`, `crops`, `saplings`, `leaves`, `logs`, `ice`, `dirt`,
  // `flower_pots` — so every family below is a TAG lookup with the two exceptions that vanilla
  // has no tag for, and both are named lists rather than a suffix guess:
  //   panes   `IronBarsBlock` covers `iron_bars` and the 17 glass panes; the panes all end in
  //           `_pane`, and `iron_bars` is spelled out.
  //   fluids  `water` and `lava` and nothing else in 1.18.2.
  var FAM = {};
  var isPane = null, isFluid = null;

  /** Tag column ids, resolved once so no rule does a string lookup in a loop. */
  var col = {};
  function column(name) { return NS.Tags && NS.Tags.ready ? NS.Tags.blockTag(name) : -1; }

  B.init = function (world) {
    R = NS.Reg; S = NS.States;
    if (!R || !R.ready || !S || !S.ready) { B.ready = false; return B; }
    P = R.PROP; V = R.PVAL;
    B.world = world || NS.World || null;
    propOfDir = [null, P.up, P.north, P.south, P.west, P.east];
    // `down` is a real property on exactly one family (the multiface blocks), and the wall's
    // `up` is the only vertical one the connection code touches; index 0 stays null so a
    // horizontal loop over HORIZ can share the table with the vertical one.
    propOfDir[0] = P.down === undefined ? null : P.down;
    faceSturdyCache = new Uint8Array(S.count * 8);

    col.fences = column('fences');
    col.woodenFences = column('wooden_fences');
    col.fenceGates = column('fence_gates');
    col.walls = column('walls');
    col.stairs = column('stairs');
    col.slabs = column('slabs');
    col.doors = column('doors');
    col.beds = column('beds');
    col.crops = column('crops');
    col.saplings = column('saplings');
    col.leaves = column('leaves');
    col.logs = column('logs');
    col.ice = column('ice');
    col.dirt = column('dirt');
    col.wallPostOverride = column('wall_post_override');
    col.replaceable = column('replaceable_plants');

    FAM.grassSpread = ids(['grass_block', 'mycelium', 'podzol']);
    FAM.chests = ids(['chest', 'trapped_chest']);
    FAM.exceptionForConnection = ids(['barrier', 'carved_pumpkin', 'jack_o_lantern', 'melon',
      'pumpkin', 'shulker_box', 'black_shulker_box', 'blue_shulker_box', 'brown_shulker_box',
      'cyan_shulker_box', 'gray_shulker_box', 'green_shulker_box', 'light_blue_shulker_box',
      'light_gray_shulker_box', 'lime_shulker_box', 'magenta_shulker_box', 'orange_shulker_box',
      'pink_shulker_box', 'purple_shulker_box', 'red_shulker_box', 'white_shulker_box',
      'yellow_shulker_box']);
    isPane = Object.create(null);
    for (var i = 0; i < R.blockCount; i++) {
      var n = R.names[i];
      if (n === 'iron_bars' || (n.length > 5 && n.lastIndexOf('_pane') === n.length - 5)) isPane[i] = true;
    }
    isFluid = ids(['water', 'lava']);
    B.WATER = R.id.water; B.LAVA = R.id.lava; B.FIRE = R.id.fire;
    B.AIR = 0;
    B.ready = true;
    return B;
  };

  function ids(names) {
    var o = Object.create(null);
    for (var i = 0; i < names.length; i++) { var b = NS.Reg.id[names[i]]; if (b !== undefined) o[b] = true; }
    return o;
  }

  var w = {
    get: function (x, y, z) { return B.world ? (B.world.getBlock(x, y, z) | 0) : 0; },
    set: function (x, y, z, id) { return B.world ? B.world.setBlock(x, y, z, id) : false; },
    // ⚠ THREE LIGHTS, because vanilla's random-tick rules ask three different questions (meltrefcheck/gaterefcheck):
    //   light      = BLOCK light only        (`getLightLevel(LightType.BLOCK, pos)` — ice, snow layers)
    //   baseLight  = max(sky, block), sky UNDIMMED  (`getBaseLightLevel(pos, 0)` — CropBlock: a crop grows at midnight)
    //   lightLevel = max(block, sky - ambientDarkness) (`getLightLevel(pos)` — SaplingBlock, SpreadableBlock)
    // The World packs `getLight` as sky<<4 | block (07_world.js); a mock may add `blockLightAt`. This used to ask
    // ONLY `blockLightAt`, which World does not have, so in the game every light gate read 15 (always lit).
    light: function (x, y, z) {
      var W = B.world;
      if (W && W.blockLightAt) return W.blockLightAt(x, y, z);
      if (W && W.getLight) return W.getLight(x, y, z) & 15;
      return 15;                                   // no light engine bound: treat as lit (see below)
    },
    baseLight: function (x, y, z) {
      var W = B.world;
      if (!W || !W.getLight) return w.light(x, y, z);
      var sky = (W.getLight(x, y, z) >> 4) & 15, blk = w.light(x, y, z);
      return sky > blk ? sky : blk;
    },
    lightLevel: function (x, y, z) {
      var W = B.world;
      if (!W || !W.getLight) return w.light(x, y, z);
      var Sky = NS.Sky, dark = (Sky && Sky.darknessNow) ? Sky.darknessNow() : 0;
      var sky = ((W.getLight(x, y, z) >> 4) & 15) - dark, blk = w.light(x, y, z);
      return sky > blk ? sky : blk;
    },
  };
  B.w = w;

  // ── shapes ─────────────────────────────────────────────────────────────────────────────
  var QU = 1024;                                   // pack-runtime's quantum: 1/1024 of a block

  /**
   * `isFaceSturdy(dir)` — does this state present a FULL 16x16 face on `dir`? Vanilla's own
   * definition is "the union of the collision boxes touching that plane covers the whole face",
   * and that is what this computes: coordinate-compress the touching boxes' rectangles and test
   * that every cell of the compressed grid is covered. Exact, and cached per (state, dir)
   * because a fence asks it of the same four neighbours every update.
   */
  B.faceSturdy = function (state, dir) {
    var k = state * 8 + dir, c = faceSturdyCache[k];
    if (c) return c === 1;
    var sh = R.shapeOf[state], o0 = R.shapeOff[sh], o1 = R.shapeOff[sh + 1];
    var ax = dir < 2 ? 1 : (dir < 4 ? 2 : 0);      // the axis the face is perpendicular to
    var plane = (dir & 1) ? QU : 0;                // up/south/east are the +1 faces
    var u = ax === 0 ? 1 : 0, v2 = ax === 2 ? 1 : 2;
    var rects = [], i;
    for (i = o0; i < o1; i++) {
      var b0 = R.shapeBox[i * 6 + ax], b1 = R.shapeBox[i * 6 + 3 + ax];
      if ((dir & 1) ? b1 < plane : b0 > plane) continue;
      if ((dir & 1) ? b1 !== plane : b0 !== plane) continue;
      rects.push([R.shapeBox[i * 6 + u], R.shapeBox[i * 6 + v2], R.shapeBox[i * 6 + 3 + u], R.shapeBox[i * 6 + 3 + v2]]);
    }
    var ok = coversUnitSquare(rects);
    faceSturdyCache[k] = ok ? 1 : 2;
    return ok;
  };

  function coversUnitSquare(rects) { return coversRect(rects, 0, 0, QU, QU); }
  /**
   * Do these rectangles, unioned, cover the query rectangle? Coordinate-compress both, then test
   * the centre of every cell of the compressed grid that lies inside the query. Exact for any
   * number of overlapping boxes, which a "does one box contain it" test is not — a wall's face is
   * three boxes and a stair's is two.
   */
  function coversRect(rects, qx0, qz0, qx1, qz1) {
    if (!rects.length) return false;
    var xs = [qx0, qx1], zs = [qz0, qz1], i, j;
    for (i = 0; i < rects.length; i++) {
      if (rects[i][0] > qx0 && rects[i][0] < qx1) xs.push(rects[i][0]);
      if (rects[i][2] > qx0 && rects[i][2] < qx1) xs.push(rects[i][2]);
      if (rects[i][1] > qz0 && rects[i][1] < qz1) zs.push(rects[i][1]);
      if (rects[i][3] > qz0 && rects[i][3] < qz1) zs.push(rects[i][3]);
    }
    xs = uniqSorted(xs); zs = uniqSorted(zs);
    for (i = 0; i < xs.length - 1; i++) {
      for (j = 0; j < zs.length - 1; j++) {
        var cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2;
        var hit = false;
        for (var r = 0; r < rects.length; r++) {
          var q = rects[r];
          if (cx > q[0] && cx < q[2] && cz > q[1] && cz < q[3]) { hit = true; break; }
        }
        if (!hit) return false;
      }
    }
    return true;
  }

  /**
   * ⚠ THE WALL TEST IS AGAINST THE **DOWN FACE** OF THE BLOCK ABOVE, NOT ITS VOLUME (D-206).
   * Vanilla is `blockstate.getCollisionShape(level, above).getFaceShape(Direction.DOWN)`, and a
   * face shape is the 2D slice at that plane. A bottom slab's VOLUME contains no full-height
   * column, so a volume test says `low`; its DOWN FACE is a full 16x16 square, so vanilla says
   * `tall`. Every wall under a slab in every village in the game is the difference.
   */
  B.downFaceCovers = function (state, x0, z0, x1, z1) {
    if (state === 0) return false;
    var sh = R.shapeOf[state], o0 = R.shapeOff[sh], o1 = R.shapeOff[sh + 1], rects = [];
    for (var i = o0; i < o1; i++) {
      if (R.shapeBox[i * 6 + 1] !== 0) continue;                  // does not touch the down plane
      rects.push([R.shapeBox[i * 6], R.shapeBox[i * 6 + 2], R.shapeBox[i * 6 + 3], R.shapeBox[i * 6 + 5]]);
    }
    return coversRect(rects, x0, z0, x1, z1);
  };
  function uniqSorted(a) {
    a.sort(function (p, q) { return p - q; });
    var out = [a[0]];
    for (var i = 1; i < a.length; i++) if (a[i] !== a[i - 1]) out.push(a[i]);
    return out;
  }

  // ── tag helpers ────────────────────────────────────────────────────────────────────────
  function inCol(c, state) { return c >= 0 && NS.Tags.blockInCol(c, S.block[state]); }
  B.inTag = function (name, state) { return NS.Tags.stateIn(name, state); };
  function prop(state, pid) { return pid === undefined ? -1 : S.propValue(state, pid); }
  function withV(state, pid, vid) { return (pid === undefined || vid === undefined) ? state : S.withProp(state, pid, vid); }
  B.prop = prop;
  B.withV = withV;
  /** The property's value as a STRING, which is how the loot tables and the checks name them. */
  B.propName = function (state, name) {
    var v = prop(state, P[name]);
    return v < 0 ? undefined : R.valueNames[v];
  };
  /** Set a property by name and value name; returns the state unchanged if either is unknown. */
  B.setProp = function (state, name, value) { return withV(state, P[name], V[String(value)]); };

  // ── LAYER 2: connections ───────────────────────────────────────────────────────────────
  function isExceptionForConnection(state) {
    return FAM.exceptionForConnection[S.block[state]] === true || inCol(col.leaves, state);
  }

  /** `FenceBlock.connectsTo` — the same fence family, a fence gate facing across, or a sturdy face. */
  function fenceConnects(self, other, dir) {
    if (other === 0) return false;
    if (inCol(col.fences, other) &&
        inCol(col.woodenFences, other) === inCol(col.woodenFences, self)) return true;
    if (inCol(col.fenceGates, other) && gateFacesAcross(other, dir)) return true;
    return !isExceptionForConnection(other) && B.faceSturdy(other, OPP[dir]);
  }

  /**
   * `FenceGateBlock.connectsToDirection` — vanilla is
   * `state.getValue(FACING).getClockWise().getAxis() == dir.getAxis()`, and the clockwise turn is
   * what makes it the axis ACROSS the gate: a gate facing north is walked through along z and
   * joins the fence line running east-west. Writing it the other way round leaves every gate in
   * the game floating between two disconnected fence posts.
   */
  function gateFacesAcross(gate, dir) {
    var f = prop(gate, P.facing);
    var gateAxisZ = (f === V.north || f === V.south);
    var dirAxisZ = (dir === 2 || dir === 3);
    return gateAxisZ !== dirAxisZ;
  }

  /** `IronBarsBlock.attachsTo` — bars and panes also attach to each other and to walls. */
  function paneAttaches(other, dir) {
    if (other === 0) return false;
    if (isPane[S.block[other]]) return true;
    if (inCol(col.walls, other)) return true;
    return !isExceptionForConnection(other) && B.faceSturdy(other, OPP[dir]);
  }

  /** `WallBlock.connectsTo`. */
  function wallConnects(other, dir) {
    if (other === 0) return false;
    if (inCol(col.walls, other)) return true;
    if (isPane[S.block[other]]) return true;
    if (inCol(col.fenceGates, other) && gateFacesAcross(other, dir)) return true;
    return !isExceptionForConnection(other) && B.faceSturdy(other, OPP[dir]);
  }

  // ⚠ A NAMED GAP (D-206). The five rectangles below are `private static final VoxelShape`
  // constants in `WallBlock.java` — `TEST_SHAPE_POST` and one per direction — and they are in no
  // data file, not in the jar's data and not in the pc dataset. They are stated here as a
  // hand-sourced table rather than derived from anything, and `behavcheck` §4 asserts the
  // OBSERVABLE consequences (full block above -> tall, air above -> low, bottom slab above ->
  // tall, a straight line -> no post) rather than the numbers themselves.
  // Written as (x0, z0, x1, z1) in sixteenths, because the test is 2D: see `downFaceCovers`.
  var WALL_TEST = {
    post: [7, 7, 9, 9],
    2: [7, 0, 9, 9], 3: [7, 7, 9, 16],
    4: [0, 7, 9, 9], 5: [7, 7, 16, 9],
  };
  function covers(above, t) { return B.downFaceCovers(above, t[0] * 64, t[1] * 64, t[2] * 64, t[3] * 64); }

  function wallSide(connected, above, dir) {
    if (!connected) return V.none;
    return covers(above, WALL_TEST[dir]) ? V.tall : V.low;
  }

  /**
   * `BlockBehaviour.updateShape` — the state this block takes given its six neighbours. This is
   * the ONE function that both placement and neighbour updates call, which is why a fence placed
   * next to a wall connects immediately and why breaking the wall disconnects it: vanilla has
   * exactly one such function too, and a clone that computes connections only at placement time
   * is the clone whose fences stay attached to nothing.
   * `from` (optional) is the direction from this block TO the neighbour that changed — vanilla's
   * `getStateForNeighborUpdate(state, dir, ...)`. Only redstone wire's rule depends on it (#339).
   */
  // `BlockTags.SNOW` (SnowyBlock.isSnow): layer, block and powder snow all make grass/mycelium/podzol snowy
  var SNOWY_TAG = { snow: 1, snow_block: 1, powder_snow: 1 };
  B.updateShape = function (state, x, y, z, from) {
    if (!B.ready || state === 0) return state;
    var i, d, n, out = state;
    var Rw = NS.Redstone;
    var cpH = B.concrete(state); if (cpH === state) cpH = 0;
    if (cpH) return powderWetSide(x, y, z) ? cpH : state;
    if (Rw && Rw.ready && Rw.isWire(state)) return Rw.wireNeighbourShape(state, x, y, z, from);
    // `FireBlock.getStateForNeighborUpdate`: canPlaceAt ? getStateWithAge(age) : air.
    if (S.block[state] === B.FIRE) {
      if (!B.fireCanSurvive(x, y, z)) return 0;
      var fa = prop(state, P.age);
      return fireStateAt(x, y, z, fa < 0 ? 0 : +R.valueNames[fa]);
    }
    var fence = inCol(col.fences, state), wall = inCol(col.walls, state), pane = isPane[S.block[state]];
    if (fence || pane) {
      for (i = 0; i < 4; i++) {
        d = HORIZ[i];
        n = w.get(x + DX[d], y + DY[d], z + DZ[d]);
        var on = fence ? fenceConnects(state, n, d) : paneAttaches(n, d);
        out = withV(out, propOfDir[d], on ? V['true'] : V['false']);
      }
      return out;
    }
    if (wall) {
      var above = w.get(x, y + 1, z);
      var sides = [0, 0, 0, 0], anyNone = 0;
      for (i = 0; i < 4; i++) {
        d = HORIZ[i];
        n = w.get(x + DX[d], y + DY[d], z + DZ[d]);
        sides[i] = wallSide(wallConnects(n, d), above, d);
        out = withV(out, propOfDir[d], sides[i]);
      }
      // `shouldRaisePost`: a wall above with a post, or any side arrangement that is not a
      // straight through-line, or an override block above, or an above shape that fills the post.
      var upv;
      var nNone = sides[0] === V.none, sNone = sides[1] === V.none;
      var wNone = sides[2] === V.none, eNone = sides[3] === V.none;
      if (inCol(col.walls, above) && prop(above, P.up) === V['true']) upv = true;
      else if ((nNone && sNone && wNone && eNone) || (nNone !== sNone) || (wNone !== eNone)) upv = true;
      else if (inCol(col.wallPostOverride, above)) upv = true;
      else upv = covers(above, WALL_TEST.post);
      return withV(out, P.up, upv ? V['true'] : V['false']);
    }
    // `BambooBlock.getStateForNeighborUpdate`: a thicker (higher-age) stalk above cycles this one's age, so a column
    // thickens top-down; `BambooSaplingBlock`'s: bamboo above turns the sapling into default bamboo (survival is 02k's).
    if (R.id.bamboo !== undefined && S.block[state] === R.id.bamboo) {
      var ba = w.get(x, y + 1, z);
      return (isBamboo(ba) && numProp(ba, P.age) > numProp(state, P.age)) ? B.setProp(state, 'age', 1) : state;
    }
    if (R.id.bamboo_sapling !== undefined && S.block[state] === R.id.bamboo_sapling) {
      return isBamboo(w.get(x, y + 1, z)) ? R.realFirst[R.id.bamboo] + R.defaultState[R.id.bamboo] : state;
    }
    if (inCol(col.stairs, state)) return withV(out, P.shape, V[stairShape(state, x, y, z)]);
    if (stemOf(S.block[state])) return plantPartShape(state, x, y, z);
    if (FAM.chests[S.block[state]]) return chestShape(state, x, y, z);
    if (FAM.grassSpread[S.block[state]]) {
      var up = w.get(x, y + 1, z);
      return withV(out, P.snowy, (up && SNOWY_TAG[R.names[S.block[up]]]) ? V['true'] : V['false']);
    }
    if (inCol(col.fenceGates, state)) {
      // `in_wall` — a gate between two walls sits lower. Vanilla checks both sides.
      var f = prop(state, P.facing);
      var a = (f === V.north || f === V.south) ? 4 : 2, bd = OPP[a];
      var la = w.get(x + DX[a], y + DY[a], z + DZ[a]), lb = w.get(x + DX[bd], y + DY[bd], z + DZ[bd]);
      var inWall = inCol(col.walls, la) || inCol(col.walls, lb);
      return withV(out, P.in_wall, inWall ? V['true'] : V['false']);
    }
    return out;
  };

  /**
   * `StairBlock.makeStairShape` — straight, or one of the four corner shapes, decided by the
   * stair in front of and behind this one. The rule is vanilla's verbatim: a differently facing
   * stair in FRONT makes an outer corner, one BEHIND makes an inner corner, and either is
   * cancelled when the stair on the other side already lines this one up.
   */
  function stairShape(state, x, y, z) {
    var f = prop(state, P.facing), half = prop(state, P.half);
    var fd = facingToDir(f);
    var front = w.get(x + DX[fd], y + DY[fd], z + DZ[fd]);
    if (isStairSameHalf(front, half)) {
      var ff = prop(front, P.facing);
      if (axisOf(ff) !== axisOf(f)) {
        var side = facingToDir(OPP_FACING(ff));
        if (!isStairFacingHalf(w.get(x + DX[side], y + DY[side], z + DZ[side]), f, half)) {
          return isLeft(ff, f) ? 'outer_left' : 'outer_right';
        }
      }
    }
    var bd = OPP[fd];
    var back = w.get(x + DX[bd], y + DY[bd], z + DZ[bd]);
    if (isStairSameHalf(back, half)) {
      var bf = prop(back, P.facing);
      if (axisOf(bf) !== axisOf(f)) {
        var side2 = facingToDir(bf);
        if (!isStairFacingHalf(w.get(x + DX[side2], y + DY[side2], z + DZ[side2]), f, half)) {
          return isLeft(bf, f) ? 'inner_left' : 'inner_right';
        }
      }
    }
    return 'straight';
  }
  /**
   * D-413 — `ChestBlock.updateShape`, the rule that pairs and unpairs a double chest. Vanilla asks
   * it once per neighbour, in `Direction.UPDATE_SHAPE_ORDER` (west, east, north, south, then the
   * vertical two, which can never match), threading the state through; this is that loop.
   *   · a SINGLE chest beside a chest of the SAME block (a chest never pairs with a trapped chest)
   *     that is already half of a pair, faces the same way and points AT this cell, takes the
   *     opposite half — that is how placing the second chest turns the first into `right`/`left`.
   *   · a half whose partner cell no longer holds that block goes back to SINGLE — that is why
   *     breaking one half leaves an ordinary 27-slot chest and not a chest still claiming a mate.
   * `getConnectedDirection`: a LEFT half links to its facing's clockwise side, any other type to
   * the counter-clockwise side.
   */
  var CHEST_ORDER = [4, 5, 2, 3];
  function chestLinkDir(st) {
    var f = prop(st, P.facing);
    return facingToDir(prop(st, P.type) === V.left ? cwFacing(f) : ccwFacing(f));
  }
  function cwFacing(v) { return v === V.north ? V.east : v === V.east ? V.south : v === V.south ? V.west : V.north; }
  function ccwFacing(v) { return v === V.north ? V.west : v === V.west ? V.south : v === V.south ? V.east : V.north; }
  function chestShape(state, x, y, z) {
    var out = state, me = S.block[state];
    for (var i = 0; i < 4; i++) {
      var d = CHEST_ORDER[i];
      var nb = w.get(x + DX[d], y + DY[d], z + DZ[d]);
      if (nb !== 0 && S.block[nb] === me) {
        var nt = prop(nb, P.type);
        if (prop(out, P.type) === V.single && nt !== V.single &&
            prop(out, P.facing) === prop(nb, P.facing) && chestLinkDir(nb) === OPP[d]) {
          out = withV(out, P.type, nt === V.left ? V.right : V.left);
        }
      } else if (prop(out, P.type) !== V.single && chestLinkDir(out) === d) {
        out = withV(out, P.type, V.single);
      }
    }
    return out;
  }
  function isStairSameHalf(st, half) {
    return st !== 0 && inCol(col.stairs, st) && prop(st, P.half) === half;
  }
  function isStairFacingHalf(st, f, half) {
    return st !== 0 && inCol(col.stairs, st) && prop(st, P.facing) === f && prop(st, P.half) === half;
  }
  function facingToDir(v) { return v === V.north ? 2 : v === V.south ? 3 : v === V.west ? 4 : v === V.east ? 5 : 2; }
  function OPP_FACING(v) { return v === V.north ? V.south : v === V.south ? V.north : v === V.west ? V.east : V.west; }
  function axisOf(v) { return (v === V.north || v === V.south) ? 'z' : 'x'; }
  // "left" is relative to the way THIS stair faces: vanilla compares the counter-clockwise
  // direction of `facing` with the neighbour's facing.
  function isLeft(other, self) {
    var ccw = { }; ccw[V.north] = V.west; ccw[V.west] = V.south; ccw[V.south] = V.east; ccw[V.east] = V.north;
    return other === ccw[self];
  }

  // ── LAYER 1: placement ─────────────────────────────────────────────────────────────────
  /**
   * `getStateForPlacement` — the part D-157's table does not cover. The table already resolved
   * `facing`, `half`, `axis`, `face` and the standing/wall swap from the click; what is left is
   * the pair PLAN §1.3 warns about (`waterlogged` and `powered` are not in the blockstates JSON
   * and come from the real-state list), and then `updateShape` against the six neighbours, which
   * is what makes a fence placed next to a wall arrive already connected.
   */
  // `ConcretePowderBlock`: the concrete of a powder state (0 when not powder), `hardensIn` (fluid state is water:
  // water or a waterlogged cell) and `hardensOnAnySide` (DOWN only counts if the cell itself holds water)
  var POWDER_TO = null;
  function powderHardened(state) {
    if (state === 0) return 0;
    if (!POWDER_TO) {
      POWDER_TO = {};
      for (var b = 0; b < R.blockCount; b++) {
        var nm = R.names[b];
        if (nm && /_concrete_powder$/.test(nm)) POWDER_TO[b] = R.realFirst[R.id[nm.slice(0, -7)]] + R.defaultState[R.id[nm.slice(0, -7)]];
      }
    }
    return POWDER_TO[S.block[state]] || 0;
  }
  B.powderHardened = powderHardened;
  /** the concrete state of a powder state, or the state unchanged for anything else (landing hook, 07i) */
  B.concrete = function (state) { return powderHardened(state) || state; };
  function hardensIn(st) { return st !== 0 && (isWater(st) || S.waterIn[st] === 1); }
  function powderWetSide(x, y, z) {
    for (var d = 0; d < 6; d++) {
      if (d === 0 && !hardensIn(w.get(x, y, z))) continue;
      var nst = w.get(x + DX[d], y + DY[d], z + DZ[d]);
      if (hardensIn(nst) && !S.faceFull(nst, OPP[d])) return true;
    }
    return false;
  }
  B.place = function (state, x, y, z) {
    if (!B.ready || state === 0) return state;
    var out = state;
    // `ConcretePowderBlock.getPlacementState`: shouldHarden = hardensIn(the cell's own state) || hardensOnAnySide
    var cpH = B.concrete(state); if (cpH === state) cpH = 0;
    if (cpH && (hardensIn(w.get(x, y, z)) || powderWetSide(x, y, z))) return cpH;
    if (prop(state, P.waterlogged) >= 0) {
      var here = w.get(x, y, z);
      var inWater = here !== 0 && S.waterIn[here];
      out = withV(out, P.waterlogged, inWater ? V['true'] : V['false']);
    }
    // #339 `RedstoneWireBlock.getPlacementState`: grown from the cross, not reshaped from its own state
    if (NS.Redstone && NS.Redstone.ready && NS.Redstone.isWire(out)) return NS.Redstone.wirePlace(x, y, z, out);
    // `AbstractPlantPartBlock.getPlacementState`: a head placed with no head/body beyond it takes
    // `getRandomGrowthState` (a random age 0..24); one with its column beyond becomes the body (updateShape's swap)
    var ps = stemOf(S.block[out]);
    if (ps && ps.head === S.block[out]) out = randomGrowthState(ps, out, B.rng || Math.random);
    return B.updateShape(out, x, y, z);
  };

  /**
   * `Level.neighborChanged` — run after a block at (x,y,z) changed. Every one of the six
   * neighbours recomputes its shape, and anything that no longer survives is broken. The support
   * cascade in `World.setBlock` already does the survival half (D-155); this adds the shape half,
   * and it is deliberately ONE ring deep, exactly like vanilla, so a fence line does not
   * re-evaluate itself all the way to the horizon on every click.
   */
  var changeDepth = 0;
  B.MAX_UPDATE_DEPTH = 8;
  B.changed = function (x, y, z, old) {
    if (!B.ready) return 0;
    // ⚠ RE-ENTRANT BY CONSTRUCTION, and bounded on purpose. Updating a neighbour is itself a
    // `setBlock`, which calls back in here — vanilla has the same recursion and caps it at 512
    // in `Level.neighborChanged`. Eight is enough for every connection family in the game (a
    // fence tells four neighbours, and each of those changes nothing new) and it stops a rule
    // that oscillates from taking the frame with it.
    if (changeDepth >= B.MAX_UPDATE_DEPTH) return 0;
    changeDepth++;
    try { return changedInner(x, y, z, old); } finally { changeDepth--; }
  };
  B.updateDepth = function () { return changeDepth; };

  /** #5889: DoorBlock.setOpen / TrapdoorBlock / FenceGateBlock emit BLOCK_OPEN / BLOCK_CLOSE; LeverBlock.togglePower and
   *  AbstractButtonBlock.powerOn emit BLOCK_SWITCH|PRESS, their off edges BLOCK_UNSWITCH|UNPRESS. A door's upper half is skipped (one event). */
  function toggleEvent(x, y, z, old) {
    var me = w.get(x, y, z);
    if (me === 0 || old === 0 || S.block[me] !== S.block[old] || me === old) return;
    var nm = R.names[S.block[me]], ev;
    if (/_door$|_trapdoor$|_fence_gate$/.test(nm)) {
      var o = B.propName(old, 'open'), n = B.propName(me, 'open');
      if (o === undefined || o === n) return;
      if (/_door$/.test(nm) && B.propName(me, 'half') === 'upper') return;
      ev = n === 'true' ? 'block_open' : 'block_close';
    } else if (nm === 'lever' || /_button$/.test(nm)) {
      var po = B.propName(old, 'powered'), pn = B.propName(me, 'powered');
      if (po === undefined || po === pn) return;
      var base = nm === 'lever' ? 'switch' : 'press';
      ev = pn === 'true' ? 'block_' + base : 'block_un' + base;
    } else return;
    NS.GameEvent.emit(ev, x, y, z, null);
  }

  var frostQuiet = false;     // FrostedIceBlock.increaseAge is setBlockState(.., 2): listeners only, no neighbour updates
  function changedInner(x, y, z, old) {
    var n = 0;
    if (frostQuiet) return 0;
    // `SoulSandBlock.onBlockAdded`: a fresh soul sand schedules its own 20-tick column update
    if (old !== undefined) { var me = w.get(x, y, z); if (me !== 0 && S.block[me] === R.id.soul_sand && S.block[old] !== S.block[me]) B.schedule(x, y, z, BUBBLE_SAND_DELAY); }
    // #306 (G25) — `onStateReplaced` / `onBlockAdded` of a rail run inside the chunk write, BEFORE
    // the neighbour updates; `old` is the state World.setBlock replaced (undefined from a mock).
    var Rl = NS.Rail && NS.Rail.ready ? NS.Rail : null;
    if (Rl) Rl.changed(x, y, z, old);
    if (old !== undefined && NS.Use && NS.Use.tripwireChanged) NS.Use.tripwireChanged(x, y, z, old);   // #5610
    if (old !== undefined && NS.GameEvent) toggleEvent(x, y, z, old);   // #5889
    if (NS.Lightning && NS.Lightning.rodChanged && old !== undefined) NS.Lightning.rodChanged(x, y, z, old, pending[posKey(x, y, z)] !== undefined);
    // PLAN G15a — a block changing is what redstone reacts to, and it is hooked HERE, at the
    // one function every placement and break already funnels through, so a call site that
    // forgets cannot leave a circuit stale (D-294). The wire's own propagation is iterative
    // and does not use this recursion — see `Redstone.updateWires` for why.
    if (NS.Redstone && NS.Redstone.ready) NS.Redstone.update(x, y, z);
    // PLAN G15d — an observer watching THIS cell has just seen it change (D-299). It is asked
    // here and not inside `Redstone.update`, because the question is "did this exact cell
    // change", which is what this function knows and a settle sweep does not.
    if (NS.Redstone && NS.Redstone.ready) NS.Redstone.notifyObservers(x, y, z);
    for (var d = 0; d < 6; d++) {
      var nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d];
      var st = w.get(nx, ny, nz);
      if (st === 0) continue;
      var upd = B.updateShape(st, nx, ny, nz, OPP[d]);
      if (upd !== st) { w.set(nx, ny, nz, upd); n++; }
      if (isFluid[S.block[st]]) scheduleFluid(nx, ny, nz, st);
      if (S.block[st] === R.id.pointed_dripstone && NS.Dripstone) NS.Dripstone.neighborChanged(nx, ny, nz, st, y - ny);
      // FrostedIceBlock.neighborUpdate: a changed neighbour that is frosted_ice too, with < 2 frosted around: melt
      if (S.block[st] === R.id.frosted_ice && S.block[w.get(x, y, z)] === R.id.frosted_ice && frostedCount(nx, ny, nz, 2)) { frostedMelt(nx, ny, nz); n++; }
      // G17-E1: the neighbour at (nx,ny,nz) is told the changed cell lies in direction OPP[d] from it
      bubbleNeighbor(nx, ny, nz, st, OPP[d], w.get(x, y, z));
      // `AbstractRailBlock.neighborUpdate`, told the block that WAS here (World.updateNeighbors(pos, old))
      if (Rl && Rl.isRail(upd)) Rl.neighborUpdate(nx, ny, nz, old);
      // `LeavesBlock.getStateForNeighborUpdate` (D-517): `int d = getDistanceFromLog(neighbour)+1;
      // if (d != 1 || state.DISTANCE != d) scheduleTick(pos, this, 1)` — the scheduled tick
      // (`B.scheduledTick`'s leaves branch) is what re-counts the distance, so a felled tree's
      // canopy comes down in a wave and an untouched canopy is never rewritten.
      // `ScaffoldingBlock.updateShape`: `level.scheduleTick(pos, this, 1)` on EVERY neighbour change
      if (S.block[st] === R.id.scaffolding) B.schedule(nx, ny, nz, 1);
      if (inCol(col.leaves, st)) {
        var dn = leafDistanceOf(w.get(x, y, z)) + 1;
        if (dn !== 1 || leafDistanceOf(st) !== dn) B.schedule(nx, ny, nz, 1);
      }
    }
    // #339 `RedstoneWireBlock.prepare`, for the state that left and the one that arrived: the diagonal wires
    if (NS.Redstone && NS.Redstone.ready) {
      if (old) n += NS.Redstone.wirePrepare(old, x, y, z);
      n += NS.Redstone.wirePrepare(w.get(x, y, z), x, y, z);
    }
    // `NoteBlock.getStateForNeighborUpdate` (DOWN only) / `getPlacementState`: the instrument follows the block below
    if (NS.Note && NS.Note.ready) { NS.Note.refresh(x, y, z); NS.Note.refresh(x, y + 1, z); }
    var self = w.get(x, y, z);
    if (self !== 0 && isFluid[S.block[self]]) scheduleFluid(x, y, z, self);
    // `Block.onPlace` for fire: it schedules itself, because fire is the one block that has to
    // keep asking whether it still has anything to stand on.
    // `AbstractFireBlock.onBlockAdded`: a fire placed where it cannot stand is removed at once
    // (trySpreadingFire replacing the log a fire hung off); otherwise `FireBlock.onBlockAdded` schedules it.
    if (self !== 0 && S.block[self] === B.FIRE && !fireQuiet && !B.fireCanSurvive(x, y, z)) { w.set(x, y, z, 0); return n; }
    // ⚠ vanilla's scheduler IGNORES a tick for a cell already queued (WorldTickScheduler.isQueued); a neighbour
    // re-shaping a burning fire must not pull its next tick earlier and run it twice.
    if (self !== 0 && S.block[self] === B.FIRE && !fireQuiet && pending[posKey(x, y, z)] === undefined) B.schedule(x, y, z, B.FIRE_RESCHEDULE + (((B.rng || Math.random)() * 10) | 0));
    // a fluid may now flow into the hole this change made
    for (var e = 0; e < 6; e++) {
      var fx = x + DX[e], fy = y + DY[e], fz = z + DZ[e];
      var fs = w.get(fx, fy, fz);
      if (fs !== 0 && isFluid[S.block[fs]]) scheduleFluid(fx, fy, fz, fs);
    }
    if (NS.BlockEntities && NS.BlockEntities.ready) NS.BlockEntities.onChanged(x, y, z, w.get(x, y, z));
    return n;
  }

  /**
   * `LiquidBlock.neighborChanged`, which is TWO statements and the order of them is the rule:
   *
   *     if (this.shouldSpreadLiquid(level, pos, state))
   *        level.scheduleTick(pos, fluid, this.fluid.getTickDelay(level));
   *
   * The lava/water test runs **synchronously, on the neighbour change** — not on the scheduled
   * tick that follows it. That timing is not a detail (D-415): lava's tick delay is 30 and
   * water's is 5, so a water source placed over lava gets SIX flow ticks before the lava would
   * next wake up, and the first of them replaces the lava outright. The obsidian never happens.
   * Asking here, the instant the water arrives, is what makes the reaction beat the flow — and
   * it is what vanilla does.
   *
   * ⚠ It is declared here, above the scheduler, because `changedInner` calls it and JS function
   * declarations hoist; `lavaMeetsWater` itself lives down with the rest of the fluid code where
   * it belongs.
   */
  function fluidNeighbourUpdate(x, y, z) {
    var st = w.get(x, y, z);
    if (st !== 0 && isFluid[S.block[st]] && lavaMeetsWater(x, y, z, st)) return;
    for (var d = 0; d < 6; d++) {
      var nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d], n = w.get(nx, ny, nz);
      if (n === 0 || !isFluid[S.block[n]]) continue;
      if (lavaMeetsWater(nx, ny, nz, n)) continue;
      if (pending[posKey(nx, ny, nz)] === undefined) B.schedule(nx, ny, nz, fluidDelay(n));
    }
  }
  function scheduleFluid(x, y, z, st) {
    if (lavaMeetsWater(x, y, z, st)) return false;
    return B.schedule(x, y, z, fluidDelay(st));
  }

  /**
   * **THE FLUIDS WORLDGEN LEFT BEHIND — D-415.** Dan: *"stuff like lava spawned with the world
   * doesn't flow auto"*.
   *
   * A fluid only ever moves when something schedules a tick for it, and until now the ONLY
   * things that did were a player's edit (`Behave.changed`) and another fluid tick. A world
   * arrives with its water and lava already written into the sections by the generator and the
   * carvers, and nothing ever woke any of it: a lava pool with a carved cave cut into one side
   * sat there with a flat vertical face, for ever, and no lavafall in the game had ever run.
   *
   * Vanilla does exactly this and has a name for it. `NoiseBasedChunkGenerator.doFill` calls
   * `chunkAccess.markPosForPostprocessing(pos)` for every fluid cell the aquifer says needs it,
   * and the post-processing pass on chunk load turns each of those into a block update — which
   * is why a cave that clips an underground lava lake has a lavafall in it the first time you
   * ever see it.
   *
   * ⚠ **ONLY CELLS THAT CAN ACTUALLY GO SOMEWHERE**, which is what makes this cheap enough to
   * do on the main thread at install time. Measured over 169 chunks of seed 1337: 49,605 water
   * cells and 10,541 lava cells, of which **13 and 60** have an air cell below or beside them.
   * Waking 0.43 cells a chunk is nothing; waking all 60,000 would be a scheduler with 27,000
   * entries in it and a lava sea that never stops moving.
   *
   * ⚠ **A UNIFORM SECTION IS SCANNED ONLY AT ITS FLOOR.** A section that is solid ocean has the
   * same fluid in all 4,096 cells, so no interior cell can have a non-fluid neighbour — only the
   * bottom layer, whose `below` is in the section underneath, can. Skipping the other fifteen
   * layers is what keeps deep ocean from costing fifteen thousand reads a section.
   *
   * ⚠ **THE ONE-CELL BORDER IS SKIPPED ON PURPOSE.** A neighbour outside this column reads 0 —
   * air — from a chunk that has not generated yet, which would wake every cell along the edge of
   * every ocean as if the sea ended there. Skipping `lx`/`lz` 0 and 15 costs an exposure that
   * falls exactly on a chunk seam and nothing else; a lavafall is several cells wide and the
   * cell beside the seam still wakes.
   */
  B.scanNewColumn = function (cx, cz, sections) {
    if (!B.ready || !sections) return 0;
    var Sec = NS.Section, CFG = NS.CFG, n = 0;
    var ox = cx << 4, oz = cz << 4;
    for (var sy = 0; sy < CFG.SECTIONS_Y; sy++) {
      var sec = sections[sy];
      if (!sec) continue;
      var uniform = sec.u >= 0;
      if (uniform) { if (sec.u === 0 || !isFluid[S.block[sec.u]]) continue; }
      else if (!paletteHasFluid(sec)) continue;
      var y0 = sy * 16 + CFG.WORLD_MIN_Y;
      var lyTop = uniform ? 1 : 16;
      for (var ly = 0; ly < lyTop; ly++) {
        for (var lz = 1; lz < 15; lz++) {
          for (var lx = 1; lx < 15; lx++) {
            var st = uniform ? sec.u : Sec.get(sec, (ly << 8) | (lz << 4) | lx);
            if (st === 0 || !isFluid[S.block[st]]) continue;
            var wx = ox + lx, wy = y0 + ly, wz = oz + lz;
            if (w.get(wx, wy - 1, wz) !== 0 &&
                w.get(wx - 1, wy, wz) !== 0 && w.get(wx + 1, wy, wz) !== 0 &&
                w.get(wx, wy, wz - 1) !== 0 && w.get(wx, wy, wz + 1) !== 0) continue;
            scheduleFluid(wx, wy, wz, st);
            n++;
          }
        }
      }
    }
    return n;
  };

  function paletteHasFluid(sec) {
    var p = sec.p;
    if (!p) return false;
    for (var i = 0; i < p.length; i++) {
      var st = p[i];
      if (st !== 0 && isFluid[S.block[st]]) return true;
    }
    return false;
  }

  // ── LAYER 4: the scheduler ─────────────────────────────────────────────────────────────
  // ⚠ THIS IS THE PIECE G15 WILL HANG OFF, so it is vanilla's ordering and not a plain array:
  // ties break by PRIORITY first and then by insertion order, which is what makes a repeater
  // chain deterministic. `LevelTicks` also de-duplicates — scheduling the same position twice in
  // the same tick is one tick — and so does this.
  var queue = [];                  // {x, y, z, at, pri, seq}
  var pending = Object.create(null);
  var seq = 0;
  B.gameTime = 0;
  B.inBlockTick = false;

  function posKey(x, y, z) { return x + ',' + y + ',' + z; }

  B.schedule = function (x, y, z, delay, priority) {
    var at = B.gameTime + (delay | 0 || 1);
    var k = posKey(x, y, z);
    if (pending[k] !== undefined && pending[k] <= at) return false;
    pending[k] = at;
    queue.push({ x: x, y: y, z: z, at: at, pri: priority | 0, seq: seq++ });
    return true;
  };
  B.isQueued = function (x, y, z) { return pending[posKey(x, y, z)] !== undefined; };
  B.scheduled = function () { return queue.length; };
  B.isScheduled = function (x, y, z) { return pending[posKey(x, y, z)] !== undefined; };
  B.clearSchedule = function () { queue.length = 0; pending = Object.create(null); B.gameTime = 0; };

  /** Advance one game tick: run every scheduled tick that is due, in vanilla's order. */
  B.tick = function () {
    B.gameTime++;
    if (NS.Commands && NS.Commands.timerTick) NS.Commands.timerTick(B.gameTime);   // #8232 level Timer
    if (NS.Sculk) NS.Sculk.tick();
    // `ServerWorld.inBlockTick`: true across the scheduled ticks and the block-event queue (PistonBlock.tryMove reads it).
    B.inBlockTick = true;
    var ran;
    try {
      ran = runDue();
      // `ServerWorld.tick`: scheduled block/fluid ticks, THEN the block-event queue (pistons).
      if (NS.Piston && NS.Piston.ready && NS.Piston.processEvents) NS.Piston.processEvents();
    } finally { B.inBlockTick = false; }
    return ran;
  };
  function runDue() {
    if (!queue.length) return 0;
    var due = [], keep = [], i;
    for (i = 0; i < queue.length; i++) (queue[i].at <= B.gameTime ? due : keep).push(queue[i]);
    queue = keep;
    due.sort(function (a, b) { return (a.at - b.at) || (a.pri - b.pri) || (a.seq - b.seq); });
    // `WorldTickScheduler.collectTickableTicks` POLLS every due tick out of its chunk's queue (and so out of the
    // de-dup set) BEFORE `tick` runs the first one: a cell still waiting its turn this tick is no longer "queued",
    // so a neighbour that changes before it runs schedules it again for the next tick. Clearing `pending` one entry
    // at a time dropped that second tick, and a felled canopy's distance wave ran 3 ticks slow (leafrefcheck).
    var e;
    for (i = 0; i < due.length; i++) {
      e = due[i];
      if (pending[posKey(e.x, e.y, e.z)] === e.at) delete pending[posKey(e.x, e.y, e.z)];
    }
    for (i = 0; i < due.length; i++) {
      e = due[i];
      B.scheduledTick(e.x, e.y, e.z);
    }
    return due.length;
  }

  // ── bubble columns (G17-E1) ────────────────────────────────────────────────────────────
  // BubbleColumnBlock / SoulSandBlock / MagmaBlock (.decomp net.minecraft.block). Soul sand and
  // magma re-check 20 ticks after water appears above them; the column itself re-checks after 5.
  var BUBBLE_SAND_DELAY = 20, BUBBLE_COLUMN_DELAY = 5;
  function isBubble(st) { return st !== 0 && S.block[st] === R.id.bubble_column; }
  function bubbleState(drag) { return S.withLocal('bubble_column', drag ? 0 : 1); }
  /** `BubbleColumnBlock.isStillWater`: a bubble column, or a SOURCE water block. */
  function stillWater(st) { return isBubble(st) || (st !== 0 && S.block[st] === B.WATER && fluidLevel(st) === 0); }
  function bubbleFor(below) {
    if (isBubble(below)) return below;
    var b = below === 0 ? -1 : S.block[below];
    if (b === R.id.soul_sand) return bubbleState(false);
    if (b === R.id.magma_block) return bubbleState(true);
    return S.stateOf('water');
  }
  /** `BubbleColumnBlock.update(world, pos, bottomState)`: fill upward through still water. */
  B.bubbleUpdate = function (x, y, z, below) {
    if (!stillWater(w.get(x, y, z))) return;
    var bs = bubbleFor(below);
    w.set(x, y, z, bs);
    for (var yy = y + 1; stillWater(w.get(x, yy, z)); yy++) {
      if (w.get(x, yy, z) === bs) { continue; }
      w.set(x, yy, z, bs);
    }
  };
  function bubbleTick(x, y, z, st) {
    var blk = S.block[st];
    if (isBubble(st)) { B.bubbleUpdate(x, y, z, w.get(x, y - 1, z)); return true; }
    if (blk === R.id.soul_sand || blk === R.id.magma_block) { B.bubbleUpdate(x, y + 1, z, st); return true; }
    return false;
  }
  /** getStateForNeighborUpdate of the three blocks; `dir` is the direction from (x,y,z) to the changed cell. */
  function bubbleNeighbor(x, y, z, st, dir, nst) {
    var blk = S.block[st];
    if (blk === R.id.soul_sand || blk === R.id.magma_block) {
      if (DY[dir] === 1 && nst !== 0 && S.block[nst] === B.WATER) B.schedule(x, y, z, BUBBLE_SAND_DELAY);
    } else if (isBubble(st)) {
      var bb = S.block[w.get(x, y - 1, z) || 0], ok = isBubble(w.get(x, y - 1, z)) || bb === R.id.soul_sand || bb === R.id.magma_block;
      if (!ok || DY[dir] === -1 || (DY[dir] === 1 && !isBubble(nst) && stillWater(nst))) B.schedule(x, y, z, BUBBLE_COLUMN_DELAY);
    }
  }

  B.scheduledTick = function (x, y, z) {
    var st = w.get(x, y, z);
    if (st === 0) return;
    if (isFluid[S.block[st]]) { fluidTick(x, y, z, st); return; }
    if (bubbleTick(x, y, z, st)) return;
    if (S.block[st] === R.id.scaffolding) { scaffoldingTick(x, y, z, st); return; }
    // LecternBlock.scheduledTick: the two-tick page pulse ends
    if (S.block[st] === R.id.lectern) { if (B.propName(st, 'powered') === 'true') { w.set(x, y, z, B.setProp(st, 'powered', false)); B.changed(x, y, z); B.changed(x, y - 1, z); } return; }
    // #352 the 1-tick break of a plant that lost its support (`world.breakBlock(pos, true)` in scheduledTick)
    var BW = NS.World; if (BW && BW.deferredBreak && BW.deferredBreak(st)) { if (!BW.canSurvive(x, y, z, st)) w.set(x, y, z, 0); return; }
    // `setBlockState(pos, updateDistanceFromLogs(..), 3)` — a no-op when the state is unchanged
    // (vanilla's setBlockState returns early), which is what stops two leaves pinging forever.
    if (inCol(col.leaves, st)) { var ul = updateLeafDistance(st, x, y, z); if (ul !== st) w.set(x, y, z, ul); return; }
    if (S.block[st] === R.id.frosted_ice) { tickFrostedIce(x, y, z, st, B.rng || Math.random); return; }
    if (S.block[st] === B.FIRE) { tickFire(x, y, z, st, B.rng || Math.random); return; }
    // PLAN G15a — a redstone torch's two-tick flip (D-294). It is dispatched here rather than
    // owned here for the same reason the fluids are: this function is the ONE place a scheduled
    // tick lands, so a family that forgets to register cannot quietly never run.
    if (NS.Redstone && NS.Redstone.ready && NS.Redstone.torchTick(x, y, z)) return;
    // PLAN G15b — a repeater's or comparator's scheduled flip (D-297). Same argument as the
    // torch: one place a scheduled tick lands, so a family that forgets to register cannot
    // quietly never run.
    if (NS.Redstone && NS.Redstone.ready && NS.Redstone.diodeTick(x, y, z)) return;
    // PLAN G15d — the observer's two-tick pulse (D-299).
    if (NS.Redstone && NS.Redstone.ready && NS.Redstone.observerTick(x, y, z)) return;
    if (NS.CmdBlock && NS.CmdBlock.ready && NS.CmdBlock.tick(x, y, z)) return;   // #8300 CommandBlock.scheduledTick
    // `RedstoneLampBlock.scheduledTick` — the lamp's 4-tick turn-off.
    if (NS.Redstone && NS.Redstone.ready && NS.Redstone.lampTick(x, y, z)) return;
    // PLAN G19 — a pressed button's unpress (D-361). Same argument as the three above: this is
    // the ONE place a scheduled tick lands, so a family that forgets to register here cannot
    // quietly never run — and a button that never comes back up is a circuit stuck on.
    if (NS.Use && NS.Use.ready && NS.Use.buttonTick(x, y, z)) return;
    // G17-M1 — `DetectorRailBlock.scheduledTick`: the 20-tick re-check while powered.
    if (NS.Minecart && NS.Minecart.detectorTick && NS.Minecart.detectorTick(x, y, z)) return;
    // cloud relaxed-curie — `AbstractPressurePlateBlock.scheduledTick`: the plate's re-check.
    if (NS.Use && NS.Use.ready && NS.Use.plateTick && NS.Use.plateTick(x, y, z)) return;
    // #5610 — TripwireBlock / TripwireHookBlock.scheduledTick.
    if (NS.Use && NS.Use.ready && NS.Use.tripwireTick && NS.Use.tripwireTick(x, y, z)) return;
    // PASS 17 JOB 1 (G19b), D-420 — a dispenser's or dropper's four-tick fire, registered here
    // for the same reason as the four above: this is the ONE place a scheduled tick lands.
    if (NS.Redstone && NS.Redstone.ready && NS.Redstone.dispenserTick(x, y, z)) return;
    // loop/composter, 07zy_composter.js -- ComposterBlock.scheduledTick
    // (.decomp:289-295), the level-7-to-8 pop. Same argument as the five above: this is
    // the ONE place a scheduled tick lands, so a family that forgets to register here
    // cannot quietly never run. Dead code until a real `composter` block exists (see
    // 07zy_composter.js's own header) -- `Composter.scheduledTick` only claims a
    // position this module itself tracks.
    if (NS.Composter && NS.Composter.ready && NS.Composter.scheduledTick(x, y, z)) return;
    if (NS.Dripleaf && NS.Dripleaf.scheduledTick(x, y, z)) return;   // #8684 BigDripleafBlock tilt step
    if (NS.Redstone && NS.Redstone.targetTick && NS.Redstone.targetTick(x, y, z)) return;   // #5609 TargetBlock.scheduledTick
    // s128 (G20) — `LightningRodBlock.scheduledTick`, the rod's 8-tick pulse ending.
    if (NS.Lightning && NS.Lightning.rodScheduledTick && NS.Lightning.rodScheduledTick(x, y, z)) return;
    if (NS.Sculk && NS.Sculk.scheduledTick(x, y, z)) return;
    // #5666 — AbstractCauldronBlock.scheduledTick (fillFromDripstone)
    if (NS.Dripstone && NS.Dripstone.cauldronTick(x, y, z)) return;
    if (NS.Dripstone && NS.Dripstone.scheduledTick(x, y, z)) return;
  };

  // ── fire ───────────────────────────────────────────────────────────────────────────────
  // `FireBlock.tick`. Fire is SCHEDULED, not randomly ticked: it re-schedules itself every
  // 30..39 ticks and ages one step at a time until it either finds something to burn or goes
  // out. The three rules that decide that are all here:
  //
  //   canSurvive          the block below presents a sturdy up face, OR something adjacent burns
  //   isValidFireLocation any of the six neighbours burns
  //   burn-out            standing on a non-burnable floor with nothing adjacent to burn, fire
  //                       dies once its age is past 3 — which is the whole of PLAN's acceptance
  //                       *"light a fire under a stone slab and assert it goes out"*
  //
  // ⚠ WHICH blocks burn, and how fast, is `FireBlock.bootStrap()`'s 140 `registerFlammableBlock
  // (block, burnChance, spreadChance)` calls — read out of the bytecode by extract-flammable.mjs
  // into `SR.ignite` (the FIRST int: "is it flammable", and the pull a neighbour exerts on an air
  // cell) and `SR.burn` (the SECOND: the odds the fire CONSUMES it). Both are 0 when waterlogged.
  // The old tag-family list this replaced (D-210's named gap) is gone (rule 5). firerefcheck is the referee.
  function isFlammable(st) {
    return st !== 0 && !S.waterIn[st] && S.ignite[S.block[st]] > 0;
  }
  function spreadOdds(st) { return st === 0 || S.waterIn[st] ? 0 : S.burn[S.block[st]]; }
  B.canBurn = isFlammable;

  /** `AbstractFireBlock.randomDisplayTick` (.decomp:47-107), client side: a 1-in-24 crackle
   *  (block.fire.ambient, vol 1+rand, pitch rand*0.7+0.3), then LARGE_SMOKE -- 2 along each flammable
   *  side/top face when nothing flammable or sturdy is below, else 3 above the floor. SoulFireBlock.isFlammable
   *  is `soul_fire_base_blocks`; FireBlock's is canBurn. Returns the particle count. `rnd` defaults to NS.wrand. */
  B.fireDisplayTick = function (st, x, y, z, rnd) {
    var nm = S.block[st];
    var fireB = S.block[S.stateOf('fire')], soulB = S.block[S.stateOf('soul_fire')];
    if (nm !== fireB && nm !== soulB) return 0;
    rnd = rnd || NS.wrand;
    var soul = nm === soulB, n = 0;
    var flam = function (s) { return soul ? (s !== 0 && inCol(column('soul_fire_base_blocks'), s)) : isFlammable(s); };
    if (rngInt(rnd, 24) === 0 && NS.Sound && NS.Sound.entitySound)
      NS.Sound.entitySound('block.fire.ambient', x + 0.5, y + 0.5, z + 0.5, 1 + rnd(), rnd() * 0.7 + 0.3, 'block');
    var smoke = function (px, py, pz) { if (NS.Particle && NS.Particle.spawn) NS.Particle.spawn('large_smoke', px, py, pz, 0, 0, 0); n++; };
    var below = w.get(x, y - 1, z);
    if (!flam(below) && !(below !== 0 && B.faceSturdy(below, 1))) {
      var k, px, py, pz;
      if (flam(w.get(x - 1, y, z))) for (k = 0; k < 2; k++) { px = x + rnd() * 0.1; py = y + rnd(); pz = z + rnd(); smoke(px, py, pz); }
      if (flam(w.get(x + 1, y, z))) for (k = 0; k < 2; k++) { px = x + 1 - rnd() * 0.1; py = y + rnd(); pz = z + rnd(); smoke(px, py, pz); }
      if (flam(w.get(x, y, z - 1))) for (k = 0; k < 2; k++) { px = x + rnd(); py = y + rnd(); pz = z + rnd() * 0.1; smoke(px, py, pz); }
      if (flam(w.get(x, y, z + 1))) for (k = 0; k < 2; k++) { px = x + rnd(); py = y + rnd(); pz = z + 1 - rnd() * 0.1; smoke(px, py, pz); }
      if (flam(w.get(x, y + 1, z))) for (k = 0; k < 2; k++) { px = x + rnd(); py = y + 1 - rnd() * 0.1; pz = z + rnd(); smoke(px, py, pz); }
    } else {
      for (var j = 0; j < 3; j++) smoke(x + rnd(), y + rnd() * 0.5 + 0.5, z + rnd());
    }
    return n;
  };

  function validFireLocation(x, y, z) {
    for (var d = 0; d < 6; d++) if (isFlammable(w.get(x + DX[d], y + DY[d], z + DZ[d]))) return true;
    return false;
  }
  B.fireCanSurvive = function (x, y, z) {
    var below = w.get(x, y - 1, z);
    if (below !== 0 && B.faceSturdy(below, 1)) return true;
    return validFireLocation(x, y, z);
  };

  // The world questions fire asks, each overridable by a headless check (firerefcheck's mock world).
  /** `World.isRaining()` — the rainLevel > 0.2 ramp. */
  B.isRaining = function () { var Sk = NS.Sky; return !!(Sk && Sk.weather && Sk.isRaining(Sk.weather)); };
  /** `World.hasRain(pos)`: raining, the column's top is not above it, and the biome there rains. */
  B.hasRain = function (x, y, z) {
    var Sk = NS.Sky, W = NS.World;
    if (!B.isRaining() || !W || !W.heightAt || !W.biomeAt || !Sk.isRainingAt) return false;
    var bio; try { bio = W.biomeAt(x, z); } catch (err) { return false; }
    return Sk.isRainingAt(Sk.weather, bio, x, y, z, true, Sk.roofTop(x, z));
  };
  /** `World.hasHighHumidity(pos)` = the biome's downfall > 0.85 (Biome.hasHighHumidity). */
  B.highHumidity = function (x, y, z) {
    var W = NS.World, Bi = NS.Biomes;
    if (!W || !W.biomeAt || !Bi || !Bi.downfall) return false;
    try { return Bi.downfall(W.biomeAt(x, z)) > 0.85; } catch (err) { return false; }
  };
  /** `Difficulty.getId()`: peaceful 0 .. hard 3. */
  B.difficultyId = function () {
    var D = NS.Diff; if (!D || !D.get) return 2;
    var i = D.LEVELS.indexOf(D.get()); return i < 0 ? 2 : i;
  };
  /** `DimensionType.getInfiniburnBlocks()` — the overworld's tag (netherrack, magma_block). */
  B.INFINIBURN_TAG = 'infiniburn_overworld';
  function doFireTick() {
    var C = NS.Commands;
    return !(C && C.ruleGet && String(C.ruleGet('doFireTick')) === 'false');
  }
  function rngInt(rnd, n) { return (rnd() * n) | 0; }
  var fireQuiet = false;      // an age change is setBlockState(.., 4): no onBlockAdded re-schedule
  /** `AbstractFireBlock.getState` + `getStateWithAge`: soul fire over its base, else fire with the
   *  directional faces `getStateForPosition` gives one that hangs off flammable walls. */
  function fireStateAt(x, y, z, age) {
    var below = w.get(x, y - 1, z);
    if (below !== 0 && inCol(column('soul_fire_base_blocks'), below)) return S.stateOf('soul_fire');
    var st = S.stateOf('fire');
    if (!isFlammable(below) && !(below !== 0 && B.faceSturdy(below, 1))) {
      st = B.setProp(st, 'north', isFlammable(w.get(x, y, z - 1)));
      st = B.setProp(st, 'east', isFlammable(w.get(x + 1, y, z)));
      st = B.setProp(st, 'south', isFlammable(w.get(x, y, z + 1)));
      st = B.setProp(st, 'west', isFlammable(w.get(x - 1, y, z)));
      st = B.setProp(st, 'up', isFlammable(w.get(x, y + 1, z)));
    }
    return B.setProp(st, 'age', age);
  }
  B.fireStateAt = fireStateAt;
  function primeTnt(x, y, z) {
    var EL = NS.EntityList;          // `TntBlock.primeTnt(world, pos)`: the entity only; the cell is fire's
    if (EL && EL.ready && EL.canSpawn && EL.canSpawn('tnt')) EL.spawn('tnt', x + 0.5, y, z + 0.5, { fuse: 80 });
    if (NS.GameEvent) NS.GameEvent.emit('prime_fuse', x + 0.5, y, z + 0.5, null);   // TntEntity -> PRIME_FUSE
    if (B.onTntPrimed) B.onTntPrimed(x, y, z);
  }
  // `FireBlock.trySpreadingFire` — the neighbour is CONSUMED (by fire, or by air), never "caught" in place.
  function trySpread(x, y, z, odds, rnd, age) {
    var st = w.get(x, y, z);
    if (rngInt(rnd, odds) >= spreadOdds(st)) return;
    if (rngInt(rnd, age + 10) < 5 && !B.hasRain(x, y, z)) {
      w.set(x, y, z, fireStateAt(x, y, z, Math.min(age + (rngInt(rnd, 5) / 4 | 0), 15)));
    } else w.set(x, y, z, 0);
    if (S.block[st] === R.id.tnt) primeTnt(x, y, z);
  }
  // `FireBlock.getBurnChance(world, pos)`: an AIR cell's pull is its most flammable neighbour's.
  function airBurnChance(x, y, z) {
    if (w.get(x, y, z) !== 0) return 0;
    var m = 0, n;
    for (var d = 0; d < 6; d++) {
      n = w.get(x + DX[d], y + DY[d], z + DZ[d]);
      if (n !== 0 && !S.waterIn[n] && S.ignite[S.block[n]] > m) m = S.ignite[S.block[n]];
    }
    return m;
  }

  // `FireBlock.scheduledTick` (.decomp FireBlock.java:144-216), line for line.
  function tickFire(x, y, z, st, rnd) {
    B.schedule(x, y, z, 30 + rngInt(rnd, 10));
    if (!doFireTick()) return;
    if (!B.fireCanSurvive(x, y, z)) w.set(x, y, z, 0);             // no return: vanilla carries on
    var infini = inCol(column(B.INFINIBURN_TAG), w.get(x, y - 1, z));
    var age = prop(st, P.age) < 0 ? 0 : +R.valueNames[prop(st, P.age)];
    if (!infini && B.isRaining() && rainingAround(x, y, z) && rnd() < 0.2 + age * 0.03) { w.set(x, y, z, 0); return; }
    var next = Math.min(15, age + (rngInt(rnd, 3) / 2 | 0));
    if (next !== age) { fireQuiet = true; try { w.set(x, y, z, B.setProp(st, 'age', next)); } finally { fireQuiet = false; } }
    if (!infini) {
      if (!validFireLocation(x, y, z)) {
        var below = w.get(x, y - 1, z);
        if (below === 0 || !B.faceSturdy(below, 1) || age > 3) w.set(x, y, z, 0);
        return;
      }
      if (age === 15 && rngInt(rnd, 4) === 0 && !isFlammable(w.get(x, y - 1, z))) { w.set(x, y, z, 0); return; }
    }
    var humid = B.highHumidity(x, y, z), hb = humid ? -50 : 0;
    trySpread(x + 1, y, z, 300 + hb, rnd, age);
    trySpread(x - 1, y, z, 300 + hb, rnd, age);
    trySpread(x, y - 1, z, 250 + hb, rnd, age);
    trySpread(x, y + 1, z, 250 + hb, rnd, age);
    trySpread(x, y, z - 1, 300 + hb, rnd, age);
    trySpread(x, y, z + 1, 300 + hb, rnd, age);
    var diff = B.difficultyId();
    for (var ox = -1; ox <= 1; ox++) for (var oz = -1; oz <= 1; oz++) for (var oy = -1; oy <= 4; oy++) {
      if (ox === 0 && oy === 0 && oz === 0) continue;
      var bound = 100 + (oy > 1 ? (oy - 1) * 100 : 0);
      var cx = x + ox, cy = y + oy, cz = z + oz;
      var chance = airBurnChance(cx, cy, cz);
      if (chance <= 0) continue;
      var odds = ((chance + 40 + diff * 7) / (age + 30)) | 0;
      if (humid) odds = odds / 2 | 0;
      if (odds > 0 && rngInt(rnd, bound) <= odds && (!B.isRaining() || !rainingAround(cx, cy, cz))) {
        w.set(cx, cy, cz, fireStateAt(cx, cy, cz, Math.min(15, age + (rngInt(rnd, 5) / 4 | 0))));
      }
    }
  }
  function rainingAround(x, y, z) {
    return B.hasRain(x, y, z) || B.hasRain(x - 1, y, z) || B.hasRain(x + 1, y, z) || B.hasRain(x, y, z - 1) || B.hasRain(x, y, z + 1);
  }
  B.FIRE_RESCHEDULE = 30;

  // ── fluids ─────────────────────────────────────────────────────────────────────────────
  // `FlowingFluid`, ported. The block state's `level` is vanilla's: 0 is a SOURCE, 1..7 are
  // flowing with 1 the strongest, and 8..15 are the falling forms of 0..7 — which is why the
  // amount is `8 - (level & 7)` for a flowing block and 8 for a source or a falling one.
  var WATER_DROPOFF = 1, LAVA_DROPOFF = 2;        // overworld lava; the Nether's is 1 (G19)
  var WATER_DELAY = 5, LAVA_DELAY = 30;
  var WATER_SLOPE = 4, LAVA_SLOPE = 2;
  function isWater(st) { return st !== 0 && S.block[st] === B.WATER; }
  function isLava(st) { return st !== 0 && S.block[st] === B.LAVA; }
  function fluidDelay(st) { return isLava(st) ? LAVA_DELAY : WATER_DELAY; }
  function fluidLevel(st) { var v = prop(st, P.level); return v < 0 ? 0 : +R.valueNames[v]; }
  function fluidAmount(st) { var l = fluidLevel(st); return l >= 8 ? 8 : 8 - l; }
  function fluidFalling(st) { return fluidLevel(st) >= 8; }
  function fluidState(block, amount, falling) {
    var lvl = falling ? 8 : (8 - amount);
    var base = R.realFirst[block] + R.defaultState[block];
    return withV(base, P.level, V[String(lvl)]);
  }
  B.fluidAmount = fluidAmount;
  B.fluidLevel = fluidLevel;
  B.isFluidState = function (st) { return st !== 0 && isFluid[S.block[st]] === true; };

  /** Can a fluid replace what is here? Vanilla: air, and anything `material.isReplaceable`. */
  function replaceable(st) {
    if (st === 0) return true;
    if (isFluid[S.block[st]]) return true;
    if (inCol(col.replaceable, st)) return true;
    var n = R.names[S.block[st]];
    return n === 'grass' || n === 'tall_grass' || n === 'fern' || n === 'large_fern' ||
           n === 'dead_bush' || n === 'seagrass' || n === 'tall_seagrass' || n === 'kelp' ||
           n === 'kelp_plant' || n === 'vine' || n === 'snow' || n === 'fire';
  }
  function blocksFlow(st, dir) {
    if (replaceable(st)) return false;
    return B.faceSturdy(st, dir) || S.opaque[st] === 1;
  }

  /** `FlowingFluid.getNewLiquid` — what this cell's fluid SHOULD be, from its neighbours. */
  function newLiquid(x, y, z, block) {
    var best = 0, sources = 0, d, i;
    for (i = 0; i < 4; i++) {
      d = HORIZ[i];
      var n = w.get(x + DX[d], y + DY[d], z + DZ[d]);
      if (n === 0 || S.block[n] !== block) continue;
      if (fluidLevel(n) === 0) sources++;
      var a = fluidAmount(n);
      if (a > best) best = a;
    }
    // ⚠ INFINITE WATER, and it is a rule not an accident: two or more source neighbours over a
    // solid floor (or over water) makes a new source. Lava never does this in the overworld.
    if (sources >= 2 && block === B.WATER) {
      var below = w.get(x, y - 1, z);
      if (below !== 0 && (S.opaque[below] === 1 || (S.block[below] === block && fluidLevel(below) === 0))) {
        return fluidState(block, 8, false);
      }
    }
    // `getUpdatedState` asks the cell ABOVE only after the infinite-source rule (FlowableFluid.java)
    var above = w.get(x, y + 1, z);
    if (above !== 0 && S.block[above] === block) return fluidState(block, 8, true);
    var drop = block === B.LAVA ? LAVA_DROPOFF : WATER_DROPOFF;
    var k = best - drop;
    if (k <= 0) return 0;
    return fluidState(block, k, false);
  }

  /**
   * `LiquidBlock.shouldSpreadLiquid` — **LAVA MEETS WATER** (D-415). It is the single most
   * recognisable rule in the game and this engine did not have it at all: a bucket of water on
   * a lava flow did nothing, a lava fall into a lake did nothing, and there was no way to make
   * cobblestone or obsidian.
   *
   *     POSSIBLE_FLOW_DIRECTIONS = { DOWN, SOUTH, WEST, NORTH, EAST }
   *     for (Direction d : POSSIBLE_FLOW_DIRECTIONS)
   *        if (level.getFluidState(pos.relative(d.getOpposite())).is(WATER)) {
   *           Block b = level.getFluidState(pos).isSource() ? OBSIDIAN : COBBLESTONE;
   *           level.setBlockAndUpdate(pos, b.defaultBlockState());
   *           fizz(); return false;
   *        }
   *
   * ⚠ **`d.getOpposite()`, WHICH IS THE WHOLE SUBTLETY.** The directions the lava could flow
   * are down and the four sides; the cells it LOOKS at are the opposite ones — so `DOWN` means
   * "is there water directly ABOVE me". That is why a water source poured onto lava turns the
   * lava under it to stone from the top down, and why lava is unaffected by water BELOW it.
   *
   * ⚠ **SOURCE -> OBSIDIAN, FLOWING -> COBBLESTONE**, and it is the lava's OWN level that
   * decides, not the water's. A still lava lake touched by water becomes obsidian; the moving
   * tongue coming off it becomes cobblestone. Getting that backwards is how a clone ends up
   * with obsidian farms that do not work.
   *
   * Returns true when the lava was consumed (the caller must not go on to spread it).
   */
  var HORIZ_AND_UP = null;
  function lavaMeetsWater(x, y, z, st) {
    if (!isLava(st)) return false;
    if (HORIZ_AND_UP === null) HORIZ_AND_UP = [1, HORIZ[0], HORIZ[1], HORIZ[2], HORIZ[3]];
    for (var i = 0; i < HORIZ_AND_UP.length; i++) {
      var d = HORIZ_AND_UP[i];
      var n = w.get(x + DX[d], y + DY[d], z + DZ[d]);
      if (!isWater(n)) continue;
      var name = fluidLevel(st) === 0 ? 'obsidian' : 'cobblestone';
      var to = S.stateOf(name);
      if (!(to > 0)) return false;
      w.set(x, y, z, to);
      B.changed(x, y, z);
      fizz(x, y, z);
      return true;
    }
    return false;
  }

  /** `FlowingFluid.fizz` — the hiss and the steam. No particles in this engine yet, so the
   *  sound alone, and only when there is a sound layer at all (a headless check has none). */
  function fizz(x, y, z) {
    var Sn = NS.Sound, P = NS.Player;
    if (!Sn || !Sn.ready || !Sn.play) return;
    // vanilla: `playSound(BLOCK_LAVA_EXTINGUISH, SoundSource.BLOCKS, 0.5F, 2.6F + (rand-rand)*0.8F)`
    Sn.play('block.lava.extinguish', {
      volume: 0.5, pitch: 2.6 + (Math.random() - Math.random()) * 0.8,
      x: x + 0.5, y: y + 0.5, z: z + 0.5,
      listener: P ? { x: P.x, y: P.y, z: P.z } : null
    });
  }
  B.lavaMeetsWater = lavaMeetsWater;

  function fluidTick(x, y, z, st) {
    var block = S.block[st];
    // ⚠ BEFORE ANYTHING ELSE, because vanilla's `LiquidBlock.tick` is
    // `if (!this.shouldSpreadLiquid(...)) return;` — a lava block that has just turned to stone
    // has no level to recompute and nothing to spread.
    if (lavaMeetsWater(x, y, z, st)) return;
    if (fluidLevel(st) !== 0) {
      var want = newLiquid(x, y, z, block);
      if (want !== st) {
        w.set(x, y, z, want);
        if (want === 0) { B.changed(x, y, z); return; }
        // `onScheduledTick`: setBlockState(pos, new, 2), schedule, then updateNeighborsAlways — the neighbours'
        // own ticks are what carry a removed source's recession down the channel (fluidrefcheck water_removed)
        B.schedule(x, y, z, fluidDelay(want));
        B.changed(x, y, z);
        st = want;
        if (st === 0) return;
      }
    }
    spread(x, y, z, st, block);
  }

  function spread(x, y, z, st, block) {
    var below = w.get(x, y - 1, z);
    var falling = fluidState(block, 8, true);
    if ((canFlowInto(below) || (block === B.LAVA && isWater(below))) &&
        !blocksFlow(w.get(x, y, z), 0)) {
      spreadTo(x, y - 1, z, falling, block, true);
      return;
    }
    var amount = fluidAmount(st);
    var drop = block === B.LAVA ? LAVA_DROPOFF : WATER_DROPOFF;
    var out = amount - drop;
    if (out <= 0) return;
    if (fluidLevel(st) >= 8) out = 7;              // a falling column spreads at strength 7
    // `getSpread` puts `getUpdatedState(target)` in its map for each chosen side, BEFORE any flow: a cell between
    // two sources is written as a source at once, not as a flow that later settles (fluidrefcheck water_infinite).
    var dirs = spreadDirections(x, y, z, block), want = [];
    for (var i = 0; i < dirs.length; i++) want.push(newLiquid(x + DX[dirs[i]], y, z + DZ[dirs[i]], block));
    for (i = 0; i < dirs.length; i++) {
      var d = dirs[i];
      if (want[i] !== 0) spreadTo(x + DX[d], y + DY[d], z + DZ[d], want[i], block);
    }
  }

  /** Can a fluid enter this cell at all? Vanilla's `canPassThrough` for a horizontal step. */
  function canFlowInto(st) {
    return replaceable(st) && !(st !== 0 && S.opaque[st] === 1);
  }

  /** D-488: the rule below as a constant only so behavcheck's anti-vacuity can turn it off. */
  B.SAME_FLUID_REFUSES = true;
  function spreadTo(x, y, z, state, block, down) {
    var cur = w.get(x, y, z);
    // ⚠ `LavaFluid.spreadTo`'s own override (D-415), and it is a DIFFERENT rule from
    // `shouldSpreadLiquid` above — same collision, other direction:
    //
    //     if (direction == Direction.DOWN && this.is(LAVA) && level.getFluidState(pos).is(WATER)) {
    //        if (blockState.getBlock() instanceof LiquidBlock) level.setBlock(pos, STONE);
    //        this.fizz(level, pos); return;
    //     }
    //
    // Lava falling INTO water makes **stone** — not cobblestone, not obsidian — and the lava
    // itself does not arrive. This is what a lavafall pouring into a pool builds.
    if (down && block === B.LAVA && isWater(cur)) {
      var stone = S.stateOf('stone');
      if (stone > 0) { w.set(x, y, z, stone); B.changed(x, y, z); }
      fizz(x, y, z);
      return;
    }
    // ⚠ D-488: A FLUID NEVER WRITES INTO ITS OWN FLUID. Vanilla's `FlowableFluid.canFlow` asks the
    // TARGET's `canBeReplacedWith` first, and WaterFluid's is `dir == DOWN && !fluid.isIn(WATER)`,
    // LavaFluid's `height >= 0.444 && fluid.isIn(WATER)` — both false for the same fluid. A flowing
    // cell's level is set only by its OWN tick (`getUpdatedState`, our `newLiquid`), which the
    // neighbour change schedules. The old "only ever make it wetter" write fought that tick: a
    // lavafall spreads sideways at 7 (vanilla's `if FALLING -> 7`) while the side cell settles to
    // 8-2 = 6, so ~47k cave-lava cells re-wrote each other every 30 ticks forever and no world ever
    // finished meshing (palettecheck/lumacheck/soakcheck's "never settled").
    if (cur !== 0 && S.block[cur] === block && B.SAME_FLUID_REFUSES) return;
    if (!canFlowInto(cur)) return;
    w.set(x, y, z, state);
    B.schedule(x, y, z, fluidDelay(state));
    // `flow` is setBlockState(.., 3): FluidBlock.onBlockAdded on the new cell and neighborUpdate on each neighbour
    // run `receiveNeighborFluids` AT ONCE — water arriving beside a lava source makes obsidian that same tick
    // (fluidrefcheck lava_meets_water) — then queue a tick that is not already queued (vanilla's scheduler de-dups).
    fluidNeighbourUpdate(x, y, z);
  }

  /**
   * `FlowingFluid.getSpread` — the horizontal directions the fluid actually takes. Vanilla does
   * not spread in all four: it searches up to `slopeFindDistance` blocks for the nearest HOLE
   * (a cell it could fall out of) and takes only the directions whose search found the shortest
   * one. That search is why water finds the edge of a cliff instead of pooling outward evenly,
   * and it is the thing PLAN's staircase acceptance actually measures.
   */
  function spreadDirections(x, y, z, block) {
    var reach = block === B.LAVA ? LAVA_SLOPE : WATER_SLOPE;
    var best = 1000, out = [], i;
    for (i = 0; i < 4; i++) {
      var d = HORIZ[i];
      var nx = x + DX[d], ny = y, nz = z + DZ[d];
      var n = w.get(nx, ny, nz);
      if (!canFlowInto(n)) continue;
      if (n !== 0 && S.block[n] === block && fluidLevel(n) === 0) continue;
      var dist = slopeDistance(nx, ny, nz, reach - 1, OPP[d], block, 1);
      if (dist < best) { best = dist; out = [d]; }
      else if (dist === best) out.push(d);
    }
    return out;
  }

  function slopeDistance(x, y, z, left, from, block, depth) {
    var below = w.get(x, y - 1, z);
    if (canFlowInto(below)) return depth;
    if (left <= 0) return 1000;
    var best = 1000;
    for (var i = 0; i < 4; i++) {
      var d = HORIZ[i];
      if (d === from) continue;
      var nx = x + DX[d], nz = z + DZ[d];
      var n = w.get(nx, y, nz);
      if (!canFlowInto(n)) continue;
      var r = slopeDistance(nx, y, nz, left - 1, OPP[d], block, depth + 1);
      if (r < best) best = r;
    }
    return best;
  }

  // ── LAYER 3: random ticks ──────────────────────────────────────────────────────────────
  // ⚠ `isRandomlyTicking` IS A COMPILED-JAVA FLAG (D-207). No data file carries it. What is
  // observable, though, is only whether a block DOES something on a random tick — a block with
  // no `randomTick` override is indistinguishable from one that is never picked, apart from the
  // tick budget. So the set below IS the set of blocks with a rule, and it is honest to say that
  // vanilla's flag is not ported: it is unreachable, and unobservable where it differs.
  var rules = null;
  function ruleFor(state) {
    if (!rules) buildRules();
    return rules[S.block[state]];
  }

  function buildRules() {
    rules = Object.create(null);
    var i, b;
    var crops = NS.Tags.blocks('crops') || [];
    for (i = 0; i < crops.length; i++) { b = R.id[crops[i]]; if (b !== undefined) rules[b] = tickCrop; }
    var leaves = NS.Tags.blocks('leaves') || [];
    for (i = 0; i < leaves.length; i++) { b = R.id[leaves[i]]; if (b !== undefined) rules[b] = tickLeaves; }
    var saplings = NS.Tags.blocks('saplings') || [];
    for (i = 0; i < saplings.length; i++) { b = R.id[saplings[i]]; if (b !== undefined) rules[b] = tickSapling; }
    // `StemBlock` (pumpkin/melon): in the `crops` tag, but its own randomTick fruits at age 7
    ['pumpkin_stem', 'melon_stem'].forEach(function (n) { if (R.id[n] !== undefined) rules[R.id[n]] = tickStem; });
    for (var k in FAM.grassSpread) rules[k] = tickGrassSpread;
    if (R.id.dirt !== undefined) rules[R.id.dirt] = tickDirt;
    if (R.id.farmland !== undefined) rules[R.id.farmland] = tickFarmland;
    if (R.id.sugar_cane !== undefined) rules[R.id.sugar_cane] = tickColumnPlant;
    if (R.id.cactus !== undefined) rules[R.id.cactus] = tickColumnPlant;
    if (R.id.ice !== undefined) rules[R.id.ice] = tickIce;
    if (R.id.snow !== undefined) rules[R.id.snow] = tickSnow;
    if (R.id.frosted_ice !== undefined) rules[R.id.frosted_ice] = tickFrostedIce;
    if (R.id.nether_wart !== undefined) rules[R.id.nether_wart] = tickNetherWart;
    // #304 (G24) — BambooBlock / BambooSaplingBlock / CocoaBlock / SweetBerryBushBlock.randomTick
    if (R.id.turtle_egg !== undefined) rules[R.id.turtle_egg] = function (x, y, z, st, rnd) { return !!(NS.Turtle && NS.Turtle.eggRandomTick(x, y, z, st, rnd)); };   // #1253
    if (R.id.bamboo !== undefined) rules[R.id.bamboo] = tickBamboo;
    if (R.id.bamboo_sapling !== undefined) rules[R.id.bamboo_sapling] = tickBambooSapling;
    if (R.id.cocoa !== undefined) rules[R.id.cocoa] = tickCocoa;
    if (R.id.sweet_berry_bush !== undefined) rules[R.id.sweet_berry_bush] = tickSweetBerry;
    // #305 (G24b) — AbstractPlantStemBlock.randomTick: the HEAD only; the `_plant` body has no randomTick
    for (i = 0; i < STEM_FAMS.length; i++) { b = R.id[STEM_FAMS[i][0]]; if (b !== undefined) rules[b] = tickPlantStem; }
    // #5666 — PointedDripstoneBlock.randomTick
    if (R.id.pointed_dripstone !== undefined) rules[R.id.pointed_dripstone] = function (x, y, z, st, rnd) { return !!(NS.Dripstone && NS.Dripstone.randomTick(x, y, z, st, rnd)); };
    // #7107 — NetherPortalBlock.randomTick (07zzs_portal.js): overworld-type portals spawn a zombified_piglin
    if (R.id.nether_portal !== undefined) rules[R.id.nether_portal] = tickNetherPortalSpawn;
    // s128 (G20) — OxidizableBlock/Slab/Stairs.randomTick -> Degradable.tickDegradation (07zze_oxidize.js).
    if (NS.Oxidize) {
      var oxb = NS.Oxidize.tickingBlocks();
      for (i = 0; i < oxb.length; i++) rules[oxb[i]] = NS.Oxidize.randomTick;
    }
  }
  /** #7107 NetherPortalBlock.randomTick: ctx adapter over the live world/spawn/dimension. */
  function tickNetherPortalSpawn(x, y, z, st, rnd) {
    var P = NS.Portal, EL = NS.EntityList, C = NS.Commands, Sp = NS.Spawn, D = NS.Dim;
    if (!P || !P.randomTick || !EL || !EL.spawn) return false;
    var pid = R.id.nether_portal;
    var e = P.randomTick({
      natural: !!(D && D.current().natural),
      doMobSpawning: !(C && C.ruleGet && String(C.ruleGet('doMobSpawning')) === 'false'),
      difficulty: B.difficultyId(),
      isPortal: function (px, py, pz) { return S.block[w.get(px, py, pz)] === pid; },
      allowsSpawning: function (px, py, pz) { return !!(Sp && Sp.floorAllows && Sp.floorAllows('zombified_piglin', px, py + 1, pz)); },
      spawn: function (px, py, pz) { return EL.spawn('zombified_piglin', px + 0.5, py, pz + 0.5, { reason: 'NETHER_PORTAL' }) || null; }
    }, rnd, x, y, z);
    return !!e;
  }
  B.hasRandomTick = function (state) { return !!ruleFor(state); };

  /** One random tick at a position. `rnd` is a function returning [0,1); default Math.random. */
  B.randomTick = function (x, y, z, rnd) {
    if (!B.ready) return false;
    var st = w.get(x, y, z);
    if (st === 0) return false;
    var fn = ruleFor(st);
    if (!fn) return false;
    return fn(x, y, z, st, rnd || Math.random) === true;
  };

  /**
   * `Level.tickChunk`'s random-tick pass over one 16^3 section: `randomTickSpeed` positions per
   * section per tick, uniformly chosen, and 3 is vanilla's default `gamerule randomTickSpeed`.
   */
  /**
   * `CauldronBlock/LeveledCauldronBlock.precipitationTick` (.decomp): `canFillWithPrecipitation` rolls
   * 0.05 rain / 0.1 snow; an empty cauldron becomes level-1 water (rain) or powder snow (snow), a
   * water cauldron gains a level in rain, a powder-snow one in snow; full ones do nothing.
   * `precip` is Sky.RAIN (1) / Sky.SNOW (2). True when the cauldron changed.
   */
  B.cauldronPrecipitation = function (x, y, z, precip, rnd) {
    var st = w.get(x, y, z);
    if (st === 0 || (precip !== 1 && precip !== 2)) return false;
    var nm = R.names[S.block[st]];
    if (nm !== 'cauldron' && nm !== 'water_cauldron' && nm !== 'powder_snow_cauldron') return false;
    if (!((rnd() < (precip === 1 ? 0.05 : 0.1)))) return false;
    var next;
    if (nm === 'cauldron') next = S.withLocal(precip === 1 ? 'water_cauldron' : 'powder_snow_cauldron', 0);
    else {
      if (nm !== (precip === 1 ? 'water_cauldron' : 'powder_snow_cauldron')) return false;
      var lv = st - S.withLocal(nm, 0);
      if (lv >= 2) return false;
      next = S.withLocal(nm, lv + 1);
    }
    w.set(x, y, z, next);
    return true;
  };
  /** `ServerLevel.tickChunk`'s 1-in-16 column pass: the block under the motion-blocking top gets the precipitation. */
  B.precipitationColumn = function (cx, cz, rnd) {
    if (rnd() >= 1 / 16) return false;
    var Sk = NS.Sky, W = NS.World;
    if (!B.isRaining() || !W || !W.biomeAt || !Sk.precipitationAt || !Sk.roofTop) return false;
    var x = (cx << 4) + ((rnd() * 16) | 0), z = (cz << 4) + ((rnd() * 16) | 0);
    var top = Sk.roofTop(x, z);
    if (top === undefined) return false;
    var bio; try { bio = W.biomeAt(x, z); } catch (err) { return false; }
    var pr = Sk.precipitationAt(bio, x, top, z);
    return pr ? B.cauldronPrecipitation(x, top - 1, z, pr, rnd) : false;
  };
  B.RANDOM_TICK_SPEED = 3;
  B.randomTickSection = function (sx, sy, sz, rnd, speed) {
    var r = rnd || Math.random, hits = 0, n = speed;
    if (n === undefined) {   // #512: the live `randomTickSpeed` gamerule (default 3 = B.RANDOM_TICK_SPEED)
      var C = NS.Commands, v = C && C.ruleGet ? parseInt(C.ruleGet('randomTickSpeed'), 10) : NaN;
      n = v >= 0 ? v : B.RANDOM_TICK_SPEED;
    }
    for (var i = 0; i < n; i++) {
      var x = sx + ((r() * 16) | 0), y = sy + ((r() * 16) | 0), z = sz + ((r() * 16) | 0);
      if (B.randomTick(x, y, z, r)) hits++;
    }
    return hits;
  };

  // `CropBlock.getGrowthSpeed`, verbatim: the nine farmland cells under and around the crop, at
  // 1 dry and 3 moist, quartered on the diagonals, then halved when the crop is in a crossing or
  // a diagonal cluster. This is why a player plants in rows.
  function growthSpeed(x, y, z, block) {
    var f = 1, i, j;
    var farm = R.id.farmland;
    for (i = -1; i <= 1; i++) {
      for (j = -1; j <= 1; j++) {
        var f1 = 0;
        var st = w.get(x + i, y - 1, z + j);
        if (st !== 0 && S.block[st] === farm) {
          f1 = 1;
          if (prop(st, P.moisture) >= 0 && +R.valueNames[prop(st, P.moisture)] > 0) f1 = 3;
        }
        if (i !== 0 || j !== 0) f1 /= 4;
        f += f1;
      }
    }
    var same = function (dx, dz) { var s2 = w.get(x + dx, y, z + dz); return s2 !== 0 && S.block[s2] === block; };
    var ew = same(-1, 0) || same(1, 0);
    var ns = same(0, -1) || same(0, 1);
    if (ew && ns) f /= 2;
    else if (same(-1, -1) || same(1, -1) || same(-1, 1) || same(1, 1)) f /= 2;
    return f;
  }

  function maxAge(block) {
    // the number of `age` values this block has, minus one — read from the state space, not typed
    for (var k = R.propFirst[block]; k < R.propFirst[block + 1]; k++) {
      if (R.propId[k] === P.age) return R.propValN[k] - 1;
    }
    return 0;
  }
  B.maxAge = maxAge;

  function tickCrop(x, y, z, st, rnd) {
    var block = S.block[st];
    // BeetrootsBlock.randomTick: `if (random.nextInt(3) != 0) super.randomTick(...)`, drawn before the light test
    if (block === R.id.beetroots && ((rnd() * 3) | 0) === 0) return false;
    if (w.baseLight(x, y, z) < 9) return false;    // CropBlock.randomTick: getBaseLightLevel(pos, 0) >= 9, its OWN cell
    var age = prop(st, P.age) < 0 ? 0 : +R.valueNames[prop(st, P.age)];
    var mx = maxAge(block);
    if (age >= mx) return false;
    var f = growthSpeed(x, y, z, block);
    if (((rnd() * (((25 / f) | 0) + 1)) | 0) !== 0) return false;
    w.set(x, y, z, B.setProp(st, 'age', age + 1));
    return true;
  }

  // `StemBlock.randomTick` (.decomp/net/minecraft/block/StemBlock.java:54-70): the crop's light gate and growth roll;
  // at age 7 a random HORIZONTAL direction (Direction.Type.HORIZONTAL order N,E,S,W: nextInt(4)) — if that cell is air
  // over farmland or the `dirt` tag, the gourd goes there and the stem becomes its attached stem facing it.
  var STEM_DIRS = [[0, -1, 'north'], [1, 0, 'east'], [0, 1, 'south'], [-1, 0, 'west']];
  var dirtTag = null;
  function tickStem(x, y, z, st, rnd) {
    if (w.baseLight(x, y, z) < 9) return false;
    var block = S.block[st];
    if (((rnd() * (((25 / growthSpeed(x, y, z, block)) | 0) + 1)) | 0) !== 0) return false;
    var age = prop(st, P.age) < 0 ? 0 : +R.valueNames[prop(st, P.age)];
    if (age < 7) { w.set(x, y, z, B.setProp(st, 'age', age + 1)); return true; }
    var d = STEM_DIRS[(rnd() * 4) | 0], gx = x + d[0], gz = z + d[1];
    if (w.get(gx, y, gz) !== 0) return false;
    var soil = w.get(gx, y - 1, gz);
    if (dirtTag === null) { dirtTag = {}; (NS.Tags.blocks('dirt') || []).forEach(function (n) { if (R.id[n] !== undefined) dirtTag[R.id[n]] = 1; }); }
    if (soil === 0 || (S.block[soil] !== R.id.farmland && !dirtTag[S.block[soil]])) return false;
    var name = R.names[block], gourd = R.id[name.slice(0, -5)], att = R.id['attached_' + name];
    if (gourd === undefined || att === undefined) return false;
    w.set(gx, y, gz, R.realFirst[gourd] + R.defaultState[gourd]);
    w.set(x, y, z, B.setProp(R.realFirst[att] + R.defaultState[att], 'facing', d[2]));
    return true;
  }

  function tickNetherWart(x, y, z, st, rnd) {
    var age = prop(st, P.age) < 0 ? 0 : +R.valueNames[prop(st, P.age)];
    if (age >= 3) return false;
    if (((rnd() * 10) | 0) !== 0) return false;    // vanilla: random.nextInt(10) == 0
    w.set(x, y, z, B.setProp(st, 'age', age + 1));
    return true;
  }

  function numProp(st, pid) { var v = prop(st, pid); return v < 0 ? 0 : +R.valueNames[v]; }

  // `CocoaBlock.randomTick` (.decomp/net/minecraft/block/CocoaBlock.java:47-54): `world.random.nextInt(5) == 0`
  // (the SAME generator as the tick's own in ServerWorld), THEN age < 2 -> age + 1. No light gate: a pod ripens in the dark.
  function tickCocoa(x, y, z, st, rnd) {
    if (((rnd() * 5) | 0) !== 0) return false;
    var age = numProp(st, P.age);
    if (age >= 2) return false;
    w.set(x, y, z, B.setProp(st, 'age', age + 1));
    return true;
  }

  // `SweetBerryBushBlock.randomTick` (.decomp/net/minecraft/block/SweetBerryBushBlock.java:57-62), in its own order:
  // age < 3 (no draw at age 3), nextInt(5) == 0, then `getBaseLightLevel(pos.up(), 0) >= 9` — the cell ABOVE, not its own.
  function tickSweetBerry(x, y, z, st, rnd) {
    var age = numProp(st, P.age);
    if (age >= 3) return false;
    if (((rnd() * 5) | 0) !== 0) return false;
    if (w.baseLight(x, y + 1, z) < 9) return false;
    w.set(x, y, z, B.setProp(st, 'age', age + 1));
    return true;
  }

  // `BambooSaplingBlock.randomTick` (.decomp/net/minecraft/block/BambooSaplingBlock.java:39-44 + grow:89-91):
  // nextInt(3) == 0, air above, base light >= 9 ABOVE -> bamboo[leaves=small] on top. The sapling itself turns into
  // default bamboo through its `getStateForNeighborUpdate` (the `bamboo_sapling` branch of `updateShape`).
  function isBamboo(st) { return st !== 0 && S.block[st] === R.id.bamboo; }
  function tickBambooSapling(x, y, z, st, rnd) {
    if (((rnd() * 3) | 0) !== 0) return false;
    if (!S.isAir[w.get(x, y + 1, z)] || w.baseLight(x, y + 1, z) < 9) return false;
    var bb = R.id.bamboo;
    w.set(x, y + 1, z, B.setProp(R.realFirst[bb] + R.defaultState[bb], 'leaves', 'small'));
    return true;
  }

  // `BambooBlock.randomTick` (.decomp/net/minecraft/block/BambooBlock.java:119-133): only a STAGE-0 stalk ticks
  // (`hasRandomTicks`), nextInt(3) == 0, air above, base light >= 9 above; `countBambooBelow + 1 < 16`, then
  // `updateLeaves`. Every stalk but the top one fails the air test, so a column grows from its top.
  function tickBamboo(x, y, z, st, rnd) {
    if (numProp(st, P.stage) !== 0) return false;
    if (((rnd() * 3) | 0) !== 0) return false;
    if (!S.isAir[w.get(x, y + 1, z)] || w.baseLight(x, y + 1, z) < 9) return false;
    var below = 0;                                 // countBambooBelow: capped at 16, like vanilla's loop
    while (below < 16 && isBamboo(w.get(x, y - below - 1, z))) below++;
    if (below + 1 >= 16) return false;
    bambooUpdateLeaves(st, x, y, z, rnd, below + 1);
    return true;
  }
  // `BambooBlock.updateLeaves` (:190-210), verbatim: the new top is SMALL-leaved over a bare stalk, LARGE over a leafy
  // one (and then the two below become small / none); it is thick (age 1) when this stalk is or two below is bamboo;
  // it stops (stage 1) at height 15, or from 11 up with `nextFloat() < 0.25` — drawn only when n >= 11.
  function bambooUpdateLeaves(st, x, y, z, rnd, n) {
    var b1 = w.get(x, y - 1, z), b2 = w.get(x, y - 2, z);
    var leaves = 'none';
    if (n >= 1) {
      if (!isBamboo(b1) || prop(b1, P.leaves) === V.none) leaves = 'small';
      else {
        leaves = 'large';
        if (isBamboo(b2)) {
          w.set(x, y - 1, z, B.setProp(b1, 'leaves', 'small'));
          w.set(x, y - 2, z, B.setProp(b2, 'leaves', 'none'));
        }
      }
    }
    var age = (numProp(st, P.age) !== 1 && !isBamboo(b2)) ? 0 : 1;
    var stage = ((n < 11 || !(rnd() < 0.25)) && n !== 15) ? 0 : 1;
    var bb = R.id.bamboo, top = R.realFirst[bb] + R.defaultState[bb];
    w.set(x, y + 1, z, B.setProp(B.setProp(B.setProp(top, 'age', age), 'leaves', leaves), 'stage', stage));
  }

  /**
   * `LeavesBlock`. `distance` is the number of steps to the nearest log, 7 meaning "too far";
   * a non-persistent leaf at 7 decays. `updateDistance` is the scheduled half and runs whenever
   * a neighbour changes, which is what makes a felled tree's canopy come down.
   */
  function leafDistanceOf(st) {
    if (st === 0) return 7;
    if (inCol(col.logs, st)) return 0;
    if (inCol(col.leaves, st)) { var d = prop(st, P.distance); return d < 0 ? 7 : +R.valueNames[d]; }
    return 7;
  }
  function updateLeafDistance(st, x, y, z) {
    var best = 7;
    for (var d = 0; d < 6; d++) {
      var n = leafDistanceOf(w.get(x + DX[d], y + DY[d], z + DZ[d])) + 1;
      if (n < best) best = n;
      if (best === 1) break;
    }
    return B.setProp(st, 'distance', best);
  }
  B.updateLeafDistance = updateLeafDistance;

  // `ScaffoldingBlock.getDistance`: 0 on a sturdy floor, else the lower of the scaffolding below and the four
  // sideways scaffoldings + 1 (capped at 7). The scan is around the block itself (see 02k_survive case 39).
  function scaffoldDist(x, y, z) {
    var sc = R.id.scaffolding, d0 = 7, bl = w.get(x, y - 1, z);
    if (S.block[bl] === sc) d0 = scaffoldNum(bl);
    else if (S.faceSturdy(bl, 2, S.SUPPORT_FULL)) return 0;
    for (var i = 0; i < 4; i++) {
      var n = w.get(x + (i === 2 ? -1 : i === 3 ? 1 : 0), y, z + (i === 0 ? -1 : i === 1 ? 1 : 0));
      if (S.block[n] !== sc) continue;
      var td = scaffoldNum(n) + 1;
      if (td < d0) d0 = td;
      if (d0 === 1) break;
    }
    return d0;
  }
  function scaffoldNum(st) { var v = S.propValue(st, P.distance); for (var d = 0; d <= 7; d++) if (V[String(d)] === v) return d; return 7; }
  /** `ScaffoldingBlock.tick`: re-derive distance/bottom; at 7 it breaks, or FALLS when it was already 7. */
  function scaffoldingTick(x, y, z, st) {
    var i = scaffoldDist(x, y, z);
    var bottom = i !== 0 && S.block[w.get(x, y - 1, z)] !== R.id.scaffolding;
    var bs = B.setProp(B.setProp(st, 'distance', i), 'bottom', bottom);
    if (i === 7) {
      if (scaffoldNum(st) === 7) {
        w.set(x, y, z, 0);
        var EL = NS.EntityList;
        if (EL && EL.ready) EL.spawn('falling_block', x + 0.5, y, z + 0.5, { state: bs });
      } else {
        var drops = (NS.Loot && NS.Loot.ready) ? NS.Loot.breakDrops(st, {}) : [], EL2 = NS.EntityList, It = NS.Items;
        w.set(x, y, z, 0);
        if (drops.length && EL2 && EL2.ready && EL2.popResource && It && It.of) {
          for (var di = 0; di < drops.length; di++) { var ix = It.of(drops[di].item); if (ix >= 0) EL2.popResource(x, y, z, ix, drops[di].count || 1); }
        }
      }
    } else if (bs !== st) w.set(x, y, z, bs);
  }

  // `LeavesBlock.randomTick` (1.18.2, .decomp/net/minecraft/block/LeavesBlock.java:42), verbatim:
  // `if (!PERSISTENT && DISTANCE == 7) { dropStacks; removeBlock }` — and NOTHING else. D-517:
  // this used to recompute the distance on every random tick too, which vanilla never does
  // (the distance is kept current by `getStateForNeighborUpdate` scheduling a 1-tick
  // `scheduledTick` — wired in `changedInner` below); the extra write churned ~16 leaf states a
  // second across the simulation disc, each one a section remesh the streamer then owed.
  function tickLeaves(x, y, z, st) {
    if (prop(st, P.persistent) === V['true']) return false;
    if (leafDistanceOf(st) !== 7) return false;
    var drops = (NS.Loot && NS.Loot.ready) ? NS.Loot.breakDrops(st, {}) : [];
    w.set(x, y, z, 0);
    var EL = NS.EntityList, It = NS.Items;
    if (drops.length && EL && EL.ready && EL.popResource && It && It.of) {
      for (var i = 0; i < drops.length; i++) {
        var idx = It.of(drops[i].item);
        if (idx >= 0) EL.popResource(x, y, z, idx, drops[i].count || 1);
      }
    }
    return true;
  }

  // `SpreadingSnowyDirtBlock`: die under a light-blocking cover, otherwise seed four random
  // nearby dirt cells. Vanilla's offsets are exactly nextInt(3)-1, nextInt(5)-3, nextInt(3)-1.
  function canBeGrass(x, y, z) {
    var above = w.get(x, y + 1, z);
    if (above === 0) return true;
    if (R.names[S.block[above]] === 'snow' && +R.valueNames[prop(above, P.layers)] === 1) return true;
    if (isWater(above) && fluidAmount(above) === 8) return false;
    // ChunkLightProvider.getRealisticOpacity(.., UP, opacity): a cover that is opaque AND hasSidedTransparency (slab,
    // stairs, snow, farmland, ... — tools/golden/sided-light-1.18.2.tsv) and whose culling shape covers its DOWN face
    // counts as 16 — grass dies under a bottom slab or 2+ snow layers (the grass block below is never sided).
    if (sidedLight(above) && S.canOcclude[S.block[above]] === 1 && (R.occlusion[S.vis[above]] & 1)) return false;
    return S.atten[above] < 15;
  }
  var sidedById = null;
  function sidedLight(st) {
    var tab = NS.DATA && NS.DATA.sidedLight;
    if (!tab) return false;
    if (sidedById === null) { sidedById = new Array(R.names.length); for (var i = 0; i < R.names.length; i++) sidedById[i] = tab[R.names[i]] || ''; }
    var rule = sidedById[S.block[st]];
    if (rule === 'true') return true;
    if (rule === 'extended') return prop(st, P.extended) === V['true'];
    if (rule === 'notdouble') { var t = prop(st, P.type); return t >= 0 && R.valueNames[t] !== 'double'; }
    return false;
  }
  function tickGrassSpread(x, y, z, st, rnd) {
    var dirt = R.id.dirt;
    if (!canBeGrass(x, y, z)) {
      w.set(x, y, z, R.realFirst[dirt] + R.defaultState[dirt]);
      return true;
    }
    if (w.lightLevel(x, y + 1, z) < 9) return false;   // SpreadableBlock.randomTick: getLightLevel(pos.up()) >= 9
    var spreadAny = false;
    for (var i = 0; i < 4; i++) {
      var nx = x + ((rnd() * 3) | 0) - 1, ny = y + ((rnd() * 5) | 0) - 3, nz = z + ((rnd() * 3) | 0) - 1;
      var t = w.get(nx, ny, nz);
      if (t === 0 || S.block[t] !== dirt) continue;
      if (!canBeGrass(nx, ny, nz)) continue;      // canSpread = canSurvive && no water above: no light test (1.18.2)
      w.set(nx, ny, nz, B.updateShape(R.realFirst[S.block[st]] + R.defaultState[S.block[st]], nx, ny, nz));
      spreadAny = true;
    }
    return spreadAny;
  }
  /**
   * `FarmlandBlock.onLandedUpon` + `setToDirt` (#309): server side, nextFloat < fallDistance - 0.5, a LivingEntity,
   * a player or mobGriefing, and width*width*height > 0.512 (a chicken or a baby never). pushEntitiesUpBeforeBlockChange
   * lifts the lander out of the 15/16 cell the dirt now fills.
   */
  B.farmlandTrample = function (e, x, y, z, distance, rnd) {
    var st = w.get(x, y, z);
    if (st === 0 || S.block[st] !== R.id.farmland) return false;
    if (!((rnd || e.rand || Math.random)() < distance - 0.5)) return false;
    if (!(e.living !== false || e.maxHealth !== undefined)) return false;
    if (e !== NS.Player && e.type !== 'player') {
      var C = NS.Commands, g = true;
      if (C && typeof C.ruleGet === 'function') g = C.ruleGet('mobGriefing') === 'true';
      if (!g) return false;
    }
    var ew = e.width !== undefined ? e.width : 0.6, eh = e.height !== undefined ? e.height : 1.8;
    if (!(ew * ew * eh > 0.512)) return false;
    var dirt = R.id.dirt;
    w.set(x, y, z, R.realFirst[dirt] + R.defaultState[dirt]);
    if (e.y < y + 1) e.y = y + 1;
    return true;
  };
  function tickDirt() { return false; }            // dirt is a TARGET of spread, not a source

  // `FarmBlock`: moisture 7 next to water, otherwise it dries one step a tick and turns back
  // into dirt at 0 with nothing planted on it.
  function tickFarmland(x, y, z, st) {
    var moist = prop(st, P.moisture) < 0 ? 0 : +R.valueNames[prop(st, P.moisture)];
    var near = false, dx, dz, dy;
    for (dx = -4; dx <= 4 && !near; dx++) {
      for (dz = -4; dz <= 4 && !near; dz++) {
        for (dy = 0; dy <= 1 && !near; dy++) {
          var s2 = w.get(x + dx, y + dy, z + dz);
          // `getFluidState(p).isIn(WATER)`: a waterlogged block, kelp or seagrass counts (D-168's `waterIn`)
          if (isWater(s2) || (s2 !== 0 && S.waterIn[s2])) near = true;
        }
      }
    }
    if (near) { if (moist !== 7) { w.set(x, y, z, B.setProp(st, 'moisture', 7)); return true; } return false; }
    if (moist > 0) { w.set(x, y, z, B.setProp(st, 'moisture', moist - 1)); return true; }
    var above = w.get(x, y + 1, z);
    // FarmlandBlock.hasCrop: CropBlock || StemBlock (both the `crops` tag) || AttachedStemBlock
    if (above !== 0 && (inCol(col.crops, above) || /^attached_(pumpkin|melon)_stem$/.test(R.names[S.block[above]]))) return false;
    var dirt = R.id.dirt;
    w.set(x, y, z, R.realFirst[dirt] + R.defaultState[dirt]);
    return true;
  }

  /**
   * Sugar cane and cactus: grow to three tall, one step per `age` wrap at 15.
   * #304 audit against .decomp SugarCaneBlock/CactusBlock.randomTick: no draw, no light gate; air above; count the
   * same block downward from 1 (`h < 3` decides identically to vanilla's unbounded walk); age 15 -> new default block
   * above + age 0, else age + 1. Cactus's extra `neighborUpdate` on the new top is `AbstractBlock`'s no-op; survival
   * of the new top next to a solid block is 02k's rule on the World's neighbour pass. Referee: columnrefcheck.
   */
  function tickColumnPlant(x, y, z, st, rnd) {
    var block = S.block[st];
    if (w.get(x, y + 1, z) !== 0) return false;
    var h = 1;
    while (h < 3) { var below = w.get(x, y - h, z); if (below !== 0 && S.block[below] === block) h++; else break; }
    if (h >= 3) return false;
    var age = prop(st, P.age) < 0 ? 0 : +R.valueNames[prop(st, P.age)];
    if (age < 15) { w.set(x, y, z, B.setProp(st, 'age', age + 1)); return true; }
    w.set(x, y, z, B.setProp(st, 'age', 0));
    w.set(x, y + 1, z, R.realFirst[block] + R.defaultState[block]);
    return true;
  }

  // ── #305 (G24b): AbstractPlantStemBlock / AbstractPlantBlock — kelp, twisting, weeping and cave vines ──
  // .decomp/net/minecraft/block/{AbstractPlantStemBlock,AbstractPlantBlock,KelpBlock,TwistingVinesBlock,
  // WeepingVinesBlock,CaveVinesHeadBlock,CaveVinesBodyBlock,VineLogic}.java. The HEAD (`kelp`, `weeping_vines`, ...)
  // carries AGE 0..25 and grows; the BODY (`kelp_plant`, ...) is every cell behind it. Survival (canPlaceAt) is
  // 02k_survive.js's rule 34. [head, body, growth dy, growthChance, getGrowthLength, chooseStemState, berries]
  var STEM_FAMS = [
    ['kelp', 'kelp_plant', 1, 0.14, 'one', 'water', false],               // KelpBlock: 0.14, isOf(WATER), length 1
    ['twisting_vines', 'twisting_vines_plant', 1, 0.1, 'vine', 'air', false],
    ['weeping_vines', 'weeping_vines_plant', -1, 0.1, 'vine', 'air', false],
    ['cave_vines', 'cave_vines_plant', -1, 0.1, 'one', 'air', true]       // CaveVinesHeadBlock: length 1, BERRIES
  ];
  B.STEM_MAX_AGE = 25;                                   // AbstractPlantStemBlock.MAX_AGE (Properties.AGE_25)
  var STEM = null;
  function stemOf(block) {
    if (!STEM) {
      STEM = Object.create(null);
      for (var i = 0; i < STEM_FAMS.length; i++) {
        var f = STEM_FAMS[i], h = R.id[f[0]], p = R.id[f[1]];
        if (h === undefined || p === undefined) continue;
        STEM[h] = STEM[p] = { head: h, body: p, dy: f[2], chance: f[3], len: f[4], choose: f[5], berries: f[6] };
      }
    }
    return STEM[block];
  }
  function stemAge(st) { var v = prop(st, P.age); return v < 0 ? 0 : +R.valueNames[v]; }
  // `chooseStemState`: KelpBlock `isOf(Blocks.WATER)` (any water state), VineLogic.isValidForWeepingStem and
  // CaveVinesHeadBlock `isAir()`
  function chooseStem(r, st) { return r.choose === 'water' ? isWater(st) : S.isAir[st] === 1; }
  // `VineLogic.getGrowthLength`: count draws while `nextDouble() < p`, p *= 0.826 each time
  function growthLength(r, rnd) {
    if (r.len === 'one') return 1;
    var p = 1.0, n = 0;
    for (; rnd() < p; n++) p *= 0.826;
    return n;
  }
  // `copyState`: the plain families take the new state as is; cave vines carry BERRIES across the swap
  function copyStem(r, from, to) { return r.berries ? B.setProp(to, 'berries', B.propName(from, 'berries') === 'true') : to; }
  function defaultOf(block) { return R.realFirst[block] + R.defaultState[block]; }
  // `getRandomGrowthState`: the head's default with AGE = random.nextInt(25)
  function randomGrowthState(r, st, rnd) { return B.setProp(copyStem(r, st, defaultOf(r.head)), 'age', (rnd() * 25) | 0); }
  // `AbstractPlantStemBlock.age`: `cycle(AGE)`; CaveVinesHeadBlock also rolls BERRIES = nextFloat() < 0.11F
  function agedStem(r, st, rnd) {
    var a = stemAge(st);
    var out = B.setProp(st, 'age', a >= B.STEM_MAX_AGE ? 0 : a + 1);
    return r.berries ? B.setProp(out, 'berries', rnd() < 0.11) : out;
  }
  /**
   * `getStateForNeighborUpdate`'s head/body swap, recomputed from the cell in the growth direction (the only
   * direction either class reacts to): a HEAD with its own head or body beyond it becomes the body
   * (AbstractPlantStemBlock), and a BODY with anything else beyond it becomes a head at a random age (AbstractPlantBlock).
   */
  function plantPartShape(st, x, y, z) {
    var r = stemOf(S.block[st]), nb = w.get(x, y + r.dy, z), nbb = nb === 0 ? -1 : S.block[nb];
    var joined = nbb === r.head || nbb === r.body;
    if (S.block[st] === r.head) return joined ? copyStem(r, st, defaultOf(r.body)) : st;
    return joined ? st : randomGrowthState(r, st, B.rng || Math.random);
  }
  // `AbstractPlantStemBlock.randomTick`: `age < 25 && nextDouble() < growthChance` -> the cell in the growth
  // direction, if `chooseStemState`, becomes `age(state)`. The old head turns body through its neighbour update.
  function tickPlantStem(x, y, z, st, rnd) {
    var r = stemOf(S.block[st]);
    if (stemAge(st) >= B.STEM_MAX_AGE || !(rnd() < r.chance)) return false;
    if (!chooseStem(r, w.get(x, y + r.dy, z))) return false;
    w.set(x, y + r.dy, z, agedStem(r, st, rnd));
    return true;
  }
  // `AbstractPlantBlock.getStemHeadPos` = BlockLocating.findColumnEnd: walk the growth direction over the body,
  // and it is a head there or nothing
  function stemHeadY(r, x, y, z) {
    var yy = y, s2;
    do { yy += r.dy; s2 = w.get(x, yy, z); } while (s2 !== 0 && S.block[s2] === r.body);
    return (s2 !== 0 && S.block[s2] === r.head) ? yy : null;
  }
  /** `Fertilizable.isFertilizable` for the four families (bone meal's first question); false for anything else. */
  B.plantStemFertilizable = function (x, y, z) {
    var st = w.get(x, y, z), r = st === 0 ? null : stemOf(S.block[st]);
    if (!r) return false;
    if (r.berries) return B.propName(st, 'berries') !== 'true';      // CaveVinesHead/BodyBlock: !BERRIES
    var hy = S.block[st] === r.head ? y : stemHeadY(r, x, y, z);
    return hy !== null && chooseStem(r, w.get(x, hy + r.dy, z));
  };
  /**
   * `Fertilizable.grow` (`canGrow` is always true for all eight blocks). Cave vines (either part): BERRIES=true.
   * Otherwise AbstractPlantStemBlock.grow on the head (a body finds its head first): up to `getGrowthLength` cells,
   * each `state.with(AGE, min(age+1 .. , 25))`, stopping at the first cell `chooseStemState` refuses.
   */
  B.plantStemGrow = function (x, y, z, rnd) {
    rnd = rnd || B.rng || Math.random;
    var st = w.get(x, y, z), r = st === 0 ? null : stemOf(S.block[st]);
    if (!r) return false;
    if (r.berries) { w.set(x, y, z, B.setProp(st, 'berries', true)); return true; }
    var hy = S.block[st] === r.head ? y : stemHeadY(r, x, y, z);
    if (hy === null) return false;
    var head = w.get(x, hy, z), age = Math.min(stemAge(head) + 1, B.STEM_MAX_AGE), n = growthLength(r, rnd);
    for (var i = 0, py = hy + r.dy; i < n && chooseStem(r, w.get(x, py, z)); i++, py += r.dy) {
      w.set(x, py, z, B.setProp(head, 'age', age));
      age = Math.min(age + 1, B.STEM_MAX_AGE);
    }
    return true;
  };
  B.isPlantStemPart = function (st) { return st !== 0 && !!stemOf(S.block[st]); };

  // `IceBlock.randomTick`: BLOCK light at its OWN cell > 11 - getOpacity (ice's is 1, `atten`), then `melt` = water,
  // always (air only in an ultrawarm dimension). The "over air -> air" rule is `afterBreak`'s, not melting's (meltrefcheck ice-float).
  function tickIce(x, y, z, st) {
    if (w.light(x, y, z) <= 11 - S.atten[st]) return false;
    w.set(x, y, z, fluidState(B.WATER, 8, false));
    return true;
  }
  // #5721 FrostedIceBlock (.decomp): randomTick == scheduledTick. `nextInt(3)==0 || canMelt(4)` (fewer than 4 frosted
  // neighbours), AND getLightLevel > 11 - age - opacity, AND increaseAge. Age 3 melts (IceBlock.melt -> water); a
  // neighbouring frosted_ice that cannot age is rescheduled 20..40. Any failed gate reschedules this cell 20..40.
  function frostedCount(x, y, z, limit) {
    var n = 0;
    for (var d = 0; d < 6; d++) {
      if (S.block[w.get(x + DX[d], y + DY[d], z + DZ[d])] === R.id.frosted_ice && ++n >= limit) return false;
    }
    return true;                                    // canMelt: true while the count stays under `limit`
  }
  B.frostedCanMelt = frostedCount;
  function frostedMelt(x, y, z) { w.set(x, y, z, fluidState(B.WATER, 8, false)); }
  function frostedAge(st, x, y, z) {                 // increaseAge: false = aged one step, true = melted
    var a = +R.valueNames[prop(st, P.age)];
    if (a < 3) { frostQuiet = true; try { w.set(x, y, z, B.setProp(st, 'age', a + 1)); } finally { frostQuiet = false; } return false; }
    frostedMelt(x, y, z); return true;
  }
  function nextInt(rnd, lo, hi) { return lo + Math.floor(rnd() * (hi - lo + 1)); }
  function tickFrostedIce(x, y, z, st, rnd) {
    var age = +R.valueNames[prop(st, P.age)];
    if ((Math.floor(rnd() * 3) === 0 || frostedCount(x, y, z, 4)) && w.lightLevel(x, y, z) > 11 - age - S.atten[st] && frostedAge(st, x, y, z)) {
      for (var d = 0; d < 6; d++) {
        var nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d], ns = w.get(nx, ny, nz);
        if (S.block[ns] === R.id.frosted_ice && !frostedAge(ns, nx, ny, nz)) B.schedule(nx, ny, nz, nextInt(rnd, 20, 40));
      }
    } else B.schedule(x, y, z, nextInt(rnd, 20, 40));
    return true;
  }
  B.frostedTick = function (x, y, z, rnd) {
    var st = w.get(x, y, z);
    if (S.block[st] !== R.id.frosted_ice) return false;
    return tickFrostedIce(x, y, z, st, rnd || B.rng || Math.random);
  };
  // `SnowBlock.randomTick`: BLOCK light > 11 -> `dropStacks(state, world, pos)` + remove. That
  // `dropStacks` has no entity, and snow's table needs one (`entity_properties{}`, 07e_loot), so a
  // melted layer drops NOTHING — not a missing drop (meltdropcheck proves both directions).
  function tickSnow(x, y, z) {
    if (w.light(x, y, z) < 12) return false;
    w.set(x, y, z, 0);
    return true;
  }

  /**
   * `SaplingBlock`: two random ticks to grow. Stage 0 -> 1, then the tree. Placing the tree is
   * PLAN W8's feature pipeline — `Features` is a SHARED module and so is on this thread too —
   * and when it is not reachable the sapling simply stays at stage 1 rather than vanishing.
   */
  function tickSapling(x, y, z, st, rnd) {
    if (w.lightLevel(x, y + 1, z) < 9) return false;   // SaplingBlock.randomTick: getLightLevel(pos.up()) >= 9
    if (rnd() >= 1 / 7) return false;              // vanilla: random.nextInt(7) == 0
    var stage = prop(st, P.stage);
    if (stage >= 0 && R.valueNames[stage] === '0') { w.set(x, y, z, B.setProp(st, 'stage', 1)); return true; }
    B.grownSaplings++;
    return B.growTree(x, y, z, st, rnd);
  }
  B.grownSaplings = 0;
  // SaplingGenerator (#7736): the tree itself, when the feature pipeline is up on this thread; false otherwise.
  B.growTree = function (x, y, z, st, rnd) {
    var F = NS.Features, C = NS.Carvers;
    if (!F || !F.ready || !F.growSapling || !C || !C.Rng) return false;
    var r = new C.Rng((rnd() * 4294967296) | 0, (rnd() * 4294967296) | 0, (rnd() * 4294967296) | 0);
    return B.world ? F.growSapling(B.world, x, y, z, st, r) : false;
  };
  // Azalea / moss bone meal (#9261): a configured feature at (x, y, z); false when the pipeline is not up here.
  B.growFeature = function (name, x, y, z, rnd, clear) {
    var F = NS.Features, C = NS.Carvers;
    if (!F || !F.ready || !F.growFeature || !C || !C.Rng || !B.world) return false;
    var r = new C.Rng((rnd() * 4294967296) | 0, (rnd() * 4294967296) | 0, (rnd() * 4294967296) | 0);
    return F.growFeature(B.world, name, x, y, z, r, clear);
  };
})(MCL);
