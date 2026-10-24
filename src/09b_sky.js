// 09b_sky.js — PLAN G16: the sky, the celestial bodies, fog and weather.
// Runs on: MAIN THREAD ONLY. No DOM — this module computes NUMBERS; the renderer draws them.
//
// ⚠ IT IS NUMBERED 09b AND NOT 16 BECAUSE THE RENDERER READS IT. `10_gfx.js`, `11_gfx_webgpu.js`
// and `12_gfx_webgl2.js` all want the sky and fog colours, and the build concatenates in list
// order, so a module named for its PLAN stage would have loaded after its consumers. The number
// is the load order, not the stage.
//
// ⚠⚠ THIS IS THE PARITY HALF OF A RENDERING STAGE, AND THE SPLIT IS DELIBERATE (D-300). The
// CHARTER lets rendering be cheap and demands everything else be exact. The sky's *picture* is a
// dome, a quad for the sun, a quad for the moon and 1,500 star quads — cheap, and drawn however
// is convenient. The sky's *numbers* are not: the time of day, the sun's angle, the moon's phase,
// the colour of the sky at this minute in this biome, how dark it goes when it rains, how far you
// can see in a swamp, and when the rain starts and stops are all rules a player can see being
// wrong, and every one of them is compiled Java in vanilla. So they live here, in one place, with
// a check that can assert them without a canvas.
//
// ⚠ EVERY CONSTANT IS READ OUT OF THE 1.18.2 BYTECODE, and the classes were located BY USE
// (D-263, tenth time): `DimensionType` is the class whose `(long)->float` divides by 24000 and
// takes a cosine; `ClientLevel` is the only class in the jar that uses the luma constant
// `0.59f`, which is the sky's rain desaturation. Nothing here is a remembered number.
//
// THE FOUR THINGS A CLONE GETS WRONG:
//
//   1. ⚠ THE DAY IS NOT LINEAR. `timeOfDay` is `(d*2 + (0.5 - cos(d*π)/2)) / 3` on the fraction
//      `dayTime/24000 - 0.25`, which makes dawn and dusk pass FASTER than noon and midnight. A
//      linear `dayTime/24000` gives a sun that moves at a constant rate and a night that is the
//      wrong length — visible within one in-game day.
//   2. ⚠ THE SKY COLOUR IS THE BIOME'S COLOUR TIMES A CLAMPED COSINE, so it goes to BLACK at
//      night rather than to a dark blue, and the stars are what you see instead. Getting the
//      clamp wrong gives a sky that never fully darkens.
//   3. ⚠ RAIN DESATURATES TOWARD LUMA, IT DOES NOT DARKEN. `(r*0.3 + g*0.59 + b*0.11) * 0.6` is
//      mixed in by `1 - rain*0.75`; thunder does the same with `0.2`. A multiply toward black
//      reads as dusk rather than as weather.
//   4. ⚠ THE MOON PHASE WRAPS TWICE. `((t / 24000) % 8 + 8) % 8` — the second `% 8` is there for
//      a negative `dayTime`, which `/time set` can produce, and a single `%` gives a negative
//      index into an eight-frame texture.
(function (NS) {
  'use strict';

  var Sky = NS.Sky = {
    ready: false,
    /** `Level.TICKS_PER_DAY`, a literal `24000` in `Level`'s own constant pool. */
    TICKS_PER_DAY: 24000,
    /** `LevelRenderer`'s star loop bound and its `Random` seed. */
    STAR_COUNT: 1500,
    STAR_SEED: 10842,
    /** `Level.getSeaLevel()` is a bare `bipush 63`. */
    SEA_LEVEL: 63
  };

  var TAU = 6.2831855;                         // ⚠ the FLOAT `6.2831855f`, not `2 * Math.PI`
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function frac(d) { return d - Math.floor(d); }
  function lerp(t, a, b) { return a + t * (b - a); }
  Sky.clamp01 = clamp01;

  // ── time ──────────────────────────────────────────────────────────────────────────────────
  /**
   * `DimensionType.timeOfDay(long)`:
   *
   *     double d0 = Mth.frac(dayTime / 24000.0 - 0.25);
   *     double d1 = 0.5 - Math.cos(d0 * Math.PI) / 2.0;
   *     return (float)(d0 * 2.0 + d1) / 3.0F;
   *
   * ⚠ THE `- 0.25` IS WHAT PUTS NOON AT `dayTime` 6000 AND NOT AT 0. Vanilla's day starts at
   * dawn, so tick 0 is 0.25 of the way round the circle; dropping the offset rotates the whole
   * sky by six hours and is the kind of error that looks like "the sun rises in the wrong place".
   */
  Sky.timeOfDay = function (dayTime) {
    var d0 = frac(dayTime / Sky.TICKS_PER_DAY - 0.25);
    var d1 = 0.5 - Math.cos(d0 * Math.PI) / 2;
    return (d0 * 2 + d1) / 3;
  };

  /** `Level.getSunAngle` — the time of day as radians. */
  Sky.sunAngle = function (dayTime) { return Sky.timeOfDay(dayTime) * TAU; };

  /**
   * `DimensionType.moonPhase(long)` = `(int)(((t / 24000) % 8 + 8) % 8)`.
   * ⚠ TWO MODULOS. See the header: a single one gives a negative frame index for a negative
   * `dayTime`, which `/time set` can produce and which indexes off the front of the texture.
   */
  Sky.moonPhase = function (dayTime) {
    var d = Math.floor(dayTime / Sky.TICKS_PER_DAY);
    return ((d % 8) + 8) % 8;
  };

  /**
   * `Level.getSkyDarken(partialTick)` — how bright the WORLD is, 0.2 … 1.0, and therefore the
   * multiplier on sky light. ⚠ IT NEVER REACHES ZERO: `f * 0.8 + 0.2`, so midnight sky light is
   * a fifth rather than nothing, which is why you can still just about see outdoors at night.
   */
  Sky.skyDarken = function (dayTime, rain, thunder) {
    var f = Sky.timeOfDay(dayTime);
    var f1 = 1 - (Math.cos(f * TAU) * 2 + 0.2);
    f1 = 1 - clamp01(f1);
    f1 *= 1 - (rain || 0) * 5 / 16;
    f1 *= 1 - (thunder || 0) * 5 / 16;
    return f1 * 0.8 + 0.2;
  };

  /**
   * `MathHelper.cos(float)` — vanilla's 65536-entry SINE TABLE, not `Math.cos` (D-511):
   *     SINE_TABLE[i] = (float)Math.sin(i * PI * 2 / 65536)
   *     cos(x) = SINE_TABLE[(int)(x * 10430.378F + 16384.0F) & 65535]
   * Every step is FLOAT arithmetic (`Math.fround`). `ambientDarkness` below truncates to an int,
   * so a table value a hair off `Math.cos` moves the tick at which darkness steps by one.
   */
  var fr = Math.fround;
  Sky.mthCos = function (x) {
    var i = (fr(fr(fr(x) * fr(10430.378)) + 16384) | 0) & 65535;
    return fr(Math.sin(i * Math.PI * 2 / 65536));
  };

  /** `MathHelper.sin(float)`: SINE_TABLE[(int)(x * 10430.378F) & 65535] (MathHelper.java:40-42). */
  Sky.mthSin = function (x) {
    var i = (fr(fr(x) * fr(10430.378)) | 0) & 65535;
    return fr(Math.sin(i * Math.PI * 2 / 65536));
  };

  // ── G20 (D-657): the SUNRISE/SUNSET band ───────────────────────────────────────────────────
  /** `DimensionType.getSkyAngle` as the jar rounds it: the double formula, cast to float. */
  Sky.skyAngleF = function (dayTime) {
    // `(float)(d * 2.0 + e) / 3.0F` — cast to float BEFORE the divide, then a float divide
    // (DimensionType.getSkyAngle); dividing in double first is a ulp off at some times.
    var d0 = frac(dayTime / Sky.TICKS_PER_DAY - 0.25);
    var d1 = 0.5 - Math.cos(d0 * Math.PI) / 2;
    return fr(fr(d0 * 2 + d1) / 3);
  };
  /**
   * `DimensionEffects.Overworld.getFogColorOverride(skyAngle)` (.decomp/net/minecraft/client/render/
   * DimensionEffects.java:40-56), every step float: c = cos(angle*2pi) (the table cos); only while
   * -0.4 <= c <= 0.4: f = c/0.4*0.5+0.5, a = (1 - (1 - sin(f*pi))*0.99)^2, rgb = (f*0.3+0.7,
   * f*f*0.7+0.2, 0.2). Returns [r,g,b,a] or null (no band outside that window).
   */
  Sky.sunriseColor = function (skyAngle) {
    var c = fr(Sky.mthCos(fr(fr(skyAngle) * fr(Math.PI * 2))) - 0);
    if (!(c >= fr(-0.4) && c <= fr(0.4))) return null;
    var f = fr(fr(fr(fr(c + 0) / fr(0.4)) * 0.5) + 0.5);
    var g = fr(1 - fr(fr(1 - Sky.mthSin(fr(f * fr(Math.PI)))) * fr(0.99)));
    g = fr(g * g);
    return [fr(fr(f * fr(0.3)) + fr(0.7)), fr(fr(fr(f * f) * fr(0.7)) + fr(0.2)), fr(fr(fr(f * f) * 0) + fr(0.2)), g];
  };
  /**
   * The fan `WorldRenderer.renderSky` draws with that colour (WorldRenderer.java:1859-1887): a
   * TRIANGLE_FAN, centre (0, 100, 0) at alpha a, rim k = 0..16 at (sin t*120, cos t*120,
   * -cos t*40*a), t = k*2pi/16 (float, table sin/cos), alpha 0 — posed by Rx(90), then
   * Rz(sin(skyAngle*2pi) < 0 ? 180 : 0), then Rz(90): so it hangs on the horizon at +x (east) in
   * the morning and -x (west) in the evening. Returned as 16 triangles in sky space (x,y,z) with a
   * per-vertex weight w (1 centre, 0 rim; the shader multiplies the colour's alpha by it — the
   * vertex-colour interpolation of vanilla's position_color draw).
   */
  Sky.sunriseFan = function (skyAngle) {
    var col = Sky.sunriseColor(skyAngle);
    if (!col) return null;
    var flip = Sky.mthSin(fr(fr(skyAngle) * fr(Math.PI * 2))) < 0 ? Math.PI : 0;
    var phi = flip + Math.PI / 2, cp = Math.cos(phi), sp = Math.sin(phi);
    var pose = function (x, y, z) {     // Rx(90) . Rz(phi)
      var rx = x * cp - y * sp, ry = x * sp + y * cp;
      return [rx, -z, ry];
    };
    var a = col[3], ctr = pose(0, 100, 0), rim = [];
    for (var k = 0; k <= 16; k++) {
      var t = fr(fr(fr(k) * fr(Math.PI * 2)) / 16);
      var sn = Sky.mthSin(t), cs = Sky.mthCos(t);
      rim.push(pose(fr(sn * 120), fr(cs * 120), fr(fr(-cs * 40) * a)));
    }
    var pos = new Float32Array(16 * 9), w = new Float32Array(16 * 6);
    for (var i = 0; i < 16; i++) {
      var tri = [ctr, rim[i], rim[i + 1]];
      for (var v = 0; v < 3; v++) {
        pos[i * 9 + v * 3] = tri[v][0]; pos[i * 9 + v * 3 + 1] = tri[v][1]; pos[i * 9 + v * 3 + 2] = tri[v][2];
        w[i * 6 + v * 2] = v === 0 ? 1 : 0;
      }
    }
    return { color: col, pos: pos, weight: w, verts: 48, rim: rim, center: ctr };
  };
  /**
   * `BackgroundRenderer.render`'s sunrise step (BackgroundRenderer.java:88-104), render distance
   * >= 4 only, between the biome fog colour and the sky blend: d = look.x * (sin(angle*2pi) > 0 ?
   * -1 : 1), clamped at 0; with a band, d *= its alpha and the fog colour lerps toward its rgb by d.
   * `look` is the camera's `horizontalPlane` — its forward vector — of which only x is read.
   */
  Sky.sunriseFog = function (rgb, skyAngle, lookX, renderDistanceChunks) {
    if (!(renderDistanceChunks >= 4) || typeof lookX !== 'number') return rgb;
    var side = Sky.mthSin(fr(fr(skyAngle) * fr(Math.PI * 2))) > 0 ? -1 : 1;
    var d = fr(fr(lookX) * side);
    if (d < 0) d = 0;
    if (!(d > 0)) return rgb;
    var col = Sky.sunriseColor(skyAngle);
    if (!col) return rgb;
    d = fr(d * col[3]);
    var k = fr(1 - d);
    return [fr(fr(fr(rgb[0]) * k) + fr(col[0] * d)), fr(fr(fr(rgb[1]) * k) + fr(col[1] * d)), fr(fr(fr(rgb[2]) * k) + fr(col[2] * d))];
  };

  /**
   * `World.calculateAmbientDarkness()` (.decomp World.java:544-549) — the SERVER's integer
   * darkness, 0 at noon … 11 at midnight, run every `ServerWorld.tick` (ServerWorld.java:227):
   *     d = 1 - rainGradient*5/16 ;  e = 1 - thunderGradient*5/16
   *     f = 0.5 + 2 * clamp(cos(getSkyAngle(1) * 2π), -0.25, 0.25)
   *     ambientDarkness = (int)((1 - f*d*e) * 11)
   * ⚠ NOT `skyDarken` (the CLIENT's float 0.2..1 picture multiplier above). This one is what
   * spawning (`HostileEntity.isSpawnDark`), `World.isDay()` and `getLightLevel(pos)` read.
   * `thunder` is getThunderGradient(1) — already multiplied by the rain gradient
   * (`Sky.thunderLevelOf`).
   */
  Sky.ambientDarkness = function (dayTime, rain, thunder) {
    var d = 1 - fr(fr(rain || 0) * 5) / 16;
    var e = 1 - fr(fr(thunder || 0) * 5) / 16;
    var c = Sky.mthCos(fr(fr(Sky.timeOfDay(dayTime)) * TAU));
    var f = 0.5 + 2 * Math.max(-0.25, Math.min(0.25, c));
    return ((1 - f * d * e) * 11) | 0;
  };
  /** The live world's own `ambientDarkness`, off `Sky.dayTime` and the current weather. */
  Sky.darknessNow = function () {
    var wx = Sky.weather || Sky.newWeather();
    return Sky.ambientDarkness(Sky.dayTime, wx.rainLevel, Sky.thunderLevelOf(wx));
  };
  /** `World.isDay()` (World.java:386): `!hasFixedTime && ambientDarkness < 4` (overworld). */
  Sky.isDay = function () { return !Sky.fixedTime() && Sky.darknessNow() < 4; };
  Sky.fixedTime = function () { return !!(NS.Dim && NS.Dim.current && NS.Dim.current().fixedTime != null); };
  /** `World.isNight()` (World.java:390): `!hasFixedTime && !isDay()`. */
  Sky.isNight = function () { return !Sky.fixedTime() && Sky.darknessNow() >= 4; };
  /** `World.isThundering()` (World.java:755): `getThunderGradient(1) > 0.9` (overworld). */
  Sky.isThundering = function () {
    var wx = Sky.weather || Sky.newWeather();
    return Sky.thunderLevelOf(wx) > 0.9;
  };

  /**
   * `ClientLevel.getStarBrightness(partialTick)`:
   *     f1 = clamp(1 - (cos(t * 2π) * 2 + 0.25), 0, 1);  return f1 * f1 * 0.5;
   * ⚠ THE SQUARE IS WHAT MAKES THE STARS COME OUT SLOWLY and the `0.5` is why they are never
   * fully opaque. A linear ramp pops them on at dusk.
   */
  Sky.starBrightness = function (dayTime) {
    var f1 = clamp01(1 - (Math.cos(Sky.timeOfDay(dayTime) * TAU) * 2 + 0.25));
    return f1 * f1 * 0.5;
  };

  // ── colour ────────────────────────────────────────────────────────────────────────────────
  /**
   * `ClientLevel.getSkyColor(pos, partialTick)`, with the biome's own `sky_color` as the base.
   *
   *     f1 = clamp(cos(timeOfDay * 2π) * 2 + 0.5, 0, 1);
   *     rgb *= f1;
   *     if (rain > 0)    { luma = (r*0.3 + g*0.59 + b*0.11) * 0.6; k = 1 - rain    * 0.75; mix }
   *     if (thunder > 0) { luma = (r*0.3 + g*0.59 + b*0.11) * 0.2; k = 1 - thunder * 0.75; mix }
   *
   * ⚠ VANILLA SAMPLES THE BIOME COLOUR THROUGH A GAUSSIAN OVER A 6x6x6 QUART NEIGHBOURHOOD
   * (`CubicSampler`), so the sky fades between biomes over about ninety blocks rather than
   * snapping at the border. That blur is `Sky.blendedSkyColor` below; this function takes the
   * colour it produced, so the two are separable and the check can assert each.
   * @param rgb [r,g,b] in 0..1
   */
  Sky.skyColor = function (rgb, dayTime, rain, thunder) {
    var f1 = clamp01(Math.cos(Sky.timeOfDay(dayTime) * TAU) * 2 + 0.5);
    var r = rgb[0] * f1, g = rgb[1] * f1, b = rgb[2] * f1;
    var i;
    var mix = [[rain || 0, 0.6], [thunder || 0, 0.2]];
    for (i = 0; i < 2; i++) {
      var amount = mix[i][0];
      if (amount <= 0) continue;
      var luma = (r * 0.3 + g * 0.59 + b * 0.11) * mix[i][1];
      var k = 1 - amount * 0.75;
      r = r * k + luma * (1 - k);
      g = g * k + luma * (1 - k);
      b = b * k + luma * (1 - k);
    }
    return [r, g, b];
  };

  // ── underwater fog (BackgroundRenderer.render water branch / applyFog, ClientPlayerEntity) ──
  /**
   * `BackgroundRenderer.render`, CameraSubmersionType.WATER branch (BackgroundRenderer.java:30-63):
   * the colour is the biome's `water_fog_color`, eased from the PREVIOUS colour over 5000 ms, never
   * blended spatially. `st` is the three statics (`waterFogColor`, `nextWaterFogColor`,
   * `lastWaterFogColorUpdateTime`, -1 = out of water); returns [r,g,b] in 0..1 (float32-rounded as
   * the Java floats are). Leaving the water must call `Sky.waterFogLeave(st)` (java:63,68,127).
   */
  Sky.newWaterFog = function () { return { color: -1, next: -1, t: -1 }; };
  Sky.waterFogLeave = function (st) { st.t = -1; };
  Sky.waterFogColor = function (st, biomeWaterFog, nowMs) {
    var fr = Math.fround;
    if (st.t < 0) { st.color = biomeWaterFog; st.next = biomeWaterFog; st.t = nowMs; }
    var r0 = (st.color >> 16) & 255, g0 = (st.color >> 8) & 255, b0 = st.color & 255;
    var r1 = (st.next >> 16) & 255, g1 = (st.next >> 8) & 255, b1 = st.next & 255;
    var k = Math.min(1, Math.max(0, fr((nowMs - st.t) / 5000)));
    var lerp = function (a, b) { return fr(a + fr(fr(b - a) * k)); };   // MathHelper.lerp(delta, start, end)
    var r = lerp(r1, r0), g = lerp(g1, g0), b = lerp(b1, b0);
    if (st.color !== biomeWaterFog) {
      st.color = biomeWaterFog;
      st.next = (Math.floor(r) << 16) | (Math.floor(g) << 8) | Math.floor(b);
      st.t = nowMs;
    }
    return [fr(r / 255), fr(g / 255), fr(b / 255)];
  };

  /** `ClientPlayerEntity.tick` (java:749-754): +1 a tick submerged (+10 spectator), -10 out, clamped 0..600. */
  Sky.underwaterTicks = function (ticks, submerged, spectator) {
    if (submerged) return Math.min(600, Math.max(0, ticks + (spectator ? 10 : 1)));
    return ticks > 0 ? Math.min(600, Math.max(0, ticks - 10)) : ticks;
  };

  /** `ClientPlayerEntity.getUnderwaterVisibility` (java:1029-1046). */
  Sky.underwaterVisibility = function (ticks, submerged) {
    if (!submerged) return 0;
    if (ticks >= 600) return 1;
    var fr = Math.fround;
    var a = Math.min(1, Math.max(0, fr(ticks / 100)));
    var b = ticks < 100 ? 0 : Math.min(1, Math.max(0, fr((ticks - 100) / 500)));
    return fr(fr(a * 0.6) + fr(b * fr(0.39999998)));
  };

  /** The tail of `BackgroundRenderer.render` for water (java:151-175): darkness tint, then the visibility rescale. */
  Sky.waterFogFinish = function (c, skyDarkness, visibility) {
    var fr = Math.fround;
    var r = c[0], g = c[1], b = c[2];
    if (skyDarkness > 0) {
      r = fr(fr(r * (1 - skyDarkness)) + fr(fr(r * 0.7) * skyDarkness));
      g = fr(fr(g * (1 - skyDarkness)) + fr(fr(g * 0.6) * skyDarkness));
      b = fr(fr(b * (1 - skyDarkness)) + fr(fr(b * 0.6) * skyDarkness));
    }
    if (r !== 0 && g !== 0 && b !== 0) {
      var m = Math.min(fr(1 / r), Math.min(fr(1 / g), fr(1 / b)));
      r = fr(fr(r * (1 - visibility)) + fr(fr(r * m) * visibility));
      g = fr(fr(g * (1 - visibility)) + fr(fr(g * m) * visibility));
      b = fr(fr(b * (1 - visibility)) + fr(fr(b * m) * visibility));
    }
    return [r, g, b];
  };

  /**
   * `BackgroundRenderer.applyFog` WATER branch (java:219-233): start -8, end 96 x max(0.25, visibility),
   * x0.85 in a swamp-category biome, capped at the view distance (then a sphere fog shape).
   */
  Sky.waterFogRange = function (visibility, swamp, viewDist) {
    var fr = Math.fround;
    var end = fr(96 * Math.max(0.25, visibility));
    if (swamp) end = fr(end * fr(0.85));
    var sphere = false;
    if (end > viewDist) { end = viewDist; sphere = true; }
    return { start: -8, end: end, sphere: sphere };
  };

  /** unpack a vanilla 0xRRGGBB into 0..1 floats — `Vec3.fromRGB24`. */
  // #380: lerp a float [r,g,b] (0..1) toward white by t -- the lightning flash on G.sky/G.fog.
  Sky.lerpToWhite = function (c, t) {
    return [c[0] + (1 - c[0]) * t, c[1] + (1 - c[1]) * t, c[2] + (1 - c[2]) * t];
  };

  Sky.rgb24 = function (c) {
    return [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
  };

  /**
   * `CubicSampler.gaussianSampleVec3` — vanilla's 6x6x6 weighted sample over QUART coordinates
   * (one sample per four blocks), with the weights `(1, 4, 6, 4, 1)`-ish from a cubic kernel.
   *
   * ⚠ THE KERNEL IS NOT A BOX AND NOT A GAUSSIAN: it is `CubicSampler.GAUSSIAN_SAMPLE_KERNEL`,
   * the six-tap array below, which vanilla builds once. Taking a plain average over the same
   * neighbourhood gives a border that fades linearly instead of smoothly, which shows up as a
   * visible band when you walk from a swamp into a plain.
   */
  // ⚠ SEVEN ENTRIES, NOT SIX, AND THE LERP READS THEM BACKWARDS. `CubicSampler`'s array is
  // `{0, 1, 4, 6, 4, 1, 0}` and the weight for tap `i` is `Mth.lerp(delta, k[i + 1], k[i])` —
  // the LATER entry first. The six-entry mirrored version this file shipped first
  // (`lerp(f, k[i], k[5 - i])`) is a different kernel that happens to look plausible, and it
  // would have put the biome blend a fraction of a block out everywhere.
  Sky.KERNEL = [0, 1, 4, 6, 4, 1, 0];
  Sky.blendedColor = function (x, y, z, colourAt) {
    // vanilla: `pos.subtract(2,2,2).scale(0.25)`, then `floor` and a 6^3 sample offset by −2
    var qx = (x - 2) * 0.25, qy = (y - 2) * 0.25, qz = (z - 2) * 0.25;
    var ix = Math.floor(qx), iy = Math.floor(qy), iz = Math.floor(qz);
    var fx = qx - ix, fy = qy - iy, fz = qz - iz;
    var total = 0, r = 0, g = 0, b = 0, K = Sky.KERNEL;
    for (var i = 0; i < 6; i++) {
      var wx = lerp(fx, K[i + 1], K[i]);
      for (var j = 0; j < 6; j++) {
        var wy = lerp(fy, K[j + 1], K[j]);
        for (var k = 0; k < 6; k++) {
          var wz = lerp(fz, K[k + 1], K[k]);
          var w = wx * wy * wz;
          if (w === 0) continue;
          var c = colourAt(ix - 2 + i, iy - 2 + j, iz - 2 + k);
          total += w; r += w * c[0]; g += w * c[1]; b += w * c[2];
        }
      }
    }
    if (total === 0) return [0, 0, 0];
    return [r / total, g / total, b / total];
  };
  Sky.blendedSkyColor = Sky.blendedColor;

  /**
   * ⚠ THE FOG'S BRIGHTNESS RAMP IS THE SAME CLAMPED COSINE THE SKY USES, not `skyDarken`. This
   * file's first version used `skyDarken` — plausible, and wrong: `skyDarken` bottoms out at
   * 0.2 and carries the rain term, so the fog would never go dark and would be dimmed by rain
   * twice.
   */
  Sky.fogBrightness = function (dayTime) {
    return clamp01(Math.cos(Sky.timeOfDay(dayTime) * TAU) * 2 + 0.5);
  };

  /**
   * `DimensionSpecialEffects.OverworldEffects.getBrightnessDependentFogColor`, verbatim:
   *
   *     color.multiply(b * 0.94F + 0.06F, b * 0.94F + 0.06F, b * 0.91F + 0.09F)
   *
   * ⚠ THE BLUE CHANNEL IS NOT THE SAME AS THE OTHER TWO — 0.91/0.09 against 0.94/0.06 — which
   * is what keeps a trace of blue in the fog at midnight instead of letting it go grey. Three
   * identical channels is the version a clone writes and it is visibly wrong on a clear night.
   */
  Sky.biomeFogColor = function (rgb, b) {
    var k = b * 0.94 + 0.06, kb = b * 0.91 + 0.09;
    return [rgb[0] * k, rgb[1] * k, rgb[2] * kb];
  };

  /**
   * `FogRenderer.setupColor`'s blend toward the sky:
   *     f = 0.25F + 0.75F * renderDistance / 32.0F;  f = 1.0F - (float)Math.pow(f, 0.25);
   * ⚠ IT DEPENDS ON RENDER DISTANCE, which means the horizon's colour is not the same on two
   * machines — vanilla's own behaviour, and the reason this is a parameter rather than a
   * constant.
   */
  Sky.fogSkyBlend = function (renderDistanceChunks) {
    return 1 - Math.pow(0.25 + 0.75 * renderDistanceChunks / 32, 0.25);
  };

  /**
   * The fog colour a frame should clear to: the biome's fog colour on its brightness ramp,
   * blended toward the sky colour by the render distance, then darkened by the weather.
   *
   * ⚠ RAIN DARKENS RED AND GREEN BY 0.5 AND BLUE BY ONLY 0.4; THUNDER DARKENS ALL THREE BY 0.5.
   * The asymmetry is in the bytecode and nowhere else — a uniform multiply gives a storm that
   * reads as dusk.
   */
  Sky.fogColor = function (biomeFogRgb, skyRgb, dayTime, rain, thunder, renderDistanceChunks, lookX) {
    var b = Sky.fogBrightness(dayTime);
    var c = Sky.biomeFogColor(biomeFogRgb, b);
    // D-657: the sunrise blend sits HERE, before the sky blend (BackgroundRenderer.java:88-107);
    // callers that pass no look vector (the checks' old calls) get the old colour unchanged.
    c = Sky.sunriseFog(c, Sky.skyAngleF(dayTime), lookX, renderDistanceChunks === undefined ? 12 : renderDistanceChunks);
    var t = Sky.fogSkyBlend(renderDistanceChunks === undefined ? 12 : renderDistanceChunks);
    var r = c[0] + (skyRgb[0] - c[0]) * t;
    var g = c[1] + (skyRgb[1] - c[1]) * t;
    var bl = c[2] + (skyRgb[2] - c[2]) * t;
    if (rain > 0) { var f = 1 - rain * 0.5, f1 = 1 - rain * 0.4; r *= f; g *= f; bl *= f1; }
    if (thunder > 0) { var f2 = 1 - thunder * 0.5; r *= f2; g *= f2; bl *= f2; }
    return [r, g, bl];
  };

  // ── the stars ─────────────────────────────────────────────────────────────────────────────
  /**
   * `LevelRenderer.drawStars`, exactly — including the rejected candidates.
   *
   * ⚠⚠ THE LOOP RUNS 1,500 TIMES AND PRODUCES FEWER THAN 1,500 STARS. A candidate is kept only
   * when its squared length is inside the unit sphere and outside a small core
   * (`d4 < 1.0 && d4 > 0.01`), and a rejected candidate still CONSUMES its four `nextFloat`
   * draws — so skipping the rejects, or drawing them, moves every star after the first one.
   * That is why this reproduces the loop rather than "1,500 random points on a sphere".
   *
   * Returns a flat Float32Array of 4 vertices x 3 floats per star, ready for a buffer.
   */
  Sky.buildStars = function () {
    var N = NS.Noise;
    if (!N || !N.LegacyRandom) return null;
    var rnd = new N.LegacyRandom(Sky.STAR_SEED);
    var out = [];
    for (var i = 0; i < Sky.STAR_COUNT; i++) {
      var d0 = rnd.nextFloat() * 2 - 1;
      var d1 = rnd.nextFloat() * 2 - 1;
      var d2 = rnd.nextFloat() * 2 - 1;
      var d3 = 0.15 + rnd.nextFloat() * 0.1;
      var d4 = d0 * d0 + d1 * d1 + d2 * d2;
      if (!(d4 < 1 && d4 > 0.01)) continue;
      d4 = 1 / Math.sqrt(d4);
      d0 *= d4; d1 *= d4; d2 *= d4;
      var d5 = d0 * 100, d6 = d1 * 100, d7 = d2 * 100;
      var d8 = Math.atan2(d0, d2), d9 = Math.sin(d8), d10 = Math.cos(d8);
      var d11 = Math.atan2(Math.sqrt(d0 * d0 + d2 * d2), d1);
      var d12 = Math.sin(d11), d13 = Math.cos(d11);
      var d14 = rnd.nextDouble() * Math.PI * 2, d15 = Math.sin(d14), d16 = Math.cos(d14);
      for (var j = 0; j < 4; j++) {
        var d18 = ((j & 2) - 1) * d3;
        var d19 = ((j + 1 & 2) - 1) * d3;
        var d21 = d18 * d16 - d19 * d15;
        var d22 = d19 * d16 + d18 * d15;
        var d23 = d21 * d12;                       // `d21 * d12 + 0.0 * d13`
        var d24 = -d21 * d13;                      // `0.0 * d12 - d21 * d13`
        var d25 = d24 * d9 - d22 * d10;
        var d26 = d22 * d9 + d24 * d10;
        out.push(d5 + d25, d6 + d23, d7 + d26);
      }
    }
    return new Float32Array(out);
  };

  // ══ G16b: THE GEOMETRY OF THE SKY ══════════════════════════════════════════════════════
  //
  // ⚠ THESE ARE VANILLA'S NUMBERS AND VANILLA'S WINDING, not "a dome and two quads". The disc is
  // a nine-point fan at radius 512; the sun is thirty units across and the moon twenty, both at
  // a hundred units out; the moon's texture is a FOUR-BY-TWO grid and its phase indexes it. Every
  // one of those is a literal in `LevelRenderer`.

  /** `LevelRenderer.SUN_SIZE`-ish: the half-extent of each quad, and how far out they sit. */
  Sky.SUN_SIZE = 30; Sky.MOON_SIZE = 20; Sky.CELESTIAL_DIST = 100;
  /** the disc's radius and the two heights vanilla builds it at */
  Sky.DISC_RADIUS = 512; Sky.SKY_DISC_Y = 16; Sky.DARK_DISC_Y = -16;

  /**
   * THE SKY PASS NEEDS ITS OWN FAR PLANE (D-304), and this is it.
   *
   * ⚠ THE WORLD'S FAR PLANE IS A RENDERING ECONOMY AND THE SKY IS NOT IN THE WORLD. `Gfx.render`
   * sets `cam.far = rd * 16 * fogEnd + 16` so that nothing is drawn past the fog wall (D-90) —
   * at the CELERON preset that is render distance 4, and `cam.far` comes out at **76.8**. The
   * sun and the moon sit at `CELESTIAL_DIST` = 100. So on the bottom rung of the hardware
   * ladder both of them were entirely behind the far plane and the sky had no sun in it at all,
   * at any hour, while `skycheck`'s 141 numbers stayed green and the sky pass dutifully issued
   * its four draws a frame. `skyviewcheck` is what saw it, by looking.
   *
   * Vanilla has no such problem because its own sky projection is built at `renderDistance * 4`
   * BLOCKS — 768 at render distance 12 — and never at the fog wall. This constant is that:
   * far enough out that the whole disc is inside it as well, so the horizon is sky rather than
   * a far-plane cut. It costs nothing: the sky pass is ten triangles, two quads and the stars,
   * with depth writes off, so a wider frustum draws exactly the same geometry.
   */
  Sky.SKY_FAR = 1024;
  Sky.SKY_NEAR = 0.05;

  /**
   * `LevelRenderer.buildSkyDisc(builder, y)`:
   *
   *     float f = Math.signum(y) * 512.0F;
   *     vertex(0, y, 0);
   *     for (int i = -180; i <= 180; i += 45)
   *         vertex(f * cos(i * DEG), y, 512.0F * sin(i * DEG));
   *
   * ⚠ THE X TERM CARRIES THE SIGN AND THE Z TERM DOES NOT. For the DARK disc at y = −16 that
   * makes `f` negative, which mirrors the fan and flips its winding so it faces DOWN. Writing
   * `512 * cos` for both gives two discs that face the same way, and the one under your feet is
   * then back-face culled — a hole in the sky that only appears when you look down.
   *
   * Returns a flat Float32Array of ten vertices, three floats each, in TRIANGLE FAN order.
   */
  Sky.buildSkyDisc = function (y) {
    var f = (y > 0 ? 1 : y < 0 ? -1 : 0) * Sky.DISC_RADIUS;
    var out = [0, y, 0];
    for (var i = -180; i <= 180; i += 45) {
      var a = i * 0.017453292;
      out.push(f * Math.cos(a), y, Sky.DISC_RADIUS * Math.sin(a));
    }
    return new Float32Array(out);
  };

  /**
   * The SAME disc, as a subdivided triangle list — the one the renderer actually draws (D-415).
   *
   * ⚠⚠ **WHY NOT THE NINE-VERTEX FAN ABOVE, WHICH IS VANILLA'S OWN.** Because the fan's centre
   * vertex is the ZENITH — `(0, ±16, 0)` in a frame whose origin IS the eye — and with the
   * camera level that point lies exactly in the plane through the eye perpendicular to the view
   * direction, so its clip-space **w is 0**. Measured, not guessed: projecting the ten vertices
   * through the frame's own `skyViewProj` at pitch 0 gives `w = 0` for the centre and
   * `ndc.y = 0.045` for every rim vertex. Every triangle of the fan therefore has one vertex at
   * infinity, and any value interpolated ACROSS it — a fog distance, a per-vertex colour — comes
   * out as the rim's value over the whole screen, because perspective-correct interpolation
   * divides by w. A flat-coloured disc never noticed; the moment the horizon fade needed a
   * gradient across those triangles, it read a constant and washed the entire sky to fog.
   *
   * Vanilla gets away with the same geometry because it never interpolates anything across it
   * either — its fog is computed per fragment from the eye-space position, which its own driver
   * feeds it correctly. This is a RENDERING deviation, which is where MC-Lite is allowed to be
   * clever rather than faithful: same surface, same radius, same height, cut into rings so that
   * no triangle spanning the screen has a degenerate vertex.
   *
   * The radii are GEOMETRIC, not linear. A point at horizontal radius `r` on a plane `h` above
   * the eye projects to `ndc.y ≈ (h / r) · cot(fov/2)`, so screen height goes as `1/r`: linear
   * rings would put almost every vertex in the bottom 5% of the sky. A geometric progression is
   * even in `log r`, which is close enough to even on screen.
   *
   * The innermost ring starts at `INNER` rather than 0, and the centre is filled by a small fan
   * whose triangles are the only ones that still touch the degenerate vertex. They cover
   * `r < INNER`, which projects ABOVE `ndc.y = 1` — off the top of the screen — for exactly the
   * camera angles where the degeneracy exists, and when you look up far enough to see the zenith
   * the centre vertex has a healthy `w` and interpolates like any other.
   */
  Sky.DISC_RINGS = 24;
  Sky.DISC_SEGS = 16;
  Sky.DISC_INNER = 8;

  Sky.buildSkyDiscMesh = function (y, rings, segs, inner) {
    rings = rings || Sky.DISC_RINGS; segs = segs || Sky.DISC_SEGS;
    inner = inner === undefined ? Sky.DISC_INNER : inner;
    var R = Sky.DISC_RADIUS;
    // vanilla's own sign trick, kept: the X term carries `signum(y)`, which mirrors the dark
    // disc's fan and is what makes it face DOWN. Nothing here culls, but the two meshes stay
    // the same shape they always were.
    var sx = (y > 0 ? 1 : y < 0 ? -1 : 0);
    var radii = [0];
    for (var k = 0; k <= rings; k++) radii.push(inner * Math.pow(R / inner, k / rings));
    var out = [];
    var at = function (r, i) {
      var a = (i % segs) * (Math.PI * 2 / segs);
      out.push(sx * r * Math.cos(a), y, r * Math.sin(a));
    };
    for (var ri = 0; ri < radii.length - 1; ri++) {
      var r0 = radii[ri], r1 = radii[ri + 1];
      for (var i = 0; i < segs; i++) {
        if (r0 === 0) { at(0, 0); at(r1, i); at(r1, i + 1); continue; }
        at(r0, i); at(r1, i); at(r1, i + 1);
        at(r0, i); at(r1, i + 1); at(r0, i + 1);
      }
    }
    return new Float32Array(out);
  };

  /**
   * The celestial transform: `rotateY(-90°)` then `rotateX(timeOfDay * 360°)`, which is exactly
   * the two `mulPose` calls in `renderSky`. ⚠ THE ORDER AND THE MINUS SIGN BOTH MATTER — swap
   * them and the sun rises in the north.
   */
  Sky.celestialMatrix = function (out, dayTime) {
    var t = Sky.timeOfDay(dayTime) * Math.PI * 2;    // `* 360` degrees, in radians
    var cy = Math.cos(-Math.PI / 2), sy = Math.sin(-Math.PI / 2);
    var cx = Math.cos(t), sx = Math.sin(t);
    // column-major, the layout both backends upload verbatim (see `U.mat4`'s header)
    // Ry(-90) then Rx(t)  ->  M = Rx * Ry
    out[0] = cy;        out[1] = sx * sy;   out[2] = -cx * sy;  out[3] = 0;
    out[4] = 0;         out[5] = cx;        out[6] = sx;        out[7] = 0;
    out[8] = sy;        out[9] = -sx * cy;  out[10] = cx * cy;  out[11] = 0;
    out[12] = 0;        out[13] = 0;        out[14] = 0;        out[15] = 1;
    return out;
  };

  /**
   * The sun and the moon, as two quads in the celestial frame: `(±size, dist, ±size)`, in
   * vanilla's own vertex order with its own UVs (0,0) (1,0) (1,1) (0,1).
   *
   * ⚠ THE HEIGHT IS THE SECOND COMPONENT, NOT THE THIRD, AND THE SUN IS AT **+100** WITH THE
   * MOON AT −100 — opposite ends of the same axis, which is why they are never both up. The
   * first version of this file had them on Z and the wrong way round, and the check caught it
   * with the one anchor a player can verify by looking up: at noon the sun must be overhead.
   */
  Sky.celestialQuad = function (size, dist) {
    return new Float32Array([
      -size, dist, -size,   size, dist, -size,   size, dist, size,   -size, dist, size
    ]);
  };

  /**
   * `moon_phases.png` is a FOUR-BY-TWO grid and the phase indexes it:
   *     k = phase % 4;  l = (phase / 4) % 2;
   *     u0 = k / 4, v0 = l / 2, u1 = (k + 1) / 4, v1 = (l + 1) / 2
   */
  Sky.moonUV = function (phase) {
    var k = ((phase % 4) + 4) % 4;
    var l = (Math.floor(phase / 4) % 2 + 2) % 2;
    return [k / 4, l / 2, (k + 1) / 4, (l + 1) / 2];
  };

  // ── weather ───────────────────────────────────────────────────────────────────────────────
  /**
   * `ServerLevel.advanceWeatherCycle`, exactly. ⚠ EVERY NUMBER HERE WAS WRONG IN THIS FILE'S
   * FIRST VERSION, WRITTEN FROM MEMORY, AND THE BYTECODE CORRECTED ALL OF THEM (D-300):
   *
   *   - the four ranges are `Mth.randomBetweenInclusive(random, min, max)` — an INCLUSIVE pair,
   *     not `min + nextInt(span)`, so each is one tick wider than the obvious reading;
   *   - the "not raining" and "not thundering" ranges are the SAME, 12000..180000, and the file
   *     first had 12000+rand(168000) for one and a different shape for the other;
   *   - ⚠⚠ **the levels move by `0.01` PER TICK, not by `1/12000`.** A storm therefore fades in
   *     over a hundred ticks — five seconds — and not over ten minutes. That one number is the
   *     difference between weather that arrives and weather that creeps.
   *
   *   thundering -> 3600..15600      not thundering -> 12000..180000
   *   raining    -> 12000..24000     not raining    -> 12000..180000
   */
  Sky.THUNDER_RANGE = [3600, 15600];
  Sky.RAIN_RANGE = [12000, 24000];
  Sky.CLEAR_RANGE = [12000, 180000];
  Sky.LEVEL_DELTA = 0.01;

  Sky.newWeather = function () {
    return { clearTime: 0, rainTime: 0, thunderTime: 0, raining: false, thundering: false,
             rainLevel: 0, thunderLevel: 0, oRainLevel: 0, oThunderLevel: 0 };
  };

  /**
   * One tick. `nextInt(bound)` is the caller's integer source, so a check can drive it
   * deterministically; vanilla draws from the level's own `Random`.
   *
   * ⚠ THE `clearWeatherTime` BRANCH DOES MORE THAN COUNT DOWN. While it is running it FORCES
   * both flags off and sets each timer to 0 or 1 depending on the flag it is clearing — so
   * `/weather clear 600` really does suppress a storm rather than pause it, and the storm does
   * not resume where it left off. A version that only decrements looks identical until someone
   * uses the command.
   */
  Sky.tickWeather = function (wx, nextInt) {
    var between = function (r) { return nextInt(r[1] - r[0] + 1) + r[0]; };
    if (wx.clearTime > 0) {
      wx.clearTime--;
      wx.thunderTime = wx.thundering ? 0 : 1;
      wx.rainTime = wx.raining ? 0 : 1;
      wx.thundering = false;
      wx.raining = false;
    } else {
      if (wx.thunderTime > 0) {
        wx.thunderTime--;
        if (wx.thunderTime === 0) wx.thundering = !wx.thundering;
      } else {
        wx.thunderTime = between(wx.thundering ? Sky.THUNDER_RANGE : Sky.CLEAR_RANGE);
      }
      if (wx.rainTime > 0) {
        wx.rainTime--;
        if (wx.rainTime === 0) wx.raining = !wx.raining;
      } else {
        wx.rainTime = between(wx.raining ? Sky.RAIN_RANGE : Sky.CLEAR_RANGE);
      }
    }
    return Sky.rampWeather(wx);
  };

  /** The gradient ramps: vanilla runs them OUTSIDE the doWeatherCycle gate (ServerWorld.tickWeather
   *  :593-603), so /weather clear still stops rain with the cycle off. */
  Sky.rampWeather = function (wx) {
    wx.oThunderLevel = wx.thunderLevel;
    wx.thunderLevel = clamp01(wx.thunderLevel + (wx.thundering ? Sky.LEVEL_DELTA : -Sky.LEVEL_DELTA));
    wx.oRainLevel = wx.rainLevel;
    wx.rainLevel = clamp01(wx.rainLevel + (wx.raining ? Sky.LEVEL_DELTA : -Sky.LEVEL_DELTA));
    return wx;
  };

  /** `Level.isRaining()` = rainGradient > 0.2 (the RAMP, not the flag; World.java:759). The epsilon
   *  absorbs the double-vs-float drift of summing 0.01 twenty times (vanilla: false at tick 20). */
  Sky.isRaining = function (wx) { wx = wx || Sky.weather; return !!wx && wx.rainLevel > 0.2 + 1e-9; };

  /** `Level.getThunderLevel` — the thunder ramp SCALED BY the rain ramp, not independent. */
  Sky.thunderLevelOf = function (wx) { return wx.thunderLevel * wx.rainLevel; };

  /**
   * `Level.isRainingAt(pos)` — it is falling on this cell when it is raining, the cell can see
   * the sky, nothing in that column is above it, and the biome there has precipitation.
   *
   * ⚠ THE SNOW/RAIN CHOICE IS **NOT REIMPLEMENTED HERE**. `Biomes.warmEnoughToRain` and
   * `Biomes.snowsAt` already carry vanilla's height-adjusted temperature rule — W5 built them
   * for the surface builder's snow cap — and a second copy of a rule is two truths (D-139).
   * This module asks them; it does not re-derive them.
   */
  Sky.NONE = 0; Sky.RAIN = 1; Sky.SNOW = 2;
  Sky.precipitationAt = function (biome, x, y, z) {
    var B = NS.Biomes;
    if (!B || !B.ready) return Sky.NONE;
    if (B.precipitation && B.precipitation(biome) === 0) return Sky.NONE;
    if (B.snowsAt(biome, x, y, z)) return Sky.SNOW;
    return B.warmEnoughToRain(biome, x, y, z) ? Sky.RAIN : Sky.NONE;
  };

  /** `getTopPosition(MOTION_BLOCKING, x, z).getY()` (#377): the live roof height (Weather.motionTop,
   *  glass/leaves/water count, block edits seen), else the generation heightmap + 1. */
  Sky.roofTop = function (x, z) {
    var Wx = NS.Weather, W = NS.World;
    if (Wx && Wx.motionTop && W && W.get && W.get(x >> 4, z >> 4)) return Wx.motionTop(x, z);
    return W && W.heightAt ? W.heightAt(x, z) + 1 : undefined;
  };
  /** D-649: `Entity.isBeingRainedOn()` = `hasRain(blockPos) || hasRain(x, boundingBox.maxY, z)`
   *  (.decomp Entity.java), on the live weather and the column's own biome/heightmap. */
  Sky.isEntityRainedOn = function (e) {
    var W = NS.World;
    if (!e || !W || !W.biomeAt || !W.heightAt || !Sky.weather || !Sky.isRaining(Sky.weather)) return false;
    var x = Math.floor(e.x), z = Math.floor(e.z), top = Sky.roofTop(x, z), bio;
    try { bio = W.biomeAt(x, z); } catch (err) { return false; }
    var y0 = Math.floor(e.y), y1 = Math.floor(e.y + (e.height || 0));
    return Sky.isRainingAt(Sky.weather, bio, x, y0, z, true, top) || Sky.isRainingAt(Sky.weather, bio, x, y1, z, true, top);
  };
  /**
   * @param seesSky   the cell has sky access
   * @param heightAt  the highest motion-blocking block in that column; rain stops at a roof
   */
  Sky.isRainingAt = function (wx, biome, x, y, z, seesSky, heightAt) {
    if (!Sky.isRaining(wx) || !seesSky) return false;
    if (heightAt !== undefined && heightAt > y) return false;
    return Sky.precipitationAt(biome, x, y, z) === Sky.RAIN;
  };

  // ── the clock ─────────────────────────────────────────────────────────────────────────────
  /**
   * The world's own state: a day time in ticks and a weather machine.
   *
   * ⚠ `dayTime` STARTS AT 1000, WHICH IS WHERE VANILLA PUTS A NEW WORLD — mid-morning, sun well
   * up, not at dawn and certainly not at midnight. A world that opens at tick 0 looks like dusk
   * for the first minute and is the sort of thing that reads as a bug before anyone can say why.
   */
  Sky.NEW_WORLD_TIME = 1000;
  Sky.dayTime = Sky.NEW_WORLD_TIME;
  Sky.weather = null;
  /** `doDaylightCycle` — the gamerule. A check and `/time set` both want to stop the clock. */
  Sky.daylightCycle = true;
  Sky.weatherCycle = true;

  /** One game tick of the world's sky: the clock, then the weather. */
  Sky.tick = function () {
    if (Sky.daylightCycle) Sky.dayTime++;
    if (Sky.weather) {
      if (Sky.weatherCycle) Sky.tickWeather(Sky.weather, function (n) { return (Math.random() * n) | 0; });
      else Sky.rampWeather(Sky.weather);
    }
    return Sky.dayTime;
  };

  /**
   * `DimensionEffects` (.decomp/net/minecraft/client/render/DimensionEffects.java): the three built-ins.
   * skyType NORMAL draws disc + sun/moon/stars; NONE (Nether) and END draw none of them (the End's own
   * sky box is OWED, #263). `fogMul` is adjustFogColor for the two non-overworld types (Nether identity,
   * End x0.15); `thickFog` is useThickFog (Nether only).
   */
  Sky.EFFECTS = {
    overworld: { skyType: 'normal', fogMul: null, thickFog: false, clouds: 192 },
    the_nether: { skyType: 'none', fogMul: 1, thickFog: true, clouds: NaN },
    the_end: { skyType: 'end', fogMul: Math.fround(0.15), thickFog: false, clouds: NaN }
  };
  Sky.effectsNow = function () {
    var t = NS.Dim && NS.Dim.current ? NS.Dim.current() : null;
    return Sky.EFFECTS[t && t.effects] || Sky.EFFECTS.overworld;
  };

  /** What a frame needs, in one call: the three colours and the light scale. */
  Sky.frame = function (biomeSky, biomeFog, renderDistanceChunks, lookX) {
    var wx = Sky.weather || Sky.newWeather();
    var rain = wx.rainLevel, thunder = Sky.thunderLevelOf(wx);
    var fx = Sky.effectsNow();
    if (fx.skyType !== 'normal') {
      // No day/night in these: the clear colour is the biome fog (x fogMul), the disc is painted the same.
      var m = fx.fogMul, bf = [biomeFog[0] * m, biomeFog[1] * m, biomeFog[2] * m];
      return {
        sky: bf, fog: bf, sunrise: null, skyDarken: 0, starBrightness: 0, celestial: false,
        skyType: fx.skyType, thickFog: fx.thickFog,
        moonPhase: Sky.moonPhase(Sky.dayTime), sunAngle: Sky.sunAngle(Sky.dayTime), rain: 0, thunder: 0
      };
    }
    var sky = Sky.skyColor(biomeSky, Sky.dayTime, rain, thunder);
    return {
      sky: sky,
      celestial: true, skyType: 'normal', thickFog: false,
      fog: Sky.fogColor(biomeFog, sky, Sky.dayTime, rain, thunder, renderDistanceChunks, lookX),
      sunrise: Sky.sunriseFan(Sky.skyAngleF(Sky.dayTime)),     // D-657, null outside the band window
      skyDarken: Sky.skyDarken(Sky.dayTime, rain, thunder),
      starBrightness: Sky.starBrightness(Sky.dayTime) * (1 - rain),
      moonPhase: Sky.moonPhase(Sky.dayTime),
      sunAngle: Sky.sunAngle(Sky.dayTime),
      rain: rain, thunder: thunder
    };
  };

  Sky.toJSON = function () {
    var wx = Sky.weather || Sky.newWeather();
    return { t: Math.floor(Sky.dayTime), dc: !!Sky.daylightCycle, wc: !!Sky.weatherCycle,
             ct: wx.clearTime | 0, rt: wx.rainTime | 0, tt: wx.thunderTime | 0,
             r: !!wx.raining, th: !!wx.thundering,
             rl: wx.rainLevel, tl: wx.thunderLevel };
  };
  Sky.fromJSON = function (o) {
    if (!o || typeof o !== 'object') { Sky.dayTime = Sky.NEW_WORLD_TIME; Sky.weather = Sky.newWeather(); return; }
    var n = function (v, d) { v = +v; return isFinite(v) ? v : d; };
    Sky.dayTime = n(o.t, Sky.NEW_WORLD_TIME);
    Sky.daylightCycle = o.dc !== false;
    Sky.weatherCycle = o.wc !== false;
    var wx = Sky.newWeather();
    wx.clearTime = Math.max(0, n(o.ct, 0) | 0);
    wx.rainTime = Math.max(0, n(o.rt, 0) | 0);
    wx.thunderTime = Math.max(0, n(o.tt, 0) | 0);
    wx.raining = !!o.r; wx.thundering = !!o.th;
    // vanilla World.initWeatherGradients: gradients are not saved, they snap to the flags (rl/tl in old saves are ignored)
    wx.rainLevel = wx.raining ? 1 : 0;
    wx.thunderLevel = wx.raining && wx.thundering ? 1 : 0;
    Sky.weather = wx;
  };

  Sky.init = function () {
    if (!Sky.weather) Sky.weather = Sky.newWeather();
    Sky.ready = true;
    return Sky;
  };
})(MCL);
