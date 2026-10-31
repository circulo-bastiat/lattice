// 06b_tintmap.js — the biome colour map. PLAN W6, the last third.
// Main thread only: it is a GPU resource, and the workers have no GPU.
//
// W5 computed every biome's grass, foliage and water colours and proved them against the game.
// This is what makes a block in the world take one.
//
// ── WHY A TEXTURE AND NOT A VERTEX ATTRIBUTE ─────────────────────────────────────────────
// Vanilla colours each vertex on the CPU, averaging the biome colours over a 5x5 block area so
// that a biome border is a soft gradient rather than a hard line. MC-Lite cannot copy that
// directly: its greedy vertex is TWO uint32 with no bits to spare (measured: `data0` has three
// spare bits and `data1` two), so a per-vertex RGB needs a third word — a 50% increase on the
// vertex memory of the format that carries almost all of the world by volume, for a colour that
// changes once every few hundred blocks.
//
// So the colour lives in a texture indexed by WORLD POSITION, which costs nothing per vertex
// because the shader already reconstructs world position from the section origin. Three things
// fall out of that choice:
//
//   * the blend is free — bilinear filtering across a 4-block texel grid IS the soft border,
//     and it is done by the texture unit rather than by the CPU;
//   * it is filled from the biome array the generator already produces, one 4x4 patch per
//     chunk, at the moment the chunk arrives;
//   * and it needs no per-vertex bookkeeping at all, so a chunk that is re-meshed for an
//     unrelated reason does not have to re-colour anything.
//
// What it costs instead is a window: the texture covers `SIZE * 4` blocks and has to follow the
// player. It re-anchors when the player approaches the edge and refills from the loaded chunks,
// which is a few milliseconds and happens every few hundred blocks of walking.
//
// ⚠ ONE TEXEL IS FOUR BLOCKS, and that is not an approximation of vanilla — it is vanilla's own
// resolution. Biomes are stored and sampled at quart resolution (`Climate.biomeAt` snaps to a
// 4x4x4 cell), so a finer map would be interpolating between duplicated values.
//
// ── WHO PUSHES IT TO THE GPU, AND WHEN (D-214) ───────────────────────────────────────────
// The map is WRITTEN from `World.installChunk`, which runs in the promise that settles when a
// worker hands a generated chunk back — that is, at a microtask checkpoint BETWEEN frames, at
// a moment no part of the frame loop chose. It used to be UPLOADED only from the backend's
// `beginFrame`, which is a different clock, and the two disagreed by however many chunks had
// landed since the last frame: measured at 1-6 versions behind at medium and high, permanently,
// because at a real render distance a chunk arrives on nearly every frame. It also meant the
// whole 768 KB went up on EVERY frame in which any chunk landed, which at medium is most of
// them — the "changes a handful of times a second" the old comment leaned on is only true at
// the Celeron preset's render distance of four.
//
// So the write drives the upload. A `sink` — the live backend's uploader — is registered when
// its texture is created and called by `flush()` the moment the bytes change, and a DIRTY
// RECTANGLE records which texels moved so one arriving chunk costs a 4x4x3 sub-box instead of
// the whole map. `held` batches a refill's thousands of writes into one upload. Both backends
// still call their own uploader from `beginFrame`; that is now a safety net for the cases the
// sink cannot see — the first frame, a restored context, a backend swapped under F9.
//
(function (NS) {
  'use strict';

  var T = NS.Tint = {};

  // 256 texels x 4 blocks = 1,024 blocks across, which covers a render distance of 32 chunks
  // with room to spare. Three layers of RGBA8 is 768 KB.
  var SIZE = 256;
  var LAYERS = 3;                       // 1 grass, 2 foliage, 3 water — the mesher's tint field
  T.SIZE = SIZE;
  T.LAYERS = LAYERS;
  T.BLOCKS = SIZE * 4;

  T.ready = false;
  T.originX = 0;                        // world x of texel 0, always a multiple of 4
  T.originZ = 0;
  T.data = null;                        // Uint8Array(SIZE * SIZE * LAYERS * 4), layer-major
  T.version = 0;                        // bumped on every write; a backend uploads when it lags
  T.uploaded = -1;
  T.fills = 0;
  T.reanchors = 0;
  T.uploads = 0;                        // how many times the sink actually ran

  // The dirty rectangle, in TEXELS, inclusive on both ends. Empty is x1 < x0 — chosen so that
  // the first markDirty of a run does not have to special-case a min/max seeded from nothing.
  T.dirtyX0 = 0; T.dirtyZ0 = 0; T.dirtyX1 = -1; T.dirtyZ1 = -1;
  T.sink = null;                        // the live backend's uploader (D-214)
  T.held = 0;                           // >0 while a caller is batching writes

  // The default colours, used for texels no chunk has filled yet. They are the plains ones, so
  // an unloaded edge reads as ordinary grass rather than as black.
  var DEF = [0x91bd59, 0x77ab2f, 0x3f76e4];

  var PLANE = SIZE * SIZE * 4;

  T.init = function () {
    if (T.data) return T;
    // ⚠ The renderer sizes its texture from `Gfx.TINT_TEXELS`, not from here, so that a backend
    // can be built without the world. If the two ever disagree the map would be uploaded into a
    // texture of a different shape and every colour in the world would shear.
    if (NS.Gfx && (NS.Gfx.TINT_TEXELS !== SIZE || NS.Gfx.TINT_LAYERS !== LAYERS)) {
      throw new Error('tint map is ' + SIZE + 'x' + LAYERS + ' but the renderer expects ' +
                      NS.Gfx.TINT_TEXELS + 'x' + NS.Gfx.TINT_LAYERS);
    }
    T.data = new Uint8Array(SIZE * SIZE * LAYERS * 4);
    T.clear();
    T.ready = true;
    return T;
  };

  // ── the dirty rectangle and the sink (D-214) ──────────────────────────────────────────
  //
  // ⚠ THE RECTANGLE MUST NEVER BE SMALLER THAN WHAT CHANGED. It is a promise to the backend
  // that everything outside it is already on the GPU, and a texel wrongly left outside is a
  // colour that is wrong until the next re-anchor scrubs the whole map. Every write below
  // marks before it flushes; `tintcheck` §9 diffs the bytes and asserts the rectangle covers
  // every one that moved, rather than trusting the marks.

  /** Grow the dirty rectangle to include this inclusive texel span. */
  T.markDirty = function (x0, z0, x1, z1) {
    if (T.dirtyX1 < T.dirtyX0) { T.dirtyX0 = x0; T.dirtyZ0 = z0; T.dirtyX1 = x1; T.dirtyZ1 = z1; return; }
    if (x0 < T.dirtyX0) T.dirtyX0 = x0;
    if (z0 < T.dirtyZ0) T.dirtyZ0 = z0;
    if (x1 > T.dirtyX1) T.dirtyX1 = x1;
    if (z1 > T.dirtyZ1) T.dirtyZ1 = z1;
  };

  T.dirtyEmpty = function () { return T.dirtyX1 < T.dirtyX0 || T.dirtyZ1 < T.dirtyZ0; };

  /** The backend calls this once it has taken the rectangle. */
  T.clearDirty = function () { T.dirtyX0 = 0; T.dirtyZ0 = 0; T.dirtyX1 = -1; T.dirtyZ1 = -1; };

  /**
   * Push whatever has changed to the GPU NOW. A no-op with no backend registered, while a
   * caller is batching, or when nothing moved — so it is safe to call after every write.
   */
  T.flush = function () {
    if (T.held || !T.sink || T.dirtyEmpty()) return false;
    T.uploads++;
    T.sink();
    return true;
  };

  T.clear = function () {
    var d = T.data;
    for (var l = 0; l < LAYERS; l++) {
      var c = DEF[l], r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
      var base = l * PLANE;
      for (var i = 0; i < PLANE; i += 4) {
        d[base + i] = r; d[base + i + 1] = g; d[base + i + 2] = b; d[base + i + 3] = 255;
      }
    }
    T.markDirty(0, 0, SIZE - 1, SIZE - 1);
    T.version++;
    T.flush();
  };

  /** The texel a world x (or z) falls in, relative to the current origin. May be out of range. */
  T.texelX = function (worldX) { return (worldX - T.originX) >> 2; };
  T.texelZ = function (worldZ) { return (worldZ - T.originZ) >> 2; };

  /**
   * anchor(cx, cz) — centre the window on a chunk. Rounds to a texel so that the mapping from
   * world position to texel never shifts by a fraction, which would make the whole world's
   * colours crawl by a texel every time the player crossed a block.
   */
  T.anchor = function (centreX, centreZ) {
    T.originX = ((centreX - T.BLOCKS / 2) >> 2) << 2;
    T.originZ = ((centreZ - T.BLOCKS / 2) >> 2) << 2;
    // one upload for the re-anchor, not one for the clear and another for every refilled chunk
    T.held++;
    try { T.clear(); } finally { T.held--; }
    T.reanchors++;
    T.flush();
    return T;
  };

  /** Is a chunk inside the window, with a texel of margin? */
  T.covers = function (cx, cz) {
    var x = T.texelX(cx << 4), z = T.texelZ(cz << 4);
    return x >= 0 && z >= 0 && x + 4 <= SIZE && z + 4 <= SIZE;
  };

  /**
   * Would this position be outside the window's comfortable middle? The caller re-anchors on
   * true. The margin is a quarter of the window, so a walking player re-anchors about once
   * every 256 blocks rather than once per step at the edge.
   */
  T.needsReanchor = function (worldX, worldZ) {
    var m = T.BLOCKS >> 2;
    return worldX - T.originX < m || worldZ - T.originZ < m ||
           worldX - T.originX > T.BLOCKS - m || worldZ - T.originZ > T.BLOCKS - m;
  };

  /** GameOptions.biomeBlendRadius (0..7, default 2): the blend is (2r+1)x(2r+1) columns. */
  T.radius = function () {
    var r = NS.Settings && NS.Settings.biomeBlendRadius;
    return r === undefined ? 2 : Math.max(0, Math.min(7, r | 0));
  };

  /**
   * BiomeColors.getColor / ColorResolver blend: the per-component integer mean of the tint over
   * the (2r+1)^2 columns around (wx, wz). `biomeAt(x, z)` answers the registry biome index.
   * r = 0 is the single column's colour.
   */
  T.blendColor = function (channel, wx, wz, r, biomeAt) {
    var B = NS.Biomes;
    if (r <= 0) return B.tintColor(channel, biomeAt(wx, wz), wx, wz);
    var R = 0, G = 0, Bl = 0, n = 0;
    for (var dz = -r; dz <= r; dz++) {
      for (var dx = -r; dx <= r; dx++) {
        var x = wx + dx, z = wz + dz, c = B.tintColor(channel, biomeAt(x, z), x, z);
        R += (c >> 16) & 255; G += (c >> 8) & 255; Bl += c & 255; n++;
      }
    }
    return (((R / n) | 0) << 16) | (((G / n) | 0) << 8) | ((Bl / n) | 0);
  };

  /**
   * fillChunk(cx, cz, biome) — write one chunk's 4x4 patch of texels from its per-column biome
   * array. `biome` is `Uint16Array(256)` or `Uint8Array(256)` of REGISTRY biome indices, the
   * array `Gen.genColumn` returns.
   *
   * The swamp is the one biome whose grass colour depends on position, so the sample position
   * matters: each texel is coloured from the CENTRE of its 4x4 cell, which is where its own
   * columns are.
   */
  T.fillChunk = function (cx, cz, biome) {
    if (!T.ready || !biome || !NS.Biomes || !NS.Biomes.ready) return false;
    var tx0 = T.texelX(cx << 4), tz0 = T.texelZ(cz << 4);
    if (tx0 < 0 || tz0 < 0 || tx0 + 4 > SIZE || tz0 + 4 > SIZE) return false;
    var B = NS.Biomes, d = T.data, r = T.radius();
    var look = function (x, z) {
      if ((x >> 4) === cx && (z >> 4) === cz) return biome[((z & 15) << 4) | (x & 15)];
      return NS.World && NS.World.biomeAt ? NS.World.biomeAt(x, z) : biome[((z & 15) << 4) | (x & 15)];
    };
    for (var qz = 0; qz < 4; qz++) {
      for (var qx = 0; qx < 4; qx++) {
        // the column at the centre of this quart cell
        var lx = (qx << 2) + 2, lz = (qz << 2) + 2;
        var wx = (cx << 4) + lx, wz = (cz << 4) + lz;
        var tx = tx0 + qx, tz = tz0 + qz;
        var off = ((tz * SIZE) + tx) * 4;
        for (var l = 0; l < LAYERS; l++) {
          var c = T.blendColor(l + 1, wx, wz, r, look);
          var o = l * PLANE + off;
          d[o] = (c >> 16) & 255; d[o + 1] = (c >> 8) & 255; d[o + 2] = c & 255; d[o + 3] = 255;
        }
      }
    }
    T.markDirty(tx0, tz0, tx0 + 3, tz0 + 3);
    T.fills++;
    T.version++;
    T.flush();
    return true;
  };

  /** Refill every loaded chunk. Used after a re-anchor. */
  T.refill = function (world) {
    if (!T.ready || !world) return 0;
    var n = 0;
    T.held++;
    try {
      world.chunks.forEach(function (ch) {
        if (ch && ch.biome && T.fillChunk(ch.cx, ch.cz, ch.biome)) n++;
      });
    } finally { T.held--; }
    T.flush();
    return n;
  };

  /**
   * follow(world, worldX, worldZ) — the one call the game makes each frame. Re-anchors and
   * refills when the player has wandered too near the edge. Cheap when it does nothing.
   */
  T.follow = function (world, worldX, worldZ) {
    if (!T.ready) return false;
    if (!T.needsReanchor(worldX, worldZ)) return false;
    T.anchor(worldX | 0, worldZ | 0);
    T.refill(world);
    return true;
  };

  /** The colour a tint channel has at a world position, straight off the CPU copy. For tests. */
  T.sample = function (channel, worldX, worldZ) {
    var tx = T.texelX(worldX), tz = T.texelZ(worldZ);
    if (tx < 0 || tz < 0 || tx >= SIZE || tz >= SIZE) return -1;
    var o = (channel - 1) * PLANE + ((tz * SIZE) + tx) * 4;
    return (T.data[o] << 16) | (T.data[o + 1] << 8) | T.data[o + 2];
  };
})(MCL);
