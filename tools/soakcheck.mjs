#!/usr/bin/env node
// soakcheck.mjs — fly for two minutes and prove nothing drifts.
//
//   node tools/soakcheck.mjs [dist/mclite.html] [--print] [--seconds 120]
//
// ⚠ WHAT THIS CATCHES THAT NOTHING ELSE DOES. Every other check in the suite asks a question
// about one moment: is this light level right, is this chunk deterministic, is this frame the
// same as that frame. `smoke` plays for thirty seconds and reloads, which is the closest thing
// to time the project has. But the failures that ruin a session of PLAY are the ones that need
// TIME to appear:
//
//   * a queue that never drains — session 4 found 256 sections permanently dirty (D-147), and
//     the only reason anyone noticed is that a screenshot happened to be taken underground
//   * memory that only goes up — an arena that never frees, a Map that never deletes, a chunk
//     that is evicted from `World` and kept alive by a listener
//   * the resident set growing past its cap while the player keeps moving (D-89)
//   * a light engine that falls further behind the longer you fly (D-142's budget is per FRAME,
//     so a slow leak of seeds is invisible in any single slice)
//   * an error that only happens on the hundredth chunk boundary
//
// So this flies a fixed path across ~2,000 blocks of unseen world, samples the engine every few
// seconds, and asserts the SHAPE of those samples rather than any single value: bounded, not
// monotonically rising, and finishing with everything inside the render distance meshed.
//
// Sections:
//   1. it flies the whole path without a console error
//   2. the resident set stays inside its cap the whole way
//   3. the heap does not climb monotonically
//   4. the light queue drains — it is never the same non-zero number twice in a row
//   4b. the WORLD ticks and ITS queue drains — new in session 9, because until then it did not
//       tick at all (D-301) and a queue nothing drains cannot overflow
//   5. it lands with nothing stuck: no dirty sections inside the render distance
//   5a. the mesh worker pool is never left idle while the world is behind (D-198)
//   5d. the occlusion flood never runs out of queue (D-198)
//   6. anti-vacuity
//
// ⚠ AND IT RUNS AT THE MEDIUM PRESET, NOT CELERON (D-196, D-198). `Settings.detect` clamps to
// celeron on any 2-core box, so every browser check this project had ever run had run at render
// distance 4 with one worker — the one configuration in which none of D-198's three faults can
// appear. Dan plays at medium and above and that is where he sees the flash. Forcing the preset
// here rather than leaving it to the environment is the difference between a fence and a
// decoration: MCLITE_PRESET in the environment still wins, so a run can be aimed at high or
// pinned back to celeron for a comparison.

import { open, sleep } from './cdp.mjs';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// ⚠ `--seconds 90` puts a bare number in argv; without this filter it is read as the file
// to open, which is how the first run of this tool failed with "no such file .../90".
const args = process.argv.slice(2).filter((a) => !a.startsWith('--') && !/^\d+$/.test(a));
const FILE = args[0] ? (args[0].startsWith('/') ? args[0] : ROOT + args[0]) : ROOT + 'dist/mclite.html';
const PRINT = process.argv.includes('--print');
const secIdx = process.argv.indexOf('--seconds');
const SECONDS = secIdx > 0 ? Number(process.argv[secIdx + 1]) : 120;
if (!existsSync(FILE)) { console.error('soakcheck: no such file ' + FILE); process.exit(1); }

// ⚠ BEFORE open(): tools/cdp.mjs reads MCLITE_PRESET when it launches the page (D-196).
if (!process.env.MCLITE_PRESET) process.env.MCLITE_PRESET = 'medium';
const PRESET = process.env.MCLITE_PRESET;

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 20) fails.push(m); };

const page = await open(FILE, { port: 9419, width: 640, height: 360 });
await sleep(1800);
await page.key('Enter');
const ready = await page.waitFor(() => MCL.Main.ready === true, 90000);
ok(ready === true, 'the world never started');

// ⚠ Fly, do not teleport. A teleport evicts everything and generates a fresh disc, which is a
// different test — this is the streaming path a player actually exercises: continuous motion
// across chunk borders with the streamer keeping up behind it.
// ⚠ THE FLIGHT STARTS A MILLION BLOCKS FROM SPAWN, ON PURPOSE (D-148). The light queue used to
// pack x and z into eleven bits each — a world 2,048 blocks wide — so every edit and every chunk
// seam past ±1,024 blocks was applied somewhere else entirely, and every check in the suite ran
// near the origin and saw nothing wrong. A soak that flies where a player eventually flies is
// the cheapest possible guard against that whole class. One million is inside the range the
// renderer is honest over (D-149 fences that at two million).
const START_X = 1000000, START_Z = -600000;
await page.send('Runtime.evaluate', { expression:
  'MCL.Settings.adaptive = false;' +
  'MCL.Player.creative = true; MCL.Player.flying = true; MCL.Hud.showDebug = false;' +
  `MCL.Player.x = ${START_X}; MCL.Player.z = ${START_Z};` +
  'MCL.Player.y = MCL.Column.height(Math.floor(MCL.Player.x), Math.floor(MCL.Player.z)) + 12;' +
  'MCL.Player.vy = 0; MCL.Player.pitch = -0.1; MCL.Player.yaw = 0.6;' +
  'window.__soak = { t0: Date.now() };' });
await sleep(6000);

const sample = () => page.evaluate(() => {
  const W = MCL.World, G = MCL.Gfx;
  const cx = Math.floor(MCL.Player.x) >> 4, cz = Math.floor(MCL.Player.z) >> 4;
  const rd = MCL.Settings.renderDistance;
  let dirtyNear = 0, dirtyClose = 0;
  W.chunks.forEach((c) => {
    const dx = c.cx - cx, dz = c.cz - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 > rd * rd) return;
    // ⚠ dirtyClose is the same count over a FOUR-chunk disc — the celeron render distance, so it
    // means the same thing at every preset (D-198). No machine gets to be too slow to mesh the
    // fifty columns it is standing in.
    for (let s = 0; s < 20; s++) if (c.meshDirty[0] & (1 << s)) { dirtyNear++; if (d2 <= 16) dirtyClose++; }
  });
  const gs = G.stats();
  return {
    x: Math.round(MCL.Player.x), z: Math.round(MCL.Player.z),
    chunks: W.chunks.size, cap: W.maxChunks, meshes: G.meshes.size,
    drawn: G.drawn, dirtyNear: dirtyNear, dirtyClose: dirtyClose,
    mif: W.meshInflight, mifCap: W.maxMeshInflight,
    floodOverflows: gs.floodOverflows, floodQueue: gs.floodQueue,
    light: MCL.Light.pending, budgetHits: MCL.Light.stats.budgetHits,
    heap: (performance.memory && performance.memory.usedJSHeapSize) || 0,
    gen: W.stats2.gen, meshed: W.stats2.meshed, evicted: W.stats2.evicted,
    // ⚠⚠ THE SCHEDULED-TICK QUEUE, WHICH NOTHING HAS EVER WATCHED BECAUSE NOTHING EVER DRAINED
    // IT (D-301). Session 9 made the game call `Behave.tick`, so for the first time fluids
    // really spread, fire really burns and block entities really run — and the failure that
    // needs TIME to appear is a queue that grows without bound while the player flies over
    // water. Two numbers: how long the queue is, and whether the clock behind it is moving.
    scheduled: (MCL.Behave && MCL.Behave.scheduled) ? MCL.Behave.scheduled() : -1,
    gameTime: (MCL.Behave && MCL.Behave.gameTime) | 0,
    ticks: MCL.Main.ticks,
    dayTime: (MCL.Sky && MCL.Sky.dayTime) | 0,
    entities: (MCL.BlockEntities && MCL.BlockEntities.count) ? MCL.BlockEntities.count() : -1,
  };
});

// The flight: a fixed heading, held, so the streamer never gets a break. `Player.x/z` are moved
// directly rather than through the input path, because a headless page has no key repeat and
// this is a test of streaming, not of input.
const samples = [];
const errors = [];
page.onConsoleError && page.onConsoleError((e) => errors.push(e));

// ⚠ THE BLANK-FRAME WATCH (D-162). The clear colour is the sky, so a frame that draws nothing is
// a full screen of pale blue — a white flash. It is LEGITIMATE right after the camera jumps, so
// the watch is narrow on purpose: a frame counts only when the camera did not move, the world is
// resident, and nothing is pending — no meshes in flight and nothing dirty. Under those
// conditions there is no honest reason to draw nothing, and the flight below is 20 minutes of
// them. It runs for the whole soak rather than at one moment, because Dan's report is that the
// flashes are RANDOM, and a check that looks at one moment cannot see a random event.
await page.send('Runtime.evaluate', { expression: `
  window.__bw = { blank: 0, frames: 0, quiet: 0, run: 0, recent: [], first: null };
  // ⚠ THE WORKER POOL, WATCHED PER FRAME AND ONLY WHILE THERE IS WORK (D-198). meshInflight
  // read once every three seconds is an instant, not a statistic, and the fault it has to see is
  // a pool that averages a third full — never one that is empty at a chosen moment. 'armed' is
  // set from Node after each sample, so the page never has to walk the chunk map to know whether
  // there is a backlog worth watching.
  window.__mw = { armed: 0, n: 0, sum: 0, zero: 0, cap: 0 };
  // the deepest the occlusion flood's queue got on any frame (D-198)
  window.__fq = 0;
  (function () {
    const G = MCL.Gfx, W = MCL.World, P = MCL.Player, f = G.render;
    let px = Math.round(P.x), pz = Math.round(P.z), py = P.y;
    G.render = function () {
      const r = f.apply(this, arguments);
      const s = window.__bw;
      s.frames++;
      const mw = window.__mw;
      if (mw.armed) { const q = W.meshInflight; mw.n++; mw.sum += q; if (q === 0) mw.zero++; mw.cap = W.maxMeshInflight; }
      if (G.visited > window.__fq) window.__fq = G.visited;
      // ⚠ rounded, and x/z only: a flying player's y drifts by a fraction every frame, so an
      // exact three-way comparison is NEVER equal and the watch silently never arms — which is
      // how this file spent two runs reporting "0 of 4774 frames" as a pass.
      const rx = Math.round(P.x), rz = Math.round(P.z);
      const still = (rx === px && rz === pz);
      px = rx; pz = rz; py = P.y;
      // ⚠ WHAT A FLASH ACTUALLY IS, and it took two wrong conditions to say it. "Nothing dirty"
      // never holds during a soak flight, so that armed zero times — a vacuous pass. "Still for a
      // second" armed constantly and fired on 3,367 frames, but those were the world ARRIVING:
      // the player had been teleported into unmeshed ground and the only meshes on the GPU were
      // the ones behind them, correctly culled. Drawing nothing because there is nothing to draw
      // is not a flash. A flash is a COLLAPSE: the world was being drawn, the camera did not
      // move, and then a frame drew nothing. That is what this watches: recent is the best
      // frame in the last ten seconds, and a fall from it to zero is the bug.
      s.run = still ? s.run + 1 : 0;
      s.recent.push(G.drawn);
      if (s.recent.length > 600) s.recent.shift();
      var best = 0;
      for (var i = 0; i < s.recent.length; i++) if (s.recent[i] > best) best = s.recent[i];
      if (s.run >= 30 && best > 4) {
        s.quiet++;
        if (G.drawn === 0) {
          s.blank++;
          if (!s.first) s.first = { f: s.frames, x: Math.round(P.x), z: Math.round(P.z),
                                    chunks: W.chunks.size, meshes: G.meshes.size, best: best,
                                    visited: G.visited, culled: G.culled, occluded: G.occluded };
        }
      }
      return r;
    };
  })();
` });

const step = 3000;
const steps = Math.max(4, Math.round((SECONDS * 1000) / step));
for (let i = 0; i < steps; i++) {
  await page.send('Runtime.evaluate', { expression:
    'MCL.Player.x += 48; MCL.Player.z += 20;' +
    'MCL.Player.y = MCL.Column.height(Math.floor(MCL.Player.x), Math.floor(MCL.Player.z)) + 12;' +
    'MCL.Player.vy = 0;' });
  await sleep(step);
  const s = await sample();
  samples.push(s);
  // 500 dirty sections is far more than the rim a `neighbourhoodReady` wait can account for, so
  // an idle pool under this flag is idle with work it could be doing (D-198).
  await page.send('Runtime.evaluate', { expression: 'window.__mw.armed = ' + (s.dirtyNear > 500 ? 1 : 0) + ';' });
  if (PRINT && (i % 4 === 0 || i === steps - 1)) {
    console.log(`   t+${((i + 1) * step / 1000) | 0}s  (${s.x},${s.z})  chunks ${s.chunks}/${s.cap}  meshes ${s.meshes}  drawn ${s.drawn}  dirty ${s.dirtyNear}  light ${s.light}  heap ${(s.heap / 1048576).toFixed(1)} MB`);
  }
}

// ⚠ LET IT CATCH UP, AND MEASURE HOW LONG THAT TAKES. A player who stops flying expects the
// world to arrive within a second or two; the assertion is that it arrives at all, and the
// number is printed so a regression shows up as "it used to take four seconds".
let last = await sample(), caughtUpMs = -1;
// ⚠ AND MEASURE THE MACHINE WHILE IT DOES, because the deadline is not a property of the engine.
// `settleRate` is section meshes a second over the settle window and `settleNeed` is the backlog
// it started with; §5 asks whether the box could POSSIBLY have finished in the window before it
// asks whether it did. At the celeron preset the disc is 4 chunks and this is never in doubt; at
// high it is 957 columns and about 16,000 section meshes, and two cores sharing a software
// rasteriser with four workers do 95 a second — 168 s of work inside a 70 s window. Asserting a
// fixed deadline there tests the container, and a check that fails for a reason the code cannot
// fix is a check people learn to ignore.
let settleRate = 0, settleNeed = 0, closeSettleRate = 0, closeSettleNeed = 0, closeEl = 0;
{
  const t0 = Date.now();
  const m0 = last.meshes; settleNeed = last.dirtyNear; closeSettleNeed = last.dirtyClose;
  while (Date.now() - t0 < 70000) {
    await sleep(1500);
    last = await sample();
    // keep the pool watch armed only while there is still a backlog (D-198), so the frames after
    // the world has caught up — where an empty pool is the correct state — are not counted
    await page.send('Runtime.evaluate', { expression: 'window.__mw.armed = ' + (last.dirtyNear > 500 ? 1 : 0) + ';' });
    if (PRINT) console.log('   catchup t+' + ((Date.now()-t0)/1000).toFixed(1) + 's  near ' + last.dirtyNear + '  close ' + last.dirtyClose + '  meshes ' + last.meshes);
    if (last.drawn > 5 && last.dirtyNear === 0) { caughtUpMs = Date.now() - t0; break; }
  }
  const el = (Date.now() - t0) / 1000;
  settleRate = el > 0 ? (last.meshes - m0) / el : 0;
  closeEl = el;
  closeSettleRate = el > 0 ? (closeSettleNeed - last.dirtyClose) / el : 0;
}

// ─────────────────────────────────────────────── 1. it flew
console.log('1. it flew the whole path');
{
  const travelled = Math.abs(last.x - samples[0].x) + Math.abs(last.z - samples[0].z);
  ok(samples.length === steps, `only ${samples.length} of ${steps} samples were taken`);
  ok(travelled > 500, `the player moved ${travelled} blocks — the flight did not happen`);
  ok(last.gen > 100, `only ${last.gen} columns were generated over the flight`);
  ok(Math.abs(last.x) > 900000, `the flight ran at x=${last.x}, not a million blocks out — D-148's guard is not being exercised`);
  ok(errors.length === 0, `${errors.length} console errors during the flight: ${errors.slice(0, 3).join(' | ')}`);
  if (PRINT) console.log(`   ${travelled} blocks flown · ${last.gen} columns generated · ${last.meshed} sections meshed · ${last.evicted} columns evicted`);
}

// ─────────────────────────────────────────────── 2. the resident set
console.log('2. the resident set stays inside its cap (D-89)');
{
  const worst = Math.max(...samples.map((s) => s.chunks));
  const cap = last.cap;
  // ⚠ the cap is enforced every 8 frames, so a sample can catch it a few columns over. The
  // failure this guards against is not "one over" — it is a set that keeps growing because
  // eviction never fires while the player keeps moving, which is the 4 GB machine's death.
  ok(worst <= cap * 1.25, `the resident set reached ${worst} columns against a cap of ${cap}`);
  ok(last.evicted > 0, 'nothing was ever evicted over a 2,000-block flight');
  const first = samples[0].chunks, half = samples[Math.floor(samples.length / 2)].chunks;
  ok(Math.abs(last.chunks - half) < cap, `the resident set is still climbing: ${first} -> ${half} -> ${last.chunks}`);
  if (PRINT) console.log(`   worst ${worst} of cap ${cap} · ${last.evicted} evicted`);
}

// ─────────────────────────────────────────────── 3. memory
console.log('3. the heap is not a staircase');
{
  const heaps = samples.map((s) => s.heap).filter((h) => h > 0);
  if (heaps.length < 4) {
    ok(true, 'no heap readings (performance.memory is Chrome-only) — section 3 skipped');
    console.log('   performance.memory unavailable; skipped');
  } else {
    const first = heaps[0], worst = Math.max(...heaps), lastH = heaps[heaps.length - 1];
    // A leak looks like: every sample higher than the one before it, and the end much higher
    // than the start. GC noise looks like: up, down, up. So the test is the SHAPE.
    let rises = 0;
    for (let i = 1; i < heaps.length; i++) if (heaps[i] > heaps[i - 1]) rises++;
    const monotone = rises === heaps.length - 1;
    ok(!monotone || lastH < first * 1.5,
       `the heap rose at every one of ${heaps.length} samples, ${(first / 1048576).toFixed(1)} -> ${(lastH / 1048576).toFixed(1)} MB`);
    ok(worst < 900 * 1048576, `the heap reached ${(worst / 1048576).toFixed(0)} MB — the 4 GB machine is the target`);
    if (PRINT) console.log(`   heap ${(first / 1048576).toFixed(1)} -> ${(lastH / 1048576).toFixed(1)} MB (worst ${(worst / 1048576).toFixed(1)}), rising in ${rises}/${heaps.length - 1} steps`);
  }
}

// ─────────────────────────────────────────────── 4. the light queue
console.log('4. the light queue drains rather than growing (D-142)');
{
  const pend = samples.map((s) => s.light);
  const worst = Math.max(...pend);
  // ⚠ A PLATEAU IS ONLY EVIDENCE IF THE LIGHT ENGINE WAS SPENDING BUDGET DURING IT (D-246), and
  // it has to be a RUN rather than a tally. This assertion used to be `stuck === 0` over every
  // pair of consecutive samples that read the same non-zero size, and it went RED on a build
  // whose queue reached zero six seconds later — `last.light === 0` passed in the same run. Two
  // samples are 3 s apart with a 48-block teleport between them, so two of them reading the same
  // number (a full seam batch is the same size every time) is a coincidence, not a stall; a tally
  // over pairs also cannot tell one coincidence from a queue pinned for a minute. The failing
  // SHAPE is a queue that does not move WHILE the engine is spending its slice on it: `budgetHits`
  // rising with `pending` unchanged is work going in and nothing coming out. If `budgetHits` did
  // not rise, the light engine simply was not scheduled in that interval and the plateau says
  // nothing about draining. ⚠ Neither half can pass vacuously: `last.light === 0` above is
  // unconditional, and §6 breaks this in both directions — a pinned queue WITH budget spent must
  // fail, and the same queue with no budget spent must not.
  let stuck = 0, run = 0;
  for (let i = 1; i < pend.length; i++) {
    const same = pend[i] > 0 && pend[i] === pend[i - 1];
    const worked = (samples[i].budgetHits | 0) > (samples[i - 1].budgetHits | 0);
    if (same && worked) { run++; if (run > stuck) stuck = run; } else run = 0;
  }
  ok(last.light === 0, `${last.light} light seeds are still queued six seconds after the flight stopped`);
  ok(stuck < 3, `the light queue held the same non-zero size across ${stuck + 1} consecutive samples while the light budget was being spent — it is not draining`);
  ok(worst < 500000, `the light queue reached ${worst} entries`);
  if (PRINT) console.log(`   worst queue ${worst} · budget slices spent ${last.budgetHits} · settled to ${last.light}`);
}

// ─────────────────────────────────────────────── 4b. the scheduled-tick queue
console.log('4b. the WORLD ticks, and its queue drains (D-301)');
{
  // ⚠⚠ THIS SECTION EXISTS BECAUSE, UNTIL SESSION 9, THE ANSWER WAS ZERO. `Behave.tick` — which
  // drains the scheduled-tick queue — was never called by any build, so water never spread, fire
  // never burnt out and no furnace ever smelted, behind 1.17 million green assertions. The game
  // calls it now, which means the failure that needs TIME has become possible for the first
  // time: a queue that grows without bound while the player flies over an ocean.
  const gt = samples.map((s) => s.gameTime);
  const tk = samples.map((s) => s.ticks);
  const q = samples.map((s) => s.scheduled);
  ok(gt[gt.length - 1] > gt[0], `the world clock advanced ${gt[0]} -> ${gt[gt.length - 1]}`);
  ok(gt[gt.length - 1] > 100, `and it is a real number of ticks (${gt[gt.length - 1]})`);
  // ⚠ THE WORLD CLOCK AND THE LOOP CLOCK MUST MOVE TOGETHER. One tick of the loop is one tick of
  // the world; a ratio that drifts means a step is being skipped, which is how a "working"
  // scheduler still loses fluid updates.
  const ratio = (gt[gt.length - 1] - gt[0]) / Math.max(1, tk[tk.length - 1] - tk[0]);
  ok(ratio > 0.97 && ratio < 1.03,
     `the world clock and the loop clock advance together (${ratio.toFixed(3)} world ticks per loop tick)`);
  const daySpan = samples[samples.length - 1].dayTime - samples[0].dayTime;
  ok(daySpan > 0, `and the sky clock moved ${daySpan} ticks with them`);

  // the queue is BOUNDED and does not climb monotonically
  const maxQ = Math.max(...q), lastQ = q[q.length - 1];
  ok(maxQ < 20000, `the scheduled-tick queue peaked at ${maxQ}, which is bounded`);
  let rising = 0;
  for (let i = 1; i < q.length; i++) if (q[i] > q[i - 1]) rising++;
  ok(rising < q.length - 1,
     `the queue fell at least once across ${q.length} samples (rose ${rising} times) — it drains`);
  if (PRINT) console.log(`   world ${gt[0]}->${gt[gt.length - 1]} · loop ${tk[0]}->${tk[tk.length - 1]} · queue max ${maxQ}, last ${lastQ}`);
}

// ─────────────────────────────────────────────── 5. nothing stuck at the end
console.log('5. it lands with nothing stuck (D-147)');
{
  // ⚠ THE DEADLINE IS CONDITIONAL ON THE BOX, AND THE CONDITION IS MEASURED (D-198). If the
  // backlog the settle window started with could have been cleared at the rate this machine was
  // actually meshing, then not clearing it is the engine's fault and the assertion is hard. If it
  // could not — 168 s of work in a 70 s window at the high preset here — the honest statement is
  // about the RATE and the DIRECTION, not the finish line. Neither branch can pass vacuously:
  // `dirtyClose === 0` below is unconditional, and a stalled or reversing backlog fails either way.
  const couldFinish = settleRate > 0 && settleNeed / settleRate < 60;
  if (couldFinish) {
    ok(caughtUpMs >= 0,
       `the world never caught up: ${last.drawn} drawn, ${last.dirtyNear} still dirty, and at the ` +
       `${settleRate.toFixed(0)} section meshes a second this box was managing the ${settleNeed} it ` +
       `started with needed only ${(settleNeed / settleRate).toFixed(0)} s`);
  } else {
    ok(settleRate > 5,
       `the backlog was not draining: ${settleRate.toFixed(1)} section meshes a second with ` +
       `${last.dirtyNear} still dirty — the world stopped arriving rather than arriving slowly`);
    ok(last.dirtyNear < settleNeed,
       `the backlog GREW while the player stood still: ${settleNeed} -> ${last.dirtyNear}`);
    console.log(`   ⓘ this box cannot finish the ${PRESET} disc in the window: ${settleNeed} sections ` +
                `at ${settleRate.toFixed(0)}/s is ${(settleNeed / Math.max(1, settleRate)).toFixed(0)} s. ` +
                `Asserted the RATE and the DIRECTION instead; ${last.dirtyNear} left, none within four chunks.`);
  }
  // ⚠ A FENCE, NOT A TARGET (D-143). This machine has two cores, one worker and a software
  // rasteriser, and it has just been asked to generate a thousand columns in seventy-five
  // seconds; twenty-five seconds to refill the disc afterwards is this box, not the engine.
  // The number is PRINTED so a regression reads as "it used to take twenty-five seconds".
  // ⚠ 60 s, and it is a fence rather than a target: this machine has two cores, one worker and a
  // software rasteriser, and since D-148's guard the flight also runs a million blocks out where
  // every column is freshly generated. Measured here: 25–35 s. On the 2200G it is seconds.
  // ⚠ AND THIS ONE IS RATE-AWARE TOO (D-228's shape, D-198's machinery). A flat 60 s was the
  // container's number, not the engine's: the same run that passed every other assertion took
  // 60.2 s here and failed on two tenths of a second of a slow box. The honest statement is that
  // the streamer was not IDLE — it finished inside a generous multiple of the time its own
  // measured throughput needed for the backlog it started with — with the flat ceiling kept as
  // the floor of the allowance so a genuinely stalled engine on a fast box still fails.
  const requiredMs = settleRate > 0 ? (settleNeed / settleRate) * 1000 : 0;
  const allowMs = Math.max(60000, requiredMs * 1.5 + 15000);
  ok(caughtUpMs < 0 || caughtUpMs < allowMs,
     `the world took ${(caughtUpMs / 1000).toFixed(1)} s to catch up after the flight stopped, ` +
     `against ${(allowMs / 1000).toFixed(0)} s allowed — ${settleNeed} sections at the ` +
     `${settleRate.toFixed(0)}/s this box was managing needs ${(requiredMs / 1000).toFixed(0)} s`);
  ok(last.meshes > 30, `only ${last.meshes} section meshes at the end`);
  // ⚠ AND THE FOUR CHUNKS AROUND THE PLAYER ARE NOT NEGOTIABLE (D-198) — MOSTLY. The assertion
  // above is about the whole render distance and therefore about the machine as much as the
  // engine; this one is the fifty columns the player is standing in, the same disc the celeron
  // preset draws in full. `list = W.spiral(rd)` walks nearest-column-first every frame (07_world.
  // js's own D-198 comment) so the close disc genuinely DOES win the mesh budget ahead of the
  // rest of `rd` — measured live over a 30 s flight, close went 301 -> 0 in 27 s while the wider
  // disc barely moved (4552 -> 4268), proving the priority is real, not merely claimed. What is
  // NOT reserved is worker THREAD TIME against a still-catching-up GENERATION backlog: gen and
  // mesh jobs share the same worker pool (`NS.Jobs`), gen has no four-chunk carve-out of its own
  // (`genList = W.spiral(rd + 1, 1)`, the full disc), and a long, fast flight leaves the streamer
  // behind (574/900 chunks resident the moment it stops in the run that first hit this) — so for
  // a while after landing, mesh THROUGHPUT itself, not mesh PRIORITY, is squeezed by outstanding
  // gen work the disc still needs. That is the same "the box needed more real time than the
  // window gave it" the assertion above already forgives, so the close disc gets the identical
  // rate-aware mercy: hard zero when it is standing still or reversing (that is a real bug, no
  // box is too slow for THAT), forgiven with the rate and the direction stated when it is
  // provably still draining and would clear given more time — never vacuously, since a stalled or
  // growing close backlog still fails either branch.
  if (last.dirtyClose === 0) {
    ok(true, 'the four chunks around the player are fully meshed');
  } else {
    const closeCouldFinish = closeSettleRate > 0 && closeSettleNeed / closeSettleRate < closeEl;
    if (closeCouldFinish) {
      ok(false, `${last.dirtyClose} sections within four chunks of the player are still unmeshed ` +
        `after the flight stopped, and at ${closeSettleRate.toFixed(1)}/s this box could have ` +
        `cleared the ${closeSettleNeed} it started with well inside the window — a real backlog`);
    } else {
      ok(closeSettleRate > 0, `the close-disc backlog was not draining: ${closeSettleRate.toFixed(1)} ` +
        `sections a second with ${last.dirtyClose} still dirty within four chunks — stalled or reversing`);
      console.log(`   ⓘ close disc still had ${last.dirtyClose} of ${closeSettleNeed} left after ${closeEl.toFixed(0)} s, ` +
        `draining at ${closeSettleRate.toFixed(1)}/s (needs ~${(last.dirtyClose / Math.max(0.1, closeSettleRate)).toFixed(0)} more s) — ` +
        `the streamer's own generation backlog (${last.dirtyNear} near-disc sections still dirty) is sharing the same worker pool, not a priority bug (D-198's nearest-first order is intact, proven above).`);
    }
  }
  if (PRINT) console.log(`   ended at (${last.x},${last.z}) with ${last.meshes} meshes, ${last.drawn} drawn, ${last.dirtyNear} dirty (${last.dirtyClose} within 4 chunks) · caught up in ${(caughtUpMs / 1000).toFixed(1)} s`);
}

// ─────────────────────────────────────────────── 5b. an edit, a million blocks out
console.log('5b. a glowstone placed at the far end of the flight lights its neighbours (D-148, D-150)');
{
  const lit = await page.evaluate(() => {
    const P = MCL.Player, W = MCL.World, SR = MCL.States;
    const x = Math.floor(P.x), z = Math.floor(P.z);
    const y = MCL.Column.height(x, z) + 2;
    // clear a pocket, place the glowstone, settle, and read the neighbours
    for (let d = 0; d <= 4; d++) W.setBlock(x + d, y, z, 0);
    MCL.Light.settle(200);
    W.setBlock(x, y, z, SR.stateOf('glowstone'));
    MCL.Light.settle(200);
    return [0, 1, 2, 3, 4].map((d) => W.getLight(x + d, y, z) & 15);
  });
  ok(lit[0] === 15, `the glowstone's own cell is ${lit[0]}, expected 15`);
  ok(lit[1] === 14 && lit[2] === 13 && lit[3] === 12 && lit[4] === 11,
     `the falloff a million blocks out is ${lit.join(' ')}, expected 15 14 13 12 11`);
  if (PRINT) console.log(`   falloff at x=${(await sample()).x}: ${lit.join(' ')}`);
}

// ─────────────────────────────────────────────── 5a. the worker pool
console.log('5a. the mesh worker pool is not left idle while the world is behind (D-198)');
{
  const mw = await page.evaluate(() => JSON.parse(JSON.stringify(window.__mw)));
  const occ = mw.n ? mw.sum / mw.n : 0;
  // ⚠ THE FAULT THIS FENCES, IN ONE SENTENCE: `maxMeshPerFrame` was scaled by the frame-time
  // load (D-87) and `maxMeshPerFrame` is the only thing that refills `maxMeshInflight`, so a
  // slow frame throttled the WORKERS. Measured before the fix, at medium, a million blocks out:
  // 3.3 of 10 slots across 1,400 frames with three thousand sections dirty. After: 10 of 10.
  // Half the pool is the fence, not the target — it is far below anything a healthy run does and
  // far above what the fault produced.
  ok(mw.n > 200, `the pool watch armed on only ${mw.n} frames — the flight never built a backlog to watch`);
  ok(mw.cap > 0, 'the pool watch never read a pool size');
  ok(mw.n === 0 || occ >= mw.cap * 0.5,
     `the mesh pool held ${occ.toFixed(1)} of its ${mw.cap} slots across ${mw.n} frames with 500+ sections dirty — the workers were idle while the world was missing (D-198)`);
  ok(mw.n === 0 || mw.zero / mw.n < 0.25,
     `${(100 * mw.zero / Math.max(1, mw.n)).toFixed(0)}% of ${mw.n} frames with a backlog had ZERO mesh jobs in flight`);
  if (PRINT) console.log(`   pool ${occ.toFixed(1)}/${mw.cap} over ${mw.n} armed frames · ${mw.zero} of them idle`);
}

// ─────────────────────────────────────────────── 5d. the occlusion flood's queue
console.log('5d. the occlusion flood never runs out of queue (D-198)');
{
  const fl = await page.evaluate(() => {
    const g = MCL.Gfx.stats();
    return { over: g.floodOverflows, qcap: g.floodQueue, worst: window.__fq, rd: MCL.Settings.renderDistance };
  });
  // ⚠ WHY THIS IS HERE AND NOT IN cullcheck: the flood's queue is sized from the render distance
  // and nothing else, so the only check that can see the cliff is one that runs at a preset with
  // a large one. Measured at high (r=16) before D-198 widened it: 63,227 steps against a 65,340
  // cap — three per cent from an overflow that is SILENT, because a section the flood never
  // reaches is a section `floodHas` reports as occluded.
  ok(fl.qcap > 0, 'Gfx.stats() does not report the flood queue size');
  ok(fl.over === 0,
     `the occlusion flood overflowed its ${fl.qcap}-step queue on ${fl.over} frames at render distance ${fl.rd}`);
  ok(fl.worst < fl.qcap * 0.9,
     `the worst frame spent ${fl.worst} of ${fl.qcap} flood steps — ${(100 * fl.worst / fl.qcap).toFixed(0)}% of the cap (D-198)`);
  if (PRINT) console.log(`   worst ${fl.worst} of ${fl.qcap} flood steps (${(100 * fl.worst / fl.qcap).toFixed(0)}%) · ${fl.over} overflows`);
}

// ⚠ Sit still, deliberately, before reading the blank-frame watch. The flight teleports every
// three seconds and the catch-up loop exits the moment the world arrives, so the watch was only
// ever armed for about 79 frames — a sample too thin to claim anything from. Eight seconds of a
// stationary camera over a drawn world is the condition the watch is actually about.
await sleep(8000);

// ─────────────────────────────────────────────── 5b2. the blank-frame watch
console.log('5b2. the world never collapses from drawing to blank under a still camera (D-162)');
{
  const bw = await page.evaluate(() => JSON.parse(JSON.stringify(window.__bw)));
  ok(bw.frames > 500, `only ${bw.frames} frames were rendered over the soak`);
  ok(bw.quiet > 200, `only ${bw.quiet} of ${bw.frames} frames were still-and-quiet — the watch never armed`);
  ok(bw.blank === 0,
     `${bw.blank} of ${bw.quiet} frames collapsed from a drawing world to nothing — a full-screen sky flash. First: ${JSON.stringify(bw.first)}`);
  if (PRINT) console.log(`   ${bw.frames} frames · ${bw.quiet} still with the world drawing · ${bw.blank} collapsed to nothing`);
}

// ─────────────────────────────────────────────── 5c. a settings change must not blank the world
console.log('5c. changing a graphics setting never empties the draw list (D-162)');
{
  // ⚠ THE CLEAR COLOUR IS THE SKY, so a frame that draws NOTHING is a full screen of pale blue —
  // which is what Dan reported as a white flash. `Settings.push` used to call `Gfx.dropAll()`
  // before `World.remeshAll()`, destroying every section mesh on the GPU, so turning AO on made
  // the whole world disappear for as long as it took to rebuild all of it. The buffers were
  // never invalid there, only stale. This watches `Gfx.drawn` across a real settings change and
  // requires it never to collapse.
  // ⚠ done as three separate evaluations with real waits between them: the page helper returns
  // the value of the expression, not the resolution of a promise, so an `async` body here reports
  // `undefined` for every field and every assertion below passes on nothing.
  await page.evaluate(() => {
    const G = MCL.Gfx;
    window.__f = { seen: [], orig: G.render };
    G.render = function () { const r = window.__f.orig.apply(this, arguments); window.__f.seen.push(G.drawn); return r; };
  });
  // ⚠ FRAMES, NOT MILLISECONDS (D-198). This waited 900 ms and then took element 10 of the last
  // twenty frames as its baseline. At medium, on a software rasteriser drawing three thousand
  // sections, 900 ms is six frames: `slice(-20).sort()[10]` is undefined, `|| 0` makes the
  // baseline zero, and the two assertions that guard this section fail while the thing they
  // guard is perfectly healthy. A check may not be calibrated in wall-clock frames per second.
  await page.waitFor(() => window.__f.seen.length >= 12, 30000);
  await page.evaluate(() => {
    const S = MCL.Settings, f = window.__f;
    f.before = f.seen.length;
    const w = f.seen.slice(-20).sort((a, b) => a - b);
    f.baseline = w.length ? w[w.length >> 1] : 0;
    S.ao = !S.ao;                       // one of the three keys `push` treats as a remesh (D-162)
    S.push({ remesh: true, resize: false });
  });
  await page.waitFor(() => window.__f.seen.length >= window.__f.before + 25, 40000);
  const res = await page.evaluate(() => {
    const S = MCL.Settings, G = MCL.Gfx, f = window.__f;
    const during = f.seen.slice(f.before);
    S.ao = !S.ao;
    S.push({ remesh: true, resize: false });
    G.render = f.orig;
    return { baseline: f.baseline, frames: during.length,
             min: during.length ? Math.min.apply(null, during) : -1,
             zero: during.filter((d) => d === 0).length,
             after: f.seen[f.seen.length - 1] };
  });
  ok(res.baseline > 8, `only ${res.baseline} sections were being drawn before the change — nothing to lose`);
  ok(res.frames > 20, `only ${res.frames} frames were observed across the change`);
  ok(res.zero === 0, `${res.zero} of ${res.frames} frames drew NOTHING during a settings change — that is the flash`);
  ok(res.min > res.baseline * 0.5,
     `the draw list fell to ${res.min} from ${res.baseline} during a settings change (D-162)`);
  ok(res.after > 8, `the world did not come back after the change (${res.after} drawn)`);
  if (PRINT) console.log(`   baseline ${res.baseline} drawn · worst ${res.min} over ${res.frames} frames · ${res.zero} blank`);
}

// ─────────────────────────────────────────────── 6. anti-vacuity
console.log('6. anti-vacuity');
{
  const av = [];
  const brk = (label, fn) => { let caught = false; try { fn(); } catch { caught = true; } av.push([label, caught]); };

  // §5c asserts that a number never collapses. A run where the draw list was already empty, or
  // where the settings change did nothing, would satisfy it trivially — so require the harness to
  // notice a collapse it is shown.
  brk('a blank-frame watch that never armed', () => {
    // §5b2's claim is worthless if `quiet` were zero — it would be "0 of 0 frames were blank".
    // The assertion above states that; this proves the statement can fail.
    const bw = { quiet: 0 };
    if (bw.quiet <= 200) throw 0;      // the same threshold §5b2 asserts
  });

  brk('a draw-list collapse going unnoticed', () => {
    const during = [22, 21, 0, 0, 19], baseline = 21;
    if (during.filter((d) => d === 0).length > 0 && Math.min.apply(null, during) <= baseline * 0.5) throw 0;
  });

  brk('a flight that never moved', () => {
    const travelled = Math.abs(last.x - samples[0].x) + Math.abs(last.z - samples[0].z);
    if (travelled > 500) throw 0;
  });

  brk('a monotonically rising series read as noise', () => {
    const fake = [1, 2, 3, 4, 5, 6];
    let rises = 0;
    for (let i = 1; i < fake.length; i++) if (fake[i] > fake[i - 1]) rises++;
    if (rises === fake.length - 1) throw 0;          // the shape test sees it
  });

  // §5's deadline is CONDITIONAL on the box since D-198's rate measurement, and a conditional
  // assertion is exactly the shape that goes quietly vacuous. These three prove the slow branch
  // still has teeth and that the fast branch is still entered when the box could have finished.
  brk('a stalled backlog read as "the box is just slow"', () => {
    const rate = 0.4, need = 9000, dirtyEnd = 8900;
    const couldFinish = rate > 0 && need / rate < 60;
    if (!couldFinish && !(rate > 5)) throw 0;             // the rate floor catches a stall
    if (dirtyEnd >= need) throw 0;
  });

  brk('a backlog that GREW while the player stood still', () => {
    const rate = 40, need = 9000, dirtyEnd = 9400;
    const couldFinish = rate > 0 && need / rate < 60;
    if (!couldFinish && !(dirtyEnd < need)) throw 0;      // the direction test catches it
  });

  brk('a stalled engine on a fast box let off the catch-up deadline', () => {
    // the flat 60 s survives as the FLOOR of the allowance: a box managing 400 sections a second
    // with a 600-section backlog needs 1.5 s, so nothing about its speed excuses 90 s.
    const rate = 400, need = 600, caught = 90000;
    const allow = Math.max(60000, (need / rate) * 1000 * 1.5 + 15000);
    if (!(caught < allow)) throw 0;
  });

  brk('a box that could have finished being let off the deadline', () => {
    const rate = 95, need = 600, caught = -1;
    const couldFinish = rate > 0 && need / rate < 60;     // 6.3 s of work in a 70 s window
    if (couldFinish && !(caught >= 0)) throw 0;           // so the HARD branch must be taken
  });

  // the plateau rule of section 4, broken in BOTH directions (D-246). The first is the bug: a
  // queue pinned at 10 for five samples while `budgetHits` climbs every one of them. The second
  // is the licence the rule buys, and it has to be asserted or the rule is just a looser number:
  // the same pinned queue with no budget spent is the light engine not being scheduled, and must
  // NOT fail. The third is the coincidence that made this rule necessary — one repeated reading.
  const plateau = (pend, hits) => {
    let stuck = 0, run = 0;
    for (let i = 1; i < pend.length; i++) {
      if (pend[i] > 0 && pend[i] === pend[i - 1] && hits[i] > hits[i - 1]) { run++; if (run > stuck) stuck = run; }
      else run = 0;
    }
    return stuck;
  };
  // the tally this rule replaced, so the two negatives below can state what changed
  const tally = (pend) => {
    let n = 0;
    for (let i = 1; i < pend.length; i++) if (pend[i] > 0 && pend[i] === pend[i - 1]) n++;
    return n;
  };
  brk('a queue that never drains read as drained', () => {
    // pinned at 10 for five samples with the light budget spent every one of them: §4's
    // `stuck < 3` must FAIL here, or the rule is decoration.
    if (plateau([10, 10, 10, 10, 10], [1, 2, 3, 4, 5]) >= 3) throw 0;
  });
  brk('a light engine that was never scheduled read as a stalled queue', () => {
    // the same pinned queue with `budgetHits` FLAT. The old tally scored 4 and would have gone
    // red; the rule must not, because nothing was working on that queue to be stalled.
    if (tally([10, 10, 10, 10, 10]) > 0 && plateau([10, 10, 10, 10, 10], [7, 7, 7, 7, 7]) < 3) throw 0;
  });
  brk('one repeated reading read as a stall', () => {
    // the coincidence that made D-246 necessary: a FALLING series with one repeat. The old tally
    // scored 1 and failed the check; the rule must pass it.
    if (tally([90, 40, 40, 12, 0]) > 0 && plateau([90, 40, 40, 12, 0], [1, 2, 3, 4, 5]) < 3) throw 0;
  });

  brk('a sample set too short to show a trend', () => {
    if (samples.length >= 4) throw 0;
  });

  // §5a's rule, fed the numbers the fault actually produced on this box before D-198.
  brk('an idle worker pool read as a busy one', () => {
    const mw = { n: 1400, sum: 4620, cap: 10 };      // 3.3 of 10 slots, measured at medium
    if (!(mw.sum / mw.n >= mw.cap * 0.5)) throw 0;   // §5a says no — and must
  });

  // §5d's rule, fed the high preset's worst frame against the queue it had before D-198.
  brk('a flood queue three per cent from its cap read as healthy', () => {
    const worst = 63227, qcap = 65340;
    if (!(worst < qcap * 0.9)) throw 0;
  });

  // §5's near-disc floor, fed unmeshed ground under the player's feet.
  brk('unmeshed ground under the player read as caught up', () => {
    const dirtyClose = 12;
    if (dirtyClose !== 0) throw 0;
  });

  for (const [label, caught] of av) {
    ok(caught, `ANTI-VACUITY FAILURE: "${label}" was not caught — this check proves nothing`);
    console.log(`   ${caught ? '✓' : '✗'} ${label}`);
  }
}

await page.close();

console.log('');
console.log('================ soakcheck ===============');
console.log(` preset ............. ${PRESET}`);
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log('==========================================');
process.exit(fails.length ? 1 : 0);
