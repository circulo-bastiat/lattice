#!/usr/bin/env node
// skycheck.mjs — PLAN G16. The sky's NUMBERS, without a canvas.
//
//   node tools/skycheck.mjs [--quiet]
//
// ⚠ THE SKY IS A RENDERING STAGE WITH A PARITY CORE, AND THIS FILE IS THE CORE (D-300). The
// picture — a dome, two quads and 1,500 star quads — may be cheap; the numbers may not. The time
// of day, the moon's phase, the colour of the sky at this minute, how dark it goes in a storm,
// how far you can see and when the rain starts are all things a player can see being wrong, and
// every one of them is compiled Java in vanilla with no JSON behind it.
//
// ⚠ EVERY EXPECTED VALUE HERE IS COMPUTED FROM VANILLA'S OWN FORMULA WRITTEN OUT A SECOND TIME,
// not copied from the engine. Where the two implementations are the same three lines that would
// be a tautology, so the assertions are SHAPE and ANCHOR instead: noon is the brightest minute
// of the day, midnight the darkest, the day is symmetric about noon, the phase advances once per
// day and wraps after eight, the star field is bit-identical across two builds, and a storm takes
// a hundred ticks to arrive. A formula asserted against itself proves nothing (D-263's rule, in
// its check-shaped form).

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const QUIET = process.argv.includes('--quiet');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; if (!QUIET) console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (!QUIET) console.log(...a); };
const near = (a, b, eps) => Math.abs(a - b) <= (eps === undefined ? 1e-6 : eps);

const M = loadEngine({ extra: ['02f_tags.js', '09b_sky.js'], dom: false });
const Sky = M.Sky;
Sky.init();

console.log('skycheck — PLAN G16, the sky\'s numbers (D-300)');

// ═══════════ 1. the day is not linear ══════════════════════════════════════════════════════
say('\n1. the day, and why it is not a straight line');
{
  // ⚠⚠ NOON IS **ZERO**, NOT 0.25, AND THAT IS THE FIRST THING THIS CHECK GOT WRONG. `timeOfDay`
  // is the SUN'S ANGLE as a fraction of a turn, and the sun is overhead — angle 0 — at dayTime
  // 6000. The `- 0.25` in the formula is what moves it there from the raw `dayTime / 24000`.
  // Writing the anchors from "the day starts at dawn, so dawn is 0" is the memory-shaped
  // mistake; the formula, taken from the bytecode, says otherwise and the formula is right.
  //
  //   dayTime  6000 noon      -> 0            12000 dusk      -> 0.2155
  //   dayTime 18000 midnight  -> 0.5          0/24000 dawn    -> 0.7845
  ok(near(Sky.timeOfDay(6000), 0), `noon (6000) is ${Sky.timeOfDay(6000)}, expected 0`);
  ok(near(Sky.timeOfDay(18000), 0.5), `midnight (18000) is ${Sky.timeOfDay(18000)}, expected 0.5`);
  ok(near(Sky.timeOfDay(0), 0.7845178, 1e-6), `dawn (tick 0) is ${Sky.timeOfDay(0).toFixed(6)}`);
  ok(near(Sky.timeOfDay(12000), 0.2154822, 1e-6), `dusk (12000) is ${Sky.timeOfDay(12000).toFixed(6)}`);
  ok(near(Sky.timeOfDay(24000), Sky.timeOfDay(0)), 'and it wraps after a full day');

  // ⚠ NOT LINEAR: the curve leads a straight line in the first half of each quarter and lags in
  // the second. If it were `dayTime / 24000` the two would be identical everywhere, and this is
  // the assertion that separates them.
  let maxGap = 0;
  for (let t = 0; t < 24000; t += 25) {
    maxGap = Math.max(maxGap, Math.abs(Sky.timeOfDay(t) - (t / 24000 + 0.75) % 1));
  }
  ok(maxGap > 0.02, `the curve departs from a straight line by up to ${maxGap.toFixed(4)}`);
  // ⚠ MONOTONE FROM NOON TO NOON, not from tick 0: the wrap is at 6000, where `frac` rolls over.
  let monotone = true;
  for (let t = 6001; t < 6000 + 24000; t++) {
    if (Sky.timeOfDay(t) < Sky.timeOfDay(t - 1) - 1e-9) monotone = false;
  }
  ok(monotone === true, 'and it rises monotonically through a whole day measured from noon');

  // ⚠ SYMMETRY ABOUT NOON. `0.5 - cos(d*π)/2` is even, so `t(6000 + k)` and `t(6000 - k)` are
  // mirror images about a full turn. A missing `- 0.25` breaks this at once.
  let sym = 0;
  for (let k = 100; k < 6000; k += 100) {
    sym = Math.max(sym, Math.abs(Sky.timeOfDay(6000 + k) - (1 - Sky.timeOfDay(6000 - k))));
  }
  ok(sym < 1e-6, `the day is symmetric about noon to ${sym.toExponential(1)}`);
  say(`   noon 0 · dusk 0.2155 · midnight 0.5 · dawn 0.7845 · max departure ${maxGap.toFixed(4)}`);
}
say(`   ${pass} ok`);

// ═══════════ 2. the moon ═══════════════════════════════════════════════════════════════════
say('\n2. the moon: eight phases, and the wrap that needs two modulos');
{
  const seen = [];
  for (let d = 0; d < 16; d++) seen.push(Sky.moonPhase(d * 24000));
  ok(seen.slice(0, 8).join('') === '01234567', `the first eight days are ${seen.slice(0, 8).join('')}`);
  ok(seen.slice(8).join('') === '01234567', 'and it repeats');
  ok(Sky.moonPhase(23999) === 0 && Sky.moonPhase(24000) === 1,
     'the phase changes at the day boundary and not before');
  // ⚠ THE NEGATIVE CASE. `/time set` can produce a negative dayTime, and a single `%` gives a
  // negative index into an eight-frame texture. All eight must be in range for a whole day
  // either side of zero.
  let bad = 0;
  for (let t = -200000; t < 200000; t += 997) {
    const p = Sky.moonPhase(t);
    if (!(p >= 0 && p < 8 && p === Math.floor(p))) bad++;
  }
  ok(bad === 0, `${bad} of 400 sampled times gave a phase outside 0..7`);
  ok(Sky.moonPhase(-24000) === 7, `one day before the epoch is phase ${Sky.moonPhase(-24000)}, not -1`);
}
say(`   ${pass} ok`);

// ═══════════ 3. brightness ═════════════════════════════════════════════════════════════════
say('\n3. sky darkness and star brightness, across a day');
{
  const dark = [];
  for (let t = 0; t < 24000; t += 500) dark.push([t, Sky.skyDarken(t, 0, 0)]);
  // ⚠ BOTH ENDS ARE PLATEAUX, NOT PEAKS. The ramp is CLAMPED, so `skyDarken` sits at exactly 1
  // for about a third of the day and at exactly 0.2 for another third — an argmax over samples
  // picks whichever plateau tick came first, which is not a fact about the sky. Assert the
  // VALUES at the named minutes, and the extremes of the whole curve.
  const values = dark.map((d) => d[1]);
  ok(near(Sky.skyDarken(6000, 0, 0), 1, 1e-6), `noon reads ${Sky.skyDarken(6000, 0, 0)}, expected 1`);
  ok(near(Math.max(...values), 1, 1e-6), 'and 1 is the maximum the curve reaches');
  // ⚠ IT NEVER REACHES ZERO. `f * 0.8 + 0.2` — midnight sky light is a fifth, which is why you
  // can still see outdoors. A ramp to 0 makes night pitch black and is the classic clone bug.
  ok(near(Sky.skyDarken(18000, 0, 0), 0.2, 1e-6),
     `midnight reads ${Sky.skyDarken(18000, 0, 0)}, expected exactly 0.2 and not 0`);
  ok(near(Math.min(...values), 0.2, 1e-6), 'and 0.2 is the minimum');
  // ⚠ AND THERE IS A REAL RAMP BETWEEN THEM — measured, not assumed at a guessed tick. The
  // transition is narrow (the cosine only crosses the unclamped window for a few hundred ticks
  // either side of dusk and dawn), so picking "mid-afternoon" lands on the plateau, which is
  // what the first version of this assertion did.
  let between = 0, firstRamp = -1;
  for (let t = 0; t < 24000; t++) {
    const v = Sky.skyDarken(t, 0, 0);
    if (v > 0.2 + 1e-6 && v < 1 - 1e-6) { between++; if (firstRamp < 0) firstRamp = t; }
  }
  ok(between > 100, `${between} ticks of the day are on the ramp rather than on a plateau`);
  // the ramp sits around dawn and dusk, not around noon or midnight
  let rampNearNoon = 0;
  for (let t = 4000; t < 8000; t++) {
    const v = Sky.skyDarken(t, 0, 0);
    if (v > 0.2 + 1e-6 && v < 1 - 1e-6) rampNearNoon++;
  }
  ok(firstRamp >= 0 && rampNearNoon === 0,
     `the ramp runs from tick ${firstRamp} and none of it is within 2000 ticks of noon`);
  for (const [, v] of dark) ok(v >= 0.2 - 1e-6 && v <= 1 + 1e-6, 'every sample is inside 0.2 … 1');

  // rain and thunder each take 5/16 off, multiplicatively
  const clear = Sky.skyDarken(6000, 0, 0);
  const rainy = Sky.skyDarken(6000, 1, 0);
  const storm = Sky.skyDarken(6000, 1, 1);
  ok(rainy < clear && storm < rainy, `noon reads ${clear} clear, ${rainy} in rain, ${storm} in a storm`);
  ok(near(rainy, ((1 - 5 / 16) * 0.8 + 0.2), 1e-5), 'and full rain takes exactly 5/16 off the ramp');

  // stars: dark at noon, out at midnight, and never more than half
  const starNoon = Sky.starBrightness(6000), starMid = Sky.starBrightness(18000);
  ok(starNoon === 0, `no stars at noon (${starNoon})`);
  ok(near(starMid, 0.5, 1e-5), `full stars at midnight read ${starMid}, and the cap is 0.5`);
  // ⚠ THE RAMP IS SQUARED, so at the halfway point of the visible window it is a QUARTER, not
  // a half. A linear ramp pops the stars on at dusk.
  let maxStar = 0, linearMax = 0;
  for (let t = 0; t < 24000; t += 100) {
    const s = Sky.starBrightness(t);
    maxStar = Math.max(maxStar, s);
    const lin = Math.max(0, Math.min(1, 1 - (Math.cos(Sky.timeOfDay(t) * 6.2831855) * 2 + 0.25))) * 0.5;
    linearMax = Math.max(linearMax, Math.abs(s - lin));
  }
  ok(near(maxStar, 0.5, 1e-5), 'the stars never exceed 0.5');
  ok(linearMax > 0.05, `the squared ramp differs from a linear one by up to ${linearMax.toFixed(3)}`);
}
say(`   ${pass} ok`);

// ═══════════ 4. colour ═════════════════════════════════════════════════════════════════════
say('\n4. the sky and fog colours');
{
  const PLAINS = Sky.rgb24(0x78A7FF);          // vanilla's plains sky_color
  ok(near(PLAINS[0], 0x78 / 255) && near(PLAINS[1], 0xA7 / 255) && near(PLAINS[2], 0xFF / 255),
     'a 0xRRGGBB unpacks to three 0..1 floats');

  const noon = Sky.skyColor(PLAINS, 6000, 0, 0);
  const mid = Sky.skyColor(PLAINS, 18000, 0, 0);
  ok(noon[0] > 0.4 && noon[2] > 0.9, `noon is bright blue (${noon.map((v) => v.toFixed(2)).join(',')})`);
  // ⚠ THE NIGHT SKY IS BLACK, NOT DARK BLUE. The clamped cosine bottoms out at zero, and the
  // stars are what you see instead. A sky that keeps its hue at midnight is the commonest
  // mistake in this stage.
  ok(mid[0] === 0 && mid[1] === 0 && mid[2] === 0, `midnight is exactly black (${mid.join(',')})`);

  // rain desaturates toward luma; it does not multiply toward black
  const wet = Sky.skyColor(PLAINS, 6000, 1, 0);
  const dimmed = noon.map((v) => v * 0.25);
  const wetSpread = Math.max(...wet) - Math.min(...wet);
  const drySpread = Math.max(...noon) - Math.min(...noon);
  ok(wetSpread < drySpread, `rain narrows the channel spread from ${drySpread.toFixed(3)} to ${wetSpread.toFixed(3)}`);
  ok(!near(wet[0], dimmed[0], 0.01), 'and it is NOT the same as simply dimming the colour');
  const luma = (noon[0] * 0.3 + noon[1] * 0.59 + noon[2] * 0.11) * 0.6;
  const k = 1 - 1 * 0.75;
  ok(near(wet[0], noon[0] * k + luma * (1 - k), 1e-6), 'the red channel matches the luma mix exactly');

  // fog: the blue channel keeps more than red and green, by 0.91/0.09 against 0.94/0.06
  const fogBase = Sky.rgb24(0xC0D8FF);
  const b = Sky.fogBrightness(6000);
  const fb = Sky.biomeFogColor([1, 1, 1], 0);
  ok(near(fb[0], 0.06) && near(fb[1], 0.06) && near(fb[2], 0.09),
     `at zero brightness the fog floor is ${fb.map((v) => v.toFixed(3)).join(',')} — blue keeps more`);
  ok(fb[2] > fb[0], '...which is what stops the fog going grey at midnight');
  const fb1 = Sky.biomeFogColor([1, 1, 1], 1);
  ok(near(fb1[0], 1) && near(fb1[2], 1), 'and at full brightness it is the biome colour unchanged');

  // the render-distance blend really depends on render distance
  const near4 = Sky.fogSkyBlend(4), far32 = Sky.fogSkyBlend(32);
  ok(near4 > far32, `the sky blend is ${near4.toFixed(3)} at 4 chunks and ${far32.toFixed(3)} at 32`);
  ok(near(far32, 0, 1e-6), 'and is exactly zero at 32 chunks, where `pow(1, 0.25)` is 1');

  // rain darkens red and green more than blue; thunder darkens all three the same
  const sky = Sky.skyColor(PLAINS, 6000, 0, 0);
  const dry = Sky.fogColor(fogBase, sky, 6000, 0, 0, 12);
  const rain = Sky.fogColor(fogBase, sky, 6000, 1, 0, 12);
  const thun = Sky.fogColor(fogBase, sky, 6000, 0, 1, 12);
  ok(near(rain[0] / dry[0], 0.5, 1e-5) && near(rain[2] / dry[2], 0.6, 1e-5),
     `rain scales red by ${(rain[0] / dry[0]).toFixed(2)} and blue by ${(rain[2] / dry[2]).toFixed(2)}`);
  ok(near(thun[0] / dry[0], 0.5, 1e-5) && near(thun[2] / dry[2], 0.5, 1e-5),
     'thunder scales all three channels by the same 0.5');
}
say(`   ${pass} ok`);

// ═══════════ 5. the biome blend ════════════════════════════════════════════════════════════
say('\n5. the 6x6x6 cubic blend between biomes');
{
  const A = [1, 0, 0], B = [0, 0, 1];
  // a hard border at quart x = 0: everything west is A, everything east is B
  const at = (x) => (x < 0 ? A : B);
  const sample = (x) => Sky.blendedColor(x, 64, 0, (qx) => at(qx));
  const deep = sample(-400), far = sample(400);
  ok(near(deep[0], 1, 1e-9) && near(deep[2], 0, 1e-9), 'deep inside A the blend is pure A');
  ok(near(far[0], 0, 1e-9) && near(far[2], 1, 1e-9), 'deep inside B it is pure B');
  // ⚠ AND IT IS A RAMP, NOT A STEP. The kernel spans six quarts = 24 blocks, so the transition
  // has to take tens of blocks. A nearest sample would jump in one.
  let first = null, last = null;
  for (let x = -60; x <= 60; x++) {
    const c = sample(x);
    if (c[2] > 1e-6 && first === null) first = x;
    if (c[2] < 1 - 1e-6) last = x;
  }
  ok(first !== null && last !== null && last - first >= 15,
     `the border takes ${last - first} blocks to cross, not one`);
  // monotone across the border, which a mis-ordered kernel would break
  let mono = true, prev = -1;
  for (let x = -60; x <= 60; x++) { const v = sample(x)[2]; if (v < prev - 1e-9) mono = false; prev = v; }
  ok(mono === true, 'and the crossing is monotone');
  // the weights are normalised: a uniform field comes back unchanged
  const flat = Sky.blendedColor(37, 71, -13, () => [0.3, 0.4, 0.5]);
  ok(near(flat[0], 0.3, 1e-9) && near(flat[1], 0.4, 1e-9) && near(flat[2], 0.5, 1e-9),
     'a uniform field survives the blend exactly — the weights sum to one');
}
say(`   ${pass} ok`);

// ═══════════ 6. the star field ═════════════════════════════════════════════════════════════
say('\n6. 1,500 candidates, fewer than 1,500 stars');
{
  const stars = Sky.buildStars();
  ok(stars !== null, 'the star field builds');
  const count = stars.length / 12;                     // 4 vertices x 3 floats
  // ⚠ THE YIELD IS THE VOLUME OF THE UNIT BALL OVER THE CUBE IT IS DRAWN FROM — π/6 ≈ 0.5236 —
  // so about 785 of 1,500 survive, not "nearly 1,500". A loop that kept every candidate would
  // give exactly 1,500 and put every star in the wrong place; one that re-drew after a reject
  // would give 1,500 too. The count IS the evidence that the rejection loop is vanilla's.
  ok(count > 700 && count < 880,
     `${count} of 1,500 candidates survive — the unit ball is π/6 of its cube, so ~785`);
  ok(Math.abs(count / 1500 - Math.PI / 6) < 0.05,
     `the yield is ${(count / 1500).toFixed(4)} against π/6 = ${(Math.PI / 6).toFixed(4)}`);
  ok(stars.length % 12 === 0, 'and every star is exactly four vertices');

  // every star sits on the sphere of radius 100, within its own quad size
  let minR = Infinity, maxR = 0;
  for (let i = 0; i < stars.length; i += 3) {
    const r = Math.hypot(stars[i], stars[i + 1], stars[i + 2]);
    minR = Math.min(minR, r); maxR = Math.max(maxR, r);
  }
  ok(minR > 99 && maxR < 101, `every vertex is ${minR.toFixed(2)}..${maxR.toFixed(2)} from the origin`);

  // ⚠ BIT-IDENTICAL ACROSS TWO BUILDS. The seed is a literal 10842 and the draw order is fixed,
  // so two engines must produce the same array — which is the only way to know the LCG and the
  // rejection loop both match vanilla's.
  const M2 = loadEngine({ extra: ['02f_tags.js', '09b_sky.js'], dom: false });
  M2.Sky.init();
  const again = M2.Sky.buildStars();
  let same = again.length === stars.length;
  if (same) for (let i = 0; i < stars.length; i++) if (again[i] !== stars[i]) { same = false; break; }
  ok(same === true, 'a second engine builds a bit-identical field');

  // and they are spread over the whole sphere rather than a cap
  let up = 0, down = 0;
  for (let i = 0; i < stars.length; i += 12) (stars[i + 1] > 0 ? up++ : down++);
  ok(up > count * 0.3 && down > count * 0.3, `${up} above the horizon and ${down} below`);
  say(`   ${count} stars · radius ${minR.toFixed(2)}..${maxR.toFixed(2)}`);
}
say(`   ${pass} ok`);

// ═══════════ 6b. the geometry the sky is drawn from ════════════════════════════════════════
say('\n6b. the disc, the two quads and the moon grid (G16b)');
{
  // ⚠ THE SIGN ON THE DARK DISC IS THE WHOLE ASSERTION. `buildSkyDisc` puts `signum(y) * 512` on
  // the X term and a bare `512` on Z, so the lower disc is MIRRORED and therefore faces down.
  // Two discs built the same way are two discs facing the same way, and the one under your feet
  // is back-face culled — a hole in the sky that only shows when you look down.
  const up = Sky.buildSkyDisc(Sky.SKY_DISC_Y);
  const dn = Sky.buildSkyDisc(Sky.DARK_DISC_Y);
  ok(up.length === 30 && dn.length === 30, `ten vertices each (${up.length / 3}, ${dn.length / 3})`);
  ok(up[0] === 0 && up[1] === Sky.SKY_DISC_Y && up[2] === 0, 'the fan starts at its centre');
  ok(dn[1] === Sky.DARK_DISC_Y, 'and the dark disc sits below');
  let mirrored = 0;
  for (let i = 3; i < up.length; i += 3) {
    if (Math.abs(up[i] + dn[i]) < 1e-3 && Math.abs(up[i + 2] - dn[i + 2]) < 1e-3) mirrored++;
  }
  ok(mirrored === 9, `all ${mirrored} rim points are mirrored in X and shared in Z`);
  let radius = 0;
  for (let i = 3; i < up.length; i += 3) radius = Math.max(radius, Math.hypot(up[i], up[i + 2]));
  ok(Math.abs(radius - Sky.DISC_RADIUS) < 1e-3, `the rim is at ${radius.toFixed(1)}, vanilla's 512`);
  // the step is 45 degrees from -180 to 180 inclusive, so the first and last points coincide
  ok(Math.abs(up[3] - up[up.length - 3]) < 1e-3 && Math.abs(up[5] - up[up.length - 1]) < 1e-3,
     'the fan closes — its first and last rim points are the same');

  // the two quads
  const sun = Sky.celestialQuad(Sky.SUN_SIZE, Sky.CELESTIAL_DIST);
  const moon = Sky.celestialQuad(Sky.MOON_SIZE, -Sky.CELESTIAL_DIST);
  ok(sun.length === 12 && moon.length === 12, 'four vertices each');
  ok(Math.abs(sun[1]) === Sky.CELESTIAL_DIST && Math.abs(moon[1]) === Sky.CELESTIAL_DIST,
     'both sit a hundred units out');
  // ⚠ OPPOSITE ENDS OF THE SAME AXIS, which is why they are never both up.
  ok(sun[1] === -moon[1], `the sun is at ${sun[1]} and the moon at ${moon[1]}`);
  ok(Sky.SUN_SIZE > Sky.MOON_SIZE, 'and the sun is the bigger of the two (30 against 20)');

  // the celestial transform: it is a ROTATION, so it preserves length and the sun goes round
  const m = Sky.celestialMatrix(new Float64Array(16), 6000);
  const apply = (mm, v) => [
    mm[0] * v[0] + mm[4] * v[1] + mm[8] * v[2],
    mm[1] * v[0] + mm[5] * v[1] + mm[9] * v[2],
    mm[2] * v[0] + mm[6] * v[1] + mm[10] * v[2]
  ];
  const len = (v) => Math.hypot(v[0], v[1], v[2]);
  ok(near(len(apply(m, [0, 100, 0])), 100, 1e-9), 'the transform preserves length — it is a rotation');
  // ⚠ AND THE SUN IS OVERHEAD AT NOON. That is the one anchor a player can check by looking up,
  // and it is what pins the -90 and the order of the two rotations together.
  const noonSun = apply(Sky.celestialMatrix(new Float64Array(16), 6000), [0, 100, 0]);
  ok(noonSun[1] > 95, `at noon the sun is at y=${noonSun[1].toFixed(1)} — overhead`);
  const midSun = apply(Sky.celestialMatrix(new Float64Array(16), 18000), [0, 100, 0]);
  ok(midSun[1] < -95, `at midnight it is at y=${midSun[1].toFixed(1)} — under the world`);
  const midMoon = apply(Sky.celestialMatrix(new Float64Array(16), 18000), [0, -100, 0]);
  ok(midMoon[1] > 95, `and the moon is overhead at midnight (y=${midMoon[1].toFixed(1)})`);
  // it travels: sample a day and the sun must trace a full circle
  let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
  for (let t = 0; t < 24000; t += 250) {
    const v = apply(Sky.celestialMatrix(new Float64Array(16), t), [0, 100, 0]);
    minY = Math.min(minY, v[1]); maxY = Math.max(maxY, v[1]);
    minX = Math.min(minX, v[0]); maxX = Math.max(maxX, v[0]);
  }
  ok(maxY > 99 && minY < -99, `the sun's height sweeps ${minY.toFixed(0)} … ${maxY.toFixed(0)}`);
  ok(maxX - minX < 1, `and it stays on one plane (x spans ${(maxX - minX).toExponential(1)})`);

  // the moon's eight frames tile a 4x2 grid exactly once
  const seen = new Set();
  for (let p = 0; p < 8; p++) {
    const uv = Sky.moonUV(p);
    ok(uv[2] - uv[0] === 0.25 && uv[3] - uv[1] === 0.5, `phase ${p} is one cell of a 4x2 grid`);
    seen.add(uv.join(','));
  }
  ok(seen.size === 8, `the eight phases use ${seen.size} distinct cells — the grid is covered once`);
  ok(Sky.moonUV(-1).every((v) => v >= 0 && v <= 1), 'and a negative phase still lands inside the texture');
  say(`   disc ${up.length / 3} verts · sun ${Sky.SUN_SIZE} · moon ${Sky.MOON_SIZE} · 8 phases`);
}
say(`   ${pass} ok`);

// ═══════════ 7. weather ════════════════════════════════════════════════════════════════════
say('\n7. the weather cycle');
{
  // a deterministic integer source, so the cycle is reproducible
  const seq = (seed) => { let s = seed >>> 0; return (n) => { s = (s * 1664525 + 1013904223) >>> 0; return s % n; }; };

  // ⚠ THE LEVELS MOVE BY 0.01 A TICK. A hundred ticks from dry to a full storm — five seconds,
  // not the ten minutes a `1/12000` delta would give. The first version of the module had
  // exactly that wrong and this assertion is what would have caught it.
  {
    const wx = Sky.newWeather();
    wx.raining = true; wx.rainTime = 100000;
    for (let i = 0; i < 100; i++) Sky.tickWeather(wx, seq(1));
    ok(near(wx.rainLevel, 1, 1e-6), `a hundred ticks of rain reaches level ${wx.rainLevel.toFixed(4)}`);
    for (let i = 0; i < 50; i++) Sky.tickWeather(wx, seq(1));
    ok(near(wx.rainLevel, 1, 1e-6), 'and it clamps at 1 rather than running past it');
    wx.raining = false;
    for (let i = 0; i < 50; i++) Sky.tickWeather(wx, seq(1));
    ok(near(wx.rainLevel, 0.5, 1e-6), `fifty ticks of clearing brings it back to ${wx.rainLevel.toFixed(2)}`);
  }

  // #376: isRaining() is the ramp (rainLevel > 0.2), not the flag (World.java:759)
  {
    const rampOk = () => {
      const wx = Sky.newWeather(); const r = [];
      wx.raining = true; wx.rainTime = 100000;
      for (let i = 1; i <= 21; i++) { Sky.tickWeather(wx, seq(1)); r[i] = Sky.isRaining(wx); }
      const up = !r[20] && r[21];
      for (let i = 0; i < 100; i++) Sky.tickWeather(wx, seq(1));
      wx.raining = false; wx.rainTime = 100000;
      for (let i = 0; i < 70; i++) Sky.tickWeather(wx, seq(1));
      return up && Sky.isRaining(wx);
    };
    ok(rampOk(), 'Sky.isRaining is false at tick 20, true at 21, and still true 70 ticks after the flag drops');
    const save = Sky.isRaining; Sky.isRaining = (wx) => !!(wx || Sky.weather).raining;
    okAv(!rampOk(), 'Sky.isRaining returning the flag is caught');
    Sky.isRaining = save;
  }

  // the ranges, measured by running the machine rather than read off the constants
  {
    const rnd = seq(12345);
    const wx = Sky.newWeather();
    const rainRuns = [], clearRuns = [];
    let wasRaining = wx.raining, run = 0;
    for (let t = 0; t < 4000000; t++) {
      Sky.tickWeather(wx, rnd);
      if (wx.raining === wasRaining) { run++; continue; }
      (wasRaining ? rainRuns : clearRuns).push(run);
      wasRaining = wx.raining; run = 0;
    }
    ok(rainRuns.length > 10 && clearRuns.length > 10,
       `${rainRuns.length} showers and ${clearRuns.length} dry spells in four million ticks`);
    const minRain = Math.min(...rainRuns), maxRain = Math.max(...rainRuns);
    const minClear = Math.min(...clearRuns);
    ok(minRain >= 12000 && maxRain <= 24000,
       `every shower lasts ${minRain}..${maxRain} ticks, inside vanilla's 12000..24000`);
    ok(minClear >= 12000, `and every dry spell is at least ${minClear} ticks`);
    // ⚠ RAIN IS THE SHORT ONE. Clear weather runs up to 180000 ticks and rain to 24000, so a
    // world is dry far more often than it is wet — the asymmetry is the whole feel of it.
    const avgRain = rainRuns.reduce((a, b) => a + b, 0) / rainRuns.length;
    const avgClear = clearRuns.reduce((a, b) => a + b, 0) / clearRuns.length;
    ok(avgClear > avgRain * 3,
       `dry spells average ${avgClear.toFixed(0)} ticks against ${avgRain.toFixed(0)} of rain`);
    say(`   showers ${minRain}..${maxRain} · dry spells from ${minClear}`);
  }

  // ⚠ `clearWeatherTime` FORCES BOTH FLAGS OFF, it does not merely count down.
  {
    const wx = Sky.newWeather();
    wx.raining = true; wx.thundering = true; wx.rainTime = 5000; wx.thunderTime = 5000;
    wx.clearTime = 600;
    Sky.tickWeather(wx, seq(7));
    ok(wx.raining === false && wx.thundering === false,
       'one tick of clear weather turns both flags off');
    // ⚠ THE TIMERS ARE SET FROM THE FLAGS **AS THEY WERE**, not to a constant: `j = flag ? 0 : 1`
    // is read before the flags are cleared, so a storm in progress has both timers zeroed and a
    // dry world has them set to 1. Either way the old countdown is gone.
    ok(wx.rainTime === 0 && wx.thunderTime === 0,
       'and zeroes both timers, because both flags were set — the storm does not resume');
    ok(wx.clearTime === 599, 'while the clear timer counts down');
  }

  // thunder is scaled by rain at the reader
  {
    const wx = Sky.newWeather();
    wx.rainLevel = 0.5; wx.thunderLevel = 0.8;
    ok(near(Sky.thunderLevelOf(wx), 0.4), 'the thunder a frame sees is thunderLevel * rainLevel');
  }
}
say(`   ${pass} ok`);

// ═══════════ 8. anti-vacuity ═══════════════════════════════════════════════════════════════
say('\n8. break it, and it must be caught');
{
  // 1. the `- 0.25` really is what puts noon at 6000
  {
    const withOffset = Sky.timeOfDay(6000);
    const without = (() => {
      const d0 = (6000 / 24000) - Math.floor(6000 / 24000);
      const d1 = 0.5 - Math.cos(d0 * Math.PI) / 2;
      return (d0 * 2 + d1) / 3;
    })();
    okAv(near(withOffset, 0) && !near(without, 0, 0.01),
      `with the -0.25 noon is ${withOffset.toFixed(3)} and without it ${without.toFixed(3)} — six hours out`);
  }
  // 2. the moon's second modulo is load-bearing
  {
    const one = ((Math.floor(-24000 / 24000)) % 8);
    okAv(one < 0 && Sky.moonPhase(-24000) >= 0,
      `a single modulo gives ${one} for one day before the epoch and the engine gives ${Sky.moonPhase(-24000)}`);
  }
  // 3. the star loop's rejects really are consumed
  {
    // rebuild the field while KEEPING the rejects, and the accepted ones must move
    const N = M.Noise;
    const rnd = new N.LegacyRandom(Sky.STAR_SEED);
    const noReject = [];
    for (let i = 0; i < 40; i++) {
      const d0 = rnd.nextFloat() * 2 - 1, d1 = rnd.nextFloat() * 2 - 1, d2 = rnd.nextFloat() * 2 - 1;
      rnd.nextFloat();
      const d4 = d0 * d0 + d1 * d1 + d2 * d2;
      if (d4 < 1 && d4 > 0.01) { rnd.nextDouble(); noReject.push(d0, d1, d2); }
    }
    const rnd2 = new N.LegacyRandom(Sky.STAR_SEED);
    const skipping = [];
    for (let i = 0; i < 40; i++) {
      const d0 = rnd2.nextFloat() * 2 - 1, d1 = rnd2.nextFloat() * 2 - 1, d2 = rnd2.nextFloat() * 2 - 1;
      rnd2.nextFloat();
      const d4 = d0 * d0 + d1 * d1 + d2 * d2;
      if (!(d4 < 1 && d4 > 0.01)) continue;
      rnd2.nextDouble();
      skipping.push(d0, d1, d2);
      if (skipping.length === 3) rnd2.nextFloat();      // one extra draw, as a wrong loop would
    }
    let differ = false;
    for (let i = 0; i < Math.min(noReject.length, skipping.length); i++) {
      if (noReject[i] !== skipping[i]) { differ = true; break; }
    }
    okAv(differ === true,
      'one extra draw anywhere in the star loop moves every star after it — the order is load-bearing');
  }
  // 4. the cubic kernel is not a box filter
  {
    const at = (x) => (x < 0 ? [1, 0, 0] : [0, 0, 1]);
    const cubic = [];
    for (let x = -40; x <= 40; x += 2) cubic.push(Sky.blendedColor(x, 64, 0, (qx) => at(qx))[2]);
    // a box filter over the same 6-tap window
    const box = [];
    for (let x = -40; x <= 40; x += 2) {
      const q = (x - 2) * 0.25, i0 = Math.floor(q);
      let n = 0, s = 0;
      for (let i = 0; i < 6; i++) { s += at(i0 - 2 + i)[2]; n++; }
      box.push(s / n);
    }
    let maxDiff = 0;
    for (let i = 0; i < cubic.length; i++) maxDiff = Math.max(maxDiff, Math.abs(cubic[i] - box[i]));
    okAv(maxDiff > 0.05,
      `the cubic kernel differs from a box filter over the same window by up to ${maxDiff.toFixed(3)}`);
  }
  // 5. the midnight sky really is black, and that is the clamp doing it
  {
    const unclamped = Math.cos(Sky.timeOfDay(18000) * 6.2831855) * 2 + 0.5;
    okAv(unclamped < 0 && Sky.skyColor([1, 1, 1], 18000, 0, 0)[2] === 0,
      `the raw cosine is ${unclamped.toFixed(2)} at midnight and the clamp is what makes the sky black`);
  }
  // 6. rain and thunder are separable in the fog
  {
    const sky = [0.4, 0.6, 1];
    const base = Sky.rgb24(0xC0D8FF);
    const r = Sky.fogColor(base, sky, 6000, 1, 0, 12);
    const t = Sky.fogColor(base, sky, 6000, 0, 1, 12);
    okAv(!near(r[2], t[2], 1e-4),
      `full rain and full thunder give different blues (${r[2].toFixed(4)} vs ${t[2].toFixed(4)}) — 0.4 against 0.5`);
  }
}
// ── D-649: Sky.isEntityRainedOn — Entity.isBeingRainedOn on the LIVE weather (the enderman used
// to pass 0 as the weather object and was never rained on) ──
{
  const S = M.Sky, B0 = M.Biomes, W0 = M.World, wx0 = S.weather;
  M.Biomes = { ready: true, precipitation: () => 1, snowsAt: () => false, warmEnoughToRain: () => true };
  M.World = { biomeAt: () => 0, heightAt: () => 63 };
  S.weather = { raining: true, rainLevel: 1 };
  const ent = (y) => ({ x: 0.5, y, z: 0.5, height: 2.9 });
  ok(S.isEntityRainedOn(ent(64)) === true, 'raining, open sky, rain biome: an entity standing on the surface is rained on');
  ok(S.isEntityRainedOn(ent(60)) === false, 'under the heightmap (a roof over both feet and head) it is not');
  ok(S.isEntityRainedOn(ent(62)) === true, 'its head above the roof line counts (hasRain at boundingBox.maxY)');
  // #377: the roof is the live MOTION_BLOCKING top (glass, a later-placed stone), +1 like getTopPosition
  {
    const Wx0 = M.Weather, mt = { top: 70 };
    M.World.get = () => ({});
    M.Weather = { motionTop: () => mt.top };
    const e2 = { x: 0.5, y: 64, z: 0.5, height: 0.5 };
    ok(S.isEntityRainedOn(e2) === false, '#377: a roof above the entity (glass, top 70) keeps it dry though the generation heightmap says open');
    mt.top = 64;
    ok(S.isEntityRainedOn(e2) === true, '#377: motionTop == feet cell: rained on');
    mt.top = 65;
    ok(S.isEntityRainedOn(e2) === false, '#377: the top is the first cell ABOVE the block (+1): feet on a slab are dry');
    M.Weather = undefined; mt.top = 70;
    okAv(S.isEntityRainedOn(e2) === true, 'break: reading only the generation heightmap (glass roof unseen) rains on the sheltered entity');
    M.Weather = Wx0; delete M.World.get;
  }
  M.Biomes.warmEnoughToRain = () => false; M.Biomes.snowsAt = () => true;
  ok(S.isEntityRainedOn(ent(64)) === false, 'in a snowing biome it is not rained on');
  M.Biomes.warmEnoughToRain = () => true; M.Biomes.snowsAt = () => false;
  S.weather = { raining: false, rainLevel: 0 };
  okAv(S.isEntityRainedOn(ent(64)) === false, 'break: clear weather — the same cell is dry (the helper reads the live weather)');
  M.Biomes = B0; M.World = W0; S.weather = wx0;
}
say(`   ${pass} ok`);

// ── D-657: the sunrise/sunset band — referee tools/golden/sunrise-1.18.2.tsv (JDK float arithmetic
// over MathHelper's own SINE_TABLE, off tools/golden/sunrise-1.18.2.java.txt) ─────────────────────
say('\n sunrise band (D-657)');
{
  const rows = [], rims = [], fogs = [];
  for (const line of readFileSync(join(ROOT, 'tools/golden/sunrise-1.18.2.tsv'), 'utf8').split('\n')) {
    if (!line || line[0] === '#' || line.startsWith('Picked up')) continue;
    const f = line.split('\t');
    if (f[0] === 'rim') rims.push(f.slice(1).map(Number));
    else if (f[0] === 'fog') fogs.push(f.slice(1).map(Number));
    else rows.push(f.map(Number));
  }
  ok(rows.length === 15 && rims.length === 17 && fogs.length === 45, `sunrise golden: 15 times, 17 rim points, 45 fog rows (got ${rows.length}, ${rims.length}, ${fogs.length})`);
  const colorsMatch = () => rows.every(([t, ang, , r, g, b, a]) => {
    if (Sky.skyAngleF(t) !== Math.fround(ang)) return false;
    const c = Sky.sunriseColor(Sky.skyAngleF(t));
    if (a === -1) return c === null;
    return !!c && c[0] === Math.fround(r) && c[1] === Math.fround(g) && c[2] === Math.fround(b) && c[3] === Math.fround(a);
  });
  ok(colorsMatch(), 'getFogColorOverride: the band colour and alpha equal the JDK\'s, float for float, at 15 times (and none at noon/midnight)');
  ok(Sky.sunriseColor(Sky.skyAngleF(6000)) === null && Sky.sunriseColor(Sky.skyAngleF(18000)) === null && !!Sky.sunriseColor(Sky.skyAngleF(12800)),
    'no band at noon or midnight; a band at dusk (both directions)');
  const fan = Sky.sunriseFan(Sky.skyAngleF(23000)), a = fan && fan.color[3];
  const rimMatch = (fn) => !!fn && rims.every(([k, x, y, z]) => {
    // un-pose (Rx(90).Rz(phi)) and compare with the JDK's raw rim; z carries the alpha factor
    const p = fn.rim[k], sn = Sky.mthSin(Math.fround(Sky.skyAngleF(23000) * Math.fround(Math.PI * 2)));
    const phi = (sn < 0 ? Math.PI : 0) + Math.PI / 2, rx = p[0], ry = p[2], rz = -p[1];
    const ux = rx * Math.cos(phi) + ry * Math.sin(phi), uy = -rx * Math.sin(phi) + ry * Math.cos(phi);
    return Math.abs(ux - x) < 1e-3 && Math.abs(uy - y) < 1e-3 && Math.abs(rz - Math.fround(z * fn.color[3])) < 1e-3;
  });
  ok(fan && fan.verts === 48 && rimMatch(fan), 'the fan: centre + 17 rim points (sin/cos*120, -cos*40*alpha), 16 triangles, as the JDK computes them');
  ok(fan && Math.abs(fan.center[0] - 100) < 1e-9 && Math.abs(fan.center[1]) < 1e-9, 'at sunrise the fan\'s centre hangs on the +x horizon (east), 100 out');
  const eve = Sky.sunriseFan(Sky.skyAngleF(12800));
  ok(eve && Math.abs(eve.center[0] + 100) < 1e-9, 'at sunset it hangs on the -x horizon (west) — the Rz(180) flip');
  ok(fan && fan.weight[0] === 1 && fan.weight[2] === 0 && fan.weight[4] === 0, 'alpha weight 1 at the centre, 0 on the rim (vanilla\'s vertex alphas)');
  const fogMatch = () => fogs.every(([t, lx, r, g, b]) => {
    const c = Sky.sunriseFog([Math.fround(0.5), Math.fround(0.6), Math.fround(0.7)], Sky.skyAngleF(t), lx, 12);
    return c[0] === Math.fround(r) && c[1] === Math.fround(g) && c[2] === Math.fround(b);
  });
  ok(fogMatch(), 'the fog blend toward the band: looking east/west/half, 15 times, equal to the JDK float for float');
  const base = [0.5, 0.6, 0.7];
  ok(Sky.sunriseFog(base, Sky.skyAngleF(23000), 1, 3) === base && Sky.sunriseFog(base, Sky.skyAngleF(23000), 1, 4) !== base,
    'render distance 3 skips the blend, 4 applies it');
  ok(Sky.sunriseFog(base, Sky.skyAngleF(23000), -1, 12) === base, 'looking away from the band leaves the fog alone');
  const dry = Sky.fogColor([0.5, 0.6, 0.7], [0.4, 0.6, 1], 23000, 0, 0, 12);
  const east = Sky.fogColor([0.5, 0.6, 0.7], [0.4, 0.6, 1], 23000, 0, 0, 12, 1);
  ok(east[0] > dry[0] && east[2] < dry[2], 'Sky.fogColor carries the blend: facing the sunrise the fog warms (red up, blue down)');
  const fr0 = Sky.frame([0.4, 0.6, 1], [0.5, 0.6, 0.7], 12);
  ok(fr0 && 'sunrise' in fr0, 'Sky.frame hands the fan to the backends');
  // breaks
  const saveCos = Sky.mthCos; Sky.mthCos = (x) => Math.fround(Math.cos(x));
  okAv(!colorsMatch() || !fogMatch(), 'Math.cos in place of MathHelper\'s table cos is caught by the float-exact golden');
  Sky.mthCos = saveCos;
  const saveCol = Sky.sunriseColor;
  Sky.sunriseColor = (ang) => { const c = saveCol(ang); return c && [c[0], c[1], c[2], Math.sqrt(c[3])]; };
  okAv(!colorsMatch(), 'an unsquared alpha (the `$$6 *= $$6` dropped) is caught');
  Sky.sunriseColor = saveCol;
  const saveSin = Sky.mthSin; Sky.mthSin = (x) => -saveSin(x);
  const flipped = Sky.sunriseFan(Sky.skyAngleF(23000));
  okAv(flipped && flipped.center[0] < 0, 'a flipped morning/evening test puts the sunrise fan in the west — the east check would catch it');
  Sky.mthSin = saveSin;
  // #378: gradients snap to the flags on load (World.initWeatherGradients)
  const lvl = (o) => { Sky.fromJSON(o); return [Sky.weather.rainLevel, Sky.weather.thunderLevel]; };
  const loadOk = () => lvl({ r: true, rl: 0.3 })[0] === 1 && lvl({ r: false, rl: 0.9 })[0] === 0 &&
    lvl({ r: false, th: true, tl: 1 })[1] === 0 && lvl({ r: true, th: true, tl: 0.2 })[1] === 1 && lvl({ r: true, th: false, tl: 0.5 })[1] === 0;
  ok(loadOk(), 'fromJSON snaps rain/thunder level to the saved flags, ignoring rl/tl');
  const saveFrom = Sky.fromJSON;
  Sky.fromJSON = function (o) { saveFrom(o); Sky.weather.rainLevel = +o.rl || 0; Sky.weather.thunderLevel = +o.tl || 0; };
  okAv(!loadOk(), 'restoring the saved partial rl/tl is caught');
  Sky.fromJSON = saveFrom;

  // #375: the level ramps run outside the doWeatherCycle gate
  {
    const sw = Sky.weather, sc = Sky.weatherCycle, sd = Sky.daylightCycle, sr = Sky.rampWeather;
    const drive = (raining) => {
      Sky.weather = Sky.newWeather(); Sky.weather.raining = raining; Sky.weatherCycle = false; Sky.daylightCycle = false;
      if (!raining) Sky.weather.rainLevel = 1;
      for (let i = 0; i < 100; i++) Sky.tick();
      return Sky.weather.rainLevel;
    };
    ok(Math.abs(drive(true) - 1) < 1e-6, 'weatherCycle off + raining: rainLevel ramps to 1 in 100 ticks');
    ok(Math.abs(drive(false)) < 1e-6, 'weatherCycle off + cleared flag: rainLevel ramps back to 0');
    Sky.rampWeather = (wx) => wx;
    okAv(drive(true) < 0.5, 'gating the ramp behind the cycle leaves rainLevel stuck');
    Sky.rampWeather = sr; Sky.weather = sw; Sky.weatherCycle = sc; Sky.daylightCycle = sd;
  }

  // #379: dayTime is a long in vanilla; the save must not wrap it to int32
  {
    const st = Sky.dayTime;
    const rt = () => { Sky.dayTime = 4e9; Sky.fromJSON(JSON.parse(JSON.stringify(Sky.toJSON()))); return Sky.dayTime; };
    ok(rt() === 4e9, 'dayTime 4e9 survives a save round-trip');
    ok(Sky.moonPhase(Sky.dayTime) === 2, 'moon phase after reload is 2');
    const tj = Sky.toJSON;
    Sky.toJSON = function () { const o = tj.call(Sky); o.t = o.t | 0; return o; };
    okAv(rt() !== 4e9, 'an int32 wrap in toJSON is caught');
    Sky.toJSON = tj; Sky.dayTime = st;
  }
}

console.log('');
console.log('================ skycheck =================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails.slice(0, 20)) console.log('   ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
console.log('==========================================');
process.exit(fails.length ? 1 : 0);
