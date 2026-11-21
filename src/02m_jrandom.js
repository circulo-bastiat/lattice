// NS.JRandom: java.util.Random (JDK 17), bit-identical. The 48-bit LCG state is two 24-bit halves so
// every product stays under 2^53 (no BigInt in the draw). docs/decisions/4986-lockstep-rng.md;
// tools/jrandomcheck.mjs compares it with the real JVM. nextGaussian is NS.U.polarGaussian (spare cached).
(function (NS) {
  'use strict';
  var ML = 0xECE66D, MH = 0x5DE, M24 = 16777216;
  function JRandom(seed) { this.setSeed(seed === undefined ? Date.now() * 1000 + Math.floor(Math.random() * 1000) : seed); }
  JRandom.prototype.setSeed = function (seed) {
    var s = (BigInt.asUintN(64, BigInt(seed)) ^ 0x5DEECE66Dn) & 0xFFFFFFFFFFFFn;
    this.sh = Number(s >> 24n); this.sl = Number(s & 0xFFFFFFn); this.haveG = false;
  };
  JRandom.prototype.next = function (bits) {
    var ol = this.sl, l = ol * ML + 0xB, c = Math.floor(l / M24);
    this.sl = l - c * M24;
    this.sh = (this.sh * ML + ol * MH + c) % M24;
    var v = Math.floor((this.sh * M24 + this.sl) / Math.pow(2, 48 - bits));
    return bits === 32 ? v | 0 : v;
  };
  JRandom.prototype.nextInt = function (bound) {
    if (bound === undefined) return this.next(32);
    if (!(bound > 0)) throw new RangeError('bound must be positive');
    var bits, val;
    if ((bound & -bound) === bound) return Math.floor(bound * this.next(31) / 2147483648);
    do { bits = this.next(31); val = bits % bound; } while (((bits - val + (bound - 1)) | 0) < 0);
    return val;
  };
  /** nextLong() as a BigInt (a Java long does not fit a double). */
  JRandom.prototype.nextLong = function () {
    var hi = this.next(32), lo = this.next(32);
    return BigInt.asIntN(64, (BigInt(hi) << 32n) + BigInt(lo));
  };
  JRandom.prototype.nextBoolean = function () { return this.next(1) !== 0; };
  JRandom.prototype.nextFloat = function () { return this.next(24) / 16777216; };
  JRandom.prototype.nextDouble = function () { return (this.next(26) * 134217728 + this.next(27)) * 1.1102230246251565e-16; };
  JRandom.prototype.nextGaussian = function () { return NS.U.polarGaussian(this, this.nextDouble); };
  NS.JRandom = JRandom;
  // shared fallback stream for rolls made with no entity random in hand (#6449): a JRandom, never Math.random
  var fb = null;
  NS.fbRand = function () { return (fb || (fb = new JRandom(0x6449n))).nextDouble(); };
  // world.random: the one java.util.Random stream for world-level rolls (explosion shuffle/fire, lightning, splash potions,
  // orb/cart/firework fallbacks). Entity-level rolls use the entity's own e.random. Never Math.random (G17-RNG5).
  var wrStream = null;
  NS.wrandReset = function () { wrStream = null; };   // #5377: lockstep lanes restart world.random per salt
  NS.wrand = function () {
    if (!wrStream) wrStream = new JRandom(BigInt.asIntN(64, ((NS.World && NS.World.seed64) || 0n) * 25214903917n + 11n));
    return wrStream.nextDouble();
  };
})(MCL);
