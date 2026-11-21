// ZombieSiegeManager (net/minecraft/village/ZombieSiegeManager.java) - the per-world state machine.
// The siege STARTS at midnight (skyAngle == 0.5, i.e. dayTime % 24000 == 18000) with a 1-in-10 roll, picks a
// non-spectator player near an occupied POI (not in a desert), searches 10 times for a start 32 blocks away,
// then every 3rd tick spawns one of 20 zombies. Zombie placement is G18c-Z4 (ctx.trySpawnZombie).
(function (NS) {
  'use strict';
  var Sg = NS.Siege = { ready: true };
  // State enum: field_18480 = ABORTED-ish (unused), field_18481 = ONGOING, field_18482 = DONE.
  Sg.ABORTED = 0; Sg.ONGOING = 1; Sg.DONE = 2;
  Sg.state = Sg.DONE; Sg.spawned = false; Sg.remaining = 0; Sg.countdown = 0;
  Sg.startX = 0; Sg.startY = 0; Sg.startZ = 0;
  Sg.reset = function () { Sg.state = Sg.DONE; Sg.spawned = false; Sg.remaining = 0; Sg.countdown = 0; };

  /** ctx: isDay(), skyAngleHalf() (skyAngle==0.5), rand() [0,1), randInt(n), players() ->
   *  [{x,y,z,spectator}], nearOccupiedPoi(x,y,z), isDesert(x,y,z), spawnVector(x,y,z) -> truthy|null,
   *  trySpawnZombie(x,y,z) optional. Returns vanilla's int (1 when a countdown step spawned/finished). */
  Sg.spawn = function (ctx, doMobSpawning) {
    if (ctx.isDay() || !doMobSpawning) { Sg.state = Sg.DONE; Sg.spawned = false; return 0; }
    if (ctx.skyAngleHalf()) Sg.state = ctx.randInt(10) === 0 ? Sg.ONGOING : Sg.DONE;
    if (Sg.state === Sg.DONE) return 0;
    if (!Sg.spawned) {
      if (!startSearch(ctx)) return 0;
      Sg.spawned = true;
    }
    if (Sg.countdown > 0) { Sg.countdown--; return 0; }
    Sg.countdown = 2;
    if (Sg.remaining > 0) {
      if (ctx.trySpawnZombie) ctx.trySpawnZombie(Sg.startX, Sg.startY, Sg.startZ);
      Sg.remaining--;
    } else Sg.state = Sg.DONE;
    return 1;
  };

  /** getSpawnVector: 10 tries at start +-8 (nextInt(16)-8 for x then z), topY, must be near an occupied POI and pass
   *  canSpawnInDark; returns the bottom-centre of the block or null. rng: nextInt(n). ctx: topY(x,z), nearOccupiedPoi,
   *  canSpawnInDark(x,y,z,rng). */
  Sg.findSpawnPos = function (ctx, rng, sx, sy, sz) {
    for (var i = 0; i < 10; i++) {
      var x = sx + rng.nextInt(16) - 8, z = sz + rng.nextInt(16) - 8, y = ctx.topY(x, z);
      if (ctx.nearOccupiedPoi(x, y, z) && ctx.canSpawnInDark(x, y, z, rng)) return { x: x + 0.5, y: y, z: z + 0.5 };
    }
    return null;
  };
  /** trySpawnZombie: placement then yaw = nextFloat()*360 (ctx.spawnZombie does the ZombieEntity + initialize). */
  Sg.trySpawnZombie = function (ctx, rng, sx, sy, sz) {
    var v = Sg.findSpawnPos(ctx, rng, sx, sy, sz);
    if (!v) return null;
    var yaw = (rng.next(24) / 16777216) * 360;
    Sg.zombiesSpawned = (Sg.zombiesSpawned || 0) + 1;
    if (ctx.spawnZombie) ctx.spawnZombie(v.x, v.y, v.z, yaw);
    return { x: v.x, y: v.y, z: v.z, yaw: yaw };
  };

  function startSearch(ctx) {
    var ps = ctx.players();
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      if (p.spectator) continue;
      var bx = Math.floor(p.x), by = Math.floor(p.y), bz = Math.floor(p.z);
      if (ctx.nearOccupiedPoi(bx, by, bz) && !ctx.isDesert(bx, by, bz)) {
        for (var k = 0; k < 10; k++) {
          var a = ctx.rand() * (Math.PI * 2);
          Sg.startX = bx + Math.floor(Math.cos(a) * 32);
          Sg.startY = by;
          Sg.startZ = bz + Math.floor(Math.sin(a) * 32);
          if (ctx.spawnVector(Sg.startX, Sg.startY, Sg.startZ)) { Sg.countdown = 0; Sg.remaining = 20; break; }
        }
        return true;
      }
    }
    return false;
  }

  /** Live caller: worldTick. */
  Sg.tick = function (NS2) {
    var Sky = NS2.Sky, P = NS2.Player, W = NS2.World;
    if (!Sky || !P || !W || !NS2.Raid || !NS2.Raid.isNearOccupiedPOI) return 0;
    var near = function (x, y, z) { return NS2.Raid.isNearOccupiedPOI({ x: x, y: y, z: z }, (NS2.Profession && NS2.Profession.ready) ? NS2.Profession.claimed : null); };
    return Sg.spawn({
      isDay: function () { return Sky.isDay(); },
      skyAngleHalf: function () { return ((Sky.dayTime % 24000) + 24000) % 24000 === 18000; },
      rand: Math.random, randInt: function (n) { return Math.floor(Math.random() * n); },
      players: function () { return [{ x: P.x, y: P.y, z: P.z, spectator: !!P.isSpectator }]; },
      nearOccupiedPoi: near,
      isDesert: function () { return false; },
      spawnVector: function (x, y, z) { return near(x, y, z) ? { x: x, y: y, z: z } : null; }
    }, !(NS2.Spawn && NS2.Spawn.ready === false));
  };
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
