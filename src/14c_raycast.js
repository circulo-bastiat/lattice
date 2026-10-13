// 14c_raycast.js — voxel DDA for block targeting. Main thread only, no DOM.
//
// Amanatides & Woo, not a sampling loop. A sampling loop with a fixed step misses thin geometry,
// gives the wrong face at grazing angles (which puts placed blocks on the wrong side of a wall),
// and costs more: this visits each cell exactly once and knows the entry face for free.

(function (NS) {
  'use strict';

  var R = NS.Ray = {
    // one reusable result object — targeting runs every frame and must not allocate
    hit: { x: 0, y: 0, z: 0, face: 0, id: 0, dist: 0, hx: 0, hy: 0, hz: 0 },
    steps: 0,
    // how many cells needed the slab-method test rather than the cell answer. Zero for a
    // world of full cubes, which is the whole claim the identity check below makes; `steps`
    // exists for the same reason. Both are counters, not state — nothing reads them but tests
    // and the F3 overlay.
    shapeTests: 0
  };

  /**
   * The face of the block we ENTERED through, in ARCH §3 numbering
   * (0 +X, 1 -X, 2 +Y, 3 -Y, 4 +Z, 5 -Z).
   * Stepping in +X enters the next cell through its -X face, hence face 1. Getting this table
   * backwards is what makes placed blocks appear inside the wall you clicked.
   */
  var ENTER_FACE = [1, 0, 3, 2, 5, 4];   // indexed [axis*2 + (step<0 ? 1 : 0)]

  /** Default predicate: what the crosshair can target. Fluids are see-through, air is not there. */
  R.targetable = function (id) {
    if (id === 0) return false;
    // fluids are not targetable. Asked per BLOCK, not per state: every one of water's 16
    // levels and lava's 16 is still a fluid.
    var R = NS.Reg, b = NS.States.block[id];
    return b !== R.id.water && b !== R.id.lava;
  };

  /**
   * cast(ox,oy,oz, dx,dy,dz, maxDist, pred) -> hit | null
   *
   * (dx,dy,dz) need not be normalised; distances are reported along the ray in units of that
   * vector's length, so pass a unit vector if you want blocks.
   * The returned object is REUSED. Copy what you need before the next call (same contract as
   * Gen.columnAt — ARCH §6b rule 2).
   */
  // `shapeStart` (the arrow's COLLIDER raycast, `Cb.arrowRaycast`): test the start cell's real
  // shape instead of reporting it whole -- a point above a slab, in the slab's cell, is not in it.
  R.cast = function (ox, oy, oz, dx, dy, dz, maxDist, pred, shapeStart) {
    pred = pred || R.targetable;
    var W = NS.World;

    var x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);

    // The eye can already be inside a targetable block (standing in tall grass). Report it with
    // the face the ray is leaving through inverted, so placement still has somewhere to go.
    var id0 = W.getBlock(x, y, z);
    if (pred(id0)) {
      var s0 = shapeStart && NS.Physics ? R.shapeAt(id0, x, y, z) : null;
      if (!s0 || s0 === NS.Physics.FULL_CUBE) return fill(x, y, z, dominantFace(dx, dy, dz), id0, 0, ox, oy, oz);
      var h0 = hitShape(ox, oy, oz, dx, dy, dz, x, y, z, s0, maxDist);
      if (h0) return fill(x, y, z, h0.face, id0, h0.t, ox + dx * h0.t, oy + dy * h0.t, oz + dz * h0.t);
    }

    var stepX = dx > 0 ? 1 : (dx < 0 ? -1 : 0);
    var stepY = dy > 0 ? 1 : (dy < 0 ? -1 : 0);
    var stepZ = dz > 0 ? 1 : (dz < 0 ? -1 : 0);

    var INF = Infinity;
    var tDeltaX = stepX ? Math.abs(1 / dx) : INF;
    var tDeltaY = stepY ? Math.abs(1 / dy) : INF;
    var tDeltaZ = stepZ ? Math.abs(1 / dz) : INF;

    var tMaxX = stepX > 0 ? (x + 1 - ox) / dx : (stepX < 0 ? (x - ox) / dx : INF);
    var tMaxY = stepY > 0 ? (y + 1 - oy) / dy : (stepY < 0 ? (y - oy) / dy : INF);
    var tMaxZ = stepZ > 0 ? (z + 1 - oz) / dz : (stepZ < 0 ? (z - oz) / dz : INF);

    var t = 0, face = 0;
    // maxDist blocks of travel means at most 3*maxDist+3 cell crossings; the bound is a guard
    // against a NaN direction turning this into an infinite loop, not a distance limit.
    var guard = (maxDist * 3 + 8) | 0;
    R.steps = 0;
    R.shapeTests = 0;

    while (guard-- > 0) {
      if (tMaxX < tMaxY) {
        if (tMaxX < tMaxZ) { x += stepX; t = tMaxX; tMaxX += tDeltaX; face = ENTER_FACE[stepX < 0 ? 1 : 0]; }
        else               { z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; face = ENTER_FACE[4 + (stepZ < 0 ? 1 : 0)]; }
      } else {
        if (tMaxY < tMaxZ) { y += stepY; t = tMaxY; tMaxY += tDeltaY; face = ENTER_FACE[2 + (stepY < 0 ? 1 : 0)]; }
        else               { z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; face = ENTER_FACE[4 + (stepZ < 0 ? 1 : 0)]; }
      }
      if (t > maxDist) return null;
      R.steps++;
      var id = W.getBlock(x, y, z);
      if (pred(id)) {
        // ── real shapes ──────────────────────────────────────────────────────────────
        // The DDA finds the CELL. For a full cube that is the answer, and the identity
        // test below means every block in the world today takes exactly the path it
        // always did. For a slab or a fence the cell is mostly empty, and the crosshair
        // must not select a block through the gap above a slab.
        var shape = R.shapeAt(id, x, y, z);
        if (!shape || shape === (NS.Physics && NS.Physics.FULL_CUBE)) {
          return fill(x, y, z, face, id, t, ox + dx * t, oy + dy * t, oz + dz * t);
        }
        var h = hitShape(ox, oy, oz, dx, dy, dz, x, y, z, shape, maxDist);
        if (h) return fill(x, y, z, h.face, id, h.t, ox + dx * h.t, oy + dy * h.t, oz + dz * h.t);
        // the ray passed through the empty part of the cell; keep stepping
      }
    }
    return null;
  };

  /**
   * Slab-method ray/AABB intersection against a cell's real collision boxes.
   *
   * Returns the nearest entry along the ray and the FACE of the box that was entered, in
   * the same convention the DDA uses, so `fill` and everything downstream cannot tell the
   * difference. Returns null when the ray misses every box — which is the whole point: a
   * ray passing over a slab must keep going instead of selecting it.
   */
  function hitShape(ox, oy, oz, dx, dy, dz, cx, cy, cz, boxes, maxDist) {
    R.shapeTests++;
    var bestT = Infinity, bestFace = 0;
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      // ⚠ CLAMPED TO THE CELL. A fence's collision box is 1.5 blocks tall and pokes into the
      // cell above; without this clamp a ray from overhead reports a hit at y=1.5 — a point
      // the DDA had already passed, in a cell it had already rejected — and the crosshair
      // selects a post through the block standing on it. Vanilla keeps collision and outline
      // shapes apart for exactly this reason; the clamp is the cheap way to the same place,
      // and it is a no-op for every box that already fits inside its cell.
      if (!clampBox(b, CB)) continue;
      var lo = [cx + CB[0], cy + CB[1], cz + CB[2]];
      var hi = [cx + CB[3], cy + CB[4], cz + CB[5]];
      var d = [dx, dy, dz], o = [ox, oy, oz];
      var tMin = 0, tMax = maxDist, axis = -1, neg = false, bad = false;
      for (var a = 0; a < 3; a++) {
        if (d[a] === 0) {
          // parallel to this pair of planes: either always inside them or never
          if (o[a] < lo[a] || o[a] > hi[a]) { bad = true; break; }
          continue;
        }
        var inv = 1 / d[a];
        var t1 = (lo[a] - o[a]) * inv, t2 = (hi[a] - o[a]) * inv;
        var enterNeg = false;
        if (t1 > t2) { var tmp = t1; t1 = t2; t2 = tmp; enterNeg = true; }
        if (t1 > tMin) { tMin = t1; axis = a; neg = enterNeg; }
        if (t2 < tMax) tMax = t2;
        if (tMin > tMax) { bad = true; break; }
      }
      if (bad || tMin > maxDist) continue;
      if (tMin < bestT) {
        bestT = tMin;
        // axis -1 means the ray started inside the box; report the face it is heading
        // through, which is what the cell-level path does for that case too.
        bestFace = axis < 0 ? dominantFace(dx, dy, dz) : ENTER_FACE[axis * 2 + (neg ? 1 : 0)];
      }
    }
    return bestT === Infinity ? null : { t: bestT, face: bestFace };
  }

  /**
   * `World.raycast(RaycastContext(from, to, COLLIDER, FluidHandling.NONE))` == MISS inverted: true when the
   * segment hits any COLLISION box (`Physics.shapesForState`, UNclamped: a fence's 1.5 post counts in the cell
   * the ray crosses). Cell walk is the vanilla BlockView.raycast one; air and shapeless blocks never hit.
   */
  R.colliderHit = function (ox, oy, oz, tx, ty, tz) {
    var W = NS.World, Ph = NS.Physics;
    var d = [tx - ox, ty - oy, tz - oz], o = [ox, oy, oz];
    var len = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
    if (len === 0) return false;
    var cell = [Math.floor(ox), Math.floor(oy), Math.floor(oz)], end = [Math.floor(tx), Math.floor(ty), Math.floor(tz)];
    var step = [0, 0, 0], tMax = [Infinity, Infinity, Infinity], tDel = [Infinity, Infinity, Infinity], a;
    for (a = 0; a < 3; a++) {
      step[a] = d[a] > 0 ? 1 : d[a] < 0 ? -1 : 0;
      if (step[a]) { tDel[a] = Math.abs(1 / d[a]); tMax[a] = (step[a] > 0 ? cell[a] + 1 - o[a] : cell[a] - o[a]) / d[a]; }
    }
    for (var guard = 0; guard < 4096; guard++) {
      var st = W.getBlock(cell[0], cell[1], cell[2]);
      if (st !== 0) {
        var boxes = Ph.shapesForState(st);
        if (boxes && boxExit(o, d, cell, boxes)) return true;
      }
      if (cell[0] === end[0] && cell[1] === end[1] && cell[2] === end[2]) return false;
      a = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : (tMax[1] < tMax[2] ? 1 : 2);
      if (tMax[a] > 1) return false;
      cell[a] += step[a]; tMax[a] += tDel[a];
    }
    return false;
  };
  function boxExit(o, d, c, boxes) {
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i], t0 = 0, t1 = 1, ok = true;
      for (var a = 0; a < 3 && ok; a++) {
        var lo = c[a] + b[a], hi = c[a] + b[a + 3];
        if (d[a] === 0) { if (o[a] < lo || o[a] > hi) ok = false; continue; }
        var u = (lo - o[a]) / d[a], v = (hi - o[a]) / d[a];
        if (u > v) { var q = u; u = v; v = q; }
        if (u > t0) t0 = u;
        if (v < t1) t1 = v;
        if (t0 > t1) ok = false;
      }
      if (ok) return true;
    }
    return false;
  }

  // #4693 -- the per-position model offset the mesher draws with.
  var OFFV = [0, 0, 0], OFF0 = [0, 0, 0];
  /** The boxes (world-offset, cell-local) a ray tests and the outline draws for the block at x,y,z; null = whole cell. */
  R.shapeAt = function (id, x, y, z) {
    var S = NS.States, Ph = NS.Physics, shape = selShape(id);
    if (!shape || shape === (Ph && Ph.FULL_CUBE) || !S.modelOffset(id, x, z, OFFV)) return shape;
    // the vanilla table was extracted at BlockPos.ZERO, so it already carries that position's offset: swap it for this one's
    S.modelOffset(id, 0, 0, OFF0);
    var dx = OFFV[0] - OFF0[0], dy = OFFV[1] - OFF0[1], dz = OFFV[2] - OFF0[2], out = [];
    for (var i = 0; i < shape.length; i++) {
      var b = shape[i];
      out.push([b[0] + dx, b[1] + dy, b[2] + dz, b[3] + dx, b[4] + dy, b[5] + dz]);
    }
    return out;
  };
  var outlineCache = new Map();
  /**
   * #4944 (was #4692 for vine / lichen): targeting reads the OUTLINE (`getShape`), not the collision shape. The vanilla
   * outline is `Reg.outlineShape` (tools/shapetable.mjs, from the bytecode); a state with no override outlines as its
   * collision shape, which is vanilla's default. An EMPTY vanilla outline (air, light, ...) answers null = the whole cell,
   * as this engine always did. A full cube answers `Physics.FULL_CUBE` by identity, the fast path.
   */
  function selShape(id) {
    var Ph = NS.Physics, o = outlineCache.get(id);
    if (o === undefined) {
      var t = NS.Reg.outlineShape(id), b = t && t[0];
      if (!t) return Ph && Ph.shapeOf ? Ph.shapeOf(id) : null;   // not cached: the collision shape is Physics' to cache
      o = !b ? null
        : t.length === 1 && b[0] === 0 && b[1] === 0 && b[2] === 0 && b[3] === 1 && b[4] === 1 && b[5] === 1 ? Ph.FULL_CUBE : t;
      outlineCache.set(id, o);
    }
    return o;
  }

  var CB = [0, 0, 0, 0, 0, 0];   // scratch for clampBox; targeting must not allocate

  /**
   * A collision box clipped to its own cell, written into `out`. Returns false when nothing of
   * the box is left, which happens for no box in the 1.18.2 registry but would for a shape
   * defined entirely outside its cell. `out` may be the caller's scratch — nothing is kept.
   */
  function clampBox(b, out) {
    out[0] = b[0] > 0 ? b[0] : 0; out[1] = b[1] > 0 ? b[1] : 0; out[2] = b[2] > 0 ? b[2] : 0;
    out[3] = b[3] < 1 ? b[3] : 1; out[4] = b[4] < 1 ? b[4] : 1; out[5] = b[5] < 1 ? b[5] : 1;
    return out[0] < out[3] && out[1] < out[4] && out[2] < out[5];
  }

  /**
   * The boxes the SELECTION OUTLINE should be drawn from, for the block the crosshair is on.
   *
   * This lives here rather than in the HUD because it must be the same clamp `hitShape` used —
   * an outline that disagrees with what a click selects is worse than no outline, since it
   * teaches the player the wrong aim point. A full cube answers with `Ray.UNIT_BOX` by
   * identity, so the HUD's common path allocates nothing and looks exactly as it always has.
   *
   * Returns null for a block with no shape at all (a flower), which the HUD draws as a cube —
   * there is nothing else it could draw, and the block is still breakable.
   */
  R.UNIT_BOX = [[0, 0, 0, 1, 1, 1]];
  R.selectionBoxes = function (id, x, y, z) {
    var Ph = NS.Physics;
    var shape = x === undefined ? selShape(id) : R.shapeAt(id, x, y, z);
    if (!shape || shape === (Ph && Ph.FULL_CUBE) || shape.length === 0) return R.UNIT_BOX;
    var out = [];
    for (var i = 0; i < shape.length; i++) {
      var o = [0, 0, 0, 0, 0, 0];
      if (clampBox(shape[i], o)) out.push(o);
    }
    return out.length ? out : R.UNIT_BOX;
  };

  function fill(x, y, z, face, id, dist, hx, hy, hz) {
    var h = R.hit;
    h.x = x; h.y = y; h.z = z; h.face = face; h.id = id; h.dist = dist;
    h.hx = hx; h.hy = hy; h.hz = hz;
    return h;
  }

  /** Face most opposed to the ray, for the degenerate "eye is inside the block" case. */
  function dominantFace(dx, dy, dz) {
    var ax = dx < 0 ? -dx : dx, ay = dy < 0 ? -dy : dy, az = dz < 0 ? -dz : dz;
    if (ax >= ay && ax >= az) return dx > 0 ? 1 : 0;
    if (ay >= az) return dy > 0 ? 3 : 2;
    return dz > 0 ? 5 : 4;
  }

  /**
   * castFromCamera(cam, maxDist, pred) — a cast along the CAMERA's own forward vector.
   *
   * ⚠ Session 4's audit: this comment used to say "the one the game actually calls", and nothing
   * calls it. `Player.retarget` writes the forward vector out by hand from the PLAYER's yaw and
   * pitch instead. The two agree today because the camera takes its angles from the player every
   * frame — and that is now asserted rather than assumed (`raycheck`: the player's inline
   * formula against `Cam.forward`, over a spread of angles), because if they ever drift apart
   * the symptom is a fast flick placing a block on the wrong wall, which is the exact bug the
   * comment above `retarget` was written about.
   */
  R.castFromCamera = function (cam, maxDist, pred) {
    var f = NS.Cam.forward(cam);
    return R.cast(cam.x, cam.y, cam.z, f[0], f[1], f[2], maxDist, pred);
  };

  /** The block adjacent to a hit, on the side the ray came from. Where a placed block goes. */
  R.neighbourOf = function (hit, out) {
    var C = NS.CFG;
    out = out || { x: 0, y: 0, z: 0 };
    out.x = hit.x + C.FACE_DX[hit.face];
    out.y = hit.y + C.FACE_DY[hit.face];
    out.z = hit.z + C.FACE_DZ[hit.face];
    return out;
  };
})(MCL);
