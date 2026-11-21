// NS.StructureClasses: net/minecraft/structure core classes (#11756). Cited (Yarn): StructureSetKeys StructureSets
//  StructureSet JigsawJunction StructurePiecesList StructurePiecesHolder.
// StructureSets is vanilla 1.18.2's registered table (.decomp StructureSets.java), kept as DATA so Structures.init can
// cross-check the structure_set JSON it loaded against it (a stray edit to spacing/separation/salt/spread is a ruling, not a typo).
// Boxes are {minX,minY,minZ,maxX,maxY,maxZ} (BlockBox). The per-structure Generator/Data classes are table-driven in 04t/04v/04w.
(function (NS) {
  'use strict';
  var K = NS.StructureClasses = {};
  var LIN = 'linear', TRI = 'triangular';
  function rs(spacing, sep, spread, salt, off) { return { type: 'random_spread', spacing: spacing, separation: sep, spread: spread, salt: salt, locateOffset: off || null }; }
  // key (StructureSetKeys id) -> { structures: [[name, weight]], placement }
  K.SETS = {
    villages: { structures: [['village_plains', 1], ['village_desert', 1], ['village_savanna', 1], ['village_snowy', 1], ['village_taiga', 1]], placement: rs(34, 8, LIN, 10387312) },
    desert_pyramids: { structures: [['desert_pyramid', 1]], placement: rs(32, 8, LIN, 14357617) },
    igloos: { structures: [['igloo', 1]], placement: rs(32, 8, LIN, 14357618) },
    jungle_temples: { structures: [['jungle_pyramid', 1]], placement: rs(32, 8, LIN, 14357619) },
    swamp_huts: { structures: [['swamp_hut', 1]], placement: rs(32, 8, LIN, 14357620) },
    pillager_outposts: { structures: [['pillager_outpost', 1]], placement: rs(32, 8, LIN, 165745296) },
    ocean_monuments: { structures: [['monument', 1]], placement: rs(32, 5, TRI, 10387313) },
    woodland_mansions: { structures: [['mansion', 1]], placement: rs(80, 20, TRI, 10387319) },
    buried_treasures: { structures: [['buried_treasure', 1]], placement: rs(1, 0, LIN, 0, [9, 0, 9]) },
    mineshafts: { structures: [['mineshaft', 1], ['mineshaft_mesa', 1]], placement: rs(1, 0, LIN, 0) },
    ruined_portals: { structures: [['ruined_portal', 1], ['ruined_portal_desert', 1], ['ruined_portal_jungle', 1], ['ruined_portal_swamp', 1], ['ruined_portal_mountain', 1], ['ruined_portal_ocean', 1], ['ruined_portal_nether', 1]], placement: rs(40, 15, LIN, 34222645) },
    shipwrecks: { structures: [['shipwreck', 1], ['shipwreck_beached', 1]], placement: rs(24, 4, LIN, 165745295) },
    ocean_ruins: { structures: [['ocean_ruin_cold', 1], ['ocean_ruin_warm', 1]], placement: rs(20, 8, LIN, 14357621) },
    nether_complexes: { structures: [['fortress', 2], ['bastion_remnant', 3]], placement: rs(27, 4, LIN, 30084232) },
    nether_fossils: { structures: [['nether_fossil', 1]], placement: rs(2, 1, LIN, 14357921) },
    end_cities: { structures: [['end_city', 1]], placement: rs(20, 11, TRI, 10387313) },
    strongholds: { structures: [['stronghold', 1]], placement: { type: 'concentric_rings', distance: 32, spread: 3, count: 128 } }
  };
  K.KEYS = Object.keys(K.SETS); // StructureSetKeys, in declaration order

  /** Compare Structures.sets (the loaded JSON) with the vanilla table. Returns a list of mismatch strings (empty = equal). */
  K.verifySets = function (sets) {
    var bad = [], seen = {}, i, j;
    for (i = 0; i < sets.length; i++) {
      var s = sets[i], v = K.SETS[s.name]; seen[s.name] = 1;
      if (!v) { bad.push(s.name + ': not a vanilla structure set'); continue; }
      var p = s.placement, q = v.placement;
      if (q.type === 'concentric_rings') {
        if (p.kind !== 'concentric_rings' || p.distance !== q.distance || p.spread !== q.spread || p.count !== q.count) bad.push(s.name + ': rings differ');
      } else {
        if (p.kind !== 'random_spread' || p.spacing !== q.spacing || p.separation !== q.separation || p.salt !== q.salt || p.spreadType !== q.spread) bad.push(s.name + ': spread/salt differ');
        var lo = q.locateOffset ? [q.locateOffset[0], q.locateOffset[2]] : [0, 0];
        if (p.locateOffset[0] !== lo[0] || p.locateOffset[1] !== lo[1]) bad.push(s.name + ': locate offset differs');
      }
      if (s.members.length !== v.structures.length) { bad.push(s.name + ': member count'); continue; }
      for (j = 0; j < v.structures.length; j++) {
        var m = s.members[j], nm = m.def && (m.def.name || m.def.id);
        if (nm !== v.structures[j][0] || m.weight !== v.structures[j][1]) bad.push(s.name + ': member ' + j + ' is ' + nm + 'x' + m.weight);
      }
    }
    for (i = 0; i < K.KEYS.length; i++) if (!seen[K.KEYS[i]]) bad.push(K.KEYS[i] + ': missing');
    return bad;
  };

  // JigsawJunction (StructurePool.Projection id: 'rigid' | 'terrain_matching'). equals ignores sourceGroundY, as vanilla does.
  K.JigsawJunction = function (sourceX, sourceGroundY, sourceZ, deltaY, destProjection) {
    return {
      sourceX: sourceX | 0, sourceGroundY: sourceGroundY | 0, sourceZ: sourceZ | 0, deltaY: deltaY | 0, destProjection: destProjection,
      getSourceX: function () { return this.sourceX; }, getSourceGroundY: function () { return this.sourceGroundY; },
      getSourceZ: function () { return this.sourceZ; }, getDeltaY: function () { return this.deltaY; }, getDestProjection: function () { return this.destProjection; },
      serialize: function () { return { source_x: this.sourceX, source_ground_y: this.sourceGroundY, source_z: this.sourceZ, delta_y: this.deltaY, dest_proj: this.destProjection }; },
      equals: function (o) { return !!o && this.sourceX === o.sourceX && this.sourceZ === o.sourceZ && this.deltaY === o.deltaY && this.destProjection === o.destProjection; },
      toString: function () { return 'JigsawJunction{sourceX=' + this.sourceX + ', sourceGroundY=' + this.sourceGroundY + ', sourceZ=' + this.sourceZ + ', deltaY=' + this.deltaY + ', destProjection=' + this.destProjection + '}'; }
    };
  };
  K.JigsawJunction.deserialize = function (d) {
    var g = function (k) { return d[k] === undefined ? 0 : d[k] | 0; };
    return K.JigsawJunction(g('source_x'), g('source_ground_y'), g('source_z'), g('delta_y'), d.dest_proj === undefined ? 'rigid' : d.dest_proj);
  };

  function boxContains(b, x, y, z) { return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && y >= b.minY && y <= b.maxY; }
  function boxIntersects(a, b) { return a.maxX >= b.minX && a.minX <= b.maxX && a.maxZ >= b.minZ && a.minZ <= b.maxZ && a.maxY >= b.minY && a.minY <= b.maxY; }
  K.boxContains = boxContains; K.boxIntersects = boxIntersects;

  // StructurePiecesList (a record over a copied list of pieces; each piece has .box).
  K.StructurePiecesList = function (pieces) {
    var list = pieces.slice();
    return {
      pieces: list,
      isEmpty: function () { return list.length === 0; },
      contains: function (x, y, z) { for (var i = 0; i < list.length; i++) if (boxContains(list[i].box, x, y, z)) return true; return false; },
      getBoundingBox: function () {
        if (!list.length) throw new Error('Pieces must not be empty');
        var r = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
        for (var i = 0; i < list.length; i++) { var b = list[i].box; r.minX = Math.min(r.minX, b.minX); r.minY = Math.min(r.minY, b.minY); r.minZ = Math.min(r.minZ, b.minZ); r.maxX = Math.max(r.maxX, b.maxX); r.maxY = Math.max(r.maxY, b.maxY); r.maxZ = Math.max(r.maxZ, b.maxZ); }
        return r;
      }
    };
  };

  // StructurePiecesHolder: addPiece + getIntersecting (first piece whose box meets the query, or null).
  K.StructurePiecesHolder = function () {
    var list = [];
    return {
      addPiece: function (p) { list.push(p); },
      getIntersecting: function (box) { for (var i = 0; i < list.length; i++) if (boxIntersects(list[i].box, box)) return list[i]; return null; },
      toList: function () { return K.StructurePiecesList(list); }
    };
  };
  // StructurePieceType (#11756): Registry.STRUCTURE_PIECE ids in registration order (.decomp StructurePieceType.java, lowercased).
  K.PIECE_TYPES = [
    'mscorridor', 'mscrossing', 'msroom', 'msstairs', 'nebcr', 'nebef', 'nebs', 'neccs', 'nectb', 'nece',
    'nescsc', 'nesclt', 'nesc', 'nescrt', 'necsr', 'nemt', 'nerc', 'nesr', 'nestart', 'shcc',
    'shfc', 'sh5c', 'shlt', 'shli', 'shpr', 'shph', 'shrt', 'shrc', 'shsd', 'shstart',
    'shs', 'shssd', 'tejp', 'orp', 'iglu', 'rupo', 'tesh', 'tedp', 'omb', 'omcr',
    'omdxr', 'omdxyr', 'omdyr', 'omdyzr', 'omdzr', 'omentry', 'ompenthouse', 'omsimple', 'omsimplet', 'omwr',
    'ecp', 'wmp', 'btp', 'shipwreck', 'nefos', 'jigsaw'
  ];
  K.StructurePieceType = {
    ids: K.PIECE_TYPES,
    has: function (id) { return K.PIECE_TYPES.indexOf(String(id).toLowerCase()) >= 0; },
    rawId: function (id) { return K.PIECE_TYPES.indexOf(String(id).toLowerCase()); },
    get: function (rawId) { return K.PIECE_TYPES[rawId] || null; }
  };
  // ShiftableStructurePiece (#11756): the two height adjusters (.decomp ShiftableStructurePiece.java). piece = {box, hPos (-1 unset)};
  // w = {topY, top(x, z)} with top the WORLD_SURFACE_WG height; clip = the chunk box the sample must lie in (columns tested at y 64).
  function moveBox(b, dy) { b.minY += dy; b.maxY += dy; }
  K.ShiftableStructurePiece = {
    adjustToAverageHeight: function (piece, w, clip, dy) {
      if (piece.hPos === undefined) piece.hPos = -1;
      if (piece.hPos >= 0) return true;
      var b = piece.box, sum = 0, n = 0;
      for (var z = b.minZ; z <= b.maxZ; z++) for (var x = b.minX; x <= b.maxX; x++) {
        if (x >= clip.minX && x <= clip.maxX && 64 >= clip.minY && 64 <= clip.maxY && z >= clip.minZ && z <= clip.maxZ) { sum += w.top(x, z); n++; }
      }
      if (n === 0) return false;
      piece.hPos = Math.trunc(sum / n);
      moveBox(b, piece.hPos - b.minY + dy);
      return true;
    },
    adjustToMinHeight: function (piece, w, dy) {
      if (piece.hPos === undefined) piece.hPos = -1;
      if (piece.hPos >= 0) return true;
      var b = piece.box, m = w.topY, any = false;
      for (var z = b.minZ; z <= b.maxZ; z++) for (var x = b.minX; x <= b.maxX; x++) { m = Math.min(m, w.top(x, z)); any = true; }
      if (!any) return false;
      piece.hPos = m;
      moveBox(b, piece.hPos - b.minY + dy);
      return true;
    }
  };
  // ShipwreckGenerator / IglooGenerator template tables (#11756; .decomp ShipwreckGenerator.java, IglooGenerator.java).
  var SW = ['with_mast', 'upsidedown_full', 'upsidedown_fronthalf', 'upsidedown_backhalf', 'sideways_full', 'sideways_fronthalf', 'sideways_backhalf', 'rightsideup_full', 'rightsideup_fronthalf', 'rightsideup_backhalf'];
  function swNames(list) { return list.map(function (n) { return 'shipwreck/' + n; }); }
  K.ShipwreckGenerator = {
    DEFAULT_POSITION: [4, 0, 15],
    REGULAR_TEMPLATES: swNames(SW.concat(SW.map(function (n) { return n + '_degraded'; }))),
    BEACHED_TEMPLATES: swNames(['with_mast', 'sideways_full', 'sideways_fronthalf', 'sideways_backhalf', 'rightsideup_full', 'rightsideup_fronthalf', 'rightsideup_backhalf',
      'with_mast_degraded', 'rightsideup_full_degraded', 'rightsideup_fronthalf_degraded', 'rightsideup_backhalf_degraded']),
    templates: function (beached) { return beached ? this.BEACHED_TEMPLATES : this.REGULAR_TEMPLATES; }
  };
  K.IglooGenerator = {
    OFFSET_Y: 90, TOP: 'igloo/top', MIDDLE: 'igloo/middle', BOTTOM: 'igloo/bottom',
    OFFSETS: { 'igloo/top': [3, 5, 5], 'igloo/middle': [1, 3, 1], 'igloo/bottom': [3, 6, 7] },
    OFFSETS_FROM_TOP: { 'igloo/top': [0, 0, 0], 'igloo/middle': [2, -3, 4], 'igloo/bottom': [0, -3, -2] }
  };
  // BuriedTreasureGenerator.Piece.generate (#11756; .decomp BuriedTreasureGenerator.java). w: {top(x,z), bottomY, get(x,y,z)->name, set(x,y,z,name)}.
  K.BuriedTreasureGenerator = {
    BASE: ['sandstone', 'stone', 'andesite', 'granite', 'diorite'],
    DIRS: [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]],
    generate: function (piece, w) {
      var b = piece.box, x = b.minX, z = b.minZ, y = w.top(x, z), self = this;
      function liq(n) { return n === 'water' || n === 'lava'; }
      function air(n) { return n === 'air' || n === 'cave_air' || n === 'void_air'; }
      for (; y > w.bottomY; y--) {
        var cur = w.get(x, y, z), below = w.get(x, y - 1, z);
        if (self.BASE.indexOf(below) < 0) continue;
        var fill = !air(cur) && !liq(cur) ? cur : 'sand';
        for (var i = 0; i < 6; i++) {
          var d = self.DIRS[i], nx = x + d[0], ny = y + d[1], nz = z + d[2], nb = w.get(nx, ny, nz);
          if (air(nb) || liq(nb)) {
            var nbb = w.get(nx, ny - 1, nz);
            w.set(nx, ny, nz, ((air(nbb) || liq(nbb)) && i !== 1) ? below : fill);
          }
        }
        piece.box = { minX: x, minY: y, minZ: z, maxX: x, maxY: y, maxZ: z };
        return [x, y, z];
      }
      return null;
    }
  };
  // SwampHutGenerator layout (#11756; .decomp SwampHutGenerator.java): size 7x7x9, hPos 64; fills are [x1,y1,z1,x2,y2,z2,block], then single blocks.
  K.SwampHutGenerator = {
    WIDTH: 7, HEIGHT: 7, DEPTH: 9, H_POS: 64,
    FILLS: [[1, 1, 1, 5, 1, 7, 'spruce_planks'], [1, 4, 2, 5, 4, 7, 'spruce_planks'], [2, 1, 0, 4, 1, 0, 'spruce_planks'], [2, 2, 2, 3, 3, 2, 'spruce_planks'],
      [1, 2, 3, 1, 3, 6, 'spruce_planks'], [5, 2, 3, 5, 3, 6, 'spruce_planks'], [2, 2, 7, 4, 3, 7, 'spruce_planks'],
      [1, 0, 2, 1, 3, 2, 'oak_log'], [5, 0, 2, 5, 3, 2, 'oak_log'], [1, 0, 7, 1, 3, 7, 'oak_log'], [5, 0, 7, 5, 3, 7, 'oak_log']],
    BLOCKS: [[2, 3, 2, 'oak_fence'], [3, 3, 7, 'oak_fence'], [1, 3, 4, 'air'], [5, 3, 4, 'air'], [5, 3, 5, 'air'], [1, 3, 5, 'potted_red_mushroom'],
      [3, 2, 6, 'crafting_table'], [4, 2, 6, 'cauldron'], [1, 2, 1, 'oak_fence'], [5, 2, 1, 'oak_fence']],
    WITCH_CAT_POS: [2, 2, 5], PILLARS: [[1, 2], [5, 2], [1, 7], [5, 7]]
  };
  // DesertTempleGenerator.generate (#11756; .decomp DesertTempleGenerator.java) as an ordered op list in piece-local coords:
  // ['fill', x1,y1,z1,x2,y2,z2, outlineBlock, insideBlock] (fillWithOutline), ['block', name, x,y,z], ['down', name, x,y,z] (fillDownwards),
  // ['chest', dirIndex, x,y,z] (addChest, per horizontal direction 0..3 = S,W,N,E, loot desert_pyramid). Stairs are 'sandstone_stairs[facing]'.
  K.DesertTempleGenerator = {
    WIDTH: 21, DEPTH: 21, HEIGHT: 15, H_POS: 64, LOOT: 'chests/desert_pyramid',
    ops: function () {
      var W = this.WIDTH, D = this.DEPTH, o = [], SS = 'sandstone', AIR = 'air', CUT = 'cut_sandstone', CH = 'chiseled_sandstone', OR = 'orange_terracotta';
      function F(a, b, c, d, e, f, g, h) { o.push(['fill', a, b, c, d, e, f, g, h]); }
      function B(n, x, y, z) { o.push(['block', n, x, y, z]); }
      var N = 'sandstone_stairs[north]', S = 'sandstone_stairs[south]', E = 'sandstone_stairs[east]', Wt = 'sandstone_stairs[west]', i, x, y, z;
      F(0, -4, 0, W - 1, 0, D - 1, SS, SS);
      for (i = 1; i <= 9; i++) { F(i, i, i, W - 1 - i, i, D - 1 - i, SS, SS); F(i + 1, i, i + 1, W - 2 - i, i, D - 2 - i, AIR, AIR); }
      for (x = 0; x < W; x++) for (z = 0; z < D; z++) o.push(['down', SS, x, -5, z]);
      F(0, 0, 0, 4, 9, 4, SS, AIR); F(1, 10, 1, 3, 10, 3, SS, SS);
      B(N, 2, 10, 0); B(S, 2, 10, 4); B(E, 0, 10, 2); B(Wt, 4, 10, 2);
      F(W - 5, 0, 0, W - 1, 9, 4, SS, AIR); F(W - 4, 10, 1, W - 2, 10, 3, SS, SS);
      B(N, W - 3, 10, 0); B(S, W - 3, 10, 4); B(E, W - 5, 10, 2); B(Wt, W - 1, 10, 2);
      F(8, 0, 0, 12, 4, 4, SS, AIR); F(9, 1, 0, 11, 3, 4, AIR, AIR);
      [[9, 1, 1], [9, 2, 1], [9, 3, 1], [10, 3, 1], [11, 3, 1], [11, 2, 1], [11, 1, 1]].forEach(function (p) { B(CUT, p[0], p[1], p[2]); });
      F(4, 1, 1, 8, 3, 3, SS, AIR); F(4, 1, 2, 8, 2, 2, AIR, AIR); F(12, 1, 1, 16, 3, 3, SS, AIR); F(12, 1, 2, 16, 2, 2, AIR, AIR);
      F(5, 4, 5, W - 6, 4, D - 6, SS, SS); F(9, 4, 9, 11, 4, 11, AIR, AIR);
      F(8, 1, 8, 8, 3, 8, CUT, CUT); F(12, 1, 8, 12, 3, 8, CUT, CUT); F(8, 1, 12, 8, 3, 12, CUT, CUT); F(12, 1, 12, 12, 3, 12, CUT, CUT);
      F(1, 1, 5, 4, 4, 11, SS, SS); F(W - 5, 1, 5, W - 2, 4, 11, SS, SS);
      F(6, 7, 9, 6, 7, 11, SS, SS); F(W - 7, 7, 9, W - 7, 7, 11, SS, SS);
      F(5, 5, 9, 5, 7, 11, CUT, CUT); F(W - 6, 5, 9, W - 6, 7, 11, CUT, CUT);
      B(AIR, 5, 5, 10); B(AIR, 5, 6, 10); B(AIR, 6, 6, 10); B(AIR, W - 6, 5, 10); B(AIR, W - 6, 6, 10); B(AIR, W - 7, 6, 10);
      F(2, 4, 4, 2, 6, 4, AIR, AIR); F(W - 3, 4, 4, W - 3, 6, 4, AIR, AIR);
      B(N, 2, 4, 5); B(N, 2, 3, 4); B(N, W - 3, 4, 5); B(N, W - 3, 3, 4);
      F(1, 1, 3, 2, 2, 3, SS, SS); F(W - 3, 1, 3, W - 2, 2, 3, SS, SS);
      B(SS, 1, 1, 2); B(SS, W - 2, 1, 2); B('sandstone_slab', 1, 2, 2); B('sandstone_slab', W - 2, 2, 2); B(Wt, 2, 1, 2); B(E, W - 3, 1, 2);
      F(4, 3, 5, 4, 3, 17, SS, SS); F(W - 5, 3, 5, W - 5, 3, 17, SS, SS);
      F(3, 1, 5, 4, 2, 16, AIR, AIR); F(W - 6, 1, 5, W - 5, 2, 16, AIR, AIR);
      for (i = 5; i <= 17; i += 2) { B(CUT, 4, 1, i); B(CH, 4, 2, i); B(CUT, W - 5, 1, i); B(CH, W - 5, 2, i); }
      [[10, 7], [10, 8], [9, 9], [11, 9], [8, 10], [12, 10], [7, 10], [13, 10], [9, 11], [11, 11], [10, 12], [10, 13]].forEach(function (p) { B(OR, p[0], 0, p[1]); });
      B('blue_terracotta', 10, 0, 10);
      // the wall crosses: column of [y, block] for x-edge (z 1..3) and for the z-edge (x-1..x+1)
      var COL = [[2, 'c', 'o', 'c'], [3, 'c', 'o', 'c'], [4, 'o', 'h', 'o'], [5, 'c', 'o', 'c'], [6, 'o', 'h', 'o'], [7, 'o', 'o', 'o'], [8, 'c', 'c', 'c']];
      function pick(k) { return k === 'c' ? CUT : k === 'o' ? OR : CH; }
      for (x = 0; x <= W - 1; x += W - 1) COL.forEach(function (r) { for (var k = 0; k < 3; k++) B(pick(r[1 + k]), x, r[0], 1 + k); });
      for (x = 2; x <= W - 3; x += W - 3 - 2) COL.forEach(function (r) { for (var k = 0; k < 3; k++) B(pick(r[1 + k]), x - 1 + k, r[0], 0); });
      F(8, 4, 0, 12, 6, 0, CUT, CUT); B(AIR, 8, 6, 0); B(AIR, 12, 6, 0); B(OR, 9, 5, 0); B(CH, 10, 5, 0); B(OR, 11, 5, 0);
      F(8, -14, 8, 12, -11, 12, CUT, CUT); F(8, -10, 8, 12, -10, 12, CH, CH); F(8, -9, 8, 12, -9, 12, CUT, CUT);
      F(8, -8, 8, 12, -1, 12, SS, SS); F(9, -11, 9, 11, -1, 11, AIR, AIR);
      B('stone_pressure_plate', 10, -11, 10); F(9, -13, 9, 11, -13, 11, 'tnt', AIR);
      B(AIR, 8, -11, 10); B(AIR, 8, -10, 10); B(CH, 7, -10, 10); B(CUT, 7, -11, 10);
      B(AIR, 12, -11, 10); B(AIR, 12, -10, 10); B(CH, 13, -10, 10); B(CUT, 13, -11, 10);
      B(AIR, 10, -11, 8); B(AIR, 10, -10, 8); B(CH, 10, -10, 7); B(CUT, 10, -11, 7);
      B(AIR, 10, -11, 12); B(AIR, 10, -10, 12); B(CH, 10, -10, 13); B(CUT, 10, -11, 13);
      // Direction.Type.HORIZONTAL order: north, east, south, west (getHorizontal 2,3,0,1); offsets x*2, z*2
      [[2, 0, -1], [3, 1, 0], [0, 0, 1], [1, -1, 0]].forEach(function (d) { o.push(['chest', d[0], 10 + d[1] * 2, -11, 10 + d[2] * 2]); });
      return o;
    },
    /** Apply the op list to a world adapter {set(x,y,z,name)}; boxes are clipped by `clip` ({minX..maxZ} in piece-local coords) or not at all. */
    apply: function (w, clip) {
      var ops = this.ops(), n = 0;
      function inClip(x, y, z) { return !clip || (x >= clip.minX && x <= clip.maxX && y >= clip.minY && y <= clip.maxY && z >= clip.minZ && z <= clip.maxZ); }
      ops.forEach(function (op) {
        var t = op[0], x, y, z;
        if (t === 'block') { if (inClip(op[2], op[3], op[4])) { w.set(op[2], op[3], op[4], op[1]); n++; } }
        else if (t === 'fill') {
          for (y = op[2]; y <= op[5]; y++) for (x = op[1]; x <= op[4]; x++) for (z = op[3]; z <= op[6]; z++) {
            if (!inClip(x, y, z)) continue;
            var edge = x === op[1] || x === op[4] || y === op[2] || y === op[5] || z === op[3] || z === op[6];
            w.set(x, y, z, edge ? op[7] : op[8]); n++;
          }
        } else if (t === 'down') { if (inClip(op[2], op[3], op[4])) { (w.down || w.set).call(w, op[2], op[3], op[4], op[1]); n++; } }
      });
      return n;
    }
  };
  // PostPlacementProcessor.EMPTY / StructureContext (#11756; .decomp PostPlacementProcessor.java, StructureContext.java).
  K.PostPlacementProcessor = { EMPTY: { afterPlace: function () {} }, of: function (fn) { return { afterPlace: fn }; } };
  K.StructureContext = function (resources, registries, structureManager) { return { resourceManager: resources, registryManager: registries, structureManager: structureManager }; };
  K.StructureContext.from = function (server) { return K.StructureContext(server.resourceManager, server.registryManager, server.structureManager); };
})(MCL);
