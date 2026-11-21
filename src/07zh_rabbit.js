// 07zh_rabbit.js — loop/rabbit-s98 (QUEUE 0.2 G18c, missing overworld mob): the RABBIT, whole.
// Runs on: MAIN THREAD ONLY. No DOM.
//
// Everything here is read off `.decomp/net/minecraft/entity/passive/RabbitEntity.java` (1.18.2,
// Yarn-named, read in full) unless a comment says otherwise. Dimensions ([0.4, 0.5]), the two
// attributes (MAX_HEALTH 3.0, MOVEMENT_SPEED 0.3 — `createRabbitAttributes`) and the breeding
// food list (carrot/golden_carrot/dandelion — `isTempting`/`isBreedingItem`) are NOT re-declared
// here: they come out of the jar-bytecode-extracted entity table generically
// (`tools/extract-entities.mjs`/`extract-breeding.mjs`, `NS.Entities.attrsOf('rabbit')` /
// `NS.Entities.breedFood('rabbit')`) the same way every other animal's numbers do — `rabbitcheck`
// asserts those two rows directly against `assets/entities.json` rather than this file
// duplicating a number the table already owns.
//
// WHAT IS HERE, PER THE UNIT'S OWN SPEC:
//   1. the six natural TYPE constants + killer bunny 99, and `Rb.chooseType` — the exact
//      biome-precipitation/category branch `RabbitEntity.chooseType` runs (§ CHOOSE TYPE)
//   2. `Rb.mobTick` — the hop-timing state machine `RabbitEntity.mobTick`'s onGround half runs
//      every tick, independent of the goal selector (§ JUMP TIMING)
//   3. `Ai.ROSTER.rabbit` is NOT in this file (07k_goals.js owns `Ai.ROSTER`) — this file exports
//      the one piece that roster needs and 07k_goals.js does not already have generically:
//      `Rb.EatCarrotCropGoal`, the carrot-raiding `MoveToTargetPosGoal` subclass (§ EAT CARROTS)
//   4. `Rb.skinKey` — the texture-family picker for the 8-sheet `rabbit`/`rabbit#1..7` crop
//      table `tools/pack-mobtex.mjs` already bakes (its own header names rabbit as "a family
//      with no picker yet" — this is that picker) (§ TEXTURE)
//
// NOT HERE (this unit's own OWED, at the bottom):
//   (killer bunny 99's goals: Ai.killerBunnyGoals)
(function (NS) {
  'use strict';
  // rolls draw from the mob's own e.random (java.util.Random, #6437); FB only when no mob is in hand
  var FBR = new NS.JRandom(0x6437);
  var FBdR = function () { return FBR.nextFloat(); };
  function rf(e) { var r = e && e.random; return r ? function () { return r.nextFloat(); } : FBdR; }
  function ri(e, n) { return e && e.random ? e.random.nextInt(n) : FBR.nextInt(n); }

  var Rb = NS.Rabbit = {};

  Rb.OWED = [
    // struck (#6420): RabbitJumpControl / RabbitMoveControl are per-instance objects (Rb.jumpControl / Rb.moveControl).
    // struck (loop/nametag): `Use.entityUse` sets `e.customName`; `Rb.skinKey` 'Toast' -> rabbit#6 is reachable.
  ];

  Rb.ready = true;

  // ── § TYPE — RabbitEntity's own six DataTracker values + the one that never spawns ────────
  // (lines 68-75, read verbatim: BROWN=0 WHITE=1 BLACK=2 WHITE_SPOTTED=3 GOLD=4 SALT=5,
  // KILLER_BUNNY=99 — the jump from 5 to 99 is the jar's own, not a typo here).
  Rb.TYPE = {
    BROWN: 0, WHITE: 1, BLACK: 2, WHITE_SPOTTED: 3, GOLD: 4, SALT: 5, KILLER_BUNNY: 99
  };

  // ── § CHOOSE TYPE — `RabbitEntity.chooseType(WorldAccess)` (lines 369-380), verbatim ───────
  //
  //   int i = random.nextInt(100);
  //   if biome.precipitation == SNOW:        return i < 80 ? WHITE : WHITE_SPOTTED;
  //   else if Biome.getCategory(biome) == DESERT: return GOLD;
  //   else:                                   return i < 50 ? BROWN : (i < 90 ? SALT : BLACK);
  //
  // `rnd` defaults to the mob stream; a check passes a seeded one to prove the three branches
  // and their inner splits without depending on world state.
  //
  // biome inputs: `precip` is `NS.Biomes.PRECIP_SNOW` (2) et al (04g_biomes.js's own constants,
  // not re-declared here); `category` is the biome's own `category` field (`B.at(i).category`,
  // baked straight off the jar's `Biome.Category` per-biome assignment by the same extractor
  // that built `precipitation` — see that field's own header, 04g_biomes.js).
  Rb.chooseType = function (precip, category, rnd) {
    var r = (rnd || FBdR)();
    var roll = Math.floor(r * 100);
    if (precip === 2 /* PRECIP_SNOW */) return roll < 80 ? Rb.TYPE.WHITE : Rb.TYPE.WHITE_SPOTTED;
    if (category === 'desert') return Rb.TYPE.GOLD;
    return roll < 50 ? Rb.TYPE.BROWN : (roll < 90 ? Rb.TYPE.SALT : Rb.TYPE.BLACK);
  };

  /** `Rb.chooseType` fed straight off a live world position — `W.biomeAt(x,z)`, the same
   *  biome-index lookup `Spawn.RULES.slime`'s own swamp check already uses (07l_spawn.js). */
  Rb.chooseTypeAt = function (x, z, rnd) {
    var W = NS.World, B = NS.Biomes;
    if (!W || !B || !B.ready) return Rb.TYPE.BROWN;
    var idx = W.biomeAt(Math.floor(x), Math.floor(z));
    var biome = B.at(idx);
    if (!biome) return Rb.TYPE.BROWN;
    return Rb.chooseType(biome.precipitation, biome.category, rnd);
  };

  /**
   * `RabbitEntity.setRabbitType` (lines 340-344, the killer-bunny half OWED above — see the
   * file header). Every caller (natural spawn's `EL.DEFAULTS.rabbit`, egg spawn, breeding's
   * `Br.CHILD.rabbit`) goes through this one setter so `e.rabbitType` is never assigned by hand.
   */
  Rb.setRabbitType = function (e, type) {
    if (!e) return;
    e.rabbitType = type;
    if (type === 99) {
      e.attackDamage = 8.0;   // ATTACK_DAMAGE base 8 (read by Cb.mobAttack); goals: Ai.killerBunnyGoals
      if (!e.customName) e.customName = 'The Killer Bunny';   // entity.minecraft.killer_bunny, en_us
      var EL = NS.EntityList;
      if (e.ai && NS.Ai.killerBunnyGoals) NS.Ai.killerBunnyGoals(e, e.ai, EL.aiCtx(e));   // selector already built
    }
  };

  // ── § JUMP TIMING — `RabbitEntity.mobTick`'s onGround half (lines 178-217) ─────────────────
  //
  // `doScheduleJump` (lines 240-246): `ticksUntilJump = moveControl.speed < 2.2 ? 10 : 1` — a
  // fleeing rabbit (AvoidEntityGoal's own 2.2) hops almost every tick, a wandering one hops
  // roughly twice a second. This engine has no per-instance "requested speed modifier" field
  // (goals call `Ai.stepToward(e, node, speedModifier)` with the number already in hand and
  // never store it), so the modifier is RECONSTRUCTED off `Ai.setMobSpeed`'s own product
  // (`e.mobSpeed = speedModifier * Ai.movementSpeedOf(e)`, 07k_goals.js) by dividing back out
  // the attribute base speed — exact whenever `movementSpeedOf(e) > 0` (always true for a live
  // rabbit, whose MOVEMENT_SPEED attribute is 0.3 and never zero).
  Rb.currentSpeedModifier = function (e) {
    var Ai = NS.Ai;
    var base = (Ai && Ai.movementSpeedOf) ? Ai.movementSpeedOf(e) : 0;
    if (!(base > 0)) return 0;
    // rounded to 6 decimals: `e.mobSpeed` is itself `speedModifier * base` (a single float
    // multiply, `Ai.setMobSpeed`), so dividing it back out reintroduces exactly the kind of
    // last-bit noise that turns a real 2.2 into 2.1999999999999997 -- which the `< 2.2`
    // branch below would then read as "walking", not "fleeing". Vanilla's own comparison is
    // against the LITERAL constructor argument (2.2), never a recomputed float, so rounding
    // here restores that exactness rather than papering over a real gap.
    return Math.round(((e.mobSpeed || 0) / base) * 1e6) / 1e6;
  };

  // RabbitEntity.RabbitJumpControl (lines 534-562): `active` (JumpControl.active) + `canJump`.
  Rb.jumpControl = function (e) {
    var c = e.rabbitJumpControl;
    if (c) return c;
    c = e.rabbitJumpControl = {
      active: false, canJumpFlag: false,
      isActive: function () { return this.active; },
      canJump: function () { return this.canJumpFlag; },
      setCanJump: function (v) { this.canJumpFlag = v; },
      setActive: function () { this.active = true; },
      tick: function () { if (this.active) { Rb.startJump(e); this.active = false; } }
    };
    return c;
  };

  // RabbitEntity.RabbitMoveControl (lines 564-594): getSpeed() is the MoveControl.speed the last
  // MOVE_TO order set (`e.moveMod`, Ai.stepToward); `rabbitSpeed` is the last positive moveTo speed.
  Rb.moveControl = function (e) {
    var c = e.rabbitMoveControl;
    if (c) return c;
    c = e.rabbitMoveControl = {
      rabbitSpeed: 0,
      getSpeed: function () { return (e.moveMod || 0) > 0 ? e.moveMod : Rb.currentSpeedModifier(e); },
      isMoving: function () { return (e.moveMod || 0) > 0; },
      getTargetY: function () { return e.moveTargetY; },
      moveTo: function (x, y, z, speed) {
        if (e.inWater) speed = 1.5;
        e.moveMod = speed;
        if (speed > 0) this.rabbitSpeed = speed;
      }
    };
    return c;
  };

  Rb.doScheduleJump = function (e) {
    e.rabbitTicksUntilJump = Rb.moveControl(e).getSpeed() < 2.2 ? 10 : 1;
  };
  Rb.scheduleJump = function (e) {
    Rb.doScheduleJump(e);
    Rb.jumpControl(e).setCanJump(false);   // disableJump
  };

  /** `RabbitEntity.getJumpVelocity` (lines 109-124): 0.5 on a wall / step-up, else 0.2 (speed <= 0.6) or 0.3. */
  Rb.jumpVelocity = function (e) {
    var mc = Rb.moveControl(e), moving = mc.isMoving();   // MoveControl.isMoving(): a MOVE_TO order was issued this tick
    if (e.horizontalCollision || (moving && e.moveTargetY > e.y + 0.5)) return 0.5;
    if (e.navigating && e.navNode && e.navNode.y > e.y + 0.5) return 0.5;
    return (e.moveMod || 0) <= 0.6 ? 0.2 : 0.3;   // mc.getSpeed() <= 0.6
  };

  /** `RabbitEntity.startJump` (lines 157-161): `setJumping(true)`, a fresh 10-tick duration. */
  Rb.startJump = function (e) {
    e.jumpVelocity = Rb.jumpVelocity(e);   // read by Ph.travelMob in place of the flat 0.42
    var speed = e.moveMod || 0;
    if (speed > 0 && e.vx * e.vx + e.vz * e.vz < 0.01) {   // RabbitEntity.jump(): updateVelocity(0.1F, (0,0,1))
      e.vx += Math.sin(e.yaw) * 0.1; e.vz -= Math.cos(e.yaw) * 0.1;   // engine yaw 0 = north (-z), see Ai.stepToward
    }
    e.jumping = true;               // the JumpControl flag `Ph.travelMob` consumes (D-417)
    e.rabbitJumpDuration = 10;
    e.rabbitJumpTicks = 0;
    // RabbitEntity.setJumping(true): playSound(getJumpSound(), getSoundVolume(), (r - r) * 0.2 + 1) * 0.8)
    if (NS.Sound && NS.Sound.mobSound)
      NS.Sound.mobSound(e, 'entity.rabbit.jump', 1.0, ((rf(e)() - rf(e)()) * 0.2 + 1.0) * 0.8);
  };

  /**
   * `RabbitEntity.mobTick`'s onGround branch, read whole (lines 178-217): on landing, cancel
   * the jump flag and reschedule; once the countdown reaches zero while grounded, hop again
   * (vanilla also re-aims the mob at its current path node here — `Ai.stepToward`, called every
   * tick by whichever MOVE goal is active, already keeps `e.yaw` current, so re-aiming a SECOND
   * time from this function would fight the goal rather than help it and is left to the goal).
   * The killer-bunny branch (type 99, target < 4 blocks) lunges at its target; setRabbitType(99) makes it live.
   */
  Rb.mobTick = function (e) {
    if (!e) return;
    if (e.rabbitTicksUntilJump === undefined) e.rabbitTicksUntilJump = 0;
    if (e.rabbitTicksUntilJump > 0) e.rabbitTicksUntilJump--;
    if (e.onGround) {
      if (!e.rabbitLastOnGround) {
        e.jumping = false;
        Rb.scheduleJump(e);
      }
      var jc = Rb.jumpControl(e), mc = Rb.moveControl(e);
      // vanilla reschedules ONLY on landing (above), never right after startJump; and only
      // starts a hop while the jump control is idle (`!jumpControl.isActive()`)
      var t = e.target;
      if (e.rabbitType === 99 && e.rabbitTicksUntilJump === 0 && t && !t.dead && !t.removed &&
          (t.x - e.x) * (t.x - e.x) + (t.z - e.z) * (t.z - e.z) + (t.y - e.y) * (t.y - e.y) < 16) {
        // killer bunny: lookTowards(target), moveTo(target), startJump(), lastOnGround = true
        e.yaw = Math.atan2(t.x - e.x, -(t.z - e.z));
        Rb.startJump(e);
        e.rabbitLastOnGround = true;
      } else if (!jc.isActive()) {
        if (mc.isMoving() && e.rabbitTicksUntilJump === 0) {
          // moving: lookTowards(current path node) then hop
          var n = e.navigating && e.navNode;
          if (n) e.yaw = Math.atan2(n.x + 0.5 - e.x, -(n.z + 0.5 - e.z));
          Rb.startJump(e);
        }
      } else if (!jc.canJump()) jc.setCanJump(true);   // enableJump
    }
    if (e.rabbitJumpDuration) {
      if (e.rabbitJumpTicks !== e.rabbitJumpDuration) e.rabbitJumpTicks++;
      else { e.rabbitJumpTicks = 0; e.rabbitJumpDuration = 0; e.jumping = false; }
    }
    if (e.moreCarrotTicks > 0) e.moreCarrotTicks = Math.max(0, e.moreCarrotTicks - ri(e, 3));
    e.rabbitLastOnGround = e.onGround;
    // RabbitMoveControl.tick: grounded, not jumping, jump control idle -> setSpeed(0); goals re-issue it next tick
    if (e.onGround && !e.jumping && !Rb.jumpControl(e).isActive()) { e.mobSpeed = 0; e.zza = 0; }
  };

  // ── § EAT CARROTS — `RabbitEntity.EatCarrotCropGoal` extends `MoveToTargetPosGoal` (lines
  // 405-479), itself read off `.decomp/net/minecraft/entity/ai/goal/MoveToTargetPosGoal.java`
  // (both read whole). `range` 16, `maxYDifference` 1 (the two constructor args
  // `EatCarrotCropGoal(RabbitEntity)` passes up: `super($$0, 0.7F, 16)`, and the parent's own
  // 2-arg overload fixes `maxYDifference` at 1 — read in full, MoveToTargetPosGoal.java:23-25).
  Rb.EAT_RANGE = 16;
  Rb.EAT_MAX_Y_DIFF = 1;
  Rb.EAT_SPEED = 0.7;
  Rb.MORE_CARROT_TICKS = 40;   // EatCarrotCropGoal.tick's own `this.rabbit.moreCarrotTicks = 40`

  /**
   * The carrots crop's CURRENT age — `NS.States.propValue(state, R.PROP.age)` is the value-id
   * `07b_behaviour.js`'s own private `prop()` wraps (that file's `tickCrop`, read verbatim:
   * `+R.valueNames[prop(st, P.age)]`); `R.PROP`/`R.valueNames` are both public on `NS.Reg`
   * already (02b_registry.js/02c_states.js), so this is the same lookup through the public
   * surface rather than a second private copy of it.
   */
  function ageOf(st) {
    var S = NS.States, R = NS.Reg;
    if (!S || !R || !R.PROP || R.PROP.age === undefined) return 0;
    var v = S.propValue(st, R.PROP.age);
    return v < 0 ? 0 : +R.valueNames[v];
  }

  /**
   * `EatCarrotCropGoal.isTargetPos` (lines 471-482): the position UNDER TEST is farmland
   * (`this.targetPos` in the parent's own search, one BELOW the mob) with a MATURE carrots
   * crop directly above it. `wantsCarrots`/`hasTarget` are `RabbitEntity.EatCarrotCropGoal`'s
   * own instance fields (`canStart`, lines 416-427 — `wantsCarrots` is unconditionally forced
   * true right after being read off `this.rabbit.wantsCarrots()`, vanilla's own dead read, kept
   * here as the same always-true gate) so only "not already carrying a target this pass" (the
   * search stops at the FIRST hit, `MoveToTargetPosGoal.findTargetPos`'s own early return)
   * differs call to call.
   */
  function isMatureCarrots(x, y, z) {
    var W = NS.World, S = NS.States, R = NS.Reg, Bh = NS.Behave;
    if (!W || !S || !R || !Bh || R.id.carrots === undefined) return false;
    var st = W.getBlock(x, y, z);
    if (st === 0 || S.block[st] !== R.id.carrots) return false;
    var maxAge = Bh.maxAge ? Bh.maxAge(R.id.carrots) : 7;
    // `CarrotsBlock.isMature` (.decomp): `state.get(AGE) == getMaxAge()` — `CropBlock`'s own
    // `MaxAge` for carrots is 7 (8 age states, 0-7), read here off `B.maxAge` rather than the
    // flat literal so a future state-table correction cannot silently desync the two.
    return ageOf(st) >= maxAge;
  }

  /**
   * `RabbitEntity.EatCarrotCropGoal` whole, at this engine's own Goal shape
   * (`canUse`/`canContinueToUse`/`start`/`stop`/`tick`, `Ai.TemptGoal`/`Passive.EatGrassGoal`'s
   * own convention). Search uses the exact expanding-ring order
   * `MoveToTargetPosGoal.findTargetPos` walks (lines 104-122, transcribed): `range` rings of
   * increasing |dx|/|dz|, `maxYDifference` above/below the mob's own feet, first hit wins (NOT
   * nearest-hit — a faithful port of vanilla's own non-optimal search, not a naive "get closest"
   * that would look identical to a player watching one rabbit but diverge under a `--seed`
   * fixture with two farms). Navigation is `Ai.findPath`/`Ai.stepToward`
   * (07k_goals.js) toward `targetPos.up()` (the crop cell itself, one above the farmland this
   * goal's own search key names `targetPos`) — the same helper pair `Ai.TemptGoal` already
   * walks a rabbit through, not a second pathing system.
   */
  Rb.EatCarrotCropGoal = function (e, ctx) {
    ctx = ctx || {};
    var mobGriefing = ctx.mobGriefing || function () { return true; };
    var target = null;     // {x,y,z} — the FARMLAND cell (vanilla's own `this.targetPos`)
    var cooldown = 0, reached = false, hasTarget = false;

    function findTarget() {
      var bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
      for (var dy = 0; dy <= Rb.EAT_MAX_Y_DIFF; dy = dy > 0 ? -dy : 1 - dy) {
        for (var r = 0; r < Rb.EAT_RANGE; r++) {
          for (var dx = 0; dx <= r; dx = dx > 0 ? -dx : 1 - dx) {
            var zLoop0 = (dx < r && dx > -r) ? r : 0;
            for (var dz = zLoop0; dz <= r; dz = dz > 0 ? -dz : 1 - dz) {
              var tx = bx + dx, ty = by + dy - 1, tz = bz + dz;
              if (!hasTarget && isMatureCarrots(tx, ty + 1, tz) && isFarmland(tx, ty, tz)
                  && (!NS.Ai || !NS.Ai.isInWalkTargetRange || NS.Ai.isInWalkTargetRange(e, { x: tx, y: ty, z: tz }))) {
                hasTarget = true;
                return { x: tx, y: ty, z: tz };
              }
            }
          }
        }
      }
      return null;
    }
    function isFarmland(x, y, z) {
      var W = NS.World, S = NS.States, R = NS.Reg;
      if (!W || !S || !R || R.id.farmland === undefined) return false;
      var st = W.getBlock(x, y, z);
      return st !== 0 && S.block[st] === R.id.farmland;
    }

    this.canUse = function () {
      // `EatCarrotCropGoal.canStart` (RabbitEntity.java:416-428): griefing is only read once the
      // cooldown is spent; `hasTarget` is cleared there, `isTargetPos` sets it on a hit.
      if (cooldown <= 0) {
        if (!mobGriefing()) return false;
        hasTarget = false;
      }
      if (cooldown > 0) { cooldown--; return false; }
      cooldown = Math.ceil((200 + ri(e, 200)) / 2);   // getInterval, real ticks
      target = findTarget();
      return !!target;
    };
    // `shouldContinue` = hasTarget && MoveToTargetPosGoal.shouldContinue, whose `isTargetPos`
    // needs !hasTarget -- and findTargetPos set hasTarget -- so vanilla's goal ends after its
    // first tick: it eats only if the rabbit already stands within 1.0 of the crop's block centre.
    // ponytail: tryingTime/safeWaitingTime/shouldResetPath are unreachable for that reason.
    this.canContinueToUse = function () { return false; };
    this.start = function () { reached = false; };
    this.stop = function () { target = null; reached = false; };
    this.tick = function () {
      if (!target) return;
      var cx = target.x + 0.5, cy = target.y + 1, cz = target.z + 0.5;
      // lookControl.lookAt(crop, 10, maxLookPitchChange): turn-limited, every tick
      if (e.look) e.look.setLookAt(cx, cy, cz, 10 * Math.PI / 180, 40 * Math.PI / 180);
      // BlockPos.isWithinDistance(pos, 1.0): euclidean to the crop cell's CENTRE, strictly < 1
      var dx = cx - e.x, dy = cy + 0.5 - e.y, dz = cz - e.z;
      reached = dx * dx + dy * dy + dz * dz < 1.0;
      if (reached) {
        if (hasTarget) eatCarrot();
        hasTarget = false;
        cooldown = 10;
      }
    };
    this.hasReached = function () { return reached; };

    this.eatCarrot = eatCarrot;   // exported for tools/rabbitcheck.mjs (the age-0 branch is unreachable via canUse)
    function eatCarrot() {
      var W = NS.World, S = NS.States, R = NS.Reg, Bh = NS.Behave;
      if (!W || !S || !R || !Bh) return;
      var x = target.x, y = target.y + 1, z = target.z;
      var st = W.getBlock(x, y, z);
      if (st === 0 || S.block[st] !== R.id.carrots) return;
      var age = ageOf(st);
      // worldEvent 2001 (`syncWorldEvent`/`breakBlock`): the block's break sound + dust
      if (NS.Sound && NS.Sound.blockBreak) NS.Sound.blockBreak(st, x + 0.5, y + 0.5, z + 0.5, null);
      var Px = NS.Particle;
      if (Px && Px.spawnBlockDust) for (var pi = 0; pi < 8; pi++)
        Px.spawnBlockDust(x + rf(e)(), y + rf(e)(), z + rf(e)(), 0, 0.1, 0, st, x, y, z, rf(e));
      if (age <= 0) {
        // `world.breakBlock(pos, true, rabbit)`: the loot table rolls (no tool) and pops as items
        var L = NS.Loot, EL = NS.EntityList, IT = NS.Items;
        var drops = (L && L.ready) ? L.breakDrops(st, {}) : [];
        W.setBlock(x, y, z, 0);
        if (NS.Save && NS.Save.record) NS.Save.record(x, y, z, 0);
        if (drops.length && EL && EL.popResource && IT) for (var di = 0; di < drops.length; di++) {
          var ii = IT.of(drops[di].item);
          if (ii >= 0) EL.popResource(x, y, z, ii, drops[di].count || 1);
        }
      } else {
        var next = Bh.setProp(st, 'age', age - 1);
        W.setBlock(x, y, z, next);
        if (NS.Save && NS.Save.record) NS.Save.record(x, y, z, next);
      }
      e.moreCarrotTicks = Rb.MORE_CARROT_TICKS;
    }
  };

  function Ai_findPath(sx, sy, sz, tx, ty, tz, mob) {
    var Ai = NS.Ai;
    return (Ai && Ai.findPath) ? Ai.findPath(sx, sy, sz, tx, ty, tz, { mob: mob }) : null;
  }
  function Ai_stepToward(e, node, speed) {
    var Ai = NS.Ai;
    if (Ai && Ai.stepToward) Ai.stepToward(e, node, speed);
  }
  function Ai_closeTo(e, node) {
    var Ai = NS.Ai;
    return Ai && Ai.closeTo ? Ai.closeTo(e, node) : false;
  }

  /**
   * `wantsCarrots()` (line 511): `this.moreCarrotTicks == 0`. `moreCarrotTicks` itself counts
   * down in `mobTick` (`RabbitEntity.mobTick`, lines 172-176: `-= random.nextInt(3)`, floored at
   * 0) — that half is generic enough to belong with the rest of this file's own per-tick state
   * rather than duplicated by a caller, so `Rb.mobTick` (§ JUMP TIMING) runs it too.
   */
  Rb.wantsCarrots = function (e) { return (e.moreCarrotTicks | 0) === 0; };

  // ── § TEXTURE — the 8-sheet `rabbit`/`rabbit#1`..`rabbit#7` family `pack-mobtex.mjs` already
  // bakes (`extract-mob-textures.mjs`'s own `FAMILY.rabbit` ordinal array: brown, white, black,
  // white_splotched, gold, salt, toast, caerbannog — read verbatim off that file). `Rb.TYPE`'s
  // own six values line up with sheets 0-5 directly (RabbitEntityRenderer.method_4102's switch,
  // read above); sheet 6 is the "Toast" name easter egg (checked FIRST, exactly as the
  // renderer's own `if` does, ahead of the type switch); sheet 7 is the killer bunny.
  Rb.SKIN = ['rabbit', 'rabbit#1', 'rabbit#2', 'rabbit#3', 'rabbit#4', 'rabbit#5'];
  Rb.SKIN_TOAST = 'rabbit#6';
  Rb.SKIN_KILLER = 'rabbit#7';

  function nameOf(e) {
    var n = e.customName;
    if (!n) return '';
    if (typeof n === 'string') return n;
    if (typeof n === 'object' && typeof n.text === 'string') return n.text;
    return '';
  }

  Rb.skinKey = function (e) {
    if (!e || e.type !== 'rabbit') return null;
    if (nameOf(e) === 'Toast') return Rb.SKIN_TOAST;
    if (e.rabbitType === Rb.TYPE.KILLER_BUNNY) return Rb.SKIN_KILLER;
    var k = Rb.SKIN[e.rabbitType | 0];
    return k || Rb.SKIN[0];
  };

})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
