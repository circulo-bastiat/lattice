// tools/bench.mjs — drive MCL.Bench headlessly and print the reports.
//
// This is the harness for docs/archive/PROFILE.md. It launches the same headless Chromium tools/smoke.mjs
// uses, opens the SHIPPED dist/mclite.html over file://, and runs the in-game benchmark once per
// quality preset, plus an occlusion-culling A/B on the "low" preset.
//
// READ THE NUMBERS FOR WHAT THEY ARE. Headless Chromium here rasterises through SwiftShader — a
// CPU software renderer. Its absolute fps has NOTHING to do with a Ryzen 5 2200G iGPU: it is far
// slower per pixel and far faster at some things a real driver is slow at (buffer creation, for
// one). What it does measure honestly is:
//   * the CPU side of the frame — culling, sorting, streaming, meshing, uploads
//   * geometry actually submitted: triangles, draw calls, buffer binds
//   * how much the visibility graph removes, which is a property of the world and the camera
//     path and not of the GPU at all
//   * the presence or absence of STALLS, which is the whole point of the frame budgeting
// Use it for deltas between two builds and between two settings, never as an fps claim.
//
// Usage:
//   node tools/bench.mjs                     all four presets + the occlusion A/B
//   node tools/bench.mjs --preset low        just one
//   node tools/bench.mjs --laps 2 --speed 18 a longer, gentler run
//   node tools/bench.mjs --json out.json     also write the raw reports
//   node tools/bench.mjs --shot shots/       save a PNG per run (sanity-check the picture)
//
// Prints SKIP and exits 0 when no Chromium is present, exactly like tools/smoke.mjs.

import { tmpdir } from 'node:os';
import http from 'node:http';
import { findChrome, QUIET_FLAGS, NO_OS_INPUT, RENDER_FLAGS } from './cdp.mjs';
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const has = n => argv.includes(n);

const TARGET = resolve(join(ROOT, 'dist', 'mclite.html'));
const PORT = Number(process.env.MCLITE_CDP_PORT) || 9414;   // D-818
const LAPS = Number(flag('--laps', 1));
const WARM = Number(flag('--warm', 1));
const SETTLE = Number(flag('--settle', 3));
const SPEED = Number(flag('--speed', 24));
const RADIUS = Number(flag('--radius', 72));
const ONLY = flag('--preset', null);
const JSONOUT = flag('--json', null);
const SHOTDIR = flag('--shot', null);
const BOOT_MS = Number(flag('--boot', 45000));
const WIDTH = Number(flag('--width', 854));
const HEIGHT = Number(flag('--height', 480));

const CHROME = findChrome();   // the one candidate list is cdp.mjs's (D-407)

if (!CHROME) { console.log('SKIP  bench: no Chromium found (set $CHROME to run it)'); process.exit(0); }
if (!existsSync(TARGET)) { console.error('FAIL  bench: ' + TARGET + ' missing — run build.mjs'); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rpc = (path, method) => new Promise((res, rej) => {
  const r = http.request({ host: '127.0.0.1', port: PORT, path, method, agent: false }, s => {
    let b = ''; s.on('data', c => (b += c)); s.on('end', () => res(b));
  });
  r.on('error', rej); r.end();
});

const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', ...QUIET_FLAGS, ...RENDER_FLAGS,
  '--window-size=' + WIDTH + ',' + HEIGHT,
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
const evaluate = (expr) => send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: false })
  .then(r => (r && r.result ? r.result.value : null));

const reports = [];
let code = 0;

try {
  for (let i = 0; i < 120; i++) { try { await rpc('/json/version', 'GET'); break; } catch (e) { await sleep(250); } }
  const url = pathToFileURL(TARGET).href;
  const target = JSON.parse(await rpc('/json/new?' + encodeURIComponent(url), 'PUT'));
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  };
  await send('Runtime.enable');
  await send('Page.enable');
  // D-817: never take Dan's real cursor (emulated pointer lock), then reload so it runs before the page's scripts
  await send('Page.addScriptToEvaluateOnNewDocument', { source: NO_OS_INPUT });
  await send('Page.reload', {});

  // Wait for boot. The loading screen is a real measurement, so this is a poll, not a sleep.
  console.log('      booting ' + url);
  const t0 = Date.now();
  let ready = false;
  // ⚠ B2's title screen sits in front of the world and nothing generates until Play is
  // clicked, so a poll on `Main.ready` alone waits forever. `titlecheck` covers the click;
  // a benchmark is about the frames after it, so this presses Play once the title is up.
  // (This file, smoke.mjs and gencheck all quietly stopped working when the title landed,
  // which is the argument for everything being in suite.mjs — see docs/PLAN §14.)
  let pressed = false;
  while (Date.now() - t0 < BOOT_MS) {
    ready = await evaluate('!!(window.MCL && MCL.Main && MCL.Main.ready)');
    if (ready) break;
    if (!pressed) {
      pressed = await evaluate('(function(){var M=window.MCL;' +
        'if(!M||!M.Main||typeof M.Main.play!=="function")return false;' +
        'if(M.Main.ready)return true;M.Main.play({});return true;})()');
      if (pressed) console.log('      title screen: pressed Play');
    }
    await sleep(500);
  }
  if (!ready) throw new Error('the page never reached MCL.Main.ready within ' + BOOT_MS + ' ms');
  const boot = ((Date.now() - t0) / 1000).toFixed(1);
  const env = await evaluate('JSON.stringify({v:MCL.VERSION,b:MCL.Gfx.name,' +
    'd:(MCL.Gfx.backend.info&&MCL.Gfx.backend.info().renderer)||"",' +
    'p:MCL.Settings.detected,probe:MCL.Settings.probeMs,jobs:MCL.Jobs.mode,' +
    'w:MCL.Jobs.workers.length,cores:MCL.ENV.cores})');
  const E = JSON.parse(env);
  console.log('      MC-Lite ' + E.v + '  backend=' + E.b + '  jobs=' + E.jobs + ' x' + E.w +
              '  cores=' + E.cores + '  probe=' + E.probe.toFixed(1) + 'ms  detected=' + E.p +
              '  boot=' + boot + 's');
  console.log('');

  const RUNS = ONLY
    ? [{ preset: ONLY, label: ONLY }]
    : [
        { preset: 'celeron', label: 'celeron' },
        { preset: 'low',     label: 'low' },
        { preset: 'medium',  label: 'medium' },
        { preset: 'high',    label: 'high' },
        { preset: 'low',     label: 'low, occlusion OFF', occlusion: false },
        { preset: 'low',     label: 'low, occlusion ON',  occlusion: true }
      ];

  for (const run of RUNS) {
    const opts = JSON.stringify({
      preset: run.preset, label: run.label, laps: LAPS, warm: WARM,
      settle: SETTLE, speed: SPEED, radius: RADIUS,
      ...(run.occlusion === undefined ? {} : { occlusion: run.occlusion })
    });
    const started = await evaluate('MCL.Bench.start(' + opts + ')');
    if (!started) { console.error('FAIL  bench: could not start run ' + run.label); code = 1; continue; }
    let r = null;
    const rt = Date.now();
    while (Date.now() - rt < 300000) {
      await sleep(1000);
      const done = await evaluate('MCL.Bench.running ? null : (MCL.Bench.report && JSON.stringify(MCL.Bench.report))');
      if (done) { r = JSON.parse(done); break; }
    }
    if (!r) { console.error('FAIL  bench: run ' + run.label + ' never finished'); code = 1; continue; }
    reports.push(r);
    console.log(await evaluate('MCL.Bench.text(' + JSON.stringify(r) + ')'));
    console.log('');
    if (SHOTDIR) {
      try { mkdirSync(resolve(SHOTDIR), { recursive: true }); } catch (e) {}
      // Dismiss the report panel and park the camera at a fixed point on the path, so the shot
      // is of the WORLD. This is the visual half of the test: arena mis-placement or an
      // over-eager visibility flood both show up as a picture with holes in it.
      await evaluate('MCL.Hud.benchReport=null;MCL.Hud.close();MCL.Hud.showDebug=false;' +
                     'MCL.Player.flying=true;MCL.Player.noclip=true;MCL.Bench.place(' +
                     (RADIUS * 0.18) + ');1');
      await sleep(2500);
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      if (shot && shot.data) {
        const f = join(resolve(SHOTDIR), run.label.replace(/[^a-z0-9]+/gi, '_') + '.png');
        writeFileSync(f, Buffer.from(shot.data, 'base64'));
        console.log('      screenshot -> ' + f + '\n');
      }
    }
  }

  // --- summary table --------------------------------------------------------
  if (reports.length > 1) {
    const cols = ['label', 'fps', 'meanMs', 'p95Ms', 'p99Ms', 'maxMs', 'stalls',
                  'drawsPerFrame', 'trisPerFrame', 'bindsPerFrame', 'sectionsDrawn',
                  'occludedPerFrame', 'chunks', 'worldMB', 'arenaMB'];
    const w = cols.map(c => Math.max(c.length, ...reports.map(r => String(r[c]).length)));
    const line = vals => '  ' + vals.map((v, i) => String(v).padStart(w[i])).join('  ');
    console.log('SUMMARY');
    console.log(line(cols));
    for (const r of reports) console.log(line(cols.map(c => r[c])));
  }

  if (JSONOUT) {
    writeFileSync(resolve(JSONOUT), JSON.stringify({ env: E, runs: reports }, null, 2));
    console.log('\n      json -> ' + resolve(JSONOUT));
  }
} catch (e) {
  console.error('FAIL  bench: ' + (e && e.stack || e));
  code = 1;
} finally {
  try { ws && ws.close(); } catch (e) {}
  chrome.kill('SIGKILL');
}
process.exit(code);
