// bakelib.mjs — turning a resolved model into quads. Shared by blocks and items.
//
// Extracted from bake-geometry.mjs when tools/extract-items.mjs needed exactly the same
// thing for the 558 items whose model IS a block model. Two copies of this would be two
// chances for a rotation convention to drift, and the whole point of models.mjs's rotation
// note is that a drift here is invisible on stone and wrong on everything else.

import { rotatePoint, rotateDir, steps, DIRS } from './models.mjs';

// ---------------------------------------------------------------- element rotation
// The non-90-degree kind, declared inside an element. Crosses use 45, rails use 22.5.
// `rescale` stretches the result back out to the unit cell, which is what stops a rotated
// rail from shrinking away from its neighbours.
function applyElementRotation(p, rot) {
  if (!rot || !rot.angle) return p;
  const a = (rot.angle * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  const o = rot.origin;
  let [x, y, z] = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
  if (rot.axis === 'x') { const ny = y * c - z * s, nz = y * s + z * c; y = ny; z = nz; }
  else if (rot.axis === 'y') { const nx = x * c + z * s, nz = -x * s + z * c; x = nx; z = nz; }
  else { const nx = x * c - y * s, ny = x * s + y * c; x = nx; y = ny; }
  if (rot.rescale) {
    const k = 1 / Math.cos(a);
    if (rot.axis === 'x') { y *= k; z *= k; }
    else if (rot.axis === 'y') { x *= k; z *= k; }
    else { x *= k; y *= k; }
  }
  return [x + o[0], y + o[1], z + o[2]];
}

// The four corners of a face, in vanilla's winding, in model space (0..16).
// Order matters: it decides the front side, and getting it wrong makes half the world
// invisible from one direction only, which is the most confusing bug in this whole area.
function faceCorners(from, to, dir) {
  const [x1, y1, z1] = from, [x2, y2, z2] = to;
  switch (dir) {
    case 'down':  return [[x1, y1, z2], [x2, y1, z2], [x2, y1, z1], [x1, y1, z1]];
    case 'up':    return [[x1, y2, z1], [x2, y2, z1], [x2, y2, z2], [x1, y2, z2]];
    case 'north': return [[x2, y2, z1], [x1, y2, z1], [x1, y1, z1], [x2, y1, z1]];
    case 'south': return [[x1, y2, z2], [x2, y2, z2], [x2, y1, z2], [x1, y1, z2]];
    case 'west':  return [[x1, y2, z1], [x1, y2, z2], [x1, y1, z2], [x1, y1, z1]];
    case 'east':  return [[x2, y2, z2], [x2, y2, z1], [x2, y1, z1], [x2, y1, z2]];
    default: throw new Error('bad dir ' + dir);
  }
}

// UVs for the four corners, in the same order, from the face's [u1,v1,u2,v2] rect.
function faceUvs(uv, rotation) {
  const [u1, v1, u2, v2] = uv;
  let c = [[u1, v1], [u2, v1], [u2, v2], [u1, v2]];
  const r = (((rotation || 0) / 90) | 0) % 4;
  for (let i = 0; i < r; i++) c = [c[3], c[0], c[1], c[2]];
  return c;
}

/**
 * uvlock. Vanilla's rule, stated plainly because it is the most-skipped part of the format:
 * when a model is rotated by the blockstates x/y and `uvlock` is true, the TEXTURE must
 * stay put while the geometry turns. Mojang implements it by applying the inverse rotation
 * to the UVs of the faces whose plane the rotation actually turns.
 *
 *   - a y rotation turns the up and down faces in their own plane, so their UVs rotate back
 *   - an x rotation turns north/south/east/west similarly
 *
 * The net effect is a multiple of 90 degrees of UV rotation on exactly those faces.
 */
function uvlockRotation(dir, x, y) {
  const sx = steps(x), sy = steps(y);
  let r = 0;
  if (sy) { if (dir === 'up') r -= sy; else if (dir === 'down') r += sy; }
  if (sx) { if (dir === 'north' || dir === 'south' || dir === 'east' || dir === 'west') r -= sx; }
  return ((r % 4) + 4) % 4;
}


/**
 * Bake one resolved model at a placement rotation into flat quads.
 *
 * @param model     from resolveModel()
 * @param x,y       the blockstates placement rotation, in degrees
 * @param uvlock    whether the texture stays put while the geometry turns
 * @param tileOf    (textureId) -> atlas tile index, or undefined if it is not in the atlas
 * @param stats     optional counters object, mutated
 *
 * ⚠ The returned ARRAY carries one extra property, `quads.uvRotated` (D-181): true when at
 * least one face of this placement was baked with a non-zero UV rotation — vanilla's
 * per-face `rotation` field, plus whatever `uvlock` added on top of it. It is a property of
 * the array and NOT a field on the quads, deliberately: `block-geometry.json` stores the
 * quads verbatim and `tools/pack-geometry.mjs` round-trips them byte for byte, so a new quad
 * field would have to be threaded through the binary layout and the compare. `JSON.stringify`
 * ignores properties hung on an array, so this rides along to the caller and vanishes at the
 * file. `tools/bake-geometry.mjs` collects it into a per-part table of its own.
 */
export function bakeModel(model, x, y, uvlock, tileOf, stats) {
  const rx = x || 0, ry = y || 0;
  const quads = [];
  let uvRotated = false;
  for (const el of model.elements) {
    if (stats && el.rotation && el.rotation.angle) stats.elementRotated = (stats.elementRotated || 0) + 1;
    for (const dir of DIRS) {
      const f = el.faces[dir];
      if (!f) continue;
      const tile = tileOf(f.texture);
      if (tile === undefined) { if (stats) (stats.missingTile = stats.missingTile || new Set()).add(f.texture); continue; }

      const pos = faceCorners(el.from, el.to, dir)
        .map((c) => applyElementRotation(c, el.rotation))
        .map((c) => rotatePoint(c, rx, ry));

      let uvRot = f.rotation || 0;
      if (uvlock) {
        const extra = uvlockRotation(dir, rx, ry);
        if (extra) { uvRot += extra * 90; if (stats) stats.uvlocked = (stats.uvlocked || 0) + 1; }
      }
      const uvs = faceUvs(f.uv, uvRot);
      // D-181: remember that this face's texture is NOT laid out corner-for-corner the way an
      // unrotated face is. The greedy cube path regenerates canonical UVs from the corner
      // index and cannot express this, so a part that contains such a face must take the
      // model stream. Recorded here, at the one place that knows the rotation, rather than
      // re-derived later from the eight baked numbers.
      if (((((uvRot / 90) | 0) % 4) + 4) % 4 !== 0) uvRotated = true;

      if (stats && f.tintindex >= 0) stats.tinted = (stats.tinted || 0) + 1;
      if (stats && !el.shade) stats.unshaded = (stats.unshaded || 0) + 1;

      quads.push({
        d: DIRS.indexOf(rotateDir(dir, rx, ry)),
        cull: f.cullface ? DIRS.indexOf(rotateDir(f.cullface, rx, ry)) : -1,
        t: tile,
        tint: f.tintindex,
        shade: el.shade ? 1 : 0,
        p: pos.flat().map((v) => Math.round(v * 16) / 16),
        uv: uvs.flat().map((v) => Math.round(v * 16) / 16),
      });
    }
  }
  quads.uvRotated = uvRotated;                      // see the note on bakeModel (D-181)
  return quads;
}
