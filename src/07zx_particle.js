// 07zx_particle.js — PLAN G20 (loop/hearts): the PARTICLE substrate this engine did not have.
// Runs on: MAIN THREAD ONLY. No DOM — a particle is a plain object with a position and a
// velocity (the break/hit dots `Player.spawnBreakParticles` used to keep are GONE — they are
// BlockDustParticle in this file now, D-659), each ticked here instead of on its own pool.
//
// ⚠⚠ WHY THIS FILE EXISTS. `Breed.OWED`'s first line ("the HEART and the growth PUFF") and
// half a dozen other `*.OWED` entries across this codebase (`07zi_squid.js`, `07zj_fish.js`,
// `07p_trade.js`, `14j_combat.js`, `07v_spell.js`, `07za_explosion.js`, ...) all point at the
// same standing gap: no general particle system exists in this engine at all. This file is
// that substrate — a list, a spawn, a per-tick update — built for THIS unit's three cadences
// (love-mode HEART, growth/bonemeal HAPPY_VILLAGER, tame success/fail HEART/SMOKE) and shaped
// so the next particle-emitting feature (villager trade happy-particles, squid ink, evoker
// fangs) can call `Px.spawn`/`Px.spawnBurst` instead of building its own pool.
//
// ⚠⚠ WHAT THIS IS NOT: A DRAW PASS. `Px.OWED` below names why — no particle atlas is
// extracted, so there is no texture to bind a billboard quad to. The simulation is real and
// tick-correct (every constant cited to `.decomp/net/minecraft/client/particle/`); nothing
// paints it on screen yet.
//
// ── CADENCES (all three read straight off .decomp, not typed in) ─────────────────────────────
//   love mode   — AnimalEntity.tickMovement: `loveTicks % 10 == 0` (checked AFTER the
//                 per-tick decrement), one HEART, gaussian*0.02 velocity ROLLED but DISCARDED
//                 (see the heart branch below). .decomp/net/minecraft/entity/passive/
//                 AnimalEntity.java:54-68.
//   breed done  — Animal.spawnChildFromBreeding -> world.sendEntityStatus(this, 18) ->
//                 Animal.handleStatus(18): SEVEN hearts, same gaussian*0.02 roll (also
//                 discarded). AnimalEntity.java:239-251.
//   growth puff — PassiveEntity.tickMovement's OWN client-side loop: `happyTicksRemaining`
//                 (set to 40 by `growUp(amount, true)`, i.e. Breed.ageUp's `forced` branch —
//                 this engine's `e.forcedAgeTimer` IS that field, already ticked down once a
//                 tick by `Br.tickAge`) spawns one HAPPY_VILLAGER every FOURTH tick while it
//                 counts down, `happyTicksRemaining % 4 == 0`, checked BEFORE the decrement.
//                 PassiveEntity.java:121-134. `Br.C.growParticleInterval` (4) and
//                 `Br.C.forcedAgeTimer` (40) are already carried by breeding-1.18.2.tsv/
//                 extract-breeding.mjs — this file reads them, it does not restate them.
//   tame        — TameableEntity.showEmoteParticle(success): world.sendEntityStatus(this, 7)
//                 -> handleStatus(7) -> 7 HEARTs. Fail: status 6 -> handleStatus(6) -> 7
//                 SMOKEs. TameableEntity.java:82-103.
//
(function (NS) {
  'use strict';

  var Px = NS.Particle = { ready: false };

  Px.MAX = 512;               // a generous cap -- nothing here is ever going to approach it
  Px.list = [];

  Px.init = function () { Px.list.length = 0; Px.ready = true; return Px; };

  // Box-Muller — every cadence above rolls `random.nextGaussian()` at its call site
  // (AnimalEntity.java:57-59,244-246; TameableEntity.java:89-91) and this engine has no shared
  // gaussian source (`Ai`/`Breed` each roll uniform for their own purposes), so it is one
  // function here rather than re-derived at each of the three call sites.
  // ⚠ NOT the rejection-sampling (polar) form -- with a caller-supplied CONSTANT `rand`
  // (checks pass `{ random: () => 0.5 }` throughout this codebase, breedcheck.mjs's own §9
  // among them), rejection sampling on `u*u+v*v === 0` never terminates. The direct
  // Box-Muller transform below always terminates (one `log`/`sin`/`cos`, no loop) and is
  // statistically the same distribution; this file never claims bit-exact RNG parity with
  // `java.util.Random.nextGaussian()` (a LCG the jar seeds per-entity, which this engine does
  // not reproduce anywhere else either -- `Ai`/`Breed` both roll uniform for their own needs).
  // Now the Marsaglia polar form over NS.U.polarGaussian (java.util.Random.nextGaussian): the
  // spare is cached on the source `r` (a bare () => double or a JRandom), not module-global.
  // polarGaussian caps the rejection loop, so a constant test stub still terminates.
  function gauss(r) { return r.nextDouble ? NS.U.polarGaussian(r, r.nextDouble) : NS.U.polarGaussian(r); }
  Px._gauss = gauss;   // exposed for particlecheck's own distribution sweep, not for callers

  /**
   * spawn(type, x, y, z, vx, vy, vz, rand) — `(x,y,z)` is the spawn point the CALLER has
   * already computed off `Entity.getParticleX(1.0)`/`getRandomBodyY()+0.5`/`getParticleZ(1.0)`
   * (.decomp/net/minecraft/entity/Entity.java:2951-2988) — this file does not reach into an
   * entity's own fields, the same separation `Breed.spawnXp` already draws against
   * `EntityList.spawn`. `type` is `'heart' | 'angry_villager' | 'happy_villager' | 'smoke'`.
   */
  /**
   * WorldRenderer.getRandomParticleSpawnChance(alwaysSpawn) (WorldRenderer.java:2692-2703): the
   * level after the two random demotions. mode 0 All, 1 Decreased, 2 Minimal; r() is world.random.
   */
  Px.calculateParticleLevel = function (mode, alwaysSpawn, r) {
    if (alwaysSpawn && mode === 2 && Math.floor(r() * 10) === 0) mode = 1;
    if (mode === 1 && Math.floor(r() * 3) === 0) mode = 2;
    return mode;
  };
  // lockstep trace (#6258): hand back this tick's { id: count } spawn log and start a fresh one.
  Px.drainTally = function () { var t = Px.tally; if (t) Px.tally = {}; return t || {}; };
  Px.spawn = function (type, x, y, z, vx, vy, vz, rand, item, extra) {
    if (!Px.ready) Px.init();
    if (Px.tally) Px.tally[type] = (Px.tally[type] | 0) + 1;   // lockstep trace: [[id,count]] per tick (#6219)
    // ClientWorld.addParticle -> WorldRenderer.spawnParticle (force=false): Minimal refuses. Block
    // break/hit dust goes through ParticleManager directly in vanilla, so it is never gated.
    var lvl = NS.Settings && NS.Settings.particles | 0;
    if (lvl && type !== 'block' && Px.calculateParticleLevel(lvl, false, rand || Math.random) === 2) return null;
    if (Px.list.length >= Px.MAX) return null;
    var r = rand || Math.random;
    var p;
    // loop/particledraw -- `BillboardParticle`'s own base scale roll (BillboardParticle.java:12:
    // `0.1F * (random.nextFloat()*0.5F + 0.5F) * 2.0F`), read here ONCE per spawn because every
    // one of this unit's three types is a `SpriteBillboardParticle` (a `BillboardParticle`) and
    // each subclass only ever MULTIPLIES this roll, never replaces it. Draw-only: no existing
    // simulation field reads it, so adding it cannot move a single already-checked number.
    var baseScale = 0.1 * (r() * 0.5 + 0.5) * 2;
    if (type === 'heart') {
      // EmotionParticle(ClientWorld,x,y,z) — .decomp/net/minecraft/client/particle/
      // EmotionParticle.java:8-18.
      // ⚠⚠ THE CALLER'S vx/vy/vz ARE DISCARDED, ON PURPOSE, BECAUSE THE JAR DISCARDS THEM.
      // `HeartFactory.method_3035` receives the gaussian*0.02 roll every one of this unit's
      // three call sites makes, but its own `new EmotionParticle(world, x, y, z)` call never
      // passes the velocity on (EmotionParticle's constructor only takes world/x/y/z) — the
      // constructor then hardcodes velocity to (0,0,0) and does `velocityY += 0.1`
      // (EmotionParticle.java:9,13-16). Every heart in vanilla 1.18.2 rises dead straight,
      // however wide the roll's own spread was. That is the JAR'S rounding, not this file's,
      // and `Px.spawn` matches it rather than "fixing" a bug the game does not have.
      p = { type: 'heart', x: x, y: y, z: z, vx: 0, vy: 0.1, vz: 0,
            gravityStrength: 0, velocityMultiplier: 0.86,          // EmotionParticle.java:12
            age: 0, maxAge: 16,                                    // EmotionParticle.java:14
            scale: baseScale * 1.5 };                              // EmotionParticle.java:16
    } else if (type === 'angry_villager') {
      // loop/vbbreed -- `AngryVillagerFactory.method_3034` (.decomp/net/minecraft/client/
      // particle/EmotionParticle.java:31-44) is the SAME `EmotionParticle` class as HEART
      // above (identical physics: velocityMultiplier 0.86, maxAge 16, scale*1.5), constructed
      // with `y + 0.5` instead of `y` verbatim (EmotionParticle.java:39: `new EmotionParticle
      // ($$1, $$2, $$3 + 0.5, $$4)`) -- the ONE difference from HEART's own call
      // (HeartFactory.method_3035, EmotionParticle.java:53-57, no offset). Same discarded-
      // velocity caveat as heart (constructor only takes world/x/y/z).
      p = { type: 'angry_villager', x: x, y: y + 0.5, z: z, vx: 0, vy: 0.1, vz: 0,
            gravityStrength: 0, velocityMultiplier: 0.86,
            age: 0, maxAge: 16,
            scale: baseScale * 1.5 };
    } else if (type === 'note') {
      // NoteParticle (NoteParticle.java, read whole) on Particle's 7-arg constructor (Particle.java:59-69):
      // `vx` is the note/24 hue and is NOT velocity (the factory passes 0,0,0 to super); v *= 0.01, vy += 0.2
      var nvx = (r() * 2 - 1) * 0.4, nvy = (r() * 2 - 1) * 0.4, nvz = (r() * 2 - 1) * 0.4;
      var nsp = (r() + r() + 1) * 0.15, nd = Math.sqrt(nvx * nvx + nvy * nvy + nvz * nvz) || 1;
      var hue = vx || 0, TAU = Math.PI * 2;
      p = { type: 'note', x: x, y: y, z: z,
            vx: nvx / nd * nsp * 0.4 * 0.01, vy: (nvy / nd * nsp * 0.4 + 0.1) * 0.01 + 0.2, vz: nvz / nd * nsp * 0.4 * 0.01,
            gravityStrength: 0, velocityMultiplier: 0.66, slide: true,
            age: 0, maxAge: 6, scale: baseScale * 1.5,
            red: Math.max(0, Math.sin(hue * TAU) * 0.65 + 0.35),
            green: Math.max(0, Math.sin((hue + 0.33333334) * TAU) * 0.65 + 0.35),
            blue: Math.max(0, Math.sin((hue + 0.6666667) * TAU) * 0.65 + 0.35) };
    } else if (type === 'totem_of_undying') {
      // TotemParticle (TotemParticle.java, read whole) on AnimatedParticle (gravity 1.25, velocityMultiplier set to 0.6):
      // velocity IS the caller's, scale *0.75, maxAge 60..71, colour: 1 in 4 yellow, else green.
      var tage = 60 + Math.floor(r() * 12), tr, tg, tb;
      if (Math.floor(r() * 4) === 0) { tr = 0.6 + r() * 0.2; tg = 0.6 + r() * 0.3; tb = r() * 0.2; }
      else { tr = 0.1 + r() * 0.2; tg = 0.4 + r() * 0.3; tb = r() * 0.2; }
      p = { type: 'totem_of_undying', x: x, y: y, z: z, vx: vx, vy: vy, vz: vz,
            gravityStrength: 1.25, velocityMultiplier: 0.6,
            age: 0, maxAge: tage, scale: baseScale * 0.75, red: tr, green: tg, blue: tb };
    } else if (type === 'happy_villager') {
      // SuspendParticle (HappyVillagerFactory) — .decomp/net/minecraft/client/particle/
      // SuspendParticle.java:7-18,80-93. Velocity IS the caller's own vx/vy/vz here (unlike
      // heart/smoke below, this factory does not discard it), scaled *0.02 — every call site
      // in THIS unit's scope passes 0,0,0 (PassiveEntity.tickMovement's own growth-puff loop
      // always calls `addParticle(HAPPY_VILLAGER, x, y+0.5, z, 0.0, 0.0, 0.0)`), so the puffs
      // this file spawns sit still, which is the jar's own behaviour for this call site, not
      // an omission. maxAge is `(int)(20.0 / (Math.random()*0.8 + 0.2))` — 20..100 ticks,
      // rolled per particle, not a constant this engine can precompute once
      // (SuspendParticle.java:18).
      p = { type: 'happy_villager', x: x, y: y, z: z,
            vx: (vx || 0) * 0.02, vy: (vy || 0) * 0.02, vz: (vz || 0) * 0.02,
            velocityMultiplier: 0.99, suspendTick: true,           // SuspendParticle.java:37-39
            age: 0, maxAge: Math.round(20 / (r() * 0.8 + 0.2)),    // SuspendParticle.java:18
            scale: baseScale * (r() * 0.6 + 0.5) };                // SuspendParticle.java:14
    } else if (type === 'mycelium') {
      // SuspendParticle.MyceliumFactory (SuspendParticle.java:8-18,95-104): the happy_villager shape, grey
      // 0.2..0.3 (the ctor's roll, kept by this factory), no maxAge override. The phantom's wingtip spores.
      var mg = r() * 0.1 + 0.2;
      p = { type: 'mycelium', x: x, y: y, z: z, red: mg, green: mg, blue: mg,
            vx: (vx || 0) * 0.02, vy: (vy || 0) * 0.02, vz: (vz || 0) * 0.02,
            velocityMultiplier: 0.99, suspendTick: true,
            age: 0, maxAge: Math.floor(20 / (r() * 0.8 + 0.2)),
            scale: baseScale * (r() * 0.6 + 0.5) };
    } else if (type === 'composter') {
      // SuspendParticle.Factory (SuspendParticle.java:64-78; ParticleManager registers COMPOSTER on it): white,
      // maxAge 3 + nextInt(5), velocity the caller's own *0.02 like the other suspend factories.
      p = { type: 'composter', x: x, y: y, z: z, red: 1, green: 1, blue: 1,
            vx: (vx || 0) * 0.02, vy: (vy || 0) * 0.02, vz: (vz || 0) * 0.02,
            velocityMultiplier: 0.99, suspendTick: true,
            age: 0, maxAge: 3 + Math.floor(r() * 5),
            scale: baseScale * (r() * 0.6 + 0.5) };
    } else if (type === 'dolphin') {
      // SuspendParticle.DolphinFactory (SuspendParticle.java:75-85): the mycelium shape, colour (0.3,0.5,1.0),
      // alpha 1 - rand*0.7, maxAge halved.
      var da = 1 - r() * 0.7, dm = Math.floor(20 / (r() * 0.8 + 0.2));
      p = { type: 'dolphin', x: x, y: y, z: z, red: 0.3, green: 0.5, blue: 1, alpha: da,
            vx: (vx || 0) * 0.02, vy: (vy || 0) * 0.02, vz: (vz || 0) * 0.02,
            velocityMultiplier: 0.99, suspendTick: true,
            age: 0, maxAge: Math.floor(dm / 2),
            scale: baseScale * (r() * 0.6 + 0.5) };
    } else if (type === 'smoke') {
      // FireSmokeParticle/AscendingParticle — .decomp/net/minecraft/client/particle/
      // AscendingParticle.java:9-44, FireSmokeParticle.java:7-9. `FireSmokeParticle` calls
      // `super(..., 0.1F,0.1F,0.1F, vx,vy,vz, ..., 0.3F, 8, -0.1F, true)`: the 0.1F dx/dy/dz
      // factors multiply the particle's own STARTING velocity, which `AscendingParticle`'s own
      // `super()` call always sets to (0,0,0) (AscendingParticle.java:27) — so those factors
      // are a no-op and the FINAL velocity is the caller's vx/vy/vz added UNSCALED
      // (AscendingParticle.java:32-38, the `+=` after the `*=`). gravityStrength is the
      // literal `-0.1F` (rises); maxAge is `(int)(8 / (rand*0.8+0.2))` — 8..40 ticks
      // (AscendingParticle.java:41-42).
      p = { type: 'smoke', x: x, y: y, z: z, vx: vx || 0, vy: vy || 0, vz: vz || 0,
            gravityStrength: -0.1, velocityMultiplier: 0.96,       // AscendingParticle.java:29
            age: 0, maxAge: Math.max(1, Math.round(8 / (r() * 0.8 + 0.2))),
            // AscendingParticle.java:38-42: grayShade is FireSmokeParticle's own hardcoded
            // 0.3F (FireSmokeParticle.java:8) regardless of the `size` the factory passes;
            // scale is `0.75F * size` on the base roll, size == 1.0F at this unit's own call
            // site (TameableEntity fail -> SMOKE, the same class LARGE_SMOKE also registers).
            scale: baseScale * 0.75, shade: r() * 0.3 };
    } else if (type === 'cloud' || type === 'sneeze') {   // SneezeFactory = CloudParticle + setColor(200,50,120) (raw ints, saturates to white) + alpha 0.4
      // CloudParticle (.decomp CloudParticle.java:12-34): 6-arg Particle ctor (zero start v), v = caller v,
      // velocityMultiplier 0.96, no gravity, no world collision, grey 1-rand*0.3, scale*1.875,
      // maxAge (int)max((int)(8/(rand*0.8+0.3))*2.5, 1); sprites are cloud.json == smoke's generic_7..0.
      // (The closest-player y-drag in CloudParticle.tick is not ported.)
      var cshade = 1 - r() * 0.3;
      var cscale = baseScale * 1.875;
      p = { type: type, x: x, y: y, z: z, vx: vx || 0, vy: vy || 0, vz: vz || 0,
            gravityStrength: 0, velocityMultiplier: 0.96,
            age: 0, maxAge: Math.max(Math.floor(Math.floor(8 / (r() * 0.8 + 0.3)) * 2.5), 1),
            scale: cscale, shade: cshade };
    } else if (type === 'poof') {
      // ExplosionSmokeParticle (.decomp .../client/particle/ExplosionSmokeParticle.java:10-21), POOF's
      // factory (`MobEntity.playSpawnEffects`): gravity -0.1, drag 0.9, caller velocity + ±0.05
      // jitter, one grey roll 0.7..1.0, scale 0.1*(rand*rand*6+1), maxAge (int)(16/(rand*0.8+0.2))+2.
      var pj = function () { return (r() * 2 - 1) * 0.05; };
      var pvx = (vx || 0) + pj(), pvy = (vy || 0) + pj(), pvz = (vz || 0) + pj();
      var pshade = r() * 0.3 + 0.7;
      var pscale = 0.1 * (r() * r() * 6 + 1);
      p = { type: 'poof', x: x, y: y, z: z, vx: pvx, vy: pvy, vz: pvz,
            gravityStrength: -0.1, velocityMultiplier: 0.9,
            age: 0, maxAge: Math.floor(16 / (r() * 0.8 + 0.2)) + 2,
            scale: pscale, shade: pshade };
    } else if (type === 'spit') {
      // SpitParticle (.decomp SpitParticle.java) on ExplosionSmokeParticle (:9-24): gravity 0.5,
      // velocityMultiplier 0.9, caller v + (Math.random()*2-1)*0.05 per axis, grey 0.7..1.0,
      // scale 0.1*(r*r*6+1), maxAge (int)(16/(r*0.8+0.2))+2. Drawn with the smoke atlas frames (spit.json == smoke.json, generic_7..0).
      // via Px.frameLayer.
      var sg = r() * 0.3 + 0.7;
      p = { type: 'spit', x: x, y: y, z: z,
            vx: (vx || 0) + (r() * 2 - 1) * 0.05, vy: (vy || 0) + (r() * 2 - 1) * 0.05, vz: (vz || 0) + (r() * 2 - 1) * 0.05,
            gravityStrength: 0.5, velocityMultiplier: 0.9, age: 0,
            maxAge: Math.floor(16 / (r() * 0.8 + 0.2)) + 2,
            scale: 0.1 * (r() * r() * 6 + 1), shade: sg };
    } else if (type === 'flame') {
      // loop/spawner-fx (#168) -- `FlameParticle` (.decomp client/particle/FlameParticle.java) on
      // `AbstractSlowingParticle` (:7-16): the 7-arg `Particle` ctor's random +-0.4 direction
      // renormalised to (rand+rand+1)*0.15*0.4 with +0.1 up (Particle.java:60-68), then
      // `v = v*0.01 + caller v`, a +-0.05 position wobble (rand-rand, x/y/z) and
      // maxAge `(int)(8/(rand*0.8+0.2)) + 4`; velocityMultiplier 0.96, no gravity. getSize is
      // `scale*(1 - t*t*0.5)` (Px.sizeOf), brightness climbs to full block light (Px.lightOf).
      var fjx = (r() * 2 - 1) * 0.4, fjy = (r() * 2 - 1) * 0.4, fjz = (r() * 2 - 1) * 0.4;
      var fmag = (r() + r() + 1) * 0.15, flen = Math.sqrt(fjx * fjx + fjy * fjy + fjz * fjz) || 1;
      p = { type: 'flame',
            vx: (fjx / flen * fmag * 0.4) * 0.01 + (vx || 0),
            vy: (fjy / flen * fmag * 0.4 + 0.1) * 0.01 + (vy || 0),
            vz: (fjz / flen * fmag * 0.4) * 0.01 + (vz || 0),
            x: x + (r() - r()) * 0.05, y: y + (r() - r()) * 0.05, z: z + (r() - r()) * 0.05,
            gravityStrength: 0, velocityMultiplier: 0.96,
            age: 0, maxAge: Math.floor(8 / (r() * 0.8 + 0.2)) + 4,
            scale: baseScale };
    } else if (type === 'item_crack') {
      // struck s117: `EggEntity.handleStatus(3)`'s 8-particle burst (`Th.OWED`'s own line,
      // 07zzd_throw.js) -- `CrackParticle(ClientWorld,x,y,z,vx,vy,vz,stack)` (.decomp/net/
      // minecraft/client/particle/CrackParticle.java:14-22): the internal start velocity is
      // (0,0,0), so its own `*0.1F` scale-down is a no-op and the FINAL velocity is the
      // caller's (vx,vy,vz) verbatim -- `EggEntity`'s own `(rand-0.5)*0.08` triple, unscaled
      // again here. `gravityStrength` 1.0F, `scale` halved (CrackParticle.java:31,33) off the
      // SAME `baseScale` roll every other type here shares.
      // s118 CORRECTED (two s117 stand-ins replaced off .decomp Particle.java:49-69, which this
      // checkout DOES carry): maxAge is the base constructor's `(int)(4/(rand*0.9+0.1))` (4..40
      // ticks, Particle.java:56), not 20; and the "internal start velocity" is NOT zero -- the
      // 7-arg `Particle` constructor CrackParticle's own super(...,0,0,0) reaches adds a random
      // +-0.4 direction, renormalised to (rand+rand+1)*0.15*0.4 with +0.1 up (Particle.java:
      // 60-68); CrackParticle then scales THAT by 0.1 and adds the caller's velocity (:15-21).
      // sampleU/sampleV (CrackParticle.java:34-35) pick the 4x4-texel window of the item's own
      // icon this crumb shows (`Px.buildQuads`).
      var crackAge = Math.floor(4 / (r() * 0.9 + 0.1));             // Particle.java:56
      var jx = (r() * 2 - 1) * 0.4, jy = (r() * 2 - 1) * 0.4, jz = (r() * 2 - 1) * 0.4;
      var jmag = (r() + r() + 1) * 0.15, jlen = Math.sqrt(jx * jx + jy * jy + jz * jz) || 1;
      p = { type: 'item_crack', x: x, y: y, z: z,
            vx: (jx / jlen * jmag * 0.4) * 0.1 + (vx || 0),
            vy: (jy / jlen * jmag * 0.4 + 0.1) * 0.1 + (vy || 0),
            vz: (jz / jlen * jmag * 0.4) * 0.1 + (vz || 0),
            gravityStrength: 1.0, velocityMultiplier: 0.98,        // base Particle.java default
            age: 0, maxAge: crackAge,
            item: item || 'egg',
            sampleU: r() * 3, sampleV: r() * 3,                    // CrackParticle.java:34-35
            scale: baseScale / 2 };                                // CrackParticle.java:33
    } else if (type === 'portal') {
      // struck s117: `EnderPearlEntity.onCollision`'s 32-particle teleport trail (`Th.OWED`'s
      // own line) -- `PortalParticle` (.decomp/net/minecraft/client/particle/
      // PortalParticle.java:11-27). ⚠ POSITION IS NOT INTEGRATED FROM VELOCITY like every
      // other type here -- it is replayed off (startX/Y/Z, vx/vy/vz) through the source's own
      // eased curve every tick (PortalParticle.java:64-76), handled as a special case in
      // `Px.tick` below, not through the generic `p.x += p.vx` branch. `maxAge` is
      // `(int)(Math.random()*10.0)+40` in the jar (PortalParticle.java:26) -- rolled through
      // the caller's own `r` here instead of the JVM-global `Math.random()` the class literally
      // calls, the same determinism substitution `Px.spawn`'s own gaussian helper already makes
      // everywhere else in this file (its own header, `Box-Muller` note).
      var portalShade = r() * 0.6 + 0.4;                            // PortalParticle.java:23
      p = { type: 'portal', x: x, y: y, z: z, startX: x, startY: y, startZ: z,
            vx: vx || 0, vy: vy || 0, vz: vz || 0,
            scale: 0.1 * (r() * 0.2 + 0.5),                         // PortalParticle.java:22
            red: portalShade * 0.9, green: portalShade * 0.3, blue: portalShade,
            age: 0, maxAge: Math.floor(r() * 10) + 40, portal: true,
            // s118: `setSprite(spriteProvider)` -> `getSprite(random)` (PortalParticle.java:25,
            // SpriteBillboardParticle.java:39-41): ONE random frame for the whole life, not an
            // age-walked one like smoke's. Rolled once here, resolved in `Px.frameLayer`.
            spriteRoll: r() };
    } else if (type === 'falling_nectar') {
      // FallingNectarFactory (BlockLeakParticle.java:321-336) on `Falling`: velocity 0, gravity 0.007F,
      // maxAge (int)(16/(rand*0.8+0.2)), colour (0.92,0.782,0.72), one random frame of falling_nectar.json.
      p = { type: 'falling_nectar', x: x, y: y, z: z, vx: 0, vy: 0, vz: 0, width: 0.01, height: 0.01,
            gravityStrength: Math.fround(0.007), onGround: false, red: Math.fround(0.92), green: Math.fround(0.782), blue: Math.fround(0.72),
            age: 0, maxAge: Math.floor(16 / (r() * 0.8 + 0.2)), spriteRoll: r(), scale: baseScale };
    } else if (type === 'rain' || type === 'splash') {
      // loop/909: 'splash' = WaterSplashParticle (extends RainSplashParticle): gravity 0.04, and a caller velocity
      // (vy==0, vx|vz!=0) replaces the random one with (vx, 0.1, vz). Stored as type 'rain' (same sprites).
      // G20 (D-656): `RainSplashParticle` (.decomp/net/minecraft/client/particle/
      // RainSplashParticle.java:9-17, read whole), spawned by `Wx.tickRainSplashing`
      // (09c_weather.js). Its super is the 7-arg `Particle` constructor with (0,0,0): the random
      // +-0.4 direction renormalised to (rand+rand+1)*0.15*0.4 plus 0.1 up (Particle.java:60-68,
      // the same roll item_crack above makes); then x/z *= 0.3F, y REPLACED by
      // `Math.random()*0.2F+0.1F`, box 0.01 x 0.01, gravity 0.06F, maxAge (int)(8/(rand*0.8+0.2)).
      var rjx = (r() * 2 - 1) * 0.4, rjy = (r() * 2 - 1) * 0.4, rjz = (r() * 2 - 1) * 0.4;
      var rjm = (r() + r() + 1) * 0.15, rjl = Math.sqrt(rjx * rjx + rjy * rjy + rjz * rjz) || 1;
      var isSplash = type === 'splash';
      p = { type: 'rain', x: x, y: y, z: z, rainSplash: true,
            vx: rjx / rjl * rjm * 0.4 * 0.3,
            vy: r() * 0.2 + 0.1,
            vz: rjz / rjl * rjm * 0.4 * 0.3,
            width: 0.01, height: 0.01, gravityStrength: isSplash ? 0.04 : 0.06, onGround: false, stopped: false,
            age: 0, maxAge: Math.floor(8 / (r() * 0.8 + 0.2)),
            // `setSprite(spriteProvider)` -> one random frame of rain.json's four for the whole
            // life (SpriteBillboardParticle.java:39-41), resolved in `Px.frameLayer`.
            spriteRoll: r(),
            scale: baseScale };                                    // no getSize override
      if (isSplash && vy === 0 && (vx !== 0 || vz !== 0)) { p.vx = vx; p.vy = 0.1; p.vz = vz; }
    } else if (type === 'crit' || type === 'enchanted_hit' || type === 'damage_indicator') {
      // D-658: `DamageParticle` (.decomp client/particle/DamageParticle.java, read whole) — the
      // CRIT (`Factory`), ENCHANTED_HIT (`EnchantedHitFactory`) and DAMAGE_INDICATOR
      // (`DefaultFactory`) registrations (ParticleManager.java:101,103,115; ParticleTypes.java
      // :18,19,32). The 7-arg `Particle` constructor with (0,0,0) first: the random +-0.4
      // direction renormalised to (rand+rand+1)*0.15*0.4, +0.1 up (Particle.java:60-68); then
      // velocityMultiplier 0.7, gravity 0.5, that velocity *0.1 PLUS the caller's *0.4
      // (DamageParticle.java:10-17); grey c = rand*0.3+0.6; scale *0.75; maxAge
      // max((int)(6/(rand*0.8+0.6)),1); no world collision; and the constructor TICKS ONCE (:25).
      var dvy = vy || 0;
      if (type === 'damage_indicator') dvy += 1.0;               // DefaultFactory: `$$6 + 1.0`
      var djx = (r() * 2 - 1) * 0.4, djy = (r() * 2 - 1) * 0.4, djz = (r() * 2 - 1) * 0.4;
      var djm = (r() + r() + 1) * 0.15, djl = Math.sqrt(djx * djx + djy * djy + djz * djz) || 1;
      var dc = r() * 0.3 + 0.6;
      p = { type: type, x: x, y: y, z: z, dmgTint: true,
            vx: (djx / djl * djm * 0.4) * 0.1 + (vx || 0) * 0.4,
            vy: (djy / djl * djm * 0.4 + 0.1) * 0.1 + dvy * 0.4,
            vz: (djz / djl * djm * 0.4) * 0.1 + (vz || 0) * 0.4,
            gravityStrength: 0.5, velocityMultiplier: 0.7,
            red: dc, green: dc, blue: dc,
            age: 0, maxAge: Math.max(Math.floor(6 / (r() * 0.8 + 0.6)), 1),
            scale: baseScale * 0.75 };
      // the constructor's own `this.tick()` — `Particle.tick` (age 0 < maxAge >= 1, so it moves;
      // collidesWithWorld is false, so a plain translate) then DamageParticle's green/blue fade.
      p.vy -= 0.04 * p.gravityStrength;
      p.x += p.vx; p.y += p.vy; p.z += p.vz;
      p.vx *= p.velocityMultiplier; p.vy *= p.velocityMultiplier; p.vz *= p.velocityMultiplier;
      p.age++;
      p.green *= 0.96; p.blue *= 0.9;
      if (type === 'damage_indicator') p.maxAge = 20;            // DefaultFactory: setMaxAge(20)
      if (type === 'enchanted_hit') { p.red *= 0.3; p.green *= 0.8; }   // EnchantedHitFactory
    } else if (type === 'explosion') {
      // ExplosionLargeParticle (.decomp ExplosionLargeParticle.java:10-20): zero velocity, maxAge 6 + nextInt(4),
      // grey 0.4..1.0, scale 2*(1 - vx*0.5) (vx = the caller's age fraction), tick = age++ >= maxAge -> die.
      var egr = Math.fround(r() * 0.6 + 0.4);
      p = { type: 'explosion', x: x, y: y, z: z, vx: 0, vy: 0, vz: 0, sweepTick: true,
            age: 0, maxAge: 6 + Math.floor(r() * 4), shade: egr, scale: 2 * (1 - (vx || 0) * 0.5) };
    } else if (type === 'explosion_emitter') {
      // ExplosionEmitterParticle (.decomp ExplosionEmitterParticle.java): invisible; each tick 6 'explosion'
      // children at +-4 (rand-rand) with vx = age/8, dies when age reaches 8 (ticked in Px.tick).
      p = { type: 'explosion_emitter', x: x, y: y, z: z, vx: 0, vy: 0, vz: 0, emitter: true, age: 0, maxAge: 8, rand: r };
    } else if (type === 'sweep_attack') {
      // D-658: `SweepAttackParticle` (.decomp client/particle/SweepAttackParticle.java, read
      // whole): maxAge 4, grey c = nextFloat*0.6+0.4, scale = 1 - vx*0.5 (the caller's FIRST
      // velocity term is the size, not a velocity), full-bright, never moves; its tick only ages
      // it and walks sweep_0..7 by `setSpriteForAge`.
      var sc = r() * 0.6 + 0.4;
      p = { type: 'sweep_attack', x: x, y: y, z: z, vx: 0, vy: 0, vz: 0, sweepTick: true,
            red: sc, green: sc, blue: sc,
            age: 0, maxAge: 4, scale: 1.0 - (vx || 0) * 0.5 };
    } else if (type === 'effect' || type === 'instant_effect' || type === 'witch') {
      // loop/potion-splash-impact -- `PotionEntity.onCollision`'s own `world.syncWorldEvent
      // (2002|2007, blockPos, color)` (.decomp thrown/PotionEntity.java:88-91), handled by
      // `WorldRenderer.processWorldEvent` case 2002/2007 (.decomp client/render/WorldRenderer.
      // java:2964-2999, read whole): the ONE HUNDRED tinted splash particles, `effect` for 2002
      // and `instant_effect` for 2007 -- SAME class (`SpellParticle`, .decomp client/particle/
      // SpellParticle.java, read whole), different sprite sheet only. `Px.spawnPotionSplash`
      // below is the caller: its own `vx,vy,vz` are the world event's circle-offset triple
      // (`dx, dy, dz` -- WorldRenderer.java:2988-2993), and `extra` is that SAME call's own
      // per-particle radius roll, reused for BOTH the caller's own position-offset math (10%
      // radius, done by the caller, not here) and `Particle.move((float)radius)`
      // (WorldRenderer.java:2996, Particle.java:71-75), applied below.
      //
      // ⚠ THE CALLER'S vx/vz ARE NOT THIS PARTICLE'S OWN VELOCITY -- `SpellParticle`'s own
      // constructor (SpellParticle.java:13) calls `super(world,x,y,z, 0.5-RANDOM.nextDouble(),
      // vy, 0.5-RANDOM.nextDouble())`: horizontal velocity is a FRESH roll, the caller's dx/dz
      // reach only the zero-check below (SpellParticle.java:20-23) and this file's own position
      // math (the caller's job). `velocityY *= 0.2F` (:19) is the one component that survives.
      var sevx = 0.5 - r(), sevz = 0.5 - r();             // SpellParticle.java:13
      var sevy = (vy || 0) * 0.2;                          // SpellParticle.java:19
      if ((vx || 0) === 0 && (vz || 0) === 0) { sevx *= 0.1; sevz *= 0.1; }   // :20-23
      if (extra !== undefined) {   // #651: entity_effect (SpellcastingIllager) never calls Particle.move
        var moveScale = extra || 0;                          // WorldRenderer.java:2996's own radius
        sevx *= moveScale; sevz *= moveScale;                 // Particle.move -- Particle.java:72,74
        sevy = (sevy - 0.1) * moveScale + 0.1;                // Particle.java:73
      }
      p = { type: type, x: x, y: y, z: z, vx: sevx, vy: sevy, vz: sevz,
            gravityStrength: -0.1, velocityMultiplier: 0.96, slide: true,   // SpellParticle.java:16-18
            red: 1, green: 1, blue: 1,   // `Px.spawnPotionSplash` overwrites with its own tint
            age: 0, maxAge: Math.floor(8 / (r() * 0.8 + 0.2)),              // SpellParticle.java:26
            scale: baseScale * 0.75 };                                       // SpellParticle.java:25
      if (type === 'witch') {   // SpellParticle.WitchFactory (:120-124): setColor(c, 0, c), c = rand*0.5+0.35
        var wc = r() * 0.5 + 0.35; p.red = wc; p.green = 0; p.blue = wc;
      }
    } else if (type === 'bubble') {
      // WaterBubbleParticle (.decomp client/particle/WaterBubbleParticle.java, read whole): 0.02 box, scale *
      // (rand*0.6+0.2), velocity = caller*0.2F + (Math.random*2-1)*0.02 a component, maxAge (int)(8/(Math.random*0.8+0.2)).
            p = { type: 'bubble', bubble: true, width: 0.02, height: 0.02, x: x, y: y, z: z,
            vx: (vx || 0) * Math.fround(0.2) + (r() * 2 - 1) * 0.02,
            vy: (vy || 0) * Math.fround(0.2) + (r() * 2 - 1) * 0.02,
            vz: (vz || 0) * Math.fround(0.2) + (r() * 2 - 1) * 0.02,
            gravityStrength: 0, velocityMultiplier: Math.fround(0.85),
            age: 0, maxAge: Math.floor(8 / (r() * 0.8 + 0.2)),
            scale: baseScale * (r() * 0.6 + 0.2) };
    } else if (Px.GLOW[type]) {
      // D-664: `GlowParticle` (.decomp client/particle/GlowParticle.java, read whole) through the
      // four factories the 3002-3005 world events reach. The constructor is the 7-arg Particle
      // one with (0,0,0) — its Math.random jitter is discarded by every one of these factories'
      // own `setVelocity` — then velocityMultiplier 0.96, field_28787 (the slide: x/z *1.1 on a
      // tick whose y did not move), scale *0.75, no world collision, one sprite (glow).
      var g = Px.GLOW[type];
      var gc = g.color2 && r() < 0.5 ? g.color2 : g.color;         // ScrapeFactory: random.nextBoolean()
      p = { type: type, x: x, y: y, z: z, glow: true,
            vx: (vx || 0) * g.vxz, vy: (vy || 0) * g.vy, vz: (vz || 0) * g.vxz,
            gravityStrength: 0, velocityMultiplier: 0.96, slide: true,
            red: gc[0], green: gc[1], blue: gc[2],
            age: 0, maxAge: g.ageMin + Math.floor(r() * g.ageSpan),
            scale: baseScale * 0.75 };
    } else if (type === 'squid_ink' || type === 'glow_squid_ink') {
      // SquidInkParticle (.decomp SquidInkParticle.java, read whole): velocity = the caller's, no gravity
      // (AnimatedParticle 0), velocityMultiplier 0.92, scale 0.5, no world collision, maxAge
      // (int)(0.5*12/(rand*0.8+0.2)); the colour is `setColor(255,255,255)` / `(204,31,102)` AS THE JAR
      // PASSES IT (raw 0..255 ints into a 0..1 float setter). Per tick: alpha fades after half-life and
      // `velocityY -= 0.0074` while its own cell is air (`p.ink`, `Px.tick`).
      p = { type: type, x: x, y: y, z: z, vx: vx || 0, vy: vy || 0, vz: vz || 0,
            gravityStrength: 0, velocityMultiplier: 0.92, ink: true, alpha: 1,
            red: type === 'squid_ink' ? 255 : 204, green: type === 'squid_ink' ? 255 : 31, blue: type === 'squid_ink' ? 255 : 102,
            age: 0, maxAge: Math.floor(6 / (r() * 0.8 + 0.2)), scale: 0.5 };
    } else if (type === 'glow') {
      // GlowParticle.GlowFactory (GlowParticle.java:67-93; the squid's ambient `field_28479`): the 7-arg
      // Particle ctor on (0.5-rand, vy, 0.5-rand) (Particle.java:59-69: +-0.4 jitter renormalised to
      // (rand+rand+1)*0.15*0.4, +0.1 up), vy*0.2, x/z*0.1 when the caller's vx and vz are 0, one of two
      // colours, maxAge (int)(8/(rand*0.8+0.2)), scale*0.75, slide, drag 0.96, no collision.
      var gx = 0.5 - r() + (r() * 2 - 1) * 0.4, gy = (vy || 0) + (r() * 2 - 1) * 0.4, gz = 0.5 - r() + (r() * 2 - 1) * 0.4;
      var gsp = (r() + r() + 1) * 0.15, gl = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
      var gvx = gx / gl * gsp * 0.4, gvy = (gy / gl * gsp * 0.4 + 0.1) * 0.2, gvz = gz / gl * gsp * 0.4;
      if (!vx && !vz) { gvx *= 0.1; gvz *= 0.1; }
      var gcol = r() < 0.5 ? [0.6, 1.0, 0.8] : [0.08, 0.4, 0.4];
      p = { type: 'glow', x: x, y: y, z: z, glow: true, vx: gvx, vy: gvy, vz: gvz,
            gravityStrength: 0, velocityMultiplier: 0.96, slide: true,
            red: gcol[0], green: gcol[1], blue: gcol[2],
            age: 0, maxAge: Math.floor(8 / (r() * 0.8 + 0.2)), scale: baseScale * 0.75 };
    } else if (type === 'end_rod') {
      // EndRodParticle (.decomp EndRodParticle.java) on AnimatedParticle: gravity 0.0125, drag 0.91, caller v,
      // scale*0.75, maxAge 60 + nextInt(12), colour fades to 15916745 (0xF2F2C9) after half-life, alpha fades out;
      // `move` is a plain box offset (no world collision) = the generic branch of Px.tick. ponytail: no sprite layer
      // yet (end_rod.json frames are not in particle-tex), so Px.frameLayer returns -1 and it is simulated, not drawn.
      p = { type: 'end_rod', x: x, y: y, z: z, vx: vx || 0, vy: vy || 0, vz: vz || 0,
            gravityStrength: 0.0125, velocityMultiplier: 0.91, red: 1, green: 1, blue: 1, alpha: 1,
            age: 0, maxAge: 60 + Math.floor(r() * 12), scale: baseScale * 0.75 };
    } else if (type === 'dragon_breath') {
      // DragonBreathParticle (.decomp DragonBreathParticle.java): drag 0.96, red U(.7176,.8745) green 0 blue U(.8235,.9765),
      // scale*0.75, maxAge (int)(20/(rand*0.8+0.2)); simulated by the generic branch (no sprite layer yet, like end_rod).
      p = { type: 'dragon_breath', x: x, y: y, z: z, vx: vx || 0, vy: vy || 0, vz: vz || 0,
            gravityStrength: 0, velocityMultiplier: 0.96, red: 0.7176471 + r() * (0.8745098 - 0.7176471), green: 0, blue: 0.8235294 + r() * (0.9764706 - 0.8235294), alpha: 1,
            age: 0, maxAge: Math.floor(20 / (r() * 0.8 + 0.2)), scale: baseScale * 0.75 };
    } else if (type === 'bubble_column_up') {
      // BubbleColumnUpParticle (.decomp BubbleColumnUpParticle.java, read whole): gravity -0.125, drag 0.85,
      // v = caller*0.2 + +-0.02, scale*(rand*0.6+0.2), maxAge (int)(40/(rand*0.8+0.2)); dies out of water
      // (`p.needsWater`, `Px.tick`).
      p = { type: type, x: x, y: y, z: z, needsWater: true,
            vx: (vx || 0) * 0.2 + (r() * 2 - 1) * 0.02, vy: (vy || 0) * 0.2 + (r() * 2 - 1) * 0.02, vz: (vz || 0) * 0.2 + (r() * 2 - 1) * 0.02,
            gravityStrength: -0.125, velocityMultiplier: 0.85,
            age: 0, maxAge: Math.floor(40 / (r() * 0.8 + 0.2)), scale: baseScale * (r() * 0.6 + 0.2) };
    } else if (type === 'vibration') {
      // VibrationParticle (.decomp VibrationParticle.java): spawns at the origin block centre, scale 0.3, maxAge =
      // arrival ticks; tick() lerps origin->destination centre by age/maxAge. `extra` = {dx,dy,dz} destination block.
      p = { type: 'vibration', x: x, y: y, z: z, vibration: true, ox: x, oy: y, oz: z,
            dx: extra.dx + 0.5, dy: extra.dy + 0.5, dz: extra.dz + 0.5, vx: 0, vy: 0, vz: 0,
            gravityStrength: 0, velocityMultiplier: 1, age: 0, maxAge: extra.arrival, scale: 0.3 };
    } else if (type === 'block') {
      // BlockStateParticleEffect(BLOCK, state): `extra` = the landed state. Not yet drawable (frameLayer -1): OWED.
      p = { type: 'block', state: extra, x: x, y: y, z: z, vx: vx, vy: vy, vz: vz,
            gravityStrength: 1, velocityMultiplier: 0.98, age: 0, maxAge: Math.floor(4 / (r() * 0.9 + 0.1)), scale: baseScale * 0.5 };
    } else {
      return null;   // an unknown type is a refusal, not a silent no-op (07i's own header)
    }
    Px.list.push(p);
    return p;
  };

  // ── D-658: Player.attack's hit particles ────────────────────────────────────────────────────
  // `EmitterParticle` (.decomp client/particle/EmitterParticle.java, read whole): a
  // NoRenderParticle bound to an ENTITY that, every tick for `maxEmitterAge` ticks (3 by
  // default), tries 16 random points in the unit ball (a point outside it is skipped, not
  // re-rolled) and adds one particle at `offsetX(dx/4), getBodyY(0.5+dy/4), offsetZ(dz/4)` with
  // velocity (dx, dy+0.2, dz). Its constructor ticks once. `ParticleManager.addEmitter` keeps
  // emitters in their own list, ticked AFTER the particles each frame (ParticleManager.java:
  // 300-317) — so what an emitter adds is first moved by its own constructor tick, not twice.
  Px.EMITTER_TRIES = 16;          // EmitterParticle.java:32
  Px.EMITTER_DEFAULT_AGE = 3;     // EmitterParticle.java:15
  Px.emitters = [];
  function emitterTick(em) {
    var ent = em.entity, r = em.rand;
    var w = ent.width || 0, hgt = ent.height || 0;
    for (var i = 0; i < Px.EMITTER_TRIES; i++) {
      var dx = r() * 2 - 1, dy = r() * 2 - 1, dz = r() * 2 - 1;
      if (dx * dx + dy * dy + dz * dz > 1.0) continue;
      Px.spawn(em.type, ent.x + w * (dx / 4), ent.y + hgt * (0.5 + dy / 4), ent.z + w * (dz / 4),
               dx, dy + 0.2, dz, r);
    }
    em.age++;
    return em.age < em.maxAge;
  }
  /** `ClientPlayNetworkHandler`/`LivingEntity.handleStatus(35)`: totem sound + 30 TOTEM_OF_UNDYING particles around the entity
   *  (`ParticleManager.addEmitter(entity, TOTEM_OF_UNDYING, 30)`), and for the local player the floating item. */
  Px.totemActivated = function (entity, rand) {
    if (NS.Sound && NS.Sound.play) NS.Sound.play('item.totem.use', { x: entity.x, y: entity.y, z: entity.z, source: 'player', volume: 1, pitch: 1 });
    Px.addEmitter(entity, 'totem_of_undying', 30, rand);
    if (entity.inventory && NS.Hud && NS.Hud.showFloatingItem && NS.Inventory) NS.Hud.showFloatingItem(NS.Inventory.stack('totem_of_undying', 1));
  };
  Px.addEmitter = function (entity, type, maxAge, rand) {
    if (!Px.ready) Px.init();
    if (!entity) return null;
    var em = { entity: entity, type: type, age: 0,
               maxAge: maxAge || Px.EMITTER_DEFAULT_AGE, rand: rand || Math.random };
    if (emitterTick(em)) Px.emitters.push(em);
    return em;
  };

  /** `Player.spawnSweepAttackParticles` (PlayerEntity.java:1278-1285): ONE sweep_attack one
   *  block in front of the player at body height, sent with count 0 and speed 0 — so
   *  `ClientPlayNetworkHandler.onParticle`'s count-0 branch passes speed*offset = (0,0,0) and the
   *  size term is 0 (scale 1). ⚠ Yaw: vanilla's forward is (-sin, cos) at 0 = SOUTH; this
   *  engine's is (sin, -cos) at 0 = NORTH (14_player.js lookVec) — the same point in the world. */
  Px.spawnSweep = function (P, rand) {
    var yaw = P.yaw || 0;
    var d0 = Math.sin(yaw), d1 = -Math.cos(yaw);
    return Px.spawn('sweep_attack', P.x + d0, P.y + (P.height || 1.8) * 0.5, P.z + d1,
                    0 * d0, 0, 0 * d1, rand);
  };

  /** `LivingEntity.fall` (.decomp LivingEntity.java:304-313): landing with fallDistance > 3 on a non-air state
   *  sends (int)(150 * min(0.2 + ceil(fd-3)/15, 2.5)) BLOCK particles at the feet, offsets 0, speed 0.15.
   *  Returns the count spawned (0 = none). */
  Px.landingDustCount = function (fallDistance) {
    if (!(fallDistance > 3)) return 0;
    return Math.floor(150 * Math.min(0.2 + Math.ceil(fallDistance - 3) / 15, 2.5));
  };
  Px.spawnLandingDust = function (e, state, rand) {
    if (!state) return 0;
    var k = Px.landingDustCount(e.fallDistance), n = 0, r = rand || Math.random;
    for (var i = 0; i < k; i++) {
      if (Px.spawn('block', e.x, e.y, e.z, gauss(r) * 0.15, gauss(r) * 0.15, gauss(r) * 0.15, r, null, state)) n++;
    }
    return n;
  };

  /** PlayerEntity.java:1235-1239: when the target lost MORE than 2 health, `(int)(lost*0.5)`
   *  DAMAGE_INDICATORs at (x, bodyY(0.5), z) — spawnParticles count k, offsets (0.1, 0, 0.1),
   *  speed 0.2 — i.e. onParticle's count>0 branch: six gaussians each, three for the position
   *  offset and three for the velocity (ClientPlayNetworkHandler.java:2074-2083). */
  Px.DAMAGE_INDICATOR_MIN = 2.0;
  Px.spawnDamageIndicators = function (e, lost, rand) {
    if (!(lost > Px.DAMAGE_INDICATOR_MIN)) return 0;
    var r = rand || Math.random;
    var k = Math.floor(lost * 0.5), n = 0;
    var by = e.y + (e.height || 0) * 0.5;
    for (var i = 0; i < k; i++) {
      var ox = gauss(r) * 0.1, oy = gauss(r) * 0.0, oz = gauss(r) * 0.1;
      var sx = gauss(r) * 0.2, sy = gauss(r) * 0.2, sz = gauss(r) * 0.2;
      if (Px.spawn('damage_indicator', e.x + ox, by + oy, e.z + oz, sx, sy, sz, r)) n++;
    }
    return n;
  };

  /**
   * struck s117: the egg's own 8-particle burst and the ender pearl's own 32-particle burst
   * (`Th.OWED`'s own line, 07zzd_throw.js) -- neither is `Px.spawnBurst`'s shared
   * gaussian*0.02/7-particle shape (`AnimalEntity.handleStatus`'s own, a DIFFERENT class both
   * `EggEntity`/`EnderPearlEntity` have no relation to), so each gets its own free-form caller
   * rather than being forced through a shape the jar does not use for it.
   */
  Px.EGG_BURST_COUNT = 8;                 // EggEntity.java (.decomp thrown/EggEntity.java:34)
  Px.spawnEggBurst = function (x, y, z, rand) {
    var r = rand || Math.random;
    var n = 0;
    for (var i = 0; i < Px.EGG_BURST_COUNT; i++) {
      var vx = (r() - 0.5) * 0.08, vy = (r() - 0.5) * 0.08, vz = (r() - 0.5) * 0.08;
      if (Px.spawn('item_crack', x, y, z, vx, vy, vz, r, 'egg')) n++;
    }
    return n;
  };

  /**
   * s119: `SnowballEntity.handleStatus(3)` (.decomp thrown/SnowballEntity.java, read whole): EIGHT
   * `ItemStackParticleEffect(ITEM, getItem())` crumbs at the snowball's own position with velocity
   * (0,0,0) -- unlike the egg's `(rand-0.5)*0.08` triple, the snowball passes literal zeros, so the
   * only motion is `CrackParticle`'s own scaled base-constructor jitter (`Px.spawn`'s item_crack
   * branch). Fired on EVERY collision (`onCollision` sends status 3 unconditionally, entity or block).
   */
  Px.SNOWBALL_BURST_COUNT = 8;            // SnowballEntity.java handleStatus: for ($$2 < 8)
  Px.spawnSnowballBurst = function (x, y, z, rand) {
    var r = rand || Math.random;
    var n = 0;
    for (var i = 0; i < Px.SNOWBALL_BURST_COUNT; i++) {
      if (Px.spawn('item_crack', x, y, z, 0, 0, 0, r, 'snowball')) n++;
    }
    return n;
  };

  Px.PEARL_BURST_COUNT = 32;              // EnderPearlEntity.java (.decomp thrown/EnderPearlEntity.java:42)
  Px.spawnPearlBurst = function (x, y, z, rand) {
    var r = rand || Math.random;
    var n = 0;
    for (var i = 0; i < Px.PEARL_BURST_COUNT; i++) {
      // getY() + random.nextDouble()*2.0, vx/vz = nextGaussian(), vy = 0.0 (EnderPearlEntity.
      // java:44-52) -- `gauss` is this file's own Box-Muller stand-in (see its own header).
      var vx = gauss(r), vz = gauss(r);
      if (Px.spawn('portal', x, y + r() * 2, z, vx, 0, vz, r)) n++;
    }
    return n;
  };

  /**
   * loop/potion-splash-impact -- `PotionEntity.onCollision`'s own `world.syncWorldEvent(2002|
   * 2007, blockPos, color)` (.decomp thrown/PotionEntity.java:88-91), fired for EVERY branch
   * (water splash, lingering, and the effects splash alike, read whole), handled client-side by
   * `WorldRenderer.processWorldEvent`'s `case 2002/2007` (.decomp client/render/WorldRenderer.
   * java:2964-2999, read whole): EIGHT glass-bottle item-crack crumbs at the block's own
   * bottom-center (`Vec3d.ofBottomCenter`, :2966) plus ONE HUNDRED tinted `effect`(2002)/
   * `instant_effect`(2007) particles scattered on a flat disc up to 4 blocks out.
   * `bx/by/bz` are the collision's own block position (`e.getBlockPos()` -- `Math.floor(e.x/y/
   * z)`, the SAME floor `Po.extinguishAround` already takes at its own call site in
   * `07z_potion.js`); `instant` selects 2007 vs 2002 (`Po.hasInstantEffect`); `color` is the
   * packed 0xRRGGBB int `Po.colorOf` already derives off the SAME potionId/custom this splash's
   * own effects came from -- this file does not re-derive a potion's colour, only unpacks the
   * int it is given (WorldRenderer.java:2979-2981's own `>>16/>>8/>>0 & 0xFF` triple).
   */
  Px.POTION_CRACK_COUNT = 8;      // WorldRenderer.java:2968 (`for ($26 = 0; $26 < 8; $26++)`)
  Px.POTION_SPLASH_COUNT = 100;   // WorldRenderer.java:2984 (`for ($31 = 0; $31 < 100; $31++)`)
  Px.POTION_SPLASH_RADIUS = 4.0;  // WorldRenderer.java:2985 (`$4.nextDouble() * 4.0`)
  Px.spawnPotionSplash = function (bx, by, bz, color, instant, rand) {
    var r = rand || Math.random;
    var sx = bx + 0.5, sy = by, sz = bz + 0.5;   // Vec3d.ofBottomCenter(pos) -- WorldRenderer.java:2966
    var n = 0;
    for (var i = 0; i < Px.POTION_CRACK_COUNT; i++) {
      // gaussian*0.15 x/z, nextDouble*0.2 y (WorldRenderer.java:2970-2976) -- the SAME
      // gaussian-jitter shape `item_crack`'s own doc already names for this call site.
      var cvx = gauss(r) * 0.15, cvy = r() * 0.2, cvz = gauss(r) * 0.15;
      if (Px.spawn('item_crack', sx, sy, sz, cvx, cvy, cvz, r, 'glass_bottle')) n++;
    }
    var red = (color >> 16 & 0xFF) / 255, green = (color >> 8 & 0xFF) / 255, blue = (color & 0xFF) / 255;   // :2979-2981
    var type = instant ? 'instant_effect' : 'effect';   // :2982 (`$1 == 2007 ? ... : ...`)
    for (var j = 0; j < Px.POTION_SPLASH_COUNT; j++) {
      var radius = r() * Px.POTION_SPLASH_RADIUS;   // :2986
      var angle = r() * Math.PI * 2;                 // :2987
      var dx = Math.cos(angle) * radius;             // :2988
      var dy = 0.01 + r() * 0.5;                      // :2989
      var dz = Math.sin(angle) * radius;              // :2990
      // spawn pos: bottom-center + (dx,dz)*0.1, y+0.3 (WorldRenderer.java:2991-2993)
      var pp = Px.spawn(type, sx + dx * 0.1, sy + 0.3, sz + dz * 0.1, dx, dy, dz, r, null, radius);
      if (pp) {
        var mult = 0.75 + r() * 0.25;   // WorldRenderer.java:2996 (`0.75F + nextFloat()*0.25F`)
        pp.red = red * mult; pp.green = green * mult; pp.blue = blue * mult;   // :2997
        n++;
      }
    }
    return n;
  };

  /**
   * The three SEVEN-particle bursts (breed-complete, tame success, tame fail) are the same
   * shape — `for (i=0;i<7;i++) { gaussian roll; addParticle }` — at all three call sites
   * (AnimalEntity.java:243-249, TameableEntity.java:87-92). The `7` is a bytecode literal, not
   * a `breeding-1.18.2.tsv` row (that table only carries the age/love constants
   * `extract-breeding.mjs` reads off `AgeableMob`/`Animal`; the emote-particle count belongs to
   * `TameableEntity`/`AnimalEntity.handleStatus`, a different method entirely), so it is read
   * off .decomp directly, once, here, rather than re-typed at each of the three call sites.
   */
  Px.BURST_COUNT = 7;
  /** `MobEntity.playSpawnEffects` client branch (MobEntity.java:289-306): 20 POOFs at
   *  (offsetX(1.0)-vx*10, randomBodyY-vy*10, offsetZ(1.0)-vz*10) with velocity gaussian*0.02. */
  Px.spawnEffects = function (e, rand) {
    var r = rand || Math.random, w = e.width || 0, h = e.height || 0, n = 0;
    for (var i = 0; i < 20; i++) {
      var vx = gauss(r) * 0.02, vy = gauss(r) * 0.02, vz = gauss(r) * 0.02;
      var x = e.x + w * (2 * r() - 1) - vx * 10, y = e.y + h * r() - vy * 10, z = e.z + w * (2 * r() - 1) - vz * 10;
      if (Px.spawn('poof', x, y, z, vx, vy, vz, r)) n++;
    }
    return n;
  };

  /** #1309 `RavagerEntity.roar()` (.decomp RavagerEntity.java:253-259): 40 POOFs at the box centre,
   *  velocity gaussian*0.2 on each axis. */
  Px.spawnRoar = function (e, rand) {
    var r = rand || Math.random, n = 0, cy = e.y + (e.height || 2.2) / 2;
    for (var i = 0; i < 40; i++) {
      var vx = gauss(r) * 0.2, vy = gauss(r) * 0.2, vz = gauss(r) * 0.2;
      if (Px.spawn('poof', e.x, cy, e.z, vx, vy, vz, r)) n++;
    }
    return n;
  };

  /** #1000 `WitchEntity.handleStatus(15)` (.decomp WitchEntity.java:185-199): nextInt(35)+10 -- the
   *  bound is re-rolled every loop pass, as the jar's `for` condition does -- `witch` particles at
   *  (x, maxY + 0.5, z) each offset by gaussian*0.13F, velocity 0. */
  Px.spawnWitchMagic = function (e, rand) {
    var r = rand || Math.random, n = 0;
    for (var i = 0; i < Math.floor(r() * 35) + 10; i++) {
      var ox = gauss(r) * 0.13, oy = gauss(r) * 0.13, oz = gauss(r) * 0.13;
      if (Px.spawn('witch', e.x + ox, e.y + (e.height || 0) + 0.5 + oy, e.z + oz, 0, 0, 0, r)) n++;
    }
    return n;
  };
  Px.spawnBurst = function (type, x, y, z, rand) {
    var r = rand || Math.random;
    var n = 0;
    for (var i = 0; i < Px.BURST_COUNT; i++) {
      var vx = gauss(r) * 0.02, vy = gauss(r) * 0.02, vz = gauss(r) * 0.02;
      if (Px.spawn(type, x, y, z, vx, vy, vz, r)) n++;
    }
    return n;
  };

  /**
   * loop/vbbreed -- `MerchantEntity.produceParticles` (.decomp/net/minecraft/entity/passive/
   * MerchantEntity.java:198-204), `VillagerEntity.handleStatus`'s own caller for status 12
   * (HEART) and 13 (ANGRY_VILLAGER) (VillagerEntity.java:729-737). FIVE particles, not
   * `Px.BURST_COUNT`'s seven (`AnimalEntity.handleStatus`'s own count -- a DIFFERENT class,
   * villagers never extend it, MerchantEntity.java:40's own `extends PassiveEntity`) -- the
   * gaussian*0.02 roll is made for RNG-consumption parity the same way `Px.spawnBurst` already
   * does, even though `Px.spawn` discards it for both 'heart' and 'angry_villager' (that
   * function's own header).
   */
  Px.MERCHANT_BURST_COUNT = 5;
  Px.spawnMerchantParticles = function (type, x, y, z, rand) {
    var r = rand || Math.random;
    var n = 0;
    for (var i = 0; i < Px.MERCHANT_BURST_COUNT; i++) {
      var vx = gauss(r) * 0.02, vy = gauss(r) * 0.02, vz = gauss(r) * 0.02;
      if (Px.spawn(type, x, y, z, vx, vy, vz, r)) n++;
    }
    return n;
  };

  /**
   * Per-tick update. Called once per GAME TICK (20/s) from wherever the caller's own tick loop
   * runs — nothing here reads `dt`, because nothing in `.decomp`'s own `tick()` does either:
   * vanilla particles step once per client tick, not once per render frame (`Px.OWED`'s draw
   * line is what would need to interpolate that for a smooth 60fps picture; this step does not).
   *
   * Two shapes, both off .decomp directly:
   *   'happy_villager' (suspendTick) — SuspendParticle.tick (SuspendParticle.java:28-38): counts
   *     `maxAge` DOWN as the death test itself, applies NO gravity at all, and decays velocity
   *     by its own 0.99 (not the base class's 0.98).
   *   everything else — the base Particle.tick (.decomp/net/minecraft/client/particle/
   *     Particle.java:107-127): `age` counts UP against `maxAge`, `velocityY -= 0.04 *
   *     gravityStrength` (heart's gravityStrength is 0 — the 0.04 term is a no-op for it but
   *     kept so the formula reads the same as the jar's, not simplified away for a type that
   *     happens not to need it), then the move, then the per-axis `velocityMultiplier` decay.
   *     (`onGround`'s extra *0.7 and the `move()` world-collision probe are NOT modelled — none
   *     of this unit's three types collide with the world in vanilla either: `collidesWithWorld`
   *     is never set true for `EmotionParticle`/`AscendingParticle`'s smoke variant here, so the
   *     omission matches the jar rather than approximating it away.)
   */
  /**
   * D-656: `Particle.move` (.decomp client/particle/Particle.java:180-210) for a particle that
   * collides: `Entity.adjustMovementForCollisions(null, ...)` — Y first, then Z before X when
   * |x| < |z|, else X then Z (Entity.java:825-858), no step-up (the entity is null); a particle
   * blocked going up or down with a real request stops moving for good (`field_21507`);
   * `onGround` = y was asked for, clipped, and was downward; a clipped x/z zeroes that velocity.
   * The collider is `Physics.clip`, the player's own swept-box test.
   */
  Px.collideMove = function (p, dx, dy, dz) {
    if (p.stopped) return;
    var Ph = NS.Physics, ax = dx, ay = dy, az = dz;
    if (Ph && Ph.clip && (dx !== 0 || dy !== 0 || dz !== 0)) {
      var hw = (p.width || 0.2) / 2, h = p.height || 0.2;
      var x0 = p.x - hw, x1 = p.x + hw, z0 = p.z - hw, z1 = p.z + hw, y0 = p.y, y1 = p.y + h;
      if (dy !== 0) { dy = Ph.clip(x0, y0, z0, x1, y1, z1, 1, dy); y0 += dy; y1 += dy; }
      var zFirst = Math.abs(dx) < Math.abs(dz);
      if (zFirst && dz !== 0) { dz = Ph.clip(x0, y0, z0, x1, y1, z1, 2, dz); z0 += dz; z1 += dz; }
      if (dx !== 0) { dx = Ph.clip(x0, y0, z0, x1, y1, z1, 0, dx); if (!zFirst) { x0 += dx; x1 += dx; } }
      if (!zFirst && dz !== 0) dz = Ph.clip(x0, y0, z0, x1, y1, z1, 2, dz);
    }
    p.x += dx; p.y += dy; p.z += dz;
    if (Math.abs(ay) >= 1e-5 && Math.abs(dy) < 1e-5) p.stopped = true;
    p.onGround = ay !== dy && ay < 0;
    if (ax !== dx) p.vx = 0;
    if (az !== dz) p.vz = 0;
  };

  // ── G20 (D-659): BLOCK DUST — `BlockDustParticle` and the two `ParticleManager` emitters ──────
  // Replaces `Player.spawnBreakParticles`/`spawnHitParticles` (14_player.js, D-76/D-272): twelve
  // (then three) projected dots in one sampled texel colour, on a made-up gravity and a 4-tick
  // cadence. Vanilla, read whole off .decomp:
  //   * `ParticleManager.addBlockBreakParticles` (ParticleManager.java:405-446) — per box of the
  //     outline shape, ceil(size/0.25) (min 2) particles an axis, on a centred grid, velocity =
  //     grid position - 0.5 (a full cube is 4x4x4 = 64).
  //   * `ParticleManager.addBlockBreakingParticles` (:448-487) — ONE particle on the hit face,
  //     0.1 outside the box, `.move(0.2F).scale(0.6F)`, called by `MinecraftClient.handleBlockBreaking`
  //     (MinecraftClient.java:1471-1473) on every tick `updateBlockBreakingProgress` returns true,
  //     i.e. every tick the arm swings — the SAME condition, so it rides the swing loop.
  //   * `BlockDustParticle` (BlockDustParticle.java:20-38): gravity 1.0, colour 0.6 x the block's
  //     colour provider (not for grass_block), scale halved, a random 4x4-texel window
  //     (sampleU/V = rand*3) of the model's PARTICLE sprite (`States.particleTile`, D-659).
  //   * `Particle(world,x,y,z,vx,vy,vz)` (Particle.java:59-69): the caller's velocity plus a
  //     +-0.4 jitter, renormalised to (rand+rand+1)*0.15*0.4, +0.1 up; maxAge 4/(rand*0.9+0.1).
  //   * `Particle.tick`/`move` (Particle.java:107-128, 180-210): collides with the world
  //     (`Px.collideMove`), x0.98, x0.7 on the ground.
  Px.DUST_MIN_PER_AXIS = 2;                      // ParticleManager.java:414 `Math.max(2, ...)`
  Px.DUST_STEP = 0.25;                           // :408 `double $$3 = 0.25`
  Px.HIT_MOVE = Math.fround(0.2);                // :485 `.move(0.2F)`
  Px.HIT_SCALE = Math.fround(0.6);               // :485 `.scale(0.6F)`
  Px.DUST_GRASS = ['large_fern', 'tall_grass', 'fern', 'grass', 'potted_fern', 'sugar_cane'];
  Px.DUST_FOLIAGE = ['oak_leaves', 'jungle_leaves', 'acacia_leaves', 'dark_oak_leaves', 'vine'];
  Px.DUST_WATER = ['water', 'bubble_column', 'water_cauldron'];
  var dustKind = null;
  function dustKindOf(name) {
    if (!dustKind) {
      dustKind = Object.create(null);
      Px.DUST_GRASS.forEach(function (n) { dustKind[n] = 'grass'; });
      Px.DUST_FOLIAGE.forEach(function (n) { dustKind[n] = 'foliage'; });
      Px.DUST_WATER.forEach(function (n) { dustKind[n] = 'water'; });
      dustKind.spruce_leaves = 'spruce'; dustKind.birch_leaves = 'birch';
      dustKind.redstone_wire = 'wire'; dustKind.lily_pad = 'lily';
      dustKind.attached_melon_stem = 'attached'; dustKind.attached_pumpkin_stem = 'attached';
      dustKind.melon_stem = 'stem'; dustKind.pumpkin_stem = 'stem';
    }
    return dustKind[name];
  }
  function propNum(state, prop) {
    var R = NS.Reg, S = NS.States;
    if (!R || !R.PROP || R.PROP[prop] === undefined || !S || !S.propValue) return 0;
    var v = S.propValue(state, R.PROP[prop]);
    return v < 0 ? 0 : (parseInt(R.valueNames[v], 10) || 0);
  }
  // BiomeColors.getColor -> World.getColor(pos, resolver): the 5x5 (biome blend radius 2) average of
  // the per-column colour, each channel summed then divided by the count (ColorResolver blend loop).
  // The exact per-column colour (the biome of THAT column through Biomes.tintColor), not the 4-block
  // texel NS.Tint holds; -1 when the column is not loaded or Biomes is not up (then Tint is the fallback).
  function columnColor(ch, x, z) {
    var B = NS.Biomes, W = NS.World;
    if (!B || !B.ready || !B.tintColor || !W || !W.get) return -1;
    var c = W.get(x >> 4, z >> 4);
    if (!c || !c.biome) return -1;
    return B.tintColor(ch, c.biome[((z & 15) << 4) | (x & 15)], x, z);
  }
  function biomeSample(ch, x, z, dflt) {
    var T = NS.Tint, bx = Math.floor(x), bz = Math.floor(z), r = 0, g = 0, b = 0, n = 0;
    for (var dz = -2; dz <= 2; dz++) for (var dx = -2; dx <= 2; dx++) {
      var c = columnColor(ch, bx + dx, bz + dz);
      if (c < 0) c = (T && T.sample && T.data) ? T.sample(ch, bx + dx, bz + dz) : -1;
      if (c < 0) c = dflt;
      if (c < 0) continue;
      r += (c >> 16) & 255; g += (c >> 8) & 255; b += c & 255; n++;
    }
    if (!n) return -1;
    return ((r / n | 0) << 16) | ((g / n | 0) << 8) | (b / n | 0);
  }
  /** `BlockColors.getColor(state, world, pos, 0)` (BlockColors.java:17-66) as 0xRRGGBB, or -1
   *  for a block with no provider. The biome channels read `NS.Tint`'s map (the world's own
   *  tint source) through vanilla's 5x5 blend. */
  Px.biomeSample = biomeSample;
  Px.blockColor = function (state, x, y, z) {
    var R = NS.Reg, S = NS.States, B = NS.Biomes || {};
    if (!R || !S || !S.block) return -1;
    var kind = dustKindOf(R.names[S.block[state]]);
    if (!kind) return -1;
    if (kind === 'grass') return biomeSample(1, x, z, B.GRASS_DEFAULT || 0x91bd59);
    if (kind === 'foliage') return biomeSample(2, x, z, B.FOLIAGE_DEFAULT || 0x48b518);
    if (kind === 'water') return biomeSample(3, x, z, -1);
    if (kind === 'spruce') return 0x619961;                      // FoliageColors.getSpruceColor
    if (kind === 'birch') return 0x80a755;                       // FoliageColors.getBirchColor
    if (kind === 'lily') return 2129968;                         // world != null branch
    if (kind === 'attached') return 14731036;
    if (kind === 'stem') {                                       // BlockColors.java:52-58
      var age = propNum(state, 'age');
      return (age * 32) << 16 | (255 - age * 8) << 8 | (age * 4);
    }
    if (kind === 'wire') return Px.wireColor(propNum(state, 'power'));
    return -1;
  };
  /** `RedstoneWireBlock.getWireColor` — the COLORS table (RedstoneWireBlock.java:86-94) through
   *  `MathHelper.packRgb(float...)` (floor(c*255)). Float32 arithmetic, as the jar does it. */
  Px.wireColor = function (power) {
    var f = Math.fround, p = f(power / 15);
    var r = f(f(p * f(0.6)) + (p > 0 ? f(0.4) : f(0.3)));
    var g = Math.min(1, Math.max(0, f(f(f(p * p) * f(0.7)) - f(0.5))));
    var b = Math.min(1, Math.max(0, f(f(f(p * p) * f(0.6)) - f(0.7))));
    return (Math.floor(f(r * 255)) << 16) | (Math.floor(f(g * 255)) << 8) | Math.floor(f(b * 255));
  };

  /** #6039: the particle-atlas layer of the entity-texture dust sprite of `state` (shulker box of
   *  any colour, bell, conduit), or -1. Names come from the state's block, layers from the extractor. */
  Px.entityDustLayer = function (state) {
    var R = NS.Reg, S = NS.States, L = particleLayers();
    if (!L || !L.dust || !R || !S || !S.block) return -1;
    var n = R.names[S.block[state]];
    if (n === 'light') { var lv = propNum(state, 'level'); n = 'light_' + (lv < 10 ? '0' : '') + lv; }   // 16 models, one per level
    return typeof L.dust[n] === 'number' ? L.dust[n] : -1;
  };

  /** `new BlockDustParticle(world, x,y,z, vx,vy,vz, state, pos)`. Returns the particle, or
   *  null when the state has no particle sprite (air, barrier, light, and — named in Px.OWED —
   *  the shulker boxes/bell/conduit whose sprite is not in the block atlas). */
  Px.spawnBlockDust = function (x, y, z, vx, vy, vz, state, bx, by, bz, rand) {
    if (!Px.ready) Px.init();
    if (Px.list.length >= Px.MAX) return null;
    var S = NS.States;
    var tile = S && S.particleTile ? S.particleTile(state) : -1;
    // #6039: shulker boxes/bell/conduit: the particle sprite is an entity texture packed in the particle
    // atlas; the block atlas lookup above gives the missing-texture fallback for them, so this wins.
    var entLayer = Px.entityDustLayer(state);
    if (entLayer < 0 && tile < 0) return null;
    var r = rand || Math.random;
    var maxAge = Math.floor(4 / (r() * 0.9 + 0.1));             // Particle.java:56
    var jx = vx + (r() * 2 - 1) * 0.4, jy = vy + (r() * 2 - 1) * 0.4, jz = vz + (r() * 2 - 1) * 0.4;
    var mag = (r() + r() + 1) * 0.15, len = Math.sqrt(jx * jx + jy * jy + jz * jz) || 1;
    var baseScale = 0.1 * (r() * 0.5 + 0.5) * 2;                  // BillboardParticle.java:12
    var red = 0.6, green = 0.6, blue = 0.6;
    var R = NS.Reg;
    if (!(R && S.block && R.names[S.block[state]] === 'grass_block')) {
      var c = Px.blockColor(state, bx, by, bz);
      if (c === -1) c = 0xffffff;                                 // getColor's -1 -> *1.0 each
      red *= ((c >> 16) & 255) / 255; green *= ((c >> 8) & 255) / 255; blue *= (c & 255) / 255;
    }
    var p = { type: 'block', x: x, y: y, z: z,
              vx: jx / len * mag * 0.4, vy: jy / len * mag * 0.4 + 0.1, vz: jz / len * mag * 0.4,
              gravityStrength: 1.0, velocityMultiplier: 0.98, collide: true,
              width: 0.2, height: 0.2,                            // setBoundingBoxSpacing(0.2F,0.2F)
              age: 0, maxAge: maxAge, tile: tile, entLayer: entLayer, red: red, green: green, blue: blue,
              sampleU: r() * 3, sampleV: r() * 3,                  // BlockDustParticle.java:36-37
              bx: bx, by: by, bz: bz,                              // D-661: this.blockPos (getBrightness fallback)
              scale: baseScale / 2 };                              // BlockDustParticle.java:35
    Px.list.push(p);
    return p;
  };

  /** `ParticleManager.addBlockBreakParticles(pos, state)` — `boxes` is the outline shape as
   *  [x0,y0,z0,x1,y1,z1] local boxes (`Ray.selectionBoxes`, the SAME boxes the outline draws). */
  Px.addBlockBreakParticles = function (bx, by, bz, state, boxes, rand) {
    var out = 0;
    if (!(state > 0)) return 0;
    // #5771: no boxes given -> the block's own OUTLINE shape (`state.getOutlineShape`), not a full cube
    if (!boxes) boxes = NS.Ray && NS.Ray.selectionBoxes ? NS.Ray.selectionBoxes(state, bx, by, bz) : [[0, 0, 0, 1, 1, 1]];
    for (var b = 0; b < boxes.length; b++) {
      var q = boxes[b];
      var sx = Math.min(1, q[3] - q[0]), sy = Math.min(1, q[4] - q[1]), sz = Math.min(1, q[5] - q[2]);
      var mn = Px.DUST_MIN_PER_AXIS, st = Px.DUST_STEP;
      var nx = Math.max(mn, Math.ceil(sx / st)), ny = Math.max(mn, Math.ceil(sy / st)), nz = Math.max(mn, Math.ceil(sz / st));
      for (var i = 0; i < nx; i++) for (var j = 0; j < ny; j++) for (var k = 0; k < nz; k++) {
        var fx = (i + 0.5) / nx, fy = (j + 0.5) / ny, fz = (k + 0.5) / nz;
        if (Px.spawnBlockDust(bx + fx * sx + q[0], by + fy * sy + q[1], bz + fz * sz + q[2],
                              fx - 0.5, fy - 0.5, fz - 0.5, state, bx, by, bz, rand)) out++;
      }
    }
    return out;
  };

  /** `ParticleManager.addBlockBreakingParticles(pos, direction)` — ONE particle, on the face
   *  `(nx,ny,nz)` (the hit direction's unit normal), `.move(0.2F).scale(0.6F)`. */
  Px.addBlockBreakingParticles = function (bx, by, bz, state, nx, ny, nz, boxes, rand) {
    if (!(state > 0)) return null;
    var r = rand || Math.random;
    boxes = boxes || [[0, 0, 0, 1, 1, 1]];
    var x0 = 1, y0 = 1, z0 = 1, x1 = 0, y1 = 0, z1 = 0;           // getBoundingBox() of the shape
    for (var b = 0; b < boxes.length; b++) {
      var q = boxes[b];
      x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); z0 = Math.min(z0, q[2]);
      x1 = Math.max(x1, q[3]); y1 = Math.max(y1, q[4]); z1 = Math.max(z1, q[5]);
    }
    var F = Math.fround(0.2), T = Math.fround(0.1);               // the jar's 0.2F / 0.1F
    var x = bx + r() * (x1 - x0 - F) + T + x0;
    var y = by + r() * (y1 - y0 - F) + T + y0;
    var z = bz + r() * (z1 - z0 - F) + T + z0;
    if (ny < 0) y = by + y0 - T;
    if (ny > 0) y = by + y1 + T;
    if (nz < 0) z = bz + z0 - T;
    if (nz > 0) z = bz + z1 + T;
    if (nx < 0) x = bx + x0 - T;
    if (nx > 0) x = bx + x1 + T;
    var p = Px.spawnBlockDust(x, y, z, 0, 0, 0, state, bx, by, bz, r);
    if (!p) return null;
    var mv = Px.HIT_MOVE;                                         // Particle.move(0.2F)
    p.vx *= mv; p.vy = (p.vy - T) * mv + T; p.vz *= mv;
    var S6 = Px.HIT_SCALE;                                        // BillboardParticle.scale(0.6F)
    p.scale *= S6; p.width = 0.2 * S6; p.height = 0.2 * S6;
    return p;
  };

  // ── D-664: GlowParticle's factories and the world events that spawn them ─────────────────
  // Per factory (GlowParticle.java): colour (Scrape rolls one of two), the velocity scale its
  // `setVelocity` applies (x/z and y), and `setMaxAge(nextInt(span) + min)`.
  Px.GLOW = {
    electric_spark: { color: [1.0, 0.9, 1.0], vxz: 0.25, vy: 0.25, ageMin: 2, ageSpan: 2 },       // ElectricSparkFactory
    wax_on:  { color: [0.91, 0.55, 0.08], vxz: 0.01 / 2, vy: 0.01, ageMin: 10, ageSpan: 30 },     // WaxOnFactory
    wax_off: { color: [1.0, 0.9, 1.0], vxz: 0.01 / 2, vy: 0.01, ageMin: 10, ageSpan: 30 },        // WaxOffFactory
    scrape:  { color: [0.29, 0.58, 0.51], color2: [0.43, 0.77, 0.62], vxz: 0.01, vy: 0.01, ageMin: 10, ageSpan: 30 }  // ScrapeFactory
  };
  var DIRS = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];   // Direction.values(): D,U,N,S,W,E
  function uniformInt(r, lo, hi) { return lo + Math.floor(r() * (hi - lo + 1)); }   // UniformIntProvider.get
  function nextD(r, lo, hi) { return lo + r() * (hi - lo); }                       // MathHelper.nextDouble
  /** `ParticleUtil.spawnParticle(world, pos, effect, count)`: for EACH of the six faces its own
   *  count roll, each particle 0.55 out along the face normal, +-0.5 across it, velocity +-1 in
   *  the face's plane only. Returns how many it asked for. */
  Px.spawnOnFaces = function (type, bx, by, bz, lo, hi, rand) {
    var r = rand || Math.random, n = 0;
    for (var d = 0; d < 6; d++) {
      var o = DIRS[d], k = uniformInt(r, lo, hi);
      for (var i = 0; i < k; i++) {
        var px = bx + 0.5 + (o[0] === 0 ? nextD(r, -0.5, 0.5) : o[0] * 0.55);
        var py = by + 0.5 + (o[1] === 0 ? nextD(r, -0.5, 0.5) : o[1] * 0.55);
        var pz = bz + 0.5 + (o[2] === 0 ? nextD(r, -0.5, 0.5) : o[2] * 0.55);
        var vx = o[0] === 0 ? nextD(r, -1, 1) : 0;
        var vy = o[1] === 0 ? nextD(r, -1, 1) : 0;
        var vz = o[2] === 0 ? nextD(r, -1, 1) : 0;
        Px.spawn(type, px, py, pz, vx, vy, vz, r);
        n++;
      }
    }
    return n;
  };
  /** `ParticleUtil.spawnParticle(axis, world, pos, spread, effect, count)`: ONE count roll; along
   *  the axis +-0.5 and a +-1 velocity, across it +-spread and no velocity. */
  Px.spawnAlongAxis = function (type, axis, bx, by, bz, spread, lo, hi, rand) {
    var r = rand || Math.random, k = uniformInt(r, lo, hi);
    var ax = axis === 0, ay = axis === 1, az = axis === 2;
    for (var i = 0; i < k; i++) {
      var px = bx + 0.5 + nextD(r, -1, 1) * (ax ? 0.5 : spread);
      var py = by + 0.5 + nextD(r, -1, 1) * (ay ? 0.5 : spread);
      var pz = bz + 0.5 + nextD(r, -1, 1) * (az ? 0.5 : spread);
      Px.spawn(type, px, py, pz, ax ? nextD(r, -1, 1) : 0, ay ? nextD(r, -1, 1) : 0, az ? nextD(r, -1, 1) : 0, r);
    }
    return k;
  };
  /** `WorldRenderer.processWorldEvent` 3002-3005 (.decomp :3113-3130). 3002's data is a
   *  Direction.Axis ordinal (0 x, 1 y, 2 z — the rod's FACING axis) or -1 (a copper block the
   *  bolt scrubbed). 3003's `item.honeycomb.wax_on` sound is played by its caller (Use), once. */
  Px.worldEvent = function (id, bx, by, bz, data, rand) {
    if (id === 1505) {   // WorldRenderer 1505 -> BoneMealItem.createParticles(world, pos, data) (.decomp :141-179) + item.bone_meal.use
      var br = rand || Math.random, bW = NS.World, bS = NS.States, bst = bW && bW.getBlock ? bW.getBlock(bx, by, bz) : 0, bn = 0;
      var cnt = data === 0 ? 15 : data, spread = 0.5, hgt;
      if (!(bst > 0)) return 0;
      if (bS.block[bst] === NS.Reg.id.water) { cnt *= 3; hgt = 1; spread = 3; }
      else if (bS.visOpaque[bst] === 1) { by++; cnt *= 3; spread = 3; hgt = 1; }
      else hgt = 1;
      Px.spawn('happy_villager', bx + 0.5, by + 0.5, bz + 0.5, 0, 0, 0, br);
      for (var bi = 0; bi < cnt; bi++) {
        var vx = gauss(br) * 0.02, vy = gauss(br) * 0.02, vz = gauss(br) * 0.02;
        var qx = bx + 0.5 - spread + br() * spread * 2, qy = by + br() * hgt, qz = bz + 0.5 - spread + br() * spread * 2;
        if (bW.getBlock(Math.floor(qx), Math.floor(qy) - 1, Math.floor(qz)) !== 0 && Px.spawn('happy_villager', qx, qy, qz, vx, vy, vz, br)) bn++;
      }
      if (NS.Sound && NS.Sound.play) NS.Sound.play('item.bone_meal.use', { x: bx + 0.5, y: by + 0.5, z: bz + 0.5, source: 'block' });
      return bn;
    }
    if (id === 2005) {   // BoneMealItem.createParticles(data 0 -> 15) for a non-full-cube block: spread 0.5, height 7/16 (turtle egg)
      var r = rand || Math.random, g = function () { return (r() + r() + r() - 1.5) * 0.04; }, n = 0;
      if (Px.spawn('happy_villager', bx + 0.5, by + 0.5, bz + 0.5, 0, 0, 0, r)) n++;
      for (var i = 0; i < 15; i++) if (Px.spawn('happy_villager', bx + r(), by + r() * 0.4375, bz + r(), g(), g(), g(), r)) n++;
      return n;
    }
    if (id === 2006) {   // WorldRenderer 2006 (DragonFireballEntity impact): 200 dragon_breath in a radius-4 disc, Particle.move(speed); data 1 plays the explode sound
      var dr = rand || Math.random, dn = 0;
      for (var di = 0; di < 200; di++) {
        var sp6 = dr() * 4, an = dr() * Math.PI * 2, ox6 = Math.cos(an) * sp6, oy6 = 0.01 + dr() * 0.5, oz6 = Math.sin(an) * sp6;
        var dp = Px.spawn('dragon_breath', bx + ox6 * 0.1, by + 0.3, bz + oz6 * 0.1, ox6, oy6, oz6, dr);
        if (dp) { dn++; dp.vx *= sp6; dp.vy = (dp.vy - 0.1) * sp6 + 0.1; dp.vz *= sp6; }
      }
      if (data === 1 && NS.Sound && NS.Sound.play) NS.Sound.play('entity.dragon_fireball.explode', { x: bx, y: by, z: bz });
      return dn;
    }
    if (id === 2000) {   // WorldRenderer 2000 (dispenser smoke): data = Direction id (0 down, 1 up, 2 n, 3 s, 4 w, 5 e); 10x smoke along the facing
      var u = rand || Math.random, dx = [0, 0, 0, 0, -1, 1][data], dy = [-1, 1, 0, 0, 0, 0][data], dz = [0, 0, -1, 1, 0, 0][data], c = 0;
      var cx = bx + dx * 0.6 + 0.5, cy = by + dy * 0.6 + 0.5, cz = bz + dz * 0.6 + 0.5;
      for (var k = 0; k < 10; k++) {
        var sp = u() * 0.2 + 0.01;
        var ox = cx + dx * 0.01 + (u() - 0.5) * dz * 0.5, oy = cy + dy * 0.01 + (u() - 0.5) * dy * 0.5, oz = cz + dz * 0.01 + (u() - 0.5) * dx * 0.5;
        if (Px.spawn('smoke', ox, oy, oz, dx * sp + gauss(u) * 0.01, dy * sp + gauss(u) * 0.01, dz * sp + gauss(u) * 0.01, u)) c++;
      }
      return c;
    }
    if (id === 2004) {   // WorldRenderer 2004 (MobSpawnerLogic): 20x (smoke + flame) at the same point within +-1 of the block centre
      var q = rand || Math.random, m = 0;
      for (var j = 0; j < 20; j++) {
        var sx = bx + 0.5 + (q() - 0.5) * 2, sy = by + 0.5 + (q() - 0.5) * 2, sz = bz + 0.5 + (q() - 0.5) * 2;
        if (Px.spawn('smoke', sx, sy, sz, 0, 0, 0, q)) m++;
        if (Px.spawn('flame', sx, sy, sz, 0, 0, 0, q)) m++;
      }
      return m;
    }
    if (id === 1500) {   // ComposterBlock.playEffects (.decomp :183-195): 10x COMPOSTER across the inner 0.13125..0.8687 of the cell; data is the sound's filled flag, played by Composter
      var cr = rand || Math.random, cn = 0, top = 0.125 + 0.03125;   // outline shape's floor at the cell centre (2/16, the hole's bottom) + 1/32
      for (var ci = 0; ci < 10; ci++) {
        if (Px.spawn('composter', bx + 0.13125 + 0.7375 * cr(), by + top + cr() * (1 - top), bz + 0.13125 + 0.7375 * cr(),
                     gauss(cr) * 0.02, gauss(cr) * 0.02, gauss(cr) * 0.02, cr)) cn++;
      }
      return cn;
    }
    if (id === 3002) {
      if (data >= 0 && data < 3) return Px.spawnAlongAxis('electric_spark', data, bx, by, bz, 0.125, 10, 19, rand);
      return Px.spawnOnFaces('electric_spark', bx, by, bz, 3, 5, rand);
    }
    if (id === 3003) return Px.spawnOnFaces('wax_on', bx, by, bz, 3, 5, rand);
    if (id === 3004) return Px.spawnOnFaces('wax_off', bx, by, bz, 3, 5, rand);
    if (id === 3005) return Px.spawnOnFaces('scrape', bx, by, bz, 3, 5, rand);
    return 0;
  };

  Px.animTick = 0;   // client tick counter driving animated particle sprites (vibration.png.mcmeta)
  // G17-I1: ItemPickupParticle (.decomp client/particle/ItemPickupParticle.java) -- a separate list so
  // the billboard renderers never see it. Lives 3 ticks (tick(): ++age; ==3 -> dead).
  Px.PICKUP_LIFE = 3;
  Px.pickups = [];
  Px.spawnPickup = function (item, collector) {
    if (!item || !collector) return null;
    var p = { item: item.item, count: item.count, d: item.d, tag: item.tag, x: item.x, y: item.y, z: item.z,
              collector: collector, age: 0 };
    Px.pickups.push(p);
    return p;
  };
  // buildGeometry: t = ((age + partial) / 3)^2; target = collector lerped last->now, +0.5 up; item lerped to it.
  Px.pickupPos = function (p, partial) {
    var c = p.collector, t = (p.age + partial) / 3; t *= t;
    var lx = c.lastX !== undefined ? c.lastX : c.x, ly = c.lastY !== undefined ? c.lastY : c.y, lz = c.lastZ !== undefined ? c.lastZ : c.z;
    var tx = lx + partial * (c.x - lx), ty = ly + partial * (c.y - ly) + 0.5, tz = lz + partial * (c.z - lz);
    return [p.x + t * (tx - p.x), p.y + t * (ty - p.y), p.z + t * (tz - p.z)];
  };
  Px.tick = function () {
    Px.animTick++;
    for (var pi = Px.pickups.length - 1; pi >= 0; pi--) {
      if (++Px.pickups[pi].age >= Px.PICKUP_LIFE) Px.pickups.splice(pi, 1);
    }
    var list = Px.list;
    for (var i = list.length - 1; i >= 0; i--) {
      var p = list[i];
      if (p.portal) {
        // struck s117: `PortalParticle.tick` (.decomp client/particle/PortalParticle.java:
        // 64-76, read whole) -- position is REPLAYED off (startX/Y/Z, vx/vy/vz) through this
        // eased curve every tick, not integrated like every other type's `p.x += p.vx`; no
        // gravity, no velocityMultiplier decay (the source has neither for this class).
        if (p.age >= p.maxAge) { list.splice(i, 1); continue; }
        var t0 = p.age / p.maxAge;
        var ease = -t0 + t0 * t0 * 2;      // PortalParticle.java:70 (`var3`)
        var back = 1 - ease;               // PortalParticle.java:71 (`var4`)
        p.x = p.startX + p.vx * back;
        p.y = p.startY + p.vy * back + (1 - t0);
        p.z = p.startZ + p.vz * back;
        p.age++;
        continue;
      }
      if (p.type === 'falling_nectar') {   // BlockLeakParticle.tick + Falling.updateVelocity (onGround -> dead)
        if (p.maxAge-- <= 0) { list.splice(i, 1); continue; }
        p.vy -= p.gravityStrength;
        Px.collideMove(p, p.vx, p.vy, p.vz);
        p.vx *= 0.98; p.vy *= 0.98; p.vz *= 0.98;
        if (p.onGround) list.splice(i, 1);
        continue;
      }
      if (p.vibration) {
        if (p.age++ >= p.maxAge) { list.splice(i, 1); continue; }
        var vt = p.age / p.maxAge;
        p.x = p.ox + (p.dx - p.ox) * vt; p.y = p.oy + (p.dy - p.oy) * vt; p.z = p.oz + (p.dz - p.oz) * vt;
        continue;
      }
      if (p.rainSplash) {
        // G20 (D-656): `RainSplashParticle.tick` (RainSplashParticle.java:25-58): maxAge counts
        // DOWN, checked before the decrement; gravity is subtracted RAW (not *0.04); the move
        // collides with the world (`Particle.move`); on the ground a coin flip kills it and x/z
        // slow by 0.7; then it dies if it sits inside the top of its own cell's collision shape
        // or fluid surface.
        if (p.maxAge-- <= 0) { list.splice(i, 1); continue; }
        p.vy -= p.gravityStrength;
        Px.collideMove(p, p.vx, p.vy, p.vz);
        p.vx *= 0.98; p.vy *= 0.98; p.vz *= 0.98;
        var dead = false;
        if (p.onGround) {
          if ((Px.rainRand || Math.random)() < 0.5) dead = true;
          p.vx *= 0.7; p.vz *= 0.7;
        }
        if (!dead && Px.cellTopAt) {
          var bx = Math.floor(p.x), by = Math.floor(p.y), bz = Math.floor(p.z);
          // `getEndingCoord(Y, x - X, z - Z)` — the Y axis cycles its FIRST argument onto Z and
          // its second onto X (AxisCycleDirection, VoxelShape.java:125-132), so vanilla reads the
          // shape at (z=x-frac, x=z-frac). Reproduced, not "fixed" (09c's `Wx.shapeTop`).
          var top = Px.cellTopAt(bx, by, bz, p.x - bx, p.z - bz);
          if (top > 0 && p.y < by + top) dead = true;
        }
        if (dead) list.splice(i, 1);
        continue;
      }
      if (p.bubble) {
        // WaterBubbleParticle.tick: maxAge counts down; +0.002 vy, move, x0.85F; dies out of water.
        if (p.maxAge-- <= 0) { list.splice(i, 1); continue; }
        p.vy += 0.002;
        Px.collideMove(p, p.vx, p.vy, p.vz);
        p.vx *= p.velocityMultiplier; p.vy *= p.velocityMultiplier; p.vz *= p.velocityMultiplier;
        var wb = NS.World && NS.World.getBlock ? NS.World.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) : 0;
        if (!(wb > 0 && NS.States.block[wb] === NS.Reg.id.water)) list.splice(i, 1);
        continue;
      }
      if (p.collide) {
        // D-659: `Particle.tick` verbatim (Particle.java:107-128) — the base class's own tick,
        // WITH the world collision `move` does (the generic branch below never collided).
        if (p.age++ >= p.maxAge) { list.splice(i, 1); continue; }
        p.vy -= 0.04 * p.gravityStrength;
        Px.collideMove(p, p.vx, p.vy, p.vz);
        p.vx *= p.velocityMultiplier; p.vy *= p.velocityMultiplier; p.vz *= p.velocityMultiplier;
        if (p.onGround) { p.vx *= 0.7; p.vz *= 0.7; }
        continue;
      }
      if (p.emitter) {
        for (var ei = 0; ei < 6; ei++) {
          var er = p.rand;
          Px.spawn('explosion', p.x + (er() - er()) * 4, p.y + (er() - er()) * 4, p.z + (er() - er()) * 4,
                   Math.fround(p.age / 8), 0, 0, er);
        }
        if (++p.age === 8) list.splice(i, 1);
        continue;
      }
      if (p.sweepTick) {
        // D-658: SweepAttackParticle.tick — `if (age++ >= maxAge) die`, no motion.
        if (p.age++ >= p.maxAge) list.splice(i, 1);
        continue;
      }
      if (p.suspendTick) {
        // `if (this.maxAge-- <= 0) die; else move` -- the CURRENT value is checked, THEN
        // decremented (SuspendParticle.java:31-38): a particle with maxAge N survives N
        // physics ticks and dies on tick N+1, without a final move that tick.
        if (p.maxAge <= 0) { list.splice(i, 1); continue; }
        p.x += p.vx; p.y += p.vy; p.z += p.vz;
        p.vx *= p.velocityMultiplier; p.vy *= p.velocityMultiplier; p.vz *= p.velocityMultiplier;
        p.maxAge--;
      } else {
        // `if (this.age++ >= this.maxAge) die; else move` -- same shape, age counting UP
        // instead of maxAge counting down (Particle.java:110-124).
        if (p.age >= p.maxAge) { list.splice(i, 1); continue; }
        p.vy -= 0.04 * p.gravityStrength;
        var py0 = p.y;
        p.x += p.vx; p.y += p.vy; p.z += p.vz;
        if (p.slide && p.y === py0) { p.vx *= 1.1; p.vz *= 1.1; }   // Particle.tick's field_28787 (D-664)
        p.vx *= p.velocityMultiplier; p.vy *= p.velocityMultiplier; p.vz *= p.velocityMultiplier;
        p.age++;
        if (p.type === 'end_rod' && p.age > (p.maxAge >> 1)) {   // AnimatedParticle.tick fade
          p.alpha = 1 - (p.age - (p.maxAge >> 1)) / p.maxAge;
          p.red += (0xF2 / 255 - p.red) * 0.2; p.green += (0xF2 / 255 - p.green) * 0.2; p.blue += (0xC9 / 255 - p.blue) * 0.2;
        }
        if (p.dmgTint) { p.green *= 0.96; p.blue *= 0.9; }   // DamageParticle.tick, D-658
        if (p.ink) {   // SquidInkParticle.tick: alpha fade past half-life, sink while its cell is air
          if (p.age > (p.maxAge >> 1)) p.alpha = 1 - (p.age - (p.maxAge >> 1)) / p.maxAge;
          if (NS.World.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) === 0) p.vy -= 0.0074;
        }
        if (p.needsWater) {   // BubbleColumnUpParticle.tick: markDead outside water
          var wst = NS.World.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
          if (!(wst > 0 && NS.States.block[wst] === NS.Reg.id.water)) list.splice(i, 1);
        }
      }
    }
    // D-658: emitters tick AFTER the particles (ParticleManager.java:300-317).
    var ems = Px.emitters;
    for (var j = 0; j < ems.length; j++) {
      if (!emitterTick(ems[j])) { ems.splice(j, 1); j--; }
    }
  };

  Px.clear = function () { Px.list.length = 0; Px.emitters.length = 0; };

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // loop/particledraw — Px.OWED's own first line, CLOSED: the draw. `tools/extract-particletex.mjs`
  // packs the three sprites this substrate needs (heart, glint/happy_villager, 8 smoke frames)
  // into one small texture array; everything below reads that array back and paints
  // camera-facing billboards, the SAME geometry `07u_leash.js`'s own header argues for its rope
  // ("one geometry function... two backends just each keep their own [tiny] shader"): the vertex
  // MATH (`Px.buildQuads`) lives here, once, and each backend only uploads it and draws.
  //
  // ⚠ WHAT THIS DOES NOT MODEL, NAMED RATHER THAN SILENTLY DROPPED:
  //   * ~~`getBrightness`~~ — CLOSED D-661: `Px.lightOf`/`Px.brightnessOf` (above `buildQuads`)
  //     sample the particle's own cell (and the per-class overrides) every frame and scale the
  //     vertex colour by the engine's light curve; the billboards were full-bright before.
  //   * partial-tick interpolation — `BillboardParticle.buildGeometry`'s own `tickDelta` blends
  //     `prevPos*` into `pos*` for a smooth 60fps picture between 20/s ticks; this substrate
  //     ticks main-thread-once-per-tick (see `Px.tick`'s own header) and draws the CURRENT tick's
  //     position with no interpolation. Same category as above.
  //   * depth SORTING — moot here: every one of this unit's three types is
  //     `ParticleTextureSheet.PARTICLE_SHEET_OPAQUE` (EmotionParticle.java:23, SuspendParticle.
  //     java:23, AscendingParticle.java:51) — alpha-TESTED, not blended, so vanilla never sorts
  //     these against each other either.
  //
  // ── SPRITE / SIZE / COLOUR, PER PARTICLE — pure data, no GPU, shared by both backends ───────

  /** `NS.DATA.particleLayers` (from `extract-particletex.mjs`'s own meta), read once and
   *  cached. `null` until `19_data.gen.js` has loaded (or on an old build from before this
   *  session) — every caller below treats that as "nothing to draw yet", not a crash. */
  var layersCache;
  function particleLayers() {
    if (layersCache !== undefined) return layersCache;
    var data = NS.DATA;
    layersCache = (data && data.particleLayers && Object.keys(data.particleLayers).length)
      ? data.particleLayers : null;
    return layersCache;
  }

  // Exposed the same way `Px._gauss` already is (see this file's own gaussian comment): not
  // for callers, only for particlecheck.mjs's own anti-vacuity section, which reassigns
  // `NS.DATA.particleLayers` mid-run and needs the module's cache to forget its old read.
  Px._resetLayerCacheForTest = function () { layersCache = undefined; atlasRGBA = null; atlasTried = false; dustTile.length = 0; dustUse.length = 0; };

  /**
   * The atlas LAYER a particle's CURRENT tick should draw with — `heart`/`happy_villager` are
   * one fixed layer each (single-sprite `SpriteProvider`s); `smoke` walks its own 8-frame list
   * exactly the way `SpriteProvider.getSprite(age, maxAge)`'s real implementation does
   * (`ParticleManager.SimpleSpriteProvider.getSprite`, .decomp/net/minecraft/client/particle/
   * ParticleManager.java:497-500: `sprites.get(age * (sprites.size()-1) / maxAge)`, integer
   * division) — called from `AscendingParticle.tick`'s own `setSpriteForAge` every tick
   * (AscendingParticle.java:62). Returns -1 when there is nothing to draw with yet.
   */
  Px.frameLayer = function (p) {
    var L = particleLayers();
    if (!L) return -1;
    if (p.type === 'heart') return typeof L.heart === 'number' ? L.heart : -1;
    if (p.type === 'happy_villager') return typeof L.happy_villager === 'number' ? L.happy_villager : -1;
    if (p.type === 'flame') return typeof L.flame === 'number' ? L.flame : -1;
    if (p.type === 'smoke' || p.type === 'poof' || p.type === 'spit' || p.type === 'cloud' || p.type === 'sneeze') {   // poof/cloud.json == smoke.json (generic_7..0)
      var frames = L.smoke;
      if (!frames || !frames.length) return -1;
      var n = frames.length;
      var idx = Math.floor(p.age * (n - 1) / p.maxAge);       // ParticleManager.java:499
      if (idx < 0) idx = 0; else if (idx > n - 1) idx = n - 1;
      return frames[idx];
    }
    // s118: the pearl's portal specks and the egg's crumbs (were ticked, drawn as nothing)
    if (p.type === 'portal') {
      var pf = L.portal;
      if (!pf || !pf.length) return -1;
      return pf[Math.min(pf.length - 1, Math.floor(p.spriteRoll * pf.length))];
    }
    if (p.type === 'falling_nectar') {
      var nf = L.falling_nectar;
      if (!nf || !nf.length) return -1;
      return nf[Math.min(nf.length - 1, Math.floor(p.spriteRoll * nf.length))];
    }
    if (p.type === 'rain') {                      // D-656: rain.json's splash_0..3
      var rf = L.rain;
      if (!rf || !rf.length) return -1;
      return rf[Math.min(rf.length - 1, Math.floor(p.spriteRoll * rf.length))];
    }
    if (p.type === 'crit' || p.type === 'enchanted_hit' || p.type === 'damage_indicator') {
      return typeof L[p.type] === 'number' ? L[p.type] : -1;          // D-658, one sprite each
    }
    if (p.type === 'sweep_attack') {
      // D-658: setSpriteForAge — sprites[age*(n-1)/maxAge] (ParticleManager.java:499)
      var sf = L.sweep_attack;
      if (!sf || !sf.length) return -1;
      var si = Math.floor(p.age * (sf.length - 1) / p.maxAge);
      if (si < 0) si = 0; else if (si > sf.length - 1) si = sf.length - 1;
      return sf[si];
    }
    if (p.type === 'block' && p.entLayer >= 0) return p.entLayer;   // #6039: whole-sprite layer
    if (p.type === 'explosion') {                 // #6056: 16 frames, setSpriteForAge walk
      var xf = L.explosion;
      if (!xf || !xf.length) return -1;
      var xi = Math.floor(p.age * (xf.length - 1) / p.maxAge);
      return xf[xi < 0 ? 0 : xi > xf.length - 1 ? xf.length - 1 : xi];
    }
    if (p.type === 'block') {                     // D-659: the dust cell holding its sprite
      var sl = dustSlotFor(p.tile);
      p.slot = sl;
      return sl < 0 ? -1 : atlasLayersNow() + Math.floor(sl / dustPerLayer());
    }
    if (p.type === 'effect' || p.type === 'instant_effect') {
      // loop/potion-splash-impact: SpellParticle.tick calls setSpriteForAge EVERY tick (not
      // just at spawn, .decomp SpellParticle.java:38) -- same age*(n-1)/maxAge walk smoke/
      // sweep_attack above already use, just re-evaluated on every call instead of cached.
      var ef = L[p.type];
      if (!ef || !ef.length) return -1;
      var ei = Math.floor(p.age * (ef.length - 1) / p.maxAge);
      if (ei < 0) ei = 0; else if (ei > ef.length - 1) ei = ef.length - 1;
      return ef[ei];
    }
    if (p.glow) return typeof L.glow === 'number' ? L.glow : -1;   // D-664: glow.png, one sprite
    if (p.vibration) {                            // animated 7-frame strip (frametime 1): the atlas tick, not the age
      var vf = L.vibration;
      return vf && vf.length ? vf[Px.animTick % vf.length] : -1;
    }
    if (p.type === 'bubble' || p.ink || p.type === 'angry_villager' || p.type === 'composter' || p.type === 'bubble_column_up') {          // #3761: setSpriteForAge walk (bubble: one frame)
      var bf = L[p.type];
      if (!bf || !bf.length) return -1;
      var bi = Math.floor(p.age * (bf.length - 1) / p.maxAge);
      return bf[bi < 0 ? 0 : bi > bf.length - 1 ? bf.length - 1 : bi];
    }
    if (p.type === 'splash' || p.type === 'mycelium' || p.type === 'dolphin' || p.type === 'witch') {   // #6058
      var wf = L[p.type];
      if (!wf || !wf.length) return -1;
      var wi = Math.floor(p.age * (wf.length - 1) / p.maxAge);   // ParticleManager.java:499
      return wf[wi < 0 ? 0 : wi > wf.length - 1 ? wf.length - 1 : wi];
    }
    if (p.type === 'item_crack') {
      var li = L.item && L.item[p.item];
      return typeof li === 'number' ? li : -1;
    }
    return -1;
  };

  /**
   * World-space HALF-WIDTH of the billboard quad — `BillboardParticle.buildGeometry`'s own
   * `getSize(tickDelta)` scales a UNIT (-1..1) quad by exactly this number
   * (.decomp/net/minecraft/client/particle/BillboardParticle.java:38-42), so this is not a
   * pixel size, it is the same world-unit `p.scale` `Px.spawn` now rolls (see its own header
   * note there). `happy_villager` (SuspendParticle) never overrides `getSize` — plain
   * `this.scale` (BillboardParticle.java:76-78). `heart`/`smoke` (EmotionParticle/
   * AscendingParticle) both override it with the SAME growth clamp — full size by
   * age/maxAge >= 1/32 of the particle's life (EmotionParticle.java:26-29,
   * AscendingParticle.java:54-57).
   */
  Px.sizeOf = function (p) {
    if (p.type === 'note') return p.scale * Math.min(1, Math.max(0, (p.age + 0) / p.maxAge * 32));   // NoteParticle.getSize
    if (p.type === 'happy_villager') return p.scale;
    if (p.type === 'flame') {                          // FlameParticle.getSize (java:22-25)
      var ft = p.maxAge > 0 ? p.age / p.maxAge : 1;
      return p.scale * (1 - ft * ft * 0.5);
    }
    if (p.vibration) return p.scale;                   // VibrationParticle: getSize not overridden (0.3)
    if (p.type === 'item_crack') return p.scale;       // CrackParticle: no getSize override
    if (p.type === 'block') return p.scale;            // BlockDustParticle: no getSize override
    if (p.type === 'rain' || p.type === 'falling_nectar') return p.scale;             // RainSplashParticle: no getSize override
    if (p.type === 'sweep_attack') return p.scale;     // SweepAttackParticle: no getSize override
    if (p.type === 'poof' || p.type === 'spit') return p.scale;             // ExplosionSmokeParticle: no getSize override
    if (p.glow) return p.scale;                        // GlowParticle: no getSize override (D-664)
    if (p.type === 'portal') {                         // PortalParticle.java:40-46, ease-out
      var t = p.maxAge > 0 ? p.age / p.maxAge : 1;
      t = 1 - t; t *= t; t = 1 - t;
      return p.scale * t;
    }
    var frac = p.maxAge > 0 ? p.age / p.maxAge : 1;
    var grown = frac * 32;
    if (grown > 1) grown = 1; else if (grown < 0) grown = 0;
    return p.scale * grown;
  };

  /** Vertex colour — white for heart/happy_villager (neither factory calls `setColor` away
   *  from it: EmotionParticle's own `HeartFactory` never calls `setColor` at all, and
   *  `Particle`'s own default is (1,1,1,1); `SuspendParticle.HappyVillagerFactory` calls
   *  `setColor(1,1,1)` explicitly, .decomp SuspendParticle.java:90), the per-particle grey
   *  roll for smoke (`p.shade`, rolled once at spawn — see `Px.spawn`'s own comment there). */
  Px.colorOf = function (p) {
    if (p.type === 'sneeze') return [1, 1, 1, 0.4];
    if (p.type === 'smoke' || p.type === 'poof' || p.type === 'spit' || p.type === 'cloud') { var s = p.shade; return [s, s, s, 1]; }
    if (p.type === 'portal' || p.type === 'note' || p.type === 'totem_of_undying' || p.type === 'falling_nectar') return [p.red, p.green, p.blue, 1];   // PortalParticle.java:23-24 / NoteParticle red,green,blue
    if (p.ink) {   // BufferBuilder.color(float) stores (int)(c*255) in a byte: the jar's raw 0..255 floats wrap
      var w = function (c) { return ((Math.floor(c * 255) & 255) / 255); };
      return [w(p.red), w(p.green), w(p.blue), p.alpha];
    }
    if (p.type === 'end_rod') return [p.red, p.green, p.blue, p.alpha];
    if (p.dmgTint || p.glow || p.type === 'sweep_attack' || p.type === 'block' ||
        p.type === 'effect' || p.type === 'instant_effect') return [p.red, p.green, p.blue, 1];   // D-658/D-659/potion-splash-impact
    return [1, 1, 1, 1];
  };

  /**
   * ONE frame's worth of camera-facing billboard quads, as a flat array of
   * `[x,y,z, u,v, layer, r,g,b,a]` per vertex (4 vertices per live, drawable particle),
   * eye-relative (D-179, the SAME convention `Ls.buildVertices` already uses). `cam.right`/
   * `cam.up` are `10_camera.js`'s own basis vectors — this is exactly
   * `BillboardParticle.buildGeometry`'s own `Vec3f(-1,-1,0)..(1,-1,0)` corner set rotated by
   * the camera's rotation quaternion (.decomp BillboardParticle.java:34-44): with `angle==0`
   * (true for all three of this unit's types — none of them ever call `Particle.setAngle`)
   * that rotation IS just the camera's own right/up basis, so `cx*right + cy*up` reproduces it
   * with no quaternion math needed. UV corners and winding are read off the SAME method,
   * vertex-for-vertex (BillboardParticle.java:47-68: v0=(-1,-1)->(maxU,maxV),
   * v1=(-1,1)->(maxU,minV), v2=(1,1)->(minU,minV), v3=(1,-1)->(minU,maxV)) — with one whole
   * tile per sprite, minU/minV=0 and maxU/maxV=1, so this is not a guess at vanilla's own
   * mirroring, it is what a single-tile sprite's own min/max U/V collapse to.
   */
  var QUAD_CORNERS = [
    [-1, -1, 1, 1], [-1, 1, 1, 0], [1, 1, 0, 0], [1, -1, 0, 1]
  ];
  /**
   * D-661 — `Particle.getBrightness(tickDelta)` and its per-class overrides, as [sky, block] light
   * levels (0..15) instead of the packed lightmap coordinate (`sky<<20 | block<<4`, i.e. level*16
   * in each half). This closes the header's old "full-bright" simplification: splashes, dust and
   * smoke at night are night-dark again.
   *   Particle.java           — the cell floor(x,y,z); 0 (both halves) if its chunk is not loaded
   *                             (WorldRenderer.getLightmapCoordinates: sky, max(block, luminance))
   *   BlockDustParticle:66-69 — if that is 0 (a chip buried inside a solid block reads 0/0) and
   *                             the SOURCE block's chunk is loaded, the source block's own cell
   *   PortalParticle:51-63    — block half += floor(t^4 * 15 * 16) with t = age/maxAge, cap 240
   *   SweepAttackParticle:22  — 15728880 = full bright (15, 15)
   * Everything else this engine spawns (crit/enchanted_hit/damage_indicator = DamageParticle,
   * heart/angry_villager = EmotionParticle, happy_villager = SuspendParticle, smoke =
   * AscendingParticle, rain = RainSplashParticle, item_crack = CrackParticle) inherits
   * Particle's (checked: none of those classes overrides getBrightness in .decomp).
   * The block half here is the engine's stored block light; `getLuminance` of the cell's own
   * state and `hasEmissiveLighting` (magma etc.) are not added — a particle sits in AIR almost
   * always, where both are nothing. Returned levels are integers except portal's block half,
   * which keeps vanilla's 1/16 steps (lightmap resolution).
   */
  function lightCell(W, x, y, z) {
    if (!W.get(x >> 4, z >> 4)) return null;                    // isChunkLoaded
    var l = W.getLight(x, y, z) | 0;
    return [l >> 4, l & 15];
  }
  Px.lightOf = function (p) {
    if (p.type === 'sweep_attack') return [15, 15];
    var W = NS.World;
    if (!W || !W.getLight || !W.get) return [15, 15];            // no world (a unit test): as drawn before
    var L = lightCell(W, Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) || [0, 0];
    if (p.type === 'block' && L[0] === 0 && L[1] === 0 && typeof p.bx === 'number') {
      var B = lightCell(W, p.bx, p.by, p.bz);
      if (B) L = B;
    }
    if (p.type === 'flame') {                          // FlameParticle.getBrightness (java:27-40)
      var ff = Math.min(1, Math.max(0, p.maxAge > 0 ? p.age / p.maxAge : 0));
      L = [L[0], Math.min(240, L[1] * 16 + Math.trunc(ff * 15 * 16)) / 16];
    }
    if (p.type === 'portal') {
      var t = p.maxAge > 0 ? Math.fround(p.age / p.maxAge) : 0;
      t = Math.fround(t * t); t = Math.fround(t * t);
      var blk16 = L[1] * 16 + Math.trunc(Math.fround(t * 15 * 16));
      if (blk16 > 240) blk16 = 240;
      L = [L[0], blk16 / 16];
    }
    if (p.glow) {
      // D-664: GlowParticle.getBrightness — block half += (int)(clamp(age/maxAge) * 15 * 16), cap 240
      var gt = p.maxAge > 0 ? Math.fround(p.age / p.maxAge) : 0;
      if (gt > 1) gt = 1; else if (gt < 0) gt = 0;
      var gb16 = L[1] * 16 + Math.trunc(Math.fround(gt * 15 * 16));
      if (gb16 > 240) gb16 = 240;
      L = [L[0], gb16 / 16];
    }
    return L;
  };
  /** The multiplier a particle's colour carries: the engine's own light curve (`Wx.brightness`,
   *  the rain streaks' and the world shader's AMBIENT curve) at the particle's `lightOf`, with the
   *  sky half darkened by `Gfx.skyDarken` exactly as every lit world face is. */
  Px.brightnessOf = function (p) {
    var L = Px.lightOf(p), Wx = NS.Weather || NS.Wx, G = NS.Gfx;
    var ss = G && typeof G.skyDarken === 'number' ? G.skyDarken : 1;
    if (Wx && Wx.brightness) return Wx.brightness(L[0], L[1], ss);
    var lv = Math.max(L[0] * ss, L[1]) / 15, amb = 0.06;
    if (lv > 1) lv = 1; else if (lv < 0) lv = 0;
    return amb + (1 - amb) * (lv / (4 - 3 * lv));
  };

  Px.buildQuads = function (cam) {
    var list = Px.list, out = [];
    if (!list.length) return out;
    var right = cam.right, up = cam.up;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      var layer = Px.frameLayer(p);
      if (layer < 0) continue;
      var size = Px.sizeOf(p);
      if (!(size > 0)) continue;
      var col = Px.colorOf(p);
      var br = Px.lightOff ? 1 : Px.brightnessOf(p);                  // D-661: getBrightness
      col = [col[0] * br, col[1] * br, col[2] * br, col[3]];
      var ex = p.x - cam.x, ey = p.y - cam.y, ez = p.z - cam.z;
      // s118: CrackParticle's own getMin/MaxU/V (CrackParticle.java:38-56) -- a 4/16 window of
      // the item icon at (sampleU, sampleV); every other type is the whole tile (0..1).
      var crack = p.type === 'item_crack' || p.type === 'block';
      var vib = p.vibration ? 18 / 32 : 1;   // the 18x18 frame sits top-left in its 32 cell
      var minU = crack ? (p.sampleU + 1) / 4 : 0, maxU = crack ? p.sampleU / 4 : vib;
      var minV = crack ? p.sampleV / 4 : 0, maxV = crack ? (p.sampleV + 1) / 4 : vib;
      if (p.type === 'block' && !(p.entLayer >= 0)) {
        // D-659: BlockDustParticle.getMin/MaxU/V (BlockDustParticle.java:45-63) — the same 4/16
        // window, mapped into the 16x16 cell of the dust layer its sprite was copied into.
        var o = dustCellOrigin(p.slot);
        minU = o[0] + minU * o[2]; maxU = o[0] + maxU * o[2];
        minV = o[1] + minV * o[2]; maxV = o[1] + maxV * o[2];
      }
      for (var k = 0; k < 4; k++) {
        var c = QUAD_CORNERS[k];
        out.push(
          ex + (c[0] * right[0] + c[1] * up[0]) * size,
          ey + (c[0] * right[1] + c[1] * up[1]) * size,
          ez + (c[0] * right[2] + c[1] * up[2]) * size,
          c[2] ? maxU : minU, c[3] ? maxV : minV, layer, col[0], col[1], col[2], col[3]
        );
      }
    }
    return out;
  };
  Px.VERTEX_FLOATS = 10;   // x,y,z, u,v, layer, r,g,b,a

  /** Static `[0,1,2, 0,2,3]` index pattern for `n` quads, built once and reused every frame —
   *  the quad COUNT changes frame to frame (`Px.MAX` caps it at 512) but the winding never
   *  does, so there is nothing to rebuild here after the first call. */
  var quadIndexCache = null, quadIndexCap = 0;
  function quadIndices(n) {
    if (quadIndexCache && quadIndexCap >= n) return quadIndexCache;
    var cap = Math.max(n, Px.MAX);
    var idx = new Uint16Array(cap * 6);
    for (var i = 0; i < cap; i++) {
      var v = i * 4, o = i * 6;
      idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2;
      idx[o + 3] = v; idx[o + 4] = v + 2; idx[o + 5] = v + 3;
    }
    quadIndexCache = idx; quadIndexCap = cap;
    return idx;
  }

  /** The atlas's raw RGBA bytes, decoded from `NS.DATA.particleTiles` once and cached — both
   *  backends share this decode (`NS.Z.unpack`, the same inflate every other packed asset in
   *  this engine already goes through, `01b_inflate.js`). */
  var atlasRGBA = null, atlasLayers = 0, atlasTile = 8, atlasTried = false;
  function particleAtlas() {
    if (atlasRGBA || atlasTried) return atlasRGBA;
    atlasTried = true;
    var data = NS.DATA;
    if (!data || !data.particleTiles || !NS.Z) return null;
    try {
      atlasRGBA = NS.Z.unpack(data.particleTiles, data.particleTilesBytes);
      atlasTile = data.particleTile || 8;
      atlasLayers = Math.round(atlasRGBA.length / (atlasTile * atlasTile * 4));
    } catch (err) { atlasRGBA = null; }
    return atlasRGBA;
  }

  // ── D-659: THE DUST LAYERS — block sprites copied in at run time ─────────────────────────
  // Vanilla's BlockDustParticle draws from the BLOCK atlas (TERRAIN_SHEET); this pass binds ONE
  // texture array, so the block sprites a live dust particle needs are copied (16x16, from
  // `NS.Atlas.mips[0]`, the world's own atlas bytes) into Px.DUST_LAYERS extra layers after the
  // packed ones, one sprite per 16x16 cell. Least-recently-used cell is reused; a break needs one.
  Px.DUST_LAYERS = 4;
  var dustTile = [], dustUse = [], dustClock = 0;
  function atlasLayersNow() { particleAtlas(); return atlasLayers; }
  function dustPerRow() { return Math.max(1, Math.floor(atlasTile / 16)); }
  function dustPerLayer() { var n = dustPerRow(); return n * n; }
  function dustSlots() { return Px.DUST_LAYERS * dustPerLayer(); }
  function dustSlotFor(tile) {
    if (!particleAtlas() || !(tile >= 0)) return -1;
    var n = dustSlots(), lru = 0;
    dustClock++;
    for (var i = 0; i < n; i++) {
      if (dustTile[i] === tile) { dustUse[i] = dustClock; return i; }
      if ((dustUse[i] || 0) < (dustUse[lru] || 0)) lru = i;
    }
    dustTile[lru] = tile; dustUse[lru] = dustClock;
    return lru;
  }
  function dustCellOrigin(slot) {
    var per = dustPerRow(), cell = slot % dustPerLayer(), s = 16 / atlasTile;
    return [(cell % per) * s, Math.floor(cell / per) * s, s];
  }
  Px._dustCellOrigin = dustCellOrigin;
  /** The 16x16 RGBA bytes of block atlas tile `tile` (null without an atlas). */
  function dustTileRGBA(tile) {
    var A = NS.Atlas;
    if (!A || !A.mips || !A.mips[0]) return null;
    var d = A.mips[0].data, o = tile * 16 * 16 * 4;
    if (o < 0 || o + 1024 > d.length) return null;
    return d.subarray(o, o + 1024);
  }
  /** Every cell whose sprite differs from what `uploaded` says this backend's texture holds. */
  /** #5774: the frame an animated block tile shows right now (vanilla's particles sample the live atlas, which
   *  Sprite.tickAnimation steps); '' for a static tile. Atlas.anims is the same clock the terrain draws from. */
  function dustTileVersion(tile) {
    var an = NS.Atlas && NS.Atlas.anims;
    if (!an) return '';
    for (var k = 0; k < an.length; k++) {
      if (an[k].layer === tile) return an[k].frameIndex + (an[k].interpolate ? ':' + an[k].frameTicks : '');
    }
    return '';
  }
  Px._dustTileVersion = dustTileVersion;
  function dustDirty(uploaded, write) {
    var n = dustSlots(), per = dustPerRow(), ver = uploaded.ver || (uploaded.ver = []);
    for (var i = 0; i < n; i++) {
      if (dustTile[i] === undefined) continue;
      var v = dustTileVersion(dustTile[i]);
      if (uploaded[i] === dustTile[i] && ver[i] === v) continue;
      var rgba = dustTileRGBA(dustTile[i]);
      if (!rgba) continue;
      var cell = i % dustPerLayer();
      write(atlasLayers + Math.floor(i / dustPerLayer()), (cell % per) * 16, Math.floor(cell / per) * 16, rgba);
      uploaded[i] = dustTile[i]; ver[i] = v;
    }
  }
  Px._dustDirty = dustDirty;
  Px._dustState = function () { return { tiles: dustTile.slice(), slots: dustSlots(), layer0: atlasLayers }; };

  // ⚠ THE SAME CUTOUT THRESHOLD THE WORLD USES (`10_gfx.js`'s own `G.SHADE.CUTOUT`, D-52) —
  // every one of this unit's three types is `PARTICLE_SHEET_OPAQUE` (alpha-TESTED, never
  // blended; see this section's own header), so a cutout discard is the correct pass, not an
  // approximation of a blend this file is skipping.
  function cutoutThreshold() {
    return (NS.Gfx && NS.Gfx.SHADE && typeof NS.Gfx.SHADE.CUTOUT === 'number') ? NS.Gfx.SHADE.CUTOUT : 0.5;
  }

  // ── WebGL2 ───────────────────────────────────────────────────────────────────────────────

  var gl2 = { prog: null, vbuf: null, ibuf: null, tex: null, texLayers: 0,
              uViewProj: -1, uTex: -1, aPos: 0, aUV: 1, aLayer: 2, aColor: 3 };

  function glCompile(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error('Particle shader: ' + log);
    }
    return sh;
  }

  function glEnsureProgram(gl) {
    if (gl2.prog) return true;
    try {
      var VS = [
        '#version 300 es',
        'precision highp float;',
        'in vec3 aPos;', 'in vec2 aUV;', 'in float aLayer;', 'in vec4 aColor;',
        'uniform mat4 uViewProj;',
        'out vec2 vUV;', 'flat out float vLayer;', 'out vec4 vColor;',
        'void main() {',
        '  vUV = aUV; vLayer = aLayer; vColor = aColor;',
        '  gl_Position = uViewProj * vec4(aPos, 1.0);',
        '}'
      ].join('\n');
      var FS = [
        '#version 300 es',
        'precision highp float;', 'precision highp sampler2DArray;',
        'in vec2 vUV;', 'flat in float vLayer;', 'in vec4 vColor;',
        'uniform sampler2DArray uTex;',
        'out vec4 fragColor;',
        'void main() {',
        '  vec4 t = texture(uTex, vec3(vUV, vLayer));',
        '  if (t.a < ' + cutoutThreshold().toFixed(3) + ') discard;',
        '  fragColor = vec4(t.rgb * vColor.rgb, t.a * vColor.a);',
        '}'
      ].join('\n');
      var vs = glCompile(gl, gl.VERTEX_SHADER, VS);
      var fs = glCompile(gl, gl.FRAGMENT_SHADER, FS);
      var prog = gl.createProgram();
      gl.attachShader(prog, vs); gl.attachShader(prog, fs);
      gl.bindAttribLocation(prog, gl2.aPos, 'aPos');
      gl.bindAttribLocation(prog, gl2.aUV, 'aUV');
      gl.bindAttribLocation(prog, gl2.aLayer, 'aLayer');
      gl.bindAttribLocation(prog, gl2.aColor, 'aColor');
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('Particle program: ' + gl.getProgramInfoLog(prog));
      gl2.prog = prog;
      gl2.uViewProj = gl.getUniformLocation(prog, 'uViewProj');
      gl2.uTex = gl.getUniformLocation(prog, 'uTex');
      gl2.vbuf = gl.createBuffer();
      gl2.ibuf = gl.createBuffer();
      return true;
    } catch (err) {
      Px.glError = (err && err.message) || String(err);
      return false;
    }
  }

  function glEnsureTexture(gl) {
    var rgba = particleAtlas();
    if (!rgba) return false;
    if (gl2.tex && gl2.texLayers === atlasLayers) { glUploadDust(gl); return true; }
    if (gl2.tex) gl.deleteTexture(gl2.tex);
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, atlasTile, atlasTile, atlasLayers + Px.DUST_LAYERS);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, atlasTile, atlasTile, atlasLayers,
      gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl2.tex = tex; gl2.texLayers = atlasLayers; gl2.dust = [];
    glUploadDust(gl);
    return true;
  }
  function glUploadDust(gl) {
    gl.activeTexture(gl.TEXTURE0);                 // the unit renderGL2 binds this texture to anyway
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, gl2.tex);
    dustDirty(gl2.dust || (gl2.dust = []), function (layer, x, y, rgba) {
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, x, y, layer, 16, 16, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    });
  }

  /**
   * The WebGL2 render call. Dispatched from `Px.render`, which is `G.render`'s (10_gfx.js) own
   * ONE hook call — the single-call-site shape `07u_leash.js`'s own header already established
   * for this exact kind of small, self-contained, own-file draw pass.
   */
  Px.renderGL2 = function (G, cam) {
    if (!G || G.name !== 'webgl2' || !G.backend || !G.backend.gl) return;
    var gl = G.backend.gl;
    if (!glEnsureProgram(gl)) return;
    var verts = Px.buildQuads(cam);                 // D-659: assigns dust cells before the upload
    if (!glEnsureTexture(gl) || !verts.length) return;
    var nQuads = verts.length / (4 * Px.VERTEX_FLOATS);
    var arr = new Float32Array(verts);
    var idx = quadIndices(nQuads);
    gl.useProgram(gl2.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl2.vbuf);
    gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl2.ibuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.DYNAMIC_DRAW);
    var stride = Px.VERTEX_FLOATS * 4;
    gl.enableVertexAttribArray(gl2.aPos);
    gl.enableVertexAttribArray(gl2.aUV);
    gl.enableVertexAttribArray(gl2.aLayer);
    gl.enableVertexAttribArray(gl2.aColor);
    gl.vertexAttribPointer(gl2.aPos, 3, gl.FLOAT, false, stride, 0);
    gl.vertexAttribPointer(gl2.aUV, 2, gl.FLOAT, false, stride, 3 * 4);
    gl.vertexAttribPointer(gl2.aLayer, 1, gl.FLOAT, false, stride, 5 * 4);
    gl.vertexAttribPointer(gl2.aColor, 4, gl.FLOAT, false, stride, 6 * 4);
    gl.uniformMatrix4fv(gl2.uViewProj, false, cam.viewProj);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, gl2.tex);
    gl.uniform1i(gl2.uTex, 0);
    gl.drawElements(gl.TRIANGLES, nQuads * 6, gl.UNSIGNED_SHORT, 0);
    gl.disableVertexAttribArray(gl2.aPos);
    gl.disableVertexAttribArray(gl2.aUV);
    gl.disableVertexAttribArray(gl2.aLayer);
    gl.disableVertexAttribArray(gl2.aColor);
  };

  // ── WebGPU ───────────────────────────────────────────────────────────────────────────────

  var gpu = { device: null, pipeline: null, bgl: null, bg: null, sampler: null,
              uniformBuf: null, vertBuf: null, vertCap: 0, idxBuf: null, idxCap: 0,
              tex: null, texLayers: 0 };

  function gpuWGSL() {
    return [
      'struct VP { viewProj : mat4x4<f32> };',
      '@group(0) @binding(0) var<uniform> uVP : VP;',
      '@group(0) @binding(1) var uTex : texture_2d_array<f32>;',
      '@group(0) @binding(2) var uSamp : sampler;',
      'struct VOut {',
      '  @builtin(position) pos : vec4<f32>,',
      '  @location(0) uv : vec2<f32>,',
      '  @location(1) @interpolate(flat) layer : i32,',
      '  @location(2) color : vec4<f32>',
      '};',
      '@vertex',
      'fn vs_particle(@location(0) pos : vec3<f32>, @location(1) uv : vec2<f32>,',
      '                @location(2) layer : f32, @location(3) color : vec4<f32>) -> VOut {',
      '  var o : VOut;',
      '  o.pos = uVP.viewProj * vec4<f32>(pos, 1.0);',
      '  o.uv = uv; o.layer = i32(layer); o.color = color;',
      '  return o;',
      '}',
      '@fragment',
      'fn fs_particle(v : VOut) -> @location(0) vec4<f32> {',
      '  let t = textureSample(uTex, uSamp, v.uv, v.layer);',
      '  if (t.a < ' + cutoutThreshold().toFixed(3) + ') { discard; }',
      '  return vec4<f32>(t.rgb * v.color.rgb, t.a * v.color.a);',
      '}'
    ].join('\n');
  }

  function gpuEnsurePipeline(device, format) {
    if (gpu.pipeline && gpu.device === device) return true;
    try {
      var module = device.createShaderModule({ code: gpuWGSL() });
      var bgl = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } }
        ]
      });
      var layout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });
      var pipeline = device.createRenderPipeline({
        layout: layout,
        vertex: {
          module: module, entryPoint: 'vs_particle',
          buffers: [{
            arrayStride: Px.VERTEX_FLOATS * 4, stepMode: 'vertex',
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32x2' },
              { shaderLocation: 2, offset: 20, format: 'float32' },
              { shaderLocation: 3, offset: 24, format: 'float32x4' }
            ]
          }]
        },
        fragment: { module: module, entryPoint: 'fs_particle', targets: [{ format: format }] },
        primitive: { topology: 'triangle-list' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' }
      });
      var uniformBuf = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      var sampler = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' });
      gpu.device = device; gpu.pipeline = pipeline; gpu.bgl = bgl; gpu.uniformBuf = uniformBuf;
      gpu.sampler = sampler; gpu.bg = null; gpu.tex = null; gpu.texLayers = 0;
      gpu.vertBuf = null; gpu.vertCap = 0; gpu.idxBuf = null; gpu.idxCap = 0;
      return true;
    } catch (err) {
      Px.gpuError = (err && err.message) || String(err);
      return false;
    }
  }

  function gpuEnsureTexture(device) {
    var rgba = particleAtlas();
    if (!rgba) return false;
    if (gpu.tex && gpu.texLayers === atlasLayers && gpu.bg) { gpuUploadDust(device); return true; }
    var tex = device.createTexture({
      size: [atlasTile, atlasTile, atlasLayers + Px.DUST_LAYERS],
      format: 'rgba8unorm',
      dimension: '2d',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    device.queue.writeTexture(
      { texture: tex },
      rgba,
      { bytesPerRow: atlasTile * 4, rowsPerImage: atlasTile },
      [atlasTile, atlasTile, atlasLayers]
    );
    gpu.tex = tex; gpu.texLayers = atlasLayers; gpu.dust = [];
    gpu.bg = device.createBindGroup({
      layout: gpu.bgl,
      entries: [
        { binding: 0, resource: { buffer: gpu.uniformBuf } },
        { binding: 1, resource: tex.createView({ dimension: '2d-array' }) },
        { binding: 2, resource: gpu.sampler }
      ]
    });
    gpuUploadDust(device);
    return true;
  }
  function gpuUploadDust(device) {
    dustDirty(gpu.dust || (gpu.dust = []), function (layer, x, y, rgba) {
      device.queue.writeTexture({ texture: gpu.tex, origin: [x, y, layer] }, rgba,
        { bytesPerRow: 16 * 4, rowsPerImage: 16 }, [16, 16, 1]);
    });
  }

  /** The WebGPU render call — same contract as `Px.renderGL2`, same one-file, one-hook shape
   *  `07u_leash.js`'s own `Ls.renderGPU` already established for the rope. */
  Px.renderGPU = function (G, cam) {
    var P = G && G.backend;
    if (!P || !P.device || !P.pass || P.lost) return;
    if (!gpuEnsurePipeline(P.device, P.format)) return;
    var verts = Px.buildQuads(cam);                 // D-659: assigns dust cells before the upload
    if (!gpuEnsureTexture(P.device) || !verts.length) return;
    var nQuads = verts.length / (4 * Px.VERTEX_FLOATS);
    var arr = new Float32Array(verts);
    var bytes = arr.byteLength;
    if (!gpu.vertBuf || gpu.vertCap < bytes) {
      gpu.vertBuf = P.device.createBuffer({ size: Math.max(bytes, 256), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      gpu.vertCap = Math.max(bytes, 256);
    }
    var idx = quadIndices(nQuads);
    var idxBytes = nQuads * 6 * 2;
    if (!gpu.idxBuf || gpu.idxCap < idxBytes) {
      gpu.idxBuf = P.device.createBuffer({ size: Math.max(idxBytes, 256), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
      gpu.idxCap = Math.max(idxBytes, 256);
    }
    P.device.queue.writeBuffer(gpu.vertBuf, 0, arr.buffer, arr.byteOffset, bytes);
    P.device.queue.writeBuffer(gpu.idxBuf, 0, idx.buffer, idx.byteOffset, idxBytes);
    P.device.queue.writeBuffer(gpu.uniformBuf, 0, cam.viewProj.buffer, cam.viewProj.byteOffset, 64);
    P.pass.setPipeline(gpu.pipeline);
    P.pass.setBindGroup(0, gpu.bg);
    P.pass.setVertexBuffer(0, gpu.vertBuf);
    P.pass.setIndexBuffer(gpu.idxBuf, 'uint16');
    P.pass.drawIndexed(nQuads * 6);
  };

  /**
   * The one dispatcher, and `10_gfx.js`'s own ONE hook call site (right after
   * `NS.Leash.render(G, cam)`, same frame position — after the world's translucent pass, which
   * is fine here too since these three types are all alpha-TESTED, not blended, so draw order
   * against translucent geometry does not change the picture).
   */
  Px.render = function (G, cam) {
    if (!G || !cam || !Px.ready || !Px.list.length) return;
    if (G.name === 'webgpu') { Px.renderGPU(G, cam); return; }
    if (G.name === 'webgl2') { Px.renderGL2(G, cam); return; }
  };


  // ElderGuardianAppearanceParticle (.decomp/net/minecraft/client/particle/ElderGuardianAppearanceParticle.java):
  // maxAge 30, gravity 0, CUSTOM sheet; buildGeometry(t = (age+pt)/maxAge): alpha 0.05+0.5*sin(t*PI),
  // matrix = camRot * rotX(150t-60 deg) * scale(-1,-1,1) * translate(0,-1.101,1.5).
  // The draw (GuardianEntityModel, texture entity/guardian_elder) is the entity renderer's; this is its math.
  Px.ELDER_GUARDIAN = { maxAge: 30, gravityStrength: 0 };
  Px.elderGuardianAlpha = function (age, pt) {
    var t = (age + (pt || 0)) / 30;
    return Math.fround(0.05 + 0.5 * Math.sin(Math.fround(t * Math.PI)));
  };
  Px.elderGuardianPitch = function (age, pt) { return 150 * ((age + (pt || 0)) / 30) - 60; };
  // model origin in CAMERA-local axes (apply the camera rotation to get world): translate, scale(-1,-1,1), rotX
  Px.elderGuardianLocal = function (age, pt) {
    var a = Px.elderGuardianPitch(age, pt) * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
    var y = 1.101, z = 1.5;   // (0,-1.101,1.5) after scale(-1,-1,1)
    return { x: 0, y: y * c - z * sn, z: y * sn + z * c };
  };
  // #8078: the draw descriptor the renderer consumes. Camera-local (x right, y up, z forward) -> world via cam.right/up/fwd;
  // the model basis is camRot * rotX(pitch) * scale(-1,-1,1) (columns in world axes), alpha = elderGuardianAlpha, scale 1.5.
  Px.elderGuardianDraws = function (cam, pt) {
    var out = [], L = Px.list;
    if (!cam || !cam.right || !cam.up || !cam.fwd) return out;
    for (var i = 0; i < L.length; i++) {
      var p = L[i];
      if (p.type !== 'elder_guardian') continue;
      var l = Px.elderGuardianLocal(p.age, pt), a = Px.elderGuardianPitch(p.age, pt) * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
      var R = cam.right, U = cam.up, F = cam.fwd;
      var w = function (x, y, z) { return [R[0] * x + U[0] * y + F[0] * z, R[1] * x + U[1] * y + F[1] * z, R[2] * x + U[2] * y + F[2] * z]; };
      out.push({ p: p, alpha: Px.elderGuardianAlpha(p.age, pt), scale: p.scale || 1.5, texture: 'entity/guardian_elder',
                 origin: [cam.x + l.x * R[0] + l.y * U[0] + l.z * F[0], cam.y + l.x * R[1] + l.y * U[1] + l.z * F[1], cam.z + l.x * R[2] + l.y * U[2] + l.z * F[2]],
                 axisX: w(-1, 0, 0), axisY: w(0, -c, -sn), axisZ: w(0, -sn, c) });
    }
    return out;
  };
  Px.spawnElderGuardian = function (x, y, z) {
    if (!Px.ready) Px.init();
    if (Px.tally) Px.tally.elder_guardian = (Px.tally.elder_guardian | 0) + 1;
    var p = { type: 'elder_guardian', x: x, y: y, z: z, vx: 0, vy: 0, vz: 0, gravityStrength: 0,
              age: 0, maxAge: 30, scale: 1.5 };
    Px.list.push(p);
    return p;
  };

  Px.OWED = [
    // ⚠ WHAT IS NOT HERE, AND IS NAMED RATHER THAN GUESSED (`Particle.OWED`):
    //
    // loop/particledraw CLOSED THE DRAW (this list used to start with it — read the git log
    // for the old wording if you want it). `tools/extract-particletex.mjs` packs heart/glint/
    // 8 smoke frames into a texture array; `Px.render`/`Px.renderGL2`/`Px.renderGPU` (above)
    // bind it and paint camera-facing billboards on both backends. What that draw pass itself
    // does NOT model (partial-tick interpolation; brightness CLOSED D-661) is named in ITS OWN
    // header, not here — those are rendering-cost simplifications, not missing features.
    // struck s108: Px.tick() is driven by Main.worldTick (src/17_main.js; particlecheck §9).
    // struck loop/vbbreed: villager breeding hearts/angry-heart -- this unit's own former line
    // named the missing driver ("no BreedGoal ... no love-mode TICK to hang a heart cadence
    // off") -- `src/07zv5_vbbreed.js`'s own `NS.VBBreed.tick` IS that driver now (VillagerBreed
    // Task's real courting/eat/goHome cadence, ported off .decomp directly, not off any
    // `inLove`-style flag), and it calls `Px.spawnMerchantParticles('heart'|'angry_villager',
    // ...)`, above, the same way `Br.emitLoveHeart`/`Br.emitBreedHearts` already call
    // `Px.spawn`/`Px.spawnBurst`. villagerbreedcheck.mjs.
    // struck s108: trade happy-villager particles — Trade.produceParticles (status 14), tradecheck §10.
    // D-659 block dust (BlockDustParticle) — what it still does NOT do, named:
    'block dust: shulker/bell/conduit entity sprites are resampled to the particle atlas tile (64x64 shulker -> 32x32)',
    'block dust: an animated sprite (water, fire, magma) shows its first frame only'
  ];

})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
