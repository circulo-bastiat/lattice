// pngdec.mjs — the inverse of png.mjs: enough of a PNG decoder to look at a screenshot.
//
// It exists because of the bug in PLAN §23. Four separate checks said the world was correct —
// the generator, the mesher, the state tables and the shaders all passed — and the game still
// drew the ground as a hole in the sky, because nothing in the suite had ever LOOKED at the
// picture. `titlecheck` now takes a screenshot of a running world and asserts what is in it,
// and this is what turns those bytes into pixels.
//
// Only what Chromium's `Page.captureScreenshot` produces is supported: 8-bit RGB or RGBA,
// non-interlaced. Anything else throws rather than guessing.

import { inflateSync } from 'node:zlib';

/**
 * decodePng(buffer) -> { width, height, channels, data: Uint8Array }
 * `data` is row-major, `channels` bytes per pixel, top row first.
 */
export function decodePng(buf) {
  if (buf.length < 8 || buf[0] !== 0x89 || buf[1] !== 0x50) throw new Error('not a PNG');
  let o = 8;
  let width = 0, height = 0, depth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (o + 8 <= buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('latin1', o + 4, o + 8);
    const body = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      depth = body[8]; colorType = body[9]; interlace = body[12];
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    o += 12 + len;
  }
  if (depth !== 8) throw new Error('PNG bit depth ' + depth + ' is not supported');
  if (interlace) throw new Error('interlaced PNG is not supported');
  const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : 0;
  if (!channels) throw new Error('PNG colour type ' + colorType + ' is not supported');

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(height * stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const row = y * stride, prev = row - stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[p + i];
      const a = i >= channels ? out[row + i - channels] : 0;
      const b = y > 0 ? out[prev + i] : 0;
      const c = (i >= channels && y > 0) ? out[prev + i - channels] : 0;
      let v;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: {
          const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
          v = x + (pa <= pb && pa <= pc ? a : (pb <= pc ? b : c));
          break;
        }
        default: throw new Error('unknown PNG row filter ' + filter);
      }
      out[row + i] = v & 255;
    }
    p += stride;
  }
  return { width, height, channels, data: out };
}

/** The colour at one pixel, as 0xRRGGBB. */
/**
 * toRgba(img) -> the same image with FOUR channels, whatever it decoded as.
 *
 * ⚠ THIS EXISTS BECAUSE HEADLESS CHROMIUM RETURNS RGB, NOT RGBA. `Page.captureScreenshot` gives
 * a 3-channel PNG, and every consumer that indexed it as `(y * w + x) * 4` was reading MISALIGNED
 * BYTES — pixel n's red at byte 4n instead of 3n, so from pixel 1 onward the "red" it compared
 * was some earlier pixel's green — and then walking off the end of the array for the last quarter
 * of the image, where `undefined - undefined` is NaN, `NaN > 0` is false, and every difference
 * silently counted as zero. `cullcheck` printed `mean NaN%` for a whole session and nobody read
 * it. The bottom quarter of every screenshot in this suite was never compared at all.
 *
 * The channel-aware helpers below (`pixelAt` and everything built on it) were always right; it is
 * the two files that indexed the raw buffer themselves that were not. Normalising once here is
 * cheaper than being careful in each of them.
 */
export function toRgba(img) {
  const ch = img.channels || 4;
  if (ch === 4) return img;
  const out = new Uint8Array(img.width * img.height * 4);
  for (let i = 0, n = img.width * img.height; i < n; i++) {
    const o = i * ch;
    out[i * 4] = img.data[o];
    out[i * 4 + 1] = img.data[o + (ch > 2 ? 1 : 0)];
    out[i * 4 + 2] = img.data[o + (ch > 2 ? 2 : 0)];
    out[i * 4 + 3] = ch === 2 ? img.data[o + 1] : 255;
  }
  return { width: img.width, height: img.height, channels: 4, data: out };
}

export function pixelAt(img, x, y) {
  const o = (y * img.width + x) * img.channels;
  return (img.data[o] << 16) | (img.data[o + 1] << 8) | img.data[o + 2];
}

/**
 * A histogram of a rectangle, bucketed coarsely enough to be readable: the key is the colour
 * with each channel rounded to the nearest 16, and the value is how many pixels landed in it.
 * Sorted, most common first.
 */
export function histogram(img, x0, y0, w, h) {
  const counts = new Map();
  for (let y = y0; y < y0 + h && y < img.height; y++) {
    for (let x = x0; x < x0 + w && x < img.width; x++) {
      const c = pixelAt(img, x, y);
      const k = (((c >> 16) & 0xF0) << 16) | (((c >> 8) & 0xF0) << 8) | (c & 0xF0);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

/** How bright a rectangle is on average, 0..1. The cheapest "is anything drawn here" test. */
export function meanLuma(img, x0, y0, w, h) {
  let s = 0, n = 0;
  for (let y = y0; y < y0 + h && y < img.height; y++) {
    for (let x = x0; x < x0 + w && x < img.width; x++) {
      const c = pixelAt(img, x, y);
      s += ((c >> 16) & 255) * 0.299 + ((c >> 8) & 255) * 0.587 + (c & 255) * 0.114;
      n++;
    }
  }
  return n ? s / n / 255 : 0;
}

/** The fraction of a rectangle within `tol` of one colour. Used to ask "is this all sky?" */
export function fractionNear(img, x0, y0, w, h, rgb, tol) {
  const r0 = (rgb >> 16) & 255, g0 = (rgb >> 8) & 255, b0 = rgb & 255;
  let hit = 0, n = 0;
  for (let y = y0; y < y0 + h && y < img.height; y++) {
    for (let x = x0; x < x0 + w && x < img.width; x++) {
      const c = pixelAt(img, x, y);
      if (Math.abs(((c >> 16) & 255) - r0) <= tol && Math.abs(((c >> 8) & 255) - g0) <= tol &&
          Math.abs((c & 255) - b0) <= tol) hit++;
      n++;
    }
  }
  return n ? hit / n : 0;
}
