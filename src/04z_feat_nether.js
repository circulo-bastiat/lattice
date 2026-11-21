// 04z_feat_nether.js — the NETHER feature generators (PLAN G27d).
//
// Ports of 1.18.2's BasaltPillarFeature, BasaltColumnsFeature, DeltaFeature, ReplaceBlobsFeature
// (`netherrack_replace_blobs`), GlowstoneBlobFeature, WeepingVinesFeature, TwistingVinesFeature
// and NetherForestVegetationFeature, read from `.decomp/.../world/gen/feature/`. Same contract as
// 04p: `run` is called once per target chunk with an identically seeded rng, every rng draw is
// made in a fixed order BEFORE any block read can change what happens next, and every write goes
// through `A.setBlock` (clipped to the target). A read outside the target chunk is -1, which is
// "not air and not any block I look for", exactly as 04p treats it.
//
// ⚠ NOT VANILLA HERE: the random SEQUENCE (the project's `Rng` is not java.util.Random), and the
// visiting order inside one distance ring of `BlockPos.iterateOutwards`. The shapes, thresholds,
// counts and block rules are the decompiled ones.
(function (NS) {
  'use strict';

  var F = NS.Features;
  var A = F.api;

  var S = null;
  function states() {
    if (S) return S;
    var WG = NS.WG;
    function st(name, props) {
      return props && WG && WG.stateOf ? WG.stateOf({ Name: 'minecraft:' + name, Properties: props }) : A.stateOf(name);
    }
    S = {
      netherrack: A.stateOf('netherrack'), basalt: st('basalt', { axis: 'y' }), blackstone: A.stateOf('blackstone'),
      glowstone: A.stateOf('glowstone'), magma: A.stateOf('magma_block'), lava: st('lava', { level: '0' }),
      wartBlock: A.stateOf('nether_wart_block'), warpedWart: A.stateOf('warped_wart_block'),
      warpedNylium: A.stateOf('warped_nylium'), crimsonNylium: A.stateOf('crimson_nylium'),
      soulSand: A.stateOf('soul_sand'), soulSoil: A.stateOf('soul_soil'),
      weeping: function (age) { return st('weeping_vines', { age: String(age) }); },
      weepingPlant: A.stateOf('weeping_vines_plant'),
      twisting: function (age) { return st('twisting_vines', { age: String(age) }); },
      twistingPlant: A.stateOf('twisting_vines_plant'),
    };
    // keyed by BLOCK id, so stairs facing any way and fences in any state are all covered
    var names = ['bedrock', 'magma_block', 'soul_sand', 'nether_bricks', 'nether_brick_fence', 'nether_brick_stairs',
      'nether_wart', 'chest', 'spawner'];
    S.noColumn = {}; S.noDelta = {};
    names.forEach(function (n) {
      var id = NS.Reg.id[n];
      S.noColumn[id] = 1;
      if (n !== 'magma_block' && n !== 'soul_sand') S.noDelta[id] = 1;
    });
    S.lavaBlock = NS.Reg.id.lava;
    return S;
  }

  function nextInt2(r, lo, hi) { return lo + r.nextInt(hi - lo + 1); }       // MathHelper.nextInt
  var DIRS = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];   // DOWN UP N S W E

  /** Cells of the box ordered by increasing Manhattan distance from its centre, like iterateOutwards. */
  function outwards(rx, ry, rz, maxD) {
    var out = [];
    for (var dy = -ry; dy <= ry; dy++) for (var dz = -rz; dz <= rz; dz++) for (var dx = -rx; dx <= rx; dx++) {
      var d = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
      if (d <= maxD) out.push([d, dx, dy, dz]);
    }
    out.sort(function (a, b) { return a[0] - b[0]; });
    return out;
  }

  // ── BASALT PILLAR ──────────────────────────────────────────────────────────────────────────
  F.register('basalt_pillar', function (cfg, name) {
    return {
      kind: 'basalt_pillar', name: name, reach: 8,
      run: function (SB, cx, cz, x, y, z, r) {
        var B = states().basalt, n = 0;
        function air(px, py, pz) { return A.getBlock(SB, cx, cz, px, py, pz) === 0; }
        function put(px, py, pz) { n += A.setBlock(SB, cx, cz, px, py, pz, B); }
        if (!air(x, y, z) || air(x, y + 1, z)) return 0;
        var go = [true, true, true, true], cy = y, sides = [[0, -1], [0, 1], [-1, 0], [1, 0]], i;
        // the pillar falls to the floor; each side keeps spreading while a 9-in-10 roll holds
        while (air(x, cy, z)) {
          if (cy <= A.MINY) return n;
          put(x, cy, z);
          for (i = 0; i < 4; i++) {
            if (!go[i]) continue;
            if (r.nextInt(10) !== 0) { put(x + sides[i][0], cy, z + sides[i][1]); } else go[i] = false;
          }
          cy--;
        }
        cy++;
        for (i = 0; i < 4; i++) if (r.nextFloat() < 0.5) put(x + sides[i][0], cy, z + sides[i][1]);
        cy--;
        for (var dx = -3; dx < 4; dx++) for (var dz = -3; dz < 4; dz++) {
          var k = Math.abs(dx) * Math.abs(dz);
          if (r.nextInt(10) < 10 - k) {
            var py = cy, left = 3;
            while (air(x + dx, py - 1, z + dz)) { py--; if (--left <= 0) break; }
            if (!air(x + dx, py - 1, z + dz)) put(x + dx, py, z + dz);
          }
        }
        return n;
      },
    };
  });

  // ── BASALT COLUMNS ─────────────────────────────────────────────────────────────────────────
  F.register('basalt_columns', function (cfg, name) {
    var reachP = A.intProvider(cfg.reach, name + '.reach'), heightP = A.intProvider(cfg.height, name + '.height');
    return {
      kind: 'basalt_columns', name: name, reach: 24,
      run: function (SB, cx, cz, x, y, z, r) {
        var SS = states(), sea = F.G.params.seaLevel, B = SS.basalt;
        function blk(px, py, pz) { return A.getBlock(SB, cx, cz, px, py, pz); }
        function airOrLava(px, py, pz) { var b = blk(px, py, pz); return b === 0 || (b > 0 && NS.States.block[b] === SS.lavaBlock && py <= sea); }
        function canPlaceAt(px, py, pz) {
          if (!airOrLava(px, py, pz)) return false;
          var b = blk(px, py - 1, pz);
          return b > 0 && !SS.noColumn[NS.States.block[b]];
        }
        if (!canPlaceAt(x, y, z)) return 0;
        var height = heightP(r), small = r.nextFloat() < 0.9;
        var span = Math.min(height, small ? 5 : 8), tries = small ? 50 : 15, n = 0;
        function column(px, py, pz, h, reach) {
          var any = false;
          for (var qx = px - reach; qx <= px + reach; qx++) for (var qz = pz - reach; qz <= pz + reach; qz++) {
            var d = Math.abs(qx - px) + Math.abs(qz - pz), cy = null, lim = d, yy = py;
            if (airOrLava(qx, py, qz)) {
              while (yy > A.MINY + 1 && lim > 0) { lim--; if (canPlaceAt(qx, yy, qz)) { cy = yy; break; } yy--; }
            } else {
              while (yy < A.MAXY && lim > 0) {
                lim--;
                var b = blk(qx, yy, qz);
                if (b > 0 && SS.noColumn[NS.States.block[b]]) break;
                if (b === 0) { cy = yy; break; }
                yy++;
              }
            }
            if (cy === null) continue;
            var left = h - (d >> 1), wy = cy;
            for (; left >= 0; left--) {
              if (airOrLava(qx, wy, qz)) { n += A.setBlock(SB, cx, cz, qx, wy, qz, B); wy++; any = true; }
              else if (blk(qx, wy, qz) === B) wy++;
              else break;
            }
          }
          return any;
        }
        for (var i = 0; i < tries; i++) {
          var px = x - span + r.nextInt(2 * span + 1), pz = z - span + r.nextInt(2 * span + 1);
          var h = height - (Math.abs(px - x) + Math.abs(pz - z)), reach = reachP(r);
          if (h >= 0) column(px, y, pz, h, reach);
        }
        return n;
      },
    };
  });

  // ── DELTA ──────────────────────────────────────────────────────────────────────────────────
  F.register('delta_feature', function (cfg, name) {
    var contents = A.stateProvider({ type: 'simple_state_provider', state: cfg.contents }, name + '.contents')();
    var rim = A.stateProvider({ type: 'simple_state_provider', state: cfg.rim }, name + '.rim')();
    var sizeP = A.intProvider(cfg.size, name + '.size'), rimP = A.intProvider(cfg.rim_size, name + '.rim_size');
    return {
      kind: 'delta_feature', name: name, reach: 16,
      run: function (SB, cx, cz, x, y, z, r) {
        var SS = states(), n = 0;
        function canPlace(px, py, pz) {
          var b = A.getBlock(SB, cx, cz, px, py, pz);
          if (b === contents || (b > 0 && SS.noDelta[NS.States.block[b]])) return false;
          for (var i = 0; i < 6; i++) {
            var air = A.getBlock(SB, cx, cz, px + DIRS[i][0], py + DIRS[i][1], pz + DIRS[i][2]) === 0;
            if ((air && i !== 1) || (!air && i === 1)) return false;
          }
          return true;
        }
        var rimmed = r.nextFloat() < 0.9;
        var rx = rimmed ? rimP(r) : 0, rz = rimmed ? rimP(r) : 0;
        var useRim = rimmed && rx !== 0 && rz !== 0;
        var sx = sizeP(r), sz = sizeP(r), cells = outwards(sx, 0, sz, Math.max(sx, sz));
        for (var i = 0; i < cells.length; i++) {
          var px = x + cells[i][1], pz = z + cells[i][3];
          if (!canPlace(px, y, pz)) continue;
          if (useRim) n += A.setBlock(SB, cx, cz, px, y, pz, rim);
          if (canPlace(px + rx, y, pz + rz)) n += A.setBlock(SB, cx, cz, px + rx, y, pz + rz, contents);
        }
        return n;
      },
    };
  });

  // ── NETHERRACK REPLACE BLOBS (basalt_blobs, blackstone_blobs) ──────────────────────────────
  F.register('netherrack_replace_blobs', function (cfg, name) {
    var target = A.stateProvider({ type: 'simple_state_provider', state: cfg.target }, name + '.target')();
    var state = A.stateProvider({ type: 'simple_state_provider', state: cfg.state }, name + '.state')();
    var radP = A.intProvider(cfg.radius, name + '.radius');
    return {
      kind: 'netherrack_replace_blobs', name: name, reach: 8,
      run: function (SB, cx, cz, x, y, z, r) {
        var a = radP(r), b = radP(r), c = radP(r), m = Math.max(a, b, c);
        // vanilla walks DOWN from the origin to the first netherrack; the column below is the
        // target chunk's own business, so the walk is a read like any other
        var py = Math.min(Math.max(y, A.MINY + 1), A.MAXY - 1), found = false;
        for (; py > A.MINY + 1; py--) if (A.getBlock(SB, cx, cz, x, py, z) === target) { found = true; break; }
        if (!found) return 0;
        var cells = outwards(a, b, c, m), n = 0;
        for (var i = 0; i < cells.length; i++) {
          var qx = x + cells[i][1], qy = py + cells[i][2], qz = z + cells[i][3];
          if (A.getBlock(SB, cx, cz, qx, qy, qz) === target) n += A.setBlock(SB, cx, cz, qx, qy, qz, state);
        }
        return n;
      },
    };
  });

  // ── GLOWSTONE BLOB ─────────────────────────────────────────────────────────────────────────
  F.register('glowstone_blob', function (cfg, name) {
    return {
      kind: 'glowstone_blob', name: name, reach: 8,
      run: function (SB, cx, cz, x, y, z, r) {
        var SS = states(), G = SS.glowstone, n = 0;
        var up = A.getBlock(SB, cx, cz, x, y + 1, z);
        if (A.getBlock(SB, cx, cz, x, y, z) !== 0) return 0;
        if (up !== SS.netherrack && up !== SS.basalt && up !== SS.blackstone) return 0;
        n += A.setBlock(SB, cx, cz, x, y, z, G);
        for (var i = 0; i < 1500; i++) {
          var px = x + r.nextInt(8) - r.nextInt(8), py = y - r.nextInt(12), pz = z + r.nextInt(8) - r.nextInt(8);
          if (A.getBlock(SB, cx, cz, px, py, pz) !== 0) continue;
          var k = 0;
          for (var d = 0; d < 6 && k <= 1; d++) {
            if (A.getBlock(SB, cx, cz, px + DIRS[d][0], py + DIRS[d][1], pz + DIRS[d][2]) === G) k++;
          }
          if (k === 1) n += A.setBlock(SB, cx, cz, px, py, pz, G);
        }
        return n;
      },
    };
  });

  // ── VINES (weeping, twisting) ──────────────────────────────────────────────────────────────
  function vineLength(r, max) {
    var len = nextInt2(r, 1, max);
    if (r.nextInt(6) === 0) len *= 2;
    if (r.nextInt(5) === 0) len = 1;
    return len;
  }

  F.register('weeping_vines', function (cfg, name) {
    return {
      kind: 'weeping_vines', name: name, reach: 8,
      run: function (SB, cx, cz, x, y, z, r) {
        var SS = states(), W = SS.wartBlock, n = 0, i, d;
        function blk(px, py, pz) { return A.getBlock(SB, cx, cz, px, py, pz); }
        function put(px, py, pz, s) { n += A.setBlock(SB, cx, cz, px, py, pz, s); }
        if (blk(x, y, z) !== 0) return 0;
        var up = blk(x, y + 1, z);
        if (up !== SS.netherrack && up !== W) return 0;
        put(x, y, z, W);
        for (i = 0; i < 200; i++) {
          var px = x + r.nextInt(6) - r.nextInt(6), py = y + r.nextInt(2) - r.nextInt(5), pz = z + r.nextInt(6) - r.nextInt(6);
          if (blk(px, py, pz) !== 0) continue;
          var k = 0;
          for (d = 0; d < 6 && k <= 1; d++) {
            var b = blk(px + DIRS[d][0], py + DIRS[d][1], pz + DIRS[d][2]);
            if (b === SS.netherrack || b === W) k++;
          }
          if (k === 1) put(px, py, pz, W);
        }
        for (i = 0; i < 100; i++) {
          var vx = x + r.nextInt(8) - r.nextInt(8), vy = y + r.nextInt(2) - r.nextInt(7), vz = z + r.nextInt(8) - r.nextInt(8);
          if (blk(vx, vy, vz) !== 0) continue;
          var a = blk(vx, vy + 1, vz);
          if (a !== SS.netherrack && a !== W) continue;
          var len = vineLength(r, 8), age = nextInt2(r, 17, 25);
          for (var j = 0; j <= len; j++, vy--) {
            if (blk(vx, vy, vz) === 0) {
              if (j === len || blk(vx, vy - 1, vz) !== 0) { put(vx, vy, vz, SS.weeping(age)); break; }
              put(vx, vy, vz, SS.weepingPlant);
            }
          }
        }
        return n;
      },
    };
  });

  F.register('twisting_vines', function (cfg, name) {
    var sw = cfg.spread_width | 0, sh = cfg.spread_height | 0, mh = cfg.max_height | 0;
    return {
      kind: 'twisting_vines', name: name, reach: sw + 2,
      run: function (SB, cx, cz, x, y, z, r) {
        var SS = states(), n = 0;
        function blk(px, py, pz) { return A.getBlock(SB, cx, cz, px, py, pz); }
        function unsuitable(px, py, pz) {
          if (blk(px, py, pz) !== 0) return true;
          var b = blk(px, py - 1, pz);
          return b !== SS.netherrack && b !== SS.warpedNylium && b !== SS.warpedWart;
        }
        if (unsuitable(x, y, z)) return 0;
        for (var i = 0; i < sw * sw; i++) {
          var px = x + nextInt2(r, -sw, sw), py = y + nextInt2(r, -sh, sh), pz = z + nextInt2(r, -sw, sw);
          // canGenerate: walk down through air to the ground, stand on top of it
          var ok = false;
          for (var yy = py - 1; yy > A.MINY; yy--) {
            if (blk(px, yy, pz) !== 0) { py = yy + 1; ok = true; break; }
            if (blk(px, yy, pz) === -1) break;
          }
          var len = vineLength(r, mh), age = nextInt2(r, 17, 25);     // fixed draws, as 04p demands
          if (!ok || unsuitable(px, py, pz)) continue;
          for (var j = 1; j <= len; j++, py++) {
            if (blk(px, py, pz) === 0) {
              if (j === len || blk(px, py + 1, pz) !== 0) { n += A.setBlock(SB, cx, cz, px, py, pz, SS.twisting(age)); break; }
              n += A.setBlock(SB, cx, cz, px, py, pz, SS.twistingPlant);
            }
          }
        }
        return n;
      },
    };
  });

  // ── HUGE FUNGUS ────────────────────────────────────────────────────────────────────────────
  // HugeFungusFeature. ⚠ Every draw is made whether or not the block read that gates it passes
  // (04p's contract): vanilla draws only inside the branch, so the SEQUENCE differs, the shape
  // rules do not. `Material.PLANT` is approximated by the two fungi (no material table here).
  F.register('huge_fungus', function (cfg, name) {
    var SRg = NS.States, WG = NS.WG;
    function node(n) { return WG.stateOf(n); }
    var base = null, stem = null, hat = null, decor = null;
    function cfgStates() {
      if (base !== null) return;
      base = node(cfg.valid_base_block); stem = node(cfg.stem_state); hat = node(cfg.hat_state); decor = node(cfg.decor_state);
    }
    var planted = !!cfg.planted;
    return {
      kind: 'huge_fungus', name: name, reach: 6,
      run: function (SB, cx, cz, x, y, z, r) {
        cfgStates();
        var SS = states(), n = 0;
        function blk(px, py, pz) { return A.getBlock(SB, cx, cz, px, py, pz); }
        function put(px, py, pz, s) { n += A.setBlock(SB, cx, cz, px, py, pz, s); }
        function repl(px, py, pz, plants) {
          var b = blk(px, py, pz);
          if (b < 0) return false;
          if (b === 0 || SRg.replaceable[b]) return true;
          if (!plants) return false;
          var nm = NS.Reg.names[SRg.block[b]];
          return nm === 'crimson_fungus' || nm === 'warped_fungus';
        }
        var floor = blk(x, y - 1, z);
        if (floor < 0 || SRg.block[floor] !== SRg.block[base]) return 0;
        var h = nextInt2(r, 4, 13);
        if (r.nextInt(12) === 0) h *= 2;
        if (!planted && y + h + 1 >= A.MAXY) return 0;
        var big = !planted && r.nextFloat() < 0.06;
        put(x, y, z, 0);
        var i, j, k;
        // stem
        var e = big ? 1 : 0;
        for (i = -e; i <= e; i++) for (k = -e; k <= e; k++) {
          var corner = big && Math.abs(i) === e && Math.abs(k) === e;
          for (j = 0; j < h; j++) {
            var thin = r.nextFloat() < 0.1;
            if (!repl(x + i, y + j, z + k, true)) continue;
            if (planted) {
              put(x + i, y + j, z + k, stem);
            } else if (corner) {
              if (thin) put(x + i, y + j, z + k, stem);
            } else put(x + i, y + j, z + k, stem);
          }
        }
        // hat
        var isWart = SRg.block[hat] === NS.Reg.id.nether_wart_block;
        function vines(px, py, pz) {      // generateVines: a weeping column starting under (px,py,pz)
          var len = nextInt2(r, 1, 5); if (r.nextInt(7) === 0) len *= 2;
          var ages = [], q; for (q = 0; q <= len; q++) ages.push(nextInt2(r, 23, 25));
          var vy = py - 1;
          if (blk(px, vy, pz) !== 0) return;
          for (q = 0; q <= len; q++, vy--) {
            if (blk(px, vy, pz) === 0) {
              if (q === len || blk(px, vy - 1, pz) !== 0) { put(px, vy, pz, SS.weeping(ages[q])); break; }
              put(px, vy, pz, SS.weepingPlant);
            }
          }
        }
        function hatBlock(px, py, pz, pDecor, pHat, pVine) {
          var a = r.nextFloat() < pDecor, b = r.nextFloat() < pHat, c = r.nextFloat() < pVine;
          if (a) put(px, py, pz, decor);
          else if (b) { put(px, py, pz, hat); if (c) vines(px, py, pz); }
        }
        var hh = Math.min(r.nextInt(1 + ((h / 3) | 0)) + 5, h), h0 = h - hh;
        for (var ly = h0; ly <= h; ly++) {
          var rad = ly < h - r.nextInt(3) ? 2 : 1;
          if (hh > 8 && ly < h0 + 4) rad = 3;
          if (big) rad++;
          for (i = -rad; i <= rad; i++) for (k = -rad; k <= rad; k++) {
            var ei = i === -rad || i === rad, ek = k === -rad || k === rad;
            var inner = !ei && !ek && ly !== h, cor = ei && ek, low = ly < h0 + 3;
            var px = x + i, py = y + ly, pz = z + k;
            var t1 = r.nextFloat(), t2 = r.nextInt(11);
            if (!repl(px, py, pz, false)) continue;
            if (low) {
              if (!inner) {      // tryGenerateVines
                if (blk(px, py - 1, pz) >= 0 && SRg.block[blk(px, py - 1, pz)] === SRg.block[hat]) put(px, py, pz, hat);
                else if (t1 < 0.15) { put(px, py, pz, hat); if (isWart && t2 === 0) vines(px, py, pz); }
              }
            } else if (inner) hatBlock(px, py, pz, 0.1, 0.2, isWart ? 0.1 : 0);
            else if (cor) hatBlock(px, py, pz, 0.01, 0.7, isWart ? 0.083 : 0);
            else hatBlock(px, py, pz, 5.0E-4, 0.98, isWart ? 0.07 : 0);
          }
        }
        return n;
      },
    };
  });

  // ── NETHER FOREST VEGETATION ───────────────────────────────────────────────────────────────
  F.register('nether_forest_vegetation', function (cfg, name) {
    var prov = A.stateProvider(cfg.state_provider, name + '.state_provider');
    var sw = cfg.spread_width | 0, sh = cfg.spread_height | 0;
    var soil = null;
    function soils() {
      if (soil) return soil;
      soil = {};
      ['crimson_nylium', 'warped_nylium', 'soul_soil', 'dirt', 'grass_block', 'coarse_dirt', 'podzol', 'rooted_dirt',
        'moss_block', 'mycelium', 'farmland'].forEach(function (n) { soil[A.stateOf(n)] = 1; });
      return soil;
    }
    return {
      kind: 'nether_forest_vegetation', name: name, reach: sw,
      run: function (SB, cx, cz, x, y, z, r) {
        var SS = states(), floor = A.getBlock(SB, cx, cz, x, y - 1, z), n = 0;
        if (floor !== SS.crimsonNylium && floor !== SS.warpedNylium) return 0;
        for (var i = 0; i < sw * sw; i++) {
          var px = x + r.nextInt(sw) - r.nextInt(sw), py = y + r.nextInt(sh) - r.nextInt(sh), pz = z + r.nextInt(sw) - r.nextInt(sw);
          var st = prov(r, px, py, pz);
          if (A.getBlock(SB, cx, cz, px, py, pz) === 0 && py > A.MINY && soils()[A.getBlock(SB, cx, cz, px, py - 1, pz)]) {
            n += A.setBlock(SB, cx, cz, px, py, pz, st);
          }
        }
        return n;
      },
    };
  });

})(MCL);
