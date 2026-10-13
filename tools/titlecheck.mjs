#!/usr/bin/env node
// titlecheck.mjs — PLAN blocker B2's acceptance test, and B1's.
//
//   node tools/titlecheck.mjs [dist/mclite.html]
//
// Loads the real built file at file://, exactly the way Dan opens it, and asserts:
//   B2  the game shows a TITLE SCREEN and does NOT generate a world until Play is pressed
//   B2  the seed field takes typing and the seed it produces is the one the world uses
//   B1  the renderer that actually starts is WebGL2, not WebGPU
//   --  pressing Play really does reach a running world, with no console errors
//   --  and, from session 2, that the world it reaches is made of registry real states
//   W4  the CLIMATE toggle is on the title screen, and clicking 'Earth' really does start a
//       world whose main thread AND workers generate in Earth mode with the chosen scale
//
// It types and presses keys like a person rather than calling internals, because the bug B2
// fixes is "it launches straight in", and only a real key press can show that it no longer does.
//
// ⚠ NO PLAYWRIGHT. This used to import it, which made the check un-runnable on any machine
// that had not happened to install a matching browser build — it was the one red stage when
// session 2 opened. It now drives headless Chromium over the DevTools protocol through
// tools/cdp.mjs, the same way tools/smoke.mjs always has, with no dependency at all.

import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { open, findChrome, sleep } from './cdp.mjs';
import { decodePng, meanLuma, fractionNear, histogram } from './pngdec.mjs';

const FILE = resolve(process.argv[2] || 'dist/mclite.html');
if (!existsSync(FILE)) { console.error('no such file: ' + FILE); process.exit(2); }
if (!findChrome()) { console.log('SKIP  titlecheck: no Chromium found (set $CHROME to run it)'); process.exit(0); }

let pass = 0; const fails = [];
// Anti-vacuity breaks that need a LIVE page: `page` is closed before the section at the
// bottom of this file, so those breaks are run in place and reported down there with the rest.
const liveAv = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

const page = await open(FILE, { port: 9414, width: 1280, height: 720 });
await sleep(1800);

// ── B2: it must stop at the title ─────────────────────────────────────────────────────────
const st = await page.evaluate(() => ({
  mode: MCL.Hud.mode,
  ready: !!MCL.Main.ready,
  worldBuilt: !!(MCL.World && MCL.World.chunks && MCL.World.chunks.size),
  seedField: MCL.Hud.titleSeed,
  blocksInited: !!(MCL.Blocks && MCL.Blocks.inited),
  regReady: !!(MCL.Reg && MCL.Reg.ready),
  statesReady: !!(MCL.States && MCL.States.ready),
  stateCount: MCL.States ? MCL.States.count : 0,
  hits: MCL.Hud.hit.length,
}));
ok(st && st.mode === 'title', `after load the HUD mode is "${st && st.mode}", expected "title" — the game still launches straight in`);
ok(!st.ready, 'Main.ready must be false at the title screen');
ok(!st.worldBuilt, 'no chunks may exist before Play is pressed');
ok(!st.blocksInited, 'the block table must not be built before Play — that work belongs after the menu');
ok(st.hits >= 4, `the title screen registered ${st.hits} clickable regions, expected at least 4`);
ok(st.seedField === '', `a new world's seed field must start empty (blank = random), got "${st.seedField}"`);
const blanks = await page.evaluate(() => [MCL.Main.resolveSeed(''), MCL.Main.resolveSeed('  '), MCL.Main.resolveSeed(''), MCL.Main.resolveSeed('')]);
ok(new Set(blanks).size > 1 && blanks.every((n) => Number.isInteger(n)),
   `blank seed fields must give fresh random seeds, got ${blanks.join(',')}`);
ok(blanks.every((n) => n !== 1337), 'a blank seed field must not fall back to 1337');

// ⚠ The registry is the exception, and deliberately so: it is decoded BEFORE the title because
// everything after that point asks it questions and because a failure has to land on the
// loading screen with a message rather than three seconds later as a black world.
ok(st.regReady, 'the registry must be decoded before the title screen is shown');
ok(st.statesReady && st.stateCount > 20000,
   `the per-state tables must be built with the registry (ready=${st.statesReady}, count=${st.stateCount})`);

// ── B2: typing changes the seed, and the world uses what was typed ────────────────────────
for (let i = 0; i < 24; i++) await page.key('Backspace');
await page.key('-', '-', 'Minus');            // #385: a NEGATIVE seed, the case that was widened unsigned
for (const ch of '5') await page.key(ch, ch, 'Digit' + ch);
await sleep(150);
const typed = await page.evaluate(() => MCL.Hud.titleSeed);
ok(typed === '-5', `typing did not reach the seed field: "${typed}"`);

// a non-numeric seed must hash rather than be rejected
const hashed = await page.evaluate(() => MCL.Main.parseSeed('glacier'));
const same = await page.evaluate(() => MCL.Main.parseSeed('glacier'));
// 'glacier ' would trim to the same thing, which is correct behaviour and a bad test case —
// the first draft used it and failed. Use two genuinely different words.
const other = await page.evaluate(() => MCL.Main.parseSeed('glacial'));
ok(typeof hashed === 'number' && isFinite(hashed), 'a word seed must hash to a number');
ok(hashed === same, 'the same word must always hash to the same seed');
ok(hashed !== other, 'different words must give different seeds');
ok(await page.evaluate(() => MCL.Main.parseSeed('12345')) === 12345, 'a numeric seed must be used as-is');
ok(await page.evaluate(() => MCL.Main.parseSeed('  glacier  ')) === hashed, 'surrounding whitespace must not change a seed');

// ── press Play, the way a person does ─────────────────────────────────────────────────────
await page.key('Enter');
const became = await page.waitFor(() => MCL.Main.ready === true, 90000);
ok(became === true, 'the world never became ready within 90s after pressing Play');
await sleep(1000);

const after = await page.evaluate(() => {
  const W = MCL.World, SR = MCL.States;
  // walk a column of the spawn chunk and record what the world is actually made of
  const seen = Object.create(null);
  let nonAir = 0, aboveLegacy = 0;
  for (let y = -60; y < 120; y++) {
    const s = W.getBlock(Math.floor(MCL.Player.x), y, Math.floor(MCL.Player.z));
    if (!s) continue;
    nonAir++;
    if (s > 60) aboveLegacy++;                      // beyond anything the 49-id table could hold
    seen[SR.name(s)] = (seen[SR.name(s)] || 0) + 1;
  }
  return {
    mode: MCL.Hud.mode,
    backend: MCL.Gfx.name,
    reason: MCL.Gfx.fallbackReason,
    seed: MCL.Main.seed, genSeed: MCL.Gen.seed, worldSeed: MCL.World.seed, saveSeed: MCL.Save.seed,
    chunks: MCL.World.chunks.size,
    blocks: MCL.Reg.blockCount,
    states: MCL.States.count,
    nonAir, aboveLegacy,
    kinds: Object.keys(seen).sort(),
  };
});
ok(after.mode === 'game', `after Play the HUD mode is "${after.mode}", expected "game"`);
ok(after.chunks > 0, 'the world must have chunks after Play');
ok(after.blocks > 800, 'the registry must hold the full roster after Play');
ok(after.seed === -5 && after.genSeed === -5 && after.worldSeed === -5 && after.saveSeed === -5,
   `seed -5 must reach Main/Gen/World/Save signed, got ${after.seed}/${after.genSeed}/${after.worldSeed}/${after.saveSeed}`);
ok(after.seed === parseSeedLocal(typed),
   `the world used seed ${after.seed}, which does not match the typed "${typed}"`);
function parseSeedLocal(t) { return MCL_parseLow(t); }
function MCL_parseLow(t) { const n = BigInt(t.trim()); return Number(BigInt.asIntN(32, n)); }

// ── session 2: the world is made of REAL STATES, not the old 49 ids ──────────────────────
// The whole swap in one assertion. Every id the old table could produce was under 50; a column
// of a generated world now holds numbers in the thousands, and every one of them names itself.
ok(after.nonAir > 20, `the spawn column had only ${after.nonAir} non-air blocks to look at`);
ok(after.aboveLegacy > 0,
   'every block in the spawn column has an id under 60 — the world is still storing legacy ids');
ok(after.kinds.every((n) => n && n !== '?' && !n.startsWith('?')),
   `some blocks in the world do not resolve to a name: ${after.kinds.join(' ')}`);

// ── B1: WebGL2 is what actually started ──────────────────────────────────────────────────
ok(after.backend === 'webgl2',
   `renderer started as "${after.backend}", expected "webgl2" — WebGPU renders black on Dan's card (D-15)`);
ok(/default backend|forced to webgl2|navigator\.gpu/.test(after.reason || ''),
   `the backend choice should record why it took WebGL2, got "${after.reason}"`);

ok(page.problems.length === 0, `${page.problems.length} console errors: ${page.problems.slice(0, 3).join(' | ')}`);

// ── W4: the climate machinery is live in the built file ──────────────────────────────────
const clim = await page.evaluate(() => {
  const CL = MCL.Climate, x = Math.floor(MCL.Player.x), z = Math.floor(MCL.Player.z);
  return {
    ready: !!(CL && CL.ready), colReady: !!(MCL.Column && MCL.Column.ready),
    mode: CL ? CL.mode : -1, entries: CL ? CL.entryCount : 0, nodes: CL ? CL.nodeCount : 0,
    // ⚠ two different counts: the TABLE dispatches to 50, the REGISTRY holds 61, and after
    // `bindBiomes` the index space is the registry's. See 04e_climate.js.
    biomes: CL ? CL.tableBiomeNames.length : 0, registry: CL ? CL.biomeNames.length : 0,
    bound: !!(CL && CL.bound), surfaceReady: !!(MCL.Surface && MCL.Surface.ready),
    here: CL && CL.ready ? CL.surfaceBiomeAt(x, z) : -1,
    name: CL && CL.ready ? CL.biomeNames[CL.surfaceBiomeAt(x, z)] : '',
    line: MCL.Hud.climateLine(x, Math.floor(MCL.Player.y), z),
    params: MCL.Main.genParams(),
  };
});
ok(clim.ready && clim.colReady, 'the climate table and the column function must be up in the built file');
ok(clim.entries === 7578 && clim.biomes === 50, `the built file carries ${clim.entries} entries over ${clim.biomes} biomes`);
ok(clim.registry === 61 && clim.bound, `the climate table is not bound to the 61-biome registry (${clim.registry}, bound=${clim.bound})`);
ok(clim.surfaceReady, 'the surface rules did not compile in the built file');
ok(clim.nodes > 100, `the baked R-tree did not survive the build (${clim.nodes} nodes)`);
// ⚠ D-182: the DEFAULT is Earth mode now. It was vanilla until session 5, and this line said
// so; the ruling was Dan's — the latitude climate model is "the point of this project, not a
// nice-to-have", so it is what a player gets without pressing anything. Vanilla multi-noise is
// still one button away, and the Vanilla button is exercised below rather than assumed.
ok(clim.mode === 1, `a default world must be in EARTH climate mode (D-182), got ${clim.mode}`);
ok(/^minecraft:[a-z_]+$/.test(clim.name), `the spawn column dispatched to "${clim.name}"`);
ok(clim.line.indexOf('earth') > 0 && clim.line.indexOf('lat') > 0,
   `the F3 climate line reads "${clim.line}"`);
ok(clim.params.climate === 'earth' && clim.params.worldScale === 12000,
   `genParams gave ${JSON.stringify(clim.params.climate)} / ${clim.params.worldScale}`);

// ── W6: the biome tint seam, live in the shipped file (D-121) ────────────────────────────
// `tintcheck` proves the map's arithmetic on the CPU. This proves the WIRE: that a chunk
// arriving from a worker paints the map, that the map reached the GPU, and that the colour
// standing at the player is the colour of the biome the player is standing in.
// ⚠ D-214 / D-196 — THE SECTION BELOW RUNS AT A PRESET DAN PLAYS AT, WHATEVER THIS MACHINE
// DETECTED. `Settings.detect()` clamps to Celeron on a two-core box, and at render distance 4
// chunks arrive in bursts with quiet gaps between them, so every sample of the tint seam this
// project has ever taken landed in a gap. At medium and high a chunk arrives on nearly every
// frame, and that is what exposed the frame-driven upload: the GPU sat one to six versions
// behind the map for as long as the world was streaming. Passing at Celeron alone is how the
// bug survived five sessions, so the seam is measured with the render distance turned up and
// the check refuses to run if it did not go up.
const tintPreset = await page.evaluate(() => {
  const S = MCL.Settings;
  // never DOWN: a run forced to high must stay at high
  if (S.ORDER.indexOf(S.preset) < S.ORDER.indexOf('medium')) S.applyPreset('medium', { save: false });
  // ⚠ the adaptive loop (D-46) answers a slow machine by pulling the distance down a chunk per
  // 120 frames — on a software renderer it walked medium's 12 to 10 while this waited, and the
  // seam went unmeasured (D-413). This measures the seam, not the governor, so pin it (cullcheck does).
  S.adaptive = false;
  if (S.preset !== 'custom' && S.PRESETS[S.preset]) S.setRenderDistance(Math.max(S.renderDistance, S.PRESETS[S.preset].renderDistance));
  return { preset: S.preset, rd: S.renderDistance };
});
ok(tintPreset.rd >= 12,
   `the tint seam is being measured at render distance ${tintPreset.rd} (preset ${tintPreset.preset}) — D-214 is invisible below 12`);
// let the wider ring stream in, so chunks really are landing between frames while we look
await page.waitFor(() => MCL.World.chunks.size > 90, 90000);
await sleep(2500);

const tint = await page.evaluate(() => {
  const T = MCL.Tint, B = MCL.Biomes, W = MCL.World, G = MCL.Gfx;
  // every loaded chunk inside the window, at all sixteen of its quart-cell centres
  let agree = 0, checked = 0, covered = 0;
  const colours = Object.create(null);
  W.chunks.forEach((c) => {
    if (!c.biome || !T.covers(c.cx, c.cz)) return;
    covered++;
    for (let q = 0; q < 16; q++) {
      const lx = ((q & 3) << 2) + 2, lz = ((q >> 2) << 2) + 2;
      const wx = (c.cx << 4) + lx, wz = (c.cz << 4) + lz;
      const want = B.tintColor(1, c.biome[(lz << 4) | lx], wx, wz) & 0xffffff;
      checked++;
      if (T.sample(1, wx, wz) === want) agree++;
      colours[want] = 1;
    }
  });
  // and the one texel the player is standing on, taken from the biome rather than the chunk
  const qx = ((Math.floor(MCL.Player.x) >> 2) << 2) + 2, qz = ((Math.floor(MCL.Player.z) >> 2) << 2) + 2;
  const here = MCL.Climate.surfaceBiomeAt(qx, qz);
  return {
    ready: T.ready, fills: T.fills, reanchors: T.reanchors, version: T.version, uploaded: T.uploaded,
    size: T.SIZE, layers: T.LAYERS, texels: G.TINT_TEXELS, glLayers: G.TINT_LAYERS,
    bytes: T.data ? T.data.length : 0,
    tex: !!(MCL.GfxGL && MCL.GfxGL.tintTex), texVersion: MCL.GfxGL ? MCL.GfxGL.tintVersion : -2,
    agree, checked, covered, distinct: Object.keys(colours).length,
    name: B.name(here),
    got: [T.sample(1, qx, qz), T.sample(2, qx, qz), T.sample(3, qx, qz)],
    want: [B.tintColor(1, here, qx, qz) & 0xffffff, B.tintColor(2, here, qx, qz) & 0xffffff,
           B.tintColor(3, here, qx, qz) & 0xffffff],
  };
});
ok(tint.ready && tint.bytes === 786432, `the tint map is ${tint.bytes} bytes, ready=${tint.ready}`);
ok(tint.size === tint.texels && tint.layers === tint.glLayers,
   `the map is ${tint.size}x${tint.layers} and the renderer expects ${tint.texels}x${tint.glLayers}`);
ok(tint.fills >= 20, `only ${tint.fills} chunks painted the tint map — the install seam is not wired`);
ok(tint.reanchors >= 1, 'the tint map was never anchored');
ok(tint.covered > 20 && tint.checked > 300, `only ${tint.covered} loaded chunks were inside the window`);
ok(tint.agree === tint.checked,
   `${tint.checked - tint.agree} of ${tint.checked} texels do not hold their own chunk's biome colour`);
ok(tint.distinct >= 1, 'the map holds no colours at all');
ok(tint.got[0] === tint.want[0] && tint.got[1] === tint.want[1] && tint.got[2] === tint.want[2],
   `the player stands in ${tint.name} but the map reads ${tint.got.map((c) => (c >>> 0).toString(16))}` +
   ` instead of ${tint.want.map((c) => (c >>> 0).toString(16))}`);
// ⚠ the GPU half. A perfect CPU map that never reaches the texture is a world of plains green.
ok(tint.tex, 'the WebGL2 backend has no tint texture');
ok(tint.texVersion === tint.version && tint.uploaded === tint.version,
   `the map is at version ${tint.version} but the GPU has ${tint.texVersion} — it is not being uploaded`);

// ⚠ D-214 — THE CADENCE, and it is the half a version counter read at rest cannot see.
// The map is written from the promise that settles when a worker returns a chunk: between
// frames, at a moment no part of the frame loop chose. If the upload waits for the next
// `beginFrame` then the GPU is stale for as long as that takes, which at medium is every
// frame of the whole stream-in. So: stop the loop outright, write to the map, and require the
// GPU to be current with NO frame having run in between.
const cadence = await page.evaluate(() => {
  const T = MCL.Tint, W = MCL.World, L = MCL.GfxGL, G = MCL.Gfx;
  MCL.Main.stop();
  const drawsBefore = G.draws, framesBefore = MCL.Main.frame;
  let target = null;
  W.chunks.forEach((c) => { if (!target && c.biome && T.covers(c.cx, c.cz)) target = c; });
  if (!target) { MCL.Main.start(); return { target: false }; }
  const v0 = T.version, u0 = L.tintVersion, up0 = T.uploads;
  const wrote = T.fillChunk(target.cx, target.cz, target.biome);
  const out = {
    target: true, wrote, v0, u0, up0,
    v1: T.version, u1: L.tintVersion, uploaded: T.uploaded, up1: T.uploads,
    // a whole re-anchor, still with the loop stopped
    reV: 0, reU: 0, reUploads: 0,
    draws: G.draws - drawsBefore, frames: MCL.Main.frame - framesBefore,
    dirtyEmpty: T.dirtyEmpty(),
  };
  T.follow(W, T.originX - 8, T.originZ + T.BLOCKS / 2);
  out.reV = T.version; out.reU = L.tintVersion; out.reUploads = T.uploads - out.up1;
  out.reDraws = G.draws - drawsBefore;
  // put the window back under the player before the frame loop resumes
  T.anchor(MCL.Player.x | 0, MCL.Player.z | 0);
  T.refill(W);
  MCL.Main.start();
  return out;
});
ok(cadence.target, 'no loaded chunk was inside the tint window to write with the loop stopped');
ok(cadence.wrote === true, 'the probe write was refused');
ok(cadence.frames === 0 && cadence.draws === 0,
   `${cadence.frames} frames and ${cadence.draws} draws happened while the loop was stopped — the probe proves nothing`);
ok(cadence.v1 === cadence.v0 + 1, `one fillChunk moved the version by ${cadence.v1 - cadence.v0}`);
ok(cadence.up1 === cadence.up0 + 1, `one fillChunk ran the upload ${cadence.up1 - cadence.up0} times, not once`);
ok(cadence.u1 === cadence.v1 && cadence.uploaded === cadence.v1,
   `a write with no frame after it left the GPU at ${cadence.u1} and the map at ${cadence.v1} (D-214)`);
ok(cadence.dirtyEmpty, 'the backend took the upload but left the dirty rectangle behind');
ok(cadence.reDraws === 0, `${cadence.reDraws} draws slipped into the re-anchor probe`);
ok(cadence.reU === cadence.reV,
   `a re-anchor with no frame after it left the GPU at ${cadence.reU} and the map at ${cadence.reV} (D-214)`);
ok(cadence.reUploads >= 1 && cadence.reUploads <= 2,
   `a re-anchor of the whole map ran the upload ${cadence.reUploads} times — it must be the clear and the refill, not one per chunk`);

// ⚠ D-30 — and this one has to run against the LIVE page, so it is here rather than in the
// anti-vacuity section at the bottom, which runs after `page` is closed. Put the frame-driven
// upload back — a sink of null is exactly what the code did before D-214 — and require the two
// assertions above to go red. If they do not, they are measuring nothing.
{
  const broke = await page.evaluate(() => {
    const T = MCL.Tint, W = MCL.World, L = MCL.GfxGL;
    MCL.Main.stop();
    const sink = T.sink;
    T.sink = null;                       // frame-driven again
    let target = null;
    W.chunks.forEach((c) => { if (!target && c.biome && T.covers(c.cx, c.cz)) target = c; });
    const v0 = T.version, u0 = L.tintVersion;
    if (target) T.fillChunk(target.cx, target.cz, target.biome);
    const out = { had: !!target, lag: T.version - L.tintVersion, moved: T.version - v0, u0, u1: L.tintVersion };
    T.sink = sink;                       // and put it back, with the write still owed
    T.flush();
    out.after = T.version - L.tintVersion;
    MCL.Main.start();
    return out;
  });
  const caught = broke.had && broke.moved === 1 && broke.lag === 1 && broke.after === 0;
  liveAv.push(['the tint upload driven by the frame instead of by the write', caught]);
}

// hand the rest of the check back the preset it started with
await page.evaluate(() => MCL.Settings.applyPreset(MCL.Settings.detected, { save: false }));
await sleep(1200);

// ── ⚠ THE PICTURE. Does the world have a surface? (PLAN §23) ─────────────────────────────
//
// Every other assertion in this suite tests a stage. Five hundred and fifty thousand of them
// passed while the game drew the ground as a hole in the sky, because the defects were all in
// the joins between stages and nothing had ever LOOKED at the frame. This does.
//
// The player is put in the air over the world looking straight down. Whatever is below — grass,
// sand, stone, water, leaves — there must be something there, and it must not be the sky.
{
  // ⚠ EIGHTEEN blocks up, not a hundred and fifty. The headless machine detects the Celeron
  // preset, whose render distance is four chunks — from high up the ground is simply beyond it
  // and the frame is honestly all sky. The first draft of this assertion failed for that reason
  // and would have been "fixed" by loosening it, which would have thrown the whole test away.
  await page.send('Runtime.evaluate', { expression:
    'MCL.Player.creative = true; MCL.Player.flying = true;' +
    'MCL.Player.y = MCL.Column.height(Math.floor(MCL.Player.x), Math.floor(MCL.Player.z)) + 18;' +
    'MCL.Player.vy = 0; MCL.Player.pitch = -1.45; MCL.Player.yaw = 0.4;' });
  // long enough for the chunks under a fresh viewpoint to generate, mesh and upload
  const up = await page.waitFor(() => MCL.Gfx.draws > 20 && MCL.World.chunks.size > 40, 60000);
  await sleep(1800);
  await page.evaluate(() => { MCL.Hud.showDebug = false; return 1; });
  await sleep(1200);
  const shot = await page.send('Page.captureScreenshot', { format: 'png' });
  const img = decodePng(Buffer.from(shot.data, 'base64'));
  // the middle of the frame, away from the HUD at the bottom and any horizon at the very top
  const x0 = Math.round(img.width * 0.2), w = Math.round(img.width * 0.6);
  const y0 = Math.round(img.height * 0.15), h = Math.round(img.height * 0.5);
  const sky = await page.evaluate(() => {
    const s = MCL.Gfx.sky;
    return (Math.round(s[0] * 255) << 16) | (Math.round(s[1] * 255) << 8) | Math.round(s[2] * 255);
  });
  const skyFrac = fractionNear(img, x0, y0, w, h, sky, 12);
  const luma = meanLuma(img, x0, y0, w, h);
  const top = histogram(img, x0, y0, w, h).slice(0, 3)
    .map(([c, n]) => '#' + c.toString(16).padStart(6, '0') + '×' + n).join(' ');
  ok(up === true, 'the world never drew enough sections from the air to judge the picture');
  // ⚠ THE ASSERTION. Looking straight down from 150 blocks, the ground fills the frame. A
  // little sky at the edges of the render distance is normal; a third of the view being sky is
  // the world with its surface missing, which is exactly what shipped.
  ok(skyFrac < 0.30,
     `looking straight down from 18 blocks up, ${(skyFrac * 100).toFixed(1)}% of the frame is sky — the ground is not being drawn`);
  // and it must not be BLACK either: geometry drawn with no light looks like a hole too
  ok(luma > 0.12, `the view straight down has a mean luma of ${luma.toFixed(3)} — the ground is drawn but unlit`);
  ok(luma < 0.92, `the view straight down has a mean luma of ${luma.toFixed(3)} — that is not terrain`);
  console.log(`   straight down: ${(skyFrac * 100).toFixed(1)}% sky, luma ${luma.toFixed(3)}, ${top}`);
}

// ── and the model stream in particular, which is what was invisible ─────────────────────────
{
  const ms = await page.evaluate(() => {
    let withModel = 0, quads = 0;
    MCL.Gfx.meshes.forEach((m) => {
      const h = m.handle;
      if (h && h.modelQuads) {
        const q = h.modelQuads[0] + h.modelQuads[1] + h.modelQuads[2];
        if (q) { withModel++; quads += q; }
      }
    });
    return { withModel, quads, modelTris: MCL.Gfx.modelTris, tris: MCL.Gfx.tris,
             decor: MCL.States.decor ? MCL.States.decor[MCL.States.stateOf('grass_block')] : -1 };
  });
  ok(ms.withModel > 5, `only ${ms.withModel} sections carry model geometry on the GPU`);
  ok(ms.quads > 500, `only ${ms.quads} model quads reached the GPU`);
  // ⚠ D-131: the section can hold the geometry and still never be in the draw list.
  ok(ms.modelTris > 0, 'the model stream drew NOTHING this frame — every slab, stair, plant and grass block is invisible');
  ok(ms.decor === 0, 'grass_block is classified as decor in the shipped file');
  console.log(`   model stream: ${ms.quads} quads on ${ms.withModel} sections, ${ms.modelTris} triangles drawn`);
}

await page.close();

// ── W4: a second boot, in Earth mode, started by clicking the button ─────────────────────
// A toggle whose other position is never started is a toggle with one setting. This presses
// 'Earth' and a world-scale button on the real title screen, at their real pixels, and then
// requires the world that comes up to be generating in Earth mode — in the WORKERS too, which
// is where a parameter that fails to travel would show up as two threads disagreeing.
const page2 = await open(FILE, { port: 9415, width: 1280, height: 720 });
await sleep(1800);
let btn = await page2.evaluate(() => {
  const find = (l) => { const r = MCL.Hud.hit.find((h) => h.label === l); return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : null; };
  return { earth: find('Earth'), vanilla: find('Vanilla'), labels: MCL.Hud.hit.map((h) => h.label).filter(Boolean) };
});
ok(!!btn.earth && !!btn.vanilla, `the title screen has no climate buttons: ${btn.labels.join(' ')}`);
// D-182 made Earth the default, which means the VANILLA path is the one that can now rot
// unnoticed. Press its button for real and require the world type to follow, before going on
// to Earth. A button that exists and does nothing is exactly what a screenshot cannot see.
if (btn.vanilla) {
  await page2.click(btn.vanilla.x, btn.vanilla.y);
  await sleep(200);
  const backToVanilla = await page2.evaluate(() => ({
    climate: MCL.Save.climate, scale: MCL.Save.worldScale,
    scaleRow: !!MCL.Hud.hit.find((h) => h.label === '6k'),
  }));
  ok(backToVanilla.climate === 'vanilla',
     `pressing Vanilla left the climate as "${backToVanilla.climate}" (D-182: the alternative must still work)`);
  ok(backToVanilla.scale === 12000,
     `pressing Vanilla left the world scale at ${backToVanilla.scale}`);
  // ⚠ AND THE BUTTON MOVED. Choosing Vanilla removes the world-scale row, so every hit box
  // below it shifts up and the Earth coordinates read a moment ago now point at empty screen.
  // The first version of this section clicked the stale pixel, got no world type change, and
  // failed six assertions downstream with a message about workers — which is what a click test
  // that caches coordinates across a layout change always looks like. Re-read the hit boxes
  // after any click that can reflow the screen.
  btn.earth = await page2.evaluate(() => {
    const r = MCL.Hud.hit.find((h) => h.label === 'Earth');
    return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : null;
  });
  ok(!!btn.earth, 'the Earth button vanished after choosing Vanilla');
}
if (btn.earth) {
  await page2.click(btn.earth.x, btn.earth.y);
  await sleep(200);
  const scaleBtn = await page2.evaluate(() => {
    const r = MCL.Hud.hit.find((h) => h.label === '6k');
    return { pt: r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : null, climate: MCL.Save.climate };
  });
  ok(scaleBtn.climate === 'earth', `clicking Earth left the climate as "${scaleBtn.climate}"`);
  ok(!!scaleBtn.pt, 'the world-scale row did not appear after choosing Earth');
  if (scaleBtn.pt) await page2.click(scaleBtn.pt.x, scaleBtn.pt.y);
  await sleep(200);
  const chosen = await page2.evaluate(() => ({ climate: MCL.Save.climate, scale: MCL.Save.worldScale }));
  ok(chosen.scale === 6000, `clicking the 6k scale button left the scale at ${chosen.scale}`);

  // ── #329: the World Type cycle (vanilla MoreOptionsDialog's map-type button) ──────────
  // A click steps forward Default -> Large Biomes -> AMPLIFIED -> Default, a shift-click steps
  // back, and the label is `selectWorld.mapType` + `generator.<type>`. The hit box is re-read
  // after every click because its LABEL is what changes.
  const wtBtn = () => page2.evaluate(() => {
    const r = MCL.Hud.hit.find((h) => /^World Type: /.test(h.label || ''));
    return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2, label: r.label, type: MCL.Save.worldType } : null;
  });
  let wt = await wtBtn();
  ok(!!wt && wt.label === 'World Type: Default' && wt.type === 'default',
     `#329: the title screen's World Type button reads ${wt && wt.label} / ${wt && wt.type}`);
  const seen = [];
  for (let k = 0; k < 3 && wt; k++) {
    await page2.click(wt.x, wt.y); await sleep(150);
    wt = await wtBtn(); seen.push(wt ? wt.type + '=' + wt.label : 'gone');
  }
  ok(seen.join(',') === 'large_biomes=World Type: Large Biomes,amplified=World Type: AMPLIFIED,default=World Type: Default',
     `#329: the World Type cycle went ${seen.join(', ')}`);
  if (wt) {   // shift-click steps backwards, as CyclingButtonWidget does with Screen.hasShiftDown()
    await page2.evaluate(() => { MCL.Input.shift = true; return 1; });
    await page2.click(wt.x, wt.y); await sleep(150);
    await page2.evaluate(() => { MCL.Input.shift = false; return 1; });
    wt = await wtBtn();
    ok(wt && wt.type === 'amplified', `#329: a shift-click from Default went to ${wt && wt.type}, not AMPLIFIED`);
    ok(await page2.evaluate(() => MCL.Hud.hit.some((h) => h.label === 'World Type: AMPLIFIED')),
       '#329: the button does not read "World Type: AMPLIFIED" after the shift-click');
    // and on to Large Biomes, which is the world this page goes on to play
    await page2.click(wt.x, wt.y); await sleep(150);
    await page2.click(wt.x, wt.y); await sleep(150);
    wt = await wtBtn();
    ok(wt && wt.type === 'large_biomes', `#329: could not select Large Biomes (${wt && wt.type})`);
  }

  await page2.key('Enter');
  const up = await page2.waitFor(() => MCL.Main.ready === true, 90000);
  ok(up === true, 'the Earth-mode world never became ready within 90s');
  await sleep(1200);
  const e = await page2.evaluate(() => {
    const CL = MCL.Climate, x = Math.floor(MCL.Player.x), z = Math.floor(MCL.Player.z);
    return {
      mode: CL.mode, scale: MCL.Earth.scale, ready: MCL.Earth.ready,
      chunks: MCL.World.chunks.size,
      report: MCL.Earth.report(x, z),
      name: CL.biomeNames[CL.surfaceBiomeAt(x, z)],
      line: MCL.Hud.climateLine(x, Math.floor(MCL.Player.y), z),
      jobs: MCL.Jobs.mode, workers: MCL.Jobs.workers.length,
      sent: MCL.Jobs.genParams ? MCL.Jobs.genParams.climate : null,
      sentType: MCL.Jobs.genParams ? MCL.Jobs.genParams.worldType : null,
      colType: MCL.Column.worldType, colNoise: MCL.Column.noiseIds && MCL.Column.noiseIds.continentalness,
      saved: null,
    };
  });
  ok(e.mode === 1, `after choosing Earth the world runs in climate mode ${e.mode}`);
  ok(e.ready && e.scale === 6000, `Earth.init got scale ${e.scale}`);
  ok(e.chunks > 0, 'the Earth-mode world has no chunks');
  ok(e.sent === 'earth', `the workers were sent climate "${e.sent}" — the parameter did not travel`);
  ok(e.sentType === 'large_biomes', `#329: the workers were sent world type "${e.sentType}"`);
  ok(e.colType === 'large_biomes' && e.colNoise === 'continentalness_large',
     `#329: the main thread's column function runs ${e.colType} / ${e.colNoise}`);
  ok(isFinite(e.report.tempC) && isFinite(e.report.precipMm),
     `the climate report is not numeric: ${JSON.stringify(e.report)}`);
  ok(Math.abs(e.report.latitude) <= 90, `latitude ${e.report.latitude} is out of range`);
  ok(/^minecraft:[a-z_]+$/.test(e.name), `the Earth-mode spawn column dispatched to "${e.name}"`);
  ok(e.line.indexOf('earth') > 0 && e.line.indexOf('lat') > 0, `the F3 climate line reads "${e.line}"`);
  ok(page2.problems.length === 0, `${page2.problems.length} console errors in Earth mode: ${page2.problems.slice(0, 3).join(' | ')}`);
  // and the world must survive a save/load round trip with its climate intact
  const rt = await page2.evaluate(() => {
    MCL.Save.save(false);
    const raw = JSON.parse(localStorage.getItem(MCL.Save.KEY));
    MCL.Save.climate = 'vanilla'; MCL.Save.worldScale = 12000; MCL.Save.worldType = 'default';
    MCL.Save.load();
    return { stored: raw.climate, storedScale: raw.worldScale, back: MCL.Save.climate, backScale: MCL.Save.worldScale,
             storedType: raw.worldType, backType: MCL.Save.worldType };
  });
  ok(rt.storedType === 'large_biomes' && rt.backType === 'large_biomes',
     `#329: the world type round-tripped as ${rt.storedType} -> ${rt.backType}`);
  ok(rt.stored === 'earth' && rt.storedScale === 6000, `the save envelope holds ${rt.stored}/${rt.storedScale}`);
  ok(rt.back === 'earth' && rt.backScale === 6000, `after a reload the world came back as ${rt.back}/${rt.backScale}`);
}

// ── D-426: a LOCKED climate row must look locked, stay locked, and say why ───────────
//
// Dan, session 55: "you cant click earth on world load screen." It was locked on purpose
// (D-111: climate cannot change under a world that has been built in) but the lock lived only
// inside the click handler, so the button drew live, lit up on hover like a live one, and then
// ate the click in silence. This section asserts all three halves of a proper disabled control,
// IN BOTH DIRECTIONS (rule 6): unlocked it must change the climate; locked it must not, must be
// drawn a different colour, and must leave a reason behind that names the way out.
//
// ⚠ The probe reads the hit region and samples the canvas IN THE SAME CALL. `cdp.evaluate`
// runs a zero-argument function, so a coordinate computed on this side cannot travel into it,
// and a coordinate cached across a redraw is the trap D-182's section already documents.
{
  // ⚠ A THIRD PAGE. `page2` has already pressed Enter by here and is inside the world, so the
  // title screen it would be asked about no longer exists — the first run of this section failed
  // with "no Vanilla button", which is a fact about the harness, not the game (cdp.mjs' rule).
  const page3 = await open(FILE, { port: 9416, width: 1280, height: 720 });
  await sleep(1800);
  const probe = () => page3.evaluate(() => {
    const r = MCL.Hud.hit.find((h) => h.label === 'Vanilla');
    if (!r) return null;
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const d = MCL.Hud.ctx.getImageData((cx * MCL.Hud.dpr) | 0, (cy * MCL.Hud.dpr) | 0, 1, 1).data;
    return { x: cx, y: cy, rgb: [d[0], d[1], d[2]], climate: MCL.Save.climate, note: MCL.Hud.titleNote || '' };
  });

  // unlocked first, so the LIVE colour is measured rather than assumed
  await page3.evaluate(() => { MCL.Hud.titleHasSave = false; MCL.Save.climate = 'earth'; MCL.Hud.titleNote = ''; return 1; });
  await sleep(250);
  const live = await probe();
  ok(!!live, 'D-426: no Vanilla button on the title screen to measure');

  if (live) {
    await page3.click(live.x, live.y);
    await sleep(250);
    const unlocked = await page3.evaluate(() => MCL.Save.climate);
    ok(unlocked === 'vanilla',
       `D-426: unlocked, pressing Vanilla left the climate as "${unlocked}" — the lock cannot be the only half that works`);

    // now lock it, exactly as a saved world does
    await page3.evaluate(() => { MCL.Save.climate = 'earth'; MCL.Hud.titleHasSave = true; MCL.Hud.titleNote = ''; return 1; });
    await sleep(250);
    const dead = await probe();
    ok(!!dead, 'D-426: the locked climate row pushes no hit region at all — it cannot explain itself');
    if (dead) {
      ok(dead.rgb[0] !== live.rgb[0] || dead.rgb[1] !== live.rgb[1] || dead.rgb[2] !== live.rgb[2],
         `D-426: the locked button is drawn in the live colour rgb(${dead.rgb.join(',')}) — a dead button that looks alive IS the bug`);

      await page3.click(dead.x, dead.y);
      await sleep(250);
      const after426 = await page3.evaluate(() => ({ climate: MCL.Save.climate, note: MCL.Hud.titleNote || '' }));
      ok(after426.climate === 'earth',
         `D-426: the LOCK broke — pressing Vanilla on a saved world changed the climate to "${after426.climate}"`);
      ok(after426.note.length > 0,
         'D-426: pressing a locked climate button left no reason behind — that silence is the reported bug');
      ok(/New world/i.test(after426.note),
         `D-426: the reason does not say how to unlock it: "${after426.note}"`);

      // live anti-vacuity: put the PRE-D-426 behaviour back — a hit region whose handler does
      // nothing at all — and require the "it said why" assertion above to notice. A break that
      // cannot fire is not a break (D-305).
      const silent = await page3.evaluate(() => {
        MCL.Hud.titleNote = '';
        const r = MCL.Hud.hit.find((h) => h.label === 'Vanilla');
        if (!r) return 'no button';
        r.fn = function () {};
        r.fn();
        return MCL.Hud.titleNote || '';
      });
      liveAv.push(['a locked climate button that swallows the click in silence', silent === '']);
    }
  }

  // #387: an existing world's seed is fixed (vanilla: level.dat). Typing on a saved world must
  // change nothing, and Continue must keep the saved seed.
  {
    await page3.evaluate(() => { MCL.Hud.titleHasSave = true; return 1; });
    const before = await page3.evaluate(() => ({ seed: MCL.Main.seed, box: MCL.Hud.titleSeed }));
    await page3.key('Backspace');
    await page3.key('7', '7', 'Digit7');
    const typed = await page3.evaluate(() => MCL.Hud.titleSeed);
    ok(typed === before.box, `#387: typing on a saved world's seed field changed it: "${before.box}" -> "${typed}"`);
    await page3.key('Enter');
    const played = await page3.evaluate(() => MCL.Main.seed);
    ok(played === before.seed, `#387: Continue world re-seeded the save: ${before.seed} -> ${played}`);
    // live anti-vacuity: with the lock off, the same keys DO change the box
    const open = await page3.evaluate(() => {
      MCL.Hud.mode = 'title'; MCL.Hud.titleHasSave = false; MCL.Hud.titleSeed = '1337'; MCL.Hud.titleKey('7');
      return MCL.Hud.titleSeed;
    });
    liveAv.push(['an unlocked seed field on a saved world accepts typing', open !== '1337']);
  }

  await page3.close();
}

await page2.close();

// ─────────────────────────────────────────────── anti-vacuity (D-30)
//
// ⚠ Session 4: titlecheck was one of the four checks in the suite with no anti-vacuity section,
// and it is the one that most needs one — its strongest assertions are statements about an
// IMAGE ("less than 30% of the frame is sky", "the mean luma is above 0.12"), and an image
// measurement that always returns the same number passes every threshold. Each break below
// hands the file's OWN measuring functions a synthetic frame that is wrong in the exact way the
// threshold claims to catch, and requires the measurement to say so.
console.log('anti-vacuity — break the picture, and the measurement must notice');
{
  const av = [];
  const brk = (label, fn) => { let caught = false; try { fn(); } catch { caught = true; } av.push([label, caught]); };
  const solid = (w, h, r, g, b) => {
    const data = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) { data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255; }
    // ⚠ `channels` matters: `pixelAt` indexes by it, and a synthetic frame without it reads
    // as all zeroes — which would make every break below pass for the wrong reason.
    return { width: w, height: h, channels: 4, data };
  };

  brk('a frame that is nothing but sky, measured as ground', () => {
    const skyBlue = 0x88AAFF;
    const img = solid(64, 64, 0x88, 0xAA, 0xFF);
    const frac = fractionNear(img, 0, 0, 64, 64, skyBlue, 12);
    if (frac > 0.9) throw 0;                 // the measurement sees it, as it must
  });

  brk('a black frame passing the "the ground is lit" threshold', () => {
    const img = solid(64, 64, 0, 0, 0);
    if (meanLuma(img, 0, 0, 64, 64) < 0.12) throw 0;
  });

  brk('a white frame passing the "that is terrain" ceiling', () => {
    const img = solid(64, 64, 255, 255, 255);
    if (meanLuma(img, 0, 0, 64, 64) > 0.92) throw 0;
  });

  brk('a histogram that cannot tell two colours apart', () => {
    const img = solid(32, 32, 10, 20, 30);
    const h = histogram(img, 0, 0, 32, 32);
    if (h.length === 1 && h[0][1] === 32 * 32) throw 0;
  });

  for (const [label, caught] of liveAv) av.push([label, caught]);

  for (const [label, caught] of av) {
    ok(caught, `ANTI-VACUITY FAILURE: "${label}" was not caught — this check proves nothing`);
    console.log(`   ${caught ? '✓' : '✗'} ${label}`);
  }
}

console.log('');
console.log('================ titlecheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log('');
console.log(` mode ${st.mode} -> ${after.mode} · backend ${after.backend} · chunks ${after.chunks}`);
console.log(` climate  default boot (earth, D-182): ${clim.name} · vanilla and earth both pressed on the real title screen`);
console.log(` tint ${tint.fills} chunks painted · ${tint.agree}/${tint.checked} texels agree · ${tint.distinct} grass colours · GPU v${tint.texVersion}`);
console.log(` cadence measured at preset ${tintPreset.preset} (rd ${tintPreset.rd}) · a write with no frame after it reached the GPU (D-214)`);
console.log(` roster ${after.blocks} blocks / ${after.states} states · spawn column: ${after.kinds.join(' ')}`);
console.log('===========================================');
process.exit(fails.length ? 1 : 0);
