// 07k_goals.js — PLAN G18b (PASS 16 JOB 1, first slice): the goal selector and pathfinding.
// Runs on: MAIN THREAD ONLY. No DOM.
//
// ⚠⚠ WHAT THIS FILE IS, AND WHAT IT IS NOT YET. `GoalSelector` below is vanilla's own model —
// priority + a flag set (MOVE/LOOK/JUMP/TARGET), a lower priority NUMBER wins, and a running
// goal is stopped the instant a higher-priority goal claims a flag it holds. That is a generic
// scheduling algorithm; it needs no referee, and `goalcheck.mjs` proves the FLAG-CONFLICT rule
// is load-bearing (D-30's anti-vacuity idiom: disable it and watch the conflict test fail).
//
// ⚠⚠ THE NODE EVALUATOR IS DELIBERATELY GENERIC, NOT THE JAR'S OWN TABLE — AND SAYS SO. PASS-16
// -CURRENT.md's own words: "the node-type table is the part that must come from the jar, not
// from reasoning." `Ai.pathTypeAt` below classifies BLOCKED / WALKABLE / WATER / LAVA / OPEN
// from `Ph.solidAt` and the fluid state at a cell — data this engine already carries and has
// already been through a referee (the block registry's collision shapes). What it does NOT
// carry is vanilla's PER-BLOCK special-case table (`DANGER_CACTUS`, `DAMAGE_FIRE`,
// `DANGER_OTHER`, `STICKY_HONEY`, rails, doors, `BREACH`, `LEAVES`) or the real per-mob
// `pathfindingMalus` weights — those are `Ai.OWED`, named rather than guessed, and a future
// session should extract them from the jar exactly the way `extract-setupanim.mjs` did for
// `setupAnim` (D-263's rules) before this file claims parity for them. D-382 has the full
// account of this session's own scoping choices, including the precondition below.
//
// ⚠ WIRED INTO A LIVE FRAME AS OF D-391 (session 31). `EL.spawn` attaches a real
// `Ai.selectorFor` goal selector to every `cow`/`zombie` it creates (`EL.aiCtx`,
// `07i_entitylist.js`), and `EL.tickOne` ticks it every world tick, after gravity/collision and
// after `Combat.tickEntity` so a goal reacting to this tick's hit sees it. `goalcheck.mjs`'s
// SYNTHETIC-entity proof below is UNCHANGED and still the one that exercises the flag-conflict
// rule, the cliff refusal and the follow-range boundary in isolation; the live wiring is
// integration on top of it, not a replacement for it — a regression in either should fail its
// own check (`goalcheck.mjs` for the algorithm, `aicheck.mjs`/`entlistcheck.mjs` for the wiring).
//
// ⚠ SESSION 27 (D-383) ADDED FIVE MORE: `HurtByTargetGoal`, `AvoidEntityGoal`, `FollowParentGoal`,
// `BreedGoal`, `TemptGoal` — same discipline as the first eight: the ALGORITHM is generic and
// proven against synthetic entities (`goalcheck.mjs` §§8-12), and every place vanilla's own DATA
// would matter (which items tempt which mob, baby/love-mode state, exact per-mob priorities) is
// an injected parameter or a named `Ai.OWED` gap, never a guess.
//
// ⚠ SESSION 33 (D-394) CLOSED THE STRIKE ITSELF: `MeleeAttackGoal` now calls `Cb.mobAttack`
// (vanilla's `Mob.doHurtTarget`) once a target is within the real reach formula and the 20-tick
// cooldown has elapsed — a zombie hits the player now, not just stands next to them. `Ai.OWED`
// still names: `RangedBowAttackGoal`, `SpiderAttackGoal`, `LeapAtTargetGoal`, the door-breaking
// half of `ZombieAttackGoal`, and — new this session — that D-394's own reach/cooldown constants
// came from public mapped decompiles rather than a fresh bytecode extractor.
//
// ⚠ SESSION 37 CLOSED TWO MORE OF `Ai.OWED`'S NAMED GAPS — D-398 and D-399, both real jar data,
// not a guess for the part that can be jar data. D-398: `Ai.pathTypeAt` now refuses a fire/
// cactus/sweet-berry-bush/lit-campfire cell exactly the way it already refused lava, using the
// SAME `minecraft:fire` tag `14l_use.js`'s own `Use.init` already trusts (`NS.Tags.blockTag`) —
// the TAG MEMBERSHIP is real; which NodeType each tag/name maps to is transcribed from public
// `WalkNodeEvaluator` decompiles, same caveat D-394/D-396 already carry, and is named again
// below rather than folded into a claim of parity. `Ai.doorAt` tells a closed WOODEN door from
// a closed IRON door from a plain wall — also real tag data (`doors`/`wooden_doors`). D-399:
// `Ai.BreakDoorGoal` (zombie only, priority 1/MOVE, ahead of `MeleeAttackGoal`'s priority 2) uses
// it to break a closed wooden door within reach of a chasing zombie after a 240-tick gauge,
// gated on the gamerule this session made LIVE for the first time — `Commands.RULES_LIVE` gains
// `mobGriefing`. Vanilla's own gate also requires HARD difficulty; D-400 (PASS 16, session 38)
// gives this engine its first real difficulty STATE (`NS.Diff`, 07l_spawn.js) and wires
// `BreakDoorGoal`'s own HARD half to it (`ctx.isHard()`) — no longer silently open, though no
// `/difficulty` command exists yet to set it away from the `'normal'` default (D-327, `Diff.OWED`),
// so the gate is real but not reachable from play today. Neither the per-block STICKY_HONEY/rail/leaves classification nor per-mob
// `pathfindingMalus` moved this session — `Ai.OWED` says exactly how much of the table is left.

(function (NS) {
  'use strict';

  var Ai = NS.Ai = { ready: false };
  /** The owning mob's own JRandom (EL.randomOf): vanilla goals read Entity.random. */
  // #6726: a check may load this file without 07i_entitylist.js, or with a stub EntityList (loadEngine extra: ['07k_goals.js']); goal
  // constructors bind `rand || Ai.rndOf(e)` eagerly, so fall back to the mob's own Random, then Math.random.
  Ai.rndOf = function (e) {
    var EL = NS.EntityList;
    if (EL && EL.randomOf) return EL.randomOf(e);
    var r = e && e.random;
    return (r && r.nextDouble) ? function () { return r.nextDouble(); } : Math.random;
  };

  Ai.OWED = [
    // ── D-422, the head ──────────────────────────────────────────────────────────────────
    'D-422/#218: `yBodyRot` is now separate from the aim yaw and `BodyRotationControl` (moving ' +
      'branch included) moves it; `LivingEntity.turnHead`\'s 0.3/2500 smoothing is ported as ' +
      '`Ai.livingTurnHead` but unwired, since `MobEntity.turnHead` never runs it. Mounted ' +
      'mobs copy the rider yaw into body and head (Ai.bodyControl). #6345: the other writers need nothing - in the jar ' +
      'Entity.refreshPositionAndAngles only calls setYaw, the baby spawn passes yaw 0, and enderman teleport leaves yaw alone, so none touch bodyYaw',
    '`Ai.LookControl`\'s clamp-while-pathing asks `e.navigating`, set by `Ai.stepToward` and `Fl.MoveControl.setWantedPosition` (#6419) and cleared each tick by `EL.tickMob`; vex/ghast-style bare MoveControls have no navigator in vanilla either',
    'the look control is not given a `LookAtPlayerGoal` for every mob in `Ai.ROSTER` — the ' +
      'roster\'s own coverage is G18c\'s, unchanged by D-422; a mob with no look goal simply ' +
      'never asks to look at anything, and its head eases back to its body as vanilla\'s does',
    // D-402 (session 40, PASS 16 JOB 1's own last item): `onShoot` is now WIRED to a real,
    // live `arrow` entity (`Combat.mobShoot`/`Combat.tickArrow`, `07i_entitylist.js`'s own
    // `EL.aiCtx.onShoot`) — closing the one item `16-continued.md` left open. What remains
    // is named explicitly rather than folded back into a bare "arrow doesn't work" line:
    // D-597 STRUCK: skeleton/stray now run the real BowAttackGoal (radius 15, interval 20 HARD /
    // 40 otherwise, line of sight, strafing) and Cb.mobShoot is AbstractSkeletonEntity.attack
    // off .decomp (eye-0.1 spawn, getBodyY(1/3), 0.2F arc, 14-difficulty*4 gaussian spread,
    // applyEnchantmentEffects' damage roll + Power/Punch/Flame, onEntityHit's velocity-scaled
    // damage). Residue:
    // D-602 STRUCK the trailing clause below (raidergoals): a skeleton/stray with no bow now
    // swaps to Ai.SkeletonMeleeFallbackGoal (updateAttackType/reassessWeaponGoal, real).
    // #5311 STRUCK the strafe-refusal clause: Ai.strafeWalkable is MoveControl's getDefaultNodeType == WALKABLE.
    'BowAttackGoal: the sideways input now persists and decays *0.98 per tick like vanilla (#216); the holding-a-bow gate reads the mainhand/offhand item name only',
    'skeleton\'s own checkMonsterSpawnRules is assumed unoverridden (same shape as zombie), ' +
      'not bytecode-verified this session (D-396, Spawn.OWED has the same line)',
    // struck s116: Combat.tickArrow's own tunneling gap -- CLOSED. `Cb.rayBox`'d segment test
    // over `[e.px,e.py,e.pz] -> [e.x,e.y,e.z]` (0.3-inflated candidate boxes, the SAME
    // `ProjectileUtil.getEntityCollision` default overload) replaces the old current-position-
    // only check; the block half needs no separate raycast since `Ph.move`'s own per-axis clip
    // is already a swept AABB-vs-block test, not a point sample (14j_combat.js's own header).
    // struck s116: a stuck arrow's despawn/draw gap -- CLOSED. `Cb.embedArrow`/
    // `Cb.tickStuckArrow` model `PersistentProjectileEntity`'s real `inGround`/`shouldFall`/
    // `age()` (1200-tick despawn, falls again once the block it sat in is gone); the "never
    // drawn" half of this line was already stale before today -- D-449 (session 60) draws every
    // live arrow regardless of `e.stuck` -- only its FROZEN heading (`e.stuckYaw`/`e.stuckPitch`,
    // read by `07j_entityrender.js`'s own `ER.arrowYaw`/`ER.arrowPitch`) was still missing.
    // struck s116: arrow pickup -- CLOSED. `Cb.tryArrowPickup` (14j_combat.js) is
    // `PersistentProjectileEntity.onPlayerCollision`/`tryPickup`, transcribed: ALLOWED for a
    // player-fired survival shot (a real item stack, `e.pickupItem`/`e.pickupTag` set by
    // `Use.bowRelease`, back into the inventory), CREATIVE_ONLY for a creative/Infinity shot,
    // DISALLOWED (the default) for every mob-fired arrow, `Cb.mobShoot` never touching the field.
    'critical hits (a fully-drawn player shot) and their bonus damage/particles are the ' +
      'player\'s own bow-charge mechanic, unbuilt, and share no code with Combat.mobShoot ' +
      '(D-402, same gap Cb.OWED already names for the player\'s own attack)',
    // #212 STRUCK the D-398/D-399 mapping row: mobaicheck compares it to the LandPathNodeMaker bytecode golden.
    // struck s117 (loop/pathtypes): the full node-type table -- honey STICKY_HONEY, powder
    // snow, rails/UNPASSABLE_RAIL, leaves, fences/walls/gates FENCE, trapdoors, cocoa, the
    // DANGER_* neighbour scan and WATER_BORDER -- is `Ai.commonNodeType`/`Ai.pathTypeAt`/
    // `Ai.mobNodeType` off LandPathNodeMaker.java:250-582 (cobweb is vanilla OPEN: it has no
    // node type of its own). struck s117: per-mob pathfinding penalties are `Ai.pathPenalty`
    // (every constructor setPathfindingPenalty row), and the A* adds them as node cost.
    // struck s119: `!canPathfindThrough(LAND)` is `Ai.canPathfindThroughLand` off the jar's own
    // override table (tools/golden/pathfind-land-1.18.2.tsv), and `Ai.groundLevel` refuses a
    // DAMAGE_* cell by the mob's own penalty (every live caller passes its mob).
    '\'BreakDoorGoal\'\'s own difficulty gate is real now (D-400, ctx.isHard()/NS.Diff) but ' +
      'unreachable from play — no /difficulty command exists yet (D-327, Diff.OWED), so a real ' +
      'world can never actually reach HARD and the gate, while correct, never opens today',
    // #212 STRUCK: Mob reach formula, the 20-tick interval, BreakDoorGoal's 240 threshold and the
    // fire/cactus/berry/door node-type mapping are jar-verified (tools/extract-mobai.mjs ->
    // tools/golden/mobai-1.18.2.tsv, mobaicheck). Residue:
    // #5069 STRUCK: BreakDoorGoal now walks the live path record (e.navPath/e.navIdx), DoorInteractGoal.canStart.
    // D-462 closed the ATTACK_KNOCKBACK row: Cb.mobAttack reads it from entity-attributes.
    // #5303 STRUCK: Cb.mobAttack applies Fire Aspect (level*4 s), Sharpness/Smite/Bane and Knockback off the held stack (combatcheck 3e).
    // #213 STRUCK the D-383 row: every rostered mob's Swim/Panic/Breed/Tempt/FollowParent/Avoid/Stroll/LookAt/
    // LookAround/Revenge priorities, speeds, tempt-item sets and flee radii are compared to
    // tools/golden/goals-1.18.2.tsv (extract-goals.mjs off .decomp) by goalrostercheck. What that leaves:
    'goalrostercheck compares the ten library goal families only; the mob-specific goals a registerGoals() also ' +
      'lists (#5120 STRUCK fox/bee/wolf/cat: mobgoalscheck numbers every mob-specific row to the jar; skeleton AvoidSunlight/EscapeSunlight (built, #1130), zombie MoveThroughVillage (built, #1237), ocelot Pounce/Attack) ' +
      'are not all built or numbered to the jar (#213); ' +
      'silverfish\'s WanderAndInfestGoal and turtle\'s Mate/EscapeDanger/WanderOnLand are KNOWN in ' +
      'tools/goalroster-known.json; zombie DestroyEgg, iron golem WanderAroundPointOfInterest, the raider/vex/trader LookAtEntityGoal(Mob) rows, zombie_horse and the fish mobs (e.fishGoals) are pinned by rosterr2check (#5121); ' +
      'CatEntity.TemptGoal\'s canBeScared player memory (ocelot canBeScared, cooldown, stand-off built #1995) is not modelled by Ai.TemptGoal ' +
      '(WanderAroundFarGoal probability cat/ocelot 1.0E-5F, enderman 0.0F: wired and numbered by mobgoalscheck, #5301)',
    // D-401 (session 39, PASS 16 JOB 1): spider rostered, closing the pass\'s own remaining
    // shortlist. Named rather than folded into a claim of full parity:
    // loop/wolfgoals closed this gap: SpiderTargetGoal's own IronGolem half is now wired
    // (spider()'s own targetSelector priority 3, Ai.SpiderTargetGoal reused against ctx.golems).
    'Ai.lightLevelDependentMagicValue\'s brightness ramp uses ambientLight=0.0 for the overworld ' +
      '(vanilla\'s own documented dimension-type value) rather than a literal re-walked to its ' +
      'own bootstrap call this session — this engine has one dimension, so the value is not in ' +
      'practice a live question, but the claim is named rather than assumed exact',
    'neither goal has been seen on a real screen — no browser has run since session 29 ' +
      '(D-396\'s own account, unchanged): goalcheck.mjs/aicheck.mjs prove the algorithm, not ' +
      'that a spider visibly climbs a wall or lands a leap',
    // #216 CLOSED the D-449 residue: RangedBowAttackGoal now runs vanilla's usingItem/itemUseTime
    // draw (seeing-gated stop, no undrawn first shot); BowAttackGoal already did (D-597).
    // #5314 CLOSED the bow-in-hand row: ER.bowSpritesFor chains through the posed arm bone (ER.heldItemsFor) and
    // BOW_AND_ARROW's arm angles are BipedEntityModel.positionRightArm/LeftArm from .decomp (ER.skeletonBowArmDelta).
    // loop/wolfpounce (this pass) CLOSED BOTH GAPS the previous pass named on bje.u().
    // (a) `bdz` (PounceAtTargetGoal, .decomp/net/minecraft/entity/ai/goal/PounceAtTargetGoal.java,
    // read in full) IS the exact class Ai.PounceAtTargetGoal already implements for spider -- no
    // separate `LeapAtTargetGoal.java` exists anywhere in `.decomp`, because Yarn's own name for
    // `bdz` is `PounceAtTargetGoal` and Mojang's is `LeapAtTargetGoal`: same bytecode, same
    // 4-16 (squared) range roll, same nextInt(5) gate, same 0.4-scaled-toward-target start()
    // math, same `velocity` ctor arg (spider passes 0.4F, wolf's own `new PounceAtTargetGoal
    // (this, 0.4F)` passes the identical literal) -- the previous pass's "a different shape"
    // claim was wrong, corrected here. Wolf's MOVE roster now rosters `Ai.PounceAtTargetGoal` at
    // the jar's own priority 4, MOVE|JUMP (`bdz`'s own `setControls` javap's to field_18405
    // MOVE | field_18407 JUMP).
    // (b) `UniversalAngerGoal` (.decomp, read in full) now takes a real `triggerOthers` flag: when
    // true, `start()` also calls `Ai.universallyAnger` on every OTHER live mob of the SAME type
    // within (followRange, 10, followRange) of this one (`getOthersInRange`'s own box, no tame/
    // owner filter -- unlike `HurtByTargetGoal`'s own separate pack alert, D-477), exactly as the
    // jar's own `Angerable::universallyAnger` method reference does. Wolf's targetSelector
    // priority 8 now passes `true` plus a wolf-typed pack (`bje.u()`'s own literal); iron_golem
    // (`bin.u()`) still passes `false`, unchanged.
    // #214 (G18b-3): the villager row is CLOSED as a false premise, not ported. 1.18.2's
    // `VillagerEntity`/`MerchantEntity`/`PassiveEntity` never call `goalSelector.add` (no
    // registerGoals at all; trading stop / flee zombie / panic / schedule / golem call are Brain
    // Tasks, 07zv_villagerbrain.js's `NS.VB`; the goal-based versions are the 1.13 villager and
    // 1.18's WanderingTrader, `NS.WT`). Proven by tools/villagergoalcheck.mjs.
    // ── RAID MOBS (loop/illagers-s92, QUEUE 0.2 raid loop) — the six new ROSTER entries' own
    // NAMED gaps, out of each mob's own comment above; collected here so Ai.OWED stays the one
    // place that lists every one, not just the roster entry's own header.
    // D-602 (raidergoals) CLOSED (this pass): vindicator\'s own BreakDoorGoal (real NORMAL/HARD
    // gate + hasActiveRaid()), its johnny-gated TargetGoal (vacuous — no NBT sets e.johnny),
    // vindicator/pillager/ravager\'s ActiveTargetGoal(Merchant)/ActiveTargetGoal(IronGolem)
    // (ravager\'s own !isBaby() filter included), all three mobs\' group RevengeGoal
    // (RaiderEntity, cross-species via raidersOf — was the HurtByTargetGoal stand-in), and
    // CrossbowAttackGoal\'s own isEntityHoldingCrossbow()/seeingTargetTicker (struck below).
    // D-602 (loop/raiderroar) CLOSED (this pass): vindicator\'s own LongDoorInteractGoal
    // (`Ai.VindicatorLongDoorInteractGoal`) and PatrolApproachGoal (`Ai.PatrolApproachGoal`,
    // shared with pillager); ravager\'s own AttackGoal reach override (`Ai.ravagerReachSqr`)
    // and its roarTick/stunTick/attackTick state machine (`Ai.RavagerRoarGoal`, attackTick set
    // through `Ai.MeleeAttackGoal`\'s own new `onAttack` hook). Struck below.
    // D-217 (G18b-6) CLOSED: PatrolApproachGoal's isRaidCenterSet() is the real `patrolling` flag
    // (PatrolEntity.java:126-128), pillager's own WanderAroundGoal is `Ai.WanderAroundGoal`, and
    // vindicator/pillager/ravager's ActiveTargetGoals refuse an unseen candidate (TargetPredicate.
    // respectsVisibility) and drop one unseen for >60 ticks when mustSee (TrackTargetGoal).
    // #5305 CLOSED: evoker/illusioner ActiveTargetGoals carry maxNoSight 300 (roster + raidgoalresiduecheck).
    'ravager\'s own roarTick/stunTick/attackTick state machine (Ai.RavagerRoarGoal) is real and ' +
      'ticks, but its ONE trigger for stunTick (Ai.ravagerAttackBlockedByShield, the shield-' +
      'block-stun mechanic) is never called from live play — this engine has no shield-blocking ' +
      'mechanic at all yet (grepped 14j_combat.js/14l_use.js, not assumed), so roarTick/stunTick ' +
      'never leave zero outside a direct test call',
    // ── CLOSED THIS PASS (loop/raidvex-s96) -- witch's real RaidGoal/DisableableFollowTargetGoal
    // target selector (`Ai.RaidGoal`/`Ai.DisableableFollowTargetGoal`, this file's own witch
    // roster entry) now really hands the witch a nearby raider ally to heal, gated on an
    // ONGOING raid the same way `WitchEntity.tickMovement()` gates it — `Po.witchChoosePotion`'s
    // own raider-ally branch is reachable from live play for the first time. ──
    // loop/spells-s93 (QUEUE 0.2 raid loop) closed the state-machine half of this line: a real
    // `SpellcastingIllagerEntity.spellTicks`/`getSpell` machine now exists (`NS.Spell`,
    // 07v_spell.js) and evoker casts `ConjureFangsGoal`, illusioner casts `BlindTargetGoal`/
    // `GiveInvisibilityGoal`. `SummonVexGoal` and `WololoGoal` remain unwired — `Spell.OWED` has
    // the exact reason for each (vex still cannot spawn or move; no sheep carries a colour
    // field) — and every simplification the four WIRED spells make (the cooldown tick-rate
    // divergence, the fang ground search's missing partial-block offset, the collapsed
    // teammate/difficulty checks) is named on `Spell.OWED`, not repeated here.

    // D-707 leftover unit (this pass) -- cat/ocelot flee. `Ai.AvoidEntityGoal` takes ONE speed;
    // vanilla's own `CatEntity.CatFleeGoal`/`OcelotEntity.FleeGoal` (`.decomp` CatEntity.java:471,
    // OcelotEntity.java:224) pass BOTH a walk speed (0.8) and a sprint speed (1.33), and
    // `CatEntity.mobTick`/`OcelotEntity.mobTick` read the active move-control speed back to pick
    // a crouching pose (0.6, from `TemptGoal`) vs a sprinting pose (1.33, from the flee goal) vs
    // standing (anything else). This engine has neither the two-speed switch nor the crouch/
    // sprint poses at all -- only the flee RADIUS (16.0F, fixed this pass from a wrong 6) is real.
    // (#215 CLOSED THIS: the two-speed switch is `fleeOpts.fastSpeed`, `Ai.felinePose` is mobTick.)
    // Giving cat/ocelot a true sprint-when-close speed and the matching pose needs a real
    // two-speed AvoidEntityGoal AND a new render pose, neither of which exists anywhere in this
    // engine yet -- named here rather than guessed at, since `.decomp` does not ship
    // AvoidEntityGoal.java's own switch threshold to cite.
  ];

  /**
   * `CatEntity.mobTick` / `OcelotEntity.mobTick` (.decomp CatEntity.java:204-221), transcribed:
   * a MOVE_TO order this tick at exactly 0.6 (the TemptGoal) -> crouching; exactly 1.33 (the flee
   * goal's sprint speed) -> standing + sprinting; anything else, or no order -> standing. Sets
   * `e.crouching` / `e.sprinting`; `ER.felineDelta` reads them. `e.moveMod` is `Ai.stepToward`'s
   * order and is zeroed at the top of every `EL.tickMob`, so "no order" is `0`.
   */
  Ai.felinePose = function (e) {
    var m = e.moveMod || 0;
    e.crouching = m === 0.6;
    e.sprinting = m === 1.33;
  };

  Ai.init = function () {
    Ai.ready = !!(NS.Physics && NS.States && NS.Reg && NS.Entities);
    return Ai;
  };

  // ── the four flags GoalSelector arbitrates over (vanilla's own Goal.Flag) ───────────────────
  Ai.MOVE = 1; Ai.LOOK = 2; Ai.JUMP = 4; Ai.TARGET = 8;

  // ════════════════════════════ 1. GoalSelector ═══════════════════════════════════════════════

  /**
   * `new Ai.GoalSelector()` then `.add(priority, flags, goalObj)`, `.tick()`.
   * goalObj: { canUse(), canContinueToUse(), start(), stop(), tick() }.
   *
   * ⚠ THE ALGORITHM, IN ORDER, EVERY TICK:
   *   1. Any RUNNING goal whose `canContinueToUse()` now returns false is stopped.
   *   2. In priority order (lower number first), a goal not running is STARTED when its own
   *      `canUse()` is true AND no still-running goal of EQUAL OR HIGHER priority (equal-or-
   *      lower number) holds a flag it needs. Starting it STOPS any running LOWER-priority
   *      (higher-number) goal that holds one of those flags — vanilla's own rule, and the one
   *      `goalcheck.mjs`'s flag-conflict test exists to prove is load-bearing, not decorative.
   *   3. Every still-running goal ticks.
   */
  function GoalSelector() { this.entries = []; this.__testNoConflict = false; this.disabled = 0; this.beforeTick = null; }
  GoalSelector.prototype.add = function (priority, flags, goal) {
    this.entries.push({ priority: priority, flags: flags, goal: goal, running: false });
    return this;
  };
  function sharesFlag(a, b) { return (a.flags & b.flags) !== 0; }
  GoalSelector.prototype.tick = function () {
    if (this.beforeTick) this.beforeTick();   // MobEntity.updateGoalControls (RavagerEntity overrides it) sets `disabled`
    var entries = this.entries.slice().sort(function (a, b) { return a.priority - b.priority; });
    var i, j, e, o;
    for (i = 0; i < entries.length; i++) {
      e = entries[i];
      if (e.running && ((e.flags & this.disabled) !== 0 || !e.goal.canContinueToUse())) { e.goal.stop(); e.running = false; }
    }
    for (i = 0; i < entries.length; i++) {
      e = entries[i];
      if (e.running || (e.flags & this.disabled) !== 0) continue;
      var blocked = false;
      if (!this.__testNoConflict) {
        for (j = 0; j < entries.length; j++) {
          o = entries[j];
          if (o === e || !o.running) continue;
          if (!sharesFlag(o, e)) continue;
          // vanilla canReplaceAll: a lower-priority runner whose goal says canStop()==false is not preempted
          if (o.priority <= e.priority || (o.goal.canStop && o.goal.canStop() === false)) { blocked = true; break; }
        }
      }
      // `GoalSelector.tick` (.decomp :98): `canReplaceAll(goal) && goal.canStart()` -- canStart is
      // only ASKED once nothing higher holds the controls. Asking first let a blocked goal spend its
      // random roll (a stroll's 1-in-120) and cache a target while a flee ran, then start the very
      // tick the flee ended (avoidrefcheck creeper_cat_*: the server's creeper stands still after).
      if (blocked) continue;
      if (!e.goal.canUse()) continue;
      if (!this.__testNoConflict) {
        for (j = 0; j < entries.length; j++) {
          o = entries[j];
          if (o === e || !o.running) continue;
          if (o.priority > e.priority && sharesFlag(o, e)) { o.goal.stop(); o.running = false; }
        }
      }
      e.goal.start(); e.running = true;
    }
    for (i = 0; i < entries.length; i++) { e = entries[i]; if (e.running) e.goal.tick(); }
  };
  /** For a check that wants to name a goal instead of poking at .entries. */
  GoalSelector.prototype.isRunning = function (goal) {
    for (var i = 0; i < this.entries.length; i++) {
      if (this.entries[i].goal === goal) return this.entries[i].running;
    }
    return false;
  };
  Ai.GoalSelector = GoalSelector;

  // ════════════════════════════ 2. node classification (generic — see header) ════════════════

  Ai.NodeType = {
    BLOCKED: 0, OPEN: 1, WALKABLE: 2, WATER: 3, LAVA: 4,
    // D-398 (session 37) — real per-block classification. s117 (loop/pathtypes) completed the
    // table: every `PathNodeType` constant 1.18.2 has (.decomp PathNodeType.java:4-29, Yarn
    // names by declaration order, penalties checked against each one) now exists here too.
    DAMAGE_FIRE: 5, DAMAGE_OTHER: 6,
    WALKABLE_DOOR: 7, TRAPDOOR: 8, POWDER_SNOW: 9, DANGER_POWDER_SNOW: 10, FENCE: 11,
    WATER_BORDER: 12, RAIL: 13, UNPASSABLE_RAIL: 14, DANGER_FIRE: 15, DANGER_CACTUS: 16,
    DAMAGE_CACTUS: 17, DANGER_OTHER: 18, DOOR_OPEN: 19, DOOR_WOOD_CLOSED: 20,
    DOOR_IRON_CLOSED: 21, BREACH: 22, LEAVES: 23, STICKY_HONEY: 24, COCOA: 25
  };

  /** `PathNodeType.getDefaultPenalty()` — the constructor argument of every constant
   *  (.decomp PathNodeType.java:4-29). Negative = impassable. Indexed by `Ai.NodeType`. */
  Ai.DEFAULT_PENALTY = (function () {
    var T = Ai.NodeType, p = [];
    p[T.BLOCKED] = -1; p[T.OPEN] = 0; p[T.WALKABLE] = 0; p[T.WALKABLE_DOOR] = 0; p[T.TRAPDOOR] = 0;
    p[T.POWDER_SNOW] = -1; p[T.DANGER_POWDER_SNOW] = 0; p[T.FENCE] = -1; p[T.LAVA] = -1;
    p[T.WATER] = 8; p[T.WATER_BORDER] = 8; p[T.RAIL] = 0; p[T.UNPASSABLE_RAIL] = -1;
    p[T.DANGER_FIRE] = 8; p[T.DAMAGE_FIRE] = 16; p[T.DANGER_CACTUS] = 8; p[T.DAMAGE_CACTUS] = -1;
    p[T.DANGER_OTHER] = 8; p[T.DAMAGE_OTHER] = -1; p[T.DOOR_OPEN] = 0; p[T.DOOR_WOOD_CLOSED] = -1;
    p[T.DOOR_IRON_CLOSED] = -1; p[T.BREACH] = 4; p[T.LEAVES] = -1; p[T.STICKY_HONEY] = 8; p[T.COCOA] = 0;
    return p;
  })();

  /** Every `setPathfindingPenalty` a mob's CONSTRUCTOR makes in 1.18.2 (grep of .decomp
   *  net/minecraft/entity/**: 52 call sites; the goal/node-maker ones that set and RESTORE a
   *  value around one goal — FollowOwner/FollowMob/Amphibious/Bird — are not constructor
   *  state and are not here). Superclass first, subclass after, exactly as the constructors
   *  chain: `AnimalEntity`/`MerchantEntity`/`AbstractPiglinEntity` each set DANGER_FIRE 16,
   *  DAMAGE_FIRE -1 (AnimalEntity.java, MerchantEntity.java, AbstractPiglinEntity.java);
   *  `WaterCreatureEntity` WATER 0. */
  Ai.MALUS_BASE = {
    animal: [['DANGER_FIRE', 16], ['DAMAGE_FIRE', -1]],
    merchant: [['DANGER_FIRE', 16], ['DAMAGE_FIRE', -1]],
    piglin: [['DANGER_FIRE', 16], ['DAMAGE_FIRE', -1]],
    water: [['WATER', 0]]
  };
  Ai.MALUS_FAMILY = {
    cow: 'animal', mooshroom: 'animal', pig: 'animal', sheep: 'animal', chicken: 'animal',
    horse: 'animal', donkey: 'animal', mule: 'animal', skeleton_horse: 'animal',
    zombie_horse: 'animal', llama: 'animal', trader_llama: 'animal', wolf: 'animal',
    cat: 'animal', ocelot: 'animal', fox: 'animal', rabbit: 'animal', panda: 'animal',
    polar_bear: 'animal', bee: 'animal', goat: 'animal', turtle: 'animal', axolotl: 'animal',
    parrot: 'animal', strider: 'animal', hoglin: 'animal',
    villager: 'merchant', wandering_trader: 'merchant',
    piglin: 'piglin', piglin_brute: 'piglin',
    squid: 'water', glow_squid: 'water', dolphin: 'water', cod: 'water', salmon: 'water',
    pufferfish: 'water', tropical_fish: 'water'
  };
  Ai.MALUS_OWN = {
    chicken: [['WATER', 0]],                                             // ChickenEntity.java
    fox: [['DANGER_OTHER', 0], ['DAMAGE_OTHER', 0]],                     // FoxEntity.java
    goat: [['POWDER_SNOW', -1], ['DANGER_POWDER_SNOW', -1]],             // GoatEntity.java
    wolf: [['POWDER_SNOW', -1], ['DANGER_POWDER_SNOW', -1]],             // WolfEntity.java
    bee: [['DANGER_FIRE', -1], ['WATER', -1], ['WATER_BORDER', 16], ['COCOA', -1], ['FENCE', -1]],
    parrot: [['DANGER_FIRE', -1], ['DAMAGE_FIRE', -1], ['COCOA', -1]],   // ParrotEntity.java
    strider: [['WATER', -1], ['LAVA', 0], ['DANGER_FIRE', 0], ['DAMAGE_FIRE', 0]],
    turtle: [['WATER', 0], ['DOOR_IRON_CLOSED', -1], ['DOOR_WOOD_CLOSED', -1], ['DOOR_OPEN', -1]],
    axolotl: [['WATER', 0]],
    dolphin: [['WATER', 0]],                                             // #716: SwimNavigation, water is its own medium
    blaze: [['WATER', -1], ['LAVA', 8], ['DANGER_FIRE', 0], ['DAMAGE_FIRE', 0]],
    drowned: [['WATER', 0]], enderman: [['WATER', -1]], guardian: [['WATER', 0]],
    elder_guardian: [['WATER', 0]],                                      // extends GuardianEntity
    wither_skeleton: [['LAVA', 8]], zombified_piglin: [['LAVA', 8]]
  };
  /** `MobEntity.getPathfindingPenalty(type)`: the mob's own map entry, else the default.
   *  `e.pathMalus` (type -> number) is the per-entity map a goal may write, as vanilla's
   *  FollowOwnerGoal does for WATER; the constructor table above is consulted beneath it. */
  Ai.pathPenalty = function (e, t) {
    if (e && e.pathMalus && e.pathMalus[t] !== undefined) return e.pathMalus[t];
    var type = e && e.type, T = Ai.NodeType, v;
    if (type) {
      var own = Ai.MALUS_OWN[type], fam = Ai.MALUS_BASE[Ai.MALUS_FAMILY[type]], i;
      if (own) for (i = own.length - 1; i >= 0; i--) if (T[own[i][0]] === t) return own[i][1];
      if (fam) for (i = fam.length - 1; i >= 0; i--) if (T[fam[i][0]] === t) return fam[i][1];
    }
    v = Ai.DEFAULT_PENALTY[t];
    return v === undefined ? 0 : v;
  };

  function isSolid(x, y, z) { return NS.Physics.solidAt(x, y, z); }
  function blockIdAt(x, y, z) {
    var s = NS.Physics.blockAt(x, y, z);
    return NS.States.block[s];
  }
  function stateAt(x, y, z) { return NS.Physics.blockAt(x, y, z); }

  // ── D-398's own hazard/door table, resolved ONCE from real jar tags — the SAME source
  // `14l_use.js`'s own `Use.init` already trusts (`NS.Tags.blockTag`), not a name-suffix guess
  // (Use.js's own header explains why a suffix fails for exactly this kind of family). Degrades
  // silently to the OLD classification when `02f_tags.js`'s optional tag payload is absent —
  // `Ai.hazardsReady()` is published rather than hidden, the same shape `Use.tagsReady` uses.
  var haz = null;
  function initHazards() {
    if (haz) return haz;
    haz = { ready: false, doorsReady: false };
    if (!NS.Reg || !NS.Reg.ready || !NS.Reg.names) return haz;
    var names = NS.Reg.names;
    function idOf(n) { var i = names.indexOf(n); return i < 0 ? -1 : i; }
    haz.cactus = idOf('cactus');
    haz.sweetBerryBush = idOf('sweet_berry_bush');
    haz.campfire = idOf('campfire');
    haz.soulCampfire = idOf('soul_campfire');
    haz.ironDoor = idOf('iron_door');
    // s117 loop/pathtypes -- the rest of getCommonNodeType's identity table (LandPathNodeMaker
    // .java:527-574; Blocks.java register names for field_27879/21211/10302/10588/28682/10092).
    haz.powderSnow = idOf('powder_snow');
    haz.honey = idOf('honey_block');
    haz.cocoa = idOf('cocoa');
    haz.lilyPad = idOf('lily_pad');
    haz.bigDripleaf = idOf('big_dripleaf');
    haz.magma = idOf('magma_block');
    haz.lavaCauldron = idOf('lava_cauldron');
    haz.waterlike = [idOf('kelp'), idOf('kelp_plant'), idOf('seagrass'), idOf('tall_seagrass'),
                     idOf('bubble_column')];
    if (NS.Tags && NS.Tags.ready && NS.Tags.blockTag) {
      haz.fireCol = NS.Tags.blockTag('fire');
      haz.doorsCol = NS.Tags.blockTag('doors');
      haz.woodenDoorsCol = NS.Tags.blockTag('wooden_doors');
      // D-602 raiderroar -- `LeavesBlock` identification for `RavagerEntity.tickMovement`'s
      // own leaf-breaking branch (`Ai.RavagerRoarGoal`, below); the 'leaves' block tag is the
      // same one `07t_fly.js`'s own `T.blockTag('leaves')` already reads for bee pathing.
      haz.leavesCol = NS.Tags.blockTag('leaves');
      haz.trapdoorsCol = NS.Tags.blockTag('trapdoors');   // BlockTags.field_15487
      haz.fencesCol = NS.Tags.blockTag('fences');         // BlockTags.field_16584
      haz.wallsCol = NS.Tags.blockTag('walls');           // BlockTags.field_15504
      haz.gatesCol = NS.Tags.blockTag('fence_gates');     // `instanceof FenceGateBlock`
      haz.railsCol = NS.Tags.blockTag('rails');           // `instanceof AbstractRailBlock`
      haz.ready = haz.fireCol >= 0;
      haz.doorsReady = haz.doorsCol >= 0 && haz.woodenDoorsCol >= 0;
      haz.leavesReady = haz.leavesCol >= 0;
    }
    return haz;
  }
  Ai.hazardsReady = function () { return initHazards().ready; };

  /**
   * The generic node type of a cell — see the file header for what this deliberately omits.
   * ⚠ D-398's hazard check runs BEFORE the solid/open branch, on purpose and not by oversight:
   * this engine's own `Physics.solidAt` already treats cactus as solid (its inset collision
   * box still counts), so a generic BLOCKED-before-hazard order would leave the interior-cell
   * refusal below dead code for cactus specifically — vanilla's own `WalkNodeEvaluator` does
   * not consult collision solidity for these blocks either, it special-cases them by identity
   * first. Fire is genuinely non-solid in both engines, so the ordering does not change its
   * result — only cactus's/the berry bush's does.
   */
  function inCol(col, st) { return col !== undefined && col >= 0 && NS.Tags.stateInCol(col, st); }
  // A fixture that loads 07b_behaviour.js without `Behave.init` has a propName whose property
  // table is null; such a world has no properties to read, which is what `undefined` says.
  function prop(st, n) {
    if (!NS.Behave || !NS.Behave.propName) return undefined;
    try { return NS.Behave.propName(st, n); } catch (err) { return undefined; }
  }
  /** `LandPathNodeMaker.inflictsFireDamage` (.decomp :576-582): fire tag, lava, magma, a lit
   *  campfire, a lava cauldron. */
  function firey(h, id, st) {
    if (inCol(h.fireCol, st)) return true;
    if (id === h.magma || id === h.lavaCauldron || id === NS.Reg.id.lava) return true;
    return (id === h.campfire || id === h.soulCampfire) && prop(st, 'lit') === 'true';
  }
  function waterFluid(h, id, st) {
    if (id === NS.Reg.id.water) return true;
    if (h.waterlike && h.waterlike.indexOf(id) >= 0) return true;
    return prop(st, 'waterlogged') === 'true';
  }
  Ai.inflictsFireDamage = function (x, y, z) {
    var h = initHazards(); if (!h.ready) return false;
    var st = stateAt(x, y, z); return firey(h, NS.States.block[st], st);
  };

  /**
   * `LandPathNodeMaker.getCommonNodeType` (.decomp :527-574), in vanilla's own branch order.
   * ⚠ The one stand-in: vanilla's last test is `!state.canPathfindThrough(LAND)` (a per-block
   * override family); this engine asks its own collision (`Physics.solidAt`) there, the same
   * question D-398 already used — named on `Ai.OWED`.
   */
  Ai.commonNodeType = function (x, y, z) {
    var T = Ai.NodeType, h = initHazards();
    var st = stateAt(x, y, z);
    if (st <= 0) return T.OPEN;
    var id = NS.States.block[st];
    if (h.ready) {
      if (inCol(h.trapdoorsCol, st) || id === h.lilyPad || id === h.bigDripleaf) return T.TRAPDOOR;
      if (id === h.powderSnow) return T.POWDER_SNOW;
      if (id === h.cactus) return T.DAMAGE_CACTUS;
      if (id === h.sweetBerryBush) return T.DAMAGE_OTHER;
      if (id === h.honey) return T.STICKY_HONEY;
      if (id === h.cocoa) return T.COCOA;
    }
    if (id === NS.Reg.id.lava) return T.LAVA;              // FluidTags.LAVA
    if (h.ready) {
      if (firey(h, id, st)) return T.DAMAGE_FIRE;
      if (h.doorsReady && inCol(h.doorsCol, st)) {
        var open = prop(st, 'open') === 'true';
        if (inCol(h.woodenDoorsCol, st) && !open) return T.DOOR_WOOD_CLOSED;
        if (id === h.ironDoor && !open) return T.DOOR_IRON_CLOSED;   // the one Material.METAL door
        if (open) return T.DOOR_OPEN;
      }
      if (inCol(h.railsCol, st)) return T.RAIL;
      if (inCol(h.leavesCol, st)) return T.LEAVES;
      if (inCol(h.fencesCol, st) || inCol(h.wallsCol, st) ||
          (inCol(h.gatesCol, st) && prop(st, 'open') !== 'true')) return T.FENCE;
    }
    if (!Ai.canPathfindThroughLand(st, x, y, z)) return T.BLOCKED;
    return waterFluid(h, id, st) ? T.WATER : T.OPEN;
  };

  /**
   * s119 — `AbstractBlockState.canPathfindThrough(world, pos, NavigationType.LAND)`, the per-block
   * override family D-637 stood in for with `Physics.solidAt`. `NS.DATA.pathLand` (tools/golden/
   * pathfind-land-1.18.2.tsv, `extract-pathfind.mjs` off .decomp) holds the ~300 non-default rows:
   * `false` (stairs, slabs, fences, walls, panes, beds, chests, ... — 50 owner classes), `open`
   * (doors/trapdoors/gates: their OPEN property), `snow` (LAYERS < 5), `true` (powder snow),
   * `notlava` (FluidBlock). Everything else is the base `!isFullCube(world, pos)` — the COLLISION
   * shape (`Block.isShapeFullCube(getCollisionShape)`), so a carpet, a ladder or a repeater is
   * passable (OPEN) where the old stand-in called every collider BLOCKED. An unloaded cell keeps
   * the old collision answer (`Physics.solidAt` treats it as a wall, D-73).
   */
  var pathLandById = null;
  Ai.canPathfindThroughLand = function (st, x, y, z) {
    if (Ai.__testLandStandIn) return !isSolid(x, y, z);     // pathcheck anti-vacuity hook
    if (!(st > 0)) return x === undefined ? true : !isSolid(x, y, z);
    var R = NS.Reg, S = NS.States, tab = NS.DATA && NS.DATA.pathLand;
    if (tab && R && R.names) {
      if (pathLandById === null || pathLandById.length !== R.names.length) {
        pathLandById = new Array(R.names.length);
        for (var i = 0; i < R.names.length; i++) pathLandById[i] = tab[R.names[i]] || '';
      }
      var rule = pathLandById[S.block[st]];
      if (rule === 'false') return false;
      if (rule === 'true') return true;
      if (rule === 'open') return prop(st, 'open') === 'true';
      if (rule === 'snow') return (parseInt(prop(st, 'layers'), 10) || 1) < 5;
      if (rule === 'notlava') return S.block[st] !== R.id.lava;
    }
    var Ph = NS.Physics;
    if (!Ph || !Ph.shapesForState) return x === undefined ? true : !isSolid(x, y, z);
    if (S.solid && S.solid[st] !== 1) return true;              // no collision shape at all
    return Ph.shapesForState(st) !== Ph.FULL_CUBE;             // !isFullCube
  };

  /** `LandPathNodeMaker.getNodeTypeFromNeighbors` (.decomp :493-525): the 26 neighbours minus
   *  the two straight up/down, first hit wins: cactus DANGER_CACTUS, berry bush DANGER_OTHER,
   *  fire damage DANGER_FIRE, water WATER_BORDER. */
  function fromNeighbors(x, y, z, cur) {
    var T = Ai.NodeType, h = initHazards();
    if (!h.ready) return cur;
    for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) for (var dz = -1; dz <= 1; dz++) {
      if (dx === 0 && dz === 0) continue;
      var st = stateAt(x + dx, y + dy, z + dz), id = NS.States.block[st];
      if (id === h.cactus) return T.DANGER_CACTUS;
      if (id === h.sweetBerryBush) return T.DANGER_OTHER;
      if (firey(h, id, st)) return T.DANGER_FIRE;
      if (waterFluid(h, id, st)) return T.WATER_BORDER;
    }
    return cur;
  }

  /**
   * `LandPathNodeMaker.getLandNodeType` (.decomp :455-491) — the node type of a cell for a
   * walking mob: an OPEN cell takes its type from the one below (WALKABLE over anything that
   * is not OPEN/WALKABLE/WATER/LAVA; DAMAGE_FIRE/DAMAGE_CACTUS/DAMAGE_OTHER/STICKY_HONEY carry
   * up; powder snow below is DANGER_POWDER_SNOW), and a WALKABLE one is then DANGER_* / WATER_
   * BORDER if a hazard is beside it. `Ai.__testNeighborsOff` is pathcheck's anti-vacuity hook
   * ('common' = skip the below-cell rule too).
   */
  Ai.pathTypeAt = function (x, y, z) {
    var T = Ai.NodeType;
    var t = Ai.commonNodeType(x, y, z);
    if (Ai.__testNeighborsOff === 'common') return t;
    var C = NS.CFG || { WORLD_MIN_Y: -64 };
    if (t === T.OPEN && y >= C.WORLD_MIN_Y + 1) {
      var b = Ai.commonNodeType(x, y - 1, z);
      t = (b !== T.WALKABLE && b !== T.OPEN && b !== T.WATER && b !== T.LAVA) ? T.WALKABLE : T.OPEN;
      if (b === T.DAMAGE_FIRE) t = T.DAMAGE_FIRE;
      if (b === T.DAMAGE_CACTUS) t = T.DAMAGE_CACTUS;
      if (b === T.DAMAGE_OTHER) t = T.DAMAGE_OTHER;
      if (b === T.STICKY_HONEY) t = T.STICKY_HONEY;
      if (b === T.POWDER_SNOW) t = T.DANGER_POWDER_SNOW;
    }
    if (t === T.WALKABLE && !Ai.__testNeighborsOff) t = fromNeighbors(x, y, z, t);
    return t;
  };

  /**
   * `LandPathNodeMaker.getNodeType(world,x,y,z,mob,sizeX,sizeY,sizeZ,canOpenDoors,
   * canEnterOpenDoors)` + `findNearbyNodeTypes` + `adjustNodeType` (.decomp :340-425): the type
   * of a NODE for this mob is read over every cell its box covers (entityBlockXSize =
   * floor(width+1), Y = floor(height+1)); FENCE then UNPASSABLE_RAIL win outright, any type
   * the mob refuses (penalty < 0) is returned at once, else the costliest; a fully-zero
   * OPEN origin for a one-high box stays OPEN.
   */
  Ai.mobNodeType = function (e, x, y, z) {
    var T = Ai.NodeType;
    var w = (e && e.width) || 0.6, ht = (e && e.height) || 1.8;
    var sx = Math.floor(w + 1), sy = Math.floor(ht + 1), sz = sx;
    var seen = [], origin = T.BLOCKED;
    var h = initHazards();
    var onRail = false;
    if (e && h.ready) {
      var ex = Math.floor(e.x), ey = Math.floor(e.y), ez = Math.floor(e.z);
      onRail = inCol(h.railsCol, stateAt(ex, ey, ez)) || inCol(h.railsCol, stateAt(ex, ey - 1, ez));
    }
    var canOpen = !!(e && e.canOpenDoors), canEnter = !(e && e.canEnterOpenDoors === false);
    for (var i = 0; i < sx; i++) for (var j = 0; j < sy; j++) for (var k = 0; k < sz; k++) {
      var t = Ai.pathTypeAt(x + i, y + j, z + k);
      if (t === T.DOOR_WOOD_CLOSED && canOpen && canEnter) t = T.WALKABLE_DOOR;
      if (t === T.DOOR_OPEN && !canEnter) t = T.BLOCKED;
      if (t === T.RAIL && !onRail) t = T.UNPASSABLE_RAIL;
      if (t === T.LEAVES) t = (e && e.type === 'ravager') ? T.OPEN : T.BLOCKED; // RavagerEntity.PathNodeMaker
      if (i === 0 && j === 0 && k === 0) origin = t;
      if (seen.indexOf(t) < 0) seen.push(t);
    }
    if (seen.indexOf(T.FENCE) >= 0) return T.FENCE;
    if (seen.indexOf(T.UNPASSABLE_RAIL) >= 0) return T.UNPASSABLE_RAIL;
    var best = T.BLOCKED;
    // vanilla iterates an EnumSet — declaration order; `Ai.ENUM_ORDER` is that order.
    for (var n = 0; n < Ai.ENUM_ORDER.length; n++) {
      var tt = Ai.ENUM_ORDER[n];
      if (seen.indexOf(tt) < 0) continue;
      var pen = Ai.pathPenalty(e, tt);
      if (pen < 0) return tt;
      if (pen >= Ai.pathPenalty(e, best)) best = tt;
    }
    return (origin === T.OPEN && Ai.pathPenalty(e, best) === 0 && sx <= 1) ? T.OPEN : best;
  };
  /** `BirdPathNodeMaker.getDefaultNodeType` (.decomp :178-206): an OPEN cell takes its type from the one below
   *  (fire/lava -> DAMAGE_FIRE, cactus, other, cocoa, fence carry up; else WALKABLE unless below is OPEN/WALKABLE/WATER),
   *  then BOTH OPEN and WALKABLE read their neighbours (the land maker does so for WALKABLE only). */
  Ai.birdDefaultNodeType = function (x, y, z) {
    var T = Ai.NodeType, t = Ai.commonNodeType(x, y, z);
    var C = NS.CFG || { WORLD_MIN_Y: -64 };
    if (t === T.OPEN && y >= C.WORLD_MIN_Y + 1) {
      var b = Ai.commonNodeType(x, y - 1, z);
      if (b === T.DAMAGE_FIRE || b === T.LAVA) t = T.DAMAGE_FIRE;
      else if (b === T.DAMAGE_CACTUS) t = T.DAMAGE_CACTUS;
      else if (b === T.DAMAGE_OTHER) t = T.DAMAGE_OTHER;
      else if (b === T.COCOA) t = T.COCOA;
      else if (b === T.FENCE) t = T.FENCE;
      else t = (b !== T.WALKABLE && b !== T.OPEN && b !== T.WATER) ? T.WALKABLE : T.OPEN;
    }
    if (t === T.WALKABLE || t === T.OPEN) t = fromNeighbors(x, y, z, t);
    return t;
  };
  /** `BirdPathNodeMaker.getNodeType(..., sizeX/Y/Z, canOpenDoors, canEnterOpenDoors)` (:155-176): FENCE wins, then the
   *  first refused type (penalty < 0), else the costliest; an OPEN origin with penalty 0 stays OPEN (no size gate). */
  Ai.birdNodeType = function (e, x, y, z) {
    var T = Ai.NodeType, w = (e && e.width) || 0.5, ht = (e && e.height) || 0.9;
    var sx = Math.floor(w + 1), sy = Math.floor(ht + 1), sz = sx, seen = [], origin = T.BLOCKED;
    var canOpen = !!(e && e.canOpenDoors), canEnter = !(e && e.canEnterOpenDoors === false);
    for (var i = 0; i < sx; i++) for (var j = 0; j < sy; j++) for (var k = 0; k < sz; k++) {
      var t = Ai.birdDefaultNodeType(x + i, y + j, z + k);
      if (t === T.DOOR_WOOD_CLOSED && canOpen && canEnter) t = T.WALKABLE_DOOR;
      if (t === T.DOOR_OPEN && !canEnter) t = T.BLOCKED;
      if (i === 0 && j === 0 && k === 0) origin = t;
      if (seen.indexOf(t) < 0) seen.push(t);
    }
    if (seen.indexOf(T.FENCE) >= 0) return T.FENCE;
    var best = T.BLOCKED;
    for (var n = 0; n < Ai.ENUM_ORDER.length; n++) {
      var tt = Ai.ENUM_ORDER[n];
      if (seen.indexOf(tt) < 0) continue;
      var pen = Ai.pathPenalty(e, tt);
      if (pen < 0) return tt;
      if (pen >= Ai.pathPenalty(e, best)) best = tt;
    }
    return (origin === T.OPEN && Ai.pathPenalty(e, best) === 0) ? T.OPEN : best;
  };
  /** `BirdPathNodeMaker.getNode`: null when the type is refused, else the node penalty
   *  (max(0, type penalty), +1 for WALKABLE). */
  Ai.birdNodePenalty = function (e, x, y, z) {
    var T = Ai.NodeType, t = Ai.birdNodeType(e, x, y, z), p = Ai.pathPenalty(e, t);
    if (p < 0) return -1;
    return t === T.WALKABLE ? p + 1 : p;
  };
  Ai.ENUM_ORDER = (function () {
    var T = Ai.NodeType;
    return [T.BLOCKED, T.OPEN, T.WALKABLE, T.WALKABLE_DOOR, T.TRAPDOOR, T.POWDER_SNOW,
      T.DANGER_POWDER_SNOW, T.FENCE, T.LAVA, T.WATER, T.WATER_BORDER, T.RAIL, T.UNPASSABLE_RAIL,
      T.DANGER_FIRE, T.DAMAGE_FIRE, T.DANGER_CACTUS, T.DAMAGE_CACTUS, T.DANGER_OTHER,
      T.DAMAGE_OTHER, T.DOOR_OPEN, T.DOOR_WOOD_CLOSED, T.DOOR_IRON_CLOSED, T.BREACH, T.LEAVES,
      T.STICKY_HONEY, T.COCOA];
  })();

  /**
   * Is (x,y,z) a door, and which kind — D-398. `null` when it is not a door at all, else
   * `{ closed, iron, wood }`. Reuses `07b_behaviour.js`'s own property reader (`NS.Behave.
   * propName`) so this can never disagree with what `14l_use.js`'s right-click handler calls
   * "open" — the same door state, read once, not re-derived two different ways.
   */
  Ai.doorAt = function (x, y, z) {
    var h = initHazards();
    if (!h.doorsReady || !NS.Behave || !NS.Behave.propName) return null;
    var state = stateAt(x, y, z);
    if (state <= 0 || !NS.Tags.stateInCol(h.doorsCol, state)) return null;
    var openStr = NS.Behave.propName(state, 'open');
    if (openStr === undefined) return null;
    return {
      closed: openStr !== 'true',
      iron: NS.States.block[state] === h.ironDoor,
      wood: NS.Tags.stateInCol(h.woodenDoorsCol, state)
    };
  };

  /**
   * Break a door at (x,y,z) — both halves, no drops — D-399. Vanilla: `Level.removeBlock(pos,
   * false)` plus a door-break sound EVENT; this engine's nearest equivalent is the block's own
   * ordinary break sound (`NS.Sound.blockBreak`), named as an approximation, not claimed
   * identical to vanilla's own level-event 1021.
   */
  Ai.breakDoor = function (x, y, z, e) {
    if (!NS.World || !NS.States) return false;
    var state = NS.World.getBlock(x, y, z);
    if (state <= 0) return false;
    var half = NS.Behave && NS.Behave.propName ? NS.Behave.propName(state, 'half') : undefined;
    var oy = half === 'upper' ? y - 1 : y + 1;
    var otherState = NS.World.getBlock(x, oy, z);
    NS.World.setBlock(x, y, z, 0);
    if (NS.Save && NS.Save.record) NS.Save.record(x, y, z, 0);
    if (otherState > 0 && NS.States.block[otherState] === NS.States.block[state]) {
      NS.World.setBlock(x, oy, z, 0);
      if (NS.Save && NS.Save.record) NS.Save.record(x, oy, z, 0);
    }
    // BreakDoorGoal.tick: removeBlock, then worldEvent 1021 (break_wooden_door); its 2001 reads the
    // state AFTER removal (air), so it adds nothing.
    Ai.doorEvent(e, 'entity.zombie.break_wooden_door', x, y, z);
    return true;
  };

  /** WorldRenderer 1019/1021: a door-bash sound at the door, volume 2.0, pitch 1 +/- 0.2. */
  Ai.doorEvent = function (e, ev, x, y, z) {
    var S = NS.Sound;
    if (S && S.play) S.play(ev, { volume: 2, pitch: (Ai.rndOf(e)() - Ai.rndOf(e)()) * 0.2 + 1,
      x: x + 0.5, y: y + 0.5, z: z + 0.5, source: S.mobSource ? S.mobSource(e && e.type, e) : undefined });
  };

  /**
   * `DoorBlock.setOpen` (D-602 raiderroar, unread this file's own body -- DoorBlock.java is not
   * in `.decomp`; the shape below is the SAME toggle `14l_use.js`'s own `DoorBlock.use` already
   * plays out for a player's right-click, reused rather than re-derived: only write + sound when
   * the door's live `open` state differs from what is asked for, both halves in the same call
   * (D-332 -- this engine writes both halves on placement, so opening/closing must touch both or
   * the top half looks broken), `NS.Sound.blockPlace` for the click (`14l_use.js`'s own header:
   * "the nearest event this table carries" for a door, no distinct open/close sound id modelled).
   * Used by `Ai.LongDoorInteractGoal`, below -- unlike `Ai.breakDoor` this never removes a block.
   */
  Ai.setDoorOpen = function (x, y, z, open) {
    if (!NS.World || !NS.Behave || !NS.Behave.setProp || !NS.Behave.propName || !NS.States) return false;
    var state = NS.World.getBlock(x, y, z);
    if (state <= 0) return false;
    var openStr = NS.Behave.propName(state, 'open');
    if (openStr === undefined) return false;   // not a door-shaped state
    open = !!open;
    if ((openStr === 'true') === open) return true;   // DoorBlock.setOpen: state.get(OPEN) != open guard
    var half = NS.Behave.propName(state, 'half');
    var oy = half === 'upper' ? y - 1 : y + 1;
    var other = NS.World.getBlock(x, oy, z);
    var newState = NS.Behave.setProp(state, 'open', open);
    NS.World.setBlock(x, y, z, newState);
    if (NS.Save && NS.Save.record) NS.Save.record(x, y, z, newState);
    if (other > 0 && NS.States.block[other] === NS.States.block[state] && NS.Behave.propName(other, 'open') !== undefined) {
      var newOther = NS.Behave.setProp(other, 'open', open);
      NS.World.setBlock(x, oy, z, newOther);
      if (NS.Save && NS.Save.record) NS.Save.record(x, oy, z, newOther);
    }
    if (NS.Behave.changed) { NS.Behave.changed(x, y, z); }
    if (NS.Sound && NS.Sound.blockPlace) NS.Sound.blockPlace(state, x + 0.5, y + 0.5, z + 0.5, null);
    return true;
  };

  /**
   * `RavagerEntity.tickMovement()`'s own leaf-breaking branch (RavagerEntity.java:159-181,
   * D-602 raiderroar): every `LeavesBlock` inside the mob's own bounding box, expanded 0.2 in
   * every direction, is removed (mobGriefing-gated, checked by the caller -- `Ai.RavagerRoarGoal`
   * below), while the mob is pushing against something solid horizontally. Returns whether any
   * block was removed -- `Ai.RavagerRoarGoal` reads that to decide the `jump()` fallback
   * (RavagerEntity.java:178-180: `if (!$$2 && this.onGround) this.jump();`).
   * `World.breakBlock(pos, true, this)`'s drops are rolled via `Loot.breakDrops` (no tool) and
   * popped as items (#1025); worldEvent 2001 (break sound + particles) is emitted per leaf.
   */
  function ravagerBreakLeaves(e) {
    var h = initHazards();
    if (!h.leavesReady) return false;
    var halfWidth = (e.width || 0.6) / 2 + 0.2, height = (e.height || 1.8) + 0.2;
    var minX = Math.floor(e.x - halfWidth), maxX = Math.floor(e.x + halfWidth);
    var minY = Math.floor(e.y - 0.2), maxY = Math.floor(e.y + height);
    var minZ = Math.floor(e.z - halfWidth), maxZ = Math.floor(e.z + halfWidth);
    var broke = false;
    for (var x = minX; x <= maxX; x++) {
      for (var y = minY; y <= maxY; y++) {
        for (var z = minZ; z <= maxZ; z++) {
          var st = stateAt(x, y, z);
          if (st > 0 && NS.Tags.stateInCol(h.leavesCol, st)) {
            // `world.breakBlock(pos, true, this)`: the leaves' own loot table rolls, as items
            var L = NS.Loot, EL = NS.EntityList, IT = NS.Items;
            var drops = (L && L.ready) ? L.breakDrops(st, {}) : [];
            // worldEvent 2001 (`breakBlock`): break sound + particles, before the cell clears
            if (NS.Sound && NS.Sound.blockBreak) NS.Sound.blockBreak(st, x + 0.5, y + 0.5, z + 0.5, null);
            if (NS.Particle && NS.Particle.addBlockBreakParticles) NS.Particle.addBlockBreakParticles(x, y, z, st, null);
            NS.World.setBlock(x, y, z, 0);
            if (NS.Save && NS.Save.record) NS.Save.record(x, y, z, 0);
            if (drops.length && EL && EL.popResource && IT) {
              for (var di = 0; di < drops.length; di++) {
                var idx = IT.of(drops[di].item);
                if (idx >= 0) EL.popResource(x, y, z, idx, drops[di].count || 1);
              }
            }
            broke = true;
          }
        }
      }
    }
    return broke;
  }
  Ai.ravagerBreakLeaves = ravagerBreakLeaves;   // exported for tools/raidmobcheck.mjs

  /**
   * Is there room for a mob (two open cells, feet + head) at (x,y,z), with a floor (or water,
   * for a swimmer) within `maxDrop` cells below `fromY`? Returns the floor Y or null when no
   * safe landing exists within that drop — THIS is the cliff-avoidance rule: a candidate whose
   * only floor is further than `maxDrop` below is refused, not merely penalised.
   */
  Ai.groundLevel = function (x, fromY, z, maxDrop, mob) {
    if (Ai.__testAllWalkable) return fromY - 1;   // anti-vacuity hook — see goalcheck.mjs
    for (var dy = 0; dy <= maxDrop; dy++) {
      var y = fromY - dy;
      // D-398 — checked BEFORE the headroom/solid branch below, same reason `Ai.pathTypeAt`
      // does: this engine's own collision already treats cactus as solid, so a fire/cactus/
      // sweet-berry-bush/lit-campfire cell must be refused on IDENTITY, not left to fall out of
      // the generic solid check by accident. `Ai.__testHazardsOff` is the anti-vacuity hook
      // goalcheck.mjs disables to prove this refusal test can actually fail (D-30/D-305).
      if (!Ai.__testHazardsOff) {
        // s117: the CELL's own identity (getCommonNodeType), as D-398 always asked -- the
        // below/neighbour rules are the A*'s per-mob penalty (neighborsOf), not a floor refusal.
        // s119: with a MOB, the refusal is that mob's own `getPathfindingPenalty(type) < 0`
        // (getPathNode's rule, .decomp LandPathNodeMaker :230-236) — a fire cell costs a zombie
        // 16 and refuses nothing; a cactus (-1) refuses everyone who keeps the default. Only a
        // mob-less caller (a synthetic test) keeps the old everyone-refuses answer.
        var pt = Ai.commonNodeType(x, y, z);
        if (pt === Ai.NodeType.DAMAGE_FIRE || pt === Ai.NodeType.DAMAGE_OTHER ||
            pt === Ai.NodeType.DAMAGE_CACTUS) {
          if (!mob || Ai.pathPenalty(mob, pt) < 0) continue;
        }
      }
      if (isSolid(x, y, z) || isSolid(x, y + 1, z)) continue;   // no headroom here
      var here = blockIdAt(x, y, z);
      if (here === NS.Reg.id.lava) continue;                    // never a legal floor
      if (isSolid(x, y - 1, z)) return y;                        // a real floor
      if (here === NS.Reg.id.water) return y;                    // a swimmer's floor
    }
    return null;
  };

  // ════════════════════════════ 3. A* pathfinding ═════════════════════════════════════════════

  function heuristicBase(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
  }
  var heuristic = heuristicBase;
  function key(n) { return n.x + ',' + n.y + ',' + n.z; }
  var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  /** `LandPathNodeMaker.getFeetY` (.decomp :215-219) for the only tall collision tops this
   *  engine's floors have: a fence/wall/closed gate below stands 1.5 high. */
  function feetY(x, y, z) {
    if (Ai.__testNoFeet) return y;   // pathcheck anti-vacuity hook
    return y + (Ai.commonNodeType(x, y - 1, z) === Ai.NodeType.FENCE ? 0.5 : 0);
  }
  Ai.feetY = feetY;
  function neighborsOf(n, maxDrop, mob) {
    var out = [];
    var here = n.feet === undefined ? feetY(n.x, n.y, n.z) : n.feet;
    for (var i = 0; i < DIRS.length; i++) {
      var nx = n.x + DIRS[i][0], nz = n.z + DIRS[i][1];
      // search from one block above the current foot down through maxDrop+1: covers a
      // one-block step UP as well as a drop of up to maxDrop.
      var y = Ai.groundLevel(nx, n.y + 1, nz, maxDrop + 1, mob);
      if (y === null) continue;
      if (y > n.y + 1) continue;                 // more than a one-block rise: refused
      // s117 loop/pathtypes -- `getPathNode`'s own `feetY - prevFeetY > 1.125` refusal
      // (.decomp :228-229): a fence/wall top is 1.5 high, so a pen holds a walking mob.
      var f = feetY(nx, y, nz);
      if (f - here > 1.125) continue;
      // `getNodeType` over the mob's box, and `mob.getPathfindingPenalty(type)` (:230-236):
      // a negative penalty refuses the node; otherwise the penalty is added to its cost.
      var t = Ai.__testNoMalus ? Ai.NodeType.WALKABLE : Ai.mobNodeType(mob, nx, y, nz);
      var pen = Ai.__testNoMalus ? 0 : Ai.pathPenalty(mob, t);
      if (pen < 0) continue;
      out.push({ x: nx, y: y, z: nz, feet: f, type: t, penalty: pen });
    }
    return out;
  }
  function reconstruct(cameFrom, node) {
    var path = [node], k = key(node);
    while (cameFrom[k]) { node = cameFrom[k]; path.push(node); k = key(node); }
    return path.reverse();
  }

  /**
   * `Ai.findPath(sx,sy,sz, tx,ty,tz, opts)` -> [{x,y,z}, ...] from start (inclusive) to a node
   * within one block of the target, or `null` when no path exists within the node budget.
   * `opts.maxDrop` (default 1) — see `Ai.groundLevel`. `opts.maxNodes` (default 400) bounds the
   * search so a sealed room refuses quickly instead of scanning the whole loaded world.
   * `opts.maxDistance` — `PathNodeNavigator.findPathToAny`'s followRange bound (.decomp :44-49): a
   * node at or beyond that straight-line distance from the start is not expanded, nor accepted as a
   * successor (vanilla's `pathLength < followRange`; this grid is 4-connected, so the straight-line
   * form is the one that keeps a diagonal flee as long as vanilla's 8-connected one).
   * `opts.partial` — when the goal is not reached, vanilla still returns the path to the visited node
   * NEAREST the target (`getManhattanDistanceFromTarget`, then shorter; :63-66) instead of null.
   */
  /** MobEntity.getSafeFallDistance (.decomp MobEntity.java:793-805): 3 with no target, else
   *  3 + max(0, (int)(health - maxHealth*0.33f) - (3 - difficultyId)*4). */
  Ai.safeFallDistance = function (m) {
    if (!m.target) return 3;
    var D = NS.Diff, id = D && D.LEVELS ? D.LEVELS.indexOf(D.value) : 2;
    if (id < 0) id = 2;
    var mh = m.maxHealth === undefined ? 20 : m.maxHealth, h = m.health === undefined ? mh : m.health;
    var i = Math.trunc(h - Math.fround(mh * Math.fround(0.33))) - (3 - id) * 4;
    return (i < 0 ? 0 : i) + 3;
  };
  var findPathRaw = function (sx, sy, sz, tx, ty, tz, opts) {
    opts = opts || {};
    var maxDrop = opts.maxDrop !== undefined ? opts.maxDrop : (opts.mob ? Ai.safeFallDistance(opts.mob) : 1);
    // CreeperEntity.getSafeFallDistance: getTarget()==null ? 3 : 3 + (int)(getHealth() - 1.0F)
    var m = opts.mob;
    if (m && m.type === 'creeper') maxDrop = m.target ? 3 + Math.trunc((m.health === undefined ? 20 : m.health) - 1) : 3;
    var maxNodes = opts.maxNodes || 400;
    var start = { x: Math.floor(sx), y: Math.floor(sy), z: Math.floor(sz) };
    var goal = { x: Math.floor(tx), y: Math.floor(ty), z: Math.floor(tz) };
    // opts.goals: [{x,y,z,reach}] -- PathNodeNavigator.findPathToAny's target set: ONE search, a node
    // finishes when its manhattan distance to any target is <= that target's reach; h = nearest target.
    var goals = opts.goals || null;
    var heuristic = goals ? function (a) {
      var b = Infinity;
      for (var q = 0; q < goals.length; q++) { var d = heuristicBase(a, goals[q]); if (d < b) b = d; }
      return b;
    } : heuristicBase;
    var open = [start];
    var cameFrom = {}, gScore = {}, fScore = {}, closed = {};
    gScore[key(start)] = 0;
    fScore[key(start)] = heuristic(start, goal);
    var visited = 0;
    var maxD = opts.maxDistance, nearest = null, nearestH = Infinity, nearestG = Infinity;
    var fromStart = function (n) {
      var ax = n.x - start.x, ay = n.y - start.y, az = n.z - start.z;
      return Math.sqrt(ax * ax + ay * ay + az * az);
    };
    while (open.length && visited < maxNodes) {
      visited++;
      open.sort(function (a, b) { return (fScore[key(a)] || Infinity) - (fScore[key(b)] || Infinity); });
      var current = open.shift();
      var ck = key(current);
      if (goals) {
        for (var gi = 0; gi < goals.length; gi++) if (heuristicBase(current, goals[gi]) <= goals[gi].reach) return reconstruct(cameFrom, current);
      } else if (current.x === goal.x && current.z === goal.z && Math.abs(current.y - goal.y) <= 1) {
        return reconstruct(cameFrom, current);
      }
      closed[ck] = true;
      if (opts.partial) {
        var hc = heuristic(current, goal);
        if (hc < nearestH || (hc === nearestH && gScore[ck] < nearestG)) { nearest = current; nearestH = hc; nearestG = gScore[ck]; }
      }
      if (maxD !== undefined && fromStart(current) >= maxD) continue;
      var nbs = neighborsOf(current, maxDrop, opts.mob || null);
      for (var i = 0; i < nbs.length; i++) {
        var nb = nbs[i], nk = key(nb);
        if (closed[nk] || (opts.nodeOk && !opts.nodeOk(nb.x, nb.y, nb.z))) continue;   // TurtleSwimNavigation.isValidPosition (#4360)
        if (maxD !== undefined && fromStart(nb) >= maxD) continue;
        var tentative = gScore[ck] + 1 + (nb.penalty || 0);   // PathNode.penalty, s117
        if (gScore[nk] === undefined || tentative < gScore[nk]) {
          cameFrom[nk] = current;
          gScore[nk] = tentative;
          fScore[nk] = tentative + heuristic(nb, goal);
          var already = false;
          for (var j = 0; j < open.length; j++) if (key(open[j]) === nk) { already = true; break; }
          if (!already) open.push(nb);
        }
      }
    }
    return (opts.partial && nearest) ? reconstruct(cameFrom, nearest) : null;
  };

  /**
   * #4073 `SwimNavigation` substrate: A* through water cells only, 6-connected (a swimmer's
   * `WaterPathNodeMaker` accepts a node whose cell is water). Returns [{x,y,z}...] start..goal-cell,
   * or (`opts.partial`) the visited node nearest the goal, or null. `opts.maxNodes` default 400.
   * WaterPathNodeMaker.getNodeType: `opts.box` {w,h} (mob width/height) sizes the tested volume floor(size+1) cells
   * from the node cell; any non-water cell = BLOCKED, any air cell = BREACH (accepted only with `opts.breach`, the
   * dolphin's canJumpOutOfWater, at +8 penalty when the node cell itself holds no fluid), else WATER.
   */
  Ai.swimNodePenalty = function (x, y, z, bx, by, bz, breach) {
    var S = NS.States, sawAir = false;
    for (var i = x; i < x + bx; i++) for (var j = y; j < y + by; j++) for (var k = z; k < z + bz; k++) {
      var st = stateAt(i, j, k);
      if (S.waterIn[st]) continue;
      if (st === 0) { sawAir = true; continue; }
      return -1;
    }
    if (!sawAir) return 0;
    return breach ? (S.waterIn[stateAt(x, y, z)] ? 0 : 8) : -1;
  };

  Ai.findSwimPath = function (sx, sy, sz, tx, ty, tz, opts) {
    opts = opts || {};
    var bw = opts.box ? Math.floor(opts.box.w + 1) : 1, bh = opts.box ? Math.floor(opts.box.h + 1) : 1;
    var S = NS.States, maxNodes = opts.maxNodes || 400;
    var start = { x: Math.floor(sx), y: Math.floor(sy), z: Math.floor(sz) };
    var goal = { x: Math.floor(tx), y: Math.floor(ty), z: Math.floor(tz) };
    var open = [start], cameFrom = {}, g = {}, f = {}, closed = {}, visited = 0, nearest = null, nearestH = Infinity, bp = 0;
    g[key(start)] = 0; f[key(start)] = heuristic(start, goal);
    var D = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    while (open.length && visited < maxNodes) {
      visited++;
      open.sort(function (a, b) { return f[key(a)] - f[key(b)]; });
      var cur = open.shift(), ck = key(cur);
      if (cur.x === goal.x && cur.y === goal.y && cur.z === goal.z) return reconstruct(cameFrom, cur);
      closed[ck] = true;
      var hc = heuristic(cur, goal);
      if (hc < nearestH) { nearest = cur; nearestH = hc; }
      for (var i = 0; i < 6; i++) {
        var nb = { x: cur.x + D[i][0], y: cur.y + D[i][1], z: cur.z + D[i][2] }, nk = key(nb);
        if (closed[nk] || nb.y < NS.CFG.WORLD_MIN_Y || nb.y > NS.CFG.WORLD_MAX_Y || !(opts.air ? (bp = Ai.birdNodePenalty(opts.mob, nb.x, nb.y, nb.z)) >= 0 : (bp = Ai.swimNodePenalty(nb.x, nb.y, nb.z, bw, bh, bw, opts.breach)) >= 0)) continue;   // opts.air: BirdPathNodeMaker node types (cocoa/fire/door rules)
        var t = g[ck] + 1 + bp;
        if (g[nk] === undefined || t < g[nk]) {
          cameFrom[nk] = cur; g[nk] = t; f[nk] = t + heuristic(nb, goal);
          if (open.indexOf(nb) < 0 && !open.some(function (o) { return key(o) === nk; })) open.push(nb);
        }
      }
    }
    return opts.partial && nearest && nearest !== start ? reconstruct(cameFrom, nearest) : null;
  };

  // ═══════════════════ THE MOVE CONTROL — D-417 ══════════════════════════════════════════
  //
  // ⚠⚠ **A GOAL DOES NOT MOVE A MOB. IT AIMS ONE.** `Ai.stepToward` used to write `e.x`, `e.y`
  // and `e.z` outright — a teleport of a fraction of a block per tick — so no mob in this game
  // had ever been through `Ph.move`, and every one of them walked through walls, sank through
  // floors and climbed sheer cliffs. Dan reported it as "mobs phase thru blocks"; the collision
  // sweep was never broken, it was never ASKED. Everything below sets a HEADING, a SPEED and a
  // JUMP FLAG, and `Ph.travelMob` (14b_physics.js) is the only thing that may move an entity.
  //
  // ⚠ IT IS `bcw.a()`'s MOVE_TO BRANCH, READ OUT OF THE 1.18.2 BYTECODE THIS SESSION (D-417):
  //     operation = WAIT;
  //     d0 = wantedX - getX(); d1 = wantedZ - getZ(); d2 = wantedY - getY();
  //     if (d0*d0 + d2*d2 + d1*d1 < 2.500000277905201E-7) { mob.setZza(0); return; }
  //     mob.setYRot(rotlerp(getYRot(), atan2(d1, d0)*57.2957763671875 - 90, 90));
  //     mob.setSpeed(speedModifier * getAttributeValue(MOVEMENT_SPEED));
  //     if (d2 > maxUpStep && d0*d0 + d1*d1 < max(1, getBbWidth())
  //         || !shapeHere.isEmpty() && getY() < shapeHere.max(Y) + posHere.getY()
  //            && !stateHere.is(DOORS) && !stateHere.is(FENCES)) { jumpControl.jump(); }
  //
  // ⚠ **`speed` IS A MODIFIER, NOT BLOCKS PER TICK, AND IT USED NOT TO BE.** Vanilla's goals
  // carry a dimensionless multiplier on the mob's own MOVEMENT_SPEED attribute — 1.0, 1.25,
  // 2.0 — and the roster used to pass 0.05 and 0.06, which under the old teleport WERE blocks
  // per tick. `Ai.SpiderAttackGoal` already passed 1.0 (D-416), so the two units were live in
  // the same file at once. They are one unit now, and it is vanilla's.

  /** `Mth.wrapDegrees`, in this engine's radians: fold to (−π, π]. */
  Ai.wrapRad = function (a) {
    a = a % (2 * Math.PI);
    if (a > Math.PI) a -= 2 * Math.PI;
    if (a <= -Math.PI) a += 2 * Math.PI;
    return a;
  };

  /** `bcw.a(F,F,F)` — MoveControl.rotlerp: step `from` toward `to` by at most `maxDelta`. */
  Ai.rotlerp = function (from, to, maxDelta) {
    var d = Ai.wrapRad(to - from);
    if (d > maxDelta) d = maxDelta;
    if (d < -maxDelta) d = -maxDelta;
    return Ai.wrapRad(from + d);
  };

  // ── THE HEAD (D-422) ───────────────────────────────────────────────────────────────────
  //
  // ⚠⚠ **EVERY MOB IN THIS GAME STARED DEAD AHEAD, AND THE GOAL THAT WAS SUPPOSED TO FIX IT
  // TURNED THE WHOLE BODY INSTEAD.** `ER.animOf` fed `netHeadYaw = 0, headPitch = 0` to every
  // model in the game and said so in its own header: *"nothing in this engine turns a mob's
  // head independently of its body yet"*. Meanwhile `Ai.LookAtPlayerGoal.tick` wrote `e.yaw`
  // — the BODY yaw — directly, with no rate limit and no clamp, so a cow noticing a player
  // SNAPPED its entire body round in one tick. That is D-417's class of bug again, one field
  // over: a goal writing the state that a CONTROL owns. Goals ask; controls move.
  //
  // ⚠ **THE LAW IS THE JAR'S**, disassembled this session (`bcv` = LookControl, `bcr` =
  // BodyRotationControl, `aya` = Mob — the container did the javap, STATE §0):
  //
  //     LookControl.setLookAt(x,y,z)     wanted = (x,y,z); speed = getHeadRotSpeed();
  //                                      xMax = getMaxHeadXRot(); lookAtCooldown = 2
  //     LookControl.tick()               mob.xRot = 0                     // resetXRotOnTick()
  //                                      if (cooldown-- > 0) {
  //                                        yHeadRot = rotateTowards(yHeadRot, wantedYaw,   speed)
  //                                        xRot     = rotateTowards(xRot,     wantedPitch, xMax)
  //                                      } else
  //                                        yHeadRot = rotateTowards(yHeadRot, yBodyRot, 10)
  //                                      if (!navigation.isDone())
  //                                        yHeadRot = rotateIfNecessary(yHeadRot, yBodyRot, getMaxHeadYRot())
  //     rotateTowards(from, to, max)     from + clamp(degreesDifference(from, to), -max, max)
  //
  // ⚠ **THE TWO ARE NOT THE SAME FUNCTION AND THAT IS THE WHOLE CHARACTER OF THE MOTION.**
  // `rotateTowards` MOVES the head a little way toward where it wants to look, every tick —
  // ten degrees, which is why a vanilla mob's head swings round smoothly instead of snapping.
  // `rotateIfNecessary` does nothing at all until the head is further than the limit from the
  // body, and then pulls it back to exactly the limit. Use one where the other belongs and you
  // get either a head that teleports or a head that can point backwards.
  //
  // ⚠ **AND THE BODY FOLLOWS, ON ITS OWN CLOCK** (`bcr`, BodyRotationControl):
  //     moving           → head clamped to the body, and the "stable" head is reset
  //     standing, and the head moved more than 15° since it was last stable
  //                      → the BODY is pulled to within getMaxHeadYRot() of the head
  //     standing, head stable for more than 10 ticks
  //                      → the body swings to the head with a limit that SHRINKS from
  //                        getMaxHeadYRot() to 0 over the next 10 ticks, which is the slow
  //                        turn-and-face a vanilla animal does when you stand still near it
  //
  // ⚠ **ONE SIMPLIFICATION, NAMED.** Vanilla has THREE yaws: `getYRot()` (where the entity is
  // aimed), `yBodyRot` (where the body is drawn) and `yHeadRot`. This engine has `e.yaw` for
  // the first two together — movement aims it and the renderer draws it — so the moving branch
  // above, which in vanilla copies `getYRot()` into `yBodyRot`, is a no-op here rather than a
  // missing line. It is on `Ai.OWED`.
  var DEG = Math.PI / 180;
  Ai.HEAD_MAX_PITCH = 40 * DEG;      // aya.T() — Mob.getMaxHeadXRot
  Ai.HEAD_MAX_YAW = 75 * DEG;        // aya.U() — Mob.getMaxHeadYRot
  Ai.HEAD_ROT_SPEED = 10 * DEG;      // aya.V() — Mob.getHeadRotSpeed
  Ai.BODY_STABLE_DEG = 15 * DEG;     // bcr's own 15
  Ai.BODY_STABLE_TICKS = 10;         // bcr's own 10, twice (the wait AND the ramp)

  /**
   * ⚠ THE PER-SPECIES OVERRIDES, IN VANILLA'S OWN DEGREES, AND THE LIST IS THE JAR'S RATHER
   * THAN A SELECTION. Every class in `Mob`'s subtree was walked and every override of
   * `getMaxHeadXRot`/`getMaxHeadYRot`/`getHeadRotSpeed` read off its bytecode; these EIGHT are
   * all of them, and `getHeadRotSpeed` is overridden by nothing at all. The obfuscated classes
   * were matched to registry names through `EntityType`'s own `<clinit>` (each `ldc "<name>"`
   * sits beside the `invokedynamic` whose bootstrap method handle names the constructor's
   * class), so these are not guesses about which mob is which.
   *
   * ⚠ A SUBCLASS INHERITS: `magma_cube` is a `Slime` and `elder_guardian` is a `Guardian`, and
   * neither overrides again, so both are listed with their parent's numbers rather than left to
   * fall back to a default that would be wrong for them.
   */
  Ai.HEAD_LIMITS = {
    slime:          { x: 0 },              // a slime has no neck at all
    magma_cube:     { x: 0 },              // extends Slime
    guardian:       { x: 180 },
    elder_guardian: { x: 180 },            // extends Guardian
    shulker:        { x: 180, y: 180 },    // a head that is the whole animal
    ravager:        { y: 45 },
    goat:           { y: 15 },
    axolotl:        { x: 1, y: 1 },
    dolphin:        { x: 1, y: 1 }
  };
  /** ⚠ `Wolf.getMaxHeadXRot()` is `isInSittingPose() ? 20 : super` — the one override that is a
   *  BRANCH rather than a constant. Sitting is G18e's (taming), so the sitting arm is written
   *  here against a flag nothing sets yet rather than left out and forgotten. */
  Ai.WOLF_SITTING_PITCH = 20 * DEG;

  Ai.maxHeadPitch = function (e) {
    if (e && e.type === 'wolf' && e.sitting) return Ai.WOLF_SITTING_PITCH;
    var L = e && Ai.HEAD_LIMITS[e.type];
    return (L && L.x !== undefined) ? L.x * DEG : Ai.HEAD_MAX_PITCH;
  };
  Ai.maxHeadYaw = function (e) {
    var L = e && Ai.HEAD_LIMITS[e.type];
    return (L && L.y !== undefined) ? L.y * DEG : Ai.HEAD_MAX_YAW;
  };
  Ai.headRotSpeed = function () { return Ai.HEAD_ROT_SPEED; };

  /** `LookControl.rotateTowards(from, to, maxDelta)` — MOVE toward `to`, at most `maxDelta`.
   *  Identical in shape to `Ai.rotlerp` (MoveControl's own), and deliberately not merged with
   *  it: they are two different vanilla methods on two different classes, and one of them
   *  changing is not a reason for the other to. */
  Ai.rotateTowards = function (from, to, maxDelta) {
    var d = Ai.wrapRad(to - from);
    if (d > maxDelta) d = maxDelta;
    if (d < -maxDelta) d = -maxDelta;
    return Ai.wrapRad(from + d);
  };

  /** `Mth.rotateIfNecessary(current, target, maxDelta)` — do NOTHING while `current` is within
   *  `maxDelta` of `target`, and otherwise pull it back to exactly the limit. */
  Ai.rotateIfNecessary = function (current, target, maxDelta) {
    var d = Ai.wrapRad(current - target);
    if (d > maxDelta) return Ai.wrapRad(target + maxDelta);
    if (d < -maxDelta) return Ai.wrapRad(target - maxDelta);
    return current;
  };

  /** Where a mob wants its head pointed, as a yaw in this engine's radians, or null when the
   *  target is directly above or below it (vanilla's own 1e-5 guard, which is what stops a mob
   *  spinning when something sits on its head). */
  Ai.wantedHeadYaw = function (e, x, z) {
    var dx = x - e.x, dz = z - e.z;
    if (Math.abs(dx) <= 1e-5 && Math.abs(dz) <= 1e-5) return null;
    // ⚠ THE ENGINE'S OWN FORMULA, not vanilla's `atan2(dz, dx) * RAD - 90`: this engine's yaw is
    // Minecraft's minus 180 (D-415), and `atan2(dx, -dz)` is that same angle already turned.
    return Math.atan2(dx, -dz);
  };

  /** Eye height of any entity or the player (mobs never carry `.eyeHeight`). */
  Ai.eyeOf = function (e) {
    if (e === NS.Player) return NS.Survival && NS.Survival.eyeHeight ? NS.Survival.eyeHeight(e) : 1.62;
    return NS.Combat && NS.Combat.eyeHeightOf ? NS.Combat.eyeHeightOf(e) : (e.height || 1.8) * 0.85;
  };

  /** And the pitch, in VANILLA'S SIGN — positive looks DOWN — because the only thing that ever
   *  reads it is the model's own `headPitch`, which `setupAnim` defines in those terms. */
  Ai.wantedHeadPitch = function (e, x, y, z) {
    var dx = x - e.x, dz = z - e.z;
    var dy = y - (e.y + Ai.eyeOf(e));
    var horiz = Math.sqrt(dx * dx + dz * dz);
    if (Math.abs(dy) <= 1e-5 && Math.abs(horiz) <= 1e-5) return null;
    return -Math.atan2(dy, horiz);
  };

  /** `bcv` — LookControl. One per mob, attached by `Ai.selectorFor`. */
  Ai.LookControl = function (e) {
    var self = this;
    this.wanted = null;          // {x, y, z}
    this.ySpeed = Ai.HEAD_ROT_SPEED;
    this.xMax = Ai.HEAD_MAX_PITCH;
    this.cooldown = 0;
    this.setLookAt = function (x, y, z, ySpeed, xMax) {
      self.wanted = { x: x, y: y, z: z };
      self.ySpeed = ySpeed === undefined ? Ai.headRotSpeed(e) : ySpeed;
      self.xMax = xMax === undefined ? Ai.maxHeadPitch(e) : xMax;
      self.cooldown = 2;                      // vanilla's own lookAtCooldown
    };
    this.isLookingAtTarget = function () { return self.cooldown > 0; };
    this.tick = function () {
      // ⚠ `resetXRotOnTick()` is `true` on the base class: the pitch is thrown away and
      // recomputed EVERY tick, so a mob that stops looking at something levels its head at once
      // while its yaw eases back. Keep the pitch instead and a cow that watched you walk past
      // stays nose-down for ever.
      e.xHeadRot = 0;
      if (self.cooldown > 0 && self.wanted) {
        self.cooldown--;
        var y = Ai.wantedHeadYaw(e, self.wanted.x, self.wanted.z);
        if (y !== null) e.yHeadRot = Ai.rotateTowards(e.yHeadRot || 0, y, self.ySpeed);
        var p = Ai.wantedHeadPitch(e, self.wanted.x, self.wanted.y, self.wanted.z);
        if (p !== null) e.xHeadRot = Ai.rotateTowards(0, p, self.xMax);
      } else {
        e.yHeadRot = Ai.rotateTowards(e.yHeadRot || 0, Ai.bodyYawOf(e), Ai.HEAD_ROT_SPEED);
      }
      // ⚠ ONLY WHILE THE MOB IS PATHING, which is vanilla's own condition and a surprising one:
      // a STANDING mob's head is not clamped here at all. `Ai.BodyRotationControl` is what
      // stops it winding round — by turning the BODY, which is the point.
      // ⚠ THE CONDITION IS A STAND-IN AND IS NAMED AS ONE. Vanilla asks
      // `!mob.getNavigation().isDone()`; this engine has no navigator object — a path lives
      // inside whichever goal built it (`Ai.MeleeAttackGoal`, `Ai.PanicGoal`, …) and is not on
      // the entity at all. `e.zza` is the forward input D-417 put there, cleared by `EL.tickMob`
      // every tick and set by any goal that is actually driving the mob this tick, so "something
      // is moving me" is the same question in a different place. On `Ai.OWED`.
      if (e.navigating) {
        e.yHeadRot = Ai.rotateIfNecessary(e.yHeadRot || 0, Ai.bodyYawOf(e), Ai.maxHeadYaw(e));
      }
    };
  };

  /** `YawAdjustingLookControl(mob, threshold)` (dolphin: 10) -- head aims at target yaw+20 / pitch+10, and the
   *  body follows the head 4deg/tick once they differ by more than the threshold. Own tick; no resetXRotOnTick. */
  Ai.YawAdjustingLookControl = function (e, threshold) {
    Ai.LookControl.call(this, e);
    var self = this;
    this.tick = function () {
      if (self.cooldown > 0 && self.wanted) {
        self.cooldown--;
        var y = Ai.wantedHeadYaw(e, self.wanted.x, self.wanted.z);
        if (y !== null) e.yHeadRot = Ai.rotateTowards(e.yHeadRot || 0, y + 20 * DEG, self.ySpeed);
        var p = Ai.wantedHeadPitch(e, self.wanted.x, self.wanted.y, self.wanted.z);
        if (p !== null) e.pitch = Ai.rotateTowards(e.pitch || 0, p + 10 * DEG, self.xMax);
      } else {
        if (!e.navigating) e.pitch = Ai.rotateTowards(e.pitch || 0, 0, 5 * DEG);
        e.yHeadRot = Ai.rotateTowards(e.yHeadRot || 0, Ai.bodyYawOf(e), self.ySpeed);
      }
      var d = Ai.wrapRad((e.yHeadRot || 0) - Ai.bodyYawOf(e)), t = threshold * DEG;
      if (d < -t) e.yBodyRot = Ai.wrapRad(Ai.bodyYawOf(e) - 4 * DEG);
      else if (d > t) e.yBodyRot = Ai.wrapRad(Ai.bodyYawOf(e) + 4 * DEG);
    };
  };

  /** `yBodyRot` — where the body is DRAWN — falling back to the aim yaw for an entity that has
   *  no body control (D-422 second half: the two are separate fields, as in vanilla). */
  Ai.bodyYawOf = function (e) { return e.yBodyRot === undefined ? (e.yaw || 0) : e.yBodyRot; };

  /** `LivingEntity.turnHead(f, g)` (.decomp LivingEntity.java:2438) in radians: the body eases
   *  toward `target` at 0.3, is clamped to 75deg of the aim yaw, and past 50deg (the `2500` term
   *  is 50 squared) is pushed a further 0.2 of the offset. Returns the walk-speed sign flip.
   *  ⚠ `MobEntity.turnHead` OVERRIDES this with `bodyControl.tick(); return g;`, so a mob never
   *  runs it — it is the rule for a player-shaped entity, ported and unit-checked, not wired. */
  Ai.livingTurnHead = function (e, target, g) {
    var b = Ai.bodyYawOf(e);
    b += Ai.wrapRad(target - b) * 0.3;
    var i = Ai.wrapRad((e.yaw || 0) - b);
    var flip = i < -Math.PI / 2 || i >= Math.PI / 2;
    var lim = 75 * DEG;
    if (i < -lim) i = -lim;
    if (i >= lim) i = lim;
    b = (e.yaw || 0) - i;
    if (i * i > 2500 * DEG * DEG) b += i * 0.2;
    e.yBodyRot = Ai.wrapRad(b);
    return flip ? -g : g;
  };

  /** `bcr` — BodyRotationControl: how the body catches up with the head. */
  Ai.BodyRotationControl = function (e) {
    var self = this;
    this.lastStableHeadYaw = 0;
    this.headStableTicks = 0;
    if (e.yBodyRot === undefined) e.yBodyRot = e.yaw || 0;
    this.tick = function () {
      // A ridden mob is steered by its rider: vanilla's tickRidden sets yBodyRot = yHeadRot = yRot.
      if (e.rider) { e.yBodyRot = e.yHeadRot = e.yaw || 0; return; }
      var dx = e.x - (e.xOld === undefined ? e.x : e.xOld);
      var dz = e.z - (e.zOld === undefined ? e.z : e.zOld);
      if (dx * dx + dz * dz > Ai.MOVE_ARRIVED_SQ) {
        // MOVING: yBodyRot = getYRot(), then the head is pulled to the body.
        e.yBodyRot = e.yaw || 0;
        e.yHeadRot = Ai.rotateIfNecessary(e.yHeadRot || 0, e.yBodyRot, Ai.maxHeadYaw(e));
        self.lastStableHeadYaw = e.yHeadRot;
        self.headStableTicks = 0;
        return;
      }
      // BodyControl.isIndependent: `!(getFirstPassenger() instanceof MobEntity)` -- a mob carrying a mob
      // (raider on a ravager) skips the whole not-moving branch.
      if (e.passenger) return;
      if (Math.abs(Ai.wrapRad((e.yHeadRot || 0) - self.lastStableHeadYaw)) > Ai.BODY_STABLE_DEG) {
        self.headStableTicks = 0;
        self.lastStableHeadYaw = e.yHeadRot || 0;
        e.yBodyRot = Ai.rotateIfNecessary(e.yBodyRot, e.yHeadRot || 0, Ai.maxHeadYaw(e));
        return;
      }
      self.headStableTicks++;
      if (self.headStableTicks > Ai.BODY_STABLE_TICKS) {
        // ⚠ THE SHRINKING LIMIT. `f = clamp((stable - 10) / 10, 0, 1)` and the allowance is
        // `maxHeadYaw * (1 - f)`, so over ten ticks the body is allowed less and less daylight
        // between itself and the head until it is square on. This is the slow turn a cow does
        // when you stand still beside it, and it is a RAMP, not a step.
        var f = (self.headStableTicks - Ai.BODY_STABLE_TICKS) / Ai.BODY_STABLE_TICKS;
        if (f < 0) f = 0; if (f > 1) f = 1;
        e.yBodyRot = Ai.rotateIfNecessary(e.yBodyRot, e.yHeadRot || 0, Ai.maxHeadYaw(e) * (1 - f));
      }
    };
  };

  /** One mob's head, for one tick: the look control, then the body catching up. Called by
   *  `EL.tickMob` — never by a goal, which is the distinction this whole section exists for. */
  Ai.tickHead = function (e) {
    if (!e) return;
    if (!e.look) {
      e.look = (e.type === 'shulker' && NS.Shulker && NS.Shulker.LookControl && NS.ShulkerDraw) ? new NS.Shulker.LookControl(e) : e.type === 'dolphin' ? new Ai.YawAdjustingLookControl(e, 10) : new Ai.LookControl(e);
      // D-773 cloud unit (tender-carson-7zokog) -- `ShulkerEntity.createBodyControl` returns
      // `ShulkerBodyControl`, whose tick() is empty: a shulker's body never turns.
      var SD = NS.ShulkerDraw;
      e.body = (e.type === 'shulker' && SD && SD.BodyControl) ? new SD.BodyControl(e) : new Ai.BodyRotationControl(e);
    }
    e.look.tick();
    if (e.type === 'goat' && NS.Goat && NS.Goat.tickRamHead) NS.Goat.tickRamHead(e);
  };

  /** `LivingEntity.tick`'s `turnHead` -> `BodyControl.tick()`: it runs AFTER `tickMovement`, so
   *  `isMoving()` sees THIS tick's displacement. Ticked from the head slot (before the travel) it
   *  saw `e.x - e.xOld == 0` for ever: a walking mob was never "moving", its body never followed
   *  its yaw and it slid sideways (#582). Called by `EL.tickMob` right after the travel. */
  Ai.tickBody = function (e) {
    if (e && e.body) e.body.tick();
    // Endermite/SilverfishEntity.tick: bodyYaw = getYaw(); setBodyYaw(f) -> setYaw(f): body always == aim yaw.
    if (e && (e.type === 'endermite' || e.type === 'silverfish')) e.yBodyRot = e.yaw || 0;
  };

  /** MoveControl's own arrival epsilon and turn cap. 90° is vanilla's, in radians. */
  Ai.MOVE_ARRIVED_SQ = 2.500000277905201e-7;
  Ai.YAW_MAX_DELTA = Math.PI / 2;
  // AquaticMoveControl(.., yawChange=10, ..) mobs turn 10 deg/tick on any ground (#2715); dolphin owns its own (D.YAW_CHANGE)
  Ai.YAW_MAX_DELTA_BY_TYPE = { axolotl: 10 * Math.PI / 180 };

  /**
   * `aya.r(F)` — `Mob.setSpeed(f)` is `super.setSpeed(f); this.setZza(f);`. **The attribute is
   * also the forward input**, which is why a mob's acceleration goes as the SQUARE of its
   * movement speed. Writing one without the other is how a mob ends up standing still at full
   * speed, so they are set together, here, and nowhere else.
   */
  Ai.setMobSpeed = function (e, f) { e.mobSpeed = f; e.zza = f; };

  /** The MOVEMENT_SPEED attribute for this entity, or 0 when the jar never gave it one. */
  Ai.movementSpeedOf = function (e) {
    var E = NS.Entities;
    var at = (E && E.attrsOf) ? E.attrsOf(e.type) : null;
    var base = (at && at.speed) || 0;
    // loop/slime-s97 -- `SlimeEntity.setSize()`'s own MOVEMENT_SPEED write (`field_23719`,
    // 0.2+0.1*size, .decomp SlimeEntity.java) is PER-INSTANCE (a size roll happens per mob),
    // not the jar's static attribute default `Ent.attrsOf('slime')` carries (that row is the
    // un-overridden `MobEntity` base, irrelevant the moment `EL.DEFAULTS.slime`/`Sl.setSize`
    // roll a real size) -- read the live per-entity override when one has been set.
    if (e.speedAttr !== undefined) base = e.speedAttr;
    // `HorseEntity.initAttributes` re-rolls the movement_speed BASE (07r_mount.js Mnt.rollAttributes);
    // a donkey/mule/llama's is the flat 0.175 it registers — both live on `e.movementSpeedAttr`.
    else if (e.movementSpeedAttr !== undefined) base = e.movementSpeedAttr;
    // loop/witchpotion-s95 -- `WitchEntity.DRINKING_SPEED_PENALTY_MODIFIER` (-0.25,
    // ADDITION), a temporary attribute modifier applied for the drink's own duration
    // (`WitchEntity.tickMovement`, 07z_potion.js's own `Po.tickWitchDrink`). This engine
    // has no general temporary-modifier stack (`Ai.OWED`'s own standing gap), so the one
    // modifier that exists is read directly off the flag `Po.tickWitchDrink` sets.
    if (e.witchDrinking && NS.Potion) base += NS.Potion.DRINK_SPEED_PENALTY;
    // `ZombieEntity.setBaby` (.decomp:172-182): a live "Baby speed boost" attribute modifier,
    // MULTIPLY_BASE 0.5 -- base*(1+0.5) -- while `isBaby()`. Every `ZombieEntity` subclass
    // inherits `setBaby` unchanged (husk/drowned/zombie_villager/zombified_piglin all extend it,
    // ZombieEntity.java:1/HuskEntity.java/DrownedEntity.java/ZombieVillagerEntity.java/
    // ZombifiedPiglinEntity.java, each read whole -- none overrides setBaby or isBaby).
    // `ZombifiedPiglinEntity.mobTick`: ATTACKING_SPEED_BOOST (49455A49-7EC5-45BA-B886-3B90B23A1718,
    // +0.05 ADDITION) while hasAngerTime and !isBaby -> 0.28; gone when the anger ends.
    if (e.type === 'zombified_piglin' && (e.angerTime | 0) > 0 && !(NS.Breed && NS.Breed.ready && NS.Breed.isBaby(e))) base += 0.05;
    // `EndermanEntity.setTarget` (:121-137): ATTACKING_SPEED_BOOST +0.15 ADDITION while targeting -> 0.45.
    if (e.type === 'enderman' && e.target) base += 0.15;
    // LivingEntity.addPowderSnowSlowIfNeeded: "Powder snow slow" ADDITION -0.05 * getFreezingScale() (min(frozen,140)/140) while frozen > 0.
    if (e.frozenTicks > 0) base += Math.fround(Math.fround(-0.05) * Math.fround(Math.min(e.frozenTicks, 140) / 140));
    if (Ai.ZOMBIE_BABY_SPEED_TYPES[e.type] && NS.Breed && NS.Breed.ready && NS.Breed.isBaby(e)) base *= 1.5;
    // #2999 `LivingEntity.setSprinting` SPRINTING_SPEED_BOOST (+0.3 MULTIPLY_TOTAL, applied last); felines set it via Ai.felinePose.
    if (e.sprinting && (e.type === 'ocelot' || e.type === 'cat')) base *= 1.3;
    // StatusEffect.addAttributeModifier(MOVEMENT_SPEED): speed +0.2 / slowness -0.15 per level, MULTIPLY_TOTAL (one modifier per effect).
    if (e.effects) {
      if (e.effects.speed) base *= 1 + 0.2 * (e.effects.speed.amplifier + 1);
      if (e.effects.slowness) base *= 1 + -0.15 * (e.effects.slowness.amplifier + 1);
    }
    return base;
  };
  Ai.ZOMBIE_BABY_SPEED_TYPES = { zombie: 1, husk: 1, drowned: 1, zombie_villager: 1, zombified_piglin: 1 };

  /**
   * MoveControl's second jump reason: the mob is standing INSIDE a partial block whose collision
   * top is above its feet (a slab, a dirt path, a snow layer) — but not a door and not a fence,
   * which are things to open and things to give up on rather than things to hop onto.
   */
  Ai.stuckOnShape = function (e) {
    var Ph = NS.Physics;
    var bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
    var shape = Ph.shapeAt(bx, by, bz);
    if (!shape) return false;
    var top;
    if (shape === Ph.FULL_CUBE) top = 1;
    else {
      top = -Infinity;
      for (var i = 0; i < shape.length; i++) if (shape[i][4] > top) top = shape[i][4];
      if (top === -Infinity) return false;
    }
    if (!(e.y < top + by)) return false;
    var T = NS.Tags;
    if (T && T.ready) {
      var id = Ph.blockIdAt(e.x, e.y, e.z);
      var doors = T.blockTag('doors'), fences = T.blockTag('fences');
      if (doors >= 0 && T.blockInCol(doors, id)) return false;
      if (fences >= 0 && T.blockInCol(fences, id)) return false;
    }
    return true;
  };

  /**
   * `Ai.stepToward(e, node, speedModifier)` — aim `e` at a path waypoint for this tick.
   * Sets the heading, the speed and the jump flag. **Moves nothing.**
   */
  Ai.stepToward = function (e, node, speedModifier) {
    var Ph = NS.Physics;
    if (e.type === 'rabbit' && e.inWater) speedModifier = 1.5;   // RabbitMoveControl.moveTo: touching water forces 1.5
    e.navigating = true;   // a path is being followed this tick: `!navigation.isDone()`
    e.navNode = node;      // #716: the node AquaticMoveControl aims its pitch at (Dolphin.travelMob)
    if (e.type === 'rabbit' && e.inWater) speedModifier = 1.5;   // RabbitMoveControl.moveTo: touching water forces 1.5
    e.moveTargetY = node.y;   // MoveControl.getTargetY (RabbitEntity.getJumpVelocity)
    e.moveMod = speedModifier;   // MoveControl.speed (the MOVE_TO order), which CatEntity.mobTick reads back
    var d0 = (node.x + 0.5) - e.x;
    var d1 = (node.z + 0.5) - e.z;
    var d2 = node.y - e.y;
    if (d0 * d0 + d2 * d2 + d1 * d1 < Ai.MOVE_ARRIVED_SQ) { Ai.setMobSpeed(e, 0); return; }

    // ⚠⚠ **RADIANS, AND THIS ENGINE'S YAW, NOT MINECRAFT'S (D-415).** `e.yaw` is read by
    // `ER.build` as `Math.cos(e.yaw)` and by `Cb.mobAttack` for the knockback direction. The
    // engine's own convention is `Cam.forward` — `(sin y, sin p, −cos y)`, yaw 0 looking NORTH —
    // so the heading that points along (d0, d1) is `atan2(d0, −d1)`. Vanilla's own
    // `atan2(d1, d0)·180/π − 90` is the same bearing written in its own degrees.
    e.yaw = Ai.rotlerp(e.yaw, Math.atan2(d0, -d1), Ai.YAW_MAX_DELTA_BY_TYPE[e.type] || Ai.YAW_MAX_DELTA);
    Ai.setMobSpeed(e, speedModifier * Ai.movementSpeedOf(e));

    var upStep = e.maxUpStep === undefined ? Ph.STEP : e.maxUpStep;
    var width = e.width === undefined ? Ph.W : e.width;
    if ((d2 > upStep && (d0 * d0 + d1 * d1) < Math.max(1, width)) || Ai.stuckOnShape(e)) {
      e.jumping = true;   // `bcu.a()` — the JumpControl flag, consumed by `Ph.travelMob`
    }
  };

  Ai.closeTo = function (e, node, r) {
    r = r === undefined ? 0.3 : r;
    var dx = (node.x + 0.5) - e.x, dz = (node.z + 0.5) - e.z;
    return Math.hypot(dx, dz) <= r;
  };

  /**
   * `EntityNavigation.continueFollowingPath`'s node advance (.decomp EntityNavigation.java:221-251, read in
   * full; cloud unit referee-mob-avoid-panic). `Ai.closeTo`'s fixed 0.3 radius makes the mob steer onto
   * EVERY node's exact centre, so a diagonal (staircase) path zig-zags and a fast mob never holds its
   * cruise speed — panicrefcheck's wolf ran 8.0 b/s against the server's 8.61. Vanilla advances when
   * EITHER the mob is inside a box of half-width `nodeReachProximity` (`width > 0.75 ? width/2 : 0.75 -
   * width/2`) with |dy| < 1, OR `shouldJumpToNextNode`: a next node exists, the mob is within 2 blocks of
   * the current node's bottom centre and already past it along the path (dot product of (next - current)
   * and (mob - current) > 0). `canPathDirectlyThrough` is `false` for every ground `MobNavigation`, and
   * `canJumpToNextPathNode`'s danger/door node types are not tracked on this engine's path nodes (named).
   * Returns the new index.
   */
  Ai.advancePathNode = function (e, path, idx) {
    e.navPath = path; e.navIdx = idx;   // #5069: the live current-path record DoorInteractGoal reads (persists across ticks like a navigator's path; stale reads are bounded by the 2.25 cut-off)
    var n = path[idx];
    var w = e.width === undefined ? 0.6 : e.width;
    var prox = w > 0.75 ? w / 2 : 0.75 - w / 2;
    var cx = n.x + 0.5, cz = n.z + 0.5;
    if (Math.abs(e.x - cx) < prox && Math.abs(e.z - cz) < prox && Math.abs(e.y - n.y) < 1.0) return idx + 1;
    if (idx + 1 >= path.length) return idx;
    var dx = e.x - cx, dy = e.y - n.y, dz = e.z - cz;
    if (dx * dx + dy * dy + dz * dz >= 4.0) return idx;                    // Vec3d.isInRange(center, 2.0)
    var m = path[idx + 1];
    return ((m.x - n.x) * dx + (m.y - n.y) * dy + (m.z - n.z) * dz) > 0 ? idx + 1 : idx;
  };

  // ════════════════════════════ 4. concrete goals ═════════════════════════════════════════════
  // ⚠ Each takes the synthetic entity object `e` the test harness (or, later, EntityList) built.
  // None of these read the keyboard or the DOM; all state lives on `e` or the goal's own closure.

  /** `LivingEntity.FloatGoal` — priority 0 in vanilla, MOVE|JUMP. Generic accel; see D-note below. */
  Ai.FLOAT_ACCEL = 0.04;   // = `Ph.SWIM_UP`; `LivingEntity.jumpInLiquid` adds it to the Y delta.
  Ai.FLOAT_CHANCE = 0.8;   // `FloatGoal.tick`: `if (random.nextFloat() < 0.8F) jumpControl.jump()`
  /**
   * ⚠ D-417 — THIS GOAL NO LONGER TOUCHES VELOCITY. `FloatGoal.tick` is one line in vanilla and
   * it is a JUMP REQUEST, not a push: the 0.04 lives in `LivingEntity.jumpInLiquid`, which is
   * `Ph.travelMob`'s water branch. Writing `e.vy` here meant a floating mob rose whether or not
   * the travel step had run, which is the same class of bug as the teleporting `stepToward`.
   */
  Ai.FloatGoal = function (e, rand) {
    var random = rand || Ai.rndOf(e);
    this.canUse = function () { return !!e.inWater; };
    this.canContinueToUse = this.canUse;
    this.start = function () {};
    this.stop = function () {};
    this.tick = function () {
      if (random() < Ai.FLOAT_CHANCE) e.jumping = true;
    };
  };

  /**
   * `PowderSnowJumpGoal` (`.decomp/.../ai/goal/PowderSnowJumpGoal.java`, whole class): JUMP control,
   * runs every tick; `canStart` = (`wasInPowderSnow || inPowderSnow`) && type in tag
   * `powder_snow_walkable_mobs` (EntityTypeTagProvider: rabbit, endermite, silverfish, fox) && the
   * block above the feet is powder_snow or has an empty collision shape. `tick` = `jumpControl.setActive()`.
   * This engine has no `Entity.inPowderSnow` (`PowderSnowBlock.onEntityCollision` -> `setInPowderSnow`),
   * so it is derived here: any powder_snow cell overlapping the box (shrunk 1e-3, as
   * `checkBlockCollision`), remembered one tick as `wasInPowderSnow`.
   */
  Ai.POWDER_SNOW_WALKABLE = { rabbit: 1, endermite: 1, silverfish: 1, fox: 1 };
  var psBlockId = null;
  function snowId() {
    if (psBlockId === null && NS.Reg && NS.Reg.names) psBlockId = NS.Reg.names.indexOf('powder_snow');
    return psBlockId === null ? -1 : psBlockId;
  }
  Ai.PowderSnowJumpGoal = function (e) {
    var was = false;
    function touching() {
      var psId = snowId();
      if (psId < 0) return false;
      var hw = (e.width || 0.6) / 2 - 0.001, ht = (e.height || 1.8) - 0.001;
      var x0 = Math.floor(e.x - hw), x1 = Math.floor(e.x + hw);
      var y0 = Math.floor(e.y + 0.001), y1 = Math.floor(e.y + ht);
      var z0 = Math.floor(e.z - hw), z1 = Math.floor(e.z + hw);
      for (var x = x0; x <= x1; x++) for (var y = y0; y <= y1; y++) for (var z = z0; z <= z1; z++) {
        var st = stateAt(x, y, z);
        if (st > 0 && NS.States.block[st] === psId) return true;
      }
      return false;
    }
    this.canUse = function () {
      var now = touching();
      var inSnow = was || now;
      was = now;
      if (!inSnow || !Ai.POWDER_SNOW_WALKABLE[e.type]) return false;
      var st = stateAt(Math.floor(e.x), Math.floor(e.y) + 1, Math.floor(e.z));
      return st <= 0 || NS.States.block[st] === snowId() || !NS.Physics.solidAt(Math.floor(e.x), Math.floor(e.y) + 1, Math.floor(e.z));
    };
    this.canContinueToUse = this.canUse;
    this.start = function () {};
    this.stop = function () {};
    this.tick = function () { e.jumping = true; };
  };

  /**
   * Vanilla's `EscapeDangerGoal` (`.decomp/net/minecraft/entity/ai/goal/EscapeDangerGoal.java`, whole
   * class read; cloud unit referee-mob-avoid-panic). The old body was a hand-made stand-in ("run
   * PANIC_DIST=8 blocks straight AWAY from the hurt source, once per hit") — panicrefcheck's 11 reds
   * (a burning cow moving 81% of ticks at 1.76 b/s vs the server's 97% at 6.9 b/s) were its cause:
   * vanilla has no away-from-source term at all, and re-panics every time the path runs out for as
   * long as the danger lasts. Ported line for line:
   *  - `canStart`: `isInDanger()` = `getAttacker() != null || shouldEscapePowderSnow() || isOnFire()`
   *    (`Fl.attackerOf` is this engine's `getAttacker`, the 100-tick window; `e.justHurt` is its
   *    same-tick half for callers that never reach `Cb.notifyHurt`; powder snow does not exist here,
   *    named). On fire: `locateClosestWater(5)` first (`Fl.locateClosestWater`), else `findTarget()`.
   *  - `findTarget`: `NoPenaltyTargeting.find(mob, 5, 4)` — `FuzzyPositions.guessBestPathTarget`: 10
   *    `localFuzz(rand, 5, 4)` offsets from the mob's own position, each kept only if `tryMake`
   *    passes (height valid, `EntityNavigation.isValidPosition` = the block below is solid, no path
   *    penalty), the highest `getPathfindingFavor` wins (strict `>`), `Vec3d.ofBottomCenter`.
   *    (`towardTarget`'s leash-home pull and `isPositionTargetOutOfWalkRange` need a position target,
   *    which no `Ai.PanicGoal` caller has — named, not reproduced.)
   *  - `start`: `navigation.startMovingTo(target, speed)`; `shouldContinue`: `!navigation.isIdle()`.
   */
  Ai.PANIC_FIND_H = 5;   // EscapeDangerGoal.findTarget: NoPenaltyTargeting.find(mob, 5, 4)
  Ai.PANIC_FIND_V = 4;
  /** `Entity.shouldEscapePowderSnow` = (inPowderSnow || wasInPowderSnow) && canFreeze (`freeze_immune_entity_types`:
   *  stray, polar_bear, snow_golem). Derived from the feet block (as `Undead.isInPowderSnow`); `wasInPowderSnow` not tracked. */
  Ai.FREEZE_IMMUNE = { stray: 1, polar_bear: 1, snow_golem: 1 };
  /** Entity.canFreeze overrides (not tag members): SkeletonEntity.canFreeze() = false (it converts to a stray instead). */
  Ai.canFreeze = function (e) { return !Ai.FREEZE_IMMUNE[e.type] && e.type !== 'skeleton'; };
  Ai.shouldEscapePowderSnow = function (e) {
    if (typeof e.shouldEscapePowderSnow === 'function') return !!e.shouldEscapePowderSnow();
    return Ai.canFreeze(e) && !!(NS.Undead && NS.Undead.isInPowderSnow && NS.Undead.isInPowderSnow(e));
  };
  Ai.PanicGoal = function (e, speed, opts) {
    var rand = (opts && opts.random) || Ai.rndOf(e);
    var favor = (opts && opts.favor) || Ai.animalPathfindingFavor;
    var path = null, idx = 1, tx = 0, ty = 0, tz = 0;
    function inDanger() {
      if (opts && opts.inDanger) return opts.inDanger();                    // a subclass's own isInDanger override
      var Fl = NS.Fly;
      return !!e.justHurt || !!(Fl && Fl.attackerOf ? Fl.attackerOf(e) : e.lastHurtByEntity) || Ai.shouldEscapePowderSnow(e) || !!e.isOnFire;
    }
    function tryMake(ox, oy, oz) {
      var x = Math.floor(e.x) + ox, y = Math.floor(e.y) + oy, z = Math.floor(e.z) + oz;
      if (y < -64 || y > 319) return null;                                  // isHeightInvalid
      var Ph = NS.Physics;
      if (!Ph.solidAt(x, y - 1, z)) return null;                             // isValidPosition: block below
      if (Ai.pathPenalty(e, Ai.pathTypeAt(x, y, z)) !== 0) return null;      // hasPathfindingPenalty
      return { x: x, y: y, z: z };
    }
    function findTarget() {
      var best = null, bestScore = -Infinity, H = Ai.PANIC_FIND_H, V = Ai.PANIC_FIND_V;
      for (var i = 0; i < 10; i++) {
        var ox = Math.floor(rand() * (2 * H + 1)) - H;                       // FuzzyPositions.localFuzz
        var oy = Math.floor(rand() * (2 * V + 1)) - V;
        var oz = Math.floor(rand() * (2 * H + 1)) - H;
        var p = tryMake(ox, oy, oz);
        if (!p) continue;
        var s = favor(p.x, p.y, p.z);
        if (s > bestScore) { bestScore = s; best = p; }
      }
      if (!best) return false;
      tx = best.x + 0.5; ty = best.y; tz = best.z + 0.5;                   // Vec3d.ofBottomCenter
      return true;
    }
    this.canUse = function () {
      if (!inDanger()) return false;
      if (e.isOnFire && NS.Fly && NS.Fly.locateClosestWater) {
        var wp = NS.Fly.locateClosestWater(e);
        if (wp) { tx = wp.x; ty = wp.y; tz = wp.z; return true; }
      }
      return findTarget();
    };
    this.canContinueToUse = function () {
      if (opts && opts.stopWhen && opts.stopWhen()) { path = null; return false; }   // PandaEscapeDangerGoal.shouldContinue: stop navigation, false while sitting
      return !!path && idx < path.length;
    };
    this.start = function () {
      e.justHurt = false;
      path = Ai.findPath(e.x, e.y, e.z, tx, ty, tz, { mob: e });
      idx = 1;
    };
    this.stop = function () { path = null; };
    this.tick = function () {
      if (!path || idx >= path.length) { this.stop(); return; }
      Ai.stepToward(e, path[idx], speed);
      idx = Ai.advancePathNode(e, path, idx);
    };
  };

  /** Vanilla's `WaterAvoidingRandomStrollGoal` — a land mob never picks a WATER cell to wander to. */
  Ai.STROLL_TRIES = 10;
  Ai.STROLL_RADIUS = 7;
  // `WanderAroundGoal(mob, speed)` -> chance 120 (.decomp WanderAroundGoal.java:20-21); canStart rolls
  // `nextInt(toGoalTicks(120)) = nextInt(60)` (Goal.java:47-51), and `MobEntity.tickNewAi` (:687-700)
  // runs goal SELECTION only every other tick -- 1/60 per selection = 1/120 per tick. This engine's
  // selector asks every tick, so the per-tick rate is carried here. (Was 1/50, a guess: a cat 9 blocks
  // from a creeper wandered into its 6-block flee range in every rep; the server's cat sat still.)
  Ai.STROLL_CHANCE = 1 / 120;
  Ai.WaterAvoidingRandomStrollGoal = function (e, speed, rand, favor, chance) {
    var path = null, idx = 1, self = this;
    rand = rand || Ai.rndOf(e);
    var perTick = chance ? 1 / chance : Ai.STROLL_CHANCE;   // #1072: nextInt(toGoalTicks(chance)) per selection = 1/chance per tick
    this.canUse = function () {
      if (path) return false;
      if (self.forceChance) return true;   // ignoreChanceOnce: skips the despawn refusal AND the roll, as the jar's branch does
      // loop/despawn-s105: WanderAroundGoal.canStart (.decomp :42) -- `canDespawn &&
      // getDespawnCounter() >= 100` refuses; every 1.18.2 caller leaves canDespawn true.
      if ((e.despawnCounter | 0) >= 100) return false;
      return rand() < perTick;
    };
    this.canContinueToUse = function () { return !!path && idx < path.length; };
    this.start = function () {
      if (self.finder) {   // WanderAroundFarGoal's getWanderTarget: one finder call -> one pathTo
        var ft = self.finder();
        // #1495: `startMovingTo` keeps the path to the closest reachable node (FuzzyTargeting never asked if the target is reachable)
        var pt = ft && Ai.findPath(e.x, e.y, e.z, ft.x, ft.y, ft.z, { mob: e, partial: true });
        if (pt && pt.length > 1) { path = pt; idx = 1; return; }
        path = null; return;
      }
      // `favor` (a mob's `getPathfindingFavor`, e.g. mooshroom on mycelium): FuzzyPositions.guessBest
      // evaluates ALL 10 candidates and keeps the highest score (strict `>`, so the first wins ties).
      var bestScore = -Infinity, bx = 0, bgy = 0, bz = 0, found = false;
      for (var t = 0; t < Ai.STROLL_TRIES; t++) {
        var ang = rand() * Math.PI * 2, r = 2 + rand() * Ai.STROLL_RADIUS;
        var tx = e.x + Math.cos(ang) * r, tz = e.z + Math.sin(ang) * r;
        var gy = Ai.groundLevel(Math.floor(tx), Math.floor(e.y) + 1, Math.floor(tz), 4, e);
        if (gy === null) continue;
        // s119: NavigationConditions.hasPathfindingPenalty (NoPenaltyTargeting, WanderAroundGoal's
        // own target finder): ANY non-zero penalty for THIS mob rejects the target — water (8)
        // for a land mob as before, and now fire, danger borders, honey... by the mob's own table.
        if (Ai.pathPenalty(e, Ai.pathTypeAt(Math.floor(tx), gy, Math.floor(tz))) !== 0) continue;
        if (favor) {
          var sc = favor(Math.floor(tx), gy, Math.floor(tz));
          if (sc > bestScore) { bestScore = sc; bx = tx; bgy = gy; bz = tz; found = true; }
          continue;
        }
        var p = Ai.findPath(e.x, e.y, e.z, tx, gy, tz, { mob: e });
        if (p && p.length > 1) { path = p; idx = 1; return; }
      }
      if (found) {
        var pf = Ai.findPath(e.x, e.y, e.z, bx, bgy, bz, { mob: e });
        if (pf && pf.length > 1) { path = pf; idx = 1; return; }
      }
      path = null;
    };
    this.stop = function () { path = null; };
    this.tick = function () {
      if (!path || idx >= path.length) { this.stop(); return; }
      Ai.stepToward(e, path[idx], speed);
      if (Ai.closeTo(e, path[idx])) idx++;
    };
  };

  /**
   * `StriderEntity.GoBackToLavaGoal(strider, speed)` = `MoveToTargetPosGoal(mob, speed, 8, 2)` (.decomp
   * MoveToTargetPosGoal.java + StriderEntity.java:471-500, read whole). canStart: `!isInLava` and the
   * cooldown (200 + nextInt(200), then `findTargetPos`) -- a lava block within the 8-range / y+-2 scan
   * (the jar's own alternating-sign loop order) with a `canPathfindThrough(LAND)` block above it.
   * Path resets every 20 ticks of trying; stops on entering lava or when the target stops qualifying.
   */
  Ai.GoBackToLavaGoal = function (e, speed, rand) {
    rand = rand || Ai.rndOf(e);
    var cooldown = 0, tryingTime = 0, safeWaiting = 0, tx = 0, ty = 0, tz = 0, path = null, idx = 1;
    function isTarget(x, y, z) {
      var Ph = NS.Physics, S = NS.States, R = NS.Reg;
      if (!Ph || !S || !S.block || !R) return false;
      if (S.block[Ph.blockAt(x, y, z)] !== R.id.lava) return false;
      return Ai.canPathfindThroughLand(Ph.blockAt(x, y + 1, z), x, y + 1, z);
    }
    function findTargetPos() {
      var bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z), range = 8, maxY = 2;
      for (var dy = 0; dy <= maxY; dy = dy > 0 ? -dy : 1 - dy)
        for (var r = 0; r < range; r++)
          for (var dx = 0; dx <= r; dx = dx > 0 ? -dx : 1 - dx)
            for (var dz = (dx < r && dx > -r) ? r : 0; dz <= r; dz = dz > 0 ? -dz : 1 - dz)
              if (isTarget(bx + dx, by + dy - 1, bz + dz)) { tx = bx + dx; ty = by + dy - 1; tz = bz + dz; return true; }
      return false;
    }
    function moveTo(y) { path = Ai.findPath(e.x, e.y, e.z, tx + 0.5, y, tz + 0.5, { mob: e, partial: true }); /* vanilla paths to the closest reachable node too */ idx = 1; }
    this.canUse = function () {
      if (e.inLava) return false;
      if (cooldown > 0) { cooldown--; return false; }
      cooldown = 200 + Math.floor(rand() * 200);
      return findTargetPos();
    };
    this.canContinueToUse = function () { return !e.inLava && isTarget(tx, ty, tz); };
    this.start = function () {
      moveTo(ty + 1);                                                        // start(): targetPos.getY() + 1
      tryingTime = 0;
      safeWaiting = Math.floor(rand() * (Math.floor(rand() * 1200) + 1200)) + 1200;
    };
    this.stop = function () { path = null; };
    this.tick = function () {
      var ddx = tx + 0.5 - e.x, ddy = ty + 0.5 - e.y, ddz = tz + 0.5 - e.z;
      if (ddx * ddx + ddy * ddy + ddz * ddz > 1.0) {                        // getTargetPos() = pos, up() unused by the override
        tryingTime++;
        if (tryingTime % 20 === 0) moveTo(ty);                               // shouldResetPath
      } else tryingTime--;
      if (path && idx < path.length) {
        Ai.stepToward(e, path[idx], speed);
        if (Ai.closeTo(e, path[idx])) idx++;
      }
    };
  };

  /**
   * `WanderAroundGoal(mob, speed)` (.decomp WanderAroundGoal.java, read whole) -- pillager's own
   * priority-8 stroll (PillagerEntity.java:71). Same chance/despawn/target-finder as
   * `Ai.WaterAvoidingRandomStrollGoal` above (`NoPenaltyTargeting.find(mob, 10, 7)`, chance 120,
   * `despawnCounter >= 100` refusal); the ONE difference in the jar is `hasPassengers()`, which
   * refuses `canStart` and ends `shouldContinue` (`e.passenger`, a mounted illager's own rider).
   */
  Ai.WanderAroundGoal = function (e, speed, rand, chance, favor) {
    // #1072: `chance` is the ctor's own `chance` (guardian 80, default 120); `ignoreChanceOnce()` skips ONE roll
    // (WanderAroundGoal.canStart: `if (!ignoreChanceOnce) { despawn check; nextInt(toGoalTicks(chance)) }`).
    var inner = new Ai.WaterAvoidingRandomStrollGoal(e, speed, rand, favor, chance), forced = false;
    this.ignoreChanceOnce = function () { forced = true; };
    this.setFinder = function (f) { inner.finder = f; };   // a mob's own NoPenaltyTargeting.find scorer (guardian: water favor)
    this.canUse = function () {
      if (e.passenger) return false;
      if (forced) { forced = false; inner.forceChance = true; }
      var r = inner.canUse(); inner.forceChance = false; return r;
    };
    this.canContinueToUse = function () { return !e.passenger && inner.canContinueToUse(); };
    this.start = function () { inner.start(); };
    this.stop = function () { inner.stop(); };
    this.tick = function () { inner.tick(); };
  };


  /** `FuzzyTargeting.find(mob, h, v)` (guessBest over STROLL_TRIES localFuzz candidates); shared by WanderAroundFar and PiglinBrain.findGround. */
  Ai.fuzzyTarget = function (e, h, v, rand, favor, fuzzyValidate) {
    if (fuzzyValidate === undefined) fuzzyValidate = true;
    var S = NS.States, best = null, bestScore = -Infinity;
    for (var t = 0; t < Ai.STROLL_TRIES; t++) {
      var x = Math.floor(e.x + Math.floor(rand() * (2 * h + 1)) - h), y = Math.floor(e.y + Math.floor(rand() * (2 * v + 1)) - v),
          z = Math.floor(e.z + Math.floor(rand() * (2 * h + 1)) - h);
      if (y < NS.CFG.WORLD_MIN_Y || y > NS.CFG.WORLD_MAX_Y) continue;   // isHeightInvalid
      if (!isSolid(x, y - 1, z)) continue;                                                   // isInvalidPosition
      if (fuzzyValidate) {                                                                   // FuzzyTargeting.validate
        while (y < NS.CFG.WORLD_MAX_Y && isSolid(x, y, z)) y++;
        if (S.waterIn[stateAt(x, y, z)]) continue;                                           // isWaterAt
      }
      if (Ai.pathPenalty(e, Ai.pathTypeAt(x, y, z)) !== 0) continue;                        // hasPathfindingPenalty
      var sc = favor ? favor(x, y, z) : 0;
      if (sc > bestScore) { bestScore = sc; best = { x: x + 0.5, y: y, z: z + 0.5 }; }    // ofBottomCenter
    }
    return best;
  };

  /**
   * #1189: `WanderAroundFarGoal(mob, speed, probability)` (.decomp WanderAroundFarGoal.java:19-30). In water / a bubble
   * column: `FuzzyTargeting.find(mob, 15, 7)` (falling back to the NoPenalty finder); else `nextFloat() >= probability`
   * ? `FuzzyTargeting.find(mob, 10, 7)` : the NoPenalty finder (`Ai.WaterAvoidingRandomStrollGoal`'s own).
   * FuzzyTargeting.validate: localFuzz offset, `upWhile` solid, then refuse water / any path penalty at the cell.
   * ⚠ #1495 (Dan: "land animals STILL spawn in the ocean"): they did not spawn there, they WALKED there and never
   * came back. Both finders are `FuzzyPositions.guessBest` over 10 `localFuzz` candidates (.decomp FuzzyTargeting /
   * NoPenaltyTargeting / FuzzyPositions.java): `towardTarget` (mob pos + offset, no position target here),
   * `isHeightInvalid`, `isInvalidPosition` (the block below must be an opaque full cube - so a swimmer's candidates
   * are the sea FLOOR, then `upWhile` lifts them out of it), and the highest `favor` (`getPathfindingFavor`: an
   * AnimalEntity scores 10 on grass) wins. The old copy returned the FIRST hit with no floor test and no favor, and
   * the farm animals were not even on this goal - they ran the 2..9-block circle, so a pig more than ~9 blocks out
   * found no dry target and floated in the sea for good. `favor` is the mob's own (null = PathAwareEntity's 0).
   */
  Ai.WanderAroundFarGoal = function (e, speed, rand, probability, favor) {
    rand = rand || Ai.rndOf(e);
    if (probability === undefined) probability = 0.001;
    var inner = new Ai.WaterAvoidingRandomStrollGoal(e, speed, rand);
    function guessBest(h, v, fuzzyValidate) { return Ai.fuzzyTarget(e, h, v, rand, favor, fuzzyValidate); }
    inner.finder = function () {
      if (e.inWater) return guessBest(15, 7, true) || guessBest(10, 7, false);
      return rand() >= probability ? guessBest(10, 7, true) : guessBest(10, 7, false);
    };
    this.probability = probability;
    this.waterRadius = 15;
    this.dryRadius = 10;
    this.canUse = function () { return inner.canUse(); };
    this.canContinueToUse = function () { return inner.canContinueToUse(); };
    this.start = function () { inner.start(); };
    this.stop = function () { inner.stop(); };
    this.tick = function () { inner.tick(); };
  };

  /**
   * #1237: `MoveThroughVillageGoal(mob, speed, requiresNighttime, distance, canBreakDoors)` (.decomp
   * MoveThroughVillageGoal.java, read whole). canStart: night (when `requiresNighttime`), `isNearOccupiedPointOfInterest(pos, 6)`
   * (section Chebyshev <= 6 of an occupied `NS.Poi`), then `FuzzyTargeting.find(15, 7)` scored `-distSq(poi, mob)` of the
   * nearest unvisited occupied POI within 10 of the candidate (-inf when none / not near a POI), then a path to that POI
   * (fallback: a NoPenalty point within 10/7 of it). shouldContinue: moving and not within `width + distance` of the POI.
   * stop(): a reached/idle target joins `visited` (oldest dropped past 15). Door-passing is the nav's own `canBreakDoors` flag.
   */
  Ai.MoveThroughVillageGoal = function (e, speed, requiresNight, distance, canBreakDoors, rand) {
    rand = rand || Ai.rndOf(e);
    var path = null, idx = 1, target = null, visited = [];
    function isDay() { return !!(NS.Sky && NS.Sky.isDay && NS.Sky.isDay()); }
    function occupied() { return NS.Poi && NS.Poi.occupiedPositions ? NS.Poi.occupiedPositions() : []; }
    function sec(v) { return Math.floor(v) >> 4; }
    function nearOccupied(x, y, z, r) {
      var ps = occupied();
      for (var i = 0; i < ps.length; i++) {
        if (Math.max(Math.abs(sec(ps[i].x) - sec(x)), Math.abs(sec(ps[i].y) - sec(y)), Math.abs(sec(ps[i].z) - sec(z))) <= r) return true;
      }
      return false;
    }
    function nearestUnvisited(x, y, z) {
      var ps = occupied(), best = null, bd = 1e30;
      for (var i = 0; i < ps.length; i++) {
        var p = ps[i], dx = p.x - x, dy = p.y - y, dz = p.z - z, d = dx * dx + dy * dy + dz * dz;
        if (d > 100 || d >= bd) continue;
        var seen = false;
        for (var j = 0; j < visited.length; j++) if (visited[j].x === p.x && visited[j].y === p.y && visited[j].z === p.z) { seen = true; break; }
        if (!seen) { best = p; bd = d; }
      }
      return best;
    }
    function pathTo(x, y, z) {
      var p = Ai.findPath(e.x, e.y, e.z, x, y, z, { mob: e, canBreakDoors: canBreakDoors() });
      return p && p.length > 1 ? p : null;
    }
    this.canUse = function () {
      if (visited.length > 15) visited.shift();
      if (requiresNight && isDay()) return false;
      var bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
      if (!nearOccupied(bx, by, bz, 6)) return false;
      var best = -Infinity, cand = null;
      for (var t = 0; t < Ai.STROLL_TRIES; t++) {
        var x = bx + Math.floor(rand() * 31) - 15, y = by + Math.floor(rand() * 15) - 7, z = bz + Math.floor(rand() * 31) - 15;
        while (y < 256 && isSolid(x, y, z)) y++;
        if (Ai.pathPenalty(e, Ai.pathTypeAt(x, y, z)) !== 0) continue;
        if (!nearOccupied(x, y, z, 1)) continue;
        var poi = nearestUnvisited(x, y, z);
        if (!poi) continue;
        var dx = poi.x - bx, dy = poi.y - by, dz = poi.z - bz, sc = -(dx * dx + dy * dy + dz * dz);
        if (sc > best) { best = sc; cand = { x: x, y: y, z: z }; }
      }
      if (!cand) return false;
      target = nearestUnvisited(cand.x, cand.y, cand.z);
      if (!target) return false;
      path = pathTo(target.x + 0.5, target.y, target.z + 0.5);
      if (!path) {
        for (var k = 0; k < Ai.STROLL_TRIES && !path; k++) {   // NoPenaltyTargeting.findTo(10, 7, target, PI/2)
          var ang = rand() * Math.PI * 2, r = rand() * 10;
          var tx = target.x + 0.5 + Math.cos(ang) * r, tz = target.z + 0.5 + Math.sin(ang) * r;
          var gy = Ai.groundLevel(Math.floor(tx), target.y + 1, Math.floor(tz), 4, e);
          if (gy === null || Ai.pathPenalty(e, Ai.pathTypeAt(Math.floor(tx), gy, Math.floor(tz))) !== 0) continue;
          path = pathTo(tx, gy, tz);
        }
      }
      return !!path;
    };
    this.canContinueToUse = function () {
      if (!path || idx >= path.length || !target) return false;
      var dx = target.x + 0.5 - e.x, dy = target.y + 0.5 - e.y, dz = target.z + 0.5 - e.z, r = (e.width || 0.6) + distance;
      return dx * dx + dy * dy + dz * dz >= r * r;
    };
    this.start = function () { idx = 1; };
    this.stop = function () {
      if (target) {
        var dx = target.x + 0.5 - e.x, dy = target.y + 0.5 - e.y, dz = target.z + 0.5 - e.z;
        if (!path || idx >= path.length || dx * dx + dy * dy + dz * dz <= distance * distance) visited.push(target);
      }
      path = null;
    };
    this.tick = function () {
      if (!path || idx >= path.length) return;
      Ai.stepToward(e, path[idx], speed);
      if (Ai.closeTo(e, path[idx])) idx++;
    };
  };

  /**
   * #1072: MobEntity's position target (.decomp MobEntity.java:117-118,1090-1127): `e.positionTarget` {x,y,z} block
   * coords + `e.positionTargetRange` (-1 = none). `isInWalkTargetRange` is `getSquaredDistance(pos) < range^2`
   * (strict), true when no target is set. `setPositionTarget(e, pos, range)` is the ctor-side `setPositionTarget(BlockPos, int)`.
   */
  Ai.setPositionTarget = function (e, pos, range) {
    e.positionTarget = { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
    e.positionTargetRange = range;
  };
  Ai.clearPositionTarget = function (e) { e.positionTargetRange = -1; };
  Ai.hasPositionTarget = function (e) { return e.positionTargetRange !== undefined && e.positionTargetRange !== -1; };
  Ai.isInWalkTargetRange = function (e, pos) {
    if (!Ai.hasPositionTarget(e)) return true;
    var p = pos || { x: Math.floor(e.x), y: Math.floor(e.y), z: Math.floor(e.z) }, t = e.positionTarget;
    var dx = t.x - p.x, dy = t.y - p.y, dz = t.z - p.z;
    return dx * dx + dy * dy + dz * dz < e.positionTargetRange * e.positionTargetRange;
  };
  /**
   * `NoPenaltyTargeting.findTo(mob, 16, 7, ofBottomCenter(positionTarget), PI/2)` + `FuzzyPositions.localFuzz/
   * towardTarget/guessBest` (.decomp, read whole): 10 tries of a directional fuzz toward the target, `towardTarget`
   * nudging by nextInt(horizontal/2), rejecting a height outside the world, a position outside the walk range and a
   * penalised cell; first best by `getPathfindingFavor` (default 0, strict `>` so the first valid wins).
   */
  Ai.findTowardPositionTarget = function (e, rand, horiz, vert, angle, to, favor) {   // favor(x,y,z)->score: guessBest keeps the strict-> best of all 10 tries   // `to` {x,y,z} exact point: findTo(mob,h,v,Vec3d,angle), no walk-range test
    var t = to ? { x: to.x - 0.5, y: to.y - 0.5, z: to.z - 0.5 } : e.positionTarget, dx = t.x + 0.5 - e.x, dz = t.z + 0.5 - e.z, inRange = false;
    if (!to && Ai.hasPositionTarget(e)) {   // NavigationConditions.isPositionTargetInRange: isWithinDistance(pos, range + horiz + 1)
      var ry = t.y + 0.5 - e.y, rd = e.positionTargetRange + horiz + 1; inRange = dx * dx + ry * ry + dz * dz < rd * rd;
    }
    var base = Math.atan2(dz, dx) - Math.PI / 2, best = null, bestScore = -Infinity;
    for (var i = 0; i < 10 && (favor || !best); i++) {
      var a = base + (2 * Math.fround(rand()) - 1) * angle;
      var r = Math.sqrt(rand()) * Math.SQRT2 * horiz;
      var ox = Math.trunc(-r * Math.sin(a)), oz = Math.trunc(r * Math.cos(a));
      if (Math.abs(ox) > horiz || Math.abs(oz) > horiz) continue;
      var oy = Math.floor(rand() * (2 * vert + 1)) - vert;
      if (horiz > 1) {
        ox += e.x > t.x ? -Math.floor(rand() * (horiz >> 1)) : Math.floor(rand() * (horiz >> 1));
        oz += e.z > t.z ? -Math.floor(rand() * (horiz >> 1)) : Math.floor(rand() * (horiz >> 1));
      }
      var bx = Math.floor(e.x + ox), by = Math.floor(e.y + oy), bz = Math.floor(e.z + oz);
      if (by < -64 || by > 256) continue;                                    // isHeightInvalid
      if (inRange && !Ai.isInWalkTargetRange(e, { x: bx, y: by, z: bz })) continue;   // isPositionTargetOutOfWalkRange
      if (Ai.pathPenalty(e, Ai.pathTypeAt(bx, by, bz)) !== 0) continue;      // hasPathfindingPenalty
      var sc = favor ? favor(bx, by, bz) : 0;
      if (sc > bestScore) { bestScore = sc; best = { x: bx + 0.5, y: by, z: bz + 0.5 }; }
    }
    return best;
  };
  /** `GoToWalkTargetGoal(mob, speed)` (.decomp, read whole): MOVE; walks to a `findTo` point when outside the position-target range. */
  Ai.GoToWalkTargetGoal = function (e, speed, rand) {
    var path = null, idx = 1, tx = 0, ty = 0, tz = 0;
    rand = rand || Ai.rndOf(e);
    this.canUse = function () {
      if (Ai.isInWalkTargetRange(e)) return false;
      var p = Ai.findTowardPositionTarget(e, rand, 16, 7, Math.PI / 2);
      if (!p) return false;
      tx = p.x; ty = p.y; tz = p.z; return true;
    };
    this.canContinueToUse = function () { return !!path && idx < path.length; };
    this.start = function () { path = Ai.findPath(e.x, e.y, e.z, tx, ty, tz, { mob: e, partial: true }); idx = 1; };
    this.stop = function () { path = null; };
    this.tick = function () {
      if (!path || idx >= path.length) { path = null; return; }
      Ai.stepToward(e, path[idx], speed);
      idx = Ai.advancePathNode(e, path, idx);
    };
  };

  /**
   * Turn to face a nearby player. Pure LOOK — no movement.
   *
   * ⚠ THE RANGE IS A CONSTRUCTOR ARGUMENT IN VANILLA AND IT IS NOT ALWAYS 8 (D-423). 8 is
   * `LookAtPlayerGoal`'s own default; cow passes 6.0F, refereed off `bij.u()`. A goal that
   * hard-coded the default would make every cow in the game notice you two blocks early.
   */
  Ai.LOOK_RANGE = 8;
  // LookAtEntityGoal.canStart/shouldContinue/start/tick: 0.02 roll, nearest by 3D distance from the eye
  // (squared <= range^2), lookTime = 40 + nextInt(40) counted down in tick, continue while lookTime > 0.
  Ai.LookAtPlayerGoal = function (e, getPlayers, range, rand, chance) {
    chance = (chance === undefined) ? 0.02 : chance;   // LookAtEntityGoal's 4th ctor arg (default 0.02F)
    var look = (range === undefined || range === null) ? Ai.LOOK_RANGE : range;
    rand = rand || Ai.rndOf(e);
    var target = null, lookTime = 0;
    function dist2(p) {
      var dx = p.x - e.x, dy = p.y - (e.y + Ai.eyeOf(e)), dz = p.z - e.z;
      return dx * dx + dy * dy + dz * dz;
    }
    this.canUse = function () {
      if (rand() >= chance) return false;
      var ps = getPlayers(), best = look * look, found = null;
      for (var i = 0; i < ps.length; i++) {
        var d = dist2(ps[i]);
        if (d <= best) { best = d; found = ps[i]; }
      }
      target = found;
      return found !== null;
    };
    this.canContinueToUse = function () {
      return !!target && !target.dead && !target.removed && dist2(target) <= look * look && lookTime > 0;
    };
    this.start = function () { lookTime = 40 + Math.floor(rand() * 40); };
    this.stop = function () { target = null; };
    // ⚠ D-422 — THIS GOAL USED TO WRITE `e.yaw`, THE BODY YAW, AND THAT WAS THE BUG. Vanilla's
    // `LookAtPlayerGoal.tick` is one line and it is a REQUEST: `mob.getLookControl().setLookAt(
    // target, ...)`. The control decides how fast the head may turn, how far it may turn, and
    // whether the body follows; a goal that turns the mob itself has taken all three decisions
    // away from it. What shipped snapped a cow's whole body round in a single tick the instant
    // a player came within range.
    this.tick = function () {
      lookTime--;
      if (!target || !e.look) return;
      e.look.setLookAt(target.x, target.y + Ai.eyeOf(target), target.z);
    };
  };

  /** `LookAtEntityGoal(mob, MobEntity.class, range)` -- the same look goal as `Ai.LookAtPlayerGoal`
   *  over every other live mob (anything in `Ai.ROSTER`, not self, not the player). */
  Ai.LookAtMobGoal = function (e, ctx, range, onlyType, rand) {
    Ai.LookAtPlayerGoal.call(this, e, function () {
      var out = [], all = ctx.entities ? ctx.entities() : [];
      for (var i = 0; i < all.length; i++) {
        var o = all[i];
        if (o && o !== e && o !== NS.Player && !o.dead && !o.removed && Ai.ROSTER[o.type] && (!onlyType || o.type === onlyType)) out.push(o);
      }
      return out;
    }, range, rand);
  };

  /** Idle head-turn when nothing else claims LOOK. */
  Ai.RandomLookAroundGoal = function (e, rand) {
    rand = rand || Ai.rndOf(e);
    this.canUse = function () { return rand() < 0.02; };
    this.canContinueToUse = function () { return false; };   // one nudge, then re-roll next tick
    // ⚠ RADIANS (D-415): the nudge is +-30 DEGREES, which is +-pi/6 — written as a radian
    // constant because `e.yaw` is radians, not as `60` in a field that is not degrees.
    // ⚠ D-422 — AND SO DID THIS ONE. An idle look-around is a HEAD turn in vanilla
    // (`RandomLookAroundGoal` sets a look target one block away and lets the control take it),
    // so the nudge is aimed at a point beside the mob rather than written into its body yaw.
    // Written as a point rather than an angle because that is the only thing a look control
    // accepts — which is the same reason the goal above cannot cheat either.
    this.start = function () {
      if (!e.look) return;
      var a = (e.yaw || 0) + (rand() - 0.5) * (Math.PI / 3);
      e.look.setLookAt(e.x + Math.sin(a), e.y + Ai.eyeOf(e), e.z - Math.cos(a));
    };
    this.stop = function () {};
    this.tick = function () {};
  };

  /**
   * Vanilla's `WolfBegGoal` (`.decomp/net/minecraft/entity/ai/goal/WolfBegGoal.java`, read in
   * full) — LOOK only (`setControls(EnumSet.of(Control.field_18406))`, the same LOOK flag
   * `LookAtEntityGoal` declares, confirmed against that class's own identical
   * `setControls` call). `canStart`: the nearest player within `begDistance` (8.0, wolf's own
   * `registerGoals()` literal) is "attractive" — holding a bone while TAMED, or holding
   * whatever this wolf's own breeding item is (either hand collapses to `p.heldItem`, the same
   * one-held-item simplification `Ai.TemptGoal` already uses project-wide). `start` sets
   * `e.begging` (a future renderer's own flag — no beg pose is drawn yet, a render-only gap,
   * the same standing every other cosmetic flag in this file already has) and arms a
   * `40 + [0,40)`-tick timer (`getTickCount`, not tick-rate-scaled — this engine has one fixed
   * tick rate, same simplification `LeapAtTargetGoal`'s own header already names).
   * `shouldContinue` re-checks distance, the timer, and attractiveness every tick, same as the
   * jar; `tick` re-aims LOOK at the begging player's eye height every tick.
   */
  Ai.WolfBegGoal = function (e, ctx, range) {
    var getPlayers = (ctx && ctx.players) || function () { return []; };
    var isTempting = (ctx && ctx.isTempting) || function () { return false; };
    var rand = (ctx && ctx.random) || Ai.rndOf(e);
    var begDist = range === undefined ? 8.0 : range;
    var begFrom = null, timer = 0;
    function isAttractive(p) {
      if (!p || !p.heldItem) return false;
      if (e.tamed && NS.Breed && NS.Breed.ready && NS.Breed.itemNameOf(p.heldItem) === 'bone') return true;
      return isTempting(p.heldItem);
    }
    this.canUse = function () {
      var ps = getPlayers();
      var best = null, bestD = Infinity;
      for (var i = 0; i < ps.length; i++) {
        var p = ps[i], d = Math.hypot(p.x - e.x, p.y - e.y, p.z - e.z);
        if (d <= begDist && d < bestD) { best = p; bestD = d; }
      }
      if (!best) return false;
      begFrom = best;
      return isAttractive(begFrom);
    };
    this.canContinueToUse = function () {
      if (!begFrom) return false;
      var d = Math.hypot(begFrom.x - e.x, begFrom.y - e.y, begFrom.z - e.z);
      if (d > begDist) return false;
      return timer > 0 && isAttractive(begFrom);
    };
    this.start = function () {
      e.begging = true;
      timer = 40 + Math.floor(rand() * 40);
    };
    this.stop = function () { e.begging = false; begFrom = null; };
    this.tick = function () {
      if (begFrom && e.look) e.look.setLookAt(begFrom.x, begFrom.y + Ai.eyeOf(begFrom), begFrom.z);
      timer--;
    };
  };

  /**
   * A hostile with a target paths to it and stays adjacent. The strike itself, as of D-394,
   * calls `Cb.mobAttack` — vanilla's `Mob.doHurtTarget` — once in reach and off cooldown; this
   * goal still owns getting there, which is what git 2a8efe1:docs/passes/PASS-16-HISTORY.md's acceptance list actually
   * asks ("a zombie paths around a wall to reach the player").
   *
   * ⚠ D-394 — THE STRIKE, WIRED. Vanilla's `MeleeAttackGoal.checkAndPerformAttack`:
   * `getAttackReachSqr(target) = mob.getBbWidth()*2 * mob.getBbWidth()*2 + target.getBbWidth()`
   * (public across every MCP/Yarn-mapped decompile of 1.18.2, and not a value this engine could
   * have derived from anything it already owns), compared against the FULL 3D squared distance
   * (`distanceToSqr`, not the horizontal `MELEE_REACH` above, which only gates the
   * path-adjacency loop), and only once `ticksUntilNextAttack <= 0`. A landed hit resets the
   * cooldown to vanilla's own literal `20` (`resetAttackCooldown`). ⚠ NOT re-walked against this
   * session's own bytecode — no fresh extractor was written for the reach/interval constants,
   * unlike the attack-damage row (`entity-attributes-1.18.2.tsv`, D-336) this reads; that
   * extraction is the remaining verification and is named on `Ai.OWED` rather than claimed.
   * `aicheck.mjs` §4 covers the wiring: the cooldown decrements every tick, resets to exactly 20
   * the instant a hit lands, and a target outside the reach formula (not just outside
   * `MELEE_REACH`) is never struck.
   */
  Ai.MELEE_REACH = 2;
  // #212: read from tools/golden/mobai-1.18.2.tsv (extract-mobai.mjs, MeleeAttackGoal bytecode);
  // the literals are only the fallback for a build with no golden.
  var MOB_AI = (NS.DATA && NS.DATA.mobAi) || {};
  Ai.MOB_ATTACK_INTERVAL = +MOB_AI['melee.attack_interval'] || 20;   // MeleeAttackGoal.resetCooldown(): getTickCount(20)
  var REACH_FACTOR = +MOB_AI['melee.reach_self_factor'] || 2;
  /** `MeleeAttackGoal.getSquaredMaxAttackDistance(target)`: (w*f)*(w*f) + targetWidth (#212, jar-verified). */
  Ai.attackReachSqr = function (e, target) {
    var ew = (e && e.width) || 0.6, tw = (target && target.width) || 0.6;
    return REACH_FACTOR * ew * REACH_FACTOR * ew + tw;
  };
  /**
   * `RavagerEntity.AttackGoal.getSquaredMaxAttackDistance` (RavagerEntity.java:346-350,
   * D-602 raiderroar): `(getWidth() - 0.1F) * 2 squared + target.getWidth()`, NOT
   * `Ai.attackReachSqr`'s own raw-width `4*ew*ew+tw` -- the ravager's own reach is therefore
   * slightly SHORTER than the generic formula would give it (named on this file's own raid-mob
   * OWED block until this pass; now real).
   */
  Ai.ravagerReachSqr = function (e, target) {
    var ew = ((e && e.width) || 0.6) - 0.1, tw = (target && target.width) || 0.6;
    return 4 * ew * ew + tw;
  };
  /**
   * `reachSqrFn(e, target)` (optional, 4th-callers only) overrides `Ai.attackReachSqr`'s own
   * generic formula -- D-602 raiderroar, `RavagerEntity.AttackGoal.getSquaredMaxAttackDistance`
   * (RavagerEntity.java:346-350) is the one live caller (`Ai.RAVAGER_REACH_SQR`, ROSTER.ravager,
   * below), the only vanilla `MeleeAttackGoal` subclass in this file's own six raid mobs that
   * overrides this method (D-394's own header already named the gap this closes). `onAttack(t)`
   * (optional, 5th) fires the same tick `NS.Combat.mobAttack` does, real target still valid --
   * `RavagerEntity.tryAttack`'s own `attackTick = 10` (RavagerEntity.java:298-304) is the one
   * live caller, wired through `Ai.RavagerRoarGoal`'s own timer rather than duplicating the
   * cooldown/path logic below a second time.
   */
  // s134: `intervalFn` — MeleeAttackTask(n)'s own cooldown (hoglin 40 / baby 15); omitted, the goal's 20.
  /** MeleeAttackGoal.tick's look + repath-countdown half (.decomp MeleeAttackGoal.java, #3665): lookAt(target,30,30); countdown-1;
   *  repath only when countdown<=0 AND (canSee || pauseWhenMobIdle) AND (no stored pos || target moved >=1 block (sq) || rand<0.05);
   *  then countdown = 4+nextInt(7) (+10 if distSq>1024, +5 if >256, +15 if no path). `st` = {cd,tx,ty,tz,path,idx}. */
  Ai.meleeNavTick = function (e, t, st, distSq, pause, random) {
    var ty = t.y === undefined ? e.y : t.y;
    if (e.look) e.look.setLookAt(t.x, ty + Ai.eyeOf(t), t.z, Ai.BOW_TURN, Ai.BOW_TURN);
    st.cd = Math.max(st.cd - 1, 0);
    if ((pause || Ai.canSee(e, t)) && st.cd <= 0 &&
        ((st.tx === 0 && st.ty === 0 && st.tz === 0) || (t.x - st.tx) * (t.x - st.tx) + (ty - st.ty) * (ty - st.ty) + (t.z - st.tz) * (t.z - st.tz) >= 1 || random() < 0.05)) {
      st.tx = t.x; st.ty = ty; st.tz = t.z;
      st.cd = 4 + Math.floor(random() * 7);
      if (distSq > 1024) st.cd += 10; else if (distSq > 256) st.cd += 5;
      st.path = Ai.findPath(e.x, e.y, e.z, t.x, t.y, t.z, { mob: e });
      st.idx = 1;
      if (!st.path) st.cd += 15;
    }
  };
  // #6256: the mob's last computed path (Path nodes), for the lockstep 'path' field.
  Ai.findPath = function (sx, sy, sz, tx, ty, tz, opts) {
    var p = findPathRaw(sx, sy, sz, tx, ty, tz, opts);
    if (opts && opts.mob) opts.mob.navPath = p;
    return p;
  };
  Ai.currentPath = function (e) {
    var p = e && e.navPath, out = [];
    if (p) for (var i = 0; i < p.length; i++) out.push([p[i].x, p[i].y, p[i].z]);
    return out;
  };
  // `pause` = MeleeAttackGoal's pauseWhenMobIdle ctor flag (#4439): repath without line of sight, shouldContinue = isInWalkTargetRange.
  Ai.MeleeAttackGoal = function (e, speed, reachSqrFn, onAttack, intervalFn, pause) {
    var pathFound = null, st = { cd: 0, tx: 0, ty: 0, tz: 0, path: null, idx: 1 }, atkCooldown = 0;
    var reach = reachSqrFn || Ai.attackReachSqr;
    var lastUpdate = -1e9;
    // MeleeAttackGoal.canStart: 20-tick throttle, target alive, path OR already in reach
    this.canUse = function () {
      var age = e.age || 0;
      if (age - lastUpdate < 20) return false;
      lastUpdate = age;
      var t = e.target;
      if (!t || t.dead || t.removed) return false;
      if ((pathFound = Ai.findPath(e.x, e.y, e.z, t.x, t.y, t.z, { mob: e }))) return true;   // start() moves along it
      var dx = t.x - e.x, dy = (t.y === undefined ? e.y : t.y) - e.y, dz = t.z - e.z;
      return dx * dx + dy * dy + dz * dz <= reach(e, t);
    };
    this.canContinueToUse = function () {
      var t = e.target;
      return !!t && !t.dead && !t.removed && !t.invulnerableGamemode && (!pause || Ai.isInWalkTargetRange(e, { x: Math.floor(t.x), y: Math.floor(t.y === undefined ? e.y : t.y), z: Math.floor(t.z) }));
    };
    // ⚠ D-429 — `MeleeAttackGoal.start()` is `this.mob.setAggressive(true)` and `stop()` is
    // `setAggressive(false)`, and that flag is not bookkeeping: `AbstractZombieModel` reads it
    // every frame and raises the arms from −80° to −120° while it is set. Transcribed, the same
    // standard as this goal's own reach formula (D-394) — the POSE it drives is refereed, in
    // `tools/extract-zombiearms.mjs`.
    this.start = function () { st.path = pathFound; st.idx = 1; st.cd = 0; atkCooldown = 0; e.aggressive = true; };
    this.stop = function () { st.path = null; e.aggressive = false; };
    this.getCooldown = function () { return atkCooldown; };
    this.tick = function () {
      if (!e.target) return;
      if (atkCooldown > 0) atkCooldown--;
      var t = e.target;
      var dx = t.x - e.x, dy = (t.y === undefined ? e.y : t.y) - e.y, dz = t.z - e.z;
      var distSq = dx * dx + dy * dy + dz * dz;
      if (distSq <= reach(e, t) && atkCooldown <= 0) {
        atkCooldown = intervalFn ? intervalFn() : Ai.MOB_ATTACK_INTERVAL;
        // QUEUE 0.2 — `MeleeAttackGoal.attack` (.decomp) swings BEFORE it hits, unconditionally:
        // `this.mob.swingHand(Hand.MAIN_HAND); this.mob.tryAttack($$0);`. `ER.swingHand` is
        // that class's bookkeeping (07j_entityrender.js, QUEUE 0.2); the renderer's own
        // `ER.tickHandSwing`/`getHandSwingProgress` turn it into `attackTime` every frame.
        if (NS.EntityRender && NS.EntityRender.swingHand) NS.EntityRender.swingHand(e);
        var hit = NS.Combat && NS.Combat.mobAttack ? NS.Combat.mobAttack(e, t) : null;
        if (onAttack) onAttack(t, hit);   // 2nd arg: the landed-hit result (DolphinEntity.tryAttack's sound is inside `if (damage)`)
      }
      Ai.meleeNavTick(e, t, st, distSq, !!pause, Ai.rndOf(e));
      if (st.path && st.idx < st.path.length) {
        Ai.stepToward(e, st.path[st.idx], speed);
        if (Ai.closeTo(e, st.path[st.idx])) st.idx++;
      }
    };
  };

  /** `ZombieAttackGoal` (#2826): MeleeAttackGoal + the arm-raise timing -- `setAttacking(true)` only once ticks>=5 AND
   *  cooldown < maxCooldown/2, else false (super.start() still sets it true; tick 1 overrides); stop() false. */
  Ai.ZombieAttackGoal = function (e, speed) {
    Ai.MeleeAttackGoal.call(this, e, speed);
    var ticks = 0, start = this.start, stop = this.stop, tick = this.tick, self = this;
    this.start = function () { start(); ticks = 0; };
    this.stop = function () { stop(); e.aggressive = false; };
    this.tick = function () {
      tick();
      ticks++;
      e.aggressive = ticks >= 5 && self.getCooldown() < Ai.MOB_ATTACK_INTERVAL / 2;
    };
  };

  /**
   * `BreakDoorGoal` (D-399, zombie only). #5069: `DoorInteractGoal.canStart` transcribed -- walks the
   * live path record (`e.navPath`/`e.navIdx`, set by `Ai.advancePathNode`), first min(index+2, length)
   * nodes, door at node.y+1, 2.25 sqr cut-off, then the block above the mob's feet.
   * `ctx.mobGriefing()` gates it on the now-live gamerule; the
   * HARD-difficulty half of vanilla's own gate is enforced as of D-400 (`ctx.isHard()`,
   * `NS.Diff` — 07l_spawn.js) — real, but nothing in play can set difficulty to HARD yet, since
   * no `/difficulty` command is registered (D-327, `Diff.OWED`).
   */
  Ai.DOOR_BREAK_TICKS = +MOB_AI['breakdoor.min_max_progress'] || 240;   // BreakDoorGoal.getMaxProgress() (#212, golden)
  Ai.BreakDoorGoal = function (e, ctx) {
    ctx = ctx || {};
    var door = null, progress = 0, prevStage = -1;
    var mobGriefing = ctx.mobGriefing || function () { return true; };
    // D-400: default true preserves this goal's own pre-D-400 behaviour for any caller (a test,
    // chiefly) that does not pass isHard — production wiring (`EL.aiCtx`) always does, reading
    // the real `NS.Diff` state, so the default only matters off the live path.
    var isHard = ctx.isHard || function () { return true; };
    var findDoor = ctx.doorAt || Ai.doorAt;
    var doBreak = ctx.breakDoor || Ai.breakDoor;
    // DoorInteractGoal.canStart: nodes 0..min(nodeIndex+2, length) of the live path, door at node.y+1,
    // skipped when the mob's (x, own y, z) is > 2.25 sqr from it; last resort the block above the mob's feet.
    function wood(p) { var d = findDoor(p.x, p.y, p.z); return !!(d && d.closed && !d.iron); }
    function scan() {
      var path = e.navPath;
      if (path && (e.navIdx | 0) < path.length) {
        var end = Math.min((e.navIdx | 0) + 2, path.length);
        for (var i = 0; i < end; i++) {
          var p = { x: path[i].x, y: path[i].y + 1, z: path[i].z };
          var dx = p.x - e.x, dz = p.z - e.z;   // squaredDistanceTo(doorPos.x, mob.y, doorPos.z): the block corner
          if (dx * dx + dz * dz > 2.25) continue;
          if (wood(p)) return p;
        }
      }
      var o = { x: Math.floor(e.x), y: Math.floor(e.y) + 1, z: Math.floor(e.z) };
      return wood(o) ? o : null;
    }
    this.canUse = function () {
      // s112: ZombieEntity.setCanBreakDoors adds/removes this goal — only a zombie that ROLLED
      // canBreakDoors (07zk_undead.js, initialize/leader bonus) carries it. `undefined` = a
      // hand-built test mob with no spawn roll, left as before.
      if (e.canBreakDoors === false) return false;
      if (!mobGriefing() || !isHard()) return false;
      // vanilla DoorInteractGoal.canStart: horizontalCollision, no target consulted (#4118);
      // `undefined` = hand-built test mob, left as before.
      if (e.horizontalCollision === false) return false;
      door = scan();
      return !!door;
    };
    this.canContinueToUse = function () {
      if (!mobGriefing() || !isHard() || !door) return false;
      // BreakDoorGoal.shouldContinue: doorPos within 2.0 of the mob (isWithinDistance: block centre, strict)
      var dx = door.x + 0.5 - e.x, dy = door.y + 0.5 - e.y, dz = door.z + 0.5 - e.z;
      if (dx * dx + dy * dy + dz * dz >= 4) return false;
      var d = findDoor(door.x, door.y, door.z);
      return !!(d && d.closed && !d.iron) && progress < Ai.DOOR_BREAK_TICKS;
    };
    this.start = function () { progress = 0; prevStage = -1; };
    // stop(): setBlockBreakingInfo(id, pos, -1). No world-level crack overlay for mobs exists, so
    // the stage is published on the mob (e.doorCrack, -1 = none) for whoever renders it.
    this.stop = function () { progress = 0; door = null; e.doorCrack = -1; };
    this.tick = function () {
      if (!door) return;
      if (Ai.rndOf(e)() * 20 < 1) {
        Ai.doorEvent(e, 'entity.zombie.attack_wooden_door', door.x, door.y, door.z);
        if (!e.handSwinging && NS.EntityRender && NS.EntityRender.swingHand) NS.EntityRender.swingHand(e);
      }
      progress++;
      var stage = Math.floor(progress / Ai.DOOR_BREAK_TICKS * 10);
      if (stage !== prevStage) { e.doorCrack = prevStage = stage; }
      if (progress === Ai.DOOR_BREAK_TICKS) doBreak(door.x, door.y, door.z, e);
    };
  };

  /**
   * D-602 (raidergoals) — `VindicatorEntity`'s own `BreakDoorGoal` inner class
   * (`.decomp/net/minecraft/entity/mob/VindicatorEntity.java:208-231`, read in full), reusing
   * `Ai.BreakDoorGoal`'s own core (immediately above) rather than re-typing it, with the THREE
   * overrides the jar's own subclass makes: (1) its own difficulty predicate
   * (`DIFFICULTY_ALLOWS_DOOR_BREAKING_PREDICATE`, VindicatorEntity.java:47) is
   * `Difficulty.field_5802 (NORMAL) || field_5807 (HARD)` — NOT `Ai.BreakDoorGoal`'s own
   * HARD-only gate zombie uses (`Difficulty.java:10-13` names the enum order this reads:
   * peaceful/easy/normal/hard — so PEACEFUL and EASY both still refuse, only the top HALF now
   * allows it, the inverse shape from zombie's own single-value gate); (2) `canStart` also
   * requires `hasActiveRaid()` (`Rd.raidOf`/`raidOngoing`, this file's own raider-shared
   * helpers, below) AND a `random.nextInt(toGoalTicks(10)) == 0` roll, collapsed to a flat
   * 1-in-10 per tick the same way every other `toGoalTicks` roll in this file already collapses
   * (`Ai.RaidGoal`'s own 200-tick cooldown header names the same non-alternating-GoalSelector
   * reasoning); (3) `shouldContinue` also requires `hasActiveRaid()`.
   * `start()` also `setDespawnCounter(0)` (VindicatorEntity.java:229) via `e.despawnCounter`.
   */
  Ai.VindicatorBreakDoorGoal = function (e, ctx) {
    ctx = ctx || {};
    var rand = ctx.random || Ai.rndOf(e);
    function doorBreakingAllowed() {
      var D = NS.Diff;
      if (!D) return true;
      return D.value === 'normal' || D.value === 'hard';   // Difficulty.field_5802 || field_5807
    }
    var base = new Ai.BreakDoorGoal(e, {
      mobGriefing: ctx.mobGriefing, isHard: doorBreakingAllowed,
      doorAt: ctx.doorAt, breakDoor: ctx.breakDoor
    });
    function active() { return raidOngoing(raidOf(e)); }
    this.canUse = function () {
      if (!active()) return false;
      if (rand() >= 0.1) return false;   // nextInt(toGoalTicks(10)) == 0, collapsed (see header)
      return base.canUse();
    };
    this.canContinueToUse = function () { return active() && base.canContinueToUse(); };
    this.start = function () { base.start(); e.despawnCounter = 0; };   // VindicatorEntity.BreakDoorGoal.start
    this.stop = base.stop;
    this.tick = base.tick;
  };

  /**
   * D-602 (raidergoals) — `VindicatorEntity.TargetGoal` (VindicatorEntity.java:233-248, read in
   * full): `ActiveTargetGoal<LivingEntity>(this, LivingEntity.class, 0, true, true,
   * LivingEntity::isMobOrPlayer)`, gated on `johnny` (`canStart(): johnny && super.canStart()`)
   * — the "Johnny" vindicator variant (NBT `Johnny: 1b`) attacks ANY nearby living entity, not
   * just the player. `isMobOrPlayer` is approximated as "every other live entity" (`ctx.
   * players()` plus every non-removed `NS.EntityList.list` member) — this engine tags no entity
   * a non-mob non-player LivingEntity would exclude (no armor stands, no item frames as living
   * entities), so the two sets coincide. ⚠ `e.johnny` IS NEVER SET — no mob NBT reader in this
   * engine writes the `Johnny` tag yet (mob-NBT save/load is `w3`'s own file), so this goal is
   * REAL but VACUOUS in live play today, named on `Ai.OWED` rather than silently wired as if it
   * fired, the same standing `Ai.RevengeGoal`'s own "ONE-PLAYER COLLAPSE" line already holds
   * itself to.
   */
  /** `VindicatorEntity.AttackGoal` (VindicatorEntity.java:192-206): MeleeAttackGoal(1.0, false) whose reach, while the
   *  vindicator rides a ravager, is the vehicle's `(width-0.1)*2` squared + target width. */
  Ai.VindicatorAttackGoal = function (e) {
    Ai.MeleeAttackGoal.call(this, e, 1.0, function (me, t) {
      var v = me.vehicle;
      if (v && v.type === 'ravager') { var w = (v.width || 1.95) - 0.1; return w * 2 * w * 2 + ((t && t.width) || 0.6); }
      return Ai.attackReachSqr(me, t);
    });
  };
  Ai.VindicatorTargetGoal = function (e, ctx) {
    ctx = ctx || {};
    var base = new Ai.NearestAttackableTargetGoal(e, function () {
      var out = (ctx.players ? ctx.players() : []).slice();
      var EL = NS.EntityList;
      if (EL && EL.list) {
        for (var i = 0; i < EL.list.length; i++) {
          var o = EL.list[i];
          // LivingEntity::isMobOrPlayer: a living type that is not an armor stand
          if (o && o !== e && !o.removed && !o.dead && o.type !== 'armor_stand' &&
              !(o.type === 'vindicator' || o.type === 'pillager' || o.type === 'evoker' || o.type === 'illusioner') &&   // VindicatorEntity.isTeammate: any illager
              NS.Entities && NS.Entities.isLiving(o.type)) out.push(o);
        }
      }
      return out;
    }, { sight: true, mustSee: true, livingBox: true, checkCanNavigate: true });   // TargetGoal: checkVisibility=true, checkCanNavigate=true
    this.canUse = function () {
      // VindicatorEntity.setCustomName latch, for every path that sets the name (NBT load, /summon, /data)
      if (e.customName === 'Johnny') e.johnny = true;
      return !!e.johnny && base.canUse();
    };
    this.canContinueToUse = base.canContinueToUse;
    this.start = function () { base.start(); e.despawnCounter = 0; };   // VindicatorEntity.TargetGoal.start
    this.stop = base.stop;
    this.tick = base.tick;
  };

  /**
   * `RaiderEntity.PatrolApproachGoal` (.decomp RaiderEntity.java:433-505), wired for vindicator
   * (priority 3, `.decomp/net/minecraft/entity/mob/VindicatorEntity.java:62`) and pillager
   * (priority 2, `.decomp/net/minecraft/entity/mob/PillagerEntity.java:70`), both
   * `new RaiderEntity.PatrolApproachGoal(this, 10.0F)` (`squaredDistance` = 100.0, cited from
   * BOTH callers, not guessed). `canStart`: no active raid (`getRaid()==null`), the raider's own
   * `isRaidCenterSet()` (PatrolEntity.java:126-128: `return this.patrolling`, read whole -- it is the
   * `patrolling` flag, NOT `hasPatrolTarget()`; `e.patrolling`, the field `Ai.PatrolGoal` and
   * `Ps.setRandomPatrolTarget` write and NBT `Patrolling` reads), a live `getTarget()`, not already
   * `isAttacking()` (`e.attacking`, the same flag `Ai.CrossbowAttackGoal` already writes), and
   * the last attacker (if any) is NOT the player (`EntityType.field_6097` == `NS.Player`, this
   * engine's one-player collapse, `07za_explosion.js`'s own `ent === NS.Player` convention).
   * `start()`/`stop()` alert every OTHER live raider within an 8-block radius of this raider
   * (`closeRaiderPredicate`, `TargetPredicate.createNonAttackable().setBaseMaxDistance(8.0)` --
   * an axis-aligned `expand(8,8,8)` box approximated as a flat radius, the same "expand -> a
   * radius" simplification `Ai.BreakDoorGoal`'s own scan already makes for a different box);
   * `stop()` additionally sets BOTH this raider and every alerted one `isAttacking()`. `tick()`
   * looks at the target every tick; while farther than `squaredDistance` it just watches
   * (`playAmbientSound()`, RaiderEntity.java:494, is skipped -- this engine has no per-mob
   * ambient-sound-loop substrate at all, `Ai.OWED`, not faked), and once within it sets
   * `isAttacking()` (which is what hands off to `Ai.MeleeAttackGoal`'s own reach, below).
   */
  Ai.PatrolApproachGoal = function (e, ctx) {
    ctx = ctx || {};
    var CLOSE_RADIUS_SQ = 8.0 * 8.0;
    var SQ_DIST = 10.0 * 10.0;   // both callers pass 10.0F (VindicatorEntity.java:62, PillagerEntity.java:70)
    function alertNearby(target) {
      var mates = raidersOf(e);
      for (var i = 0; i < mates.length; i++) {
        var o = mates[i];
        var dx = o.x - e.x, dy = o.y - e.y, dz = o.z - e.z;
        if (dx * dx + dy * dy + dz * dz > CLOSE_RADIUS_SQ) continue;
        o.target = target;
      }
    }
    this.canUse = function () {
      var attacker = e.lastHurtByEntity;
      return !raidOf(e) && !!e.patrolling && !!e.target && !e.attacking &&
        (!attacker || attacker !== NS.Player);
    };
    this.canContinueToUse = this.canUse;   // no shouldContinue override in .decomp -> defaults to canStart()
    this.start = function () { alertNearby(e.target); };
    this.stop = function () {
      var target = e.target;
      if (target) {
        alertNearby(target);
        e.attacking = true;
      }
    };
    this.tick = function () {
      var target = e.target;
      if (!target) return;
      var dx = target.x - e.x, dy = (target.y === undefined ? e.y : target.y) - e.y, dz = target.z - e.z;
      if (dx * dx + dy * dy + dz * dz <= SQ_DIST) e.attacking = true;
    };
  };

  /**
   * `DoorInteractGoal`/`LongDoorInteractGoal`/`IllagerEntity.LongDoorInteractGoal` (.decomp
   * `net/minecraft/entity/ai/goal/DoorInteractGoal.java`, `LongDoorInteractGoal.java`,
   * `net/minecraft/entity/mob/IllagerEntity.java:34-40`), vindicator-only (priority 2,
   * `.decomp/net/minecraft/entity/mob/VindicatorEntity.java:61`) -- open a wooden door, walk
   * through, close it once past. `canStart` (`DoorInteractGoal.java:50-74`) scans up to two
   * nodes AHEAD along the mob's live `MobNavigation` path for a wooden, non-iron door within 1.5
   * blocks -- this engine keeps no shared per-mob nav-path object any goal can read (each goal
   * owns its own local `path` closure: `Ai.MeleeAttackGoal`/`Ai.PatrolGoal`/
   * `Ai.MoveToRaidCenterGoal`, above), so this scans the mob's own four horizontal neighbours
   * instead -- the SAME simplification `Ai.BreakDoorGoal`'s own header already names, backed by
   * the SAME door-finder (`Ai.doorAt`) that goal already uses -- named on `Ai.OWED`, not hidden.
   * `MobNavigation.canEnterOpenDoors()`, which `VindicatorEntity.mobTick()` itself sets EVERY
   * tick off `hasRaidAt()` (`.decomp` VindicatorEntity.java:76-81), is folded into this goal's
   * own `hasActiveRaid()` gate below rather than modelled as a separate navigation flag -- this
   * engine's `Ai.findPath` has no per-call "may this mob path through a door" flag at all
   * (`Ai.OWED`, named once here rather than repeated).
   * `IllagerEntity.LongDoorInteractGoal(delayedClose=false)`: `start()` forces the door OPEN
   * immediately (`Ai.setDoorOpen`, above), `canStart` additionally requires `hasActiveRaid()`
   * (the vindicator's own override, `IllagerEntity.java:38-40`), `stop()` forces it CLOSED --
   * the base class's own dot-product "has the mob walked past the door" test
   * (`DoorInteractGoal.tick`, `offsetX*newOffsetX + offsetZ*newOffsetZ < 0`) decides when
   * `shouldContinue` goes false and `stop` fires, transcribed verbatim below.
   * ⚠ `DoorInteractGoal` itself declares NO `Goal.Control` (no `setControls` call anywhere in
   * its own `.decomp` body, read in full) -- wired with `flags=0` below so it never excludes,
   * and is never excluded by, `Ai.MeleeAttackGoal`/`Ai.PatrolGoal` running the SAME tick (unlike
   * `Ai.VindicatorBreakDoorGoal`, wired `Ai.MOVE` by an earlier pass -- that choice is this
   * file's own pre-existing one, not touched here).
   */
  Ai.LongDoorInteractGoal = function (e, ctx) {
    ctx = ctx || {};
    var findDoor = ctx.doorAt || Ai.doorAt;
    var setOpen = ctx.setDoorOpen || Ai.setDoorOpen;
    var door = null, offsetX = 0, offsetZ = 0, shouldStop = false;
    function scan() {
      var bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
      var offs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (var i = 0; i < offs.length; i++) {
        var dx = bx + offs[i][0], dz = bz + offs[i][1];
        var d = findDoor(dx, by, dz);
        if (d && d.wood && !d.iron) return { x: dx, y: by, z: dz };
      }
      return null;
    }
    this.canUse = function () {
      if (!e.horizontalCollision) return false;
      door = scan();
      return !!door;
    };
    this.canContinueToUse = function () { return !shouldStop; };
    this.start = function () {
      shouldStop = false;
      offsetX = (door.x + 0.5) - e.x;
      offsetZ = (door.z + 0.5) - e.z;
      setOpen(door.x, door.y, door.z, true);
    };
    this.stop = function () {
      if (door) setOpen(door.x, door.y, door.z, false);
      door = null;
    };
    this.tick = function () {
      if (!door) return;
      var nx = (door.x + 0.5) - e.x, nz = (door.z + 0.5) - e.z;
      if (offsetX * nx + offsetZ * nz < 0.0) shouldStop = true;
    };
  };
  /** `IllagerEntity.LongDoorInteractGoal.canStart`'s own `&& IllagerEntity.this.hasActiveRaid()`
   *  (IllagerEntity.java:38-40) -- the vindicator-only gate, wrapping the generic goal above the
   *  same way `Ai.VindicatorBreakDoorGoal` already wraps `Ai.BreakDoorGoal`. */
  Ai.VindicatorLongDoorInteractGoal = function (e, ctx) {
    var base = new Ai.LongDoorInteractGoal(e, ctx);
    this.canUse = function () { return raidOngoing(raidOf(e)) && base.canUse(); };
    this.canContinueToUse = function () { return raidOngoing(raidOf(e)) && base.canContinueToUse(); };
    this.start = base.start;
    this.stop = base.stop;
    this.tick = base.tick;
  };

  // D-602 raiderroar -- shared constants for `Ai.RavagerRoarGoal`/`Ai.ravagerAttackBlockedByShield`,
  // every one cited off `.decomp/net/minecraft/entity/mob/RavagerEntity.java`.
  Ai.RAVAGER_STUN_TICKS = 40;          // RavagerEntity.java:232/280 (knockback() and handleStatus(39))
  Ai.RAVAGER_ROAR_TICKS = 20;          // RavagerEntity.java:199 (roarTick set once stunTick hits 0)
  Ai.RAVAGER_ROAR_FIRE_AT = 10;        // RavagerEntity.java:185 (roarTick == 10 -> roar())
  Ai.RAVAGER_ROAR_RADIUS = 4.0;        // RavagerEntity.java:246 (getBoundingBox().expand(4.0))
  Ai.RAVAGER_ROAR_DAMAGE = 6.0;        // RavagerEntity.java:248
  Ai.RAVAGER_KNOCKBACK_STRENGTH = 4.0; // RavagerEntity.java:271 (private knockBack(Entity))
  Ai.RAVAGER_ATTACK_TICKS = 10;        // RavagerEntity.java:277/300 (handleStatus(4) / tryAttack)

  /** `RavagerEntity`'s own private `knockBack(Entity)` (RavagerEntity.java:267-272), transcribed
   *  verbatim: `addVelocity(dx/d*4.0, 0.2, dz/d*4.0)` is a DIRECT add, not `Cb.knockback`'s own
   *  halving-plus-resistance formula (`14j_combat.js`'s own header on that difference) -- a
   *  distinct, un-resisted push, so it is its own function rather than a `Cb.knockback` call. */
  Ai.ravagerKnockBack = function (e, target) {
    var dx = target.x - e.x, dz = target.z - e.z;
    var d = Math.max(dx * dx + dz * dz, 0.001);
    target.vx = (target.vx || 0) + (dx / d) * Ai.RAVAGER_KNOCKBACK_STRENGTH;
    target.vy = (target.vy || 0) + 0.2;
    target.vz = (target.vz || 0) + (dz / d) * Ai.RAVAGER_KNOCKBACK_STRENGTH;
  };

  /**
   * `RavagerEntity`'s own `roar()` (RavagerEntity.java:244-265) -- every living entity within an
   * `expand(4.0)` box (a real AABB overlap test, entity boxes from width/height) except other ravagers (`IS_NOT_RAVAGER`,
   * RavagerEntity.java:47) takes 6 damage (`DamageSource.mob(this)`) UNLESS it is an
   * `IllagerEntity` (vindicator/pillager/evoker/illusioner -- NOT witch, which `WitchEntity`
   * extends `RaiderEntity` directly, and NOT ravager itself, read side by side against
   * `.decomp/net/minecraft/entity/mob/VindicatorEntity.java:46`/`WitchEntity.java`); every one
   * of them, illager or not, still gets `knockBack()`'d. The 40 POOF burst is `Particle.spawnRoar` (#1309); the
   * RAVAGER_ROAR `GameEvent` has no listener in this engine yet.
   */
  function ravagerRoar(e, ctx) {
    var EL = NS.EntityList, Cb = NS.Combat;
    if (!EL || !EL.list) return;
    function isIllager(o) {
      return !!o && (o.type === 'vindicator' || o.type === 'pillager' || o.type === 'evoker' || o.type === 'illusioner');
    }
    if (NS.GameEvent) NS.GameEvent.emit('ravager_roar', e.x, e.y, e.z, e);   // RavagerEntity.roar
    var R = Ai.RAVAGER_ROAR_RADIUS;
    var ew = (e.width || 0.6) / 2, eh = e.height || 1.8;
    var victims = NS.Player ? [NS.Player].concat(EL.list) : EL.list;   // the player is not in EL.list (07za_explosion.js pushes it the same way)
    for (var i = 0; i < victims.length; i++) {
      var o = victims[i];
      if (!o || o === e || o.dead || o.removed || o.type === 'ravager') continue;
      if (o.maxHealth === undefined && o !== NS.Player) continue;   // "is this a LivingEntity" filter, same convention 07za_explosion.js's own header already uses
      // getEntitiesByClass(.., getBoundingBox().expand(4.0), ..): AABB overlap, strict like Box.intersects
      var ow = (o.width || 0.6) / 2, oh = o.height || 1.8;
      if (o.x + ow <= e.x - ew - R || o.x - ow >= e.x + ew + R) continue;
      if (o.z + ow <= e.z - ew - R || o.z - ow >= e.z + ew + R) continue;
      if (o.y + oh <= e.y - R || o.y >= e.y + eh + R) continue;
      if (o === NS.Player) { if (NS.Survival && NS.Survival.hurt) NS.Survival.hurt(o, 'mob', Ai.RAVAGER_ROAR_DAMAGE, e); }   // the player's damage path (14j_combat.js:1289)
      else if (!isIllager(o) && Cb && Cb.hurt) Cb.hurt(o, Ai.RAVAGER_ROAR_DAMAGE, undefined, false, { attacker: e });
      Ai.ravagerKnockBack(e, o);
    }
    if (NS.Particle && NS.Particle.spawnRoar) NS.Particle.spawnRoar(e, EL.random);
  }

  /**
   * `RavagerEntity`'s own override of `knockback(LivingEntity)` (RavagerEntity.java:228-242) --
   * the mechanic every player who has blocked a ravager's attack with a shield knows: the hit
   * that WOULD knock the shield-blocking `target` back instead has a 50% chance to stun the
   * RAVAGER itself for `Ai.RAVAGER_STUN_TICKS` (playing its hurt-adjacent sound and pushing
   * `target` away from it, `pushAwayFrom(this)`), else it applies the ravager's own private
   * `knockBack` to `target` as normal. `this.roarTick == 0` gates it -- a roaring ravager cannot
   * ALSO be re-stunned mid-roar.
   * #862: called from `Use.takeShieldHit` (14l_use.js) when a shield-blocking player's attacker is a ravager;
   * `tools/raidmobcheck.mjs` exercises it directly. `pushAwayFrom` is `Ai.pushAwayFrom` (Entity.java:1269).
   */
  /** `Entity.pushAwayFrom(other)` (Entity.java:1269-1295): `self.pushAwayFrom(o)` -- o is pushed away, self the opposite way. */
  Ai.pushAwayFrom = function (self, o) {
    if (self.vehicle === o || o.vehicle === self || self.noClip || o.noClip) return;
    var dx = o.x - self.x, dz = o.z - self.z;
    var m = Math.max(Math.abs(dx), Math.abs(dz));
    if (!(m >= Math.fround(0.01))) return;
    m = Math.sqrt(m);
    dx /= m; dz /= m;
    var k = Math.min(1.0 / m, 1.0) * Math.fround(0.05);
    dx *= k; dz *= k;
    var sp = self.passengers && self.passengers.length, op = o.passengers && o.passengers.length;
    if (!sp) { self.vx = (self.vx || 0) - dx; self.vz = (self.vz || 0) - dz; }
    if (!op) { o.vx = (o.vx || 0) + dx; o.vz = (o.vz || 0) + dz; }
  };
  // RavagerEntity.playSound(ev, 1.0F, 1.0F): attack (tryAttack/status 4), stunned (knockback), roar (stunTick -> 0)
  function ravagerSay(e, ev) { if (NS.MobVoice) NS.MobVoice.emit(e, ev, 1.0, 1.0); }
  Ai.ravagerAttackBlockedByShield = function (e, target, ctx) {
    ctx = ctx || {};
    var rand = ctx.random || Ai.rndOf(e);
    if ((e.ravagerRoarTick || 0) !== 0) return;
    if (rand() < 0.5) {
      e.ravagerStunTick = Ai.RAVAGER_STUN_TICKS; e.ravagerImmobile = true;
      ravagerSay(e, 'entity.ravager.stunned');
      Ai.pushAwayFrom(e, target);
    } else {
      Ai.ravagerKnockBack(e, target);
    }
  };

  /**
   * `RavagerEntity.tickMovement()`'s own `attackTick`/`stunTick`/`roarTick` state machine
   * (RavagerEntity.java:148-203) plus the leaf-breaking branch in the SAME method
   * (RavagerEntity.java:159-181) -- wired as an always-on background goal (`flags=0`, the exact
   * "declares no `Goal.Control`" shape `Ai.LongDoorInteractGoal` above already uses, so it never
   * excludes `Ai.MeleeAttackGoal`/`Ai.PatrolGoal` or is excluded by them), since this file owns
   * no real per-entity tick hook for ravager alone the way `07i_entitylist.js` ticks
   * `Po.tickWitchDrink` for witch (that file is another worker's this pass).
   * `isImmobile()`'s effect (RavagerEntity.java:150-157/219-221) is applied here through the
   * per-entity `e.speedAttr` override `Ai.movementSpeedOf` reads (#844), and `Ai.canSee` gates
   * on stun/roar (java:224-226).
   */
  Ai.RavagerRoarGoal = function (e, ctx) {
    ctx = ctx || {};
    var mobGriefing = ctx.mobGriefing || function () { return true; };
    this.canUse = function () { return true; };
    this.canContinueToUse = this.canUse;
    this.start = function () {};
    this.stop = function () {};
    this.tick = function () {
      var attackTick = e.ravagerAttackTick || 0;
      var stunTick = e.ravagerStunTick || 0;
      var roarTick = e.ravagerRoarTick || 0;
      // isImmobile() is read at the TOP of tickMovement, before the counters decrement (java:150).
      var immobile = attackTick > 0 || stunTick > 0 || roarTick > 0;
      if (e.horizontalCollision && mobGriefing()) {
        var broke = ravagerBreakLeaves(e);
        if (!broke && e.onGround) e.jumping = true;
      }
      if (roarTick > 0) {
        roarTick--;
        if (roarTick === Ai.RAVAGER_ROAR_FIRE_AT) ravagerRoar(e, ctx);
      }
      if (attackTick > 0) attackTick--;
      if (stunTick > 0) {
        stunTick--;
        if (stunTick === 0) { ravagerSay(e, 'entity.ravager.roar'); roarTick = Ai.RAVAGER_ROAR_TICKS; }
      }
      e.ravagerAttackTick = attackTick;
      e.ravagerStunTick = stunTick;
      e.ravagerRoarTick = roarTick;
      e.ravagerImmobile = attackTick > 0 || stunTick > 0 || roarTick > 0;   // #4340: EL.tickMob reads the LIVE counters next tick
      // RavagerEntity.tickMovement (java:150-157): MOVEMENT_SPEED base -> 0 while immobile, else
      // lerp(0.1) toward 0.35 with a target / 0.3 without. `Ai.movementSpeedOf` reads speedAttr.
      if (immobile) {
        e.speedAttr = 0;
        Ai.setMobSpeed(e, 0);
      } else {
        var cur = e.speedAttr !== undefined ? e.speedAttr : Ai.movementSpeedOf(e);
        var goal = e.target ? 0.35 : 0.3;
        e.speedAttr = cur + (goal - cur) * 0.1;
      }
    };
  };

  /**
   * Vanilla's `RangedBowAttackGoal` (D-396, skeleton's own third-mob goal) — approach until
   * within `radius`, back off if too close, face the target, and fire on a cooldown.
   *
   * ⚠ THE RADIUS/INTERVAL ARE TRANSCRIBED FROM PUBLIC MCP/YARN-MAPPED 1.18.2 DECOMPILES, THE
   * SAME DISCIPLINE D-394 ALREADY USED FOR MeleeAttackGoal's REACH FORMULA — not re-walked
   * within `radius`, back off if too close, face the target, and fire on a cooldown.
   *
   * ⚠ THE RADIUS/INTERVAL ARE TRANSCRIBED FROM PUBLIC MCP/YARN-MAPPED 1.18.2 DECOMPILES, THE
   * SAME DISCIPLINE D-394 ALREADY USED FOR MeleeAttackGoal's REACH FORMULA — not re-walked
   * against this session's own bytecode (skeleton's `registerGoals()` passes
   * `new RangedBowAttackGoal(this, 1.0D, 20, 15.0F)`: speed modifier 1.0, minimum attack
   * interval 20 ticks, attack radius 15 blocks). A fresh extractor for these three literals is
   * the remaining verification and is named on `Ai.OWED`, exactly as D-394 left its own reach
   * formula. The "back off inside 3/4 radius" shape is vanilla's own `getAttackRadius() *
   * 0.75`-style near-band, not a number this file invented.
   *
   * ⚠ AND, AS OF D-402 (session 40), THE SHOT ACTUALLY LANDS. `onShoot(e, target)` fires once
   * per cooldown, the same injected-callback shape D-383's `BreedGoal.onBreed` already
   * established for "the jar-specific consequence is the caller's, not this file's to guess" —
   * in live play `EL.aiCtx.onShoot` is `Combat.mobShoot`, which spawns a real `arrow` entity
   * (this session's `extract-entity-motion.mjs` gave `arrow` a real, bytecode-measured gravity
   * AND drag — a SECOND pattern, `projectileGravityIn`/`projectileDragIn`, because
   * `AbstractArrow` writes its gravity with a 3-argument `setDeltaMovement(x, y-0.05F, z)`, not
   * the `.add()` shape this file's own PART 1 pattern matches) and `Combat.tickArrow` (called
   * from `EntityList.tickOne`) checks it against every living target each tick, hurting whatever
   * it overlaps and freezing in place once it hits the ground. `goalcheck.mjs` still proves the
   * ALGORITHM (approach/back-off/face/fire-on-cooldown) against a synthetic target and a
   * synthetic `onShoot`, the same proof standard `MeleeAttackGoal` had before D-394 wired its
   * strike into the real combat system — this goal is no longer one step earlier in that chain,
   * it is the same shape. `Ai.OWED` names what `Combat.tickArrow`/`Combat.mobShoot` do NOT model
   * (velocity-scaled damage and inaccuracy spread ARE modelled; s116 closed the whole-path
   * raycast, the stuck-arrow despawn/draw/fall cycle and player pickup — criticals remain
   * the player's own bow-charge mechanic, unbuilt for a mob's own shot).
   */
  Ai.RANGED_ATTACK_RADIUS = 15;          // RangedBowAttackGoal(this, 1.0D, 20, 15.0F) — public decompile
  Ai.RANGED_BACKOFF_FACTOR = 0.75;       // vanilla's own "too close" band, same source
  Ai.RANGED_ATTACK_INTERVAL = 20;        // minimum attack interval, same constructor call
  /**
   * D-449 (session 60, QUEUE row 0 item 4's bow half) — `e.bowDrawing`/`e.bowCharge`, THE
   * ONLY THING THIS SESSION ADDED TO THIS GOAL. Nothing about approach/back-off/fire timing
   * changed: this reads the goal's OWN pre-existing `cooldown` counter (unchanged, still the
   * one `onShoot` fires against) and exposes it as a draw fraction, so `07j_entityrender.js`
   * can pose a charging skeleton's arm/bow without re-deriving or duplicating the goal's own
   * timer (D-305: never let the reader own a number the writer owns).
   *
   * ⚠ THIS IS NOT VANILLA'S `ticksUsingItem`/`isUsingItem()` STATE MACHINE, AND IT IS NAMED AS
   * SUCH. Real `RangedBowAttackGoal.tick()` calls `mob.startUsingItem()` once per cycle and
   * counts a SEPARATE 0..20-tick "how long has the item actually been held" timer that keeps
   * running even while the mob loses line of sight (until a 60-tick grace expires and
   * `stopUsingItem()` cancels the draw); this file has never modelled that state at all — there
   * is one clock here, the shared attack-interval cooldown, and "charge" is just "how close is
   * the NEXT shot" (`1 - cooldown / RANGED_ATTACK_INTERVAL`), which happens to share vanilla's
   * own 20-tick number for this skeleton config but is not the same mechanism. Two visible
   * consequences, both left exactly as the existing timer already behaved (no gameplay changed
   * to add this field): (1) the very first tick a target comes into range fires an instant shot
   * at charge=1 with no draw at all, because `cooldown` starts at 0 (`this.start()`, unchanged);
   * (2) breaking line of sight mid-draw does not pause or reset the charge the way vanilla's
   * `seeTime`-gated `stopUsingItem()` would, because this file tracks no line-of-sight state.
   * Both are named on `Ai.OWED` rather than silently inherited.
   */
  Ai.RangedBowAttackGoal = function (e, speed, onShoot, radius, canSeeFn, interval) {
    var r = radius || Ai.RANGED_ATTACK_RADIUS;
    var see = canSeeFn || Ai.canSee;
    var gap = interval || Ai.RANGED_ATTACK_INTERVAL;
    var cooldown = -1, seeing = 0, path = null, idx = 1, repathIn = 0;
    var clear = function () { e.usingItem = false; e.itemUseTime = 0; e.bowDrawing = false; e.bowCharge = 0; };
    this.canUse = function () { return !!e.target; };
    this.canContinueToUse = this.canUse;
    this.start = function () { cooldown = -1; seeing = 0; path = null; repathIn = 0; clear(); };
    this.stop = function () { path = null; seeing = 0; cooldown = -1; clear(); };
    this.tick = function () {
      if (!e.target) return;
      var t = e.target;
      if (e.usingItem) e.itemUseTime = (e.itemUseTime || 0) + 1;   // tickActiveItem runs before the AI
      var dx = t.x - e.x, dy = (t.y === undefined ? e.y : t.y) - e.y, dz = t.z - e.z;
      var dist = Math.hypot(dx, dy, dz);
      var sees = !!see(e, t);
      if (sees !== (seeing > 0)) seeing = 0;
      if (sees) seeing++; else seeing--;
      e.yaw = Math.atan2(dx, -dz);                            // engine yaw, radians (D-415)
      if (dist > r) {
        // approach — same repathed step-toward shape MeleeAttackGoal already uses
        if (repathIn <= 0) {
          path = Ai.findPath(e.x, e.y, e.z, t.x, t.y, t.z, { mob: e });
          idx = 1; repathIn = 10;
        }
        repathIn--;
        if (path && idx < path.length) {
          Ai.stepToward(e, path[idx], speed);
          if (Ai.closeTo(e, path[idx])) idx++;
        }
      } else {
        path = null;
        if (dist < r * Ai.RANGED_BACKOFF_FACTOR) {
          // back off directly away from the target — vanilla's own near-band retreat
          var len = Math.hypot(dx, dz) || 1;
          var away = { x: e.x - (dx / len) * 0.5, y: e.y, z: e.z - (dz / len) * 0.5 };
          Ai.stepToward(e, away, speed);
        }
      }
      // D-449/#216 — the real draw: startUsingItem once per cycle, ticksUsingItem counted by the
      // active item, a shot only once seen AND drawn >= 20, stopUsingItem after 60 unseen ticks.
      if (e.usingItem) {
        if (!sees && seeing < Ai.BOW_LOSE_GATE) {
          e.usingItem = false; e.itemUseTime = 0;
        } else if (sees && dist <= r) {
          var use = e.itemUseTime || 0;
          if (use >= Ai.BOW_DRAW_TICKS) {
            e.usingItem = false; e.itemUseTime = 0;
            if (onShoot) onShoot(e, t, Ai.bowPullProgress(use));
            cooldown = gap;
          }
        }
      } else if (--cooldown <= 0 && seeing >= Ai.BOW_LOSE_GATE && dist <= r) {
        e.usingItem = true; e.itemUseTime = 0;
      }
      e.bowDrawing = !!e.usingItem;
      e.bowCharge = e.usingItem ? Math.min(1, (e.itemUseTime || 0) / Ai.BOW_DRAW_TICKS) : 0;
    };
  };

  /**
   * D-597 — `LivingEntity.canSee(entity)` (.decomp LivingEntity.java): a ray from this mob's eye
   * to the other's eye, blocked by any block with a COLLIDER shape, fluids ignored; different
   * worlds never see each other. The ray is `NS.Ray.cast` with the same "has a collision shape"
   * predicate `Enderman.isPlayerStaring`/`Bat.playerWithin` already use. Vanilla caches it per
   * tick in `MobVisibilityCache` — a cache changes no answer inside one tick, so none is kept.
   */
  Ai.canSee = function (e, t) {
    var R = NS.Ray, Ph = NS.Physics, Cb = NS.Combat;
    if (!t) return false;
    // `RavagerEntity.canSee` (RavagerEntity.java:224-226): blind while stunned or roaring.
    if (e.type === 'ravager' && ((e.ravagerStunTick || 0) > 0 || (e.ravagerRoarTick || 0) > 0)) return false;
    if (!R || !R.cast || !Ph || !Ph.shapesForState) return true;
    var eh = Cb && Cb.eyeHeightOf ? Cb.eyeHeightOf(e) : (e.height || 1.8) * 0.85;
    var th = t === NS.Player ? (NS.Survival && NS.Survival.eyeHeight ? NS.Survival.eyeHeight(t) : 1.62)
                             : (Cb && Cb.eyeHeightOf ? Cb.eyeHeightOf(t) : (t.height || 1.8) * 0.85);
    var ax = e.x, ay = e.y + eh, az = e.z;
    var dx = t.x - ax, dy = (t.y + th) - ay, dz = t.z - az;
    var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < 1e-9) return true;
    if (dist > 128) return false;              // canSee's own `distanceTo > 128 -> false`
    var hit = R.cast(ax, ay, az, dx / dist, dy / dist, dz / dist, dist, function (st) {
      return st !== 0 && !!(Ph.shapesForState(st) || []).length;
    });
    return !hit;
  };

  /** `BowItem.getPullProgress(useTicks)` (.decomp BowItem.java): f=t/20, (f²+2f)/3, capped at 1. */
  Ai.bowPullProgress = function (useTicks) {
    var f = Math.fround(useTicks / 20);
    f = Math.fround((f * f + f * 2) / 3);
    return f > 1 ? 1 : f;
  };

  /**
   * D-597 — `BowAttackGoal` (.decomp net/minecraft/entity/ai/goal/BowAttackGoal.java, read whole
   * and transcribed whole) for skeleton/stray — replaces `Ai.RangedBowAttackGoal` for them
   * (drowned keeps that one for its trident, `Undead.OWED`). The skeleton's own instance is
   * `new BowAttackGoal<>(this, 1.0, 20, 15.0F)` (AbstractSkeletonEntity.java:48) with
   * `updateAttackType` (:159-175) setting the interval to 20 on HARD and 40 on every other
   * difficulty, and only while the mob HOLDS A BOW (else MeleeAttackGoal, priority 4).
   *
   *   targetSeeingTicker  ramps +1 per tick seen / −1 per tick unseen, reset to 0 on a flip;
   *   in range (≤15) AND seen ≥20 ticks → navigation stops, combatTicks counts; else path to it;
   *   combatTicks ≥20 → 30% flip strafe left/right, 30% flip backward; >¾ range → forward,
   *   <¼ range → backward; `strafeTo(±0.5, ±0.5)` (MoveControl STRAFE: speed 0.25 × the mob's
   *   MOVEMENT_SPEED, normalized) and `lookAtEntity(target, 30, 30)`;
   *   using the bow: unseen for >60 ticks → drop the draw; seen and useTime ≥20 → shoot with
   *   `BowItem.getPullProgress(useTime)`, cooldown = interval; not using: `--cooldown <= 0` and
   *   seen within the last 60 ticks → start drawing.
   * `MoveControl`'s `method_25946` (refuse a strafe step onto an unwalkable node) is read here
   * as "the block under the strafe destination has a collision shape" — named, `Ai.OWED`.
   */
  Ai.BOW_RANGE = 15;                     // BowAttackGoal(this, 1.0, 20, 15.0F)
  Ai.BOW_INTERVAL_HARD = 20;             // updateAttackType: 20 on HARD ...
  Ai.BOW_INTERVAL = 40;                  // ... 40 otherwise
  Ai.BOW_SEE_GATE = 20;                  // targetSeeingTicker >= 20
  Ai.BOW_LOSE_GATE = -60;                // targetSeeingTicker < -60
  Ai.BOW_DRAW_TICKS = 20;                // getItemUseTime() >= 20
  Ai.BOW_FLIP_CHANCE = 0.3;
  Ai.STRAFE_SPEED = 0.25;                // MoveControl.strafeTo's own `speed = 0.25`
  Ai.BOW_TURN = 30 * DEG;                // lookAtEntity(target, 30, 30) / lookAt(target, 30, 30)
  Ai.bowInterval = function () {
    var D = NS.Diff;
    return (D && D.get && D.get() === 'hard') ? Ai.BOW_INTERVAL_HARD : Ai.BOW_INTERVAL;
  };
  Ai.holdsBow = function (e) {
    var Eq = NS.Equip, IT = NS.Items;
    if (!Eq || !Eq.getEquipped || !IT || !IT.nameOf) return true;   // no equipment system: the roster's bow is assumed
    var st = Eq.getEquipped(e, IT.MAINHAND), st2 = Eq.getEquipped(e, IT.OFFHAND);
    return !!((st && IT.nameOf(st.i) === 'bow') || (st2 && IT.nameOf(st2.i) === 'bow'));
  };
  /** D-602 (raidergoals) — `CrossbowAttackGoal.isEntityHoldingCrossbow()`
   *  (`.actor.isHolding(Items.field_8399)`, CrossbowAttackGoal.java:35-37), the SAME
   *  MAINHAND/OFFHAND `NS.Equip` read `Ai.holdsBow` just above already makes for skeleton's
   *  bow — pillager is given a real `crossbow` at spawn (`Eq.RAIDER_MAIN`, 07y_equip.js:205),
   *  so this is real (not vacuous) the day `NS.Equip`/`NS.Items` are both live, same as
   *  `Ai.holdsBow`. */
  Ai.holdsCrossbow = function (e) {
    var Eq = NS.Equip, IT = NS.Items;
    if (!Eq || !Eq.getEquipped || !IT || !IT.nameOf) return true;   // no equipment system: the roster's crossbow is assumed
    var st = Eq.getEquipped(e, IT.MAINHAND), st2 = Eq.getEquipped(e, IT.OFFHAND);
    return !!((st && IT.nameOf(st.i) === 'crossbow') || (st2 && IT.nameOf(st2.i) === 'crossbow'));
  };
  Ai.BowAttackGoal = function (e, speed, onShoot, rnd, canSeeFn, fixedInterval) {
    var flt = rnd ? rnd : function () { return e.random && e.random.nextFloat ? e.random.nextFloat() : Ai.rndOf(e)(); };   // BowAttackGoal draws getRandom().nextFloat() (one 24-bit draw), not a double
    rnd = flt;
    var see = canSeeFn || Ai.canSee;
    var rangeSq = Ai.BOW_RANGE * Ai.BOW_RANGE;
    var cooldown = -1, seeing = 0, left = false, backward = false, combat = -1;
    var path = null, idx = 1, repathIn = 0;
    var self = this;
    this.canUse = function () { return !!(e.target && !e.target.dead && !e.target.removed) && Ai.holdsBow(e); };
    this.canContinueToUse = function () { return (self.canUse() || !!(path && idx < path.length)) && Ai.holdsBow(e); };
    this.start = function () { e.attacking = true; };
    this.stop = function () {
      e.attacking = false; seeing = 0; cooldown = -1;
      e.usingItem = false; e.itemUseTime = 0; e.bowDrawing = false; e.bowCharge = 0;
      path = null;
    };
    this.tick = function () {
      var t = e.target;
      if (!t) return;
      if (e.usingItem) e.itemUseTime = (e.itemUseTime || 0) + 1;   // LivingEntity.tickActiveItem runs before the AI
      var ty = t.y === undefined ? e.y : t.y;
      var dx = t.x - e.x, dy = ty - e.y, dz = t.z - e.z;
      var dSq = dx * dx + dy * dy + dz * dz;
      var sees = !!see(e, t);
      if (sees !== (seeing > 0)) seeing = 0;
      if (sees) seeing++; else seeing--;
      if (!(dSq > rangeSq) && seeing >= Ai.BOW_SEE_GATE) {
        path = null;                                             // getNavigation().stop()
        combat++;
      } else {
        if (repathIn <= 0) { path = Ai.findPath(e.x, e.y, e.z, t.x, ty, t.z, { mob: e }); idx = 1; repathIn = 10; }
        repathIn--;
        if (path && idx < path.length) {
          Ai.stepToward(e, path[idx], speed);
          if (Ai.closeTo(e, path[idx])) idx++;
        }
        combat = -1;
      }
      if (combat >= 20) {
        if (rnd() < Ai.BOW_FLIP_CHANCE) left = !left;
        if (rnd() < Ai.BOW_FLIP_CHANCE) backward = !backward;
        combat = 0;
      }
      var want = Math.atan2(dx, -dz);
      if (combat > -1) {
        if (dSq > rangeSq * Math.fround(0.75)) backward = false;
        else if (dSq < rangeSq * Math.fround(0.25)) backward = true;
        Ai.strafeTo(e, backward ? -0.5 : 0.5, left ? 0.5 : -0.5);
        e.yaw = Ai.rotlerp(e.yaw || 0, want, Ai.BOW_TURN);       // lookAtEntity(target, 30, 30)
      } else if (e.look && e.look.setLookAt) {
        e.look.setLookAt(t.x, ty + (t.height || 1.8) * 0.85, t.z, Ai.BOW_TURN, Ai.BOW_TURN);
      }
      if (e.usingItem) {
        if (!sees && seeing < Ai.BOW_LOSE_GATE) {
          e.usingItem = false; e.itemUseTime = 0;                 // clearActiveItem
        } else if (sees) {
          var use = e.itemUseTime || 0;
          if (use >= Ai.BOW_DRAW_TICKS) {
            e.usingItem = false; e.itemUseTime = 0;
            if (onShoot) onShoot(e, t, Ai.bowPullProgress(use));
            cooldown = (fixedInterval != null ? fixedInterval : Ai.bowInterval());
          }
        }
      } else if (--cooldown <= 0 && seeing >= Ai.BOW_LOSE_GATE) {
        e.usingItem = true; e.itemUseTime = 0;                    // setCurrentHand(bow hand)
      }
      // the renderer's bow pose (07j_entityrender.js ER.bowTileName) reads the vanilla "pull"
      // model predicate, useTime/20 — not the damage curve above.
      e.bowDrawing = !!e.usingItem;
      e.bowCharge = e.usingItem ? Math.min(1, (e.itemUseTime || 0) / 20) : 0;
    };
  };

  /**
   * D-602 (raidergoals) — `AbstractSkeletonEntity.updateAttackType()`/`reassessWeaponGoal()`
   * (`.decomp` AbstractSkeletonEntity.java:159-175, read in full): a skeleton/stray that is NOT
   * holding a bow (`getStackInHand(ProjectileUtil.getHandPossiblyHolding(this, Items.
   * field_8102))`, `Ai.holdsBow` reused) runs its own `meleeAttackGoal = new MeleeAttackGoal(
   * this, 1.2, false)` (line 49) instead of `bowAttackGoal` — vanilla swaps which goal is even
   * IN `goalSelector` (`.remove()`/`.add(4, ...)`); this engine's `GoalSelector` has no
   * mid-flight remove, so both goals are rostered at the SAME priority/flag pair and their own
   * `canUse` guards (`Ai.holdsBow(e)`/`!Ai.holdsBow(e)`) make them mutually exclusive instead —
   * same net effect, `Ai.BowAttackGoal`'s own header already gates `canUse` on `Ai.holdsBow`.
   */
  Ai.SkeletonMeleeFallbackGoal = function (e, speed) {
    var base = new Ai.MeleeAttackGoal(e, speed);
    // base.canUse/canContinueToUse = MeleeAttackGoal.canStart/shouldContinue (20-tick throttle, path-or-reach, creative/spectator).
    this.canUse = function () { return !Ai.holdsBow(e) && base.canUse(); };
    this.canContinueToUse = function () { return !Ai.holdsBow(e) && base.canContinueToUse(); };
    // AbstractSkeletonEntity.meleeAttackGoal (:57-69): start -> setAttacking(true), stop -> setAttacking(false).
    this.start = function () { base.start(); e.attacking = true; };
    this.stop = function () { base.stop(); e.attacking = false; };
    this.tick = base.tick;
  };

  /** `MoveControl.strafeTo` + its STRAFE branch of `tick()` (.decomp MoveControl.java:50-82):
   *  speed 0.25 × MOVEMENT_SPEED, the (forward, sideways) pair scaled to that length when longer
   *  than 1, then refused (forward 1, sideways 0) when the destination is not walkable. */
  Ai.strafeTo = function (e, fwd, side) {
    var f1 = Math.fround(Ai.STRAFE_SPEED * Ai.movementSpeedOf(e));
    var n = Math.sqrt(fwd * fwd + side * side);
    if (n < 1) n = 1;
    n = f1 / n;
    var f = fwd * n, s = side * n;
    // engine yaw (D-415): forward = (sin y, -cos y); vanilla's `f*cos - s*sin`, `s*cos + f*sin`
    // is the same world offset written in its own convention, so test along the engine heading.
    var y = e.yaw || 0, sy = Math.sin(y), cy = Math.cos(y);
    var wx = f * sy - s * cy, wz = -f * cy - s * sy;   // Ph.travelMob's own (zza, xxa) -> world map
    if (!Ai.strafeWalkable(e, wx, wz)) { fwd = 1; side = 0; }
    // setMovementSpeed(f1), then the UNSCALED forward/sideways (the scaled pair is only the test).
    e.mobSpeed = f1; e.zza = fwd; e.xxa = side;
  };
  /** `MoveControl.tick`'s `pathNodeMaker.getDefaultNodeType(world, floor(x+f5), floor(y), floor(z+f6)) != WALKABLE`
   *  refusal, on the one cell at the mob's own feet height (`Ai.pathTypeAt`, off LandPathNodeMaker). */
  Ai.strafeWalkable = function (e, wx, wz) {
    var W = NS.World;
    if (!W || !W.getBlock) return true;
    return Ai.pathTypeAt(Math.floor(e.x + wx), Math.floor(e.y), Math.floor(e.z + wz)) === Ai.NodeType.WALKABLE;
  };

  /**
   * `ProjectileAttackGoal` (QUEUE 0.2 raid loop, loop/witchpotion-s95) — `.decomp/net/
   * minecraft/entity/ai/goal/ProjectileAttackGoal.java`, read in full and transcribed whole.
   * Witch's own use (`WitchEntity.initGoals`): `new ProjectileAttackGoal(this, 1.0, 60, 10.0F)`
   * — the 4-arg constructor, which sets BOTH `minIntervalTicks` and `maxIntervalTicks` to the
   * same 60. Approach/back-off is NOT this goal's own shape (unlike `RangedBowAttackGoal`):
   * vanilla's own `tick()` stops the navigation once within `maxShootRange` for 5 SEEN ticks in
   * a row and otherwise just walks straight at the target (`startMovingTo`, no back-off band at
   * all — a witch does not retreat from a close target the way a skeleton does).
   *
   * ⚠ NAMED SIMPLIFICATIONS (`Ai.OWED`), same standard every other transcribed goal in this
   * file holds itself to:
   *   - (#2909: `canSee` gating via `Ai.canSee`, `shouldContinue`'s `!isIdle()` half via the
   *     goal's own path, and the 30deg look turn are now modelled.)
   *   - the fired shot's actual velocity/potion-choice math is the CALLER's
   *     (`onShoot(e, target, pullProgress)` — the same injected-callback shape `onShoot`/
   *     `onBreed` elsewhere in this file already use), `Po.witchThrow` in live play
   *     (07z_potion.js) via `EL.aiCtx.onPotionThrow`.
   */
  Ai.PROJECTILE_SEEN_TICKS_GATE = 5;         // ProjectileAttackGoal.tick()'s own literal
  Ai.ProjectileAttackGoal = function (e, speed, minIntervalTicks, maxIntervalTicks, maxShootRange, onShoot, flies) {
    var maxRangeSq = maxShootRange * maxShootRange;
    var seenTargetTicks = 0, updateCountdownTicks = -1, path = null, idx = 1, repathIn = 0;
    var goalTarget = null;       // vanilla's `this.target`, kept until stop() so a finishing path still has one
    this.getCooldown = function () { return updateCountdownTicks; };   // #5377: RangedAttackGoal.updateCountdownTicks, read by the lockstep trace
    this.canUse = function () {
      if (!(e.target && !e.target.dead && !e.target.removed)) return false;
      goalTarget = e.target; return true;
    };
    // shouldContinue = canStart() || !navigation.isIdle()
    this.canContinueToUse = function () { return this.canUse() || !!(path && idx < path.length); };
    this.start = function () { updateCountdownTicks = -1; seenTargetTicks = 0; path = null; repathIn = 0; };
    this.stop = function () { seenTargetTicks = 0; updateCountdownTicks = -1; path = null; goalTarget = null; };
    this.tick = function () {
      var t = goalTarget || e.target;
      if (!t) return;
      var dx = t.x - e.x, dy = (t.y === undefined ? e.y : t.y) - e.y, dz = t.z - e.z;
      var distSq = dx * dx + dy * dy + dz * dz;
      // getLookControl().lookAt(target, 30, 30): at most 30deg/tick, not a yaw snap
      if (e.look) e.look.setLookAt(t.x, (t.y === undefined ? e.y : t.y) + Ai.eyeOf(t), t.z, Ai.BOW_TURN, Ai.BOW_TURN);
      else e.yaw = Ai.rotlerp(e.yaw || 0, Math.atan2(dx, -dz), Ai.BOW_TURN);
      var seen = Ai.canSee(e, t);
      if (seen) seenTargetTicks++; else seenTargetTicks = 0;
      if (distSq <= maxRangeSq && seenTargetTicks >= Ai.PROJECTILE_SEEN_TICKS_GATE) {
        path = null;                 // getNavigation().stop()
      } else if (flies && e.flyMove) {
        // BirdNavigation.startMovingTo(target): flies straight at it via FlightMoveControl (wither)
        path = null; e.flyMove.setWantedPosition(t.x, t.y === undefined ? e.y : t.y, t.z, speed);
      } else {
        if (repathIn <= 0) {
          path = Ai.findPath(e.x, e.y, e.z, t.x, t.y, t.z, { mob: e });
          idx = 1; repathIn = 10;
        }
        repathIn--;
        if (path && idx < path.length) {
          Ai.stepToward(e, path[idx], speed);
          if (Ai.closeTo(e, path[idx])) idx++;
        }
      }
      if (--updateCountdownTicks === 0) {
        if (!seen) return;           // vanilla: no shot (and no re-arm) while unseen
        var dist = Math.sqrt(distSq);
        var f = dist / maxShootRange;
        var pullProgress = f < 0.1 ? 0.1 : (f > 1 ? 1 : f);
        if (onShoot) onShoot(e, t, pullProgress);
        updateCountdownTicks = Math.floor(f * (maxIntervalTicks - minIntervalTicks) + minIntervalTicks);
      } else if (updateCountdownTicks < 0) {
        var f2 = Math.sqrt(distSq) / maxShootRange;
        if (f2 < 0) f2 = 0; else if (f2 > 1) f2 = 1;
        updateCountdownTicks = Math.floor(minIntervalTicks + f2 * (maxIntervalTicks - minIntervalTicks));
      }
    };
  };

  /**
   * `CrossbowAttackGoal` (QUEUE 0.2 raid loop) — `.decomp/net/minecraft/entity/ai/goal/
   * CrossbowAttackGoal.java`, read in full and transcribed whole, not approximated with
   * `Ai.RangedBowAttackGoal` (skeleton's own continuous-draw goal is a genuinely DIFFERENT
   * shape — one clock, always drawing — from this one's charge/hold/fire/cooldown state
   * machine, and the header this file used to carry named reusing it a "gap" rather than doing
   * it; that gap is closed here). Pillager is this engine's only user (`registerGoals`,
   * `PillagerEntity.java:70`: `new CrossbowAttackGoal<>(this, 1.0, 8.0F)`).
   *
   * `Stage` (field_16534/field_16530/field_16532/field_16533) -> 'uncharged'/'charging'/
   * 'charged'/'ready', in the same order and the same four transitions the source reads:
   * uncharged -> charging the instant the mob is NOT trying to close distance (`!$$4`);
   * charging -> charged once the draw has run `CrossbowItem.getPullTime()` ticks (25, no
   * Quick Charge enchantment — this engine has no enchantment substrate on mob-held items, so
   * the unenchanted constant is the only one it can ever be, named rather than parameterised);
   * charged counts `chargedTicksLeft` down from `20 + random.nextInt(20)` (`COOLDOWN_RANGE`'s
   * sibling roll, same class); ready fires on the very next tick and resets to uncharged.
   *
   * D-602 (raidergoals) CLOSED THE TWO NAMED GAPS THIS HEADER USED TO CARRY:
   *   - `isEntityHoldingCrossbow()` (`Ai.holdsCrossbow`, above) now gates `canStart`/
   *     `shouldContinue`, the same `NS.Equip` MAINHAND/OFFHAND read `Ai.holdsBow` already makes
   *     for skeleton — real, not assumed, the day `NS.Equip`/`NS.Items` are both live.
   *   - `getVisibilityCache().canSee()` (the `seeingTargetTicker` line-of-sight ramp) is now
   *     wired through `Ai.canSee` (D-597's own ray helper, `ctx.canSee` overridable the same
   *     way `Ai.BowAttackGoal`'s own `canSeeFn` param already is) — `$$4` is the real OR again
   *     (out of range OR not-seen-enough), not "out of range" alone.
   * ⚠ STILL NAMED (`Ai.OWED`), same standard `Ai.RangedBowAttackGoal`'s own header holds itself
   * to: the fired shot goes through `ctx.onShoot` (the SAME projectile substrate
   * `Ai.RangedBowAttackGoal` already uses — skeleton's arrow path), not `ProjectileUtil.
   * shootCrossbowProjectile`'s own firework-recovery/multishot handling, because no crossbow
   * projectile of its own exists in this engine yet.
   */
  Ai.CROSSBOW_PULL_TICKS = 25;          // CrossbowItem.getPullTime(no enchant): 25 - 5*0
  Ai.CROSSBOW_CHARGED_MIN = 20;         // CrossbowAttackGoal: chargedTicksLeft = 20 + nextInt(20)
  Ai.CROSSBOW_CHARGED_SPAN = 20;
  Ai.CROSSBOW_COOLDOWN_MIN = 20;        // TimeHelper.betweenSeconds(1, 2) -> UniformIntProvider(20, 40)
  Ai.CROSSBOW_COOLDOWN_SPAN = 21;       // create(20,40) is INCLUSIVE both ends -> 21 outcomes
  /** CrossbowItem.getPullTime: 25 - 5*quick_charge of the held crossbow (#1201). */
  Ai.crossbowStack = function (e) {
    var Eq = NS.Equip, IT = NS.Items;
    if (!Eq || !Eq.getEquipped || !IT || !IT.nameOf) return null;
    var a = Eq.getEquipped(e, IT.MAINHAND), b = Eq.getEquipped(e, IT.OFFHAND);
    return (a && IT.nameOf(a.i) === 'crossbow') ? a : ((b && IT.nameOf(b.i) === 'crossbow') ? b : null);
  };
  Ai.crossbowPullTicks = function (e) {
    var st = Ai.crossbowStack(e), q = (st && NS.Combat && NS.Combat.enchantLevel) ? NS.Combat.enchantLevel(st, 'quick_charge') : 0;
    return Ai.CROSSBOW_PULL_TICKS - 5 * q;
  };
  Ai.CrossbowAttackGoal = function (e, speed, range, ctx) {
    ctx = ctx || {};
    var rand = ctx.random || Ai.rndOf(e);
    var onShoot = ctx.onShoot;
    var see = ctx.canSee || Ai.canSee;   // D-602: same LOS helper D-597 gave skeleton's BowAttackGoal
    var squaredRange = range * range;
    var stage = 'uncharged', chargeTicks = 0, chargedTicksLeft = 0, cooldown = 0;
    var seeingTargetTicker = 0;
    var path = null, idx = 1, repathIn = 0, navSpeed = speed;
    // D-602: `isEntityHoldingCrossbow()` (`Ai.holdsCrossbow`, above) — canStart/shouldContinue
    // both gate on it (CrossbowAttackGoal.java:32/40).
    var alive = function () { return !!e.target && !e.target.dead && !e.target.removed; };   // hasAliveTarget
    this.canUse = function () { return alive() && Ai.holdsCrossbow(e); };
    // shouldContinue: hasAliveTarget && (canStart || !navigation.isIdle) && holdingCrossbow (#1826)
    this.canContinueToUse = function () { return alive() && (this.canUse() || (!!path && idx < path.length)) && Ai.holdsCrossbow(e); };
    this.start = function () {
      stage = 'uncharged'; chargeTicks = 0; chargedTicksLeft = 0; cooldown = 0;
      seeingTargetTicker = 0;
      path = null; repathIn = 0; e.crossbowCharging = false; e.crossbowCharge = 0;
    };
    this.stop = function () {
      path = null; e.crossbowCharging = false; e.crossbowCharge = 0;
      seeingTargetTicker = 0;
      e.attacking = false;   // CrossbowAttackGoal.stop(): setAttacking(false)
      e.target = null;   // CrossbowAttackGoal.stop(): this.actor.setTarget(null)
    };
    this.tick = function () {
      var t = e.target;
      if (!t) return;
      var dx = t.x - e.x, dy = (t.y === undefined ? e.y : t.y) - e.y, dz = t.z - e.z;
      var distSq = dx * dx + dy * dy + dz * dz;
      // getLookControl().lookAt(target, 30, 30): rate-limited head turn (#1827), not a yaw snap
      if (e.look) e.look.setLookAt(t.x, (t.y === undefined ? e.y : t.y) + Ai.eyeOf(t), t.z, 30 * Math.PI / 180, 30 * Math.PI / 180);
      // D-602: `getVisibilityCache().canSee($$0)` ramp (CrossbowAttackGoal.java:69-79) — +1 per
      // tick seen, -1 per tick unseen, reset to 0 on a flip, the SAME shape `Ai.BowAttackGoal`'s
      // own `seeing` counter already uses for skeleton.
      var sees = !!see(e, t);
      if (sees !== (seeingTargetTicker > 0)) seeingTargetTicker = 0;
      if (sees) seeingTargetTicker++; else seeingTargetTicker--;
      // `$$4` in the source: out of range OR seeingTargetTicker < 5, AND not already charged.
      var wantsToMove = (distSq > squaredRange || seeingTargetTicker < 5) && chargedTicksLeft === 0;
      if (wantsToMove) {
        cooldown--;
        if (cooldown <= 0) {
          // navigation.startMovingTo: a fresh path once per cooldown; it is then walked EVERY tick below
          path = Ai.findPath(e.x, e.y, e.z, t.x, t.y, t.z, { mob: e });
          idx = 1; navSpeed = stage === 'uncharged' ? speed : speed * 0.5;
          cooldown = Ai.CROSSBOW_COOLDOWN_MIN + Math.floor(rand() * Ai.CROSSBOW_COOLDOWN_SPAN);
        }
      } else {
        cooldown = 0; path = null;   // navigation.stop()
      }
      if (path && idx < path.length) {   // Navigation.tick: keep following the path
        Ai.stepToward(e, path[idx], navSpeed);
        if (Ai.closeTo(e, path[idx])) idx++;
      }
      if (stage === 'uncharged') {
        if (!wantsToMove) { stage = 'charging'; chargeTicks = 0; e.crossbowCharging = true; e.crossbowSndStart = e.crossbowSndMid = false; }
      } else if (stage === 'charging') {
        if (!e.crossbowCharging) { stage = 'uncharged'; return; }   // `!isUsingItem()` -> UNCHARGED (use-item interrupted)
        chargeTicks++;
        var pullTicks = Ai.crossbowPullTicks(e);
        e.crossbowCharge = Math.min(1, chargeTicks / pullTicks);
        // CrossbowItem.usageTick: start/quick_charge_N at >=20% pull, loading_middle at >=50% (unenchanted only)
        var qc = pullTicks === Ai.CROSSBOW_PULL_TICKS ? 0 : (Ai.CROSSBOW_PULL_TICKS - pullTicks) / 5;
        if (NS.Sound && NS.Sound.mobSound) {   // mob.playSound -> the mob's own category (hostile for pillager), silent handled inside
          if (chargeTicks / pullTicks >= 0.2 && !e.crossbowSndStart) { e.crossbowSndStart = true; NS.Sound.mobSound(e, qc ? 'item.crossbow.quick_charge_' + qc : 'item.crossbow.loading_start', 0.5, 1.0); }
          if (!qc && chargeTicks / pullTicks >= 0.5 && !e.crossbowSndMid) { e.crossbowSndMid = true; NS.Sound.mobSound(e, 'item.crossbow.loading_middle', 0.5, 1.0); }
        }
        if (chargeTicks >= pullTicks) {
          stage = 'charged';
          chargedTicksLeft = Ai.CROSSBOW_CHARGED_MIN + Math.floor(rand() * Ai.CROSSBOW_CHARGED_SPAN);
          e.crossbowCharging = false;
        }
      } else if (stage === 'charged') {
        chargedTicksLeft--;
        if (chargedTicksLeft <= 0) stage = 'ready';
      } else if (stage === 'ready' && sees) {   // vanilla: READY fires only while canSee(target), else waits
        var cst = Ai.crossbowStack(e), Cb = NS.Combat;
        if (cst && Cb && Cb.mobShootCrossbow) Cb.mobShootCrossbow(e, t, cst, ctx.random);
        else if (onShoot) onShoot(e, t);
        if (e.type === 'pillager') e.despawnCounter = 0;   // PillagerEntity.postShoot
        e.crossbowCharge = 0;
        stage = 'uncharged';
      }
    };
  };

  /**
   * Vanilla's `NearestAttackableTargetGoal` — picks the nearest eligible target within the
   * mob's own `followRange` attribute (D-336's table; zombie is 35, confirmed against
   * `tools/golden/entity-attributes-1.18.2.tsv` rather than typed here). TARGET only.
   */
  Ai.followRangeOf = function (e) {
    // s112: a per-entity follow_range (a zombie's own "Random zombie-spawn bonus", 07zk_undead.js) wins.
    var a = e && e.followRange > 0 ? null : (NS.Entities.attrsOf ? NS.Entities.attrsOf(e.type) : null);
    var base = e && e.followRange > 0 ? e.followRange : (a && a.follow ? a.follow : 0);   // 0, not a guessed default — see D-336
    // MobEntity.initialize's "Random spawn bonus" (MULTIPLY_BASE, 07i_entitylist.js mobStateDefaults):
    // value = base * (1 + bonus) * (1 + MULTIPLY_TOTAL), clamped to follow_range's [0, 2048].
    if (base > 0 && e.followBonus) base = Math.max(0, Math.min(2048, base * (1 + e.followBonus)));
    return base;
  };
  /**
   * s135 (Dan, 25 Sept: "i am being pursued in creative"). No goal in this engine asked
   * vanilla's attackable-target question, so every hostile hunted a creative player.
   * `TargetPredicate.test` (attackable) refuses a target that is not `isPartOfGame()`
   * (spectator or dead) or that `LivingEntity.canTarget` refuses — a player on PEACEFUL, or one
   * whose `canTakeDamage()` is false: `PlayerEntity.canTakeDamage` is `!abilities.invulnerable`,
   * which is exactly creative/spectator (`e.invulnerableGamemode` here, 14e_gamemode.js).
   * `TrackTargetGoal.shouldContinue` drops a held player target on the same invulnerable flag,
   * so `Ai.dropUntargetable` runs around every mob's goal tick (EL.tickMob) — one gate for every
   * goal, brain and bespoke target picker, rather than one per mob.
   */
  Ai.canTargetLiving = function (t, self) {
    if (!t || t.dead || t.removed) return false;
    // AxolotlEntity.canTakeDamage (`!isPlayingDead()`): only mob targeting consults it, never damage.
    if (t.type === 'axolotl' && t.playingDead) return false;
    // #734 IronGolemEntity.canTarget(EntityType): never a creeper; a PlayerCreated golem never a player.
    if (self && self.type === 'iron_golem' && (t.type === 'creeper' || ((t === NS.Player || t.type === 'player') && self.playerCreated))) return false;
    // #3502 TameableEntity.canTarget: `isOwner(target) ? false : super.canTarget(target)` (owner is 'player' or an entity).
    if (self && self.tamed && self.owner && (self.owner === t || (self.owner === 'player' && (t === NS.Player || t.type === 'player')))) return false;
    // CreeperEntity.setTarget: `if (target instanceof GoatEntity) return;`
    if (self && self.type === 'creeper' && t.type === 'goat') return false;
    if (t === NS.Player || t.type === 'player') {
      var Gm = NS.Gamemode;
      if (Gm && Gm.isSpectator && Gm.isSpectator(t)) return false;
      if (t.invulnerableGamemode) return false;
      if (Gm && Gm.isCreative && Gm.isCreative(t)) return false;
      var D = NS.Diff;
      if (D && D.isPeaceful && D.isPeaceful()) return false;
    }
    return true;
  };
  // LivingEntity.getAttackDistanceScalingFactor (sneak x0.8, invisible): TargetPredicate.test uses max(base*this, 2).
  Ai.attackScale = function (c, obs) {
    return (c === NS.Player || c.type === 'player') && NS.Bat ? NS.Bat.attackScale(c, obs) : NS.Village ? NS.Village.attackDistanceScale(c) : 1;
  };
  Ai.dropUntargetable = function (e) {
    if (e && e.target && !Ai.canTargetLiving(e.target, e)) e.target = null;
  };

  // `opts` (raid mobs only so far -- the other callers keep the flat radius): `sight` is
  // `TargetPredicate.respectsVisibility` (default true in vanilla, TargetPredicate.java:14): a
  // candidate the mob cannot `canSee` is not acquired; `mustSee` is `TrackTargetGoal.
  // checkVisibility` (the ctor's boolean): `shouldContinue` drops the target once it has been
  // unseen for more than `maxNoSight` ticks (TrackTargetGoal.java:57-63, default 60 =
  // `maxTimeWithoutVisibility`; goal ticks there, real ticks here -- this selector has no alternator).
  Ai.NearestAttackableTargetGoal = function (e, getCandidates, opts) {
    var sight = !(opts && opts.sight === false), mustSee = !!(opts && opts.mustSee);
    // `livingBox` (#3689): ActiveTargetGoal with a non-Player targetClass searches getBoundingBox().expand(fr, 4, fr)
    // (players included) and picks the nearest from the mob's EYE; TargetPredicate's range check stays feet-to-feet.
    var livingBox = !!(opts && opts.livingBox);
    var maxNoSight = (opts && opts.maxNoSight) || 60, unseen = 0;
    this.getCandidates = getCandidates;   // read by raidgoalresiduecheck (#1856)
    this.reciprocalChance = (opts && opts.reciprocalChance) || 0; this.sight = sight; this.mustSee = mustSee;   // read by golemgoals (#3676)
    var vbox = (opts && opts.vertical) || 0;   // getEntitiesByClass box.expand(follow, vertical, follow)
    this.maxNoSight = maxNoSight;   // read by raidmobcheck's roster assertions (#1026)
    // `reciprocalChance` (ActiveTargetGoal.canStart): `nextInt(reducedTickDelay(n)) != 0` refuses. reducedTickDelay(10)=5
    // per goal selection, which runs every other tick -> 1/(2*5) per tick here (same conversion as Ai.STROLL_CHANCE).
    var recip = (opts && opts.reciprocalChance) || 0, rrand = (opts && opts.rand) || Ai.rndOf(e);
    // `checkCanNavigate` (TrackTargetGoal.canTrack/canNavigateToEntity): a path ending within 1.5 blocks of the target,
    // re-evaluated every toGoalTicks(10+nextInt(5)) goal ticks (flag shared across targets, as vanilla).
    var checkNav = !!(opts && opts.checkCanNavigate), navFlag = 0, navCd = 0;
    function navOk(t, fr) {
      if (--navCd <= 0) navFlag = 0;
      if (navFlag === 0) {
        navCd = 10 + Math.floor(rrand() * 5);
        var p = Ai.findPath(e.x, e.y, e.z, t.x, t.y, t.z, { mob: e, maxDistance: fr, partial: true });
        var end = p && p.length ? p[p.length - 1] : null;
        navFlag = end && Math.pow(end.x - Math.floor(t.x), 2) + Math.pow(end.z - Math.floor(t.z), 2) <= 2.25 ? 1 : 2;
      }
      return navFlag === 1;
    }
    this.canUse = function () {
      if (recip > 0 && rrand() >= 1 / (2 * Math.ceil(recip / 2))) return false;
      var fr = Ai.followRangeOf(e);
      if (fr <= 0) return false;
      var best = null, bestD = Infinity;
      var cs = getCandidates();
      for (var i = 0; i < cs.length; i++) {
        var c = cs[i];
        if (vbox && Math.abs(c.y - e.y) > vbox) continue;
        if (sight && !Ai.canSee(e, c)) continue;   // TargetPredicate.respectsVisibility
        if (!Ai.canTargetLiving(c, e)) continue;   // s135 gap: acquisition itself must refuse (TargetPredicate.test), not
        var d = Math.hypot(c.x - e.x, c.y - e.y, c.z - e.z);           // just get cleared post-hoc by dropUntargetable --
        if (d > Math.max(fr * Ai.attackScale(c, e), 2)) continue;
        if (livingBox) {
          var hw = fr + ((e.width || 0.6) + (c.width || 0.6)) / 2;
          if (Math.abs(c.x - e.x) > hw || Math.abs(c.z - e.z) > hw ||
              c.y > e.y + (e.height || 1.8) + 4 || c.y + (c.height || 1.8) < e.y - 4) continue;
          d = Math.hypot(c.x - e.x, c.y - (e.y + Ai.eyeOf(e)), c.z - e.z);
        }
        if (d < bestD) { best = c; bestD = d; }                         // a target-goal priority NUMBER lower than the
      }                                                                  // mob's own attack goal (vindicator/piglin/
      if (best && checkNav && !navOk(best, fr)) return false;
      if (best) { e.target = best; unseen = 0; return true; }           // hoglin/spider/...) let it acquire+attack a
      return false;                                                     // creative player in the SAME tick, before the
    };                                                                   // post-hoc clear ever ran (referee-mob-chase).
    this.canContinueToUse = function () {
      if (!e.target || !Ai.canTargetLiving(e.target, e)) return false;
      var d = Math.hypot(e.target.x - e.x, e.target.y - e.y, e.target.z - e.z);
      if (d > Ai.followRangeOf(e)) return false;   // TrackTargetGoal.shouldContinue: dist^2 > followRange^2 (no slack)
      if (mustSee) {
        if (Ai.canSee(e, e.target)) unseen = 0;
        else if (++unseen > maxNoSight) return false;
      }
      return true;
    };
    this.start = function () { unseen = 0; };
    this.stop = function () { e.target = null; };
    this.tick = function () {};
  };

  /**
   * `AttackGoal` (.decomp AttackGoal.java, cat/ocelot-style): MOVE|LOOK, runs every tick while a target lives within 15
   * blocks. Speed 1.33 when 2w < dist < 4, else 0.6 within 15, else 0.8; tryAttack every 20 ticks once within 2*width.
   */
  Ai.AttackGoal = function (e) {
    var tgt = null, cooldown = 0, path = null, idx = 1, repathIn = 0;
    function d2(t) { var dx = t.x - e.x, dy = (t.y === undefined ? e.y : t.y) - e.y, dz = t.z - e.z; return dx * dx + dy * dy + dz * dz; }
    this.canUse = function () { if (!e.target) return false; tgt = e.target; return true; };
    this.canContinueToUse = function () {
      if (!tgt || tgt.removed || tgt.dead) return false;
      return d2(tgt) > 225 ? false : (!!path || this.canUse());
    };
    this.start = function () { path = null; repathIn = 0; };
    this.stop = function () { tgt = null; path = null; };
    this.tick = function () {
      if (!tgt) return;
      // AttackGoal.tick: getLookControl().lookAt(target, 30, 30)
      if (e.look) e.look.setLookAt(tgt.x, (tgt.y === undefined ? e.y : tgt.y) + Ai.eyeOf(tgt), tgt.z, 30 * Math.PI / 180, 30 * Math.PI / 180);
      var w = e.width || 0.6, reach = w * 2 * w * 2, dsq = d2(tgt), spd = 0.8;
      if (dsq > reach && dsq < 16) spd = 1.33; else if (dsq < 225) spd = 0.6;
      if (repathIn <= 0) { path = Ai.findPath(e.x, e.y, e.z, tgt.x, tgt.y, tgt.z, { mob: e }); idx = 1; repathIn = 10; }
      repathIn--;
      if (path && idx < path.length) { Ai.stepToward(e, path[idx], spd); if (Ai.closeTo(e, path[idx])) idx++; else if (idx >= path.length) path = null; }
      else path = null;
      cooldown = Math.max(cooldown - 1, 0);
      if (!(dsq > reach) && cooldown <= 0) {
        cooldown = 20;
        if (NS.EntityRender && NS.EntityRender.swingHand) NS.EntityRender.swingHand(e);
        if (NS.Combat && NS.Combat.mobAttack) NS.Combat.mobAttack(e, tgt);
      }
    };
  };

  /**
   * Vanilla's `UntamedActiveTargetGoal` — the SAME `ActiveTargetGoal` shape
   * `Ai.NearestAttackableTargetGoal` above already builds, refused outright once the mob is
   * TAMED (`.decomp/net/minecraft/entity/ai/goal/UntamedActiveTargetGoal.java`, read in full:
   * `canStart` is `!tameable.isTamed() && super.canStart()`). Wolf's own registerGoals() (D-477,
   * `bje.u()`) uses this TWICE — prey (priority 5) and baby turtles (priority 6) — both wired
   * below with this one wrapper rather than two near-identical hand-written goals, the same
   * reuse `Ai.SpiderTargetGoal`'s own light-level wrapper around `NearestAttackableTargetGoal`
   * already establishes as this file's idiom for "the same base goal, one extra gate".
   */
  Ai.UntamedActiveTargetGoal = function (e, getCandidates, rand) {
    // ctor super(tameable, class, 10, checkVisibility, false, pred): reciprocalChance 10 + the non-Player expand(r,4,r) box (#4149)
    var inner = new Ai.NearestAttackableTargetGoal(e, getCandidates, { reciprocalChance: 10, vertical: 4, rand: rand });
    this.reciprocalChance = inner.reciprocalChance; this.vertical = 4;
    this.canUse = function () { return !e.tamed && inner.canUse(); };
    this.canContinueToUse = function () { return !e.tamed && inner.canContinueToUse(); };
    this.start = function () { inner.start(); };
    this.stop = function () { inner.stop(); };
    this.tick = function () { inner.tick(); };
  };


  /**
   * Vanilla's `HurtByTargetGoal` — retaliate against whoever last hurt this mob. TARGET only.
   *
   * ⚠⚠ D-475 — THE OPTIONAL `rand` ARG IS `ayf` (`NeutralMob`, javap'd this session)'s OWN
   * `startPersistentAngerTimer()`/`PERSISTENT_ANGER_TIME`. Wolf (`bje`) is the only ROSTER
   * entry that implements `ayf` today (`class bje extends ays implements ayf`, read by hand),
   * so anger is gated on `e.type === 'wolf'` here rather than a generic capability flag nothing
   * else sets yet — the same standing simplification D-383's own header already uses for goal
   * TYPES that are real but whose wiring is this session's placement, not a `registerGoals()`
   * read. `bje`'s own `<clinit>` constructs `PERSISTENT_ANGER_TIME` as
   * `ajx.a(20, 39)` (`TimeUtil.rangeOfSeconds`, a UniformInt of `20*20..39*20` ticks), a literal
   * pair, not a guess (rule 3/4) — `Ai.ANGER_TIME_MIN`/`MAX` below are exactly that pair times
   * twenty. `ayf.I_()` (`isAngry()`, default method) is exactly `getRemainingPersistentAngerTime()
   * > 0`, which is why `07n_tame.js`'s `Tm.isAngry` reads `e.angerTime` and nothing else.
   */
  Ai.ANGER_TIME_MIN = 400;   // bje's own PERSISTENT_ANGER_TIME lower bound, 20 * 20 ticks
  Ai.ANGER_TIME_MAX = 780;   // ...upper bound, 39 * 20 ticks — both javap'd, not typed by feel
  Ai.rollAngerTime = function (rand, e) {
    var r = rand || Ai.rndOf(e);
    return Ai.ANGER_TIME_MIN + Math.floor(r() * (Ai.ANGER_TIME_MAX - Ai.ANGER_TIME_MIN + 1));
  };
  Ai.ALERT_RANGE_Y = 10;     // bfk.h()'s own hardcoded AABB.inflate Y half-height, javap'd
  Ai.HurtByTargetGoal = function (e, rand, getPack) {
    this.canUse = function () { return !!e.lastHurtByEntity; };
    this.canContinueToUse = function () { return !!e.target; };
    this.start = function () {
      var attacker = e.lastHurtByEntity;
      if (e.type === 'creeper' && attacker && attacker.type === 'goat') return;   // #2610 CreeperEntity.setTarget refuses a GoatEntity
      e.target = attacker;
      // D-475 — `ayf.a(ServerLevel,boolean)` (`updatePersistentAnger`, javap'd) sets a FRESH
      // timer whenever the persistent-anger target changes; this engine has exactly one
      // possible attacker (`Cb.hurt`'s own header: mob-vs-mob damage is unbuilt), so "changed"
      // and "picked a target at all" are the same event here.
      // D-486 — `bin`'s own <clinit> (IronGolem, javap'd) builds the SAME `ajx.a(20, 39)`
      // range wolf's `bje` does, so golem shares ANGER_TIME_MIN/MAX rather than a guessed pair.
      // QUEUE 0.2 (G18 mobs) -- BeeEntity.chooseAngerTime uses the SAME ajx.a(20,39) range
      // wolf/iron_golem already share (.decomp BeeEntity.java line 117, ANGER_TIME_RANGE) --
      // one more member of this same whitelist, not a new formula.
      if (e.type === 'wolf' || e.type === 'iron_golem' || e.type === 'bee' || e.type === 'zombified_piglin') e.angerTime = Ai.rollAngerTime(rand);
      // D-477 — `bfk.h()` (alertOthers), javap'd this pass — see the header above. Every OTHER
      // live mob of the SAME type, sharing the SAME tame/owner status, with no target of its
      // own, within (followRange, ALERT_RANGE_Y, followRange) of this one, is alerted too.
      if (getPack) {
        var fr = Ai.followRangeOf(e);
        var pack = getPack();
        for (var i = 0; i < pack.length; i++) {
          var o = pack[i];
          if (!o || o === e || o.target || o.removed || o === attacker) continue;
          if (!!o.tamed !== !!e.tamed) continue;
          if (e.tamed && o.owner !== e.owner) continue;
          var dx = Math.abs(o.x - e.x), dz = Math.abs(o.z - e.z), dy = Math.abs(o.y - e.y);
          if (dx > fr || dz > fr || dy > Ai.ALERT_RANGE_Y) continue;
          o.target = attacker;
        }
      }
    };
    this.stop = function () { e.lastHurtByEntity = null; };
    this.tick = function () {};
  };

  // ════════════════ ROW 0.2 REMAINDER — iron golem, javap'd off `.decomp/net/minecraft/entity/
  // passive/IronGolemEntity.java` + `.decomp/net/minecraft/entity/ai/goal/{TrackIronGolemTargetGoal,
  // UniversalAngerGoal,IronGolemLookGoal,WanderAroundPointOfInterestGoal,IronGolemWanderAroundGoal}.java`
  // + `.decomp/net/minecraft/entity/mob/Angerable.java` + `.decomp/net/minecraft/entity/passive/
  // VillagerEntity.java` + `.decomp/net/minecraft/village/{VillagerGossips,VillageGossipType}.java`.
  //
  // ⚠⚠ THE ONE-PLAYER COLLAPSE, USED THROUGHOUT BELOW. `EL.aiCtx`'s own header already leans on
  // "this engine has exactly one player" for `players()`; `Angerable.shouldAngerAt` normally has
  // two branches — `isUniversallyAngry()` (angry at nobody in particular, so ANY player counts)
  // or `angryAt.equals(target.getUuid())` (angry at ONE specific UUID) — and both branches can
  // only ever resolve to the SAME single player here, since only `NS.Player` can ever hurt
  // anything (`14j_combat.js`'s own `Cb.mobAttack` header: mob-vs-mob is unbuilt). The two
  // branches collapse to one: `e.angerTime > 0` is `shouldAngerAt(NS.Player)` in full, and
  // `e.angryAt` only ever needs to distinguish null (universal) from non-null (specific) for
  // `isUniversallyAngry`, never WHICH specific target — there is only one it could be.

  /**
   * `Angerable.universallyAnger()` — `stopAnger()` (attacker/angryAt/target cleared, angerTime
   * zeroed) then `chooseRandomAngerTime()` (a fresh roll off `bin`'s own `ANGER_TIME_RANGE`,
   * the SAME `ajx.a(20,39)` range `Ai.rollAngerTime` already reproduces for wolf, D-486's own
   * javap). `angryAt` is left null — `isUniversallyAngry()`'s own gate.
   */
  Ai.universallyAnger = function (e, rand) {
    e.target = null; e.lastHurtByEntity = null; e.angryAt = null;
    e.angerTime = Ai.rollAngerTime(rand);
  };

  /**
   * Vanilla's `UniversalAngerGoal` (TARGET priority 4 in `bin.u()`, D-486's own javap already
   * named the literal argument) — javap'd in full off `.decomp/.../UniversalAngerGoal.java`.
   * `bin.u()` builds it `new UniversalAngerGoal<>(this, false)`: `triggerOthers` IS FALSE for
   * the golem. `bje.u()` (wolf) builds `new UniversalAngerGoal<>(this, true)` instead — the
   * `triggerOthers` ctor arg below is exactly that flag, no longer collapsed away (loop/
   * wolfpounce).
   *
   * ⚠ NO `setControls(...)` CALL EXISTS IN THE DECOMPILED CLASS — it declares no flags, so it
   * runs concurrently with whatever TARGET-flag goal is active (`HurtByTargetGoal` included);
   * `flags=0` below is that fact, not a shortcut.
   *
   * ⚠ `getLastAttackedTime()`'s OWN "this is a NEW attack, not the same one already reacted to"
   * signal is `e.hurtSeq`, a plain counter `Cb.notifyHurt` increments once per real landed hit
   * (D-391's own hook, extended this pass) — the closest live analogue this engine has to
   * vanilla's per-tick `lastAttackedTime` without inventing a fake tick clock.
   *
   * `getOthersInRange()` (.decomp, read in full): `Box.from(pos).expand(followRange, 10.0,
   * followRange)` (`Ai.followRangeOf`/`Ai.ALERT_RANGE_Y`, the exact same box shape
   * `HurtByTargetGoal`'s own pack alert already uses) over every entity of `this.mob.getClass()`
   * except this mob itself, filtered only by `EntityPredicates.EXCEPT_SPECTATOR` — NO tame/
   * owner check (that filter is `HurtByTargetGoal.alertOthers`'s own addition, not this class's)
   * — then `Angerable::universallyAnger` on each, a DIRECT call bypassing each target's own
   * goal instance entirely, same as here. `getPack`, when supplied, stands in for that
   * `getEntitiesByClass` scan (caller filters by type; this goal only filters by range/self).
   */
  Ai.universalAngerRule = function () {
    var C = NS.Commands;
    if (C && typeof C.ruleGet === 'function') return C.ruleGet('universalAnger') === 'true';
    var r = NS.DATA && NS.DATA.gameRules && NS.DATA.gameRules.universalAnger;
    return !!r && r.d === 'true';
  };
  /** `Angerable.tickAngerLogic`: a dead player target with GameRules.FORGIVE_DEAD_PLAYERS (default true)
   *  -> `stopAnger()` (attacker/angryAt/target cleared, angerTime zeroed). Called per mob tick. */
  Ai.forgiveDeadPlayerRule = function () {
    var C = NS.Commands;
    if (C && typeof C.ruleGet === 'function') return C.ruleGet('forgiveDeadPlayers') !== 'false';
    var r = NS.DATA && NS.DATA.gameRules && NS.DATA.gameRules.forgiveDeadPlayers;
    return !r || r.d === 'true';
  };
  Ai.forgiveDeadPlayer = function (e) {
    if (!(e.angerTime > 0) || !NS.Player || !NS.Player.dead) return;
    if (e.target && e.target !== NS.Player) return;
    if (!Ai.forgiveDeadPlayerRule()) return;
    e.target = null; e.lastHurtByEntity = null; e.angryAt = null; e.angerTime = 0;
  };
  Ai.UniversalAngerGoal = function (e, rand, triggerOthers, getPack) {
    var lastSeen = -1;
    this.canUse = function () {
      // vanilla canStart(): getBoolean(GameRules.UNIVERSAL_ANGER) && canStartUniversalAnger() (default false)
      return Ai.universalAngerRule() && e.lastHurtByEntity === NS.Player && (e.hurtSeq || 0) > lastSeen;
    };
    this.canContinueToUse = function () { return false; };  // one-shot, same as the jar's own instant-return goal
    this.start = function () {
      lastSeen = e.hurtSeq || 0;
      Ai.universallyAnger(e, rand);
      if (triggerOthers && getPack) {
        var fr = Ai.followRangeOf(e);
        var pack = getPack();
        for (var i = 0; i < pack.length; i++) {
          var o = pack[i];
          if (!o || o === e || o.removed) continue;
          var dx = Math.abs(o.x - e.x), dz = Math.abs(o.z - e.z), dy = Math.abs(o.y - e.y);
          if (dx > fr || dz > fr || dy > Ai.ALERT_RANGE_Y) continue;
          Ai.universallyAnger(o, rand);
        }
      }
    };
    this.stop = function () {};
    this.tick = function () {};
  };

  /**
   * The ANGRY-PLAYER half of `bin.u()`'s TARGET priority 3 — `ActiveTargetGoal<>(this,
   * PlayerEntity.class, 10, true, false, this::shouldAngerAt)`. `HurtByTargetGoal` (priority 2)
   * already retaliates against the exact attacker the instant it lands; this goal's own real
   * job is RE-ACQUIRING `NS.Player` once that direct target is gone (killed, teleported,
   * `HurtByTargetGoal.stop()` clearing `e.target`) while `e.angerTime` — universal or specific,
   * collapsed to one condition per the header above — is still counting down.
   */
  Ai.AngryPlayerTargetGoal = function (e, gate) {   // gate: extra canStart+shouldContinue condition (bee: !hasStung)
    // ActiveTargetGoal(Player,10,mustSee=true,..,shouldAngerAt): 1/5 roll, sight-gated, drops after 60 unseen ticks (#3677).
    // shouldAngerAt collapsed to angerTime>0 (one player, header above).
    var inner = new Ai.NearestAttackableTargetGoal(e, function () {
      return e.angerTime > 0 && !(gate && !gate()) && NS.Player ? [NS.Player] : [];
    }, { sight: true, mustSee: true, reciprocalChance: 10 });
    this.inner = inner;   // read by goalrostercheck
    this.canUse = function () { return !e.target && inner.canUse(); };
    this.canContinueToUse = function () { return !(gate && !gate()) && inner.canContinueToUse(); };
    this.start = function () { inner.start(); };
    this.stop = function () { inner.stop(); };
    this.tick = function () {};
  };

  /**
   * Vanilla's `TrackIronGolemTargetGoal` (`DefendVillageTargetGoal`, TARGET priority 1 — ahead
   * of even `HurtByTargetGoal`) — javap'd off `.decomp/.../TrackIronGolemTargetGoal.java`.
   * `canStart` scans every villager within the golem's own bounding box expanded (10,8,10) for
   * one whose `getReputation(player)` is `<= -100` (the jar's own literal, `$$6 <= -100`), and
   * targets that player — `Village.getReputation` below is the exact sum `VillagerGossips.
   * getReputationFor(uuid, alwaysTrue)` computes (every gossip type counts, matching the jar's
   * own `$$4.getReputation($$5)` call with no type filter).
   */
  Ai.TrackIronGolemTargetGoal = function (e, ctx) {
    var found = null;   // vanilla's `this.target` field: never cleared between canStart calls
    // getPlayers(attackable, golem, box.expand(10,8,10)): the PLAYER's own box must meet the golem's expanded one.
    function playerInBox(p) {
      var gw = (e.width || 1.4) / 2, gh = e.height || 2.7, pw = (p.width || 0.6) / 2, ph = p.height || 1.8;
      return Math.abs(p.x - e.x) <= 10 + gw + pw && Math.abs(p.z - e.z) <= 10 + gw + pw &&
        p.y <= e.y + gh + 8 && p.y + ph >= e.y - 8;
    }
    this.canUse = function () {
      var P = NS.Player;
      if (!P || !NS.Village) return false;
      if (Ai.canTargetLiving(P) && playerInBox(P) && Math.hypot(P.x - e.x, P.y - e.y, P.z - e.z) <= 64) {
        var vs = ctx.villagers ? ctx.villagers() : [];
        for (var i = 0; i < vs.length; i++) {
          var v = vs[i];
          if (v.dead || v.removed) continue;
          if (Math.abs(v.x - e.x) > 10 || Math.abs(v.y - e.y) > 8 || Math.abs(v.z - e.z) > 10) continue;
          if (NS.Village.getReputation(v) <= -100) { found = P; break; }
        }
      }
      // return: target != null && (not a player || !spectator && !creative)
      return !!found && Ai.canTargetLiving(found);
    };
    // TrackTargetGoal.shouldContinue: attackable target still within follow range (checkVisibility=false)
    this.canContinueToUse = function () {
      var t = e.target;
      if (!t || !Ai.canTargetLiving(t)) return false;
      var fr = Ai.followRangeOf(e);
      return !(fr > 0 && Math.hypot(t.x - e.x, t.y - e.y, t.z - e.z) > fr);
    };
    this.start = function () { e.target = found; };
    this.stop = function () {};
    this.tick = function () {};
  };

  /** `IronGolemEntity.setLookingAtVillager` (:253-261) / `handleStatus` 11 and 34 (:241-243): 400 or 0. */
  Ai.setLookingAtVillager = function (e, on) { e.lookingAtVillagerTicks = on ? 400 : 0; };
  Ai.golemStatus = function (e, status) {
    if (status === 11) e.lookingAtVillagerTicks = 400;
    else if (status === 34) e.lookingAtVillagerTicks = 0;
  };

  /**
   * Vanilla's `IronGolemLookGoal` (`bek`, MOVE|LOOK controls — the golem plants its feet to
   * offer a flower) — javap'd off `.decomp/.../IronGolemLookGoal.java`. `canStart`: daytime,
   * `random.nextInt(8000) == 0`, and a villager within the golem's own box expanded (6,2,6),
   * `TargetPredicate.createNonAttackable().setBaseMaxDistance(6.0)`. Holds `MAX_LOOK_COOLDOWN`
   * (400) ticks via `Ai.setLookingAtVillager` (`e.lookingAtVillagerTicks`, vanilla's
   * `lookingAtVillagerTicksLeft`, decayed by `EL.tickAnim` = `tickMovement`; read by the model's
   * right-arm pose and `ER.ironGolemFlowerFor`'s poppy).
   *
   * `World.isDay()` is the real one since D-511 (`NS.Sky.isDay`: ambientDarkness < 4).
   */
  Ai.IronGolemLookGoal = function (e, ctx) {
    var target = null, countdown = 0;
    function isDay() {   // D-511: World.isDay() itself — ambientDarkness < 4 (NS.Sky.isDay)
      return !!(NS.Sky && NS.Sky.isDay && NS.Sky.isDay());
    }
    this.canUse = function () {
      if (!isDay()) return false;
      var r = ctx.random || Ai.rndOf(e);
      if (Math.floor(r() * 8000) !== 0) return false;
      var vs = ctx.villagers ? ctx.villagers() : [];
      var best = null, bestD = 36;   // 6.0 ^ 2 — TargetPredicate.setBaseMaxDistance(6.0)
      for (var i = 0; i < vs.length; i++) {
        var v = vs[i];
        var dx = v.x - e.x, dy = v.y - e.y, dz = v.z - e.z;
        var d = dx * dx + dy * dy + dz * dz;
        if (d <= bestD) { best = v; bestD = d; }
      }
      target = best;
      return !!target;
    };
    this.canContinueToUse = function () { return countdown > 0; };
    this.start = function () { countdown = 400; Ai.setLookingAtVillager(e, true); };
    this.stop = function () { Ai.setLookingAtVillager(e, false); target = null; };
    this.tick = function () { if (target) e.lookTarget = target; countdown--; };
  };

  /**
   * `WanderNearTargetGoal` (`bei`, MOVE-only, priority 2 in `bin.u()` — moves the golem toward
   * a point NEAR its own attack target) — javap'd off `.decomp/.../WanderNearTargetGoal.java`.
   * Only relevant when `MeleeAttackGoal` (MOVE priority 1, always claims MOVE first whenever
   * `e.target` exists) itself cannot run; this engine's `MeleeAttackGoal` has no separate
   * "target unreachable" refusal, so this goal is realistically always shadowed by priority 1
   * the same tick; ported faithfully (findTo point + path, nav-idle/alive continue) and left wired.
   */
  Ai.WanderNearTargetGoal = function (e, speed, maxDistanceSq, rand) {
    var path = null, idx = 1, tx = 0, ty = 0, tz = 0, target = null;
    rand = rand || Ai.rndOf(e);
    function dsq() { var dx = target.x - e.x, dy = target.y - e.y, dz = target.z - e.z; return dx * dx + dy * dy + dz * dz; }
    this.canUse = function () {   // NoPenaltyTargeting.findTo(16, 7, target.getPos(), PI/2); null refuses
      target = e.target;
      if (!target || dsq() > maxDistanceSq) return false;
      var pt = e.positionTarget, pr = e.positionTargetRange;
      e.positionTarget = { x: target.x - 0.5, y: target.y - 0.5, z: target.z - 0.5 }; e.positionTargetRange = undefined;   // findTo takes ofBottomCenter(pt)
      var p; try { p = Ai.findTowardPositionTarget(e, rand, 16, 7, Math.PI / 2); } finally { e.positionTarget = pt; e.positionTargetRange = pr; }
      if (!p) return false;
      tx = p.x; ty = p.y; tz = p.z; return true;
    };
    this.canContinueToUse = function () {   // !nav.isIdle && target.isAlive && distSq < max^2
      return !!path && idx < path.length && !!target && !target.dead && !target.removed && dsq() < maxDistanceSq;
    };
    this.start = function () { path = Ai.findPath(e.x, e.y, e.z, tx, ty, tz, { mob: e, partial: true }); idx = 1; };
    this.stop = function () { path = null; target = null; };
    this.tick = function () {
      if (!path || idx >= path.length) { path = null; return; }
      Ai.stepToward(e, path[idx], speed);
      idx = Ai.advancePathNode(e, path, idx);
    };
  };

  /**
   * `WanderAroundPointOfInterestGoal(mob, speed, false)` (.decomp, read whole): `WanderAroundGoal(mob, speed, 10, ...)`;
   * canStart refuses within 1 section of an occupied POI (`isNearOccupiedPointOfInterest(pos)`); the wander target is
   * `NoPenaltyTargeting.findTo(10, 7, centre of the section (within 2) nearest an occupied POI, PI/2)`, null when the
   * mob's own section is already the closest (`getPosClosestToOccupiedPointOfInterest`).
   */
  Ai.WanderAroundPointOfInterestGoal = function (e, speed, rand) {
    var inner = new Ai.WaterAvoidingRandomStrollGoal(e, speed, rand, undefined, 10);
    function sec(v) { return Math.floor(v) >> 4; }
    function dist(sx, sy, sz) {   // getDistanceFromNearestOccupied, capped at 7
      var ps = NS.Poi && NS.Poi.occupiedPositions ? NS.Poi.occupiedPositions() : [], d = 7;
      for (var i = 0; i < ps.length; i++) d = Math.min(d, Math.max(Math.abs(sec(ps[i].x) - sx), Math.abs(sec(ps[i].y) - sy), Math.abs(sec(ps[i].z) - sz)));
      return d;
    }
    var sx = 0, sy = 0, sz = 0;
    var pending = null;
    function find() {
      var best = null, bd = dist(sx, sy, sz);
      for (var dx = -2; dx <= 2; dx++) for (var dy = -2; dy <= 2; dy++) for (var dz = -2; dz <= 2; dz++) {
        var d = dist(sx + dx, sy + dy, sz + dz);
        if (d < bd) { bd = d; best = { x: (sx + dx) * 16 + 8, y: (sy + dy) * 16 + 8, z: (sz + dz) * 16 + 8 }; }
      }
      if (!best) return null;
      var pt = e.positionTarget, pr = e.positionTargetRange;
      e.positionTarget = best; e.positionTargetRange = undefined;
      try { return Ai.findTowardPositionTarget(e, rand, 10, 7, Math.PI / 2); } finally { e.positionTarget = pt; e.positionTargetRange = pr; }
    }
    inner.finder = function () { var t = pending; pending = null; return t; };
    this.canUse = function () {   // WanderAroundGoal.canStart: roll, then getWanderTarget() == null refuses
      sx = sec(e.x); sy = sec(e.y); sz = sec(e.z);
      if (dist(sx, sy, sz) <= 1 || !inner.canUse()) return false;
      pending = find();
      return !!pending;
    };
    this.canContinueToUse = function () { return inner.canContinueToUse(); };
    this.start = function () { inner.start(); };
    this.stop = function () { inner.stop(); };
    this.tick = function () { inner.tick(); };
  };

  /**
   * `IronGolemWanderAroundGoal` (`bdv`, MOVE priority 4 in `bin.u()`) — javap'd off
   * `.decomp/.../IronGolemWanderAroundGoal.java`. The real goal's own `getWanderTarget` is a
   * three-way split (30% a random nearby point, else 70/30 between a villager's position and a
   * random POI-anchored block, `bdv`'s own `0.3F`/`0.7F` literals, both read above) walking this
   * engine's UNBUILT point-of-interest storage for two of those three branches — no "poi" or
   * "PointOfInterest" token exists anywhere else in `src/`, confirmed this pass; D-486's own
   * header already named this exact gap and left a plain `WaterAvoidingRandomStrollGoal` in
   * this goal's place.
   *
   * ⚠ SIMPLIFICATION, NAMED NOT GUESSED: what IS ported here is the one branch that needs no
   * POI storage — bias 70% of the time toward a villager this engine's own `Village.
   * canSummonGolem` deems "eligible" (the jar's own `canVillagerSummonGolem` predicate,
   * `VillagerEntity.canSummonGolem`), stepping toward it directly rather than through
   * `NoPenaltyTargeting`/pathfinding. `canUse` refuses (falls through to the plain
   * `WaterAvoidingRandomStrollGoal` still wired one priority below) whenever the 30% random
   * branch rolls, or no eligible villager is in range — this goal never invents a POI-anchored
   * fallback vanilla itself would have reached for.
   */
  Ai.IronGolemWanderAroundGoal = function (e, speed, ctx) {
    var target = null, inner = new Ai.WaterAvoidingRandomStrollGoal(e, speed, ctx.random, null, 240), mode = null;   // super(mob, speed, 240, false)
    this.canUse = function () {
      var r = ctx.random || Ai.rndOf(e);
      if (mode) return false;
      if (!inner.canUse()) return false;              // WanderAroundGoal.canStart's 1-in-120 roll, shared by every branch
      if (r() < 0.3) { mode = inner; return true; }   // the jar's own 30% "random point" branch — the plain stroll's walk, here
      var vs = ctx.villagers ? ctx.villagers() : [];
      var eligible = [];
      var now = (NS.Sky && typeof NS.Sky.dayTime === 'number') ? NS.Sky.dayTime : 0;
      for (var i = 0; i < vs.length; i++) {
        var v = vs[i];
        var dx = v.x - e.x, dz = v.z - e.z;
        if (dx * dx + dz * dz > 1024) continue;         // `bin.getBoundingBox().expand(32.0)`'s own literal
        if (NS.Village && NS.Village.canSummonGolem(v, now)) eligible.push(v);
      }
      if (!eligible.length) { mode = inner; return true; }   // vanilla: both branches null -> findRandomInRange, a target is always found
      target = eligible[Math.floor(r() * eligible.length)];
      return true;
    };
    this.canContinueToUse = function () { return mode ? inner.canContinueToUse() : false; };  // villager step is one-shot; the stroll runs its path
    this.start = function () { if (mode) inner.start(); else if (target) Ai.stepToward(e, target, speed); };
    this.stop = function () { if (mode) inner.stop(); mode = null; target = null; };
    this.tick = function () { if (mode) inner.tick(); };
  };


  /**
   * Vanilla's `OwnerHurtByTargetGoal` and `OwnerHurtTargetGoal` (`bfp`/`bfq`, javap'd this
   * pass, both read straight off `bje.u()`'s own TARGET priorities 1/2 — `HurtByTargetGoal`
   * itself is priority 3, the SAME read, D-477): a tamed, un-sitting wolf retaliates against
   * whoever last hurt its OWNER (`bfp`: `ays.fA()`/`axy.dM()`/`dN()`, javap'd —
   * `getOwner()`/`getLastHurtByMob()`/`getLastHurtByMobTimestamp()`) and joins in on whatever
   * its OWNER last attacked (`bfq`, the identical shape off `dO()`/`dP()` —
   * `getLastHurtMob()`/`getLastHurtMobTimestamp()`). Both classes are otherwise byte-identical:
   * same canUse shape, same `q()`/`fB()` tame/not-sitting gate `Ai.FollowOwnerGoal`'s own
   * `findOwner()` already reproduces.
   *
   * ⚠ THE TIMESTAMP COMPARE IS A REFERENCE COMPARE HERE, NAMED, NOT SILENTLY DROPPED. Vanilla
   * diffs an incrementing tick counter so the SAME attacker hitting the owner twice still
   * re-triggers; this engine has no such counter (D-391's own `notifyHurt` hook is "set on the
   * event, clear on stop", the idiom `Ai.HurtByTargetGoal` above already uses instead of a
   * timestamp), so each goal instance remembers the object it last reacted to (`seen`) and
   * re-fires only when the owner's field points somewhere new — correct for every case this
   * engine can produce today (one attacker instance stays the mob's own target for as long as
   * the fight lasts, so "the same attacker hits again" and "still fighting the same attacker"
   * are the same state here) and OWNED not to be the general case. `player.lastHurtByEntity`/
   * `player.lastHurtMob` are written by `Cb.mobAttack`/`Cb.attack` (14j_combat.js, this pass)
   * the same way `Cb.notifyHurt` already writes a mob's.
   */
  // WolfEntity.canAttackWithOwner (.decomp WolfEntity.java:500): never creeper/ghast, a tamed wolf (own owner is the only owner here),
  // any tamed tameable/horse (all carry e.tamed); a player target only while PvP-able (owner is the player => never the player itself).
  function canAttackWithOwner(t) {
    if (!t) return false;
    if (t.type === 'creeper' || t.type === 'ghast') return false;
    if (t === NS.Player || t.type === 'player') return false;
    return !t.tamed;
  }
  Ai.OwnerHurtByTargetGoal = function (e, getPlayers) {
    var seen = null;
    function owner() {
      if (!e.tamed || e.owner !== 'player' || e.sitting) return null;
      var ps = getPlayers ? getPlayers() : [];
      return (ps && ps[0]) || null;
    }
    this.canUse = function () {
      var o = owner();
      return !!(o && o.lastHurtByEntity && o.lastHurtByEntity !== seen && canAttackWithOwner(o.lastHurtByEntity));
    };
    this.canContinueToUse = function () { return !!e.target; };
    this.start = function () { var o = owner(); seen = o ? o.lastHurtByEntity : seen; e.target = seen; };
    this.stop = function () { e.target = null; };
    this.tick = function () {};
  };
  Ai.OwnerHurtTargetGoal = function (e, getPlayers) {
    var seen = null;
    function owner() {
      if (!e.tamed || e.owner !== 'player' || e.sitting) return null;
      var ps = getPlayers ? getPlayers() : [];
      return (ps && ps[0]) || null;
    }
    this.canUse = function () {
      var o = owner();
      return !!(o && o.lastHurtMob && o.lastHurtMob !== seen && canAttackWithOwner(o.lastHurtMob));
    };
    this.canContinueToUse = function () { return !!e.target; };
    this.start = function () { var o = owner(); seen = o ? o.lastHurtMob : seen; e.target = seen; };
    this.stop = function () { e.target = null; };
    this.tick = function () {};
  };

  /**
   * Vanilla's `AvoidEntityGoal` — flee any entity `isAvoiding()` accepts once it is within
   * `range` blocks, keep fleeing until the chosen path runs out, full stop.
   *
   * KW-45 (session 152 fixed `AvoidLlamaGoal` only, via an opt-in `fleeOpts.random`; this pass
   * — cloud feed (a) — makes the same fix the ONE always-on behaviour for every caller: cat/
   * ocelot/rabbit/fox/panda/wolf are all vanilla `AnimalEntity` subclasses (`TameableEntity` for
   * cat/ocelot/wolf), and no other `Ai.AvoidEntityGoal` caller exists today). Re-derived against
   * `.decomp/net/minecraft/entity/ai/goal/FleeEntityGoal.java` (every caller's own vanilla class
   * extends it) + `.decomp/net/minecraft/entity/ai/NoPenaltyTargeting.java#findFrom` +
   * `.decomp/net/minecraft/entity/ai/FuzzyPositions.java` + `.decomp/net/minecraft/entity/ai/
   * TargetPredicate.java`, whole classes read. FOUR independent mistakes, not one:
   * (1) `canStart()`'s threat search is `world.getEntitiesByClass(classToFleeFrom,
   * mob.getBoundingBox().expand(range, 3.0, range), ...)` — a 3D BOX whose vertical half-height
   * is a FIXED 3 blocks, unrelated to `range` — not a flat 2D circle that ignores height
   * entirely (the old `Math.hypot(dx,dz) <= range` test). (2) the box's occupants are narrowed
   * by `TargetPredicate.createAttackable()`, whose `respectsVisibility` default requires
   * `getVisibilityCache().canSee(candidate)` — a threat behind a wall never counts. (3)
   * `world.getClosestEntity` then picks the NEAREST surviving candidate, not the first one the
   * threat list happens to enumerate. (4) the escape point is `NoPenaltyTargeting.findFrom(mob,
   * 16, 7, threatPos)`: `FuzzyPositions.guessBest` tries ALL 10 fuzzed candidates (a
   * `Math.PI/2`-cone horizontal fuzz away from the threat, `FuzzyPositions.localFuzz`, PLUS an
   * independent ±7 vertical fuzz the old code dropped entirely) and keeps the HIGHEST-scoring
   * one by `PathAwareEntity.getPathfindingFavor(pos, world)` — 0.0F for every mob by default
   * (so, since `guessBest`'s comparison is a strict `>`, the first valid candidate effectively
   * wins) EXCEPT `AnimalEntity` (`.decomp/net/minecraft/entity/passive/AnimalEntity.java:82-84`
   * — every current caller), which scores 10.0F for grass directly underfoot, else
   * `getBrightness(pos) - 0.5F` — `Ai.animalPathfindingFavor` below. A candidate that isn't
   * strictly FARTHER from the threat than the mob already is gets the whole goal refused
   * outright (`canStart`'s own `squaredDistanceTo` gate) — no fallback straight-line point of
   * any kind: if all 10 candidates fail (or the winner isn't reachable), vanilla's mob simply
   * doesn't flee that attempt, and neither does this one.
   */
  function avoidFleeFuzz(h, v, dx, dz, angle, rand) {
    var yaw = Math.atan2(dz, dx) - Math.PI / 2;
    var a = yaw + (2 * rand() - 1) * angle;
    var r = Math.sqrt(rand()) * Math.SQRT2 * h;
    var ox = -r * Math.sin(a), oz = r * Math.cos(a);
    if (Math.abs(ox) > h || Math.abs(oz) > h) return null;
    var oy = Math.floor(rand() * (2 * v + 1)) - v;   // FuzzyPositions.localFuzz's own vertical fuzz
    return { x: Math.floor(ox), y: oy, z: Math.floor(oz) };
  }
  Ai.AVOID_FLEE_FIND_H = 16;          // NoPenaltyTargeting.findFrom's own hardcoded search radius
  Ai.AVOID_FLEE_FIND_V = 7;           // ...own vertical half-range
  Ai.AVOID_FLEE_ANGLE = Math.PI / 2;  // FuzzyPositions.localFuzz's own cone half-angle, away from the threat
  Ai.AVOID_BOX_V = 3;                 // FleeEntityGoal.canStart's own fixed vertical box half-height
  /** `PathAwareEntity.getPathfindingFavor(pos, world)` for an `AnimalEntity` (every current
   *  `Ai.AvoidEntityGoal` caller): grass directly below wins outright; else the real
   *  `DimensionType.getBrightness(level)` curve at ambientLight 0 (overworld/end): f=level/15,
   *  f/(4-3f). */
  Ai.PATHFINDING_FAVOR_GRASS = 10.0;
  /** `MooshroomEntity.getPathfindingFavor`: mycelium underfoot 10.0F, else `getBrightness(pos) - 0.5F`. */
  Ai.mooshroomPathfindingFavor = function (x, y, z) {
    var W = NS.World, R = NS.Reg, S = NS.States;
    if (W && W.getBlock && R && R.id && S && S.block && R.id.mycelium != null &&
        S.block[W.getBlock(x, y - 1, z)] === R.id.mycelium) return Ai.PATHFINDING_FAVOR_GRASS;
    var lvl = (W && W.rawBrightness) ? W.rawBrightness(x, y, z) : 15;
    var f = lvl / 15;
    return f / (4 - 3 * f) - 0.5;
  };
  /** `StriderEntity.getPathfindingFavor`: a lava cell 10.0F; else -inf while the strider is in lava, 0 out of it. */
  Ai.striderPathfindingFavor = function (e) {
    return function (x, y, z) {
      if (NS.States.block[NS.Physics.blockAt(x, y, z)] === NS.Reg.id.lava) return Ai.PATHFINDING_FAVOR_GRASS;
      return e.inLava ? -Infinity : 0;
    };
  };
  Ai.animalPathfindingFavor = function (x, y, z) {
    var W = NS.World, R = NS.Reg, S = NS.States;
    if (W && W.getBlock && R && R.id && S && S.block) {
      var below = W.getBlock(x, y - 1, z);
      if (S.block[below] === R.id.grass_block) return Ai.PATHFINDING_FAVOR_GRASS;
    }
    var lvl = (W && W.rawBrightness) ? W.rawBrightness(x, y, z) : 15;
    var f = lvl / 15;
    return f / (4 - 3 * f) - 0.5;
  };
  /** `instanceof HostileEntity` for a spawn-category 'monster' type: these Monsters are NOT HostileEntity
   *  subclasses (.decomp): slime/magma_cube (MobEntity), ghast/phantom (FlyingEntity), shulker (GolemEntity),
   *  hoglin (AnimalEntity), ender_dragon (MobEntity). */
  var NOT_HOSTILE_ENTITY = { slime: 1, magma_cube: 1, ghast: 1, phantom: 1, shulker: 1, hoglin: 1, ender_dragon: 1 };
  Ai.isHostileEntity = function (type) {
    return NS.Spawn.categoryOf(type) === 'monster' && !NOT_HOSTILE_ENTITY[type];
  };
  /** `HostileEntity.getPathfindingFavor(pos, world)` (.decomp HostileEntity.java:81-84):
   *  `0.5F - getBrightness(pos)` — the OPPOSITE preference from `Ai.animalPathfindingFavor`
   *  (darker wins, no grass term at all). Creeper is the one `Ai.AvoidEntityGoal` caller that
   *  is a `HostileEntity`, not an `AnimalEntity` (it flees cats/ocelots) — its own call site
   *  passes this in as `fleeOpts.favor`. */
  Ai.hostilePathfindingFavor = function (x, y, z) {
    var W = NS.World;
    var lvl = (W && W.rawBrightness) ? W.rawBrightness(x, y, z) : 15;
    var f = lvl / 15;
    return 0.5 - (f / (4 - 3 * f));
  };
  /**
   * `AvoidSunlightGoal` (.decomp AvoidSunlightGoal.java): canStart = `world.isDay()` && empty head
   * slot; start/stop set `MobNavigation.avoidSunlight` (here `e.navAvoidSunlight`, the flag the
   * navigation reads). No controls.
   */
  Ai.AvoidSunlightGoal = function (e) {
    this.canUse = function () {
      var Eq = NS.Equip, IT = NS.Items;
      if (!(NS.Sky && NS.Sky.isDay && NS.Sky.isDay())) return false;
      return !(Eq && Eq.ready && IT && Eq.getEquipped(e, IT.HEAD));
    };
    this.canContinueToUse = this.canUse;   // Goal.shouldContinue defaults to canStart
    this.tick = function () {};
    this.start = function () { e.navAvoidSunlight = true; };
    this.stop = function () { e.navAvoidSunlight = false; };
  };
  /**
   * `EscapeSunlightGoal` (.decomp EscapeSunlightGoal.java): no target, day, on fire, sky visible at
   * the feet, empty head slot; `locateShadedPos` = 10 draws of (nextInt(20)-10, nextInt(6)-3,
   * nextInt(20)-10), first with no sky and `getPathfindingFavor < 0` wins. MOVE.
   */
  Ai.EscapeSunlightGoal = function (e, speed, random, favor) {
    var rand = random || Ai.rndOf(e);
    favor = favor || Ai.hostilePathfindingFavor;
    var path = null, idx = 1;
    this.canUse = function () {
      if (e.target) return false;
      if (!(NS.Sky && NS.Sky.isDay && NS.Sky.isDay())) return false;
      if (!e.isOnFire) return false;
      var W = NS.World, bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
      if (!(W && W.canSeeSky && W.canSeeSky(bx, by, bz))) return false;
      var Eq = NS.Equip, IT = NS.Items;
      if (Eq && Eq.ready && IT && Eq.getEquipped(e, IT.HEAD)) return false;
      for (var i = 0; i < 10; i++) {
        var x = bx + Math.floor(rand() * 20) - 10, y = by + Math.floor(rand() * 6) - 3, z = bz + Math.floor(rand() * 20) - 10;
        if (!W.canSeeSky(x, y, z) && favor(x, y, z) < 0) {
          var cp = Ai.findPath(e.x, e.y, e.z, x + 0.5, y, z + 0.5, { mob: e });
          if (!cp || cp.length < 2) return false;   // startMovingTo: no path -> navigation idle
          path = cp; idx = 1;
          return true;
        }
      }
      return false;
    };
    this.canContinueToUse = function () { return !!path && idx < path.length; };   // !navigation.isIdle()
    this.start = function () { idx = 1; };
    this.stop = function () { path = null; };
    this.tick = function () {
      if (!path || idx >= path.length) { path = null; return; }
      Ai.stepToward(e, path[idx], speed);
      idx = Ai.advancePathNode(e, path, idx);
    };
  };
  Ai.AvoidEntityGoal = function (e, range, speed, getThreats, isAvoiding, fleeOpts) {
    var rand = (fleeOpts && fleeOpts.random) || Ai.rndOf(e);
    var canSeeFn = (fleeOpts && fleeOpts.canSee) || Ai.canSee;
    var favor = (fleeOpts && fleeOpts.favor) || Ai.animalPathfindingFavor;
    // `FleeEntityGoal`'s own dual speed (`slowSpeed`=`speed` above, `fastSpeed`=`fleeOpts.
    // fastSpeed`, defaulting to `speed` for the many real callers where vanilla passes the
    // SAME value twice, e.g. `AvoidLlamaGoal(24F,1.5,1.5)`) -- cloud unit, avoidrefcheck's own
    // speed-calibration reds. `tick()` below switches on it every tick, same as vanilla.
    var fastSpeed = (fleeOpts && fleeOpts.fastSpeed != null) ? fleeOpts.fastSpeed : speed;
    var fleeing = null, path = null, idx = 1;
    this.canUse = function () {
      var threats = getThreats();
      var best = null, bestDsq = Infinity;
      for (var i = 0; i < threats.length; i++) {
        var t = threats[i];
        if (!isAvoiding(t)) continue;
        var dx = t.x - e.x, dy = t.y - e.y, dz = t.z - e.z;
        // FleeEntityGoal.canStart: a 3D BOX (fixed 3-block vertical half-height), not a flat
        // circle that ignores height.
        if (Math.abs(dx) > range || Math.abs(dz) > range || Math.abs(dy) > Ai.AVOID_BOX_V) continue;
        var dsq = dx * dx + dy * dy + dz * dz;
        // TargetPredicate.test's own range gate (`setBaseMaxDistance(fleeDistance)`): squared straight-line
        // distance > max(fleeDistance, 2)^2 refuses -- the box above alone let a creeper flee a cat 8.9
        // blocks away diagonally (avoidrefcheck creeper_cat_9; cloud unit referee-mob-avoid-panic).
        var maxD = Math.max(range, 2.0);
        if (dsq > maxD * maxD) continue;
        if (!canSeeFn(e, t)) continue;                    // TargetPredicate: respectsVisibility
        if (dsq < bestDsq) { bestDsq = dsq; best = t; }   // getClosestEntity: nearest, not first-found
      }
      if (!best) return false;
      // `NoPenaltyTargeting.findFrom(mob, 16, 7, threatPos)` (.decomp :29-47): 10 fuzzed offsets
      // AWAY from the threat, each kept only if `tryMake` passes -- height valid, the block below
      // solid (`EntityNavigation.isValidPosition`), no pathfinding penalty at the spot -- and the
      // highest `getPathfindingFavor` wins (strict `>`). A spot in the air or inside the floor is
      // refused, so on flat ground only the vertical-fuzz draws that land at floor level count,
      // which is why a fleer often waits a few ticks before it runs (the referee's own traces).
      var dx0 = e.x - best.x, dz0 = e.z - best.z;
      var bestScore = -Infinity, bestPt = null, Ph = NS.Physics;
      for (var i2 = 0; i2 < 10; i2++) {
        var o = avoidFleeFuzz(Ai.AVOID_FLEE_FIND_H, Ai.AVOID_FLEE_FIND_V, dx0, dz0, Ai.AVOID_FLEE_ANGLE, rand);
        if (!o) continue;
        var bx = Math.floor(e.x) + o.x, by = Math.floor(e.y) + o.y, bz = Math.floor(e.z) + o.z;
        if (by < -64 || by > 319) continue;                                              // isHeightInvalid
        if (Ph && Ph.solidAt && !Ph.solidAt(bx, by - 1, bz)) continue;                   // isValidPosition
        if (Ai.pathTypeAt && Ai.pathPenalty(e, Ai.pathTypeAt(bx, by, bz)) !== 0) continue; // hasPathfindingPenalty
        var score = favor(bx, by, bz);
        if (score > bestScore) { bestScore = score; bestPt = { x: bx + 0.5, y: by, z: bz + 0.5 }; }  // Vec3d.ofBottomCenter
      }
      if (!bestPt) return false;
      // canStart: the chosen spot must be farther from the threat than the mob already is.
      var ptDsq = (best.x - bestPt.x) * (best.x - bestPt.x) + (best.y - bestPt.y) * (best.y - bestPt.y) +
                  (best.z - bestPt.z) * (best.z - bestPt.z);
      if (ptDsq < bestDsq) return false;
      // `navigation.findPathTo(x, y, z, 0)`: the follow-range-bounded search, partial path allowed
      // (null only when nothing at all is reachable), visit budget followRange*16 (EntityNavigation).
      var fr = Ai.followRangeOf ? Ai.followRangeOf(e) : 16;
      var cp = Ai.findPath(e.x, e.y, e.z, bestPt.x, bestPt.y, bestPt.z,
        { mob: e, maxDistance: fr, partial: true, maxNodes: Math.floor(fr * 16) });
      if (!cp || cp.length < 2) return false;
      if (fleeOpts && fleeOpts.afterNearest && !fleeOpts.afterNearest(best)) return false;   // AvoidLlamaGoal.canStart: `&& isScaredOf(target)` rolls ONCE, on the nearest, after super.canStart()
      fleeing = best; path = cp; idx = 1;
      return true;
    };
    this.canContinueToUse = function () {
      return !!fleeing && !!path && idx < path.length;   // FleeEntityGoal.shouldContinue: !navigation.isIdle()
    };
    this.start = function () { idx = 1; };
    this.stop = function () { fleeing = null; path = null; };
    this.tick = function () {
      if (!fleeing) return;
      if (!path || idx >= path.length) { this.stop(); return; }
      // FleeEntityGoal.tick(): squaredDistanceTo(targetEntity) < 49.0 (7 blocks) -> fastSpeed,
      // else slowSpeed -- re-checked every tick against the threat's LIVE position.
      var dxf = fleeing.x - e.x, dyf = fleeing.y - e.y, dzf = fleeing.z - e.z;
      var nearThreat = (dxf * dxf + dyf * dyf + dzf * dzf) < 49.0;
      Ai.stepToward(e, path[idx], nearThreat ? fastSpeed : speed);
      idx = Ai.advancePathNode(e, path, idx);
    };
  };

  /**
   * Vanilla's `FollowParentGoal` — a baby stays near the nearest ADULT of its own type. MOVE
   * only. ⚠ `isBaby` is not yet set by anything live (no mob spawns a baby today — G18c is
   * still ahead) so this is proven here against synthetic entities the same way every goal in
   * this file is; see the file header.
   */
  Ai.FOLLOW_PARENT_RANGE = 9;
  Ai.FOLLOW_PARENT_CLOSE = 3;
  Ai.FollowParentGoal = function (e, speed, getSiblings) {
    var parent = null, path = null, idx = 1;
    this.canUse = function () {
      if (!e.isBaby) return false;
      var cs = getSiblings();
      var best = null, bestD = Infinity;
      for (var i = 0; i < cs.length; i++) {
        var c = cs[i];
        if (c === e || c.type !== e.type || c.isBaby) continue;
        var d = Math.hypot(c.x - e.x, c.z - e.z);
        if (d <= Ai.FOLLOW_PARENT_RANGE && d < bestD) { best = c; bestD = d; }
      }
      if (best && bestD > Ai.FOLLOW_PARENT_CLOSE) { parent = best; return true; }
      return false;
    };
    this.canContinueToUse = function () {
      if (!parent) return false;
      return Math.hypot(parent.x - e.x, parent.z - e.z) > Ai.FOLLOW_PARENT_CLOSE;
    };
    this.start = function () {
      path = Ai.findPath(e.x, e.y, e.z, parent.x, parent.y, parent.z, { mob: e });
      idx = 1;
    };
    this.stop = function () { parent = null; path = null; };
    this.tick = function () {
      if (!parent) return;
      if (Math.hypot(parent.x - e.x, parent.z - e.z) <= Ai.FOLLOW_PARENT_CLOSE) { this.stop(); return; }
      if (!path || idx >= path.length) { this.start(); return; }
      Ai.stepToward(e, path[idx], typeof speed === "function" ? speed(e) : speed);
      if (Ai.closeTo(e, path[idx])) idx++;
    };
  };

  /**
   * Vanilla's `FollowOwnerGoal` (`bdr`, javap'd this pass — D-474) — a tamed, unsat wolf/cat
   * walks toward its owner once farther than `startDist`, stops once within `stopDist`, and
   * TELEPORTS near the owner once farther than `Ai.FOLLOW_OWNER_TELEPORT_DIST` blocks — the
   * SAME `bdr` class for both species (`big.u()` constructs it too; only `stopDist` differs,
   * 5.0f vs wolf's 2.0f — the "cat's own teleporting FollowOwnerGoal" 07n_tame.js's header
   * named as unread turns out to be the identical class, not a second one). `Ai.
   * FOLLOW_OWNER_TELEPORT_DIST` is `bdr`'s own `private static final int a = 12`, javap'd, squared
   * for the comparison the bytecode actually runs (`distanceToSqr(owner) >= 144.0`). `canUse`/
   * `canContinueToUse` both read `e.sitting` (`bdr.a()`/`bdr.b()` each call the tameable's own
   * `isOrderedToSit()`) — a sitting mob never starts or continues following. `bdr.a()` also
   * refuses a null/spectator owner; this engine has one live player and no spectator mode, so
   * that half of the jar's own check is vacuous here and not reproduced (named, not silently
   * dropped — `Tame.OWED`'s multiplayer-ownership line already covers the "one player" side of
   * this). The teleport itself (`bdr.h()`/its own private `a(int,int,int)`) tries ten candidates,
   * `dx`/`dz` in [-3,3], `dy` in [-1,1], skips anything within 2 blocks of the owner on BOTH
   * horizontal axes, and accepts the first candidate whose `PathType` (`bdr.a(gj)`) is WALKABLE —
   * `Ai.pathTypeAt` already answers that exact question (D-398); the jar's own extra
   * `!canFly && DAMAGE_FIRE` rejection is not reproduced separately because `Ai.pathTypeAt` never
   * answers WALKABLE for a burning block in the first place (named, not silently dropped).
   */
  Ai.FOLLOW_OWNER_TELEPORT_DIST = 12;              // bdr's own `a`, javap'd — blocks, not squared
  Ai.FOLLOW_OWNER_TELEPORT_TRIES = 10;
  Ai.FollowOwnerGoal = function (e, speed, startDist, stopDist, getPlayers, rand) {
    rand = rand || Ai.rndOf(e);
    var owner = null, path = null, idx = 1, timer = 0;
    var teleDistSq = Ai.FOLLOW_OWNER_TELEPORT_DIST * Ai.FOLLOW_OWNER_TELEPORT_DIST;
    function findOwner() {
      if (!e.tamed || e.owner !== 'player' || e.sitting) return null;
      var ps = getPlayers ? getPlayers() : [];
      return (ps && ps[0]) || null;
    }
    function distSq(o) {
      var dx = o.x - e.x, dy = o.y - e.y, dz = o.z - e.z;
      return dx * dx + dy * dy + dz * dz;
    }
    this.canUse = function () {
      var o = findOwner();
      if (!o) return false;
      if (distSq(o) < startDist * startDist) return false;
      owner = o;
      return true;
    };
    this.canContinueToUse = function () {
      if (!owner || e.sitting) return false;
      return distSq(owner) > stopDist * stopDist;
    };
    this.start = function () { timer = 0; path = null; idx = 1; };
    this.stop = function () { owner = null; path = null; };
    function tryTeleport() {
      for (var t = 0; t < Ai.FOLLOW_OWNER_TELEPORT_TRIES; t++) {
        var dx = -3 + Math.floor(rand() * 7);
        var dy = -1 + Math.floor(rand() * 3);
        var dz = -3 + Math.floor(rand() * 7);
        if (Math.abs(dx) < 2 && Math.abs(dz) < 2) continue;
        var tx = Math.floor(owner.x) + dx, ty = Math.floor(owner.y) + dy, tz = Math.floor(owner.z) + dz;
        if (Ai.pathTypeAt(tx, ty, tz) !== Ai.NodeType.WALKABLE) continue;
        e.x = tx + 0.5; e.y = ty; e.z = tz + 0.5;
        path = null; idx = 1;
        return true;
      }
      return false;
    }
    this.tick = function () {
      if (owner && e.look) e.look.setLookAt(owner.x, owner.y + Ai.eyeOf(owner), owner.z);
      if (--timer > 0) return;
      timer = 10;
      if (!owner) return;
      if (distSq(owner) >= teleDistSq) { tryTeleport(); return; }
      if (!path || idx >= path.length) {
        path = Ai.findPath(e.x, e.y, e.z, owner.x, owner.y, owner.z, { mob: e });
        idx = 1;
        return;
      }
      Ai.stepToward(e, path[idx], speed);
      if (Ai.closeTo(e, path[idx])) idx++;
    };
  };

  /**
   * Vanilla's `BreedGoal` — two adults of the same type in LOVE MODE walk toward each other and
   * breed on contact. ⚠ WHAT BREEDING ITSELF DOES — spawning a baby, consuming both `inLove`
   * flags, the XP drop — is G18's own mob-breeding stage and stays owed; this goal owns only the
   * getting-there half and calls `onBreed(e, partner)` once, on contact, so a caller wires the
   * rest in rather than this file guessing at it.
   */
  Ai.BREED_RANGE = 8;
  Ai.BREED_TICKS = 60;   // AnimalMateGoal: timer >= getTickCount(60)
  // AnimalMateGoal.tick: animal.squaredDistanceTo(mate) < 9.0 (3-D)
  Ai.breedNear = function (e, p) { var dx = p.x - e.x, dy = p.y - e.y, dz = p.z - e.z; return dx * dx + dy * dy + dz * dz < 9.0; };
  Ai.BreedGoal = function (e, speed, getPartners, onBreed) {
    var partner = null, path = null, idx = 1, timer = 0;
    this.canUse = function () {
      if (!e.inLove) return false;
      var cs = getPartners();
      var best = null, bestD = Infinity;
      for (var i = 0; i < cs.length; i++) {
        var c = cs[i];
        if (c === e || !c.inLove || c.removed || c.dead) continue;
        // AnimalMateGoal.findMate: animal.canBreedWith(other) when the Breed table is loaded
        if (NS.Breed && NS.Breed.ready ? !NS.Breed.canMate(e, c) : c.type !== e.type) continue;
        var dx = c.x - e.x, dy = c.y - e.y, dz = c.z - e.z, d = dx * dx + dy * dy + dz * dz;   // 3-D, VALID_MATE_PREDICATE maxDist 8
        if (d <= Ai.BREED_RANGE * Ai.BREED_RANGE && d < bestD) { best = c; bestD = d; }
      }
      if (best) { partner = best; return true; }
      return false;
    };
    // BREED_TARGET memory (BreedTask sets it, AxolotlBrain.hasBreedTarget reads it)
    var setBt = function (v) { e.breedTarget = v; };
    // AnimalMateGoal.shouldContinue: mate.isAlive() && mate.isInLove() && timer < 60
    this.canContinueToUse = function () { return !!(partner && !partner.dead && !partner.removed && e.inLove && partner.inLove && timer < Ai.BREED_TICKS); };
    this.start = function () {
      setBt(partner);
      path = Ai.findPath(e.x, e.y, e.z, partner.x, partner.y, partner.z, { mob: e });
      idx = 1;
    };
    this.stop = function () { partner = null; path = null; timer = 0; setBt(null); };
    this.tick = function () {
      if (!partner) return;
      timer++;
      if (timer >= Ai.BREED_TICKS && Ai.breedNear(e, partner)) {
        if (onBreed) onBreed(e, partner);
        this.stop();
        return;
      }
      if (!path || idx >= path.length) { this.start(); return; }
      Ai.stepToward(e, path[idx], speed);
      if (Ai.closeTo(e, path[idx])) idx++;
    };
  };

  /**
   * Vanilla's `TemptGoal` — walk toward the nearest player holding an item `isTempting()`
   * accepts, and stop just short of it. ⚠ WHICH ITEMS TEMPT WHICH MOB is per-mob jar data
   * (`Animal.isFood`) and stays owed — `isTempting` is injected so the algorithm is provably
   * correct without this file guessing the table.
   */
  Ai.TEMPT_RANGE = 10;
  Ai.TEMPT_STANDOFF = 2.5;   // TemptGoal.tick: squaredDistanceTo < 6.25 stops navigation (3D)
  Ai.TEMPT_COOLDOWN = 100;   // TemptGoal.stop: cooldown = toGoalTicks(100), canStart decrements it
  /** `isTemptedBy`: main hand OR off hand. `P.heldItem` is a function on the real player, a value on fixtures. */
  Ai.temptHands = function (p) {
    var out = [typeof p.heldItem === 'function' ? p.heldItem() : p.heldItem], o = p.offHandItem;
    if (o === undefined && p.inventory && NS.Inventory) o = NS.Inventory.getItem(p.inventory, 40);
    out.push(typeof o === 'function' ? o() : o);
    return out;
  };
  // canBeScared: bool or function (OcelotTemptGoal: `&& !isTrusting`)
  Ai.TemptGoal = function (e, speed, getPlayers, isTempting, canBeScared) {
    var target = null, cooldown = 0, active = false, lx = 0, ly = 0, lz = 0, lpitch = 0, lyaw = 0;
    var DEG = 180 / Math.PI;
    function tempted(p) {
      var h = Ai.temptHands(p);
      for (var i = 0; i < h.length; i++) if (h[i] && isTempting(h[i])) return true;
      return false;
    }
    function d2(p) { var dx = p.x - e.x, dy = p.y - e.y, dz = p.z - e.z; return dx * dx + dy * dy + dz * dz; }
    this.canUse = function () {
      if (cooldown > 0) { cooldown--; return false; }
      var ps = getPlayers();
      var best = null, bestD = Infinity;
      for (var i = 0; i < ps.length; i++) {
        var p = ps[i];
        if (!tempted(p)) continue;
        var d = Math.hypot(p.x - e.x, p.z - e.z);
        if (d <= Ai.TEMPT_RANGE && d < bestD) { best = p; bestD = d; }
      }
      if (best) { target = best; return true; }
      return false;
    };
    this.canContinueToUse = function () {
      if (target && (typeof canBeScared === 'function' ? canBeScared(target) : canBeScared)) {
        var dx = target.x - lx, dy = target.y - ly, dz = target.z - lz;
        if (d2(target) < 36) {
          if (dx * dx + dy * dy + dz * dz > 0.010000000000000002) return false;
          if (Math.abs((target.pitch || 0) * DEG - lpitch) > 5 || Math.abs((target.yaw || 0) * DEG - lyaw) > 5) return false;
        } else { lx = target.x; ly = target.y; lz = target.z; }
        lpitch = (target.pitch || 0) * DEG; lyaw = (target.yaw || 0) * DEG;
      }
      return this.canUse();
    };
    this.start = function () {   // TemptGoal.isActive (CatEntity.tick's beg_for_food reads it)
      if (target) { lx = target.x; ly = target.y; lz = target.z; }
      active = e.temptActive = true;
    };
    this.target = function () { return target; };
    this.stop = function () { target = null; cooldown = Ai.TEMPT_COOLDOWN; active = e.temptActive = false; };
    this.tick = function () {
      if (!target) return;
      if (d2(target) < Ai.TEMPT_STANDOFF * Ai.TEMPT_STANDOFF) return;   // close enough — stands and "begs"
      var p = Ai.findPath(e.x, e.y, e.z, target.x, e.y, target.z, { mob: e });
      if (p && p.length > 1) Ai.stepToward(e, p[1], typeof speed === "function" ? speed(e) : speed);
    };
  };

  /**
   * `Entity.getLightLevelDependentMagicValue()` at a live world position (D-401, session 39,
   * PASS 16 JOB 1). `SpiderAttackGoal`/`SpiderTargetGoal` are the first callers. Bytecode-read
   * in full through THREE classes: `axk.bd()` (Entity) is
   *     return level.hasChunkAt(pos) ? level.getLightLevelDependentMagicValue(pos) : 0.0F;
   * `cay.y(gj)` (the `LevelReader` default this engine's `Level` class inherits) is
   *     return dimensionType().a(getMaxLocalRawBrightness(pos));      // brightnessRamp[i]
   * and `cry.a(float)` (`DimensionType.createLightLevelToBrightnessTable`, the SAME class whose
   * `<clinit>` builds the four-way weather-brightness array elsewhere in this file) is, per
   * index `i` 0..15:
   *     f = i / 15.0F;  g = f / (4.0F - 3.0F * f);  table[i] = lerp(ambientLight, g, 1.0F);
   * The overworld's own `ambientLight` is 0.0 (vanilla's documented dimension-type value, named
   * on `Ai.OWED` rather than re-walked to its own bootstrap literal this session), which makes
   * the lerp a no-op and the ramp exactly `g`. `getMaxLocalRawBrightness(pos)` — read the same
   * way `07f_redstone.js`'s own `Rs.skyDarken` already reads the SAME class's `getSkyDarken()`
   * for `DaylightDetectorBlock` — is `max(blockLight, skyLight - level.getSkyDarken())` for a
   * sky-lit dimension, which this engine's only dimension is.
   */
  Ai.LIGHT_RAMP = (function () {
    var t = [];
    for (var i = 0; i <= 15; i++) {
      var f = i / 15;
      t[i] = f / (4 - 3 * f);
    }
    return t;
  })();
  /** Entity.getBrightnessAtEyes: SpiderEntity.getActiveEyeHeight 0.65 (cave spider 0.45). */
  Ai.spiderEyeBrightness = function (e) {
    return Ai.lightLevelDependentMagicValue(e.x, e.y + (e.type === 'cave_spider' ? 0.45 : 0.65), e.z);
  };
  Ai.lightLevelDependentMagicValue = function (x, y, z) {
    var W = NS.World, Sky = NS.Sky, Rs = NS.Redstone;
    if (!W || !W.getLight) return 0;
    var bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    var L = W.getLight(bx, by, bz);
    var sky = (L >> 4) & 15, block = L & 15;
    var dayTime = Sky ? Sky.dayTime : 0;
    var wx = Sky ? (Sky.weather || (Sky.newWeather && Sky.newWeather())) : null;
    var rain = wx ? wx.rainLevel : 0;
    var thunder = wx && Sky.thunderLevelOf ? Sky.thunderLevelOf(wx) : 0;
    var skyDarken = (Rs && Rs.skyDarken) ? Rs.skyDarken(dayTime, rain, thunder) : 0;
    var raw = block > (sky - skyDarken) ? block : (sky - skyDarken);
    if (raw < 0) raw = 0; else if (raw > 15) raw = 15;
    return Ai.LIGHT_RAMP[raw];
  };

  /**
   * Vanilla's `LeapAtTargetGoal` (D-401) — `bdz`, bytecode-read in full; Yarn names this exact
   * class `PounceAtTargetGoal` (`.decomp/net/minecraft/entity/ai/goal/PounceAtTargetGoal.java`
   * — no separate `LeapAtTargetGoal.java` exists), so wolf's own `bje.u()` (`new
   * PounceAtTargetGoal(this, 0.4F)`, priority 4, MOVE|JUMP, loop/wolfpounce) is the SAME class
   * as spider's, not a lookalike. Spider was this engine's first user (`bmo.u()`: `new
   * LeapAtTargetGoal(this, 0.4F)`, priority 3, MOVE|JUMP — the EnumSet `bdz`'s own constructor
   * builds); wolf is the second, same `momentumMultiplier=0.4`. `canUse`: has a target, the
   * target is 4–16 blocks away (SQUARED, full 3D — `distanceToSqr`), the mob is on the ground,
   * and a `nextInt(reducedTickDelay(5))` roll lands (`Ai.LEAP_ROLL` names the tick-rate
   * assumption, `Ai.OWED`). `canContinueToUse`: runs until it lands (`!onGround`). `start`: a
   * horizontal unit vector toward the target scaled 0.4, plus 0.2× the mob's own current
   * horizontal delta (unscaled if the target is directly overhead — `lengthSqr() <= 1e-7` keeps
   * the raw, tiny diff rather than the unit vector, exactly as `bdz.c()` disassembles), Y forced
   * to the constructor's own momentum multiplier (spider's and wolf's both 0.4).
   */
  Ai.LEAP_MIN_DSQ = 4;
  Ai.LEAP_MAX_DSQ = 16;
  // nextInt(toGoalTicks(5)) = nextInt(3) per selection, selection every other tick (tickNewAi) -> 1/6 per tick
  Ai.LEAP_ROLL = 6;
  Ai.PounceAtTargetGoal = function (e, ctx, momentumMultiplier) {
    ctx = ctx || {};
    var random = ctx.random || Ai.rndOf(e);
    this.canUse = function () {
      if (e.passengers && e.passengers.length > 0) return false;   // PounceAtTargetGoal: mob.hasPassengers()
      if (!e.target) return false;
      var t = e.target;
      var dx = t.x - e.x, dy = (t.y === undefined ? e.y : t.y) - e.y, dz = t.z - e.z;
      var d = dx * dx + dy * dy + dz * dz;
      if (d < Ai.LEAP_MIN_DSQ || d > Ai.LEAP_MAX_DSQ) return false;
      if (!e.onGround) return false;
      return Math.floor(random() * Ai.LEAP_ROLL) === 0;
    };
    this.canContinueToUse = function () { return !e.onGround; };
    this.start = function () {
      var t = e.target;
      if (!t) return;
      var dx = t.x - e.x, dz = t.z - e.z;
      var len2 = dx * dx + dz * dz;
      var nx, nz;
      if (len2 > 1e-7) {
        var len = Math.sqrt(len2);
        nx = (dx / len) * 0.4 + e.vx * 0.2;
        nz = (dz / len) * 0.4 + e.vz * 0.2;
      } else {
        nx = dx; nz = dz;
      }
      e.vx = nx; e.vy = momentumMultiplier; e.vz = nz;
    };
    this.stop = function () {};
    this.tick = function () {};
  };

  /**
   * Vanilla's `Spider.SpiderAttackGoal` (D-401) — `bmo$a`, bytecode-read in full, `extends
   * MeleeAttackGoal` (`bed`, `super(this, 1.0D, true)`). Two structurally-confirmed differences
   * from `Ai.MeleeAttackGoal` above, both read off `bmo$a`'s own overrides rather than assumed
   * shared: a WIDER reach (`getAttackReachSqr`: `4.0F + target.getBbWidth()`, not
   * `MeleeAttackGoal`'s own `4*mobWidth² + targetWidth`) and a bright-daylight ESCAPE
   * (`canContinueToUse`: if the light level here is >= 0.5 and a 1-in-100 roll lands, drop the
   * target and stop; otherwise defer to the base class). `canUse` adds `!isVehicle()` (a spider jockey
   * carrying its skeleton rider, `e.passengers`, neither melees nor leaps — #1231).
   */
  Ai.SPIDER_ATTACK_REACH = 4;
  Ai.spiderAttackReachSqr = function (target) {
    var tw = (target && target.width) || 0.6;
    return Ai.SPIDER_ATTACK_REACH + tw;
  };
  Ai.SpiderAttackGoal = function (e, ctx) {
    ctx = ctx || {};
    var speed = 1.0;
    var random = ctx.random || Ai.rndOf(e);
    var pathFound = null, st = { cd: 0, tx: 0, ty: 0, tz: 0, path: null, idx: 1 }, atkCooldown = 0;
    var lastUpdate = -1e9;
    // MeleeAttackGoal.canStart: 20-tick throttle, target alive, path to it OR already in reach; && !hasPassengers()
    this.canUse = function () {
      if (e.passenger || (e.passengers && e.passengers.length > 0)) return false;
      var age = e.age || 0;
      if (age - lastUpdate < 20) return false;
      lastUpdate = age;
      var t = e.target;
      if (!t || t.dead || t.removed) return false;
      if ((pathFound = Ai.findPath(e.x, e.y, e.z, t.x, t.y, t.z, { mob: e }))) return true;   // start() moves along it
      var dx = t.x - e.x, dy = (t.y === undefined ? e.y : t.y) - e.y, dz = t.z - e.z;
      return dx * dx + dy * dy + dz * dz <= Ai.spiderAttackReachSqr(t);
    };
    this.canContinueToUse = function () {
      var t = e.target;
      if (!t || t.dead || t.removed || t.invulnerableGamemode) return false;   // shouldContinue: creative/spectator player
      var f = Ai.spiderEyeBrightness(e);
      if (f >= 0.5 && random() < 0.01) {
        e.target = null;
        return false;
      }
      return true;
    };
    this.start = function () { st.path = pathFound; st.idx = 1; st.cd = 0; atkCooldown = 0; e.aggressive = true; };
    this.stop = function () {
      st.path = null; e.aggressive = false;
      if (e.target && e.target.invulnerableGamemode) e.target = null;   // stop(): !EXCEPT_CREATIVE_OR_SPECTATOR -> setTarget(null)
    };
    this.tick = function () {
      if (!e.target) return;
      if (atkCooldown > 0) atkCooldown--;
      var t = e.target;
      var dx = t.x - e.x, dy = (t.y === undefined ? e.y : t.y) - e.y, dz = t.z - e.z;
      var distSq = dx * dx + dy * dy + dz * dz;
      if (distSq <= Ai.spiderAttackReachSqr(t) && atkCooldown <= 0) {
        atkCooldown = Ai.MOB_ATTACK_INTERVAL;
        if (NS.EntityRender && NS.EntityRender.swingHand) NS.EntityRender.swingHand(e);
        if (NS.Combat && NS.Combat.mobAttack) NS.Combat.mobAttack(e, t);
      }
      Ai.meleeNavTick(e, t, st, distSq, true, random);
      var path = st.path, idx = st.idx;
      if (path && idx < path.length) {
        Ai.stepToward(e, path[idx], speed);
        if (Ai.closeTo(e, path[idx])) st.idx++;
      } else {
        // SpiderNavigation (.decomp SpiderNavigation.java): `startMovingTo` returns true with no path and
        // `tick` keeps `moveTo(targetPos)` while idle, so the spider walks straight at (and, via its wall
        // climb, up to) an unreachable target. Stops once within its own width of the target, or level
        // above it and within its width horizontally.
        var w = e.width === undefined ? 1.4 : e.width;
        var tx = Math.floor(t.x), ty = Math.floor(t.y === undefined ? e.y : t.y), tz = Math.floor(t.z);
        var near = function (py) {
          var ddx = tx + 0.5 - e.x, ddy = py + 0.5 - e.y, ddz = tz + 0.5 - e.z;
          return ddx * ddx + ddy * ddy + ddz * ddz < w * w;
        };
        if (!(near(ty) || (e.y > ty && near(Math.floor(e.y))))) {
          Ai.stepToward(e, { x: tx, y: ty, z: tz }, speed);
        }
      }
    };
  };

  /**
   * `Spider.SpiderTargetGoal` (D-401) — `bmo$c`, bytecode-read in full: a plain
   * `NearestAttackableTargetGoal` (`super(spider, targetType, true)`) that additionally refuses
   * to ACQUIRE a target once the light level here is >= 0.5 (`canUse` only — an already-held
   * target is not dropped by this gate; `SpiderAttackGoal`'s own 1-in-100 roll is the only place
   * a bright-daylight target is dropped). IronGolem is the jar's own second target type (`bmo`'s
   * targetSelector priority 3) and this engine has no iron golem entity yet — named on
   * `Ai.OWED`, not silently skipped.
   */
  Ai.SpiderTargetGoal = function (e, ctx, getCandidates) {
    var inner = new Ai.NearestAttackableTargetGoal(e, getCandidates, { sight: true, mustSee: true, reciprocalChance: 10, rand: ctx.random });   // #4288: ActiveTargetGoal(mob,cls,true)
    this.sight = inner.sight; this.mustSee = inner.mustSee; this.reciprocalChance = inner.reciprocalChance;   // read by spidertargetcheck
    this.canUse = function () {
      var f = Ai.spiderEyeBrightness(e);
      if (f >= 0.5) return false;
      return inner.canUse();
    };
    this.canContinueToUse = function () { return inner.canContinueToUse(); };
    this.start = function () { inner.start(); };
    this.stop = function () { inner.stop(); };
    this.tick = function () { inner.tick(); };
  };

  /**
   * `SitWhenOrderedToGoal` (D-458, G18e unit 3) — a tamed wolf/cat holds still while
   * `e.sitting` is set (07n_tame.js's own `Tame.toggleSit`, the only writer). MOVE only, and
   * given the highest priority in both rosters below so it preempts panic/tempt/stroll exactly
   * the way a sitting dog in vanilla does not get up to flee or wander. `canUse`/
   * `canContinueToUse` read the SAME flag — there is no separate "start sitting" transition to
   * get wrong, unlike a goal that decides once and then free-runs.
   */
  Ai.SitGoal = function (e) {
    this.canUse = function () { return !!e.sitting; };
    this.canContinueToUse = function () { return !!e.sitting; };
    this.start = function () {};
    this.stop = function () {};
    this.tick = function () {};
  };

  // ── CAT bed goals (#1316) — CatEntity.SleepWithOwnerGoal / GoToBedAndSleepGoal / CatSitOnBlockGoal ──
  // ⚠ the engine has ONE `e.sitting` (the sit ORDER); the cat's sitting POSE and sleeping pose live in `e.sitPose`
  // / `e.inSleepingPose`, `e.headDown` (CatEntity IN_SLEEPING_POSE / HEAD_DOWN) — so a pose never trips SitGoal.
  Ai.CAT_GIFTS = [['rabbit_hide', 10], ['rabbit_foot', 10], ['chicken', 10], ['feather', 10], ['rotten_flesh', 10], ['string', 10], ['phantom_membrane', 2]];   // gameplay/cat_morning_gift
  function catBedState(st) {
    var Tg = NS.Tags, col = Tg && Tg.ready ? Tg.blockTag('beds') : -1;
    return col >= 0 && st !== 0 && Tg.stateInCol(col, st);
  }
  function catBedAt(x, y, z) { return catBedState(NS.World.getBlock(x, y, z)); }
  function catOwner(e, getPlayers) { var ps = getPlayers ? getPlayers() : []; return e.tamed && e.owner === 'player' && ps && ps[0] || null; }
  /** MoveToTargetPosGoal(mob, speed, range, maxYDifference) — the jar's own ring scan, 40-tick-class cooldown. */
  function catMoveToPos(e, speed, range, maxY, interval, isTarget) {
    var cooldown = 0, tryingTime = 0, safeWait = 1200, tx = 0, ty = 0, tz = 0, path = null, idx = 1, reached = false;
    var base = {
      lowestY: 0,
      hasReached: function () { return reached; },
      findTarget: function () {
        var bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
        for (var dy = base.lowestY; dy <= maxY; dy = dy > 0 ? -dy : 1 - dy)
          for (var r = 0; r < range; r++)
            for (var dx = 0; dx <= r; dx = dx > 0 ? -dx : 1 - dx)
              for (var dz = (dx < r && dx > -r) ? r : 0; dz <= r; dz = dz > 0 ? -dz : 1 - dz)
                if (isTarget(bx + dx, by + dy - 1, bz + dz)) { tx = bx + dx; ty = by + dy - 1; tz = bz + dz; return true; }
        return false;
      },
      canUse: function () {
        if (cooldown > 0) { cooldown--; return false; }
        cooldown = interval();
        return base.findTarget();
      },
      canContinueToUse: function () { return tryingTime >= -safeWait && tryingTime <= 1200 && isTarget(tx, ty, tz); },
      start: function () { tryingTime = 0; safeWait = Math.floor(Ai.rndOf(e)() * (Math.floor(Ai.rndOf(e)() * 1200) + 1200)) + 1200; reached = false; path = null; idx = 1; },
      stop: function () { path = null; reached = false; },
      tick: function () {
        var cx = tx + 0.5, cy = ty + 1, cz = tz + 0.5, dyc = cy + 0.5 - e.y;
        var d = (cx - e.x) * (cx - e.x) + dyc * dyc + (cz - e.z) * (cz - e.z);
        if (d >= 1.0) {
          reached = false; tryingTime++;
          if (!path || idx >= path.length || tryingTime % 40 === 0) { path = Ai.findPath(e.x, e.y, e.z, cx, cy, cz, { mob: e, partial: true }); idx = 1; }
          if (path && idx < path.length) { Ai.stepToward(e, path[idx], speed); if (Ai.closeTo(e, path[idx])) idx++; }
        } else { reached = true; tryingTime--; }
      }
    };
    return base;
  }
  /** `GoToBedAndSleepGoal(cat, speed, range)` — range 8, maxY 6, lowestY -2, interval 40 = 80 ticks of our every-tick selection (MobEntity.tickNewAi runs selection every other tick). */
  Ai.GoToBedAndSleepGoal = function (e, speed, range) {
    var m = catMoveToPos(e, speed, range, 6, function () { return 80; }, function (x, y, z) {
      return NS.World.getBlock(x, y + 1, z) === 0 && catBedAt(x, y, z);
    });
    m.lowestY = -2;
    this.canUse = function () { return !!e.tamed && !e.sitting && !e.inSleepingPose && m.canUse(); };
    this.canContinueToUse = m.canContinueToUse;
    this.start = function () { m.start(); e.sitPose = false; };
    this.stop = function () { m.stop(); e.inSleepingPose = false; };
    this.tick = function () {
      m.tick(); e.sitPose = false;
      if (!m.hasReached()) e.inSleepingPose = false; else if (!e.inSleepingPose) e.inSleepingPose = true;
    };
  };
  /** `ChestBlockEntity.getPlayersLookingInChestCount`: viewers of the chest and of its double-chest partner (type LEFT = facing clockwise, RIGHT = counter-clockwise). */
  function catChestViewers(x, y, z, st) {
    var BEm = NS.BlockEntities, n = 0;
    function at(px, py, pz) { var be = BEm && BEm.get ? BEm.get(px, py, pz) : null; return be ? Math.max(0, be.open | 0) : 0; }
    n = at(x, y, z);
    var S = NS.States, R = NS.Reg, tv = S.propValue(st, R.PROP.type), t = tv < 0 ? 'single' : R.valueNames[tv];
    if (t === 'left' || t === 'right') {
      var f = R.valueNames[S.propValue(st, R.PROP.facing)], cw = { north: [1, 0], east: [0, 1], south: [-1, 0], west: [0, -1] }[f];
      if (cw) { var k = t === 'left' ? 1 : -1; n += at(x + cw[0] * k, y, z + cw[1] * k); }
    }
    return n;
  }
  /** `CatSitOnBlockGoal(cat, speed)` — range 8, maxY 1: lit furnace, unoccupied chest, or a bed that is not the HEAD part. */
  Ai.CatSitOnBlockGoal = function (e, speed) {
    var m = catMoveToPos(e, speed, 8, 1, function () { return 200 + Math.floor(Ai.rndOf(e)() * 200); }, function (x, y, z) {
      var W = NS.World, S = NS.States, R = NS.Reg;
      if (W.getBlock(x, y + 1, z) !== 0) return false;
      var st = W.getBlock(x, y, z); if (st === 0) return false;
      var b = S.block[st];
      if (b === R.id.chest) return catChestViewers(x, y, z, st) < 1;
      if (b === R.id.furnace) return S.propValue(st, R.PROP.lit) === R.PVAL['true'];
      if (!catBedState(st)) return false;
      return S.propValue(st, R.PROP.part) !== R.PVAL.head;
    });
    this.canUse = function () { return !!e.tamed && !e.sitting && m.canUse(); };
    this.canContinueToUse = m.canContinueToUse;
    this.start = function () { m.start(); e.sitPose = false; };
    this.stop = function () { m.stop(); e.sitPose = false; };
    this.tick = function () { m.tick(); e.sitPose = m.hasReached(); };
  };
  /** `CatEntity.SleepWithOwnerGoal` — priority 2; `dropGift(x, y, z, item)` spawns the morning gift's item entity. */
  Ai.SleepWithOwnerGoal = function (e, getPlayers, rand, skyAngle, dropGift) {
    rand = rand || Ai.rndOf(e);
    var owner = null, bed = null, ticksOnBed = 0, path = null, idx = 1, timer = 0;
    function distSq(o) { var dx = o.x - e.x, dy = o.y - e.y, dz = o.z - e.z; return dx * dx + dy * dy + dz * dz; }
    function cannotSleep() {
      var EL = NS.EntityList, list = EL && EL.list ? EL.list : [];
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c === e || c.type !== 'cat' || c.dead) continue;
        if (c.x + 0.3 > bed.x - 2 && c.x - 0.3 < bed.x + 3 && c.y + 0.7 > bed.y - 2 && c.y < bed.y + 3 && c.z + 0.3 > bed.z - 2 && c.z - 0.3 < bed.z + 3 &&   // AABB(cat 0.6x0.7) vs Box(bedPos).expand(2)
           (c.inSleepingPose || c.headDown)) return true;
      }
      return false;
    }
    this.canUse = function () {
      if (!e.tamed || e.sitting) return false;
      var o = catOwner(e, getPlayers);
      if (!o || !o.sleeping) return false;
      owner = o;
      if (distSq(o) > 100) return false;
      var W = NS.World, S = NS.States, R = NS.Reg, x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
      var st = W.getBlock(x, y, z);
      if (!catBedState(st)) return false;
      var step = NS.Player && NS.Player.dirStep ? NS.Player.dirStep(R.PVAL, S.propValue(st, R.PROP.facing)) : null;
      bed = step ? { x: x - step[0], y: y, z: z - step[1] } : { x: x, y: y, z: z };   // headPos + facing.getOpposite()
      return !cannotSleep();
    };
    this.canContinueToUse = function () { return !!(e.tamed && !e.sitting && owner && owner.sleeping && bed && !cannotSleep()); };
    this.start = function () { if (bed) { e.sitPose = false; path = null; timer = 0; } };
    this.stop = function () {
      e.inSleepingPose = false;
      var sky = skyAngle ? skyAngle() : 0;
      if (owner && owner.sleepTimer >= 100 && sky > 0.77 && sky < 0.8 && rand() < 0.7) gift();
      ticksOnBed = 0; e.headDown = false; path = null;
    };
    function gift() {
      var W = NS.World, S = NS.States, R = NS.Reg;
      var tx = Math.floor(e.x) + Math.floor(rand() * 11) - 5, ty = Math.floor(e.y) + Math.floor(rand() * 5) - 2, tz = Math.floor(e.z) + Math.floor(rand() * 11) - 5;
      // LivingEntity.teleport(x,y,z,false): walk down to a block that blocksMovement (solid, not a fluid), refuse a fluid/colliding spot
      var isFluid = function (b) { var s = W.getBlock(tx, b, tz); return s && (S.waterIn[s] === 1 || S.block[s] === R.id.lava || S.block[s] === R.id.water); };
      var bottom = W.BOTTOM_Y !== undefined ? W.BOTTOM_Y : -64, gy = ty, found = false;
      while (!found && gy > bottom) { var bs = W.getBlock(tx, gy - 1, tz); if (bs && S.solid[bs] === 1 && !isFluid(gy - 1)) found = true; else gy--; }
      if (found && !isFluid(gy) && !isFluid(gy + 1) && (!NS.Spawn || !NS.Spawn.spaceEmptyAt || NS.Spawn.spaceEmptyAt('cat', tx, gy, tz))) { e.x = tx; e.y = gy; e.z = tz; }
      var tot = 0, i; for (i = 0; i < Ai.CAT_GIFTS.length; i++) tot += Ai.CAT_GIFTS[i][1];
      var r = rand() * tot, item = Ai.CAT_GIFTS[0][0];
      for (i = 0; i < Ai.CAT_GIFTS.length; i++) { if ((r -= Ai.CAT_GIFTS[i][1]) < 0) { item = Ai.CAT_GIFTS[i][0]; break; } }
      var yaw = (e.bodyYaw !== undefined ? e.bodyYaw : (e.yaw || 0)) * Math.PI / 180;
      if (dropGift) dropGift(Math.floor(e.x) - Math.sin(yaw), Math.floor(e.y), Math.floor(e.z) + Math.cos(yaw), item);
    }
    this.tick = function () {
      if (!owner || !bed) return;
      e.sitPose = false;
      if (--timer <= 0) { timer = 10; path = Ai.findPath(e.x, e.y, e.z, bed.x + 0.5, bed.y + 1, bed.z + 0.5, { mob: e, partial: true }); idx = 1; }
      if (path && idx < path.length) { Ai.stepToward(e, path[idx], 1.1); if (Ai.closeTo(e, path[idx])) idx++; }
      if (distSq(owner) < 2.5) {
        ticksOnBed++;
        if (ticksOnBed > 16) { e.inSleepingPose = true; e.headDown = false; }
        else { if (e.look) e.look.setLookAt(owner.x, owner.y + Ai.eyeOf(owner), owner.z); e.headDown = true; }
      } else e.inSleepingPose = false;
    };
  };

  /**
   * `CreeperIgniteGoal` — loop/creeper-s95, `.decomp/net/minecraft/entity/ai/goal/
   * CreeperIgniteGoal.java`, read whole and transcribed exactly: `canStart` is true while a
   * fuse is already counting (`fuseSpeed > 0`) OR the current target is within 3 blocks
   * (distSq < 9); once running, `tick` sets `fuseSpeed` to -1 (counting the fuse back down —
   * `07zb_creeper.js`'s own `Cr.tick` is what actually applies `fuseSpeed` to
   * `currentFuseTime` each tick, the SAME split vanilla itself has between this goal and
   * `CreeperEntity.tick()`) the instant the target is gone or beyond 7 blocks (distSq > 49),
   * and to 1 otherwise.
   *
   * `!getVisibilityCache().canSee(target)` (#1794) is `Ai.canSee`: a target behind a solid block
   * defuses the fuse exactly like one out of range. `start()`'s own
   * `getNavigation().stop()` has no analogous call in this engine (no stored path to cancel);
   * this goal's own `Ai.MOVE` control flag already keeps a lower-priority MOVE goal (the
   * roster's own wander/flee) from stepping the creeper forward while it runs, which is this
   * goal's only OBSERVABLE effect of stopping navigation.
   */
  Ai.CreeperIgniteGoal = function (e) {
    var target = null;
    function distSq(a, b) {
      var dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
      return dx * dx + dy * dy + dz * dz;
    }
    this.canUse = function () {
      if ((e.fuseSpeed || 0) > 0) return true;
      var t = e.target;
      return !!t && distSq(e, t) < 9;
    };
    this.canContinueToUse = this.canUse;
    this.start = function () { target = e.target || null; };
    this.stop = function () { target = null; };
    this.tick = function () {
      if (!target) { e.fuseSpeed = -1; return; }
      e.fuseSpeed = (distSq(e, target) > 49 || !Ai.canSee(e, target)) ? -1 : 1;
    };
  };

  // ════════════════════════════ 5. the roster — read per mob, not from memory ════════════════
  // ⚠ `registerGoals()` is per-mob in vanilla (JOB 1's own instruction: "read that method per
  // mob"). Only two mobs are rostered — the two git 2a8efe1:docs/passes/PASS-16-HISTORY.md's acceptance list actually
  // exercises. Extending this to the rest of `Ai.ROSTER`'s eventual roster needs each mob's own
  // `registerGoals` read from the jar, not written from what "a mob like this" plausibly has.

  // ═══ VEX (QUEUE 0.2 raid loop, loop/raidvex-s96) — `VexEntity.initGoals()` (VexEntity.java,
  // read in full this pass): goalSelector 0:SwimGoal, 4:ChargeTargetGoal, 8:LookAtTargetGoal,
  // 9:LookAtEntityGoal(Player,3F,1F), 10:LookAtEntityGoal(Mob,8F); targetSelector
  // 1:RevengeGoal(RaiderEntity).setGroupRevenge(), 2:TrackOwnerTargetGoal,
  // 3:ActiveTargetGoal(Player,true). `VexEntity extends HostileEntity` DIRECTLY (not
  // `RaiderEntity`), so `Ai.addRaiderGoals` does not apply here — confirmed against the class
  // declaration, not assumed from the raid-mob cluster it is spawned into. `e.flyMove =
  // new NS.Fly.VexMoveControl(e)` (07t_fly.js) is the real `VexMoveControl`/noGravity/travel
  // substrate; wired here rather than there because the concrete goal CLASSES below belong
  // with the rest of this file's `Ai.*` goal library, the same split `NS.Spell.*Goal`'s own
  // cross-module lazy reference already uses for evoker/illusioner two entries up.
  //
  // Priority 9 (`Ai.LookAtPlayerGoal`, 3.0) and 10 (`Ai.LookAtMobGoal`, 8.0) are wired (#213, #764).

  /** `SwimGoal` (VexEntity.java:81) — `.decomp`'s own `canStart` (`isTouchingWater() &&
   *  fluidHeight > swimHeight || isInLava()`) collapses, in THIS engine, to the exact same
   *  `e.inWater` flag `Ai.FloatGoal` already reads (no swim-height/lava-height distinction
   *  exists on any entity here) — so this is `Ai.FloatGoal` under vanilla's OWN class name
   *  for this mob, not a second implementation of an identical jump-in-liquid tick.
   */
  Ai.SwimGoal = Ai.FloatGoal;

  /** `VexEntity.ChargeTargetGoal` (VexEntity.java, inner class, read in full) — MOVE only.
   *  `canStart`: no target, or `moveControl.isMoving()`, or the 1-in-7 (`toGoalTicks(7)`,
   *  collapsed to 7 the same way this file's own D-383 already treats a non-`shouldRunEveryTick`
   *  interval on an engine with no tick alternator) roll fails -> refuse; else only past
   *  4.0 blocks-squared away. `tick`: BOUNDING-BOX INTERSECTION is approximated as
   *  `Ai.attackReachSqr` (the SAME standing substitute `Ai.MeleeAttackGoal`'s own D-394
   *  header already uses for every other mob's melee reach), not a second geometry test —
   *  on a hit, swings + `Combat.mobAttack` + stops charging; short of that but within 9.0
   *  blocks-squared, re-aims the charge. `start` plays entity.vex.charge (Ai.vexSound).
   */
  Ai.VEX_SOUNDS = { ambient: 'entity.vex.ambient', hurt: 'entity.vex.hurt', death: 'entity.vex.death', charge: 'entity.vex.charge' };
  /** VexEntity sounds (hostile category, vol 1, pitch LivingEntity.getSoundPitch = (r-r)*0.2+1; charge is explicit 1.0). */
  Ai.vexSound = function (e, kind, rnd) {
    if (!NS.Sound || !NS.Sound.play) return false;
    var r = rnd || Ai.rndOf(e), ev = Ai.VEX_SOUNDS[kind];
    var MV = NS.MobVoice;   // #4315: the #4003 Gate M gate
    if (!ev || e.silent || (MV && MV.GATED && !MV.AUDITED[e.type])) return false;
    return NS.Sound.play(ev, { x: e.x, y: e.y, z: e.z, source: 'hostile', pitch: kind === 'charge' ? 1 : (r() - r()) * 0.2 + 1 });
  };
  /** Always-running (flags 0) MobEntity.tick ambient roll: nextInt(1000) < ambientSoundChance++, reset -80. */
  Ai.VexAmbientGoal = function (e, ctx) {
    var rand = (ctx && ctx.random) || Ai.rndOf(e);
    this.canUse = function () { return true; };
    this.canContinueToUse = this.canUse;
    this.start = function () {};
    this.stop = function () {};
    this.tick = function () {
      if (e.ambientChance === undefined) e.ambientChance = 0;
      if (Math.floor(rand() * 1000) < e.ambientChance++) { e.ambientChance = -80; Ai.vexSound(e, 'ambient', rand); }
    };
  };
  Ai.ChargeTargetGoal = function (e, ctx) {
    // `target.getEyePos()` and `getBoundingBox().intersects(target.getBoundingBox())`.
    function eyeY(t) {
      var Cb = NS.Combat;
      var eh = t === NS.Player ? (NS.Survival && NS.Survival.eyeHeight ? NS.Survival.eyeHeight(t) : 1.62)
                               : (Cb && Cb.eyeHeightOf ? Cb.eyeHeightOf(t) : (t.height || 1.8) * 0.85);
      return t.y + eh;
    }
    function boxesIntersect(a, b) {
      var aw = (a.width || 0.6) / 2, bw = (b.width || 0.6) / 2;
      return a.x - aw < b.x + bw && a.x + aw > b.x - bw &&
        a.y < b.y + (b.height || 1.8) && a.y + (a.height || 1.8) > b.y &&
        a.z - aw < b.z + bw && a.z + aw > b.z - bw;
    }
    var rand = (ctx && ctx.random) || Ai.rndOf(e);
    this.canUse = function () {
      var t = e.target;
      if (!t || !e.flyMove || e.flyMove.isMoving()) return false;
      if (Math.floor(rand() * 8) !== 0) return false;
      var dx = t.x - e.x, dy = t.y - e.y, dz = t.z - e.z;
      return (dx * dx + dy * dy + dz * dz) > 4.0;
    };
    this.canContinueToUse = function () {
      var t = e.target;
      return !!e.flyMove && e.flyMove.isMoving() && !!e.charging && !!t && !t.dead &&
        (t.health === undefined || t.health > 0);
    };
    this.start = function () {
      var t = e.target;
      if (t && e.flyMove) e.flyMove.moveTo(t.x, eyeY(t), t.z, 1.0);
      e.charging = true;
      Ai.vexSound(e, 'charge', rand);
    };
    this.stop = function () { e.charging = false; };
    this.tick = function () {
      var t = e.target;
      if (!t || !e.flyMove) return;
      var dx = t.x - e.x, dy = t.y - e.y, dz = t.z - e.z;
      var distSq = dx * dx + dy * dy + dz * dz;
      if (boxesIntersect(e, t)) {
        if (NS.Combat && NS.Combat.mobAttack) NS.Combat.mobAttack(e, t);
        e.charging = false;
      } else if (distSq < 9.0) {
        e.flyMove.moveTo(t.x, eyeY(t), t.z, 1.0);
      }
    };
  };

  /** `VexEntity.LookAtTargetGoal` (VexEntity.java, inner class) — MOVE only, `.decomp`'s own
   *  `shouldContinue` is a literal `return false` (one-shot per pick, not held). `canStart`:
   *  not already moving, 1-in-8 per tick (nextInt(toGoalTicks(7)=4) once per 2-tick pass, as `ChargeTargetGoal`
   *  above). `tick`: three tries at `e.bounds` (or the vex's own block position, no bounds
   *  set) offset by `nextInt(15)-7`/`nextInt(11)-5`/`nextInt(15)-7`, first AIR cell wins —
   *  moves there at speed 0.25, and looks at it too when there is no combat target.
   */
  // world.isAir: air, cave_air and void_air (SR.isAir), not just state 0
  function vexIsAir(st) { var T = NS.States && NS.States.isAir; return st === 0 || !!(T && T[st]); }
  Ai.VexLookAtTargetGoal = function (e, ctx) {
    var rand = (ctx && ctx.random) || Ai.rndOf(e);
    this.canUse = function () { return !!e.flyMove && !e.flyMove.isMoving() && Math.floor(rand() * 8) === 0; };
    this.canContinueToUse = function () { return false; };
    this.start = function () {};
    this.stop = function () {};
    this.tick = function () {
      if (!e.flyMove) return;
      var Ph = NS.Physics;
      var b = e.bounds;
      var bx = b ? b.x : Math.floor(e.x), by = b ? b.y : Math.floor(e.y), bz = b ? b.z : Math.floor(e.z);
      for (var i = 0; i < 3; i++) {
        var px = bx + (Math.floor(rand() * 15) - 7);
        var py = by + (Math.floor(rand() * 11) - 5);
        var pz = bz + (Math.floor(rand() * 15) - 7);
        if (Ph && vexIsAir(Ph.blockAt(px, py, pz))) {
          e.flyMove.moveTo(px + 0.5, py + 0.5, pz + 0.5, 0.25);
          // getLookControl().lookAt(x+.5, y+.5, z+.5, 180, 20): a turn-limited LookControl, not a yaw write
          if (!e.target && e.look) e.look.setLookAt(px + 0.5, py + 0.5, pz + 0.5, Math.PI, 20 * Math.PI / 180);
          break;
        }
      }
    };
  };

  /** `VexEntity.TrackOwnerTargetGoal` (VexEntity.java, inner class) — `TrackTargetGoal(mob,
   *  checkVisibility=false)`; `.decomp`'s own base `shouldContinue` with `checkVisibility`
   *  false is exactly a follow-range distance test, no line-of-sight check, which is all
   *  `canContinueToUse` below does. `canStart`: the vex's owning evoker is alive and has ITS
   *  OWN target; `canTrack`'s own extra predicate (non-attackable, ignore-visibility, ignore-
   *  distance-scaling) collapses to nothing further this engine can ask.
   */
  Ai.TrackOwnerTargetGoal = function (e) {
    this.canUse = function () {
      var o = e.owner;
      return !!o && !o.removed && !!o.target && !o.target.dead &&
        (o.target.health === undefined || o.target.health > 0) &&
        Ai.canTargetLiving(o.target);   // canTrack(owner.getTarget(), createNonAttackable()...): creative/spectator/peaceful refused
    };
    this.canContinueToUse = function () {
      if (!e.target) return false;
      if (!Ai.canTargetLiving(e.target)) return false;   // TrackTargetGoal.shouldContinue's creative/spectator gate
      var d = Math.hypot(e.target.x - e.x, e.target.y - e.y, e.target.z - e.z);
      return d <= Ai.followRangeOf(e);
    };
    this.start = function () { e.target = e.owner.target; };
    this.stop = function () { e.target = null; };
    this.tick = function () {};
  };

  /** `RaiderEntity`'s six live subclasses in THIS roster — `Ai.RevengeGoal`'s own
   *  `noRevengeTypes` set for vex, below (`RaiderEntity.class` in vanilla; `vex` itself is
   *  NOT a member — `VexEntity extends HostileEntity` directly, per its own class
   *  declaration, read this pass). */
  Ai.RAIDER_TYPES = { vindicator: 1, pillager: 1, witch: 1, ravager: 1, evoker: 1, illusioner: 1 };
  /** `IllagerEntity`s: `isTeammate` is true between any two (PillagerEntity/VindicatorEntity/EvokerEntity.isTeammate), so TargetPredicate rejects them as revenge targets (#3637). */
  Ai.ILLAGER_TYPES = { vindicator: 1, pillager: 1, evoker: 1, illusioner: 1 };

  /** Vanilla's `RevengeGoal` (`.decomp/net/minecraft/entity/ai/goal/RevengeGoal.java`, read
   *  in full) — TARGET only, used here for `VexEntity`'s own
   *  `new RevengeGoal(this, RaiderEntity.class).setGroupRevenge()`.
   *  ⚠ EDGE, NOT LEVEL: `RevengeGoal.canStart`'s own `getLastAttackedTime() !=
   *  lastAttackedTime` is a NEW-hit edge, not `Ai.HurtByTargetGoal`'s level-triggered
   *  `!!e.lastHurtByEntity` — `e.hurtSeq` (`Cb.notifyHurt`'s own counter, already read the
   *  same way by `Ai.UniversalAngerGoal` above) is this engine's closest live analogue,
   *  same standing that goal's own header already established.
   *  ⚠ `noRevengeTypes` (`opts.noRevengeTypes`, a `{type: 1}` set): a vex never retaliates
   *  against a RAIDER that hurt it — currently VACUOUS in live play (`Cb.hurt`'s own header:
   *  mob-vs-mob damage does not exist in this engine, the same "ONE-PLAYER COLLAPSE" this
   *  file's own witch/vindicator section already leans on), named rather than silently
   *  dropped for the day that gap closes.
   *  ⚠ `opts.group` (`setGroupRevenge()` with NO exclusion classes): every OTHER live mob of
   *  `e`'s own type (`ctx.animals()`, the same same-type query `Ai.BreedGoal`'s roster
   *  callers already build) with no target of its own is alerted too — the tame/owner filter
   *  `Ai.HurtByTargetGoal`'s own `getPack` alert carries does not apply (neither vex nor
   *  RaiderEntity is ever tamed).
   */
  Ai.RevengeGoal = function (e, ctx, opts) {
    opts = opts || {};
    var noRevengeTypes = opts.noRevengeTypes || {};
    var lastSeen = -1;
    this.noRevengeTypes = noRevengeTypes;   // read by raidmobcheck (#1280)
    this.group = !!opts.group;   // read by raidmobcheck's roster assertions (#1026)
    this.canUse = function () {
      var seq = e.hurtSeq || 0;
      if (seq <= lastSeen) return false;
      var attacker = e.lastHurtByEntity;
      if (!attacker) return false;
      if (!Ai.canTargetLiving(attacker, e)) return false;   // #3659 RevengeGoal.canTrack
      if (attacker.type && noRevengeTypes[attacker.type]) return false;
      return true;
    };
    this.canContinueToUse = function () { return !!e.target; };
    this.start = function () {
      var attacker = e.lastHurtByEntity;
      e.target = attacker;
      lastSeen = e.hurtSeq || 0;
      if (opts.group) {
        // ⚠ D-602 (raidergoals) — `opts.groupQuery` lets a caller replace the default
        // same-TYPE `ctx.animals()` query with a same-SUPERCLASS one: `RaiderEntity`'s own
        // `setGroupRevenge()` (VindicatorEntity/PillagerEntity/RavagerEntity, below) alerts
        // every OTHER live raider regardless of species, not just same-species mates the way
        // `ctx.animals()` alone would (`Ai.RAIDER_TYPES`, this file's own set).
        var mates = opts.groupQuery ? opts.groupQuery() : ((ctx && ctx.animals) ? ctx.animals() : []);
        for (var i = 0; i < mates.length; i++) {
          var o = mates[i];
          if (!o || o === e || o.target || o.removed) continue;
          o.target = attacker;
        }
      }
    };
    this.stop = function () { e.target = null; };
    this.tick = function () {};
  };

  /**
   * `LlamaEntity.SpitRevengeGoal` (`.decomp/net/minecraft/entity/passive/LlamaEntity.java`,
   * loop/llama-s97, read in full) — `RevengeGoal`'s own shape (`Ai.RevengeGoal` above, reused
   * whole rather than copied) with ONE override: `shouldContinue()` drops the revenge target
   * the instant the llama has actually SPIT once (`e.spit`, set by `Ll.spit`, 07ze_llama.js —
   * the same flag `LlamaEntity.setSpit(true)`/`spitAt` set together in the jar), clearing the
   * flag right back to false so the NEXT hit starts a fresh revenge cycle rather than never
   * re-arming — `SpitRevengeGoal.shouldContinue`'s own `$$0.setSpit(false); return false;`,
   * transcribed verbatim.
   */
  Ai.SpitRevengeGoal = function (e, ctx) {
    var base = new Ai.RevengeGoal(e, ctx, {});
    this.canUse = base.canUse;
    this.start = base.start;
    this.stop = base.stop;
    this.tick = base.tick;
    this.canContinueToUse = function () {
      if (e.spit) { e.spit = false; return false; }
      return base.canContinueToUse();
    };
  };

  /**
   * `LlamaEntity.ChaseWolvesGoal` (`.decomp`, same file, read in full) — `ActiveTargetGoal
   * <WolfEntity>(this, WolfEntity.class, 16, false, true, wolf -> !wolf.isTamed())`, TARGET
   * only, with its own `getFollowRange()` override: the mob's own `followRange` attribute
   * (`Ai.followRangeOf`, `Ai.NearestAttackableTargetGoal`'s own header) times a flat 0.25 —
   * a llama only picks a fight with a wolf standing well inside its usual 40-block awareness.
   * Bespoke rather than a call into `Ai.NearestAttackableTargetGoal` because that helper reads
   * `Ai.followRangeOf(e)` directly with no range-multiplier hook, and because the untamed-only
   * predicate and the `wolf`-only type filter are both specific to this one goal.
   */
  Ai.CHASE_WOLVES_RANGE_MULT = 0.25;   // ChaseWolvesGoal.getFollowRange()'s own multiplier
  // KW-44 (session 152) -- `ActiveTargetGoal`'s own `reciprocalChance` gate
  // (`.decomp/net/minecraft/entity/ai/goal/ActiveTargetGoal.java` ctor + `canStart`), the SAME
  // `toGoalTicks(N)` collapse this file already uses for `Ai.VindicatorBreakDoorGoal` and
  // others (a non-alternating-GoalSelector engine re-checks every real tick, so a vanilla
  // `nextInt(toGoalTicks(16)) != 0 -> skip` becomes a flat `1/8` roll here): `toGoalTicks(16) =
  // ceilDiv(16,2) = 8`, so `findClosestTarget()` only even RUNS on ~1/8 of ticks, exactly like
  // vanilla's `TrackTargetGoal`-driven `canStart()`.
  Ai.CHASE_WOLVES_RECIPROCAL_CHANCE = 8;   // toGoalTicks(16)
  Ai.ChaseWolvesGoal = function (e, ctx) {
    ctx = ctx || {};
    var rand = ctx.random || Ai.rndOf(e);
    this.canUse = function () {
      if (rand() >= 1 / Ai.CHASE_WOLVES_RECIPROCAL_CHANCE) return false;   // nextInt(toGoalTicks(16)) != 0, collapsed
      var fr = Ai.followRangeOf(e) * Ai.CHASE_WOLVES_RANGE_MULT;
      if (fr <= 0) return false;
      var EL = NS.EntityList;
      if (!EL || !EL.list) return false;
      var best = null, bestD = Infinity;
      for (var i = 0; i < EL.list.length; i++) {
        var o = EL.list[i];
        if (!o || o.dead || o.removed || o.type !== 'wolf' || o.tamed) continue;
        if (o.y > e.y + (e.height || 0) + 4 || o.y + (o.height || 0) < e.y - 4) continue;   // getSearchBox: expand(range, 4, range)
        if (Math.hypot(o.x - e.x, o.y - e.y, o.z - e.z) > fr) continue;   // TargetPredicate range: feet to feet
        var d = Math.hypot(o.x - e.x, o.y - e.y - Ai.eyeOf(e), o.z - e.z);   // findClosestTarget: closest to (x, eyeY, z)
        if (d < bestD) { best = o; bestD = d; }
      }
      if (best && canNavigateTo(best, fr)) { e.target = best; navTimer = 10 + Math.floor(rand() * 5); return true; }
      return false;
    };
    // #3726 TrackTargetGoal.canNavigateToEntity: a path must exist and end within 1.5 blocks (horizontal) of the target.
    var navTimer = 0;
    function canNavigateTo(t, fr) {
      var p = Ai.findPath(e.x, e.y, e.z, t.x, t.y, t.z, { mob: e, maxDistance: fr, partial: true });
      if (!p || !p.length) return false;
      var end = p[p.length - 1], dx = end.x - Math.floor(t.x), dz = end.z - Math.floor(t.z);
      return dx * dx + dz * dz <= 2.25;
    }
    // KW-44: vanilla's `TrackTargetGoal.shouldContinue()` drops the target the instant
    // `squaredDistanceTo(target) > getFollowRange()^2` -- a HARD cutoff at the SAME
    // `follow_range x 0.25` acquire range, no leash-slack widening (that ×1.5 idiom belongs
    // only to the generic `Ai.NearestAttackableTargetGoal` helper, which `.decomp`'s own
    // `ActiveTargetGoal`/`TrackTargetGoal` pair never applies). Fleeing past the 10-block
    // range the instant it's crossed -- not 15 -- is exactly why a real wolf almost always
    // outruns the reciprocalChance-gated re-check before the llama ever manages a shot.
    this.canContinueToUse = function () {
      if (!e.target || e.target.dead || e.target.removed) return false;
      var d = Math.hypot(e.target.x - e.x, e.target.y - e.y, e.target.z - e.z);
      var fr = Ai.followRangeOf(e) * Ai.CHASE_WOLVES_RANGE_MULT;
      if (d > fr) return false;
      if (--navTimer <= 0) { navTimer = 10 + Math.floor(rand() * 5); if (!canNavigateTo(e.target, fr)) return false; }
      return true;
    };
    this.start = function () {};
    this.stop = function () { e.target = null; };
    this.tick = function () {};
  };

  /**
   * `FormCaravanGoal` (`.decomp/net/minecraft/entity/ai/goal/FormCaravanGoal.java`, loop/
   * llama-s97, read in full) — an unleashed, non-following llama attaches itself to a nearby
   * following-or-leashed llama and walks its own leader's own trail (`Ll.canStartCaravan`/
   * `Ll.canFollowChain`, 07ze_llama.js, own the "who may I follow" question; this goal is only
   * the MOVE control loop around it). `tick()` in the jar calls `getNavigation().
   * startMovingTo(x,y,z,speed)` at a point 2 blocks short of the leader (skipped when the holder
   * is a leash knot); this engine has no bare "walk toward a point" navigator outside a
   * computed path, so `tick()` here paths to that SAME 2-short point, re-pathing when it drifts or the path runs out — the SAME `Ai.findPath`/`Ai.stepToward`/
   * `Ai.closeTo` idiom `Ai.FollowParentGoal` already uses for an identical "walk to a moving
   * relative" job — a named substitution, not a second, different movement model.
   */
  Ai.FormCaravanGoal = function (e, speed) {
    var Ll = NS.Llama;
    var baseSpeed = speed, curSpeed = speed, counter = 0, path = null, idx = 1, goalX = 0, goalZ = 0;
    this.canUse = function () { return Ll ? Ll.canStartCaravan(e) : false; };
    this.canContinueToUse = function () {
      if (!Ll || !Ll.isFollowing(e)) return false;
      var lead = e.llamaFollowing;
      if (!lead || lead.dead || lead.removed) return false;
      var Mnt = NS.Mount;
      var leadOk = (Mnt && Mnt.isLeashed && Mnt.isLeashed(lead)) || Ll.canFollowChain(e, 0);
      if (!leadOk) return false;
      var dx = lead.x - e.x, dy = lead.y - e.y, dz = lead.z - e.z;
      var d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > Ll.CARAVAN_SPEED_RAMP_DIST_SQ) {
        if (curSpeed <= Ll.CARAVAN_SPEED_CAP) {
          curSpeed *= Ll.CARAVAN_SPEED_RAMP;
          counter = Ll.CARAVAN_RAMP_TICKS;
          return true;
        }
        if (counter === 0) return false;
      }
      if (counter > 0) counter--;
      return true;
    };
    this.start = function () { path = null; idx = 1; curSpeed = baseSpeed; counter = 0; };
    this.stop = function () { if (Ll) Ll.stopFollowing(e); curSpeed = baseSpeed; path = null; };
    this.tick = function () {
      var lead = e.llamaFollowing;
      if (!lead) return;
      // Vanilla: a LeashKnot holder means no tick movement at all.
      var h = e.leashHolder;
      if (h && typeof h === 'object' && h.kind === 'knot') return;
      // startMovingTo(self + normalize(leader - self) * max(dist - 2, 0)): stop 2 blocks short.
      var dx = lead.x - e.x, dy = lead.y - e.y, dz = lead.z - e.z;
      var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist <= 2) { path = null; return; }
      var k = (dist - 2) / dist;
      var gx = e.x + dx * k, gy = e.y + dy * k, gz = e.z + dz * k;
      if (!path || idx >= path.length || Math.abs(gx - goalX) + Math.abs(gz - goalZ) > 1) {
        path = Ai.findPath(e.x, e.y, e.z, gx, gy, gz, { mob: e });
        idx = 1; goalX = gx; goalZ = gz;
      }
      if (path && idx < path.length) {
        Ai.stepToward(e, path[idx], curSpeed);
        if (Ai.closeTo(e, path[idx])) idx++;
      }
    };
  };

  /**
   * `WitchEntity`'s own `RaidGoal<RaiderEntity>` (`.decomp/net/minecraft/entity/ai/goal/
   * RaidGoal.java`, read in full) — TARGET only, priority 2. `canStart`: refuse while its own
   * post-fire cooldown (`e.witchRaidCooldown`, decremented every real tick by
   * `Po.tickWitchDrink`, 07z_potion.js — the SAME field `WitchEntity.tickMovement()`'s own
   * `raidGoal.decreaseCooldown()` line decrements) is still positive, OR the 50%
   * `random.nextBoolean()` roll fails, OR this mob has no active ONGOING raid (`raidOf`/
   * `raidOngoing`, this file's own raider-shared-goals helpers, above); else picks the
   * NEAREST live raider (`Ai.RAIDER_TYPES`, excluding `witch` itself — `.decomp`'s own
   * predicate: `$$0.getType() != EntityType.field_6145`, `field_6145` being `WITCH`) within
   * `followRange` — the box(16)+predicate(followRange) double filter `ActiveTargetGoal`'s own
   * base class uses collapses to this one distance test, the same standing simplification
   * this file's own `Ai.NearestAttackableTargetGoal` already makes for every other mob.
   * `start()` sets the 200-tick cooldown (`toGoalTicks(200)`, this file's own D-383 collapse for
   * a non-alternating engine); `shouldContinue` is the base `TrackTargetGoal`'s own distance-
   * only check PLUS the mustSee drop: `WitchEntity` builds `RaidGoal(..., checkVisibility=true, ...)`,
   * so acquisition needs `Ai.canSee`, the search box is `expand(followRange, 4, followRange)` (|dy| <= 4
   * between bounding boxes), and a target unseen for more than 60 ticks is dropped (TrackTargetGoal).
   */
  Ai.RaidGoal = function (e, ctx) {
    var unseen = 0;
    this.canUse = function () {
      if ((e.witchRaidCooldown || 0) > 0) return false;
      var rand = (ctx && ctx.random) || Ai.rndOf(e);
      if (rand() < 0.5) return false;
      if (!raidOngoing(raidOf(e))) return false;
      var fr = Ai.followRangeOf(e);
      if (fr <= 0) return false;
      var EL = NS.EntityList;
      if (!EL || !EL.list) return false;
      var best = null, bestD = Infinity;
      for (var i = 0; i < EL.list.length; i++) {
        var o = EL.list[i];
        if (!o || o === e || o.dead || o.removed) continue;
        if (o.type === 'witch' || !Ai.RAIDER_TYPES[o.type]) continue;
        if (o.y > e.y + (e.height || 0) + 4 || o.y + (o.height || 0) < e.y - 4) continue;   // expand(fr, 4, fr)
        if (Math.hypot(o.x - e.x, o.y - e.y, o.z - e.z) > fr) continue;   // TargetPredicate range: feet-to-feet
        var d = Math.hypot(o.x - e.x, o.y - (e.y + Ai.eyeOf(e)), o.z - e.z);   // getClosestEntity(.., getEyeY(), ..)
        if (d < bestD && Ai.canSee(e, o)) { bestD = d; best = o; }
      }
      if (!best) return false;
      e.target = best;
      return true;
    };
    this.canContinueToUse = function () {
      if (!e.target) return false;
      var d = Math.hypot(e.target.x - e.x, e.target.y - e.y, e.target.z - e.z);
      if (d > Ai.followRangeOf(e)) return false;
      if (Ai.canSee(e, e.target)) unseen = 0;
      else if (++unseen > 60) return false;   // TrackTargetGoal maxTimeWithoutVisibility
      return true;
    };
    this.start = function () { e.witchRaidCooldown = 200; unseen = 0; };
    this.stop = function () { e.target = null; };
    this.tick = function () {};
  };

  /**
   * `DisableableFollowTargetGoal` (`.decomp/net/minecraft/entity/ai/goal/
   * DisableableFollowTargetGoal.java`) wraps a plain `ActiveTargetGoal` with an
   * externally-flipped `enabled` switch (`setEnabled`) that `canStart`/`shouldContinue` both
   * gate on — `WitchEntity.tickMovement()` is the ONLY writer of that switch in vanilla
   * (`this.attackPlayerGoal.setEnabled(this.raidGoal.getCooldown() <= 0)`), which is exactly
   * what `isEnabled()` reads here, off the SAME `e.witchRaidCooldown` field `Ai.RaidGoal`
   * writes and `Po.tickWitchDrink` decrements — no second cooldown field, no duplicate state.
   */
  Ai.DisableableFollowTargetGoal = function (e, base, isEnabled) {
    this.inner = base;   // goalaudit names the wrapped goal, as the jar registers it unwrapped (#2149)
    this.canUse = function () { return !!isEnabled() && base.canUse(); };
    this.canContinueToUse = function () { return !!isEnabled() && base.canContinueToUse(); };
    this.start = function () { base.start(); };
    this.stop = function () { base.stop(); };
    this.tick = function () { base.tick(); };
  };

  /** A TemptGoal `Ingredient.ofItems(...)` predicate that is NOT the species' breeding food (horse's golden
   *  items, pig's carrot_on_a_stick, strider's warped fungus stick): accepts a stack, a stack-returning
   *  function or an item name, like `Breed.itemNameOf` does (#213, goals-1.18.2.tsv). */
  Ai.temptOnly = function (names) {
    return function (stack) {
      var n = NS.Breed && NS.Breed.itemNameOf ? NS.Breed.itemNameOf(stack) : (typeof stack === 'string' ? stack : '');
      return names.indexOf(n) >= 0;
    };
  };

  /**
   * `RabbitEntity.setRabbitType(99)` (RabbitEntity.java:341-346): RabbitAttackGoal(1.4, true) at goal
   * priority 4 (reach 4 + targetWidth, plays entity.rabbit.attack), targetSelector RevengeGoal(group) 1 +
   * ActiveTargetGoal Player 2 + Wolf 2. Added once per selector (`gs.killer99`), never in the base roster.
   */
  Ai.killerBunnyGoals = function (e, gs, ctx) {
    if (!gs || gs.killer99) return;
    gs.killer99 = true;
    var players = ctx.players || function () { return []; };
    gs.add(4, Ai.MOVE, new Ai.MeleeAttackGoal(e, 1.4, function (m, t) { return 4.0 + ((t && t.width) || 0.6); }, function () {
      if (NS.Sound && NS.Sound.mobSound) NS.Sound.mobSound(e, 'entity.rabbit.attack', 1.0, (Ai.rndOf(e)() - Ai.rndOf(e)()) * 0.2 + 1.0);   // tryAttack: vol 1, pitch (r-r)*0.2+1, category via getSoundCategory
    }));
    gs.add(1, Ai.TARGET, new Ai.RevengeGoal(e, ctx, { group: true }));
    gs.add(2, Ai.TARGET, new Ai.NearestAttackableTargetGoal(e, players));
    gs.add(2, Ai.TARGET, new Ai.NearestAttackableTargetGoal(e, function () {
      var out = [], L = NS.EntityList && NS.EntityList.list || [];
      for (var i = 0; i < L.length; i++) if (!L[i].removed && L[i].type === 'wolf') out.push(L[i]);
      return out;
    }));
  };

  Ai.ROSTER = {
    // ⚠ Animal's breeding trio (Breed/Tempt/FollowParent) is shared boilerplate across vanilla's
    // animal subclasses, not custom per mob — but the exact PRIORITY NUMBERS here are this
    // session's placement, not a jar read (D-383 names the gap). `ctx.animals()` and
    // `ctx.isTempting` are not fed by anything live yet; only `goalcheck.mjs` supplies them.
    cow: function (e, ctx) {
      // D-417 — vanilla SPEED MODIFIERS, not blocks per tick. Cow's registerGoals().
      var gs = new Ai.GoalSelector();
      var animals = ctx.animals || function () { return []; };
      var isTempting = ctx.isTempting || function () { return false; };
      gs.add(0, Ai.JUMP, new Ai.FloatGoal(e, ctx.random));
      gs.add(1, Ai.MOVE, new Ai.PanicGoal(e, 2.0, { favor: e.type === 'mooshroom' ? Ai.mooshroomPathfindingFavor : Ai.animalPathfindingFavor }));
      gs.add(2, Ai.MOVE | Ai.LOOK, new Ai.BreedGoal(e, 1.0, animals, ctx.onBreed));
      gs.add(3, Ai.MOVE | Ai.LOOK, new Ai.TemptGoal(e, 1.25, ctx.players, isTempting));
      gs.add(4, Ai.MOVE, new Ai.FollowParentGoal(e, 1.25, animals));
      // ⚠ D-423 — THESE THREE PRIORITIES WERE 7/8/9 AND VANILLA'S ARE 5/6/7, and the look
      // range was the goal's 8 where cow passes 6.0F. Both read off `bij.u()` (Cow's own
      // `registerGoals`), so cow's roster is now the jar's entire list at the jar's own
      // numbers — D-383's "the PRIORITY NUMBERS here are this session's placement" no longer
      // applies to cow. It still applies to zombie and skeleton.
      gs.add(5, Ai.MOVE, new Ai.WanderAroundFarGoal(e, 1.0, ctx.random, undefined,   // #1495: WanderAroundFarGoal(1.0)
        e.type === 'mooshroom' ? Ai.mooshroomPathfindingFavor : Ai.animalPathfindingFavor));
      gs.add(6, Ai.LOOK, new Ai.LookAtPlayerGoal(e, ctx.players, 6.0));
      gs.add(7, Ai.MOVE | Ai.LOOK, new Ai.RandomLookAroundGoal(e, ctx.random));
      return gs;
    },
    zombie: function (e, ctx) {
      var speed = 1.0;   // D-417 — Zombie's own goals are all speedModifier 1.0
      var gs = new Ai.GoalSelector();
      // (no SwimGoal: ZombieEntity.initGoals/initCustomGoals add none — a zombie sinks. #213 read the jar.)
      if (e.canBreakDoors) gs.add(1, Ai.MOVE, new Ai.BreakDoorGoal(e, ctx));   // D-399 — setCanBreakDoors adds it (not in registerGoals); late rolls: Undead.initZombieAttributes
      if (NS.Undead && NS.Undead.DestroyEggGoal) gs.add(4, Ai.MOVE, new NS.Undead.DestroyEggGoal(e, ctx, speed, ctx.random));   // #879
      gs.add(2, Ai.MOVE | Ai.LOOK, new Ai.ZombieAttackGoal(e, speed));
      // #1239: `RevengeGoal(this).setGroupRevenge(ZombifiedPiglinEntity.class)` -- callSameTypeForRevenge alerts every
      // mob of `getClass()` (instanceof: a ZOMBIE's call reaches husk/drowned/villager/piglin subclasses; husk and
      // zombie_villager share this roster but their class is their own); the listed ZombifiedPiglin is EXCLUDED (noHelpTypes, #3883).
      var zombieKin = { zombie: { zombie: 1, husk: 1, drowned: 1, zombie_villager: 1 } }[e.type] || {};
      zombieKin[e.type] = 1;
      function zombiePack() {
        var out = [], EL = NS.EntityList;
        if (ctx.entities) EL = { list: ctx.entities() };
        if (!EL || !EL.list) return out;
        for (var i = 0; i < EL.list.length; i++) {
          var o = EL.list[i];
          if (o && !o.removed && !o.dead && o !== e && zombieKin[o.type]) out.push(o);
        }
        return out;
      }
      gs.add(1, Ai.TARGET, new Ai.HurtByTargetGoal(e, null, zombiePack));   // #213: RevengeGoal is priority 1
      gs.add(2, Ai.TARGET, new Ai.NearestAttackableTargetGoal(e, ctx.players, { sight: true, mustSee: true, reciprocalChance: 10, rand: ctx.random }));   // #213: ActiveTargetGoal(Player) is priority 2
      // cloud unit referee-mob-avoid-panic: `ZombieEntity.initCustomGoals` (.decomp :109)
      // `targetSelector.add(3, ActiveTargetGoal<MerchantEntity>(this, false))` was missing, so a
      // zombie ignored every villager and wandering trader (avoidrefcheck villager/trader_zombie_4:
      // the fleer ran at the server's speed but pulled away 50% faster, nothing chasing it).
      gs.add(3, Ai.TARGET, new Ai.NearestAttackableTargetGoal(e, function () { return merchantsOf(e); }));
      function ofType(t) {
        var out = [], EL = NS.EntityList;
        if (!EL || !EL.list) return out;
        for (var i = 0; i < EL.list.length; i++) {
          var o = EL.list[i];
          if (!o.removed && !o.dead && o !== e && o.type === t) out.push(o);
        }
        return out;
      }
      // #1238 ZombieEntity.initCustomGoals: ActiveTargetGoal<IronGolem>(3, true) and
      // ActiveTargetGoal<Turtle>(5, 10, true, false, BABY_TURTLE_ON_LAND_FILTER); both reciprocal 10.
      gs.add(3, Ai.TARGET, new Ai.NearestAttackableTargetGoal(e, ctx.golems || function () { return []; },
        { sight: true, mustSee: true, reciprocalChance: 10, rand: ctx.random }));
      gs.add(5, Ai.TARGET, new Ai.NearestAttackableTargetGoal(e, function () {
        return ofType('turtle').filter(function (t) { return t.isBaby && !t.inWater; });
      }, { sight: true, mustSee: true, reciprocalChance: 10, rand: ctx.random }));
      gs.add(6, Ai.MOVE, new Ai.MoveThroughVillageGoal(e, speed, true, 4, function () { return !!e.canBreakDoors; }, ctx.random));   // #1237
      gs.add(7, Ai.MOVE, new Ai.WanderAroundFarGoal(e, speed, ctx.random));   // #2827: ZombieEntity.initCustomGoals WanderAroundFarGoal(1.0)
      gs.add(8, Ai.LOOK, new Ai.LookAtPlayerGoal(e, ctx.players));
      gs.add(8, Ai.MOVE | Ai.LOOK, new Ai.RandomLookAroundGoal(e, ctx.random));   // #213: ZombieEntity.initGoals' LookAroundGoal
      return gs;
    },
    // D-396 (session 34): skeleton — JOB 1's true remainder. Priorities mirror zombie's own
    // roster shape (both direct `Monster` subclasses): FloatGoal 0, ranged attack 2/MOVE|LOOK,
    // HurtByTargetGoal 2/TARGET, NearestAttackableTargetGoal 3/TARGET, stroll 7, look 8/9 — the
    // NUMBERS are this session's placement, not a jar read of skeleton's own registerGoals(),
    // same caveat D-383 already put on cow's/zombie's own roster (Ai.OWED names it below).
    // `ctx.onShoot` is `EL.aiCtx`'s own real `Combat.mobShoot` in live play as of D-402
    // (session 40) — `goalcheck.mjs` still injects a synthetic one for the algorithm-only
    // proof, the same standing D-394's `Cb.mobAttack` already has for `MeleeAttackGoal`.
    // D-602 (raidergoals) CLOSED: `updateAttackType`/`reassessWeaponGoal` — a skeleton/stray
    // that no longer holds a bow now swaps to `Ai.SkeletonMeleeFallbackGoal` (1.2 speed, the
    // jar's own `meleeAttackGoal` literal), same priority/flag pair, mutually exclusive on
    // `Ai.holdsBow(e)` (that goal's own header).
    skeleton: function (e, ctx) {
      var speed = 1.0;   // D-417 — Skeleton's stroll/bow modifier; AvoidEntityGoal's is 1.2
      var gs = new Ai.GoalSelector();
      // AbstractSkeletonEntity.java:69-72 — `FleeEntityGoal<>(this, WolfEntity.class, 6.0F, 1.0,
      // 1.2)`, priority 3 (same tier as `EscapeSunlightGoal`, still `Ai.OWED` -- avoidscen.mjs's
      // own header). Cloud unit, avoidrefcheck's own "flees when the real server mostly doesn't"
      // reds (skeleton_wolf_3/6): this roster had NO flee-wolf goal at all, so a fresh-vs-wolf
      // pen only ever moved via the priority-7 stroll's own incidental drift, which crossed the
      // check's 1-block margin far more often than the real server's own goal (that mostly FAILS
      // its own 10-fuzz escape-point search at these ranges, same mechanic `Ai.AvoidEntityGoal`
      // already implements faithfully for cat/ocelot/creeper). `ofType` mirrors wolf's own roster
      // helper (07k_goals.js:4008) -- no `wolves()` reader exists on `ctx.aiCtx` (only same-type
      // `animals()`).
      function ofType(t) {
        var out = [];
        var EL = NS.EntityList;
        if (!EL || !EL.list) return out;
        for (var i = 0; i < EL.list.length; i++) {
          var o = EL.list[i];
          if (!o.removed && !o.dead && o !== e && o.type === t) out.push(o);
        }
        return out;
      }
      function wolves() { return ofType('wolf'); }
      // (no SwimGoal: AbstractSkeletonEntity.initGoals adds none — #213 read the jar)
      // D-597: the real BowAttackGoal (see its header) — was Ai.RangedBowAttackGoal's one-clock stand-in.
      gs.add(4, Ai.MOVE | Ai.LOOK, new Ai.BowAttackGoal(e, speed, ctx.onShoot, ctx.random));
      gs.add(4, Ai.MOVE | Ai.LOOK, new Ai.SkeletonMeleeFallbackGoal(e, 1.2));   // AbstractSkeletonEntity.java:49
      gs.add(1, Ai.TARGET, new Ai.HurtByTargetGoal(e));
      gs.add(3, Ai.MOVE, new Ai.AvoidEntityGoal(e, 6, 1.0, wolves, function () { return true; },
        { random: ctx.random, fastSpeed: 1.2 }));
      gs.add(2, 0, new Ai.AvoidSunlightGoal(e));                         // AbstractSkeletonEntity.initGoals (#1130)
      gs.add(3, Ai.MOVE, new Ai.EscapeSunlightGoal(e, 1.0, ctx.random));
      gs.add(2, Ai.TARGET, new Ai.NearestAttackableTargetGoal(e, ctx.players, { sight: true, mustSee: true, reciprocalChance: 10, rand: ctx.random }));
      // #1131 AbstractSkeletonEntity.initGoals: ActiveTargetGoal<IronGolem>(3, checkVisibility) and
      // ActiveTargetGoal<Turtle>(10, true, false, BABY_TURTLE_ON_LAND_FILTER); both reciprocal 10.
      gs.add(3, Ai.TARGET, new Ai.NearestAttackableTargetGoal(e, ctx.golems || function () { return []; },
        { sight: true, mustSee: true, reciprocalChance: 10, rand: ctx.random }));
      gs.add(3, Ai.TARGET, new Ai.NearestAttackableTargetGoal(e, function () {
        return ofType('turtle').filter(function (t) { return t.isBaby && !t.inWater; });
      }, { sight: true, mustSee: true, reciprocalChance: 10, rand: ctx.random }));
      gs.add(5, Ai.MOVE, new Ai.WanderAroundFarGoal(e, 1.0, ctx.random));   // #4761: AbstractSkeletonEntity.java:73 WanderAroundFarGoal(1.0)
      gs.add(6, Ai.LOOK, new Ai.LookAtPlayerGoal(e, ctx.players));
      gs.add(6, Ai.MOVE | Ai.LOOK, new Ai.RandomLookAroundGoal(e, ctx.random));   // #213: priorities read off AbstractSkeletonEntity.java:70-75/171
      return gs;
    },
    // D-401 (session 39, PASS 16 JOB 1): spider — `registerGoals()` read in full from `bmo.u()`
    // (Spider's own 20-method class read whole first, this pass's own rule). Priorities ARE the
    // jar's own, not this session's placement, unlike cow/zombie/skeleton above: goalSelector
    // 1/FloatGoal, 3/LeapAtTargetGoal(0.4F), 4/SpiderAttackGoal, 5/WaterAvoidingRandomStrollGoal
    // (0.8D), 6/LookAtPlayerGoal(Player,8F), 6/RandomLookAroundGoal; targetSelector
    // 1/HurtByTargetGoal, 2/SpiderTargetGoal(Player), 3/SpiderTargetGoal(IronGolem) — loop/
    // wolfgoals wired priority 3 now that iron_golem exists (07l_spawn.js), reusing
    // `Ai.SpiderTargetGoal` against `ctx.golems` the same way priority 2 reuses it against
    // `ctx.players` (same class, `bmo`'s own `SpiderEntity.TargetGoal<>` generic, one type
    // param apart). Climbing itself is not a goal at all — `Ph.onClimbable`'s own spider branch
    // (`14b_physics.js`, D-401) is what keeps a spider on a wall; nothing here decides that.
    spider: function (e, ctx) {
      var gs = new Ai.GoalSelector();
      gs.add(1, Ai.JUMP, new Ai.FloatGoal(e));
      gs.add(3, Ai.MOVE | Ai.JUMP, new Ai.PounceAtTargetGoal(e, ctx, 0.4));
      gs.add(4, Ai.MOVE | Ai.LOOK, new Ai.SpiderAttackGoal(e, ctx));
      gs.add(5, Ai.MOVE, new Ai.WaterAvoidingRandomStrollGoal(e, 0.8, ctx.random));
      gs.add(6, Ai.LOOK, new Ai.LookAtPlayerGoal(e, ctx.players));
      gs.add(6, Ai.MOVE | Ai.LOOK, new Ai.RandomLookAroundGoal(e, ctx.random));
      gs.add(1, Ai.TARGET, new Ai.HurtByTargetGoal(e));
      gs.add(2, Ai.TARGET, new Ai.SpiderTargetGoal(e, ctx, ctx.players));
      gs.add(3, Ai.TARGET, new Ai.SpiderTargetGoal(e, ctx, ctx.golems || function () { return []; }));
      return gs;
    },

    /**
     * loop/creeper-s95 (QUEUE 0.2 G18c) — creeper. `.decomp/net/minecraft/entity/mob/
     * CreeperEntity.java`'s own `initGoals()`, read whole and transcribed at the JAR'S OWN
     * priorities (SAME TIER AS SPIDER, not cow/zombie/skeleton's "session's own placement"):
     * goalSelector 1:SwimGoal · 2:CreeperIgniteGoal · 3:FleeEntityGoal(OcelotEntity,6F,1,1.2) ·
     * 3:FleeEntityGoal(CatEntity,6F,1,1.2) · 4:MeleeAttackGoal(1.0,false) ·
     * 5:WanderAroundFarGoal(0.8) · 6:LookAtEntityGoal(Player,8F) · 6:LookAroundGoal.
     * targetSelector 1:ActiveTargetGoal(Player,true) · 2:RevengeGoal.
     *
     * ⚠ THREE SUBSTITUTIONS, EACH NAMED, NOT A DIFFERENT ALGORITHM:
     *   - `SwimGoal` -> `Ai.FloatGoal` — the SAME class this engine already uses for cow's/
     *     zombie's own priority-0 float goal (see `Ai.FloatGoal`'s own header: vanilla's own
     *     class here, not an approximation).
     *   - the TWO `FleeEntityGoal`s (ocelot, cat) -> ONE `Ai.AvoidEntityGoal` call whose threat
     *     list is both species at once — `Ai.AvoidEntityGoal` (built for cat's own flee-the-
     *     player goal) IS `FleeEntityGoal`'s own shape (range/speed/threats/isAvoiding); folding
     *     two same-shaped vanilla goals into one call changes nothing a check can observe, since
     *     both ever do is "flee whichever of these is closer", and this engine's selector runs
     *     one goal slot either way. `1.0`/`1.2` (walk/sprint) now matches both vanilla goals'
     *     own dual speed (cloud unit, avoidrefcheck's speed-calibration reds closed
     *     `Ai.AvoidEntityGoal`'s single-speed gap generically via `fleeOpts.fastSpeed`).
     *   - `WanderAroundFarGoal` -> `Ai.WaterAvoidingRandomStrollGoal` — placement-tier
     *     approximation, same standing as cow's own priority-5 stroll before D-423 closed it;
     *     `Ai.OWED` names the gap (a real WanderAroundFarGoal is a bare "no water aversion"
     *     stroll, not built as its own class since nothing else needs it yet).
     * `RevengeGoal` -> `Ai.HurtByTargetGoal(e)` — the SAME call zombie's own priority-2 TARGET
     * goal already makes (D-396 already treats the two Yarn names as the same shape).
     */
    creeper: function (e, ctx) {
      var gs = new Ai.GoalSelector();
      var players = ctx.players || function () { return []; };
      function fleeThreats(type) {   // the jar's two rows: ocelot, then cat
        return function () {
          var out = [];
          if (!NS.EntityList || !NS.EntityList.list) return out;
          var list = NS.EntityList.list;
          for (var i = 0; i < list.length; i++) {
            var o = list[i];
            if (o.removed || o === e) continue;
            if (o.type === type) out.push(o);
          }
          return out;
        };
      }
      gs.add(1, Ai.JUMP, new Ai.FloatGoal(e, ctx.random));
      gs.add(2, Ai.MOVE, new Ai.CreeperIgniteGoal(e));
      ['ocelot', 'cat'].forEach(function (t) {
        gs.add(3, Ai.MOVE, new Ai.AvoidEntityGoal(e, 6, 1.0, fleeThreats(t), function () { return true; },
          { random: ctx.random, favor: Ai.hostilePathfindingFavor, fastSpeed: 1.2 }));   // creeper is a HostileEntity, not an AnimalEntity; FleeEntityGoal(6F,1.0,1.2)
      });
      gs.add(4, Ai.MOVE | Ai.LOOK, new Ai.MeleeAttackGoal(e, 1.0));
      gs.add(5, Ai.MOVE, new Ai.WanderAroundFarGoal(e, 0.8, ctx.random));
      gs.add(6, Ai.LOOK, new Ai.LookAtPlayerGoal(e, players, 8.0));
      gs.add(6, Ai.MOVE | Ai.LOOK, new Ai.RandomLookAroundGoal(e, ctx.random));
      gs.add(1, Ai.TARGET, new Ai.NearestAttackableTargetGoal(e, players));
      gs.add(2, Ai.TARGET, new Ai.HurtByTargetGoal(e));
      return gs;
    },

    // loop/enderman-s98 -- EndermanEntity.initGoals() (.decomp, read in full: :92-105).
    // PRIORITY NUMBERS ARE THE JAR'S OWN, not this session's placement (unlike cow/zombie/
    // skeleton's own D-383 caveat): goalSelector 0/SwimGoal(=Ai.FloatGoal, same substitution
    // spider/creeper/golem above already use) - 1/ChasePlayerGoal - 2/MeleeAttackGoal(1.0,false)
    // - 7/WanderAroundFarGoal(1.0) - 8/LookAtEntityGoal(Player,8F) - 8/LookAroundGoal -
    // 10/PlaceBlockGoal - 11/PickUpBlockGoal; targetSelector 1/TeleportTowardsPlayerGoal(this,
    // shouldAngerAt) - 2/RevengeGoal - 3/ActiveTargetGoal<EndermiteEntity> (OWED: no endermite
    // entity in this roster) - 4/UniversalAngerGoal(this,false). `WanderAroundFarGoal` ->
    // `Ai.WaterAvoidingRandomStrollGoal` is the SAME placement-tier substitution D-486's own
    // header (iron_golem, above) and D-383 (zombie/skeleton) already use for a bare "no water
    // aversion" wander this engine does not carry a separate un-averse goal for.
    enderman: function (e, ctx) {
      var Em = NS.Enderman;
      var gs = new Ai.GoalSelector();
      gs.add(0, Ai.JUMP, new Ai.FloatGoal(e, ctx.random));
      if (Em) gs.add(1, Ai.MOVE | Ai.LOOK, new Em.ChasePlayerGoal(e));
      gs.add(2, Ai.MOVE | Ai.LOOK, new Ai.MeleeAttackGoal(e, 1.0));
      gs.add(7, Ai.MOVE, new Ai.WanderAroundFarGoal(e, 1.0, ctx.random, 0));
      gs.add(8, Ai.LOOK, new Ai.LookAtPlayerGoal(e, ctx.players, 8.0));
      gs.add(8, Ai.MOVE | Ai.LOOK, new Ai.RandomLookAroundGoal(e, ctx.random));
      if (Em) {
        gs.add(10, 0, new Em.PlaceBlockGoal(e));
        gs.add(11, 0, new Em.PickUpBlockGoal(e));
        gs.add(1, Ai.TARGET, new Em.TeleportTowardsPlayerGoal(e));
      }
      gs.add(2, Ai.TARGET, new Ai.RevengeGoal(e, ctx, {}));
      // priority 3: ActiveTargetGoal<EndermiteEntity>(this, true, false) (EndermanEntity.java:
      // 101-104) -- s115, an endermite exists now (07zn2_endermite.js).
      if (NS.Endermite) gs.add(3, Ai.TARGET, new Ai.NearestAttackableTargetGoal(e, NS.Endermite.endermitesNear(ctx),
        { sight: true, mustSee: true, reciprocalChance: 10, rand: ctx.random, livingBox: true }));
      gs.add(4, Ai.TARGET, new Ai.UniversalAngerGoal(e, ctx.random));
      return gs;
    },

    // D-458 (G18e unit 3) — wolf, cat, ocelot. ⚠ WOLF UPGRADED, loop/wolfgoals: `bje.u()`
    // (`WolfEntity.initGoals`, `.decomp`, read in full) is now wired below AT THE JAR'S OWN
    // PRIORITIES, same tier as spider/creeper, not cow/zombie/skeleton's "session's own
    // placement" any more. loop/wolfpounce (this pass) built the last MOVE goal TYPE:
    // `PounceAtTargetGoal(0.4F)` (real priority 4, MOVE|JUMP) is `Ai.PounceAtTargetGoal` — the
    // same class spider already uses (Yarn's `PounceAtTargetGoal` == Mojang's own
    // `LeapAtTargetGoal`, one `.decomp` file, `bdz`). `TemptGoal`/`FollowParentGoal` below are
    // NOT in `bje.u()` at all (wolf has no tempt-at-a-distance or baby-follow-parent goal in
    // vanilla — breeding is `AnimalMateGoal`/`Ai.BreedGoal` only, once two tamed wolves are
    // separately fed love mode) — kept anyway for the existing feed-from-a-distance behaviour
    // `Ai.OWED`'s own generic "BreedGoal/TemptGoal/FollowParentGoal roster PRIORITIES" line
    // already covers, placed at priorities 11/12 so neither can ever preempt a real slot.
    wolf: function (e, ctx) {
      var gs = new Ai.GoalSelector();
      var animals = ctx.animals || function () { return []; };
      var players = ctx.players || function () { return []; };
      var isTempting = ctx.isTempting || function () { return false; };
      function ofType(t) {
        var out = [];
        var EL = NS.EntityList;
        if (!EL || !EL.list) return out;
        for (var i = 0; i < EL.list.length; i++) {
          var o = EL.list[i];
          if (!o.removed && !o.dead && o !== e && o.type === t) out.push(o);
        }
        return out;
      }
      // WolfEntity.FOLLOW_TAMED_PREDICATE (.decomp:72-75, javap'd EntityType constants
      // field_6115/field_6140/field_17943): sheep, rabbit, fox — TYPE ONLY, no other filter.
      function prey() { return ofType('sheep').concat(ofType('rabbit'), ofType('fox')); }
      // TurtleEntity.BABY_TURTLE_ON_LAND_FILTER (.decomp): isBaby() && !isTouchingWater().
      function babyTurtlesOnLand() {
        return ofType('turtle').filter(function (t) { return t.isBaby && !t.inWater; });
      }
      // AbstractSkeletonEntity's three live subclasses (07l_spawn.js's own spawn table).
      function abstractSkeletons() {
        return ofType('skeleton').concat(ofType('stray'), ofType('wither_skeleton'));
      }
      // AvoidLlamaGoal (.decomp inner class, read in full): FleeEntityGoal<LlamaEntity>(24F,1.5,1.5)
      // that only ever fires while UNTAMED, against a llama whose own `getStrength()` beats a
      // fresh `random.nextInt(5)` roll (`Mnt.getStrength`, D-497's own jar-extracted 1..5 field) —
      // clears `e.target` on both start() and every tick(), same as the jar's own override.
      var avoidLlamaInner = new Ai.AvoidEntityGoal(e, 24, 1.5, function () { return ofType('llama'); },
        function () { return !e.tamed; },
        { random: ctx.random, afterNearest: function (l) {
          var strength = (NS.Mount && NS.Mount.getStrength) ? NS.Mount.getStrength(l) : 1;
          return strength >= Math.floor(ctx.random() * 5);
        } });   // KW-45: the mob's own seeded RNG, not Ai.rndOf(e) (determinism)
      var avoidLlama = {
        inner: avoidLlamaInner,   // #213: goalrostercheck reads the wrapped AvoidEntityGoal's (range, speeds)
        canUse: function () { return avoidLlamaInner.canUse(); },
        canContinueToUse: function () { return avoidLlamaInner.canContinueToUse(); },
        start: function () { e.target = null; avoidLlamaInner.start(); },
        stop: function () { avoidLlamaInner.stop(); },
        tick: function () { e.target = null; avoidLlamaInner.tick(); }
      };
      // ── MOVE, at bje.u()'s own priority numbers ──
      gs.add(1, Ai.JUMP, new Ai.FloatGoal(e, ctx.random));                    // SwimGoal
      gs.add(1, Ai.MOVE, new Ai.PanicGoal(e, 1.5, { inDanger: function () { return Ai.shouldEscapePowderSnow(e) || !!e.isOnFire; } }));   // WolfEscapeDangerGoal(1.5): isInDanger = powder snow || on fire ONLY, no attacker term (.decomp WolfEntity.java:560-568)
      gs.add(2, Ai.MOVE | Ai.JUMP, new Ai.SitGoal(e));                                            // SitGoal
      gs.add(3, Ai.MOVE, avoidLlama);                                                   // AvoidLlamaGoal
      gs.add(4, Ai.MOVE | Ai.JUMP, new Ai.PounceAtTargetGoal(e, ctx, 0.4));      // PounceAtTargetGoal(0.4F) == LeapAtTargetGoal (bdz), loop/wolfpounce
      gs.add(5, Ai.MOVE | Ai.LOOK, new Ai.MeleeAttackGoal(e, 1.0, undefined, undefined, undefined, true));   // MeleeAttackGoal(1.0,true)
      gs.add(6, Ai.MOVE | Ai.LOOK, new Ai.FollowOwnerGoal(e, 1.0, 10, 2, players));   // bdr javap'd: wolf stopDist 2.0f (D-474)
      gs.add(7, Ai.MOVE | Ai.LOOK, new Ai.BreedGoal(e, 1.0, animals, ctx.onBreed));               // AnimalMateGoal(1.0)
      gs.add(8, Ai.MOVE, new Ai.WanderAroundFarGoal(e, 1.0, ctx.random, undefined, Ai.animalPathfindingFavor));     // WanderAroundFarGoal(1.0)
      gs.add(9, Ai.LOOK, new Ai.WolfBegGoal(e, ctx, 8.0));                             // WolfBegGoal(8.0F)
      gs.add(10, Ai.LOOK, new Ai.LookAtPlayerGoal(e, players, 8.0));                   // LookAtEntityGoal(Player,8F)
      gs.add(10, Ai.MOVE | Ai.LOOK, new Ai.RandomLookAroundGoal(e, ctx.random));                 // LookAroundGoal
      // ── engine-only, no bje.u() equivalent — see this roster's own header comment ──
      // (no TemptGoal / FollowParentGoal: WolfEntity.initGoals has neither — #213 removed the two placements)
      // ── TARGET, at bje.u()'s own priority numbers (1/2/3 pre-date loop/wolfgoals, D-477) ──
      gs.add(1, Ai.TARGET, new Ai.OwnerHurtByTargetGoal(e, players));                   // TrackOwnerAttackerGoal
      gs.add(2, Ai.TARGET, new Ai.OwnerHurtTargetGoal(e, players));                     // AttackWithOwnerGoal
      gs.add(3, Ai.TARGET, new Ai.HurtByTargetGoal(e, ctx.random, animals));   // RevengeGoal.setGroupRevenge() (D-475 anger + D-477 pack alert)
      gs.add(4, Ai.TARGET, new Ai.AngryPlayerTargetGoal(e));           // ActiveTargetGoal<Player>(shouldAngerAt)
      gs.add(5, Ai.TARGET, new Ai.UntamedActiveTargetGoal(e, prey, ctx.random));            // UntamedActiveTargetGoal<AnimalEntity>
      gs.add(6, Ai.TARGET, new Ai.UntamedActiveTargetGoal(e, babyTurtlesOnLand, ctx.random));  // UntamedActiveTargetGoal<TurtleEntity>
      gs.add(7, Ai.TARGET, new Ai.NearestAttackableTargetGoal(e, abstractSkeletons)); // ActiveTargetGoal<AbstractSkeleton>
      gs.add(8, Ai.TARGET, new Ai.UniversalAngerGoal(e, ctx.random, true, function () { return ofType('wolf'); }));  // UniversalAngerGoal<>(this,true), loop/wolfpounce
      return gs;
    },
    // ⚠ CAT ONLY (not ocelot — see 07n_tame.js's header ruling). `isAvoiding` drops the flee
    // once tamed, the one place this roster reads `e.tamed` — everything else in this session's
    // taming unit is orthogonal to the goal selector.
    cat: function (e, ctx) {
      var gs = new Ai.GoalSelector();
      var animals = ctx.animals || function () { return []; };
      var isTempting = ctx.isTempting || function () { return false; };
      var players = ctx.players || function () { return []; };
      // #213 (D-383): every priority below is CatEntity.initGoals' own (goals-1.18.2.tsv). Vanilla's cat has NO
      // FollowParentGoal (kittens do not follow), a 0.6 tempt speed, and adds its CatFleeGoal at priority 4
      // (onTamedChanged, while untamed) — the roster's old 0/2/3/4/5/6/6/7/8 was a placement.
      gs.add(1, Ai.MOVE | Ai.JUMP, new Ai.SitGoal(e));
      gs.add(1, Ai.JUMP, new Ai.FloatGoal(e, ctx.random));
      gs.add(2, Ai.MOVE | Ai.JUMP, new Ai.SleepWithOwnerGoal(e, players, ctx.random, ctx.skyAngle, ctx.dropGift));   // CatEntity.SleepWithOwnerGoal
      gs.add(5, Ai.MOVE | Ai.JUMP, new Ai.GoToBedAndSleepGoal(e, 1.1, 8));
      gs.add(7, Ai.MOVE, new Ai.CatSitOnBlockGoal(e, 0.8));
      gs.add(4, Ai.MOVE, new Ai.AvoidEntityGoal(e, 16, 0.8, players, function (t) { return !e.tamed && !t.invulnerableGamemode; }, { fastSpeed: 1.33 }));  // CatEntity.java:471 CatFleeGoal(PlayerEntity, 16.0F, 0.8, 1.33) -- cloud unit: was speed 1.6 (wrong on both counts -- neither vanilla number), now the real dual 0.8/1.33
      // #1870: CatEntity.TemptGoal.canStart = super.canStart() && !cat.isTamed(). #3708: canBeScared player memory (tick: 1/300 pick, 1/250 forget = getTickCount(600/500))
      var catRand = ctx.random || Ai.rndOf(e), catMem = null;
      var catTempt = new Ai.TemptGoal(e, 0.6, players, function (it) { return !e.tamed && isTempting(it); }, function (t) { return !(catMem && catMem === t); });
      var catTemptTick = catTempt.tick;
      catTempt.tick = function () {
        catTemptTick.call(catTempt);
        if (!catMem && catRand() * 300 < 1) catMem = catTempt.target();
        else if (catRand() * 250 < 1) catMem = null;
      };
      gs.add(3, Ai.MOVE | Ai.LOOK, catTempt);
      gs.add(6, Ai.MOVE | Ai.LOOK, new Ai.FollowOwnerGoal(e, 1.0, 10, 5, players));   // bdr javap'd: cat stopDist 5.0f (D-474)
      gs.add(8, Ai.MOVE | Ai.JUMP, new Ai.PounceAtTargetGoal(e, ctx, 0.3));   // PounceAtTargetGoal(0.3F)
      gs.add(9, Ai.MOVE | Ai.LOOK, new Ai.AttackGoal(e));
      gs.add(10, Ai.MOVE | Ai.LOOK, new Ai.BreedGoal(e, 0.8, animals, ctx.onBreed));
      gs.add(11, Ai.MOVE, new Ai.WanderAroundFarGoal(e, 0.8, ctx.random, 1.0000001E-5, Ai.animalPathfindingFavor));
      gs.add(12, Ai.LOOK, new Ai.LookAtPlayerGoal(e, players, 10.0));
      function ofTypeC(t) {
        var out = [], EL = NS.EntityList;
        if (!EL || !EL.list) return out;
        for (var i = 0; i < EL.list.length; i++) { var o = EL.list[i]; if (!o.removed && !o.dead && o !== e && o.type === t) out.push(o); }
        return out;
      }
      gs.add(1, Ai.TARGET, new Ai.UntamedActiveTargetGoal(e, function () { return ofTypeC('rabbit'); }, ctx.random));
      gs.add(1, Ai.TARGET, new Ai.UntamedActiveTargetGoal(e, function () {
        return ofTypeC('turtle').filter(function (t) { return t.isBaby && !t.inWater; });
      }, ctx.random));
      return gs;
    },
    // ⚠ OCELOT ONLY — no `SitGoal`, no taming path at all (see 07n_tame.js's header ruling: an
    // ocelot cannot be tamed in vanilla 1.18.2). It DOES have a trust state: `isAvoiding` is `!e.trusting`
    // (set by fish feeding, Tm.feedOcelot; #1605).
    ocelot: function (e, ctx) {
      var gs = new Ai.GoalSelector();
      var animals = ctx.animals || function () { return []; };
      var isTempting = ctx.isTempting || function () { return false; };
      var players = ctx.players || function () { return []; };
      gs.add(1, Ai.JUMP, new Ai.FloatGoal(e, ctx.random));
      // #213: OcelotEntity.initGoals (goals-1.18.2.tsv): swim 1, tempt 3 @0.6, mate 9 @0.8, wander 10 @0.8, look 11;
      // no FollowParentGoal and no LookAroundGoal; the FleeGoal is added at priority 4 while not trusting.
      gs.add(4, Ai.MOVE, new Ai.AvoidEntityGoal(e, 16, 0.8, players, function (t) { return !e.trusting && !t.invulnerableGamemode; }, { fastSpeed: 1.33 }));  // #1605: updateFleeing removes the goal while trusting; OcelotEntity.java:224 FleeGoal(PlayerEntity, 16.0F, 0.8, 1.33) -- cloud unit: was speed 1.6 (wrong, same as cat), now the real dual 0.8/1.33
      gs.add(3, Ai.MOVE | Ai.LOOK, new Ai.TemptGoal(e, 0.6, players, isTempting, function () { return !e.trusting; }));   // OcelotTemptGoal.canBeScared = !isTrusting
      gs.add(9, Ai.MOVE | Ai.LOOK, new Ai.BreedGoal(e, 0.8, animals, ctx.onBreed));
      gs.add(10, Ai.MOVE, new Ai.WanderAroundFarGoal(e, 0.8, ctx.random, 1.0000001E-5, Ai.animalPathfindingFavor));
      gs.add(11, Ai.LOOK, new Ai.LookAtPlayerGoal(e, players, 10.0));
      gs.add(7, Ai.MOVE | Ai.JUMP, new Ai.PounceAtTargetGoal(e, ctx, 0.3));   // PounceAtTargetGoal(0.3F) (#1606)
      gs.add(8, Ai.MOVE | Ai.LOOK, new Ai.AttackGoal(e));
      function ofTypeO(t) {
        var out = [], EL = NS.EntityList;
        if (!EL || !EL.list) return out;
        for (var i = 0; i < EL.list.length; i++) { var o = EL.list[i]; if (!o.removed && !o.dead && o !== e && o.type === t) out.push(o); }
        return out;
      }
      // ActiveTargetGoal(Chicken,false) and (Turtle,10,false,false,BABY_TURTLE_ON_LAND_FILTER): reciprocal chance 10 each.
      gs.add(1, Ai.TARGET, new Ai.NearestAttackableTargetGoal(e, function () { return ofTypeO('chicken'); }, { reciprocalChance: 10, sight: true, livingBox: true }));
      gs.add(1, Ai.TARGET, new Ai.NearestAttackableTargetGoal(e, function () {
        return ofTypeO('turtle').filter(function (t) { return t.isBaby && !t.inWater; });
      }, { reciprocalChance: 10, sight: true, livingBox: true }));
      return gs;
    },
    // D-459 (G18e, horse's own next unit after D-458) — horse now EXISTS (motion resolves via
    // the conditional-generic shape, see extract-entity-motion.mjs). ⚠ PLACEMENT TIER, same
    // caveat as wolf/cat/ocelot/cow-before-D-423: goal TYPES and constants are vanilla's own
    // (PanicGoal on hurt, breed/tempt/follow-parent off the same wheat/hay/apple/carrot table
    // 07m_breed.js already has for horse), but priorities are this session's placement, not a
    // bytecode read of `bjq`/`bjo`'s own `registerGoals()` — named on `Ai.OWED`, not silently
    // approximated. No taming, no riding, no saddle, no jump-charge (all Tame.OWED/G25 — the
    // rest Dan allocated to the next pass, not this unit).
    horse: function (e, ctx) {
      var gs = new Ai.GoalSelector();
      var animals = ctx.animals || function () { return []; };
      var isTempting = ctx.isTempting || function () { return false; };   // (unused since #213: tempt list below)
      gs.add(0, Ai.JUMP, new Ai.FloatGoal(e, ctx.random));
      gs.add(1, Ai.MOVE, new Ai.PanicGoal(e, 1.2));
      // QUEUE 0.2 (G18e remainder, D-49x) — `HorseBaseEntity`'s own
      // `this.goalSelector.add(1, new HorseBondWithPlayerGoal(this, 1.2))`, javap'd in full
      // (`HorseBondWithPlayerGoal.java`, .decomp). Priority 1 is the jar's own number, not this
      // placement tier's usual "session's own slot" caveat — see `Ai.HorseBondWithPlayerGoal`'s
      // own header for what is exact and what (the cosmetic wander-while-bucking walk) is not.
      gs.add(1, Ai.MOVE, new Ai.HorseBondWithPlayerGoal(e, ctx));
      gs.add(2, Ai.MOVE | Ai.LOOK, new Ai.BreedGoal(e, 1.0, animals, ctx.onBreed));
      // #213: HorseBaseEntity.initCustomGoals' TemptGoal is `Ingredient.ofItems(golden_carrot, golden_apple,
      // enchanted_golden_apple)` — NOT the wider breeding list (wheat/sugar/hay/apple too) `isTempting` asks.
      gs.add(3, Ai.MOVE | Ai.LOOK, new Ai.TemptGoal(e, 1.25, ctx.players,
        Ai.temptOnly(['golden_carrot', 'golden_apple', 'enchanted_golden_apple'])));
      gs.add(4, Ai.MOVE, new Ai.FollowParentGoal(e, 1.0, animals));
      gs.add(6, Ai.MOVE, new Ai.WanderAroundFarGoal(e, 0.7, ctx.random, undefined, Ai.animalPathfindingFavor));
      gs.add(7, Ai.LOOK, new Ai.LookAtPlayerGoal(e, ctx.players, 6.0));
      gs.add(8, Ai.MOVE | Ai.LOOK, new Ai.RandomLookAroundGoal(e, ctx.random));
      return gs;
    },
    // loop/donkey-s96 (QUEUE 0.2 G18e remainder close) -- donkey/mule now EXIST (07r_mount.js's
    // own Mnt.MOUNTABLE/CHESTABLE, this session) and share `AbstractHorseEntity`'s goal list
    // with horse verbatim -- nothing in `Ai.ROSTER.horse` above is horse-specific (no armour
    // goal, no colour-variant goal; those live outside the GoalSelector entirely) -- so this is
    // the SAME function object, not a second copy of it.
    donkey: function (e, ctx) { return Ai.ROSTER.horse(e, ctx); },
    mule: function (e, ctx) { return Ai.ROSTER.horse(e, ctx); },
    // loop/lightning -- `SkeletonHorseEntity` (.decomp/net/minecraft/entity/mob/
    // SkeletonHorseEntity.java, read whole): `initCustomGoals()` is an EMPTY override, so
    // unlike `horse` (which adds SwimGoal+TemptGoal in ITS OWN `initCustomGoals`) a skeleton
    // horse gets ONLY `HorseBaseEntity.initGoals()`'s own base list minus the two horse adds
    // -- no SwimGoal, no TemptGoal, and (same reasoning `Mnt.OWED` already gives donkey/mule)
    // no functioning AnimalMateGoal either, since nothing in this engine's feeding model ever
    // sets love mode on a skeleton horse. `EscapeDangerGoal`/`Ai.PanicGoal` is the same
    // placement-tier substitute `horse`'s own row above already uses, not a bytecode-exact
    // goal class (`Ai.OWED`). The SkeletonHorseTrapTriggerGoal itself (priority 1, added/
    // removed at runtime by `setTrapped`, .decomp) is NOT a static roster entry -- it is
    // dispatched straight off `e.trapped` from `EL.tickOne`'s generic per-type slot, the same
    // shape `tnt`/`potion`/`evoker_fangs` already use, in `Lgt.tickTrap` (src/07zzc_lightning.js).
    skeleton_horse: function (e, ctx) {
      var gs = new Ai.GoalSelector();
      var animals = ctx.animals || function () { return []; };
      // #213: HorseBaseEntity.initGoals as SkeletonHorseEntity inherits it (its initCustomGoals is empty, so no
      // SwimGoal/TemptGoal) — priorities 1/1/2/4/6/7/8 are the jar's (goals-1.18.2.tsv).
      gs.add(1, Ai.MOVE, new Ai.PanicGoal(e, 1.2));
      gs.add(1, Ai.MOVE, new Ai.HorseBondWithPlayerGoal(e, ctx));
      gs.add(2, Ai.MOVE | Ai.LOOK, new Ai.BreedGoal(e, 1.0, animals, ctx.onBreed));
      gs.add(4, Ai.MOVE, new Ai.FollowParentGoal(e, 1.0, animals));
      gs.add(6, Ai.MOVE, new Ai.WanderAroundFarGoal(e, 0.7, ctx.random, undefined, Ai.animalPathfindingFavor));
      gs.add(7, Ai.LOOK, new Ai.LookAtPlayerGoal(e, ctx.players, 6.0));
      gs.add(8, Ai.MOVE | Ai.LOOK, new Ai.RandomLookAroundGoal(e, ctx.random));
      return gs;
    },
    // #712: ZombieHorseEntity.initCustomGoals is empty too -- same HorseBaseEntity.initGoals list as skeleton_horse.
    zombie_horse: function (e, ctx) { return Ai.ROSTER.skeleton_horse(e, ctx); },
    /**
     * loop/llama-s97 (QUEUE 0.2 G18e remainder close) -- `LlamaEntity.initGoals()` (`.decomp`,
     * read in full), transcribed AT THE JAR'S OWN PRIORITIES (same standing as creeper/spider,
     * not horse/donkey's own "session's own placement"): goalSelector 0:SwimGoal ·
     * 1:HorseBondWithPlayerGoal(1.2) · 2:FormCaravanGoal(2.1) · 3:ProjectileAttackGoal(1.25,40,
     * 40,20.0) · 3:EscapeDangerGoal(1.2) · 4:AnimalMateGoal(1.0) · 5:TemptGoal(1.25,hay_block,
     * false) · 6:FollowParentGoal(1.0) · 7:WanderAroundFarGoal(0.7) · 8:LookAtEntityGoal(Player,
     * 6.0) · 9:LookAroundGoal. targetSelector 1:SpitRevengeGoal · 2:ChaseWolvesGoal.
     *
     * ⚠ THREE NAMED SUBSTITUTIONS, same discipline creeper's own header already holds itself to:
     *   - `SwimGoal` -> `Ai.FloatGoal` (vanilla's own class, not an approximation, same as
     *     every other roster entry in this file);
     *   - `EscapeDangerGoal` -> `Ai.PanicGoal` — this engine has only ever built `PanicGoal`
     *     (horse's own priority-1 slot above already uses it); both flee-on-hurt at a flat
     *     speed, `Ai.OWED` names the gap between the two real vanilla classes;
     *   - `WanderAroundFarGoal` -> `Ai.WaterAvoidingRandomStrollGoal` — the SAME placement-tier
     *     approximation horse's own priority-5 slot above already makes, `Ai.OWED`'s own
     *     standing entry for it.
     * `TemptGoal`'s own ingredient is `Ingredient.ofItems(Items.HAY_BLOCK)` ONLY — narrower than
     * `Breed.isFood('llama', ...)` (wheat OR hay_block) — so `isTempting` here is a bespoke
     * hay_block-only check, not `ctx.isTempting`. `ProjectileAttackGoal`'s own `onShoot` is
     * `Ll.spit` (07ze_llama.js) directly: unlike the witch-potion/cow-breed cases, the
     * projectile module already IS the real jar-specific consequence, no caller-supplied
     * callback layer needed.
     */
    llama: function (e, ctx) {
      var gs = new Ai.GoalSelector();
      var animals = ctx.animals || function () { return []; };
      var isHayBlock = function (item) { return item === 'hay_block'; };
      gs.add(0, Ai.JUMP, new Ai.FloatGoal(e, ctx.random));
      gs.add(1, Ai.MOVE, new Ai.HorseBondWithPlayerGoal(e, ctx));
      gs.add(2, Ai.MOVE, new Ai.FormCaravanGoal(e, 2.1));
      gs.add(3, Ai.MOVE | Ai.LOOK, new Ai.ProjectileAttackGoal(e, 1.25, 40, 40, 20.0, function (mob, target) {
        if (NS.Llama) NS.Llama.spit(mob, target);
      }));
      gs.add(3, Ai.MOVE, new Ai.PanicGoal(e, 1.2));
      gs.add(4, Ai.MOVE | Ai.LOOK, new Ai.BreedGoal(e, 1.0, animals, ctx.onBreed));
      gs.add(5, Ai.MOVE | Ai.LOOK, new Ai.TemptGoal(e, 1.25, ctx.players, isHayBlock));
      gs.add(6, Ai.MOVE, new Ai.FollowParentGoal(e, 1.0, animals));
      gs.add(7, Ai.MOVE, new Ai.WanderAroundFarGoal(e, 0.7, ctx.random, undefined, Ai.animalPathfindingFavor));
      gs.add(8, Ai.LOOK, new Ai.LookAtPlayerGoal(e, ctx.players, 6.0));
      gs.add(9, Ai.MOVE | Ai.LOOK, new Ai.RandomLookAroundGoal(e, ctx.random));
      gs.add(1, Ai.TARGET, new Ai.SpitRevengeGoal(e, ctx));
      gs.add(2, Ai.TARGET, new Ai.ChaseWolvesGoal(e, ctx));
      return gs;
    },
    // loop/wtrader-s103 -- TraderLlamaEntity.initGoals (.decomp): super.initGoals() (llama's
    // own roster, unchanged) PLUS its own EscapeDangerGoal(2.0) and a targetSelector-only
    // DefendTraderGoal (Ll.DefendTraderGoal, 07ze_llama.js) -- both appended, not replacing
    // anything llama's own roster already builds.
    trader_llama: function (e, ctx) {
      var gs = Ai.ROSTER.llama(e, ctx);
      gs.add(1, Ai.MOVE, new Ai.PanicGoal(e, 2.0));   // EscapeDangerGoal(2.0) -> Ai.PanicGoal, the same substitution llama's own roster already makes
      if (NS.Llama && NS.Llama.DefendTraderGoal) gs.add(1, Ai.TARGET, new NS.Llama.DefendTraderGoal(e));
      return gs;
    },
    // loop/wtrader-s103 -- WanderingTraderEntity's own goal roster; the real construction lives
    // in WT.rosterGoals (07zt_wtrader.js, this unit's own file) so this file's own edit stays
    // the one-line registration every sibling mob unit's own load-order comment already asks
    // for (build.mjs).
    wandering_trader: function (e, ctx) { return NS.WT ? NS.WT.rosterGoals(e, ctx) : new Ai.GoalSelector(); },
    // Row 3 (G18f), loop pass 22 Sept 2026: villager EXISTS now (motion generic per
    // entity-motion-1.18.2.tsv, texture already resolved off the 1.13.2 jar) -- this is the
    // SAME placement tier cow/zombie/skeleton started at, not bnw.u()'s real registerGoals()
    // (Ai.OWED names the real remainder: trading, fleeing danger, a work/rest schedule, golem
    // calling). No BreedGoal/TemptGoal -- villagers don't breed via food the way animals do
    // (a real trade/willingness mechanic vanilla has, unread and unwired).
    villager: function (e, ctx) {
      var gs = new Ai.GoalSelector();
      gs.add(0, Ai.JUMP, new Ai.FloatGoal(e, ctx.random));
      // loop/vb-activity: real `VillagerEntity`/`MerchantEntity` (.decomp, grepped in full this
      // session) never call `goalSelector.add` for a stroll goal at all -- ALL of a villager's
      // movement is its own Brain/Activity machinery (07zv_villagerbrain.js's own `NS.VB`,
      // `VB.SCHEDULE`/`tickWork`/`tickIdle`/`tickRest`/`tickMeet`). Once that module is present
      // this roster drops the MOVE-flag stroll placeholder so VB's own walk target is the only
      // thing steering, for every Activity (idle/work/meet/rest) -- not just REST/MEET, the gap
      // `VB.OWED` used to name here. `NS.VB` absent entirely (a stripped build, or a check that
      // loads this file without 07zv_villagerbrain.js) keeps the old placement-tier stand-in so
      // a villager built without VB still moves at all.
      var vbReady = !!(NS.VB && NS.VB.init && NS.VB.init().ready);
      if (!vbReady) gs.add(1, Ai.MOVE, new Ai.WaterAvoidingRandomStrollGoal(e, 0.6, ctx.random));
      gs.add(2, Ai.LOOK, new Ai.LookAtPlayerGoal(e, ctx.players, 3.0));
      gs.add(3, Ai.MOVE | Ai.LOOK, new Ai.RandomLookAroundGoal(e, ctx.random));
      return gs;
    },
    // Row 3 (G18f), loop pass 23 Sept 2026 (D-486): iron golem EXISTS (motion generic per
    // entity-motion-1.18.2.tsv, texture auto-resolved off the 1.13.2 jar). `bin.u()`
    // (IronGolem.registerGoals) javap'd IN FULL, both selectors:
    // MOVE(`bQ`) 1:`bed`(this,1.0,true)=MeleeAttackGoal · 2:`bei`(this,0.9,32F)=WanderNearTargetGoal
    // · 2:`bee`(this,0.6,false)=WanderAroundPointOfInterestGoal · 4:`bdv`(this,0.6)=IronGolemWanderAroundGoal
    // · 5:`bek`(this)=IronGolemLookGoal · 7:`beb`(this,Player,6F)=LookAtPlayerGoal ·
    // 8:`beo`(this)=RandomLookAroundGoal. TARGET(`bR`) 1:`bfj`(this)=TrackIronGolemTargetGoal
    // (DefendVillageTargetGoal) · 2:`bfk`(this,[])=HurtByTargetGoal · 3:`bfl`(this,Player,10,true,
    // false,this::shouldAngerAt)=the angry-player half · 3:`bfl`(this,Mob,5,false,false,bin.j)=
    // hostile-mob filter (excludes Creeper) · 4:`bfr`(this,false)=UniversalAngerGoal.
    //
    // ROW 0.2 REMAINDER (this pass) — every entry the D-486 header above named OWED is wired:
    // `TrackIronGolemTargetGoal` (priority 1, `Ai.TrackIronGolemTargetGoal`, reads the new
    // `NS.Village` reputation/gossip substrate — see `07l_spawn.js`), the angry-player half of
    // priority 3 (`Ai.AngryPlayerTargetGoal`, the one-player collapse documented above it),
    // `UniversalAngerGoal` (priority 4, `Ai.UniversalAngerGoal` — `triggerOthers=false` for the
    // golem, javap-confirmed, so no alert-others behaviour exists to wire), the hostile-mob
    // filter now excludes Creeper (`bin.j`'s own `!($$0 instanceof CreeperEntity)`, previously
    // missing), `WanderNearTargetGoal`/`IronGolemWanderAroundGoal` (both named-simplification —
    // see each goal's own header, no POI storage exists in this engine) and `IronGolemLookGoal`
    // (the flower-offering state, `e.offeringFlower`). `WanderAroundPointOfInterestGoal` (`bee`)
    // is NOT wired — its entire body is a POI-occupancy query this engine cannot answer at all
    // (`Ai.OWED` below names it) — the plain `WaterAvoidingRandomStrollGoal` D-486 already left
    // at a lower priority keeps covering both that gap and `IronGolemWanderAroundGoal`'s own
    // 30%-random branch (see that goal's header).
    iron_golem: function (e, ctx) {
      var gs = new Ai.GoalSelector();
      // (no SwimGoal: IronGolemEntity.initGoals has none — #213. The priority-5 stroll below is NOT in the jar: it
      // stands in for IronGolemWanderAroundGoal's own 30% random-point branch, which the goal at 4 leaves out.)
      gs.add(1, Ai.MOVE | Ai.LOOK, new Ai.MeleeAttackGoal(e, 1.0, undefined, undefined, undefined, true));   // IronGolemEntity.java:73 (…, true)
      gs.add(2, Ai.MOVE, new Ai.WanderNearTargetGoal(e, 0.9, 32.0 * 32.0));
      gs.add(2, Ai.MOVE, new Ai.WanderAroundPointOfInterestGoal(e, 0.6, ctx.random));
      gs.add(4, Ai.MOVE, new Ai.IronGolemWanderAroundGoal(e, 0.6, ctx));
      gs.add(5, Ai.MOVE | Ai.LOOK, new Ai.IronGolemLookGoal(e, ctx));
      gs.add(7, Ai.LOOK, new Ai.LookAtPlayerGoal(e, ctx.players, 6.0));
      gs.add(8, Ai.MOVE | Ai.LOOK, new Ai.RandomLookAroundGoal(e, ctx.random));
      gs.add(1, Ai.TARGET, new Ai.TrackIronGolemTargetGoal(e, ctx));
      gs.add(2, Ai.TARGET, new Ai.HurtByTargetGoal(e, ctx.random));
      gs.add(3, Ai.TARGET, new Ai.AngryPlayerTargetGoal(e));
      gs.add(3, Ai.TARGET, new Ai.NearestAttackableTargetGoal(e, function () {
        var out = [];
        if (!NS.EntityList || !NS.Spawn) return out;
        for (var i = 0; i < NS.EntityList.list.length; i++) {
          var o = NS.EntityList.list[i];
          if (o === e || o.removed) continue;
          if (o.type === 'creeper') continue;   // bin.j — !($$0 instanceof CreeperEntity), javap'd
          if (NS.Spawn.categoryOf(o.type) === 'monster') out.push(o);
        }
        return out;
      }, { sight: true, reciprocalChance: 5, vertical: 4, rand: ctx.random }));   // ActiveTargetGoal(Mob,5,false,false,filter) #3676
      gs.add(4, 0, new Ai.UniversalAngerGoal(e, ctx.random));   // no controls declared in the decompiled class — see its own header
      return gs;
    }
  ,

    // ═══ RAID MOBS (QUEUE 0.2 raid loop, loop/illagers-s92) — read from .decomp: `VindicatorEntity`/
    // `PillagerEntity`/`WitchEntity`/`RavagerEntity`/`EvokerEntity`/`IllusionerEntity`'s own
    // `initGoals()`, each mob's real `goalSelector`/`targetSelector` calls transcribed IN FULL
    // below the comment for that mob. Every one extends `RaiderEntity`, whose OWN `initGoals()`
    // adds `PickupBannerAsLeaderGoal`(1)/`MoveToRaidCenterGoal`(3)/`AttackHomeGoal`(4)/
    // `CelebrateGoal`(5), and `PatrolEntity`'s own adds `PatrolGoal`(4) above that — NONE of
    // those four are wired for any of the six mobs below: they need a live `Raid`/patrol
    // object on the entity (`getRaid()`/`hasActiveRaid()`) and a village-center/home position
    // this engine's spawned mobs do not carry (`Rd.OWED`'s "patrol spawning"/"moveRaidCenter"
    // lines already name the underlying gap). Named once here rather than repeated per mob.

    // `VindicatorEntity.initGoals()` (VindicatorEntity.java:57-71): SwimGoal(0), own
    // `BreakDoorGoal`(1), `LongDoorInteractGoal`(2), `PatrolApproachGoal`(3), own `AttackGoal`(4)
    // = `MeleeAttackGoal(this, 1.0, false)` with a ravager-mount reach override (no mounted-
    // ravager riding in this engine — `Rd.OWED`); target `RevengeGoal`(1, group),
    // `ActiveTargetGoal(Player)`(2), `ActiveTargetGoal(Merchant, true)`(3), `ActiveTargetGoal(
    // IronGolem, true)`(3), own `TargetGoal`(4, any LivingEntity.isMobOrPlayer, johnny-gated).
    // D-602 (raidergoals) CLOSED: own `BreakDoorGoal` (`Ai.VindicatorBreakDoorGoal`, real
    // NORMAL/HARD gate + hasActiveRaid() + 1-in-10 roll, above), group `RevengeGoal`
    // (`Ai.RevengeGoal(e, ctx, {group:true, groupQuery: raidersOf})`, replacing the
    // `HurtByTargetGoal` stand-in), merchant/iron-golem targeting (`merchantsOf`/`ctx.golems`),
    // and the johnny `TargetGoal` (`Ai.VindicatorTargetGoal`, vacuous today — no NBT reader
    // sets `e.johnny`, `Ai.OWED`). QUEUE 0.2 row (loop/raiderroar) CLOSED THIS PASS:
    // `LongDoorInteractGoal` (`Ai.VindicatorLongDoorInteractGoal`, priority 2, above -- real
    // hasActiveRaid()-gated open/close-without-break) and `PatrolApproachGoal` (`Ai.
    // PatrolApproachGoal`, priority 3, above -- real, though `isRaidCenterSet()`'s own body is
    // approximated, `Ai.PatrolApproachGoal`'s own header names the exact gap).
    vindicator: function (e, ctx) {
      var gs = new Ai.GoalSelector();
      gs.add(0, Ai.JUMP, new Ai.FloatGoal(e, ctx.random));
      gs.add(1, Ai.MOVE, new Ai.VindicatorBreakDoorGoal(e, ctx));
      gs.add(2, 0, new Ai.VindicatorLongDoorInteractGoal(e, ctx));
      gs.add(3, Ai.MOVE | Ai.LOOK, new Ai.PatrolApproachGoal(e, ctx));
      gs.add(4, Ai.MOVE | Ai.LOOK, new Ai.VindicatorAttackGoal(e));
      // #213: IllagerEntity's WanderAroundGoal(0.6) at 8 and LookAtEntityGoal(Player, 3) at 9 (IllagerEntity/VindicatorEntity.initGoals)
      gs.add(8, Ai.MOVE, new Ai.WanderAroundGoal(e, 0.6, ctx.random));
      gs.add(9, Ai.LOOK, new Ai.LookAtPlayerGoal(e, ctx.players, 3.0, undefined, 1.0));
      gs.add(10, Ai.LOOK, new Ai.LookAtMobGoal(e, ctx, 8.0));   // #2239: VindicatorEntity.initGoals LookAtEntityGoal(MobEntity, 8.0F)
      gs.add(1, Ai.TARGET, new Ai.RevengeGoal(e, ctx, { noRevengeTypes: Ai.RAIDER_TYPES, group: true, groupQuery: function () { return sameClassNear(e); } }));
      gs.add(2, Ai.TARGET, new Ai.NearestAttackableTargetGoal(e, ctx.players, { sight: true, mustSee: true, reciprocalChance: 10, rand: ctx.random }));
      gs.add(3, Ai.TARGET, new Ai.NearestAttackableTargetGoal(e, function () { return merchantsOf(e); }, { sight: true, mustSee: true, reciprocalChance: 10, rand: ctx.random, livingBox: true }));
      gs.add(3, Ai.TARGET, new Ai.NearestAttackableTargetGoal(e, ctx.golems || function () { return []; }, { sight: true, mustSee: true, reciprocalChance: 10, rand: ctx.random, livingBox: true }));
      gs.add(4, Ai.TARGET, new Ai.VindicatorTargetGoal(e, ctx));
      Ai.addRaiderGoals(gs, e, ctx);
      return gs;
    },

    // `PillagerEntity.initGoals()` (PillagerEntity.java:66-79): SwimGoal(0),
    // `PatrolApproachGoal`(2), `CrossbowAttackGoal(this, 1.0, 8.0F)`(3), `WanderAroundGoal(this,
    // 0.6)`(8), `LookAtEntityGoal(Player,15F)`(9), `LookAtEntityGoal(Mob,15F)`(10); target
    // `RevengeGoal`(1, group), `ActiveTargetGoal(Player, true)`(2), `ActiveTargetGoal(Merchant,
    // false)`(3) (`false` IS the `checkVisibility`/mustSee param here, unlike every other raid
    // mob's `true` — read whole, PillagerEntity.java:76), `ActiveTargetGoal(IronGolem, true)`(3).
    // D-602 (raidergoals) CLOSED: `CrossbowAttackGoal`'s own `isEntityHoldingCrossbow()` gate
    // and `seeingTargetTicker` LOS ramp (`Ai.holdsCrossbow`/`Ai.canSee`, wired inside
    // `Ai.CrossbowAttackGoal` itself, its own header), group `RevengeGoal` (replacing
    // `HurtByTargetGoal`), and merchant/iron-golem targeting (`merchantsOf`/`ctx.golems` — the
    // `mustSee` distinction itself is NOT modelled, same standing "canSee not modelled for
    // target ACQUISITION" gap `Ai.NearestAttackableTargetGoal`'s own header already carries for
    // every other raid mob, `Ai.OWED`). QUEUE 0.2 row (loop/raiderroar) CLOSED THIS PASS:
    // `PatrolApproachGoal` (`Ai.PatrolApproachGoal`, priority 2, above -- pillager's own caller,
    // `.decomp/net/minecraft/entity/mob/PillagerEntity.java:70`, same 10.0F distance as
    // vindicator's).
    pillager: function (e, ctx) {
      var gs = new Ai.GoalSelector();
      gs.add(0, Ai.JUMP, new Ai.FloatGoal(e, ctx.random));
      gs.add(2, Ai.MOVE | Ai.LOOK, new Ai.PatrolApproachGoal(e, ctx));
      gs.add(3, Ai.MOVE | Ai.LOOK, new Ai.CrossbowAttackGoal(e, 1.0, 8.0, ctx));
      gs.add(8, Ai.MOVE, new Ai.WanderAroundGoal(e, 0.6, ctx.random));
      gs.add(9, Ai.LOOK, new Ai.LookAtPlayerGoal(e, ctx.players, 15.0, undefined, 1.0));
      gs.add(10, Ai.LOOK, new Ai.LookAtMobGoal(e, ctx, 15.0));            // PillagerEntity LookAtEntityGoal(MobEntity, 15.0F)
      gs.add(1, Ai.TARGET, new Ai.RevengeGoal(e, ctx, { noRevengeTypes: Ai.RAIDER_TYPES, group: true, groupQuery: function () { return sameClassNear(e); } }));
      gs.add(2, Ai.TARGET, new Ai.NearestAttackableTargetGoal(e, ctx.players, { sight: true, mustSee: true, reciprocalChance: 10, rand: ctx.random }));
      gs.add(3, Ai.TARGET, new Ai.NearestAttackableTargetGoal(e, function () { return merchantsOf(e); }, { sight: true, mustSee: false, reciprocalChance: 10, rand: ctx.random, livingBox: true }));
      gs.add(3, Ai.TARGET, new Ai.NearestAttackableTargetGoal(e, ctx.golems || function () { return []; }, { sight: true, mustSee: true, reciprocalChance: 10, rand: ctx.random, livingBox: true }));
      Ai.addRaiderGoals(gs, e, ctx);
      return gs;
    },

    // `WitchEntity.initGoals()` (WitchEntity.java:58-71): SwimGoal(1),
    // `ProjectileAttackGoal(this, 1.0, 60, 10.0F)`(2, THE POTION THROW — loop/witchpotion-s95
    // closed this: a real `Ai.ProjectileAttackGoal` fires through `ctx.onPotionThrow`, which
    // spawns a real `potion` entity and applies `PotionEntity.applySplashPotion` on impact
    // (07z_potion.js) — no longer `Ai.RangedBowAttackGoal`/an arrow),
    // `WanderAroundFarGoal(this, 1.0)`(2), `LookAtEntityGoal(Player,8F)`(3),
    // `LookAroundGoal`(3); target `RevengeGoal`(1), a `RaidGoal`(2, help nearby raiders) and a
    // `DisableableFollowTargetGoal(Player)`(3) — loop/raidvex-s96 CLOSES both of the latter:
    // `Ai.RaidGoal`/`Ai.DisableableFollowTargetGoal` (defined above, near `Ai.RevengeGoal`)
    // are the real `RaidGoal`/toggle, reading `e.witchRaidCooldown` (`Po.tickWitchDrink`'s own
    // `decreaseCooldown()` line, 07z_potion.js) the same way `WitchEntity.tickMovement()`
    // reads `this.raidGoal.getCooldown()` — `Po.witchChoosePotion`'s own raider-ally branch
    // (heal/regen) is reachable from live play for the first time.
    witch: function (e, ctx) {
      var gs = new Ai.GoalSelector();
      gs.add(1, Ai.JUMP, new Ai.FloatGoal(e, ctx.random));
      gs.add(2, Ai.MOVE | Ai.LOOK, new Ai.ProjectileAttackGoal(e, 1.0, 60, 60, 10.0, ctx.onPotionThrow));
      gs.add(2, Ai.MOVE, new Ai.WanderAroundFarGoal(e, 1.0, ctx.random));
      gs.add(3, Ai.LOOK, new Ai.LookAtPlayerGoal(e, ctx.players, 8.0));
      gs.add(3, Ai.MOVE | Ai.LOOK, new Ai.RandomLookAroundGoal(e, ctx.random));
      gs.add(1, Ai.TARGET, new Ai.RevengeGoal(e, ctx, { noRevengeTypes: Ai.RAIDER_TYPES }));   // RevengeGoal(this, RaiderEntity.class) (#1280)
      gs.add(2, Ai.TARGET, new Ai.RaidGoal(e, ctx));
      gs.add(3, Ai.TARGET, new Ai.DisableableFollowTargetGoal(e,
        new Ai.NearestAttackableTargetGoal(e, ctx.players, { sight: true, mustSee: true, reciprocalChance: 10, rand: ctx.random }),
        function () { return (e.witchRaidCooldown || 0) <= 0; }));
      Ai.addRaiderGoals(gs, e, ctx);
      return gs;
    },

    // `RavagerEntity.initGoals()` (RavagerEntity.java:66-78): SwimGoal(0), own `AttackGoal`(4)
    // = `MeleeAttackGoal(this, 1.0, true)` with a reach override using `getWidth() - 0.1F`
    // (ravager's own width, not the base formula's raw width). D-602 (raidergoals) CLOSED:
    // group `RevengeGoal` (replacing `HurtByTargetGoal`) and merchant(non-baby)/iron-golem
    // targeting (`merchantsOf` filtered on `!o.isBaby`/`ctx.golems`). QUEUE 0.2 row
    // (loop/raiderroar) CLOSED THIS PASS: the reach override itself (`Ai.ravagerReachSqr`, above
    // — `Ai.attackReachSqr`'s generic formula WAS a slightly LARGER reach than vanilla's own for
    // this mob, now struck) and the roar/stun/attack-tick state machine (`Ai.RavagerRoarGoal`,
    // `attackTick` set through `Ai.MeleeAttackGoal`'s own `onAttack` hook, above) —
    // `roarTick`/`stunTick`'s own TRIGGER (`Ai.ravagerAttackBlockedByShield`, the shield-block
    // stun) is real but UNREACHABLE from live play: this engine has no shield-blocking mechanic
    // at all yet (`Ai.OWED`, that function's own header).
    ravager: function (e, ctx) {
      var gs = new Ai.GoalSelector();
      gs.add(0, Ai.JUMP, new Ai.FloatGoal(e, ctx.random));   // SwimGoal: Control.JUMP only (#1025)
      // #3762 RavagerEntity.updateGoalControls: a non-raider MobEntity passenger takes MOVE/LOOK/TARGET (and JUMP, or in a boat)
      gs.beforeTick = function () {
        var p = (e.passengers && e.passengers[0]) || e.passenger, v = e.vehicle;
        var controlled = !(p && p.ai) || !!Ai.RAIDER_TYPES[p.type];
        gs.disabled = (controlled ? 0 : Ai.MOVE | Ai.LOOK | Ai.TARGET) | (controlled && !(v && v.type === 'boat') ? 0 : Ai.JUMP);
      };
      gs.add(10, Ai.LOOK, new Ai.LookAtMobGoal(e, ctx, 8.0));   // #1024: RavagerEntity.initGoals LookAtEntityGoal(MobEntity, 8.0F)
      gs.add(4, Ai.MOVE | Ai.LOOK, new Ai.MeleeAttackGoal(e, 1.0, Ai.ravagerReachSqr, function () { e.ravagerAttackTick = Ai.RAVAGER_ATTACK_TICKS; e.ravagerImmobile = true; ravagerSay(e, 'entity.ravager.attack'); }, undefined, true));
      var roar = new Ai.RavagerRoarGoal(e, ctx);
      e.ravagerTickMovement = roar.tick;   // EL.tickMob runs ONLY this while immobile (LivingEntity.tickMovement skips tickNewAi)
      gs.add(4, 0, roar);
      // #213: RavagerEntity.initGoals' WanderAroundFarGoal(0.4) at 5 and LookAtEntityGoal(Player, 6) at 6
      gs.add(5, Ai.MOVE, new Ai.WanderAroundFarGoal(e, 0.4, ctx.random));
      gs.add(6, Ai.LOOK, new Ai.LookAtPlayerGoal(e, ctx.players, 6.0));
      gs.add(2, Ai.TARGET, new Ai.RevengeGoal(e, ctx, { noRevengeTypes: Ai.RAIDER_TYPES, group: true, groupQuery: function () { return sameClassNear(e); } }));
      gs.add(3, Ai.TARGET, new Ai.NearestAttackableTargetGoal(e, ctx.players, { sight: true, mustSee: true, reciprocalChance: 10, rand: ctx.random }));
      gs.add(4, Ai.TARGET, new Ai.NearestAttackableTargetGoal(e, function () {
        return merchantsOf(e).filter(function (o) { return !o.isBaby; });   // ActiveTargetGoal(Merchant, true, !isBaby())
      }, { sight: true, mustSee: true, reciprocalChance: 10, rand: ctx.random, livingBox: true }));
      gs.add(4, Ai.TARGET, new Ai.NearestAttackableTargetGoal(e, ctx.golems || function () { return []; }, { sight: true, mustSee: true, reciprocalChance: 10, rand: ctx.random, livingBox: true }));
      Ai.addRaiderGoals(gs, e, ctx);
      return gs;
    },

    // `EvokerEntity`/`IllusionerEntity.initGoals()` — both `SpellcastingIllagerEntity`
    // subclasses. loop/spells-s93 (QUEUE 0.2 raid loop) closed the state machine `Ai.OWED`/
    // `Rd.OWED` used to name here: `NS.Spell` (07v_spell.js) is a real `CastSpellGoal`/
    // `LookAtTargetGoal` transcription, and FIVE of the six concrete spells are wired —
    // `ConjureFangsGoal` (evoker), `BlindTargetGoal`/`GiveInvisibilityGoal` (illusioner), and
    // — loop/raidvex-s96 — `SummonVexGoal` (evoker), which now really spawns three live,
    // moving `vex` (`Ai.ROSTER.vex`, above; `Fl.VexMoveControl`, 07t_fly.js). `WololoGoal`
    // alone (no sheep colour state anywhere in this engine — `Spell.OWED`) is named, not
    // wired. The
    // priority NUMBERS below now match `.decomp`'s own `initGoals()` exactly for every goal this
    // engine actually has (0 swim, 1 spell-look, 2 flee (evoker), 8 wander, 4/5 the wired
    // spells); the two look-at-player goals move to priority 9, `.decomp`'s own placement for
    // `LookAtEntityGoal(Player, 3F, 1F)` (radius 3.0F, the jar's own -- cloud unit owed-ai-owed replaced a 12.0 placeholder;
    // the mob-look entry at 10 is `Ai.LookAtMobGoal`). Target
    // selectors are the SAME revenge/player/merchant/golem shape `VindicatorEntity`'s own header
    // already transcribes, unchanged.
    evoker: function (e, ctx) {
      var gs = new Ai.GoalSelector();
      gs.add(0, Ai.JUMP, new Ai.FloatGoal(e, ctx.random));
      gs.add(1, Ai.MOVE | Ai.LOOK, new NS.Spell.LookAtTargetGoal(e));
      // cloud unit (owed-ai-owed): EvokerEntity.java:52's own `FleeEntityGoal<>(this,
      // PlayerEntity.class, 8.0F, 0.6, 1.0)` -- the 5-arg ctor's inclusion selector is
      // EXCEPT_CREATIVE_OR_SPECTATOR and its TargetPredicate is createAttackable(), which is
      // `Ai.canTargetLiving`; an IllagerEntity is a HostileEntity, so the escape point is scored
      // by `Ai.hostilePathfindingFavor` (darker wins). Was a stroll at priority 2.
      gs.add(2, Ai.MOVE, new Ai.AvoidEntityGoal(e, 8, 0.6, ctx.players, Ai.canTargetLiving,
        { fastSpeed: 1.0, favor: Ai.hostilePathfindingFavor, random: ctx.random }));
      gs.add(8, Ai.MOVE, new Ai.WanderAroundGoal(e, 0.6, ctx.random));   // EvokerEntity.java:56 WanderAroundGoal(0.6)
      gs.add(5, 0, new NS.Spell.ConjureFangsGoal(e, ctx));
      gs.add(4, 0, new NS.Spell.SummonVexGoal(e, ctx));   // loop/raidvex-s96 — EvokerEntity.java:53's own priority 4
      gs.add(6, 0, new NS.Spell.WololoGoal(e, ctx));      // s98 — EvokerEntity.java:55's own priority 6
      gs.add(9, Ai.LOOK, new Ai.LookAtPlayerGoal(e, ctx.players, 3.0, undefined, 1.0));   // EvokerEntity.java:57 LookAtEntityGoal(Player, 3.0F, 1.0F)
      gs.add(10, Ai.LOOK, new Ai.LookAtMobGoal(e, ctx, 8.0));             // EvokerEntity.java:58 LookAtEntityGoal(MobEntity, 8.0F)
      // #648: EvokerEntity.java:40-51 -- RevengeGoal(Raider).setGroupRevenge (1), Player w/ 300-tick memory (2),
      // Merchant (3, checkVisibility false, 300), IronGolem (3, false)
      gs.add(1, Ai.TARGET, new Ai.RevengeGoal(e, ctx, { noRevengeTypes: Ai.RAIDER_TYPES, group: true, groupQuery: function () { return sameClassNear(e); } }));
      gs.add(2, Ai.TARGET, new Ai.NearestAttackableTargetGoal(e, ctx.players, { sight: true, mustSee: true, maxNoSight: 300, reciprocalChance: 10, rand: ctx.random }));
      gs.add(3, Ai.TARGET, new Ai.NearestAttackableTargetGoal(e, function () { return merchantsOf(e); }, { sight: true, mustSee: false, maxNoSight: 300, reciprocalChance: 10, rand: ctx.random, livingBox: true }));
      gs.add(3, Ai.TARGET, new Ai.NearestAttackableTargetGoal(e, ctx.golems || function () { return []; }, { sight: true, mustSee: false, reciprocalChance: 10, rand: ctx.random, livingBox: true }));
      Ai.addRaiderGoals(gs, e, ctx);
      return gs;
    },
    illusioner: function (e, ctx) {
      var gs = new Ai.GoalSelector();
      gs.add(0, Ai.JUMP, new Ai.FloatGoal(e, ctx.random));
      gs.add(1, Ai.MOVE | Ai.LOOK, new NS.Spell.LookAtTargetGoal(e));
      // IllusionerEntity.java:68 -- WanderAroundGoal(0.6) sits at priority 8 (it has NO flee
      // goal); at 2 it outranked the priority-6 BowAttackGoal and pre-empted every shot.
      gs.add(8, Ai.MOVE, new Ai.WanderAroundGoal(e, 0.6, ctx.random));
      gs.add(4, 0, new NS.Spell.GiveInvisibilityGoal(e, ctx));
      gs.add(5, 0, new NS.Spell.BlindTargetGoal(e, ctx));
      // KW-40 (s151) -- `IllusionerEntity.java:67`'s own `new BowAttackGoal<>(this, 0.5, 20,
      // 15.0F)`, priority 6, was never rostered at all (the illusioner's own spell goals above
      // were wired, the bow never was) -- `ranged2refcheck`'s illusioner scene showed zero
      // shots. Reuses the SAME shared `Ai.BowAttackGoal` skeleton already wires (07k_goals.js:
      // 3763) and the SAME live `ctx.onShoot` (`EL.aiCtx`, 07i_entitylist.js) -- a real `arrow`
      // via `Combat.mobShoot`, not a synthetic stand-in. NOTE (still owed, out of this roster
      // section): the shared goal's post-shot cooldown always calls skeleton-specific `Ai.
      // bowInterval()` (HARD 20 / else 40) is skeleton's updateAttackType override; illusioner has none, so the
      // goal gets the fixed interval 20 (#1018): a constant 20-tick draw + 20-tick cooldown on every difficulty.
      gs.add(6, Ai.MOVE | Ai.LOOK, new Ai.BowAttackGoal(e, 0.5, ctx.onShoot, ctx.random, null, 20));
      gs.add(9, Ai.LOOK, new Ai.LookAtPlayerGoal(e, ctx.players, 3.0, undefined, 1.0));   // IllusionerEntity.java:69 LookAtEntityGoal(Player, 3.0F, 1.0F)
      gs.add(10, Ai.LOOK, new Ai.LookAtMobGoal(e, ctx, 8.0));   // #1027: IllusionerEntity.java:70 LookAtEntityGoal(MobEntity, 8.0F)
      // #1014: IllusionerEntity.java:56-65 -- same selector list as the evoker, all three 300-tick memories
      gs.add(1, Ai.TARGET, new Ai.RevengeGoal(e, ctx, { noRevengeTypes: Ai.RAIDER_TYPES, group: true, groupQuery: function () { return sameClassNear(e); } }));
      gs.add(2, Ai.TARGET, new Ai.NearestAttackableTargetGoal(e, ctx.players, { sight: true, mustSee: true, maxNoSight: 300, reciprocalChance: 10, rand: ctx.random }));
      gs.add(3, Ai.TARGET, new Ai.NearestAttackableTargetGoal(e, function () { return merchantsOf(e); }, { sight: true, mustSee: false, maxNoSight: 300, reciprocalChance: 10, rand: ctx.random, livingBox: true }));
      gs.add(3, Ai.TARGET, new Ai.NearestAttackableTargetGoal(e, ctx.golems || function () { return []; }, { sight: true, mustSee: false, maxNoSight: 300, reciprocalChance: 10, rand: ctx.random, livingBox: true }));
      Ai.addRaiderGoals(gs, e, ctx);
      return gs;
    },

    vex: function (e, ctx) {
      var gs = new Ai.GoalSelector();
      if (!e.flyMove) e.flyMove = new NS.Fly.VexMoveControl(e);
      gs.add(0, Ai.JUMP, new Ai.SwimGoal(e, ctx.random));
      gs.add(0, 0, new Ai.VexAmbientGoal(e, ctx));
      gs.add(4, Ai.MOVE, new Ai.ChargeTargetGoal(e, ctx));
      gs.add(8, Ai.MOVE, new Ai.VexLookAtTargetGoal(e, ctx));
      gs.add(9, Ai.LOOK, new Ai.LookAtPlayerGoal(e, ctx.players, 3.0, undefined, 1.0));   // #213: LookAtEntityGoal(Player, 3.0F, 1.0F)
      gs.add(10, Ai.LOOK, new Ai.LookAtMobGoal(e, ctx, 8.0));   // #764: LookAtEntityGoal(MobEntity, 8.0F)
      gs.add(1, Ai.TARGET, new Ai.RevengeGoal(e, ctx, { noRevengeTypes: Ai.RAIDER_TYPES, group: true }));
      gs.add(2, Ai.TARGET, new Ai.TrackOwnerTargetGoal(e));
      gs.add(3, Ai.TARGET, new Ai.NearestAttackableTargetGoal(e, ctx.players, { sight: true, mustSee: true, maxNoSight: 60, reciprocalChance: 10, rand: ctx.random }));   // #4283: ActiveTargetGoal(Player,true) = 10-tick delay + visibility + 60 unseen
      return gs;
    },

    // ── QUEUE 0.2 (G18c): sheep/chicken/pig — `.decomp`'s own `initGoals()`, read in full,
    // transcribed at the JAR'S OWN PRIORITY NUMBERS (not this session's placement, same
    // standing spider/evoker/illusioner already have above). All three are direct `AnimalEntity`
    // subclasses with no `registerGoals`/`initGoals` override beyond this list, so the shared
    // Float/Panic/Breed/Tempt/FollowParent/Stroll/Look substrate cow already uses is the WHOLE
    // answer for every goal here — nothing invented. `SheepEntity.eatGrassGoal` (priority 5,
    // `EatGrassGoal`) IS now here, real (`Passive.EatGrassGoal`, 07w_passive.js's own QUEUE 0.2
    // G18c item 1) — referenced LAZILY the same way `NS.Spell.*Goal` already is two mobs up:
    // 07w_passive.js loads AFTER this file (build.mjs's own order) but this factory only runs
    // at spawn time, by which point every module has finished loading. `PigEntity`'s own SECOND
    // `TemptGoal` (priority 4, `Ingredient.of(Items.CARROT_ON_A_STICK)`) is STILL not here —
    // steering food is a saddle-riding concept and pig has neither (`Passive.OWED`); only its
    // plain breeding-food `TemptGoal` (the `BREEDING_INGREDIENT` one, also priority 4) is
    // wired, exactly the way cow's own single `TemptGoal` already is.
    sheep: function (e, ctx) {
      var gs = new Ai.GoalSelector();
      var animals = ctx.animals || function () { return []; };
      var isTempting = ctx.isTempting || function () { return false; };
      gs.add(0, Ai.JUMP, new Ai.FloatGoal(e, ctx.random));
      gs.add(1, Ai.MOVE, new Ai.PanicGoal(e, 1.25));
      gs.add(2, Ai.MOVE | Ai.LOOK, new Ai.BreedGoal(e, 1.0, animals, ctx.onBreed));
      gs.add(3, Ai.MOVE | Ai.LOOK, new Ai.TemptGoal(e, 1.1, ctx.players, isTempting));
      gs.add(4, Ai.MOVE, new Ai.FollowParentGoal(e, 1.1, animals));
      gs.add(5, Ai.MOVE | Ai.LOOK | Ai.JUMP, new NS.Passive.EatGrassGoal(e, ctx));
      gs.add(6, Ai.MOVE, new Ai.WanderAroundFarGoal(e, 1.0, ctx.random, undefined, Ai.animalPathfindingFavor));
      gs.add(7, Ai.LOOK, new Ai.LookAtPlayerGoal(e, ctx.players, 6.0));
      gs.add(8, Ai.MOVE | Ai.LOOK, new Ai.RandomLookAroundGoal(e, ctx.random));
      return gs;
    },
    // loop/silverfish -- `SilverfishEntity.initGoals` (.decomp/net/minecraft/entity/mob/
    // SilverfishEntity.java:44-54, read in full) is NOT the AnimalEntity substrate sheep/
    // chicken/pig above share -- SilverfishEntity extends HostileEntity directly, so this
    // roster entry is its OWN five goals at the jar's own priority numbers, not a variant of
    // theirs. It sits here, right after sheep, per this unit's own placement (not a claim
    // about shared ancestry -- there is none).
    //   0(SwimGoal) is a fixed priority-1 tie in vanilla (`goalSelector.add(1, new
    //   SwimGoal(this))` AND `add(1, new PowderSnowJumpGoal(...))` share slot 1 -- this
    //   engine's own GoalSelector picks by (priority, then insertion), matching vanilla's
    //   own "lower number first, ties broken by add order" rule) -- `Ai.SwimGoal` is
    //   `Ai.FloatGoal` (07k_goals.js:3028, already an alias every ROSTER entry above uses).
    //   `PowderSnowJumpGoal` is `Ai.PowderSnowJumpGoal`, wired below at priority 1.
    //   3(CallForHelpGoal), 4(MeleeAttackGoal(1.0,false)), 5(WanderAndInfestGoal) are
    //   `NS.Silverfish.CallForHelpGoal`/`Ai.MeleeAttackGoal`/`NS.Silverfish.WanderAndInfestGoal`
    //   exactly as `.decomp:47-51` orders them.
    //   targetSelector 1(RevengeGoal.setGroupRevenge()) -> `Ai.RevengeGoal(e, ctx, {group:
    //   true})` (vex's own `{group:true}` call two mobs up in this file is the precedent);
    //   2(ActiveTargetGoal<Player>) -> `Ai.NearestAttackableTargetGoal(e, ctx.players)`, the
    //   SAME Yarn-name substitution vex's own targetSelector priority 3 already documents.
    silverfish: function (e, ctx) {
      var gs = new Ai.GoalSelector();
      var SF = NS.Silverfish;
      gs.add(1, Ai.JUMP, new Ai.SwimGoal(e, ctx.random));
      gs.add(1, Ai.JUMP, new Ai.PowderSnowJumpGoal(e));
      var cfh = new SF.CallForHelpGoal(e, ctx);
      // `SilverfishEntity.damage()` (.decomp:98-109) calls `callForHelpGoal.onHurt()` on every
      // non-invulnerable hit -- `Cb.notifyHurt` (14j_combat.js, the one live per-hit AI hook
      // every ROSTER goal's `justHurt`/`lastHurtByEntity` already comes from) reads this field.
      e.silverfishCallForHelp = cfh;
      gs.add(3, 0, cfh);
      gs.add(4, Ai.MOVE | Ai.LOOK, new Ai.MeleeAttackGoal(e, 1.0, null, null));
      gs.add(5, Ai.MOVE, new SF.WanderAndInfestGoal(e, 1.0, ctx));
      gs.add(1, Ai.TARGET, new Ai.RevengeGoal(e, ctx, { group: true }));
      gs.add(2, Ai.TARGET, new Ai.NearestAttackableTargetGoal(e, ctx.players, { sight: true, mustSee: true, reciprocalChance: 10, rand: ctx.random }));
      return gs;
    },
    // s115 -- `EndermiteEntity.initGoals` (.decomp/net/minecraft/entity/mob/EndermiteEntity.java:
    // 43-52, read in full), at the jar's own priorities: 1 SwimGoal, 1 PowderSnowJumpGoal, 2 MeleeAttackGoal(1.0,false), 3 WanderAroundFarGoal
    // (1.0) -> Ai.WanderAroundFarGoal (#3763),
    // 7 LookAtEntityGoal(Player, 8F), 8 LookAroundGoal; target 1 RevengeGoal.setGroupRevenge(),
    // 2 ActiveTargetGoal<Player>(true).
    endermite: function (e, ctx) {
      var gs = new Ai.GoalSelector();
      gs.add(1, Ai.JUMP, new Ai.SwimGoal(e, ctx.random));
      gs.add(1, Ai.JUMP, new Ai.PowderSnowJumpGoal(e));
      gs.add(2, Ai.MOVE | Ai.LOOK, new Ai.MeleeAttackGoal(e, 1.0, null, null));
      gs.add(3, Ai.MOVE, new Ai.WanderAroundFarGoal(e, 1.0, ctx.random));
      gs.add(7, Ai.LOOK, new Ai.LookAtPlayerGoal(e, ctx.players, 8.0));
      gs.add(8, Ai.MOVE | Ai.LOOK, new Ai.RandomLookAroundGoal(e, ctx.random));
      gs.add(1, Ai.TARGET, new Ai.RevengeGoal(e, ctx, { group: true }));
      gs.add(2, Ai.TARGET, new Ai.NearestAttackableTargetGoal(e, ctx.players, { sight: true, mustSee: true, reciprocalChance: 10, rand: ctx.random }));
      return gs;
    },

    /**
     * `SnowGolemEntity.initGoals()` (.decomp/net/minecraft/entity/passive/SnowGolemEntity.
     * java:52-57, read whole): `ProjectileAttackGoal(this, 1.25, 20, 10.0F)`(1 -- the single-
     * literal overload sets BOTH min and max interval to the same 20, the same reading
     * `Ai.ProjectileAttackGoal`'s witch/llama-spit rostered calls below already give it),
     * `WanderAroundFarGoal(this, 1.0)`(2 -- `Ai.WaterAvoidingRandomStrollGoal` substituted,
     * the SAME "no WanderAroundFarGoal/WanderAroundGoal built yet" reuse the pillager roster's
     * own comment already names for the identical goal), `LookAtEntityGoal(Player,6.0F)`(3),
     * `LookAroundGoal`(4); target `ActiveTargetGoal<MobEntity>(10, true, false, mob ->
     * mob instanceof Monster)`(1) -- `NS.SnowGolem.hostileTargets` (07zq_snowgolem.js) is that
     * predicate's live candidate list, filtered to distance by `Ai.NearestAttackableTargetGoal`
     * (this file's own `followRange`-based wrapper, same as every other ActiveTargetGoal here).
     */
    snow_golem: function (e, ctx) {
      var gs = new Ai.GoalSelector();
      gs.add(1, Ai.MOVE | Ai.LOOK, new Ai.ProjectileAttackGoal(e, 1.25, 20, 20, 10.0, ctx.onSnowballThrow));
      gs.add(2, Ai.MOVE, new Ai.WanderAroundFarGoal(e, 1.0, ctx.random, 1.0000001E-5));
      gs.add(3, Ai.LOOK, new Ai.LookAtPlayerGoal(e, ctx.players, 6.0));
      gs.add(4, Ai.MOVE | Ai.LOOK, new Ai.RandomLookAroundGoal(e, ctx.random));
      gs.add(1, Ai.TARGET, new Ai.NearestAttackableTargetGoal(e, function () {
        return NS.SnowGolem ? NS.SnowGolem.hostileTargets(e) : [];
      }, { sight: true, mustSee: true, reciprocalChance: 10, rand: ctx.random }));   // #724: ActiveTargetGoal(MobEntity,10,true,false,..)
      return gs;
    },

    // loop/phantom -- PhantomEntity.initGoals (.decomp:65-69, read in full): goalSelector
    // 1(StartAttackGoal), 2(SwoopMovementGoal), 3(CircleMovementGoal); targetSelector
    // 1(FindTargetGoal). All four are PhantomEntity's own inner classes, not shared
    // substrate -- `NS.Phantom.*` (07zz1_phantom.js), read LAZILY the same way `NS.
    // Silverfish.*` two mobs up already is. `e.flyMove` is the SAME one-control-object-
    // per-mob-at-spawn shape vex/parrot/bee already use (07t_fly.js), dispatched by
    // 07i_entitylist.js's PRE-EXISTING `if (e.flyMove) e.flyMove.tick()` / `NS.Fly.
    // travelMob(e)` pair -- no edit needed there. `e.phantomSize`/`e.attackDamage` mirror
    // `PhantomEntity.initialize()` (.decomp:163-166, `setPhantomSize(0)`) and `onSizeChanged()`
    // (.decomp:84-87, `6 + phantomSize` -- the ATTACK DAMAGE base, not health).
    phantom: function (e, ctx) {
      var Ph = NS.Phantom;
      if (e.phantomSize === undefined) e.phantomSize = 0;
      Ph.applySize(e);
      // referee finding (infra I5/I6, confirmed): `DataTracker.set` (.decomp DataTracker.java:
      // 120-128) fires `onTrackedDataSet` only when the value CHANGES, and SIZE starts tracked
      // at 0 -- so initialize()'s `setPhantomSize(0)` never runs onSizeChanged and a fresh
      // phantom keeps HostileEntity's 2.0 ATTACK_DAMAGE (the attrs table). Only a real size
      // (an NBT `Size` > 0) moves it to `6 + size`. (A size set back to 0 later would give 6;
      // nothing in this engine ever shrinks a phantom.)
      if (e.phantomSize !== 0) e.attackDamage = 6 + e.phantomSize;
      else delete e.attackDamage;
      if (e.circlingX === undefined) {
        e.circlingX = Math.floor(e.x); e.circlingY = Math.floor(e.y) + 5; e.circlingZ = Math.floor(e.z);
      }
      if (!e.flyMove) e.flyMove = new Ph.PhantomMoveControl(e);
      var gs = new Ai.GoalSelector();
      gs.add(1, 0, new Ph.StartAttackGoal(e, ctx));
      gs.add(2, Ai.MOVE, new Ph.SwoopMovementGoal(e, ctx));
      gs.add(3, Ai.MOVE, new Ph.CircleMovementGoal(e, ctx));
      gs.add(1, Ai.TARGET, new Ph.FindTargetGoal(e, ctx));
      gs.add(9, 0, new Ph.SoundGoal(e));
      return gs;
    },
    chicken: function (e, ctx) {
      var gs = new Ai.GoalSelector();
      var animals = ctx.animals || function () { return []; };
      var isTempting = ctx.isTempting || function () { return false; };
      gs.add(0, Ai.JUMP, new Ai.FloatGoal(e, ctx.random));
      gs.add(1, Ai.MOVE, new Ai.PanicGoal(e, 1.4));
      gs.add(2, Ai.MOVE | Ai.LOOK, new Ai.BreedGoal(e, 1.0, animals, ctx.onBreed));
      gs.add(3, Ai.MOVE | Ai.LOOK, new Ai.TemptGoal(e, 1.0, ctx.players, isTempting));
      gs.add(4, Ai.MOVE, new Ai.FollowParentGoal(e, 1.1, animals));
      gs.add(5, Ai.MOVE, new Ai.WanderAroundFarGoal(e, 1.0, ctx.random, undefined, Ai.animalPathfindingFavor));
      gs.add(6, Ai.LOOK, new Ai.LookAtPlayerGoal(e, ctx.players, 6.0));
      gs.add(7, Ai.MOVE | Ai.LOOK, new Ai.RandomLookAroundGoal(e, ctx.random));
      return gs;
    },
    pig: function (e, ctx) {
      var gs = new Ai.GoalSelector();
      var animals = ctx.animals || function () { return []; };
      var isTempting = ctx.isTempting || function () { return false; };
      gs.add(0, Ai.JUMP, new Ai.FloatGoal(e, ctx.random));
      gs.add(1, Ai.MOVE, new Ai.PanicGoal(e, 1.25));
      gs.add(3, Ai.MOVE | Ai.LOOK, new Ai.BreedGoal(e, 1.0, animals, ctx.onBreed));
      // #213: PigEntity.initGoals has TWO TemptGoals at priority 4 — carrot_on_a_stick, then the breeding food
      gs.add(4, Ai.MOVE | Ai.LOOK, new Ai.TemptGoal(e, 1.2, ctx.players, Ai.temptOnly(['carrot_on_a_stick'])));
      gs.add(4, Ai.MOVE | Ai.LOOK, new Ai.TemptGoal(e, 1.2, ctx.players, isTempting));
      gs.add(5, Ai.MOVE, new Ai.FollowParentGoal(e, 1.1, animals));
      gs.add(6, Ai.MOVE, new Ai.WanderAroundFarGoal(e, 1.0, ctx.random, undefined, Ai.animalPathfindingFavor));
      gs.add(7, Ai.LOOK, new Ai.LookAtPlayerGoal(e, ctx.players, 6.0));
      gs.add(8, Ai.MOVE | Ai.LOOK, new Ai.RandomLookAroundGoal(e, ctx.random));
      return gs;
    },
    // s135 (KW-33) -- StriderEntity.initGoals (.decomp, read in full). #938 completed it: GoBackToLavaGoal (4),
    // WanderAroundGoal (7) and LookAtEntityGoal(Strider, 8) (9). EscapeDangerGoal -> PanicGoal and
    // AnimalMateGoal -> BreedGoal remain this file's standing substitutions.
    strider: function (e, ctx) {
      var gs = new Ai.GoalSelector();
      var animals = ctx.animals || function () { return []; };
      var isTempting = ctx.isTempting || function () { return false; };
      var sFavor = Ai.striderPathfindingFavor(e);
      var panic = new Ai.PanicGoal(e, 1.65, { favor: sFavor });
      gs.add(1, Ai.MOVE, panic);
      gs.add(2, Ai.MOVE | Ai.LOOK, new Ai.BreedGoal(e, 1.0, animals, ctx.onBreed));
      // #213: StriderEntity's TemptGoal ingredient is (warped_fungus, warped_fungus_on_a_stick)
      var tempt = new Ai.TemptGoal(e, 1.4, ctx.players, function (st) { return isTempting(st) || Ai.temptOnly(['warped_fungus_on_a_stick'])(st); });
      gs.add(3, Ai.MOVE | Ai.LOOK, tempt);
      gs.add(4, Ai.MOVE, new Ai.GoBackToLavaGoal(e, 1.5, ctx.random));   // #938: StriderEntity.GoBackToLavaGoal(1.5)
      gs.add(5, Ai.MOVE, new Ai.FollowParentGoal(e, 1.1, animals));
      gs.add(7, Ai.MOVE, new Ai.WanderAroundGoal(e, 1.0, ctx.random, 60, sFavor));
      gs.add(8, Ai.LOOK, new Ai.LookAtPlayerGoal(e, ctx.players, 8.0));
      gs.add(8, Ai.MOVE | Ai.LOOK, new Ai.RandomLookAroundGoal(e, ctx.random));
      gs.add(9, Ai.LOOK, new Ai.LookAtMobGoal(e, ctx, 8.0, 'strider'));  // #938: LookAtEntityGoal(StriderEntity, 8)
      e.striderEscapeGoal = panic; e.striderTemptGoal = tempt;   // isEscapingDanger/isBeingTempted read these
      return gs;
    },
    /**
     * loop/rabbit-s98 (QUEUE 0.2 G18c, missing overworld mob) -- `RabbitEntity.initGoals`
     * (.decomp, read in full), priorities exactly as the jar lists them:
     *   1:SwimGoal · 1:PowderSnowJumpGoal · 1:EscapeDangerGoal(2.2) · 2:AnimalMateGoal(0.8) ·
     *   3:TemptGoal(1.0, carrot/golden_carrot/dandelion) · 4:FleeGoal(Player,8,2.2,2.2) ·
     *   4:FleeGoal(Wolf,10,2.2,2.2) · 4:FleeGoal(Hostile,4,2.2,2.2) · 5:EatCarrotCropGoal ·
     *   6:WanderAroundFarGoal(0.6) · 11:LookAtEntityGoal(Player,10.0F).
     * THREE SUBSTITUTIONS, each already this file's own standing convention, not a fresh
     * approximation invented for rabbit:
     *   - `SwimGoal` -> `Ai.FloatGoal` (same as every other roster entry's own priority-0 float).
     *   - `EscapeDangerGoal` -> `Ai.PanicGoal` (cow's own priority-1 substitution, D-423's own
     *     "same shape, this engine's flee-what-hurt-me stand-in" gap, named again here rather
     *     than re-argued).
     *   - `WanderAroundFarGoal` -> `Ai.WaterAvoidingRandomStrollGoal` (cow/creeper/pig's own
     *     substitution; `Ai.OWED` already names the "no real WanderAroundFar class yet" gap
     *     once, for every caller).
     * `PowderSnowJumpGoal` is wired (`Ai.PowderSnowJumpGoal`).
     * The three `FleeGoal`s ARE three separate `Ai.AvoidEntityGoal` calls (not folded into one
     * the way creeper's cat+ocelot pair was, D-401's own creeper header) because their RANGES
     * differ per threat (8/10/4) and folding would use one range for all three threats, which a
     * `--seed` fixture with a wolf just past 8 blocks but inside 10 would tell apart from
     * vanilla immediately.
     */
    rabbit: function (e, ctx) {
      var Rb = NS.Rabbit;
      var gs = new Ai.GoalSelector();
      var animals = ctx.animals || function () { return []; };
      var players = ctx.players || function () { return []; };
      var isTempting = ctx.isTempting || function (item) {
        var Br = NS.Breed;
        return !!(Br && Br.ready && Br.isFood('rabbit', Br.itemNameOf(item)));
      };
      function ofType(t) {
        var out = [];
        var EL = NS.EntityList;
        if (!EL || !EL.list) return out;
        for (var i = 0; i < EL.list.length; i++) {
          var o = EL.list[i];
          if (!o.removed && o !== e && o.type === t) out.push(o);
        }
        return out;
      }
      function hostiles() {
        var out = [];
        var EL = NS.EntityList, Sp = NS.Spawn;
        if (!EL || !EL.list || !Sp) return out;
        for (var i = 0; i < EL.list.length; i++) {
          var o = EL.list[i];
          if (!o.removed && o !== e && Ai.isHostileEntity(o.type)) out.push(o);
        }
        return out;
      }
      // FleeGoal.canStart (RabbitEntity.java:509): false for the killer bunny (type 99)
      var isAvoidingAll = function () { return e.rabbitType !== 99; };
      gs.add(1, Ai.JUMP, new Ai.FloatGoal(e, ctx.random));
      gs.add(1, Ai.JUMP, new Ai.PowderSnowJumpGoal(e));
      gs.add(1, Ai.MOVE, new Ai.PanicGoal(e, 2.2));
      gs.add(2, Ai.MOVE | Ai.LOOK, new Ai.BreedGoal(e, 0.8, animals, ctx.onBreed));
      gs.add(3, Ai.MOVE | Ai.LOOK, new Ai.TemptGoal(e, 1.0, players, isTempting));
      gs.add(4, Ai.MOVE, new Ai.AvoidEntityGoal(e, 8, 2.2, players, isAvoidingAll));
      gs.add(4, Ai.MOVE, new Ai.AvoidEntityGoal(e, 10, 2.2, function () { return ofType('wolf'); }, isAvoidingAll));
      gs.add(4, Ai.MOVE, new Ai.AvoidEntityGoal(e, 4, 2.2, hostiles, isAvoidingAll));
      if (Rb && Rb.EatCarrotCropGoal) {
        gs.add(5, Ai.MOVE | Ai.LOOK, new Rb.EatCarrotCropGoal(e, ctx));
      }
      gs.add(6, Ai.MOVE, new Ai.WanderAroundFarGoal(e, 0.6, ctx.random, undefined, Ai.animalPathfindingFavor));
      gs.add(11, Ai.LOOK, new Ai.LookAtPlayerGoal(e, players, 10.0));
      if (e.rabbitType === 99) Ai.killerBunnyGoals(e, gs, ctx);
      return gs;
    },
    /**
     * loop/fox-s99 (QUEUE 0.2 G18c, missing overworld mob) -- `FoxEntity.initGoals` (.decomp,
     * read in full), priorities exactly as the jar lists them (0:FoxSwimGoal ·
     * 0:PowderSnowJumpGoal · 1:StopWanderingGoal · 2:EscapeWhenNotAggressiveGoal(2.2) ·
     * 3:MateGoal(1.0) · 4:FleeEntityGoal(Player,16,1.6,1.4) ·
     * 4:FleeEntityGoal(Wolf,8,1.6,1.4) · 4:FleeEntityGoal(PolarBear,8,1.6,1.4) ·
     * 5:MoveToHuntGoal · 6:JumpChasingGoal · 6:AvoidDaylightGoal(1.25) ·
     * 7:AttackGoal(1.2,true) · 7:DelayedCalmDownGoal · 8:FollowParentGoal(1.25) ·
     * 9:GoToVillageGoal · 10:EatSweetBerriesGoal(1.2,12,1) · 10:PounceAtTargetGoal(0.4) ·
     * 11:WanderAroundFarGoal(1.0) · 11:PickupItemGoal · 12:LookAtEntityGoal(Player,24.0) ·
     * 13:SitDownAndLookAroundGoal), collapsed onto this engine's own goal set the same way
     * rabbit's own ROSTER entry above substitutes real classes for goal SHAPES this file
     * already has (`Ai.FloatGoal`/`Ai.PanicGoal`/`Ai.AvoidEntityGoal`/`Ai.BreedGoal`/
     * `Ai.FollowParentGoal`/`Ai.MeleeAttackGoal`/`Ai.WaterAvoidingRandomStrollGoal`/
     * `Ai.LookAtPlayerGoal` reused unmodified) plus four fox-specific goals `07zj_fox.js` owns
     * (`Fx.SleepByDayGoal`, `Fx.MoveToHuntGoal`, `Fx.EatSweetBerriesGoal`, `Fx.PickupItemGoal`).
     * `PowderSnowJumpGoal`/`JumpChasingGoal`'s pounce arc/`AvoidDaylightGoal`/`GoToVillageGoal`/
     * `DefendFriendGoal`/`PounceAtTargetGoal`/fish-hunting are `Fx.OWED` (07zj_fox.js's own
     * header names each). The TARGET goal (chicken/rabbit, `followChickenAndRabbitGoal`,
     * .decomp lines 139-140/168-171) is `Ai.NearestAttackableTargetGoal` (reused unmodified,
     * already this file's own convention for every predator ROSTER entry) rather than the
     * jar's own `addTypeSpecificGoals`/`WorriableEntityFilter` machinery.
     */
    fox: function (e, ctx) {
      var Fx = NS.Fox;
      var gs = new Ai.GoalSelector();
      var players = ctx.players || function () { return []; };
      var animals = ctx.animals || function () { return []; };
      function ofType(t) {
        var out = [];
        var EL = NS.EntityList;
        if (!EL || !EL.list) return out;
        for (var i = 0; i < EL.list.length; i++) {
          var o = EL.list[i];
          if (!o.removed && o !== e && o.type === t) out.push(o);
        }
        return out;
      }
      function prey() {
        var out = [];
        var EL = NS.EntityList;
        if (!EL || !EL.list || !Fx) return out;
        for (var i = 0; i < EL.list.length; i++) {
          var o = EL.list[i];
          if (!o.removed && o !== e && Fx.CHICKEN_AND_RABBIT[NS.Entities.bare(o.type)]) out.push(o);
        }
        return out;
      }
      // `FleeEntityGoal(Player,...)`'s own predicate (.decomp lines 152-157): notice the
      // player, refuse a trusted one, refuse one while already aggressive.
      function isFleeingPlayer(p) {
        return !!(p && Fx.fleesPlayer(e, p));
      }
      var notAggressive = function () { return !e.aggressive; };   // FoxEntity.java:146-151: wolf/polar-bear filters end '&& !this.isAggressive()'
      var untamedWolves = function () { return ofType('wolf').filter(function (w) { return !w.tamed; }); };

      // #213: FoxEntity.initGoals' numbers (goals-1.18.2.tsv): FoxSwimGoal 0, Attack 7, FollowParent 8, EatSweetBerries 10,
      // PickupItem 11, WanderAroundFar 11, LookAt 12 (the roster had them one or two ranks low). Fox goals live in 07zj_fox.js (#1286).
      gs.add(0, Ai.JUMP, new Fx.FoxSwimGoal(e, ctx));
      gs.add(0, Ai.JUMP, new Ai.PowderSnowJumpGoal(e));
      if (Fx && Fx.StopWanderingGoal) gs.add(1, Ai.MOVE | Ai.LOOK | Ai.JUMP, new Fx.StopWanderingGoal(e, ctx));
      gs.add(2, Ai.MOVE, new Ai.PanicGoal(e, 2.2, { inDanger: function () { return !e.aggressive && (!!e.justHurt || !!e.isOnFire || !!(NS.Fly && NS.Fly.attackerOf ? NS.Fly.attackerOf(e) : e.lastHurtByEntity)); } }));                 // EscapeWhenNotAggressiveGoal: isInDanger = !isAggressive() && super (.decomp FoxEntity.java:968-977)
      gs.add(3, Ai.MOVE | Ai.LOOK, new Fx.MateGoal(e, 1.0, animals, ctx.onBreed));   // FoxEntity.MateGoal
      // FoxEntity.java:145-157 (all three FleeEntityGoal(...,1.6,1.4)): cloud unit, avoidrefcheck's
      // speed-calibration reds -- the fastSpeed (< slowSpeed here, vanilla's own real numbers) was
      // silently dropped by the single-speed substrate; now wired via fleeOpts.fastSpeed.
      gs.add(4, Ai.MOVE, new Ai.AvoidEntityGoal(e, 16, 1.6, players, isFleeingPlayer, { fastSpeed: 1.4 }));
      gs.add(4, Ai.MOVE, new Ai.AvoidEntityGoal(e, 8, 1.6, untamedWolves, notAggressive, { fastSpeed: 1.4 }));
      gs.add(4, Ai.MOVE, new Ai.AvoidEntityGoal(e, 8, 1.6, function () { return ofType('polar_bear'); }, notAggressive, { fastSpeed: 1.4 }));
      // FoxEntity.initGoals/addTypeSpecificGoals (.decomp 133-139, 328-337), #1285: three ActiveTargetGoals whose
      // priority depends on the fox type (red 4/4/6, snow 4 fish /6/6), reciprocalChance 10/10/20, mustSee false;
      // DefendFriendGoal is targetSelector 3 (chance 10). Tags let foxtargetcheck name each goal.
      function babyTurtles() { return ofType('turtle').filter(function (t) { return t.isBaby && !t.inWater; }); }   // BABY_TURTLE_ON_LAND_FILTER
      function schoolingFish() { return ofType('cod').concat(ofType('salmon'), ofType('tropical_fish')); }          // SchoolingFishEntity (not pufferfish)
      function tgt(tag, fn, chance) {
        var g = new Ai.NearestAttackableTargetGoal(e, fn, { reciprocalChance: chance, rand: ctx.random });
        g.tag = tag; return g;
      }
      var isRed = !(Fx && e.foxType === Fx.TYPE.SNOW);
      gs.add(isRed ? 4 : 6, Ai.TARGET, tgt('chickenRabbit', prey, 10));
      gs.add(isRed ? 4 : 6, Ai.TARGET, tgt('babyTurtle', babyTurtles, 10));
      gs.add(isRed ? 6 : 4, Ai.TARGET, tgt('fish', schoolingFish, 20));
      // DefendFriendGoal: a trusted player was just hit by something we do not trust -> target the offender.
      var friendHit = 0;
      var defend = new Ai.NearestAttackableTargetGoal(e, function () {
        var out = [];
        var ps = players();
        for (var i = 0; i < ps.length; i++) {
          var p = ps[i], id = p.uuid || p.id || p.name;
          if (!id || !Fx || !Fx.canTrust(e, id)) continue;
          var off = p.lastHurtByEntity, t = p.lastAttackedTime || p.hurtSeq || 0;
          if (off && !off.removed && t !== friendHit && !(off.uuid && Fx.canTrust(e, off.uuid))) { friendHit = t; out.push(off); }
        }
        return out;
      }, { reciprocalChance: 10, rand: ctx.random });
      defend.tag = 'defendFriend';
      var defendStart = defend.start;
      defend.start = function () {   // DefendFriendGoal.start (:822-831): fox.aggro 1/1, then setAggressive(true), stopSleeping
        defendStart.apply(defend, arguments);
        var P = NS.Sound;
        if (P && P.play && !e.silent) P.play('entity.fox.aggro', { x: e.x, y: e.y, z: e.z, volume: 1, pitch: 1, source: 'neutral' });
        e.aggressive = true; e.sleeping = false;
      };
      gs.add(3, Ai.TARGET, defend);
      if (Fx && Fx.MoveToHuntGoal) gs.add(5, Ai.MOVE | Ai.LOOK, new Fx.MoveToHuntGoal(e, ctx));
      gs.add(7, Ai.MOVE | Ai.LOOK, new Fx.AttackGoal(e));   // AttackGoal.attack: tryAttack then entity.fox.bite
      var fpg = new Ai.FollowParentGoal(e, 1.25, animals), fpgUse = fpg.canUse;
      fpg.canUse = function () { return !e.aggressive && fpgUse.call(fpg); };   // FoxEntity.FollowParentGoal.canStart: !isAggressive() (:988-990)
      gs.add(8, Ai.MOVE, fpg);
      if (Fx && Fx.EatSweetBerriesGoal) gs.add(10, Ai.MOVE | Ai.LOOK, new Fx.EatSweetBerriesGoal(e, ctx));
      if (Fx && Fx.PickupItemGoal) gs.add(11, Ai.MOVE, new Fx.PickupItemGoal(e, ctx));
      gs.add(11, Ai.MOVE, new Ai.WanderAroundFarGoal(e, 1.0, ctx.random, undefined, Ai.animalPathfindingFavor));   // WanderAroundFarGoal(1.0), default probability
      gs.add(12, Ai.LOOK, Fx && Fx.LookAtEntityGoal ? new Fx.LookAtEntityGoal(e, players, 24.0) : new Ai.LookAtPlayerGoal(e, players, 24.0));
      if (Fx && Fx.JumpChasingGoal) gs.add(6, Ai.MOVE | Ai.JUMP, new Fx.JumpChasingGoal(e, ctx));
      if (Fx && Fx.GoToVillageGoal) gs.add(9, Ai.MOVE, new Fx.GoToVillageGoal(e, ctx));
      if (Fx && Fx.AvoidDaylightGoal) gs.add(6, Ai.MOVE, new Fx.AvoidDaylightGoal(e, ctx));
      if (Fx && Fx.DelayedCalmDownGoal) gs.add(7, Ai.MOVE | Ai.LOOK | Ai.JUMP, new Fx.DelayedCalmDownGoal(e, ctx));
      gs.add(10, Ai.MOVE | Ai.JUMP, new Ai.PounceAtTargetGoal(e, ctx, 0.4));   // PounceAtTargetGoal(0.4)
      if (Fx && Fx.SitDownAndLookAroundGoal) gs.add(13, Ai.MOVE | Ai.LOOK, new Fx.SitDownAndLookAroundGoal(e, ctx));
      return gs;
    },
    /**
     * loop/goat-s99 (QUEUE 0.2 G18c, missing overworld mob) -- `GoatBrain` folded onto
     * `GoalSelector` (07zj_goat.js's own header names why: goats are `Brain`-driven in the jar
     * and this engine only has `GoalSelector`). The CORE activity's `StayAboveWaterTask`/
     * `WalkTask`/`WanderAroundTask` become the SAME `FloatGoal`/`WaterAvoidingRandomStrollGoal`
     * every other rostered animal already uses; the IDLE activity's `BreedTask`/`TemptTask`/
     * `WalkTowardClosestAdultTask`/`StrollTask` become `BreedGoal`/`TemptGoal`/
     * `FollowParentGoal`/the same stroll goal (`FollowMobTask(EntityType.HORSE,...)` has no
     * equivalent anywhere in this codebase -- `Gt.OWED`). `Gt.RamGoal`/`Gt.LongJumpGoal`
     * (07zj_goat.js) are the RAM/LONG_JUMP activities. No `PanicGoal` substitution: unlike
     * rabbit, `GoatEntity`'s own goal set has no flee-what-hurt-me task at all (.decomp, read in
     * full) -- a goat simply does not run from danger the way a rabbit does.
     */
    goat: function (e, ctx) {
      var Gt = NS.Goat;
      var gs = new Ai.GoalSelector();
      var animals = ctx.animals || function () { return []; };
      var players = ctx.players || function () { return []; };
      var isTempting = ctx.isTempting || function (item) {
        var Br = NS.Breed;
        return !!(Br && Br.ready && Br.isFood('goat', Br.itemNameOf(item)));
      };
      gs.add(0, Ai.JUMP, new Ai.FloatGoal(e, ctx.random));
      gs.add(1, Ai.MOVE, new Ai.PanicGoal(e, 2.0));   // CORE WalkTask(2.0F): runs while HURT_BY is remembered (.decomp GoatBrain/WalkTask), FuzzyTargeting.find(5,4)
      if (Gt && Gt.RamGoal) gs.add(1, Ai.MOVE | Ai.LOOK, new Gt.RamGoal(e, ctx));
      if (Gt && Gt.LongJumpGoal) gs.add(2, Ai.MOVE | Ai.JUMP, new Gt.LongJumpGoal(e, ctx));
      gs.add(3, Ai.MOVE | Ai.LOOK, new Ai.BreedGoal(e, 1.0, animals, ctx.onBreed));
      gs.add(4, Ai.MOVE | Ai.LOOK, new Ai.TemptGoal(e, 1.25, players, isTempting));
      gs.add(5, Ai.MOVE, new Ai.FollowParentGoal(e, 1.25, animals));
      // #4681 GoatBrain.addIdleActivities priority-3 RandomTask: StrollTask 2 / GoTowardsLookTarget 2 / WaitTask(30,60) 1, re-picked the
      // moment one ends. GoTowardsLookTarget needs a LOOK_TARGET (none here), so the draw is stroll 2 : wait 1 with no 1/120 idle gap.
      var rnd = ctx.random || Ai.rndOf(e), stroll = new Ai.WaterAvoidingRandomStrollGoal(e, 1.0, rnd, null, 1), wait = 0, pick = false;
      gs.add(6, Ai.MOVE, {
        canUse: function () {
          if (wait > 0) { wait--; return false; }
          if (!pick) { pick = true; if (rnd() < 1 / 3) { wait = 30 + Math.floor(rnd() * 31); return false; } }
          if (!stroll.canUse()) return false;   // despawn refusal: re-roll next tick
          pick = false; return true;
        },
        canContinueToUse: function () { return stroll.canContinueToUse(); },
        start: function () { stroll.start(); },
        stop: function () { stroll.stop(); },
        tick: function () { stroll.tick(); }
      });
      // #4716 GoatBrain idle pri 0: TimeLimitedTask(FollowMobTask(PLAYER, 6.0), 30..60) -- not LookAtPlayerGoal's 2%/tick roll. Nearest player within 6,
      // held 30-60 ticks, then a 30-60 tick quiet spell (TimeLimitedTask.resetTimeLeft) before it re-acquires.
      var lookT = 0, quiet = 30 + Math.floor(rnd() * 31), lookP = null;
      function nearP() {
        var ps = players(), best = 36, f = null;
        for (var i = 0; i < ps.length; i++) {
          var dx = ps[i].x - e.x, dy = ps[i].y - e.y, dz = ps[i].z - e.z, d = dx * dx + dy * dy + dz * dz;
          if (d <= best && !ps[i].dead && !ps[i].removed) { best = d; f = ps[i]; }
        }
        return f;
      }
      gs.add(7, Ai.LOOK, {
        canUse: function () {
          var p = nearP();
          if (!p) return false;
          if (quiet > 0) { quiet--; return false; }
          lookP = p; return true;
        },
        canContinueToUse: function () { return lookT > 0 && !!lookP && !lookP.dead && !lookP.removed; },
        start: function () { lookT = 30 + Math.floor(rnd() * 31); },
        stop: function () { lookP = null; lookT = 0; quiet = 30 + Math.floor(rnd() * 31); },
        tick: function () { lookT--; if (e.look && lookP) e.look.setLookAt(lookP.x, lookP.y + Ai.eyeOf(lookP), lookP.z); }
      });
      return gs;
    },
    /**
     * loop/panda-axolotl-s101 (QUEUE 0.2 G18c, missing overworld mob) -- `PandaEntity.initGoals`
     * (.decomp, read in full), folded onto `GoalSelector` (07zl_panda.js's own header names the
     * pieces this session had no time for: PickUpFoodGoal/PlayGoal, the ask-for-bamboo
     * sub-behaviour, the escape-danger override). `SwimGoal`->`Ai.FloatGoal`,
     * `PandaEscapeDangerGoal`->`Ai.PanicGoal`, `PandaMateGoal`->`Ai.BreedGoal`,
     * `TemptGoal`(bamboo)->`Ai.TemptGoal`, `PandaFleeGoal`(player)/(hostile)->TWO
     * `Ai.AvoidEntityGoal`s gated on `Pd.isWorried`+`Pd.isIdle` (the real goal's own
     * `panda.isWorried() && panda.isIdle()` canStart override, read verbatim), `LookAtEntityGoal`
     * ->`Ai.LookAtPlayerGoal`, `LookAroundGoal`->`Ai.RandomLookAroundGoal`,
     * `FollowParentGoal`/`WanderAroundFarGoal`->the same generic goals every rostered animal
     * uses. `Pd.AttackGoal`/`Pd.RevengeGoal` are this pair's own bespoke goals (07zl_panda.js's
     * own header explains why: no generic equivalent of either exists).
     */
    panda: function (e, ctx) {
      var Pd = NS.Panda;
      var gs = new Ai.GoalSelector();
      var animals = ctx.animals || function () { return []; };
      var players = ctx.players || function () { return []; };
      var isTempting = ctx.isTempting || function (item) {
        var Br = NS.Breed;
        return !!(Br && Br.ready && Br.isFood('panda', Br.itemNameOf(item)));
      };
      // PandaFleeGoal(HostileEntity.class)
      function hostiles() {
        var out = [];
        var EL = NS.EntityList, Sp = NS.Spawn;
        if (!EL || !EL.list || !Sp || !Sp.categoryOf) return out;
        for (var i = 0; i < EL.list.length; i++) {
          var o = EL.list[i];
          if (!o.removed && o !== e && Ai.isHostileEntity(o.type)) out.push(o);
        }
        return out;
      }
      var wantsFlee = function () { return !!(Pd && Pd.isWorried(e) && Pd.isIdle(e)); };
      gs.add(0, Ai.JUMP, new Ai.FloatGoal(e, ctx.random));
      gs.add(2, Ai.MOVE, new Ai.PanicGoal(e, 2.0, { inDanger: function () { return Ai.shouldEscapePowderSnow(e) || !!e.isOnFire; }, stopWhen: function () { return !!e.sitting; } }));   // PandaEscapeDangerGoal: isInDanger = powder snow || on fire ONLY; shouldContinue false while sitting
      gs.add(2, Ai.MOVE | Ai.LOOK, Pd && Pd.MateGoal ? new Pd.MateGoal(e, 1.0, animals, ctx.onBreed, players) : new Ai.BreedGoal(e, 1.0, animals, ctx.onBreed));
      if (Pd && Pd.AttackGoal) gs.add(3, Ai.MOVE | Ai.LOOK, new Pd.AttackGoal(e, ctx));
      gs.add(4, Ai.MOVE | Ai.LOOK, new Ai.TemptGoal(e, 1.0, players, isTempting));
      if (Pd && Pd.PickUpFoodGoal) gs.add(7, Ai.MOVE, new Pd.PickUpFoodGoal(e, ctx));
      if (Pd && Pd.PlayGoal) gs.add(12, Ai.MOVE | Ai.LOOK | Ai.JUMP, new Pd.PlayGoal(e, ctx));
      gs.add(6, Ai.MOVE, new Ai.AvoidEntityGoal(e, 8, 2.0, players, wantsFlee));
      gs.add(6, Ai.MOVE, new Ai.AvoidEntityGoal(e, 4, 2.0, hostiles, wantsFlee));
      if (Pd && Pd.LieOnBackGoal) gs.add(8, 0, new Pd.LieOnBackGoal(e, ctx));
      if (Pd && Pd.SneezeGoal) gs.add(8, 0, new Pd.SneezeGoal(e, ctx));
      if (Pd && Pd.LookAtEntityGoal) { e.pdLookGoal = new Pd.LookAtEntityGoal(e, players, 6.0, ctx); gs.add(9, Ai.LOOK, e.pdLookGoal); }
      else gs.add(9, Ai.LOOK, new Ai.LookAtPlayerGoal(e, players, 6.0));
      gs.add(10, Ai.MOVE | Ai.LOOK, new Ai.RandomLookAroundGoal(e, ctx.random));
      gs.add(13, Ai.MOVE, new Ai.FollowParentGoal(e, 1.25, animals));
      gs.add(14, Ai.MOVE, new Ai.WanderAroundFarGoal(e, 1.0, ctx.random, undefined, Ai.animalPathfindingFavor));
      if (Pd && Pd.RevengeGoal) gs.add(1, Ai.TARGET, new Pd.RevengeGoal(e, ctx));
      return gs;
    },
    /**
     * loop/panda-axolotl-s101 (QUEUE 0.2 G18c, missing overworld mob) -- `AxolotlBrain`'s own
     * IDLE activity (.decomp, read in full), folded onto `GoalSelector` (07zm_axolotl.js's own
     * header names the whole FIGHT activity as unbuilt -- no Sensor source to read a real
     * hostile-target list off). `TemptTask`/`BreedTask`/`WalkTowardClosestAdultTask` become the
     * SAME generic `Ai.TemptGoal`/`Ai.BreedGoal`/`Ai.FollowParentGoal` every other rostered
     * animal already uses; `AquaticStrollTask`/`StrollTask` become `Ax.WanderGoal`
     * (07zm_axolotl.js's own bespoke straight-line approximation); `LookAroundTask` becomes
     * `Ai.RandomLookAroundGoal`. `Ax.tickPlayDead` (the PLAY_DEAD activity's own countdown) is
     * wired as this roster entry's own per-tick housekeeping, the same standing
     * `Pd.tickRevengeFlags` just above uses for panda.
     */
    axolotl: function (e, ctx) {
      var Ax = NS.Axolotl;
      var gs = new Ai.GoalSelector();
      var animals = ctx.animals || function () { return []; };
      var players = ctx.players || function () { return []; };
      var isTempting = ctx.isTempting || function (item) {
        var Br = NS.Breed;
        return !!(Br && Br.ready && Br.isFood('axolotl', Br.itemNameOf(item)));
      };
      // #1032: the PLAY_DEAD activity replaces IDLE while the memory is present, so every IDLE goal is gated off
      var idle = function (g) {
        var cu = g.canUse, cc = g.canContinueToUse;
        g.canUse = function () { return !e.playingDead && cu.apply(g, arguments); };
        if (cc) g.canContinueToUse = function () { return !e.playingDead && cc.apply(g, arguments); };
        return g;
      };
      // #1364: IDLE priority 0 FollowMobTask(PLAYER, 6.0F) -- a LOOK_TARGET at the nearest player within 6 (look half only)
      gs.add(0, Ai.LOOK, idle(Ax && Ax.TimedLookGoal ? new Ax.TimedLookGoal(e, new Ai.LookAtPlayerGoal(e, players, 6.0), ctx.random) : new Ai.LookAtPlayerGoal(e, players, 6.0)));
      gs.add(1, Ai.MOVE | Ai.LOOK, idle(new Ai.BreedGoal(e, 0.2, animals, ctx.onBreed)));
      gs.add(2, Ai.MOVE | Ai.LOOK, idle(new Ai.TemptGoal(e, function (m) { return m.inWater ? 0.5 : 0.15; }, players, isTempting)));
      // AxolotlBrain.getTemptedSpeed / getAdultFollowingSpeed (.decomp): water 0.5 / 0.6, land 0.15
      gs.add(2, Ai.MOVE, idle(new Ai.FollowParentGoal(e, function (m) { return m.inWater ? 0.6 : 0.15; }, animals)));
      if (Ax && Ax.FightGoal) gs.add(0, Ai.MOVE | Ai.TARGET, new Ax.FightGoal(e, ctx));
      if (Ax && Ax.SeekWaterGoal) gs.add(3, Ai.MOVE, idle(new Ax.SeekWaterGoal(e)));   // SeekWaterTask(6, 0.15F)
      if (Ax && Ax.WanderGoal) gs.add(4, Ai.MOVE, new Ax.WanderGoal(e, ctx));
      gs.add(5, Ai.MOVE | Ai.LOOK, idle(new Ai.RandomLookAroundGoal(e, ctx.random)));
      return gs;
    },
    /**
     * QUEUE 0.2 (G18 mobs) -- `BeeEntity.initGoals` (.decomp, read in full): `FloatGoal`/
     * `BreedGoal`/`TemptGoal` are the same generic goals every rostered animal already uses;
     * `Bee.StingGoal` (priority 0 MOVE|LOOK) is the strike (07zo_bee.js), `Bee.MoveToHiveGoal`/
     * `Bee.PollinateGoal`/`Bee.GrowCropsGoal` are that file's own state-machine ports, and
     * `Bee.BeeWanderAroundGoal` is the idle-flight fallback (that file's own `Bee.OWED` §6). TARGET:
     * `Ai.HurtByTargetGoal` (retaliate) + `Ai.UniversalAngerGoal` (target the nearest player
     * while `e.angerTime>0` with no live target) — the SAME generic Angerable substrate
     * `07zj_polarbear.js`'s own header already leans on for anger itself.
     */
    bee: function (e, ctx) {
      var Bee = NS.Bee;
      var gs = new Ai.GoalSelector();
      var animals = ctx.animals || function () { return []; };
      var players = ctx.players || function () { return []; };
      var isTempting = ctx.isTempting || function (item) {
        var Br = NS.Breed;
        return !!(Br && Br.ready && Br.isFood('bee', Br.itemNameOf(item)));
      };
      // #213: BeeEntity.initGoals' SwimGoal is priority 9, the TemptGoal speed 1.25, and there IS a FollowParentGoal
      // (5, 1.25); there is no LookAroundGoal. (Sting 0, EnterHive 1, Pollinate 4, GrowCrops 7, Wander 8 below are
      // the mod's own merged shapes — not renumbered here, Bee.OWED.)
      if (Bee && Bee.StingGoal) gs.add(0, Ai.MOVE | Ai.LOOK, new Bee.StingGoal(e, ctx));
      if (Bee && Bee.EnterHiveGoal) gs.add(1, Ai.MOVE, new Bee.EnterHiveGoal(e, ctx));
      gs.add(2, Ai.MOVE | Ai.LOOK, new Ai.BreedGoal(e, 1.0, animals, ctx.onBreed));
      gs.add(3, Ai.MOVE | Ai.LOOK, new Ai.TemptGoal(e, 1.25, players, isTempting));
      gs.add(5, Ai.MOVE, new Ai.FollowParentGoal(e, 1.25, animals));
      if (Bee && Bee.MoveToHiveGoal) gs.add(5, Ai.MOVE, new Bee.MoveToHiveGoal(e, ctx));
      if (Bee && Bee.FindHiveGoal) gs.add(5, Ai.MOVE, new Bee.FindHiveGoal(e, ctx));
      if (Bee && Bee.PollinateGoal) gs.add(4, Ai.MOVE, new Bee.PollinateGoal(e, ctx));
      if (Bee && Bee.MoveToFlowerGoal) gs.add(6, Ai.MOVE, new Bee.MoveToFlowerGoal(e, ctx));
      if (Bee && Bee.GrowCropsGoal) gs.add(7, 0, new Bee.GrowCropsGoal(e, ctx));
      if (Bee && Bee.BeeWanderAroundGoal) gs.add(8, Ai.MOVE, new Bee.BeeWanderAroundGoal(e, ctx));
      gs.add(9, Ai.JUMP, new Ai.FloatGoal(e, ctx.random));
      gs.add(1, Ai.TARGET, Bee && Bee.BeeRevengeGoal ? new Bee.BeeRevengeGoal(e, function () { return animals().filter(function (o) { return o && o.type === e.type; }); }) : new Ai.HurtByTargetGoal(e));
      gs.add(2, Ai.TARGET, new Ai.AngryPlayerTargetGoal(e, function () { return !e.hasStung; }));   // BeeEntity.StingTargetGoal: ActiveTargetGoal<Player>(shouldAngerAt)
      if (Ai.UniversalAngerGoal) gs.add(3, Ai.TARGET, new Ai.UniversalAngerGoal(e, ctx.random, true, function () {   // UniversalAngerGoal<>(this,true)
        return animals().filter(function (o) { return o && o.type === e.type; });
      }));
      return gs;
    },
    /**
     * loop/turtle-s102 (QUEUE 0.2 G18 mobs) -- `TurtleEntity.initGoals` (.decomp lines
     * 187-197), folded onto `GoalSelector` per this file's own header (`07zp_turtle.js`):
     * `TurtleEscapeDangerGoal`/`TravelGoal` are named unbuilt there (no pathfinding substrate
     * to port, `Tu.OWED`) rather than guessed. `MateGoal`/`LayEggGoal` share priority 1 the
     * SAME way the jar's own `goalSelector.add(1, ...)` rows do (mutually exclusive: a turtle
     * either has no egg and may mate, or has one and heads home to lay it); `TemptGoal` reuses
     * the generic `Ai.TemptGoal` off `seagrass`'s own ITEM-list breeding food
     * (`assets/entities.json`'s own `breeding.turtle`, not a tag -- `Breed.isFood` reads it
     * live). Vanilla registers NO `FollowParentGoal` for turtle at all (grepped
     * `TurtleEntity.initGoals` above -- absent, not an oversight), so none is added here.
     */
    // #716: DolphinEntity.initGoals (07zj2_dolphin.js): the dolphin-only goals live there, the library ones are Ai's own.
    dolphin: function (e, ctx) { return NS.Dolphin.buildGoals(e, ctx); },
    // #1072: GuardianEntity.initGoals (07zzr_guardian.js); elder_guardian extends it and adds no goal.
    guardian: function (e, ctx) { return NS.Guardian.buildGoals(e, ctx); },
    elder_guardian: function (e, ctx) { return NS.Guardian.buildGoals(e, ctx); },
    turtle: function (e, ctx) {
      var Tu = NS.Turtle;
      var gs = new Ai.GoalSelector();
      var animals = ctx.animals || function () { return []; };
      var players = ctx.players || function () { return []; };
      var isTempting = ctx.isTempting || function (item) {
        var Br = NS.Breed;
        return !!(Br && Br.ready && Br.isFood('turtle', Br.itemNameOf(item)));
      };
      if (Tu && Tu.EscapeDangerGoal) gs.add(0, Ai.MOVE, new Tu.EscapeDangerGoal(e, 1.2, ctx));
      if (Tu && Tu.MateGoal) gs.add(1, Ai.MOVE | Ai.LOOK, new Tu.MateGoal(e, 1.0, ctx));
      if (Tu && Tu.LayEggGoal) gs.add(1, Ai.MOVE, new Tu.LayEggGoal(e, ctx));
      gs.add(2, Ai.MOVE | Ai.LOOK, new Ai.TemptGoal(e, 1.1, players, isTempting));
      if (Tu && Tu.WanderInWaterGoal) gs.add(3, Ai.MOVE, new Tu.WanderInWaterGoal(e, 1.0, ctx));
      if (Tu && Tu.GoHomeGoal) gs.add(4, Ai.MOVE, new Tu.GoHomeGoal(e, ctx));
      if (Tu && Tu.TravelGoal) gs.add(7, Ai.MOVE, new Tu.TravelGoal(e, 1.0, ctx));
      gs.add(8, Ai.LOOK, new Ai.LookAtPlayerGoal(e, players, 8.0));
      if (Tu && Tu.WanderOnLandGoal) gs.add(9, Ai.MOVE, new Tu.WanderOnLandGoal(e, 1.0, ctx.random, 100));
      // (no LookAroundGoal: TurtleEntity.initGoals adds none — #213)
      return gs;
    },
    /**
     * loop/zombievariants-s100 (QUEUE 0.2 G18c) -- drowned (`DrownedEntity.initCustomGoals`,
     * .decomp, read whole; 07zk_undead.js's own header explains the navigation-mode
     * substitution this engine cannot reproduce). `initCustomGoals` REPLACES `ZombieEntity`'s
     * own base rows entirely (unlike husk/stray, which inherit zombie's/skeleton's whole
     * roster UNCHANGED -- the two alias lines right after this object literal).
     *   - `TridentAttackGoal(this,1.0,40,10.0F)` extends `ProjectileAttackGoal` -> `Ai.
     *     ProjectileAttackGoal(1.0,40,40,10)` (#2821: no draw time, no back-off, throws every
     *     40 ticks), enabled only while a trident is actually equipped in the mainhand.
     *   - `DrownedAttackGoal extends ZombieAttackGoal` -- `Ai.MeleeAttackGoal` reused, enabled
     *     only while NOT holding a trident.
     *   - `canDrownedAttackTarget` (night, or the target is touching water) is vanilla's own
     *     TARGET-SELECTION predicate (`ActiveTargetGoal<>(this, PlayerEntity.class, 10, true,
     *     false, this::canDrownedAttackTarget)`) -- applied here at the SAME point, inside the
     *     `NearestAttackableTargetGoal`'s own candidate filter (`Undead.filterDrownedTargets`),
     *     AND (#3080) as `DrownedAttackGoal.canStart/shouldContinue`'s second gate on the melee goal.
     *   - `LeaveWaterGoal`/`TargetAboveWaterGoal`/`WanderAroundOnSurfaceGoal` -> `Undead.
     *     GoToBeachGoal`/`SwimUpGoal`/`GoToWaterGoal` (07zk_undead.js's own header explains
     *     each one's own named simplification against the real jar goal it stands in for).
     */
    drowned: function (e, ctx) {
      var Un = NS.Undead;
      var speed = 1.0;    // ZombieAttackGoal(this,1.0,false) / WanderAroundGoal(this,1.0)
      var gs = new Ai.GoalSelector();
      var hasTrident = function () {
        var Eq = NS.Equip, IT = NS.Items;
        if (!Eq || !Eq.ready || !IT) return false;
        var st = Eq.getEquipped(e, IT.MAINHAND);
        return !!(st && IT.nameOf && IT.nameOf(st.i) === 'trident');
      };
      // (no SwimGoal: the jar's drowned list has none — #213)
      // TridentAttackGoal.start/stop: setAttacking + setCurrentHand / clearActiveItem
      var tridentGoal = new Ai.ProjectileAttackGoal(e, speed, (Un && Un.TRIDENT_ATTACK_INTERVAL) || 40, (Un && Un.TRIDENT_ATTACK_INTERVAL) || 40, (Un && Un.TRIDENT_ATTACK_RADIUS) || 10, ctx.onShootTrident);
      var tStart = tridentGoal.start, tStop = tridentGoal.stop;
      tridentGoal.start = function () { tStart(); e.attacking = true; };
      tridentGoal.stop = function () { tStop(); e.attacking = false; };
      gs.add(2, Ai.MOVE | Ai.LOOK, new Ai.DisableableFollowTargetGoal(e, tridentGoal, hasTrident));
      gs.add(2, Ai.MOVE | Ai.LOOK, new Ai.DisableableFollowTargetGoal(e,
        new Ai.ZombieAttackGoal(e, speed), function () { return !hasTrident() && (!Un || Un.canDrownedAttackTarget(e.target)); }));   // #3080: DrownedAttackGoal.canStart/shouldContinue gate
      // #991: RevengeGoal(this).setGroupRevenge(ZombifiedPiglinEntity) -- alerts other drowned, never piglins
      gs.add(1, Ai.TARGET, new Ai.RevengeGoal(e, ctx, { group: true }));
      gs.add(2, Ai.TARGET, new Ai.NearestAttackableTargetGoal(e, function () {   // #213: ActiveTargetGoal(Player) priority 2
        return Un ? Un.filterDrownedTargets(e, ctx.players()) : [];
      }, { sight: true, mustSee: true, reciprocalChance: 10, rand: ctx.random }));
      function drownedOfType(t) {
        var out = [], EL = NS.EntityList;
        if (!EL || !EL.list) return out;
        for (var i = 0; i < EL.list.length; i++) {
          var o = EL.list[i];
          if (!o.removed && !o.dead && o !== e && o.type === t) out.push(o);
        }
        return out;
      }
      // #991: priority 3 MerchantEntity / IronGolem / Axolotl, priority 5 baby turtle on land (BABY_TURTLE_ON_LAND_FILTER)
      gs.add(3, Ai.TARGET, new Ai.NearestAttackableTargetGoal(e, function () { return merchantsOf(e); }, { sight: true, mustSee: false, reciprocalChance: 10, rand: ctx.random, livingBox: true }));
      gs.add(3, Ai.TARGET, new Ai.NearestAttackableTargetGoal(e, function () { return drownedOfType('iron_golem'); }, { sight: true, mustSee: true, reciprocalChance: 10, rand: ctx.random, livingBox: true }));
      gs.add(3, Ai.TARGET, new Ai.NearestAttackableTargetGoal(e, function () { return drownedOfType('axolotl'); }, { sight: true, mustSee: true, reciprocalChance: 10, rand: ctx.random, livingBox: true }));
      gs.add(5, Ai.TARGET, new Ai.NearestAttackableTargetGoal(e, function () {
        return drownedOfType('turtle').filter(function (t) { return t.isBaby && !t.inWater; });
      }, { sight: true, mustSee: true, reciprocalChance: 10, rand: ctx.random, livingBox: true }));
      if (Un && Un.DestroyEggGoal) gs.add(4, Ai.MOVE, new Un.DestroyEggGoal(e, ctx, speed, ctx.random));   // #879
      if (Un && Un.GoToBeachGoal) gs.add(5, Ai.MOVE, new Un.GoToBeachGoal(e, speed));
      if (Un && Un.SwimUpGoal) gs.add(6, Ai.MOVE, new Un.SwimUpGoal(e, speed, ctx.random));
      // priority 1 == vanilla's own WanderAroundOnSurfaceGoal.add(1, ...) (.decomp) --
      // D-712 undead deep-pass bugfix: was wired at 7 (tied with the plain wander
      // fallback below), which froze a dry-land drowned during the day (07zk_undead.js's
      // own GoToWaterGoal header has the full story).
      if (Un && Un.GoToWaterGoal) gs.add(1, Ai.MOVE, new Un.GoToWaterGoal(e, speed, ctx.random));
      gs.add(7, Ai.MOVE, new Ai.WanderAroundGoal(e, speed, ctx.random));   // #995: WanderAroundGoal(1.0)
      gs.add(8, Ai.LOOK, new Ai.LookAtPlayerGoal(e, ctx.players));
      gs.add(8, Ai.MOVE | Ai.LOOK, new Ai.RandomLookAroundGoal(e, ctx.random));   // #213
      return gs;
    }
  };
  // loop/zombievariants-s100 (QUEUE 0.2 G18c) -- `HuskEntity`/`StrayEntity` (.decomp, both
  // read whole) declare no `initGoals`/`initCustomGoals` override of their own at all -- both
  // inherit `ZombieEntity`/`AbstractSkeletonEntity`'s own roster UNCHANGED, so this engine's
  // own zombie/skeleton roster functions (immediately above) are reused verbatim rather than
  // re-typed, the SAME "no override means no fork" reasoning `Spawn.RULES.stray`'s own header
  // (07l_spawn.js) already applies for `canSpawnInDark`.
  Ai.ROSTER.husk = Ai.ROSTER.zombie;
  // D-712 (session 141) -- ZombifiedPiglinEntity (.decomp, `initCustomGoals` read in full) DOES
  // override its goals, unlike husk/stray/zombie_villager just above -- it is a `ZombieEntity`
  // subtype (confirmed via `.decomp/net/minecraft/entity/mob/ZombifiedPiglinEntity.java:40`,
  // `extends ZombieEntity implements Angerable`) but a bespoke one: NO `MoveThroughVillageGoal`,
  // NO player-attack-by-default targetSelector -- it only fights once ANGERED (hit, or another
  // zombified piglin's own alert), the exact `Angerable` substrate `Ai.HurtByTargetGoal`/
  // `Ai.AngryPlayerTargetGoal`/`Ai.UniversalAngerGoal` already built for golem/bee/wolf above.
  // Before this pass `Ai.ROSTER.zombified_piglin` had ZERO entries at all (D-709, session 140,
  // flagged not fixed) -- it fell under gravity only, gravity being `EL.tickMob`'s own
  // unconditional per-entity step, not an `Ai.ROSTER` fallback.
  //   goalSelector: 2:`ZombieAttackGoal(1,false)` == `Ai.MeleeAttackGoal` (zombie's own, same
  //     speed/no-raise-arm as `Ai.ROSTER.zombie` above) . 7:`WanderAroundFarGoal(1)` ==
  //     `Ai.WanderAroundFarGoal` (#2827). `LookAtEntityGoal`(8)/`LookAroundGoal`(8) are
  //     inherited from `ZombieEntity.initGoals()` UNCHANGED (not overridden by
  //     `initCustomGoals`) -- `Ai.LookAtPlayerGoal` covers the same live behaviour this
  //     roster's zombie/husk entries already give it. `FloatGoal`(0) mirrors zombie's own
  //     ROSTER entry above (base `MobEntity` swim goal, off the jar's own inherited class
  //     shape). `DestroyEggGoal`(4, inherited unchanged) is `Undead.DestroyEggGoal`,
  //     wired below (#1296).
  //   targetSelector: 1:`RevengeGoal(this).setGroupRevenge()` (no class arg -- defaults to
  //     `this.getClass()`, i.e. OTHER zombified piglins) == `Ai.HurtByTargetGoal` with a
  //     same-type `getPack` (the exact `ofType(t)` live-scan helper `Ai.ROSTER.wolf` above
  //     already uses for its own pack alert) . 2:`ActiveTargetGoal<Player>(10,true,false,
  //     shouldAngerAt)` == `Ai.AngryPlayerTargetGoal` (already collapses `shouldAngerAt` per the
  //     "ONE-PLAYER COLLAPSE" header above `Ai.UniversalAngerGoal`) . 3:`UniversalAngerGoal(this,
  //     true)` -- `triggerOthers=TRUE` (unlike golem's own `false`), so `Ai.UniversalAngerGoal`
  //     is built with the SAME same-type `getPack`, matching `Ai.ROSTER.wolf`'s own
  //     `triggerOthers=true` call shape immediately above.
  //   A fresh-spawned zombified piglin is NOT angry (`angerTime` starts 0), but a hit rolls
  //     betweenSeconds(20,39) in `Ai.HurtByTargetGoal` (#1221, Angerable.tickAngerLogic ->
  //     chooseRandomAngerTime), same as wolf/iron_golem/bee.
  // #1219 -- ZombifiedPiglinEntity.tickAngerPassing/angerNearbyZombifiedPiglins (mobTick while
  // getTarget()!=null): cooldown betweenSeconds(4,6) = 80..120 ticks, (re)armed when a target first
  // appears (setTarget) and after each pass; at 0, if the mob can see its target every other
  // target-less zombified piglin within (followRange, 10, followRange) gets the same target.
  Ai.ZP_ANGER_PASSING_MIN = 80; Ai.ZP_ANGER_PASSING_MAX = 120;
  Ai.ZombifiedPiglinAngerPassingGoal = function (e, rand, getPack) {
    var r = rand || Ai.rndOf(e), had = false;
    function roll() { return Ai.ZP_ANGER_PASSING_MIN + Math.floor(r() * (Ai.ZP_ANGER_PASSING_MAX - Ai.ZP_ANGER_PASSING_MIN + 1)); }
    this.canUse = function () { return !!e.target; };
    this.canContinueToUse = function () { return !!e.target; };
    this.start = function () { had = false; };
    this.stop = function () { had = false; };
    this.tick = function () {
      var t = e.target;
      if (!t) return;
      if (!had) { had = true; e.angerPassingCooldown = roll(); }   // setTarget(null -> x)
      if (e.angerPassingCooldown > 0) { e.angerPassingCooldown--; return; }
      if (Ai.canSee(e, t)) {
        var fr = Ai.followRangeOf(e), pack = getPack();
        for (var i = 0; i < pack.length; i++) {
          var o = pack[i];
          if (!o || o === e || o.removed || o.dead || o.target) continue;
          // getEntitiesByClass(Box.from(pos).expand(fr,10,fr)): o's bounding box must intersect (strict)
          var hw = (o.width || 0.6) / 2, oh = o.height || 1.95;
          if (Math.abs(o.x - e.x) >= fr + hw || Math.abs(o.z - e.z) >= fr + hw || o.y >= e.y + Ai.ALERT_RANGE_Y || o.y + oh <= e.y - Ai.ALERT_RANGE_Y) continue;
          o.target = t;
        }
      }
      e.angerPassingCooldown = roll();
    };
  };
  Ai.ROSTER.zombified_piglin = function (e, ctx) {
    var gs = new Ai.GoalSelector();
    function ofType(t) {
      var out = [];
      var EL = NS.EntityList;
      if (!EL || !EL.list) return out;
      for (var i = 0; i < EL.list.length; i++) {
        var o = EL.list[i];
        if (!o.removed && !o.dead && o !== e && o.type === t) out.push(o);
      }
      return out;
    }
    function pack() { return ofType('zombified_piglin'); }
    // (no SwimGoal: the jar's zombified piglin list has none — #213)
    gs.add(2, Ai.MOVE | Ai.LOOK, new Ai.ZombieAttackGoal(e, 1.0));
    if (NS.Undead && NS.Undead.DestroyEggGoal) gs.add(4, Ai.MOVE, new NS.Undead.DestroyEggGoal(e, ctx, 1.0, ctx.random));   // #1296 ZombieEntity.initGoals, inherited
    gs.add(7, Ai.MOVE, new Ai.WanderAroundFarGoal(e, 1.0, ctx.random));
    gs.add(8, Ai.LOOK, new Ai.LookAtPlayerGoal(e, ctx.players));
    gs.add(8, Ai.MOVE | Ai.LOOK, new Ai.RandomLookAroundGoal(e, ctx.random));   // #213
    gs.add(1, Ai.TARGET, new Ai.HurtByTargetGoal(e, ctx.random, pack));
    gs.add(2, Ai.TARGET, new Ai.AngryPlayerTargetGoal(e));
    gs.add(3, Ai.TARGET, new Ai.UniversalAngerGoal(e, ctx.random, true, pack));
    gs.add(9, 0, new Ai.ZombifiedPiglinAngerPassingGoal(e, ctx.random, pack));   // #1219 mobTick
    return gs;
  };
  // loop/zvillager-s102 (QUEUE 0.2 G18 mobs) -- ZombieVillagerEntity (.decomp, read whole)
  // declares no initGoals/initCustomGoals override of its own either -- same "no override means
  // no fork" reasoning husk/stray already use immediately above.
  Ai.ROSTER.zombie_villager = Ai.ROSTER.zombie;
  // s101 -- MooshroomEntity extends CowEntity and declares no initGoals (.decomp, read whole).
  Ai.ROSTER.mooshroom = Ai.ROSTER.cow;
  Ai.ROSTER.stray = Ai.ROSTER.skeleton;
  // D-673 (KW-32) -- `WitherSkeletonEntity.initGoals` (.decomp:30-33) is AbstractSkeleton's roster
  // plus ONE target goal, `ActiveTargetGoal<AbstractPiglinEntity>` at priority 3. Piglins are not
  // spawnable in this engine yet (KW-32), so that goal would have no candidate ever; the roster is
  // skeleton's, and the piglin target is named on KW-32 for the unit that makes piglins exist.
  // Its stone sword means `updateAttackType` (07k, D-602) hands it the melee goal, not the bow.
  // s133: piglins exist (07zzf_piglin.js) -- the ActiveTargetGoal<AbstractPiglinEntity> (priority 3) is live.
  Ai.ROSTER.wither_skeleton = function (e, ctx) {
    var gs = Ai.ROSTER.skeleton(e, ctx);
    gs.add(3, Ai.TARGET, new Ai.NearestAttackableTargetGoal(e, function () {
      var EL = NS.EntityList, out = [];
      if (!EL || !EL.list) return out;
      for (var i = 0; i < EL.list.length; i++) {
        var o = EL.list[i];
        if ((o.type === 'piglin' || o.type === 'piglin_brute') && !o.removed && !o.dead) out.push(o);
      }
      return out;
    }, { sight: true, mustSee: true, reciprocalChance: 10, rand: ctx.random }));
    return gs;
  };
  // loop/spawner-s114 (QUEUE 0.2 G18c) -- `CaveSpiderEntity` (.decomp, read whole: 55
  // lines -- createCaveSpiderAttributes/tryAttack/initialize/getActiveEyeHeight and
  // nothing else) declares no `initGoals`/`initCustomGoals` override of its own either --
  // same "no override means no fork" reasoning husk/stray/mooshroom immediately above
  // already use. Right after `spider`'s own entry (this file's own header cites it
  // there): `Ai.ROSTER.cave_spider = Ai.ROSTER.spider`.
  Ai.ROSTER.cave_spider = Ai.ROSTER.spider;

  // ═══ RAIDER SHARED GOALS (QUEUE 0.2 raid loop remainder, this pass) — `RaiderEntity`'s own
  // four `initGoals()` additions (`PickupBannerAsLeaderGoal`(1)/`MoveToRaidCenterGoal`(3)/
  // `AttackHomeGoal`(4)/`CelebrateGoal`(5), RaiderEntity.java:63-67) plus `PatrolEntity`'s own
  // inherited `PatrolGoal`(4) (PatrolEntity.java:35-37) — all five read from `.decomp` in full
  // and wired here as ONE contiguous block, appended onto every raider mob's own ROSTER entry
  // through `Ai.addRaiderGoals` (below) rather than duplicated per mob. `RaiderEntity`'s own
  // header comment (07s_raid.js, "═══ RAID MOBS ═══") already named this exact gap: "NONE of
  // those four are wired for any of the six mobs".
  //
  // ⚠ `raidOf(e)`/`activeRaid(r)` read `NS.RaidManager`/`NS.Raid` LAZILY, at goal-tick time, not
  // at file-load time — `07s_raid.js` loads AFTER this file (`build.mjs`'s own order), the same
  // standing every other cross-module goal reference in this ROSTER already relies on (e.g. the
  // `NS.Spell.*Goal` references two mobs up, `NS.Village`/`NS.EntityList` in the golem goals
  // below `Ai.ROSTER`'s own close) — none of it runs until a mob is actually spawned, by which
  // point every module has finished loading.
  function raidOf(e) {
    var rm = NS.RaidManager;
    if (!rm || !rm.world || e.raidId === undefined || e.raidId === null) return null;
    return rm.world.raids[e.raidId] || null;
  }
  function raidOngoing(r) {
    return !!r && NS.Raid && NS.Raid.Status && r.status === NS.Raid.Status.ONGOING;
  }
  function raidLost(r) {
    // `Raid.hasLost()` (Raid.java:163-165) — the VILLAGE lost, i.e. the RAIDERS won; the raid
    // loop's own enum order comment (07s_raid.js) already names `Rd.Status.LOSS` as that state.
    return !!r && NS.Raid && NS.Raid.Status && r.status === NS.Raid.Status.LOSS;
  }
  function nearVillageNow(e) {
    if (!NS.Raid || !NS.Raid.isNearOccupiedPOI) return false;
    var claimed = (NS.Profession && NS.Profession.ready) ? NS.Profession.claimed : null;
    return NS.Raid.isNearOccupiedPOI({ x: e.x, y: e.y, z: e.z }, claimed);
  }
  /** D-602 (raidergoals) — every OTHER live raider (`Ai.RAIDER_TYPES`), the group `opts.
   *  groupQuery` for `RaiderEntity`'s own `RevengeGoal(this, RaiderEntity.class).
   *  setGroupRevenge()` (vindicator/pillager/ravager, below) alerts — cross-species, unlike
   *  `ctx.animals()`'s own same-type-only query `Ai.RevengeGoal`'s default already uses. */
  /** Every other live mob (an entity carrying a goal selector) -- `MobEntity.class` for `LookAtEntityGoal`. */
  function mobsOf(e) {
    var out = [];
    var EL = NS.EntityList;
    if (!EL || !EL.list) return out;
    for (var i = 0; i < EL.list.length; i++) {
      var o = EL.list[i];
      if (o && o !== e && o.ai && !o.dead && !o.removed) out.push(o);
    }
    return out;
  }
  /** RevengeGoal.callSameTypeForRevenge: same class (mob.getClass()) inside box(pos).expand(followRange,10,followRange). */
  function sameClassNear(e) {
    var r = Ai.followRangeOf(e);
    return raidersOf(e).filter(function (o) {
      return o.type === e.type && Math.abs(o.x - e.x) <= r && Math.abs(o.z - e.z) <= r && Math.abs(o.y - e.y) <= 10;
    });
  }
  function raidersOf(e) {
    var out = [];
    var EL = NS.EntityList;
    if (!EL || !EL.list) return out;
    for (var i = 0; i < EL.list.length; i++) {
      var o = EL.list[i];
      if (!o || o === e || o.dead || o.removed) continue;
      if (Ai.RAIDER_TYPES[o.type]) out.push(o);
    }
    return out;
  }
  /** D-602 (raidergoals) — `MerchantEntity`'s two live implementors this engine has
   *  (`villager`/`wandering_trader`, `07i_entitylist.js`'s own `wtrader-s103` header) — the
   *  candidate list `ActiveTargetGoal<MerchantEntity>` (vindicator/pillager/ravager, below)
   *  needs, the SAME "scan `NS.EntityList.list` for a type" shape `EL.aiCtx`'s own `villagers`/
   *  `golems` closures (07i_entitylist.js) already use for the golem goals. */
  function merchantsOf(e) {
    var out = [];
    var EL = NS.EntityList;
    if (!EL || !EL.list) return out;
    // #1856: IllagerEntity.canTarget refuses a baby MerchantEntity (ravager is not an illager)
    var illager = e.type === 'vindicator' || e.type === 'pillager' || e.type === 'evoker' || e.type === 'illusioner';
    for (var i = 0; i < EL.list.length; i++) {
      var o = EL.list[i];
      if (!o || o === e || o.dead || o.removed) continue;
      if (illager && o.isBaby) continue;
      if (o.type === 'villager' || o.type === 'wandering_trader') out.push(o);
    }
    return out;
  }
  /** `Rd.buildLiveCtx`'s own `heightAt` convention (07s_raid.js): `W.heightAt` returns the
   *  surface block itself, so +1 is the first open cell above it. `null` on no world/ungenerated
   *  column, same as that function's own refusal. */
  function raiderHeightAt(x, z) {
    var W = NS.World;
    if (!W || !W.heightAt) return null;
    var top = W.heightAt(x, z);
    if (NS.CFG && top < NS.CFG.WORLD_MIN_Y) return null;
    return top + 1;
  }

  // `NoPenaltyTargeting.findTo` (MoveToRaidCenterGoal.java:52, RaiderEntity.java:353-357,
  // PatrolEntity.PatrolGoal's own `.rotateY(90F)` waypoint, PatrolEntity.java:184-189) — every
  // real raider move goal picks a SHORT-RANGE waypoint toward the far target rather than
  // pathing the whole distance in one call. `Ai.findPath`'s own node budget (400 by default,
  // `Ai.findPath`'s own doc) is sized for exactly that — a raid-center walk (up to the ring's
  // own 64+ blocks, `Rd.SPAWN_RING_RADIUS`) or a patrol target (up to 500 blocks,
  // `Ps.setRandomPatrolTarget`) both exceed it outright (proved once, not guessed: a live A*
  // from a tier-0 ring spawn to raid.center needs several thousand node expansions on an open
  // plain, `raidcheck.mjs`'s own §12 caught this as a raider that never moved before this
  // helper existed). `RAIDER_WAYPOINT_DIST` (20) is this engine's own clamp, not a jar number —
  // vanilla's own `NoPenaltyTargeting.findTo` additionally raycasts and checks `NodeType` along
  // the way (an entity-specific "can this mob actually stand there" search); the straight-line
  // clamp below is the same shape `Ai.WaterAvoidingRandomStrollGoal` already uses for its own
  // short-range picks, named as a simplification rather than the full raycast, on `Ai.OWED`.
  var RAIDER_WAYPOINT_DIST = 20;
  function waypointToward(e, tx, tz, maxDist) {
    var dx = tx - e.x, dz = tz - e.z;
    var d = Math.hypot(dx, dz);
    if (d <= maxDist || d === 0) return { x: tx, z: tz };
    var s = maxDist / d;
    return { x: e.x + dx * s, z: e.z + dz * s };
  }

  /**
   * `RaiderEntity.PickupBannerAsLeaderGoal` (RaiderEntity.java:508-547): a raider that can lead
   * but is not already wearing the ominous banner, whose wave has no living captain, walks to
   * and loots the nearest obtainable ominous-banner item entity within a 16×8×16 box.
   *
   * ⚠ NO SUCH ITEM EVER EXISTS IN THIS ENGINE (`Ai.OWED`, `Rd.OWED`'s own "real mob equipment"
   * line): `ominous_banner` is not a registered item id (`19_data.gen.js` names no such item —
   * vanilla's own is a plain white banner with hidden NBT, not a distinct item, and this
   * engine's captains are given the banner as a head-slot STATE directly at spawn, `Rd.
   * spawnNextWave`/`Ps.spawnPillager`), and no raider ever drops its equipment on death. The
   * scan below is real — it will run the day either gap closes — but `canUse` can never go true
   * in play today, the same standing `EL.aiCtx`'s own `isTempting`/`onBreed` had before D-423.
   */
  Ai.PickupBannerAsLeaderGoal = function (e, ctx) {
    var target = null, path = null, idx = 1;
    function nearbyBanner() {
      var EL = NS.EntityList, Items = NS.Items;
      if (!EL || !EL.list) return null;
      var best = null, bd = Infinity;
      for (var i = 0; i < EL.list.length; i++) {
        var o = EL.list[i];
        if (o === e || o.dead || o.removed || o.type !== 'item') continue;
        if (!NS.Equip || !NS.Equip.isOminousBanner({ i: o.item, t: o.tag })) continue;
        var dx = o.x - e.x, dy = o.y - e.y, dz = o.z - e.z;
        if (Math.abs(dx) > 16 || Math.abs(dy) > 8 || Math.abs(dz) > 16) continue;
        var d = dx * dx + dy * dy + dz * dz;
        if (d < bd) { bd = d; best = o; }
      }
      return best;
    }
    this.canUse = function () {
      var r = raidOf(e);
      // `hasActiveRaid() && !raid.isFinished()` — a raid that already STOPPED is finished too,
      // so ONGOING is the only live status this goal ever starts under (matches vanilla's own
      // gate, since a VICTORY/LOSS raid still runs its finish cooldown before STOPPED).
      if (!raidOngoing(r)) return false;
      if (!NS.Raid || !NS.Raid.CAN_LEAD || !NS.Raid.CAN_LEAD[e.type]) return false;
      if (e.headItem === 'ominous_banner') return false;
      var captain = r.waveCaptain ? r.waveCaptain[e.wave] : null;
      if (captain && !captain.dead && !captain.removed) return false;
      var it = nearbyBanner();
      if (!it) return false;
      // canStart returns navigation.startMovingTo(item, 1.15): no path -> the goal never starts
      var p = Ai.findPath(e.x, e.y, e.z, it.x, it.y, it.z, { maxDrop: 2, mob: e });
      if (!p || p.length < 2) return false;
      target = it; path = p;
      return true;
    };
    this.canContinueToUse = function () { return !!target && !target.dead && !target.removed; };
    this.start = function () { idx = 1; };
    this.stop = function () { path = null; target = null; };
    this.tick = function () {
      if (!target) return;
      var dx = target.x - e.x, dy = target.y - e.y, dz = target.z - e.z;
      if (dx * dx + dy * dy + dz * dz <= 2.0) {   // 1.414 blocks, RaiderEntity.java:540
        if (!NS.Equip.tryPromoteCaptain(e, target)) { target = null; path = null; return; }
        target = null; path = null;
        return;
      }
      if (path && idx < path.length) {
        Ai.stepToward(e, path[idx], 1.15);
        if (Ai.closeTo(e, path[idx])) idx++;
      }
    };
  };

  /**
   * `MoveToRaidCenterGoal` (.decomp/net/minecraft/entity/ai/goal/MoveToRaidCenterGoal.java):
   * every raider not already near an occupied POI beelines for `raid.center`.
   *
   * `includeFreeRaiders` (MoveToRaidCenterGoal.java:60-73) — recruiting a nearby raider that
   * carries no raid of its own (a roaming patrol pillager, 07x_patrol.js) — is wired s98 via
   * `Rd.includeFreeRaiders`/`Rd.addRaider`.
   */
  Ai.MoveToRaidCenterGoal = function (e, ctx) {
    var path = null, idx = 1, timer = 0, nextFreeRaiderCheckAge = 0;
    this.canUse = function () {
      var r = raidOf(e);
      // s98: vanilla tests `!hasPassengers()` (MoveToRaidCenterGoal.canStart), not hasVehicle.
      return !e.target && !e.passenger && raidOngoing(r) && !nearVillageNow(e);
    };
    this.canContinueToUse = function () {
      var r = raidOf(e);
      return raidOngoing(r) && !nearVillageNow(e);
    };
    this.start = function () { path = null; idx = 1; };
    this.stop = function () { path = null; };
    this.tick = function () {
      var r = raidOf(e);
      if (!r) return;
      // s98 -- `includeFreeRaiders`, every 20 ticks of the actor's own age (.decomp lines 46-49).
      if ((e.age || 0) > nextFreeRaiderCheckAge) {
        nextFreeRaiderCheckAge = (e.age || 0) + 20;
        if (NS.Raid && NS.Raid.includeFreeRaiders && NS.EntityList) NS.Raid.includeFreeRaiders(e, r, NS.EntityList.list, raidOf);
      }
      if (path && idx < path.length) {
        Ai.stepToward(e, path[idx], 1.0);
        if (Ai.closeTo(e, path[idx])) idx++;
        return;
      }
      if (--timer > 0) return;
      timer = 20;   // MoveToRaidCenterGoal.FREE_RAIDER_CHECK_INTERVAL's own cadence, reused as a repath cadence
      var c = r.center;
      var wp = waypointToward(e, c.x, c.z, RAIDER_WAYPOINT_DIST);
      var gy = raiderHeightAt(wp.x, wp.z);
      var p = Ai.findPath(e.x, e.y, e.z, wp.x, gy === null ? c.y : gy, wp.z, { maxDrop: 2, mob: e });
      if (p && p.length > 1) { path = p; idx = 1; }
    };
  };

  /**
   * `RaiderEntity.AttackHomeGoal` (RaiderEntity.java:289-380): a raiding raider with no combat
   * target walks to its "home" and, on arrival, keeps re-picking a nearby point around it.
   *
   * CLOSED FOR REAL THIS PASS (loop/raidpoi-s103) — `tryFindHome` (RaiderEntity.java:311-328) now
   * has a real target: `NS.Poi.getPosition` (07zu_poi.js) searches a real 48-block-radius HOME
   * (bed) POI index, `OccupationStatus.ANY` (vanilla asks for ANY, not just unclaimed — the same
   * `field_18489` this file's own header would cite), shuffled, taking the first not among the
   * last two homes this goal already walked to (`canLootHome`/`lastHomes`/`purgeMemory`,
   * RaiderEntity.java:365-385, ported verbatim below). A raider with no bed within 48 blocks
   * behaves exactly as vanilla's own `canStart` does when `tryFindHome` returns empty: this goal
   * simply never starts (`MoveToRaidCenterGoal`, above, still gets it to the village generally).
   * Was: `raid.center` (the claimed-workstation average) stood in for "home" outright — `Rd.OWED`
   * used to name this exact substitution, now struck.
   */
  Ai.AttackHomeGoal = function (e, ctx) {
    var path = null, idx = 1, timer = 0, home = null, lastHomes = [];
    // `canLootHome` (RaiderEntity.java:365-372): refuse any of the last 2 homes remembered.
    function canLootHome(pos) {
      for (var i = 0; i < lastHomes.length; i++) {
        if (lastHomes[i].x === pos.x && lastHomes[i].y === pos.y && lastHomes[i].z === pos.z) return false;
      }
      return true;
    }
    function isHome(t) { return t === NS.Poi.HOME; }
    function tryFindHome() {
      if (!NS.Poi || !NS.Poi.ready) return false;
      var pos = NS.Poi.getPosition(isHome, canLootHome, NS.Poi.STATUS.ANY,
        { x: e.x, y: e.y, z: e.z }, 48, ctx.random || Ai.rndOf(e));
      if (!pos) return false;
      home = pos;
      return true;
    }
    this.canUse = function () {
      var r = raidOf(e);
      // `purgeMemory` (RaiderEntity.java:381-385): a 3rd-oldest entry is dropped before the
      // search, not after — same order the jar's own `canStart` calls it in.
      if (lastHomes.length > 2) lastHomes.shift();
      return raidOngoing(r) && !e.target && tryFindHome();
    };
    this.canContinueToUse = function () {
      var r = raidOf(e);
      return raidOngoing(r) && !e.target && !!home;
    };
    this.start = function () { path = null; idx = 1; };
    // RaiderEntity.java:335-337: the home is only REMEMBERED (added to `lastHomes`) if this
    // raider actually got close to it — `<= 1.5` blocks approximates the jar's own
    // `home.isWithinDistance(pos, this.distance)` with `distance` (RaiderEntity.java:67's own
    // ctor arg) `1` plus a small entity-width margin, the same shape `Ai.closeTo`'s own default
    // radius already approximates a "reached" test with elsewhere in this file.
    this.stop = function () {
      if (home) {
        var dx = home.x - e.x, dy = home.y - e.y, dz = home.z - e.z;
        if (dx * dx + dy * dy + dz * dz <= 2.25) lastHomes.push(home);
      }
    };
    this.tick = function () {
      var r = raidOf(e);
      if (!r || !home) return;
      if (path && idx < path.length) {
        Ai.stepToward(e, path[idx], 1.05);   // RaiderEntity.java:67's own ctor speed, 1.05F
        if (Ai.closeTo(e, path[idx])) idx++;
        return;
      }
      if (--timer > 0) return;
      timer = 40;
      var wp = waypointToward(e, home.x, home.z, RAIDER_WAYPOINT_DIST);
      var gy = raiderHeightAt(wp.x, wp.z);
      var p = Ai.findPath(e.x, e.y, e.z, wp.x, gy === null ? home.y : gy, wp.z, { maxDrop: 2, mob: e });
      if (p && p.length > 1) { path = p; idx = 1; }
    };
  };

  /**
   * `RaiderEntity.CelebrateGoal` (RaiderEntity.java:393-428): once the raid's raiders have WON
   * (`Raid.hasLost()` — the VILLAGE lost, see `raidLost` above), every surviving raider with no
   * combat target sets its own `CELEBRATING` state and, every ~100 ticks, plays its celebrating
   * sound, and every ~50 ticks, hops.
   *
   * ⚠ THE SOUND ITSELF IS NOT PLAYED (`Ai.OWED`): `RaiderEntity.getCelebratingSound()`'s six
   * per-mob sound events are not in this engine's sound-event registry at all (`19_data.gen.js`
   * names no `entity.*.celebrate` event — this engine's own extractor never pulled mob VOICE
   * sounds, only block sounds, `02j_sounds.js`'s own `S.play` callers today are all `S.block*`).
   * `e.celebrating` — the state a renderer would key an animation off — and the hop are both
   * real; the roll below is skipped harmlessly when no sound id resolves.
   */
  Ai.CelebrateGoal = function (e, ctx) {
    this.canUse = function () {
      var r = raidOf(e);
      return !e.target && raidLost(r);
    };
    this.canContinueToUse = this.canUse;
    this.start = function () { e.celebrating = true; };
    this.stop = function () { e.celebrating = false; };
    this.tick = function () {
      if (Ai.rndOf(e)() < 1 / 100) {
        var id = NS.Raid && NS.Raid.CELEBRATE_SOUND ? NS.Raid.CELEBRATE_SOUND[e.type] : null;
        if (id && NS.Sound && NS.Sound.mobSound) NS.Sound.mobSound(e, id);
      }
      if (!e.riding && Ai.rndOf(e)() < 1 / 50) e.jumping = true;
    };
  };

  /**
   * `PatrolEntity.PatrolGoal` (PatrolEntity.java:150-216), shared by every roaming patrol
   * member — the leader walks toward its own long-range `patrolTarget` (re-picked once within
   * 10 blocks of it, `PatrolEntity.setRandomPatrolTarget`, PatrolEntity.java:130-133), and every
   * groupmate within 16 blocks that carries no raid of its own (`hasNoRaid`) is kept moving
   * toward the leader.
   *
   * The waypoint is vanilla's (`Ai.patrolWaypoint`, #3138): 10 blocks along the rotateY(90 rad)
   * offset circle, handed to every mate; wander() walks at 0.7 for leader and follower alike.
   */
  Ai.PATROL_GROUP_RADIUS_SQ = 256;          // getBoundingBox().expand(16.0)
  Ai.PATROL_RETARGET_DIST_SQ = 100;         // isWithinDistance(pos, 10.0)
  // PatrolGoal.tick() :184-189: Vec3d.rotateY takes RADIANS (90 rad, a real vanilla quirk; Math.sin/cos
  // vs MathHelper's table differ by <1e-4). Returns the 10-block waypoint {x,y,z} (unsnapped).
  Ai.patrolWaypoint = function (px, py, pz, tx, ty, tz) {
    var bx = tx + 0.5, bz = tz + 0.5;
    var rx = px - bx, ry = py - ty, rz = pz - bz;
    var c = Math.cos(90), sn = Math.sin(90);
    var cx = (rx * c + rz * sn) * 0.4 + bx, cy = ry * 0.4 + ty, cz = (rz * c - rx * sn) * 0.4 + bz;
    var dx = cx - px, dy = cy - py, dz = cz - pz, d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    return { x: px + dx / d * 10, y: py + dy / d * 10, z: pz + dz / d * 10 };
  };
  Ai.PatrolGoal = function (e, ctx) {
    var path = null, idx = 1, pathSpeed = 0.7;
    function groupmates() {
      var EL = NS.EntityList, out = [];
      if (!EL || !EL.list) return out;
      for (var i = 0; i < EL.list.length; i++) {
        var o = EL.list[i];
        if (o === e || o.dead || o.removed) continue;
        if (!Ai.RAIDER_TYPES[o.type]) continue;                      // getEntitiesByClass(PatrolEntity.class)
        if (o.raidId !== undefined && o.raidId !== null) continue;   // hasNoRaid()
        // getBoundingBox().expand(16.0): AABB overlap, not a sphere
        var R = 16, ew = (e.width || 0.6) / 2, ow = (o.width || 0.6) / 2;
        if (Math.abs(o.x - e.x) > R + ew + ow) continue;
        if (Math.abs(o.z - e.z) > R + ew + ow) continue;
        if (o.y > e.y + (e.height || 1.8) + R || o.y + (o.height || 1.8) < e.y - R) continue;
        out.push(o);
      }
      return out;
    }
    function freshTarget() {
      return {
        x: Math.floor(e.x) - 500 + Math.floor(Ai.rndOf(e)() * 1000),
        y: Math.floor(e.y),
        z: Math.floor(e.z) - 500 + Math.floor(Ai.rndOf(e)() * 1000)
      };
    }
    var nextSearchAge = -1;   // nextPatrolSearchTime, in the mob's own age ticks
    this.canUse = function () {
      return !!e.patrolling && !e.target && !e.passenger && !!e.patrolTarget && !((e.age || 0) < nextSearchAge);
    };
    this.canContinueToUse = this.canUse;
    this.start = function () { path = null; idx = 1; };
    this.stop = function () { path = null; };
    this.tick = function () {
      if (path && idx < path.length) {
        Ai.stepToward(e, path[idx], pathSpeed);
        if (Ai.closeTo(e, path[idx])) idx++;
        return;
      }
      var mates = groupmates();   // vanilla runs the whole body every tick while navigation is idle: no throttle
      if (mates.length === 0) {   // isRaidCenterSet() && targets.isEmpty(): ANY member, leader included
        e.patrolling = false;
        return;
      }
      if (e.patrolLeader) {       // vanilla if / else-if / else: the retarget tick does not path
        var t = e.patrolTarget;
        var dx = t.x + 0.5 - e.x, dy = t.y + 0.5 - e.y, dz = t.z + 0.5 - e.z;   // Vec3i.getSquaredDistanceFromCenter, 3D
        if (dx * dx + dy * dy + dz * dz < Ai.PATROL_RETARGET_DIST_SQ) { e.patrolTarget = freshTarget(); return; }
      }
      var gt = e.patrolTarget;
      var wp = Ai.patrolWaypoint(e.x, e.y, e.z, gt.x, gt.y, gt.z);
      wp.x = Math.floor(wp.x); wp.z = Math.floor(wp.z);
      var gy = raiderHeightAt(wp.x, wp.z);
      var p = Ai.findPath(e.x, e.y, e.z, wp.x, gy === null ? gt.y : gy, wp.z, { maxDrop: 2, mob: e });
      if (p && p.length > 1) {
        path = p; idx = 1; pathSpeed = e.patrolLeader ? 0.595 : 0.7;   // startMovingTo(.., isLeader ? followSpeed : leaderSpeed)
        // startMovingTo succeeded: the leader hands every mate the waypoint ($$7), not its own position
        if (e.patrolLeader) {
          for (var j = 0; j < mates.length; j++) mates[j].patrolling = true, mates[j].patrolTarget = { x: Math.floor(wp.x), y: gy === null ? gt.y : gy, z: Math.floor(wp.z) };
        }
      } else {   // startMovingTo refused: wander() a short random hop, then 200-tick cooldown
        var wx = Math.floor(e.x) - 8 + Math.floor(Ai.rndOf(e)() * 16), wz = Math.floor(e.z) - 8 + Math.floor(Ai.rndOf(e)() * 16);
        var wy = raiderHeightAt(wx, wz);
        var wp2 = Ai.findPath(e.x, e.y, e.z, wx, wy === null ? e.y : wy, wz, { maxDrop: 2, mob: e });
        if (wp2 && wp2.length > 1) { path = wp2; idx = 1; pathSpeed = 0.7; }   // wander(): this.leaderSpeed for everyone
        nextSearchAge = (e.age || 0) + 200;
      }
    };
  };

  /** Appends `RaiderEntity`'s/`PatrolEntity`'s own five shared goals, at their real vanilla
   *  priority numbers, onto a raider mob's own ROSTER entry — the one place any of the six
   *  raider ROSTER functions is allowed to change past this pass (this file's own commit rule). */
  Ai.addRaiderGoals = function (gs, e, ctx) {
    gs.add(4, Ai.MOVE, new Ai.PatrolGoal(e, ctx));               // PatrolEntity.initGoals (inherited)
    gs.add(1, Ai.MOVE, new Ai.PickupBannerAsLeaderGoal(e, ctx));
    gs.add(3, Ai.MOVE, new Ai.MoveToRaidCenterGoal(e, ctx));
    gs.add(4, Ai.MOVE, new Ai.AttackHomeGoal(e, ctx));
    gs.add(5, Ai.MOVE, new Ai.CelebrateGoal(e, ctx));
  };

  /**
   * `HorseBondWithPlayerGoal` (Yarn, .decomp/net/minecraft/entity/ai/goal/
   * HorseBondWithPlayerGoal.java), javap'd in full — QUEUE 0.2 (G18e remainder, the mount/tame/
   * ride unit). This is the WHOLE of vanilla's "ride an untamed horse repeatedly to tame it":
   * every ~50 ticks (`getTickCount(50)`; `shouldRunEveryTick()` defaults false so that is
   * `toGoalTicks(50) == ceilDiv(50,2) == 25` GOAL ticks, and vanilla's own `GoalSelector`
   * alternates a non-`shouldRunEveryTick` goal's `tick()` every other REAL tick — so 25 goal-
   * ticks land one real tick apart on average, i.e. one roll per ~50 real ticks. This engine's
   * `GoalSelector.tick()` has no alternator (07k_goals.js's own header, `GoalSelector.prototype.
   * tick`) and runs every real tick, so `nextInt(50) === 0` here reproduces the SAME per-real-
   * tick rate rather than the jar's own two-step arithmetic for its own sake) it rolls
   * `nextInt(maxTemper) < temper`: on success the rider becomes the owner (`bondWithPlayer`,
   * `Mount.bondWithPlayer`); on failure `addTemper(5)` and the rider is thrown (`Mount.
   * dismount`).
   *
   * ⚠ WHAT IS NOT HERE, NAMED ON `Ai.OWED`/`Mount.OWED` RATHER THAN GUESSED: vanilla's own
   * `canStart`/`start`/`tick` ALSO pick a random nearby point and have the horse WALK there
   * while this is happening (`NoPenaltyTargeting.find` + `getNavigation().startMovingTo`) —
   * purely cosmetic (nothing a headless check can see), so it is not ported; and the angry-
   * buck's own 20-tick countdown (`HorseBaseEntity.tick`'s `angryTicks`) is `Mnt.tickAnger`
   * (D-550), so `e.angry` set on a failed bond clears itself 20 ticks later as vanilla's does.
   */
  Ai.HorseBondWithPlayerGoal = function (e, ctx) {
    var rand = (ctx && ctx.random) || Ai.rndOf(e);
    var bucking = function () { var Mnt = NS.Mount; return !!Mnt && Mnt.ready && !e.tamed && !!e.rider; };
    // canStart/start/shouldContinue: NoPenaltyTargeting.find(5,4) + startMovingTo(speed 1.2) + !isIdle is
    // exactly PanicGoal's walk with the danger test swapped for "untamed and ridden". Riders here are always the player.
    var walk = new Ai.PanicGoal(e, 1.2, { random: rand, inDanger: bucking });
    this.canUse = function () { return bucking() && walk.canUse(); };
    this.canContinueToUse = function () { return bucking() && walk.canContinueToUse(); };
    this.start = function () { walk.start(); };
    this.stop = function () { walk.stop(); };
    this.tick = function () {
      walk.tick();
      var Mnt = NS.Mount;
      if (!Mnt || !Mnt.ready) return;
      if (Math.floor(rand() * 50) !== 0) return;
      if (!e.rider) return;
      var temper = Mnt.getTemper(e), max = Mnt.MAX_TEMPER;
      if (max > 0 && Math.floor(rand() * max) < temper) {
        Mnt.bondWithPlayer(e);
        return;
      }
      Mnt.addTemper(e, Mnt.BOND_FAIL_TEMPER);
      Mnt.dismount(e);
      Mnt.playAngrySound(e);   // D-550: `playAngrySound()` -> angryTicks=1 + setAngry(true); cleared 20 ticks later (Mnt.tickAnger)
    };
  };

  // D-533 (G18c) -- `BatEntity` registers NO goals (.decomp, read in full: no initGoals
  // override, and AmbientEntity/MobEntity add none). The empty selector is what makes it a
  // MOB here (`EL.tickOne` routes by `e.ai`); its whole will is `Bat.mobTick` (07zf_bat.js).
  Ai.ROSTER.bat = function () { return new Ai.GoalSelector(); };

  // Dan's scheduled parallel night, QUEUE 0.2 (G18c) -- `PolarBearEntity.initGoals()`
  // (.decomp, read in full), transcribed at the JAR'S OWN PRIORITY NUMBERS (not this
  // session's placement -- every number below is the literal `goalSelector.add`/
  // `targetSelector.add` argument): SwimGoal(0), own AttackGoal(1), own
  // PolarBearEscapeDangerGoal(1), FollowParentGoal(4, 1.25), WanderAroundGoal(5, 1.0) --
  // `Ai.WanderAroundGoal` (#4412; plain, NoPenaltyTargeting.find(10,7), not the water-avoiding stroll) --
  // LookAtEntityGoal(6, Player, 6.0F), LookAroundGoal(7); target: own
  // PolarBearRevengeGoal(1), own ProtectBabiesGoal(2), ActiveTargetGoal(3, Player,
  // shouldAngerAt) -- `Ai.AngryPlayerTargetGoal`, the same re-acquire-while-angry goal iron
  // golem's own roster uses -- ActiveTargetGoal(4, Fox, 10, true, true) wired below (#1312),
  // UniversalAngerGoal(5, false) -- `Ai.UniversalAngerGoal`, verbatim reuse, see
  // 07zj_polarbear.js's own header for why this file adds no new anger machinery.
  Ai.ROSTER.polar_bear = function (e, ctx) {
    var Pb = NS.PolarBear;
    var gs = new Ai.GoalSelector();
    var animals = ctx.animals || function () { return []; };
    gs.add(0, Ai.JUMP, new Ai.SwimGoal(e, ctx.random));
    if (Pb) {
      gs.add(1, Ai.MOVE | Ai.LOOK, new Pb.AttackGoal(e));
      gs.add(1, Ai.MOVE, new Pb.EscapeDangerGoal(e));
    }
    gs.add(4, Ai.MOVE, new Ai.FollowParentGoal(e, 1.25, animals));
    gs.add(5, Ai.MOVE, new Ai.WanderAroundGoal(e, 1.0, ctx.random));
    gs.add(6, Ai.LOOK, new Ai.LookAtPlayerGoal(e, ctx.players, 6.0));
    gs.add(7, Ai.MOVE | Ai.LOOK, new Ai.RandomLookAroundGoal(e, ctx.random));
    if (Pb) {
      gs.add(1, Ai.TARGET, new Pb.RevengeGoal(e, ctx));
      gs.add(2, Ai.TARGET, new Pb.ProtectBabiesGoal(e, ctx));
    }
    gs.add(3, Ai.TARGET, new Ai.AngryPlayerTargetGoal(e));
    // ActiveTargetGoal<>(this, FoxEntity.class, 10, true, true, null): reciprocalChance 10, mustSee, sight.
    var foxes = function () {
      var out = [], EL = NS.EntityList;
      if (!EL || !EL.list) return out;
      for (var i = 0; i < EL.list.length; i++) {
        var o = EL.list[i];
        if (!o.removed && !o.dead && o !== e && o.type === 'fox') out.push(o);
      }
      return out;
    };
    var foxGoal = new Ai.NearestAttackableTargetGoal(e, foxes, { reciprocalChance: 10, rand: ctx.random, sight: true, mustSee: true });
    foxGoal.tag = 'fox';
    gs.add(4, Ai.TARGET, foxGoal);
    gs.add(5, Ai.TARGET, new Ai.UniversalAngerGoal(e, ctx.random));
    return gs;
  };

  // #6255: the engine-side RunningGoals emitter. Goal objects are closures with no class name, so every
  // exported Ai.*Goal constructor is wrapped once to stamp __goalName (outermost constructor wins, so
  // ZombieAttackGoal stays ZombieAttackGoal though it calls MeleeAttackGoal).
  var VANILLA_GOAL = { FloatGoal: 'SwimGoal', PanicGoal: 'EscapeDangerGoal', BreedGoal: 'AnimalMateGoal', AvoidEntityGoal: 'FleeEntityGoal',
    WaterAvoidingRandomStrollGoal: 'WanderAroundFarGoal', HurtByTargetGoal: 'RevengeGoal', NearestAttackableTargetGoal: 'ActiveTargetGoal',
    LookAtPlayerGoal: 'LookAtEntityGoal', RandomLookAroundGoal: 'LookAroundGoal' };
  Object.keys(Ai).forEach(function (k) {
    var C = Ai[k];
    if (typeof C !== 'function' || !/Goal$/.test(k)) return;
    var vname = VANILLA_GOAL[k] || k;
    var W = function () { if (!this.__goalName) this.__goalName = vname; return C.apply(this, arguments); };
    W.prototype = C.prototype;
    W.__orig = C;   // instances keep constructor === C; tools map a goal back to its Ai.* names through this
    Object.keys(C).forEach(function (q) { W[q] = C[q]; });
    Ai[k] = W;
  });
  /** GoalSelector.getRunningGoals on e.ai (the goalSelector rows; TARGET-only rows are the targetSelector's): [[priority, vanillaName]] sorted like
   *  tools/referee/lockstep parseGoals (priority, then name). `all` lists every registered goal instead. */
  Ai.runningGoals = function (e, all) {
    var gs = e && e.ai, out = [];
    if (!gs || !gs.entries) return out;
    for (var i = 0; i < gs.entries.length; i++) {
      var en = gs.entries[i];
      if (en.flags === Ai.TARGET) continue;   // targetSelector rows share this selector
      if ((all || en.running) && en.goal.__goalName) out.push([en.priority, en.goal.__goalName]);
    }
    return out.sort(function (a, b) { return a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0); });
  };

  /** Build the goal selector a spawned entity of `type` should run, or null if none rostered. */
  Ai.selectorFor = function (e, ctx) {
    var f = Ai.ROSTER[e.type];
    return f ? f(e, ctx || {}) : null;
  };

})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
