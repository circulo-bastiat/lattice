// 14b_physics.js — AABB collision against the voxel world, and the whole locomotion model.
// Main thread only. Touches no DOM and no input device: it takes a movement COMMAND and an
// entity, so it can be reasoned about (and one day replayed) without a keyboard.
//
// Everything in here is expressed PER 20 Hz TICK, in blocks, because that is the unit Minecraft's
// own numbers are quoted in (D-77). Gravity really is 0.08, the jump impulse really is 0.42, and
// a jump really does peak at 1.2522 blocks — copying the units is what makes the feel land for
// free instead of being tuned by hand.

(function (NS) {
  'use strict';

  var Ph = NS.Physics = {
    // --- collider ------------------------------------------------------------
    W: 0.6,            // full width; the box is [x-W/2, x+W/2]
    H: 1.8,            // feet at e.y, head at e.y + H
    EYE: 1.62,
    STEP: 0.6,         // vanilla step height (D-78)

    // ⚠ THE POSES ARE MOJANG'S, NOT A GUESS (D-251). The widths and heights are `Player.POSES`
    // read out of the jar by reflection; the eye heights are the three float constants in
    // `Player.getStandingEyeHeight`'s tableswitch — 0.4 for swimming, fall-flying and spin
    // attack, 1.27 crouching, 1.62 otherwise. Both are in tools/golden/physics-1.18.2.tsv.
    POSE: {
      standing:  { w: 0.6, h: 1.8, eye: 1.62 },
      crouching: { w: 0.6, h: 1.5, eye: 1.27 },
      swimming:  { w: 0.6, h: 0.6, eye: 0.40 },
      sleeping:  { w: 0.2, h: 0.2, eye: 0.20 }
    },

    // --- vanilla per-tick constants -----------------------------------------
    // ⚠ EVERY NUMBER IN THIS BLOCK IS MOJANG'S, READ OUT OF THE 1.18.2 SERVER JAR (D-250/D-251).
    // `LivingEntity.getFrictionInfluencedSpeed(f)` is, in bytecode:
    //     onGround ? getSpeed() * (0.21600002F / (f*f*f)) : flyingSpeed
    // and 0.21600002 is 0.6³ — vanilla's own default friction cubed — so at default friction the
    // acceleration IS the movement-speed attribute, 0.1. `travel` then damps with
    // f1 = onGround ? blockFriction * 0.91 : 0.91, and the steady state of
    // v <- (v + a)·f1 is a/(1−f1) per tick, which is 0.098/0.454 = 0.21586 b/tick = 4.317 b/s.
    // That is vanilla's published walking speed, arrived at from the law rather than fitted to it,
    // and it is why the old `accelFor` fit is gone: it agreed with vanilla at friction 0.6 and
    // nowhere else, so ICE COULD NEVER HAVE BEEN RIGHT under it.
    SPEED: 0.1,              // the MOVEMENT_SPEED attribute a player is created with
    SPRINT_MULT: 1.3,        // sprinting is an attribute modifier, not a different formula
    SNEAK_INPUT: 0.3,        // Player.aiStep scales the INPUT, not the speed
    INPUT_SCALE: 0.98,       // aiStep's `xxa *= 0.98`, and the reason diagonal is 2% faster
    FRICTION_CUBE: 0.21600002,
    GRAVITY: 0.08,
    DRAG_Y: 0.98,
    JUMP: 0.42,
    SPRINT_JUMP_BOOST: 0.2,
    SLIP: 0.6,               // block slipperiness; ground friction is SLIP * 0.91
    AIR_FRICTION: 0.91,
    AIR_ACCEL: 0.02,
    WATER_FRICTION: 0.8,
    WATER_GRAVITY: 0.02,
    SWIM_UP: 0.04,
    FLY_FRICTION: 0.91,
    // PlayerEntity.travel: while flying, vy is reset to (vy before travel) * 0.6, and jump/sneak push
    // flySpeed(0.05) * 3 per tick (a fixed push: sprinting doubles only the horizontal strafe speed).
    FLY_FRICTION_Y: 0.6,
    FLY_VERT_PUSH: 0.15,

    // --- target top speeds, blocks/second. Ground acceleration is DERIVED from these so the
    //     steady state is exactly right rather than approximately right (see accelFor). -------
    WALK: 4.317,
    SPRINT: 5.612,
    SNEAK: 1.30,
    SWIM: 2.20,
    FLY: 10.9,
    FLY_SPRINT: 21.8,

    // Fall damage, from `LivingEntity.calculateFallDamage` in the bytecode:
    //     Mth.ceil((distance - 3.0F - jumpBoostAmplifierPlusOne) * damageMultiplier)
    // ⚠ IT IS ceil, NOT floor. PLAN §G4 says `max(0, floor(distance − 3))` and PLAN is WRONG —
    // the same shape as §25.3, where PLAN's own G3 formula was wrong in three places and the code
    // followed vanilla. A 4.5-block fall is 2 damage in the real game and 1 under PLAN's version.
    FALL_FREE: 3.0,
    JUMP_BOOST_STEP: 0.1,    // getJumpPower() = 0.42 * blockJumpFactor, + 0.1*(level+1)
    CLIMB_CLAMP: 0.15,       // handleOnClimbable clamps all three axes to this

    TICK: 1 / 20,
    EPS: 1e-5,

    // counters, for the debug overlay
    clips: 0
  };

  var CFG = null;   // resolved lazily: no cross-module work at definition time (ARCH §1 rule 2)

  /**
   * Is this voxel a collider?
   *
   * An UNGENERATED column reads as SOLID, not as air (D-73). World.getBlock returns 0 there,
   * and trusting that would drop the player through the floor every time they outran the
   * generator. An invisible wall at the load frontier is a bug you can see and walk away from;
   * falling out of the world is one you cannot recover from.
   */
  Ph.solidAt = function (x, y, z) {
    // Deferred to shapeAt so the two cannot answer differently. They used to be separate
    // copies of the same lookup, which is two places for the ungenerated-column rule above
    // to be got wrong.
    return Ph.shapeAt(x, y, z) !== null;
  };

  /**
   * The collision SHAPE of a voxel: null when it is not a collider, or an array of AABBs in
   * cell-local coordinates (0..1 on each axis).
   *
   * ⚠ THE FAST PATH IS THE POINT. Every one of the 49 blocks the world holds today is a full
   * cube, and so are stone, dirt, deepslate and the ores — the blocks a real world is MADE
   * of. `Ph.FULL_CUBE` is returned by identity for those, and `clip` below tests for that
   * identity and takes exactly the code it always ran. The general path exists for the
   * 1.18.2 roster's slabs, stairs, fences, walls, panes and carpets, whose real per-state
   * AABBs are in `Reg.shapeOf` / `Reg.shapeBox` — 898 blocks and 4,105 distinct shapes,
   * quantised to 1/1024 of a block, which is exact for every multiple of 1/16 vanilla uses.
   *
   * So this cannot have changed how the game collides today, and `tools/physcheck.mjs`
   * asserts that block by block rather than asking anyone to take it on trust.
   */
  Ph.FULL_CUBE = [[0, 0, 0, 1, 1, 1]];

  /**
   * The shape of a block id — and ⚠ **an id in this project is a registry REAL STATE** (D-103).
   *
   * ⚠ D-152 — THIS FUNCTION WAS A STUB UNTIL SESSION 4 AND THE WHOLE GAME COLLIDED AS BOXES.
   * It returned `FULL_CUBE` for every id, ignoring its argument, and its own comment said what
   * to do: *"it is the single line that changes when the world starts storing registry
   * real-state ids: it becomes `Ph.shapesForState(state)` … and slabs become step-onto-able with
   * no other edit."* The world started storing real states in SESSION 2. The line never changed,
   * so for two sessions every slab, stair, fence, carpet, snow layer and flower pot in the game
   * collided as a full cube: you could not step onto a slab, and a fence was a wall.
   * `physcheck` could not see it — it tests `shapesForState`, the function the game did not
   * call, and its first section asserted that `shapesFor` returns FULL_CUBE for everything,
   * which ENSHRINED the stub. `gamecheck` could not see it either, because every collision test
   * it had walked into a wall of stone. It took a test that walks into a SLAB (D-139's lesson,
   * for the third time: a replacement is not done until the thing it replaces is gone).
   */
  Ph.shapesFor = function (id) {
    return Ph.shapesForState(id);
  };
  /** Alias used by 14c_raycast.js, which has an id in hand rather than a position. */
  Ph.shapeOf = function (id) { return Ph.shapesFor(id); };

  // ⚠ ONE ARRAY PER SHAPE, NOT PER CALL. `shapeAt` runs for every cell of every sweep, three
  // sweeps a tick, and the general path used to build a fresh array of fresh arrays each time —
  // which is garbage in the one place this project cannot afford it, and which also made the
  // shapes impossible to compare by identity. The cache is keyed by the SHAPE index rather than
  // by the state, so the 4,105 shapes are shared across all 20,344 states that use them.
  var shapeCache = null;

  /** The AABBs of the shape a registry REAL state collides with, cell-local 0..1. */
  Ph.shapesForState = function (realState) {
    var R = NS.Reg;
    if (!R || !R.ready) return Ph.FULL_CUBE;
    var si = R.shapeOf[realState];
    if (shapeCache === null || shapeCache.length !== R.shapeOff.length) shapeCache = new Array(R.shapeOff.length);
    var hit = shapeCache[si];
    if (hit !== undefined) return hit;
    var a = R.shapeOff[si], b = R.shapeOff[si + 1];
    if (b === a) { shapeCache[si] = null; return null; }   // no collision at all: a flower, a torch
    if (b - a === 1 &&
        R.shapeBox[a * 6] === 0 && R.shapeBox[a * 6 + 1] === 0 && R.shapeBox[a * 6 + 2] === 0 &&
        R.shapeBox[a * 6 + 3] === 1024 && R.shapeBox[a * 6 + 4] === 1024 && R.shapeBox[a * 6 + 5] === 1024) {
      shapeCache[si] = Ph.FULL_CUBE;
      return Ph.FULL_CUBE;                          // identity, so clip takes its fast path
    }
    var out = new Array(b - a);
    for (var i = a; i < b; i++) {
      out[i - a] = [
        R.shapeBox[i * 6] / 1024, R.shapeBox[i * 6 + 1] / 1024, R.shapeBox[i * 6 + 2] / 1024,
        R.shapeBox[i * 6 + 3] / 1024, R.shapeBox[i * 6 + 4] / 1024, R.shapeBox[i * 6 + 5] / 1024
      ];
    }
    shapeCache[si] = out;
    return out;
  };

  /**
   * The shape of the voxel at a world position, or null when it is not a collider.
   *
   * ⚠ An UNGENERATED column is a FULL CUBE, not air (D-73). World.getBlock returns 0 there,
   * and trusting that would drop the player through the floor every time they outran the
   * generator. An invisible wall at the load frontier is a bug you can see and walk away
   * from; falling out of the world is one you cannot recover from. `solidAt` defers to this
   * function so that rule lives in exactly one place.
   */
  Ph.shapeAt = function (x, y, z) {
    if (!CFG) CFG = NS.CFG;
    if (y < CFG.WORLD_MIN_Y) return Ph.FULL_CUBE;
    if (y >= CFG.WORLD_MAX_Y) return null;
    var c = NS.World.get(x >> 4, z >> 4);
    if (!c || c.state < NS.CH.GENERATED) return Ph.FULL_CUBE;
    var ly = y - CFG.WORLD_MIN_Y;
    var id = NS.Section.get(c.sec[ly >> 4], ((ly & 15) << 8) | ((z & 15) << 4) | (x & 15));
    if (id === 0) return null;
    if (ctxE !== null && NS.States.block[id] === powderId()) return powderShape(ctxE, y);
    if (NS.States.solid[id] !== 1) return null;
    return Ph.shapesFor(id);
  };

  // `PowderSnowBlock.getCollisionShape`: the entity being moved decides (null outside Ph.move = empty)
  var ctxE = null, pwId = -1;
  var POWDER_FALL = [[0, 0, 0, 1, 0.9, 1]];
  function powderId() { if (pwId < 0) pwId = NS.Reg.id.powder_snow; return pwId; }
  /** `PowderSnowBlock.canEntityWalkOnPowderSnow` */
  Ph.canWalkOnPowderSnow = function (e) {
    if (e.type === 'rabbit' || e.type === 'endermite' || e.type === 'silverfish' || e.type === 'fox') return true;   // tag powder_snow_walkable_mobs
    var Eq = NS.Equip, IT = NS.Items;
    if (!Eq || !IT) return false;
    var it = Eq.getEquipped(e, IT.FEET);
    return !!it && IT.nameOf(it.i) === 'leather_boots';
  };
  function powderShape(e, cy) {
    if (e.type === 'falling_block' || e.fallDistance > 2.5) return POWDER_FALL;
    if (Ph.canWalkOnPowderSnow(e) && e.y > cy + 1 - 1e-5 && !e.sneaking && !e.crouching) return Ph.FULL_CUBE;
    return null;
  }

  /** The block id at a point, with 0 for anything not loaded. Used for fluid tests. */
  Ph.blockAt = function (x, y, z) {
    return NS.World.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
  };

  /**
   * clip(box, axis, d) -> the largest fraction of d the box may travel before it touches a
   * collider. Sign is preserved. This is the only collision primitive in the project.
   *
   * axis: 0 = X, 1 = Y, 2 = Z. The box is given as six numbers so the caller can probe a
   * hypothetical position without moving anything (the step-up retry needs exactly that).
   */
  function clip(x0, y0, z0, x1, y1, z1, axis, d) {
    if (d === 0) return 0;
    Ph.clips++;
    var E = Ph.EPS;

    // The two axes the box is swept ACROSS: those give the cell rectangle to test.
    var p0, p1, q0, q1, edge, k, end, step;
    if (axis === 0)      { p0 = Math.floor(y0 + E); p1 = Math.floor(y1 - E); q0 = Math.floor(z0 + E); q1 = Math.floor(z1 - E); edge = d > 0 ? x1 : x0; }
    else if (axis === 1) { p0 = Math.floor(x0 + E); p1 = Math.floor(x1 - E); q0 = Math.floor(z0 + E); q1 = Math.floor(z1 - E); edge = d > 0 ? y1 : y0; }
    else                 { p0 = Math.floor(x0 + E); p1 = Math.floor(x1 - E); q0 = Math.floor(y0 + E); q1 = Math.floor(y1 - E); edge = d > 0 ? z1 : z0; }
    if (p1 < p0) p1 = p0;
    if (q1 < q0) q1 = q0;

    // ⚠ D-152 — A SHAPE CAN STICK OUT OF ITS OWN CELL, so the cell rectangle swept ACROSS is one
    // wider on every side than the box. A fence is 1.5 blocks tall: its collision box lives in
    // the fence's own cell and reaches half a block into the cell above, so a player who has
    // jumped to y+1.2 overlaps only the cell ABOVE the fence and — before this — sailed straight
    // over it. `pack-runtime` measures the real range as −0.25 to 1.5 of a cell, which is one
    // cell of slack each way. Every box is overlap-tested below anyway, so the extra cells cost
    // iterations and can never add a collision that is not really there.
    //
    // ⚠ ONLY the two axes swept ACROSS. Widening the SWEPT axis backwards was tried and it
    // stops the player dead: the cell they are already standing in tests as "inside it, or
    // behind", which returns zero distance, and every horizontal speed in `gamecheck` went to 0.
    //
    // ⚠ AND THE FAST PATH MUST NOT SEE THE EXTRA CELLS. A full cube is confined to its own cell
    // by definition, so a full cube in a widened cell can never touch the box — but the fast
    // path returns a hit for any cell it is handed, because in the original rectangle every cell
    // overlaps by construction. Widening without this guard makes the FLOOR one cell below the
    // player collide with every horizontal step: every speed in `gamecheck` went to zero.
    var p0i = p0, p1i = p1, q0i = q0, q1i = q1;
    p0 -= 1; p1 += 1; q0 -= 1; q1 += 1;

    if (d > 0) { k = Math.floor(edge);     end = Math.floor(edge + d); step = 1; }
    else       { k = Math.floor(edge - E); end = Math.floor(edge + d); step = -1; }

    for (; step > 0 ? k <= end : k >= end; k += step) {
      for (var p = p0; p <= p1; p++) {
        for (var q = q0; q <= q1; q++) {
          var cx, cy, cz;
          if (axis === 0)      { cx = k; cy = p; cz = q; }
          else if (axis === 1) { cx = p; cy = k; cz = q; }
          else                 { cx = p; cy = q; cz = k; }

          var shape = Ph.shapeAt(cx, cy, cz);
          if (!shape) continue;
          var widened = (p < p0i || p > p1i || q < q0i || q > q1i);

          // ── the fast path ────────────────────────────────────────────────────────
          // Identity, not a deep compare: shapeAt returns Ph.FULL_CUBE itself for every
          // full cube, which is every block in the world today and every block a world is
          // mostly made of tomorrow. This is byte-for-byte the code that was here before
          // shapes existed.
          if (shape === Ph.FULL_CUBE) {
            if (widened) continue;                 // confined to its own cell — cannot reach
            if (d > 0) { var a = k - edge - E;     return a < 0 ? 0 : a; }
            var b = (k + 1) - edge + E;            return b > 0 ? 0 : b;
          }

          // ── the general path: a slab, a stair, a fence ───────────────────────────
          // The cell is only partly filled, so each box has to be tested for overlap on
          // the two axes being swept ACROSS before its face counts. Skipping that is how
          // a player gets stopped in mid-air beside a slab.
          var best = null;
          for (var bi = 0; bi < shape.length; bi++) {
            var bx = shape[bi];
            var lo0, hi0, lo1, hi1, sLo, sHi;
            if (axis === 0)      { lo0 = cy + bx[1]; hi0 = cy + bx[4]; lo1 = cz + bx[2]; hi1 = cz + bx[5]; sLo = cx + bx[0]; sHi = cx + bx[3]; }
            else if (axis === 1) { lo0 = cx + bx[0]; hi0 = cx + bx[3]; lo1 = cz + bx[2]; hi1 = cz + bx[5]; sLo = cy + bx[1]; sHi = cy + bx[4]; }
            else                 { lo0 = cx + bx[0]; hi0 = cx + bx[3]; lo1 = cy + bx[1]; hi1 = cy + bx[4]; sLo = cz + bx[2]; sHi = cz + bx[5]; }
            var a0, a1, b0, b1;
            if (axis === 0)      { a0 = y0; a1 = y1; b0 = z0; b1 = z1; }
            else if (axis === 1) { a0 = x0; a1 = x1; b0 = z0; b1 = z1; }
            else                 { a0 = x0; a1 = x1; b0 = y0; b1 = y1; }
            if (hi0 <= a0 + E || lo0 >= a1 - E) continue;
            if (hi1 <= b0 + E || lo1 >= b1 - E) continue;
            // ⚠ A box the probe has already PASSED must be skipped, not clamped to zero.
            // The first version clamped a negative distance to 0 and let it win, so a shape
            // with any box above the probe stopped it dead — caught by tools/physcheck.mjs
            // as "with two boxes the nearer must win, moved 0". Clamping only makes sense
            // when the probe is genuinely inside the box, which is the other branch here.
            var t;
            if (d > 0) {
              t = sLo - edge - E;
              if (t < 0) { if (sHi > edge + E) return 0; continue; }   // inside it, or behind
              if (t >= d) continue;                                    // out of reach
              if (best === null || t < best) best = t;
            } else {
              t = (sHi - edge) + E;
              if (t > 0) { if (sLo < edge - E) return 0; continue; }
              if (t <= d) continue;
              if (best === null || t > best) best = t;
            }
          }
          if (best !== null) return best;
          continue;
        }
      }
    }
    return d;
  }
  Ph.clip = clip;

  /** True when a collider sits within `depth` blocks under the box at (x, y, z). */
  function grounded(x, y, z, depth) {
    var hw = Ph.W * 0.5;
    return clip(x - hw, y, z - hw, x + hw, y + Ph.H, z + hw, 1, -depth) > -depth + 1e-9;
  }
  Ph.grounded = grounded;

  /**
   * `clip` plus every OTHER live shulker's hitbox as a solid box (`ShulkerEntity.isCollidable()` =
   * isAlive, #657): the grown lid box is an obstacle to the player and to mobs, exactly as an
   * `Entity.collectColliders` entity box is. Returns the resolved (signed) displacement.
   */
  /** `BoatEntity/AbstractMinecartEntity.isCollidable()` (#5346). */
  Ph.solidVehicle = function (o) {
    return !o.dead && !o.removed && (o.type === 'boat' || (o.type && o.type.indexOf('minecart') >= 0));
  };
  Ph.vehicleBox = function (o) {
    var d = NS.Entities.dimensions(o.type), hw = d.width * 0.5;
    return [o.x - hw, o.y, o.z - hw, o.x + hw, o.y + d.height, o.z + hw];
  };
  /** `Entity.isConnectedThroughVehicle`: same root vehicle, or one is the other's ancestor. */
  Ph.connectedThroughVehicle = function (a, b) {
    var ra = a, rb = b, n = 0;
    while (ra && ra.vehicle && n++ < 16) ra = ra.vehicle;
    n = 0;
    while (rb && rb.vehicle && n++ < 16) rb = rb.vehicle;
    return ra === rb;
  };
  function clipE(self, x0, y0, z0, x1, y1, z1, axis, d) {
    var r = clip(x0, y0, z0, x1, y1, z1, axis, d);
    var EL = NS.EntityList, Sh = NS.Shulker;
    if (!EL || !EL.list || d === 0) return r;
    var lo = [x0, y0, z0], hi = [x1, y1, z1];
    for (var i = 0; i < EL.list.length; i++) {
      var o = EL.list[i];
      if (o === self) continue;
      var b;
      if (o.type === 'shulker') { if (!Sh || !Sh.boundingBox || !Sh.isCollidable(o)) continue; b = Sh.boundingBox(o); }
      else if (Ph.solidVehicle(o) && !Ph.connectedThroughVehicle(self, o)) b = Ph.vehicleBox(o);
      else continue;
      var ok = true;
      for (var a = 0; a < 3; a++) {
        if (a !== axis && (hi[a] <= b[a] + 1e-9 || lo[a] >= b[a + 3] - 1e-9)) { ok = false; break; }
      }
      if (!ok) continue;
      if (d > 0) { if (hi[axis] <= b[axis] + 1e-9) { var g = b[axis] - hi[axis]; if (g < r) r = g; } }
      else if (lo[axis] >= b[axis + 3] - 1e-9) { var g2 = b[axis + 3] - lo[axis]; if (g2 > r) r = g2; }
    }
    return r;
  }

  /**
   * `Entity.slowMovement(state, multiplier)` (#1344): cobweb's onEntityCollision calls it with
   * (0.25, 0.05, 0.25); `SpiderEntity.slowMovement` skips it for cobweb (spider + cave_spider).
   * Also resets fallDistance, as CobwebBlock/Entity.slowMovement does.
   */
  Ph.slowMovement = function (e, mult, isCobweb) {
    if (e.type === 'wither') return;   // WitherEntity.slowMovement is an empty override (#1580)
    if (isCobweb && (e.type === 'spider' || e.type === 'cave_spider')) return;
    e.fallDistance = 0;
    e.movementMultiplier = mult;
  };

  /**
   * move(e, dx, dy, dz) — resolve one displacement against the world.
   *
   * Y first, then X, then Z. Y first is what makes `onGround` true before the horizontal pass
   * runs, which is what lets the horizontal pass know whether it is allowed to step up. Resolving
   * the three axes independently (rather than one swept box) is what stops the classic corner
   * snag, where a box grazing a block edge gets pushed sideways instead of sliding.
   */
  Ph.move = function (e, dx, dy, dz) {
    var prev = ctxE;
    ctxE = e;
    try { return moveInner(e, dx, dy, dz); } finally { ctxE = prev; }
  };
  function moveInner(e, dx, dy, dz) {
    if (e.noclip) { e.x += dx; e.y += dy; e.z += dz; e.onGround = false; return; }
    // `Entity.move` head: a pending movementMultiplier (set by last move's checkBlockCollision,
    // `Ph.slowMovement`) scales this move and zeroes the velocity, then clears itself (#1344).
    var mm = e.movementMultiplier;
    if (mm) {
      e.movementMultiplier = null;
      dx *= mm[0]; dy *= mm[1]; dz *= mm[2];
      e.vx = 0; e.vy = 0; e.vz = 0;
    }
    // ⚠ THE BOX IS NOT A CONSTANT ANY MORE (D-251). A crouching player is 0.6 x 1.5, from
    // `Player.POSES` in the jar — 1.8 standing, 1.5 crouching, 0.6 swimming — and a collider that
    // is always 1.8 tall is why you could not crouch into a one-block gap.
    // ⚠ THE WIDTH IS THE ENTITY'S, AND IT USED NOT TO BE (D-308). This function took `e.height`
    // from the entity and the WIDTH from `Ph.W` — the player's 0.6 — so it was entity-shaped in
    // its signature and player-shaped in its collider. Nothing noticed while the only thing that
    // moved was the player; a 0.98-wide falling block would have fallen down a 0.7 gap. The
    // fallback keeps every existing caller exactly where it was: the player sets no `e.width`.
    var hw = (e.width !== undefined ? e.width : Ph.W) * 0.5, h = e.height || Ph.H;
    var wasOnGround = e.onGround, x00 = e.x, y00 = e.y, z00 = e.z;

    e.onGround = false;

    // --- Y ------------------------------------------------------------------
    var my = clipE(e, e.x - hw, e.y, e.z - hw, e.x + hw, e.y + h, e.z + hw, 1, dy);
    e.y += my;
    // `Entity.verticalCollision` (vanilla's own field, mirroring `horizontalCollision` a few
    // lines below) — s116: a stuck arrow's own embedding test (`Cb.tickArrow`, 14j_combat.js)
    // needs to know a Y move was blocked EITHER way (a ceiling as well as a floor), not just
    // the downward `onGround` case a few lines below already answers.
    e.verticalCollision = (my !== dy);
    var landedVy = e.vy;
    if (dy < 0 && my > dy + 1e-9) { e.onGround = true; e.vy = 0; }
    else if (dy > 0 && my < dy - 1e-9) e.vy = 0;

    // ── fall distance, exactly as `Entity.move` keeps it ──────────────────────────────────
    // on the ground it is zero; in the air it accumulates the DISTANCE ACTUALLY FALLEN, which is
    // `my` and not `dy`: a player who lands mid-tick fell the shorter of the two.
    if (e.fallDistance === undefined) e.fallDistance = 0;
    if (e.onGround) {
      // ⚠ LANDING EFFECTS ARE A **LIVING** ENTITY'S, AND THIS USED TO APPLY THEM TO ANYTHING
      // (D-308). `Ph.landed` is fall damage, the slime bounce and the bed bounce — vanilla puts
      // all of it in `LivingEntity.checkFallDamage`, and base `Entity.checkFallDamage` only
      // resets the counter. Calling it for a falling block or a stick of TNT is not a small
      // wrongness: it reads the block below through `NS.World`, which a headless fixture does
      // not have, and it would damage an entity that has no health to lose. `e.living === false`
      // opts out; the player sets nothing and is unchanged.
      // ⚠ KW-34 (s136, referee reds): `EL.spawn` (07i_entitylist.js) hard-codes `living: false`
      // on EVERY spawned entity today (that file is another worker's this pass, not fixed here) --
      // so `e.living !== false` alone never once fired for a mob and every mob took zero fall
      // damage. `e.maxHealth !== undefined` is the SAME closed set `Ent.isLiving`/`Cb.tickEntity`
      // already gate on (D-336: exactly the 74/113 types the jar calls a LivingEntity), so it is
      // a correct fallback signal here -- items/arrows/boats/TNT have no `maxHealth` and stay
      // excluded exactly as `e.living === false` always meant to exclude them.
      // `LivingEntity.fall`: `if (!isTouchingWater()) checkWaterState()` -> onLanding() BEFORE the landing check,
      // so touching down in water (same tick as entering it) banks no fall damage.
      if (!(NS.EntityList && NS.EntityList.WATER_LANDS === false) && e.fallDistance > 0 && Ph.blockAt(e.x, e.y + 0.4, e.z) === NS.States.stateOf('water')) { Ph.playerLanding(e); e.fallDistance = 0; }
      if (e.fallDistance > 3 && (e.living !== false || e.maxHealth !== undefined) && NS.Particle && NS.Particle.spawnLandingDust) NS.Particle.spawnLandingDust(e, Ph.blockAt(e.x, e.y - 0.2, e.z));
      if (e.fallDistance > 0 && (e.living !== false || e.maxHealth !== undefined)) Ph.landed(e, e.fallDistance, landedVy);
      if (e !== NS.Player && e.maxHealth !== undefined && e.pendingFallDamage && NS.Combat && NS.Combat.spendFall) NS.Combat.spendFall(e);   // vanilla hurts in the landing tick
      // #1253 TurtleEggBlock.onLandedUpon (1/3) on landing, onSteppedOn (1/100) every grounded move.
      if (NS.Turtle && NS.Turtle.eggSteppedOn && NS.World && NS.World.getBlock && NS.Reg && NS.Reg.id) {
        var egx = Math.floor(e.x), egy = Math.floor(e.y - 0.2), egz = Math.floor(e.z);
        if (NS.Reg.id.turtle_egg !== undefined) {
          if (e.fallDistance > 0) NS.Turtle.eggLandedUpon(e, egx, egy, egz);
          NS.Turtle.eggSteppedOn(e, egx, egy, egz);
        }
      }
      Ph.playerLanding(e);
      e.fallDistance = 0;
    } else if (my < 0 && !(e.inWater && !(NS.EntityList && NS.EntityList.WATER_LANDS === false))) {
      e.fallDistance -= my;
      if (e === NS.Player && e.fallStartPos == null) e.fallStartPos = [e.x, e.y, e.z];   // ServerPlayerEntity.tickFallStartPos
    }
    // `SlimeBlock.onEntityLand` / `onSteppedOn`: a NON-living entity rebounds at 0.8x (`bounce`'s
    // `instanceof LivingEntity ? 1.0 : 0.8`; living ones go through Ph.landed at 1.0), and any
    // entity standing on slime with |vy| < 0.1 that is not sneaking has its x/z scaled by 0.4+|vy|*0.2.
    if (e.onGround && NS.Reg && NS.Reg.names && NS.Reg.names[blockIdAt(e.x, e.y - 0.2, e.z)] === 'slime_block') {
      var sneaky = e.edgeGuard || e.crouching;
      if (!wasOnGround && !sneaky && landedVy < 0 && !(e.living !== false || e.maxHealth !== undefined)) e.bounceVy = -landedVy * 0.8;
      var sv = Math.abs(landedVy);
      if (sv < 0.1 && !sneaky) { var sk = 0.4 + sv * 0.2; e.vx *= sk; e.vz *= sk; }
    }
    if (!wasOnGround && e.onGround && e.bounceVy) { e.vy = e.bounceVy; e.bounceVy = 0; e.onGround = false; }

    // --- X, Z ---------------------------------------------------------------
    var ox = e.x, oz = e.z, oy = e.y;
    var mx = clipE(e, e.x - hw, e.y, e.z - hw, e.x + hw, e.y + h, e.z + hw, 0, dx);
    var WBd = NS.World && NS.World.border;
    if (WBd) mx = WBd.clipAxis(e.x, hw, mx, 0);   // G17 border shape
    e.x += mx;
    var mz = clipE(e, e.x - hw, e.y, e.z - hw, e.x + hw, e.y + h, e.z + hw, 2, dz);
    if (WBd) mz = WBd.clipAxis(e.z, hw, mz, 2);
    e.z += mz;
    if (mx !== dx) e.vx = 0;
    if (mz !== dz) e.vz = 0;
    // ⚠ `Entity.horizontalCollision` (D-401) — bytecode-read off `axk`'s own collision-
    // resolution method: `(xCollided || zCollided)`, xCollided/zCollided each "the resolved
    // delta on this axis is not the one asked for". `mx !== dx`/`mz !== dz` above are that same
    // comparison, already computed for the velocity-zeroing two lines up; this just keeps the
    // OR of them on the entity for whatever reads collision state later in the same tick —
    // today, only `Ph.onClimbable`'s spider branch.
    e.horizontalCollision = (mx !== dx) || (mz !== dz);

    // --- step up ------------------------------------------------------------
    // Only when something actually blocked us AND we were standing on something. Retries the
    // whole horizontal move from a position raised by STEP, then drops back down; keeps it only
    // if it got further. With nothing but full cubes in the block table STEP = 0.6 never clears
    // anything, which is correct — vanilla makes you jump too (D-78).
    var stepH = e.stepHeight !== undefined ? e.stepHeight : Ph.STEP;   // #994: DrownedEntity.stepHeight = 1.0
    if (stepH > 0 && e.onGround && (mx !== dx || mz !== dz)) {
      var d1 = mx * mx + mz * mz;
      var sx = e.x, sz = e.z;
      e.x = ox; e.z = oz;
      var up = clipE(e, e.x - hw, e.y, e.z - hw, e.x + hw, e.y + h, e.z + hw, 1, stepH);
      e.y += up;
      var mx2 = clipE(e, e.x - hw, e.y, e.z - hw, e.x + hw, e.y + h, e.z + hw, 0, dx);
      e.x += mx2;
      var mz2 = clipE(e, e.x - hw, e.y, e.z - hw, e.x + hw, e.y + h, e.z + hw, 2, dz);
      e.z += mz2;
      var down = clipE(e, e.x - hw, e.y, e.z - hw, e.x + hw, e.y + h, e.z + hw, 1, -up);
      e.y += down;
      if (mx2 * mx2 + mz2 * mz2 > d1 + 1e-9) { if (down > -up) e.onGround = true; }
      else { e.x = sx; e.z = sz; e.y = oy; }
    }

    // --- sneak edge guard ---------------------------------------------------
    // Vanilla refuses a horizontal move that would take a sneaking player off a ledge. It is a
    // two-line test here and it is the difference between "this feels like Minecraft" and "why
    // did I just fall in the hole I was digging".
    if (e.edgeGuard && e.onGround && !grounded(e.x, e.y, e.z, 0.6)) {
      if (e.x !== ox && grounded(ox, e.y, e.z, 0.6))      { e.x = ox; e.vx = 0; }
      else if (e.z !== oz && grounded(e.x, e.y, oz, 0.6)) { e.z = oz; e.vz = 0; }
      else { e.x = ox; e.z = oz; e.vx = 0; e.vz = 0; }
    }
    // `Entity.move`: the position only changes when the collision-resolved movement has lengthSqr > 1.0E-7 (a
    // slow slide stops dead). Entities with a `ground` table (item, TNT, falling block...) only: mobs/player unchanged.
    if (e.ground) {
      var rx = e.x - x00, ry = e.y - y00, rz = e.z - z00;
      if (rx * rx + ry * ry + rz * rz <= 1.0E-7) { e.x = x00; e.y = y00; e.z = z00; }
    }
    // `Entity.move`'s `tryCheckBlockCollision()` — plates and wooden buttons (14l_use.js).
    if (NS.Use && NS.Use.entityCollide) NS.Use.entityCollide(e);
  }

  /**
   * pose(e, cmd) — pick the collider and the eye height for this tick.
   *
   * ⚠ A CROUCHING PLAYER IS 1.5 TALL, NOT 1.8, and until this existed there was no way to crouch
   * under a slab. The collider must not GROW into a block, though: a player who crouched into a
   * one-block gap and let go of shift would otherwise be pushed through the ceiling, so standing
   * back up is refused while there is something in the way — vanilla's own rule.
   */
  Ph.poseFits = function (e, pose) {
    // `Entity.wouldPoseNotCollide`: the pose's box at the feet, contracted by 1e-7, hits nothing.
    var hw = pose.w * 0.5 - 1e-7, y0 = e.y + 1e-7, y1 = e.y + pose.h - 1e-7;
    return clip(e.x - hw, y0, e.z - hw, e.x + hw, y1, e.z + hw, 0, 1e-5) >= 1e-5 - 1e-12;
  };

  Ph.pose = function (e, cmd) {
    // ⚠ `crouching` IS PUBLISHED, because vanilla's `isSecondaryUseActive()` is what decides
    // whether a right-click reaches the BLOCK or the ITEM (D-361) — building against a chest
    // rather than opening it. It is set from the same condition the pose is, so the two can
    // never disagree.
    e.crouching = !!(cmd && cmd.sneak && !e.flying && !e.inWater && !e.swimming && !e.fallFlying);
    // `Player.updatePose` priority: fall-flying, swimming, crouching, standing (swim and glide
    // are both the 0.6 box; only the eye height differs in name, not in value: 0.4 for both)
    var P = Ph.POSE, SW = P.swimming;
    // `PlayerEntity.updatePose`: the wanted pose, else CROUCHING if that fits, else SWIMMING. The
    // pose is a pure function of state (no hysteresis): `Entity.wouldPoseNotCollide` is the test.
    var want = e.fallFlying ? SW : e.swimming ? SW : e.crouching ? P.crouching : P.standing;
    if (!e.vehicle && !e.spectator && want !== SW && !Ph.poseFits(e, want)) want = Ph.poseFits(e, P.crouching) ? P.crouching : SW;
    e.height = want.h;
    e.eyeHeight = want.eye;
  };

  /**
   * Ground acceleration that reaches exactly `topPerSec` at steady state.
   *
   * A tick is: v += a  ->  MOVE by v  ->  v *= f. The distance actually travelled is therefore
   * the velocity BEFORE the damping, and at steady state that is a/(1-f), not a*f/(1-f). So
   * a = v_target_per_tick * (1 - f).
   *
   * Sanity check against vanilla: WALK 4.317 b/s is 0.21585 b/tick, ground friction is
   * 0.6*0.91 = 0.546, so a = 0.21585 * 0.454 = 0.0980 — which is vanilla's 0.1 movement-speed
   * attribute, arrived at from the other end. The numbers in this file are the real ones.
   */
  function accelFor(topPerSec, f) {
    return (topPerSec / 20) * (1 - f);
  }
  Ph.accelFor = accelFor;

  /**
   * The three per-block movement fields, looked up the way vanilla looks them up (D-250).
   *
   * ⚠ `getBlockPosBelowThatAffectsMyMovement` is NOT "the block under your feet" — it is the
   * block at y − 0.5000001, which is why standing on a slab still gives you the slab's friction
   * and why a player half a pixel above the ground still slides on ice.
   *
   * `getBlockSpeedFactor` is stranger and the bytecode is the only place it is written down: it
   * reads the speed factor of the block the entity is INSIDE, and only if that is exactly 1.0
   * does it fall back to the block below. Soul sand slows you when you stand IN it; honey slows
   * you when you stand ON it. One rule, both behaviours.
   */
  function blockIdAt(x, y, z) {
    var st = Ph.blockAt(x, y, z);
    return NS.States && NS.States.block ? NS.States.block[st] : 0;
  }
  Ph.blockIdAt = blockIdAt;

  Ph.frictionOf = function (e) {
    var R = NS.Reg;
    if (!R || !R.friction) return Ph.SLIP;
    return R.friction[blockIdAt(e.x, e.y - 0.5000001, e.z)] || Ph.SLIP;
  };

  Ph.speedFactorOf = function (e) {
    var R = NS.Reg;
    if (!R || !R.speedFactor) return 1;
    if (e.inventory && NS.SoulSpeed && NS.SoulSpeed.negatesSlowdown(e)) return 1;   // #5769 LivingEntity.getVelocityMultiplier
    var here = R.speedFactor[blockIdAt(e.x, e.y, e.z)];
    if (here === undefined) return 1;
    if (here !== 1) return here;
    var below = R.speedFactor[blockIdAt(e.x, e.y - 0.5000001, e.z)];
    return below === undefined ? 1 : below;
  };

  Ph.jumpFactorOf = function (e) {
    var R = NS.Reg;
    if (!R || !R.jumpFactor) return 1;
    var here = R.jumpFactor[blockIdAt(e.x, e.y, e.z)];
    if (here === undefined) return 1;
    if (here !== 1) return here;
    var below = R.jumpFactor[blockIdAt(e.x, e.y - 0.5000001, e.z)];
    return below === undefined ? 1 : below;
  };

  /**
   * fallDamage(distance, multiplier, jumpBoostLevel) — vanilla's own arithmetic.
   * `multiplier` is the landing block's: 1 for ordinary ground, 0.2 for hay and honey, 0 for
   * slime and for a player who lands in water. ⚠ The multiplier TABLE is hand-sourced — it lives
   * in each block's `fallOn` override rather than in a field — and is marked as such (D-251).
   */
  Ph.fallDamage = function (distance, multiplier, jumpBoost) {
    var free = Ph.FALL_FREE + (jumpBoost ? (jumpBoost | 0) : 0);
    return Math.max(0, Math.ceil((distance - free) * (multiplier === undefined ? 1 : multiplier)));
  };

  // ── #295 G23c: THE FOUR MOVEMENT EFFECTS' READS in `LivingEntity.travel`/`jump`/
  // `computeFallDamage` (.decomp LivingEntity.java:1482-1486, 1977-1987, 2011-2143), off the
  // status-effect store (07q_effects.js). Every travel law below (player land/water, mob land/
  // water) asks these, never the store directly, so the formula lives in exactly one place.
  function effAmp(e, name) {
    var ES = NS.Effects;
    return ES && ES.amplifierOf && e && e.effects ? ES.amplifierOf(e, name) : -1;
  }
  /** Jump Boost's `amplifier + 1` (0 without it) — `computeFallDamage`'s free blocks. */
  Ph.jumpBoostLevel = function (e) { return effAmp(e, 'jump_boost') + 1; };
  /** `getJumpBoostVelocityModifier`: `(double)(0.1F * (float)(amp + 1))` — the product in FLOAT. */
  Ph.jumpBoostVelocity = function (e) {
    var lvl = Ph.jumpBoostLevel(e);
    return lvl > 0 ? Math.fround(Math.fround(Ph.JUMP_BOOST_STEP) * lvl) : 0;
  };
  /** travel's head: `d = 0.08; if (vy <= 0 && hasStatusEffect(SLOW_FALLING)) { d = 0.01; onLanding(); }`
   *  — read on the velocity travel STARTS with (after the jump), and `onLanding` zeroes fallDistance. */
  Ph.SLOW_FALL_GRAVITY = 0.01;
  Ph.travelGravity = function (e) {
    if (e.vy <= 0 && effAmp(e, 'slow_falling') >= 0) { e.fallDistance = 0; return Ph.SLOW_FALL_GRAVITY; }
    return Ph.GRAVITY;
  };
  /** The land branch's gravity step: levitation REPLACES gravity with `vy += (0.05*(amp+1) - vy)*0.2`
   *  (and `onLanding()`); otherwise `vy -= d` unless `hasNoGravity()`. The 0.98 drag is the caller's. */
  Ph.LEVITATION_STEP = 0.05;
  Ph.landGravity = function (e, g) {
    var lev = effAmp(e, 'levitation');
    if (lev >= 0) { e.vy += (Ph.LEVITATION_STEP * (lev + 1) - e.vy) * 0.2; e.fallDistance = 0; }
    else if (!e.noGravity) e.vy -= g;
  };
  /** The water branch's horizontal slowdown: `if (hasStatusEffect(DOLPHINS_GRACE)) f = 0.96F`,
   *  AFTER sprint/depth strider chose theirs; the vertical 0.8F never changes. */
  Ph.DOLPHIN_SLOWDOWN = 0.96;
  Ph.waterSlowdown = function (e, f) { return effAmp(e, 'dolphins_grace') >= 0 ? Ph.DOLPHIN_SLOWDOWN : f; };

  /** Fluid tests. Feet-deep counts as "in water"; the eye test drives the screen tint. */
  /** `isSubmergedIn(WATER)`: any water fluid state at the eye (flowing, kelp, waterlogged, bubble column). */
  Ph.eyeWater = function (e, h) {
    var es = Ph.blockAt(e.x, e.y + h, e.z);
    e.eyeInWater = es !== 0 && NS.States.waterIn[es] === 1;
    if (e.eyeInWater && e !== NS.Player && NS.Weather && NS.Weather.fluidHeight) {   // Entity.updateWaterSubmersionState: eyeY - 1/9 under the surface
      var ey = e.y + h, by = Math.floor(ey);
      if (ey - 0.11111111 >= by + NS.Weather.fluidHeight(Math.floor(e.x), by, Math.floor(e.z))) e.eyeInWater = false;
    }
    e.eyeInBubble = NS.States.block[es] === NS.Reg.id.bubble_column;   // baseTick: no air loss there
  };
  Ph.updateFluids = function (e) {
    var W = NS.States.stateOf('water');
    // any water FLUID state (flowing, kelp/seagrass, waterlogged, bubble column), as `isTouchingWater`
    var fs = Ph.blockAt(e.x, e.y + 0.4, e.z);
    var wasIn = e.inWater;
    e.inWater  = fs !== 0 && NS.States.waterIn[fs] === 1;
    if (e.inWater && !(NS.EntityList && NS.EntityList.WATER_LANDS === false)) e.fallDistance = 0;   // Entity.checkWaterState -> onLanding()
    if (e.inWater && wasIn === false && e === NS.Player && NS.Sound) {   // Entity.onSwimmingStart (player 0.2 factor)
      var sv = Math.min(1, Math.sqrt((e.vx || 0) * (e.vx || 0) * 0.2 + (e.vy || 0) * (e.vy || 0) + (e.vz || 0) * (e.vz || 0) * 0.2) * 0.2);
      NS.Sound.play(sv < 0.25 ? 'entity.player.splash' : 'entity.player.splash.high_speed', { volume: sv,
        pitch: 1 + (Math.random() - Math.random()) * 0.4, x: e.x, y: e.y, z: e.z, source: 'player', listener: e });
    }
    Ph.eyeWater(e, Ph.EYE);
    e.eyeInLava = NS.States.block[Ph.blockAt(e.x, e.y + Ph.EYE, e.z)] === NS.Reg.id.lava;
    e.inLava   = NS.States.block[Ph.blockAt(e.x, e.y + 0.4, e.z)] === NS.Reg.id.lava;
    Ph.fluidPush(e);
    Ph.spawnSprintingParticles(e);
    return e;
  };

  /** `Entity.baseTick`: `if (isSprinting() && !isTouchingWater()) spawnSprintingParticles()` — block dust of the
   *  landing block (feet - 0.2) at the entity's feet, velocity (-vx*4, 1.5, -vz*4); invisible shapes spawn none. */
  Ph.spawnSprintingParticles = function (e) {
    if (!e.sprinting || e.inWater || !NS.Particle || !NS.Particle.spawnBlockDust) return;
    var bx = Math.floor(e.x), by = Math.floor(e.y - 0.20000000298023224), bz = Math.floor(e.z);
    var st = NS.World.getBlock(bx, by, bz);
    if (!st) return;
    var r = e.rand || Math.random, w = e.width !== undefined ? e.width : Ph.W;
    NS.Particle.spawnBlockDust(e.x + (r() - 0.5) * w, e.y + 0.1, e.z + (r() - 0.5) * w,
      -(e.vx || 0) * 4, 1.5, -(e.vz || 0) * 4, st, bx, by, bz, r);
  };

  /** `isPushedByFluids() == false`: TurtleEntity, AxolotlEntity, every WaterCreatureEntity (fish, squid,
   *  glow squid, dolphin); a flying player (PlayerEntity). */
  Ph.NOT_PUSHED = { turtle: 1, axolotl: 1, cod: 1, salmon: 1, pufferfish: 1, tropical_fish: 1,
                    squid: 1, glow_squid: 1, dolphin: 1 };
  Ph.WATER_PUSH = 0.014; Ph.LAVA_PUSH = 0.0023333333333333335;

  /** FluidState.getHeight() of the fluid kind `k` in a cell (0 when it holds none or another kind). */
  function fluidH(k, x, y, z) {
    var st = Ph.blockAt(x, y, z), SR = NS.States;
    return SR.fluidKind[st] === k ? SR.fluidAmt[st] / 9 : 0;
  }
  /** FlowableFluid.getVelocity (.decomp FlowableFluid.java:53) for the fluid cell at (x,y,z); writes [vx,vz] into out. */
  function flowVec(k, x, y, z, out) {
    var SR = NS.States, DX = [-1, 0, 1, 0], DZ = [0, -1, 0, 1], i, vx = 0, vz = 0;
    var own = fluidH(k, x, y, z);
    for (i = 0; i < 4; i++) {
      var nx = x + DX[i], nz = z + DZ[i], nst = Ph.blockAt(nx, y, nz), kk = SR.fluidKind[nst];
      if (kk !== 0 && kk !== k) continue;                        // isEmptyOrThis
      var h = kk ? SR.fluidAmt[nst] / 9 : 0, d = 0;
      if (h === 0) {
        if (!SR.solidMat[SR.block[nst]]) {                       // !material.blocksMovement()
          var bst = Ph.blockAt(nx, y - 1, nz), bk = SR.fluidKind[bst];
          if (bk === 0 || bk === k) {
            h = bk ? SR.fluidAmt[bst] / 9 : 0;
            if (h > 0) d = Math.fround(own - (h - 0.8888889));
          }
        }
      } else d = Math.fround(own - h);
      if (d !== 0) { vx += DX[i] * d; vz += DZ[i] * d; }
    }
    var vy = 0;
    if (SR.fluidAmt[Ph.blockAt(x, y, z)] === 8 && Ph.blockAt(x, y + 1, z) !== 0 && SR.fluidKind[Ph.blockAt(x, y + 1, z)] === k) {
      // FALLING: a solid side wall bends the flow down. ponytail: solidAt stands in for isSideSolidFullSquare
      for (i = 0; i < 4; i++) {
        if (SR.fluidKind[Ph.blockAt(x + DX[i], y, z + DZ[i])] !== k && (Ph.solidAt(x + DX[i], y, z + DZ[i]) || Ph.solidAt(x + DX[i], y + 1, z + DZ[i]))) {
          var l = Math.sqrt(vx * vx + vz * vz) || 1; vx /= l; vz /= l; vy = -6; break;
        }
      }
    }
    var len = Math.sqrt(vx * vx + vy * vy + vz * vz);
    out[0] = len ? vx / len : 0; out[1] = len ? vz / len : 0;
  }
  var _fv = [0, 0];
  /**
   * `Entity.updateMovementInFluid` (Entity.java:2804): the flow push of water (0.014) and lava (0.0023333).
   * Only the horizontal part is applied here; the downward vy of a falling column is left to gravity.
   * ponytail: no 0.007 ultrawarm lava factor (Nether) - needs the dimension here.
   */
  Ph.fluidPush = function (e) {
    if (!NS.States.fluidKind || Ph.NOT_PUSHED[e.type] || (e.type === 'drowned' && e.swimming) || e.flying || e.vehicle || e.removed) return;
    var SR = NS.States, w = (e.width !== undefined ? e.width : Ph.W), h = e.height || Ph.H, hw = w * 0.5 - 0.001;
    var minY = e.y + 0.001, x0 = Math.floor(e.x - hw), x1 = Math.ceil(e.x + hw),
        y0 = Math.floor(minY), y1 = Math.ceil(e.y + h - 0.001), z0 = Math.floor(e.z - hw), z1 = Math.ceil(e.z + hw);
    for (var pass = 0; pass < 2; pass++) {
      var k = pass ? 2 : 1, depth = 0, sx = 0, sz = 0, n = 0;
      for (var x = x0; x < x1; x++) for (var y = y0; y < y1; y++) for (var z = z0; z < z1; z++) {
        if (SR.fluidKind[Ph.blockAt(x, y, z)] !== k) continue;
        var top = y + (SR.fluidKind[Ph.blockAt(x, y + 1, z)] === k ? 1 : SR.fluidAmt[Ph.blockAt(x, y, z)] / 9);
        if (top < minY) continue;
        depth = Math.max(top - minY, depth);
        flowVec(k, x, y, z, _fv);
        var m = depth < 0.4 ? depth : 1;
        sx += _fv[0] * m; sz += _fv[1] * m; n++;
      }
      var len = Math.sqrt(sx * sx + sz * sz);
      if (!(len > 0)) continue;
      sx /= n; sz /= n;
      if (e.type !== 'player') { len = Math.sqrt(sx * sx + sz * sz); sx /= len; sz /= len; }
      var f = k === 1 ? Ph.WATER_PUSH : Ph.LAVA_PUSH;
      sx *= f; sz *= f;
      var l2 = Math.sqrt(sx * sx + sz * sz);
      if (Math.abs(e.vx) < 0.003 && Math.abs(e.vz) < 0.003 && l2 < 0.0045) { sx = sx / l2 * 0.0045; sz = sz / l2 * 0.0045; }
      e.vx += sx; e.vz += sz;
    }
  };

  /**
   * tick(e, cmd) — one 20 Hz step.
   *
   * cmd = { fwd:-1..1, strafe:-1..1, jump:bool, sneak:bool, sprint:bool }
   * `fwd`/`strafe` are relative to e.yaw. Nothing here reads the keyboard.
   */
  Ph.tick = function (e, cmd) {
    Ph.updateFluids(e);
    Ph.updateSwimming(e, cmd);
    Ph.updateFallFlying(e, cmd);
    e.prePoseHeight = e.height;   // vanilla's updatePose is the END of the tick: this tick's in-wall test (EL.suffocate) still sees last tick's box
    Ph.pose(e, cmd);

    // wish direction in world space (yaw 0 looks -Z, +yaw turns toward +X — ARCH §9)
    //
    // ⚠ THE 0.98 AND THE NORMALISE ORDER ARE BOTH VANILLA, AND THEY ARE WHY DIAGONAL IS FASTER
    // (D-251). `Player.aiStep` scales each axis by 0.98 before `moveRelative`, and
    // `Entity.getInputVector` normalises only when the vector's length SQUARED exceeds 1. Forward
    // alone is 0.98 long and is left alone; forward+strafe is 1.386 long and is normalised to 1.
    // Sneaking scales the input by 0.3 and never the speed, which is why a sneaking player on ice
    // still slides exactly as far.
    var wx = 0, wz = 0;
    var f = cmd.fwd * Ph.INPUT_SCALE, s = cmd.strafe * Ph.INPUT_SCALE;
    if (cmd.sneak && !e.flying) { f *= Ph.SNEAK_INPUT; s *= Ph.SNEAK_INPUT; }
    if (f || s) {
      var len2 = f * f + s * s;
      if (len2 > 1) { var len = Math.sqrt(len2); f /= len; s /= len; }
      var sy = Math.sin(e.yaw), cy = Math.cos(e.yaw);
      wx = f * sy + s * cy;
      wz = f * -cy + s * sy;
    }

    e.edgeGuard = !!cmd.sneak && !e.flying && !e.inWater;

    if (e.flying) return flyTick(e, cmd, wx, wz);
    if (e.fallFlying && !e.inWater) return glideTick(e, cmd);
    if (e.inWater) return waterTick(e, cmd, wx, wz);
    if (e.inLava) return lavaTick(e, cmd, wx, wz);
    // ClientPlayerEntity.tickMovement: a pending auto-jump holds the jump key for one tick.
    if (e.autoJumpTicks > 0) { e.autoJumpTicks--; cmd = Object.assign({}, cmd, { jump: true }); }
    var ax = e.x, az = e.z;
    landTick(e, cmd, wx, wz);
    if (e.autoJumpEnabled === true) Ph.autoJump(e, cmd, e.x - ax, e.z - az, wx, wz);
  };

  /**
   * `ClientPlayerEntity.autoJump(dx, dz)` (and `shouldAutoJump`): after a move, probe the way the
   * player is walking for a collider 0.5..1.2 high (+0.75 per jump-boost level) with free
   * headroom, and hold jump for the next tick (`ticksToNextAutojump = 1`).
   */
  Ph.autoJump = function (e, cmd, dx, dz, wx, wz) {
    if (e.autoJumpTicks > 0 || !e.onGround || cmd.sneak || e.vehicle || e.inWater || e.inLava || e.flying) return;
    if (!(cmd.fwd || cmd.strafe)) return;
    if (Ph.jumpFactorOf(e) < 1) return;
    var l2 = dx * dx + dz * dz;
    if (l2 <= 0.001) {
      dx = wx * Ph.SPEED; dz = wz * Ph.SPEED;
      l2 = dx * dx + dz * dz;
      if (l2 <= 0.001) return;
    }
    var inv = 1 / Math.sqrt(l2), ux = dx * inv, uz = dz * inv;
    if (Math.sin(e.yaw) * Math.cos(e.pitch) * ux + -Math.cos(e.yaw) * Math.cos(e.pitch) * uz < -0.15) return;
    var H = e.height || Ph.H, W = e.width !== undefined ? e.width : Ph.W;
    var cx = Math.floor(e.x), cz = Math.floor(e.z);
    if (Ph.shapeAt(cx, Math.floor(e.y + H), cz) !== null) return;
    if (Ph.shapeAt(cx, Math.floor(e.y + H) + 1, cz) !== null) return;
    var maxStep = 1.2 + Ph.jumpBoostVelocity(e) * 7.5;
    var dist = Math.max(Ph.SPEED * 7, 1 / inv);
    var ex = e.x + dx + ux * dist, ez = e.z + dz + uz * dist;
    var bx0 = Math.min(e.x, ex) - W, bx1 = Math.max(e.x, ex) + W, bz0 = Math.min(e.z, ez) - W, bz1 = Math.max(e.z, ez) + W;
    var by0 = e.y, by1 = e.y + H;
    // the two probe segments, half a width either side of the heading, at +0.51
    var px = -uz * W * 0.5, pz = ux * W * 0.5, py0 = e.y + 0.51;
    var segs = [[e.x - px, ex - px, e.z - pz, ez - pz], [e.x + px, ex + px, e.z + pz, ez + pz]];
    var top = -Infinity, hit = null;
    for (var x = Math.floor(bx0); x <= Math.floor(bx1) && !hit; x++)
      for (var z = Math.floor(bz0); z <= Math.floor(bz1) && !hit; z++)
        for (var y = Math.floor(by0); y <= Math.floor(by1) && !hit; y++) {
          var sh = Ph.shapeAt(x, y, z);
          if (sh === null) continue;
          for (var i = 0; i < sh.length; i++) {
            var b = sh[i], ax0 = x + b[0], ay0 = y + b[1], az0 = z + b[2], ax1 = x + b[3], ay1 = y + b[4], az1 = z + b[5];
            if (ax1 <= bx0 || ax0 >= bx1 || ay1 <= by0 || ay0 >= by1 || az1 <= bz0 || az0 >= bz1) continue;
            for (var k = 0; k < 2; k++) {
              var sg = segs[k];
              if (ax1 > Math.min(sg[0], sg[1]) && ax0 < Math.max(sg[0], sg[1]) && az1 > Math.min(sg[2], sg[3]) && az0 < Math.max(sg[2], sg[3]) &&
                  ay1 > py0 && ay0 < py0) { hit = { x: (ax0 + ax1) / 2, y: (ay0 + ay1) / 2, z: (az0 + az1) / 2, top: ay1 }; break; }
            }
            if (hit) break;
          }
        }
    if (!hit) return;
    top = hit.top;
    var hx = Math.floor(hit.x), hy = Math.floor(hit.y), hz = Math.floor(hit.z), hr = Math.floor(e.y + H) + 1;
    for (var j = 1; j < maxStep; j++) {
      var s2 = Ph.shapeAt(hx, hy + j, hz);
      if (s2 !== null) {
        var m = 0; for (var q = 0; q < s2.length; q++) if (s2[q][4] > m) m = s2[q][4];
        top = m + hy + j;
        if (top - e.y > maxStep) return;
      }
      if (j > 1) { hr++; if (Ph.shapeAt(cx, hr, cz) !== null) return; }
    }
    var rise = top - e.y;
    if (!(rise <= 0.5) && !(rise > maxStep)) e.autoJumpTicks = 1;
  };

  /**
   * `Entity.updateSwimming` (Entity.java 1043-1050) + `PlayerEntity.updateSwimming`: sprinting
   * while SUBMERGED with water at the feet starts it; once swimming it lasts while sprinting and
   * touching water. Creative flight cancels it. Sprint is the key state (`cmd`), as in water
   * `waterTick` never publishes `e.sprinting`.
   */
  Ph.updateSwimming = function (e, cmd) {
    var sprint = !!(cmd && cmd.sprint && cmd.fwd > 0 && !cmd.sneak) && !e.vehicle;
    if (e.flying) { e.swimming = false; return; }
    if (e.swimming) e.swimming = sprint && !!e.inWater;
    else e.swimming = sprint && !!e.eyeInWater && !!e.inWater &&
                      Ph.blockAt(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z)) === NS.States.stateOf('water');
  };

  /**
   * Starting and ending an elytra glide (`PlayerEntity.checkFallFlying`): the jump key PRESSED
   * (an edge) in the air, falling, not in water, wearing a usable elytra (`e.elytraUsable`,
   * published by the player from the chest slot). It ends on landing, in water, or when the
   * elytra is no longer usable.
   */
  Ph.updateFallFlying = function (e, cmd) {
    var edge = !!(cmd && cmd.jump) && !e.wasJump;
    e.wasJump = !!(cmd && cmd.jump);
    if (e.fallFlying) {
      if (NS.GameEvent && !e.onGround) NS.GameEvent.emit('elytra_free_fall', e.x, e.y, e.z, e);   // LivingEntity.tickFallFlying
      if (e.onGround || e.inWater || e.flying || !e.elytraUsable) e.fallFlying = false;
    } else if (edge && !e.onGround && e.vy < 0 && !e.flying && !e.inWater && e.elytraUsable) {
      e.fallFlying = true;
    }
  };

  /** `LivingEntity.travel`'s isFallFlying branch (LivingEntity.java 2076-2110), verbatim. */
  function glideTick(e, cmd) {
    var cp = Math.cos(e.pitch), sp = Math.sin(e.pitch), sy = Math.sin(e.yaw), cy = Math.cos(e.yaw);
    var lx = sy * cp, ly = sp, lz = -cy * cp;
    var vx = e.vx, vy = e.vy, vz = e.vz;
    if (vy > -0.5) e.fallDistance = 1;
    var hl = Math.sqrt(lx * lx + lz * lz);
    var hv = Math.sqrt(vx * vx + vz * vz);
    var ll = Math.sqrt(lx * lx + ly * ly + lz * lz);
    var pr = -e.pitch;                      // vanilla pitch is positive DOWN
    var c = Math.cos(pr);
    c = c * c * Math.min(1, ll / 0.4);
    vy += 0.08 * (-1 + c * 0.75);
    if (vy < 0 && hl > 0) {
      var d = vy * -0.1 * c;
      vx += lx * d / hl; vy += d; vz += lz * d / hl;
    }
    if (pr < 0 && hl > 0) {
      var u = hv * (-Math.sin(pr)) * 0.04;
      vx += -lx * u / hl; vy += u * 3.2; vz += -lz * u / hl;
    }
    if (hl > 0) {
      vx += (lx / hl * hv - vx) * 0.1;
      vz += (lz / hl * hv - vz) * 0.1;
    }
    e.vx = vx * 0.99; e.vy = vy * 0.98; e.vz = vz * 0.99;
    Ph.move(e, e.vx, e.vy, e.vz);
    if (e.horizontalCollision) {
      var dmg = (hv - Math.sqrt(e.vx * e.vx + e.vz * e.vz)) * 10 - 3;
      if (dmg > 0) e.flyIntoWall = dmg;
    }
    if (e.onGround) e.fallFlying = false;
    e.sprinting = false;
  }

  function landTick(e, cmd, wx, wz) {
    // ⚠ THE WHOLE OF VANILLA'S LAND MOVEMENT, IN THE ORDER `LivingEntity.travel` DOES IT (D-251):
    //   f3 = friction of the block below that affects my movement
    //   f1 = onGround ? f3 * 0.91 : 0.91
    //   a  = onGround ? speed * (0.216 / f3³) : flyingSpeed
    //   delta += input · a ;  move ;  delta.xz *= blockSpeedFactor ;
    //   delta.y = (delta.y − 0.08) * 0.98 ;  delta.xz *= f1
    var f3 = Ph.frictionOf(e);
    var f1 = e.onGround ? f3 * Ph.AIR_FRICTION : Ph.AIR_FRICTION;
    var sprinting = cmd.sprint && cmd.fwd > 0 && !cmd.sneak;
    var speed = (Ph.SPEED + (e.soulSpeedMod || 0)) * (sprinting ? Ph.SPRINT_MULT : 1);
    var a = e.onGround ? speed * (Ph.FRICTION_CUBE / (f3 * f3 * f3))
                       : Ph.AIR_ACCEL * (sprinting ? Ph.SPRINT_MULT : 1);

    e.vx += wx * a;
    e.vz += wz * a;

    if (cmd.jump && e.onGround) {
      // getJumpPower() = 0.42 * blockJumpFactor, plus 0.1*(level+1) of jump boost. Honey's 0.5
      // jump factor is the reason you cannot jump out of a honey pit.
      e.vy = Ph.JUMP * Ph.jumpFactorOf(e) + Ph.jumpBoostVelocity(e);
      // ⚠ THE SPRINT BONUS IS ALONG THE YAW, NOT ALONG THE WISH DIRECTION. `jumpFromGround` adds
      // (−sin(yaw)·0.2, 0, cos(yaw)·0.2) whatever the strafe keys say, so a sprint-jump sideways
      // still throws you FORWARD. Ours pushed along the wish vector and was subtly wrong.
      if (sprinting) {
        e.vx += Math.sin(e.yaw) * Ph.SPRINT_JUMP_BOOST;
        e.vz += -Math.cos(e.yaw) * Ph.SPRINT_JUMP_BOOST;
      }
      e.onGround = false;
    }
    var g = Ph.travelGravity(e);   // #295: slow falling, read after the jump as vanilla's travel does

    Ph.climbClamp(e, cmd);
    Ph.move(e, e.vx, e.vy, e.vz);

    // `Entity.move` ends by multiplying the horizontal delta by the block speed factor — soul
    // sand and honey, the only two blocks in 1.18.2 that carry one.
    var sf = Ph.speedFactorOf(e);
    if (sf !== 1) { e.vx *= sf; e.vz *= sf; }

    // Vanilla order: gravity and drag are applied AFTER the move, not before it.
    Ph.landGravity(e, g);          // #295: levitation replaces gravity
    e.vy *= Ph.DRAG_Y;
    e.vx *= f1;
    e.vz *= f1;
    e.sprinting = sprinting;
  }

  /**
   * climbClamp — `LivingEntity.handleOnClimbable`, which is where ladders live.
   * All three axes are clamped to ±0.15, the fall distance is reset, and a sneaking player on a
   * ladder holds still instead of sliding down. It runs BEFORE the move, on the delta.
   */
  Ph.climbClamp = function (e, cmd) {
    if (!Ph.onClimbable(e)) return;
    var c = Ph.CLIMB_CLAMP;
    e.fallDistance = 0;
    if (e.vx > c) e.vx = c; else if (e.vx < -c) e.vx = -c;
    if (e.vz > c) e.vz = c; else if (e.vz < -c) e.vz = -c;
    if (e.vy < -c) e.vy = -c;
    if (cmd && cmd.sneak && e.vy < 0) e.vy = 0;
  };

  /** Is the entity inside a climbable block? Ladders, vines and scaffolding, by tag. */
  Ph.onClimbable = function (e) {
    // ⚠ SPIDER (D-401, session 39): `Spider.onClimbable()` (`bmo`'s own `b_()`, bytecode-read
    // in full) OVERRIDES the generic block-tag check below with its own synced `isClimbing`
    // flag, itself set once a non-client tick to `this.horizontalCollision` (`bmo.k()`), so
    // every consumer sees last tick's value (set in travelMob after the move).
    if (e && (e.type === 'spider' || e.type === 'cave_spider')) return !!e.climbingWall;   // the synced flag, one tick behind the collision
    var R = NS.Reg, S = NS.States;
    if (!R || !S) return false;
    var id = blockIdAt(e.x, e.y, e.z);
    var n = R.names[id];
    return n === 'ladder' || n === 'vine' || n === 'scaffolding' ||
           n === 'twisting_vines' || n === 'weeping_vines' ||
           n === 'twisting_vines_plant' || n === 'weeping_vines_plant';
  };

  function waterTick(e, cmd, wx, wz) {
    // Vanilla LivingEntity.travel: flat 0.02 push, drag 0.9 sprinting / 0.8 otherwise
    // (0.96 with dolphins_grace); Depth Strider lerps toward getMovementSpeed().
    var sprinting = !!(cmd.sprint && cmd.fwd > 0 && !cmd.sneak);
    var fr = sprinting ? 0.9 : Ph.WATER_FRICTION;
    var a = 0.02;
    // Depth Strider (.decomp LivingEntity.travel:2025-2040): level capped 3, halved off the
    // ground; drag moves toward 0.546 and the push toward the ground speed (0.1) by lvl/3.
    var ds = Math.min(e.depthStrider | 0, 3);
    if (ds > 0) {
      if (!e.onGround) ds *= 0.5;
      fr += (0.54600006 - fr) * ds / 3;
      a += ((Ph.SPEED + (e.soulSpeedMod || 0)) * (sprinting ? Ph.SPRINT_MULT : 1) - a) * ds / 3;
    }
    // #295: dolphin's grace overrides the HORIZONTAL slowdown only (`multiply(f, 0.8F, f)`).
    fr = Ph.waterSlowdown(e, fr);
    if (e.dolphinsGrace) fr = 0.96;
    e.vx += wx * a;
    e.vz += wz * a;
    // `PlayerEntity.travel` 1415-1424: a swimming player's vy is steered toward the look
    // vector's y by 0.06 (0.085 when looking below -0.2)
    if (e.swimming) {
      var ly = Math.sin(e.pitch), k = ly < -0.2 ? 0.085 : 0.06;
      if (ly <= 0 || cmd.jump || Ph.blockAt(Math.floor(e.x), Math.floor(e.y + 0.9), Math.floor(e.z)) === NS.States.stateOf('water'))
        e.vy += (ly - e.vy) * k;
    }
    if (cmd.jump)       e.vy += Ph.SWIM_UP;
    else if (cmd.sneak) e.vy -= Ph.SWIM_UP;
    var gW = Ph.travelGravity(e);   // #295: slow falling, read on the velocity travel starts with

    var y0 = e.y;
    Ph.move(e, e.vx, e.vy, e.vz);

    // ⚠ `LivingEntity.travel` water branch, in vanilla's order: a climbable block sets vy = 0.2
    // BEFORE the (f, 0.8, f) multiply; `getFluidFallingAdjustedMovement` then applies gravity/16
    // (skipped while sprinting) and the -0.003 settle; and a wall hit with a free box 0.6 above
    // the old feet hops out at vy = 0.3.
    if (e.horizontalCollision && Ph.onClimbable(e)) e.vy = 0.2;
    e.vx *= fr;
    e.vz *= fr;
    e.vy *= 0.8;
    if (!cmd.sprint) {
      var g = gW / 16;
      if (e.vy <= 0 && Math.abs(e.vy - 0.005) >= 0.003 && Math.abs(e.vy - g) < 0.003) e.vy = -0.003;
      else e.vy -= g;
    }
    if (e.horizontalCollision && boxFreeOfFluid(e, e.vx, e.vy + 0.6 - e.y + y0, e.vz)) e.vy = 0.3;
    e.sprinting = false;
  }

  /** `Entity.isFree`: no collider and no liquid in the box moved by (dx,dy,dz). */
  function boxFreeOfFluid(e, dx, dy, dz) {
    var hw = (e.width !== undefined ? e.width : Ph.W) * 0.5, h = e.height || Ph.H, E = Ph.EPS;
    var R = NS.Reg, S = NS.States;
    var x0 = e.x + dx - hw, x1 = e.x + dx + hw, y0 = e.y + dy, y1 = y0 + h, z0 = e.z + dz - hw, z1 = e.z + dz + hw;
    for (var x = Math.floor(x0 + E); x <= Math.floor(x1 - E); x++)
      for (var y = Math.floor(y0 + E); y <= Math.floor(y1 - E); y++)
        for (var z = Math.floor(z0 + E); z <= Math.floor(z1 - E); z++) {
          var sh = Ph.shapeAt(x, y, z);
          if (sh) {
            for (var i = 0; i < sh.length; i++) {
              var b = sh[i];
              if (x0 < x + b[3] && x1 > x + b[0] && y0 < y + b[4] && y1 > y + b[1] && z0 < z + b[5] && z1 > z + b[2]) return false;
            }
          }
          var blk = S.block[Ph.blockAt(x, y, z)];
          if (blk === R.id.water || blk === R.id.lava) return false;
        }
    return true;
  }

  // LivingEntity.travel 2056-2075 (.decomp): updateVelocity(0.02); move; deep lava halves all three
  // axes, shallow lava takes (0.5,0.8,0.5); then -0.08/4 gravity and the 0.3 ledge hop. Jumping
  // in lava adds 0.04 (jumpInFluid). Depth is Ph.fluidHeightOf(e,2) <= Ph.swimHeightOf(e), as the mob path.
  function lavaTick(e, cmd, wx, wz) {
    e.vx += wx * 0.02;
    e.vz += wz * 0.02;
    if (cmd.jump) e.vy += 0.04;
    var y0 = e.y, g = Ph.travelGravity(e);
    Ph.move(e, e.vx, e.vy, e.vz);
    if (Ph.fluidHeightOf(e, 2) <= Ph.swimHeightOf(e)) { e.vx *= 0.5; e.vy *= 0.8; e.vz *= 0.5; }
    else { e.vx *= 0.5; e.vy *= 0.5; e.vz *= 0.5; }
    if (!e.noGravity) e.vy -= g / 4;
    if (e.horizontalCollision && boxFreeOfFluid(e, e.vx, e.vy + 0.6 - e.y + y0, e.vz)) e.vy = 0.3;
    e.sprinting = false;
  }

  // MinecraftClient.handleMouseScroll (spectator, no screen): flySpeed += signum(scroll) * 0.005, clamped 0..0.2.
  // `up` > 0 is wheel up (faster). Creative and survival are untouched.
  Ph.FLY_SPEED_DEFAULT = 0.05;
  Ph.adjustFlySpeed = function (e, up) {
    if (e.mode !== 3 || !up) return;
    var v = (e.flySpeed === undefined ? Ph.FLY_SPEED_DEFAULT : e.flySpeed) + (up > 0 ? 0.005 : -0.005);
    e.flySpeed = Math.min(0.2, Math.max(0, Math.round(v * 1000) / 1000));
  };

  function flyTick(e, cmd, wx, wz) {
    var fr = Ph.FLY_FRICTION, fy = Ph.FLY_FRICTION_Y;
    var top = cmd.sprint ? Ph.FLY_SPRINT : Ph.FLY;
    if (e.mode === 3 && e.flySpeed !== undefined) top *= e.flySpeed / Ph.FLY_SPEED_DEFAULT;   // spectator wheel speed
    var a = accelFor(top, fr), av = Ph.FLY_VERT_PUSH;

    e.vx += wx * a;
    e.vz += wz * a;
    if (cmd.jump)  e.vy += av;
    if (cmd.sneak) e.vy -= av;

    // vanilla moves by the pushed velocity and restores vy = pushed * 0.6, collisions or not
    var vyPre = e.vy;
    Ph.move(e, e.vx, e.vy, e.vz);

    e.vx *= fr;
    e.vz *= fr;
    e.vy = vyPre * fy;
    e.sprinting = !!cmd.sprint;

    // Vanilla drops you out of creative flight the moment you land.
    if (e.onGround && e.vy <= 0 && !e.noclip) e.flying = false;
  }

  /**
   * landed(e, distance, vy) — what the block you hit does about it.
   *
   * ⚠ THE MULTIPLIER TABLE IS HAND-SOURCED AND SAYS SO (D-251). Unlike friction, speedFactor and
   * jumpFactor — which are FIELDS and are therefore reflectable — a landing multiplier lives in
   * each block's `fallOn` override, so there is no field to read. These four are the whole set in
   * 1.18.2, they are marked hand-sourced the way PLAN already sanctions for furnace fuel times
   * (G9), and `movecheck` §6 asserts the arithmetic around them rather than the table itself.
   */
  var FALL_MULT = { hay_block: 0.2, honey_block: 0.2, slime_block: 0, sweet_berry_bush: 0,
                    powder_snow: 0, cobweb: 0, scaffolding: 0, water: 0, ladder: 0, vine: 0 };
  Ph.FALL_MULT = FALL_MULT;
  // #5792 -- derived from the 1.18.2 handleFallDamage class chain (tools/golden/fall-entities-1.18.2.tsv,
  // packed as D.entities.fallNone): chicken, bat, parrot, bee, blaze, ocelot, cat, magma_cube, wither,
  // FlyingEntity (ghast, phantom), GolemEntity (iron_golem, snow_golem, shulker).
  Ph.noFallDamage = function (type) {
    var D = NS.DATA, f = D && D.entities && D.entities.fallNone;
    return !!(f && f[String(type).replace(/^minecraft:/, '')] === 1);
  };
  Ph.HORSE_BASE = { horse: 1, donkey: 1, mule: 1, skeleton_horse: 1, zombie_horse: 1, llama: 1, trader_llama: 1 };
  Ph.horseFallDamage = function (distance, mult) {
    return Math.max(0, Math.ceil((distance * 0.5 - 3) * (mult === undefined ? 1 : mult)));
  };
  Ph.isStalagmiteTip = function (st) {
    var R = NS.Reg, SR = NS.States, P = R.PROP;
    return R.valueNames[SR.propValue(st, P.vertical_direction)] === 'up' &&
           R.valueNames[SR.propValue(st, P.thickness)] === 'tip';
  };
  /** `ServerPlayerEntity.onLanding`: FALL_FROM_HEIGHT from the recorded start while alive, then forget it. */
  Ph.playerLanding = function (e) {
    if (e !== NS.Player) return;
    if (e.health > 0 && e.fallStartPos && NS.Adv && e.advancements) NS.Adv.trigger(e, 'minecraft:fall_from_height', { player: e, start: e.fallStartPos });
    e.fallStartPos = null;
  };
  Ph.landed = function (e, distance, vy) {
    var R = NS.Reg;
    var name = R && R.names ? R.names[blockIdAt(e.x, e.y - 0.2, e.z)] : null;
    var mult = (name && FALL_MULT[name] !== undefined) ? FALL_MULT[name] : 1;
    var isBed = !!name && /_bed$/.test(name);
    if (isBed) distance *= 0.5;   // BedBlock.fallOn: super.fallOn(fd * 0.5F)
    if (NS.Stats && e === NS.Player && !e.invulnerableGamemode) NS.Stats.onFall(distance);   // G26a fall_one_cm
    e.landedFrom = distance;
    if (NS.Behave && NS.Behave.farmlandTrample && name === 'farmland') NS.Behave.farmlandTrample(e, Math.floor(e.x), Math.floor(e.y - 0.2), Math.floor(e.z), distance);
    e.landedOn = name;
    e.pendingFallSource = null;
    // #5663 -- `PointedDripstoneBlock.fallOn`: an up-pointing TIP is causeFallDamage(dist + 2.0, 2.0, STALAGMITE).
    if (name === 'pointed_dripstone' && Ph.isStalagmiteTip(Ph.blockAt(e.x, e.y - 0.2, e.z))) {
      distance += 2; mult = 2; e.pendingFallSource = 'stalagmite';
    }
    e.pendingFallDamage = Ph.fallDamage(distance, mult, Ph.jumpBoostLevel(e));
    // #766 -- mobs whose `handleFallDamage` is `return false` in 1.18.2 (Chicken, Bat, Parrot, Bee, Blaze,
    // Ocelot, Cat, MagmaCube, Wither, and FlyingEntity = Ghast/Phantom) never take fall damage.
    if (Ph.noFallDamage(e.type)) e.pendingFallDamage = 0;
    // #3485 -- `StriderEntity.fall`: in lava it is `onLanding()` only, no handleFallDamage.
    if (e.type === 'strider' && e.inLava) e.pendingFallDamage = 0;
    // #1288 -- `FoxEntity.computeFallDamage`: ceil((dist - 5) * mult), no Jump Boost term (Fx.fallDamage, 07zj_fox.js).
    if (e.type === 'fox' && NS.Fox && NS.Fox.fallDamage) e.pendingFallDamage = NS.Fox.fallDamage(distance, mult);
    // #1351 -- `HorseBaseEntity.computeFallDamage`: ceil((dist * 0.5 - 3) * mult), no Jump Boost term
    // (horse, donkey, mule, skeleton/zombie horse and llama all inherit it).
    if (Ph.HORSE_BASE[e.type] === 1) {
      e.pendingFallDamage = Ph.horseFallDamage(distance, mult);
      if (NS.MobVoice && NS.MobVoice.horseLand) NS.MobVoice.horseLand(e, distance);   // entity.horse.land, damage or not
    }
    // loop/goat-s99 (QUEUE 0.2 G18c) -- `GoatEntity.computeFallDamage`'s own flat -10
    // (Gt.adjustFallDamage, 07zj_goat.js); a no-op guarded call for every other type.
    if (NS.Goat && NS.Goat.adjustFallDamage) e.pendingFallDamage = NS.Goat.adjustFallDamage(e, e.pendingFallDamage);
    // #1792 -- `CreeperEntity.handleFallDamage`: the fall winds the fuse on (Cr.onFall, 07zb_creeper.js).
    if (e.type === 'creeper' && NS.Creeper && NS.Creeper.onFall) NS.Creeper.onFall(e, distance);
    // Slime bounces a living entity back at its full incoming speed unless it is sneaking —
    // `SlimeBlock.bounceUp`, and the reason a sneaking player can walk on slime normally.
    if (name === 'slime_block' && !e.edgeGuard && vy < 0) e.bounceVy = -vy;
    // BedBlock.updateEntityAfterFallOn/bounceUp: -vy*0.66, x0.8 for non-living, none if sneaking.
    if (isBed && !e.edgeGuard && vy < 0) e.bounceVy = -vy * 0.66 * ((e.living !== false || e.maxHealth !== undefined) ? 1 : 0.8);
  };

  /**
   * Does the player's box intersect this block cell? Placement must refuse to put a cube inside
   * the player, or you seal yourself into the world with one click.
   */
  Ph.boxIntersectsCell = function (e, bx, by, bz) {
    var hw = (e.width !== undefined ? e.width : Ph.W) * 0.5, h = e.height || Ph.H;
    return (e.x - hw) < bx + 1 && (e.x + hw) > bx &&
           (e.y)      < by + 1 && (e.y + h) > by &&
           (e.z - hw) < bz + 1 && (e.z + hw) > bz;
  };

  /**
   * Drop an entity to the first standing spot at or below `fromY`, then nudge it up if it is
   * embedded. Returns false if no free spot exists in the column (a solid column, or one that
   * is not generated yet).
   */
  Ph.settle = function (e, fromY) {
    if (!CFG) CFG = NS.CFG;
    var x = Math.floor(e.x), z = Math.floor(e.z);
    var y = Math.min(CFG.WORLD_MAX_Y - 3, fromY | 0);
    for (; y > CFG.WORLD_MIN_Y; y--) {
      if (Ph.solidAt(x, y, z)) {
        if (!Ph.solidAt(x, y + 1, z) && !Ph.solidAt(x, y + 2, z)) {
          e.y = y + 1.001; e.vx = e.vy = e.vz = 0; e.onGround = true;
          return true;
        }
      }
    }
    return false;
  };

  // ══════════════════════ MOB LOCOMOTION — D-417 ══════════════════════════════════════════
  //
  // ⚠⚠ **A MOB DOES NOT MOVE ITSELF. IT SETS A SPEED AND A HEADING, AND THIS MOVES IT.** Until
  // D-417 `Ai.stepToward` wrote `e.x`/`e.y`/`e.z` directly — it TELEPORTED the mob a fraction of
  // a block each tick — so nothing a mob did ever went through `Ph.move`, and every mob in the
  // game walked through walls, through the floor and up sheer cliffs. The collision sweep was
  // never broken; it was never asked.
  //
  // ⚠ THE LAW IS THE REFEREE'S, READ THIS SESSION OUT OF THE 1.18.2 BYTECODE (D-417):
  //   * `bcu` (`JumpControl`): `jump()` sets a flag; `tick()` does `mob.setJumping(flag)` and
  //     clears it. So a jump is a BOOLEAN the travel step consumes, never a velocity write.
  //   * `bcw.a()` (`MoveControl.tick`), MOVE_TO branch — see `Ai.moveControlTick`.
  //   * `aya.r(F)` (`Mob.setSpeed`) is `super.setSpeed(f); this.setZza(f);` — **the mob's speed
  //     attribute is ALSO its forward input**, which is why a mob's walking speed goes as the
  //     SQUARE of its MOVEMENT_SPEED and not linearly. A zombie's 0.23 gives 0.23 × 0.23 ×
  //     (0.216/f³) of acceleration, not 0.23. Nothing but the bytecode says so.
  //   * `axy.h(dpo)` (`LivingEntity.travel`) is the same method `landTick` above already ports
  //     for the player: friction, `moveRelative`, move, speed factor, then gravity and drag.
  //     Its water branch is the `0.9`-or-`getWaterSlowDown()` / `0.02` / `×(f4, 0.8, f4)` shape
  //     at offsets 97–294 of the dump.
  Ph.MOB_FLYING_SPEED = 0.02;      // LivingEntity.flyingSpeed's own default
  Ph.WATER_SLOWDOWN   = 0.8;       // LivingEntity.getWaterSlowDown()
  Ph.PUSH_MIN         = 0.009999999776482582;   // Entity.push's own float-widened 0.01
  Ph.PUSH_SCALE       = 0.05000000074505806;    // ... and its 0.05
  Ph.IN_WALL_SHRINK   = 0.8;       // Entity.isInWall: dimensions.width * 0.8
  Ph.IN_WALL_DAMAGE   = 1;         // LivingEntity.baseTick's own DamageSource.IN_WALL amount
  Ph.EYE_FRACTION     = 0.85;      // ⚠ HAND-SOURCED: Entity.getEyeHeight's `height * 0.85F`

  // FluidBlock.COLLISION_SHAPE top: a level-0 lava cell is a 0.5 tall slab for a mob that
  // `canWalkOnFluid` (StriderEntity) when the cell above is not lava (FluidBlock.getCollisionShape).
  function lavaSlabTop(x, y, z) {
    var L = NS.States.stateOf('lava');
    var B = NS.States.block, LB = NS.Reg.id.lava;
    if (Ph.blockAt(x, y, z) !== L || B[Ph.blockAt(x, y + 1, z)] === LB) return null;
    return y + 0.5;
  }

  /** `StriderEntity.updateFloating` (.decomp StriderEntity.java:324-334). */
  Ph.striderFloat = function (e) {
    if (!e.inLava) return;
    // updateFloating tests the FLUID TAG, not level 0: any lava at the cell, none above (isAbove(COLLISION_SHAPE) + !isIn(LAVA))
    var cx = Math.floor(e.x), cy = Math.floor(e.y), cz = Math.floor(e.z), B = NS.States.block, LB = NS.Reg.id.lava;
    if (e.y >= cy + 0.5 - 1e-5 && B[Ph.blockAt(cx, cy, cz)] === LB && B[Ph.blockAt(cx, cy + 1, cz)] !== LB) e.onGround = true;
    else { e.vx *= 0.5; e.vy = e.vy * 0.5 + 0.05; e.vz *= 0.5; }
  };

  /** `Ph.move` for an entity whose `canWalkOnFluid(lava)` is true: lava slabs are floor. */
  Ph.moveOnLava = function (e, dx, dy, dz) {
    var y0 = e.y;
    Ph.move(e, dx, dy, dz);
    if (dy > 0 || e.y >= y0) return;
    var x = Math.floor(e.x), z = Math.floor(e.z);
    for (var cy = Math.floor(y0); cy >= Math.floor(e.y); cy--) {
      var top = lavaSlabTop(x, cy, z);
      if (top !== null && y0 >= top - 1e-5 && e.y < top) { e.y = top; e.vy = 0; e.onGround = true; return; }
    }
  };

  /**
   * travelMob(e, xxa) — one tick of `LivingEntity.travel` for an entity whose input comes from
   * its move control rather than from a keyboard. Reads `e.zza` (forward input), the new `xxa`
   * PARAMETER (sideways input — Mount.OWED's own header explains why a mounted, steered horse
   * is the first caller that ever has one; every other caller omits it and gets the old zza-
   * only behaviour, unchanged bit for bit), `e.mobSpeed` (the MOVEMENT_SPEED the control set)
   * and `e.jumping`; writes velocity and position through `Ph.move` and nowhere else.
   *
   * ⚠⚠ THE ROTATION IS off `Entity.movementInputToVelocity` (javap'd, .decomp), READ, NOT
   * RE-DERIVED: `x' = vec.x*cos(yaw) - vec.z*sin(yaw)`, `z' = vec.z*cos(yaw) + vec.x*sin(yaw)`.
   * This engine's own `e.yaw` disagrees with that formula's SIGN on the zza-only case that
   * shipped before `xxa` existed (`vx += zza*sin`, `vz += zza*-cos`, the exact NEGATION of
   * `vec=(0,0,zza)` plugged into the jar's own formula) — this file's own yaw convention is
   * flipped from Yarn's, not wrong, and `mobmovecheck`/`aicheck` already exercise it. The `xxa`
   * term added below is the SAME negation applied to `vec=(xxa,0,zza)` in full, so a sideways-
   * only push comes out perpendicular to a forward-only push at the same speed — `mountcheck`
   * §5 asserts exactly that (and that killing the `xxa` term collapses it back to zero, rule 1).
   */
  /** `Entity.getSwimHeight`: 0 when the eye height is under 0.4, else 0.4. */
  Ph.swimHeightOf = function (e) { return (e.eyeHeight !== undefined ? e.eyeHeight : (e.height || 1.8) * 0.85) < 0.4 ? 0 : 0.4; };
  /** `Entity.getFluidHeight(tag)` at the feet: kind 1 water, 2 lava (Wx.fluidOf/fluidHeight). */
  Ph.fluidHeightOf = function (e, kind) {
    var Wx = NS.Weather, W = NS.World, h = 0;
    if (!Wx || !W || !W.getBlock) return 0;
    var x = Math.floor(e.x), z = Math.floor(e.z);
    for (var cy = Math.floor(e.y), n = 0; n < 2; n++, cy++)
      if (Wx.fluidOf(W.getBlock(x, cy, z))[0] === kind) h = Math.max(h, cy + Wx.fluidHeight(x, cy, z) - e.y);
    return h;
  };
  Ph.MOB_WATER_HOP = 0.3;   // LivingEntity.travel's 0.3F wall hop out of water (spawnoceancheck's anti-vacuity zeroes it)
  Ph.travelMob = function (e, xxa) {
    xxa = xxa || 0;
    // ⚠ `Entity.getInputVector` normalises ONLY when the vector's length squared exceeds 1 —
    // COMBINED, not axis-by-axis (`Vec3d.lengthSquared`/`.normalize()` on the pair), which only
    // shows up once a caller can set both axes at once (a mob's own zza never could).
    var zza = e.zza || 0;
    var mag2 = xxa * xxa + zza * zza;
    if (mag2 > 1) { var inv = 1 / Math.sqrt(mag2); xxa *= inv; zza *= inv; }
    var sy = Math.sin(e.yaw), cy = Math.cos(e.yaw);

    var g;
    if (e.inWater) {
      var f4 = Ph.waterSlowdown(e, e.type === 'polar_bear' ? 0.98 : e.type === 'skeleton_horse' ? 0.96 : Ph.WATER_SLOWDOWN), f5 = Ph.MOB_FLYING_SPEED;
      e.vx += (zza * sy - xxa * cy) * f5;
      e.vz += (-zza * cy - xxa * sy) * f5;
      if (e.jumping) e.vy += Ph.SWIM_UP;
      e.jumping = false;
      g = Ph.travelGravity(e);     // #295: slow falling, on the velocity travel starts with
      var wy0 = e.y;
      Ph.move(e, e.vx, e.vy, e.vz);
      // #1495: the rest of `LivingEntity.travel`'s water branch, the player's (waterTick) order: climbable 0.2, the
      // (f, 0.8, f) multiply, `getFluidFallingAdjustedMovement`, then the wall hop. Without the hop a sheep that
      // swam to a one-block bank pressed against it forever: an animal could enter the sea but never leave it.
      if (e.horizontalCollision && Ph.onClimbable(e)) e.vy = 0.2;
      e.vx *= f4; e.vz *= f4; e.vy *= 0.8;
      // `getFluidFallingAdjustedMovement` — gravity in a fluid is a SIXTEENTH of gravity, and it
      // is applied after the 0.8, not folded into it.
      if (!e.noGravity && !e.sprinting) {
        var gw = g / 16;
        if (e.vy <= 0 && Math.abs(e.vy - 0.005) >= 0.003 && Math.abs(e.vy - gw) < 0.003) e.vy = -0.003;
        else e.vy -= gw;
      }
      if (Ph.MOB_WATER_HOP && e.horizontalCollision && boxFreeOfFluid(e, e.vx, e.vy + 0.6 - e.y + wy0, e.vz)) e.vy = Ph.MOB_WATER_HOP;
      return;
    }

    // LivingEntity.travel lava branch (isInLava && shouldSwimInFluids && !canWalkOnFluid): 0.02 accel, 0.5 damping
    // (y 0.8 only while fluidHeight <= swimHeight), gravity/4, the 0.3 wall hop. Strider walks on lava (moveOnLava).
    if (e.inLava && e.type !== 'strider') {
      var wy1 = e.y, sw = Ph.swimHeightOf(e);
      g = Ph.travelGravity(e);
      e.vx += (zza * sy - xxa * cy) * 0.02;
      e.vz += (-zza * cy - xxa * sy) * 0.02;
      Ph.move(e, e.vx, e.vy, e.vz);
      if (Ph.fluidHeightOf(e, 2) <= sw) { e.vx *= 0.5; e.vy *= 0.8; e.vz *= 0.5; }
      else { e.vx *= 0.5; e.vy *= 0.5; e.vz *= 0.5; }
      if (!e.noGravity) e.vy -= g / 4;
      if (e.horizontalCollision && boxFreeOfFluid(e, e.vx, e.vy + 0.6 - e.y + wy1, e.vz)) e.vy = 0.3;
      // tickMovement: swimUpward(lava) = +0.04 on the jump request (Slime/MagmaCube override via e.lavaSwimVy)
      if (e.jumping) e.vy = e.lavaSwimVy !== undefined ? e.lavaSwimVy : e.vy + Ph.SWIM_UP;
      e.jumping = false;
      return;
    }

    var f3 = Ph.frictionOf(e);
    var f1 = e.onGround ? f3 * Ph.AIR_FRICTION : Ph.AIR_FRICTION;
    var a  = e.onGround ? (e.mobSpeed || 0) * (Ph.FRICTION_CUBE / (f3 * f3 * f3))
                        : (e.airStrafingSpeed || Ph.MOB_FLYING_SPEED);   // ridden horse sets it each tick
    e.vx += (zza * sy - xxa * cy) * a;
    e.vz += (-zza * cy - xxa * sy) * a;

    // `LivingEntity.aiStep`'s own jump gate: the flag, on the ground, once. A caller doing its
    // own charged jump (`Mount.travelRidden`) sets `e.jumping = false` before this runs, same
    // as it always had to for a mob whose controller does not want the flat 0.42 hop.
    // MagmaCubeEntity.swimUpward(lava): vy = 0.22 + size*0.05 (`e.lavaSwimVy`, Sl.setSize).
    if (e.jumping && e.inLava && e.lavaSwimVy !== undefined) e.vy = e.lavaSwimVy;
    if (e.jumping && e.onGround) {
      // `e.jumpBonus`: MagmaCubeEntity.jump() = getJumpVelocity() + size*0.1 (Sl.setSize).
      e.vy = (e.jumpVelocity !== undefined ? e.jumpVelocity : Ph.JUMP * Ph.jumpFactorOf(e)) + (e.type === 'slime' || e.type === 'magma_cube' ? 0 : Ph.jumpBoostVelocity(e)) + (e.jumpBonus || 0);   // SlimeEntity.jump() overrides LivingEntity.jump(): no jump_boost
      e.jumpVelocity = undefined;   // RabbitEntity.getJumpVelocity: a per-hop override, spent here
      e.onGround = false;
    }
    e.jumping = false;
    g = Ph.travelGravity(e);       // #295: slow falling, read after the jump as vanilla's travel does

    Ph.climbClamp(e, null);
    if (e.type === 'strider') { Ph.striderFloat(e); Ph.moveOnLava(e, e.vx, e.vy, e.vz); }
    else Ph.move(e, e.vx, e.vy, e.vz);
    // SpiderEntity.tick: after super.tick(), setClimbingWall(horizontalCollision) -> SPIDER_FLAGS byte (default 0)
    if (e.type === 'spider' || e.type === 'cave_spider') e.climbingWall = !!e.horizontalCollision;

    var sf = Ph.speedFactorOf(e);
    if (sf !== 1) { e.vx *= sf; e.vz *= sf; }

    // D-773 cloud unit -- `LivingEntity.travel()`'s own `this.hasNoGravity() ? 0.0 : ...` gate
    // (.decomp), never ported here before now: nothing in this table set `e.noGravity` for a mob
    // going through THIS generic law (the fly/squid/fish laws each already gate their own gravity
    // term), so the gap was silent until shulker (07zzk_shulker.js) needed a mob that truly never
    // falls -- overriding `getVelocity()`/`setVelocity()` in vanilla, approximated here by simply
    // never letting gravity accumulate into `e.vy` for it.
    Ph.landGravity(e, g);          // #295: levitation replaces gravity; noGravity gates the rest
    if (e.noDrag) return;          // LivingEntity.hasNoDrag (goat long jump): setVelocity(x, y, z) undamped
    e.vy *= Ph.DRAG_Y;
    e.vx *= f1;
    e.vz *= f1;
  };

  /**
   * push(a, b) — `Entity.g(axk)` verbatim (D-417). Two entities that overlap shove each other
   * apart along the horizontal only, by a fixed 0.05 scaled by the RECIPROCAL of a distance
   * that vanilla takes the square root of AFTER `Mth.absMax` — an oddity that is in the
   * bytecode and is therefore the rule.
   */
  Ph.push = function (a, b) {
    if (a === b || a.noclip || b.noclip) return false;
    var d0 = b.x - a.x, d1 = b.z - a.z;
    var d2 = Math.max(Math.abs(d0), Math.abs(d1));
    if (d2 < Ph.PUSH_MIN) return false;
    d2 = Math.sqrt(d2);
    d0 /= d2; d1 /= d2;
    var d3 = 1 / d2;
    if (d3 > 1) d3 = 1;
    d0 *= d3; d1 *= d3;
    d0 *= Ph.PUSH_SCALE; d1 *= Ph.PUSH_SCALE;
    // `ShulkerEntity.pushAwayFrom` is empty: a shulker's own velocity never changes
    if (a.type !== 'shulker') { a.vx -= d0; a.vz -= d1; }
    if (b.type !== 'shulker') { b.vx += d0; b.vz += d1; }
    return true;
  };

  /** Do the two boxes overlap? `Entity.getBoundingBox().intersects(other)`. */
  Ph.boxesOverlap = function (a, b) {
    var ah = (a.width !== undefined ? a.width : Ph.W) * 0.5, aH = a.height || Ph.H;
    var bh = (b.width !== undefined ? b.width : Ph.W) * 0.5, bH = b.height || Ph.H;
    return (a.x - ah) < (b.x + bh) && (a.x + ah) > (b.x - bh) &&
           (a.y)      < (b.y + bH) && (a.y + aH) > (b.y) &&
           (a.z - ah) < (b.z + bh) && (a.z + ah) > (b.z - bh);
  };

  /**
   * isInWall(e) — `Entity.bm()` (D-417): a box `width * 0.8` across and 1e-6 tall at the eye,
   * against any cell whose collision shape is a full cube. Vanilla's predicate is
   * `state.isSuffocating` — `material.blocksMotion() && isCollisionShapeFullBlock()` — and
   * `Ph.shapeAt(...) === Ph.FULL_CUBE` is this engine's own form of that same question.
   */
  /** Blocks.java `.suffocates(Blocks::never)` on a full-cube block: glass, tinted/stained glass, leaves, moving_piston (#6613; piston/shulker predicates are per-state, not here). */
  var NEVER_SUFF = /^(glass|tinted_glass|[a-z_]+_stained_glass|[a-z_]+_leaves|moving_piston)$/, neverMemo = {};
  Ph.suffocatesNever = function (id) {   // id: a real state (names are per block; memo per state)
    var m = neverMemo[id];
    if (m === undefined) m = neverMemo[id] = NEVER_SUFF.test(String(NS.States.name(id)).replace(/^minecraft:/, '').replace(/\[.*$/, '')) ? 1 : 0;
    return m === 1;
  };
  /** InGameOverlayRenderer.getInWallBlockState sample points: 8 corners of a width*0.8 x 0.1 x width*0.8 box centred on the eye. */
  Ph.inWallSamples = function (e) {
    var w = e.width !== undefined ? e.width : Ph.W, ey = e.y + (e.height || Ph.H) * Ph.EYE_FRACTION, out = [];
    for (var i = 0; i < 8; i++) {
      out.push([e.x + ((i % 2) - 0.5) * w * 0.8, ey + (((i >> 1) % 2) - 0.5) * 0.1, e.z + (((i >> 2) % 2) - 0.5) * w * 0.8]);
    }
    return out;
  };
  /** The first sample whose state is visible and shouldBlockVision (suffocating: full cube, not glass/leaves) -> {state,x,y,z}, else null. Its sprite is the overlay (colour 0.1, alpha 1). */
  Ph.inWallState = function (e) {
    if (e.noclip) return null;
    var s = Ph.inWallSamples(e);
    for (var i = 0; i < 8; i++) {
      var x = Math.floor(s[i][0]), y = Math.floor(s[i][1]), z = Math.floor(s[i][2]);
      if (Ph.shapeAt(x, y, z) === Ph.FULL_CUBE) {
        var id = Ph.blockAt(x, y, z);
        if (!Ph.suffocatesNever(id)) return { state: id, x: x, y: y, z: z };
      }
    }
    return null;
  };
  Ph.isInWall = function (e) {
    if (e.noclip) return false;
    var f = ((e.width !== undefined ? e.width : Ph.W) * Ph.IN_WALL_SHRINK) * 0.5;
    var ey = e.y + (e.height || Ph.H) * Ph.EYE_FRACTION;
    var y = Math.floor(ey);
    for (var x = Math.floor(e.x - f); x <= Math.floor(e.x + f); x++) {
      for (var z = Math.floor(e.z - f); z <= Math.floor(e.z + f); z++) {
        if (Ph.shapeAt(x, y, z) === Ph.FULL_CUBE && !Ph.suffocatesNever(Ph.blockAt(x, y, z))) return true;
      }
    }
    return false;
  };
})(MCL);
