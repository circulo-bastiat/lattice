// 07zv9_vbdoors.js — OpenDoorsTask (core task, priority 0; .decomp .../task/OpenDoorsTask.java) for villagers.
// The path is e.vbWander.path / .idx (last node = idx-1, current node = idx). DOORS_TO_CLOSE is e.vbDoorsToClose.
// DEVIATION: vanilla remembers the last node's door even when it was already open (so it can close a door
// someone else held open); here only a door THIS villager opened is remembered, so a player-held door stays open.
(function (NS) {
  'use strict';
  var VBD = NS.VBDoors = { ready: true };

  function woodDoor(n) {
    if (!n) return null;
    var d = NS.Ai.doorAt(n.x, n.y, n.z);
    return d && d.wood && !d.iron ? d : null;
  }
  function remember(e, n) {
    var s = e.vbDoorsToClose || (e.vbDoorsToClose = []);
    for (var i = 0; i < s.length; i++) if (s[i].x === n.x && s[i].y === n.y && s[i].z === n.z) return;
    s.push({ x: n.x, y: n.y, z: n.z });
  }
  function open(e, n) {
    var d = woodDoor(n);
    if (!d) return false;
    if (d.closed) { NS.Ai.setDoorOpen(n.x, n.y, n.z, true); remember(e, n); }
    return true;
  }
  function near(e, p) {
    var dx = p.x + 0.5 - e.x, dy = p.y + 0.5 - e.y, dz = p.z + 0.5 - e.z;
    return dx * dx + dy * dy + dz * dz < 4;
  }
  function reached(e, p, last, cur) {
    return (last && last.x === p.x && last.y === p.y && last.z === p.z) || (cur && cur.x === p.x && cur.y === p.y && cur.z === p.z);
  }
  function same(a, b) { return a === b || (a && b && a.x === b.x && a.y === b.y && a.z === b.z); }

  /** pathToDoor: close remembered doors that are neither node, once the villager is 2+ blocks away. */
  VBD.closeBehind = function (e, last, cur) {
    var s = e.vbDoorsToClose;
    if (!s) return;
    for (var i = s.length - 1; i >= 0; i--) {
      var p = s[i];
      if (reached(e, p, last, cur)) continue;
      s.splice(i, 1);
      if (!near(e, p)) continue;    // cannotReachDoor (not within 2 blocks): forgotten, door stays as it is
      var d = NS.Ai.doorAt(p.x, p.y, p.z);
      if (!d || !d.wood || d.closed) continue;
      if (VBD.otherAtDoor(e, p)) continue;
      NS.Ai.setDoorOpen(p.x, p.y, p.z, false);
    }
  };

  /** hasOtherMobReachedDoor: another villager within 2 of the door whose path is at that door. */
  VBD.otherAtDoor = function (e, p) {
    var EL = NS.EntityList;
    if (!EL || !EL.list) return false;
    for (var i = 0; i < EL.list.length; i++) {
      var o = EL.list[i];
      if (!o || o === e || o.type !== e.type || o.dead || o.removed || !near(o, p)) continue;
      var w = o.vbWander;
      if (!w || !w.running || !w.path || w.idx >= w.path.length) continue;
      if (reached(o, p, w.path[w.idx - 1], w.path[w.idx])) return true;
    }
    return false;
  };

  VBD.tick = function (e, tnow) {
    e.canOpenDoors = true;
    var w = e.vbWander, path = w && w.running ? w.path : null;
    if (!path || w.idx <= 0 || w.idx >= path.length) { VBD.closeBehind(e, null, null); return; }
    var cur = path[w.idx], last = path[w.idx - 1];
    // shouldRun: new current node -> run now (ticks=20 is the re-run cadence for an unchanged node)
    if (!same(e.vbDoorNode, cur)) { e.vbDoorNode = cur; e.vbDoorTicks = 20; }
    else { if (e.vbDoorTicks > 0) e.vbDoorTicks--; if (e.vbDoorTicks !== 0) return; }
    open(e, last);
    open(e, cur);
    VBD.closeBehind(e, last, cur);
  };
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
