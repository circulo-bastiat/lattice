// 03_section.js — the 16^3 palette + bit-packed section codec (docs/archive/ARCH.md §4, D-16..D-19).
// This format crosses every module boundary and the worker boundary, so a Section is a PLAIN
// OBJECT: no prototype, no methods, structured-clone-safe.
// Runs on: main thread AND workers. No DOM.

(function (NS) {
  'use strict';

  var VOL = NS.CFG.SECTION_VOL;   // 4096

  // Per-bits lookup tables. bits is restricted to {1,2,4,8,16} so an index never straddles a
  // Uint32 word (D-17) — that keeps the read branch-free and single-load.
  var WORDS   = [];   // Uint32 words needed for 4096 indices
  var SHIFT   = [];   // i >>> SHIFT[b] -> word
  var IMASK   = [];   // i & IMASK[b] -> slot within word
  var VMASK   = [];   // value mask
  (function () {
    var b, per;
    for (b = 0; b <= 16; b++) { WORDS[b] = 0; SHIFT[b] = 0; IMASK[b] = 0; VMASK[b] = 0; }
    var list = [1, 2, 4, 8, 16];
    for (var k = 0; k < list.length; k++) {
      b = list[k]; per = 32 / b;
      WORDS[b] = VOL / per;
      SHIFT[b] = Math.log2(per) | 0;
      IMASK[b] = per - 1;
      VMASK[b] = b === 16 ? 0xFFFF : ((1 << b) - 1);
    }
  })();

  var S = NS.Section = {};

  S.BITS_FOR_COUNT = function (n) {
    if (n <= 2)   return 1;
    if (n <= 4)   return 2;
    if (n <= 16)  return 4;
    if (n <= 256) return 8;
    return 16;
  };

  /** i = (y<<8) | (z<<4) | x  — YZX, so x-runs are contiguous (D-19). */
  S.index = function (x, y, z) { return (y << 8) | (z << 4) | x; };

  /** A uniform section carries no arrays at all. This is the common case (D-16). */
  S.makeUniform = function (blockId, lightByte) {
    return { u: blockId | 0, lu: (lightByte | 0) & 0xFF };
  };

  S.isUniform = function (sec) { return sec.u >= 0; };

  // --- blocks ---------------------------------------------------------------

  S.get = function (sec, i) {
    if (sec.u >= 0) return sec.u;
    var b = sec.b;
    return sec.p[(sec.d[i >>> SHIFT[b]] >>> ((i & IMASK[b]) * b)) & VMASK[b]];
  };

  S.getXYZ = function (sec, x, y, z) { return S.get(sec, (y << 8) | (z << 4) | x); };

  /** Turn a uniform section into a palette section holding the same block. */
  function deUniform(sec) {
    var u = sec.u;
    sec.u = -1;
    sec.b = 1;
    sec.n = 1;
    sec.p = new Uint16Array(2);
    sec.p[0] = u;
    sec.d = new Uint32Array(WORDS[1]);   // all zeros -> every voxel is palette entry 0
    return sec;
  }

  /** Widen the packed array to a larger bits-per-index. */
  function grow(sec, nb) {
    var ob = sec.b, od = sec.d;
    var nd = new Uint32Array(WORDS[nb]);
    var os = SHIFT[ob], om = IMASK[ob], ov = VMASK[ob];
    var ns = SHIFT[nb], nm = IMASK[nb];
    for (var i = 0; i < VOL; i++) {
      var v = (od[i >>> os] >>> ((i & om) * ob)) & ov;
      if (v) nd[i >>> ns] |= v << ((i & nm) * nb);
    }
    var np = new Uint16Array(nb === 16 ? Math.max(sec.p.length, 512) : (1 << nb));
    np.set(sec.p.subarray(0, Math.min(sec.p.length, np.length)));
    sec.p = np;
    sec.b = nb;
    sec.d = nd;
    return sec;
  }

  S.set = function (sec, i, blockId) {
    blockId |= 0;
    if (sec.u >= 0) {
      if (sec.u === blockId) return sec;
      deUniform(sec);
    }
    // find or add the palette entry
    var pi = -1, p = sec.p, n = sec.n;
    for (var k = 0; k < n; k++) if (p[k] === blockId) { pi = k; break; }
    if (pi < 0) {
      var need = S.BITS_FOR_COUNT(n + 1);
      if (need > sec.b) { grow(sec, need); p = sec.p; }
      if (n >= p.length) {                       // only reachable at b === 16
        var bigger = new Uint16Array(p.length * 2);
        bigger.set(p); sec.p = p = bigger;
      }
      pi = n;
      p[pi] = blockId;
      sec.n = n + 1;
    }
    var b = sec.b, w = i >>> SHIFT[b], sh = (i & IMASK[b]) * b;
    sec.d[w] = (sec.d[w] & ~(VMASK[b] << sh)) | (pi << sh);
    return sec;
  };

  S.setXYZ = function (sec, x, y, z, id) { return S.set(sec, (y << 8) | (z << 4) | x, id); };

  S.fill = function (sec, blockId) {
    sec.u = blockId | 0;
    delete sec.p; delete sec.b; delete sec.d; delete sec.n;
    return sec;
  };

  // --- light (sky in the high nibble, block in the low nibble — D-18) -------

  S.getLight = function (sec, i) { return sec.lu >= 0 ? sec.lu : sec.l[i]; };
  S.sky      = function (byte) { return byte >>> 4; };
  S.block    = function (byte) { return byte & 15; };
  S.packLight = function (sky, blk) { return ((sky & 15) << 4) | (blk & 15); };

  S.setLight = function (sec, i, byte) {
    if (sec.lu >= 0) {
      if (sec.lu === byte) return sec;
      var l = new Uint8Array(VOL);
      if (sec.lu) l.fill(sec.lu);
      sec.l = l;
      sec.lu = -1;
    }
    sec.l[i] = byte & 0xFF;
    return sec;
  };

  S.fillLight = function (sec, byte) {
    sec.lu = byte & 0xFF;
    delete sec.l;
    return sec;
  };

  // --- maintenance ----------------------------------------------------------

  /**
   * Drop unused palette entries, shrink bits, and re-uniform if possible.
   *
   * ⚠ NOTHING CALLS THIS YET. The comment used to say "called lazily on idle frames only", and
   * session 4's dead-code sweep found no caller anywhere: a section that once held three hundred
   * states keeps 16-bit indices for the rest of the session even after the player breaks it back
   * down to stone. It is written, it is correct, and wiring it into an idle-frame budget is a
   * job with a measurement attached (how much memory does a played-in world actually waste?) —
   * so it is in NEXT.md's gap table rather than switched on untested. Never call it on the edit
   * path (D-21).
   */
  S.compact = function (sec) {
    if (sec.u >= 0) return sec;
    var b = sec.b, d = sec.d, p = sec.p;
    var used = new Uint8Array(p.length);
    var s = SHIFT[b], m = IMASK[b], v = VMASK[b], i;
    for (i = 0; i < VOL; i++) used[(d[i >>> s] >>> ((i & m) * b)) & v] = 1;

    var remap = new Uint16Array(p.length), np = [], k;
    for (k = 0; k < sec.n; k++) if (used[k]) { remap[k] = np.length; np.push(p[k]); }
    if (np.length === 1) return S.fill(sec, np[0]);
    if (np.length === sec.n && S.BITS_FOR_COUNT(np.length) === b) return sec;

    var nb = S.BITS_FOR_COUNT(np.length);
    var nd = new Uint32Array(WORDS[nb]);
    var ns = SHIFT[nb], nm = IMASK[nb];
    for (i = 0; i < VOL; i++) {
      var val = remap[(d[i >>> s] >>> ((i & m) * b)) & v];
      if (val) nd[i >>> ns] |= val << ((i & nm) * nb);
    }
    sec.p = Uint16Array.from(np);
    sec.b = nb; sec.d = nd; sec.n = np.length;
    return sec;
  };

  /** Deep copy — what a mesh snapshot sends to a worker (D-40, D-42). */
  S.copy = function (sec) {
    var o = { u: sec.u, lu: sec.lu };
    if (sec.u < 0) { o.p = new Uint16Array(sec.p); o.b = sec.b; o.d = new Uint32Array(sec.d); o.n = sec.n; }
    if (sec.lu < 0) o.l = new Uint8Array(sec.l);
    return o;
  };

  /**
   * copyInto(src, dst) — the same deep copy, but reusing dst's typed arrays whenever their
   * lengths already match. Building one mesh snapshot allocates 27 of these, six or so times a
   * frame while streaming, and on a Celeron that is the main thread's largest source of GC
   * pressure. The pool in World hands the same objects back (D-88).
   *
   * dst may be null/undefined, in which case this is exactly S.copy.
   */
  S.copyInto = function (src, dst) {
    if (!dst) return S.copy(src);
    dst.u = src.u; dst.lu = src.lu;
    if (src.u < 0) {
      if (!dst.p || dst.p.length !== src.p.length) dst.p = new Uint16Array(src.p.length);
      dst.p.set(src.p);
      if (!dst.d || dst.d.length !== src.d.length) dst.d = new Uint32Array(src.d.length);
      dst.d.set(src.d);
      dst.b = src.b; dst.n = src.n;
    } else if (dst.p) {
      // A structured clone walks own properties, so a stale palette on a now-uniform section
      // would be sent for nothing. Cleared to undefined rather than `delete`d: `delete` puts the
      // object into dictionary mode in V8 and this is a pooled object that will be reused
      // thousands of times, while cloning an undefined field costs a byte.
      dst.p = undefined; dst.d = undefined; dst.b = undefined; dst.n = undefined;
    }
    if (src.lu < 0) {
      if (!dst.l || dst.l.length !== src.l.length) dst.l = new Uint8Array(src.l.length);
      dst.l.set(src.l);
    } else if (dst.l) { dst.l = undefined; }
    return dst;
  };

  /** Push this section's backing buffers onto a transfer list (worker -> main only, D-42). */
  S.transferList = function (sec, out) {
    if (sec.u < 0) { out.push(sec.p.buffer); out.push(sec.d.buffer); }
    if (sec.lu < 0) out.push(sec.l.buffer);
    return out;
  };

  /** Rough resident bytes, for the debug overlay. */
  S.bytes = function (sec) {
    var n = 32;
    if (sec.u < 0) n += sec.p.byteLength + sec.d.byteLength;
    if (sec.lu < 0) n += sec.l.byteLength;
    return n;
  };
})(MCL);
