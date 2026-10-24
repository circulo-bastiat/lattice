// src/07zzc_lightning.js — loop/lightning: LightningEntity + the skeleton-horse thunder trap.
//
// `ServerWorld.tickChunk`'s own "thunder" block (.decomp/net/minecraft/server/world/
// ServerWorld.java:391-416, read in full) and `LightningEntity` itself (.decomp/net/minecraft/
// entity/LightningEntity.java, read whole): the once-per-chunk-per-tick 1-in-100000 roll while
// raining+thundering, the struck-position search (`getLightningPos`), the bolt's own
// ambient-tick/fire/struck-entity bookkeeping, and — off the SAME roll — the doMobSpawning-gated
// `skeleton_horse` "trap" spawn. `SkeletonHorseEntity`/`SkeletonHorseTrapTriggerGoal` (.decomp/
// net/minecraft/entity/{mob/SkeletonHorseEntity,ai/goal/SkeletonHorseTrapTriggerGoal}.java, both
// read whole) are the other half: a player within 10 blocks springs the ambush.
//
// `onStruckByLightning` per-type overrides (all four read whole this pass): `Entity.
// onStruckByLightning` (.decomp/net/minecraft/entity/Entity.java:2100-2106, the generic 5-damage
// + 8s-fire default), `CreeperEntity` (charged flag), `MooshroomEntity`/`Mo.onLightning`
// (07zn_mooshroom.js, already built and waiting for a live caller — its own OWED said so),
// `PigEntity`/`VillagerEntity` (convert to zombified_piglin/witch, difficulty-gated).
(function (NS) {
  'use strict';
  var Lgt = NS.Lightning = {};

  Lgt.OWED = [
    // s128 struck 'getLightningRodPos' and 'powerLightningRod/cleanOxidation': the rod redirect
    // (Lgt.getLightningRodPos, off 07zu_poi.js's new LIGHTNING_ROD type), the rod's 8-tick pulse
    // (Lgt.setRodPowered / Lgt.rodScheduledTick, Rs's lightning_rod branch) and the copper ring
    // (07zzd_oxidize.js). What is left of those two lines:
    // D-664 struck 'syncWorldEvent 3002 -- the ELECTRIC_SPARK particles along the rod and on each
    // cleaned copper block': Px.worldEvent (07zx_particle.js), GlowParticle + the glow sprite.
    // G21/s130: struck 'LocalDifficulty.getLocalDifficulty() ... no model' -- Eq.localDifficulty
    // (07y_equip.js) is the real formula now; only its inhabited-time input is owed (Eq.OWED).
    // s116: struck -- the 4 skeletons SkeletonHorseTrapTriggerGoal spawns now `Rd.startRiding`
    // their horses (Lgt.mountTrapRider), the trap horse itself included (.decomp:39-41 read
    // whole -- `this.getSkeleton($$1, this.skeletonHorse)` rides `this.skeletonHorse` too).
    'Criteria.LIGHTNING_STRIKE/CHANNELED_LIGHTNING advancement triggers -- no advancement system ' +
      'exists to fire them into'
    // #7988: STRUCK, not owed -- LightningEntity.readCustomDataFromNbt/writeCustomDataToNbt are EMPTY
    // in 1.18.2 (.decomp LightningEntity.java:252-258), so vanilla drops a live bolt on reload and
    // /summon lightning_bolt has no bolt NBT to honour. 07zw_mobnbt.js deliberately has no row (#5269).
  ];

  // ── local difficulty (Eq.OWED's own collapse, reused rather than duplicated) ────────────────
  /** `ServerWorld.getLocalDifficulty(pos).getLocalDifficulty()` -- the raw value (Eq.localDifficulty). */
  Lgt.approxLocalDifficulty = function (pos) {
    var Eq = NS.Equip;
    return Eq && Eq.localDifficulty ? Eq.localDifficulty(Eq.at ? Eq.at(pos) : undefined) : 1;   // the real raw LocalDifficulty (07y_equip.js)
  };

  function isPlayerInRange(x, y, z, dist) {
    var P = NS.Player;
    if (!P || P.x === undefined || P.dead) return false;
    var dx = P.x - x, dy = P.y - y, dz = P.z - z;
    return (dx * dx + dy * dy + dz * dz) <= dist * dist;
  }

  // ═══════════════════════════ § THE BOLT ITSELF ═════════════════════════════════════════════

  /** `LightningEntity.spawnFire` (.decomp:196-211) — never for a cosmetic bolt, never off the
   *  doFireTick gamerule (`Commands.ruleGet`, the live-reader every other consumer uses). */
  Lgt.spawnFire = function (e, extra) {
    if (!e || e.cosmetic) return;
    var C = NS.Commands, B = NS.Behave, W = NS.World, S = NS.States;
    if (C && C.ruleGet && String(C.ruleGet('doFireTick')) === 'false') return;
    if (!B || !B.fireCanSurvive || !W || !S) return;
    var rnd = NS.EntityList ? (NS.EntityList.random || NS.wrand) : NS.wrand;
    var bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
    placeOne(bx, by, bz);
    for (var i = 0; i < extra; i++) {
      placeOne(bx + Math.floor(rnd() * 3) - 1, by + Math.floor(rnd() * 3) - 1, bz + Math.floor(rnd() * 3) - 1);
    }
    function placeOne(x, y, z) {
      if (W.getBlock(x, y, z) !== 0) return;      // .decomp: `getBlockState(pos).isAir()`
      if (!B.fireCanSurvive(x, y, z)) return;
      W.setBlock(x, y, z, S.stateOf('fire'));
      if (B.changed) B.changed(x, y, z);
      if (B.schedule) B.schedule(x, y, z, 30, 0);
      e.blocksSetOnFire = (e.blocksSetOnFire || 0) + 1;
    }
  };

  Lgt.STRIKE_XZ = 3;
  Lgt.STRIKE_Y_DOWN = 3;
  Lgt.STRIKE_Y_UP = 9;   // `+6.0+3.0` (.decomp:143) -- the box's own extra headroom above +3

  /** The struck-entity half of `tick()` (.decomp:143-155): everything alive in the 3-wide
   *  (6-tall-plus) box around the bolt, once per bolt per entity (`struckIds`, off `e.id` —
   *  this engine's entities carry no UUID, so the numeric id is the same "once per bolt" key
   *  vanilla's own `Set<Entity>` gives by reference). Never for a cosmetic bolt. */
  Lgt.strikeEntities = function (e) {
    if (!e || e.cosmetic) return;
    var EL = NS.EntityList;
    if (!EL || !EL.list) return;
    var x0 = e.x - Lgt.STRIKE_XZ, x1 = e.x + Lgt.STRIKE_XZ;
    var y0 = e.y - Lgt.STRIKE_Y_DOWN, y1 = e.y + Lgt.STRIKE_Y_UP;
    var z0 = e.z - Lgt.STRIKE_XZ, z1 = e.z + Lgt.STRIKE_XZ;
    var inBox = [];
    for (var i = 0; i < EL.list.length; i++) {
      var t = EL.list[i];
      if (!t || t === e || t.removed || t.dead) continue;
      if (t.x < x0 || t.x > x1 || t.y < y0 || t.y > y1 || t.z < z0 || t.z > z1) continue;
      inBox.push(t);
      if (e.struckIds && e.struckIds[t.id]) continue;
      Lgt.onStruckByLightning(t, e);
      if (e.struckIds) e.struckIds[t.id] = true;
    }
    // LightningEntity.tick: Criteria.CHANNELED_LIGHTNING.trigger(channeler, every live entity in the box)
    var ch = e.channeler;
    if (ch && ch.advancements && NS.Adv && NS.Adv.trigger) NS.Adv.trigger(ch, 'minecraft:channeled_lightning', { player: ch, entities: inBox });
  };

  /** `Entity.onStruckByLightning` + the four per-type overrides (see this file's own header
   *  for the four .decomp files this reads). Order matters: mooshroom NEVER calls `super` at
   *  all, and pig/villager only call it on the Peaceful else-branch — both skip the generic
   *  damage+fire entirely when they take the special path, so those two `return` before it. */
  Lgt.onStruckByLightning = function (e, bolt) {
    if (!e || e.dead || e.removed) return;
    if (e.type === 'mooshroom') { if (NS.Mooshroom) NS.Mooshroom.onLightning(e, bolt.id); return; }
    // TurtleEntity.onStruckByLightning: damage(LIGHTNING_BOLT, Float.MAX_VALUE), no super (no fire)
    if (e.type === 'turtle') { if (NS.Combat && NS.Combat.hurt) NS.Combat.hurt(e, Number.MAX_VALUE, undefined, false, { source: 'lightningBolt' }); return; }
    if (e.type === 'armor_stand') return;   // ArmorStandEntity.onStruckByLightning: empty override (no fire, no damage)
    var Diff = NS.Diff, peaceful = !!(Diff && Diff.get && Diff.get() === 'peaceful');
    if (e.type === 'pig' && !peaceful) { Lgt.convertPig(e); return; }
    if (e.type === 'villager' && !peaceful) { Lgt.convertVillager(e); return; }
    var Cb = NS.Combat;
    if (Cb && Cb.igniteForSeconds) Cb.igniteForSeconds(e, 8);
    if (Cb && Cb.hurt) Cb.hurt(e, 5.0, undefined, false);
    if (e.type === 'creeper') e.charged = true;   // CreeperEntity.onStruckByLightning
  };

  /** `PigEntity.onStruckByLightning` (.decomp:217-235): spawn a `zombified_piglin` at this
   *  pig's own position/facing, carry its custom name, discard the pig — no damage, no fire.
   *  This engine has no in-place type-morph (the same standing gap `Undead.convertInWater`'s
   *  own header already states), so this is that identical spawn-fresh/discard-donor shape. */
  Lgt.convertPig = function (e) {
    var EL = NS.EntityList;
    if (!EL || !EL.spawn || !EL.canSpawn || !EL.canSpawn('zombified_piglin')) { e.removed = true; return; }
    var fresh = EL.spawn('zombified_piglin', e.x, e.y, e.z, { conversion: true });
    if (fresh) {
      fresh.yaw = e.yaw; fresh.pitch = e.pitch;
      if (e.isBaby) fresh.isBaby = true; if ((e.growAge | 0) < 0) fresh.growAge = e.growAge;   // D-672: convertTo keeps baby
      if (NS.Equip && NS.Equip.initWeapon) NS.Equip.initWeapon(fresh);   // golden sword, unconditionally
      if (e.aiDisabled) fresh.aiDisabled = true;
      if (e.aiDisabled) fresh.aiDisabled = true;
      if (e.customName !== undefined) { fresh.customName = e.customName; fresh.customNameVisible = e.customNameVisible; }
      fresh.persistent = true;   // setPersistent(): vanilla never despawns it
    }
    e.removed = true;
  };

  /** `VillagerEntity.onStruckByLightning` (.decomp:781-800): same shape, `witch` instead. */
  Lgt.convertVillager = function (e) {
    var EL = NS.EntityList;
    if (!EL || !EL.spawn || !EL.canSpawn || !EL.canSpawn('witch')) { e.removed = true; return; }
    var fresh = EL.spawn('witch', e.x, e.y, e.z, { conversion: true });
    if (fresh) {
      fresh.yaw = e.yaw; fresh.pitch = e.pitch;
      if (e.aiDisabled) fresh.aiDisabled = true;
      if (e.aiDisabled) fresh.aiDisabled = true;
      if (e.customName !== undefined) { fresh.customName = e.customName; fresh.customNameVisible = e.customNameVisible; }
      fresh.persistent = true;
    }
    e.removed = true;
  };

  /** One tick of a live bolt (`LightningEntity.tick`, .decomp:78-158, read whole). */
  Lgt.tick = function (e) {
    if (!e) return;
    if (e.ambientTick === 2 && NS.GameEvent) NS.GameEvent.emit('lightning_strike', e.x, e.y, e.z, e);   // LightningEntity.tick
    var Diff = NS.Diff;
    if (e.ambientTick === 2) {
      var diffV = (Diff && Diff.get) ? Diff.get() : 'normal';
      if (diffV === 'normal' || diffV === 'hard') Lgt.spawnFire(e, 4);
      var S = NS.Sound;
      if (S && S.play) {
        S.play('entity.lightning_bolt.thunder', { x: e.x, y: e.y, z: e.z, volume: 10000, source: 'weather' });
        S.play('entity.lightning_bolt.impact', { x: e.x, y: e.y, z: e.z, volume: 2, source: 'weather' });
      }
      // `powerLightningRod(); cleanOxidation(world, getAffectedBlockPos())` (.decomp:110-111) --
      // on the server branch, cosmetic bolts included (no `cosmetic` test guards either call).
      Lgt.powerLightningRod(e);
      if (NS.Oxidize && NS.Oxidize.cleanOxidation) {
        var ap = Lgt.affectedBlockPos(e);
        NS.Oxidize.cleanOxidation(ap.x, ap.y, ap.z, NS.EntityList ? (NS.EntityList.random || NS.wrand) : NS.wrand);
      }
    }
    e.ambientTick--;
    if (e.ambientTick < 0) {
      if (e.remainingActions === 0) {
        // LightningEntity.tick .decomp:121-131: every player within 256 blocks, bystanders = living, un-struck, in the 30-wide box
        var pl = NS.Player;
        if (pl && NS.Adv && NS.Adv.trigger) {
          var by = [], EL2 = NS.EntityList, all = (EL2 && EL2.list ? EL2.list.slice() : []).concat([pl]);
          for (var bi = 0; bi < all.length; bi++) {
            var t2 = all[bi];
            if (!t2 || t2 === e || t2.removed || t2.dead) continue;
            if (Math.abs(t2.x - e.x) > 15 || Math.abs(t2.z - e.z) > 15 || t2.y < e.y - 15 || t2.y > e.y + 21) continue;
            if (e.struckIds && e.struckIds[t2.id]) continue;
            by.push(t2);
          }
          var dx = pl.x - e.x, dy = pl.y - e.y, dz = pl.z - e.z;
          if (Math.sqrt(dx * dx + dy * dy + dz * dz) < 256) NS.Adv.trigger(pl, 'minecraft:lightning_strike', { player: pl, bolt: e, bystanders: by });
        }
        e.removed = true; return;
      }
      var rnd = NS.EntityList ? (NS.EntityList.random || NS.wrand) : NS.wrand;
      if (e.ambientTick < -Math.floor(rnd() * 10)) {
        e.remainingActions--;
        e.ambientTick = 1;
        e.seed = Math.floor(rnd() * 0x100000000);
        Lgt.spawnFire(e, 0);
      }
    }
    if (e.ambientTick >= 0 && !e.cosmetic) Lgt.strikeEntities(e);
  };

  // ══════════════════════════ § ServerWorld.tickChunk's THUNDER BLOCK ═══════════════════════

  // ══════════════════════════ § THE LIGHTNING ROD (s128) ══════════════════════════════════

  /** `LightningEntity.getAffectedBlockPos` -- the block the bolt stands in, read 1e-6 below its
   *  feet (`BlockPos(x, y - 1.0E-6, z)`), i.e. the block it struck. */
  Lgt.affectedBlockPos = function (e) {
    return { x: Math.floor(e.x), y: Math.floor(e.y - 1.0e-6), z: Math.floor(e.z) };
  };

  function isRod(st) {
    var S = NS.States, R = NS.Reg;
    return !!(st && S && R && R.id && S.block[st] === R.id['lightning_rod']);
  }
  Lgt.isRod = isRod;

  Lgt.ROD_DELAY = 8;          // LightningRodBlock.SCHEDULED_TICK_DELAY
  Lgt.ROD_REDIRECT = 128;     // LightningRodBlock.MAX_REDIRECT_DISTANCE, the POI search radius

  /** `LightningRodBlock.setPowered` (.decomp LightningRodBlock.java): POWERED=true (flag 3 --
   *  the rod's own neighbours are told), then `updateNeighborsAlways` at the block it is FIXED
   *  TO (`pos.offset(FACING.getOpposite())`), then an 8-tick scheduled tick that turns it off.
   *  Then `syncWorldEvent(3002, pos, FACING.getAxis().ordinal())` — the sparks along the rod (D-664). */
  Lgt.setRodPowered = function (x, y, z) {
    var W = NS.World, B = NS.Behave;
    var st = W.getBlock(x, y, z);
    if (!isRod(st) || !B || !B.setProp) return false;
    W.setBlock(x, y, z, B.setProp(st, 'powered', true));
    if (B.changed) B.changed(x, y, z);
    var o = Lgt.rodBack(st);
    if (B.changed) B.changed(x + o[0], y + o[1], z + o[2]);
    if (B.schedule) B.schedule(x, y, z, Lgt.ROD_DELAY, 0);
    var fa = B.propName ? B.propName(st, 'facing') : 'up';
    if (NS.Particle && NS.Particle.worldEvent) {
      NS.Particle.worldEvent(3002, x, y, z, (fa === 'east' || fa === 'west') ? 0 : (fa === 'north' || fa === 'south') ? 2 : 1);
    }
    return true;
  };

  /** `LightningRodBlock.randomDisplayTick` (.decomp:98-104): in thunder, with probability
   *  (time % 200 + 1) / 200 (`nextInt(200) <= time % 200`), a rod that is the top block of its
   *  column throws 1-2 ELECTRIC_SPARK along its facing axis. `env` = {thundering, time, topY(x,z), rand}. */
  Lgt.rodDisplayTick = function (st, x, y, z, env) {
    if (!isRod(st) || !env.thundering) return 0;
    var r = env.rand || NS.wrand;
    if (Math.floor(r() * 200) > env.time % 200) return 0;
    if (y !== env.topY(x, z) - 1) return 0;
    var f = NS.Behave.propName(st, 'facing');
    var axis = (f === 'east' || f === 'west') ? 0 : (f === 'north' || f === 'south') ? 2 : 1;
    return NS.Particle.spawnAlongAxis('electric_spark', axis, x, y, z, 0.125, 1, 2, r);
  };

  /** `ClientWorld.doRandomBlockDisplayTicks` (.decomp:297-307) + `randomBlockDisplayTick` (:322): 667
   *  tries at radius 16 and 667 at 32 around (cx,cy,cz), one bounded loop. Only the block hook is
   *  ported (rods); fluid/biome-ambient/barrier-marker parts have their own owners. */
  Lgt.doRandomBlockDisplayTicks = function (cx, cy, cz, env) {
    var W = NS.World, r = env.rand || NS.wrand, n = 0;
    for (var i = 0; i < 1334; i++) {
      var d = (i & 1) ? 32 : 16;
      var x = cx + Math.floor(r() * d) - Math.floor(r() * d);
      var y = cy + Math.floor(r() * d) - Math.floor(r() * d);
      var z = cz + Math.floor(r() * d) - Math.floor(r() * d);
      var st = W.getBlock(x, y, z);
      if (st) n += Lgt.rodDisplayTick(st, x, y, z, env);
      if (st && NS.Behave.fireDisplayTick) n += NS.Behave.fireDisplayTick(st, x, y, z, r);
    }
    return n;
  };

  /** The offset of `FACING.getOpposite()` -- the block a rod is attached to. */
  Lgt.rodBack = function (st) {
    var f = NS.Behave.propName(st, 'facing');
    return f === 'up' ? [0, -1, 0] : f === 'down' ? [0, 1, 0] : f === 'north' ? [0, 0, 1] :
           f === 'south' ? [0, 0, -1] : f === 'west' ? [1, 0, 0] : f === 'east' ? [-1, 0, 0] : [0, -1, 0];
  };

  /** `LightningRodBlock.scheduledTick`: POWERED=false, and the same two neighbour updates.
   *  Dispatched from `Behave.scheduledTick` (07b), the one place a scheduled tick lands. */
  Lgt.rodScheduledTick = function (x, y, z) {
    var W = NS.World, B = NS.Behave;
    if (!W || !B) return false;
    var st = W.getBlock(x, y, z);
    if (!isRod(st)) return false;
    if (B.propName(st, 'powered') === 'true') {
      W.setBlock(x, y, z, B.setProp(st, 'powered', false));
      if (B.changed) B.changed(x, y, z);
      var o = Lgt.rodBack(st);
      if (B.changed) B.changed(x + o[0], y + o[1], z + o[2]);
    }
    return true;
  };

  /** `LightningRodBlock.onStateReplaced` + `onBlockAdded` (.decomp), called from `Behave.changed` with the
   *  state that WAS at the cell. Added (old is not a rod): a POWERED rod with no queued tick is set unpowered
   *  (flag 18, no neighbour pass of its own). Replaced (old was a powered rod, new is not a rod): the
   *  neighbours of the block it was fixed to are told. */
  Lgt.rodChanged = function (x, y, z, old, queued) {
    var W = NS.World, B = NS.Behave;
    var cur = W.getBlock(x, y, z);
    if (isRod(cur) && !isRod(old) && !queued && B.propName(cur, 'powered') === 'true') {
      W.setBlock(x, y, z, B.setProp(cur, 'powered', false));
    } else if (!isRod(cur) && isRod(old) && B.propName(old, 'powered') === 'true') {
      var o = Lgt.rodBack(old);
      if (B.changed) B.changed(x + o[0], y + o[1], z + o[2]);
    }
  };

  /** `LightningEntity.powerLightningRod`: the struck block, if it is a rod, is powered. */
  Lgt.powerLightningRod = function (e) {
    var p = Lgt.affectedBlockPos(e);
    return isRod(NS.World.getBlock(p.x, p.y, p.z)) ? Lgt.setRodPowered(p.x, p.y, p.z) : false;
  };

  /** `getTopY(WORLD_SURFACE, x, z)`: the highest non-air cell + 1 (air, cave_air and void_air are
   *  all NOT_AIR's air), or the world bottom for an empty / unloaded column. */
  Lgt.worldSurfaceTop = function (x, z) {
    var W = NS.World, CFG = NS.CFG, R = NS.Reg, S = NS.States;
    var cave = R.id['cave_air'], voidA = R.id['void_air'];
    // a column walk through `World.getBlock` (a strike asks this for a handful of rods, rarely):
    // one path for every world, generated or not -- an unloaded column reads air throughout.
    for (var y = CFG.WORLD_MAX_Y - 1; y >= CFG.WORLD_MIN_Y; y--) {
      var st = W.getBlock(x, y, z);
      if (st === 0) continue;
      var b = S.block[st];
      if (b === cave || b === voidA) continue;
      return y + 1;
    }
    return CFG.WORLD_MIN_Y;
  };

  /** `ServerWorld.getLightningRodPos` (.decomp:472-482): the NEAREST lightning_rod POI within
   *  128 blocks (a circle, BlockPos squared distance) of the MOTION_BLOCKING top position, of any
   *  occupation, that is the TOPMOST non-air block of its column; the strike lands on the cell
   *  above it. null when none. */
  Lgt.getLightningRodPos = function (top) {
    var Poi = NS.Poi;
    if (!Poi) return null;
    if (!Poi.ready && Poi.init) Poi.init();
    if (!Poi.ready) return null;
    var list = Poi.getInCircle(function (t) { return t === Poi.LIGHTNING_ROD; }, top, Lgt.ROD_REDIRECT, Poi.STATUS.ANY);
    var best = null, bestD = Infinity;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (p.y !== Lgt.worldSurfaceTop(p.x, p.z) - 1) continue;
      var dx = p.x - top.x, dy = p.y - top.y, dz = p.z - top.z, d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) { bestD = d; best = p; }
    }
    return best ? { x: best.x, y: best.y + 1, z: best.z } : null;
  };

  /** `ServerWorld.getLightningPos` (.decomp:484-500): from the MOTION_BLOCKING top position
   *  (`getTopPosition(MOTION_BLOCKING)`, `Wx.motionTop`), a lightning rod first, else the box
   *  search over nearby, sky-visible, alive entities, or the top position itself. */
  Lgt.getLightningPos = function (x, z) {
    var W = NS.World, Wx = NS.Weather;
    var top = (Wx && Wx.motionTop) ? Wx.motionTop(x, z) : W.heightAt(x, z) + 1;
    var rod = Lgt.getLightningRodPos({ x: x, y: top, z: z });
    if (rod) return rod;
    var EL = NS.EntityList;
    var box = 3.0;
    var candidates = [];
    if (EL && EL.list) {
      for (var i = 0; i < EL.list.length; i++) {
        var c = EL.list[i];
        if (!c || c.removed || c.dead || c.maxHealth === undefined) continue;
        if (c.x < x - box || c.x > x + box || c.z < z - box || c.z > z + box) continue;
        if (c.y < top - box) continue;
        if (Math.floor(c.y) < W.heightAt(Math.floor(c.x), Math.floor(c.z))) continue;   // sees sky
        candidates.push(c);
      }
    }
    if (candidates.length) {
      var rnd = EL.random || NS.wrand;
      var pick = candidates[Math.floor(rnd() * candidates.length)];
      return { x: Math.floor(pick.x), y: Math.floor(pick.y), z: Math.floor(pick.z) };
    }
    return { x: x, y: top, z: z };
  };

  /** The whole "thunder" block (.decomp:396-416): one chunk-column, one tick, already gated
   *  by the caller on `raining && isThundering() && nextInt(100000)==0`. */
  Lgt.strikeAt = function (x, z) {
    var W = NS.World, Sky = NS.Sky, EL = NS.EntityList, C = NS.Commands;
    if (!W || !Sky || !EL) return;
    var pos = Lgt.getLightningPos(x, z);
    var wx = Sky.weather || Sky.newWeather();
    var biome = W.biomeAt(pos.x, pos.z);
    var groundY = W.heightAt(pos.x, pos.z);
    var seesSky = pos.y >= groundY;
    if (!Sky.isRainingAt(wx, biome, pos.x, pos.y, pos.z, seesSky, groundY)) return;

    var doMobSpawning = !(C && C.ruleGet && String(C.ruleGet('doMobSpawning')) === 'false') &&
                         !!(NS.Spawn && NS.Spawn.ready);
    // `!getBlockState(pos.down()).isOf(Blocks.LIGHTNING_ROD)` (.decomp:401) -- a rod-redirected
    // strike never springs the skeleton-horse trap.
    var onLightningRod = isRod(W.getBlock(pos.x, pos.y - 1, pos.z));
    var rnd = EL.random || NS.wrand;
    var trapped = doMobSpawning && !onLightningRod &&
                  rnd() < Lgt.approxLocalDifficulty(pos) * 0.01;

    if (trapped && EL.canSpawn && EL.canSpawn('skeleton_horse')) {
      var horse = EL.spawn('skeleton_horse', pos.x + 0.5, pos.y, pos.z + 0.5, {});
      if (horse) {
        horse.trapped = true;
        if (NS.Breed && NS.Breed.setAge) NS.Breed.setAge(horse, 0);
      }
    }
    if (EL.canSpawn && EL.canSpawn('lightning_bolt')) {
      EL.spawn('lightning_bolt', pos.x + 0.5, pos.y, pos.z + 0.5, { cosmetic: trapped });
    }
  };

  /** Driven once a real game tick, over every loaded column within SIMULATION distance —
   *  `World.tickingAt`, the same gate `World.randomTick`'s own header already established for
   *  every other per-tick, per-chunk cost. `1/100000` stands in for `random.nextInt(100000)==0`
   *  (a fresh `Math.random` draw rather than a seeded `Random.nextInt`, the same fallback shape
   *  Spawn's own per-tick rolls already use throughout this codebase). */
  Lgt.THUNDER_ODDS = 1 / 100000;
  Lgt.tickWorldThunder = function () {
    var W = NS.World, Sky = NS.Sky, CH = NS.CH;
    if (!W || !Sky || !W.chunks || !CH) return;
    var wx = Sky.weather;
    if (!wx || !Sky.isRaining(wx) || !Sky.isThundering()) return;
    var rnd = (NS.EntityList && NS.EntityList.random) || NS.wrand;
    W.chunks.forEach(function (c) {
      if (c.state < CH.GENERATED) return;
      if (!W.tickingAt((c.cx << 4) + 8, (c.cz << 4) + 8)) return;
      if (rnd() >= Lgt.THUNDER_ODDS) return;
      var x = (c.cx << 4) + Math.floor(rnd() * 16);
      var z = (c.cz << 4) + Math.floor(rnd() * 16);
      Lgt.strikeAt(x, z);
    });
  };

  // ═══════════════════════════ § SkeletonHorseTrapTriggerGoal ════════════════════════════════

  Lgt.TRAP_TRIGGER_RANGE = 10.0;

  /** One rider — `SkeletonHorseTrapTriggerGoal.getSkeleton` (.decomp:65-89, read whole): a
   *  fresh `skeleton`, persistent, a short damage-grace (`timeUntilRegen`, approximated as
   *  `invulnerableTime` — see Lgt.OWED), then an UNCONDITIONAL bow+helmet enchant on top of
   *  whatever `initialize()` already rolled. `removeEnchantments` runs FIRST in the jar
   *  (.decomp:86); `Eq.applyEnchants` only APPENDS (07y_equip.js: `(stack.t.Enchantments||[])
   *  .slice()`, then push), so the clear has to happen here, one line before it, or a mob
   *  that already rolled an enchant via `initialize()` would carry two of the same kind. */
  function trapSkeleton(atX, atY, atZ, diff, rnd) {
    var EL = NS.EntityList, Eq = NS.Equip, IT = NS.Items;
    if (!EL || !EL.canSpawn || !EL.canSpawn('skeleton')) return null;
    var sk = EL.spawn('skeleton', atX, atY, atZ, {});
    if (!sk) return null;
    sk.persistent = true;
    sk.invulnerableTime = Math.max(sk.invulnerableTime || 0, 60);
    if (Eq && Eq.ready && IT && IT.ready) {
      var bow = Eq.getEquipped(sk, IT.MAINHAND);
      if (!bow) { bow = Eq.stackOf('bow'); Eq.setEquipped(sk, IT.MAINHAND, bow); }
      if (bow.t) bow.t.Enchantments = [];
      var lvl1 = 5 + Math.floor(diff * Math.floor(rnd() * 18));
      Eq.applyEnchants(bow, Eq.rollEnchants('bow', Eq.MAINHAND_SLOTKIND.bow, lvl1, rnd));

      var helm = Eq.getEquipped(sk, IT.HEAD);
      if (!helm) { helm = Eq.stackOf('iron_helmet'); Eq.setEquipped(sk, IT.HEAD, helm); }
      if (helm.t) helm.t.Enchantments = [];
      var lvl2 = 5 + Math.floor(diff * Math.floor(rnd() * 18));
      Eq.applyEnchants(helm, Eq.rollEnchants('iron_helmet', 'HEAD', lvl2, rnd));
    }
    return sk;
  }

  /** One reinforcement — `SkeletonHorseTrapTriggerGoal.getHorse` (.decomp:57-63): a fresh,
   *  tamed, adult, persistent `skeleton_horse`. */
  function trapHorse(atX, atY, atZ) {
    var EL = NS.EntityList;
    if (!EL || !EL.canSpawn || !EL.canSpawn('skeleton_horse')) return null;
    var h = EL.spawn('skeleton_horse', atX, atY, atZ, {});
    if (!h) return null;
    h.invulnerableTime = Math.max(h.invulnerableTime || 0, 60);
    h.persistent = true;
    h.tamed = true;
    if (NS.Breed && NS.Breed.setAge) NS.Breed.setAge(h, 0);
    return h;
  }

  /** s116 — `Entity.updatePassengerPosition` (Entity.java:1709-1714) worked out for this ONE
   *  pair (a trap skeleton on a skeleton_horse), the same "don't widen `Rd`'s own raider/
   *  ravager formula, override the position after `Rd.startRiding`'s bookkeeping instead"
   *  pattern `Undead.mountJockey` already established (07zk_undead.js, read for the shape).
   *  Vehicle half: `SkeletonHorseEntity.getMountedHeightOffset()` (.decomp:109-111) —
   *  `super.getMountedHeightOffset() - 0.1875`, and neither `HorseBaseEntity` nor
   *  `AbstractHorseEntity` overrides the `Entity.java:1723` default (`dimensions.height *
   *  0.75`) themselves, so the vehicle half is that minus 0.1875. Rider half:
   *  `AbstractSkeletonEntity.getHeightOffset()` (.decomp:219-221) is a flat -0.6, inherited by
   *  `SkeletonEntity` unchanged. */
  Lgt.SKELETON_HORSE_MOUNTED_OFFSET_DELTA = -0.1875;
  Lgt.SKELETON_RIDER_HEIGHT_OFFSET = -0.6;
  Lgt.mountTrapRider = function (rider, vehicle) {
    var Rd = NS.Raid;
    if (!Rd || !Rd.startRiding || !rider || !vehicle) return false;
    Rd.startRiding(rider, vehicle);
    rider.x = vehicle.x; rider.z = vehicle.z;
    rider.y = vehicle.y + (vehicle.height || 0) * 0.75 + Lgt.SKELETON_HORSE_MOUNTED_OFFSET_DELTA +
      Lgt.SKELETON_RIDER_HEIGHT_OFFSET;
    return true;
  };

  /** `SkeletonHorseEntity.DESPAWN_AGE`/`tickMovement` (.decomp:26,113-118): `trapTime++` runs
   *  EVERY tick a horse is trapped — unconditionally, unlike the trigger-goal's own
   *  player-in-range gate below — and discards the horse at 18000 (15 real-time minutes) if
   *  nobody ever sprang it. */
  Lgt.TRAP_TIMEOUT = 18000;

  /** `SkeletonHorseTrapTriggerGoal.canStart`+`tick` (.decomp:24-51), dispatched off `e.trapped`
   *  from `EL.tickMob`'s own per-type slot rather than a real dynamic goal-selector add/remove
   *  (see this file's own header on `07i_entitylist.js`'s dispatch line for why). Springs at
   *  most once — `e.trapped = false` before anything else, the same order the jar's own
   *  `tick()` uses, so a second tick this same frame (there is no second call) could never
   *  re-enter even if the dispatch guard were removed. */
  Lgt.tickTrap = function (e) {
    if (!e || !e.trapped) return;
    var EL = NS.EntityList;
    // vanilla `trapTime++ >= 18000` compares the OLD value: discard on the 18001st tick
    if ((e.trapTime = (e.trapTime || 0) + 1) - 1 >= Lgt.TRAP_TIMEOUT) { if (EL && EL.remove) EL.remove(e); return; }
    if (!isPlayerInRange(e.x, e.y, e.z, Lgt.TRAP_TRIGGER_RANGE)) return;
    var rnd = (EL && EL.random) || NS.wrand;
    var diff = (NS.Equip && NS.Equip.clampedLocalDifficulty ? NS.Equip.clampedLocalDifficulty(NS.Equip.at ? NS.Equip.at(e) : undefined) : 1);

    e.trapped = false;
    e.tamed = true;
    if (NS.Breed && NS.Breed.setAge) NS.Breed.setAge(e, 0);

    if (EL && EL.canSpawn && EL.canSpawn('lightning_bolt')) {
      EL.spawn('lightning_bolt', e.x, e.y, e.z, { cosmetic: true });
    }
    // s116: `$$3.startRiding(this.skeletonHorse)` (.decomp:40) — the trap horse ITSELF gets a
    // rider too, not just the 3 reinforcements below.
    var rider0 = trapSkeleton(e.x, e.y, e.z, diff, rnd);
    if (rider0) Lgt.mountTrapRider(rider0, e);

    for (var i = 0; i < 3; i++) {
      var h = trapHorse(e.x, e.y, e.z);
      if (h) {
        h.vx = (h.vx || 0) + gaussian(rnd) * 0.5;
        h.vz = (h.vz || 0) + gaussian(rnd) * 0.5;
        var rider = trapSkeleton(h.x, h.y, h.z, diff, rnd);
        if (rider) Lgt.mountTrapRider(rider, h);
      }
    }
  };

  /** `Random.nextGaussian()`: Marsaglia polar with the cached spare (`NS.U.polarGaussian`). `rnd` is a
   *  JRandom-shaped source (has `nextDouble`) for the vanilla values from a pinned seed, or a bare
   *  () => double (the spare is then cached on the function). */
  function gaussian(rnd) {
    return rnd && rnd.nextDouble ? NS.U.polarGaussian(rnd, rnd.nextDouble) : NS.U.polarGaussian(rnd);
  }
  Lgt.gaussian = gaussian;

  // ═══════════════════════════ § cheap render flash ══════════════════════════════════════════

  /** 0..1 — any live, non-cosmetic bolt still in its flash window. Read once a frame by
   *  `10_gfx.js`'s own sky-frame call; a plain brightness lerp toward white, not vanilla's real
   *  per-bolt screen geometry (Lgt.OWED). */
  Lgt.flashLevel = function () {
    var EL = NS.EntityList;
    if (!EL || !EL.list) return 0;
    for (var i = 0; i < EL.list.length; i++) {
      var e = EL.list[i];
      if (e && e.type === 'lightning_bolt' && !e.cosmetic && e.ambientTick >= 0 && !e.removed) return 0.6;
    }
    return 0;
  };
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
