// 04_worldgen.js — terrain generation (docs/archive/ARCH.md §6b, D-30..D-35, D-58..D-63, D-70).
// Runs on: main thread AND workers (this is where the worker spends most of its time).
// No DOM.
//
// THE MIDDLE PATH (D-30). Modern Minecraft SILHOUETTE, 1.7-era cost:
//
//   * The shape of the world comes from THREE cheap 2D fbm fields — continentalness, erosion,
//     peaks-and-valleys — pushed through splines. That is a fixed ~20 noise octaves per COLUMN,
//     not a 3D density grid per VOXEL. It buys plains, plateaus, cliffs, valleys and mountains.
//   * A 3D density term exists, but only inside a +/-16 band around the surface AND only where
//     the column is already steep (D-31). Flat terrain — which is most of the world — pays zero.
//   * Terracing (D-59) is what produces plateaus and hard cliff faces without a density stack.
//     It is four lines of maths applied to the already-computed height.
//
// Everything after the shape — surface, ores, decoration, light — is a single pass over a
// scratch column, allocated once per thread and reused (D-40).

(function (NS) {
  'use strict';

  var CFG = NS.CFG;
  var MINY = CFG.WORLD_MIN_Y;                 // -64
  var H = CFG.CHUNK_H;                        // 320
  var SECV = CFG.SECTION_VOL;                 // 4096

  var G = NS.Gen = {
    seed: 0,
    seed64: 0n,
    perm: null,
    params: null,
    inited: false
  };

  // ⚠ SESSION 1's TWELVE-VALUE BIOME ENUM IS GONE (D-139). `G.BIO`, `G.LEGACY_BIOME_NAMES`,
  // `LEGACY_MAP`, `LEGACY_OF`, `G.legacyOf` and the per-column `cBiome` array were the bridge
  // W6 built so that the world could start storing the 61 REGISTRY biomes without decoration
  // being rewritten in the same stage. The bridge's own comment said the table and the enum
  // would go together when W8 ported the real feature lists. W8 ported them; the bridge outlived
  // it by a stage, still mapping 61 biomes down to 12 and writing the answer into an array
  // nothing read. Anything that wants the biome at a position asks `G.biomeAt` (a registry
  // index) or `NS.Biomes.name` (a name).

  /**
   * init(seed, params) — called once per thread, with the SAME seed everywhere.
   * params is whatever `Jobs` sent in the {t:'init'} message, so the main thread and the
   * workers cannot disagree about generation.
   */
  G.init = function (seed, params) {
    // The world seed is a 64-bit long (vanilla's); G.seed is its low 32 bits for the engine's own
    // int hashing, G.seed64 the exact BigInt the vanilla noise/structure ports want (#546).
    G.seed64 = BigInt.asIntN(64, typeof seed === 'bigint' ? seed : BigInt(seed | 0));
    G.seed = Number(BigInt.asIntN(32, G.seed64));
    // Missing keys fall back to the defaults rather than to `undefined`: a caller that predates
    // a new parameter must get the parameter's default, not a world generated out of NaN.
    var dflt = G.defaults();
    G.params = params || dflt;
    // ⚠ `ores` was W8a's name for the feature gate and `trees` was session 1's tree gate. Neither
    // survives in `defaults()` (D-139), and nothing in this repository passes either any more —
    // this is here for a SAVED WORLD or a bookmarked URL written before the rename, where the
    // caller meant "off" and would otherwise silently get "on". One-directional on purpose:
    // `Object.assign(G.defaults(), {ores: false})` carries `features: true` along with it, so
    // testing `features === undefined` would ignore the caller. Delete it when D-139 is old.
    if (G.params.ores === false || G.params.trees === false) G.params.features = false;
    for (var pk in dflt) if (G.params[pk] === undefined) G.params[pk] = dflt[pk];
    G.perm = NS.U.makePerm(G.seed);
    // ── the world stores REGISTRY REAL STATES from session 2 ─────────────────────────────
    // These used to be indices into the 49-entry hand-written table in src/02_blocks.js. They
    // are now each block's DEFAULT real state out of the full 1.18.2 registry, which is what
    // a section palette entry holds. Names are the interface; the numbers are resolved once
    // here and never spelled out anywhere.
    //
    // ⚠ `sculk` is gone (D-101). It is a 1.19 block and has no 1.18.2 equivalent, and the version
    // target is 1.18.2 (D-2), so Dan's call in session 2 was to DROP it rather than pin it to
    // a stand-in. The deep dark region below y=0 keeps its shape and its darkness; what it no
    // longer has is a block that says so. `deepslate` fills it, which is what 1.18.2 actually
    // puts down there. When the sculk family arrives it will arrive with the biome.
    var SR = NS.States;
    if (!SR || !SR.ready) throw new Error('Gen.init before the registry decoded');
    G.B = NS.Blocks.init();          // still used for B.T tile names by the atlas; not for ids
    var st = function (n) {
      var v = SR.stateOf(n);
      if (v === 0 && n !== 'air') throw new Error('worldgen names a block the registry does not have: ' + n);
      return v;
    };
    G.ids = {
      air: 0,
      // ⚠ THE CARVERS WRITE THIS, NOT PLAIN AIR (D-262). Vanilla's carvers write `cave_air`, and
      // the difference is invisible to every rule in the engine (`States.isAir` says yes to both)
      // but perfectly visible to the referee that compares against the real game's chunks.
      cave_air: st('cave_air'),
      stone: st('stone'),
      deepslate: st('deepslate'),
      dirt: st('dirt'),
      grass: st('grass_block'),
      podzol: st('podzol'),
      sand: st('sand'),
      sandstone: st('sandstone'),
      gravel: st('gravel'),
      water: st('water'),
      lava: st('lava'),
      bedrock: st('bedrock'),
      snow: st('snow_block'),
      ice: st('ice'),
      sculk: st('deepslate'),        // see the note above
      cactus: st('cactus'),
      short_grass: st('grass'),      // 1.18.2's name for what 1.20 calls short_grass
      poppy: st('poppy'),
      dandelion: st('dandelion'),
      dead_bush: st('dead_bush'),
      oak_log: st('oak_log'),
      oak_leaves: st('oak_leaves'),
      birch_log: st('birch_log'),
      birch_leaves: st('birch_leaves'),
      spruce_log: st('spruce_log'),
      spruce_leaves: st('spruce_leaves')
    };
    // stone-ore -> deepslate-ore. Session 1's own ore pass is gone (W8); `gencheck` still
    // reads this to know which states count as ore when it walks a generated world.
    var ORE_NAMES = ['coal', 'iron', 'copper', 'gold', 'redstone', 'lapis', 'diamond', 'emerald'];
    G.orePairs = ORE_NAMES.map(function (o) {
      return [st(o + '_ore'), st('deepslate_' + o + '_ore')];
    });
    if (NS.Caves) NS.Caves.init(G);

    // ── PLAN W3/W4: the column function and the climate, on every thread ─────────────────
    // These are initialised HERE, from the same `params` the workers were sent, for the same
    // reason `Gen.init` takes the seed rather than reading it: the main thread and every
    // worker must not be able to disagree about what the world is. W6 is where the column
    // function replaces the spline stack below and the biome dispatch starts choosing surface
    // blocks; until then this keeps both halves warm, tested and identical across threads.
    //
    // ⚠ The CLIMATE MODE and the WORLD SCALE are world-creation settings (D-111). They are
    // read once, here, and never again — changing either on a world that exists would move
    // every biome out from under everything already built in it. `Save` carries them beside
    // the seed for exactly that reason.
    // ⚠ REFUSE, do not skip. Before W6 this was `if (WG.ready) { ... }` and a thread without
    // the worldgen payload simply went on without a column function — and then read a null
    // eight frames later, inside the chunk generator, with a message that named neither the
    // missing data nor the thread. `Gen.init` throwing here is the difference between "the
    // worker was not sent the worldgen blob" and "cannot read properties of null".
    if (!NS.WG || !NS.WG.ready) throw new Error('Gen.init before the worldgen data decoded — this thread was not sent it');
    if (!NS.Column || !NS.Climate || !NS.Biomes || !NS.Surface) throw new Error('Gen.init: a worldgen module is missing from this bundle');
    {
      NS.Column.init(G.seed64, G.params.worldType || 'default');   // #329: the World Type
      if (NS.Earth) NS.Earth.init({ scale: G.params.worldScale });
      if (NS.Climate && NS.Climate.ready) {
        NS.Climate.setMode(G.params.climate === 'earth' ? NS.Climate.MODE_EARTH : NS.Climate.MODE_VANILLA);
      }
      // W5's biome registry, then W6's surface rules, then the bridge table that lets session
      // 1's decoration passes keep running against the new biomes.
      if (NS.Biomes && !NS.Biomes.ready) NS.Biomes.init();
      if (NS.Surface) NS.Surface.init(G.seed64);
      // W7's configured carvers. After the registry AND the worldgen blob, because it resolves
      // both: the four `configured_carver` files for its parameters and the block roster for
      // the set of blocks it is allowed to remove.
      if (NS.Carvers) NS.Carvers.init(G);
      // W8's feature pipeline. After the carvers, because it borrows their PRNG and their
      // chunk-key packing, and after the biome registry, whose per-step feature lists it reads.
      if (NS.Features) NS.Features.init(G);
      // W13's structure registry. After the features, because a structure is written INSIDE the
      // feature pass's step loop (a mineshaft is decoration step 3, the same list a lake and an
      // ore blob are in) and because it borrows the carvers' PRNG family and chunk-key packing.
      // W15's jigsaw pipeline FIRST: `Structures.init` compiles each structure's piece grammar,
      // and a jigsaw grammar cannot compile its start pool before the pools exist.
      if (NS.Jigsaw) NS.Jigsaw.init(G);
      if (NS.Structures) NS.Structures.init(G);
    }

    // ⚠ the biome volumes are keyed by chunk and not by seed, so a re-init with a new seed (or
    // a new climate mode, which moves every biome) has to throw them away (D-180).
    G.dropBiomeVolumes();
    // ⚠ and the structure starts with them, for the same reason and one stronger: a start is
    // keyed on (seed, region), so every cached one is wrong the instant the seed changes (D-184).
    if (NS.Structures && NS.Structures.ready) NS.Structures.dropCache();

    G.inited = true;
    return G;
  };

  /** The climate modes a world can be created in. The title screen offers exactly these. */
  G.CLIMATES = ['vanilla', 'earth'];

  G.defaults = function () {
    return {
      seaLevel: 63,
      caves: true,          // the noise cheese/worm fields (04b_caves.js)
      carvers: true,        // the configured carvers: tunnels, rooms and ravines (04i_carvers.js)
      aquifers: true,         // D-34 revisited: the fake costs one 2D noise per column
      surfaceBand: 16,        // D-31: 3D density is evaluated only +/- this many blocks
      lavaLevel: -54,         // cave lava, vanilla's y=-54
      // ⚠ `features` gates the WHOLE feature pipeline (W8): ore, disks, plants, flowers and
      // trees alike. Session 1's `ores`, `trees` and `decorate` flags are gone with the three
      // passes they switched — a flag that no longer gates anything is a name that lies (D-126),
      // and `trees` outlived its pass by a whole stage before the close-out sweep caught it
      // (D-139). `ores` is still ACCEPTED as an alias, in `G.init`, so a check written against
      // the old name keeps working.
      features: true,
      // ⚠ `structures` gates W13's start pass and every piece grammar registered against it.
      // Separate from `features` because they are separate stages with separate checks, and
      // because `cavecheck` turns the features off to test the carvers alone and must not
      // silently acquire a mineshaft while doing it.
      structures: true,
      // ── world-creation settings (D-111), fixed for the life of a world ────────────────
      // 'earth':   the default (D-182). biomes fall where a latitude climate model puts them
      //            (src/04f_earth.js) — temperature from latitude, Hadley-cell precipitation
      //            bands, lapse rate, rain shadow, Whittaker biome lookup.
      // 'vanilla': biomes fall where six noise fields put them, as in the real game. Offered
      //            as the explicit alternative on the title screen; never silently substituted.
      climate: 'earth',
      worldScale: 12000,       // blocks from the equator to the pole, 'earth' only
      // #329: vanilla's World Type — 'default', 'large_biomes' or 'amplified' (Column.WORLD_TYPES).
      worldType: 'default'
    };
  };

  // ⚠ `G.buildSplines` is GONE (PLAN W6). Session 1's four hand-tuned splines — continentalness
  // to a base height, erosion to a multiplier, peaks-and-valleys to relief, erosion to a squash
  // factor — were the worldgen. They are replaced by Mojang's own three spline trees, which
  // `src/04d_column.js` lifts out of `noise_settings/overworld.noise.terrain_shaper` and which
  // no longer live in code at all.

  // ---------------------------------------------------------------------------
  // ⚠ THE 2D FIELD STACK IS GONE FROM HERE (PLAN W6, and the last of it at the W8 close-out).
  // Sixteen frequency and offset constants (`F_CONT`, `O_ERO`, `F_PV`, …), `clamp1`, vanilla's
  // peaks-and-valleys `fold` (D-58) and the plateau `terrace` (D-59) were session 1's generator.
  // W6 replaced all of it with `src/04d_column.js`, which lifts Mojang's own three spline trees
  // out of `noise_settings/overworld.noise.terrain_shaper` — `C.terrace` there is the live
  // terracing, and `colcheck` is what grades it. The constants and the three functions survived
  // the swap as UNREFERENCED code for two stages, which is exactly long enough for a reader to
  // believe the header that used to sit here. Deleted at the W8 close-out (D-139), along with
  // `F_TREEMIX`/`O_TREEMIX` and the `cMix` array: that noise field existed for session 1's tree
  // pass, which is also gone, and filling it cost 256 `noise2` calls in every chunk generated
  // for the whole of W7 and W8 while nothing read a single one of them.
  // ---------------------------------------------------------------------------

  /**
   * columnAt(wx, wz) -> the per-column field bundle. Pure.
   *
   * ── PLAN W6: THIS IS THE SWAP ───────────────────────────────────────────────────────────
   * Session 1's own spline stack used to live here — three fbm fields through three splines,
   * about twenty noise octaves, plus a terracing pass and a steepness term that decided whether
   * the column needed 3D density at all. All of it is gone. The height now comes from
   * `Column.height` (PLAN W3, vanilla's own splines) and the biome from `Climate.biomeAt`
   * (W4 and W5, vanilla's own 7,578-entry table over the 61 real biomes).
   *
   * ⚠ Session 4: `biome` (the twelve-value legacy enum), `temp` and `hum` are GONE from this
   * bundle. The comment here said `biome` survived "because the tree and plant passes are
   * written against it" and `temp` "for the tree pass's snow-line test" — and D-139 deleted
   * both passes in session 3. Three fields were being written on every column lookup and read
   * by nothing, with a comment naming callers that no longer exist. `h` and `realBiome` are
   * what this returns.
   *
   * Called by genColumn for every column in the chunk, by the tree pass for columns in
   * NEIGHBOURING chunks (D-61), and by Player.spawn.
   */
  var _col = { h: 0, realBiome: 0 };
  var _clim = new Float64Array(6);

  G.columnAt = function (wx, wz) {
    var C = NS.Column;
    var h = C.heightAndClimate(wx, wz, _clim);
    _col.h = h;
    _col.realBiome = G.realBiomeAt(wx, h, wz, _clim);
    return _col;
  };

  /**
   * The real biome at a position, from an already-computed column climate. Quart-snapped
   * exactly as `Climate.biomeAt` is, so a caller that passes its own climate gets the same
   * answer as one that does not.
   */
  var _target = new Float64Array(6);
  var qBiomeTmp = new Uint8Array(16);
  G.realBiomeAt = function (wx, y, wz, clim) {
    var CL = NS.Climate;
    var sx = (wx >> 2) << 2, sz = (wz >> 2) << 2, sy = (y >> 2) << 2;
    if (clim && sx === wx && sz === wz) {
      // the caller's climate is for exactly this quart column: reuse it
      CL.targetFromColumn(clim, sx, sz, NS.Column.heightFromClimate(clim, sx, sz), sy, _target);
      return CL.biomeOfTarget(_target);
    }
    return CL.biomeAt(wx, y, wz);
  };


  /** The REAL biome at a column, as a registry index. What the world stores from W6 onward. */
  G.biomeAt = function (wx, wz) { return G.columnAt(wx, wz).realBiome; };

  // ── THE BIOME VOLUME (D-180) ────────────────────────────────────────────────────────────
  //
  // ⚠ A CHUNK'S BIOME IS NOT ONE NUMBER, and taking it as one is what stopped `lush_caves` and
  // `dripstone_caves` decorating for two whole stages (D-137). Vanilla stores a quart-resolution
  // VOLUME — one sample per 4x4x4 cell, computed once at the biomes stage — and every later
  // question is an array read. This is that volume. MC-Lite's world is 320 blocks tall rather
  // than vanilla's 384, so it is 4 x 80 x 4 = 1,280 cells a chunk instead of 1,536.
  //
  // ⚠ THIS IS A GENERAL FACILITY, NOT A CAVE-BIOME PATCH, and its SECOND CONSUMER IS STRUCTURE
  // PLACEMENT (PLAN W13-W18). "May this structure start here" is the same question a feature's
  // `biome` placement modifier asks — the biome at a 3D position — and the two must get the
  // same answer out of the same array, or a structure lands in a biome whose features say it
  // cannot be there. W13 wants `Gen.biomeAt3`; it does not want its own sampler.
  //
  // The cost is the whole reason D-137 rejected the union fix in writing, so it is stated
  // rather than assumed. One volume is 1,280 climate answers and costs **0.89 ms**, because
  // `Climate.columnBiomes` sweeps a whole quart COLUMN per call instead of answering one cell.
  // Asking `Climate.biomeAt` per cell — the shape D-137 measured — is 38 microseconds a call
  // and would be 49 ms. Chunk generation over gencheck's 49-chunk window went from 12.2 ms to
  // 13.5 ms — +1.3 — with the volume AND every biome in it decorating.

  var QVY = H >> 2;                    // 80 quart cells of y, from MINY up
  var QVOL = 16 * QVY;                 // 1,280 cells a chunk
  G.QVY = QVY;
  G.QVOL = QVOL;
  var volCache = new Map();
  var VOL_CACHE_MAX = 512;             // 640 KB of Uint8Array; the 3x3 feature pass wants 9
  var volClim = new Float64Array(6);

  /** Where cell (qx, qy, qz) of a chunk's volume lives. Column-major so a sweep writes runs. */
  function VIDX(qx, qy, qz) { return ((((qz << 2) | qx) * QVY) + qy); }
  G.VIDX = VIDX;

  /**
   * fillVolume(cx, cz, out, qc) — 16 quart columns, each swept in one `Climate.columnBiomes`
   * call. `qc` is the 16x6 column climate the chunk generator already has; without it the
   * climate is recomputed, which is what a neighbour chunk in the feature pass has to do.
   */
  function fillVolume(cx, cz, out, qc) {
    var CLM = NS.Climate, CO = NS.Column;
    var ox = cx << 4, oz = cz << 4;
    for (var qz = 0; qz < 4; qz++) {
      for (var qx = 0; qx < 4; qx++) {
        var qi = (qz << 2) | qx;
        var wx = ox + (qx << 2), wz = oz + (qz << 2);
        if (qc) { for (var k = 0; k < 6; k++) volClim[k] = qc[qi * 6 + k]; }
        else CO.climateInto(wx, wz, volClim);
        // ⚠ the RAW height, not the floored one the terrain uses: `Climate.biomeAt` anchors the
        // depth axis on `heightFromClimate`, and a volume that anchored it anywhere else would
        // be a second definition of "the biome at a point". `biomecheck` holds them equal.
        CLM.columnBiomes(volClim, wx, wz, CO.heightFromClimate(volClim, wx, wz), MINY, QVY, out, qi * QVY, 1);
      }
    }
    return out;
  }

  /**
   * biomeVolume(cx, cz, qc) -> Uint8Array(1280) of registry biome indices, cached per chunk.
   * The cache is what makes this affordable: the feature pass asks nine chunks for a volume
   * and the generator asks for the same nine again as it reaches them.
   */
  var lastVol = null, lastVolCx = 0, lastVolCz = 0;
  G.biomeVolume = function (cx, cz, qc) {
    // ⚠ the one-entry memo in front of the Map, and it earns its two comparisons: the `biome`
    // placement modifier asks a few hundred times per source chunk and every one of those
    // questions is about the same chunk.
    if (lastVol !== null && cx === lastVolCx && cz === lastVolCz) return lastVol;
    // the same packing `Carvers.keyOf` uses, written out rather than borrowed: `genColumn` asks
    // for a volume on every chunk and must not depend on a module the preset can turn off.
    var k = (cx & 0x3FFFFF) * 4194304 + (cz & 0x3FFFFF);
    var got = volCache.get(k);
    if (got) { lastVol = got; lastVolCx = cx; lastVolCz = cz; return got; }
    var vol = fillVolume(cx, cz, new Uint8Array(QVOL), qc);
    volCache.set(k, vol);
    if (volCache.size > VOL_CACHE_MAX) {
      var it = volCache.keys();
      for (var n = volCache.size - VOL_CACHE_MAX; n > 0; n--) volCache.delete(it.next().value);
    }
    lastVol = vol; lastVolCx = cx; lastVolCz = cz;
    return vol;
  };

  /** Throw the volumes away. `Gen.init` calls it, because a new seed invalidates every one. */
  G.dropBiomeVolumes = function () { volCache.clear(); lastVol = null; return G; };
  G.biomeVolumeCount = function () { return volCache.size; };

  /**
   * biomeAt3(wx, wy, wz) -> the registry biome index at a world position, out of the volume.
   *
   * ⚠ THE API THE REST OF THE PROJECT SHOULD ASK. `Gen.biomeAt(x, z)` is the SURFACE biome and
   * is a different question; anything underground — a feature's `biome` modifier today, a
   * structure's start check in W13-W18 — wants this one. y outside the world clamps to the
   * nearest cell rather than throwing: a placement provider may hand out a y above the build
   * limit and vanilla clamps there too.
   */
  G.biomeAt3 = function (wx, wy, wz) {
    var vol = G.biomeVolume(wx >> 4, wz >> 4);
    var qy = (wy - MINY) >> 2;
    if (qy < 0) qy = 0; else if (qy >= QVY) qy = QVY - 1;
    return vol[VIDX((wx >> 2) & 3, qy, (wz >> 2) & 3)];
  };

  /**
   * biomeAt3Sparse(wx, wy, wz) -> the same answer as `biomeAt3`, for a chunk that may never be
   * generated. PLAN W13's structure eligibility, and nothing else, should call it.
   *
   * ⚠ WHY IT EXISTS, MEASURED. `biomeAt3` builds and caches the whole 4x80x4 volume — 1,280
   * cells, 0.89 ms — and that is the right trade for the feature pass, which asks a few hundred
   * questions about the same chunk. A structure's eligibility test asks ONE question about a
   * candidate chunk that is usually nowhere near the player and will usually never be generated,
   * and paying 1,280 cells for one of them measured at **0.20 ms on every chunk generated** in
   * gencheck's cold 49-chunk window — three per cent of the whole budget, against PLAN §7's
   * "structures must not measurably move chunk generation time".
   *
   * ⚠ IT IS NOT A SECOND SAMPLER, WHICH D-180 SPECIFICALLY FORBADE. It is the SAME
   * `Climate.columnBiomes` sweep with the same arguments that `fillVolume` makes for that quart
   * column — one sixteenth of the work because it does one of the sixteen columns — so the two
   * are identical by construction rather than by assertion. And when the chunk's volume is
   * already cached, that array is the answer: a chunk in flight never takes this path at all.
   * `structcheck` §3 puts 20,000 positions through both and demands the same index every time.
   */
  var sparseCol = new Uint8Array(QVY);
  G.biomeAt3Sparse = function (wx, wy, wz) {
    var cx = wx >> 4, cz = wz >> 4;
    var k = (cx & 0x3FFFFF) * 4194304 + (cz & 0x3FFFFF);
    if ((lastVol !== null && cx === lastVolCx && cz === lastVolCz) || volCache.has(k)) {
      return G.biomeAt3(wx, wy, wz);
    }
    var CLM = NS.Climate, CO = NS.Column;
    var wqx = (cx << 4) + (((wx >> 2) & 3) << 2), wqz = (cz << 4) + (((wz >> 2) & 3) << 2);
    CO.climateInto(wqx, wqz, volClim);
    CLM.columnBiomes(volClim, wqx, wqz, CO.heightFromClimate(volClim, wqx, wqz), MINY, QVY, sparseCol, 0, 1);
    var qy = (wy - MINY) >> 2;
    if (qy < 0) qy = 0; else if (qy >= QVY) qy = QVY - 1;
    return sparseCol[qy];
  };

  // ⚠ `G.density3` is GONE. It was the 3D density term inside the surface band, and with the
  // column function in place there is no band: every column is solid below its height and air
  // above it. PLAN W0's deviation #1 said the 3D term would go; this is where it went.

  /** Cave carve test — delegated to 04b_caves.js so the two systems can be tuned apart (D-32). */
  G.isCave = function (wx, wy, wz) {
    return NS.Caves ? NS.Caves.carve(wx, wy, wz) !== 0 : false;
  };

  // ---------------------------------------------------------------------------
  // Per-thread scratch (D-40). One 16 x 320 x 16 column of blocks + light, plus the 2D
  // per-column field arrays. Allocated on first use, reused for every chunk forever.
  // ---------------------------------------------------------------------------

  var SB = null, SL = null;
  var cH = null, cReal = null, cTemp = null, cHum = null, qClim = null;
  var lq = null;                     // light BFS ring
  var LQCAP = 1 << 17;

  function ensureScratch() {
    if (SB) return;
    SB = new Uint16Array(H * 256);
    SL = new Uint8Array(H * 256);
    cH = new Int16Array(256);
    cReal = new Uint8Array(256);         // the REAL registry biome — what the world stores
    cTemp = new Float32Array(256);
    cHum = new Float32Array(256);
    qClim = new Float64Array(16 * 6);    // the column climate at each of the 16 quart cells
    lq = new Int32Array(LQCAP);
  }
  G.ensureScratch = ensureScratch;

  /** Local index into the scratch column: y is 0..319 (worldY + 64). */
  function IDX(x, y, z) { return (y << 8) | (z << 4) | x; }
  G.IDX = IDX;

  // ---------------------------------------------------------------------------
  // genColumn — the whole pipeline
  // ---------------------------------------------------------------------------

  /**
   * fingerprint(col) -> 8 hex chars: FNV-1a of sections + heightmap + biome + spawner/entity logs (#1900 C2ME-2).
   * The ?wkhash=1 install hook and tools/chunkgenprofile.mjs hashColumn are the same function (wkhashcheck pins it).
   */
  G.fingerprint = function (col) {
    var h = 0x811c9dc5;
    function u32(v) { h = Math.imul(h ^ (v & 255), 16777619); h = Math.imul(h ^ ((v >>> 8) & 255), 16777619); h = Math.imul(h ^ ((v >>> 16) & 255), 16777619); h = Math.imul(h ^ ((v >>> 24) & 255), 16777619); }
    function arr(a) { u32(a.length); for (var i = 0; i < a.length; i++) u32(a[i]); }
    u32(col.sec.length);
    for (var i = 0; i < col.sec.length; i++) {
      var s = col.sec[i];
      u32(s.u); u32(s.lu);
      if (s.u < 0) { u32(s.b); u32(s.n); arr(s.p); arr(s.d); }
      if (s.lu < 0) arr(s.l);
    }
    arr(col.hmap); arr(col.biome || []);
    var f32 = new Float32Array(1), i32 = new Int32Array(f32.buffer);
    function log(L) { L = L || []; u32(L.length); for (var j = 0; j < L.length; j++) { var e = L[j]; u32(e.length); for (var k = 0; k < e.length; k++) { var v = e[k]; if (Number.isInteger(v)) u32(v); else { f32[0] = v; u32(i32[0]); } } } }
    log(col.spawners); log(col.entities);
    return (h >>> 0).toString(16).padStart(8, '0');
  };

  /**
   * genColumn(cx, cz) -> {sec: Array(20) of Section, hmap: Uint16Array(256), biome: Uint8Array(256)}
   * Pure: same seed + same (cx,cz) always yields the same column, on any thread.
   */
  G.genColumn = function (cx, cz) {
    if (!G.inited) G.init(G.seed, G.params);
    ensureScratch();
    var P = G.params, ID = G.ids;
    var sea = P.seaLevel, seaL = sea - MINY;
    var band = P.surfaceBand;
    var ox = cx << 4, oz = cz << 4;
    var x, z, y, i, id;

    SB.fill(0);
    // #167: spawner entity ids the features record when NS.Spawner is not in this JS context
    // (the worker bundle); genColumn hands them back as `res.spawners`.
    G.spawnerLog = [];
    G.nestLog = [];       // beehive nests [x,y,z,ticks[]] for World.stockNests (no NS.Bee in the worker)
    G.entityLog = [];     // template entities (04t writeEntities): [id, x, y, z, yaw]

    // --- 1. column fields ---------------------------------------------------
    //
    // One climate evaluation per column, and the climate of every fourth column kept, because
    // the biome is a QUART-resolution question: vanilla asks it once per 4x4 cell, sixteen
    // times per chunk, not 256. Asking per column costs the whole noise stack again and
    // measured 4-8 ms of the chunk on its own.
    var maxH = MINY;
    for (z = 0; z < 16; z++) {
      for (x = 0; x < 16; x++) {
        i = (z << 4) | x;
        var wx0 = ox + x, wz0 = oz + z;
        cH[i] = NS.Column.heightAndClimate(wx0, wz0, _clim) | 0;
        cTemp[i] = _clim[4];
        cHum[i] = _clim[5];
        if ((x & 3) === 0 && (z & 3) === 0) {
          var q = (((z >> 2) << 2) | (x >> 2)) * 6;
          for (var k = 0; k < 6; k++) qClim[q + k] = _clim[k];
        }
        if (cH[i] > maxH) maxH = cH[i];
      }
    }

    // --- 1b. biomes: the VOLUME, not sixteen surface samples (D-180) ----------
    //
    // This used to ask for the biome at each of the sixteen quart columns' own surface and stop
    // there, which is why a chunk had one feature list and cave biomes never got one. It now
    // builds the whole 4x80x4 volume — the same 1,280 cells vanilla stores — and the per-column
    // array the world keeps is one slice out of it, taken at each quart column's surface.
    var vol = G.biomeVolume(cx, cz, qClim);
    var qBiome = qBiomeTmp;
    for (var qz = 0; qz < 4; qz++) {
      for (var qx = 0; qx < 4; qx++) {
        var qi = (qz << 2) | qx;
        var hq = cH[((qz << 2) << 4) | (qx << 2)];
        var qy = (hq - MINY) >> 2;
        if (qy < 0) qy = 0; else if (qy >= QVY) qy = QVY - 1;
        qBiome[qi] = vol[qi * QVY + qy];
      }
    }
    for (z = 0; z < 16; z++) {
      for (x = 0; x < 16; x++) {
        i = (z << 4) | x;
        cReal[i] = qBiome[((z >> 2) << 2) | (x >> 2)];
      }
    }

    // --- 2. terrain: solid below the surface, water up to sea level ----------
    //
    // Two runs per column and nothing else. With the column function in place there is no 3D
    // density, no surface band and no steepness test: the world is solid below `h` and air
    // above it. Everything the old code did here with `density3` was the thing PLAN W0's
    // deviation #1 exists to remove.
    var STONE = ID.stone, WATER = ID.water;
    for (z = 0; z < 16; z++) {
      for (x = 0; x < 16; x++) {
        i = (z << 4) | x;
        var hh = cH[i];
        var col0 = (z << 4) | x;
        var top = hh - MINY;
        if (top > H - 1) top = H - 1;
        for (y = 0; y <= top; y++) SB[col0 | (y << 8)] = STONE;
        // ⚠ THE SEA FILLS BELOW `seaLevel`, NOT UP TO IT (D-225). Vanilla's global fluid
        // picker is `FluidStatus(seaLevel, water)` and `FluidStatus.at(y)` returns water only
        // for `y < fluidLevel`, so the topmost water block in the real game is y = 62, not 63.
        // Measured against the golden world: 92% of `river` columns had MC-Lite's top block
        // exactly one higher than vanilla's before this line said `<`.
        for (y = top + 1; y < seaL && y < H; y++) SB[col0 | (y << 8)] = WATER;
      }
    }

    // --- 3. the surface rules ------------------------------------------------
    //
    // Mojang's own rule tree, run over every column. The two skips are derived from the tree
    // by `Surface` itself, not assumed about it here — see the notes in 04h_surface.js.
    var SFC = NS.Surface;
    for (z = 0; z < 16; z++) {
      for (x = 0; x < 16; x++) {
        i = (z << 4) | x;
        var hs = cH[i];
        var wxs = ox + x, wzs = oz + z;
        var col1 = (z << 4) | x;
        // ⚠ `waterY` IS VANILLA'S `waterHeight`: the y of the topmost fluid PLUS ONE, and
        // `Integer.MIN_VALUE` when the column has no fluid over it at all (D-225). With the
        // sea filling below `sea`, a column whose terrain top is exactly `sea - 1` has NO water
        // on it — and saying otherwise made every such column answer `dirt` where vanilla says
        // `grass_block`, because the tree's `water offset=0` test is `y >= waterY`.
        SFC.beginColumn(wxs, wzs, cReal[i], hs, hs < sea - 1 ? sea : SFC.NO_WATER);
        var ms = SFC.minSurface(), dm = SFC.deepMax(), run = SFC.constRun();
        var runLo = run[0], runHi = run[1], runSt = run[2];
        var yTop = hs - MINY;
        if (yTop > H - 1) yTop = H - 1;
        for (y = yTop; y >= 0; y--) {
          var wy = y + MINY;
          if (wy >= runLo && wy <= runHi) { SB[col1 | (y << 8)] = runSt; continue; }
          if (wy > dm && wy < ms) continue;
          var st = SFC.at(wy);
          if (st !== 0) SB[col1 | (y << 8)] = st;
        }
      }
    }

    // --- 4. caves ------------------------------------------------------------
    // ⚠ AFTER the surface, which is vanilla's order: `ChunkStatus.SURFACE` runs before
    // `ChunkStatus.CARVERS`. It is why a cave that breaks the surface leaves the grass and dirt
    // it cut through hanging over the entrance instead of a clean bore through stone.
    if (P.caves && NS.Caves) NS.Caves.carveChunk(SB, cx, cz, cH, sea);
    // ⚠ The CARVERS run after the noise caves and are a separate system, not a variant of them
    // (PLAN W7). The noise fields are a pure function of position; the carvers are random walks
    // that start in one chunk and end up to 240 blocks away in another, so they are applied by
    // asking every chunk within range what it sends into this one. Order matters only in that
    // both must run before ores: a carver that removed an ore body would be wrong, and it
    // cannot, because ores are not in the carvable set.
    if (P.carvers && NS.Carvers) NS.Carvers.carveChunk(SB, cx, cz, cH, sea);

    // --- 5. features: ores, disks, and (W8b onward) everything else -----------
    // ⚠ Vanilla's order, and it is load-bearing: CARVERS then FEATURES. An ore blob placed
    // before a cave was carved would be carved away; placed after, it hangs in the cave wall,
    // which is how you find one.
    // --- 5b. structures ------------------------------------------------------
    // ⚠ THE BRACKET, NOT A PASS. Vanilla writes a structure INSIDE the decoration loop — the
    // structures of step N, then the biome features of step N — which is why a lake (step 1)
    // is overwritten by a mineshaft (step 3) and not the other way round. `beginChunk` decides
    // which starts reach this chunk (pure, no blocks read, no neighbour generated) and
    // `Features.applyChunk` calls `writeUpTo` as it crosses each step; the flush after it is
    // what makes a world with `features: false` still get its structures.
    if (P.structures && NS.Structures && NS.Structures.ready) NS.Structures.beginChunk(cx, cz);
    if (P.features && NS.Features && NS.Features.ready) NS.Features.applyChunk(SB, cx, cz, cH, sea);
    if (P.structures && NS.Structures && NS.Structures.ready) NS.Structures.writeUpTo(SB, cx, cz, 10, cH, sea);

    // --- 7. heightmap + light -------------------------------------------------
    var hmap = new Uint16Array(256);
    G.lightPass(hmap, maxH);

    // --- 8. pack --------------------------------------------------------------
    var sec = new Array(CFG.SECTIONS_Y);
    for (var sy = 0; sy < CFG.SECTIONS_Y; sy++) sec[sy] = packSection(sy);

    // ⚠ The world's biome array holds a REGISTRY biome — one of the 61, at quart resolution,
    // which is where the tint texture and every biome question in the game read from (W6).
    // Session 1's twelve-value enum that used to be carried alongside it is gone (D-139).
    var biome = new Uint8Array(256);
    biome.set(cReal);
    return { sec: sec, hmap: hmap, biome: biome, spawners: G.spawnerLog, entities: G.entityLog, nests: G.nestLog };
  };

  // ---------------------------------------------------------------------------
  // Surface
  // ---------------------------------------------------------------------------

  // ⚠ `G.surfacePass` and `G.deepDarkPass` are GONE (PLAN W6).
  //
  // `surfacePass` painted a hand-written stack per legacy biome — grass on dirt for a plains,
  // sand for a desert, a switch with twelve cases. Mojang's own `surface_rule` tree replaces it
  // whole, and `04h_surface.js` runs that tree: 97 block placements over 11 condition types,
  // which is why a badlands now has terracotta BANDS and a lukewarm ocean has sand while a cold
  // one has gravel. Nothing here needed to know any of that.
  //
  // `deepDarkPass` scattered `sculk` onto cave surfaces below y = -8. D-101 dropped sculk (it is
  // a 1.19 block and the target is 1.18.2) and mapped it to deepslate, which made the pass a
  // no-op the moment the surface rules started putting deepslate below y = 0 anyway. It is
  // deleted rather than left as dead code; the deep dark comes back with its biome in G19.

  // ---------------------------------------------------------------------------
  // ⚠ ORES ARE GONE FROM HERE (PLAN W8). `G.ORES`, `G.orePass` and `placeBlob` were session
  // 1's nine hand-written bands and a random walk — a good fake of a thing MC-Lite now has for
  // real. `src/04j_features.js` runs vanilla's own 29 configured ore features through vanilla's
  // own placement modifiers, so the diamond peak at y=-59 is the DATA's and not a number
  // somebody typed. Deleted rather than left switchable: two ore systems would have made twice
  // as much ore, and a flag that defaults to false is dead code with a name that lies (D-126).
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // ⚠ TREES ARE GONE FROM HERE (PLAN W8, §24). `G.treePass`, `G.treesOfChunk`, `treeCount`,
  // `pickSpecies`, `G.placeTree` and `put` were session 1's tree system: a per-chunk count and
  // a species picked by switching on the TWELVE-VALUE legacy biome enum, four hand-written
  // shapes, and a 3x3 neighbourhood walk so a canopy would not clip at a chunk border (D-61).
  // `src/04j_features.js` and `src/04k_feat_trees.js` run vanilla's own configured tree features
  // instead — 10 foliage placers, 7 trunk placers and 5 decorators, out of the JSON — so a taiga
  // grows the spruce the data says it grows.
  //
  // ⚠ THIS DELETION WAS OWED SINCE W8 AND WAS NOT MADE UNTIL THE CLOSE-OUT SWEEP FOUND IT.
  // Three documents said `treePass` was gone while `if (P.trees) G.treePass(cx, cz)` still ran
  // every chunk, so the world grew session 1's trees standing next to vanilla's. Measured over
  // 200 chunks before the deletion: **29.8 logs and 101.9 leaves per chunk with the legacy pass
  // against 25.5 and 76.6 without it** — one log in seven and one leaf in four was a tree from
  // the wrong system. The comment eleven lines above this one, written the same day, says why
  // it should not have survived: "two ore systems would have made twice as much ore." Two tree
  // systems made a quarter as many trees again, and nothing measured it, because every check
  // counted trees rather than comparing the count against a world without the second source.
  // Deleted, not switched off (D-126), and `P.trees` went with it (D-139).
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Ground cover: grass, flowers, cacti, dead bushes. One hash per column.
  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // ⚠ PLANTS ARE GONE FROM HERE (PLAN W8b). `G.plantPass` scattered grass, flowers and cacti
  // from a per-column hash against session 1's twelve-value biome enum. `src/04j_features.js`
  // runs vanilla's own `random_patch` and `flower` features instead, through vanilla's own
  // placement chains — which is why a plains now has PATCHES of cornflowers and oxeye daisies
  // rather than an even sprinkle: the flower is chosen by a `noise_threshold_provider`, and
  // that is data rather than a decision anyone here made. Deleted, not switched off (D-126).
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Light seeding (D-27). Top-down sky column, then a BFS bounded to this column for the
  // horizontal spread that makes cave mouths and overhangs read correctly. Cross-chunk spill
  // is the main thread's job (MCL.Light); the error at a chunk seam is at most one level.
  // ---------------------------------------------------------------------------

  G.lightPass = function (hmap, maxH) {
    // Indexed by REAL STATE now, not by the 49 legacy ids (session 2).
    var SR = NS.States, atten = SR.atten, emit = SR.emit, opaque = SR.opaque;
    // ⚠ two different questions, two different tables (D-156). `opaque` is opaque BY MATERIAL and
    // is what the HEIGHTMAP below wants; `lightSolid` is vanilla's `getLightBlock === 15` and is
    // the only thing light may ask. A slab, a stair, a carpet and a snow layer are the first and
    // not the second, and asking `opaque` made all 196 of them full light blockers.
    var lightSolid = SR.lightSolid;
    var side = SR.sideMask || null;   // #357: faces a sided state covers; light may not cross one
    var FBIT = [5, 4, 1, 0, 3, 2];   // Reg.occlusion bit of each FACE_D* direction
    var x, z, y, i;
    SL.fill(0);

    // ⚠ D-154 — THE CEILING OF THE SPREAD IS WHAT IS ACTUALLY THERE, NOT THE TERRAIN HEIGHT.
    // `maxH` is the column height from `Column.heightAndClimate`, computed BEFORE the features
    // run — and a tree is six to thirty blocks taller than the ground it stands on. The
    // horizontal spread was bounded by that number, so every cell in and above a canopy kept
    // whatever the straight-down pass gave it and was never lit from the side: measured at
    // **553 lateral sky discontinuities in four freshly generated columns**, air at 12 next to
    // air at 15. `topSeen` is the highest non-air cell the sky pass actually walked past, which
    // includes everything the features placed.
    //
    // ⚠ D-193 — AND `topSeen` MUST BE THE HIGHEST NON-AIR CELL, WHICH IS NOT THE HEIGHTMAP. It
    // used to be fed from `hi`, the highest OPAQUE cell, which is what the heightmap wants and
    // is a different question: LEAVES, snow layers, plants and glass are not opaque, so a tree
    // whose canopy stands above the tallest opaque block in the chunk put its own top four to
    // six blocks ABOVE `topL` — and the seed scan below, which stops at `topL`, never queued the
    // open sky beside that canopy. The cells under the leaves were then lit only by the long way
    // round from below the ceiling, leaving sky 15 next to sky 12. This is exactly the hole
    // D-154 set out to close and it stayed open for every canopy that outgrew its chunk's
    // stone: `lightcheck` §5b measured 33 such cells in a 5x5 region in earth mode and 5 in
    // vanilla mode at seed 3, so it was never a mode-specific bug — earth mode (D-182) only
    // made it the default world and so made it reachable by a check that names no mode.
    var topSeen = 0;
    var hasSky = !NS.Dim || NS.Dim.current().hasSkyLight;   // #254: no skylight in the Nether/End
    var topL = maxH - MINY + 2;
    if (topL > H - 1) topL = H - 1;
    if (topL < 1) topL = 1;

    // --- sky, straight down, per column -------------------------------------
    for (z = 0; z < 16; z++) {
      for (x = 0; x < 16; x++) {
        var sky = 15, hi = -1, hiAny = -1;
        for (y = H - 1; y >= 0; y--) {
          i = IDX(x, y, z);
          var id = SB[i];
          // two tops, because there are two questions (D-193): `hi` is the highest OPAQUE cell
          // and belongs to the heightmap; `hiAny` is the highest cell that is not air at all and
          // is what bounds the lateral seed scan. The walk always sees `hiAny` before it can
          // break: `sky` only starts falling at the first attenuating block, so the break at
          // `sky === 0` is always below the highest non-air cell.
          if (hiAny < 0 && id !== 0) hiAny = y;
          if (hi < 0 && id !== 0 && opaque[id]) hi = y;
          // ⚠ vanilla's cost is max(1, opacity) (see 08_lighting.js): full sky light passes
          // straight down through a zero-opacity cell for free, and every other step down costs
          // one level, or the block's opacity if that is larger.
          var a = atten[id];
          // #357: straight down, the face test applies too (a bottom slab's DOWN face, a top slab's UP)
          if (side && y < H - 1 && ((side[SB[i + 256]] & 1) || (side[id] & 2))) { sky = 0; }
          else if (!(sky === 15 && a === 0)) { sky -= (a > 1 ? a : 1); if (sky < 0) sky = 0; }
          SL[i] = hasSky ? sky << 4 : 0;
          if (sky === 0 && hasSky) break;
        }
        if (hi < 0) {
          // no opaque block above: still record the highest non-air voxel
          for (y = H - 1; y >= 0; y--) if (SB[IDX(x, y, z)] !== 0) { hi = y; break; }
        }
        hmap[(z << 4) | x] = hi < 0 ? 0 : hi;
        if (hiAny > topSeen) topSeen = hiAny;
      }
    }

    // --- horizontal spread, sky then block ----------------------------------
    var qh = 0, qt = 0;
    function push(v) { lq[qt] = v; qt = (qt + 1) & (LQCAP - 1); if (qt === qh) qh = (qh + 1) & (LQCAP - 1); }

    if (topSeen + 2 > topL) topL = Math.min(H - 1, topSeen + 2);

    // Sky spread. Seeding EVERY lit cell would enqueue most of the sky, so only cells that
    // actually have somewhere darker to spread into go in the queue: a cell whose brightest
    // reachable neighbour is already lv-1 can never change anything (D-70).
    for (y = 0; y <= topL; y++) {
      for (z = 0; z < 16; z++) for (x = 0; x < 16; x++) {
        i = IDX(x, y, z);
        var lv = SL[i] >> 4;
        if (lv <= 1 || lightSolid[SB[i]]) continue;
        var d = lv - 1;
        if ((x > 0  && (SL[i - 1]   >> 4) < d) ||
            (x < 15 && (SL[i + 1]   >> 4) < d) ||
            (z > 0  && (SL[i - 16]  >> 4) < d) ||
            (z < 15 && (SL[i + 16]  >> 4) < d) ||
            (y > 0  && (SL[i - 256] >> 4) < d)) push(i);
      }
    }
    spread(lq, qh, qt, true);

    // block light: seed from emitters. Nothing above the terrain emits, so the scan stops at
    // the same ceiling as the sky pass.
    qh = 0; qt = 0;
    for (y = 0; y <= topL; y++) {
      for (z = 0; z < 16; z++) for (x = 0; x < 16; x++) {
        i = IDX(x, y, z);
        var e = emit[SB[i]];
        if (e) { SL[i] = (SL[i] & 0xF0) | e; push(i); }
      }
    }
    spread(lq, qh, qt, false);
    return topL;

    function spread(q, head, tail, isSky) {
      var shift = isSky ? 4 : 0, mask = isSky ? 0x0F : 0xF0;
      while (head !== tail) {
        var idx = q[head]; head = (head + 1) & (LQCAP - 1);
        var lv = (SL[idx] >> shift) & 15;
        if (lv <= 1) continue;
        var yy = idx >> 8, zz = (idx >> 4) & 15, xx = idx & 15;
        for (var f = 0; f < 6; f++) {
          var nx = xx + CFG.FACE_DX[f], ny = yy + CFG.FACE_DY[f], nz = zz + CFG.FACE_DZ[f];
          if (nx < 0 || nx > 15 || nz < 0 || nz > 15 || ny < 0 || ny >= H) continue;
          var ni = IDX(nx, ny, nz), nid = SB[ni];
          if (lightSolid[nid]) continue;
          if (side && (((side[SB[idx]] >> FBIT[f]) & 1) || ((side[nid] >> FBIT[f ^ 1]) & 1))) continue;
          var na = atten[nid];
          var nl = lv - (na > 1 ? na : 1);
          if (nl <= 0) continue;
          if (((SL[ni] >> shift) & 15) >= nl) continue;
          SL[ni] = (SL[ni] & mask) | (nl << shift);
          q[tail] = ni; tail = (tail + 1) & (LQCAP - 1);
          if (tail === head) return;      // ring full: bail rather than corrupt
        }
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Packing (docs/archive/ARCH.md §4)
  // ---------------------------------------------------------------------------

  var palTmp = new Uint16Array(512);
  var idxTmp = new Uint16Array(SECV);
  // id -> palette slot, with a stamp so the table never has to be cleared between sections.
  //
  // ⚠ THESE USED TO BE 1024 ENTRIES AND THE ID WAS MASKED WITH `& 1023`. That was safe while
  // the world held 49 hand-written block ids and completely wrong the moment it held registry
  // real states, which run to 20,343: every state above 1023 aliased onto another block, so
  // the terrain came out as a smear of whatever `state & 1023` happened to name. It generated,
  // it meshed, it drew — it was just a different world. Sized from the registry now, and
  // gencheck's block histogram is what catches a regression.
  var palSlot = null, palStamp = null;
  var packStamp = 0;
  function ensurePalTables() {
    var need = (NS.Reg && NS.Reg.ready) ? NS.Reg.realCount : 65536;
    if (palSlot && palSlot.length >= need) return;
    palSlot = new Int32Array(need);
    palStamp = new Int32Array(need);
    packStamp = 0;
  }

  function packSection(sy) {
    var S = NS.Section;
    var base = sy * SECV;
    var i, v;

    // blocks
    var n = 0, uniform = true, first = SB[base];
    for (i = 1; i < SECV; i++) if (SB[base + i] !== first) { uniform = false; break; }

    var lFirst = SL[base], lUniform = true;
    for (i = 1; i < SECV; i++) if (SL[base + i] !== lFirst) { lUniform = false; break; }

    var sec;
    if (uniform) {
      sec = { u: first, lu: -1 };
    } else {
      // build the palette
      n = 0;
      var idxOf = idxTmp;
      ensurePalTables();
      packStamp++;
      for (i = 0; i < SECV; i++) {
        v = SB[base + i];
        if (palStamp[v] !== packStamp) { palStamp[v] = packStamp; palSlot[v] = n; palTmp[n++] = v; }
        idxOf[i] = palSlot[v];
      }
      var bits = S.BITS_FOR_COUNT(n);
      var per = 32 / bits, words = SECV / per;
      var pal = new Uint16Array(bits === 16 ? Math.max(n, 512) : (1 << bits));
      pal.set(palTmp.subarray(0, n));
      var d = new Uint32Array(words);
      var sh = Math.log2(per) | 0, im = per - 1;
      for (i = 0; i < SECV; i++) {
        var val = idxOf[i];
        if (val) d[i >>> sh] |= val << ((i & im) * bits);
      }
      sec = { u: -1, p: pal, b: bits, d: d, n: n, lu: -1 };
    }

    if (lUniform) sec.lu = lFirst;
    else { sec.lu = -1; sec.l = new Uint8Array(SL.buffer, SL.byteOffset + base, SECV).slice(); }
    return sec;
  }
})(MCL);
