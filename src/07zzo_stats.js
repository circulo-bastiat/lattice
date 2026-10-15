// 07zzo_stats.js -- G26a: the STATISTICS substrate. Translates .decomp/net/minecraft/stat/
// {Stat,StatType,Stats,StatHandler,StatFormatter}.java: the nine stat types, the 75 `minecraft:custom`
// stats with their formatters, the per-player counter map (StatHandler.increaseStat saturates at
// 2^31-1) and its save-file round trip (ServerStatHandler's JSON, flattened to `name -> int`).
//
// A Stat's criterion name is `<type>.<ns>.<path>:<valueType>.<ns>.<path>` (Stat.getName), e.g.
// `minecraft.custom:minecraft.walk_one_cm`; that string is the map key and the save key.
// tools/statscheck.mjs proves the id/formatter table equals Stats.java and .mcdata's registries.
//
// OWED: the Statistics screen (G26 later), per-block/item counters (mined/crafted/used/...), the
// scoreboard criterion side of Stat (ScoreboardCriterion), and the remaining custom-stat call sites
// beyond jump / deaths / play_time / time_since_* / sneak_time / walk-sprint-crouch-swim distance.
(function (NS) {
  'use strict';
  var St = NS.Stats = NS.Stats || {};

  // [name, formatter code]: D DEFAULT, V DIVIDE_BY_TEN, S DISTANCE, T TIME -- Stats.java order.
  St.CUSTOM = [
    ['leave_game', 'D'],
    ['play_time', 'T'],
    ['total_world_time', 'T'],
    ['time_since_death', 'T'],
    ['time_since_rest', 'T'],
    ['sneak_time', 'T'],
    ['walk_one_cm', 'S'],
    ['crouch_one_cm', 'S'],
    ['sprint_one_cm', 'S'],
    ['walk_on_water_one_cm', 'S'],
    ['fall_one_cm', 'S'],
    ['climb_one_cm', 'S'],
    ['fly_one_cm', 'S'],
    ['walk_under_water_one_cm', 'S'],
    ['minecart_one_cm', 'S'],
    ['boat_one_cm', 'S'],
    ['pig_one_cm', 'S'],
    ['horse_one_cm', 'S'],
    ['aviate_one_cm', 'S'],
    ['swim_one_cm', 'S'],
    ['strider_one_cm', 'S'],
    ['jump', 'D'],
    ['drop', 'D'],
    ['damage_dealt', 'V'],
    ['damage_dealt_absorbed', 'V'],
    ['damage_dealt_resisted', 'V'],
    ['damage_taken', 'V'],
    ['damage_blocked_by_shield', 'V'],
    ['damage_absorbed', 'V'],
    ['damage_resisted', 'V'],
    ['deaths', 'D'],
    ['mob_kills', 'D'],
    ['animals_bred', 'D'],
    ['player_kills', 'D'],
    ['fish_caught', 'D'],
    ['talked_to_villager', 'D'],
    ['traded_with_villager', 'D'],
    ['eat_cake_slice', 'D'],
    ['fill_cauldron', 'D'],
    ['use_cauldron', 'D'],
    ['clean_armor', 'D'],
    ['clean_banner', 'D'],
    ['clean_shulker_box', 'D'],
    ['interact_with_brewingstand', 'D'],
    ['interact_with_beacon', 'D'],
    ['inspect_dropper', 'D'],
    ['inspect_hopper', 'D'],
    ['inspect_dispenser', 'D'],
    ['play_noteblock', 'D'],
    ['tune_noteblock', 'D'],
    ['pot_flower', 'D'],
    ['trigger_trapped_chest', 'D'],
    ['open_enderchest', 'D'],
    ['enchant_item', 'D'],
    ['play_record', 'D'],
    ['interact_with_furnace', 'D'],
    ['interact_with_crafting_table', 'D'],
    ['open_chest', 'D'],
    ['sleep_in_bed', 'D'],
    ['open_shulker_box', 'D'],
    ['open_barrel', 'D'],
    ['interact_with_blast_furnace', 'D'],
    ['interact_with_smoker', 'D'],
    ['interact_with_lectern', 'D'],
    ['interact_with_campfire', 'D'],
    ['interact_with_cartography_table', 'D'],
    ['interact_with_loom', 'D'],
    ['interact_with_stonecutter', 'D'],
    ['bell_ring', 'D'],
    ['raid_trigger', 'D'],
    ['raid_win', 'D'],
    ['interact_with_anvil', 'D'],
    ['interact_with_grindstone', 'D'],
    ['target_hit', 'D'],
    ['interact_with_smithing_table', 'D']
  ];
  St.TYPES = [['mined', 'block'], ['crafted', 'item'], ['used', 'item'], ['broken', 'item'], ['picked_up', 'item'], ['dropped', 'item'], ['killed', 'entity_type'], ['killed_by', 'entity_type'], ['custom', 'custom_stat']];   // [statType id, registry]

  // ---- StatFormatter ---------------------------------------------------------------------
  function dec(x) {   // DecimalFormat("########0.00"), HALF_EVEN
    var r = Math.round(x * 100) / 100;
    if (Math.abs(x * 100 - Math.trunc(x * 100)) === 0.5) r = 2 * Math.round(x * 50) / 100;
    return r.toFixed(2);
  }
  function jdouble(v) { return Number.isInteger(v) ? v.toFixed(1) : String(v); }
  St.FORMAT = {
    D: function (n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); },
    V: function (n) { return dec(n * 0.1); },
    S: function (n) {
      var m = n / 100, km = m / 1000;
      if (km > 0.5) return dec(km) + ' km';
      return m > 0.5 ? dec(m) + ' m' : n + ' cm';
    },
    T: function (n) {
      var s = n / 20, mi = s / 60, h = mi / 60, d = h / 24, y = d / 365;
      if (y > 0.5) return dec(y) + ' y';
      if (d > 0.5) return dec(d) + ' d';
      if (h > 0.5) return dec(h) + ' h';
      return mi > 0.5 ? dec(mi) + ' m' : jdouble(s) + ' s';
    }
  };
  St.formatterOf = {};
  St.CUSTOM.forEach(function (r) { St.formatterOf[r[0]] = r[1]; });
  St.format = function (name, n) { return St.FORMAT[St.formatterOf[name] || 'D'](n); };

  // Stat.getName: type id + ':' + value id, ':' in either replaced by '.'.
  St.statName = function (type, id) {
    id = String(id).indexOf(':') < 0 ? 'minecraft:' + id : id;
    return 'minecraft.' + type + ':' + id.replace(':', '.');
  };
  St.custom = function (id) { return St.statName('custom', id); };

  // ---- StatHandler -----------------------------------------------------------------------
  St.map = Object.create(null);
  St.reset = function () { St.map = Object.create(null); };
  St.get = function (name) { return St.map[name] | 0; };
  St.set = function (name, v) { St.map[name] = v | 0; };
  St.increase = function (name, n) {
    var v = Math.min(St.get(name) + n, 2147483647);
    St.map[name] = v;
    return v;
  };
  // Shorthand for the custom type: St.inc('jump'), St.inc('walk_one_cm', cm).
  St.inc = function (id, n) { return St.increase(St.custom(id), n === undefined ? 1 : n | 0); };
  St.getCustom = function (id) { return St.get(St.custom(id)); };

  // ---- persistence -----------------------------------------------------------------------
  St.toJSON = function () {
    var o = {}, k;
    for (k in St.map) if (St.map[k]) o[k] = St.map[k];
    return o;
  };
  St.fromJSON = function (o) {
    St.reset();
    if (!o || typeof o !== 'object') return;
    for (var k in o) {
      var v = o[k];
      if (/^minecraft\.\w+:\w+\.[\w./-]+$/.test(k) && typeof v === 'number' && isFinite(v) && v > 0)
        St.map[k] = Math.min(Math.floor(v), 2147483647);
    }
  };

  // ---- gameplay hooks (called from 14d_survival.js / 14_player.js) -------------------------
  // Movement: `dist` is blocks moved this tick; vanilla adds Math.round(dist * 100) cm.
  St.onMove = function (dist, o) {
    var cm = Math.round(dist * 100);
    if (cm <= 0) return;
    o = o || {};
    if (o.swimming) St.inc('swim_one_cm', cm);
    else if (o.sprinting) St.inc('sprint_one_cm', cm);
    else if (o.sneaking) St.inc('crouch_one_cm', cm);
    else St.inc('walk_one_cm', cm);
  };
  // PlayerEntity.increaseTravelMotionStats (.decomp :1459-1507): p = { swimming, submerged, inWater,
  // climbing, onGround, sprinting, sneaking, fallFlying }; dx/dy/dz are blocks moved this tick.
  St.travel = function (p, dx, dy, dz) {
    var d3 = Math.round(Math.sqrt(dx * dx + dy * dy + dz * dz) * 100);
    var d2 = Math.round(Math.sqrt(dx * dx + dz * dz) * 100);
    if (p.swimming) { if (d3 > 0) St.inc('swim_one_cm', d3); }
    else if (p.submerged) { if (d3 > 0) St.inc('walk_under_water_one_cm', d3); }
    else if (p.inWater) { if (d2 > 0) St.inc('walk_on_water_one_cm', d2); }
    else if (p.climbing) { if (dy > 0) St.inc('climb_one_cm', Math.round(dy * 100)); }
    else if (p.onGround) {
      if (d2 > 0) St.inc(p.sprinting ? 'sprint_one_cm' : p.sneaking ? 'crouch_one_cm' : 'walk_one_cm', d2);
    }
    else if (p.fallFlying) St.inc('aviate_one_cm', d3);
    else if (d2 > 25) St.inc('fly_one_cm', d2);
  };
  // handleFallDamage (:1533-1537): fall_one_cm = round(distance * 100) when distance >= 2.
  St.onFall = function (distance) { if (distance >= 2) St.inc('fall_one_cm', Math.round(distance * 100)); };
  St.onJump = function () { St.inc('jump'); };
  St.onSleep = function () { St.set(St.custom('time_since_rest'), 0); };   // ServerPlayerEntity.sleep:873
  St.onDeath = function () { St.inc('deaths'); St.set(St.custom('time_since_death'), 0); St.set(St.custom('time_since_rest'), 0); };
  // Once per player tick (ServerPlayerEntity.tick): play_time, total_world_time, time_since_*.
  St.onTick = function (sneaking, dead, sleeping) {
    St.inc('play_time'); St.inc('total_world_time'); if (!dead) St.inc('time_since_death');
    if (!sleeping) St.inc('time_since_rest');   // PlayerEntity.tick: only while !isSleeping()
    if (sneaking) St.inc('sneak_time');
  };
  St.ready = true;
})(MCL);
