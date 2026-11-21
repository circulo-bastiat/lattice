// 02l_dimension.js — DimensionType + DimensionOptions (#254, #254). SHARED: worldgen and lighting run in the
// worker bundle and ask the same table the main thread does. No DOM.
//
// Ported from .decomp/net/minecraft/world/dimension/DimensionType.java lines 78-90: the three built-in
// `DimensionType.create(...)` calls, argument for argument (fixedTime, hasSkyLight, hasCeiling, ultrawarm,
// natural, coordinateScale, hasEnderDragonFight, piglinSafe, bedWorks, respawnAnchorWorks, hasRaids, minY,
// height, logicalHeight, infiniburn, effects, ambientLight). 1.18.2 keeps `dimension_type` in the built-in
// registry (there is no data file for it); `.mcdata/.../dimension/overworld.json` only names the type.
//
// RULING (docs/decisions/254-dimension-substrate.md): the engine's voxel volume stays -64..256 for every
// dimension (CFG.WORLD_MIN_Y/MAX_Y, D-5). `minY/height/logicalHeight` are the dimension's own vanilla numbers
// and bound what may be built/generated; the Nether and End simply use y 0..255 of the shared volume.
(function (NS) {
  'use strict';

  var Dim = NS.Dim = { ready: true, cur: 'overworld' };

  // create(...) argument order, DimensionType.java:146-164.
  function make(id, numId, a) {
    var t = {
      id: id, numId: numId,
      fixedTime: a[0],                 // null = OptionalLong.empty()
      hasSkyLight: a[1], hasCeiling: a[2], ultrawarm: a[3], natural: a[4],
      coordinateScale: a[5], hasEnderDragonFight: a[6], piglinSafe: a[7], bedWorks: a[8],
      respawnAnchorWorks: a[9], hasRaids: a[10],
      minY: a[11], height: a[12], logicalHeight: a[13],
      infiniburn: a[14], effects: a[15], ambientLight: a[16]
    };
    // checkHeight (DimensionType.java:111-122)
    if (t.height < 16 || t.minY % 16 !== 0 || t.height % 16 !== 0) throw new Error('bad dimension height ' + id);
    if (t.logicalHeight > t.height) throw new Error('logical_height > height ' + id);
    t.brightness = ramp(t.ambientLight);
    return t;
  }

  // computeBrightnessByLightLevel (DimensionType.java:212-222)
  function ramp(amb) {
    var r = new Float32Array(16);
    for (var i = 0; i <= 15; i++) {
      var f = i / 15, v = f / (4 - 3 * f);
      r[i] = Math.fround(Math.fround(v) + Math.fround(amb) * (1 - Math.fround(v)));   // MathHelper.lerp(amb, v, 1)
    }
    return r;
  }

  Dim.OVERWORLD = 'overworld'; Dim.NETHER = 'the_nether'; Dim.END = 'the_end';
  Dim.types = {
    overworld:      make('overworld', 0,  [null,  true,  false, false, true,  1.0, false, false, true,  false, true,  -64, 384, 384, 'infiniburn_overworld', 'overworld', 0.0]),
    the_nether:     make('the_nether', -1, [18000, false, true,  true,  false, 8.0, false, true,  false, true,  false, 0,   256, 128, 'infiniburn_nether',    'the_nether', 0.1]),
    the_end:        make('the_end', 1,     [6000,  false, false, false, false, 1.0, true,  false, false, false, true,  0,   256, 256, 'infiniburn_end',       'the_end',    0.0]),
    // OVERWORLD_CAVES (DimensionType.java:88): overworld with has_ceiling true; only reachable via the registry.
    overworld_caves: make('overworld_caves', 0, [null, true, true, false, true, 1.0, false, false, true, false, true, -64, 384, 384, 'infiniburn_overworld', 'overworld', 0.0])
  };
  // DimensionOptions.OVERWORLD/NETHER/END (BASE_DIMENSIONS): dimension key -> type key. The chunk generator is
  // the engine's own worldgen per dimension (#254/c); the key -> type mapping is what this substrate owns.
  Dim.options = { overworld: 'overworld', the_nether: 'the_nether', the_end: 'the_end' };
  Dim.names = ['overworld', 'the_nether', 'the_end'];

  Dim.get = function (name) {
    var t = Dim.types[Dim.options[name] || name];
    if (!t) throw new Error('unknown dimension ' + name);
    return t;
  };
  Dim.current = function () { return Dim.get(Dim.cur); };
  Dim.has = function (name) { return !!Dim.options[name]; };
  /** Legacy numeric id (-1/0/1) -> key, or null. */
  Dim.byNumId = function (n) {
    for (var i = 0; i < Dim.names.length; i++) if (Dim.get(Dim.names[i]).numId === n) return Dim.names[i];
    return null;
  };
  /** DimensionType.getCoordinateScaleFactor (:286-290). */
  Dim.scaleFactor = function (from, to) { return Dim.get(from).coordinateScale / Dim.get(to).coordinateScale; };
  /** A saved/unknown name normalises to the overworld rather than throwing. */
  Dim.norm = function (name) { return (typeof name === 'string' && Dim.options[name]) ? name : 'overworld'; };
})(MCL);
