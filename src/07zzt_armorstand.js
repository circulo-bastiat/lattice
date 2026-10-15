// src/07zzt_armorstand.js -- #4391: the armor_stand's gameplay (the entity + model already existed).
// .decomp read: item/ArmorStandItem.java (useOnBlock), entity/decoration/ArmorStandEntity.java
// (interactAt, slotFromPosition, isSlotDisabled, equip). Damage/break is #4392 (Cb.armorStandDamage).
// Hooks: Use.useOnBlock (place), Use.entityUse (interact). Reads NS.* live.
// ponytail: no pose NBT editing, no IN_FIRE branch (Cb.hurt has no inFire source), partial-shape box test
// at placement (entities are checked, blocks only by whole-cell collision), no spawn particles; stack tags are not
// carried into the stand (same ceiling as Equip.OWED's dropStack note).
(function (NS) {
  'use strict';
  var AS = NS.ArmorStand = {};

  // EquipmentSlot.getArmorStandSlotId, indexed by this engine's slot number (MAINHAND..HEAD).
  var SLOT_ID = [0, 5, 1, 2, 3, 4];

  function play(e, ev, vol, pitch, src) {
    if (NS.Sound && NS.Sound.play) NS.Sound.play(ev, { x: e.x, y: e.y, z: e.z, volume: vol, pitch: pitch, source: src || 'neutral' });
  }
  function has(e, slot) { return !!NS.Equip.getEquipped(e, slot); }

  /** `ArmorStandItem.useOnBlock` past the face check: spawn at cell (x,y,z), yaw snapped to 45 degrees. */
  AS.place = function (P, stack, x, y, z) {
    var EL = NS.EntityList, W = NS.World, Use = NS.Use, Iv = NS.Inventory;
    if (!EL || !EL.canSpawn('armor_stand')) return false;
    if (Use && W && W.getBlock && !(Use.collisionEmpty(W.getBlock(x, y, z)) && Use.collisionEmpty(W.getBlock(x, y + 1, z)))) return false;
    // getOtherEntities(null, 0.5 x 1.975 box at the cell's bottom centre) must be empty
    var list = (EL.list || []).concat(NS.Player ? [NS.Player] : []);
    for (var i = 0; i < list.length; i++) {
      var o = list[i], hw = (o.width !== undefined ? o.width : 0.6) / 2, h = o.height || 1.8;
      if (!o || o.removed || (NS.Gamemode && NS.Gamemode.isSpectator && NS.Gamemode.isSpectator(o))) continue;
      if (o.x - hw < x + 0.75 && o.x + hw > x + 0.25 && o.y < y + 1.975 && o.y + h > y && o.z - hw < z + 0.75 && o.z + hw > z + 0.25) return false;
    }
    var rnd = EL.random || Math.random;
    var e = EL.spawn('armor_stand', x + 0.5, y, z + 0.5);
    if (!e) return false;
    if (stack.t && stack.t.EntityTag) AS.readNbt(e, stack.t.EntityTag);
    // engine yaw = vanilla yaw + 180deg (D-415); vanilla: floor((wrap(playerYaw - 180) + 22.5) / 45) * 45
    var py = ((P && P.yaw) || 0) * 180 / Math.PI;          // engine player yaw, degrees
    var w = ((py - 360) % 360 + 540) % 360 - 180;           // wrapDegrees(vanillaPlayerYaw - 180)
    e.yaw = (Math.floor((w + 22.5) / 45) * 45 + 180) * Math.PI / 180;
    e.headPose = [rnd() * 5, rnd() * 20 - 10, 0];            // setRotations: head pitch/yaw jitter
    e.bodyPose = [0, rnd() * 10 - 5, 0];
    play(e, 'entity.armor_stand.place', 0.75, 0.8, 'block');
    if (NS.GameEvent) NS.GameEvent.emit('entity_place', e.x, e.y, e.z, P);   // ArmorStandItem: ENTITY_PLACE (12)
    if (!P.instabuild && Iv && Iv.shrink) Iv.shrink(stack, 1);
    return true;
  };

  // ---- #4393: NBT (read/writeCustomDataToNbt); state on the entity. Renderer reads them (#4497, ER.animOf/standHide).
  AS.DEFAULT_POSE = { Head: [0, 0, 0], Body: [0, 0, 0], LeftArm: [-10, 0, -10], RightArm: [-15, 0, 10],
    LeftLeg: [-1, 0, -1], RightLeg: [1, 0, 1] };
  var POSES = Object.keys(AS.DEFAULT_POSE);

  AS.pose = function (e, k) { return (e.asPose && e.asPose[k]) || AS.DEFAULT_POSE[k]; };
  /** Size/marker change the box: SMALL_DIMENSIONS = scaled(0.5), marker = fixed(0, 0). */
  AS.refresh = function (e) {
    var d = NS.Entities.dimensions('armor_stand');
    var s = e.marker ? 0 : e.small ? 0.5 : 1;
    e.width = d.width * s; e.height = d.height * s;
  };
  var stackOf = function (n) {
    var Iv = NS.Inventory;
    if (!n || !n.id) return null;
    var s = Iv.stack(String(n.id).replace(/^minecraft:/, ''), n.Count === undefined ? 1 : n.Count, 0, n.tag);
    return Iv.isEmpty(s) ? null : s;
  };
  var nbtOf = function (s) {
    if (!s) return {};
    var o = { id: 'minecraft:' + NS.Items.nameOf(s.i), Count: s.n };
    if (s.t) o.tag = s.t;
    return o;
  };

  AS.readNbt = function (e, tag) {
    var Eq = NS.Equip, i, k;
    if (Array.isArray(tag.ArmorItems)) for (i = 0; i < 4; i++) Eq.setEquipped(e, 2 + i, stackOf(tag.ArmorItems[i]));
    if (Array.isArray(tag.HandItems)) for (i = 0; i < 2; i++) Eq.setEquipped(e, i, stackOf(tag.HandItems[i]));
    e.invisible = !!tag.Invisible; e.small = !!tag.Small; e.showArms = !!tag.ShowArms;
    e.noBasePlate = !!tag.NoBasePlate; e.marker = !!tag.Marker;
    e.disabledSlots = tag.DisabledSlots | 0;
    var p = tag.Pose || {};
    e.asPose = {};
    for (i = 0; i < POSES.length; i++) {
      k = POSES[i];
      if (Array.isArray(p[k]) && p[k].length >= 3) e.asPose[k] = [p[k][0] % 360 || 0, p[k][1] % 360 || 0, p[k][2] % 360 || 0];
    }
    AS.refresh(e);
  };
  AS.writeNbt = function (e) {
    var Eq = NS.Equip, o = { ArmorItems: [], HandItems: [], Invisible: !!e.invisible, Small: !!e.small,
      ShowArms: !!e.showArms, DisabledSlots: e.disabledSlots | 0, NoBasePlate: !!e.noBasePlate, Pose: {} };
    for (var i = 0; i < 4; i++) o.ArmorItems.push(nbtOf(Eq.getEquipped(e, 2 + i)));
    for (i = 0; i < 2; i++) o.HandItems.push(nbtOf(Eq.getEquipped(e, i)));
    if (e.marker) o.Marker = true;
    for (i = 0; i < POSES.length; i++) {
      var d = AS.DEFAULT_POSE[POSES[i]], v = AS.pose(e, POSES[i]);
      if (v[0] !== d[0] || v[1] !== d[1] || v[2] !== d[2]) o.Pose[POSES[i]] = v.slice();
    }
    return o;
  };

  /** `slotFromPosition`: `hy` is the click height above the stand's feet. */
  AS.slotFromPosition = function (e, hy) {
    var small = !!e.small, y = small ? hy * 2 : hy;
    if (y >= 0.1 && y < 0.1 + (small ? 0.8 : 0.45) && has(e, 2)) return 2;                          // FEET
    if (y >= 0.9 + (small ? 0.3 : 0) && y < 0.9 + (small ? 1 : 0.7) && has(e, 4)) return 4;         // CHEST
    if (y >= 0.4 && y < 0.4 + (small ? 1 : 0.8) && has(e, 3)) return 3;                             // LEGS
    if (y >= 1.6 && has(e, 5)) return 5;                                                             // HEAD
    if (!has(e, 0) && has(e, 1)) return 1;                                                           // OFFHAND
    return 0;
  };

  function disabled(e, slot) {
    return ((e.disabledSlots | 0) & (1 << SLOT_ID[slot])) !== 0 || (slot < 2 && !e.showArms);
  }

  /** `equip(player, slot, stack, hand)`; true when it changed something. */
  function equip(P, e, slot, stack, hs) {
    var Iv = NS.Inventory, Eq = NS.Equip, old = Eq.getEquipped(e, slot), ds = e.disabledSlots | 0, sid = SLOT_ID[slot];
    var empty = Iv.isEmpty(stack);
    if (old && (ds & (1 << (sid + 8)))) return false;
    if (!old && (ds & (1 << (sid + 16)))) return false;
    if (P.instabuild && !old && !empty) { var c = Iv.copy(stack); c.n = 1; Eq.setEquipped(e, slot, c); return true; }
    if (empty || stack.n <= 1) {
      Eq.setEquipped(e, slot, empty ? null : Iv.copy(stack));
      Iv.setItem(P.inventory, hs, old || Iv.EMPTY);
      return true;
    }
    if (old) return false;
    var one = Iv.copy(stack); one.n = 1;
    Eq.setEquipped(e, slot, one);
    Iv.shrink(stack, 1);
    return true;
  }

  /** `interactAt`: true when the click is consumed (SUCCESS or FAIL), false for PASS. */
  function interactHand(e, P, stack, hy, hs) {
    var Iv = NS.Inventory, Eq = NS.Equip, IT = NS.Items;
    if (e.marker || (stack && !Iv.isEmpty(stack) && IT.nameOf(stack.i) === 'name_tag')) return false;
    if (P.spectator) return true;
    var empty = !stack || Iv.isEmpty(stack);
    var pref = empty ? 0 : Eq.preferredSlot(stack);
    if (pref < 0) pref = 0;
    if (empty) {
      var s = AS.slotFromPosition(e, hy), s2 = disabled(e, s) ? pref : s;
      return has(e, s2) && equip(P, e, s2, stack, hs);
    }
    if (disabled(e, pref)) return true;   // FAIL (also covers hands without showArms)
    return equip(P, e, pref, stack, hs);
  }
  /** MAIN_HAND then OFF_HAND while the main hand PASSes (`stack` is the main-hand stack). */
  AS.interact = function (e, P, stack, hy) {
    return interactHand(e, P, stack, hy, P.slot) || interactHand(e, P, NS.Inventory.getItem(P.inventory, NS.Inventory.OFFHAND), hy, NS.Inventory.OFFHAND);
  };
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
