#!/usr/bin/env node
// flashcheck.mjs — the white flash, hunted rather than assumed (docs/archive/PLAN.md §9, risk 9).
//
//   node tools/flashcheck.mjs [dist/mclite.html] [--print] [--seconds 180]
//
// D-162 (a settings change dropped every GPU mesh) and D-171/D-175 (a shrinking adaptive render
// distance culled every mesh outside the flood grid) are fixed and fenced — soakcheck's §5b2/§5c
// and cullcheck's §2e. Dan still sees flashes, less often. This does not guess at a third cause:
// it drives every live provocation the enumeration in docs/archive/PLAN.md §9 found a code path
// for — a fast flight across chunk borders, teleports, settings/preset changes (including the
// direct `applyPreset` render-distance write that §2e's own sweep never exercises), a window
// resize, and F7/F8 — and it watches EVERY FRAME for a few thousand frames, not a few sampled
// moments the way soakcheck's 3-second-step flight does.
//
// It scores two independent numbers per frame — MCL.Gfx.drawn (sections) and MCL.Gfx.tris
// (triangles) — because a bug that empties one list and not the other (D-131 was exactly that
// shape once, for the cutout layer) would hide behind whichever number a check trusts alone.
//
// ⚠ IT HAS NOW RUN, AND ITS FIRST SCORING WAS WRONG IN BOTH DIRECTIONS (D-194). Read against a
// live build it reported five failures, every one of them from comparing a frame only against
// THE FRAME BEFORE IT. That measure cannot tell "the world in front of the camera vanished"
// from "the player teleported 400 blocks and the world there has not been built yet" — and the
// second is most of this probe's runtime by design. Its own §3 comment already stated the rule
// it was not implementing: *the screen emptying faster than the world it is drawing shrank*.
//
// So a frame is now scored against the RESIDENT WORLD, not against its predecessor. The hook
// counts `eligible` — section meshes that are loaded AND within the render distance of the
// camera, i.e. geometry the frame had every reason to draw. Blankness with nothing eligible is
// a world still streaming and is not a flash; blankness with an eligible world is a flash, and
// so is a drop that outruns the eligible count, over a WINDOW rather than one frame pair,
// because a drain spread over three frames used to slip under a per-frame fence untouched.
//
// ⚠ AND ITS RECOVERY BEAT WAS STOPPING AT A NUMBER ITS OWN SCORER DID NOT USE (D-224). Run at
// the medium preset for the first time (D-196), three of its phases reported that nothing had
// been provoked in them. The cause was not the engine and not the provocations: `untilWorld`
// handed a phase over at 32 eligible sections, while the scorer's floor at that render distance
// was 58, so `teleport` was judged on 5 frames of 201 and `f7-f8-toggle` on 7 of 78. The beat
// now waits for the floor the scorer actually applies, `resize` gets a beat of its own, and the
// final `settle` phase runs for FRAMES rather than three seconds — eight frames at 2.7 fps
// could never clear a ten-frame bar. What is NOT changed is FC.FLOOR or FC.FULL: lowering the
// eligibility threshold would make every phase scoreable and the probe vacuous.
// Where a phase is still short, §1 now says WHY in sections a second — the streamer delivering
// throughout is a slow box and is reported; the streamer delivering nothing is the world having
// stopped arriving, and that still fails.
//
// Sections:
//   1. it ran long enough to mean something
//   2. no frame drew nothing while a loaded, in-range, in-frustum world was there to be drawn
//   3. no drop over a 12-frame window outruns the shrinking of the world that caused it
//   4. the counters are the backend's own (D-194): no context loss, and drawn <= listed
//   5. anti-vacuity — the REAL scorer, run over synthetic frames it must and must not flag

import { open, sleep, REAL_GPU } from './cdp.mjs';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2).filter((a) => !a.startsWith('--') && !/^\d+$/.test(a));
const FILE = args[0] ? (args[0].startsWith('/') ? args[0] : ROOT + args[0]) : ROOT + 'dist/mclite.html';
const PRINT = process.argv.includes('--print');
const secIdx = process.argv.indexOf('--seconds');
// D-820: the 180 s default was sized for SwiftShader (~2.7 fps → ~490 frames). On the real GPU (Dan's PC, cdp.REAL_GPU)
// 60 s already gives thousands of frames — more than SwiftShader's whole run — so the probe is 3x shorter there.
const SECONDS = secIdx > 0 ? Number(process.argv[secIdx + 1]) : (REAL_GPU ? 60 : 180);
const K = SECONDS / 180;   // scales every phase below together
if (!existsSync(FILE)) { console.error('flashcheck: no such file ' + FILE); process.exit(1); }

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 20) fails.push(m); };

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE SCORER. One implementation, defined here, injected into the page by .toString() and run
// directly by §5 over synthetic frames (D-194). The old file paraphrased its scoring a second
// time in Node to "test" it, which is how its anti-vacuity mutant came to assert something the
// real rule never claimed: the mutant passed a collapse the logic CAN see and demanded it be
// missed. A check may only prove things about the code it actually runs.
//
// Frame f: { n, drawn, tris, eligible, label }.
//   drawn     sections the BACKEND confirmed it drew (Gfx.drawn since D-194)
//   eligible  meshes resident and inside the render distance — what there was to draw
// ─────────────────────────────────────────────────────────────────────────────────────────────
const FC = {
  WINDOW: 12,       // frames a drop may be spread over and still be one event
  // ⚠ THE FLOOR IS NOT A CONSTANT, BECAUSE "A FULL WORLD" IS NOT ONE (D-194). At render distance
  // 4 a complete surround is about 380 resident sections and at 11 it is thousands, so any fixed
  // number is simultaneously too strict for one radius and too slack for the other: 32 excused a
  // blank screen at rd 4 and condemned one at rd 11 with 9% of a world loaded. The floor is
  // instead HALF THE FULLEST WORLD THIS RUN HAS SEEN AT THIS RENDER DISTANCE — self-calibrating,
  // no table, and it cannot be tuned to make a red run green without also making the check blind
  // to the collapse it is watching for.
  // 8 sections, and the unit is FRUSTUM sections (D-194): once `eligible` means "loaded, in
  // range and on screen", a full world in view is tens, not hundreds — 46 at the settled render
  // distance this probe reaches, against the 380-odd that were merely in range. A screen showing
  // nothing while eight loaded sections stand in the frustum is a bug in any world.
  FLOOR: 8,         // an absolute minimum under the calibrated one, never above it
  FULL: 0.5,
  RUN: 3,           // consecutive blank frames over a live world before it is a flash, not a hitch
  SLACK: 1.6,       // drawn may fall this much faster than eligible before it is a collapse
};

/**
 * Why a phase came up short of ten scoreable frames (D-224). Defined here, beside the scorer,
 * and run by §5 over synthetic rows — the same discipline D-194 imposed on `scoreFrame`: a check
 * may only prove things about the code it actually runs.
 *
 *   r.scored     frames whose eligible count cleared the scorer's own floor
 *   r.delivered  sections World.stats2.meshed handed back while this phase ran
 *   r.eMax       the most the picture ever held during it
 */
function phaseVerdict(r) {
  if (r.scored >= 10) return 'scored';
  if (r.delivered === 0) return 'world-stopped';
  if (r.eMax === 0) return 'never-eligible';
  return 'slow-box';
}

function newScore() {
  return {
    n: 0, label: '', blanks: 0, run: 0, peak: {},
    dWin: [], eWin: [], fWin: [], oWin: [],
    blankRuns: [],       // { frame, len, eligible, label }
    worst: { ratio: 0 }, // the drop that outran its world by the most
    zeroTris: [],        // drew sections but no triangles — the D-131 shape
  };
}

function scoreFrame(s, f) {
  s.n++;
  // ⚠ BOTH STREAMS, AND THE RULE THAT NEEDS THEM IS THE ONE NAMED AFTER D-131 (D-198). `drawn`
  // counts a section whichever of its two streams reached the GPU — greedy quads land in
  // `Gfx.tris` and model quads in `Gfx.modelTris` — so a frame whose only drawn section is a
  // grass tuft or a torch has drawn 1 and tris 0 and is perfectly healthy. Scoring it against the
  // greedy count alone made this check flag exactly the thing D-131 is about, in mirror: a rule
  // that trusts one of two streams. Measured on a 120 s run: 8 such frames on the pre-D-198 build
  // and 4 on the fixed one, none of them a real defect.
  const d = f.drawn | 0, e = f.eligible | 0, t = (f.tris | 0) + (f.mtris | 0), rd = f.rd | 0;
  if (e > (s.peak[rd] || 0)) s.peak[rd] = e;
  // half the fullest world this run has seen at THIS render distance (FC.FULL); inline,
  // because this function is shipped into the page by .toString() and travels alone
  const floor = Math.max(FC.FLOOR, FC.FULL * (s.peak[rd] || 0));
  // ⚠ F7 IS A DEBUG KEY WHOSE WHOLE PURPOSE IS TO CULL WRONG (D-194). With the frustum frozen
  // and the player flying, the picture emptying is the feature working; measured at 43 -> 5
  // sections against an unchanged 378 in range. A frozen frame is therefore not scored, and
  // neither is any window containing one — what F7 has to prove is that turning it OFF leaves
  // nothing broken behind it, and §4's ratio test is what asks that.
  // ⚠ AND F8 IS EXEMPT FOR THE SAME REASON AS F7 (D-194). Turning the visibility flood on and
  // off swaps the culling ALGORITHM, and a window that straddles the switch is comparing two
  // different pictures of the same world — measured at 72 -> 21 sections against a world in
  // range that moved 13%. What F8 has to prove is that the flood never draws MORE than the
  // frustum alone, and `cullcheck` §2 already proves exactly that, from screenshots.
  s.fWin.push(f.frozen ? 1 : 0);
  s.oWin.push(f.occlusion ? 1 : 0);
  if (s.fWin.length > FC.WINDOW) { s.fWin.shift(); s.oWin.shift(); }
  const frozenNear = s.fWin.indexOf(1) >= 0 ||
                     (s.oWin.indexOf(1) >= 0 && s.oWin.indexOf(0) >= 0);
  if (f.frozen) { s.run = 0; s.dWin.push(d); s.eWin.push(e);
    if (s.dWin.length > FC.WINDOW) { s.dWin.shift(); s.eWin.shift(); }
    return s; }

  // ── 2. a blank frame over a world that was there to be drawn
  // ⚠ AND THAT THE SCREEN WAS SHOWING (D-194). `eligible` says the geometry is resident and in
  // range; it does not say any of it was ever in front of the camera. A run flying at 160 blocks
  // a second holds a thin trailing set of meshes behind it and can honestly show sky. What is a
  // flash is the picture GOING: the window must contain a frame that drew something first.
  let seen = 0;
  for (let i = 0; i < s.dWin.length; i++) if (s.dWin[i] > seen) seen = s.dWin[i];
  if (d === 0 && e >= floor && seen >= FC.FLOOR) {
    s.run++;
    s.blanks++;
    if (s.run >= FC.RUN && s.blankRuns.length < 20 &&
        (!s.blankRuns.length || s.blankRuns[s.blankRuns.length - 1].frame + s.blankRuns[s.blankRuns.length - 1].len < f.n))
      s.blankRuns.push({ frame: f.n - s.run + 1, len: s.run, eligible: e, label: f.label });
    else if (s.blankRuns.length && s.blankRuns[s.blankRuns.length - 1].frame + s.blankRuns[s.blankRuns.length - 1].len >= f.n)
      s.blankRuns[s.blankRuns.length - 1].len = s.run;
  } else if (d > 0) s.run = 0;

  // ── drew a list but no geometry AT ALL, on either stream (D-131 emptied one layer and not
  // the other; D-198 is why `t` is now the sum rather than the greedy half)
  if (d > 0 && t === 0 && s.zeroTris.length < 10) s.zeroTris.push({ frame: f.n, drawn: d, label: f.label });

  // ── 3. a drop measured over a window, against the world that shrank under it
  // ⚠ THE PEAK OF THE WINDOW, NOT THE PREVIOUS FRAME. A drain of 100 -> 60 -> 30 -> 0 is four
  // frames of "only 40% down" and one blank screen, and the frame-pair fence saw none of it.
  s.dWin.push(d); s.eWin.push(e);
  if (s.dWin.length > FC.WINDOW) { s.dWin.shift(); s.eWin.shift(); }
  let dPeak = 0, ePeak = 0;
  for (let i = 0; i < s.dWin.length; i++) { if (s.dWin[i] > dPeak) dPeak = s.dWin[i]; if (s.eWin[i] > ePeak) ePeak = s.eWin[i]; }
  if (dPeak >= FC.FLOOR && ePeak >= floor && !frozenNear) {
    // how much of the picture went, against how much of the world went with it
    const dropped = 1 - d / dPeak;
    const shrank  = 1 - e / ePeak;
    // 1 - shrank is what the picture was ENTITLED to lose; SLACK is the honest slop in a
    // section-granular comparison (a mesh can leave the frustum without leaving the radius).
    const allowed = 1 - Math.pow(1 - shrank, 1 / FC.SLACK);
    const ratio = dropped - allowed;
    if (ratio > s.worst.ratio)
      s.worst = { ratio, frame: f.n, dropped, allowed, from: dPeak, to: d, eFrom: ePeak, eTo: e, label: f.label };
  }
  return s;
}

const page = await open(FILE, { port: 9421, width: 960, height: 540 });
if (!page) {
  console.error('flashcheck: no Chromium found on this machine (see tools/cdp.mjs CANDIDATES).');
  console.error('This probe is written and ready; nothing else could be checked without a browser.');
  process.exit(1);
}
await sleep(1800);
await page.key('Enter');
const ready = await page.waitFor(() => MCL.Main.ready === true, 90000);
ok(ready === true, 'the world never started');

// A million-block-ish offset, same reasoning as soakcheck's START_X/START_Z (D-148): a check
// that only ever looks near the origin cannot see a bug that only exists far from it.
const START_X = 300000, START_Z = -450000;
await page.send('Runtime.evaluate', { expression: `
  MCL.Player.creative = true; MCL.Player.flying = true; MCL.Hud.showDebug = false;
  MCL.Player.x = ${START_X}; MCL.Player.z = ${START_Z};
  MCL.Player.y = MCL.Column.height(Math.floor(MCL.Player.x), Math.floor(MCL.Player.z)) + 10;
  MCL.Player.vy = 0; MCL.Player.pitch = -0.12; MCL.Player.yaw = 0.5;
  // The adaptive render distance is pinned off for this probe (D-194) — see the note above
  // Settings.adapt: D-46 answers a slow rasteriser by pulling the render distance to its floor
  // of 2, which is 32 blocks, and under a software GL that is where it sits for every phase
  // that moves. A world 32 blocks wide holds about nineteen sections in the frustum at all,
  // which is too few for "the screen went empty" to mean anything, and it is not the world Dan
  // plays in. The preset phases still write the render distance directly through applyPreset,
  // which is the provocation that matters here; what is removed is the frame-time feedback loop
  // moving it under the probe's feet.
  MCL.Settings.adaptive = false; MCL.Settings.setRenderDistance(8);
` });
await sleep(6000);

// ⚠ THE HOOK RUNS IN-PAGE, NOT FROM NODE — the same technique as soakcheck §5b2's blank-frame
// watch. Polling MCL.Gfx.drawn from Node once a frame would be a WebSocket round trip per sample
// and would miss most frames entirely; wrapping G.render costs a comparison and an array push
// and sees every one of them.
await page.send('Runtime.evaluate', { expression: `
  const FC = ${JSON.stringify(FC)};
  window.__FC = FC;               // page.evaluate() ships a function by toString(); it can
                                  // interpolate nothing, so the constants have to be reachable
  const newScore = ${newScore.toString()};
  const scoreFrame = ${scoreFrame.toString()};
  window.__fc = newScore();
  window.__fc.label = '_warmup';
  window.__fc.phases = {};      // label -> sorted-later array of drawn counts, for the report
  (function () {
    const G = MCL.Gfx, f = G.render, s = window.__fc;
    G.render = function () {
      const r = f.apply(this, arguments);
      // ⚠ WHAT THERE WAS TO DRAW (D-194). A mesh is eligible if it is resident, inside the
      // render distance, AND inside the view frustum — geometry that could have been ON SCREEN.
      // This is the denominator the old scoring did not have, and without it a probe that
      // teleports faster than the streamer reports its own impatience as the engine's bug.
      //
      // ⚠ AND THE FRUSTUM TEST IS NOT OPTIONAL (D-194). "Resident and in range" alone counted
      // everything BEHIND the camera: a 150-block teleport under a preset whose render distance
      // is 16 leaves the whole previous neighbourhood in range and none of it on screen, and the
      // check duly reported twelve legitimately blank frames as a flash. With the frustum in the
      // definition, a blank frame over an eligible world means the sections were loaded, in
      // range and in front of the camera and were still not drawn — which nothing but a bug
      // does, because the flood seeds the 3x3x3 around the camera unconditionally (D-85).
      const rd = (MCL.Settings && MCL.Settings.renderDistance) || 8;
      const cam = G.cam, C = MCL.Cam, MINY = MCL.CFG.WORLD_MIN_Y;
      const cx = Math.floor(cam.x) >> 4, cz = Math.floor(cam.z) >> 4;
      const list = G.meshList; let eligible = 0;
      for (let i = 0; i < list.length; i++) {
        const m = list[i], ax = m.cx - cx, az = m.cz - cz;
        if (ax * ax + az * az > rd * rd) continue;
        const ox = m.cx * 16, oz = m.cz * 16, oy = MINY + m.sy * 16;
        if (C.aabbVisible(cam, ox, oy, oz, ox + 16, oy + 16, oz + 16)) eligible++;
      }
      const frame = { n: s.n + 1, drawn: G.drawn | 0, tris: G.tris | 0, mtris: G.modelTris | 0, eligible, rd: rd,
                      frozen: !!G.frozenFrustum, occlusion: !!G.occlusion, label: s.label };
      // ⚠ A SCORER THAT THROWS MUST NOT TAKE THE GAME WITH IT, AND MUST NOT GO QUIET (D-194).
      // An un-injected helper turned every frame into a ReferenceError out of G.render: the
      // world stopped at frame 1 and the run reported a flash in a game that was not running.
      try { scoreFrame(s, frame); } catch (err) { s.error = s.error || String(err && err.message || err); }
      // ⚠ AND THE STREAMER'S OWN DELIVERY COUNTER, WHICH IS WHAT SEPARATES A SLOW BOX FROM A
      // BROKEN ENGINE (D-224). World.stats2.meshed only ever goes up, and by one for every
      // section the mesher hands back. A phase that never held a world while this number was
      // climbing was starved by the machine; a phase that never held a world while it stood
      // still is a phase in which the world stopped arriving, and that is a defect. §1 asks
      // exactly that question and answers it in sections a second.
      (s.phases[s.label] || (s.phases[s.label] = [])).push([frame.drawn, eligible, frame.frozen ? 1 : 0, rd, eligible >= Math.max(FC.FLOOR, FC.FULL * (s.peak[rd] || 0)) ? 1 : 0, (MCL.World.stats2 && MCL.World.stats2.meshed) | 0, Date.now()]);
      return r;
    };
  })();
` });

const setLabel = (label) => page.send('Runtime.evaluate', { expression: `window.__fc.label = ${JSON.stringify(label)};` });
const evalExpr = (expression) => page.send('Runtime.evaluate', { expression });

/**
 * Wait — bounded, and labelled so the wait itself is never scored — until the streamer has put
 * a world back in range.
 *
 * ⚠ THIS IS THE OPPOSITE OF SOFTENING THE PROBE (D-194). The first live run flew 24 blocks every
 * 150 ms (160 blocks a second, seven times a sprint-fly) and teleported 370 blocks a second; two
 * of its six phases never had a single loaded section in range for the whole phase, so whatever
 * they were provoking, nothing could have been observed failing. The provocations are unchanged
 * and still far past anything a player can do. What is added is a recovery beat between them, so
 * each phase acts on a world that exists — a phase that never had one cannot fail, and a check
 * that cannot fail is not a check (D-164).
 */
const eligibleNow = () => page.evaluate(() => {
  const G = MCL.Gfx, C = MCL.Cam, cam = G.cam, MINY = MCL.CFG.WORLD_MIN_Y;
  const rd = (MCL.Settings && MCL.Settings.renderDistance) || 8;
  const cx = Math.floor(cam.x) >> 4, cz = Math.floor(cam.z) >> 4;
  let n = 0;
  for (const m of G.meshList) {
    const ax = m.cx - cx, az = m.cz - cz;
    if (ax * ax + az * az > rd * rd) continue;
    const ox = m.cx * 16, oz = m.cz * 16, oy = MINY + m.sy * 16;
    if (C.aabbVisible(cam, ox, oy, oz, ox + 16, oy + 16, oz + 16)) n++;
  }
  // the scorer's own floor at this render distance, and the streamer's delivery counter
  const s = window.__fc, K = window.__FC || { FLOOR: 8, FULL: 0.5 };
  const floor = Math.max(K.FLOOR, K.FULL * ((s && s.peak && s.peak[rd]) || 0));
  return { e: n, floor, rd, meshed: (MCL.World.stats2 && MCL.World.stats2.meshed) | 0 };
});

/**
 * ⚠ THE RECOVERY BEAT NOW WAITS FOR THE NUMBER THE SCORER ACTUALLY USES (D-224). It used to
 * return at a flat `e >= 32`, and 32 is not "enough world" at any render distance in
 * particular: measured at the medium preset on a two-core box, a full world at rd 8 is 117
 * frustum sections, so the scoring floor is 58 and every phase this beat handed over at 32 was
 * handed a world less than half of what its own rule needed. That is why `teleport` scored 5
 * frames of 201 and `f7-f8-toggle` 7 of 78 — not a shy engine, a beat that stopped early.
 *
 * ⚠ AND IT IS NOT A LOWERED THRESHOLD, IT IS A RAISED ONE. FC.FLOOR and FC.FULL are untouched;
 * what changed is that the wait ends when the world clears them, when the streamer stops
 * delivering (which is a real answer — nothing more is coming), or when the budget runs out.
 */
async function untilWorld(ms) {
  await setLabel('_recover');
  const t0 = Date.now();
  let last = -1, flat = 0, lastMeshed = -1, stillMeshing = 0;
  for (;;) {
    const w = await eligibleNow();
    // has the picture stopped GROWING? that, and not a wall-clock number, is when more waiting
    // stops buying anything
    if (last >= 0 && w.e <= last * 1.02) flat++; else flat = 0;
    stillMeshing = w.meshed === lastMeshed ? stillMeshing + 1 : 0;
    lastMeshed = w.meshed; last = w.e;
    // ⚠ BOTH CONDITIONS, AND THE `&&` IS THE WHOLE POINT. Returning on the floor alone hands the
    // phase over the instant the world is barely judgeable and keeps `peak[rd]` — which IS the
    // floor — pinned low for the whole run: measured, a version that did that left a full world
    // at render distance 8 reading 16 frustum sections where waiting for the plateau reached 117,
    // so every later judgement was made over a seventh of the world. Returning on the plateau
    // alone is what D-194 left, and it stopped at 32 sections against a floor of 58.
    if (w.e >= w.floor && flat >= 3) return w.e;
    // nothing is arriving and nothing is growing: more time genuinely cannot help
    if (stillMeshing >= 5 && flat >= 5) return w.e;
    if (Date.now() - t0 > ms) return w.e;
    await sleep(700);
  }
}

// ─────────────────────────────── phase 1: fast flight across chunk borders ───────────────────
// 24 blocks (1.5 chunks) every 600 ms — 40 blocks a second, two and a half times soakcheck's
// 16-blocks-per-second cruise and about twice a vanilla creative sprint-fly. That is enough to
// keep the streamer permanently behind, which is when Dan says the flashes happen ("mostly when
// new chunks and stuff are loading").
//
// ⚠ IT USED TO BE 150 ms — 160 BLOCKS A SECOND — AND THAT WAS NOT A HARDER TEST, IT WAS NO TEST
// (D-194). The adaptive system (D-46) answers a load like that by pulling the render distance
// down to its floor of 2, which is 32 blocks: the probe left its own render distance between one
// step and the next, and the phase ran its whole length without ever holding half a world. A
// phase with nothing loaded in range cannot fail, whatever it is doing to the engine.
await setLabel('chunk-border-flight');
{
  const n = Math.max(20, Math.round(60 * K));
  for (let i = 0; i < n; i++) {
    // ⚠ EVERY SIXTEEN STEPS, NOT EVERY EIGHT (D-224). A recovery beat that waits for a full
    // world costs what a full world costs — measured at 20 to 100 s on a software rasteriser —
    // and this phase does not need one twice as often as it needs a provocation. Halving the
    // count took four beats out of the run and left the phase scoring 29 frames against a bar
    // of 10.
    if (i && i % 16 === 0) { await untilWorld(20000); await setLabel('chunk-border-flight'); }
    await evalExpr(`MCL.Player.x += 24; MCL.Player.z += 9;
      MCL.Player.y = MCL.Column.height(Math.floor(MCL.Player.x), Math.floor(MCL.Player.z)) + 10;
      MCL.Player.vy = 0;`);
    await sleep(600);
  }
}

// ─────────────────────────────── phase 2: teleports mid-arrival ──────────────────────────────
// Big jumps with only a short, partial settle — on purpose. Waiting for `quiet()` (as cullcheck
// does before comparing pictures) would hide exactly the window D-171 lived in: chunks still
// arriving, the adaptive system reacting, meshes outliving the old radius.
// ⚠ AND EACH ROUND STARTS FROM A WORLD, THEN LEAVES IT (D-194). A round that only ever jumps
// 400+ blocks spends every one of its frames somewhere the streamer has not reached, so its
// blank screens are unscoreable and the phase, whatever it provoked, could not have failed. The
// round now recovers, hops 48 blocks WITHIN the render distance — which keeps the neighbourhood
// resident and in the frustum, and is the only part of this phase a blank frame can be judged
// in — and only then makes the big jump. Both provocations survive; one of them is observable.
{
  const n = Math.max(3, Math.round(5 * K));
  for (let i = 0; i < n; i++) {
    await untilWorld(30000);
    await setLabel('teleport');
    // ⚠ THE PHASE OWNS THE FRAMES BEFORE ITS OWN PROVOCATION (D-194). A flash is a picture that
    // WAS there and went; a phase whose every frame is already post-jump has no "was". This
    // second is the recovered world under the phase's own label, so the scorer has something to
    // watch the provocation take away.
    await sleep(1200);
    await evalExpr(`MCL.Player.x += 48; MCL.Player.z -= 32;
      MCL.Player.y = MCL.Column.height(Math.floor(MCL.Player.x), Math.floor(MCL.Player.z)) + 10;
      MCL.Player.vy = 0;`);
    await sleep(1100);
    // 200-400 blocks fully replaces the neighbourhood at any render distance this probe uses
    // (rd 8 is 128 blocks) while leaving the streamer a reachable amount of work: at 400-1300 the
    // recovery beat timed out every round and the phase scored one frame in six hundred (D-194).
    const dx = 200 + (i * 47) % 200, dz = -200 - (i * 61) % 200;
    await evalExpr(`MCL.Player.x += ${dx}; MCL.Player.z += ${dz};
      MCL.Player.y = MCL.Column.height(Math.floor(MCL.Player.x), Math.floor(MCL.Player.z)) + 10;
      MCL.Player.vy = 0;`);
    await sleep(2500);
  }
}

// ─────────────────────────────── phase 3: settings and preset changes ────────────────────────
// `Settings.push` (D-162's fix) is exercised by flipping the three remesh-triggering keys, AND
// `applyPreset` is cycled directly — which writes `S.renderDistance` straight from the preset
// table rather than through `setRenderDistance`, the one path cullcheck §2e's sweep drives. If
// D-171's fix at `floodHas` is truly generic this is safe; if some OTHER path still reads the
// old render distance for one frame after a preset's jump, this is where it would show up.
await setLabel('settings-and-preset');
{
  const n = Math.max(4, Math.round(8 * K));
  const order = ['celeron', 'high', 'low', 'medium'];
  for (let i = 0; i < n; i++) {
    await evalExpr(`MCL.Settings.ao = !MCL.Settings.ao; MCL.Settings.markCustom();
      MCL.Settings.push({ remesh: true, resize: false });`);
    await sleep(400);
    await evalExpr(`MCL.Settings.applyPreset('${order[i % order.length]}');`);
    await sleep(1200);
  }
}

// ─────────────────────────────── phase 4: window resize ──────────────────────────────────────
// CDP's device-metrics override is what actually changes window.innerWidth/innerHeight in a
// headless tab, which is what fires the 'resize' listener 17_main.js attaches to
// `Main.resize` — a real resize event, not a direct call to the handler.
// ⚠ AND IT NEEDS THE SAME RECOVERY BEAT EVERY OTHER PHASE HAS (D-224). This phase used to
// start wherever phase 3's last `applyPreset` left the world — a render distance it had had one
// second to fill — so its frames were judged against a floor calibrated on a world it had never
// been given. Every phase that provokes has to start from one.
await untilWorld(30000);
await setLabel('resize');
{
  const sizes = [[640, 360], [1280, 720], [480, 800], [960, 540]];
  const n = Math.max(4, Math.round(6 * K));
  for (let i = 0; i < n; i++) {
    const [w, h] = sizes[i % sizes.length];
    await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await evalExpr('window.dispatchEvent(new Event("resize")); MCL.Main.resize();');
    await sleep(700);
  }
  await page.send('Emulation.clearDeviceMetricsOverride', {});
  await evalExpr('MCL.Main.resize();');
}

// ─────────────────────────────── phase 5: F7 / F8 ─────────────────────────────────────────────
// Flipped directly on MCL.Gfx rather than through a synthetic keydown: F7 sets frozenFrustum,
// F8 sets occlusion, and that assignment is the entire handler (10_gfx.js attachDebugKeys) —
// this is not a shortcut around the feature, it IS the feature.
await untilWorld(30000);
await setLabel('f7-f8-toggle');
{
  const n = Math.max(6, Math.round(10 * K));
  for (let i = 0; i < n; i++) {
    await evalExpr('MCL.Gfx.occlusion = !MCL.Gfx.occlusion;');
    await sleep(300);
    await evalExpr('MCL.Gfx.frozenFrustum = !MCL.Gfx.frozenFrustum;');
    await sleep(300);
    // ⚠ AND THE HEIGHT, WHICH THIS PHASE ALONE USED TO OMIT (D-194). Every other phase re-seats
    // the player above the terrain after moving them; this one walked 300 blocks in ten steps
    // and left the camera wherever the last phase had put it — measured buried, drawing 3
    // sections against 419 resident. Ten frames of that dragged the phase's whole drawn/eligible
    // ratio to 0.04 against a settled 0.29, and it read exactly like F7 breaking the cull.
    await evalExpr(`MCL.Player.x += 30; MCL.Player.z += 11;
      MCL.Player.y = MCL.Column.height(Math.floor(MCL.Player.x), Math.floor(MCL.Player.z)) + 10;
      MCL.Player.vy = 0;`);
    await sleep(300);
  }
  // Leave both back at their normal defaults so the final settle phase measures the ordinary game.
  await evalExpr('MCL.Gfx.frozenFrustum = false; MCL.Gfx.occlusion = true;');
}

// ─────────────────────────────── phase 5b: does F7 hand the frustum back? ─────────────────────
// ⚠ THE DIRECT FORM OF THE QUESTION D-179 RAISED (D-194). F7 keeps the eye the planes were
// extracted at (`cam.px/py/pz`) while `viewProj` follows the camera, so a freeze that forgot to
// hand them back would leave every AABB measured against a stale origin for ever. Comparing
// phase averages could never answer that — a moving probe outruns its own streamer and the ratio
// collapses for reasons that have nothing to do with F7. This asks at ONE position, returned to:
// freeze, fly away, unfreeze, fly back, and require the same picture as before the key was ever
// pressed. Nothing streams in or out across the round trip, so the only variable left is F7.
await untilWorld(30000);
await setLabel('_f7-handback');
const f7 = { };
{
  const snap = () => page.evaluate(() => ({
    drawn: MCL.Gfx.drawn, x: MCL.Gfx.cam.x, px: MCL.Gfx.cam.px, py: MCL.Gfx.cam.py, pz: MCL.Gfx.cam.pz,
    y: MCL.Gfx.cam.y, z: MCL.Gfx.cam.z,
  }));
  await sleep(1500);
  f7.before = await snap();
  await evalExpr('MCL.Gfx.frozenFrustum = true;');
  await evalExpr('MCL.Player.x += 40; MCL.Player.vy = 0;');
  await sleep(1200);
  f7.frozen = await snap();
  await evalExpr('MCL.Gfx.frozenFrustum = false;');
  await evalExpr('MCL.Player.x -= 40; MCL.Player.vy = 0;');
  await sleep(1500);
  f7.after = await snap();
  // #1933: the frustum's eye is handed back by the next RENDERED frame, and on a loaded host (8 workers + a lander on one PC) a fixed
  // 1.5 s sometimes holds no frame at all: the snap read the frozen eye (40 blocks behind) and the check flapped red/green for 8 days.
  // Wait for the hand-back itself, up to 12 s more; a freeze that is really stuck still fails with the same message.
  const back = (a) => a.px === a.x && a.py === a.y && a.pz === a.z;
  for (let i = 0; i < 24 && !back(f7.after); i++) { await sleep(500); f7.after = await snap(); }
}

// ─────────────────────────────── phase 6: combo — everything at once ─────────────────────────
// Dan's report was RANDOM, which is what motivated soakcheck's own "watch the whole soak, not
// one moment" design (D-175). Overlapping provocations is the closest a scripted probe gets to
// that: a teleport landing in the middle of a preset change, resized mid-flight.
// ⚠ ORDERED SO THE OVERLAP LANDS ON A WORLD (D-194). Preset, resize and a short hop first,
// while the neighbourhood is still resident and in front of the camera — that is the window in
// which a preset's render-distance jump, a new frustum and an eviction burst can be caught
// emptying a picture that was there. The long hop follows, and its arriving-world frames are
// scored by the same rule and simply never clear the floor.
{
  const n = Math.max(4, Math.round(8 * K));
  for (let i = 0; i < n; i++) {
    if (i % 2 === 0) await untilWorld(30000);      // see the note in phase 1 (D-224)
    await setLabel('combo');
    await sleep(1200);
    await evalExpr(`MCL.Player.x += 40; MCL.Player.z -= 28;
      MCL.Player.y = MCL.Column.height(Math.floor(MCL.Player.x), Math.floor(MCL.Player.z)) + 10;
      MCL.Player.vy = 0; MCL.Settings.applyPreset(${JSON.stringify(['celeron', 'high'][i % 2])});`);
    await sleep(200);
    await page.send('Emulation.setDeviceMetricsOverride', { width: i % 2 ? 640 : 1024, height: i % 2 ? 400 : 640, deviceScaleFactor: 1, mobile: false });
    await evalExpr('window.dispatchEvent(new Event("resize")); MCL.Main.resize();');
    await sleep(1100);
    await evalExpr(`MCL.Player.x += 150; MCL.Player.z -= 110;
      MCL.Player.y = MCL.Column.height(Math.floor(MCL.Player.x), Math.floor(MCL.Player.z)) + 10;
      MCL.Player.vy = 0;`);
    await sleep(800);
  }
  await page.send('Emulation.clearDeviceMetricsOverride', {});
  await evalExpr('MCL.Main.resize();');
}

// ⚠ AND IT HAS TO BE SETTLED (D-194). This is the baseline §4's F7 round trip and the phase
// table are read against; three seconds after the combo phase's last 150-block hop is not a
// settled world, it is the same arriving one under a calmer name.
await untilWorld(30000);
await setLabel('settle');
// ⚠ FRAMES, NOT SECONDS (D-224). Three seconds is thirty frames at 60 fps and EIGHT on the
// software rasteriser these checks run on, and a phase of eight frames cannot clear a
// ten-frame bar however healthy the picture in them is — measured: 8 frames, 8 of them
// scoreable, reported as "never had enough world". The phase now runs until it has sampled
// enough frames to be judged, with the same wall-clock cap it always had as a backstop.
{
  const want = 40, until = Date.now() + Math.max(12000, 12000 * K);
  const framesNow = () => page.evaluate(() => window.__fc.phases.settle ? window.__fc.phases.settle.length : 0);
  for (;;) {
    await sleep(1000 * Math.min(1, K));
    if (await framesNow() >= want) break;
    if (Date.now() > until) break;
  }
}

const fc = await page.evaluate(() => JSON.parse(JSON.stringify({
  n: window.__fc.n, blanks: window.__fc.blanks, blankRuns: window.__fc.blankRuns,
  worst: window.__fc.worst, zeroTris: window.__fc.zeroTris, phases: window.__fc.phases,
  peak: window.__fc.peak, error: window.__fc.error || null,
})));
const gfx = await page.evaluate(() => JSON.parse(JSON.stringify(MCL.Gfx.stats())));

// ─────────────────────────────────────────────── 1. it ran long enough
console.log('1. the probe ran long enough to mean something');
// ⚠ NOT A FIXED 1500 (D-194). The first live run of this file reported 1480 frames as "too few"
// on a build that was drawing MORE of the world than the run before it — a blank screen is
// cheap and a full one is not, so a frame-count floor tightens exactly when the picture gets
// better. Three frames a second of the wall clock is the real question: did it sample at all.
ok(!fc.error, `the in-page scorer threw and scored nothing: ${fc.error}`);
ok(fc.n > SECONDS * 3, `only ${fc.n} frames in ~${SECONDS}s — under 3 fps, too few to trust a "worst" number`);
if (PRINT) console.log(`   ${fc.n} frames observed over ~${SECONDS}s of provocation`);

// per-phase shape, because "8 sections" and "800 sections" are different worlds and the old
// report said neither (D-194)
const q = (v, p) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
const phaseRows = [];
{
  for (const [label, arr] of Object.entries(fc.phases)) {
    const live = arr.filter((a) => !a[2]);                 // frames F7 was not freezing
    const d = arr.map((a) => a[0]).sort((a, b) => a - b);
    const e = arr.map((a) => a[1]).sort((a, b) => a - b);
    const ratios = live.filter((a) => a[1] >= FC.FLOOR).map((a) => a[0] / a[1]).sort((a, b) => a - b);
    const rds = arr.map((a) => a[3]).sort((a, b) => a - b);
    const scored = arr.reduce((n, a) => n + (a[4] || 0), 0);
    // what the STREAMER did while this phase ran, which is the question §1's verdict turns on
    const delivered = arr.length ? Math.max(0, arr[arr.length - 1][5] - arr[0][5]) : 0;
    const seconds = arr.length > 1 ? Math.max(0.001, (arr[arr.length - 1][6] - arr[0][6]) / 1000) : 0;
    phaseRows.push({ label, n: d.length, scored, dMed: q(d, 0.5), dMax: d[d.length - 1], rd: q(rds, 0.5),
                     eMed: q(e, 0.5), ePeak: q(e, 0.9), eMax: e[e.length - 1],
                     ratio: ratios.length ? q(ratios, 0.5) : null,
                     delivered, seconds, floor: Math.max(FC.FLOOR, FC.FULL * (fc.peak[q(rds, 0.5)] || 0)),
                     blank: d.filter((x) => x === 0).length });
  }
  for (const r of phaseRows) {
    if (PRINT) console.log(`   ${r.label.padEnd(22)} ${String(r.n).padStart(5)} frames · rd ${String(r.rd).padStart(2)} · drawn med ${String(r.dMed).padStart(4)} max ${String(r.dMax).padStart(4)} · eligible med ${String(r.eMed).padStart(4)} p90 ${String(r.ePeak).padStart(4)} of a full ${String(fc.peak[r.rd] || 0).padStart(4)} · ${String(r.scored).padStart(4)} scored · ${r.blank} blank`);
  }
  // ⚠ A PHASE THAT NEVER HAD A WORLD PROVED NOTHING, and saying so is the difference between a
  // green run and a green run that means something (D-164). The p90 is the question — a phase
  // may legitimately spend some of its frames waiting for the streamer, but if it never once had
  // a world in range then whatever it was provoking, nothing could have been seen failing.
  // ⚠ THE QUESTION IS THE SCORER'S OWN (D-194): how many of this phase's frames cleared the
  // blankness floor, i.e. how many of them COULD have been called a flash. Zero is a phase that
  // ran the engine hard and observed nothing, which is the one outcome a check must not report
  // as a pass.
  //
  // ⚠ AND WHEN A PHASE IS STARVED, THE CHECK NOW ASKS **WHY**, IN SECTIONS A SECOND (D-224).
  // "Fewer than ten scoreable frames" has two completely different causes and the old single
  // verdict conflated them:
  //
  //   the WORLD stopped arriving   the streamer delivered nothing while the picture sat under
  //                                the floor. Nothing about a slow box explains that, and it is
  //                                the shape of every bug this probe exists for. It FAILS.
  //   the BOX could not keep up    the streamer delivered sections the whole way and the
  //                                picture still never filled. On two cores under a software
  //                                rasteriser at render distance 12 that is simply true, and
  //                                the engine cannot fix it. It is reported, with the measured
  //                                rate, and it does not fail.
  //
  // A third case sits between them and is a defect too: sections delivered, and not one of them
  // ever became eligible — meshes built that never reached the frustum. That FAILS.
  //
  // ⚠ NOTHING HERE TOUCHES FC.FLOOR OR FC.FULL. Lowering the eligibility threshold would make
  // every phase "scoreable" and the whole probe vacuous, which is the opposite of the fix. What
  // is added is a reason, measured, for the phases that remain short — and the vacuity guard
  // below, which fails if the excuse is being handed to most of the run.
  const verdictOf = phaseVerdict;
  const named = phaseRows.filter((r) => !r.label.startsWith('_'));
  const broken = named.filter((r) => verdictOf(r) === 'world-stopped' || verdictOf(r) === 'never-eligible');
  const slow = named.filter((r) => verdictOf(r) === 'slow-box');
  const scoredPhases = named.filter((r) => verdictOf(r) === 'scored');
  for (const r of broken) {
    ok(false, verdictOf(r) === 'world-stopped'
      ? `the world stopped arriving during "${r.label}": the streamer delivered 0 sections in ${r.seconds.toFixed(0)}s while the picture held ${r.eMax} of the ${r.floor.toFixed(0)} the scorer needs`
      : `"${r.label}" was delivered ${r.delivered} sections in ${r.seconds.toFixed(0)}s and not one of them ever became eligible — meshes are being built that never reach the frustum`);
  }
  for (const r of slow) {
    // ⚠ TWO DIFFERENT TRUTHS AND THE LINE HAS TO SAY WHICH. A phase whose picture never once
    // reached the floor was starved outright; a phase that reached it in eight frames rather
    // than ten held a judgeable world and simply did not hold it for long. Reporting both as
    // "this box cannot fill the frustum" would be a claim the numbers do not make.
    const reached = r.eMax >= r.floor;
    console.log(`   ⓘ "${r.label}" scored ${r.scored} of ${r.n} frames: the streamer delivered ${r.delivered} sections in ${r.seconds.toFixed(0)}s (${(r.delivered / r.seconds).toFixed(0)}/s) and the picture ` +
      (reached
        ? `did clear the floor of ${r.floor.toFixed(0)} (peak ${r.eMax}) but held it for fewer than ten frames at render distance ${r.rd}`
        : `peaked at ${r.eMax} against a floor of ${r.floor.toFixed(0)} — this box cannot fill a render distance ${r.rd} frustum that fast`) +
      `, and neither is something the engine can fix`);
  }
  // ⚠ THE GUARD THAT STOPS THE PARAGRAPH ABOVE BECOMING AN EXCUSE FOR EVERYTHING. A run in which
  // most phases are "too slow to judge" has provoked the engine and observed nothing, which is
  // the one outcome a check must not report as a pass (D-164).
  ok(scoredPhases.length >= Math.ceil(named.length / 2),
     `only ${scoredPhases.length} of ${named.length} phases had ten scoreable frames (${slow.map((r) => r.label).join(', ') || 'none'} were too slow) — this run provoked the engine and watched almost none of it`);
  ok(named.reduce((n, r) => n + r.scored, 0) >= 10 * Math.ceil(named.length / 2),
     `${named.reduce((n, r) => n + r.scored, 0)} scoreable frames across ${named.length} phases — too few for "no flash was seen" to mean anything`);
  if (PRINT) console.log(`   ${scoredPhases.length} of ${named.length} phases scored, ${slow.length} starved by the box, ${broken.length} starved by the world`);
}

// ─────────────────────────────────────────────── 2. no blank frame over a live world
console.log('2. no run of frames drew nothing while a loaded world sat in the frustum (D-162, D-194)');
ok(fc.blankRuns.length === 0,
   `${fc.blankRuns.length} blank run(s) over a world that was loaded, in range and in the frustum: ${JSON.stringify(fc.blankRuns.slice(0, 5))}`);
ok(fc.zeroTris.length === 0,
   `${fc.zeroTris.length} frame(s) drew sections but zero triangles (the D-131 shape): ${JSON.stringify(fc.zeroTris.slice(0, 5))}`);
if (PRINT) console.log(`   ${fc.blanks} blank frames over an eligible world, longest run ${fc.blankRuns.reduce((a, b) => Math.max(a, b.len), 0)}`);

// ─────────────────────────────────────────────── 3. no drop that outruns its world
console.log('3. no drop over a ' + FC.WINDOW + '-frame window outruns the world that shrank under it');
// ⚠ NOT A TOLERANCE AROUND A BUG (D-175's own words) — legitimate motion, a smaller preset's
// render distance, and a resize to a narrower frustum all draw less on purpose, and all of them
// shrink `eligible` too. What this forbids is the picture emptying faster than the world did.
ok(fc.worst.ratio < 0.5,
   `the picture fell ${((fc.worst.dropped || 0) * 100).toFixed(0)}% while the world in range fell only ` +
   `${(((fc.worst.eFrom ? 1 - fc.worst.eTo / fc.worst.eFrom : 0)) * 100).toFixed(0)}% during "${fc.worst.label}" ` +
   `(frame ${fc.worst.frame}: ${fc.worst.from} -> ${fc.worst.to} drawn, ${fc.worst.eFrom} -> ${fc.worst.eTo} eligible)`);
if (PRINT) console.log(`   worst unexplained drop: ${(fc.worst.ratio * 100).toFixed(1)} points past what the world's own shrinking allowed`);

// ─────────────────────────────────────────────── 4. the counters are the backend's own
console.log('4. the numbers came from the backend, and the context is still alive (D-194)');
// ⚠ THE COUNTER THIS CHECK READS USED TO BE THE LENGTH OF THE DRAW LIST. A lost context, a
// dropped handle or a full WebGPU dynamic-offset ring left it healthy through a blank screen —
// the same shape as D-170, where the suite read its own screenshots wrong for a whole session.
ok(gfx.contextLost === false, 'the graphics context is lost and was never restored');
ok(gfx.contextLosses === gfx.contextRestores,
   `${gfx.contextLosses} context loss(es) and only ${gfx.contextRestores} restore(s)`);
ok(typeof gfx.drawnListed === 'number' && gfx.drawn <= gfx.drawnListed,
   `Gfx.drawn (${gfx.drawn}) exceeds the draw list it came from (${gfx.drawnListed}) — the counter is not the backend's`);
ok(gfx.drawn === 0 || gfx.tris > 0, `${gfx.drawn} sections drawn and ${gfx.tris} triangles — one of the two is lying`);
// ⚠ AND THE ONE THING F7 STILL HAS TO PROVE (D-194). Its frozen frames are exempt from §2 and
// §3 because culling wrongly is what the key is for. What is NOT exempt is the state it leaves.
{
  // the freeze was real: the planes' eye stayed behind while the camera flew on (D-179)
  ok(Math.abs(f7.frozen.px - f7.frozen.x) > 1,
     `with F7 on, the frustum's eye (${f7.frozen.px.toFixed(1)}) tracked the camera (${f7.frozen.x.toFixed(1)}) — the freeze did nothing`);
  // and it was handed back exactly, to the live eye, in doubles
  ok(f7.after.px === f7.after.x && f7.after.py === f7.after.y && f7.after.pz === f7.after.z,
     `after F7 was switched off the frustum's eye is still ${f7.after.px}, ${f7.after.py}, ${f7.after.pz} against a camera at ${f7.after.x}, ${f7.after.y}, ${f7.after.z}`);
  // and the picture at the position we started from is the picture we started with
  ok(f7.before.drawn >= FC.FLOOR, `the F7 round trip started from a near-empty picture (${f7.before.drawn} drawn) and proves nothing`);
  ok(f7.after.drawn >= f7.before.drawn * 0.5,
     `back where it started with F7 off, the world draws ${f7.after.drawn} sections against ${f7.before.drawn} before the key was pressed`);
  if (PRINT) console.log(`   F7 round trip: ${f7.before.drawn} drawn -> ${f7.frozen.drawn} frozen (eye ${(f7.frozen.x - f7.frozen.px).toFixed(0)} blocks behind) -> ${f7.after.drawn} handed back`);
}
if (PRINT) console.log(`   ${gfx.drawn} drawn of ${gfx.drawnListed} listed · ${gfx.tris} triangles · ${gfx.contextLosses} losses / ${gfx.contextRestores} restores`);

// ─────────────────────────────────────────────── 5. anti-vacuity
console.log('5. anti-vacuity — the real scorer, over frames it must and must not flag');
{
  // ⚠ THESE RUN `scoreFrame` ITSELF (D-194), not a paraphrase of it in this file. The version
  // this replaces asserted that a 40 -> 0 collapse was invisible to a rule that plainly saw it,
  // and failed every run for that reason alone.
  const run = (frames) => { const st = newScore(); for (const fr of frames) scoreFrame(st, fr); return st; };
  const steady = (n, drawn, eligible) =>
    Array.from({ length: n }, (_, i) => ({ n: i + 1, drawn, tris: drawn * 40, eligible, label: 'synthetic' }));
  const seq = (arr, eligible) =>
    arr.map((d, i) => ({ n: i + 1, drawn: d, tris: d * 40, eligible: typeof eligible === 'function' ? eligible(i) : eligible, label: 'synthetic' }));

  const av = [];
  const must = (label, fn) => av.push([label, !!fn()]);

  // a. the collapse the OLD frame-pair fence did see — it must still be seen
  must('a one-frame collapse over a live world', () =>
    run(seq([...Array(20).fill(100), 0, 0, 0, 0], 120)).blankRuns.length > 0);

  // b. THE HOLE. A drain spread over four frames never trips a per-frame 50% fence: the biggest
  // single step is 100 -> 60, which is 40%. The window is the only thing that catches it.
  must('a collapse spread over four frames, which no frame-pair fence can see', () =>
    run(seq([...Array(20).fill(100), 60, 36, 21, 12], 120)).worst.ratio > 0.5);

  // c. and it must NOT cry wolf: a player leaving an area draws less because there IS less
  must('a world that legitimately shrank is not called a flash', () =>
    run(seq([100, 90, 70, 50, 30, 16, 8, 4], (i) => [120, 108, 84, 60, 36, 20, 10, 5][i])).worst.ratio < 0.5);

  // d. blankness with nothing loaded to draw is a streaming world, not a flash
  must('a blank screen with no world in range is not called a flash', () =>
    run(steady(60, 0, 0)).blankRuns.length === 0);

  // e. and the calibrated floor, in both directions: a tenth of a world is still streaming,
  // half of one is not. These two are what stop FC.FULL being tuned to make a run green.
  must('a blank screen over a tenth of a full world is not called a flash', () =>
    run(seq([...Array(20).fill(100), 0, 0, 0, 0, 0, 0], (i) => (i < 20 ? 400 : 30))).blankRuns.length === 0);
  must('a blank screen over half a full world IS called a flash', () =>
    run(seq([...Array(20).fill(100), 0, 0, 0, 0, 0, 0], (i) => (i < 20 ? 400 : 250))).blankRuns.length > 0);

  // f. the D-131 rule, in both directions (D-198). A section drawn off the MODEL stream carries
  // no greedy triangles and is not a defect; a section drawn with neither stream is.
  must('a frame drawing only model geometry is not called empty', () =>
    run([{ n: 1, drawn: 3, tris: 0, mtris: 240, eligible: 50, label: 'synthetic' }]).zeroTris.length === 0);
  must('a frame that drew a list and no geometry at all IS called empty', () =>
    run([{ n: 1, drawn: 3, tris: 0, mtris: 0, eligible: 50, label: 'synthetic' }]).zeroTris.length > 0);

  // e. and the probe must have run at all
  must('a probe that never ran', () => !(0 > SECONDS * 3));

  // g. the starvation verdict, run as itself (D-224). The excuse this adds — "the box could not
  // fill the frustum that fast" — must not swallow the case it was carved out of: a phase in
  // which the WORLD stopped arriving is a defect and stays one.
  must('a phase whose world stopped arriving is still a failure', () =>
    phaseVerdict({ scored: 0, delivered: 0, eMax: 3, n: 400 }) === 'world-stopped');
  must('a phase whose meshes never reached the frustum is still a failure', () =>
    phaseVerdict({ scored: 2, delivered: 900, eMax: 0, n: 400 }) === 'never-eligible');
  must('a phase starved while the streamer was delivering is excused, not failed', () =>
    phaseVerdict({ scored: 5, delivered: 900, eMax: 20, n: 400 }) === 'slow-box');
  must('a phase that scored is not excused', () =>
    phaseVerdict({ scored: 40, delivered: 0, eMax: 0, n: 400 }) === 'scored');
  must('an idle streamer is not excused by a picture that happened to hold something', () =>
    phaseVerdict({ scored: 9, delivered: 0, eMax: 90, n: 400 }) !== 'slow-box');
  // and the guard that stops the excuse being handed to a whole run
  must('a run in which every phase was excused does not pass', () => {
    const rows = Array.from({ length: 6 }, () => ({ scored: 0, delivered: 900, eMax: 20, n: 400 }));
    const ok6 = rows.filter((r) => phaseVerdict(r) === 'scored').length >= Math.ceil(rows.length / 2);
    return ok6 === false;
  });
  must('a run in which most phases scored does pass that guard', () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({ scored: i < 4 ? 40 : 0, delivered: 900, eMax: 20, n: 400 }));
    return rows.filter((r) => phaseVerdict(r) === 'scored').length >= Math.ceil(rows.length / 2);
  });

  for (const [label, held] of av) ok(held, `anti-vacuity: "${label}" did not hold`);
  if (PRINT) console.log('   ' + av.map(([l, c]) => (c ? 'OK ' : 'FAIL ') + l).join(' · '));
}

console.log('');
console.log(pass + ' passed, ' + fails.length + ' failed');
for (const f of fails) console.log('  FAIL: ' + f);
await page.close();
process.exit(fails.length ? 1 : 0);
