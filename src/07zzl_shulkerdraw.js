// 07zzl_shulkerdraw.js — D-773 cloud unit (tender-carson-7zokog): THE SHULKER AS VANILLA DRAWS IT.
// Runs on: MAIN THREAD ONLY. Pure per-entity state + arithmetic; `07j_entityrender.js` reads it.
//
// Ported off .decomp, each read whole this unit:
//   - `client/render/entity/model/ShulkerEntityModel.java` — the three parts (lid/base/head, the
//     boxes themselves are already `tools/golden/models-1.18.2.tsv` rows 773-775, extracted from
//     the jar, never typed here) and `method_17122` (setAngles): the lid's pivot rise + wobble +
//     twist driven by `getOpenProgress`, the head's pitch/yaw.
//   - `client/render/entity/ShulkerEntityRenderer.java` — `method_4114` (setupTransforms):
//     `super.setupTransforms(yaw + 180)`, then about the block centre `translate(0,.5,0);
//     multiply(attachedFace.getOpposite().getRotationQuaternion()); translate(0,-.5,0)`;
//     `method_23189` (getPositionOffset): the 6-tick teleport slide (`method_33352`); and the
//     texture: `getTexture(null)` = `entity/shulker/shulker.png`, the base sheet the mob atlas
//     already packs under the `shulker` layer name.
//   - `client/render/entity/feature/ShulkerHeadFeatureRenderer.java` — the head is drawn with the
//     SAME model/texture in a second pass; drawing all three parts in one pass is the same picture.
//   - `entity/mob/ShulkerEntity.java` — `tickOpenProgress` (±0.05/tick toward peek*0.01),
//     `getOpenProgress(partial)` (a plain lerp), `setPosition`'s client lerp trigger + `tick()`'s
//     countdown, `ShulkerBodyControl` (tick is empty: the body never turns; `initialize` sets
//     yaw 0), `getMaxHeadRotation`/`getMaxLookPitchChange` = 180 (already `Ai.HEAD_LIMITS`).
//   - `util/math/Direction.java` `getRotationQuaternion`, `Quaternion.java` (axis-angle ctor,
//     `hamiltonProduct`), `Matrix3f.java` (quaternion ctor) — the face rotation is COMPUTED from
//     those three, never a hand-written matrix.
(function (NS) {
  'use strict';
  var SD = NS.ShulkerDraw = { ready: false };

  // ── the face rotation: Direction.getRotationQuaternion, as a 3x3 row-major matrix ──────────
  function quat(ax, ay, az, deg) {   // `new Quaternion(Vec3f axis, deg, true)`
    var a = deg * (Math.PI / 180), s = Math.sin(a / 2);
    return [ax * s, ay * s, az * s, Math.cos(a / 2)];
  }
  function hamilton(q, r) {          // `q.hamiltonProduct(r)` (q = q*r), verbatim
    var x = q[0], y = q[1], z = q[2], w = q[3], rx = r[0], ry = r[1], rz = r[2], rw = r[3];
    return [w * rx + x * rw + y * rz - z * ry,
            w * ry - x * rz + y * rw + z * rx,
            w * rz + x * ry - y * rx + z * rw,
            w * rw - x * rx - y * ry - z * rz];
  }
  function mat(q) {                  // `new Matrix3f(Quaternion)`, verbatim
    var x = q[0], y = q[1], z = q[2], w = q[3];
    var xx = 2 * x * x, yy = 2 * y * y, zz = 2 * z * z;
    var xy = x * y, yz = y * z, zx = z * x, xw = x * w, yw = y * w, zw = z * w;
    return [1 - yy - zz, 2 * (xy - zw), 2 * (zx + yw),
            2 * (xy + zw), 1 - zz - xx, 2 * (yz - xw),
            2 * (zx - yw), 2 * (yz + xw), 1 - xx - yy];
  }
  /** `Direction.getRotationQuaternion()` for dir in `Direction.values()` order (D,U,N,S,W,E). */
  SD.rotationQuaternion = function (dir) {
    var base = quat(1, 0, 0, 90);
    switch (dir) {
      case 0: return quat(1, 0, 0, 180);
      case 1: return [0, 0, 0, 1];
      case 2: return hamilton(base, quat(0, 0, 1, 180));
      case 3: return base;
      case 4: return hamilton(base, quat(0, 0, 1, 90));
      default: return hamilton(base, quat(0, 0, 1, -90));
    }
  };
  var FACE_MAT = [];
  for (var d = 0; d < 6; d++) FACE_MAT.push(mat(SD.rotationQuaternion(d)));
  /** The matrix `setupTransforms` multiplies by: the ATTACHED face's OPPOSITE (`d ^ 1` in
   *  D,U,N,S,W,E order — `Direction.getOpposite`'s own pairing). Floor-attached is identity. */
  SD.faceMatrix = function (attachedFace) {
    var f = (attachedFace === undefined || attachedFace === null) ? 0 : attachedFace;
    return FACE_MAT[(f ^ 1)];
  };
  SD.FACE_CENTRE_Y = 0.5;   // `translate(0, 0.5, 0)` around the multiply, in blocks

  // ── open progress: ShulkerEntity.tickOpenProgress / getOpenProgress ────────────────────────
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  SD.tickOpenProgress = function (e) {
    var cur = e.shulkerOpen || 0;
    e.shulkerOpenO = cur;
    var want = (e.shulkerPeek || 0) * 0.01;
    if (cur === want) return false;
    e.shulkerOpen = cur > want ? clamp(cur - 0.05, want, 1) : clamp(cur + 0.05, 0, want);
    return true;
  };
  SD.openProgress = function (e, partial) {
    var o = e.shulkerOpenO === undefined ? (e.shulkerOpen || 0) : e.shulkerOpenO;
    return o + ((e.shulkerOpen || 0) - o) * partial;
  };

  // ── the teleport slide: setPosition's lerp trigger, tick()'s countdown, method_33352 ───────
  SD.LERP_TICKS = 6;
  /** One tick. Vanilla order in `tick()`: attach/teleport and tickOpenProgress, then the
   *  client-side countdown; the block change is caught here (after the goals moved it) the
   *  way the client's `setPosition` catches it when the position arrives. */
  SD.tick = function (e) {
    var moved = SD.tickOpenProgress(e);
    if (e.shulkerLerp > 0) e.shulkerLerp--;
    else e.shulkerPrevBlock = null;
    var bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
    var last = e.shulkerBlock;
    e.shulkerBlock = [bx, by, bz];
    if (!last || e.age <= 1 || e.vehicle || e.riding) return moved;
    if (last[0] === bx && last[1] === by && last[2] === bz) return moved;
    var pb = e.shulkerPrevBlock;
    if (pb && pb[0] === bx && pb[1] === by && pb[2] === bz) return moved;
    e.shulkerPrevBlock = last;
    e.shulkerLerp = SD.LERP_TICKS;
    return moved;
  };
  /** `method_33352(partial)`: where the drawn shulker sits relative to its real position while
   *  it slides in from the block it left, or null. */
  SD.lerpOffset = function (e, partial) {
    var pb = e.shulkerPrevBlock;
    if (!pb || !(e.shulkerLerp > 0)) return null;
    var t = (e.shulkerLerp - partial) / 6.0;
    t *= t;
    return [-(Math.floor(e.x) - pb[0]) * t, -(Math.floor(e.y) - pb[1]) * t, -(Math.floor(e.z) - pb[2]) * t];
  };

  // ── ShulkerBodyControl: `tick()` is empty, the body never turns ─────────────────────────────
  SD.BodyControl = function () { this.tick = function () {}; };

  /** What `ER.animOf` hands the model for a shulker. `headYawRad` is the interpolated head
   *  yaw in this engine's own heading convention (`e.yHeadRot`), which is vanilla's
   *  `headYaw - 180` in radians — exactly `setAngles`' `headYaw - 180 - bodyYaw` with
   *  `bodyYaw` pinned at 0. */
  SD.animOf = function (e, partial, ageInTicks, headYawRad) {
    return { open: SD.openProgress(e, partial), age: ageInTicks, headYaw: headYawRad,
             R: SD.faceMatrix(e.shulkerFace) };
  };

  /** `ShulkerEntityModel.method_17122`, as this renderer's `{rx,ry,rz,dpy}` delta off the REST
   *  pose (lid rest py 24, `models-1.18.2.tsv` row 775; head/lid rest angles 0). */
  SD.delta = function (partName, sh, headPitchDeg) {
    if (partName === 'lid') {
      var a = (0.5 + sh.open) * Math.PI;
      var twist = -1 + Math.sin(a);
      var wob = a > Math.PI ? Math.sin(sh.age * 0.1) * 0.7 : 0;
      return { rx: 0, ry: sh.open > 0.3 ? twist * twist * twist * twist * Math.PI * 0.125 : 0, rz: 0,
               dpy: (16 + Math.sin(a) * 8 + wob) - 24 };
    }
    if (partName === 'head') {
      return { rx: headPitchDeg * (Math.PI / 180), ry: sh.headYaw, rz: 0 };
    }
    return null;   // base: never posed
  };

  SD.OWED = [
    'shouldRender\'s teleport-lerp frustum extension -- this renderer does no per-entity frustum test'
  ];

  SD.ready = true;
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
