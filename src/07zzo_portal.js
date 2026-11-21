// 07zzo_portal.js -- #261: NETHER PORTAL FRAME DETECTION. A port of AreaHelper (.decomp/net/minecraft/world/
// dimension/AreaHelper.java) plus the two fire hooks that call it (AbstractFireBlock.onBlockAdded line 135 and
// shouldLightPortalAt line 170). Runs on: MAIN THREAD ONLY. No DOM.
//
// World access goes through an adapter `W` so the logic runs without chunk storage (portalframecheck):
//   W.kind(x,y,z) -> 'air' | 'fire' (BlockTags.FIRE) | 'portal' | 'obsidian' | 'other'     W.bottomY
//   W.set(x,y,z,'portal',axis)   axis = 'x' | 'z'
// Axis 'x' runs the frame along +x (negativeDir = WEST), axis 'z' along +z (negativeDir = NORTH).
(function (NS) {
  'use strict';
  var F = NS.PortalFrame = {};

  function inside(k) { return k === 'air' || k === 'fire' || k === 'portal'; }   // validStateInsidePortal

  /** new AreaHelper(world, pos, axis). Fields: axis, lowerCorner {x,y,z}|null, width, height, foundPortalBlocks. */
  F.Area = function (W, pos, axis) {
    this.W = W; this.axis = axis; this.foundPortalBlocks = 0;
    this.dx = axis === 'x' ? -1 : 0; this.dz = axis === 'x' ? 0 : -1;       // negativeDir
    this.lowerCorner = this._lowerCorner(pos);
    if (this.lowerCorner === null) { this.lowerCorner = { x: pos.x, y: pos.y, z: pos.z }; this.width = 1; this.height = 1; }
    else { this.width = this._widthChecked(); if (this.width > 0) this.height = this._height(); else this.height = 0; }
  };
  var A = F.Area.prototype;
  A._lowerCorner = function (p) {
    var W = this.W, x = p.x, y = p.y, z = p.z, lim = Math.max(W.bottomY, y - 21);
    while (y > lim && inside(W.kind(x, y - 1, z))) y--;
    var ox = -this.dx, oz = -this.dz, n = this._width(x, y, z, ox, oz) - 1;
    return n < 0 ? null : { x: x + ox * n, y: y, z: z + oz * n };
  };
  A._widthChecked = function () {
    var c = this.lowerCorner, n = this._width(c.x, c.y, c.z, this.dx, this.dz);
    return n >= 2 && n <= 21 ? n : 0;
  };
  A._width = function (x, y, z, dx, dz) {
    var W = this.W;
    for (var i = 0; i <= 21; i++) {
      var px = x + dx * i, pz = z + dz * i, k = W.kind(px, y, pz);
      if (!inside(k)) { if (k === 'obsidian') return i; break; }
      if (W.kind(px, y - 1, pz) !== 'obsidian') break;
    }
    return 0;
  };
  A._height = function () {
    var c = this.lowerCorner, W = this.W, h = 21, i, j;
    outer: for (i = 0; i < 21; i++) {
      if (W.kind(c.x - this.dx, c.y + i, c.z - this.dz) !== 'obsidian') { h = i; break; }
      if (W.kind(c.x + this.dx * this.width, c.y + i, c.z + this.dz * this.width) !== 'obsidian') { h = i; break; }
      for (j = 0; j < this.width; j++) {
        var k = W.kind(c.x + this.dx * j, c.y + i, c.z + this.dz * j);
        if (!inside(k)) { h = i; break outer; }
        if (k === 'portal') this.foundPortalBlocks++;
      }
    }
    if (h < 3 || h > 21) return 0;
    for (j = 0; j < this.width; j++) if (W.kind(c.x + this.dx * j, c.y + h, c.z + this.dz * j) !== 'obsidian') return 0;
    return h;
  };
  A.isValid = function () { return this.lowerCorner !== null && this.width >= 2 && this.width <= 21 && this.height >= 3 && this.height <= 21; };
  A.wasAlreadyValid = function () { return this.isValid() && this.foundPortalBlocks === this.width * this.height; };
  A.createPortal = function () {
    var c = this.lowerCorner;
    for (var i = 0; i < this.width; i++) for (var j = 0; j < this.height; j++)
      this.W.set(c.x + this.dx * i, c.y + j, c.z + this.dz * i, 'portal', this.axis);
  };

  /** AreaHelper.getOrEmpty: try `axis`, else the other axis; null when neither satisfies pred. */
  F.getOrEmpty = function (W, pos, pred, axis) {
    var a = new F.Area(W, pos, axis);
    if (pred(a)) return a;
    a = new F.Area(W, pos, axis === 'x' ? 'z' : 'x');
    return pred(a) ? a : null;
  };
  /** AreaHelper.getNewPortal. */
  F.getNewPortal = function (W, pos, axis) {
    return F.getOrEmpty(W, pos, function (a) { return a.isValid() && a.foundPortalBlocks === 0; }, axis);
  };

  /** AbstractFireBlock.shouldLightPortalAt: some neighbour is obsidian and a frame forms (horizontal face ->
   *  rotateYCounterclockwise axis; vertical face -> random horizontal axis, rnd() is [0,1)). */
  F.shouldLightPortalAt = function (W, pos, face, rnd) {
    var D = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]], ok = false;
    for (var i = 0; i < 6 && !ok; i++) ok = W.kind(pos.x + D[i][0], pos.y + D[i][1], pos.z + D[i][2]) === 'obsidian';
    if (!ok) return false;
    var ax;
    if (face && (face.dx !== 0 || face.dz !== 0)) ax = face.dx !== 0 ? 'z' : 'x';   // CCW rotation swaps the axis
    else ax = (rnd || Math.random)() < 0.5 ? 'x' : 'z';
    return F.getNewPortal(W, pos, ax) !== null;
  };

  /** Fire onBlockAdded: lights the portal if a frame forms around `pos` (axis x tried first). True when it did. */
  F.tryLight = function (W, pos) {
    var a = F.getNewPortal(W, pos, 'x');
    if (!a) return false;
    a.createPortal();
    return true;
  };

  /** Live-world adapter over NS.World / NS.States (flags 18 = no neighbour update storm; the engine's setter is used). */
  F.liveWorld = function () {
    var Wd = NS.World, S = NS.States, R = NS.Reg;
    var ob = R.id.obsidian, np = R.id.nether_portal, fire = R.id.fire, sf = R.id.soul_fire;
    return {
      bottomY: -64,
      kind: function (x, y, z) {
        var s = Wd.getBlock(x, y, z); if (s === 0) return 'air';
        var b = S.block[s];
        return b === ob ? 'obsidian' : b === np ? 'portal' : (b === fire || b === sf) ? 'fire' : 'other';
      },
      set: function (x, y, z, k, axis) { Wd.setBlock(x, y, z, R.realFirst[np] + (axis === 'z' ? 1 : 0)); }
    };
  };
  F.dimOk = function () { var D = NS.Dim; if (!D || !D.norm) return true; var c = D.norm(D.cur); return c === 'overworld' || c === 'the_nether'; };
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
