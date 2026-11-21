// 07zv8_vbhidehome.js - G18f-B4: HideInHomeTask (HIDE activity: 32 blocks, speed*1.25) and
// HideInHomeDuringRaidTask (RAID activity: 24 blocks, speed*1.4, only inside an ONGOING raid).
// .decomp HideInHomeTask.java: preferredDistance 1 (completionRange); shouldRun finds a HOME poi within
// preferredDistance+1; run falls back to a random HOME poi within maxDistance, then the HOME memory; the
// result is HIDING_PLACE (e.vbHidingPlace) and a WalkTarget unless already within preferredDistance.
// Movement is Ai.findPath/Ai.stepToward as VB.tickRest does; no path home = no movement.
(function (NS) {
  'use strict';
  var HH = NS.VBHideHome = {};
  HH.HIDE_DIST = 32; HH.HIDE_SPEED = 1.25;
  HH.RAID_DIST = 24; HH.RAID_SPEED = 1.4;
  HH.COMPLETION = 1;

  function dist2(e, p) { var dx = e.x - (p.x + 0.5), dy = e.y - p.y, dz = e.z - (p.z + 0.5); return dx * dx + dy * dy + dz * dz; }
  function within(e, p, d) { return dist2(e, p) <= d * d; }

  function findHome(e, maxDist) {
    var Poi = NS.Poi, bp = { x: Math.floor(e.x), y: Math.floor(e.y), z: Math.floor(e.z) };
    if (Poi && Poi.getPosition) {
      var h = Poi.getPosition(function (t) { return t === Poi.HOME; }, null, Poi.STATUS.ANY, bp, maxDist);
      if (h) return h;
    }
    return e.vbHome || null;     // HOME memory
  }

  function raidOf(e) {
    var RM = NS.RaidManager;
    return (RM && RM.world) ? RM.getRaidAt(RM.world, { x: Math.floor(e.x), y: Math.floor(e.y), z: Math.floor(e.z) }) : null;
  }

  function step(e, home, mul) {
    var Ai = NS.Ai, w = e.vbHHWalk;
    if (!w || w.tx !== home.x || w.ty !== home.y || w.tz !== home.z) {
      var path = Ai.findPath(e.x, e.y, e.z, home.x + 0.5, home.y, home.z + 0.5, { mob: e });
      if (!path || path.length < 2) { e.vbHHWalk = null; return; }
      w = e.vbHHWalk = { tx: home.x, ty: home.y, tz: home.z, path: path, idx: 1 };
    }
    if (w.idx >= w.path.length) { e.vbHHWalk = null; return; }
    Ai.stepToward(e, w.path[w.idx], NS.VB.WALK_SPEED * mul);
    if (Ai.closeTo(e, w.path[w.idx])) w.idx++;
  }

  function run(e, maxDist, mul) {
    var home = findHome(e, maxDist);
    if (!home) return false;                       // no HOME: nothing remembered, no move
    e.vbHidingPlace = { x: home.x, y: home.y, z: home.z };
    if (!within(e, home, HH.COMPLETION)) step(e, home, mul); else e.vbHHWalk = null;
    return true;
  }

  /** HIDE-activity HideInHomeTask; true while it holds a hiding place. */
  HH.hideTick = function (e) { return run(e, HH.HIDE_DIST, HH.HIDE_SPEED); };

  /** RAID-activity HideInHomeDuringRaidTask: shouldRun needs an ONGOING raid at the villager. */
  HH.raidTick = function (e) {
    var r = raidOf(e);
    if (!r || r.status !== 'ongoing') return false;
    return run(e, HH.RAID_DIST, HH.RAID_SPEED);
  };
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
