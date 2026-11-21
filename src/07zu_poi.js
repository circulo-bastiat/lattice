// 07zu_poi.js — loop/raidpoi-s103 (QUEUE 0.2 raid loop remainder): the minimal
// `PointOfInterestStorage` substrate `Rd.OWED` named as missing — HOME (a bed) and MEETING
// (the village bell), the two POI kinds `RaiderEntity.AttackHomeGoal`'s own `tryFindHome` and
// `Raid`'s own village-center averaging need, read from `.decomp/net/minecraft/world/poi/
// PointOfInterestType.java` (read in full this session):
//
//   field_18517 = register("home",    BED_STATES,                    1,  1)   -- ticketCount 1, searchDistance 1
//   field_18518 = register("meeting", getAllStatesOf(Blocks.field_16332 /* bell */), 32, 6)   -- ticketCount 32, searchDistance 6
//
// `BED_STATES` is EVERY bed colour's states filtered to `BedPart.field_12560` = "head"
// (PointOfInterestType.java:47; BedPart.java:6-7 `field_12560("head"), field_12557("foot")`).
// BedBlock.java:305 onPlaced puts the `head` part at the neighbour in FACING; :62 the default
// state is foot. HOME is therefore a bed's HEAD cell; `part` carries exactly `head`/`foot`.
//
// ── WHAT THIS FILE DOES NOT DO, AND WHY (`Poi.OWED`, bottom) ───────────────────────────────
// Real `PointOfInterestStorage` is added to / removed from at the ONE place a block can change
// (`ServerWorld.onBlockChanged` -> `getPointOfInterestStorage().add/remove`, same choke-point
// argument `07_world.js`'s own `W.setBlock` header already makes for its journal/cascade calls)
// and at chunk load (`initForPalette`, a per-section palette scan). This unit does not touch
// `07_world.js`, `07b_behaviour.js` or `07c_blockentity.js` — every one of those is a SHARED
// file another worker is editing the same session, and the task's own file-ownership rule says
// keep shared-file edits to registration lines, not a new hook threaded through the world's one
// mutation path. What stands in is a PERIODIC FULL RECONCILE (`Poi.tick`, called once a tick
// from `Rd.tickLive`, actually rescanning every `RESCAN_INTERVAL` ticks) — the exact same
// "poll instead of an event hook" shape `07l_spawn.js`'s golem-summon/gossip triggers once had
// (those now ride the real conversation, 07zv6_vbgather.js). `Poi.OWED` names the bounded latency this costs.
(function (NS) {
  'use strict';

  var Poi = NS.Poi = { ready: false };

  Poi.HOME = 'home';
  Poi.MEETING = 'meeting';
  // s128 (G20, the lightning rod): `field_27010 = register("lightning_rod", getAllStatesOf(
  // Blocks.LIGHTNING_ROD), 0, 1)` (PointOfInterestType.java:75) -- ticketCount 0, searchDistance 1.
  // `ServerWorld.getLightningRodPos` is its one reader (07zzc_lightning.js).
  Poi.LIGHTNING_ROD = 'lightning_rod';
  // G18f-J1: the union of every profession's workstation blocks (PointOfInterestType's
  // acquirable job sites; ticketCount 1, searchDistance 1) -- POTENTIAL_JOB_SITE's search type.
  Poi.JOB_SITE = 'job_site';
  // G18b-BE1: PointOfInterestTypes BEEHIVE / BEE_NEST (ticketCount 0, searchDistance 1), BeeEntity.findHive's index.
  Poi.BEEHIVE = 'beehive';
  Poi.BEE_NEST = 'bee_nest';

  // PointOfInterestType.java's own register(...) 3rd argument (ticketCount) for each row cited
  // in this file's header.
  Poi.TICKET_COUNT = { home: 1, meeting: 32, lightning_rod: 0, job_site: 1, beehive: 0, bee_nest: 0 };
  // ...and the 4th/5th argument (searchDistance) — kept for citation/future callers; nothing in
  // this unit needs it yet (`Rd.isNearOccupiedPOI`'s own fixed radius-1 stands in, as before).
  Poi.SEARCH_DISTANCE = { home: 1, meeting: 6, lightning_rod: 1, job_site: 1, beehive: 1, bee_nest: 1 };

  // `PointOfInterestStorage.OccupationStatus` (PointOfInterestStorage.java:237-249), the three
  // predicates `getPosition`/`getInCircle`/etc. all take.
  Poi.STATUS = { ANY: 0, HAS_SPACE: 1, OCCUPIED: 2 };

  // A poll, not an event hook — see this file's own header. 100 ticks = the cadence 07l_spawn.js's
  // old golem-summon poll used (now deleted: the summon rides talkWithVillager).
  Poi.RESCAN_INTERVAL = 100;

  var homeStates = null, meetingStates = null, rodStates = null, jobStates = null, hiveStates = null;   // real-state id -> true
  var store = null;                              // 'x,y,z' -> { x, y, z, type, ticket }
  var tickCount = 0;

  function ticketCountFor(type) { var n = Poi.TICKET_COUNT[type]; return n === undefined ? 1 : n; }
  function keyOf(pos) { return Math.floor(pos.x) + ',' + Math.floor(pos.y) + ',' + Math.floor(pos.z); }

  /** Every real state of every `#beds`-tagged block whose `part` property is `head`, plus every
   *  real state of `bell` — the two block sets `PointOfInterestType.java`'s own `home`/`meeting`
   *  rows are built from, read off the registry rather than a hand-kept name list (the same
   *  "read from the bytecode, not remembered" rule `07o_profession.js`'s own header states). */
  function buildCandidateStates() {
    var R = NS.Reg, SR = NS.States, Tags = NS.Tags;
    if (!R || !R.ready || !SR || !SR.ready || !Tags || !Tags.ready || !R.PROP || !R.PVAL) return false;
    homeStates = Object.create(null);
    meetingStates = Object.create(null);
    var bedNames = Tags.blocks ? Tags.blocks('beds') : null;
    if (bedNames) {
      var P_ = R.PROP, V = R.PVAL;
      for (var i = 0; i < bedNames.length; i++) {
        var b = R.id[bedNames[i]];
        if (b === undefined || P_.part === undefined || V.head === undefined) continue;
        for (var s = R.realFirst[b]; s < R.realFirst[b + 1]; s++) {
          if (SR.propValue(s, P_.part) === V.head) homeStates[s] = true;
        }
      }
    }
    var bellId = R.id['bell'];
    if (bellId !== undefined) {
      for (var s2 = R.realFirst[bellId]; s2 < R.realFirst[bellId + 1]; s2++) meetingStates[s2] = true;
    }
    rodStates = Object.create(null);
    var rodId = R.id['lightning_rod'];
    if (rodId !== undefined) {
      for (var s3 = R.realFirst[rodId]; s3 < R.realFirst[rodId + 1]; s3++) rodStates[s3] = true;
    }
    hiveStates = Object.create(null);
    var hn = ['beehive', 'bee_nest'];
    for (var h = 0; h < 2; h++) {
      var hid = R.id[hn[h]];
      if (hid === undefined) continue;
      for (var s5 = R.realFirst[hid]; s5 < R.realFirst[hid + 1]; s5++) hiveStates[s5] = hn[h];
    }
    jobStates = Object.create(null);
    var W_ = NS.Profession && NS.Profession.WORKSTATIONS;
    if (W_) for (var pn in W_) for (var q = 0; q < W_[pn].length; q++) {
      var jid = R.id[W_[pn][q]];
      if (jid === undefined) continue;
      for (var s4 = R.realFirst[jid]; s4 < R.realFirst[jid + 1]; s4++) jobStates[s4] = true;
    }
    return true;
  }

  function sectionHasCandidate(sec) {
    if (sec.u >= 0) return !!(homeStates[sec.u] || meetingStates[sec.u] || rodStates[sec.u] || jobStates[sec.u] || hiveStates[sec.u]);
    var p = sec.p, n = sec.n;
    for (var k = 0; k < n; k++) { var id = p[k]; if (homeStates[id] || meetingStates[id] || rodStates[id] || jobStates[id] || hiveStates[id]) return true; }
    return false;
  }

  function scanChunk(c, S, CFG, seen) {
    var baseX = c.cx << 4, baseZ = c.cz << 4, baseY = CFG.WORLD_MIN_Y;
    for (var sy = 0; sy < CFG.SECTIONS_Y; sy++) {
      var sec = c.sec[sy];
      if (!sectionHasCandidate(sec)) continue;
      var sy0 = baseY + sy * 16;
      for (var i = 0; i < 4096; i++) {
        var st = S.get(sec, i);
        var type = homeStates[st] ? Poi.HOME : (meetingStates[st] ? Poi.MEETING :
                   (rodStates[st] ? Poi.LIGHTNING_ROD : (jobStates[st] ? Poi.JOB_SITE : (hiveStates[st] || null))));
        if (!type) continue;
        var x = baseX + (i & 15), z = baseZ + ((i >> 4) & 15), y = sy0 + (i >> 8);
        var key = x + ',' + y + ',' + z;
        seen[key] = true;
        var e = store[key];
        if (!e) store[key] = { x: x, y: y, z: z, type: type, ticket: 0 };
        else if (e.type !== type) { e.type = type; e.ticket = 0; }
      }
    }
  }

  /** One full reconcile: every currently-loaded (generated) chunk is rescanned for HOME/MEETING
   *  block states; anything found is added (or kept, ticket preserved, if already tracked) and
   *  anything tracked but not seen this pass — a broken bed/bell, or a chunk this engine no
   *  longer keeps loaded — is dropped. `Poi.tick` calls this every `RESCAN_INTERVAL` ticks, not
   *  every tick (see this file's header). */
  function rescan() {
    var W = NS.World, CH = NS.CH, CFG = NS.CFG, S = NS.Section;
    if (!W || !W.chunks || !CH || !CFG || !S) return;
    var seen = Object.create(null);
    W.chunks.forEach(function (c) {
      if (!c || c.state < CH.GENERATED) return;
      scanChunk(c, S, CFG, seen);
    });
    for (var key in store) {
      if (Object.prototype.hasOwnProperty.call(store, key) && !seen[key]) delete store[key];
    }
  }

  Poi.init = function () {
    store = Object.create(null);
    tickCount = 0;
    if (!buildCandidateStates()) { Poi.ready = false; return Poi; }
    Poi.ready = true;
    return Poi;
  };

  /** Call once a world tick (wired from `Rd.tickLive`, 07s_raid.js — see this file's header for
   *  why this file does not wire its own call site into `17_main.js`). Lazily self-inits so no
   *  separate registration line is needed anywhere: the first call that finds the registry
   *  ready builds the candidate-state tables, every `RESCAN_INTERVAL`th does the real work. */
  Poi.tick = function () {
    if (!Poi.ready) Poi.init();
    if (!Poi.ready) return;
    if (tickCount % Poi.RESCAN_INTERVAL === 0) rescan();
    tickCount++;
  };

  /** One full reconcile NOW (the same `rescan` `Poi.tick` runs every RESCAN_INTERVAL ticks) --
   *  for a check that places a block and asks the store the same tick. */
  Poi.rescanNow = function () { if (!Poi.ready) Poi.init(); if (Poi.ready) rescan(); };

  /** Live add/remove hook, called from `World.setBlock` (the one place a block changes) --
   *  PointOfInterestStorage.add/remove via ServerWorld.onBlockChanged. The ticket of an entry
   *  whose type survives the change (a bed's `occupied` toggle) is kept. `Poi.live=false`
   *  leaves only the periodic reconcile (a check's switch). */
  Poi.live = true;
  Poi.onChange = function (x, y, z, st) {
    if (!Poi.live || !Poi.ready || !store) return;
    var type = homeStates[st] ? Poi.HOME : (meetingStates[st] ? Poi.MEETING :
               (rodStates[st] ? Poi.LIGHTNING_ROD : (jobStates[st] ? Poi.JOB_SITE : (hiveStates[st] || null))));
    var key = x + ',' + y + ',' + z, e = store[key];
    if (!type) { if (e) delete store[key]; return; }
    if (!e) store[key] = { x: x, y: y, z: z, type: type, ticket: 0 };
    else if (e.type !== type) { e.type = type; e.ticket = 0; }
  };

  Poi.get = function (pos) { return store ? (store[keyOf(pos)] || null) : null; };
  Poi.getType = function (pos) { var e = Poi.get(pos); return e ? e.type : null; };

  Poi.hasSpace = function (pos) { var e = Poi.get(pos); return !!e && e.ticket < ticketCountFor(e.type); };
  Poi.isOccupied = function (pos) { var e = Poi.get(pos); return !!e && e.ticket > 0; };
  Poi.reserveTicket = function (pos) {
    var e = Poi.get(pos);
    if (!e || e.ticket >= ticketCountFor(e.type)) return false;
    e.ticket++; return true;
  };
  Poi.releaseTicket = function (pos) {
    var e = Poi.get(pos);
    if (!e || e.ticket <= 0) return false;
    e.ticket--; return true;
  };

  function statusMatches(status, e) {
    if (status === Poi.STATUS.HAS_SPACE) return e.ticket < ticketCountFor(e.type);
    if (status === Poi.STATUS.OCCUPIED) return e.ticket > 0;
    return true;
  }

  /** `PointOfInterestStorage.getInCircle` (PointOfInterestStorage.java:69-72): every tracked POI
   *  matching `typePred`/`status` within `radius` BLOCKS (a real circle, squared-distance test —
   *  not `Rd.isNearOccupiedPOI`'s own chunk-SECTION Chebyshev test, a different, wider-radius,
   *  caller). `typePred` is a `function(type)->bool`, mirroring vanilla's `Predicate<
   *  PointOfInterestType>`. */
  Poi.getInCircle = function (typePred, pos, radius, status) {
    var out = [], r2 = radius * radius;
    for (var key in store) {
      if (!Object.prototype.hasOwnProperty.call(store, key)) continue;
      var e = store[key];
      if (typePred && !typePred(e.type)) continue;
      if (!statusMatches(status, e)) continue;
      var dx = e.x - pos.x, dy = e.y - pos.y, dz = e.z - pos.z;
      if (dx * dx + dy * dy + dz * dz > r2) continue;
      out.push({ x: e.x, y: e.y, z: e.z });
    }
    return out;
  };

  function shuffle(list, rand) {
    for (var i = list.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var tmp = list[i]; list[i] = list[j]; list[j] = tmp;
    }
  }

  /** `PointOfInterestStorage.getPosition(type, positionPredicate, occupationStatus, pos, radius,
   *  random)` (PointOfInterestStorage.java:117-121): every in-circle match, SHUFFLED, then the
   *  first whose position also passes `posPred` — exactly `RaiderEntity.AttackHomeGoal.
   *  tryFindHome`'s own call shape (RaiderEntity.java:311-319), which is this function's one
   *  live caller (`Ai.AttackHomeGoal`, 07k_goals.js). */
  Poi.getPosition = function (typePred, posPred, status, pos, radius, randFn) {
    var list = Poi.getInCircle(typePred, pos, radius, status);
    shuffle(list, randFn || Math.random);
    for (var i = 0; i < list.length; i++) {
      if (!posPred || posPred(list[i])) return list[i];
    }
    return null;
  };

  /** Every currently-OCCUPIED (ticket > 0) POI position, of any type — the shape `07s_raid.js`'s
   *  own `claimedPositions` already returns for `Profession.claimed`, so `Rd.villageCenterNear`/
   *  `Rd.isNearOccupiedPOI` can fold this straight in (07s_raid.js, this pass). See `Poi.OWED`:
   *  nothing reserves a HOME/MEETING ticket yet (no sleep/meeting-rally AI exists), so this is
   *  real substrate with an honestly empty live result today, not a silent no-op. */
  Poi.occupiedPositions = function () {
    var out = [];
    if (!store) return out;
    for (var key in store) {
      if (!Object.prototype.hasOwnProperty.call(store, key)) continue;
      var e = store[key];
      if (e.ticket > 0) out.push({ x: e.x, y: e.y, z: e.z });
    }
    return out;
  };

  /** Every tracked position of one type, regardless of occupation — a check/debug convenience,
   *  not read by any live caller. */
  Poi.positions = function (type) {
    var out = [];
    if (!store) return out;
    for (var key in store) {
      if (!Object.prototype.hasOwnProperty.call(store, key)) continue;
      var e = store[key];
      if (!type || e.type === type) out.push({ x: e.x, y: e.y, z: e.z, type: e.type, ticket: e.ticket });
    }
    return out;
  };

  Poi.count = function () {
    var n = 0;
    if (store) for (var key in store) if (Object.prototype.hasOwnProperty.call(store, key)) n++;
    return n;
  };

  Poi.OWED = [
    // STRUCK #5070: the live add/remove hook is `Poi.onChange`, called from `World.setBlock`.
    // STRUCK loop/sleep-s104: HOME/MEETING tickets ARE now reserved in live play --
    // 07zv_villagerbrain.js's own `VB.tick` claims a HOME ticket per villager (sleep AI) and a
    // MEETING ticket during the 'meet' schedule activity, both through `Poi.getPosition`/
    // `Poi.reserveTicket` exactly as this file's own API already allowed. `Poi.isOccupied`/
    // `Poi.occupiedPositions` (and so `Rd.villageCenterNear`) now see real HOME/MEETING
    // occupancy, not only `Profession.claimed`. `VB.OWED` (07zv_villagerbrain.js) names what
    // remains: no fallback for a villager with no bed in range, no death-time ticket release,
    // and the walk-to-POI machinery is a direct steer rather than the real Brain Task list.
    '`Poi.getPosition`/`Poi.getInCircle` walk the WHOLE store per call rather than a chunk-' +
      'indexed radius search (vanilla\'s own `SerializingRegionBasedStorage` shape) -- fine at ' +
      'this engine\'s village sizes (a handful to a few dozen tracked positions), named as the ' +
      'thing that would need revisiting if a much larger POI index ever existed here',
    'chunk UNLOAD is read implicitly (a position not in `W.chunks` this reconcile is dropped, ' +
      'same as a broken block), not driven by an explicit unload event -- correct today only ' +
      'because this engine keeps every generated chunk in `W.chunks` for as long as the check/ ' +
      'game process runs (no chunk-drop path exists to disagree with yet)'
  ];

})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
