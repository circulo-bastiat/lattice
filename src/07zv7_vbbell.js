// 07zv7_vbbell.js — HideWhenBellRingsTask + ForgetBellRingTask + createHideTasks' bell clause
// (.decomp .../task/HideWhenBellRingsTask.java, ForgetBellRingTask.java, BellBlockEntity.java:101-115,
// VillagerTaskListProvider.java:239-242). HEARD_BELL_TIME is e.vbHeardBell, stamped in the villager's
// own VB.tick clock (e.vbAge), the clock every Task timer in 07zv_villagerbrain.js uses.
// OWED: HideInHomeTask (createHideTasks priority 1) and the busy-follow task are not ported here.
(function (NS) {
  'use strict';
  var VBB = NS.VBBell = { ready: true };
  VBB.HEAR_DIST = 32;          // BellBlockEntity.notifyMemoriesOfBell isWithinDistance(…, 32.0)
  VBB.HEARD_WINDOW = 300;      // ForgetBellRingTask.MIN_HEARD_BELL_TIME
  VBB.MAX_HIDDEN = 15 * 20;    // createHideTasks: new ForgetBellRingTask(15, 3)
  VBB.HOME_DIST = 3;

  function within(p, x, y, z, d) {
    var dx = p.x + 0.5 - x, dy = p.y + 0.5 - y, dz = p.z + 0.5 - z;
    return dx * dx + dy * dy + dz * dz < d * d;
  }

  /** BellBlockEntity.notifyMemoriesOfBell: every living villager within 32 blocks remembers the ring. */
  VBB.ring = function (x, y, z, dir) {
    var EL = NS.EntityList, n = 0;
    if (NS.GameEvent) NS.GameEvent.emit('ring_bell', x, y, z, null);   // BellBlock.ring
    if (NS.Bell) NS.Bell.activate(x, y, z, dir);
    if (!EL || !EL.list) return 0;
    var pos = { x: x, y: y, z: z };
    for (var i = 0; i < EL.list.length; i++) {
      var e = EL.list[i];
      if (!e || e.type !== 'villager' || e.dead || e.removed) continue;
      if (!within(pos, e.x, e.y, e.z, VBB.HEAR_DIST)) continue;
      e.vbHeardBell = e.vbAge || 0;
      n++;
    }
    return n;
  };

  /** Core HideWhenBellRingsTask + HIDE-list ForgetBellRingTask; true while the villager is hiding. */
  VBB.tick = function (e, tnow) {
    if (e.vbHeardBell === undefined || e.vbHeardBell === null) return false;
    var RM = NS.RaidManager;
    var raid = (RM && RM.world) ? RM.getRaidAt(RM.world, { x: Math.floor(e.x), y: Math.floor(e.y), z: Math.floor(e.z) }) : null;
    if (!e.vbHiding) {
      if (raid) return false;          // HideWhenBellRingsTask.run: only without a raid at the villager
      e.vbHiding = true; e.vbHiddenTicks = 0;
    }
    // ForgetBellRingTask.run (HIDING_PLACE memory: e.vbHidingPlace, HideInHomeTask's output, falling back to e.vbHome until that is ported)
    var expired = e.vbHeardBell + VBB.HEARD_WINDOW <= tnow;
    if (e.vbHiddenTicks <= VBB.MAX_HIDDEN && !expired) {
      var hp = e.vbHidingPlace || e.vbHome;
      if (hp && within(hp, e.x, e.y, e.z, VBB.HOME_DIST)) e.vbHiddenTicks++;
      return true;
    }
    e.vbHeardBell = null; e.vbHidingPlace = null; e.vbHiding = false; e.vbHiddenTicks = 0;
    return false;
  };
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
