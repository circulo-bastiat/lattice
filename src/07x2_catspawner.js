// 07x2_catspawner.js — #1701: `CatSpawner` (Yarn 1.18.2, .decomp/net/minecraft/world/spawner/
// CatSpawner.java, read in full) — the world-level spawner that puts wild cats in villages
// (> 4 occupied HOME POIs within 48, < 5 cats in Box.expand(48,8,48)) and beside swamp huts
// (no cat within Box.expand(16,8,16)). The swamp-hut all_black type + persistence is
// CatEntity.initialize's own tail, already applied by 07i_entitylist.js's cat default.
(function (NS) {
  'use strict';

  var Cs = NS.CatSpawner = { ready: false };

  Cs.INTERVAL = 1200;        // SPAWN_INTERVAL
  Cs.POI_SECTION_RADIUS = 2; // isNearOccupiedPointOfInterest(pos, 2)
  Cs.state = { cooldown: 0 };

  Cs.init = function () { Cs.state.cooldown = 0; Cs.ready = true; return Cs; };

  function section(v) { return Math.floor(v / 16); }

  /** `ServerWorld.isNearOccupiedPointOfInterest(pos, 2)`: an occupied POI within 2 chunk sections. */
  function nearOccupiedPoi(NS2, pos) {
    var Poi = NS2.Poi;
    if (!Poi || !Poi.occupiedPositions) return false;
    var list = Poi.occupiedPositions();
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (Math.max(Math.abs(section(p.x) - section(pos.x)), Math.abs(section(p.y) - section(pos.y)),
                   Math.abs(section(p.z) - section(pos.z))) <= Cs.POI_SECTION_RADIUS) return true;
    }
    return false;
  }

  /** Cats whose position lies in `new Box(pos).expand(rx, ry, rz)` (a 1-block box). */
  function catsNear(NS2, pos, rx, ry, rz) {
    var n = 0, list = (NS2.EntityList && NS2.EntityList.list) || [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (!c || c.type !== 'cat' || c.dead || c.removed) continue;
      if (c.x >= pos.x - rx && c.x <= pos.x + 1 + rx && c.y >= pos.y - ry && c.y <= pos.y + 1 + ry &&
          c.z >= pos.z - rz && c.z <= pos.z + 1 + rz) n++;
    }
    return n;
  }

  function spawnCat(NS2, pos) {
    var m = NS2.EntityList.spawn('cat', pos.x + 0.5, pos.y, pos.z + 0.5);
    return m ? 1 : 0;
  }

  /** `SpawnHelper.canSpawn(ON_GROUND, world, pos, CAT)`: solid floor + clear cells + empty box. */
  function canSpawn(NS2, pos) {
    var W = NS2.World;
    if (W.getBlock(pos.x, pos.y - 1, pos.z) === 0) return false;
    return !NS2.Spawn || !NS2.Spawn.clearForSpawn || NS2.Spawn.clearForSpawn('cat', pos.x, pos.y, pos.z);
  }

  /** One tick of `CatSpawner.spawn`; returns the number of cats spawned. */
  Cs.tick = function (NS2, rand) {
    if (!Cs.ready) return 0;
    rand = rand || Math.random;
    if (NS2.Spawn && NS2.Spawn.ready === false) return 0;   // doMobSpawning
    var W = NS2.World, player = NS2.Player;
    Cs.state.cooldown--;
    if (Cs.state.cooldown > 0) return 0;
    Cs.state.cooldown = Cs.INTERVAL;
    if (!W || !player || player.dead) return 0;
    var dx = (8 + Math.floor(rand() * 24)) * (rand() < 0.5 ? 1 : -1);
    var dz = (8 + Math.floor(rand() * 24)) * (rand() < 0.5 ? 1 : -1);
    var pos = { x: Math.floor(player.x) + dx, y: Math.floor(player.y), z: Math.floor(player.z) + dz };
    if (W.loadedAt) {
      for (let cx = (pos.x - 10) >> 4; cx <= (pos.x + 10) >> 4; cx++)
        for (let cz = (pos.z - 10) >> 4; cz <= (pos.z + 10) >> 4; cz++)
          if (!W.loadedAt(cx << 4, cz << 4)) return 0;
    }
    if (!canSpawn(NS2, pos)) return 0;
    if (nearOccupiedPoi(NS2, pos)) {
      // spawnInHouse
      var beds = NS2.Poi.getInCircle(function (t) { return t === 'home'; }, pos, 48, NS2.Poi.STATUS.OCCUPIED);
      if (beds.length > 4 && catsNear(NS2, pos, 48, 8, 48) < 5) return spawnCat(NS2, pos);
      return 0;
    }
    if (NS2.Structures && NS2.Structures.containsAt && NS2.Structures.containsAt('swamp_hut', pos.x, pos.y, pos.z)) {
      // spawnInSwampHut
      return catsNear(NS2, pos, 16, 8, 16) < 1 ? spawnCat(NS2, pos) : 0;
    }
    return 0;
  };

  Cs.OWED = [
    'a HOME POI is "occupied" only when something reserved its ticket; no villager sleep AI does yet (Poi.OWED)'
  ];
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
