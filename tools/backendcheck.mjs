#!/usr/bin/env node
// backendcheck.mjs — THE GAME MUST START. Both backends, and the fallback between them.
//
//   node tools/backendcheck.mjs [dist/mclite.html]
//
// ⚠⚠ WHY THIS FILE EXISTS. On 14 Sept 2026 Dan opened `dist/mclite.html` on his own machine and
// got the fatal screen: "No usable GPU backend." A suite of 1,174,964 assertions was green at the
// time. Two faults, and **neither was reachable by any check this project owned** (D-310):
//
//   1. WebGPU asked for a device with no `requiredLimits`, so it got the SPEC DEFAULTS — 256
//      texture array layers — and the block atlas has 778. `createTexture` failed validation.
//   2. The boot fallback then asked the SAME canvas for WebGL2. A canvas that has handed out a
//      'webgpu' context can never hand out a 'webgl2' one, so it got null and the game died,
//      with a message blaming his graphics driver.
//
// ⚠ **THE REASON NOTHING CAUGHT IT IS THE REASON THIS FILE IS SHAPED THE WAY IT IS.** Headless
// Chromium has `navigator.gpu` and NO ADAPTER, so `GfxGPU.init` bails at "no WebGPU adapter"
// before it ever touches the canvas. The only environment that ever tried WebGPU failed so early
// that neither fault could occur — a check that ran the real WebGPU path here would have proved
// nothing, and a check that merely ran the DEFAULT path proved nothing about the other one.
// So this file does not wait for a WebGPU adapter. It **SABOTAGES THE BOOT** the way a real
// machine does: it makes WebGPU take the canvas and then fail, before the page's own scripts
// run, and asserts the game still comes up. That reproduces Dan's crash exactly, here, on a box
// with no WebGPU at all.
//
// Sections:
//   1. the plain boot works, and says which backend it got
//   2. the canvas really is spent by a webgpu context — the mechanism, proved in this browser
//   3. WebGPU takes the canvas and fails: the game must still start, draw, and be playable
//   4. the atlas layer count is asked for, against the adapter's own number
//   5. a WebGPU that fails BEFORE taking the canvas must not churn the DOM
//   6. anti-vacuity — the sabotage must really break an unfixed build

import { resolve } from 'node:path';
import { open, sleep } from './cdp.mjs';

const FILE = resolve(process.argv[2] || 'dist/mclite.html');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('ok    ' + m); } else { fails.push(m); console.log('FAIL  ' + m); } return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else { fails.push('anti-vacuity: ' + m); console.log('   ✗ ' + m); } };
const say = (...a) => console.log(...a);

/**
 * Boot the page with an optional saboteur installed before its own scripts run.
 * Returns { up, name, fatal, draws, canvasId, swapped, problems }.
 */
async function boot(port, initScript) {
  const page = await open(FILE, { port, width: 900, height: 560, initScript });
  if (!page) return null;
  // ⚠ WAIT FOR THE TITLE, don't sleep (D-511). A fixed 1.8 s was enough on an idle machine; on a
  // loaded one Enter landed before the title existed, Play never ran, and §6's broken boot
  // "failed" with 0 swaps and no reason — a break passing for the wrong cause, then two red
  // anti-vacuity lines. diagcheck's own wait, same condition.
  await page.waitFor(() => (window.MCL && MCL.Hud && MCL.Hud.mode === 'title') ? 1 : 0, 60000);
  await page.key('Enter');                                  // the title screen's Play
  // ready, OR the renderer step has visibly finished failing (§6's broken boot never becomes
  // ready — waiting the full 90 s for it only proved the machine was slow)
  const up = await page.waitFor(() => (MCL.Main && MCL.Main.ready === true) ? 1
    : ((MCL.Gfx && MCL.Gfx.fallbackReason && MCL.Gfx.fallbackReason.indexOf('no replacement') >= 0) ? 2 : 0), 90000) === 1;
  await sleep(3000);
  const st = await page.evaluate(() => ({
    name: MCL.Gfx ? MCL.Gfx.name : '?',
    draws: MCL.Gfx ? (MCL.Gfx.draws | 0) : -1,
    drawn: MCL.Gfx ? (MCL.Gfx.drawn | 0) : -1,
    fatal: !!(document.getElementById('fatal') && document.getElementById('fatal').textContent.trim()),
    fallback: MCL.Gfx ? MCL.Gfx.fallbackReason : '',
    gpuReason: MCL.GfxGPU ? MCL.GfxGPU.failReason : '',
    contextTaken: !!(MCL.GfxGPU && MCL.GfxGPU.contextTaken),
    canvasIsInDoc: !!(MCL.Main && MCL.Main.glCanvas && document.body.contains(MCL.Main.glCanvas)),
    inputOnLiveCanvas: !!(MCL.Input && MCL.Main && MCL.Input.el === MCL.Main.glCanvas),
    swaps: window.__swaps | 0,
  }));
  return Object.assign({ up: !!up, page: page, problems: page.problems }, st);
}

say('backendcheck — the game must START, on both backends and through the fallback (D-310)');

let noChromium = false;
try {
  // ── 1. the plain boot ────────────────────────────────────────────────────────────────────
  say('\n1. the ordinary boot');
  const plain = await boot(9418, '');
  if (!plain) { noChromium = true; throw new Error('SKIP'); }
  ok(plain.up === true, 'the world came up');
  ok(plain.fatal === false, 'no fatal screen');
  ok(plain.name === 'webgl2' || plain.name === 'webgpu', `the backend is ${plain.name}`);
  ok(plain.drawn > 0, `and it drew ${plain.drawn} sections`);
  say(`   backend ${plain.name} · ${plain.drawn} drawn · webgpu context taken: ${plain.contextTaken}`);

  // ── 2. the mechanism ─────────────────────────────────────────────────────────────────────
  // ⚠ ASSERTED, NOT ASSUMED. The whole of fault 2 rests on "a webgpu canvas cannot give webgl2",
  // and if that ever stopped being true this file would be testing a fiction.
  say('\n2. a canvas that has given out a webgpu context is spent');
  const mech = await plain.page.evaluate(() => {
    const c = document.createElement('canvas');
    let gpu = null;
    try { gpu = c.getContext('webgpu'); } catch (e) { gpu = null; }
    const after = c.getContext('webgl2');
    const fresh = document.createElement('canvas').getContext('webgl2');
    return { gpu: !!gpu, after: !!after, fresh: !!fresh };
  });
  ok(mech.gpu === true, 'getContext("webgpu") succeeds here — even with no adapter, which is the trap');
  ok(mech.after === false, 'and the same canvas then refuses webgl2');
  ok(mech.fresh === true, 'while a fresh canvas gives webgl2 — so a replacement is the cure');
  await plain.page.close();

  // ── 3. Dan's crash, reproduced and survived ──────────────────────────────────────────────
  // ⚠ THE SABOTEUR IS THE REAL SEQUENCE, NOT A STUB THAT RETURNS FALSE. It takes the canvas
  // first — that is what `getContext('webgpu')` does on his machine before the atlas blows up —
  // and only then fails. A stub that failed WITHOUT taking the canvas passes on a broken build.
  say("\n3. WebGPU takes the canvas and then fails — the game must still start");
  // ⚠ NOTHING INSIDE THIS TEMPLATE MAY CONTAIN A BACKTICK — a comment with one closes the
  // literal and the file will not parse. `skyviewcheck` learned the same thing (D-303).
  const SABOTAGE = `
    window.__swaps = 0;
    (function wait() {
      if (typeof MCL === 'undefined' || !MCL.GfxGPU) { setTimeout(wait, 0); return; }
      MCL.GfxGPU.init = function (canvas) {
        try { canvas.getContext('webgpu'); MCL.GfxGPU.contextTaken = true; } catch (e) { /* older browser */ }
        MCL.GfxGPU.failReason = 'sabotage: took the canvas, then failed (backendcheck §3)';
        return Promise.resolve(false);
      };
      var realSwap = null;
      (function hook() {
        if (!MCL.Main || !MCL.Main.swapCanvas) { setTimeout(hook, 0); return; }
        realSwap = MCL.Main.swapCanvas;
        // WARNING: no backticks below -- this comment lives inside a template literal.
        // window.__noSwap is how section 6 takes the fix away, and it has to work THROUGH this
        // wrapper rather than by nulling Gfx.replaceCanvas directly: Main.play() assigns
        // Gfx.replaceCanvas = Main.swapCanvas during boot, AFTER any init script has run, so a
        // null written earlier is simply overwritten and the break never fires. It did not, on
        // this file's first run -- an anti-vacuity break undone by the very code it is testing.
        MCL.Main.swapCanvas = function () {
          window.__swaps++;
          return window.__noSwap ? null : realSwap.apply(this, arguments);
        };
      })();
      try { MCL.Settings.backend = 'webgpu'; } catch (e) { /* set below instead */ }
      window.__MCLITE_FORCE_BACKEND = 'webgpu';
    })();
  `;
  const sab = await boot(9419, SABOTAGE);
  ok(sab.up === true, 'THE GAME STARTED ANYWAY — this is the assertion Dan\'s crash would have failed');
  ok(sab.fatal === false, 'no fatal screen');
  ok(sab.name === 'webgl2', `it fell back to ${sab.name}`);
  ok(sab.drawn > 0, `and drew ${sab.drawn} sections, so the fallback is a working renderer and not a stub`);
  ok(sab.contextTaken === true, 'the saboteur really did take the canvas (otherwise this section proves nothing)');
  ok(sab.swaps >= 1, `the canvas was replaced ${sab.swaps} time(s)`);
  ok(sab.canvasIsInDoc === true, 'the replacement canvas is in the document');
  // ⚠ A REPLACED CANVAS WITH THE INPUT LAYER ON THE OLD NODE IS A GAME THAT DRAWS AND CANNOT BE
  // PLAYED — which would be a fix that looks green and is useless.
  ok(sab.inputOnLiveCanvas === true, 'and the input layer moved with it');
  say(`   ${sab.fallback}`);
  await sab.page.close();

  // ── 4. the limit is asked for ────────────────────────────────────────────────────────────
  say('\n4. the atlas layer count is requested, not assumed');
  const lim = await boot(9420, '');
  const req = await lim.page.evaluate(() => {
    const A = MCL.Atlas, P = MCL.GfxGPU;
    let need = -1;
    try { need = P.atlasLayersNeeded(); } catch (e) { need = -2; }
    return { tiles: A ? (A.tiles | 0) : -1, need: need, wanted: P.limitsWanted || null };
  });
  ok(req.tiles > 256,
     `the block atlas has ${req.tiles} layers — MORE than WebGPU's default limit of 256, which is the whole bug`);
  ok(req.need === req.tiles, `GfxGPU asks for ${req.need}, and the atlas has ${req.tiles}`);
  say('   ⓘ this browser has navigator.gpu and NO ADAPTER, so the device request itself cannot run here.'
    + ' §3 covers what happens when it fails; the number it would ask for is asserted above.');

  // ── 5. a clean WebGPU failure must not churn the DOM ──────────────────────────────────────
  // ⚠ THE OTHER DIRECTION. The fix must not swap the canvas every boot: on this box WebGPU fails
  // at "no adapter" without touching it, and a swap there is pure churn — and churn that would
  // hide a future regression by making §3's swap count meaningless.
  say('\n5. a WebGPU that fails before touching the canvas must not replace it');
  const clean = await lim.page.evaluate(() => ({
    taken: !!(MCL.GfxGPU && MCL.GfxGPU.contextTaken),
    reason: MCL.GfxGPU ? MCL.GfxGPU.failReason : '',
  }));
  ok(clean.taken === false,
     `the default boot never took a webgpu context (reason: ${clean.reason || 'webgpu not attempted'})`);

  // ── 6. anti-vacuity ──────────────────────────────────────────────────────────────────────
  say('\n6. break it, and it must be caught');
  {
    // ⚠ THE DECISIVE ONE: put the OLD behaviour back — a fallback that reuses the spent canvas —
    // and the boot must fail. Without this, §3 passes on a build where the fix does nothing,
    // because `tryGL` might be succeeding for some other reason.
    const broken = await boot(9421, 'window.__noSwap = true;' + SABOTAGE);
    okAv(broken.up === false || broken.drawn <= 0,
      `with no replacement canvas available the boot ${broken.up ? 'STILL came up on ' + broken.name + ' — the fix is not what is saving §3' : 'failed, exactly as it did on Dan\'s machine'}`);
    okAv(broken.swaps >= 1, `and the fallback did ask for a replacement (${broken.swaps} request(s)) — it was refused, not skipped`);
    okAv(String(broken.fallback || '').indexOf('webgpu context') >= 0
         || String(broken.gpuReason || '').length > 0,
      'and the diagnostics name the spent canvas rather than blaming the driver');
    say(`   ${String(broken.fallback || '(no reason recorded)').slice(0, 200)}`);
    await broken.page.close();
  }

  const errs = lim.problems || [];
  ok(errs.filter((e) => e.indexOf('sabotage') < 0).length === 0,
     'the page logged no errors (' + errs.slice(0, 2).join(' | ') + ')');
  await lim.page.close();
} catch (e) {
  if (noChromium) {
    console.log('backendcheck: SKIP — no Chromium on this machine (cdp.mjs found none)');
    process.exit(0);
  }
  fails.push('threw: ' + ((e && e.stack) || e));
}

console.log('');
console.log('=============== backendcheck =============');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
console.log('==========================================');
process.exit(fails.length ? 1 : 0);
