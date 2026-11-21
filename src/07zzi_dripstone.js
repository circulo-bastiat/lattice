// src/07zzi_dripstone.js — #5666 (G17-K9): PointedDripstoneBlock.randomTick / dripTick / tryGrow and
// the cauldron's scheduledTick -> fillFromDripstone (CauldronBlock / LeveledCauldronBlock).
// Off .decomp PointedDripstoneBlock.java:160-290,311-388,405-575 and AbstractCauldronBlock.java:86-94.
// Approximation (OWED): canDripThrough uses opaque/solid flags rather than the 6..10 drip collision shape.
(function (NS) {
  'use strict';
  var D = NS.Dripstone = { WATER_CHANCE: 0.17578125, LAVA_CHANCE: 0.05859375, GROW_CHANCE: 0.011377778 };
  var TIP_MERGE = 0, TIP = 1;

  function R() { return NS.Reg; }
  function blk(st) { return NS.States.block[st]; }
  function isDrip(st) { return st !== 0 && blk(st) === R().id.pointed_dripstone; }
  function local(st) { return st - R().realFirst[blk(st)]; }
  function thickness(st) { return local(st) >> 2; }
  function down(st) { return (local(st) & 2) !== 0; }
  function wlogged(st) { return (local(st) & 1) === 0; }
  function mk(th, dn, wl) { return NS.States.withLocal('pointed_dripstone', th * 4 + (dn ? 2 : 0) + (wl ? 0 : 1)); }
  function pointingDown(st) { return isDrip(st) && down(st); }
  function isTipOf(st, dn) { return isDrip(st) && down(st) === dn && thickness(st) === TIP; }
  function get(x, y, z) { return NS.World.getBlock(x, y, z) | 0; }
  function isWaterBlock(st) { return st !== 0 && blk(st) === R().id.water; }
  function isStillWater(st) { return isWaterBlock(st) && NS.Behave.fluidLevel(st) === 0; }
  function fluidOf(st) {   // source fluid only: Fluids.WATER / Fluids.LAVA, else null
    if (st === 0) return null;
    if (blk(st) === R().id.water) return NS.Behave.fluidLevel(st) === 0 ? 'water' : null;
    if (blk(st) === R().id.lava) return NS.Behave.fluidLevel(st) === 0 ? 'lava' : null;
    return NS.States.waterIn[st] === 1 ? 'water' : null;
  }
  function hasFluid(st) { return st !== 0 && (blk(st) === R().id.water || blk(st) === R().id.lava || NS.States.waterIn[st] === 1); }
  function canDripThrough(st) {
    if (st === 0) return true;
    if (NS.States.opaque[st] === 1) return false;
    if (hasFluid(st)) return false;
    return NS.States.solid[st] !== 1;
  }
  // searchInDirection: step dy up to range-1 blocks; target first, then the pass predicate.
  function search(x, y, z, dy, pass, target, range) {
    for (var i = 1; i < range; i++) {
      y += dy;
      var st = get(x, y, z);
      if (target(st)) return y;
      if (y < -64 || y > 255 || !pass(st)) return null;
    }
    return null;
  }
  function tipY(x, y, z, st, range) {
    if (isTipOf(st, down(st))) return y;
    var dn = down(st);
    return search(x, y, z, dn ? -1 : 1, function (s) { return isDrip(s) && down(s) === dn; },
      function (s) { return isTipOf(s, dn); }, range);
  }
  function held(x, y, z, st) { return pointingDown(st) && !isDrip(get(x, y + 1, z)); }
  function dripFluid(x, y, z) {
    var st = get(x, y, z);
    if (!pointingDown(st)) return null;
    var sy = search(x, y, z, 1, function (s) { return isDrip(s) && down(s); }, function (s) { return !isDrip(s); }, 11);
    return sy === null ? null : fluidOf(get(x, sy + 1, z));
  }
  function cauldronKind(st) {
    if (st === 0) return null;
    var n = R().names[blk(st)];
    return n === 'cauldron' || n === 'water_cauldron' ? n : null;
  }
  function canFill(st, fluid) {
    var k = cauldronKind(st);
    if (k === 'cauldron') return true;
    return k === 'water_cauldron' && fluid === 'water';
  }
  /** AbstractCauldronBlock.scheduledTick: re-derive the fluid above, then fill. */
  D.cauldronTick = function (x, y, z) {
    var st = get(x, y, z);
    if (!cauldronKind(st)) return false;
    var dy = search(x, y, z, 1, canDripThrough, function (s) { return pointingDown(s) && thickness(s) === TIP && !wlogged(s); }, 11);
    if (dy === null) return true;
    var fluid = dripFluid(x, dy, z);
    if (!fluid || !canFill(st, fluid)) return true;
    var S = NS.States, next = 0;
    if (cauldronKind(st) === 'cauldron') next = fluid === 'water' ? S.withLocal('water_cauldron', 0) : S.stateOf('lava_cauldron');
    else {
      var lv = local(st) + 1;   // level = local + 1, 1..3
      if (lv >= 3) return true;
      next = S.withLocal('water_cauldron', lv);
    }
    NS.World.setBlock(x, y, z, next);
    if (NS.Behave.changed) NS.Behave.changed(x, y, z);
    return true;
  };
  /** dripTick(state, level, pos, float roll) */
  D.dripTick = function (x, y, z, st, roll) {
    if (roll > D.WATER_CHANCE && roll > D.LAVA_CHANCE) return false;
    if (!held(x, y, z, st)) return false;
    var fluid = dripFluid(x, y, z), chance;
    if (fluid === 'water') chance = D.WATER_CHANCE; else if (fluid === 'lava') chance = D.LAVA_CHANCE; else return false;
    if (roll >= chance) return false;
    var ty = tipY(x, y, z, st, 11);
    if (ty === null) return false;
    var cy = search(x, ty, z, -1, function (s) { return canDripThrough(s); },
      function (s) { return canFill(s, fluid); }, 11);
    if (cy === null) return false;
    NS.Behave.schedule(x, cy, z, 50 + (ty - cy));
    return true;
  };
  function canGrowAt(x, y, z, st) {
    var dn = down(st), s = get(x, y + (dn ? -1 : 1), z);
    if (hasFluid(s)) return false;
    return s === 0 || isTipOf(s, !dn);
  }
  function place(x, y, z, dn, th) {
    NS.World.setBlock(x, y, z, mk(th, dn, isStillWater(get(x, y, z)) || NS.States.waterIn[get(x, y, z)] === 1));
  }
  function growFrom(x, y, z, dir) {   // dir -1 = down, +1 = up
    var ny = y + dir, s = get(x, ny, z);
    if (isTipOf(s, dir < 0 ? false : true)) {
      // growMerged: the tip being grown into is `s`; both halves become tip_merge
      var bottom = down(s) ? ny - 1 : ny, top = bottom + 1;
      place(x, top, z, true, TIP_MERGE); place(x, bottom, z, false, TIP_MERGE);
    } else if (s === 0 || isWaterBlock(s)) place(x, ny, z, dir < 0, TIP);
  }
  function sturdyUp(x, y, z) {   // canPlaceAtWithDirection(pos, UP): support below
    var s = get(x, y - 1, z);
    return NS.States.solid[s] === 1 || (isDrip(s) && !down(s));
  }
  D.tryGrow = function (x, y, z, st, rnd) {
    var a = get(x, y + 1, z), b = get(x, y + 2, z);
    if (!(a !== 0 && blk(a) === R().id.dripstone_block && isStillWater(b))) return false;
    var ty = tipY(x, y, z, st, 7);
    if (ty === null) return false;
    var t = get(x, ty, z);
    if (!(pointingDown(t) && thickness(t) === TIP && !wlogged(t) && canGrowAt(x, ty, z, t))) return false;
    if (rnd() < 0.5) { growFrom(x, ty, z, -1); return true; }
    var cy = ty;
    for (var i = 0; i < 10; i++) {
      cy--;
      var s = get(x, cy, z);
      if (hasFluid(s)) return false;
      if (isTipOf(s, false) && canGrowAt(x, cy, z, s)) { growFrom(x, cy, z, 1); return true; }
      if (sturdyUp(x, cy, z) && !isWaterBlock(get(x, cy - 1, z))) { growFrom(x, cy - 1, z, 1); return true; }
      if (!canDripThrough(s)) return false;
    }
    return false;
  };
  D.randomTick = function (x, y, z, st, rnd) {
    var ch = D.dripTick(x, y, z, st, rnd());
    if (rnd() < D.GROW_CHANCE && held(x, y, z, st)) ch = D.tryGrow(x, y, z, st, rnd) || ch;
    return ch;
  };
  // PointedDripstoneBlock.canPlaceAt for a tip-down: the block above is sturdy or pointing down too.
  function hangsOk(x, y, z, st) {
    var a = get(x, y + 1, z);
    return NS.States.solid[a] === 1 || (isDrip(a) && down(a));
  }
  // updateShape: a changed neighbour above/below that took the support from a stalactite schedules tick 2
  // (stalagmite: tick 1); `dy` is where the changed cell lies from (x, y, z).
  D.neighborChanged = function (x, y, z, st, dy) {
    if (dy !== 1 && dy !== -1) return;
    var dn = down(st);
    if (dn && NS.Behave.isScheduled && NS.Behave.isScheduled(x, y, z)) return;
    if ((dy === 1) === dn && !(dn ? hangsOk(x, y, z, st) : sturdyUp(x, y, z))) NS.Behave.schedule(x, y, z, dn ? 2 : 1);
  };
  // scheduledTick: an unsupported stalagmite breaks; otherwise the stalactite column falls.
  D.scheduledTick = function (x, y, z) {
    var st = get(x, y, z);
    if (!isDrip(st)) return false;
    if (!down(st)) { if (!sturdyUp(x, y, z)) NS.World.setBlock(x, y, z, 0); return true; }
    var EL = NS.EntityList, cy = y, cs = st;
    while (isDrip(cs) && down(cs)) {
      NS.World.setBlock(x, cy, z, 0);
      var e = EL && EL.ready ? EL.spawn('falling_block', x + 0.5, cy, z + 0.5, { state: cs }) : null;
      if (isTipOf(cs, true)) {
        if (e && !D.noHurt) { e.hurtEntities = true; e.fallHurtAmount = 1.0 * Math.max(1 + y - cy, 6); e.fallDamageMax = 40; e.hurtSource = 'fallingStalactite'; }
        break;
      }
      cy--; cs = get(x, cy, z);
    }
    return true;
  };
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
