// 03b_noise.js — Mojang's 1.18.2 noise stack, ported. PLAN W2.
// Runs on: main thread AND workers. No DOM.
//
// ⚠ THIS IS THE ONE PART OF WORLDGEN THAT IS NOT ALLOWED TO BE CLEVER. The charter licenses
// MC-Lite to deviate on worldgen, and D-58's "middle path" takes that licence for the SHAPE of
// the terrain. It does not take it here. Every number a 1.18.2 world is built on comes out of
// these four classes, and being 1% off in any of them means every downstream table — the
// climate parameters, the spline points, the surface rule thresholds, all lifted verbatim from
// Mojang's own files — is being fed numbers it was not written for.
//
// So: exact port, four pieces, in the order they depend on each other.
//
//   1. XoroshiroRandomSource   Xoroshiro128++, with Mojang's 128-bit seed upgrade
//   2. MD5                     because `fromHashOf("octave_-10")` seeds every octave
//   3. ImprovedNoise           classic improved Perlin, 256-entry permutation
//   4. PerlinNoise             the octave stack, amplitudes from `worldgen/noise`
//   5. NormalNoise             two Perlin stacks, the second at 1.0181268882175227x
//
// ── WHERE THE ALGORITHM CAME FROM ────────────────────────────────────────────────────────
// The constants and the order of operations were cross-read against `misode/deepslate` (MIT),
// the community's reference reimplementation, and against the shape of the data in
// `worldgen/noise`. The CODE is MC-Lite's own — written in this project's style, with this
// project's numeric conventions — but the arithmetic is Mojang's and is not open to
// improvement. Where 1.18.2 differs from later versions (and `NormalNoise`'s normalisation
// does), the 1.18.2 form is the one implemented, and the difference is called out.
//
// ── WHY BIGINT IS ACCEPTABLE HERE ────────────────────────────────────────────────────────
// The RNG is 64-bit and JavaScript's numbers are not, so the seeding path uses BigInt. That
// would be unacceptable in a per-sample loop and is fine here: seeding happens ONCE per noise
// per thread — 60 noises, two Perlin stacks each, a handful of octaves apiece — and every
// sample afterwards is plain double arithmetic with no BigInt anywhere near it.
//
(function (NS) {
  'use strict';

  var N = NS.Noise = {};

  // ═══════════════════════════════════════════════════════════════════ 1. Xoroshiro128++
  //
  // Mojang's `XoroshiroRandomSource`. Two 64-bit words, `next()` returning
  // `rotl(lo + hi, 17) + lo` — the "++" scrambler — and a seed upgrade that runs the 64-bit
  // seed through Stafford variant 13 twice to fill 128 bits.
  //
  // ⚠ 1.18.2's overworld sets `legacy_random_source: false`, so this is THE random source for
  // worldgen. The old `LegacyRandomSource` (java.util.Random) is still used by three `Biome`
  // statics that never migrated to Xoroshiro, and W5 implemented it: `N.LegacyRandom`, further
  // down this same file, with `N.SimplexNoise` on top of it (D-118).

  var MASK64 = (1n << 64n) - 1n;
  var SILVER = 7640891576956012809n;
  var GOLDEN = BigInt.asUintN(64, -7046029254386353131n);
  var STAFFORD1 = BigInt.asUintN(64, -4658895280553007687n);
  var STAFFORD2 = BigInt.asUintN(64, -7723592293110705685n);

  function rotl(v, k) { return ((v << k) | (v >> (64n - k))) & MASK64; }

  function mixStafford13(v) {
    v = ((v ^ (v >> 30n)) * STAFFORD1) & MASK64;
    v = ((v ^ (v >> 27n)) * STAFFORD2) & MASK64;
    return (v ^ (v >> 31n)) & MASK64;
  }

  /** Mojang's `RandomSupport.upgradeSeedTo128bit`. */
  function upgradeSeed(seed) {
    var lo = BigInt.asUintN(64, seed) ^ SILVER;
    var hi = (lo + GOLDEN) & MASK64;
    return [mixStafford13(lo), mixStafford13(hi)];
  }
  N.upgradeSeed = upgradeSeed;

  /** A Xoroshiro128++ source. `lo`/`hi` are BigInt. */
  function Xoro(lo, hi) { this.lo = lo & MASK64; this.hi = hi & MASK64; }
  N.Xoro = Xoro;

  Xoro.fromSeed = function (seed) {
    var s = upgradeSeed(typeof seed === 'bigint' ? seed : BigInt(seed | 0));
    return new Xoro(s[0], s[1]);
  };

  Xoro.prototype.next = function () {
    var lo = this.lo, hi = this.hi;
    var v = (rotl((lo + hi) & MASK64, 17n) + lo) & MASK64;
    hi ^= lo;
    this.lo = rotl(lo, 49n) ^ hi ^ ((hi << 21n) & MASK64);
    this.hi = rotl(hi, 28n);
    return v;
  };

  /** The top `bits` bits of the next value, as a BigInt. */
  Xoro.prototype.nextBits = function (bits) { return this.next() >> BigInt(64 - bits); };

  /** 53 bits scaled to [0,1). The multiplier is Mojang's, and it is 2^-53 written out. */
  var DOUBLE_MUL = 1.1102230246251565e-16;
  Xoro.prototype.nextDouble = function () { return Number(this.nextBits(53)) * DOUBLE_MUL; };
  /** Java's `nextFloat`: 24 bits, not 53. `vertical_gradient` compares against one. */
  Xoro.prototype.nextFloat = function () { return Number(this.nextBits(24)) * 5.9604644775390625e-8; };
  /** Mojang's `nextIntBetweenInclusive`. The clay bands are built out of it. */
  Xoro.prototype.nextIntBetweenInclusive = function (lo, hi) { return lo + this.nextInt(hi - lo + 1); };

  /**
   * nextInt(max) — Mojang's bounded draw, which is Lemire's multiply-shift with a rejection
   * loop, NOT a modulo. The loop is why the permutation shuffle below cannot be replaced with
   * anything simpler: getting the rejection wrong changes the permutation and therefore every
   * noise value in the game, while still producing a perfectly plausible-looking world.
   */
  Xoro.prototype.nextInt = function (max) {
    if (max === undefined) {
      var raw = Number(this.next() & 0xFFFFFFFFn);
      return raw >= 0x80000000 ? raw - 0x100000000 : raw;
    }
    var m = BigInt(max);
    var v = this.next() & 0xFFFFFFFFn;
    var product = v * m;
    var productLo = product & 0xFFFFFFFFn;
    if (productLo < m) {
      var threshold = ((~m & 0xFFFFFFFFn) + 1n) % m;
      while (productLo < threshold) {
        v = this.next() & 0xFFFFFFFFn;
        product = v * m;
        productLo = product & 0xFFFFFFFFn;
      }
    }
    return Number(product >> 32n);
  };

  /** Advance without producing output — the legacy octave path skips 262 draws per level. */
  Xoro.prototype.consume = function (n) { for (var i = 0; i < n; i++) this.next(); };

  /**
   * forkPositional() -> a factory that makes independent sources from a name or a position.
   * This is how one world seed becomes sixty independent noise fields without any of them
   * correlating: each takes its own 128 bits from an MD5 of its own name.
   */
  Xoro.prototype.forkPositional = function () {
    return new XoroFactory(this.next(), this.next());
  };

  function XoroFactory(lo, hi) { this.lo = lo; this.hi = hi; }
  N.XoroFactory = XoroFactory;

  XoroFactory.prototype.fromHashOf = function (name) {
    var h = N.md5Longs(name);
    return new Xoro(h[0] ^ this.lo, h[1] ^ this.hi);
  };

  /**
   * Mojang's `Mth.getSeed` — the per-position seed features and carvers use.
   *
   * ⚠ **THE FIRST MULTIPLICATION IS A 32-BIT ONE AND WRAPS** (D-229). The Java is
   *
   *      long l = (long)(x * 3129871) ^ (long)z * 116129781L ^ (long)y;
   *
   * and `x * 3129871` is `int * int`, computed in 32 bits and only THEN widened, while
   * `(long)z * 116129781L` is a 64-bit multiply. Doing both in 64 bits agrees with the game
   * for |x| <= 686 — every coordinate a test written at the origin ever tries — and disagrees
   * from 687 outwards. `04h_surface.js` reads it twice, through `XoroFactory.at`: the
   * `vertical_gradient` coin flip and the surface-depth jitter. Measured at x ~ 10,000, the old
   * arithmetic flipped 33.5% of the blocks in a gradient band and 8.2% of surface depths, and
   * nothing could see it, because a wrong random is still a random with the right distribution.
   * Caught by the golden vector, not by re-reading this.
   */
  N.positionSeed = function (x, y, z) {
    var xm = BigInt.asIntN(32, BigInt(x) * 3129871n);           // int arithmetic, then widened
    var l = xm ^ BigInt.asIntN(64, BigInt(z) * 116129781n) ^ BigInt(y);
    l = BigInt.asIntN(64, l);
    l = BigInt.asIntN(64, BigInt.asIntN(64, l * l * 42317861n) + BigInt.asIntN(64, l * 11n));
    return BigInt.asIntN(64, l >> 16n);
  };

  XoroFactory.prototype.at = function (x, y, z) {
    return new Xoro(BigInt.asUintN(64, N.positionSeed(x, y, z)) ^ this.lo, this.hi);
  };

  // ═══════════════════════════════════════════════════════════════════ 2. MD5
  //
  // Needed for exactly one thing: `fromHashOf("octave_-10")`. Sixty noises times a handful of
  // octaves times two Perlin stacks is a few hundred digests, once, at init. A compact
  // implementation is the right size for that; a fast one would be a waste.
  //
  // ⚠ Mojang reads the digest as TWO BIG-ENDIAN LONGS — bytes 0..7 and 8..15 — while MD5's own
  // output is little-endian words. Getting that boundary wrong gives a working, deterministic,
  // completely different world.

  var MD5_K = new Int32Array(64);
  var MD5_S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
               5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
               4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
               6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
  (function () {
    for (var i = 0; i < 64; i++) MD5_K[i] = (Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296)) | 0;
  })();

  /** md5(bytes) -> Uint8Array(16). ASCII input only, which is all a noise name ever is. */
  N.md5 = function (str) {
    var i, n = str.length;
    var withOne = n + 1;
    var blocks = Math.ceil((withOne + 8) / 64);
    var buf = new Uint8Array(blocks * 64);
    for (i = 0; i < n; i++) buf[i] = str.charCodeAt(i) & 0xFF;
    buf[n] = 0x80;
    var bitLen = n * 8;
    // length is little-endian, 64-bit; a name is never long enough to need the high word
    buf[blocks * 64 - 8] = bitLen & 0xFF;
    buf[blocks * 64 - 7] = (bitLen >>> 8) & 0xFF;
    buf[blocks * 64 - 6] = (bitLen >>> 16) & 0xFF;
    buf[blocks * 64 - 5] = (bitLen >>> 24) & 0xFF;

    var a0 = 0x67452301 | 0, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476 | 0;
    var M = new Int32Array(16);
    for (var b = 0; b < blocks; b++) {
      var o = b * 64;
      for (i = 0; i < 16; i++) {
        M[i] = (buf[o + i * 4]) | (buf[o + i * 4 + 1] << 8) | (buf[o + i * 4 + 2] << 16) | (buf[o + i * 4 + 3] << 24);
      }
      var A = a0, B = b0, C = c0, D = d0;
      for (i = 0; i < 64; i++) {
        var F, g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; }
        else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) & 15; }
        else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) & 15; }
        else { F = C ^ (B | ~D); g = (7 * i) & 15; }
        F = (F + A + MD5_K[i] + M[g]) | 0;
        A = D; D = C; C = B;
        var s = MD5_S[i];
        B = (B + ((F << s) | (F >>> (32 - s)))) | 0;
      }
      a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
    }
    var out = new Uint8Array(16);
    var words = [a0, b0, c0, d0];
    for (i = 0; i < 4; i++) {
      out[i * 4] = words[i] & 0xFF;
      out[i * 4 + 1] = (words[i] >>> 8) & 0xFF;
      out[i * 4 + 2] = (words[i] >>> 16) & 0xFF;
      out[i * 4 + 3] = (words[i] >>> 24) & 0xFF;
    }
    return out;
  };

  /** The digest as Mojang reads it: two BIG-ENDIAN 64-bit words. */
  N.md5Longs = function (name) {
    var h = N.md5(name), lo = 0n, hi = 0n;
    for (var i = 0; i < 8; i++) lo = (lo << 8n) | BigInt(h[i]);
    for (i = 8; i < 16; i++) hi = (hi << 8n) | BigInt(h[i]);
    return [lo, hi];
  };

  // ═══════════════════════════════════════════════════════════════════ 3. ImprovedNoise
  //
  // Ken Perlin's improved noise, with Mojang's 16-entry gradient table and a random origin
  // offset per instance. The gradient table's last four entries repeat earlier ones — that is
  // not a mistake in this file, it is what makes a 4-bit hash index a valid lookup.

  var GRAD = new Int8Array([
    1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
    1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
    0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
    1, 1, 0, 0, -1, 1, -1, 1, 0, 0, -1, -1,
  ]);
  N.GRAD = GRAD;

  function gradDot(hash, x, y, z) {
    var o = (hash & 15) * 3;
    return GRAD[o] * x + GRAD[o + 1] * y + GRAD[o + 2] * z;
  }
  N.gradDot = gradDot;

  var smooth = function (t) { return t * t * t * (t * (t * 6 - 15) + 10); };
  var lerp = function (t, a, b) { return a + t * (b - a); };
  N.smooth = smooth;

  /** ImprovedNoise(random) — consumes 3 doubles and 256 bounded ints, in that order. */
  function Improved(rnd) {
    this.xo = rnd.nextDouble() * 256;
    this.yo = rnd.nextDouble() * 256;
    this.zo = rnd.nextDouble() * 256;
    var p = this.p = new Uint8Array(256);
    var i;
    for (i = 0; i < 256; i++) p[i] = i;
    for (i = 0; i < 256; i++) {
      var j = rnd.nextInt(256 - i);
      var t = p[i];
      p[i] = p[i + j];
      p[i + j] = t;
    }
  }
  N.Improved = Improved;

  Improved.prototype.perm = function (i) { return this.p[i & 255] & 255; };

  Improved.prototype.noise = function (x, y, z) {
    var d = x + this.xo, e = y + this.yo, f = z + this.zo;
    var i = Math.floor(d), j = Math.floor(e), k = Math.floor(f);
    var gx = d - i, gy = e - j, gz = f - k;

    var x0 = this.perm(i), x1 = this.perm(i + 1);
    var xy00 = this.perm(x0 + j), xy01 = this.perm(x0 + j + 1);
    var xy10 = this.perm(x1 + j), xy11 = this.perm(x1 + j + 1);

    var d000 = gradDot(this.perm(xy00 + k), gx, gy, gz);
    var d100 = gradDot(this.perm(xy10 + k), gx - 1, gy, gz);
    var d010 = gradDot(this.perm(xy01 + k), gx, gy - 1, gz);
    var d110 = gradDot(this.perm(xy11 + k), gx - 1, gy - 1, gz);
    var d001 = gradDot(this.perm(xy00 + k + 1), gx, gy, gz - 1);
    var d101 = gradDot(this.perm(xy10 + k + 1), gx - 1, gy, gz - 1);
    var d011 = gradDot(this.perm(xy01 + k + 1), gx, gy - 1, gz - 1);
    var d111 = gradDot(this.perm(xy11 + k + 1), gx - 1, gy - 1, gz - 1);

    var u = smooth(gx), v = smooth(gy), w = smooth(gz);
    var a = lerp(u, d000, d100), b = lerp(u, d010, d110);
    var c = lerp(u, d001, d101), e2 = lerp(u, d011, d111);
    return lerp(w, lerp(v, a, b), lerp(v, c, e2));
  };

  // ═══════════════════════════════════════════════════════════════════ 4. PerlinNoise
  //
  // The octave stack. `firstOctave` is negative for the big features — temperature's is −10,
  // so its lowest frequency is 2^-10 and one period spans a thousand blocks.
  //
  // ⚠ An amplitude of 0 does not mean "an octave that contributes nothing". It means the octave
  // is NOT CREATED AT ALL, so it draws no randomness, so every octave after it gets different
  // numbers than it would have. `temperature`'s amplitudes are [1.5, 0, 1, 0, 0, 0]: four of its
  // six octaves do not exist. Creating them and multiplying by zero produces a different world.

  var WRAP = 3.3554432e7;
  function wrap(x) { return x - Math.floor(x / WRAP + 0.5) * WRAP; }
  N.wrap = wrap;

  /**
   * Perlin(random, firstOctave, amplitudes) — the non-legacy constructor, which is what
   * 1.18.2's overworld uses (`legacy_random_source: false`).
   *
   * ⚠ The octave's name is `"octave_" + (firstOctave + k)`, NOT `"octave_" + k`. It is the
   * absolute octave index, which is why temperature's first octave is seeded from
   * `octave_-10`.
   */
  function Perlin(rnd, firstOctave, amplitudes) {
    var n = amplitudes.length;
    this.amps = amplitudes.slice();
    this.levels = new Array(n);
    var f = rnd.forkPositional();
    for (var k = 0; k < n; k++) {
      this.levels[k] = amplitudes[k] === 0 ? null : new Improved(f.fromHashOf('octave_' + (firstOctave + k)));
    }
    this.inputFactor = Math.pow(2, firstOctave);
    this.valueFactor = Math.pow(2, n - 1) / (Math.pow(2, n) - 1);
  }
  N.Perlin = Perlin;

  Perlin.prototype.get = function (x, y, z) {
    var v = 0, inF = this.inputFactor, vF = this.valueFactor;
    for (var i = 0; i < this.levels.length; i++) {
      var lvl = this.levels[i];
      if (lvl) v += this.amps[i] * lvl.noise(wrap(x * inF), wrap(y * inF), wrap(z * inF)) * vF;
      inF *= 2;
      vF /= 2;
    }
    return v;
  };

  /**
   * Mojang's `PerlinNoise.edgeValue(d)`: the value the stack reaches if every octave that
   * EXISTS returns `d` at once. Octaves with a zero amplitude were never created and are
   * skipped, which is why this is not simply `sum(amp) * d * valueFactor`.
   */
  Perlin.prototype.edgeValue = function (d) {
    var v = 0, vF = this.valueFactor;
    for (var i = 0; i < this.levels.length; i++) {
      if (this.levels[i]) v += this.amps[i] * d * vF;
      vF /= 2;
    }
    return v;
  };

  /**
   * `PerlinNoise.maxValue()` — vanilla's, which is `edgeValue(2.0)`.
   *
   * ⚠ **IT IS `edgeValue(2)`, NOT `edgeValue(1)`** (D-229). Mojang's bound allows each octave
   * ±2 rather than ±1; the golden vector caught this file returning exactly half of vanilla's
   * number for all twelve sampled noises. The tighter bound is still worth having and is still
   * true of the field, so it kept its own name — see `Normal.analyticBound` below.
   */
  Perlin.prototype.maxValue = function () { return this.edgeValue(2); };

  // ═══════════════════════════════════════════════════════════════════ 5. NormalNoise
  //
  // Two independent Perlin stacks with the same parameters, the second sampled at
  // 1.0181268882175227x the coordinate — an irrational-ish ratio that keeps the two from ever
  // lining up — summed and scaled so that every one of the sixty noises comes out with roughly
  // the same spread. That last part is the whole point of the class: the spline tables and
  // climate parameters downstream are written against a NORMALISED field, so a noise whose
  // deviation is off by 20% puts every threshold in the wrong place.
  //
  // ⚠ 1.18.2's normalisation is
  //
  //      valueFactor = (1/6) / (0.1 * (1 + 1/(lastNonZero - firstNonZero + 1)))
  //
  // Later versions replaced this with a variance-based computation using the measured Perlin
  // standard deviation 0.2702247831245211. **That formula is not this one** and using it here
  // would move every threshold in every spline. The version target is 1.18.2 (D-2).

  var INPUT_FACTOR = 1.0181268882175227;
  N.INPUT_FACTOR = INPUT_FACTOR;

  function expectedDeviation(octaves) { return 0.1 * (1 + 1 / (octaves + 1)); }
  N.expectedDeviation = expectedDeviation;

  /** Normal(random, firstOctave, amplitudes) */
  function Normal(rnd, firstOctave, amplitudes) {
    this.first = new Perlin(rnd, firstOctave, amplitudes);
    this.second = new Perlin(rnd, firstOctave, amplitudes);
    var min = Infinity, max = -Infinity;
    for (var i = 0; i < amplitudes.length; i++) {
      if (amplitudes[i] !== 0) { if (i < min) min = i; if (i > max) max = i; }
    }
    this.valueFactor = (1 / 6) / expectedDeviation(max - min);
    this.firstOctave = firstOctave;
    this.amplitudes = amplitudes.slice();
  }
  N.Normal = Normal;

  Normal.prototype.get = function (x, y, z) {
    return (this.first.get(x, y, z) +
            this.second.get(x * INPUT_FACTOR, y * INPUT_FACTOR, z * INPUT_FACTOR)) * this.valueFactor;
  };

  /** `NormalNoise.maxValue()` — vanilla's, exactly: both stacks at their `edgeValue(2)`. */
  Normal.prototype.maxValue = function () {
    return (this.first.maxValue() + this.second.maxValue()) * this.valueFactor;
  };

  /**
   * The TIGHT analytic bound on |get()|, which is vanilla's `maxValue()` halved: an
   * improved-Perlin octave's own extreme is 1, not 2, so nothing this noise produces may
   * exceed this. `noisecheck` §3 measures against it precisely because it is tight enough to
   * notice a missing octave, which vanilla's own looser bound is not. It is MC-Lite's, it is
   * not vanilla's, and the two are named apart so that neither can be mistaken for the other.
   */
  Normal.prototype.analyticBound = function () {
    return (this.first.edgeValue(1) + this.second.edgeValue(1)) * this.valueFactor;
  };

  /**
   * fromParameters(worldSeed, name) -> Normal, seeded exactly the way vanilla seeds it:
   * a Xoroshiro source on the world seed, forked positionally, hashed on the noise's own id.
   *
   * ⚠ The hash is of the FULL id — `minecraft:temperature` — not the short name. Mojang builds
   * it from the registry key.
   */
  N.fromParameters = function (worldSeed, id, params) {
    var rnd = Xoro.fromSeed(worldSeed).forkPositional()
      .fromHashOf(id.indexOf(':') < 0 ? 'minecraft:' + id : id);
    return new Normal(rnd, params.firstOctave, params.amplitudes);
  };

  // ── the LEGACY random source, and simplex noise (D-118) ─────────────────────────────────
  //
  // ⚠ These are a SECOND, older stack, and it is not an oversight that they sit next to the
  // Xoroshiro one above. 1.18 moved worldgen onto Xoroshiro but a handful of things Mojang
  // never migrated still run on `LegacyRandomSource` — plain `java.util.Random` — and on
  // `SimplexNoise` rather than the improved Perlin above. W5 needs exactly one of them:
  // `Biome.BIOME_INFO_NOISE`, a `PerlinSimplexNoise` seeded from `LegacyRandomSource(2345)`,
  // which is what decides whether a patch of swamp grass is the murky green or the sickly one.
  // A world that generated that from the wrong random would be wrong in a way nobody could see
  // without a reference, so the reference is `biomecheck`.
  //
  // java.util.Random, exactly: a 48-bit LCG with the multiplier and addend from the JDK, and
  // the same seed scramble. BigInt, because it runs a few hundred times at init and never
  // again — the permutation table it fills is the only thing anything asks for afterwards.
  var JR_MUL = 0x5DEECE66Dn, JR_ADD = 0xBn, JR_MASK = (1n << 48n) - 1n;

  function LegacyRandom(seed) { this.seed = (BigInt(seed) ^ JR_MUL) & JR_MASK; }
  N.LegacyRandom = LegacyRandom;

  LegacyRandom.prototype.next = function (bits) {
    this.seed = (this.seed * JR_MUL + JR_ADD) & JR_MASK;
    // Java's `(int)(seed >>> (48 - bits))`, i.e. a SIGNED 32-bit result for bits = 32.
    var v = Number(this.seed >> BigInt(48 - bits));
    return bits === 32 ? (v | 0) : v;
  };

  LegacyRandom.prototype.nextInt = function (bound) {
    if (bound === undefined) return this.next(32);
    // Java's power-of-two fast path is not an optimisation here — it produces DIFFERENT
    // numbers from the rejection loop, so both are needed to match.
    if ((bound & -bound) === bound) return Number((BigInt(bound) * BigInt(this.next(31))) >> 31n);
    // ⚠ **THE REJECTION TEST IS AN INT OVERFLOW AND MUST BE COMPUTED IN 32 BITS** (D-235).
    // java.util.Random rejects a draw with `bits - val + (bound - 1) < 0`, and that sum is only
    // ever negative BECAUSE it overflows a Java int: `bits` is 31 bits, so the sum reaches
    // 2^31 + bound - 2 and wraps. In JavaScript it is a double, it never goes negative, and the
    // loop therefore never rejects — the same class of bug as D-229's `Mth.getSeed`, one line
    // further down the same file. `| 0` is the whole fix; it is Java's int, written out.
    // NOTHING SHIPS WRONG TODAY, and that is measured rather than hoped: the only caller is
    // the `PerlinSimplex` shuffle, its three sources are the FIXED seeds 1234/2345/3456, and
    // their 1,280 bounded draws consume exactly 1,280 LCG steps — no draw lands in the window.
    // It is latent, not harmless. The window is (2^31 mod bound) wide, so a source seeded from
    // the WORLD seed — which is what vanilla's mineshafts, strongholds and legacy carvers use,
    // and what Track G will need — enters it about once every 27,500 worlds, and from there on
    // that world disagrees with vanilla. Fenced by value in `noisecheck` §6, at seeds the
    // golden dump CONSTRUCTS to land in the window and whose draw count it measures.
    var bits, val;
    do { bits = this.next(31); val = bits % bound; } while (((bits - val + (bound - 1)) | 0) < 0);
    return val;
  };

  /** Java's `nextLong`: `((long)next(32) << 32) + next(32)`, wrapped to 64 bits. */
  LegacyRandom.prototype.nextLong = function () {
    var hi = BigInt(this.next(32)), lo = BigInt(this.next(32));
    return BigInt.asIntN(64, (hi << 32n) + lo);
  };

  LegacyRandom.prototype.nextDouble = function () {
    return (this.next(26) * 134217728 + this.next(27)) / 9007199254740992;   // (1<<27), (1<<53)
  };
  /**
   * Java's `nextFloat` — TWENTY-FOUR bits, not 53. G16's star field draws four of these per
   * candidate star and one `nextDouble`, in that order, so a float that took the wrong number
   * of LCG steps would put every star in a different place from vanilla's.
   */
  LegacyRandom.prototype.nextFloat = function () { return this.next(24) / 16777216; };

  /**
   * Mojang's `SimplexNoise`. 2D only here, because the only caller is 2D and the 3D entry
   * point would be untested code shipped in a 15 MB budget.
   */
  var SIMPLEX_GRAD = [
    [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
    [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1], [1, 1, 0], [0, -1, 1], [-1, 1, 0], [0, -1, -1],
  ];
  var SQRT3 = Math.sqrt(3);
  var F2 = 0.5 * (SQRT3 - 1);
  var G2 = (3 - SQRT3) / 6;

  function Simplex(rnd) {
    this.xo = rnd.nextDouble() * 256;
    this.yo = rnd.nextDouble() * 256;
    this.zo = rnd.nextDouble() * 256;
    var p = this.p = new Int32Array(512), i;
    for (i = 0; i < 256; i++) p[i] = i;
    // ⚠ Mojang's shuffle reads `p[i + j]` where j is drawn from `256 - i`, so the swap partner
    // is at i + j and NOT at j. Using j alone gives a valid-looking permutation of the same
    // 256 values and a completely different noise field.
    for (i = 0; i < 256; i++) {
      var j = rnd.nextInt(256 - i);
      var k = p[i];
      p[i] = p[i + j];
      p[i + j] = k;
    }
    for (i = 0; i < 256; i++) p[i + 256] = p[i];
  }
  N.Simplex = Simplex;

  Simplex.prototype.pp = function (i) { return this.p[i & 255]; };

  function corner2D(g, x, y, offset) {
    var d = offset - x * x - y * y;
    if (d < 0) return 0;
    d *= d;
    return d * d * (g[0] * x + g[1] * y);
  }

  // Mojang's `j > 0` branch seeds the low octaves from `simplexNoise.getValue(xo, yo, zo)` —
  // the THREE-argument form. No octave list this project uses reaches that branch (both have
  // j <= 0), so rather than ship an untested 3D simplex, `get2` throws if anything ever does.
  Simplex.prototype.get2 = function () {
    throw new Error('PerlinSimplex: the 3D-seeded low-octave branch is not ported (no caller reaches it)');
  };

  Simplex.prototype.get = function (x, y) {
    var d = (x + y) * F2;
    var i = Math.floor(x + d), j = Math.floor(y + d);
    var e = (i + j) * G2;
    var h = x - (i - e), m = y - (j - e);
    var n, o;
    if (h > m) { n = 1; o = 0; } else { n = 0; o = 1; }
    var p1 = h - n + G2, q1 = m - o + G2;
    var r = h - 1 + 2 * G2, s = m - 1 + 2 * G2;
    var t = i & 255, u = j & 255;
    var v = this.pp(t + this.pp(u)) % 12;
    var w = this.pp(t + n + this.pp(u + o)) % 12;
    var z = this.pp(t + 1 + this.pp(u + 1)) % 12;
    return 70 * (corner2D(SIMPLEX_GRAD[v], h, m, 0.5) +
                 corner2D(SIMPLEX_GRAD[w], p1, q1, 0.5) +
                 corner2D(SIMPLEX_GRAD[z], r, s, 0.5));
  };

  LegacyRandom.prototype.consume = function (n) { for (var i = 0; i < n; i++) this.nextInt(); };

  /**
   * Mojang's `PerlinSimplexNoise`. `octaves` is a list of ints, deduplicated and sorted
   * ascending the way `IntRBTreeSet` does it.
   *
   * ⚠ The first `SimplexNoise` is constructed BEFORE the loop whether or not it is used, so it
   * advances the random source either way. A list whose last octave is 0 — `[-2, -1, 0]`, the
   * frozen-ocean temperature noise — KEEPS it as level `j`; a list that does not contain 0
   * constructs it and throws it away, and either way a port that skips the construction because
   * the value looks unused seeds every remaining octave from the wrong place.
   */
  function PerlinSimplex(rnd, octaves) {
    var set = [];
    for (var q = 0; q < octaves.length; q++) if (set.indexOf(octaves[q]) < 0) set.push(octaves[q]);
    set.sort(function (a, b) { return a - b; });
    if (!set.length) throw new Error('PerlinSimplex needs at least one octave');
    var first = set[0], last = set[set.length - 1];
    var i = -first, j = last, k = i + j + 1;
    if (k < 1) throw new Error('PerlinSimplex: no levels');
    var has = function (v) { return set.indexOf(v) >= 0; };
    var levels = new Array(k);
    var firstNoise = new Simplex(rnd);          // constructed unconditionally — see above
    var m;
    if (j >= 0 && j < k && has(0)) levels[j] = firstNoise;
    for (m = j + 1; m < k; m++) {
      if (m >= 0 && has(j - m)) levels[m] = new Simplex(rnd);
      else rnd.consume(262);
    }
    if (j > 0) {
      var n = BigInt(Math.trunc(firstNoise.get2(firstNoise.xo, firstNoise.yo) * 9.223372036854776e18));
      var r2 = new LegacyRandom(BigInt.asIntN(64, n));
      for (var o = j - 1; o >= 0; o--) {
        if (o < k && has(j - o)) levels[o] = new Simplex(r2);
        else r2.consume(262);
      }
    }
    this.levels = levels;
    this.inputFactor = Math.pow(2, j);
    this.valueFactor = 1 / (Math.pow(2, k) - 1);
  }
  N.PerlinSimplex = PerlinSimplex;

  PerlinSimplex.prototype.get = function (x, y, useOffsets) {
    var d = 0, e = this.inputFactor, f = this.valueFactor;
    for (var i = 0; i < this.levels.length; i++) {
      var lv = this.levels[i];
      if (lv) d += lv.get(x * e + (useOffsets ? lv.xo : 0), y * e + (useOffsets ? lv.yo : 0)) * f;
      e /= 2; f *= 2;
    }
    return d;
  };

  // The three fixed-seed noises `Biome` keeps as statics. Their seeds are constants in the Java
  // and they do NOT depend on the world seed — every world's swamps are murky in the same
  // places relative to the origin, which is vanilla behaviour and looks like a bug if you fix it.
  N.BIOME_INFO_SEED = 2345;
  N.TEMPERATURE_SEED = 1234;
  N.FROZEN_TEMPERATURE_SEED = 3456;
  /** `Biome.BIOME_INFO_NOISE` — the swamp grass tint and part of the frozen-ocean modifier. */
  N.biomeInfoNoise = function () { return new PerlinSimplex(new LegacyRandom(N.BIOME_INFO_SEED), [0]); };
  /** `Biome.TEMPERATURE_NOISE` — the wobble in the height-adjusted temperature above y = 80. */
  N.temperatureNoise = function () { return new PerlinSimplex(new LegacyRandom(N.TEMPERATURE_SEED), [0]); };
  /**
   * `Biome.FROZEN_TEMPERATURE_NOISE` — three octaves, and the reason the first Simplex above
   * matters, because this is the one list in the game whose last octave is 0.
   *
   * ⚠ **D-219: the list is `[-2, -1, 0]`, and it was `[-3, -2, -1]` here until session 6.** It is
   * read off `Biome.<clinit>` in the 1.18.2 jar — `ImmutableList.of(-2, -1, 0)` — and not from
   * memory. The wrong list was wrong twice over: `inputFactor` is `2^lastOctave`, so every octave
   * was sampled at HALF the right frequency, and because the set did not contain 0 the
   * unconditionally-constructed first Simplex was discarded, so all three levels came off the
   * wrong draws of the legacy random as well. It made MC-Lite freeze 80% of a frozen ocean where
   * the real 1.18.2 world freezes 47%.
   */
  N.frozenTemperatureNoise = function () { return new PerlinSimplex(new LegacyRandom(N.FROZEN_TEMPERATURE_SEED), [-2, -1, 0]); };

  /**
   * all(worldSeed) -> { name: Normal } for every entry in `worldgen/noise`.
   * Built once per thread. Sixty noises, about 300 Perlin octaves, a few hundred MD5 digests.
   */
  N.all = function (worldSeed) {
    if (!NS.WG || !NS.WG.ready) return null;
    var out = Object.create(null);
    var names = NS.WG.names('noise');
    for (var i = 0; i < names.length; i++) {
      out[names[i]] = N.fromParameters(worldSeed, names[i], NS.WG.get('noise', names[i]));
    }
    return out;
  };
})(MCL);
