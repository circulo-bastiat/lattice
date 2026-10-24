// 07i_entitylist.js — PLAN G17b: the entity LIST, and the motion every entity shares.
// Runs on: MAIN THREAD ONLY. No DOM.
//
// The world holds blocks and, from here, THINGS THAT ARE NOT BLOCKS. This module owns the list:
// spawning, removing, and one tick of vanilla's shared motion — gravity, the collision sweep,
// then drag, in that order, which is the order `FallingBlockEntity.tick` uses and not the order
// intuition suggests.
//
// ⚠⚠ **NOTHING HERE DECIDES A NUMBER.** The box comes from `NS.Entities` (D-306) and the gravity
// and drag from the same table (D-307), both read out of the 1.18.2 bytecode. This file is the
// LOOP; the constants are the referee's.
//
// ⚠⚠ **AND THE SET OF WHAT IT WILL SIMULATE IS CLOSED.** `spawn` REFUSES any type whose gravity
// and drag were not both measured — six types can be spawned today and the other 107 are named
// in `EL.owed()`. That is deliberate and it is the lesson of D-298 and D-307: a default here
// would be invisible, because a wrongly-defaulted entity still falls, still lands, still looks
// fine, and is simply wrong for ever. A refusal is a question someone has to answer.
//
// ⚠ **WHAT IS NOT HERE, AND IS G17c's**: item entities merging and despawning, a falling block
// turning back into a block when it lands, TNT exploding, projectiles hitting things, and the
// renderer that draws any of it. This stage moves them; it does not give them meaning.
//
// ⚠ **AND IT IS NOT IN THE SAVE.** `16b_save.js` writes the world and the player; entities are
// G17c's to persist, and adding a half-shape to the envelope now would be a version bump that
// bought nothing (D-139's rule, from the other side).

(function (NS) {
  'use strict';

  var EL = NS.EntityList = {
    ready: false,
    list: null,
    nextId: 1,
    ticks: 0
  };

  /** Vanilla's own cap on how far one entity may move in a tick, from `Entity.move`. */
  EL.MAX_STEP = 10.0;

  EL.init = function () {
    var E = NS.Entities;
    if (!E || !E.ready || !NS.Physics) { EL.ready = false; return EL; }
    EL.list = [];
    EL.nextId = 1;
    EL.spawnCounter = 0;
    EL.ticks = 0;
    EL.ready = true;
    return EL;
  };

  /** [gravity, drag] for a type, or null when either was never measured (D-307). */
  EL.motionFor = function (type) {
    var D = NS.DATA, E = NS.Entities;
    var bare = E && E.bare(type);
    // loop/spells-s93 — `EvokerFangsEntity` extends `Entity` directly, not `LivingEntity`, and
    // never overrides `tick()`'s motion at all (.decomp/net/minecraft/entity/mob/
    // EvokerFangsEntity.java: position is set once in the constructor, `tick()` only counts
    // `warmup`/`ticksLeft`) — there is nothing for D-307/D-390's extractor to MEASURE (it never
    // falls), so it is not in `D.entities.motion` and a fixed zero-motion pair is named here
    // rather than left permanently unspawnable by the closed-set rule this file's own header
    // states.
    if (bare === 'evoker_fangs') return [0, 1];
    // loop/lightning -- `LightningEntity extends Entity` DIRECTLY (.decomp, read whole) and
    // never touches its own position after spawn (no `travel()`/gravity override at all --
    // `tick()` is ambient-timer bookkeeping only) -- the SAME 'nothing for the extractor to
    // measure' shape `evoker_fangs` two lines below documents, zero-sized per
    // tools/extract-entities.mjs's own 'lightning_bolt,marker' zero-size pair.
    if (bare === 'lightning_bolt') return [0, 1];
    // #5916 -- potion/experience_bottle/trident are rows of entity-motion-src-1.18.2.tsv (extract-entity-motion-src.mjs
    // projectileRows, read off .decomp's getGravity()/tick literals), no hardcode here.
    // loop/raidvex-s96 -- `VexEntity.tick()` calls `this.setNoGravity(true)` UNCONDITIONALLY,
    // every tick, regardless of goal state (.decomp/net/minecraft/entity/mob/VexEntity.java,
    // read in full this pass) -- the SAME shape `evoker_fangs`' own hardcode above already
    // documents: a mob that never falls has nothing for D-307/D-390's bytecode extractor to
    // MEASURE, so `tools/golden/entity-motion-1.18.2.tsv` correctly carries no row for it
    // (07s_raid.js's own header already named this as "a finding, not a gap"). `[0, 1]` is
    // inert at runtime -- `Fl.VexMoveControl.tick()` (07t_fly.js) sets `e.noGravity = true`
    // itself every tick, the same way `evoker_fangs`' own zero-motion never actually falls --
    // it exists only so this closed-set gate does not refuse to spawn a type this engine can
    // now genuinely move (`Ai.ROSTER.vex`, 07k_goals.js).
    if (bare === 'vex') return [0, 1];
    // #1564 (G25) -- minecarts do their own gravity in AbstractMinecartEntity.tick (07zzr_minecart.js): nothing to measure.
    if (NS.Minecart && NS.Minecart.isCart(bare)) return [0, 1];
    // #5227 (G17-B1) -- BoatEntity.updateVelocity does its own gravity (07zzt_boat.js): nothing to measure.
    if (bare === 'boat' && NS.Boat) return [0, 1];
    // loop/phantom -- PhantomEntity extends FlyingEntity (.decomp/net/minecraft/entity/mob/
    // FlyingEntity.java, read in full): FlyingEntity.travel() (lines 25-53) is a COMPLETE
    // override of LivingEntity.travel() that never subtracts gravity on any branch (water/
    // lava/air) -- the SAME "nothing for the bytecode extractor to MEASURE" shape vex/
    // evoker_fangs above already document, not a fresh finding. Phantom's own vertical motion
    // comes entirely from `NS.Phantom.PhantomMoveControl.tick()` (07zz1_phantom.js, a verbatim
    // port of PhantomEntity.PhantomMoveControl.tick(), .decomp lines 371-397) writing e.vx/vy/vz
    // directly every tick, dispatched through the SAME `e.flyMove` slot vex/parrot/bee already
    // use (07i_entitylist.js's own `if (e.flyMove) e.flyMove.tick();` below, then
    // `NS.Fly.travelMob(e)`, which itself only skips gravity when `e.noGravity` is set --
    // `Ai.ROSTER.phantom` sets it, matching FlyingEntity's own zero-gravity travel).
    if (bare === 'phantom') return [0, 1];
    // loop/donkey-s96 (QUEUE 0.2 G18e remainder close) -- donkey/mule are not in
    // `D.entities.motion` at all: no `.jar` is present in this worktree for
    // `extract-entity-motion.mjs` to re-measure them from (same standing gap the `potion`/
    // `evoker_fangs` hardcodes above already document). `AbstractDonkeyEntity`/`DonkeyEntity`/
    // `MuleEntity`/their common ancestor `HorseBaseEntity` (.decomp, all four read in full this
    // pass) override neither `getGravity()` nor any drag-affecting tick method, so they fall
    // through to the SAME plain-`MobEntity` default `horse` itself was measured at, immediately
    // below in this same table (`[0.08, 0.98]`) -- named off that shared ancestry, not guessed.
    if (bare === 'donkey' || bare === 'mule') return [0.08, 0.98];
    // D-533 (G18c) -- BatEntity (.decomp, read in full) overrides neither getGravity() nor any
    // drag method; its own vy*0.6 lives in tick() (Bat.postTick, 07zf_bat.js). Same plain-
    // MobEntity row as donkey/mule above, off the same shared-ancestry rule.
    if (bare === 'bat') return [0.08, 0.98];
    // loop/enderman-s98 -- EndermanEntity (.decomp, read in full, 609 lines: class + its
    // four inner Goal classes) overrides neither getGravity() nor any drag-affecting tick
    // method -- entity-motion-1.18.2.tsv's own header lists it under 'owed' (never
    // bytecode-measured), not under a real override, so this is the SAME shared-ancestry
    // fallback zombie/skeleton/spider/creeper WERE measured at ([0.08, 0.98]), applied here
    // off a full source read rather than a re-measurement.
    if (bare === 'enderman') return [0.08, 0.98];
    // Dan's scheduled parallel night, QUEUE 0.2 (G18c) -- PolarBearEntity (.decomp, read
    // in full) overrides neither getGravity() nor any drag-affecting tick method (only
    // tick()'s own warning-animation/anger halves, both no-ops for motion) -- not in
    // D.entities.motion either (no bytecode re-measurement this session), so this is the
    // SAME plain-MobEntity fallback enderman/bat/donkey/mule already share above.
    if (bare === 'polar_bear') return [0.08, 0.98];
    // s101 -- MooshroomEntity extends CowEntity and overrides no gravity/drag method (.decomp,
    // read whole): it moves on cow's own measured row, read live rather than copied.
    if (bare === 'mooshroom') return EL.motionFor('cow');
    // loop/zvillager-s102 (QUEUE 0.2 G18 mobs) -- ZombieVillagerEntity (.decomp, read whole)
    // overrides neither getGravity() nor any drag-affecting tick method (its own tick() override
    // is ONLY the conversion-timer half, .decomp:131-140) -- not in entity-motion-1.18.2.tsv's
    // own 'owed' list (no bytecode re-measurement this session), so this reads zombie's own
    // measured row live, the SAME shared-ancestry fallback mooshroom/husk use above.
    if (bare === 'zombie_villager') return EL.motionFor('zombie');
    // loop/rabbit-s98 (QUEUE 0.2 G18c) -- rabbit is ALSO not in `D.entities.motion`
    // (`tools/extract-entity-motion.mjs`'s own golden TSV has no row for it, same standing
    // gap named for donkey/mule/llama/bat immediately above -- `assets/` is this repo's SHARED,
    // not per-worktree, so re-running that extractor here would rewrite every other worker's
    // data too, which is out of this unit's own scope). `RabbitEntity` (.decomp, read in full
    // for this unit) overrides neither `getGravity()` nor any drag-affecting tick method, so
    // it falls through to the same plain-`MobEntity` row bat/donkey/mule already share.
    if (bare === 'rabbit') return [0.08, 0.98];
    // loop/fox-s99 (QUEUE 0.2 G18c) -- fox is ALSO not in `D.entities.motion` (no .jar in
    // this worktree to re-measure it from, same standing gap named for bat/donkey/mule/
    // rabbit above). `FoxEntity` (.decomp, read in full) overrides neither `getGravity()`
    // nor any drag-affecting tick method, so it falls through to the same plain-`MobEntity`
    // row every other unmeasured ground animal above already shares.
    if (bare === 'fox') return [0.08, 0.98];
    // loop/goat-s99 (QUEUE 0.2 G18c) -- goat is ALSO not in `D.entities.motion`
    // (`tools/golden/entity-motion-1.18.2.tsv`'s own `# owed` line names it, same standing gap
    // named for rabbit/bat/donkey/mule immediately above). `GoatEntity` (.decomp, read in full
    // this pass) overrides neither `getGravity()` nor any drag-affecting tick method --
    // `tickMovement()`'s own override only counts the ram-charge windup counter before calling
    // `super.tickMovement()` -- so it falls through to the same plain-`MobEntity` row those
    // types already share.
    if (bare === 'goat') return [0.08, 0.98];
    // loop/panda-axolotl-s101 (QUEUE 0.2 G18c) -- panda is ALSO not in D.entities.motion
    // (same standing gap named for rabbit/fox/goat immediately above). PandaEntity (.decomp,
    // read in full) overrides neither getGravity() nor any drag-affecting tick method, so it
    // falls through to the same plain-MobEntity row those types already share.
    if (bare === 'panda') return [0.08, 0.98];
    // loop/silverfish -- SilverfishEntity (.decomp/net/minecraft/entity/mob/SilverfishEntity.
    // java, read in full) overrides neither getGravity() nor any drag-affecting tick method
    // (its own tick() override is ONLY the bodyYaw-follows-yaw line, .decomp:112-115) -- the
    // SAME plain-MobEntity fallback every other un-overridden ground mob in this table shares.
    if (bare === 'silverfish') return [0.08, 0.98];
    // s115 -- EndermiteEntity (.decomp, read in full) overrides neither getGravity() nor any
    // drag-affecting tick method (tick() is only bodyYaw = yaw, :107-110): plain MobEntity row.
    if (bare === 'endermite') return [0.08, 0.98];
    // loop/panda-axolotl-s101 (QUEUE 0.2 G18c) -- AxolotlEntity (.decomp, read in full)
    // overrides neither getGravity() nor any drag-affecting tick method either -- its own
    // travel() bypasses the standard gravity/drag pipeline ENTIRELY while submerged (a direct
    // updateVelocity()+move()+*0.9 drag write, the SAME shape SquidEntity's own tickMovement
    // already documents as inert-motion-pair territory, 07zi_squid.js's own header) and falls
    // back to plain MobEntity motion on land. This engine's generic gravity/drag pipeline has
    // no per-type "different rule while wet" branch (Ax.OWED names this) -- the plain
    // MobEntity row is what applies HERE for both cases, which is exactly right on land and an
    // approximation in water (an axolotl sinks/rises like a normal falling mob rather than
    // gliding with its own 0.9 in-water drag).
    if (bare === 'axolotl') return [0.08, 0.98];
    // QUEUE 0.2 (G18 mobs) -- bee is ALSO not in D.entities.motion (same standing gap named
    // for axolotl/panda/goat/fox/rabbit immediately above). BeeEntity (.decomp, read in full)
    // overrides neither getGravity() nor any drag-affecting tick method -- and its own flight
    // (e.flyMove, EL.DEFAULTS.bee below) sets `noGravity` dynamically while airborne anyway,
    // so this fallback only matters the rare tick a bee is NOT under active MoveControl.
    if (bare === 'bee') return [0.08, 0.98];
    // loop/llama-s97 (QUEUE 0.2 G18e remainder close) -- llama is ALSO not in
    // D.entities.motion (no .jar in this worktree to re-measure it from, same standing gap as
    // donkey/mule immediately above); LlamaEntity (.decomp, read in full this pass) overrides
    // neither getGravity() nor any drag-affecting tick method either, so it falls through to
    // the SAME plain-MobEntity default, off the identical AbstractDonkeyEntity ancestry.
    if (bare === 'llama' || bare === 'trader_llama') return [0.08, 0.98];
    // loop/wtrader-s103 -- WanderingTraderEntity (.decomp, read in full) overrides neither
    // getGravity() nor any drag-affecting tick method either -- the same plain-MobEntity
    // default llama/donkey/mule/slime already fall through to two lines up/down,
    // `entity-motion-1.18.2.tsv`'s own `# owed` line names it too (no .jar in this worktree
    // to re-measure it from -- the same standing gap, not a fresh one).
    if (bare === 'wandering_trader') return [0.08, 0.98];
    // `LlamaSpitEntity.tick()` (.decomp, loop/llama-s97) applies its own gravity/drag inline
    // rather than through ProjectileEntity's fields -- `Ll.GRAVITY`/`Ll.DRAG` (07ze_llama.js)
    // read live here rather than a second literal copy, the same convention `potion`'s own
    // hardcode two rows up already uses for `Po.GRAVITY`/`Po.DRAG_AIR`.
    if (bare === 'llama_spit') return NS.Llama ? [NS.Llama.GRAVITY, NS.Llama.DRAG] : [0.06, 0.99];
    // loop/slime-s97 (QUEUE 0.2 G18c) -- `slime`/`magma_cube` are NOT in
    // `D.entities.motion` either: `tools/golden/entity-motion-1.18.2.tsv`'s own `# owed` line
    // names both, and for the SAME reason donkey/mule are hardcoded two lines up -- the
    // per-class bytecode search this session's extractor runs finds gravity/drag literals only
    // in a class's OWN `tick()`/`travel()` override, and `SlimeEntity.tick()` (.decomp, read
    // whole) overrides `tick()` only to add its stretch/particle bookkeeping around a plain
    // `super.tick()` call -- it never touches gravity or drag, so it falls through to the SAME
    // un-overridden `MobEntity`/`LivingEntity` default every OTHER measured ground mob in this
    // table shares (cow/zombie/villager/... all read exactly `[0.08, 0.98]` above). Named off
    // that shared ancestry, not guessed -- the identical reasoning donkey/mule's own comment
    // already sets as precedent. `MagmaCubeEntity extends SlimeEntity` and overrides `jump()`/
    // `swimUpward()` only (.decomp, read whole) -- same standing, not currently spawned
    // (`Sl.OWED`: Nether-only spawn rule out of this unit's own scope).
    if (bare === 'slime' || bare === 'magma_cube') return [0.08, 0.98];
    // loop/squid-s98 (QUEUE 0.2 G18c) -- `SquidEntity.travel()` OVERRIDES `LivingEntity.
    // travel()` ENTIRELY (`this.move(SELF, this.getVelocity())`, no friction/gravity/drag at
    // all) and every bit of its own velocity is written by hand in `tickMovement()`
    // (`Sq.tickMovement`, 07zi_squid.js) -- there is NOTHING for the standard gravity/drag
    // pipeline to measure, the SAME shape `vex`/`evoker_fangs` already document two rows up
    // in this same table (a mob that never falls through the ordinary path has no motion row
    // to find, not a missing one). `glow_squid extends SquidEntity` and overrides neither.
    if (bare === 'squid' || bare === 'glow_squid') return [0, 1];
    // loop/fish-s99 (QUEUE 0.2 G18c) -- `FishEntity.travel(Vec3d)` OVERRIDES
    // `LivingEntity.travel()` in the water branch by hand (`updateVelocity`+`move`+`*0.9`,
    // `Fish.travelMob`, 07zj_fish.js); the non-water branch delegates to `Ph.travelMob` from
    // inside that SAME function rather than falling through this generic pipeline, so (like
    // squid) there is nothing for the standard gravity/drag table to measure here either.
    if (bare === 'cod' || bare === 'salmon' || bare === 'pufferfish' || bare === 'tropical_fish') return [0, 1];
    // loop/zombievariants-s100 (QUEUE 0.2 G18c) -- husk/stray/drowned are ALSO not in
    // D.entities.motion (no .jar in this worktree to re-measure them from, same standing gap
    // named for rabbit/fox/goat immediately above). HuskEntity (80 lines), StrayEntity (63
    // lines) and DrownedEntity (494 lines -- travel()/updateSwimming() overridden for
    // NAVIGATION MODE only, see 07zk_undead.js's own header) were ALL read in full this pass
    // and none overrides getGravity() or any drag-affecting tick method, so all three fall
    // through to the SAME plain-MobEntity/ZombieEntity/AbstractSkeletonEntity row their own
    // base classes already share (zombie/skeleton themselves ARE measured at this exact
    // [0.08, 0.98] two rows up in this same table -- husk/stray/drowned simply never got
    // their OWN row from the extractor, off the identical shared-ancestry reasoning donkey/
    // mule/bat/enderman/polar_bear/rabbit/fox/goat's own comments already set as precedent).
    if (bare === 'husk' || bare === 'stray' || bare === 'drowned') return [0.08, 0.98];
    // loop/lightning -- `ZombifiedPiglinEntity` (.decomp/net/minecraft/entity/mob/
    // ZombifiedPiglinEntity.java, read whole) declares no `getGravity()`/drag-affecting
    // override of its own either (ZombieEntity's own subclass, same ancestry as husk/stray/
    // drowned immediately above) -- not in `D.entities.motion` (no bytecode re-measurement
    // this session, the SAME standing gap those three already document), so this was the
    // one missing piece keeping `EL.canSpawn('zombified_piglin')` false (PigEntity's own
    // lightning-strike conversion, `Lgt.convertPig`, needs it to actually spawn one).
    if (bare === 'zombified_piglin') return [0.08, 0.98];
    // D-673 (KW-32) -- `WitherSkeletonEntity` (.decomp, read whole: 116 lines) overrides no
    // `travel`/gravity/drag method; it extends `AbstractSkeletonEntity` exactly as `stray` does,
    // so it takes `skeleton`'s own MEASURED row (`D.entities.motion.skeleton`), the SAME
    // "no override means no fork" reasoning cave_spider -> spider uses below.
    // s133 (KW-32) -- `PiglinEntity`/`PiglinBruteEntity`/`AbstractPiglinEntity` (.decomp, read whole)
    // override no `travel`/gravity/drag method: the plain HostileEntity row zombie/skeleton measure.
    if (bare === 'piglin' || bare === 'piglin_brute') return [0.08, 0.98];
    // s134 (KW-32) -- `HoglinEntity` (AnimalEntity) / `ZoglinEntity` (HostileEntity) (.decomp, read
    // whole) override no `travel`/gravity/drag method: the same plain row.
    if (bare === 'hoglin' || bare === 'zoglin') return [0.08, 0.98];
    // loop/giant (QUEUE 0.00 part 2, G18 leftover) -- `GiantEntity extends HostileEntity`
    // (.decomp/net/minecraft/entity/mob/GiantEntity.java, read whole: 33 lines -- only
    // `getActiveEyeHeight`/`createGiantAttributes`/`getPathfindingFavor` are overridden, no
    // `initGoals`, no `getGravity()`, no drag-affecting tick method) overrides no motion
    // method of its own, the SAME "no override means no fork" shape piglin/hoglin/zoglin/
    // shulker above already use, off `MobEntity`'s own plain row. (Its own render-time 6x
    // scale -- `ER.RENDER_SCALE.giant`, EntityRenderers.java `new GiantEntityRenderer($$0,
    // 6.0F)` -- and its 3.6x12 hitbox, `entity-types-1.18.2.tsv`'s own `giant` row -- were
    // already wired; this motion row was the one thing keeping `EL.canSpawn('giant')` false.)
    if (bare === 'giant') return [0.08, 0.98];
    // cloud unit (confident-lamport-asj6ue) -- `ShulkerEntity extends GolemEntity extends
    // PathAwareEntity extends MobEntity` (.decomp, all three read whole: 741/47/81 lines)
    // overrides neither `getGravity()` nor any drag-affecting tick method -- the SAME "no
    // override means no fork" shape piglin/hoglin/zoglin above already use, off `MobEntity`'s
    // own plain row. Shulker's real vanilla stillness (it does not walk; `initGoals` carries no
    // move goal at all) is a GOAL-SELECTOR fact, not a motion one -- this row only makes it fall
    // like any other ungrounded golem until G18b's own AI stage gives it somewhere to attach.
    if (bare === 'shulker') return [0.08, 0.98];
    // cloud unit (confident-lamport-mdnl4x) -- `WitherEntity extends HostileEntity` (.decomp,
    // read whole: 571 lines) overrides neither `getGravity()` nor any drag-affecting tick method
    // ITSELF. Its real vanilla flight comes from `FlightMoveControl.tick()` (.decomp, read
    // whole) calling `this.entity.setNoGravity(true)` dynamically while actively steering it,
    // and `setNoGravity(false)` again once idle (the constructor passes `false` for the
    // control's own permanent-no-gravity flag: `new FlightMoveControl(this, 10, false)`) --
    // the SAME "no class-level override, an AI stage's move-control toggles it dynamically"
    // shape `shulker`'s own row two lines up already documents (that row predates shulker's own
    // wall-attach AI landing; this unit is the identical motion-substrate-before-AI slice for
    // wither, D-773's own staged-slice precedent). No AI/move-control exists for wither in this
    // engine yet (out of this unit's own scope) -- this plain-MobEntity fallback only makes
    // `EL.canSpawn('wither')` true; it will fall like any other ungrounded mob until a future
    // stage gives it real flight AI.
    if (bare === 'wither') return [0.08, 0.98];
    // loop/blazeghast -- `BlazeEntity` (.decomp, read whole) overrides neither `getGravity()`
    // nor any drag-affecting tick method (its own `tickMovement` override only DAMPS vy while
    // falling, `Bl.mobTick`'s own job, 07zzh_blaze.js) -- the same plain-MobEntity row.
    if (bare === 'blaze') return [0.08, Math.fround(0.98)];   // #6964: LivingEntity.travel drag is the float 0.98F (lockstep salt 0 pitch, tick 4)
    // loop/blazeghast -- `GhastEntity extends FlyingEntity` (.decomp: neither class overrides
    // gravity) -- `[0, 1]` is the SAME zero-gravity/no-decay pair vex/phantom already use above
    // (a flying mob's real motion is `e.flyMove`'s own `Fl.travelMob`, dispatched off `e.flyMove`
    // rather than this pair -- this pair exists only so `EL.canSpawn('ghast')` is true).
    if (bare === 'ghast') return [0, 1];
    // loop/blazeghast -- `AbstractFireballEntity`/`ExplosiveProjectileEntity` (.decomp, read
    // whole): NOT gravity at all -- a constant `power` vector is ADDED to velocity every tick,
    // then the sum is multiplied by drag. `Bl.Fireball.tickSmall`/`Gh.tickFireball`
    // (07zzh_blaze.js/07zzi_ghast.js) own that add-and-multiply directly; `[0, 1]` here is the
    // SAME "exists only so canSpawn is true, the real motion is a bespoke per-tick hook" shape
    // `ghast`'s own row immediately above already uses.
    if (bare === 'fireball' || bare === 'small_fireball') return [0, 1];
    // QUEUE 0.00 part 2 (G18 leftover, D-787) -- `WitherSkullEntity extends
    // ExplosiveProjectileEntity` (.decomp, read whole): NOT gravity at all, the SAME constant-
    // power-vector-then-drag shape the fireball pair immediately above already documents --
    // `Wi.tickSkull` (07zzm_wither.js) owns that add-and-multiply directly. `[0, 1]` here exists
    // only so `EL.canSpawn('wither_skull')` is true.
    if (bare === 'wither_skull' || bare === 'dragon_fireball') return [0, 1];   // dragon_fireball: same power-then-drag shape, ED.tickDragonFireball
    // cloud unit (confident-lamport-nq63qx) -- `ShulkerBulletEntity` (.decomp, read whole): its
    // own `tick()` blends velocity toward a periodically-replanned waypoint (`Sh.tickBullet`,
    // 07zzk_shulker.js) rather than adding a constant power vector, but the SHAPE is the same as
    // the fireball rows immediately above -- `[0, 1]` here exists only so `EL.canSpawn` is true;
    // the real motion is entirely the bespoke per-tick hook's job. The bullet's OWN measured
    // gravity (`entity-motion-1.18.2.tsv`'s `shulker_bullet` row, 0.04) is excluded from the
    // packed runtime table because its drag column is empty (`pack-entities.mjs`'s "BOTH
    // gravity and drag" gate) -- `Sh.tickBullet` reads the literal directly (`Sh.BULLET_GRAVITY`,
    // cited from `.decomp` there) for the one no-target fallback branch that actually uses it.
    if (bare === 'shulker_bullet') return [0, 1];
    // s135 (KW-33) -- StriderEntity (.decomp, read in full) overrides neither getGravity()
    // nor any drag-affecting tick method (AnimalEntity/MobEntity default) -- not in
    // entity-motion-1.18.2.tsv's own 'owed' list (no bytecode re-measurement this session),
    // same shared-ancestry fallback enderman/donkey/mule/bat/polar_bear use above.
    if (bare === 'strider') return [0.08, 0.98];
    // s135 (KW-33) -- ElderGuardianEntity extends GuardianEntity (.decomp, read whole) and
    // overrides neither getGravity() nor any drag method -- reads guardian's own measured
    // row live, the SAME shared-ancestry fallback mooshroom/zombie_villager use above.
    if (bare === 'elder_guardian') return EL.motionFor('guardian');
    if (bare === 'wither_skeleton') { var wm = D && D.entities && D.entities.motion; return (wm && wm.skeleton) || [0.08, 0.98]; }
    // loop/spawner-s114 (G18c) -- `CaveSpiderEntity` (.decomp, read whole: 55 lines --
    // `createCaveSpiderAttributes`/`tryAttack`/`initialize`/`getActiveEyeHeight` and
    // nothing else) declares no `travel`/gravity-affecting override of its own, the SAME
    // "no override means no fork" reasoning husk/stray/drowned just above already use --
    // it falls through to `SpiderEntity`'s own measured row (`spider`, D-390's own
    // [0.08, 0.98], two rows up in `D.entities.motion`) rather than its superclass's.
    if (bare === 'cave_spider') { var sm = D && D.entities && D.entities.motion; return (sm && sm.spider) || [0.08, 0.98]; }
    // loop/lightning -- `SkeletonHorseEntity`/`ZombieHorseEntity` (.decomp/net/minecraft/
    // entity/mob/{Skeleton,Zombie}HorseEntity.java, both read in full) and their common
    // ancestor `HorseBaseEntity` (.decomp/net/minecraft/entity/passive/HorseBaseEntity.java,
    // read in full) override neither `getGravity()` nor any drag-affecting tick method --
    // the SAME "no override means no fork" reasoning `cave_spider` immediately above uses,
    // falling through to `HorseEntity`'s own MEASURED row (`horse`, tools/golden/
    // entity-motion-1.18.2.tsv:43, a conditional-generic call chain resolving to the plain
    // [0.08, 0.98] LivingEntity default) rather than a second bytecode measurement.
    if (bare === 'skeleton_horse' || bare === 'zombie_horse') { var hm = D && D.entities && D.entities.motion; return (hm && hm.horse) || [0.08, 0.98]; }
    // loop/snowgolem -- `SnowGolemEntity` (.decomp/net/minecraft/entity/passive/
    // SnowGolemEntity.java, read in full) overrides neither `getGravity()` nor any
    // drag-affecting tick method -- the SAME plain-MobEntity fallback every other
    // un-overridden ground mob in this table shares.
    if (bare === 'snow_golem') return [0.08, 0.98];
    // armor_stand -- G17b-4: no hand row any more; it is a bytecode-verified conditional-generic row
    // in entity-motion-1.18.2.tsv (ArmorStandEntity.travel is `if (canClip()) super.travel(v)`).
    // loop/snowgolem -- `SnowballEntity extends ThrownItemEntity extends ThrownEntity`
    // (.decomp, all three read in full) overrides no gravity/drag method of its own;
    // `ThrownEntity.getGravity()` returns a literal `0.03F` (.decomp ThrownEntity.java:87-89)
    // and `ThrownEntity.tick()`'s own non-water branch multiplies velocity by `0.99F`
    // (ThrownEntity.java:79-83) -- egg/potion/experience_bottle/ender_pearl share this SAME
    // ancestor row (all `# owed` in entity-motion-1.18.2.tsv, none independently re-measured
    // this session; PotionEntity is the ONE exception -- it overrides getGravity() to its
    // own literal 0.05F, `Po.GRAVITY`'s own header, 07z_potion.js -- so it is NOT reused here).
    if (bare === 'snowball') return [Math.fround(0.03), Math.fround(0.99)];   // 0.03F / 0.99F: floats widened to double (pearl lane #6312)
    // loop/throwables-s116 -- `EggEntity`/`EnderPearlEntity` (.decomp, both read in full)
    // are `ThrownItemEntity extends ThrownEntity` the SAME as `SnowballEntity` two lines
    // above and override neither `getGravity()` nor any drag-affecting method -- the SAME
    // base `ThrownEntity.getGravity()` 0.03F / `tick()`'s own non-water 0.99F pair, reused
    // rather than re-derived (both are `# owed` in entity-motion-1.18.2.tsv, same standing
    // gap this file's own header already names for `snowball`).
    if (bare === 'egg') return [Math.fround(0.03), Math.fround(0.99)];
    if (bare === 'ender_pearl') return [Math.fround(0.03), Math.fround(0.99)];
    // #5083 -- EyeOfEnderEntity.tick sets its own velocity every tick and never calls move/gravity: zero-motion row.
    if (bare === 'eye_of_ender') return [0, 1];
    // loop/throwables-s116 -- `AreaEffectCloudEntity` (.decomp, read in full): its own ctor
    // sets `this.noClip = true` and its `tick()` override never calls any move/gravity
    // method at all -- a stationary entity, the SAME zero-motion shape `evoker_fangs`'s own
    // hardcode two screens up already documents (drag 1 rather than 0.99 because nothing
    // here ever gives it a velocity to decay).
    if (bare === 'area_effect_cloud') return [0, 1];
    // #5081 -- FireworkRocketEntity moves itself (NS.Firework.tick: *1.15 horizontally, +0.04 vertically); no gravity row.
    if (bare === 'firework_rocket') return [0, 1];
    // loop/endcrystal-entity -- `EndCrystalEntity` (.decomp, read whole) never calls any
    // move/gravity method either (no `travel()` override needed since none of `Entity`'s
    // own base ticking calls one for it) -- the SAME stationary-entity shape
    // `area_effect_cloud` immediately above already documents; a placed end crystal never
    // moves on its own.
    if (bare === 'end_crystal') return [0, 1];
    // G17-HG1 -- AbstractDecorationEntity children never move (move/addVelocity break them: NS.Hanging).
    if (bare === 'painting' || bare === 'item_frame' || bare === 'glow_item_frame') return [0, 1];
    // loop/enderdragon-wiring -- `EnderDragonEntity.tickMovement()` (.decomp, read whole)
    // never calls `travel()`/`super.tickMovement()` and never subtracts a gravity constant on
    // any branch -- ED.OWED item 1's own header (src/07zzl_enderdragon.js) names this in full.
    // `[0, 1]` here is the SAME "exists only so `EL.canSpawn` is true; the real motion is a
    // bespoke per-tick hook" shape `ghast`/the fireball rows above already use -- the hook
    // itself is `NS.EnderDragon.tickEntity` (dispatched from `EL.tickMob`'s own mobTick slot,
    // below), which now bridges `ED.EnderDragonEntity.prototype.tickMovement`'s already-ported
    // PhaseManager/motion blend onto this live `e`, WRITING e.x/y/z/yaw/vx/vy/vz directly --
    // `EL.tickMob`'s own generic `Ph.travelMob` fallback is skipped for this type for exactly
    // that reason (see the travel-law dispatch below), the SAME "dispatched above, excluded
    // from the generic fallback" shape squid/fish already use.
    if (bare === 'ender_dragon') return [0, 1];
    var m = D && D.entities && D.entities.motion;
    return (m && E && m[bare]) || null;
  };

  /**
   * The ON-GROUND half of a type's motion — `{ m, k, dy, f, b, g, rs }` — or null (D-427).
   *
   * ⚠⚠ **NULL HERE IS NOT A HOLE.** `motionFor` returning null means "never measured, refuse
   * to simulate"; THIS returning null means "vanilla's tick has no on-ground branch at all",
   * which is the truth for an arrow and for every mob (a mob travels through `Ph.travelMob`,
   * which has its own friction). The two nulls read the same and mean opposite things, so the
   * table is packed with only the four types that HAVE the branch and the rest are silent.
   */
  EL.groundFor = function (type) {
    var D = NS.DATA, E = NS.Entities;
    var g = D && D.entities && D.entities.ground;
    return (g && E && g[E.bare(type)]) || null;
  };

  EL.canSpawn = function (type) { return !!EL.motionFor(type); };

  /** Every type this engine is ABLE to simulate, sorted. The closed set. */
  EL.spawnable = function () {
    var D = NS.DATA;
    var m = (D && D.entities && D.entities.motion) || {};
    return Object.keys(m).sort();
  };
  /** The three types still refused, each with the stage that closes it (G17b-7). Not a default:
   *  none has a verified unconditional-tick gravity/drag row in entity-motion-1.18.2.tsv. */
  EL.OWED_STAGE = {
  };
  /** Every type it is NOT, which is the list a future stage has to shorten. */
  EL.owed = function () {
    var E = NS.Entities;
    if (!E || !E.ready) return [];
    // canSpawn, not the table alone: motionFor's own hardcoded zero-motion pairs spawn too (G17b-6)
    return E.all().filter(function (n) { return !EL.canSpawn(n); });
  };

  /**
   * spawn(type, x, y, z) — a new entity at the FEET position, or null if this engine has no
   * measured motion for that type. See the header: the refusal is the point.
   */
  /** `MathHelper.randomUuid(random)`: 4 ints as 'a-b-c-d' hex, from a seeded xorshift (deterministic per run, unique per entity). */
  EL.uuidSeed = 0x9e3779b9;
  EL.newUuid = function () {
    var parts = [];
    for (var i = 0; i < 4; i++) {
      var x = EL.uuidSeed | 0;
      x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
      EL.uuidSeed = x;
      parts.push((x >>> 0).toString(16) + (EL.nextId * 2654435761 >>> 0).toString(16).slice(-3));
    }
    return parts.join('-');
  };
  /** `ServerWorld.getEntity(uuid)`: the live entity with this uuid, or null. */
  EL.byUuid = function (u) {
    if (!u) return null;
    if (NS.Player && NS.Player.uuid === u) return NS.Player;
    for (var i = 0; i < EL.list.length; i++) { var e = EL.list[i]; if (e && !e.removed && e.uuid === u) return e; }
    return null;
  };
  EL.spawn = function (type, x, y, z, opts) {
    if (!EL.ready) return null;
    var E = NS.Entities;
    var name = E.bare(type);
    var dim = E.dimensions(name);
    var mot = EL.motionFor(name);
    if (!dim || !mot) return null;
    // G17-L7: Entity.<init> `new Random()` -- one JRandom per entity, seeded from (world seed, spawn counter).
    var rseed = NS.JRandom ? new NS.JRandom(BigInt.asIntN(64, ((NS.World && NS.World.seed64) || 0n) * 6364136223846793005n + BigInt(EL.spawnCounter = (EL.spawnCounter | 0) + 1) * 0x9E3779B97F4A7C15n)) : null;
    if (EL.entitySeed && NS.JRandom) { var fs = EL.entitySeed(name); if (fs instanceof NS.JRandom) rseed = fs; }   // lockstep (#6964): the lane pins the server's per-entity seed
    var e = {
      random: rseed,
      id: EL.nextId++,
      uuid: (opts && opts.uuid) || EL.newUuid(),   // Entity.uuid: stable across save/load, unlike the run-local id
      type: name,
      dimension: (opts && opts.dimension) || (NS.World && NS.World.dimension) || 'overworld',   // #254: Entity.world's dimension key
      x: x, y: y, z: z,
      px: x, py: y, pz: z,          // the previous tick, for the renderer's interpolation (D-79)
      vx: 0, vy: 0, vz: 0,
      // ⚠ G18c step 1 (PASS 16's own precondition): a MOB entity needs a facing direction
      // to pose `ER.emitMobLayer`'s yaw rotation. Nothing ticks this yet -- G18b (pathing/AI)
      // is not built -- so it is a fixed 0 (facing +Z, the jar's own default heading) until
      // that stage exists to turn it. Not interpolated for the same reason: interpolating a
      // value nothing ever changes would be a vacuous claim, not a feature.
      yaw: 0,
      // D-415 — the walk cycle's state, ticked in `EL.tickOne` and read by `ER.build`.
      animSpeed: 0, animSpeedO: 0, animPos: 0,
      width: dim.width,
      height: dim.height,
      gravity: mot[0],
      drag: mot[1],
      // D-427 — the on-ground law, or null for a type whose tick has no on-ground branch.
      ground: EL.groundFor(type),
      onGround: false,
      // ⚠ NOT A LIVING ENTITY, and `Ph.move` needs to be told (D-308). Fall damage, the slime
      // bounce and the bed bounce are `LivingEntity.checkFallDamage`'s; base `Entity` only
      // resets the counter. Until this flag existed, `Ph.move` ran the player's landing path
      // for anything that touched the ground.
      living: false,
      fallDistance: 0,
      age: 0,
      removed: false
    };
    // ⚠⚠ **HEALTH, AND ONLY FOR THE TYPES THE JAR SAYS HAVE IT** (D-336). 74 of the 113 types
    // resolve a max health through their class chain and 38 do not; `Entities.isLiving` is that
    // question and nothing else. An entity with no `maxHealth` cannot be hurt, cannot be knocked
    // back and cannot be attacked — which is exactly vanilla, where an arrow or a boat is not a
    // `LivingEntity`. ⚠ The FIELD is `maxHealth`, not the `living` flag three lines above it:
    // that one is `Physics.move`'s fall-damage switch and answering a different question with it
    // is how D-308 happened.
    var at = E.attrsOf ? E.attrsOf(name) : null;
    if (at) {
      e.maxHealth = at.hp;
      e.health = at.hp;
      e.hurtTime = 0;              // LivingEntity.hurtTime — the red flash, 10 ticks
      e.invulnerableTime = 0;      // LivingEntity.invulnerableTime — the half-second grace
      e.lastHurt = 0;              // the damage that grace was granted for
      e.deathTime = 0;
      e.knockbackResistance = at.kbRes || 0;
    }
    // ⚠ A FALLING BLOCK CARRIES THE STATE IT FELL FROM, and G17c DRAWS that state. Before this
    // the list held motion and nothing else, so every falling block was the same nothing.
    if (opts) {
      if (opts.state !== undefined) e.state = opts.state | 0;
      if (opts.item !== undefined) e.item = opts.item;
      if (opts.tileEntityData && type === 'falling_block') e.tileEntityData = opts.tileEntityData;
      if (opts.count !== undefined) e.count = opts.count | 0;
      if (opts.mobNbtRestore && type === 'item') { if (opts.age !== undefined) e.age = opts.age | 0; if (opts.pickupDelay !== undefined) e.pickupDelay = opts.pickupDelay | 0; if (opts.health !== undefined) e.health = opts.health | 0; if (opts.itemOwner !== undefined) e.itemOwner = opts.itemOwner; if (opts.thrower !== undefined) e.thrower = opts.thrower; }
      if (opts.tag) e.tag = opts.tag;                 // an item entity's stack tag (ItemStack NBT)
      if (opts.fuse !== undefined) e.fuse = opts.fuse | 0;
      if (opts.igniter) e.igniter = opts.igniter;   // TntEntity.causingEntity
      if (opts.vx !== undefined) { e.vx = opts.vx; e.vy = opts.vy || 0; e.vz = opts.vz || 0; }
      // D-402 — the live arrow's own shooter, so `Combat.tickArrow` can refuse to hit the mob
      // that fired it and can credit a kill correctly. Not persisted (`16b_save.js`'s own gap,
      // unchanged this session — an entity reference cannot round-trip through JSON as-is).
      if (opts.shooter !== undefined) e.shooter = opts.shooter;
      if (opts.shooter && NS.GameEvent && /^(arrow|spectral_arrow|trident|snowball|egg|ender_pearl|fireball|small_fireball|potion|experience_bottle)$/.test(name))
        NS.GameEvent.emit('projectile_shoot', opts.shooter.x, opts.shooter.y, opts.shooter.z, opts.shooter);   // emitGameEvent(PROJECTILE_SHOOT, user)
      // loop/zombievariants-s100 (QUEUE 0.2 G18c) -- `stray`'s own `createArrowProjectile`
      // override (.decomp StrayEntity.java, read whole): every arrow it fires carries a
      // Slowness(600) effect. `Cb.mobShootTrident`/`Cb.mobShoot`-side (14j_combat.js,
      // 07zk_undead.js) pass it through here as a plain {effect, duration, amplifier} bag,
      // read back by `Cb.tickArrow` on a landed hit -- the SAME "caller supplies the
      // jar-specific consequence" shape `opts.shooter` immediately above already uses.
      if (opts.tip !== undefined) e.tip = opts.tip;
    }
    // loop/nbtsave-s104 (Mnt.OWED's entity-NBT-persistence entry) -- ONE generic copy-through
    // for every persisted-NBT field this species has (07zw_mobnbt.js's own per-species list),
    // run BEFORE EL.DEFAULTS so a reloaded value reads exactly like spawner-supplied data --
    // the SAME "opts wins over a fresh roll" rule `opts.state`/`opts.shooter` above and
    // `opts.type`/`opts.variant`/`opts.mainGene` throughout EL.DEFAULTS already use, generalised
    // to a table instead of one bespoke `if` per field. This is the ONE hook 16b_save.js's
    // reload path needs; the per-field skip-if-already-set guards a loaded value then relies on
    // live in each DEFAULTS entry (`e.tamed === undefined`, `e.rabbitType !== undefined return`,
    // `Mnt.rollAttributes`'s own `e.maxHealthAttr !== undefined` short-circuit, etc.) were
    // already there for the "egg/command spawn forces a value" case -- a reload is the same case
    // with a save file standing in for the caller.
    if (opts && NS.MobNbt && NS.MobNbt.fieldsFor) {
      var nbtFields = NS.MobNbt.fieldsFor(name);
      for (var nfi = 0; nfi < nbtFields.length; nfi++) {
        var nfk = nbtFields[nfi];
        if (opts[nfk] !== undefined) e[nfk] = opts[nfk];
      }
    }
    EL._spawnReason = (opts && opts.spawnReason) || null;   // D-671: read by mobStateDefaults' patrol roll
    if (EL.STEP_ONE[name]) { e.stepHeight = 1.0; e.maxUpStep = 1.0; }   // ctor `this.stepHeight = 1.0F` (#2617 audit of .decomp)
    if (EL.DEFAULTS[name]) EL.DEFAULTS[name](e, opts || {});
    // loop/mobdefaults (referee finding b) — after the per-type DEFAULTS (a saved
    // `canPickUpLoot`/`persistent` already landed above, via the same NBT copy-through block
    // this hook sits just below) so a reload never gets re-rolled, same "opts wins" rule.
    EL.mobStateDefaults(e, name, at);
    // D-672 — `ZombieEntity.initialize` (.decomp:431-436): with no EntityData handed in, EVERY
    // initialize path (natural, /summon, spawn egg, spawner, reinforcement) rolls
    // `shouldBeBaby` (5%) — it lived only in the natural spawner (07l_spawn.js), so a summoned or
    // egg zombie was never a baby. Skipped for a conversion (`convertTo` copies the old mob's own
    // baby state, no initialize) and for a caller/save that already fixed the age.
    if (EL.ZOMBIE_BABY_ROLL[name] && NS.Undead && NS.Undead.rollBaby && !(opts && (opts.conversion || opts.mobNbtRestore || opts.growAge !== undefined))
        && !((e.growAge | 0) < 0) && NS.Undead.rollBaby(EL.randomOf(e))) {
      if (NS.Breed && NS.Breed.ready && NS.Breed.setBaby) NS.Breed.setBaby(e, true); else e.growAge = -24000;
    }
    // D-391 — G18b's live wiring: a mob type `Ai.ROSTER` covers (cow, zombie) is born with the
    // real goal selector attached, built against THIS world's own live state (`EL.aiCtx`), not
    // the synthetic fixture `goalcheck.mjs` uses. Any other type gets no `e.ai` and `EL.tickOne`
    // skips it — the same refusal-over-guessing shape `EL.spawn` already uses for motion (see
    // the file header): a mob with no rostered goals should look inert, not silently plausible.
    if (NS.Ai && NS.Ai.ready && NS.Ai.ROSTER && NS.Ai.ROSTER[name]) {
      e.ai = NS.Ai.selectorFor(e, EL.aiCtx(e));
    }
    EL.list.push(e);
    return e;
  };

  /**
   * The live context a spawned mob's goals see — D-391. Every function here reads THIS TICK's
   * world state; none of them snapshot a value, because a goal that captured a stale copy of
   * the player's position would chase where the player used to stand (D-276's join, found while
   * wiring this rather than left for a check to catch).
   *
   * ⚠ `players()` returns `NS.Player` ITSELF, not a copy — `Ai.NearestAttackableTargetGoal` and
   * `Ai.HurtByTargetGoal` keep the object they were given as `e.target` between ticks, so only a
   * live reference keeps a chase aimed at where the player actually is now. This engine has
   * exactly one player; the day it has more, this returns the list, unchanged elsewhere.
   *
   * ⚠ WHAT IS STUBBED, AND NAMED RATHER THAN GUESSED (see `Ai.OWED`): `isTempting` always
   * refuses (which items tempt which mob is jar data, `Animal.isFood`, not yet extracted) and
   * `onBreed` does nothing (breeding itself — a baby, consuming love mode, the XP drop — is a
   * separate G18 stage). Both goals are wired so the getting-there half is real the day either
   * gap closes; neither is exercised in play today because `canUse` can never go true for them.
   */
  EL.aiCtx = function (e) {
    return {
      random: EL.randomOf(e),   // the mob's own stream; looked up per call, not bound at ctx-build time
      players: function () { return NS.Player ? [NS.Player] : []; },
      skyAngle: function () { var Sk = NS.Sky; return Sk && Sk.timeOfDay ? Sk.timeOfDay(Sk.dayTime || 0) : 0; },   // #1316 CatEntity morning gift: world.getSkyAngle(1)
      dropGift: function (x, y, z, item) { EL.spawn('item', x, y, z, { item: item, count: 1 }); },   // new ItemEntity(...) at the cat's feet, no pop velocity
      // every live entity + the player (goat RAM_TARGET_PREDICATE: any attackable LivingEntity)
      livings: function () {
        var out = NS.Player ? [NS.Player] : [];
        for (var i = 0; i < EL.list.length; i++) {
          var o = EL.list[i];
          if (o !== e && o.maxHealth > 0 && !o.dead && !o.removed) out.push(o);
        }
        return out;
      },
      // ROW 0.2 REMAINDER — every live villager, for the golem goals that need to see them
      // (TrackIronGolemTargetGoal, IronGolemLookGoal, IronGolemWanderAroundGoal, 07k_goals.js).
      villagers: function () {
        var out = [];
        for (var i = 0; i < EL.list.length; i++) {
          var o = EL.list[i];
          if (o.type === 'villager' && !o.removed && !o.dead) out.push(o);
        }
        return out;
      },
      // loop/slime-s97 -- `SlimeEntity.initGoals()`'s own SECOND `targetSelector` row
      // (`ActiveTargetGoal<>(this, IronGolemEntity.class, true)`, .decomp read whole): every
      // live iron golem, the same shape `villagers()` above already gives the golem goals in
      // `07k_goals.js` (`TrackIronGolemTargetGoal`/`IronGolemLookGoal`).
      golems: function () {
        var out = [];
        for (var i = 0; i < EL.list.length; i++) {
          var o = EL.list[i];
          if (o.type === 'iron_golem' && !o.removed && !o.dead) out.push(o);
        }
        return out;
      },
      // #1286 fox: DefendFriendGoal's trusted players, and CalmDownGoal's WorriableEntityFilter
      // candidates (a non-sneaking player, or an untamed wolf / polar bear, in the 12/6/12 box).
      trustedEntities: function () {
        var p = NS.Player;
        return p && NS.Fox && NS.Fox.canTrust(e, NS.Fox.playerId(p)) ? [p] : [];
      },
      worriers: function () {
        var out = [], p = NS.Player;
        if (p && !p.sneaking && Math.abs(p.x - e.x) <= 12 && Math.abs(p.y - e.y) <= 6 && Math.abs(p.z - e.z) <= 12) out.push(p);
        for (var i = 0; i < EL.list.length; i++) {
          var o = EL.list[i];
          if (o.removed || o.dead || (o.type !== 'wolf' && o.type !== 'polar_bear') || o.tamed) continue;
          if (Math.abs(o.x - e.x) <= 12 && Math.abs(o.y - e.y) <= 6 && Math.abs(o.z - e.z) <= 12) out.push(o);
        }
        return out;
      },
      animals: function () {
        var out = [];
        for (var i = 0; i < EL.list.length; i++) {
          var o = EL.list[i];
          if (o !== e && !o.removed && (o.type === e.type || (NS.Breed && NS.Breed.crossMate(e.type, o.type)))) out.push(o);
        }
        return out;
      },
      // D-423 (G18e) — the first LIVE `onBreed` and `isTempting`. Both were stubs that could
      // never go true (the header above said so), so `BreedGoal` and `TemptGoal` have been
      // wired to nothing since D-383. `Breed.breed` is the whole consequence — the child, the
      // two cooldowns, the love reset and the orb — and `Breed.isFood` is the species' own
      // `isFood` out of the jar rather than a list kept here.
      // ⚠ `isTempting` ASKS THE BREEDING TABLE, and for cow that is refereed rather than
      // assumed: `bij.u()` builds its `TemptGoal` with `Ingredient.of(Items.WHEAT)`, the same
      // item `Animal.isFood` reads. Another species rostered later needs its own read —
      // `Breed.OWED` names it.
      onBreed: function (a, b) {
        return NS.Breed && NS.Breed.ready ? NS.Breed.breed(a, b, { random: Math.random }) : null;
      },
      // ⚠ `p.heldItem` IS A FUNCTION ON THE REAL PLAYER AND A VALUE ON THE FIXTURE, which is
      // exactly the shape that cost D-276 a whole stage: `14_player.js` defines `P.heldItem()`
      // as a getter while `goalcheck.mjs` hands its synthetic player a plain stack. Resolving
      // both here is the only place that knows about both, so `Ai.TemptGoal` does not have to.
      isTempting: function (stack) {
        if (!NS.Breed || !NS.Breed.ready) return false;
        return NS.Breed.isFood(e.type, NS.Breed.itemNameOf(stack));
      },
      // D-399 (session 37) — the FIRST live consumer of the `mobGriefing` gamerule; it was
      // stored and ignored before this (`Commands.RULES_LIVE` names it now). `Ai.BreakDoorGoal`
      // is the only reader today.
      // ⚠ `Commands.ruleGet` is only defined once the command tree registers (15g), which is
      // lazy — the first real browser run with a zombie spawned before chat was ever opened threw
      // "ruleGet is not a function" every tick (session 45, first run on .chromium/). Until then no
      // rule can have been set, so the jar's own default (`NS.DATA.gameRules`) is the answer.
      mobGriefing: function () {
        var C = NS.Commands;
        if (C && typeof C.ruleGet === 'function') return C.ruleGet('mobGriefing') === 'true';
        var r = NS.DATA && NS.DATA.gameRules && NS.DATA.gameRules.mobGriefing;
        return !r || r.d === 'true';
      },
      // D-400 (session 38) — `Ai.BreakDoorGoal`'s own HARD-difficulty half, real for the first
      // time. Reads the shared `NS.Diff` state 07l_spawn.js also gates natural spawning with
      // (`Diff.LIVE` names both). No `/difficulty` command sets this away from `'normal'` yet
      // (D-327), so this returns false in every real game today — correct, not yet reachable.
      isHard: function () {
        return !!(NS.Diff && NS.Diff.isHard());
      },
      // D-402 (session 40, PASS 16 JOB 1's own last item) — the first LIVE `onShoot`.
      // `Ai.RangedBowAttackGoal` only ever calls what its caller supplies (the same injected-
      // callback shape `onBreed` above already uses); `Combat.mobShoot` is the real consequence,
      // spawning an actual `arrow` entity this session's extractor made simulatable.
      onShoot: function (e, target, pull) {   // D-597: pull = BowItem.getPullProgress(useTime), from Ai.BowAttackGoal
        return NS.Combat && NS.Combat.mobShoot ? NS.Combat.mobShoot(e, target, pull) : null;
      },
      // loop/zombievariants-s100 (QUEUE 0.2 G18c) -- the SAME injected-callback shape onShoot
      // immediately above already uses, for drowned's own TridentAttackGoal analog
      // (Ai.RangedBowAttackGoal reused, 07zk_undead.js's own Ai.ROSTER.drowned): the real
      // consequence is Cb.mobShootTrident, a real `trident` projectile entity.
      onShootTrident: function (e, target) {
        return NS.Combat && NS.Combat.mobShootTrident ? NS.Combat.mobShootTrident(e, target) : null;
      },
      // loop/witchpotion-s95 -- the SAME injected-callback shape `onShoot` above already
      // uses, for `Ai.ProjectileAttackGoal`'s witch roster entry: `WitchEntity.attack`'s
      // real potion choice + throw (`NS.Potion.witchThrow`, 07z_potion.js), not an arrow.
      onPotionThrow: function (e, target) {
        return NS.Potion && NS.Potion.witchThrow ? NS.Potion.witchThrow(e, target, EL.spawn) : null;
      },
      // loop/snowgolem -- the SAME injected-callback shape `onShoot`/`onPotionThrow` above
      // already use, for `Ai.ProjectileAttackGoal`'s snow_golem roster entry
      // (`SnowGolemEntity.attack`, 07zq_snowgolem.js): a real `snowball` entity via
      // `Cb.mobShootSnowball`.
      onSnowballThrow: function (e, target) {
        return NS.Combat && NS.Combat.mobShootSnowball ? NS.Combat.mobShootSnowball(e, target) : null;
      },
      // loop/spells-s93 — the SAME injected-callback shape `onShoot`/`onBreed` above already
      // use, for `NS.Spell`'s `ConjureFangsGoal` (07v_spell.js): a real ground query, a real
      // spawn, a real damage application, and the live entity list to damage FROM.
      solidAt: function (x, y, z) { return NS.Physics ? NS.Physics.solidAt(x, y, z) : false; },
      shapeAt: function (x, y, z) { return NS.Spell.worldShapeAt(x, y, z); },
      spawnFn: function (type, x, y, z) { return EL.spawn(type, x, y, z); },
      hurt: function (target, amount, src) {
        return NS.Combat && NS.Combat.hurt ? NS.Combat.hurt(target, amount, 0, false, src) : false;
      },
      // ⚠ the live PLAYER is not IN `EL.list` (it is `NS.Player`, spawned nowhere) — a fang
      // scan that only walked `EL.list` would never be able to hit the one entity a raid is
      // actually FOR, so it is appended here rather than left for `SP.fangsDamage` to special-
      // case (the same "one place knows about both shapes" rule `isTempting`'s own header cites).
      entities: function () {
        var out = EL.list.slice();
        if (NS.Player) out.push(NS.Player);
        return out;
      }
    };
  };

  /**
   * What a type is born with, out of its CONSTRUCTOR in the 1.18.2 jar — not out of intuition.
   *
   * ⚠⚠ **A DEFAULT BELONGS TO THE ENTITY, NOT TO THE RENDERER.** `EntityRender` refuses to draw
   * a falling block with no state, and that refusal is only correct because there is no such
   * thing: vanilla's `FallingBlockEntity` initialises its field to sand before any caller gets
   * a say. Putting the fallback in the renderer instead would have turned "nobody said what
   * fell" into a plausible grey cube for ever (D-321).
   *
   * ⚠ IDENTIFIED BY USE (D-263). `FallingBlockEntity` is the obfuscated class `blh` — the only
   * one carrying both the `TileEntityData` and `DropItem` NBT keys — and its constructor reads
   *     this.blockState = cdr.C.defaultBlockState();  this.dropItem = true;  this.<int> = 40;
   * `cdr` is `Blocks`, whose static fields are declared in REGISTRY ORDER, so `C` is the 29th
   * of them: `a`..`z` then `A`, `B`, `C` — index 28 — and index 28 of this engine's own
   * registry, extracted from the same jar, is `sand`. `g17ccheck` asserts that identity rather
   * than trusting the sentence.
   *
   * ⚠ `PrimedTnt` is `blj`: `setFuse(80)`, and a constructor kick of
   *     (-sin(r * 2pi) * 0.02, 0.2, -cos(r * 2pi) * 0.02)
   * which is why a TNT block you light hops instead of sitting still.
   */
  EL.STEP_ONE = { iron_golem: 1, enderman: 1, ravager: 1, turtle: 1, horse: 1, donkey: 1, mule: 1, skeleton_horse: 1, zombie_horse: 1, llama: 1, trader_llama: 1 };
  function donkeyInit(e, opts) {
    var rand = EL.randomOf(e);
    if (e.maxHealthAttr === undefined && NS.Mount && NS.Mount.rollAttributes) NS.Mount.rollAttributes(e, rand);
    if (opts && opts['noAI']) e.aiDisabled = true;   // #9462: summon NBT NoAI:1b (the one engine field)
    if (opts && opts.packData && opts.spawnIdx > 0 && !opts.noBaby && NS.Breed && NS.Breed.ready && NS.Breed.setBaby && rand() <= 0.2) NS.Breed.setBaby(e, true);
  }
  EL.DEFAULTS = {
    // loop/witchpotion-s95 -- `Po.witchThrow`'s own `opts.potionId`, carried onto the
    // spawned entity the same way `tnt`'s own DEFAULTS reads `opts` below.
    potion: function (e, opts) {
      // loop/throwables-s116 -- `!== undefined` rather than `||`, so a PLAYER-thrown
      // tag-less splash potion (a "Splash Water Bottle", `opts.potionId` explicitly
      // null from `Th.use`) stays null rather than being coerced to 'harming' -- the
      // witch's own throw (`Po.witchThrow`) never passes anything but a real id, so this
      // widening changes nothing for her.
      e.potionId = (opts.potionId !== undefined) ? opts.potionId : 'harming';
      // loop/throwables-s116 -- the player's own SplashPotionItem/LingeringPotionItem
      // (Use.throwPotion, 07zzd_throw.js): `isLingering()` and `PotionUtil.getCustomPotionEffects`
      // read straight off `opts` the same way `potionId` already is; `Po.tick`'s own dispatch
      // (07z_potion.js) branches on `e.lingering`.
      if (opts.lingering !== undefined) e.lingering = opts.lingering;
      if (opts.custom !== undefined) e.custom = opts.custom;
    },
    // loop/throwables-s116 -- `AreaEffectCloudEntity`'s own field initializers (.decomp
    // AreaEffectCloudEntity.java:44-49, read whole: duration 600, waitTime 20,
    // reapplicationDelay 20) with `LingeringPotionItem`'s own throw-time overrides
    // (PotionEntity.applyLingeringPotion, .decomp :159-172: radius 3.0F, radiusOnUse -0.5F,
    // waitTime 10, radiusGrowth = -radius/duration) layered on top through `opts` --
    // `Po.applyLingeringPotion` (07z_potion.js) is the one caller and always supplies them,
    // this only fills what a bare cloud would need if spawned some other way.
    area_effect_cloud: function (e, opts) {
      e.radius = opts.radius !== undefined ? opts.radius : 3.0;
      e.waitTime = opts.waitTime !== undefined ? opts.waitTime : 20;
      e.duration = opts.duration !== undefined ? opts.duration : 600;
      e.reapplicationDelay = opts.reapplicationDelay !== undefined ? opts.reapplicationDelay : 20;
      e.radiusOnUse = opts.radiusOnUse || 0;
      e.radiusGrowth = opts.radiusGrowth || 0;
      e.potionId = opts.potionId || null;
      e.custom = opts.custom || null;
      e.affected = {};
    },
    // loop/endcrystal-entity -- `EndCrystalEntity`'s own ctor (.decomp, read whole):
    // `endCrystalAge = random.nextInt(100000)` (purely cosmetic, the beam's own pulse/
    // bob animation this port's renderer does not build -- ED.OWED item below -- so 0
    // rather than a real roll changes nothing observable) and the two DataTracker fields
    // `initDataTracker` starts (`BEAM_TARGET` empty, `SHOW_BOTTOM` true).
    end_crystal: function (e) {
      e.endCrystalAge = 0;
      e.beamTarget = null;
      e.showBottom = true;
    },
    falling_block: function (e) {
      if (e.state === undefined) e.state = NS.States ? (NS.States.stateOf('sand') | 0) : 0;
      if (e.dropItem === undefined) e.dropItem = true;
      if (e.fallDamageMax === undefined) e.fallDamageMax = 40;
      // AnvilBlock.configureFallingBlockEntity: setHurtEntities(2.0F, 40); DamageSource.ANVIL = setFallingBlock()
      var an = NS.Reg && NS.States && NS.States.block && NS.Reg.names[NS.States.block[e.state]];
      if (an === 'anvil' || an === 'chipped_anvil' || an === 'damaged_anvil') {
        if (e.hurtEntities === undefined) e.hurtEntities = true;
        if (e.fallHurtAmount === undefined) e.fallHurtAmount = 2;
        e.hurtSource = 'anvil';
      }
    },
    // ⚠ `ItemEntity.bobOffs = random.nextFloat() * PI * 2` — read out of class `bli`. It is why
    // two items dropped together do not bob and spin in lockstep, which is the single thing that
    // makes a pile of drops look alive rather than like one object drawn twice.
    item: function (e) {
      if (e.bobOffs === undefined) e.bobOffs = EL.randomOf(e)() * Math.PI * 2;
      if (e.pickupDelay === undefined) e.pickupDelay = 10;
      // ⚠⚠ **A COUNT OF ONE, BECAUSE AN `ItemStack` CANNOT HOLD ZERO** (D-333). Before this, an
      // item entity spawned with no count carried `undefined`, and the day pickup arrived the
      // arithmetic `count - taken` made it NEGATIVE and removed the entity on the first tick —
      // a dropped block that vanished the instant anything looked at it. `g17cbcheck` caught it
      // as "0 triangles" and said nothing about counts, which is what a picture check is for.
      if (e.count === undefined) e.count = 1;
    },
    firework_rocket: function (e, opts) { if (opts.color !== undefined) { e.color = opts.color; e.flight = opts.flight; } if (NS.Firework) NS.Firework.init(e, null, opts); },   // #5081
    tnt: function (e, opts) {
      if (e.fuse === undefined) e.fuse = EL.TNT_FUSE;
      if (opts.vx === undefined) {
        var r = EL.randomOf(e)() * Math.PI * 2;
        e.vx = -Math.sin(r) * 0.02;
        e.vy = 0.2;
        e.vz = -Math.cos(r) * 0.02;
      }
      // TntBlock.primeTnt: SoundEvents.ENTITY_TNT_PRIMED, neutral, 1, 1, once at spawn (every ignite path spawns here)
      var Snd = NS.Sound;
      if (Snd && Snd.entitySound && !e.silent) Snd.entitySound('entity.tnt.primed', e.x, e.y, e.z, 1, 1, 'neutral', NS.Player);
    },
    // loop/creeper-s95 — `CreeperEntity`'s own FIELD initializers (`.decomp`, read whole:
    // `fuseTime = 30`, `explosionRadius = 3`) plus its three `DataTracker` defaults
    // (`FUSE_SPEED` -1, `CHARGED`/`IGNITED` false) — real on every creeper from birth, same
    // "never undefined" standard D-333's own `count` fix set. `07zb_creeper.js`'s own `Cr.tick`
    // is the only reader of `fuseSpeed`/`currentFuseTime`/`ignited`; `charged` is read by
    // `Cr.explode` (the power-doubling) and has no live WRITER yet — see that file's `Cr.OWED`.
    creeper: function (e) {
      if (e.fuseTime === undefined) e.fuseTime = 30;
      if (e.explosionRadius === undefined) e.explosionRadius = 3;
      if (e.fuseSpeed === undefined) e.fuseSpeed = -1;
      if (e.currentFuseTime === undefined) e.currentFuseTime = 0;
      if (e.lastFuseTime === undefined) e.lastFuseTime = 0;
      if (e.charged === undefined) e.charged = false;
      if (e.ignited === undefined) e.ignited = false;
    },
    // D-458 (G18e unit 3) — `tamed`/`owner`/`sitting` exist on every wolf and cat from birth,
    // never `undefined`, for the same reason D-333's `count` fix exists: an `if (e.tamed)`
    // check against `undefined` still reads false today, but a save round-trip or a check that
    // asserts the FIELD is present (rather than merely falsy) should not have to special-case
    // "never fed yet" vs "explicitly not tamed" as two different absences of the same thing.
    wolf: function (e) {
      if (e.tamed === undefined) e.tamed = false;
      if (e.owner === undefined) e.owner = null;
      if (e.sitting === undefined) e.sitting = false;
      // D-458 (Tame.OWED, closed) — `bje.a_()`'s own synced-data default; see
      // `Tame.COLLAR_DEFAULT_COLOR`'s own header (07n_tame.js) for the bytecode.
      if (e.collarColor === undefined) e.collarColor = 'red';
      // D-475 — `ayf` (NeutralMob, javap'd)'s own `cb` field, `remainingPersistentAngerTime`;
      // see `Ai.HurtByTargetGoal`'s own header (07k_goals.js) for the bytecode.
      if (e.angerTime === undefined) e.angerTime = 0;
      // loop/mobdefaults (referee finding a) — `WolfEntity`'s own constructor calls
      // `this.setTamed(false)` (.decomp/net/minecraft/entity/passive/WolfEntity.java:90), and
      // `setTamed` UNCONDITIONALLY sets `generic.attack_damage`'s base to 4.0 (:330-331) —
      // `createWolfAttributes`'s own `.add(ATTACK_DAMAGE, 2.0)` (:123) is overwritten by that
      // same constructor before a wolf ever ticks once, wild or tamed alike, so 4.0 (not 2.0)
      // is every wolf's real attack damage from birth. Only `getAttributeValue(MAX_HEALTH)`
      // actually differs by tamed state (8.0 wild / 20.0 tamed, `Tm.feed`'s own header,
      // 07n_tame.js) — attack damage never does. `e.attackDamage` is `Cb.mobAttack`'s own
      // per-instance override (14j_combat.js), read ahead of the generic per-type table
      // (`Entities.attrsOf('wolf').dmg`, still 2 -- the table's `createWolfAttributes` base,
      // correct for every OTHER stat but not this one, D-336's own extraction never modelled a
      // constructor overwriting its own builder).
      if (e.attackDamage === undefined) e.attackDamage = 4;
    },
    cat: function (e) {
      if (e.tamed === undefined) e.tamed = false;
      if (e.owner === undefined) e.owner = null;
      if (e.sitting === undefined) e.sitting = false;
      if (e.collarColor === undefined) e.collarColor = 'red';
      // D-458 (Tame.OWED, closed) — `big`'s own `finalizeSpawn` roll; see
      // `Tame.catVariantRoll`'s own header (07n_tame.js) for the bytecode. `downfall` is
      // best-effort: a cat spawned before worldgen/biomes exist (a check's own synthetic
      // fixture) gets vanilla's own <=0.9 branch rather than a crash — the OUTER refusal
      // (can this type even spawn at all) is `EL.spawn`'s job, not this default's.
      // ⚠ D-493 CORRECTS D-458: the roll's input is the MOON, not the biome. CatEntity.initialize
      // (Yarn, .decomp) is `world.getMoonSize() > 0.9F ? nextInt(11) : nextInt(10)` —
      // LunarWorldView.getMoonSize = DimensionType.MOON_SIZES[moonPhase(lunarTime)], and only a
      // FULL moon (1.0) passes. The by-hand bytecode read took that float for biome downfall.
      // CatEntity.setCatType: a CatType outside 0..10 (a loaded/commanded NBT value) rerolls nextInt(10).
      if (e.catVariant !== undefined && !(e.catVariant >= 0 && e.catVariant < 11)) {
        e.catVariant = Math.floor(EL.randomOf(e)() * 10);
      }
      if (e.catVariant === undefined) {
        var Tm = NS.Tame, Sky = NS.Sky, moon = 0;
        if (Sky && Sky.moonPhase && Sky.dayTime !== undefined) moon = EL.MOON_SIZES[Sky.moonPhase(Sky.dayTime)];
        e.catVariant = (Tm && Tm.catVariantRoll) ? Tm.catVariantRoll(moon, EL.randomOf(e)) : 0;
        // CatEntity.initialize's tail: inside a swamp hut's pieces -> setCatType(10) + setPersistent
        // (the witch-hut cats). `at` -- a real spawn, not a bare default fixture.
        if (NS.Structures && NS.Structures.containsAt && e.x !== undefined &&
            NS.Structures.containsAt('swamp_hut', Math.floor(e.x), Math.floor(e.y), Math.floor(e.z))) {
          e.catVariant = 10; e.persistent = true;
        }
      }
    },
    // PLAN G18f unit 2 (D-479) -- `e.profession` exists on every villager from birth, same
    // shape as D-458's tamed/owner/sitting fields on wolf/cat. `Prof.tryClaim` (07o_profession.js)
    // is the only writer past this default.
    // loop/vtype-s105 -- `VillagerEntity.initialize` (.decomp:748-754) rolls `VillagerType.
    // forBiome` for a natural/chunk-gen/structure/event spawn (this engine does not model
    // `SpawnReason`, so every non-forced spawn takes that branch, same as rabbit/fox below) --
    // `opts.villagerType` (a kill-conversion's `Zv.finishConversion`, or a command/egg spawn)
    // wins over a fresh roll, the same "opts wins" shape `rabbit`'s own DEFAULTS entry uses.
    villager: function (e, opts) {
      if (e.profession === undefined) e.profession = 'none';
      if (e.villagerType === undefined) {
        e.villagerType = (opts && opts.villagerType !== undefined) ? opts.villagerType
          : (NS.Profession && NS.Profession.typeAtBiome) ? NS.Profession.typeAtBiome(e.x, e.z) : 'plains';
      }
    },
    // QUEUE 0.2 (G18c) -- `SheepEntity.initialize` (.decomp): `setColor(generateDefaultColor(
    // random))` runs on EVERY spawn, not only a natural one (a spawn egg gets a rolled colour
    // too — read in full, no `SpawnReason` branch on it). `sheared` is the same data-tracker
    // byte's other half, default false (`SheepEntity`'s own `initDataTracker`: `(byte)0`, and
    // bit 4 -- SHEARED -- is unset in a fresh 0).
    sheep: function (e) {
      if (e.woolColor === undefined) e.woolColor = NS.Passive ? NS.Passive.rollWoolColor(EL.randomOf(e)) : 'white';
      if (e.sheared === undefined) e.sheared = false;
    },
    // loop/snowgolem -- `SnowGolemEntity.initDataTracker` (.decomp): `SNOW_GOLEM_FLAGS`
    // starts `(byte)16`, i.e. `HAS_PUMPKIN_FLAG` (bit 16) SET -- every fresh snow golem is
    // born wearing/carrying a pumpkin (`hasPumpkin()` true), whether spawned by the real
    // block-construction path or (today) a debug/EL.spawn call; only `sheared()` ever turns
    // it off (07zq_snowgolem.js's own `SG.shear`).
    snow_golem: function (e) {
      if (e.hasPumpkin === undefined) e.hasPumpkin = true;
    },
    // QUEUE 0.2 (G18c) -- `ChickenEntity`'s own field initialiser (.decomp): `eggLayTime =
    // random.nextInt(6000) + 6000`, run once per instance, same as every other Java field
    // default -- true on spawn, whether natural or a spawn egg.
    // D-533 (G18c) -- `BatEntity`'s constructor calls `setRoosting(true)`: every bat is born
    // hanging, natural spawn or egg alike.
    bat: function (e) {
      if (e.roosting === undefined) e.roosting = true;
      if (e.hangingPos === undefined) e.hangingPos = null;
    },
    // loop/enderman-s98 -- `EndermanEntity` field/DataTracker defaults (.decomp, read in full):
    // `carriedBlock` (CARRIED_BLOCK) starts `Optional.empty()`, `ANGRY`/`PROVOKED` start false
    // (angerTime/angryAt below cover ANGRY; `provoked` covers PROVOKED, set by
    // `TeleportTowardsPlayerGoal.start`, 07zg_enderman.js), and `ageWhenTargetSet` is a plain
    // instance field, 0 until `setTarget` first runs (never undefined for the same "never
    // undefined" standard D-333's own count fix set, and D-475's wolf angerTime entry above
    // already carries for a second Angerable this pass).
    enderman: function (e) {
      if (e.carriedBlock === undefined) e.carriedBlock = null;
      if (e.angerTime === undefined) e.angerTime = 0;
      if (e.angryAt === undefined) e.angryAt = null;
      if (e.ageWhenTargetSet === undefined) e.ageWhenTargetSet = 0;
      if (e.provoked === undefined) e.provoked = false;
    },
    // loop/rabbit-s98 (QUEUE 0.2 G18c) -- `RabbitEntity.initialize` (.decomp, read in full):
    // every natural spawn rolls a biome-based type through `chooseType` (`Rb.chooseTypeAt`,
    // 07zh_rabbit.js) UNLESS a `RabbitData` from an egg/command already carries one (`opts.type`,
    // the same "spawner-supplied data wins" shape `EL.spawn`'s own `tnt`/`potion` DEFAULTS above
    // already use for their own `opts` fields) -- killer bunny (99) is never rolled here, only
    // ever set by hand through `opts.type`, which is `Rb.chooseType`'s own guarantee (07zh_rabbit
    // .js's own header) that a NATURAL rabbit can never be one.
    rabbit: function (e, opts) {
      // #2852 -- RabbitEntity.initialize passes new RabbitData(type) -> super(1.0F): every pack member after the first is a kit.
      if (opts && opts.spawnIdx > 0 && NS.Breed && NS.Breed.ready && NS.Breed.setBaby) NS.Breed.setBaby(e, true);
      if (e.rabbitType !== undefined) return;
      var type = (opts && opts.type !== undefined) ? opts.type
        : (NS.Rabbit && NS.Rabbit.chooseTypeAt) ? NS.Rabbit.chooseTypeAt(e.x, e.z, EL.randomOf(e)) : 0;
      if (NS.Rabbit && NS.Rabbit.setRabbitType) NS.Rabbit.setRabbitType(e, type); else e.rabbitType = type;
      if (e.moreCarrotTicks === undefined) e.moreCarrotTicks = 0;
    },
    // #1224 -- `ParrotEntity.initialize` (.decomp:134) `setVariant(random.nextInt(5))`; `opts.variant`
    // (egg/command/taming-restore) wins. `Fl.skinKey` (07t_fly.js) draws parrot#N from it.
    parrot: function (e, opts) {
      if (e.parrotVariant !== undefined) return;
      e.parrotVariant = (opts && opts.variant !== undefined) ? opts.variant | 0
        : Math.floor(EL.randomOf(e)() * 5);
    },
    // loop/fox-s99 (QUEUE 0.2 G18c) -- `FoxEntity.initialize` (.decomp, read in full):
    // every natural spawn rolls a biome-based type through `Type.fromBiome` (`Fx.typeAt`,
    // 07zj_fox.js) UNLESS a `FoxData` from an egg/command already carries one (`opts.type`,
    // the same "spawner-supplied data wins" shape `rabbit`'s own DEFAULTS entry above uses).
    fox: function (e, opts) {
      if (e.foxType !== undefined) return;
      var pd = opts && opts.packData;
      var type = (opts && opts.type !== undefined) ? opts.type
        : (pd && pd.foxType !== undefined) ? pd.foxType // FoxData: type copied from the first fox
        : (NS.Fox && NS.Fox.typeAt) ? NS.Fox.typeAt(e.x, e.z) : 0;
      if (pd && pd.foxType === undefined) pd.foxType = type;
      // FoxData.getSpawnedCount() >= 2 => setBreedingAge(-24000)
      if (pd && opts.spawnIdx >= 2) {
        if (NS.Breed && NS.Breed.ready && NS.Breed.setBaby) NS.Breed.setBaby(e, true); else e.growAge = -24000;
      }
      if (NS.Fox && NS.Fox.setType) NS.Fox.setType(e, type); else e.foxType = type;
      if (NS.Fox && NS.Fox.initEquipment) NS.Fox.initEquipment(e);
    },
    // loop/squid-s98 (QUEUE 0.2 G18c) -- `SquidEntity`'s own constructor field initialisers
    // (thrust timer/tentacle/tilt/roll state, the 300-air breathing counter) and, for a glow
    // squid, `initDataTracker`'s own `DARK_TICKS_REMAINING` default of 0 (`Sq.spawnInit`,
    // 07zi_squid.js) -- true on spawn, natural or a spawn egg alike, same as `bat`'s roosting
    // default just above.
    dolphin: function (e) { if (NS.Dolphin) NS.Dolphin.spawnInit(e); },   // #718
    guardian: function (e) { if (NS.Guardian) NS.Guardian.spawnInit(e); },   // #1011
    elder_guardian: function (e) { if (NS.Guardian) NS.Guardian.spawnInit(e); },
    squid: function (e) { if (NS.Squid) NS.Squid.spawnInit(e); },
    glow_squid: function (e) { if (NS.Squid) NS.Squid.spawnInit(e); },
    // loop/goat-s99 (QUEUE 0.2 G18c) -- `GoatEntity.initialize` (.decomp): the 2% screaming
    // roll, run on every spawn (natural, egg or command) -- `Gt.spawnInit` (07zj_goat.js).
    // `opts.screaming` lets an egg/command spawn force it the same way rabbit's own
    // `opts.type` forces a killer bunny (07zh_rabbit.js's own DEFAULTS entry, above).
    goat: function (e, opts) {
      if (NS.Goat) {
        if (opts && opts.screaming !== undefined) e.screaming = !!opts.screaming;
        else NS.Goat.spawnInit(e);
      }
    },
    // loop/panda-axolotl-s101 (QUEUE 0.2 G18c) -- `PandaEntity.initialize` (.decomp lines
    // 543-553): every natural/egg/command spawn rolls BOTH genes independently (`Pd.rollGenes`,
    // 07zl_panda.js). `opts.mainGene`/`opts.hiddenGene` let an egg/command spawn force a pair,
    // the same "spawner-supplied data wins" shape `fox`'s own DEFAULTS entry above uses.
    panda: function (e, opts) {
      if (e.mainGene !== undefined) return;
      if (NS.Panda) {
        if (opts && opts.mainGene !== undefined && opts.hiddenGene !== undefined) {
          e.mainGene = opts.mainGene | 0; e.hiddenGene = opts.hiddenGene | 0;
          NS.Panda.resetAttributes(e);
        } else {
          NS.Panda.rollGenes(e, EL.randomOf(e));
        }
        // PassiveEntity.initialize with the default PassiveData(0.2F): pack members past the first are babies at 20%
        if (opts && opts.spawnIdx > 0 && NS.Breed && NS.Breed.ready && NS.Breed.setBaby && EL.randomOf(e)() <= 0.2) NS.Breed.setBaby(e, true);
      }
    },
    // loop/panda-axolotl-s101 (QUEUE 0.2 G18c) -- `AxolotlEntity.initialize` (.decomp lines
    // 155-174): a natural spawn (or egg/command with no forced variant) rolls one of the four
    // NATURAL variants (`Ax.randomNaturalVariant`, 07zm_axolotl.js) -- the real jar's own
    // "two candidate variants shared across one pack placement" (`AxolotlData`) is simplified
    // to one independent roll per placement (`Ax.OWED` names the gap). `opts.variant` lets an
    // egg/command spawn force any of the five, blue included.
    axolotl: function (e, opts) {
      e.stepHeight = 1.0; e.maxUpStep = 1.0; // AxolotlEntity ctor: this.stepHeight = 1.0F
      if (opts && opts.fromBucket) e.fromBucket = true; // Bucketable.copyDataFromNbt: FromBucket on release
      if (e.axolotlVariant !== undefined) return;
      if (NS.Axolotl) {
        if (opts && opts.variant !== undefined) { e.axolotlVariant = opts.variant | 0; return; }
        // AxolotlData: the pack rolls two candidate variants once; every member picks one, and
        // a member placed after the first two (getSpawnedCount() >= 2) is born a baby.
        var pd = (opts && opts.packData) || {};   // initialize(null data) builds a fresh AxolotlData too: egg/command spawns draw the same three rolls
        if (pd) {
          if (!pd.variants) pd.variants = [NS.Axolotl.randomNaturalVariant(EL.randomOf(e)), NS.Axolotl.randomNaturalVariant(EL.randomOf(e))];
          e.axolotlVariant = pd.variants[Math.floor(EL.randomOf(e)() * 2)];
          if (opts && opts.packData && opts.spawnIdx >= 2) {
            if (NS.Breed && NS.Breed.ready && NS.Breed.setBaby) NS.Breed.setBaby(e, true); else e.growAge = -24000;
          }
        } else {
          e.axolotlVariant = NS.Axolotl.randomNaturalVariant(EL.randomOf(e));
        }
      }
    },
    // loop/turtle-s102 (QUEUE 0.2 G18 mobs) -- `TurtleEntity.initialize` (.decomp lines
    // 168-172): `setHomePos(getBlockPos())` at spawn, verbatim -- every OTHER field
    // (`hasEgg`/`travelPos`/`landBound`/`activelyTravelling`) starts at its `initDataTracker`
    // default (false/ORIGIN), which is already what a freshly-created JS object gives for an
    // unset field, so only the home position needs an explicit roll here.
    turtle: function (e) {
      if (e.homeX !== undefined) return;
      if (NS.Turtle) NS.Turtle.setHomePos(e, e.x, e.y, e.z);
    },
    // Dan's scheduled parallel night, QUEUE 0.2 (G18c) -- `PassiveEntity.initialize`'s own
    // `new PassiveEntity.PassiveData(1.0F)` override (PolarBearEntity.java, read in full;
    // 07zj_polarbear.js's own header names the literal): `opts.spawnIdx` is `spawnedCount`
    // (07l_spawn.js's own comment on the natural-pack loop that sets it) -- every polar bear
    // placed AFTER the first one in the SAME natural pack rolls `Pb.BABY_CHANCE` (a flat 1.0,
    // so this is unconditional, not "usually") and is born a cub. An egg/command spawn never
    // sets `opts.spawnIdx` at all, so it falls through to `undefined > 0` = false, same as
    // vanilla's own fresh `PassiveData` (spawnCount 0) for a single non-pack placement.
    // s101 -- MooshroomEntity.initDataTracker: TYPE starts "red".
    mooshroom: function (e) { if (NS.Mooshroom) NS.Mooshroom.spawnInit(e); },
    // QUEUE 0.2 (G18 mobs) -- BeeEntity's own field defaults (Bee.spawnInit, 07zo_bee.js) and
    // `this.moveControl = new FlightMoveControl(this, 20, true)` (.decomp line 141) --
    // `e.flyMove` is the SAME one-control-object-per-mob-at-spawn shape `Ai.ROSTER.vex`/slime's
    // own `e.slimeMove` already use (this file's own header, `EL.tickOne`'s `if (e.flyMove)
    // e.flyMove.tick()` line).
    bee: function (e, opts) {
      if (NS.Bee) NS.Bee.spawnInit(e, opts, EL.randomOf(e));
      e.canOpenDoors = false; e.canEnterOpenDoors = true; e.canSwim = false;   // BeeEntity.createNavigation: setCanPathThroughDoors(false), setCanEnterOpenDoors(true), setCanSwim(false)
      if (NS.Fly && NS.Fly.ready && !e.flyMove) e.flyMove = new NS.Fly.MoveControl(e);
    },
    polar_bear: function (e, opts) {
      var Pb = NS.PolarBear, Br = NS.Breed;
      if (opts && opts.spawnIdx > 0 && Br && Br.ready && Br.setBaby && Pb) {
        var chance = Pb.BABY_CHANCE === undefined ? 1 : Pb.BABY_CHANCE;
        if (EL.randomOf(e)() < chance) Br.setBaby(e, true);
      }
    },
    // #2619 -- OcelotEntity.initialize substitutes `new PassiveData(1.0F)` when none was passed:
    // every ocelot placed after the first in a natural pack (spawnIdx>0) is a kitten (same as polar_bear).
    ocelot: function (e, opts) {
      if (opts && opts.spawnIdx > 0 && NS.Breed && NS.Breed.ready && NS.Breed.setBaby) NS.Breed.setBaby(e, true);
    },
    // loop/fish-s99 (QUEUE 0.2 G18c) -- `FishEntity`/`SchoolingFishEntity`/`PufferfishEntity`/
    // `TropicalFishEntity`'s own field/DataTracker defaults (FROM_BUCKET, leader/groupSize,
    // PUFF_STATE, VARIANT) -- `Fish.spawnInit`, 07zj_fish.js, the same spawn-slot standing
    // convention squid's own row above already sets.
    cod: function (e, opts) { if (NS.Fish) NS.Fish.spawnInit(e, opts); },
    salmon: function (e, opts) { if (NS.Fish) NS.Fish.spawnInit(e, opts); },
    pufferfish: function (e, opts) { if (NS.Fish) NS.Fish.spawnInit(e, opts); },
    tropical_fish: function (e, opts) { if (NS.Fish) NS.Fish.spawnInit(e, opts); },
    chicken: function (e) {
      if (e.eggLayTime === undefined) e.eggLayTime = NS.Passive ? NS.Passive.rollEggTimer(EL.randomOf(e)) : 6000;
    },
    // QUEUE 0.2 (G18e remainder) -- `HorseEntity.initAttributes()`'s own per-spawn random roll
    // (`Mount.rollAttributes`, 07r_mount.js, owned by that unit) OVERWRITES the flat generic
    // health this same `EL.spawn` call already set moments earlier off the attribute TABLE
    // (`Ent.attrsOf('horse').hp` -- see that block's own header above `EL.DEFAULTS` runs after
    // it). A bred foal's own averaging (`Breed.CHILD.horse`, 07m_breed.js) runs LATER, inside
    // `Breed.breed` -- itself called only after `EL.spawn` (and so this default) already ran.
    horse: function (e, opts) {
      // loop/nbtsave-s104 -- guard MOVED HERE from inside `Mnt.rollAttributes` itself (that
      // function's own header explains why: `mountcheck` calls it directly, twice, and expects
      // BOTH calls to reroll). `opts.maxHealthAttr` (07zw_mobnbt.js's reload path) is copied
      // onto `e` by EL.spawn's own generic opts-copy step, BEFORE this default hook runs -- the
      // same "spawner data already supplied it" shape `e.variant === undefined` two lines below
      // already uses for the colour roll.
      if (e.maxHealthAttr === undefined && NS.Mount && NS.Mount.rollAttributes) NS.Mount.rollAttributes(e, EL.randomOf(e));
      // QUEUE 0.2 (G18e remainder, this pass) -- `HorseEntity.initialize`'s own colour/marking
      // roll (`Mount.rollVariant`, 07r_mount.js, owned by that unit), same "default hook calls
      // into Mount" shape as the attribute roll immediately above. `e.variant !== undefined`
      // guards a bred foal (`Breed.CHILD.horse` already set it before this default hook can run
      // a second time -- see that function's own header) and a stale save alike.
      var rand = EL.randomOf(e), pd = opts && opts.packData;
      if (e.variant === undefined && NS.Mount && NS.Mount.rollVariant) {
        e.variant = NS.Mount.rollVariant(rand);
        // #4104 -- HorseEntity.initialize reuses the HorseData: colour rolled once per spawn group, marking per horse.
        if (pd && pd.horseColor !== undefined) e.variant = NS.Mount.encodeVariant(pd.horseColor, NS.Mount.horseMarking(e));
        else if (pd) pd.horseColor = NS.Mount.horseColor(e);
      }
      // PassiveEntity.initialize: HorseData super(true) -> 5% baby for spawnedCount > 0.
      if (pd && opts.spawnIdx > 0 && NS.Breed && NS.Breed.ready && NS.Breed.setBaby && rand() <= 0.05) NS.Breed.setBaby(e, true);
    },
    // loop/donkey-s96 (QUEUE 0.2 G18e remainder close) -- `AbstractDonkeyEntity.initAttributes`
    // (.decomp): only health is re-rolled (`Mount.rollAttributes` branches on `Mount.CHESTABLE`
    // itself, 07r_mount.js), no `e.variant` at all -- neither donkey nor mule tracks one.
    // loop/nbtsave-s104 -- same reload guard as horse's own DEFAULTS entry above.
    // #4105 -- HorseBaseEntity.initialize supplies PassiveData(0.2F): spawnedCount>0 -> foal at nextFloat()<=0.2.
    donkey: function (e, opts) { donkeyInit(e, opts); },
    mule: function (e, opts) { donkeyInit(e, opts); },
    // loop/llama-s97 (QUEUE 0.2 G18e remainder close) -- `LlamaEntity` never overrides
    // `initAttributes()` either (inherits `AbstractDonkeyEntity`'s health-only reroll verbatim,
    // .decomp confirmed this pass, the SAME `Mount.CHESTABLE` branch donkey/mule already use),
    // but DOES override `initialize()` to roll its own `STRENGTH`/`VARIANT` (`initializeStrength`/
    // a fresh `nextInt(4)`, .decomp) -- `Mount.rollStrength`/`Mount.rollLlamaVariant`
    // (07r_mount.js). Guarded the same way horse's own colour roll is: `e.variant === undefined`
    // so a bred foal's own `Breed.CHILD.llama` roll (07m_breed.js, runs LATER inside
    // `Breed.breed`) is never overwritten by this default hook running a second time.
    llama: function (e, opts) {
      var M = NS.Mount;
      if (!M) return;
      var rand = EL.randomOf(e);
      // loop/nbtsave-s104 -- same reload guard as horse's own DEFAULTS entry above.
      if (M.rollAttributes && e.maxHealthAttr === undefined) M.rollAttributes(e, rand);
      if (e.strength === undefined && M.rollStrength) M.setStrength(e, M.rollStrength(rand));
      // #1234 -- LlamaEntity.initialize reuses a LlamaData across the pack (every member takes
      // its .variant; the first rolls nextInt(4)), then PassiveEntity.initialize rolls a 5% baby
      // (LlamaData super(true)) for spawnedCount > 0.
      var pd = opts && opts.packData;
      if (e.variant === undefined && M.rollLlamaVariant) {
        if (pd && pd.llamaVariant !== undefined) e.variant = pd.llamaVariant;
        else { e.variant = M.rollLlamaVariant(rand); if (pd) pd.llamaVariant = e.variant; }
      }
      if (pd && opts.spawnIdx > 0 && !opts.noBaby && NS.Breed && NS.Breed.ready && NS.Breed.setBaby && rand() <= 0.05) NS.Breed.setBaby(e, true);
    }
  ,
    // loop/wtrader-s103 -- TraderLlamaEntity extends LlamaEntity and adds no new ctor-time
    // field beyond its own despawnDelay (Ll.TRADER_DESPAWN_INITIAL, 07ze_llama.js's own tick
    // sets it lazily) -- the same attribute/strength/variant roll llama's own default above
    // already performs, reused rather than duplicated.
    trader_llama: function (e, opts) {
      // #4011 -- TraderLlamaEntity.initialize installs PassiveData(false): never the 5% baby roll.
      EL.DEFAULTS.llama(e, Object.assign({}, opts, { noBaby: true }));
    },
    // loop/wtrader-s103 -- WanderingTraderEntity's own ctor sets no field this engine tracks
    // beyond what WT.tickEntity (07zt_wtrader.js) already lazily attaches (despawnDelay,
    // tradeOffers) the first tick it runs -- named here only so a caller reading EL.DEFAULTS
    // for "does this type have day-one state" sees the real answer (none at spawn time,
    // WanderingTraderManager.trySpawn's own despawnDelay/wanderTarget writes are the manager's
    // job, WT.trySpawn, not this hook's).
    wandering_trader: function () {},

    // D-517 (QUEUE 0.2, G18 mobs remainder) -- MobEntity.initEquipment's own weapon
    // (AbstractSkeletonEntity -> bow, VindicatorEntity -> iron_axe, PillagerEntity ->
    // crossbow) and the base difficulty-scaled armour roll every MobEntity inherits
    // (07y_equip.js's own header cites the .decomp lines). `zombie` reaches the SAME
    // function -- ZombieEntity.initEquipment: super's armour, then Eq.rollZombieWeapon (s130).
    zombie: function (e) { if (NS.Undead && NS.Undead.initZombieAttributes) NS.Undead.initZombieAttributes(e, EL.randomOf(e)); if (NS.Equip && NS.Equip.ready) NS.Equip.initMob(e, EL.randomOf(e)); },
    // loop/zvillager-s102 (QUEUE 0.2 G18 mobs) -- ZombieVillagerEntity's own ctor (.decomp:68-73,
    // read whole): rolls a random profession, nothing else -- `Zv.spawnInit` (07zr_zvillager.js).
    // Equipment: ZombieVillagerEntity declares NO initEquipment override of its own (inherits
    // ZombieEntity's, same as husk/stray reach zombie/skeleton's own path a few lines up) -- the
    // SAME `Eq.initMob` call `zombie` makes above, not a second key.
    zombie_villager: function (e, opts) {
      if (NS.ZVillager) NS.ZVillager.spawnInit(e, opts);
      if (NS.Undead && NS.Undead.initZombieAttributes) NS.Undead.initZombieAttributes(e, EL.randomOf(e));
      if (NS.Equip && NS.Equip.ready) NS.Equip.initMob(e, EL.randomOf(e));
    },
    skeleton: function (e) { if (NS.Equip && NS.Equip.ready) NS.Equip.initMob(e, EL.randomOf(e)); },
    // loop/zombievariants-s100 (QUEUE 0.2 G18c) -- `HuskEntity`/`StrayEntity` (.decomp, both
    // read whole) declare no `initEquipment` override of their own at all -- `husk` reaches
    // the exact same base-armour-roll path `zombie` does (`Eq.MOB_BASE_ARMOR.husk`,
    // 07y_equip.js), and `stray` reaches the same base path `skeleton` does, its own bow
    // weapon already wired through `Eq.WEAPON_FOR.stray` (07y_equip.js, pre-existing).
    husk: function (e) { if (NS.Undead && NS.Undead.initZombieAttributes) NS.Undead.initZombieAttributes(e, EL.randomOf(e)); if (NS.Equip && NS.Equip.ready) NS.Equip.initMob(e, EL.randomOf(e)); },
    stray: function (e) { if (NS.Equip && NS.Equip.ready) NS.Equip.initMob(e, EL.randomOf(e)); },
    // D-673 (KW-32) -- `WitherSkeletonEntity.initialize` (.decomp:73-78): AbstractSkeleton's
    // initialize (its OWN initEquipment -> a stone sword and nothing else, no armour; its OWN
    // empty updateEnchantments), then `GENERIC_ATTACK_DAMAGE.setBaseValue(4.0)` -- the builder's
    // 2.0 (`Entities.attrsOf`) is what a fresh construct has, 4.0 is what every spawned one has.
    wither_skeleton: function (e) {
      if (NS.Equip && NS.Equip.ready) NS.Equip.initMob(e, EL.randomOf(e));
      e.attackDamage = EL.WITHER_SKELETON_ATTACK;
    },
    // `DrownedEntity.initEquipment`/`initialize` (.decomp, read whole): a PROBABILISTIC
    // mainhand roll (trident or fishing rod, not a fixed weapon like skeleton's bow) plus a
    // SEPARATE 3% offhand nautilus shell roll -- `Eq.initDrowned` (07y_equip.js) is the whole
    // shape, not `Eq.initMob`'s fixed-weapon-then-armour order.
    drowned: function (e) { e.stepHeight = 1.0; e.maxUpStep = 1.0; if (NS.Undead && NS.Undead.initZombieAttributes) NS.Undead.initZombieAttributes(e, EL.randomOf(e)); if (NS.Equip && NS.Equip.ready) NS.Equip.initDrowned(e, EL.randomOf(e)); },
    vindicator: function (e) { if (NS.Equip && NS.Equip.ready) NS.Equip.initMob(e, EL.randomOf(e)); },
    pillager: function (e) { if (!e.inventory) e.inventory = [null, null, null, null, null]; if (NS.Equip && NS.Equip.ready) NS.Equip.initMob(e, EL.randomOf(e)); },
    // s130 (referee finding 11) -- VexEntity.initialize runs initEquipment (iron sword, drop 0)
    // + updateEnchantments; IllusionerEntity.initialize just equips a bow (Eq.WEAPON_FOR/NO_*).
    vex: function (e) { if (NS.Equip && NS.Equip.ready) NS.Equip.initMob(e, EL.randomOf(e)); },
    // D-671 (referee finding 11) — `ZombifiedPiglinEntity` inherits ZombieEntity.initialize: the
    // zombie attributes, then its OWN initEquipment (golden sword, no super -> no armour) and
    // updateEnchantments. It had no init at all, so it spawned bare-handed.
    zombified_piglin: function (e, opts) {
      if (opts && opts.conversion) return;   // #4213: PigEntity.onStruckByLightning is create() only -- no initialize rolls
      if (NS.Undead && NS.Undead.initZombieAttributes) NS.Undead.initZombieAttributes(e, EL.randomOf(e));
      if (NS.Equip && NS.Equip.ready) NS.Equip.initMob(e, EL.randomOf(e));
    },
    // s133 (KW-32) -- PiglinEntity.initialize / PiglinBruteEntity.initialize (07zzf_piglin.js).
    piglin: function (e, opts) { if (NS.Piglin) NS.Piglin.initPiglin(e, opts); },
    piglin_brute: function (e, opts) { if (NS.Piglin) NS.Piglin.initBrute(e, opts); },
    // s134 (KW-32) -- HoglinEntity.initialize (20% baby) / ZoglinEntity (none of its own) (07zzg_hoglin.js).
    hoglin: function (e, opts) { if (NS.Hoglin) NS.Hoglin.initHoglin(e, opts); },
    zoglin: function (e, opts) { if (NS.Hoglin) NS.Hoglin.initZoglin(e, opts); },
    // loop/blazeghast -- BlazeEntity's own ctor fields (07zzh_blaze.js).
    blaze: function (e) { if (NS.Blaze) NS.Blaze.initBlaze(e); },
    // loop/blazeghast -- GhastEntity's own ctor fields + its FlightMoveControl (07zzi_ghast.js).
    ghast: function (e) { if (NS.Ghast) NS.Ghast.initGhast(e); },
    // loop/blazeghast -- AbstractFireballEntity's own `power` vector, off `opts.power` (the
    // (dx,dy,dz) the shooter aimed with) -- `Bl.Fireball.initSmallFireball`/`initFireball`
    // (07zzh_blaze.js) do the ExplosiveProjectileEntity ctor's own normalize-and-scale.
    small_fireball: function (e, opts) { if (NS.Blaze && NS.Blaze.Fireball) NS.Blaze.Fireball.initSmallFireball(e, opts); },
    fireball: function (e, opts) { if (NS.Blaze && NS.Blaze.Fireball) NS.Blaze.Fireball.initFireball(e, opts); },
    // QUEUE 0.00 part 2 (D-787) -- `new WitherSkullEntity(World, LivingEntity, dx, dy, dz)`'s
    // own ctor (07zzm_wither.js's `Wi.initSkull`), the same `ExplosiveProjectileEntity`
    // normalize-and-scale the fireball pair's own DEFAULTS rows immediately above already call.
    dragon_fireball: function (e, opts) { if (NS.EnderDragon && NS.EnderDragon.initDragonFireball) NS.EnderDragon.initDragonFireball(e, opts); },
    wither_skull: function (e, opts) { if (NS.Wither && NS.Wither.initSkull) NS.Wither.initSkull(e, opts); },
    // cloud unit (confident-lamport-nq63qx) -- `ShulkerBulletEntity`'s own ctor (07zzk_shulker.js,
    // `Sh.initBullet`): shooter/target, and the first waypoint pick off the shooter's own
    // attached-face axis (`opts.axis`, `Sh.ShootBulletGoal`'s own spawn call).
    shulker_bullet: function (e, opts) { if (NS.Shulker && NS.Shulker.initBullet) NS.Shulker.initBullet(e, opts); },
    // #1564 (G25) -- AbstractMinecartEntity's ctor/initDataTracker for all seven cart types (07zzr_minecart.js).
    boat: function (e, opts) { if (NS.Boat) NS.Boat.init(e, opts); },   // #5227
    minecart: function (e, opts) { if (NS.Minecart) NS.Minecart.init(e, opts); },
    chest_minecart: function (e, opts) { if (NS.Minecart) NS.Minecart.init(e, opts); },
    furnace_minecart: function (e, opts) { if (NS.Minecart) NS.Minecart.init(e, opts); },
    tnt_minecart: function (e, opts) { if (NS.Minecart) NS.Minecart.init(e, opts); },
    spawner_minecart: function (e, opts) { if (NS.Minecart) NS.Minecart.init(e, opts); },
    hopper_minecart: function (e, opts) { if (NS.Minecart) NS.Minecart.init(e, opts); },
    command_block_minecart: function (e, opts) { if (NS.Minecart) NS.Minecart.init(e, opts); },
    // QUEUE 0.00 part 2 -- WitherEntity ctor (experiencePoints 50) + the FlightMoveControl
    // attach (07zzm_wither.js's own Wi.initWither), same external-DEFAULTS shape ghast uses.
    wither: function (e) { if (NS.Wither && NS.Wither.initWither) NS.Wither.initWither(e); },
    // loop/enderdragon-wiring (ED.OWED item 1) -- attaches the standalone `ED.EnderDragonEntity`
    // rig (src/07zzl_enderdragon.js) this live `e` bridges to every tick (`NS.EnderDragon.tickEntity`,
    // dispatched from the mobTick slot below), seeded at HoldingPattern (ED.OWED item 2,
    // EnderDragonFight, is still absent -- there is no crystal/portal state to hand the fight a
    // real starting phase from, so this is the natural no-fight default rather than a guess).
    ender_dragon: function (e) { if (NS.EnderDragon && NS.EnderDragon.ready) NS.EnderDragon.initEntity(e); },
    // s135 (KW-33) -- StriderEntity.initialize (07zzj_strider.js): the natural-spawn
    // zombie-rider / baby-strider-rider rolls, plus the initial cold-state read.
    strider: function (e, opts) { if (NS.Strider) NS.Strider.initStrider(e, opts); },
    illusioner: function (e) { if (NS.Equip && NS.Equip.ready) NS.Equip.initMob(e, EL.randomOf(e)); },
    // loop/slime-s97 (QUEUE 0.2 G18c) -- `SlimeEntity.initialize()` (natural spawn: rolls a
    // random size) vs `SlimeEntity.remove()`'s own direct `setSize(childSize, true)` for a
    // split child (`Sl.split`, 07zd_slime.js) -- `opts.size` is how `EL.spawn` tells the two
    // apart: a split child passes it explicitly and skips the roll entirely, matching vanilla's
    // TWO different construction paths (`getType().create(world)` + a direct `setSize` call,
    // vs `initialize()`'s own roll) rather than approximating a split as "spawn then re-roll".
    slime: function (e, opts) {  
      var Sl = NS.Slime;
      if (!Sl || !Sl.ready) return;
      if (opts && opts.size !== undefined) Sl.setSize(e, opts.size, !opts.mobNbtRestore);   // #4813: load = setSize(size+1,false), saved Health survives
      else Sl.rollSize(e, EL.randomOf(e));
      e.slimeTicksUntilJump = 0;   // SlimeMoveControl.ticksUntilJump starts 0
    },
    // loop/lightning -- `LightningEntity`'s ctor (.decomp/net/minecraft/entity/LightningEntity.
    // java, read whole): `ambientTick` fixed at 2, a random `seed` (this engine has no client-
    // side render use for it yet, kept only so a future one can read it live), and
    // `remainingActions = random.nextInt(3) + 1`, rolled once per bolt. `opts.cosmetic` is the
    // ServerWorld.tickChunk/SkeletonHorseTrapTriggerGoal caller's own `setCosmetic(bool)` call,
    // copied straight through the same `opts` bag `e.state`/`e.fuse` above already use.
    lightning_bolt: function (e, opts) {
      var rnd = EL.randomOf(e);
      e.ambientTick = 2;
      e.seed = Math.floor(rnd() * 0x100000000);
      e.remainingActions = Math.floor(rnd() * 3) + 1;
      e.cosmetic = !!(opts && opts.cosmetic);
      e.channeler = (opts && opts.channeler) || null;   // LightningEntity.setChanneler
      e.struckIds = {};
      e.blocksSetOnFire = 0;
    },
    // loop/lightning -- `SkeletonHorseEntity.initAttributes()` (.decomp): ONLY the jump-strength
    // attribute is re-rolled per spawn (the SAME `childJumpStrengthBonus` roll `horse`'s own
    // DEFAULTS entry above uses, `Mnt.childJumpStrengthBonus`) -- health (flat 15.0,
    // `createSkeletonHorseAttributes`) and movement speed (flat 0.2F, same builder) are NEVER
    // re-rolled, unlike horse/donkey/mule/llama immediately above, so this hook touches neither
    // and `e.trapped`/`e.trapTime` (SkeletonTrap/SkeletonTrapTime NBT, .decomp `writeCustomData
    // ToNbt`) default off the same `opts` copy-through `EL.spawn` already runs for every other
    // per-species NBT field (`NS.MobNbt.fieldsFor` -- 'skeleton_horse' is OWED there, see this
    // module's own OWED list; a fresh spawn's `e.trapped` starts undefined/falsy either way,
    // which is the correct default for anything but a reloaded trap).
    skeleton_horse: function (e) {
      if (e.jumpStrengthAttr === undefined && NS.Mount && NS.Mount.childJumpStrengthBonus) {
        e.jumpStrengthAttr = NS.Mount.childJumpStrengthBonus(EL.randomOf(e));
      }
    },
    // ZombieHorseEntity.initAttributes: the same per-spawn jump-strength roll as skeleton_horse (#1137).
    zombie_horse: function (e) {
      if (e.jumpStrengthAttr === undefined && NS.Mount && NS.Mount.childJumpStrengthBonus) {
        e.jumpStrengthAttr = NS.Mount.childJumpStrengthBonus(EL.randomOf(e));
      }
    }
  };
  EL.DEFAULTS.magma_cube = EL.DEFAULTS.slime;

  // loop/mobdefaults (referee finding b) — `MobEntity.canPickUpLoot`/`.persistent`
  // (`CanPickUpLoot`/`PersistenceRequired` NBT) had NO state anywhere in this engine before this
  // pass: not a field, not a save slot, not a despawn input, despite `Spawn.despawnTick`
  // (07l_spawn.js) already reading `e.persistent` for the OTHER "persistent" concept
  // (`SpawnGroup.isPersistent()`, CATEGORY-based, unrelated) and even `Spawn.DESPAWN_TYPES`'s
  // own `'unpersisted'` piglin row already reading `!e.persistent` -- both call sites were
  // silently reading an always-`undefined` field.
  // `grep -rl "setCanPickUpLoot(true)" .decomp/net/minecraft/entity/` names exactly SEVEN
  // classes calling it unconditionally from their own constructor/`initialize`: DolphinEntity,
  // FoxEntity, PandaEntity, AbstractPiglinEntity (piglin AND piglin_brute both extend it),
  // PillagerEntity, VillagerEntity. `MobEntity.java:106`'s own field default is false for
  // everything else, EXCEPT a `ZombieEntity`/`AbstractSkeletonEntity` subtype, whose own
  // `initialize` rolls it: `random.nextFloat() < 0.55F * getClampedLocalDifficulty()`
  // (ZombieEntity.java:444-445, AbstractSkeletonEntity.java:145) -- husk/drowned/
  // zombie_villager/zombified_piglin inherit ZombieEntity's roll (none overrides
  // `initialize`'s canPickUpLoot line, .decomp read whole) and stray/wither_skeleton inherit
  // AbstractSkeletonEntity's the same way. `Eq.clampedLocalDifficulty()` (07y_equip.js) is
  // this engine's own established `LocalDifficulty` stand-in, the same one Equip's own
  // armour-roll already uses for an identical `0.NN * clampedLocalDifficulty()` shape.
  EL.WITHER_SKELETON_ATTACK = 4.0;   // WitherSkeletonEntity.initialize's own setBaseValue(4.0)
  EL.PICKUP_LOOT_ALWAYS = { dolphin: 1, fox: 1, panda: 1, piglin: 1, piglin_brute: 1, pillager: 1, villager: 1 };

  // D-707 leftover unit (this pass) -- the types whose live in-tick behaviour (`Sq.tick`/
  // `Sq.travelMob`, 07zi_squid.js) is dispatched from INSIDE `EL.tickMob` by `e.type`, not
  // through a real `Ai.ROSTER`/goal-selector entry (07zi_squid.js's own header says why: their
  // two goals -- SwimGoal/EscapeAttackerGoal -- declare no control flags in the jar, so calling
  // them directly produces the identical result). `EL.tickOne`'s own `mob = !!e.ai` gate reads
  // this table too, so these two reach `EL.tickMob` despite carrying no `e.ai` at all -- fixed
  // this pass; a live-spawned glow_squid previously never reached `Sq.tick` and sat motionless.
  //
  // loop/mob-wiring-bat-fish (session 141) -- D-710 flagged the identical shape for the fish
  // family, and it checks out: `Fish.tick`/`Fish.travelMob` (07zj_fish.js) are ALREADY
  // dispatched from inside `EL.tickMob` by `e.type` (see the `NS.Fish.tick`/`NS.Fish.travelMob`
  // calls below), and cod/salmon/tropical_fish/pufferfish carry no `Ai.ROSTER` entry either (no
  // `Ai.ROSTER.cod`/`.salmon`/`.tropical_fish`/`.pufferfish` anywhere in 07k_goals.js) -- so
  // `e.ai` was never set for them and, same as the pre-fix glow_squid, this gate never routed
  // them into `EL.tickMob` at all. Confirmed by a node-level production-dispatch probe (spawn +
  // 60x `EL.tickOne`, mirroring squidcheck's own §10): all four sat at 0.0000 blocks moved
  // before this line added them.
  // loop/enderdragon-wiring -- the dragon has no goal selector at all (PhaseManager IS its
  // whole AI substrate, ED.tickEntity below), so `e.ai` is never attached at spawn -- the SAME
  // squid/fish gap this table's own header names (`e.ai` truthy was the ONLY door into
  // `EL.tickMob`); reusing this table rather than widening the `mob` gate itself.
  EL.WATER_TICK_ONLY = { squid: 1, glow_squid: 1, cod: 1, salmon: 1, tropical_fish: 1, pufferfish: 1, dolphin: 1, ender_dragon: 1 };
  // cloud/referee-plate-arrow -- a LivingEntity with NO goal selector at all: `ArmorStandEntity`
  // extends `LivingEntity` (not `MobEntity`), so it takes `LivingEntity.travel`'s move-then-
  // gravity-then-0.91-friction step (`Ph.travelMob` with no input) rather than the generic
  // gravity-first tail -- motionrefcheck's armor_stand_drop/armor_stand_thrown hold it to that.
  EL.LIVING_TICK_ONLY = { armor_stand: 1, giant: 1 };
  EL.VEL_CUT = 0.003;   // LivingEntity.field_30075
  EL.PICKUP_LOOT_ROLL = { zombie: 1, husk: 1, drowned: 1, zombie_villager: 1, zombified_piglin: 1,
    skeleton: 1, stray: 1, wither_skeleton: 1 };
  // `MobEntity.persistent` (field default false, MobEntity.java:107) has exactly one confirmed
  // in-engine setter today: `Tm.dyeCollar`'s own tamed-cat branch (07n_tame.js, D-492, pre-
  // existing) — `WolfEntity`/`TameableEntity` (.decomp, read whole) carry NO `setPersistent()`
  // call of their own, so a wolf's persistence is NOT a taming side effect; `NameTagItem`'s own
  // `setPersistent()` call (the vanilla name-tag path) and any trade-triggered path have no
  // matching in-engine ACTION yet (no name-tag-on-mob interaction exists in src/ at all) — named
  // on `Tame.OWED`/`Spawn.OWED` rather than guessed at here (rule: fix the read, not invent the
  // write, D-329).
  EL.mobStateDefaults = function (e, name, at) {
    if (!at) return;
    if (e.canPickUpLoot === undefined) {
      if (EL.PICKUP_LOOT_ALWAYS[name]) {
        e.canPickUpLoot = true;
      } else if (EL.PICKUP_LOOT_ROLL[name]) {
        var diff = (NS.Equip && NS.Equip.clampedLocalDifficulty) ? NS.Equip.clampedLocalDifficulty(NS.Equip.at ? NS.Equip.at(e) : undefined) : 1;
        e.canPickUpLoot = EL.randomOf(e)() < 0.55 * diff;
      } else {
        e.canPickUpLoot = false;
      }
    }
    if (e.persistent === undefined) e.persistent = false;
    // `MobEntity.initialize` (.decomp MobEntity.java:993-996), rolled BEFORE the left-hand roll: the
    // "Random spawn bonus" follow_range modifier, `nextGaussian() * 0.05`, MULTIPLY_BASE — so a
    // skeleton's 16 spreads ~14.1..17.8 (golden/mob-attributes.json). `Ai.followRangeOf` applies it on
    // top of the base (or a zombie's own MULTIPLY_TOTAL-bonused `e.followRange`). Box-Muller over two
    // draws, the same stand-in for java.util.Random.nextGaussian as 07z_potion.js's `gauss`.
    if (e.followBonus === undefined && name !== 'armor_stand') {
      e.followBonus = NS.U.polarGaussian(EL.randomOf(e)) * 0.05;
    }
    // D-671 — `MobEntity.initialize` (.decomp MobEntity.java:992-1003), every mob on every
    // initialize path (natural, /summon, egg, spawner): `nextFloat() < 0.05F` left-handed. An
    // armor stand is a LivingEntity, not a MobEntity. A reload carries its own (MobNbt COMMON).
    if (e.leftHanded === undefined && name !== 'armor_stand') e.leftHanded = EL.randomOf(e)() < 0.05;
    // D-671 — `PatrolEntity.initialize` (.decomp PatrolEntity.java:74-86): any spawn reason but
    // PATROL / EVENT (raid) / STRUCTURE rolls `nextFloat() < 0.06F` patrol leader if canLead()
    // (witch and ravager override it false) — a /summon'ed or egg pillager is a banner captain
    // 6% of the time. Patrols and raids assign their own leader (07x_patrol.js, 07s_raid.js).
    if (EL.PATROL_CAN_LEAD[name] && e.patrolLeader === undefined) {
      var why = EL._spawnReason;
      if (why !== 'patrol' && why !== 'event' && why !== 'structure' && EL.randomOf(e)() < 0.06) {
        e.patrolLeader = true;
        e.ominousBanner = true;
        e.headItem = 'ominous_banner';
        var Eq = NS.Equip, IT = NS.Items;
        if (Eq && Eq.ready && IT && IT.ready && Eq.getOminousBanner) {
          Eq.setEquipped(e, IT.HEAD, Eq.getOminousBanner());
          Eq.setDropChance(e, IT.HEAD, 2.0);
        }
      }
      if (e.patrolLeader === undefined) e.patrolLeader = false;   // saved as false: a reload never re-rolls
    }
  };
  EL.PATROL_CAN_LEAD = { pillager: 1, vindicator: 1, evoker: 1, illusioner: 1 };
  // s133 -- HostileEntity babies (ZombieEntity/PiglinEntity/ZoglinEntity keep a BABY data-tracker flag,
  // not PassiveEntity's breeding age): EL.tick skips Breed.tickAge for them.
  EL.PERMANENT_BABY = { zombie: 1, husk: 1, drowned: 1, zombie_villager: 1, zombified_piglin: 1, piglin: 1, zoglin: 1 };
  EL.ZOMBIE_BABY_ROLL = { zombie: 1, husk: 1, drowned: 1, zombie_villager: 1, zombified_piglin: 1 };

  /** `PrimedTnt.setFuse(80)` — four seconds, and its synched-data default is the same 80. */
  EL.TNT_FUSE = 80;

  EL.remove = function (e) {
    if (!e) return false;
    // loop/slime-s97 -- `SlimeEntity.remove(RemovalReason)` (.decomp, read whole): a size>1
    // slime that DIED splits into 2-4 smaller slimes at the exact moment it leaves the world --
    // this is that one moment (`Cb.tickEntity`'s own `Cb.DEATH_TICKS` timeout is the only live
    // caller that ever sets `e.dead` first, so `e.dead` here IS vanilla's own `isDead()` gate).
    // A DESPAWNING live slime (07l_spawn.js's own distance/roll despawn, `e.dead` false) must
    // NOT split -- that gate is the whole reason this checks `e.dead` and not just `e.type`.
    if (e.dead && (e.type === 'slime' || e.type === 'magma_cube') && NS.Slime && NS.Slime.ready) {
      NS.Slime.split(e, EL.spawn);
    }
    // loop/vsleep -- `VillagerEntity.onDeath` (.decomp/net/minecraft/entity/passive/
    // VillagerEntity.java:624-628, read whole) releases every POI ticket a villager holds
    // (`releaseAllTickets`) at the moment of death -- the exact same "one real death/removal
    // fact, hooked at this file's own one removal choke point" shape every case above already
    // uses (slime split, enderman's carried block). `e.dead` (not despawn) is deliberate, the
    // same gate the slime-split case above already reasons through: a villager that quietly
    // despawns (07l_spawn.js) is not a `VillagerEntity.onDeath` call and must not release its
    // claim as if it were. `07zv_villagerbrain.js` (`NS.VB`) owns what "release" means; this
    // file only supplies the hook `VB.OWED` named as its own missing piece.
    if (e.dead && e.type === 'villager' && NS.VB && NS.VB.releaseAllTickets) {
      NS.VB.releaseAllTickets(e);
    }
    e.removed = true;
    return true;
  };
  EL.count = function () { return EL.list ? EL.list.length : 0; };
  EL.all = function () { return EL.list ? EL.list.slice() : []; };
  EL.byId = function (id) {
    if (!EL.list) return null;
    for (var i = 0; i < EL.list.length; i++) if (EL.list[i].id === id) return EL.list[i];
    return null;
  };
  EL.clear = function () { if (EL.list) EL.list.length = 0; };

  /**
   * One entity, one tick.
   *
   * ⚠⚠ THE ORDER IS GRAVITY, THEN MOVE, THEN DRAG, and it is not the order intuition suggests.
   * `FallingBlockEntity.tick` is, in full:
   *     setDeltaMovement(getDeltaMovement().add(0, -0.04, 0));
   *     move(MoverType.SELF, getDeltaMovement());
   *     setDeltaMovement(getDeltaMovement().scale(0.98));
   * Applying drag before the move, or gravity after it, gives a trajectory that is close enough
   * to look right and wrong in the third decimal for ever — and there is no rule test that can
   * tell the two apart, only a tick-by-tick comparison against the arithmetic.
   *
   * ⚠ THE PLAYER'S OWN TICK IS **NOT** THIS FUNCTION. `Physics.tick(e, cmd)` handles input,
   * sprinting, poses, fluids and jumping; this is the motion an entity with no will has.
   */
  // ── ITEM ENTITIES (D-333) ─────────────────────────────────────────────────────────────────
  // ⚠⚠ **A BROKEN BLOCK DID NOT DROP ANYTHING — IT TELEPORTED INTO YOUR POCKET.** Dan, session
  // 11: *"items dont drop as block entities"*. `breakBlock` computed the real 1.18.2 loot and
  // handed it straight to `Inventory.add`, so the whole middle of Minecraft's loop — the thing
  // falls, it bobs, you walk over it, it flies to you — did not exist. It is also G17c's own
  // named gap: **nothing had ever spawned an entity during play**, so the renderer built last
  // session drew an empty list in every real game.
  //
  // ⚠ EVERY CONSTANT HERE IS OUT OF `ItemEntity`'s BYTECODE (obfuscated `bli`), not remembered:
  // the four-argument constructor is
  // `this(level, x, y, z, stack, random()*0.2 - 0.1, 0.2, random()*0.2 - 0.1)` — a `ldc2_w 0.2`,
  // a `dmul`, a `ldc2_w 0.1`, a `dsub`, twice, with a bare 0.2 up the middle — and the lifetime
  // is the `sipush 6000` that discards it.
  // ⚠ AN INJECTION POINT, NOT A CONVENIENCE. A check that wants to assert the pop velocity
  // cannot do it against `Math.random`, and a check that swaps in its own generator is testing
  // the arithmetic rather than the luck. Left null in the game.
  EL.random = null;
  /** The entity's own stream (`Entity.random`), as a () => double like `EL.random`. */
  /** The world's own stream (ServerWorld.random), a JRandom seeded from the world seed; () => double. */
  var wrState = null, wrSeed = null;
  EL.wr = function () {
    var sd = (NS.World && NS.World.seed64) || 0n;
    if (!wrState || wrSeed !== sd) { wrSeed = sd; wrState = NS.JRandom ? new NS.JRandom(BigInt.asIntN(64, sd ^ 0x5DEECE66Dn)) : null; }
    return wrState ? wrState.nextDouble() : 0.5;
  };
  EL.randomOf = function (e) { var r = e && e.random; if (EL.random) return EL.random; return r ? function () { return r.nextDouble(); } : (EL.random || EL.wr); };

  EL.ITEM_LIFETIME = 6000;          // five minutes, then it is gone
  EL.ITEM_PICKUP_DELAY = 10;        // setDefaultPickUpDelay
  // ⚠ 32767 IS VANILLA'S "NEVER", NOT A BIG NUMBER. `ItemEntity.tick` counts the delay down with
  // `if (this.pickupDelay > 0 && this.pickupDelay != 32767)`, and `setNeverPickUp()` sets exactly
  // this. It is what a display item uses — and what a check that wants to photograph a dropped
  // item needs, now that walking near one takes it.
  EL.PICKUP_NEVER = 32767;
  EL.ITEM_POP_SPREAD = 0.2;         // random() * 0.2 - 0.1, horizontally
  EL.ITEM_POP_UP = 0.2;             // and straight up
  EL.ITEM_MERGE_BOX = 0.5;          // mergeWithNeighbours: inflate(0.5, 0.0, 0.5)
  EL.ITEM_MERGE_MOVED = 2;          // ItemEntity.tick: merge tried every 2nd tick when the block cell changed...
  EL.ITEM_MERGE_RESTING = 40;       // ...else every 40th
  EL.BLOCK_POP_JITTER = 0.25;       // Block.popResource: +- 0.25 inside the broken cell

  /**
   * dropStack(x, y, z, item, count) — vanilla's `new ItemEntity(level, x, y, z, stack)`.
   * ⚠ THE POSITION IS THE ENTITY'S FEET AND VANILLA'S IS ITS CENTRE. `popResource` subtracts half
   * the item entity's height before constructing it; `EL.spawn` takes a feet position, so the
   * caller passes what it wants the feet to be and the half-height is handled in `popResource`.
   */
  EL.dropStack = function (x, y, z, item, count, opts) {
    if (!EL.ready) return null;
    var rnd = (EL.random || Math.random);
    var e = EL.spawn('item', x, y, z, { item: item, count: count | 0 });
    if (!e) return null;
    e.vx = rnd() * EL.ITEM_POP_SPREAD - EL.ITEM_POP_SPREAD * 0.5;
    e.vy = EL.ITEM_POP_UP;
    e.vz = rnd() * EL.ITEM_POP_SPREAD - EL.ITEM_POP_SPREAD * 0.5;
    e.pickupDelay = EL.ITEM_PICKUP_DELAY;
    if (opts && opts.vx !== undefined) { e.vx = opts.vx; e.vy = opts.vy; e.vz = opts.vz; }
    if (opts && opts.pickupDelay !== undefined) e.pickupDelay = opts.pickupDelay | 0;
    if (opts && opts.tag) e.tag = opts.tag;
    if (opts && opts.d) e.d = opts.d;
    if (EL.dropTrace) EL.dropTrace.push([item, count | 0]);   // lockstep trace: ItemEntity list after a kill (#6258)
    return e;
  };

  /**
   * popResource(bx, by, bz, item, count) — `Block.popResource`, the call a broken block makes.
   * ⚠ The jitter is on all three axes and the Y one is measured from the CENTRE of the cell minus
   * half the item's height, which is why a dropped block sits ON the floor rather than in it.
   */
  EL.popResource = function (bx, by, bz, item, count, opts) {
    var rnd = (EL.random || Math.random);
    var J = EL.BLOCK_POP_JITTER;
    var E = NS.Entities;
    var dim = E && E.ready ? E.dimensions('item') : null;
    var half = dim ? dim.height * 0.5 : 0.125;
    var x = bx + 0.5 + (rnd() * 2 - 1) * J;
    var y = by + 0.5 + (rnd() * 2 - 1) * J - half;
    var z = bz + 0.5 + (rnd() * 2 - 1) * J;
    return EL.dropStack(x, y, z, item, count, opts);
  };

  /** Do these two item entities hold the same thing, and can they be combined? */
  EL.canMerge = function (a, b, maxStack) {
    if (!a || !b || a === b || a.removed || b.removed) return false;
    if (a.type !== 'item' || b.type !== 'item') return false;
    if (a.item !== b.item) return false;
    if ((a.owner || null) !== (b.owner || null)) return false;                 // Objects.equals(getOwner())
    if ((a.tag ? JSON.stringify(a.tag) : '') !== (b.tag ? JSON.stringify(b.tag) : '')) return false;   // same NBT
    var cap = maxStack || 64;
    return (a.count | 0) > 0 && (b.count | 0) > 0 && (a.count | 0) + (b.count | 0) <= cap;
  };

  /**
   * One item entity's own tick, on top of the motion every entity gets.
   * ⚠ THE DELAY COUNTS DOWN EVEN WHILE THE ITEM IS IN THE AIR, which is what stops a block you
   * just broke from being picked up before you can see it fall.
   */
  EL.tickItem = function (e) {
    if (e.pickupDelay > 0 && e.pickupDelay !== EL.PICKUP_NEVER) e.pickupDelay--;
    var moved = Math.floor(e.px) !== Math.floor(e.x) || Math.floor(e.py) !== Math.floor(e.y) || Math.floor(e.pz) !== Math.floor(e.z);
    if ((e.age % (moved ? EL.ITEM_MERGE_MOVED : EL.ITEM_MERGE_RESTING)) === 0 && EL.isMergable(e)) EL.mergeNear(e);
    if (e.age >= EL.ITEM_LIFETIME) EL.remove(e);
    else EL.tickHazards(e);
  };

  /** ItemEntity.isMergable: alive, not never-pickup, not infinite-age, under 6000 ticks old, not a full stack. */
  EL.isMergable = function (e) {
    if (e.removed || e.pickupDelay === EL.PICKUP_NEVER || e.age === -32768 || e.age >= EL.ITEM_LIFETIME) return false;
    var IT = NS.Items;
    var cap = (IT && IT.ready && e.item !== undefined && IT.maxStack) ? IT.maxStack(e.item) : 64;
    return (e.count | 0) < cap;
  };

  /**
   * mergeWithNeighbours: fold any stack of the same item within half a block into this one.
   * ⚠ WITHOUT IT A SIXTY-FOUR-BLOCK DIG IS SIXTY-FOUR ENTITIES, each with its own quads, its own
   * collision sweep and its own bob — which is both wrong and the cheapest way to make the frame
   * time depend on how fast the player is mining.
   */
  EL.mergeNear = function (e) {
    var IT = NS.Items;
    if (!EL.list || e.removed || e.type !== 'item') return 0;
    var cap = (IT && IT.ready && e.item !== undefined && IT.maxStack) ? IT.maxStack(e.item) : 64;
    if ((e.count | 0) >= cap) return 0;
    var R = EL.ITEM_MERGE_BOX, merged = 0;
    var hw = (e.width || 0.25) * 0.5;
    for (var i = 0; i < EL.list.length; i++) {
      var o = EL.list[i];
      if (!EL.canMerge(e, o, cap) || !EL.isMergable(o)) continue;
      // getEntitiesOfClass(box.inflate(0.5, 0, 0.5)): box INTERSECTION, not centre distance
      var ow = (o.width || 0.25) * 0.5;
      if (o.x - ow >= e.x + hw + R || o.x + ow <= e.x - hw - R) continue;
      if (o.z - ow >= e.z + hw + R || o.z + ow <= e.z - hw - R) continue;
      if (o.y >= e.y + e.height || o.y + o.height <= e.y) continue;
      // tryToMerge: the larger stack absorbs the smaller (ties: the other absorbs this one)
      var big = (o.count | 0) < (e.count | 0) ? e : o, small = big === e ? o : e;
      big.count = (big.count | 0) + (small.count | 0);
      big.pickupDelay = Math.max(big.pickupDelay | 0, small.pickupDelay | 0);
      // itemAge = min(itemAge, itemAge): `e` is mid-tick (age++ done, its itemAge++ still to come), `o` is at its itemAge either way
      var ia = Math.min(e.age - 1, o.age);
      big.age = big === e ? ia + 1 : ia;
      EL.remove(small);
      merged++;
      if (small === e) break;
      if ((e.count | 0) >= cap) break;
    }
    return merged;
  };

  /**
   * One MOB, one tick — `LivingEntity.tick()`'s own order (D-417).
   *
   *   age and the combat timers  →  `serverAiStep()` (the goal selector, which AIMS the mob)
   *   →  `travel()` (which is the only thing that MOVES it)  →  push  →  suffocate
   *
   * ⚠ THE GOALS RUN BEFORE THE TRAVEL AND AFTER THE COMBAT TIMERS, and all three orderings
   * matter. Goals after travel is a tick of lag on every heading; goals before the combat
   * timers is a goal that cannot see the hit it was just dealt (D-391's own reason).
   */
  EL.WATER_LANDS = true;   // #1495, below; spawnoceancheck's anti-vacuity turns it off, nothing else may (also gates Physics.travelMob's landing-in-water reset)
  // #3103: LivingEntity.baseTick's breath step (.decomp LivingEntity.java:357-380) for every mob whose
  // canBreatheInWater() is false. Dolphin/axolotl keep their own 4800-scale counters; the iron golem
  // overrides getNextAirUnderwater to the identity (IronGolemEntity.java:103), so it never drowns.
  EL.BREATHES_WATER = { dolphin: 1, axolotl: 1, squid: 1, glow_squid: 1, cod: 1, salmon: 1, pufferfish: 1,
    tropical_fish: 1, guardian: 1, elder_guardian: 1, turtle: 1, iron_golem: 1 };
  // Entity.attemptTickInVoid (.decomp Entity.java:469): y < bottomY - 64 (-64 - 64 = -128 here); LivingEntity.tickInVoid
  // (:1807) is damage(OUT_OF_WORLD, 4.0F). The fire half of baseTick runs first (Cb.tickEntity), then this, then the breath step.
  EL.VOID_Y = -128;
  EL.tickInVoid = function (e) {
    if (e.maxHealth !== undefined && !e.dead && e.y < EL.VOID_Y && NS.Combat && NS.Combat.hurt) {
      NS.Combat.hurt(e, 4.0, undefined, false, { source: 'outOfWorld', bypassArmor: true });   // DamageSource.OUT_OF_WORLD = bypassesArmor + bypassesInvul
    }
  };
  EL.tickMobAir = function (e) {
    var bare = NS.Entities.bare(e.type);
    if (EL.BREATHES_WATER[bare] || (NS.Effects && NS.Effects.isUndead(e))) return;
    if (e.air === undefined) e.air = 300;
    if (e.eyeInWater && !e.eyeInBubble && !(NS.Effects && NS.Effects.hasWaterBreathing(e))) {
      e.air -= 1;
      if (e.air === -20) {
        e.air = 0;
        if (NS.Combat && NS.Combat.hurt) {
          NS.Combat.hurt(e, 2.0, undefined, false, { source: 'drown' });
          // #9247: baseTick drowns BEFORE aiStep counts hurtTime / timeUntilRegen down, so the real server logs HurtTime 9 on the hit tick (Cb.tickEntity already ran this tick here)
          if (e.hurtTime === NS.Combat.HURT_DURATION) { e.hurtTime--; if (e.invulnerableTime > 0) e.invulnerableTime--; }
        }
      }
    } else if ((!e.eyeInWater || e.eyeInBubble) && e.air < 300) e.air = Math.min(e.air + 4, 300);
  };

  /**
   * Block hazards on a non-player mob (#4016), ported from .decomp: MagmaBlock.onSteppedOn (HOT_FLOOR 1, on ground),
   * CampfireBlock.onEntityCollision (lit: IN_FIRE 1 / soul 2), WitherRoseBlock.onEntityCollision (Wither 40 ticks, not
   * peaceful), AbstractFireBlock.onEntityCollision (fireTicks+1, ==0 -> 8 s alight, IN_FIRE 1 / soul 2),
   * Entity.setOnFireFromLava (15 s + LAVA 4) and LivingEntity.tickMovement's freezing (140 ticks, FREEZE every 40 by age).
   * ponytail: no Frost Walker (mobs never wear it); blocks are read from the box shrunk 1e-3 like checkBlockCollision.
   */
  EL.FREEZE_EXTRA = { strider: 1, blaze: 1, magma_cube: 1 };
  /** Items.<clinit> `.fireproof()` (13 items, read from .decomp Items.java): ItemEntity.fireImmune(). */
  EL.FIRE_PROOF = { ancient_debris: 1, netherite_block: 1, netherite_ingot: 1, netherite_scrap: 1, netherite_sword: 1,
    netherite_shovel: 1, netherite_pickaxe: 1, netherite_axe: 1, netherite_hoe: 1, netherite_helmet: 1,
    netherite_chestplate: 1, netherite_leggings: 1, netherite_boots: 1 };
  EL.itemName = function (e) {
    var it = e.item;
    if (it && typeof it === 'object') return it.name;
    if (typeof it === 'string') return it;
    var IT = NS.Items; return IT && IT.nameOf && it !== undefined ? IT.nameOf(it) : undefined;
  };
  EL.itemFireImmune = function (e) { return !!EL.FIRE_PROOF[EL.itemName(e)]; };
  /** ItemEntity.hurt: fire-immune vs fire, nether star vs explosion -> false; else health = (int)(health - amount), discard at <= 0. */
  EL.hurtItem = function (e, amount, src) {
    if (e.removed) return false;
    if (src && src.fire && EL.itemFireImmune(e)) return false;
    if (src && src.explosive && EL.itemName(e) === 'nether_star') return false;
    if (e.health === undefined) e.health = 5;
    e.health = Math.trunc(e.health - amount);
    if (e.health <= 0) EL.remove(e);
    return true;
  };
  // Entity.setOnFireFromLava: playSound(ENTITY_GENERIC_BURN, 0.4, 2.0 + nextFloat * 0.4)
  EL.lavaBurnSound = function (e) {
    if (NS.Sound && NS.Sound.play && !e.silent) NS.Sound.play('entity.generic.burn', { x: e.x, y: e.y, z: e.z, volume: 0.4, pitch: 2.0 + Math.random() * 0.4, source: 'neutral' });
  };
  EL.igniteItem = function (e, sec) { if (!(e.remainingFireTicks > sec * 20)) e.remainingFireTicks = sec * 20; };
  EL.tickHazards = function (e) {
    var W = NS.World, R = NS.Reg, St = NS.States, Cb = NS.Combat;
    var pl = e.type === 'player', itm = e.type === 'item';   // the player hurts through Survival.hurt (armour, Fire Protection, gamemode gate)
    if (e.dead && !e.removed && !pl && !itm && W && W.getBlock && Cb && e.maxHealth !== undefined) {   // a mob killed earlier this tick (its own ON_FIRE hit) still moves: AbstractFireBlock.onEntityCollision still counts its fire ticks
      var chw = (e.width || 0.6) / 2 - 0.001, chh = (e.height || 1.8) - 0.001;
      for (var cx = Math.floor(e.x - chw); cx <= Math.floor(e.x + chw); cx++)
        for (var cy = Math.floor(e.y + 0.001); cy <= Math.floor(e.y + chh); cy++)
          for (var cz = Math.floor(e.z - chw); cz <= Math.floor(e.z + chw); cz++) {
            var cs = W.getBlock(cx, cy, cz), cb = cs > 0 ? St.block[cs] : 0;
            if ((cb === R.id.fire || cb === R.id.soul_fire) && !Cb.fireImmuneOf(e)) e.remainingFireTicks = (e.remainingFireTicks === undefined ? -1 : e.remainingFireTicks) + 1;
          }
      return;
    }
    if ((e.maxHealth === undefined && !pl && !itm) || e.dead || e.removed || !W || !W.getBlock || !Cb) return;
    var imm = itm ? EL.itemFireImmune(e) : Cb.fireImmuneOf(e), hit = function (amt, src) { if (itm) EL.hurtItem(e, amt, src); else if (pl) NS.Survival.hurt(e, src.source, amt); else Cb.hurt(e, amt, undefined, false, (src.source === 'inFire' || src.source === 'onFire' || src.source === 'freeze') ? Object.assign({ bypassArmor: true }, src) : src); };   // IN_FIRE / ON_FIRE / FREEZE setBypassesArmor
    if (itm) Cb.wetExtinguish(e);
    if (itm && e.remainingFireTicks > 0) {   // Entity.baseTick's fire half: ON_FIRE 1 every 20 ticks (not in lava), then the count falls
      if (imm) e.remainingFireTicks = Math.max(0, e.remainingFireTicks - 4);
      else {
        var inLv = NS.Physics && NS.Physics.blockAt && St.block[NS.Physics.blockAt(e.x, e.y + 0.1, e.z)] === R.id.lava;
        if (e.remainingFireTicks % 20 === 0 && !inLv) hit(1, { source: 'onFire', fire: true });
        e.remainingFireTicks--;
      }
    }
    if (!itm && e.onGround && !imm && !(e.frostWalker > 0) && !Cb.bypassesSteppingEffects(e)) {   // Entity.move: the block under the feet (y - 0.2) gets onSteppedOn
      var u = W.getBlock(Math.floor(e.x), Math.floor(e.y - 0.2), Math.floor(e.z));
      if (u > 0 && St.block[u] === R.id.magma_block) hit(1, { source: 'hotFloor', fire: true });
    }
    if (itm && NS.Physics && NS.Physics.blockAt) {   // Entity.isInLava reads the fluid height of the PREVIOUS tick's update: the hurt lags the dip by one tick
      var wasLava = e.lavaPrev;
      e.lavaPrev = St.block[NS.Physics.blockAt(e.x, e.y + 0.1, e.z)] === R.id.lava;
      if (wasLava && !imm) { EL.lavaBurnSound(e); EL.igniteItem(e, 15); hit(4, { source: 'lava', fire: true }); }   // Entity.setOnFireFromLava -> hurt(LAVA, 4)
    }
    var hw = (e.width || 0.6) / 2 - 0.001, ht = (itm && e.restSkipped) ? -1 : (e.height || 1.8) - 0.001, rose = false;
    for (var x = Math.floor(e.x - hw); x <= Math.floor(e.x + hw); x++)
      for (var y = Math.floor(e.y + 0.001); y <= Math.floor(e.y + ht); y++)
        for (var z = Math.floor(e.z - hw); z <= Math.floor(e.z + hw); z++) {
          var st = W.getBlock(x, y, z); if (!(st > 0)) continue;
          var b = St.block[st];
          if (b === R.id.fire || b === R.id.soul_fire) {
            if (imm) continue;
            var ft = (e.remainingFireTicks === undefined ? -1 : e.remainingFireTicks) + 1;
            e.remainingFireTicks = ft;
            if (ft === 0) Cb.igniteForSeconds(e, 8);
            hit(b === R.id.fire ? 1 : 2, { source: 'inFire', fire: true });
          } else if ((b === R.id.campfire || b === R.id.soul_campfire) && !imm && !(e.frostWalker > 0) && R.valueNames[St.propValue(st, R.PROP.lit)] === 'true') {
            hit(b === R.id.campfire ? 1 : 2, { source: 'inFire', fire: true });
          } else if (b === R.id.cactus && itm) {   // CactusBlock.onEntityCollision: hurt(CACTUS, 1)
            hit(1, { source: 'cactus' });
          } else if (b === R.id.wither_rose && !rose) {
            rose = true;
            var D = NS.Diff && NS.Diff.get && NS.Diff.get();
            if (D !== 'peaceful' && NS.Effects && NS.Effects.canHaveStatusEffect(e, 'wither')) NS.Effects.addStatusEffect(e, 'wither', 40, 0);
          }
        }
    if (itm) return;   // ItemEntity: no wither rose / freezing; lava + fire above went through hurtItem
    if (e.inLava && !imm) { EL.lavaBurnSound(e); Cb.igniteForSeconds(e, 15); hit(4, { source: 'lava', fire: true }); }
    // freezing: Cb.tickPowderSnow sets inPowderSnow; canFreeze = not freeze-immune, no leather armour
    Cb.tickPowderSnow(e);
    var can = !(NS.Ai && !NS.Ai.canFreeze(e)), Eq = NS.Equip, IT = NS.Items;
    if (can && Eq && IT) for (var sl = 0; sl < 4; sl++) {
      var it = Eq.getEquipped(e, [IT.FEET, IT.LEGS, IT.CHEST, IT.HEAD][sl]), nm = it && IT.nameOf(it.i);
      if (nm && nm.indexOf('leather_') === 0 && nm !== 'leather_horse_armor') can = false;
    }
    var fz = e.frozenTicks | 0;
    e.frozenTicks = e.inPowderSnow && can ? Math.min(140, fz + 1) : Math.max(0, fz - 2);
    if (e.age % 40 === 0 && e.frozenTicks >= 140 && can) hit(EL.FREEZE_EXTRA[e.type] ? 5 : 1, { source: 'freeze' });
  };

  EL.tickMob = function (e) {
    var Ph = NS.Physics;
    // #6336: MobEntity.checkDespawn runs just before the entity's own tick (ServerWorld.tickEntities)
    if (NS.Spawn && NS.Spawn.ready && NS.Spawn.despawnOne(e)) return;
    e.age++;
    // #9250: the void hit is baseTick, BEFORE aiStep counts hurtTime / timeUntilRegen down: the real server hurts at the full timer (HurtTime 9 logged on the
    // hit tick, next hit 11 ticks later), so it runs ahead of Cb.tickEntity's countdown
    EL.tickInVoid(e);
    if (e.maxHealth !== undefined && NS.Combat) NS.Combat.tickEntity(e);
    Ph.updateFluids(e);            // `baseTick`, before the goals and before the travel
    // the mob's own eye height, not the player's Ph.EYE (a pig floating at the surface is submerged at 0.55)
    if (NS.Combat && NS.Combat.eyeHeightOf) { Ph.eyeWater(e, NS.Combat.eyeHeightOf(e)); }
    EL.tickMobAir(e);
    EL.tickHazards(e);
    // #1495: `Entity.checkWaterState` -> `onLanding()` every tick it touches water (.decomp Entity.java:1061-1069).
    // Missing, a pig bobbing (SwimGoal) in a 1-deep swamp pool banked fallDistance and died of FALL damage.
    if (e.inWater && EL.WATER_LANDS) e.fallDistance = 0;
    // ⚠ `bcw.a()`'s LAST ELSE — `mob.setZza(0)` (D-417). MoveControl drops back to WAIT after
    // every MOVE_TO, so a mob that no goal steers THIS tick has no forward input at all. Without
    // this a mob keeps accelerating on the last order it was ever given: a baby cow told to stop
    // three blocks from its mother walks straight into her, for ever.
    e.zza = 0;
    e.moveMod = 0;   // MoveControl back to WAIT; Ai.stepToward re-issues it (#215)
    e.navigating = false;   // re-asserted by Ai.stepToward each tick a path is followed (D-422)
    // #216: xxa is NOT reset — vanilla's sidewaysSpeed persists after a strafe and decays *0.98/tick (LivingEntity.tickMovement)
    // ⚠ D-422 — WHERE THIS TICK STARTED, for `Ai.BodyRotationControl`. Vanilla's
    // `BodyRotationControl.isMoving()` compares the mob's position with `xOld`/`zOld`, which is
    // how it tells "walking" from "standing and looking about" — two completely different
    // rules for where the body points. Nothing in this engine tracked a previous position, so
    // it is taken here, at the top of the tick, before anything can move.
    e.xOld = e.x; e.zOld = e.z;
    // LivingEntity.tickMovement (.decomp LivingEntity.java:2493-2505, before the AI and the travel):
    // each velocity axis under `field_30075` (0.003) snaps to 0 -- why a thrown armor stand STOPS
    // sliding (motionrefcheck armor_stand_thrown) instead of decaying forever. ⚠ Vanilla does this
    // for EVERY LivingEntity; widening it past `EL.LIVING_TICK_ONLY` turned avoidrefcheck's
    // fox_wolf_6 into "does not flee" (18 -> 20 reds, cloud referee-plate-arrow hand-off), so the
    // mob half is left to the avoid/panic item rather than landed blind here.
    if (EL.LIVING_TICK_ONLY[e.type]) {
      if (Math.abs(e.vx) < EL.VEL_CUT) e.vx = 0;
      if (Math.abs(e.vy) < EL.VEL_CUT) e.vy = 0;
      if (Math.abs(e.vz) < EL.VEL_CUT) e.vz = 0;
    }
    // G18e — `AgeableMob.tick`'s own half runs BEFORE the goals (it is in `tick`, not in
    // `aiStep`), and `Animal.aiStep`'s love countdown runs AFTER them, which is where the jar
    // puts it: `Animal.aiStep` calls `super.aiStep()` — the goal tick — and only then counts
    // love down. Splitting them is the difference between a mate found this tick and one found
    // next tick, on the tick love expires.
    // loop/turtle-s102 (QUEUE 0.2 G18 mobs) -- `TurtleEntity.onGrowUp` (.decomp lines
    // 306-311): the scute drop needs the age value from BEFORE `Breed.tickAge`'s own
    // -1->0 walk this tick, since that call is what performs the crossing -- captured here,
    // the same "before/after the SAME call" shape this file's own `xOld`/`zOld` comment
    // just above already uses for a different field.
    var turtleWasBaby = (e.type === 'turtle' && NS.Breed && NS.Breed.ready) ? NS.Breed.isBaby(e) : false;
    // s133 -- only a PassiveEntity ages (AgeableMob.tick). A baby zombie/piglin/zoglin is a BABY
    // FLAG on a HostileEntity and never grows up; it walked to adult in 20 minutes here.
    if (NS.Breed && NS.Breed.ready && !EL.PERMANENT_BABY[e.type]) NS.Breed.tickAge(e);
    if (turtleWasBaby && NS.Breed.getAge(e) === 0 && NS.Turtle && NS.Turtle.ready) NS.Turtle.onGrowUp(e);
    if (e.type === 'turtle' && NS.Turtle && NS.Turtle.ready) NS.Turtle.tick(e);
    // s115 -- EndermiteEntity.tickMovement's server half: lifeTime++ unless persistent, discard at 2400.
    if (e.type === 'endermite' && NS.Endermite && NS.Endermite.tick(e)) return;
    if (!e.dead) {
      // s135: no mob holds a creative/spectator/peaceful player as its target (Ai.canTargetLiving)
      if (NS.Ai && NS.Ai.dropUntargetable) NS.Ai.dropUntargetable(e);
      // D-707 leftover unit (this pass): squid/glow_squid now reach this function with NO
      // `e.ai` at all (see the `EL.WATER_TICK_ONLY` gate above) -- they have no goal selector
      // to tick, by design, so this is skipped for them rather than crashing on `undefined.tick`.
      // #4382: CreeperEntity.tick() runs the fuse BEFORE super.tick() (goals), so a fuseSpeed the goal writes in tick N is first consumed in N+1.
      if (e.type === 'creeper' && NS.Creeper && NS.Creeper.ready) NS.Creeper.tick(e);
      // loop/witchpotion-s95 -- `WitchEntity.tickMovement()`'s own drink state machine
      // runs OUTSIDE the goal selector every tick regardless (07z_potion.js's own header).
      // #4555: it runs BEFORE super.tickMovement() -> goalSelector, so the goals see this tick's DRINKING/raid cooldown.
      if (NS.Potion && NS.Potion.tickWitchDrink) NS.Potion.tickWitchDrink(e, EL.aiCtx(e));
      // RavagerEntity.isImmobile: no goal runs, jumping/input zeroed; only the tick state machine does
      var wasStunned = e.type === 'ravager' && e.ravagerStunTick > 0;   // #3139: vanilla spawns after the decrement, incl. the 1->0 tick
      if (NS.Ai && NS.Ai.forgiveDeadPlayer) NS.Ai.forgiveDeadPlayer(e);   // Angerable.tickAngerLogic: forgiveDeadPlayers
      if (e.ai && e.ravagerImmobile && e.ravagerTickMovement) { e.jumping = false; e.ravagerTickMovement(); }   // #4341: input jump zeroed first; RavagerEntity's collision hop is a direct jump() and survives
      else if (e.ai && !e.aiDisabled) e.ai.tick();   // Mob.serverAiStep: GoalSelector/targetSelector are not ticked while isNoAi() (and travel is skipped, #9462)
      if ((e.type === 'cat' || e.type === 'ocelot') && NS.Ai && NS.Ai.felinePose) NS.Ai.felinePose(e);   // #215: mobTick
      if (e.type === 'cat' && NS.EntityRender && NS.EntityRender.tickCatAnim) NS.EntityRender.tickCatAnim(e);   // #1317
      if (NS.Ai && NS.Ai.dropUntargetable) NS.Ai.dropUntargetable(e);
      if (NS.Breed && NS.Breed.ready) NS.Breed.tickLove(e);
      if (e.spellTicks > 0 && NS.Spell && NS.Spell.tickParticles) NS.Spell.tickParticles(e);   // #651
      if (wasStunned) EL.ravagerStunParticles(e);   // #1023
      if (e.spellTicks > 0 && NS.Spell && NS.Spell.mobTick) NS.Spell.mobTick(e);   // #1126
      if (e.type === 'illusioner' && NS.Spell && NS.Spell.tickMirror) NS.Spell.tickMirror(e);   // #1017
      if (NS.Trade && NS.Trade.ready) NS.Trade.tick(e);      // D-484: villager xp/level/restock
      if (NS.Village && NS.Village.ready) NS.Village.tick(e);   // ROW 0.2 REMAINDER: gossip decay + golem summon
      // loop/sleep-s104 -- villager SLEEP + MEETING-POINT steering (07zv_villagerbrain.js).
      // Runs AFTER Village.tick above, same order Trade.tick/Village.tick already run in --
      // Village.canSummonGolem's own hasRecentlySlept read this tick sees whatever e.vbLastSlept
      // this villager's sleep set on an EARLIER tick (sleeping happens here, this call, not
      // instantaneously the moment REST begins), the same one-tick-old-memory shape vanilla's
      // own Brain memories already have relative to any single Task's own run() this tick. No
      // ready check, self-inits on first call -- same registration style Poi.tick's own live
      // caller uses (07s_raid.js): a one-line registration, not a new hook.
      if (NS.VB && NS.VB.tick) NS.VB.tick(e);
      // D-773 cloud unit (tender-carson-7zokog) -- `ShulkerEntity.tick()` after `super.tick()`:
      // tickOpenProgress (the lid the renderer draws) and the client teleport-slide countdown.
      if (e.type === 'shulker' && NS.ShulkerDraw && NS.ShulkerDraw.ready && NS.ShulkerDraw.tick(e) && NS.Shulker.moveEntities) NS.Shulker.moveEntities(e);
      // loop/slime-s97 -- `SlimeEntity.onPlayerCollision`/`damage()` (.decomp, read whole):
      // touching a live player is checked every tick a size>1 slime is alive, same "after the
      // goals" slot Cr.tick/Trade.tick/Village.tick already occupy.
      if ((e.type === 'slime' || e.type === 'magma_cube') && NS.Slime && NS.Slime.ready) NS.Slime.tickStretch(e);
      if ((e.type === 'slime' || e.type === 'magma_cube') && NS.Slime && NS.Slime.ready) NS.Slime.tickTouch(e, EL.aiCtx(e));
      // `MobEntity.baseTick`'s ambient-sound roll, evoker voice (EvokerEntity.getAmbientSound).
      if (e.type === 'evoker' && NS.Spell && NS.Spell.tickAmbient) NS.Spell.tickAmbient(e);
      // #742 -- every OTHER mob's ambient roll + step sound (07zzp_mobvoice.js; ghast/shulker/evoker keep their own).
      if (NS.MobVoice) NS.MobVoice.tick(e);
      // loop/raidvex-s96 -- `VexEntity.tick()`'s own life-ticks half (a SUMMONED vex only --
      // `Fl.tickVexLife`'s own header names why `e.vexAlive` gates it, 07t_fly.js).
      if (e.type === 'vex' && NS.Fly && NS.Fly.tickVexLife) NS.Fly.tickVexLife(e, EL.aiCtx(e));
      // ⚠ AFTER THE GOALS, BEFORE THE TRAVEL, which is vanilla's own order: `Mob.serverAiStep`
      // ticks the goal selector and THEN the look control, so a goal's request this tick is
      // acted on this tick rather than one late.
      // D-533 (G18c) -- `BatEntity.mobTick()` is the bat's whole AI (no goals registered); it
      // runs in `mobTick`'s slot, i.e. with the goal selector, before the travel.
      if (e.type === 'bat' && NS.Bat && NS.Bat.ready) NS.Bat.mobTick(e);
      // loop/enderman-s98 -- `EndermanEntity.mobTick()`'s own daytime-teleport-away half and
      // `hurtByWater`'s per-tick DROWN damage (07zg_enderman.js), same mobTick-slot standing
      // the bat's own line above already established.
      if (e.type === 'enderman' && NS.Enderman && NS.Enderman.ready) NS.Enderman.mobTick(e);
      // loop/snowgolem -- `SnowGolemEntity.tickMovement`'s own hot-biome fire damage +
      // snow-layer trail, and `hurtByWater()`'s generic per-tick DROWN damage (07zq_snowgolem.js),
      // the SAME mobTick-slot standing bat/enderman's own lines above already establish.
      // `EL.aiCtx(e)` is passed for its `.mobGriefing()` reader only, the same shape
      // `NS.Slime.tickTouch(e, EL.aiCtx(e))` two lines up already uses.
      if (e.type === 'wolf' && NS.WolfShake && NS.WolfShake.ready) NS.WolfShake.tick(e);   // #909 WolfEntity.tick/tickMovement shake
      if (e.type === 'snow_golem' && NS.SnowGolem && NS.SnowGolem.ready) NS.SnowGolem.mobTick(e, EL.aiCtx(e));
      // loop/rabbit-s98 (QUEUE 0.2 G18c) -- `RabbitEntity.mobTick`'s hop-timing state
      // machine runs EVERY tick alongside the goal selector (unlike bat, a rabbit HAS real
      // goals -- `e.ai.tick()` above already ran them this tick; this only supplies the
      // periodic jump trigger vanilla's own `mobTick` override adds on top).
      if (e.type === 'rabbit' && NS.Rabbit && NS.Rabbit.ready) NS.Rabbit.mobTick(e);
      // loop/fox-s99 (QUEUE 0.2 G18c) -- `FoxEntity.tickMovement`'s own sleeping-freezes-
      // input half (.decomp, read in full: `if (isSleeping() || isImmobile()) { jumping =
      // sidewaysSpeed = forwardSpeed = 0; }`) runs EVERY tick alongside the goal selector,
      // the same mobTick-slot standing rabbit's own line above already established -- a
      // sleeping fox's own `Fx.SleepByDayGoal` (07zj_fox.js) already zeroed `e.jumping`
      // once on `start()`, but a later goal (or the physics step) can set it again before
      // this runs, which is exactly why vanilla re-clamps it every tick rather than once.
      if (e.type === 'fox' && NS.Fox && NS.Fox.ready) { NS.Fox.tickSleeping(e); NS.Fox.mobTick(e); }
      // #4001 -- HorseBaseEntity.isImmobile (eating grass / angry) zeroes the move input in LivingEntity.tickMovement.
      if (NS.Mount && NS.Mount.ready && NS.Mount.isMountable(e) && NS.Mount.isImmobile(e)) { e.jumping = false; NS.Ai.setMobSpeed(e, 0); }
      // loop/zombievariants-s100 (QUEUE 0.2 G18c) -- `ZombieEntity.tick()`'s own
      // inWaterTime/ticksUntilWaterConversion state machine (.decomp, read whole): husk ->
      // zombie and zombie -> drowned both run through it (Undead.CONVERT_TARGET,
      // 07zk_undead.js), same mobTick-slot standing rabbit/fox/polar_bear's own lines above
      // already established.
      if (NS.Undead && NS.Undead.ready && NS.Undead.CONVERT_TARGET[e.type]) NS.Undead.tickWaterConversion(e);
      if (e.type === 'skeleton' && NS.Undead && NS.Undead.ready && NS.Undead.tickStrayConversion) NS.Undead.tickStrayConversion(e);   // SkeletonEntity.tick
      // loop/zvillager-s102 (QUEUE 0.2 G18 mobs) -- ZombieVillagerEntity.tick()'s own conversion-
      // timer half (.decomp:131-140), the SAME mobTick-slot the water-conversion line immediately
      // above already occupies -- `Zv.tickOne` is a no-op for any zombie_villager not currently
      // converting (`e.converting` false, the common case).
      if (e.type === 'zombie_villager' && NS.ZVillager && NS.ZVillager.ready) NS.ZVillager.tickOne(e);
      // Dan's scheduled parallel night, QUEUE 0.2 (G18c) -- the polar bear's own warning-
      // animation ramp + dynamic hitbox (07zj_polarbear.js), the SAME per-tick slot rabbit's
      // own mobTick/enderman's own mobTick/squid's own tick already run in.
      if (e.type === 'polar_bear' && NS.PolarBear && NS.PolarBear.ready) NS.PolarBear.tick(e);
      // loop/lightning -- `SkeletonHorseTrapTriggerGoal.tick()` (.decomp/net/minecraft/
      // entity/ai/goal/SkeletonHorseTrapTriggerGoal.java, read whole): a player within 10
      // blocks of a TRAPPED horse untraps it and spawns the ambush. Dispatched here, the
      // SAME mobTick-slot polar_bear/rabbit/fox/enderman above already occupy, rather than
      // through a real goal-selector entry -- vanilla's `setTrapped` adds/removes the real
      // goal at RUNTIME and this engine's `Ai.ROSTER` (07k_goals.js) is a static list built
      // once at spawn (named on Lgt.OWED, not hidden).
      if (e.type === 'skeleton_horse' && e.trapped && NS.Lightning && NS.Lightning.tickTrap) {
        NS.Lightning.tickTrap(e);
      }
      // loop/panda-axolotl-s101 (QUEUE 0.2 G18c) -- panda's own two per-tick housekeeping
      // pieces run in the SAME mobTick-slot rabbit/fox/polar_bear's own lines above already
      // established: `Pd.tickRevengeFlags` (`tick()`'s own target==null -> flag-reset half,
      // .decomp lines 328-332) and `Pd.tickSneeze` (the sneeze-progress counter + its
      // consequence, .decomp lines 346-354/893-916).
      if (e.type === 'panda' && NS.Panda && NS.Panda.ready) {
        NS.Panda.tickRevengeFlags(e);
        NS.Panda.tickWorried(e);
        NS.Panda.tickAskForBamboo(e);
        NS.Panda.tickPlayTicks(e);   // #4511 playingTicks counter (vanilla: inside updatePlaying)
        NS.Panda.updatePlaying(e);
        NS.Panda.updateEating(e, {
          random: EL.random,
          particle: function (src, name) {
            // playEatingAnimation (.decomp PandaEntity 414-432): 6 item particles per beat, in front of the
            // body at eyeY+1.0; engine yaw forward = (sin y, -cos y) (D-415), so vanilla's rotateY(-yaw)
            // becomes x' = x(-cos y) + z sin y, z' = z(-cos y) - x sin y.
            if (!(NS.Particle && NS.Particle.spawn && NS.Items)) return;
            var cy = Math.cos(src.yaw || 0), sy = Math.sin(src.yaw || 0), pc = Math.cos(-(src.pitch || 0)), ps = Math.sin(-(src.pitch || 0));
            var eyeY = src.y + (src.eyeHeight || (src.height || 1.25) * 0.85);
            var by = src.bodyYaw != null ? src.bodyYaw : (src.yaw || 0), bc = Math.cos(by), bs = Math.sin(by);   // #3811: offset uses bodyYaw, velocity uses head yaw
            var r = EL.random, item = NS.Items.of(name);
            for (var pi = 0; pi < 6; pi++) {
              var vx = (r() - 0.5) * 0.1, vy = Math.random() * 0.1 + 0.1, vz = (r() - 0.5) * 0.1;
              var vy2 = vy * pc + vz * ps, vz2 = vz * pc - vy * ps;
              var ovx = vx * -cy + vz2 * sy, ovz = vz2 * -cy - vx * sy;
              var oy = -r() * 0.6 - 0.3, ox = (r() - 0.5) * 0.8, oz = 1.0 + (r() - 0.5) * 0.4;
              NS.Particle.spawn('item', src.x + ox * -bc + oz * bs, eyeY + 1.0 + oy, src.z + oz * -bc - ox * bs, ovx, vy2 + 0.05, ovz, r, item);
            }
          }
        });
        NS.Panda.tickAnim(e);   // #919/#4511 sit/lieOnBack/rollOver progress floats, last in vanilla tick()
        NS.Panda.tickSneeze(e, {
          dropsAllowed: NS.Breed.mobLoot(),
          random: EL.random,
          pandas: function () {
            var out = [];
            if (!EL.list) return out;
            for (var pi = 0; pi < EL.list.length; pi++) {
              var po = EL.list[pi];
              if (!po.removed && po.type === 'panda') out.push(po);
            }
            return out;
          },
          // LivingEntity.jump(): 0.42 * block jump factor (honey/soul sand) + jump boost
          jump: function (o) { if (o.onGround) { o.vy = NS.Physics.JUMP * NS.Physics.jumpFactorOf(o) + NS.Physics.jumpBoostVelocity(o); o.onGround = false; } },
          particle: function (src, name, x, y, z, vx, vy, vz) { NS.Particle.spawn(name, x, y, z, vx, vy, vz, EL.random); },
          dropItem: function (src, name, count) { if (EL.dropStack) EL.dropStack(src.x, src.y, src.z, name, count); }
        });
      }
      // loop/panda-axolotl-s101 (QUEUE 0.2 G18c) -- axolotl's play-dead countdown
      // (`PlayDeadTimerTask`'s own per-tick decrement, folded to a plain counter -- this
      // file's own header names the missing Brain substrate), same mobTick-slot standing.
      if (e.type === 'axolotl' && NS.Axolotl && NS.Axolotl.ready) NS.Axolotl.tickPlayDead(e);
      if (e.type === 'axolotl' && NS.Axolotl && NS.Axolotl.ready) NS.Axolotl.tickAir(e);   // D-649
      if (e.type === 'dolphin' && NS.Dolphin && NS.Dolphin.ready) NS.Dolphin.tick(e);   // #718
      if (NS.Guardian && NS.Guardian.ready && NS.Guardian.TYPES[e.type]) NS.Guardian.tick(e);   // #1011
      // loop/mobpickup (QUEUE 0.2) -- `MobEntity.tickMovement`'s own `canPickUpLoot` item-pickup
      // loop (.decomp :519-540, `Eq.tickPickup`'s own header names the gate/roster in full,
      // 07y_equip.js), the ONE hook call site this unit adds -- same mobTick-slot standing
      // panda/axolotl's own lines just above already establish.
      if (NS.Equip && NS.Equip.tickPickup) NS.Equip.tickPickup(e, EL.random);
      // cloud referee-mob-hoglin-ram: these six mobTick-slot lines sat in `EL.tickOne`'s NO-AI tail,
      // which a rostered mob never reaches (`if (mob) return EL.tickMob(e)`) -- so a live hoglin never
      // sensed a repellent, a piglin never zombified, a blaze/strider/trader never ran its own tick.
      // loop/wtrader-s103 -- the wandering trader's own despawn countdown + lazy trade roll
      // (WT.tickEntity, 07zt_wtrader.js) and the trader llama's own despawn countdown tied to
      // its holding trader (Ll.tickTraderLlamaDespawn, 07ze_llama.js) -- same generic-entity
      // dispatch slot llama_spit/potion/tnt already occupy, both gated on e.type the same way.
      if (e.type === 'wandering_trader' && NS.WT && NS.WT.ready) NS.WT.tickEntity(e);
      // s133 (KW-32) -- AbstractPiglinEntity.mobTick's zombification clock + PiglinBrain.onAttacked.
      if ((e.type === 'piglin' || e.type === 'piglin_brute') && NS.Piglin && NS.Piglin.ready) NS.Piglin.tickEntity(e);
      // s134 (KW-32) -- HoglinEntity/ZoglinEntity.mobTick: brain reactions, cooldown, zombification.
      if ((e.type === 'hoglin' || e.type === 'zoglin') && NS.Hoglin && NS.Hoglin.ready) NS.Hoglin.tickEntity(e);
      // loop/blazeghast -- BlazeEntity.tickMovement's own vy-damp + mobTick's own eyeOffset homing + hurtByWater (07zzh_blaze.js).
      if (e.type === 'blaze' && NS.Blaze && NS.Blaze.ready) NS.Blaze.mobTick(e);
      if (e.type === 'elder_guardian' && NS.ElderGuardian) NS.ElderGuardian.mobTick(e);   // #1009
      if (e.type === 'bee' && NS.Bee && NS.Bee.tickEntity) NS.Bee.tickEntity(e, EL.random);   // #2105
      // s135 (KW-33) -- StriderEntity.tick's own unconditional cold-flag refresh (07zzj_strider.js).
      if (e.type === 'strider' && NS.Strider && NS.Strider.ready) NS.Strider.tickEntity(e);
      // QUEUE 0.00 part 2 -- WitherEntity.tickMovement's own vertical-damp + target-homing
      // blend (07zzm_wither.js), same mobTick-slot standing blaze/strider's own lines above use.
      if (e.type === 'wither' && NS.Wither && NS.Wither.ready) NS.Wither.tickMovement(e);
      // loop/enderdragon-wiring (ED.OWED item 1) -- bridges e's live position/yaw into the
      // standalone ED.EnderDragonEntity rig, runs its already-ported PhaseManager/tickMovement()
      // motion blend UNCHANGED, then copies the result back onto e -- same mobTick-slot standing
      // wither's own tickMovement line immediately above already establishes.
      if (e.type === 'ender_dragon' && NS.EnderDragon && NS.EnderDragon.ready) NS.EnderDragon.tickEntity(e);
      if (e.type === 'trader_llama' && NS.Llama && NS.Llama.tickTraderLlamaDespawn) NS.Llama.tickTraderLlamaDespawn(e);
      if ((e.type === 'llama' || e.type === 'trader_llama') && NS.Llama && NS.Llama.tickSounds) NS.Llama.tickSounds(e);
      if (NS.Ai && NS.Ai.tickHead) NS.Ai.tickHead(e);   // guarded: an armor stand ticks here in harnesses without 07k
      if (e.type === 'panda' && NS.Panda && NS.Panda.ready) NS.Panda.tickSitPitch(e);   // after LookControl, as vanilla
      // QUEUE 0.2 "G18e remainder" -- a flying mob's own MoveControl (`e.flyMove`, attached
      // once at spawn by `Ai.ROSTER.parrot`, 07t_fly.js) ticks here, in the same slot
      // `Ai.tickHead` already occupies (after the goals, before the travel) -- and its own
      // travel law (`Fl.travelMob`, extended for `yya`/`noGravity`) runs instead of the ground
      // `Ph.travelMob` for exactly that mob, never for one with no `flyMove` at all.
      // QUEUE 0.2 (G18e remainder) -- `HorseBaseEntity.travel` OVERRIDES `LivingEntity.travel`
      // entirely while `hasPassengers() && canBeControlledByRider() && isSaddled()`; the goal
      // selector's own `e.zza` is not consulted at all in that state, matching the jar.
      // loop/slime-s97 -- `SlimeEntity.SlimeMoveControl` (.decomp), the SAME "one control
      // object per mob, attached at spawn" shape `e.flyMove` already uses (`Ai.ROSTER.slime`,
      // 07zd_slime.js) -- ticks in the SAME slot, after the goals and `Ai.tickHead`, before
      // the travel law. Slime never sets `noGravity` and never overrides `travel()`, so the
      // plain ground `Ph.travelMob` branch just below still runs for it unchanged.
      if (e.slimeMove) e.slimeMove.tick();   // landing squish: Sl.tickStretch (above)
      // #922 -- `PandaEntity.PandaMoveControl.tick()` only runs `MoveControl.tick()` while
      // `isIdle()`; a sitting/lying/playing panda's running goal (follow parent, flee, breed)
      // therefore commands no movement. This engine has no MoveControl object, so the goals'
      // forward/strafe write is dropped here instead (the same slot, before the travel law).
      if (e.type === 'panda' && NS.Panda && NS.Panda.ready && !NS.Panda.isIdle(e)) {
        e.zza = 0; e.xxa = 0; e.jumping = false;
      }
      if (e.flyMove) e.flyMove.tick();
      // loop/squid-s98 (QUEUE 0.2 G18c) -- the squid's whole AI (its two goals, its air/
      // drowning bookkeeping and its own `tickMovement()` velocity write) is `Sq.tick`
      // (07zi_squid.js), ticked in this SAME slot; its `travel()` bypasses the ground law
      // entirely (see `Sq.travelMob`'s own header) so it is dispatched below, never falling
      // through to `Ph.travelMob`.
      if ((e.type === 'squid' || e.type === 'glow_squid') && NS.Squid && NS.Squid.ready) NS.Squid.tick(e);
      // loop/fish-s99 (QUEUE 0.2 G18c) -- the fish's whole AI (wander/flee/danger/school,
      // pufferfish puff+sting, air/drowning) is `Fish.tick` (07zj_fish.js), ticked in this
      // SAME slot, the identical standing `Sq.tick`'s own line just above sets.
      if (NS.Fish && NS.Fish.ready && NS.Fish.isFishType(e.type)) NS.Fish.tick(e);
      if (e.type === 'dolphin' && NS.Dolphin && NS.Dolphin.ready) NS.Dolphin.tickMove(e);   // #717 AquaticMoveControl
      if (e.type === 'drowned' && NS.Undead && NS.Undead.tickSwim) NS.Undead.tickSwim(e);   // #994 updateSwimming + DrownedMoveControl
      if (e.type === 'pig') { e.stepHeight = 0.5; e.maxUpStep = 0.5; e.airStrafingSpeed = 0.02; }   // #4111 ItemSteerable.travel uncontrolled branch (every free pig tick); pigTravel overrides when steered
      if (e.vehicle && NS.Raid && NS.Raid.tickPassenger && NS.Raid.tickPassenger(e)) {
        // s98 -- a mob RIDING a mob (raid ravager passenger): `Entity.tickRiding`, no own travel.
      } else if (e.aiDisabled && !(NS.Mount && NS.Mount.ready && NS.Mount.isRidden(e))) {
        // #9462: LivingEntity.travel is gated on canMoveVoluntarily() (false while NoAI) so a NoAI mob neither
        // falls nor is lifted; tickMovement only damps its velocity (LivingEntity:2483, multiply(0.98)).
        e.vx *= 0.98; e.vy *= 0.98; e.vz *= 0.98;
      // loop/pigride-s98 -- a saddled, ridden PIG sets the SAME shared `e.rider`/`e.saddled`
      // fields the horse family does, so it must be checked BEFORE the generic `Mount.isRidden
      // && Mount.isSaddled` branch just below (which would otherwise hand it to
      // `Mount.travelRidden` -- horse-only arithmetic, a jump charge and rider forward/strafe
      // steering a pig has neither of, .decomp `PigEntity`/`ItemSteerable` both read in full).
      // `Passive.pigTravel` (07w_passive.js, this session's own file) is the real
      // `ItemSteerable.travel` pig branch.
      } else if (e.type === 'pig' && NS.Passive && NS.Passive.ready && NS.Mount && NS.Mount.ready &&
          NS.Mount.isRidden(e) && NS.Passive.pigIsSaddled(e)) {
        NS.Passive.pigTravel(e, EL.random);
      // s135 (KW-33) -- a saddled, ridden STRIDER sets the SAME shared e.rider/e.saddled
      // fields the pig/horse family do; `Strider.travel` (07zzj_strider.js) is the real
      // `ItemSteerable.travel` strider branch (warped fungus on a stick, cold speed).
      } else if (e.type === 'strider' && NS.Strider && NS.Strider.ready && NS.Mount && NS.Mount.ready &&
          NS.Mount.isRidden(e) && NS.Strider.isSaddled(e)) {
        NS.Strider.travel(e, EL.random);
      } else if (NS.Mount && NS.Mount.ready && NS.Mount.isRidden(e) && NS.Mount.isSaddled(e)) {
        NS.Mount.travelRidden(e);
      } else if (e.type === 'ender_dragon' && NS.EnderDragon && NS.EnderDragon.ready) {
        // no-op -- NS.EnderDragon.tickEntity (mobTick slot, above) already applied this
        // tick's full position/velocity update via the ported tickMovement()/move() call;
        // falling through to Ph.travelMob would add e.vx/vy/vz to e.x/y/z a SECOND time.
      } else if (e.flyMove && NS.Fly && NS.Fly.ready) {
        NS.Fly.travelMob(e);
      } else if ((e.type === 'squid' || e.type === 'glow_squid') && NS.Squid && NS.Squid.ready) {
        // no-op -- Sq.tick already moved it (#1617: move first, THEN the velocity write).
      } else if (e.type === 'drowned' && e.swimming && NS.Undead && NS.Undead.travelSwim) {
        NS.Undead.travelSwim(e);   // #994 DrownedEntity.travel underwater branch
      } else if (NS.Guardian && NS.Guardian.ready && NS.Guardian.TYPES[e.type]) {
        NS.Guardian.travelMob(e);   // #1011 GuardianMoveControl + GuardianEntity.travel
      } else if (e.type === 'turtle' && NS.Turtle && NS.Turtle.travelMob) {
        NS.Turtle.travelMob(e);   // #3047: TurtleEntity.travel
      } else if (e.type === 'axolotl' && NS.Axolotl && NS.Axolotl.travelMob) {
        NS.Axolotl.travelMob(e);   // #1361: AxolotlMoveControl + AxolotlEntity.travel
      } else if (e.type === 'dolphin' && NS.Dolphin && NS.Dolphin.ready) {
        NS.Dolphin.travelMob(e);   // #716: AquaticMoveControl + DolphinEntity.travel
      } else if (NS.Fish && NS.Fish.ready && NS.Fish.isFishType(e.type)) {
        // loop/fish-s99 (QUEUE 0.2 G18c) -- `FishEntity.travel(Vec3d)`'s own water/land split
        // (`Fish.travelMob`, 07zj_fish.js), the identical dispatch-before-the-generic-fallback
        // slot squid's own branch just above already occupies.
        NS.Fish.travelMob(e);
      } else {
        e.xxa = (e.xxa || 0) * Math.fround(0.98);
        if (Math.abs(e.xxa) < 1e-6) e.xxa = 0;
        Ph.travelMob(e, e.xxa);   // D-597: xxa = Ai.BowAttackGoal's strafe (MoveControl STRAFE state)
      }
      // #582: vanilla turnHead/BodyControl runs after the movement, so isMoving() sees this tick's step.
      if (NS.Ai && NS.Ai.tickBody) NS.Ai.tickBody(e);
      if (NS.Undead && NS.Undead.tickSounds) NS.Undead.tickSounds(e, EL.random);   // #666
      if (e.type === 'wolf' && NS.Tame && NS.Tame.tickWolfSounds) NS.Tame.tickWolfSounds(e, EL.random);   // #915
      // QUEUE 0.2 (G18c) -- `ChickenEntity.tickMovement` (.decomp), read in full: the slow-fall
      // half runs AFTER `super.tickMovement()` (which is where `travel()`/this tick's motion
      // already happened), damping the velocity a falling chicken carries INTO NEXT tick --
      // this engine's `Ph.travelMob` call above is that same motion, so the same place in this
      // tick's own order is right after it. The egg-lay half is the same method, same guard
      // shape (`!isBaby()`, tested inside `Passive.tickChicken`).
      // #1225 -- ParrotEntity.flapWings (end of tickMovement): same state + the same 0.6 slow descent.
      if (e.type === "parrot" && NS.Fly && NS.Fly.tickSong) NS.Fly.tickSong(e);   // #1228
      if (e.type === "parrot" && NS.Passive && NS.Passive.ready) {
        NS.Passive.tickChickenFlap(e);
        if (!e.onGround && e.vy < 0) e.vy *= NS.Passive.CHICKEN_FALL_MULT;
      }
      if (e.type === "chicken" && NS.Passive && NS.Passive.ready) {
        NS.Passive.tickChickenFlap(e);
        if (!e.onGround && e.vy < 0) e.vy *= NS.Passive.CHICKEN_FALL_MULT;
        if (NS.Passive.tickChicken(e, EL.random)) {
          // ChickenEntity.tickMovement :90-94 -- playSound(entity.chicken.egg, 1.0, (r - r) * 0.2 + 1.0) BEFORE dropItem(egg). #1551
          var eggS = NS.Sound, eggR = EL.random || Math.random;
          if (eggS && eggS.ready) eggS.play('entity.chicken.egg', { volume: 1, pitch: (eggR() - eggR()) * 0.2 + 1, x: e.x, y: e.y, z: e.z, source: 'neutral' });
          EL.dropStack(e.x, e.y, e.z, 'egg', 1);
        }
      }
      // D-533 (G18c) -- `BatEntity.tick()`'s post-super half (roost snap / vy*0.6), and a bat
      // never pushes (`tickCramming()` is empty).
      if (e.type === 'bat' && NS.Bat && NS.Bat.ready) NS.Bat.postTick(e);
      // ArmorStandEntity.isPushable() is false, pushAway() is empty and tickCramming() pushes only
      // minecarts (.decomp ArmorStandEntity.java:291-306) -- it neither shoves nor is shoved.
      if (e.type !== 'bat' && e.type !== 'shulker' && e.type !== 'armor_stand') EL.pushAround(e);
      EL.suffocate(e);
    } else {
      // A corpse mid-death-animation does not path and does not shove, but `LivingEntity.travel` still runs
      // with zero input (isImmobile): ground friction/water drag, so knockback stops instead of gliding in midair (#4004).
      e.zza = 0; e.xxa = 0; e.jumping = false;
      Ph.travelMob(e, 0);
    }
    EL.tickAnim(e);
  };

  /**
   * `LivingEntity.pushEntities` — every other living entity whose box overlaps this one gets
   * shoved, and so does this one. `Ph.push` is `Entity.g(axk)` verbatim (D-417).
   * ⚠ The PLAYER is one of the entities that push and are pushed — `NS.Player` when it has a
   * velocity to receive the shove; `EL.pushPlayer` overrides that for a headless fixture.
   */
  EL.pushAround = function (e) {
    var Ph = NS.Physics, list = EL.list, n = 0, hit = [];
    if (!list) return 0;   // EL.init has not run (no entities module ready): nothing to push
    // `EntityPredicates.canBePushedBy`: the other's `isPushable()` = alive && !spectator && !isClimbing().
    var pushable = function (o) {
      return !o.removed && !o.dead && !o.spectator && o.type !== 'bat' && o.type !== 'shulker' && !(Ph.onClimbable && Ph.onClimbable(o));
    };
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      var isCart = !!(NS.Minecart && NS.Minecart.isCart(o.type));   // AbstractMinecartEntity.isPushable() = true
      if (o === e || (o.maxHealth === undefined && !isCart) || !pushable(o)) continue;
      if (NS.Scoreboard && !NS.Scoreboard.canBePushedBy(e, o)) continue;   // team collisionRule
      if (!Ph.boxesOverlap(e, o)) continue;
      hit.push(o);
    }
    var P = EL.pushPlayer ? EL.pushPlayer() : (NS.Player && NS.Player.vx !== undefined ? NS.Player : null);
    if (P && P !== e && !P.dead && !P.spectator && (!NS.Scoreboard || NS.Scoreboard.canBePushedBy(e, P)) && Ph.boxesOverlap(e, P)) hit.push(P);
    if (!hit.length) return 0;
    // `LivingEntity.tickCramming`: >= maxEntityCramming-1 others => 1-in-4 roll, then 6 damage if
    // that many are not riding anything.
    var gr = NS.DATA && NS.DATA.gameRules && NS.DATA.gameRules.maxEntityCramming;
    var max = EL.maxEntityCramming !== undefined ? EL.maxEntityCramming : (gr ? +gr.d : 24);
    if (max > 0 && hit.length > max - 1 && ((EL.random ? EL.random() : Math.random()) * 4 | 0) === 0) {
      var free = 0;
      for (var k = 0; k < hit.length; k++) if (!hit[k].vehicle) free++;
      if (free > max - 1 && NS.Combat && NS.Combat.hurt) NS.Combat.hurt(e, 6);
    }
    for (var j = 0; j < hit.length; j++) {
      var q = hit[j];
      if (q.vehicle === e || e.vehicle === q) continue;   // isConnectedThroughVehicle
      // `Entity.pushAwayFrom` acts only on the side without passengers; `LivingEntity` skips it while asleep.
      if (q.sleeping || e.sleeping) continue;
      var hasP = function (x) { return !!(x.passenger || (x.passengers && x.passengers.length)); };
      var ea = hasP(e), qa = hasP(q);
      if (NS.Minecart && NS.Minecart.isCart(q.type)) {   // AbstractMinecartEntity.pushAwayFrom(this = cart, other = e)
        if (!hasP(q) && !e.noclip && !q.noclip) NS.Minecart.pushAwayFrom(q, e);
        n++; continue;
      }
      var evx = e.vx, evz = e.vz, qvx = q.vx, qvz = q.vz;
      // IronGolemEntity.pushAway(other): a Monster that is not a Creeper is targeted 1 time in 20, then super.pushAway.
      if (e.type === 'iron_golem' && q.type !== 'creeper' && NS.Spawn && NS.Spawn.categoryOf(q.type) === 'monster'
          && Math.floor((EL.random ? EL.random() : Math.random()) * 20) === 0) e.target = q;
      if (!Ph.push(e, q)) continue;
      // ParrotEntity.pushAway(other) is a no-op for a PlayerEntity: the parrot never shoves the player.
      if (e.type === 'parrot' && q === P) { q.vx = qvx; q.vz = qvz; }
      if (ea) { e.vx = evx; e.vz = evz; }
      if (qa) { q.vx = qvx; q.vz = qvz; }
      n++;
    }
    return n;
  };

  /**
   * `LivingEntity.baseTick`'s own wall check: one point of damage a tick while the eye box is
   * inside a full cube. ⚠ It is DAMAGE, not a shove — vanilla does not push you out.
   */
  /** `DimensionType.MOON_SIZES` (Yarn, .decomp) — indexed by `Sky.moonPhase`. */
  EL.MOON_SIZES = [1.0, 0.75, 0.5, 0.25, 0.0, 0.25, 0.5, 0.75];

  EL.suffocate = function (e) {
    if ((e.maxHealth === undefined && e.type !== 'player') || e.dead) return false;
    if (e.type === 'vex') return false;   // VexEntity.tick() holds noClip across the whole super.tick(): isInsideWall is false (#2409)
    var Ph = NS.Physics;
    var hNow = e.height;
    if (e.type === 'player' && e.prePoseHeight) e.height = e.prePoseHeight;
    var inWall = Ph.isInWall(e);
    e.height = hNow;
    if (!inWall) return false;
    if (e.type === 'player') {
      NS.Survival.hurt(e, 'inWall', Ph.IN_WALL_DAMAGE);
      // Player.updatePose: no room to stand or crouch -> the 0.6 swimming box, eye 0.4, i.e. out of the wall's cell
      // ponytail: always swimming; vanilla tries crouching (1.5) first, which only matters for a 1.5-high pocket
      e.height = Ph.POSE.swimming.h; e.eyeHeight = Ph.POSE.swimming.eye;
    }
    else if (NS.Combat && NS.Combat.hurt) NS.Combat.hurt(e, Ph.IN_WALL_DAMAGE, undefined, false, { bypassArmor: true, source: 'inWall' });
    return true;
  };

  /** `horizontalLengthSqr(delta) > 1.0E-5` — the literal `9.999999747378752E-6d` in `ItemEntity.tick`. */
  EL.REST_EPS = 1.0E-5;

  /**
   * The friction of the block an entity is standing ON, `ItemEntity`'s way.
   *
   * ⚠ **IT IS NOT `Ph.frictionOf`.** The player asks
   * `getBlockPosBelowThatAffectsMyMovement()`, which is y − 0.5000001 so a slab still counts;
   * `ItemEntity` and `ExperienceOrb` build `new BlockPos(getX(), getY() - 1, getZ())` — a flat
   * minus one. Two different lookups in the same jar, and using the player's for an item would
   * be the kind of "close enough" that is wrong on exactly the interesting blocks.
   */
  EL.frictionBelow = function (e) {
    var R = NS.Reg, Ph = NS.Physics;
    if (!R || !R.friction || !Ph) return 0.6;
    return R.friction[Ph.blockIdAt(e.x, e.y - 1, e.z)] || 0.6;
  };

  /**
   * ⚠⚠ **THE DAMPING OF AN ENTITY WITH NO WILL, AND IT IS NOT ONE MULTIPLY — D-427.**
   * Dan, session 55: *"items slide too much when dropped"*. `tickOne` damped all three axes by
   * the single uniform `drag` from `entity-motion-1.18.2.tsv`, which for an item is 0.98 — so a
   * dropped stack kept 98% of its speed every tick FOR EVER, on the ground exactly as in the
   * air. Vanilla multiplies an item's HORIZONTAL speed by the friction of the block under it
   * times 0.98: on grass that is 0.588, twenty-four times more damping per tick. The bug was one
   * missing branch, and the reason it was missing is that its number had never been measured —
   * `extract-entity-motion.mjs`'s header named it as owed. `extract-entity-ground.mjs` closes it.
   *
   * Two shapes, both out of the bytecode, and the table says which applies:
   *   block — item, experience_orb:  f = (onGround ? friction(below) : 1) * k, then (f, dy, f)
   *   flat  — tnt, falling_block:    the uniform drag, then on the ground (flat, b, flat)
   * ⚠ The BOUNCE is not one number and not one guard: an item's is −0.5 and only while it is
   * already falling, an orb's is −0.9 and unconditional. Memory says "−0.5, both".
   */
  // #1622 -- ThrownEntity.tick (.decomp ThrownEntity.java:76-87): touching water -> 4 bubbles at pos - vel*0.25
  // and velocity*0.8 instead of 0.99. The air value is the spawn row's own drag (`e.drag`).
  EL.THROWN = { potion: 1, snowball: 1, egg: 1, ender_pearl: 1, experience_bottle: 1 };
  EL.THROWN_DRAG_WATER = Math.fround(0.8);
  EL.RAYCAST_THROWN = { snowball: 1, egg: 1 };
  /**
   * ThrownEntity.tick (.decomp :40-87), snowball/egg: the hit test is a COLLIDER raycast of
   * pos -> pos + v (a block hit sets `e.onGround`, the stand-in `Cb.tickSnowball`/`Th.tickEgg` read for
   * "hit a block"), then velocity * 0.99 (0.8 touching water, judged at the OLD position), THEN gravity,
   * and the position is set to pos + v unswept -- no Entity.move box sweep.
   */
  EL.flyThrown = function (e, dx, dy, dz) {
    var Cb = NS.Combat, h = Cb && Cb.arrowRaycast ? Cb.arrowRaycast(e.x, e.y, e.z, dx, dy, dz) : null;
    e.px = e.x; e.py = e.y; e.pz = e.z;
    if (h) e.onGround = true;
    EL.dampThrown(e);
    e.vy -= Math.fround(e.gravity);   // getGravity() is a float
    e.x += dx; e.y += dy; e.z += dz;
  };
  /** Entity.isTouchingWater: the box shrunk 0.001 (updateMovementInFluid) meets a water cell below its surface. */
  EL.touchingWater = function (e) {
    var SR = NS.States, Ph = NS.Physics, hw = (e.width !== undefined ? e.width : 0.25) * 0.5 - 0.001;
    var minY = e.y + 0.001, x1 = Math.ceil(e.x + hw), y1 = Math.ceil(e.y + (e.height || 0.25) - 0.001), z1 = Math.ceil(e.z + hw);
    for (var x = Math.floor(e.x - hw); x < x1; x++) for (var y = Math.floor(minY); y < y1; y++) for (var z = Math.floor(e.z - hw); z < z1; z++) {
      var st = Ph.blockAt(x, y, z);
      if (SR.fluidKind[st] !== 1) continue;
      if (y + (SR.fluidKind[Ph.blockAt(x, y + 1, z)] === 1 ? 1 : SR.fluidAmt[st] / 9) >= minY) return true;
    }
    return false;
  };
  EL.dampThrown = function (e) {
    var f = e.drag;
    if (EL.touchingWater(e)) {
      var Px = NS.Particle;
      if (Px && Px.spawn)
        for (var i = 0; i < 4; i++) Px.spawn('bubble', e.x - e.vx * 0.25, e.y + 0.125 - e.vy * 0.25, e.z - e.vz * 0.25, e.vx, e.vy, e.vz);
      f = EL.THROWN_DRAG_WATER;
    }
    e.vx *= f; e.vy *= f; e.vz *= f;
  };
  EL.damp = function (e) {
    var G = e.ground;
    if (!G) { e.vx *= e.drag; e.vy *= e.drag; e.vz *= e.drag; return; }
    if (G.m === 'block') {
      var f = e.onGround ? EL.frictionBelow(e) * G.k : G.k;
      e.vx *= f; e.vy *= G.dy; e.vz *= f;
      if (e.onGround && (G.g !== 'falling' || e.vy < 0)) e.vy *= G.b;
      return;
    }
    e.vx *= e.drag; e.vy *= e.drag; e.vz *= e.drag;
    if (e.onGround) { e.vx *= G.f; e.vy *= G.b; e.vz *= G.f; }
  };

  /**
   * `FallingBlockEntity.tick` after the move (.decomp FallingBlockEntity.java:124-215), server half.
   * On the ground: velocity *= (0.7, -0.5, 0.7); then unless it landed on a moving piston it
   * either places itself (cell replaceable, `canSurvive`, nothing to fall through below) or
   * discards and, when `dropItem` and `doEntityDrops`, drops the block as an item. Airborne past
   * 100 ticks out of the world or 600 ticks anywhere it drops and discards. Drag 0.98 last.
   * `fallDist` is the distance fallen this tick chain: `Entity.handleFallDamage` (hurtEntities).
   * Anvils (`BlockTags.ANVIL`): damage source ANVIL, then when amt > 0 a 5% + n*5% chance steps
   * anvil -> chipped -> damaged -> destroyedOnLanding. LandingBlock onLanding/onDestroyedOnLanding (1031/1029) below.
   * LandingBlock onLanding/onDestroyedOnLanding (anvil 1031/1029) are wired above.
   * ConcretePowderBlock.onLanding (hardens in water) is wired below.
   * Block-entity restore: `tileEntityData` (a BE.serializeAll-shaped record) is applied to the landed block's entity
   * with x/y/z forced to the landing cell (vanilla: merge x/y/z, then blockEntity.readNbt).
   */
  EL.canFallThrough = function (st) {
    var SR = NS.States, R = NS.Reg;
    if (!st || SR.isAir[st]) return true;
    if (SR.replaceable[st] === 1) return true;
    var nm = R.names[SR.block[st]];
    return nm === 'fire' || nm === 'soul_fire' || nm === 'water' || nm === 'lava' || nm === 'bubble_column';
  };
  /** `FallingBlockEntity.onDestroyedOnLanding` -> `AnvilBlock.onDestroyedOnLanding`: world event 1029 unless silent. */
  EL.onDestroyedOnLanding = function (e, x, y, z) {
    var nm = NS.Reg.names[NS.States.block[e.state]];
    if (nm !== 'anvil' && nm !== 'chipped_anvil' && nm !== 'damaged_anvil') return;
    if (!e.silent && NS.BlockEntities) NS.BlockEntities.dispenseEvent({ x: x, y: y, z: z }, 1029, 0);
  };
  /** `LandingBlock.onLanding` -> `AnvilBlock.onLanding`: world event 1031 unless silent. */
  EL.onLanding = function (e, x, y, z) {
    var nm = NS.Reg.names[NS.States.block[e.state]];
    if (nm !== 'anvil' && nm !== 'chipped_anvil' && nm !== 'damaged_anvil') return;
    if (!e.silent && NS.BlockEntities) NS.BlockEntities.dispenseEvent({ x: x, y: y, z: z }, 1031, 0);
  };
  EL.dropFallingBlock = function (e, x, y, z) {
    var SR = NS.States, R = NS.Reg, C = NS.Commands;
    if (!e.dropItem) return;
    if (C && typeof C.ruleGet === 'function' && C.ruleGet('doEntityDrops') === 'false') return;
    if (x !== undefined) EL.onDestroyedOnLanding(e, x, y, z);
    EL.dropStack(e.x, e.y, e.z, R.names[SR.block[e.state]], 1);
  };
  EL.isAnvil = function (st) {
    var nm = st ? NS.Reg.names[NS.States.block[st]] : '';
    return nm === 'anvil' || nm === 'chipped_anvil' || nm === 'damaged_anvil';
  };
  /** `AnvilBlock.getLandingState`: anvil -> chipped_anvil -> damaged_anvil -> null (keeps facing). */
  EL.anvilLandingState = function (st) {
    var R = NS.Reg, nm = R.names[NS.States.block[st]];
    var to = nm === 'anvil' ? 'chipped_anvil' : nm === 'chipped_anvil' ? 'damaged_anvil' : null;
    if (to === null) return null;
    return R.real(R.names.indexOf(to), st - R.realFirst[NS.States.block[st]]);
  };
  /** `AnvilBlock.onLanding` (1031 block.anvil.land) / `onDestroyedOnLanding` (1029 block.anvil.destroy); silent mutes. */
  EL.anvilSound = function (e, x, y, z, ev) {
    if (e.silent || !EL.isAnvil(e.state)) return;
    if (NS.Sound && NS.Sound.play) NS.Sound.play(ev === 1031 ? 'block.anvil.land' : 'block.anvil.destroy', { x: x + 0.5, y: y + 0.5, z: z + 0.5, source: 'block' });
  };
  // ConcretePowderBlock instance + FluidTags.WATER at a cell (water, or waterlogged)
  EL.isWaterCell = function (st) {
    var SR = NS.States;
    return !!st && (NS.Reg.names[SR.block[st]] === 'water' || SR.waterIn[st] === 1);
  };
  // RaycastContext(prev -> pos, COLLIDER, SOURCE_ONLY): first cell on the segment that is a water source or has a
  // collision box; returns [x,y,z] or null.
  EL.sourceOnlyRaycast = function (x0, y0, z0, x1, y1, z1) {
    var W = NS.World, SR = NS.States, R = NS.Reg, P = NS.Physics;
    var dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    var n = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy + dz * dz) / 0.05));
    for (var i = 0; i <= n; i++) {
      var cx = Math.floor(x0 + dx * i / n), cy = Math.floor(y0 + dy * i / n), cz = Math.floor(z0 + dz * i / n);
      var st = W.getBlock(cx, cy, cz);
      if (!st) continue;
      if (R.names[SR.block[st]] === 'water') {
        if (NS.Behave && NS.Behave.fluidLevel(st) === 0) return [cx, cy, cz];
      } else if (P.shapeAt && P.shapeAt(cx, cy, cz)) return [cx, cy, cz];
    }
    return null;
  };
  EL.tickFallingBlock = function (e, fallDist) {
    var x = Math.floor(e.x), y = Math.floor(e.y), z = Math.floor(e.z);
    var isPowder = !!(NS.Behave && NS.Behave.ready && NS.Behave.powderHardened && NS.Behave.powderHardened(e.state));
    var inWater = false;
    if (isPowder) {
      inWater = EL.isWaterCell(NS.World.getBlock(x, y, z));
      if (e.vx * e.vx + e.vy * e.vy + e.vz * e.vz > 1.0) {
        var hit = EL.sourceOnlyRaycast(e.px, e.py, e.pz, e.x, e.y, e.z);
        if (hit && EL.isWaterCell(NS.World.getBlock(hit[0], hit[1], hit[2]))) { x = hit[0]; y = hit[1]; z = hit[2]; inWater = true; }
      }
    }
    if (!e.onGround && !inWater && !((e.timeFalling > 100 && (y <= NS.CFG.WORLD_MIN_Y || y > NS.CFG.WORLD_MAX_Y)) || e.timeFalling > 600)) {
      e.vx *= 0.98; e.vy *= 0.98; e.vz *= 0.98;
      return;
    }
    var SR = NS.States, R = NS.Reg, W = NS.World, CF = NS.CFG;
    if (e.onGround || inWater) {
      // handleFallDamage (hurtEntities only; ceil(dist - 1), min(floor(n * amount), max))
      var n = Math.ceil(fallDist - 1);
      if (NS.GameEvent && fallDist > 0) NS.GameEvent.emit(inWater ? 'splash' : 'hit_ground', e.x, e.y, e.z, e);
      if (e.hurtEntities && n >= 0 && NS.Combat && NS.Combat.hurt) {
        var amt = Math.min(Math.floor(n * (e.fallHurtAmount === undefined ? 2 : e.fallHurtAmount)), e.fallDamageMax);
        var isAnvil = EL.isAnvil(e.state);
        var hw = e.width / 2, list = EL.list.slice();
        for (var i = 0; i < list.length; i++) {
          var o = list[i];
          if (o === e || o.removed) continue;
          var ow = (o.width || 0.6) / 2;
          if (o.x + ow > e.x - hw && o.x - ow < e.x + hw && o.y + (o.height || 0) > e.y && o.y < e.y + e.height &&
              o.z + ow > e.z - hw && o.z - ow < e.z + hw) NS.Combat.hurt(o, amt, undefined, false, { source: e.hurtSource || (isAnvil ? 'anvil' : 'fallingBlock'), fallingBlock: true });
        }
        if (isAnvil && amt > 0 && (EL.random || Math.random)() < 0.05 + n * 0.05) {
          var nxt = EL.anvilLandingState(e.state);
          if (nxt === null) e.destroyedOnLanding = true; else e.state = nxt;
        }
      }
      e.vx *= 0.7; e.vy *= -0.5; e.vz *= 0.7;
      var cur = W.getBlock(x, y, z);
      if (R.names[SR.block[cur]] !== 'moving_piston') {
        if (!e.destroyedOnLanding) {
          var canReplace = SR.canBeReplacedBy(cur, 0, 3, y, true);
          var fall = EL.canFallThrough(W.getBlock(x, y - 1, z)) && (!isPowder || !inWater);
          var canPlace = W.canSurvive(x, y, z, e.state) && !fall;
          if (canReplace && canPlace) {
            var st = e.state;
            // ConcretePowderBlock.onLanding: landing in water hardens it
            if (NS.Behave && NS.Behave.concrete && SR.waterIn[cur] && NS.Behave.concrete(st) !== st) st = NS.Behave.concrete(st);
            else if (R.PROP && R.PROP.waterlogged !== undefined && SR.waterIn[cur] && R.names[SR.block[cur]] === 'water')
              st = SR.withProp(st, R.PROP.waterlogged, R.PVAL['true']);
            // ConcretePowderBlock.onLanding: shouldHarden against the state the block replaced
            if (isPowder) st = NS.Behave.place(st, x, y, z);
            if (W.setBlock(x, y, z, st)) {
              EL.remove(e); EL.onLanding(e, x, y, z);
              var BEs = NS.BlockEntities;
              if (e.tileEntityData && BEs && BEs.ready && BEs.stateHasEntity(st)) {
                var be = BEs.get(x, y, z) || BEs.create(x, y, z, BEs.typeOf(SR.block[st]));
                BEs.restoreAll([Object.assign({}, e.tileEntityData, { x: x, y: y, z: z, type: be.type })]);
              }
            }
            else EL.dropFallingBlock(e, x, y, z), EL.remove(e);
          } else {
            EL.remove(e);
            EL.dropFallingBlock(e, x, y, z);
          }
        } else { EL.remove(e); EL.onDestroyedOnLanding(e, x, y, z); }
      }
    } else if ((e.timeFalling > 100 && (y <= CF.WORLD_MIN_Y || y > CF.WORLD_MAX_Y)) || e.timeFalling > 600) {
      EL.dropFallingBlock(e);
      EL.remove(e);
    }
    e.vx *= 0.98; e.vy *= 0.98; e.vz *= 0.98;
  };

  EL.tickOne = function (e) {
    var Ph = NS.Physics;
    e.px = e.x; e.py = e.y; e.pz = e.z;
    if (e.maxHealth === undefined && e.y < EL.VOID_Y) { EL.remove(e); return; }   // Entity.tickInVoid -> discard() (items, arrows, every non-living entity)
    if (e.type === 'end_crystal' && NS.EndCrystal && NS.EndCrystal.tick) NS.EndCrystal.tick(e);   // EndCrystalEntity.tick
    // ⚠⚠ **AND WHERE IT WAS POINTING — D-430.** Dan, session 55: *"all turns of mobs look
    // stuttery and not smooth"*. `e.px/py/pz` have been captured here since G17b and
    // `ER.posAt` lerps a mob's POSITION between two ticks, so it glides; its ROTATION was read
    // raw, so it snapped twenty times a second while the body under it slid smoothly. Vanilla
    // keeps `yRotO`, `yHeadRotO` and `xRotO` for exactly this and `LivingEntityRenderer`
    // `Mth.rotLerp`s all three. Taken at the TOP of the tick, next to the position, because
    // anything that turns the mob — the look control, the body-rotation control, `travelMob`
    // — runs below this line.
    e.yawO = (e.yaw === undefined) ? 0 : e.yaw;
    if (e.yBodyRot !== undefined) e.yBodyRotO = e.yBodyRot;
    e.yHeadRotO = (e.yHeadRot === undefined) ? e.yawO : e.yHeadRot;
    e.xHeadRotO = (e.xHeadRot === undefined) ? 0 : e.xHeadRot;
    // ⚠⚠ **A MOB WITH A GOAL SELECTOR DOES NOT TAKE THIS PATH — D-417.** Vanilla's order is
    // `serverAiStep()` (goals, navigation, the move/look/jump controls) and THEN `travel()`,
    // and `travel()` for a living entity is not "gravity, move, drag": it is friction,
    // `moveRelative`, move, block speed factor, THEN gravity and drag, which is the law
    // `Physics.travelMob` ports. Running both would apply gravity twice a tick. The generic
    // motion below stays exactly as it was for everything with no will — items, falling
    // blocks, TNT, arrows.
    // D-707 leftover unit (this pass, mob-test-passive-leftover): squid/glow_squid have no
    // Ai.ROSTER entry BY DESIGN (07zi_squid.js's own header -- `Sq.tick`/`Sq.travelMob` are
    // called directly, not through a real GoalSelector, since neither of the jar's two squid
    // goals declares a control flag), but this gate used `e.ai` truthy as its ONLY door into
    // `EL.tickMob` -- the function `Sq.tick`/`Sq.travelMob` are dispatched FROM (line ~1560
    // below). With no ROSTER entry, `e.ai` is never set (`Ai.selectorFor`, 07k_goals.js, returns
    // null), so a LIVE-spawned squid or glow_squid never reached `EL.tickMob` at all -- confirmed
    // this pass by a real browser spawn (`tools/petmobpeek.mjs`): a summoned glow_squid sat
    // dead still, `hasAi:false`, for a full 3 real seconds, air/drown bookkeeping and all.
    // `EL.WATER_TICK_ONLY` names the types this applies to; `EL.tickMob` itself already guards
    // `e.ai.tick()` for a mob with none (just below).
    var mob = !!e.ai || EL.WATER_TICK_ONLY[e.type] || EL.LIVING_TICK_ONLY[e.type];
    if (mob) return EL.tickMob(e);
    // loop/arrows (s116) -- a STUCK arrow (`Cb.embedArrow`, 14j_combat.js) already sits INSIDE a
    // block's real shape with its own velocity zeroed; running gravity/move/damp on it below
    // would push it through that same block one step at a time, since nothing past this line
    // knows "embedded" means "skip the sweep" the way `PersistentProjectileEntity.tick()`'s own
    // `inGround` branch does. `Cb.tickArrow` owns the embedded branch (aging/pickup/falling-
    // again) entirely; this is only the dispatch, so it runs INSTEAD of gravity/move, not after.
    // relaxed-curie item 1: a FLYING arrow skips it too -- `PersistentProjectileEntity.tick()`
    // raycasts its POINT and `setPosition`s, never `Entity.move`s its box (`Cb.tickArrow`).
    // #1564 (G25) -- AbstractMinecartEntity.tick never calls Entity.tick: gravity/move/slowdown are its own.
    if (NS.Minecart && NS.Minecart.isCart(e.type)) { NS.Minecart.tick(e); return; }
    if (e.type === 'boat' && NS.Boat) { NS.Boat.tick(e); return; }   // #5227 -- BoatEntity.tick
    if (e.type === 'trident' && NS.Combat && NS.Combat.tickTrident) { e.age++; NS.Combat.tickTrident(e); return; }   // TridentEntity.tick
    if (e.type === 'arrow' || e.type === 'spectral_arrow') {
      e.age++;
      if (NS.Combat && NS.Combat.tickArrow) NS.Combat.tickArrow(e);
      return;
    }
    // ExplosiveProjectileEntity.tick raycasts and setPositions, never Entity.move -- Gh.tickFireball owns the motion.
    if (e.type === 'firework_rocket' && NS.Firework) { e.age++; NS.Firework.tick(e); return; }   // #5081
    if (e.type === 'fireball' && NS.Ghast && NS.Ghast.tickFireball) { e.age++; NS.Ghast.tickFireball(e); return; }
    if (e.type === 'small_fireball' && NS.Blaze && NS.Blaze.Fireball && NS.Blaze.Fireball.tickSmall) { e.age++; NS.Blaze.Fireball.tickSmall(e); return; }   // same: raycast + setPosition, never Entity.move
    // ShulkerBulletEntity is noClip: tick() blends, raycasts and setPositions, never Entity.move -- Sh.tickBullet owns the motion.
    if (e.type === 'shulker_bullet' && NS.Shulker && NS.Shulker.tickBullet) { e.age++; NS.Shulker.tickBullet(e); return; }
    // EyeOfEnderEntity.tick sets its own velocity and setPositions itself -- never Entity.move/gravity/drag (Th.tickEye owns the motion).
    // #8291 FishingBobberEntity.tick (.decomp FishingBobberEntity.java:142-144): no player owner -> discard() on the first tick.
    if (e.type === 'fishing_bobber' && !e.owner) { EL.remove(e); return; }
    if (e.type === 'eye_of_ender' && NS.Throw && NS.Throw.tickEye) { e.age++; NS.Throw.tickEye(e); if (e.removed) EL.remove(e); return; }
    if (e.type === 'falling_block') {
      if (!e.state) { EL.remove(e); return; }         // `if (this.block.isAir()) discard()`
      e.timeFalling = (e.timeFalling | 0) + 1;
    }
    // #5651 -- ItemEntity.tick: eye in water -> setUnderwaterMovement (x0.99, vy += 5e-4 while vy < 0.06);
    // eye in lava -> setUnderLavaMovement (x0.95); only otherwise does gravity apply.
    if (e.type === 'item' && Ph.blockAt) {
      var ies = Ph.blockAt(e.x, e.y + 0.2125, e.z), ibuoy = 0;
      if (ies !== 0) {
        if (NS.States.waterIn[ies] === 1) ibuoy = Math.fround(0.99);   // the F suffix: 0.99F / 0.95F / 0.06F / 5.0E-4F are floats widened to double
        else if (NS.States.block[ies] === NS.Reg.id.lava) ibuoy = Math.fround(0.95);
      }
      if (ibuoy) { e.vx *= ibuoy; e.vy += e.vy < Math.fround(0.06) ? Math.fround(5.0E-4) : 0; e.vz *= ibuoy; }
      else e.vy -= e.gravity;
    } else if (!EL.THROWN[e.type] && e.type !== 'llama_spit')   // ThrownEntity.tick: move, drag, THEN gravity (below, after dampThrown)
    e.vy -= e.gravity;
    // ⚠ CLIMBING (D-401, session 39). `LivingEntity.travel()` runs this clamp for every living
    // entity, not just the player — `Ph.climbClamp` already existed for the player's own tick
    // (ladders/vines, `Ph.onClimbable`) and simply was never called from here. `e.living` gates
    // it the same way `Ph.move` already gates fall damage (D-308): a non-living entity (an
    // item, a falling block) has no `onClimbable()` override to speak of. No `cmd` — a mob has
    // no sneak key — so the "hold still while sneaking on a ladder" branch never fires, which
    // is correct: nothing here can sneak.
    if (e.living !== false && Ph.climbClamp) Ph.climbClamp(e, null);
    // ⚠⚠ **AN ENTITY AT REST IS NOT MOVED EVERY TICK — D-427.** `ItemEntity.tick` guards the
    // whole move-and-damp block with
    //     if (!onGround || horizontalLengthSqr(delta) > 1.0E-5 || (tickCount + getId()) % 4 == 0)
    // so a stack lying still on the floor runs the collision sweep on one tick in four. It is
    // vanilla's own optimisation, it is visible (a settled item's sub-pixel drift is quantised),
    // and `restSkip` is read out of the jar rather than assumed — only `item` has one.
    if (Ph.fluidPush && !e.living) Ph.fluidPush(e);   // Entity.updateMovementInFluid (mobs get it via Ph.updateFluids)
    if (!e.living && EL.waterSplash) EL.waterSplash(e);
    var G = e.ground;
    if (G && G.rs && e.onGround &&
        (e.vx * e.vx + e.vz * e.vz) <= EL.REST_EPS &&
        (((e.age + 1 + e.id) % G.rs) !== 0)) {   // ServerWorld.tickEntity does age++ BEFORE tick(): the test sees this tick's age
      e.age++;
      e.restSkipped = true;   // no move() this tick, so no Entity.checkBlockCollision either
      if (e.type === 'item') EL.tickItem(e);
      if (e.type === 'experience_orb' && NS.Xp && NS.Xp.ready) { NS.Xp.pull(e); NS.Xp.tick(e); }   // G21
      return;
    }
    e.restSkipped = false;
    if (e.type === 'experience_orb' && NS.Xp && NS.Xp.ready) NS.Xp.pull(e);   // G21: ExperienceOrbEntity.tick pulls BEFORE move
    var dx = e.vx, dy = e.vy, dz = e.vz;
    // vanilla clamps a single step so a teleport cannot tunnel the collision sweep
    if (dx > EL.MAX_STEP) dx = EL.MAX_STEP; else if (dx < -EL.MAX_STEP) dx = -EL.MAX_STEP;
    if (dy > EL.MAX_STEP) dy = EL.MAX_STEP; else if (dy < -EL.MAX_STEP) dy = -EL.MAX_STEP;
    if (dz > EL.MAX_STEP) dz = EL.MAX_STEP; else if (dz < -EL.MAX_STEP) dz = -EL.MAX_STEP;
    var fd0 = e.fallDistance || 0, fy0 = e.y;
    if (e.type === 'potion') { e.sx = e.x; e.sy = e.y; e.sz = e.z; e.svx = dx; e.svy = dy; e.svz = dz; }   // Po.tick sweeps pos -> pos+velocity (ProjectileUtil.getCollision)
    if (e.noClip && e.type === 'trident') { e.x += dx; e.y += dy; e.z += dz; }   // PersistentProjectileEntity.tick noClip branch: setPos, no collision (#5615)
    else if (e.type === 'ender_pearl') {
      // ThrownEntity.tick: ProjectileUtil.getCollision rays pos -> pos+velocity FIRST (a hit leaves the
      // pearl where it was: onCollision teleports the owner to THAT position), else setPosition(pos+velocity).
      // No Entity.move box sweep, no onGround/collision flags.
      var plen = Math.sqrt(dx * dx + dy * dy + dz * dz), pbh = null;
      if (plen > 0 && NS.Ray && NS.Combat && NS.Combat.arrowCollides) pbh = NS.Ray.cast(e.x, e.y, e.z, dx / plen, dy / plen, dz / plen, plen, NS.Combat.arrowCollides, true);
      e.pearlHit = !!pbh; e.pearlEntity = null;
      if (plen > 0 && NS.Throw && NS.Throw.pearlSweep) {   // ProjectileUtil.getEntityHitResult: the SWEPT box, an entity nearer than the block wins
        var peh = NS.Throw.pearlSweep(e, dx, dy, dz, pbh && typeof pbh.t === 'number' ? pbh.t : (pbh ? 0 : Infinity));
        if (peh) { e.pearlEntity = peh; e.pearlHit = true; pbh = true; }
      }
      e.onGround = e.horizontalCollision = e.verticalCollision = false;
      if (!pbh) { e.x += dx; e.y += dy; e.z += dz; }
    }
    else if (EL.THROWN[e.type] && EL.RAYCAST_THROWN[e.type]) EL.flyThrown(e, dx, dy, dz);
    else if (e.type === 'llama_spit') { e.x += dx; e.y += dy; e.z += dz; }   // LlamaSpitEntity.tick: setPosition(pos + v0), no Entity.move sweep (#6728)
    else Ph.move(e, dx, dy, dz);
    if (e.type === 'falling_block') EL.tickFallingBlock(e, fd0 + (fy0 - e.y));   // landing, then the 0.98 drag
    else if (EL.THROWN[e.type] && EL.RAYCAST_THROWN[e.type]) { /* flyThrown above did the drag and gravity */ }
    else if (EL.THROWN[e.type]) { EL.dampThrown(e); e.vy -= Math.fround(e.gravity); }
    else if (e.type === 'llama_spit') { var sd = Math.fround(e.drag); e.vx *= sd; e.vy = e.vy * sd - Math.fround(e.gravity); e.vz *= sd; }   // multiply(0.99F) THEN add(0, -0.06F) (#6728)   // ThrownEntity.getGravity() is a float: (double)0.05F
    else EL.damp(e);
    e.age++;
    // ⚠ AFTER THE MOTION AND AFTER THE AGE. The despawn and the merge both read `age`, and the
    // pickup delay must have counted the tick the entity actually moved through.
    if (e.type === 'item') EL.tickItem(e);
    if (e.type === 'experience_orb' && NS.Xp && NS.Xp.ready) NS.Xp.tick(e);   // G21 -- same dispatch slot
    // D-338 — the damage bookkeeping of a living entity: the grace period, the red flash and the
    // death animation. Guarded on the FIELD rather than on a type list, because `maxHealth` is
    // only set for the types the jar says are living entities (D-336).
    // ⚠ D-391 FIX: this call was DUPLICATED (a copy-paste leftover with a garbled second comment)
    // and ran `Combat.tickEntity` twice a tick — halving every one of its own timers in effect
    // (invulnerability, the hurt flash, the death animation) without any check catching it,
    // because every existing assertion drives `Combat.tickEntity` directly rather than through
    // a live `EntityList` tick (D-276's lesson, found here rather than named by a check).
    if (e.maxHealth !== undefined && NS.Combat) NS.Combat.tickEntity(e);
    // loop/zombievariants-s100 (QUEUE 0.2 G18c) -- the drowned's own thrown trident, the SAME
    // dispatch slot the arrow above already occupies (Cb.tickTrident, 14j_combat.js).
    if (e.type === 'trident' && NS.Combat && NS.Combat.tickTrident) {
      NS.Combat.tickTrident(e);
    }
    // loop/snowgolem -- the live snowball's own consequence: 3 damage to a blaze, 0 (but
    // still a knockback/hurt flash) to anything else, discard on any hit. `Cb.tickSnowball`
    // decides what either means; this is only the dispatch, the same idiom the arrow/
    // trident dispatches immediately above already use.
    if (e.type === 'snowball' && NS.Combat && NS.Combat.tickSnowball) {
      NS.Combat.tickSnowball(e);
    }
    // loop/witchpotion-s95 -- the live potion's own consequence: splash on impact, discard.
    // `Po.tick` decides what either means; this is only the dispatch (07z_potion.js).
    if (e.type === 'potion' && NS.Potion && NS.Potion.tick) { NS.Potion.tick(e); }
    // loop/throwables-s116 -- the live area-effect cloud's own consequence: the wait, the
    // radius decay and the every-5-ticks reapplication sweep. `Po.tickCloud` decides what
    // any of that means; this is only the dispatch, the same slot `potion` above occupies.
    if (e.type === 'area_effect_cloud' && NS.Potion && NS.Potion.tickCloud) { NS.Potion.tickCloud(e); }
    // loop/throwables-s116 -- the player's own thrown egg/ender pearl. `Throw.tickEgg`/
    // `Throw.tickPearl` (07zzd_throw.js) decide the consequence (chicken hatch / owner
    // teleport); this is only the dispatch, the same slot `snowball`/`potion` occupy.
    if (e.type === 'egg' && NS.Throw && NS.Throw.tickEgg) { NS.Throw.tickEgg(e); }
    if (e.type === 'ender_pearl' && NS.Throw && NS.Throw.tickPearl) { NS.Throw.tickPearl(e); }
    if (e.type === 'experience_bottle' && NS.Throw && NS.Throw.tickBottle) { NS.Throw.tickBottle(e); }   // #5080
    // loop/tnt-s96 -- TntEntity's own fuse countdown/explode trigger (07zc_tnt.js), same
    // generic-entity dispatch slot potion/evoker_fangs already occupy.
    if (e.type === 'tnt' && NS.Tnt && NS.Tnt.tick) { NS.Tnt.tick(e); }
    // loop/lightning -- the live bolt's own ambient-tick/strike/fade dispatch (Lgt.tick,
    // src/07zzc_lightning.js), same generic-entity dispatch slot potion/tnt occupy above.
    if (e.type === 'lightning_bolt' && NS.Lightning && NS.Lightning.tick) { NS.Lightning.tick(e); }
    // loop/blazeghast -- the small fireball's own consequence: 5 damage + 5s fire on an
    // entity, or the block it hit set alight, discard either way. `Bl.Fireball.tickSmall`
    // decides which (07zzh_blaze.js); this is only the dispatch, same slot as every projectile
    // consequence above.
    if (e.type === 'small_fireball' && NS.Blaze && NS.Blaze.Fireball && NS.Blaze.Fireball.tickSmall) {
      NS.Blaze.Fireball.tickSmall(e);
    }
    // loop/blazeghast -- the big fireball's own consequence: 6 direct damage then the real
    // explosion (`NS.Explosion.explode`, the SAME substrate creeper/TNT already call).
    // `Gh.tickFireball` decides which (07zzi_ghast.js); same dispatch slot.
    // QUEUE 0.00 part 2 (D-787) -- the live wither skull's own consequence: 8 damage (owned) or
    // 5 (unowned, DamageSource.MAGIC) plus a difficulty-scaled Wither status effect on a landed
    // hit, then an always-on power-1.0 explosion and discard either way. `Wi.tickSkull` decides
    // which (07zzm_wither.js); this is only the dispatch, same slot as every projectile above.
    if (e.type === 'dragon_fireball' && NS.EnderDragon && NS.EnderDragon.tickDragonFireball) { NS.EnderDragon.tickDragonFireball(e); }
    if (e.type === 'wither_skull' && NS.Wither && NS.Wither.tickSkull) { NS.Wither.tickSkull(e); }
    // cloud unit (confident-lamport-nq63qx) -- the shulker bullet's own consequence: home toward
    // its target, hit-test entities/blocks, apply 4 damage + Levitation. `Sh.tickBullet` decides
    // which (07zzk_shulker.js); this is only the dispatch, same slot as every projectile above.
    // loop/llama-s97 -- the live llama_spit's own consequence: hit an entity, or discard once
    // embedded in a solid block. Ll.tick decides which (07ze_llama.js); this is only the
    // dispatch, the same slot potion/tnt immediately above occupy.
    if (e.type === 'llama_spit' && NS.Llama && NS.Llama.tick) { NS.Llama.tick(e); }
    // D-512 — EvokerFangsEntity.tick()'s server half (07v_spell.js): warmup, the one damage tick
    // at warmup -8, discard. Without this the fangs an evoker conjured in the live game never bit.
    if (e.type === 'evoker_fangs' && NS.Spell && NS.Spell.tickFangs) NS.Spell.tickFangs(e, EL.aiCtx(e));
    // D-391 — G18b's live wiring: an actually-spawned mob with a rostered goal selector
    // (`EL.spawn` attaches `e.ai` for `Ai.ROSTER` types) runs it here, AFTER gravity/collision
    // and the combat timers, so a goal reacting to `justHurt`/`lastHurtByEntity` sees this same
    // tick's hit. Skipped once dead — a corpse mid-death-animation does not path or panic.

    // ⚠⚠ **THE WALK CYCLE'S OWN CLOCK — D-415.** `LivingEntity.aiStep()` ends by measuring how
    // far the entity moved ON THE GROUND PLANE this tick and easing a 0..1 "how fast am I
    // walking" into `animationSpeed`, then accumulating it into `animationPosition`:
    //
    //     this.animationSpeedOld = this.animationSpeed;
    //     float f = min(1, sqrt(dx*dx + dz*dz) * 4.0F);
    //     this.animationSpeed += (f - this.animationSpeed) * 0.4F;
    //     this.animationPosition += this.animationSpeed;
    //
    // Those two numbers ARE `setupAnim`'s `limbSwing` and `limbSwingAmount`, and without them
    // `ER.setupAnimDelta` — ported from the bytecode a whole session ago (D-263) and correct —
    // had nothing to be called with, so every mob in the game stood in its rest pose while it
    // slid across the ground. ⚠ It is DISTANCE, not time: a mob walking into a wall stops
    // swinging its legs, which is the whole reason vanilla measures the move instead of the
    // clock. AFTER the AI (which is what moved it) and only for a LIVING entity — an arrow
    // has no limbs and `LivingEntity.aiStep` is the only place this runs.
    EL.tickAnim(e);
  };

  /** The walk cycle's clock, split out at D-417 so `EL.tickMob` runs the same one. */
  EL.tickAnim = function (e) {
    if (e.maxHealth === undefined) return;
    e.animSpeedO = e.animSpeed || 0;
    var adx = e.x - e.px, adz = e.z - e.pz;
    var af = Math.sqrt(adx * adx + adz * adz) * 4;
    if (af > 1) af = 1;
    e.animSpeed = (e.animSpeed || 0) + (af - (e.animSpeed || 0)) * 0.4;
    e.animPos = (e.animPos || 0) + e.animSpeed;
    // IronGolemEntity.tickMovement (:123-125): lookingAtVillagerTicksLeft counts down outside the goal too.
    if (e.lookingAtVillagerTicks > 0) e.lookingAtVillagerTicks--;
    // QUEUE 0.2 — `LivingEntity.tick()` keeps `tickHandSwing()` right beside the walk-cycle's own
    // bookkeeping (`aiStep()`); this is the same pairing, one call, once per mob per tick.
    if (NS.EntityRender && NS.EntityRender.tickHandSwing) NS.EntityRender.tickHandSwing(e);
  };

  /**
   * One tick of the whole list.
   *
   * ⚠ THE REMOVED ARE SWEPT AFTER THE WALK, NOT DURING IT. Splicing inside the loop is how a
   * list skips the entity after every one it drops — the same shape as `BlockEntities.tick`'s
   * note about collecting moving pistons first (D-298).
   */
  // #817 — MOB STEP SOUNDS. `Entity.move` (.decomp Entity.java:617-650) accumulates
  // `distanceTraveled += |delta| * 0.6` (the y term only over BlockTags.field_22414/powder
  // snow, ~always 0 here), and when it is STRICTLY > nextStepSoundDistance over a non-air block it
  // sets nextStep = (int)distanceTraveled + 1 and calls `playStepSound`. Per-type overrides below
  // read off each class's `playStepSound`; a type with none plays the block's own step sound at
  // 0.15 * volume (Entity.playStepSound). The player has its own (14_player.js `tickFootsteps`).
  EL.STEP_SOUND = {
    iron_golem: ['entity.iron_golem.step', 1],
    piglin: ['entity.piglin.step', 0.15], piglin_brute: ['entity.piglin_brute.step', 0.15],
    pig: ['entity.pig.step', 0.15], chicken: ['entity.chicken.step', 0.15], llama: ['entity.llama.step', 0.15],
    trader_llama: ['entity.llama.step', 0.15], panda: ['entity.panda.step', 0.15], parrot: ['entity.parrot.step', 0.15],
    cow: ['entity.cow.step', 0.15], mooshroom: ['entity.cow.step', 0.15], zombie: ['entity.zombie.step', 0.15],
    husk: ['entity.husk.step', 0.15], drowned: ['entity.drowned.step', 0.15],
    zombie_villager: ['entity.zombie_villager.step', 0.15], zombified_piglin: ['entity.zombie.step', 0.15],
    hoglin: ['entity.hoglin.step', 0.15], zoglin: ['entity.zoglin.step', 0.15], ravager: ['entity.ravager.step', 0.15],
    skeleton: ['entity.skeleton.step', 0.15], stray: ['entity.stray.step', 0.15],
    wither_skeleton: ['entity.wither_skeleton.step', 0.15], spider: ['entity.spider.step', 0.15],
    cave_spider: ['entity.spider.step', 0.15], wolf: ['entity.wolf.step', 0.15],
    polar_bear: ['entity.polar_bear.step', 0.15], sheep: ['entity.sheep.step', 0.15], goat: ['entity.goat.step', 0.15]
  };
  // Types with no ground step of their own: flyers, swimmers, and the ones with bespoke logic
  // (horse family, turtle, slime cubes, bee) that are not ported here.
  EL.STEP_NONE = {
    bat: 1, bee: 1, ghast: 1, phantom: 1, blaze: 1, vex: 1, ender_dragon: 1, wither: 1, squid: 1, glow_squid: 1,
    cod: 1, salmon: 1, pufferfish: 1, tropical_fish: 1, dolphin: 1, guardian: 1, elder_guardian: 1, turtle: 1,
    horse: 1, donkey: 1, mule: 1, skeleton_horse: 1, zombie_horse: 1, slime: 1, magma_cube: 1, armor_stand: 1,
    endermite: 1, silverfish: 1,   // getMoveEffect()==EVENTS: no step sound (#3493)
    strider: 1   // #1196: Strider.tickSounds (07zzj) owns step/step_lava with the +0.6 override
  };
  EL.tickStep = function (e) {
    if (!e.ai || e.removed || e.dead || e.noclip) return;
    var t = e.type;
    if (t === 'iron_golem') EL.golemDust(e);
    if (e.moveDist === undefined) { e.moveDist = 0; e.nextStep = 1; }
    var dx = e.x - e.px, dy = e.y - e.py, dz = e.z - e.pz;
    if (e.vehicle || EL.STEP_NONE[t]) return;
    if (NS.Undead && NS.Undead.ZOMBIE_FAMILY && NS.Undead.ZOMBIE_FAMILY[t]) return;   // #4303: Undead.tickSounds owns the zombie family's step (gated)
    if (NS.MobVoice && NS.MobVoice.GATED && NS.MobVoice.AUDITED[t]) return;   // #4384: an audited type's step is MobVoice.tickStep's (one owner)
    e.moveDist += Math.sqrt(dx * dx + dz * dz + (e.inPowder ? dy * dy : 0)) * 0.6;
    if (!(e.moveDist > e.nextStep)) return;
    var W = NS.World, S = NS.Sound;
    var bx = Math.floor(e.x), by = Math.floor(e.y - 0.2), bz = Math.floor(e.z);
    var below = W && W.getBlock(bx, by, bz);
    if (!below) return;
    e.nextStep = (e.moveDist | 0) + 1;
    if (NS.GameEvent && !e.inWater) NS.GameEvent.emit('step', e.x, e.y, e.z, e);
    if (NS.GameEvent && e.inWater) NS.GameEvent.emit('swim', e.x, e.y, e.z, e);   // Entity.playSwimSound -> SWIM   // Entity.playStepSound -> STEP
    if (!S || !S.ready || e.inWater) return;
    var st = EL.STEP_SOUND[t];
    if (st && NS.Llama && NS.Llama.isLlama(e)) NS.Llama.playSound(e, st[0], st[1], 1);   // #4483: llama's step goes through the #4003 gate
    else if (st) S.play(st[0], { volume: st[1], pitch: 1, x: e.x, y: e.y, z: e.z, source: 'neutral' });
    else S.blockStep(below, e.x, e.y, e.z, null, 'neutral');
  };
  // IronGolemEntity.tickMovement (.decomp IronGolemEntity.java:127-146): a walking golem kicks up
  // block dust from the block under it.
  /** #1023 -- `RavagerEntity.spawnStunnedParticles` (.decomp :205-216): 1/6 per tick, one `entity_effect` at the
   *  head (behind `width` along bodyYaw, +-0.3 jitter, y+height-0.3), velocity triple == RGB.
   *  The roar's 40 POOF particles are owed: no `poof` particle type exists in 07zx_particle.js yet. */
  EL.ravagerStunParticles = function (e) {
    var Px = NS.Particle, rnd = EL.random || Math.random;
    if (!Px || Math.floor(rnd() * 6) !== 0) return 0;
    var yaw = (e.yBodyRot !== undefined ? e.yBodyRot : (e.yaw || 0)) - Math.PI, w = e.width || 1.95;
    var x = e.x - w * Math.sin(yaw) + (rnd() * 0.6 - 0.3), z = e.z + w * Math.cos(yaw) + (rnd() * 0.6 - 0.3);
    var p = Px.spawn('effect', x, e.y + (e.height || 2.2) - 0.3, z, 0.4980392156862745, 0.5137254901960784, 0.5725490196078431);
    if (p) { p.red = 0.4980392156862745; p.green = 0.5137254901960784; p.blue = 0.5725490196078431; }
    return 1;
  };
  EL.golemDust = function (e) {
    var Px = NS.Particle, W = NS.World;
    if (!Px || !W || e.vx * e.vx + e.vz * e.vz <= 2.5000003E-7) return;
    var r = EL.random || Math.random;
    if (Math.floor(r() * 5) !== 0) return;
    var bx = Math.floor(e.x), by = Math.floor(e.y - 0.2), bz = Math.floor(e.z);
    var st = W.getBlock(bx, by, bz);
    if (!st) return;
    Px.spawnBlockDust(e.x + (r() - 0.5) * e.width, e.y + 0.1, e.z + (r() - 0.5) * e.width,
      4 * (r() - 0.5), 0.5, (r() - 0.5) * 4, st, bx, by, bz, r);
  };

  /** #5659 `Entity.doWaterSplashEffect` for non-mob entities (item, boat, arrow, tnt, falling_block, minecart): on the
   *  tick the feet-cell turns to water, entity.generic.splash/swim at min(1, sqrt(.2vx^2+vy^2+.2vz^2)*.2) and
   *  1+width*20 bubbles plus as many splashes at floor(y). Mobs get theirs from MobVoice.tickWater. */
  EL.waterSplash = function (e) {
    var Ph = NS.Physics, SR = NS.States;
    if (!Ph || !Ph.blockAt || !SR || !SR.waterIn) return false;
    var fs = Ph.blockAt(e.x, e.y + 0.4, e.z), w = fs !== 0 && SR.waterIn[fs] === 1, was = e.splashWet;
    e.splashWet = w;
    if (!w || was !== false || e.removed) return false;
    var vx = e.vx || 0, vy = e.vy || 0, vz = e.vz || 0, rnd = EL.random || Math.random;
    var g = Math.min(1, Math.sqrt(vx * vx * 0.2 + vy * vy + vz * vz * 0.2) * 0.2);
    if (NS.Sound && NS.Sound.play && !e.silent) NS.Sound.play(g < 0.25 ? 'entity.generic.splash' : 'entity.generic.swim',
      { x: e.x, y: e.y, z: e.z, volume: g, pitch: 1 + (rnd() - rnd()) * 0.4, source: 'neutral' });
    if (NS.Particle && NS.Particle.spawn) {
      var wd = e.width !== undefined ? e.width : 0.25, n = 1 + Math.floor(wd * 20), fy = Math.floor(e.y);
      for (var i = 0; i < n; i++) {
        var ox = (rnd() * 2 - 1) * wd, oz = (rnd() * 2 - 1) * wd;
        NS.Particle.spawn('bubble', e.x + ox, e.y + 1, e.z + oz, vx, vy - rnd() * 0.2, vz, rnd);
      }
      for (var j = 0; j < n; j++) {
        var px = (rnd() * 2 - 1) * wd, pz = (rnd() * 2 - 1) * wd;
        NS.Particle.spawn('splash', e.x + px, fy + 1, e.z + pz, vx, vy, vz, rnd);
      }
    }
    return true;
  };

  EL.tick = function () {
    if (!EL.ready || !NS.Physics) return 0;
    var list = EL.list, i, len, n = 0, W = NS.World;
    // Entities spawned during this pass (a chained TNT) wait for the next tick, as in vanilla's entity queue.
    for (i = 0, len = list.length; i < len; i++) {
      var e = list[i];
      if (e.removed) continue;
      // D-452 — outside SIMULATION distance, an entity is loaded (its chunk may still be
      // rendered) but does not tick, exactly as a vanilla entity in a non-ticking chunk sits
      // frozen rather than moving or thinking.
      if (W && W.tickingAt && !W.tickingAt(e.x, e.z)) continue;
      EL.tickOne(e);
      EL.tickStep(e);
      n++;
    }
    var w = 0;
    for (i = 0; i < list.length; i++) if (!list[i].removed) list[w++] = list[i];
    list.length = w;
    // QUEUE 0.2 (Tame.OWED "leashing") -- ONE call, once per tick: every leashed mob's
    // PathAwareEntity.updateLeash physics and every knot's canStayAttached poll. See
    // 07n_tame.js's own Tm.tickLeash header for why this is a single list-once pass rather
    // than a per-entity hook inside EL.tickOne/tickMob above.
    if (NS.Tame && NS.Tame.tickLeash) NS.Tame.tickLeash();
    EL.ticks++;
    return n;
  };

})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
