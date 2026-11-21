// 08_lighting.js — the light engine (PLAN W9; D-27, D-28, D-29, D-142).
//
// ⚠ WHAT THIS FILE IS FOR, AND WHAT IT IS NOT.
//
// Light in MC-Lite is computed in two places and this is the second of them:
//
//   1. `Gen.lightPass`, on the WORKER, when a column is generated. Sky straight down, then a
//      BFS bounded to that one column. It is fast, it is where the bulk of the work is, and it
//      is wrong at every chunk border by construction — it cannot see the neighbour that is not
//      generated yet.
//   2. THIS FILE, on the main thread, in bounded slices: it finishes the job. Every border a
//      neighbour arrives at, and every block the player breaks or places, is a seed here.
//
// The rule set is VANILLA'S, exactly, and it is three rules:
//
//   • block light spreads from an emitter, losing one level per step plus the target's opacity;
//   • sky light spreads the same way SIDEWAYS and UPWARD, but falls STRAIGHT DOWN through a
//     zero-opacity cell WITHOUT losing a level — which is why a hole in a roof lights the floor
//     under it at 15 and not at 15 minus its depth;
//   • an opaque block holds no light at all.
//
// `PERF-MODS.md` records that Starlight is subtly non-identical to vanilla, so W9's target is
// **vanilla's rule set at Starlight's schedule** and the acceptance test (`tools/lightcheck.mjs`)
// asserts the RULE SET. The schedule is the part that is staged: ⚠ **D-142 — the incremental
// pass runs on the MAIN THREAD with a per-frame budget, not on a worker.** It is bounded work
// (`step(budgetMicros)` returns after its slice, mid-BFS, and resumes next frame), so it cannot
// stall a frame; moving it off-thread is W11's job, which is the stage that puts worldgen,
// meshing AND lighting on a real job graph. Doing it here would mean shipping a column and its
// eight neighbours to a worker and back per seed, and W11 is where that transport gets designed
// once for all three.
//
// ── THE ALGORITHM, WHICH IS THE ONE MINECRAFT USES ───────────────────────────────────────────
//
// A light level is not stored with a provenance, so when a source disappears you cannot tell
// which lit cells were its. The standard answer, and vanilla's, is two passes:
//
//   REMOVAL     from the changed cell, walk outward through cells whose level is exactly one
//               less than the cell that reached them — those are the ones this source lit —
//               setting them to zero. A neighbour that is BRIGHTER than that is lit by someone
//               else and becomes a re-propagation seed instead.
//   PROPAGATION from every seed, the ordinary increasing BFS.
//
// Both run out of one queue pair, both channels share the code, and the whole thing is bounded
// by a budget so a lava pool going out never costs a frame.
//
(function (NS) {
  'use strict';

  var CFG = NS.CFG, S = NS.Section;

  var L = NS.Light = {
    rm: null,          // removal ring:    packed, level|channel
    pr: null,          // propagation ring: packed, level|channel
    pending: 0,
    // counters, read by the HUD and by lightcheck
    stats: { seeds: 0, removed: 0, spread: 0, slices: 0, budgetHits: 0 }
  };

  // The ring is a flat Int32Array used as a queue of TRIPLES: x, z, and one packed word holding
  // y, the level and the channel. A JS array of little objects here is the difference between a
  // smooth frame and a hitch, which is D-27's whole point.
  //
  // ⚠ D-148 — IT USED TO BE PAIRS, WITH x AND z PACKED INTO ELEVEN BITS EACH, and that is a
  // world 2,048 blocks wide. Session 4's audit worked out what happens at x = 1441: the pack
  // wraps and the cell comes back out at x = −607, so every light edit and every chunk seam
  // beyond ±1024 blocks of the origin was being applied to a completely different place — or,
  // more often, to a chunk that is not loaded, where the adapter drops it and the light simply
  // never arrives. Nothing crashed and no check could see it, because every test in the suite
  // ran within a few hundred blocks of the origin. A full int32 per axis has no such limit.
  function Ring(capEntries) {
    this.a = new Int32Array(capEntries * 3);
    this.cap = capEntries; this.h = 0; this.t = 0; this.n = 0;
  }
  Ring.prototype.push = function (x, z, ymeta) {
    if (this.n === this.cap) this.grow();
    var i = this.t * 3;
    this.a[i] = x; this.a[i + 1] = z; this.a[i + 2] = ymeta;
    this.t = (this.t + 1) % this.cap; this.n++;
  };
  Ring.prototype.grow = function () {
    // ⚠ Growing beats dropping. The old ring in `Gen.lightPass` bails when it fills, and it can
    // afford to: that queue is one column and a bounded seed set. This one takes whatever the
    // player does to the world, and a dropped entry is a lit cell that stays lit for ever.
    var a = new Int32Array(this.cap * 6);
    for (var k = 0; k < this.n; k++) {
      var src = ((this.h + k) % this.cap) * 3;
      a[k * 3] = this.a[src]; a[k * 3 + 1] = this.a[src + 1]; a[k * 3 + 2] = this.a[src + 2];
    }
    this.a = a; this.cap *= 2; this.h = 0; this.t = this.n;
  };
  Ring.prototype.shift3 = function (out) {
    var i = this.h * 3;
    out[0] = this.a[i]; out[1] = this.a[i + 1]; out[2] = this.a[i + 2];
    this.h = (this.h + 1) % this.cap; this.n--;
  };
  L.Ring = Ring;

  L.init = function () {
    L.rm = new Ring(1 << 13);
    L.pr = new Ring(1 << 13);
    L.pending = 0;
    L.stats = { seeds: 0, removed: 0, spread: 0, slices: 0, budgetHits: 0 };
    return L;
  };

  // The third word: y (0..1023 after the −64 bias, which covers the whole world height with
  // room to spare), then the level, then the channel. x and z are stored whole (D-148).
  L.ymeta = function (y, level, ch) { return (((y + 64) & 1023) << 5) | ((level & 15) << 1) | (ch & 1); };
  L.uy = function (m) { return ((m >>> 5) & 1023) - 64; };
  L.ulevel = function (m) { return (m >>> 1) & 15; };
  L.uch = function (m) { return m & 1; };

  /** DimensionType.hasSkyLight of the live dimension (#254). hasCeiling only matters through it in vanilla's light engine. */
  L.hasSky = function () { return !NS.Dim || NS.Dim.current().hasSkyLight; };

  // channel 0 = block, 1 = sky
  var SKY = 1, BLOCK = 0;
  L.SKY = SKY; L.BLOCK = BLOCK;

  /** Seed the propagation pass directly. The one entry point tests and `World` should use. */
  L.seed = function (x, y, z, level, ch) {
    if (!L.pr) L.init();
    L.pr.push(x, z, L.ymeta(y, level, ch));
    L.stats.seeds++;
    L.pending = L.rm.n + L.pr.n;
  };

  // ── the world adapter ──────────────────────────────────────────────────────────────────────
  //
  // ⚠ The engine never touches `World` directly. It reads and writes through these four calls,
  // which is what lets `lightcheck` run the REAL engine over a hand-built room in a plain array
  // instead of testing a copy of it — the mistake `loadsrc.mjs`'s header warns about.
  var A = null;
  L.setAdapter = function (adapter) { A = adapter; return L; };
  L.worldAdapter = function () {
    var W = NS.World, SR = NS.States;
    return {
      block: function (x, y, z) { return W.getBlock(x, y, z); },
      get: function (x, y, z, ch) {
        var b = W.getLight(x, y, z);
        return ch === SKY ? (b >>> 4) : (b & 15);
      },
      set: function (x, y, z, ch, lv) {
        var cur = W.getLight(x, y, z);
        var byte = ch === SKY ? ((lv << 4) | (cur & 15)) : ((cur & 0xF0) | lv);
        W.setLight(x, y, z, byte);
      },
      // ⚠ `lightSolid`, NOT `opaque` — see the note in 02c_states.js (D-156).
      opaque: function (st) { return SR.lightSolid[st] === 1; },
      atten: function (st) { return SR.atten[st]; },
      side: function (st) { return SR.sideMask ? SR.sideMask[st] : 0; },
      emit: function (st) { return SR.emit[st]; },
      loaded: function (x, y, z) {
        if (y < CFG.WORLD_MIN_Y || y >= CFG.WORLD_MAX_Y) return false;
        var c = W.get(x >> 4, z >> 4);
        return !!c && c.state >= NS.CH.GENERATED;
      }
    };
  };
  // #357 — ChunkLightProvider's face test. `adapter.side(state)` is the 6-bit mask of faces the state's
  // culling shape covers fully (0 unless opaque AND hasSidedTransparency); light may not cross a
  // face either side covers. Bits are Reg.occlusion's (down, up, north, south, west, east), and
  // FB[d] is the bit of direction d in DX/DY/DZ below (+x, -x, +y, -y, +z, -z); d ^ 1 is the opposite.
  var FB = [5, 4, 1, 0, 3, 2];
  function faceBlocked(a, fromSt, toSt, d) {
    if (!a.side) return false;
    return ((a.side(fromSt) >> FB[d]) & 1) === 1 || ((a.side(toSt) >> FB[d ^ 1]) & 1) === 1;
  }
  function adapter() {
    if (!A) A = L.worldAdapter();
    return A;
  }

  // ── seeds ──────────────────────────────────────────────────────────────────────────────────

  // The six face neighbours, in one place: both passes and `queueEdit` walk them.
  var DX = [1, -1, 0, 0, 0, 0], DY = [0, 0, 1, -1, 0, 0], DZ = [0, 0, 0, 0, 1, -1];

  /**
   * A block changed at (x,y,z). Both channels are re-derived here rather than guessed: the old
   * stored level is what the removal pass needs, and the new level is what the propagation pass
   * needs, and they are computed from the block that is there NOW.
   */
  L.queueEdit = function (x, y, z) {
    if (!L.rm) L.init();
    var a = adapter();
    var st = a.block(x, y, z);
    var op = a.opaque(st);
    for (var ch = 0; ch <= 1; ch++) {
      var old = a.get(x, y, z, ch);
      var fresh = 0;
      // ⚠ D-150 — AN EMITTER IS USUALLY OPAQUE, and the first version of this function skipped emission
      // for opaque blocks entirely — so a player-placed GLOWSTONE, LAVA or JACK O'LANTERN lit
      // nothing at all, while the same block placed by worldgen lit correctly because
      // `Gen.lightPass` seeds emitters without asking about opacity. Every test in `lightcheck`
      // used a torch, which is not opaque, so nothing caught it. Vanilla stores an emitter's own
      // level in its own cell whatever its opacity; only the SKY channel is zero inside a solid.
      if (ch === BLOCK) fresh = a.emit(st);
      if (!op) {
        if (ch === SKY) {
          // sky: 15 if the cell above is 15 and this cell does not attenuate, else the ordinary
          // spread value. The full answer falls out of the propagation pass; this is the seed.
          // #254: a dimension without skylight (Nether, End) has no sky channel at all.
          var above = a.get(x, y + 1, z, SKY);
          if (above === 15 && a.atten(st) === 0 && L.hasSky() &&
              !faceBlocked(a, a.block(x, y + 1, z), st, 3)) fresh = 15;
        }
      }
      if (old > fresh) {
        a.set(x, y, z, ch, 0);
        L.rm.push(x, z, L.ymeta(y, old, ch));
        L.stats.seeds++;
      }
      if (fresh > 0) {
        a.set(x, y, z, ch, fresh);
        L.pr.push(x, z, L.ymeta(y, fresh, ch));
        L.stats.seeds++;
      } else if (old > 0 && !op) {
        // the cell keeps whatever a neighbour gives it; the removal pass will re-seed from
        // whatever is still brighter around it.
        L.pr.push(x, z, L.ymeta(y, a.get(x, y, z, ch), ch));
      }
    }

    // ⚠ D-153 — AND THE SIX NEIGHBOURS, OR A HOLE YOU DIG STAYS DARK. Removing a block opens a
    // cell that must now be lit BY ITS NEIGHBOURS, and nothing above seeds that: `fresh` covers
    // only the emitter case and the one sky case where full daylight falls straight in from
    // above. Dig sideways into a hill with a torch behind you, or break a block under anything
    // less than open sky, and the new cell stayed at zero until some unrelated edit happened to
    // re-run the flood through it. `fuzzcheck` measured 181 light discontinuities over 2,000
    // random edits, the worst of them a lit cell against a black one. Pushing the neighbours
    // costs six queue entries and lets the ordinary propagation pass flow in.
    if (!op) {
      for (var d = 0; d < 6; d++) {
        var nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d];
        if (ny < CFG.WORLD_MIN_Y || ny >= CFG.WORLD_MAX_Y) continue;
        if (!a.loaded(nx, ny, nz)) continue;
        for (var nc = 0; nc <= 1; nc++) {
          var nl = a.get(nx, ny, nz, nc);
          if (nl > 1) L.pr.push(nx, nz, L.ymeta(ny, nl, nc));
        }
      }
    }
    L.pending = L.rm.n + L.pr.n;
  };

  /**
   * ⚠ A CHUNK ARRIVED NEXT TO ONE THAT IS ALREADY LIT, and this is the seam fix.
   *
   * `Gen.lightPass` lights a column against nothing but itself, so the four vertical faces of
   * every chunk are dark where the neighbour should have spilled in. When a chunk becomes
   * resident, both sides of each shared face are seeded — its own lit cells facing out, and the
   * neighbour's facing in — and the ordinary BFS does the rest.
   *
   * Only cells that have somewhere darker to go are pushed (D-70's rule, applied across the
   * border): a cell whose opposite number is already at least one level below it cannot change
   * anything, and seeding it would put most of the sky in the queue.
   */
  L.queueBorder = function (cx, cz) {
    if (!L.rm) L.init();
    var a = adapter();
    var H = CFG.CHUNK_H, MINY = CFG.WORLD_MIN_Y;
    var faces = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    var pushed = 0;
    for (var f = 0; f < 4; f++) {
      var dx = faces[f][0], dz = faces[f][1];
      var ox = dx < 0 ? 0 : (dx > 0 ? 15 : 0);
      var oz = dz < 0 ? 0 : (dz > 0 ? 15 : 0);
      for (var t = 0; t < 16; t++) {
        // ⚠ each of the four faces is a ROW of 16: the axis the face is normal to is pinned to
        // 0 or 15, the other one walks. Getting the two ternaries the wrong way round seeds one
        // cell of each face and the diagonal of the other two — which is a seam that only shows
        // up as light stopping at a border, and is what `parcheck` §5 caught.
        var lx = dx === 0 ? t : ox, lz = dz === 0 ? t : oz;
        var wx = (cx << 4) + lx, wz = (cz << 4) + lz;
        var nx = wx + dx, nz = wz + dz;
        for (var y = MINY; y < MINY + H; y++) {
          // ⚠ loadedness is asked AT THE CELL, not once per column at the world floor. The
          // world's own adapter answers per column, but `lightcheck` and `parcheck` drive the
          // engine over hand-built volumes that are loaded only in a band of y — and an
          // adapter's answer is the adapter's business. Asking at y=−64 for a test world that
          // starts at y=0 skipped every face and made `queueBorder` a no-op.
          if (!a.loaded(nx, y, nz)) continue;
          for (var ch = 0; ch <= 1; ch++) {
            var mine = a.get(wx, y, wz, ch), theirs = a.get(nx, y, nz, ch);
            if (mine > theirs + 1) { L.pr.push(wx, wz, L.ymeta(y, mine, ch)); pushed++; }
            else if (theirs > mine + 1) { L.pr.push(nx, nz, L.ymeta(y, theirs, ch)); pushed++; }
          }
        }
      }
    }
    L.stats.seeds += pushed;
    L.pending = L.rm.n + L.pr.n;
    return pushed;
  };

  // ── the two passes ─────────────────────────────────────────────────────────────────────────

  var out = new Int32Array(3);

  /**
   * step(budgetMicros) -> true if work remains.
   *
   * Removal first, always: propagating into cells a removal is about to clear is wasted work and
   * — worse — can leave a stale level that the removal pass then treats as an independent source.
   */
  L.step = function (budgetMicros) {
    if (!L.rm) return false;
    if (L.rm.n === 0 && L.pr.n === 0) { L.pending = 0; return false; }
    var a = adapter();
    var budget = budgetMicros == null ? 2000 : budgetMicros;
    var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    var checkEvery = 512, sinceCheck = 0;
    L.stats.slices++;

    while (L.rm.n > 0) {
      L.rm.shift3(out);
      var x = out[0], z = out[1], m0 = out[2];
      var lv = L.ulevel(m0), ch = L.uch(m0), y = L.uy(m0);
      for (var d = 0; d < 6; d++) {
        var nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d];
        if (ny < CFG.WORLD_MIN_Y || ny >= CFG.WORLD_MAX_Y) continue;
        if (!a.loaded(nx, ny, nz)) continue;
        var nl = a.get(nx, ny, nz, ch);
        if (nl === 0) continue;
        // ⚠ the straight-down sky case: a column of 15s under a hole is NOT "one less each
        // step", so the ordinary `nl === lv - 1` test would walk past it and leave a lit shaft
        // hanging under a block the player just placed. Sky light falling into this cell from
        // directly above is removed whenever the cell above it was.
        var derived = (nl === lv - 1) ||
                      (ch === SKY && lv === 15 && nl === 15 && ny === y - 1);
        // ⚠ #358 — an EMITTER's own level is never derived from a neighbour (vanilla's
        // recalculateLevel starts each cell at its own luminance). A torch one level under a
        // removed glowstone matched `derived` and was zeroed for good.
        var em = (derived && ch === BLOCK) ? a.emit(a.block(nx, ny, nz)) : 0;
        if (em > 0) {
          if (em < nl) {
            a.set(nx, ny, nz, ch, em);
            L.rm.push(nx, nz, L.ymeta(ny, nl, ch));
            L.stats.removed++;
            markDirty(nx, ny, nz);
          }
          L.pr.push(nx, nz, L.ymeta(ny, em, ch));
        } else if (derived) {
          a.set(nx, ny, nz, ch, 0);
          L.rm.push(nx, nz, L.ymeta(ny, nl, ch));
          L.stats.removed++;
          markDirty(nx, ny, nz);
        } else if (nl >= lv) {
          L.pr.push(nx, nz, L.ymeta(ny, nl, ch));
        }
      }
      if (++sinceCheck >= checkEvery) {
        sinceCheck = 0;
        if (now() - t0 > budget) { L.stats.budgetHits++; L.pending = L.rm.n + L.pr.n; return true; }
      }
    }

    while (L.pr.n > 0) {
      L.pr.shift3(out);
      var x2 = out[0], z2 = out[1], m2 = out[2];
      var ch2 = L.uch(m2), y2 = L.uy(m2);
      var lv2 = a.get(x2, y2, z2, ch2);          // re-read: the queued level may be stale
      if (lv2 <= 0) { continue; }
      var fromSt = a.side ? a.block(x2, y2, z2) : 0;
      for (var d2 = 0; d2 < 6; d2++) {
        var mx = x2 + DX[d2], my = y2 + DY[d2], mz = z2 + DZ[d2];
        if (my < CFG.WORLD_MIN_Y || my >= CFG.WORLD_MAX_Y) continue;
        if (!a.loaded(mx, my, mz)) continue;
        var st = a.block(mx, my, mz);
        if (a.opaque(st)) continue;
        if (a.side && faceBlocked(a, fromSt, st, d2)) continue;
        var att = a.atten(st);
        // ⚠ VANILLA'S COST IS `max(1, opacity)`, NOT `1 + opacity`. `LayerLightEngine`
        // charges one level for the step OR the block's opacity, whichever is larger — so a
        // water block costs 1, exactly like air, and not 2. Getting this wrong makes every
        // underwater cell one level too dark and compounds with depth.
        // The one asymmetry: straight down, through a cell that does not attenuate at all, full
        // sky light keeps its level.
        var give = (ch2 === SKY && lv2 === 15 && my === y2 - 1 && att === 0)
          ? 15 : lv2 - (att > 1 ? att : 1);
        if (give <= 0) continue;
        if (a.get(mx, my, mz, ch2) >= give) continue;
        a.set(mx, my, mz, ch2, give);
        markDirty(mx, my, mz);
        L.pr.push(mx, mz, L.ymeta(my, give, ch2));
        L.stats.spread++;
      }
      if (++sinceCheck >= checkEvery) {
        sinceCheck = 0;
        if (now() - t0 > budget) { L.stats.budgetHits++; L.pending = L.rm.n + L.pr.n; return true; }
      }
    }

    L.pending = 0;
    return false;
  };

  function now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  /** A light change is a mesh change. The mesher bakes light into the vertex (D-132). */
  function markDirty(x, y, z) {
    var W = NS.World;
    if (!W || !W.markDirty) return;
    var cx = x >> 4, cz = z >> 4, sy = (y - CFG.WORLD_MIN_Y) >> 4;
    if (sy < 0 || sy >= CFG.SECTIONS_Y) return;
    W.markDirty(cx, cz, sy);
    var lx = x & 15, lz = z & 15, ly = (y - CFG.WORLD_MIN_Y) & 15;
    if (lx === 0) W.markDirty(cx - 1, cz, sy); else if (lx === 15) W.markDirty(cx + 1, cz, sy);
    if (lz === 0) W.markDirty(cx, cz - 1, sy); else if (lz === 15) W.markDirty(cx, cz + 1, sy);
    // smooth light/AO samples the diagonal neighbours at corners, so those meshes go stale too
    var dx = lx === 0 ? -1 : (lx === 15 ? 1 : 0), dz = lz === 0 ? -1 : (lz === 15 ? 1 : 0);
    if (dx && dz) W.markDirty(cx + dx, cz + dz, sy);
    var dy = (ly === 0 && sy > 0) ? -1 : ((ly === 15 && sy + 1 < CFG.SECTIONS_Y) ? 1 : 0);
    if (dy) {
      W.markDirty(cx, cz, sy + dy);
      if (dx) W.markDirty(cx + dx, cz, sy + dy);
      if (dz) W.markDirty(cx, cz + dz, sy + dy);
      if (dx && dz) W.markDirty(cx + dx, cz + dz, sy + dy);
    }
  }
  L.markDirty = markDirty;

  /** Run to completion. Tests and `lightcheck` use it; the game never does. */
  L.settle = function (maxSlices) {
    var n = maxSlices || 10000;
    while (n-- > 0) { if (!L.step(1e9)) return true; }
    return false;
  };
})(MCL);
