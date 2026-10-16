// build.mjs <outdir> - the static site for the mclite-phone Pages repo: these files + generated icons (no binaries in git, D-6).
import { mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, crc32 } from 'node:zlib';
const here = dirname(fileURLToPath(import.meta.url));
const chunk = (t, d) => { const b = Buffer.concat([Buffer.from(t), d]), n = Buffer.alloc(4); n.writeUInt32BE(d.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(b)); return Buffer.concat([n, b, c]); };
/** A square PNG: grass-green block with a dark inset square (reads as a voxel) on the app's background colour. */
export function png(size) {
  const raw = Buffer.alloc((size * 3 + 1) * size), m = size >> 3;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const o = y * (size * 3 + 1) + 1 + x * 3, inner = x >= 3 * m && x < 5 * m && y >= 3 * m && y < 5 * m, blk = x >= m && x < size - m && y >= m && y < size - m;
    const c = inner ? [30, 60, 20] : blk ? (y < 3 * m ? [90, 170, 60] : [130, 90, 55]) : [16, 20, 24];
    raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2];
  }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(size, 0); ih.writeUInt32BE(size, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
export function build(out) {
  mkdirSync(out, { recursive: true });
  for (const f of ['index.html', 'app.js', 'subs.js', 'runs.js', 'home.js', 'controls.js', 'requests.js', 'sw.js', 'manifest.webmanifest']) copyFileSync(join(here, f), join(out, f));
  for (const [n, s] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) writeFileSync(join(out, n), png(s));
  writeFileSync(join(out, '.nojekyll'), '');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) { build(process.argv[2] || join(here, 'out')); console.log('phone-web built'); }
