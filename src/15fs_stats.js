// Also cites SaveLevelScreen, StatsListener (15fs_stats.js).
// 15fs_stats.js -- G26b: the rows of vanilla's StatsScreen (.decomp/net/minecraft/client/gui/screen/
// StatsScreen.java) as plain data: the general, items and mobs lists built from NS.Stats (G26a).
// 15f_options.js draws them under the 'stats' screen; tools/statsscreencheck.mjs asserts them.
//
// G26s: en_us wording for every stat (SS.NAMES), the mobs list in entity_type registry order (SS.ENTITY_ORDER,
// from _registries.json), item rows carry a `stack` for the icon, and SS.sortItems is ItemStatsListWidget's header sort.
(function (NS) {
  'use strict';
  var SS = NS.StatsScreen = NS.StatsScreen || {};

  function title(id) {
    return String(id).split('_').map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(' ');
  }
  // assets/minecraft/lang/en_us.json "stat.minecraft.*" (1.18.2)
  SS.NAMES = { leave_game: 'Games Quit', play_time: 'Time Played', total_world_time: 'Time with World Open',
    time_since_death: 'Time Since Last Death', time_since_rest: 'Time Since Last Rest', sneak_time: 'Sneak Time',
    walk_one_cm: 'Distance Walked', crouch_one_cm: 'Distance Crouched', sprint_one_cm: 'Distance Sprinted',
    walk_on_water_one_cm: 'Distance Walked on Water', fall_one_cm: 'Distance Fallen', climb_one_cm: 'Distance Climbed',
    fly_one_cm: 'Distance Flown', walk_under_water_one_cm: 'Distance Walked under Water',
    minecart_one_cm: 'Distance by Minecart', boat_one_cm: 'Distance by Boat', pig_one_cm: 'Distance by Pig',
    horse_one_cm: 'Distance by Horse', aviate_one_cm: 'Distance by Elytra', swim_one_cm: 'Distance Swum',
    strider_one_cm: 'Distance by Strider', jump: 'Jumps', drop: 'Items Dropped', damage_dealt: 'Damage Dealt',
    damage_dealt_absorbed: 'Damage Dealt (Absorbed)', damage_dealt_resisted: 'Damage Dealt (Resisted)',
    damage_taken: 'Damage Taken', damage_blocked_by_shield: 'Damage Blocked by Shield',
    damage_absorbed: 'Damage Absorbed', damage_resisted: 'Damage Resisted', deaths: 'Number of Deaths',
    mob_kills: 'Mob Kills', animals_bred: 'Animals Bred', player_kills: 'Player Kills', fish_caught: 'Fish Caught',
    talked_to_villager: 'Talked to Villagers', traded_with_villager: 'Traded with Villagers',
    eat_cake_slice: 'Cake Slices Eaten', fill_cauldron: 'Cauldrons Filled', use_cauldron: 'Water Taken from Cauldron',
    clean_armor: 'Armor Pieces Cleaned', clean_banner: 'Banners Cleaned', clean_shulker_box: 'Shulker Boxes Cleaned',
    interact_with_brewingstand: 'Interactions with Brewing Stand', interact_with_beacon: 'Interactions with Beacon',
    inspect_dropper: 'Droppers Searched', inspect_hopper: 'Hoppers Searched', inspect_dispenser: 'Dispensers Searched',
    play_noteblock: 'Note Blocks Played', tune_noteblock: 'Note Blocks Tuned', pot_flower: 'Plants Potted',
    trigger_trapped_chest: 'Trapped Chests Triggered', open_enderchest: 'Ender Chests Opened',
    enchant_item: 'Items Enchanted', play_record: 'Music Discs Played', interact_with_furnace: 'Interactions with Furnace',
    interact_with_crafting_table: 'Interactions with Crafting Table', open_chest: 'Chests Opened',
    sleep_in_bed: 'Times Slept in a Bed', open_shulker_box: 'Shulker Boxes Opened', open_barrel: 'Barrels Opened',
    interact_with_blast_furnace: 'Interactions with Blast Furnace', interact_with_smoker: 'Interactions with Smoker',
    interact_with_lectern: 'Interactions with Lectern', interact_with_campfire: 'Interactions with Campfire',
    interact_with_cartography_table: 'Interactions with Cartography Table', interact_with_loom: 'Interactions with Loom',
    interact_with_stonecutter: 'Interactions with Stonecutter', bell_ring: 'Bells Rung', raid_trigger: 'Raids Triggered',
    raid_win: 'Raids Won', interact_with_anvil: 'Interactions with Anvil',
    interact_with_grindstone: 'Interactions with Grindstone', target_hit: 'Targets Hit',
    interact_with_smithing_table: 'Interactions with Smithing Table' };
  // entity.minecraft.* names that are not the title-cased id
  SS.ENTITY_NAMES = { tnt: 'Primed TNT', tnt_minecart: 'Minecart with TNT', chest_minecart: 'Minecart with Chest',
    command_block_minecart: 'Minecart with Command Block', furnace_minecart: 'Minecart with Furnace',
    hopper_minecart: 'Minecart with Hopper', spawner_minecart: 'Minecart with Spawner', egg: 'Thrown Egg',
    ender_pearl: 'Thrown Ender Pearl', experience_bottle: 'Thrown Bottle o\' Enchanting', experience_orb: 'Experience Orb',
    eye_of_ender: 'Eye of Ender', end_crystal: 'End Crystal', fireball: 'Fireball', small_fireball: 'Small Fireball',
    potion: 'Potion', snowball: 'Snowball', trident: 'Trident', mooshroom: 'Mooshroom', fishing_bobber: 'Fishing Bobber',
    leash_knot: 'Leash Knot', lightning_bolt: 'Lightning Bolt', falling_block: 'Falling Block', item: 'Item',
    zombified_piglin: 'Zombified Piglin', iron_golem: 'Iron Golem', snow_golem: 'Snow Golem' };
  SS.ENTITY_ORDER = ["area_effect_cloud","armor_stand","arrow","axolotl","bat","bee","blaze","boat","cat","cave_spider","chest_minecart","chicken","cod","command_block_minecart","cow","creeper","dolphin","donkey","dragon_fireball","drowned","egg","elder_guardian","end_crystal","ender_dragon","ender_pearl","enderman","endermite","evoker","evoker_fangs","experience_bottle","experience_orb","eye_of_ender","falling_block","fireball","firework_rocket","fishing_bobber","fox","furnace_minecart","ghast","giant","glow_item_frame","glow_squid","goat","guardian","hoglin","hopper_minecart","horse","husk","illusioner","iron_golem","item","item_frame","leash_knot","lightning_bolt","llama","llama_spit","magma_cube","marker","minecart","mooshroom","mule","ocelot","painting","panda","parrot","phantom","pig","piglin","piglin_brute","pillager","player","polar_bear","potion","pufferfish","rabbit","ravager","salmon","sheep","shulker","shulker_bullet","silverfish","skeleton","skeleton_horse","slime","small_fireball","snow_golem","snowball","spawner_minecart","spectral_arrow","spider","squid","stray","strider","tnt","tnt_minecart","trader_llama","trident","tropical_fish","turtle","vex","villager","vindicator","wandering_trader","witch","wither","wither_skeleton","wither_skull","wolf","zoglin","zombie","zombie_horse","zombie_villager","zombified_piglin"];
  SS.entityLabel = function (id) { return SS.ENTITY_NAMES[id] || title(id); };
  SS.statLabel = function (id) { return SS.NAMES[id] || title(id); };

  // StatsScreen.ItemStatsListWidget: header columns in order (mined is the block type).
  SS.ITEM_COLS = ['mined', 'broken', 'crafted', 'used', 'picked_up', 'dropped'];

  /** GeneralStatsListWidget: every custom stat, sorted by display name; odd rows grey (0x909090). */
  SS.general = function () {
    var St = NS.Stats;
    return St.CUSTOM.map(function (r) { return r[0]; })
      .map(function (id) { return { id: id, name: SS.statLabel(id), value: St.format(id, St.getCustom(id)) }; })
      .sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; })
      .map(function (r, i) { r.color = i % 2 === 0 ? 0xFFFFFF : 0x909090; return r; });
  };

  /** ItemStatsListWidget: items with any positive item/block stat, in item-id order; '-' for no block. */
  SS.items = function () {
    var St = NS.Stats, names = NS.Items.names, out = [];
    for (var i = 0; i < names.length; i++) {
      var n = names[i];
      if (!n || n === 'air') continue;
      var cells = [], any = false;
      for (var c = 0; c < SS.ITEM_COLS.length; c++) {
        var v = St.get(St.statName(SS.ITEM_COLS[c], n));
        if (v > 0) any = true;
        cells.push(v);
      }
      if (any) out.push({ id: n, idx: i, stack: { i: i, c: 1 }, name: title(n), raw: cells.slice(), cells: cells.map(function (v) { return St.FORMAT.D(v); }) });
    }
    return SS.sortItems(out, SS.sortCol, SS.sortDir);
  };
  // ItemStatsListWidget.selectStatType: a new column sorts descending (order -1), the same column flips; the
  // comparator is the stat value (ties by item id), column -1 / null = registry order.
  SS.sortCol = -1; SS.sortDir = 1;
  SS.setSort = function (col) {
    if (col === SS.sortCol) SS.sortDir = -SS.sortDir; else { SS.sortCol = col; SS.sortDir = -1; }
  };
  SS.sortItems = function (rows, col, dir) {
    rows = rows.slice();
    if (col >= 0) rows.sort(function (a, b) { return (a.raw[col] - b.raw[col]) * dir || a.idx - b.idx; });
    else rows.sort(function (a, b) { return (a.idx - b.idx) * dir; });
    return rows.map(function (r, i) { r.color = i % 2 === 0 ? 0xFFFFFF : 0x909090; return r; });
  };

  /** EntityStatsListWidget: entity types killed or killed-by > 0, with the three texts of each Entry. */
  SS.mobs = function () {
    var St = NS.Stats, seen = {}, k, m;
    for (k in St.map) {
      m = /^minecraft\.killed(?:_by)?:minecraft\.(.+)$/.exec(k);
      if (m && St.map[k] > 0) seen[m[1]] = 1;
    }
    return SS.ENTITY_ORDER.filter(function (id) { return seen[id]; }).map(function (id) {
      var nm = SS.entityLabel(id), a = St.get(St.statName('killed', id)), b = St.get(St.statName('killed_by', id));
      return { id: id, name: nm,
        killed: a ? 'You killed ' + a + ' ' + nm : 'You have never killed ' + nm, killedColor: a ? 0x909090 : 0x606060,
        killedBy: b ? nm + ' killed you ' + b + ' time' + (b === 1 ? '' : 's') : nm + ' has never killed you',
        killedByColor: b ? 0x909090 : 0x606060 };
    });
  };

  /** the tab buttons' availability: Items / Mobs are inactive when their list is empty (createButtons). */
  SS.tabs = function () {
    return [{ id: 'general', label: 'General', active: true },
            { id: 'items', label: 'Items', active: SS.items().length > 0 },
            { id: 'mobs', label: 'Mobs', active: SS.mobs().length > 0 }];
  };
  SS.rows = function (tab) { return SS[tab === 'items' ? 'items' : tab === 'mobs' ? 'mobs' : 'general'](); };
  SS.ready = true;
})(MCL);
