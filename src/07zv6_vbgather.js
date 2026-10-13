// 07zv6_vbgather.js — loop/vbgather: `GatherItemsVillagerTask` itself (.decomp/net/minecraft/
// entity/ai/brain/task/GatherItemsVillagerTask.java, read in full this session) plus the item
// pickup half `VillagerEntity.loot`/`canGather`/`GATHERABLE_ITEMS` need to have anything to give
// away in the first place (.decomp VillagerEntity.java:102-104/802-827, read this session).
// Both close a `src/07zv4_vbidle.js`-owned `VB.OWED` line (the priority-3 CompositeTask entry
// named there alongside `GiveGiftsToHeroTask`/`FindInteractionTargetTask`/`HoldTradeOffersTask`
// -- those three are NOT this file's job and stay on `VB.OWED`, struck out below to say exactly
// that).
//
// WHAT THIS FILE DOES NOT PORT, ON PURPOSE (named here, not silently dropped):
//  - `FindInteractionTargetTask`/`MemoryModuleType.INTERACTION_TARGET`: real vanilla acquires
//    the nearby-villager memory this task reads via a SEPARATE priority-3 task (still on
//    `VB.OWED`) and the priority-2 RandomTask's own `villagerInterestStart`
//    (07zv_villagerbrain.js) never remembers one either (it only sets a walk target). Rather
//    than invent a persistent memory field nothing else reads, `Gt.tick` below does its OWN
//    fresh nearest-villager scan every 'idle' tick, gated on the EXACT SAME distance the real
//    task's own per-tick body gates on (`squaredDistanceTo(partner) > 5.0`,
//    GatherItemsVillagerTask.java:35/48) -- the ACQUISITION range (8 blocks, `FindEntityTask`)
//    collapses into the RUNNING range (root(5) =~ 2.24 blocks) because nothing here needs the
//    task to keep running once two villagers have drifted apart, only to fire again once they
//    are close (same shape `breedInterestStart`'s own header already documents for its own
//    no-line-of-sight simplification).
//  (`talkWithVillager` (java:47) IS ported: `Gt.tick` calls 07l_spawn.js's
//  `Village.talkWithVillager` first, as the real body does — gossip sharing plus the
//  `summonGolem(...,5)` it carries; cloud owed-village-owed.)
//
// EVERYTHING ELSE is real: `canGather`/`GATHERABLE_ITEMS`/the per-profession
// `getGatherableItems()` table (only FARMER's is non-empty --
// `VillagerProfession.java`:16-35's own two-arg `register` overload defaults every other
// profession to `ImmutableSet.of()`, read this session), the SimpleInventory-fits-or-stays-on-
// the-floor pickup (`src/14_player.js`'s own `P.pickupItems` header: "vanilla only takes what
// fits"), the `wantsToStartBreeding`/`canBreed` food-sharing gate (reusing
// `VB.villagerFoodValue`/`VB.BREED_FOOD_MIN`, `src/07zv4_vbidle.js`'s own live-inventory sum --
// ONE source of truth for "how much food does this villager have", not a second copy), the
// farmer wheat-surplus share, the profession-gatherable-items share, and `giveHalfOfStack`'s own
// exact halve-or-24 arithmetic (GatherItemsVillagerTask.java:70-99).
//
// AFTER 07zv5_vbbreed.js (build.mjs's own load order): reuses `VB.villagerFoodValue`/
// `VB.BREED_FOOD_MIN` (07zv4_vbidle.js) and `VB.ensureVillagerInventory`/`VB.invCount`/`VB.invAddStack`
// (07zv_villagerbrain.js, exported this session for this file). `07zv_villagerbrain.js`'s own
// `VB.tick` calls `NS.VBGather.lootTick` EVERY tick (item pickup is `MobEntity.tickMovement`'s
// own dispatcher in vanilla, not a Brain task -- it runs in every activity, babies included,
// `VillagerEntity.java:191/524`'s own `setCanPickUpLoot(true)` is unconditional) and
// `NS.VBGather.tick` only while `activity === 'idle'` (GatherItemsVillagerTask's own real
// priority-3 slot, `createIdleTasks`, same as `NS.VBBreed.tick`'s own slot next to it).

(function (NS) {
  'use strict';
  var VB = NS.VB;
  if (!VB) return;

  var Gt = NS.VBGather = NS.VBGather || {};

  // GatherItemsVillagerTask.MAX_RANGE (.decomp GatherItemsVillagerTask.java:20, `field_30117`
  // named on names.tsv) -- the task's own per-tick keepRunning/run gate is
  // `squaredDistanceTo(partner) > 5.0` (java:35/48), read as a squared distance directly.
  Gt.MAX_RANGE_SQ = 5.0;
  // `LivingEntity`'s own item-touch box every pickup in this engine already uses --
  // `src/14_player.js`'s own `P.PICKUP_INFLATE`, same [1.0, 0.5, 1.0] inflate, same header note
  // ("the box is inflated, and by different amounts on different axes").
  Gt.PICKUP_INFLATE = [1.0, 0.5, 1.0];
  // `LookTargetUtil.give` (.decomp java:81-89): a 0.3-speed toss toward the partner's position.
  Gt.GIVE_SPEED = 0.3;
  Gt.GIVE_EYE_DROP = 0.3;   // `getEyeY() - 0.3F`

  // `VillagerEntity.GATHERABLE_ITEMS` (.decomp VillagerEntity.java:102-104): bread, potato,
  // carrot, wheat, wheat_seeds, beetroot, beetroot_seeds -- cross-checked against Items.java's
  // own field_8xxx -> name declarations (852-854/1295-1300/1411-1412), the SAME cross-check
  // `07zv4_vbidle.js`'s own `VB.BREED_FOOD_VALUES` header already performed for the four food
  // ones.
  Gt.GATHERABLE_ITEMS = ['bread', 'potato', 'carrot', 'wheat', 'wheat_seeds', 'beetroot', 'beetroot_seeds'];
  // `VillagerProfession.getGatherableItems()` (.decomp VillagerProfession.java:16-35): every
  // profession but FARMER (`field_17056`) registers through the two-arg `register` overload,
  // which defaults `gatherableItems` to `ImmutableSet.of()` (line 77) -- FARMER alone carries
  // wheat/wheat_seeds/beetroot_seeds/bone_meal (line 21-27).
  Gt.PROFESSION_GATHERABLE = { farmer: ['wheat', 'wheat_seeds', 'beetroot_seeds', 'bone_meal'] };
  // `VillagerEntity.wantsToStartBreeding`: `getAvailableFood() >= 24` (.decomp java:830-832).
  Gt.WANTS_BREED_FOOD = 24;
  // `giveHalfOfStack`'s own `count > 24` half-line (java:88) for wheat's own 64-cap stack.
  Gt.WHEAT_SHARE_MIN = 32;   // `Items.WHEAT.getMaxCount() / 2`

  function professionGatherable(prof) { return Gt.PROFESSION_GATHERABLE[prof] || []; }

  /** `VillagerEntity.canGather` (.decomp :824-827): `GATHERABLE_ITEMS.contains(item) ||
   *  profession.getGatherableItems().contains(item)`. The `SimpleInventory.canInsert` half is
   *  folded into `VB.invAddStack`'s own remainder below (try the add, see what is left) rather
   *  than pre-checked separately -- same "attempt, then read the remainder" shape
   *  `VB.farmerAdditionalWork`'s own bread-drop-the-overflow line already uses. */
  function canGather(e, name) {
    if (Gt.GATHERABLE_ITEMS.indexOf(name) >= 0) return true;
    return professionGatherable(e.profession).indexOf(name) >= 0;
  }

  /** `VillagerEntity.loot` (.decomp :802-819), reached from `MobEntity.tickMovement`'s own
   *  `canPickUpLoot()` + `DO_MOB_GRIEFING` dispatcher (MobEntity.java:519-527) -- villagers set
   *  `canPickUpLoot = true` unconditionally at spawn (java:191/524), so the ONLY gate left is
   *  the gamerule, read the SAME way `Ai.BreakDoorGoal` already does (`EL.aiCtx(e).mobGriefing`,
   *  D-399). Runs every tick, every activity -- called from `VB.tick` OUTSIDE the idle branch. */
  Gt.lootTick = function (e) {
    var EL = NS.EntityList;
    if (!EL || !EL.ready || !EL.list) return;
    var ctx = EL.aiCtx ? EL.aiCtx(e) : null;
    if (ctx && ctx.mobGriefing && !ctx.mobGriefing()) return;
    var IN = Gt.PICKUP_INFLATE, hw = (e.width || 0.6) * 0.5, h = e.height || 1.95;
    var x0 = e.x - hw - IN[0], x1 = e.x + hw + IN[0];
    var y0 = e.y - IN[1], y1 = e.y + h + IN[1];
    var z0 = e.z - hw - IN[2], z1 = e.z + hw + IN[2];
    var list = EL.list, IT = NS.Items;
    if (!IT || !IT.nameOf) return;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (!o || o.removed || o.dead || o.type !== 'item' || (o.pickupDelay | 0) > 0) continue;
      var ehw = (o.width || 0.25) * 0.5, eh = o.height || 0.25;
      if (o.x + ehw < x0 || o.x - ehw > x1) continue;
      if (o.y + eh < y0 || o.y > y1) continue;
      if (o.z + ehw < z0 || o.z - ehw > z1) continue;
      var name = IT.nameOf(o.item);
      if (!name || !canGather(e, name)) continue;
      var count = o.count | 0;
      if (count <= 0) continue;
      // ⚠ VANILLA ONLY TAKES WHAT FITS (src/14_player.js's own `P.pickupItems` header, the SAME
      // `SimpleInventory.addStack` remainder rule) -- the entity keeps whatever did not fit and
      // stays on the floor instead of vanishing.
      var left = VB.invAddStack(e, name, count);
      var taken = count - left;
      if (taken <= 0) continue;
      o.count = left;
      if (o.count <= 0) EL.remove(o);
    }
  };

  function nearestVillagerWithin(e, maxSq) {
    var EL = NS.EntityList;
    if (!EL || !EL.list) return null;
    var list = EL.list, best = null, bestD = maxSq;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (!o || o === e || o.type !== 'villager' || o.dead || o.removed) continue;
      var dx = o.x - e.x, dy = o.y - e.y, dz = o.z - e.z, d = dx * dx + dy * dy + dz * dz;
      if (d <= bestD) { bestD = d; best = o; }
    }
    return best;
  }

  function invContainsAny(e, names) {
    var inv = e.villagerInventory, IT = NS.Items;
    if (!inv || !IT || !IT.nameOf) return false;
    for (var i = 0; i < inv.length; i++) {
      var st = inv[i];
      if (!st || !(st.n > 0)) continue;
      var name = IT.nameOf(st.i);
      if (name && names.indexOf(name) >= 0) return true;
    }
    return false;
  }

  /** `LookTargetUtil.give` (.decomp :81-89): tossed from the giver's own eye position (minus
   *  0.3), at a fixed 0.3 speed AIMED at the receiver's current position -- not physically
   *  handed over, so a receiver that walks away before it lands does not actually get it
   *  (matches vanilla: `give` spawns a real `ItemEntity`, it is not an inventory-to-inventory
   *  transfer). `EL.dropStack`'s own `opts.vx/vy/vz` (07i_entitylist.js) is the SAME custom-
   *  velocity hook `EL.popResource`'s sibling calls already use. */
  function giveItemTo(e, partner, name, count) {
    if (count <= 0) return;
    var EL = NS.EntityList;
    if (!EL || !EL.dropStack) return;
    var eyeH = (e.eyeHeight !== undefined) ? e.eyeHeight : (e.height || 1.95) * 0.85;
    var sx = e.x, sy = e.y + eyeH - Gt.GIVE_EYE_DROP, sz = e.z;
    var dx = partner.x - sx, dy = partner.y - sy, dz = partner.z - sz;
    var len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    var s = Gt.GIVE_SPEED / len;
    EL.dropStack(sx, sy, sz, name, count, { vx: dx * s, vy: dy * s, vz: dz * s });
  }
  // Exported for src/07zv7_vbgifts.js's own GiveGiftsToHeroTask (loop/gifts): the SAME
  // eye-position/0.3-speed toss, not a second copy of it.
  Gt.giveItemTo = giveItemTo;

  /** `giveHalfOfStack` (.decomp :70-99): the FIRST inventory slot holding one of `names` --
   *  half of it if the stack is over half its max size, else everything past 24 if it is over
   *  24, else that slot is left alone and the scan moves on (NOT a break -- java:104-108's own
   *  `$$5++; continue;` when neither half-condition holds). Only one slot is ever touched per
   *  call, matching the exact arithmetic vanilla uses (not a plain "give everything"). */
  function giveHalfOfStack(e, names, partner) {
    var inv = VB.ensureVillagerInventory(e), IT = NS.Items;
    if (!inv || !IT || !IT.nameOf) return false;
    for (var i = 0; i < inv.length; i++) {
      var st = inv[i];
      if (!st || !(st.n > 0)) continue;
      var name = IT.nameOf(st.i);
      if (!name || names.indexOf(name) < 0) continue;
      var max = IT.maxStack ? IT.maxStack(st.i) : 64;
      var give;
      if (st.n > (max >> 1)) give = Math.floor(st.n / 2);
      else if (st.n > 24) give = st.n - 24;
      else continue;
      st.n -= give;
      if (st.n <= 0) inv[i] = null;
      giveItemTo(e, partner, name, give);
      return true;
    }
    return false;
  }

  /** `GatherItemsVillagerTask`'s own per-tick body (.decomp :39-59, folded into one
   *  per-villager-per-tick call, the SAME convention every other separate priority tier in this
   *  brain already uses -- `NS.VBBreed.tick`'s own header). Called from `07zv_villagerbrain.js`'s
   *  own `VB.tick` while `activity === 'idle'`, for EVERY villager -- see this file's own header
   *  for the INTERACTION_TARGET-acquisition simplification (a fresh nearest-villager scan here,
   *  not a persisted memory field). */
  Gt.tick = function (e, now, tnow) {
    if (!VB.ready) return;
    var partner = nearestVillagerWithin(e, Gt.MAX_RANGE_SQ);
    if (!partner) return;
    // `$$1.talkWithVillager($$0, $$3, $$2)` (java:47), before any hand-off.
    if (NS.Village && NS.Village.talkWithVillager) NS.Village.talkWithVillager(e, partner, now, Math.random);
    // `wantsToStartBreeding() && (profession == FARMER || partner.canBreed())` (java:44-46) --
    // `getAvailableFood() >= 24`/`< 12` both reuse `VB.villagerFoodValue`
    // (`07zv4_vbidle.js`'s own live-inventory sum, the SAME "one source of truth" `VB.OWED`'s
    // own `readyToBreed` already reads for the courting gate itself).
    if (VB.villagerFoodValue(e) >= Gt.WANTS_BREED_FOOD
        && (e.profession === 'farmer' || VB.villagerFoodValue(partner) < VB.BREED_FOOD_MIN)) {
      giveHalfOfStack(e, Object.keys(VB.BREED_FOOD_VALUES), partner);
    }
    // `partner.profession == FARMER && count(WHEAT) > 32` (java:48-50).
    if (partner.profession === 'farmer' && VB.invCount(e, 'wheat') > Gt.WHEAT_SHARE_MIN) {
      giveHalfOfStack(e, ['wheat'], partner);
    }
    // `getGatherableItems(self, partner)` = partner's own gatherable set MINUS self's own
    // (java:63-68) -- non-empty only when partner is a farmer and self is not one (the only
    // profession with a non-empty set at all, this file's own `PROFESSION_GATHERABLE` header).
    var partnerItems = professionGatherable(partner.profession);
    if (partnerItems.length) {
      var selfItems = professionGatherable(e.profession);
      var items = partnerItems.filter(function (n) { return selfItems.indexOf(n) < 0; });
      if (items.length && invContainsAny(e, items)) giveHalfOfStack(e, items, partner);
    }
  };

  Gt.ready = true;

})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
