// 07zq_snowgolem.js — loop/snowgolem: the SNOW GOLEM, whole.
// Runs on: MAIN THREAD ONLY. No DOM.
//
// Everything here is read off `.decomp/net/minecraft/entity/passive/SnowGolemEntity.java`,
// `.decomp/net/minecraft/entity/projectile/thrown/SnowballEntity.java` and
// `.decomp/net/minecraft/block/CarvedPumpkinBlock.java` (1.18.2, Yarn-named, all three read in
// full) unless a comment says otherwise. Dimensions ([0.7, 1.9]) and the two attributes
// (MAX_HEALTH 4.0, MOVEMENT_SPEED 0.2 — `createSnowGolemAttributes`) are NOT re-declared here —
// they come out of the jar-bytecode-extracted entity table generically (`NS.Entities.attrsOf(
// 'snow_golem')`), the same way every other mob's numbers do. Gravity/drag, eye height and the
// goal roster (`Ai.ROSTER.snow_golem`) live in `07i_entitylist.js`/`14j_combat.js`/
// `07k_goals.js` (shared files this unit only adds small, cited lines to) because that is where
// every OTHER mob's own equivalent already lives — this file carries only the parts nothing
// else in the engine has a home for.
//
// WHAT IS HERE, PER THE UNIT'S OWN SPEC:
//   1. `SG.hostileTargets`/`SG.isMonster` — the `ActiveTargetGoal<MobEntity>(..., mob ->
//      mob instanceof Monster)` predicate's live candidate list (§ TARGETING)
//   2. `SG.mobTick` — `tickMovement`'s own hot-biome fire damage + doMobGriefing-gated snow-
//      layer trail, and `hurtByWater()`'s generic per-tick DROWN damage (§ TICK)
//   3. `SG.canShear`/`SG.shear` — `isShearable`/`sheared()`, the drop half (§ SHEAR)
//   4. `SG.tryConstruct` — `CarvedPumpkinBlock.trySpawnEntity`'s snow-golem half: two stacked
//      snow blocks under a carved_pumpkin/jack_o_lantern builds a real golem, consuming all
//      three blocks (§ CONSTRUCTION)
//
// NOT HERE, NAMED RATHER THAN GUESSED (`SG.OWED`, at the bottom):
//   - `carved_pumpkin`/`jack_o_lantern`/`pumpkin` are NOT placeable world blocks in this engine
//     at all (no `B.def` entry in `02_blocks.js` — confirmed by grep, not assumed) — they exist
//     only as ITEMS (helmet-slot wearables, `02g_items.js`) and as a connection-family exception
//     name (`07b_behaviour.js`). `SG.tryConstruct` is real, tested code, but it has no live
//     CALLER: nothing in this engine's block-placement path can ever put a carved_pumpkin
//     block into the world for `onBlockAdded` to react to, so the construction mechanic is
//     unreachable from live play until that block family exists. This is the single largest
//     gap this unit leaves.
//   - the exact `SnowBlock.canPlaceAt`/`CarvedPumpkinBlock`'s golem-pattern block predicates are
//     approximated with `fullCubeSupportAt`, the SAME stand-in `Enderman.PlaceBlockGoal`'s own
//     carried-block placement already uses (07zg_enderman.js) — neither `SnowBlock.java` nor
//     `BlockPattern.java`/`CachedBlockPosition.java` are in this worktree's `.decomp`.
//   - a golem's snowball crossing the PLAYER's own hitbox does nothing (`Cb.tickSnowball`'s own
//     header, 14j_combat.js) — real vanilla still knocks the player back at 0 damage.
//   - `Ai.MONSTER_TYPES` (below) is `Spawn.PEACEFUL_DISALLOWED` plus `piglin` added back, not an
//     independent per-type walk of every rostered type's own `Monster` interface membership —
//     any Monster-implementing type this engine rosters that is neither in that table nor
//     `piglin` (a `hoglin`/`zoglin`-adjacent case not independently re-verified this session)
//     would wrongly be skipped as a snow-golem target.

(function (NS) {
  'use strict';

  var SG = NS.SnowGolem = {};

  SG.EYE_HEIGHT = 1.7;   // SnowGolemEntity.getActiveEyeHeight (.decomp:130-133) — fixed, not height*0.85

  // ════════════════════════════ TARGETING ══════════════════════════════════════════════════
  //
  // `SnowGolemEntity.initGoals` (.decomp:52-57): `targetSelector.add(1, new ActiveTargetGoal<>(
  // this, MobEntity.class, 10, true, false, mob -> mob instanceof Monster))`. The `10`
  // (reciprocalChance) and `true` (mustSee) are modelled by the roster's Ai.NearestAttackableTargetGoal opts; checkCanNavigate=false is its default — the
  // same standing simplification every other `ActiveTargetGoal` wrapper in `07k_goals.js`
  // already makes (its own `Ai.NearestAttackableTargetGoal` header); only the CANDIDATE FILTER
  // (`instanceof Monster`) is this file's own job.
  SG.MONSTER_TYPES = null;
  SG.monsterTypes = function () {
    if (SG.MONSTER_TYPES) return SG.MONSTER_TYPES;
    // DATA.monsterTypes: the .decomp walk of every EntityType whose class implements Monster
    // (tools/extract-monsters.mjs) — piglin included, hoglin/zoglin/phantom/ghast/slime/shulker too.
    var out = {};
    var list = (NS.DATA && NS.DATA.monsterTypes) || [];
    for (var i = 0; i < list.length; i++) out[list[i]] = 1;
    SG.MONSTER_TYPES = out;
    return out;
  };
  SG.isMonster = function (e) {
    return !!e && !e.removed && !e.dead && e.maxHealth !== undefined && e.health > 0 &&
      SG.monsterTypes()[e.type] === 1;
  };
  /** The live candidate list `Ai.NearestAttackableTargetGoal` (07k_goals.js) filters by the
   *  golem's own `followRange` attribute (16) — see that function's own header. */
  SG.hostileTargets = function (self) {
    var EL = NS.EntityList, out = [];
    if (!EL || !EL.list) return out;
    for (var i = 0; i < EL.list.length; i++) {
      var o = EL.list[i];
      if (o !== self && SG.isMonster(o)) out.push(o);
    }
    return out;
  };

  // ═══════════════════════════ TICK (heat / rain-or-water / snow trail) ═══════════════════
  //
  // `fullCubeSupportAt` — the SAME "does a full, solid cube sit here" stand-in
  // `Enderman.PlaceBlockGoal`'s own carried-block placement check already uses
  // (07zg_enderman.js), reused rather than duplicated with different names.
  function fullCubeSupportAt(x, y, z) {
    var W = NS.World, S = NS.States, Ph = NS.Physics;
    if (!W || !S || !Ph) return false;
    var st = W.getBlock(x, y, z);
    if (st === undefined || st === null) return false;
    return S.solid[st] === 1 && Ph.shapesForState(st) === Ph.FULL_CUBE;
  }

  SG.FIRE_DAMAGE = 1;    // SnowGolemEntity.tickMovement (.decomp:92-93): damage(ON_FIRE, 1.0F)
  SG.DROWN_DAMAGE = 1;   // hurtByWater()==true -> LivingEntity.baseTick's own generic DROWN 1.0F

  /** `SnowGolemEntity.tickMovement`'s own biome-heat half (.decomp:87-93): `Biome.isHot(pos)`
   *  (`getTemperature(pos) > 1.0F`, `B.temperatureAt` already IS that height-adjusted
   *  temperature — this file's own header names the .decomp Biome.java citation) sets it
   *  alight for 1 real damage, every tick, independent of `hurtByWater` below. */
  SG.applyHeatDamage = function (e) {
    var B = NS.Biomes, W = NS.World, Cb = NS.Combat;
    if (!e || e.dead || !B || !B.temperatureAt || !W || !W.biomeAt || !Cb || !Cb.hurt) return;
    var x = Math.floor(e.x), y = Math.floor(e.y), z = Math.floor(e.z);
    var bio = W.biomeAt(x, z);
    if (bio === undefined || bio === null) return;
    if (B.temperatureAt(bio, x, y, z) > 1.0) Cb.hurt(e, SG.FIRE_DAMAGE, undefined, false, { bypassArmor: true, source: 'onFire', fire: true });
  };

  /** `Entity.isInsideBubbleColumn()`: the block at the feet cell is a bubble column. */
  function inBubbleColumn(e) {
    var W = NS.World, SR = NS.States, R = NS.Reg;
    if (!W || !W.getBlock || !SR || !R || !R.id) return false;
    var st = W.getBlock(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z));
    return st > 0 && SR.block[st] === R.id.bubble_column;
  }

  /** `Entity.isWet` = touching water || isBeingRainedOn (feet cell AND boundingBox.maxY) || bubble column.
   *  Shared by every HURT_BY_WATER type (snow golem, strider, blaze, enderman). */
  SG.isWet = function (e) {
    var S = NS.Sky;
    return !!e.inWater || !!(S && S.isEntityRainedOn && S.isEntityRainedOn(e)) || inBubbleColumn(e);
  };

  /** `SnowGolemEntity.hurtByWater()` returns `true` (.decomp:83-85) -> `LivingEntity.baseTick`'s
   *  own generic `if (isTouchingWaterOrRain() && hurtByWater()) damage(DROWN, 1.0F)`, the SAME
   *  mechanic `Enderman.applyWaterDamage` (07zg_enderman.js) already reproduces for
   *  `EndermanEntity` — reused here WITHOUT that file's own teleport-escape half (enderman's
   *  `random.nextInt(10) != 0` roll is `damage()`'s OWN non-LivingEntity-attacker branch, not
   *  part of `hurtByWater` itself; a snow golem does not teleport). */
  SG.applyWaterDamage = function (e) {
    if (!e || e.dead) return;
    var Cb = NS.Combat;
    if (!SG.isWet(e) || !Cb || !Cb.hurt) return;
    Cb.hurt(e, SG.DROWN_DAMAGE, undefined, false, { bypassArmor: true, source: 'drown' });
  };

  // `SnowGolemEntity.tickMovement` (.decomp:97-108): four candidate positions,
  // `($$6 % 2 * 2 - 1) * 0.25F` / `($$6 / 2 % 2 * 2 - 1) * 0.25F` for $$6 = 0..3.
  SG.SNOW_PLACE_OFFSETS = [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]];
  SG.SNOW_LAYER_STATE = null;
  SG.snowLayerState = function () {
    if (SG.SNOW_LAYER_STATE !== null) return SG.SNOW_LAYER_STATE;
    SG.SNOW_LAYER_STATE = (NS.States && NS.States.withLocal) ? NS.States.withLocal('snow', 0) : null;
    return SG.SNOW_LAYER_STATE;
  };
  /** `SnowGolemEntity.tickMovement`'s own snow-trail half (.decomp:94-108): gated on
   *  `GameRules.DO_MOB_GRIEFING` (`ctx.mobGriefing()`, the SAME live gamerule reader
   *  `Ai.BreakDoorGoal`'s own header already names, 07k_goals.js), each of the four cells must
   *  be air (`.isAir()`) and `Blocks.SNOW.getDefaultState().canPlaceAt(world, pos)` — that
   *  EXACT predicate is `SG.OWED`'s own top line; `fullCubeSupportAt` below it is the named
   *  stand-in. ⚠ NOTE WHAT IS **NOT** HERE: no biome/temperature check at all — the decomp has
   *  none in this loop (only the heat-damage half above reads the biome) — so this is NOT
   *  "cold biomes only", it is "wherever the four cells are air over a full solid block",
   *  which in practice excludes warm ground anyway (no snow trail on top of e.g. water, and a
   *  melted/`coldEnoughToSnow`-false surface is exactly where this engine's own weather never
   *  places snow either) without this file inventing an extra gate the game itself does not
   *  have. */
  /** `SnowBlock.canPlaceAt` (.decomp/net/minecraft/block/SnowBlock.java:81-90, read whole — s115):
   *  below is ice (cL) / packed_ice (hh) / barrier (gB) → false; honey_block (ns) / soul_sand (cU)
   *  → true; else the below block's collision shape has a full UP face, or it is snow at LAYERS 8. */
  SG.SNOW_DENY_BELOW = { ice: 1, packed_ice: 1, barrier: 1 };
  SG.SNOW_ALLOW_BELOW = { honey_block: 1, soul_sand: 1 };
  SG.snowCanPlaceAt = function (x, y, z) {
    var W = NS.World, SR = NS.States, R = NS.Reg;
    if (!W || !SR || !R) return false;
    var below = W.getBlock(x, y - 1, z);
    if (!(below > 0)) return false;
    var nm = R.names[SR.block[below]];
    if (SG.SNOW_DENY_BELOW[nm]) return false;
    if (SG.SNOW_ALLOW_BELOW[nm]) return true;
    if (nm === 'snow' && R.PROP) {
      var v = SR.propValue(below, R.PROP.layers);
      if (v >= 0 && +R.valueNames[v] === 8) return true;
    }
    // Block.isFaceFullSquare(collisionShape, UP): axis dir 2 = +Y (SR.faceCovers: ax = dir>>1, far = even)
    return SR.faceCovers(below, 2, 0, 0, 1024, 1024);
  };

  SG.tickSnowTrail = function (e, ctx) {
    var W = NS.World;
    if (!e || e.dead || !W || !W.getBlock || !W.setBlock) return;
    if (!ctx || !ctx.mobGriefing || !ctx.mobGriefing()) return;
    var snowState = SG.snowLayerState();
    if (snowState === null || snowState === undefined) return;
    var by = Math.floor(e.y);
    for (var k = 0; k < 4; k++) {
      var off = SG.SNOW_PLACE_OFFSETS[k];
      var bx = Math.floor(e.x + off[0]), bz = Math.floor(e.z + off[1]);
      if (W.getBlock(bx, by, bz) !== 0) continue;             // must be air
      if (!SG.snowCanPlaceAt(bx, by, bz)) continue;           // SnowBlock.canPlaceAt, s115
      W.setBlock(bx, by, bz, snowState);
    }
  };

  /** The single per-tick entry point `07i_entitylist.js`'s own dispatch calls, the SAME
   *  mobTick-slot standing bat/enderman/rabbit's own lines already establish. Order (heat,
   *  then water, then the snow trail) matches `tickMovement`'s own body top-to-bottom for the
   *  first two; `hurtByWater` is technically a different vanilla method (`Entity.baseTick`,
   *  not `tickMovement`) with no OBSERVABLE difference from running it in this same slot. */
  /** Voice: `SnowGolemEntity.getAmbientSound/getHurtSound/getDeathSound` (snow_golem.ambient/hurt/death),
   *  `attack` (shoot, pitch 0.4/(rand*0.4+0.8)). Default `Entity.playSound` pitch `(rand-rand)*0.2+1`. */
  SG.SOUND = { ambient: 'entity.snow_golem.ambient', hurt: 'entity.snow_golem.hurt',
               death: 'entity.snow_golem.death', shoot: 'entity.snow_golem.shoot' };
  SG.playSound = function (e, ev, pitch) {
    var MV = NS.MobVoice;
    if (!NS.Sound || !NS.Sound.play || e.silent || (MV && MV.GATED && !MV.AUDITED[e.type])) return false;   // #4003: silent until audited
    if (pitch === undefined) pitch = (NS.fbRand() - NS.fbRand()) * 0.2 + 1;
    return NS.Sound.play(ev, { x: e.x, y: e.y, z: e.z, volume: 1, pitch: pitch, source: 'neutral' });
  };
  SG.shootPitch = function (rnd) { return 0.4 / ((rnd || NS.fbRand)() * 0.4 + 0.8); };
  /** `MobEntity.baseTick` ambient roll (`nextInt(1000) < ambientSoundChance++`, min delay 120, GolemEntity). */
  SG.tickAmbient = function (e) {
    if (e.ambientSoundChance === undefined) e.ambientSoundChance = 0;
    if (Math.floor(NS.fbRand() * 1000) < e.ambientSoundChance++) {
      e.ambientSoundChance = -120;
      SG.playSound(e, SG.SOUND.ambient);
    }
  };
  SG.mobTick = function (e, ctx) {
    SG.applyHeatDamage(e);
    if (e.dead) return;
    SG.applyWaterDamage(e);
    if (e.dead) return;
    SG.tickAmbient(e);
    SG.tickSnowTrail(e, ctx);
  };

  // ═══════════════════════════ SHEAR ═══════════════════════════════════════════════════════
  //
  // `SnowGolemEntity.isShearable()` (.decomp:159-161): `isAlive() && hasPumpkin()`.
  // `sheared(SoundCategory)` (.decomp:154-158, drop half only — the sound is a renderer/audio
  // concern, the SAME split `Passive.shear`'s own header draws for the sheep): sets
  // `hasPumpkin` false, drops one `carved_pumpkin` (`Items.CARVED_PUMPKIN`, unqualified —
  // vanilla's own literal, not the obf `Items.field_10147` `IS_GOLEM_HEAD_PREDICATE` reads).
  SG.canShear = function (e) {
    return !!e && e.type === 'snow_golem' && !e.dead && e.hasPumpkin !== false;
  };
  SG.shear = function (e) {
    if (!SG.canShear(e)) return null;
    e.hasPumpkin = false;
    return { item: 'carved_pumpkin', count: 1 };
  };
  // `sheared` whole: ENTITY_SNOW_GOLEM_SHEAR (PLAYERS, 1, 1) + `dropStack(stack, 1.7F)` (y + 1.7).
  SG.shearAt = function (e) {
    var d = SG.shear(e);
    if (!d) return null;
    if (NS.Sound && NS.Sound.play) NS.Sound.play('entity.snow_golem.shear', { x: e.x, y: e.y, z: e.z, source: 'player', volume: 1, pitch: 1 });
    if (NS.EntityList && NS.EntityList.dropStack) NS.EntityList.dropStack(e.x, e.y + 1.7, e.z, d.item, d.count);
    return d;
  };

  // ═══════════════════════════ CONSTRUCTION ════════════════════════════════════════════════
  //
  // `CarvedPumpkinBlock.trySpawnEntity`/`getSnowGolemPattern` (.decomp, read whole):
  // `BlockPatternBuilder.start().aisle("^", "#", "#")` — bottom-to-top a `snow_block` (`#`,
  // `Blocks.field_10491`), another `snow_block`, then a carved_pumpkin/jack_o_lantern head
  // (`^`, `IS_GOLEM_HEAD_PREDICATE`) searched around the just-placed block. On a match: all
  // THREE blocks (the pattern's own height, 3) are set to air and the golem is spawned at the
  // pattern's own `translate(0, 2, 0)` cell (the head's own position), `+0.5/+0.05/+0.5`
  // centred, facing +Z (yaw 0, this engine's own fixed heading — `EL.spawn`'s own header). The
  // fresh golem is NOT given `hasPumpkin` — it keeps `EL.DEFAULTS.snow_golem`'s own default
  // `true` (`SNOW_GOLEM_FLAGS` starts `(byte)16` regardless of how the golem was born), so a
  // player-built golem CAN still be sheared for a carved_pumpkin exactly like any other.
  //
  // ⚠ THIS FUNCTION HAS NO LIVE CALLER (`SG.OWED`'s own top line): `carved_pumpkin`/
  // `jack_o_lantern` are not placeable world blocks in this engine at all, so nothing can ever
  // put one into the world for a real `onBlockAdded` to react to. It is written and tested
  // (`snowgolemcheck.mjs`) against a synthetic world/getBlock/setBlock harness so the PATTERN
  // MATH is provably right the day that block family lands, rather than left unwritten.
  SG.searchGolemPattern = function (getBlock, isGolemHead, x, y, z) {
    // Search every column through (x,y,z): the placed block could be the head OR either snow
    // block (BlockPattern.searchAround tries every orientation/offset; this engine only ever
    // builds upward, so only the "placed block is the head, base two below" and "placed block
    // is a snow block, head is one or two above" cases are worth enumerating for a VERTICAL-
    // only pattern like this one — `SG.OWED` names the never-reachable horizontal orientations
    // BlockPattern would also try, moot for a 1-wide vertical aisle).
    for (var headY = y + 2; headY >= y - 2; headY--) {
      var snow1 = getBlock(x, headY - 1, z), snow2 = getBlock(x, headY - 2, z);
      var head = getBlock(x, headY, z);
      if (isGolemHead(head) && snow1 === 'snow_block' && snow2 === 'snow_block') {
        return { headX: x, headY: headY, headZ: z };
      }
    }
    return null;
  };
  SG.tryConstruct = function (world, x, y, z) {
    if (!world || !world.getBlock || !world.setBlock || !world.spawn) return null;
    var match = SG.searchGolemPattern(world.getBlock, world.isGolemHead, x, y, z);
    if (!match) return null;
    world.setBlock(match.headX, match.headY, match.headZ, 'air');
    world.setBlock(match.headX, match.headY - 1, match.headZ, 'air');
    world.setBlock(match.headX, match.headY - 2, match.headZ, 'air');
    return world.spawn('snow_golem', match.headX + 0.5, match.headY - 2 + 0.05, match.headZ + 0.5);
  };

  /** s115 — the LIVE caller: `CarvedPumpkinBlock.onBlockAdded` (.decomp/net/minecraft/block/
   *  CarvedPumpkinBlock.java) runs `trySpawnEntity` whenever a carved_pumpkin/jack_o_lantern
   *  arrives in the world (not when a snow block does). Wired from `P.placeBlock`
   *  (14_player.js) after the write lands; the world adapter maps names onto the real
   *  registry/World/Save and spawns through `EL.spawn`. */
  SG.HEAD_BLOCKS = { carved_pumpkin: 1, jack_o_lantern: 1 };
  /** #734 CarvedPumpkinBlock.getIronGolemPattern ("~^~","###","~#~"): head on a 3-wide T of iron_block,
   *  air ('~') beside the head and beside the stem, either horizontal axis. Returns the T's centre
   *  cell + axis, or null. `nameAt` reports registry names. */
  SG.searchIronGolemPattern = function (nameAt, x, y, z) {
    var isAir = function (n) { return n === 'air' || n === 'cave_air' || n === 'void_air'; };
    for (var ax = 0; ax < 2; ax++) {
      var dx = ax === 0 ? 1 : 0, dz = ax === 0 ? 0 : 1;
      var cells = [[0, -1, 0, 1], [dx, -1, dz, 1], [-dx, -1, -dz, 1], [0, -2, 0, 1],
        [dx, 0, dz, 0], [-dx, 0, -dz, 0], [dx, -2, dz, 0], [-dx, -2, -dz, 0]];
      var good = true;
      for (var i = 0; i < cells.length && good; i++) {
        var c = cells[i], n = nameAt(x + c[0], y + c[1], z + c[2]);
        good = c[3] ? n === 'iron_block' : isAir(n);
      }
      if (good) return { x: x, y: y, z: z, dx: dx, dz: dz };
    }
    return null;
  };
  // CarvedPumpkinBlock.trySpawnEntity: Criteria.SUMMONED_ENTITY for each non-spectating player within the golem's box + 5.
  function summoned(g) {
    var P = NS.Player;
    if (!g || !P || !NS.Adv || !NS.Adv.trigger || (NS.Gamemode && NS.Gamemode.isSpectator(P))) return;
    if (Math.abs(P.x - g.x) <= 5.3 && Math.abs(P.z - g.z) <= 5.3 && P.y >= g.y - 5 - 1.8 && P.y <= g.y + 5 + 2.7)
      NS.Adv.trigger(P, 'minecraft:summoned_entity', { entity: g, player: P });
  }
  SG.onBlockAdded = function (x, y, z) {
    var W = NS.World, SR = NS.States, R = NS.Reg, EL = NS.EntityList;
    if (!W || !SR || !R || !EL) return null;
    var nameAt = function (bx, by, bz) { var st = W.getBlock(bx, by, bz); return st > 0 ? R.names[SR.block[st]] : 'air'; };
    if (!SG.HEAD_BLOCKS[nameAt(x, y, z)]) return null;
    var clear = function (bx, by, bz) {
      W.setBlock(bx, by, bz, 0);
      if (NS.Save && NS.Save.record) NS.Save.record(bx, by, bz, 0);
    };
    var m = SG.searchIronGolemPattern(nameAt, x, y, z);
    if (m) {
      for (var k = -1; k <= 1; k++) for (var j = 0; j >= -2; j--) clear(x + k * m.dx, y + j, z + k * m.dz);
      var g = EL.spawn('iron_golem', x + 0.5, y - 2 + 0.05, z + 0.5, {});
      if (g) g.playerCreated = true;
      summoned(g);
      return g;
    }
    var sn = SG.tryConstruct({
      getBlock: nameAt,
      isGolemHead: function (n) { return !!SG.HEAD_BLOCKS[n]; },
      setBlock: function (bx, by, bz, n) {
        var st = n === 'air' ? 0 : SR.stateOf ? SR.stateOf(n) : 0;
        W.setBlock(bx, by, bz, st);
        if (NS.Save && NS.Save.record) NS.Save.record(bx, by, bz, st);
      },
      spawn: function (t, sx, sy, sz) { return EL.spawn(t, sx, sy, sz, {}); }
    }, x, y, z);
    summoned(sn);
    return sn;
  };

  SG.ready = true;

  SG.OWED = [
    // struck s115: construction is LIVE — P.placeBlock -> SG.onBlockAdded -> SG.tryConstruct
    // (carved_pumpkin/jack_o_lantern are ordinary registry blocks since D-100; the B.def framing was stale).
    'BlockPattern/CachedBlockPosition\'s real horizontal-orientation search (neither class is ' +
      'in this .decomp) — SG.searchGolemPattern only enumerates the vertical column, which is ' +
      'the only orientation a 1-wide "^ # #" aisle can ever match, but is not a transcription ' +
      'of BlockPatternBuilder itself.'
  ];

})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
