// 01b_inflate.js — raw DEFLATE decoder and base64 decoder, in plain JS.
// Runs on: main thread AND workers. No DOM, no fetch, no WASM (D-17, D-18).
//
// WHY THIS EXISTS, and why it is NOT DecompressionStream.
//
// The baked block geometry is 1,890 KB of binary. Measured 6 Sept 2026, the three ways to
// get it into a file:// page:
//
//     base64 of the raw binary ........ 2,520.6 KB   synchronous
//     base64 of the deflated binary ...   296.4 KB   needs a decoder
//     base-36 text ....................  2,682.4 KB  synchronous
//
// The page is opened from disk, so the browser never gzips it: the literal bytes in the
// file are the whole cost. 296 KB versus 2,520 KB is not a close call.
//
// docs/archive/PLAN.md §F8b originally recommended `DecompressionStream('deflate')` with a JS
// fallback. Writing the fallback first inverted that: once a synchronous inflate exists,
// DecompressionStream buys nothing and costs a promise chain through the boot sequence, a
// second code path to test, and a feature check. Measured below in tools/inflatecheck.mjs:
// 222 KB inflates in a few milliseconds, once, at boot. So this is the only path, the boot
// stays synchronous, and workers use the same function without a capability test.
//
// Implements RFC 1951 raw DEFLATE: stored, fixed-Huffman and dynamic-Huffman blocks.

(function (NS) {
  'use strict';

  var Z = NS.Z = {};

  // ---------------------------------------------------------------- base64
  // atob() exists in workers as well as on the main thread, and is far faster than any
  // hand-rolled loop. The manual table is only for environments without it (node, tests).
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var B64REV = null;

  Z.fromBase64 = function (s) {
    if (typeof atob === 'function') {
      var bin = atob(s);
      var out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    if (!B64REV) {
      B64REV = new Int16Array(256);
      for (var k = 0; k < 256; k++) B64REV[k] = -1;
      for (var j = 0; j < 64; j++) B64REV[B64.charCodeAt(j)] = j;
    }
    var len = s.length;
    while (len && s.charCodeAt(len - 1) === 61) len--;          // '='
    var n = (len * 3) >> 2;
    var o = new Uint8Array(n);
    var acc = 0, bits = 0, p = 0;
    for (var q = 0; q < len; q++) {
      var v = B64REV[s.charCodeAt(q)];
      if (v < 0) continue;
      acc = (acc << 6) | v; bits += 6;
      if (bits >= 8) { bits -= 8; o[p++] = (acc >> bits) & 0xff; }
    }
    return o;
  };

  // ---------------------------------------------------------------- huffman
  // A canonical Huffman table as a flat lookup: for a code of `len` bits, the symbol lives
  // at counts/offsets computed the way RFC 1951 §3.2.2 spells out. Building the table once
  // per block and reading bit-by-bit is fast enough here — the whole payload is 222 KB and
  // this runs exactly once, at boot.
  function buildTree(lengths, n) {
    var bl_count = new Uint16Array(16), i;
    for (i = 0; i < n; i++) bl_count[lengths[i]]++;
    bl_count[0] = 0;
    var next_code = new Uint16Array(16), code = 0;
    for (i = 1; i < 16; i++) { code = (code + bl_count[i - 1]) << 1; next_code[i] = code; }
    // fast table: 15-bit max code length, but most codes are short, so use a 9-bit primary
    // table with a linear fallback for the rest.
    var codes = new Uint16Array(n);
    for (i = 0; i < n; i++) if (lengths[i]) codes[i] = next_code[lengths[i]]++;
    return { lengths: lengths, codes: codes, count: n, bl_count: bl_count };
  }

  function Reader(buf) {
    this.b = buf; this.p = 0; this.acc = 0; this.bits = 0;
  }
  // ⚠ The bounds check is not defensive decoration. Without it, reading past the end gives
  // `undefined`, `undefined << n` is 0, and a corrupt or truncated stream decodes zeros
  // forever instead of failing — tools/inflatecheck.mjs hung for two minutes on exactly
  // that before this line existed. A decoder that spins on bad input is worse than one that
  // throws, because the symptom is a frozen tab with no error.
  Reader.prototype.need = function (n) {
    while (this.bits < n) {
      if (this.p >= this.b.length) throw new Error('inflate: input ended mid-symbol');
      this.acc |= this.b[this.p++] << this.bits;
      this.bits += 8;
    }
  };
  Reader.prototype.get = function (n) {
    if (n === 0) return 0;
    this.need(n);
    var v = this.acc & ((1 << n) - 1);
    this.acc >>>= n; this.bits -= n;
    return v;
  };
  Reader.prototype.align = function () { this.acc = 0; this.bits = 0; };

  /** Decode one symbol, MSB-first as DEFLATE's Huffman codes are packed. */
  function decodeSym(r, t) {
    var code = 0, first = 0, index = 0;
    for (var len = 1; len <= 15; len++) {
      code |= r.get(1);
      var count = t.bl_count[len];
      if (code - first < count) return t.order[index + (code - first)];
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new Error('bad Huffman code');
  }

  /** Canonical order: symbols sorted by (length, symbol), which is what decodeSym walks. */
  function order(t) {
    var offs = new Uint16Array(16), i, sum = 0;
    for (i = 1; i < 16; i++) { offs[i] = sum; sum += t.bl_count[i]; }
    var ord = new Uint16Array(sum);
    for (i = 0; i < t.count; i++) if (t.lengths[i]) ord[offs[t.lengths[i]]++] = i;
    t.order = ord;
    return t;
  }

  function tree(lengths, n) { return order(buildTree(lengths, n)); }

  var LEN_BASE = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
  var LEN_EXTRA = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
  var DIST_BASE = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
  var DIST_EXTRA = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
  var CLEN_ORDER = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];

  var FIXED_LIT = null, FIXED_DIST = null;
  function fixedTrees() {
    if (FIXED_LIT) return;
    var l = new Uint8Array(288), i;
    for (i = 0; i < 144; i++) l[i] = 8;
    for (; i < 256; i++) l[i] = 9;
    for (; i < 280; i++) l[i] = 7;
    for (; i < 288; i++) l[i] = 8;
    FIXED_LIT = tree(l, 288);
    var d = new Uint8Array(30);
    for (i = 0; i < 30; i++) d[i] = 5;
    FIXED_DIST = tree(d, 30);
  }

  /**
   * inflateRaw(bytes, expectedSize) -> Uint8Array
   * `expectedSize` is not a hint, it is the exact output length: the packer knows it and
   * writes it into the header, so there is no reallocation and a mismatch is a hard error
   * rather than a silently truncated world.
   */
  Z.inflateRaw = function (buf, expectedSize) {
    var out = new Uint8Array(expectedSize);
    var o = 0;
    var r = new Reader(buf);
    var last = 0;

    do {
      last = r.get(1);
      var type = r.get(2);

      if (type === 0) {
        // stored: skip to a byte boundary, then LEN / NLEN / raw bytes
        r.align();
        if (r.p + 4 > r.b.length) throw new Error('inflate: truncated stored-block header');
        var len = r.b[r.p] | (r.b[r.p + 1] << 8);
        var nlen = r.b[r.p + 2] | (r.b[r.p + 3] << 8);
        if ((len ^ 0xffff) !== nlen) throw new Error('stored block length mismatch');
        r.p += 4;
        if (r.p + len > r.b.length) throw new Error('inflate: stored block runs past the input');
        if (o + len > expectedSize) throw new Error('inflate: stored block would overrun the output');
        out.set(r.b.subarray(r.p, r.p + len), o);
        r.p += len; o += len;
        continue;
      }

      var lit, dist;
      if (type === 1) { fixedTrees(); lit = FIXED_LIT; dist = FIXED_DIST; }
      else if (type === 2) {
        var hlit = r.get(5) + 257, hdist = r.get(5) + 1, hclen = r.get(4) + 4;
        var clen = new Uint8Array(19), i;
        for (i = 0; i < hclen; i++) clen[CLEN_ORDER[i]] = r.get(3);
        var ctree = tree(clen, 19);
        var lens = new Uint8Array(hlit + hdist);
        i = 0;
        while (i < hlit + hdist) {
          var sym = decodeSym(r, ctree);
          if (sym < 16) { lens[i++] = sym; }
          else if (sym === 16) { var prev = lens[i - 1], n1 = 3 + r.get(2); while (n1--) lens[i++] = prev; }
          else if (sym === 17) { var n2 = 3 + r.get(3); while (n2--) lens[i++] = 0; }
          else { var n3 = 11 + r.get(7); while (n3--) lens[i++] = 0; }
        }
        lit = tree(lens.subarray(0, hlit), hlit);
        dist = tree(lens.subarray(hlit), hdist);
      } else throw new Error('bad DEFLATE block type ' + type);

      for (;;) {
        // A corrupt stream can decode a valid-looking symbol that writes past the end. The
        // output length is known exactly, so overrunning it is a hard error and not a
        // reason to keep going.
        if (o > expectedSize) throw new Error('inflate: output overran ' + expectedSize + ' bytes');
        var s = decodeSym(r, lit);
        if (s < 256) {
          if (o >= expectedSize) throw new Error('inflate: literal would overrun the output');
          out[o++] = s; continue;
        }
        if (s === 256) break;
        s -= 257;
        var length = LEN_BASE[s] + r.get(LEN_EXTRA[s]);
        var ds = decodeSym(r, dist);
        var d = DIST_BASE[ds] + r.get(DIST_EXTRA[ds]);
        var from = o - d;
        if (from < 0) throw new Error('inflate: back-reference before the start of the output');
        if (o + length > expectedSize) throw new Error('inflate: copy would overrun the output');
        // byte-by-byte on purpose: overlapping copies are how DEFLATE encodes runs, and
        // out.copyWithin would read the pre-copy bytes and produce the wrong result.
        for (var c = 0; c < length; c++) out[o++] = out[from++];
      }
    } while (!last);

    if (o !== expectedSize) throw new Error('inflate produced ' + o + ' bytes, expected ' + expectedSize);
    return out;
  };

  /** base64 of a raw-deflate stream -> the original bytes. The whole boot path in one call. */
  Z.unpack = function (b64, size) { return Z.inflateRaw(Z.fromBase64(b64), size); };
})(MCL);
