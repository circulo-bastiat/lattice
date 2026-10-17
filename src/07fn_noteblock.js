// 07fn_noteblock.js — G19ef: NOTE BLOCKS. NoteBlock.java + Instrument.java (.decomp), read whole.
//
//   * `Instrument.fromBlockState(below)` — the special blocks first (clay flute, gold bell, wool guitar,
//     packed ice chime, bone block xylophone, iron block iron_xylophone, soul sand cow_bell, pumpkin
//     didgeridoo, emerald block bit, hay block banjo, glowstone pling), then the block's vanilla
//     `Material`: STONE basedrum, AGGREGATE snare, GLASS hat, WOOD/NETHER_WOOD bass, else harp.
//     The material lists below are tools/golden/block-materials-1.18.2.tsv (J/w/G/z/A); noteblockcheck
//     re-derives them from the tsv and fails on drift. (Mob-head instruments are 1.19.3; not in 1.18.2.)
//   * `getStateForNeighborUpdate` (DOWN only) -> `Note.refresh`, hooked from Behave.changed.
//   * `neighborUpdate` -> the power edge in Redstone.updateOpener calls `Note.play` on a rising edge.
//   * `playNote`: only when the block ABOVE is air; `onSyncedBlockEvent`: pitch 2^((note-12)/12), volume 3.0,
//     SoundCategory RECORDS, particle NOTE at (x+.5, y+1.2, z+.5) with vx = note/24.
(function (NS) {
  'use strict';
  var R = NS.Reg, S = NS.States, B = NS.Behave;
  var Note = NS.Note = { ready: false };

  // Material STONE -> basedrum
  var MAT_STONE =
    'andesite andesite_slab andesite_stairs andesite_wall basalt bedrock black_concrete black_glazed_terracotta ' +
    'black_terracotta blackstone blackstone_slab blackstone_stairs blackstone_wall blast_furnace blue_concrete ' +
    'blue_glazed_terracotta blue_terracotta bone_block brain_coral_block brick_slab brick_stairs brick_wall ' +
    'bricks brown_concrete brown_glazed_terracotta brown_terracotta bubble_coral_block calcite chiseled_deepslate ' +
    'chiseled_nether_bricks chiseled_polished_blackstone chiseled_quartz_block chiseled_red_sandstone ' +
    'chiseled_sandstone chiseled_stone_bricks coal_block coal_ore cobbled_deepslate cobbled_deepslate_slab ' +
    'cobbled_deepslate_stairs cobbled_deepslate_wall cobblestone cobblestone_slab cobblestone_stairs ' +
    'cobblestone_wall copper_ore cracked_deepslate_bricks cracked_deepslate_tiles cracked_nether_bricks ' +
    'cracked_polished_blackstone_bricks cracked_stone_bricks crimson_nylium crying_obsidian cut_red_sandstone ' +
    'cut_red_sandstone_slab cut_sandstone cut_sandstone_slab cyan_concrete cyan_glazed_terracotta cyan_terracotta ' +
    'dark_prismarine dark_prismarine_slab dark_prismarine_stairs dead_brain_coral dead_brain_coral_block ' +
    'dead_brain_coral_fan dead_brain_coral_wall_fan dead_bubble_coral dead_bubble_coral_block ' +
    'dead_bubble_coral_fan dead_bubble_coral_wall_fan dead_fire_coral dead_fire_coral_block dead_fire_coral_fan ' +
    'dead_fire_coral_wall_fan dead_horn_coral dead_horn_coral_block dead_horn_coral_fan dead_horn_coral_wall_fan ' +
    'dead_tube_coral dead_tube_coral_block dead_tube_coral_fan dead_tube_coral_wall_fan deepslate ' +
    'deepslate_brick_slab deepslate_brick_stairs deepslate_brick_wall deepslate_bricks deepslate_coal_ore ' +
    'deepslate_copper_ore deepslate_diamond_ore deepslate_emerald_ore deepslate_gold_ore deepslate_iron_ore ' +
    'deepslate_lapis_ore deepslate_redstone_ore deepslate_tile_slab deepslate_tile_stairs deepslate_tile_wall ' +
    'deepslate_tiles diamond_ore diorite diorite_slab diorite_stairs diorite_wall dispenser dripstone_block ' +
    'dropper emerald_ore enchanting_table end_portal_frame end_stone end_stone_brick_slab end_stone_brick_stairs ' +
    'end_stone_brick_wall end_stone_bricks ender_chest fire_coral_block furnace gilded_blackstone gold_ore ' +
    'granite granite_slab granite_stairs granite_wall gray_concrete gray_glazed_terracotta gray_terracotta ' +
    'green_concrete green_glazed_terracotta green_terracotta horn_coral_block iron_ore lapis_ore ' +
    'light_blue_concrete light_blue_glazed_terracotta light_blue_terracotta light_gray_concrete ' +
    'light_gray_glazed_terracotta light_gray_terracotta lime_concrete lime_glazed_terracotta lime_terracotta ' +
    'magenta_concrete magenta_glazed_terracotta magenta_terracotta magma_block mossy_cobblestone ' +
    'mossy_cobblestone_slab mossy_cobblestone_stairs mossy_cobblestone_wall mossy_stone_brick_slab ' +
    'mossy_stone_brick_stairs mossy_stone_brick_wall mossy_stone_bricks nether_brick_fence nether_brick_slab ' +
    'nether_brick_stairs nether_brick_wall nether_bricks nether_gold_ore nether_quartz_ore netherrack observer ' +
    'obsidian orange_concrete orange_glazed_terracotta orange_terracotta petrified_oak_slab pink_concrete ' +
    'pink_glazed_terracotta pink_terracotta pointed_dripstone polished_andesite polished_andesite_slab ' +
    'polished_andesite_stairs polished_basalt polished_blackstone polished_blackstone_brick_slab ' +
    'polished_blackstone_brick_stairs polished_blackstone_brick_wall polished_blackstone_bricks ' +
    'polished_blackstone_pressure_plate polished_blackstone_slab polished_blackstone_stairs ' +
    'polished_blackstone_wall polished_deepslate polished_deepslate_slab polished_deepslate_stairs ' +
    'polished_deepslate_wall polished_diorite polished_diorite_slab polished_diorite_stairs polished_granite ' +
    'polished_granite_slab polished_granite_stairs prismarine prismarine_brick_slab prismarine_brick_stairs ' +
    'prismarine_bricks prismarine_slab prismarine_stairs prismarine_wall purple_concrete purple_glazed_terracotta ' +
    'purple_terracotta purpur_block purpur_pillar purpur_slab purpur_stairs quartz_block quartz_bricks ' +
    'quartz_pillar quartz_slab quartz_stairs raw_copper_block raw_gold_block raw_iron_block red_concrete ' +
    'red_glazed_terracotta red_nether_brick_slab red_nether_brick_stairs red_nether_brick_wall red_nether_bricks ' +
    'red_sandstone red_sandstone_slab red_sandstone_stairs red_sandstone_wall red_terracotta redstone_ore ' +
    'respawn_anchor sandstone sandstone_slab sandstone_stairs sandstone_wall smoker smooth_basalt smooth_quartz ' +
    'smooth_quartz_slab smooth_quartz_stairs smooth_red_sandstone smooth_red_sandstone_slab ' +
    'smooth_red_sandstone_stairs smooth_sandstone smooth_sandstone_slab smooth_sandstone_stairs smooth_stone ' +
    'smooth_stone_slab spawner stone stone_brick_slab stone_brick_stairs stone_brick_wall stone_bricks ' +
    'stone_pressure_plate stone_slab stone_stairs stonecutter terracotta tube_coral_block tuff warped_nylium ' +
    'white_concrete white_glazed_terracotta white_terracotta yellow_concrete yellow_glazed_terracotta ' +
    'yellow_terracotta';
  // Material AGGREGATE -> snare
  var MAT_AGGREGATE =
    'black_concrete_powder blue_concrete_powder brown_concrete_powder cyan_concrete_powder gravel ' +
    'gray_concrete_powder green_concrete_powder light_blue_concrete_powder light_gray_concrete_powder ' +
    'lime_concrete_powder magenta_concrete_powder orange_concrete_powder pink_concrete_powder ' +
    'purple_concrete_powder red_concrete_powder red_sand sand soul_sand white_concrete_powder ' +
    'yellow_concrete_powder';
  // Material GLASS -> hat
  var MAT_GLASS =
    'beacon black_stained_glass black_stained_glass_pane blue_stained_glass blue_stained_glass_pane ' +
    'brown_stained_glass brown_stained_glass_pane conduit cyan_stained_glass cyan_stained_glass_pane glass ' +
    'glass_pane glowstone gray_stained_glass gray_stained_glass_pane green_stained_glass green_stained_glass_pane ' +
    'light_blue_stained_glass light_blue_stained_glass_pane light_gray_stained_glass ' +
    'light_gray_stained_glass_pane lime_stained_glass lime_stained_glass_pane magenta_stained_glass ' +
    'magenta_stained_glass_pane orange_stained_glass orange_stained_glass_pane pink_stained_glass ' +
    'pink_stained_glass_pane purple_stained_glass purple_stained_glass_pane red_stained_glass ' +
    'red_stained_glass_pane sea_lantern tinted_glass white_stained_glass white_stained_glass_pane ' +
    'yellow_stained_glass yellow_stained_glass_pane';
  // Material WOOD -> bass
  var MAT_WOOD =
    'acacia_door acacia_fence acacia_fence_gate acacia_log acacia_planks acacia_pressure_plate acacia_sign ' +
    'acacia_slab acacia_stairs acacia_trapdoor acacia_wall_sign acacia_wood barrel bee_nest beehive birch_door ' +
    'birch_fence birch_fence_gate birch_log birch_planks birch_pressure_plate birch_sign birch_slab birch_stairs ' +
    'birch_trapdoor birch_wall_sign birch_wood black_banner black_wall_banner blue_banner blue_wall_banner ' +
    'bookshelf brown_banner brown_mushroom_block brown_wall_banner campfire cartography_table chest composter ' +
    'crafting_table cyan_banner cyan_wall_banner dark_oak_door dark_oak_fence dark_oak_fence_gate dark_oak_log ' +
    'dark_oak_planks dark_oak_pressure_plate dark_oak_sign dark_oak_slab dark_oak_stairs dark_oak_trapdoor ' +
    'dark_oak_wall_sign dark_oak_wood daylight_detector fletching_table gray_banner gray_wall_banner green_banner ' +
    'green_wall_banner jukebox jungle_door jungle_fence jungle_fence_gate jungle_log jungle_planks ' +
    'jungle_pressure_plate jungle_sign jungle_slab jungle_stairs jungle_trapdoor jungle_wall_sign jungle_wood ' +
    'lectern light_blue_banner light_blue_wall_banner light_gray_banner light_gray_wall_banner lime_banner ' +
    'lime_wall_banner loom magenta_banner magenta_wall_banner mushroom_stem note_block oak_door oak_fence ' +
    'oak_fence_gate oak_log oak_planks oak_pressure_plate oak_sign oak_slab oak_stairs oak_trapdoor oak_wall_sign ' +
    'oak_wood orange_banner orange_wall_banner pink_banner pink_wall_banner purple_banner purple_wall_banner ' +
    'red_banner red_mushroom_block red_wall_banner smithing_table soul_campfire spruce_door spruce_fence ' +
    'spruce_fence_gate spruce_log spruce_planks spruce_pressure_plate spruce_sign spruce_slab spruce_stairs ' +
    'spruce_trapdoor spruce_wall_sign spruce_wood stripped_acacia_log stripped_acacia_wood stripped_birch_log ' +
    'stripped_birch_wood stripped_dark_oak_log stripped_dark_oak_wood stripped_jungle_log stripped_jungle_wood ' +
    'stripped_oak_log stripped_oak_wood stripped_spruce_log stripped_spruce_wood trapped_chest white_banner ' +
    'white_wall_banner yellow_banner yellow_wall_banner';
  // Material NETHER_WOOD -> bass
  var MAT_NETHER_WOOD =
    'crimson_door crimson_fence crimson_fence_gate crimson_hyphae crimson_planks crimson_pressure_plate ' +
    'crimson_sign crimson_slab crimson_stairs crimson_stem crimson_trapdoor crimson_wall_sign ' +
    'stripped_crimson_hyphae stripped_crimson_stem stripped_warped_hyphae stripped_warped_stem warped_door ' +
    'warped_fence warped_fence_gate warped_hyphae warped_planks warped_pressure_plate warped_sign warped_slab ' +
    'warped_stairs warped_stem warped_trapdoor warped_wall_sign';

  var SPECIAL = {
    clay: 'flute', gold_block: 'bell', packed_ice: 'chime', bone_block: 'xylophone', iron_block: 'iron_xylophone',
    soul_sand: 'cow_bell', pumpkin: 'didgeridoo', emerald_block: 'bit', hay_block: 'banjo', glowstone: 'pling'
  };
  var byName = null;
  function build() {
    byName = Object.create(null);
    var put = function (list, inst) { list.trim().split(/\s+/).forEach(function (n) { if (n) byName[n] = inst; }); };
    put(MAT_STONE, 'basedrum'); put(MAT_AGGREGATE, 'snare'); put(MAT_GLASS, 'hat');
    put(MAT_WOOD, 'bass'); put(MAT_NETHER_WOOD, 'bass');
  }
  /** `Instrument.fromBlockState` by block NAME ('air' and anything unlisted is harp). */
  Note.instrumentOfName = function (name) {
    if (!byName) build();
    if (SPECIAL[name]) return SPECIAL[name];
    if (/_wool$/.test(name)) return 'guitar';           // BlockTags.WOOL
    return byName[name] || 'harp';
  };
  Note.instrumentOf = function (state) {
    return state === 0 ? 'harp' : Note.instrumentOfName(R.names[S.block[state]]);
  };
  /** Pitch multiplier for note 0..24 (NoteBlock.onSyncedBlockEvent). */
  Note.pitch = function (note) { return Math.pow(2, (note - 12) / 12); };

  function isNote(st) { return st !== 0 && R.names[S.block[st]] === 'note_block'; }
  Note.isNote = isNote;

  /** getStateForNeighborUpdate / getPlacementState: re-read the instrument from the block below. */
  Note.refresh = function (x, y, z) {
    var w = B.w, st = w.get(x, y, z);
    if (!isNote(st)) return false;
    var inst = Note.instrumentOf(w.get(x, y - 1, z));
    if (B.propName(st, 'instrument') === inst) return false;
    w.set(x, y, z, B.setProp(st, 'instrument', inst));
    return true;
  };

  /** playNote: only with air above. Returns whether the block event fired. */
  Note.playNote = function (x, y, z) {
    var w = B.w;
    if (w.get(x, y + 1, z) !== 0) return false;
    var st = w.get(x, y, z);
    if (!isNote(st)) return false;
    Note.blockEvent(x, y, z, st);
    return true;
  };

  /** onSyncedBlockEvent: the sound and the NOTE particle. */
  Note.blockEvent = function (x, y, z, st) {
    var note = +B.propName(st, 'note') | 0;
    var inst = B.propName(st, 'instrument') || 'harp';
    Note.events.push({ x: x, y: y, z: z, note: note, instrument: inst });
    if (Note.events.length > 64) Note.events.shift();
    if (NS.Sound && NS.Sound.play) {
      NS.Sound.play('block.note_block.' + inst, { x: x + 0.5, y: y + 0.5, z: z + 0.5, source: 'record', volume: 3.0, pitch: Note.pitch(note) });
    }
    if (NS.Particle && NS.Particle.spawn) NS.Particle.spawn('note', x + 0.5, y + 1.2, z + 0.5, note / 24, 0, 0);
  };
  Note.events = [];

  /** onUse: cycle NOTE (0..24 wraps), set it, then playNote. */
  Note.use = function (x, y, z) {
    var w = B.w, st = w.get(x, y, z);
    if (!isNote(st)) return false;
    st = B.setProp(st, 'note', String(((+B.propName(st, 'note') | 0) + 1) % 25));
    w.set(x, y, z, st);
    Note.playNote(x, y, z);
    return true;
  };
  /** onBlockBreakStart: a punch plays the note without changing it. */
  Note.punch = function (x, y, z) {
    if (!isNote(B.w.get(x, y, z))) return false;
    return Note.playNote(x, y, z);
  };
  Note.ready = true;
})(MCL);
