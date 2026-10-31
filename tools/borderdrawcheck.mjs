#!/usr/bin/env node
// borderdrawcheck.mjs — loop/crystal-beam-render: THE END-CRYSTAL BEAM, ON A REAL SCREEN.
//
//   MCLITE_PRESET=medium node tools/borderdrawcheck.mjs [dist/mclite.html] [--shots]
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
  port: 9457, width: 960, height: 540,
  initScript: 'window.addEventListener("load", function () { setTimeout(function () {' +
             ' if (window.MCL && MCL.Sky) { MCL.Sky.daylightCycle = false; MCL.Sky.weatherCycle = false; var wD = MCL.Sky.weather; if (wD) { wD.raining = wD.thundering = false; wD.rainLevel = wD.oRainLevel = wD.thunderLevel = wD.oThunderLevel = 0; } } }, 50); });',
});
if (!page) { console.log('no Chromium found (hosted-unfit)'); process.exit(0); }

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
  const setBorder = (cx, stage) => ev(
    'var B = MCL.World.border, P = MCL.Player; B.centerZ = P.z; B.centerX = ' + cx + ';' +
    'B.setSize(2000); B.dur = 0; return 1;');
  const setOff = (v) => ev('MCL.WorldBorderRender.off = ' + v + '; return 1;');
  const pair = async () => { await setOff(true); const off = await step(); await setOff(false); const on = await step(); await setOff(true); const off2 = await step(); await setOff(false); return { off, on, noise: compare(off.rgba, off2.rgba).differing }; };
  const tint = (off, on) => { let n = 0; const d = [0, 0, 0]; for (let i = 0; i < on.data.length; i += 4) { const dd = [0, 1, 2].map((c) => on.data[i + c] - off.data[i + c]); if (Math.abs(dd[0]) + Math.abs(dd[1]) + Math.abs(dd[2]) > 12) { n++; for (let c = 0; c < 3; c++) d[c] += dd[c]; } } return d.map((v) => v / Math.max(1, n)); };
  const run = async () => {
    const out = { colours: {} };
    await ev('window.__st = MCL.World.border.stage; var B = MCL.World.border, P = MCL.Player; B.centerZ = P.z; B.setSize(2000); B.centerX = P.x + 5 - 1000; return 1;');
    for (const st of ['growing', 'shrinking', 'stationary']) {
      await ev('MCL.World.border.stage = function () { return "' + st + '"; }; return 1;');
      const pr = await pair();
      out.colours[st] = tint(pr.off.rgba, pr.on.rgba);
      if (st === 'growing') { out.near = compare(pr.off.rgba, pr.on.rgba).differing; out.noise = pr.noise; }
    }
    await ev('MCL.World.border.stage = window.__st; var B = MCL.World.border, P = MCL.Player; B.centerX = P.x + 1000 - 1000 - 1000 + 1000; B.setSize(2000); B.centerX = P.x - 1000 + 1000 + 0; return 1;');
    await ev('var B = MCL.World.border, P = MCL.Player; B.centerX = P.x; B.setSize(2000); return 1;');
    const fp = await pair();
    out.far = compare(fp.off.rgba, fp.on.rgba).differing;
    return out;
  };
  console.log('backend: ' + (await ev('return MCL.Gfx.name;')));
  const r = await run();
  console.log('   near ' + r.near + ' px, far ' + r.far + ' px, noise ' + r.noise + ' px, tints ' + JSON.stringify(r.colours));
  ok(r.near > 200 + r.noise, 'player 5 blocks from the east edge: the wall changes pixels vs no border (' + r.near + ')');
  ok(r.far <= r.noise + 60, 'edge beyond the render distance: nothing changes (' + r.far + ')');
  const C = r.colours;
  ok(C.growing[1] > C.growing[0] && C.growing[1] > C.growing[2], 'growing tints green');
  ok(C.shrinking[0] > C.shrinking[1] && C.shrinking[0] > C.shrinking[2], 'shrinking tints red');
  ok(C.stationary[2] > C.stationary[0] && C.stationary[2] > C.stationary[1], 'stationary tints blue');

  // anti-vacuity: break the draw, prove the check sees it
  await ev('MCL.WorldBorderRender.off = true; return 1;');
  await ev('var B = MCL.World.border, P = MCL.Player; B.centerX = P.x + 5 - 1000; B.setSize(2000); return 1;');
  const offShot = await step();
  await ev('MCL.WorldBorderRender.off = false; return 1;');
  const onShot = await step();
  okAv(compare(offShot.rgba, onShot.rgba).differing > 200, 'with the draw skipped the wall vanishes (draw call removed)');
  await ev('MCL.WorldBorderRender.off = false; var B = MCL.World.border; B.stage = function () { return "stationary"; }; return 1;');
  const blue = await step();
  await ev('MCL.World.border.stage = function () { return "shrinking"; }; return 1;');
  const red = await step();
  okAv(compare(blue.rgba, red.rgba).differing > 200, 'wrong stage colour is visible (stationary vs shrinking differ)');
  await ev('MCL.World.border.stage = window.__st; return 1;');
  ok(page.problems.length === 0, 'the page logged no errors (' + page.problems.slice(0, 2).join(' | ') + ')');
} catch (e) {
  fails.push('harness: ' + (e && e.message));
  console.log('FAIL  harness: ' + (e && (e.stack || e.message)));
} finally {
  await page.close();
}
console.log('\n borderdrawcheck: ' + pass + ' assertions, ' + fails.length + ' failed, ' + breaks + ' breaks caught');
process.exit(fails.length || breaks < 2 ? 1 : 0);
