// png.mjs — decode and encode PNG with no external dependencies.
//
// Node ships zlib, which is the only hard part of PNG. Everything else is a chunk walk, a
// scanline unfilter and a CRC. ~200 lines buys us a build pipeline with a zero-dependency
// install, in a project whose entire identity is "one self-contained file".
//
// Supports what Minecraft's own textures actually use: bit depth 8, colour types
// 0 (grey), 2 (RGB), 3 (palette), 4 (grey+alpha), 6 (RGBA), non-interlaced.
// Interlaced PNGs are rejected loudly rather than silently mis-decoded.

import { inflateSync, deflateSync } from 'node:zlib';

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// ---------------------------------------------------------------- CRC32
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------- decode

/** @returns {{width:number,height:number,data:Buffer}} data is RGBA, 4 bytes per pixel. */
export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG');
  let p = 8;
  let width = 0, height = 0, depth = 0, colour = 0, interlace = 0;
  let palette = null, trns = null;
  const idat = [];

  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    p += 12 + len;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8]; colour = data[9]; interlace = data[12];
    } else if (type === 'PLTE') { palette = Buffer.from(data); }
    else if (type === 'tRNS') { trns = Buffer.from(data); }
    else if (type === 'IDAT') { idat.push(Buffer.from(data)); }
    else if (type === 'IEND') break;
  }

  if (interlace !== 0) throw new Error('interlaced PNG not supported');
  if (depth !== 8) throw new Error(`unsupported bit depth ${depth}`);

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colour];
  if (!channels) throw new Error(`unsupported colour type ${colour}`);

  const raw = inflateSync(Buffer.concat(idat));
  const bpp = channels;               // bytes per pixel at depth 8
  const stride = width * bpp;
  const out = Buffer.alloc(width * height * 4);
  const line = Buffer.alloc(stride);
  const prev = Buffer.alloc(stride);
  let rp = 0;

  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    raw.copy(line, 0, rp, rp + stride);
    rp += stride;
    // undo the scanline filter - this is the whole of PNG's compression cleverness
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      switch (filter) {
        case 0: break;
        case 1: v = (v + a) & 0xff; break;
        case 2: v = (v + b) & 0xff; break;
        case 3: v = (v + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
          const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          v = (v + pr) & 0xff; break;
        }
        default: throw new Error(`bad filter ${filter} on row ${y}`);
      }
      line[i] = v;
    }
    line.copy(prev);
    // expand whatever colour type this is into RGBA
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const s = x * bpp;
      if (colour === 6) { out[o] = line[s]; out[o+1] = line[s+1]; out[o+2] = line[s+2]; out[o+3] = line[s+3]; }
      else if (colour === 2) { out[o] = line[s]; out[o+1] = line[s+1]; out[o+2] = line[s+2]; out[o+3] = 255; }
      else if (colour === 0) { const g = line[s]; out[o] = out[o+1] = out[o+2] = g; out[o+3] = 255; }
      else if (colour === 4) { const g = line[s]; out[o] = out[o+1] = out[o+2] = g; out[o+3] = line[s+1]; }
      else { // palette
        const idx = line[s];
        out[o] = palette[idx * 3]; out[o+1] = palette[idx * 3 + 1]; out[o+2] = palette[idx * 3 + 2];
        out[o+3] = trns && idx < trns.length ? trns[idx] : 255;
      }
    }
  }
  return { width, height, data: out };
}

// ---------------------------------------------------------------- encode

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/**
 * Encode RGBA to PNG, losslessly.
 *
 * Filter choice matters more than the deflate level for pixel art: we try all five filters
 * per scanline and keep the one with the smallest sum of absolute differences, which is the
 * heuristic the reference encoder uses. On 16x16 tiled atlases it is worth a lot, because
 * runs of identical pixels filter to zero.
 */
export function encodePng(width, height, rgba, { level = 9, palette = true } = {}) {
  // ⚠ A plain Uint8Array is a perfectly reasonable thing to hand an encoder, and this one used
  // Buffer methods (`copy`, `subarray().copy`) on it — so it threw `row.copy is not a function`
  // from four frames deep the first time anything but the build called it. Normalise once, here.
  if (!Buffer.isBuffer(rgba)) rgba = Buffer.from(rgba.buffer || rgba, rgba.byteOffset || 0, rgba.length);
  // Try indexed colour first - Minecraft textures have very few distinct colours, and
  // 8-bit indices are a quarter the size of RGBA before deflate even runs.
  if (palette) {
    const map = new Map();
    let ok = true;
    for (let i = 0; i < rgba.length; i += 4) {
      const key = (rgba[i] << 24) | (rgba[i+1] << 16) | (rgba[i+2] << 8) | rgba[i+3];
      if (!map.has(key)) {
        if (map.size >= 256) { ok = false; break; }
        map.set(key, map.size);
      }
    }
    if (ok) return encodeIndexed(width, height, rgba, map, level);
  }
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  let o = 0;
  const prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const row = rgba.subarray(y * stride, (y + 1) * stride);
    const { filter, out } = bestFilter(row, prev, 4, stride);
    raw[o++] = filter;
    out.copy(raw, o); o += stride;
    row.copy(prev);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level })), chunk('IEND', Buffer.alloc(0))]);
}

function encodeIndexed(width, height, rgba, map, level) {
  const n = map.size;
  const plte = Buffer.alloc(n * 3);
  const trns = Buffer.alloc(n);
  let needTrns = false;
  for (const [key, idx] of map) {
    const r = (key >>> 24) & 0xff, g = (key >>> 16) & 0xff, b = (key >>> 8) & 0xff, a = key & 0xff;
    plte[idx * 3] = r; plte[idx * 3 + 1] = g; plte[idx * 3 + 2] = b;
    trns[idx] = a; if (a !== 255) needTrns = true;
  }
  const stride = width;
  const raw = Buffer.alloc((stride + 1) * height);
  let o = 0;
  const prev = Buffer.alloc(stride);
  const row = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      row[x] = map.get((rgba[i] << 24) | (rgba[i+1] << 16) | (rgba[i+2] << 8) | rgba[i+3]);
    }
    const { filter, out } = bestFilter(row, prev, 1, stride);
    raw[o++] = filter; out.copy(raw, o); o += stride;
    row.copy(prev);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 3; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const parts = [SIG, chunk('IHDR', ihdr), chunk('PLTE', plte)];
  if (needTrns) parts.push(chunk('tRNS', trns));
  parts.push(chunk('IDAT', deflateSync(raw, { level })), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

function bestFilter(row, prev, bpp, stride) {
  let best = null, bestScore = Infinity, bestFilter = 0;
  for (let f = 0; f <= 4; f++) {
    const out = Buffer.alloc(stride);
    let score = 0;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v;
      switch (f) {
        case 0: v = row[i]; break;
        case 1: v = (row[i] - a) & 0xff; break;
        case 2: v = (row[i] - b) & 0xff; break;
        case 3: v = (row[i] - ((a + b) >> 1)) & 0xff; break;
        default: {
          const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
          const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          v = (row[i] - pr) & 0xff;
        }
      }
      out[i] = v;
      score += v < 128 ? v : 256 - v;
    }
    if (score < bestScore) { bestScore = score; best = out; bestFilter = f; }
  }
  return { filter: bestFilter, out: best };
}

/**
 * The render-pass class of one 16x16 RGBA tile: 0 opaque, 1 cutout, 2 blended.
 *
 * ⚠ ONE COPY, TWO CALLERS. `build-atlas.mjs` classifies the block tiles with it and
 * `extract-items.mjs` classifies the item sprites with it (D-342). It lived inline in
 * build-atlas until the item sprites needed exactly the same answer, and a second copy of a
 * three-line rule is still a second copy: the moment one of them treats alpha 254 differently
 * from the other, a dropped item renders in a different pass from the block it came from and
 * the difference shows up as a sorting artefact nobody can trace back to a threshold.
 *
 * ⚠ THE EARLY EXIT IS ON `anyPartial` ONLY. A tile with a hole must keep scanning, because a
 * later partial pixel outranks the hole; a tile with a partial pixel cannot be anything but 2.
 */
export function alphaClass(rgba) {
  let anyHole = 0;
  for (let o = 3; o < rgba.length; o += 4) {
    const a = rgba[o];
    if (a === 0) anyHole = 1;
    else if (a !== 255) return 2;
  }
  return anyHole ? 1 : 0;
}
