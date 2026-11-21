// 07zn_mooshroom.js — QUEUE 0.2 (G18c, Breed.SPECIAL.mooshroom), session 101 orchestrator.
//
// MooshroomEntity (.decomp/net/minecraft/entity/passive/MooshroomEntity.java, read whole) and
// CowEntity.interactMob's bucket branch (the milk this engine never had, for cow AND mooshroom).
// Mooshroom extends CowEntity: same goals (Ai.ROSTER.mooshroom = Ai.ROSTER.cow, it declares no
// initGoals of its own), same attributes, breeding food (breeding TSV: inherit:bid).
//   TYPE      DataTracker string, default "red" (Type.field_18109 red / field_18110 brown).
//   SPAWN     canSpawn: block below in #mooshrooms_spawnable_on (BlockTags.field_35570) and
//             isLightLevelValidForNaturalSpawn (the animal > 8 rule).
//   LIGHTNING onStruckByLightning flips red<->brown once per lightning UUID.
//   BOWL      non-baby: a stored stew effect -> suspicious_stew carrying it (effect cleared),
//             else mushroom_stew; exchangeStack.
//   SHEARS    isShearable (alive, not baby): discard, a cow in its place with its health/yaw,
//             5 mushrooms of its type as item entities.
//   FLOWER    BROWN only, #small_flowers: if no stew effect stored, store the flower's
//             (FlowerBlock effectInStew/Duration — 02h_recipes' R.flowers table, the same one the
//             crafting recipe reads) and consume one (not in creative); if one is stored, nothing
//             but particles (still a SUCCESS — the flower is NOT consumed).
//   CHILD     chooseBabyType: same type parents + nextInt(1024)==0 -> the OTHER type; else
//             nextBoolean() ? this : other.
(function (NS) {
  'use strict';
  var Mo = NS.Mooshroom = {};

  Mo.MUTATION_CHANCE = 1024;     // MooshroomEntity.MUTATION_CHANCE
  Mo.SHEAR_DROPS = 5;            // sheared(): for ($$2 < 5)
  Mo.TYPES = ['red', 'brown'];

  Mo.OWED = [];

  /** Sounds/particles of each branch, recorded in Mo.fx.log (the check reads it) and played. */
  Mo.fx = { log: [] };
  Mo.sound = function (e, ev, vol) {
    Mo.fx.log.push({ sound: ev, volume: vol });
    var S = NS.Sound;
    var P = NS.Player;
    // CowEntity.interactMob: player.playSound(entity.cow.milk) -- player category, at the player
    if (ev === 'entity.cow.milk' && P && S && S.play) S.play(ev, { x: P.x, y: P.y, z: P.z, volume: vol, pitch: 1, source: 'player' });
    // MooshroomEntity.interactMob -> sheared(SoundCategory.PLAYERS) -> playSoundFromEntity(null, this, SHEAR, PLAYERS)
    else if (S && S.entitySound) S.entitySound(ev, e.x, e.y, e.z, vol, 1, ev === 'entity.mooshroom.shear' ? 'player' : 'neutral', P);
  };
  Mo.particles = function (e, kind, n, rand) {
    var r = rand || Math.random, Px = NS.Particle;
    for (var i = 0; i < n; i++) {
      var y = e.y + (e.height || 1.4) * 0.5;
      Mo.fx.log.push({ particle: kind });
      if (kind === 'explosion') {   // spawnParticles(EXPLOSION, x, getBodyY(0.5), z, 1, 0,0,0,0)
        if (Px && Px.spawn) Px.spawn('explosion', e.x, y, e.z, 0, 0, 0, r);
        continue;
      }
      var px = e.x + r() / 2, pz = e.z + r() / 2, vy = r() / 5;
      if (kind === 'smoke' && Px && Px.spawn) Px.spawn('smoke', px, y, pz, 0, vy, 0, r);
    }
  };

  Mo.typeOf = function (e) { return (e && e.mooshroomType === 'brown') ? 'brown' : 'red'; };

  Mo.spawnInit = function (e) { if (e.mooshroomType === undefined) e.mooshroomType = 'red'; };

  Mo.onLightning = function (e, boltId) {
    if (!e || e.type !== 'mooshroom') return false;
    if (e.lightningId === boltId) return false;
    e.mooshroomType = Mo.typeOf(e) === 'red' ? 'brown' : 'red';
    e.lightningId = boltId;
    Mo.sound(e, 'entity.mooshroom.convert', 2);
    return true;
  };

  Mo.chooseBabyType = function (a, b, rand) {
    var ta = Mo.typeOf(a), tb = Mo.typeOf(b);
    if (ta === tb && Math.floor(rand() * Mo.MUTATION_CHANCE) === 0) return ta === 'brown' ? 'red' : 'brown';
    return rand() < 0.5 ? ta : tb;
  };

  /** The whole interactMob dispatch for a held item on a cow/mooshroom. Returns null (fall
   *  through to super / Br.interact) or { swapTo, consume, damage, drops, replaceWith }. */
  Mo.interact = function (e, itemName, opts) {
    opts = opts || {};
    if (!e || (e.type !== 'cow' && e.type !== 'mooshroom') || e.dead) return null;
    if (e.type === 'mooshroom') {
      if (itemName === 'bowl' && !e.isBaby) {
        if (e.stewEffect) {
          var eff = e.stewEffect; e.stewEffect = null; Mo.sound(e, 'entity.mooshroom.suspicious_milk', 1);
          return { swapTo: 'suspicious_stew', tag: { Effects: [{ EffectId: eff.id, EffectDuration: eff.ticks }] } };
        }
        Mo.sound(e, 'entity.mooshroom.milk', 1);
        return { swapTo: 'mushroom_stew' };
      }
      if (itemName === 'shears' && !e.isBaby) return Mo.shear(e);
      if (Mo.typeOf(e) === 'brown' && Mo.isSmallFlower(itemName)) {
        if (e.stewEffect) { Mo.particles(e, 'smoke', 2); return { particlesOnly: true }; }
        var f = Mo.flowerEffect(itemName);
        if (!f) return null;
        e.stewEffect = { id: f.id, ticks: f.ticks };
        Mo.particles(e, 'effect', 4);
        Mo.sound(e, 'entity.mooshroom.eat', 2);
        return { consume: 1 };
      }
    }
    // CowEntity.interactMob: a bucket on a non-baby cow (mooshroom inherits it) -> milk
    if (itemName === 'bucket' && !e.isBaby) { Mo.sound(e, 'entity.cow.milk', 1); return { swapTo: 'milk_bucket' }; }
    return null;
  };

  Mo.isSmallFlower = function (itemName) {
    var T = NS.Tags;
    if (T && T.itemIn) { try { return !!T.itemIn('small_flowers', itemName); } catch (err) {} }
    return !!Mo.flowerEffect(itemName);
  };
  Mo.flowerEffect = function (itemName) {
    var R = NS.Recipes;
    return (R && R.flowers && R.flowers[itemName]) || null;
  };

  /** sheared(): the mooshroom is replaced by a cow at its place/health/yaw, 5 mushrooms drop. */
  Mo.shear = function (e) {
    if (!e || e.type !== 'mooshroom' || e.dead || e.isBaby) return null;
    var mush = Mo.typeOf(e) + '_mushroom';
    Mo.sound(e, 'entity.mooshroom.shear', 1);   // playSoundFromEntity, before the isClient test
    Mo.particles(e, 'explosion', 1);
    return { damage: 1, replaceWith: 'cow', drops: [{ item: mush, count: 1, times: Mo.SHEAR_DROPS }] };
  };

  /** Apply a replaceWith result: discard the mooshroom, spawn a cow carrying its health/yaw/
   *  name/persistence, then the drops. Kept here so the check can drive the exact live path. */
  Mo.applyShear = function (e, res) {
    var EL = NS.EntityList;
    if (!EL || !EL.spawn) return null;
    var cow = EL.spawn(res.replaceWith, e.x, e.y, e.z);
    if (cow) {
      cow.health = e.health; cow.yaw = e.yaw; cow.bodyYaw = e.bodyYaw; cow.pitch = e.pitch;
      if (e.customName) cow.customName = e.customName;
      if (e.customNameVisible) cow.customNameVisible = true;   // sheared(): setCustomNameVisible(isCustomNameVisible())
      if (e.persistent) cow.persistent = true;
      if (e.invulnerable) cow.invulnerable = true;
    }
    if (EL.remove) EL.remove(e); else e.removed = true;
    for (var i = 0; i < res.drops.length; i++) {
      var d = res.drops[i];
      for (var k = 0; k < d.times; k++) if (EL.dropStack) EL.dropStack(e.x, e.y + (e.height || 1.4), e.z, d.item, d.count, { pickupDelay: 0 });
    }
    return cow;
  };

  Mo.ready = true;
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
