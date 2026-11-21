// src/07zzzd_amphibious.js — G18a-AX1d (#9438): port of pathing.AmphibiousPathNodeMaker (.decomp 1.18.2), the node maker the
// axolotl (and drowned/turtle-style swimmers) select. Pieces, each named by its vanilla method:
//   init/clear        malus WATER 0, WALKABLE 6, WATER_BORDER 4 (old values restored by clear)
//   getStart/getNode  floor(minX), floor(minY + 0.5), floor(minZ); target floor(y + 0.5)
//   getDefaultNodeType  WATER beside a BLOCKED face neighbour is WATER_BORDER, other WATER stays, else the land type
//   getFeetY          y + 0.5 while the mob touches water, else the land rule (top of the collider below)
//   getSuccessors     the vertical pair: up/down with step = floor(max(1, stepHeight)) gated by the type above and STICKY_HONEY,
//                     no downward node from a TRAPDOOR, deep-water (y < seaLevel - 10) +1 penalty when penalizeDeepWater
//   getPathNode       feetY step cap 1.125, malus-gated node, step-up recursion; method_37004 (true here) skips the fall scan
// The horizontal 8 successors are LandPathNodeMaker's (Ai.mobNodeType family) and are not re-ported. Simplification named:
// the box-collision refinements (isBlocked for a DANGER_OTHER origin, the narrow-mob step-up box) are not run.
(function (NS) {
  'use strict';
  var Ai = NS.Ai, T = Ai.NodeType;
  var A = NS.Amphibious = {};
  A.MALUS = [[T.WATER, 0], [T.WALKABLE, 6], [T.WATER_BORDER, 4]];

  /** init: the mob's own malus table is overridden; the previous WALKABLE/WATER_BORDER values are kept for clear(). */
  A.init = function (e, penalizeDeepWater) {
    var m = e.pathMalus || (e.pathMalus = {});
    e.amphSaved = { had: {}, old: {} };
    A.MALUS.forEach(function (r) { e.amphSaved.had[r[0]] = m[r[0]] !== undefined; e.amphSaved.old[r[0]] = m[r[0]]; });
    // vanilla stores getPathfindingPenalty (default-resolved) for WALKABLE/WATER_BORDER; resolving here keeps clear() exact
    e.amphSaved.old[T.WALKABLE] = Ai.pathPenalty(e, T.WALKABLE); e.amphSaved.old[T.WATER_BORDER] = Ai.pathPenalty(e, T.WATER_BORDER);
    A.MALUS.forEach(function (r) { m[r[0]] = r[1]; });
    e.amphPenalizeDeep = !!penalizeDeepWater;
  };
  A.clear = function (e) {
    var s = e.amphSaved; if (!s) return;
    e.pathMalus[T.WALKABLE] = s.old[T.WALKABLE]; e.pathMalus[T.WATER_BORDER] = s.old[T.WATER_BORDER];
    e.amphSaved = null;
  };
  var floor = Math.floor;
  A.getStart = function (e) { var w = (e.width || 0.6) / 2; return { x: floor(e.x - w), y: floor(e.y + 0.5), z: floor(e.z - w) }; };
  A.getTarget = function (x, y, z) { return { x: floor(x), y: floor(y + 0.5), z: floor(z) }; };

  var FACES = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];
  A.defaultNodeType = function (x, y, z) {
    var t = Ai.commonNodeType(x, y, z);
    if (t === T.WATER) {
      for (var i = 0; i < 6; i++) if (Ai.commonNodeType(x + FACES[i][0], y + FACES[i][1], z + FACES[i][2]) === T.BLOCKED) return T.WATER_BORDER;
      return T.WATER;
    }
    return Ai.pathTypeAt(x, y, z);
  };
  /** LandPathNodeMaker.getNodeType over the mob's box (sizes floor(w+1), floor(h+1)) with THIS maker's default node type. */
  A.nodeType = function (e, x, y, z) {
    var sx = floor(((e && e.width) || 0.6) + 1), sy = floor(((e && e.height) || 1.8) + 1), seen = [], origin = T.BLOCKED;
    for (var i = 0; i < sx; i++) for (var j = 0; j < sy; j++) for (var k = 0; k < sx; k++) {
      var t = A.defaultNodeType(x + i, y + j, z + k);
      if (!i && !j && !k) origin = t;
      if (seen.indexOf(t) < 0) seen.push(t);
    }
    if (seen.indexOf(T.FENCE) >= 0) return T.FENCE;
    if (seen.indexOf(T.UNPASSABLE_RAIL) >= 0) return T.UNPASSABLE_RAIL;
    var best = T.BLOCKED;
    for (var n = 0; n < Ai.ENUM_ORDER.length; n++) {
      var tt = Ai.ENUM_ORDER[n];
      if (seen.indexOf(tt) < 0) continue;
      var pen = Ai.pathPenalty(e, tt);
      if (pen < 0) return tt;
      if (pen >= Ai.pathPenalty(e, best)) best = tt;
    }
    return (origin === T.OPEN && Ai.pathPenalty(e, best) === 0 && sx <= 1) ? T.OPEN : best;
  };
  /** getFeetY: touching water -> y + 0.5, else the top of the block below (full cube 1, no collider 0). */
  A.feetY = function (e, x, y, z) {
    if (e.inWater) return y + 0.5;
    var below = NS.Physics.solidAt(x, y - 1, z);
    return (y - 1) + (below ? 1 : 0);
  };
  A.pathNode = function (e, x, y, z, maxStep, feetY, type) {
    if (A.feetY(e, x, y, z) - feetY > 1.125) return null;
    var t = A.nodeType(e, x, y, z), pen = Ai.pathPenalty(e, t), node = null;
    if (pen >= 0) node = { x: x, y: y, z: z, type: t, penalty: Math.max(0, pen) };
    if (t !== T.WALKABLE && t !== T.WATER) {   // method_37004() is true: WATER skips the step-up and fall scans
      if ((!node || node.penalty < 0) && maxStep > 0 && t !== T.FENCE && t !== T.UNPASSABLE_RAIL && t !== T.TRAPDOOR && t !== T.POWDER_SNOW)
        node = A.pathNode(e, x, y + 1, z, maxStep - 1, feetY, type);
    }
    return node;
  };
  /** getSuccessors' own two vertical nodes (up, down); `seaLevel` defaults to 63. */
  A.verticalSuccessors = function (e, n, seaLevel) {
    var above = A.nodeType(e, n.x, n.y + 1, n.z), here = A.nodeType(e, n.x, n.y, n.z);
    var step = (Ai.pathPenalty(e, above) >= 0 && here !== T.STICKY_HONEY) ? floor(Math.max(1, e.stepHeight === undefined ? 0.6 : e.stepHeight)) : 0;
    var fy = A.feetY(e, n.x, n.y, n.z), out = [];
    var up = A.pathNode(e, n.x, n.y + 1, n.z, Math.max(0, step - 1), fy, here);
    var down = A.pathNode(e, n.x, n.y - 1, n.z, step, fy, here);
    var ok = function (p) { return p && (p.penalty >= 0 || n.penalty < 0); };
    if (ok(up)) out.push(up);
    if (ok(down) && here !== T.TRAPDOOR) out.push(down);
    var sea = seaLevel === undefined ? 63 : seaLevel;
    out.forEach(function (p) { if (p.type === T.WATER && e.amphPenalizeDeep && p.y < sea - 10) p.penalty++; });
    return out;
  };
})(MCL);
