// 07_world.js — chunk store; the main thread is the sole owner of world data (D-39).
// Main thread only. docs/archive/ARCH.md §5.

(function (NS) {
  'use strict';

  var CFG = NS.CFG, S = NS.Section, CH = NS.CH;

  var W = NS.World = {
    seed: 0,
    seed64: 0n,
    chunks: new Map(),     // numeric key -> chunk (D-20)
    frame: 0,
    camCx: 0, camCz: 0,    // the camera's own chunk, set by `stream()` — D-452's tick gates read it

    // Streaming budgets (D-43, D-71, D-87). These are the numbers that decide whether a 2200G
    // stutters while flying; they are deliberately small and deliberately here, not inline.
    // Settings.applyPreset() overwrites all of them, and Main scales the per-frame ones down
    // when the last frames were slow — a stall is always cheaper to prevent than to recover from.
    maxGenInflight:  4,
    maxMeshInflight: 6,
    maxMeshPerFrame: 6,
    genCap: 4, meshCap: 6,  // the EFFECTIVE in-flight caps stream() last used (scaled by the pool, #1898)
    maxChunks:       1024,  // hard resident cap; the furthest are evicted past it (D-89)
    evictMargin:     2,     // chunks are dropped this far beyond the render distance

    load: 1,                // 0..1 per-frame budget scale, set by Main from the frame profiler

    genInflight: 0,
    meshInflight: 0,
    stats2: { gen: 0, meshed: 0, evicted: 0, cancelled: 0, snapReuse: 0, snapAlloc: 0 }
  };

  // In-flight job ids, so work for a chunk the player has left behind can actually be cancelled
  // instead of merely ignored when it lands (D-87).
  W.genJobs  = new Map();   // chunk key    -> job id
  W.meshJobs = new Map();   // section key  -> job id
  W.sectionKey = function (cx, cz, sy) {
    return (cx & 0x3FFFFF) * 83886080 + (cz & 0x3FFFFF) * 20 + sy;
  };

  function fullVis() {
    var v = new Uint16Array(CFG.SECTIONS_Y);
    v.fill(0x7FFF);
    return v;
  }

  /** Packed numeric key. The ONLY place this encoding exists. */
  W.key = function (cx, cz) { return (cx & 0x3FFFFF) * 4194304 + (cz & 0x3FFFFF); };

  // #254 (#254) — one chunk store per dimension. `W.chunks` stays THE CURRENT dimension's map, so every existing
  // reader (getBlock, stream, mesher, lighting) is untouched; `setDimension` swaps which map that is.
  W.dimension = 'overworld';
  W.dims = { overworld: W.chunks };
  W.dimChunks = function (name) {
    name = NS.Dim.norm(name);
    return W.dims[name] || (W.dims[name] = new Map());
  };
  W.dimType = function () { return NS.Dim.get(W.dimension); };
  /** Make `name` the live dimension. Returns the previous name. Chunks of other dimensions stay resident. */
  W.setDimension = function (name) {
    name = NS.Dim.norm(name);
    var prev = W.dimension;
    if (name === prev) return prev;
    W.dims[prev] = W.chunks;
    W.chunks = W.dimChunks(name);
    W.dimension = name;
    NS.Dim.cur = name;
    // ServerPlayerEntity.worldChanged -> Criteria.CHANGED_DIMENSION.trigger(this, origin, destination)
    if (NS.Player && NS.Adv && NS.Adv.trigger) NS.Adv.trigger(NS.Player, 'minecraft:changed_dimension', { player: NS.Player, from: prev, to: name });
    return prev;
  };

  W.init = function (seed) {
    W.seed64 = BigInt.asIntN(64, typeof seed === 'bigint' ? seed : BigInt(seed | 0));
    W.seed = Number(BigInt.asIntN(32, W.seed64));
    W.dimension = 'overworld'; if (NS.Dim) NS.Dim.cur = 'overworld';
    W.dims = { overworld: W.dims.overworld || new Map() };
    W.chunks = W.dims.overworld;
    W.chunks.clear();
    return W;
  };

  W.makeChunk = function (cx, cz) {
    var sec = new Array(CFG.SECTIONS_Y);
    for (var sy = 0; sy < CFG.SECTIONS_Y; sy++) sec[sy] = S.makeUniform(0, 0);
    return {
      cx: cx, cz: cz,
      sec: sec,
      hmap: new Uint16Array(256),
      biome: null,               // Uint8Array(256) once generated
      state: CH.EMPTY,
      meshDirty: new Uint32Array(1),
      meshGen: new Uint32Array(CFG.SECTIONS_Y),   // bumped by markDirty; a mesh result older than this is dropped (KW-48b-3)
      meshed: new Uint32Array(1),   // bit sy set = this section has a mesh on the GPU
      // Per-section visibility mask (ARCH 9.1). 0x7FFF = "everything connects to everything",
      // which is the only safe value before the mesher has told us otherwise: it can never make
      // the flood cull something it should have drawn, it just does not help yet.
      vis: fullVis(),
      lastUse: 0
    };
  };

  W.get = function (cx, cz) { return W.chunks.get(W.key(cx, cz)); };

  W.getOrCreate = function (cx, cz) {
    var k = W.key(cx, cz), c = W.chunks.get(k);
    if (!c) { c = W.makeChunk(cx, cz); W.chunks.set(k, c); }
    return c;
  };

  W.secYOf = function (y) { return (y - CFG.WORLD_MIN_Y) >> 4; };

  W.getBlock = function (x, y, z) {
    if (y < CFG.WORLD_MIN_Y || y >= CFG.WORLD_MAX_Y) return 0;
    var c = W.get(x >> 4, z >> 4);
    if (!c || c.state < CH.GENERATED) return 0;
    var ly = y - CFG.WORLD_MIN_Y;
    return S.get(c.sec[ly >> 4], ((ly & 15) << 8) | ((z & 15) << 4) | (x & 15));
  };

  W.getLight = function (x, y, z) {
    if (y < CFG.WORLD_MIN_Y) return 0;
    if (y >= CFG.WORLD_MAX_Y) return S.packLight(15, 0);
    var c = W.get(x >> 4, z >> 4);
    if (!c) return S.packLight(15, 0);
    var ly = y - CFG.WORLD_MIN_Y;
    return S.getLight(c.sec[ly >> 4], ((ly & 15) << 8) | ((z & 15) << 4) | (x & 15));
  };

  /**
   * setLight — the one writer of the light bytes on this thread. `08_lighting.js` owns the
   * algorithm; this owns where the byte lives. It does NOT dirty meshes: the light engine marks
   * the section and its face neighbours itself, once, for the cell it just changed (D-142), and
   * doing it twice would re-mesh a chunk for every cell of a BFS.
   */
  W.setLight = function (x, y, z, byte) {
    if (y < CFG.WORLD_MIN_Y || y >= CFG.WORLD_MAX_Y) return false;
    var c = W.get(x >> 4, z >> 4);
    if (!c || c.state < CH.GENERATED) return false;
    var ly = y - CFG.WORLD_MIN_Y;
    S.setLight(c.sec[ly >> 4], ((ly & 15) << 8) | ((z & 15) << 4) | (x & 15), byte);
    return true;
  };

  /**
   * canSurvive(x,y,z,state) -> bool — the LIVE-world twin of `Features.supported` (D-140), which
   * answers the same three rules against a worldgen scratch buffer. Both must say the same thing
   * or a plant that worldgen refused to place could be placed by hand, and vice versa.
   *
   * An UNLOADED neighbour counts as support, exactly as an out-of-chunk neighbour does there:
   * the alternative is a rule whose answer depends on what happens to be resident, which would
   * make a vine at the load frontier pop out of existence as you walk away from it. The floor
   * and ceiling cases are in the block's own column, so this only ever bites the any-face case.
   */
  W.canSurvive = function (x, y, z, st) {
    var SR = NS.States;
    // ⚠⚠ **THE JAR'S OWN RULE FIRST, WHEN THE JAR HAS ONE FOR THIS BLOCK** (D-346). The classes
    // below it are derived from `material` plus two hand-written lists, which is right for the
    // plants it was built for and cannot express a rail, a cactus, a lever or a door — all of
    // which could be placed in MID-AIR until this. `SR.rule` comes from
    // `tools/golden/cansurvive-1.18.2.tsv`, which reads which of vanilla's 55 `canSurvive`
    // overrides owns each block; a block whose override this engine has not implemented has
    // rule 0 and falls through to exactly the behaviour it had before, and `DATA.supportOwed`
    // counts how many those are.
    var rule = SR.rule ? SR.rule[st] : 0;
    if (rule) {
      var r = W.surviveRule(x, y, z, st, rule);
      if (r !== -1) return !!r;
    }
    var cls = SR.support[st];
    if (!cls) return true;
    var b;
    if (cls === 1) {
      if (!W.loadedAt(x, z)) return true;
      b = W.getBlock(x, y - 1, z);
      // ⚠ OPAQUE, not merely solid, and NOT "any other plant" (D-165). Leaves are solid — they
      // have a collision box — so the old rule grew grass out of tree canopies, 19 of them in 36
      // chunks; and "or anything with a floor rule" let plants tower on each other. What a plant
      // stands on is dirt, sand, stone, farmland: material-opaque ground. The one exception is a
      // block standing on ITSELF, and only for the blocks that really do that.
      return SR.floorOk(st, b);                        // the one implementation, D-169
    }
    if (cls === 2) {
      if (!W.loadedAt(x, z)) return true;
      return SR.ceilingOk(st, W.getBlock(x, y + 1, z));
    }
    if (cls === 4) {                                   // behind: the wall it hangs on (D-158)
      var f = SR.propValue(st, NS.Reg.PROP.facing);
      var d4 = FACING_TO_FACE[f];
      if (d4 === undefined) return true;               // no facing to read: no rule to apply
      // the support is OPPOSITE the way it faces — a torch facing east is on the wall to its west
      var ox = x - SUP_DX[d4], oy = y - SUP_DY[d4], oz = z - SUP_DZ[d4];
      if (!W.loadedAt(ox, oz)) return true;
      return SR.anyFaceOk(W.getBlock(ox, oy, oz));
    }
    for (var d = 0; d < 6; d++) {
      var nx = x + SUP_DX[d], ny = y + SUP_DY[d], nz = z + SUP_DZ[d];
      if (!W.loadedAt(nx, nz)) return true;
      if (SR.anyFaceOk(W.getBlock(nx, ny, nz))) return true;
    }
    return false;
  };
  /**
   * The seven survival rules read out of the jar (D-346). Returns 1, 0, or -1 for "not mine".
   *
   * ⚠ EVERY ONE OF THESE IS A READING OF A `canSurvive` OVERRIDE, and the reading is written
   * beside it. Nothing here is a guess about what feels right: the three support TYPES, the
   * blocks each rule names, and the fact that soul sand supports a full block's worth despite
   * sinking you are all in `tools/golden/cansurvive-1.18.2.tsv`.
   *
   * ⚠ AN UNLOADED NEIGHBOUR ANSWERS "yes", the same as every rule above: refusing a placement
   * because the chunk beside it has not arrived is the failure mode this file's own comment
   * warns about, and it is worse than allowing one.
   */
  W.surviveRule = function (x, y, z, st, rule) {
    // The rules themselves live in `02k_survive.js`, written against a level (#19); this is the
    // LIVE level: the resident chunks, the tag registry, the light engine.
    return NS.Survive.eval(LIVE, x, y, z, st, rule);
  };
  var LIVE = {
    miss: false,
    getBlock: function (x, y, z) { return W.getBlock(x, y, z); },
    loadedAt: function (x, z) { return W.loadedAt(x, z); },
    tag: function (tag, state) {
      if (!(NS.Tags && NS.Tags.ready)) return -1;   // no tag registry: "cannot answer", not "no" (D-351)
      return NS.Tags.stateIn(tag, state) ? 1 : 0;
    },
    light: function (x, y, z) { return W.rawBrightness(x, y, z); },
    sky: function (x, y, z) { return W.canSeeSky(x, y, z) ? 1 : 0; }
  };
  // The names the rules use, mirrored onto World for the callers that read `World.BID` and friends.
  W.BID = NS.Survive.BID = {};
  NS.Survive.onResolve = function (SV) {
    W.BID = SV.BID;
    W.B_ICE = SV.B_ICE; W.B_PACKED_ICE = SV.B_PACKED_ICE; W.B_BARRIER = SV.B_BARRIER;
    W.B_HONEY = SV.B_HONEY; W.B_SOUL_SAND = SV.B_SOUL_SAND; W.B_SAND = SV.B_SAND;
    W.B_RED_SAND = SV.B_RED_SAND; W.B_WATER = SV.B_WATER; W.B_LAVA = SV.B_LAVA;
    W.V_LAYERS_8 = SV.V_LAYERS_8;
  };
  W.resolveIds = function () { return NS.Survive.resolveIds(); };
  W.groundOk = function (g, x, y, z, below) { return NS.Survive.groundOk(LIVE, g, x, y, z, below); };
  W.growUp = function (b) { return NS.Survive.growUp(b); };
  W.growHead = function (b) { return NS.Survive.growHead(b); };
  W.growBody = function (b) { return NS.Survive.growBody(b); };
  W.growMagmaShy = function (b) { return NS.Survive.growMagmaShy(b); };
  W.distOf = function (st) { return NS.Survive.distOf(st); };
  W.OWED_GROUND = NS.Survive.OWED_GROUND;
  var SUP_DX = NS.Survive.SUP_DX, SUP_DY = NS.Survive.SUP_DY, SUP_DZ = NS.Survive.SUP_DZ;
  var FACING_TO_FACE = NS.Survive.FACING_TO_FACE;

  /**
   * ⚠ LIGHT, THE WAY VANILLA'S `LevelReader` ASKS FOR IT, READ OUT OF THE JAR AND NOT ASSUMED
   * (D-349). `getRawBrightness(pos, 0)` is `max(blockLight, skyLight - 0)`, and `canSeeSky` is
   * `getBrightness(SKY, pos) >= getMaxLightLevel()` — the interface default, whose whole body is
   * that comparison. Two rules need them: a crop dies in the dark and a mushroom dies in the
   * light, and neither is a threshold this file invented.
   */
  W.rawBrightness = function (x, y, z) {
    var L = W.getLight(x, y, z);
    var sky = (L >> 4) & 15, blk = L & 15;
    return sky > blk ? sky : blk;
  };
  /**
   * ⚠ THE MAXIMUM LIGHT LEVEL IS THE ENGINE'S OWN, NOT A 15 TYPED HERE (D-305). `getLight` above
   * the top of the world returns "nothing is in the way", so that IS the value a cell under open
   * sky has, and asking the engine for it costs one array-free call.
   */
  W.canSeeSky = function (x, y, z) {
    var top = (W.getLight(x, CFG.WORLD_MAX_Y, z) >> 4) & 15;
    return (((W.getLight(x, y, z) >> 4) & 15) >= top);
  };

  /**
   * A tag question about a REAL STATE.
   *
   * ⚠⚠ **AND A RECORD OF WHETHER IT COULD BE ANSWERED AT ALL** (D-351). Eight of the rules ask a
   * tag question, and `02f_tags.js` is a MAIN-THREAD, OPTIONAL module: a headless check that did
   * not ask for it gets an engine with no tag registry. The first draft answered "no" in that
   * case, so every tag rule REFUSED EVERYTHING — and `fuzzcheck` failed with *"a plant was
   * refused a placement onto dirt"*, which is a correct rule, correctly implemented, denied its
   * data. **A rule that cannot be evaluated must say so, not say no.** The flag is read once per
   * `surviveRule` call and turns the whole answer into -1, which is this engine's existing word
   * for "no opinion" and falls through to the material-derived class the build always had.
   */
  var tagMiss = false;
  W.tagBelow = function (tag, state) {
    if (!(NS.Tags && NS.Tags.ready)) { tagMiss = true; return 0; }
    return NS.Tags.stateIn(tag, state) ? 1 : 0;
  };


  W.loadedAt = function (x, z) {
    var c = W.get(x >> 4, z >> 4);
    return !!c && c.state >= CH.GENERATED;
  };

  /**
   * The support cascade (D-155). Vanilla sends a block update to the six neighbours of every
   * change and breaks anything whose `canSurvive` is false; without it, mining the dirt under a
   * grass tuft leaves the tuft hanging in the air, which is the floating-grass Dan reported and
   * which D-140 only fixed on the worldgen side.
   *
   * It is a QUEUE, not recursion: a removal is itself an edit that goes back through `setBlock`,
   * so a two-tall grass, a stacked sugar cane and a column of vines all fall in one pass without
   * the stack depth being a function of how tall they are. `cascading` makes the nested calls
   * enqueue instead of starting a second drain, so the whole chain is one drain from the top.
   * The budget is a fuse, not a rule: nothing in the block set can chain that far, so hitting it
   * means a support rule became cyclic, and stopping beats freezing the frame.
   */
  var cascadeQ = [], cascading = false;
  /**
   * #352 — blocks whose `getStateForNeighborUpdate` does `scheduleTick(pos, this, 1)` when they cannot
   * survive, and whose `scheduledTick` then breaks them (SugarCane, Cactus, Bamboo, ChorusPlant/Flower,
   * AbstractPlantPart -> kelp, cave/twisting/weeping vines, Scaffolding). One block per tick, bottom-up.
   */
  var DEFERRED_NAMES = ['sugar_cane', 'cactus', 'bamboo', 'chorus_plant', 'chorus_flower', 'kelp', 'kelp_plant',
    'cave_vines', 'cave_vines_plant', 'twisting_vines', 'twisting_vines_plant', 'weeping_vines',
    'weeping_vines_plant', 'scaffolding'];
  var deferredBlk = null;
  W.deferredBreak = function (st) {
    if (!deferredBlk) {
      deferredBlk = Object.create(null);
      for (var i = 0; i < DEFERRED_NAMES.length; i++) { var b = NS.Reg.id[DEFERRED_NAMES[i]]; if (b !== undefined) deferredBlk[b] = 1; }
    }
    return deferredBlk[NS.States.block[st]] === 1;
  };
  function cascadeFrom(x, y, z) {
    for (var d = 0; d < 6; d++) cascadeQ.push(x + SUP_DX[d], y + SUP_DY[d], z + SUP_DZ[d]);
    if (cascading) return;
    cascading = true;
    var guard = 0;
    while (cascadeQ.length && guard++ < 4096) {
      var cz2 = cascadeQ.pop(), cy = cascadeQ.pop(), cx2 = cascadeQ.pop();
      var st = W.getBlock(cx2, cy, cz2);
      if (st === 0) continue;
      // ⚠ BOTH TABLES, like the placement gate in `setBlock` (#351): 129 blocks carry a jar rule and
      // no material class, and their rule ran at placement and never again.
      var rl = NS.States.rule ? NS.States.rule[st] : 0;
      if (!NS.States.support[st] && !rl) continue;
      if (W.canSurvive(cx2, cy, cz2, st)) continue;
      if (W.deferredBreak(st) && NS.Behave && NS.Behave.ready) { NS.Behave.schedule(cx2, cy, cz2, 1); continue; }
      // farmland (20) and dirt path (21) turn back into dirt (`FarmlandBlock.setToDirt`), not air
      W.setBlock(cx2, cy, cz2, (rl === 20 || rl === 21) ? NS.States.stateOf('dirt')   /* #7650: was NS.Reg.stateOf, which does not exist: a village's farmland threw here and ended the frame loop */ : 0);
    }
    cascadeQ.length = 0;
    cascading = false;
  }

  /**
   * setBlock — MUST dirty the neighbouring section whenever the edit sits on a section face,
   * or you get seams. This is the single most common bug in this file (docs/archive/ARCH.md §5).
   */
  W.setBlock = function (x, y, z, id, noGate) {
    if (y < CFG.WORLD_MIN_Y || y >= CFG.WORLD_MAX_Y) return false;
    var cx = x >> 4, cz = z >> 4;
    var c = W.get(cx, cz);
    if (!c || c.state < CH.GENERATED) return false;
    // Vanilla REFUSES a placement that cannot survive rather than placing it and breaking it on
    // the next tick, so a plant never exists floating even for a frame (D-155). This is the live
    // twin of the `Features.setBlock` gate D-140 put on the worldgen side; the save replay writes
    // through `Section.set`, not here, so a rebuilt column is not re-judged by it.
    // ⚠ THE GATE ASKS ABOUT BOTH TABLES (D-346). It used to read `States.support[id]` alone —
    // the material-derived class — so a block whose rule comes from the jar's `canSurvive` table
    // instead never reached `canSurvive` at all, and every rule added by D-346 was dead on
    // arrival. The rules were right and the door in front of them was shut: exactly the shape of
    // D-330's slider and D-334's swing, where a finished model had no caller.
    var SRW = NS.States;
    // `noGate` (#9261): a mutually-supporting stack (dripleaf stem + leaf) is placed whole, vanilla flag 3 then ticks it.
    if (!noGate && id !== 0 && (SRW.support[id] || (SRW.rule && SRW.rule[id])) && !W.canSurvive(x, y, z, id)) return false;
    var ly = y - CFG.WORLD_MIN_Y, sy = ly >> 4;
    var lx = x & 15, lz = z & 15, lyy = ly & 15;
    var old = S.get(c.sec[sy], (lyy << 8) | (lz << 4) | lx);   // #306: Behave.changed's `old`
    S.set(c.sec[sy], (lyy << 8) | (lz << 4) | lx, id);

    // Dirty every section whose 18^3 mesh neighbourhood contains this voxel. Faces are only
    // affected by the 6 face neighbours, but baked AO reads the DIAGONALS too, so an edit in a
    // section corner has to dirty the diagonal section as well or that corner keeps stale
    // shading. Missing this is the single most common bug in this file.
    var x0 = lx === 0 ? -1 : 0, x1 = lx === 15 ? 1 : 0;
    var y0 = lyy === 0 ? -1 : 0, y1 = lyy === 15 ? 1 : 0;
    var z0 = lz === 0 ? -1 : 0, z1 = lz === 15 ? 1 : 0;
    for (var dy = y0; dy <= y1; dy++) {
      var ny = sy + dy;
      if (ny < 0 || ny >= CFG.SECTIONS_Y) continue;
      for (var dz = z0; dz <= z1; dz++) {
        for (var dx = x0; dx <= x1; dx++) W.markDirty(cx + dx, cz + dz, ny);
      }
    }

    if (NS.Poi && NS.Poi.onChange) NS.Poi.onChange(x, y, z, id);
    if (NS.Light && NS.Light.queueEdit) NS.Light.queueEdit(x, y, z);
    // Every edit is journalled here, at the ONE place a block can change, so persistence can
    // never miss a change made by some future caller that forgot to tell it (docs/archive/ARCH.md §13).
    if (NS.Save && NS.Save.record) NS.Save.record(x, y, z, id);
    // AFTER the edit is committed and journalled: the cascade re-reads the world, so it has to
    // see the change that caused it (D-155).
    cascadeFrom(x, y, z);
    // PLAN G2 layer 2: the six neighbours recompute their connection shape, and the block entity
    // store is created or dropped. Same argument as the journal above — this is the ONE place a
    // block can change, so a caller cannot forget (D-205).
    if (NS.Behave && NS.Behave.ready) NS.Behave.changed(x, y, z, old);
    return true;
  };

  /**
   * visOf(cx,cz,sy) -> 15-bit face-pair connectivity mask (ARCH 9.1).
   * An unloaded column reports "fully connected" so the flood runs straight through the load
   * frontier rather than stopping at it and hiding the chunk that is about to arrive.
   */
  W.visOf = function (cx, cz, sy) {
    var c = W.chunks.get(W.key(cx, cz));
    return c ? c.vis[sy] : 0x7FFF;
  };

  /**
   * markDirty(cx, cz, sy) — flag a section for remesh AND stop trusting its old visibility mask
   * (KW-48/D-800). `c.vis[sy]` is a snapshot from the section's LAST completed mesh job; the
   * instant a block inside it changes, that snapshot describes a layout that no longer exists,
   * and the flood (`G.floodVisible`, 10_gfx.js) keeps reading it every frame until the new mesh
   * job's callback lands (`requestMesh`'s `.then`, below). A break that OPENS a sightline — the
   * single most common shape, since a solid pocket you are about to dig into reads as
   * fully-discononnected (vis 0) right up until you open it — leaves every section reachable
   * ONLY through this one, however far away and however already meshed, unvisited by the flood:
   * not culled by a decision, just never reached, which `floodHas` (10_gfx.js) draws exactly
   * like real occlusion. That is Dan's KW-48 report: solid, breakable, particle-shedding blocks
   * that are not drawn, and it self-heals only once the section's queued mesh job happens to be
   * serviced — which `W.stream`'s per-frame mesh budget (`meshPerFrame`) can leave pending for
   * many frames while a player is actively mining and re-dirtying several sections a second.
   * The fix is the same rule this file already states for a section nobody has meshed yet
   * (`installChunk`, below) and the one `floodHas`/`World.visOf` state for an unloaded column:
   * an UNCERTAIN vis mask must read as fully connected, never as blocked — "a culling test may
   * only ever say NO when it is certain" (D-171/D-198's own words, 10_gfx.js). Stamping the
   * permissive mask here, the ONE place every edit-triggered dirty flows through, means the
   * flood over-draws (safe) for the few frames until the real mesh lands instead of hiding real,
   * already-uploaded geometry behind a fact that stopped being true the moment this ran.
   */
  W.markDirty = function (cx, cz, sy) {
    var c = W.get(cx, cz);
    if (c) { c.meshDirty[0] |= (1 << sy); c.vis[sy] = 0x7FFF; c.meshGen[sy]++; }
  };

  /**
   * snapshotFor(cx, cz, sy) -> MeshSnapshot (docs/archive/ARCH.md §7)
   * Sends packed section COPIES, not an unpacked padded volume: the worker does the unpack (D-40).
   */
  // Snapshot pool (D-88). A mesh snapshot is 27 section copies; at six mesh jobs a frame that is
  // ~160 typed-array allocations a second on the one thread we are protecting. postMessage
  // structured-clones synchronously, so the objects are free again the instant it returns and
  // Jobs hands them straight back here through the `release` callback.
  // The spare section objects live in a SIDE map, never on the snapshot itself: the snapshot is
  // structured-cloned to a worker verbatim, and an extra 27-entry array of stale section copies
  // hanging off it would be cloned too — the exact cost this pool exists to remove.
  W._snapPool  = [];        // free snapshot objects
  W._snapSpare = new Map(); // snapshot object -> Array(27) of reusable section copies
  W.SNAP_POOL_MAX = 12;

  W._takeSnap = function () {
    var s = W._snapPool.pop();
    if (s) { W.stats2.snapReuse++; return s; }
    W.stats2.snapAlloc++;
    s = { sy: 0, base: 0, nb: new Array(27), biome: null };
    W._snapSpare.set(s, new Array(27));
    return s;
  };

  W.releaseSnap = function (s) {
    var spare = s && W._snapSpare.get(s);
    if (!spare) return;
    if (W._snapPool.length >= W.SNAP_POOL_MAX) { W._snapSpare.delete(s); return; }
    // Park each live section copy in the spare slot it came from, so the next snapshot can reuse
    // its typed arrays. Nulls stay null; a slot only ever grows.
    for (var i = 0; i < 27; i++) { if (s.nb[i]) spare[i] = s.nb[i]; s.nb[i] = null; }
    W._snapPool.push(s);
  };

  W.snapshotFor = function (cx, cz, sy) {
    var snap = W._takeSnap();
    var nb = snap.nb, spare = W._snapSpare.get(snap);
    for (var dy = -1; dy <= 1; dy++) {
      var ny = sy + dy;
      for (var dz = -1; dz <= 1; dz++) {
        for (var dx = -1; dx <= 1; dx++) {
          var slot = (dy + 1) * 9 + (dz + 1) * 3 + (dx + 1);
          if (ny < 0 || ny >= CFG.SECTIONS_Y) { nb[slot] = null; continue; }
          var c = W.get(cx + dx, cz + dz);
          if (c && c.state >= NS.CH.GENERATED) {
            nb[slot] = spare[slot] = S.copyInto(c.sec[ny], spare[slot]);
          } else {
            nb[slot] = null;
          }
        }
      }
    }
    snap.sy = sy; snap.base = CFG.WORLD_MIN_Y + sy * 16; snap.biome = null;
    return snap;
  };

  // ---------------------------------------------------------------------------
  // Streaming (docs/archive/ARCH.md §5/§10)
  // ---------------------------------------------------------------------------

  /**
   * Spiral offsets, built once per render distance and cached. Iterating a spiral rather than a
   * square means the chunk you are standing in is always requested first, and the ring you are
   * about to fly into is requested before the one behind you.
   */
  var spiralCache = { r: -1, extra: -1, list: null };
  /**
   * spiral(r, extra) — the offsets inside a disc of radius r, nearest first.
   *
   * ⚠ `extra` widens the disc by a few SQUARED units rather than by a whole ring, and D-147 is
   * why it exists: a column is meshable only when all EIGHT of its neighbours exist, and the
   * furthest of those neighbours sits at d² = (r+1)² + 1 — one unit outside the disc of radius
   * r+1. Without the slack the four columns on the disc's axes never become meshable, which is
   * nine or ten sections per rim column left dirty for ever, and it survived the first fix
   * because it is only visible at the four compass points.
   */
  W.spiral = function (r, extra) {
    extra = extra | 0;
    if (spiralCache.r === r && spiralCache.extra === extra) return spiralCache.list;
    var lim = r * r + extra;
    var out = [];
    for (var dz = -r - 1; dz <= r + 1; dz++) {
      for (var dx = -r - 1; dx <= r + 1; dx++) {
        var d2 = dx * dx + dz * dz;
        if (d2 > lim) continue;
        out.push(dx, dz, d2);
      }
    }
    // sort by squared distance, keeping the flat triple layout
    var triples = [];
    for (var i = 0; i < out.length; i += 3) triples.push([out[i], out[i + 1], out[i + 2]]);
    triples.sort(function (a, b) { return a[2] - b[2]; });
    var flat = new Int32Array(triples.length * 2);
    for (i = 0; i < triples.length; i++) { flat[i * 2] = triples[i][0]; flat[i * 2 + 1] = triples[i][1]; }
    spiralCache.r = r; spiralCache.extra = extra; spiralCache.list = flat;
    return flat;
  };

  /** True when every chunk in the 3x3 around (cx,cz) is generated — the mesher needs all 8. */
  W.neighbourhoodReady = function (cx, cz) {
    for (var dz = -1; dz <= 1; dz++) {
      for (var dx = -1; dx <= 1; dx++) {
        var c = W.chunks.get(W.key(cx + dx, cz + dz));
        if (!c || c.state < CH.GENERATED) return false;
      }
    }
    return true;
  };

  /** Install a finished gen result. Marks every non-empty section for meshing. */
  /**
   * Make the structure-template entities a generated chunk listed ([id, x, y, z, yaw]). Vanilla
   * places them with `PersistenceRequired` set in the template NBT; `spawnReason: 'structure'`
   * is what PiglinEntity.initialize reads (no baby/weapon roll) and PiglinBruteEntity.initialize
   * sets its home here. Each chunk is populated once per session.
   */
  W.structEntDone = Object.create(null);
  W.spawnStructureEntities = function (list, key) {
    if (key !== undefined) { if (W.structEntDone[key]) return 0; W.structEntDone[key] = 1; }
    var n = 0;
    for (var i = 0; i < list.length; i++) {
      var d = list[i];
      var e = NS.EntityList.spawn(d[0], d[1], d[2], d[3], { spawnReason: 'structure', yaw: d[4] });
      if (!e) continue;
      if (d[5] && NS.Hanging) {   // hanging entity (EndCityGenerator Elytra frame): attach to its block, hold the item
        NS.Hanging.attach(e, d[1], d[2], d[3], d[5].facing, 12, 12);
        if (NS.Items && NS.Items.of) e.item = { i: NS.Items.of(d[5].item), n: 1 };
        e.persistent = true;
        n++;
        continue;
      }
      e.persistent = true;
      e.yaw = d[4];
      n++;
    }
    return n;
  };

  // #1900: ?wkhash=1 fingerprints every chunk AT INSTALL, before Save edits, fluid wakes or any tick can touch it.
  // Off by default and free when off (one boolean test). Read the table from the console: MCL.World.wkHashes.
  W.wkhash = typeof location !== 'undefined' && /[?&]wkhash=1(&|$)/.test(location.search || '');
  W.wkHashes = {};

  W.installChunk = function (cx, cz, res) {
    if (W.wkhash && NS.Gen.fingerprint) W.wkHashes[cx + ',' + cz] = NS.Gen.fingerprint(res);
    var c = W.getOrCreate(cx, cz);
    c.sec = res.sec;
    c.hmap = res.hmap;
    c.biome = res.biome || null;
    // PLAN W6: the biome colour map. Filled here rather than at mesh time because it is a
    // property of the CHUNK, not of its geometry — a section re-meshed for an unrelated reason
    // must not have to re-colour anything, and a chunk with no geometry at all (open ocean,
    // deep sky) still has a biome the water above it needs.
    if (NS.Tint && NS.Tint.ready && c.biome) NS.Tint.fillChunk(cx, cz, c.biome);
    c.state = CH.GENERATED;
    c.lastUse = W.frame;
    // ⚠ W9: the column was lit against nothing but itself on the worker, so its four vertical
    // faces are dark where a resident neighbour should have spilled in — and the neighbour's
    // faces are dark where THIS column should spill out. Both sides are seeded here and the
    // engine's bounded BFS settles them over the next few frames (D-142).
    if (NS.Light && NS.Light.queueBorder) NS.Light.queueBorder(cx, cz);
    // Replay this column's saved edits before the dirty mask is computed, so an edited section
    // is meshed on its first pass rather than one frame later (docs/archive/ARCH.md §13).
    if (NS.Save && NS.Save.applyTo) NS.Save.applyTo(c);
    // A section needs a mesh iff it is not uniformly air. A uniform-air section owns no faces:
    // the solid section below it owns its own top faces. A section holding a single plant or a
    // snow layer is not uniform, so it is caught by the same test.
    var mask = 0;
    var opaque = NS.States.opaque;   // indexed by real state (session 2)
    for (var sy = 0; sy < CFG.SECTIONS_Y; sy++) {
      var u = c.sec[sy].u;
      if (u !== 0) mask |= (1 << sy);
      // A uniform section's visibility mask is known without meshing it, and knowing it NOW is
      // what makes the flood stop at bedrock on the first frame the column exists rather than
      // several frames later when its mesh job lands (ARCH 9.1).
      c.vis[sy] = (u >= 0) ? (opaque[u] ? 0 : 0x7FFF) : 0x7FFF;
    }
    c.meshDirty[0] = mask;
    // ⚠ D-415 — the fluids the generator left behind. AFTER the sections are installed (the scan
    // reads them through `World.getBlock`) and after the saved edits are replayed, so a pool the
    // player already drained is not woken as if it were still full. `Behave` owns the rule and
    // the cost; this is only the call site, which is the one place a freshly generated column
    // becomes visible to the rest of the engine.
    if (NS.Behave && NS.Behave.ready && NS.Behave.scanNewColumn) {
      W.stats2.fluidWakes = (W.stats2.fluidWakes || 0) + NS.Behave.scanNewColumn(cx, cz, c.sec);
    }
    // #167: the spawner entity ids the worker's features recorded (Spawner.OWED #1's channel:
    // gen:done -> Jobs -> here -> BE.create). Inline mode already assigned in-context.
    if (res.spawners && NS.Spawner && NS.Spawner.assign) {
      var spState = NS.States.stateOf('spawner');
      for (var si = 0; si < res.spawners.length; si++) {
        var sp = res.spawners[si];
        if (W.getBlock(sp[0], sp[1], sp[2]) === spState) NS.Spawner.assign(sp[0], sp[1], sp[2], sp[3]);
      }
    }
    W.stockNests(res.nests);
    W.stockChests(res.chests);
    // template entities (bastion piglin brutes, village animals/villagers, golems): made here,
    // persistent, initialize(STRUCTURE). The worker only listed them.
    if (res.entities && res.entities.length && NS.EntityList && NS.EntityList.spawn) W.spawnStructureEntities(res.entities, cx + ',' + cz);
    W.stats2.gen++;
    if (NS.Spawn && NS.Spawn.onChunkInstalled) NS.Spawn.onChunkInstalled(cx, cz);
    return c;
  };

  /** res.chests ([x,y,z,table] logged by a structure's handleMetadata) -> the chest block gets its loot table (rolled on first open). */
  W.stockChests = function (list) {
    if (!list || !list.length || !NS.BlockEntities || !NS.BlockEntities.create) return 0;
    var R = NS.Reg, b = R.id['chest'], n = 0;
    for (var i = 0; i < list.length; i++) {
      var d = list[i], s = W.getBlock(d[0], d[1], d[2]);
      if (s < R.realFirst[b] || s >= R.realFirst[b + 1]) continue;
      var e = NS.BlockEntities.get(d[0], d[1], d[2]) || NS.BlockEntities.create(d[0], d[1], d[2], 'chest');
      if (e) { e.lootTable = d[3]; e.lootTableSeed = 0; n++; }
    }
    return n;
  };

  /** res.nests ([x,y,z,ticks[]] logged by the worker's beehive decorator) -> Bee.stockNest where the block is still a nest. */
  W.stockNests = function (nests) {
    if (!nests || !nests.length || !NS.Bee || !NS.Bee.stockNest) return 0;
    var R = NS.Reg, b = R.id['bee_nest'], n = 0;
    for (var i = 0; i < nests.length; i++) {
      var s = W.getBlock(nests[i][0], nests[i][1], nests[i][2]);
      if (s >= R.realFirst[b] && s < R.realFirst[b + 1]) { NS.Bee.stockNest(nests[i][0], nests[i][1], nests[i][2], nests[i][3]); n++; }
    }
    return n;
  };

  /**
   * stream(camCx, camCz, renderDistance) — the only thing that enqueues work.
   * Order matters: generation first (nothing can be meshed until it exists), then meshing in
   * spiral order, then eviction. Every step is capped so one frame can never do all of it.
   */
  /** ThreadedAnvilChunkStorage.doesNotGenerateChunks: spectator && !spectatorsGenerateChunks.
   *  (No hardcore flag exists in this engine, so ServerPlayNetworkHandler's hardcore-death half is skipped.) */
  W.doesNotGenerateChunks = function (e) {
    e = e || NS.Player;
    if (!e || !NS.Gamemode || !NS.Gamemode.isSpectator(e)) return false;
    var C = NS.Commands, v;
    if (C && typeof C.ruleGet === 'function') v = C.ruleGet('spectatorsGenerateChunks');
    else { var r = NS.DATA && NS.DATA.gameRules && NS.DATA.gameRules.spectatorsGenerateChunks; v = r ? r.d : 'true'; }
    return v === 'false' || v === false;
  };

  W.stream = function (camCx, camCz, rd) {
    W.frame++;
    W.camCx = camCx; W.camCz = camCz;
    var J = NS.Jobs;
    if (!J || J.mode === 'none') return;
    rd = rd | 0; if (rd < 1) rd = 1;
    // ⚠ D-147 — GENERATE ONE RING FURTHER THAN YOU MESH. A section is only meshed once all
    // eight neighbouring COLUMNS exist (`neighbourhoodReady`, because the mesher needs a 3x3 to
    // resolve faces at the border), so generating exactly `rd` columns leaves the outermost ring
    // permanently un-meshed: the world is a disc of radius rd−1 with a ring of invisible
    // geometry around it. On the surface the fog hides it; underground, where session 4
    // photographed it, the frontier is a wall of sky-coloured nothing with 256 sections stuck
    // dirty for ever. Vanilla loads renderDistance + 1 for exactly this reason.
    var genList = W.spiral(rd + 1, 1);      // +1 in SQUARED units — see W.spiral and D-147
    var list = W.spiral(rd);
    var i, cx, cz, c;

    // Per-frame budget scale. Main sets W.load from the frame profiler: after a slow frame the
    // streamer does less, so one hitch never turns into a run of them (D-87). Generation and
    // meshing IN FLIGHT are not scaled — those cost worker time, not frame time.
    var load = W.load;
    if (!(load > 0)) load = 1; else if (load > 1) load = 1;
    var meshPerFrame = Math.max(1, Math.round(W.maxMeshPerFrame * load));
    // ⚠ AND NEVER FEWER THAN THE FREE SLOTS IN THE IN-FLIGHT POOL (D-198). The comment above
    // states the rule this line enforces and the old code broke it: `maxMeshInflight` is the
    // budget that costs WORKER time and `maxMeshPerFrame` is the one that costs MAIN-THREAD
    // time, and scaling the second by `load` was silently scaling the first, because the pool is
    // only ever refilled by this loop. Measured at the medium preset, flying a million blocks
    // out: `load` settled at 0.27-0.49, `meshPerFrame` at 2-4, and the mesh pool sat at 3.3 of
    // its 10 slots with the workers IDLE while 3,000 sections were dirty. Frames are slow
    // exactly when the render distance is large, so the throttle bit hardest at medium and above
    // and never at all at celeron, where `load` stays near 1 — which is why every browser check
    // this project has ever run (D-196) has run on the far side of it.
    // The main-thread cost this cap exists to bound is `snapshotFor`, measured at 0.05 ms a job:
    // topping a 10-slot pool up costs half a millisecond, against the 60 ms frames it was
    // protecting. Removing the throttle raised mesh throughput from 56 to 89 sections a second
    // and pool occupancy from 3.3/10 to 10/10 on the same box and the same flight.
    // #1898: the in-flight budgets are FLOORS; they scale with the live pool (gen = 1 x workers,
    // mesh = 1.5 x workers) so a bigger pool is never starved by a cap sized for four.
    var live = (J.mode === 'workers') ? J.workers.length : 0;
    var genCap = W.genCap = Math.max(W.maxGenInflight, live);
    var meshCap = W.meshCap = Math.max(W.maxMeshInflight, Math.ceil(live * 1.5));
    var freeSlots = meshCap - W.meshInflight;
    if (meshPerFrame < freeSlots) meshPerFrame = freeSlots;

    var noGen = W.doesNotGenerateChunks();
    // --- 1. generation ------------------------------------------------------
    for (i = 0; i < genList.length && W.genInflight < genCap; i += 2) {
      cx = camCx + genList[i]; cz = camCz + genList[i + 1];
      c = W.chunks.get(W.key(cx, cz));
      if (c && c.state !== CH.EMPTY) { c.lastUse = W.frame; continue; }
      if (noGen) continue;   // ThreadedAnvilChunkStorage.doesNotGenerateChunks: a spectator's ring asks for nothing new
      if (!c) c = W.getOrCreate(cx, cz);
      c.state = CH.GENERATING;
      c.lastUse = W.frame;
      W.genInflight++;
      requestGen(cx, cz);
    }

    // --- 1b. forced chunks (ForceLoadCommand / ServerWorld.setChunkForced): generated like a ring chunk ---
    W.forced.forEach(function (k) {
      if (W.genInflight >= genCap) return;
      var p = W.unforceKey(k), fc = W.chunks.get(W.key(p[0], p[1]));
      if (fc && fc.state !== CH.EMPTY) { fc.lastUse = W.frame; return; }
      if (!fc) fc = W.getOrCreate(p[0], p[1]);
      fc.state = CH.GENERATING; fc.lastUse = W.frame; W.genInflight++;
      requestGen(p[0], p[1]);
    });

    // --- 2. meshing ---------------------------------------------------------
    // ⚠ NEAREST FIRST IN THREE DIMENSIONS, NOT TWO (D-198). The spiral orders COLUMNS by
    // distance and the old inner loop then walked `sy` from 0 to 19 — from bedrock upwards —
    // so the order the world arrived in was "every section of the nearest column, starting with
    // the deepslate three hundred blocks under your feet". That is the wrong order whenever the
    // mesher is the bottleneck, which is what a large render distance MEANS: a section at
    // (dx 0, dz 0, sy 0) is 21 sections — 336 blocks — from a camera at sy 17, while a section
    // eight columns away at eye level is 128 blocks from it and on screen. The first was meshed
    // first. Two things follow, and both are one line:
    //   * `sy` walks OUTWARD from the camera's own section, so a column's visible band is issued
    //     before its basement;
    //   * pass 0 takes only the sections inside the render distance measured in 3D — the disc
    //     the spiral already walks in 2D, made a hemisphere — and pass 1 takes everything else.
    //     Nothing is skipped, only ordered, and pass 1 always runs once pass 0 has no work.
    // This is what vanilla and Sodium do — their rebuild queue is sorted by camera distance —
    // and it is the difference between losing the deepslate under your feet for a second and
    // losing the ground in front of your face.
    var camSy = W.secYOf(Math.floor(
      (NS.Gfx && NS.Gfx.cam) ? NS.Gfx.cam.y : (NS.Player ? NS.Player.ey : 64)));
    if (camSy < 0) camSy = 0; else if (camSy >= CFG.SECTIONS_Y) camSy = CFG.SECTIONS_Y - 1;
    var SY2 = CFG.SECTIONS_Y * 2, rd2 = rd * rd;
    var issued = 0, pass, sy, k, dsy, ox, oz, d2;
    for (pass = 0; pass < 2 && issued < meshPerFrame &&
                   W.meshInflight < meshCap; pass++) {
      for (i = 0; i < list.length && issued < meshPerFrame &&
                  W.meshInflight < meshCap; i += 2) {
        ox = list[i]; oz = list[i + 1];
        cx = camCx + ox; cz = camCz + oz;
        c = W.chunks.get(W.key(cx, cz));
        if (!c || c.state < CH.GENERATED || !c.meshDirty[0]) continue;
        if (!W.neighbourhoodReady(cx, cz)) continue;
        c.lastUse = W.frame;
        d2 = ox * ox + oz * oz;
        // k enumerates 0, +1, -1, +2, -2, … so `sy` leaves the camera's section outwards. It
        // runs to twice SECTIONS_Y because one side of the walk falls off the world first.
        for (k = 0; k < SY2; k++) {
          dsy = (k & 1) ? ((k + 1) >> 1) : -(k >> 1);
          sy = camSy + dsy;
          if (sy < 0 || sy >= CFG.SECTIONS_Y) continue;
          if (!(c.meshDirty[0] & (1 << sy))) continue;
          if (pass === 0 && d2 + dsy * dsy > rd2) continue;
          // D-517: a section re-dirtied while its mesh job is still in flight must WAIT for that
          // job, dirty bit kept, and be re-issued after it lands. Issuing a second job overwrote
          // `meshJobs[sk]`, so the first job's reply read as "cancelled" and never gave its
          // `meshInflight` slot back — every random tick / fluid step inside a meshing section
          // leaked one slot, until the streamer stalled with a permanent residue (the "13
          // sections of work left at 0/s" palettecheck/lumacheck/cullcheck all hit).
          if (W.meshJobs.has(W.sectionKey(cx, cz, sy))) continue;
          c.meshDirty[0] &= ~(1 << sy);
          W.meshInflight++;
          requestMesh(cx, cz, sy);
          issued++;
          if (issued >= meshPerFrame || W.meshInflight >= meshCap) break;
        }
      }
    }

    // --- 3. eviction --------------------------------------------------------
    // Two rules, and both have to exist. Distance keeps the world the size the render distance
    // says it is; the resident CAP is what stops a long flight from filling memory when the
    // player outruns eviction, which is the failure mode on a 4 GB machine (D-89).
    if ((W.frame & 7) === 0) W.evict(camCx, camCz, rd);

    // In inline mode the same job functions run here, time-sliced (D-12).
    if (J.pump) J.pump(Math.max(300, 1500 * load));
  };

  /**
   * tickingAt(x, z) — D-452's own gate: is the block column at (x,z) within SIMULATION distance
   * of the camera, not just within render distance? Everything that costs CPU per real tick
   * (entities, natural spawning, random block ticks) reads this instead of `loadedAt`; everything
   * that only costs a frame's worth of GPU (meshing, drawing) keeps reading `renderDistance`.
   */
  W.tickingAt = function (x, z) {
    var sd = (NS.Settings && NS.Settings.effectiveSimDistance) ? NS.Settings.effectiveSimDistance() : 8;
    var dx = (x >> 4) - W.camCx, dz = (z >> 4) - W.camCz;
    return dx * dx + dz * dz <= sd * sd;
  };

  /**
   * randomTick(rnd, speed) — `Level.tickChunk`'s per-tick pass (D-452), driven for every
   * resident, generated chunk within SIMULATION distance of the camera. Never called before this
   * session (D-452's own audit): `Behave.randomTickSection` existed, was proven correct in
   * isolation by `behavcheck`, and was never once reached by the running game — crops, grass,
   * leaves, ice, cane and farmland never ticked in play. That bug predates simulation distance
   * and is fixed here because item 8(b) cannot gate a system that does not run.
   * ⚠ A uniform AIR section (`sec.u === 0`) is skipped — no random-tick rule can ever fire in an
   * empty section, so this is a pure perf shortcut and never a behaviour change. A uniform
   * NON-air section (rare — solid fill, not a placed feature) is still ticked; `Behave.randomTick`
   * simply finds no rule for it, exactly as it would one block at a time.
   */
  // ServerWorld.getForcedChunks: the set of "cx,cz" keys that stay loaded and ticking with no player near.
  W.forced = new Set();
  W.forceKey = function (cx, cz) { return cx + ',' + cz; };
  W.unforceKey = function (k) { var a = k.split(','); return [+a[0], +a[1]]; };
  /** ServerWorld.setChunkForced: true when the set changed. */
  W.setChunkForced = function (cx, cz, on) {
    var k = W.forceKey(cx, cz);
    if (W.forced.has(k) === !!on) return false;
    if (on) W.forced.add(k); else W.forced.delete(k);
    return true;
  };
  W.isForced = function (c) { return W.forced.size > 0 && W.forced.has(W.forceKey(c.cx, c.cz)); };

  W.randomTick = function (rnd, speed) {
    var Behave = NS.Behave;
    if (!Behave || !Behave.ready) return 0;
    var sd = (NS.Settings && NS.Settings.effectiveSimDistance) ? NS.Settings.effectiveSimDistance() : 8;
    var sd2 = sd * sd, hits = 0;
    W.chunks.forEach(function (c) {
      if (c.state < CH.GENERATED) return;
      var dx = c.cx - W.camCx, dz = c.cz - W.camCz;
      if (dx * dx + dz * dz > sd2 && !W.isForced(c)) return;
      var bx = c.cx << 4, bz = c.cz << 4, sec = c.sec;
      if (Behave.precipitationColumn) Behave.precipitationColumn(c.cx, c.cz, rnd || Math.random);
      for (var sy = 0; sy < CFG.SECTIONS_Y; sy++) {
        if (sec[sy].u === 0) continue;
        hits += Behave.randomTickSection(bx, CFG.WORLD_MIN_Y + (sy << 4), bz, rnd, speed);
      }
    });
    return hits;
  };

  /**
   * evict(camCx, camCz, rd) — drop everything past rd + evictMargin, then, if more than
   * maxChunks columns are still resident, drop the furthest until the cap is met.
   */
  W.evict = function (camCx, camCz, rd) {
    var lim = rd + W.evictMargin, lim2 = lim * lim;
    var drop = null, keep = null, i;
    W.chunks.forEach(function (ch) {
      var dx = ch.cx - camCx, dz = ch.cz - camCz;
      var d2 = dx * dx + dz * dz;
      if (W.isForced(ch)) return;
      if (d2 > lim2) { (drop || (drop = [])).push(ch); return; }
      if (W.chunks.size > W.maxChunks) { ch._d2 = d2; (keep || (keep = [])).push(ch); }
    });
    if (drop) for (i = 0; i < drop.length; i++) W.unload(drop[i]);
    if (keep && keep.length > W.maxChunks) {
      keep.sort(function (a, b) { return b._d2 - a._d2; });
      var over = keep.length - W.maxChunks;
      for (i = 0; i < over; i++) W.unload(keep[i]);
    }
  };

  /**
   * cancelJobsFor(chunk) — the player left this column behind, so the work queued for it is
   * worthless. Cancelling actually matters: a gen job sitting in a worker's message queue keeps
   * a slot of maxGenInflight busy, and the chunk in front of the player waits behind it (D-87).
   */
  W.cancelJobsFor = function (c) {
    var k = W.key(c.cx, c.cz);
    var id = W.genJobs.get(k);
    if (id !== undefined) {
      W.genJobs.delete(k);
      NS.Jobs.cancel(id);
      W.genInflight--;
      W.stats2.cancelled++;
    }
    for (var sy = 0; sy < CFG.SECTIONS_Y; sy++) {
      var sk = W.sectionKey(c.cx, c.cz, sy);
      var mid = W.meshJobs.get(sk);
      if (mid === undefined) continue;
      W.meshJobs.delete(sk);
      NS.Jobs.cancel(mid);
      W.meshInflight--;
      W.stats2.cancelled++;
    }
  };

  W.unload = function (c) {
    W.cancelJobsFor(c);
    var G = NS.Gfx;
    if (G && G.setSectionMesh) {
      for (var sy = 0; sy < CFG.SECTIONS_Y; sy++) {
        if (c.meshed[0] & (1 << sy)) G.setSectionMesh(c.cx, c.cz, sy, null);
      }
    }
    W.chunks.delete(W.key(c.cx, c.cz));
    W.stats2.evicted++;
  };

  function requestGen(cx, cz) {
    var k = W.key(cx, cz);
    NS.Jobs.requestGen(cx, cz).then(function (res) {
      if (W.genJobs.get(k) !== id) return;      // cancelled; the accounting already happened
      W.genJobs.delete(k);
      W.genInflight--;
      var c = W.chunks.get(k);
      if (!c) return;                          // evicted while in flight
      if (!res) { c.state = CH.EMPTY; return; }
      W.installChunk(cx, cz, res);
    }, function () {
      if (W.genJobs.get(k) !== id) return;
      W.genJobs.delete(k);
      W.genInflight--;
      var c = W.chunks.get(k);
      if (c) c.state = CH.EMPTY;
    });
    var id = NS.Jobs.lastId;
    W.genJobs.set(k, id);
  }

  function requestMesh(cx, cz, sy) {
    var sk = W.sectionKey(cx, cz, sy);
    var snap = W.snapshotFor(cx, cz, sy);
    var c0 = W.chunks.get(W.key(cx, cz)), gen = c0 ? c0.meshGen[sy] : 0;   // world state this snapshot was cut from
    NS.Jobs.requestMesh(cx, cz, sy, snap, W.releaseSnap).then(function (res) {
      if (W.meshJobs.get(sk) !== id) return;    // cancelled
      W.meshJobs.delete(sk);
      W.meshInflight--;
      var c = W.chunks.get(W.key(cx, cz));
      if (!c) return;
      // KW-48b-3: built from an older world state than the section now holds -> never replaces a newer
      // mesh. The dirty bit markDirty set queued the re-mesh; the current upload (if any) stays until it lands.
      if (c.meshGen[sy] !== gen) return;
      // A null result is NOT 'an empty section': it is a job nobody ran (no worker free, a pool being
      // resized, mode none). Reading it as empty cleared `meshed` and the section vanished until
      // something else dirtied it - 'see-through right after a break' (#1262). Keep what is held; retry.
      if (!res) { c.meshDirty[0] |= (1 << sy); return; }
      var buf = res && res.buf;
      // The visibility mask arrives whether or not there is geometry: an air pocket draws
      // nothing and is still the thing the flood travels through (ARCH 9.1).
      // KW-48b (#578): a job whose section was re-dirtied while it flew is STALE (its snapshot predates
      // the edit; the dirty bit is what queued the re-mesh). Landing its vis mask would undo
      // `markDirty`'s "uncertain reads as connected" stamp for every frame until the re-mesh lands —
      // the very hole KW-48 closed, reopened through the back door. Keep the permissive mask.
      if (res && !(c.meshDirty[0] & (1 << sy))) c.vis[sy] = res.vis & 0x7FFF;
      if (buf) c.meshed[0] |= (1 << sy); else c.meshed[0] &= ~(1 << sy);
      if (c.state < CH.READY) c.state = CH.READY;
      W.stats2.meshed++;
      if (NS.Gfx && NS.Gfx.setSectionMesh) NS.Gfx.setSectionMesh(cx, cz, sy, buf);
    }, function () {
      if (W.meshJobs.get(sk) !== id) return;
      W.meshJobs.delete(sk);
      W.meshInflight--;
      var c = W.chunks.get(W.key(cx, cz));
      if (c) c.meshDirty[0] |= (1 << sy);      // failed: try again next pass
    });
    var id = NS.Jobs.lastId;
    W.meshJobs.set(sk, id);
  }

  /**
   * remeshAll(dropGpu) — rebuild every section's mesh.
   *
   * ⚠ `dropGpu` is the difference between a settings change and a WHITE FLASH (D-162). `meshed`
   * is what the draw list is built from, so clearing it makes the entire world vanish until the
   * mesher catches up — and the clear colour is the SKY, so for those frames the player gets a
   * full screen of pale blue. Turning on AO, or switching leaves, or any preset change that
   * remeshes, flashed the whole screen.
   *
   * The buffers are only actually GONE when the backend was swapped (F9), which is the one case
   * that passes `true`. Every other caller is asking for a rebuild because the meshes are STALE,
   * and a stale mesh is worth drawing for the third of a second it takes to replace it — which
   * is what vanilla does when you change a graphics setting.
   */
  W.remeshAll = function (dropGpu) {
    W.chunks.forEach(function (c) {
      var mask = 0;
      for (var sy = 0; sy < CFG.SECTIONS_Y; sy++) { c.meshGen[sy]++; if (c.sec[sy].u !== 0) mask |= (1 << sy); }   // gen bump: a job in flight with the OLD options must not land (#1926)
      c.meshDirty[0] = mask;
      if (dropGpu) {
        c.meshed[0] = 0;
        c.vis.fill(0x7FFF);      // back to "assume visible" until each section is re-measured
      }
    });
  };

  /** Highest solid block at (x,z), or WORLD_MIN_Y-1 if the column is not generated. */
  W.heightAt = function (x, z) {
    var c = W.get(x >> 4, z >> 4);
    if (!c || c.state < CH.GENERATED) return CFG.WORLD_MIN_Y - 1;
    return c.hmap[((z & 15) << 4) | (x & 15)] + CFG.WORLD_MIN_Y;
  };

  W.biomeAt = function (x, z) {
    var c = W.get(x >> 4, z >> 4);
    if (!c || !c.biome) return 0;
    return c.biome[((z & 15) << 4) | (x & 15)];
  };

  /**
   * The biome at a 3D position (4x4x4 quart cells) - what vanilla's `world.getBiome(BlockPos)` answers and
   * what WorldRenderer.renderWeather asks at the camera's y. Out of the worldgen's own biome volume
   * (`Gen.biomeAt3`, cached per chunk); a column that is not loaded, or an engine with no volume, falls back
   * to the 2D column biome.
   */
  W.biomeAt3 = function (x, y, z) {
    var c = W.get(x >> 4, z >> 4);
    if (!c || !c.biome) return 0;
    var G = NS.Gen;
    if (G && G.biomeAt3) { try { return G.biomeAt3(x, y, z); } catch (err) { /* 2D below */ } }
    return c.biome[((z & 15) << 4) | (x & 15)];
  };

  /**
   * `statsFast()` — `stats()` with its one O(n) field refreshed at most once a second (D-434).
   *
   * ⚠ **AND THE HONEST NUMBERS, BECAUSE THE FIRST VERSION OF THIS COMMENT HAD THEM WRONG.** This
   * was written believing `stats()` was what made the F4 panel expensive. It is not:
   * **measured at render distance 12, `World.stats()` is 0.3 ms** (3.3 ms on the first call,
   * cold) against **119.5 ms for `Gfx.backend.info()`** in the same probe — see
   * `12_gfx_webgl2.js`'s `L.info` for the real culprit and what it cost F3. A guess that names
   * the wrong line is worse than no guess, because the next reader believes it.
   * ▶ It is kept anyway, and only for the reason that survives measuring: `stats()` is
   * O(resident sections) and GROWS with render distance, while every caller of it is a debug
   * overlay drawing once a frame for a row that reads "747 MB". `stats()` is left exact and
   * untouched for the checks that want an exact number this instant.
   */
  W.statsFast = function () {
    var now = NS.U.now();
    if (!W._sf || now - W._sfAt > 1000) { W._sf = W.stats(); W._sfAt = now; }
    return {
      chunks: W.chunks.size, bytes: W._sf.bytes,
      genInflight: W.genInflight, meshInflight: W.meshInflight,
      generated: W.stats2.gen, meshed: W.stats2.meshed, evicted: W.stats2.evicted,
      cancelled: W.stats2.cancelled,
      snapReuse: W.stats2.snapReuse, snapAlloc: W.stats2.snapAlloc
    };
  };

  W.stats = function () {
    var bytes = 0;
    W.chunks.forEach(function (c) {
      for (var i = 0; i < c.sec.length; i++) bytes += S.bytes(c.sec[i]);
    });
    return {
      chunks: W.chunks.size, bytes: bytes,
      genInflight: W.genInflight, meshInflight: W.meshInflight,
      generated: W.stats2.gen, meshed: W.stats2.meshed, evicted: W.stats2.evicted,
      cancelled: W.stats2.cancelled,
      snapReuse: W.stats2.snapReuse, snapAlloc: W.stats2.snapAlloc
    };
  };

  // --- the world border (G17, #5625) — WorldBorder.java: one store, read by the physics clip,
  // the player's out-of-border damage (14d) and /worldborder (15g). Sizes lerp on a wall clock.
  var WB = W.border = {
    MAX_RADIUS: 29999984, centerX: 0, centerZ: 0, damagePerBlock: 0.2, safeZone: 5.0,
    warningTime: 15, warningBlocks: 5,
    oldSize: 59999968, newSize: 59999968, t0: 0, dur: 0,
    now: function () { return Date.now(); }       // tests replace this
  };
  WB.size = function () {
    if (!(WB.dur > 0)) return WB.newSize;
    var f = (WB.now() - WB.t0) / WB.dur;
    return f < 1 ? WB.oldSize + (WB.newSize - WB.oldSize) * f : WB.newSize;
  };
  WB.setSize = function (v) { WB.oldSize = WB.newSize = v; WB.dur = 0; };
  WB.lerpSize = function (to, ms) {
    var from = WB.size();
    if (!(ms > 0) || from === to) return WB.setSize(to);
    WB.oldSize = from; WB.newSize = to; WB.t0 = WB.now(); WB.dur = ms;
  };
  function clampR(v) { return Math.max(-WB.MAX_RADIUS, Math.min(WB.MAX_RADIUS, v)); }
  WB.west = function () { return clampR(WB.centerX - WB.size() / 2); };
  WB.east = function () { return clampR(WB.centerX + WB.size() / 2); };
  WB.north = function () { return clampR(WB.centerZ - WB.size() / 2); };
  WB.south = function () { return clampR(WB.centerZ + WB.size() / 2); };
  WB.contains = function (x, z, margin) {
    margin = margin || 0;
    return x >= WB.west() - margin && x < WB.east() + margin && z >= WB.north() - margin && z < WB.south() + margin;
  };
  WB.distanceInside = function (x, z) {
    return Math.min(x - WB.west(), WB.east() - x, z - WB.north(), WB.south() - z);
  };
  WB.stage = function () {      // 'growing' | 'shrinking' | 'stationary'
    if (!(WB.dur > 0) || WB.now() - WB.t0 >= WB.dur) return 'stationary';
    return WB.newSize < WB.oldSize ? 'shrinking' : 'growing';
  };
  /** ServerWorld.canPlayerModifyAt (spawn protection is not modelled): the column must be inside the border. */
  W.canPlayerModifyAt = function (x, z) { return WB.contains(x, z); };

  /** DragonEggBlock.teleport (server side): 1000 tries at pos + (ni(16)-ni(16), ni(8)-ni(8), ni(16)-ni(16)),
   *  first air target inside the border wins. `r.nextInt(n)` is the world random. Returns [x,y,z] or null. */
  W.dragonEggTeleport = function (x, y, z, r) {
    for (var i = 0; i < 1000; i++) {
      var tx = x + (r.nextInt(16) - r.nextInt(16)), ty = y + (r.nextInt(8) - r.nextInt(8)), tz = z + (r.nextInt(16) - r.nextInt(16));
      if (W.getBlock(tx, ty, tz) === 0 && WB.contains(tx, tz)) {
        var egg = W.getBlock(x, y, z);
        W.setBlock(tx, ty, tz, egg); W.setBlock(x, y, z, 0);
        return [tx, ty, tz];
      }
    }
    return null;
  };
  /** Entity.move's border VoxelShape: an entity inside cannot be carried out; returns the allowed delta. */
  WB.clipAxis = function (pos, hw, d, axis) {
    var lo = (axis === 0 ? WB.west() : WB.north()) + hw, hi = (axis === 0 ? WB.east() : WB.south()) - hw;
    if (pos < lo - 1e-9 || pos > hi + 1e-9) return d;     // already outside: not clipped (vanilla)
    var n = pos + d;
    return n < lo ? lo - pos : n > hi ? hi - pos : d;
  };
})(MCL);
