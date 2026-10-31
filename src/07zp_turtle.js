// 07zp_turtle.js — loop/turtle-s102 (QUEUE 0.2 G18 mobs): the TURTLE, whole. Runs on: MAIN
// THREAD ONLY. No DOM.
//
// Everything below is read off `.decomp/net/minecraft/entity/passive/TurtleEntity.java` (702
// lines, read in full this session) unless a comment says otherwise. Dimensions ([1.2, 0.4]),
// the two attributes (MAX_HEALTH 30.0, MOVEMENT_SPEED 0.25 — `createTurtleAttributes`), the
// breeding food (seagrass, an ITEM list not a tag — `assets/entities.json`'s own
// `breeding.turtle`) and the real per-tick motion pair ([0.005, 0.9], the SAME jar-extracted
// `D.entities.motion.turtle` row `EL.motionFor` (07i_entitylist.js) already falls through to
// generically — turtle is NOT special-cased there, so its real `travel()` sink/drag numbers
// apply with zero changes to that file) are NOT re-declared here — a constant here would be a
// D-263, the same standing every prior QUEUE 0.2 mob's own header states. `turtlecheck` asserts
// those rows directly against `assets/entities.json`.
//
// WHAT IS HERE, PER THE UNIT'S OWN SPEC:
//   1. `Spawn.RULES.turtle` (07l_spawn.js's own one-line hook) — `TurtleEntity.canSpawn`
//      (static overload, .decomp lines 183-185), verbatim: y < seaLevel+4, sand below
//      (`#minecraft:sand`, the SAME tag `07_world.js`'s own beach-detection already reads via
//      `W.tagBelow('sand', below)`), and `isLightLevelValidForNaturalSpawn` (§ SPAWN, wired in
//      07l_spawn.js directly).
//   2. `Tu.setHomePos`/home-tracking — `TurtleEntity.initialize` (.decomp lines 168-172):
//      `setHomePos(getBlockPos())` at spawn (§ HOME, wired as `EL.DEFAULTS.turtle`,
//      07i_entitylist.js's own registration line).
//   3. `Tu.WanderGoal`/`Tu.GoHomeGoal` — swim + walk, the SAME bespoke straight-line-
//      stepToward approximation `Ax.WanderGoal`'s own header (07zm_axolotl.js) already names
//      the precedent for: this engine's navigation has no `AmphibiousPathNodeMaker`/
//      `SwimNavigation` substrate to give `WanderInWaterGoal`/`WanderOnLandGoal`/`GoHomeGoal`
//      their real 24/100-block MoveToTargetPosGoal/WanderAroundGoal search radii, so one goal
//      walks toward a nearby random point (in water OR on land, whichever the turtle is in)
//      and a second walks straight home when far from it (§ GOALS).
//   4. `Tu.MateGoal` — `TurtleEntity.MateGoal extends AnimalMateGoal` (.decomp lines 454-483),
//      verbatim shape: refuses while `hasEgg()`, and its OWN `breed()` override sets
//      `hasEgg(true)` INSTEAD OF spawning a child (`AnimalMateGoal.breed()`'s generic
//      `createChild`/`EntityList.spawn` path is bypassed entirely — turtle never goes through
//      `Breed.breed`), resets both parents' love, and spawns the SAME `Br.spawnXp`
//      `random.nextInt(7)+1` orb behind `doMobLoot` (§ BREED). This is what closes
//      `Breed.SPECIAL.turtle` in 07m_breed.js's own OWED list (07m_breed.js's own registration
//      line: the key is REMOVED, not left refusing).
//   5. `Tu.LayEggGoal` — `TurtleEntity.LayEggGoal extends MoveToTargetPosGoal` (.decomp lines
//      404-448), the CORE mechanic: while carrying an egg and within 9 blocks of home, walk to
//      a sand cell with air above it, dig for 200 ticks (`sandDiggingCounter`, `Tu.tick`'s own
//      per-entity housekeeping call, 07i_entitylist.js), then place `Blocks.turtle_egg` with
//      `EGGS = random.nextInt(4)+1` (1..4, verbatim) ABOVE the target cell, clear `hasEgg`, and
//      set 600 ticks of love (`setLoveTicks(600)`, the jar's own literal, unexplained but
//      verbatim) (§ EGG). The dig-sound `syncWorldEvent(2001, ...)` every 5th digging tick
//      (`TurtleEntity.tickMovement`, .decomp lines 294-303) is folded into `Tu.tick` too.
//   6. `Tu.onGrowUp` — `TurtleEntity.onGrowUp` (.decomp lines 306-311): a baby crossing into
//      adulthood drops one `scute` behind `doMobLoot` — wired as the growAge -1->0 transition
//      this file's own `Tu.tick` (called from `07i_entitylist.js`'s per-entity tick, the SAME
//      slot every other mob's own per-tick housekeeping call already uses) detects, since no
//      generic onGrowUp EVENT hook exists anywhere in this engine (07m_breed.js's own
//      `Br.setAge` only fires `Br.refreshDimensions`, not a species callback).
//   7. `EL.DEFAULTS.turtle`/`Ai.ROSTER.turtle` (07i_entitylist.js/07k_goals.js, this unit's own
//      registration lines).
//
// NOT HERE (this unit's own OWED, at the bottom, `Tu.OWED`):
//   - `TurtleEntity.TurtleEscapeDangerGoal` (priority 0, flee to nearest water when hurt) —
//     `EscapeDangerGoal.locateClosestWater` needs a flood-fill/BFS this engine's `Ai` has no
//     equivalent of; the exact "no substrate to port, not guessed" refusal `Ax.OWED` states
//     for axolotl's own FIGHT activity.
//   - `TurtleEntity.TravelGoal` (long-range ~512-block open-water excursions,
//     `NoPenaltyTargeting.findTo`) — needs the same missing pathfinding substrate.
//   - (TurtleMoveControl's speed + buoyancy: PORTED s135, `Tu.moveToward`)
//     `TurtleEntity.TurtleSwimNavigation`/`AmphibiousPathNodeMaker` — this engine's generic
//     `Ai.stepToward`/`Ai.findPath` apply uniformly instead, the SAME "no per-type MoveControl
//     substrate" gap every prior QUEUE 0.2 aquatic/flying mob's own header already names.
//   - loop/nbtsave-s104 -- CLOSED: isLandBound/hasEgg/homeX/Y/Z now round-trip through
//     16b_save.js (07zw_mobnbt.js's own per-species field table). ACTIVELY_TRAVELLING/
//     travelPos were left out of that table (no live WRITER sets them yet in this engine --
//     Tu.OWED's own TravelGoal entry above -- so there is nothing to lose on a reload).
//   - the baby-scale RENDER divergence: `TurtleEntity.getScaleFactor()` returns 0.3F for a
//     baby (.decomp line ~253) where `Breed.refreshDimensions`'s own generic `isBaby()?0.5:1`
//     (07m_breed.js) is what actually sizes every mob's hitbox/mesh in this engine — no
//     per-species render-scale-multiplier hook exists to carry the extra 0.3-vs-0.5 divergence
//     (the SAME "no substrate" shape as axolotl's own `AngledModelEntity` OWED entry).
//   - every sound, `BABY_TURTLE_ON_LAND_FILTER` (a baby-turtle target FOR fox's own
//     `FollowBabyTurtleGoal` — the predator side, not this unit's own).
//   - `getPathfindingFavor`'s own sand/water preference weighting — downstream of the missing
//     pathfinding substrate above.

(function (NS) {
  'use strict';
  // fallback stream when a caller passes no rng: the entity list's, else a fixed-seed JRandom (never Math.random, #6438)
  var fbR = null;
  function RNDFB() { var L = NS.EntityList; if (L && L.random) return L.random(); if (!fbR) fbR = new NS.JRandom(0x6438); return fbR.nextDouble(); }

  var Tu = NS.Turtle = {};

  Tu.OWED = [
    'AmphibiousPathNodeMaker -- TravelGoal/GoHome/WanderInWater walk Ai.findPath nodes (TurtleSwimNavigation.isValidPosition via nodeOk) ' +
      '(TurtleMoveControl speed/buoyancy, node-reach arrival and the 100-tick stuck stop ARE ported, s135).',
        // loop/nbtsave-s104 -- CLOSED (isLandBound/hasEgg/homeX/Y/Z; ACTIVELY_TRAVELLING/
    // travelPos is saved (#3046; TravelGoal.start writes it; ACTIVELY_TRAVELLING is a DataTracker flag, never NBT).
    'every sound, BABY_TURTLE_ON_LAND_FILTER (the predator-side fox target list, not this ' +
      'unit\'s own).',
    'the digging-sound world event (syncWorldEvent(2001, ...) every 5th digging tick) -- ' +
      'this engine has no world-event/particle-sound emitter substrate at all for any block, ' +
      'so nothing exists to call.'
  ];

  Tu.ready = true;

  // ── § HOME — `TurtleEntity.initialize` (.decomp lines 168-172), verbatim ──────────────────
  Tu.setHomePos = function (e, x, y, z) { e.homeX = Math.floor(x); e.homeY = Math.floor(y); e.homeZ = Math.floor(z); };
  Tu.homeDist = function (e) {
    if (e.homeX === undefined) return Infinity;
    var dx = e.homeX + 0.5 - e.x, dy = e.homeY + 0.5 - e.y, dz = e.homeZ + 0.5 - e.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };

  // ── § EGG — `TurtleEntity.LayEggGoal` (.decomp lines 404-448) + `TurtleEggBlock` field
  // names (`.decomp/names.tsv`'s own TurtleEggBlock rows — no class body present in this
  // worktree's `.decomp`, so the EGGS/HATCH PROPERTY IDS themselves come off the jar's own
  // blockstate property table, `R.PROP`/`R.PVAL`, exactly like every OTHER numeric block
  // property this engine reads (sea_pickle's `pickles`, candle's `candles`) — 02c_states.js's
  // own header) ────────────────────────────────────────────────────────────────────────────
  Tu.DIG_TICKS = 200;         // LayEggGoal.tick: `this.turtle.sandDiggingCounter > getTickCount(200)`
  Tu.DIG_SOUND_EVERY = 5;     // TurtleEntity.tickMovement: `sandDiggingCounter % 5 == 0`
  Tu.EGG_LOVE_TICKS = 600;    // LayEggGoal.tick: `this.turtle.setLoveTicks(600)` (verbatim, unexplained)
  Tu.EGG_SEARCH_RANGE = 16;   // LayEggGoal: MoveToTargetPosGoal(this, speed, 16)
  Tu.LAY_EGG_HOME_RANGE = 9;  // LayEggGoal.canStart: `getHomePos().isWithinDistance(pos, 9.0)`

  /** `TurtleEggBlock.isSand`/`isSandBelow` — both read `#minecraft:sand` (`07_world.js`'s own
   *  beach-detection already reads the identical tag via `W.tagBelow`), the ONE fact this
   *  file borrows from a sibling module rather than re-deriving. */
  Tu.isSand = function (x, y, z) {
    var W = NS.World;
    var b = W.getBlock(x, y, z);
    if (b === 0 || b === undefined) return false;
    return !!W.tagBelow('sand', b);
  };
  Tu.isSandBelow = function (x, y, z) { return Tu.isSand(x, y - 1, z); };

  /** `TurtleEntity.LayEggGoal.isTargetPos`: sand with air directly above. Scans a small ring
   *  around (cx,cz) at the turtle's own y — the bespoke-search shape `Ax.WanderGoal`'s own
   *  header already establishes as this engine's stand-in for real pathfinding search radii. */
  Tu.scanTarget = function (e, range, lowestY, maxY, isTarget) {
    var bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z), Ai = NS.Ai;
    for (var dy = lowestY; dy <= maxY; dy = dy > 0 ? -dy : 1 - dy) {
      for (var r = 0; r < range; r++) {
        for (var dx = 0; dx <= r; dx = dx > 0 ? -dx : 1 - dx) {
          for (var dz = (dx < r && dx > -r) ? r : 0; dz <= r; dz = dz > 0 ? -dz : 1 - dz) {
            var p = { x: bx + dx, y: by + dy - 1, z: bz + dz };
            if ((!Ai || !Ai.isInWalkTargetRange || Ai.isInWalkTargetRange(e, p)) && isTarget(p.x, p.y, p.z)) return p;
          }
        }
      }
    }
    return null;
  };
  /** `MoveToTargetPosGoal.findTargetPos` (range 16, lowestY 0, maxY 1) with `LayEggGoal.isTargetPos`:
   *  sand with air directly above. First hit in vanilla scan order. */
  Tu.findEggSpot = function (e) {
    var W = NS.World, SR = NS.States;
    return Tu.scanTarget(e, Tu.EGG_SEARCH_RANGE, 0, 1, function (x, y, z) {
      if (!Tu.isSand(x, y, z)) return false;
      var above = W.getBlock(x, y + 1, z);
      return above === 0 || !!(SR && SR.isAir && SR.isAir[above]);
    });
  };

  /** Places `Blocks.turtle_egg` with `EGGS = random.nextInt(4)+1` (1..4, verbatim) ABOVE the
   *  sand cell (`this.targetPos.up()`, .decomp) — `R.PROP`/`R.PVAL`/`R.defaultState` are the
   *  SAME jar-extracted property table `02c_states.js`'s own `SR.withProp` already reads. */
  Tu.placeEgg = function (x, y, z, rand) {
    var NSt = NS.States, R = NS.Reg, W = NS.World;
    if (!NSt || !R || !R.id || R.id.turtle_egg === undefined) return false;
    rand = rand || RNDFB;
    // `NSt.stateOf` is the real global state id (`R.realFirst[b] + R.defaultState[b]`,
    // 02c_states.js's own header) -- `R.defaultState[b]` ALONE is only the LOCAL offset
    // within that block's own state range and is not a valid state id by itself (the same
    // distinction `SR.withLocal` exists to keep in one place).
    var state = NSt.stateOf('turtle_egg');
    var count = Math.floor(rand() * 4) + 1;
    if (R.PROP && R.PROP.eggs !== undefined && R.PVAL) {
      var v = R.PVAL[String(count)];
      if (v !== undefined) state = NSt.withProp(state, R.PROP.eggs, v);
    }
    W.setBlock(x, y, z, state);
    Tu.eggAdded(x, y, z, rand);
    return true;
  };

  /**
   * `TurtleEntity.LayEggGoal` folded onto ONE bespoke goal (this file's own header explains
   * why: no `MoveToTargetPosGoal` search-radius substrate). Walks toward a nearby sand-with-
   * air-above cell, then digs for `Tu.DIG_TICKS` before placing the egg one cell above it.
   */
  Tu.LayEggGoal = function (e, ctx) {
    ctx = ctx || {};
    var rand = ctx.random || RNDFB;
    var target = null, cooldown = 0, trying = 0, safeWait = 0;
    function targetOk() {   // isTargetPos: sand with air directly above
      var a = NS.World.getBlock(target.x, target.y + 1, target.z), SR = NS.States;
      return Tu.isSand(target.x, target.y, target.z) && (a === 0 || !!(SR && SR.isAir && SR.isAir[a]));
    }
    this.canUse = function () {
      if (!e.hasEgg) return false;
      if (Tu.homeDist(e) > Tu.LAY_EGG_HOME_RANGE) return false;
      if (cooldown > 0) { cooldown--; return false; }   // MoveToTargetPosGoal.canStart
      cooldown = 200 + Math.floor(rand() * 200);
      target = Tu.findEggSpot(e);
      return !!target;
    };
    this.canContinueToUse = function () {
      return !!(e.hasEgg && target && Tu.homeDist(e) <= Tu.LAY_EGG_HOME_RANGE
        && trying >= -safeWait && trying <= 1200 && targetOk());
    };
    // vanilla LayEggGoal has no start()/stop(): TurtleEntity.sandDiggingCounter/DIGGING_SAND persist if interrupted
    this.start = function () { trying = 0; safeWait = Math.floor(rand() * (Math.floor(rand() * 1200) + 1200)) + 1200; };
    this.stop = function () { target = null; };
    this.tick = function () {
      if (!target) return;
      var dx = target.x + 0.5 - e.x, dy = target.y + 1.5 - e.y, dz = target.z + 0.5 - e.z;
      if (dx * dx + dy * dy + dz * dz > 1.0) {   // target.up() isWithinDistance(pos, 1.0), block centre
        trying++;
        if (NS.Ai && NS.Ai.stepToward) NS.Ai.stepToward(e, { x: target.x + 0.5, y: target.y, z: target.z + 0.5 }, ctx.speed || 1.0);
        return;
      }
      trying--;
      if (e.inWater) return;   // LayEggGoal.tick: `!this.turtle.isTouchingWater() && this.hasReached()`
      // vanilla: counter<1 -> setDiggingSand(true) (counter=1); else if counter>200 -> lay; then counter++ if digging
      if (!(e.sandDiggingCounter >= 1)) { e.diggingSand = true; e.sandDiggingCounter = 1; }   // setDiggingSand(true)
      else if (e.sandDiggingCounter > Tu.DIG_TICKS) {
        if (NS.Sound && NS.Sound.play) NS.Sound.play('entity.turtle.lay_egg', { x: e.x, y: e.y, z: e.z, volume: 0.3, pitch: 0.9 + rand() * 0.2, source: 'block' });
        Tu.placeEgg(target.x, target.y + 1, target.z, rand);
        e.hasEgg = false;
        e.diggingSand = false; e.sandDiggingCounter = 0;   // setDiggingSand(false)
        e.inLove = Tu.EGG_LOVE_TICKS;
        target = null;
      }
      if (e.diggingSand) e.sandDiggingCounter++;
    };
  };

  /** `TurtleEntity.tickMovement`'s own digging-sound event (`syncWorldEvent(2001, ...)` every
   *  5th digging tick). This engine has no world-event/particle-sound emitter substrate at
   *  all (`dupcheck` refuses a call to a namespace member nothing defines, and inventing one
   *  here would be exactly that) -- named on `Tu.OWED` instead of stubbed. */
  Tu.tickDigSound = function (e) {
    if (!e || e.type !== 'turtle' || !e.diggingSand) return;
    var c = e.sandDiggingCounter | 0;
    if (e.dead || c < 1 || c % 5 !== 0) return;
    var x = Math.floor(e.x), y = Math.floor(e.y), z = Math.floor(e.z);
    if (!Tu.isSandBelow(x, y, z)) return;
    var W = NS.World, S = NS.Sound, st = W && W.getBlock(x, y - 1, z);
    if (st && S && S.blockBreak) S.blockBreak(st, e.x, e.y, e.z, null);   // worldEvent 2001: the block's break sound (+ dust below)
    var Px = NS.Particle;
    if (st && Px && Px.spawnBlockDust) for (var i = 0; i < 8; i++)
      Px.spawnBlockDust(e.x + (RNDFB() - 0.5) * 0.6, e.y + 0.1, e.z + (RNDFB() - 0.5) * 0.6, 0, 0.1, 0, st, x, y - 1, z, RNDFB);
  };

  // ── § BREED — `TurtleEntity.MateGoal extends AnimalMateGoal` (.decomp lines 454-483) ──────
  Tu.MATE_RANGE = 8;       // AnimalMateGoal's own base search range (same as Ai.BREED_RANGE)

  /**
   * `MateGoal.breed()` (.decomp lines 467-483), verbatim: sets `hasEgg(true)` INSTEAD OF
   * `AnimalMateGoal.breed()`'s generic `createChild`, resets both parents' love, and spawns
   * the SAME `random.nextInt(7)+1` xp orb behind `doMobLoot` `Br.spawnXp` already implements
   * (07m_breed.js) -- read live rather than re-typed, the same convention this file's own
   * header cites for llama_spit/potion's gravity/drag.
   */
  Tu.MateGoal = function (e, speed, ctx) {
    ctx = ctx || {};
    var rand = ctx.random || RNDFB;
    var getPartners = ctx.animals || function () { return []; };
    var partner = null, timer = 0;
    this.canUse = function () {
      if (e.hasEgg || !e.inLove) return false;
      var cs = getPartners();
      var best = null, bestD = Infinity;
      for (var i = 0; i < cs.length; i++) {
        var c = cs[i];
        if (c === e || c.type !== e.type || !c.inLove) continue;
        var d = Math.hypot(c.x - e.x, c.z - e.z);
        if (d <= Tu.MATE_RANGE && d < bestD) { best = c; bestD = d; }
      }
      if (best) { partner = best; return true; }
      return false;
    };
    this.canContinueToUse = function () { return !!(partner && !partner.dead && !partner.removed && !e.hasEgg && e.inLove && partner.inLove && timer < NS.Ai.BREED_TICKS); };
    this.start = function () {};
    this.stop = function () { partner = null; timer = 0; };
    this.tick = function () {
      if (!partner) return;
      timer++;
      if (timer >= NS.Ai.BREED_TICKS && NS.Ai.breedNear(e, partner)) {
        // MateGoal.breed: getLovingPlayer (own, else mate's) -> incrementStat(ANIMALS_BRED); BRED_ANIMALS criterion is G26d.
        if ((e.loveCause || partner.loveCause) && NS.Stats && NS.Stats.inc) NS.Stats.inc('animals_bred');
        e.hasEgg = true;
        e.inLove = 0;
        partner.inLove = 0;
        var Br = NS.Breed;
        if (Br && Br.ready && Br.spawnXp) Br.spawnXp(e, ctx);
        this.stop();
        return;
      }
      if (NS.Ai && NS.Ai.stepToward) NS.Ai.stepToward(e, partner, speed);
    };
  };

  // ── § GOALS — swim + walk (`WanderInWaterGoal`/`WanderOnLandGoal`/`GoHomeGoal`, .decomp
  // lines 654-702 + 254-402, folded to two bespoke goals, the SAME simplification `Ax.
  // WanderGoal`'s own header already names as this engine's standing precedent) ─────────────
  // WanderInWaterGoal ctor `isBaby() ? 2.0 : speed` is always `speed`: initGoals runs before age is set (#3798)
  Tu.WATER_SEARCH_RANGE = 24;         // WanderInWaterGoal: MoveToTargetPosGoal(range 24), lowestY -1
  Tu.WATER_GIVE_UP = 1200;            // WanderInWaterGoal.shouldContinue: tryingTime <= 1200
  Tu.ESCAPE_WATER_RANGE = 7;          // TurtleEscapeDangerGoal: locateClosestWater(7)
  Tu.TRAVEL_RANGE = 512;              // TravelGoal.start: nextInt(1025) - 512 on x and z
  Tu.TRAVEL_VRANGE = 4;
  Tu.TRAVEL_LEG = 16;                 // one straight leg (NoPenaltyTargeting.findTo(.., 16, 3, ..))
  Tu.SEA_LEVEL = 63;

  // ── s135 (Dan saw turtles spinning in place and racing on land, 25 Sept) ─────────────────
  // (1) ARRIVAL. The goal used to finish only inside 1 block of the target's CORNER in 3-D while
  // `Ai.stepToward` steers to the block CENTRE and stops only within 2.5e-7 — a target one block
  // above/below the ground (dy = ±1 is a third of all rolls) could never be reached, so the
  // turtle orbited it forever at 90°/tick. Vanilla ends a leg the way
  // `EntityNavigation.continueFollowingPath` advances a node: |dx|,|dz| < nodeReachProximity
  // (width > 0.75 ? width/2 : 0.75 - width/2) of the block's bottom-centre and |dy| < 1.
  Tu.reached = function (e, t) {
    var w = e.width === undefined ? 1.2 : e.width;
    var prox = w > 0.75 ? w / 2 : 0.75 - w / 2;
    return Math.abs((t.x + 0.5) - e.x) < prox && Math.abs((t.z + 0.5) - e.z) < prox
      && Math.abs(t.y - e.y) < 1;
  };
  // (2) GIVING UP. `EntityNavigation.checkTimeouts`: every 100 ticks, a mob still within 1.5
  // blocks (squared 2.25) of where that window began stops navigating.
  Tu.NAV_TIMEOUT_TICKS = 100;
  Tu.NAV_STUCK_SQ = 2.25;
  Tu.navStart = function (e, nav) { nav.t = 0; nav.x = e.x; nav.y = e.y; nav.z = e.z; };
  Tu.navTimedOut = function (e, nav) {
    if (nav.t === undefined) Tu.navStart(e, nav);
    if (++nav.t <= Tu.NAV_TIMEOUT_TICKS) return false;
    var dx = e.x - nav.x, dy = e.y - nav.y, dz = e.z - nav.z;
    if (dx * dx + dy * dy + dz * dz < Tu.NAV_STUCK_SQ) return true;
    Tu.navStart(e, nav);
    return false;
  };
  // (3) SPEED. `TurtleMoveControl` (.decomp TurtleEntity ~584-625): `updateVelocity` first — in
  // water +0.005 up, speed halved (floor 0.08) when over 16 from home, a baby's thirded (floor
  // 0.06); ON LAND halved (floor 0.06) — then the speed LERPS 1/8 of the way toward
  // speed x MOVEMENT_SPEED, and the vertical pull is speed * dy/dist * 0.1. A turtle on land
  // therefore settles near 0.084, a third of the 0.25 the plain stepToward gave it.
  Tu.HOME_FAR = 16;
  Tu.moveSpeedStep = function (e, speedMod) {
    var s = e.tuSpeed || 0;
    if (e.inWater) {
      if (e.homeX !== undefined && Tu.homeDist(e) > Tu.HOME_FAR) s = Math.max(s / 2, 0.08);
      if (e.isBaby) s = Math.max(s / 3, 0.06);
    } else if (e.onGround) s = Math.max(s / 2, 0.06);
    var want = speedMod * (NS.Ai && NS.Ai.movementSpeedOf ? NS.Ai.movementSpeedOf(e) : 0.25);
    s = s + 0.125 * (want - s);
    e.tuSpeed = s;
    return s;
  };
  /** `EntityNavigation.startMovingTo` + tick over this engine's `Ai.findPath` (partial = vanilla's nearest
   *  visited node): re-plans every 20 ticks or when the path is spent, walks the nodes, and falls back to
   *  a straight step when no path exists. `nav` is the goal's own state object. */
  Tu.pathStep = function (e, nav, t, speedMod) {
    var Ai = NS.Ai;
    if (Ai.findPath && (!nav.p || nav.i >= nav.p.length || (nav.age = (nav.age || 0) + 1) % 20 === 0)) {
      var p = Ai.findPath(e.x, e.y, e.z, t.x + 0.5, t.y, t.z + 0.5, { mob: e, partial: true, nodeOk: Tu.nodeOk(e) });
      nav.p = p && p.length > 1 ? p : null; nav.i = 1;
    }
    if (nav.p && nav.i < nav.p.length) {
      Tu.moveToward(e, nav.p[nav.i], speedMod);
      nav.i = Ai.advancePathNode(e, nav.p, nav.i);
    } else Tu.moveToward(e, t, speedMod);
  };
  /** `TurtleSwimNavigation.isValidPosition`: actively travelling -> node must be water; else block below non-air. */
  Tu.nodeOk = function (e) {
    return function (x, y, z) {
      return e.activelyTravelling ? waterBlock(x, y, z) : NS.World.getBlock(x, y - 1, z) !== 0;
    };
  };
  /** `TurtleEntity.getPathfindingFavor`: water 10 unless land-bound, sand below 10, else brightness - 0.5. */
  Tu.favor = function (e) {
    return function (x, y, z) {
      if (!e.landBound && waterBlock(x, y, z)) return 10;
      if (Tu.isSandBelow(x, y, z)) return 10;
      var W = NS.World;
      return (W.getLight ? W.getLight(x, y, z) / 15 : 0.5) - 0.5;
    };
  };
  /** `NoPenaltyTargeting.findTo(turtle, h, v, home, angle)` with the turtle's favor. */
  Tu.findTo = function (e, rand, h, v, angle, to) {
    return NS.Ai.findTowardPositionTarget(e, rand, h, v, angle, to, Tu.favor(e));
  };
  Tu.moveToward = function (e, t, speedMod) {
    var Ai = NS.Ai;
    Ai.stepToward(e, t, speedMod);
    var s = Tu.moveSpeedStep(e, speedMod);
    Ai.setMobSpeed(e, s);
    var dx = (t.x + 0.5) - e.x, dy = t.y - e.y, dz = (t.z + 0.5) - e.z;
    var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > 1e-9) e.vy = (e.vy || 0) + s * (dy / d) * 0.1;
  };
  /** `TurtleEntity.travel` (.decomp 312-323): in water updateVelocity(0.1)+move+*0.9, and the -0.005 sink ONLY while
   *  there is no target and (not landBound or 20+ from home); out of water the plain ground travel. */
  Tu.travelMob = function (e) {
    var Ph = NS.Physics;
    if (!e.inWater) { Ph.travelMob(e); return; }
    e.vy = (e.vy || 0) + 0.005; // TurtleMoveControl.tick -> updateVelocity runs every tick, goal or not
    var zza = (e.zza || 0) * Ph.INPUT_SCALE; // LivingEntity.tickMovement: forwardSpeed *= 0.98
    e.vx = (e.vx || 0) + zza * Math.sin(e.yaw) * 0.1;
    e.vz = (e.vz || 0) - zza * Math.cos(e.yaw) * 0.1;
    Ph.move(e, e.vx, e.vy || 0, e.vz);
    e.vx *= 0.9; e.vy = (e.vy || 0) * 0.9; e.vz *= 0.9;
    if (!e.target && !(e.landBound && Tu.homeDist(e) < 20)) e.vy -= 0.005;
  };
  Tu.stopMoving = function (e) { e.tuSpeed = 0; if (NS.Ai && NS.Ai.setMobSpeed) NS.Ai.setMobSpeed(e, 0); };

  function waterBlock(x, y, z) {
    var st = NS.World.getBlock(x, y, z);
    return st > 0 && NS.States.block[st] === NS.Reg.id.water;
  }

  /** `TurtleEscapeDangerGoal` (prio 0, speed 1.2): in danger -> the closest water within 7
   *  (`EscapeDangerGoal.locateClosestWater`), else the plain `EscapeDangerGoal` flee (`Ai.PanicGoal`). */
  Tu.EscapeDangerGoal = function (e, speed, ctx) {
    var rand = (ctx && ctx.random) || RNDFB;
    var panic = new NS.Ai.PanicGoal(e, speed, { random: rand });
    var water = null, nav = {}, usingPanic = false;
    this.canUse = function () {
      var Fl = NS.Fly;
      var danger = !!e.justHurt || !!(Fl && Fl.attackerOf ? Fl.attackerOf(e) : e.lastHurtByEntity) || NS.Ai.shouldEscapePowderSnow(e) || !!e.isOnFire;
      if (!danger) return false;
      water = Fl && Fl.locateClosestWater ? Fl.locateClosestWater(e, Tu.ESCAPE_WATER_RANGE) : null;
      if (water) { usingPanic = false; return true; }
      usingPanic = true;
      return panic.canUse();
    };
    this.canContinueToUse = function () {
      if (usingPanic) return panic.canContinueToUse();
      return !!water && !Tu.reached(e, water) && !Tu.navTimedOut(e, nav);
    };
    this.start = function () {
      e.justHurt = false;
      if (usingPanic) panic.start(); else Tu.navStart(e, nav);
    };
    this.stop = function () { if (usingPanic) panic.stop(); else Tu.stopMoving(e); water = null; usingPanic = false; };
    this.tick = function () {
      if (usingPanic) { panic.tick(); NS.Ai.setMobSpeed(e, Tu.moveSpeedStep(e, speed)); return; }   // TurtleMoveControl speed, not plain stepToward
      if (water) Tu.moveToward(e, water, speed);
    };
  };

  /** `TurtleEntity.WanderInWaterGoal` (prio 3): a MoveToTargetPosGoal over water blocks within 24
   *  (lowestY -1), for a turtle on land that is not land-bound / carrying an egg, or ANY baby on
   *  land, at speed 2.0 for a baby. `MoveToTargetPosGoal.canStart` retries after 200 + nextInt(200). */
  Tu.WanderInWaterGoal = function (e, speed, ctx) {
    var rand = (ctx && ctx.random) || RNDFB;
    var cooldown = 0, target = null, trying = 0, nav = {};
    function findWater() {
      return Tu.scanTarget(e, Tu.WATER_SEARCH_RANGE, -1, 1, waterBlock);
    }
    this.canUse = function () {
      if (e.isBaby && !e.inWater) { /* baby on land: no further gate */ }
      else if (e.landBound || e.inWater || e.hasEgg) return false;
      if (cooldown > 0) { cooldown--; return false; }
      cooldown = 200 + Math.floor(rand() * 200);
      target = findWater();
      return !!target;
    };
    this.canContinueToUse = function () {
      return !e.inWater && trying <= Tu.WATER_GIVE_UP && !!target
        && waterBlock(target.x, target.y, target.z);
    };
    this.start = function () { trying = 0; Tu.navStart(e, nav); };
    this.stop = function () { target = null; Tu.stopMoving(e); };
    this.tick = function () {
      trying++;
      if (target) Tu.pathStep(e, nav, target, speed);   // MoveToTargetPosGoal -> navigation.startMovingTo
    };
  };

  /** `TurtleEntity.TravelGoal` (prio 7): in water, not land-bound, no egg -> a random target up to
   *  512 away on x/z (+-4 on y, 0 if that would rise above sea level - 1), walked in straight
   *  16-block legs (`NoPenaltyTargeting.findTo`'s pathfinding is the OWED substrate). */
  Tu.TravelGoal = function (e, speed, ctx) {
    var rand = (ctx && ctx.random) || RNDFB;
    var travel = null, nav = {};
    this.canUse = function () { return !e.landBound && !e.hasEgg && !!e.inWater; };
    this.canContinueToUse = function () {
      return !!travel && !e.landBound && !e.hasEgg && !e.inLove && !Tu.navTimedOut(e, nav)
        && !(Math.abs(travel.x + 0.5 - e.x) < 1 && Math.abs(travel.z + 0.5 - e.z) < 1);
    };
    this.start = function () {
      var R = Tu.TRAVEL_RANGE, V = Tu.TRAVEL_VRANGE;
      var dx = Math.floor(rand() * (2 * R + 1)) - R, dy = Math.floor(rand() * (2 * V + 1)) - V;
      var dz = Math.floor(rand() * (2 * R + 1)) - R;
      if (dy + e.y > Tu.SEA_LEVEL - 1) dy = 0;
      travel = { x: Math.floor(e.x + dx), y: Math.floor(e.y + dy), z: Math.floor(e.z + dz) };
      e.travelPos = travel; e.activelyTravelling = true;
      Tu.navStart(e, nav);
    };
    this.stop = function () { e.activelyTravelling = false; travel = null; Tu.stopMoving(e); };
    this.tick = function () {
      if (!travel) return;
      var dx = travel.x + 0.5 - e.x, dz = travel.z + 0.5 - e.z, d = Math.sqrt(dx * dx + dz * dz);
      var k = d > Tu.TRAVEL_LEG ? Tu.TRAVEL_LEG / d : 1;
      Tu.pathStep(e, nav, { x: Math.floor(e.x + dx * k), y: travel.y, z: Math.floor(e.z + dz * k) }, speed);
    };
  };

  /** `TurtleEntity.WanderOnLandGoal` (prio 9, speed 1.0, chance 100): `WanderAroundGoal` gated on
   *  !touchingWater && !landBound && !hasEgg. */
  Tu.WanderOnLandGoal = function (e, speed, rand, chance) {
    var inner = new NS.Ai.WanderAroundGoal(e, speed, rand, chance);
    this.canUse = function () { return !e.inWater && !e.landBound && !e.hasEgg && inner.canUse(); };
    this.canContinueToUse = function () { return inner.canContinueToUse(); };
    this.start = function () { inner.start(); };
    this.stop = function () { inner.stop(); };
    this.tick = function () { inner.tick(); };
  };

  /** `TurtleEntity.GoHomeGoal` (.decomp lines 336-402): canStart refuses babies, ALWAYS accepts an
   *  egg carrier (go home to lay), else a 1/700 roll and home NOT within 64; start/stop set/clear
   *  `landBound`; continues until within 7 of home, 600 ticks counted only within 16 of home. The
   *  NoPenaltyTargeting path search is folded to a straight walk (no such substrate, see Tu.OWED);
   *  the 100-tick stuck stop stands in for `noPath`. */
  Tu.GO_HOME_START_RANGE = 64;
  Tu.GO_HOME_STOP_RANGE = 7;
  Tu.GO_HOME_NEAR = 16;
  Tu.GO_HOME_MAX_TRY = 600;
  Tu.GO_HOME_ROLL = 700;
  Tu.GoHomeGoal = function (e, ctx) {
    ctx = ctx || {};
    var rand = ctx.random || RNDFB;
    var nav = {}, tries = 0, stuck = false;
    this.canUse = function () {
      if (e.isBaby) return false;
      if (e.hasEgg) return true;
      if (Math.floor(rand() * Tu.GO_HOME_ROLL) !== 0) return false;
      return !(Tu.homeDist(e) <= Tu.GO_HOME_START_RANGE);
    };
    this.canContinueToUse = function () {
      if (stuck || tries > Tu.GO_HOME_MAX_TRY) return false;
      return !(Tu.homeDist(e) <= Tu.GO_HOME_STOP_RANGE);
    };
    this.start = function () { e.landBound = true; stuck = false; tries = 0; Tu.navStart(e, nav); };
    this.stop = function () { e.landBound = false; Tu.stopMoving(e); };
    this.tick = function () {
      if (!NS.Ai || !NS.Ai.stepToward || e.homeX === undefined) return;
      var near = Tu.homeDist(e) <= Tu.GO_HOME_NEAR;
      if (near) tries++;
      if (Tu.navTimedOut(e, nav)) { stuck = true; return; }
      if (!nav.p || nav.i >= nav.p.length) {   // navigation.isIdle(): re-pick findTo with its 3 fallbacks
        var home = { x: Math.floor(e.homeX) + 0.5, y: Math.floor(e.homeY), z: Math.floor(e.homeZ) + 0.5 };
        var p = Tu.findTo(e, rand, 16, 3, Math.PI / 10, home) || Tu.findTo(e, rand, 8, 7, Math.PI / 2, home);
        if (p && !near && !waterBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))) p = Tu.findTo(e, rand, 16, 5, Math.PI / 2, home);
        if (!p) { stuck = true; return; }
        nav.tgt = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) }; nav.p = null; nav.age = 0;
      }
      Tu.pathStep(e, nav, nav.tgt || { x: Math.floor(e.homeX), y: Math.floor(e.homeY), z: Math.floor(e.homeZ) }, ctx.speed || 1.0);
    };
  };

  // ── § GROW UP — `TurtleEntity.onGrowUp` (.decomp lines 306-311), verbatim: one `scute`
  // behind `doMobLoot`, on the baby->adult transition only ──────────────────────────────────
  Tu.SCUTE_DROP_COUNT = 1;
  Tu.onGrowUp = function (e) {
    if (!e || e.type !== 'turtle') return;
    var Br = NS.Breed;
    if (!(Br && Br.ready && Br.mobLoot && Br.mobLoot())) return;
    var EL = NS.EntityList;
    if (EL && EL.dropStack) EL.dropStack(e.x, e.y, e.z, 'scute', Tu.SCUTE_DROP_COUNT);
  };

  // ── § EGG BLOCK — `TurtleEggBlock` (.decomp/net/minecraft/block/TurtleEggBlock.java), verbatim:
  // randomTick (hatch), onSteppedOn (1/100), onLandedUpon (1/3, not zombies), afterBreak ─────────
  Tu.EGG_HATCH_SOUND = 'entity.turtle.egg_crack';     // SoundEvents.field_15109
  Tu.EGG_BORN_SOUND = 'entity.turtle.egg_hatch';      // SoundEvents.field_14902
  Tu.EGG_BREAK_SOUND = 'entity.turtle.egg_break';     // SoundEvents.field_14687
  Tu.BABY_AGE = -24000;                              // setBreedingAge(-24000)
  Tu.eggSounds = [];                                 // headless-observable log of every egg sound

  function eggSound(ev, x, y, z, rnd) {
    var pitch = 0.9 + rnd() * 0.2;                   // 0.9F + random.nextFloat() * 0.2F, volume 0.7F
    Tu.eggSounds.push({ ev: ev, x: x, y: y, z: z, volume: 0.7, pitch: pitch });
    if (Tu.eggSounds.length > 64) Tu.eggSounds.shift();
    var Sn = NS.Sound, P = NS.Player;
    if (Sn && Sn.ready && Sn.play) Sn.play(ev, { volume: 0.7, pitch: pitch, x: x + 0.5, y: y + 0.5, z: z + 0.5,
      listener: P ? { x: P.x, y: P.y, z: P.z } : null });
  }
  function eggProp(st, name) {
    var R = NS.Reg, NSt = NS.States;
    var k = R.propFirst[NSt.block[st]], hi = R.propFirst[NSt.block[st] + 1], pid = R.PROP[name];
    var b = NSt.block[st], lo = R.realFirst[b], local = st - lo;
    for (; k < hi; k++) {
      if (R.propId[k] !== pid) continue;
      var n = R.propValN[k], v = ((local / R.propStride[k]) | 0) % n;
      return +R.valueNames[R.propVals[R.propValOff[k] + v]];
    }
    return 0;
  }
  function isEgg(st) { var R = NS.Reg; return st > 0 && R.id.turtle_egg !== undefined && NS.States.block[st] === R.id.turtle_egg; }
  function eggSet(st, name, val) { return NS.Behave.setProp(st, name, val); }
  Tu.eggCount = function (st) { return eggProp(st, 'eggs'); };
  Tu.eggHatch = function (st) { return eggProp(st, 'hatch'); };

  /** `TurtleEggBlock.shouldHatchProgress`: skyAngle in (0.65, 0.69), else `nextInt(500) == 0`. */
  Tu.eggShouldHatchProgress = function (rnd, skyAngle) {
    if (skyAngle === undefined) {
      var Sky = NS.Sky;
      skyAngle = Sky && Sky.timeOfDay ? Sky.timeOfDay(Sky.dayTime || 0) : 0;
    }
    return (skyAngle < 0.69 && skyAngle > 0.65) ? true : ((rnd() * 500) | 0) === 0;
  };

  /** `TurtleEggBlock.randomTick`. `skyAngle` is optional (tests); the live world reads `Sky`. */
  Tu.eggRandomTick = function (x, y, z, st, rnd, skyAngle) {
    rnd = rnd || RNDFB;
    if (!Tu.eggShouldHatchProgress(rnd, skyAngle) || !Tu.isSandBelow(x, y, z)) return false;
    var W = NS.World, hatch = Tu.eggHatch(st);
    if (hatch < 2) {
      eggSound(Tu.EGG_HATCH_SOUND, x, y, z, rnd);
      W.setBlock(x, y, z, eggSet(st, 'hatch', hatch + 1));
      return true;
    }
    eggSound(Tu.EGG_BORN_SOUND, x, y, z, rnd);
    W.setBlock(x, y, z, 0);
    var n = Tu.eggCount(st), EL = NS.EntityList, Br = NS.Breed;
    for (var i = 0; i < n; i++) {
      if (NS.Sound && NS.Sound.blockBreak) NS.Sound.blockBreak(st, x, y, z, null);   // worldEvent 2001 per egg (TurtleEggBlock line 85)
      var e = EL && EL.spawn ? EL.spawn('turtle', x + 0.3 + i * 0.2, y, z + 0.3, { growAge: Tu.BABY_AGE }) : null;
      if (!e) continue;
      if (Br && Br.ready && Br.setBaby) Br.setBaby(e, true);
      e.growAge = Tu.BABY_AGE;
      Tu.setHomePos(e, x, y, z);
    }
    return true;
  };

  /** `TurtleEggBlock.breaksEgg`: not Turtle/Bat; LivingEntity only; player or `mobGriefing`. */
  Tu.eggBreaksEgg = function (e) {
    if (!e || e.type === 'turtle' || e.type === 'bat') return false;
    if (e === NS.Player || e.type === 'player') return true;
    if (!(e.living !== false && e.maxHealth !== undefined)) return false;
    var C = NS.Commands;
    if (C && typeof C.ruleGet === 'function') return C.ruleGet('mobGriefing') === 'true';
    var r = NS.DATA && NS.DATA.gameRules && NS.DATA.gameRules.mobGriefing;
    return !r || r.d === 'true';
  };

  /** `TurtleEggBlock.breakEgg`: sound, then EGGS-1 (with the break event) or break the block. */
  Tu.eggBreak = function (x, y, z, st, rnd) {
    rnd = rnd || RNDFB;
    eggSound(Tu.EGG_BREAK_SOUND, x, y, z, rnd);
    var n = Tu.eggCount(st), W = NS.World;
    if (n <= 1) W.setBlock(x, y, z, 0);
    else W.setBlock(x, y, z, eggSet(st, 'eggs', n - 1));
    // worldEvent 2001 in BOTH branches (breakBlock / syncWorldEvent): break sound + dust of the state before
    if (NS.Sound && NS.Sound.blockBreak) NS.Sound.blockBreak(st, x + 0.5, y + 0.5, z + 0.5, null);
    if (NS.Particle && NS.Particle.addBlockBreakParticles) NS.Particle.addBlockBreakParticles(x, y, z, st, null);
  };

  /** `TurtleEggBlock.onBlockAdded`: sand below -> worldEvent 2005 (`Particle.worldEvent`). */
  Tu.eggAdded = function (x, y, z, rand) {
    if (!Tu.isSandBelow(x, y, z) || !NS.Particle || !NS.Particle.worldEvent) return false;
    NS.Particle.worldEvent(2005, x, y, z, 0, rand);
    return true;
  };

  function tryBreakEgg(e, x, y, z, bound, rnd) {
    var st = NS.World.getBlock(x, y, z);
    if (!isEgg(st) || !Tu.eggBreaksEgg(e)) return false;
    rnd = rnd || RNDFB;
    if (((rnd() * bound) | 0) !== 0) return false;
    Tu.eggBreak(x, y, z, st, rnd);
    return true;
  }
  /** `onSteppedOn`: 1-in-100 per call; Entity.move skips it when bypassesSteppingEffects() (= isSneaking). */
  Tu.eggSteppedOn = function (e, x, y, z, rnd) {
    if (e && (e.sneaking || e.edgeGuard || (NS.Combat && NS.Combat.bypassesSteppingEffects(e)))) return false;
    return tryBreakEgg(e, x, y, z, 100, rnd);
  };
  /** `onLandedUpon`: 1-in-3, never for a zombie-family entity. */
  Tu.eggLandedUpon = function (e, x, y, z, rnd) {
    if (e && /^(zombie|husk|drowned|zombie_villager|zombified_piglin)$/.test(e.type)) return false;
    return tryBreakEgg(e, x, y, z, 3, rnd);
  };
  /** `afterBreak` -> `breakEgg` (the mined block's state, read before it was cleared). */
  Tu.eggAfterBreak = function (x, y, z, st, rnd) { if (isEgg(st)) Tu.eggBreak(x, y, z, st, rnd); };

  /** Per-entity housekeeping, called from the SAME mobTick slot every other mob's own
   *  07i_entitylist.js registration line already uses (`Ax.tickPlayDead`/`Pd.tickSneeze`'s
   *  own precedent). Folds the digging-sound event only -- the growUp/scute hook is wired
   *  separately (07i_entitylist.js, around its own `Br.tickAge` call) because it needs the
   *  age value from BEFORE that tick's own age-walk runs. */
  Tu.tick = function (e) { Tu.tickDigSound(e); };

})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
