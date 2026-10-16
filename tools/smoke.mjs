#!/usr/bin/env node
// tools/smoke.mjs — the only test that runs THE SHIPPED FILE, in a real browser, over file://.
//
// gencheck/shadercheck/gamecheck all load `src/` headlessly. None of them can tell you that
// dist/mclite.html actually boots when double-clicked, that the blob worker starts from a
// file:// origin, that localStorage is writable there, or that the WebGL2 fallback picks up when
// WebGPU is absent. Those are the four ways this project dies, and they are all origin-specific.
//
// It drives a headless Chromium over the DevTools protocol on a REAL clock. Do not be tempted by
// --virtual-time-budget: worker threads and the IndexedDB backend are not on the virtual clock,
// so the page appears to hang and the results are fiction (that mistake is why D-74's first
// draft said IndexedDB does not work on file://; it does).
//
// What it asserts, end to end:
//   phase 1  boots to 'game', spawns on dry land, ticks physics, targets a block, breaks it,
//            places it back, opens both menus, swaps the renderer backend, saves
//   phase 2  RELOADS THE PAGE and checks the edit survived and the player came back
//
// Usage: node tools/smoke.mjs [path-to-html] [--wait ms] [--keep]
// Browser: $CHROME, else $CHROMIUM, else the first of a few well-known paths. If none exists the
// tool prints SKIP and exits 0 — a machine without a browser must not fail the build.

import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { findChrome, QUIET_FLAGS, NO_OS_INPUT, RENDER_FLAGS } from './cdp.mjs';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const TARGET = resolve(argv.find(a => !a.startsWith('--') && !/^\d+$/.test(a)) ||
                       join(ROOT, 'dist', 'mclite.html'));
const WAIT = Number(flag('--wait', 30000));
const PORT = Number(process.env.MCLITE_CDP_PORT) || 9412;   // D-818

const CHROME = findChrome();   // the one candidate list is cdp.mjs's (D-407)

if (!CHROME) {
  console.log('SKIP  smoke: no Chromium found (set $CHROME to run it)');
  process.exit(0);
}
if (!existsSync(TARGET)) {
  console.error('FAIL  smoke: ' + TARGET + ' does not exist — run build.mjs first');
  process.exit(1);
}

let failures = 0;
const need = (cond, what, extra) => {
  if (cond) console.log('ok    ' + what);
  else { failures++; console.error('FAIL  ' + what + (extra ? '  [' + extra + ']' : '')); }
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rpc = (path, method) => new Promise((res, rej) => {
  const r = http.request({ host: '127.0.0.1', port: PORT, path, method, agent: false }, s => {
    let b = ''; s.on('data', c => (b += c)); s.on('end', () => res(b));
  });
  r.on('error', rej); r.end();
});

const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', ...QUIET_FLAGS, ...RENDER_FLAGS, '--window-size=640,400',
  '--disable-background-networking', '--no-first-run', '--disable-component-update',
  '--remote-debugging-port=' + PORT, 'about:blank'
], { stdio: ['ignore', 'ignore', 'ignore'] });

let ws, msgId = 0;
const pending = new Map();
const send = (method, params) => {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params: params || {} }));
  return new Promise(r => pending.set(id, r));
};
const problems = [];
// ⚠ THIS HELPER USED TO LIE. `Runtime.evaluate` answers a THROW with `exceptionDetails` and a
// `result` that is the error object, whose `.value` is undefined — so a probe that threw came
// back indistinguishable from a probe that returned null, and the caller said "the page has no
// MCL global" about a page whose MCL global was right there. A harness must never turn its own
// exception into a claim about the program under test. It now records the throw in `problems`
// (so it is reported like any other page error) and marks the answer so the caller can say so.
const evaluate = fn => send('Runtime.evaluate', {
  expression: '(' + fn.toString() + ')()', returnByValue: true
}).then(r => {
  if (r && r.exceptionDetails) {
    const d = r.exceptionDetails;
    const desc = (d.exception && (d.exception.description || d.exception.value)) || d.text;
    problems.push('probe threw: ' + desc);
    lastThrow = String(desc);
    return null;
  }
  return r && r.result ? r.result.value : null;
});
let lastThrow = '';

try {
  for (let i = 0; i < 80; i++) {
    try { await rpc('/json/version', 'GET'); break; } catch (e) { await sleep(250); }
  }
  const url = pathToFileURL(TARGET).href;
  const target = JSON.parse(await rpc('/json/new?' + encodeURIComponent(url), 'PUT'));
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      problems.push('exception: ' + ((d.exception && d.exception.description) || d.text));
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      problems.push('console.error: ' + m.params.args.map(a => a.value || a.description).join(' '));
    }
  };
  await send('Runtime.enable');
  await send('Page.enable');
  // D-817: never take Dan's real cursor (emulated pointer lock), then reload so it runs before the page's scripts
  await send('Page.addScriptToEvaluateOnNewDocument', { source: NO_OS_INPUT });
  await send('Page.reload', {});
  // ⚠ B2 put a TITLE SCREEN in front of the world (docs/PLAN §11). Before it, loading the
  // page started generating; after it, the page sits at the title until somebody clicks Play,
  // and every field this file reads is undefined until then. That is why this check went
  // quiet: it did not fail, it threw inside the probe and reported "no MCL global", which is
  // the least informative thing it could have said. `titlecheck` covers the CLICK; this file
  // is about the thirty seconds after it, so it calls `Main.play()` and says so.
  // s118: WAIT FOR THE SCRIPT, not a fixed 1.5 s. A 14 MB inline script can take longer than
  // that to parse on a loaded machine; the fixed sleep then read "no MCL", never called play(),
  // and failed the boot (suite 202609241434 on Windows; this VM on the reload). This is a page-
  // ready wait inside one foreground run, like the /json/version retry above, not a poll of a job.
  for (let t = 0; t < 60; t++) {
    const has = await evaluate(function () { return !!(window.MCL && window.MCL.Main); });
    if (has) break;
    await sleep(500);
  }
  const started = await evaluate(function () {
    const M = window.MCL;
    if (!M || !M.Main) return 'no MCL';
    if (M.Main.ready) return 'already running';
    if (typeof M.Main.play !== 'function') return 'no Main.play';
    M.Main.play({});
    return 'play() called';
  });
  console.log('      title: ' + started);
  console.log('      loading ' + url + ' and playing for ' + (WAIT / 1000) + 's…');
  await sleep(WAIT);

  const A = await evaluate(PHASE1);
  if (!A) {
    const why = await evaluate(function () {
      return {
        mcl: typeof window.MCL,
        main: window.MCL ? typeof window.MCL.Main : 'n/a',
        nkeys: window.MCL ? Object.keys(window.MCL).length : 0,
        keys: window.MCL ? Object.keys(window.MCL).join(',') : '',
        title: document.title, err: window.__lastError || ''
      };
    });
    console.log('      probe: ' + JSON.stringify(why));
    console.log('      problems so far: ' + JSON.stringify(problems.slice(0, 5)));
    throw new Error(lastThrow
      ? 'phase 1 THREW inside the page: ' + lastThrow.split('\n')[0]
      : 'phase 1 returned nothing and did not throw — MCL is ' + why.mcl);
  }
  console.log('      ' + A.summary);

  need(A.ready, 'boots all the way to the game (not stuck on the loading screen)');
  need(A.hud === 'game', 'HUD leaves loading mode');
  need(A.progress === 1, 'the loading bar reaches 100%');
  need(A.backend === 'webgl2' || A.backend === 'webgpu', 'a GPU backend came up', A.backend);
  need(A.workers, 'blob workers start from file://', 'jobs mode ' + A.jobs);
  need(A.chunks > 8 && A.meshes > 0, 'the world generated and meshed', A.chunks + ' chunks, ' + A.meshes + ' meshes');
  need(A.ticks > 100, 'the 20 Hz simulation ran', A.ticks + ' ticks');
  // ⚠⚠ AND THE WORLD TICKED, WHICH IS A DIFFERENT QUESTION (D-301). `Main.ticks` counts the
  // loop's steps; `Behave.gameTime` counts the scheduled-tick queue being DRAINED. Until
  // session 9 the first was in the hundreds and the second was zero, in every build, for ever.
  need(A.gameTime > 100, 'THE WORLD TICKED — the scheduled-tick queue is being drained',
       A.gameTime + ' game ticks');
  need(A.dayTime > 1000, 'and the sky clock is running', 'dayTime ' + A.dayTime);
  need(A.skyReady && A.redstoneReady && A.pistonReady,
       'the sky, redstone and piston modules were all initialised',
       'sky ' + A.skyReady + ' redstone ' + A.redstoneReady + ' piston ' + A.pistonReady);
  need(A.skyR >= 0 && A.fogR >= 0 && A.skyR !== A.fogR,
       'the sky and the fog are two different colours, both computed',
       'sky.r ' + A.skyR + ' fog.r ' + A.fogR);
  need(A.onGround, 'the player is standing on terrain, not falling');
  need(!A.inWater, 'the spawn is dry land');
  need(A.icons, 'block icons were built for the hotbar/inventory');
  need(A.itemSheet, 'and the ITEM sprite sheet was built by the BOOT CHAIN, not by a check',
       'Hud.itemSheetReady is false in the running game');
  need(A.itemSheetW > 0 && A.itemSheetH > 0, 'the item sheet has a size',
       A.itemSheetW + 'x' + A.itemSheetH);
  need(A.itemSheetInk > 10000, 'and real sprite pixels in it, not an empty canvas',
       A.itemSheetInk + ' opaque px');
  need(A.targeted, 'the crosshair targets a block', A.targetName);
  need(A.broke && A.becameAir, 'a block can be broken');
  need(A.particles >= 8, 'breaking spawns BlockDust particles (D-659: a cube is 64)', String(A.particles));
  need(A.placed && A.restored, 'a block can be placed back');
  need(A.invSlots === 46, 'the inventory screen has all 46 slots', String(A.invSlots));
  need(A.invOrigin, 'and it laid itself out on the GUI texture');
  need(A.invPicked > 0 && A.invEmptied, 'clicking a slot picks the stack up', String(A.invPicked));
  need(A.invRestored, 'and clicking again puts it back, unchanged');
  need(A.pauseHits > 3, 'the pause menu draws clickable widgets', String(A.pauseHits));
  need(A.pauseScreen === 'pause', 'and it is the Options tree, on its own screen', String(A.pauseScreen));
  need(A.gaveByCommand, '/give put a stack in the inventory (D-312, D-316)');
  need(A.storage === 'localStorage', 'localStorage is writable from file://', A.storage);
  need(A.saved, 'save() writes');
  need(A.swapped, 'F9 renderer swap replaces the canvas and rewires input');
  need(!A.fatal, 'no fatal screen', A.fatal);

  console.log('\n      reloading the page…');
  await send('Page.reload', { ignoreCache: false });
  await sleep(1000);   // s118: let the old document go before asking the new one for MCL
  // the reload lands on the title screen too — and "continue" is exactly what a returning
  // player clicks, so this is the path that matters for the save assertions below
  // s118: WAIT FOR THE SCRIPT, not a fixed 1.5 s. A 14 MB inline script can take longer than
  // that to parse on a loaded machine; the fixed sleep then read "no MCL", never called play(),
  // and failed the boot (suite 202609241434 on Windows; this VM on the reload). This is a page-
  // ready wait inside one foreground run, like the /json/version retry above, not a poll of a job.
  for (let t = 0; t < 60; t++) {
    const has = await evaluate(function () { return !!(window.MCL && window.MCL.Main); });
    if (has) break;
    await sleep(500);
  }
  console.log('      title: ' + await evaluate(function () {
    const M = window.MCL;
    if (!M || !M.Main) return 'no MCL';
    if (M.Main.ready) return 'already running';
    M.Main.play({});
    return 'play() called';
  }));
  await sleep(WAIT);
  const Bp = await evaluate(PHASE2);
  if (!Bp) throw new Error('phase 2 returned nothing');
  console.log('      ' + Bp.summary);
  need(Bp.ready, 'boots again after a reload');
  need(Bp.loaded, 'the save file was found and parsed');
  need(Bp.seedKept, 'the seed came back, so it is the same world');
  need(Bp.playerKept, 'the player came back where they left off');
  need(Bp.editKept, 'THE EDIT SURVIVED THE RELOAD', 'block ' + Bp.at + ' should still be air');
  need(!Bp.fatal, 'no fatal screen after reload', Bp.fatal);

  if (problems.length) {
    failures += problems.length;
    console.error('\nFAIL  ' + problems.length + ' page error(s):');
    for (const p of problems.slice(0, 10)) console.error('      ' + p);
  } else {
    console.log('ok    the page logged no errors or exceptions');
  }
} catch (e) {
  failures++;
  console.error('FAIL  smoke harness: ' + (e.stack || e));
} finally {
  if (!argv.includes('--keep')) chrome.kill('SIGKILL');
}

console.log('\n' + (failures ? 'smoke: FAILED (' + failures + ')' : 'smoke: PASS'));
process.exit(failures ? 1 : 0);

// ---------------------------------------------------------------------------
// Injected into the page. Must be self-contained: it is stringified, not closed over.
// ---------------------------------------------------------------------------

function PHASE1() {
  const M = window.MCL;
  if (!M || !M.Main) return null;
  const P = M.Player, G = M.Gfx, H = M.Hud, W = M.World, B = M.Blocks;
  const r = {};
  r.ready = !!M.Main.ready;
  r.hud = H.mode;
  r.progress = H.progress;
  r.backend = G.name;
  r.jobs = M.Jobs.mode;
  r.workers = M.Jobs.mode === 'workers' || M.Jobs.mode === 'inline';
  r.chunks = W.chunks.size;
  r.meshes = G.meshes.size;
  r.ticks = M.Main.ticks;
  // ⚠⚠ THE WORLD TICK, MEASURED IN A REAL BROWSER (D-301). `Main.ticks` counts the loop's
  // fixed-step iterations and has always advanced; `Behave.gameTime` counts the SCHEDULED-TICK
  // queue being drained, and until session 9 it was zero for ever in every build because
  // nothing called `Behave.tick`. Water never spread, fire never burnt out, no furnace ever
  // smelted. The number below is the only one that could have said so.
  r.gameTime = (M.Behave && M.Behave.gameTime) | 0;
  r.dayTime = (M.Sky && M.Sky.dayTime) | 0;
  r.skyReady = !!(M.Sky && M.Sky.ready);
  r.pistonReady = !!(M.Piston && M.Piston.ready);
  r.redstoneReady = !!(M.Redstone && M.Redstone.ready);
  r.skyR = M.Gfx.sky ? +M.Gfx.sky[0].toFixed(4) : -1;
  r.fogR = M.Gfx.fog ? +M.Gfx.fog[0].toFixed(4) : -1;
  r.onGround = P.onGround;
  r.inWater = P.inWater;
  r.icons = !!H.icons;
  // ⚠ THE ITEM SHEET, MEASURED IN THE RUNNING GAME (D-341). `iconcheck` calls
  // `H.buildItemIcons()` itself, so it proves the builder works and says nothing about whether
  // the boot chain ever calls it with its input ready. It did not: the call sat above
  // `Atlas.build`, read a null `A.mips`, returned early and — being build-once — never ran
  // again, so every stick, apple and diamond in the HUD was blank. Only a probe inside the
  // running game can see that, which is what these four fields are.
  r.itemSheet = !!H.itemSheetReady;
  r.itemSheetW = H.itemSheet ? H.itemSheet.width : 0;
  r.itemSheetH = H.itemSheet ? H.itemSheet.height : 0;
  r.itemSheetInk = (function () {
    // and it must have PIXELS in it — a sheet of the right size full of nothing is the same
    // bug one layer down, and `putImageData` of an empty buffer would pass a size check.
    if (!H.itemSheet) return -1;
    try {
      var g = H.itemSheet.getContext('2d');
      var d = g.getImageData(0, 0, H.itemSheet.width, H.itemSheet.height).data;
      var n = 0;
      for (var i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
      return n;
    } catch (e) { return -2; }
  })();
  r.storage = M.Save.backend;

  // aim at the ground and mine
  P.pitch = -1.35; P.interpolate(1); P.retarget();
  r.targeted = P.hasTarget;
  r.targetName = P.hasTarget ? B.names[P.tid] : '-';
  const at = P.hasTarget ? [P.tx, P.ty, P.tz] : null;
  r.broke = P.breakBlock();
  r.particles = M.Particle ? M.Particle.list.filter((q) => q.type === 'block').length : 0;   // D-659
  r.becameAir = at ? W.getBlock(at[0], at[1], at[2]) === 0 : false;
  P.hotbar[P.slot] = B.byName('stone');
  P.retarget();
  r.placed = P.placeBlock();
  r.restored = at ? W.getBlock(at[0], at[1], at[2]) !== 0 : false;

  // menus
  H.showDebug = true;
  // ⚠ G11 REPLACED THE CREATIVE BLOCK PICKER, so this measurement had to change with it — the
  // old one counted `H.hit` rectangles, and the real inventory has none: every click is a
  // `ClickType` routed straight to G8's machine. Counting hit rects would now measure a screen
  // that no longer exists, which is D-139's whole warning (and D-152's, where `physcheck` §1
  // enshrined a stub). The new measurement is the one that matters: the screen draws the 46
  // slots, and CLICKING one moves an item.
  H.open('inventory'); H.draw();
  r.invHits = H.hit.length;
  r.invSlots = (MCL.Player.menu && MCL.Player.menu.slots) ? MCL.Player.menu.slots.length : 0;
  r.invOrigin = !!H.invOrigin;
  {
    var Mn = MCL.Menu, Iv = MCL.Inventory, Pl = MCL.Player;
    // ⚠ D-312 EMPTIED THE HOTBAR, so this test had nothing to pick up and failed on a game that
    // was working correctly. The stack is PUT THERE with `/give`, which is the way a player would
    // now get one — so the smoke test proves the command parser and the click machine together,
    // rather than depending on scaffolding that was deleted on purpose.
    if (Iv.isEmpty(Iv.getItem(Pl.inventory, 0)) && MCL.Commands) {
      MCL.Commands.run('/give @s stone 64', Pl, {});
      Pl.syncHotbar();
    }
    r.gaveByCommand = !Iv.isEmpty(Iv.getItem(Pl.inventory, 0));
    var before = Iv.isEmpty(Iv.getItem(Pl.inventory, 0)) ? 0 : Iv.getItem(Pl.inventory, 0).n;
    // menu slot 36 is hotbar slot 0; click it and the stack should be in hand
    Mn.doClick(Pl.menu, 36, 0, Mn.PICKUP, Pl);
    r.invPicked = Mn.getCarried(Pl.menu) ? Mn.getCarried(Pl.menu).n : 0;
    r.invEmptied = Iv.isEmpty(Iv.getItem(Pl.inventory, 0));
    Mn.doClick(Pl.menu, 36, 0, Mn.PICKUP, Pl);            // put it back
    var after = Iv.isEmpty(Iv.getItem(Pl.inventory, 0)) ? 0 : Iv.getItem(Pl.inventory, 0).n;
    r.invRestored = (before === after && before > 0);
  }
  // ⚠ G11c MOVED THE PAUSE SCREEN OUT OF `H.hit`. It is vanilla's Options tree now, drawn by
  // `NS.Options`, which owns its own hit list — counting `H.hit` here would measure a screen that
  // no longer exists, exactly as counting hit rects for the inventory did before G11 (above).
  H.open('pause'); H.draw();
  r.pauseHits = (MCL.Options && MCL.Options.hit) ? MCL.Options.hit.length : H.hit.length;
  r.pauseScreen = MCL.Options ? MCL.Options.screen : null;
  H.close(); H.draw();

  // leave one hole behind, note where, and persist it
  P.pitch = -1.35; P.interpolate(1); P.retarget();
  if (P.hasTarget) {
    const hole = [P.tx, P.ty, P.tz];
    P.breakBlock();
    localStorage.setItem('mclite.smoke', JSON.stringify(hole));
    r.hole = hole.join(',');
  }
  r.saved = M.Save.save(false);

  // renderer swap
  M.Main.cycleBackend(1);
  r.swapped = (M.Main.glCanvas === document.getElementById('gl')) && (M.Input.el === M.Main.glCanvas);

  const f = document.getElementById('fatal');
  r.fatal = f && f.textContent ? f.textContent.slice(0, 200) : '';
  r.summary = 'backend=' + r.backend + ' jobs=' + r.jobs + ' chunks=' + r.chunks +
              ' meshes=' + r.meshes + ' ticks=' + r.ticks + ' frames=' + M.Main.frame +
              ' player=' + P.x.toFixed(1) + ',' + P.y.toFixed(1) + ',' + P.z.toFixed(1) +
              ' hole=' + r.hole;
  return r;
}

function PHASE2() {
  const M = window.MCL;
  if (!M || !M.Main) return null;
  const r = {}, P = M.Player, W = M.World;
  const at = JSON.parse(localStorage.getItem('mclite.smoke') || 'null');
  r.ready = !!M.Main.ready;
  r.loaded = !!M.Save.loaded;
  r.seedKept = M.Save.seed === M.Main.seed;
  r.playerKept = M.Save.playerState &&
                 Math.abs(M.Save.playerState.x - P.x) < 2 && Math.abs(M.Save.playerState.z - P.z) < 2;
  r.at = at ? at.join(',') : '-';
  r.editKept = at ? W.getBlock(at[0], at[1], at[2]) === 0 : false;
  const f = document.getElementById('fatal');
  r.fatal = f && f.textContent ? f.textContent.slice(0, 200) : '';
  r.summary = 'reloaded: seed=' + M.Save.seed + ' edits=' + M.Save.count +
              ' renderer=' + M.Gfx.name + ' meshes=' + M.Gfx.meshes.size +
              ' player=' + P.x.toFixed(1) + ',' + P.y.toFixed(1) + ',' + P.z.toFixed(1);
  return r;
}
