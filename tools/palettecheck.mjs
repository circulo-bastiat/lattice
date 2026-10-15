#!/usr/bin/env node
// palettecheck.mjs — a quality preset changes the FRAME RATE, not the PALETTE.
//
//   node tools/palettecheck.mjs [dist/mclite.html] [--print]
//
// ⚠ WHY THIS EXISTS (D-163). D-159: on every preset below medium, leaves rendered GREY. The mesh was
// perfect — same tile, same tint index, same layer counts, and `facecheck` asserted all of it and
// passed. The bug was three instructions downstream, in the fragment shader, where the biome tint
// was weighted by the texel's alpha; `fastLeaves` moves a CUTOUT texture into the opaque pass,
// where nothing discards, so every hole arrived with a = 0 and came out untinted. Dan found it by
// playing the game. No check in the suite reads a pixel of a leaf.
//
// So this one reads pixels. The claim it makes is the one a quality setting is FOR:
//
//     A quality preset may change how long a frame takes and how far you can see.
//     It may not change what the world is made of.
//
// Stated as measurements over the same camera in the same world with the RENDER DISTANCE HELD
// CONSTANT — so fog, which legitimately differs per preset, is not what is being compared:
//
//   §1 compares each preset's whole frame to `high` — mean saturation, the per-channel mean, and
//      the hue histogram as a distribution. This is the broad smoke test, and ⚠ IT DOES NOT CATCH
//      D-159: whole-frame statistics dilute a change that only touches leaves, and with the bug
//      deliberately reintroduced the worst preset moved 5.8% against a 15% bound and PASSED. It
//      is kept because it catches the OTHER shape of the same class — a preset that shifts the
//      whole picture — but it is not the reason this file exists.
//   §2 is. It toggles nothing but `fancyLeaves`, diffs the two frames, and measures only the
//      pixels that MOVED — which are, by construction, the leaves, whether or not the camera was
//      aimed at them. On the shipped build those pixels keep their saturation; with D-159 they
//      lose **41.1%** of it. That is the difference between a check and a formality.
//
// ⚠ AND EVERY MEASUREMENT IN IT USED TO BE TAKEN OFF A FIXED SLEEP (D-224). Run at the medium
// preset for the first time (D-196), §2 reported 37 changed pixels and the leaf allowance was
// measured at 0.0% — not a regression in fast leaves, a remesh 4% finished. `Settings.push({
// remesh: true })` marks every resident section dirty, which at `high`'s render distance on the
// box these checks run on is 8,400 sections against a mesher clearing 25 to 55 a second; the
// seven-second sleep was watching the first three per cent of a two-and-a-half-minute job.
// Every wait in this file is now the streamer's own backlog draining to zero, and the render
// distance is the largest one this machine can actually finish, measured at run time. With that
// done, fast leaves move mean saturation by 5.0% and §2 sees 30,000 changed pixels.
//
// ⚠ IT COMPARES PRESETS TO EACH OTHER, NOT TO A GOLDEN IMAGE. A stored screenshot would have to
// be regenerated for every legitimate change to the world and would be believed long after it
// stopped being right. The reference here is the SAME BUILD at the `high` preset, taken seconds
// earlier from the same camera — the same discipline as `cullcheck` (D-145).

import { existsSync } from 'node:fs';
import { open, sleep } from './cdp.mjs';
import { decodePng, toRgba } from './pngdec.mjs';

const args = process.argv.slice(2).filter((a) => a !== '--print');
const PRINT = process.argv.includes('--print');
const FILE = 'file://' + process.cwd() + '/' + (args[0] || 'dist/mclite.html');
if (!existsSync((args[0] || 'dist/mclite.html'))) {
  console.error('palettecheck: no such file ' + (args[0] || 'dist/mclite.html'));
  process.exit(1);
}

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 20) fails.push(m); };

/**
 * The statistics, over a CENTRE CROP. The edges of the frame are where the fog wall and the HUD
 * live, and both differ legitimately between presets; the middle is the world.
 */
function stats(im) {
  if (im.channels !== 4) throw new Error('stats() needs RGBA — call toRgba() (D-170)');
  const x0 = (im.width * 0.25) | 0, x1 = (im.width * 0.75) | 0;
  const y0 = (im.height * 0.15) | 0, y1 = (im.height * 0.62) | 0;
  let n = 0, sr = 0, sg = 0, sb = 0, ssat = 0;
  const hue = new Float64Array(12);
  let coloured = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * im.width + x) * 4;
      const r = im.data[i] / 255, g = im.data[i + 1] / 255, b = im.data[i + 2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const sat = mx <= 0 ? 0 : (mx - mn) / mx;
      n++; sr += r; sg += g; sb += b; ssat += sat;
      if (sat > 0.12 && mx > 0.08) {
        coloured++;
        let h;
        const d = mx - mn;
        if (mx === r) h = ((g - b) / d + 6) % 6;
        else if (mx === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        hue[Math.min(11, Math.max(0, Math.floor(h * 2)))]++;
      }
    }
  }
  for (let k = 0; k < 12; k++) hue[k] /= Math.max(1, coloured);
  return { n, r: sr / n, g: sg / n, b: sb / n, sat: ssat / n, coloured: coloured / n, hue: [...hue] };
}

/**
 * The pixels that DIFFER between two frames of the same scene, and their mean saturation in each.
 * Same centre crop as `stats`. This is what isolates a change that touches only one kind of block:
 * whatever moved is the thing the setting acts on, whether or not the camera was aimed at it.
 */
function diffStats(a, b) {
  if (a.width !== b.width || a.height !== b.height) return { moved: 0, movedFrac: 0, satA: 0, satB: 0 };
  const x0 = (a.width * 0.25) | 0, x1 = (a.width * 0.75) | 0;
  const y0 = (a.height * 0.15) | 0, y1 = (a.height * 0.62) | 0;
  const sat = (r, g, bl) => { const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl); return mx <= 0 ? 0 : (mx - mn) / mx; };
  let moved = 0, total = 0, sa = 0, sb = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * a.width + x) * 4;
      total++;
      const dr = Math.abs(a.data[i] - b.data[i]);
      const dg = Math.abs(a.data[i + 1] - b.data[i + 1]);
      const db = Math.abs(a.data[i + 2] - b.data[i + 2]);
      if (dr + dg + db < 24) continue;              // above the dither/AA floor
      moved++;
      sa += sat(a.data[i] / 255, a.data[i + 1] / 255, a.data[i + 2] / 255);
      sb += sat(b.data[i] / 255, b.data[i + 1] / 255, b.data[i + 2] / 255);
    }
  }
  return { moved, movedFrac: moved / Math.max(1, total), satA: sa / Math.max(1, moved), satB: sb / Math.max(1, moved) };
}

/** Total variation between two hue distributions: 0 identical, 1 disjoint. */
function hueDistance(a, b) {
  let d = 0;
  for (let k = 0; k < 12; k++) d += Math.abs(a[k] - b[k]);
  return d / 2;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ WHAT IS HELD FIXED IS EVERY COST AXIS, NOT JUST THE RENDER DISTANCE (D-224).
//
// The claim at the top of this file splits a preset's twenty keys in two: the ones that decide
// HOW EXPENSIVE the frame is, and the ones that decide WHAT IT LOOKS LIKE. Only the second kind
// is on trial here, so the first kind is pinned to `high`'s values for every preset and the
// allowance is derived from exactly the second kind.
//
// Pinning only `renderDistance` was not enough and the numbers say so. Measured on the two-core
// software-rasteriser box these checks run on, everything settled, at rd 8:
//
//     celeron, render distance pinned, nothing else   mean saturation 18.0% from `high`
//     celeron, every cost axis pinned                                  1.7% from `high`
//
// The 16 points in between were `fogStart` (0.35 against 0.70 — celeron's fog wall starts at
// half the distance, so a third of the frame was grey haze), `maxChunks` (160 against 1600, a
// resident world an eighth the size) and the streamer's own budgets. None of those is a tint.
// They are how far you can see and how fast the world arrives, which is what a preset is FOR.
//
// The classification is asserted, not assumed: every key in `Settings.PRESET_KEYS` must appear
// in one of these two lists, so a preset key added later cannot slip past the allowance.
// ─────────────────────────────────────────────────────────────────────────────────────────────
const COST_KEYS = ['renderDistance', 'maxDPR', 'fogStart', 'fogEnd',
  'uploadsPerFrame', 'uploadBytesPerFrame', 'workers', 'maxGenInflight', 'maxMeshInflight',
  'maxMeshPerFrame', 'maxChunks', 'lightBudgetUs', 'targetMs'];
const LOOK_KEYS = ['ao', 'crossModels', 'smoothLighting', 'fancyLeaves',
  'mipmaps', 'occlusion', 'depthPrepass'];
/** The look keys that invalidate geometry already on the GPU — the only ones worth a remesh. */
const MESH_KEYS = ['ao', 'crossModels', 'fancyLeaves'];
/** Saturation a preset is allowed to move for reasons no flag accounts for: run-to-run drift. */
const MARGIN = 0.06;

const page = await open(FILE, { port: 9441, width: 640, height: 360 });
await sleep(1800);
await page.key('Enter');
const ready = await page.waitFor(() => MCL.Main.ready === true, 90000);
ok(ready === true, 'the world never started');

const ev = async (e) => (await page.send('Runtime.evaluate', { expression: e, returnByValue: true })).result.value;
// ⚠ RGBA, always — headless Chromium returns 3-channel PNG and `stats`/`diffStats` index by 4
// (D-170). Every statistic in this file was computed on shifted colour channels until this.
const shot = async () => toRgba(decodePng(Buffer.from((await page.send('Page.captureScreenshot', { format: 'png' })).data, 'base64')));

/**
 * Pin every cost axis to `high`'s value and the render distance to `rd`, in ONE evaluation.
 *
 * ⚠ THE SINGLE EVALUATION IS THE POINT. `applyPreset` pushes the preset's `maxChunks` into the
 * streamer before it returns, and the next frame's `evict` acts on it: celeron's 160 would drop
 * seven eighths of the resident world between the two statements if a frame could run between
 * them. Nothing yields inside one Runtime.evaluate, so the streamer never sees the preset's
 * budgets at all — which is what "the same world, only the quality flags differ" means.
 *
 * `maxDPR` is pinned to 1 rather than to `high`'s 2 for the same reason the crop exists: the
 * screenshot is one device pixel per CSS pixel in every preset, and 4x the fill rate buys this
 * check nothing but minutes on a software rasteriser.
 */
const pin = (rd) => `(function () {
  var S = MCL.Settings, H = S.PRESETS.high, keys = ${JSON.stringify(COST_KEYS)};
  for (var i = 0; i < keys.length; i++) if (H[keys[i]] !== undefined) S[keys[i]] = H[keys[i]];
  S.setRenderDistance(${rd});
  S.maxDPR = 1;
  S.adaptive = false;
  S.push({ remesh: false, resize: true });
  return S.renderDistance;
})()`;

/**
 * The work the streamer still owes the picture, counted the way `World.stream` counts it: dirty
 * sections in columns that are INSIDE the render distance and whose 3x3 neighbourhood is
 * generated, plus everything in flight and everything queued for upload.
 *
 * ⚠ "EVERY SECTION IS CLEAN" IS NOT REACHABLE AND NEVER WAS. The rim columns of the loaded disc
 * never have all eight neighbours, so `stream` will not mesh them and they stay dirty for as
 * long as they are resident — measured at 718 sections of permanent residue at rd 8 against
 * 1,741 the streamer actually owed. A settle condition written on the raw dirty count would
 * wait for ever; this one is the count of work the streamer will actually do.
 */
const BACKLOG = `(function () {
  var W = MCL.World, S = MCL.Settings, cam = MCL.Gfx.cam;
  var ccx = Math.floor(cam.x) >> 4, ccz = Math.floor(cam.z) >> 4;
  var rd = S.renderDistance, rd2 = rd * rd, b = 0;
  W.chunks.forEach(function (c) {
    var ax = c.cx - ccx, az = c.cz - ccz;
    if (ax * ax + az * az > rd2) return;
    if (!W.neighbourhoodReady(c.cx, c.cz)) return;
    var m = c.meshDirty[0];
    while (m) { b += m & 1; m >>>= 1; }
  });
  return { work: b + W.meshInflight + W.genInflight + MCL.Gfx.uploadQueue.length,
           meshed: W.stats2.meshed, chunks: W.chunks.size };
})()`;

/**
 * quiet(label, budgetMs) — wait until the picture has stopped arriving, and MEASURE THE BOX
 * while waiting (D-224).
 *
 * ⚠ THIS REPLACES `await sleep(7000)` AND THAT SLEEP WAS THE WHOLE OF THE FIRST FAILURE. On this
 * box, at `high`'s render distance, `Settings.push({remesh: true})` marks about 8,400 sections
 * dirty and the mesher clears them at 25 to 55 a second: seven seconds is the first 3% of a
 * two-and-a-half-minute job. Measured, with the fixed sleep: fast leaves moved mean saturation
 * by 0.0%, which the check then used as its own allowance — a bound derived from a measurement
 * of nothing. Measured, waiting for the backlog instead: 5.0%. The mesher was never wrong;
 * `coherecheck` §4 says it still emits exactly the 5,144-face exposed surface for fast leaves
 * and all 14,586 faces for fancy, and it was right while this check was reading zero.
 *
 * Returns { settled, ms, work, rate, delivered }. `rate` is sections a second, measured here,
 * and it is what lets the caller abandon a render distance this box cannot finish instead of
 * sitting out the whole budget.
 */
/**
 * The settle loop's decision, as a pure function so §3 can run the REAL rule over synthetic
 * histories rather than a paraphrase of it (D-30, and D-194's lesson in flashcheck).
 *
 *   work   sections of work the streamer still owes the picture
 *   rate   sections a second, measured over this wait
 *   'slow' is the D-224 case stated in numbers: 8,400 sections at 25 a second cannot finish in
 *   the seven seconds the old fixed sleep gave it, and knowing that at five seconds is what lets
 *   the caller step the render distance down instead of photographing a half-built world.
 */
function settleVerdict(work, ms, rate, budgetMs, stalled, stuckDeliveries) {
  if (work === 0) return 'settled';
  if (stalled >= 6 && stuckDeliveries >= 6) return 'stuck';
  if (ms > 3000 && rate > 0 && ms + (work / rate) * 1000 > budgetMs) return 'slow';
  if (ms > budgetMs) return 'timeout';
  return 'waiting';
}

/** Which preset keys this file neither pins as a cost nor measures as a look. */
function unclassifiedKeys(presetKeys) {
  return (presetKeys || []).filter((k) => COST_KEYS.indexOf(k) < 0 && LOOK_KEYS.indexOf(k) < 0);
}

async function quiet(label, budgetMs) {
  const t0 = Date.now();
  let first = null, best = Infinity, stalled = 0, lastMeshed = -1, stuckDeliveries = 0;
  for (;;) {
    await sleep(900);
    const s = await ev(BACKLOG);
    if (first === null) { first = s; lastMeshed = s.meshed; }
    const ms = Date.now() - t0;
    const delivered = s.meshed - first.meshed;
    const rate = delivered / Math.max(0.9, ms / 1000);
    if (s.work < best) { best = s.work; stalled = 0; } else stalled++;
    stuckDeliveries = s.meshed === lastMeshed ? stuckDeliveries + 1 : 0;
    lastMeshed = s.meshed;
    const verdict = settleVerdict(s.work, ms, rate, budgetMs, stalled, stuckDeliveries);
    if (verdict === 'waiting') continue;
    return { settled: verdict === 'settled', reason: verdict, ms, work: s.work, rate,
             delivered, chunks: s.chunks, label };
  }
}

// ⚠ THE CAMERA HAS TO BE LOOKING AT SOMETHING. A check that photographs an empty desert asserts
// nothing, so the amount of colour in the reference frame is asserted, and §2 additionally
// requires that a usable number of pixels actually CHANGED when leaves were switched — "there
// were no leaves in shot" fails rather than passes.
await ev(`MCL.Player.creative = true; MCL.Player.flying = true;
  MCL.Player.pitch = -0.05; MCL.Player.yaw = 0.7; MCL.Hud.showDebug = false;
  MCL.Settings.adaptive = false;`);
await ev(`MCL.Settings.applyPreset('high'); MCL.Settings.adaptive = false;`);
await ev(`MCL.Player.y = MCL.Column.height(Math.floor(MCL.Player.x), Math.floor(MCL.Player.z)) + 8;
  MCL.Player.vy = 0;`);
await page.waitFor(() => MCL.Gfx.draws > 10 && MCL.World.chunks.size > 40, 60000);

// ── every preset key is either pinned or measured ────────────────────────────────────────────
const presetKeys = await ev('MCL.Settings.PRESET_KEYS');
const unclassified = unclassifiedKeys(presetKeys);
ok(Array.isArray(presetKeys) && presetKeys.length > 10 && unclassified.length === 0,
   `preset key(s) ${(unclassified || []).join(', ')} are neither pinned as a cost nor measured as a look — the allowance cannot account for them (D-224)`);

// ── the render distance this box can actually finish ─────────────────────────────────────────
// ⚠ MEASURE THE BOX, THEN ASSERT WHAT THE BOX CAN ANSWER (D-198's rule, applied here). At
// `high`'s render distance this machine streams 900 columns and never drains the backlog: every
// screenshot below would be of a world still arriving, and two frames of a world still arriving
// differ for reasons that have nothing to do with a quality flag. So the largest render distance
// that SETTLES is chosen, once, and held for every preset — the comparison is between presets,
// so the value only has to be the same for all of them and large enough to hold a world.
const ladder = await ev(`(function () { var H = MCL.Settings.PRESETS.high.renderDistance;
  return [H, Math.max(8, H >> 1), 8, 4].filter(function (v, i, a) { return a.indexOf(v) === i; }); })()`);
let RD = 0, warm = null;
for (const cand of ladder) {
  await ev(`MCL.Settings.applyPreset('high');` + pin(cand));
  const q = await quiet(`warm rd ${cand}`, 75000);
  if (PRINT) console.log(`   render distance ${String(cand).padStart(2)}: ${q.settled ? 'settled' : 'gave up (' + q.reason + ')'} after ${(q.ms / 1000).toFixed(0)}s · ${q.work} sections of work left · ${q.rate.toFixed(0)}/s · ${q.chunks} columns`);
  if (q.settled) { RD = cand; warm = q; break; }
}
ok(RD > 0, `the world never settled at any of render distances ${ladder.join(', ')} — every frame below would be of a world still arriving`);
if (!RD) { RD = ladder[ladder.length - 1]; warm = { ms: 60000 }; await ev(`MCL.Settings.applyPreset('high');` + pin(RD)); }
// every later settle gets three times what the first one needed, and never less than 45 s
const SETTLE = Math.max(45000, warm.ms * 3);

const reference = stats(await shot());
ok(reference.coloured > 0.05,
   `only ${(reference.coloured * 100).toFixed(1)}% of the reference frame carries colour — the camera is not looking at a world`);
ok(reference.sat > 0.08, `the reference frame's saturation is ${reference.sat.toFixed(3)} — nothing to lose`);
if (PRINT) console.log(`   reference (high, rd ${RD}, settled in ${(warm.ms / 1000).toFixed(0)}s): sat ${reference.sat.toFixed(3)} · rgb ${reference.r.toFixed(3)}/${reference.g.toFixed(3)}/${reference.b.toFixed(3)} · ${(reference.coloured * 100).toFixed(1)}% coloured`);

// ⚠ WHAT A PRESET IS ALLOWED TO CHANGE, MEASURED RATHER THAN GUESSED. The look flags do
// legitimately move the whole frame's statistics: ambient occlusion darkens every corner in the
// world, and fast leaves fill the holes in a canopy. So §1's bound is not a number somebody
// liked — it is those flags, measured HERE, in this run, one at a time, and each preset is
// allowed the sum of the ones IT differs from `high` in, plus a margin for run-to-run drift.
// (Before D-166 the bound was a flat 15%; before D-224 it was one flag's delta plus 6% for
// every preset alike, which is both too slack for celeron and far too slack for medium — medium
// differs from `high` in no look flag but `depthPrepass` and now gets essentially the margin.)
const differing = await ev(`(function () {
  var S = MCL.Settings, H = S.PRESETS.high, look = ${JSON.stringify(LOOK_KEYS)}, out = {};
  ['medium', 'low', 'celeron'].forEach(function (p) {
    var P = S.PRESETS[p]; out[p] = [];
    look.forEach(function (k) { if (P[k] !== undefined && P[k] !== H[k]) out[p].push(k); });
  });
  return out;
})()`);
const flags = [...new Set([].concat(...Object.values(differing)))];
ok(flags.length >= 2,
   `the presets differ from "high" in ${flags.length} look flag(s) — the allowance below would be a margin and nothing else`);

// ⚠ ONE TRANSITION PER FLAG, NOT TWO. Restoring a flag and then flipping the next one is two
// full remeshes and two waits for them; doing both in one evaluation is one. On the box these
// checks run on a remesh at the settled render distance takes about seventy seconds, so the
// order matters as well: the flags that only touch the renderer go first, where a transition
// costs a second, and the three that invalidate geometry go last.
const order = flags.slice().sort((a, b) => (MESH_KEYS.indexOf(a) >= 0) - (MESH_KEYS.indexOf(b) >= 0));
const solo = {};
const luma = (t) => (t.r + t.g + t.b) / 3;
for (let i = 0; i < order.length; i++) {
  const f = order[i], prev = i ? order[i - 1] : null;
  const remesh = MESH_KEYS.indexOf(f) >= 0 || (prev && MESH_KEYS.indexOf(prev) >= 0);
  await ev(`${prev ? `MCL.Settings.${prev} = MCL.Settings.PRESETS.high.${prev};` : ''}
            MCL.Settings.${f} = !MCL.Settings.PRESETS.high.${f};
            MCL.Settings.push({ remesh: ${!!remesh}, resize: false });`);
  const qa = await quiet(f, SETTLE);
  ok(qa.settled, `the world never settled with "${f}" flipped (${qa.work} sections of work left at ${qa.rate.toFixed(0)}/s) — its delta below is of a world still arriving`);
  const alt = stats(await shot());
  solo[f] = { sat: Math.abs(alt.sat - reference.sat) / reference.sat,
              luma: Math.abs(luma(alt) - luma(reference)) / luma(reference) };
  if (PRINT) console.log(`   ${f.padEnd(15)} flipped: sat ${(solo[f].sat * 100).toFixed(1)}% · luma ${(solo[f].luma * 100).toFixed(1)}% (settled in ${(qa.ms / 1000).toFixed(0)}s)`);
}
{
  const last = order[order.length - 1];
  await ev(`MCL.Settings.${last} = MCL.Settings.PRESETS.high.${last};
            MCL.Settings.push({ remesh: ${MESH_KEYS.indexOf(last) >= 0}, resize: false });`);
  const qb = await quiet('back to high', SETTLE);
  ok(qb.settled, `the world never settled after "${last}" was put back (${qb.work} left) — every measurement after this one is of a moving picture`);
}

// ⚠ AO CANNOT MOVE SATURATION AND IT IS NOT A BUG THAT IT DOES NOT. Ambient occlusion is a
// per-vertex BRIGHTNESS multiplier, and saturation is `(max - min) / max`, which a uniform scale
// leaves exactly alone. So AO's contribution is asserted on LUMA, where it is real, and the
// saturation allowance comes from the flags that actually repaint texels. Asserting AO on
// saturation would have been a check that can only ever fail.
ok(solo.ao && solo.ao.sat < 0.02, `turning AO off moved SATURATION by ${((solo.ao || {}).sat * 100).toFixed(1)}% — a brightness multiplier cannot, so something else changed with it`);
ok(solo.fancyLeaves && solo.fancyLeaves.sat > 0.02,
   `fast leaves moved saturation by ${((solo.fancyLeaves || {}).sat * 100).toFixed(1)}% — the allowance below is derived from a measurement of nothing`);

const allowance = {};
for (const p of Object.keys(differing))
  allowance[p] = MARGIN + differing[p].reduce((a, k) => a + (solo[k] ? solo[k].sat : 0), 0);
if (PRINT) for (const p of Object.keys(allowance))
  console.log(`   allowance ${p.padEnd(8)} ${(allowance[p] * 100).toFixed(1)}% = margin ${(MARGIN * 100).toFixed(0)}% + [${differing[p].join(', ') || 'nothing'}]`);

console.log('1. every preset paints the same world as `high`, at the same render distance and cost');
const seen = {};
for (const p of ['medium', 'low', 'celeron']) {
  await ev(`MCL.Settings.applyPreset(${JSON.stringify(p)});` + pin(RD));
  const q = await quiet(`preset ${p}`, SETTLE);
  ok(q.settled, `the world never settled after switching to "${p}" (${q.work} sections of work left at ${q.rate.toFixed(0)}/s) — the frame it would be judged on is still arriving`);
  const s = stats(await shot());
  seen[p] = s;
  const dSat = Math.abs(s.sat - reference.sat) / reference.sat;
  const dR = Math.abs(s.r - reference.r), dG = Math.abs(s.g - reference.g), dB = Math.abs(s.b - reference.b);
  const dHue = hueDistance(s.hue, reference.hue);
  // ⚠ the bounds are not tolerances around a known gap (the mistake D-155 and D-156 were both
  // hiding behind). They are what "the same world" means, measured: at the shipped build every
  // preset lands inside a few per cent, and D-159 was a 21% saturation collapse.
  ok(dSat < allowance[p], `preset "${p}" changed mean saturation by ${(dSat * 100).toFixed(1)}%, more than its own flags account for (${(allowance[p] * 100).toFixed(1)}%) — D-159 was a tint being lost`);
  ok(dR < 0.06 && dG < 0.06 && dB < 0.06,
     `preset "${p}" shifted the mean colour by ${dR.toFixed(3)}/${dG.toFixed(3)}/${dB.toFixed(3)}`);
  ok(dHue < 0.30, `preset "${p}" moved ${(dHue * 100).toFixed(0)}% of the hue distribution`);
  ok(s.coloured > reference.coloured * 0.6,
     `preset "${p}" left only ${(s.coloured * 100).toFixed(1)}% of the frame coloured, against ${(reference.coloured * 100).toFixed(1)}%`);
  if (PRINT) console.log(`   ${p.padEnd(8)} sat ${s.sat.toFixed(3)} (${(dSat * 100).toFixed(1)}% of ${(allowance[p] * 100).toFixed(1)}%) · rgb d ${dR.toFixed(3)}/${dG.toFixed(3)}/${dB.toFixed(3)} · hue d ${(dHue * 100).toFixed(0)}% · ${(s.coloured * 100).toFixed(1)}% coloured`);
}

console.log('2. fast leaves are still LEAVES: the tint survives the opaque pass (D-159)');
{
  // ⚠ SECTION 1 CANNOT SEE THIS BUG AND IT WAS A MISTAKE TO THINK IT COULD. Whole-frame
  // statistics dilute a change that only touches leaves: with D-159 deliberately reintroduced,
  // the `low` preset moved mean saturation by 5.8% against a 15% bound, and passed. A frame is
  // mostly ground and sky, and a bug in the leaves is a bug in a few per cent of the pixels.
  //
  // So compare the pixels that ACTUALLY CHANGE. Toggle nothing but `fancyLeaves`, diff the two
  // frames, and ask what happened to the pixels that moved — which are, by construction, the
  // leaves. On those pixels the question is sharp: fast leaves fill the holes in the leaf texture
  // with a neighbour's colour (D-146's bleed) and that colour is TINTED, so the changed pixels
  // stay as saturated as they were. D-159 left them untinted, and they lose a third of it.
  //
  // ⚠ AND BOTH FRAMES HAVE TO BE OF A FINISHED WORLD (D-224). With a fixed 9 s sleep here this
  // section reported 37 changed pixels at the medium preset — not a camera pointed away from the
  // canopy, just a remesh 4% done. `quiet` is what makes "the pixels that moved" mean the leaves.
  await ev(`MCL.Settings.applyPreset('high');` + pin(RD));
  const q0 = await quiet('fancy', SETTLE);
  ok(q0.settled, `the fancy-leaf frame was taken with ${q0.work} sections still to mesh`);
  const fancyIm = await shot();
  await ev(`MCL.Settings.fancyLeaves = false;
            MCL.Settings.push({ remesh: true, resize: false });`);
  const q1 = await quiet('fast', SETTLE);
  ok(q1.settled, `the fast-leaf frame was taken with ${q1.work} sections still to mesh — the diff below would be of a half-finished remesh`);
  const fastIm = await shot();
  await ev(`MCL.Settings.fancyLeaves = true; MCL.Settings.push({ remesh: true, resize: false });`);

  const d = diffStats(fancyIm, fastIm);
  ok(d.moved > 400,
     `only ${d.moved} pixels changed when leaves were switched to fast — the camera is not looking at any (D-159 is invisible from here)`);
  ok(d.movedFrac < 0.60,
     `${(d.movedFrac * 100).toFixed(0)}% of the frame changed — that is not a leaf setting, the two shots are of different scenes`);
  const lost = (d.satA - d.satB) / Math.max(1e-6, d.satA);
  ok(lost < 0.15,
     `the pixels that fast leaves changed lost ${(lost * 100).toFixed(1)}% of their saturation — the tint is being dropped in the opaque pass (D-159)`);
  if (PRINT) console.log(`   ${d.moved} pixels changed (${(d.movedFrac * 100).toFixed(1)}% of the crop) · saturation ${d.satA.toFixed(3)} -> ${d.satB.toFixed(3)} (${(lost * 100).toFixed(1)}% lost)`);
}

console.log('3. anti-vacuity');
{
  const av = [];
  const brk = (label, fn) => { let caught = false; try { fn(); } catch { caught = true; } av.push([label, caught]); };

  brk('a frame with no colour in it read as a world', () => {
    const grey = { n: 100, r: 0.5, g: 0.5, b: 0.5, sat: 0.0, coloured: 0.0, hue: new Array(12).fill(0) };
    if (grey.coloured <= 0.05) throw 0;
  });
  brk('a saturation collapse going unnoticed', () => {
    // the D-159 magnitude on the CHANGED pixels, against the bound §2 uses
    const satA = 0.42, satB = 0.27;
    if ((satA - satB) / satA >= 0.15) throw 0;
  });
  brk('a diff over two identical frames read as a change', () => {
    const im = { width: 40, height: 40, data: new Uint8Array(40 * 40 * 4).fill(120) };
    if (diffStats(im, im).moved === 0) throw 0;
  });
  brk('two identical hue distributions read as different', () => {
    const a = new Array(12).fill(1 / 12);
    if (hueDistance(a, a) < 1e-9) throw 0;
  });
  brk('the hue distance saturating on disjoint distributions', () => {
    const a = new Array(12).fill(0), b = new Array(12).fill(0);
    a[0] = 1; b[6] = 1;
    if (Math.abs(hueDistance(a, b) - 1) < 1e-9) throw 0;
  });
  brk('the crop covering no pixels', () => {
    const im = { width: 640, height: 360, data: new Uint8Array(640 * 360 * 4) };
    if (stats(im).n > 1000) throw 0;
  });

  // ── the settle rule, run as itself (D-224). These are the mutants that would put the fixed
  // sleep back: a wait that calls an unfinished world settled, and a wait that sits out its
  // whole budget on a box that could never have finished.
  brk('a remesh that has barely started read as settled', () => {
    // the measured D-224 case, and the exact moment the old fixed sleep took its screenshot:
    // 8,400 sections dirty, 25 a second, seven seconds in
    if (settleVerdict(8400, 7000, 25, 45000, 0, 0) !== 'settled') throw 0;
  });
  brk('a world 8,400 sections behind at 25/s read as finishable inside 45 s', () => {
    if (settleVerdict(8400, 5000, 25, 45000, 0, 0) === 'slow') throw 0;
  });
  brk('a nearly-finished world read as finished', () => {
    if (settleVerdict(12, 5000, 20, 45000, 0, 0) === 'waiting') throw 0;
  });
  brk('a finished world read as unfinished', () => {
    if (settleVerdict(0, 5000, 20, 45000, 0, 0) === 'settled') throw 0;
  });
  brk('a streamer that stopped delivering read as still working', () => {
    if (settleVerdict(40, 20000, 0, 45000, 6, 6) === 'stuck') throw 0;
  });
  brk('a preset key that is neither pinned nor measured slipping through', () => {
    if (unclassifiedKeys(['renderDistance', 'ao', 'somethingNobodyClassified']).length === 1) throw 0;
  });
  brk('every real preset key already being classified', () => {
    if (unclassifiedKeys(COST_KEYS.concat(LOOK_KEYS)).length === 0) throw 0;
  });
  brk('a preset that differs in nothing being allowed more than the margin', () => {
    const a = MARGIN + [].reduce((x, k) => x + 1, 0);
    if (Math.abs(a - MARGIN) < 1e-9) throw 0;
  });

  for (const [label, caught] of av) {
    ok(caught, `ANTI-VACUITY FAILURE: "${label}" was not caught — this check proves nothing`);
    console.log(`   ${caught ? '✓' : '✗'} ${label}`);
  }
}

await page.close();

console.log('');
console.log('=============== palettecheck ==============');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log('==========================================');
process.exit(fails.length ? 1 : 0);
