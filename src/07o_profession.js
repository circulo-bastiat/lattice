// 07o_profession.js — PLAN G18f unit 2: PROFESSIONS AND WORKSTATIONS, the registry.
// Runs on: MAIN THREAD ONLY. No DOM.
//
// ⚠⚠ THE REGISTRY IS READ FROM THE BYTECODE, NOT REMEMBERED (D-479). `bnz` (VillagerProfession,
// identified by `bnw`/Villager's own `getVillagerData()` field type) declares exactly 15 static
// constants in this order — none, armorer, butcher, cartographer, cleric, farmer, fisherman,
// fletcher, leatherworker, librarian, mason, nitwit, shepherd, toolsmith, weaponsmith — each
// built from one `bhv` (PoiType) argument, javap'd off `jars/1.18.2/1.18.2.jar` this session.
// `bhv`'s own `<clinit>` registers the REAL block id string right next to the `putstatic` that
// names its field (`Registry.register(POINT_OF_INTEREST_TYPE, "smoker", ...)`-shaped), so every
// row below is a jar string literal the disassembly was grepped for, not a name anyone typed
// from memory: armorer -> blast_furnace (`bhv.d`/`cdr.mi`), butcher -> smoker (`bhv.e`/`cdr.mh`),
// cartographer -> cartography_table (`bhv.f`/`cdr.mj`), cleric -> brewing_stand (`bhv.g`/
// `cdr.ej`), farmer -> composter (`bhv.h`/`cdr.no`), fisherman -> barrel (`bhv.i`/`cdr.mg`),
// fletcher -> fletching_table (`bhv.j`/`cdr.mk`), leatherworker -> the FOUR cauldron blocks —
// `bhv.k`'s own constructor takes a 4-member `ImmutableSet`, not a single block (`cdr.ek/em/
// el/en` — cauldron/water_cauldron/lava_cauldron/powder_snow_cauldron, confirmed against
// `assets/block-registry.json`) — librarian -> lectern (`bhv.l`/`cdr.mm`), mason -> stonecutter
// (`bhv.m`/`cdr.mo`), shepherd -> loom (`bhv.o`/`cdr.mf`), toolsmith -> smithing_table (`bhv.p`/
// `cdr.mn`), weaponsmith -> grindstone (`bhv.q`/`cdr.ml`). `none` and `nitwit` both register an
// EMPTY block set (`bhv.c`/`bhv.n`) — no workstation is vanilla's own rule for them, not a gap.
//
// ⚠ WHAT THIS UNIT DOES: the registry above, plus an adjacency claim — an unemployed villager
// touching one of its 8 horizontal neighbour cells (same Y as its feet) becomes that block's
// profession, and the block is marked claimed so a second villager cannot also take it.
// ⚠⚠ THIS IS NOT VANILLA'S REAL RULE, AND IS NAMED AS SUCH, NOT PASSED OFF AS IT (`Prof.OWED`).
// Real 1.14+ villagers claim a job site through the Brain/Sensor/POI-manager system — a global
// point-of-interest index searched within its own radius, on its own schedule, from ANYWHERE in
// range, not "standing right next to it." This engine has no Brain substrate at all (07k_goals.js
// is Goal-based; a real port is a new AI architecture, not this unit's job), and the real search
// radius is unread rather than guessed (never invent a number the game owns, rule 3) — adjacency
// is the closest rule this engine can enforce today without inventing one. A villager built or
// walked next to a smoker becomes a butcher; one ten blocks away does not, which is real vanilla
// behaviour too (out of range refuses there as well) even though the boundary itself is wrong.

(function (NS) {
  'use strict';

  var Prof = NS.Profession = { ready: false };

  Prof.WORKSTATIONS = {
    armorer: ['blast_furnace'],
    butcher: ['smoker'],
    cartographer: ['cartography_table'],
    cleric: ['brewing_stand'],
    farmer: ['composter'],
    fisherman: ['barrel'],
    fletcher: ['fletching_table'],
    leatherworker: ['cauldron', 'water_cauldron', 'lava_cauldron', 'powder_snow_cauldron'],
    librarian: ['lectern'],
    mason: ['stonecutter'],
    shepherd: ['loom'],
    toolsmith: ['smithing_table'],
    weaponsmith: ['grindstone']
    // none/nitwit: no workstation at all — bhv.c/bhv.n's own empty set, above.
  };

  /** All 15, in `bnz`'s own declaration order — the same order `tamecheck`-style checks assert
   *  a registry's SIZE against, so a future professions row 3 read (or a version bump) that
   *  silently drops one is caught rather than shrugged at. */
  Prof.ALL = ['none', 'armorer', 'butcher', 'cartographer', 'cleric', 'farmer', 'fisherman',
    'fletcher', 'leatherworker', 'librarian', 'mason', 'nitwit', 'shepherd', 'toolsmith',
    'weaponsmith'];

  // The 8 horizontal-plane neighbours, same Y as the villager's own feet — see the file header
  // for why this is adjacency and not vanilla's real search radius.
  Prof.NEIGHBOURS = [
    [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]
  ];

  // ── § VILLAGER TYPE (bob/VillagerType, .decomp:13-66) ──────────────────────────────────────
  // `forBiome` (.decomp:64-66): `BIOME_TO_TYPE.get(biome) orElse PLAINS` — the 7-constant enum
  // (.decomp:14-20) plus the `Util.make` map literal (.decomp:22-50) transcribed verbatim below,
  // biome registry keys resolved through `.decomp/net/minecraft/world/biome/BiomeKeys.java`
  // (the field_NNNNN constants .decomp:22-50 actually name). PLAINS itself is never a map
  // VALUE — every biome not listed below (plains itself, forest, ocean, river, mushroom_fields,
  // the Nether/End set, ...) falls through `forBiome`'s own `orElse(PLAINS)`, so there is no
  // separate "plains" entry to transcribe.
  Prof.TYPE_BIOMES = {
    desert: ['badlands', 'desert', 'eroded_badlands', 'wooded_badlands'],               // field_9415/9424/9443/35110
    jungle: ['bamboo_jungle', 'jungle', 'sparse_jungle'],                               // field_9440/9417/35118
    savanna: ['savanna', 'savanna_plateau', 'windswept_savanna'],                       // field_9449/9430/35114
    snow: ['deep_frozen_ocean', 'frozen_ocean', 'frozen_river', 'ice_spikes',
      'snowy_beach', 'snowy_taiga', 'snowy_plains', 'grove', 'snowy_slopes',
      'frozen_peaks', 'jagged_peaks'],   // field_9418/9435/9463/9453/9478/9454/35117/34471/34472/35115/34474
    swamp: ['swamp'],                                                                    // field_9471
    taiga: ['old_growth_spruce_taiga', 'old_growth_pine_taiga', 'windswept_gravelly_hills',
      'windswept_hills', 'taiga', 'windswept_forest']    // field_35113/35119/35111/35116/9420/35120
  };

  var biomeToType = null;
  function initBiomeToType() {
    biomeToType = {};
    for (var t in Prof.TYPE_BIOMES) {
      var list = Prof.TYPE_BIOMES[t];
      for (var i = 0; i < list.length; i++) biomeToType[list[i]] = t;
    }
  }

  /** `forBiome`'s pure half — biome NAME in, villager type out, `'plains'` for anything not in
   *  `Prof.TYPE_BIOMES` (the `orElse(PLAINS)`, .decomp:66). Kept apart from `Prof.typeAtBiome`
   *  so `villagertypecheck.mjs` can drive the table with plain strings, no world required. */
  Prof.typeForBiomeName = function (name) {
    if (!biomeToType) initBiomeToType();
    return (name && biomeToType[name]) || 'plains';
  };

  /** `forBiome` fed off a live world position — `NS.World.biomeAt(x,z)` -> `NS.Biomes.name(idx)`,
   *  the exact two-step `NS.Rabbit.chooseTypeAt` already uses for `RabbitEntity.chooseType`
   *  (07zh_rabbit.js) — this file's own natural-spawn biome reader for `VillagerEntity`/
   *  `ZombieVillagerEntity.initialize()`'s `forBiome(world.getBiome(pos))` call (.decomp:317-320
   *  off `ZombieVillagerEntity.java`, the same initializer `Zv.spawnInit`'s header names). */
  Prof.typeAtBiome = function (x, z) {
    var W = NS.World, B = NS.Biomes;
    if (!W || !W.biomeAt || !B || !B.ready || !B.name) return 'plains';
    var idx = W.biomeAt(Math.floor(x), Math.floor(z));
    return Prof.typeForBiomeName(B.name(idx));
  };

  var blockToProfession = null;

  Prof.init = function () {
    blockToProfession = {};
    for (var p in Prof.WORKSTATIONS) {
      var blocks = Prof.WORKSTATIONS[p];
      for (var i = 0; i < blocks.length; i++) blockToProfession[blocks[i]] = p;
    }
    initBiomeToType();
    // key: 'x,y,z' of a claimed workstation block -> the villager entity id that holds it.
    Prof.claimed = {};
    Prof.ready = true;
    return Prof;
  };

  /** The profession a block NAME grants, or null (unemployed blocks, and non-workstation
   *  blocks, both return null — same "no answer" shape `Tm.collarKey` uses for "not this
   *  species" so a caller cannot tell the two apart by return value alone; callers here only
   *  ever ask about blocks, not about whether a name exists). */
  Prof.professionForBlockName = function (name) {
    if (!Prof.ready || !name) return null;
    return blockToProfession[name] || null;
  };

  function blockNameAt(x, y, z) {
    if (!NS.Physics || !NS.States || !NS.Reg || !NS.Reg.names) return null;
    var state = NS.Physics.blockAt(x, y, z);
    var id = NS.States.block[state];
    return NS.Reg.names[id] || null;
  }

  /**
   * Run once per tick on an unemployed villager. Looks at its 8 horizontal neighbours (see the
   * file header); the first unclaimed workstation among them is claimed and its profession
   * assigned. Returns the profession claimed, or null (nothing adjacent, or every adjacent
   * workstation already belongs to another villager — rule 6, both directions: this also means
   * an ALREADY-claimed block never grants a second villager the same job).
   */
  Prof.tryClaim = function (e) {
    if (!Prof.ready || !e || e.type !== 'villager') return null;
    if (e.profession && e.profession !== 'none') return null;
    var fx = Math.floor(e.x), fy = Math.floor(e.y), fz = Math.floor(e.z);
    for (var i = 0; i < Prof.NEIGHBOURS.length; i++) {
      var nx = fx + Prof.NEIGHBOURS[i][0], nz = fz + Prof.NEIGHBOURS[i][1];
      var name = blockNameAt(nx, fy, nz);
      var prof = Prof.professionForBlockName(name);
      if (!prof) continue;
      var key = nx + ',' + fy + ',' + nz;
      if (Prof.claimed[key] !== undefined && Prof.claimed[key] !== e.id) continue;
      Prof.claimed[key] = e.id;
      e.profession = prof;
      e.workstation = { x: nx, y: fy, z: nz };
      return prof;
    }
    return null;
  };

  /** Free whatever claim sits on block position (x,y,z) — called from a block BREAK (player,
   *  explosion, piston). Frees the SLOT and applies vanilla's LoseJobOnSiteLossTask to the holder:
   *  a villager with profession other than none/nitwit, level <= 1 and no trade XP goes back to
   *  'none' (offers reset, workstation cleared); one that has traded keeps its profession.
   *  Returns the holder entity (or null). `Prof.skip` is the check's anti-vacuity switchboard. */
  Prof.skip = {};
  Prof.releaseAt = function (x, y, z) {
    var key = x + ',' + y + ',' + z;
    if (!Prof.claimed) return null;
    var id = Prof.claimed[key];
    delete Prof.claimed[key];
    if (id === undefined) return null;
    var EL = NS.EntityList;
    var e = Prof.skip.holder ? null : (EL && EL.byId ? EL.byId(id) : null);
    if (!e) return null;
    e.workstation = null;
    var p = e.profession;
    if (p && p !== 'none' && p !== 'nitwit' &&
        (Prof.skip.guard || ((e.villagerLevel | 0) <= 1 && !(e.tradeXp > 0)))) {
      if (!Prof.skip.reset) e.profession = 'none';
      e.tradeOffers = null;
    }
    return e;
  };

  /** Release a workstation claim — a villager that dies or is removed frees its block for
   *  another to take. Not yet called from anywhere that DESTROYS a workstation block itself
   *  (`Prof.OWED`): breaking a claimed smoker leaves it claimed until its villager despawns. */
  Prof.release = function (e) {
    if (!e || !e.workstation) return;
    var key = e.workstation.x + ',' + e.workstation.y + ',' + e.workstation.z;
    if (Prof.claimed[key] === e.id) delete Prof.claimed[key];
    e.workstation = null;
  };

  Prof.OWED = [
    'the real acquisition rule (Brain/Sensor/POI-manager, a search radius read off the jar, ' +
      'not adjacency) — this engine has no Brain substrate at all; a real port is a new AI ' +
      'architecture, not this unit\'s job',
    // struck loop/villager-tex: the profession/type/profession_level clothing overlay is
    // built -- `tools/extract-mob-textures.mjs`'s own `FAMILY.villager`/`FAMILY.zombie_
    // villager` (27 sheets each: base + 7 biome types + 14 professions + 5 level badges,
    // read off `jars/1.18.2/1.18.2.jar`, the only jar that ever shipped them) and
    // `ER.villagerClothingLayers` (src/07j_entityrender.js), drawn per `VillagerClothing
    // FeatureRenderer.method_17151` (.decomp, read in full): TYPE overlay, PROFESSION
    // overlay (skipped for "none"), PROFESSION_LEVEL badge (skipped for "nitwit"), plus the
    // real VillagerResourceMetadata hat-visibility gate (each (type|profession) PNG's own
    // .mcmeta "hat" value, read off the real jar this session, not guessed). villagertexcheck
    // .mjs.
    // struck loop/vtype-s105: biome-based villager TYPE at spawn is wired -- Prof.typeAtBiome
    // (forBiome, .decomp VillagerType.java:64-66), called from EL.DEFAULTS.villager
    // (07i_entitylist.js) and Zv.spawnInit (07zr_zvillager.js) for zombie_villager, round-trips
    // through mob NBT (07zw_mobnbt.js's villager/zombie_villager field lists already carried
    // villagerType) and both conversion directions (Zv.dataFromVillager/dataToVillager).
    // villagertypecheck.mjs.

    // struck #5122: there is NO spawn-time nitwit roll in 1.18.2 -- VillagerEntity.initialize
    // (.decomp, read in full) only sets profession NONE for SpawnReason.field_16466 and the biome
    // type; nitwit comes only from village structure data. The job-loss re-check IS built:
    // Prof.releaseAt = LoseJobOnSiteLossTask (shouldRun/run, .decomp), professioncheck.mjs.
    'the offer tables (VillagerTrades), the trading screen, restocking, gossip, price ' +
      'adjustment, iron golem spawning, raids — all of row 3 past "employed"'
  ];

})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
