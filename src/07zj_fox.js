// 07zj_fox.js — loop/fox-s99 (QUEUE 0.2 G18c, missing overworld mob): the FOX, whole.
// Runs on: MAIN THREAD ONLY. No DOM.
//
// Everything here is read off `.decomp/net/minecraft/entity/passive/FoxEntity.java` (1.18.2,
// Yarn-named, read in full — 1510 lines: the class plus its ~15 inner Goal classes) unless a
// comment says otherwise. Dimensions ([0.6, 0.7]) and the four attributes (MAX_HEALTH 10.0,
// MOVEMENT_SPEED 0.3, FOLLOW_RANGE 32.0, ATTACK_DAMAGE 2.0 — `createFoxAttributes`, .decomp
// lines 282-288) are NOT re-declared here: they come out of the jar-bytecode-extracted entity
// table generically (`NS.Entities.attrsOf('fox')`), the same convention rabbit/squid/enderman
// already use — `foxcheck` asserts those four numbers directly against `assets/entities.json`
// rather than this file duplicating a number the table already owns. The breeding food tag
// (`#minecraft:fox_food` — `FoxEntity.isBreedingItem`, .decomp line 546-548, `ItemTags.
// field_28624` == "fox_food", confirmed against `.decomp/net/minecraft/tag/ItemTags.java:50`)
// is likewise read live off `NS.Entities.breedFood('fox')`, not copied.
//
// WHAT IS HERE, PER THE UNIT'S OWN SPEC:
//   1. `Fx.TYPE` (RED/SNOW) + `Fx.fromBiome`/`Fx.typeAt` — `FoxEntity.Type.fromBiome`
//      (.decomp lines 1490-1492): snow when the biome's precipitation is SNOW, red otherwise —
//      no random roll at all (unlike rabbit's `chooseType`), confirmed by reading the method
//      body itself, not assumed from the name (§ TYPE).
//   2. `EL.motionFor`'s own `fox` hardcode (07i_entitylist.js) + `Spawn.RULES.fox` (07l_
//      spawn.js) — `FoxEntity.canSpawn` (.decomp lines 296-298) VERBATIM: the block below must
//      carry `#minecraft:foxes_spawnable_on` (`BlockTags.field_35574`, confirmed against
//      `.decomp/net/minecraft/tag/BlockTags.java:137`) AND `AnimalEntity.
//      isLightLevelValidForNaturalSpawn` — the SAME static method rabbit's own `canSpawn`
//      already calls (`isBrightEnoughToSpawn`, 07l_spawn.js's own rabbit rule), confirmed by
//      reading `AnimalEntity.java:108-111` directly rather than assumed off the name (§ SPAWN).
//      Taiga/grove/snowy is where vanilla's BIOME SPAWN LISTS place fox in the jar's worldgen
//      data — `canSpawn` itself carries no biome test at all (read whole: tag + light, nothing
//      else), the identical shape rabbit's own header already found, and this engine has no
//      biome-spawner-list substrate for ANY mob (07l_spawn.js's own file header: "this file's
//      placement RULES are jar-verified... every other type... is correctly REFUSED", a
//      standing gap shared by every mob in this table, not fox's own to close).
//   3. Core goals (§ GOALS, below `Ai.ROSTER.fox` in 07k_goals.js): sleep-by-day, flee from
//      an untrusted player/an untamed wolf/a polar bear, stalk-then-melee chickens and rabbits,
//      pick up a dropped item and carry it, eat sweet berries off a bush, follow a parent,
//      and the two-slot TRUSTED-player list (`Fx.canTrust`/`Fx.addTrustedId`, replicating
//      `getTrustedUuids`/`addTrustedUuid`, .decomp lines 362-374 — OWNER first, OTHER_TRUSTED
//      second, the SAME two-`Optional<UUID>` DataTracker pair the class declares).
//   4. `Fx.EatSweetBerriesGoal` — `FoxEntity.EatSweetBerriesGoal extends MoveToTargetPosGoal`
//      (.decomp lines 883-964), at this engine's own Goal shape, the SAME `MoveToTargetPosGoal`
//      convention `Rb.EatCarrotCropGoal` (07zh_rabbit.js) already established: an expanding-
//      ring search for `sweet_berry_bush` age>=2 (`SweetBerryBushBlock.AGE >= 2`, .decomp line
//      903), eats it down to age 1 rather than 0 (`.with(AGE, 1)`, .decomp line 940 — read
//      TWICE in the jar's own method and kept as the jar's own off-by-one, not corrected here),
//      and equips a `sweet_berries` stack into the mouth slot the same `Eq.MAINHAND` this
//      engine's other equipped mobs already use (§ EAT BERRIES).
//   5. `Fx.PickupItemGoal` — `FoxEntity.PickupItemGoal` (.decomp lines 1312-1354): picks up the
//      nearest dropped item within 8 blocks into the SAME mouth slot, refusing while a target
//      is set or the mouth is already full (§ PICKUP).
//   6. `Fx.MoveToHuntGoal` — `FoxEntity.MoveToHuntGoal` (.decomp lines 1255-1291): approaches a
//      chicken/rabbit target and sets the crouch/rolling-head visual flags once within 6
//      blocks, so `Ai.MeleeAttackGoal` (already generic, reused unmodified) can finish the
//      attack (§ HUNT).
//   7. `Fx.skinKey` — the texture-family picker `FoxEntityRenderer` would read (red vs snow,
//      per `Fx.foxType` on the entity) — see `Fx.OWED` below for the one real gap this closes
//      only halfway (no fox family baked into this session's atlas at all).
//   8. Breeding: `Fx.createChild` (`FoxEntity.method_18260`, .decomp lines 290-294 — a coin
//      flip onto one parent's own type) wired as `Breed.CHILD.fox` in 07m_breed.js, and `fox`
//      LEAVES `Breed.SPECIAL` this session (the same "left the closed set" shape rabbit's own
//      pass already used) — the child also trusts whichever player(s) fed each parent
//      (`onPlayerSpawnedChild`/`MateGoal.breed`, .decomp lines 550-553 and 1213-1230).
//
// NOT HERE (this unit's own OWED, at the bottom, `Fx.OWED`):
//   - `PowderSnowJumpGoal` — wired at priority 0 in `Ai.ROSTER.fox` (generic `Ai.PowderSnowJumpGoal`).
//   - `FoxEntity.JumpChasingGoal`/`DiveJumpingGoal`'s own jump-pounce ARC and `PounceAtTarget
//     Goal`'s fleeing-prey leap — `Fx.MoveToHuntGoal` reproduces the STALK/approach and the crouch
//     pose `MoveToHuntGoal` itself drives, but the actual airborne pounce trajectory is not
//     modelled; `Ai.MeleeAttackGoal` (reused, generic) finishes the kill on the ground instead.
//   - `AvoidDaylightGoal`/the two-goal `DelayedCalmDownGoal`+`SitDownAndLookAroundGoal` state
//     machine — `Fx.SleepByDayGoal` collapses both into one goal (day + calm + not-in-powder-
//     snow -> sit then sleep after a short timer, wake at night or on a fright), the same
//     "one substitute where vanilla used two collaborating goals" shape `Ai.PanicGoal` already
//     stands in for `EscapeDangerGoal` project-wide.
//   - `GoToVillageGoal` (villages exist elsewhere in this engine but this goal's own 200-tick
//     "give up" bookkeeping was not ported) and the `DefendFriendGoal` target-selector entry
//     (retaliate on whoever just hurt a fellow fox) — neither is in this unit's own explicit
//     spec list.
//   - Prey via `FishEntity`/`SchoolingFishEntity` (`followFishGoal`) — no fish entity TYPE
//     exists anywhere in this engine yet (`grep` of `07k_goals.js`/`07i_entitylist.js` finds no
//     `cod`/`salmon`/`pufferfish`/`tropical_fish` ROSTER or DEFAULTS entry at all), so this is
//     refused the same way `EL.canSpawn` refuses every unmeasured type — nothing to hunt.
//   - `CaveVines.hasBerries`/glow-berry eating, `EatSweetBerriesGoal`'s OWN second branch
//     (.decomp lines 917-918, 928-929) — only the `sweet_berry_bush` half is wired; glow berries
//     stay a real gap, not a silent one.
//   - a real fox TEXTURE FAMILY in the packed atlas: `tools/pack-mobtex.mjs` has no `fox`/
//     `snow_fox` entry at all this session (confirmed: `grep -n fox tools/pack-mobtex.mjs`
//     finds nothing), so `Fx.skinKey`'s answer is real but `ER.mobGeomFor`'s own texKey-then-
//     layerName fallback (D-469, 07j_entityrender.js) currently always takes the fallback path
//     for a fox — the same standing shape every mob with no baked skin key falls into, not a
//     bug this unit introduces.
//   - "Toast"-style custom-name reskins and the sleeping-pose SPRITE variant (vanilla's
//     `FoxEntityModel` poses the SAME box differently when `isSleeping()`, rather than
//     switching texture) — `Fx.skinKey` answers red/snow only; the sleeping POSE itself is a
//     model/animation concern this unit does not touch (`07j_entityrender.js`'s own `setupAnim`
//     table is not extended here).

(function (NS) {
  'use strict';
  // rolls draw from the mob's own e.random (java.util.Random, #6437); FB only when no mob is in hand
  var FBF = new NS.JRandom(0x6437);
  var FBdF = function () { return FBF.nextFloat(); };
  function rf(e) { var r = e && e.random; return r ? function () { return r.nextFloat(); } : FBdF; }
  function ri(e, n) { return e && e.random ? e.random.nextInt(n) : FBF.nextInt(n); }

  var Fx = NS.Fox = {};

  // `FoxEntity.computeFallDamage` (.decomp line 607): `MathHelper.ceil((fallDistance - 5.0F) * mult)` —
  // 5 free blocks, no Jump Boost term; floored at 0 by `handleFallDamage`'s `> 0` gate.
  Fx.FALL_FREE = 5;
  Fx.fallDamage = function (distance, mult) {
    return Math.max(0, Math.ceil((distance - Fx.FALL_FREE) * (mult === undefined ? 1 : mult)));
  };

  Fx.OWED = [
    'DefendFriendGoal needs ctx.trustedEntities wired from the entity list (#1286).',
    'Prey via FishEntity/SchoolingFishEntity (followFishGoal, .decomp lines 139-141) — no fish ' +
      'entity TYPE exists anywhere in this engine yet (no cod/salmon/pufferfish/tropical_fish ' +
      'ROSTER or DEFAULTS entry), so there is nothing for a fox to hunt in water.',
    'A real fox TEXTURE FAMILY in the packed atlas: tools/pack-mobtex.mjs has no fox/snow_fox ' +
      'entry at all this session, so Fx.skinKey\'s answer is real but ER.mobGeomFor\'s own ' +
      'texKey-then-layerName fallback (D-469, 07j_entityrender.js) currently always takes the ' +
      'fallback path for a fox — a standing atlas gap, not a bug introduced here.',
    '"Toast"-style custom-name reskins and the sleeping-pose SPRITE variant (DONE #1327: fox_sleep/snow_fox_sleep via Fx.skinKey; vanilla poses the ' +
      'SAME box differently when isSleeping() rather than switching texture) — Fx.skinKey ' +
      'answers red/snow only; no model/animation change for sleeping is made.'
  ];

  // ═══════════════════════════════ § TYPE — FoxEntity.Type ═══════════════════════════════════
  // .decomp lines 1453-1490, read in full: two values, RED(0)/SNOW(1), and `fromBiome` (lines
  // 1490-1492) is `precipitation == SNOW ? SNOW : RED` — no random component at all, unlike
  // `RabbitEntity.chooseType`.
  Fx.TYPE = { RED: 0, SNOW: 1 };

  /** `FoxEntity.Type.fromBiome(RegistryEntry<Biome>)` — `precip` is `NS.Biomes`'s own
   *  `PRECIP_SNOW` (2), the exact constant `Rb.chooseType`'s own header already names. */
  Fx.fromBiome = function (precip) {
    return precip === 2 /* PRECIP_SNOW */ ? Fx.TYPE.SNOW : Fx.TYPE.RED;
  };

  /** `Fx.fromBiome` fed straight off a live world position — the same `W.biomeAt(x,z)` lookup
   *  `Rb.chooseTypeAt` (07zh_rabbit.js) already uses. */
  Fx.typeAt = function (x, z) {
    var W = NS.World, B = NS.Biomes;
    if (!W || !B || !B.ready) return Fx.TYPE.RED;
    var idx = W.biomeAt(Math.floor(x), Math.floor(z));
    var biome = B.at(idx);
    if (!biome) return Fx.TYPE.RED;
    return Fx.fromBiome(biome.precipitation);
  };

  Fx.setType = function (e, type) {
    if (!e) return;
    e.foxType = (type === Fx.TYPE.SNOW) ? Fx.TYPE.SNOW : Fx.TYPE.RED;
  };

  // ═══════════════════════════════ § TRUST — two-slot trusted list ═══════════════════════════
  // `getTrustedUuids`/`addTrustedUuid` (.decomp lines 362-374): OWNER fills first, OTHER_TRUSTED
  // second, and a THIRD call overwrites OTHER_TRUSTED (vanilla's own `else` branch, read
  // verbatim — there is no third slot, the second caller always wins).
  /** The id a player is trusted under (UUID; this engine's one live player falls back to 'player'). */
  Fx.playerId = function (p) { return (p && (p.uuid || p.id)) || 'player'; };
  /** FoxEntity's FleeEntityGoal<Player> predicate: NOTICEABLE_PLAYER_FILTER (!sneaky, not creative/spectator) && !canTrust(uuid) && !aggressive. */
  Fx.fleesPlayer = function (e, p) {
    return !!(p && !p.sneaking && !p.invulnerableGamemode && !Fx.canTrust(e, Fx.playerId(p)) && !e.aggressive);
  };
  Fx.canTrust = function (e, id) {
    if (!e || !id) return false;
    return e.foxOwner === id || e.foxTrusted === id;
  };
  Fx.addTrustedId = function (e, id) {
    if (!e) return;
    if (e.foxOwner === undefined || e.foxOwner === null) e.foxOwner = id || null;
    else e.foxTrusted = id || null;
  };

  // ═══════════════════════════════ § BREEDING — createChild ══════════════════════════════════
  /** `FoxEntity.method_18260(ServerWorld, PassiveEntity)` (.decomp lines 290-294): a coin flip
   *  between THIS parent's own type and the mate's. Wired as `Breed.CHILD.fox` in 07m_breed.js;
   *  trust is handled separately by `Breed.breed`'s own caller (`MateGoal.breed`, .decomp lines
   *  1213-1230) reading `Fx.addTrustedId` off each parent's love-cause player, same file. */
  Fx.createChild = function (child, a, b, rand) {
    var type = (rand() < 0.5) ? a.foxType : b.foxType;
    Fx.setType(child, type);
  };

  // ═══════════════════════════════ § TEXTURE — red / snow ════════════════════════════════════
  // `FoxEntityRenderer` (not decompiled this pass, named on `Fx.OWED` above for the atlas side)
  // — the family split itself is unambiguous off `Fx.TYPE`: sheet 0 red, sheet 1 snow.
  Fx.SKIN = ['fox', 'snow_fox'];   // + '_sleep' while sleeping (fox_sleep / snow_fox_sleep)
  Fx.skinKey = function (e) {
    if (!e || NS.Entities.bare(e.type) !== 'fox') return null;
    return (Fx.SKIN[e.foxType | 0] || Fx.SKIN[0]) + (e.sleeping ? '_sleep' : '');   // FoxEntityRenderer.getTexture
  };

  // ═══════════════════════════════ § EAT BERRIES ══════════════════════════════════════════════
  // `FoxEntity.EatSweetBerriesGoal extends MoveToTargetPosGoal` (.decomp lines 883-964):
  // `super(fox, 1.2F, 12, 1)` — speed 1.2, range 12, maxYDifference 1 (constructor call, line
  // 165). `getDesiredDistanceToTarget()` is 2.0 (lines 891-894); the eat itself takes 40 ticks
  // once reached (`EATING_TIME`, line 884, and `timer >= 40`, lines 903-908).
  Fx.EAT_RANGE = 12;
  Fx.EAT_MAX_Y_DIFF = 1;
  Fx.EAT_SPEED = 1.2;
  Fx.EAT_DESIRED_DIST = 2.0;
  Fx.EAT_TIME = 40;

  function ageOfBush(st) {
    var S = NS.States, R = NS.Reg;
    if (!S || !R || !R.PROP || R.PROP.age === undefined) return 0;
    var v = S.propValue(st, R.PROP.age);
    return v < 0 ? 0 : +R.valueNames[v];
  }
  /** `EatSweetBerriesGoal.isTargetPos` (.decomp lines 899-902), the sweet-berry-bush half only
   *  (`SweetBerryBushBlock.AGE >= 2`) — the `CaveVines.hasBerries` half is `Fx.OWED`. */
  function isRipeBush(x, y, z) {
    var W = NS.World, S = NS.States, R = NS.Reg;
    if (!W || !S || !R || R.id.sweet_berry_bush === undefined) return false;
    var st = W.getBlock(x, y, z);
    if (st === 0 || S.block[st] !== R.id.sweet_berry_bush) return false;
    return ageOfBush(st) >= 2;
  }
  /** `CaveVines.hasBerries` — a cave_vines / cave_vines_plant state with `berries=true`. */
  function hasGlowBerries(x, y, z) {
    var W = NS.World, S = NS.States, R = NS.Reg;
    if (!W || !S || !R || !R.PROP || R.PROP.berries === undefined) return false;
    var st = W.getBlock(x, y, z);
    if (st === 0) return false;
    var b = S.block[st];
    if (b !== R.id.cave_vines && b !== R.id.cave_vines_plant) return false;
    var v = S.propValue(st, R.PROP.berries);
    return v >= 0 && R.valueNames[v] === 'true';
  }
  function isBerryTarget(x, y, z) { return isRipeBush(x, y, z) || hasGlowBerries(x, y, z); }

  function Ai_findPath(sx, sy, sz, tx, ty, tz, mob) {
    var Ai = NS.Ai;
    return (Ai && Ai.findPath) ? Ai.findPath(sx, sy, sz, tx, ty, tz, { mob: mob }) : null;
  }
  /** `Ai.pathTypeAt` (07k_goals.js, D-398) refuses to route A* ONTO a `sweet_berry_bush` cell
   *  at all (it is a DAMAGE_OTHER hazard node, the same standing rule that keeps every OTHER
   *  goal in this engine from pathing across one) — but `getDesiredDistanceToTarget()` is 2.0
   *  (.decomp line 894), so the fox never needs to stand IN the bush to eat it. Picks the
   *  nearest cardinal cell next to the bush that `Ai.groundLevel` actually calls walkable, and
   *  paths there instead — the target position used for the EAT/reach check itself (`tick`,
   *  below) is still the real bush cell, unchanged. */
  function findApproachCell(tx, ty, tz, fromX, fromZ, mob) {
    var Ai = NS.Ai;
    if (!Ai || !Ai.groundLevel) return { x: tx, y: ty, z: tz };
    var offs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    var best = null, bestD = Infinity;
    for (var i = 0; i < offs.length; i++) {
      var nx = tx + offs[i][0], nz = tz + offs[i][1];
      var gy = Ai.groundLevel(nx, ty + 1, nz, 1, mob);
      if (gy === null) continue;
      var d = Math.hypot(nx - fromX, nz - fromZ);
      if (d < bestD) { bestD = d; best = { x: nx, y: gy, z: nz }; }
    }
    return best || { x: tx, y: ty, z: tz };
  }
  /** `FoxMoveControl.tick` runs `super.tick()` only while `wantsToPickupItem()` (.decomp FoxEntity.java:1031-1042). */
  Fx.wantsToPickupItem = function (e) { return !e.sleeping && !e.sitting && !e.walking; };
  function Ai_stepToward(e, node, speed) {
    var Ai = NS.Ai;
    if (Fx.wantsToPickupItem(e) && Ai && Ai.stepToward) Ai.stepToward(e, node, speed);
  }
  Fx.stepToward = function (e, node, speed) { Ai_stepToward(e, node, speed); };
  function Ai_closeTo(e, node) {
    var Ai = NS.Ai;
    return Ai && Ai.closeTo ? Ai.closeTo(e, node) : false;
  }
  function mouthEmpty(e) {
    var Eq = NS.Equip, IT = NS.Items;
    if (!Eq || !IT || !IT.ready) return true;
    return !Eq.getEquipped(e, IT.MAINHAND);
  }
  function setMouth(e, stack) {
    var Eq = NS.Equip, IT = NS.Items;
    if (!Eq || !IT || !IT.ready) return;
    Eq.setEquipped(e, IT.MAINHAND, stack);
    // FoxEntity.drop (:673-681) always drops the mouth item; 2.0 is the guaranteed sentinel loot() sets (:488-503).
    if (stack) Eq.setDropChance(e, IT.MAINHAND, 2.0);
  }

  /** Same expanding-ring search order `Rb.EatCarrotCropGoal` (07zh_rabbit.js) already
   *  transcribes off `MoveToTargetPosGoal.findTargetPos` (lines 104-122) — first hit wins. */
  /** `EatSweetBerriesGoal.tick` not-reached branch (.decomp ~913): nextFloat < 0.05 -> entity.fox.sniff 1.0/1.0. */
  Fx.SNIFF_SOUND = 'entity.fox.sniff';
  Fx.sniffRoll = function (e, rnd) {
    if (!((rnd || rf(e))() < 0.05)) return false;
    var P = NS.Sound;
    if (P && P.play && !e.silent) P.play(Fx.SNIFF_SOUND, { x: e.x, y: e.y, z: e.z, volume: 1, pitch: 1, source: 'neutral' });
    return true;
  };

  Fx.EatSweetBerriesGoal = function (e, ctx) {
    ctx = ctx || {};
    var mobGriefing = ctx.mobGriefing || function () { return true; };
    var target = null, path = null, idx = 1, timer = 0, cooldown = 0;

    function findTarget() {
      var bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
      for (var dy = 0; dy <= Fx.EAT_MAX_Y_DIFF; dy = dy > 0 ? -dy : 1 - dy) {
        for (var r = 0; r < Fx.EAT_RANGE; r++) {
          for (var dx = 0; dx <= r; dx = dx > 0 ? -dx : 1 - dx) {
            var zLoop0 = (dx < r && dx > -r) ? r : 0;
            for (var dz = zLoop0; dz <= r; dz = dz > 0 ? -dz : 1 - dz) {
              var tx = bx + dx, ty = by + dy, tz = bz + dz;
              if (isBerryTarget(tx, ty, tz)) return { x: tx, y: ty, z: tz };
            }
          }
        }
      }
      return null;
    }

    this.canUse = function () {
      if (!mobGriefing()) return false;
      if (Fx.isSleeping(e)) return false;
      if (cooldown > 0) { cooldown--; return false; }
      cooldown = Math.ceil((200 + ri(e, 200)) / 2);
      target = findTarget();
      return !!target;
    };
    this.canContinueToUse = function () { return !!target && isBerryTarget(target.x, target.y, target.z); };
    this.start = function () {
      timer = 0; path = null; idx = 1;
      var cell = findApproachCell(target.x, target.y, target.z, e.x, e.z, e);
      path = Ai_findPath(e.x, e.y, e.z, cell.x + 0.5, cell.y, cell.z + 0.5, e);
    };
    this.stop = function () { target = null; path = null; timer = 0; };
    this.tick = function () {
      if (!target) return;
      var cx = target.x + 0.5, cy = target.y, cz = target.z + 0.5;
      var d = Math.hypot(cx - e.x, cz - e.z) + Math.abs(cy - e.y);
      if (d <= Fx.EAT_DESIRED_DIST) {
        if (timer >= Fx.EAT_TIME) { eatBerry(); target = null; cooldown = 10; }
        else timer++;
        return;
      }
      Fx.sniffRoll(e, ctx.random);
      if (!path || idx >= path.length) {
        var cell = findApproachCell(target.x, target.y, target.z, e.x, e.z, e);
        path = Ai_findPath(e.x, e.y, e.z, cell.x + 0.5, cell.y, cell.z + 0.5, e);
      }
      if (path && idx < path.length) {
        Ai_stepToward(e, path[idx], Fx.EAT_SPEED);
        if (Ai_closeTo(e, path[idx])) idx++;
      }
    };

    function eatBerry() {
      var W = NS.World, S = NS.States, R = NS.Reg, Bh = NS.Behave;
      if (!W || !S || !R || !Bh) return;
      if (!mobGriefing()) return;   // `eatSweetBerry` (.decomp 922-931) re-reads DO_MOB_GRIEFING on every pick
      var x = target.x, y = target.y, z = target.z;
      var st = W.getBlock(x, y, z);
      if (st !== 0 && hasGlowBerries(x, y, z)) {
        // `CaveVines.pickBerries`: one glow_berries, the vine back to berries=false
        var nx = Bh.setProp(st, 'berries', false);
        if (NS.EntityList && NS.EntityList.dropStack) NS.EntityList.dropStack(x + 0.5, y + 0.5, z + 0.5, 'glow_berries', 1);
        if (NS.Sound && NS.Sound.play) NS.Sound.play('block.cave_vines.pick_berries', { x: x + 0.5, y: y + 0.5, z: z + 0.5, source: 'block', volume: 1, pitch: 0.8 + rf(e)() * 0.4 });
        W.setBlock(x, y, z, nx);
        if (NS.Save && NS.Save.record) NS.Save.record(x, y, z, nx);
        return;
      }
      if (st === 0 || S.block[st] !== R.id.sweet_berry_bush) return;
      // `.decomp` lines 936-943: age 1..3 -> 1 + rand(2) + (age==3?1:0) berries drop, the
      // bush is left at age 1 (NOT 0 — the jar's own off-by-one, kept verbatim), and one of
      // those berries fills the mouth slot first if it was empty.
      var age = ageOfBush(st);
      var count = 1 + ri(e, 2) + (age === 3 ? 1 : 0);
      if (mouthEmpty(e)) {
        var Eq = NS.Equip;
        if (Eq && Eq.stackOf) setMouth(e, Eq.stackOf('sweet_berries'));
        count--;
      }
      if (count > 0 && NS.EntityList && NS.EntityList.dropStack) {
        NS.EntityList.dropStack(x + 0.5, y + 0.5, z + 0.5, 'sweet_berries', count);
      }
      var next = Bh.setProp(st, 'age', 1);
      var P = NS.Sound;   // `pickSweetBerries`: field_17617 at 1.0/1.0 after the drop
      if (P && P.play && !e.silent) P.play('block.sweet_berry_bush.pick_berries', { x: e.x, y: e.y, z: e.z, volume: 1, pitch: 1, source: 'neutral' });
      W.setBlock(x, y, z, next);
      if (NS.Save && NS.Save.record) NS.Save.record(x, y, z, next);
    }
  };

  // ═══════════════════════════════ § PICKUP — carry an item in the mouth ═════════════════════
  // `FoxEntity.PickupItemGoal` (.decomp lines 1312-1354): an 8-block box search, first item in
  // the world's own iteration order (`.get(0)`, not nearest), refused while the mouth is full
  // or a target/attacker is set, one-in-ten-real-ticks throttle on `canUse` (`toGoalTicks(10)`,
  // 20 real ticks — `Goal.toGoalTicks` is `n*3` on EASY/`n*2` NORMAL/`n` HARD; this engine has
  // no live difficulty-scaled goal-tick helper yet, so NORMAL's `n*2` = 20 is used, matching
  // `Ai.MOB_ATTACK_INTERVAL`'s own standing NORMAL-only simplification elsewhere in this file).
  Fx.PICKUP_RANGE = 8;
  Fx.PickupItemGoal = function (e, ctx) {
    var target = null;
    function nearbyItems() {
      var EL = NS.EntityList;
      if (!EL || !EL.list) return [];
      var out = [];
      for (var i = 0; i < EL.list.length; i++) {
        var o = EL.list[i];
        // `PICKABLE_DROP_FILTER` (.decomp line 96): `!cannotPickup() && isAlive()` —
        // `cannotPickup()` is `pickupDelay > 0` (ItemEntity.java:395; the 32767
        // never-pickup sentinel `EL.PICKUP_NEVER` is included).
        if (o.removed || o.type !== 'item' || o.pickupDelay > 0) continue;
        // getBoundingBox().expand(8,8,8): a box (fox 0.6 x 0.7), not a sphere
        if (Math.abs(o.x - e.x) <= Fx.PICKUP_RANGE + 0.3 && Math.abs(o.z - e.z) <= Fx.PICKUP_RANGE + 0.3 &&
            o.y >= e.y - Fx.PICKUP_RANGE && o.y <= e.y + 0.7 + Fx.PICKUP_RANGE) out.push(o);
      }
      return out;
    }
    this.canUse = function () {
      if (!mouthEmpty(e)) return false;
      if (e.target || e.attacker) return false;
      if (!Fx.wantsToPickupItem(e)) return false;
      // vanilla: random.nextInt(toGoalTicks(10)) == 0, toGoalTicks(10) = 5
      if ((ctx && ctx.random ? Math.floor(ctx.random() * 5) : ri(e, 5)) !== 0) return false;
      var items = nearbyItems();
      if (!items.length) return false;
      target = items[0];
      return true;
    };
    this.canContinueToUse = function () { return false; };  // one-shot, same shape as vanilla's per-tick re-poll
    this.start = function () {};
    this.stop = function () { target = null; };
    this.tick = function () {
      var items = nearbyItems();
      if (!mouthEmpty(e) || !items.length) return;
      var it = items[0];
      Ai_stepToward(e, { x: it.x, y: it.y, z: it.z }, 1.2);
      if (Math.hypot(it.x - e.x, it.y - e.y, it.z - e.z) < 1.0) Fx.loot(e, it);
    };
  };

  // ═══════════════════════════════ § HUNT — stalk chickens/rabbits ═══════════════════════════
  // `FoxEntity.MoveToHuntGoal` (.decomp lines 1255-1291): starts on a live chicken/rabbit
  // target farther than 6 blocks (36 squared), walks toward it, and sets crouch+rolling-head
  // (the stalking pose) once within 6 — `Ai.MeleeAttackGoal` (reused, generic) then closes the
  // final distance and lands the attack.
  Fx.HUNT_STOP_SQ = 36;
  Fx.CHICKEN_AND_RABBIT = { chicken: true, rabbit: true };
  Fx.MoveToHuntGoal = function (e, ctx) {
    var path = null, idx = 1;
    function distSq() {
      if (!e.target) return Infinity;
      var dx = e.target.x - e.x, dy = (e.target.y || 0) - e.y, dz = e.target.z - e.z;
      return dx * dx + dy * dy + dz * dz;
    }
    this.canUse = function () {
      if (Fx.isSleeping(e) || e.crouching || e.rollingHead || e.jumping) return false;
      var t = e.target;
      return !!(t && !t.removed && !t.dead && Fx.CHICKEN_AND_RABBIT[NS.Entities.bare(t.type)] &&
        distSq() > Fx.HUNT_STOP_SQ);
    };
    this.canContinueToUse = this.canUse;
    this.start = function () { e.sitting = false; e.walking = false; path = null; idx = 1; };
    this.stop = function () {
      var t = e.target;
      if (t && Fx.canJumpChase(e, t, ctx && ctx.isReplaceable)) { e.crouching = true; e.rollingHead = true; }
      else { e.crouching = false; e.rollingHead = false; }
    };
    this.tick = function () {
      var t = e.target;
      if (!t) return;
      if (distSq() <= Fx.HUNT_STOP_SQ) { e.crouching = true; e.rollingHead = true; return; }
      if (!path || idx >= path.length) path = Ai_findPath(e.x, e.y, e.z, t.x, t.y, t.z, e);
      if (path && idx < path.length) {
        Ai_stepToward(e, path[idx], 1.5);
        if (Ai_closeTo(e, path[idx])) idx++;
      }
    };
  };

  // ═══════════════════════════════ § CALM-DOWN / SLEEP / DAYLIGHT / WANDER / DEFEND ═══════════
  // The vanilla goals (.decomp FoxEntity.java 739-880, 1354-1470): StopWandering 1, AvoidDaylight 6,
  // DelayedCalmDown 7, SitDownAndLookAround 13, DefendFriend (target 3). Environment queries are
  // ctx-overridable (node checks); defaults read Sky/World.
  function envOf(ctx) {
    ctx = ctx || {};
    var S = NS.Sky, W = NS.World;
    return {
      rand: ctx.random || rf(ctx.e),
      isDay: ctx.isDay || function () { return !!(S && S.isDay && S.isDay()); },
      thundering: ctx.isThundering || function () { return !!(S && S.isThundering && S.isThundering()); },
      sky: ctx.canSeeSky || function (x, y, z) { return !!(W && W.canSeeSky && W.canSeeSky(x, y, z)); },
      nearVillage: ctx.isNearVillage || function () { return false; },
      worriers: ctx.worriers || function () { return []; },   // LivingEntity candidates within 12/6/12 passing WorriableEntityFilter
      favor: ctx.favor || Ai_animalFavor
    };
  }
  function Ai_animalFavor(x, y, z) { return NS.Ai.animalPathfindingFavor(x, y, z); }
  Fx.CALM_MAX = 140;
  Fx.AVOID_DAYLIGHT_TIMER = 100;
  /** CalmDownGoal.isAtFavoredLocation: no sky at (x, maxY, z) and getPathfindingFavor >= 0. */
  Fx.isAtFavoredLocation = function (e, env) {
    var x = Math.floor(e.x), y = Math.floor(e.y + (e.height || 0.7)), z = Math.floor(e.z);
    return !env.sky(x, y, z) && env.favor(x, y, z) >= 0;
  };
  /** CalmDownGoal.canCalmDown: a worrying entity (WorriableEntityFilter) is within 12. */
  Fx.canCalmDown = function (e, env) { return env.worriers(e).length > 0; };
  Fx.isSleeping = function (e) { return !!(e && e.sleeping); };
  Fx.stopActions = function (e) {
    e.sitting = false; e.crouching = false; e.rollingHead = false;
    e.sleeping = false; e.walking = false; e.aggressive = false;
  };

  /** `Entity.getFluidHeight(WATER)` at the feet: the deepest water cell's surface above e.y (Wx.fluidHeight; 1 = water kind). */
  Fx.waterHeight = function (e) {
    var Wx = NS.Weather, W = NS.World, h = 0;
    if (!Wx || !W || !W.getBlock) return 0;
    for (var cy = Math.floor(e.y), n = 0; n < 2; n++, cy++) {
      var x = Math.floor(e.x), z = Math.floor(e.z);
      if (Wx.fluidOf(W.getBlock(x, cy, z))[0] === 1) h = Math.max(h, cy + Wx.fluidHeight(x, cy, z) - e.y);
    }
    return h;
  };
  /** `FoxEntity.FoxSwimGoal extends SwimGoal` (:1044-1059): canStart = touching water && fluidHeight > 0.25 || inLava; start() = stopActions(). */
  Fx.FoxSwimGoal = function (e, ctx) {
    NS.Ai.FloatGoal.call(this, e, ctx && ctx.random);
    this.canUse = function () { return !!(e.inWater && ((ctx && ctx.waterHeight) || Fx.waterHeight)(e) > 0.25 || e.inLava); };
    this.canContinueToUse = this.canUse;
    this.start = function () { Fx.stopActions(e); };
  };

  /** `FoxEntity.MateGoal extends AnimalMateGoal`: the generic breed walk; the trust-the-lovers half lives in `Breed.breed` (07m_breed.js). */
  Fx.MateGoal = function (e, speed, getPartners, onBreed) {
    NS.Ai.BreedGoal.call(this, e, speed, getPartners, onBreed);
    var base = this.start, self = this;
    // MateGoal.start (:1203-1206): stopActions on animal AND mate (BreedGoal keeps the mate private; it is e.breedTarget after start)
    this.start = function () { Fx.stopActions(e); base.call(self); if (e.breedTarget) Fx.stopActions(e.breedTarget); };
  };

  Fx.StopWanderingGoal = function (e, ctx) {
    var timer = 0;
    this.canUse = function () { return !!e.walking; };
    this.canContinueToUse = function () { return !!e.walking && timer > 0; };
    this.start = function () { timer = 40; };
    this.stop = function () { e.walking = false; };
    this.tick = function () { timer--; };
  };

  Fx.AvoidDaylightGoal = function (e, ctx) {
    var env = envOf(ctx), Ai = NS.Ai;
    var timer = Fx.AVOID_DAYLIGHT_TIMER;
    var shaded = function () {
      // EscapeSunlightGoal.targetShadedPos: reuse its shaded-position search without its own
      // on-fire/head-slot gates (the fox variant skips them).
      var bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
      for (var i = 0; i < 10; i++) {
        var x = bx + Math.floor(env.rand() * 20) - 10, y = by + Math.floor(env.rand() * 6) - 3, z = bz + Math.floor(env.rand() * 20) - 10;
        if (!env.sky(x, y, z) && env.favor(x, y, z) < 0) {
          var cp = Ai.findPath(e.x, e.y, e.z, x + 0.5, y, z + 0.5, { mob: e });
          if (!cp || cp.length < 2) return false;
          path = cp; idx = 1;
          return true;
        }
      }
      return false;
    };
    var path = null, idx = 1;
    this.canUse = function () {
      if (e.sleeping || e.target) return false;
      if (env.thundering()) return shaded();
      if (timer > 0) { timer--; return false; }
      timer = 100;
      return env.isDay() && env.sky(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z)) &&
        !env.nearVillage(e) && shaded();
    };
    this.canContinueToUse = function () { return !!path && idx < path.length; };
    this.start = function () { Fx.stopActions(e); idx = 1; };
    this.stop = function () { path = null; };
    this.tick = function () {
      if (!path || idx >= path.length) { path = null; return; }
      Ai.stepToward(e, path[idx], 1.25);
      idx = Ai.advancePathNode(e, path, idx);
    };
  };

  /** DelayedCalmDownGoal (priority 7): the vanilla sleep gate. */
  Fx.DelayedCalmDownGoal = function (e, ctx) {
    var env = envOf(ctx);
    var timer = Math.floor(env.rand() * Fx.CALM_MAX);
    var canNotCalmDown = function () {
      if (timer > 0) { timer--; return false; }
      return env.isDay() && Fx.isAtFavoredLocation(e, env) && !Fx.canCalmDown(e, env) && !e.inPowderSnow;
    };
    this.canUse = function () {
      if (e.sidewaysSpeed || e.upwardSpeed || e.forwardSpeed) return false;
      return canNotCalmDown() || !!e.sleeping;
    };
    this.canContinueToUse = function () { return canNotCalmDown(); };
    this.start = function () {
      e.sitting = false; e.crouching = false; e.rollingHead = false; e.jumping = false;
      e.sleeping = true;
      e.path = null;
    };
    this.stop = function () { timer = Math.floor(env.rand() * Fx.CALM_MAX); Fx.stopActions(e); };
  };
  Fx.SleepByDayGoal = Fx.DelayedCalmDownGoal;   // old name

  Fx.SitDownAndLookAroundGoal = function (e, ctx) {
    var env = envOf(ctx);
    var timer = 0, counter = 0, lookX = 0, lookZ = 0;
    var choose = function () {
      var a = Math.PI * 2 * env.rand();
      lookX = Math.cos(a); lookZ = Math.sin(a);
      timer = 80 + Math.floor(env.rand() * 20);
    };
    this.canUse = function () {
      return !e.attacker && env.rand() < 0.02 && !e.sleeping && !e.target &&
        !(e.path && e.path.length) && !Fx.canCalmDown(e, env) && !e.chasing && !e.crouching;
    };
    this.canContinueToUse = function () { return counter > 0; };
    this.start = function () { choose(); counter = 2 + Math.floor(env.rand() * 3); e.sitting = true; e.path = null; };
    this.stop = function () { e.sitting = false; };
    this.tick = function () {
      timer--;
      if (timer <= 0) { counter--; choose(); }
      e.lookAtX = e.x + lookX; e.lookAtY = e.y + (e.eyeHeight || 0.4); e.lookAtZ = e.z + lookZ;
    };
  };

  /** DefendFriendGoal (targetSelector 3): retaliate on whoever just hit a trusted player. */
  Fx.DefendFriendGoal = function (e, ctx) {
    ctx = ctx || {};
    var rand = ctx.random || rf(e);
    var friends = ctx.trustedEntities || function (fx) { return []; };
    var offender = null, friend = null, lastTime = 0;
    this.canUse = function () {
      if (Math.floor(rand() * 10) !== 0) return false;   // reciprocalChance 10 (reducedTickDelay -> 5 handled by caller's rand)
      var list = friends(e);
      for (var i = 0; i < list.length; i++) {
        var f = list[i];
        if (!f) continue;
        friend = f; offender = f.lastAttacker || f.attacker || null;
        var t = f.lastAttackedTime || 0;
        return t !== lastTime && !!offender && offender.alive !== false && !Fx.canTrust(e, offender.uuid || offender.id);
      }
      return false;
    };
    this.canContinueToUse = function () { return !!e.target && e.target.alive !== false; };
    this.start = function () {
      e.target = offender;
      if (friend) lastTime = friend.lastAttackedTime || 0;
      e.aggressive = true; e.sleeping = false;
    };
  };
  /** FoxEntity.canJumpChase (.decomp 683-701): six samples along the line to the target, three blocks up each, all replaceable. */
  Fx.canJumpChase = function (e, t, replaceable) {
    replaceable = replaceable || function (x, y, z) {
      var SR = NS.States, W = NS.World;
      return !!(SR && W && SR.replaceable[W.getBlock(x, y, z)] === 1);
    };
    var dz = t.z - e.z, dx = t.x - e.x, slope = dz / dx;
    for (var i = 0; i < 6; i++) {
      var f = Math.fround(i / 6);
      var oz = slope === 0 ? 0 : dz * f;
      var ox = slope === 0 ? dx * f : oz / slope;
      for (var h = 1; h < 4; h++) {
        if (!replaceable(Math.floor(e.x + ox), Math.floor(e.y + h), Math.floor(e.z + oz))) return false;
      }
    }
    return true;
  };
  /** isFullyCrouched: extraRollingHeight == 3.0, i.e. 15 ticks in the sneaking pose (FoxEntity.java:564). */
  Fx.isFullyCrouched = function (e) { return (e.crouchTicks | 0) >= 15; };
  /** FoxEntity.JumpChasingGoal (.decomp 1087-1183, priority 6): the crouched fox's dive arc onto its target. */
  Fx.JumpChasingGoal = function (e, ctx) {
    ctx = ctx || {};
    var replaceable = ctx.isReplaceable;
    this.canUse = function () {
      if (!Fx.isFullyCrouched(e)) return false;
      var t = e.target;
      if (!t || t.removed || t.dead) return false;
      if (t.movementDirection !== undefined && t.movementDirection !== t.horizontalFacing) return false;
      var ok = Fx.canJumpChase(e, t, replaceable);
      if (!ok) { e.path = null; e.crouching = false; e.rollingHead = false; }
      return ok;
    };
    this.canContinueToUse = function () {
      var t = e.target;
      if (!t || t.removed || t.dead) return false;
      var vy = e.vy || 0;
      return (!(vy * vy < 0.05) || !(Math.abs(e.pitch || 0) < 15) || !e.onGround) && !e.walking;
    };
    this.isInterruptable = false;
    this.start = function () {
      var t = e.target;
      e.jumping = true; e.chasing = true; e.rollingHead = false;
      if (t) {
        var dx = t.x - e.x, dy = (t.y || 0) - e.y, dz = t.z - e.z, l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        e.vx = (e.vx || 0) + dx / l * 0.8; e.vy = (e.vy || 0) + 0.9; e.vz = (e.vz || 0) + dz / l * 0.8;
      }
      e.path = null;
    };
    this.stop = function () { e.crouching = false; e.rollingHead = false; e.chasing = false; };
    this.tick = function () {
      var t = e.target;
      if (!e.walking) {
        var vx = e.vx || 0, vy = e.vy || 0, vz = e.vz || 0, h = Math.sqrt(vx * vx + vz * vz), len = Math.sqrt(vx * vx + vy * vy + vz * vz);
        var pitch = e.pitch || 0;
        if (vy * vy < 0.03 && pitch !== 0) e.pitch = pitch + (0 - pitch) * 0.2;
        else e.pitch = len > 0 ? Math.sign(-vy) * Math.acos(Math.min(1, h / len)) * 180 / Math.PI : 0;
      }
      var d = t ? Math.hypot(t.x - e.x, (t.y || 0) - e.y, t.z - e.z) : Infinity;
      if (t && d <= 2) { if (NS.Combat && NS.Combat.mobAttack) NS.Combat.mobAttack(e, t); }
      else if ((e.pitch || 0) > 0 && e.onGround && e.vy && (ctx.isInSnow || (NS.Undead && NS.Undead.isInPowderSnow))(e)) {
        e.pitch = 60; e.target = null; e.walking = true;
      }
    };
  };

  /** FoxEntity.GoToVillageGoal(400, 200) over GoToVillageGoal (.decomp 1061-1085): at night, walk toward an occupied POI section. */
  Fx.GoToVillageGoal = function (e, ctx) {
    ctx = ctx || {};
    var env = envOf(ctx), rand = env.rand;
    var searchRange = Math.floor((200 + 1) / 2);   // toGoalTicks(200)
    var target = null, path = null, idx = 1;
    function pois() { return ctx.occupiedPositions ? ctx.occupiedPositions() : (NS.Poi && NS.Poi.occupiedPositions ? NS.Poi.occupiedPositions() : []); }
    function can() { return !e.sleeping && !e.sitting && !e.aggressive && !e.target; }
    this.canUse = function () {
      if (!can()) return false;
      if (e.passengers && e.passengers.length) return false;
      if (env.isDay()) return false;
      if (Math.floor(rand() * searchRange) !== 0) return false;
      var ps = pois(), bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
      var sec = function (v) { return Math.floor(v) >> 4; }, near = false;
      for (var i = 0; i < ps.length; i++) {
        if (Math.max(Math.abs(sec(ps[i].x) - sec(bx)), Math.abs(sec(ps[i].y) - sec(by)), Math.abs(sec(ps[i].z) - sec(bz))) <= 6) { near = true; break; }
      }
      if (!near) return false;
      var best = -Infinity, cand = null;
      for (var t = 0; t < 10; t++) {   // FuzzyTargeting.find(15, 7), scored by -(section distance to a POI)
        var x = bx + Math.floor(rand() * 31) - 15, y = by + Math.floor(rand() * 15) - 7, z = bz + Math.floor(rand() * 31) - 15;
        var d = Infinity;
        for (var j = 0; j < ps.length; j++) d = Math.min(d, Math.max(Math.abs(sec(ps[j].x) - sec(x)), Math.abs(sec(ps[j].y) - sec(y)), Math.abs(sec(ps[j].z) - sec(z))));
        if (-d > best) { best = -d; cand = { x: x, y: y, z: z }; }
      }
      if (!cand) return false;
      target = cand;
      path = Ai_findPath(e.x, e.y, e.z, cand.x + 0.5, cand.y, cand.z + 0.5, e);
      idx = 1;
      return !!(path && path.length > 1);
    };
    this.canContinueToUse = function () { return can() && !!path && idx < path.length; };
    this.start = function () { Fx.stopActions(e); idx = 1; };
    this.stop = function () { path = null; target = null; };
    this.tick = function () {
      if (path && idx < path.length) {
        Ai_stepToward(e, path[idx], 1.0);
        if (Ai_closeTo(e, path[idx])) idx++;
      }
    };
  };
  /** `FoxEntity.tickMovement`'s own sleeping-freezes-input half (.decomp lines 212-216). */
  Fx.tickSleeping = function (e) {
    if (!e || !Fx.isSleeping(e)) return;
    e.jumping = false;
    e.sidewaysSpeed = 0;
    e.forwardSpeed = 0;
  };

  // ═══════════════════════════════ § MOUTH ITEM — initEquipment + tickMovement eating ═══════
  // `FoxEntity.initEquipment` (.decomp lines 233-252): 20% to hold anything, then one roll of
  // [0,1): <0.05 emerald, <0.2 egg, <0.4 rabbit_foot or rabbit_hide (coin flip), <0.6 wheat,
  // <0.8 leather, else feather. `tickMovement` (lines 184-205): eatingTime++ every tick, and
  // while the held item is food and the fox has no target, is on the ground and awake: past
  // 560 a 10% roll plays `entity.fox.eat` + status 45 (8 item-crack particles), past 600
  // `finishUsing` (one of the stack is eaten) and the timer resets.
  Fx.EAT_START = 560;
  Fx.EAT_DONE = 600;
  Fx.EAT_SOUND = 'entity.fox.eat';
  Fx.initEquipment = function (e, rnd) {
    var r = rnd || rf(e), Eq = NS.Equip, IT = NS.Items;
    if (!Eq || !IT || !IT.ready) return null;
    if (!(r() < 0.2)) return null;
    var f = r(), name;
    if (f < 0.05) name = 'emerald';
    else if (f < 0.2) name = 'egg';
    else if (f < 0.4) name = r() < 0.5 ? 'rabbit_foot' : 'rabbit_hide';
    else if (f < 0.6) name = 'wheat';
    else if (f < 0.8) name = 'leather';
    else name = 'feather';
    var st = Eq.stackOf(name);
    if (st) setMouth(e, st);
    return st;
  };
  function isFoodStack(st) {
    var IT = NS.Items;
    return !!(st && IT && IT.ready && IT.nutrition && IT.nutrition[st.i] > 0);
  }
  Fx.canEat = function (e, st) {
    return isFoodStack(st) && !e.target && !!e.onGround && !Fx.isSleeping(e);
  };
  /** `handleStatus(45)`: 8 item-crack particles of the held stack at the mouth. */
  Fx.eatParticles = function (e, rnd) {
    var r = rnd || rf(e), Px = NS.Particles, Eq = NS.Equip, IT = NS.Items, n = 0;
    var st = Eq && IT ? Eq.getEquipped(e, IT.MAINHAND) : null;
    if (!st || !Px || !Px.spawn) return 0;
    var yaw = (e.yaw || 0) * Math.PI / 180, nm = IT.nameOf ? IT.nameOf(st.i) : undefined;
    for (var i = 0; i < 8; i++) {
      var vx = (r() - 0.5) * 0.1, vy = r() * 0.1 + 0.1;
      var q = Px.spawn('item_crack', e.x - Math.sin(yaw) / 2, e.y, e.z + Math.cos(yaw) / 2,
        vx * Math.cos(-yaw), vy + 0.05, vx * Math.sin(-yaw), undefined, nm);
      if (q) n++;
    }
    return n;
  };
  /** `canPickupItem` (.decomp 466-470): empty mouth, or still chewing food and the item is food
   *  while the held one is not. */
  Fx.canPickupItem = function (e, st) {
    var Eq = NS.Equip, IT = NS.Items;
    if (!Eq || !IT || !IT.ready) return false;
    var held = Eq.getEquipped(e, IT.MAINHAND);
    return !held || ((e.eatingTime | 0) > 0 && isFoodStack(st) && !isFoodStack(held));
  };
  Fx.SPIT_DELAY = 40;
  Fx.SPIT_SOUND = 'entity.fox.spit';
  Fx.spit = function (e, st) {
    var EL = NS.EntityList;
    if (!st || !st.n || !EL || !EL.dropStack) return null;
    var yaw = (e.yaw || 0) * Math.PI / 180;
    var it = EL.dropStack(e.x - Math.sin(yaw), e.y + 1.0, e.z + Math.cos(yaw), NS.Items.nameOf(st.i), st.n,
      { pickupDelay: Fx.SPIT_DELAY });
    if (it && e.uuid) it.thrower = e.uuid;
    var P = NS.Sound;
    if (P && P.play && !e.silent) P.play(Fx.SPIT_SOUND, { x: e.x, y: e.y, z: e.z, volume: 1, pitch: 1, source: 'neutral' });
    return it;
  };
  Fx.BITE_SOUND = 'entity.fox.bite';
  /** `FoxEntity.AttackGoal.attack` (.decomp 708-721): `playSound(field_18058, 1.0F, 1.0F)` after each tryAttack. */
  Fx.bite = function (e) {
    var P = NS.Sound;
    if (P && P.play && !e.silent) P.play(Fx.BITE_SOUND, { x: e.x, y: e.y, z: e.z, volume: 1, pitch: 1, source: 'neutral' });
  };
  /** `FoxEntity.AttackGoal extends MeleeAttackGoal(1.2, true)`: generic melee, bite sound after each tryAttack. */
  Fx.AttackGoal = function (e) {
    var melee = new NS.Ai.MeleeAttackGoal(e, 1.2, null, function () { Fx.bite(e); });
    // AttackGoal.canStart (:729-736): !isSitting && !isSleeping && !isInSneakingPose && !isWalking; start() clears rollingHead (:724-727)
    this.canUse = function () { return !e.sitting && !e.sleeping && !e.crouching && !e.walking && melee.canUse(); };
    this.canContinueToUse = function () { return melee.canContinueToUse(); };
    this.start = function () { e.rollingHead = false; melee.start(); };
    this.stop = function () { melee.stop(); };
    this.tick = function () { melee.tick(); };
  };
  /** `FoxEntity.LookAtEntityGoal` (:1184-1198): LookAtPlayerGoal gated on !isWalking && !isRollingHead (canStart and shouldContinue). */
  Fx.LookAtEntityGoal = function (e, getPlayers, range) {
    var look = new NS.Ai.LookAtPlayerGoal(e, getPlayers, range);
    this.canUse = function () { return !e.walking && !e.rollingHead && look.canUse(); };
    this.canContinueToUse = function () { return !e.walking && !e.rollingHead && look.canContinueToUse(); };
    this.start = function () { look.start(); };
    this.stop = function () { look.stop(); };
    this.tick = function () { look.tick(); };
  };
  /** `FoxEntity.loot` (.decomp 490-506): drop count-1 on the ground, spit the old mouth item,
   *  hold exactly one, discard the entity, eatingTime = 0. Returns whether it was taken. */
  Fx.loot = function (e, it) {
    var Eq = NS.Equip, IT = NS.Items, EL = NS.EntityList;
    if (!Eq || !IT || !IT.ready || !it || it.removed) return false;
    var i = IT.of(it.item), n = it.count | 0;
    if (i < 0 || n < 1) return false;
    if (!Fx.canPickupItem(e, { i: i, n: n })) return false;
    // MobEntity.tickMovement loot gate: mobGriefing, alive, canMoveVoluntarily (!NoAI)
    var EC = EL && EL.aiCtx ? EL.aiCtx(e) : null;
    if (e.dead || e.aiDisabled || (EC && EC.mobGriefing && !EC.mobGriefing())) return false;
    if (n > 1 && EL && EL.dropStack) EL.dropStack(e.x, e.y, e.z, it.item, n - 1);
    Fx.spit(e, Eq.getEquipped(e, IT.MAINHAND));
    var one = Eq.stackOf(it.item);
    if (!one) return false;
    setMouth(e, one);
    Eq.triggerPickedUp(e, it);
    it.removed = true;
    e.eatingTime = 0;
    return true;
  };
  /** `FoxEntity.tick` (.decomp 508-526): water / a target / thunder wake it, water or sleep stand it
   *  up, and a walking fox 20% of ticks plays worldEvent 2001 for the block it stands in. */
  Fx.tickWake = function (e, rnd, thundering) {
    var r = rnd || rf(e);
    var water = !!e.inWater;
    if (water || e.target || (thundering === undefined ? envOf().thundering() : thundering)) e.sleeping = false;
    if (water || e.sleeping) e.sitting = false;
    if (e.walking && r() < 0.2) {
      var W = NS.World, bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
      var st = W && W.getBlock ? W.getBlock(bx, by, bz) : 0;
      var Sd = NS.Sound, Px = NS.Particle;
      if (Sd && Sd.blockBreak) Sd.blockBreak(st, bx + 0.5, by + 0.5, bz + 0.5, null);
      if (Px && Px.spawnBlockDust) for (var i = 0; i < 8; i++)
        Px.spawnBlockDust(bx + r(), by + 0.1 + r() * 0.8, bz + r(), 0, 0.1, 0, st, bx, by, bz, r);
    }
  };
  /** FoodComponents status effects [effect, ticks, amplifier, chance] (.decomp FoodComponents.java). */
  Fx.FOOD_EFFECTS = {
    chicken: [['hunger', 600, 0, 0.3]], rotten_flesh: [['hunger', 600, 0, 0.8]],
    spider_eye: [['poison', 100, 0, 1]], poisonous_potato: [['poison', 100, 0, 0.6]],
    pufferfish: [['poison', 1200, 1, 1], ['hunger', 300, 2, 1], ['nausea', 300, 0, 1]],
    golden_apple: [['regeneration', 100, 1, 1], ['absorption', 2400, 0, 1]],
    enchanted_golden_apple: [['regeneration', 400, 1, 1], ['resistance', 6000, 0, 1], ['fire_resistance', 6000, 0, 1], ['absorption', 2400, 3, 1]]
  };
  /** Leftovers returned by finishUsing (StewItem, HoneyBottleItem). */
  Fx.FOOD_REMAINDER = { mushroom_stew: 'bowl', rabbit_stew: 'bowl', beetroot_soup: 'bowl', suspicious_stew: 'bowl', honey_bottle: 'glass_bottle' };
  /** `LivingEntity.eatFood` (:3196): eat sound, applyFoodEffects, decrement, re-equip a non-empty remainder. */
  Fx.finishEating = function (e, st, rnd) {
    var r = rnd || rf(e), IT = NS.Items, Eq = NS.Equip, P = NS.Sound, ES = NS.Effects;
    var name = IT.nameOf(st.i);
    if (P && P.play && !e.silent) P.play(Fx.EAT_SOUND, { x: e.x, y: e.y, z: e.z, volume: 1, pitch: 1 + (r() - r()) * 0.4, source: 'neutral' });
    var fe = Fx.FOOD_EFFECTS[name] || [];
    for (var i = 0; i < fe.length; i++)
      if (ES && ES.addStatusEffect && r() < fe[i][3]) ES.addStatusEffect(e, fe[i][0], fe[i][1], fe[i][2], false, true);
    if (name === 'suspicious_stew' && st.t && st.t.Effects)   // SuspiciousStewItem.finishUsing: duration default 160
      for (i = 0; i < st.t.Effects.length; i++) {
        var row = st.t.Effects[i], en = ES && ES.NAMES && ES.NAMES[row.EffectId | 0];
        if (en) ES.addStatusEffect(e, en, row.EffectDuration !== undefined ? row.EffectDuration | 0 : 160, 0, false, true);
      }
    if (name === 'chorus_fruit' && NS.Enderman && NS.Enderman.chorusTeleport) NS.Enderman.chorusTeleport(e, r, { sound: 'entity.fox.teleport' });   // ChorusFruitItem.finishUsing
    st.n--;
    if (st.n > 0) return;
    var rem = Fx.FOOD_REMAINDER[name];
    setMouth(e, rem ? Eq.stackOf(rem) : null);
  };
  Fx.mobTick = function (e, rnd) {
    var r = rnd || rf(e), Eq = NS.Equip, IT = NS.Items;
    if (!e || e.dead || e.removed) return;
    Fx.tickWake(e, r);
    e.crouchTicks = e.crouching ? Math.min(15, (e.crouchTicks | 0) + 1) : 0;   // extraRollingHeight += 0.2 (FoxEntity.java:535-543)
    if (!Eq || !IT || !IT.ready) return;
    if (e.aiDisabled) return;        // canMoveVoluntarily gate (FoxEntity.tickMovement)
    var tg = e.target;
    if (!tg || tg.dead || tg.removed || tg.alive === false) { e.crouching = false; e.rollingHead = false; }   // tickMovement :203-209
    e.eatingTime = (e.eatingTime | 0) + 1;
    var EL = NS.EntityList;
    if (EL && EL.list) {
      for (var k = 0; k < EL.list.length; k++) {
        var o = EL.list[k];
        if (o.removed || o.type !== 'item' || o.pickupDelay > 0) continue;
        if (Math.abs(o.x - e.x) <= 1.3 && Math.abs(o.z - e.z) <= 1.3 && Math.abs(o.y - e.y) <= 1.0 && Fx.loot(e, o)) break;
      }
    }
    var st = Eq.getEquipped(e, IT.MAINHAND);
    if (!Fx.canEat(e, st)) return;
    if (e.eatingTime > Fx.EAT_DONE) {
      Fx.finishEating(e, st, r);
      e.eatingTime = 0;
    } else if (e.eatingTime > Fx.EAT_START && r() < 0.1) {
      var P = NS.Sound;
      if (P && P.play && !e.silent) P.play(Fx.EAT_SOUND, { x: e.x, y: e.y, z: e.z, volume: 1, pitch: 1, source: 'neutral' });
      Fx.eatParticles(e, r);
    }
  };

  Fx.ready = true;

})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
