/* 07zzp_mobvoice.js — #742. Every mob's voice: ambient timer, hurt/death, step, horse angry/eat/gallop.
 *
 * The table is `NS.DATA.mobSounds` (tools/golden/mob-sounds-1.18.2.tsv, tools/extract-mobsounds.mjs off .decomp):
 *   type -> [ambient, hurt, death, step, stepVolume, minAmbientDelay, soundVolume, category, angry, eat, walk]
 * an event field with a comma lists every event the vanilla method can return; `MV.pick` is the condition.
 * evoker / ghast / shulker keep their own voice code (SKIP) -- they were ported with extra sounds first.
 */
(function (NS) {
  'use strict';
  var MV = NS.MobVoice = {};
  var I = { ambient: 0, hurt: 1, death: 2, step: 3, stepVolume: 4, delay: 5, volume: 6, cat: 7, angry: 8, eat: 9, walk: 10 };
  MV.SKIP = { ghast: 1, shulker: 1, husk: 1 };
  // getMoveEffect() == EVENTS (sounds=false): Entity.move never plays step/swim sounds (Bat/Endermite/Silverfish/Guardian/Squid classes)
  // BeeEntity / FishEntity.playStepSound are empty overrides: no step event and no block-step fallthrough (swimming still plays)
  MV.NO_STEP = { bee: 1, cod: 1, salmon: 1, pufferfish: 1, tropical_fish: 1 };
  MV.EVENTS_ONLY = { bat: 1, endermite: 1, silverfish: 1, guardian: 1, elder_guardian: 1, squid: 1, glow_squid: 1 };
  // own hurt/death code (SnowGolem.playSound/tickAmbient, Cb.golemSound); splash/fall/step stay here
  MV.OWN = { snow_golem: 1, iron_golem: 1, evoker: 1, vex: 1 };   // iron_golem: Cb.golemSound (14j_combat.js) plays hurt/death
  // every class the 1.18.2 jar has extending HostileEntity (.decomp, transitive): its getSwimSound/getSplashSound/getFallSounds
  // are entity.hostile.*; every other living entity uses entity.generic.* (Entity / LivingEntity defaults).
  MV.HOSTILE = { blaze: 1, cave_spider: 1, creeper: 1, drowned: 1, elder_guardian: 1, enderman: 1, endermite: 1, evoker: 1,
    giant: 1, guardian: 1, husk: 1, illusioner: 1, piglin: 1, piglin_brute: 1, pillager: 1, ravager: 1, silverfish: 1,
    skeleton: 1, spider: 1, stray: 1, vex: 1, vindicator: 1, witch: 1, wither: 1, wither_skeleton: 1, zoglin: 1,
    zombie: 1, zombie_villager: 1, zombified_piglin: 1 };
  MV.HORSES = { horse: 1, donkey: 1, mule: 1, skeleton_horse: 1, zombie_horse: 1 };

  function rnd() { return Math.random(); }
  // #4003 (Dan, 7 Oct): a mob's whole voice (ambient/hurt/death/step/burning) is registered only once the mob passes its
  // Gate M audit (`go.mjs audit --mob`). Add the type here when the audit is clean; tools/mobvoicegatecheck.mjs guards the list.
  MV.AUDITED = { ravager: 1, evoker: 1, wolf: 1, sheep: 1, squid: 1, glow_squid: 1, cod: 1, salmon: 1, pufferfish: 1, tropical_fish: 1,
    guardian: 1, elder_guardian: 1, witch: 1, pig: 1, parrot: 1, snow_golem: 1, iron_golem: 1, horse: 1, husk: 1, endermite: 1, cow: 1, mooshroom: 1, vex: 1, strider: 1, skeleton: 1, stray: 1, wither_skeleton: 1, polar_bear: 1, wither: 1 };
  MV.GATED = true;
  function tab(type) { var T = NS.DATA && NS.DATA.mobSounds; return (T && (!MV.GATED || MV.AUDITED[type]) && T[type]) || null; }
  function list(type, i) { var r = tab(type); return r && r[i] ? r[i].split(',') : []; }
  function baby(e) { return !!(e.isBaby || e.baby || (e.growAge | 0) < 0); }
  function wet(e) { return !!(e.inWater || e.wet); }
  function has(evs, s) { for (var i = 0; i < evs.length; i++) if (evs[i].indexOf(s) >= 0) return evs[i]; return null; }
  // the plain event: `<x>.ambient` / `.hurt` / `.death` / `.eat` (not the _water/_land/_small/_baby/screaming/angry variants)
  function base(evs) { for (var i = 0; i < evs.length; i++) if (/\.(ambient|hurt|death|eat)$/.test(evs[i]) && !/screaming/.test(evs[i])) return evs[i]; return evs[0]; }

  /** FoxEntity.getAmbientSound: getNonSpectatingEntities(PlayerEntity, boundingBox.expand(16)) non-empty (a box, not a sphere). */
  MV.playerWithin16 = function (e) {
    var EL = NS.EntityList, q = EL && EL.pushPlayer ? EL.pushPlayer() : (NS.Player && NS.Player.x !== undefined ? NS.Player : null);
    if (!q || q.spectator || q.gamemode === 'spectator' || q.gameMode === 'spectator') return false;
    return Math.abs(q.x - e.x) <= 16 + 0.3 && Math.abs(q.y - e.y) <= 16 + 0.45 && Math.abs(q.z - e.z) <= 16 + 0.3;
  };

  /** `getAmbientSound/getHurtSound/getDeathSound`'s condition, per the .decomp classes; null = silent this roll. */
  var HORSE = { horse: 1, donkey: 1, mule: 1, zombie_horse: 1, skeleton_horse: 1 };   // llamas override without super
  MV.pick = function (e, role) {
    var t = e.type, evs = list(t, I[role]);
    if (HORSE[t] && role !== 'death' && NS.Mount && NS.Mount.updateAnger)   // HorseBaseEntity.getAmbientSound/getHurtSound (.decomp 342-358)
      if (Math.floor(rnd() * (role === 'ambient' ? 10 : 3)) === 0 && (role === 'hurt' || !NS.Mount.isImmobile(e))) NS.Mount.updateAnger(e);
    if (t === 'parrot' && role === 'ambient') return MV.parrotRandomSound();   // the table's ambient is empty: getAmbientSound = getRandomSound
    if (t === 'piglin' && role === 'ambient' && NS.Piglin && NS.Piglin.activitySound) return NS.Piglin.inIdleActivity(e) ? NS.Piglin.activitySound(e) : null;   // PiglinEntity.getAmbientSound; table slot is empty
    if (!evs.length) return null;
    var w = wet(e), s;
    if (role === 'ambient') {
      switch (t) {
        case 'wolf': // WolfEntity.getAmbientSound
          if ((e.angerTime | 0) > 0) return has(evs, 'growl');
          if (Math.floor(rnd() * 3) === 0) return e.tamed && e.health < 10 ? has(evs, 'whine') : has(evs, 'pant');
          return base(evs);
        case 'cat': // CatEntity.getAmbientSound
          if (!e.tamed) return has(evs, 'stray_ambient');
          if (e.inLove > 0) return 'entity.cat.purr';
          return Math.floor(rnd() * 4) === 0 ? 'entity.cat.purreow' : 'entity.cat.ambient';
        case 'fox': // FoxEntity.getAmbientSound: sleep / night screech (2.0 volume, see MV.ambientVolume) / ambient
          if (e.sleeping) return has(evs, 'sleep');
          if (!(NS.Sky && NS.Sky.isDay && NS.Sky.isDay()) && rnd() < 0.1 && !MV.playerWithin16(e)) return has(evs, 'screech');
          return base(evs);
        case 'enderman': return e.target ? has(evs, 'scream') : has(evs, 'ambient');
        case 'panda': return NS.Panda && NS.Panda.isAttacking(e) ? has(evs, 'aggressive') : (NS.Panda && NS.Panda.isWorried(e) ? has(evs, 'worried') : base(evs));
        case 'villager': case 'wandering_trader':
          if (e.sleeping) return null;
          return e.customer ? has(evs, 'trade') : base(evs);
        case 'zoglin': return (e.target || (NS.Hoglin && NS.Hoglin.attackTarget(e))) ? has(evs, 'angry') : has(evs, 'ambient');
        case 'zombified_piglin': return (e.angerTime | 0) > 0 ? has(evs, 'angry') : has(evs, 'ambient');
        case 'piglin': case 'piglin_brute': // AbstractPiglinEntity.playAmbientSound: only while PiglinBrain.hasIdleActivity
          return (e.target || e.angryAtEnt || e.vehicle) ? null : evs[0];
        case 'goat': return e.screaming ? has(evs, 'screaming') : base(evs);
        case 'strider': return (NS.Strider && (NS.Strider.isEscaping(e) || NS.Strider.isTempted(e))) ? null : evs[0];   // StriderEntity.getAmbientSound
        case 'axolotl': if (e.playingDead) return null; return w ? has(evs, 'idle_water') : has(evs, 'idle_air');
        case 'dolphin': case 'drowned': case 'skeleton_horse': return w ? has(evs, '_water') : base(evs);
        case 'guardian': case 'elder_guardian': return w ? base(evs) : has(evs, '_land');
        case 'bat': return (e.roosting && Math.floor(rnd() * 4) !== 0) ? null : evs[0];   // BatEntity.getAmbientSound
        case 'turtle': return (!w && e.onGround && !baby(e)) ? evs[0] : null;
        case 'polar_bear': return baby(e) ? has(evs, '_baby') : base(evs);
      }
      return evs[0];
    }
    // hurt / death
    switch (t) {
      case 'goat': return e.screaming ? has(evs, 'screaming') : base(evs);
      case 'drowned': return w ? has(evs, '_water') : base(evs);
      case 'guardian': case 'elder_guardian': return w ? base(evs) : has(evs, '_land');
      case 'slime': case 'magma_cube': return (e.size | 0) <= 1 ? has(evs, '_small') : base(evs);
      case 'turtle': return baby(e) ? has(evs, '_baby') : base(evs);
    }
    return evs[0];
  };

  MV.volume = function (e) {
    if (e.type === 'slime' || e.type === 'magma_cube') return 0.4 * (e.size | 0 || 1);
    var r = tab(e.type), v = r && r[I.volume];
    return v ? parseFloat(v) : 1;
  };
  /** `LivingEntity.getSoundPitch` (+ zombie_villager 2.0 baby, bat x0.95). */
  MV.pitch = function (e) {
    var p = (rnd() - rnd()) * 0.2 + (baby(e) ? (e.type === 'zombie_villager' ? 2.0 : 1.5) : 1.0);
    return e.type === 'bat' ? p * 0.95 : p;
  };
  MV.source = function (e) {
    var r = tab(e.type);
    if (e.type === 'rabbit') return e.rabbitType === 99 ? 'hostile' : 'neutral';   // RabbitEntity.getSoundCategory: killer bunny only
    return r && r[I.cat] === 'hostile' ? 'hostile' : 'neutral';
  };
  /** `Entity.playSound(ev, volume, pitch)` from the mob's own position and category. */
  MV.emit = function (e, ev, volume, pitch) {
    if (!ev || e.silent || (MV.GATED && !MV.AUDITED[e.type]) || !NS.Sound || !NS.Sound.play) return false;
    return NS.Sound.play(ev, { x: e.x, y: e.y, z: e.z, volume: volume === undefined ? MV.volume(e) : volume,
      pitch: pitch === undefined ? MV.pitch(e) : pitch, source: MV.source(e) });
  };
  MV.delay = function (e) { var r = tab(e.type); return r && r[I.delay] ? parseInt(r[I.delay], 10) : 80; };

  /** `LivingEntity.damage`: the death sound on the killing blow, else the hurt sound; a hurt resets the ambient delay. */
  MV.onDamage = function (e, dead) {
    if (MV.SKIP[e.type] || MV.OWN[e.type] || !tab(e.type)) return false;
    if (!dead) e.ambientSoundChance = -MV.delay(e);
    return MV.emit(e, MV.pick(e, dead ? 'death' : 'hurt'));
  };

  /** `Entity.getSwimSound` / `getSplashSound` / `LivingEntity.getFallSounds` (HostileEntity overrides; DrownedEntity swims its own). */
  MV.FISH = { cod: 1, salmon: 1, pufferfish: 1, tropical_fish: 1 };
  MV.waterSound = function (e, kind) {
    var h = MV.HOSTILE[e.type] === 1;
    if (e.type === 'axolotl' && (kind === 'swim' || kind === 'splash')) return 'entity.axolotl.' + kind;
    if (e.type === 'dolphin' && (kind === 'swim' || kind === 'splash')) return 'entity.dolphin.' + kind;
    if (kind === 'swim' && MV.FISH[e.type]) return 'entity.fish.swim';   // FishEntity.getSwimSound
    if (kind === 'swim') return e.type === 'drowned' ? 'entity.drowned.swim' : (h ? 'entity.hostile.swim' : 'entity.generic.swim');
    if (kind === 'splash') return h ? 'entity.hostile.splash' : 'entity.generic.splash';
    return (h ? 'entity.hostile.' : 'entity.generic.') + kind;   // small_fall / big_fall
  };
  /** `SkeletonHorseEntity.getSwimSound` / `playSwimSound`: grounded -> step_water (riderless) or the soundTicks gallop_water pattern, volume 0.3; afloat -> swim at min(0.1, v*25). */
  MV.skeletonHorseSwim = function (e, v) {
    var ev = 'entity.skeleton_horse.swim', vol = Math.min(0.1, v * 25);
    if (e.onGround) {
      vol = 0.3;
      if (!(e.rider || e.passenger)) ev = 'entity.skeleton_horse.step_water';
      else {
        e.soundTicks = (e.soundTicks || 0) + 1;
        if (e.soundTicks > 5 && e.soundTicks % 3 === 0) ev = 'entity.skeleton_horse.gallop_water';
        else if (e.soundTicks <= 5) ev = 'entity.skeleton_horse.step_water';
      }
    }
    return MV.emit(e, ev, vol, pitchW());
  };
  function pitchW() { return 1.0 + (rnd() - rnd()) * 0.4; }
  function speedMix(e, k) { var vx = e.vx || 0, vy = e.vy || 0, vz = e.vz || 0; return Math.min(1, Math.sqrt(vx * vx * 0.2 + vy * vy + vz * vz * 0.2) * k); }

  /** `Entity.checkWaterState` -> `onSwimmingStart`: the tick a mob enters water (not its first tick). Slow: the class's splash; fast: generic. */
  MV.tickWater = function (e) {
    var w = !!e.inWater, was = e.voiceWet;
    e.voiceWet = w;
    if (!w || was !== false || MV.SKIP[e.type] || e.dead) return false;
    var v = speedMix(e, 0.2);
    return MV.emit(e, v < 0.25 ? MV.waterSound(e, 'splash') : 'entity.generic.splash', v, pitchW());
  };

  /** `LivingEntity.handleFallDamage`: small_fall/big_fall (split at damage > 4) at 1/1, then the block's fall sound (0.5 vol, 0.75 pitch). */
  MV.onFall = function (e, dmg) {
    if (!(dmg > 0) || MV.SKIP[e.type] || e.silent) return false;
    // HorseBaseEntity.handleFallDamage does not call super: no small_fall/big_fall, only playBlockFallSound
    if (e.type === 'armor_stand') { if (NS.Sound && NS.Sound.play) NS.Sound.play('entity.armor_stand.fall', { x: e.x, y: e.y, z: e.z, volume: 1, pitch: 1, source: MV.source(e) }); }   // #4820 ArmorStandEntity.getFallSounds (small = big); not a gated table mob
    else if (!(NS.Physics && NS.Physics.HORSE_BASE && NS.Physics.HORSE_BASE[e.type] === 1)) MV.emit(e, MV.waterSound(e, dmg > 4 ? 'big_fall' : 'small_fall'), 1, 1);
    var S = NS.Sound, Ph = NS.Physics, st = Ph && Ph.blockAt ? Ph.blockAt(e.x, e.y - 0.2, e.z) : 0;
    if (st && S && S.blockFall) S.blockFall(st, e.x, e.y, e.z, null, MV.source(e));
    return true;
  };

  /** `HorseBaseEntity.handleFallDamage`: fallDistance > 1 plays entity.horse.land (0.4, 1.0) even when no damage results. */
  MV.horseLand = function (e, distance) {
    // LlamaEntity.handleFallDamage overrides it without super: no entity.horse.land
    return distance > 1 && e.type !== 'llama' && e.type !== 'trader_llama' && !MV.SKIP[e.type] && !e.silent ? MV.emit(e, 'entity.horse.land', 0.4, 1) : false;
  };

  /** `MobEntity.baseTick`: `nextInt(1000) < ambientSoundChance++` -> reset to -minDelay, play the ambient sound. */
  MV.tickAmbient = function (e) {
    if (MV.SKIP[e.type] || MV.OWN[e.type] || e.type === 'hoglin' || e.dead || !(e.health > 0) || !tab(e.type)) return false;   // hoglin: Hoglin.tickAmbient
    if (e.ambientSoundChance === undefined) e.ambientSoundChance = 0;
    if (Math.floor(rnd() * 1000) < e.ambientSoundChance++) {
      e.ambientSoundChance = -MV.delay(e);
      var ev = MV.pick(e, 'ambient');
      if (!ev) return false;
      // FoxEntity.playAmbientSound: the night screech is played at volume 2.0
      return MV.emit(e, ev, ev === 'entity.fox.screech' ? 2.0 : undefined);
    }
    return false;
  };

  /** `HorseBaseEntity.playAngrySound` (interact with an untamed horse) / `getEatSound` (eating animation). */
  MV.playAngry = function (e) { var a = list(e.type, I.angry)[0]; return a ? MV.emit(e, a) : false; };
  MV.playEat = function (e) { var a = list(e.type, I.eat); return a.length ? MV.emit(e, e.screaming ? has(a, 'screaming') || a[0] : base(a)) : false; };

  /**
   * `HorseBaseEntity.playStepSound` (:367-): not on liquid; ridden (not donkey/mule) -> `soundTicks` gate (step_wood for 1..5, gallop every third tick over 5),
   * else step_wood on WOOD blocks, else `entity.horse.step`, all at vol*0.15.
   */
  MV.horseStep = function (e, vp, st) {
    var w = list(e.type, I.walk), v = (vp ? vp[0] : 1) * 0.15, p = vp ? vp[1] : 1;
    var S = NS.Sound, wood = S && S.blockEvent && S.blockEvent(st, 'step') === 'block.wood.step';
    // AbstractDonkeyEntity (donkey, mule) sets playExtraHorseSounds=false: only the plain branches
    if ((e.rider || e.passenger) && e.type !== 'donkey' && e.type !== 'mule') {
      e.soundTicks = (e.soundTicks || 0) + 1;
      if (e.soundTicks > 5 && e.soundTicks % 3 === 0) {
        MV.emit(e, has(w, 'gallop'), v, p);
        if (e.type === 'horse' && Math.floor(rnd() * 10) === 0) MV.emit(e, has(w, 'breathe'), (vp ? vp[0] : 1) * 0.6, p);
      } else if (e.soundTicks <= 5) MV.emit(e, 'entity.horse.step_wood', v, p);
      return true;
    }
    return MV.emit(e, wood ? 'entity.horse.step_wood' : 'entity.horse.step', v, p);
  };

  /**
   * `Entity.move`'s step counter: horizontal distance x0.6 crossing `nextStep` (+1 each time) on the ground, out of the
   * water. The event is the mob's own (`playStepSound`) at its volume, else the block under's SoundType step.
   */
  MV.tickStep = function (e) {
    var r = tab(e.type);
    if (MV.SKIP[e.type] || MV.EVENTS_ONLY[e.type] || !r || e.dead) return false;
    var dx = e.x - (e.stepX === undefined ? e.x : e.stepX), dz = e.z - (e.stepZ === undefined ? e.z : e.stepZ);
    e.stepX = e.x; e.stepZ = e.z;
    var d = Math.sqrt(dx * dx + dz * dz);
    if (d > 2) return false;                       // teleport / respawn, not a walk
    e.stepDist = (e.stepDist || 0) + d * 0.6;
    if (e.stepNext === undefined) e.stepNext = 1;
    if (!(e.stepDist > e.stepNext) || !(e.onGround || wet(e))) return false;
    e.stepNext = e.stepDist + (e.type === 'turtle' ? 0.15 : 1);   // TurtleEntity.calculateNextStepSoundDistance
    if (e.silent) return false;
    var vp = null, S = NS.Sound, Ph = NS.Physics;
    var st = Ph && Ph.blockAt ? Ph.blockAt(e.x, e.y - 0.2, e.z) : 0;
    // Entity.move: touching water -> playSwimSound(min(1, |v|*0.35)), over a non-air landing block, else no step
    // TurtleEntity.getSwimSound = entity.turtle.swim, played through playSwimSound(volume * 1.5)
    if (wet(e) && e.type === 'skeleton_horse' && st) return MV.skeletonHorseSwim(e, speedMix(e, 0.35));
    if (wet(e)) return st ? MV.emit(e, e.type === 'turtle' ? 'entity.turtle.swim' : MV.waterSound(e, 'swim'), speedMix(e, 0.35) * (e.type === 'turtle' ? 1.5 : 1), pitchW()) : false;
    if (MV.NO_STEP[e.type]) return false;
    if (MV.HORSES[e.type]) {
      // HorseBaseEntity.playStepSound: a snow layer on top of the landing block replaces its sound group
      var up = Ph && Ph.blockAt ? Ph.blockAt(e.x, e.y + 0.8, e.z) : 0, SS = NS.States;
      if (up && SS && SS.block && NS.Reg && NS.Reg.names[SS.block[up]] === 'snow') st = up;
    }
    if (S && S.blockVP) vp = S.blockVP(st);
    if (MV.HORSES[e.type]) return MV.horseStep(e, vp, st);
    var ev = r[I.step] && r[I.step].split(',')[0];
    if (e.type === 'turtle') ev = baby(e) ? 'entity.turtle.shamble_baby' : 'entity.turtle.shamble';   // TurtleEntity.playStepSound
    if (ev) return MV.emit(e, ev, parseFloat(r[I.stepVolume] || '0.15'), 1.0);
    if (!st || !S || !S.blockStep) return false;
    return S.blockStep(st, e.x, e.y, e.z, null, MV.source(e));
  };

  // ── parrot: ParrotEntity.MOB_SOUNDS (.decomp, 33 entries incl. the cave_spider/spider pair), getRandomSound, imitateNearbyMob, flap ──
  MV.PARROT_IMITATE = { blaze: 1, cave_spider: 1, creeper: 1, drowned: 1, elder_guardian: 1, ender_dragon: 1, endermite: 1, evoker: 1,
    ghast: 1, guardian: 1, hoglin: 1, husk: 1, illusioner: 1, magma_cube: 1, phantom: 1, piglin: 1, piglin_brute: 1, pillager: 1,
    ravager: 1, shulker: 1, silverfish: 1, skeleton: 1, slime: 1, spider: 1, stray: 1, vex: 1, vindicator: 1, witch: 1, wither: 1,
    wither_skeleton: 1, zoglin: 1, zombie: 1, zombie_villager: 1 };
  // MOB_SOUNDS maps cave_spider to SoundEvents.field_15190 = entity.parrot.imitate.spider (no imitate.cave_spider event exists)
  function parrotSound(type) { return MV.PARROT_IMITATE[type] === 1 ? 'entity.parrot.imitate.' + (type === 'cave_spider' ? 'spider' : type) : 'entity.parrot.ambient'; }
  /** `ParrotEntity.getRandomSound`: non-peaceful and nextInt(1000)==0 -> a random imitation, else entity.parrot.ambient. */
  MV.parrotRandomSound = function () {
    var D = NS.Diff;
    if (!(D && D.isPeaceful && D.isPeaceful()) && Math.floor(rnd() * 1000) === 0) {
      var k = Object.keys(MV.PARROT_IMITATE);
      return parrotSound(k[Math.floor(rnd() * k.length)]);
    }
    return 'entity.parrot.ambient';
  };
  /** `ParrotEntity.imitateNearbyMob`: alive, not silent, nextInt(2)==0, a random non-silent imitable mob within expand(20); 0.7 volume. */
  MV.parrotImitate = function (e) {
    if (e.dead || e.silent || Math.floor(rnd() * 2) !== 0) return false;
    var L = (NS.EntityList && NS.EntityList.list) || [], c = [];
    for (var i = 0; i < L.length; i++) {
      var o = L[i];
      if (o === e || o.dead || !MV.PARROT_IMITATE[o.type]) continue;
      // getBoundingBox().expand(20) overlap (strict, like Box.intersects), feet-centred boxes
      var hw = (e.width || 0.5) / 2 + 20 + (o.width || 0.6) / 2;
      if (Math.abs(o.x - e.x) < hw && Math.abs(o.z - e.z) < hw &&
          o.y < e.y + (e.height || 0.9) + 20 && o.y + (o.height || 1.8) > e.y - 20) c.push(o);
    }
    if (!c.length) return false;
    var m = c[Math.floor(rnd() * c.length)];
    if (m.silent) return false;
    if (e.type === 'parrot') return MV.emit(e, parrotSound(m.type), 0.7);
    var S = NS.Sound;   // shoulder parrot: the player plays it (PLAYERS category), so the per-mob AUDITED gate does not apply
    return !!(S && S.play && S.play(parrotSound(m.type), { x: e.x, y: e.y, z: e.z, volume: 0.7, pitch: (rnd() - rnd()) * 0.2 + 1, source: 'player' }));
  };
  /** `PlayerEntity.updateShoulderEntity`: per shoulder slot, unless Silent, nextInt(200)==0 and a parrot -> imitateNearbyMob(player), else getRandomSound at 1.0 / getSoundPitch. */
  MV.tickShoulder = function (p, rec) {
    if (!rec || rec.silent || Math.floor(rnd() * 200) !== 0 || rec.type !== 'parrot') return false;
    if (MV.parrotImitate(p)) return true;
    var S = NS.Sound;
    return !!(S && S.play && S.play(MV.parrotRandomSound(), { x: p.x, y: p.y, z: p.z, volume: 1, pitch: (rnd() - rnd()) * 0.2 + 1, source: 'player' }));
  };
  /** `ParrotEntity.tickMovement`: the 1/400 imitate roll (maxWingDeviation is advanced once, by Passive.tickChickenFlap), and `Entity.move`'s air branch
   *  (`speed += |move|*0.6`; over an air block `hasWings` = speed > field_28640 -> entity.parrot.fly 0.15). */
  MV.tickParrot = function (e) {
    if (e.dead) return false;
    if (Math.floor(rnd() * 400) === 0) MV.parrotImitate(e);
    var px = e.flyX === undefined ? e.x : e.flyX, py = e.flyY === undefined ? e.y : e.flyY, pz = e.flyZ === undefined ? e.z : e.flyZ;
    e.flyX = e.x; e.flyY = e.y; e.flyZ = e.z;
    var d = Math.sqrt((e.x - px) * (e.x - px) + (e.y - py) * (e.y - py) + (e.z - pz) * (e.z - pz));
    if (d > 4) return false;   // teleport
    e.wingSpeed = (e.wingSpeed || 0) + d * 0.6;
    if (e.wingMark === undefined) e.wingMark = 1;
    if (e.onGround || !(e.wingSpeed > e.wingMark)) return false;
    var Ph = NS.Physics;
    var at = Ph && Ph.blockAt ? Ph.blockAt(e.x, e.y - 0.2, e.z) : 0;
    if (at === 0 && Ph && Ph.blockAt) {   // Entity.getLandingPos: air over a fence/wall/gate counts as that block, so no flap
      var T = NS.Tags, lo = Ph.blockAt(e.x, e.y - 1.2, e.z), lb = lo && NS.States.block[lo];
      if (lb !== undefined && lb !== null && lo && (T.blockInCol(T.blockTag('fences'), lb) || T.blockInCol(T.blockTag('walls'), lb) || T.blockInCol(T.blockTag('fence_gates'), lb))) at = lo;
    }
    if (at !== 0) return false;
    e.wingMark = e.wingSpeed + (e.maxWingDeviation || 0) / 2;
    return MV.emit(e, 'entity.parrot.fly', 0.15, 1.0);
  };

  /** `FoxEntity.tickMovement` end: isAggressive (the MeleeAttackGoal flag) and nextFloat < 0.05 -> entity.fox.aggro at 1.0/1.0. */
  MV.tickFox = function (e) {
    if (e.dead || !e.aggressive || !(rnd() < 0.05)) return false;
    return MV.emit(e, 'entity.fox.aggro', 1.0, 1.0);
  };

  /** CatEntity.tick/updateAnimations: untamed + tempted -> beg_for_food every 100 ticks; sleeping/head-down -> purr every 5 (vol 0.6+0.4*(r-r)). */
  MV.tickCat = function (e) {
    if (e.dead) return false;
    if (e.temptActive && !e.tamed && e.age % 100 === 0) MV.emit(e, 'entity.cat.beg_for_food', 1.0, 1.0);
    if ((e.inSleepingPose || e.headDown) && e.age % 5 === 0) MV.emit(e, 'entity.cat.purr', 0.6 + 0.4 * (rnd() - rnd()), 1.0);
    return true;
  };
  MV.tick = function (e) { MV.tickWater(e); MV.tickAmbient(e); MV.tickStep(e); if (e.type === 'parrot') MV.tickParrot(e); if (e.type === 'fox') MV.tickFox(e); if (e.type === 'cat') MV.tickCat(e); };
  MV.ready = true;
})(MCL);
