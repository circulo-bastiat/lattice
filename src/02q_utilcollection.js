// NS.UtilCollection: net/minecraft/util/collection ports (#11763), from .decomp. DefaultedList EmptyPaletteStorage IdList
//  IndexedIterable(duck type: getRawId/get/size/iterator) Int2ObjectBiMap LinkedBlockPosHashSet PackedIntegerArray
//  PaletteStorage(duck type) SortedArraySet TypeFilterableList.
// JS notes: Java longs are BigInt (PackedIntegerArray data is a BigUint64Array); identityHashCode-based open addressing in
//  Int2ObjectBiMap and the fastutil open hash in LinkedBlockPosHashSet are replaced by Map (same observable behaviour, Map keeps insertion = link order).
(function (NS) {
  'use strict';
  var C = NS.UtilCollection = {};
  function between(lo, hi, v) { if (!(v >= lo && v <= hi)) throw new Error('The value ' + v + ' is not in the specified inclusive range of ' + lo + ' to ' + hi); }
  function notNull(v) { if (v == null) throw new Error('The validated object is null'); }
  // DefaultedList: array with an optional initial element; null elements rejected; clear() resets to the initial element if there is one.
  C.DefaultedList = {
    of: function () { return mkDL([], null); },
    ofSize: function (n, init) {
      if (arguments.length < 2) return mkDL([], null);
      notNull(init); var a = new Array(n); for (var i = 0; i < n; i++) a[i] = init; return mkDL(a, init);
    },
    copyOf: function (init) { return mkDL(Array.prototype.slice.call(arguments, 1), init); }
  };
  function mkDL(d, init) {
    return {
      initialElement: init, delegate: d,
      get: function (i) { if (i < 0 || i >= d.length) throw new RangeError('Index ' + i); return d[i]; },
      set: function (i, v) { notNull(v); if (i < 0 || i >= d.length) throw new RangeError('Index ' + i); var o = d[i]; d[i] = v; return o; },
      add: function (i, v) { if (arguments.length === 1) { v = i; i = d.length; } notNull(v); if (i < 0 || i > d.length) throw new RangeError('Index ' + i); d.splice(i, 0, v); },
      remove: function (i) { if (i < 0 || i >= d.length) throw new RangeError('Index ' + i); return d.splice(i, 1)[0]; },
      size: function () { return d.length; },
      clear: function () { if (init == null) d.length = 0; else for (var i = 0; i < d.length; i++) d[i] = init; },
      toArray: function () { return d.slice(); }
    };
  }
  // EmptyPaletteStorage: every entry is 0, zero bits.
  C.EmptyPaletteStorage = function (size) {
    return {
      swap: function (i, v) { between(0, size - 1, i); between(0, 0, v); return 0; },
      set: function (i, v) { between(0, size - 1, i); between(0, 0, v); },
      get: function (i) { between(0, size - 1, i); return 0; },
      getData: function () { return C.EmptyPaletteStorage.EMPTY_DATA; },
      getSize: function () { return size; }, getElementBits: function () { return 0; },
      forEach: function (f) { for (var i = 0; i < size; i++) f(0); },
      method_39892: function (out) { out.fill(0, 0, size); },
      copy: function () { return this; }
    };
  };
  C.EmptyPaletteStorage.EMPTY_DATA = new BigUint64Array(0);
  // IdList: identity-keyed id <-> object table; get() of a hole is null; iteration skips holes.
  C.IdList = function () {
    var nextId = 0, idMap = new Map(), list = [];
    var o = {
      set: function (v, id) { idMap.set(v, id); while (list.length <= id) list.push(null); list[id] = v; if (nextId <= id) nextId = id + 1; },
      add: function (v) { o.set(v, nextId); },
      getRawId: function (v) { return idMap.has(v) ? idMap.get(v) : -1; },
      get: function (id) { return id >= 0 && id < list.length ? list[id] : null; },
      iterator: function () { return list.filter(function (x) { return x != null; })[Symbol.iterator](); },
      containsKey: function (id) { return o.get(id) != null; },
      size: function () { return idMap.size; }
    };
    return o;
  };
  // Int2ObjectBiMap: put/add/get/getRawId with the same nextId and size bookkeeping as vanilla.
  function biMap(values, idToValues, nextId, size) {
    var o = {
      getRawId: function (v) { return values.has(v) ? values.get(v) : -1; },
      get: function (id) { return id >= 0 && id < idToValues.length ? (idToValues[id] == null ? null : idToValues[id]) : null; },
      contains: function (v) { return o.getRawId(v) !== -1; },
      containsKey: function (id) { return o.get(id) != null; },
      add: function (v) { var id = nid(); o.put(v, id); return id; },
      put: function (v, id) { idToValues[id] = v; values.set(v, id); size++; if (id === nextId) nextId++; },
      iterator: function () { return idToValues.filter(function (x) { return x != null; })[Symbol.iterator](); },
      clear: function () { values.clear(); idToValues.length = 0; nextId = 0; size = 0; },
      size: function () { return size; },
      copy: function () { return biMap(new Map(values), idToValues.slice(), nextId, size); }
    };
    function nid() { while (nextId < idToValues.length && idToValues[nextId] != null) nextId++; return nextId; }
    return o;
  }
  C.Int2ObjectBiMap = { create: function (cap) { return biMap(new Map(), [], 0, 0); } };
  // PackedIntegerArray: elements never straddle longs; INDEX_PARAMETERS magic division kept as in the decomp.
  var IP = [-1, -1, 0, -2147483648, 0, 0, 1431655765, 1431655765, 0, -2147483648, 0, 1, 858993459, 858993459, 0, 715827882, 715827882, 0, 613566756, 613566756, 0, -2147483648, 0, 2,
    477218588, 477218588, 0, 429496729, 429496729, 0, 390451572, 390451572, 0, 357913941, 357913941, 0, 330382099, 330382099, 0, 306783378, 306783378, 0, 286331153, 286331153, 0, -2147483648, 0, 3,
    252645135, 252645135, 0, 238609294, 238609294, 0, 226050910, 226050910, 0, 214748364, 214748364, 0, 204522252, 204522252, 0, 195225786, 195225786, 0, 186737708, 186737708, 0, 178956970, 178956970, 0,
    171798691, 171798691, 0, 165191049, 165191049, 0, 159072862, 159072862, 0, 153391689, 153391689, 0, 148102320, 148102320, 0, 143165576, 143165576, 0, 138547332, 138547332, 0, -2147483648, 0, 4,
    130150524, 130150524, 0, 126322567, 126322567, 0, 122713351, 122713351, 0, 119304647, 119304647, 0, 116080197, 116080197, 0, 113025455, 113025455, 0, 110127366, 110127366, 0, 107374182, 107374182, 0,
    104755299, 104755299, 0, 102261126, 102261126, 0, 99882960, 99882960, 0, 97612893, 97612893, 0, 95443717, 95443717, 0, 93368854, 93368854, 0, 91382282, 91382282, 0, 89478485, 89478485, 0,
    87652393, 87652393, 0, 85899345, 85899345, 0, 84215045, 84215045, 0, 82595524, 82595524, 0, 81037118, 81037118, 0, 79536431, 79536431, 0, 78090314, 78090314, 0, 76695844, 76695844, 0,
    75350303, 75350303, 0, 74051160, 74051160, 0, 72796055, 72796055, 0, 71582788, 71582788, 0, 70409299, 70409299, 0, 69273666, 69273666, 0, 68174084, 68174084, 0, -2147483648, 0, 5];
  C.PackedIntegerArray = function (bits, size, init) {
    between(1, 32, bits);
    var B = BigInt, mask = (1n << B(bits)) - 1n, bb = B(bits), per = Math.trunc(64 / bits), p = 3 * (per - 1);
    var scale = B(IP[p] >>> 0), off = B(IP[p + 1] >>> 0), shift = B(IP[p + 2]), len = Math.trunc((size + per - 1) / per), data;
    var vals = null;
    if (init != null && !(init instanceof BigUint64Array)) { vals = init; init = null; }
    if (init != null) { if (init.length !== len) throw new Error('Invalid length given for storage, got: ' + init.length + ' but expected: ' + len); data = init; }
    else data = new BigUint64Array(len);
    function idx(i) { return Number(((B(i) * scale + off) >> 32n) >> shift); }
    var o = {
      swap: function (i, v) {
        between(0, size - 1, i); between(0, Number(mask), v);
        var s = idx(i), w = data[s], sh = B((i - s * per) * bits), old = Number((w >> sh) & mask);
        data[s] = (w & ~(mask << sh)) | ((B(v) & mask) << sh); return old;
      },
      set: function (i, v) { o.swap(i, v); },
      get: function (i) { between(0, size - 1, i); var s = idx(i); return Number((data[s] >> B((i - s * per) * bits)) & mask); },
      getData: function () { return data; }, getSize: function () { return size; }, getElementBits: function () { return bits; },
      forEach: function (f) {
        var n = 0;
        for (var k = 0; k < data.length; k++) { var w = data[k]; for (var j = 0; j < per; j++) { f(Number(w & mask)); w >>= bb; if (++n >= size) return; } }
      },
      method_39892: function (out) {
        var n = data.length, pos = 0;
        for (var k = 0; k < n - 1; k++) { var w = data[k]; for (var j = 0; j < per; j++) { out[pos + j] = Number(w & mask); w >>= bb; } pos += per; }
        var rest = size - pos;
        if (rest > 0) { var w2 = data[n - 1]; for (var j2 = 0; j2 < rest; j2++) { out[pos + j2] = Number(w2 & mask); w2 >>= bb; } }
      },
      copy: function () { return C.PackedIntegerArray(bits, size, data.slice()); }
    };
    // Constructor from int[] values (vanilla's (bits,size,int[]) overload): values masked, low index in the low bits.
    if (vals != null) for (var i = 0; i < size; i++) { var s2 = idx(i), sh = B((i - s2 * per) * bits); data[s2] |= (B(vals[i]) & mask) << sh; }
    return o;
  };
  // LinkedBlockPosHashSet: BlockPos longs (BigInt) grouped by the 4x4x4 cell they sit in; one 64-bit mask per cell, insertion ordered.
  var START = 25, HSEP = 25, FIELD = 64 - START - HSEP, XO = BigInt(FIELD), ZO = BigInt(FIELD + HSEP);
  var MAXPOS = (3n << ZO) | 3n | (3n << XO);
  function sl(v) { return BigInt.asIntN(64, BigInt(v)); }
  function offsetOf(p) {
    var u = BigInt.asUintN(64, p), z = Number((u >> ZO) & 3n), y = Number(u & 3n), x = Number((u >> XO) & 3n);
    return (z << 4) | (x << 2) | y;
  }
  function posOf(key, off) { return BigInt.asIntN(64, key | (BigInt((off >>> 4) & 3) << ZO) | (BigInt((off >>> 2) & 3) << XO) | BigInt(off & 3)); }
  C.LinkedBlockPosHashSet = function () {
    var m = new Map();
    return {
      add: function (p) {
        p = sl(p); var k = p & ~MAXPOS, bit = 1n << BigInt(offsetOf(p)), v = m.get(k);
        if (v === undefined) { m.set(k, bit); return false; }
        m.set(k, v | bit); return (v & bit) !== 0n;
      },
      rem: function (p) {
        p = sl(p); var k = p & ~MAXPOS, bit = 1n << BigInt(offsetOf(p)), v = m.get(k);
        if (v === undefined || (v & bit) === 0n) return false;
        v &= ~bit; if (v === 0n) m.delete(k); else m.set(k, v); return true;
      },
      removeFirstLong: function () {
        if (m.size === 0) throw new Error('NoSuchElementException');
        var e = m.entries().next().value, k = e[0], v = e[1], tz = 0;
        while (tz < 64 && ((v >> BigInt(tz)) & 1n) === 0n) tz++;
        v &= ~(1n << BigInt(tz)); if (v === 0n) m.delete(k); else m.set(k, v);
        return posOf(k, tz);
      },
      size: function () { throw new Error('UnsupportedOperationException'); },
      isEmpty: function () { return m.size === 0; }
    };
  };
  // SortedArraySet: sorted unique array; cmp defaults to natural order.
  C.SortedArraySet = function (cmp) {
    cmp = cmp || function (a, b) { return a < b ? -1 : a > b ? 1 : 0; };
    var el = [];
    function bs(x) { var lo = 0, hi = el.length - 1; while (lo <= hi) { var mid = (lo + hi) >>> 1, c = cmp(el[mid], x); if (c < 0) lo = mid + 1; else if (c > 0) hi = mid - 1; else return mid; } return -(lo + 1); }
    var o = {
      add: function (x) { var i = bs(x); if (i >= 0) return false; el.splice(-i - 1, 0, x); return true; },
      addAndGet: function (x) { var i = bs(x); if (i >= 0) return el[i]; el.splice(-i - 1, 0, x); return x; },
      remove: function (x) { var i = bs(x); if (i < 0) return false; el.splice(i, 1); return true; },
      getIfContains: function (x) { var i = bs(x); return i >= 0 ? el[i] : null; },
      first: function () { return el[0]; }, last: function () { return el[el.length - 1]; },
      contains: function (x) { return bs(x) >= 0; },
      iterator: function () { var next = 0, last = -1; return {
        hasNext: function () { return next < el.length; },
        next: function () { if (next >= el.length) throw new Error('NoSuchElementException'); last = next++; return el[last]; },
        remove: function () { if (last === -1) throw new Error('IllegalStateException'); el.splice(last, 1); next--; last = -1; } }; },
      size: function () { return el.length; }, toArray: function () { return el.slice(); }, clear: function () { el.length = 0; }
    };
    return o;
  };
  C.SortedArraySet.create = function (cmp) { return C.SortedArraySet(cmp); };
  // TypeFilterableList: per-class views (constructors; isInstance = instanceof), built lazily, kept in sync on add/remove.
  C.TypeFilterableList = function (elementType) {
    var byType = new Map(), all = [];
    byType.set(elementType, all);
    var o = {
      add: function (x) { var r = false; byType.forEach(function (l, c) { if (x instanceof c) { l.push(x); r = true; } }); return r; },
      remove: function (x) { var r = false; byType.forEach(function (l, c) { if (x instanceof c) { var i = l.indexOf(x); if (i >= 0) { l.splice(i, 1); r = true; } } }); return r; },
      contains: function (x) { return o.getAllOfType(x.constructor).indexOf(x) >= 0; },
      getAllOfType: function (c) {
        if (!(c === elementType || c.prototype instanceof elementType)) throw new Error("Don't know how to search for " + c);
        var l = byType.get(c); if (!l) { l = all.filter(function (x) { return x instanceof c; }); byType.set(c, l); }
        return l.slice();
      },
      iterator: function () { return all[Symbol.iterator](); },
      copy: function () { return all.slice(); }, size: function () { return all.length; }
    };
    return o;
  };
})(MCL);
