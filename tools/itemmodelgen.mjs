// itemmodelgen.mjs — vanilla's ItemModelGenerator, as a function from sprite pixels to elements.
//
// ⚠ EVERY NUMBER IN HERE COMES OUT OF `tools/golden/itemmodel-1.18.2.tsv`, which
// `tools/extract-itemmodel.mjs` reads from the 1.18.2 bytecode (D-263, D-305). Nothing below
// types a constant that the jar owns: the two Z planes, the two whole-sprite face UV rects, the
// four span sides with their Directions and pixel offsets, which two of them run horizontally,
// and the switch case each one takes are all LOADED. If the jar disagrees with this port, the
// table changes and this file follows it — never the other way round.
//
// The one number this file does own is the alpha rule, and it is asserted rather than assumed:
// vanilla's `isTransparent` is `((argb >> 24) & 255) == 0` — **alpha exactly zero**, not a
// threshold. A threshold would eat the soft edge of every antialiased sprite and the ring of
// side quads would sit one pixel in from the silhouette.
//
// WHAT IT PRODUCES: vanilla `elements`, the same shape `resolveModel()` returns for a block, so
// they go through `bakelib.bakeModel` — **the same baker, the same winding rule, the same UV
// rotation** as every block in the game. That is the whole reason this file stops at elements
// and does not emit quads: a second copy of `faceCorners` is D-314 waiting to happen, and D-314
// has already cost this project two sessions.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TSV = join(ROOT, 'tools', 'golden', 'itemmodel-1.18.2.tsv');

function loadTable() {
  const rows = readFileSync(TSV, 'utf8').trim().split('\n').slice(1).map((l) => l.split('\t'));
  const planes = rows.find((r) => r[0] === 'plane');
  if (!planes) throw new Error('itemmodel table has no plane row');
  const faces = rows.filter((r) => r[0] === 'face')
    .map((r) => ({ dir: r[1].toLowerCase(), uv: r[2].split(',').map(Number) }));
  const sides = rows.filter((r) => r[0] === 'side').map((r) => {
    const [dx, dy] = r[3].split(',').map(Number);
    const [orient, kase] = r[4].split(',');
    return { name: r[1], dir: r[2].toLowerCase(), dx, dy, horiz: orient === 'horiz', case: Number(kase) };
  });
  if (faces.length !== 2) throw new Error('itemmodel table has ' + faces.length + ' faces, not 2');
  if (sides.length !== 4) throw new Error('itemmodel table has ' + sides.length + ' sides, not 4');
  const cases = new Set(sides.map((s) => s.case));
  if (cases.size !== 4) throw new Error('itemmodel table switch cases are not a permutation');
  return { front: Number(planes[2]), back: Number(planes[4]), faces, sides };
}

export const TABLE = loadTable();

/** vanilla `isTransparent`: alpha EXACTLY zero, and anything off the sprite counts as transparent. */
function transparent(rgba, w, h, x, y) {
  if (x < 0 || y < 0 || x >= w || y >= h) return true;
  return rgba[(y * w + x) * 4 + 3] === 0;
}

/**
 * `getSpans` — walk every pixel, and for each of the four sides ask whether the neighbour on
 * that side is transparent while this pixel is not. Runs of such pixels sharing a side and an
 * anchor are MERGED, which is what keeps a 16x16 sprite at tens of quads rather than hundreds.
 *
 * ⚠ The merge is `min`/`max` on the run coordinate, so a side whose opaque pixels are broken by
 * a gap comes out as ONE span spanning the gap — vanilla's own behaviour, not a simplification.
 * A `Set`-per-anchor would be more "correct" and would not be vanilla.
 */
function spansOf(rgba, w, h) {
  const spans = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const opaque = !transparent(rgba, w, h, x, y);
      for (const side of TABLE.sides) {
        if (!(opaque && transparent(rgba, w, h, x + side.dx, y + side.dy))) continue;
        const anchor = side.horiz ? y : x;
        const run = side.horiz ? x : y;
        let s = spans.find((z) => z.side === side && z.anchor === anchor);
        if (!s) spans.push({ side, min: run, max: run, anchor });
        else if (run < s.min) s.min = run; else if (run > s.max) s.max = run;
      }
    }
  }
  return spans;
}

/**
 * The whole model of one sprite layer, as vanilla elements.
 *
 * @param rgba     Uint8Array/Buffer of w*h*4
 * @param texture  the texture id the faces reference (whatever `tileOf` will be given)
 * @param tint     the face tintindex, or -1
 */
export function spriteElements(rgba, w, h, texture, tint) {
  const { front, back, faces, sides } = TABLE;
  const els = [];

  // the sprite itself: one element spanning the whole tile, front and back, no cullface
  const whole = {};
  for (const f of faces) whole[f.dir] = { texture, uv: f.uv.slice(), tintindex: tint, rotation: 0 };
  els.push({ from: [0, 0, front], to: [16, 16, back], faces: whole, rotation: null, shade: true });

  const xs = 16 / w, ys = 16 / h;
  for (const s of spansOf(rgba, w, h)) {
    const lo = s.min, hi = s.max + 1, an = s.anchor;
    let x1, x2, y1, y2, u1, u2, v1, v2;
    switch (s.side.case) {
      case 1: x1 = u1 = lo; x2 = u2 = hi; y1 = v1 = an; y2 = an; v2 = an + 1; break;
      case 2: v1 = an; v2 = an + 1; x1 = u1 = lo; x2 = u2 = hi; y1 = an + 1; y2 = an + 1; break;
      case 3: x1 = u1 = an; x2 = an; u2 = an + 1; y1 = v2 = lo; y2 = v1 = hi; break;
      case 4: u1 = an; u2 = an + 1; x1 = an + 1; x2 = an + 1; y1 = v2 = lo; y2 = v1 = hi; break;
      default: throw new Error('span side ' + s.side.name + ' has no case');
    }
    // ⚠ THE Y FLIP IS ON THE POSITION AND NOT ON THE UV. Texture rows run downwards and model Y
    // runs upwards, so `16 - y` turns one into the other; the UV is already in texture space and
    // must not be flipped again. Flip both and every side quad lands on the wrong edge, which
    // reads as a sprite with its outline a pixel out on two sides only.
    x1 *= xs; x2 *= xs; y1 = 16 - y1 * ys; y2 = 16 - y2 * ys;
    u1 *= xs; u2 *= xs; v1 *= ys; v2 *= ys;

    const face = { texture, uv: [u1, v1, u2, v2], tintindex: tint, rotation: 0 };
    let from, to;
    switch (s.side.case) {
      case 1: from = [x1, y1, front]; to = [x2, y1, back]; break;
      case 2: from = [x1, y2, front]; to = [x2, y2, back]; break;
      case 3: from = [x1, y1, front]; to = [x1, y2, back]; break;
      case 4: from = [x2, y1, front]; to = [x2, y2, back]; break;
    }
    els.push({ from, to, faces: { [s.side.dir]: face }, rotation: null, shade: true });
  }
  return els;
}

export { spansOf };
