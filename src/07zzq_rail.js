// 07zzq_rail.js — #306 (G25): RAIL SHAPES. AbstractRailBlock + RailPlacementHelper + RailBlock's
// rotate/mirror + RailShape (.decomp/net/minecraft/block/), read whole.
// Runs on: MAIN THREAD ONLY. No DOM.
//
// What vanilla does, and where each part is hooked here:
//   * `getPlacementState` — north_south / east_west from the player's facing. Already D-157's
//     `placeFacing` rule 'rail' (14_player.js); not repeated.
//   * `canPlaceAt` — `hasTopRim(below)`. Already survival rule 1 (02k_survive.js); not repeated.
//   * `onBlockAdded` (only when the OLD state was a different block) -> `updateCurves`:
//     `new RailPlacementHelper(..).updateBlockState(isReceivingRedstonePower, true, shape)`, which
//     picks this rail's shape from the rails around it and then re-shapes each neighbour that can
//     take it (`computeRailShape`). Straight-only rails (powered, detector, activator: `forbidCurves`)
//     then run their own `neighborUpdate`. Hooked as `Rail.changed(x,y,z,old)` from Behave.changed.
//   * `neighborUpdate` — `shouldDropRail` (no rim below, or no rim on the RAISED side of an ascending
//     shape) drops and removes it; otherwise `updateBlockState(state, world, pos, sourceBlock)`, which
//     for RailBlock re-runs the helper (force=false) when the source block emits redstone power and
//     the rail has three rail neighbours — the powered T-junction switch. PoweredRailBlock's own
//     override is power propagation and lives in 07f_redstone.js (updateRails); it is not re-ported.
//   * `onStateReplaced` — an ascending rail notifies the neighbours of the cell above it; a
//     straight-only rail notifies its own neighbours and the cell below's.
//   * `rotate` / `mirror` — ported with vanilla's switch FALL-THROUGH: CLOCKWISE_180 has no case for
//     north_south / east_west and falls into COUNTERCLOCKWISE_90, so a 180-turned straight rail comes
//     out perpendicular. That is 1.18.2's behaviour and railcheck parses the Java to hold it.
//
// ⚠ Every write goes through `Behave.w.set`, i.e. World.setBlock with flag 3: vanilla's helper calls
// setBlockState(pos, state, 3) mid-computation and relies on those writes being visible to the next
// neighbour's helper — a clone that batches them computes different junctions.
(function (NS) {
  'use strict';
  var Rail = NS.Rail = { ready: false };

  // RailShape, in the enum's declaration order.
  var SHAPES = Rail.SHAPES = ['north_south', 'east_west', 'ascending_east', 'ascending_west',
    'ascending_north', 'ascending_south', 'south_east', 'south_west', 'north_west', 'north_east'];
  var NS_ = 0, EW = 1, AE = 2, AW = 3, AN = 4, AS = 5, SE = 6, SW = 7, NW = 8, NE = 9;
  Rail.isAscending = function (sh) { return sh >= AE && sh <= AS; };

  var B, S, R, SR, w;
  var railBlk = null, straightOnly = null, blkRail = -1;

  function ensure() {
    if (railBlk) return true;
    B = NS.Behave; S = NS.States; R = NS.Reg; SR = NS.States;
    if (!B || !B.ready || !R || !R.ready) return false;
    w = B.w;
    railBlk = Object.create(null); straightOnly = Object.create(null);
    // `isRail`: the `rails` tag AND `instanceof AbstractRailBlock` — the same four blocks.
    ['rail', 'powered_rail', 'detector_rail', 'activator_rail'].forEach(function (n) {
      var b = R.id[n];
      if (b === undefined) return;
      railBlk[b] = true;
      if (n !== 'rail') straightOnly[b] = true;       // `super(true, ..)`: cannotMakeCurves
    });
    blkRail = R.id.rail;
    return true;
  }

  function isRail(st) { return st !== 0 && railBlk[S.block[st]] === true; }
  function shapeOf(st) { return SHAPES.indexOf(B.propName(st, 'shape')); }
  function withShape(st, sh) { return B.setProp(st, 'shape', SHAPES[sh]); }
  Rail.isRail = function (st) { return ensure() && isRail(st); };
  Rail.shapeOf = function (st) { return ensure() ? shapeOf(st) : -1; };
  Rail.forbidsCurves = function (st) { return ensure() && straightOnly[S.block[st]] === true; };
  function railAt(x, y, z) { return isRail(w.get(x, y, z)); }

  // `Block.hasTopRim`: the top face is RIGID-sturdy. faceSturdy's dir is ARCH order (2 = +Y). An
  // unloaded column answers "supported", the engine-wide convention (W.canSurvive).
  function hasTopRim(x, y, z) {
    var Wd = B.world;
    if (Wd && Wd.loadedAt && !Wd.loadedAt(x, z)) return true;
    return SR.faceSturdy(w.get(x, y, z), 2, SR.SUPPORT_RIGID);
  }
  function powered(x, y, z) {
    var Rs = NS.Redstone;
    return !!(Rs && Rs.ready && Rs.receivedPower(x, y, z) > 0);
  }

  // ── RailPlacementHelper ─────────────────────────────────────────────────────────────────
  function Helper(x, y, z, st) {
    this.x = x; this.y = y; this.z = z; this.st = st;
    this.forbid = straightOnly[S.block[st]] === true;
    this.nb = [];
    this.computeNeighbors(shapeOf(st));
  }
  var H = Helper.prototype;
  H.computeNeighbors = function (sh) {
    var x = this.x, y = this.y, z = this.z, n = this.nb;
    n.length = 0;
    switch (sh) {
      case NS_: n.push([x, y, z - 1], [x, y, z + 1]); break;
      case EW: n.push([x - 1, y, z], [x + 1, y, z]); break;
      case AE: n.push([x - 1, y, z], [x + 1, y + 1, z]); break;
      case AW: n.push([x - 1, y + 1, z], [x + 1, y, z]); break;
      case AN: n.push([x, y + 1, z - 1], [x, y, z + 1]); break;
      case AS: n.push([x, y, z - 1], [x, y + 1, z + 1]); break;
      case SE: n.push([x + 1, y, z], [x, y, z + 1]); break;
      case SW: n.push([x - 1, y, z], [x, y, z + 1]); break;
      case NW: n.push([x - 1, y, z], [x, y, z - 1]); break;
      case NE: n.push([x + 1, y, z], [x, y, z - 1]); break;
    }
  };
  H.updateNeighborPositions = function () {
    for (var i = 0; i < this.nb.length; i++) {
      var h = neighboringRail(this.nb[i][0], this.nb[i][1], this.nb[i][2]);
      if (h !== null && h.isNeighbor(this.x, this.z)) this.nb[i] = [h.x, h.y, h.z];
      else this.nb.splice(i--, 1);
    }
  };
  // `isVerticallyNearRail`
  function nearRail(x, y, z) { return railAt(x, y, z) || railAt(x, y + 1, z) || railAt(x, y - 1, z); }
  function neighboringRail(x, y, z) {
    var st = w.get(x, y, z);
    if (isRail(st)) return new Helper(x, y, z, st);
    st = w.get(x, y + 1, z);
    if (isRail(st)) return new Helper(x, y + 1, z, st);
    st = w.get(x, y - 1, z);
    return isRail(st) ? new Helper(x, y - 1, z, st) : null;
  }
  // `isNeighbor(BlockPos)`: x and z only — a slope's upper end is still "the neighbour".
  H.isNeighbor = function (x, z) {
    for (var i = 0; i < this.nb.length; i++) if (this.nb[i][0] === x && this.nb[i][2] === z) return true;
    return false;
  };
  H.neighborCount = function () {
    var x = this.x, y = this.y, z = this.z;
    return (nearRail(x, y, z - 1) ? 1 : 0) + (nearRail(x, y, z + 1) ? 1 : 0) +
      (nearRail(x - 1, y, z) ? 1 : 0) + (nearRail(x + 1, y, z) ? 1 : 0);
  };
  H.canConnectTo = function (o) { return this.isNeighbor(o.x, o.z) || this.nb.length !== 2; };
  H.computeRailShape = function (o) {
    this.nb.push([o.x, o.y, o.z]);
    var x = this.x, y = this.y, z = this.z;
    var n = this.isNeighbor(x, z - 1), s = this.isNeighbor(x, z + 1);
    var we = this.isNeighbor(x - 1, z), e = this.isNeighbor(x + 1, z);
    var sh = -1;
    if (n || s) sh = NS_;
    if (we || e) sh = EW;
    if (!this.forbid) {
      if (s && e && !n && !we) sh = SE;
      if (s && we && !n && !e) sh = SW;
      if (n && we && !s && !e) sh = NW;
      if (n && e && !s && !we) sh = NE;
    }
    if (sh === NS_) {
      if (railAt(x, y + 1, z - 1)) sh = AN;
      if (railAt(x, y + 1, z + 1)) sh = AS;
    }
    if (sh === EW) {
      if (railAt(x + 1, y + 1, z)) sh = AE;
      if (railAt(x - 1, y + 1, z)) sh = AW;
    }
    if (sh < 0) sh = NS_;
    this.st = withShape(this.st, sh);
    w.set(x, y, z, this.st);
  };
  H.canConnectAt = function (x, y, z) {
    var h = neighboringRail(x, y, z);
    if (h === null) return false;
    h.updateNeighborPositions();
    return h.canConnectTo(this);
  };
  H.updateBlockState = function (pow, force, cur) {
    var x = this.x, y = this.y, z = this.z;
    var n = this.canConnectAt(x, y, z - 1), s = this.canConnectAt(x, y, z + 1);
    var we = this.canConnectAt(x - 1, y, z), e = this.canConnectAt(x + 1, y, z);
    var sh = -1;
    var ns = n || s, ew = we || e;
    if (ns && !ew) sh = NS_;
    if (ew && !ns) sh = EW;
    var se = s && e, sw = s && we, ne = n && e, nw = n && we;
    if (!this.forbid) {
      if (se && !n && !we) sh = SE;
      if (sw && !n && !e) sh = SW;
      if (nw && !s && !e) sh = NW;
      if (ne && !s && !we) sh = NE;
    }
    if (sh < 0) {
      if (ns && ew) sh = cur;
      else if (ns) sh = NS_;
      else if (ew) sh = EW;
      // ⚠ the ORDER is the rule: a powered junction prefers south_east last-written-wins the other
      // way round from an unpowered one, which is what makes a lever flip a T-junction.
      if (!this.forbid) {
        if (pow) {
          if (se) sh = SE;
          if (sw) sh = SW;
          if (ne) sh = NE;
          if (nw) sh = NW;
        } else {
          if (nw) sh = NW;
          if (ne) sh = NE;
          if (sw) sh = SW;
          if (se) sh = SE;
        }
      }
    }
    if (sh === NS_) {
      if (railAt(x, y + 1, z - 1)) sh = AN;
      if (railAt(x, y + 1, z + 1)) sh = AS;
    }
    if (sh === EW) {
      if (railAt(x + 1, y + 1, z)) sh = AE;
      if (railAt(x - 1, y + 1, z)) sh = AW;
    }
    if (sh < 0) sh = cur;
    this.computeNeighbors(sh);
    this.st = withShape(this.st, sh);
    if (force || w.get(x, y, z) !== this.st) {
      w.set(x, y, z, this.st);
      for (var i = 0; i < this.nb.length; i++) {
        var h = neighboringRail(this.nb[i][0], this.nb[i][1], this.nb[i][2]);
        if (h !== null) {
          h.updateNeighborPositions();
          if (h.canConnectTo(this)) h.computeRailShape(this);
        }
      }
    }
    return this;
  };
  Rail.Helper = Helper;

  // ── AbstractRailBlock ───────────────────────────────────────────────────────────────────
  /** `updateBlockState(world, pos, state, force)` — returns the state the helper settled on. */
  function reshape(x, y, z, st, force) {
    return new Helper(x, y, z, st).updateBlockState(powered(x, y, z), force, shapeOf(st)).st;
  }
  Rail.reshape = function (x, y, z, force) {
    if (!ensure()) return 0;
    var st = w.get(x, y, z);
    return isRail(st) ? reshape(x, y, z, st, !!force) : st;
  };

  /** `shouldDropRail`: no rim below, or no rim on the raised side of a slope. */
  Rail.shouldDrop = function (x, y, z, sh) {
    if (!hasTopRim(x, y - 1, z)) return true;
    switch (sh) {
      case AE: return !hasTopRim(x + 1, y, z);
      case AW: return !hasTopRim(x - 1, y, z);
      case AN: return !hasTopRim(x, y, z - 1);
      case AS: return !hasTopRim(x, y, z + 1);
      default: return false;
    }
  };

  /** `neighborUpdate(state, world, pos, sourceBlock)`; `src` is any state of the source block. */
  Rail.neighborUpdate = function (x, y, z, src) {
    if (!ensure()) return false;
    var st = w.get(x, y, z);
    if (!isRail(st)) return false;
    if (Rail.shouldDrop(x, y, z, shapeOf(st))) {
      var drops = (NS.Loot && NS.Loot.ready) ? NS.Loot.breakDrops(st, {}) : [];
      w.set(x, y, z, 0);
      var EL = NS.EntityList, It = NS.Items;
      if (drops.length && EL && EL.ready && EL.popResource && It && It.of) {
        for (var i = 0; i < drops.length; i++) {
          var idx = It.of(drops[i].item);
          if (idx >= 0) EL.popResource(x, y, z, idx, drops[i].count || 1);
        }
      }
      Rail.drops++;
      return true;
    }
    // `RailBlock.updateBlockState(state, world, pos, block)`: a signal source beside a junction
    var Rs = NS.Redstone;
    if (S.block[st] === blkRail && src && Rs && Rs.ready && Rs.isSignalSource(src) &&
        new Helper(x, y, z, st).neighborCount() === 3) reshape(x, y, z, st, false);
    return false;
  };
  Rail.drops = 0;

  function notifyAround(x, y, z, src) {
    for (var d = 0; d < 6; d++) Rail.neighborUpdate(x + B.DX[d], y + B.DY[d], z + B.DZ[d], src);
  }

  /**
   * Behave.changed's hook: (x,y,z) now holds `w.get(x,y,z)` and held `old` before. `old` undefined
   * means the caller could not say (a mock world), and onBlockAdded — which fires only for a
   * DIFFERENT old block — is then skipped rather than guessed.
   */
  Rail.changed = function (x, y, z, old) {
    if (!ensure()) return;
    var st = w.get(x, y, z);
    // `onStateReplaced(old, .., moved=false)` — every change of a rail cell, reshapes included
    if (old !== undefined && isRail(old) && old !== st) {
      if (Rail.isAscending(shapeOf(old))) notifyAround(x, y + 1, z, old);
      if (straightOnly[S.block[old]]) { notifyAround(x, y, z, old); notifyAround(x, y - 1, z, old); }
    }
    // `onBlockAdded`: `if (!oldState.isOf(state.getBlock())) updateCurves(..)`
    if (old !== undefined && isRail(st) && (old === 0 || S.block[old] !== S.block[st])) {
      var now = reshape(x, y, z, st, true);
      if (straightOnly[S.block[st]]) Rail.neighborUpdate(x, y, z, now);
    }
  };

  // ── rotate / mirror ─────────────────────────────────────────────────────────────────────
  // BlockRotation 0 NONE, 1 CLOCKWISE_90, 2 CLOCKWISE_180, 3 COUNTERCLOCKWISE_90.
  // The rows are the switch bodies in declaration order; `-1` = no case (falls through).
  var ROT180 = [-1, -1, AW, AE, AS, AN, NW, NE, SE, SW];
  var ROTCCW = [EW, NS_, AN, AS, AW, AE, NE, SE, SW, NW];
  var ROTCW = [EW, NS_, AS, AN, AE, AW, SW, NW, NE, SE];
  Rail.rotateShape = function (sh, rot) {
    switch (rot & 3) {
      case 2: if (ROT180[sh] >= 0) return ROT180[sh];
      // falls through — vanilla's CLOCKWISE_180 has no north_south / east_west case
      case 3: return ROTCCW[sh];
      case 1: return ROTCW[sh];
      default: return sh;
    }
  };
  // BlockMirror 0 NONE, 1 LEFT_RIGHT, 2 FRONT_BACK.
  var MIR_LR = [NS_, EW, AE, AW, AS, AN, NE, NW, SW, SE];
  var MIR_FB = [NS_, EW, AW, AE, AN, AS, SW, SE, NE, NW];
  Rail.mirrorShape = function (sh, m) { return m === 1 ? MIR_LR[sh] : m === 2 ? MIR_FB[sh] : sh; };
  Rail.rotate = function (st, rot) {
    if (!ensure() || !isRail(st)) return st;
    var sh = shapeOf(st);
    return sh < 0 ? st : withShape(st, Rail.rotateShape(sh, rot));
  };
  Rail.mirror = function (st, m) {
    if (!ensure() || !isRail(st)) return st;
    var sh = shapeOf(st);
    return sh < 0 ? st : withShape(st, Rail.mirrorShape(sh, m));
  };

  Rail.ready = true;
})(MCL);
