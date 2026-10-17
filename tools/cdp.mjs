// cdp.mjs — drive headless Chromium over the DevTools protocol, with no npm dependency (D-109).
//
// ⚠ WHY THIS EXISTS. `tools/titlecheck.mjs` used to `import { chromium } from 'playwright'`.
// That worked on the machine session 1 happened to run on and failed instantly on the next one:
// playwright is not in the repo (there is no package.json — D-6's rule applies to node_modules
// too), and installing it pulls a browser build that has to match the library version. Session 2
// opened with titlecheck as the one red stage in the suite for exactly that reason.
//
// `tools/smoke.mjs` had already solved the same problem the right way: spawn whatever Chromium
// is on the box with `--remote-debugging-port` and talk to it over the protocol directly, using
// nothing but node's own `http` and `WebSocket`. This is that harness, lifted out so both files
// use one copy.
//
// The protocol surface needed is small: Runtime.evaluate to read the page,
// Input.dispatchMouseEvent to click, Input.dispatchKeyEvent
// to type, and the two events that carry errors.

import { tmpdir, setPriority, constants as osConstants } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { existsSync, rmSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { acquire } from './infra/browserslots.mjs';

// ⚠ THE ONE LIST (D-407). smoke.mjs, bench.mjs and suite.mjs used to carry their own copies and
// drifted (bench never learned the Windows paths). They all import `findChrome` from here now.
// `.chromium/chrome` is the project's own permanent browser — `node tools/get-chromium.mjs`.
const LOCAL = new URL('../.chromium/chrome', import.meta.url).pathname;
export const CANDIDATES = [
  process.env.CHROME, process.env.CHROMIUM, process.env.CHROMIUM_PATH,
  process.platform === 'linux' ? LOCAL : null,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium/chrome-linux/chrome',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  // ⚠ FOUND RUNNING THIS FILE'S OWN `open()` FROM THE ai-jobs LANE, ON DAN'S REAL WINDOWS
  // MACHINE (G18c step 1, 17 Sept 2026): every candidate above is a Unix/macOS path, so
  // g18ccheck.mjs (and, by the same gap, EVERY browser stage this lane has ever run --
  // becheck/smoke/titlecheck/spritecheck/etc., all through this one list) printed
  // "no Chromium found" the instant it ran as a real Windows process rather than from a
  // Linux dev shell where $CHROME happened to be set. Nothing about this was Chromium
  // actually missing -- it is on the box -- the list just never looked for it there.
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA ? process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe' : null,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

export function findChrome() {
  for (const p of CANDIDATES) {
    if (!p) continue;
    try { if (existsSync(p)) return p; } catch { /* keep looking */ }
  }
  return null;
}

/**
 * D-817 (Dan, 27 Sept 2026: "fix that running the suite on the pc forces my cursor into a box … fix that it produces
 * noise"). Headless Chromium on Windows is a real browser with a hidden window: `requestPointerLock` there calls the OS's
 * ClipCursor and TRAPS DAN'S REAL MOUSE inside the invisible window's rectangle, and game audio plays through his
 * speakers. Every harness browser therefore launches with QUIET_FLAGS (--mute-audio) and installs NO_OS_INPUT before the
 * page's own scripts: pointer lock is EMULATED in the page (pointerLockElement + pointerlockchange behave as in Chrome)
 * and never reaches the OS. `quietharnesscheck` fails if any launcher drops either.
 */
/** D-820 (Dan, 27 Sept: "actually make speed fixes"): on Dan's Windows PCs the harness browsers render on the REAL GPU
 *  (ANGLE → Direct3D 11) instead of SwiftShader, the CPU rasteriser that made the 25 browser stages 23 of the suite's 26
 *  minutes and made parallel browsers fight over every core. SwiftShader stays everywhere else (the VM, cloud
 *  containers: no GPU) and when MCLITE_SWIFTSHADER=1 forces it. */
export const REAL_GPU = process.platform === 'win32' && process.env.MCLITE_SWIFTSHADER !== '1';
export const RENDER_FLAGS = REAL_GPU
  ? ['--use-gl=angle', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization']
  : ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'];
// D-821: a headless window is 'hidden', and Windows/Chrome THROTTLE hidden renderers (rAF, timers) — on the first GPU run
// the world stopped streaming in soakcheck and the timed checks drifted. These keep a hidden page running at full speed.
export const QUIET_FLAGS = ['--mute-audio', '--disable-features=GlobalMediaControls,CalculateNativeWinOcclusion',
  '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'];
export const NO_OS_INPUT = '(function(){var el=null;try{Object.defineProperty(Document.prototype,"pointerLockElement",{configurable:true,get:function(){return el;}});}catch(e){}'
  + 'var fire=function(){var d=document;setTimeout(function(){d.dispatchEvent(new Event("pointerlockchange"));},0);};'
  + 'Element.prototype.requestPointerLock=function(){el=this;fire();return Promise.resolve();};'
  + 'Document.prototype.exitPointerLock=function(){if(!el)return;el=null;fire();};window.__MCLITE_NO_OS_INPUT=true;})();';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * open(fileOrUrl, {port, width, height}) -> a session
 *   .evaluate(fn)      run a zero-argument function in the page, get its value back
 *   .key(name, text)   dispatch a real keydown/keyup pair (Input domain, not a synthetic event)
 *   .waitFor(fn, ms)   poll evaluate() until it returns truthy; resolves false on timeout
 *   .problems          console errors and uncaught exceptions, in order
 *   .close()
 */
/** D-820: `.infra/STOP-SUITE` present = a suite run was cancelled; every browser stage refuses at once (the suite deletes
 *  the file when it next starts). The runner has no cancel, so this is how a running suite is stopped from a session. */
export const STOP_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '.infra', 'STOP-SUITE');
export async function open(target, opts) {
  if (existsSync(STOP_FILE)) { console.log('CANCELLED  .infra/STOP-SUITE is present (D-820)'); process.exit(1); }
  const o = opts || {};
  const PORT = Number(process.env.MCLITE_CDP_PORT) || o.port || 9413;   // D-818: the suite hands each parallel browser its own port
  const chromePath = findChrome();
  if (!chromePath) return null;
  const slot = await acquire();   // #3921: host browser budget (cap + RAM floor shared by every runner process)

  const chrome = spawn(chromePath, [
    '--headless=new', '--no-sandbox', ...QUIET_FLAGS, ...RENDER_FLAGS, ...(o.flags || []),
    '--window-size=' + (o.width || 1280) + ',' + (o.height || 720),
    '--allow-file-access-from-files',
    '--disable-background-networking', '--no-first-run', '--disable-component-update',
    '--remote-debugging-port=' + PORT, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore'] });
  slot.attach(chrome.pid);
  try { setPriority(chrome.pid, osConstants.priority.PRIORITY_BELOW_NORMAL); } catch { /* D-819: best effort */ }

  // ⚠⚠ **KILL THE BROWSER WHEN THIS PROCESS DIES, WHATEVER KILLS IT.** A check that throws, times
  // out, or calls `process.exit` without reaching its `close()` used to leave a whole Chromium
  // behind — and each one keeps a SwiftShader renderer spinning. Forty of them accumulated across
  // one session of browser stages on this two-core box, one of them at 71% of a core, and the
  // first thing that noticed was `climcheck` failing a 120 ms budget with 175 ms. **A leaked
  // browser does not fail the check that leaked it; it fails the next one, somewhere else, as a
  // performance regression that is not there.** `unref` keeps the handler from holding node open.
  const reap = () => { try { chrome.kill('SIGKILL'); } catch { /* already gone */ } slot(); };
  process.once('exit', reap);
  process.once('SIGINT', () => { reap(); process.exit(130); });
  process.once('SIGTERM', () => { reap(); process.exit(143); });
  process.once('uncaughtException', (e) => { reap(); throw e; });
  if (chrome.unref) { /* the child is reaped above; do not let it hold the loop open */ }

  const rpc = (path, method) => new Promise((res, rej) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path, method, agent: false }, (s) => {
      let b = ''; s.on('data', (c) => (b += c)); s.on('end', () => res(b));
    });
    r.on('error', rej); r.end();
  });

  for (let i = 0; i < 80; i++) {
    try { await rpc('/json/version', 'GET'); break; } catch { await sleep(250); }
  }

  const url = /^[a-z]+:/.test(target) ? target : pathToFileURL(target).href;
  const page = JSON.parse(await rpc('/json/new?' + encodeURIComponent(url), 'PUT'));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let msgId = 0;
  const pending = new Map();
  const problems = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      problems.push('exception: ' + ((d.exception && d.exception.description) || d.text));
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      problems.push('console.error: ' + m.params.args.map((a) => a.value || a.description).join(' '));
    }
  };
  const send = (method, params) => {
    const id = ++msgId;
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    return new Promise((r) => pending.set(id, r));
  };

  await send('Runtime.enable');
  await send('Page.enable');

  // ⚠ D-196 — force a quality preset for the whole page, BEFORE any of its scripts run.
  // Every browser check used to run at whatever `Settings.detect()` chose on the headless
  // machine, which has two cores and therefore always chose CELERON: render distance 4 and
  // FAST leaves. Dan plays at medium and high. `MCLITE_PRESET=medium node tools/xcheck.mjs`
  // now runs the same check in the world he is actually looking at.
  // ⚠ `opts.initScript` RUNS BEFORE THE PAGE'S OWN SCRIPTS, which is the only way to reach a bug
  // that happens during BOOT. `backendcheck` uses it to sabotage the renderer the way a real
  // machine does — a WebGPU failure that has already taken the canvas — and no check could reach
  // that from `evaluate()`, because by then the boot has finished or died (D-310).
  const preamble = NO_OS_INPUT + (o.initScript || '')
    + (process.env.MCLITE_PRESET
        ? 'window.__MCLITE_FORCE_PRESET = ' + JSON.stringify(process.env.MCLITE_PRESET) + ';' : '');
  if (preamble) {
    await send('Page.addScriptToEvaluateOnNewDocument', { source: preamble });
    // the tab was opened at the target URL before this socket existed, so the init script has
    // to be followed by a real navigation or it would not run until somebody reloaded
    await send('Page.navigate', { url });
    await sleep(400);
  }

  const session = {
    url,
    pid: chrome.pid,
    problems,
    send,
    // ⚠⚠ **A PROBE THAT THREW USED TO BE INDISTINGUISHABLE FROM ONE THAT RETURNED NULL.**
    // `Runtime.evaluate` answers a throw with `exceptionDetails` and a `result` that IS the
    // error object, whose `.value` is undefined — so this returned null either way, and every
    // check built on it reported its own bug as a fact about the game. `smoke` said "the page
    // has no MCL global" about a page whose MCL global was right there, and the real cause was
    // ninety lines away in a generated file. **A harness must never turn its own exception into
    // a claim about the program under test.** The throw is now recorded in `problems`, where it
    // is reported like any other page error, and in `session.lastThrow` for a check that wants
    // to name it in its own failure line.
    evaluate: (fn) => send('Runtime.evaluate', {
      expression: '(' + fn.toString() + ')()', returnByValue: true, awaitPromise: true,
    }).then((r) => {
      if (r && r.exceptionDetails) {
        const d = r.exceptionDetails;
        const desc = (d.exception && (d.exception.description || d.exception.value)) || d.text;
        problems.push('probe threw: ' + desc);
        session.lastThrow = String(desc);
        return null;
      }
      return r && r.result ? r.result.value : null;
    }),
    lastThrow: '',
    // A real mouse click at page coordinates. Added for titlecheck's climate toggle: the
    // buttons it presses are canvas rectangles, so there is no DOM element to dispatch to and
    // calling the handler directly would test everything except the button.
    async click(x, y) {
      const base = { x: Math.round(x), y: Math.round(y), button: 'left', buttons: 1, clickCount: 1 };
      await send('Input.dispatchMouseEvent', Object.assign({ type: 'mouseMoved' }, base, { buttons: 0 }));
      await send('Input.dispatchMouseEvent', Object.assign({ type: 'mousePressed' }, base));
      await send('Input.dispatchMouseEvent', Object.assign({ type: 'mouseReleased' }, base, { buttons: 0 }));
    },

    async key(key, text, code) {
      // A real key event pair. `text` is what a character key inserts; a named key like Enter
      // or Backspace has none, and passing one makes Chromium treat it as a character.
      const base = { key, code: code || key, windowsVirtualKeyCode: virtualKey(key) };
      await send('Input.dispatchKeyEvent', Object.assign({ type: text ? 'keyDown' : 'rawKeyDown' }, base, text ? { text } : {}));
      await send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, base));
    },
    async waitFor(fn, ms) {
      const until = Date.now() + (ms || 30000);
      for (;;) {
        const v = await session.evaluate(fn);
        if (v) return v;
        if (Date.now() > until) return false;
        await sleep(250);
      }
    },
    /**
     * ⚠⚠ **WAIT FOR THE WORLD TO STOP ARRIVING BEFORE MEASURING A PICTURE** (D-321, D-345).
     * Every check here that compares two frames needs a CONTROL — "the frame changed more than
     * doing nothing changes it" — and a control is worthless while chunks are still streaming
     * in. Session 12 watched `spritecheck` report a control of 0 changed pixels and a stick of
     * 78, go green, and then report **116,345 changed pixels for that same 78-pixel object** on
     * the very next measurement: the first pair had landed in a LULL. `g17cbcheck` had the same
     * fault latent in it and started failing the day the shipped file grew by 240 KB and the
     * boot timing shifted — a control of 1,050 px against a falling block worth 1,129.
     * **A control measured in a lull is not a control; it is a coin that came up heads.**
     *
     * The chunk stream is FINITE — about 625 columns at medium — so it reaches a cap and this
     * waits for it. ⚠ It deliberately does NOT wait on the MESH count as well: meshes churn as
     * sections are rebuilt and never settle, and requiring them timed out for sixty seconds on a
     * world that was visually finished. A proxy one inference away from the thing that matters
     * is one inference away from being wrong.
     */
    async settleWorld(opts) {
      const o = opts || {};
      const quiet = o.reads || 4, every = o.every || 400, tries = o.tries || 200;
      let last = -1, still = 0;
      for (let i = 0; i < tries; i++) {
        const n = await session.evaluate(function () {
          return (window.MCL && MCL.World && MCL.World.chunks) ? MCL.World.chunks.size | 0 : -1;
        });
        if (n < 0) return -1;
        if (n === last) { if (++still >= quiet) return n; } else still = 0;
        last = n;
        await sleep(every);
      }
      return last;
    },
    async close() { try { ws.close(); } catch { /* already gone */ } chrome.kill('SIGKILL'); slot(); },
  };
  return session;
}

function virtualKey(k) {
  if (k === 'Enter') return 13;
  if (k === 'Backspace') return 8;
  if (k === 'Escape') return 27;
  if (k.length === 1) return k.toUpperCase().charCodeAt(0);
  return 0;
}
