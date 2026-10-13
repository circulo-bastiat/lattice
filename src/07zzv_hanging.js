// src/07zzv_hanging.js — AbstractDecorationEntity core (G17-HG1): the thin wall-hugging box and
// the 100-tick survival check shared by painting / item_frame / glow_item_frame.
//
// .decomp read whole: net/minecraft/entity/decoration/AbstractDecorationEntity.java.
// Facing is a HORIZONTAL Direction id as vanilla numbers them: 0 south, 1 west, 2 north, 3 east.
// ⚠ OWED, NAMED: isSpaceEmpty: block cells plus collidable entities;
// the subclasses' getWidthPixels/getHeightPixels/onBreak/onPlace (HG2+: painting, frame) and
// player handleAttack/damage routing are not here — this is the core they extend.
(function (NS) {
  'use strict';
  var H = NS.Hanging = { ready: false };

  H.CHECK_INTERVAL = 100;
  /** Direction offsets by horizontal id: south, west, north, east. */
  H.DX = [0, -1, 0, 1];
  H.DZ = [1, 0, -1, 0];
  /** Direction.rotateYCounterclockwise on horizontal ids: S->E, E->N, N->W, W->S. */
  H.ccw = function (f) { return (f + 3) & 3; };
  H.opposite = function (f) { return (f + 2) & 3; };

  /** `method_6893`: even-block sizes (multiples of 32 px... as vanilla writes it) shift half a block. */
  H.halfShift = function (px) { return px % 32 === 0 ? 0.5 : 0.0; };

  /** setFacing + updateAttachmentPosition. Writes e.x/y/z, e.yaw, e.hbox {minX..maxZ}. */
  H.setFacing = function (e, facing) {
    e.facing = facing;
    e.yaw = facing >= 4 ? 0 : facing * 90;
    H.updateAttachmentPosition(e);
  };

  H.updateAttachmentPosition = function (e) {
    if (e.facing === undefined || e.facing === null) return;
    var f = e.facing, p = e.attachmentPos;
    if (f >= 4) {   // Axis.Y: 12x12 slab on the X/Z plane, 1/32 off the block face
      var vy = f === 4 ? 1 : -1, ex = e.widthPixels / 32, ez = e.widthPixels / 32;
      e.x = p.x + 0.5; e.y = p.y + 0.5 - vy * 0.46875; e.z = p.z + 0.5;
      e.hbox = { minX: e.x - ex, minY: e.y - 1 / 32, minZ: e.z - ez, maxX: e.x + ex, maxY: e.y + 1 / 32, maxZ: e.z + ez };
      return;
    }
    var wpx = e.widthPixels, hpx = e.heightPixels;
    var x = p.x + 0.5, y = p.y + 0.5, z = p.z + 0.5;
    var sw = H.halfShift(wpx), sh = H.halfShift(hpx);
    x -= H.DX[f] * 0.46875;
    z -= H.DZ[f] * 0.46875;
    y += sh;
    var c = H.ccw(f);
    x += sw * H.DX[c];
    z += sw * H.DZ[c];
    e.x = x; e.y = y; e.z = z;
    var hx = wpx, hy = hpx, hz = wpx;
    if (f === 0 || f === 2) hz = 1.0; else hx = 1.0;   // Axis.Z walls are thin in z
    hx /= 32; hy /= 32; hz /= 32;
    e.hbox = { minX: x - hx, minY: y - hy, minZ: z - hz, maxX: x + hx, maxY: y + hy, maxZ: z + hz };
  };

  /** Place a decoration: attachment cell, facing, size in sixteenths. Returns e. */
  H.attach = function (e, x, y, z, facing, widthPixels, heightPixels) {
    e.attachmentPos = { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) };
    e.widthPixels = widthPixels; e.heightPixels = heightPixels;
    e.obstructionCheckCounter = 0;
    H.setFacing(e, facing);
    return e;
  };

  function overlap(a, b) {
    return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY &&
           a.minZ < b.maxZ && a.maxZ > b.minZ;
  }

  function solidish(st) {
    var SR = NS.States;
    if (st === 0) return false;
    if (SR.solidMat[SR.block[st]] === 1) return true;
    var n = SR.name(st) || '';
    return /(^|:)(repeater|comparator)$/.test(n);   // AbstractRedstoneGateBlock.isRedstoneGate
  }

  /** world.isSpaceEmpty(this): no block with a collision shape inside the box. */
  H.spaceEmpty = function (e, world) {
    var b = e.hbox;
    for (var x = Math.floor(b.minX); x <= Math.floor(b.maxX - 1e-9); x++)
      for (var y = Math.floor(b.minY); y <= Math.floor(b.maxY - 1e-9); y++)
        for (var z = Math.floor(b.minZ); z <= Math.floor(b.maxZ - 1e-9); z++) {
          var sh = NS.Physics.shapeAt(x, y, z);   // real collision boxes, cell-local 0..1
          if (sh === null) continue;
          for (var i = 0; i < sh.length; i++) {
            var q = sh[i];
            if (b.minX < x + q[3] && b.maxX > x + q[0] && b.minY < y + q[4] && b.maxY > y + q[1] &&
                b.minZ < z + q[5] && b.maxZ > z + q[2]) return false;
          }
        }
    // getEntityCollisions: entities with collidesWith true (boats, minecarts, living shulkers)
    var Ph = NS.Physics, Sh = NS.Shulker, list = NS.EntityList && NS.EntityList.list, c = 1e-6;
    if (list) for (var i = 0; i < list.length; i++) {
      var o = list[i], t;
      if (o === e || o.dead || o.removed) continue;
      if (o.type === 'shulker') { if (!Sh || !Sh.boundingBox || !Sh.isCollidable(o)) continue; t = Sh.boundingBox(o); }
      else if (Ph && Ph.solidVehicle && Ph.solidVehicle(o)) t = Ph.vehicleBox(o);
      else continue;
      if (t[0] < b.maxX - c && t[3] > b.minX + c && t[1] < b.maxY - c && t[4] > b.minY + c &&
          t[2] < b.maxZ - c && t[5] > b.minZ + c) return false;
    }
    return true;
  };

  /** canStayAttached. `others` = live entities (EL.list). */
  H.canStayAttached = function (e, world, others) {
    if (!H.spaceEmpty(e, world)) return false;
    var w = Math.max(1, (e.widthPixels / 16) | 0), h = Math.max(1, (e.heightPixels / 16) | 0);
    var p = e.attachmentPos, f = e.facing;
    if (f >= 4) return solidish(world.getBlock(p.x, p.y + (f === 4 ? -1 : 1), p.z)) && !H.overlapsAny(e, others);
    var o = H.opposite(f), c = H.ccw(f);
    var bx = p.x + H.DX[o], bz = p.z + H.DZ[o];
    for (var i = 0; i < w; i++) {
      for (var j = 0; j < h; j++) {
        var ox = ((w - 1) / -2) | 0, oy = ((h - 1) / -2) | 0;   // Java int division truncates
        var st = world.getBlock(bx + H.DX[c] * (i + ox), p.y + j + oy, bz + H.DZ[c] * (i + ox));
        if (!solidish(st)) return false;
      }
    }
    return !H.overlapsAny(e, others);
  };
  H.overlapsAny = function (e, others) {
    for (var k = 0; k < others.length; k++) {
      var t = others[k];
      if (t !== e && !t.removed && t.hbox && t.attachmentPos && overlap(e.hbox, t.hbox)) return true;
    }
    return false;
  };
  /** Item frame NBT: vanilla 3D Direction ids (0 down 1 up 2 north 3 south 4 west 5 east). */
  H.TO_NBT_FACING = [3, 4, 2, 5, 1, 0];
  H.writeFrameNbt = function (e) {
    return { Facing: H.TO_NBT_FACING[e.facing], ItemRotation: e.rotation | 0, TileX: e.attachmentPos.x, TileY: e.attachmentPos.y, TileZ: e.attachmentPos.z };
  };
  H.readFrameNbt = function (e, tag) {
    e.attachmentPos = { x: tag.TileX, y: tag.TileY, z: tag.TileZ };
    e.widthPixels = 12; e.heightPixels = 12; e.rotation = tag.ItemRotation & 7;
    H.setFacing(e, H.TO_NBT_FACING.indexOf(tag.Facing));
    return e;
  };

  /** tick(): every 101st call (vanilla `counter++ == 100`) run the survival check; on failure
   *  remove and call e.onBreak(null). Returns true if it broke. */
  H.tick = function (e, world, others) {
    if (e.removed) return false;
    if (e.obstructionCheckCounter++ === H.CHECK_INTERVAL) {
      e.obstructionCheckCounter = 0;
      if (!H.canStayAttached(e, world, others || [])) {
        if (NS.EntityList && NS.EntityList.remove) NS.EntityList.remove(e); else e.removed = true;
        if (e.onBreak) e.onBreak(null);
        else if (e.type === 'item_frame' || e.type === 'glow_item_frame') H.onBreak(e, null);
        return true;
      }
    }
    return false;
  };

  /** move / addVelocity: any non-zero push breaks it (no motion, ever). */
  H.move = function (e, dx, dy, dz) {
    if (e.removed || dx * dx + dy * dy + dz * dz <= 0) return;
    if (NS.EntityList && NS.EntityList.remove) NS.EntityList.remove(e); else e.removed = true;
    if (e.onBreak) e.onBreak(null);
  };
  H.addVelocity = H.move;
  H.collides = function () { return true; };

  /** PaintingMotive registry (PaintingMotive.java, registration order): id, width px, height px. */
  H.MOTIVES = [
    ['kebab', 16, 16], ['aztec', 16, 16], ['alban', 16, 16], ['aztec2', 16, 16], ['bomb', 16, 16],
    ['plant', 16, 16], ['wasteland', 16, 16], ['pool', 32, 16], ['courbet', 32, 16], ['sea', 32, 16],
    ['sunset', 32, 16], ['creebet', 32, 16], ['wanderer', 16, 32], ['graham', 16, 32], ['match', 32, 32],
    ['bust', 32, 32], ['stage', 32, 32], ['void', 32, 32], ['skull_and_roses', 32, 32], ['wither', 32, 32],
    ['fighters', 64, 32], ['pointer', 64, 64], ['pigscene', 64, 64], ['burning_skull', 64, 64],
    ['skeleton', 64, 48], ['donkey_kong', 64, 48]
  ];

  /** PaintingEntity(World, BlockPos, Direction): try every motive, keep those that canStayAttached,
   *  drop all but the largest area, pick one with rnd(n) (random.nextInt). Returns the painting. */
  H.placePainting = function (world, x, y, z, facing, others, rnd) {
    var e = { type: 'painting', motive: 'kebab' };
    e.attachmentPos = { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) };
    e.obstructionCheckCounter = 0;
    var fit = [], best = 0, i, m;
    for (i = 0; i < H.MOTIVES.length; i++) {
      m = H.MOTIVES[i];
      H.setMotive(e, m[0]); H.setFacing(e, facing);
      if (H.canStayAttached(e, world, others || [])) {
        fit.push(m);
        if (m[1] * m[2] > best) best = m[1] * m[2];
      }
    }
    if (fit.length) {
      fit = fit.filter(function (q) { return q[1] * q[2] >= best; });
      H.setMotive(e, fit[rnd(fit.length)][0]);
    }
    H.setFacing(e, facing);
    return e;
  };
  H.setMotive = function (e, id) {
    for (var i = 0; i < H.MOTIVES.length; i++) if (H.MOTIVES[i][0] === id) {
      e.motive = id; e.widthPixels = H.MOTIVES[i][1]; e.heightPixels = H.MOTIVES[i][2]; return e;
    }
    return e;
  };
  H.writePaintingNbt = function (e) { return { Motive: 'minecraft:' + e.motive, Facing: e.facing }; };
  H.readPaintingNbt = function (e, tag) {
    H.setMotive(e, String(tag.Motive || '').replace(/^minecraft:/, ''));
    H.setFacing(e, tag.Facing & 3);
    return e;
  };

  /** Use.itemUseOn face (+X -X +Y -Y +Z -Z) -> facing id (0 S, 1 W, 2 N, 3 E, 4 up, 5 down). */
  H.FACE_TO_FACING = [3, 1, 4, 5, 0, 2];
  H.FACE_DX = [1, -1, 0, 0, 0, 0]; H.FACE_DY = [0, 0, 1, -1, 0, 0]; H.FACE_DZ = [0, 0, 0, 0, 1, -1];

  /** DecorationItem.useOnBlock for painting / item_frame / glow_item_frame. Returns true if placed
   *  (SUCCESS) else false (FAIL). Creative (P.instabuild) keeps the stack. EntityTag is merged
   *  (EntityType.loadFromEntityNbt; hanging entities do not require an operator). ⚠ OWED, NAMED: GameEvent ENTITY_PLACE. */
  H.useOnBlock = function (P, x, y, z, face, name, stack, rnd) {
    var EL = NS.EntityList, W = NS.World;
    if (!EL || !EL.ready || !W) return false;
    var painting = name === 'painting';
    var facing = H.FACE_TO_FACING[face];
    if (painting && facing >= 4) return false;            // paintings: horizontal faces only
    var ax = x + H.FACE_DX[face], ay = y + H.FACE_DY[face], az = z + H.FACE_DZ[face];
    if (P && P.canPlaceOn && !P.canPlaceOn(ax, ay, az, face, stack)) return false;
    var others = EL.list || [], e;
    if (painting) {
      e = H.placePainting(W, ax, ay, az, facing, others, rnd || function (n) { return (Math.random() * n) | 0; });
    } else {
      e = { type: name, attachmentPos: { x: ax, y: ay, z: az }, obstructionCheckCounter: 0 };
      H.attach(e, ax, ay, az, facing, 12, 12);
    }
    var et = stack && stack.t && stack.t.EntityTag;
    if (et) {
      if (painting) { if (et.Motive != null) H.setMotive(e, String(et.Motive).replace(/^minecraft:/, '')); H.setFacing(e, facing); }
      else {
        if (et.Item && et.Item.i != null) e.item = { i: et.Item.i, n: 1 };
        if (et.ItemRotation != null) e.rotation = ((et.ItemRotation | 0) % 8 + 8) % 8;
        if (et.Invisible) e.invisible = true;
        if (et.Fixed) e.fixed = true;
      }
    }
    if (!H.canStayAttached(e, W, others)) return false;
    var ent = EL.spawn(name, e.x, e.y, e.z);
    if (!ent) return false;
    for (var k in e) if (k !== 'type') ent[k] = e[k];
    if (!(P && P.instabuild) && NS.Inventory && NS.Inventory.shrink) NS.Inventory.shrink(stack, 1);
    if (P && P.syncHotbar) P.syncHotbar();
    if (NS.Sound && NS.Sound.play) NS.Sound.play(painting ? 'entity.painting.place' : (name === 'glow_item_frame' ? 'entity.glow_item_frame.place' : 'entity.item_frame.place'),
      { x: e.x, y: e.y, z: e.z, source: 'block' });
    return true;
  };

  /** ItemFrameEntity item + rotation (G17-HG4). e.item = {i,n} or null; e.rotation 0..7; e.fixed. */
  H.setRotation = function (e, r) {
    e.rotation = ((r % 8) + 8) % 8;
    if (H.updateComparators) H.updateComparators(e);
  };
  H.setHeldItemStack = function (e, stack) {
    if (stack && stack.n > 0) {
      e.item = { i: stack.i, n: 1 };
      if (stack.t) e.item.t = stack.t;
      if (NS.Sound && NS.Sound.play) NS.Sound.play('entity.item_frame.add_item', { x: e.x, y: e.y, z: e.z, source: 'block' });
    } else e.item = null;
    if (H.updateComparators) H.updateComparators(e);
  };
  H.getAsItemStack = function (e) { return e.item ? { i: e.item.i, n: 1 } : null; };
  H.getComparatorPower = function (e) { return e.item ? (e.rotation | 0) % 8 + 1 : 0; };
  /** interact: returns 'pass' | 'consume' | 'fail'. */
  H.interact = function (e, P, stack) {
    var has = !!e.item, holding = !!(stack && stack.n > 0);
    if (e.fixed) return 'pass';
    if (!has) {
      if (holding && !e.removed) {
        H.setHeldItemStack(e, stack);
        if (!(P && P.instabuild) && NS.Inventory && NS.Inventory.shrink) NS.Inventory.shrink(stack, 1);
      }
    } else {
      if (NS.Sound && NS.Sound.play) NS.Sound.play('entity.item_frame.rotate_item', { x: e.x, y: e.y, z: e.z, source: 'block' });
      H.setRotation(e, (e.rotation | 0) + 1);
    }
    return 'consume';
  };

  /** Entity.isInvulnerableTo (+ the brief's ruling: fire/lava sources never reach a decoration). */
  function invulnerableTo(e, src) {
    if (e.removed) return true;
    if (src && src.fire) return true;
    return !!e.invulnerable && !(src && (src.outOfWorld || src.creativeAttacker));
  }
  function ruleDrops() {
    var C = NS.Commands;
    return !(C && typeof C.ruleGet === 'function' && C.ruleGet('doEntityDrops') === 'false');
  }
  function snd(e, n) { if (NS.Sound && NS.Sound.play) NS.Sound.play(n, { x: e.x, y: e.y, z: e.z, source: 'block' }); }
  function nameOf(i) { return typeof i === 'string' ? i : (NS.Items && NS.Items.nameOf ? NS.Items.nameOf(i) : i); }
  function dropAt(e, name) {
    var EL = NS.EntityList, f = e.facing | 0;
    if (EL && EL.dropStack) EL.dropStack(e.x + (f < 4 ? H.DX[f] * 0.15 : 0), e.y, e.z + (f < 4 ? H.DZ[f] * 0.15 : 0), name, 1);
  }
  /** ItemFrameEntity.dropHeldStack(attacker, alwaysDrop). */
  H.dropHeldStack = function (e, attacker, alwaysDrop) {
    if (e.fixed) return;
    var held = e.item;
    e.item = null;
    if (H.updateComparators) H.updateComparators(e);
    if (!ruleDrops()) return;
    if (attacker && attacker.instabuild) return;
    if (alwaysDrop) dropAt(e, e.type === 'glow_item_frame' ? 'glow_item_frame' : 'item_frame');
    if (held) {
      var rnd = (NS.EntityList && NS.EntityList.random) || Math.random;
      var chance = e.itemDropChance === undefined ? 1.0 : e.itemDropChance;
      if (rnd() < chance) dropAt(e, nameOf(held.i));
    }
  };
  H.onBreak = function (e, attacker) {
    snd(e, 'entity.item_frame.break');
    H.dropHeldStack(e, attacker, true);
  };
  /** AbstractDecorationEntity.damage. src: {attacker, explosive, fire, outOfWorld, creativeAttacker}. */
  H.decorationDamage = function (e, src) {
    if (invulnerableTo(e, src)) return false;
    if (!e.removed) {
      if (NS.EntityList && NS.EntityList.remove) NS.EntityList.remove(e); else e.removed = true;
      if (e.type === 'item_frame' || e.type === 'glow_item_frame') H.onBreak(e, src && src.attacker);
      else if (e.onBreak) e.onBreak(src && src.attacker);
    }
    return true;
  };
  /** ItemFrameEntity.damage. Returns whether the hit landed. */
  H.damage = function (e, src) {
    if (e.fixed) return (src && (src.outOfWorld || src.creativeAttacker)) ? H.decorationDamage(e, src) : false;
    if (invulnerableTo(e, src)) return false;
    if (!(src && src.explosive) && e.item) {
      H.dropHeldStack(e, src && src.attacker, false);
      snd(e, 'entity.item_frame.remove_item');
      return true;
    }
    return H.decorationDamage(e, src);
  };

  H.init = function () { H.ready = true; };
  H.init();
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
