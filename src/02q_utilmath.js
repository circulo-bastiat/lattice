// NS.UtilMath: net/minecraft/util/math ports (#11764), from .decomp. AxisTransformation BlockPointer BlockPointerImpl Box ColorHelper
//  ColumnPos DirectionTransformation EightWayDirection EulerAngle PositionImpl Quantiles Vec2f VerticalSurfaceType WordPackedArray.
// Vectors/positions are plain {x,y,z}; a Direction is the entry of UtilMath.Direction (DOWN UP NORTH SOUTH WEST EAST); a Matrix3f is a
// row-major 9-array. Also Matrix4f/Quaternion subset + AffineTransformation(s) (no SVD decompose/lerp, no uvLock: need Direction.transform; owed).
(function (NS) {
  'use strict';
  var U = NS.UtilMath = {};
  var fr = Math.fround;
  // Direction subset: axis ordinal 0/1/2 = X/Y/Z, sign +1/-1.
  var D = U.Direction = {}, DV = [];
  [['DOWN', 1, -1], ['UP', 1, 1], ['NORTH', 2, -1], ['SOUTH', 2, 1], ['WEST', 0, -1], ['EAST', 0, 1]].forEach(function (d, i) {
    DV[i] = D[d[0]] = { name: d[0], ordinal: i, axis: d[1], sign: d[2] };
  });
  D.values = DV;
  D.from = function (axis, sign) { for (var i = 0; i < 6; i++) if (DV[i].axis === axis && DV[i].sign === sign) return DV[i]; return null; };
  function wrapDeg(v) { var f = v % 360; if (f >= 180) f -= 360; if (f < -180) f += 360; return fr(f); }

  // AxisTransformation: six permutations; matrix has 1 at (i, map(i)).
  var AT = U.AxisTransformation = {}, ATV = [];
  [['field_23362', 0, 1, 2], ['field_23363', 1, 0, 2], ['field_23364', 0, 2, 1], ['field_23365', 1, 2, 0], ['field_23366', 2, 0, 1], ['field_23367', 2, 1, 0]].forEach(function (a, i) {
    var m = [a[1], a[2], a[3]], mat = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (var r = 0; r < 3; r++) mat[r * 3 + m[r]] = 1;
    ATV[i] = AT[a[0]] = { name: a[0], ordinal: i, mappings: m, matrix: mat, map: function (k) { return m[k]; }, getMatrix: function () { return mat; } };
  });
  AT.values = ATV;
  var ATC = ATV.map(function (a) { return ATV.map(function (b) {
    var t = [0, 1, 2].map(function (k) { return a.mappings[b.mappings[k]]; });
    return ATV.filter(function (c) { return c.mappings.join() === t.join(); })[0];
  }); });
  ATV.forEach(function (a) { a.prepend = function (o) { return ATC[a.ordinal][o.ordinal]; }; });

  function m3mul(a, b) { var o = new Array(9); for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]; return o; }
  // DirectionTransformation: 48 axis-permutation + flip combinations (the cube's symmetry group).
  var DT = U.DirectionTransformation = {}, DTV = [];
  [['identity', 0, 0, 0, 0], ['rot_180_face_xy', 0, 1, 1, 0], ['rot_180_face_xz', 0, 1, 0, 1], ['rot_180_face_yz', 0, 0, 1, 1],
   ['rot_120_nnn', 3, 0, 0, 0], ['rot_120_nnp', 4, 1, 0, 1], ['rot_120_npn', 4, 0, 1, 1], ['rot_120_npp', 3, 1, 0, 1], ['rot_120_pnn', 4, 1, 1, 0],
   ['rot_120_pnp', 3, 1, 1, 0], ['rot_120_ppn', 3, 0, 1, 1], ['rot_120_ppp', 4, 0, 0, 0], ['rot_180_edge_xy_neg', 1, 1, 1, 1],
   ['rot_180_edge_xy_pos', 1, 0, 0, 1], ['rot_180_edge_xz_neg', 5, 1, 1, 1], ['rot_180_edge_xz_pos', 5, 0, 1, 0], ['rot_180_edge_yz_neg', 2, 1, 1, 1],
   ['rot_180_edge_yz_pos', 2, 1, 0, 0], ['rot_90_x_neg', 2, 0, 0, 1], ['rot_90_x_pos', 2, 0, 1, 0], ['rot_90_y_neg', 5, 1, 0, 0],
   ['rot_90_y_pos', 5, 0, 0, 1], ['rot_90_z_neg', 1, 0, 1, 0], ['rot_90_z_pos', 1, 1, 0, 0], ['inversion', 0, 1, 1, 1], ['invert_x', 0, 1, 0, 0],
   ['invert_y', 0, 0, 1, 0], ['invert_z', 0, 0, 0, 1], ['rot_60_ref_nnn', 4, 1, 1, 1], ['rot_60_ref_nnp', 3, 1, 0, 0], ['rot_60_ref_npn', 3, 0, 0, 1],
   ['rot_60_ref_npp', 4, 0, 0, 1], ['rot_60_ref_pnn', 3, 0, 1, 0], ['rot_60_ref_pnp', 4, 1, 0, 0], ['rot_60_ref_ppn', 4, 0, 1, 0],
   ['rot_60_ref_ppp', 3, 1, 1, 1], ['swap_xy', 1, 0, 0, 0], ['swap_yz', 2, 0, 0, 0], ['swap_xz', 5, 0, 0, 0], ['swap_neg_xy', 1, 1, 1, 0],
   ['swap_neg_yz', 2, 0, 1, 1], ['swap_neg_xz', 5, 1, 0, 1], ['rot_90_ref_x_neg', 2, 1, 0, 1], ['rot_90_ref_x_pos', 2, 1, 1, 0],
   ['rot_90_ref_y_neg', 5, 1, 1, 0], ['rot_90_ref_y_pos', 5, 0, 1, 1], ['rot_90_ref_z_neg', 1, 0, 1, 1], ['rot_90_ref_z_pos', 1, 1, 0, 1]].forEach(function (a, i) {
    var at = ATV[a[1]], flips = [!!a[2], !!a[3], !!a[4]], mat = [flips[0] ? -1 : 1, 0, 0, 0, flips[1] ? -1 : 1, 0, 0, 0, flips[2] ? -1 : 1];
    mat = m3mul(mat, at.matrix);
    var t = { name: a[0], ordinal: i, axisTransformation: at, flips: flips, matrix: mat, mappings: null };
    t.getMatrix = function () { return mat.slice(); };
    t.toString = t.asString = function () { return a[0]; };
    t.shouldFlipDirection = function (axis) { return flips[axis]; };
    t.map = function (d) {
      if (!t.mappings) { t.mappings = DV.map(function (x) { var ax = at.map(x.axis); return D.from(ax, flips[ax] ? -x.sign : x.sign); }); }
      return t.mappings[d.ordinal];
    };
    DTV[i] = DT[a[0]] = t;
  });
  DT.values = DTV;
  var byKey = {}; DTV.forEach(function (t) { byKey[t.axisTransformation.ordinal + ':' + t.flips.join()] = t; });
  var DTC = DTV.map(function (a) { return DTV.map(function (b) {
    var at = b.axisTransformation.prepend(a.axisTransformation), fl = [0, 1, 2].map(function (k) { return a.flips[k] !== b.flips[a.axisTransformation.map(k)]; });
    return byKey[at.ordinal + ':' + fl.join()];
  }); });
  DTV.forEach(function (a) { a.prepend = function (o) { return DTC[a.ordinal][o.ordinal]; }; });
  var DTI = DTV.map(function (a) { return DTV.filter(function (b) { return a.prepend(b) === DT.identity; })[0]; });
  DTV.forEach(function (a) { a.inverse = function () { return DTI[a.ordinal]; }; });

  // BlockPointer / BlockPointerImpl: the dispenser's view of (world, pos); x/y/z are the block centre.
  U.BlockPointerImpl = function (world, pos) {
    return { world: world, pos: pos, getWorld: function () { return world; }, getPos: function () { return pos; },
      getX: function () { return pos.x + 0.5; }, getY: function () { return pos.y + 0.5; }, getZ: function () { return pos.z + 0.5; },
      getBlockState: function () { return world.getBlockState(pos); }, getBlockEntity: function () { return world.getBlockEntity(pos); } };
  };
  U.BlockPointer = U.BlockPointerImpl;
  // PositionImpl: immutable x/y/z.
  U.PositionImpl = function (x, y, z) { return { x: x, y: y, z: z, getX: function () { return x; }, getY: function () { return y; }, getZ: function () { return z; } }; };

  // ColorHelper.Argb on 32-bit ints.
  var A = U.ColorHelper = { Argb: {
    getAlpha: function (c) { return c >>> 24; }, getRed: function (c) { return c >> 16 & 255; }, getGreen: function (c) { return c >> 8 & 255; }, getBlue: function (c) { return c & 255; },
    getArgb: function (a, r, g, b) { return a << 24 | r << 16 | g << 8 | b; },
    mixColor: function (p, q) { var G = A.Argb; return G.getArgb(Math.trunc(G.getAlpha(p) * G.getAlpha(q) / 255), Math.trunc(G.getRed(p) * G.getRed(q) / 255), Math.trunc(G.getGreen(p) * G.getGreen(q) / 255), Math.trunc(G.getBlue(p) * G.getBlue(q) / 255)); } } };

  // ColumnPos: (x, z) with the long pack (BigInt, x in the low word) and the LCG-mixed hashCode.
  U.ColumnPos = function (x, z) {
    if (typeof x === 'object') { z = x.z; x = x.x; }
    var c = { x: x | 0, z: z | 0 };
    c.toChunkPos = function () { return { x: c.x >> 4, z: c.z >> 4 }; };
    c.pack = function () { return U.ColumnPos.pack(c.x, c.z); };
    c.toString = function () { return '[' + c.x + ', ' + c.z + ']'; };
    c.hashCode = function () { return (Math.imul(1664525, c.x) + 1013904223 | 0) ^ (Math.imul(1664525, c.z ^ -559038737) + 1013904223 | 0); };
    c.equals = function (o) { return !!o && o.x === c.x && o.z === c.z; };
    return c;
  };
  U.ColumnPos.pack = function (x, z) { return BigInt.asIntN(64, BigInt.asUintN(32, BigInt(x)) | BigInt.asUintN(32, BigInt(z)) << 32n); };

  // EightWayDirection: N NE E SE S SW W NW and the 1-2 cardinal directions each is made of.
  var E = U.EightWayDirection = {}, EV = [];
  [['NORTH', 'NORTH'], ['NORTH_EAST', 'NORTH', 'EAST'], ['EAST', 'EAST'], ['SOUTH_EAST', 'SOUTH', 'EAST'], ['SOUTH', 'SOUTH'], ['SOUTH_WEST', 'SOUTH', 'WEST'], ['WEST', 'WEST'], ['NORTH_WEST', 'NORTH', 'WEST']].forEach(function (e, i) {
    var ds = e.slice(1).map(function (n) { return D[n]; });
    EV[i] = E[e[0]] = { name: e[0], ordinal: i, getDirections: function () { return new Set(ds); } };
  });
  E.values = EV;

  // EulerAngle: degrees mod 360, non-finite becomes 0; NBT form is a list of three floats (a plain array here).
  U.EulerAngle = function (p, y, r) {
    if (Array.isArray(p)) { r = p[2]; y = p[1]; p = p[0]; }
    var f = function (v) { return isFinite(v) ? fr(v % 360) : 0; };
    var e = { pitch: f(p), yaw: f(y), roll: f(r) };
    e.getPitch = function () { return e.pitch; }; e.getYaw = function () { return e.yaw; }; e.getRoll = function () { return e.roll; };
    e.getWrappedPitch = function () { return wrapDeg(e.pitch); }; e.getWrappedYaw = function () { return wrapDeg(e.yaw); }; e.getWrappedRoll = function () { return wrapDeg(e.roll); };
    e.toNbt = function () { return [e.pitch, e.yaw, e.roll]; };
    e.equals = function (o) { return !!o && o.pitch === e.pitch && o.yaw === e.yaw && o.roll === e.roll; };
    return e;
  };

  // Quantiles: Guava scale(100).indexes(50,75,90,99), returned in descending key order (a reverse-ordered map).
  U.Quantiles = { create: function (data) {
    var n = data.length, out = new Map(); if (!n) return out;
    var s = Array.prototype.slice.call(data).sort(function (a, b) { return a - b; });
    [99, 90, 75, 50].forEach(function (idx) {
      var num = idx * (n - 1), q = Math.floor(num / 100), rem = num % 100;
      out.set(idx, rem === 0 ? s[q] : s[q] + (s[q + 1] - s[q]) * rem / 100);
    });
    return out;
  } };

  // Vec2f: float pair.
  var V2 = U.Vec2f = function (x, y) {
    var v = { x: fr(x), y: fr(y) };
    v.multiply = function (k) { return V2(v.x * k, v.y * k); };
    v.dot = function (o) { return fr(v.x * o.x + v.y * o.y); };
    v.add = function (o) { return typeof o === 'number' ? V2(v.x + o, v.y + o) : V2(v.x + o.x, v.y + o.y); };
    v.equals = function (o) { return v.x === o.x && v.y === o.y; };
    v.length = function () { return fr(Math.sqrt(fr(v.x * v.x + v.y * v.y))); };
    v.lengthSquared = function () { return fr(v.x * v.x + v.y * v.y); };
    v.normalize = function () { var l = v.length(); return l < fr(1.0E-4) ? V2.ZERO : V2(v.x / l, v.y / l); };
    v.distanceSquared = function (o) { var a = o.x - v.x, b = o.y - v.y; return fr(fr(a) * fr(a) + fr(b) * fr(b)); };
    v.negate = function () { return V2(-v.x, -v.y); };
    return v;
  };
  V2.ZERO = V2(0, 0); V2.SOUTH_EAST_UNIT = V2(1, 1); V2.EAST_UNIT = V2(1, 0); V2.WEST_UNIT = V2(-1, 0); V2.SOUTH_UNIT = V2(0, 1); V2.NORTH_UNIT = V2(0, -1);
  V2.MAX_SOUTH_EAST = V2(3.4028234663852886e38, 3.4028234663852886e38); V2.MIN_SOUTH_EAST = V2(1.401298464324817e-45, 1.401298464324817e-45);

  // VerticalSurfaceType: ceiling (up, +1) / floor (down, -1).
  var VS = U.VerticalSurfaceType = { CEILING: { name: 'ceiling', direction: D.UP, offset: 1 }, FLOOR: { name: 'floor', direction: D.DOWN, offset: -1 } };
  [VS.CEILING, VS.FLOOR].forEach(function (v) { v.getDirection = function () { return v.direction; }; v.getOffset = function () { return v.offset; }; v.asString = function () { return v.name; }; });
  VS.byName = function (n) { if (n === 'ceiling') return VS.CEILING; if (n === 'floor') return VS.FLOOR; throw new Error('Unknown Surface type: ' + n); };

  // WordPackedArray: unitSize-bit values (1..32) packed across 64-bit words (BigInt) without padding.
  U.WordPackedArray = function (unit, length, arr) {
    if (!(unit >= 1 && unit <= 32)) throw new Error('The value ' + unit + ' is not in the specified inclusive range of 1 to 32');
    var words = Math.ceil(length * unit / 64);
    if (!arr) arr = new Array(words).fill(0n);
    else if (arr.length !== words) throw new Error('Invalid length given for storage, got: ' + arr.length + ' but expected: ' + words);
    var max = (1n << BigInt(unit)) - 1n, M = (1n << 64n) - 1n, w = {};
    function rng(i, hi) { if (i < 0 || i > hi) throw new Error('The value ' + i + ' is not in the specified inclusive range of 0 to ' + hi); }
    w.set = function (i, v) {
      rng(i, length - 1); rng(v, Number(max));
      var s = i * unit, a = s >> 6, b = ((i + 1) * unit - 1) >> 6, o = s ^ (a << 6), V = BigInt(v) & max;
      arr[a] = (arr[a] & ~(max << BigInt(o)) & M | V << BigInt(o)) & M;
      if (a !== b) { var hi = 64 - o, lo = unit - hi; arr[b] = (arr[b] >> BigInt(lo) << BigInt(lo) | V >> BigInt(hi)) & M; }
    };
    w.get = function (i) {
      rng(i, length - 1);
      var s = i * unit, a = s >> 6, b = ((i + 1) * unit - 1) >> 6, o = s ^ (a << 6);
      if (a === b) return Number(arr[a] >> BigInt(o) & max);
      return Number((arr[a] >> BigInt(o) | arr[b] << BigInt(64 - o)) & max);
    };
    w.getAlignedArray = function () { return arr; }; w.getUnitSize = function () { return unit; };
    return w;
  };

  // Box: axis-aligned box, normalised min/max (the vanilla class name; physics modules use their own AABB tests).
  var EPS = 1.0E-7;
  var Box = U.Box = function (x1, y1, z1, x2, y2, z2) {
    if (arguments.length === 2) { var a = x1, b = y1; x1 = a.x; y1 = a.y; z1 = a.z; x2 = b.x; y2 = b.y; z2 = b.z; }
    else if (arguments.length === 1) { var p = x1; x1 = p.x; y1 = p.y; z1 = p.z; x2 = x1 + 1; y2 = y1 + 1; z2 = z1 + 1; }
    var b = { minX: Math.min(x1, x2), minY: Math.min(y1, y2), minZ: Math.min(z1, z2), maxX: Math.max(x1, x2), maxY: Math.max(y1, y2), maxZ: Math.max(z1, z2) };
    b.withMinX = function (v) { return Box(v, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ); }; b.withMinY = function (v) { return Box(b.minX, v, b.minZ, b.maxX, b.maxY, b.maxZ); };
    b.withMinZ = function (v) { return Box(b.minX, b.minY, v, b.maxX, b.maxY, b.maxZ); }; b.withMaxX = function (v) { return Box(b.minX, b.minY, b.minZ, v, b.maxY, b.maxZ); };
    b.withMaxY = function (v) { return Box(b.minX, b.minY, b.minZ, b.maxX, v, b.maxZ); }; b.withMaxZ = function (v) { return Box(b.minX, b.minY, b.minZ, b.maxX, b.maxY, v); };
    b.getMin = function (ax) { return [b.minX, b.minY, b.minZ][ax]; }; b.getMax = function (ax) { return [b.maxX, b.maxY, b.maxZ][ax]; };
    b.equals = function (o) { return !!o && Object.is(o.minX, b.minX) && Object.is(o.minY, b.minY) && Object.is(o.minZ, b.minZ) && Object.is(o.maxX, b.maxX) && Object.is(o.maxY, b.maxY) && Object.is(o.maxZ, b.maxZ); };
    b.shrink = function (x, y, z) { var m = [b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ];
      [x, y, z].forEach(function (d, i) { if (d < 0) m[i] -= d; else if (d > 0) m[i + 3] -= d; }); return Box(m[0], m[1], m[2], m[3], m[4], m[5]); };
    b.stretch = function (x, y, z) { if (typeof x === 'object') { z = x.z; y = x.y; x = x.x; } var m = [b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ];
      [x, y, z].forEach(function (d, i) { if (d < 0) m[i] += d; else if (d > 0) m[i + 3] += d; }); return Box(m[0], m[1], m[2], m[3], m[4], m[5]); };
    b.expand = function (x, y, z) { if (y === undefined) { y = x; z = x; } return Box(b.minX - x, b.minY - y, b.minZ - z, b.maxX + x, b.maxY + y, b.maxZ + z); };
    b.contract = function (x, y, z) { return y === undefined ? b.expand(-x) : b.expand(-x, -y, -z); };
    b.intersection = function (o) { return Box(Math.max(b.minX, o.minX), Math.max(b.minY, o.minY), Math.max(b.minZ, o.minZ), Math.min(b.maxX, o.maxX), Math.min(b.maxY, o.maxY), Math.min(b.maxZ, o.maxZ)); };
    b.union = function (o) { return Box(Math.min(b.minX, o.minX), Math.min(b.minY, o.minY), Math.min(b.minZ, o.minZ), Math.max(b.maxX, o.maxX), Math.max(b.maxY, o.maxY), Math.max(b.maxZ, o.maxZ)); };
    b.offset = function (x, y, z) { if (typeof x === 'object') { z = x.z; y = x.y; x = x.x; } return Box(b.minX + x, b.minY + y, b.minZ + z, b.maxX + x, b.maxY + y, b.maxZ + z); };
    b.intersects = function (a, c, d, e, f, g) {
      if (c === undefined) { return b.intersects(a.minX, a.minY, a.minZ, a.maxX, a.maxY, a.maxZ); }
      if (d === undefined) { return b.intersects(Math.min(a.x, c.x), Math.min(a.y, c.y), Math.min(a.z, c.z), Math.max(a.x, c.x), Math.max(a.y, c.y), Math.max(a.z, c.z)); }
      return b.minX < e && b.maxX > a && b.minY < f && b.maxY > c && b.minZ < g && b.maxZ > d; };
    b.contains = function (x, y, z) { if (typeof x === 'object') { z = x.z; y = x.y; x = x.x; } return x >= b.minX && x < b.maxX && y >= b.minY && y < b.maxY && z >= b.minZ && z < b.maxZ; };
    b.getXLength = function () { return b.maxX - b.minX; }; b.getYLength = function () { return b.maxY - b.minY; }; b.getZLength = function () { return b.maxZ - b.minZ; };
    b.getAverageSideLength = function () { return (b.getXLength() + b.getYLength() + b.getZLength()) / 3; };
    b.getCenter = function () { return { x: b.minX + (b.maxX - b.minX) * 0.5, y: b.minY + (b.maxY - b.minY) * 0.5, z: b.minZ + (b.maxZ - b.minZ) * 0.5 }; };
    b.isValid = function () { return isNaN(b.minX) || isNaN(b.minY) || isNaN(b.minZ) || isNaN(b.maxX) || isNaN(b.maxY) || isNaN(b.maxZ); };
    b.toString = function () { return 'AABB[' + b.minX + ', ' + b.minY + ', ' + b.minZ + '] -> [' + b.maxX + ', ' + b.maxY + ', ' + b.maxZ + ']'; };
    b.raycast = function (from, to) { var t = [1], r = trace(b, from, t, null, to.x - from.x, to.y - from.y, to.z - from.z);
      return r ? { x: from.x + t[0] * (to.x - from.x), y: from.y + t[0] * (to.y - from.y), z: from.z + t[0] * (to.z - from.z) } : null; };
    return b;
  };
  Box.from = function (v) { return Box(v.x, v.y, v.z, v.x + 1, v.y + 1, v.z + 1); };
  Box.fromBlockBox = function (bb) { return Box(bb.minX, bb.minY, bb.minZ, bb.maxX + 1, bb.maxY + 1, bb.maxZ + 1); };
  Box.of = function (c, x, y, z) { return Box(c.x - x / 2, c.y - y / 2, c.z - z / 2, c.x + x / 2, c.y + y / 2, c.z + z / 2); };
  // Box.raycast(boxes, from, to, pos): nearest hit over boxes offset by pos; {pos, side, blockPos} or null.
  Box.raycastBoxes = function (boxes, from, to, pos) {
    var t = [1], side = null, dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    boxes.forEach(function (bx) { side = trace(bx.offset(pos), from, t, side, dx, dy, dz); });
    return side ? { pos: { x: from.x + t[0] * dx, y: from.y + t[0] * dy, z: from.z + t[0] * dz }, side: side, blockPos: pos } : null;
  };
  function trace(bx, o, t, side, dx, dy, dz) {
    if (dx > EPS) side = face(t, side, dx, dy, dz, bx.minX, bx.minY, bx.maxY, bx.minZ, bx.maxZ, D.WEST, o.x, o.y, o.z);
    else if (dx < -EPS) side = face(t, side, dx, dy, dz, bx.maxX, bx.minY, bx.maxY, bx.minZ, bx.maxZ, D.EAST, o.x, o.y, o.z);
    if (dy > EPS) side = face(t, side, dy, dz, dx, bx.minY, bx.minZ, bx.maxZ, bx.minX, bx.maxX, D.DOWN, o.y, o.z, o.x);
    else if (dy < -EPS) side = face(t, side, dy, dz, dx, bx.maxY, bx.minZ, bx.maxZ, bx.minX, bx.maxX, D.UP, o.y, o.z, o.x);
    if (dz > EPS) side = face(t, side, dz, dx, dy, bx.minZ, bx.minX, bx.maxX, bx.minY, bx.maxY, D.NORTH, o.z, o.x, o.y);
    else if (dz < -EPS) side = face(t, side, dz, dx, dy, bx.maxZ, bx.minX, bx.maxX, bx.minY, bx.maxY, D.SOUTH, o.z, o.x, o.y);
    return side;
  }
  function face(t, side, a, b, c, p, lo1, hi1, lo2, hi2, dir, o1, o2, o3) {
    var k = (p - o1) / a, u = o2 + k * b, v = o3 + k * c;
    if (0 < k && k < t[0] && lo1 - EPS < u && u < hi1 + EPS && lo2 - EPS < v && v < hi2 + EPS) { t[0] = k; return dir; }
    return side;
  }
  // ---- Matrix4f / Quaternion / AffineTransformation(s) (#11764). Matrix4f is a row-major 16-array (a[r*4+c]) of floats (every op fround'ed,
  // as Java float arithmetic). Quaternion is {x,y,z,w}. Not ported: AffineTransformation's SVD decomposition (Matrix3f.decomposeLinearTransformation)
  // and its lerp (method_35864): a transformation built from a bare matrix throws on getRotation1/2/getScale (open owed part).
  var M4 = U.Matrix4f = {};
  M4.identity = function () { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; };
  M4.translate = function (x, y, z) { var m = M4.identity(); m[3] = fr(x); m[7] = fr(y); m[11] = fr(z); return m; };
  M4.scale = function (x, y, z) { var m = M4.identity(); m[0] = fr(x); m[5] = fr(y); m[10] = fr(z); return m; };
  M4.fromQuaternion = function (q) {
    var x = q.x, y = q.y, z = q.z, w = q.w, m = M4.identity();
    var a = fr(fr(2 * x) * x), b = fr(fr(2 * y) * y), c = fr(fr(2 * z) * z);
    m[0] = fr(fr(1 - b) - c); m[5] = fr(fr(1 - c) - a); m[10] = fr(fr(1 - a) - b);
    var xy = fr(x * y), yz = fr(y * z), zx = fr(z * x), xw = fr(x * w), yw = fr(y * w), zw = fr(z * w);
    m[4] = fr(2 * fr(xy + zw)); m[1] = fr(2 * fr(xy - zw)); m[8] = fr(2 * fr(zx - yw)); m[2] = fr(2 * fr(zx + yw));
    m[9] = fr(2 * fr(yz + xw)); m[6] = fr(2 * fr(yz - xw));
    return m;
  };
  M4.multiply = function (a, b) {   // this.multiply(other): returns a * b (new array)
    var o = new Array(16);
    for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++)
      o[r * 4 + c] = fr(fr(fr(fr(a[r * 4] * b[c]) + fr(a[r * 4 + 1] * b[4 + c])) + fr(a[r * 4 + 2] * b[8 + c])) + fr(a[r * 4 + 3] * b[12 + c]));
    return o;
  };
  M4.scalar = function (a, k) { return a.map(function (v) { return fr(v * k); }); };
  // invert: Matrix4f.invert as decompiled (adjugate scaled by the returned determinant term; exact inverse for det==1, i.e. rotations/translations).
  M4.invert = function (a) {
    var A = function (r, c) { return a[r * 4 + c]; }, p = function (x, y, z, w) { return fr(x * y) - fr(z * w); };
    var s0 = fr(p(A(0, 0), A(1, 1), A(0, 1), A(1, 0))), s1 = fr(p(A(0, 0), A(1, 2), A(0, 2), A(1, 0))), s2 = fr(p(A(0, 0), A(1, 3), A(0, 3), A(1, 0)));
    var s3 = fr(p(A(0, 1), A(1, 2), A(0, 2), A(1, 1))), s4 = fr(p(A(0, 1), A(1, 3), A(0, 3), A(1, 1))), s5 = fr(p(A(0, 2), A(1, 3), A(0, 3), A(1, 2)));
    var c0 = fr(p(A(2, 0), A(3, 1), A(2, 1), A(3, 0))), c1 = fr(p(A(2, 0), A(3, 2), A(2, 2), A(3, 0))), c2 = fr(p(A(2, 0), A(3, 3), A(2, 3), A(3, 0)));
    var c3 = fr(p(A(2, 1), A(3, 2), A(2, 2), A(3, 1))), c4 = fr(p(A(2, 1), A(3, 3), A(2, 3), A(3, 1))), c5 = fr(p(A(2, 2), A(3, 3), A(2, 3), A(3, 2)));
    var t = function (x, y, z, w, u, v) { return fr(fr(fr(x * y) + fr(z * w)) + fr(u * v)); };
    var o = new Array(16);
    o[0] = t(A(1, 1), c5, -A(1, 2), c4, A(1, 3), c3); o[4] = t(-A(1, 0), c5, A(1, 2), c2, -A(1, 3), c1);
    o[8] = t(A(1, 0), c4, -A(1, 1), c2, A(1, 3), c0); o[12] = t(-A(1, 0), c3, A(1, 1), c1, -A(1, 2), c0);
    o[1] = t(-A(0, 1), c5, A(0, 2), c4, -A(0, 3), c3); o[5] = t(A(0, 0), c5, -A(0, 2), c2, A(0, 3), c1);
    o[9] = t(-A(0, 0), c4, A(0, 1), c2, -A(0, 3), c0); o[13] = t(A(0, 0), c3, -A(0, 1), c1, A(0, 2), c0);
    o[2] = t(A(3, 1), s5, -A(3, 2), s4, A(3, 3), s3); o[6] = t(-A(3, 0), s5, A(3, 2), s2, -A(3, 3), s1);
    o[10] = t(A(3, 0), s4, -A(3, 1), s2, A(3, 3), s0); o[14] = t(-A(3, 0), s3, A(3, 1), s1, -A(3, 2), s0);
    o[3] = t(-A(2, 1), s5, A(2, 2), s4, -A(2, 3), s3); o[7] = t(A(2, 0), s5, -A(2, 2), s2, A(2, 3), s1);
    o[11] = t(-A(2, 0), s4, A(2, 1), s2, -A(2, 3), s0); o[15] = t(A(2, 0), s3, -A(2, 1), s1, A(2, 2), s0);
    var det = fr(fr(fr(fr(fr(fr(s0 * c5) - fr(s1 * c4)) + fr(s2 * c3)) + fr(s3 * c2)) - fr(s4 * c1)) + fr(s5 * c0));
    if (Math.abs(det) > fr(1.0E-6)) return M4.scalar(o, det);
    return null;
  };
  var Q = U.Quaternion = {};
  Q.IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
  // new Quaternion(axis, degrees, true)
  Q.fromDegrees = function (axis, deg) {
    var r = fr(fr(deg) * fr(Math.PI / 180)), h = fr(r / 2), s = fr(Math.sin(h));
    return { x: fr(axis.x * s), y: fr(axis.y * s), z: fr(axis.z * s), w: fr(Math.cos(h)) };
  };
  var AFF = U.AffineTransformation = function (a, b, c, d) {
    var self = {};
    if (arguments.length === 1 || (Array.isArray(a) && b === undefined)) {   // (matrix | null)
      self.matrix = a || AFF.identity().matrix;
      self.initialized = false;
    } else {                                                                  // (translation, rotation2, scale, rotation1)
      var m = M4.identity();
      if (b) m = M4.multiply(m, M4.fromQuaternion(b));
      if (c) m = M4.multiply(m, M4.scale(c.x, c.y, c.z));
      if (d) m = M4.multiply(m, M4.fromQuaternion(d));
      if (a) { m[3] = fr(a.x); m[7] = fr(a.y); m[11] = fr(a.z); }
      self.matrix = m;
      self.translation = a ? { x: a.x, y: a.y, z: a.z } : { x: 0, y: 0, z: 0 };
      self.rotation2 = b ? { x: b.x, y: b.y, z: b.z, w: b.w } : { x: 0, y: 0, z: 0, w: 1 };
      self.scale = c ? { x: c.x, y: c.y, z: c.z } : { x: 1, y: 1, z: 1 };
      self.rotation1 = d ? { x: d.x, y: d.y, z: d.z, w: d.w } : { x: 0, y: 0, z: 0, w: 1 };
      self.initialized = true;
    }
    self.getMatrix = function () { return self.matrix.slice(); };
    self.multiply = function (o) { return AFF(M4.multiply(self.matrix, o.getMatrix())); };
    self.invert = function () {
      if (self === AFF.identity()) return self;
      var i = M4.invert(self.matrix); return i ? AFF(i) : null;
    };
    self.getTranslation = function () {
      if (!self.initialized) { var k = fr(1 / self.matrix[15]), m = M4.scalar(self.matrix, k); return { x: m[3], y: m[7], z: m[11] }; }
      return { x: self.translation.x, y: self.translation.y, z: self.translation.z };
    };
    function need() { if (!self.initialized) throw new Error('AffineTransformation: SVD decomposition not ported (owed)'); }
    self.getRotation2 = function () { need(); return Object.assign({}, self.rotation2); };
    self.getScale = function () { need(); return Object.assign({}, self.scale); };
    self.getRotation1 = function () { need(); return Object.assign({}, self.rotation1); };
    self.equals = function (o) { return o === self || (!!o && o.getMatrix && o.getMatrix().join() === self.matrix.join()); };
    return self;
  };
  var AFF_ID = null;
  AFF.identity = function () { return AFF_ID || (AFF_ID = (function () { var a = AFF(M4.identity()); a.initialized = true; a.translation = { x: 0, y: 0, z: 0 }; a.rotation2 = { x: 0, y: 0, z: 0, w: 1 }; a.scale = { x: 1, y: 1, z: 1 }; a.rotation1 = { x: 0, y: 0, z: 0, w: 1 }; return a; })()); };
  var AX = { X: { x: 1, y: 0, z: 0 }, Y: { x: 0, y: 1, z: 0 } };
  var AFS = U.AffineTransformations = {}, DR = AFS.DIRECTION_ROTATIONS = {}, IDR = AFS.INVERTED_DIRECTION_ROTATIONS = {};
  DR.SOUTH = AFF.identity();
  DR.EAST = AFF(null, Q.fromDegrees(AX.Y, 90), null, null); DR.WEST = AFF(null, Q.fromDegrees(AX.Y, -90), null, null);
  DR.NORTH = AFF(null, Q.fromDegrees(AX.Y, 180), null, null);
  DR.UP = AFF(null, Q.fromDegrees(AX.X, -90), null, null); DR.DOWN = AFF(null, Q.fromDegrees(AX.X, 90), null, null);
  Object.keys(DR).forEach(function (k) { IDR[k] = DR[k].invert(); });
  AFS.setupUvLock = function (t) {
    var m = M4.multiply(M4.translate(0.5, 0.5, 0.5), t.getMatrix()); return AFF(M4.multiply(m, M4.translate(-0.5, -0.5, -0.5)));
  };
  AFS.method_35829 = function (t) {
    var m = M4.multiply(M4.translate(-0.5, -0.5, -0.5), t.getMatrix()); return AFF(M4.multiply(m, M4.translate(0.5, 0.5, 0.5)));
  };
})(MCL);
