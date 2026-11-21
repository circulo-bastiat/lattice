// 07zzs2_portalwire.js -- #10975 (G27a): NETHER PORTAL TRAVEL WIRED INTO THE LIVE PLAYER TICK.
// Entity.tickNetherPortal driven from P.tick (PW.tick), NetherPortalBlock.onEntityCollision from the player's box
// overlapping a nether_portal cell, ServerPlayerEntity.moveToWorld -> PortalForcer (getPortalRect, else createPortal)
// placing the player. The pure logic is 07zzs_portal.js; this file is the World adapter + POI index + hook.
// POI index: the set of nether_portal cells per dimension (vanilla PointOfInterestStorage), kept current by wrapping
// World.setBlock and lazily scanning each loaded chunk once (generated ruined portals). Runs on: MAIN THREAD ONLY.
// Placement WAITS (p.portalPending) until the destination chunks around the scaled spot are generated, as vanilla's
// chunk ticket does; the player is frozen meanwhile. Nausea (ClientPlayerEntity.updateNausea): p.portalNausea 0..1.
(function (NS) {
  'use strict';
  var PW = NS.PortalWire = { poi: {}, scanned: {} };

  function ids() { var R = NS.Reg; return { np: R.id.nether_portal, first: R.realFirst[R.id.nether_portal] }; }
  function isPortalState(s) { var i = ids(); return NS.States.block[s] === i.np; }
  function axisOf(s) { var i = ids(); return (s - i.first) === 1 ? 'z' : 'x'; }   // axis property order x, z
  function set(dim) { return PW.poi[dim] || (PW.poi[dim] = new Map()); }
  function key(x, y, z) { return x + ',' + y + ',' + z; }

  /** Track a portal cell (placed) or drop it (any other state). */
  PW.note = function (dim, x, y, z, s) {
    var m = set(dim), k = key(x, y, z);
    if (isPortalState(s)) m.set(k, { x: x, y: y, z: z }); else m.delete(k);
  };
  PW.scanChunk = function (dim, c) {
    var sk = PW.scanned[dim] || (PW.scanned[dim] = {}), kk = c.cx + ',' + c.cz;
    if (sk[kk]) return; sk[kk] = 1;
    var S = NS.Section || NS.S, Sx = NS.Sec || S, minY = NS.CFG ? NS.CFG.WORLD_MIN_Y : -64;
    for (var sy = 0; sy < c.sec.length; sy++) {
      var sec = c.sec[sy];
      if (Sx.isUniform(sec) && !isPortalState(sec.u)) continue;
      for (var i = 0; i < 4096; i++) {
        var s = Sx.get(sec, i);
        if (s && isPortalState(s)) PW.note(dim, (c.cx << 4) | (i & 15), minY + (sy << 4) + (i >> 8), (c.cz << 4) | ((i >> 4) & 15), s);
      }
    }
  };
  PW.hook = function () {
    var Wd = NS.World; if (Wd.__pwHooked) return; Wd.__pwHooked = true;
    var orig = Wd.setBlock;
    Wd.setBlock = function (x, y, z, id) {
      var r = orig.apply(this, arguments);
      PW.note(Wd.dimension, x, y, z, Wd.getBlock(x, y, z));
      return r;
    };
  };

  /** The adapter W of 07zzs_portal.js over the live (current-dimension) chunks. center = {x,z} to scan around. */
  PW.adapter = function (center, rad) {
    var Wd = NS.World, S = NS.States, R = NS.Reg, i = ids(), dim = Wd.dimension, dt = NS.Dim.get(dim);
    for (var cx = (center.x - rad) >> 4; cx <= (center.x + rad) >> 4; cx++)
      for (var cz = (center.z - rad) >> 4; cz <= (center.z + rad) >> 4; cz++) { var c = Wd.get(cx, cz); if (c) PW.scanChunk(dim, c); }
    var obs = R.realFirst[R.id.obsidian], bottom = Math.max(dt.minY, NS.CFG ? NS.CFG.WORLD_MIN_Y : -64);
    return {
      bottomY: bottom,
      topLimit: Math.min(bottom + dt.height, bottom + dt.logicalHeight, NS.CFG ? NS.CFG.WORLD_MAX_Y : 256),
      isAir: function (x, y, z) { return S.isAir[Wd.getBlock(x, y, z)] === 1; },
      solid: function (x, y, z) { return S.solid[Wd.getBlock(x, y, z)] === 1; },
      topY: function (x, z) { return Math.max(bottom, Wd.heightAt(x, z) + 1); },
      inBorder: function (x, z) { return !Wd.border || Wd.border.contains(x, z); },
      portals: function () { var o = []; set(dim).forEach(function (p) { o.push(p); }); return o; },
      axisAt: function (x, y, z) { var s = Wd.getBlock(x, y, z); return isPortalState(s) ? axisOf(s) : null; },
      samePortal: function (a, b) { var s = Wd.getBlock(a.x, a.y, a.z); return isPortalState(s) && Wd.getBlock(b.x, b.y, b.z) === s; },
      set: function (x, y, z, kind, axis) {
        var id = kind === 'obsidian' ? obs : kind === 'air' ? 0 : i.first + (axis === 'z' ? 1 : 0);
        Wd.setBlock(x, y, z, id, true);
      }
    };
  };

  function chunksReady(x, z, rad) {
    var Wd = NS.World;
    for (var cx = (x - rad) >> 4; cx <= (x + rad) >> 4; cx++)
      for (var cz = (z - rad) >> 4; cz <= (z + rad) >> 4; cz++) if (!Wd.loadedAt(cx << 4, cz << 4)) return false;
    return true;
  }
  /** PortalForcer placement (getPortalRect else createPortal) and the player's landing (Entity.getTeleportTarget). */
  PW.place = function (p, pend) {
    var P = NS.Portal, rad = pend.toNether ? 20 : 132;
    if (!chunksReady(Math.floor(p.x), Math.floor(p.z), Math.min(rad, 36))) return false;
    var W = PW.adapter({ x: Math.floor(p.x), z: Math.floor(p.z) }, rad);
    var pos = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
    var rect = P.getPortalRect(W, pos, pend.toNether), axis = pend.axis || 'x', landing;
    if (rect) {
      axis = W.axisAt(rect.x, rect.y, rect.z) || 'x';
      landing = rect; pend.found = true;
    } else {
      landing = P.createPortal(W, pos, axis);
      if (!landing) { p.portalPending = null; return true; }   // no spot: stays at the scaled position
    }
    // landing: rect min corner, size w x h along `axis`; stand on the bottom, centred (BlockLocating -> getTeleportTarget).
    var cx = rect ? landing.x + (axis === 'x' ? landing.w / 2 : 0.5) : landing.x + (axis === 'x' ? 1 : 0.5);
    var cz = rect ? landing.z + (axis === 'z' ? landing.w / 2 : 0.5) : landing.z + (axis === 'z' ? 1 : 0.5);
    p.x = cx; p.y = landing.y; p.z = cz; p.vx = p.vy = p.vz = 0;
    p.px = p.x; p.py = p.y; p.pz = p.z;
    pend.landing = landing; pend.axis = axis; p.portalPending = null;
    return true;
  };
  /** ServerPlayerEntity.moveToWorld through P.moveToWorld; placement runs when the destination chunks exist. */
  PW.travel = function (p) {
    var Wd = NS.World, to = Wd.dimension === 'overworld' ? 'the_nether' : 'overworld';
    PW.hook();
    NS.Portal.moveToWorld(p, to, function (pl, dim) {
      pl.px = pl.x; pl.pz = pl.z;
      p.portalPending = { toNether: dim === 'the_nether', axis: (p.lastNetherPortalAxis) || 'x' };
      PW.place(p, p.portalPending);
    });
  };
  /** Does the player's box overlap a nether_portal cell? (NetherPortalBlock.onEntityCollision site) */
  PW.overlap = function (p) {
    var Wd = NS.World, hw = (p.width || 0.6) * 0.5, h = p.height || 1.8, e = 1e-7;
    for (var x = Math.floor(p.x - hw + e); x <= Math.floor(p.x + hw - e); x++)
      for (var y = Math.floor(p.y + e); y <= Math.floor(p.y + h - e); y++)
        for (var z = Math.floor(p.z - hw + e); z <= Math.floor(p.z + hw - e); z++)
          if (isPortalState(Wd.getBlock(x, y, z))) return { x: x, y: y, z: z, s: Wd.getBlock(x, y, z) };
    return null;
  };
  /** One player tick (called from P.tick). */
  PW.tick = function (p) {
    if (!NS.Portal || !NS.World || !NS.Reg || !NS.Reg.id) return;
    var Wd = NS.World, dim = Wd.dimension;
    if (p.portalPending) { PW.place(p, p.portalPending); return; }
    if (dim !== 'overworld' && dim !== 'the_nether') return;
    p.type = 'player';
    var hit = p.dead ? null : PW.overlap(p);
    if (hit) { p.lastNetherPortalAxis = axisOf(hit.s); NS.Portal.onEntityCollision(p, hit.x, hit.y, hit.z); }
    // ClientPlayerEntity.updateNausea (uses inNetherPortal as left by the previous tick's collision)
    p.prevPortalNausea = p.portalNausea || 0;
    if (p.inNetherPortal) p.portalNausea = Math.min(1, (p.portalNausea || 0) + 0.0125);
    else if ((p.portalNausea || 0) > 0) p.portalNausea = Math.max(0, p.portalNausea - 0.05);
    NS.Portal.tick(p, { netherAllowed: true, hasTarget: true, moveToWorld: PW.travel });
  };
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
