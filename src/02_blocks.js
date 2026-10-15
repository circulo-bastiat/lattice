// 02_blocks.js — block registry. Parallel typed arrays, never objects: this is read in the
// mesher's inner loop (docs/archive/ARCH.md §3).
// Runs on: main thread AND workers. No DOM.

(function (NS) {
  'use strict';

  var MAX = 512;   // plenty; grows by editing this line, not by reallocating at runtime

  var B = NS.Blocks = {
    count:  0,
    names:  [],
    ids:    Object.create(null),

    solid:  new Uint8Array(MAX),
    opaque: new Uint8Array(MAX),
    emit:   new Uint8Array(MAX),
    atten:  new Uint8Array(MAX),
    layer:  new Uint8Array(MAX),
    tint:   new Uint8Array(MAX),
    tiles:  new Uint16Array(MAX * 6),

    // 0 = full cube, 1 = cross (two diagonal double-sided quads, plants and torches).
    // The vertex format only carries integer block coords, and a cross's four corners are all
    // integers, so a cross costs nothing the cube path does not already pay (D-56).
    model:  new Uint8Array(MAX),
    // 1 = the shader scrolls this block's texture (the §8 vertex `flag` bit): fluids only.
    anim: new Uint8Array(MAX),
    // 1 = do not emit a face between two blocks of THIS id. Leaves, glass, water, ice — the
    // single biggest quad-count win in the mesher, and the reason leaves are affordable at all.
    selfCull: new Uint8Array(MAX),
    // Seconds to break BY HAND. There are no tools in MC-Lite, so this is the only number the
    // break timer needs. Infinity = unbreakable. Read by 14_player.js, never by the mesher.
    hard: new Float32Array(MAX),

    MODEL_CUBE: 0, MODEL_CROSS: 1,

    inited: false
  };

  /**
   * Canonical atlas tile indices. This table lives HERE, not in 06_atlas.js, because the mesher
   * runs in the worker bundle (00-05) where the atlas does not exist: a worker that did not know
   * the tile indices would mesh the whole world with tile 0 (D-57). 06_atlas.js keeps a private
   * copy for its generator table and A.build() throws if the two ever disagree.
   */
  var T = B.T = {
    MISSING: 0,
    STONE: 1, DIRT: 2, GRASS_TOP: 3, GRASS_SIDE: 4, SAND: 5, GRAVEL: 6,
    COBBLESTONE: 7, BEDROCK: 8, DEEPSLATE: 9,
    OAK_LOG_SIDE: 10, OAK_LOG_TOP: 11, OAK_PLANKS: 12, OAK_LEAVES: 13,
    WATER: 14, SNOW: 15, SCULK: 16, GLOWSTONE: 17, SHORT_GRASS: 18,
    COAL_ORE: 19, IRON_ORE: 20, COPPER_ORE: 21, GOLD_ORE: 22,
    REDSTONE_ORE: 23, LAPIS_ORE: 24, DIAMOND_ORE: 25, EMERALD_ORE: 26,
    DEEPSLATE_COAL_ORE: 27, DEEPSLATE_IRON_ORE: 28, DEEPSLATE_GOLD_ORE: 29,
    DEEPSLATE_DIAMOND_ORE: 30, DEEPSLATE_REDSTONE_ORE: 31,
    DEEPSLATE_COPPER_ORE: 32, DEEPSLATE_LAPIS_ORE: 33, DEEPSLATE_EMERALD_ORE: 34,
    PODZOL_TOP: 35, PODZOL_SIDE: 36,
    SANDSTONE_TOP: 37, SANDSTONE_SIDE: 38, SANDSTONE_BOTTOM: 39,
    BIRCH_LOG_SIDE: 40, BIRCH_LOG_TOP: 41, BIRCH_PLANKS: 42, BIRCH_LEAVES: 43,
    SPRUCE_LOG_SIDE: 44, SPRUCE_LOG_TOP: 45, SPRUCE_PLANKS: 46, SPRUCE_LEAVES: 47,
    LAVA: 48, ICE: 49, CACTUS_TOP: 50, CACTUS_SIDE: 51, GLASS: 52, TORCH: 53,
    POPPY: 54, DANDELION: 55, DEAD_BUSH: 56
  };
  B.TILE_COUNT = 57;

  /**
   * def(name, props) -> id
   * props: {solid, opaque, emit, atten, layer, tint, tiles}
   *   tiles: a single tile index, or [all6], or {top, bottom, side}
   */
  B.def = function (name, props) {
    if (B.count >= MAX) throw new Error('block table full');
    var id = B.count++;
    props = props || {};
    B.names[id] = name;
    B.ids[name] = id;

    var opaque = props.opaque !== undefined ? !!props.opaque : (props.solid !== false);
    B.solid[id]  = props.solid !== false ? 1 : 0;
    B.opaque[id] = opaque ? 1 : 0;
    B.emit[id]   = props.emit | 0;
    B.atten[id]  = props.atten !== undefined ? (props.atten | 0) : (opaque ? 15 : 0);
    B.layer[id]  = props.layer | 0;
    B.tint[id]   = props.tint | 0;
    B.model[id]  = props.model | 0;
    B.selfCull[id] = props.selfCull ? 1 : 0;
    B.anim[id]   = props.anim ? 1 : 0;
    B.hard[id]   = props.hard !== undefined ? props.hard : (props.solid === false ? 0 : 1.5);

    var t = props.tiles, o = id * 6, f;
    if (t == null) { for (f = 0; f < 6; f++) B.tiles[o + f] = 0; }
    else if (typeof t === 'number') { for (f = 0; f < 6; f++) B.tiles[o + f] = t; }
    else if (t.length === 6) { for (f = 0; f < 6; f++) B.tiles[o + f] = t[f]; }
    else {
      var side = t.side | 0;
      B.tiles[o + 0] = B.tiles[o + 1] = B.tiles[o + 4] = B.tiles[o + 5] = side;
      B.tiles[o + 2] = t.top !== undefined ? t.top : side;
      B.tiles[o + 3] = t.bottom !== undefined ? t.bottom : side;
    }
    return id;
  };

  B.byName = function (n) { var v = B.ids[n]; return v === undefined ? 0 : v; };

  /**
   * init() — MUST produce identical ids on the main thread and in every worker, because ids
   * cross the boundary inside sections. Never make registration conditional on anything, and
   * never insert a block in the middle of this list: append.
   *
   * Tile indices are the real ones (B.T above) so a worker meshes correctly with no atlas.
   * 06_atlas.js still calls B.bindAtlas(A.map()) on the main thread; that call must be a no-op,
   * and tools/gencheck.mjs asserts it (D-57).
   */
  B.init = function () {
    if (B.inited) return B;
    var L = NS.CFG;
    var CUT = L.LAYER_CUTOUT, TRA = L.LAYER_TRANSLUCENT;

    function cross(name, tile, tint, emit) {
      return B.def(name, { solid: false, opaque: false, atten: 0, layer: CUT,
                           model: B.MODEL_CROSS, tiles: tile, tint: tint | 0, emit: emit | 0 });
    }

    // --- stone family --------------------------------------------------------
    B.def('air',           { solid: false, opaque: false, atten: 0, layer: L.LAYER_OPAQUE, tiles: T.MISSING });
    B.def('stone',         { tiles: T.STONE });
    B.def('cobblestone',   { tiles: T.COBBLESTONE });
    B.def('deepslate',     { tiles: T.DEEPSLATE });

    // --- soils ---------------------------------------------------------------
    B.def('dirt',          { tiles: T.DIRT });
    B.def('grass_block',   { tint: 1, tiles: { top: T.GRASS_TOP, bottom: T.DIRT, side: T.GRASS_SIDE } });
    B.def('podzol',        { tiles: { top: T.PODZOL_TOP, bottom: T.DIRT, side: T.PODZOL_SIDE } });
    B.def('sand',          { tiles: T.SAND });
    B.def('sandstone',     { tiles: { top: T.SANDSTONE_TOP, bottom: T.SANDSTONE_BOTTOM, side: T.SANDSTONE_SIDE } });
    B.def('gravel',        { tiles: T.GRAVEL });

    // --- ores. Stone and deepslate variants are separate ids so the surface pass never has to
    //     ask "which rock am I in?" twice (D-33). ORE_PAIRS below keeps them in step. ---------
    B.def('coal_ore',      { tiles: T.COAL_ORE });
    B.def('iron_ore',      { tiles: T.IRON_ORE });
    B.def('copper_ore',    { tiles: T.COPPER_ORE });
    B.def('gold_ore',      { tiles: T.GOLD_ORE });
    B.def('redstone_ore',  { tiles: T.REDSTONE_ORE });
    B.def('lapis_ore',     { tiles: T.LAPIS_ORE });
    B.def('diamond_ore',   { tiles: T.DIAMOND_ORE });
    B.def('emerald_ore',   { tiles: T.EMERALD_ORE });
    B.def('deepslate_coal_ore',     { tiles: T.DEEPSLATE_COAL_ORE });
    B.def('deepslate_iron_ore',     { tiles: T.DEEPSLATE_IRON_ORE });
    B.def('deepslate_copper_ore',   { tiles: T.DEEPSLATE_COPPER_ORE });
    B.def('deepslate_gold_ore',     { tiles: T.DEEPSLATE_GOLD_ORE });
    B.def('deepslate_redstone_ore', { tiles: T.DEEPSLATE_REDSTONE_ORE });
    B.def('deepslate_lapis_ore',    { tiles: T.DEEPSLATE_LAPIS_ORE });
    B.def('deepslate_diamond_ore',  { tiles: T.DEEPSLATE_DIAMOND_ORE });
    B.def('deepslate_emerald_ore',  { tiles: T.DEEPSLATE_EMERALD_ORE });

    // --- wood ----------------------------------------------------------------
    B.def('oak_log',       { tiles: { top: T.OAK_LOG_TOP, bottom: T.OAK_LOG_TOP, side: T.OAK_LOG_SIDE } });
    B.def('oak_planks',    { tiles: T.OAK_PLANKS });
    B.def('oak_leaves',    { opaque: false, atten: 1, layer: CUT, tint: 2, tiles: T.OAK_LEAVES });
    B.def('birch_log',     { tiles: { top: T.BIRCH_LOG_TOP, bottom: T.BIRCH_LOG_TOP, side: T.BIRCH_LOG_SIDE } });
    B.def('birch_planks',  { tiles: T.BIRCH_PLANKS });
    B.def('birch_leaves',  { opaque: false, atten: 1, layer: CUT, tint: 2, tiles: T.BIRCH_LEAVES });
    B.def('spruce_log',    { tiles: { top: T.SPRUCE_LOG_TOP, bottom: T.SPRUCE_LOG_TOP, side: T.SPRUCE_LOG_SIDE } });
    B.def('spruce_planks', { tiles: T.SPRUCE_PLANKS });
    B.def('spruce_leaves', { opaque: false, atten: 1, layer: CUT, tint: 2, tiles: T.SPRUCE_LEAVES });

    // --- fluids. Lava is OPAQUE on purpose: it is a full cube that emits, and making it
    //     translucent would put a lava lake in the back-to-front sort for no visual gain. -----
    B.def('water',         { solid: false, opaque: false, atten: 1, layer: TRA, tint: 3,
                             selfCull: true, anim: true, tiles: T.WATER });
    B.def('lava',          { solid: false, opaque: true, emit: 15, atten: 15, anim: true, tiles: T.LAVA });

    // --- the rest ------------------------------------------------------------
    B.def('bedrock',       { tiles: T.BEDROCK });
    B.def('snow_block',    { tiles: T.SNOW });
    B.def('ice',           { opaque: false, atten: 2, layer: TRA, selfCull: true, tiles: T.ICE });
    B.def('cactus',        { tiles: { top: T.CACTUS_TOP, bottom: T.CACTUS_TOP, side: T.CACTUS_SIDE } });
    B.def('glass',         { opaque: false, atten: 0, layer: CUT, selfCull: true, tiles: T.GLASS });
    B.def('sculk',         { tiles: T.SCULK });                    // deep dark (D-35)
    B.def('glowstone',     { emit: 15, tiles: T.GLOWSTONE });

    cross('torch',       T.TORCH, 0, 14);
    cross('short_grass', T.SHORT_GRASS, 1, 0);
    cross('poppy',       T.POPPY, 0, 0);
    cross('dandelion',   T.DANDELION, 0, 0);
    cross('dead_bush',   T.DEAD_BUSH, 0, 0);

    // --- break times, in seconds by hand (D-72). Grouped rather than passed to every def()
    //     above, so the block table stays readable and one number is one line. --------------
    var HARD = {
      dirt: 0.75, grass_block: 0.9, podzol: 0.75, sand: 0.75, gravel: 0.9, snow_block: 0.15,
      stone: 7.5, cobblestone: 10, sandstone: 6, deepslate: 15, sculk: 3,
      oak_log: 3, birch_log: 3, spruce_log: 3,
      oak_planks: 3, birch_planks: 3, spruce_planks: 3,
      oak_leaves: 0.3, birch_leaves: 0.3, spruce_leaves: 0.3,
      glass: 0.45, ice: 0.7, cactus: 0.65, glowstone: 0.45,
      bedrock: Infinity, water: Infinity, lava: Infinity, air: Infinity
    };
    for (var hn in HARD) { var hid = B.ids[hn]; if (hid !== undefined) B.hard[hid] = HARD[hn]; }
    for (var oi = 0; oi < B.count; oi++) {
      if (B.names[oi] && B.names[oi].indexOf('_ore') > 0) {
        B.hard[oi] = B.names[oi].indexOf('deepslate_') === 0 ? 22.5 : 15;
      }
    }

    B.AIR   = B.byName('air');
    B.STONE = B.byName('stone');
    B.WATER = B.byName('water');
    B.LAVA  = B.byName('lava');

    /** stoneOre id -> deepslate equivalent. Used by the ore pass, indexed by ore order. */
    B.ORE_PAIRS = [
      [B.byName('coal_ore'),     B.byName('deepslate_coal_ore')],
      [B.byName('iron_ore'),     B.byName('deepslate_iron_ore')],
      [B.byName('copper_ore'),   B.byName('deepslate_copper_ore')],
      [B.byName('gold_ore'),     B.byName('deepslate_gold_ore')],
      [B.byName('redstone_ore'), B.byName('deepslate_redstone_ore')],
      [B.byName('lapis_ore'),    B.byName('deepslate_lapis_ore')],
      [B.byName('diamond_ore'),  B.byName('deepslate_diamond_ore')],
      [B.byName('emerald_ore'),  B.byName('deepslate_emerald_ore')]
    ];

    B.LEAVES = [B.byName('oak_leaves'), B.byName('birch_leaves'), B.byName('spruce_leaves')];
    B.fastLeaves = false;

    B.inited = true;
    return B;
  };

  /**
   * setFastLeaves(on) — vanilla's "fast graphics" leaves, and one of the largest single wins
   * available on a weak machine (D-93).
   *
   * FANCY (off): leaves are `opaque:false, layer:cutout, selfCull:FALSE`. EVERY leaf face is
   * emitted, including the ones between two leaf blocks, because a leaf texture is 39.5%
   * see-through and the player looks through it at the next leaf. They all land in the cutout
   * pass and run an alpha test the GPU cannot early-Z away. A forest is the worst frame in the
   * game, and that is the honest cost of fancy leaves — vanilla pays it too.
   *
   * ⚠ Until session 5 leaves were `selfCull:true` in BOTH modes (D-178), which is vanilla's
   * FAST rule applied to the FANCY setting: 65-67% of every leaf face in the world was never
   * emitted and you could see the sky through a canopy. Do not "optimise" it back.
   *
   * FAST (on): leaves become fully opaque and move to the OPAQUE layer. The ordinary
   * opaque-neighbour cull — not self-culling — then removes every face between a leaf and its
   * neighbour, a tree canopy collapses to its silhouette, and what is left needs no alpha test.
   * This is exactly how vanilla does it: fast leaves are solid-render, not skip-rendering.
   * Measured on real terrain: fancy 61,448 leaf faces, fast 150 for the same 5x5x5 blob.
   *
   * Light attenuation is deliberately NOT changed: leaves still let one level through, so a
   * forest floor is lit the same either way and the two modes cannot produce different lighting.
   * This mutates the shared block table, so it must be called with the same argument on the main
   * thread and in every worker (Jobs.setMeshOptions does that), and it invalidates every mesh.
   */
  B.setFastLeaves = function (on) {
    on = !!on;
    if (!B.inited || B.fastLeaves === on) return B.fastLeaves;
    B.fastLeaves = on;
    for (var i = 0; i < B.LEAVES.length; i++) {
      var id = B.LEAVES[i];
      B.opaque[id] = on ? 1 : 0;
      B.layer[id] = on ? NS.CFG.LAYER_OPAQUE : NS.CFG.LAYER_CUTOUT;
      B.selfCull[id] = 0;   // D-178 — see 02c_states.js §3. Opacity does the culling in fast mode.
    }
    return B.fastLeaves;
  };

  /** 06_atlas.js calls this with {blockName: tileSpec} once the atlas is built (main thread only). */
  B.bindAtlas = function (map) {
    for (var name in map) {
      var id = B.ids[name];
      if (id === undefined) continue;
      var t = map[name], o = id * 6, f;
      if (typeof t === 'number') { for (f = 0; f < 6; f++) B.tiles[o + f] = t; }
      else if (t.length === 6) { for (f = 0; f < 6; f++) B.tiles[o + f] = t[f]; }
      else {
        var side = t.side | 0;
        B.tiles[o + 0] = B.tiles[o + 1] = B.tiles[o + 4] = B.tiles[o + 5] = side;
        B.tiles[o + 2] = t.top !== undefined ? t.top : side;
        B.tiles[o + 3] = t.bottom !== undefined ? t.bottom : side;
      }
    }
  };
})(MCL);
