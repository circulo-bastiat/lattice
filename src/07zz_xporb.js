// 07zz_xporb.js — G21: EXPERIENCE ORBS. `ExperienceOrbEntity` (.decomp/net/minecraft/entity/
// ExperienceOrbEntity.java, read whole this pass), the substrate G18's own OWED lists have been
// waiting on: `Br.OWED`'s "experience orb pickup" (07m_breed.js), `Passive.OWED`'s chicken/spider
// jockey xp (07w_passive.js), and `Cb.OWED`'s "experience on death" (14j_combat.js). `ER.OWED`'s
// own "experience_orb — G21" (07j_entityrender.js) is CLOSED this pass too — see
// `Xp.orbIconIndex` below and `ER.renderOrbs` in that file.
//
// ⚠ THE PLAYER'S OWN XP STATE ALREADY EXISTS. `14d_survival.js`'s `Sv.addXp`/`Sv.syncXp`/
// `Sv.xpNeeded`/`Sv.totalXpFor` (the level/progress/total triple, the save round-trip
// (`Sv.SAVE_FIELDS`, D-... its own clamp table) and the `/xp` command, 15g_commands.js) were
// built ahead of this unit and never had an orb to feed them — this file is that feed, not a
// second copy of that state. The HUD bar (`H.drawSurvival`, 15_hud.js) already reads
// `P.xpProgress`/`P.xpLevel` too. loop/xporbsprite (G21) closed the ONE thing this file used
// to leave untouched — the orb is now actually drawn — but the draw pass itself lives in
// `07j_entityrender.js`'s own `ER.renderOrbs` (its own self-contained billboard pipeline, the
// same shape 07zx_particle.js/07u_leash.js already use); this file's only contribution to it
// is `Xp.orbIconIndex`, the size->sprite lookup, right below.
//
// This module owns: `EL.spawn('experience_orb', ...)`'s VALUE (the split into vanilla's own
// orb sizes, merge-on-spawn), the orb's own per-tick state beyond the generic gravity/drag/
// bounce `EL.tickOne` ALREADY drives for it (07i_entitylist.js's own `EL.damp` header names
// `experience_orb` next to `item` in the "block" ground law, and `EL.motionFor`/`EL.groundFor`
// already carry its `[0.03, 0.98]` motion pair and `b:-0.9` bounce off `19_data.gen.js` — this
// file does not re-derive either), the nearest-player follow + merge (`expensiveUpdate`, run
// every 20 ticks same as vanilla), the 6000-tick despawn, mob-death/breeding/trade xp AMOUNTS,
// and the player's own pickup box.
(function (NS) {
  'use strict';
  var Xp = NS.Xp = NS.Xp || {};
  Xp.ready = false;

  Xp.OWED = [
    // G21 closed 'LivingEntity.playerHitTimer's own 100-tick decay': Cb.notePlayerHit/tickPlayerHit.
  ];

  Xp.init = function () {
    Xp.ready = !!(NS.EntityList && NS.EntityList.ready && NS.Entities && NS.Entities.ready);
    return Xp;
  };

  // ── mob-death xp amount ──────────────────────────────────────────────────────────────────
  /**
   * `MobEntity.experiencePoints`'s own per-species constructor literal (.decomp, one file per
   * mob, every entry cited at its own line): the BASE this engine's rostered hostiles carry
   * before `MobEntity.getXpToDrop`'s armour/hand bonus or `ZombieEntity`'s baby doubling. Every
   * mob not listed here is 0 — `MobEntity.experiencePoints` has no field initialiser, so a
   * plain animal (cow, sheep, wolf...) drops nothing on death, which is vanilla's own behaviour,
   * not a gap (`Passive.OWED` names the ONE animal-side exception this covers: chicken/spider
   * jockey xp, below).
   */
  Xp.BASE = {
    // `HostileEntity` (.decomp:29): `this.experiencePoints = 5`, inherited unless overridden --
    // covers every one of these; `ZombieEntity`/`AbstractSkeletonEntity`/`RaiderEntity`/
    // `IllagerEntity`/`PatrolEntity` (all read whole this pass) override neither the field nor
    // `getXpToDrop` except where named below.
    zombie: 5, husk: 5, drowned: 5, zombie_villager: 5, zombified_piglin: 5,
    skeleton: 5, stray: 5, wither_skeleton: 5,
    spider: 5, cave_spider: 5, creeper: 5, enderman: 5,
    witch: 5, vindicator: 5, pillager: 5, illusioner: 5,
    evoker: 10,     // EvokerEntity.java:44
    ravager: 20,    // RavagerEntity.java:63
    vex: 3,         // VexEntity.java:54
    piglin: 5,      // PiglinEntity.java:123
    piglin_brute: 20,  // PiglinBruteEntity.java:62
    hoglin: 5,      // HoglinEntity constructor (onGrowUp: baby 3, e.experiencePoints)
    zoglin: 5,      // ZoglinEntity constructor
    // KW-34 (s136, referee reds, .infra/infra-20260925T0030Z.md finding 3): `HostileEntity`'s own
    // field initialiser again, read whole -- silverfish/endermite/phantom were simply missing
    // from this table (0 by the `|| 0` fallback), not a 0 vanilla ever gives.
    silverfish: 5,  // HostileEntity.java:29 (silverfish overrides nothing)
    endermite: 3,   // EndermiteEntity.java:37
    phantom: 5,     // PhantomEntity.java:51
    shulker: 5,     // ShulkerEntity constructor `experiencePoints = 5` (extends GolemEntity, #1346)
    blaze: 10,      // BlazeEntity.java:39
    ghast: 5,       // GhastEntity constructor `experiencePoints = 5` (real server: 5, mob-xp golden)
    guardian: 10,   // GuardianEntity constructor `experiencePoints = 10` (real server: 10)
    elder_guardian: 10,   // extends GuardianEntity (real server: 10)
    giant: 5        // GiantEntity overrides neither the field nor getXpToDrop (#916): HostileEntity.java:29
  };
  /**
   * `AnimalEntity.getXpToDrop`/`WaterCreatureEntity.getXpToDrop` (.decomp, both verbatim
   * `1 + random.nextInt(3)`), the closed set of this engine's rostered types that inherit ONE
   * of those two methods UNOVERRIDDEN (checked file-by-file against every AnimalEntity/
   * WaterCreatureEntity descendant in `.decomp`; the classes that DO override it -- ChickenEntity
   * (jockey special-case, handled below), HoglinEntity (its own `e.experiencePoints`, set at
   * spawn by `07zzg_hoglin.js`) and the HostileEntity-family types in `Xp.BASE` above -- are
   * deliberately absent). KW-34 finding 1: this table did not exist at all and every one of
   * these dropped 0, which `07zz_xporb.js`'s own old comment called "vanilla's own behaviour" --
   * it was not.
   */
  Xp.ANIMAL_XP = {
    // AnimalEntity direct/near descendants (passive/*.java, `extends AnimalEntity` closure):
    cow: 1, mooshroom: 1, sheep: 1, pig: 1, chicken: 1, rabbit: 1, fox: 1, bee: 1, goat: 1,
    turtle: 1, polar_bear: 1, ocelot: 1, panda: 1, axolotl: 1, strider: 1,
    // TameableEntity -> AnimalEntity (wolf/cat), TameableShoulderEntity -> TameableEntity (parrot):
    wolf: 1, cat: 1, parrot: 1,
    // HorseBaseEntity -> AnimalEntity (horse/skeleton_horse/zombie_horse), AbstractDonkeyEntity
    // -> HorseBaseEntity (donkey/mule/llama), LlamaEntity (trader_llama):
    horse: 1, skeleton_horse: 1, zombie_horse: 1, donkey: 1, mule: 1, llama: 1, trader_llama: 1,
    // WaterCreatureEntity direct/near descendants: SquidEntity (squid, GlowSquidEntity ->
    // glow_squid), DolphinEntity (dolphin), FishEntity/SchoolingFishEntity (cod/salmon/
    // tropical_fish), PufferfishEntity -> FishEntity (pufferfish):
    squid: 1, glow_squid: 1, dolphin: 1, cod: 1, salmon: 1, tropical_fish: 1, pufferfish: 1
  };
  /**
   * `ZombieEntity.getXpToDrop` (.decomp:165-171): `if (isBaby()) experiencePoints *= 2.5`, the
   * ONE override any rostered hostile here carries — every zombie-family type shares it
   * (`husk`/`drowned`/`ZombieVillagerEntity`/`ZombifiedPiglinEntity` all extend `ZombieEntity`
   * and override neither method). `AbstractSkeletonEntity` (skeleton/stray/wither_skeleton) has
   * no such override, so a baby skeleton (this engine has none to spawn, but the table stays
   * honest) would not double.
   */
  Xp.NO_EQUIP_BONUS = { piglin: 1, hoglin: 1 };   // s134: HoglinEntity.getXpToDrop returns the field
  Xp.ZOMBIE_FAMILY = { zombie: 1, husk: 1, drowned: 1, zombie_villager: 1, zombified_piglin: 1 };

  /**
   * `MobEntity.getXpToDrop(PlayerEntity)` (.decomp:267-286), verbatim: the base amount (read off
   * `e.experiencePoints` when another module already set it — `Sl.setSize`'s own
   * `e.experiencePoints = size`, 07zd_slime.js — else `Xp.BASE`), the baby-zombie 2.5x, then
   * `1 + random.nextInt(3)` for every ARMOUR (feet/legs/chest/head) and HAND (main/off) slot
   * the mob was actually wearing at a drop chance `<= 1.0F` — the SAME six slots
   * `Eq.dropEquipment` rolls the ITEM drop for (07y_equip.js), read here as a SEPARATE bonus,
   * not a second draw of that roll.
   */
  Xp.xpToDrop = function (e, rand) {
    var r = rand || NS.wrand;
    if (!e || !e.type) return 0;
    var Ent = NS.Entities;
    var bare = Ent && Ent.bare ? Ent.bare(e.type) : e.type;
    // `ChickenEntity.getXpToDrop` (.decomp:142-144): `hasJockey() ? 10 : super.getXpToDrop()` --
    // the ONE non-hostile override this table carries (Passive.setChickenJockey, 07w_passive.js,
    // struck this line off Passive.OWED). A plain chicken falls through to Xp.BASE's own 0.
    var hgBaby = bare === 'hoglin' && NS.Breed && NS.Breed.isBaby && NS.Breed.isBaby(e);   // growAge may be set directly
    var base = hgBaby ? 3 : (bare === 'chicken' && e.hasJockey) ? 10
      : (e.experiencePoints !== undefined) ? e.experiencePoints
      : (Xp.BASE[bare] || (Xp.ANIMAL_XP[bare] ? 1 + (r() * 3 | 0) : 0));
    if (base <= 0) return 0;
    var baby = NS.Breed && NS.Breed.isBaby ? NS.Breed.isBaby(e) : false;
    if (Xp.ZOMBIE_FAMILY[bare] && baby) base = Math.floor(base * 2.5);
    var IT = NS.Items, Eq = NS.Equip;
    // s133: `PiglinEntity.getXpToDrop` (.decomp:312-314) returns the bare field -- no equipment bonus.
    if (Xp.NO_EQUIP_BONUS[bare]) return base;
    if (IT && Eq && Eq.ready && e.equip) {
      var slots = [IT.FEET, IT.LEGS, IT.CHEST, IT.HEAD, IT.MAINHAND, IT.OFFHAND];
      for (var i = 0; i < slots.length; i++) {
        var st = Eq.getEquipped(e, slots[i]);
        if (st && Eq.dropChance(e, slots[i]) <= 1.0) base += 1 + (r() * 3 | 0);
      }
    }
    return base;
  };

  /**
   * `LivingEntity.dropXp` (.decomp:1350-1355): a SERVER-only spawn, gated on
   * `shouldAlwaysDropXp() || (playerHitTimer > 0 && shouldDropXp() && doMobLoot)`. No rostered
   * mob here overrides `shouldAlwaysDropXp` (false, LivingEntity's own default), so only the
   * player-hit branch ever fires; `shouldDropXp` is `!isBaby()` (.decomp:576-578, unconditional
   * gate, independent of the zombie-family DOUBLING above, which only scales the amount).
   * `playerHitTimer` is the real 100-tick timer `Cb.notePlayerHit`/`Cb.tickPlayerHit` keep (14j_combat.js).
   */
  Xp.dropMobXp = function (e, rand) {
    if (!Xp.ready) return null;
    var EL = NS.EntityList;
    if (!EL || !EL.ready || !e || !e.type) return null;
    var Ent = NS.Entities;
    var bare = Ent && Ent.bare ? Ent.bare(e.type) : e.type;
    var baby = NS.Breed && NS.Breed.isBaby ? NS.Breed.isBaby(e) : false;
    // KW-34 (s136) finding 2 -- `HostileEntity.shouldDropXp` (.decomp mob/HostileEntity.java:
    // 110-112) returns TRUE UNCONDITIONALLY, overriding `LivingEntity.shouldDropXp`'s own
    // `!isBaby()` default; every rostered HostileEntity family this engine can spawn as a baby
    // (zombie family, piglin, hoglin, zoglin -- `Xp.BASE`'s own keys) drops xp whether or not it
    // is a baby (the amount, scaled or not, is `Xp.xpToDrop`'s job above). `AnimalEntity` never
    // overrides `shouldDropXp`, so a baby animal still correctly drops nothing -- the gate below
    // only fires for a baby OUTSIDE the HostileEntity set.
    if (baby && !Xp.BASE.hasOwnProperty(bare)) return null;   // shouldDropXp()
    if (!(NS.Combat && NS.Combat.recentlyHitByPlayer(e))) return null;   // playerHitTimer > 0 (Cb.tickPlayerHit decays it)
    var loot = NS.Breed && NS.Breed.mobLoot ? NS.Breed.mobLoot() : true;   // doMobLoot gate
    if (!loot) return null;
    var amount = Xp.xpToDrop(e, rand);
    if (!(amount > 0)) return null;
    return Xp.spawn(e.x, e.y, e.z, amount, rand);
  };

  // ── the orb entity itself: split, spawn-merge, physics, follow, pickup, despawn ──────────
  /**
   * `ExperienceOrbEntity.roundToOrbSize`/`ExperienceOrbEntity.spawn` (.decomp:277-297,131-137):
   * a requested total is handed out as the largest orb SIZE that fits, repeatedly, rather than
   * as one orb carrying the whole value — the ladder vanilla's own `getOrbSize` (.decomp:249-
   * 275) draws its icon frame off, unchanged here.
   */
  Xp.roundToOrbSize = function (v) {
    if (v >= 2477) return 2477;
    if (v >= 1237) return 1237;
    if (v >= 617) return 617;
    if (v >= 307) return 307;
    if (v >= 149) return 149;
    if (v >= 73) return 73;
    if (v >= 37) return 37;
    if (v >= 17) return 17;
    if (v >= 7) return 7;
    return v >= 3 ? 3 : 1;
  };

  /**
   * `ExperienceOrbEntity.getOrbSize()` (.decomp:254-275) — the SAME value ladder
   * `Xp.roundToOrbSize` reads above, just returned as the 0..10 ICON INDEX
   * `ExperienceOrbEntityRenderer.method_3966` (.decomp/net/minecraft/client/render/entity/
   * ExperienceOrbEntityRenderer.java:31) crops its 4-column sprite sheet with, rather than the
   * rounded VALUE — a size-617 orb and a size-2477 orb round to different values but draw
   * different icons too, so the render side needs this, not `roundToOrbSize`, as its own
   * lookup (07j_entityrender.js's `ER.renderOrbs`, loop/xporbsprite, G21).
   */
  Xp.orbIconIndex = function (v) {
    if (v >= 2477) return 10;
    if (v >= 1237) return 9;
    if (v >= 617) return 8;
    if (v >= 307) return 7;
    if (v >= 149) return 6;
    if (v >= 73) return 5;
    if (v >= 37) return 4;
    if (v >= 17) return 3;
    if (v >= 7) return 2;
    return v >= 3 ? 1 : 0;
  };

  Xp.DESPAWN_AGE = 6000;        // ExperienceOrbEntity.DESPAWN_AGE, .decomp:23
  Xp.FOLLOW_RANGE = 8;          // field_30057, .decomp:24 (getClosestPlayer/target pull radius)
  Xp.FOLLOW_RANGE_SQ = 64;
  Xp.PICKUP_DELAY_TICKS = 2;    // onPlayerCollision's own `experiencePickUpDelay = 2`, .decomp:222
  Xp.SPAWN_MERGE_BOX = 0.5;     // wasMergedIntoExistingOrb's `Box.of($$1, 1.0, 1.0, 1.0)` half-extent
  Xp.MERGE_BOX = 0.5;           // expensiveUpdate's `getBoundingBox().expand(0.5)`

  /**
   * `ExperienceOrbEntity.spawn(ServerWorld, Vec3d, int)` (.decomp:131-137): splits `total` into
   * orb-sized chunks and, for each, either folds it into an existing SAME-VALUE orb already
   * sitting within a block (`wasMergedIntoExistingOrb`, simplified per `Xp.OWED`'s own line on
   * the id-window throttle this drops) or spawns a fresh one with vanilla's own random spread
   * velocity (`ExperienceOrbEntity`'s 4-arg constructor, .decomp:33-38).
   */
  Xp.spawn = function (x, y, z, total, rand) {
    if (!Xp.ready) return [];
    var EL = NS.EntityList, r = rand || NS.wrand;
    var out = [];
    total = total | 0;
    while (total > 0) {
      var amt = Xp.roundToOrbSize(total);
      total -= amt;
      var into = null, B = Xp.SPAWN_MERGE_BOX, seed = (r() * 40) | 0;   // isMergeable's `(getId() - seed) % 40 == 0`, .decomp:149
      if (EL.list) {
        for (var i = 0; i < EL.list.length; i++) {
          var o = EL.list[i];
          if (o.removed || o.type !== 'experience_orb' || o.value !== amt || ((o.id - seed) % 40) !== 0) continue;
          if (Math.abs(o.x - x) > B || Math.abs(o.y - y) > B || Math.abs(o.z - z) > B) continue;
          into = o; break;
        }
      }
      if (into) { into.pickingCount = (into.pickingCount || 1) + 1; into.orbAge = 0; continue; }
      var e = EL.spawn('experience_orb', x, y, z, {
        vx: (r() * 0.2 - 0.1) * 2,
        vy: r() * 0.2 * 2,
        vz: (r() * 0.2 - 0.1) * 2
      });
      if (!e) continue;
      e.value = amt;
      e.pickingCount = 1;
      e.orbAge = 0;
      out.push(e);
    }
    return out;
  };

  /**
   * `expensiveUpdate` (.decomp:118-129), run every 20 ticks off `EL.tickOne`'s own `age % 20`
   * idiom (`ExperienceOrbEntity.tick`, `this.age % 20 == 1`, .decomp:79): re-acquire the nearest
   * player within `FOLLOW_RANGE` and fold in any mergeable orb sitting within `MERGE_BOX`.
   */
  Xp.expensiveUpdate = function (e) {
    var P = NS.Player;
    if (P && !P.dead) {
      var dx = P.x - e.x, dy = P.y - e.y, dz = P.z - e.z;
      e.xpTarget = (dx * dx + dy * dy + dz * dz) <= Xp.FOLLOW_RANGE_SQ;
    } else {
      e.xpTarget = false;
    }
    Xp.mergeNear(e);
  };

  Xp.mergeNear = function (e) {
    var EL = NS.EntityList;
    if (!EL || !EL.list || e.removed) return 0;
    var merged = 0, B = Xp.MERGE_BOX;
    for (var i = 0; i < EL.list.length; i++) {
      var o = EL.list[i];
      if (o === e || o.removed || o.type !== 'experience_orb' || o.value !== e.value || ((o.id - e.id) % 40) !== 0) continue;   // isMergeable, .decomp:149-151
      // getBoundingBox().expand(0.5) intersects the other orb's box (strict): centres closer than B + width, in y B + height
      var W = (e.width || 0.5) * 0.5 + (o.width || 0.5) * 0.5 + B, H = e.height || 0.5;
      if (Math.abs(o.x - e.x) >= W || Math.abs(o.z - e.z) >= W || o.y >= e.y + H + B || o.y + (o.height || 0.5) <= e.y - B) continue;
      e.pickingCount = (e.pickingCount || 1) + (o.pickingCount || 1);
      e.orbAge = Math.min(e.orbAge || 0, o.orbAge || 0);   // merge(), .decomp:150-154
      EL.remove(o);
      merged++;
    }
    return merged;
  };

  /**
   * One orb's own tick, ON TOP of the generic gravity/drag/ground-bounce `EL.tickOne` already
   * runs for it (07i_entitylist.js's `EL.damp` header, which already names `experience_orb`
   * alongside `item` in the "block" ground law read off `19_data.gen.js`). This is only the
   * THREE THINGS that law does not cover: the 20-tick target/merge refresh, the per-tick pull
   * toward an acquired target (`tick`'s own `if (this.target != null)` block, .decomp:85-95,
   * added to velocity BEFORE `EL.tickOne`'s own `Ph.move`/`EL.damp` run this same tick — called
   * from the SAME dispatch slot `EL.tickItem` occupies, before the generic motion below it), and
   * the 6000-tick despawn.
   */
  Xp.tick = function (e) {
    e.orbAge = (e.orbAge || 0) + 1;
    if (e.orbAge >= Xp.DESPAWN_AGE) NS.EntityList.remove(e);
  };

  /** `ExperienceOrbEntity.tick` :79-98, run BEFORE the move (`EL.tickOne`): the 20-tick re-target
   *  (vanilla's `age` is already incremented here, hence orbAge + 1) and the pull on the velocity. */
  Xp.pull = function (e) {
    if (((e.orbAge || 0) + 1) % 20 === 1) Xp.expensiveUpdate(e);
    if (e.xpTarget) {
      var P = NS.Player;
      if (!P || P.dead) { e.xpTarget = false; return; }
      var eye = P.y + (P.eyeHeight || P.EYE || 1.62) * 0.5;
      var dx = P.x - e.x, dy = eye - e.y, dz = P.z - e.z;
      var d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < Xp.FOLLOW_RANGE_SQ) {
        var d = Math.sqrt(d2) || 1;
        var scale = 1 - d / Xp.FOLLOW_RANGE;
        var f = scale * scale * 0.1;
        e.vx += (dx / d) * f;
        e.vy += (dy / d) * f;
        e.vz += (dz / d) * f;
      }
    }
  };

  /**
   * `PlayerEntity.experiencePickUpDelay`/`ExperienceOrbEntity.onPlayerCollision` (.decomp:222-
   * 226,220-235): the SAME inflated box `P.pickupItems` already sweeps for items
   * (`P.PICKUP_INFLATE`, 14_player.js), gated by a counter that decrements once a tick and is
   * reset to 2 the instant an orb is taken — which, because this loop breaks after the first
   * match, reproduces vanilla's own quirk of never picking up two DIFFERENT orb entities inside
   * the same tick even when both are touched.
   */
  /**
   * `ExperienceOrbEntity.repairPlayerGears` (.decomp:230-241): a random equipped (main hand, off
   * hand, four armour slots) DAMAGED stack holding Mending (`EnchantmentHelper.chooseEquipmentWith`)
   * is repaired by min(2 * orbAmount, damage); each repair costs repaired/2 of `xp`, and the
   * remainder recurses. Returns the xp left for the bar. Note vanilla repairs from the ORB's own
   * amount every round, not the remainder.
   */
  Xp.repairPlayerGears = function (P, xp, orbAmount) {
    var Iv = NS.Inventory, Cb = NS.Combat;
    if (!Iv || !Cb || !Cb.enchantLevel || !P || !P.inventory) return xp;
    while (xp > 0) {
      var inv = P.inventory, idx = [P.slot != null ? P.slot : inv.selected, Iv.OFFHAND,
        Iv.ARMOR_START, Iv.ARMOR_START + 1, Iv.ARMOR_START + 2, Iv.ARMOR_START + 3], cand = [];
      for (var i = 0; i < idx.length; i++) {
        var st = Iv.getItem(inv, idx[i]);
        if (!Iv.isEmpty(st) && st.d > 0 && Cb.enchantLevel(st, 'mending') > 0) cand.push(st);
      }
      if (!cand.length) return xp;
      var it = cand[NS.wrand() * cand.length | 0];
      var fix = Math.min(orbAmount * 2, it.d);
      it.d -= fix;
      xp -= (fix / 2) | 0;
    }
    return 0;
  };

  Xp.pickupTick = function () {
    var P = NS.Player, EL = NS.EntityList, Sv = NS.Survival;
    if (!P || !EL || !EL.ready || !Sv || !Sv.addXp) return 0;
    if (P.xpPickupDelay > 0) P.xpPickupDelay--;   // PlayerEntity.tickMovement counts down first, then the collisions test == 0
    if (P.xpPickupDelay > 0) return 0;
    var IN = P.PICKUP_INFLATE || [1.0, 0.5, 1.0];
    var hw = P.width * 0.5;
    var x0 = P.x - hw - IN[0], x1 = P.x + hw + IN[0];
    var y0 = P.y - IN[1], y1 = P.y + P.height + IN[1];
    var z0 = P.z - hw - IN[2], z1 = P.z + hw + IN[2];
    var list = EL.list;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.removed || e.type !== 'experience_orb') continue;
      var ehw = e.width * 0.5;
      if (e.x + ehw < x0 || e.x - ehw > x1) continue;
      if (e.y + e.height < y0 || e.y > y1) continue;
      if (e.z + ehw < z0 || e.z - ehw > z1) continue;
      P.xpPickupDelay = Xp.PICKUP_DELAY_TICKS;
      // onPlayerCollision: ENTITY_EXPERIENCE_ORB_PICKUP, PLAYERS, 0.1F, 0.5F + random.nextFloat() * 0.7F
      if (NS.Sound && NS.Sound.play) NS.Sound.play('entity.experience_orb.pickup', { x: e.x, y: e.y, z: e.z, source: 'player', volume: 0.1, pitch: 0.5 + NS.wrand() * 0.7 });
      var amount = e.value || 0;
      var left = Xp.repairPlayerGears(P, amount, amount);
      if (left > 0) Sv.addXp(P, left);
      e.pickingCount = (e.pickingCount || 1) - 1;
      if (e.pickingCount <= 0) EL.remove(e);
      return amount;
    }
    return 0;
  };

})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
