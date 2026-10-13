// 10_camera.js — perspective camera, look direction, frustum extraction (docs/archive/ARCH.md §9).
// Main thread only in practice, but it touches no DOM and no API: it is pure math over MCL.U.mat4.
//
// One camera serves both backends. The ONLY difference between them is the clip-space depth
// convention, carried by cam.zeroToOne (WebGPU true, WebGL2 false) and handled in exactly two
// places: U.mat4.perspective and the near-plane row of extractPlanes (D-3).
//
// ⚠ EVERYTHING HERE IS CAMERA-RELATIVE (D-179). `view`, `viewProj` and `planes` are built
// with the eye at the ORIGIN, never at the camera's world position. The matrices are Float32 —
// that is what a GL uniform takes — and a world-space view matrix carries the camera's position
// in its translation row, so at x = 29,000,000 every plane constant was a 3e7 number quantised
// to about two blocks and the frustum test became noise. Built relative to the eye those numbers
// are all order 1, and the world coordinate never enters a float at all. The price is that the
// caller's world-space box has to be moved into that space first, which aabbVisible does in
// doubles from cam.px/py/pz — the position the planes were built at.

(function (NS) {
  'use strict';

  var C = NS.Cam = {};

  var DEG = Math.PI / 180;
  var HALF_PI = Math.PI * 0.5;

  /**
   * Camera state. Plain object, no prototype: it is poked directly by Gfx every frame and
   * printed by the debug overlay.
   */
  C.create = function () {
    var U = NS.U;
    return {
      x: 0, y: 80, z: 0,
      yaw: 0, pitch: 0,          // radians; yaw 0 looks -Z, +yaw turns right, +pitch looks up
      fov: 70,                   // degrees, vertical
      near: 0.05, far: 512,
      aspect: 1,
      zeroToOne: false,          // set by Gfx from the active backend

      view:     U.mat4.create(),
      proj:     U.mat4.create(),
      viewProj: U.mat4.create(),

      // 6 frustum planes, normalised, packed [nx,ny,nz,d] x 6 in the order
      // left, right, bottom, top, near, far. A point is inside when n.p + d >= 0.
      //
      // ⚠ The plane constant `d` is a distance from the space's ORIGIN, and since D-179 that
      // origin is the EYE, not the world origin: the four side planes pass through the eye so
      // their d is 0, and near/far carry cam.near and cam.far. Nothing here is ever a
      // 30-million-block number, whatever the camera's world coordinate is. Float64 because the
      // extraction is free of a GPU and there is no reason to throw the bits away (D-149).
      planes: new Float64Array(24),

      // The camera position the planes in `planes` were built at, in DOUBLES (D-179). Normally
      // this is just (x, y, z), but F7's frozen frustum deliberately leaves it behind while the
      // camera flies on, and aabbVisible must measure against the frozen eye, not the live one.
      px: 0, py: 0, pz: 0,

      fwd: new Float32Array(3),
      right: new Float32Array(3),
      up: new Float32Array(3)
    };
  };

  /** Clamp pitch just short of straight up/down so the view matrix never degenerates. */
  C.PITCH_LIMIT = HALF_PI - 0.0025;

  C.setLook = function (cam, yaw, pitch) {
    cam.yaw = yaw;
    cam.pitch = pitch < -C.PITCH_LIMIT ? -C.PITCH_LIMIT : (pitch > C.PITCH_LIMIT ? C.PITCH_LIMIT : pitch);
    return cam;
  };

  C.setPos = function (cam, x, y, z) { cam.x = x; cam.y = y; cam.z = z; return cam; };

  /** Unit forward vector for the current yaw/pitch. Written into cam.fwd and returned. */
  C.forward = function (cam) {
    var cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    var cy = Math.cos(cam.yaw),   sy = Math.sin(cam.yaw);
    var f = cam.fwd;
    f[0] = sy * cp; f[1] = sp; f[2] = -cy * cp;
    return f;
  };

  /** Right and up basis vectors (right is horizontal; used by the player's wish-direction). */
  C.basis = function (cam) {
    C.forward(cam);
    var cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
    var r = cam.right; r[0] = cy; r[1] = 0; r[2] = sy;
    var f = cam.fwd, u = cam.up;
    // up = right x forward
    u[0] = r[1]*f[2] - r[2]*f[1];
    u[1] = r[2]*f[0] - r[0]*f[2];
    u[2] = r[0]*f[1] - r[1]*f[0];
    return cam;
  };

  /**
   * update(cam) — rebuild proj, view, viewProj and the 6 frustum planes.
   * Call once per frame after moving the camera; everything downstream reads the results.
   */
  C.update = function (cam) {
    var U = NS.U;
    U.mat4.perspective(cam.proj, cam.fov * DEG, cam.aspect || 1, cam.near, cam.far, !!cam.zeroToOne);
    // ⚠ (0, 0, 0), not (cam.x, cam.y, cam.z) — this is the whole of D-179. The view matrix is
    // rotation only; the translation the caller expects lives in the vertex data instead, as
    // `sectionOrigin − camera` computed in doubles by Gfx.drawList. Everything downstream of
    // here — viewProj, the planes, the two HUD projections and both backends' uniforms — is in
    // that eye-at-the-origin space, and no shader had to change to get it.
    U.mat4.fpsView(cam.view, 0, 0, 0, cam.yaw, cam.pitch);
    // `GameRenderer.renderWorld`: the bob/hurt matrix is multiplied into the PROJECTION, so the whole
    // world view bobs, rolls and tips (#394). `cam.bobM` is null when there is none.
    if (cam.bobM) {
      var pb = C._pb || (C._pb = new Float32Array(16));
      U.mat4.multiply(pb, cam.proj, cam.bobM);
      U.mat4.multiply(cam.viewProj, pb, cam.view);
    } else U.mat4.multiply(cam.viewProj, cam.proj, cam.view);
    C.extractPlanes(cam);
    C.basis(cam);
    return cam;
  };

  /**
   * skyViewProj(cam, out, near, far) — the SAME view rotation, a DIFFERENT far plane (D-304).
   *
   * ⚠ THIS IS NOT `cam.viewProj` AND MUST NOT BE. The world's far plane sits just past the fog
   * wall, which at the Celeron preset is 76.8 blocks — nearer than the sun. The sky pass needs
   * a frustum that contains the celestial bodies at 100 and the disc at 512; every other
   * consumer of `cam.viewProj` needs the tight one, because that is what keeps the fill rate
   * down. So the sky gets its own matrix, built here, from the same yaw and pitch.
   *
   * Eye-relative and translation-free like everything else since D-179: `fpsView` is called at
   * (0, 0, 0), and the sky's geometry is already in that space by construction.
   */
  C.skyViewProj = function (cam, out, near, far) {
    var U = NS.U;
    var proj = C._skyProj || (C._skyProj = new Float32Array(16));
    var view = C._skyView || (C._skyView = new Float32Array(16));
    U.mat4.perspective(proj, cam.fov * DEG, cam.aspect || 1, near, far, !!cam.zeroToOne);
    U.mat4.fpsView(view, 0, 0, 0, cam.yaw, cam.pitch);
    U.mat4.multiply(out, proj, view);
    return out;
  };

  /**
   * Gribb–Hartmann plane extraction straight out of viewProj, then normalised so plane
   * distances are in world units (the AABB test below needs that).
   *
   * m is column-major, so row r is (m[r], m[4+r], m[8+r], m[12+r]).
   *   left = row3 + row0      right = row3 - row0
   *   bottom = row3 + row1    top   = row3 - row1
   *   near = row3 + row2  (GL, z in [-1,1])   or   row2  (WebGPU, z in [0,1])
   *   far  = row3 - row2
   */
  C.extractPlanes = function (cam) {
    var m = cam.viewProj, p = cam.planes;
    // The planes come out of viewProj, so they are in whatever space viewProj is in — which
    // since D-179 is eye-relative. Record WHERE the eye was, because that is the only thing
    // that turns a world-space box into a number these planes can be compared against.
    cam.px = cam.x; cam.py = cam.y; cam.pz = cam.z;
    var r0x=m[0],  r0y=m[4],  r0z=m[8],  r0w=m[12];
    var r1x=m[1],  r1y=m[5],  r1z=m[9],  r1w=m[13];
    var r2x=m[2],  r2y=m[6],  r2z=m[10], r2w=m[14];
    var r3x=m[3],  r3y=m[7],  r3z=m[11], r3w=m[15];

    var set = function (i, a, b, c, d) {
      var l = Math.sqrt(a*a + b*b + c*c);
      if (l < 1e-12) l = 1; else l = 1 / l;
      var o = i * 4;
      p[o] = a*l; p[o+1] = b*l; p[o+2] = c*l; p[o+3] = d*l;
    };

    set(0, r3x+r0x, r3y+r0y, r3z+r0z, r3w+r0w);   // left
    set(1, r3x-r0x, r3y-r0y, r3z-r0z, r3w-r0w);   // right
    set(2, r3x+r1x, r3y+r1y, r3z+r1z, r3w+r1w);   // bottom
    set(3, r3x-r1x, r3y-r1y, r3z-r1z, r3w-r1w);   // top
    if (cam.zeroToOne) set(4, r2x, r2y, r2z, r2w);
    else               set(4, r3x+r2x, r3y+r2y, r3z+r2z, r3w+r2w);   // near
    set(5, r3x-r2x, r3y-r2y, r3z-r2z, r3w-r2w);   // far
    return p;
  };

  /**
   * Axis-aligned box test, centre/extent form so it is 6 planes x 7 flops with no branches
   * inside the loop. Returns false only when the box is fully outside a plane (D-45).
   */
  C.aabbVisible = function (cam, minx, miny, minz, maxx, maxy, maxz) {
    var p = cam.planes;
    // ⚠ The box arrives in WORLD space and the planes live at the EYE (D-179), so it is moved
    // here — in doubles, before anything can round. `minx - ox` is at most a render distance
    // whatever minx is, so the dot product below is a sum of order-1000 numbers at x = 0 and at
    // x = 29,000,000 alike. The old code took the difference INSIDE the dot product, against a
    // float32 plane constant of magnitude 3e7, and the cancellation left about two blocks of
    // noise: at 29,000,000 half of all camera positions culled the entire world.
    var ox = cam.px, oy = cam.py, oz = cam.pz;
    var cx = ((minx - ox) + (maxx - ox)) * 0.5, cy = ((miny - oy) + (maxy - oy)) * 0.5,
        cz = ((minz - oz) + (maxz - oz)) * 0.5;
    var ex = (maxx - minx) * 0.5, ey = (maxy - miny) * 0.5, ez = (maxz - minz) * 0.5;
    for (var i = 0; i < 24; i += 4) {
      var nx = p[i], ny = p[i+1], nz = p[i+2];
      var dist = nx*cx + ny*cy + nz*cz + p[i+3];
      var rad  = (nx < 0 ? -nx : nx)*ex + (ny < 0 ? -ny : ny)*ey + (nz < 0 ? -nz : nz)*ez;
      if (dist + rad < 0) return false;
    }
    return true;
  };

  C.sphereVisible = function (cam, x, y, z, r) {
    var p = cam.planes;
    // world -> eye-relative, in doubles, for the same reason as aabbVisible (D-179)
    var sx = x - cam.px, sy = y - cam.py, sz = z - cam.pz;
    for (var i = 0; i < 24; i += 4) {
      if (p[i]*sx + p[i+1]*sy + p[i+2]*sz + p[i+3] + r < 0) return false;
    }
    return true;
  };

  /** Squared distance from the camera to a point — the sort key for the draw list. */
  C.distSq = function (cam, x, y, z) {
    var dx = x - cam.x, dy = y - cam.y, dz = z - cam.z;
    return dx*dx + dy*dy + dz*dz;
  };
})(MCL);
