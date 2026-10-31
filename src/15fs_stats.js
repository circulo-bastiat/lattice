// 15fs_stats.js -- G26b: the rows of vanilla's StatsScreen (.decomp/net/minecraft/client/gui/screen/
// StatsScreen.java) as plain data: the general, items and mobs lists built from NS.Stats (G26a).
// 15f_options.js draws them under the 'stats' screen; tools/statsscreencheck.mjs asserts them.
//
// OWED: no lang file ships, so display names are the id title-cased and only a few stat names are
// vanilla's en_us wording; the items list has no icons/header sort; the mobs list is alphabetical,
// not registry order.
(function (NS) {
  'use strict';
  var SS = NS.StatsScreen = NS.StatsScreen || {};

  function title(id) {
    return String(id).split('_').map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(' ');
  }
  SS.NAMES = { jump: 'Jumps', deaths: 'Number of Deaths', mob_kills: 'Mob Kills', play_time: 'Time Played',
    walk_one_cm: 'Distance Walked', sprint_one_cm: 'Distance Sprinted', fall_one_cm: 'Distance Fallen',
    leave_game: 'Games Quit', damage_dealt: 'Damage Dealt', damage_taken: 'Damage Taken' };
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
      if (any) out.push({ id: n, name: title(n), cells: cells.map(function (v) { return St.FORMAT.D(v); }) });
    }
    return out.map(function (r, i) { r.color = i % 2 === 0 ? 0xFFFFFF : 0x909090; return r; });
  };

  /** EntityStatsListWidget: entity types killed or killed-by > 0, with the three texts of each Entry. */
  SS.mobs = function () {
    var St = NS.Stats, seen = {}, k, m;
    for (k in St.map) {
      m = /^minecraft\.killed(?:_by)?:minecraft\.(.+)$/.exec(k);
      if (m && St.map[k] > 0) seen[m[1]] = 1;
    }
    return Object.keys(seen).sort().map(function (id) {
      var nm = title(id), a = St.get(St.statName('killed', id)), b = St.get(St.statName('killed_by', id));
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
