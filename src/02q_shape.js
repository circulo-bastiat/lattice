// NS.Shape: net/minecraft/util/shape ports (#11767), from .decomp. VoxelSet BitSetVoxelSet CroppedVoxelSet PairList (Simple/Identity/
// Disjoint/Fractional) FractionalDoubleList OffsetDoubleList and VoxelShape subclasses (Array/Simple/Sliced). An axis is 0/1/2 = X/Y/Z;
// a DoubleList is {size(), getDouble(i)}; a PairList consumer is fn(a, b, merged) -> boolean (false stops). VoxelShape here is only the
// base the three subclasses need (voxels + getPointPositions); VoxelShapes/VoxelShape proper are other issues.
(function (NS) {
  'use strict';
  var S = NS.Shape = {};
  function choose(axis, x, y, z) { return axis === 0 ? x : axis === 1 ? y : z; }
  // AxisCycleDirection: NONE / FORWARD / BACKWARD.
  var ACD = S.AxisCycleDirection = {
    NONE: { ordinal: 0, cycle: function (a) { return a; }, choose: function (x, y, z, a) { return choose(a, x, y, z); } },
    FORWARD: { ordinal: 1, cycle: function (a) { return (a + 1) % 3; }, choose: function (x, y, z, a) { return choose(a, z, x, y); } },
    BACKWARD: { ordinal: 2, cycle: function (a) { return (a + 2) % 3; }, choose: function (x, y, z, a) { return choose(a, y, z, x); } }
  };
  ACD.NONE.opposite = function () { return ACD.NONE; };
  ACD.FORWARD.opposite = function () { return ACD.BACKWARD; };
  ACD.BACKWARD.opposite = function () { return ACD.FORWARD; };
  ACD.between = function (a, b) { return a === b ? ACD.NONE : (a + 1) % 3 === b ? ACD.FORWARD : ACD.BACKWARD; };

  function arrList(arr, n) { n = n === undefined ? arr.length : n; return { size: function () { return n; }, getDouble: function (i) { return arr[i]; } }; }
  S.listOf = arrList;
  S.FractionalDoubleList = function (n) {
    if (n <= 0) throw new Error('Need at least 1 part');
    return { size: function () { return n + 1; }, getDouble: function (i) { return i / n; } };
  };
  S.OffsetDoubleList = function (old, off) { return { size: function () { return old.size(); }, getDouble: function (i) { return old.getDouble(i) + off; } }; };
  function gcd(a, b) { while (b) { var t = a % b; a = b; b = t; } return a; }
  S.lcm = function (a, b) { return a / gcd(a, b) * b; };

  S.IdentityPairList = function (merged) {
    return { getPairs: function () { return merged; }, size: function () { return merged.size(); },
      forEachPair: function (c) { var n = merged.size() - 1; for (var i = 0; i < n; i++) if (!c(i, i, i)) return false; return true; } };
  };
  S.FractionalPairList = function (a, b) {
    var merged = S.FractionalDoubleList(S.lcm(a, b)), g = gcd(a, b), first = a / g, gc = b / g;
    return { getPairs: function () { return merged; }, size: function () { return merged.size(); },
      forEachPair: function (c) { var n = merged.size() - 1; for (var i = 0; i < n; i++) if (!c(Math.trunc(i / gc), Math.trunc(i / first), i)) return false; return true; } };
  };
  S.DisjointPairList = function (first, second, inverted) {
    function it(c) {
      var n = first.size(), i;
      for (i = 0; i < n; i++) if (!c(i, -1, i)) return false;
      var m = second.size() - 1;
      for (i = 0; i < m; i++) if (!c(n - 1, i, n + i)) return false;
      return true;
    }
    var self = { size: function () { return first.size() + second.size(); },
      getDouble: function (i) { return i < first.size() ? first.getDouble(i) : second.getDouble(i - first.size()); },
      forEachPair: function (c) { return inverted ? it(function (a, b, m) { return c(b, a, m); }) : it(c); },
      getPairs: function () { return self; } };
    return self;
  };
  var ZERO = arrList([0.0]);
  S.SimplePairList = function (l0, l1, flag0, flag1) {
    var last = NaN, n0 = l0.size(), n1 = l1.size(), t = n0 + n1;
    var vals = new Array(t), mins = new Array(t), maxs = new Array(t), size, i0 = 0, i1 = 0, k = 0, skip0 = !flag0, skip1 = !flag1;
    for (;;) {
      var e0 = i0 >= n0, e1 = i1 >= n1;
      if (e0 && e1) { size = Math.max(1, k); break; }
      var pick = !e0 && (e1 || l0.getDouble(i0) < l1.getDouble(i1) + 1.0E-7);
      if (pick) { i0++; if (skip0 && (i1 === 0 || e1)) continue; }
      else { i1++; if (skip1 && (i0 === 0 || e0)) continue; }
      var a = i0 - 1, b = i1 - 1, v = pick ? l0.getDouble(a) : l1.getDouble(b);
      if (!(last >= v - 1.0E-7)) { mins[k] = a; maxs[k] = b; vals[k] = v; k++; last = v; }
      else { mins[k - 1] = a; maxs[k - 1] = b; }
    }
    return { size: function () { return size; },
      getPairs: function () { return size <= 1 ? ZERO : arrList(vals, size); },
      forEachPair: function (c) { var n = size - 1; for (var i = 0; i < n; i++) if (!c(mins[i], maxs[i], i)) return false; return true; } };
  };

  // VoxelSet base: subclasses supply contains/set/getMin/getMax.
  function initSet(o, x, y, z) {
    if (!(x >= 0 && y >= 0 && z >= 0)) throw new Error('Need all positive sizes: x: ' + x + ', y: ' + y + ', z: ' + z);
    o.sizeX = x; o.sizeY = y; o.sizeZ = z;
    o.getSize = function (a) { return choose(a, o.sizeX, o.sizeY, o.sizeZ); };
    o.getXSize = function () { return o.sizeX; }; o.getYSize = function () { return o.sizeY; }; o.getZSize = function () { return o.sizeZ; };
    o.inBoundsAndContains = function (a, b, c, d) {
      if (d === undefined) return o.inBoundsAndContains3(a, b, c);
      return o.inBoundsAndContains3(a.choose(b, c, d, 0), a.choose(b, c, d, 1), a.choose(b, c, d, 2));
    };
    o.inBoundsAndContains3 = function (x, y, z) {
      if (x < 0 || y < 0 || z < 0) return false;
      return x < o.sizeX && y < o.sizeY && z < o.sizeZ ? o.contains3(x, y, z) : false;
    };
    // contains(dir, a, b, c) cycles; contains3(x, y, z) is the raw test.
    o.containsC = function (d, a, b, c) { return o.contains3(d.choose(a, b, c, 0), d.choose(a, b, c, 1), d.choose(a, b, c, 2)); };
    o.isEmpty = function () { for (var a = 0; a < 3; a++) if (o.getMin(a) >= o.getMax(a)) return true; return false; };
    o.getStartingAxisCoord = function (axis, b, c) {
      var n = o.getSize(axis);
      if (b >= 0 && c >= 0) {
        var a4 = ACD.FORWARD.cycle(axis), a5 = ACD.BACKWARD.cycle(axis);
        if (b < o.getSize(a4) && c < o.getSize(a5)) {
          var d = ACD.between(0, axis);
          for (var i = 0; i < n; i++) if (o.containsC(d, i, b, c)) return i;
        }
      }
      return n;
    };
    o.getEndingAxisCoord = function (axis, b, c) {
      if (b >= 0 && c >= 0) {
        var a3 = ACD.FORWARD.cycle(axis), a4 = ACD.BACKWARD.cycle(axis);
        if (b < o.getSize(a3) && c < o.getSize(a4)) {
          var n = o.getSize(axis), d = ACD.between(0, axis);
          for (var i = n - 1; i >= 0; i--) if (o.containsC(d, i, b, c)) return i + 1;
        }
      }
      return 0;
    };
    o.forEachEdge = function (cons, merge) { edges(o, cons, ACD.NONE, merge); edges(o, cons, ACD.FORWARD, merge); edges(o, cons, ACD.BACKWARD, merge); };
    o.forEachBox = function (cons, merge) { S.BitSetVoxelSet.forEachBoxOf(o, cons, merge); };
    o.forEachDirection = function (cons) { dirs(o, cons, ACD.NONE); dirs(o, cons, ACD.FORWARD); dirs(o, cons, ACD.BACKWARD); };
    return o;
  }
  function edges(s, cons, c1, merge) {
    var c3 = c1.opposite(), n4 = s.getSize(c3.cycle(0)), n5 = s.getSize(c3.cycle(1)), n6 = s.getSize(c3.cycle(2));
    for (var x = 0; x <= n4; x++) for (var y = 0; y <= n5; y++) {
      var run = -1;
      for (var z = 0; z <= n6; z++) {
        var cnt = 0, par = 0;
        for (var p = 0; p <= 1; p++) for (var q = 0; q <= 1; q++) {
          if (s.inBoundsAndContains(c3, x + p - 1, y + q - 1, z)) { cnt++; par ^= p ^ q; }
        }
        if (cnt === 1 || cnt === 3 || (cnt === 2 && (par & 1) === 0)) {
          if (merge) { if (run === -1) run = z; }
          else cons(c3.choose(x, y, z, 0), c3.choose(x, y, z, 1), c3.choose(x, y, z, 2), c3.choose(x, y, z + 1, 0), c3.choose(x, y, z + 1, 1), c3.choose(x, y, z + 1, 2));
        } else if (run !== -1) {
          cons(c3.choose(x, y, run, 0), c3.choose(x, y, run, 1), c3.choose(x, y, run, 2), c3.choose(x, y, z, 0), c3.choose(x, y, z, 1), c3.choose(x, y, z, 2));
          run = -1;
        }
      }
    }
  }
  function dirs(s, cons, c1) {
    var c2 = c1.opposite(), ax = c2.cycle(2), n4 = s.getSize(c2.cycle(0)), n5 = s.getSize(c2.cycle(1)), n6 = s.getSize(ax);
    var up = NS.UtilMath.Direction.from(ax, 1), dn = NS.UtilMath.Direction.from(ax, -1);
    for (var x = 0; x < n4; x++) for (var y = 0; y < n5; y++) {
      var prev = false;
      for (var z = 0; z <= n6; z++) {
        var cur = z !== n6 && s.containsC(c2, x, y, z);
        if (!prev && cur) cons(dn, c2.choose(x, y, z, 0), c2.choose(x, y, z, 1), c2.choose(x, y, z, 2));
        if (prev && !cur) cons(up, c2.choose(x, y, z - 1, 0), c2.choose(x, y, z - 1, 1), c2.choose(x, y, z - 1, 2));
        prev = cur;
      }
    }
  }
  // NB: Direction.from(axis, NEGATIVE=-1) is field_11060 (the "a" of consume(Direction...)): AxisDirection.field_11060 is NEGATIVE.

  S.BitSetVoxelSet = function (x, y, z) {
    var o = initSet(src_is_set(x) ? {} : {}, src_is_set(x) ? x.sizeX : x, src_is_set(x) ? x.sizeY : y, src_is_set(x) ? x.sizeZ : z);
    o.minX = 0; o.minY = 0; o.minZ = 0; o.maxX = 0; o.maxY = 0; o.maxZ = 0;
    var bits = new Uint8Array(o.sizeX * o.sizeY * o.sizeZ);
    o.storage = bits;
    o.getIndex = function (a, b, c) { return (a * o.sizeY + b) * o.sizeZ + c; };
    o.contains3 = function (a, b, c) { return bits[o.getIndex(a, b, c)] === 1; };
    o.contains = o.contains3;
    o.setRaw = function (a, b, c, upd) {
      bits[o.getIndex(a, b, c)] = 1;
      if (upd) { o.minX = Math.min(o.minX, a); o.minY = Math.min(o.minY, b); o.minZ = Math.min(o.minZ, c);
        o.maxX = Math.max(o.maxX, a + 1); o.maxY = Math.max(o.maxY, b + 1); o.maxZ = Math.max(o.maxZ, c + 1); }
    };
    o.set = function (a, b, c) { o.setRaw(a, b, c, true); };
    o.isEmpty = function () { for (var i = 0; i < bits.length; i++) if (bits[i]) return false; return true; };
    o.getMin = function (a) { return choose(a, o.minX, o.minY, o.minZ); };
    o.getMax = function (a) { return choose(a, o.maxX, o.maxY, o.maxZ); };
    o.isColumnFull = function (lo, hi, a, b) {
      if (!(a < o.sizeX && b < o.sizeY)) return false;
      var i = o.getIndex(a, b, lo), end = o.getIndex(a, b, hi);
      while (i < bits.length && bits[i] === 1) i++;
      return i >= end;
    };
    o.isColumnsFull = function (x0, x1, lo, hi, b) { for (var a = x0; a < x1; a++) if (!o.isColumnFull(lo, hi, a, b)) return false; return true; };
    o.clearColumn = function (lo, hi, a, b) { for (var i = o.getIndex(a, b, lo), e = o.getIndex(a, b, hi); i < e; i++) bits[i] = 0; };
    if (src_is_set(x)) {
      for (var i = 0; i < o.sizeX; i++) for (var j = 0; j < o.sizeY; j++) for (var k = 0; k < o.sizeZ; k++) if (x.contains3(i, j, k)) bits[o.getIndex(i, j, k)] = 1;
      o.minX = x.getMin(0); o.minY = x.getMin(1); o.minZ = x.getMin(2); o.maxX = x.getMax(0); o.maxY = x.getMax(1); o.maxZ = x.getMax(2);
    } else { o.minX = x; o.minY = y; o.minZ = z; }
    return o;
  };
  function src_is_set(v) { return typeof v === 'object' && v !== null; }
  S.BitSetVoxelSet.create = function (sx, sy, sz, x0, y0, z0, x1, y1, z1) {
    var o = S.BitSetVoxelSet(sx, sy, sz);
    o.minX = x0; o.minY = y0; o.minZ = z0; o.maxX = x1; o.maxY = y1; o.maxZ = z1;
    for (var i = x0; i < x1; i++) for (var j = y0; j < y1; j++) for (var k = z0; k < z1; k++) o.setRaw(i, j, k, false);
    return o;
  };
  S.BitSetVoxelSet.combine = function (s0, s1, p0, p1, p2, fn) {
    var o = S.BitSetVoxelSet(p0.size() - 1, p1.size() - 1, p2.size() - 1);
    var r = [2147483647, 2147483647, 2147483647, -2147483648, -2147483648, -2147483648];
    p0.forEachPair(function (a0, b0, m0) {
      var any1 = false;
      p1.forEachPair(function (a1, b1, m1) {
        var any2 = false;
        p2.forEachPair(function (a2, b2, m2) {
          if (fn(s0.inBoundsAndContains3(a0, a1, a2), s1.inBoundsAndContains3(b0, b1, b2))) {
            o.storage[o.getIndex(m0, m1, m2)] = 1; r[2] = Math.min(r[2], m2); r[5] = Math.max(r[5], m2); any2 = true;
          }
          return true;
        });
        if (any2) { r[1] = Math.min(r[1], m1); r[4] = Math.max(r[4], m1); any1 = true; }
        return true;
      });
      if (any1) { r[0] = Math.min(r[0], m0); r[3] = Math.max(r[3], m0); }
      return true;
    });
    o.minX = r[0]; o.minY = r[1]; o.minZ = r[2]; o.maxX = r[3] + 1; o.maxY = r[4] + 1; o.maxZ = r[5] + 1;
    return o;
  };
  S.BitSetVoxelSet.forEachBoxOf = function (set, cons, merge) {
    var t = S.BitSetVoxelSet(set);
    for (var y = 0; y < t.sizeY; y++) for (var x = 0; x < t.sizeX; x++) {
      var run = -1;
      for (var z = 0; z <= t.sizeZ; z++) {
        if (t.inBoundsAndContains3(x, y, z)) {
          if (merge) { if (run === -1) run = z; } else cons(x, y, z, x + 1, y + 1, z + 1);
        } else if (run !== -1) {
          var x2 = x, y2 = y;
          t.clearColumn(run, z, x, y);
          while (t.isColumnFull(run, z, x2 + 1, y)) { t.clearColumn(run, z, x2 + 1, y); x2++; }
          while (t.isColumnsFull(x, x2 + 1, run, z, y2 + 1)) { for (var i = x; i <= x2; i++) t.clearColumn(run, z, i, y2 + 1); y2++; }
          cons(x, y, run, x2 + 1, y2 + 1, z);
          run = -1;
        }
      }
    }
  };

  S.CroppedVoxelSet = function (parent, x0, y0, z0, x1, y1, z1) {
    var o = initSet({}, x1 - x0, y1 - y0, z1 - z0);
    function clamp(a, v) { var lo = choose(a, x0, y0, z0), hi = choose(a, x1, y1, z1); return Math.min(Math.max(v, lo), hi) - lo; }
    o.contains3 = function (a, b, c) { return parent.contains3(x0 + a, y0 + b, z0 + c); };
    o.contains = o.contains3;
    o.set = function (a, b, c) { parent.set(x0 + a, y0 + b, z0 + c); };
    o.getMin = function (a) { return clamp(a, parent.getMin(a)); };
    o.getMax = function (a) { return clamp(a, parent.getMax(a)); };
    return o;
  };

  // VoxelShape base + subclasses.
  function shapeBase(voxels) { return { voxels: voxels }; }
  S.ArrayVoxelShape = function (voxels, xs, ys, zs) {
    var o = shapeBase(voxels);
    function wrap(a, n) { return Array.isArray(a) ? arrList(a.concat(new Array(Math.max(0, n - a.length)).fill(0)).slice(0, n)) : a; }
    xs = wrap(xs, voxels.getXSize() + 1); ys = wrap(ys, voxels.getYSize() + 1); zs = wrap(zs, voxels.getZSize() + 1);
    if (voxels.getXSize() + 1 !== xs.size() || voxels.getYSize() + 1 !== ys.size() || voxels.getZSize() + 1 !== zs.size())
      throw new Error('Lengths of point arrays must be consistent with the size of the VoxelShape.');
    o.getPointPositions = function (a) { return choose(a, xs, ys, zs); };
    return o;
  };
  S.SimpleVoxelShape = function (voxels) {
    var o = shapeBase(voxels);
    o.getPointPositions = function (a) { return S.FractionalDoubleList(voxels.getSize(a)); };
    o.getCoordIndex = function (a, v) { var n = voxels.getSize(a); return Math.floor(Math.min(Math.max(v * n, -1.0), n)); };
    return o;
  };
  var POINTS = S.FractionalDoubleList(1);
  S.SlicedVoxelShape = function (shape, axis, idx) {
    var v = shape.voxels;
    var o = shapeBase(S.CroppedVoxelSet(v, choose(axis, idx, 0, 0), choose(axis, 0, idx, 0), choose(axis, 0, 0, idx),
      choose(axis, idx + 1, v.sizeX, v.sizeX), choose(axis, v.sizeY, idx + 1, v.sizeY), choose(axis, v.sizeZ, v.sizeZ, idx + 1)));
    o.getPointPositions = function (a) { return a === axis ? POINTS : shape.getPointPositions(a); };
    return o;
  };
})(MCL);
