// 07zzv_soulspeed.js -- #5769: Soul Speed, translated from .decomp LivingEntity
// (addSoulSpeedBoostIfNeeded / removeSoulSpeedBoost / applyMovementEffects / fall / getVelocityMultiplier /
// shouldDisplaySoulSpeedEffects / displaySoulSpeedEffects) and EnchantmentHelper.hasSoulSpeed.
//   - the boost is ONE additive movement_speed modifier, 0.03F * (1 + level * 0.35F), kept on `e.soulSpeedMod`
//     (Physics adds it to the 0.1 base before the sprint multiplier);
//   - it is added when the entity changes block, or lands, standing on #soul_speed_blocks (soul_sand, soul_soil),
//     and each add has a 4% chance (nextFloat < 0.04F) to wear the boots by 1;
//   - it is removed on a block change when the landing block is not air (or flying), and on landing;
//   - while on such a block with the enchantment, the soul_sand 0.4 velocity multiplier is 1.0;
//   - every 5th tick, moving in x and z: a SOUL particle and the soul_escape sound.
// Every step goes through NS.SoulSpeed.<name> so tools/soulspeedcheck.mjs can break one at a time.
(function (NS) {
  'use strict';
  var SS = NS.SoulSpeed = {};

  SS.FEET = 0;                 // armour slot index of the boots (Inventory.ARMOR_START + 0)
  SS.BASE = 0.03;
  SS.PER_LEVEL = 0.35;
  SS.BOOT_WEAR_CHANCE = 0.04;
  var F = Math.fround;

  SS.isSoulBlock = function (blockId) {
    var R = NS.Reg;
    return !!R && R.id && (blockId === R.id.soul_sand || blockId === R.id.soul_soil);
  };
  function blockAtY(e, dy) {
    var St = NS.States, W = NS.World;
    if (!St || !W) return 0;
    return St.block[W.getBlock(Math.floor(e.x), Math.floor(e.y + dy), Math.floor(e.z)) | 0] | 0;
  }
  /** `getVelocityAffectingPos` = y - 0.500001. */
  SS.onSoulBlock = function (e) { return SS.isSoulBlock(blockAtY(e, -0.500001)); };
  /** `getLandingBlockState` samples y - 0.2. */
  SS.landingIsAir = function (e) { return blockAtY(e, -0.2) === 0; };

  /** `EnchantmentHelper.getEquipmentLevel(SOUL_SPEED, e)`: the boots only. */
  SS.levelOf = function (e) {
    var Iv = NS.Inventory, Cb = NS.Combat;
    if (!e || !e.inventory || !e.inventory.slots || !Iv || !Cb || !Cb.enchantLevel) return 0;
    var st = e.inventory.slots[Iv.ARMOR_START + SS.FEET];
    return st && !Iv.isEmpty(st) ? Cb.enchantLevel(st, 'soul_speed') : 0;
  };
  SS.modifierFor = function (level) { return F(F(SS.BASE) * F(1 + F(level * F(SS.PER_LEVEL)))); };

  /** LivingEntity.getVelocityMultiplier: 1.0 when on a soul block with the enchantment. */
  SS.negatesSlowdown = function (e) { return SS.levelOf(e) > 0 && SS.onSoulBlock(e); };

  SS.remove = function (e) { if (e.soulSpeedMod) e.soulSpeedMod = 0; };
  SS.damageBoots = function (e) {
    var Iv = NS.Inventory, ES = NS.Effects;
    if (ES && ES.damageArmorPiece) ES.damageArmorPiece(e.inventory, Iv.ARMOR_START + SS.FEET, 1);
  };
  SS.addIfNeeded = function (e, rand) {
    if (SS.landingIsAir(e)) return;
    var lvl = SS.levelOf(e);
    if (lvl > 0 && SS.onSoulBlock(e)) {
      e.soulSpeedMod = SS.modifierFor(lvl);
      if (F((rand || Math.random)()) < F(SS.BOOT_WEAR_CHANCE)) SS.damageBoots(e);
    }
  };
  SS.shouldRemove = function (e) { return !SS.landingIsAir(e) || !!e.fallFlying || !!e.flying; };

  SS.effects = function (e, rand) {
    var r = rand || Math.random;
    if (NS.Particle && NS.Particle.spawn) {
      var w = e.width || 0.6;
      NS.Particle.spawn('soul', e.x + (r() - 0.5) * w, e.y + 0.1, e.z + (r() - 0.5) * w, e.vx * -0.2, 0.1, e.vz * -0.2);
    }
    var vol = F(F(r() * F(0.4)) + r()) > 0.9 ? 0.6 : 0;
    if (NS.Sound && NS.Sound.play) NS.Sound.play('particle.soul_escape', { volume: vol, pitch: 0.6 + r() * 0.4 });
  };

  /** Once per tick, from Survival.tick: the baseTick / fall / applyMovementEffects hooks, in that order. */
  SS.tick = function (e, rand) {
    if (!e || e.dead) return;
    var bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
    if (e.onGround && e.soulWasAir) { SS.remove(e); SS.addIfNeeded(e, rand); }   // LivingEntity.fall: landed after a fall
    e.soulWasAir = !e.onGround;
    var key = bx + ',' + by + ',' + bz;
    if (e.soulBlockKey !== key) {
      e.soulBlockKey = key;
      if (SS.shouldRemove(e)) SS.remove(e);
      SS.addIfNeeded(e, rand);
    }
    e.soulAge = (e.soulAge | 0) + 1;
    if (e.soulAge % 5 === 0 && e.vx !== 0 && e.vz !== 0 && !e.spectator && SS.levelOf(e) > 0 && SS.onSoulBlock(e)) SS.effects(e, rand);
  };
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
