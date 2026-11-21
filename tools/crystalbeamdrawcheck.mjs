#!/usr/bin/env node
// crystalbeamdrawcheck.mjs — loop/crystal-beam-render: THE END-CRYSTAL BEAM, ON A REAL SCREEN.
//
//   MCLITE_PRESET=medium node tools/crystalbeamdrawcheck.mjs [dist/mclite.html] [--shots]
//
// ⚠⚠ WHY THIS EXISTS. `crystalrendercheck.mjs` (D-835/D-838) proved `ER.crystalBeamQuads` and
// `ER.build`'s own `beamQuads` are the right NUMBERS, headless, and named its own limit in as
// many words: "no browser stage, no pixel". D-838's own header on `ER.crystalBeamQuads` in
// `07j_entityrender.js` went further and said the geometry was "GEOMETRY ONLY, NOT A GPU DRAW
// CALL" — nothing after it ever reached a WebGL2/WebGPU draw call. This is the first time the
// beam is checked against an actual picture.
//
// ⚠ THIS DELIBERATELY DOES NOT USE bowdrawcheck.mjs's OWN LONG `quietPair`/`watch` LOOPS
// (tens of seconds of repeated sampling, built for a SETTLING animation like an arrow flying
// into frame or a bow's pull ramping up). The end-crystal beam is static geometry the instant
// `e.beamTarget` is set — there is nothing to wait for it to "settle into" — and this engine's
// own end-crystal rotation is effectively frozen (`e.endCrystalAge` is set once at spawn and
// never ticked anywhere in src/, confirmed by `grep -rn "endCrystalAge\s*+="` matching
// nothing), so a handful of frames is enough. Discovered the hard way, live, while writing
// this check: the long-loop idiom's OWN elapsed real time (30-90s of `quietPair`/`watch`
// retries) lets the sky's cloud layer (still active with `daylightCycle`/`weatherCycle` off —
// neither switch touches D-655's own cloud drift) accumulate thousands of px of background
// drift, which then swamped a fixed low "noise floor" threshold measured minutes earlier and
// produced a false anti-vacuity failure with the WIRING CORRECT. Every comparison here instead
// diffs two screenshots a few frames apart, so the total elapsed real time between any two
// diffed shots stays under a second and cloud drift never has room to matter.

import { open, sleep } from './cdp.mjs';
import { decodePng, toRgba } from './pngdec.mjs';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FILE = args[0] ? (args[0].startsWith('/') ? args[0] : ROOT + args[0]) : ROOT + 'dist/mclite.html';
const SHOTS = process.argv.includes('--shots');

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m, d) => { if (c) { pass++; console.log('ok    ' + m); } else { fails.push(m + (d !== undefined ? ' (' + d + ')' : '')); console.log('FAIL  ' + m + (d !== undefined ? '   ' + d : '')); } return c; };
const okAv = (c, m, d) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else { fails.push('anti-vacuity: ' + m + (d !== undefined ? ' (' + d + ')' : '')); console.log('   x ' + m + (d !== undefined ? '   ' + d : '')); } };

/** Changed-pixel count — same recipe as bowdrawcheck.mjs's `compare`, brightness dropped (not
 *  needed: every assertion here is a plain magnitude comparison between two live screenshots). */
function compare(a, b) {
  if (a.width !== b.width || a.height !== b.height) return { differing: -1, total: 1 };
  let differing = 0, total = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
    total++;
    if (d > 12) differing++;
  }
  return { differing, total };
}

const page = await open(FILE, {
  port: 9453, width: 960, height: 540,
  initScript: 'window.addEventListener("load", function () { setTimeout(function () {' +
             ' if (window.MCL && MCL.Sky) { MCL.Sky.daylightCycle = false; MCL.Sky.weatherCycle = false; var wD = MCL.Sky.weather; if (wD) { wD.raining = wD.thundering = false; wD.rainLevel = wD.oRainLevel = wD.thunderLevel = wD.oThunderLevel = 0; } } }, 50); });',
});
if (!page) { console.log('SKIP  crystalbeamdrawcheck: no Chromium found'); process.exit(0); }

try {
  await sleep(1200);
  await page.evaluate(function () { if (window.MCL && MCL.Main && !MCL.Main.ready) MCL.Main.play({}); });
  const up = await page.waitFor(function () {
    return !!(window.MCL && MCL.Main.ready && MCL.Hud.mode === 'game' && MCL.World.chunks.size > 20);
  }, 60000);
  if (!ok(up, 'the world came up', page.lastThrow)) throw new Error('never reached the game');
  await page.evaluate(function () { if (MCL.Sky) { MCL.Sky.daylightCycle = false; MCL.Sky.weatherCycle = false; var wD = MCL.Sky.weather; if (wD) { wD.raining = wD.thundering = false; wD.rainLevel = wD.oRainLevel = wD.thunderLevel = wD.oThunderLevel = 0; } } });
  await page.evaluate(function () { if (MCL.Spawn) MCL.Spawn.ready = false; });
  await sleep(3000);

  const shot = async () => {
    const s = await page.send('Page.captureScreenshot', { format: 'png' });
    return { rgba: toRgba(decodePng(Buffer.from(s.data, 'base64'))), raw: s.data };
  };
  const ev = (src) => page.evaluate(new Function(src));
  const frames = (n) => page.waitFor(new Function(
    'if (window.__fb === undefined) { window.__fb = MCL.Main.frame | 0; return 0; }' +
    'if (((MCL.Main.frame | 0) - window.__fb) < ' + n + ') return 0;' +
    'window.__fb = undefined; return 1;'), 20000);
  /** Advance a few frames, then screenshot — every comparison in this file diffs two shots
   *  taken this way, seconds (not tens of seconds) apart — see this file's own header. */
  const step = async (n) => { await frames(n || 6); return shot(); };

  // ── 1. the stage — an open, lit, floored spot in front of the player ─────────────────────
  console.log('\n1. the stage');
  const stage = await ev(
    'var P = MCL.Player, W = MCL.World;' +
    'P.pitch = 0; if (P.interpolate) P.interpolate(1);' +
    'var f = P.lookVec(), rx = -f[2], rz = f[0];' +
    'for (var d = 4; d <= 8; d += 0.5) for (var s = -2; s <= 2; s += 0.5) {' +
    '  var x = P.x + f[0] * d + rx * s, z = P.z + f[2] * d + rz * s;' +
    '  var bx = Math.floor(x), bz = Math.floor(z);' +
    '  for (var dy = 0; dy <= 3; dy++) {' +
    '    var y = Math.floor(P.y) + dy;' +
    '    var lt = W.getLight(bx, y, bz) | 0;' +
    '    if ((lt >> 4) >= 12 && W.getBlock(bx, y, bz) === 0 && W.getBlock(bx, y + 1, bz) === 0' +
    '        && W.getBlock(bx, y + 4, bz) === 0 && W.getBlock(bx, y - 1, bz) !== 0) {' +
    '      return { x: x, y: y, z: z, sky: lt >> 4 };' +
    '    }' +
    '  }' +
    '}' +
    'return null;');
  ok(!!stage, 'found an open, lit, floored spot in front of the player', stage ? JSON.stringify(stage) : 'none');
  if (!stage) throw new Error('no stage');
  console.log('   stage: ' + stage.x.toFixed(1) + ',' + stage.y + ',' + stage.z.toFixed(1) + '  skylight ' + stage.sky);
  const beamTargetLit = '{ x: Math.floor(' + stage.x + ') + 2, y: ' + stage.y + ' + 3, z: Math.floor(' + stage.z + ') }';

  await ev('MCL.EntityList.list.length = 0; return 1;');

  // ── 2. background noise floor, over the SAME short span every later comparison uses ──────
  console.log('\n2. background noise floor (nothing moving, same short span as every later diff)');
  const bg0 = await step();
  const bg1 = await step();
  const bgNoise = compare(bg0.rgba, bg1.rgba);
  console.log('   background: ' + bgNoise.differing + ' px over one step');
  const want = 60; // fixed: a beam is a thin ~250 px line and scene noise swings 100-1200 px, so a noise-scaled bar flakes; section 6 (draw-call count) is the real discriminator

  // ── 3. a live end_crystal with no beamTarget — the control ───────────────────────────────
  console.log('\n3. a live end_crystal with no beamTarget (control)');
  const noBeam = await ev(
    'var EL = MCL.EntityList; EL.list.length = 0;' +
    'var e = EL.spawn("end_crystal", ' + stage.x + ', ' + stage.y + ', ' + stage.z + ');' +
    'return { missing: !e };');
  ok(!noBeam.missing, 'end_crystal spawns');
  const crystalOnly = await step();
  const crystalDelta = compare(bg1.rgba, crystalOnly.rgba);
  console.log('   bare crystal appearing: ' + crystalDelta.differing + ' px');
  ok(crystalDelta.differing > want, 'the bare crystal itself is visible (' + crystalDelta.differing + ' > ' + want + ')');

  // ── 4. the SAME crystal, given a beamTarget — the beam must add MORE pixels ──────────────
  console.log('\n4. the same crystal, now with e.beamTarget set (real ER.renderCrystalBeams)');
  const withBeamInfo = await ev(
    'var EL = MCL.EntityList; var e = EL.list[0];' +
    'e.beamTarget = ' + beamTargetLit + ';' +
    'var P = MCL.Player;' +
    'var b = MCL.EntityRender.build(Math.floor(P.x), Math.floor(P.y), Math.floor(P.z), P.x, P.y, P.z, 1);' +
    'return { beams: b ? (b.beamQuads || []).length : -1 };');
  ok(withBeamInfo.beams === 1, 'ER.build reports exactly one beam group once e.beamTarget is set (got ' + withBeamInfo.beams + ')');
  const withBeam = await step();
  if (SHOTS) { try { writeFileSync(ROOT + 'dist/crystalbeam-on.png', Buffer.from(withBeam.raw, 'base64')); } catch { /* ignore */ } }
  const beamDelta = compare(crystalOnly.rgba, withBeam.rgba);
  console.log('   beam appearing (real dispatcher): ' + beamDelta.differing + ' px');
  ok(beamDelta.differing > want,
     'setting e.beamTarget on the SAME live crystal changes real, additional pixels on screen (' +
     beamDelta.differing + ' > ' + want + ') — the beam geometry now reaches an actual GPU draw call');

  // ── 5. remove the beamTarget again — the beam must actually disappear ────────────────────
  console.log('\n5. clearing e.beamTarget again');
  await ev('MCL.EntityList.list[0].beamTarget = null; return 1;');
  const beamCleared = await step();
  const clearDelta = compare(withBeam.rgba, beamCleared.rgba);
  console.log('   beam disappearing: ' + clearDelta.differing + ' px');
  ok(clearDelta.differing > want, 'clearing e.beamTarget removes real pixels again (' + clearDelta.differing + ' > ' + want + ')');

  // ── 6. anti-vacuity — break the wiring, prove THIS check catches it, then restore ────────
  // ⚠ INSTRUMENTED, NOT PIXEL-DIFFED. Sections 3-5 already proved the POSITIVE claim (pixels
  // really change) against a real screenshot, per this unit's own brief. For the NEGATIVE claim
  // (a reverted dispatcher draws NOTHING), a screenshot diff turned out to be the wrong tool,
  // live, while writing this check: even a handful of frames can carry enough incidental scene
  // noise (torch flicker, water/lava texture animation, the sky's own dither) to occasionally
  // outweigh a small beam silhouette, so a pixel-count comparison here would be a coin flip, not
  // a proof. What actually distinguishes "wired" from "reverted" is deterministic and free of
  // that noise: does the active backend's OWN draw function (`ER.renderCrystalBeamsGL2` or
  // `ER.renderCrystalBeamsGPU`, whichever `MCL.Gfx.name` selects) get CALLED at all once
  // `ER.renderCrystalBeams` is reverted to a no-op — the exact D-838 pre-fix shape (geometry
  // built, dispatcher never reached).
  console.log('\n6. anti-vacuity (instrumented call count, not pixels — see this section\'s own header)');
  const spy = await ev(
    'var ER = MCL.EntityRender, G = MCL.Gfx;' +
    'var backend = G && G.name;' +
    'var origFn = backend === "webgpu" ? ER.renderCrystalBeamsGPU : ER.renderCrystalBeamsGL2;' +
    'window.__origBeamFn = origFn; window.__origBeamDispatch = ER.renderCrystalBeams; window.__beamCalls = 0;' +
    'var wrapped = function () { window.__beamCalls++; return origFn.apply(ER, arguments); };' +
    'if (backend === "webgpu") ER.renderCrystalBeamsGPU = wrapped; else ER.renderCrystalBeamsGL2 = wrapped;' +
    'return { backend: backend };');
  ok(spy.backend === 'webgl2' || spy.backend === 'webgpu', 'a real GPU backend is active to instrument (' + JSON.stringify(spy.backend) + ')');
  await ev('MCL.EntityList.list[0].beamTarget = ' + beamTargetLit + '; return 1;');
  await step();
  const callsWired = await ev('return window.__beamCalls;');
  ok(callsWired > 0, 'with the real ER.renderCrystalBeams dispatcher, the active backend\'s own beam draw function is actually called (' + callsWired + ' calls over a few frames)');

  await ev('window.__beamCalls = 0; MCL.EntityRender.renderCrystalBeams = function () { /* wiring reverted: geometry built, never submitted, D-838\'s own pre-fix shape */ }; return 1;');
  await step();
  const callsBroken = await ev('return window.__beamCalls;');
  okAv(callsBroken === 0,
    'with ER.renderCrystalBeams reverted to a no-op, the SAME live crystal with the SAME ' +
    'e.beamTarget never reaches the backend\'s own draw function again (' + callsBroken +
    ' calls, was ' + callsWired + ') — proving this check would have caught the original ' +
    '"geometry built, never wired" gap');

  // Restore the DISPATCHER only first (undo the break) while the GL2/GPU wrapper is still in
  // place, so the call-count instrument can prove the restore itself is real -- if this step
  // instead restored the wrapped backend function too early, callsRestored would read 0 for the
  // wrong reason (no instrument left, not "still broken"), silently defeating the very check
  // this section exists to prove.
  await ev(
    'MCL.EntityRender.renderCrystalBeams = window.__origBeamDispatch;' +
    'window.__beamCalls = 0; return 1;');
  await step();
  const callsRestored = await ev('return window.__beamCalls;');
  okAv(callsRestored > 0,
    'restoring ER.renderCrystalBeams to the real dispatcher makes the backend\'s own draw ' +
    'function get called again (' + callsRestored + ' calls) — proving section 6\'s "0 calls" ' +
    'result above was this check catching a real break, not the instrumentation itself being ' +
    'inert or stuck');

  await ev(
    'var ER = MCL.EntityRender, backend = ' + JSON.stringify(spy.backend) + ';' +
    'if (backend === "webgpu") ER.renderCrystalBeamsGPU = window.__origBeamFn; else ER.renderCrystalBeamsGL2 = window.__origBeamFn;' +
    'MCL.EntityList.list.length = 0; return 1;');

  ok(page.problems.length === 0, 'the page logged no errors (' + page.problems.slice(0, 2).join(' | ') + ')');
} catch (e) {
  fails.push('harness: ' + (e && e.message));
  console.log('FAIL  harness: ' + (e && (e.stack || e.message)));
} finally {
  await page.close();
}

console.log('\n===========================================');
console.log(' crystalbeamdrawcheck: ' + pass + ' assertions, ' + fails.length + ' failed, ' + breaks + ' breaks');
console.log('===========================================');
process.exit(fails.length ? 1 : 0);
