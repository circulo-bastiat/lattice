#!/usr/bin/env node
// skyviewcheck.mjs — PLAN G16b: LOOK AT THE SKY.
//
//   node tools/skyviewcheck.mjs [dist/mclite.html]
//   MCLITE_PRESET=medium node tools/skyviewcheck.mjs
//
// ⚠ THE FIRST OF THIS PROJECT'S FOUR FINDINGS IS THAT A CHECK WHICH NEVER LOOKS AT THE PICTURE
// CANNOT SEE THE WORLD (PLAN §23: five rendering bugs found by Dan PLAYING while 554,142
// assertions passed). `skycheck` holds G16's NUMBERS — 141 assertions, none of which needs a
// canvas — and every one of them would still pass if the sky pass drew nothing at all. So this
// file points the camera at the sky and reads the pixels back.
//
// ⚠⚠ IT EARNED ITS KEEP ON THE DAY IT WAS WRITTEN. It found TWO bugs that every other check in
// this repository was blind to, and they are the two shapes D-289/D-301/D-302 warned about:
//
//   1. A VALUE THAT NEVER ARRIVED. `build-gui.mjs` had been taught to pack `sun` and
//      `moon_phases`, and `assets/gui.bin` really did contain them — but `tools/gen-data.mjs`
//      had not been re-run, so `src/19_data.gen.js` still held the eight-sheet blob, and
//      `texFromSheet` returned null for both. `initSky` skipped them without a word and the
//      sky pass issued two draws a frame instead of four, for ever.
//   2. CODE THAT RAN ON THE WRONG NUMBER. The sky pass projected with the WORLD's matrix, whose
//      far plane is the fog wall — 76.8 blocks at the Celeron preset, and the sun and moon sit
//      at 100. On the bottom rung of the hardware ladder they were clipped away entirely. The
//      fix is D-304: the sky pass gets its own projection, at `Sky.SKY_FAR`.
//
// Neither is visible from any number in the engine. Both are obvious in one screenshot.
//
// ⚠ EVERY ASSERTION IS A COMPARISON BETWEEN TWO MOMENTS OF THE SAME WORLD, never a colour typed
// into this file. Noon against midnight, sun against the sky beside it, stars against the black
// between them, full moon against new moon, and the sky pass on against the sky pass off. A
// threshold on an absolute colour would have to be re-tuned every time a biome's `sky_color`
// changed; a comparison would not.
//
// ⚠ THE HUD OVERLAY IS HIDDEN BEFORE ANY MEASUREMENT. `#ui` is its own canvas stacked over the
// GL one, and `Page.captureScreenshot` composites the two. The first version of this file
// measured the CROSSHAIR — pure white, dead centre, identical in every shot — and reported it as
// the sun. Hiding the overlay leaves the 3D pass alone in the frame, which is what is under test.

import { resolve } from 'node:path';
import { open, sleep } from './cdp.mjs';
import { decodePng, pixelAt } from './pngdec.mjs';

const FILE = resolve(process.argv[2] || 'dist/mclite.html');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('ok    ' + m); } else { fails.push(m); console.log('FAIL  ' + m); } return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else { fails.push('anti-vacuity: ' + m); console.log('   ✗ ' + m); } };

const page = await open(FILE, { port: 9417, width: 960, height: 600 });
if (!page) {
  console.log('skyviewcheck: SKIP — no Chromium on this machine (cdp.mjs found none)');
  process.exit(0);
}

const luma = (p) => ((p >> 16) & 255) * 0.299 + ((p >> 8) & 255) * 0.587 + (p & 255) * 0.114;

/** the brightest pixel in a box, where it is, and the box's own mean */
function peakAndMean(img, x0, y0, w, h) {
  let peak = -1, sum = 0, n = 0, px = -1, py = -1;
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const l = luma(pixelAt(img, x, y));
      sum += l; n++;
      if (l > peak) { peak = l; px = x; py = y; }
    }
  }
  return { peak, mean: sum / Math.max(1, n), px, py };
}
/** how many pixels in a box are brighter than an absolute threshold */
function countOver(img, x0, y0, w, h, th) {
  let n = 0;
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) if (luma(pixelAt(img, x, y)) > th) n++;
  }
  return n;
}
/** how many pixels in a box stand `over` above the box's OWN mean — a star count */
function specks(img, x0, y0, w, h, over) {
  const m = peakAndMean(img, x0, y0, w, h).mean;
  return countOver(img, x0, y0, w, h, m + over);
}
const shoot = async () => {
  const s = await page.send('Page.captureScreenshot', { format: 'png' });
  return decodePng(Buffer.from(s.data, 'base64'));
};

/**
 * Point the camera at the sky and set the clock.
 *
 * ⚠ POSITIVE PITCH IS UP IN THIS ENGINE — `U.mat4.fpsView`'s own header says so, and
 * `smoke.mjs` aims at the GROUND with −1.35. PITCH is 1.15 and not straight up: at 1.15 the
 * sun's whole morning arc crosses the frame from the bottom edge to the top, which is what §3
 * measures. Straight up the arc passes through one point and "the sun travels" cannot be seen.
 *
 * ⚠ THE DAY IS NOT WHERE INTUITION PUTS IT. `Sky.timeOfDay` returns 0 at NOON, and noon is
 * dayTime **6000**; 0 is sunrise and 18000 is midnight. The sun is above this camera's horizon
 * between about 1000 and 6000 and the moon between about 15000 and 21000.
 *
 * ⚠ AND THE BODY IS BUILT WITH `new Function` OVER A TEMPLATE, so nothing inside it may contain
 * a backtick — a comment with one closes the template and the file will not parse.
 */
const PITCH = 1.15;
/**
 * ⚠ AND THE PLAYER IS PUT IN OPEN AIR FIRST. At the Celeron preset this file passed and at
 * Dan's medium it did not, for a reason no threshold could have been tuned around: at render
 * distance 12 the spawn's TREES are generated and meshed, and the camera was looking up through
 * a canopy. Two presets, two different pictures, one of them all leaves. SKY_Y is above
 * anything the generator builds, so what is overhead is the sky at every preset (D-196).
 */
const SKY_Y = 220;
const lookUp = (t) => page.evaluate(new Function(`
  const P = MCL.Player, S = MCL.Sky;
  S.daylightCycle = false;
  S.weatherCycle = false;
  S.dayTime = ${t};
  if (!S.weather) S.weather = S.newWeather();
  S.weather.raining = false; S.weather.rainLevel = 0;
  S.weather.thundering = false; S.weather.thunderLevel = 0;
  P.mode = 'creative'; P.flying = true; P.onGround = false;
  P.vy = 0; P.y = ${SKY_Y};
  P.px = P.x; P.py = P.y; P.pz = P.z;
  P.pitch = ${PITCH}; P.yaw = 0;
  P.interpolate(1);
  return 1;
`));

console.log('skyviewcheck — PLAN G16b, the sky as a PICTURE (D-303, D-304)');

try {
  await sleep(1500);
  await page.evaluate(() => { if (MCL && MCL.Main && !MCL.Main.ready) MCL.Main.play(4242); return 1; });
  const up = await page.waitFor(() => (MCL.Hud && MCL.Hud.mode === 'game' && MCL.Gfx
    && MCL.Gfx.draws > 10 && MCL.Sky && MCL.Sky.ready) ? 1 : 0, 90000);
  ok(!!up, 'the world came up');
  await sleep(5000);
  // the overlay canvas goes away — see this file's header
  await page.evaluate(() => { document.getElementById('ui').style.display = 'none'; return 1; });

  const backend = await page.evaluate(() => MCL.Gfx.name);
  ok(backend === 'webgl2', `the backend is ${backend} — G16b's pass is WebGL2's (WebGPU is owed)`);

  // ── 0. the two sheets exist at RUNTIME ──────────────────────────────────────────────────
  // ⚠ THIS IS THE ASSERTION THAT NAMES THE FIRST BUG. Without it the symptom is "the sun is
  // missing" and the cause is four files away; with it the check says which asset never
  // arrived. `assets/gui.bin` having them is not the same as the SHIPPED FILE having them —
  // `gen-data.mjs` is what carries one into the other.
  console.log('\n0. the sky pass has what it needs');
  const have = await page.evaluate(() => {
    const s = (MCL.Gui && MCL.Gui.sheets) || {};
    const S = MCL.GfxGL && MCL.GfxGL.sky;
    return { sun: !!s.sun, moon: !!s.moon_phases, sunTex: !!(S && S.sunTex), moonTex: !!(S && S.moonTex),
             stars: S ? S.starQuads : -1, draws: (MCL.GfxGL && MCL.GfxGL.skyDraws) | 0 };
  });
  ok(have.sun && have.moon, `the sun and moon_phases sheets reached the shipped file (${have.sun}, ${have.moon})`);
  ok(have.sunTex && have.moonTex, 'and both became GL textures — initSky skipped neither');
  ok(have.stars > 500, `the star field built ${have.stars} quads`);
  ok(have.draws >= 4, `the sky pass issued ${have.draws} draws last frame (disc, sun, moon, dark disc)`);

  // ── 1. noon: a bright sky with the sun in it ────────────────────────────────────────────
  console.log('\n1. noon (dayTime 6000), looking up');
  await lookUp(6000);
  await sleep(1200);
  const noon = await shoot();
  const W = noon.width, H = noon.height;
  const nStat = peakAndMean(noon, 0, 0, W, H);
  ok(nStat.mean > 60, `the noon sky is bright (mean luma ${nStat.mean.toFixed(1)})`);
  // ⚠ THE SUN IS A PATCH MUCH BRIGHTER THAN THE SKY AROUND IT. That is the assertion, not
  // "there is a white pixel somewhere" — the sky itself is already bright, so the sun has to be
  // measured AGAINST it.
  ok(nStat.peak > nStat.mean + 60,
     `and the brightest patch is ${nStat.peak.toFixed(0)} against a mean of ${nStat.mean.toFixed(0)} — the sun`);
  const skyRgb = await page.evaluate(() => MCL.Gfx.sky.map((v) => Math.round(v * 255)).join(','));
  console.log('      sky colour ' + skyRgb + ' · sun at (' + nStat.px + ',' + nStat.py + ')');

  // ── 2. midnight: a dark sky with the moon in it ─────────────────────────────────────────
  console.log('\n2. midnight (dayTime 18000), the same view');
  await lookUp(18000);
  await sleep(1200);
  const mid = await shoot();
  const mStat = peakAndMean(mid, 0, 0, W, H);
  // ⚠ THE COMPARISON IS THE POINT. "The night sky is dark" is a threshold; "the night sky is
  // much darker than the day sky in the same world from the same spot" is a measurement.
  ok(mStat.mean < nStat.mean * 0.5,
     `midnight is far darker than noon (${mStat.mean.toFixed(1)} against ${nStat.mean.toFixed(1)})`);
  ok(mStat.mean < 40, `and it is genuinely dark (mean luma ${mStat.mean.toFixed(1)})`);
  ok(mStat.peak > mStat.mean + 100,
     `the brightest patch at midnight is ${mStat.peak.toFixed(0)} against ${mStat.mean.toFixed(0)} — the moon`);

  // ── 2b. stars ───────────────────────────────────────────────────────────────────────────
  // ⚠ COUNTED AT 21000 AND NOT AT 18000, because at 18000 the MOON is in the frame and a moon
  // is thousands of bright pixels. At 21000 it has set and the only things left standing out
  // of the black are stars.
  console.log('\n2b. stars, counted after the moon has set');
  await lookUp(21000);
  await sleep(1000);
  const late = await shoot();
  // ⚠ AND IN A BOX THAT HOLDS ONLY SKY. A "much brighter than this box's own mean" test over the
  // WHOLE frame is meaningless at noon: the bottom of the frame is terrain, terrain is dark, and
  // it drags the mean so far down that 392,253 pixels of ordinary blue sky "stand out". The box
  // is the upper LEFT — above the horizon at this pitch, and clear of the x-column the sun and
  // the moon both travel up.
  const SB = { x: 0, y: 0, w: Math.round(W * 0.30), h: Math.round(H * 0.45) };
  const stars = specks(late, SB.x, SB.y, SB.w, SB.h, 18);
  ok(stars > 30, `${stars} pixels stand out of the late-night sky — the stars are drawn`);
  const daySpecks = specks(noon, SB.x, SB.y, SB.w, SB.h, 18);
  ok(stars > daySpecks * 4 + 10,
     `and far more of them than at noon, where starBrightness is 0 (${stars} vs ${daySpecks})`);

  // ── 3. the sun moves ────────────────────────────────────────────────────────────────────
  // ⚠ MONOTONE, NOT JUST "DIFFERENT". A sun that jitters between two spots would pass a spread
  // test; a sun that climbs has to climb in one direction, and at this pitch that is the frame
  // going UP, which is y going DOWN.
  console.log('\n3. the sun climbs through the morning');
  const TIMES = [2000, 4000, 6000];
  const where = [];
  for (const t of TIMES) {
    await lookUp(t);
    await sleep(900);
    where.push(peakAndMean(await shoot(), 0, 0, W, H));
  }
  const climbs = where[0].py > where[1].py && where[1].py > where[2].py;
  const travel = where[0].py - where[2].py;
  ok(climbs && travel > 100,
     `the sun rose ${travel}px between dayTime 2000 and 6000, monotonically`);
  console.log('      ' + where.map((w, i) => TIMES[i] + ':(' + w.px + ',' + w.py + ')').join(' '));
  const drift = Math.max(...where.map((w) => w.px)) - Math.min(...where.map((w) => w.px));
  ok(drift < 40, `and it stayed in the same part of the sky sideways (${drift}px) — it is an arc, not a slide`);

  // ── 4. the moon's phase changes the picture ─────────────────────────────────────────────
  // ⚠ A WHOLE LUNAR MONTH, NOT FOUR SAMPLES. Vanilla's moon_phases.png is a 4x2 grid and the
  // phase indexes it; a version that ignored the UV grid would draw the same cell eight times
  // and these eight numbers would be identical. The NEW moon is the anchor a player can check
  // by looking up: it draws nothing at all.
  console.log('\n4. the moon waxes and wanes over eight days');
  const litAt = [];
  for (let d = 0; d < 8; d++) {
    await lookUp(18000 + d * 24000);
    await sleep(800);
    const img = await shoot();
    // a generous box around where the moon sits at 18000, measured once above
    litAt.push({
      phase: await page.evaluate(() => MCL.Sky.moonPhase(MCL.Sky.dayTime)),
      lit: countOver(img, Math.round(W * 0.36), 0, Math.round(W * 0.26), Math.round(H * 0.32), 100)
    });
  }
  ok(new Set(litAt.map((p) => p.phase)).size === 8,
     `eight different phases: ${litAt.map((p) => p.phase).join(',')}`);
  console.log('      lit pixels ' + litAt.map((p) => p.lit).join(', '));
  const fullest = Math.max(...litAt.map((p) => p.lit));
  const emptiest = Math.min(...litAt.map((p) => p.lit));
  ok(fullest > 800, `the full moon draws ${fullest} lit pixels`);
  ok(emptiest === 0, `and the new moon draws none (${emptiest})`);
  const newIdx = litAt.findIndex((p) => p.lit === emptiest);
  ok(litAt[newIdx].phase === 4,
     `the dark one is phase ${litAt[newIdx].phase} — vanilla's new moon is cell 4 of the 4x2 grid`);

  // ── 4b. D-657: the sunrise band ─────────────────────────────────────────────────────────
  console.log('\n4b. the sunrise/sunset band (D-657)');
  {
    // engine forward x = sin(yaw)*cos(pitch): yaw +pi/2 faces +x (east), -pi/2 faces west
    const face = (t, yaw) => page.evaluate(new Function(`
      const P = MCL.Player, S = MCL.Sky;
      S.daylightCycle = false; S.weatherCycle = false; S.dayTime = ${t};
      if (!S.weather) S.weather = S.newWeather();
      S.weather.raining = false; S.weather.rainLevel = 0; S.weather.thundering = false; S.weather.thunderLevel = 0;
      P.mode = 'creative'; P.flying = true; P.onGround = false; P.vy = 0; P.y = ${SKY_Y};
      P.px = P.x; P.py = P.y; P.pz = P.z; P.pitch = 0.12; P.yaw = ${yaw}; P.interpolate(1); return 1;`));
    // D-660: the screenshot PNG is RGB (pngdec's `channels` 3), not RGBA — a hard-coded *4 walked
    // R,G,B offsets in rotation and summed (R-B)+(G-R)+(B-G) = 0 for every picture, so §4b read 0.0
    // at dawn, noon and dusk alike. Step by the decoder's own channel count.
    const warmth = (img) => {           // mean (R - B) over the middle band of the picture
      let sum = 0, n = 0; const ch = img.channels || 4;
      for (let y = Math.floor(img.height * 0.3); y < Math.floor(img.height * 0.6); y += 2)
        for (let x = 0; x < img.width; x += 2) { const i = (y * img.width + x) * ch; sum += img.data[i] - img.data[i + 2]; n++; }
      return sum / n;
    };
    const look = async (t, yaw) => { await face(t, yaw); await sleep(900);
      return { w: warmth(await shoot()), drawn: await page.evaluate(() => (MCL.GfxGL && MCL.GfxGL.sunriseDrawn) | 0) }; };
    const east = await look(23000, Math.PI / 2), west = await look(23000, -Math.PI / 2);
    ok(east.drawn === 16, `at dawn (23000) the fan is drawn: ${east.drawn} triangles (16)`);
    ok(east.w > west.w + 15, `facing the sunrise the sky is warmer than facing away (R-B ${east.w.toFixed(1)} vs ${west.w.toFixed(1)})`);
    const noonE = await look(6000, Math.PI / 2), noonW = await look(6000, -Math.PI / 2);
    ok(noonE.drawn === 0, `at noon no fan is drawn (${noonE.drawn})`);
    ok(Math.abs(noonE.w - noonW.w) < 10, `at noon east and west look alike (R-B ${noonE.w.toFixed(1)} vs ${noonW.w.toFixed(1)})`);
    const dusk = await look(12800, -Math.PI / 2), duskE = await look(12800, Math.PI / 2);
    ok(dusk.drawn === 16 && dusk.w > duskE.w + 15, `at dusk (12800) the band is in the WEST (R-B ${dusk.w.toFixed(1)} vs east ${duskE.w.toFixed(1)})`);
    await page.evaluate(() => { MCL.Sky._fan = MCL.Sky.sunriseFan; MCL.Sky._sfog = MCL.Sky.sunriseFog;
      MCL.Sky.sunriseFan = () => null; MCL.Sky.sunriseFog = (rgb) => rgb; return 1; });
    const stub = await look(23000, Math.PI / 2);
    await page.evaluate(() => { MCL.Sky.sunriseFan = MCL.Sky._fan; MCL.Sky.sunriseFog = MCL.Sky._sfog; return 1; });
    okAv(stub.drawn === 0 && stub.w < east.w - 15, `with the band stubbed out the dawn picture loses its warmth (R-B ${stub.w.toFixed(1)} vs ${east.w.toFixed(1)})`);
  }

  // ── 5. anti-vacuity ─────────────────────────────────────────────────────────────────────
  console.log('\n5. break it, and it must be caught');
  {
    // ⚠ TURN THE SKY PASS OFF IN THE RUNNING PAGE AND THE SUN MUST GO. That is the experiment
    // that separates "the picture is bright" from "the sky pass drew it".
    await lookUp(6000);
    await sleep(900);
    const withSky = peakAndMean(await shoot(), 0, 0, W, H);
    await page.evaluate(() => {
      MCL.__realDrawSky = MCL.GfxGL.drawSky;
      MCL.GfxGL.drawSky = function () { return 0; };
      return 1;
    });
    await sleep(900);
    const without = peakAndMean(await shoot(), 0, 0, W, H);
    await page.evaluate(() => { MCL.GfxGL.drawSky = MCL.__realDrawSky; return 1; });
    await sleep(900);
    const back = peakAndMean(await shoot(), 0, 0, W, H);
    okAv(withSky.peak > without.peak + 30 && back.peak > without.peak + 30,
      `with the sky pass the peak is ${withSky.peak.toFixed(0)}, without it ${without.peak.toFixed(0)}, `
      + `and ${back.peak.toFixed(0)} again when it is put back`);
    // ⚠ FLATNESS IS MEASURED IN THE SKY BOX, NOT THE WHOLE FRAME — the bottom of the frame is
    // terrain whether the sky pass runs or not, and terrain is not flat.
    const flat = peakAndMean(await shoot(), SB.x, SB.y, SB.w, SB.h);
    okAv(flat.peak - flat.mean < 20,
      `with it off the sky box is flat (peak ${flat.peak.toFixed(0)}, mean ${flat.mean.toFixed(0)}) — `
      + 'the clear colour on its own');

    // ⚠⚠ THE D-304 REGRESSION, REPRODUCED ON PURPOSE. Give the sky pass a fog-wall far plane
    // and the sun must vanish. This is the bug that actually shipped: `drawSky` projected with
    // `state.viewProj`, whose far plane is `rd * 16 * fogEnd + 16` — 76.8 blocks at the Celeron
    // preset, and the sun and moon sit at `CELESTIAL_DIST` = 100.
    //
    // ⚠ THE SHORT FAR PLANE IS FORCED HERE RATHER THAN BORROWED FROM THE PRESET. Reusing the
    // world's real matrix only reproduces the bug on a preset whose far plane happens to be
    // nearer than 100 — so at medium the break would quietly SKIP, and the one break that
    // covers the bug this file was written to catch would never run in Dan's own setup (D-30:
    // a break that cannot fire is not a break).
    const NEARER_THAN_THE_SUN = 80;
    await page.evaluate(new Function(`
      const short = new Float32Array(16);
      MCL.__realSky2 = MCL.GfxGL.drawSky;
      MCL.GfxGL.drawSky = function (s) {
        const keep = s.skyViewProj;
        MCL.Cam.skyViewProj(MCL.Gfx.cam, short, MCL.Sky.SKY_NEAR, ${NEARER_THAN_THE_SUN});
        s.skyViewProj = short;
        const r = MCL.__realSky2.call(this, s);
        s.skyViewProj = keep;
        return r;
      };
      return 1;
    `));
    await sleep(900);
    const clipped = peakAndMean(await shoot(), 0, 0, W, H);
    await page.evaluate(() => { MCL.GfxGL.drawSky = MCL.__realSky2; return 1; });
    await sleep(900);
    const restored = peakAndMean(await shoot(), 0, 0, W, H);
    okAv(clipped.peak < clipped.mean + 40 && restored.peak > restored.mean + 60,
      `a sky far plane of ${NEARER_THAN_THE_SUN}, nearer than the sun at `
      + `${await page.evaluate(() => MCL.Sky.CELESTIAL_DIST)}, clips it away: peak-over-mean `
      + `${(clipped.peak - clipped.mean).toFixed(0)}, and ${(restored.peak - restored.mean).toFixed(0)} `
      + 'again at Sky.SKY_FAR');

    // ...and the disc itself survives that clipping, so the failure above is the SUN going and
    // not the whole pass falling over — which is exactly how the bug presented.
    okAv(clipped.mean > 60,
      `and the sky itself is still there while the sun is gone (mean ${clipped.mean.toFixed(0)})`);
  }

  const errs = page.problems || [];
  ok(errs.length === 0, 'the page logged no errors (' + errs.slice(0, 3).join(' | ') + ')');
} finally {
  await page.close();
}

console.log('');
console.log('=============== skyviewcheck ==============');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails.slice(0, 20)) console.log('   ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
console.log('==========================================');
process.exit(fails.length ? 1 : 0);
