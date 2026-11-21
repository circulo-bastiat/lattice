// 07g_piston.js — PLAN G15c: PISTONS. What moves, what breaks, and what refuses.
//
// ⚠⚠ EVERY RULE HERE IS READ OUT OF THE 1.18.2 BYTECODE (D-298). Pistons are the part of
// redstone with the most folklore attached to it and the least data behind it: not one of these
// rules is in a JSON file, a tag or `minecraft-data`. The classes were located BY USE —
// `Blocks.<clinit>` registers `sticky_piston` through a helper whose DESCRIPTOR returns `coo`,
// which is therefore `PistonBaseBlock`; `cop` is the head, `com` the moving block and `cos` the
// structure resolver, each named the same way (D-263, ninth time).
//
// THE FIVE THINGS A CLONE GETS WRONG, all of which this file gets from the jar:
//
//   1. ⚠ THE PUSH LIMIT IS TWELVE **BLOCKS**, NOT TWELVE CELLS OF LENGTH. The resolver counts
//      the list it has built, and a slime blob that branches sideways spends the same budget as
//      a straight column. `bipush 12` appears three times in `addBlockLine` and once as
//      `PistonStructureResolver.MAX_PUSH_DEPTH`.
//   2. ⚠ A PISTON CHECKS THE BLOCK **ABOVE** IT FOR POWER. `getNeighborSignal` asks its own five
//      non-facing sides, then its OWN cell from below, then all six sides of the cell one block
//      up. That is quasi-connectivity — the thing every BUD switch in the game is built on — and
//      it is not a bug to be tidied away; it is what the compiled method does.
//   3. ⚠ `isPushable` REFUSES FOUR THINGS THAT ARE NOT IN THE PushReaction TABLE: obsidian,
//      crying obsidian and the respawn anchor BY NAME; anything whose destroy speed is −1
//      (bedrock, barrier, the portals); an already-EXTENDED piston; and anything with a block
//      entity. A table-only implementation pushes a chest.
//   4. ⚠ SLIME AND HONEY DO NOT STICK TO EACH OTHER, and that is a two-line special case in
//      `canStickToEachOther` sitting in front of the general "either of them is sticky" rule.
//   5. ⚠ THE BACKWARD WALK. `addBlockLine` does not only look FORWARD from the block it was
//      given; while the block is sticky it walks BACKWARDS along the push axis dragging the
//      chain behind it, and only then scans forward. Leaving that out gives slime blocks that
//      push what is in front of them and abandon what is stuck behind.
//
// THE MOVING BLOCK IS DRAWN part-way between its two cells: `P.renderParts` is the vanilla draw list
// (PistonBlockEntityRenderer) and `ER.beWorldVisible` (07j) emits it at the interpolated offset.
// Entities a piston pushes (P.pushEntities) are #6735's.
(function (NS) {
  'use strict';

  var P = NS.Piston = {
    ready: false,
    /** `PistonStructureResolver.MAX_PUSH_DEPTH`. */
    MAX_PUSH: 12,
    /** `PistonMovingBlockEntity` advances `progress` by this much per tick, capped at 1. */
    PROGRESS_PER_TICK: 0.5,
    /** ⚠ Refused BY NAME in `isPushable`, ahead of the PushReaction table. */
    NEVER_MOVES: ['obsidian', 'crying_obsidian', 'respawn_anchor'],
    TRIGGER_EXTEND: 0, TRIGGER_CONTRACT: 1, TRIGGER_DROP: 2
  };

  var R = null, S = null, B = null, Rs = null, BE = null, w = null;
  var DX, DY, DZ, OPP;
  var blkPiston = -1, blkSticky = -1, blkHead = -1, blkMoving = -1, blkSlime = -1, blkHoney = -1;
  var neverMoves = null, pushReaction = null;
  var inMove = false;

  /** `PushReaction`, in the enum's own order. */
  P.NORMAL = 0; P.DESTROY = 1; P.BLOCK = 2; P.IGNORE = 3; P.PUSH_ONLY = 4;

  /**
   * ⚠ NO `world` PARAMETER, FOR D-302's REASON: `Main` used to pass `NS.World`, whose `get` takes
   * CHUNK coordinates, and a piston reading through it saw `undefined` everywhere.
   */
  P.init = function () {
    R = NS.Reg; S = NS.States; B = NS.Behave; Rs = NS.Redstone;
    if (!R || !R.ready || !S || !S.ready || !B) { P.ready = false; return P; }
    // ⚠ THE SAME ADAPTER THE REDSTONE MODULE TAKES, AND FOR THE SAME REASON (D-302): `NS.World.get`
    // is the CHUNK getter. A piston reading the world through it sees `undefined` everywhere and
    // never fires.
    w = (B && B.w) || null;
    if (!w) { P.ready = false; return P; }
    DX = B.DX; DY = B.DY; DZ = B.DZ; OPP = B.OPP;
    BE = (NS.BlockEntities && NS.BlockEntities.ready) ? NS.BlockEntities : null;
    P.store = BE ? 'blockentity' : 'none';

    blkPiston = R.id.piston; blkSticky = R.id.sticky_piston;
    blkHead = R.id.piston_head; blkMoving = R.id.moving_piston;
    blkSlime = R.id.slime_block; blkHoney = R.id.honey_block;

    neverMoves = new Uint8Array(R.blockCount);
    for (var i = 0; i < P.NEVER_MOVES.length; i++) {
      var b = R.id[P.NEVER_MOVES[i]];
      if (b !== undefined) neverMoves[b] = 1;
    }
    // ⚠ THE TABLE IS THE GOLDEN ONE, BAKED. `tools/extract-push.mjs` derives every block's
    // `PushReaction` from the jar — the material's default plus fourteen block overrides — and
    // `pack-runtime` writes it into `R.push`. A per-block array indexed by block id, because a
    // slime blob asks this question once per candidate cell per activation.
    pushReaction = R.push || null;
    P.ready = true;
    return P;
  };
  // `P.attach` is gone for D-302's reason — see the note in `07f_redstone.js`.
  P.worldIsBehaveAdapter = function () { return !!B && w === B.w; };

  /** `BlockBehaviour.getPistonPushReaction` — NORMAL when the table has not been packed in. */
  P.reactionOf = function (state) {
    if (state === 0 || !P.ready) return P.NORMAL;
    return pushReaction ? (pushReaction[S.block[state]] | 0) : P.NORMAL;
  };

  P.isPiston = function (st) {
    if (st === 0 || !P.ready) return false;
    var b = S.block[st];
    return b === blkPiston || b === blkSticky;
  };
  P.isSticky = function (st) {
    if (st === 0 || !P.ready) return false;
    var b = S.block[st];
    return b === blkSlime || b === blkHoney;
  };

  /**
   * `PistonStructureResolver.canStickToEachOther`:
   *
   *     if (a is HONEY && b is SLIME) return false;
   *     if (a is SLIME && b is HONEY) return false;
   *     return isSticky(a) || isSticky(b);
   *
   * ⚠ BOTH ORDERS ARE WRITTEN OUT IN THE BYTECODE, which is why this file does not have to know
   * which obfuscated field is slime and which is honey: the rule is symmetric and the general
   * case below is symmetric too.
   */
  P.canStick = function (a, b) {
    if (a === 0 || b === 0) return false;
    var ba = S.block[a], bb = S.block[b];
    if (ba === blkHoney && bb === blkSlime) return false;
    if (ba === blkSlime && bb === blkHoney) return false;
    return P.isSticky(a) || P.isSticky(b);
  };

  function facingDir(state) {
    var f = B.propName(state, 'facing');
    return f === 'down' ? 0 : f === 'up' ? 1 : f === 'north' ? 2
         : f === 'south' ? 3 : f === 'west' ? 4 : f === 'east' ? 5 : -1;
  }
  P.facingDir = facingDir;
  P.MIN_Y = -64; P.MAX_Y = 320;

  /**
   * `PistonBaseBlock.isPushable(state, level, pos, movementDirection, allowDestroy, pistonFacing)`
   *
   * ⚠ AIR RETURNS **TRUE**, not false. The bytecode is `isAir() ? return true`, and it matters:
   * `addBlockLine` relies on a pushable-but-empty cell to end a line rather than to fail it.
   */
  P.isPushable = function (state, x, y, z, moveDir, allowDestroy, pistonDir) {
    if (y < P.MIN_Y || y > P.MAX_Y - 1) return false;
    if (NS.World && NS.World.border && !NS.World.border.contains(x, z)) return false;   // PistonBlock.isMovable: world border
    if (state === 0) return true;                                   // isAir
    if (neverMoves[S.block[state]] === 1) return false;             // obsidian and friends, BY NAME
    if (moveDir === 0 && y === P.MIN_Y) return false;
    if (moveDir === 1 && y === P.MAX_Y - 1) return false;
    if (P.isPiston(state)) {
      if (Rs && Rs.boolProp ? Rs.boolProp(state, 'extended') : B.propName(state, 'extended') === 'true') return false;
    } else {
      // ⚠ `getDestroySpeed == -1` IS THE BEDROCK RULE, and it is not the same question as the
      // PushReaction table — bedrock's reaction is NORMAL. `R.hard` stores −1 as Infinity.
      var h = R.hard ? R.hard[S.block[state]] : 0;
      if (!isFinite(h)) return false;
      var re = P.reactionOf(state);
      if (re === P.BLOCK) return false;
      if (re === P.DESTROY) return !!allowDestroy;
      if (re === P.PUSH_ONLY) return moveDir === pistonDir;
    }
    // ⚠ AND ANYTHING WITH A BLOCK ENTITY REFUSES, which is why a chest, a furnace and a sign
    // all stop a piston even though their materials say NORMAL.
    return !(BE && BE.stateHasEntity && BE.stateHasEntity(state));
  };

  // ── the structure resolver ────────────────────────────────────────────────────────────────
  /**
   * `PistonStructureResolver` — the list of cells a piston would move, and the list it would
   * destroy, or `null` when it cannot fire at all. Faithful to the class, including the order
   * of the push list, which `reorderListAtCollision` rewrites when a branch meets the trunk.
   */
  function Resolver(px, py, pz, pistonDir, extending) {
    this.px = px; this.py = py; this.pz = pz;
    this.pistonDir = pistonDir;
    this.extending = extending;
    this.pushDir = extending ? pistonDir : OPP[pistonDir];
    // the cell the resolver starts from: one ahead when extending, two ahead when retracting
    var n = extending ? 1 : 2;
    this.sx = px + DX[pistonDir] * n;
    this.sy = py + DY[pistonDir] * n;
    this.sz = pz + DZ[pistonDir] * n;
    this.toPush = [];                            // flat [x,y,z,...]
    this.toDestroy = [];
  }
  var key = function (x, y, z) { return x + ',' + y + ',' + z; };
  Resolver.prototype.indexOf = function (x, y, z) {
    for (var i = 0; i < this.toPush.length; i += 3) {
      if (this.toPush[i] === x && this.toPush[i + 1] === y && this.toPush[i + 2] === z) return i / 3;
    }
    return -1;
  };
  Resolver.prototype.count = function () { return this.toPush.length / 3; };

  Resolver.prototype.resolve = function () {
    this.toPush.length = 0; this.toDestroy.length = 0;
    var st = w.get(this.sx, this.sy, this.sz);
    if (!P.isPushable(st, this.sx, this.sy, this.sz, this.pushDir, false, this.pistonDir)) {
      // ⚠ A BLOCK THE PISTON CANNOT MOVE IS STILL BROKEN IF ITS REACTION IS DESTROY — but only
      // when EXTENDING. A retracting sticky piston leaves a torch standing.
      if (this.extending && P.reactionOf(st) === P.DESTROY) {
        this.toDestroy.push(this.sx, this.sy, this.sz);
        return true;
      }
      return false;
    }
    if (!this.addBlockLine(this.sx, this.sy, this.sz, this.pushDir)) return false;
    for (var i = 0; i < this.toPush.length; i += 3) {
      var x = this.toPush[i], y = this.toPush[i + 1], z = this.toPush[i + 2];
      if (P.isSticky(w.get(x, y, z)) && !this.addBranchingBlocks(x, y, z)) return false;
    }
    return true;
  };

  Resolver.prototype.addBlockLine = function (ox, oy, oz, dir) {
    var st = w.get(ox, oy, oz);
    if (st === 0) return true;
    if (!P.isPushable(st, ox, oy, oz, this.pushDir, false, dir)) return true;
    if (ox === this.px && oy === this.py && oz === this.pz) return true;
    if (this.indexOf(ox, oy, oz) >= 0) return true;

    var back = OPP[this.pushDir];
    var n = 1;
    if (n + this.count() > P.MAX_PUSH) return false;
    // ⚠ THE BACKWARD WALK — see the header. While the chain is sticky, drag what is behind it.
    while (P.isSticky(st)) {
      var bx = ox + DX[back] * n, by = oy + DY[back] * n, bz = oz + DZ[back] * n;
      var prev = st;
      st = w.get(bx, by, bz);
      if (st === 0 || !P.canStick(prev, st)
          || !P.isPushable(st, bx, by, bz, this.pushDir, false, back)
          || (bx === this.px && by === this.py && bz === this.pz)) break;
      n++;
      if (n + this.count() > P.MAX_PUSH) return false;
    }
    var added = 0, k;
    for (k = n - 1; k >= 0; k--) {
      this.toPush.push(ox + DX[back] * k, oy + DY[back] * k, oz + DZ[back] * k);
      added++;
    }
    var j = 1;
    for (;;) {
      var ax = ox + DX[this.pushDir] * j, ay = oy + DY[this.pushDir] * j, az = oz + DZ[this.pushDir] * j;
      var idx = this.indexOf(ax, ay, az);
      if (idx > -1) {
        // ⚠ THE BRANCH HAS MET THE TRUNK. Vanilla re-orders the list so the newly added run
        // sits ahead of everything from the collision point on; the order is what decides which
        // cell is written first, and writing them in the wrong order overwrites a moved block.
        this.reorderAtCollision(added, idx);
        for (var m = 0; m <= idx + added; m++) {
          var qx = this.toPush[m * 3], qy = this.toPush[m * 3 + 1], qz = this.toPush[m * 3 + 2];
          if (P.isSticky(w.get(qx, qy, qz)) && !this.addBranchingBlocks(qx, qy, qz)) return false;
        }
        return true;
      }
      st = w.get(ax, ay, az);
      if (st === 0) return true;
      if (!P.isPushable(st, ax, ay, az, this.pushDir, true, this.pushDir)
          || (ax === this.px && ay === this.py && az === this.pz)) return false;
      if (P.reactionOf(st) === P.DESTROY) { this.toDestroy.push(ax, ay, az); return true; }
      if (this.count() >= P.MAX_PUSH) return false;
      this.toPush.push(ax, ay, az);
      added++;
      j++;
    }
  };

  Resolver.prototype.reorderAtCollision = function (count, index) {
    var all = this.toPush, n = all.length / 3;
    var head = all.slice(0, index * 3);
    var tail = all.slice((n - count) * 3, n * 3);
    var mid = all.slice(index * 3, (n - count) * 3);
    this.toPush = head.concat(tail, mid);
  };

  Resolver.prototype.addBranchingBlocks = function (x, y, z) {
    var self = w.get(x, y, z);
    var axis = this.pushDir >> 1;                       // 0 Y, 1 Z, 2 X — the pair index
    for (var d = 0; d < 6; d++) {
      if ((d >> 1) === axis) continue;                  // `d.getAxis() == pushDirection.getAxis()`
      var nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d];
      if (!P.canStick(w.get(nx, ny, nz), self)) continue;
      if (!this.addBlockLine(nx, ny, nz, d)) return false;
    }
    return true;
  };

  /** The public shape: `{ toPush, toDestroy, pushDir }`, or null when the piston cannot fire. */
  P.resolve = function (x, y, z, pistonDir, extending) {
    if (!P.ready) return null;
    var r = new Resolver(x, y, z, pistonDir, extending);
    if (!r.resolve()) return null;
    return { toPush: r.toPush.slice(), toDestroy: r.toDestroy.slice(), pushDir: r.pushDir };
  };

  // ── the power test ────────────────────────────────────────────────────────────────────────
  /**
   * `PistonBaseBlock.getNeighborSignal(level, pos, facing)`:
   *
   *     for (d : all six)  if (d != facing && level.hasSignal(pos.relative(d), d)) return true;
   *     if (level.hasSignal(pos, DOWN)) return true;
   *     BlockPos up = pos.above();
   *     for (d : all six)  if (d != DOWN && level.hasSignal(up.relative(d), d)) return true;
   *     return false;
   *
   * ⚠⚠ THE SECOND LOOP IS QUASI-CONNECTIVITY AND IT IS NOT A MISTAKE TO CORRECT. A piston fires
   * when the cell ONE ABOVE it is powered, by anything, from any side. Every BUD switch and half
   * the door designs in the game are built on it; "tidying" it away would break more contraptions
   * than any other single deviation in this file.
   * ⚠ And the middle line asks the piston's OWN cell with DOWN, which is how a block under the
   * piston that is strongly powered reaches it.
   */
  P.neighborSignal = function (x, y, z, facing) {
    if (!Rs || !Rs.ready) return false;
    var d;
    for (d = 0; d < 6; d++) {
      if (d === facing) continue;
      if (Rs.hasSignalAt(x + DX[d], y + DY[d], z + DZ[d], d)) return true;
    }
    if (Rs.hasSignalAt(x, y, z, 0)) return true;
    for (d = 0; d < 6; d++) {
      if (d === 0) continue;
      if (Rs.hasSignalAt(x + DX[d], y + 1 + DY[d], z + DZ[d], d)) return true;
    }
    return false;
  };

  // ── the move ──────────────────────────────────────────────────────────────────────────────
  function movingEntity(x, y, z, movedState, dir, extending, source) {
    if (!BE) return null;
    var e = BE.get(x, y, z);
    if (!e || e.type !== 'piston') e = BE.create(x, y, z, 'piston');
    e.movedState = movedState; e.dir = dir;
    e.extending = !!extending; e.source = !!source;
    e.progress = 0; e.lastProgress = 0; e.savedWorldTime = 0;
    return e;
  }

  /** `MovingPistonBlock` — the placeholder that stands in the cell for two ticks. */
  function movingState(dir, sticky) {
    var st = S.stateOf('moving_piston');
    st = B.setProp(st, 'facing', ['down', 'up', 'north', 'south', 'west', 'east'][dir]);
    st = B.setProp(st, 'type', sticky ? 'sticky' : 'normal');
    return st;
  }
  function headState(dir, sticky) {
    var st = S.stateOf('piston_head');
    st = B.setProp(st, 'facing', ['down', 'up', 'north', 'south', 'west', 'east'][dir]);
    st = B.setProp(st, 'type', sticky ? 'sticky' : 'normal');
    return st;
  }

  /**
   * `PistonBaseBlock.moveBlocks`. ⚠ THE WRITE ORDER IS THE WHOLE PROBLEM: every pushed cell is
   * vacated and every destination filled, and a naive loop overwrites a block that has not moved
   * yet. Vanilla solves it by writing the DESTINATIONS from the far end backwards while keeping
   * a map of the cells that still need clearing, and removing from that map any cell a
   * destination has already claimed. This does the same.
   */
  P.moveBlocks = function (x, y, z, facing, extending) {
    if (!P.ready) return false;
    var hx = x + DX[facing], hy = y + DY[facing], hz = z + DZ[facing];
    if (!extending && S.block[w.get(hx, hy, hz)] === blkHead) w.set(hx, hy, hz, 0);

    var res = P.resolve(x, y, z, facing, extending);
    if (!res) return false;
    var move = extending ? facing : OPP[facing];
    var i, px, py, pz;

    // the states, read BEFORE anything moves
    var states = [], vacate = Object.create(null);
    for (i = 0; i < res.toPush.length; i += 3) {
      px = res.toPush[i]; py = res.toPush[i + 1]; pz = res.toPush[i + 2];
      states.push(w.get(px, py, pz));
      vacate[key(px, py, pz)] = [px, py, pz];
    }
    // the destroyed ones, far end first
    var drops = [];
    for (i = res.toDestroy.length - 3; i >= 0; i -= 3) {
      px = res.toDestroy[i]; py = res.toDestroy[i + 1]; pz = res.toDestroy[i + 2];
      var dst = w.get(px, py, pz);
      drops.push(dst);
      w.set(px, py, pz, 0);
      // `PistonBlock.move`: `Block.dropStacks(state, world, pos, blockEntity)` (no tool, no entity)
      var Lt = NS.Loot, EL = NS.EntityList, It = NS.Items;
      if (Lt && Lt.ready && EL && EL.ready && EL.popResource && It && It.of) {
        var ls = Lt.drops({ state: dst, noEntity: true });
        for (var li = 0; li < ls.length; li++) {
          var ii = It.of(ls[li].item);
          if (ii >= 0) EL.popResource(px, py, pz, ii, ls[li].count || 1);
        }
      }
    }
    // the pushed ones, LAST FIRST, each into its destination
    var sticky = S.block[w.get(x, y, z)] === blkSticky;
    for (i = res.toPush.length - 3; i >= 0; i -= 3) {
      var n = i / 3;
      px = res.toPush[i]; py = res.toPush[i + 1]; pz = res.toPush[i + 2];
      var dx = px + DX[move], dy = py + DY[move], dz = pz + DZ[move];
      delete vacate[key(dx, dy, dz)];
      var ms = movingState(facing, false);
      w.set(dx, dy, dz, ms);
      movingEntity(dx, dy, dz, states[n], facing, extending, false);
    }
    if (extending) {
      delete vacate[key(hx, hy, hz)];
      w.set(hx, hy, hz, movingState(facing, sticky));
      movingEntity(hx, hy, hz, headState(facing, sticky), facing, true, true);
    }
    // everything that moved away and was not claimed by a destination becomes air
    for (var k in vacate) {
      var c = vacate[k];
      w.set(c[0], c[1], c[2], 0);
    }
    P.lastMove = { push: res.toPush.slice(), destroy: res.toDestroy.slice(), move: move, drops: drops };
    // `move()`'s tail: `updateNeighborsAlways` at every destroyed cell, every moved block's OLD
    // cell and (extending) the head's cell — NOW, not when the blocks land two ticks later. A
    // lamp beside a redstone block that a sticky piston pulls away starts its 4-tick turn-off
    // the tick the block leaves (redrefcheck `piston_pushes_power`, the real server).
    if (B.changed) {
      for (i = res.toDestroy.length - 3; i >= 0; i -= 3) B.changed(res.toDestroy[i], res.toDestroy[i + 1], res.toDestroy[i + 2]);
      for (i = res.toPush.length - 3; i >= 0; i -= 3) B.changed(res.toPush[i], res.toPush[i + 1], res.toPush[i + 2]);
      if (extending) B.changed(hx, hy, hz);
    }
    return true;
  };

  // ── entities (PistonBlockEntity.pushEntities / moveEntitiesInHoneyBlock) ───────────────────
  var AXV = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];   // Direction order down,up,north,south,west,east
  var NO_PUSH = { marker: 1, area_effect_cloud: 1 };   // `PistonBehavior.IGNORE` overrides

  function pushable(e) {
    if (!e || e.removed) return false;
    if (NO_PUSH[e.type]) return false;
    if (e.type === 'armor_stand' && e.marker) return false;
    return true;
  }
  function entBox(e) {
    var hw = (e.width !== undefined ? e.width : 0.6) * 0.5, h = e.height || 1.8;
    return [e.x - hw, e.y, e.z - hw, e.x + hw, e.y + h, e.z + hw];
  }
  function candidates() {
    var l = (NS.EntityList && NS.EntityList.list) ? NS.EntityList.list.slice() : [];
    if (NS.Player && l.indexOf(NS.Player) < 0) l.push(NS.Player);
    return l;
  }
  /** `Boxes.stretch(box, dir, amount)`: grow on the side the movement points to. */
  function stretch(b, dir, a) {
    var v = AXV[dir], o = b.slice();
    for (var i = 0; i < 3; i++) {
      if (v[i] > 0) o[3 + i] += a * v[i]; else if (v[i] < 0) o[i] += a * v[i];
    }
    return o;
  }
  function hit(a, b) {
    return a[0] < b[3] && a[3] > b[0] && a[1] < b[4] && a[4] > b[1] && a[2] < b[5] && a[5] > b[2];
  }
  /** `getIntersectionSize(box, dir, other)`. */
  function isect(a, dir, o) {
    switch (dir) {
      case 5: return a[3] - o[0];
      case 4: return o[3] - a[0];
      case 1: return a[4] - o[1];
      case 0: return o[4] - a[1];
      case 3: return a[5] - o[2];
      default: return o[5] - a[2];
    }
  }
  /**
   * `PistonBlockEntityRenderer.render` + `PistonBlockEntity.getProgress/getRenderOffset*`: what a moving_piston cell
   * DRAWS at `delta` (0..1) of a tick. Returns parts {state, cell:[x,y,z], off:[x,y,z], moving}; the first is the offset
   * block, a retracting source adds the extended base at its destination, unoffset.
   */
  P.renderParts = function (e, x, y, z, delta) {
    var st = e.movedState;
    if (!st) return [];
    var d = delta > 1 ? 1 : delta, pr = e.lastProgress + (e.progress - e.lastProgress) * d;
    var a = amountExtended(e, pr), v = AXV[e.dir], off = [v[0] * a, v[1] * a, v[2] * a];
    var md = e.extending ? e.dir : (e.dir ^ 1);
    var cx = x - AXV[md][0], cy = y - AXV[md][1], cz = z - AXV[md][2];
    var out = [], nm = R.names[S.block[st]];
    if (nm === 'piston_head') {
      out.push({ state: B.setProp(st, 'short', pr <= 0.5), cell: [cx, cy, cz], off: off });
    } else if (e.source && !e.extending) {
      var head = headState(e.dir, nm === 'sticky_piston');
      head = B.setProp(B.setProp(head, 'facing', B.propName(st, 'facing')), 'short', pr >= 0.5);
      out.push({ state: head, cell: [cx, cy, cz], off: off });
      out.push({ state: B.setProp(st, 'extended', true), cell: [cx + AXV[md][0], cy + AXV[md][1], cz + AXV[md][2]], off: [0, 0, 0] });
    } else {
      out.push({ state: st, cell: [cx, cy, cz], off: off });
    }
    return out;
  };
  function offsetBox(b, ox, oy, oz) { return [b[0] + ox, b[1] + oy, b[2] + oz, b[3] + ox, b[4] + oy, b[5] + oz]; }
  function amountExtended(e, progress) { return e.extending ? progress - 1 : 1 - progress; }
  function offsetHead(x, y, z, b, e) {
    var a = amountExtended(e, e.progress), v = AXV[e.dir];
    return offsetBox(b, x + a * v[0], y + a * v[1], z + a * v[2]);
  }
  /**
   * `Entity.move(MovementType.PISTON)` -> `adjustMovementForPiston`: the per-tick running total on
   * each axis is clamped to +-0.51, so two pistons (or a push plus a retract) cannot throw an
   * entity further than half a block and a bit in one tick.
   */
  P.PISTON_CLAMP = 0.51;
  P.moveEntity = function (ent, dir, amount) {
    var v = AXV[dir], t = (B && B.gameTime) | 0;
    if (ent.pistonMovementTick !== t || !ent.pistonMovementDelta) { ent.pistonMovementDelta = [0, 0, 0]; ent.pistonMovementTick = t; }
    var d = [amount * v[0], amount * v[1], amount * v[2]], ax = d[0] !== 0 ? 0 : d[1] !== 0 ? 1 : d[2] !== 0 ? 2 : -1;
    if (ax < 0 || d[0] * d[0] + d[1] * d[1] + d[2] * d[2] <= 1e-7) return;
    var c = Math.max(-P.PISTON_CLAMP, Math.min(P.PISTON_CLAMP, d[ax] + ent.pistonMovementDelta[ax]));
    var r = c - ent.pistonMovementDelta[ax];
    ent.pistonMovementDelta[ax] = c;
    if (Math.abs(r) <= 1e-5) return;
    var m = [0, 0, 0]; m[ax] = r;
    if (NS.Physics && NS.Physics.move) NS.Physics.move(ent, m[0], m[1], m[2]);
    else { ent.x += m[0]; ent.y += m[1]; ent.z += m[2]; }
  };
  function pushBack(x, y, z, ent, dir, amount) {
    var b = entBox(ent), cell = [x, y, z, x + 1, y + 1, z + 1];
    if (!hit(b, cell)) return;
    var back = dir ^ 1;
    var inter = [Math.max(b[0], cell[0]), Math.max(b[1], cell[1]), Math.max(b[2], cell[2]),
                 Math.min(b[3], cell[3]), Math.min(b[4], cell[4]), Math.min(b[5], cell[5])];
    var a = isect(cell, back, b) + 0.01, c = isect(cell, back, inter) + 0.01;
    if (Math.abs(a - c) < 0.01) { a = Math.min(a, amount) + 0.01; P.moveEntity(ent, back, a); }
  }
  /** `PistonBlockEntity.pushEntities` + `moveEntitiesInHoneyBlock`, run with the NEW progress. */
  P.pushEntities = function (x, y, z, e, newProgress) {
    var dir = e.extending ? e.dir : (e.dir ^ 1), delta = newProgress - e.progress;
    var moved = e.movedState, name = (NS.Reg && NS.Reg.names) ? NS.Reg.names[S.block[moved]] : '';
    var head = (!e.extending && e.source && /^(sticky_)?piston$/.test(name)) ? headState(e.dir, name === 'sticky_piston') : moved;
    var shapes = (NS.Physics && NS.Physics.shapesFor) ? NS.Physics.shapesFor(head) : [[0, 0, 0, 1, 1, 1]];
    var ents = candidates();
    if (shapes && shapes.length) {
      var bb = shapes[0].slice(), i, k;
      for (i = 1; i < shapes.length; i++) for (k = 0; k < 3; k++) { bb[k] = Math.min(bb[k], shapes[i][k]); bb[3 + k] = Math.max(bb[3 + k], shapes[i][3 + k]); }
      var hb = offsetHead(x, y, z, bb, e), area = stretch(hb, dir, delta);
      for (k = 0; k < 3; k++) { area[k] = Math.min(area[k], hb[k]); area[3 + k] = Math.max(area[3 + k], hb[3 + k]); }
      var slime = name === 'slime_block';
      for (i = 0; i < ents.length; i++) {
        var en = ents[i];
        if (!pushable(en) || !hit(area, entBox(en))) continue;
        if (slime) {
          if (en === NS.Player) continue;   // the slime launch skips a ServerPlayerEntity entirely
          var v = AXV[dir];
          if (v[0]) en.vx = v[0]; else if (v[1]) en.vy = v[1]; else en.vz = v[2];
        }
        var best = 0, eb = entBox(en);
        for (var j = 0; j < shapes.length; j++) {
          var sb = stretch(offsetHead(x, y, z, shapes[j], e), dir, delta);
          if (hit(sb, eb)) { best = Math.max(best, isect(sb, dir, eb)); if (best >= delta) break; }
        }
        if (best > 0) {
          best = Math.min(best, delta) + 0.01;
          P.moveEntity(en, dir, best);
          if (!e.extending && e.source) pushBack(x, y, z, en, dir, delta);
        }
      }
    }
    // honey: ride the block sideways
    if (name === 'honey_block' && dir >= 2) {
      var top = 0; for (var si = 0; si < shapes.length; si++) top = Math.max(top, shapes[si][4]);
      var hb2 = offsetHead(x, y, z, [0, top, 0, 1, 1.5000000999999998, 1], e);
      for (var n = 0; n < ents.length; n++) {
        var q = ents[n];
        if (pushable(q) && q.onGround && q.x >= hb2[0] && q.x <= hb2[3] && q.z >= hb2[2] && q.z <= hb2[5] && hit(hb2, entBox(q))) P.moveEntity(q, dir, delta);
      }
    }
  };

  /**
   * `PistonMovingBlockEntity.tick` + `finalTick`, which together are the two-tick animation.
   * ⚠ `progress += 0.5` PER TICK, CAPPED AT 1 — a literal `float 0.5f` in the class — and the
   * block is placed on the tick after it reaches 1, so a moving block holds its cell for exactly
   * two samples; a circuit built on one is a different circuit.
   */
  P.tickMoving = function (x, y, z) {
    if (!P.ready || !BE) return false;
    var e = BE.get(x, y, z);
    if (!e || e.type !== 'piston' || e.movedState === undefined) return false;
    // ⚠ The block lands on the tick AFTER progress reaches 1 (`lastProgress >= 1.0F` is read
    // before the add), so a moving block holds its cell for two samples, not one.
    e.savedWorldTime = (NS.Behave && NS.Behave.gameTime) | 0;
    e.lastProgress = e.progress;
    if (e.lastProgress >= 1) return P.finishMoving(x, y, z);
    var np = e.progress + P.PROGRESS_PER_TICK;
    P.pushEntities(x, y, z, e, np);
    e.progress = np;
    if (e.progress >= 1) e.progress = 1;
    return false;
  };

  /** Place the block the entity was carrying and drop the placeholder. */
  P.finishMoving = function (x, y, z) {
    if (!P.ready || !BE) return false;
    var e = BE.get(x, y, z);
    if (!e || e.type !== 'piston' || e.movedState === undefined) return false;
    var put = e.movedState;
    BE.remove(x, y, z);
    if (S.block[w.get(x, y, z)] !== blkMoving) return false;
    w.set(x, y, z, put);
    if (B.changed) B.changed(x, y, z);
    return true;
  };

  /** Force every in-flight piston block to land. The check uses it; so does a save on quit. */
  P.settleAll = function () {
    if (!P.ready || !BE) return 0;
    var todo = [];
    BE.forEach(function (e) { if (e.type === 'piston' && e.movedState !== undefined) todo.push(e.x, e.y, e.z); });
    var n = 0;
    for (var i = 0; i < todo.length; i += 3) if (P.finishMoving(todo[i], todo[i + 1], todo[i + 2])) n++;
    return n;
  };

  // ── the trigger ───────────────────────────────────────────────────────────────────────────
  // `PistonBlock.tryMove` decides and QUEUES a block event (`addSyncedBlockEvent`, type 0 extend,
  // 1 retract, 2 retract-and-drop); `ServerWorld.processSyncedBlockEvents` runs the queue after the
  // tick's scheduled block/fluid ticks and before entities and block entities, and
  // `PistonBlock.onSyncedBlockEvent` re-checks power and does the move. ⚠ The move is therefore
  // NOT inline with the change that powered the piston: a lever flipped between two ticks moves
  // the piston during the NEXT tick (redrefcheck's `piston*` scenarios, the real server). The
  // queue is an insertion-ordered set (`ObjectLinkedOpenHashSet`): the same event twice is once.
  var events = [], eventKeys = Object.create(null);
  function addEvent(x, y, z, type, data) {
    var k = x + ',' + y + ',' + z + ',' + type + ',' + data;
    if (eventKeys[k]) return;
    eventKeys[k] = true;
    events.push([x, y, z, type, data, k]);
  }
  P.pendingEvents = function () { return events.length; };

  /**
   * `PistonBlock.tryMove`. ⚠ RE-ENTRANCY GUARD: `moveBlocks` writes a dozen cells, every write
   * runs `Behave.changed`, and that comes straight back here — the queue makes that harmless
   * (vanilla's own protection), the flag keeps a move from queueing against its own half-state.
   */
  P.check = function (x, y, z) {
    if (!P.ready || inMove) return false;
    var st = w.get(x, y, z);
    if (!P.isPiston(st)) return false;
    var facing = facingDir(st);
    if (facing < 0) return false;
    var extended = B.propName(st, 'extended') === 'true';
    var powered = P.neighborSignal(x, y, z, facing);
    if (powered && !extended) {
      if (!P.resolve(x, y, z, facing, true)) return false;
      addEvent(x, y, z, P.TRIGGER_EXTEND, facing);
      return true;
    }
    if (!powered && extended) {
      // type 2 (drop the block instead of pulling it) when the block two ahead is a piston block
      // still EXTENDING this way and under half-way -- vanilla's quick-pulse rule.
      var type = P.TRIGGER_CONTRACT;
      var fx = x + 2 * DX[facing], fy = y + 2 * DY[facing], fz = z + 2 * DZ[facing];
      var fst = w.get(fx, fy, fz), fe = BE && BE.get(fx, fy, fz);
      if (fst !== 0 && S.block[fst] === blkMoving && facingDir(fst) === facing && fe && fe.type === 'piston' &&
          fe.extending && (fe.lastProgress < 0.5 || ((NS.Behave && NS.Behave.gameTime) | 0) === fe.savedWorldTime ||
            !!(NS.Behave && NS.Behave.inBlockTick))) type = P.TRIGGER_DROP;
      addEvent(x, y, z, type, facing);
      return true;
    }
    return false;
  };

  function movingPistonAt(x, y, z) {
    var st = w.get(x, y, z);
    if (st === 0 || S.block[st] !== blkMoving || !BE) return null;
    var e = BE.get(x, y, z);
    return e && e.type === 'piston' && e.movedState !== undefined ? e : null;
  }

  /** `processSyncedBlockEvents`: run the queue, including events queued while it runs. */
  P.processEvents = function () {
    if (!P.ready) return 0;
    var n = 0;
    while (events.length) {
      var e = events.shift();
      delete eventKeys[e[5]];
      if (P.onEvent(e[0], e[1], e[2], e[3], e[4])) n++;
    }
    return n;
  };

  /** `PistonBlock.onSyncedBlockEvent`'s `playSound(null, pos, PISTON_EXTEND/CONTRACT, BLOCKS, 0.5F,
   *  rand*0.25F+0.6F / rand*0.15F+0.6F)`; a headless check has no sound layer, so it can hook `P.sounds`. */
  function pistonSound(x, y, z, extend) {
    var ev = extend ? 'block.piston.extend' : 'block.piston.contract';
    var pitch = Math.random() * (extend ? 0.25 : 0.15) + 0.6;
    var o = { volume: 0.5, pitch: pitch, x: x + 0.5, y: y + 0.5, z: z + 0.5 };
    if (NS.GameEvent) NS.GameEvent.emit(extend ? 'piston_extend' : 'piston_contract', x, y, z, null);   // world.emitGameEvent(PISTON_*, pos)
    if (P.sounds) P.sounds.push({ ev: ev, volume: 0.5, pitch: pitch });
    var Sn = NS.Sound, Pl = NS.Player;
    if (!Sn || !Sn.ready || !Sn.play) return;
    o.listener = Pl ? { x: Pl.x, y: Pl.y, z: Pl.z } : null;
    Sn.play(ev, o);
  }

  /** `PistonBlock.onSyncedBlockEvent` (the block must still be a piston -- `processBlockEvent`). */
  P.onEvent = function (x, y, z, type, data) {
    var st = w.get(x, y, z);
    if (!P.isPiston(st)) return false;
    var facing = facingDir(st);
    if (facing < 0) return false;
    var powered = P.neighborSignal(x, y, z, facing);
    if (powered && type !== P.TRIGGER_EXTEND) { w.set(x, y, z, B.setProp(st, 'extended', true)); return false; }
    if (!powered && type === P.TRIGGER_EXTEND) return false;
    inMove = true;
    try {
      if (type === P.TRIGGER_EXTEND) {
        if (!P.resolve(x, y, z, facing, true)) return false;
        if (!P.moveBlocks(x, y, z, facing, true)) return false;
        w.set(x, y, z, B.setProp(w.get(x, y, z), 'extended', true));
        pistonSound(x, y, z, true);
        return true;
      }
      // retracting. A plain piston just pulls its head in; a sticky one drags one block back
      // (type 1) or lets it go (type 2).
      var sticky = S.block[st] === blkSticky;
      var hx = x + DX[facing], hy = y + DY[facing], hz = z + DZ[facing];
      // a head still in flight lands first (`((PistonBlockEntity)be).finish()`)
      if (movingPistonAt(hx, hy, hz)) P.finishMoving(hx, hy, hz);
      // `setBlockState(pos, moving_piston, 20)` + a moving block entity carrying the retracted base
      // (`extending=false, source=true`): the base is NOT a piston for the two ticks it takes to
      // land, so it ignores power and cannot re-extend meanwhile. Done after the sticky pull
      // below because resolve() reads the base's own state.
      var baseDone = false;
      function retractBase() {
        if (baseDone) return; baseDone = true;
        w.set(x, y, z, movingState(facing, sticky));
        movingEntity(x, y, z, B.setProp(st, 'extended', false), facing, false, true);
        if (B.changed) B.changed(x, y, z);
        pistonSound(x, y, z, false);
      }
      if (sticky) {
        // a block two ahead still being pushed out this way is dropped where it is going,
        // not pulled back — the 1-tick-pulse "spit" (`$$13.finish(); $$11 = true`)
        var fx = x + 2 * DX[facing], fy = y + 2 * DY[facing], fz = z + 2 * DZ[facing];
        var fe = movingPistonAt(fx, fy, fz);
        if (fe && fe.extending && facingDir(w.get(fx, fy, fz)) === facing) {
          P.finishMoving(fx, fy, fz);
        } else if (type === P.TRIGGER_CONTRACT) {
          if (P.moveBlocks(x, y, z, facing, false)) { retractBase(); return true; }
        }
      }
      retractBase();
      if (S.block[w.get(hx, hy, hz)] === blkHead) w.set(hx, hy, hz, 0);
      return true;
    } finally { inMove = false; }
  };

  /** Settle every piston near a change, the way the torches and diodes are settled. */
  P.update = function (x, y, z, range) {
    if (!P.ready || inMove) return 0;
    var r = range === undefined ? 2 : range, n = 0;
    // ⚠ THE SWEEP REACHES ONE FURTHER **DOWN** THAN UP, because quasi-connectivity means a
    // piston one block BELOW a changed cell is the one that reacts to it.
    for (var dx = -r; dx <= r; dx++) {
      for (var dy = -r - 1; dy <= r; dy++) {
        for (var dz = -r; dz <= r; dz++) {
          if (P.check(x + dx, y + dy, z + dz)) n++;
        }
      }
    }
    return n;
  };
})(MCL);
