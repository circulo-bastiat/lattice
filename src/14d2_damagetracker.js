// 14d2_damagetracker.js — #8264. net.minecraft.entity.damage.DamageTracker / DamageRecord.
// A per-victim log of recent damage: the fall-death suffix (what the victim was doing), the fall
// distance, and the attacker, so the death message can say "was doomed to fall by X".
(function (NS) {
  'use strict';
  var DT = NS.DamageTracker = {};
  DT.WINDOW = 100;    // DamageTracker.update: 5 s when nobody living hit the victim
  DT.COMBAT = 300;    // ... 15 s once a living attacker has (recentlyAttacked)

  function tracker(e) {
    return e.damageTracker || (e.damageTracker = { records: [], last: 0, hasDamage: false, recently: false, suffix: null });
  }
  function name(a) {
    if (!a) return null;
    var T = NS.Text;
    return a.name || (T && T.plain ? T.plain(T.translatable('entity.minecraft.' + a.type, [])) : a.type);
  }
  DT.fallDeathSuffix = function (e) {
    var Ph = NS.Physics, R = NS.Reg;
    if (Ph && Ph.onClimbable && Ph.onClimbable(e) && R && Ph.blockIdAt) {
      var n = R.names[Ph.blockIdAt(e.x, e.y, e.z)];
      if (n === 'ladder') return 'ladder';
      if (n === 'vine') return 'vines';
      if (n === 'weeping_vines' || n === 'weeping_vines_plant') return 'weeping_vines';
      if (n === 'twisting_vines' || n === 'twisting_vines_plant') return 'twisting_vines';
      if (n === 'scaffolding') return 'scaffolding';
      return 'other_climbable';
    }
    return e.inWater ? 'water' : null;
  };
  DT.update = function (e) {
    var t = tracker(e);
    var lim = t.recently ? DT.COMBAT : DT.WINDOW;
    if (t.hasDamage && (e.dead || (e.age || 0) - t.last > lim)) {
      t.hasDamage = false; t.recently = false; t.records.length = 0;
    }
  };
  // onDamage(victim, sourceKey, attacker, damage, fallDistance)
  DT.onDamage = function (e, key, attacker, dmg, fallDist) {
    DT.update(e);
    var t = tracker(e);
    t.suffix = DT.fallDeathSuffix(e);
    t.records.push({ key: key, attacker: attacker || null, damage: dmg, suffix: t.suffix, fall: fallDist || 0 });
    t.last = e.age || 0; t.hasDamage = true;
    if (attacker && !t.recently) t.recently = true;
  };
  DT.biggestAttacker = function (e) {
    var t = tracker(e), liv = null, pl = null, lm = 0, pm = 0;
    for (var i = 0; i < t.records.length; i++) {
      var r = t.records[i], a = r.attacker;
      if (!a) continue;
      if (a === NS.Player && (!pl || r.damage > pm)) { pm = r.damage; pl = a; }
      if (!liv || r.damage > lm) { lm = r.damage; liv = a; }
    }
    return pl && pm >= lm / 3 ? pl : liv;
  };
  function biggestFall(t) {
    var rs = t.records, a = null, b = null, ad = 0, bd = 0;
    for (var i = 0; i < rs.length; i++) {
      var r = rs[i], p = i > 0 ? rs[i - 1] : null, f = r.key === 'fall' || r.key === 'outOfWorld';
      if (f && r.fall > 0 && (!a || r.fall > ad)) { a = i > 0 ? p : r; ad = r.fall; }
      if (r.suffix != null && (!b || r.damage > bd)) { b = r; bd = r.damage; }
    }
    if (ad > 5 && a) return a;
    return bd > 5 && b ? b : null;
  }
  // getDeathMessage(victim) -> string
  DT.message = function (e, cause) {
    var T = NS.Text, t = tracker(e), vn = e.name || 'Player', rs = t.records;
    if (!rs.length) return T.deathMessage(vn, cause || 'generic', null);
    var last = rs[rs.length - 1], fall = biggestFall(t);
    if (fall && last.key === 'fall') {
      var an = name(fall.attacker), ln = name(last.attacker);
      if (fall.key === 'fall' || fall.key === 'outOfWorld')
        return T.translatable('death.fell.accident.' + (fall.suffix || 'generic'), [vn]);
      if (an && an !== ln) return T.translatable('death.fell.assist', [vn, an]);
      if (ln) return T.translatable('death.fell.finish', [vn, ln]);
      return T.translatable('death.fell.killer', [vn]);
    }
    var adv = DT.biggestAttacker(e);
    return T.deathMessage(vn, cause || last.key, adv ? name(adv) : null);
  };
})(MCL);
