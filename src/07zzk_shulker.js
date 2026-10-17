// src/07zzk_shulker.js — D-773 cloud unit (confident-lamport-hlerdd): shulker AI IDENTITY, the
// slice confident-lamport-asj6ue's own findings file (docs/cloud-findings/) left as item (1) of
// what the mob still owes after its motion-substrate row landed ("it will fall like any other
// golem until a real AI stage exists"). `confident-lamport-nq63qx` (a later cloud unit) added the
// ATTACK half hlerdd's own findings file left as item (2) — `Sh.ShootBulletGoal`/`Sh.TargetPlayerGoal`
// below `PeekGoal`, plus the bullet projectile itself (`Sh.tickBullet`, dispatched from
// `07i_entitylist.js` the same way `Gh.tickFireball` is) — renderer/model is still OWED.
//
// .decomp read whole: net/minecraft/entity/mob/ShulkerEntity.java. `initGoals`:
//   1:LookAtEntityGoal(Player,8.0F,0.02F,true) · 4:ShootBulletGoal · 7:PeekGoal · 8:LookAroundGoal
//   targets: 1:RevengeGoal(group) · 2:TargetPlayerGoal · 3:TargetOtherTeamGoal
//
// -- WHAT THIS FILE BUILDS (the mob's own IDENTITY, not its combat) ------------------------
// A shulker is not a `PathAwareEntity` that happens to sit still — vanilla overrides
// `getVelocity()`/`setVelocity()` to be permanently zero and `move()` to ignore every
// MovementType except its own teleport, so NO goal here ever claims `Ai.MOVE`. What replaces
// movement is `tick()`'s own `!canStay(pos, face) -> tryAttachOrTeleport()` check, which this
// engine has no per-tick hook for outside the goal selector — ported as a flags:0 goal at
// priority 0 (`sharesFlag` is always false against flags:0, so it runs every tick and can never
// be blocked by or block anything else, the same "runs always" shape `EL.tickMob`'s dispatch
// already relies on `e.ai.tick()` for). `Sh.PeekGoal` is priority 7's own peek/close cycle,
// ready for a future renderer to read `e.shulkerPeek`. `LookAtEntityGoal` is
// `Sh.LookAtPlayerGoal` (0.02 chance gate, 40-80 tick look, 3D range; #2718) and
// `LookAroundGoal` reuses `Ai.RandomLookAroundGoal` (the SAME idle-head-turn stand-in pig/cow/
// ghast/etc. already use).
//
// -- WHAT IS DELIBERATELY NOT HERE (Shulker.OWED, below) ------------------------------------
//   - The bounding-box GROWTH while open and `moveEntities()` (pushing whatever is standing in
//     the opening lid out of the way) — real-only geometry (a per-face-direction AABB stretch)
//     this session does not wire; `e.shulkerPeek` is tracked so a later pass can.
//   - `ShulkerLookControl`'s body-relative yaw math — still OWED (07zzl's SD.OWED). The renderer
//     and `ShulkerBodyControl` (the no-op body) now live in 07zzl_shulkerdraw.js.
//   - The low-health/arrow-hit teleport-away reaction landed this unit (mob-shulker cloud pass):
//     `Cb.hurt` (14j_combat.js) now carries a `e.type === 'shulker'` hook the SAME way the
//     enderman/bat/axolotl per-type hooks already sit in that function -- a CLOSED shulker
//     swallows a `PersistentProjectileEntity` hit outright (`damage()`'s own early-return,
//     .decomp:414-418) and, once a hit actually lands, under-half-health-with-a-1-in-4-roll
//     calls the real `Sh.tryTeleport` (`damage()`'s own :424 call, not a re-derivation). `spawnNewShulker()` (#657) is the
//     `else if` of that roll, triggered by a SHULKER BULLET hit (`src.sourceEntity.type ==
//     'shulker_bullet'`, #850) -- evoker fangs are not projectiles and never trigger it.
//   - `pushAwayFrom`/`isPushable` (vanilla: shulker never receives a push velocity of its own,
//     though others still collide against its hitbox) — `EL.pushAround` has no per-type opt-out
//     besides the bat-shaped `e.type !== 'bat'` guard it already carries, so a shulker jostled by
//     a crowding mob can still pick up a small horizontal nudge here that vanilla would not give
//     it. Bounded and rare (nothing paths toward a wall-mounted shulker to crowd it), not fixed
//     this pass.
(function (NS) {
  // fallback stream when a caller passes no rng: the entity list's, else a fixed-seed JRandom (never Math.random, #6439)
  var fbR = null;
  function RNDFB() { var L = NS.EntityList; if (L && L.random) return L.random(); if (!fbR) fbR = NS.JRandom ? new NS.JRandom(0x6439) : { s: 0x6439, nextDouble: function () { this.s = (Math.imul(this.s, 1103515245) + 12345) >>> 0; return this.s / 4294967296; } }; return fbR.nextDouble(); }
  'use strict';
  var Sh = NS.Shulker = { ready: false };

  // -- direction tables, `Direction.values()` order (D,U,N,S,W,E) -- the SAME order
  // `NS.Reg.DIRS` (02b_registry.js) and `07_world.js`'s own SUP_DX/SUP_DY/SUP_DZ/FACE_OF_SUP
  // already use for this exact purpose (a block's "which face" argument to `SR.faceSturdy`,
  // whose OWN dir argument is a DIFFERENT order — ARCH: 0 +X,1 -X,2 +Y,3 -Y,4 +Z,5 -Z, per its
  // own header in 02c_states.js). Reused here as the same index space, not re-derived.
  Sh.DX = [0, 0, 0, 0, -1, 1];
  Sh.DY = [-1, 1, 0, 0, 0, 0];
  Sh.DZ = [0, 0, -1, 1, 0, 0];
  Sh.OPPOSITE = [1, 0, 3, 2, 5, 4];   // down<->up, north<->south, west<->east
  Sh.ARCH = [3, 2, 5, 4, 1, 0];       // this SUP index -> faceSturdy's own ARCH index

  Sh.DOWN = 0;   // Direction.field_11033 (Yarn does not name it in this worktree's names.tsv,
                 // but it is `Direction.values()[0]` — DOWN — the same well-known ordinal every
                 // other DIRS-indexed table in this codebase already keys on).

  Sh.BORDER = 29999983;    // default WorldBorder (size 59999968): block x/z within +-29999984 (exclusive max edge)
  Sh.WORLD_BOTTOM = -64;   // CLAUDE.md's own "world range -64 to 256" (D-*, the engine's floor).

  /** `ShulkerEntity.isInvalidPosition` (.decomp), the piston-head carve-out named OWED above. */
  function isInvalidPosition(x, y, z, self) {
    var st = NS.World.getBlock(x, y, z);
    if (st === 0) return false;
    // a MOVING_PISTON in the shulker's own cell (a piston head pushing into it) is allowed
    var R = NS.Reg, SR = NS.States;
    return !(self && R && SR && SR.block && R.names[SR.block[st]] === 'moving_piston' &&
             Math.floor(self.x) === x && Math.floor(self.y) === y && Math.floor(self.z) === z);
  }

  /** `ShulkerEntity.canStay(pos, dir)` (.decomp): a FULL, sturdy face on the block the shulker
   *  is attached AGAINST (one cell in `dir`), reached FROM that block's own opposite face. */
  Sh.canStay = function (x, y, z, dir, self) {
    if (isInvalidPosition(x, y, z, self)) return false;
    var W = NS.World, S = NS.States;
    if (!W || !S || !S.faceSturdy) return false;
    var opp = Sh.OPPOSITE[dir];
    var sx = x + Sh.DX[dir], sy = y + Sh.DY[dir], sz = z + Sh.DZ[dir];
    var support = W.getBlock(sx, sy, sz);
    // World.isDirectionSolid -> isFaceFullSquare(COLLISION shape): not faceSturdy's support/sides
    // shape (leaves stay valid; soul sand and snow layers do not get their support-shape override)
    if (sy < -64 || sy >= 256) return false;
    if (support <= 0 || !S.faceCovers(support, Sh.ARCH[opp], 0, 0, 1024, 1024)) return false;
    // calculateBoundingBox(opp, 1.0): the own cell stretched one cell toward `opp` (the lid space)
    var ox = Sh.DX[opp], oy = Sh.DY[opp], oz = Sh.DZ[opp];
    return Sh.spaceEmpty(self, Math.min(x, x + ox), Math.min(y, y + oy), Math.min(z, z + oz),
                         Math.max(x + 1, x + 1 + ox), Math.max(y + 1, y + 1 + oy), Math.max(z + 1, z + 1 + oz));
  };

  /** `world.isSpaceEmpty(self, box.contract(1e-6))`: block collision shapes, plus the entities
   *  vanilla's `getEntityCollisions` returns (`isCollidable()`: living shulkers, boats, minecarts). */
  Sh.spaceEmpty = function (self, x0, y0, z0, x1, y1, z1) {
    var Ph = NS.Physics, c = 1e-6;
    x0 += c; y0 += c; z0 += c; x1 -= c; y1 -= c; z1 -= c;
    if (Ph && Ph.shapeAt) {
      for (var bx = Math.floor(x0); bx <= Math.floor(x1); bx++)
        for (var by = Math.floor(y0); by <= Math.floor(y1); by++)
          for (var bz = Math.floor(z0); bz <= Math.floor(z1); bz++) {
            var sh = Ph.shapeAt(bx, by, bz);
            if (!sh) continue;
            for (var k = 0; k < sh.length; k++) {
              var b = sh[k];
              if (bx + b[0] < x1 && bx + b[3] > x0 && by + b[1] < y1 && by + b[4] > y0 &&
                  bz + b[2] < z1 && bz + b[5] > z0) return false;
            }
          }
    }
    var EL = NS.EntityList, list = EL && EL.list;
    if (list) for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o === self || o.dead || o.removed) continue;
      var t = o.type;
      if (!(t === 'shulker' || t === 'boat' || (t && t.indexOf('minecart') >= 0))) continue;
      if (t === 'shulker' && o.health !== undefined && o.health <= 0) continue;
      var d = NS.Entities.dimensions(t);
      if (!d) continue;
      var hw = d.width * 0.5;
      if (o.x - hw < x1 && o.x + hw > x0 && o.y < y1 && o.y + d.height > y0 && o.z - hw < z1 && o.z + hw > z0) return false;
    }
    return true;
  };

  /** `ShulkerEntity.findAttachSide` — the first of the six faces (Direction.values() order)
   *  this cell can stay attached to, or -1. */
  Sh.findAttachSide = function (x, y, z, self) {
    for (var d = 0; d < 6; d++) if (Sh.canStay(x, y, z, d, self)) return d;
    return -1;
  };

  /** `[-8,8]` inclusive both ends — `MathHelper.nextBetween(random, -8, 8)`. */
  function nextBetween(rand, lo, hi) { return lo + Math.floor(rand() * (hi - lo + 1)); }

  /** `ShulkerEntity.tryTeleport` — five tries at a random offset within +-8 on each axis; the
   *  first that lands on air, above the world floor, with an attachable face, wins. */
  Sh.tryTeleport = function (e, rand) {
    rand = rand || RNDFB;
    if (e.dead || (e.health !== undefined && e.health <= 0) || e.aiDisabled) return false;
    var W = NS.World;
    var bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
    for (var i = 0; i < 5; i++) {
      var cx = bx + nextBetween(rand, -8, 8);
      var cy = by + nextBetween(rand, -8, 8);
      var cz = bz + nextBetween(rand, -8, 8);
      if (cy <= Sh.WORLD_BOTTOM) continue;
      if (Math.abs(cx) > Sh.BORDER || Math.abs(cz) > Sh.BORDER) continue;   // getWorldBorder().contains(pos)
      if (W.getBlock(cx, cy, cz) !== 0) continue;
      if (!Sh.spaceEmpty(e, cx, cy, cz, cx + 1, cy + 1, cz + 1)) continue;
      var dir = Sh.findAttachSide(cx, cy, cz, e);
      if (dir < 0) continue;
      // vanilla plays the sound before setPosition: it is heard at the origin
      if (NS.Sound && NS.Sound.play) NS.Sound.play('entity.shulker.teleport', { x: e.x, y: e.y, z: e.z, source: 'hostile' });
      e.x = cx + 0.5; e.y = cy; e.z = cz + 0.5;
      e.px = e.x; e.py = e.y; e.pz = e.z;
      e.shulkerFace = dir;
      e.shulkerPeek = 0;
      e.target = null;
      e.vehicle = null;   // detach()
      return true;
    }
    return false;
  };

  /** `ShulkerEntity.tryAttachOrTeleport` — re-attach in place if any face still works, else
   *  teleport away. */
  Sh.tryAttachOrTeleport = function (e, rand) {
    var bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
    var dir = Sh.findAttachSide(bx, by, bz, e);
    if (dir >= 0) { e.shulkerFace = dir; return; }
    Sh.tryTeleport(e, rand);
  };

  /** ShulkerEntity sounds (hostile category): ambient only while open (playAmbientSound override),
   *  hurt = isClosed ? hurt_closed : hurt, death. Pitch is LivingEntity.getSoundPitch. */
  Sh.SOUNDS = { ambient: 'entity.shulker.ambient', hurt: 'entity.shulker.hurt', hurtClosed: 'entity.shulker.hurt_closed', death: 'entity.shulker.death' };
  Sh.playSound = function (e, kind, rnd) {
    if (!NS.Sound || !NS.Sound.play) return false;
    var r = rnd || RNDFB;
    if (kind === 'ambient' && !(e.shulkerPeek > 0)) return false;
    if (kind === 'hurt' && !(e.shulkerPeek > 0)) kind = 'hurtClosed';
    var ev = Sh.SOUNDS[kind];
    if (!ev || e.silent) return false;
    return NS.Sound.play(ev, { x: e.x, y: e.y, z: e.z, source: 'hostile', pitch: (r() - r()) * 0.2 + 1 });
  };
  /** MobEntity.tick ambient roll: nextInt(1000) < ambientSoundChance++, then reset to -80. */
  Sh.tickAmbient = function (e, rnd) {
    var r = rnd || RNDFB;
    if (e.ambientChance === undefined) e.ambientChance = 0;
    if (Math.floor(r() * 1000) < e.ambientChance++) {
      e.ambientChance = -80;
      Sh.playSound(e, 'ambient', r);
    }
  };

  /** priority 0, flags 0 (never blocked, never blocking) — vanilla's own `tick()`-level
   *  `!canStay() -> tryAttachOrTeleport()`, ported as the "always running" goal shape this
   *  engine's GoalSelector supports (see file header). */
  function StayAttachedGoal(e, ctx) {
    var rand = (ctx && ctx.random) || RNDFB;
    this.canUse = function () { return true; };
    this.canContinueToUse = this.canUse;
    this.start = function () {};
    this.stop = function () {};
    this.tick = function () {
      // `getVelocity()`/`setVelocity()` are permanently zero in vanilla (never a real physics
      // body); this engine has no per-entity override for those two methods, so the nearest
      // available lever is the `e.noGravity` gate `Ph.travelMob` now honors (14b_physics.js) —
      // set once and left alone, since nothing else here ever gives a shulker a velocity to zero.
      if (!e.noGravity) e.noGravity = true;
      e.vx = e.vy = e.vz = 0;   // `setVelocity` is a no-op in vanilla: nothing can ever give it motion
      Sh.tickAmbient(e, rand);   // MobEntity.tick rolls it regardless of vehicle
      if (e.vehicle) return;
      if (e.shulkerFace === undefined) e.shulkerFace = Sh.DOWN;
      var bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
      if (!Sh.canStay(bx, by, bz, e.shulkerFace, e)) Sh.tryAttachOrTeleport(e, rand);
    };
  }

  /** `ShulkerEntity.PeekGoal` (priority 7) — open the lid a crack every so often while nothing
   *  is targeting it, `e.shulkerPeek` in [0,100] the way `PEEK_AMOUNT` tracks it in vanilla. */
  Sh.PEEK_INTERVAL = 40;   // `random.nextInt(toGoalTicks(40)) == 0`
  /** `ShulkerEntity.COVERED_ARMOR_BONUS` — ARMOR +20 while the lid is shut (peek 0). */
  Sh.COVERED_ARMOR_BONUS = 20;
  Sh.armorOf = function (e) { return e.shulkerArmorMod ? Sh.COVERED_ARMOR_BONUS : 0; };
  /** `ShulkerEntity.setPeekAmount` — the +20 modifier is (re)added ONLY here, by a call with 0, and removed by any
   *  other amount (`e.shulkerArmorMod`); a fresh spawn / tryTeleport write peek directly. Close plays
   *  SHULKER_CLOSE + CONTAINER_CLOSE, any other amount SHULKER_OPEN + CONTAINER_OPEN. */
  Sh.setPeek = function (e, amount) {
    e.shulkerPeek = amount;
    e.shulkerArmorMod = amount === 0;
    var close = amount === 0;
    if (NS.Sound && NS.Sound.play) NS.Sound.play(close ? 'entity.shulker.close' : 'entity.shulker.open', { x: e.x, y: e.y, z: e.z, source: 'hostile' });
    var ge = close ? 'container_close' : 'container_open';
    e.lastGameEvent = ge;
    if (NS.GameEvents && NS.GameEvents.emit) NS.GameEvents.emit(ge, e.x, e.y, e.z, e);
  };
  function PeekGoal(e, ctx) {
    var rand = (ctx && ctx.random) || RNDFB;
    var counter = 0;
    this.canUse = function () {
      if (e.target) return false;
      if (rand() >= 1 / Sh.PEEK_INTERVAL) return false;
      var bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
      var face = e.shulkerFace === undefined ? Sh.DOWN : e.shulkerFace;
      return Sh.canStay(bx, by, bz, face, e);
    };
    this.canContinueToUse = function () { return !e.target && counter > 0; };
    this.start = function () {
      counter = 20 * (1 + Math.floor(rand() * 3));   // `20 * (1 + nextInt(3))`
      Sh.setPeek(e, 30);
    };
    this.stop = function () { if (!e.target) Sh.setPeek(e, 0); };
    this.tick = function () { counter--; };
  }
  Sh.PeekGoal = PeekGoal;

  // ═══════════════════════════ THE ATTACK: ShootBulletGoal + targeting ═══════════════════════
  // `ShulkerEntity.ShootBulletGoal`/`TargetPlayerGoal` (.decomp, both read whole, ll.594-741) —
  // the slice `confident-lamport-hlerdd`'s own findings file named item (1), left for its own
  // scoped pass. `TargetOtherTeamGoal` (targetSelector priority 3, `ActiveTargetGoal<LivingEntity>`
  // vs `Monster`) is NOT ported: it refuses outright unless the shulker has a scoreboard TEAM
  // (`canStart`: `getScoreboardTeam() == null -> false`), and this engine has no scoreboard-team
  // concept at all (G26, QUEUE row 13, still unbuilt) — vacuous for every naturally-spawned
  // shulker in real vanilla too, since nothing ever assigns one a team without a command/datapack.
  // Named on `Sh.OWED`, not silently dropped.
  Sh.SHOOT_RANGE_SQ = 400.0;   // ShootBulletGoal.tick: squaredDistanceTo(target) < 400.0 (20 blocks)

  /** `ShulkerEntity.TargetPlayerGoal` — `ActiveTargetGoal<PlayerEntity>(this, PlayerEntity.class,
   *  true)`: 3-arg ctor defaults `reciprocalChance=10` (this file's own header, `Ai.RevengeGoal`'s
   *  neighbour `Gh.TargetGoal` (07zzi_ghast.js) already collapses that exact toGoalTicks(10)-based
   *  roll to a flat 1-in-10-per-tick check, reused here), `checkVisibility=true` (`Ai.canSee`),
   *  `mustReach=false`. `getSearchBox` is overridden to a thin face-relative box, but
   *  `ActiveTargetGoal.findClosestTarget` ignores it for PlayerEntity (#4795): a pure followRange
   *  sphere from the shulker's EYE (feet + 0.5) via `world.getClosestPlayer`. Difficulty (`Difficulty.PEACEFUL -> false`) is NOT re-checked
   *  here: `Ai.canTargetLiving`/`Ai.dropUntargetable` (07k_goals.js) already refuse a player
   *  target on peaceful for every goal in this engine, the one shared gate every other roster's
   *  own target goals already rely on instead of a per-goal difficulty check. */
  Sh.TargetPlayerGoal = function (e, ctx) {
    var rand = (ctx && ctx.random) || RNDFB;
    var players = (ctx && ctx.players) || function () { return []; };
    var unseen = 0;
    this.canUse = function () {
      var D = NS.Diff;
      if (D && D.isPeaceful && D.isPeaceful()) return false;   // canStart: difficulty != PEACEFUL
      if (Math.floor(rand() * 10) !== 0) return false;   // reciprocalChance 10, collapsed
      var fr = Ai_followRange(e);
      var best = null, bestD = Infinity;
      var ps = players();
      for (var i = 0; i < ps.length; i++) {
        var p = ps[i], d = Math.hypot(p.x - e.x, p.y - (e.y + 0.5), p.z - e.z);   // getClosestPlayer(.., eyeY)
        if (d <= fr && d < bestD && NS.Ai.canSee(e, p)) { best = p; bestD = d; }
      }
      if (best) { e.target = best; unseen = 0; return true; }
      return false;
    };
    // TrackTargetGoal.shouldContinue: out of followRange, or unseen for > 60 ticks, ends it.
    this.canContinueToUse = function () {
      var t = e.target;
      if (!t || !NS.Ai.canTargetLiving(t)) return false;
      var fr = Ai_followRange(e);
      if (Math.hypot(t.x - e.x, t.y - e.y, t.z - e.z) > fr) return false;
      if (NS.Ai.canSee(e, t)) unseen = 0;
      else if (++unseen > 60) return false;
      return true;
    };
    this.start = function () { unseen = 0; };
    this.stop = function () { e.target = null; };
    this.tick = function () {};
  };
  /** `ShulkerEntity.TargetOtherTeamGoal` (targetSelector 3): `canStart` is `getScoreboardTeam() != null
   *  && super.canStart()`. A team-less (every natural) shulker never starts it, as in vanilla. */
  Sh.TargetOtherTeamGoal = function (e, ctx) {
    var SB = NS.Scoreboard;
    this.canUse = function () {
      if (!SB || !SB.entityTeam(e)) return false;
      if (e.target && !e.target.dead) return false;
      var list = (ctx && ctx.entities) ? ctx.entities() : [], fr = Ai_followRange(e), best = null, bd = Infinity;
      for (var i = 0; i < list.length; i++) {
        var o = list[i];   // ActiveTargetGoal<LivingEntity> vs Monster
        if (o === e || !o || o.dead || o.removed || !NS.Spawn || NS.Spawn.categoryOf(o.type) !== 'monster') continue;
        if (SB.isTeammate(e, o)) continue;
        var d = Math.hypot(o.x - e.x, o.y - e.y, o.z - e.z);
        if (d <= fr && d < bd && NS.Ai.canSee(e, o)) { best = o; bd = d; }
      }
      if (best) { e.target = best; return true; }
      return false;
    };
    this.canContinueToUse = function () {
      var t = e.target;
      return !!t && !t.dead && !t.removed && !(SB && SB.isTeammate(e, t)) &&
        Math.hypot(t.x - e.x, t.y - e.y, t.z - e.z) <= Ai_followRange(e);
    };
    this.start = function () {};
    this.stop = function () { e.target = null; };
    this.tick = function () {};
  };
  function Ai_followRange(e) { return NS.Ai && NS.Ai.followRangeOf ? NS.Ai.followRangeOf(e) : 16; }

  /** `ShulkerEntity.ShootBulletGoal` (.decomp:594-650, read whole): charge/cooldown counter,
   *  `setPeekAmount(100)` while active (the lid stays fully open through the whole charge+shoot
   *  cycle, `e.shulkerPeek` — the SAME field `PeekGoal` above already tracks for the renderer),
   *  a target that drifts past 20 blocks (`squaredDistanceTo >= 400`) is DROPPED outright
   *  (`setTarget(null)`) rather than just pausing the goal.
   *  CONTROLS: MOVE|LOOK as vanilla (#4451) - the priority-1 look goal interrupts it, which closes the lid. */
  Sh.ShootBulletGoal = function (e, ctx) {
    var rand = (ctx && ctx.random) || RNDFB;
    var counter = 0;
    function targetAlive() { return !!e.target && !e.target.dead && !e.target.removed; }
    function notPeaceful() { return !(NS.Diff && NS.Diff.isPeaceful && NS.Diff.isPeaceful()); }
    this.canUse = function () { return targetAlive() && notPeaceful(); };   // `difficulty != PEACEFUL`
    this.canContinueToUse = this.canUse;
    this.getCooldown = function () { return counter; };   // read by the lockstep trace (tools/referee/lockstep/zombielane.mjs)
    this.start = function () { counter = 20; Sh.setPeek(e, 100); };
    this.stop = function () { Sh.setPeek(e, 0); };
    this.tick = function () {
      counter--;
      var t = e.target;
      if (!t) return;
      if (!notPeaceful()) return;
      if (e.look) e.look.setLookAt(t.x, t.y + (t.eyeHeight || 0), t.z, Math.PI, Math.PI);   // lookAt(target, 180, 180)
      var dx = t.x - e.x, dy = t.y - e.y, dz = t.z - e.z;
      var distSq = dx * dx + dy * dy + dz * dz;
      if (distSq < Sh.SHOOT_RANGE_SQ) {
        if (counter <= 0) {
          counter = 20 + Math.floor(rand() * 10) * 10;   // `20 + nextInt(10) * 20 / 2`
          var EL = NS.EntityList;
          if (EL && EL.canSpawn('shulker_bullet')) {
            var bx = Math.floor(e.x) + 0.5, by = Math.floor(e.y) + 0.5, bz = Math.floor(e.z) + 0.5;
            EL.spawn('shulker_bullet', bx, by, bz, {
              shooter: e, target: t,
              axis: Sh.attachAxis(e.shulkerFace === undefined ? Sh.DOWN : e.shulkerFace)
            });
          }
          if (!e.silent && NS.Sound && NS.Sound.play) {
            NS.Sound.play('entity.shulker.shoot', { x: e.x, y: e.y, z: e.z, volume: 2.0, source: 'hostile', pitch: (rand() - rand()) * 0.2 + 1.0 });
          }
        }
      } else {
        e.target = null;
      }
    };
  };

  /** `Direction.Axis` of `e.shulkerFace` (Sh's own D,U,N,S,W,E index space, this file's header):
   *  down/up -> 'y', north/south -> 'z', west/east -> 'x' — `ShulkerBulletEntity`'s ctor arg
   *  (`getAttachedFace().getAxis()`), the axis the bullet's own first waypoint pick excludes. */
  Sh.attachAxis = function (face) {
    if (face === 0 || face === 1) return 'y';
    if (face === 2 || face === 3) return 'z';
    return 'x';
  };

  // ═════════════════════════════ THE BULLET: ShulkerBulletEntity ═════════════════════════════
  // `.decomp/net/minecraft/entity/projectile/ShulkerBulletEntity.java`, read whole. Registered
  // and dispatched the SAME way the ghast's fireball is (`07i_entitylist.js`'s own
  // `EL.motionFor('shulker_bullet') -> [0,1]`/init-table/tick-dispatch entries, this unit's own
  // addition there) — velocity is fully bespoke, the generic gravity/drag pair exists only so
  // `EL.canSpawn` is true, the same "exists only so canSpawn is true" shape `Gh.tickFireball`'s
  // own header already states. checkDespawn()'s peaceful-mode discard IS ported
  // (`Sh.tickBullet`, first lines; §10 of shulkerattackcheck). noClip IS ported:
  // the dispatch (07i_entitylist.js) skips the generic mover and `Sh.tickBullet` raycasts then setPositions.
  Sh.BULLET_GRAVITY = 0.04;      // tick()'s own no-target fallback (.decomp:207) -- the SAME
                                  // literal `tools/golden/entity-motion-1.18.2.tsv`'s own
                                  // `shulker_bullet` row measured, excluded from the packed
                                  // runtime motion table only because its OWN drag column is
                                  // empty (`pack-entities.mjs`'s "BOTH gravity AND drag" gate,
                                  // the same standing fireball/small_fireball already share) --
                                  // transcribed here with its own citation instead, not re-typed
                                  // from nothing.
  Sh.BULLET_STEP_LEN = 0.15;     // method_7486's own literal (.decomp:178-180)
  Sh.BULLET_BLEND = 0.2;         // tick()'s own velocity += (target - v) * 0.2 (.decomp:214)
  Sh.BULLET_STEP_GROWTH = 1.025; // tick()'s own targetX *= 1.025, clamped to [-1,1] (.decomp:210-212)
  Sh.BULLET_HIT_DAMAGE = 4.0;    // onEntityHit (.decomp:280)
  Sh.BULLET_LEVITATION_TICKS = 200;   // StatusEffectInstance(LEVITATION, 200) (.decomp:284)

  Sh.initBullet = function (e, opts) {
    opts = opts || {};
    e.shooter = opts.shooter || null;
    e.bulletTarget = opts.target || null;
    if (opts.mobNbtRestore) return;   // #3033: Dir/Steps/TXD.. already copied from the save record; no re-plan
    e.bulletDir = null;
    e.bulletStepX = 0; e.bulletStepY = 0; e.bulletStepZ = 0;
    Sh.replanBullet(e, opts.axis);
  };

  function isAirAt(x, y, z) {
    var W = NS.World;
    return !!(W && W.getBlock && W.getBlock(x, y, z) === 0);
  }
  function isTopSolidAt(x, y, z) {
    var W = NS.World, SR = NS.States;
    if (!W || !W.getBlock) return false;
    var st = W.getBlock(x, y, z);
    return st !== 0 && !!(SR && SR.faceSturdy && SR.faceSturdy(st, 2, SR.SUPPORT_FULL));
  }
  function randomDir6(rand) { return Math.floor(rand() * 6); }

  /** `ShulkerBulletEntity.method_7486` (.decomp:113-185, read whole) — recompute the bullet's
   *  own waypoint: aim at the live target's own anchor point (mid-body height) if further than 2
   *  blocks away, else step one block in a direction that (a) is not the axis the shulker fired
   *  along and (b) leads toward the target and opens on air — falling back to a uniformly random
   *  open direction when no such directed candidate exists. A dead/removed/no target aims at the
   *  cell one below the bullet's own current position (vanilla's own `getBlockPos().down()`),
   *  matching `tick()`'s separate real-gravity fallback for the same "no target" case. */
  Sh.replanBullet = function (e, excludeAxis) {
    var rand = (NS.EntityList && NS.EntityList.random) || RNDFB;
    var t = e.bulletTarget;
    var alive = t && !t.dead && !t.removed;
    var half, anchorX, anchorY, anchorZ;
    if (!alive) {
      half = 0.5;
      anchorX = Math.floor(e.x); anchorY = Math.floor(e.y) - 1; anchorZ = Math.floor(e.z);
    } else {
      half = (t.height !== undefined ? t.height : 1.8) * 0.5;
      anchorX = Math.floor(t.x); anchorY = Math.floor(t.y + half); anchorZ = Math.floor(t.z);
    }
    var ax = anchorX + 0.5, ay = anchorY + half, az = anchorZ + 0.5;
    var chosenDir = null;
    // `$2.isWithinDistance(getPos(), 2.0)` measures from the anchor BLOCK's centre (y + 0.5), strict < 4,
    // not from the aim point (y + half) used for the straight-homing vector below.
    var cx = anchorX + 0.5 - e.x, cy = anchorY + 0.5 - e.y, cz = anchorZ + 0.5 - e.z;
    var farAway = !(cx * cx + cy * cy + cz * cz < 4.0);
    if (farAway) {
      var bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
      var candidates = [];
      if (excludeAxis !== 'x') {
        if (bx < anchorX && isAirAt(bx + 1, by, bz)) candidates.push(5);        // EAST
        else if (bx > anchorX && isAirAt(bx - 1, by, bz)) candidates.push(4);  // WEST
      }
      if (excludeAxis !== 'y') {
        if (by < anchorY && isAirAt(bx, by + 1, bz)) candidates.push(1);       // UP
        else if (by > anchorY && isAirAt(bx, by - 1, bz)) candidates.push(0);  // DOWN
      }
      if (excludeAxis !== 'z') {
        if (bz < anchorZ && isAirAt(bx, by, bz + 1)) candidates.push(3);       // SOUTH
        else if (bz > anchorZ && isAirAt(bx, by, bz - 1)) candidates.push(2);  // NORTH
      }
      chosenDir = randomDir6(rand);
      if (candidates.length === 0) {
        for (var tries = 5; tries > 0 && !isAirAt(bx + Sh.DX[chosenDir], by + Sh.DY[chosenDir], bz + Sh.DZ[chosenDir]); tries--) {
          chosenDir = randomDir6(rand);
        }
      } else {
        chosenDir = candidates[Math.floor(rand() * candidates.length)];
      }
      ax = e.x + Sh.DX[chosenDir]; ay = e.y + Sh.DY[chosenDir]; az = e.z + Sh.DZ[chosenDir];
    }
    e.bulletDir = chosenDir;
    var dx = ax - e.x, dy = ay - e.y, dz = az - e.z;
    var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len === 0) { e.bulletStepX = 0; e.bulletStepY = 0; e.bulletStepZ = 0; }
    else {
      e.bulletStepX = dx / len * Sh.BULLET_STEP_LEN;
      e.bulletStepY = dy / len * Sh.BULLET_STEP_LEN;
      e.bulletStepZ = dz / len * Sh.BULLET_STEP_LEN;
    }
    e.bulletSteps = 10 + Math.floor(rand() * 5) * 10;   // `10 + nextInt(5) * 10` (.decomp:184)
  };

  function clamp1(v) { return v < -1 ? -1 : (v > 1 ? 1 : v); }

  /** `ShulkerBulletEntity.tick()` (.decomp:194-252, read whole). Dispatched from `EL.tickOne`
   *  (07i_entitylist.js) AFTER this tick's generic move already ran — the same "velocity computed
   *  for NEXT tick" order `Gh.tickFireball`/`Bl.Fireball.tickSmall` already use, not vanilla's own
   *  (move-uses-this-tick's-blend) order; named on `Sh.OWED` as the same one-tick-lag class of
   *  simplification, not re-solved here (no referee test has flagged it as observable, unlike the
   *  arrow's own KW-34 case). Entity-hit is an AABB "within" overlap test against the segment's
   *  END point, the same simplification `Cb.tickSnowball`/`entityHitAt` (07zzh_blaze.js) already
   *  stand on — this bullet is slow (0.15 blocks/tick base speed) enough that tunnelling a whole
   *  hitbox in one tick is not a practical concern the way it is for an arrow. */
  Sh.BULLET_PARTICLE_SPREAD = 0.2;
  /** `ServerWorld.spawnParticles(type, x, y, z, count, 0.2, 0.2, 0.2, 0)`: each particle is offset by
   *  gaussian * spread on every axis, speed 0. Returns the spawned positions (for the check). */
  Sh.bulletParticles = function (e, type, count) {
    var r = (NS.EntityList && NS.EntityList.random) || RNDFB, out = [];
    var g = function () { return (r() + r() + r() + r() + r() + r() - 3) * 0.7071; };   // ~N(0,1)
    for (var i = 0; i < count; i++) {
      var px = e.x + g() * Sh.BULLET_PARTICLE_SPREAD, py = e.y + g() * Sh.BULLET_PARTICLE_SPREAD, pz = e.z + g() * Sh.BULLET_PARTICLE_SPREAD;
      out.push({ type: type, x: px, y: py, z: pz });
      if (NS.Particle && NS.Particle.spawn) NS.Particle.spawn(type, px, py, pz, 0, 0, 0, r);
    }
    Sh.lastBulletParticles = out;
    return out;
  };

  /** `ShulkerBulletEntity.damage`: sound entity.shulker_bullet.hurt + 15 'crit' (spread 0.2) + discard; true. */
  Sh.damageBullet = function (e) {
    if (e.removed) return true;
    if (NS.Sound && NS.Sound.play) NS.Sound.play('entity.shulker_bullet.hurt', { x: e.x, y: e.y, z: e.z, source: 'hostile' });
    Sh.bulletParticles(e, 'crit', 15);
    e.removed = true;
    return true;
  };

  Sh.tickBullet = function (e) {
    if (e.removed) return;
    if (NS.Diff && NS.Diff.isPeaceful && NS.Diff.isPeaceful()) { e.removed = true; return; }   // #3035 checkDespawn
    var t = e.bulletTarget;
    var targetGone = !t || t.dead || t.removed || (t.type === 'player' && NS.Gamemode && NS.Gamemode.isSpectator && NS.Gamemode.isSpectator(t));
    if (targetGone) {
      e.vy -= Sh.BULLET_GRAVITY;
    } else {
      e.bulletStepX = clamp1(e.bulletStepX * Sh.BULLET_STEP_GROWTH);
      e.bulletStepY = clamp1(e.bulletStepY * Sh.BULLET_STEP_GROWTH);
      e.bulletStepZ = clamp1(e.bulletStepZ * Sh.BULLET_STEP_GROWTH);
      e.vx += (e.bulletStepX - e.vx) * Sh.BULLET_BLEND;
      e.vy += (e.bulletStepY - e.vy) * Sh.BULLET_BLEND;
      e.vz += (e.bulletStepZ - e.vz) * Sh.BULLET_BLEND;
    }
    // ProjectileUtil.getCollision (noClip: no Entity.move): block raycast along the velocity, replaced by a
    // nearer entity hit (boxes inflated 0.3), THEN setPosition(pos + v) below.
    var Cb = NS.Combat, ox = e.x, oy = e.y, oz = e.z, vx = e.vx, vy = e.vy, vz = e.vz;
    var bh = Cb && Cb.arrowRaycast ? Cb.arrowRaycast(ox, oy, oz, vx, vy, vz) : null;
    var f = bh ? bh.f : 1, hitEnt = null;
    var targets = [], list = NS.EntityList && NS.EntityList.list;
    if (NS.Player && e.shooter !== NS.Player) targets.push(NS.Player);
    if (list) for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o === e || o.removed || o === e.shooter || o.noClip) continue;
      // #3035 ProjectileEntity.canHit: any collidable entity (boats, minecarts, other bullets, crystals)
      if (o.maxHealth === undefined && !/boat|minecart|^shulker_bullet$|^end_crystal$/.test(o.type || '')) continue;
      targets.push(o);
    }
    if (Cb && Cb.rayBox) for (var j = 0; j < targets.length; j++) {
      var o2 = targets[j], IN = Cb.ARROW_ENTITY_INFLATE;
      if (o2.dead || o2.removed) continue;
      var ow = o2.width !== undefined ? o2.width : 0.6, oh = o2.height !== undefined ? o2.height : 1.8;
      var ct = Cb.rayBox(ox, oy, oz, vx * f, vy * f, vz * f, o2.x - ow / 2 - IN, o2.y - IN, o2.z - ow / 2 - IN,
                         o2.x + ow / 2 + IN, o2.y + oh + IN, o2.z + ow / 2 + IN);
      if (ct === null || ct > 1) continue;
      f *= ct; hitEnt = o2;
    }
    if (hitEnt) {
      var hit;
      if (hitEnt === NS.Player) { hit = NS.Survival && NS.Survival.hurt ? NS.Survival.hurt(hitEnt, 'mob_projectile', Sh.BULLET_HIT_DAMAGE, e.shooter || undefined) : false; }
      else if (/minecart/.test(hitEnt.type || '') && NS.Minecart && NS.Minecart.damage) { hit = NS.Minecart.damage(hitEnt, Sh.BULLET_HIT_DAMAGE, {}); }
      else if (hitEnt.maxHealth === undefined && hitEnt.type !== 'shulker_bullet' && hitEnt.type !== 'end_crystal') { hit = false; }   // ponytail: boat damage has no entry point yet
      else { hit = Cb && Cb.hurt ? Cb.hurt(hitEnt, Sh.BULLET_HIT_DAMAGE, undefined, false, { attacker: e.shooter || null, projectile: true, sourceEntity: e }) : false; }
      if (hit && hitEnt.maxHealth !== undefined && NS.Effects) {
        // applyDamageEffects(owner, target) = thorns on the victim; levitation's cause is firstNonNull(owner, bullet)
        if (e.shooter && NS.Effects.thornsOnUserDamaged) NS.Effects.thornsOnUserDamaged(hitEnt, e.shooter);
        if (NS.Effects.addStatusEffect) NS.Effects.addStatusEffect(hitEnt, 'levitation', Sh.BULLET_LEVITATION_TICKS, 0, false, true, true, e.shooter || e);
      }
      e.removed = true;
      return;
    }
    if (bh) {
      if (NS.Sound && NS.Sound.play) NS.Sound.play('entity.shulker_bullet.hit', { x: e.x, y: e.y, z: e.z, source: 'hostile' });
      Sh.bulletParticles(e, 'explosion', 2);
      e.removed = true;
      return;
    }
    e.x = ox + vx; e.y = oy + vy; e.z = oz + vz;
    // client tick: addParticle(end_rod, x - vx, y - vy + 0.15, z - vz, 0, 0, 0) every tick = the pre-move position
    Sh.lastBulletTrail = { type: 'end_rod', x: ox, y: oy + 0.15, z: oz };
    if (NS.Particle && NS.Particle.spawn) NS.Particle.spawn('end_rod', ox, oy + 0.15, oz, 0, 0, 0, (NS.EntityList && NS.EntityList.random) || RNDFB);
    // ── waypoint replan (.decomp:229-250, read whole): the stepCount countdown and the
    // blocked/aligned check are TWO SEPARATE tests, both run every tick the target is alive —
    // not an if/else — so a replan from one can be immediately followed by the other's own check
    // against the FRESH direction, exactly as vanilla's own two back-to-back `if` blocks read. ──
    if (t && !t.removed) {   // vanilla gates on target != null && !target.isRemoved(): a dead-but-unremoved target still replans
      if (e.bulletSteps > 0) {
        e.bulletSteps--;
        if (e.bulletSteps === 0) {
          Sh.replanBullet(e, e.bulletDir === null || e.bulletDir === undefined ? undefined : Sh.attachAxis(e.bulletDir));
        }
      }
      if (e.bulletDir !== null && e.bulletDir !== undefined) {
        var d = e.bulletDir;
        var bx2 = Math.floor(e.x), by2 = Math.floor(e.y), bz2 = Math.floor(e.z);
        var nx = bx2 + Sh.DX[d], ny = by2 + Sh.DY[d], nz = bz2 + Sh.DZ[d];
        if (isTopSolidAt(nx, ny, nz)) {   // world.isTopSolid(pos.offset(dir)), not 'not air'
          Sh.replanBullet(e, Sh.attachAxis(d));
        } else {
          var axis = Sh.attachAxis(d);
          var tb = axis === 'x' ? Math.floor(t.x) : (axis === 'z' ? Math.floor(t.z) : Math.floor(t.y));
          var self = axis === 'x' ? bx2 : (axis === 'z' ? bz2 : by2);
          if (self === tb) Sh.replanBullet(e, axis);
        }
      }
    }
  };

  // ═════════════════ #657: BOUNDING BOX, moveEntities, collidable, colour, duplication ═════════════
  // `ShulkerEntity.calculateBoundingBox`/`getExtraLength`/`moveEntities`/`isCollidable`/
  // `pushAwayFrom`/`getTargetingMargin`/`ShulkerLookControl`/`getColor`/`spawnNewShulker`
  // (.decomp ShulkerEntity.java:196-263, 440-460, 532-541, 662-690; Box.stretch/shrink).

  /** `getExtraLength(openProgress)` — how far the lid pokes out of the 1x1x1 cube. */
  Sh.extraLength = function (open) { return 0.5 - Math.sin((0.5 + open) * Math.PI) * 0.5; };

  /** `calculateBoundingBox(dir, lo, hi)` as [minx,miny,minz,maxx,maxy,maxz] relative to the cell
   *  origin: the unit cube stretched by `hi` along `dir`, its near end shrunk by `1 + lo`. */
  Sh.boxAlong = function (dir, lo, hi) {
    var top = Math.max(lo, hi), bot = Math.min(lo, hi);
    var b = [0, 0, 0, 1, 1, 1], v = [Sh.DX[dir], Sh.DY[dir], Sh.DZ[dir]];
    for (var a = 0; a < 3; a++) {
      var st = v[a] * top, sh = -v[a] * (1 + bot);
      if (st < 0) b[a] += st; else if (st > 0) b[a + 3] += st;      // Box.stretch
      if (sh < 0) b[a] -= sh; else if (sh > 0) b[a + 3] -= sh;      // Box.shrink
    }
    return b;
  };

  /** The shulker's own hitbox, absolute: opens AWAY from the attached face (`getOpposite`). */
  Sh.boundingBox = function (e) {
    var face = e.shulkerFace === undefined ? Sh.DOWN : e.shulkerFace;
    var b = Sh.boxAlong(Sh.OPPOSITE[face], -1, Sh.extraLength(e.shulkerOpen || 0));
    var ox = e.x - 0.5, oz = e.z - 0.5;
    return [b[0] + ox, b[1] + e.y, b[2] + oz, b[3] + ox, b[4] + e.y, b[5] + oz];
  };

  /** `isCollidable()` = `isAlive()`: the hitbox is solid to players and mobs. */
  Sh.isCollidable = function (e) { return !e.dead && !e.removed; };
  /** `getTargetingMargin()` */
  Sh.TARGETING_MARGIN = 0.0;

  /** `moveEntities()`: while the lid is opening, whatever stands in the swept slab is carried
   *  along the opening direction by the growth in extra length (`MovementType.SHULKER`). */
  Sh.moveEntities = function (e) {
    var open = e.shulkerOpen || 0, prev = e.shulkerOpenO === undefined ? open : e.shulkerOpenO;
    var d1 = Sh.extraLength(open), d0 = Sh.extraLength(prev), delta = d1 - d0;
    if (!(delta > 0)) return 0;
    var face = e.shulkerFace === undefined ? Sh.DOWN : e.shulkerFace, dir = Sh.OPPOSITE[face];
    var b = Sh.boxAlong(dir, d0, d1), ox = e.x - 0.5, oz = e.z - 0.5;
    var EL = NS.EntityList, Ph = NS.Physics, n = 0;
    var list = (EL && EL.list ? EL.list.slice() : []);
    if (NS.Player && list.indexOf(NS.Player) < 0) list.push(NS.Player);
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o === e || o.removed || o.type === 'shulker' || o.noClip || o.noclip) continue;
      if (o.vehicle === e || e.vehicle === o) continue;
      if (NS.Gamemode && NS.Gamemode.isSpectator && o === NS.Player && NS.Gamemode.isSpectator(o)) continue;
      var hw = (o.width !== undefined ? o.width : 0.6) / 2, oh = o.height || 1.8;
      if (o.x - hw >= b[3] + ox || o.x + hw <= b[0] + ox || o.y >= b[4] + e.y || o.y + oh <= b[1] + e.y ||
          o.z - hw >= b[5] + oz || o.z + hw <= b[2] + oz) continue;
      if (Ph && Ph.move) Ph.move(o, delta * Sh.DX[dir], delta * Sh.DY[dir], delta * Sh.DZ[dir]);
      else { o.x += delta * Sh.DX[dir]; o.y += delta * Sh.DY[dir]; o.z += delta * Sh.DZ[dir]; }
      n++;
    }
    return n;
  };

  // -- COLOR: data byte 0..15 dye id, 16 = the undyed default; `getColor()` is null for that.
  Sh.DEFAULT_COLOR = 16;
  Sh.getColor = function (e) {
    var c = e.shulkerColor === undefined ? Sh.DEFAULT_COLOR : e.shulkerColor;
    return (c !== 16 && c <= 15) ? c : null;
  };
  /** ShulkerEntityRenderer.getTexture: null colour -> the base sheet, else COLORED_TEXTURES[colour]
   *  (mob atlas family: `shulker`, `shulker#1`..`shulker#16`). */
  Sh.skinKey = function (e) {
    if (!e || e.type !== 'shulker') return null;
    var c = Sh.getColor(e);
    return c === null ? null : 'shulker#' + (c + 1);
  };
  Sh.setColor = function (e, c) { e.shulkerColor = c; };
  /** `readCustomDataFromNbt`'s Color: only a numeric tag replaces the default. */
  Sh.readColorNbt = function (e, nbt) {
    if (nbt && typeof nbt.Color === 'number') e.shulkerColor = nbt.Color | 0;
  };
  /** `readCustomDataFromNbt`: AttachFace/Peek are getByte (absent = 0), Direction.byId wraps mod 6. */
  Sh.readNbt = function (e, nbt) {
    e.shulkerFace = Math.abs((nbt.AttachFace << 24 >> 24) % 6);
    e.shulkerPeek = nbt.Peek << 24 >> 24;
    Sh.readColorNbt(e, nbt);
  };
  Sh.writeColorNbt = function (e, nbt) {
    nbt.Color = e.shulkerColor === undefined ? Sh.DEFAULT_COLOR : e.shulkerColor;
  };

  // -- spawnNewShulker (.decomp:440-460)
  Sh.isClosed = function (e) { return !(e.shulkerPeek > 0); };
  Sh.spawnNewShulker = function (e, rand) {
    rand = rand || (NS.EntityList && NS.EntityList.random) || RNDFB;
    var ox = e.x, oy = e.y, oz = e.z, box = Sh.boundingBox(e);
    if (Sh.isClosed(e) || !Sh.tryTeleport(e, rand)) return null;
    var EL = NS.EntityList, n = 0;
    for (var i = 0; i < (EL.list || []).length; i++) {
      var o = EL.list[i];
      if (o.type !== 'shulker' || o.dead || o.removed) continue;
      var ob = Sh.boundingBox(o);   // Box.intersects(box.expand(8)): strict on every axis
      if (ob[0] < box[3] + 8 && ob[3] > box[0] - 8 && ob[1] < box[4] + 8 && ob[4] > box[1] - 8 &&
          ob[2] < box[5] + 8 && ob[5] > box[2] - 8) n++;
    }
    if (rand() < (n - 1) / 5) return null;
    var s = EL.spawn('shulker', ox, oy, oz);
    if (s && Sh.getColor(e) !== null) Sh.setColor(s, e.shulkerColor);
    return s;
  };

  /** `ShulkerLookControl`: yaw relative to the attached face, pitch 0, no head-yaw clamp. Reuses
   *  `SD.faceMatrix` (the rotation of the face's opposite) for `SOUTH_VECTOR.rotate(quat)`. */
  Sh.targetYawDeg = function (e, x, y, z) {
    var SD = NS.ShulkerDraw;
    var face = e.shulkerFace === undefined ? Sh.DOWN : e.shulkerFace, od = Sh.OPPOSITE[face];
    var m = SD.faceMatrix(face);
    var s = [m[2], m[5], m[8]], v = [Sh.DX[od], Sh.DY[od], Sh.DZ[od]];
    var c = [v[1] * s[2] - v[2] * s[1], v[2] * s[0] - v[0] * s[2], v[0] * s[1] - v[1] * s[0]];
    var dx = x - e.x, dy = y - (e.y + (e.eyeHeight || 0)), dz = z - e.z;
    var a = c[0] * dx + c[1] * dy + c[2] * dz, b = s[0] * dx + s[1] * dy + s[2] * dz;
    if (!(Math.abs(a) > 1.0E-5) && !(Math.abs(b) > 1.0E-5)) return null;
    return Math.atan2(-a, b) * 180 / Math.PI;
  };
  Sh.LookControl = function (e) {
    var base = new NS.Ai.LookControl(e), self = this;
    this.wanted = null; this.cooldown = 0; this.ySpeed = base.ySpeed;
    this.setLookAt = function (x, y, z, ySpeed) {
      self.wanted = { x: x, y: y, z: z };
      self.ySpeed = ySpeed === undefined ? NS.Ai.headRotSpeed(e) : ySpeed;
      self.cooldown = 2;
    };
    this.isLookingAtTarget = function () { return self.cooldown > 0; };
    this.tick = function () {
      var Ai = NS.Ai;
      e.xHeadRot = 0;    // getTargetPitch is always 0
      if (self.cooldown > 0 && self.wanted) {
        self.cooldown--;
        var deg = Sh.targetYawDeg(e, self.wanted.x, self.wanted.y, self.wanted.z);
        // engine yaw is vanilla's minus 180 (D-415)
        if (deg !== null) e.yHeadRot = Ai.rotateTowards(e.yHeadRot || 0, (deg - 180) * Math.PI / 180, self.ySpeed);
      } else {
        e.yHeadRot = Ai.rotateTowards(e.yHeadRot || 0, Ai.bodyYawOf(e), Ai.HEAD_ROT_SPEED);
      }
      // clampHeadYaw() is a no-op
    };
  };

  /** External-assignment shape, matching piglin/hoglin/blaze/ghast above rather than the
   *  central object literal in 07k_goals.js (D-773: never hand-write into that literal for a
   *  new mob — every recent addition registers itself here instead). */
  /** `LookAtEntityGoal(this, Player, 8F, 0.02F, true)`: 2% start roll, closest player by 3D distance
   *  from the eye (creative stays eligible: createNonAttackable), then a 40+nextInt(40) tick look. */
  Sh.LookAtPlayerGoal = function (e, getPlayers, range, rand) {
    rand = rand || RNDFB;
    var target = null, lookTime = 0;
    function dist(p) { return Math.hypot(p.x - e.x, p.y - (e.y + (e.eyeHeight || 0)), p.z - e.z); }
    this.canUse = function () {
      if (rand() >= 0.02) return false;
      var ps = getPlayers(), bd = Infinity;
      target = null;
      // LookAtEntityGoal.canStart: getClosestPlayer overwrites the mob target; range always applies
      for (var i = 0; i < ps.length; i++) { var d = dist(ps[i]); if (d <= range && d < bd) { target = ps[i]; bd = d; } }
      return !!target;
    };
    this.canContinueToUse = function () { return !!target && !target.dead && Math.hypot(target.x - e.x, target.y - e.y, target.z - e.z) <= range && lookTime > 0; };
    this.start = function () { lookTime = 40 + Math.floor(rand() * 40); };
    this.stop = function () { target = null; };
    this.tick = function () {
      if (!target || !e.look) return;
      e.look.setLookAt(target.x, e.y + (e.eyeHeight || 0), target.z);  // lookForward=true: the MOB's eye Y
      lookTime--;
    };
  };

  Sh.roster = function (e, ctx) {
    var Ai = NS.Ai;
    var gs = new Ai.GoalSelector();
    var players = (ctx && ctx.players) || function () { return []; };
    gs.add(0, 0, new StayAttachedGoal(e, ctx));
    gs.add(1, Ai.LOOK, new Sh.LookAtPlayerGoal(e, players, 8.0, ctx && ctx.random));
    gs.add(4, Ai.MOVE | Ai.LOOK, new Sh.ShootBulletGoal(e, ctx));
    gs.add(7, 0, new Sh.PeekGoal(e, ctx));
    gs.add(8, Ai.MOVE | Ai.LOOK, new Ai.RandomLookAroundGoal(e, ctx && ctx.random));
    // ── TARGET, at `initGoals`'s own priority numbers (1:RevengeGoal.group, 2:TargetPlayerGoal;
    // 3:TargetOtherTeamGoal not ported, see this file's own header above `Sh.SHOOT_RANGE_SQ`) ──
    gs.add(1, Ai.TARGET, new Ai.RevengeGoal(e, ctx, { group: true }));
    gs.add(2, Ai.TARGET, new Sh.TargetPlayerGoal(e, ctx));
    gs.add(3, Ai.TARGET, new Sh.TargetOtherTeamGoal(e, ctx));
    return gs;
  };

  Sh.OWED = [
    'TargetOtherTeamGoal (targetSelector 3) -- needs scoreboard TEAMS, which this engine does not ' +
      'have (G26, QUEUE row 13); vacuous in real vanilla too for a natural shulker with no team'
  ];

  Sh.init = function () {
    var Ai = NS.Ai;
    if (Ai && Ai.ROSTER) Ai.ROSTER.shulker = Sh.roster;
    Sh.ready = !!(NS.World && NS.States && Ai);
  };
  Sh.init();
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
