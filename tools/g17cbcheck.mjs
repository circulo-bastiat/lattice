#!/usr/bin/env node
// g17cbcheck.mjs — PLAN G17c, THE BROWSER HALF: an entity reaches the screen, and it moves.
//
//   MCLITE_PRESET=medium node tools/g17cbcheck.mjs [dist/mclite.html]
//
// ⚠⚠ **WHY THIS FILE IS MANDATORY AND NOT OPTIONAL.** PLAN says it in as many words: *"this is
// where a browser check is mandatory — G16b is the argument: a stage whose output is a moving
// picture and whose checks only hold numbers is a stage that can ship drawing nothing"*
// (D-303, D-304). G17a and G17b are both behind green checks and until today neither of them had
// ever put a single entity on a screen. `g17ccheck` holds the arithmetic — the vertex stream, the
// placement, the roster. This one boots the real file, spawns a falling block in front of the
// camera, and asserts the PIXELS changed and then kept changing as it fell.
//
// ⚠ EVERY CLAIM IS MADE AGAINST A CONTROL. Two screenshots of a live game are never identical
// for free — chunks arrive, water animates, the sun moves — so "the entity appeared" is always
// "the frame changed more than doing nothing changes it", never a bare threshold (D-234).

import { open, sleep } from './cdp.mjs';
import { decodePng, toRgba } from './pngdec.mjs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const FILE = args[0] ? (args[0].startsWith('/') ? args[0] : ROOT + args[0]) : ROOT + 'dist/mclite.html';

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('ok    ' + m); } else { fails.push(m); console.log('FAIL  ' + m); } return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };

function compare(a, b) {
  if (a.width !== b.width || a.height !== b.height) return { diff: 1, pixels: a.width * a.height };
  let differing = 0, sum = 0, total = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) +
              Math.abs(a.data[i + 2] - b.data[i + 2]);
    total++;
    if (d > 12) differing++;
    sum += d;
  }
  return { diff: sum / (total * 765), pixels: differing, total };
}

/**
 * The same comparison, restricted to a RECTANGLE of the frame.
 *
 * ⚠⚠ **SECTION 4 ASKS WHETHER THE BLOCK MOVED, SO IT SHOULD LOOK WHERE THE BLOCK IS.** Measured
 * over the whole frame its fall is worth about 3,400 changed pixels — and this world is a forest,
 * whose own churn between two frames reached **11,341**. That is not noise to be waited out: the
 * check sat in a `quiet()` loop twenty times and the world never went still enough, because the
 * thing being measured is three metres away down a carved shaft and everything else on screen is
 * a canopy. **A claim about a small object in a busy frame has to be made about its own pixels.**
 * The shaft is carved straight ahead, so the middle of the frame IS the region of interest, and
 * the control is measured through the same window — which is what keeps it a control.
 */
function compareBox(a, b, x0, y0, x1, y1) {
  if (a.width !== b.width || a.height !== b.height) return { diff: 1, pixels: a.width * a.height };
  let differing = 0, sum = 0, total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * a.width + x) * 4;
      const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) +
                Math.abs(a.data[i + 2] - b.data[i + 2]);
      total++;
      if (d > 12) differing++;
      sum += d;
    }
  }
  return { diff: sum / (total * 765), pixels: differing, total };
}
/**
 * A screen rectangle, as FRACTIONS of the viewport, turned into pixels for `compareBox`.
 *
 * ⚠⚠ **THE RECTANGLE COMES FROM THE ENGINE'S OWN CAMERA, NOT A GUESS AT THE LAYOUT** (D-347).
 * The draft before this one used "the middle half of the frame" on the reasoning that the shaft
 * is carved straight ahead. It measured **0 px** for a block that was demonstrably falling —
 * because by the time the second shot was taken the block had left the frame entirely, and a
 * rectangle chosen by eye cannot tell "not there" from "never drawn". `boxOf` asks the shipped
 * `cam.viewProj` where the entity's own box projects, so the window is wherever the renderer
 * actually put it, at whatever resolution the screenshot came back at.
 */
const boxPx = (f, img, pad) => {
  const p = pad === undefined ? 0.012 : pad;
  const cx = (v) => Math.max(0, Math.min(img.width, Math.round(v * img.width)));
  const cy = (v) => Math.max(0, Math.min(img.height, Math.round(v * img.height)));
  return [cx(f.u0 - p), cy(f.v0 - p), cx(f.u1 + p), cy(f.v1 + p)];
};
const boxArea = (b) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);

const page = await open(FILE, { port: 9421, width: 960, height: 540 });
if (!page) {
  console.log('g17cbcheck: SKIP — no Chromium on this machine (cdp.mjs found none)');
  process.exit(0);
}

try {
  await sleep(1800);
  // ⚠⚠ **START THE WORLD THE WAY `worldcheck` DOES, AND CLEAR THE PAUSE SCREEN.** Pressing Enter
  // on the title gets a world, but headless Chromium has no pointer lock, so the game raises its
  // pause overlay — and `Main`'s loop sets `acc = 0` while `Hud.screen` is set. The first draft
  // of this file spawned a falling block into a world whose clock was stopped and reported
  // "it moved DOWN (70.00 -> 70.00)", which is a correct engine failing a check that had put it
  // in a menu. The RENDERER keeps running, which is exactly why the failure was confusing:
  // §5's tnt drew perfectly while §4's falling block sat still.
  await page.evaluate(() => { if (MCL && MCL.Main && !MCL.Main.ready) MCL.Main.play(9161); return 1; });
  const ready = await page.waitFor(() => (MCL.Hud && MCL.Hud.mode === 'game' && MCL.Player
    && MCL.EntityList && MCL.EntityList.ready) ? 1 : 0, 90000);
  if (!ok(!!ready, 'the world came up')) throw new Error('no world');
  await page.evaluate(() => { MCL.Hud.screen = null; return 1; });
  const ticking = await page.waitFor(() => {
    if (!window.__t0) { window.__t0 = MCL.Main.ticks | 0; return 0; }
    return ((MCL.Main.ticks | 0) - window.__t0) > 10 ? 1 : 0;
  }, 30000);
  ok(!!ticking, 'and its clock is running — no menu is holding the tick at zero');

  // Park in the air over open ground, looking slightly down, with nothing else moving: the
  // adaptive render distance off (D-46) and the debug overlay off, exactly as cullcheck does.
  await page.send('Runtime.evaluate', { expression:
    'MCL.Player.creative = true; MCL.Player.flying = true;' +
    'MCL.Player.y = MCL.Column.height(Math.floor(MCL.Player.x), Math.floor(MCL.Player.z)) + 12;' +
    'MCL.Player.vy = 0; MCL.Player.pitch = 0; MCL.Player.yaw = 0; MCL.Hud.showDebug = false;' +
    // ⚠ D-407: hold natural spawning off BEFORE clearing, the same switch g18ccheck uses (D-397):
    // this check predates live spawning and every "exactly this entity" claim below assumes an
    // otherwise empty world. Found by the first browser sweep on `.chromium/`.
    'if (MCL.Spawn) MCL.Spawn.ready = false;' +
    'MCL.Settings.adaptive = false; MCL.EntityList.clear(); MCL.Hud.screen = null;' +
    // ⚠⚠ **STOP THE SKY, OR THE SKY IS WHAT THIS FILE MEASURES.** Every claim here is "the frame
    // changed more than doing nothing changes it", and over the three minutes this check runs the
    // day/night cycle moves enough to shift **ten thousand pixels between two frames 700 ms
    // apart** — several times what a block four metres away is worth. The noise floor climbed as
    // the run went on and §4 and §5 failed at the end while §3 passed at the start, which is the
    // signature of a drifting baseline rather than a broken renderer.
    'if (MCL.Sky) { MCL.Sky.daylightCycle = false; MCL.Sky.weatherCycle = false; var wD660 = MCL.Sky.weather; if (wD660) { wD660.raining = wD660.thundering = false; wD660.rainLevel = wD660.oRainLevel = wD660.thunderLevel = wD660.oThunderLevel = 0; } }' });
  await page.waitFor(() => MCL.Gfx.draws > 10 && MCL.World.chunks.size > 30, 60000);
  // D-660: the init hook runs before the world's weather exists; a world that BOOTS raining keeps
  // raining with the cycle frozen, and since D-654 rain is drawn — different streaks every frame.
  await page.evaluate(() => { const w = MCL.Sky && MCL.Sky.weather; if (w) { w.raining = w.thundering = false; w.rainLevel = w.oRainLevel = w.thunderLevel = w.oThunderLevel = 0; } return 1; });
  // ⚠⚠ **NINE SECONDS WAS A GUESS AND IT STOPPED BEING ENOUGH** (D-345). This file has a `quiet`
  // helper that waits for two frames to agree — but it gives up after twelve tries, and while
  // chunks are still streaming they never do. It went green for two sessions and then failed on
  // a WORKING renderer the day the shipped file grew by 240 KB and the boot timing shifted: a
  // control of 1,050 px against a falling block worth 1,129. The chunk stream is finite, so wait
  // for it to CAP rather than for a clock; `session.settleWorld` is the shared wait, because
  // `spritecheck` met the identical fault and a second copy of it would drift.
  const capped = await page.settleWorld();
  console.log(`   the chunk stream capped at ${capped} columns`);
  // Chunks that streamed in while settling brought worldgen entities (village golems, item drops)
  // that the clear above could not have seen; every "exactly this entity" claim needs them gone.
  // D-421: the world's BLOCK entities (chests, beds, banners of generated structures) are drawn
  // into the same frame buffer and counted in entityTris/entitiesDrawn; they are becheck's
  // subject, and the spinning mobs in spawner cages (#168, virtual, never in EL.list) are another.
  // Left in, they put 4 "drawn" and 336 triangles under every "exactly this entity" claim.
  await page.evaluate(() => { MCL.EntityList.clear(); MCL.EntityRender.beWorldVisible = function () { return []; }; MCL.EntityRender.spawnerDisplays = function () { return []; }; return 1; });

  const shot = async () => {
    const s = await page.send('Page.captureScreenshot', { format: 'png' });
    return toRgba(decodePng(Buffer.from(s.data, 'base64')));
  };
  const ev = (src) => page.evaluate(new Function(src));
  /**
   * ⚠ WAIT FOR A FRAME, NOT FOR A CLOCK. `Gfx.stats()` is per-frame state: read it before the
   * next frame has run and it still describes the last one. A fixed `sleep` is a guess about
   * how fast a headless browser draws, which is the same class of mistake as timing a furnace
   * with a stopwatch.
   */
  // ⚠⚠ **`Gfx.draws` IS PER-FRAME, NOT CUMULATIVE** — the render function zeroes it and counts
  // draw calls into it — so waiting for it to "advance by four" is waiting on a number that goes
  // up and down. It worked by accident most of the time and timed out the rest, which is the
  // worst way for a helper to be wrong. `Main.frame` is the monotonic one.
  const frames = (n) => page.waitFor(new Function(`
    if (window.__fb === undefined) { window.__fb = MCL.Main.frame | 0; return 0; }
    if (((MCL.Main.frame | 0) - window.__fb) < ${n}) return 0;
    window.__fb = undefined; return 1;`), 20000);

  /**
   * WHERE THE SHIPPED RENDERER PUTS AN ENTITY ON THE SCREEN, asked of the shipped renderer.
   *
   * It projects the eight corners of the entity type's OWN box (`Entities.boxAt`, the table
   * vanilla's `EntityDimensions` gave us — this file owns no width, D-305) through `Gfx.cam`
   * exactly as the vertex shader does, and returns the bounding rectangle as fractions of the
   * viewport so the screenshot's resolution is nobody's business.
   *
   * ⚠ `cam.viewProj` IS CAMERA-RELATIVE (D-179) — the eye is the origin — so the corner is
   * offset by the camera position before it is multiplied, which is what the backends do.
   * ⚠ AND THE PROJECTION IS NOT TAKEN ON TRUST: section 3 asserts that the block's arrival is
   * visible INSIDE this rectangle and invisible outside it. A wrong matrix layout, a flipped
   * Y or a canvas that does not fill the viewport all fail there, loudly, on the one claim in
   * this file that is known to be true for independent reasons.
   */
  const boxOf = (id) => ev(`
    var G = MCL.Gfx, EL = MCL.EntityList, E = MCL.Entities;
    var e = EL.byId(${id});
    if (!e || !G.cam || !E) return null;
    var b = E.boxAt(e.type, e.x, e.y, e.z);
    if (!b) return null;
    var m = G.cam.viewProj, cx = G.cam.x, cy = G.cam.y, cz = G.cam.z;
    var minx = 2, miny = 2, maxx = -2, maxy = -2, behind = 0;
    for (var i = 0; i < 8; i++) {
      var X = (i & 1 ? b[3] : b[0]) - cx;
      var Y = (i & 2 ? b[4] : b[1]) - cy;
      var Z = (i & 4 ? b[5] : b[2]) - cz;
      var w = m[3] * X + m[7] * Y + m[11] * Z + m[15];
      if (w <= 1e-6) { behind++; continue; }
      var ux = ((m[0] * X + m[4] * Y + m[8] * Z + m[12]) / w) * 0.5 + 0.5;
      var uy = 0.5 - ((m[1] * X + m[5] * Y + m[9] * Z + m[13]) / w) * 0.5;
      if (ux < minx) minx = ux;
      if (ux > maxx) maxx = ux;
      if (uy < miny) miny = uy;
      if (uy > maxy) maxy = uy;
    }
    return { u0: minx, v0: miny, u1: maxx, v1: maxy, behind: behind,
             y: e.y,
             onScreen: behind === 0 && maxx > 0.02 && minx < 0.98 && maxy > 0.02 && miny < 0.98 };`);

  // ── 1. the renderer is wired at all ─────────────────────────────────────────────────────
  console.log('\n1. the entity renderer is in the shipped file and is up');
  const up = await ev('return { ready: !!(MCL.EntityRender && MCL.EntityRender.ready),' +
    ' shapes: MCL.EntityRender ? Object.keys(MCL.DATA.entities.motion).filter(function (t) {' +
    '   return !!MCL.EntityRender.SHAPE[t] || !!MCL.EntityRender.mobLayerFor(t); }) : [],' +   // D-407: the mob path draws too
    ' owed: MCL.EntityRender ? MCL.EntityRender.OWED.length : -1,' +
    ' spawnable: Object.keys(MCL.DATA.entities.motion).length,' +
    ' hook: typeof MCL.Gfx.stats().entityTris === "number" };');
  ok(up.ready, 'EntityRender.init ran in the game, not only in the checks');
  ok(up.shapes.indexOf('falling_block') >= 0 && up.shapes.indexOf('tnt') >= 0,
     `it knows how to draw ${up.shapes.join(' and ')}`);
  ok(up.owed + up.shapes.length === up.spawnable,
     `${up.shapes.length} drawn + ${up.owed} owed = ${up.spawnable} spawnable`);
  ok(up.hook === true, 'the renderer reports an entity triangle count, so the frame has a place for them');

  // ── 2. nothing is drawn when nothing is there ───────────────────────────────────────────
  console.log('\n2. an empty world draws no entity triangles');
  await frames(3);   // entityTris is the LAST frame's; let one be built after the clear
  const idle = await ev('return { tris: MCL.Gfx.stats().entityTris, n: MCL.EntityList.count() };');
  ok(idle.n === 0, 'the entity list is empty');
  ok(idle.tris === 0, `and no entity triangles are submitted (${idle.tris})`);

  /**
   * ⚠⚠ **THE CONTROL IS TAKEN FRESH BESIDE EVERY CLAIM, NOT ONCE AT THE TOP.** A live world's
   * noise floor is not constant: chunks are still arriving early on, the sun moves, water
   * animates. The first draft measured it once — 0 px — and then compared a later, noisier pair
   * against that number and called a correct engine a failure. A control is only a control if it
   * was taken in the same conditions as the thing it is controlling for.
   */
  /**
   * Two shots with a gap, and the difference between them.
   *
   * ⚠⚠ **THE GAP IS A NUMBER OF FRAMES, NOT A NUMBER OF MILLISECONDS** (D-345). A headless
   * software renderer on two cores draws about four frames a SECOND, so a 260 ms gap can contain
   * no new frame at all — and `captureScreenshot` then hands back the very same picture twice.
   * §4 reported "the picture changed as it fell: **0 px**" of a block that was demonstrably
   * falling, because both of its shots were the same frame. The millisecond gap is kept as a
   * FLOOR so the world still advances; the frame wait is what makes the second shot a new one.
   */
  const control = async (gapMs) => {
    const a = await shot();
    if (gapMs) await sleep(gapMs);
    await frames(2);
    return compare(a, await shot());
  };
  /**
   * ⚠⚠ **WAIT FOR THE WORLD TO GO QUIET BEFORE MEASURING ANYTHING.** A freshly-carved column
   * remeshes, chunks keep arriving, and for several seconds afterwards two consecutive frames
   * differ by tens of thousands of pixels — more than a block three metres from the eye covers.
   * Comparing against a noise floor taken during that is how this file called a working
   * renderer broken three times in one run. This waits until doing nothing changes less than
   * `limit`, and returns the control it settled on so the caller compares against a real one.
   */
  const quiet = async (limit, tries) => {
    let c = null;
    for (let i = 0; i < (tries || 12); i++) {
      c = await control(500);
      if (c.pixels < limit) return c;
    }
    return c;
  };
  const ctrl0 = await control(700);
  console.log(`   control at this point: ${ctrl0.pixels} px differ of ${ctrl0.total} (${(ctrl0.diff * 100).toFixed(3)}%)`);

  // ── 3. a falling block APPEARS ──────────────────────────────────────────────────────────
  console.log('\n3. a falling block reaches the screen');
  // ⚠ THE COLUMN IS CARVED BEFORE THE "BEFORE" FRAME IS TAKEN, or the remesh of the cleared
  // air would be counted as the entity appearing.
  // ⚠⚠ **CLEAR THE AIR FIRST, THE WAY `worldcheck` §5b DOES.** The first draft dropped the block
  // wherever the player happened to be floating and reported "it moved DOWN (70.00 -> 70.00)"
  // with the clock demonstrably running — because the spot three metres ahead was inside a tree.
  // A collision sweep that correctly refuses to move a block already inside leaves is not a
  // failure of the renderer, and a check that cannot tell those apart is worse than no check.
  let spawned = await ev(`
    var P = MCL.Player, S = MCL.States, EL = MCL.EntityList, W = MCL.World;
    // three blocks in front of the eye, a little below it, so it is unambiguously in frame
    // ⚠ YAW IS ZERO BY THE TIME THIS RUNS (the setup sets it), and at yaw zero the camera looks
    // down -Z, so "four blocks in front" is a subtraction and nothing has to be derived.
    var fx = Math.floor(P.x), fz = Math.floor(P.z) - 4;
    // ⚠ FOURTEEN BLOCKS OF HEADROOM, NOT ONE. The draft before this carved a single block of air
    // under the entity; it fell, landed, and sat still — correctly — before §4 took its first
    // reading, and the check reported "it moved DOWN (73.00 -> 73.00)" of an engine that had
    // just done exactly what it should. A fall takes about 26 ticks to cover fourteen blocks
    // (0.04 per tick, squared), and §4 watches for 24, so it is still in the air throughout.
    // ⚠ AT EYE LEVEL, NOT FOURTEEN BLOCKS BELOW IT. An earlier draft put the block two below
    // the player's feet and four away; at some spawns that is outside a 70-degree field of view
    // altogether, and the check reported "0 px differ" — a renderer that was working perfectly
    // and a camera pointed at the sky. Eye height is about 1.6 above the player's y, so fy + 1
    // puts the cube's middle within a few degrees of the centre of the screen at any spawn.
    // (⚠ AND NO BACKTICKS IN THIS STRING. It is a template literal; a backtick inside one has
    // broken a check in this project four times now, always in a file whose comment says so.)
    var fy = Math.floor(P.y) + 1;
    for (var dx = -1; dx <= 1; dx++) for (var dz = -1; dz <= 1; dz++) {
      W.setBlock(fx + dx, fy - 25, fz + dz, S.stateOf('stone'));
      for (var dy = -24; dy <= 3; dy++) W.setBlock(fx + dx, fy + dy, fz + dz, 0);
    }
    // ⚠⚠ **AND A CORRIDOR TO IT, OR THE SHAFT'S OWN WALLS ARE WHAT YOU PHOTOGRAPH.** The block is
    // four metres away down a three-wide shaft; from outside the shaft its walls hide most of it,
    // and the "did it appear" comparison fell to 207 pixels against a noise floor of 318 — the
    // renderer working perfectly and the camera looking at a stone doorway. Clearing the span
    // between the eye and the column makes the measurement about the block.
    for (var cz = 0; cz <= 5; cz++) for (var cx = -1; cx <= 1; cx++) {
      for (var cy = -1; cy <= 2; cy++) W.setBlock(fx + cx, fy + cy, fz + cz, 0);
    }
    window.__g17 = { fx: fx, fy: fy, fz: fz };
    return { fx: fx, fy: fy, fz: fz };`);

  // ⚠⚠ **THE "BEFORE" FRAME IS TAKEN BEFORE THE SPAWN, NOT BY HIDING THE ENTITY.** The draft
  // before this one spawned first and then teleported the block to x = 1,000,000 to get a clean
  // frame — and the entity never fell again afterwards, because a tick spent in an ungenerated
  // chunk is not a tick you can undo by writing the coordinates back. The check was breaking the
  // thing it was measuring. Carve, settle, shoot, THEN spawn.
  await frames(6);
  await sleep(1500);
  // ⚠ THE CONTROL FOR THIS CLAIM IS TAKEN HERE, with the column already carved and the world
  // settled — not at the top of the file, and not until the picture has actually gone still.
  const ctrl = await quiet(1500, 20);
  console.log(`   control beside the spawn: ${ctrl.pixels} px (was ${ctrl0.pixels} before settling)`);
  ok(ctrl.pixels < 4000, `the world went quiet enough to measure against (${ctrl.pixels} px)`);
  // ⚠ TWO "BEFORE" FRAMES, NOT ONE. The second is what the spawn is compared against; the PAIR
  // is the control for the SAME claim measured in the block's own rectangle below. A control
  // taken over the whole frame cannot speak for a hundred-pixel box in the middle of it, and a
  // control taken at a different moment is not a control at all.
  const before0 = await shot();
  await sleep(260);
  await frames(2);
  const before = await shot();
  const spawn2 = await ev(`
    var S = MCL.States, EL = MCL.EntityList, g = window.__g17;
    // #1923: a loaded box let something else into the list between the clear and here; "exactly one" is the claim.
    if (MCL.Spawn) MCL.Spawn.ready = false; EL.clear();
    var e = EL.spawn('falling_block', g.fx + 0.5, g.fy, g.fz + 0.5, { state: S.stateOf('sand') });
    g.id = e ? e.id : 0; g.y0 = e ? e.y : 0;
    // ⚠⚠ **HELD STILL WHILE ITS APPEARANCE IS MEASURED** (D-345). This section's claim is "a
    // falling block reaches the screen", not "it reaches the screen while falling at a given
    // rate" — section 4 owns the falling, and re-lifts the block to do it. On this two-core box
    // with SwiftShader a single FRAME is about seventeen ticks, so between the spawn and the
    // screenshot the block covered TWELVE METRES and ended 72 degrees off the view axis: the
    // check photographed an empty shaft and reported a working renderer as broken. Gravity is
    // a real per-entity field the engine honours, so the entity is held, not faked, and the real
    // value is read out first and put back below.
    // (NO BACKTICKS IN THIS STRING - it is a template literal, and that has broken a check in
    // this project EIGHT times now, always in a file whose own comment says not to.)
    g.grav = e ? e.gravity : 0;
    if (e) { e.gravity = 0; e.vy = 0; }
    return { id: g.id, count: EL.count(), state: e ? e.state : 0,
             y0: e ? e.y : 0, grav: g.grav };`);
  Object.assign(spawned, spawn2);
  ok(spawned.id > 0 && spawned.count === 1, `one falling block exists (id ${spawned.id})`);
  ok(spawned.state > 0, 'and it carries a real block state');
  ok(spawned.grav > 0, `with a measured gravity of ${spawned.grav}`);
  // ⚠⚠ **WAIT FOR THE ENTITY TO HAVE BEEN DRAWN, NOT FOR FOUR FRAMES** (D-345). A frame is not a
  // unit of time: on this two-core box with SwiftShader and a ten-megabyte page, four frames is
  // about 1.75 SECONDS, which is 35 ticks, and a falling block covers **twenty-four metres** in
  // that. The added diagnostic below said so in one line — *"24.94 m away, 80.8 deg off the view
  // axis, and has fallen 24 m since it spawned"* — after two runs had reported nothing worse than
  // a small pixel count. The check was photographing an empty shaft and blaming the renderer.
  // ⚠ The state it actually wants is "the renderer has drawn an entity", so that is what it waits
  // for, and the shot is taken in the same breath.
  ok(!!(await page.waitFor(function () {
    return (MCL.Gfx.stats().entitiesDrawn | 0) >= 1 ? 1 : 0;
  }, 20000)), 'the renderer drew the entity in a frame');
  const drawStats = await ev('return { tris: MCL.Gfx.stats().entityTris, drawn: MCL.Gfx.stats().entitiesDrawn,' +
    ' clipped: MCL.Gfx.stats().entitiesClipped };');
  ok(drawStats.drawn === 1, `the frame built geometry for it (${drawStats.drawn} entity)`);
  ok(drawStats.tris >= 4, `and submitted ${drawStats.tris} triangles for it`);
  ok(drawStats.clipped === 0, 'nothing was clipped');

  const after = await shot();
  const appeared = compare(before, after);
  // ⚠ SAY WHERE THE THING IS, NOT JUST HOW MANY PIXELS CHANGED. "34 px vs a control of 5" is a
  // number with no cause in it; twice now this file has reported a small diff for a renderer
  // that was working and a camera that was pointed somewhere else. These four numbers name the
  // difference between "not drawn" and "drawn, off to one side" without another run.
  const where = await ev(`
    var P = MCL.Player, g = window.__g17, EL = MCL.EntityList;
    var e = EL.list.filter(function (x) { return !x.removed; })[0];
    if (!e) return null;
    var eye = P.y + (P.eyeHeight === undefined ? 1.62 : P.eyeHeight);
    var f = P.lookVec ? P.lookVec() : [0, 0, -1];
    var dx = e.x - P.x, dy = e.y - eye, dz = e.z - P.z;
    var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    var dot = (dx * f[0] + dy * f[1] + dz * f[2]) / (d || 1);
    return { ex: +e.x.toFixed(2), ey: +e.y.toFixed(2), ez: +e.z.toFixed(2),
             px: +P.x.toFixed(2), eye: +eye.toFixed(2), pz: +P.z.toFixed(2),
             fell: +(g.y0 - e.y).toFixed(2), dist: +d.toFixed(2),
             offAxisDeg: +(Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI).toFixed(1) };`);
  if (where) {
    console.log(`   it is ${where.dist} m away, ${where.offAxisDeg} deg off the view axis, ` +
                `and has fallen ${where.fell} m since it spawned`);
  }
  console.log(`   appearing: ${appeared.pixels} px differ (${(appeared.diff * 100).toFixed(3)}%)`);
  // ⚠ THE CLAIM IS AGAINST THE CONTROL, NOT AGAINST A NUMBER. A live world moves on its own;
  // the assertion is that a cube arriving three blocks from the eye changes far more of the
  // picture than the world changes by itself in the same interval.
  ok(appeared.pixels > ctrl.pixels + 400,
     `a block three metres away changes far more than the world does by itself ` +
     `(${appeared.pixels} px vs a control of ${ctrl.pixels})`);

  // ⚠⚠ **AND THE SAME CLAIM MADE THROUGH THE ENGINE'S OWN RECTANGLE — THIS IS WHAT PINS THE
  // PROJECTION.** Section 4 measures a falling block inside `boxOf`, and a rectangle nobody has
  // checked is a rectangle that can be anywhere. Here the answer is known independently: the
  // block demonstrably arrived, `appeared` says so over the whole frame. So the arrival must be
  // visible INSIDE the projected box and the box's own before-pair must be quiet. If the matrix
  // layout were transposed, the Y flipped, or the canvas not filling the screenshot, one of
  // these two fails here rather than silently mis-aiming section 4.
  const box3 = await boxOf(spawned.id);
  ok(!!box3 && box3.onScreen,
     `the engine projects it onto the screen at x ${box3 && box3.u0.toFixed(2)}-${box3 && box3.u1.toFixed(2)}, ` +
     `y ${box3 && box3.v0.toFixed(2)}-${box3 && box3.v1.toFixed(2)} (${box3 && box3.behind} corners behind the eye)`);
  if (box3 && box3.onScreen) {
    const r3 = boxPx(box3, after);
    const inCtrl = compareBox(before0, before, ...r3);
    const inBox = compareBox(before, after, ...r3);
    console.log(`   in its own ${r3[2] - r3[0]}x${r3[3] - r3[1]} rectangle: ` +
                `${inBox.pixels} px changed on arrival, ${inCtrl.pixels} px by itself`);
    ok(inBox.pixels > inCtrl.pixels + 400,
       `it arrived INSIDE the rectangle the camera says it occupies (${inBox.pixels} px vs ${inCtrl.pixels})`);
    // ⚠ AND THE RECTANGLE IS NOT MERELY BIG ENOUGH TO CONTAIN THE WHOLE FRAME: most of what
    // changed has to be inside it. A box covering everything would pass the line above while
    // telling section 4 nothing about where the block is.
    ok(boxArea(r3) < after.width * after.height * 0.5,
       `and that rectangle is a part of the frame, not all of it ` +
       `(${(boxArea(r3) * 100 / (after.width * after.height)).toFixed(1)}%)`);
    ok(inBox.pixels > appeared.pixels * 0.4,
       `and most of the arrival is inside it (${inBox.pixels} of ${appeared.pixels} px)`);
  }

  // ── 4. and it FALLS: the picture keeps changing, downward ───────────────────────────────
  console.log('\n4. it falls, and the picture follows it');
  // ⚠ WAIT ON `Main.ticks`, NOT ON A STOPWATCH. Gravity is per TICK; a headless browser's frame
  // rate is not the game's tick rate and is not this file's business. The first draft slept 320
  // ms three times, and when a menu had quietly stopped the clock it reported "it moved DOWN
  // (70.00 -> 70.00)" — a correct engine failing a timing assumption, with no hint which.
  const waitTicks = (n) => page.waitFor(new Function(`
    if (window.__tk === undefined) { window.__tk = MCL.Main.ticks | 0; return 0; }
    if (((MCL.Main.ticks | 0) - window.__tk) < ${n}) return 0;
    window.__tk = undefined; return 1;`), 30000);
  const clock = await ev('return { ticks: MCL.Main.ticks | 0, screen: MCL.Hud.screen ? String(MCL.Hud.screen) : null };');
  ok(clock.screen === null, `no menu is open (${clock.screen})`);

  // ⚠⚠ **LIFT IT BACK TO THE TOP OF THE COLUMN FIRST, AND SAY WHY.** §3 takes two screenshots
  // and waits for frames, which is three or four seconds — by the time this section starts, the
  // block spawned up there has already fallen its fourteen blocks and been sitting on the floor
  // for sixty ticks. The draft before this one read `60.00 -> 60.00 -> 60.00` and called a
  // perfectly working engine broken, twice, in two different ways. It is put back at the top of
  // the SAME carved column with zero velocity — a reposition inside generated, cleared space,
  // not a teleport into an ungenerated chunk — and the readings start at once.
  // ⚠ THE SAMPLER GOES ON FIRST AND THE LIFT IS THE LAST THING IN THE SAME CALL. A round trip
  // is a quarter of a second, the loop catches up twenty ticks a frame, and a dropped block
  // covers twenty-five blocks in one of them — so a sampler installed after the lift is a
  // sampler installed after the landing. The draft that did that recorded 32 samples of a block
  // sitting on the floor and reported "0 distinct airborne ticks".
  // ⚠⚠ **THE CONTROL FOR THE FALL IS TAKEN HERE, BEFORE THE LIFT, NOT AFTER THE LANDING.** The
  // draft before this one cleared the entity and measured the control afterwards — while the
  // column the block had just landed in was being re-meshed. That control came out at **3,200
  // px** against a falling block worth 1,361, so the check failed on a renderer that was working
  // and a measurement that was pointed at a remesh. The block is at rest and the world is
  // settled at THIS point, which is what a control is supposed to be: the same two shots, the
  // same gap, with nothing happening.
  await quiet(4000, 8);

  const lifted = await ev(`
    var EL = MCL.EntityList, g = window.__g17;
    var e = EL.byId(g.id);
    if (!e) return null;
    window.__s = [];
    window.__realTickOne = EL.tickOne;
    EL.tickOne = function (en) {
      window.__realTickOne.call(EL, en);
      if (en && en.id === g.id && window.__s.length < 40) {
        window.__s.push([MCL.Main.ticks | 0, en.y, en.vy, en.onGround ? 1 : 0, en.age | 0]);
      }
    };
    e.y = e.py = g.fy; e.vx = e.vy = e.vz = 0; e.onGround = false; e.fallDistance = 0;
    // ⚠ AND ITS GRAVITY IS PUT BACK, from the value read off the entity at spawn — not from a
    // literal here, which would be a check owning a number the entity table owns (D-305).
    e.gravity = g.grav;
    return { y: e.y, onGround: e.onGround, age: e.age, gravity: e.gravity };`);
  ok(!!lifted && lifted.y === spawned.fy,
     `the block is back at the top of its column (y ${lifted && lifted.y}, after ${lifted && lifted.age} ticks of the first drop)`);
  ok(!!lifted && lifted.gravity === spawned.grav && lifted.gravity > 0,
     `and its gravity is back to the table's own ${spawned.grav} (${lifted && lifted.gravity})`);
  // ⚠⚠ **THE FALL IS SAMPLED INSIDE THE PAGE, NOT POLLED ACROSS THE WIRE.** A CDP `waitFor`
  // polls on the order of a second; the game runs twenty ticks a second, so "wait four ticks"
  // waited forty and the block had landed between readings. The draft that did that reported a
  // falling block ACCELERATING to a stop. A 50 ms interval in the page is one tick, and one
  // round trip brings the whole trajectory back.
  await frames(3);
  await sleep(1200);
  const samples = await ev('MCL.EntityList.tickOne = window.__realTickOne; return window.__s || [];');
  const restored = await ev('return MCL.EntityList.tickOne === window.__realTickOne;');
  ok(restored === true, 'the tick was handed back to the engine after sampling');
  // ⚠ ONE SAMPLE PER TICK, NOT ONE PER POLL. A headless software renderer draws about four
  // frames a second and the loop catches up with a burst of ticks on each one, so a 50 ms timer
  // reads the SAME tick five times over and then jumps. Counting those repeats as intervals
  // reported "its downward speed grows on 1 of 23 intervals" of a block in free fall.
  const seen = new Set();
  const air = samples.filter((r) => {
    if (r[3] !== 0 || seen.has(r[0])) return false;
    seen.add(r[0]); return true;
  });
  console.log(`   ${samples.length} samples, ${air.length} distinct airborne ticks`);
  console.log('   y : ' + air.slice(0, 10).map((r) => r[1].toFixed(2)).join(' '));
  console.log('   vy: ' + air.slice(0, 10).map((r) => r[2].toFixed(3)).join(' '));
  ok(air.length >= 4, `it was airborne across at least four distinct ticks (${air.length})`);
  if (air.length >= 4) {
    ok(air[air.length - 1][1] < air[0][1] - 0.5,
       `it moved DOWN (${air[0][1].toFixed(2)} -> ${air[air.length - 1][1].toFixed(2)})`);
    // ⚠ ACCELERATION IS MEASURED ON `vy`, NOT ON THE GAP BETWEEN TWO READINGS — the engine's own
    // number needs no interval, and an interval that is not what it claims to be is what turned
    // a falling block into a decelerating one in the draft before this.
    let rising = 0;
    for (let i = 1; i < air.length; i++) if (air[i][2] < air[i - 1][2] - 1e-9) rising++;
    ok(rising === air.length - 1,
       `its downward speed grows on every one of ${air.length - 1} intervals (${rising})`);
    ok(air.every((r) => r[4] > 0), 'and the game, not this file, is what ticked it');
  }

  // ── 4b. and the PICTURE follows it: its own place on the screen empties when it leaves ────
  console.log('\n4b. the drawn picture follows the entity, measured where the engine draws it');
  // ⚠⚠ **WHY THIS IS ITS OWN MEASUREMENT AND NOT TWO SHOTS ACROSS THE FALL ABOVE.** Gravity is
  // per TICK and a picture is per FRAME, and on this two-core box with SwiftShader one frame is
  // about seventeen ticks. Released with vanilla's 0.04 a block leaves a 70-degree field of view
  // in roughly ten ticks — so BOTH shots taken across a free fall are photographs of a shaft the
  // block has already left. Four drafts of this assertion failed that way, the last of them
  // reporting **0 px** of a block whose own 38 samples above prove it was falling. Waiting is no
  // help: the block is gone before the first frame lands, and the forest's canopy churns by
  // eleven thousand pixels in the meantime, so no whole-frame threshold can separate them.
  //
  // The claim this section owns is that the drawn picture FOLLOWS the entity. So: put the block
  // back where the camera can see it, ask the ENGINE for the rectangle it occupies, photograph
  // that rectangle twice with the block held there — that is the control — then hand it real
  // gravity and photograph the same rectangle once it has gone. A rectangle a hundred pixels
  // across, inside a carved shaft, is quiet enough for the difference to be the block and
  // nothing else.
  const back = await ev(`
    var EL = MCL.EntityList, g = window.__g17;
    var e = EL.byId(g.id);
    if (!e) return null;
    e.y = e.py = g.fy; e.vx = e.vy = e.vz = 0; e.onGround = false; e.fallDistance = 0;
    e.gravity = 0;
    return { y: e.y, grav: e.gravity };`);
  ok(!!back && back.y === spawned.fy && back.grav === 0,
     `the block is held at the top of its column again (y ${back && back.y}, gravity ${back && back.grav})`);
  await frames(3);
  const boxF = await boxOf(spawned.id);
  ok(!!boxF && boxF.onScreen,
     `and the camera puts it back on the screen at x ${boxF && boxF.u0.toFixed(2)}-${boxF && boxF.u1.toFixed(2)}, ` +
     `y ${boxF && boxF.v0.toFixed(2)}-${boxF && boxF.v1.toFixed(2)}`);
  const drawnAgain = await ev('return MCL.Gfx.stats().entitiesDrawn | 0;');
  ok(drawnAgain >= 1, `and the renderer is drawing it (${drawnAgain})`);
  if (boxF && boxF.onScreen) {
    const still0 = await shot();
    const rect = boxPx(boxF, still0);
    await sleep(260);
    await frames(2);
    const still1 = await shot();
    // ⚠ THE CONTROL IS THE SAME RECTANGLE, THE SAME GAP, THE SAME NUMBER OF FRAMES — with the
    // block still in it. Everything the two measurements do differently is the block leaving.
    const ctrlRect = compareBox(still0, still1, ...rect);
    console.log(`   its rectangle is ${rect[2] - rect[0]}x${rect[3] - rect[1]} px and changes ` +
                `${ctrlRect.pixels} px by itself`);
    // ⚠⚠ **REAL GRAVITY, READ BACK OFF THE ENTITY AT SPAWN** (D-305) — this file owns no 0.04.
    await ev(`
      var e = MCL.EntityList.byId(window.__g17.id);
      e.gravity = window.__g17.grav; e.onGround = false; e.vy = 0;
      return 1;`);
    // ⚠ WAIT FOR THE STATE, NOT FOR A DURATION (D-321): the state this claim needs is "the
    // entity is no longer where it was photographed", which is the entity's own y, and THEN a
    // frame drawn after that.
    const left = await page.waitFor(new Function(`
      var e = MCL.EntityList.byId(window.__g17.id);
      return (e && e.y < ${spawned.fy} - 4) ? 1 : 0;`), 20000);
    ok(!!left, 'released, it falls out of the rectangle it was photographed in');
    await frames(2);
    const goneShot = await shot();
    const emptied = compareBox(still1, goneShot, ...rect);
    ok(emptied.pixels > ctrlRect.pixels + 200,
       `the picture changed where the block WAS, as it fell out of it ` +
       `(${emptied.pixels} px vs a control of ${ctrlRect.pixels})`);
    // ⚠ AND THE REVERSE, which is what makes the rectangle a claim about the block rather than
    // about the passage of time: putting it back fills the same rectangle again.
    await ev(`
      var e = MCL.EntityList.byId(window.__g17.id), g = window.__g17;
      e.y = e.py = g.fy; e.vx = e.vy = e.vz = 0; e.gravity = 0; e.onGround = false;
      return 1;`);
    await frames(3);
    const refilled = compareBox(goneShot, await shot(), ...rect);
    okAv(refilled.pixels > ctrlRect.pixels + 200,
         `and putting it back fills the same rectangle again (${refilled.pixels} px vs ${ctrlRect.pixels})`);
  }

  // ── 5. TNT too, and it is a DIFFERENT picture ───────────────────────────────────────────
  console.log('\n5. primed tnt is drawn, and it is not the same block');
  const tnt = await ev(`
    var P = MCL.Player, EL = MCL.EntityList;
    EL.clear();
    var fx = P.x + Math.sin(-P.yaw) * -3, fz = P.z + Math.cos(-P.yaw) * -3;
    var e = EL.spawn('tnt', Math.floor(fx) + 0.5, P.y - 1.5, Math.floor(fz) + 0.5);
    e.vx = 0; e.vy = 0; e.vz = 0; e.gravity = 0;      // hold it still so the frames compare
    window.__g17.tnt = e.id;
    return { id: e.id, fuse: e.fuse };`);
  ok(tnt.id > 0, 'primed tnt spawns in the game');
  ok(tnt.fuse === 80, `with vanilla's 80-tick fuse (${tnt.fuse})`);
  await frames(3);
  const tntShot = await shot();
  const tntStats = await ev('return MCL.Gfx.stats().entityTris;');
  ok(tntStats >= 4, `it is drawn (${tntStats} triangles)`);

  const sandShot = await (async () => {
    await ev(`var P = MCL.Player, S = MCL.States, EL = MCL.EntityList; EL.clear();
      var fx = P.x + Math.sin(-P.yaw) * -3, fz = P.z + Math.cos(-P.yaw) * -3;
      var e = EL.spawn('falling_block', Math.floor(fx) + 0.5, P.y - 1.5, Math.floor(fz) + 0.5,
                       { state: S.stateOf('sand') });
      e.vx = 0; e.vy = 0; e.vz = 0; e.gravity = 0;
      return 1;`);
    await frames(3);
    return shot();
  })();
  const differ = compare(tntShot, sandShot);
  // A control is only a control taken in quiet conditions: under the full suite's load a late
  // remesh put 8,956 px of noise between two shots of the SAME scene. Retake until it is quiet.
  let ctrl5 = await control(700);
  for (let t = 0; t < 6 && ctrl5.pixels > 400; t++) ctrl5 = await control(700);
  console.log(`   tnt vs sand: ${differ.pixels} px differ (${(differ.diff * 100).toFixed(3)}%), control ${ctrl5.pixels}`);
  // ⚠ THE TWO MUST LOOK DIFFERENT. A renderer that ignored the state and drew one shape for
  // every entity would pass every assertion above this line.
  ok(differ.pixels > ctrl5.pixels + 150,
     `tnt and sand are DIFFERENT pictures (${differ.pixels} px vs a control of ${ctrl5.pixels})`);

  // ── 5b. an ITEM entity, which is the same model through a different transform ───────────
  console.log('\n5b. a dropped block spins and bobs on the ground (D-323)');
  {
    const spawn = await ev(`
      var P = MCL.Player, IT = MCL.Items, EL = MCL.EntityList, g = window.__g17;
      EL.clear();
      var dirt = IT.of('dirt');
      var e = EL.spawn('item', g.fx + 0.5, g.fy - 1, g.fz + 0.5, { item: dirt });
      e.vx = e.vy = e.vz = 0; e.gravity = 0; e.bobOffs = 0; e.age = 0;
      // NEVER PICK IT UP (D-333). Items are picked up now, and this one is inside the player's
      // inflated collection box, so by the fourth frame it was in the inventory and the renderer
      // was honestly reporting zero triangles for an entity that no longer existed. 32767 is
      // vanilla's own setNeverPickUp() sentinel, not a large number.
      // (no backticks: this block is inside a template literal)
      e.pickupDelay = EL.PICKUP_NEVER;
      window.__g17.item = e.id;
      return { id: e.id, item: dirt, isBlock: IT.isBlock(dirt), bob: e.bobOffs,
               count: e.count, delay: e.pickupDelay };`);
    ok(spawn.id > 0 && spawn.isBlock, 'an item entity holding dirt spawns');
    // ⚠ AN ITEM ENTITY ALWAYS HOLDS AT LEAST ONE. A stack of zero is not a thing in vanilla, and
    // one here went negative the moment pickup arithmetic touched it (D-333).
    ok(spawn.count === 1, `a spawned item entity holds ${spawn.count}; an ItemStack is never empty`);
    await frames(4);
    const drew = await ev('return MCL.Gfx.stats().entityTris;');
    ok(drew >= 4, `it is drawn (${drew} triangles)`);
    // ⚠ AND IT IS SMALLER THAN THE BLOCK IT CAME FROM. The ground transform is a quarter scale;
    // a renderer that ignored the transform would draw a full cube and pass "it is drawn".
    const sizes = await ev(`
      var ER = MCL.EntityRender, EL = MCL.EntityList, S = MCL.States, g = window.__g17;
      var e = EL.byId(g.item);
      var b1 = ER.build(g.fx, g.fy, g.fz, g.fx, g.fy, g.fz, 1);
      EL.clear();
      var f = EL.spawn('falling_block', g.fx + 0.5, g.fy - 1, g.fz + 0.5, { state: S.stateOf('dirt') });
      f.gravity = 0;
      var b2 = ER.build(g.fx, g.fy, g.fz, g.fx, g.fy, g.fz, 1);
      var span = function (b) {
        var h = MCL.Mesher.readHeader(b.buf);
        var n = h.modelQuads[0] + h.modelQuads[1] + h.modelQuads[2];
        var w = new Uint32Array(b.buf, h.modelOff[0], n * 16);
        var lo = 1e9, hi = -1e9;
        for (var q = 0; q < n * 4; q++) {
          var v = MCL.Mesher.unpackModelVertex(w[q*4], w[q*4+1], w[q*4+2], w[q*4+3]);
          if (v.py < lo) lo = v.py; if (v.py > hi) hi = v.py;
        }
        return (hi - lo) / 256;
      };
      EL.clear();
      return { item: span(b1), block: span(b2) };`);
    ok(Math.abs(sizes.item - 0.25) < 0.02,
       `the item is a quarter of a block tall (${sizes.item.toFixed(3)})`);
    ok(Math.abs(sizes.block - 1) < 0.02,
       `the block it came from is a whole one (${sizes.block.toFixed(3)}) — the transform is applied`);
  }

  // ── 6. anti-vacuity ─────────────────────────────────────────────────────────────────────
  console.log('\n6. anti-vacuity: break it, and it must be caught');
  // ⚠ §6 SPAWNS ITS OWN SUBJECT. §5b ends by clearing the list, and the first draft of this
  // section quietly measured "the entity is not drawn" of a world with no entity in it — a break
  // that passes for the wrong reason is worse than one that fails.
  await ev(`
    var S = MCL.States, EL = MCL.EntityList, g = window.__g17;
    EL.clear();
    var e = EL.spawn('falling_block', g.fx + 0.5, g.fy - 1, g.fz + 0.5, { state: S.stateOf('sand') });
    e.vx = e.vy = e.vz = 0; e.gravity = 0;
    g.id = e.id;
    return 1;`);
  await frames(4);
  ok((await ev('return MCL.Gfx.stats().entitiesDrawn;')) === 1,
     'a fresh block is in view for the breaks to act on');
  {
    // take the renderer away and the same spawn must draw nothing at all
    const gone = await ev(`
      var ER = MCL.EntityRender, saved = ER.SHAPE.falling_block;
      delete ER.SHAPE.falling_block;
      window.__g17.saved = saved;
      return 1;`);
    await frames(3);
    const blank = await ev('return { tris: MCL.Gfx.stats().entityTris, n: MCL.EntityList.count() };');
    const blankShot = await shot();
    await ev('MCL.EntityRender.SHAPE.falling_block = window.__g17.saved; return 1;');
    await frames(3);
    okAv(blank.n === 1 && blank.tris === 0,
         'with the shape table emptied the entity still EXISTS and no triangles are drawn');
    const back = compare(blankShot, await shot());
    const ctrl6 = await control(700);
    okAv(back.pixels > ctrl6.pixels + 150,
         `and putting it back brings the picture back (${back.pixels} px vs a control of ${ctrl6.pixels})`);
  }
  {
    // ⚠ THE COMPARISON CAN TELL A CHANGE FROM NO CHANGE, MEASURED HERE AND NOW. Removing the
    // entity must move far more pixels than leaving everything alone does over the same gap —
    // and both halves are measured within a few seconds of each other, because the noise floor
    // of a live world drifts and a stale control is worse than none.
    const still = await control(700);
    const withIt = await shot();
    await ev('MCL.EntityList.clear(); return 1;');
    await frames(3);
    const without = compare(withIt, await shot());
    okAv(without.pixels > still.pixels + 200,
         `taking the entity away changes more than doing nothing does (${without.pixels} vs ${still.pixels})`);
  }
  {
    // an entity out of range draws nothing, so §3 is measuring presence and not merely existence
    await ev(`var EL = MCL.EntityList, S = MCL.States, P = MCL.Player; EL.clear();
      var e = EL.spawn('falling_block', P.x + 4000, P.y, P.z, { state: S.stateOf('sand') });
      e.gravity = 0; return 1;`);
    await frames(3);
    const far = await ev('return { tris: MCL.Gfx.stats().entityTris, n: MCL.EntityList.count() };');
    okAv(far.n === 1 && far.tris === 0, 'an entity four thousand blocks away exists and is not drawn');
    await ev('MCL.EntityList.clear(); return 1;');
  }

  const errs = await ev('return (window.__errors || []).slice(0, 5);');
  ok(!errs || errs.length === 0, `the page logged no errors (${(errs || []).join(' | ')})`);

} finally {
  console.log('\n' + '='.repeat(43));
  console.log(` g17cbcheck: ${pass} assertions, ${fails.length} failed, ${breaks} breaks`);
  if (fails.length) for (const f of fails) console.log('   x ' + f);
  console.log('='.repeat(43));
  try { await page.close(); } catch (e) { /* the browser is going away anyway */ }
  process.exit(fails.length ? 1 : 0);
}
