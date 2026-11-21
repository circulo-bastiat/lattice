// NS.BiomeClasses: net/minecraft/world/biome/source ports (#11770), from .decomp. Cited: BiomeCoords SeedMixer BiomeSupplier
// CheckerboardBiomeSource util/MultiNoiseUtil (ParameterRange, NoiseHypercube, NoiseValuePoint, Entries, SearchTree, FittestPositionFinder,
// MultiNoiseSampler). Noise longs are plain Numbers (max |value| ~4e4, squared sums < 2^53); SeedMixer is BigInt (64-bit wrap).
(function (NS) {
  'use strict';
  var B = NS.BiomeClasses = {};
  var M64 = (1n << 64n) - 1n;
  var BC = B.BiomeCoords = {
    fromBlock: function (v) { return v >> 2; }, method_39920: function (v) { return v & 3; }, toBlock: function (v) { return v << 2; },
    fromChunk: function (v) { return v << 2; }, toChunk: function (v) { return v >> 2; }
  };
  B.SeedMixer = {
    mixSeed: function (a, b) {
      a = BigInt(a); b = BigInt(b);
      a = (a * ((a * 6364136223846793005n + 1442695040888963407n) & M64)) & M64;
      return BigInt.asIntN(64, a + b);
    }
  };
  // BiomeSupplier is an interface: getBiome(x,y,z,sampler). A function or {getBiome} both satisfy it.
  B.BiomeSupplier = { of: function (f) { return typeof f === 'function' ? { getBiome: f } : f; } };
  function floorMod(a, b) { return ((a % b) + b) % b; }
  B.CheckerboardBiomeSource = function (biomes, scale) {
    this.biomeArray = biomes; this.gridSize = scale + 2; this.scale = scale;
  };
  B.CheckerboardBiomeSource.prototype.withSeed = function () { return this; };
  B.CheckerboardBiomeSource.prototype.getBiome = function (x, y, z) {
    return this.biomeArray[floorMod((x >> this.gridSize) + (z >> this.gridSize), this.biomeArray.length)];
  };

  // ---- MultiNoiseUtil
  var M = B.MultiNoiseUtil = {};
  function jlong(f) { return Math.trunc(Math.fround(Math.fround(f) * 10000)); }
  M.method_38665 = jlong; // (long)(f * 10000.0F), float multiply
  M.method_38666 = function (l) { return Math.fround(Math.fround(l) / Math.fround(10000)); };
  function sq(v) { return v * v; }
  function PR(min, max) { this.min = min; this.max = max; }
  PR.of = function (a, b) {
    if (b === undefined) b = a;
    if (a > b) throw new Error('min > max: ' + a + ' ' + b);
    return new PR(jlong(a), jlong(b));
  };
  PR.combineRanges = function (a, b) { if (a.min > b.max) throw new Error('min > max'); return new PR(a.min, b.max); };
  PR.prototype.toString = function () { return this.min === this.max ? '' + this.min : '[' + this.min + '-' + this.max + ']'; };
  PR.prototype.getDistance = function (o) {
    var lo, hi;
    if (typeof o === 'object') { lo = o.min; hi = o.max; } else { lo = hi = o; }
    var d1 = lo - this.max, d2 = this.min - hi;
    return d1 > 0 ? d1 : Math.max(d2, 0);
  };
  PR.prototype.combine = function (o) { return o == null ? this : new PR(Math.min(this.min, o.min), Math.max(this.max, o.max)); };
  M.ParameterRange = PR;
  M.createNoiseValuePoint = function (t, h, c, e, d, w) {
    return { temperatureNoise: jlong(t), humidityNoise: jlong(h), continentalnessNoise: jlong(c), erosionNoise: jlong(e), depth: jlong(d), weirdnessNoise: jlong(w) };
  };
  M.noiseValueList = function (p) { return [p.temperatureNoise, p.humidityNoise, p.continentalnessNoise, p.erosionNoise, p.depth, p.weirdnessNoise, 0]; };
  function isR(x) { return x instanceof PR; }
  M.createNoiseHypercube = function (t, h, c, e, d, w, off) {
    var r = function (x) { return isR(x) ? x : PR.of(x); };
    return { temperature: r(t), humidity: r(h), continentalness: r(c), erosion: r(e), depth: r(d), weirdness: r(w), offset: jlong(off) };
  };
  M.getSquaredDistance = function (hc, p) {
    return sq(hc.temperature.getDistance(p.temperatureNoise)) + sq(hc.humidity.getDistance(p.humidityNoise)) +
      sq(hc.continentalness.getDistance(p.continentalnessNoise)) + sq(hc.erosion.getDistance(p.erosionNoise)) +
      sq(hc.depth.getDistance(p.depth)) + sq(hc.weirdness.getDistance(p.weirdnessNoise)) + sq(hc.offset);
  };
  M.getParameters = function (hc) {
    return [hc.temperature, hc.humidity, hc.continentalness, hc.erosion, hc.depth, hc.weirdness, new PR(hc.offset, hc.offset)];
  };
  // Java long division truncates toward zero
  function ldiv2(v) { return Math.trunc(v / 2); }
  function mid(r) { return ldiv2(r.min + r.max); }

  function Leaf(hc, value) { this.parameters = M.getParameters(hc); this.value = value; this.isLeaf = true; }
  function Branch(a, b) {
    if (b === undefined) { b = a; a = enclosing(b); }
    this.parameters = a; this.subTree = b.slice(); this.isLeaf = false;
  }
  function enclosing(nodes) {
    if (!nodes.length) throw new Error('SubTree needs at least one child');
    var out = [null, null, null, null, null, null, null];
    nodes.forEach(function (n) { for (var i = 0; i < 7; i++) out[i] = n.parameters[i].combine(out[i]); });
    return out;
  }
  function nodeDist(n, p) { var s = 0; for (var i = 0; i < 7; i++) s += sq(n.parameters[i].getDistance(p[i])); return s; }
  function result(node, p, prev, dist) {
    if (node.isLeaf) return node;
    var best = prev == null ? Infinity : dist(prev, p), bn = prev;
    for (var i = 0; i < node.subTree.length; i++) {
      var c = node.subTree[i], d = dist(c, p);
      if (best > d) {
        var r = result(c, p, bn, dist), rd = c === r ? d : dist(r, p);
        if (best > rd) { best = rd; bn = r; }
      }
    }
    return bn;
  }
  function cmp(i, abs) { return function (a, b) { var x = mid(a.parameters[i]), y = mid(b.parameters[i]); if (abs) { x = Math.abs(x); y = Math.abs(y); } return x - y; }; }
  function sortTree(list, dims, i, abs) {
    var cs = []; for (var k = 0; k < dims; k++) cs.push(cmp((i + k) % dims, abs));
    list.sort(function (a, b) { for (var k = 0; k < cs.length; k++) { var r = cs[k](a, b); if (r) return r; } return 0; });
  }
  function batched(list) {
    var out = [], cur = [], n = Math.trunc(Math.pow(10, Math.floor(Math.log(list.length - 0.01) / Math.log(10))));
    list.forEach(function (x) { cur.push(x); if (cur.length >= n) { out.push(new Branch(cur)); cur = []; } });
    if (cur.length) out.push(new Branch(cur));
    return out;
  }
  function rangeLenSum(ps) { var s = 0; ps.forEach(function (r) { s += Math.abs(r.max - r.min); }); return s; }
  function createNode(dims, list) {
    if (!list.length) throw new Error('Need at least one child to build a node');
    if (list.length === 1) return list[0];
    if (list.length <= 10) {
      var key = function (n) { var s = 0; for (var i = 0; i < dims; i++) s += Math.abs(mid(n.parameters[i])); return s; };
      list.sort(function (a, b) { return key(a) - key(b); });
      return new Branch(list);
    }
    var bestSum = Infinity, bestDim = -1, bestL = null;
    for (var d = 0; d < dims; d++) {
      sortTree(list, dims, d, false);
      var l = batched(list), s = 0;
      l.forEach(function (b) { s += rangeLenSum(b.parameters); });
      if (bestSum > s) { bestSum = s; bestDim = d; bestL = l; }
    }
    sortTree(bestL, dims, bestDim, true);
    return new Branch(bestL.map(function (b) { return createNode(dims, b.subTree); }));
  }
  M.SearchTree = {
    create: function (entries) {
      if (!entries.length) throw new Error('Need at least one value to build the search tree.');
      var n = M.getParameters(entries[0][0]).length;
      if (n !== 7) throw new Error('Expecting parameter space to be 7, got ' + n);
      return { first: createNode(n, entries.map(function (e) { return new Leaf(e[0], e[1]); })), prev: null,
        get: function (p, dist) { var r = result(this.first, M.noiseValueList(p), this.prev, dist || nodeDist); this.prev = r; return r.value; } };
    }
  };
  // Entries: [[hypercube, value], ...]. getLinear is method_39530 (the reference scan).
  M.Entries = function (entries) { this.entries = entries; this.tree = M.SearchTree.create(entries); };
  M.Entries.prototype.get = function (p) { return this.tree.get(p); };
  M.Entries.prototype.getLinear = function (p) {
    var best = M.getSquaredDistance(this.entries[0][0], p), v = this.entries[0][1];
    for (var i = 1; i < this.entries.length; i++) { var d = M.getSquaredDistance(this.entries[i][0], p); if (d < best) { best = d; v = this.entries[i][1]; } }
    return v;
  };
  // MultiNoiseSampler: six density functions ({sample(x,y,z)}) + spawn targets.
  M.MultiNoiseSampler = function (t, h, c, e, d, w, spawnTarget) { this.f = [t, h, c, e, d, w]; this.spawnTarget = spawnTarget || []; };
  M.MultiNoiseSampler.prototype.sample = function (qx, qy, qz) {
    var x = BC.toBlock(qx), y = BC.toBlock(qy), z = BC.toBlock(qz), f = this.f, v = [];
    for (var i = 0; i < 6; i++) v.push(f[i].sample(x, y, z));
    return M.createNoiseValuePoint(v[0], v[1], v[2], v[3], v[4], v[5]);
  };
  M.MultiNoiseSampler.prototype.findBestSpawnPosition = function () {
    return this.spawnTarget.length ? M.findFittestPosition(this.spawnTarget, this) : { x: 0, y: 0, z: 0 };
  };
  function fitness(list, sampler, x, z) {
    var s = Math.pow((x * x + z * z) / 6250000, 2), l = Math.trunc(Math.fround(10000 * 10000) * s);
    var p = sampler.sample(BC.fromBlock(x), 0, BC.fromBlock(z));
    var q = { temperatureNoise: p.temperatureNoise, humidityNoise: p.humidityNoise, continentalnessNoise: p.continentalnessNoise, erosionNoise: p.erosionNoise, depth: 0, weirdnessNoise: p.weirdnessNoise };
    var m = Infinity; list.forEach(function (h) { m = Math.min(m, M.getSquaredDistance(h, q)); });
    return { x: x, y: 0, z: z, fitness: l + m };
  }
  M.findFittestPosition = function (list, sampler) {
    var best = fitness(list, sampler, 0, 0);
    [[2048, 512], [512, 32]].forEach(function (pr) {
      var a = 0, r = Math.fround(pr[1]), max = pr[0], step = pr[1], loc = best;
      while (r <= max) {
        var x = loc.x + Math.trunc(Math.sin(a) * r), z = loc.z + Math.trunc(Math.cos(a) * r), c = fitness(list, sampler, x, z);
        if (c.fitness < best.fitness) best = c;
        a = Math.fround(a + Math.fround(step / r));
        if (a > Math.PI * 2) { a = 0; r += step; }
      }
    });
    return { x: best.x, y: best.y, z: best.z };
  };
})(MCL);
