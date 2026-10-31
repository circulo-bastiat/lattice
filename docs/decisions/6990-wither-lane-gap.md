# #6990 wither lockstep lane: where salt 0 stands

Ported to the wither lane (tools/lockstep-witherlane.mjs, `blazelane.mjs`): the server's per-entity Random seed (class `bkx`), the two
uuid nextLongs, raw unrounded Pos / Rotation / TGT capture, `acquireAt` aggro, and `proj: wither_skull` + `rot` in `lanes.d/wither.json`.

Salt 0 still diverges at tick 1: engine [11.8,0.312,0.512], server [11.5118,0.012,0.5].

Findings (server run, `WITHER_DUMP=1 MCLITE_LOCKSTEP_SERVER=1 MCLITE_LOCKSTEP_SALTS=0`):
- The server's TGT log is empty for the whole run: `SeedAgent` hooks the ground-navigation tick (`nav`), which a flying wither never
  runs, so no acquisition tick `k` exists and the engine cannot be aggroed at the server's tick. OWED: hook `MobEntity.getTarget` on a
  per-mob tick (or the wither's tracked-entity-id 0) in `SeedAgent.java`.
- Server Pos.z never leaves 0.5 (engine drifts to .512, .504, ...), and the server's x/y ramp is 0.0118/0.012 at tick 1, then
  0.316/0.315 (WitherEntity.tickMovement: the 0.3 horizontal/vertical impulse only fires once TrackedEntityId(0) is set by mobTick).
  The engine applies the impulse at tick 1 and adds a z wander term the server does not have.
OWED: server-side target capture for flying mobs, then align the engine's first-impulse tick and z term.

## #10617: the z wander term (fixed)
Two engine bugs in `Fl.MoveControl.tick` (07t_fly.js), not a wander: (1) yaw used `atan2(d0,-d2)`, which is pi when d0=d2=0 (vanilla's
`atan2(d2,d0)` is 0 = east); now `atan2(d2,d0)+pi/2`. (2) path nodes advanced at 0.5 blocks 3D; vanilla `checkForNextNode` uses
|dx|,|dz| < width/2 (or 0.75-width/2 when width<=0.75) and |dy| < 1, so the engine steered back to the start cell's centre. Salt 0 pos.z
is now exactly 0.5 for the whole window. The tick-1 x/y impulse timing (server 11.5118 vs engine 11.812) is still OWED.

## #10615 update: server TGT capture for the wither
`SeedAgent.flyTgt` (called from the Entity.tick hook, active under `mclite.lockstep.pathlog`) writes `TGT <gen> <age+1> <id|-1>` for a wither.
Salt 0 server TGT: `[null,null,-1,6,6,...]`, so the first acquisition is at tick 3 (target id 6). Remaining owed: align the engine's first-impulse tick and z term.

## #6990 update (impulse tick aligned; wander move not ported)
- The wither TGT line is logged at age+1, so the first `TGT` index k is one past the row where the server's 0.3 impulse lands. The lane now aggroes the engine at k-1:
  engine row 2 = [11.8,0.312,0.512] against server row 2 = [11.8278,0.3268,0.5] (was a full row late).
- The tick-1 server nudge (+0.0118 x, +0.012 y, z 0) is NOT noise and NOT a push: `FlightMoveControl.tick` in MOVE_TO state sets `setNoGravity(true)` and
  `setUpwardSpeed(+-speed)`, i.e. 0.6 * moveRelative(0.02) = 0.012 vertical, and 0.6 * 0.02 along the yaw = 0.0118/0 forward. So the server wither already has a
  wander `MOVE_TO` from its FlyGoal before it acquires a target; the engine has no FlightMoveControl-driven wander for the wither (it idles with 0 velocity).
- The engine's z .512 comes from `Wi.tickMovement` steering at a player whose z differs by a few percent of the distance; the server's z stays 0.5 (the tracked
  target's dz is 0 there, or the wander move cancels it).
OWED: port the wither's FlyGoal wander + FlightMoveControl (moveRelative with yya/zza, 0.91 friction, noGravity toggle) so tick 1 matches, then re-check the z term.

## #10618: salt 0 now matches ticks 0..72 bit-exact (pos tol 1e-12)
Float fidelity, not a wander: FlightMoveControl WAIT zeroes upwardSpeed (stale yya moved the wither after its FlyGoal ended); `forwardSpeed *= 0.98F` for flyMove mobs;
movementSpeed/flyingSpeed/friction are floats (0.6F, 0.02F, 0.91F), `MathHelper.sin/cos` table for the move direction; the impulse's y uses 0.6F but x/z use the double 0.6;
Wi.FlyGoal continues while the BirdNavigation path is not finished (node proximity), not by a squared distance.
First divergent tick for salt 0 is now 73 (pos x: engine 24.5347 vs server 24.5318; y matches). OWED: what the server does at tick 73 (a new wander / retarget draw).
The lane's engine side acquires on its own at tick 1, so `acquireAt` shifts nothing; the anti-vacuity row shifts the whole ramp one tick instead.

## #10618: server-stream draws ported (salt 0 still not 'identical')
Decomp-derived, now in the engine: (1) `WitherEntity.tickMovement` evaluates its `addParticle` arguments on the server too, so the entity Random advances 9 `nextGaussian`
per tick (+ gaussian/nextFloat/gaussian x3 while invulnerable) after goals+mobTick (`Wi.burnParticleDraws`); (2) stroll is `nextInt(toGoalTicks(120)) = nextInt(60)`, LookAt/RandomLook
canUse are one `nextFloat`, and none of the three is reached on odd ages > 1 (`MobEntity.tickNewAi`, `Wi.everyOther`); (3) the lane holds the engine's own acquisition (`e.holdAcquire`) until k-1 so the goals roll before a target exists.
Open: the server's first `nextInt(60)` is 0 only at raw step 2 / 93 / 153 after the uuid longs; the engine's first eval is at step 5 and its chain is 5, 48, 99 (unfinished: the engine and server disagree on
the pre-first-eval draw count, ~88 steps). Until that is found salt 0 pos diverges at tick 1 in the SERVER run (it matched only by an accident of the old nextDouble roll); the default (engine-only) run is unaffected.

## #10618: the real server's wither draw order (measured, RNGDBG=1)
`RNGDBG=1` now also turns on the SeedAgent per-draw log for `mob: 'wither'` (run.mjs; seed state per draw, matched back to the engine's JRandom chain from `serverEntitySeed(0,'bkx')`).
Salt 0, the server's first wither stream, by draw index (index 1 = state after the first logged draw; the first four are the two uuid nextLongs):
- 1..3 uuid (`ajl.a` in the entity ctor), then **tick 1 starts with ONE draw in `Entity.baseTick`** (`aya.an`, the `Mob` ambient-sound `nextInt(1000)`) - the engine draws nothing there;
- 5..8 = `WitherEntity.customServerAiStep` head updates (nextInt(10) pairs, tick 1 only for the first few ticks) - this one the engine matches (`sideHeadsTick`);
- 9..44 = `WitherEntity.aiStep` particle gaussians (36 steps on tick 1, then 20-28 per tick: 1 baseTick draw + 9 gaussians);
- **NO goal draw (no FlyGoal/LookAt/RandomLook `nextInt(60)`/`nextFloat`) appears in the first ~400 steps (~15 ticks)**, and there is no spawn-time followBonus gaussian / leftHanded float at all.
  The engine, by contrast, burns 4 (followBonus) + 1 (leftHanded) steps in `EL.spawn` and rolls `nextInt(60)` at its step 9. So the ~88-step disagreement in the note above is not a missing
  draw count: the server's stroll roll is not reached on the entity Random in the first ticks (the tick-1 0.0118/0.012 nudge has another source), and the engine's spawn draws are not the wither's.
OWED: find what the server wither does at tick 1 without a goal draw (is `WitherDoNothingGoal`/invulnerable-time gating the FlyGoal? the tick-1 nudge comes from `FlightMoveControl` WAIT->MOVE_TO), drop the engine's wither spawn draws, add the baseTick nextInt(1000); only then can salt 0 read 'identical'.

## #10618: engine wither no longer burns spawn followBonus/leftHanded draws
`EL.initialize` skips both rolls for `wither` (the real server's wither stream has neither, RNGDBG measurement above). Salt 0 still diverges at tick 1 (server nudge 0.0118/0.012 with no goal draw):
the lane's `/summon`ed wither is not invulnerable, so a FlyGoal `nextInt(60)` is expected but absent on the server. OWED: find which server-side gate stops the goal selector/draws (and what sets MOVE_TO), add the baseTick `nextInt(1000)`.

## #10618: state check (3rd session)
Rebuilt on master + earlier work: `MCLITE_LOCKSTEP_SERVER=1 MCLITE_LOCKSTEP_SALTS=0 node tools/lockstep-witherlane.mjs` still ends `DIVERGENCE salt 0 tick 1 field pos: engine [11.5,0,0.5] server [11.51176,0.012,0.5]`.
Decomp (`WitherEntity.initGoals`, 1.18.2): goals are DescendAtHalfHealth(0, canStart = invul>0), ProjectileAttack(2), FlyGoal(5), LookAtEntity(6), LookAround(7). FlyGoal.canStart is a
`WanderAroundGoal` chance roll on `mob.getRandom()`, so a tick-1 MOVE_TO with no logged goal draw means either the RNGDBG per-draw hook misses that call path (e.g. a second Random instance
via `MobEntity.getRandom` vs `Entity.random`) or MOVE_TO is set elsewhere. Next step: log the Random identity in the SeedAgent hook for tick 1 (not the engine) before touching the engine again.

## #10618: the tick-1 nudge is solved (server-measured); salt 0 pos is now identical, projectile ticks still differ
SeedAgent (RNGDBG=1, now with `mclite.lockstep.rngmeth` method names and an `MVTO` log of MoveControl.moveTo / EntityNavigation / Path ctor callers) shows the nudge comes from
`ProjectileAttackGoal` ticking in tick 1 (`bdu.a -> bfg.e -> ber.e -> navigation.startMovingTo(target)` -> Path -> `BirdNavigation.tick` -> `moveTo`): the wither HAS its target in tick 1
(ActiveTargetGoal with chance 0 draws nothing), so there is no FlyGoal/wander draw at all. The lane's acquireAt (TGT index - 1) was one tick late: now `TGT index - 2`.
With that, server and engine positions agree for the whole run (compare returns null on pos). The lane now fails only on `proj` (skull spawn ticks: engine 14,16,41.. vs server 13,19,41..).
Also: `Wi.tickParticles` drew from `NS.fbRand` (= the entity's server Random in the lockstep lanes) on top of `Wi.burnParticleDraws`; it now uses a private visual stream. `Wi.tickMovement` draws
the baseTick `nextInt(1000)` each tick (server: `aya.an`, one draw before the goal/head draws).
OWED: the engine's first entity-Random draw after the uuid longs is the server's SECOND (engine tickMovement nextInt(1000)=543 = server draw 6; server baseTick=317 = draw 5), i.e. the engine
stream is one step ahead (or `serverEntitySeed(salt,'bkx',n)` n differs); once aligned the side-head nextInt(10)/nextInt(size) values (server 3,.,0,.) give the skull ticks.
