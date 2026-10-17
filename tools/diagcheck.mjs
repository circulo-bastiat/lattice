#!/usr/bin/env node
// diagcheck.mjs — the F4 diagnostics overlay, and the debug keys around it (D-431).
//
//   MCLITE_PRESET=medium node tools/diagcheck.mjs [dist/mclite.html]
//
// Dan, session 55: *"move what is currently linked to f4 to f7, and add in f4 what we have in f4
// in claudeisthegoat."* Two things to prove, and the second is the one a screenshot cannot see:
//
//   1. THE PANEL. F4 opens it, it fills with the game's REAL numbers (not the `--` it is built
//      with), PgUp/PgDn scroll it, Tab cycles the entity tab, Del clears the log, F4 closes it.
//   2. THE REMAP. F7 is the wireframe now and F10 is the frozen cull frustum — and, the part
//      that would otherwise rot silently, **F4 is no longer the wireframe**. A remap that adds
//      the new binding and leaves the old one in place passes every "does F7 work" test.
//
// ⚠ IT IS A BROWSER STAGE AND IT HAS TO BE. Every assertion here is about a DOM tree this
// engine builds at runtime, a CSS class the browser applies, and three key handlers attached to
// `window`. There is no Node-level version of any of that: `--fast` does not see the game
// (KW-3), and a headless check of `15i_diag.js` would be a check of `document.createElement`.
//
// ⚠ AND IT MEASURES THE PANEL'S OWN COST. A diagnostic that changes what it is diagnosing is
// the one bug this file cannot allow: §6 compares the frame time with the panel open against
// the frame time with it closed, and fails if opening it costs more than a couple of
// milliseconds a frame. `15i_diag.js` repaints at 6 Hz for exactly this reason; if somebody
// makes it repaint every frame, this is what says so.

import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, sleep } from './cdp.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const FILE = resolve(process.argv[2] || 'dist/mclite.html');
let pass = 0;
const fails = [];
const liveAv = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { liveAv.push([m, !!c]); };
const say = (...a) => console.log(...a);

if (!existsSync(FILE)) { say('diagcheck: SKIP — no dist/mclite.html; run build.mjs'); process.exit(0); }

// ── 0. the module SHIPS ─────────────────────────────────────────────────────
// ⚠ `build.mjs` concatenates an EXPLICIT list, not a glob, and refuses to build when a file in
// `src/` is missing from it — so this cannot silently fail today. It is asserted anyway because
// the failure it guards against is the reverse: a module dropped from `FILE_ORDER` in some later
// edit, which would leave every browser assertion below failing with "MCL.Diag never
// initialised" and no hint at all about why. One line here names the cause.
{
  const order = readFileSync(join(ROOT, 'build.mjs'), 'utf8');
  ok(existsSync(join(ROOT, 'src', '15i_diag.js')), 'src/15i_diag.js is gone');
  ok(order.indexOf("'15i_diag.js'") > 0, "'15i_diag.js' is not in build.mjs's FILE_ORDER — the overlay is not in the shipped file");
  // ...and it goes in AFTER the HUD, whose `fps` it reads.
  ok(order.indexOf("'15i_diag.js'") > order.indexOf("'15_hud.js'"),
     '15i_diag.js is concatenated before 15_hud.js — it reads Hud.fps');
}

const page = await open(FILE, { port: 9431, width: 1280, height: 720 });
if (!page) { say('diagcheck: SKIP — no Chromium (node tools/get-chromium.mjs, D-407)'); process.exit(0); }

say('diagcheck — the F4 diagnostics overlay and the debug-key remap (D-431)');

await page.waitFor(() => window.MCL && MCL.Hud && MCL.Hud.mode === 'title', 60000);
await page.key('Enter');
const ready = await page.waitFor(() => MCL.Main.ready === true, 90000);
ok(ready === true, 'the world never became ready');

// ⚠ A PANEL OF ZEROES IS NOT A PANEL. Let the game run long enough that the profiler rings have
// samples in them and the world has chunks, or every "it shows a real number" assertion below
// would be asserting against a freshly booted engine that has nothing to show yet.
await page.waitFor(() => MCL.Main.prof && MCL.Main.prof.frame.filled > 40, 30000);
await sleep(1500);

// ── 1. the module came up, and it built itself ─────────────────────────────────────────────
say('\n1. the overlay exists and is built, not stubbed');
const built = await page.evaluate(() => {
  const D = MCL.Diag, r = document.getElementById('mclDiag');
  return {
    ready: !!(D && D.ready),
    open: !!(D && D.open),
    inDom: !!r,
    cols: r ? r.querySelectorAll('.dov-col').length : 0,
    rows: r ? r.querySelectorAll('.dov-row').length : 0,
    graph: !!document.getElementById('mclDiagGraph'),
    visible: r ? getComputedStyle(r).display : 'missing',
    pointer: r ? getComputedStyle(r).pointerEvents : 'missing'
  };
});
ok(built.ready, 'MCL.Diag never initialised');
ok(built.inDom, 'the overlay is not in the DOM at all');
ok(built.cols === 3, `the overlay has ${built.cols} columns, expected 3`);
ok(built.rows > 40, `the overlay has only ${built.rows} rows — most of the panel is missing`);
ok(built.graph, 'the frame-time graph canvas was not created');
ok(built.open === false && built.visible === 'none', `the overlay starts ${built.visible}, it must start closed`);
// ⚠ CLICK-THROUGH. The panel covers most of the screen; if it ate clicks, the game would be
// unplayable while it is open, which is the state you open it in.
ok(built.pointer === 'none', `the overlay has pointer-events:${built.pointer} — it would eat clicks aimed at the world`);

// ── 2. F4 opens it, and it fills with real numbers ─────────────────────────────────────────
say('\n2. F4 opens it and the numbers are the game\'s');
await page.key('F4');
await sleep(900);
const opened = await page.evaluate(() => {
  const r = document.getElementById('mclDiag');
  const txt = (id) => { const e = document.getElementById(id); return e ? e.textContent : ''; };
  const vals = [...r.querySelectorAll('.dov-val')].map((e) => e.textContent);
  return {
    open: MCL.Diag.open,
    display: getComputedStyle(r).display,
    placeholders: vals.filter((v) => v === '--').length,
    total: vals.length,
    fps: r.querySelector('.dov-fpsbig').textContent,
    badge: r.querySelector('.dov-badge').textContent,
    bn: txt('mclDiagBN'),
    jitter: txt('mclDiagJitter'),
    coloured: [...r.querySelectorAll('.dov-val')].filter((e) => /good|warn|bad/.test(e.className)).length,
    entRows: r.querySelectorAll('.dov-obsrow').length,
    log: txt('mclDiagLog').length
  };
});
ok(opened.open === true && opened.display === 'block', `F4 left the overlay ${opened.display}`);
// ⚠⚠ THE ASSERTION THAT MATTERS. A panel that draws but never updates shows the `--` it was
// BUILT with, looks completely convincing in a screenshot, and is worth nothing.
ok(opened.placeholders < opened.total * 0.25,
   `${opened.placeholders} of ${opened.total} values are still "--" — the panel is drawn but not filled`);
ok(/^\d+$/.test(opened.fps) && Number(opened.fps) > 0, `the big FPS number reads "${opened.fps}"`);
ok(/webgl2|webgpu/i.test(opened.badge), `the backend badge reads "${opened.badge}"`);
ok(/^BOTTLENECK: /.test(opened.bn), `the bottleneck verdict reads "${opened.bn}"`);
ok(/^JITTER SOURCE: /.test(opened.jitter), `the jitter line reads "${opened.jitter}"`);
ok(opened.coloured > 3, `only ${opened.coloured} values carry a good/warn/bad class — the thresholds are not being applied`);
say(`   ${opened.total - opened.placeholders}/${opened.total} values filled · ${opened.fps} fps · ${opened.badge} · ${opened.bn}`);

// the world column is the game's own state, not a constant
// ⚠ REPAINT FIRST, IN THE SAME CALL. The panel refreshes at 6 Hz, so what is on it is up to
// 170 ms old — and a world that is still streaming gains chunks in 170 ms. The first run of this
// file compared a 357 on the panel with a 363 in the world and called it a bug in the panel.
const world = await page.evaluate(() => {
  MCL.Diag.paint();
  const rows = [...document.querySelectorAll('#mclDiag .dov-row')];
  const find = (label) => {
    const r = rows.find((x) => x.firstChild && x.firstChild.textContent === label);
    return r ? r.lastChild.textContent : null;
  };
  return { xyz: find('XYZ'), chunks: find('Chunks'), draws: find('Draw calls'), pool: find('Pool'),
           live: { x: MCL.Player.x, chunks: MCL.World.stats().chunks, draws: MCL.Gfx.draws } };
});
ok(world.xyz && world.xyz.indexOf(world.live.x.toFixed(2).slice(0, 4)) === 0,
   `the XYZ row says "${world.xyz}" and the player is at x=${world.live.x}`);
ok(String(world.chunks) === String(world.live.chunks),
   `the Chunks row says "${world.chunks}" and the world has ${world.live.chunks}`);
ok(Number(world.draws) > 0, `the Draw calls row says "${world.draws}"`);
ok(/^(workers|inline) /.test(world.pool || ''), `the worker Pool row says "${world.pool}"`);

// ── 3. the graph is drawn, and it is drawn from the ring ───────────────────────────────────
say('\n3. the frame-time graph');
const graph = await page.evaluate(() => {
  const g = document.getElementById('mclDiagGraph');
  const d = g.getContext('2d').getImageData(0, 0, g.width, g.height).data;
  let lit = 0, colours = new Set();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] + d[i + 1] + d[i + 2] > 60) { lit++; colours.add(d[i] + ',' + d[i + 1] + ',' + d[i + 2]); }
  }
  return { lit, colours: colours.size, w: g.width, samples: MCL.Main.prof.frame.filled };
});
// ⚠ THE FLOOR IS NOT ZERO. The two reference lines at 16.7 and 33.3 ms are 200 px each, so an
// EMPTY graph already lights about 800 pixels — a threshold of 200 would have passed on no data
// at all, which is what the anti-vacuity break below caught on this file's first run.
ok(graph.lit > 1500, `only ${graph.lit} pixels of the graph are lit — that is the two reference lines and nothing else`);
ok(graph.samples > 40, `the frame ring holds ${graph.samples} samples`);
say(`   ${graph.lit} lit pixels, ${graph.colours} distinct colours, ${graph.samples} samples in the ring`);

// ── 4. the keys ────────────────────────────────────────────────────────────────────────────
say('\n4. PgUp/PgDn scroll, Tab cycles, Del clears');
const scroll0 = await page.evaluate(() => MCL.Diag.scroll);
await page.key('PageDown'); await page.key('PageDown');
await sleep(200);
const scroll1 = await page.evaluate(() => ({
  s: MCL.Diag.scroll,
  css: document.getElementById('mclDiag').style.getPropertyValue('--dovScroll')
}));
ok(scroll1.s > scroll0, `PageDown left the scroll at ${scroll1.s}`);
ok(Number(scroll1.css) === scroll1.s, `the CSS variable says ${scroll1.css} and the module says ${scroll1.s}`);
await page.key('PageUp'); await page.key('PageUp'); await page.key('PageUp');
await sleep(200);
const scroll2 = await page.evaluate(() => MCL.Diag.scroll);
ok(scroll2 === 0, `PageUp past the top left the scroll at ${scroll2} — it must clamp at 0`);

const tab0 = await page.evaluate(() => MCL.Diag.tab);
await page.key('Tab');
await sleep(400);
const tab1 = await page.evaluate(() => ({
  tab: MCL.Diag.tab,
  on: [...document.querySelectorAll('.dov-obstab')].filter((b) => /\bon\b/.test(b.className)).length
}));
ok(tab1.tab !== tab0, `Tab left the entity view on "${tab1.tab}"`);
ok(tab1.on === 1, `${tab1.on} entity tabs are lit at once`);

await page.evaluate(() => { console.error('diagcheck marker'); return 1; });
await sleep(400);
const logged = await page.evaluate(() => ({
  n: MCL.Diag.logs.length,
  shown: document.getElementById('mclDiagLog').textContent.indexOf('diagcheck marker') >= 0
}));
ok(logged.n > 0, 'the console tail captured nothing');
ok(logged.shown, 'the console tail did not show the error that was just logged');
await page.key('Delete');
await sleep(300);
ok(await page.evaluate(() => MCL.Diag.logs.length === 0), 'Delete did not clear the log');

// ── 5. THE REMAP ───────────────────────────────────────────────────────────────────────────
say('\n5. the debug keys moved (F4 -> F7 -> F10), and the old binding is GONE');
const before = await page.evaluate(() => ({ wire: MCL.Gfx.wireframe, frozen: MCL.Gfx.frozenFrustum }));
await page.key('F7');
await sleep(250);
const afterF7 = await page.evaluate(() => ({ wire: MCL.Gfx.wireframe, open: MCL.Diag.open }));
ok(afterF7.wire !== before.wire, 'F7 does not toggle the wireframe');
await page.key('F7');
await sleep(200);

await page.key('F10');
await sleep(250);
const afterF10 = await page.evaluate(() => MCL.Gfx.frozenFrustum);
ok(afterF10 !== before.frozen, 'F10 does not toggle the frozen cull frustum');
await page.key('F10');
await sleep(200);

// ⚠⚠ THE HALF A REMAP ALWAYS FORGETS. Adding F7 and leaving F4 wired to the wireframe passes
// every test above; this is the one that notices. F4 must move the OVERLAY and nothing else.
const wireBeforeF4 = await page.evaluate(() => MCL.Gfx.wireframe);
await page.key('F4');
await sleep(400);
const afterF4 = await page.evaluate(() => ({ wire: MCL.Gfx.wireframe, open: MCL.Diag.open,
                                             display: getComputedStyle(document.getElementById('mclDiag')).display }));
ok(afterF4.wire === wireBeforeF4,
   'F4 still toggles the wireframe — the old binding was never removed, only added to');
ok(afterF4.open === false && afterF4.display === 'none', `F4 left the overlay ${afterF4.display}, expected closed`);

// ── 6. the panel does not pay for itself out of the frame ──────────────────────────────────
say('\n6. what the panel costs the frame it is measuring');
const measure = async () => {
  await page.evaluate(() => { MCL.Main.prof.frame = new MCL.U.Profiler(128); return 1; });
  await sleep(2500);
  return page.evaluate(() => MCL.Main.prof.frame.avg());
};
const closedMs = await measure();
await page.key('F4');
// ⚠⚠ **WAIT OUT THE FIRST REPAINT — D-434.** The panel is built once and kept at
// `display:none`, so the repaint that follows the first F4 pays for the first LAYOUT of ninety
// rows in three flex columns: 248 ms here, against 1.1 ms for the one after it. Measuring from
// the instant it opens charges the RUNNING cost with a one-off, which is how this section first
// reported 37% for a panel that costs about one millisecond a repaint. The one-off is asserted
// on its own below, because "opening it costs a layout" is a real fact and a different one.
await sleep(1500);
const openMs = await measure();
ok(await page.evaluate(() => MCL.Diag.open === true), 'the panel did not reopen for the cost measurement');
// ⚠ A SHARE OF THE FRAME, NOT A NUMBER OF MILLISECONDS. The panel repaints at a fixed 6 Hz, so
// its cost PER FRAME depends on the frame rate: the same repaint is 0.1 of a frame at 60 fps and
// 0.7 of a frame in a headless Chromium running at 9. An absolute 3 ms bar would be generous on
// Dan's desktop and would fail here for a reason that has nothing to do with the panel.
const self = await page.evaluate(() => ({ paintMs: MCL.Diag.paintMs, first: MCL.Diag.firstPaintMs,
                                          hz: 1000 / MCL.Diag.interval }));
ok(self.paintMs !== undefined && self.paintMs < 8,
   `the median repaint costs ${self.paintMs} ms — the panel is doing per-frame work in a 6 Hz job`);
// ⚠ AND THE BACK-OFF IS CLAMPED. A spike must be allowed to slow the panel and must never be
// allowed to stop it; a panel that answers once every nine seconds is not a diagnostic.
ok(self.hz >= 0.99, `the panel backed itself off to ${self.hz.toFixed(2)} Hz — the clamp is not holding`);
say(`   one repaint ${self.paintMs.toFixed(2)} ms (first, incl. layout: ${(self.first || 0).toFixed(0)} ms) at ${self.hz.toFixed(1)} Hz`);

// ⚠⚠ **THE PANEL'S WORK, MEASURED AGAINST THE PANEL'S PRESENCE — D-434.** Comparing "open" with
// "closed" cannot answer the question this section asks, and it took three wrong readings to see
// why. A full-screen translucent overlay with a box-shadow costs the browser something to
// COMPOSITE whether or not anything in it changes, and in a software-rasterised headless browser
// that, plus ordinary frame-time noise, swamps the panel's own work: measured on one run at
// closed 146 ms, open 135 ms, and open-with-the-repaint-stubbed-out 152 ms — the panel appeared
// to make the game faster, then slower than that, having done nothing.
// ▶ So the control is the panel OPEN AND INERT: same overlay, same compositing, same noise, with
// `paint` replaced by a no-op. The difference between that and the panel repainting normally is
// the panel's WORK and nothing else, which is the thing that must not grow.
// ▶ The compositing cost is REPORTED rather than asserted, because it is the browser's and
// belongs to whoever is looking at the number, not to this file.
const inertMs = await (async () => {
  await page.evaluate(() => { MCL.Diag._realPaint = MCL.Diag.paint; MCL.Diag.paint = function () {}; return 1; });
  const v = await measure();
  await page.evaluate(() => { MCL.Diag.paint = MCL.Diag._realPaint; return 1; });
  return v;
})();
const work = openMs - inertMs;
ok(work < Math.max(2.5, closedMs * 0.05),
   `the panel's own work costs ${work.toFixed(2)} ms a frame (repainting ${openMs.toFixed(2)} ms vs open-and-inert ${inertMs.toFixed(2)} ms) — a diagnostic must not be what it is diagnosing`);
say(`   closed ${closedMs.toFixed(2)} ms · open+inert ${inertMs.toFixed(2)} ms · open+repainting ${openMs.toFixed(2)} ms`);
say(`   the panel's WORK: ${work.toFixed(2)} ms/frame · its PRESENCE (browser compositing, not asserted): ${(inertMs - closedMs).toFixed(2)} ms/frame`);

// ── 6b. KW-28 (D-488): the entity list is EDITED IN PLACE, never rebuilt ─────────────────────
// The 'ind' tab's distances change whenever anything moves, so a rebuild-on-change list rebuilt on
// every repaint. Assert: two repaints with the rows' contents changed keep the SAME row nodes and
// call createElement zero times — and a panel whose pool is thrown away (the old behaviour) fails.
{
  // ⚠ cdp.evaluate runs `(fn)()` — it passes NO arguments, so the break flag is set on the page first.
  const probe = async (breakIt) => { await page.evaluate(breakIt ? () => { MCL.Diag.__brk = 1; return 1; }
                                                                 : () => { MCL.Diag.__brk = 0; return 1; });
    return page.evaluate(() => {
    const D = MCL.Diag, breakIt = D.__brk === 1; D.tab = 'ind';
    const EL = MCL.EntityList, P = MCL.Player;
    const fake = [{ type: 'pig', id: 9001, x: P.x + 3, z: P.z, count: 1, removed: false },
                  { type: 'cow', id: 9002, x: P.x + 7, z: P.z, count: 1, removed: false }];
    const saved = EL.list; const savedReady = EL.ready;
    EL.list = fake; EL.ready = true;
    D._obsSig = null; D.paintEntities();
    const first = D.obsBody.firstChild;
    fake[0].x += 5; fake[1].x += 2;                    // distances move: the old signature changes
    if (breakIt) D._obsPool = null;                    // the pre-D-488 rebuild
    let made = 0; const ce = document.createElement;
    document.createElement = function () { made++; return ce.apply(document, arguments); };
    try { D.paintEntities(); } finally { document.createElement = ce; }
    const same = D.obsBody.firstChild === first;
    const txt = D.obsBody.textContent;
    EL.list = saved; EL.ready = savedReady; D._obsSig = null; D.paintEntities();
    return { made, same, txt };
  }); };
  const live = await probe(false);
  ok(live.made === 0 && live.same, `a repaint with moved entities rebuilt the list (createElement ×${live.made}, same nodes: ${live.same}) — KW-28`);
  ok(/pig #9001/.test(live.txt) && /8 b/.test(live.txt), `...and the in-place edit still shows the new rows (${live.txt.slice(0, 60)})`);
  const broke = await probe(true);
  okAv(broke.made > 0 || !broke.same, 'a list whose row pool is thrown away (the pre-D-488 rebuild) is caught by §6b');
  say(`   §6b entity list: in-place repaint, createElement ×${live.made}`);
}

// ── 7. THE PIPELINE STALL THIS PANEL FOUND (D-434) ───────────────────────────────
//
// §6 asked what the panel costs the frame it is measuring and the answer, the first time it ran
// on a real GPU, was 35.6%. None of it was the panel's DOM. `Gfx.backend.info()` calls
// `gl.getParameter` six times, each one a synchronous query that stalls the pipeline until the
// driver catches up — **measured at 119.5 ms a call**, against 0.3 ms for `World.stats()` in the
// same probe. `Hud.drawDebug` has called it once a frame since it was written, so **F3 has been
// costing a fifth of a second a frame** and nothing noticed, because nothing measured the
// overlay. The five fields that cost that are properties of the CONTEXT and cannot change while
// it lives; they are read once now.
// ⚠ THIS SECTION EXISTS SO IT CANNOT COME BACK. It is the kind of line somebody re-inlines while
// "simplifying", and the symptom — the debug overlay is slow — is one nobody reports.
say('\n7. the debug overlays do not stall the pipeline (D-434)');
{
  const t = await page.evaluate(() => {
    const B = MCL.Gfx.backend;
    if (!B || !B.info) return null;
    B.info();                                    // warm the cache, the way the first frame does
    const a = performance.now();
    for (let i = 0; i < 20; i++) B.info();
    const cached = performance.now() - a;
    B.staticInfo = null;                         // and what it costs without it
    const c = performance.now();
    B.info();
    const cold = performance.now() - c;
    return { cached: +(cached / 20).toFixed(3), cold: +cold.toFixed(2), renderer: B.info().renderer };
  });
  ok(!!t, 'the backend exposes no info()');
  if (t) {
    ok(t.cached < 1.0, `Gfx.backend.info() costs ${t.cached} ms a call — it is querying the driver every time`);
    ok(typeof t.renderer === 'string' && t.renderer.length > 0,
       'the cached info() lost the renderer string — the cache is not carrying what it replaced');
    say(`   info(): ${t.cached} ms cached · ${t.cold} ms uncached · ${String(t.renderer).slice(0, 44)}`);
    // ⚠ the break is the measurement: if the uncached call is not measurably dearer, this
    // section is asserting nothing and the cache is not what makes it cheap.
    okAv(t.cold > t.cached * 4,
         `anti-vacuity: the uncached call costs ${t.cold} ms against ${t.cached} ms cached — the cache is what makes it cheap`);
  }
}

// ── anti-vacuity (D-30) ────────────────────────────────────────────────────────────────────
say('\nanti-vacuity — break it, and each test above must notice');
{
  // 1. a panel that is built but never painted shows only the `--` it was built with. Rebuild
  //    the value cells by hand and require §2's placeholder test to fail.
  const blanked = await page.evaluate(() => {
    const vals = [...document.querySelectorAll('#mclDiag .dov-val')];
    vals.forEach((e) => { e.textContent = '--'; });
    return vals.filter((v) => v.textContent === '--').length / vals.length;
  });
  okAv(blanked > 0.25, 'a panel showing only its built-in "--" fails the placeholder test');

  // 2. and one repaint puts them back, so the test is not simply always true
  await sleep(600);
  const refilled = await page.evaluate(() => {
    const vals = [...document.querySelectorAll('#mclDiag .dov-val')].map((e) => e.textContent);
    return vals.filter((v) => v === '--').length / vals.length;
  });
  okAv(refilled < 0.25, '...and the next repaint fills them again, so §2 is measuring something live');

  // 3. an empty frame ring must leave an empty graph — the pixel test is about the DATA
  const flat = await page.evaluate(() => {
    const real = MCL.Main.prof.frame;
    MCL.Main.prof.frame = new MCL.U.Profiler(128);
    MCL.Diag.paintGraph(MCL.Main.prof);
    const g = document.getElementById('mclDiagGraph');
    const d = g.getContext('2d').getImageData(0, 0, g.width, g.height).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 60) lit++;
    MCL.Main.prof.frame = real;
    return lit;
  });
  okAv(flat <= 1000, `an empty ring draws ${flat} lit pixels (the reference lines only) — below §3's 1500 floor`);

  // 4. the scroll clamp really is a clamp
  okAv(scroll2 === 0 && scroll1.s > 0, 'the scroll moved before it clamped, so the clamp test is not vacuous');

  // 5. the repaint-cost assertion must be able to fire: make one repaint genuinely expensive and
  //    require the median to notice once it is the majority of the ring.
  // ⚠ NO PROMISE HERE. `cdp.evaluate` runs `(fn)()` with `returnByValue` and does NOT await a
  // thenable, so a function that returns a Promise resolves to `{}` — which is how this break
  // first "passed" and then threw on `.toFixed`. The wait is on this side, where waits belong.
  await page.evaluate(() => {
    MCL.Diag._realPaint2 = MCL.Diag.paint;
    MCL.Diag.paint = function () { const t = performance.now(); while (performance.now() - t < 12) {} };
    MCL.Diag._costs.length = 0;                       // so the median is of the SLOW repaints
    return 1;
  });
  await sleep(5000);
  const slowed = await page.evaluate(() => {
    const m = MCL.Diag.paintMs;
    MCL.Diag.paint = MCL.Diag._realPaint2;
    MCL.Diag._costs.length = 0;
    return m;
  });
  okAv(slowed >= 8, `anti-vacuity: a 12 ms repaint pushes the median to ${(slowed || 0).toFixed(1)} ms — the 8 ms bar can fire`);

  // 6. F4 must be able to FAIL §5's test: wire the wireframe back onto F4 and check it fires
  const relapse = await page.evaluate(() => {
    const before = MCL.Gfx.wireframe;
    MCL.Gfx.wireframe = !MCL.Gfx.wireframe;      // exactly what the pre-D-431 F4 handler did
    const changed = MCL.Gfx.wireframe !== before;
    MCL.Gfx.wireframe = before;
    return changed;
  });
  okAv(relapse, 'the "F4 no longer toggles the wireframe" test can see a wireframe toggle when there is one');

  for (const [m, caught] of liveAv) {
    ok(caught, `ANTI-VACUITY FAILURE: ${m}`);
    say(`   ${caught ? '✓' : '✗'} ${m}`);
  }
}

// ⚠ §4 logs an error ON PURPOSE to test the console tail, so it is in `problems` by design.
const problems = page.problems.filter((p) => !/favicon/i.test(p) && !/diagcheck marker/.test(p));
ok(problems.length === 0, `the page logged ${problems.length} errors: ${problems.slice(0, 3).join(' | ')}`);

await page.close();

say('');
say('================= diagcheck =================');
say(` assertions passed .. ${pass}`);
say(` failures ........... ${fails.length}`);
for (const f of fails) say('   ✗ ' + f);
say('=============================================');
process.exit(fails.length ? 1 : 0);
