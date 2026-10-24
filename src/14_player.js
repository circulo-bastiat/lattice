// 14_player.js — the player entity: movement command, break/place, hotbar, inventory selection
// and break particles. Main thread only.
//
// The physics itself lives in 14b_physics.js and the targeting in 14c_raycast.js; this file is
// the part that knows about the keyboard, the block you are holding and the passage of time.

(function (NS) {
  'use strict';

  var P = NS.Player = {
    // --- entity state (14b_physics.js reads and writes these) ----------------
    x: 0, y: 100, z: 0,
    vx: 0, vy: 0, vz: 0,
    yaw: 0, pitch: 0,
    onGround: false,
    flying: true,
    noclip: false,
    sprinting: false,
    inWater: false, eyeInWater: false, inLava: false,

    // previous tick's position, and the render-time interpolation of the two. The camera reads
    // ex/ey/ez, never x/y/z: the tick is 20 Hz and the screen is not (D-79).
    px: 0, py: 100, pz: 0,
    ex: 0, ey: 100, ez: 0,

    EYE: 1.62,          // mirrors Physics.EYE; re-read from it in init()
    HEIGHT: 1.8,
    WIDTH: 0.6,
    reach: 5,             // set from the gamemode every switch (G6): 5.0 creative, 4.5 otherwise
    // loop/phantom -- Stats.CUSTOM.get(Stats.TIME_SINCE_REST), the ServerStatHandler stat
    // PhantomSpawner.spawn reads (.decomp/net/minecraft/world/spawner/PhantomSpawner.java:
    // 45-46): ticks since this player last slept in a bed. Incremented once per real tick in
    // P.tick() below; RESET ON SLEEP has no hook to attach to yet (14l_use.js's own Use.OWED
    // already lists beds/sleeping as unbuilt, G19c) -- NS.Phantom.resetTimeSinceRest
    // (07zz1_phantom.js) is exposed for that unit to call. Single-player only: this engine
    // has one Player, not a per-player stat table.
    timeSinceRest: 0,
    // loop/beds (G19c) -- BedBlock/PlayerEntity's own sleep state (14m_sleep.js's own
    // `Sleep` module owns the behaviour; these are just the fields it reads and writes,
    // the same split `P.timeSinceRest` just above already uses with `NS.Phantom`).
    sleeping: false,
    sleepPos: null,
    sleepTimer: 0,
    spawnPoint: null,   // ServerPlayerEntity's own spawnPointPosition/spawnAngle, set on sleep

    // --- gameplay -----------------------------------------------------------
    // ⚠ THE `creative` BOOLEAN IS GONE (D-253). It meant three unrelated things at once — break
    // instantly, may fly, take no damage — and there was nowhere in it to say "may fly but may
    // not build", which is why spectator and adventure could not exist. What replaces it is
    // vanilla's `Abilities`, filled by `Gamemode.set` from `GameType.updatePlayerAbilities`:
    // `instabuild`, `mayFly`, `mayBuild` and `invulnerableGamemode`, each read where it is meant.
    mode: 1,            // Gamemode.CREATIVE — what this game has always started in
    instabuild: true,
    mayFly: true,
    mayBuild: true,
    // ⚠ NOT THE SAME FLAG AS `mayBuild`: adventure mode may not PLACE and may still HIT (D-338).
    // ⚠⚠ It is declared HERE because `dupcheck` found the first version of this field read in
    // `P.act` and assigned nowhere at all — D-289's exact shape, a hook nothing fills, caught by
    // the check this project wrote after the last one.
    mayAttack: true,
    invulnerableGamemode: true,
    hotbar: null,       // Int32Array(9) of block ids, filled by init()
    slot: 0,
    breakProgress: 0,   // 0..1 against the currently targeted block
    breakTarget: -1,    // packed key of the block being broken, -1 = none
    placeCooldown: 0,
    breakCooldown: 0,
    shieldCooldown: 0,   // #862 -- shield's 100-tick ItemCooldownManager row after disableShield
    pearlCooldown: 0,   // loop/throwables-s116 -- EnderPearlItem's own ItemCooldownManager
                        // 20-tick row, ticked in P.tick (Throw.tickCooldown, 07zzd_throw.js)

    // ⚠⚠ **DECLARED HERE, AND THE ONE-WORD BUG THAT MADE THE GAME UNPLAYABLE (D-357).**
    // `P.act` gates the click-swing, the attack AND the whole mining branch on
    // `P.missTime <= 0`, and until tonight this field was declared NOWHERE. `undefined <= 0` is
    // **false** — not a type error, not a warning, just false — so both gates were false for
    // ever, and the only statement that could have set the field (`P.missTime = P.MISS_TIME`)
    // lives INSIDE the branch the gate guards. **A field whose only assignment is dominated by
    // the comparison that reads it can never become true**, and that is the class, not the case:
    // `tools/undefcheck.mjs` now hunts the shape across every file.
    // ⚠ `MISS_TIME` was ASSIGNED INSIDE `act`, once per frame, which is where it was hiding:
    // a constant written in the middle of a hot function reads as state and nobody audits it.
    missTime: 0,        // vanilla's `Minecraft.missTime` — ticks of attack lockout after a miss
    MISS_TIME: 10,      // `Minecraft.startAttack` sets it to 10 on a miss, and not in creative
    attackTicks: 0,     // the 20 Hz accumulator `act` steps the continue-attack swing on
    targetEntity: null, // the entity under the crosshair, when it is nearer than the block
    targetEntityDist: 0,
    lastAttack: null,

    target: null,       // the current raycast hit, or null. Reused; do not keep a reference.
    hasTarget: false,
    tx: 0, ty: 0, tz: 0, tface: 0, tid: 0,
    thx: 0, thy: 0, thz: 0,      // the hit POINT, for the placement rules (D-157)
    // ⚠ DECLARED, AND `null` RATHER THAN A NUMBER ON PURPOSE (D-357): "no block was hit" is not
    // a distance, and every read is gated on `!== null`. Left undefined, `r.t > undefined` is
    // false and an entity behind a block would win the pick — quietly, and only sometimes.
    blockDist: null,

    // ── what the first-person hand rides on (D-359) ─────────────────────────────────────────
    // ⚠ EVERY ONE OF THESE IS A VANILLA FIELD WITH A VANILLA NAME, and they are declared here
    // for the reason §6 of `dupcheck` now enforces: `bobView` compares them as numbers on the
    // first frame of the world, before anything has had a chance to write one.
    walkDist: 0, walkDistO: 0,   // `Entity.walkDist` — horizontal distance x 0.6, the bob's PHASE
    bob: 0, oBob: 0,             // `Player.bob` — the smoothed ground speed, the bob's AMPLITUDE
    xBob: 0, xBobO: 0,           // the hand's smoothed heading; the camera minus this is the SWAY
    yBob: 0, yBobO: 0,
    pPitch: 0, pYaw: 0,          // last tick's look, so the sway interpolates inside the frame
    hurtTime: 0, hurtDuration: 10, hurtDir: 0, deathTime: 0,
    handsBusy: false,            // vanilla's `isHandsBusy`: eating, drawing a bow, riding
    // loop/bow -- `LivingEntity.isUsingItem()`'s own hold-use state, built for the bow's draw
    // (a future eating/drinking stage, `Use.OWED`'s own G19d line, reuses these same three
    // fields rather than a second hold machine). `useTicks` counts UP from 0 -- the item's own
    // `getMaxUseTime() - useTicks` is vanilla's countdown; see `Use.bowRelease`, 14l_use.js.
    usingItem: false,
    useHand: 0,                  // 0 = main hand -- a draw only ever STARTS from `P.slot` today
    useTicks: 0,
    useAcc: 0,                   // sub-tick remainder of the frame clock (`Use.holdAdvance`)
    useMax: 0,                   // `getMaxUseTime` of the held stack, fixed at `Use.holdBegin`
    useKind: null,               // 'drink' while a G19d-d drink/stew hold runs; null = bow

    REPLACEABLE: null,  // = States.replaceable: per REAL STATE, vanilla's Material flag (D-263)
    PLACEABLE: null     // block ids offered by the creative inventory, in registry order
    // (the break/hit particle pool that lived here is gone — D-659: `NS.Particle`'s BlockDust)
  };

  var CFG;

  P.init = function () {
    CFG = NS.CFG;
    var SR = NS.States, R = NS.Reg, Ph = NS.Physics;
    P.EYE = Ph.EYE; P.HEIGHT = Ph.H; P.WIDTH = Ph.W;
    // PLAN G5's survival state. It lives on the player entity, so a check can run a whole life
    // without a browser and the HUD can read it without asking anything.
    if (NS.Survival) NS.Survival.init(P);
    if (NS.Gamemode) NS.Gamemode.set(P, P.mode);

    // ⚠ THE PLAYER HAS A REAL INVENTORY NOW (D-275), and `P.hotbar` is a VIEW OF IT.
    // G8 built `Inventory` and `Menu` and nothing held one: the player's hotbar was nine block
    // STATES in an Int32Array, so an item stack could not be picked up, counted or crafted. The
    // inventory is the truth; `P.hotbar[i]` is the block state of whatever is in slot i, kept in
    // step by `P.syncHotbar()`. Everything downstream — placement, the icons, `gamecheck` —
    // keeps reading a state per slot and does not know the difference, which is the whole point
    // of introducing the real thing this way rather than rewriting six call sites at once.
    // ⚠⚠ THE PLAYER STARTS WITH NOTHING, BECAUSE THAT IS WHAT MINECRAFT DOES (D-312).
    // Nine slots pre-filled with 64 of grass, dirt, stone, cobblestone, planks, log, sand, glass
    // and a torch was scaffolding from before there WAS an inventory — it existed so that
    // something could be placed at all. It survived into a build with a real 46-slot inventory,
    // a creative menu and a survival loop, where it is simply wrong: a new survival world hands
    // you an empty hotbar, and a new creative world hands you the creative INVENTORY, not a
    // starter kit. Dan: *"remove the crude starting point of 64 blocks."*
    // ⚠ The `want` list is gone rather than commented out or moved behind a flag (D-139): a
    // stage that REPLACES something is not done until the something is deleted.
    P.hotbar = new Int32Array(9);
    var Iv = NS.Inventory;
    if (Iv) {
      P.inventory = Iv.create();
      if (NS.Menu) P.menu = NS.Menu.playerMenu(P.inventory, P);
      P.syncHotbar();
    }

    // ⚠ PASS 17 JOB 1 (G19b), ender chest (D-404): vanilla's `EnderChestMenu` is backed by
    // `Player.getEnderChestInventory()` — ONE 27-slot inventory that every ender chest block the
    // player opens shares, not a per-block store the way `chest`/`trapped_chest`/`barrel` are.
    // It lives here, on the player, for exactly that reason. `Hud.openChest` rebinds whichever
    // block entity was clicked to point AT this array (`be.items = P.enderItems`) rather than at
    // its own — see that function's own header for why a real per-position block entity still
    // exists at all (its `open` counter drives the lid, independently, the way vanilla's own
    // block entity still does).
    // ⚠ NOT YET IN `P.toJSON`/`P.fromJSON` below — a block entity's OWN `items` (a plain chest's
    // contents) is not saved by this build either (no `BlockEntities` entry in 16b_save.js at
    // all yet), so this is not a new gap relative to what already ships; it is named here rather
    // than silently discovered, `docs/archive/PLAN.md`'s open-gap table.
    P.enderItems = new Array(27);

    // ⚠ D-263 — WHAT A PLACED BLOCK MAY OVERWRITE IS NOT A GEOMETRIC QUESTION, and this is where
    // it was asked as one. The rule was "a model, with no collision box and no light", which is
    // 139 blocks and 2,590 real states against vanilla's 28 blocks: fence gates, buttons,
    // pressure plates, levers, tripwire hooks, all four rails, redstone wire, every sapling,
    // every flower, every coral and coral fan, cobweb, item frames, sugar cane, sweet berry
    // bush, every crop, both dripleaves, spore blossom and powder snow were all silently
    // overwritable, in both directions — the same table decides whether a placement goes INTO
    // the clicked cell or onto its face. Dan reported it as "placing blocks can overwrite
    // others". Vanilla asks `Material.isReplaceable()`, which is compiled Java; it now comes out
    // of the jar's bytecode through `tools/extract-materials.mjs` and rides in the runtime blob.
    // This alias stays because it is the name the checks know; the table is States'.
    P.REPLACEABLE = SR.replaceable;

    // The creative inventory: every block's DEFAULT state, once each, except air. 899 entries
    // rather than 20,343 — a player picking a block wants "oak stairs", not "oak stairs facing
    // east, top half, waterlogged". Placement variants come with G2 block behaviour.
    var list = [];
    for (var bi = 1; bi < R.blockCount; bi++) {
      var st = R.realFirst[bi] + R.defaultState[bi];
      if (SR.geom[st] === SR.GEOM_NONE && SR.solid[st] === 0) continue;   // nothing to see
      list.push(st);
    }
    P.PLACEABLE = list;

    return P;
  };

  // ---------------------------------------------------------------------------
  // Spawn
  // ---------------------------------------------------------------------------

  /**
   * findSpawn(cx, cz) -> {x, z} | null
   *
   * Vanilla does not drop you in the sea, and neither does this. Walks the generated columns in
   * spiral order and takes the first one whose highest SOLID block is above sea level with air
   * above it — hmap already holds that height, so the whole search is one array read per column
   * and it only ever looks at chunks the warm-up has already produced.
   */
  P.SEA_LEVEL = 63;

  P.findSpawn = function (cx, cz) {
    var W = NS.World, SR = NS.States;
    var list = W.spiral(2);
    for (var i = 0; i < list.length; i += 2) {
      var c = W.get(cx + list[i], cz + list[i + 1]);
      if (!c || c.state < NS.CH.GENERATED) continue;
      for (var lz = 0; lz < 16; lz++) {
        for (var lx = 0; lx < 16; lx++) {
          var h = c.hmap[(lz << 4) | lx] + CFG.WORLD_MIN_Y;
          if (h <= P.SEA_LEVEL) continue;                 // seabed, or a beach that floods
          var wx = c.cx * 16 + lx, wz = c.cz * 16 + lz;
          if (SR.solid[W.getBlock(wx, h, wz)] !== 1) continue;
          if (W.getBlock(wx, h + 1, wz) !== 0) continue;  // under a tree or a plant
          if (W.getBlock(wx, h + 2, wz) !== 0) continue;  // no headroom
          return { x: wx, z: wz };
        }
      }
    }
    return null;
  };

  /**
   * spawn(x, z) — stand on the terrain at (x,z). Uses the chunk's height map when it exists and
   * a downward scan otherwise, then verifies with the real collider so we never spawn inside a
   * tree or half a block into a hill.
   */
  P.spawn = function (x, z) {
    P.x = Math.floor(x) + 0.5;
    P.z = Math.floor(z) + 0.5;
    var h = NS.World.heightAt(P.x | 0, P.z | 0);
    var from = (h > CFG.WORLD_MIN_Y) ? Math.min(CFG.WORLD_MAX_Y - 3, h + 3) : 200;
    P.y = from;
    if (!NS.Physics.settle(P, from)) P.y = 100;
    P.vx = P.vy = P.vz = 0;
    P.flying = false;
    // #329: this read `o.dimension` with no `o` in scope (#254), a ReferenceError on every boot.
    P.dimension = NS.Dim ? NS.Dim.norm(P.dimension) : 'overworld';
    P.px = P.x; P.py = P.y; P.pz = P.z;
    P.ex = P.x; P.ey = P.y; P.ez = P.z;
    // QUEUE 0.2 (G18e remainder) — a respawn drops any ride the same way vanilla's own death
    // (`LivingEntity.onDeath` -> `stopRiding`) or a fresh join never starts one mounted.
    P.vehicle = null;
    P.mountJumpTicks = 0;
    P.mountJumpStrength = 0;
    return P;
  };

  // ---------------------------------------------------------------------------
  // Per-tick update (fixed 20 Hz)
  // ---------------------------------------------------------------------------

  var cmd = { fwd: 0, strafe: 0, jump: false, sneak: false, sprint: false };

  // QUEUE 0.2 (G18e remainder) -- `P.vehicle` is the mount the live player is riding (a horse
  // entity from `07r_mount.js`'s own `EntityList`, or `null`). `P.mountJumpTicks`/
  // `P.mountJumpStrength` are `ClientPlayerEntity.field_3938`/`mountJumpStrength` (.decomp,
  // javap'd `tickMovement`), and `15_hud.js`'s jump bar reads the strength field directly.
  P.vehicle = null;
  P.mountJumpTicks = 0;
  P.mountJumpStrength = 0;
  var wasMountJumpHeld = false;

  /**
   * `HorseEntity.interactMob`'s bottom fall-through lands here once `Mount.interact` reports
   * `{mounted:true}` (`14l_use.js`'s own dispatch — the one line that calls this). Vanilla's
   * `startRiding` has no arithmetic of its own worth transcribing beyond "stop falling, stop
   * charging a jump from a previous ride" (`Entity.startRiding` resets fall distance; the jump
   * fields are this engine's own bookkeeping, reset so a charge from a PREVIOUS mount never
   * leaks onto a new one).
   */
  P.mountVehicle = function (e) {
    if (!e) return;
    P.vehicle = e;
    P.vx = P.vy = P.vz = 0;
    P.mountJumpTicks = 0;
    P.mountJumpStrength = 0;
    wasMountJumpHeld = false;
  };

  /**
   * The sneak-to-dismount path: `PlayerEntity.tickMovement` — `if (shouldDismount() &&
   * hasVehicle()) stopRiding()`, and `shouldDismount()` is exactly `isSneaking()` (.decomp,
   * both read in full). `HorseBaseEntity.updatePassengerForDismount`/`Entity.
   * getPassengerDismountOffset` place the dismounted rider off to the side, main-arm-right
   * first then the other side (this engine never models a left-handed player, so only the
   * first try's yaw is the jar's real default) — `Mount.dismountOffset` is that formula
   * verbatim, and QUEUE 0.2 (G18e remainder, this pass) now runs the REAL per-pose "walk up
   * through the column" safety scan too (`Mount.findDismountPos`/`locateSafeDismountingPos`,
   * 07r_mount.js, owned by that unit — `Dismounting.canDismountInBlock`/`getDismountHeight`/
   * `canPlaceEntityAt`, folded onto this engine's own boolean `Physics.solidAt`, that function's
   * own header says exactly how). `null` from both sides falls back to the mount's own position,
   * the jar's own final fallback, same as before this pass.
   */
  P.dismountVehicle = function () {
    var Mnt = NS.Mount, Ph = NS.Physics;
    var e = P.vehicle;
    if (!Mnt || !e) return;
    var pw = P.WIDTH || 0.6;
    var found = Mnt.findDismountPos ? Mnt.findDismountPos(e, pw, Ph) : null;
    if (!found) found = { x: e.x, y: e.y, z: e.z };
    P.x = found.x; P.y = found.y; P.z = found.z;
    P.ex = P.x; P.ey = P.y; P.ez = P.z;
    if (found.pose && Ph.POSE[found.pose]) { P.height = Ph.POSE[found.pose].h; P.eyeHeight = Ph.POSE[found.pose].eye; }   // setPose
    P.vx = P.vy = P.vz = 0;
    Mnt.dismount(e);
    P.vehicle = null;
    P.mountJumpStrength = 0;
    P.mountJumpTicks = 0;
  };

  /**
   * `ClientPlayerEntity.tickMovement`'s `hasJumpingMount()` block (.decomp, javap'd), verbatim
   * state machine: charge grows 0.1/tick for the first 9 ticks then eases toward 1.0, a release
   * hands the floored `strength*100` straight to `Mount.setJumpStrength` (this engine has no
   * client/server split, so the packet round-trip `startRidingJump()` triggers server-side is
   * skipped — the SAME call already ran locally), and a 10-tick cooldown (`field_3938` counting
   * back up from -10) blocks recharging the instant after a jump the way the jar's own does.
   */
  function tickMountedJump(vehicle, jumpHeld) {
    var Mnt = NS.Mount;
    // loop/pigride-s98 -- `Mnt.isSaddled` reads the SAME shared `e.saddled` flag a saddled PIG
    // now also sets (`Passive.pigSaddle`, 07w_passive.js) -- without the `Mnt.isMountable` gate
    // here, a saddled pig would charge a horse-family jump it has no `AbstractHorseEntity.
    // setJumpStrength` counterpart for at all (pigs never jump-charge in vanilla; only the
    // horse family, `Mnt.MOUNTABLE`, does). This is the one line that keeps this shared-file
    // jump-bar/charge logic horse-family-only, exactly as `HorseBaseEntity` alone overrides it.
    var canJump = !!(Mnt && Mnt.ready && Mnt.isMountable(vehicle) && Mnt.isSaddled(vehicle));
    if (!canJump) { P.mountJumpStrength = 0; wasMountJumpHeld = jumpHeld; return; }
    if (P.mountJumpTicks < 0) {
      P.mountJumpTicks++;
      if (P.mountJumpTicks === 0) P.mountJumpStrength = 0;
    }
    if (wasMountJumpHeld && !jumpHeld) {
      P.mountJumpTicks = -10;
      Mnt.setJumpStrength(vehicle, Math.floor(P.mountJumpStrength * 100));
    } else if (!wasMountJumpHeld && jumpHeld) {
      P.mountJumpTicks = 0;
      P.mountJumpStrength = 0;
      Mnt.startJumping(vehicle);   // startRidingJump -> HorseBaseEntity.startJumping: entity.horse.jump 0.4/1.0
    } else if (jumpHeld) {
      P.mountJumpTicks++;
      if (P.mountJumpTicks < 10) P.mountJumpStrength = P.mountJumpTicks * 0.1;
      else P.mountJumpStrength = 0.8 + (2 / (P.mountJumpTicks - 9)) * 0.1;
    }
    wasMountJumpHeld = jumpHeld;
  }

  /**
   * The RIDDEN branch of the per-tick update, pulled out of `P.tick` so `mountcheck.mjs` can
   * drive it directly (camera-follow position, input->`travelRidden`, dismount) without also
   * standing up `Input`/`Hand`/`Sound`/`Hud`/`Chat`. `P.tick` calls this and nothing else once
   * `P.vehicle` is set and ridden; see it for why ground `Physics.tick` never runs alongside it.
   */
  P.tickMounted = function (cmd) {
    // `LivingEntity.baseTick`: submerged in water + vehicle !canBeRiddenInWater() -> stopRiding()
    // (only SkeletonHorseEntity overrides it to true).
    if (P.eyeInWater && P.vehicle.type !== 'skeleton_horse') { P.dismountVehicle(); return; }
    if (cmd.sneak) {
      // `PlayerEntity.tickMovement`'s own `shouldDismount()` branch calls `stopRiding()` and
      // returns to the TOP of that same tick's `super.tickMovement()`, which would run ground
      // physics again immediately — one tick's delay before `Physics.tick` resumes (this
      // engine's own `P.tick` calls it next tick, once `P.vehicle` reads null) is the one
      // simplification this file takes on the dismount tick, so a bare `Physics.tick(P, cmd)`
      // right here never runs against `P.HEIGHT`/`P.WIDTH` before anything has set them up for
      // a caller that only ever wanted the position/rider-state half of dismounting.
      P.dismountVehicle();
      return;
    }
    var veh = P.vehicle;
    // `PlayerMoveC2SPacket`/`ClientPlayerEntity`'s own per-tick input, real values this time —
    // `Mount.travelRidden`'s own header names this exact wiring as `Mount.OWED` before this
    // session (`e.riderInput` is the new default `Mount.travelRidden` reads, 07r_mount.js).
    veh.riderInput = {
      forwardSpeed: cmd.fwd,
      sidewaysSpeed: cmd.strafe,
      yaw: P.yaw,
      pitch: P.pitch
    };
    tickMountedJump(veh, !!cmd.jump);
    // `Entity.updatePassengerPosition`/`HorseBaseEntity.getMountedHeightOffset` — the
    // camera/position follow: `10_gfx.js` already reads `P.ex/ey/ez` for the eye every frame
    // (no change needed there), so writing the TICK position here is the whole of "the camera
    // follows the mount". One tick stale at most: the mount's own `Ai`/`EntityList` tick (which
    // actually calls `Mount.travelRidden`) runs in the same fixed-step loop this tick belongs to.
    var ro = NS.Mount.riderOffset(veh);   // #3934: the rearing horse swings its rider back
    P.x = veh.x + ro.x;
    P.y = veh.y + NS.Mount.mountedHeightOffset(veh) + ro.y;
    P.z = veh.z + ro.z;
    P.onGround = !!veh.onGround;
    P.vx = P.vy = P.vz = 0;
  };

  /** `ServerPlayerEntity.tickVehicleInLavaRiding` (.decomp): the first tick in lava remembers the position,
   *  each later one fires RIDE_ENTITY_IN_LAVA (TravelCriterion: start_position + distance). */
  P.tickVehicleInLavaRiding = function () {
    var v = P.vehicle;
    if (v && v.inLava) {
      if (!P.vehicleInLavaRidingPos) P.vehicleInLavaRidingPos = [P.x, P.y, P.z];
      else if (NS.Adv && NS.Adv.trigger) NS.Adv.trigger(P, 'minecraft:ride_entity_in_lava', { player: P, start: P.vehicleInLavaRidingPos });
    }
    if (P.vehicleInLavaRidingPos && (!v || !v.inLava)) P.vehicleInLavaRidingPos = null;
  };

  /**
   * `ServerPlayerEntity.setCameraEntity` / `attack(Entity)` in spectator mode: a left-click on an entity makes it
   * the camera entity. `P.cameraEntity` is null or the followed entity; the view (10_gfx) reads its eye, yaw and pitch.
   */
  P.spectate = function (e) {
    var Gm = NS.Gamemode;
    if (!e || e === P || e.removed || e.dead || !(Gm && Gm.isSpectator && Gm.isSpectator(P))) return false;
    P.cameraEntity = e;
    return true;
  };
  P.releaseCamera = function () { P.cameraEntity = null; };
  P.cameraEyeHeight = function (e) { return e.eyeHeight !== undefined ? e.eyeHeight : (e.height || 1.8) * 0.85; };
  /** Per tick: sneak (or any movement key) releases; a removed/dead target releases; otherwise the player is dragged to it. */
  P.tickSpectate = function (c) {
    var e = P.cameraEntity;
    if (!e) return;
    var Gm = NS.Gamemode;
    if (!(Gm && Gm.isSpectator && Gm.isSpectator(P)) || e.removed || e.dead || c.sneak || c.fwd || c.strafe || c.jump) { P.cameraEntity = null; return; }
    P.x = e.x; P.y = e.y; P.z = e.z;
    P.ex = P.x; P.ey = P.y; P.ez = P.z;
  };

  /** Camera.updateEyeHeight (.decomp Camera.java:62): float cameraY eases 0.5 of the way to the current eye height each tick. */
  P.cameraEyeTick = function () {
    var eye = P.eyeHeight || P.EYE;
    if (P.camY === undefined) P.camY = eye;
    P.lastCamY = P.camY;
    P.camY = Math.fround(P.camY + Math.fround((eye - P.camY) * 0.5));
  };
  /** Camera.getPos: lerp(partial, lastCameraY, cameraY). Only the CAMERA is smoothed; ray casts keep P.eyeHeight. */
  P.cameraEyeY = function (alpha) {
    if (P.camY === undefined) return P.eyeHeight || P.EYE;
    return P.lastCamY + (P.camY - P.lastCamY) * alpha;
  };

  P.tick = function () {
    var I = NS.Input;
    P.tickVehicleInLavaRiding();
    P.cameraEyeTick();
    P.px = P.x; P.py = P.y; P.pz = P.z;
    // ⚠ THE LOOK HAS A PREVIOUS-TICK VALUE TOO, and for the same reason the position does: the
    // hand's sway is interpolated INSIDE the frame, so a hand driven by the tick's look alone
    // moves in twenty steps a second while the camera moves in a hundred and forty (D-359).
    P.pPitch = P.pitch; P.pYaw = P.yaw;
    P.walkDistO = P.walkDist;
    // loop/phantom -- Stats.CUSTOM.TIME_SINCE_REST increments every real tick a player is
    // alive/loaded (ServerPlayerEntity.tick's own generic stat-increment path); this engine
    // is reset on death by Sv.die (14d_survival) and on sleep (14m_sleep); it does not bump asleep (PlayerEntity.tick: `if (!this.isSleeping()) incrementStat(TIME_SINCE_REST)`).
    if (!P.sleeping) P.timeSinceRest = (P.timeSinceRest || 0) + 1;
    if (NS.Sleep && NS.Sleep.tick) NS.Sleep.tick(P);   // loop/beds (G19c)
    // ServerPlayerEntity.playerTick -> Criteria.TICK.trigger(player) (the root advancements' auto-grant).
    if (NS.Adv && NS.Adv.trigger && !P.dead) NS.Adv.trigger(P, 'minecraft:tick', { player: P });
    if (NS.Fly && NS.Fly.tickShoulders) NS.Fly.tickShoulders(P);
    // #601: the player's own `tickCramming` half (mobs shove it from their tick, it shoves them from its own).
    if (!P.dead && NS.EntityList && NS.EntityList.pushAround) NS.EntityList.pushAround(P);

    if (I.uiOpen || !I.locked) {
      cmd.fwd = cmd.strafe = 0;
      cmd.jump = cmd.sneak = cmd.sprint = false;
    } else {
      cmd.fwd    = (I.down('KeyW') ? 1 : 0) - (I.down('KeyS') ? 1 : 0);
      cmd.strafe = (I.down('KeyD') ? 1 : 0) - (I.down('KeyA') ? 1 : 0);
      cmd.jump   = I.down('Space');
      cmd.sneak  = I.sneakOn();
      cmd.sprint = I.sprintOn(cmd.fwd);
    }

    P.tickSpectate(cmd);

    // PLAN G10's hand rides on the tick, not on the frame: the swing is SIX TICKS and the attack
    // cooldown counts ticks, so driving either from `dt` would make both frame-rate dependent —
    // which is how a clone ends up with a faster swing on a better computer (D-270).
    if (NS.Hand) {
      NS.Hand.tickSwing(P); NS.Hand.tickAttackStrength();
      // PlayerEntity.tick: a switch to a different ITEM (or to/from an empty hand) resets the charge
      NS.Hand.noteSelected(P);
    }
    // PLAN G13's footsteps. ⚠ VANILLA COUNTS DISTANCE, NOT TIME: `Entity.moveDist` accumulates
    // the horizontal distance walked and a step plays every time it passes the next whole unit,
    // so a sprint steps faster than a walk without any timer being involved, and crouching (which
    // moves you less far per tick) steps less often for free (D-285).
    if (NS.Sound) P.tickFootsteps();
    // the held item's name fades on the TICK too — 40 ticks is 40 ticks (vanilla's
    // `toolHighlightTimer`), so a better frame rate must not make it disappear sooner.
    if (NS.Hud && NS.Hud.tickToolHighlight) NS.Hud.tickToolHighlight(P.heldItem());
    // loop/throwables-s116 -- the ender pearl's own cooldown counts real ticks the same way
    // (Throw.tickCooldown, 07zzd_throw.js), not frame-rate-dependent `dt`.
    if (NS.Throw && NS.Throw.tickCooldown) NS.Throw.tickCooldown(P);
    if (NS.Use && NS.Use.tickRiptide) NS.Use.tickRiptide(P);   // #5616
    if (NS.Use && NS.Use.tickShieldCooldown) NS.Use.tickShieldCooldown(P);   // #862
    if (NS.Use && NS.Use.tickItemCooldowns) NS.Use.tickItemCooldowns(P);
    // the chat's 200-tick visibility is TICKS, not seconds (D-283) — same reason as the hand.
    if (NS.Chat) NS.Chat.tickChat();
    // ⚠ THE TITLE CLOCK TICKS WITH THE CHAT'S, on the 20 Hz tick and not on the frame. A fade
    // driven by the frame rate runs at a different speed on every machine, which is the whole
    // reason vanilla counts these in ticks (D-326).
    if (NS.Hud && NS.Hud.tickFloatingItem) NS.Hud.tickFloatingItem();
    if (NS.Hud && NS.Hud.tickTitles) NS.Hud.tickTitles();
    if (NS.Hud && NS.Hud.tickVignette) NS.Hud.tickVignette();

    var wasOnGround = P.onGround, riding = false;
    // loop/beds (G19c) -- a sleeping player does not move; vanilla's own `LivingEntity.
    // travel` never reaches `Entity.move` for a sleeping entity (`tickMovement`'s own
    // early return), so this sits beside the mounted branch rather than inside Physics.
    if (P.sleeping) {
      P.vx = P.vy = P.vz = 0;
    } else if (P.vehicle && !P.vehicle.dead && NS.Mount && NS.Mount.isRidden(P.vehicle)) {
      riding = true;
      P.tickMounted(cmd);
    } else {
      // `ElytraItem.isUsable` (damage < max - 1) on the chest slot is what lets a glide start
      // and what ends it; published as a flag because Physics loads without the inventory.
      var chest = NS.Inventory && P.inventory && P.inventory.slots ? P.inventory.slots[NS.Inventory.ARMOR_START + 2] : null;
      var eid = NS.Items && NS.Items.ready && chest && !NS.Inventory.isEmpty(chest) ? chest.i : -1;
      P.elytraUsable = eid >= 0 && NS.Items.names[eid] === 'elytra' && (chest.d | 0) < NS.Items.durability[eid] - 1;
      P.autoJumpEnabled = !(NS.Settings && NS.Settings.autoJump === false) && !P.autoJumpOff;
      NS.Physics.tick(P, cmd);
      // `LivingEntity.tickFallFlying`: one point of elytra damage a second while gliding
      if (P.fallFlying && P.elytraUsable && (P.glideTicks = (P.glideTicks | 0) + 1) % 20 === 0 && !P.invulnerableGamemode) chest.d = (chest.d | 0) + 1;
      if (!P.fallFlying) P.glideTicks = 0;
      P.fallFlyTicks = P.fallFlying ? (P.fallFlyTicks | 0) + 1 : 0;   // LivingEntity.getRoll (third-person glide lean)
      P.lastSwimAmount = P.swimAmount || 0;   // LivingEntity.updateLeaningPitch
      P.swimAmount = P.swimming ? Math.min(1, P.lastSwimAmount + 0.09) : Math.max(0, P.lastSwimAmount - 0.09);
      if (P.flyIntoWall) {
        if (NS.Survival && !P.invulnerableGamemode) NS.Survival.hurt(P, 'generic', P.flyIntoWall);
        P.flyIntoWall = 0;
      }
    }

    // ── what the first-person hand rides on (D-359), all of it vanilla's own arithmetic ─────
    // ⚠ `Entity.move`: **`walkDist += horizontalDistance * 0.6`**, read off the bytecode rather
    // than remembered (class `axk`, field `I`). It is the bob's PHASE — distance, not time — so
    // walking into a wall does not rock the camera and a sprint bobs faster for free.
    var mdx = P.x - P.px, mdy = P.y - P.py, mdz = P.z - P.pz;
    var hdist = Math.sqrt(mdx * mdx + mdz * mdz);
    // `PlayerEntity.tickRiding`: a passenger never calls `Entity.move`, so no walkDist/moveDist,
    // and the bob amplitude is zeroed outright (#397).
    if (!riding) P.walkDist += hdist * 0.6;
    // ⚠⚠ **AND `moveDist` IS THE 3D DISTANCE, ALSO TIMES 0.6 — WHICH THIS ENGINE HAS NEVER DONE**
    // (D-362). `Entity.move` accumulates `sqrt(dx^2+dy^2+dz^2) * 0.6` into the field the footstep
    // gate reads; `tickFootsteps` was adding the RAW HORIZONTAL distance, so a step played every
    // 1.0 blocks walked instead of every ~1.67. **Footsteps have been 67% too frequent since
    // G13** — audible, and exactly the "machine gun" Dan's own sound note warns about.
    // It is accumulated HERE rather than in `tickFootsteps` because vanilla accumulates it in
    // `move()` whether or not you are on the ground; only the SOUND is gated on that.
    // ⚠ #371: `Entity.move` zeroes dy unless the landing block is CLIMBABLE or powder snow, and
    // `PlayerEntity.getMoveEffect()` is NONE while flying or sneaking on the ground: no distance
    // at all then. There is no on-ground gate, so climbing a ladder counts (dy kept) and steps.
    if (!riding && !(P.flying || (P.onGround && cmd.sneak))) {
      var lb = NS.World && NS.World.getBlock(Math.floor(P.x), Math.floor(P.y - 0.2), Math.floor(P.z));
      var ln = lb && NS.Reg ? NS.Reg.names[lb] : '';
      var vy = (ln === 'ladder' || ln === 'vine' || ln === 'scaffolding' || ln === 'twisting_vines' ||
                ln === 'weeping_vines' || ln === 'twisting_vines_plant' || ln === 'weeping_vines_plant' ||
                ln === 'powder_snow') ? mdy : 0;
      P.moveDist += Math.sqrt(mdx * mdx + vy * vy + mdz * mdz) * 0.6;
    }
    // ⚠ `Player.tick`: the bob's AMPLITUDE is a smoothed, CAPPED ground speed — `min(0.1, speed)`
    // eased by 0.4 a tick — and it is zero in the air, which is why vanilla's camera goes still
    // the moment you jump. A bob that keeps its amplitude mid-air reads as a boat.
    P.oBob = P.bob;
    // vanilla's third term is `!isSwimming()`: `P.swimming` is the real pose flag (Physics.updateSwimming)
    // #397: fed the POST-friction velocity (`getVelocity().horizontalLength()`), not the tick's displacement
    var bobTarget = (!riding && P.onGround && !P.dead && !P.swimming) ? Math.min(0.1, Math.sqrt(P.vx * P.vx + P.vz * P.vz)) : 0;
    P.bob += (bobTarget - P.bob) * 0.4;
    // ⚠ `LocalPlayer.tick`: the hand's own smoothed heading, eased by **0.5** a tick. The hand
    // is drawn rotated by a TENTH of (camera − this), so a fast turn leaves it trailing and a
    // stop lets it catch up. That is the "sway" Dan says is missing, and nothing else is.
    P.xBobO = P.xBob; P.yBobO = P.yBob;
    var pitchDeg = -P.pitch * 180 / Math.PI;        // vanilla's pitch is positive DOWN
    var yawDeg = P.yaw * 180 / Math.PI;
    P.xBob += (pitchDeg - P.xBob) * 0.5;
    // ⚠ AND THE YAW EASES THE SHORT WAY ROUND. `Input.applyLook` wraps yaw into (−180, 180], so
    // a player turning through south has a 360-degree jump in this difference — and a hand that
    // whips a full turn once per lap is the kind of bug that only shows up while playing.
    var dy = yawDeg - P.yBob;
    while (dy > 180) dy -= 360;
    while (dy < -180) dy += 360;
    P.yBob += dy * 0.5;
    // ⚠ `P.yBob` IS DELIBERATELY *NOT* WRAPPED HERE (D-415). It eases the short way round, so it
    // can settle a whole turn away from a yaw that has wrapped — 190 chasing -170 — and the one
    // place that subtracts the two (`Hand3D.swayYaw`) wraps the DIFFERENCE instead. Wrapping
    // this value would put a 360-degree discontinuity between `yBobO` and `yBob` on the tick it
    // happened, and the renderer lerps between them: one frame of the hand sweeping a full turn,
    // traded for the permanent offset. Fix the subtraction, not the value it reads.
    // ⚠ THE HURT TIMER COUNTS DOWN HERE, not in the renderer: `bobHurt` reads it and a renderer
    // that decremented it would run the flinch at the frame rate.
    if (P.hurtTime > 0) P.hurtTime--;
    if (P.dead) P.deathTime++; else P.deathTime = 0;
    // ServerPlayerEntity.playerTick: `if (age % 20 == 0) Criteria.LOCATION.trigger(this)`
    P.age = (P.age | 0) + 1;
    if (P.age % 20 === 0 && P.advancements && NS.Adv && NS.Adv.trigger) {
      var Wd = NS.World, Cl = NS.Climate;
      NS.Adv.trigger(P, 'minecraft:location', {
        player: P, dimension: P.dimension || 'overworld',
        biomeAt: function (x, y, z) { return Cl && Cl.biomeNames ? Cl.biomeNames[Wd.biomeAt(x, z)] : ''; },
        structureAt: function (x, y, z, f) { return !!(NS.Structures && NS.Structures.containsAt && NS.Structures.containsAt(f.replace('minecraft:', ''), x, y, z)); },
        lightAt: function (x, y, z) { var l = Wd.getLight(x, y, z); return Math.max(l & 15, (l >> 4) & 15); },
        blockAt: function (x, y, z) { return Wd.getBlock(x, y, z); }
      });
    }
    // PLAN G10d — the equip dip, which is a TICK animation (0.4 a tick) like the swing.
    if (NS.Hand && NS.Hand.tickEquip) NS.Hand.tickEquip(P);

    // ── PLAN G5: the survival loop rides on the movement that just happened ────────────────
    var Sv = NS.Survival;
    if (Sv && !P.invulnerableGamemode) {
      // exhaustion is charged per BLOCK moved, and vanilla charges it from the distance actually
      // travelled rather than from the intent — so it is measured here, after the collision.
      var dx = P.x - P.px, dz = P.z - P.pz;
      var dist = Math.sqrt(dx * dx + dz * dz);
      // #503: `increaseTravelMotionStats` measures isSwimming (sprinting in water) and submerged in
      // 3D; merely touching water (the surface) is horizontal only.
      if (P.inWater && (P.eyeInWater || P.sprinting)) { var dyv = P.y - P.py; dist = Math.sqrt(dist * dist + dyv * dyv); }
      if (NS.Stats) NS.Stats.travel({
        swimming: !!(P.inWater && P.sprinting), submerged: !!P.eyeInWater, inWater: !!P.inWater,
        climbing: !!(NS.Physics && NS.Physics.onClimbable && NS.Physics.onClimbable(P)), onGround: !!P.onGround,
        sprinting: !!P.sprinting, sneaking: !!P.sneaking, fallFlying: !!P.fallFlying
      }, dx, P.y - P.py, dz);
      if (dist > 0) {
        if (P.inWater) Sv.movement(P, dist, { swimming: true });
        else if (P.onGround) Sv.movement(P, dist, { climbing: !!(NS.Physics && NS.Physics.onClimbable && NS.Physics.onClimbable(P)), sprinting: !!P.sprinting, walking: true });
      }
      // a jump is the tick the player left the ground under their own power
      if (wasOnGround && !P.onGround && P.vy > 0) Sv.jumped(P, !!P.sprinting);
      // ⚠ ARMOUR BEFORE DAMAGE, NOT AFTER (D-291). The fall below is resolved this same tick, so
      // recomputing what is worn afterwards would apply this tick's armour to next tick's hit —
      // and the tick a player falls is exactly the tick they care whether the boots counted.
      if (Sv.updateArmor) Sv.updateArmor(P, P.inventory);
      // and the fall the physics measured (D-251) becomes damage here, because health is G5's
      if (P.pendingFallDamage) {
        // #370: `handleFallDamage` — small_fall/big_fall (split at damage > 4) at 1/1, then
        // `playBlockFallSound` for the block at floor(y - 0.2)
        var fd = P.pendingFallDamage;
        if (NS.Sound && fd > 0) {
          NS.Sound.play(fd > 4 ? 'entity.player.big_fall' : 'entity.player.small_fall', { volume: 1, pitch: 1 });
          var fb = NS.World.getBlock(Math.floor(P.x), Math.floor(P.y - 0.2), Math.floor(P.z));
          if (fb !== 0) NS.Sound.blockFall(fb, P.x, P.y, P.z, P, 'player');
        }
        Sv.hurt(P, P.pendingFallSource || 'fall', fd); P.pendingFallDamage = 0; P.pendingFallSource = null;
      }
      Sv.tick(P);
      if (Sv.freezeWater) { Sv.freezeWater(P); Sv.frostTick(); }
      // ⚠ THERE WAS A CALL TO `NS.Hud.onDeath(P)` HERE AND NOTHING HAS EVER DEFINED IT (D-293).
      // It was guarded — `&& NS.Hud.onDeath` — so it never fired and never threw, and the death
      // screen works by a different route entirely: `H.drawSurvival` draws it inline from
      // `P.dead`, and `17_main.js` binds R to respawn. A hook nobody kept is a promise nobody
      // made, and leaving it in says a stage is owed when none is (D-139). Deleted.
    } else if (Sv) {
      // #541: creative/spectator still accumulate movement stats (increaseTravelMotionStats runs
      // regardless of gamemode); only exhaustion is skipped, by addExhaustion's invulnerable check.
      var cdx = P.x - P.px, cdz = P.z - P.pz;
      var cdist = Math.sqrt(cdx * cdx + cdz * cdz);
      if (P.inWater && (P.eyeInWater || P.sprinting)) { var cdy = P.y - P.py; cdist = Math.sqrt(cdist * cdist + cdy * cdy); }
      if (cdist > 0) {
        if (P.inWater) Sv.movement(P, cdist, { swimming: true });
        else if (P.onGround) Sv.movement(P, cdist, { climbing: !!(NS.Physics && NS.Physics.onClimbable && NS.Physics.onClimbable(P)), sprinting: !!P.sprinting, walking: true });
      }
      if (wasOnGround && !P.onGround && P.vy > 0) Sv.jumped(P, !!P.sprinting);
    }
  };

  /** Render-time position between the last two ticks. The camera and the raycast both use it. */
  P.interpolate = function (alpha) {
    if (alpha < 0) alpha = 0; else if (alpha > 1) alpha = 1;
    P.alpha = alpha;
    P.ex = P.px + (P.x - P.px) * alpha;
    P.ey = P.py + (P.y - P.py) * alpha;
    P.ez = P.pz + (P.z - P.pz) * alpha;
  };

  // ---------------------------------------------------------------------------
  // Targeting
  // ---------------------------------------------------------------------------

  var packKey = function (x, y, z) {
    return ((x & 0x3FFFFF) * 4194304 + (z & 0x3FFFFF)) * 512 + (y + 64);
  };

  /**
   * Re-run the crosshair raycast. Called once per frame, before break/place are resolved.
   * The direction is rebuilt from P.yaw/P.pitch rather than read off the camera: the camera is
   * only synced inside Gfx.render, which happens AFTER this, and targeting one frame late is
   * exactly the bug where a fast flick places a block on the wrong wall.
   */
  /**
   * ⚠⚠ **THE ONE LOOK VECTOR** (D-343). It was written out by hand in THREE places in this file
   * and `10_camera.js` — and one of them had the wrong SIGN. `retarget` and the entity pick
   * used `(sy*cp, +sp, -cy*cp)`, which agrees with `Cam.forward` and with the comment at the
   * top of `10_camera.js`: *"yaw 0 looks -Z, +yaw turns right, +pitch looks up"*. `dropHeld`
   * used `-sp`. So a player looking UP and pressing Q threw the item at the FLOOR, and looking
   * down threw it over their head. Nothing reported it, because a dropped item goes somewhere
   * either way and "somewhere" looks like physics.
   *
   * ⚠ It delegates to `Cam.forward` rather than repeating the formula a fourth time: the camera
   * is what actually decides which way the screen is pointing, so it owns the convention and
   * everything else asks it. A second copy is D-314, and this is what a second copy costs.
   */
  var lookCam = { yaw: 0, pitch: 0, fwd: [0, 0, 0] };
  P.lookVec = function (out) {
    lookCam.yaw = P.yaw; lookCam.pitch = P.pitch;
    var f = NS.Cam ? NS.Cam.forward(lookCam) : (function () {
      // 10_camera.js is main-only and this file is too, so the fallback is unreachable in the
      // game; it exists so a headless check that loads the player alone still gets the truth.
      var cp = Math.cos(P.pitch), sp = Math.sin(P.pitch);
      var cy = Math.cos(P.yaw), sy = Math.sin(P.yaw);
      lookCam.fwd[0] = sy * cp; lookCam.fwd[1] = sp; lookCam.fwd[2] = -cy * cp;
      return lookCam.fwd;
    })();
    if (out) { out[0] = f[0]; out[1] = f[1]; out[2] = f[2]; return out; }
    return f;
  };

  P.retarget = function () {
    var f = P.lookVec();
    var hit = NS.Ray.cast(P.ex, P.ey + (P.eyeHeight || P.EYE), P.ez,
                          f[0], f[1], f[2], P.reach, null);
    if (!hit) {
      P.hasTarget = false;
      P.breakTarget = -1; P.breakProgress = 0;
      return;
    }
    P.hasTarget = true;
    P.tx = hit.x; P.ty = hit.y; P.tz = hit.z; P.tface = hit.face; P.tid = hit.id;
    // the exact hit point: which HALF of the face you clicked decides a stair's `half` and a
    // slab's `type` (D-157), and the cell coordinates alone cannot say.
    P.thx = hit.hx; P.thy = hit.hy; P.thz = hit.hz;
    P.blockDist = hit.dist === undefined ? null : hit.dist;
  };

  /**
   * The entity under the crosshair, if one is nearer than the block (D-338).
   *
   * ⚠⚠ **THE ENTITY ONLY WINS WHEN IT IS CLOSER**, which is `GameRenderer.pick`'s whole job:
   * it casts the block ray and the entity ray from the same eye and keeps whichever is nearer.
   * Preferring the entity unconditionally makes it impossible to mine a block with a chicken
   * standing behind it; preferring the block makes it impossible to hit anything standing in a
   * doorway. ⚠ The block distance is taken from the raycast rather than recomputed from the cell
   * centre — a cell's centre can be further away than the face you actually hit.
   */
  P.retargetEntity = function () {
    var Cb = NS.Combat;
    P.targetEntity = null;
    if (!Cb || !NS.EntityList || !NS.EntityList.ready) return;
    var f = P.lookVec();
    var ox = P.ex, oy = P.ey + (P.eyeHeight || P.EYE), oz = P.ez;
    var r = Cb.pick(ox, oy, oz, f[0], f[1], f[2], P.reach);
    if (!r) return;
    if (P.hasTarget && P.blockDist !== null && r.t > P.blockDist) return;
    P.targetEntity = r.entity;
    P.targetEntityDist = r.t;
  };

  // ---------------------------------------------------------------------------
  // Break / place
  // ---------------------------------------------------------------------------

  /**
   * act(dt) — resolve mining and building for one rendered frame.
   *
   * Timing, so it reads right:
   *   creative  break is instant, with a 0.2 s repeat while the button is held (vanilla's 5 ticks)
   *   survival  progress accumulates at 1/hardness per second against ONE block; looking away
   *             resets it, exactly as vanilla does
   *   place     immediate on press, then 0.2 s repeat while held
   */
  P.act = function (dt) {
    var I = NS.Input;
    if (P.breakCooldown > 0) P.breakCooldown -= dt;
    if (P.placeCooldown > 0) P.placeCooldown -= dt;

    if (I.uiOpen || !I.locked) {
      // loop/bow -- a UI opening (or the pointer unlocking) mid-draw is not vanilla's own
      // `clearActiveItem`, but leaving `P.usingItem` true here would strand it forever (this
      // function's own early return skips the hold-tick branch below entirely) -- cancelled,
      // not fired, the same "PASS rather than a half consequence" rule `Use.bowRelease`'s own
      // early returns already follow.
      if (P.usingItem) { P.usingItem = false; P.handsBusy = false; P.useTicks = 0; }
      P.breakProgress = 0; P.breakTarget = -1; return;
    }

    // --- middle click: pick block ------------------------------------------
    if (I.mousePressed[1] && P.hasTarget) P.pick(P.tid);

    // ⚠⚠ **THE HAND SWINGS ON THE CLICK, NOT ON THE BREAK** (D-334). Dan, session 11: *"there is
    // no combat and no mid air punching without looking at anything"*. `Hand.swing` was complete
    // and vanilla-correct — six ticks, the halfway-restart rule, all of it behind `handcheck` —
    // and its only two callers were `breakBlock` and `placeBlock`, both of which fire when a
    // world EDIT succeeds. So a click at the sky did nothing, and in survival a click on stone did
    // nothing until the stone finally broke. **The model was finished and the input edge that
    // drives it was never written**, which is the same shape as D-330's slider: `handcheck` calls
    // `H.swing()` itself, so it would pass unchanged with the swing wired to nothing.
    //
    // ⚠ `missTime` IS VANILLA'S OWN RATE LIMIT. `Minecraft.startAttack` returns immediately while
    // it is positive and sets it to 10 on a miss, but only when `hasMissTime()` — which is false
    // in creative. Without it, holding the button at the sky restarts the swing every frame and
    // the arm never finishes a stroke.
    // ⚠ `MISS_TIME` IS A CONSTANT AND LIVES WITH THE OTHER FIELDS NOW (D-357), not here.
    if (P.missTime > 0) { P.missTime -= dt * 20; if (P.missTime < 0) P.missTime = 0; }
    P.retargetEntity();
    if (I.mousePressed[0] && P.missTime <= 0) {
      if (NS.Hand) NS.Hand.swing(P, 0);
      // ⚠ THE ATTACK COMES BEFORE THE MISS COOLDOWN AND BEFORE MINING (D-338), exactly as
      // `Minecraft.startAttack` switches on the hit result: ENTITY, then BLOCK, then MISS.
      if (P.targetEntity && NS.Gamemode && NS.Gamemode.isSpectator(P)) {
        P.spectate(P.targetEntity);          // spectators never hurt: the click picks the camera entity
      } else if (P.targetEntity && NS.Combat && P.mayAttack !== false) {
        P.lastAttack = NS.Combat.attack(P, P.targetEntity);
      } else if (P.hasTarget && P.mayBuild !== false && NS.Note && NS.Note.ready) {
        NS.Note.punch(P.tx, P.ty, P.tz);          // NoteBlock.onBlockBreakStart: a punch plays it
      } else if (!P.hasTarget) {
        // MinecraftClient.doAttack: a miss resets the charge in every gamemode
        if (NS.Hand) NS.Hand.resetAttackStrength();
        if (!P.instabuild) P.missTime = P.MISS_TIME;
      }
    }

    // ⚠ AND IT KEEPS SWINGING WHILE THE BLOCK IS BEING MINED, once per TICK, which is what
    // `Minecraft.continueAttack` does every tick `continueDestroyBlock` returns true. A frame is
    // not a tick, so the attack is stepped on its own 20 Hz accumulator; swinging per FRAME would
    // restart the stroke three times as often at 180 fps as at 60 and look like a different game.
    P.attackTicks = (P.attackTicks || 0) + dt * 20;
    var attackTicksNow = 0;
    while (P.attackTicks >= 1) { P.attackTicks -= 1; attackTicksNow++; }
    if (attackTicksNow > 8) attackTicksNow = 8;          // a long frame does not bank swings

    // --- left: break --------------------------------------------------------
    // ⚠ AN ENTITY UNDER THE CROSSHAIR SUSPENDS MINING. Holding the button while a mob walks in
    // front of the block you are breaking must not keep breaking it through the mob.
    if (I.mouse[0] && P.hasTarget && P.missTime <= 0 && !P.targetEntity) {
      var key = packKey(P.tx, P.ty, P.tz);
      if (key !== P.breakTarget) { P.breakTarget = key; P.breakProgress = 0; P.hitSoundTick = 0; }
      // ⚠ PLAN G3 OWNS THIS NUMBER NOW. It used to be `States.hard[tid]` — the bare-handed
      // seconds `Reg.breakSeconds` derives — which is right for an empty hand and knows nothing
      // about a tool, an enchantment, standing in water or being in the air. `Mining.progress`
      // is vanilla's whole formula, and it answers the same thing for an empty hand, so this is
      // a strict widening rather than a change of behaviour (D-203).
      if (P.instabuild) {
        if (P.breakCooldown <= 0) { P.breakBlock(); P.breakCooldown = 0.2; }
      } else {
        var per = (NS.Mining && NS.Mining.ready)
          ? NS.Mining.progress(P.tid, P.miningContext())
          : (isFinite(NS.States.hard[P.tid]) ? (NS.States.hard[P.tid] <= 0 ? 1 : 1 / (NS.States.hard[P.tid] * 20)) : 0);
        if (!(per > 0)) {
          P.breakProgress = 0;                                // bedrock and friends
        } else {
          // `per` is progress per TICK; `dt` is a frame, so the frame is worth `dt * 20` ticks
          P.breakProgress += per * dt * 20;
          // ⚠ ONE SWING PER TICK OF REAL PROGRESS, which is `continueDestroyBlock` returning true
          for (var sw = 0; sw < attackTicksNow; sw++) if (NS.Hand) NS.Hand.swing(P, 0);
          // #370: `updateBlockBreakingProgress` plays the group's hit sound when the cooldown is a
          // multiple of 4, counting every tick — so ticks 0, 4, 8 of a mining stroke.
          for (var ht = 0; ht < attackTicksNow; ht++) {
            if ((P.hitSoundTick | 0) % 4 === 0 && NS.Sound) NS.Sound.blockHit(P.tid, P.tx + 0.5, P.ty + 0.5, P.tz + 0.5, P);
            P.hitSoundTick = (P.hitSoundTick | 0) + 1;
          }
          // D-659: `MinecraftClient.handleBlockBreaking` (MinecraftClient.java:1471-1473) — on
          // every tick `updateBlockBreakingProgress` returns true, ONE `addBlockBreakingParticles`
          // then the swing. The tick that finishes the block reads it back as air (no particle),
          // so a frame that completes the break owes one fewer.
          var hits = P.breakProgress >= 1 ? attackTicksNow - 1 : attackTicksNow;
          for (var hp = 0; hp < hits; hp++) P.spawnHitParticle();
          if (P.breakProgress >= 1) { P.breakBlock(); P.breakProgress = 0; P.breakCooldown = 0.05; }
        }
      }
      // G10: the overlay follows the progress, and the little particles come off the face on a
      // declared cadence (D-272). Both are told the PACKED KEY, so moving to another block of the
      // same hardness still restarts the overlay.
      if (NS.Hand) NS.Hand.tickBreaking(P.breakTarget, P.breakProgress);
    } else {
      // cancelBlockBreaking: letting go of a HALF-mined block resets the charge
      if (P.breakProgress > 0 && NS.Hand) NS.Hand.resetAttackStrength();
      P.breakProgress = 0;
      P.breakTarget = -1;
      P.hitSoundTick = 0;
      if (NS.Hand) NS.Hand.stopBreaking();
    }

    // --- right: USE, and placing is only its last case (D-361) --------------
    // ⚠⚠ **THIS BRANCH USED TO BE `P.placeBlock()` AND NOTHING ELSE**, which is why no block in
    // this game had a right-click behaviour: a door could be placed and never opened, and the
    // four redstone stages G15 shipped had no switch a hand could throw. `Use.rightClick` is
    // vanilla's own order — the block's `use`, then the item's `useOn`, and placement last.
    // loop/bow -- WHILE A HOLD-USE IS ACTIVE, the button is no longer polled through
    // `Use.rightClick`'s own 0.2 s click-repeat (right above): a repeat would call
    // `Use.bowStart` again every 0.2 s and the draw could never reach `getPullProgress`'s
    // 20-tick ramp. This is `LivingEntity.tick`'s own `if (this.isUsingItem())` branch --
    // tick the hold while the button stays down, release (`Use.bowRelease`, vanilla's
    // `onStoppedUsing`) the instant it is not.
    if (P.usingItem) {
      if (I.mouse[2]) {
        if (P.useKind && NS.Use) {   // shield / G19d-d drink-stew holds keep their own countdown
          P.useTicks += dt * 20;
          var maxTicks = (NS.Use && NS.Use.BOW_MAX_USE_TICKS) || 72000;
          if (P.useTicks > maxTicks) P.useTicks = maxTicks;
          if (P.useKind === 'drink') {
            var dm = NS.Use.drinkMaxTicks(P);
            if (dm >= 0 && NS.Use.consumeTick) NS.Use.consumeTick(P);
            if (dm < 0) NS.Use.drinkCancel(P); else if (P.useTicks >= dm) { NS.Use.drinkFinish(P); P.placeCooldown = 0.2; }
          }
        } else if (NS.Use && NS.Use.holdAdvance) NS.Use.holdAdvance(P, dt);
      } else if (P.useKind && NS.Use && NS.Use.bowRelease) {
        NS.Use.bowRelease(P);
      } else if (NS.Use && NS.Use.holdStop) {
        NS.Use.holdStop(P);
      } else {
        P.usingItem = false; P.handsBusy = false;
      }
    } else if (I.mouse[2]) {
      if (I.mousePressed[2]) P.placeCooldown = 0;
      if (P.placeCooldown <= 0) {
        var did = NS.Use && NS.Use.ready ? NS.Use.rightClick(P) : (P.placeBlock() ? 'place' : false);
        if (did) {
          P.placeCooldown = 0.2;
          // ⚠ THE HAND SWINGS ON A SUCCESS AND NOT ON A PASS, which is vanilla's rule and the
          // reason clicking at the sky with a block in hand does nothing: `placeBlock` already
          // swings for its own case, so this covers the two that are new.
          if (did !== 'place' && NS.Hand) NS.Hand.swing(P, 0);
          if (did === 'use' && NS.Hand && NS.Hand.resetEquipProgress) NS.Hand.resetEquipProgress();   // interactItem accepted
        }
      }
    }
  };

  /**
   * The context PLAN G3's break formula wants.
   *
   * ⚠ `item` IS A NAME, AND IT IS DERIVED FROM THE REAL HELD STACK (D-275). It used to be a
   * placeholder string `P.heldItem = ''`, written when the hotbar carried block states and there
   * was no inventory to hold an item in. G11 gave the player a real one and defined
   * `P.heldItem()` as a FUNCTION returning the stack — 280 lines further down the same file, so
   * it silently won, and this line then handed `Mining.itemSpeed` and `Mining.canHarvest` a
   * function object instead of a name. Both take a miss quietly: every pickaxe mined at
   * bare-hand speed and harvested nothing (D-276). The placeholder is deleted (D-139) and the name comes
   * from the stack, which is the only thing that can be right once both exist.
   */
  P.heldItemName = function () {
    var st = P.heldItem(), IT = NS.Items;
    if (!st || !IT || st.i === undefined || st.i < 0) return '';
    return IT.nameOf(st.i) || '';
  };
  /**
   * One tick of the footstep counter. ⚠ THE SOUND IS THE BLOCK BELOW YOU, not the one you are in,
   * and vanilla asks the block at `floor(y - 0.2)` — which is why standing on a slab gives you
   * the slab's footstep and not the air's.
   */
  P.moveDist = 0;
  P.nextStep = 1;
  P.stepAge = 0;
  P.lastChimeAge = 0;
  P.lastChimeIntensity = 1;
  var stepCols = null;
  function stepTags() {
    var T = NS.Tags, R = NS.Reg;
    if (stepCols && stepCols.ready === T.ready) return stepCols;
    stepCols = {
      ready: T.ready,
      fences: T.blockTag('fences'), walls: T.blockTag('walls'), gates: T.blockTag('fence_gates'),
      inside: T.blockTag('inside_step_sound_blocks'), crystal: T.blockTag('crystal_sound_blocks'),
      water: R.id.water, lava: R.id.lava, bubble: R.id.bubble_column
    };
    return stepCols;
  }
  /**
   * ⚠ WHAT VANILLA'S `Entity.move` DOES WITH THE STEP, NOT JUST "PLAY THE BLOCK BELOW" (#372).
   * `getLandingPos` falls back to the block under an AIR one when that is a fence, wall or gate (so a
   * fence top plays wood); `playStepSound` is silent on a liquid (a lily pad sits over water) and
   * uses the block ABOVE when it is in `#inside_step_sound_blocks` (snow layer); a player touching
   * water plays `entity.player.swim` instead; `#crystal_sound_blocks` chimes first. All of it is on
   * the PLAYERS source, since `PlayerEntity.getSoundCategory` is PLAYERS.
   */
  P.tickFootsteps = function () {
    var S = NS.Sound;
    P.stepAge++;
    if (!S || !S.ready || P.mode === 3) { return false; }
    // ⚠ THE DISTANCE IS ACCUMULATED IN `P.tick`, NOT HERE (D-362) — vanilla does it in
    // `Entity.move`, for every entity, on the ground or not.
    // ⚠⚠ **AND THE THRESHOLD IS `(int)moveDist + 1`, NOT `moveDist + 1`.** `Entity.nextStep()`
    // is `f2i; iconst_1; iadd` in the bytecode — an INTEGER truncation, so the overshoot is
    // DISCARDED and the steps land on whole units. This engine carried the overshoot forward,
    // which drifts the cadence against the walk; `soundcheck` had reasoned its way to the wrong
    // one of the two and written the reasoning down, which is how it stayed.
    // ⚠ The comparison is STRICTLY GREATER (`fcmpl; ifle`), not `>=`.
    if (!(P.moveDist > P.nextStep)) return false;
    P.nextStep = (P.moveDist | 0) + 1;
    // ⚠ `PlayerEntity.getMoveEffect`: flying, or sneaking on the ground, is events only — NO sound.
    if (P.flying || (P.onGround && P.crouching)) return false;
    var W = NS.World, SR = NS.States, T = NS.Tags, C = stepTags();
    var bx = Math.floor(P.x), by = Math.floor(P.y - 0.2), bz = Math.floor(P.z);
    var below = W.getBlock(bx, by, bz);
    if (!below) {
      var lower = W.getBlock(bx, by - 1, bz);
      if (lower) {
        var lb = SR.block[lower];
        if (T.blockInCol(C.fences, lb) || T.blockInCol(C.walls, lb) || T.blockInCol(C.gates, lb)) {
          below = lower; by--;
        }
      }
    }
    if (!below) return false;
    if (P.inWater) {
      var vx = P.vx || 0, vy = P.vy || 0, vz = P.vz || 0;
      var vol = Math.min(1, Math.sqrt(vx * vx * 0.2 + vy * vy + vz * vz * 0.2) * 0.35);
      return S.play('entity.player.swim', { volume: vol, pitch: 1 + (Math.random() - Math.random()) * 0.4,
        x: P.x, y: P.y, z: P.z, source: 'player', listener: P });
    }
    var b = SR.block[below];
    if (T.blockInCol(C.crystal, b) && P.stepAge >= P.lastChimeAge + 20) {
      P.lastChimeIntensity = Math.min(1, P.lastChimeIntensity * Math.pow(0.997, P.stepAge - P.lastChimeAge) + 0.07);
      S.play('block.amethyst_block.chime', { volume: 0.1 + P.lastChimeIntensity * 1.2,
        pitch: 0.5 + P.lastChimeIntensity * Math.random() * 1.2, x: P.x, y: P.y, z: P.z, source: 'player', listener: P });
      P.lastChimeAge = P.stepAge;
    }
    if (b === C.water || b === C.lava || b === C.bubble) return false;
    var above = W.getBlock(bx, by + 1, bz), use = below;
    if (above && T.blockInCol(C.inside, SR.block[above])) use = above;
    return S.blockStep(use, P.x, P.y, P.z, P, 'player');
  };

  /**
   * #296 — `PlayerEntity.getBlockBreakingSpeed`'s effect half, read off the effect store into the
   * 1-based levels `M.playerSpeed` (07d_mining.js) takes. Haste is `StatusEffectUtil.hasHaste` /
   * `getHasteAmplifier` — haste OR conduit power, the larger amplifier (never below 0, the
   * util's own zero-initialised max). Mining fatigue is the jar's `switch` on its amplifier:
   * 0/1/2 are levels 1-3 and EVERY other amplifier is the `default -> 8.1E-4F` arm, level 4.
   */
  P.syncMiningEffects = function () {
    var ES = NS.Effects;
    P.haste = ES && ES.hasHaste(P) ? ES.getHasteAmplifier(P) + 1 : 0;
    var fa = ES && ES.hasStatusEffect(P, 'mining_fatigue') ? P.effects.mining_fatigue.amplifier : null;
    P.fatigue = fa === null ? 0 : (fa >= 0 && fa <= 2 ? fa + 1 : 4);
  };

  /**
   * ⚠ `eyeInWater`, NOT `eyesInWater` (D-290). This read was the second spelling of a field
   * `14b_physics.js` has always written correctly, so `inWater` was `undefined` on every call and
   * **the underwater mining penalty — vanilla's divide-by-five — has never once applied**. There
   * is no error for reading a property nobody defines; the value is just quietly `undefined`, and
   * `!!undefined` is a perfectly good `false`. `15_hud.js` had the same typo 400 lines away from
   * a correct use of the same field.
   */
  P.miningContext = function () {
    P.syncMiningEffects();
    var held = P.heldItem(), Cb = NS.Combat, lv = function (id) { return Cb && Cb.enchantLevel ? Cb.enchantLevel(held, id) : 0; };
    return {
      item: P.heldItemName(),
      silkTouch: lv('silk_touch'), fortune: lv('fortune'),
      efficiency: lv('efficiency'), haste: P.haste | 0, fatigue: P.fatigue | 0,
      inWater: !!P.eyeInWater, aquaAffinity: !!P.aquaAffinity,
      onGround: P.onGround !== false,
    };
  };

  /**
   * What the last break produced, as `[{item, count}]` from the real 1.18.2 loot table (PLAN G3).
   * ⚠ IT GOES NOWHERE YET, AND THAT IS G8. There is no inventory to put an item stack into, so
   * the drops are computed, recorded and handed to `P.onDrops` if something has set it. Computing
   * them here rather than in the inventory later keeps the ONE break path honest: a block that
   * cannot be harvested drops nothing, and that rule is already live.
   */
  P.lastDrops = [];
  P.onDrops = null;
  P.breakBlock = function () {
    if (!P.hasTarget) return false;
    if (NS.Gamemode && !NS.Gamemode.mayBreak(P)) return false;
    if (!NS.World.canPlayerModifyAt(P.tx, P.tz)) return false;   // ServerWorld.canPlayerModifyAt
    // Item.canMine: a sword refuses to break blocks in creative
    var heldSt = P.heldItem(), heldName = P.heldItemName();
    if (P.instabuild && NS.Hand && NS.Hand.isSword && NS.Hand.isSword(heldSt)) return false;
    var id = NS.World.getBlock(P.tx, P.ty, P.tz);
    if (id === 0 || !isFinite(NS.States.hard[id])) return false;
    var drops = (NS.Loot && NS.Loot.ready && !P.instabuild)
      ? NS.Loot.breakDrops(id, P.miningContext()) : [];
    // #896: a banner's Patterns live on its block entity, which `setBlock(0)` destroys -- read them first
    // and hand them back on the dropped stack as `BlockEntityTag` (`BannerBlockEntity.getPickStack`/copy_nbt).
    var bannerTag = P.bannerTagAt(P.tx, P.ty, P.tz);
    var hiveBE = NS.Bee && NS.BlockEntities && NS.BlockEntities.get(P.tx, P.ty, P.tz);   // #3021: read before setBlock(0) drops it
    if (!NS.World.setBlock(P.tx, P.ty, P.tz, 0)) return false;
    if (NS.GameEvent) NS.GameEvent.emit('block_destroy', P.tx, P.ty, P.tz, P);   // World.breakBlock -> BLOCK_DESTROY
    // ItemStack.postMine: tools/shears 1 wear, swords 2, only when hardness != 0 (not in creative: Use.damage)
    if (NS.Use && NS.Use.damage && NS.States.hard[id] !== 0) {
      var wear = /(^|_)sword$/.test(heldName) ? 2 : /(_pickaxe|_axe|_shovel|_hoe)$/.test(heldName) ? 1 : 0;
      if (wear) NS.Use.damage(P, heldSt, wear);
    }
    // ShearsItem.postMine: 1 wear whatever the hardness (grass, tripwire, leaves), except a block in #fire
    if (NS.Use && NS.Use.damage && heldName === 'shears' && NS.Reg.names[NS.States.block[id]] !== 'fire' && NS.Reg.names[NS.States.block[id]] !== 'soul_fire') NS.Use.damage(P, heldSt, 1);
    if (hiveBE && hiveBE.type === 'beehive') NS.Bee.onHiveBreak(P.tx, P.ty, P.tz, P, hiveBE, !!(P.miningContext() || {}).silkTouch);
    if (hiveBE && hiveBE.type === 'beehive' && NS.Adv && NS.Adv.trigger) {   // BeehiveBlock.afterBreak -> BEE_NEST_DESTROYED (after the bees poured out)
      var en = {}, el = NS.Combat && NS.Combat.enchantList ? NS.Combat.enchantList(heldSt) : [];
      for (var ei = 0; ei < el.length; ei++) en[el[ei].id] = el[ei].lvl;
      var hs = heldSt && heldSt.i ? { id: 'minecraft:' + NS.Items.nameOf(heldSt.i | 0), count: heldSt.n | 0, damage: heldSt.d || 0, nbt: heldSt.t, enchants: en } : null;
      NS.Adv.trigger(P, 'minecraft:bee_nest_destroyed', { player: P, block: 'minecraft:' + NS.States.name(id), stack: hs, bees: hiveBE.bees ? hiveBE.bees.length : 0 });
    }
    if (bannerTag) for (var bd = 0; bd < drops.length; bd++) if (/_banner$/.test(drops[bd].item)) drops[bd].tag = bannerTag;
    // s135 (KW-32 follow-up) -- `Block.onBreak`'s own guarded-block branch: mining a
    // `guarded_by_piglins` block angers every idle piglin within 16, no line-of-sight
    // required (`PiglinBrain.onGuardedBlockInteracted(player, false)`, .decomp
    // Block.java:416-421, src/07zzf_piglin.js owns the actual reaction).
    if (NS.Piglin && NS.Piglin.ready && NS.Tags && NS.Tags.ready && NS.Tags.stateIn('guarded_by_piglins', id)) {
      NS.Piglin.onGuardedBlockInteracted(P, false);
    }
    // loop/silverfish -- `InfestedBlock.onStacksDropped` (.decomp/net/minecraft/block/
    // InfestedBlock.java:45-51): a SURVIVAL break (`!P.instabuild`, the same guard the loot
    // roll two lines up already uses) of an infested_stone/infested_cobblestone/
    // infested_deepslate block spawns a silverfish, gated on `doTileDrops` and Silk Touch
    // (`NS.Silverfish.onBreak`'s own header names the one real gap: this engine's mining
    // context has no enchant field yet, so the Silk Touch half is always "no" today).
    if (!P.instabuild && NS.Silverfish) {
      var brokenName = NS.States.name(id);
      if (NS.Silverfish.isInfested(brokenName)) {
        var mctx = P.miningContext();
        NS.Silverfish.onBreak(P.tx, P.ty, P.tz, !!(mctx && mctx.silkTouch));
      }
    }
    // PLAN G18f unit 2 (D-479) -- breaking a claimed workstation frees the SLOT (see
    // Prof.releaseAt's own header for what this does NOT do).
    if (NS.Profession && NS.Profession.ready) NS.Profession.releaseAt(P.tx, P.ty, P.tz);
    if (NS.Save && NS.Save.record) NS.Save.record(P.tx, P.ty, P.tz, 0);
    // G5: breaking a block costs 0.005 exhaustion — the smallest charge in the game, and the
    // reason a long mining session still eats
    if (NS.Survival && !P.invulnerableGamemode) NS.Survival.mined(P);
    P.lastDrops = drops;
    if (drops.length) P.collectDrops(drops, P.tx, P.ty, P.tz);     // D-333: as item ENTITIES
    if (P.onDrops && drops.length) P.onDrops(drops, P.tx, P.ty, P.tz);
    // D-659: WorldRenderer.processWorldEvent(2001) -> `ParticleManager.addBlockBreakParticles`
    // (WorldRenderer.java:2956-2963), over the SAME outline boxes the selection draws.
    // #1893 `World.breakBlock` (World.java:258) skips event 2001 for an AbstractFireBlock, and
    // `AbstractFireBlock.onBreak` (:160-163) sends 1009 instead: the extinguish hiss, no debris.
    var fireName = NS.States.name(id), isFire = fireName === 'fire' || fireName === 'soul_fire';
    if (!isFire && NS.Particle) NS.Particle.addBlockBreakParticles(P.tx, P.ty, P.tz, id,
      NS.Ray && NS.Ray.selectionBoxes ? NS.Ray.selectionBoxes(id, P.tx, P.ty, P.tz) : null);
    // PLAN G13 — the block's own break sound, at vanilla's 0.8 volume with its pitch jitter
    // (D-285). The state is read BEFORE the cell was cleared, which is why `id` is used here and
    // not a fresh `getBlock`: the block that made the noise is the one that just stopped existing.
    if (NS.Turtle && NS.Turtle.eggAfterBreak && !P.instabuild) NS.Turtle.eggAfterBreak(P.tx, P.ty, P.tz, id);   // #1253 afterBreak -> breakEgg
    if (isFire) {
      if (NS.Sound && NS.Sound.entitySound) NS.Sound.entitySound('block.fire.extinguish', P.tx + 0.5, P.ty + 0.5, P.tz + 0.5, 0.5, 2.6 + (NS.wrand() - NS.wrand()) * 0.8, 'block', P);   // WorldRenderer 1009 data 0
    } else if (NS.Sound) NS.Sound.blockBreak(id, P.tx + 0.5, P.ty + 0.5, P.tz + 0.5, P);
    // G10: a completed break swings the hand. It does NOT reset the attack charge (#396):
    // `updateBlockBreakingProgress` clears `breakingBlock` first, so `cancelBlockBreaking` is a no-op.
    if (NS.Hand) { NS.Hand.swing(P, 0); NS.Hand.stopBreaking(); }
    P.retarget();
    return true;
  };

  /** D-659: one `addBlockBreakingParticles` on the targeted face (`NS.Particle`). */
  P.spawnHitParticle = function () {
    var Px = NS.Particle, C = CFG;
    if (!Px || !P.hasTarget) return null;
    return Px.addBlockBreakingParticles(P.tx, P.ty, P.tz, P.tid,
      C.FACE_DX[P.tface] || 0, C.FACE_DY[P.tface] || 0, C.FACE_DZ[P.tface] || 0,
      NS.Ray && NS.Ray.selectionBoxes ? NS.Ray.selectionBoxes(P.tid, P.tx, P.ty, P.tz) : null);
  };

  /**
   * placementState(id, face, hx, hy, hz, yaw, pitch) -> the real state to actually place (D-157).
   *
   * A block id is a REAL STATE, so "place a torch" has to choose WHICH torch. Vanilla does this
   * in each block's `getStateForPlacement`; the rules below are the four that cover the roster
   * this game can place, expressed once over `States.withProp` rather than per block:
   *
   *   axis    — a log lies along the axis of the face you clicked.
   *   half    — a stair is upside down when you click a ceiling, or the top half of a side.
   *   type    — a slab fills the half of the cell you clicked toward. (Vanilla also MERGES two
   *             slabs into a double; that needs the target cell's own state and is G2's, so a
   *             slab placed against a slab is still two cells here. Stated, not hidden.)
   *   facing  — a wall-mounted block faces AWAY from the wall it is on; everything else faces
   *             the player, which is `getHorizontalDirection().getOpposite()`.
   *
   * and one block swap: vanilla's `StandingAndWallBlockItem` is ONE item over TWO blocks, so a
   * torch clicked onto a side becomes `wall_torch`, a sign becomes a wall sign. Before D-157
   * this did not happen at all — the standing state went onto the wall, and once D-155 started
   * enforcing support it was refused outright and nothing appeared. That is the bug Dan reported.
   *
   * `face` is the clicked surface's OUTWARD normal (the CFG face order), `hx/hy/hz` the hit point
   * in world coordinates, `yaw` the player's. Pure: no world reads, so `gamecheck` can drive it.
   */
  var FACE_DIR = ['east', 'west', 'up', 'down', 'south', 'north'];
  var FACE_AXIS = ['x', 'x', 'y', 'y', 'z', 'z'];
  // ⚠ The Java-side list, same idiom as 02c_states.js's TRANSLUCENT and ANIMATED: blocks whose
  // `facing` follows the CLICKED FACE rather than the player, and which are not standing/wall
  // pairs so nothing else identifies them. A ladder faces out of the wall it hangs on; placing
  // it facing the player puts its rungs into the stone.
  var FACE_FOLLOWS_CLICK = ['ladder', 'tripwire_hook'];

  // ⚠ AND THE OTHER JAVA-SIDE LIST: blocks whose `facing` is the player's look direction rather
  // than its OPPOSITE (D-176). Most placeable furniture faces the player — a furnace, a chest —
  // and that is the default. A STAIR does not: its raised step is on the side the block faces,
  // measured directly from the collision shape (`facing=east` puts the tall box at x 0.5..1.0),
  // so a stair placed by a player walking east must face EAST or the step lands on their side
  // and they walk into a wall instead of up it. Doors and beds are the same shape of rule.
  // Vanilla spells this as `StairBlock.getStateForPlacement` using `getHorizontalDirection()`
  // where `HorizontalDirectionalBlock` uses `.getOpposite()`; the suffixes are derivable, so it
  // is a rule rather than a roster.
  var LOOK_SUFFIX = ['_stairs', '_door', '_bed'];
  function facesTheLook(name) {
    for (var i = 0; i < LOOK_SUFFIX.length; i++) {
      var sfx = LOOK_SUFFIX[i];
      if (name.length > sfx.length && name.lastIndexOf(sfx) === name.length - sfx.length) return true;
    }
    return false;
  }

  var OPP = { north: 'south', south: 'north', east: 'west', west: 'east', up: 'down', down: 'up' };
  var CW = { north: 'east', east: 'south', south: 'west', west: 'north' };
  /** `ItemPlacementContext.getPlayerFacing()`: the horizontal direction of the yaw (engine yaw 0 = -Z north, +PI/2 = +X east). */
  function playerFacing(yaw) { return ['north', 'east', 'south', 'west'][Math.round(yaw / (Math.PI / 2)) & 3]; }
  /** `getPlayerLookDirection()` = `Direction.getEntityFacingOrder(player)[0]`: the look vector's largest component. */
  function lookDirection(yaw) {
    var cp = Math.cos(P.pitch), f = [Math.sin(yaw) * cp, Math.sin(P.pitch), -Math.cos(yaw) * cp];
    var ax = Math.abs(f[0]), ay = Math.abs(f[1]), az = Math.abs(f[2]);
    if (ay > ax && ay > az) return f[1] > 0 ? 'up' : 'down';
    if (ax > az) return f[0] > 0 ? 'east' : 'west';
    return f[2] > 0 ? 'south' : 'north';
  }
  /**
   * One tools/golden/place-facing-1.18.2.tsv rule applied to `st` (see tools/extract-placement.mjs's header for each
   * token's vanilla body). Returns -1 when the rule has nothing to say for this click (the caller's default then runs).
   */
  function placeRule(rule, st, face, yaw) {
    var SR = NS.States, R = NS.Reg, P_ = R.PROP, V = R.PVAL;
    var side = FACE_DIR[face], vertical = (face === 2 || face === 3);
    var dir;
    switch (rule) {
      case 'look': dir = playerFacing(yaw); break;
      case 'away': dir = OPP[playerFacing(yaw)]; break;
      case 'cw': dir = CW[playerFacing(yaw)]; break;
      case 'look6': dir = lookDirection(yaw); break;
      case 'away6': dir = OPP[lookDirection(yaw)]; break;
      case 'floorlook': if (!vertical) return -1; dir = playerFacing(yaw); break;
      case 'side': dir = side; break;
      case 'hopper': dir = vertical ? 'down' : OPP[side]; break;
      case 'endrod': {
        // EndRodBlock: against a rod that already points this way, the new one points back at it
        var W = NS.World, behind = W && P.hasTarget ? W.getBlock(P.tx, P.ty, P.tz) : 0;
        dir = (behind > 0 && SR.block[behind] === SR.block[st] && SR.propValue(behind, P_.facing) === V[side]) ? OPP[side] : side;
        break;
      }
      case 'rot180': case 'rot0': {
        // vanilla yaw (0 = south, 90 = west) is the engine's yaw + 180 degrees
        var vy = yaw * 180 / Math.PI + 180 + (rule === 'rot180' ? 180 : 0);
        var r = Math.floor(vy * 16 / 360 + 0.5) & 15;
        var rv = V[String(r)];
        return rv === undefined ? -1 : SR.withProp(st, P_.rotation, rv);
      }
      case 'rail': {
        var f = playerFacing(yaw);
        var shape = (f === 'east' || f === 'west') ? V.east_west : V.north_south;
        return shape === undefined ? -1 : SR.withProp(st, P_.shape, shape);
      }
      case 'vine': {
        // VineBlock: the first placement direction is toward the clicked block; DOWN never takes a vine side
        var toward = OPP[side];
        if (toward === 'down' || P_[toward] === undefined || V['true'] === undefined) return -1;
        return SR.withProp(st, P_[toward], V['true']);
      }
      default: return -1;
    }
    return V[dir] === undefined ? -1 : SR.withProp(st, P_.facing, V[dir]);
  }

  P.placementState = function (id, face, hx, hy, hz, yaw) {
    var SR = NS.States, R = NS.Reg;
    if (!SR || !R || !R.PROP || id <= 0) return id;
    var P_ = R.PROP, V = R.PVAL;
    var st = id;
    var side = (face !== 2 && face !== 3);

    // 1. the standing/wall swap, first, because it changes which block the rest applies to
    if (side) {
      var wall = SR.wallVariant(st);
      if (wall) st = SR.withProp(wall, P_.facing, V[FACE_DIR[face]]);
    }

    // 2. axis — a pillar lies along the clicked face's axis
    st = SR.withProp(st, P_.axis, V[FACE_AXIS[face]]);

    // 3. half and type — which half of the cell the click pointed at. A ceiling click is always
    //    the top half, a floor click always the bottom, a side click goes by where on it you hit.
    var upper = face === 3 ? 1 : face === 2 ? 0 : ((hy - Math.floor(hy)) > 0.5 ? 1 : 0);
    st = SR.withProp(st, P_.half, upper ? V.top : V.bottom);
    st = SR.withProp(st, P_.type, upper ? V.top : V.bottom);

    // 4. face — a button or lever mounts on the floor, the wall or the ceiling
    st = SR.withProp(st, P_.face, face === 2 ? V.floor : face === 3 ? V.ceiling : V.wall);

    // 5. facing — the clicked face for a wall-mounted block, otherwise toward the player.
    //    ⚠ `yaw` here is the engine's: 0 looks toward -Z (north), growing toward +X. The block
    //    must face the player, so it takes the OPPOSITE of the direction they are looking.
    var nm = R.names[SR.block[st]];
    // 5a. the block's OWN getPlacementState rule, read off .decomp by tools/extract-placement.mjs (D-773: ported, never a
    //     hand list). A block with no row, and floorlook's side clicks, fall through to the older default below.
    var rule = NS.DATA && NS.DATA.placeFacing ? NS.DATA.placeFacing[nm] : undefined;
    if (rule) {
      var ruled = placeRule(rule, st, face, yaw);
      if (ruled >= 0) return ruled;
    }

    var followsClick = false;
    for (var i = 0; i < FACE_FOLLOWS_CLICK.length; i++) if (nm === FACE_FOLLOWS_CLICK[i]) followsClick = true;
    if (followsClick && side) {
      st = SR.withProp(st, P_.facing, V[FACE_DIR[face]]);
    } else if (!side || SR.wallVariant(id) === 0) {
      var look = Math.round(yaw / (Math.PI / 2)) & 3;             // 0 -Z, 1 +X, 2 +Z, 3 -X
      var toward = ['north', 'east', 'south', 'west'][look];      // the way the player is looking
      var away = ['south', 'west', 'north', 'east'][look];        // and its opposite
      st = SR.withProp(st, P_.facing, V[facesTheLook(nm) ? toward : away]);
    }
    return st;
  };

  // ── two-cell blocks (D-332) ───────────────────────────────────────────────────────────────
  // ⚠⚠ **A DOOR IS TWO BLOCKS AND SO IS A BED.** D-331 made 223 more items placeable, and 33 of
  // them do not fit in one cell: eight doors and nine tall plants carry `half=upper/lower`, and
  // sixteen beds carry `part=head/foot`. Placing only the half the player clicked gives a door
  // with no top and a bed with no pillow — **a feature that half works is the one thing Dan
  // asked for none of.** The set is derived from the STATE DATA, not from a list of names: a
  // block is two-cell if its default state carries `half=lower` or `part=foot`, which is exactly
  // what vanilla's `DoubleBlockHalf` and `BedPart` mean.

  /** north -Z · south +Z · east +X · west -X, by the registry's own value ids. */
  function dirStep(V, v) {
    if (v === V.north) return [0, -1];
    if (v === V.south) return [0, 1];
    if (v === V.east)  return [1, 0];
    if (v === V.west)  return [-1, 0];
    return null;
  }
  /** Direction.getCounterClockWise() / getClockWise(), about Y, as vanilla defines them. */
  function turnCCW(V, v) {
    return v === V.north ? V.west : v === V.west ? V.south : v === V.south ? V.east :
           v === V.east ? V.north : v;
  }
  function turnCW(V, v) {
    return v === V.north ? V.east : v === V.east ? V.south : v === V.south ? V.west :
           v === V.west ? V.north : v;
  }
  P.dirStep = dirStep; P.turnCCW = turnCCW; P.turnCW = turnCW;

  /**
   * secondCell(st, bx, by, bz) -> { st, x, y, z } or null — the OTHER cell this block occupies.
   * ⚠ The upper half and the head carry the SAME other properties (facing, hinge, open, powered,
   * occupied); vanilla copies the state and changes only the one that says which end it is.
   */
  P.secondCell = function (st, bx, by, bz) {
    var SR = NS.States, R = NS.Reg;
    if (!SR || !R || !R.PROP) return null;
    var P_ = R.PROP, V = R.PVAL;
    if (SR.propValue(st, P_.half) === V.lower) {
      return { st: SR.withProp(st, P_.half, V.upper), x: bx, y: by + 1, z: bz };
    }
    if (SR.propValue(st, P_.part) === V.foot) {
      var step = dirStep(V, SR.propValue(st, P_.facing));
      if (!step) return null;
      return { st: SR.withProp(st, P_.part, V.head), x: bx + step[0], y: by, z: bz + step[1] };
    }
    return null;
  };

  /**
   * doorHinge(...) -> V.left or V.right, transcribed from `DoorBlock.getHinge`.
   *
   * ⚠ IT IS A VOTE, NOT A SIDE. Vanilla counts full collision blocks on both sides of the door at
   * both heights — counter-clockwise ones as -1, clockwise ones as +1 — and only when that comes
   * out level does it fall back to which half of the block face you clicked. That is why a door
   * placed against a wall opens away from it without the player thinking about it, and why two
   * doors placed side by side make a double door.
   * ⚠ PURE, so `placecheck` can walk every combination without a world. `full*` are
   * `States.fullCollision` of the four neighbours; `door*` say whether that neighbour is the
   * LOWER half of the same door block.
   */
  P.doorHinge = function (V, facing, fullCcwLo, fullCcwHi, fullCwLo, fullCwHi,
                          doorCcw, doorCw, hx, hz) {
    var i = (fullCcwLo ? -1 : 0) + (fullCcwHi ? -1 : 0) + (fullCwLo ? 1 : 0) + (fullCwHi ? 1 : 0);
    if ((!doorCcw || doorCw) && i <= 0) {
      if ((!doorCw || doorCcw) && i >= 0) {
        var step = dirStep(V, facing) || [0, 0];
        var j = step[0], k = step[1];
        var d = hx - Math.floor(hx), e = hz - Math.floor(hz);
        return ((j >= 0 || e >= 0.5) && (j <= 0 || e <= 0.5) &&
                (k >= 0 || d <= 0.5) && (k <= 0 || d >= 0.5)) ? V.left : V.right;
      }
      return V.left;
    }
    return V.right;
  };

  /** The world half of the above: gather the four neighbours and apply the hinge. */
  P.withDoorHinge = function (st, bx, by, bz, hx, hz) {
    var SR = NS.States, R = NS.Reg, W = NS.World;
    if (!SR || !R || !R.PROP || !W) return st;
    var P_ = R.PROP, V = R.PVAL;
    if (SR.propValue(st, P_.hinge) < 0) return st;
    var facing = SR.propValue(st, P_.facing);
    var ccw = dirStep(V, turnCCW(V, facing)), cw = dirStep(V, turnCW(V, facing));
    if (!ccw || !cw) return st;
    var a = W.getBlock(bx + ccw[0], by, bz + ccw[1]);
    var b = W.getBlock(bx + ccw[0], by + 1, bz + ccw[1]);
    var c = W.getBlock(bx + cw[0], by, bz + cw[1]);
    var d = W.getBlock(bx + cw[0], by + 1, bz + cw[1]);
    var me = SR.block[st];
    var sameLower = function (o) {
      return SR.block[o] === me && SR.propValue(o, P_.half) === V.lower;
    };
    var h = P.doorHinge(V, facing,
                        SR.fullCollision(a), SR.fullCollision(b),
                        SR.fullCollision(c), SR.fullCollision(d),
                        sameLower(a), sameLower(c), hx, hz);
    return SR.withProp(st, P_.hinge, h);
  };

  /**
   * D-413 — `ChestBlock.getStateForPlacement`: which HALF of a double chest a new chest is, chosen
   * at placement. `placementState` has already set `facing` (toward the player, the plain-chest
   * default). Sneaking on a side face chooses the partner on THE FACE YOU CLICKED (and takes
   * its facing, if it is at right angles to the click); otherwise the chest joins a lone chest
   * on its clockwise side as `left`, or its counter-clockwise side as `right`. A partner is a
   * chest of the SAME block that is currently `single` (`candidatePartnerFacing`), so a chest
   * beside a half that already has a mate stays single, and a chest never pairs with a trapped one.
   * The PARTNER's own type flips in `Behave.chestShape`, on the neighbour update the placement fires.
   */
  P.withChestType = function (st, bx, by, bz, face, sneaking) {
    var SR = NS.States, R = NS.Reg, W = NS.World;
    if (!SR || !R || !R.PROP || !W) return st;
    var P_ = R.PROP, V = R.PVAL;
    if (SR.propValue(st, P_.type) !== V.single) return st;          // not a chest (a slab has no `single`)
    var me = SR.block[st];
    var partnerFacing = function (dir) {                            // candidatePartnerFacing
      var s = dirStep(V, dir);
      if (!s) return -1;
      var o = W.getBlock(bx + s[0], by, bz + s[1]);
      return (o > 0 && SR.block[o] === me && SR.propValue(o, P_.type) === V.single) ? SR.propValue(o, P_.facing) : -1;
    };
    var opp = function (v) { return turnCW(V, turnCW(V, v)); };
    var facing = SR.propValue(st, P_.facing), type = V.single;
    var clicked = V[FACE_DIR[face]];
    if (sneaking && face !== 2 && face !== 3) {
      var f2 = partnerFacing(opp(clicked));
      if (f2 >= 0 && !(f2 === clicked || f2 === opp(clicked))) {      // at right angles to the click
        facing = f2;
        type = turnCCW(V, f2) === opp(clicked) ? V.right : V.left;
      }
    }
    if (type === V.single && !sneaking) {
      if (facing === partnerFacing(turnCW(V, facing))) type = V.left;
      else if (facing === partnerFacing(turnCCW(V, facing))) type = V.right;
    }
    st = SR.withProp(st, P_.facing, facing);
    return SR.withProp(st, P_.type, type);
  };

  /** #896: `BannerBlockEntity` Patterns as a stack tag (`{BlockEntityTag:{Patterns:[{Pattern,Color}]}}`), or null. */
  P.bannerTagAt = function (x, y, z) {
    var BE = NS.BlockEntities, e = BE && BE.ready ? BE.get(x, y, z) : null;
    if (!e || e.type !== 'banner' || !e.patterns || !e.patterns.length) return null;
    return { BlockEntityTag: { Patterns: JSON.parse(JSON.stringify(e.patterns)) } };
  };
  /** #896: `BlockItem.updateCustomBlockEntityTag` for a banner -- the held stack's Patterns go on the new block entity. */
  P.applyBannerTag = function (x, y, z, stack) {
    var BE = NS.BlockEntities, e = BE && BE.ready ? BE.get(x, y, z) : null;
    if (!e || e.type !== 'banner') return false;
    var src = stack && stack.t && stack.t.BlockEntityTag && stack.t.BlockEntityTag.Patterns;
    e.patterns = src ? JSON.parse(JSON.stringify(src)) : [];
    return true;
  };

  /** `SkullItem` / `BlockItem.writeNbtToBlockEntity`: the held stack's `SkullOwner` goes on the new skull block entity. */
  P.applySkullOwner = function (x, y, z, stack) {
    var BE = NS.BlockEntities, e = BE && BE.ready ? BE.get(x, y, z) : null;
    if (!e || e.type !== 'skull') return false;
    var o = stack && stack.t && stack.t.SkullOwner;
    if (o === undefined || o === null) return false;
    e.owner = typeof o === 'string' ? { Name: o } : JSON.parse(JSON.stringify(o));
    return true;
  };

  // BlockItem.place -> Criteria.PLACED_BLOCK.trigger(player, pos, stack), called before the stack is spent
  P.triggerPlaced = function (x, y, z) {
    if (!NS.Adv || !NS.Adv.trigger || !P.advancements) return;
    var h = P.heldItem(), Iv = NS.Inventory, name = NS.States.name(NS.World.getBlock(x, y, z)) || '';
    NS.Adv.trigger(P, 'minecraft:placed_block', { block: { id: name.indexOf(':') < 0 ? 'minecraft:' + name : name }, pos: [x, y, z],
      stack: h && !(Iv && Iv.isEmpty(h)) ? { id: 'minecraft:' + NS.Items.nameOf(h.i | 0), count: h.n | 0, damage: h.d || 0, nbt: h.t } : null });
  };

  P.placeBlock = function () {
    if (!P.hasTarget) return false;
    // G6: adventure and spectator may not build. `mayBuild` is vanilla's own flag, filled from
    // `GameType.isBlockPlacingRestricted` (D-253).
    if (P.mayBuild === false) return false;
    var id = P.hotbar[P.slot] | 0;
    if (id <= 0) return false;

    // Vanilla's `BlockPlaceContext`: if the block you clicked can be replaced BY THIS ITEM the
    // new block goes THERE; otherwise it goes on the side you clicked, and that cell has to
    // accept it too. ⚠ The question takes the held item, the face and the hit point, because
    // seven block classes override `canBeReplaced` with a stacking rule — a second snow layer, a
    // second slab, a fourth sea pickle — and one (vine, glow_lichen) goes the other way and
    // REFUSES its own item. See `States.canBeReplacedBy` (D-263).
    var SR = NS.States;
    var bx = P.tx, by = P.ty, bz = P.tz;
    var onClicked = SR.canBeReplacedBy(P.tid, id, P.tface, P.thy, true);
    if (!onClicked) {
      bx += CFG.FACE_DX[P.tface];
      by += CFG.FACE_DY[P.tface];
      bz += CFG.FACE_DZ[P.tface];
      var cur = NS.World.getBlock(bx, by, bz);
      if (!SR.canBeReplacedBy(cur, id, P.tface, P.thy, false)) return false;
    }
    if (by < CFG.WORLD_MIN_Y || by >= CFG.WORLD_MAX_Y) return false;
    if (!NS.World.canPlayerModifyAt(bx, bz)) return false;   // ServerWorld.canPlayerModifyAt

    // The other half of those seven overrides: vanilla's `getStateForPlacement` GROWS the block
    // already there rather than starting a new one. A slab on a slab is a double slab, not two
    // slabs; snow deepens a layer at a time. Without this the `canBeReplaced` yes above would
    // throw the existing one away, which is the very bug this stage is closing.
    var grown = P.stackOnto(NS.World.getBlock(bx, by, bz), id);
    if (grown >= 0) {
      // the same self-collision veto the normal path gets: a double slab can seal you in.
      if (NS.States.solid[grown] && NS.Physics.boxIntersectsCell(P, bx, by, bz)) return false;
      if (!NS.World.setBlock(bx, by, bz, grown)) return false;
      if (NS.Sound) NS.Sound.blockPlace(grown, bx + 0.5, by + 0.5, bz + 0.5, P);   // G13
      if (NS.GameEvent) NS.GameEvent.emit('block_place', bx, by, bz, P);   // BlockItem.place -> BLOCK_PLACE
      P.triggerPlaced(bx, by, bz);
      P.consumePlaced();
      P.retarget();
      return true;
    }

    // Resolve the state to place: which way it faces, which half of the cell it fills, which
    // wall it hangs on (D-157). Vanilla's items do this; before it, every stair faced north and
    // a torch on a wall was a standing torch with nothing under it.
    var st = P.placementState(id, P.tface, P.thx, P.thy, P.thz, P.yaw);
    st = P.withChestType(st, bx, by, bz, P.tface, !!P.crouching);     // D-413
    // and then PLAN G2's half of placement: `waterlogged` from the fluid already in the cell,
    // and the connection properties from the six neighbours, so a fence arrives connected
    // instead of waiting for something else to change next to it (D-205).
    if (NS.Behave && NS.Behave.ready) st = NS.Behave.place(st, bx, by, bz);

    // ⚠ THE HINGE, before the second cell, because the upper half inherits it (D-332).
    st = P.withDoorHinge(st, bx, by, bz, P.thx, P.thz);

    // ⚠⚠ A DOOR, A BED OR A TALL PLANT NEEDS ITS SECOND CELL, AND NEEDS IT **BEFORE** ANYTHING IS
    // WRITTEN. Vanilla's `DoorBlock.getStateForPlacement` returns null — the placement simply does
    // not happen — when the cell above cannot be replaced, and `BedBlock` does the same for the
    // cell the head would go in. Checking afterwards would leave half a door standing in a world
    // that has already been told about it.
    var second = P.secondCell(st, bx, by, bz);
    if (second) {
      if (second.y < CFG.WORLD_MIN_Y || second.y >= CFG.WORLD_MAX_Y) return false;
      if (!NS.World.canPlayerModifyAt(second.x, second.z)) return false;   // BedBlock: head cell inside the border
      var there = NS.World.getBlock(second.x, second.y, second.z);
      if (!SR.canBeReplacedBy(there, id, P.tface, P.thy, false)) return false;
      if (NS.States.solid[second.st] &&
          NS.Physics.boxIntersectsCell(P, second.x, second.y, second.z)) return false;
    }

    // Never place a collider inside yourself — that is how you seal yourself into the world.
    // ⚠ asked of the RESOLVED state, not the hotbar's: a bottom slab at your feet is placeable
    // where the full block it defaults to is not, and asking the wrong one refuses a legal build.
    if (NS.States.solid[st] && NS.Physics.boxIntersectsCell(P, bx, by, bz)) return false;

    if (!NS.World.setBlock(bx, by, bz, st)) return false;
    if (NS.Save && NS.Save.record) NS.Save.record(bx, by, bz, st);
    P.applyBannerTag(bx, by, bz, P.heldItem());
    P.applySkullOwner(bx, by, bz, P.heldItem());
    // ⚠ AND THE SECOND CELL, IN THE SAME CALL (D-332). Its own `Behave.place` runs too, so an
    // upper door half arrives waterlogged or connected exactly as the lower one does.
    if (second) {
      var st2 = second.st;
      if (NS.Behave && NS.Behave.ready) st2 = NS.Behave.place(st2, second.x, second.y, second.z);
      if (NS.World.setBlock(second.x, second.y, second.z, st2)) {
        if (NS.Save && NS.Save.record) NS.Save.record(second.x, second.y, second.z, st2);
      }
    }
    // s115 — CarvedPumpkinBlock.onBlockAdded -> trySpawnEntity (the snow-golem pattern).
    if (NS.SnowGolem && NS.SnowGolem.onBlockAdded) NS.SnowGolem.onBlockAdded(bx, by, bz);
    if (NS.Turtle && NS.Turtle.eggCount(st)) NS.Turtle.eggAdded(bx, by, bz);   // TurtleEggBlock.onBlockAdded
    // PLAN G13 — the placed block's own sound, from its SoundType (D-285).
    if (NS.Sound) NS.Sound.blockPlace(st, bx + 0.5, by + 0.5, bz + 0.5, P);
    if (NS.GameEvent) NS.GameEvent.emit('block_place', bx, by, bz, P);   // BlockItem.place -> BLOCK_PLACE
    if (NS.Hand) NS.Hand.swing(P, 0);          // G10: placing swings the hand
    P.triggerPlaced(bx, by, bz);
    P.consumePlaced();
    P.retarget();
    return true;
  };

  /**
   * `BlockItem.place` (.decomp BlockItem.java): `if (player == null || !player.getAbilities().creativeMode)
   * itemStack.decrement(1)` — a SURVIVAL placement spends one of the held stack, the stacking
   * (slab/snow/candle) placement included. ⚠ Until the referee's useonrefcheck (torch_on_stone,
   * slab_on_bottom_slab: server x3, engine x4) nothing here spent anything: survival blocks were free.
   */
  P.consumePlaced = function () {
    var Iv = NS.Inventory, st = P.heldItem();
    if (!Iv || !st || Iv.isEmpty(st)) return;
    // MinecraftClient.doItemUse: a block interaction resets the equip progress when the count
    // changed or the player is in creative, unless the stack is left empty.
    if (!P.instabuild) {
      Iv.shrink(st, 1);
      if (Iv.isEmpty(st)) Iv.setItem(P.inventory, P.slot, Iv.EMPTY);
      if (P.syncHotbar) P.syncHotbar();
    }
    var left = P.heldItem();
    if (NS.Hand && NS.Hand.resetEquipProgress && left && !Iv.isEmpty(left)) NS.Hand.resetEquipProgress();
  };

  /**
   * stackOnto(existing, held) -> the GROWN state, or -1 when this is not a stacking placement.
   *
   * Vanilla's `getStateForPlacement` for the five blocks that accumulate. Each one is the
   * partner of a `canBeReplacedBy` override in `02c_states.js`: that one says the cell may be
   * replaced by this item, this one says what replacing it actually produces. Splitting them is
   * how a clone ends up with a slab that deletes the slab under it.
   */
  P.stackOnto = function (existing, held) {
    if (existing <= 0 || held <= 0) return -1;
    var SR = NS.States, R = NS.Reg;
    if (!R || !R.PROP) return -1;
    var b = SR.block[existing];
    if (SR.block[held] !== b) return -1;                     // only its own item grows it
    var P_ = R.PROP, V = R.PVAL, nm = R.names[b];
    var bump = function (prop, max) {
      var v = SR.propValue(existing, P_[prop]);
      if (v < 0) return -1;
      var n = +R.valueNames[v];
      if (!(n < max)) return -1;
      var next = V[String(n + 1)];
      return next === undefined ? -1 : SR.withProp(existing, P_[prop], next);
    };
    if (nm.length > 5 && nm.slice(-5) === '_slab') {
      var t = SR.propValue(existing, P_.type);
      if (t < 0 || R.valueNames[t] === 'double') return -1;
      var dbl = V.double;
      return dbl === undefined ? -1 : SR.withProp(existing, P_.type, dbl);
    }
    if (nm === 'snow') return bump('layers', 8);
    if (nm === 'sea_pickle') return bump('pickles', 4);
    if (nm === 'turtle_egg') return bump('eggs', 4);
    if (nm === 'candle' || (nm.length > 8 && nm.slice(-8) === '_candle')) return bump('candles', 4);
    return -1;
  };

  /**
   * Re-derive the nine block states the rest of the engine reads from the real inventory.
   * ⚠ An item with no block — a stick, an apple — leaves the slot at 0, which every consumer
   * already treats as "nothing to place". That is why this adapter works without touching them.
   */
  P.syncHotbar = function () {
    var Iv = NS.Inventory, IT = NS.Items;
    if (!Iv || !P.inventory) return;
    for (var i = 0; i < 9; i++) {
      var st = Iv.getItem(P.inventory, i);
      var state = 0;
      if (!Iv.isEmpty(st) && IT && IT.stateOf) {
        var v = IT.stateOf(st.i);
        if (v >= 0) state = v;
      }
      P.hotbar[i] = state;
    }
  };

  /** What is actually held — the STACK, not the block state. G10's hand and G11's GUI want this. */
  P.heldItem = function () {
    var Iv = NS.Inventory;
    if (!Iv || !P.inventory) return null;
    return Iv.getItem(P.inventory, P.slot);
  };

  /**
   * ⚠⚠ **DROPS BECOME ITEM ENTITIES NOW, NOT INVENTORY ROWS** (D-333). Dan, session 11:
   * *"items dont drop as block entities"*. This used to hand the loot straight to
   * `Inventory.add`, so a broken block teleported into your pocket and the whole middle of
   * Minecraft's loop — it falls, it bobs, you walk over it — did not exist. It is also G17c's own
   * named gap closing: **nothing had ever spawned an entity during play**, so the renderer built
   * last session drew an empty list in every real game.
   *
   * ⚠ IT IS STILL CALLED `collectDrops` BECAUSE `/setblock destroy` CALLS IT TOO, and vanilla's
   * `Block.dropResources` is likewise one function for every way a block stops existing.
   * ⚠ D-139: the direct-to-inventory path is DELETED, not left behind a flag. A fallback that
   * quietly fills the inventory when the entity list is missing would hide exactly the failure
   * this replaces — so when there is no entity list the drops are LOST, loudly, on `P.lostDrops`.
   */
  P.lostDrops = 0;
  P.collectDrops = function (drops, bx, by, bz) {
    var EL = NS.EntityList;
    if (!drops || !drops.length) return;
    var x = bx === undefined ? P.tx : bx, y = by === undefined ? P.ty : by,
        z = bz === undefined ? P.tz : bz;
    if (!EL || !EL.ready) { P.lostDrops += drops.length; return; }
    for (var i = 0; i < drops.length; i++) {
      var d = drops[i];
      var idx = NS.Items && NS.Items.of ? NS.Items.of(d.item) : -1;
      if (!(idx >= 0)) { P.lostDrops++; continue; }
      EL.popResource(x, y, z, idx, d.count || 1, d.tag ? { tag: d.tag } : undefined);
    }
  };

  /**
   * Walk over a dropped item and pick it up.
   *
   * ⚠ THE BOX IS INFLATED, AND BY DIFFERENT AMOUNTS ON DIFFERENT AXES. `Player.aiStep` collects
   * `getBoundingBox().inflate(1.0, 0.5, 1.0)` and calls `touch` on everything in it, so an item
   * a metre to the side is picked up and one a metre above your head is not. Using the bare
   * bounding box instead makes a player have to stand exactly on a dropped block, which feels
   * broken in a way nobody can describe.
   */
  P.PICKUP_INFLATE = [1.0, 0.5, 1.0];
  P.pickupItems = function () {
    var EL = NS.EntityList, Iv = NS.Inventory;
    if (!EL || !EL.ready || !Iv || !P.inventory) return 0;
    var IN = P.PICKUP_INFLATE;
    var hw = P.width * 0.5;
    var x0 = P.x - hw - IN[0], x1 = P.x + hw + IN[0];
    var y0 = P.y - IN[1], y1 = P.y + P.height + IN[1];
    var z0 = P.z - hw - IN[2], z1 = P.z + hw + IN[2];
    var got = 0, list = EL.list;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.removed || e.type !== 'item' || e.pickupDelay > 0) continue;
      if (e.itemOwner && e.itemOwner !== P.uuid && e.itemOwner !== 'player') continue;   // ItemEntity.playerTouch: target == null || target.equals(player uuid)
      var ehw = e.width * 0.5;
      if (e.x + ehw < x0 || e.x - ehw > x1) continue;
      if (e.y + e.height < y0 || e.y > y1) continue;
      if (e.z + ehw < z0 || e.z - ehw > z1) continue;
      var name = NS.Items && NS.Items.names ? NS.Items.names[e.item] : null;
      if (!name) continue;
      var st = Iv.stack(name, e.count || 1, e.d | 0, e.tag || null);
      if (!st) continue;
      // ⚠ VANILLA ONLY TAKES WHAT FITS. `Inventory.add` returns whether the whole stack went in;
      // when it does not, the entity keeps the remainder and stays on the floor.
      var before = st.n;
      Iv.add(P.inventory, st);
      var taken = before - (st.n | 0);
      if (taken <= 0) continue;
      e.count = (e.count | 0) - taken;
      got += taken;
      if (NS.Particle && NS.Particle.spawnPickup) NS.Particle.spawnPickup(e, P);
      if (e.count <= 0) EL.remove(e);
    }
    if (got) P.syncHotbar();
    return got;
  };

  /**
   * Throw the held item — vanilla's `Player.drop(stack, false)`, on Q (D-333).
   *
   * ⚠ IT IS THROWN, NOT DROPPED. The velocity is the LOOK DIRECTION at 0.3, plus 0.1 of lift and
   * a small random spin, out of `Player.drop`: `-sin(yaw)cos(pitch)*0.3`, `-sin(pitch)*0.3 + 0.1`,
   * `cos(yaw)cos(pitch)*0.3`. An item that merely fell at your feet would be picked straight back
   * up, which is why the pickup delay is 40 here and 10 for a broken block.
   * ⚠ VANILLA'S YAW IS 0 AT SOUTH AND THIS ENGINE'S IS 0 AT NORTH, so the two horizontal terms
   * swap sign; the pitch convention is the same in both (negative is up), which D-327 established.
   */
  P.DROP_SPEED = 0.3;
  P.DROP_LIFT = 0.1;
  P.DROP_PICKUP_DELAY = 40;
  /**
   * `ServerPlayNetworkHandler.onPlayerAction` SWAP_ITEM_WITH_OFFHAND: not for a spectator, main hand and
   * offhand (slot 40; container slot 45) trade stacks, then `clearActiveItem` ends any hold.
   */
  P.swapHands = function () {
    var Iv = NS.Inventory;
    if (!Iv || !P.inventory) return false;
    if (NS.Gamemode && P.mode === NS.Gamemode.SPECTATOR) return false;
    var main = Iv.getItem(P.inventory, P.slot), off = Iv.getItem(P.inventory, Iv.OFFHAND);
    Iv.setItem(P.inventory, Iv.OFFHAND, main);
    Iv.setItem(P.inventory, P.slot, off);
    if (P.usingItem) { P.usingItem = false; P.handsBusy = false; P.useTicks = 0; P.useAcc = 0; P.useMax = 0; }
    if (P.syncHotbar) P.syncHotbar();
    return true;
  };

  P.dropHeld = function (all) {
    var Iv = NS.Inventory, EL = NS.EntityList;
    if (!Iv || !P.inventory || !EL || !EL.ready) return null;
    var held = Iv.getItem(P.inventory, P.slot);
    if (Iv.isEmpty(held)) return null;
    var n = all ? held.n : 1;
    var out = Iv.removeItem(P.inventory, P.slot, n);
    if (Iv.isEmpty(out)) return null;
    var rnd = (EL.random || Math.random);
    // ⚠ THE SAME LOOK VECTOR THE CROSSHAIR USES (D-343). This line used to read `-sp`, alone
    // among the three sites, so an item thrown while looking up went down.
    var f = P.lookVec();
    var spin = rnd() * Math.PI * 2, wob = 0.02 * rnd();
    var e = EL.dropStack(P.x, P.y + (P.eyeHeight || P.EYE) - 0.3, P.z, out.i, out.n, {
      vx: f[0] * P.DROP_SPEED + Math.cos(spin) * wob,
      vy: f[1] * P.DROP_SPEED + P.DROP_LIFT + (rnd() - rnd()) * 0.1,
      vz: f[2] * P.DROP_SPEED + Math.sin(spin) * wob,
      pickupDelay: P.DROP_PICKUP_DELAY,
      tag: out.t || undefined
    });
    P.syncHotbar();
    return e;
  };

  /** Middle-click / inventory pick: put `id` in the current slot, reusing a slot that has it. */
  P.pick = function (id) {
    if (!id) return;
    for (var i = 0; i < 9; i++) if (P.hotbar[i] === id) { P.slot = i; return; }
    P.hotbar[P.slot] = id;
  };

  P.selectSlot = function (i) { P.slot = ((i % 9) + 9) % 9; };
  P.scrollSlot = function (d) { P.selectSlot(P.slot + (d > 0 ? 1 : -1)); };


  // ---------------------------------------------------------------------------
  // Serialisation (16b_save.js)
  // ---------------------------------------------------------------------------

  /**
   * The player, for the save file (PLAN G14, D-288).
   *
   * ⚠⚠ THIS READS `P.inventory`, THE TRUTH — NOT `P.hotbar`, WHICH IS A VIEW OF IT. Until G14 it
   * read the view, and the view is nine BLOCK STATES. That was correct in session 2, when the
   * hotbar WAS nine block states; G8 then gave the player a real 41-slot inventory of item
   * stacks and nothing updated this function. The result was measured, not reasoned about:
   *
   *     slot 0  diamond_pickaxe  count 1   damage 137  ->  saved as state 0, which is AIR
   *     slot 1  cobblestone      count 64              ->  saved as a state; the 64 is gone
   *     slots 9..40  27 main + 4 armour + offhand      ->  no field existed at all
   *
   * An item that is not a placeable block has no block state, so `IT.stateOf` returns −1 and the
   * slot saved as air: every tool, every piece of food and every ingredient the player owned
   * vanished on closing the tab. `savecheck` was green across all of it, because it asks whether
   * the format survives the registry being shuffled — which it does — and never asked whether
   * the format contains the game (D-276).
   *
   * ⚠ `hotbar` IS STILL WRITTEN, and is now purely a COMPATIBILITY FIELD for a v3 save being
   * read by this build. It is not read back when `inv` is present.
   */
  P.toJSON = function () {
    var Iv = NS.Inventory, Sv = NS.Survival;
    var o = {
      x: P.x, y: P.y, z: P.z, yaw: P.yaw, pitch: P.pitch,
      flying: P.flying, mode: P.mode, slot: P.slot,
      dimension: P.dimension || 'overworld',   // #254 (#254); absent on a save older than this = overworld
      timeSinceRest: P.timeSinceRest || 0,   // loop/phantom -- Stats.TIME_SINCE_REST
      // loop/beds (G19c) -- ServerPlayerEntity's own spawnPointPosition/spawnAngle.
      spawnPoint: P.spawnPoint ? { x: P.spawnPoint.x, y: P.spawnPoint.y, z: P.spawnPoint.z,
                                    yaw: P.spawnPoint.yaw || 0 } : null,
      // BY NAME plus local state index, for the same reason the world save is (16b_save.js):
      // a raw state id is only meaningful against the registry that produced it.
      hotbar: Array.prototype.slice.call(P.hotbar).map(function (st) {
        var R = NS.Reg, SR = NS.States;
        if (!st || !R || !R.ready) return null;
        var b = SR.block[st];
        return [R.names[b], st - R.realFirst[b]];
      })
    };
    if (Iv && P.inventory) o.inv = Iv.toJSON(P.inventory);
    if (Sv && Sv.toJSON) o.sv = Sv.toJSON(P);
    if (P.shoulderLeft) o.ShoulderEntityLeft = P.shoulderLeft;
    if (P.shoulderRight) o.ShoulderEntityRight = P.shoulderRight;
    if (NS.Stats && NS.Stats.toJSON) o.stats = NS.Stats.toJSON();   // G26a
    // #293 -- LivingEntity's `ActiveEffects` (07q_effects.js): written only when non-empty.
    if (NS.Effects && NS.Effects.writeActiveEffects) NS.Effects.writeActiveEffects(P, o);
    return o;
  };

  P.fromJSON = function (o) {
    if (!o) return false;
    if (typeof o.x !== 'number' || typeof o.y !== 'number' || typeof o.z !== 'number') return false;
    P.x = o.x; P.y = o.y; P.z = o.z;
    P.px = P.x; P.py = P.y; P.pz = P.z;
    P.ex = P.x; P.ey = P.y; P.ez = P.z;
    P.vx = P.vy = P.vz = 0;
    if (typeof o.yaw === 'number') P.yaw = o.yaw;
    if (typeof o.pitch === 'number') P.pitch = o.pitch;
    P.flying = !!o.flying;
    P.shoulderLeft = o.ShoulderEntityLeft || null; P.shoulderRight = o.ShoulderEntityRight || null; P.shoulderAge = 21;
    // ⚠ `creative` is a PRE-G6 save. It is read, once, and translated — a save written before
    // the boolean died must still load, and a mode of 0/1 is not the same thing as false/true.
    if (typeof o.mode === 'number' && NS.Gamemode) NS.Gamemode.set(P, o.mode | 0);
    else if (typeof o.creative === 'boolean' && NS.Gamemode) {
      NS.Gamemode.set(P, o.creative ? NS.Gamemode.CREATIVE : NS.Gamemode.SURVIVAL);
    }
    if (typeof o.slot === 'number') P.selectSlot(o.slot | 0);
    // loop/phantom -- Stats.TIME_SINCE_REST round-trip; absent on any save older than this pass.
    P.timeSinceRest = (typeof o.timeSinceRest === 'number') ? o.timeSinceRest : 0;
    // loop/beds (G19c) -- absent on any save older than this pass, same shape as timeSinceRest.
    P.spawnPoint = (o.spawnPoint && typeof o.spawnPoint.x === 'number' &&
                    typeof o.spawnPoint.y === 'number' && typeof o.spawnPoint.z === 'number')
      ? { x: o.spawnPoint.x, y: o.spawnPoint.y, z: o.spawnPoint.z, yaw: o.spawnPoint.yaw || 0 }
      : null;

    var Iv = NS.Inventory, Sv = NS.Survival;
    if (Sv && Sv.fromJSON) Sv.fromJSON(P, o.sv);
    if (NS.Stats && NS.Stats.fromJSON) NS.Stats.fromJSON(o.stats);   // G26a
    // #293 -- absent (any save before this) = no effects, never the previous world's.
    if (NS.Effects && NS.Effects.readActiveEffects) NS.Effects.readActiveEffects(P, o);

    if (Iv && P.inventory && o.inv && Iv.fromJSON(P.inventory, o.inv)) {
      // the real thing: 41 slots of item stacks with counts, damage and NBT
      if (typeof o.slot === 'number') P.inventory.selected = P.slot;
      P.syncHotbar();
    } else if (o.hotbar && o.hotbar.length === 9) {
      // ⚠ A v3 SAVE, MIGRATED — AND IT INVENTS NOTHING. Each entry is a [name, localState] pair
      // that is still perfectly meaningful: it names a block. What a v3 save never recorded is
      // the COUNT, so each migrated slot becomes ONE of that block's item, and a block with no
      // item (water, fire, a wall torch) becomes an empty slot rather than a guess.
      // ⚠ This is why v3 is migrated where v2 was refused (see 16b_save.js): v2's numbers were
      // ids into a table that no longer exists and could only have been guessed at. A name is
      // not a guess.
      for (var i = 0; i < 9; i++) {
        var v = o.hotbar[i];
        // [name, local] from v3. A bare number is a pre-session-2 legacy id and is NOT
        // reinterpreted — those numbers indexed a 49-entry table that no longer exists, so
        // honouring them would silently fill the hotbar with the wrong blocks.
        if (!v || typeof v !== 'object' || typeof v[0] !== 'string') continue;
        P.hotbar[i] = NS.States.withLocal(v[0], v[1] | 0);
      }
      // the stacks themselves are `Inventory`'s job, where `savecheck` can reach the rule
      if (Iv && P.inventory) { Iv.fromHotbarV3(P.inventory, o.hotbar); P.syncHotbar(); }
    }
    return true;
  };
})(MCL);
