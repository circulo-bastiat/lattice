// 01_util.js — math, RNG, hashing, noise primitives, small containers, profiler.
// Runs on: main thread AND workers. No DOM.

(function (NS) {
  'use strict';

  var U = NS.U = {};

  // --- scalar ---------------------------------------------------------------
  U.clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
  U.lerp  = function (a, b, t) { return a + (b - a) * t; };
  U.smooth = function (t) { return t * t * t * (t * (t * 6 - 15) + 10); };  // quintic, Perlin fade
  U.floor = Math.floor;

  /** Piecewise-linear spline over sorted xs. The whole "middle path" worldgen rests on this (D-30). */
  U.spline = function (xs, ys) {
    return function (x) {
      if (x <= xs[0]) return ys[0];
      var n = xs.length;
      if (x >= xs[n - 1]) return ys[n - 1];
      var i = 1;
      while (i < n && xs[i] < x) i++;
      var t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
      return ys[i - 1] + (ys[i] - ys[i - 1]) * t;
    };
  };

  // --- hashing / RNG --------------------------------------------------------
  /** splitmix32: fast, decent, seedable. Returns a function producing [0,1). */
  U.rng = function (seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x9E3779B9) >>> 0;
      var z = s;
      z = Math.imul(z ^ (z >>> 16), 0x21F0AAAD) >>> 0;
      z = Math.imul(z ^ (z >>> 15), 0x735A2D97) >>> 0;
      return ((z ^ (z >>> 15)) >>> 0) / 4294967296;
    };
  };

  /** Integer hash of (x,y,z,seed) -> uint32. Used for scatter decoration, not for noise. */
  U.hash3 = function (x, y, z, seed) {
    var h = seed >>> 0;
    h = Math.imul(h ^ (x | 0), 0x9E3779B1) >>> 0;
    h = Math.imul(h ^ (y | 0), 0x85EBCA77) >>> 0;
    h = Math.imul(h ^ (z | 0), 0xC2B2AE3D) >>> 0;
    h ^= h >>> 15;
    return h >>> 0;
  };

  // --- gradient noise (D-30) ------------------------------------------------
  /**
   * Seeded 512-entry permutation table. Shared by all noise fields; each field offsets its
   * coordinates instead of building its own table, which keeps the table hot in L1.
   */
  U.makePerm = function (seed) {
    var p = new Uint8Array(256), i;
    for (i = 0; i < 256; i++) p[i] = i;
    var r = U.rng(seed);
    for (i = 255; i > 0; i--) {
      var j = (r() * (i + 1)) | 0, t = p[i]; p[i] = p[j]; p[j] = t;
    }
    var perm = new Uint8Array(512);
    for (i = 0; i < 512; i++) perm[i] = p[i & 255];
    return perm;
  };

  /**
   * Classic Perlin gradient noise. Two reasons this and not simplex:
   *  - the gradient set is 8 (2D) / 12 (3D) fixed directions, so the inner loop is adds and
   *    negations, no table lookups into a float array and no simplex corner skew;
   *  - the lattice is axis-aligned, which is what the spline shaping wants (D-30).
   * Range is about [-1,1]; the practical 1-octave extremes measured by tools/gencheck.mjs are
   * +/-0.94, and every consumer clamps.
   */
  function grad2(h, x, y) {
    switch (h & 7) {
      case 0:  return  x + y;
      case 1:  return  x - y;
      case 2:  return -x + y;
      case 3:  return -x - y;
      case 4:  return  x;
      case 5:  return -x;
      case 6:  return  y;
      default: return -y;
    }
  }

  function grad3(h, x, y, z) {
    switch (h & 15) {
      case 0: case 12: return  x + y;
      case 1: case 13: return -x + y;
      case 2:          return  x - y;
      case 3:          return -x - y;
      case 4:          return  x + z;
      case 5:          return -x + z;
      case 6:          return  x - z;
      case 7:          return -x - z;
      case 8:          return  y + z;
      case 9: case 14: return -y + z;
      case 10:         return  y - z;
      default:         return -y - z;
    }
  }

  /** 2D Perlin. perm is a 512-entry table from makePerm. */
  U.noise2 = function (perm, x, y) {
    var fx = Math.floor(x), fy = Math.floor(y);
    var X = fx & 255, Y = fy & 255;
    var xf = x - fx, yf = y - fy;
    var u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    var v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    var A = perm[X] + Y, B = perm[X + 1] + Y;
    var n00 = grad2(perm[A],     xf,     yf);
    var n10 = grad2(perm[B],     xf - 1, yf);
    var n01 = grad2(perm[A + 1], xf,     yf - 1);
    var n11 = grad2(perm[B + 1], xf - 1, yf - 1);
    var a = n00 + (n10 - n00) * u;
    var b = n01 + (n11 - n01) * u;
    return a + (b - a) * v;
  };

  /** 3D Perlin. The only 3D field in the game: caves and the surface-band density (D-31). */
  U.noise3 = function (perm, x, y, z) {
    var fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
    var X = fx & 255, Y = fy & 255, Z = fz & 255;
    var xf = x - fx, yf = y - fy, zf = z - fz;
    var u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    var v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    var w = zf * zf * zf * (zf * (zf * 6 - 15) + 10);
    var A  = perm[X] + Y,     B  = perm[X + 1] + Y;
    var AA = perm[A] + Z,     AB = perm[A + 1] + Z;
    var BA = perm[B] + Z,     BB = perm[B + 1] + Z;
    var x1 = grad3(perm[AA],     xf,     yf,     zf);
    var x2 = grad3(perm[BA],     xf - 1, yf,     zf);
    var y1 = x1 + (x2 - x1) * u;
    x1 = grad3(perm[AB],         xf,     yf - 1, zf);
    x2 = grad3(perm[BB],         xf - 1, yf - 1, zf);
    var y2 = x1 + (x2 - x1) * u;
    var z1 = y1 + (y2 - y1) * v;
    x1 = grad3(perm[AA + 1],     xf,     yf,     zf - 1);
    x2 = grad3(perm[BA + 1],     xf - 1, yf,     zf - 1);
    y1 = x1 + (x2 - x1) * u;
    x1 = grad3(perm[AB + 1],     xf,     yf - 1, zf - 1);
    x2 = grad3(perm[BB + 1],     xf - 1, yf - 1, zf - 1);
    y2 = x1 + (x2 - x1) * u;
    var z2 = y1 + (y2 - y1) * v;
    return z1 + (z2 - z1) * w;
  };

  /**
   * Fractal sum, normalised to roughly [-1,1]. Octaves are offset by an irrational-ish vector
   * so two octaves of the same field never line up on the lattice.
   */
  U.fbm2 = function (perm, x, y, octaves, lacunarity, gain) {
    var lac = lacunarity || 2, g = gain === undefined ? 0.5 : gain;
    var amp = 1, freq = 1, sum = 0, norm = 0;
    for (var o = 0; o < octaves; o++) {
      sum  += amp * U.noise2(perm, x * freq + o * 41.37, y * freq + o * 97.13);
      norm += amp;
      amp  *= g;
      freq *= lac;
    }
    return sum / norm;
  };

  U.fbm3 = function (perm, x, y, z, octaves, lacunarity, gain) {
    var lac = lacunarity || 2, g = gain === undefined ? 0.5 : gain;
    var amp = 1, freq = 1, sum = 0, norm = 0;
    for (var o = 0; o < octaves; o++) {
      sum  += amp * U.noise3(perm, x * freq + o * 41.37, y * freq + o * 13.91, z * freq + o * 97.13);
      norm += amp;
      amp  *= g;
      freq *= lac;
    }
    return sum / norm;
  };

  // --- mat4 (column-major, WebGL/WebGPU compatible) -------------------------
  // Element (row r, column c) lives at m[c*4 + r] — the layout both APIs upload verbatim.
  var M = U.mat4 = {};
  M.create = function () {
    var m = new Float32Array(16);
    m[0] = m[5] = m[10] = m[15] = 1;
    return m;
  };

  M.identity = function (m) {
    m[0] = 1; m[1] = 0; m[2] = 0; m[3] = 0;
    m[4] = 0; m[5] = 1; m[6] = 0; m[7] = 0;
    m[8] = 0; m[9] = 0; m[10] = 1; m[11] = 0;
    m[12] = 0; m[13] = 0; m[14] = 0; m[15] = 1;
    return m;
  };

  M.copy = function (out, a) { for (var i = 0; i < 16; i++) out[i] = a[i]; return out; };

  /** out = a * b  (b applied first). Safe when out aliases a or b. */
  M.multiply = function (out, a, b) {
    var a00=a[0],a01=a[1],a02=a[2],a03=a[3], a10=a[4],a11=a[5],a12=a[6],a13=a[7],
        a20=a[8],a21=a[9],a22=a[10],a23=a[11], a30=a[12],a31=a[13],a32=a[14],a33=a[15];
    var b0,b1,b2,b3;
    b0=b[0];b1=b[1];b2=b[2];b3=b[3];
    out[0]=b0*a00+b1*a10+b2*a20+b3*a30; out[1]=b0*a01+b1*a11+b2*a21+b3*a31;
    out[2]=b0*a02+b1*a12+b2*a22+b3*a32; out[3]=b0*a03+b1*a13+b2*a23+b3*a33;
    b0=b[4];b1=b[5];b2=b[6];b3=b[7];
    out[4]=b0*a00+b1*a10+b2*a20+b3*a30; out[5]=b0*a01+b1*a11+b2*a21+b3*a31;
    out[6]=b0*a02+b1*a12+b2*a22+b3*a32; out[7]=b0*a03+b1*a13+b2*a23+b3*a33;
    b0=b[8];b1=b[9];b2=b[10];b3=b[11];
    out[8]=b0*a00+b1*a10+b2*a20+b3*a30; out[9]=b0*a01+b1*a11+b2*a21+b3*a31;
    out[10]=b0*a02+b1*a12+b2*a22+b3*a32; out[11]=b0*a03+b1*a13+b2*a23+b3*a33;
    b0=b[12];b1=b[13];b2=b[14];b3=b[15];
    out[12]=b0*a00+b1*a10+b2*a20+b3*a30; out[13]=b0*a01+b1*a11+b2*a21+b3*a31;
    out[14]=b0*a02+b1*a12+b2*a22+b3*a32; out[15]=b0*a03+b1*a13+b2*a23+b3*a33;
    return out;
  };

  /**
   * Right-handed perspective. `zeroToOne` selects the clip-space depth convention:
   *   false -> OpenGL, z in [-1,1]   (WebGL2)
   *   true  -> D3D/Metal, z in [0,1] (WebGPU)
   * This flag is the ONLY place the two backends' coordinate systems differ (D-3).
   */
  M.perspective = function (out, fovyRad, aspect, near, far, zeroToOne) {
    var f = 1 / Math.tan(fovyRad * 0.5);
    var nf = 1 / (near - far);
    out[0]=f/aspect; out[1]=0; out[2]=0; out[3]=0;
    out[4]=0; out[5]=f; out[6]=0; out[7]=0;
    out[8]=0; out[9]=0; out[11]=-1;
    out[12]=0; out[13]=0; out[15]=0;
    if (zeroToOne) { out[10] = far * nf;             out[14] = far * near * nf; }
    else           { out[10] = (far + near) * nf;    out[14] = 2 * far * near * nf; }
    return out;
  };

  M.lookAt = function (out, ex, ey, ez, cx, cy, cz, ux, uy, uz) {
    var zx = ex - cx, zy = ey - cy, zz = ez - cz;
    var l = Math.sqrt(zx*zx + zy*zy + zz*zz);
    if (l < 1e-9) { zx = 0; zy = 0; zz = 1; } else { l = 1/l; zx*=l; zy*=l; zz*=l; }
    var xx = uy*zz - uz*zy, xy = uz*zx - ux*zz, xz = ux*zy - uy*zx;
    l = Math.sqrt(xx*xx + xy*xy + xz*xz);
    if (l < 1e-9) { xx = 1; xy = 0; xz = 0; } else { l = 1/l; xx*=l; xy*=l; xz*=l; }
    var yx = zy*xz - zz*xy, yy = zz*xx - zx*xz, yz = zx*xy - zy*xx;
    out[0]=xx; out[1]=yx; out[2]=zx; out[3]=0;
    out[4]=xy; out[5]=yy; out[6]=zy; out[7]=0;
    out[8]=xz; out[9]=yz; out[10]=zz; out[11]=0;
    out[12]=-(xx*ex + xy*ey + xz*ez);
    out[13]=-(yx*ex + yy*ey + yz*ez);
    out[14]=-(zx*ex + zy*ey + zz*ez);
    out[15]=1;
    return out;
  };

  /**
   * First-person view matrix from yaw/pitch, in radians.
   * yaw 0 looks down -Z; +yaw turns right (toward +X); +pitch looks up.
   * forward = (sin(yaw)cos(pitch), sin(pitch), -cos(yaw)cos(pitch))
   */
  M.fpsView = function (out, x, y, z, yaw, pitch) {
    var cp = Math.cos(pitch), sp = Math.sin(pitch);
    var cy = Math.cos(yaw),   sy = Math.sin(yaw);
    var fx = sy*cp, fy = sp, fz = -cy*cp;
    return M.lookAt(out, x, y, z, x+fx, y+fy, z+fz, 0, 1, 0);
  };

  // --- containers -----------------------------------------------------------
  /** Fixed-capacity int ring queue. Used by the light BFS to avoid GC churn (D-27). */
  U.RingI32 = function (capacity) {
    this.buf = new Int32Array(capacity);
    this.cap = capacity; this.head = 0; this.tail = 0; this.size = 0;
  };
  U.RingI32.prototype.push = function (v) {
    if (this.size === this.cap) return false;          // caller decides: grow or drop
    this.buf[this.tail] = v;
    this.tail = (this.tail + 1) % this.cap;
    this.size++;
    return true;
  };
  U.RingI32.prototype.shift = function () {
    if (this.size === 0) return -1;
    var v = this.buf[this.head];
    this.head = (this.head + 1) % this.cap;
    this.size--;
    return v;
  };
  U.RingI32.prototype.clear = function () { this.head = this.tail = this.size = 0; };

  // --- timing ---------------------------------------------------------------
  U.now = (typeof performance !== 'undefined' && performance.now)
    ? function () { return performance.now(); }
    : function () { return Date.now(); };

  /** Tiny rolling profiler. Zero allocation in steady state. */
  U.Profiler = function (n) {
    this.samples = new Float32Array(n || 60); this.i = 0; this.n = n || 60; this.filled = 0;
  };
  U.Profiler.prototype.add = function (ms) {
    this.samples[this.i] = ms; this.i = (this.i + 1) % this.n;
    this.last = ms;                   // D-431: the most recent sample, for the per-frame budget bar
    if (this.filled < this.n) this.filled++;
  };
  /** D-431 — the samples oldest-first, for the F4 overlay's graph. Allocates its scratch once. */
  U.Profiler.prototype.series = function () {
    var out = this._series || (this._series = new Float32Array(this.n));
    var k, j = 0;
    if (this.filled < this.n) { for (k = 0; k < this.filled; k++) out[j++] = this.samples[k]; }
    else { for (k = 0; k < this.n; k++) out[j++] = this.samples[(this.i + k) % this.n]; }
    return this.filled < this.n ? out.subarray(0, this.filled) : out;
  };
  /** D-431 — the standard deviation of the ring, which is the honest word for "stutter". */
  U.Profiler.prototype.stdDev = function () {
    if (this.filled < 2) return 0;
    var m = this.avg(), s = 0, k;
    for (k = 0; k < this.filled; k++) { var d = this.samples[k] - m; s += d * d; }
    return Math.sqrt(s / this.filled);
  };
  U.Profiler.prototype.min = function () {
    if (!this.filled) return 0;
    var m = Infinity;
    for (var k = 0; k < this.filled; k++) if (this.samples[k] < m) m = this.samples[k];
    return m;
  };
  U.Profiler.prototype.avg = function () {
    if (!this.filled) return 0;
    var s = 0;
    for (var k = 0; k < this.filled; k++) s += this.samples[k];
    return s / this.filled;
  };
  /**
   * percentile(p) — the debug overlay's honest frame-time number. An average hides exactly the
   * thing that matters on a 2200G: the one frame in twenty that takes 40 ms. Sorts into a
   * pre-allocated scratch array so reading it every frame allocates nothing.
   */
  U.Profiler.prototype.percentile = function (p) {
    if (!this.filled) return 0;
    var s = this._sorted || (this._sorted = new Float32Array(this.n));
    for (var k = 0; k < this.filled; k++) s[k] = this.samples[k];
    var sub = this.filled === this.n ? s : s.subarray(0, this.filled);
    sub.sort();                       // TypedArray.sort is numeric, and sorts the view in place
    var i = Math.min(this.filled - 1, Math.max(0, Math.round(p * (this.filled - 1))));
    return sub[i];
  };
  U.Profiler.prototype.p95 = function () { return this.percentile(0.95); };
  U.Profiler.prototype.max = function () {
    var m = 0;
    for (var k = 0; k < this.filled; k++) if (this.samples[k] > m) m = this.samples[k];
    return m;
  };
  /** Polar draw over `src` (a JRandom, or a bare () => double); the spare value is cached on `src`. */
  U.polarGaussian = function (src, nd) {
    var call = nd ? function () { return nd.call(src); } : src;
    if (src.haveG) { src.haveG = false; return src.nextG; }
    var v1, v2, s, n = 0;
    do { v1 = 2 * call() - 1; v2 = 2 * call() - 1; s = v1 * v1 + v2 * v2; } while ((s >= 1 || s === 0) && ++n < 256);   // cap: a constant test stub would spin
    if (s >= 1 || s === 0) return 0;
    var m = Math.sqrt(-2 * Math.log(s) / s);
    src.nextG = v2 * m; src.haveG = true;
    return v1 * m;
  };
})(MCL);
