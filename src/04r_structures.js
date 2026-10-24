// 04r_structures.js — the structure registry and the START pass (PLAN W13, D-183, D-184).
// Runs on: main thread AND workers (this is inside the chunk generator). No DOM.
//
// PLAN §7 states the invariant everything in W13..W18 hangs off, and it is the same one W7 and
// W8 already live under, one level up:
//
//   > A structure must be decidable from its own chunk plus a bounded neighbourhood, from the
//   > seed alone, WITHOUT generating neighbouring terrain first.
//
// Break it and you get either infinite recursion (chunk A needs B needs A) or structures that
// differ depending on which direction the player walked in. So the three passes, from §7:
//
//   1. START PASS   hash(seed, region) -> does a structure start here? which one?
//                   pure, no terrain, no neighbours, no block reads
//   2. PIECE PASS   expand the start into placed pieces with bounding boxes. MAY query the
//                   cheap column function and the biome volume for any point — both are
//                   splined/tabulated evaluations, not chunk generations, so they are safe
//   3. WRITE PASS   while generating chunk C, ask which pieces overlap C, write only that part
//
// This file is 1 and the bookkeeping for 3. The piece grammars are separate files, one per
// family, registering themselves here — `04s_struct_mineshaft.js` is W14's.
//
// ── ⚠ WHAT IS PORTED, AND FROM WHERE ────────────────────────────────────────────────────────
//
// PLAN §7: *"Placement from the 17 `structure_set` files (`spacing`, `separation`, `salt`) —
// stolen wholesale, because this is structure LOGIC, not worldgen shape, and logic should be
// faithful."* So none of the numbers below were chosen here:
//
//   `structure_set` (17)                 which structures share a grid, their weights, and the
//                                        grid itself — spacing, separation, salt, spread type
//   `configured_structure_feature` (31)  each structure's type, its config, and the BIOME TAG
//                                        it is allowed in
//   42 biome tags (D-183)                what that tag resolves to, flattened at build time
//
// The one thing the data does not carry is which DECORATION STEP a structure writes at — that
// is a field on the Java class, not on the JSON — so `STEP_OF` below is the port of it, written
// out with the class each line comes from.
//
// ── ⚠ BIOME ELIGIBILITY ASKS `Gen.biomeAt3` AND MUST NOT GROW ITS OWN SAMPLER (D-180) ───────
//
// D-180 built a cached quart-resolution biome VOLUME per chunk and said in writing that
// structure placement is its intended second consumer: *"may this structure start here" is the
// same question a feature's `biome` placement modifier asks — the biome at a 3D position — and
// the two must get the same answer out of the same array, or a structure lands in a biome whose
// features say it cannot be there.* This file asks `Gen.biomeAt3` and nothing else.
//
// ── ⚠ WHAT IS NOT VANILLA HERE: THE RANDOM SEQUENCE, EXACTLY AS D-124 SAID OF THE CARVERS ───
//
// Vanilla's `WorldgenRandom.setLargeFeatureWithSalt` is a Java LCG and its draw ORDER inside
// `ChunkGenerator.createStructures` is compiled code no file in the jar states. A port claiming
// sequence parity would be a claim no test in this project could check, so it is not claimed.
// The GRID is vanilla's and is checkable: one candidate chunk per `spacing x spacing` region,
// offset uniformly (or triangularly) over `spacing - separation`, which fixes the DENSITY and
// the minimum separation of every structure in the world. The SEQUENCE is MC-Lite's own PRNG,
// seeded per (set, region) — which is all the invariant above needs.

(function (NS) {
  'use strict';

  var CFG = NS.CFG;
  var MINY = CFG.WORLD_MIN_Y;

  var ST = NS.Structures = {
    ready: false, G: null,
    sets: [],          // the 17 structure sets, ported
    defs: null,        // configured structure name -> def
    makers: null,      // type -> the piece grammar registered for it
    cache: null,       // (set, region) -> the starts it produces
    cacheHits: 0, cacheMisses: 0,
    lastWritten: 0
  };

  // ── the eleven decoration steps, and which one each structure TYPE writes at ────────────────
  //
  // `GenerationStep.Decoration`, the same eleven `Features.steps` counts. A structure is written
  // at ITS step, interleaved with the biome features of that step — vanilla's
  // `applyBiomeDecoration` runs the structures of step N before the features of step N — which
  // is why a lake (step 1) is overwritten by a mineshaft (step 3) and not the other way round.
  var STEP_UNDERGROUND_STRUCTURES = 3;
  var STEP_SURFACE_STRUCTURES = 4;
  var STEP_STRONGHOLDS = 5;
  var STEP_UNDERGROUND_DECORATION = 7;

  // ⚠ From `StructureFeature`'s static table, one line per class, because it is NOT in the JSON.
  var STEP_OF = {
    mineshaft: STEP_UNDERGROUND_STRUCTURES,        // StructureFeature.MINESHAFT
    buried_treasure: STEP_UNDERGROUND_STRUCTURES,  // StructureFeature.BURIED_TREASURE
    stronghold: STEP_STRONGHOLDS,                  // StructureFeature.STRONGHOLD
    nether_fossil: STEP_UNDERGROUND_DECORATION,    // StructureFeature.NETHER_FOSSIL
    fortress: STEP_UNDERGROUND_DECORATION,         // StructureFeature.NETHER_BRIDGE
    // everything else the overworld has is a SURFACE structure: village, pillager_outpost,
    // desert_pyramid, igloo, jungle_pyramid, swamp_hut, ocean_ruin, shipwreck, ruined_portal,
    // mansion, monument, bastion_remnant, endcity.
    _default: STEP_SURFACE_STRUCTURES
  };
  ST.STEP_OF = STEP_OF;

  // ⚠ WHICH DIMENSION A STRUCTURE TYPE LIVES IN is not in the JSON either (the biome tag is the only hint).
  // Nether types are placed only while `Dim.cur` is the Nether, and overworld types never there.
  var DIM_OF = { fortress: 'the_nether', bastion_remnant: 'the_nether', nether_fossil: 'the_nether', end_city: 'the_end', endcity: 'the_end' };
  ST.DIM_OF = DIM_OF;
  function curDim() { return NS.Dim ? NS.Dim.cur : 'overworld'; }

  // ── the PRNG (D-124's family, and for D-124's reason) ───────────────────────────────────────
  //
  // The same sfc32 the carvers and the features use, seeded here from (seed, region, salt) so a
  // start is a pure function of the seed and the region and of nothing else — not of which chunk
  // asked, not of which thread asked, not of the order they asked in. `parcheck` is what turns
  // that from a claim into evidence.
  function rngFor(seed, a, b, salt) {
    return NS.Carvers.rngFor(seed ^ ((salt | 0) * 0x45D9F3B), a, b, salt | 0);
  }
  ST.rngFor = rngFor;

  /** floorDiv, because a structure grid crosses the origin and `(-1/32)|0` is 0, not -1. */
  function floorDiv(a, b) { var q = (a / b) | 0; return (a % b !== 0 && (a < 0) !== (b < 0)) ? q - 1 : q; }
  ST.floorDiv = floorDiv;

  // ── the placement rules, out of `structure_set/*.placement` ────────────────────────────────

  /**
   * `minecraft:random_spread` — vanilla's `RandomSpreadStructurePlacement`.
   *
   * The world is tiled by `spacing x spacing` chunk REGIONS. Each region gets exactly one
   * candidate chunk, at a random offset inside the region's first `spacing - separation`
   * chunks — which is what `separation` buys: two structures of the same set can never be
   * closer than `separation` chunks, because the offset can never reach the far edge.
   *
   * `spread_type` is LINEAR unless the file says otherwise; `end_cities`, `ocean_monuments` and
   * `woodland_mansions` say `triangular`, which is the mean of two draws and clusters the
   * candidate toward the middle of the region.
   */
  function randomSpread(p, name) {
    var spacing = p.spacing | 0, separation = p.separation | 0, salt = p.salt | 0;
    if (!(spacing > 0)) throw new Error('structure_set ' + name + ': spacing must be positive');
    if (separation >= spacing) throw new Error('structure_set ' + name + ': separation >= spacing leaves no room');
    var span = spacing - separation;
    var tri = p.spread_type === 'triangular';
    return {
      kind: 'random_spread', spacing: spacing, separation: separation, salt: salt,
      spreadType: tri ? 'triangular' : 'linear', span: span,
      locateOffset: Array.isArray(p.locate_offset) ? [p.locate_offset[0] | 0, p.locate_offset[2] | 0] : [0, 0],
      /** The one candidate chunk of the region containing (cx, cz). */
      candidate: function (seed, cx, cz, out) {
        var rx = floorDiv(cx, spacing), rz = floorDiv(cz, spacing);
        var r = rngFor(seed, rx, rz, salt + 0x5F1);
        var ox, oz;
        if (tri) { ox = ((r.nextInt(span) + r.nextInt(span)) / 2) | 0; oz = ((r.nextInt(span) + r.nextInt(span)) / 2) | 0; }
        else { ox = r.nextInt(span); oz = r.nextInt(span); }
        out[0] = rx * spacing + ox; out[1] = rz * spacing + oz;
        out[2] = rx; out[3] = rz;
        return out;
      },
      /** The candidate chunk of region (rx, rz) directly — the write pass iterates REGIONS. */
      candidateOfRegion: function (seed, rx, rz, out) {
        var r = rngFor(seed, rx, rz, salt + 0x5F1);
        var ox, oz;
        if (tri) { ox = ((r.nextInt(span) + r.nextInt(span)) / 2) | 0; oz = ((r.nextInt(span) + r.nextInt(span)) / 2) | 0; }
        else { ox = r.nextInt(span); oz = r.nextInt(span); }
        out[0] = rx * spacing + ox; out[1] = rz * spacing + oz;
        out[2] = rx; out[3] = rz;
        return out;
      },
      regionOf: function (cx, cz, out) { out[0] = floorDiv(cx, spacing); out[1] = floorDiv(cz, spacing); return out; }
    };
  }

  /**
   * `minecraft:concentric_rings` — vanilla's `ConcentricRingsStructurePlacement`, which only
   * `strongholds` uses: `distance: 32`, `spread: 3`, `count: 128`.
   *
   * ⚠ THIS IS NOT A GRID AND CANNOT BE ANSWERED PER REGION. The 128 positions are laid out in
   * rings around the world origin, each ring holding more than the last, and every one of them
   * depends on the draws that placed the ones before it. So they are computed ONCE per seed,
   * lazily, and the per-chunk question is a lookup in that list.
   *
   * ⚠ WHAT IS LEFT OUT, SAID PLAINLY: vanilla then walks each ring position outward to the
   * nearest chunk whose biome is in the stronghold tag. That walk is a biome search over
   * thousands of candidate positions at world-generation start-up, and it moves a stronghold by
   * at most a few hundred blocks. MC-Lite keeps the ring geometry and applies the biome test as
   * a plain accept/reject at the ring position. The rings are vanilla's; the nudge is not there.
   */
  function concentricRings(p, name) {
    var distance = p.distance | 0, spread = p.spread | 0, count = p.count | 0;
    if (!(distance > 0 && spread > 0 && count > 0)) throw new Error('structure_set ' + name + ': bad concentric_rings');
    return { kind: 'concentric_rings', distance: distance, spread: spread, count: count, salt: 0 };
  }

  /** The 128 stronghold chunks for this seed, in ring order. Computed once, cached on the seed. */
  var ringsSeed = -1, ringsOf = null;
  ST.ringPositions = function (pl) {
    if (ringsOf && ringsSeed === (ST.G.seed | 0)) return ringsOf;
    var out = [];
    var r = rngFor(ST.G.seed | 0, 0, 0, 0x5714);
    var angle = r.nextFloat() * Math.PI * 2;
    var inRing = pl.spread, placed = 0, ring = 0;
    for (var i = 0; i < pl.count; i++) {
      var d = (4 * pl.distance + pl.distance * ring * 6) + (r.nextFloat() - 0.5) * pl.distance * 2.5;
      var cx = Math.round(Math.cos(angle) * d);
      var cz = Math.round(Math.sin(angle) * d);
      out.push(cx, cz);
      angle += (Math.PI * 2) / inRing;
      if (++placed === inRing) {
        ring++; placed = 0;
        inRing = inRing + 2 * inRing / (ring + 1);
        inRing = Math.min(inRing | 0, pl.count - i);
        if (inRing < 1) inRing = 1;
        angle += r.nextFloat() * Math.PI * 2;
      }
    }
    ringsOf = out; ringsSeed = ST.G.seed | 0;
    return out;
  };

  // ── the registry: 17 sets over 31 configured structures ─────────────────────────────────────

  /**
   * register(type, maker) — a piece grammar for one structure TYPE.
   *
   * `maker(def)` returns `{ reach, expand }`:
   *   reach     how far in CHUNKS a start of this type may write from its own chunk. It is what
   *             bounds the write pass's neighbourhood, so it must be an over-estimate, never an
   *             under-estimate: a piece outside `reach` is a piece that appears or not depending
   *             on which chunk the player walked in from, which is the invariant this file is
   *             about.
   *   expand    (start, rng) -> the piece list, each `{x0,y0,z0,x1,y1,z1,...}` in WORLD blocks,
   *             plus a `write(SB, cx, cz, piece, start)` on the returned grammar.
   */
  ST.register = function (type, maker) {
    if (!ST.makers) ST.makers = Object.create(null);
    ST.makers[type.replace('minecraft:', '')] = maker;
    return ST;
  };

  ST.init = function (G) {
    ST.G = G;
    ST.ready = false;
    var WG = NS.WG;
    if (!WG || !WG.ready) throw new Error('Structures.init before WG.init');
    if (!NS.Biomes || !NS.Biomes.ready) throw new Error('Structures.init before Biomes.init');
    if (!ST.makers) ST.makers = Object.create(null);

    // 1. the configured structures, with their biome tag resolved to REGISTRY INDICES.
    //    Indices, not names: the eligibility test runs against `Gen.biomeAt3`, which returns an
    //    index, and turning that back into a name per query would be a string compare on a path
    //    that runs a few hundred times a chunk.
    ST.defs = Object.create(null);
    var names = WG.names('configured_structure_feature');
    var B = NS.Biomes;
    for (var i = 0; i < names.length; i++) {
      var nm = names[i], src = WG.get('configured_structure_feature', nm);
      var type = String(src.type || '').replace('minecraft:', '');
      var tag = src.biomes;
      var allow = new Uint8Array(B.count);
      var nAllow = 0;
      var list = (typeof tag === 'string') ? WG.biomeTag(tag)
               : (Array.isArray(tag) ? tag.map(function (t) { return String(t).replace('minecraft:', ''); }) : null);
      if (!list) throw new Error('structure ' + nm + ': biomes field is neither a tag nor a list');
      for (var j = 0; j < list.length; j++) {
        // ⚠ `B.index` THROWS on a name it does not have, and a Nether biome in an overworld
        // roster is not an error (see below), so the raw table is what is asked here.
        var bi = B.indexOf[list[j]];
        if (bi === undefined) bi = -1;
        // ⚠ a Nether or End biome is legitimately absent from an overworld build's roster, and
        // that is not an error — `nether_fossil` names `soul_sand_valley` and nothing here has
        // one. A tag whose entries ALL miss is the error, and it is caught below.
        if (bi >= 0 && bi < B.count && !allow[bi]) { allow[bi] = 1; nAllow++; }
      }
      var maker = ST.makers[type];
      // ⚠ A MAKER MAY DECLINE, and one has to be able to. `igloo` and `ruined_portal` are NBT
      // templates, so with no template blob decoded they have no pieces to place — and the
      // honest answer is "this structure has no grammar in this build", which is exactly what
      // W15..W18's unfinished structures already report. Crashing in the piece pass instead is
      // how a check that builds its own worker message discovers the blob it forgot to send.
      var g = maker ? maker(src.config || {}) : null;
      if (g === null) maker = null;
      ST.defs[nm] = {
        name: nm, type: type, config: src.config || {},
        tag: (typeof tag === 'string') ? tag : null,
        allow: allow, allowCount: nAllow, tagSize: list.length,
        step: (STEP_OF[type] === undefined ? STEP_OF._default : STEP_OF[type]),
        dim: DIM_OF[type] || 'overworld',
        grammar: g,
        reach: g ? (g.reach | 0) : 0,
        // `spawn_overrides`: category -> { bounding_box: 'piece'|'full', spawns: [...] } (StructureSpawns)
        spawnOverrides: src.spawn_overrides || null
      };
    }

    // 2. the 17 structure sets
    ST.sets = [];
    var setNames = WG.names('structure_set');
    for (i = 0; i < setNames.length; i++) {
      var sn = setNames[i], ss = WG.get('structure_set', sn);
      var pl = ss.placement || {};
      var ptype = String(pl.type || '').replace('minecraft:', '');
      var placement;
      if (ptype === 'random_spread') placement = randomSpread(pl, sn);
      else if (ptype === 'concentric_rings') placement = concentricRings(pl, sn);
      else throw new Error('structure_set ' + sn + ': unknown placement type ' + ptype);
      var members = [], total = 0, reach = 0, anyGrammar = false;
      for (j = 0; j < (ss.structures || []).length; j++) {
        var e = ss.structures[j];
        var dn = String(e.structure).replace('minecraft:', '');
        var d = ST.defs[dn];
        if (!d) throw new Error('structure_set ' + sn + ': names ' + dn + ', which is not a configured structure');
        var w = e.weight === undefined ? 1 : (e.weight | 0);
        members.push({ def: d, weight: w });
        total += w;
        if (d.reach > reach) reach = d.reach;
        if (d.grammar) anyGrammar = true;
      }
      ST.sets.push({
        name: sn, index: i, placement: placement, members: members, weightTotal: total,
        dim: members.length ? members[0].def.dim : 'overworld',
        reach: reach, live: anyGrammar
      });
    }

    ST.cache = new Map();
    ST.cacheHits = 0; ST.cacheMisses = 0;
    ringsSeed = -1; ringsOf = null;
    ST.ready = true;
    return ST;
  };

  /**
   * ChunkGenerator.getEntitySpawnList's structure half: the spawn entries the first structure
   * covering (x,y,z) overrides `category` with, or null when none does (the caller then uses the
   * biome's list). `piece` boxes test each StructurePiece (StructureAccessor.method_41033);
   * `full` tests the whole start's box. An override with an EMPTY list still wins (monument's
   * axolotls / underground_water_creature) - it returns [].
   */
  ST.spawnOverride = function (x, y, z, category, onNetherBricks) {
    if (!ST.ready) return null;
    var near = ST.startsNear(x >> 4, z >> 4);
    for (var i = 0; i < near.length; i++) {
      var s = near[i], ov = s.def.spawnOverrides, o = ov && ov[category];
      if (!o) continue;
      var hit = false;
      // SpawnHelper.shouldUseNetherFortressSpawns: monster over nether_bricks tests the whole START box
      if (o.bounding_box === 'piece' && !(onNetherBricks && s.def.name === 'fortress')) {
        for (var k = 0; k < s.pieces.length && !hit; k++) {
          var p = s.pieces[k];
          hit = x >= p.x0 && x <= p.x1 && y >= p.y0 && y <= p.y1 && z >= p.z0 && z <= p.z1;
        }
      } else {
        hit = x >= s.x0 && x <= s.x1 && y >= s.y0 && y <= s.y1 && z >= s.z0 && z <= s.z1;
      }
      if (hit) {
        return o.spawns.map(function (e) {
          return { type: String(e.type).replace('minecraft:', ''), weight: e.weight | 0,
                   minCount: e.minCount | 0, maxCount: e.maxCount | 0 };
        });
      }
    }
    return null;
  };

  /**
   * StructureAccessor.getStructureContaining(pos, feature).hasChildren(): is (x,y,z) inside any PIECE box
   * of a start named `name`? (CatEntity.initialize's swamp-hut test.)
   */
  ST.containsAt = function (name, x, y, z) {
    if (!ST.ready) return false;
    var near = ST.startsNear(x >> 4, z >> 4);
    for (var i = 0; i < near.length; i++) {
      var s = near[i];
      if (s.def.name !== name || !s.pieces) continue;
      for (var k = 0; k < s.pieces.length; k++) {
        var p = s.pieces[k];
        if (x >= p.x0 && x <= p.x1 && y >= p.y0 && y <= p.y1 && z >= p.z0 && z <= p.z1) return true;
      }
    }
    return false;
  };

  /** Throw away every cached start. `Gen.init` calls it: a new seed invalidates all of them. */
  ST.dropCache = function () { if (ST.cache) ST.cache.clear(); ringsSeed = -1; ringsOf = null; ringIndex = null; return ST; };

  // ── 1. THE START PASS ───────────────────────────────────────────────────────────────────────

  var _cand = new Int32Array(4);

  /**
   * eligible(def, ccx, ccz, y) — may this structure start in this chunk?
   *
   * The biome at the chunk's MIDDLE block, at the structure's own y, out of D-180's volume. The
   * middle rather than the corner is vanilla's `ChunkPos.getMiddleBlockX()`, and it matters at a
   * biome border: a structure keyed on the corner would appear in the neighbour's biome whenever
   * the corner and the middle disagree.
   */
  function eligible(def, ccx, ccz, y) {
    return eligibleAt(def, (ccx << 4) + 8, y, (ccz << 4) + 8);
  }
  ST.eligible = eligible;

  /**
   * eligibleAt(def, x, y, z) — the same question at an arbitrary POSITION (D-257).
   *
   * ⚠ VANILLA DOES NOT ALWAYS ASK AT THE CHUNK'S MIDDLE, and which position it asks at is per
   * structure, not per game. `PieceGeneratorSupplier.checkForBiomeOnTop` — igloo, shipwreck, the
   * simple template structures — asks at the chunk middle, and those keep `preProbeY` and go
   * through `eligible` above. `JigsawPlacement.addPieces` asks at the START PIECE's own box
   * centre, and `RuinedPortalFeature` at its template box centre. One block of difference is one
   * QUART CELL of difference at a biome border, and that is the whole of D-244's outpost.
   *
   * ⚠ `biomeAt3Sparse`, not `biomeAt3`, and the difference is 0.20 ms a chunk (D-184). It is
   * the same `Climate.columnBiomes` sweep D-180's volume is made of, done for the one quart
   * column the question is about instead of all sixteen — and when the candidate chunk's
   * volume is already cached it IS `biomeAt3`, reading that array. The answer is the same
   * index either way, by construction and by `structcheck` §3.
   */
  function eligibleAt(def, x, y, z) {
    // ⚠ NO NETHER BIOME SAMPLER IS WIRED TO `G` YET (BiomeDims.netherBiome wants the six climate floats
    // nothing here computes). `has_structure/nether_fortress` names every Nether biome, so for a
    // Nether def the biome test is a tautology and is skipped rather than asked of the overworld source.
    if (def.dim !== 'overworld') return true;
    var b = ST.G.biomeAt3Sparse(x, y, z);
    return def.allow[b] === 1;
  }
  ST.eligibleAt = eligibleAt;

  /**
   * startsOfRegion(si, rx, rz) -> the starts one region of one set produces. UNCACHED.
   *
   * ⚠ THIS IS THE ONLY PLACE A START IS DECIDED, and it reads no blocks and generates no
   * neighbouring chunk. It asks three things and all three are pure functions of position: the
   * grid (arithmetic), the biome (D-180's volume), and the structure's own gate (its rng).
   * The hot path does not call it one region at a time — see `blockStarts` — but every answer
   * the hot path gives comes from this function, which is what makes the two comparable and what
   * `structcheck` §3 compares.
   */
  function startsOfRegion(si, rx, rz) {
    var set = ST.sets[si], seed = ST.G.seed | 0, pl = set.placement;
    if (pl.kind !== 'random_spread') return EMPTY;
    pl.candidateOfRegion(seed, rx, rz, _cand);
    return buildStart(set, _cand[0], _cand[1], seed);
  }
  var EMPTY = [];
  ST.startsOfRegion = startsOfRegion;

  // ── locateStructure (#776) ─────────────────────────────────────────────────────────────────
  // `ConfiguredStructureFeatureTags` (the tags `locateStructure` takes) with nested tags
  // flattened; `tools/locatecheck.mjs` compares this table against the jar's own tag files.
  ST.STRUCTURE_TAGS = {
    dolphin_located: ['ocean_ruin_cold', 'ocean_ruin_warm', 'shipwreck', 'shipwreck_beached'],
    eye_of_ender_located: ['stronghold'],
    mineshaft: ['mineshaft', 'mineshaft_mesa'],
    ocean_ruin: ['ocean_ruin_cold', 'ocean_ruin_warm'],
    on_ocean_explorer_maps: ['monument'],
    on_treasure_maps: ['buried_treasure'],
    on_woodland_explorer_maps: ['mansion'],
    ruined_portal: ['ruined_portal_desert', 'ruined_portal_jungle', 'ruined_portal_mountain',
      'ruined_portal_nether', 'ruined_portal_ocean', 'ruined_portal', 'ruined_portal_swamp'],
    shipwreck: ['shipwreck', 'shipwreck_beached'],
    village: ['village_plains', 'village_desert', 'village_savanna', 'village_snowy', 'village_taiga']
  };

  /**
   * locateStructure(tag, x, z, radius) -> {x, y, z, cx, cz, name} or null (y: StructureFeature.getLocatedPos, 0 + offset.y; 32 for rings). ChunkGenerator.locateStructure
   * with skipExistingChunks=false: rings of regions 0..radius around the chunk, spacing-scaled, the
   * first ring with any hit returns the nearest (squared block distance) across placements. Position
   * is the start chunk's corner plus the placement's locate_offset. `tag` may be a name or `#minecraft:name`.
   * Concentric rings: nearest of the ring chunks at (x*16+8, 32, z*16+8), radius ignored (as vanilla).
   */
  ST.locateStructure = function (tag, x, z, radius) {
    if (!ST.ready) return null;
    var names = ST.STRUCTURE_TAGS[String(tag).replace('#', '').replace('minecraft:', '')];
    if (!names) return null;
    var best = null, bestD = Infinity, si, i, m, set;
    var cx0 = x >> 4, cz0 = z >> 4, seed = ST.G.seed | 0;
    var open = [];
    for (si = 0; si < ST.sets.length; si++) {
      set = ST.sets[si];
      var mem = [];
      for (m = 0; m < set.members.length; m++) if (names.indexOf(set.members[m].def.name) >= 0 && set.members[m].def.grammar) mem.push(set.members[m].def.name);
      if (!mem.length) continue;
      if (set.placement.kind === 'concentric_rings') {
        var rp = ST.ringPositions(set.placement);
        for (i = 0; i < rp.length; i += 2) {
          var bx = (rp[i] << 4) + 8, bz = (rp[i + 1] << 4) + 8;
          var d = (bx - x) * (bx - x) + (bz - z) * (bz - z);
          if (d < bestD) { bestD = d; best = { x: bx, y: 32, z: bz, cx: rp[i], cz: rp[i + 1], name: mem[0] }; }
        }
      } else open.push({ si: si, set: set, mem: mem });
    }
    for (var ring = 0; ring <= radius && open.length; ring++) {
      var hit = false;
      for (var o = 0; o < open.length; o++) {
        var set2 = open[o].set, pl = set2.placement, sp = pl.spacing;
        for (var dz = -ring; dz <= ring; dz++) {
          var edgeZ = dz === -ring || dz === ring;
          for (var dx = -ring; dx <= ring; dx++) {
            if (!edgeZ && dx !== -ring && dx !== ring) continue;
            var list = startsOfRegion(open[o].si, floorDiv(cx0 + sp * dx, sp), floorDiv(cz0 + sp * dz, sp));
            for (i = 0; i < list.length; i++) {
              var st = list[i];
              if (open[o].mem.indexOf(st.def.name) < 0) continue;
              var px = (st.cx << 4) + pl.locateOffset[0], pz = (st.cz << 4) + pl.locateOffset[1];
              var dd = (px - x) * (px - x) + (pz - z) * (pz - z);
              hit = true;
              if (dd < bestD) { bestD = dd; best = { x: px, y: pl.locateOffset[2] | 0, z: pz, cx: st.cx, cz: st.cz, name: st.def.name }; }
            }
          }
        }
      }
      if (hit) return best;
    }
    return best;
  };

  // ── ⚠ THE CACHE IS OVER BLOCKS OF REGIONS, NOT OVER REGIONS, AND THAT IS A MEASUREMENT ─────
  //
  // The first version cached one entry per (set, region) and had `startsNear` walk every region
  // within reach. For `mineshafts` — spacing 1, reach 8 — that is a 17x17 = **289 map lookups in
  // every chunk generated**, and it measured at **0.374 ms a chunk**, which against PLAN §7's
  // *"structures must not measurably move chunk generation time"* is not a rounding error: it is
  // three per cent of the whole budget spent discovering that 288 regions had nothing in them.
  //
  // So the cache is keyed by a 16x16 BLOCK of regions instead. A miss evaluates all 256 regions
  // in the block once and keeps only the starts — usually one, often none — and a chunk then
  // asks for the one to four blocks its reach touches. The per-chunk cost drops from 289 lookups
  // to at most four, and the 256 evaluations are amortised over the 256 chunks (at spacing 1)
  // that the block covers. The ANSWER is unchanged: the block is a superset of the regions the
  // reach needs and every start still passes the same bounding-box test.
  // ⚠ FOUR, NOT SIXTEEN, AND THAT TOO IS A MEASUREMENT. A block miss pays for every region in
  // it, so the block size trades how many lookups a chunk makes against how much work the first
  // chunk in a fresh area does — and the work is not the lookup, it is that a region which
  // passes the gate expands a whole mineshaft. At 16, gencheck's cold 49-chunk window built four
  // blocks: 1,024 regions and about eight mineshafts, against the ~530 regions and ~4 mineshafts
  // that window can actually see. At 4 the overshoot is gone, and a chunk still asks at most 36
  // lookups against the naive 289.
  // ⚠ AND THE BLOCK SIZE IS PER SET, WHICH IS THE SECOND HALF OF THE SAME MEASUREMENT (D-192).
  // A fixed 4x4 block is right for `mineshafts`, whose spacing is 1: a chunk's reach spans 17
  // regions, so the block is smaller than the question. It is catastrophic for `villages`, whose
  // spacing is 34: a chunk's reach spans ONE region and a 4x4 block evaluates sixteen — and an
  // evaluation there is not an rng draw, it is a 169-sample terrain survey and sometimes a whole
  // jigsaw assembly. With fourteen live sets that overshoot measured at **+3.15 ms a chunk** on
  // gencheck's cold window, over the whole structure budget. A set whose spacing already exceeds
  // its reach gets a block of one region, which is the region cache with no overshoot at all.
  var BLOCK_CACHE_MAX = 2048;            // ⚠ each block holds whole piece lists — see below

  ST.blockSizeOf = blockSizeOf;
  function blockSizeOf(set) {
    return set.placement.spacing <= 2 ? 4 : 1;
  }

  function blockStarts(si, bx, bz, BLOCK) {
    var key = (si * 4398046511104) + ((bx & 0x3FFFFF) * 4194304) + (bz & 0x3FFFFF);
    var got = ST.cache.get(key);
    if (got !== undefined) { ST.cacheHits++; return got; }
    ST.cacheMisses++;
    var out = null;
    var r0x = bx * BLOCK, r0z = bz * BLOCK;
    for (var rz = r0z; rz < r0z + BLOCK; rz++) {
      for (var rx = r0x; rx < r0x + BLOCK; rx++) {
        var list = startsOfRegion(si, rx, rz);
        for (var i = 0; i < list.length; i++) { if (out === null) out = []; out.push(list[i]); }
      }
    }
    if (out === null) out = EMPTY;
    ST.cache.set(key, out);
    // ⚠ bounded, and the reason is bytes and not lookups: a block holds whole expanded
    // mineshafts, and a mineshaft is a couple of hundred pieces. 2,048 blocks of 16 regions is
    // 32,768 chunks of coverage at spacing 1 — far more than any streaming radius — for a few
    // megabytes, where an unbounded cache would grow with the distance walked.
    if (ST.cache.size > BLOCK_CACHE_MAX) {
      var it = ST.cache.keys();
      for (var n = ST.cache.size - BLOCK_CACHE_MAX; n > 0; n--) ST.cache.delete(it.next().value);
    }
    return out;
  }
  ST.blockStarts = blockStarts;

  /**
   * buildStart(set, ccx, ccz, seed) — pick a structure out of the set and expand it.
   *
   * Vanilla draws from the set's weighted list and takes the first member whose biome accepts
   * the chunk; a member that also has its own gate (a mineshaft's `probability`) applies it
   * first. The draw-and-remove below is that, written so it terminates: each pass removes the
   * member it drew, so a set of n members costs at most n draws and the answer depends only on
   * (seed, region).
   */
  function buildStart(set, ccx, ccz, seed) {
    var r = rngFor(seed, ccx, ccz, 0x51A27 + set.index);
    var pool = null, total = set.weightTotal, k;
    for (var pass = 0; pass < set.members.length; pass++) {
      if (pool === null) { pool = []; for (k = 0; k < set.members.length; k++) pool.push(set.members[k]); }
      if (!pool.length) break;
      // weighted draw
      var pick = r.nextInt(total > 0 ? total : 1), at = 0, chosen = 0;
      for (k = 0; k < pool.length; k++) { at += pool[k].weight; if (pick < at) { chosen = k; break; } chosen = k; }
      var m = pool[chosen];
      pool.splice(chosen, 1); total -= m.weight;
      var def = m.def;
      if (!def.grammar) continue;                       // no piece grammar yet — W15..W18's
      var g = def.grammar;
      var sr = rngFor(seed, ccx, ccz, 0x21105 + def.step);
      // ⚠ THE GATE COMES FIRST AND THE BIOME TEST COMES LAST, and the order is a cost decision
      // with a correctness reason under it. A mineshaft's `probability` is 0.004, so the gate
      // rejects 249 chunks in 250 for one `nextFloat` — putting the biome question first would
      // pay for a volume lookup on every one of them. And the biome must be asked at the
      // structure's OWN Y (D-180), which is not known until the pieces have been laid out and
      // `moveBelowSeaLevel` has chosen the depth. So: gate, expand, then ask.
      if (g.gate && !g.gate(sr, ccx, ccz)) continue;
      // ⚠ AND A SURFACE STRUCTURE MAY DECLARE ITS PROBE Y BEFORE IT IS BUILT, WHICH SAVES THE
      // WHOLE BUILD. D-184 put the biome test after `expand` because a mineshaft's y is not
      // known until `moveBelowSeaLevel` has run. A village's is: it stands on the ground, and
      // `Column.height` at the chunk's middle answers that in one call. Testing the biome first
      // means an ocean candidate never runs a 169-sample terrain survey and never assembles a
      // village it is about to throw away — and a village assembly is six milliseconds.
      if (g.preProbeY) {
        if (!eligible(def, ccx, ccz, g.preProbeY(ccx, ccz))) continue;
      }
      var start = { def: def, cx: ccx, cz: ccz, y: 0, step: def.step, pieces: null,
                    x0: 0, y0: 0, z0: 0, x1: 0, y1: 0, z1: 0 };
      start.pieces = g.expand(start, sr);
      if (!start.pieces || !start.pieces.length) continue;
      var b0x = 2147483647, b0y = 2147483647, b0z = 2147483647;
      var b1x = -2147483648, b1y = -2147483648, b1z = -2147483648;
      for (k = 0; k < start.pieces.length; k++) {
        var p = start.pieces[k];
        if (p.x0 < b0x) b0x = p.x0; if (p.x1 > b1x) b1x = p.x1;
        if (p.y0 < b0y) b0y = p.y0; if (p.y1 > b1y) b1y = p.y1;
        if (p.z0 < b0z) b0z = p.z0; if (p.z1 > b1z) b1z = p.z1;
      }
      start.x0 = b0x; start.y0 = b0y; start.z0 = b0z;
      start.x1 = b1x; start.y1 = b1y; start.z1 = b1z;
      start.y = g.sampleY ? g.sampleY(start) : ((b0y + b1y) >> 1);
      // ⚠ THE PROBE IS THE START PIECE'S OWN BOX CENTRE, NOT THE CHUNK'S (D-257), for the
      // grammars that reach this line — the jigsaw ones. `JigsawPlacement.addPieces` reads the
      // biome at ((minX+maxX)/2, (minZ+maxZ)/2) of the piece it has just placed, and MC-Lite
      // asked one block away, at the chunk middle. One block is one quart cell at a border:
      // seed 1337's refused `pillager_outpost` at chunk (-12,-26) reads `wooded_badlands` at the
      // chunk middle and `desert` at its own start piece. `pieces[0]` is the start piece — the
      // whole assembly's bounding box is a different and larger thing, and vanilla does not use it.
      // The grammars that declare `preProbeY` are exactly the ones vanilla answers at the chunk
      // middle, and they never reach this line.
      var probe = (start.pieces && start.pieces.length) ? start.pieces[0] : start;
      if (!g.preProbeY && !eligibleAt(def, (probe.x0 + probe.x1) >> 1, start.y, (probe.z0 + probe.z1) >> 1)) continue;
      return [start];
    }
    return EMPTY;
  }

  /**
   * startsNear(cx, cz) -> every start whose bounding box overlaps chunk (cx, cz).
   *
   * ⚠ IT ITERATES REGIONS, NOT CHUNKS, and that is the whole reason placement is affordable.
   * A structure set with `spacing: 32` has ONE candidate chunk in every 32x32 chunks, so asking
   * "could one of these reach me" is one or two region lookups — not 169 chunk lookups, which is
   * what a naive neighbourhood scan would cost for each of the 17 sets. Only `mineshafts`, whose
   * spacing is 1, actually has a candidate in every chunk, and its 169 lookups are one rng
   * seeding each and are cached.
   */
  var _near = [];
  ST.startsNear = function (cx, cz) {
    _near.length = 0;
    if (!ST.ready) return _near;
    var seed = ST.G.seed | 0;
    for (var si = 0; si < ST.sets.length; si++) {
      var set = ST.sets[si];
      if (!set.live) continue;                       // no member has a piece grammar yet
      if (set.dim !== curDim()) continue;            // a Nether set is not placed in the overworld, nor the reverse
      var reach = set.reach;
      var pl = set.placement;
      if (pl.kind === 'concentric_rings') { ringsNear(si, set, cx, cz, reach); continue; }
      var r0x = floorDiv(cx - reach, pl.spacing), r1x = floorDiv(cx + reach, pl.spacing);
      var r0z = floorDiv(cz - reach, pl.spacing), r1z = floorDiv(cz + reach, pl.spacing);
      var BLOCK = blockSizeOf(set);
      var b0x = floorDiv(r0x, BLOCK), b1x = floorDiv(r1x, BLOCK);
      var b0z = floorDiv(r0z, BLOCK), b1z = floorDiv(r1z, BLOCK);
      for (var bz = b0z; bz <= b1z; bz++) {
        for (var bx = b0x; bx <= b1x; bx++) {
          var list = blockStarts(si, bx, bz, BLOCK);
          for (var i = 0; i < list.length; i++) {
            var s = list[i];
            if (s.x1 < (cx << 4) || s.x0 > (cx << 4) + 15) continue;
            if (s.z1 < (cz << 4) || s.z0 > (cz << 4) + 15) continue;
            _near.push(s);
          }
        }
      }
    }
    return _near;
  };

  /**
   * The `concentric_rings` half of `startsNear` (PLAN W18, D-190).
   *
   * ⚠ IT CANNOT USE THE REGION GRID, because there is no grid: the 128 stronghold chunks are a
   * ring layout around the origin and each one depends on the draws that placed the ones before
   * it. They are computed once per seed and indexed into 16x16-chunk cells, so a chunk asks one
   * to four cells instead of scanning all 128 — the same shape as the block cache, for the same
   * reason.
   */
  var ringIndex = null, ringIndexSeed = -1;
  function ringsNear(si, set, cx, cz, reach) {
    var pl = set.placement;
    var seed = ST.G.seed | 0;
    if (ringIndex === null || ringIndexSeed !== seed) {
      var pos = ST.ringPositions(pl);
      ringIndex = new Map();
      for (var i = 0; i < pos.length; i += 2) {
        var k = ((pos[i] >> 4) & 0xFFFF) * 65536 + ((pos[i + 1] >> 4) & 0xFFFF);
        var b = ringIndex.get(k);
        if (!b) { b = []; ringIndex.set(k, b); }
        b.push(pos[i], pos[i + 1]);
      }
      ringIndexSeed = seed;
    }
    for (var bz = (cz - reach) >> 4; bz <= ((cz + reach) >> 4); bz++) {
      for (var bx = (cx - reach) >> 4; bx <= ((cx + reach) >> 4); bx++) {
        var cell = ringIndex.get((bx & 0xFFFF) * 65536 + (bz & 0xFFFF));
        if (!cell) continue;
        for (var q = 0; q < cell.length; q += 2) {
          var ccx = cell[q], ccz = cell[q + 1];
          if (ccx < cx - reach || ccx > cx + reach || ccz < cz - reach || ccz > cz + reach) continue;
          var key = (si * 4398046511104) + ((ccx & 0x3FFFFF) * 4194304) + (ccz & 0x3FFFFF);
          var got = ST.cache.get(key);
          if (got === undefined) {
            got = buildStart(set, ccx, ccz, seed);
            ST.cache.set(key, got);
            ST.cacheMisses++;
          } else ST.cacheHits++;
          for (var n = 0; n < got.length; n++) {
            var s2 = got[n];
            if (s2.x1 < (cx << 4) || s2.x0 > (cx << 4) + 15) continue;
            if (s2.z1 < (cz << 4) || s2.z0 > (cz << 4) + 15) continue;
            _near.push(s2);
          }
        }
      }
    }
  }

  // ── 3. THE WRITE PASS ───────────────────────────────────────────────────────────────────────
  //
  // ⚠ ORDER IS DEFINED HERE AND IT MATTERS, the same way `Features.applyChunk`'s does. Two
  // pieces can write the same cell, so the result depends on which goes last, and "last" must
  // not be "whichever start the scan happened to find first". The sort key is
  // (step, candidate chunk z, candidate chunk x, piece index) — every term a property of the
  // structure and none of them a property of the chunk being generated or the order it arrived
  // in. `structcheck` §4 generates the same region in three orders and compares bytes.

  var curCx = 0x7fffffff, curCz = 0x7fffffff, curStep = -1, curList = null;

  ST.beginChunk = function (cx, cz) {
    curCx = cx; curCz = cz; curStep = -1; curList = null;
    if (!ST.ready) return ST;
    var near = ST.startsNear(cx, cz);
    if (!near.length) { curList = EMPTY; return ST; }
    curList = near.slice();
    curList.sort(function (a, b) {
      return (a.step - b.step) || (a.cz - b.cz) || (a.cx - b.cx) ||
             (a.def.name < b.def.name ? -1 : (a.def.name > b.def.name ? 1 : 0));
    });
    return ST;
  };

  /**
   * writeUpTo(SB, cx, cz, step, cH, sea) — write every start of a step in (lastStep, step].
   * Called once per decoration step by `Features.applyChunk`, and once with 10 by `genColumn`
   * so a world with the features pipeline switched off still gets its structures.
   */
  ST.writeUpTo = function (SB, cx, cz, step, cH, sea) {
    if (!ST.ready || curList === null || cx !== curCx || cz !== curCz) return 0;
    var n = 0;
    var ox = cx << 4, oz = cz << 4;
    for (var i = 0; i < curList.length; i++) {
      var s = curList[i];
      if (s.step <= curStep || s.step > step) continue;
      var g = s.def.grammar;
      for (var j = 0; j < s.pieces.length; j++) {
        var p = s.pieces[j];
        if (p.x1 < ox || p.x0 > ox + 15 || p.z1 < oz || p.z0 > oz + 15) continue;
        n += g.write(SB, cx, cz, p, s);
      }
    }
    curStep = step;
    ST.lastWritten = n;
    return n;
  };

  /** For tests and for `genColumn`: everything, in one call. */
  ST.applyChunk = function (SB, cx, cz, cH, sea) {
    ST.beginChunk(cx, cz);
    return ST.writeUpTo(SB, cx, cz, 10, cH, sea);
  };

  // ── the shared piece helpers, so a grammar does not grow its own ───────────────────────────
  //
  // ⚠ A piece writes THROUGH THE TARGET CHUNK'S CLIP, never around it. `set` silently drops a
  // write outside (cx, cz) — which is what makes "run every start that can reach me and keep the
  // part that lands here" correct rather than merely lucky.
  var H = CFG.CHUNK_H;

  function setAt(SB, cx, cz, x, y, z, st) {
    var lx = x - (cx << 4), lz = z - (cz << 4), ly = y - MINY;
    if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || ly < 0 || ly >= H) return 0;
    SB[(ly << 8) | (lz << 4) | lx] = st;
    return 1;
  }
  function getAt(SB, cx, cz, x, y, z) {
    var lx = x - (cx << 4), lz = z - (cz << 4), ly = y - MINY;
    if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || ly < 0 || ly >= H) return -1;
    return SB[(ly << 8) | (lz << 4) | lx];
  }
  ST.api = {
    set: setAt, get: getAt, MINY: MINY, H: H,
    stateOf: function (n) { return NS.States.stateOf(String(n).replace('minecraft:', '')); },
    withProp: function (st, prop, val) {
      var R = NS.Reg;
      if (!R || !R.PROP || R.PROP[prop] === undefined || R.PVAL[val] === undefined) return st;
      return NS.States.withProp(st, R.PROP[prop], R.PVAL[val]);
    },
    rngFor: rngFor
  };

  /** Counts, for the checks and for the HUD. */
  ST.stats = function () {
    var live = 0, withGrammar = 0, nm;
    for (var i = 0; i < ST.sets.length; i++) if (ST.sets[i].live) live++;
    for (nm in ST.defs) if (ST.defs[nm].grammar) withGrammar++;
    // ⚠ `withoutGrammar` is reported rather than left to be inferred (D-185). 29 of the 31
    // configured structures have their placement ported and no pieces yet — the stronghold's
    // concentric rings included — and a registry that printed only what works would read as
    // finished. W15..W18 are those 29.
    return { sets: ST.sets.length, structures: Object.keys(ST.defs).length,
             liveSets: live, withGrammar: withGrammar,
             withoutGrammar: Object.keys(ST.defs).length - withGrammar,
             cached: ST.cache ? ST.cache.size : 0, hits: ST.cacheHits, misses: ST.cacheMisses };
  };
})(MCL);
