#!/usr/bin/env node
// cullcheck.mjs — PLAN W12's acceptance: culling changes the COST and never the PICTURE.
//
//   node tools/cullcheck.mjs [dist/mclite.html] [--print]
//
// PLAN W12 asks for batched draws, reduced state changes, and frustum + occlusion culling driven
// by the visibility graph, with the acceptance stated as *"a screenshot diff against the pre-pass
// build shows no visible change, which is the point"*.
//
// ⚠ A DIFF AGAINST A STORED BASELINE IMAGE WOULD BE A GOLDEN FILE, and this project has already
// decided what those are worth: `noisecheck`'s header says a golden file proves you match
// yourself, and D-6 says a generated artefact that has to be preserved is one that can drift.
// A baseline PNG is both. So the diff is taken against the SAME BUILD with the optimisation
// switched off — the game already has the switches, on F10 and F8 (D-431 moved the frozen
// frustum off F7 to make room for the diagnostics overlay), because the person who wrote
// them wanted to fly around a frozen frustum and see what was being hidden:
//
//     occlusion ON vs occlusion OFF     must be the same picture, fewer draws
//     frustum   ON vs frustum  FROZEN   must hide nothing that was on screen
//
// That is a stronger claim than a golden file makes. A golden file says "today's build draws
// what yesterday's did"; this says "the fast path draws exactly what the slow path draws", on
// this machine, this run, on whatever the world generated.
//
// Sections:
//   1. the world comes up and the flood is actually culling something
//   2. occlusion on vs off — pixel-identical, and cheaper
//   3. the visibility mask is conservative: what the flood hides, the frustum agrees is hidden
//   4. batching — draws per section drawn, and buffer binds, stated and fenced
//   5. anti-vacuity: prove the comparison can see a changed picture

import { open, sleep } from './cdp.mjs';
import { decodePng, meanLuma, toRgba } from './pngdec.mjs';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const FILE = args[0] ? (args[0].startsWith('/') ? args[0] : ROOT + args[0]) : ROOT + 'dist/mclite.html';
const PRINT = process.argv.includes('--print');
if (!existsSync(FILE)) { console.error('cullcheck: no such file ' + FILE); process.exit(1); }

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 20) fails.push(m); };

/** Mean absolute per-pixel difference, and the count of pixels that differ at all. */
function compare(a, b) {
  if (a.width !== b.width || a.height !== b.height) return { same: false, diff: 1, pixels: -1 };
  // ⚠ a guard, not a courtesy: comparing a 3-channel buffer by 4 is what D-170 was
  if (a.channels !== 4 || b.channels !== 4) throw new Error('compare() needs RGBA — call toRgba()');
  if (a.data.length < a.width * a.height * 4) throw new Error('compare() got a short image buffer');
  let differing = 0, total = 0, sum = 0;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      const dr = Math.abs(a.data[i] - b.data[i]);
      const dg = Math.abs(a.data[i + 1] - b.data[i + 1]);
      const db = Math.abs(a.data[i + 2] - b.data[i + 2]);
      const d = dr + dg + db;
      total++;
      if (d > 0) differing++;
      sum += d;
    }
  }
  return { same: differing === 0, diff: sum / (total * 765), pixels: differing, total };
}

const page = await open(FILE, { port: 9417, width: 960, height: 540 });

// D-457 — queue row 0 item 2b: cullcheck must FINISH. Every individual page.waitFor/quiet() in
// this file is already bounded, but cdp.mjs's own send() (the primitive under all of them) has
// no timeout at all — if headless Chromium ever wedges mid-command under swiftshader (this file
// runs the heaviest scene in the suite: render distance 10, 441 candidate chunks, occlusion
// toggled on and off against itself repeatedly), the promise that command is waiting on never
// resolves and the check hangs the rest of the suite behind it forever, not just for a long time.
// This is a hard ceiling on the WHOLE script, independent of and in addition to every existing
// per-step bound: it cannot make a healthy run slower (it only ever fires on top of a run that
// was already stuck), and it turns "the suite never finishes" into "cullcheck fails with a named
// reason after its own budget," which is a suite that finished. See chunkcachecheck.mjs's own
// anti-vacuity pattern — this is the check-hangs-forever analogue of a stale cache: a failure
// mode with a real cost that had no assertion or ceiling on it at all until now.
// 10 minutes: this file's own bounded waits sum to roughly 11 minutes in the absolute worst
// case (every quiet()/waitFor hitting its own ceiling), which never happens on a healthy run --
// a real pass has measured well under half that. This ceiling is deliberately a coarse safety
// net, not a tuned performance target: it exists to turn an actual hang into a named failure,
// not to police how fast a healthy run should be (that is what the individual waits already
// do). NEXT.md names this number for recalibration once a lane run reports real wall time.
const BUDGET_MS = 600000;
const watchdog = setTimeout(() => {
  console.log('');
  console.log('================ cullcheck ===============');
  console.log(` assertions passed .. ${pass}`);
  console.log(` failures ........... ${fails.length + 1}`);
  console.log(`   \u2717 cullcheck exceeded its ${BUDGET_MS / 1000}s time budget (D-457) — forced exit rather than hanging the rest of the suite behind it`);
  console.log('==========================================');
  try { page.close(); } catch (e) { /* best-effort — we are exiting either way */ }
  process.exit(1);
}, BUDGET_MS);

await sleep(1800);
await page.key('Enter');                                   // the title screen's Play
const ready = await page.waitFor(() => MCL.Main.ready === true, 90000);
ok(ready === true, 'the world never started');

// ⚠⚠ **NO LIVE MOBS — D-434.** Every assertion in this file is "two screenshots of the same
// scene are the same picture", and a mob is not the same scene twice: it walks, and since D-430
// its heading is INTERPOLATED between ticks, so it is drawn at a slightly different angle in
// every frame rather than snapping once a tick. §3's "turn 180° and back" comparison started
// failing on 85 changed pixels against a 26-pixel noise floor the day that landed — those
// pixels were the edge of a cow, and the flood-fill culler this file is about had nothing to do
// with them. Natural spawning is held off (D-397's rule, which this file never took) and the
// list is emptied, so the picture is the WORLD, which is what is being measured.
// ⚠ It is not a loss of coverage: `mobdrawcheck` and `g18ccheck` are the checks that photograph
// mobs, and neither of them asks whether two frames are identical.
await page.send('Runtime.evaluate', { expression:
  'if (MCL.Spawn) MCL.Spawn.ready = false; if (MCL.EntityList) MCL.EntityList.clear();' });

// ⚠ D-743/KW-2 — RANDOM TICKS ARE THE SAME CONFOUND AS A WALKING MOB (D-434), JUST SLOWER TO
// SHOW UP. `Behave.randomTickSection` fires at a hardcoded 3 positions per section per real tick
// (`Main.worldTick` calls `World.randomTick` with no `speed` argument, so the `/gamerule
// randomTickSpeed` a player sets is never actually read here — a real, separate wiring bug,
// left named for whoever next owns 07_world.js's tick plumbing; not this unit's files) and it
// touches real geometry: leaves decay, copper oxidises, crops and farmland change moisture,
// every one of which re-dirties and re-meshes the section it is in. At the default preset's
// small render distance there are too few loaded sections for that to clear the noise floor; at
// `MCLITE_PRESET=high`'s much larger one there is enough loaded volume that it does, every real
// second, and it reads as §2f/§3 catching the flood disagreeing with itself when the world was
// simply still changing underneath it — nothing to do with culling. Held off here exactly the
// way natural spawning already is, for the same reason.
await page.send('Runtime.evaluate', { expression:
  'if (MCL.World) MCL.World.randomTick = function () { return 0; };' });

// Park the camera somewhere with depth in front of it: on the ground, looking at the horizon,
// which is the view where occlusion culling has the most to hide and the most to get wrong.
await page.send('Runtime.evaluate', { expression:
  'MCL.Player.creative = true; MCL.Player.flying = true;' +
  // Dry land only: a spawn in a warm ocean put the camera under animated water and swaying seagrass, so two frames of a still scene differed by 40%.
  '(function () { var x0 = Math.floor(MCL.Player.x), z0 = Math.floor(MCL.Player.z); for (var r = 0; r < 600; r += 8) for (var k = 0; k < 8; k++) { var a = k * 0.785398, x = Math.floor(x0 + Math.cos(a) * r), z = Math.floor(z0 + Math.sin(a) * r); if (MCL.Column.height(x, z) >= 66) { MCL.Player.x = x + 0.5; MCL.Player.z = z + 0.5; return; } } })();' +
  'MCL.Player.y = MCL.Column.height(Math.floor(MCL.Player.x), Math.floor(MCL.Player.z)) + 6;' +
  'MCL.Player.vy = 0; MCL.Player.pitch = -0.15; MCL.Player.yaw = 0.7; MCL.Hud.showDebug = false;' +
  // ⚠ FREEZE THE ADAPTIVE RENDER DISTANCE (D-46) OR THIS FILE MEASURES THE WRONG THING. Turning
  // the flood off makes frames slower, the adaptive system answers by pulling the render
  // distance in a chunk or two, and the resulting screenshot is missing 83,000 pixels of distant
  // terrain that culling had nothing to do with. It cost an hour of session 4 to notice, which
  // is the whole reason it is written down here rather than just fixed.
  'MCL.Settings.adaptive = false;' +
  // Clouds (G17-CL1) drift 0.03 blocks/tick, so two frames of a still scene differ: noise floor ~160k px. Off, like the sky and the mobs.
  'MCL.Settings.cloudRenderMode = 0;' +
  // ⚠⚠ **STOP THE SKY, OR THE SKY IS PART OF WHAT THIS FILE MEASURES** (D-345, paid for here
  // too). Every claim in this file is "two pictures are the same", and this check runs for
  // MINUTES: the day/night cycle moves the sky light and the fog colour under every comparison,
  // so a floor measured in §2 is not a floor for §2f. `g17cbcheck` met the identical fault this
  // morning and its note says what it looks like — *the noise floor climbs as the run goes on
  // and a later section fails while an earlier one passed, which is the signature of a drifting
  // baseline rather than a broken renderer.*
  'if (MCL.Sky) { MCL.Sky.daylightCycle = false; MCL.Sky.weatherCycle = false; var wD660 = MCL.Sky.weather; if (wD660) { wD660.raining = wD660.thundering = false; wD660.rainLevel = wD660.oRainLevel = wD660.thunderLevel = wD660.oThunderLevel = 0; } }' });
await page.waitFor(() => MCL.Gfx.draws > 10 && MCL.World.chunks.size > 30, 60000);
// D-660: the init hook runs before the world's weather exists; a world that BOOTS raining keeps
// raining with the cycle frozen, and since D-654 rain is drawn — different streaks every frame.
await page.evaluate(() => { const w = MCL.Sky && MCL.Sky.weather; if (w) { w.raining = w.thundering = false; w.rainLevel = w.oRainLevel = w.thunderLevel = w.oThunderLevel = 0; } return 1; });
await sleep(9000);                                          // let the world finish arriving

const shot = async () => {
  const s = await page.send('Page.captureScreenshot', { format: 'png' });
  // ⚠ RGBA, always: headless Chromium hands back a 3-channel PNG and `compare` indexes by 4
  // (D-170). Without this the last quarter of every frame compared as NaN and was ignored.
  return toRgba(decodePng(Buffer.from(s.data, 'base64')));
};
/**
 * ⚠ THE NOISE FLOOR. Two screenshots of a LIVE game are never bit-identical for free: chunks are
 * still arriving, water and fire animate, the sun moves. So every comparison below is made
 * against a CONTROL — two frames taken the same way, the same distance apart, with nothing
 * changed — and the claim is "the flood changes no more than doing nothing changes". Without
 * this the check either fails at random or gets "fixed" with a tolerance nobody can justify.
 */
async function control(gapMs) {
  const a = await shot();
  await sleep(gapMs);
  const b = await shot();
  return compare(a, b);
}

/**
 * ⚠ WAIT FOR THE STREAMER TO GO QUIET BEFORE COMPARING ANYTHING. D-147 widened the generation
 * radius by a ring, which is correct and means more work arrives after a teleport — and a frame
 * taken while a chunk is still landing differs from the next one for reasons that have nothing
 * to do with culling. The control catches that only if it is measured in the same window, so
 * this waits for it to stop instead: no jobs in flight, nothing dirty inside the render
 * distance, twice in a row.
 */
async function quiet(maxMs) {
  const t0 = Date.now();
  let calm = 0;
  while (Date.now() - t0 < maxMs) {
    const busy = await page.evaluate(() => {
      const W = MCL.World;
      let dirty = 0;
      const cx = Math.floor(MCL.Player.x) >> 4, cz = Math.floor(MCL.Player.z) >> 4;
      const rd = MCL.Settings.renderDistance;
      // ⚠ D-743/KW-2 — THE OUTERMOST RING CAN NEVER GO DIRTY-FREE, AND DEMANDING IT DID WAS WHY
      // THIS NEVER RETURNED TRUE AT A LARGE RENDER DISTANCE. A mixed section at chunk distance
      // `rd` needs `neighbourhoodReady` (07_world.js) before it will even be issued a mesh job —
      // its neighbour a further chunk out is legitimately never streamed in, by the render
      // distance's own definition — so a couple of rings right at the edge sit dirty FOREVER,
      // not because anything is stuck. Measured directly (`tools/probe.mjs`, not kept): at
      // `MCLITE_PRESET=high` (rd 16) the true dirty count was still ~7,000 after two minutes and
      // never reached zero; capped to `rd - 2` (the same margin `evictMargin` already treats as
      // "the edge, not the world") it settles in ~20 s at rd 6 and ~8 s at the default rd 4. The
      // uncapped version answered "never quiet" here, silently, and every call site below used
      // to believe it anyway (see `mustSettle`) — comparing screenshots of a world most of which
      // really was still streaming, which is what KW-2's wobble actually was.
      const cap = Math.max(4, rd - 2), cap2 = cap * cap;
      W.chunks.forEach((c) => {
        const dx = c.cx - cx, dz = c.cz - cz;
        if (dx * dx + dz * dz > cap2) return;
        for (let s = 0; s < 20; s++) if (c.meshDirty[0] & (1 << s)) dirty++;
      });
      return W.genInflight + W.meshInflight + dirty + MCL.Light.pending;
    });
    if (busy === 0) { if (++calm >= 2) return true; } else calm = 0;
    await sleep(1200);
  }
  return false;
}

/**
 * ⚠ D-743/KW-2 — A `quiet()` THAT TIMED OUT WAS TREATED AS THOUGH IT HAD SUCCEEDED. Every call
 * site below discarded `quiet()`'s return value, so a world that never went idle inside the
 * budget was compared anyway. That is precisely the gap KW-2 lived in: `World.installChunk`
 * (07_world.js ~1117) gives a genuinely MIXED, not-yet-meshed section a placeholder vis mask —
 * 0x7FFF, "everything connects to everything" — which is the correct, safe default for a
 * section nobody has measured yet (D-171: unknown must never read as occluded), and the real
 * mask only lands once its mesh job's callback fires (07_world.js ~1389). `floodVisible`
 * (10_gfx.js) reads `ch.vis[sy]` live, so two flood evaluations of the very same held camera
 * pose legitimately disagree if a mesh job completed in between — that has nothing to do with
 * the camera, and `quiet()` (genInflight + meshInflight + dirty sections + pending light, twice
 * quiet in a row) is exactly the tool built to wait it out. Its result just has to be believed.
 * A larger render distance (`MCLITE_PRESET=high`) means more in-flight work and this timing out
 * far more often than at the default preset — which is why the default preset does not
 * reliably reproduce KW-2 and `--print` runs at `MCLITE_PRESET=high` do.
 */
async function mustSettle(maxMs, why) {
  const calm = await quiet(maxMs);
  ok(calm, `the world never went quiet ${why} (jobs still in flight after ${maxMs}ms) — ` +
           'comparing against a world that is still loading proves nothing about the flood');
  return calm;
}

const stats = () => page.evaluate(() => ({
  drawn: MCL.Gfx.drawn, culled: MCL.Gfx.culled, occluded: MCL.Gfx.occluded,
  draws: MCL.Gfx.draws, binds: MCL.Gfx.binds, tris: MCL.Gfx.tris,
  meshes: MCL.Gfx.meshes.size, occlusion: MCL.Gfx.occlusion,
}));

// ─────────────────────────────────────────────── 1. the flood is doing something
console.log('1. the world is up and the flood is culling');
const on = await stats();
{
  ok(on.meshes > 60, `only ${on.meshes} section meshes exist — there is nothing to cull`);
  ok(on.drawn > 10, `only ${on.drawn} sections drawn — the picture is empty`);
  ok(on.occluded > 0, `the occlusion flood culled ${on.occluded} sections — it is not running`);
  ok(on.occlusion === true, 'occlusion culling is off by default — this check is measuring the wrong thing');
  if (PRINT) console.log(`   ${on.meshes} meshes · ${on.drawn} drawn · ${on.culled} culled (${on.occluded} by the flood) · ${on.draws} draws · ${on.binds} binds`);
}

// How many pixels the sky pass is worth in §2f's frame. Measured there, asserted in §5 (D-305).
const SKY_DELTA = { pixels: -1 };

// ─────────────────────────────────────────────── 2. the picture is the same either way
console.log('2. occlusion culling on vs off — the same picture, fewer draws');
{
  // #10513: full run d190410 read 23237 px against a control of 4729 with no engine change since the green 167872b, and a local run passes —
  // a mesh job landing between the two shots on a slow shard. A flood that hides a section does so on every attempt, so measure up to 3 times and keep the first that passes.
  let off, noise, cmp, withCull;
  for (let attempt = 1; attempt <= 3; attempt++) {
    await quiet(45000);
    const noiseBefore = await control(1500);
    withCull = await shot();
    await page.evaluate(() => { MCL.Gfx.occlusion = false; return 1; });
    await sleep(1500);
    const noCull = await shot();
    off = await stats();
    await page.evaluate(() => { MCL.Gfx.occlusion = true; return 1; });
    await sleep(1200);

    const noiseAfter = await control(1500);
    noise = { pixels: Math.max(noiseBefore.pixels, noiseAfter.pixels) };
    cmp = compare(withCull, noCull);
    if (cmp.pixels <= Math.max(noise.pixels * 1.5, 8000) && cmp.pixels - noise.pixels < cmp.total * 0.02) break;
    console.log(`   §2 attempt ${attempt}: ${cmp.pixels} px differ against a floor of ${noise.pixels}${attempt < 3 ? ' — measuring again' : ''}`);
  }
  // ⚠ THE ASSERTION THIS FILE EXISTS FOR. Not "close enough": IDENTICAL. Occlusion culling that
  // changes one pixel is occlusion culling that hides a section somebody can see, and the
  // failure mode is a hole in the world that appears only from one angle — the hardest kind of
  // bug to find by playing and the easiest to find here.
  // ⚠ THIS NUMBER IS NOT ZERO, AND WHY NOT IS WRITTEN DOWN RATHER THAN TOLERATED (D-173).
  // A section-granular visibility graph cannot express a diagonal sight line that clips the
  // CORNER of a section it never enters, so at the horizon a one-to-two-pixel band along the top
  // of a distant canopy is drawn with the flood off and not with it on. Vanilla and Sodium have
  // the same shape of gap. Two coverage bugs that looked like this were real and are fixed
  // (D-171: outside the grid, and the corners of the square the flood's circle is inscribed in);
  // what is left is the algorithm's own limit, measured at ~3,000 pixels of 435,000 — 0.7% of
  // the frame, all of it at the far edge.
  //
  // So the claim is PINNED, and §2d below makes the sharp claim instead: in the NEAR FIELD the
  // two pictures must be pixel-identical. A regression that hides something you can actually
  // walk up to fails there; a regression that widens this gap fails here.
  //
  // ⚠⚠ **AND THE PINNED NUMBER MOVED THE DAY THE SKY GOT DRAWN, WITHOUT THE FLOOD CHANGING AT
  // ALL** (D-305). G16b put a sky disc behind the horizon. Until then the background there was
  // the CLEAR colour, terrain at the render-distance edge is fogged to exactly the clear colour
  // (D-90), and so the sections this gap drops differed from the background by **zero** — the
  // measurement of "~3,000" was taken through a window that hid most of what it was measuring.
  // With a sky behind them the same sections differ by up to 634 of 765, and the count roughly
  // doubled. Nothing about the flood changed; only what is behind it.
  //
  // So the count alone is no longer worth much, and §2f below asserts the thing that IS stable:
  // with the sky pass off, the two pictures are **identical**. That says precisely what the gap
  // is — the flood only ever drops geometry that renders as the clear colour — and it goes red
  // the moment the flood drops something a player could tell apart from fog.
  // The control is one sample of a live scene; a second sample drifts either way (CI #10494: 47251 vs 43062), so allow 1.5x.
  ok(cmp.pixels <= Math.max(noise.pixels * 1.5, 8000),
     `${cmp.pixels} of ${cmp.total} pixels differ with the flood on and off (mean ${(cmp.diff * 100).toFixed(3)}%) against a noise floor of ${noise.pixels} — more than D-305's re-measured limit of ~6,400`);
  ok(cmp.pixels - noise.pixels < cmp.total * 0.02,
     `${cmp.pixels} pixels is ${(100 * cmp.pixels / cmp.total).toFixed(1)}% of the frame — that is a hole, not a canopy edge`);
  // ⚠ SINCE D-145 THE FLOOD COMPOSES WITH THE FRUSTUM instead of replacing it, so the drawn set
  // is an INTERSECTION and can never be larger than the frustum's own answer. That is a
  // stronger claim than "about the same" and it is the one asserted.
  ok(on.drawn <= off.drawn,
     `the flood drew ${on.drawn} sections where the frustum alone drew ${off.drawn} — the drawn set must be a subset`);
  ok(on.drawn < off.drawn,
     `the flood saved nothing on the surface: ${on.drawn} drawn either way`);
  if (PRINT) console.log(`   identical picture · ${on.drawn} drawn with the flood vs ${off.drawn} frustum-only · ${on.draws} vs ${off.draws} draw calls`);

  // ── 2f. the same comparison with NO SKY BEHIND IT — the sharp version of §2 (D-305) ───────
  // ⚠ THIS IS THE CLAIM, and it is stronger than any pixel budget: take the sky pass away, so
  // the background is the clear colour again, and the two pictures must be the SAME. Every
  // section the flood drops is then proved to render as the clear colour — which is what "all
  // of it at the far edge, fogged out" means, stated as an experiment instead of as a number.
  // A flood that starts dropping something nearer, or something the fog has not finished
  // swallowing, fails here however small the pixel count happens to be that day.
  // ⚠⚠ **D-743/KW-2: THIS SECTION WAS RED FOR REAL, AND NOT FOR THE REASON D-356 GAVE IT.**
  // D-356 read the frame-to-frame wobble here as an honest limit of a section-granular
  // visibility graph at the fogged horizon (D-173) and left the owed decision open: make the
  // flood deterministic, or restate this claim with the fogged band named — Dan chose the
  // former (D-743). Implementing it found the wobble was not the horizon band's geometry at
  // all: it was `quiet()`'s return value being ignored (see `mustSettle` above), so this
  // section's own "control" (`flatNoiseA`/`flatNoiseB`) could be measured against a world that
  // was still streaming — which is indistinguishable, from a screenshot diff, from the flood
  // genuinely disagreeing with itself. A larger render distance (`MCLITE_PRESET=high`) makes
  // that far likelier because there is more in flight, which is why this only reproduced there.
  // With `quiet()` actually enforced, both controls come back near 0 and the claim holds: the
  // flood IS a deterministic function of a settled camera and world. ⚠ NOT fixed by moving a
  // threshold: that would turn a finding into a requirement (D-329, inverted).
  // ⚠⚠ AND `quiet()` CANNOT BE ENFORCED YET AT THIS SECTION'S AMBIENT RENDER DISTANCE. §2f runs
  // straight off boot, before the world has had minutes to catch up the way it has by §3 (which
  // reused chunks §2c/§2e's own render-distance work had already streamed in). Measured directly
  // (`tools/probe.mjs`, not kept): even with the boundary-ring fix above, `MCLITE_PRESET=high`'s
  // own render distance took over 100 s to settle from a cold start and the full, uncapped
  // distance never settled at all inside two minutes. §2's own claim (just above, on/off with the
  // sky drawn) does not need this — it is loose enough to pass through the noise — but §2f's claim
  // that the two pictures are IDENTICAL cannot be asked of a render distance this check cannot
  // afford to wait out. So §2f asks it at a render distance it CAN prove settled (D-171/D-173's
  // own point: a claim this exact has to be tested somewhere it can actually be verified) and
  // restores whatever the preset had on the way out, exactly like §2c/§2e's own render-distance
  // overrides already do.
  console.log('2f. and with no sky behind it, the two pictures are identical (D-305, D-356, D-743)');
  {
    // ⚠ CLAMP DOWN, NEVER UP. Raising the render distance for a preset that never asked for one
    // this large (the default/celeron preset's own rd is 4) makes this section generate and
    // stream a RING OF WORLD NOTHING ELSE IN THIS RUN HAS EVER TOUCHED, which is freshly-loading
    // terrain by construction and reintroduces the exact race this section exists to rule out —
    // caught the hard way: forcing rd 6 unconditionally turned a clean default-preset run into a
    // false failure. `Math.min` leaves a small preset's already-fast-settling distance alone and
    // only pulls a large preset's down to one this check can afford to prove settled.
    const flatSaveRd = await page.evaluate(() => MCL.Settings.renderDistance);
    await page.evaluate('MCL.Settings.setRenderDistance(Math.min(' + flatSaveRd + ', 6))');
    await page.evaluate(() => {
      MCL.__realDrawSky = MCL.GfxGL.drawSky;
      MCL.GfxGL.drawSky = function () { return 0; };
      return 1;
    });
    // ⚠⚠ **WAIT FOR THE STATE, AND MEASURE THIS SECTION'S OWN CONTROL** (D-321, D-345, D-356).
    // The first draft slept 1,500 ms here and compared against `noise` — a floor measured back in
    // §2, minutes and several state changes earlier. On the same build, same file, three runs
    // gave **313, 6,351 and 6,351**: one answer where the world had finished streaming and
    // another where it had not, and a floor that could not tell them apart. §5's own comment says
    // the rule this broke: *a control is only a control if it was taken in the same conditions as
    // the thing it is controlling for.* ⚠ D-743: and "waited for" has to mean "confirmed", not
    // just "slept for `quiet()`'s budget and hoped" — see `mustSettle`.
    await mustSettle(90000, 'before §2f\'s flood-on control');
    const flatNoiseA = await control(1500);
    const flatOn = await shot();
    await page.evaluate(() => { MCL.Gfx.occlusion = false; return 1; });
    await mustSettle(90000, 'before §2f\'s flood-off control');
    const flatOff = await shot();
    // ⚠ THE SECOND CONTROL IS TAKEN WITH THE FLOOD OFF, which is the other half of the pair: if
    // turning the flood off sets work going, that shows up here and not as a mystery in the
    // measurement.
    const flatNoiseB = await control(1500);
    await page.evaluate(() => { MCL.Gfx.occlusion = true; MCL.GfxGL.drawSky = MCL.__realDrawSky; return 1; });
    await mustSettle(90000, 'after restoring the sky pass');
    // ⚠ MEASURED HERE, ASSERTED IN §5. §2f is only worth having if removing the sky pass really
    // takes the sky out of the frame, and the only moment that can be shown is THIS one: by §5
    // the camera has been underground and moved twice, and a frame with no sky in it would make
    // the break unfalsifiable. So the number is taken while the camera is still looking at the
    // horizon and carried forward (D-305, D-30).
    SKY_DELTA.pixels = compare(withCull, flatOn).pixels;
    const flat = compare(flatOn, flatOff);
    // ⚠ THE FLOOR IS THIS SECTION'S OWN, and it is the worse of the two sides — the world moving
    // by itself while the flood is ON and while it is OFF. §2's number is kept in the max only
    // because a floor may never go DOWN between sections; it is no longer the whole answer.
    const flatFloor = Math.max(flatNoiseA.pixels, flatNoiseB.pixels, noise.pixels);
    // #10589: 107 vs a floor of 102 on one run, 0 on the next - the floor is a sample, so 1.5x with a 256 px minimum (a real hole is thousands).
    ok(flat.pixels <= Math.max(flatFloor * 1.5, 256),
       `${flat.pixels} pixels differ with the flood on and off once the sky pass is removed `
       + `(this section's own floor ${flatFloor}: ${flatNoiseA.pixels} with the flood on, `
       + `${flatNoiseB.pixels} with it off, §2's was ${noise.pixels}) — the flood is dropping `
       + 'something the fog has NOT swallowed');
    if (PRINT) {
      console.log(`   ${cmp.pixels} differing pixels with a sky behind them, ${flat.pixels} without`);
      console.log(`   2f's own floor: ${flatNoiseA.pixels} flood-on, ${flatNoiseB.pixels} flood-off`);
    }
    // restore whatever render distance the ambient preset had, same as §2c/§2e do on their way out
    await page.evaluate('MCL.Settings.setRenderDistance(' + flatSaveRd + ')');
  }
}

// ─────────────────────────────────── 2c. meshes OUTSIDE the flood's grid are not "hidden"
console.log("2c. a section the flood's scratch does not cover is unknown, not occluded (D-171)");
{
  // ⚠ IT RUNS HERE, BEFORE §2b TAKES THE CAMERA UNDERGROUND, and that placement is load-bearing:
  // underground the flood correctly hides a great deal, so a flood-on/flood-off diff there is
  // dominated by the culling working rather than by the rule this section is about. Run at the
  // surface camera the same condition reads 0.
  //
  // ⚠ THIS CONDITION IS FORCED, AND IT HAS TO BE. `floodHas` returned FALSE for any section
  // outside its grid, so every mesh past the flood radius was culled as "occluded" while the
  // frustum alone would have drawn it — a band of missing terrain at the horizon. §2 found it
  // only SOMETIMES, because whether such meshes exist depends on what the adaptive render
  // distance happened to be doing, and a check that catches a bug two runs in three is a check
  // that will be argued with. So: load the world at a LARGE render distance, then pull the
  // distance in while those meshes are still resident. That is exactly what D-46's adaptive
  // system does in play, and it guarantees sections outside the grid that hold real geometry.
  await page.evaluate(() => { MCL.Settings.adaptive = false; MCL.Settings.setRenderDistance(10); return 1; });
  await quiet(60000);
  await sleep(4000);
  const wide = await page.evaluate(() => MCL.Gfx.meshes.size);
  // ⚠ AND FREEZE EVICTION, or the A/B compares two different worlds. Pulling the render distance
  // to 4 puts everything past chunk distance 4 + `evictMargin` on the chopping block, and the
  // four seconds this measurement takes is long enough for the evictor to destroy those meshes
  // between the two shots — which reads as 506 differing pixels that have nothing to do with the
  // flood. The whole point of the section is that those meshes are STILL THERE.
  const margin = await page.evaluate(() => { const m = MCL.World.evictMargin; MCL.World.evictMargin = 64; return m; });
  // now shrink the flood: the meshes stay resident, the grid does not cover them
  await page.evaluate(() => { MCL.Settings.setRenderDistance(4); return 1; });
  await sleep(1200);
  const outside = await page.evaluate(() => {
    const G = MCL.Gfx, P = MCL.Player;
    const camCx = Math.floor(P.x) >> 4, camCz = Math.floor(P.z) >> 4;
    const r = Math.max(1, MCL.Settings.renderDistance);
    let n = 0;
    G.meshes.forEach((m) => {
      if (Math.abs(m.cx - camCx) > r || Math.abs(m.cz - camCz) > r) n++;
    });
    return n;
  });
  ok(wide > 40, `only ${wide} section meshes at the wide render distance — nothing to leave behind`);
  ok(outside > 0,
     `no mesh ended up outside the flood grid, so this section tests nothing (${wide} meshes, rd pulled to 4)`);

  // ⚠ ASK THE PREDICATE, NOT THE PICTURE. A whole-frame flood-on/flood-off diff here also
  // catches something else: the section-connectivity flood is CONSERVATIVE, and at a canopy
  // corner it misses a one-pixel sliver of leaf that a diagonal sight line reaches (measured:
  // 506 pixels in thin bands along the tops of distant trees, recorded in NEXT as an open W12
  // limitation). That is a real and separate gap, and folding it into this assertion would mean
  // this section could never go green and D-171 would have no guard at all. So this asks the
  // exact question D-171 is about, of the exact sections it is about.
  const verdict = await page.evaluate(() => {
    const G = MCL.Gfx, P = MCL.Player;
    const camCx = Math.floor(P.x) >> 4, camCz = Math.floor(P.z) >> 4;
    const r = Math.max(1, MCL.Settings.renderDistance);
    let asked = 0, hidden = 0, first = null;
    G.meshes.forEach((m) => {
      if (Math.abs(m.cx - camCx) <= r && Math.abs(m.cz - camCz) <= r) return;
      asked++;
      if (!G.floodHas(camCx, camCz, m.cx, m.cz, m.sy)) {
        hidden++;
        if (!first) first = m.cx + ',' + m.cz + '/' + m.sy;
      }
    });
    return JSON.stringify({ asked: asked, hidden: hidden, first: first });
  });
  const v = JSON.parse(verdict);
  ok(v.asked > 10, `only ${v.asked} meshes outside the flood grid were asked about`);
  ok(v.hidden === 0,
     `${v.hidden} of ${v.asked} meshes outside the flood grid are reported OCCLUDED (first ${v.first}) — a culling test may only say no when it is certain (D-171)`);
  // and the same question inside the grid must still be answerable BOTH ways, or `floodHas` has
  // simply become "return true" and this section is asserting nothing
  const inside = await page.evaluate(() => {
    const G = MCL.Gfx, P = MCL.Player;
    const camCx = Math.floor(P.x) >> 4, camCz = Math.floor(P.z) >> 4;
    const r = Math.max(1, MCL.Settings.renderDistance);
    let yes = 0, no = 0;
    G.meshes.forEach((m) => {
      if (Math.abs(m.cx - camCx) > r || Math.abs(m.cz - camCz) > r) return;
      if (G.floodHas(camCx, camCz, m.cx, m.cz, m.sy)) yes++; else no++;
    });
    return JSON.stringify({ yes: yes, no: no });
  });
  const ins = JSON.parse(inside);
  ok(ins.no > 0, `inside the grid the flood hides nothing at all (${ins.yes} visible, ${ins.no} hidden) — floodHas has become "return true"`);
  ok(ins.yes > 0, `inside the grid the flood hides everything (${ins.yes} visible, ${ins.no} hidden)`);
  if (PRINT) console.log(`   ${wide} meshes at rd 10 · ${v.asked} outside the grid, ${v.hidden} called occluded · inside: ${ins.yes} visible / ${ins.no} hidden`);
  await page.evaluate('MCL.Settings.setRenderDistance(10); MCL.World.evictMargin = ' + margin + ';');
  await quiet(40000);
}

// ─────────────────────────────────── 2d. in the NEAR FIELD the two pictures are identical
console.log('2d. at a short render distance the flood hides nothing at all (D-173)');
{
  // ⚠ THE SHARP HALF OF §2. The residual difference §2 pins is entirely at the horizon, where a
  // section subtends a couple of pixels and a diagonal sight line clips a corner the graph cannot
  // express. Pull the render distance in and every section on screen is near and large — and then
  // the claim really is IDENTICAL, with no fence at all. A culling bug that hides something a
  // player can walk up to fails here, which is the failure that matters.
  const saveRd = await page.evaluate(() => {
    const r = MCL.Settings.renderDistance;
    MCL.Settings.adaptive = false; MCL.Settings.setRenderDistance(4);
    return r;
  });
  await quiet(45000);
  await sleep(3000);
  const nBefore = await control(1500);
  const a = await shot();
  await page.evaluate(() => { MCL.Gfx.occlusion = false; return 1; });
  await sleep(1500);
  const b = await shot();
  await page.evaluate(() => { MCL.Gfx.occlusion = true; return 1; });
  await sleep(1200);
  const nAfter = await control(1500);
  const floor = Math.max(nBefore.pixels, nAfter.pixels);
  const near = compare(a, b);
  const drawn = await page.evaluate(() => MCL.Gfx.drawn);
  ok(drawn > 5, `only ${drawn} sections drawn at rd 4 — the near-field comparison has no world in it`);
  // #10728: a 2 px diff on CI against a floor of 0 is GPU/animation jitter; a flood bug hides whole sections (thousands of px).
  const nearSlack = Math.max(floor, Math.ceil(near.total * 0.0001));
  ok(near.pixels <= nearSlack,
     `${near.pixels} pixels differ in the NEAR FIELD with the flood on and off (noise floor ${floor}) — the flood is hiding something you can walk up to`);
  if (PRINT) console.log(`   rd 4, ${drawn} sections drawn · ${near.pixels} pixels differ (floor ${floor})`);
  await page.evaluate('MCL.Settings.setRenderDistance(' + saveRd + ')');
  await quiet(45000);
}

// ─────────────────────────────────────────────── 2b. underground, where it pays
console.log('2b. underground — the same picture, and now far fewer sections');
{
  // The surface is the WORST case for an occlusion flood and the best case for the picture test.
  // This is the other half: put the camera under the terrain, where almost every section is
  // behind stone, and the flood should be culling nearly everything the frustum would draw.
  // ⚠ STAND IN A CAVE, NOT IN THE ROCK. Dropping the camera a fixed distance below the surface
  // usually buries it inside a solid block, where the mesher correctly emits no interior faces
  // and the frame is the clear colour — a comparison of two pictures of nothing. This walks
  // down the player's own column for a real air pocket with stone over it, which is the case
  // the occlusion flood exists for.
  // ⚠ AND IT SEARCHES A NEIGHBOURHOOD, NOT ONE COLUMN (D-228). The first version walked the
  // player's OWN column only, which made the whole section a hostage to where spawn happens to
  // be: when D-226 lowered the world by two and a half blocks the spawn column stopped having a
  // cave under it and this check failed, reporting the renderer for a change in the terrain.
  // That is D-148's lesson — *a test that runs at the origin tests the origin* — inside a check
  // whose subject has nothing to do with position. It now spirals outward over the loaded
  // columns and takes the first real air pocket with a roof over it, and it still FAILS if there
  // is no cave anywhere near, which is the honest form of the assertion.
  const found = await page.evaluate(() => {
    const px = Math.floor(MCL.Player.x), pz = Math.floor(MCL.Player.z);
    const probe = (x, z) => {
      const top = MCL.Column.height(x, z);
      for (let y = top - 8; y > -60; y--) {
        const a = MCL.World.getBlock(x, y, z), b = MCL.World.getBlock(x, y + 1, z);
        const roof = MCL.World.getBlock(x, y + 3, z);
        if (a === 0 && b === 0 && roof !== 0) return y;
      }
      return null;
    };
    for (let r = 0; r <= 24; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;   // the ring at radius r
          const y = probe(px + dx, pz + dz);
          if (y === null) continue;
          MCL.Player.x = px + dx + 0.5; MCL.Player.z = pz + dz + 0.5;
          MCL.Player.y = y + 0.2; MCL.Player.vy = 0; MCL.Player.pitch = 0.0;
          return y;
        }
      }
    }
    return null;
  });
  ok(found !== null,
     'no cave was found under any column within 24 blocks of the player — section 2b tested nothing');
  await sleep(4000);
  await quiet(45000);
  const deepBefore = await control(1500);
  const deepOn = await shot();
  const dOn = await stats();
  await page.evaluate(() => { MCL.Gfx.occlusion = false; return 1; });
  await sleep(1500);
  const deepOff = await shot();
  const dOff = await stats();
  await page.evaluate(() => { MCL.Gfx.occlusion = true; return 1; });
  await sleep(1200);

  const deepAfter = await control(1500);
  const noise = { pixels: Math.max(deepBefore.pixels, deepAfter.pixels) };
  const cmp = compare(deepOn, deepOff);
  ok(cmp.pixels <= Math.max(noise.pixels, 0),
     `underground, ${cmp.pixels} pixels differ between the flood and the frustum against a noise floor of ${noise.pixels} — the flood is hiding something visible`);
  ok(dOff.drawn > 0, 'the frustum-only pass drew nothing underground — there is no comparison to make');
  // ⚠ WHAT THE FLOOD ACTUALLY DOES UNDERGROUND, measured rather than assumed: buried in stone it
  // reaches nothing beyond the 27-section seed around the camera, which is the whole point — the
  // frustum test would happily draw every section in front of the camera through solid rock.
  // At the render distance the headless machine picks (the Celeron preset, rd 4) the two numbers
  // land close together because there are barely more than 27 sections in range at all; the
  // saving is a render-distance story, and `bench.mjs` on real hardware is where it is told.
  ok(dOn.drawn <= dOff.drawn + 27,
     `underground the flood drew ${dOn.drawn} against the frustum's ${dOff.drawn} — more than the seed explains`);
  ok(dOn.occluded > 0, 'underground the flood culled nothing at all');
  if (PRINT) console.log(`   in a cave at y=${found}: ${dOn.drawn} drawn vs ${dOff.drawn} frustum-only · ${dOn.occluded} culled by the flood`);

  // back to the surface for the rest of the file
  await page.send('Runtime.evaluate', { expression:
    'MCL.Player.y = MCL.Column.height(Math.floor(MCL.Player.x), Math.floor(MCL.Player.z)) + 6;' +
    'MCL.Player.vy = 0; MCL.Player.pitch = -0.15;' });
  await sleep(4000);
}

// ─────────────────────────── 2e. a render-distance change must not collapse the draw list
console.log('2e. moving the render distance does not empty the screen (D-175)');
{
  // ⚠ THIS IS THE WHITE FLASH, and it is a draw-count test rather than a picture test because
  // the mechanism is countable. The clear colour is the SKY, so a frame that draws little is a
  // frame that is mostly pale blue. D-46's adaptive system moves the render distance by one
  // chunk every couple of seconds — most often while chunks are arriving, which is exactly when
  // Dan reported the flashes — and D-171 meant every mesh outside the new, smaller grid was
  // reported OCCLUDED on the very next frame. Measured across a render-distance sweep on the
  // build before the fix: the draw list fell by up to **60%** in a single frame, three times
  // over 50%. After: 44% worst, none over 50%, and 44% is the honest consequence of drawing a
  // smaller world.
  const saveRd = await page.evaluate(() => {
    const r = MCL.Settings.renderDistance;
    MCL.Settings.adaptive = false;
    return r;
  });
  await page.evaluate(() => { MCL.Settings.setRenderDistance(10); return 1; });
  await quiet(60000);
  await sleep(3000);

  // ⚠ MEASURED AGAINST THE ELIGIBLE WORLD, NOT AGAINST THE FRAME BEFORE (D-234). Comparing
  // `drawn` to the previous `drawn` cannot tell "the culler ate the world" from "the world is
  // legitimately smaller now", and at the CELERON preset it never had to: the render distance is
  // already 4 there, so every step of this sweep was a no-op and the assertion was measuring
  // nothing. At medium the sweep is real, and a 5 -> 4 step honestly removes half the visible
  // wedge — which read as a 51% collapse and failed. D-194 settled the right measure for exactly
  // this shape: score the frame against the world that was ELIGIBLE to be drawn. `frac` is
  // `drawn / eligible`, eligible being the section meshes inside the CURRENT render distance, and
  // what §2e forbids is that fraction falling — the culler rejecting a larger share of a world it
  // can still see. The world getting smaller moves both numbers together and cancels.
  const frac = () => page.evaluate(() => {
    const rd = MCL.Settings.renderDistance, r2 = (rd * 16) * (rd * 16);
    const px = MCL.Player.x, pz = MCL.Player.z;
    // a mesh record carries its section's chunk coordinates (10_gfx.js: {cx, cz, sy, ...})
    let eligible = 0;
    MCL.Gfx.meshes.forEach((m) => {
      const dx = (m.cx * 16 + 8) - px, dz = (m.cz * 16 + 8) - pz;
      if (dx * dx + dz * dz <= r2) eligible++;
    });
    return { drawn: MCL.Gfx.drawn, eligible };
  });
  let worst = 0, worstAt = null, sampled = 0, skipped = 0;
  // ⚠⚠ **THE MESH SET MUST BE SETTLED BEFORE EITHER MEASUREMENT, AND `sleep(300)` DOES NOT
  // SETTLE IT.** `eligible` counts the section meshes that EXIST inside the current radius, and
  // after a render-distance change that set is still being built and pruned for seconds. The
  // sampled failure was `rd -> 5: 787/404 drawn -> 610/629` — a SMALLER radius reporting MORE
  // eligible sections than the larger one before it, which is arithmetically impossible for a
  // settled world and is simply the streamer still catching up. The ratio then collapsed from
  // 1.95 to 0.97 and the check reported a 50% flash in a build that never flashed.
  //
  // ⚠ The rule this file already knows and did not apply here: wait for the STATE, never for a
  // number of milliseconds. `quiet()` is the same helper §2's teleports use.
  for (const rd of [9, 8, 7, 6, 5, 4, 5, 6, 7, 8, 9, 10]) {
    await quiet(20000);
    const before = await frac();
    await page.evaluate('MCL.Settings.setRenderDistance(' + rd + ')');
    await quiet(20000);
    await sleep(300);
    const after = await frac();
    // a settled pair can never have the smaller radius holding more eligible sections; if it
    // does, the streamer is still moving and this sample is noise rather than evidence
    if (after.eligible > before.eligible * 1.5 && rd < 10) { skipped++; continue; }
    if (before.drawn > 8 && before.eligible > 8 && after.eligible > 8) {
      sampled++;
      const f0 = before.drawn / before.eligible, f1 = after.drawn / after.eligible;
      const drop = 1 - f1 / f0;
      if (drop > worst) {
        worst = drop;
        worstAt = `rd -> ${rd}: ${before.drawn}/${before.eligible} drawn -> ${after.drawn}/${after.eligible}`;
      }
    }
  }
  ok(sampled >= 8, `only ${sampled} render-distance changes were measured (${skipped} skipped as unsettled)`);
  // ⚠ 50% is not a tolerance around a bug: shrinking the render distance really does draw less,
  // and 10 -> 4 is a legitimate halving. What it forbids is the SCREEN EMPTYING — the draw list
  // falling further than the world it is drawing. The pre-fix build broke it three times.
  ok(worst < 0.5,
     `the drawn SHARE of the eligible world fell ${(worst * 100).toFixed(0)}% in one frame when the ` +
     `render distance moved (${worstAt}) — that is the flash (D-175, measured D-194's way since D-234)`);
  if (PRINT) console.log(`   ${sampled} render-distance changes · worst single-frame drop ${(worst * 100).toFixed(0)}%`);
  await page.evaluate('MCL.Settings.setRenderDistance(' + saveRd + ')');
  await quiet(45000);
}

// ─────────────────────────────────────────────── 3. the frustum agrees
console.log('3. the frustum and the flood agree about what is behind you');
{
  // Turn 180° and back. Everything the flood hid from the new heading must be hidden by one of
  // the two rules, and the frame must be stable: a section that pops in a frame after the turn
  // is a section the flood decided about with a stale mask.
  // ⚠ BOTH SHOTS MUST BE OF A SETTLED WORLD (D-743: "two consecutive frames of a settled world
  // agree"), not just the first one — 3,200 ms of yaw flips is not itself a guarantee the
  // streamer stayed idle, and a mesh job landing during the turn is a world that changed for a
  // reason that has nothing to do with the camera.
  await mustSettle(90000, 'before the turn');
  const before = await shot();
  await page.evaluate(() => { MCL.Player.yaw += Math.PI; return 1; });
  await sleep(1600);
  await page.evaluate(() => { MCL.Player.yaw -= Math.PI; return 1; });
  await sleep(1600);
  await mustSettle(90000, 'after turning back');
  const after = await shot();
  const noise = await control(1600);
  const cmp = compare(before, after);
  // 3.2 s apart vs the control's 1.6 s, so the control under-reads (#10494: 410 vs 264 locally, 35670 vs 34084 on CI): 2x.
  // #10589: a control that reads 0 against 50327 sub-1/255 px (mean 0.017%) is the world's own drift, not a cull change: a section that pops moves the MEAN by far more than 0.05%.
  ok(cmp.pixels <= Math.max(noise.pixels * 2, 64) || cmp.diff < 0.0005,
     `turning around and back changed ${cmp.pixels} pixels (mean ${(cmp.diff * 100).toFixed(3)}%) against a noise floor of ${noise.pixels} — the cull state is not a function of the camera`);
  if (PRINT) console.log(`   180° and back: ${cmp.pixels} pixels differ (${(cmp.diff * 100).toFixed(3)}%)`);
}

// ─────────────────────────────────────────────── 4. batching
console.log('4. batching — draw calls and buffer binds per section drawn');
{
  const s = await stats();
  const perSection = s.draws / Math.max(1, s.drawn);
  const bindsPer = s.binds / Math.max(1, s.draws);
  // ⚠ A FENCE, not a target (D-143). A section can legitimately cost more than one draw — it has
  // a solid layer, a cutout layer and a translucent layer — but three-plus draws for every
  // section drawn means the layers are not being batched at all.
  ok(perSection < 3, `${perSection.toFixed(2)} draw calls per section drawn — the fence is 3`);
  ok(bindsPer <= 1.01, `${bindsPer.toFixed(2)} buffer binds per draw call — the fence is 1, which means one bind per arena`);
  ok(s.tris > 5000, `${s.tris} triangles drawn — too little geometry to judge batching`);
  if (PRINT) console.log(`   ${perSection.toFixed(2)} draws/section · ${bindsPer.toFixed(2)} binds/draw · ${s.tris.toLocaleString()} triangles`);
}

// ─────────────────────────────────────────────── 4b. a light you place is a light you see
console.log('4b. placing a glowstone changes the picture (D-150, end to end)');
{
  // ⚠ THE END-TO-END VERSION OF D-150. `lightcheck` proves the engine's rules and `soakcheck`
  // proves an edit lights its neighbours a million blocks out — both by reading light BYTES.
  // Neither would notice if the light never reached the mesh, the vertex or the screen. This
  // one asks the only question a player asks: put a light down, does it get brighter?
  const camInfo = await page.evaluate(() => {
    const P = MCL.Player;
    const x = Math.floor(P.x), z = Math.floor(P.z);
    const top = MCL.Column.height(x, z);
    // stand in a hollow of our own making, six blocks under the surface, looking at a wall
    const y = top - 6;
    for (let dy = 0; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        for (let dz = -3; dz <= 3; dz++) MCL.World.setBlock(x + dx, y + dy, z + dz, 0);
      }
    }
    MCL.Light.settle(400);
    P.x = x + 0.5; P.y = y + 0.2; P.z = z + 0.5; P.vy = 0; P.pitch = 0; P.yaw = 0;
    return { x, y, z };
  });
  await quiet(30000);
  await sleep(2500);
  const noise = await control(1500);
  const dark = await shot();
  const darkLuma = meanLuma(dark, Math.round(dark.width * 0.3), Math.round(dark.height * 0.3), Math.round(dark.width * 0.4), Math.round(dark.height * 0.5));

  await page.send('Runtime.evaluate', { expression:
    `MCL.World.setBlock(${camInfo.x}, ${camInfo.y} + 1, ${camInfo.z} + 2, MCL.States.stateOf('glowstone'));` +
    'MCL.Light.settle(400);' });
  await quiet(30000);
  await sleep(2500);
  const lit = await shot();
  const litLuma = meanLuma(lit, Math.round(lit.width * 0.3), Math.round(lit.height * 0.3), Math.round(lit.width * 0.4), Math.round(lit.height * 0.5));

  const cmp = compare(dark, lit);
  // #10728: the pixel-count-over-noise test failed when cloud/animation noise (~98k px) swamped the real change; the luma asserts below
  // are noise-robust (a centre-crop MEAN), so the pixel count only has to show something changed.
  ok(cmp.pixels > 1000,
     `placing a glowstone changed ${cmp.pixels} pixels against a noise floor of ${noise.pixels} — the light never reached the screen`);
  ok(litLuma > darkLuma, `the frame got DARKER when a glowstone was placed: ${darkLuma.toFixed(3)} -> ${litLuma.toFixed(3)}`);
  ok(litLuma - darkLuma > 0.01, `the glowstone changed the centre-crop mean luma by only ${(litLuma - darkLuma).toFixed(4)}`);
  if (PRINT) console.log(`   luma ${darkLuma.toFixed(3)} -> ${litLuma.toFixed(3)} · ${cmp.pixels} pixels changed (noise ${noise.pixels})`);
}

// ─────────────────────────────────────────────── 5. anti-vacuity
console.log('5. anti-vacuity — prove the comparison can see a change');
{
  const av = [];
  const check = async (label, fn) => { let caught = false; try { await fn(); } catch { caught = true; } av.push([label, caught]); };

  await check('two screenshots of a changed scene compared as identical', async () => {
    const a = await shot();
    await page.evaluate(() => { MCL.Player.yaw += 0.35; return 1; });
    await sleep(900);
    const b = await shot();
    await page.evaluate(() => { MCL.Player.yaw -= 0.35; return 1; });
    await sleep(900);
    const cmp = compare(a, b);
    if (!cmp.same && cmp.pixels > 1000) throw 0;         // it CAN see a change, as it must
  });

  await check('a comparison that ignores a solid-colour frame', async () => {
    const a = await shot();
    const fake = { width: a.width, height: a.height, data: new Uint8Array(a.data.length) };
    const cmp = compare(a, fake);
    if (cmp.pixels > a.width * a.height * 0.5) throw 0;
  });

  // ⚠ §2f's WHOLE POINT is that removing the sky pass makes the two pictures identical. That is
  // only worth having if removing the sky pass is something this page can actually do and the
  // comparison can see — so: take the sky away and show the SAME frame changes by thousands of
  // pixels. Without this, a `drawSky` stub that silently failed to install would make §2f pass
  // by drawing the same sky twice (D-305, D-30).
  await check('a sky pass that never came off, so §2f compared two identical skies', async () => {
    if (SKY_DELTA.pixels > 2000) throw 0;               // the sky really does leave the picture
  });

  for (const [label, caught] of av) {
    ok(caught, `ANTI-VACUITY FAILURE: "${label}" was not caught — this check proves nothing`);
    console.log(`   ${caught ? '✓' : '✗'} ${label}`);
  }
}

clearTimeout(watchdog);
await page.close();

console.log('');
console.log('================ cullcheck ===============');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log('==========================================');
process.exit(fails.length ? 1 : 0);
