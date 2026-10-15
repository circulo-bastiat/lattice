// 07zzs_portal.js -- #6702 (G17-L112a): NETHER PORTAL TRAVEL. Entity.tickNetherPortal / tickNetherPortalCooldown /
// setInNetherPortal (Entity.java 1865-1905, 483-490), NetherPortalBlock.onEntityCollision (line 74),
// PortalForcer.getPortalRect / createPortal / isValidPortalPos and BlockLocating.getLargestRectangle /
// findLargestRectangle (.decomp/net/minecraft/world/). Runs on: MAIN THREAD ONLY. No DOM.
//
// World access goes through an adapter `W` so the logic runs without chunk storage (portalcheck):
//   W.isAir(x,y,z)  W.solid(x,y,z)  W.set(x,y,z,kind,axis)  kind = 'obsidian'|'air'|'portal'
//   W.topY(x,z) (WORLDSURFACE_WG top)  W.bottomY  W.topLimit (min(topY, bottomY+logicalHeight))
//   W.inBorder(x,z)  W.portals() -> [{x,y,z}] of POI nether_portal blocks  W.axisAt(x,y,z) -> 'x'|'z'|null
//   W.samePortal(a,b) -> both cells hold the same portal state
// OWED: moveToWorld itself (teleport target scaling, placing the entity), the POI storage and chunk tickets.
(function (NS) {
  'use strict';
  var P = NS.Portal = {};

  // ---- entity side ----
  /** NetherPortalBlock.onEntityCollision (canUsePortals is the caller's gate). */
  P.onEntityCollision = function (e, x, y, z) {
    if (!e.vehicle && !(e.passengers && e.passengers.length)) P.setInNetherPortal(e, x, y, z);
  };
  /** Entity.setInNetherPortal: while on cooldown the cooldown is just reset; else flag and remember the cell. */
  P.setInNetherPortal = function (e, x, y, z) {
    if (e.netherPortalCooldown > 0) { e.netherPortalCooldown = P.defaultCooldown(e); return; }
    var l = e.lastNetherPortalPosition;
    if (!l || l.x !== x || l.y !== y || l.z !== z) e.lastNetherPortalPosition = { x: x, y: y, z: z };
    e.inNetherPortal = true;
  };
  /** getDefaultNetherPortalCooldown 300; getMaxNetherPortalTime 0 (player: creative 1, else 80 by gamerule). */
  P.defaultCooldown = function () { return 300; };
  P.maxTime = function (e) {
    if (e.type !== 'player') return 0;
    return (NS.Gamemode && NS.Gamemode.isCreative && NS.Gamemode.isCreative(e)) ? 1 : (e.portalDelay != null ? e.portalDelay : 80);
  };
  /** Entity.tickNetherPortal. ctx = { netherAllowed, hasTarget, moveToWorld(e) }. */
  P.tick = function (e, ctx) {
    var max = P.maxTime(e);
    if (e.netherPortalTime == null) e.netherPortalTime = 0;
    if (e.inNetherPortal) {
      if (ctx.hasTarget && ctx.netherAllowed && !e.vehicle && e.netherPortalTime++ >= max) {
        e.netherPortalTime = max;
        e.netherPortalCooldown = P.defaultCooldown(e);
        ctx.moveToWorld(e);
      }
      e.inNetherPortal = false;
    } else {
      if (e.netherPortalTime > 0) e.netherPortalTime -= 4;
      if (e.netherPortalTime < 0) e.netherPortalTime = 0;
    }
    if (e.netherPortalCooldown > 0) e.netherPortalCooldown--;
  };

  // ---- BlockLocating ----
  function moveWhile(pred, p, dx, dy, dz, max) {
    var n = 0;
    while (n < max) { p.x += dx; p.y += dy; p.z += dz; if (!pred(p.x, p.y, p.z)) break; n++; }
    return n;
  }
  P.findLargestRectangle = function (a) {
    var minI = 0, maxI = 0, h = 0, st = [0];
    for (var i = 1; i <= a.length; i++) {
      var cur = i === a.length ? 0 : a[i];
      while (st.length) {
        var top = a[st[st.length - 1]];
        if (cur >= top) { st.push(i); break; }
        st.pop();
        var lo = st.length ? st[st.length - 1] + 1 : 0;
        if (top * (i - lo) > h * (maxI - minI)) { maxI = i; minI = lo; h = top; }
      }
      if (!st.length) st.push(i);
    }
    return { min: minI, max: maxI - 1, h: h };
  };
  var AX = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
  /** getLargestRectangle(origin, axis1, max1, axis2, max2, pred) -> {x,y,z,w,h} (min corner, size). */
  P.getLargestRectangle = function (o, ax1, max1, ax2, max2, pred) {
    var d7 = AX[ax1].map(function (v) { return -v; }), d9 = AX[ax2].map(function (v) { return -v; });   // field_11060 = NEGATIVE
    function at(k, d) { return { x: o.x + d[0] * k, y: o.y + d[1] * k, z: o.z + d[2] * k }; }
    function mw(from, d, sgn, max) { return moveWhile(pred, from, sgn * d[0], sgn * d[1], sgn * d[2], max); }
    var n11 = mw(at(0, d7), d7, 1, max1), n12 = mw(at(0, d7), d7, -1, max1), c = n11;
    var b = new Array(n11 + 1 + n12);
    b[c] = { min: mw(at(0, d9), d9, 1, max2), max: mw(at(0, d9), d9, -1, max2) };
    var base = b[c].min, k, pb;
    for (k = 1; k <= n11; k++) {
      pb = b[c - (k - 1)];
      b[c - k] = { min: mw(at(k, d7), d9, 1, pb.min), max: mw(at(k, d7), d9, -1, pb.max) };
    }
    for (k = 1; k <= n12; k++) {
      pb = b[c + k - 1];
      b[c + k] = { min: mw(at(-k, d7), d9, 1, pb.min), max: mw(at(-k, d7), d9, -1, pb.max) };
    }
    var bx = 0, by = 0, bw = 0, bh = 0, col = new Array(b.length);
    for (var r = base; r >= 0; r--) {
      for (var j = 0; j < b.length; j++) {
        var lo = base - b[j].min, hi = base + b[j].max;
        col[j] = r >= lo && r <= hi ? hi + 1 - r : 0;
      }
      var f = P.findLargestRectangle(col), w = 1 + f.max - f.min;
      if (w * f.h > bw * bh) { bx = f.min; by = r; bw = w; bh = f.h; }
    }
    var s1 = bx - c, s2 = by - base;
    var p1 = AX[ax1], p2 = AX[ax2];   // method_30513 offsets along the POSITIVE axis
    return { x: o.x + p1[0] * s1 + p2[0] * s2, y: o.y + p1[1] * s1 + p2[1] * s2, z: o.z + p1[2] * s1 + p2[2] * s2, w: bw, h: bh };
  };

  // ---- PortalForcer ----
  /** getPortalRect(pos, toNether, W): nearest (then lowest) portal POI inside the border, then its largest 21x21 frame. */
  P.getPortalRect = function (W, pos, toNether) {
    var rad = toNether ? 16 : 128, best = null, bd = 0;
    W.portals().forEach(function (p) {
      if (Math.abs(p.x - pos.x) > rad || Math.abs(p.z - pos.z) > rad || !W.inBorder(p.x, p.z) || !W.axisAt(p.x, p.y, p.z)) return;
      var d = Math.pow(p.x - pos.x, 2) + Math.pow(p.y - pos.y, 2) + Math.pow(p.z - pos.z, 2);
      if (!best || d < bd || (d === bd && p.y < best.y)) { best = p; bd = d; }
    });
    if (!best) return null;
    var ax = W.axisAt(best.x, best.y, best.z), c = best;
    return P.getLargestRectangle(best, ax, 21, 'y', 21, function (x, y, z) { return W.samePortal(c, { x: x, y: y, z: z }); });
  };
  function validPos(W, p, d, cw, off) {
    for (var i = -1; i < 3; i++) for (var j = -1; j < 4; j++) {
      var x = p.x + d[0] * i + cw[0] * off, y = p.y + j, z = p.z + d[1] * i + cw[1] * off;
      if (j < 0 && !W.solid(x, y, z)) return false;
      if (j >= 0 && !W.isAir(x, y, z)) return false;
    }
    return true;
  }
  /** BlockPos.iterateInSquare(center, r, east, south): centre first, then the clockwise spiral. */
  function spiral(c, r, fn) {
    var dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]], x = c.x, z = c.z + 1, max = 4 * r, chg = -1, maxS = 0, steps = 0;
    for (;;) {
      var d = dirs[(chg + 4) % 4]; x += d[0]; z += d[1];
      if (steps >= maxS) { if (chg >= max) return; chg++; steps = 0; maxS = (chg >> 1) + 1; }
      steps++;
      fn(x, z);
    }
  }
  /** createPortal(pos, axis, W) -> {x,y,z,w:2,h:3} or null. */
  P.createPortal = function (W, pos, axis) {
    var d = axis === 'x' ? [1, 0] : [0, 1], cw = [-d[1], d[0]];
    var bestD = -1, bestP = null, fbD = -1, fbP = null, top = W.topLimit - 1, tmp = { x: 0, y: 0, z: 0 };
    spiral(pos, 16, function (x, z) {
      var h = Math.min(top, W.topY(x, z));
      if (!W.inBorder(x, z) || !W.inBorder(x + d[0], z + d[1])) return;
      for (var y = h; y >= W.bottomY; y--) {
        if (!W.isAir(x, y, z)) continue;
        var y0 = y;
        while (y > W.bottomY && W.isAir(x, y - 1, z)) y--;
        if (y + 4 <= top) {
          var run = y0 - y;
          if (run <= 0 || run >= 3) {
            tmp = { x: x, y: y, z: z };
            if (validPos(W, tmp, d, cw, 0)) {
              var dist = Math.pow(pos.x - x, 2) + Math.pow(pos.y - y, 2) + Math.pow(pos.z - z, 2);
              if (validPos(W, tmp, d, cw, -1) && validPos(W, tmp, d, cw, 1) && (bestD === -1 || bestD > dist)) { bestD = dist; bestP = tmp; }
              if (bestD === -1 && (fbD === -1 || fbD > dist)) { fbD = dist; fbP = tmp; }
            }
          }
        }
      }
    });
    if (bestD === -1 && fbD !== -1) { bestP = fbP; bestD = fbD; }
    if (bestD === -1) {
      var lo = Math.max(W.bottomY + 1, 70), hi = top - 9;
      if (hi < lo) return null;
      bestP = { x: pos.x, y: Math.min(hi, Math.max(lo, pos.y)), z: pos.z };
      if (!W.inBorder(bestP.x, bestP.z)) return null;
      for (var a = -1; a < 2; a++) for (var b = 0; b < 2; b++) for (var c = -1; c < 3; c++)
        W.set(bestP.x + b * d[0] + a * cw[0], bestP.y + c, bestP.z + b * d[1] + a * cw[1], c < 0 ? 'obsidian' : 'air');
    }
    var o = bestP, i, j;
    for (i = -1; i < 3; i++) for (j = -1; j < 4; j++)
      if (i === -1 || i === 2 || j === -1 || j === 3) W.set(o.x + i * d[0], o.y + j, o.z + i * d[1], 'obsidian');
    for (i = 0; i < 2; i++) for (j = 0; j < 3; j++) W.set(o.x + i * d[0], o.y + j, o.z + i * d[1], 'portal', axis);
    return { x: o.x, y: o.y, z: o.z, w: 2, h: 3 };
  };
  /** NetherPortalBlock.randomTick (line 48). ctx = { natural, doMobSpawning, difficulty (0..3), isPortal(x,y,z),
   *  allowsSpawning(x,y,z) (zombified_piglin on that block), spawn(x,y,z) -> entity|null (reason NETHER_PORTAL) }.
   *  rnd() is a [0,1) float; nextInt(2000) = floor(rnd()*2000). Returns the spawned entity or null. */
  P.randomTick = function (ctx, rnd, x, y, z) {
    if (!(ctx.natural && ctx.doMobSpawning && Math.floor(rnd() * 2000) < ctx.difficulty)) return null;
    while (ctx.isPortal(x, y, z)) y--;
    if (!ctx.allowsSpawning(x, y, z)) return null;
    var e = ctx.spawn(x, y + 1, z);
    if (e) e.netherPortalCooldown = P.defaultCooldown(e);
    return e || null;
  };
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
