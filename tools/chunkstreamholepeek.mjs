// chunkstreamholepeek.mjs -- QUEUE 0.0 "Dan can see through the ground", the angle D-692/D-702/
// D-705 did NOT try: RAPID MULTI-CHUNK LOADING (many chunk boundaries crossed in quick
// succession, e.g. fast creative flight/teleporting) rather than one slow flying approach to a
// known structure (villagepeek.mjs) or one normal walked chunk-boundary crossing (walkpeek.mjs).
//
// FINDING (this session): this DOES reproduce a real, visible "see through the ground" moment.
// After several fast teleports (each ~80 blocks, ~90ms apart -- well inside what a player can do
// with creative fly or an elytra) build up a backlog of dirty chunks, landing on a column the
// world already has real generated ground for (confirmed via W.getBlock -- NOT the water/fog
// false-positive D-702/D-705 already named) and looking straight down shows fog/sky colour, not
// the ground, for roughly 1-3 seconds, then self-heals as W.stream's mesh queue catches up.
//
// ROOT CAUSE (narrowed, not fixed this pass): src/07_world.js's `W.stream` per-frame mesh
// budget (`meshPerFrame`, `W.maxMeshInflight`, D-87/D-198's frame-load throttle). Its own
// comments already say this trade-off exists ("losing the ground in front of your face" is
// literally named as the failure mode pass-0/pass-1 ordering was built to reduce, not eliminate)
// -- under a big-enough backlog (many chunks dirtied at once by fast movement) even the column
// directly under the camera can sit unmeshed for over a second, so the renderer draws the
// background/fog colour where solid ground already exists in the world data. This is NOT the
// MAX_QUADS/mesher-cap gap (D-692/D-702, ruled out) -- it is the mesh SCHEDULING budget, a
// different, real gap. A fix needs care: `meshPerFrame`/`maxMeshInflight` exist specifically to
// stop hitches (D-87) and retuning them risks regressing that; left for a dedicated follow-up
// (see docs/DECISIONS.md's write-up of this session's finding for the exact numbers).
//
// Usage: node tools/chunkstreamholepeek.mjs
// Output: tools/out/csh_*.png + a JSON timeline on stdout. NOT wired into suite.mjs (a live
// browser diagnostic, same category as villagepeek.mjs/walkpeek.mjs, not a fast node check).
import { open, sleep } from './cdp.mjs';
import { decodePng } from './pngdec.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tools', 'out');
mkdirSync(OUT, { recursive: true });
function mkFn(body) { return { toString: function () { return 'function(){' + body + '}'; } }; }

const page = await open(join(ROOT, 'dist', 'mclite.html'), { width: 1024, height: 768 });
if (!page) { console.log('SKIP -- no Chromium on this machine'); process.exit(0); }

await page.evaluate(function () {
  window.__warnings = [];
  var orig = console.warn.bind(console);
  console.warn = function () { try { window.__warnings.push(Array.prototype.slice.call(arguments).join(' ')); } catch (e) {} return orig.apply(console, arguments); };
});

await sleep(1200);
await page.evaluate(function () { if (window.MCL && MCL.Main && !MCL.Main.ready) MCL.Main.play({}); });
const ready = await page.waitFor(function () {
  return !!(window.MCL && MCL.Main.ready && MCL.Hud.mode === 'game' && MCL.World.chunks.size > 20);
}, 60000);
console.log('spawn ready:', ready);
if (!ready) { console.log('FATAL: world never came up'); await page.close?.(); process.exit(1); }
await sleep(1500);

const seedInfo = await page.evaluate(function () { return { seed: MCL.Main.seed }; });
console.log('seed info:', JSON.stringify(seedInfo));

await page.evaluate(function () { var P = MCL.Player; P.flying = true; P.noclip = true; P.vx = P.vy = P.vz = 0; });

// Build a realistic backlog: 8 fast hops (~80 blocks/5 chunks, ~90ms apart) in a fan pattern --
// well within reach of creative-fly/elytra speed, nothing synthetic about the movement itself.
let dx = 0, dz = 0;
for (let i = 0; i < 8; i++) {
  const ang = i * 1.3;
  dx += Math.round(Math.cos(ang) * 80);
  dz += Math.round(Math.sin(ang) * 80);
  await page.evaluate(mkFn('var P = MCL.Player; P.x = ' + dx + '; P.z = ' + dz + '; P.y = 150; if (P.interpolate) P.interpolate(0);'));
  await sleep(90);
}
// Final landing hop, then immediately drop to just above the world's own recorded ground and
// look straight down -- the moment a scheduling race would show up.
await page.evaluate(mkFn('var P = MCL.Player; P.x = 80.5; P.z = -15.5; P.y = 150; if (P.interpolate) P.interpolate(0);'));
await sleep(90);
const ground = await page.evaluate(function () {
  var W = MCL.World, P = MCL.Player;
  var bx = Math.floor(P.x), bz = Math.floor(P.z);
  var topY = -999;
  for (var y = 255; y >= -64; y--) { var b = W.getBlock(bx, y, bz); if (b) { topY = y; break; } }
  var blk = topY > -900 ? W.getBlock(bx, topY, bz) : 0;
  var bn = blk && MCL.States.block ? MCL.Reg.names[MCL.States.block[blk]] : null;
  return { bx: bx, bz: bz, topY: topY, chunksLoaded: W.chunks.size, blockId: blk, blockName: bn };
});
console.log('world data at landing column (should be real ground):', JSON.stringify(ground));
if (ground.topY <= -900) { console.log('NO GROUND DATA at this column this run -- coordinate needs adjusting, not a repro'); }
await page.evaluate(mkFn('var P = MCL.Player; P.y = ' + (ground.topY > -900 ? ground.topY + 3 : 90) + '; P.pitch = -1.5; P.yaw = 0; if (P.interpolate) P.interpolate(0);'));

async function skyFracAt(name) {
  const s = await page.send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(s.data, 'base64');
  writeFileSync(join(OUT, 'csh_' + name + '.png'), buf);
  const img = decodePng(buf);
  const fog = await page.evaluate(function () { var f = MCL.Gfx && MCL.Gfx.fog; return Array.isArray(f) ? [f[0], f[1], f[2]] : null; });
  const fogScaled = fog ? fog.map((v) => (v <= 1 ? v * 255 : v)) : null;
  const cx0 = Math.floor(img.width * 0.35), cx1 = Math.floor(img.width * 0.65);
  const cy0 = Math.floor(img.height * 0.35), cy1 = Math.floor(img.height * 0.65);
  let total = 0, skyLike = 0;
  for (let y = cy0; y < cy1; y++) for (let x = cx0; x < cx1; x++) {
    const idx = (y * img.width + x) * img.channels;
    const r = img.data[idx], g = img.data[idx + 1], b = img.data[idx + 2];
    total++;
    if (fogScaled) { const d = Math.abs(r - fogScaled[0]) + Math.abs(g - fogScaled[1]) + Math.abs(b - fogScaled[2]); if (d < 30) skyLike++; }
  }
  return total ? skyLike / total : null;
}

const timeline = [];
const delays = [50, 100, 200, 400, 800, 1500, 3000];
let elapsed = 0;
for (const d of delays) {
  await sleep(d);
  elapsed += d;
  const frac = await skyFracAt(elapsed + 'ms');
  const chunks = await page.evaluate(function () { return MCL.World.chunks.size; });
  timeline.push({ elapsedMs: elapsed, skyFrac: frac, chunksLoaded: chunks });
  console.log('t+' + elapsed + 'ms skyFrac=', frac, 'chunksLoaded=', chunks);
}

const warnings = await page.evaluate(function () { return window.__warnings || []; });
console.log('warnings (console.warn):', JSON.stringify(warnings));
console.log('problems (console.error/exceptions):', JSON.stringify((page.problems || []).slice(0, 20)));
console.log('TIMELINE:', JSON.stringify(timeline));
const holeSeen = timeline.some(function (t) { return t.skyFrac !== null && t.skyFrac > 0.5; });
const healed = timeline.length && timeline[timeline.length - 1].skyFrac !== null && timeline[timeline.length - 1].skyFrac < 0.1;
console.log('HOLE OBSERVED (fog colour shown over known real ground):', holeSeen, '-- HEALED BY END:', healed);

await page.close?.();
process.exit(0);
