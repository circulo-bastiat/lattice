// 07zjd_dolphin.js — #717: the dolphin's MOVEMENT (DolphinEntity ctor + travel), .decomp
// net/minecraft/entity/passive/DolphinEntity.java:76-77,202-214,368-379 and ai/control/AquaticMoveControl.java.
//   * `AquaticMoveControl(this, 85, 10, 0.02F, 0.1F, true)` -> Dolphin.moveControlTick (buoyant +0.005 y in water,
//     yaw <=10 deg/tick, pitch clamp 85 deg and <=5 deg/tick, body/head yaw = yaw, in-water speed = speed*attr*0.02)
//   * `DolphinEntity.travel` -> Dolphin.travelMob (in water: updateVelocity, move, *0.9, -0.005 y with no target)
//   * getActiveEyeHeight 0.3 (Cb.eyeHeightOf), getMaxLookPitchChange / getMaxHeadRotation 1.
// The dolphin's goals are NOT here: they set `e.dolphinNav = {x,y,z,speed}` (the MoveControl target) and this consumes it.
(function (NS) {
  'use strict';
  var D = NS.Dolphin = NS.Dolphin || {};
  var RAD = Math.PI / 180;
  D.PITCH_CHANGE = 85 * RAD; D.YAW_CHANGE = 10 * RAD; D.SPEED_IN_WATER = 0.02; D.SPEED_IN_AIR = 0.1;
  D.EYE_HEIGHT = 0.3; D.MAX_LOOK_PITCH_CHANGE = 1; D.MAX_HEAD_ROTATION = 1;
  D.ready = false;
  D.init = function () { D.ready = !!(NS.EntityList && NS.EntityList.ready && NS.Entities && NS.Entities.ready); };
  D.isDolphin = function (t) { return t === 'dolphin'; };

  /** `AquaticMoveControl.tick()` verbatim (engine yaw = atan2(dx,-dz); pitch radians, positive DOWN as vanilla). */
  D.moveControlTick = function (e) {
    if (e.inWater) e.vy = (e.vy || 0) + 0.005;
    var n = e.dolphinNav;
    if (n) {
      var dx = n.x - e.x, dy = n.y - e.y, dz = n.z - e.z;
      if (dx * dx + dy * dy + dz * dz < 2.5000003E-7) { e.zza = 0; return; }   // vanilla: only forwardSpeed; movementSpeed/upwardSpeed keep last tick's
      e.yaw = NS.Ai.rotlerp(e.yaw || 0, Math.atan2(dx, -dz), D.YAW_CHANGE);
      e.bodyYaw = e.yaw; e.headYaw = e.yaw;
      var attr = (NS.Entities && NS.Entities.attrsOf) ? (NS.Entities.attrsOf(e.type).speed || 1.2) : 1.2;
      var s = Math.fround(n.speed * attr);
      if (e.inWater) {
        e.mobSpeed = Math.fround(s * D.SPEED_IN_WATER);
        var h = Math.sqrt(dx * dx + dz * dz);
        if (Math.abs(dy) > 1e-5 || Math.abs(h) > 1e-5) {
          var wp = -Math.atan2(dy, h);
          wp = Math.max(-D.PITCH_CHANGE, Math.min(D.PITCH_CHANGE, NS.Ai.wrapRad(wp)));
          e.pitch = NS.Ai.rotlerp(e.pitch || 0, wp, 5 * RAD);
        }
        e.zza = Math.cos(e.pitch || 0) * s;
        e.dolphinUp = -Math.sin(e.pitch || 0) * s;
      } else {
        e.mobSpeed = Math.fround(s * D.SPEED_IN_AIR);
        // vanilla: only movementSpeed; forwardSpeed (zza) keeps the last in-water value
      }
    } else { e.mobSpeed = 0; e.zza = 0; e.dolphinUp = 0; }
  };

  /** `DolphinEntity.travel(Vec3d)`: water branch = updateVelocity(getMovementSpeed(), input) + move + *0.9 (+ -0.005 y, no target). */
  D.travelMob = function (e) {
    var Ph = NS.Physics;
    if (e.inWater) {
      var fwd = (e.zza || 0) * 0.98, up = e.dolphinUp || 0, len2 = fwd * fwd + up * up;
      if (len2 > 1) { var l = Math.sqrt(len2); fwd /= l; up /= l; }
      var sp = e.mobSpeed || 0, sy = Math.sin(e.yaw || 0), cy = Math.cos(e.yaw || 0);
      e.vx = (e.vx || 0) + fwd * sp * sy;
      e.vz = (e.vz || 0) - fwd * sp * cy;
      e.vy = (e.vy || 0) + up * sp;
      Ph.move(e, e.vx, e.vy, e.vz);
      e.vx *= 0.9; e.vy *= 0.9; e.vz *= 0.9;
      if (!e.target) e.vy -= 0.005;
    } else {
      Ph.travelMob(e);
    }
  };

  D.tickMove = function (e) { D.moveControlTick(e); };
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
