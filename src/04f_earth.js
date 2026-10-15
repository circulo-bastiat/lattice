// 04f_earth.js — the physical climate model. PLAN W4, the other half of the toggle.
// Runs on: main thread AND workers. No DOM.
//
// ── WHAT THIS REPLACES, AND WHAT IT DOES NOT (D-115) ─────────────────────────────────────
// Vanilla's `temperature` and `humidity` are two Perlin stacks. They are not temperature and
// humidity; they are two more noise fields, and the reason a desert can sit next to a taiga in
// vanilla is that nothing in the generator knows which way is north.
//
// This module computes an actual climate — latitude, an ITCZ, subtropical highs, a lapse rate
// and a rain shadow — and then hands the result back as the SAME two axes, so that the biome
// that gets chosen is still chosen by vanilla's 7,578-entry table in `04e_climate.js`. That
// split matters:
//
//   * WHERE a biome goes is worldgen, where CLAUDE.md licenses deviation. This file.
//   * WHICH biomes exist, and what each one contains, is "everything else", which gets
//     absolute parity. Untouched — the dispatch is vanilla's either way.
//
// The other four axes — continentalness, erosion, weirdness, depth — are terrain SHAPE, not
// climate, and pass through from W3 unchanged in both modes. So Earth mode does not move a
// single ocean, river, cliff or mountain. It decides whether the mountain has a glacier on it.
//
// ── THE MODEL, AND WHERE EACH NUMBER COMES FROM ──────────────────────────────────────────
// Every table below is Earth's real zonal-mean climate, not a shape someone liked. They are
// short because zonal means genuinely are smooth.
//
//   latitude      z is north-south. The world folds at the poles the way a sphere does:
//                 walking north past 90 degrees starts you south again, so the latitude
//                 function is a triangle wave of period 4x the world scale rather than a clamp.
//                 A clamp would give an ice sheet with no far side.
//   temperature   the zonal-mean annual surface air temperature table, +26.5 C at the equator
//                 to -25 C at the pole, then a LAPSE RATE of 6.5 C/km applied to the column's
//                 own height — which is the term that puts a glacier on a mountain and is
//                 exactly what vanilla cannot do, because vanilla's temperature does not vary
//                 with height at all (`y_scale: 0`, see 04e's note).
//   precipitation the zonal-mean annual profile, which has the ITCZ's peak at the equator, the
//                 SUBTROPICAL HIGHS' minimum near 25 degrees — that is the latitude of the
//                 Sahara, the Kalahari, the Atacama and the Australian interior, and it falls
//                 out of the table rather than being placed — a mid-latitude storm-track rise
//                 near 45, and a polar desert at the pole.
//   continentality  vanilla's `continentalness` already says how far inland this is, so it is
//                 reused: oceans and coasts wetter, deep interiors drier.
//   rain shadow   precipitation is reduced downwind of high ground and raised on the windward
//                 slope, with the wind direction taken from the three-cell circulation
//                 (easterly trades, mid-latitude westerlies, polar easterlies).
//
// ── THE WHITTAKER LOOKUP ─────────────────────────────────────────────────────────────────
// (temperature, precipitation) does not map to a biome directly, because 400 mm is a desert at
// 30 C and a forest at 0 C — the Whittaker diagram's whole point. So precipitation is turned
// into an ARIDITY INDEX, P / PET, where PET is potential evapotranspiration estimated from
// temperature. That single division is what makes the diagram separable, and it is why the two
// axes below can be independent piecewise-linear tables instead of a 2D grid.
//
// The tables are anchored on VANILLA'S OWN BAND EDGES — the temperature axis cuts at
// -0.45/-0.15/0.2/0.55 and the humidity axis cuts at -0.35/-0.1/0.1/0.3, which are the five
// bands `OverworldBiomeBuilder` reasons in. Anchoring there is what makes the mapping legible:
// "T = 5 C is the bottom of vanilla's temperate band" is a sentence you can check.
//
(function (NS) {
  'use strict';

  var E = NS.Earth = {};

  E.ready = false;

  // ── settings ────────────────────────────────────────────────────────────────────────────
  // Blocks from the equator to the pole. A world-creation setting (D-111): it is the one knob
  // that changes what the whole map looks like, and it cannot change after the world exists
  // without moving every biome, so it is stored with the seed.
  E.DEFAULT_SCALE = 12000;
  E.MIN_SCALE = 1000;
  E.MAX_SCALE = 2000000;
  E.scale = E.DEFAULT_SCALE;

  // How much of vanilla's noise survives, as a fraction of the axis. Zero would give
  // perfectly straight latitude bands, which reads as a stripe pattern rather than a world;
  // this keeps local variety without letting a jungle appear at 60 degrees.
  E.TEMP_NOISE = 0.10;
  E.HUMID_NOISE = 0.16;

  var seaLevel = 63;

  /**
   * init(opts) — `opts.scale` blocks equator-to-pole, `opts.seaLevel`. Called once per thread,
   * after `Column.init`, because the rain shadow asks the column function for heights.
   */
  E.init = function (opts) {
    var o = opts || {};
    var s = o.scale === undefined ? E.DEFAULT_SCALE : +o.scale;
    if (!(s >= E.MIN_SCALE && s <= E.MAX_SCALE)) throw new Error('world scale ' + s + ' outside ' + E.MIN_SCALE + '..' + E.MAX_SCALE);
    E.scale = s;
    seaLevel = (NS.Column && NS.Column.ready) ? NS.Column.seaLevel : (o.seaLevel || 63);
    memoX = 0x7fffffff; memoZ = 0x7fffffff;
    E.ready = true;
    return E;
  };

  // ── latitude ────────────────────────────────────────────────────────────────────────────
  //
  // A triangle wave, not a clamp. `u = z / scale` counts poles: u = 0 is the equator, u = 1 the
  // south pole, u = 2 the equator again on the far side, u = 3 the north pole. Folding it back
  // into -1..1 is what a great circle does.
  //
  // North is -z, because Minecraft's F3 screen calls -z north and a compass that disagrees with
  // the game is worse than no compass.

  /** latitudeAt(z) -> degrees, +90 at the north pole, -90 at the south. */
  E.latitudeAt = function (z) {
    var u = -z / E.scale;                 // north positive
    u = u - 4 * Math.floor((u + 2) / 4);  // fold into [-2, 2)
    if (u > 1) u = 2 - u;                 // past the north pole, coming back down
    else if (u < -1) u = -2 - u;          // past the south pole
    return u * 90;
  };

  /** The z coordinate of a latitude on the strip containing the origin. For tests and the HUD. */
  E.zOfLatitude = function (deg) { return -(deg / 90) * E.scale; };

  // ── the zonal tables ────────────────────────────────────────────────────────────────────
  //
  // |latitude| in degrees -> the annual zonal mean. Linear between the listed points; the ends
  // are the ends. Both are symmetric about the equator, which the real ones very nearly are.

  // Annual mean surface air temperature, degrees C, at sea level.
  var T_ZONAL = [
    [0, 26.5], [10, 26.5], [20, 25.0], [30, 20.5], [40, 14.5],
    [50, 7.5], [60, -1.0], [70, -10.0], [80, -18.0], [90, -25.0],
  ];

  // Annual mean precipitation, mm. The double hump IS the general circulation: the ITCZ's
  // rising branch at the equator, the descending branch of the Hadley cell at 20-30 (every
  // major hot desert on Earth), the mid-latitude storm track at 45, the polar desert at 90.
  var P_ZONAL = [
    [0, 2050], [10, 1700], [20, 800], [25, 480], [30, 450],
    [35, 600], [45, 850], [55, 780], [65, 500], [75, 300], [90, 150],
  ];

  function lerpTable(tab, k) {
    if (k <= tab[0][0]) return tab[0][1];
    var n = tab.length;
    if (k >= tab[n - 1][0]) return tab[n - 1][1];
    for (var i = 1; i < n; i++) {
      if (k <= tab[i][0]) {
        var t = (k - tab[i - 1][0]) / (tab[i][0] - tab[i - 1][0]);
        return tab[i - 1][1] + t * (tab[i][1] - tab[i - 1][1]);
      }
    }
    return tab[n - 1][1];
  }
  E.lerpTable = lerpTable;
  E.T_ZONAL = T_ZONAL;
  E.P_ZONAL = P_ZONAL;

  /** Sea-level annual mean temperature at a latitude, degrees C, before any local term. */
  E.zonalTemp = function (latDeg) { return lerpTable(T_ZONAL, Math.abs(latDeg)); };
  /** Annual mean precipitation at a latitude, mm, before any local term. */
  E.zonalPrecip = function (latDeg) { return lerpTable(P_ZONAL, Math.abs(latDeg)); };

  // ── the lapse rate ──────────────────────────────────────────────────────────────────────
  // 6.5 C per 1000 m, the international standard atmosphere's environmental lapse rate. One
  // block is one metre. Only ground above sea level cools; the depth axis handles below.
  E.LAPSE_PER_BLOCK = 0.0065;

  // ── the three-cell circulation ──────────────────────────────────────────────────────────
  //
  // Which way the wind blows, as a unit vector in (east, south) — Minecraft's +x and +z.
  // Trade winds blow from the east and toward the equator; the westerlies from the west and
  // toward the pole; the polar easterlies from the east and toward the equator again. The
  // meridional component flips sign across the equator, which is what makes the two
  // hemispheres mirror rather than repeat.
  var windEast = 0, windSouth = 0;
  function windAt(latDeg) {
    var a = Math.abs(latDeg);
    var hemi = latDeg >= 0 ? 1 : -1;      // +1 north
    var e, m;                             // east component, poleward component
    if (a < 30) { e = -1; m = -1; }       // trades: toward the west and toward the equator
    else if (a < 60) { e = 1; m = 1; }    // westerlies: toward the east and toward the pole
    else { e = -1; m = -1; }              // polar easterlies
    // meridional: +1 poleward. North is -z, so poleward in the north is -z.
    var south = -m * hemi;
    var inv = 1 / Math.sqrt(e * e + south * south);
    windEast = e * inv;
    windSouth = south * inv;
  }
  /** The wind direction at a latitude, as [east, south]. Exposed for the check and the HUD. */
  E.windAt = function (latDeg) { windAt(latDeg); return [windEast, windSouth]; };

  // Upwind sample distances, in blocks. Two, not five: each one costs a full column evaluation
  // (the noise stack plus three splines), and the whole per-column climate is memoised below so
  // this is paid once per column rather than once per quart-y.
  var SHADOW_NEAR = 96, SHADOW_FAR = 288;
  // A ridge this much higher than here, upwind, halves the rain that reaches here.
  E.SHADOW_HALF_RISE = 220;
  // A windward slope this steep over SHADOW_NEAR doubles it.
  E.OROGRAPHIC_FULL_RISE = 140;

  // ── continentality ──────────────────────────────────────────────────────────────────────
  // Vanilla's continentalness runs about -1.2 (deep ocean) to +1 (deep inland). Ocean air is
  // saturated and coasts are wet; the middle of a continent is not. This is the multiplier.
  //
  // ⚠ The zonal table above is a mean over ALL longitudes, oceans included, so its subtropical
  // minimum is ~480 mm — far wetter than the Sahara's 25. The dryness of a real hot desert is
  // not a latitude fact, it is a DISTANCE-FROM-OCEAN fact, and it belongs here. That is why
  // the inland end of this table is as low as it is: 480 mm x 0.30 is 144 mm, which at 25 C is
  // an aridity index of 0.075 and lands squarely in vanilla's desert band. A gentler curve
  // (0.60 at the inland end, which is what this table said first) produced a world with
  // literally zero desert columns in a 7,381-column survey.
  var C_WET = [
    [-1.2, 1.35], [-0.2, 1.15], [0.03, 0.95], [0.3, 0.70], [0.6, 0.45], [1.0, 0.30],
  ];

  // ── the Whittaker lookup (D-116) ────────────────────────────────────────────────────────
  //
  // ⚠ READ THIS BEFORE CHANGING ANY NUMBER BELOW. Vanilla's `temperature` axis is NOT ordered
  // by temperature. Read out of the shipped table, the five middle biomes at each temperature
  // band, across the five humidity bands, are:
  //
  //     T0  ice_spikes  snowy_plains  snowy_taiga  snowy_taiga             taiga
  //     T1  plains      plains        forest       taiga                   old_growth_pine_taiga
  //     T2  sunflower.. plains        forest       old_growth_birch_forest dark_forest
  //     T3  savanna     savanna       plains       sparse_jungle           bamboo_jungle
  //     T4  desert      desert        desert       desert                  desert
  //
  // The hottest, wettest place in this game — jungle — is in band T3, and band T4 is DESERT at
  // every humidity. So vanilla's top temperature band does not mean "hot", it means "hot and
  // dry"; it conflates the two axes at exactly one corner. A separable map from physical
  // temperature to this axis therefore CANNOT work, and the first version of this file proved
  // it by putting a desert on the equator: 26.5 C mapped to axis 0.88, band T4, desert, while
  // the rainforest it should have been sits at 0.375.
  //
  // So the lookup is a real 2D Whittaker table: physical temperature down, aridity across,
  // each cell holding the (temperature axis, humidity axis) pair whose vanilla biome is the
  // Whittaker biome for that climate. Bilinear between cells. The cells are named in the
  // comment beside each row so a wrong one is arguable rather than mysterious.
  //
  // Aridity, not precipitation, is the second axis — 400 mm is desert at 30 C and forest at
  // 0 C, which is the Whittaker diagram's whole point. `AI = P / PET`.

  // Row keys: annual mean temperature, degrees C.
  var W_TEMP = [-30, -12, -2, 6, 14, 21, 27];
  // Column keys: log10 of the aridity index. -1.1 .. 0.35 is AI 0.08 .. 2.2, which spans
  // hyper-arid desert to rainforest. The inner three are the UNEP class boundaries.
  var W_ARID = [-1.10, -0.70, -0.35, 0.0, 0.35];

  // [temperature axis, humidity axis] per cell, row-major, W_TEMP x W_ARID.
  var W_T = [
    // -30 C  ice cap: snowy_plains whatever the moisture, snowy_taiga where there is any
    [-0.72, -0.72, -0.72, -0.72, -0.72],
    // -12 C  tundra
    [-0.60, -0.60, -0.60, -0.60, -0.60],
    //  -2 C  boreal: cold steppe -> taiga -> old-growth
    [-0.30, -0.30, -0.30, -0.30, -0.30],
    //   6 C  cool temperate
    [-0.10, -0.10, -0.10, -0.10, -0.10],
    //  14 C  warm temperate
    [0.025, 0.025, 0.025, 0.025, 0.025],
    //  21 C  subtropical: the arid corner is where vanilla's T4 desert band belongs
    [0.700, 0.450, 0.375, 0.375, 0.375],
    //  27 C  tropical: hot desert -> thorn scrub -> savanna -> seasonal forest -> rainforest
    [0.850, 0.600, 0.400, 0.375, 0.375],
  ];
  var W_H = [
    // The two polar rows run drier than the ratio alone would say, and that is not a fudge:
    // the Antarctic interior is the driest desert on Earth, and a place with 150 mm of annual
    // snowfall is arid however little of it evaporates. Without this the poles came out one
    // humidity band too wet and `ice_spikes` — vanilla's frozen/arid biome — could not occur.
    [-0.75, -0.55, -0.30, -0.05, 0.15],
    [-0.70, -0.50, -0.28, -0.02, 0.20],
    [-0.60, -0.40, -0.10, 0.20, 0.50],
    [-0.60, -0.35, -0.05, 0.20, 0.50],
    [-0.60, -0.35, -0.05, 0.20, 0.50],
    [-0.60, -0.50, -0.05, 0.20, 0.50],
    [-0.60, -0.55, -0.50, 0.25, 0.60],
  ];
  E.W_TEMP = W_TEMP; E.W_ARID = W_ARID; E.W_T = W_T; E.W_H = W_H;
  E.C_WET = C_WET;

  /**
   * Potential evapotranspiration, mm/yr, from the annual mean temperature. A linear
   * approximation to Thornthwaite over the range that matters, floored so that the polar
   * interiors — 150 mm of snow a year onto ground that evaporates almost nothing — do not come
   * out as rainforest, which an unfloored ratio would say they are.
   */
  E.PET = function (tempC) {
    var p = 55 * (tempC + 10);
    return p < 150 ? 150 : p;
  };

  /** Where a key sits in a sorted table: the lower index and the fraction past it, clamped. */
  function frac(keys, v) {
    var n = keys.length;
    if (v <= keys[0]) { fracI = 0; fracT = 0; return; }
    if (v >= keys[n - 1]) { fracI = n - 2; fracT = 1; return; }
    for (var i = 1; i < n; i++) {
      if (v <= keys[i]) { fracI = i - 1; fracT = (v - keys[i - 1]) / (keys[i] - keys[i - 1]); return; }
    }
    fracI = n - 2; fracT = 1;
  }
  var fracI = 0, fracT = 0;

  // ── the sea ─────────────────────────────────────────────────────────────────────────────
  //
  // Over water the Whittaker table does not apply, and applying it anyway is a bug this file
  // shipped once: the equatorial ocean came out ONE BAND TOO COOL — `lukewarm_ocean` where it
  // should be `warm_ocean` — and `warm_ocean` became unreachable in Earth mode entirely,
  // measured over 58,101 columns.
  //
  // The reason is structural. Vanilla's five ocean biomes are indexed by the temperature band
  // alone (T0 frozen, T1 cold, T2 ocean, T3 lukewarm, T4 warm), and its top band is the one the
  // Whittaker table reserves for HOT AND DRY. There is no evapotranspiration deficit over the
  // sea, so the tropical ocean belongs in that top band on temperature alone. This is the
  // straight temperature-to-band map for water, blended in as the coast becomes ocean.
  var T_SEA = [
    [-30, -0.85], [-25, -0.72], [-10, -0.55], [0, -0.30], [12, 0.025], [21, 0.375], [27, 0.775], [40, 0.95],
  ];
  // ⚠ The blend must end INSIDE the ocean, not at the last land. Vanilla's continentalness
  // bands are: ocean below -0.19, then COAST -0.19..-0.11 and NEAR-INLAND -0.11..0.03, both of
  // which are dry land. Ramping across -0.19..0.03 — which this file did first — pushed the
  // tropical coast into the hot-dry band and put deserts on the equator: 301 desert columns
  // inside 10 degrees of the equator, where the model had just correctly worked out it was
  // raining 2,000 mm a year. The ramp lives entirely below -0.19 now.
  var SEA_FULL = -0.30, SEA_NONE = -0.19;
  E.T_SEA = T_SEA;

  // The hot-desert band edge, and the re-purposed humidity range inside it. See the long note
  // in `computeColumn`. -0.15 +/- 0.50 spans vanilla's humidity bands 0 through 3, which is
  // badlands at the dry end and wooded_badlands at the wet end.
  var HOT_LO = 0.50, HOT_HI = 0.62;
  var BADLANDS_MID = -0.15, BADLANDS_SWING = 0.50;

  var whitT = 0, whitH = 0;
  /**
   * whittaker(tempC, ai) — fills `E.axisT` / `E.axisH` with the vanilla axis pair. Bilinear
   * over the table above. Nothing is allocated: this runs once per column.
   */
  E.whittaker = function (tempC, ai) {
    frac(W_TEMP, tempC); var r = fracI, rt = fracT;
    frac(W_ARID, Math.log(ai < 1e-4 ? 1e-4 : ai) / Math.LN10); var c = fracI, ct = fracT;
    var t00 = W_T[r][c], t01 = W_T[r][c + 1], t10 = W_T[r + 1][c], t11 = W_T[r + 1][c + 1];
    var h00 = W_H[r][c], h01 = W_H[r][c + 1], h10 = W_H[r + 1][c], h11 = W_H[r + 1][c + 1];
    whitT = (t00 + (t01 - t00) * ct) + ((t10 + (t11 - t10) * ct) - (t00 + (t01 - t00) * ct)) * rt;
    whitH = (h00 + (h01 - h00) * ct) + ((h10 + (h11 - h10) * ct) - (h00 + (h01 - h00) * ct)) * rt;
    E.axisT = whitT; E.axisH = whitH;
    return E;
  };

  // ── the per-column climate ──────────────────────────────────────────────────────────────
  //
  // Memoised on (x, z): `targetFromColumn` is called once per quart-y, 96 times down a column,
  // and every term here is y-independent. Without this the rain shadow's two extra column
  // evaluations would be paid 96 times instead of once.
  var memoX = 0x7fffffff, memoZ = 0x7fffffff;
  var memoT = 0, memoH = 0, memoTempC = 0, memoPrecip = 0, memoLat = 0, memoAI = 0;

  function columnHeight(x, z) { return NS.Column.height(x, z); }

  function computeColumn(x, z, surfaceY, c) {
    var lat = E.latitudeAt(z);
    var ground = surfaceY > seaLevel ? surfaceY : seaLevel;

    // temperature: zonal mean, then the lapse rate on the ground's own height
    var tempC = E.zonalTemp(lat) - E.LAPSE_PER_BLOCK * (ground - seaLevel) * 1.0;

    // precipitation: zonal mean, then continentality, then the terrain
    var precip = E.zonalPrecip(lat) * lerpTable(C_WET, c[0]);

    windAt(lat);
    var near = columnHeight(Math.round(x - windEast * SHADOW_NEAR), Math.round(z - windSouth * SHADOW_NEAR));
    var far = columnHeight(Math.round(x - windEast * SHADOW_FAR), Math.round(z - windSouth * SHADOW_FAR));
    var up = near > far ? near : far;
    var rise = up - ground;
    if (rise > 0) precip *= Math.pow(0.5, rise / E.SHADOW_HALF_RISE);
    var slope = ground - near;                       // windward: we are above what is upwind
    if (slope > 0) precip *= 1 + (slope > E.OROGRAPHIC_FULL_RISE ? 1 : slope / E.OROGRAPHIC_FULL_RISE);

    var ai = precip / E.PET(tempC);

    // vanilla's own two noise fields, kept as a small perturbation so the bands are not stripes
    E.whittaker(tempC, ai);
    // over water, temperature alone decides — see the T_SEA note
    var sea = (SEA_NONE - c[0]) / (SEA_NONE - SEA_FULL);
    if (sea > 0) {
      if (sea > 1) sea = 1;
      whitT += (lerpTable(T_SEA, tempC) - whitT) * sea;
    }
    // ── the badlands margin ───────────────────────────────────────────────────────────────
    // One biome cannot be reached by any physically ordered climate, and it is worth naming
    // rather than losing: `wooded_badlands` sits at temperature band 4 with humidity band 3 —
    // HOT AND WET — in a table whose band 4 is desert at every humidity. Vanilla can be in two
    // places at once there because its axes are noise; a model in which "hot" and "wet" mean
    // what they say cannot.
    //
    // But inside that band the humidity axis has no other job left. Every middle biome there is
    // desert, every ocean there is warm_ocean, and the only thing humidity still decides is
    // which BADLANDS variant appears where the erosion and weirdness are extreme enough for any
    // of them: bands 0-1 give `badlands`, bands 2-3 give `wooded_badlands`. So inside the band
    // the axis is re-purposed to mean exactly what the biome's name says — how vegetated this
    // part of the desert's margin is — driven by vanilla's own vegetation noise and blended in
    // across the band edge so that nothing jumps at the boundary.
    if (whitT > HOT_LO) {
      var hot = (whitT - HOT_LO) / (HOT_HI - HOT_LO);
      if (hot > 1) hot = 1;
      whitH += (BADLANDS_MID + BADLANDS_SWING * c[5] - whitH) * hot;
    }
    memoT = whitT + E.TEMP_NOISE * c[4];
    memoH = whitH + E.HUMID_NOISE * c[5];
    if (memoT < -1) memoT = -1; else if (memoT > 1) memoT = 1;
    if (memoH < -1) memoH = -1; else if (memoH > 1) memoH = 1;
    memoTempC = tempC; memoPrecip = precip; memoLat = lat; memoAI = ai;
    memoX = x; memoZ = z;
  }

  /**
   * targetFromColumn(c, x, z, surfaceY, y, out) — the Earth-mode answer to question 1.
   * Same contract as `Climate.targetFromColumn`: four of the six axes pass straight through.
   */
  E.targetFromColumn = function (c, x, z, surfaceY, y, out) {
    if (!E.ready) throw new Error('Earth.targetFromColumn before Earth.init');
    if (x !== memoX || z !== memoZ) computeColumn(x, z, surfaceY, c);
    out[0] = memoT;
    out[1] = memoH;
    out[2] = c[0];
    out[3] = c[1];
    out[4] = (surfaceY - y) / 128;
    out[5] = c[2];
    return out;
  };

  var colScratch = new Float64Array(6);

  E.targetInto = function (x, y, z, out) {
    NS.Column.climateInto(x, z, colScratch);
    return E.targetFromColumn(colScratch, x, z, NS.Column.heightFromClimate(colScratch, x, z), y, out);
  };

  /**
   * report(x, z) -> the physical numbers behind a column, for the F3 screen and for
   * `climcheck`. Not on any hot path.
   */
  E.report = function (x, z) {
    var c = NS.Column.climateInto(x, z, new Float64Array(6));
    var h = NS.Column.height(x, z);
    computeColumn(x, z, h, c);
    return {
      latitude: memoLat, tempC: memoTempC, precipMm: memoPrecip, aridity: memoAI,
      pet: E.PET(memoTempC), surfaceY: h,
      temperatureAxis: memoT, humidityAxis: memoH,
      wind: [windEast, windSouth],
    };
  };
})(MCL);
