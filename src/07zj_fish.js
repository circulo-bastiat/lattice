// 07zj_fish.js — loop/fish-s99, QUEUE 0.2 G18c: the COD + SALMON + PUFFERFISH + TROPICAL FISH,
// whole. Runs on: MAIN THREAD ONLY. No DOM.
//
// .decomp/net/minecraft/entity/passive/FishEntity.java (222 lines), SchoolingFishEntity.java
// (121 lines), CodEntity.java (40), SalmonEntity.java (45), PufferfishEntity.java (223) and
// TropicalFishEntity.java (306) — ALL SIX read whole this session; every citation below names
// one of them unless a third .decomp file is named explicitly. Class hierarchy: FishEntity ->
// {PufferfishEntity, SchoolingFishEntity -> {CodEntity, SalmonEntity, TropicalFishEntity}}.
//
// #603: the goals (EscapeDanger 0, FleeEntity 2, SwimToRandomPlace 4, FollowGroupLeader 5) now run through a real
// `Ai.GoalSelector` (`Fish.buildGoals`, e.fishGoals) with `Fish.moveControlTick` = FishMoveControl; only the water A*
// is substituted (straight line to the target node). The paragraph below is the PRE-#603 history.
// ⚠⚠ NAVIGATION/GOAL-SELECTOR SUBSTITUTION — same standing shape `07zi_squid.js`'s own header
// already establishes for `SwimGoal`/`EscapeAttackerGoal` (neither of THOSE is in `.decomp`
// either — `SwimAroundGoal`/`FleeEntityGoal`/`EscapeDangerGoal`/`FollowGroupLeaderGoal`'s own
// source files are not present in this worktree's `.decomp` at all, only the six entity classes
// above are). This engine also has no `SwimNavigation`/pathfinding substrate for water at all
// (`Ai.WaterAvoidingRandomStrollGoal` steers a LAND mob's `e.zza`/`e.yaw` through `Ph.travelMob`,
// which a fish never runs — see `Fish.travelMob` below). `Fish.wanderTick`/`fleeTick`/
// `dangerTick`/`schoolTick` below are therefore hand-written the SAME way `Sq.swimGoalTick`/
// `escapeTick` are: a periodically-rerolled TARGET POINT plus `FishEntity.FishMoveControl`'s
// own steering arithmetic (.decomp, read verbatim below in `Fish.steerToward`) applied directly
// to `e.vx/vy/vz`, in DECREASING goal-priority order so a later call's target overwrites an
// earlier one's, the identical "goal N overwrites goal M" effect a real flag-arbitrated
// `GoalSelector` produces for goals that all claim `Ai.MOVE` — never wired through
// `Ai.GoalSelector`/`Ai.ROSTER` at all (no entry there for any of the four types below).
//
// WHAT IS A REAL PORT, WHAT IS NAMED, ON `Fish.OWED` BELOW —
//   * `Fish.tickAir` — `WaterCreatureEntity.tickWaterBreathingAir`/`baseTick` verbatim, the
//     SAME 300/-20/2.0 numbers `Sq.tickAir` (07zi_squid.js) already cites off the identical
//     shared superclass (`FishEntity extends WaterCreatureEntity` too).
//   * `Fish.tickMovementFlop` — `FishEntity.tickMovement()` verbatim: the flop-on-land impulse
//     (`!isTouchingWater && onGround && verticalCollision`) shared by all four types.
//   * `Fish.travelMob` — `FishEntity.travel(Vec3d)` verbatim in the water branch
//     (`updateVelocity(0.01F, input)` + `move` + `*0.9` + the no-target `-0.005` sink); the
//     `else` branch is `super.travel($$0)` — plain `LivingEntity`/`MobEntity` ground travel,
//     which is exactly `Ph.travelMob(e)` (14b_physics.js), reused rather than re-derived, the
//     same "delegate to the generic path when nothing overrides it" `Sq.travelMob`'s own OWN
//     inert-motion row leaves for the standard pipeline to run.
//   * `Fish.canSpawn` — `WaterCreatureEntity.canSpawn` verbatim, the SAME body `Sq.canSpawn`
//     already ports (both classes share it unmodified — cod/salmon/pufferfish, and
//     `TropicalFishEntity` does NOT override it either, only adds `canTropicalFishSpawn` as a
//     SEPARATE static predicate `Spawn.RULES.tropical_fish` calls instead of this one).
//   * `Fish.tropicalCanSpawn` — `TropicalFishEntity.canTropicalFishSpawn` verbatim, including
//     its own literal redundancy: `fluidBelow==WATER && aboveIsSand && (warmOcean ||
//     WaterCreatureEntity.canSpawn(...))` — the OR's right branch requires the block ABOVE to
//     be water, which the preceding `aboveIsSand` AND already rules out on the SAME position,
//     so in practice only `warmOcean` ever lets a tropical fish through when the sand test
//     passes. Ported as the jar has it, not "corrected".
//   * `Fish.PUFF_*`/`Fish.puffTick`/`Fish.stingNearby` — `PufferfishEntity.tick`/
//     `tickMovement`/`sting`/`onPlayerCollision`/`InflateGoal` verbatim: the 0/1/2 state
//     machine (1 tick to SEMI at any inflate, 40 more to FULLY, 60/100-tick deflate backoff),
//     the `1+puffState` sting damage and `60*puffState`-tick POISON (`ES.addStatusEffect`,
//     07q_effects.js), and the box-scan trigger (`InflateGoal.canStart`'s own 2.0-block
//     expand, `sting`'s own 0.3-block expand) against any `LivingEntity` that is not itself
//     aquatic (`EntityGroup.AQUATIC` — squid/glow_squid/cod/salmon/pufferfish/tropical_fish,
//     the closed set `EL.canSpawn` already recognises) or a creative player.
//     `EntityType.field_28315` (the one exception the filter special-cases back IN even though
//     it IS aquatic) is UNMAPPED in `.decomp/names.tsv` — Yarn 1.18.2 never named it, and it is
//     axolotl-shaped by every 1.18-era community mapping this session did not re-derive from
//     bytecode; axolotl is spawnable (07zm_axolotl) and special-cased back in, so the
//     exception is dead code here regardless of which type it names.
//   * `Fish.chooseVariant`/`Fish.toVariant`/`Fish.getShape`/`Fish.getPattern`/
//     `Fish.getBaseDyeColorIndex`/`Fish.getPatternDyeColorIndex`/`Fish.COMMON_VARIANTS` —
//     `TropicalFishEntity`'s own `toVariant`/`getShape`/`getPattern`/`getBaseDyeColorIndex`/
//     `getPatternDyeColorIndex`/`COMMON_VARIANTS`/`initialize` verbatim: the packed
//     `shape | pattern<<8 | baseColour<<16 | patternColour<<24` int, the 22 predefined
//     ("common") variants (90% roll) vs. a fully random one (10%, `commonSpawn=false`), and the
//     `Variety` enum's own (shape,pattern) pairs / `DyeColor`'s own 0..15 ids, both read off
//     `.decomp/names.tsv`'s own `bts` (DyeColor)/this file's own `Variety` inner-enum listing —
//     NOT re-derived from a colour NAME guess.
//   * Attributes (MAX_HEALTH 3.0 for all four — `createFishAttributes`, `SalmonEntity`'s own
//     `getMaxGroupSize` override aside) and dimensions ([0.5,0.3]/[0.7,0.4]/[0.7,0.7]/[0.5,0.4])
//     need NO code here — `NS.Entities.attrsOf`/dimensions already carry them generically off
//     the SAME jar-bytecode extraction squid's own header names (`assets/entities.json`'s own
//     `attrs.cod/.salmon/.pufferfish/.tropical_fish` all read `hp:3`, verified this session).
//   * Loot (`entities/cod`: 1 cod, 15% raw enchanted; `entities/salmon`: 1 salmon, same;
//     `entities/pufferfish`: 1 pufferfish; `entities/tropical_fish`: 1 tropical_fish + a 5% random_chance bone_meal pool, all with
//     a looting-enchant bonus and a fire-cooks-cod/salmon rule) needs no code here either —
//     `tools/pack-loot.mjs`/`Cb.dropLoot` already handle every `loot_tables/entities/*.json`
//     generically, the identical squid-header precedent.
//
//   NOT HERE, NAMED ON `Fish.OWED` RATHER THAN GUESSED OR SILENTLY DROPPED —
//   - `FishEntity.FishMoveControl`/`SwimToRandomPlaceGoal`/`SchoolingFishEntity.
//     FollowGroupLeaderGoal`/`PufferfishEntity.InflateGoal` as literal per-instance control
//     OBJECTS wired through a real `Ai.GoalSelector` — this file's own header explains the
//     substitution; the ARITHMETIC (`Fish.steerToward`) is a real port, the PRIORITY
//     ARBITRATION is not.
//   - bucketing (`Bucketable.tryBucket`/`copyDataToStack`/`copyDataFromNbt`, the FROM_BUCKET
//     tracked bool, and the four bucket ITEMS `cod_bucket`/`salmon_bucket`/`pufferfish_bucket`/
//     `tropical_fish_bucket` themselves as usable right-click tools) — `14l_use.js`/
//     `14f_inventory.js` (right-click item use, water-bucket-on-fish interaction) are shared
//     files this unit does not own and a real port needs a water-bucket-empties-into-air-and-
//     captures-entity rule neither file has any hook for yet. `Fish.bucketItemFor(type)` below
//     is the DATA half only (which item id each species' bucket is), proven by `fishcheck.mjs`
//     directly against `assets/entities.json`'s own item table, not wired to any interaction.
//   - `FishData`/`TropicalFishData` as literal `EntityData` return values threading a chosen
//     leader/variant through a MULTI-mob spawn batch (`Spawn.attempt`'s own `packSize` loop,
//     07l_spawn.js) — this file's own `Fish.schoolTick` (ticked every frame, not spawn-time)
//     achieves the same steady-state grouping FishData's spawn-time head-start shortcuts, so a
//     freshly spawned pack of cod DOES still end up schooled, just a few ticks later than the
//     jar's own instant-join.
//   - (dimension scaling by puff state is now `Fish.setPuffState`, #604; the note below is history)
//   - dimension SCALING by puff state (`getDimensions().scaled(0.5/0.7/1.0)`) — this engine's
//     hitbox/render dimensions come from a static per-TYPE table (`assets/entities.json`'s own
//     `types.pufferfish`), not a per-tick function of entity state; no hook exists to scale one
//     live (same standing gap `07zi_squid.js`'s own header names for the tilt/roll/tentacle
//     fields it computes but nothing renders).
//   - (flop/blow_up/blow_out/sting sounds are now `Fish.sound`, #1275; ambient/hurt/death run via mobSounds.)
//     (water getSwimSound = `MV.waterSound`, #3176.) Still owed: every PARTICLE.
//   - NBT round-trip (FromBucket/PuffState/Variant) — `16b_save.js` does not persist entities
//     at all yet, `Sq.OWED`'s own standing gap.
//   - `isInsideWaterOrBubbleColumn()`/`isTouchingWater()` approximated as `e.inWater` — the
//     same single-flag simplification `Sq`'s own header already names for the identical reason.
//   - axolotl (`EntityType.field_28315`) itself is not a type this engine can spawn — see the
//     sting-filter bullet above.
(function (NS) {
  'use strict';

  var Fish = NS.Fish = { ready: false };

  // ── the closed set this unit adds ──────────────────────────────────────────────────────────
  Fish.TYPES = ['cod', 'salmon', 'pufferfish', 'tropical_fish'];
  Fish.SCHOOLING = { cod: true, salmon: true, tropical_fish: true };   // SchoolingFishEntity subclasses
  function isFishType(t) { return t === 'cod' || t === 'salmon' || t === 'pufferfish' || t === 'tropical_fish'; }
  Fish.isFishType = isFishType;

  Fish.init = function () {
    Fish.ready = !!(NS.EntityList && NS.EntityList.ready && NS.Entities && NS.Entities.ready);
    return Fish;
  };

  Fish.random = null;   // injection point (same contract as `Sq.random`/`Bat.random`/`EL.random`)
  function rndSrc() { return Fish.random || (NS.EntityList && NS.EntityList.random) || Math.random; }
  function rint(n) { return Math.floor(rndSrc()() * n); }
  function rfloat() { return rndSrc()(); }

  // ── block/fluid helpers — the same shape `Sq`'s own `isAir`/`isWaterAt` already use ────────
  function isWaterAt(x, y, z) {
    var st = NS.World.getBlock(x, y, z);
    return st > 0 && NS.States.block[st] === NS.Reg.id.water;
  }
  function isWaterFluidAt(x, y, z) {   // getFluidState(pos).isIn(WATER): kelp/seagrass/waterlogged count
    var st = NS.World.getBlock(x, y, z);
    return st > 0 && NS.States.fluidKind[st] === 1;
  }
  function isSandAt(x, y, z) {
    var st = NS.World.getBlock(x, y, z);
    return st > 0 && NS.States.block[st] === NS.Reg.id.sand;
  }

  // ═══════════════════ SPAWN-TIME INIT — FishEntity/SchoolingFishEntity/PufferfishEntity/
  // TropicalFishEntity field+DataTracker defaults, verbatim ══════════════════════════════════
  Fish.spawnInit = function (e, opts) {
    opts = opts || {};
    if (e.fromBucket === undefined) e.fromBucket = !!opts.fromBucket;   // FROM_BUCKET tracked bool, default false
    e.fishWanderTicks = 0;
    e.fishTX = e.x; e.fishTY = e.y; e.fishTZ = e.z;
    if (Fish.SCHOOLING[e.type]) {
      // `SchoolingFishEntity`'s own `leader`/`groupSize` field initialisers (private, null/1).
      e.fishLeader = null;
      e.fishGroupSize = 1;
      // `SchoolingFishEntity.initialize`: first of a pack batch is the FishData leader, the rest joinGroup(it).
      var pdl = opts.packData;
      if (pdl) { if (pdl.fishLeader) joinGroupOf(e, pdl.fishLeader); else pdl.fishLeader = e; }
    }
    if (e.type === 'pufferfish') {
      e.puffState = 0; e.inflateTicks = 0; e.deflateTicks = 0;   // PUFF_STATE tracked int, both plain fields
      var bd = NS.Entities && NS.Entities.dimensions('pufferfish');
      e.baseWidth = bd ? bd.width : e.width; e.baseHeight = bd ? bd.height : e.height;
      Fish.setPuffState(e, 0);   // the constructor's calculateDimensions()
      // readCustomDataFromNbt "PuffState" / Bucketable.copyDataFromNbt: setPuffState(min(PuffState, 2))
      if (opts.puffState !== undefined) Fish.setPuffState(e, Math.max(0, Math.min(opts.puffState | 0, 2)));
    }
    if (e.type === 'tropical_fish') {
      Fish.chooseVariant(e, opts);
    }
  };

  // ═══════════════════ TROPICAL FISH VARIANT PACKING — `toVariant`/`getShape`/`getPattern`/
  // `getBaseDyeColorIndex`/`getPatternDyeColorIndex`, verbatim ═══════════════════════════════
  //
  // `TropicalFishEntity.Variety` enum (.decomp inner class, (shape,pattern) pairs in
  // DECLARATION order — VALUES[pattern + 6*shape]):
  //   flopper(0,0) stripey(0,1) glitter(0,2) blockfish(0,3) betty(0,4) clayfish(0,5)
  //   kob(1,0) sunstreak(1,1) snooper(1,2) dasher(1,3) brinely(1,4) spotty(1,5)
  // (the ENGLISH names above are cosmetic only — this file never reads them, only the
  // (shape,pattern) pair `toVariant` packs; `getTranslationKey`'s own lowercase-enum-name path
  // is UI text this engine has no translation table for, `Fish.OWED`.)
  //
  // `DyeColor`'s own 0..15 ids (.decomp/names.tsv `bts` class, declaration order a..p):
  //   0 white 1 orange 2 magenta 3 light_blue 4 yellow 5 lime 6 pink 7 gray 8 light_gray
  //   9 cyan 10 purple 11 blue 12 brown 13 green 14 red 15 black
  Fish.toVariant = function (shape, pattern, baseColorId, patternColorId) {
    return (shape & 0xFF) | ((pattern & 0xFF) << 8) | ((baseColorId & 0xFF) << 16) | ((patternColorId & 0xFF) << 24);
  };
  /** `TropicalFishEntity.COMMON_VARIANTS` — the 22 predefined variants, verbatim order. */
  var T = Fish.toVariant;   // (shape, pattern, baseDyeId, patternDyeId) — ids decoded from .decomp, checked by fishcheck
  Fish.COMMON_VARIANTS = [
    T(1, 1, 1, 7),
    T(1, 0, 7, 7),
    T(1, 0, 7, 11),
    T(1, 5, 0, 7),
    T(0, 1, 11, 7),
    T(0, 0, 1, 0),
    T(0, 5, 6, 3),
    T(1, 3, 10, 4),
    T(1, 5, 0, 14),
    T(0, 5, 0, 4),
    T(1, 2, 0, 7),
    T(1, 5, 0, 1),
    T(0, 3, 9, 6),
    T(0, 4, 5, 3),
    T(1, 4, 14, 0),
    T(0, 2, 7, 14),
    T(1, 3, 14, 0),
    T(1, 0, 0, 4),
    T(0, 0, 14, 0),
    T(0, 1, 7, 0),
    T(0, 3, 9, 4),
    T(1, 0, 4, 4)
  ];

  Fish.getShape = function (variant) { return Math.min(variant & 0xFF, 1); };
  Fish.getPattern = function (variant) { return Math.min((variant >> 8) & 0xFF, 5); };
  Fish.getBaseDyeColorIndex = function (variant) { return (variant >> 16) & 0xFF; };
  Fish.getPatternDyeColorIndex = function (variant) { return (variant >>> 24) & 0xFF; };

  /** `TropicalFishEntity.initialize` — verbatim: an incoming `opts.variant` (bucket NBT,
   *  `BUCKET_VARIANT_TAG_KEY`) wins outright; otherwise 90% a `COMMON_VARIANTS` pick
   *  (`Util.getRandom`, uniform), 10% a fully random (shape 0-1, pattern 0-5, both colours
   *  0-14 — `commonSpawn=false` = `fishCommonSpawn`, which `Spawn.attempt` (07l_spawn.js) reads as
   *  `spawnsTooManyForEachTry` to end the pack). */
  Fish.chooseVariant = function (e, opts) {
    if (opts && (opts.variant !== undefined || opts.fishVariant !== undefined)) { e.fishVariant = (opts.variant !== undefined ? opts.variant : opts.fishVariant) | 0; e.fishCommonSpawn = true; return; }
    var pd = opts && opts.packData;   // TropicalFishData: later pack members copy the leader's variant
    if (pd && pd.fishVariant !== undefined) { e.fishVariant = pd.fishVariant; e.fishCommonSpawn = true; return; }
    if (rfloat() < 0.9) {
      var picked = Fish.COMMON_VARIANTS[rint(Fish.COMMON_VARIANTS.length)];
      e.fishVariant = picked; e.fishCommonSpawn = true;
      if (pd) pd.fishVariant = picked;   // only the 90% branch builds a TropicalFishData
    } else {
      e.fishVariant = Fish.toVariant(rint(2), rint(6), rint(15), rint(15));
      e.fishCommonSpawn = false;
    }
  };

  // ═══════════════════ AIR / DROWNING — `WaterCreatureEntity.tickWaterBreathingAir`/
  // `baseTick` verbatim, the SAME numbers `Sq.tickAir` already cites ═════════════════════════
  Fish.tickAir = function (e) {
    if (e.fishAir === undefined) e.fishAir = 300;
    if (e.dead) return;
    if (e.inWater) { e.fishAir = 300; return; }
    e.fishAir--;
    if (e.fishAir === -20) {
      e.fishAir = 0;
      if (NS.Combat && NS.Combat.hurt) NS.Combat.hurt(e, 2.0);   // DamageSource.DROWN
    }
  };

  /** `Entity.playSound(ev, getSoundVolume(), getSoundPitch())` as the fish's own mob sound (silent fish make none). */
  Fish.sound = function (e, ev, vol, pitch) {
    if (!e || e.silent || !NS.Sound || !NS.Sound.mobSound) return;
    NS.Sound.mobSound(e, ev, vol == null ? 1 : vol, pitch == null ? (rfloat() - rfloat()) * 0.2 + 1 : pitch);
  };
  /** `getFlopSound()`: `entity.<type>.flop` (puffer_fish for the pufferfish). */
  Fish.flopSound = function (e) { return 'entity.' + (e.type === 'pufferfish' ? 'puffer_fish' : e.type) + '.flop'; };

  // ═══════════════════ FLOP ON LAND — `FishEntity.tickMovement()` verbatim ══════════════════
  Fish.tickMovementFlop = function (e) {
    if (!e.inWater && e.onGround && e.verticalCollision) {
      e.vx = (e.vx || 0) + (rfloat() * 2 - 1) * 0.05;
      e.vy = (e.vy || 0) + 0.4;
      e.vz = (e.vz || 0) + (rfloat() * 2 - 1) * 0.05;
      e.onGround = false;
      Fish.sound(e, Fish.flopSound(e));
    }
  };

  // ═══════════════════ NAVIGATION + FishMoveControl ══════════════════════════════════════════
  // `e.fishNav` = { x, y, z, speed } is the ACTIVE navigation target (null = `Navigation.isIdle()`).
  // ⚠ SUBSTITUTION: this engine has no water A* (`SwimNavigation`); the "path" is the straight
  // line to the target node (block centre), finished by `MobNavigation.checkNodeReached`'s own
  // rule (|dx|,|dz| < maxDistanceToWaypoint = 0.75 - width/2 for width<=0.75, |dy| < 1).
  function navStart(e, x, y, z, speed) {
    e.fishNav = { x: Math.floor(x) + 0.5, y: Math.floor(y), z: Math.floor(z) + 0.5, speed: speed };
  }
  function navTick(e) {
    var n = e.fishNav;
    if (!n) return;
    var w = e.width || 0.5, reach = w > 0.75 ? w / 2 : 0.75 - w / 2;
    if (Math.abs(e.x - n.x) < reach && Math.abs(e.z - n.z) < reach && Math.abs(e.y - n.y) < 1.0) e.fishNav = null;
  }
  Fish.navStart = navStart;

  /** `FishEntity.FishMoveControl.tick()` verbatim (yaw in this engine's convention, D-415:
   *  `atan2(dx, -dz)`, see `Ai.rotlerp`); `setMovementSpeed` on a MobEntity also sets `zza`. */
  Fish.moveControlTick = function (e) {
    var Ph = NS.Physics, W = NS.States.stateOf('water');   // isSubmergedIn(WATER): eye = 0.65*height, not isTouchingWater
    if (Ph.blockAt(e.x, e.y + 0.65 * (e.height || 0.4), e.z) === W) e.vy = (e.vy || 0) + 0.005;
    var n = e.fishNav;
    if (n) {
      var attr = (NS.Entities && NS.Entities.attrsOf) ? (NS.Entities.attrsOf(e.type).speed || 0.7) : 0.7;
      var target = n.speed * attr;
      e.mobSpeed = (e.mobSpeed || 0) + (target - (e.mobSpeed || 0)) * 0.125;   // MathHelper.lerp(0.125F, ...)
      e.zza = e.mobSpeed;
      var dx = n.x - e.x, dy = n.y - e.y, dz = n.z - e.z;
      if (dy !== 0) {
        var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        e.vy = (e.vy || 0) + e.mobSpeed * (dy / dist) * 0.1;
      }
      if (dx !== 0 || dz !== 0) {
        e.yaw = NS.Ai.rotlerp(e.yaw || 0, Math.atan2(dx, -dz), Math.PI / 2);   // wrapDegrees(.., 90)
        e.bodyYaw = e.yaw;
      }
    } else { e.mobSpeed = 0; e.zza = 0; }
  };

  // ═══════════════════ THE GOALS — through a real `Ai.GoalSelector` (e.fishGoals) ═════════════
  function rint2(n) { return rint(n); }
  /** `NoPenaltyTargeting.find(mob, h, v)` / `LookTargetUtil.find` — 10 `localFuzz` samples, the
   *  best `getPathfindingFavor` wins; a water fish's favor is 0 for every sample so the FIRST valid
   *  sample wins (guessBest keeps the strictly-greater). Valid = in world height and (LookTargetUtil)
   *  a block that `canPathfindThrough(WATER)`: water. */
  function fuzzFind(e, h, v, mustBeWater, from) {
    var best = null;
    for (var i = 0; i < 10; i++) {
      var ox, oy, oz;
      if (from) {   // localFuzz(random, h, v, 0, dx, dz, PI/2) — away from `from`
        var a0 = Math.atan2(e.z - from.z, e.x - from.x) - Math.PI / 2;
        var a1 = a0 + (2 * rfloat() - 1) * (Math.PI / 2);
        var r = Math.sqrt(rfloat()) * Math.SQRT2 * h;
        ox = -r * Math.sin(a1); oz = r * Math.cos(a1);
        if (Math.abs(ox) > h || Math.abs(oz) > h) continue;
        ox = Math.trunc(ox); oz = Math.trunc(oz);
        oy = rint2(2 * v + 1) - v;
      } else { ox = rint2(2 * h + 1) - h; oy = rint2(2 * v + 1) - v; oz = rint2(2 * h + 1) - h; }
      var x = Math.floor(e.x + ox), y = Math.floor(e.y + oy), z = Math.floor(e.z + oz);
      if (y < -64 || y >= 256) continue;
      if (best === null) best = { x: x + 0.5, y: y, z: z + 0.5 };
      if (mustBeWater && !isWaterAt(x, y, z)) { best = null; continue; }
      return best;
    }
    return mustBeWater ? null : best;
  }
  Fish.fuzzFind = fuzzFind;
  function attackerOf(e) {
    var Fl = NS.Fly;
    return Fl && Fl.attackerOf ? Fl.attackerOf(e) : e.lastHurtByEntity;
  }
  function hasLeader(e) { return !!(e.fishLeader && !e.fishLeader.removed && !e.fishLeader.dead); }
  function hasSelfControl(e) { return !Fish.SCHOOLING[e.type] || !hasLeader(e); }

  /** priority 0 — `EscapeDangerGoal(1.25)` */
  function EscapeDanger(e) {
    var tx, ty, tz;
    this.canUse = function () {
      if (!(attackerOf(e) || e.justHurt || e.isOnFire)) return false;
      var w = e.isOnFire && NS.Fly.locateClosestWater(e, 5);   // canStart: locateClosestWater(5) first
      if (w) { tx = w.x; ty = w.y; tz = w.z; return true; }
      var t = fuzzFind(e, 5, 4, true);
      if (!t) return false;
      tx = t.x; ty = t.y; tz = t.z; return true;
    };
    this.canContinueToUse = function () { return !!e.fishNav; };
    this.start = function () { navStart(e, tx, ty, tz, 1.25); };
    this.stop = function () {};
    this.tick = function () {};
  }
  /** priority 2 — `FleeEntityGoal<>(PlayerEntity, 8.0F, 1.6, 1.4, EXCEPT_SPECTATOR)`; the
   *  TargetPredicate is `createAttackable()`, so a creative player is not fled from. */
  function FleePlayer(e) {
    var who = null;
    function fleeable() {
      var P = NS.Player, Gm = NS.Gamemode;
      if (!P) return null;
      if (Gm && (P.mode === Gm.CREATIVE || P.mode === Gm.SPECTATOR)) return null;
      var dx = P.x - e.x, dy = P.y - e.y, dz = P.z - e.z;
      // getEntitiesByClass(box.expand(8,3,8)): Box.intersects is strict on every axis; then
      // TargetPredicate.baseMaxDistance*scale: full 3D squaredDistanceTo refuses
      var hw = (e.width || 0.5) / 2 + 8 + (P.width || 0.6) / 2;
      if (Math.abs(dx) >= hw || Math.abs(dz) >= hw) return null;
      if (P.y >= e.y + (e.height || 0.4) + 3 || P.y + (P.height || 1.8) <= e.y - 3) return null;
      var r = 8 * (NS.Bat && NS.Bat.attackScale ? NS.Bat.attackScale(P) : 1);   // sneak x0.8, invisible x0.7
      if (dx * dx + dy * dy + dz * dz > r * r) return null;
      if (NS.Ai && NS.Ai.canSee && !NS.Ai.canSee(e, P)) return null;   // VisibilityCache
      return P;
    }
    this.canUse = function () {
      who = fleeable();
      if (!who) return false;
      var t = fuzzFind(e, 16, 7, true, who);
      if (!t) return false;
      var dt = (who.x - t.x) * (who.x - t.x) + (who.y - t.y) * (who.y - t.y) + (who.z - t.z) * (who.z - t.z);
      var dm = (who.x - e.x) * (who.x - e.x) + (who.y - e.y) * (who.y - e.y) + (who.z - e.z) * (who.z - e.z);
      if (dt < dm) return false;
      e.fishFleeTo = t; return true;
    };
    this.canContinueToUse = function () { return !!e.fishNav; };
    this.start = function () { var t = e.fishFleeTo; navStart(e, t.x, t.y, t.z, 1.6); };
    this.stop = function () { who = null; };
    this.tick = function () {
      if (!who) return;
      var dx = who.x - e.x, dy = who.y - e.y, dz = who.z - e.z;
      if (e.fishNav) e.fishNav.speed = (dx * dx + dy * dy + dz * dz < 49) ? 1.4 : 1.6;   // fastSpeed near, slowSpeed far
    };
  }
  /** priority 4 — `SwimToRandomPlaceGoal` = `SwimAroundGoal(1.0, 40)` (`WanderAroundGoal.canStart`:
   *  1-in-`chance` roll, despawn-counter gate, then `LookTargetUtil.find(mob, 10, 7)`). */
  function SwimToRandomPlace(e) {
    var tx, ty, tz;
    this.canUse = function () {
      if (!hasSelfControl(e)) return false;
      if ((e.despawnCounter || 0) >= 100) return false;
      if (rint(40) !== 0) return false;
      var t = fuzzFind(e, 10, 7, true);
      if (!t) return false;
      tx = t.x; ty = t.y; tz = t.z; return true;
    };
    this.canContinueToUse = function () { return !!e.fishNav; };
    this.start = function () { navStart(e, tx, ty, tz, 1.0); };
    this.stop = function () { e.fishNav = null; };
    this.tick = function () {};
  }
  function nearbySame(e) {
    var EL = NS.EntityList, out = [];
    if (!EL || !EL.list) return out;
    for (var i = 0; i < EL.list.length; i++) {
      var o = EL.list[i];
      if (o.removed || o.dead || o.type !== e.type) continue;
      if (Math.abs(o.x - e.x) <= 8 + 0.25 && Math.abs(o.y - e.y) <= 8 + 0.2 && Math.abs(o.z - e.z) <= 8 + 0.25) out.push(o);   // expand(8,8,8)
    }
    return out;
  }
  function maxGroup(e) { return e.type === 'salmon' ? 5 : 8; }   // SalmonEntity.getMaxGroupSize=5; else FishEntity.getLimitPerChunk=8
  function otherInGroup(o) { return (o.fishGroupSize || 1) > 1; }
  function canHaveMore(o) { return otherInGroup(o) && (o.fishGroupSize || 1) < maxGroup(o); }
  function joinGroupOf(f, l) { f.fishLeader = l; l.fishGroupSize = (l.fishGroupSize || 1) + 1; }
  /** priority 5 — `FollowGroupLeaderGoal` (schooling types only). */
  function FollowGroupLeader(e) {
    var moveDelay = 0;
    function delay() { return 200 + rint(200) % 20; }
    var checkDelay = delay();
    this.canUse = function () {
      if (otherInGroup(e)) return false;
      if (hasLeader(e)) return true;
      if (checkDelay > 0) { checkDelay--; return false; }
      checkDelay = delay();
      var list = nearbySame(e).filter(function (o) { return canHaveMore(o) || !hasLeader(o); });
      var l = list.filter(canHaveMore)[0] || e;   // findAny, else itself
      var room = maxGroup(l) - (l.fishGroupSize || 1);
      list.filter(function (o) { return !hasLeader(o); }).slice(0, Math.max(0, room)).forEach(function (o) {
        if (o !== l) joinGroupOf(o, l);
      });
      return hasLeader(e);
    };
    this.canContinueToUse = function () {
      if (!hasLeader(e)) return false;
      var l = e.fishLeader, dx = l.x - e.x, dy = l.y - e.y, dz = l.z - e.z;
      return dx * dx + dy * dy + dz * dz <= 121;   // isCloseEnoughToLeader
    };
    this.start = function () { moveDelay = 0; };
    this.stop = function () {   // leaveGroup
      if (e.fishLeader) { e.fishLeader.fishGroupSize = (e.fishLeader.fishGroupSize || 1) - 1; e.fishLeader = null; }
    };
    this.tick = function () {
      if (--moveDelay <= 0) {
        moveDelay = 10;
        if (hasLeader(e)) { var l = e.fishLeader; navStart(e, l.x, l.y, l.z, 1.0); }   // startMovingTo(leader, 1.0)
      }
    };
  }
  /** priority 1 (pufferfish only) -- `PufferfishEntity.InflateGoal`: always runnable, its `tick` IS `Fish.puffTick` */
  function Inflate(e) {
    this.canUse = function () { return true; };
    this.canContinueToUse = function () { return true; };
    this.start = function () {};
    this.stop = function () {};
    this.tick = function () { Fish.puffTick(e); };
  }
  // jar names, so tools/goalaudit.mjs can reverse-look the goal classes up
  Fish.EscapeDangerGoal = EscapeDanger; Fish.FleeEntityGoal = FleePlayer; Fish.SwimToRandomPlaceGoal = SwimToRandomPlace; Fish.FollowGroupLeaderGoal = FollowGroupLeader; Fish.InflateGoal = Inflate;
  Inflate.prototype.auditName = 'Pufferfish.InflateGoal';
  Fish.buildGoals = function (e) {
    var gs = new NS.Ai.GoalSelector();
    gs.add(0, NS.Ai.MOVE, new EscapeDanger(e));
    if (e.type === 'pufferfish') gs.add(1, 0, new Inflate(e));
    gs.add(2, NS.Ai.MOVE, new FleePlayer(e));
    gs.add(4, NS.Ai.MOVE, new SwimToRandomPlace(e));
    if (Fish.SCHOOLING[e.type]) gs.add(5, 0, new FollowGroupLeader(e));
    return gs;
  };
  /** `SchoolingFishEntity.tick`'s own group-shrink re-check. */
  Fish.schoolTick = function (e) {
    if (!Fish.SCHOOLING[e.type]) return;
    if (otherInGroup(e) && rint(200) === 1 && nearbySame(e).length <= 1) e.fishGroupSize = 1;
  };

  // ═══════════════════ PUFFERFISH — `tick()`/`tickMovement()`/`sting()`/`onPlayerCollision()`/
  // `InflateGoal` verbatim ════════════════════════════════════════════════════════════════════
  Fish.PUFF = { NOT_PUFFED: 0, SEMI_PUFFED: 1, FULLY_PUFFED: 2 };
  /** `getScaleForPuffState` (0 -> 0.5, 1 -> 0.7, else 1.0). */
  Fish.puffScale = function (s) { return s === 0 ? 0.5 : (s === 1 ? 0.7 : 1.0); };
  /** `setPuffState` + `onTrackedDataSet`'s `calculateDimensions()`: `getDimensions` is the type's
   *  base box `.scaled(getScaleForPuffState)`. */
  Fish.setPuffState = function (e, s) {
    e.puffState = s;
    var k = Fish.puffScale(s);
    e.width = e.baseWidth * k; e.height = e.baseHeight * k;
  };

  function isAquaticType(t) {
    return t === 'squid' || t === 'glow_squid' || t === 'cod' || t === 'salmon' ||
      t === 'pufferfish' || t === 'tropical_fish' || t === 'dolphin' || t === 'guardian' ||
      t === 'elder_guardian' || t === 'turtle' || t === 'axolotl';
  }
  /** `BLOW_UP_FILTER` — a non-creative player always matches; any OTHER living mob matches
   *  unless it is itself aquatic (EntityGroup.AQUATIC: water creatures, guardians, turtle,
   *  axolotl), except axolotl, which is always a target. */
  function isBlowUpTarget(other) {
    if (other.dead || other.removed) return false;   // TargetPredicate.test: !isPartOfGame (dead)
    if (other === NS.Player) {
      var Gm = NS.Gamemode;
      return !(Gm && (other.mode === Gm.CREATIVE || other.mode === Gm.SPECTATOR));
    }
    return other.type === 'axolotl' || !isAquaticType(other.type);
  }
  Fish.isBlowUpTarget = isBlowUpTarget;

  /** `getBoundingBox().expand(r)` of `e` meets `o`'s own box (both feet-centred; `o` unexpanded) —
   *  the target's size and the fish's puff scale both count, unlike a centre-distance sphere. */
  function touchesExpanded(e, o, r) {
    var ew = (e.width || 0.7) / 2 + r, ow = (o.width || 0.6) / 2;
    var oh = o.height || 1.8;
    return Math.abs(o.x - e.x) < ew + ow && Math.abs(o.z - e.z) < ew + ow &&
      o.y < e.y + (e.height || 0.7) + r && o.y + oh > e.y - r;
  }
  function isLiving(o) { return o === NS.Player || typeof o.health === 'number'; }

  /** `InflateGoal.canStart` (2.0-block expand) then `tick()`'s own state machine, folded into
   *  one per-tick call — this engine has no separate goal-start/stop split for it either. */
  Fish.puffTick = function (e) {
    if (e.dead || e.vehicle) return;   // PufferfishEntity.tick: isAlive() && canMoveVoluntarily()
    var EL = NS.EntityList;
    var threatened = false;
    if (EL && EL.list) {
      for (var i = 0; i < EL.list.length && !threatened; i++) {
        var o = EL.list[i];
        if (o.removed || o === e) continue;
        if (!isLiving(o) || !touchesExpanded(e, o, 2.0)) continue;   // getEntitiesByClass(LivingEntity, getBoundingBox().expand(2.0))
        if (isBlowUpTarget(o)) threatened = true;
      }
      var P = NS.Player;
      if (!threatened && P) {
        if (touchesExpanded(e, P, 2.0) && isBlowUpTarget(P)) threatened = true;
      }
    }
    if (threatened) { if (!e.inflateTicks) { e.inflateTicks = 1; e.deflateTicks = 0; } }
    else if (e.inflateTicks) { e.inflateTicks = 0; }

    if (e.inflateTicks > 0) {
      if (e.puffState === 0) { Fish.sound(e, 'entity.puffer_fish.blow_up'); Fish.setPuffState(e, 1); }
      else if (e.inflateTicks > 40 && e.puffState === 1) { Fish.sound(e, 'entity.puffer_fish.blow_up'); Fish.setPuffState(e, 2); }
      e.inflateTicks++;
    } else if (e.puffState !== 0) {
      if (e.deflateTicks > 60 && e.puffState === 2) { Fish.sound(e, 'entity.puffer_fish.blow_out'); Fish.setPuffState(e, 1); }
      else if (e.deflateTicks > 100 && e.puffState === 1) { Fish.sound(e, 'entity.puffer_fish.blow_out'); Fish.setPuffState(e, 0); }
      e.deflateTicks++;
    }
  };

  /** `sting(MobEntity)`/`onPlayerCollision` folded: `1+puffState` damage, `60*puffState`-tick
   *  amplifier-0 POISON, against anything touching (`expand(0.3)`) while puffed at all. */
  Fish.stingSound = function (e) {
    if (e.silent) return null;
    Fish.sound(e, 'entity.puffer_fish.sting', 1, 1);
    return 'entity.puffer_fish.sting';
  };
  Fish.stingNearby = function (e) {
    if (!e.puffState) return;
    var EL = NS.EntityList, Cb = NS.Combat, ES = NS.Effects;
    var dmg = 1 + e.puffState;
    if (EL && EL.list && Cb && Cb.hurt) {
      for (var i = 0; i < EL.list.length; i++) {
        var o = EL.list[i];
        if (o.removed || o === e || o.dead) continue;
        if (!isLiving(o) || o.type === 'armor_stand' || !touchesExpanded(e, o, 0.3)) continue;   // getEntitiesByClass(MobEntity, getBoundingBox().expand(0.3))
        if (!isBlowUpTarget(o)) continue;
        // PufferfishEntity.sting: poison + sting sound only when damage(mob(this)) succeeds
        if (Cb.hurt(o, dmg, undefined, false, { attacker: e, source: 'mob' })) {
          if (ES && ES.addStatusEffect) ES.addStatusEffect(o, 'poison', 60 * e.puffState, 0, false, true);
          Fish.stingSound(e);
        }
      }
    }
    var P = NS.Player;
    if (P && Cb && Cb.hurt) {
      // PlayerEntity.tickMovement: entities meeting player box.expand(1.0, 0.5, 1.0) get onPlayerCollision
      var pw = (P.width || 0.6) / 2 + 1.0 + (e.width || 0.7) / 2, ph = P.height || 1.8;
      if (Math.abs(P.x - e.x) < pw && Math.abs(P.z - e.z) < pw &&
          P.y - 0.5 < e.y + (e.height || 0.7) && P.y + ph + 0.5 > e.y && isBlowUpTarget(P)) {
        if (Cb.hurt(P, dmg, undefined, false, { attacker: e, source: 'mob' })) {
          if (ES && ES.addStatusEffect) ES.addStatusEffect(P, 'poison', 60 * e.puffState, 0, false, true);
          Fish.stingSound(e);
        }
      }
    }
  };

  // ═══════════════════ TRAVEL — `FishEntity.travel(Vec3d)` verbatim ═════════════════════════
  Fish.travelMob = function (e) {
    if (e.inWater) {
      // updateVelocity(0.01F, input): zza (set by FishMoveControl) along yaw, engine convention
      var sy = Math.sin(e.yaw), cy = Math.cos(e.yaw), zza = (e.zza || 0) * 0.98;   // LivingEntity.tickMovement forwardSpeed *= 0.98
      e.vx = (e.vx || 0) + zza * sy * 0.01;
      e.vz = (e.vz || 0) + -zza * cy * 0.01;
      if (NS.Physics && NS.Physics.move) NS.Physics.move(e, e.vx, e.vy || 0, e.vz);
      e.vx *= 0.9; e.vy = (e.vy || 0) * 0.9; e.vz *= 0.9;
      if (!e.target) e.vy -= 0.005;   // getTarget()==null
    } else {
      if (NS.Physics && NS.Physics.travelMob) NS.Physics.travelMob(e);   // super.travel($$0) == plain ground MobEntity travel
    }
  };

  /** One fish's whole tick, called from `EL.tickMob`'s own goal-adjacent slot
   *  (07i_entitylist.js), the SAME slot `Sq.tick`/`Bat.mobTick` already occupy. Priority order
   *  LOW to HIGH so a higher-priority call's target overwrites a lower one's — see header. */
  Fish.tick = function (e) {
    if (!Fish.ready) return;
    if (!e.fishGoals) e.fishGoals = Fish.buildGoals(e);
    Fish.schoolTick(e);
    navTick(e);
    e.fishGoals.tick();
    Fish.moveControlTick(e);
    if (e.type === 'pufferfish') Fish.stingNearby(e);   // puffTick runs as Inflate goal in fishGoals.tick
    Fish.tickAir(e);
    Fish.tickMovementFlop(e);
  };

  // ═══════════════════ SPAWN RULES — `WaterCreatureEntity.canSpawn` / `TropicalFishEntity.
  // canTropicalFishSpawn` verbatim (same shape `Sq.canSpawn`/`Sq.glowCanSpawn` already use) ══
  Fish.SEA_LEVEL = 63;   // Spawn.SEA_LEVEL's own literal (07l_spawn.js)

  Fish.canSpawn = function (x, y, z, seaLevel) {
    var sl = seaLevel === undefined ? Fish.SEA_LEVEL : seaLevel;
    if (y < sl - 13 || y > sl) return false;
    if (!isWaterFluidAt(x, y - 1, z)) return false;
    return isWaterAt(x, y + 1, z);
  };

  Fish.tropicalCanSpawn = function (x, y, z, seaLevel) {
    if (!isWaterFluidAt(x, y - 1, z)) return false;
    if (!isWaterAt(x, y + 1, z)) return false;
    var W = NS.World, B = NS.Biomes;
    var warmOcean = false;
    if (W && B && B.ready) {
      var idx = W.biomeAt(x, z);
      var name = B.names[idx];
      warmOcean = (name === 'minecraft:lush_caves');
    }
    return warmOcean || Fish.canSpawn(x, y, z, seaLevel);
  };

  // ═══════════════════ BUCKET ITEM DATA (read by Use.entityUse's Bucketable.tryBucket) ═══════════
  Fish.bucketItemFor = function (type) {
    switch (NS.Entities ? NS.Entities.bare(type) : type) {
      case 'cod': return 'cod_bucket';
      case 'salmon': return 'salmon_bucket';
      case 'pufferfish': return 'pufferfish_bucket';
      case 'tropical_fish': return 'tropical_fish_bucket';
      default: return null;
    }
  };

  Fish.OWED = [
    'SwimAroundGoal/FleeEntityGoal/EscapeDangerGoal/FollowGroupLeaderGoal/InflateGoal as real',
    '  Ai.GoalSelector/Ai.ROSTER entries with priority-flag arbitration -- .decomp does not carry',
    '  their source at all (only the six entity classes this file cites do); Fish goals/',
    '  fleeTick/dangerTick/schoolTick/puffTick hand-roll the arithmetic in fixed low-to-high',
    '  priority order instead (this file\'s own header)',
    'bucket NBT health/Age only (#1277 did puff state + tropical variant, fishbucketcheck) -- the',
    '  water-bucket-on-fish capture itself is LIVE (Use.entityUse -> Fish.bucketItemFor, interactrefcheck)',
    'dimension scaling by puff state (getDimensions().scaled) -- no per-tick hitbox/render hook',
    '  exists for any mob in this engine yet',
    'sound (ambient/hurt/death/flop/puff-in/puff-out/sting) and every particle -- no sound or',
    '  particle substrate exists in this engine at all yet',
    '(NBT round-trip FromBucket/PuffState/Variant: DONE #1277, 07zw_mobnbt.js rows)',
    'axolotl (EntityType.field_28315, unmapped in names.tsv) is not a spawnable type here, so',
    '  PufferfishEntity\'s one exception back INTO its own aquatic-exclusion filter is moot',
    '(FishData leader threading across a packSize batch: DONE #5567; TropicalFishData variant: DONE #3051)'
  ];
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
