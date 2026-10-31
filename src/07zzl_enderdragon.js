// src/07zzl_enderdragon.js — D-773 cloud unit (confident-lamport-1851se): the ender dragon's
// registry-level identity, the one piece of it that is genuinely independent of everything else
// the mob still owes (EnderDragon.OWED, below).
//
// .decomp read whole: net/minecraft/entity/boss/dragon/EnderDragonEntity.java,
// net/minecraft/entity/boss/dragon/EnderDragonPart.java,
// net/minecraft/entity/boss/dragon/phase/PhaseType.java.
//
// -- WHY THIS IS NOT "motion substrate + canSpawn gate" THE SAME SHAPE OTHER SLICES HAVE BEEN --
// Every mob this engine has closed so far either fits the plain `[gravity, drag]` pair
// `EL.motionFor` already models, or replaces it with a `flyMove` controller that writes
// vx/vy/vz once a tick (vex/phantom/bee) — both are a single hitbox and a handful of lines.
// `EnderDragonEntity.tickMovement()` is neither: it never calls `travel()` or subtracts a
// gravity constant on any branch. Its motion is `PhaseManager.getCurrent().serverTick()`
// picking a `getPathTarget()` through an A* search over the entity's own `pathNodes`/
// `pathHeap` (`PathMinHeap`, its own class), then a hand-written vertical-acceleration-toward-
// target blend (`vy += clamp(dy/dist, -maxYAccel, maxYAccel) * 0.01`, horizontal drag
// `(0.8 + 0.15*dot)*0.91`) that only exists once one of `PhaseType`'s own 11 phases is driving
// it. There is no single gate to flip here the way an ordinary ground mob's is — a genuine
// `canSpawn` needs the phase manager, the path search, and `EnderDragonFight`'s own portal/
// crystal state built first, comparable in size to several full mob-units on its own. Named on
// `EnderDragon.OWED` below rather than faked with a `[0, 1]` that would make it "spawnable" and
// then never move, which `EL.canSpawn` promising a mob that never leaves the ground would be a
// worse lie than refusing it.
//
// -- WHAT THIS FILE BUILDS INSTEAD -----------------------------------------------------------
// A dragon is not one hitbox but EIGHT (`EnderDragonPart extends Entity`, its own
// `EntityDimensions` fixed once at construction, `collides()` always true, `damage()` routed to
// `owner.damagePart`) — ported verbatim from `EnderDragonEntity`'s own constructor call sites:
//   head(1x1) neck(3x3) body(5x3) tail1(2x2) tail2(2x2) tail3(2x2) rightWing(4x2) leftWing(4x2)
// Real, checkable data that whichever slice builds combat's per-part damage routing, the
// renderer's per-part mesh, or the eventual motion substrate's own `movePart` calls will need
// regardless of the order those land in — the same "loot tables before AI" shape G18d closed
// before G18b for every ground mob.
(function (NS) {
  'use strict';
  var ED = NS.EnderDragon = { ready: false };

  /**
   * `EnderDragonEntity`'s own 8 `EnderDragonPart`s, in the SAME order its constructor builds
   * them (also `this.parts`'s own array order, read by `tickMovement`'s per-part loop).
   */
  ED.PARTS = [
    { name: 'head',  width: 1.0, height: 1.0 },
    { name: 'neck',  width: 3.0, height: 3.0 },
    { name: 'body',  width: 5.0, height: 3.0 },
    { name: 'tail',  width: 2.0, height: 2.0 }, // tail1
    { name: 'tail',  width: 2.0, height: 2.0 }, // tail2
    { name: 'tail',  width: 2.0, height: 2.0 }, // tail3
    { name: 'wing',  width: 4.0, height: 2.0 }, // rightWing
    { name: 'wing',  width: 4.0, height: 2.0 }  // leftWing
  ];

  /** `PhaseType.java`'s own 11 phases, `getTypeId()` order — named, none of them built yet. */
  ED.PHASE_NAMES = [
    'HoldingPattern', 'StrafePlayer', 'LandingApproach', 'Landing', 'Takeoff',
    'SittingFlaming', 'SittingScanning', 'SittingAttacking', 'ChargingPlayer', 'Dying', 'Hover'
  ];

  // The stream behind every unseeded dragon/fight RNG: the entity list's injected EL.random (lockstep lanes, #5379) when set, else the clock.
  ED.seedNow = function () { var EL = (typeof NS !== 'undefined') && NS.EntityList; return EL && EL.random ? Math.floor(EL.random() * 4294967296) : Date.now(); };
  ED.OWED = [
    'canSpawn / EL.motionFor -- ED.PhaseManager + ED.HoldingPatternPhase (below) drive the ' +
      'dragon around the ED.buildPathNodes ring exactly as tickInRange()/followPath() do in ' +
      'vanilla, and ED.EnderDragonEntity.prototype.tickMovement (below) now ports the real ' +
      'motion blend UNDER that: vy += clamp(dy/horizDist, -maxYAccel, maxYAccel) * 0.01 (skipped ' +
      'when horizDist is 0, per .decomp\'s own $$17>0.0 guard, not "clamp(dy/dist, ...)" -- last ' +
      'session\'s own paraphrase of this formula was wrong about which distance the clamp ' +
      'divides by), the yaw-acceleration steering (*0.8 decay + angleErr*getYawAcceleration(), ' +
      'clamped to +/-50deg), the forward-thrust updateVelocity(0.06*(...), (0,0,-1)) call, and ' +
      'the FINAL unconditional velocity multiply by (0.8 + 0.15*(velDir.dot(lookDir)+1)/2, 0.91, ' +
      'same) -- all reading getCurrent().getPathTarget()/getMaxYAcceleration()/' +
      'getYawAcceleration() every tick, verbatim off EnderDragonEntity.java\'s own tickMovement() ' +
      '(server, non-dead branch). NOW WIRED (loop/enderdragon-wiring): ED.initEntity/ED.tickEntity ' +
      '(bottom of this file) bridge this tickMovement() onto a REAL spawned entity -- ' +
      'EL.motionFor(\'ender_dragon\') (src/07i_entitylist.js) returns [0, 1] so EL.canSpawn is ' +
      'true and EL.spawn(\'ender_dragon\', ...) (e.g. via /summon) returns a live one, ' +
      'EL.DEFAULTS.ender_dragon attaches the rig at spawn seeded straight into HoldingPattern ' +
      '(no EnderDragonFight to hand it a real starting phase, ED.OWED\'s next item, still fully ' +
      'absent), and EL.tickMob\'s own mobTick slot calls ED.tickEntity(e) every tick, the SAME ' +
      'slot Wi.tickMovement already occupies for the wither -- a /summoned dragon now actually ' +
      'flies the HoldingPattern ring and reacts to every ported phase transition. Still NOT ' +
      'built by this wiring: EnderDragonFight itself (crystal ring, portal generation, exit- ' +
      'portal placement, natural End-dimension spawn placement -- ED.OWED\'s next item, ' +
      'unchanged) and the 8-part hitbox\'s own per-part collision/targeting (the dragon still ' +
      'moves and collides as EL\'s ordinary single 16x8 bounding box, like every other mob -- ' +
      'ED.EnderDragonPart routing into a real hit-test is ED.OWED\'s per-part-damage item, ' +
      'below, unchanged by this pass).',
    'EnderDragonFight -- the portal/crystal/first-spawn cutscene state EnderDragonEntity\'s own ' +
      'ctor reads off ServerWorld.getEnderDragonFight() -- an End-dimension system, not part of ' +
      'the mob entity itself; ED.EnderDragonEntity.getFight() above accepts a caller-supplied ' +
      'stand-in ({getAliveEndCrystals}) rather than depend on it. NOW BUILT (this pass, ' +
      'loop/enderdragonfight-substrate): ED.EnderDragonFight (below) is a real fight-state class ' +
      '-- ED.buildCrystalRing\'s verbatim EndSpikeFeature.SpikeCache 10-crystal-ring formula, ' +
      'ED.computeExitPortalLocation\'s real getTopPosition/descend-past-bedrock search, and the ' +
      'full real EnderDragonSpawnState timer sequence (respawnDragon()\'s real 3-guard gate and ' +
      '4-direction crystal gather, every state\'s real tick thresholds, createDragon()\'s real ' +
      '(0,128,0)/random-yaw/HoldingPattern spawn) -- World/block/explosion/BossBar/NBT/chunk-' +
      'ticket machinery is caller-supplied opts stand-ins throughout, never invented. Still NOT ' +
      'built: the true first-ever natural spawn on a brand-new world (depends on a worldgen ' +
      'feature not among the files read for this slice, and this engine has no End dimension for ' +
      'it to place a dragon into regardless) -- named, not guessed, ED.OWED unchanged on that one ' +
      'point. NOW WIRED (loop/enderdragonfight-wiring): ED.initEntity attaches a real ' +
      'ED.EnderDragonFight (opts.fight, or a fresh one built from the same opts bag) to every ' +
      'spawned dragon, with a real .dragon back-reference so ' +
      'ED.EnderDragonFight.prototype.crystalDestroyed\'s own else-branch reaches a live dragon ' +
      '(ED.EnderDragonEntity.prototype.crystalDestroyed, new, runs the real player-pick and ' +
      'phase.crystalDestroyed() dispatch). NOW BUILT (loop/endcrystal-entity): a real ' +
      '`end_crystal` entity exists (07zzn_endcrystal.js, NS.EndCrystal) -- registered in ' +
      'EL (motion [0,1], the SAME stationary sentinel area_effect_cloud uses), invulnerable- ' +
      'to-the-dragon-that-owns-it/one-hit-destroyed by everything else (EndCrystalEntity.' +
      'damage(), verbatim), and its own explosion (power 6, DESTROY, skipped when the killing ' +
      'source was itself explosive -- no double-explosion) genuinely calls ' +
      '`ED.getActiveFight().crystalDestroyed(crystal, source)`, reaching this SAME dispatch ' +
      'for real. Explosion damage (creeper/TNT/another crystal) is a real, wired trigger ' +
      '(src/07za_explosion.js\'s own damageEntities now damages end_crystal instead of ' +
      'skipping every non-living type). Still ED.OWED: a player melee/arrow hit on a crystal ' +
      'stays inside 14j_combat.js\'s own hit-dispatch, not touched this pass (owned ' +
      'elsewhere); respawnDragon()\'s own 4-crystal placement-near-portal gather ' +
      '(opts.crystalsNear) and the true chunk-based natural first spawn remain unbuilt. CLOSED (D-838, this pass): a fight NOW spawns real, live end_crystal entities at every ED.buildCrystalRing position the moment a fight object is built (ED.EnderDragonFight.prototype._spawnCrystalRing, below) -- the one real call site .decomp\'s own EndSpikeFeature.generateSpike() would otherwise leave permanently unreachable through real play, not just a manually-placed test crystal.',
    'per-part damage routing is now real (EnderDragonPart.damage -> owner.damagePart, ' +
      'ED.EnderDragonEntity.prototype.damagePart, ported off EnderDragonEntity.damagePart() -- ' +
      'the non-head amount/4+min(amount,1) reduction, the sitting-damage-threshold->Takeoff and ' +
      'death->Dying phase switches all included) but Combat still has no concept of a multi-' +
      'part target -- nothing calls EnderDragonPart.damage() from a real hit-test yet, and this ' +
      'port\'s own parentDamage()/isDead() are a bare health subtract, not LivingEntity\'s ' +
      'invulnerability-frame/armor/absorption pipeline',
    'the death loot/experience drop -- the renderer/model (EnderDragonEntityRenderer, the ' +
      '8-part animated mesh) itself already landed (D-793, src/07j_entityrender.js ER.dragonDelta)',
    'the spawn egg -- permanent absence in vanilla too (no SpawnEggItem registration for ' +
      'ender_dragon in .decomp/net/minecraft/item/Items.java), already named on Use.OWED ' +
      '(src/14l_use.js), not a residue of this slice',
    'DyingPhase itself is ' +
      'real (D-804) -- setHealth(1)/setHealth(0) off the same [100,22500] distSq-to-portal-' +
      'origin band HoldingPatternPhase already reads, ED.DyingPhase below -- the death-effects ' +
      'branch (XP orb + loot drop, ticksSinceDeath) stays a separate ED.OWED item ("the death ' +
      'loot/experience drop", above). LandingApproachPhase and TakeoffPhase were made real in ' +
      'an earlier pass: both ported verbatim off .decomp\'s own LandingApproachPhase.java/' +
      'TakeoffPhase.java, plus the four ED.EnderDragonEntity methods they (and .decomp\'s own ' +
      'LandingPhase/SittingFlamingPhase) depend on -- getRotationVectorFromPhase()/getPitch()/' +
      'setPitch()/getRotationVec(). THIS pass (ED.OWED item 3 / QUEUE 0.00 part 2, ED.OWED-3) ' +
      'made LandingPhase, SittingFlamingPhase, SittingAttackingPhase, ChargingPlayerPhase and ' +
      'AbstractSittingPhase\'s own arrow-immunity modifyDamageTaken real too, all ported off ' +
      '.decomp verbatim: LandingPhase (target = heightAt(0,0)+1 top-of-portal, hands off to ' +
      'SittingFlaming/SittingScanning once within 1.0 block); SittingAttackingPhase (40-tick ' +
      'timer back to SittingFlaming); ChargingPlayerPhase (null-target abort, 10-tick charge ' +
      'timer, the [100,22500] distSq/collision gate, both back to HoldingPattern); ' +
      'AbstractSittingPhase.modifyDamageTaken (arrow hits take 0 damage and light the dragon ' +
      'for 1s -- this engine has no PersistentProjectileEntity type to instanceof-check, so ' +
      'this ports off the SAME `source.source === \'projectile\'` DamageSource-shape flag ' +
      '14j_combat.js already uses for every other mob\'s arrow-specific gating (shulker/' +
      'enderman phasing, 14j_combat.js:419/435) rather than invent a new one; setOnFireFor(1) ' +
      'itself is not ported -- no fire-ticks substrate on this isolated dragon rig, named ' +
      'here rather than guessed). SittingFlamingPhase\'s OWN tick-10 dragon-breath-cloud spawn ' +
      '(new AreaEffectCloudEntity, World.isAir/spawnEntity) is NOT ported -- this isolated ' +
      'ED.EnderDragonEntity rig has no `world` at all (opts.heightAt/opts.players/opts.fight ' +
      'stand-ins in its place, ctor comment above), so there is nothing to spawn an entity ' +
      'into; the SAME kind of gap StrafePlayerPhase\'s own fireball ATTACK sub-behavior is ' +
      'already named on here rather than invented. SittingFlamingPhase\'s duration timer/' +
      'timesRun-gated Takeoff-vs-SittingScanning handoff and its own reset() are otherwise ' +
      'verbatim. SittingScanningPhase itself is now ported (see ED.SittingScanningPhase); formerly unported (still resolves to a bare ' +
      'ED.AbstractPhase): its own serverTick() steers yaw off `this.dragon.head.getX()/getZ()` ' +
      '-- this engine\'s ED.EnderDragonPart (above) tracks no x/y/z of its own at all (per-' +
      'part positions are multi-part hit-testing/motion-substrate territory, explicitly out ' +
      'of scope for this pass) -- and its own two TargetPredicates (20-block CLOSE_PLAYER_' +
      'PREDICATE with a |dy|<=10 filter, 150-block PLAYER_WITHIN_RANGE_PREDICATE) need real ' +
      'distance-capped/visibility-scoped closest-player queries ED.EnderDragonEntity.' +
      'getClosestPlayer (above) does not do (it is unbounded, canTarget-filtered only) -- ' +
      'inventing either shape here is exactly the guessed substrate this project refuses, so ' +
      'SittingScanningPhase is named precisely and left for a future pass',
    'StrafePlayerPhase\'s own real serverTick()/beginPhase()/setTargetEntity() -- the circling-' +
      'around-target flight pattern (path retarget off the target\'s own x/y+leadHeight/z, ' +
      'updatePath()/followPath() verbatim, setTargetEntity()\'s own A* call with an extraTarget ' +
      'node planted near the target) -- is now ported, and HoldingPatternPhase.tickInRange()\'s ' +
      'own closest-player strafe roll now actually rolls a HoldingPattern dragon with a nearby ' +
      'player into StrafePlayer via setTargetEntity, exactly like crystalDestroyed()\'s own ' +
      'strafePlayer() call already did (ED.EnderDragonEntity.getClosestPlayer -- a caller-' +
      'supplied opts.players/opts.heightAt stand-in for World.getClosestPlayer/getTopPosition, ' +
      'the SAME "accept a stand-in rather than depend on World" shape opts.fight above already ' +
      'uses). Still unported (still ED.OWED): StrafePlayerPhase\'s own target-in-sight fireball ' +
      'ATTACK sub-behavior -- seenTargetTimes accumulation, the yaw/dot-product aim-angle test, ' +
      'DragonFireballEntity spawn, World.canSee/syncWorldEvent -- since none of ' +
      'DragonFireballEntity, a world line-of-sight query, or world event sync exist in this ' +
      'engine yet and inventing a stand-in for any of the three would be exactly the "guessed" ' +
      'shape this project refuses; a StrafePlayer dragon here flies the real circling pattern ' +
      'around its target forever and never fires, reverting to HoldingPattern only through the ' +
      'same null-target guard vanilla itself falls back to'
  ];


  // -- PATHFINDING RING (this slice: G18/QUEUE 0.00 part 2) -----------------------------------
  // `EnderDragonEntity.getNearestPathNodeIndex()`'s own 24-node ring plus `findPath()`'s own A*
  // (net/minecraft/entity/ai/pathing/{PathNode,PathMinHeap}.java) -- ported near-verbatim. This
  // is the one piece of "the motion substrate" (ED.OWED's item 1, above) that has NO dependency
  // on EnderDragonFight, Combat, or the tick loop: `HoldingPatternPhase.tickInRange()`
  // (.decomp phase/HoldingPatternPhase.java) is the one and only caller a future PhaseManager
  // slice will need, and everything it calls (`dragon.getNearestPathNodeIndex()`,
  // `dragon.findPath(a, b, null)`) is built here, tested, so that slice becomes "wire this in"
  // rather than "port an A* from scratch mid-session".

  /** `PathNode.java`, the fields this port actually reads (no NBT/network round-trip, no
   * `type`/`penalty` -- vanilla never sets those on the dragon's own 24-node graph, only on
   * ground mobs' `PathNodeMaker` output). */
  ED.PathNode = function (x, y, z) {
    this.x = x; this.y = y; this.z = z;
    this.heapIndex = -1;
    this.penalizedPathLength = 0;
    this.distanceToNearestTarget = 0;
    this.heapWeight = 0;
    this.previous = null;
    this.visited = false;
  };
  ED.PathNode.prototype.getDistance = function (o) {
    var dx = o.x - this.x, dy = o.y - this.y, dz = o.z - this.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };
  ED.PathNode.prototype.getSquaredDistance = function (o) {
    var dx = o.x - this.x, dy = o.y - this.y, dz = o.z - this.z;
    return dx * dx + dy * dy + dz * dz;
  };
  ED.PathNode.prototype.isInHeap = function () { return this.heapIndex >= 0; };

  /** `PathMinHeap.java`, verbatim: a binary min-heap keyed on `heapWeight`, with `heapIndex`
   * cached on each node so `setNodeWeight` can re-sift without a linear scan -- the SAME trick
   * the real class uses. Ported line-for-line (not reimplemented against a generic heap lib)
   * because a from-scratch heap can silently diverge on tie order, and `findPath` below depends
   * on that exact pop order for a repeatable result. */
  ED.PathMinHeap = function () { this.nodes = []; };
  ED.PathMinHeap.prototype.push = function (n) {
    if (n.heapIndex >= 0) throw new Error('OW KNOWS!');
    this.nodes.push(n);
    n.heapIndex = this.nodes.length - 1;
    this._up(n.heapIndex);
    return n;
  };
  ED.PathMinHeap.prototype.clear = function () { this.nodes.length = 0; };
  ED.PathMinHeap.prototype.pop = function () {
    var a = this.nodes, n = a[0], last = a.pop();
    if (a.length > 0) { a[0] = last; this._down(0); }
    n.heapIndex = -1;
    return n;
  };
  ED.PathMinHeap.prototype.setNodeWeight = function (n, w) {
    var old = n.heapWeight;
    n.heapWeight = w;
    if (w < old) this._up(n.heapIndex); else this._down(n.heapIndex);
  };
  ED.PathMinHeap.prototype.isEmpty = function () { return this.nodes.length === 0; };
  ED.PathMinHeap.prototype._up = function (i) {
    var a = this.nodes, n = a[i], w = n.heapWeight;
    while (i > 0) {
      var p = (i - 1) >> 1, pn = a[p];
      if (!(w < pn.heapWeight)) break;
      a[i] = pn; pn.heapIndex = i; i = p;
    }
    a[i] = n; n.heapIndex = i;
  };
  ED.PathMinHeap.prototype._down = function (i) {
    var a = this.nodes, n = a[i], w = n.heapWeight;
    for (;;) {
      var l = 1 + (i << 1), r = l + 1;
      if (l >= a.length) break;
      var ln = a[l], lw = ln.heapWeight, rn, rw;
      if (r >= a.length) { rn = null; rw = Infinity; } else { rn = a[r]; rw = rn.heapWeight; }
      if (lw < rw) {
        if (!(lw < w)) break;
        a[i] = ln; ln.heapIndex = i; i = l;
      } else {
        if (!(rw < w)) break;
        a[i] = rn; rn.heapIndex = i; i = r;
      }
    }
    a[i] = n; n.heapIndex = i;
  };

  /** `EnderDragonEntity`'s own 24 `pathNodeConnections` bitmasks (int per node; bit `j` set
   * means node i connects to node j) -- lifted verbatim off the decompiled constants rather
   * than recomputed, since they encode a specific hand-tuned ring topology (12 outer + 8 middle
   * + 4 inner) a formula would risk getting subtly wrong. */
  ED.NODE_CONNECTIONS = [
    6146, 8197, 8202, 16404, 32808, 32848, 65696, 131392, 131712, 263424, 526848, 525313,
    1581057, 3166214, 2138120, 6373424, 4358208, 12910976, 9044480, 9706496, 15216640,
    13688832, 11763712, 8257536
  ];

  /**
   * `getNearestPathNodeIndex()`'s own ring-building half (the `pathNodes[0] == null` branch):
   * 24 nodes around the End's portal origin (`EndPortalFeature.ORIGIN` = `BlockPos.ORIGIN` =
   * (0,0,0); `World.getSeaLevel()` is hardcoded 63 for every dimension in `World.java`'s own
   * override -- checked, NOT an End-specific value guessed here) -- 12 on a r=60 ring
   * (y = topY+5), 8 on r=40 (y = topY+15), 4 on r=20 (y = topY+5).
   * `heightAt(x, z)` is caller-supplied so this is testable without a live World; this engine's
   * own `W.heightAt` returns the surface BLOCK (see `07s_raid.js`'s own `heightAt` convention
   * comment), so callers pass `+1` inside to match vanilla's `getTopPosition(...).getY()`, the
   * first position ABOVE that block.
   */
  ED.buildPathNodes = function (heightAt) {
    var SEA = 63, nodes = new Array(24);
    for (var i = 0; i < 24; i++) {
      var r, ang, extra;
      if (i < 12) { r = 60; ang = 2 * (-Math.PI + (Math.PI / 12) * i); extra = 5; }
      else if (i < 20) { r = 40; ang = 2 * (-Math.PI + (Math.PI / 8) * (i - 12)); extra = 15; }
      else { r = 20; ang = 2 * (-Math.PI + (Math.PI / 4) * (i - 20)); extra = 5; }
      var x = Math.floor(r * Math.cos(ang));
      var z = Math.floor(r * Math.sin(ang));
      var topY = heightAt(x, z) + 1;
      var y = Math.max(SEA + 10, topY + extra);
      nodes[i] = new ED.PathNode(x, y, z);
    }
    return nodes;
  };

  /** `getNearestPathNodeIndex(x, y, z)` -- vanilla: `$$6 = (fight == null || fight
   * .getAliveEndCrystals() == 0) ? 12 : 0`, i.e. with NO live `EnderDragonFight` (this port:
   * `aliveCrystals` left `null`/`undefined`) OR a fight with zero crystals left, the outer ring
   * (indices 0-11) is skipped -- only pass a positive `aliveCrystals` to search the full ring. */
  ED.getNearestPathNodeIndex = function (nodes, x, y, z, aliveCrystals) {
    var target = new ED.PathNode(Math.floor(x), Math.floor(y), Math.floor(z));
    var from = (aliveCrystals == null || aliveCrystals === 0) ? 12 : 0;
    var best = 1e10, bestI = from;
    for (var i = from; i < 24; i++) {
      var d = nodes[i].getSquaredDistance(target);
      if (d < best) { best = d; bestI = i; }
    }
    return bestI;
  };

  /** `findPath(a, b, extraTarget)` -- A* over the `NODE_CONNECTIONS` bitmask graph,
   * `PathMinHeap`-ordered, verbatim including its own "closest node reached" fallback when the
   * target is unreachable (vanilla's `$$7`/best-so-far tracking, logged there, silent here).
   * `extraTarget` (an `ED.PathNode`, e.g. the dragon's own player target) is optional, matching
   * `findPath`'s own nullable third argument -- appended after the ring node it is closest to
   * via `.previous`, exactly like `EnderDragonEntity.findPath`'s own `$$2` param.
   * Returns the ordered `PathNode` array from `nodes[fromIdx]` to the goal (or the closest
   * reachable node), or `null` only when no node beyond the start was ever reachable. */
  ED.findPath = function (nodes, fromIdx, toIdx, aliveCrystals, extraTarget) {
    for (var i = 0; i < 24; i++) {
      var n = nodes[i];
      n.visited = false; n.heapWeight = 0; n.penalizedPathLength = 0;
      n.distanceToNearestTarget = 0; n.previous = null; n.heapIndex = -1;
    }
    var start = nodes[fromIdx], goal = nodes[toIdx];
    start.penalizedPathLength = 0;
    start.distanceToNearestTarget = start.getDistance(goal);
    start.heapWeight = start.distanceToNearestTarget;
    var heap = new ED.PathMinHeap();
    heap.push(start);
    var closest = start;
    var from = (aliveCrystals == null || aliveCrystals === 0) ? 12 : 0;
    while (!heap.isEmpty()) {
      var cur = heap.pop();
      if (cur === goal) {
        if (extraTarget) { extraTarget.previous = goal; goal = extraTarget; }
        return ED._walkBack(start, goal);
      }
      if (cur.getDistance(goal) < closest.getDistance(goal)) closest = cur;
      cur.visited = true;
      var curIdx = nodes.indexOf(cur);
      var mask = ED.NODE_CONNECTIONS[curIdx];
      for (var j = from; j < 24; j++) {
        if ((mask & (1 << j)) === 0) continue;
        var nb = nodes[j];
        if (nb.visited) continue;
        var len = cur.penalizedPathLength + cur.getDistance(nb);
        if (!nb.isInHeap() || len < nb.penalizedPathLength) {
          nb.previous = cur;
          nb.penalizedPathLength = len;
          nb.distanceToNearestTarget = nb.getDistance(goal);
          if (nb.isInHeap()) heap.setNodeWeight(nb, nb.penalizedPathLength + nb.distanceToNearestTarget);
          else { nb.heapWeight = nb.penalizedPathLength + nb.distanceToNearestTarget; heap.push(nb); }
        }
      }
    }
    if (closest === start) return null;
    if (extraTarget) { extraTarget.previous = closest; closest = extraTarget; }
    return ED._walkBack(start, closest);
  };

  ED._walkBack = function (start, end) {
    var out = [end], n = end;
    while (n.previous) { n = n.previous; out.unshift(n); }
    return out;
  };


  // -- PHASE MANAGER + PHASE-TYPE SKELETON (this slice: G18 leftover, QUEUE 0.00 part 2) -----
  // `PhaseManager.java` + `PhaseType.java` + `AbstractPhase.java` ported near-verbatim; only
  // `HoldingPatternPhase.java` (.decomp phase/HoldingPatternPhase.java) is given its REAL
  // `serverTick()`/`tickInRange()`/`followPath()` body -- exactly the one caller ED.OWED (above)
  // said the path ring + A* search were built for. The other 10 phases are named, correctly
  // typed (`getType()`, `isSittingOrHovering()`) and switch-to-able through ED.PhaseManager, but
  // their OWN `serverTick()`/`beginPhase()` bodies are still ED.AbstractPhase's own no-op
  // defaults -- every one of them named individually on ED.OWED above (rule 5/D-139: a phase
  // that LOOKS wired must not silently no-op, so "not built" is written out per phase rather
  // than left to be discovered).

  /** `PhaseType.java`'s own registration order == `ED.PHASE_NAMES`'s index (both id 0-10,
   * `getTypeId()`). `isSittingOrHovering` mirrors the one thing `damagePart` (below) needs off
   * a phase without a live instance -- `grep isSittingOrHovering .decomp/net/minecraft/entity/
   * boss/dragon/phase/*.java` shows only `AbstractSittingPhase` (SittingFlaming/SittingScanning/
   * SittingAttacking extend it) and `HoverPhase` override it to true; everything else (including
   * HoldingPattern) is `AbstractPhase`'s own `false`. */
  var SITTING_OR_HOVERING = {
    SittingFlaming: true, SittingScanning: true, SittingAttacking: true, Hover: true
  };
  ED.PHASE_TYPES = ED.PHASE_NAMES.map(function (name, id) {
    return { id: id, name: name, isSittingOrHovering: !!SITTING_OR_HOVERING[name] };
  });
  ED.PHASE_TYPES.byName = {};
  ED.PHASE_TYPES.forEach(function (t) { ED.PHASE_TYPES.byName[t.name] = t; });

  /** `AbstractPhase.java` -- every default a real `Phase` subclass inherits unless it overrides
   * it. `type` is one of `ED.PHASE_TYPES` (a plain data row, not a class -- there is no separate
   * "PhaseType instance" object here the way vanilla's generic `PhaseType<T>` is). */
  ED.AbstractPhase = function (dragon, type) { this.dragon = dragon; this.type = type; };
  ED.AbstractPhase.prototype.getType = function () { return this.type; };
  ED.AbstractPhase.prototype.isSittingOrHovering = function () { return this.type.isSittingOrHovering; };
  ED.AbstractPhase.prototype.clientTick = function () {};
  ED.AbstractPhase.prototype.serverTick = function () {};
  ED.AbstractPhase.prototype.crystalDestroyed = function () {};
  ED.AbstractPhase.prototype.beginPhase = function () {};
  ED.AbstractPhase.prototype.endPhase = function () {};
  ED.AbstractPhase.prototype.getMaxYAcceleration = function () { return 0.6; };
  ED.AbstractPhase.prototype.getPathTarget = function () { return null; };
  ED.AbstractPhase.prototype.modifyDamageTaken = function (source, amount) { return amount; };
  /** `AbstractPhase.getYawAcceleration()` verbatim: `0.7F / min(speed, 40) / speed`, `speed` =
   * `dragon.getVelocity().horizontalLength() + 1`. */
  ED.AbstractPhase.prototype.getYawAcceleration = function () {
    var speed = this.dragon.getHorizontalSpeed() + 1.0;
    var capped = Math.min(speed, 40.0);
    return 0.7 / capped / speed;
  };

  /** `PhaseManager.java` verbatim: one `Phase` instance per `PhaseType`, created lazily and
   * reused across `setPhase` calls (`this.phases[id] == null` guard), so a phase's own instance
   * state (HoldingPatternPhase's `path`/`pathTarget`) survives a round trip back to it.
   * Constructor default is Hover (`PhaseManager(EnderDragonEntity)`'s own
   * `this.setPhase(PhaseType.field_7075)`), NOT HoldingPattern -- a fresh dragon only reaches
   * HoldingPattern once something else (spawn/fight code, ED.OWED) calls `setPhase` again,
   * exactly as vanilla leaves it. */
  ED.PhaseManager = function (dragon) {
    this.dragon = dragon;
    this.phases = new Array(ED.PHASE_TYPES.length);
    this.current = null;
    this.setPhase(ED.PHASE_TYPES.byName.Hover);
  };
  ED.PhaseManager.prototype.getCurrent = function () { return this.current; };
  ED.PhaseManager.prototype.create = function (type) {
    if (!this.phases[type.id]) this.phases[type.id] = ED._makePhase(this.dragon, type);
    return this.phases[type.id];
  };
  ED.PhaseManager.prototype.setPhase = function (type) {
    if (!this.current || type !== this.current.getType()) {
      if (this.current) this.current.endPhase();
      this.current = this.create(type);
      this.current.beginPhase();
    }
  };
  /** `PhaseType.create(EnderDragonEntity)` -- the one phase with a real subclass gets it;
   * everything else is a plain `ED.AbstractPhase` carrying the right `type` (see ED.OWED). */
  ED._makePhase = function (dragon, type) {
    if (type.name === 'HoldingPattern') return new ED.HoldingPatternPhase(dragon);
    if (type.name === 'StrafePlayer') return new ED.StrafePlayerPhase(dragon);
    if (type.name === 'Dying') return new ED.DyingPhase(dragon);
    if (type.name === 'LandingApproach') return new ED.LandingApproachPhase(dragon);
    if (type.name === 'Takeoff') return new ED.TakeoffPhase(dragon);
    if (type.name === 'Landing') return new ED.LandingPhase(dragon);
    if (type.name === 'SittingFlaming') return new ED.SittingFlamingPhase(dragon);
    if (type.name === 'SittingAttacking') return new ED.SittingAttackingPhase(dragon);
    if (type.name === 'SittingScanning') return new ED.SittingScanningPhase(dragon);
    if (type.name === 'ChargingPlayer') return new ED.ChargingPlayerPhase(dragon);
    if (type.name === 'Hover') return new ED.HoverPhase(dragon);
    return new ED.AbstractPhase(dragon, type);
  };

  /** `HoverPhase.java`: remembers the dragon's position on its first tick and holds it. */
  ED.HoverPhase = function (dragon) {
    ED.AbstractPhase.call(this, dragon, ED.PHASE_TYPES.byName.Hover);
    this.target = null;
  };
  ED.HoverPhase.prototype = Object.create(ED.AbstractPhase.prototype);
  ED.HoverPhase.prototype.constructor = ED.HoverPhase;
  ED.HoverPhase.prototype.serverTick = function () {
    if (this.target == null) this.target = { x: this.dragon.getX(), y: this.dragon.getY(), z: this.dragon.getZ() };
  };
  ED.HoverPhase.prototype.isSittingOrHovering = function () { return true; };
  ED.HoverPhase.prototype.beginPhase = function () { this.target = null; };
  ED.HoverPhase.prototype.getMaxYAcceleration = function () { return 1.0; };
  ED.HoverPhase.prototype.getPathTarget = function () { return this.target; };

  /** Minimal `net.minecraft.entity.ai.pathing.Path` wrapper around the `ED.PathNode[]`
   * `ED.findPath` already returns -- just enough (`nodeIndex`) for
   * `HoldingPatternPhase.tickInRange()`/`followPath()` to walk it exactly like vanilla's own
   * `Path` does. Nothing else in `Path.java` (block-reach checks, NBT) applies to the dragon's
   * own ring-node use of it. */
  ED.Path = function (nodes) { this.nodes = nodes || []; this.nodeIndex = 0; };
  ED.Path.prototype.isFinished = function () { return this.nodeIndex >= this.nodes.length; };
  ED.Path.prototype.getCurrentNodePos = function () { return this.nodes[this.nodeIndex]; };
  ED.Path.prototype.next = function () { this.nodeIndex++; };

  /**
   * `HoldingPatternPhase.java` -- the one phase ED.OWED (above) said this slice would wire in.
   * Drives the dragon around the existing 24-node ring through `dragon.getNearestPathNodeIndex()`
   * / `dragon.findPath()` (both thin wraps a real `ED.EnderDragonEntity`, below, puts over
   * `ED.getNearestPathNodeIndex`/`ED.findPath` -- exactly the "wire this in" the top-of-file
   * comment named).
   * NOT ported: `tickInRange()`'s own closest-player strafe roll (needs `world.getClosestPlayer`,
   * a live world query) -- named on ED.OWED. Everything else -- the LandingApproach roll, the
   * ring-index walk (outer/middle ring selection, `shouldFindNewPath`'s zig-zag), and
   * `followPath()`'s own random overshoot-in-Y -- is verbatim.
   */
  ED.HoldingPatternPhase = function (dragon) {
    ED.AbstractPhase.call(this, dragon, ED.PHASE_TYPES.byName.HoldingPattern);
    this.path = null;
    this.pathTarget = null;
    this.shouldFindNewPath = false;
  };
  ED.HoldingPatternPhase.prototype = Object.create(ED.AbstractPhase.prototype);
  ED.HoldingPatternPhase.prototype.constructor = ED.HoldingPatternPhase;

  ED.HoldingPatternPhase.prototype.beginPhase = function () {
    this.path = null;
    this.pathTarget = null;
  };
  ED.HoldingPatternPhase.prototype.getPathTarget = function () { return this.pathTarget; };

  ED.HoldingPatternPhase.prototype.serverTick = function () {
    var d = this.dragon;
    var distSq = this.pathTarget == null ? 0
      : sq(this.pathTarget.x - d.getX()) + sq(this.pathTarget.y - d.getY()) + sq(this.pathTarget.z - d.getZ());
    if (distSq < 100 || distSq > 22500 || d.horizontalCollision || d.verticalCollision) {
      this.tickInRange();
    }
  };

  ED.HoldingPatternPhase.prototype.tickInRange = function () {
    var d = this.dragon;
    if (this.path && this.path.isFinished()) {
      var fight = d.getFight();
      var aliveCrystals = fight ? fight.getAliveEndCrystals() : 0;
      if (d.getRandom().nextInt(aliveCrystals + 3) === 0) {
        d.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.LandingApproach);
        return;
      }
      // `world.getClosestPlayer(PLAYERS_IN_RANGE_PREDICATE, dragon, topX, topY, topZ)` verbatim,
      // centered on the End portal origin's own top-of-world position (ED.EnderDragonEntity's
      // opts.heightAt stand-in), NOT the dragon's own position -- checked against .decomp, not
      // guessed. `$$2` (the distance-based roll input) starts at 64 and is only recomputed off
      // an actual closest player when one exists.
      var topY = d.heightAt(0, 0) + 1;
      var roll = 64;
      var closest = d.getClosestPlayer(0, topY, 0);
      if (closest) {
        roll = (sq(0 - closest.x) + sq(topY - closest.y) + sq(0 - closest.z)) / 512;
      }
      if (closest && (d.getRandom().nextInt(Math.abs(Math.trunc(roll)) + 2) === 0 ||
          d.getRandom().nextInt(aliveCrystals + 2) === 0)) {
        this.strafePlayer(closest);
        return;
      }
    }
    if (!this.path || this.path.isFinished()) {
      var from = d.getNearestPathNodeIndex();
      var to = from;
      if (d.getRandom().nextInt(8) === 0) {
        this.shouldFindNewPath = !this.shouldFindNewPath;
        to = from + 6;
      }
      to += this.shouldFindNewPath ? 1 : -1;
      var fight2 = d.getFight();
      if (fight2 && fight2.getAliveEndCrystals() >= 0) {
        to = to % 12;
        if (to < 0) to += 12;
      } else {
        to -= 12;
        to &= 7;
        to += 12;
      }
      this.path = d.findPath(from, to, null);
      if (this.path) this.path.next();
    }
    this.followPath();
  };

  ED.HoldingPatternPhase.prototype.followPath = function () {
    if (this.path && !this.path.isFinished()) {
      var node = this.path.getCurrentNodePos();
      this.path.next();
      var d = this.dragon;
      var y;
      do { y = node.y + d.getRandom().nextFloat() * 20; } while (y < node.y);
      this.pathTarget = { x: node.x, y: y, z: node.z };
    }
  };

  /** `HoldingPatternPhase.strafePlayer(PlayerEntity)` verbatim -- the one private helper both
   * `tickInRange()`'s own closest-player roll (above) and `crystalDestroyed()` (below) call. */
  ED.HoldingPatternPhase.prototype.strafePlayer = function (player) {
    var pm = this.dragon.getPhaseManager();
    pm.setPhase(ED.PHASE_TYPES.byName.StrafePlayer);
    pm.create(ED.PHASE_TYPES.byName.StrafePlayer).setTargetEntity(player);
  };

  ED.HoldingPatternPhase.prototype.crystalDestroyed = function (crystal, pos, source, player) {
    if (player && this.dragon.canTarget(player)) {
      this.strafePlayer(player);
    }
  };

  /**
   * `StrafePlayerPhase.java` -- this slice ports its own real `serverTick()`/`beginPhase()`/
   * `setTargetEntity()`, i.e. the circling-around-target FLIGHT pattern (ED.OWED, above, scopes
   * it exactly there): the path retarget-off-the-target logic, `updatePath()`/`followPath()`
   * (verbatim -- the SAME ring-shift arithmetic `HoldingPatternPhase.tickInRange()`'s own
   * `tickInRange`/`followPath` already use, just called unconditionally instead of gated behind
   * a "path just finished" check first), and `setTargetEntity()`'s own A* call FROM the dragon's
   * nearest ring node TO the node nearest the target, with an `extraTarget` PathNode planted
   * near the target's own x/y+leadHeight/z (the SAME lead-height formula `serverTick()`'s own
   * path-target recompute uses: `min(0.4 + horizDist/80 - 1, 10)`).
   * The target-in-sight fireball attack (#4342) fires via `dragon.world`; the 1017 world-event sound is not ported.
   */
  ED.StrafePlayerPhase = function (dragon) {
    ED.AbstractPhase.call(this, dragon, ED.PHASE_TYPES.byName.StrafePlayer);
    this.seenTargetTimes = 0;
    this.path = null;
    this.pathTarget = null;
    this.target = null;
    this.shouldFindNewPath = false;
  };
  ED.StrafePlayerPhase.prototype = Object.create(ED.AbstractPhase.prototype);
  ED.StrafePlayerPhase.prototype.constructor = ED.StrafePlayerPhase;

  ED.StrafePlayerPhase.prototype.beginPhase = function () {
    this.seenTargetTimes = 0;
    this.pathTarget = null;
    this.path = null;
    this.target = null;
  };

  ED.StrafePlayerPhase.prototype.getPathTarget = function () { return this.pathTarget; };

  ED.StrafePlayerPhase.prototype.serverTick = function () {
    var d = this.dragon;
    if (!this.target) {
      d.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.HoldingPattern);
      return;
    }
    if (this.path && this.path.isFinished()) {
      var dx = this.target.x - d.getX();
      var dz = this.target.z - d.getZ();
      var dist = Math.sqrt(dx * dx + dz * dz);
      var lead = Math.min(0.4 + dist / 80 - 1, 10);
      this.pathTarget = { x: this.target.x, y: this.target.y + lead, z: this.target.z };
    }
    var distSq = this.pathTarget == null ? 0
      : sq(this.pathTarget.x - d.getX()) + sq(this.pathTarget.y - d.getY()) + sq(this.pathTarget.z - d.getZ());
    if (distSq < 100 || distSq > 22500) {
      this.updatePath();
    }
    var t = this.target;
    if (sq(t.x - d.getX()) + sq(t.y - d.getY()) + sq(t.z - d.getZ()) < 4096.0 && d.world.canSee(d, t)) {
      this.seenTargetTimes++;
      var ex = t.x - d.getX(), ez = t.z - d.getZ(), el = Math.sqrt(ex * ex + ez * ez);
      var yr = d.getYaw() * DEG2RAD;
      // both vectors are horizontal, so dot(normalize(a), normalize(b)); zero-length normalizes to 0 like Vec3d
      var dot = el < 1.0E-4 ? 0 : (Math.sin(yr) * ex / el + (-Math.cos(yr)) * ez / el);
      var ang = Math.acos(dot) * 180.0 / Math.PI + 0.5;
      if (this.seenTargetTimes >= 5 && ang >= 0.0 && ang < 10.0) {
        var rv = d.getRotationVec(1.0);
        var fx = d.head.x - rv.x, fy = d.head.y + d.head.height * 0.5 + 0.5, fz = d.head.z - rv.z;
        // syncWorldEvent(null, 1017, dragon.getBlockPos(), 0): entity.ender_dragon.shoot
        if (NS.BlockEntities && NS.BlockEntities.dispenseEvent)
          NS.BlockEntities.dispenseEvent({ x: Math.floor(d.getX()), y: Math.floor(d.getY()), z: Math.floor(d.getZ()) }, 1017, 0);
        d.world.spawnEntity('dragon_fireball', fx, fy, fz, {
          shooter: d, power: [t.x - fx, t.y + (t.height !== undefined ? t.height : 1.8) * 0.5 - fy, t.z - fz]
        });
        this.seenTargetTimes = 0;
        while (this.path && !this.path.isFinished()) this.path.next();
        d.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.HoldingPattern);
      }
    } else if (this.seenTargetTimes > 0) {
      this.seenTargetTimes--;
    }
  };

  /** `StrafePlayerPhase.updatePath()` -- verbatim, the SAME ring-shift arithmetic
   * `HoldingPatternPhase.tickInRange()`'s own path-refresh half already uses. */
  ED.StrafePlayerPhase.prototype.updatePath = function () {
    var d = this.dragon;
    if (!this.path || this.path.isFinished()) {
      var from = d.getNearestPathNodeIndex();
      var to = from;
      if (d.getRandom().nextInt(8) === 0) {
        this.shouldFindNewPath = !this.shouldFindNewPath;
        to = from + 6;
      }
      to += this.shouldFindNewPath ? 1 : -1;
      var fight = d.getFight();
      if (fight && fight.getAliveEndCrystals() > 0) {
        to = to % 12;
        if (to < 0) to += 12;
      } else {
        to -= 12;
        to &= 7;
        to += 12;
      }
      this.path = d.findPath(from, to, null);
      if (this.path) this.path.next();
    }
    this.followPath();
  };

  /** `StrafePlayerPhase.followPath()` -- verbatim, identical to
   * `HoldingPatternPhase.followPath()` (both port the SAME `.decomp` method body). */
  ED.StrafePlayerPhase.prototype.followPath = function () {
    if (this.path && !this.path.isFinished()) {
      var node = this.path.getCurrentNodePos();
      this.path.next();
      var d = this.dragon;
      var y;
      do { y = node.y + d.getRandom().nextFloat() * 20; } while (y < node.y);
      this.pathTarget = { x: node.x, y: y, z: node.z };
    }
  };

  /** `StrafePlayerPhase.setTargetEntity(LivingEntity)` verbatim -- the A* call that actually
   * starts the circling flight: FROM the dragon's own nearest ring node TO the node nearest the
   * target, with an `extraTarget` PathNode planted near the target's own position (leadHeight
   * above it, matching `serverTick()`'s own recompute formula) so `ED.findPath`'s search biases
   * toward the target rather than just the ring. */
  ED.StrafePlayerPhase.prototype.setTargetEntity = function (target) {
    var d = this.dragon;
    this.target = target;
    var from = d.getNearestPathNodeIndex();
    var to = d.getNearestPathNodeIndex(target.x, target.y, target.z);
    var tx = Math.floor(target.x), tz = Math.floor(target.z);
    var dx = tx - d.getX(), dz = tz - d.getZ();
    var dist = Math.sqrt(dx * dx + dz * dz);
    var lead = Math.min(0.4 + dist / 80 - 1, 10);
    var extraTarget = new ED.PathNode(tx, Math.floor(target.y + lead), tz);
    this.path = d.findPath(from, to, extraTarget);
    if (this.path) this.path.next();
    if (this.path) {
      this.followPath();
    }
  };

  function sq(n) { return n * n; }
  var DEG2RAD = Math.PI / 180.0;
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  /** `MathHelper.wrapDegrees(double)` verbatim. */
  function wrapDegrees(deg) {
    var d = deg % 360.0;
    if (d >= 180.0) d -= 360.0;
    if (d < -180.0) d += 360.0;
    return d;
  }
  function normalize3(x, y, z) {
    var len = Math.sqrt(x * x + y * y + z * z);
    if (len < 1.0e-4) return { x: 0, y: 0, z: 0 };
    return { x: x / len, y: y / len, z: z / len };
  }
  function dot3(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }

  /**
   * `DyingPhase.java` -- ported (server side only; `clientTick()`'s `world.addParticle` call is
   * client-render bookkeeping, the same "particle bookkeeping is client-render state, untouched
   * here" scope `tickMovement()`'s own header comment above already draws). `target` is
   * `world.getTopPosition(Heightmap.Type, EndPortalFeature.ORIGIN)` (`.decomp`, read verbatim),
   * recomputed once per `beginPhase` -- `EndPortalFeature.ORIGIN` is `BlockPos.ORIGIN` (0,0,0)
   * per `.decomp/net/minecraft/world/gen/feature/EndPortalFeature.java:15`, so the target's x/z
   * is the block-center (0.5, 0.5) and its y is this engine's own `d.heightAt(0, 0) + 1` stand-in
   * -- the SAME "heightAt(x,z)+1 approximates world.getTopPosition" convention
   * `HoldingPatternPhase.tickInRange()` above already uses for the identical `ORIGIN` lookup
   * (vanilla actually asks two different `Heightmap.Type`s -- `MOTION_BLOCKING` here,
   * `WORLD_SURFACE` there -- but this engine's `heightAt` stand-in draws no such distinction).
   * `serverTick()` is verbatim: `setHealth(1)` while in the [100,22500] distSq band with no
   * collision (the dragon is still circling down toward the portal), `setHealth(0)` otherwise
   * (arrived or stuck -- `EnderDragonEntity.tick()`'s own death-effects branch, `ticksSinceDeath`
   * XP/loot, is `ED.OWED`'s separate "death loot/experience drop" item, untouched here).
   */
  ED.DyingPhase = function (dragon) {
    ED.AbstractPhase.call(this, dragon, ED.PHASE_TYPES.byName.Dying);
    this.target = null;
  };
  ED.DyingPhase.prototype = Object.create(ED.AbstractPhase.prototype);
  ED.DyingPhase.prototype.constructor = ED.DyingPhase;

  ED.DyingPhase.prototype.beginPhase = function () { this.target = null; };
  ED.DyingPhase.prototype.getMaxYAcceleration = function () { return 3.0; };
  ED.DyingPhase.prototype.getPathTarget = function () { return this.target; };

  ED.DyingPhase.prototype.serverTick = function () {
    var d = this.dragon;
    if (this.target == null) {
      this.target = { x: 0.5, y: d.heightAt(0, 0) + 1, z: 0.5 };
    }
    var distSq = sq(this.target.x - d.getX()) + sq(this.target.y - d.getY()) + sq(this.target.z - d.getZ());
    var inRange = distSq >= 100 && distSq <= 22500 && !d.horizontalCollision && !d.verticalCollision;
    if (inRange) {
      d.setHealth(1);
    } else {
      d.setHealth(0);
    }
  };



  /**
   * `AbstractSittingPhase.java` verbatim -- the shared parent `SittingFlamingPhase`/
   * `SittingScanningPhase`/`SittingAttackingPhase` all extend (`isSittingOrHovering()` already
   * comes out true for these three via ED.PHASE_TYPES' own SITTING_OR_HOVERING table, above --
   * .decomp's own override just repeats that, nothing new to port there). `modifyDamageTaken`
   * is the one real piece: an arrow hit takes NO damage and catches fire for 1s instead. This
   * engine has no `PersistentProjectileEntity` class to `instanceof`-check -- `source.source ===
   * 'projectile'` is the SAME flag every other mob's arrow-specific gating already reads off a
   * DamageSource (14j_combat.js:419 shulker, :435 enderman; `Cb.tickArrow`'s own
   * `{source: 'projectile'}`, 14j_combat.js:1467/14zzm_wither.js:621), not invented here.
   * `setOnFireFor(1)` ignites the ARROW (`source.sourceEntity`, set by Cb.tickArrow), via Cb.igniteForSeconds.
   */
  ED.AbstractSittingPhase = function (dragon, type) {
    ED.AbstractPhase.call(this, dragon, type);
  };
  ED.AbstractSittingPhase.prototype = Object.create(ED.AbstractPhase.prototype);
  ED.AbstractSittingPhase.prototype.constructor = ED.AbstractSittingPhase;
  ED.AbstractSittingPhase.prototype.modifyDamageTaken = function (source, amount) {
    if (source && source.source === 'projectile') {
      // `$$0.getSource().setOnFireFor(1)`: the ARROW (damage source's entity) is ignited, not the dragon.
      var arrow = source.sourceEntity;
      if (arrow && NS.Combat && NS.Combat.igniteForSeconds) NS.Combat.igniteForSeconds(arrow, 1);
      return 0.0;
    }
    return ED.AbstractPhase.prototype.modifyDamageTaken.call(this, source, amount);
  };

  /**
   * `LandingPhase.java` verbatim (.decomp, read whole) -- the vertical drop from LandingApproach
   * onto the End portal, server side only (`clientTick()`'s own descent-particle trail is
   * client-render bookkeeping, the SAME scope `DyingPhase`'s own clientTick omission above
   * already draws). `target` is `world.getTopPosition(Heightmap.Type, EndPortalFeature.ORIGIN)`
   * -- `d.heightAt(0,0)+1` at block-center (0.5, 0.5), the SAME convention `ED.DyingPhase`/
   * `ED.LandingApproachPhase`/`ED.TakeoffPhase` already use for the identical ORIGIN lookup.
   * `serverTick()`'s own handoff -- `getPhaseManager().create(SittingFlaming).reset()` then
   * `setPhase(SittingScanning)` -- is ported exactly as .decomp has it (both calls, in that
   * order; `create()` alone does NOT call `beginPhase()`, only `setPhase()` does, so
   * `SittingFlamingPhase.reset()`'s own `timesRun = 0` always runs strictly before
   * `SittingFlamingPhase.beginPhase()`'s own `timesRun++` on any LATER re-entry -- verbatim,
   * not reordered). `getYawAcceleration()` is its own DIFFERENT override, not the default
   * `AbstractPhase` formula (`0.7/capped/speed`) -- verbatim `capped/speed` with no 0.7 factor,
   * checked against `.decomp`, not assumed.
   */
  ED.LandingPhase = function (dragon) {
    ED.AbstractPhase.call(this, dragon, ED.PHASE_TYPES.byName.Landing);
    this.target = null;
  };
  ED.LandingPhase.prototype = Object.create(ED.AbstractPhase.prototype);
  ED.LandingPhase.prototype.constructor = ED.LandingPhase;

  ED.LandingPhase.prototype.beginPhase = function () { this.target = null; };
  ED.LandingPhase.prototype.getMaxYAcceleration = function () { return 1.5; };
  ED.LandingPhase.prototype.getPathTarget = function () { return this.target; };
  ED.LandingPhase.prototype.getYawAcceleration = function () {
    var speed = this.dragon.getHorizontalSpeed() + 1.0;
    var capped = Math.min(speed, 40.0);
    return capped / speed;
  };

  ED.LandingPhase.prototype.serverTick = function () {
    var d = this.dragon;
    if (this.target == null) {
      this.target = { x: 0.5, y: d.heightAt(0, 0) + 1, z: 0.5 };
    }
    var distSq = sq(this.target.x - d.getX()) + sq(this.target.y - d.getY()) + sq(this.target.z - d.getZ());
    if (distSq < 1.0) {
      d.getPhaseManager().create(ED.PHASE_TYPES.byName.SittingFlaming).reset();
      d.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.SittingScanning);
    }
  };

  /**
   * `SittingFlamingPhase.java` -- ported, including the tick-10 dragon-breath cloud (#4343,
   * radius 5, duration 200, Instant Damage; removed in endPhase). `clientTick()`'s own particle
   * burst is client-render bookkeeping, the SAME scope every other phase's clientTick omission
   * here already draws. Everything else -- the 200-tick duration timer, the `timesRun`-gated
   * Takeoff-vs-SittingScanning handoff, `beginPhase()`'s own `timesRun++`, and the public
   * `reset()` `LandingPhase.serverTick()` above calls -- is verbatim.
   */
  ED.SittingFlamingPhase = function (dragon) {
    ED.AbstractSittingPhase.call(this, dragon, ED.PHASE_TYPES.byName.SittingFlaming);
    this.ticks = 0;
    this.timesRun = 0;
  };
  ED.SittingFlamingPhase.prototype = Object.create(ED.AbstractSittingPhase.prototype);
  ED.SittingFlamingPhase.prototype.constructor = ED.SittingFlamingPhase;

  ED.SittingFlamingPhase.prototype.beginPhase = function () {
    this.ticks = 0;
    this.timesRun++;
  };
  ED.SittingFlamingPhase.prototype.reset = function () { this.timesRun = 0; };

  ED.SittingFlamingPhase.prototype.serverTick = function () {
    this.ticks++;
    if (this.ticks >= 200) {
      if (this.timesRun >= 4) {
        this.dragon.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.Takeoff);
      } else {
        this.dragon.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.SittingScanning);
      }
    }
    else if (this.ticks === 10) {
      var d = this.dragon, h = d.head, hx = h.x - d.getX(), hz = h.z - d.getZ(), hl = Math.sqrt(hx * hx + hz * hz);
      var nx = hl ? hx / hl : 0, nz = hl ? hz / hl : 0;
      var cx = h.x + nx * 2.5, cz = h.z + nz * 2.5, y0 = h.y + h.height * 0.5, y = y0;
      while (d.world.isAir(cx, y, cz)) { if (--y < 0) { y = y0; break; } }
      // setRadius(5), setDuration(200), DRAGON_BREATH particle (client-only), one Instant Damage effect
      this.dragonBreathEntity = d.world.spawnEntity('area_effect_cloud', cx, Math.floor(y) + 1, cz, {
        shooter: d, radius: 5.0, duration: 200,
        custom: [{ effect: 'instant_damage', duration: 1, amplifier: 0 }]
      });
    }
  };
  ED.SittingFlamingPhase.prototype.endPhase = function () {
    if (this.dragonBreathEntity) { this.dragonBreathEntity.removed = true; this.dragonBreathEntity = null; }
  };

  /**
   * `SittingScanningPhase.java` verbatim. `getClosestPlayer(predicate)` = nearest of
   * `dragon.playersFn()` within `maxDist` (3D, from the dragon) passing `filter`. The final
   * `create(StrafePlayer).setPathTarget(...)` is called only if ED.StrafePlayerPhase defines
   * it (it does not: its target comes from setTargetEntity).
   */
  ED.SittingScanningPhase = function (dragon) {
    ED.AbstractSittingPhase.call(this, dragon, ED.PHASE_TYPES.byName.SittingScanning);
    this.ticks = 0;
  };
  ED.SittingScanningPhase.prototype = Object.create(ED.AbstractSittingPhase.prototype);
  ED.SittingScanningPhase.prototype.constructor = ED.SittingScanningPhase;

  ED.SittingScanningPhase.prototype.beginPhase = function () { this.ticks = 0; };

  ED.SittingScanningPhase.prototype.closestPlayer = function (maxDist, dyMax) {
    var d = this.dragon, ps = d.playersFn ? d.playersFn() : [], best = null, bestD = maxDist * maxDist;
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      if (!p || !d.canTarget(p)) continue;
      if (dyMax != null && Math.abs(p.y - d.getY()) > dyMax) continue;
      var dd = sq(p.x - d.getX()) + sq(p.y - d.getY()) + sq(p.z - d.getZ());
      if (dd < bestD) { bestD = dd; best = p; }
    }
    return best;
  };

  ED.SittingScanningPhase.prototype.serverTick = function () {
    var d = this.dragon, pm = d.getPhaseManager();
    this.ticks++;
    var p = this.closestPlayer(20.0, 10.0);
    if (p) {
      if (this.ticks > 25) {
        pm.setPhase(ED.PHASE_TYPES.byName.SittingAttacking);
      } else {
        var t = normalize3(p.x - d.getX(), 0, p.z - d.getZ());
        var f = normalize3(Math.sin(d.getYaw() * DEG2RAD), 0, -Math.cos(d.getYaw() * DEG2RAD));
        var dot = Math.fround(f.x * t.x + f.y * t.y + f.z * t.z);
        var ang = Math.fround(Math.acos(dot) * 180.0 / Math.PI) + 0.5;
        if (ang < 0.0 || ang > 10.0) {
          var dx = p.x - d.head.x, dz = p.z - d.head.z;
          var err = Math.max(-100.0, Math.min(100.0,
            wrapDegrees(180.0 - Math.atan2(dx, dz) * (180.0 / Math.PI) - d.getYaw())));
          d.yawAcceleration *= 0.8;
          var dist = Math.sqrt(dx * dx + dz * dz) + 1.0, div = dist;
          if (dist > 40.0) dist = 40.0;
          d.yawAcceleration += err * (0.7 / dist / div);
          d.setYaw(d.getYaw() + d.yawAcceleration);
        }
      }
    } else if (this.ticks >= 100) {
      var far = this.closestPlayer(150.0, null);
      pm.setPhase(ED.PHASE_TYPES.byName.Takeoff);
      if (far) {
        pm.setPhase(ED.PHASE_TYPES.byName.StrafePlayer);
        var sp = pm.create(ED.PHASE_TYPES.byName.StrafePlayer);
        if (sp.setPathTarget) sp.setPathTarget({ x: far.x, y: far.y, z: far.z });
      }
    }
  };

  /**
   * `SittingAttackingPhase.java` verbatim (server side) -- `clientTick()`'s own roar sound is
   * client-render/audio bookkeeping, the SAME scope every other phase's clientTick omission
   * here already draws. `serverTick()`'s own 40-tick timer back to SittingFlaming is the whole
   * of it.
   */
  ED.SittingAttackingPhase = function (dragon) {
    ED.AbstractSittingPhase.call(this, dragon, ED.PHASE_TYPES.byName.SittingAttacking);
    this.ticks = 0;
  };
  ED.SittingAttackingPhase.prototype = Object.create(ED.AbstractSittingPhase.prototype);
  ED.SittingAttackingPhase.prototype.constructor = ED.SittingAttackingPhase;

  ED.SittingAttackingPhase.prototype.beginPhase = function () { this.ticks = 0; };

  ED.SittingAttackingPhase.prototype.serverTick = function () {
    if (this.ticks++ >= 40) {
      this.dragon.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.SittingFlaming);
    }
  };

  /**
   * `ChargingPlayerPhase.java` verbatim -- `LOGGER.warn` on the null-target abort branch is
   * logging only, not ported (no console/log substrate wired to this isolated dragon rig).
   * `chargingTicks > 0 && chargingTicks++ >= 10` is short-circuit: the increment only happens
   * once charging has actually started (chargingTicks > 0), checked against .decomp, not
   * assumed -- a target set via `setPathTarget()` alone does NOT start the charge-tick counter
   * by itself; only the distance/collision gate below (the else branch's own `chargingTicks++`)
   * does.
   */
  ED.ChargingPlayerPhase = function (dragon) {
    ED.AbstractPhase.call(this, dragon, ED.PHASE_TYPES.byName.ChargingPlayer);
    this.pathTarget = null;
    this.chargingTicks = 0;
  };
  ED.ChargingPlayerPhase.prototype = Object.create(ED.AbstractPhase.prototype);
  ED.ChargingPlayerPhase.prototype.constructor = ED.ChargingPlayerPhase;

  ED.ChargingPlayerPhase.prototype.beginPhase = function () {
    this.pathTarget = null;
    this.chargingTicks = 0;
  };
  ED.ChargingPlayerPhase.prototype.setPathTarget = function (target) { this.pathTarget = target; };
  ED.ChargingPlayerPhase.prototype.getMaxYAcceleration = function () { return 3.0; };
  ED.ChargingPlayerPhase.prototype.getPathTarget = function () { return this.pathTarget; };

  ED.ChargingPlayerPhase.prototype.serverTick = function () {
    var d = this.dragon;
    if (this.pathTarget == null) {
      d.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.HoldingPattern);
    } else if (this.chargingTicks > 0 && this.chargingTicks++ >= 10) {
      d.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.HoldingPattern);
    } else {
      var distSq = sq(this.pathTarget.x - d.getX()) + sq(this.pathTarget.y - d.getY()) + sq(this.pathTarget.z - d.getZ());
      if (distSq < 100 || distSq > 22500 || d.horizontalCollision || d.verticalCollision) {
        this.chargingTicks++;
      }
    }
  };

  /**
   * `LandingApproachPhase.java` verbatim (.decomp, read whole) -- the flight leg between
   * HoldingPattern and Landing: retarget toward the End-portal origin's own top-of-world
   * position (`heightAt(0,0)`, the same `World.getTopPosition` stand-in `ED.DyingPhase`/
   * `ED.HoldingPatternPhase` already use) whenever the current path target is out of range or
   * blocked, biased toward whichever ring node lies away from the closest player (or, with no
   * player, toward node index `getNearestPathNodeIndex(40, topY, 0)`); once that path runs out,
   * hands off to Landing. `updatePath()`/`followPath()` are the SAME ring-walk shape
   * `HoldingPatternPhase`'s own already port -- this is the one extra piece: an `extraTarget`
   * PathNode planted at the portal's own top position (raw int BlockPos coordinates, NOT the
   * block-center +0.5 `getRotationVectorFromPhase` uses -- `.decomp`'s own `PathNode`
   * constructor call takes `BlockPos.getX()/getY()/getZ()` bare).
   */
  ED.LandingApproachPhase = function (dragon) {
    ED.AbstractPhase.call(this, dragon, ED.PHASE_TYPES.byName.LandingApproach);
    this.path = null;
    this.pathTarget = null;
  };
  ED.LandingApproachPhase.prototype = Object.create(ED.AbstractPhase.prototype);
  ED.LandingApproachPhase.prototype.constructor = ED.LandingApproachPhase;

  ED.LandingApproachPhase.prototype.beginPhase = function () {
    this.path = null;
    this.pathTarget = null;
  };
  ED.LandingApproachPhase.prototype.getPathTarget = function () { return this.pathTarget; };

  ED.LandingApproachPhase.prototype.serverTick = function () {
    var d = this.dragon;
    var distSq = this.pathTarget == null ? 0
      : sq(this.pathTarget.x - d.getX()) + sq(this.pathTarget.y - d.getY()) + sq(this.pathTarget.z - d.getZ());
    if (distSq < 100 || distSq > 22500 || d.horizontalCollision || d.verticalCollision) {
      this.updatePath();
    }
  };

  ED.LandingApproachPhase.prototype.updatePath = function () {
    var d = this.dragon;
    if (!this.path || this.path.isFinished()) {
      var from = d.getNearestPathNodeIndex();
      var topY = d.heightAt(0, 0);
      var closest = d.getClosestPlayer(0, topY, 0);
      var to;
      if (closest) {
        var norm = normalize3(closest.x, 0, closest.z);
        to = d.getNearestPathNodeIndex(-norm.x * 40, 105, -norm.z * 40);
      } else {
        to = d.getNearestPathNodeIndex(40, topY, 0);
      }
      var extraTarget = new ED.PathNode(0, topY, 0);
      this.path = d.findPath(from, to, extraTarget);
      if (this.path) this.path.next();
    }
    this.followPath();
    if (this.path && this.path.isFinished()) {
      d.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.Landing);
    }
  };

  /** `LandingApproachPhase.followPath()` -- verbatim, the SAME single-`next()` shape
   * `HoldingPatternPhase.followPath()`/`StrafePlayerPhase.followPath()` already port. */
  ED.LandingApproachPhase.prototype.followPath = function () {
    if (this.path && !this.path.isFinished()) {
      var node = this.path.getCurrentNodePos();
      this.path.next();
      var d = this.dragon;
      var y;
      do { y = node.y + d.getRandom().nextFloat() * 20; } while (y < node.y);
      this.pathTarget = { x: node.x, y: y, z: node.z };
    }
  };

  /**
   * `TakeoffPhase.java` verbatim (.decomp, read whole) -- climbs away from the portal along a
   * fresh ring path (`updatePath()`, biased by `getRotationVectorFromPhase(1.0F)` above -- the
   * one real caller this phase existed to unlock) until the dragon is more than 10 blocks from
   * the portal's own top-of-world position (block-CENTER distance, `Vec3i.isWithinDistance`,
   * matching `getRotationVectorFromPhase`'s own +0.5 convention -- see that method's comment),
   * then hands off to HoldingPattern. `beginPhase()` forces the very first `serverTick()` to
   * (re)compute a path (`shouldFindNewPath` starts true, .decomp's own field default).
   * WARNING: `followPath()` calls `path.next()` TWICE when a fresh path is found (once
   * unconditionally, once more after reading the now-current node) -- NOT the single-`next()`
   * shape every other phase's `followPath()` in this file uses; ported exactly as `.decomp` has
   * it, not normalized to match the others.
   */
  ED.TakeoffPhase = function (dragon) {
    ED.AbstractPhase.call(this, dragon, ED.PHASE_TYPES.byName.Takeoff);
    this.shouldFindNewPath = true;
    this.path = null;
    this.pathTarget = null;
  };
  ED.TakeoffPhase.prototype = Object.create(ED.AbstractPhase.prototype);
  ED.TakeoffPhase.prototype.constructor = ED.TakeoffPhase;

  ED.TakeoffPhase.prototype.beginPhase = function () {
    this.shouldFindNewPath = true;
    this.path = null;
    this.pathTarget = null;
  };
  ED.TakeoffPhase.prototype.getPathTarget = function () { return this.pathTarget; };

  ED.TakeoffPhase.prototype.serverTick = function () {
    var d = this.dragon;
    if (!this.shouldFindNewPath && this.path) {
      var topY = d.heightAt(0, 0);
      var distSq = sq(0.5 - d.getX()) + sq(topY + 0.5 - d.getY()) + sq(0.5 - d.getZ());
      // `Vec3i.isWithinDistance`: within iff distSq < 10^2 (strict); NOT-within (the switch
      // condition) is therefore distSq >= 100, not distSq > 100.
      if (distSq >= 100) {
        d.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.HoldingPattern);
      }
    } else {
      this.shouldFindNewPath = false;
      this.updatePath();
    }
  };

  ED.TakeoffPhase.prototype.updatePath = function () {
    var d = this.dragon;
    var from = d.getNearestPathNodeIndex();
    var rv = d.getRotationVectorFromPhase(1.0);
    var to = d.getNearestPathNodeIndex(-rv.x * 40, 105, -rv.z * 40);
    var fight = d.getFight();
    if (fight && fight.getAliveEndCrystals() > 0) {
      to = to % 12;
      if (to < 0) to += 12;
    } else {
      to -= 12;
      to &= 7;
      to += 12;
    }
    this.path = d.findPath(from, to, null);
    this.followPath();
  };

  ED.TakeoffPhase.prototype.followPath = function () {
    if (this.path) {
      this.path.next();
      if (!this.path.isFinished()) {
        var node = this.path.getCurrentNodePos();
        this.path.next();
        var d = this.dragon;
        var y;
        do { y = node.y + d.getRandom().nextFloat() * 20; } while (y < node.y);
        this.pathTarget = { x: node.x, y: y, z: node.z };
      }
    }
  };

  // -- PER-PART DAMAGE ROUTING (this slice: G18 leftover, QUEUE 0.00 part 2) ------------------
  // `EnderDragonEntity.damagePart(EnderDragonPart, DamageSource, float)` + `EnderDragonPart.
  // damage(DamageSource, float)` ported verbatim (the routing ED.OWED, above, named). `source`
  // here is this engine's own DamageSource stand-in -- `{byPlayer, explosive}` -- matching the
  // shape every other mob's damage path in this engine already narrows a real `DamageSource`
  // to (see 14j_combat.js's own `byPlayer` param / `src.source`/`src.bypassArmor` fields);
  // vanilla's own check is `source.getAttacker() instanceof PlayerEntity || source.isExplosive()`.

  ED.MAX_HEALTH = 200; // `EnderDragonEntity.MAX_HEALTH` (field_30428), createEnderDragonAttributes()

  /** `new EnderDragonPart(owner, name, width, height)` -- `damage()` routes to
   * `owner.damagePart(this, source, amount)`, verbatim (`EnderDragonPart.java:36-38`). */
  ED.EnderDragonPart = function (owner, name, width, height) {
    this.owner = owner;
    this.name = name;
    this.width = width;
    this.height = height;
    this.x = 0; this.y = 0; this.z = 0;
  };
  /** `Entity.getBoundingBox()` of a part: `width` square, `height` tall, from `y` up. */
  ED.EnderDragonPart.prototype.getBox = function (grow) {
    var h = this.width / 2 + (grow || 0);
    return { minX: this.x - h, maxX: this.x + h, minY: this.y - (grow || 0), maxY: this.y + this.height + (grow || 0), minZ: this.z - h, maxZ: this.z + h };
  };
  ED.EnderDragonPart.prototype.damage = function (source, amount) {
    return this.owner.damagePart(this, source, amount);
  };

  /**
   * A minimal `EnderDragonEntity` stand-in: just enough state (position, the 8 parts, health,
   * the path ring, a phase manager) for `ED.PhaseManager`/`ED.HoldingPatternPhase`/damage
   * routing above to have a real "owner" to drive and test end-to-end, without depending on
   * this engine's own Entity/World/Combat systems (ED.OWED names that wiring as still open).
   * `opts.pathNodes` should be an `ED.buildPathNodes(...)` result; `opts.fight` an optional
   * `{getAliveEndCrystals()}`; `opts.random` an optional `{nextInt, nextFloat}` (defaults to a
   * fresh `NS.Noise.LegacyRandom`, this engine's own java.util.Random port, when available);
   * `opts.players` an optional `() => [...]` (defaults to this engine's single `NS.Player` when
   * available, the SAME shape `EL.aiCtx(e).players()` already returns) and `opts.heightAt` an
   * optional `(x, z) => surfaceBlockY` (defaults to sea level 63, `ED.buildPathNodes`' own
   * `heightAt` convention) -- both caller-supplied stand-ins for `World.getClosestPlayer`/
   * `World.getTopPosition`, the same "accept a stand-in rather than depend on World" shape
   * `opts.fight` above already uses.
   */
  ED.EnderDragonEntity = function (opts) {
    opts = opts || {};
    this.x = opts.x || 0; this.y = opts.y || 0; this.z = opts.z || 0;
    this.velocity = opts.velocity || { x: 0, y: 0, z: 0 };
    this.yaw = opts.yaw || 0;
    // `EnderDragonEntity.yawAcceleration`/`slowedDownByBlock` -- both read by `tickMovement()`'s
    // own motion blend (below); `slowedDownByBlock` is set from real block-above-head collision
    // in vanilla (`checkBlockCollision`-adjacent, not built here -- ED.OWED already scopes real
    // World/block wiring as a separate item), so it stays false here, but the `* 0.8` branch that
    // reads it is still ported verbatim rather than dropped.
    this.yawAcceleration = 0;
    this.slowedDownByBlock = false;
    this.horizontalCollision = false;
    this.verticalCollision = false;
    this.fight = opts.fight || null;
    this.pathNodes = opts.pathNodes || null;
    this.health = ED.MAX_HEALTH;
    this.damageDuringSitting = 0;
    // `segmentCircularBuffer[64][3]` / `latestSegment` / `wingPosition` (.decomp EnderDragonEntity :61-73)
    this.segmentCircularBuffer = [];
    for (var sgi = 0; sgi < 64; sgi++) this.segmentCircularBuffer.push([0, 0, 0]);
    this.latestSegment = -1;
    this.wingPosition = 0; this.prevWingPosition = 0;
    this.ticksUntilNextGrowl = 100;
    var LR = (typeof NS !== 'undefined' && NS.Noise && NS.Noise.LegacyRandom);
    this.random = opts.random || (LR ? new LR(ED.seedNow()) : { nextInt: function (n) { return Math.floor(Math.random() * n); }, nextFloat: function () { return Math.random(); } });
    this.playersFn = opts.players || function () {
      return (typeof NS !== 'undefined' && NS.Player) ? [NS.Player] : [];
    };
    this.heightAt = opts.heightAt || function () { return 63; };
    // `Entity.world` -- the handle phases need for spawnEntity/isAir/canSee (breath cloud, strafe
    // fireball). Defaults to this engine's single implicit world; opts.world swaps a stand-in.
    this.world = opts.world || ED.defaultWorld;

    this.head = new ED.EnderDragonPart(this, 'head', 1.0, 1.0);
    this.neck = new ED.EnderDragonPart(this, 'neck', 3.0, 3.0);
    this.body = new ED.EnderDragonPart(this, 'body', 5.0, 3.0);
    this.tail1 = new ED.EnderDragonPart(this, 'tail', 2.0, 2.0);
    this.tail2 = new ED.EnderDragonPart(this, 'tail', 2.0, 2.0);
    this.tail3 = new ED.EnderDragonPart(this, 'tail', 2.0, 2.0);
    this.rightWing = new ED.EnderDragonPart(this, 'wing', 4.0, 2.0);
    this.leftWing = new ED.EnderDragonPart(this, 'wing', 4.0, 2.0);
    this.parts = [this.head, this.neck, this.body, this.tail1, this.tail2, this.tail3, this.rightWing, this.leftWing];

    this.phaseManager = new ED.PhaseManager(this);
  };

  /** `World.spawnEntity`/`isAir`/`canSee` over this engine's one world (EntityList/World/Ai). */
  ED.defaultWorld = {
    spawnEntity: function (type, x, y, z, opts) { return NS.EntityList ? NS.EntityList.spawn(type, x, y, z, opts) : null; },
    isAir: function (x, y, z) { return !!NS.World && NS.World.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)) === 0; },
    canSee: function (from, to) { return !!(NS.Ai && NS.Ai.canSee && NS.Ai.canSee(from, to)); }
  };

  // ── DragonFireballEntity (.decomp projectile/DragonFireballEntity.java, read whole) ─────────
  // Same power-then-drag flight as Bl.Fireball; on ANY collision (except its owner) it becomes
  // a 600-tick dragon-breath cloud, radius 3 growing to 7, Instant Damage amp 1 -- moved onto
  // the nearest living entity within 4 blocks. Impact plays world event 2006.
  ED.initDragonFireball = function (e, opts) {
    var p = opts && opts.power;
    if (p && NS.Blaze && NS.Blaze.Fireball) NS.Blaze.Fireball.initPower(e, p[0], p[1], p[2]);
    else { e.powerX = 0; e.powerY = 0; e.powerZ = 0; }
    if (opts && opts.shooter) e.shooter = opts.shooter;
  };
  ED.tickDragonFireball = function (e) {
    if (e.removed) return;
    // vanilla casts the hit ray at the START of the next tick (pre-move, with that tick's velocity), so a hit found
    // here is acted on one tick later, from the position it was found at (referee: dfireball_* alive bit)
    var pend = e.dfHit; e.dfHit = false;
    var ex0 = e.x, ey0 = e.y, ez0 = e.z;
    if (pend) { ex0 = pend[0]; ey0 = pend[1]; ez0 = pend[2]; e.x = ex0; e.y = ey0; e.z = ez0; }
    var Ph = NS.Physics, hit = !!pend || e.onGround || !!(Ph && Ph.solidAt && (Ph.solidAt(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z)) ||
      Ph.solidAt(Math.floor(e.x + (e.vx + e.powerX) * 0.95), Math.floor(e.y + (e.vy + e.powerY) * 0.95), Math.floor(e.z + (e.vz + e.powerZ) * 0.95))));
    var list = (NS.EntityList && NS.EntityList.list || []).slice();
    if (NS.Player) list.push(NS.Player);
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      if (t === e || t.removed || t.maxHealth === undefined) continue;
      if (t === e.shooter) continue;
      var tw = t.width !== undefined ? t.width : 0.6, th = t.height !== undefined ? t.height : 1.8;
      if (Math.abs(e.x - t.x) <= tw / 2 + 0.25 && Math.abs(e.z - t.z) <= tw / 2 + 0.25 && e.y >= t.y - 0.25 && e.y <= t.y + th + 0.25) hit = true;
    }
    if (hit && !pend) {   // found now: look ahead with the NEXT tick's velocity, act next tick
      e.vx = (e.vx + e.powerX) * 0.95; e.vy = (e.vy + e.powerY) * 0.95; e.vz = (e.vz + e.powerZ) * 0.95;
      e.dfHit = [e.x, e.y, e.z];
      return;
    }
    if (hit) {
      // vanilla's loop picks the FIRST living entity in the box expanded (4,2,4) with d<16; the
      // owner counts there too, so recheck without the owner exclusion above
      var cx = e.x, cy = e.y, cz = e.z;
      var tgt = null;
      for (var j = 0; j < list.length; j++) {
        var u = list[j];
        if (u === e || u.removed || u.maxHealth === undefined) continue;
        if (sq(e.x - u.x) + sq(e.y - u.y) + sq(e.z - u.z) < 16) { tgt = u; break; }
      }
      if (tgt) { cx = tgt.x; cy = tgt.y; cz = tgt.z; }
      var EL = NS.EntityList;
      if (EL && EL.canSpawn('area_effect_cloud')) {
        EL.spawn('area_effect_cloud', cx, cy, cz, {
          shooter: e.shooter, radius: 3.0, duration: 600, radiusGrowth: (7.0 - 3.0) / 600,
          custom: [{ effect: 'instant_damage', duration: 1, amplifier: 1 }]
        });
      }
      if (NS.Particle && NS.Particle.worldEvent) NS.Particle.worldEvent(2006, Math.floor(e.x), Math.floor(e.y), Math.floor(e.z), e.silent ? -1 : 1);
      e.removed = true;
      return;
    }
    e.vx = (e.vx + e.powerX) * 0.95;
    e.vy = (e.vy + e.powerY) * 0.95;
    e.vz = (e.vz + e.powerZ) * 0.95;
  };

  ED.EnderDragonEntity.prototype.getX = function () { return this.x; };
  ED.EnderDragonEntity.prototype.getY = function () { return this.y; };
  ED.EnderDragonEntity.prototype.getZ = function () { return this.z; };
  ED.EnderDragonEntity.prototype.getRandom = function () { return this.random; };
  ED.EnderDragonEntity.prototype.getFight = function () { return this.fight; };
  // TargetPredicate.createAttackable().test: creative/spectator/Peaceful players refused (Ai.canTargetLiving).
  ED.EnderDragonEntity.prototype.canTarget = function (t) { return !NS.Ai || !NS.Ai.canTargetLiving || NS.Ai.canTargetLiving(t, this); };
  ED.EnderDragonEntity.prototype.getPhaseManager = function () { return this.phaseManager; };
  ED.EnderDragonEntity.prototype.getHorizontalSpeed = function () {
    return Math.sqrt(sq(this.velocity.x) + sq(this.velocity.z));
  };

  ED.EnderDragonEntity.prototype.getYaw = function () { return this.yaw; };
  ED.EnderDragonEntity.prototype.setYaw = function (yaw) { this.yaw = yaw; };
  ED.EnderDragonEntity.prototype.getVelocity = function () { return this.velocity; };
  ED.EnderDragonEntity.prototype.setVelocity = function (v) { this.velocity = v; };

  /** `Entity.getPitch()`/`setPitch(float)` verbatim -- the two rotation fields `ED.OWED` named
   * as missing (Landing-approach/Takeoff's own `getRotationVectorFromPhase` needs both to swap
   * pitch out and back in). Mirrors `getYaw()`/`setYaw()` just above, which D-804 already ports. */
  ED.EnderDragonEntity.prototype.getPitch = function () { return this.pitch || 0; };
  ED.EnderDragonEntity.prototype.setPitch = function (p) { this.pitch = p; };

  /** `Entity.getRotationVec(float tickDelta)` verbatim: `getRotationVector(getPitch(tickDelta),
   * getYaw(tickDelta))`. Every real `.decomp` call site (`LandingPhase`/`SittingFlamingPhase`/
   * `TakeoffPhase`, all via `getRotationVectorFromPhase(1.0F)`) passes tickDelta 1.0, which
   * vanilla's own `getPitch(float)`/`getYaw(float)` overloads short-circuit straight to the
   * current pitch/yaw (no `prevPitch`/`prevYaw` lerp) -- this rig tracks no render-interpolation
   * history (ED.OWED already scopes that as renderer/client state), so `tickDelta` is accepted
   * for the real call shape but only ever the tickDelta===1 path runs; the math ported is the
   * same either way (`Entity.getRotationVector`, .decomp:1330-1337). */
  ED.EnderDragonEntity.prototype.getRotationVec = function (tickDelta) {
    var pitch = this.getPitch(), yaw = this.getYaw();
    var radPitch = pitch * DEG2RAD;
    var radYaw = -yaw * DEG2RAD;
    var cosYaw = Math.cos(radYaw), sinYaw = Math.sin(radYaw);
    var cosPitch = Math.cos(radPitch), sinPitch = Math.sin(radPitch);
    return { x: sinYaw * cosPitch, y: -sinPitch, z: cosYaw * cosPitch };
  };

  /** `EnderDragonEntity.getRotationVectorFromPhase(float)` verbatim (.decomp:833-853) --
   * `LandingPhase`/`SittingFlamingPhase`/`TakeoffPhase`'s shared "which way is the dragon
   * pointing, from the CURRENT phase's own worldview" query: Landing/Takeoff momentarily swap
   * pitch for a steep dive/climb angle scaled by distance to the End-portal origin's own
   * top-of-world height (`heightAt(0,0)`, this rig's `World.getTopPosition` stand-in, same
   * convention `ED.DyingPhase`/`ED.HoldingPatternPhase` already use); every
   * `isSittingOrHovering()` phase instead pins pitch to -45; anything else reads pitch/yaw as
   * they stand. Pitch is always restored afterward -- this READS state, it never steers it.
   * WARNING: THE DISTANCE USES BLOCK-CENTER COORDINATES (+0.5 each axis), matching
   * `Vec3i.getSquaredDistanceFromCenter` (.decomp:208-213), which is what
   * `BlockPos.getSquaredDistance(Vec3d)` (a Position, not a Vec3i) actually calls -- not the
   * raw integer BlockPos coordinates `LandingApproachPhase`'s own PathNode/path-index calls
   * use elsewhere in this same file. */
  ED.EnderDragonEntity.prototype.getRotationVectorFromPhase = function (tickDelta) {
    var phase = this.phaseManager.getCurrent();
    var type = phase.getType();
    var LandingT = ED.PHASE_TYPES.byName.Landing, TakeoffT = ED.PHASE_TYPES.byName.Takeoff;
    var vec;
    if (type === LandingT || type === TakeoffT) {
      var topY = this.heightAt(0, 0);
      var dist = Math.max(
        Math.sqrt(sq(0.5 - this.getX()) + sq(topY + 0.5 - this.getY()) + sq(0.5 - this.getZ())) / 4.0,
        1.0
      );
      var factor = 6.0 / dist;
      var savedPitch = this.getPitch();
      this.setPitch(-factor * 1.5 * 5.0);
      vec = this.getRotationVec(tickDelta);
      this.setPitch(savedPitch);
    } else if (phase.isSittingOrHovering()) {
      var savedPitch2 = this.getPitch();
      this.setPitch(-45.0);
      vec = this.getRotationVec(tickDelta);
      this.setPitch(savedPitch2);
    } else {
      vec = this.getRotationVec(tickDelta);
    }
    return vec;
  };

  /** `Entity.updateVelocity(float, Vec3d)` verbatim (`Entity.java`'s own private
   * `movementInputToVelocity` inlined) -- rotates `dir` (a movement-input vector, NOT already a
   * world-space direction) by `this.getYaw()` and adds `speed * |dir|`-scaled result onto the
   * current velocity. `tickMovement()`'s own `updateVelocity(0.06F * (...), new Vec3d(0,0,-1))`
   * call (below) is the ONLY caller a dragon needs. */
  ED.EnderDragonEntity.prototype.updateVelocity = function (speed, dir) {
    var lenSq = dir.x * dir.x + dir.y * dir.y + dir.z * dir.z;
    if (lenSq < 1.0e-7) return;
    var inv = lenSq > 1.0 ? 1.0 / Math.sqrt(lenSq) : 1.0;
    var mx = dir.x * inv * speed, my = dir.y * inv * speed, mz = dir.z * inv * speed;
    var rad = this.getYaw() * DEG2RAD;
    var s = Math.sin(rad), c = Math.cos(rad);
    var vel = this.getVelocity();
    this.setVelocity({
      x: vel.x + (mx * c - mz * s),
      y: vel.y + my,
      z: vel.z + (mz * c + mx * s)
    });
  };

  /** `Entity.move(MovementType, Vec3d)` -- ED.OWED already scopes real block collision as
   * separate (untouched `horizontalCollision`/`verticalCollision` flags, above), so this is the
   * bare "add velocity to position" a collision-free `move()` reduces to; `tickMovement()` below
   * is the only caller a dragon needs, and it never sets either collision flag itself. */
  ED.EnderDragonEntity.prototype.move = function (type, vel) {
    this.x += vel.x; this.y += vel.y; this.z += vel.z;
  };

  /** `EnderDragonEntity.updatePostDeath()` (.decomp, read verbatim) -- the 200-tick death
   * sequence, run each tick INSTEAD of tickMovement once health <= 0. `ticksSinceDeath` counts
   * up (the renderer's death-beam/dissolve reads it); xp orbs every 5th tick past 150 (total
   * floor(B*0.08), B = 12000 on the first kill else 500) behind doMobLoot, one 20% burst at 200,
   * then fight.dragonKilled and removal. Stand-ins: `opts.mobLoot()` (default Br.mobLoot),
   * `opts.spawnXp(x,y,z,amount)` (default Xp.spawn), `opts.onWorldEvent(1028,x,y,z)` at tick 1,
   * `opts.onParticle(x,y,z)` for the 180..200 explosion-emitter burst. */
  ED.EnderDragonEntity.prototype.updatePostDeath = function (opts) {
    opts = opts || {};
    var fight = this.fight;
    if (fight && fight.updateFight) fight.updateFight(this);
    this.ticksSinceDeath = (this.ticksSinceDeath || 0) + 1;
    var t = this.ticksSinceDeath;
    if (t >= 180 && t <= 200 && opts.onParticle) {
      var fx = (this.random.nextFloat() - 0.5) * 8.0;
      var fy = (this.random.nextFloat() - 0.5) * 4.0;
      var fz = (this.random.nextFloat() - 0.5) * 8.0;
      opts.onParticle(this.x + fx, this.y + 2.0 + fy, this.z + fz);
    }
    var loot = opts.mobLoot ? opts.mobLoot() : !(NS.Breed && NS.Breed.mobLoot) || NS.Breed.mobLoot();
    var base = 500;
    if (fight && fight.hasPreviouslyKilled && !fight.hasPreviouslyKilled()) base = 12000;
    var spawnXp = opts.spawnXp || function (x, y, z, n) { if (NS.Xp && NS.Xp.ready) NS.Xp.spawn(x, y, z, n); };
    if (t > 150 && t % 5 === 0 && loot) spawnXp(this.x, this.y, this.z, Math.floor(Math.fround(base * 0.08)));
    if (t === 1 && opts.onWorldEvent) opts.onWorldEvent(1028, this.x, this.y, this.z);
    this.move(0, { x: 0, y: Math.fround(0.1), z: 0 });
    this.yaw = this.yaw + 20.0;
    this.bodyYaw = this.yaw;
    if (t === 200) {
      if (loot) spawnXp(this.x, this.y, this.z, Math.floor(Math.fround(base * 0.2)));
      if (fight && fight.onDragonKilled) fight.onDragonKilled(this);
      this.removed = true;
    }
  };

  /** `EnderDragonEntity.tickMovement()`'s own motion substrate -- ED.OWED (top of file) named
   * this as the remaining piece `canSpawn`/`EL.motionFor` need: `PhaseManager.getCurrent()
   * .serverTick()` picking a `getPathTarget()`, then the vertical-acceleration-toward-target
   * blend, the yaw-acceleration steering, the forward-thrust `updateVelocity` call, `move()`,
   * and the horizontal/vertical drag multiply -- ported verbatim from
   * `EnderDragonEntity.java` (server, non-dead branch only; wing-position/segment-buffer/particle
   * bookkeeping is client-render state, this unit's renderer's job, untouched here). */
  /** The wing clock + 64-entry ring buffer half of `EnderDragonEntity.tickMovement()` (:178-214, non-dead branch). */
  ED.EnderDragonEntity.prototype.tickWingAndSegments = function () {
    this.prevWingPosition = this.wingPosition;
    if (this.isDead()) return;
    var v = this.getVelocity();
    var k = Math.fround(0.2 / (Math.sqrt(v.x * v.x + v.z * v.z) * 10.0 + 1.0));
    k *= Math.pow(2.0, v.y);
    if (this.phaseManager.getCurrent().isSittingOrHovering()) this.wingPosition += 0.1;
    else if (this.slowedDownByBlock) this.wingPosition += k * 0.5;
    else this.wingPosition += k;
    this.setYaw(wrapDegrees(this.getYaw()));
    var buf = this.segmentCircularBuffer;
    if (this.latestSegment < 0) {
      for (var i = 0; i < buf.length; i++) { buf[i][0] = this.getYaw(); buf[i][1] = this.getY(); }
    }
    if (++this.latestSegment === buf.length) this.latestSegment = 0;
    buf[this.latestSegment][0] = this.getYaw();
    buf[this.latestSegment][1] = this.getY();
  };
  /** `EnderDragonEntity.getSegmentProperties(int, float)` (:138-155) -> [yaw, y, z]. */
  ED.EnderDragonEntity.prototype.getSegmentProperties = function (n, t) {
    if (this.isDead()) t = 0;
    t = 1.0 - t;
    var buf = this.segmentCircularBuffer;
    var i2 = (this.latestSegment - n) & 63, i3 = (this.latestSegment - n - 1) & 63;
    var a = buf[i2][0], b = wrapDegrees(buf[i3][0] - a);
    var out = [a + b * t, 0, 0];
    a = buf[i2][1];
    out[1] = a + (buf[i3][1] - a) * t;
    out[2] = buf[i2][2] + (buf[i3][2] - buf[i2][2]) * t;
    return out;
  };
  /** `EnderDragonEntity.getChangeInNeckPitch(int, double[], double[])` (:814-832). */
  ED.EnderDragonEntity.prototype.getChangeInNeckPitch = function (n, s1, s2) {
    var phase = this.phaseManager.getCurrent(), name = phase.type.name, r;
    if (name === 'Landing' || name === 'Takeoff') {
      var top = this.heightAt(0, 0) + 1;   // getTopPosition(MOTION_BLOCKING, ORIGIN); getSquaredDistance(Position) is block-centre
      var dx = 0.5 - this.getX(), dy = top + 0.5 - this.getY(), dz = 0.5 - this.getZ();
      r = n / Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz) / 4.0, 1.0);
    } else if (phase.isSittingOrHovering()) r = n;
    else if (n === 6) r = 0.0;
    else r = s2[1] - s1[1];
    return Math.fround(r);
  };

  ED.EnderDragonEntity.prototype.tickMovement = function () {
    this.age = (this.age | 0) + 1;
    this.tickWithEndCrystals();
    this.tickWingAndSegments();
    var pm = this.phaseManager;
    var phase = pm.getCurrent();
    phase.serverTick();
    if (pm.getCurrent() !== phase) {
      phase = pm.getCurrent();
      phase.serverTick();
    }

    var target = phase.getPathTarget();
    if (target == null) { this.tickParts(); return; }

    var dx = target.x - this.getX();
    var dy = target.y - this.getY();
    var dz = target.z - this.getZ();
    var distSq = dx * dx + dy * dy + dz * dz;
    var maxYAccel = phase.getMaxYAcceleration();
    var horizDist = Math.sqrt(dx * dx + dz * dz);
    var dyAccel = dy;
    if (horizDist > 0.0) {
      dyAccel = clamp(dy / horizDist, -maxYAccel, maxYAccel);
    }

    var vel = this.getVelocity();
    this.setVelocity({ x: vel.x, y: vel.y + dyAccel * 0.01, z: vel.z });
    this.setYaw(wrapDegrees(this.getYaw()));

    // `$$11.subtract(getX(),getY(),getZ()).normalize()` -- recomputed off the ORIGINAL (unclamped)
    // dy, same as vanilla ($$12/$$14 are never reassigned; only the local `$$13` used for the
    // velocity add above is clamped).
    var toTarget = normalize3(dx, dy, dz);
    var lookVec = normalize3(
      Math.sin(this.getYaw() * DEG2RAD),
      this.getVelocity().y,
      -Math.cos(this.getYaw() * DEG2RAD)
    );
    var pitchFactor = Math.max((dot3(lookVec, toTarget) + 0.5) / 1.5, 0.0);

    if (Math.abs(dx) > 1.0e-5 || Math.abs(dz) > 1.0e-5) {
      var angleErr = clamp(
        wrapDegrees(180.0 - Math.atan2(dx, dz) * (180.0 / Math.PI) - this.getYaw()), -50.0, 50.0
      );
      this.yawAcceleration *= 0.8;
      this.yawAcceleration += angleErr * phase.getYawAcceleration();
      this.setYaw(this.getYaw() + this.yawAcceleration * 0.1);
    }

    var distFactor = 2.0 / (distSq + 1.0);
    this.updateVelocity(0.06 * (pitchFactor * distFactor + (1.0 - distFactor)), { x: 0, y: 0, z: -1 });

    var moveVel = this.getVelocity();
    if (this.slowedDownByBlock) moveVel = { x: moveVel.x * 0.8, y: moveVel.y * 0.8, z: moveVel.z * 0.8 };
    this.move('self', moveVel);

    var velN = normalize3(this.getVelocity().x, this.getVelocity().y, this.getVelocity().z);
    var drag = 0.8 + 0.15 * (dot3(velN, lookVec) + 1.0) / 2.0;
    var v2 = this.getVelocity();
    this.setVelocity({ x: v2.x * drag, y: v2.y * 0.91, z: v2.z * drag });
    this.tickParts();
  };

  /** `EnderDragonEntity.tickMovement` :243-376 -- the `movePart` placement of the 8 parts, then
   * (server, `hurtTime == 0`) wing launch + head/neck damage, then `destroyBlocks` on head/neck/body
   * which sets `slowedDownByBlock`. */
  ED.EnderDragonEntity.prototype.tickParts = function () {
    var self = this;
    function mv(p, dx, dy, dz) { p.x = self.x + dx; p.y = self.y + dy; p.z = self.z + dz; }
    var a = (this.getSegmentProperties(5, 1.0) [1] - this.getSegmentProperties(10, 1.0)[1]) * 10.0 * DEG2RAD;
    var c = Math.cos(a), sn = Math.sin(a);
    var yr = this.getYaw() * DEG2RAD, s1 = Math.sin(yr), c1 = Math.cos(yr);
    mv(this.body, s1 * 0.5, 0, -c1 * 0.5);
    mv(this.rightWing, c1 * 4.5, 2.0, s1 * 4.5);
    mv(this.leftWing, c1 * -4.5, 2.0, s1 * -4.5);
    if (!(this.hurtTime > 0)) {
      this.launchLivingEntities(this.othersIn(this.rightWing.getBox(), 4, 2, 4, -2));
      this.launchLivingEntities(this.othersIn(this.leftWing.getBox(), 4, 2, 4, -2));
      this.damageLivingEntities(this.othersIn(this.head.getBox(1)));
      this.damageLivingEntities(this.othersIn(this.neck.getBox(1)));
    }
    var yaw2 = yr - this.yawAcceleration * 0.01;
    var s2 = Math.sin(yaw2), c2 = Math.cos(yaw2);
    var hv = this.phaseManager.getCurrent().isSittingOrHovering() ? -1.0 : (this.getSegmentProperties(5, 1.0)[1] - this.getSegmentProperties(0, 1.0)[1]);
    mv(this.head, s2 * 6.5 * c, hv + sn * 6.5, -c2 * 6.5 * c);
    mv(this.neck, s2 * 5.5 * c, hv + sn * 5.5, -c2 * 5.5 * c);
    var s5 = this.getSegmentProperties(5, 1.0);
    var tails = [this.tail1, this.tail2, this.tail3];
    for (var i = 0; i < 3; i++) {
      var sp = this.getSegmentProperties(12 + i * 2, 1.0);
      var ang = yr + wrapDegrees(sp[0] - s5[0]) * DEG2RAD, sa = Math.sin(ang), ca = Math.cos(ang), f = (i + 1) * 2.0;
      mv(tails[i], -(s1 * 1.5 + sa * f) * c, sp[1] - s5[1] - (f + 1.5) * sn + 1.5, (c1 * 1.5 + ca * f) * c);
    }
    this.slowedDownByBlock = this.destroyBlocks(this.head.getBox()) | this.destroyBlocks(this.neck.getBox()) | this.destroyBlocks(this.body.getBox());
  };

  /** `World.getOtherEntities(this, box.expand(gx,gy,gz).offset(0,oy,0), EXCEPT_CREATIVE_OR_SPECTATOR)`
   * for living things only (callers filter `instanceof LivingEntity`); `grow` already folded into `box`
   * for the 1-expand head/neck case. */
  ED.EnderDragonEntity.prototype.othersIn = function (b, gx, gy, gz, oy) {
    gx = gx || 0; gy = gy || 0; gz = gz || 0; oy = oy || 0;
    var minX = b.minX - gx, maxX = b.maxX + gx, minY = b.minY - gy + oy, maxY = b.maxY + gy + oy, minZ = b.minZ - gz, maxZ = b.maxZ + gz;
    var out = [], EL = NS.EntityList, list = (EL && EL.list ? EL.list.slice() : []);
    if (NS.Player && list.indexOf(NS.Player) < 0) list.push(NS.Player);
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (!o || o === this.entity || o.removed || o.dead || o.invulnerableGamemode) continue;
      if (o.maxHealth === undefined && o !== NS.Player) continue;   // LivingEntity filter, as 07za_explosion.js
      var w = (o.width || 0.6) / 2, h = o.height || 1.8;
      if (o.x + w <= minX || o.x - w >= maxX || o.z + w <= minZ || o.z - w >= maxZ || o.y + h <= minY || o.y >= maxY) continue;
      out.push(o);
    }
    return out;
  };
  ED.EnderDragonEntity.prototype._hurt = function (o, amt) {
    var Cb = NS.Combat;
    var me = this.entity || this;
    // Entity.applyDamageEffects (:2605): victim's Thorns retaliates once the hit landed
    if (Cb && Cb.hurt && Cb.hurt(o, amt, undefined, false, { attacker: me, source: 'mob' }) && NS.Effects && NS.Effects.thornsOnUserDamaged) NS.Effects.thornsOnUserDamaged(o, me);
  };
  /** `launchLivingEntities` (:420-436): fling away from the body centre; hurt 5.0 unless sitting/hovering. */
  ED.EnderDragonEntity.prototype.launchLivingEntities = function (list) {
    var bb = this.body.getBox(), cx = (bb.minX + bb.maxX) / 2, cz = (bb.minZ + bb.maxZ) / 2;
    for (var i = 0; i < list.length; i++) {
      var o = list[i], dx = o.x - cx, dz = o.z - cz, d = Math.max(dx * dx + dz * dz, 0.1);
      o.vx = (o.vx || 0) + dx / d * 4.0; o.vy = (o.vy || 0) + Math.fround(0.2); o.vz = (o.vz || 0) + dz / d * 4.0;
      if (!this.phaseManager.getCurrent().isSittingOrHovering() && (o.lastAttackedTime | 0) < (o.age | 0) - 2) this._hurt(o, 5.0);
    }
  };
  /** `damageLivingEntities` (:438-445): 10.0 to everything in the head/neck box. */
  ED.EnderDragonEntity.prototype.damageLivingEntities = function (list) {
    for (var i = 0; i < list.length; i++) this._hurt(list[i], 10.0);
  };
  /** `destroyBlocks(Box)` (:451-485): removes every non-air, non-fire block not in `dragon_immune`
   * (mobGriefing on); returns whether any block was left standing (immune or griefing off). */
  ED.EnderDragonEntity.prototype.destroyBlocks = function (b) {
    var W = NS.World, T = NS.Tags;
    if (!W || !W.getBlock) return false;
    var x0 = Math.floor(b.minX), y0 = Math.floor(b.minY), z0 = Math.floor(b.minZ);
    var x1 = Math.floor(b.maxX), y1 = Math.floor(b.maxY), z1 = Math.floor(b.maxZ);
    var grief = this.entity && NS.EntityList && NS.EntityList.aiCtx ? NS.EntityList.aiCtx(this.entity).mobGriefing() : true;
    var fire = T && T.blockTag ? T.blockTag('fire') : -1, imm = T && T.blockTag ? T.blockTag('dragon_immune') : -1;
    var stayed = false, broke = false;
    for (var x = x0; x <= x1; x++) for (var y = y0; y <= y1; y++) for (var z = z0; z <= z1; z++) {
      var st = W.getBlock(x, y, z);
      if (!st || (fire >= 0 && T.stateInCol(fire, st))) continue;
      if (grief && !(imm >= 0 && T.stateInCol(imm, st))) {
        W.setBlock(x, y, z, 0);
        if (NS.Save && NS.Save.record) NS.Save.record(x, y, z, 0);
        broke = true;
      } else stayed = true;
    }
    return stayed;
  };

  /** `EnderDragonEntity.getNearestPathNodeIndex()` (no-arg overload, defaults to the dragon's
   * own position) AND `getNearestPathNodeIndex(double, double, double)` (the 3-arg overload
   * `StrafePlayerPhase.setTargetEntity` calls with the TARGET's position) in one function,
   * exactly like the no-arg overload's own `.decomp` body just calls the 3-arg one with
   * `this.getX()/getY()/getZ()` -- both wrap `ED.getNearestPathNodeIndex` (above). */
  ED.EnderDragonEntity.prototype.getNearestPathNodeIndex = function (x, y, z) {
    if (x === undefined) { x = this.x; y = this.y; z = this.z; }
    var fight = this.fight;
    var aliveCrystals = fight ? fight.getAliveEndCrystals() : null;
    return ED.getNearestPathNodeIndex(this.pathNodes, x, y, z, aliveCrystals);
  };
  /** `World.getClosestPlayer(TargetPredicate, Entity, x, y, z)` stand-in -- like `getFight()`
   * above, this dragon accepts a caller-supplied player list (`this.playersFn`, ctor comment
   * above) rather than depend on a live World. Filtered by `this.canTarget(p)` (the SAME
   * dragon-specific check `crystalDestroyed()`'s own `strafePlayer` call already gates on;
   * `PLAYERS_IN_RANGE_PREDICATE`'s own attackable/visibility test is a separate, still-open
   * ED.OWED item, not invented here). Unbounded distance: `TargetPredicate.createAttackable()`'s
   * own `baseMaxDistance` defaults to -1 (no cap) -- checked in `.decomp` TargetPredicate.java,
   * not assumed. */
  ED.EnderDragonEntity.prototype.getClosestPlayer = function (x, y, z) {
    var ps = this.playersFn ? this.playersFn() : [];
    var best = null, bestD = Infinity;
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      if (!p || !this.canTarget(p)) continue;
      var d = sq(p.x - x) + sq(p.y - y) + sq(p.z - z);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  };
  /** `EnderDragonEntity.findPath(int, int, PathNode)` -- wraps `ED.findPath` (above), returning
   * an `ED.Path` (or null, matching vanilla's own nullable return when the ring is empty). */
  ED.EnderDragonEntity.prototype.findPath = function (fromIdx, toIdx, extraTarget) {
    var fight = this.fight;
    var aliveCrystals = fight ? fight.getAliveEndCrystals() : null;
    var nodes = ED.findPath(this.pathNodes, fromIdx, toIdx, aliveCrystals, extraTarget);
    return nodes ? new ED.Path(nodes) : null;
  };

  ED.EnderDragonEntity.prototype.getMaxHealth = function () { return ED.MAX_HEALTH; };
  ED.EnderDragonEntity.prototype.getHealth = function () { return this.health; };
  ED.EnderDragonEntity.prototype.setHealth = function (h) {
    this.health = Math.max(0, Math.min(h, this.getMaxHealth()));
    if (this.entity) { this.entity.health = this.health; if (this.health > 0) this.entity.dead = false; }   // #2708: Cb.hurt may have marked it dead
  };
  ED.EnderDragonEntity.prototype.isDead = function () { return this.health <= 0; };
  /** `EnderDragonEntity.parentDamage` -> `super.damage()` -- simplified to a bare health
   * subtract (ED.OWED: no invulnerability frames/armor/absorption here, LivingEntity's job). */
  ED.EnderDragonEntity.prototype.parentDamage = function (source, amount) {
    if (this.entity && source && source.hurtArgs) {   // #2708: live dragon -> the real LivingEntity pipeline (Cb.hurt, voice included)
      var a = source.hurtArgs, r = NS.Combat.hurt(this.entity, amount, a[1], a[2], a[3]);
      this.health = this.entity.health;
      return r;
    }
    this.health = Math.max(0, this.health - amount);
    this.say(this.isDead() ? 'entity.generic.death' : 'entity.ender_dragon.hurt', 5.0, 1.0);   // getSoundVolume 5.0F, pitch 1.0 (live e only)
    return true;
  };

  /** Play through the live entity's MobVoice (`d.entity`, set by tickEntity); a standalone rig is silent. */
  ED.EnderDragonEntity.prototype.say = function (ev, vol, pitch) {
    var e = this.entity;
    if (e && NS.MobVoice && NS.MobVoice.emit) NS.MobVoice.emit(e, ev, vol, pitch);
  };
  /** Client half of `tickMovement()` (:160-176: growl) + `Entity.baseTick` flap (`hasWings()` -> `addFlapEffects()`), run before the wing clock advances. */
  ED.EnderDragonEntity.prototype.tickSounds = function () {
    var r = this.random;
    if (!this.phaseManager.getCurrent().isSittingOrHovering() && --this.ticksUntilNextGrowl < 0) {
      this.say('entity.ender_dragon.growl', 2.5, 0.8 + r.nextFloat() * 0.3);
      this.ticksUntilNextGrowl = 200 + r.nextInt(200);
    }
    var TP = Math.PI * 2;
    if (Math.cos(this.prevWingPosition * TP) <= -0.3 && Math.cos(this.wingPosition * TP) >= -0.3)
      this.say('entity.ender_dragon.flap', 5.0, 0.8 + r.nextFloat() * 0.3);
  };

  /** `EnderDragonEntity.tickWithEndCrystals()` verbatim (.decomp, read whole): drop a removed
   * connectedCrystal, else heal +1 every 10 age ticks below max; then 1 tick in 10 re-pick the
   * nearest end crystal within bbox.expand(32). `this.crystalsFn` stands in for
   * `world.getNonSpectatingEntities(EndCrystalEntity.class, box)`: it is handed the dragon and
   * returns candidate crystal entities (live EL `end_crystal` entities by default). */
  ED.EnderDragonEntity.prototype.tickWithEndCrystals = function () {
    var cc = this.connectedCrystal;
    if (cc) {
      if (cc.removed) {
        this.connectedCrystal = null;
      } else if ((this.age | 0) % 10 === 0 && this.getHealth() < this.getMaxHealth()) {
        this.setHealth(this.getHealth() + 1.0);
      }
    }
    if (this.random.nextInt(10) === 0) {
      var list = this.crystalsFn ? this.crystalsFn(this) : [];
      var best = null, bestD = Number.MAX_VALUE;
      // bbox.expand(32): the dragon's own 16x8 box grown 32 on every side
      var hx = 8 + 32, hy = 8 + 32;
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.removed) continue;
        var dx = c.x - this.x, dy = c.y - this.y, dz = c.z - this.z;
        if (Math.abs(dx) > hx + 1 || Math.abs(dz) > hx + 1 || dy < -hy - 2 || dy > hy + 1) continue;
        var d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bestD) { bestD = d2; best = c; }
      }
      this.connectedCrystal = best;
    }
  };

  /** `EnderDragonEntity.crystalDestroyed(EndCrystalEntity, BlockPos, DamageSource)` (.decomp,
   * read verbatim). The connectedCrystal head-damage branch (crystal === connectedCrystal ->
   * damagePart(head, explosion, 10)) fires for real now that tickWithEndCrystals() assigns
   * connectedCrystal. The real player-pick (source.attacker, else
   * getClosestPlayer -- the SAME src.attacker shape 14j_combat.js's Cb.attackerOf uses) and the
   * unconditional phase.crystalDestroyed(...) dispatch (already ported per-phase) both run for
   * real. `pos` is the crystal's position, `source` this engine's DamageSource stand-in. */
  ED.EnderDragonEntity.prototype.crystalDestroyed = function (crystal, pos, source) {
    source = source || {};
    var player = source.attacker || this.getClosestPlayer(pos.x, pos.y, pos.z);
    if (this.connectedCrystal && crystal === this.connectedCrystal) {
      this.damagePart(this.head, { explosive: true, attacker: player }, 10.0);
    }
    this.phaseManager.getCurrent().crystalDestroyed(crystal, pos, source, player);
  };

  /** `EnderDragonEntity.damagePart(EnderDragonPart, DamageSource, float)` verbatim. */
  ED.EnderDragonEntity.prototype.damagePart = function (part, source, amount) {
    var phase = this.phaseManager.getCurrent();
    if (phase.getType().name === 'Dying') return false;
    amount = phase.modifyDamageTaken(source, amount);
    if (part !== this.head) amount = amount / 4.0 + Math.min(amount, 1.0);
    if (amount < 0.01) return false;
    if (source && (source.byPlayer || source.explosive)) {
      var before = this.health;
      this.parentDamage(source, amount);
      var current = this.phaseManager.getCurrent();
      if (this.isDead() && !current.isSittingOrHovering()) {
        this.setHealth(1);
        this.phaseManager.setPhase(ED.PHASE_TYPES.byName.Dying);
      }
      current = this.phaseManager.getCurrent();
      if (current.isSittingOrHovering()) {
        this.damageDuringSitting = this.damageDuringSitting + (before - this.health);
        if (this.damageDuringSitting > 0.25 * this.getMaxHealth()) {
          this.damageDuringSitting = 0;
          this.phaseManager.setPhase(ED.PHASE_TYPES.byName.Takeoff);
        }
      }
    }
    return true;
  };

  // -- LIVE-ENTITY BRIDGE (loop/enderdragon-wiring, ED.OWED item 1's own remaining half) -------
  // `ED.EnderDragonEntity` above is a standalone test rig (its own x/y/z/velocity, not
  // src/07i_entitylist.js's plain `e` object fields) -- this is the adapter that makes it drive
  // a REAL spawned entity: `ED.initEntity` attaches one at spawn (`EL.DEFAULTS.ender_dragon`),
  // `ED.tickEntity` copies e's live x/y/z/yaw INTO it, runs the already-ported
  // `tickMovement()`/`PhaseManager` UNCHANGED, then copies the result back onto `e`
  // (x/y/z/yaw/vx/vy/vz) -- the exact "bridging tickMovement onto a live entity" ED.OWED item 1
  // named as the one piece still missing. `EL.motionFor('ender_dragon')` returns `[0, 1]`
  // (07i_entitylist.js) specifically so `EL.tickMob`'s own generic `Ph.travelMob` step is
  // excluded for this type (see that file's own travel-law dispatch) -- this bridge is the
  // dragon's ENTIRE motion, not a supplement to it, the same "bespoke per-tick hook fully owns
  // position" shape ghast/wither already use.
  //
  // Seeded straight into HoldingPattern (skipping PhaseManager's own Hover default) because
  // there is no `EnderDragonFight` yet (ED.OWED item 2, still fully absent -- no crystal ring,
  // no portal generation, no natural End-dimension spawn placement: this dragon exists only
  // because something called `EL.spawn('ender_dragon', ...)`, e.g. `/summon`, not because a
  // fight began) -- HoldingPattern is the one phase that asks nothing of a fight beyond the
  // `getAliveEndCrystals() === 0` outer-ring skip `ED.getNearestPathNodeIndex` already handles
  // (the `fight` stand-in below reports exactly that), so it is the honest "just spawned, no
  // fight" starting phase rather than an invented one.
  ED.initEntity = function (e, opts) {
    opts = opts || {};
    var W = (typeof NS !== 'undefined') && NS.World;
    var heightAt = opts.heightAt || ((W && W.heightAt) ? W.heightAt : function () { return 63; });
    var players = opts.players || function () {
      var out = [];
      var P = (typeof NS !== 'undefined') && NS.Player;
      if (P && !P.removed && !P.dead) out.push(P);
      var EL2 = (typeof NS !== 'undefined') && NS.EntityList;
      if (EL2 && EL2.list) {
        for (var i = 0; i < EL2.list.length; i++) {
          var o = EL2.list[i];
          if (o.type === 'player' && !o.removed) out.push(o);
        }
      }
      return out;
    };
    // loop/enderdragonfight-wiring: a real ED.EnderDragonFight now backs every spawned
    // dragon instead of the old always-empty {getAliveEndCrystals: () => 0} stand-in.
    // opts.fight, if the caller already has one, is used verbatim (e.g. createDragon() below
    // already wires e.dragon.fight = this itself); otherwise a fresh ED.EnderDragonFight is
    // built from THIS SAME opts bag (opts.seed/heightAt/isBedrockAt/seaLevel/crystalsNear/
    // spawnDragon/onWorldEvent/onSpikeCollapse/discardCrystal/random -- every one of them the
    // ctor's own pre-existing caller-supplied stand-in, none invented here). Still honest: with
    // no opts.crystalsNear, respawnDragon() finds nothing (ED.OWED unchanged there), and there
    // is still no natural End-dimension spawn placement.
    var fight = opts.fight || new ED.EnderDragonFight(opts);
    var dragon = new ED.EnderDragonEntity({
      x: e.x, y: e.y, z: e.z, yaw: e.yaw || 0,
      heightAt: heightAt, players: players, fight: fight
    });
    dragon.pathNodes = ED.buildPathNodes(heightAt);
    dragon.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.HoldingPattern);
    // readCustomDataFromNbt: DragonPhase / DragonDeathTime (MobNbt copies them onto e from the save).
    if (ED.PHASE_TYPES[e.dragonPhase]) dragon.getPhaseManager().setPhase(ED.PHASE_TYPES[e.dragonPhase]);
    if (e.dragonDeathTime !== undefined) dragon.ticksSinceDeath = e.dragonDeathTime;
    // Keep the fight's own `.dragon` back-reference (the field createDragon() below also sets
    // on a respawn-triggered spawn) pointed at this real rig, so
    // ED.EnderDragonFight.prototype.crystalDestroyed's own dragon-notification branch (below)
    // has a live target even for a dragon that came from a bare /summon.
    if (fight instanceof ED.EnderDragonFight) fight.dragon = dragon;
    // loop/endcrystal-entity -- a real `end_crystal` (07zzn_endcrystal.js) has no per-
    // dragon handle of its own to read a fight off (unlike this rig, which the caller hands
    // one directly) -- the SAME single-implicit-world shape this whole port already relies
    // on (one live dragon rig, one live fight object at a time; ED.OWED already scopes a
    // real multi-dimension World as absent). `ED.getActiveFight()` below is this engine's
    // own stand-in for the real jar's `ServerWorld.getEnderDragonFight()` a crystal's
    // `damage()` reads (.decomp EndCrystalEntity.java) -- set here, the one place a real
    // fight object is ever created or received, not invented at the crystal's call site.
    if (fight instanceof ED.EnderDragonFight) ED.activeFight = fight;
    e.dragon = dragon;
    return dragon;
  };

  /** This engine's stand-in for `ServerWorld.getEnderDragonFight()` (.decomp World.java is
   * the real owner of that state; this port has no multi-dimension World, so `ED.initEntity`
   * above sets this the one time a real fight is created or attached, and it stays until
   * something else overwrites it -- honest for the one-fight-at-a-time case this engine can
   * ever actually be in, not a general multi-world registry). Read by
   * `NS.EndCrystal.damage`/`.kill` (07zzn_endcrystal.js) exactly where the jar reads
   * `getEnderDragonFight()`. */
  ED.getActiveFight = function () { return ED.activeFight || null; };

  /** One real tick: e's live x/y/z/yaw in, `ED.EnderDragonEntity.prototype.tickMovement()`
   * (PhaseManager.serverTick() + the vertical/yaw/thrust/drag motion blend, entirely unchanged
   * from the standalone rig) runs, e's x/y/z/yaw/vx/vy/vz out. Dispatched from
   * `EL.tickMob`'s own mobTick slot (07i_entitylist.js), the SAME slot `Wi.tickMovement`
   * already occupies for the wither. */
  /** Live sinks for updatePostDeath: 1028 is a GLOBAL event (WorldRenderer.processGlobalEvent) -- the roar
   *  (volume 5, pitch 1, hostile) is placed 2 blocks from the listener toward the dragon, so any distance hears it. */
  ED.deathOpts = {
    onWorldEvent: function (id, x, y, z) {
      var S = NS.Sound;
      if (id !== 1028 || !S || !S.play) return;
      var o = { source: 'hostile', volume: 5.0, pitch: 1.0, x: x, y: y, z: z };
      var L = S.listenerNow ? S.listenerNow() : null;
      if (L) {
        var dx = x - L.x, dy = y - L.y, dz = z - L.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        o.x = L.x; o.y = L.y; o.z = L.z;
        if (d > 0) { o.x += dx / d * 2; o.y += dy / d * 2; o.z += dz / d * 2; }
      }
      S.play('entity.ender_dragon.death', o);
    },
    onParticle: function (x, y, z) { if (NS.Particle && NS.Particle.spawn) NS.Particle.spawn('explosion_emitter', x, y, z, 0, 0, 0); }
  };
  ED.tickEntity = function (e) {
    if (!e.dragon) ED.initEntity(e);
    var d = e.dragon;
    d.x = e.x; d.y = e.y; d.z = e.z; d.yaw = e.yaw || 0;
    d.entity = e; d.hurtTime = e.hurtTime | 0;
    if (!d.crystalsFn) d.crystalsFn = function () {
      var EL2 = NS.EntityList, out = [];
      if (EL2 && EL2.list) for (var i = 0; i < EL2.list.length; i++) {
        if (EL2.list[i].type === 'end_crystal' && !EL2.list[i].removed) out.push(EL2.list[i]);
      }
      return out;
    };
    // ServerBossBar(entity.minecraft.ender_dragon, PINK, PROGRESS): data only, as the wither's; hidden once killed.
    e.bossBar = { name: 'Ender Dragon', percent: Math.max(0, (e.health != null ? e.health : d.health) / ED.MAX_HEALTH), color: 'pink', darkenSky: false };
    if (d.isDead() && !d.removed) {
      d.updatePostDeath(ED.deathOpts);
      e.ticksSinceDeath = d.ticksSinceDeath;
      e.x = d.x; e.y = d.y; e.z = d.z; e.yaw = d.yaw;
      e.vx = e.vy = e.vz = 0;
      if (d.removed) e.removed = true;
      return;
    }
    d.entity = e;
    d.tickMovement();
    d.tickSounds();
    e.x = d.x; e.y = d.y; e.z = d.z;
    e.yaw = d.yaw;
    var v = d.getVelocity();
    e.vx = v.x; e.vy = v.y; e.vz = v.z;
  };


  // -- ENDERDRAGONFIGHT (this slice: loop/enderdragonfight-substrate, ED.OWED item 2) ----------
  // .decomp/net/minecraft/entity/boss/dragon/EnderDragonFight.java (read whole),
  // .decomp/net/minecraft/entity/boss/dragon/EnderDragonSpawnState.java (read whole), and the
  // crystal-ring formula off .decomp/net/minecraft/world/gen/feature/EndSpikeFeature.java's own
  // SpikeCache.load() it depends on (read whole). ServerWorld/chunk-ticket/NBT/BossBar/block-
  // placement/explosion machinery is out of this port -- this engine models no ServerWorld, no
  // chunk-ticket system, and (07l_spawn.js's own "this engine has no End dimension" comment,
  // unchanged) no End dimension at all, and worldgen/rendering are this project's own stated
  // non-parity area -- so every one of those becomes a caller-supplied opts stand-in, the SAME
  // "accept a stand-in rather than depend on World" shape opts.fight/opts.heightAt/opts.players
  // already use throughout this file, rather than an invented substitute. What IS real and
  // verbatim: the crystal ring's own 10-position layout/radius/height/guarded formula
  // (EndSpikeFeature.SpikeCache, a pure seeded shuffle -- no block writes needed to compute it),
  // generateEndPortal()'s exit-portal Y search (getTopPosition then descend while bedrock), the
  // FULL EnderDragonSpawnState state machine's own real branch conditions and timer thresholds
  // (tick 0/50/51/52/95+, the 100-tick wait, the 40-tick-per-spike x10 cycle, the 0/5/80/100
  // collapse thresholds), respawnDragon()'s real 3-guard gate (already killed, no sequence
  // already running, all 4 crystal groups found), and createDragon()'s real (0,128,0)/random-
  // yaw/HoldingPattern spawn -- only the world-mutating PAYLOAD of each branch (syncWorldEvent,
  // block removal, explosion, EndSpikeFeature regen, an actual live-entity spawn) is a stand-in
  // callback, never invented, never skipped.
  //
  // Genuinely out of scope, named rather than guessed: the true FIRST-EVER natural spawn on a
  // brand-new world (vanilla's dragonKilled=true -> convertFromLegacy()'s own
  // "!previouslyKilled && dragonKilled -> dragonKilled=false" flip, which then leans on whatever
  // worldgen feature places the very first dragon into a freshly generated End island -- that
  // feature is not among the files read for this slice, and this engine has no End dimension for
  // it to place one INTO regardless); still ED.OWED, unchanged by this pass. What this pass DOES
  // give a real, repeatable "natural spawn sequence" for is the documented vanilla respawn
  // mechanic every player actually uses post-kill: place 4 end crystals near the exit portal,
  // and the SAME real EnderDragonSpawnState choreography this class runs now culminates in a
  // real createDragon() call.
  //
  // `EnderDragonSpawnState`'s own 5 enum constants have NO Yarn-friendly name in .decomp (they
  // are field_13097/field_13095/field_13094/field_13098/field_13099, names.tsv:39699-39703) --
  // named descriptively here (ED.SPAWN_STATE_NAMES) from each state's own run() body, not
  // guessed real identifiers.
  ED.SPAWN_STATE_NAMES = ['beamToCenter', 'wait100', 'spikeRebuildCycle', 'collapseRing', 'spawned'];

  /** `EndSpikeFeature.SpikeCache.load()` (.decomp, read verbatim) -- the dragon fight's 10-
   * crystal ring. `getSpikes(world)` first does `new Random(seed).nextLong() & 65535` to pick a
   * cache key: a `nextLong()` is two `next(32)` calls added as `(high << 32) + low`, and since
   * `high << 32` is a multiple of 2^32 it contributes NOTHING to the low 16 bits the `& 65535`
   * keeps -- so this port skips the discarded high word rather than build a real 64-bit
   * `nextLong`, and takes the second `next(32)`'s own low 16 bits directly (`& 0xFFFF`, which is
   * exactly bitwise-correct on a signed 32-bit int regardless of sign). `new Random(key)` then
   * Java-shuffles the 10 spike indices -- `java.util.Collections.shuffle`'s own real algorithm
   * (from i = size down to 2, swap(i-1, rnd.nextInt(i))), NOT a generic Fisher-Yates -- and zips
   * the shuffled index onto each of the 10 fixed ring angles (`floor(42*cos/sin(...))`,
   * `radius = 2 + idx/3`, `height = 76 + idx*3`, `guarded = idx===1 || idx===2`). Returns 10
   * `{x, z, radius, height, guarded, alive}` rows -- `alive` is this port's OWN bookkeeping
   * field (real vanilla tracks crystal liveness on the `EndCrystalEntity` itself, which this
   * engine does not model), seeded `true`. */
  ED.buildCrystalRing = function (seed) {
    var LR = NS.Noise && NS.Noise.LegacyRandom;
    if (!LR) return null;
    var r = new LR(seed);
    r.next(32);                       // nextLong()'s high word -- unused, see comment above
    var key = r.next(32) & 0xFFFF;
    var sr = new LR(key);
    var ids = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    for (var i = ids.length; i > 1; i--) {
      var j = sr.nextInt(i);
      var t = ids[i - 1]; ids[i - 1] = ids[j]; ids[j] = t;
    }
    var out = [];
    for (var n = 0; n < 10; n++) {
      var x = Math.floor((42.0) * Math.cos(2.0 * (-Math.PI + (Math.PI / 10) * n)));
      var z = Math.floor(42.0 * Math.sin(2.0 * (-Math.PI + (Math.PI / 10) * n)));
      var idx = ids[n];
      out.push({
        x: x, z: z,
        radius: 2 + Math.floor(idx / 3),
        height: 76 + idx * 3,
        guarded: (idx === 1 || idx === 2),
        alive: true
      });
    }
    return out;
  };

  /** `EnderDragonFight.generateEndPortal()`'s own exit-portal LOCATION search (.decomp, read
   * verbatim) -- `world.getTopPosition(Heightmap.Type, EndPortalFeature.ORIGIN).down()`, then
   * descend one block at a time while the block there is bedrock AND still above sea level.
   * Only the LOCATION is real vanilla logic here; `EndPortalFeature.generateIfValid`'s own
   * block-placement payload (the actual portal-frame blocks) is worldgen, this project's own
   * stated non-parity area, so it is not built -- `opts.isBedrockAt(x, y, z)` (default: always
   * false, i.e. no bedrock in the way, the common case) and `opts.heightAt(x, z)` are caller-
   * supplied stand-ins, the exact shape `ED.buildPathNodes` already takes `heightAt` as. */
  ED.computeExitPortalLocation = function (opts) {
    opts = opts || {};
    var heightAt = opts.heightAt || function () { return 63; };
    var isBedrockAt = opts.isBedrockAt || function () { return false; };
    var seaLevel = opts.seaLevel != null ? opts.seaLevel : 63;
    var y = heightAt(0, 0) - 1; // getTopPosition(...).down()
    while (isBedrockAt(0, y, 0) && y > seaLevel) y--;
    return { x: 0, y: y, z: 0 };
  };

  /**
   * `EnderDragonFight` (.decomp, read whole) -- a real fight-state object: the crystal ring
   * (`ED.buildCrystalRing`, above), the exit-portal location, `getAliveEndCrystals()` (the exact
   * method `ED.EnderDragonEntity.getFight()` callers already read -- a fight built here feeds
   * this project's own HoldingPattern/StrafePlayer ring logic REAL crystal-liveness data,
   * instead of only the always-empty `{getAliveEndCrystals: () => 0}` stand-in `ED.initEntity`
   * still falls back to when no fight is supplied), `crystalDestroyed()` (the real abort-
   * respawn-sequence branch), and `respawnDragon()` / the full `EnderDragonSpawnState` timer
   * sequence culminating in a real `createDragon()`.
   *
   * `opts.seed` seeds the crystal ring (falls back to `Date.now()`); `opts.heightAt`/
   * `opts.isBedrockAt`/`opts.seaLevel` are the exit-portal-location stand-ins above;
   * `opts.crystalsNear(pos, radius)` is the "find live crystals within `radius` blocks of
   * `pos`" stand-in `respawnDragon()` needs for its own real 4-direction gather -- there is no
   * default that synthesizes an answer (the real mechanic requires a PLAYER to have placed 4
   * end crystals near the portal after a kill, entity-AABB-query territory this engine's caller
   * must supply; omitting it just means `respawnDragon()` honestly finds none, matching
   * vanilla's own behaviour before anyone has placed crystals, rather than inventing a same-
   * tick auto-respawn); `opts.spawnDragon(x, y, z, yaw)` is the caller-supplied "actually put a
   * dragon in the world" hook (this engine's own `NS.EntityList.spawn('ender_dragon', ...)` is
   * the obvious real caller -- wiring THAT is a separate future item, named on ED.OWED below);
   * `opts.onWorldEvent`/`opts.onSpikeCollapse`/`opts.discardCrystal` are the
   * particle/block/explosion/despawn payload stand-ins the spawn-state machine's own real
   * branches call at the real tick thresholds (never invented, never skipped).
   */
  ED.EnderDragonFight = function (opts) {
    opts = opts || {};
    this.opts = opts;
    this.crystals = ED.buildCrystalRing(opts.seed != null ? opts.seed : ED.seedNow());
    this._spawnCrystalRing();
    this.exitPortalLocation = opts.exitPortalLocation || ED.computeExitPortalLocation(opts);
    this.dragonKilled = opts.dragonKilled !== undefined ? opts.dragonKilled : true;
    this.previouslyKilled = !!opts.previouslyKilled;
    this.dragonSpawnStateIndex = -1;   // -1 == vanilla's null dragonSpawnState (no respawn running)
    this.spawnStateTimer = 0;
    this.spawnCrystals = null;
    // gateways: Collections.shuffle(0..19, new Random(seed)) -- the java.util shuffle, as in buildCrystalRing.
    this.gateways = [];
    for (var gi = 0; gi < 20; gi++) this.gateways.push(gi);
    var LR = NS.Noise && NS.Noise.LegacyRandom;
    if (LR) {
      var gr = new LR(opts.seed != null ? opts.seed : ED.seedNow());
      for (var gn = 20; gn > 1; gn--) { var gj = gr.nextInt(gn); var gt = this.gateways[gn - 1]; this.gateways[gn - 1] = this.gateways[gj]; this.gateways[gj] = gt; }
    }
    this.dragon = null;                // the live entity/rig this fight last created, once any exists
  };

  /** D-838 (this pass) -- real crystal SPAWN: `EndSpikeFeature.generateSpike()`'s own
   * crystal-placement tail (.decomp, read verbatim): `EndCrystalEntity $19 =
   * EntityType.END_CRYSTAL.create(world); $19.setBeamTarget(config.getPos());
   * $19.setInvulnerable(config.isCrystalInvulnerable()); $19.refreshPositionAndAngles(
   * centerX+0.5, height+1, centerZ+0.5, randomYaw, 0); world.spawnEntity($19);` -- called once
   * per spike, from WORLDGEN (a placed feature run when that spike's own chunk generates), NOT
   * from `EnderDragonFight` itself: `EnderDragonFight.java` (.decomp, read whole) has NO
   * `EntityType.END_CRYSTAL.create`/`spawnEntity` call anywhere in its own class body -- the
   * only two real call sites are `EndSpikeFeature.generateSpike()` (the natural first spawn,
   * above) and, separately, `EnderDragonSpawnState`'s own respawn-cutscene re-crystal step
   * (EnderDragonSpawnState.java:72's own `new EndSpikeFeatureConfig(true, [spike], (0,128,0))`
   * -- a DIFFERENT config, a different call site, out of scope for this unit, ED.OWED unchanged
   * on it). This engine has no per-chunk End-dimension worldgen to hang the real natural-spawn
   * trigger off at all (ED.OWED already scopes "the true first-ever natural spawn" as absent for
   * exactly that reason) -- `ED.EnderDragonFight`'s own construction (the ONE moment this
   * engine ever builds a crystal ring, `opts.fight || new ED.EnderDragonFight(opts)` in
   * `ED.initEntity` below) is the closest real analogue available to "the spikes' chunks just
   * generated" without inventing chunk-based feature placement, so THIS is where the real spawn
   * call is wired -- for the SAME reason `EndConfiguredFeatures.END_SPIKE`'s own registered
   * config is `new EndSpikeFeatureConfig(false, [], null)` (.decomp EndConfiguredFeatures.java,
   * read verbatim) -- crystalInvulnerable=false, crystalBeamTarget=null -- every crystal this
   * method spawns gets NO beamTarget and NO invulnerability, exactly like a real natural first
   * spawn (never an invented beamTarget-setting AI, out of scope per this unit's own brief).
   * `EL.DEFAULTS.end_crystal` (07i_entitylist.js) already seeds `beamTarget: null` on every
   * spawn and `EL.spawn` never sets `e.invulnerable` at all, so a spawned crystal is
   * falsy-invulnerable by construction -- matching `isCrystalInvulnerable() === false` verbatim
   * with no extra opts needed. Cosmetic-only fields the real ctor also rolls (`endCrystalAge`, a
   * random yaw) are left at `EL.spawn`'s own existing zero defaults, the SAME "changes nothing
   * observable, so not rolled" precedent `EL.DEFAULTS.end_crystal`'s own `endCrystalAge = 0`
   * comment already sets for this exact entity type -- not invented here, just followed. Position
   * is the real jar's own `centerX+0.5, height+1, centerZ+0.5` (row.x/row.z are
   * `ED.buildCrystalRing`'s own centerX/centerZ, row.height its own spike-top height field --
   * both already verbatim off `EndSpikeFeature.SpikeCache`). `NS.EntityList` is a real,
   * caller-independent spawner already in this engine (unlike a full World, which the dragon's
   * own `opts.spawnDragon` stand-in exists to paper over) -- called directly, no caller hook
   * needed, and a no-op (never throws) when `EL` is not loaded/ready, the SAME shape every other
   * optional-substrate read in this file already uses. */
  ED.EnderDragonFight.prototype._spawnCrystalRing = function () {
    var EL = NS.EntityList;
    if (!EL || !EL.ready || !EL.spawn) return;
    for (var i = 0; i < this.crystals.length; i++) {
      var row = this.crystals[i];
      EL.spawn('end_crystal', row.x + 0.5, row.height + 1, row.z + 0.5, {});
      this._realRing = true;
    }
  };

  /** `EnderDragonFight.countAliveCrystals()`: sum over spikes of the live end_crystal entities in
   * the spike's full-height X/Z column. Reads live entities whenever the ring was spawned for real
   * (`_realRing`); the synthetic `alive` rows only answer when no entity substrate exists. */
  ED.EnderDragonFight.prototype.getAliveEndCrystals = function () {
    var EL = NS.EntityList;
    if (this._realRing && EL && EL.all) {
      var live = EL.all(), c = 0;
      for (var j = 0; j < live.length; j++) {
        var e = live[j];
        if (e.type !== 'end_crystal' || e.removed || e.dead) continue;
        for (var k = 0; k < this.crystals.length; k++) {
          var r = this.crystals[k];
          if (Math.abs(e.x - r.x - 0.5) <= r.radius + 0.5 && Math.abs(e.z - r.z - 0.5) <= r.radius + 0.5) { c++; break; }
        }
      }
      return c;
    }
    var n = 0;
    for (var i = 0; i < this.crystals.length; i++) if (this.crystals[i].alive) n++;
    return n;
  };

  /** `EnderDragonFight.dragonKilled(EnderDragonEntity)`'s state flips (named onDragonKilled: the
   * field `dragonKilled` already holds the boolean). Portal/egg placement is `opts.onDragonKilled`. */
  ED.EnderDragonFight.prototype.onDragonKilled = function (dragon) {
    this.dragonKilled = true;
    var first = !this.previouslyKilled;
    this.previouslyKilled = true;
    if (this.opts.onDragonKilled) this.opts.onDragonKilled(dragon, first);
    else this.placeKillBlocks(first);
  };

  /** `dragonKilled`'s world payload (.decomp, read verbatim): generateEndPortal(true)
   * (EndPortalFeature, open), generateNewEndGateway() (EndGatewayFeature, delayed: no exit pos),
   * and on the first kill the dragon egg on top of the portal's torch pillar
   * (getTopPosition(MOTION_BLOCKING, ORIGIN)). Writes through NS.World; no-op without it. */
  ED.EnderDragonFight.prototype.placeKillBlocks = function (first) {
    var W = NS.World, R = NS.Reg, B = NS.Behaviour;
    if (!W || !W.setBlock || !R || !R.names) return;
    var st = function (n) { var b = R.names.indexOf(n); return R.realFirst[b] + R.defaultState[b]; };
    var put = function (x, y, z, n) { W.setBlock(x, y, z, st(n)); };
    var o = this.exitPortalLocation, ox = o.x, oy = o.y, oz = o.z;
    for (var x = ox - 4; x <= ox + 4; x++) for (var y = oy - 1; y <= oy + 32; y++) for (var z = oz - 4; z <= oz + 4; z++) {
      var d2 = (x - ox) * (x - ox) + (y - oy) * (y - oy) + (z - oz) * (z - oz);
      var inner = d2 <= 6.25;
      if (!inner && d2 > 12.25) continue;
      if (y < oy) put(x, y, z, inner ? 'bedrock' : 'end_stone');
      else if (y > oy) put(x, y, z, 'air');
      else put(x, y, z, inner ? 'end_portal' : 'bedrock');
    }
    for (var i = 0; i < 4; i++) put(ox, oy + i, oz, 'bedrock');
    var dirs = [['north', 0, -1], ['south', 0, 1], ['west', -1, 0], ['east', 1, 0]];
    for (var k = 0; k < 4; k++) {
      var t = st('wall_torch');
      if (B && B.setProp) t = B.setProp(t, 'facing', dirs[k][0]);
      W.setBlock(ox + dirs[k][1], oy + 2, oz + dirs[k][2], t);
    }
    if (this.gateways && this.gateways.length) {
      var gi = this.gateways.pop();
      var gx = Math.floor(96.0 * Math.cos(2.0 * (-Math.PI + (Math.PI / 20) * gi)));
      var gz = Math.floor(96.0 * Math.sin(2.0 * (-Math.PI + (Math.PI / 20) * gi)));
      for (var a = -1; a <= 1; a++) for (var b = -2; b <= 2; b++) for (var c = -1; c <= 1; c++) {
        var cx = a === 0, cy = b === 0, cz = c === 0, ey = Math.abs(b) === 2, n;
        if (cx && cy && cz) n = 'end_gateway';
        else if (cy) n = 'air';
        else if (ey && cx && cz) n = 'bedrock';
        else if ((cx || cz) && !ey) n = 'bedrock';
        else n = 'air';
        put(gx + a, 75 + b, gz + c, n);
      }
    }
    if (first) put(ox, oy + 4, oz, 'dragon_egg');
  };
  ED.EnderDragonFight.prototype.hasPreviouslyKilled = function () { return this.previouslyKilled; };

  /** `EnderDragonFight.crystalDestroyed()` (.decomp, read verbatim) -- if a respawn sequence is
   * running AND the destroyed crystal is one of THAT sequence's own gathered crystals, the whole
   * sequence aborts (real branch, ported exactly, real vanilla's own `resetEndCrystals()` call
   * on this branch has no analogue here since it only clears invulnerability/beam-target state
   * this port's bare `{x,z,radius,height,guarded,alive}` rows do not carry); otherwise this is
   * just the ring's own alive-bookkeeping (`countAliveCrystals()` stand-in -- this port tracks
   * `alive` directly rather than re-scan a world). The live-dragon notification
   * (`EnderDragonEntity.crystalDestroyed`) is a separate call site
   * (`ED.EnderDragonEntity.prototype.crystalDestroyed`, already ported), not this method's job.
   *
   * D-835 (this pass) -- reconciling the ring's synthetic `alive` bookkeeping with a REAL live
   * `end_crystal` entity (src/07zzn_endcrystal.js's `EC.crystalDestroyed` passes the actual
   * entity object here, never one of `ED.buildCrystalRing`'s own synthetic rows, so a plain
   * `this.crystals.indexOf(crystal)` reference lookup always missed and a real crystal kill
   * silently never flipped its row's flag). Vanilla itself has NO per-slot identity match at
   * all here -- `EnderDragonFight.crystalDestroyed`'s own else-branch calls `countAliveCrystals()`,
   * which re-derives the WHOLE alive count from scratch by testing `world.getNonSpectatingEntities
   * (EndCrystalEntity.class, spike.getBoundingBox())` per `EndSpikeFeature.Spike` -- and that
   * `Box` (.decomp `EndSpikeFeature.java`'s `Spike` constructor, read verbatim) is exactly a
   * full-world-height COLUMN keyed on X/Z: `[centerX-radius, centerX+radius] x [centerZ-radius,
   * centerZ+radius]`, matching `ED.buildCrystalRing`'s own `{x,z,radius}` fields verbatim. So a
   * synthetic row (passed by reference, this port's own existing calling convention) still
   * matches by identity first; a REAL entity that misses the identity check is now correlated
   * to its row by that SAME real column test, not an invented nearest-position heuristic. */
  ED.EnderDragonFight.prototype._ringIndexForCrystal = function (crystal) {
    var idx = this.crystals.indexOf(crystal);
    if (idx >= 0) return idx;
    if (!crystal || typeof crystal.x !== 'number' || typeof crystal.z !== 'number') return -1;
    for (var i = 0; i < this.crystals.length; i++) {
      var row = this.crystals[i];
      if (Math.abs(crystal.x - row.x) <= row.radius && Math.abs(crystal.z - row.z) <= row.radius) return i;
    }
    return -1;
  };

  ED.EnderDragonFight.prototype.crystalDestroyed = function (crystal, source) {
    var idx = this._ringIndexForCrystal(crystal);
    if (idx >= 0) this.crystals[idx].alive = false;
    if (idx >= 0 && this._realRing && this.crystals.indexOf(crystal) >= 0) {
      // a synthetic row passed by reference stands for the real crystal in its column: remove it
      var EL = NS.EntityList, row = this.crystals[idx];
      if (EL && EL.all) {
        var all = EL.all();
        for (var j = 0; j < all.length; j++) {
          var e = all[j];
          if (e.type === 'end_crystal' && !e.removed && Math.abs(e.x - row.x - 0.5) <= row.radius + 0.5 && Math.abs(e.z - row.z - 0.5) <= row.radius + 0.5) { EL.remove(e); break; }
        }
      }
    }
    if (this.dragonSpawnStateIndex >= 0 && this.spawnCrystals && this.spawnCrystals.indexOf(crystal) >= 0) {
      this.dragonSpawnStateIndex = -1;
      this.spawnStateTimer = 0;
      this.spawnCrystals = null;
    } else if (this.dragon && this.dragon.crystalDestroyed) {
      // loop/enderdragonfight-wiring: the real else-branch notification .decomp's own
      // EnderDragonFight.crystalDestroyed() makes (countAliveCrystals() +
      // ((EnderDragonEntity)dragonEntity).crystalDestroyed(...)), reaching
      // this.dragon.crystalDestroyed -> ED.EnderDragonEntity.prototype.crystalDestroyed (above)
      // -> the current phase's own crystalDestroyed() for real, not a stub. `this.dragon` is
      // set at construction time (ED.initEntity for a /summoned dragon, or createDragon()
      // below for a real respawn) -- a bare fight with no dragon yet is a no-op, matching
      // vanilla's own `world.getEntity(dragonUuid) instanceof EnderDragonEntity` guard.
      // loop/endcrystal-entity -- `crystal.height` was this port's OWN ring-row field name
      // (`ED.buildCrystalRing`'s own `{x,z,radius,height,guarded,alive}` shape) standing in
      // for the real jar's own `getBlockPos()` Y before any live crystal existed to ask; a
      // REAL `end_crystal` entity (07zzn_endcrystal.js) carries its Y as `.y` like every
      // other spawned entity in this engine, not `.height` (that field means bounding-box
      // height on a live entity, D-336) -- checked here rather than assumed, so a real
      // entity's true elevation reaches `getClosestPlayer` correctly instead of silently
      // reading `undefined` off a field it never carries.
      var posY = (crystal.height !== undefined) ? crystal.height : crystal.y;
      var pos = { x: crystal.x, y: posY, z: crystal.z };
      this.dragon.crystalDestroyed(crystal, pos, source || {});
    }
  };

  /** `EnderDragonFight.respawnDragon()` + its private `respawnDragon(List)` overload (.decomp,
   * read verbatim, both) -- the SAME 3 real guards vanilla checks (already `dragonKilled`, no
   * sequence already running, all 4 direction-groups found), the SAME 4-cardinal-direction, 2-
   * block-radius gather around the block directly above the exit portal, ALL 3 real failure
   * exits doing nothing, exactly like vanilla (this ports the real "no shortcuts" shape, not a
   * simplified always-succeeds stand-in). On success starts the real state machine at state 0. */
  /** Default gather: `world.getNonSpectatingEntities(EndCrystalEntity.class, new Box(blockPos))`
   * -- live end_crystal entities whose 2x2 bounding box overlaps the unit cell at `pos`. */
  ED.liveCrystalsInCell = function (pos) {
    var EL = NS.EntityList, out = [];
    if (!EL || !EL.list) return out;
    for (var i = 0; i < EL.list.length; i++) {
      var c = EL.list[i];
      if (!c || c.type !== 'end_crystal' || c.removed) continue;
      if (c.x - 1 < pos.x + 1 && c.x + 1 > pos.x && c.y < pos.y + 1 && c.y + 2 > pos.y &&
          c.z - 1 < pos.z + 1 && c.z + 1 > pos.z) out.push(c);
    }
    return out;
  };

  ED.EnderDragonFight.prototype.respawnDragon = function () {
    if (!this.dragonKilled || this.dragonSpawnStateIndex >= 0) return false;
    var near = this.opts.crystalsNear || ED.liveCrystalsInCell;
    var above = { x: this.exitPortalLocation.x, y: this.exitPortalLocation.y + 1, z: this.exitPortalLocation.z };
    var dirs = [{ x: 2, z: 0 }, { x: -2, z: 0 }, { x: 0, z: 2 }, { x: 0, z: -2 }];
    var found = [];
    for (var d = 0; d < dirs.length; d++) {
      var pos = { x: above.x + dirs[d].x, y: above.y, z: above.z + dirs[d].z };
      var got = near(pos, 2);
      if (!got || !got.length) return false;
      for (var g = 0; g < got.length; g++) found.push(got[g]);
    }
    this.spawnCrystals = found;
    this.dragonSpawnStateIndex = 0;
    this.spawnStateTimer = 0;
    return true;
  };

  /** `EnderDragonFight.setSpawnState()` (.decomp, read verbatim) -- resets the timer for every
   * transition, and on the terminal state (`field_13099`) discards the 4 ceremony crystals
   * (`opts.discardCrystal` stand-in for the real explode+discard), clears `dragonKilled`, and
   * calls the real `createDragon()` below, exactly like vanilla's own terminal branch. */
  ED.EnderDragonFight.prototype._setSpawnState = function (next) {
    this.spawnStateTimer = 0;
    if (next === 4) {
      var discard = this.opts.discardCrystal;
      if (discard && this.spawnCrystals) {
        for (var i = 0; i < this.spawnCrystals.length; i++) discard(this.spawnCrystals[i]);
      }
      this.dragonSpawnStateIndex = -1;
      this.dragonKilled = false;
      this.spawnCrystals = null;
      this.dragon = this.createDragon();
    } else {
      this.dragonSpawnStateIndex = next;
    }
  };

  /** `EnderDragonFight.tick()`'s own `this.dragonSpawnState.run(world, this, crystals,
   * this.spawnStateTimer++, exitPortalLocation)` call site, plus every `EnderDragonSpawnState`
   * enum constant's own `run()` body (.decomp, both read verbatim) -- ONE call per fight tick.
   * `t` is read then the timer is incremented BEFORE the state body runs, mirroring the real
   * post-increment-as-argument evaluation order (a state that transitions overwrites the just-
   * incremented value via `_setSpawnState`'s own reset, exactly like vanilla's `spawnStateTimer
   * = 0` inside `setSpawnState` clobbers the same post-increment before the next tick reads it).
   * Real timer thresholds throughout: state 0 fires once then advances; state 1 waits exactly
   * 100 ticks (`opts.onWorldEvent` at t = 0/50/51/52/95..99); state 2 runs a 40-tick cycle per
   * ring crystal for all 10 (t%40===0 re-beams to that crystal's own spike, t%40===39 collapses
   * it via `opts.onSpikeCollapse`, and advances once past the 10th at t=400); state 3 collapses
   * at t===0, t<5, and t>=80 (`opts.onWorldEvent`) then, at t>=100, discards the ceremony
   * crystals and calls the FINAL `_setSpawnState(4)` -- real dragon creation. */
  ED.EnderDragonFight.prototype.tick = function () {
    if (this.dragonSpawnStateIndex < 0) return;
    var t = this.spawnStateTimer;
    this.spawnStateTimer++;
    var onWorldEvent = this.opts.onWorldEvent || function () {};
    var onSpikeCollapse = this.opts.onSpikeCollapse || function () {};
    switch (this.dragonSpawnStateIndex) {
      case 0:
        this._setSpawnState(1);
        break;
      case 1:
        if (t < 100) {
          if (t === 0 || t === 50 || t === 51 || t === 52 || t >= 95) onWorldEvent(t);
        } else {
          this._setSpawnState(2);
        }
        break;
      case 2: {
        var cycle = 40, atStart = (t % cycle === 0), atEnd = (t % cycle === cycle - 1);
        if (atStart || atEnd) {
          var spikeIdx = Math.floor(t / cycle);
          if (spikeIdx < this.crystals.length) {
            if (atEnd) onSpikeCollapse(this.crystals[spikeIdx], spikeIdx);
            // atStart's own real payload is a beam-target re-point at the spike -- no beam-
            // target field on this port's crystal rows (see ED.buildCrystalRing's own comment).
          } else if (atStart) {
            this._setSpawnState(3);
          }
        }
        break;
      }
      case 3:
        if (t >= 100) {
          this._setSpawnState(4);
        } else if (t >= 80) {
          onWorldEvent(t);
        } else if (t < 5) {
          onWorldEvent(t);
        }
        break;
      default:
        break; // state 4 ("spawned") is terminal -- .decomp's own run() body is empty too
    }
  };

  /** `EnderDragonFight.createDragon()` (.decomp, read verbatim) -- `(0, 128, 0)`, a real random
   * yaw, `PhaseType.HoldingPattern` (`field_7069`, .decomp/names.tsv:25969 -- confirmed
   * `HoldingPattern` by `PhaseType.java`'s own registration order, `ED.PHASE_TYPES.byName`
   * above). `opts.spawnDragon(x, y, z, yaw)` is the caller-supplied "put a live entity in the
   * world" hook -- this port has no World to call `EntityType.ENDER_DRAGON.create(world)`/
   * `spawnEntity` on itself; without one supplied this returns a bare `ED.EnderDragonEntity` rig
   * (this file's own existing standalone-rig shape, still real position/phase/fight-wiring, just
   * not registered into any entity list -- wiring a real `NS.EntityList.spawn('ender_dragon',
   * ...)` call in here is a separate future item, ED.OWED below). */
  ED.EnderDragonFight.prototype.createDragon = function () {
    var LR = NS.Noise && NS.Noise.LegacyRandom;
    var rand = this.opts.random || (LR ? new LR(ED.seedNow()) : { nextFloat: function () { return Math.random(); } });
    var yaw = rand.nextFloat() * 360.0;
    if (this.opts.spawnDragon) {
      var e = this.opts.spawnDragon(0, 128, 0, yaw);
      if (e && e.dragon) {
        e.dragon.fight = this;
        e.dragon.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.HoldingPattern);
      }
      return e;
    }
    var heightAt = this.opts.heightAt || function () { return 63; };
    var dragon = new ED.EnderDragonEntity({
      x: 0, y: 128, z: 0, yaw: yaw, fight: this, heightAt: heightAt, players: this.opts.players
    });
    dragon.pathNodes = ED.buildPathNodes(heightAt);
    dragon.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.HoldingPattern);
    return dragon;
  };

  ED.init = function () { ED.ready = true; return ED; };
  ED.init();
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
