// villagepeek.mjs -- live repro attempt for QUEUE 0.0 / D-692 ("Dan can see through the
// ground"). D-692 ruled out CFG.MAX_QUADS on plain seed-1337 terrain (worst real section only
// 34.1% of cap) and told the next session to try a LIVE repro near a structure instead of only
// checking spawn. docs/DECISIONS.md documents a real seed-1337 plains village at chunk (-79, 90)
// (block ~(-1264, *, 1440)) -- dense, varied blocks close together, exactly the case D-692 named
// as the still-live risk. This teleports (flying+noclip, no physics) there, lets the engine's
// own W.stream mesh the area, and photographs it from several angles/heights, capturing BOTH
// console.error/exceptions (page.problems, cdp.mjs) AND console.warn (hooked here -- cdp.mjs's
// `problems` only captures 'error', but D-692's own MAX_QUADS warning is a console.warn) for
// 'MC-Lite mesher: section exceeded MAX_QUADS' or the two gfx-backend 'over MAX_QUADS' warnings.
//
// NOTE: cdp.mjs's page.evaluate(fn) takes ZERO runtime arguments (it stringifies fn and calls
// it with no closure) -- every value this script needs inside the page is baked into the
// function source via string templates, not passed as a JS closure or evaluate() argument.
//
// Usage: node tools/villagepeek.mjs
// Output: tools/out/villagepeek_*.png, and a JSON summary on stdout.

import { open, sleep } from './cdp.mjs';
import { decodePng } from './pngdec.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tools', 'out');
mkdirSync(OUT, { recursive: true });

// cdp.mjs's evaluate(fn) calls fn.toString() and runs '(' + that + ')()' -- it does not
// support closures or runtime arguments. mkFn lets us bake computed values into the
// function body as a string while still handing evaluate() something whose toString()
// is real, callable function source.
function mkFn(body) { return { toString: function () { return 'function(){' + body + '}'; } }; }

const page = await open(join(ROOT, 'dist', 'mclite.html'), { width: 1024, height: 768 });
if (!page) { console.log('villagepeek: SKIP -- no Chromium on this machine'); process.exit(0); }

await page.evaluate(function () {
  window.__warnings = [];
  var orig = console.warn.bind(console);
  console.warn = function () {
    try { window.__warnings.push(Array.prototype.slice.call(arguments).join(' ')); } catch (e) {}
    return orig.apply(console, arguments);
  };
  return 1;
});

await sleep(1200);
await page.evaluate(function () { if (window.MCL && MCL.Main && !MCL.Main.ready) MCL.Main.play({}); });

const ready = await page.waitFor(function () {
  return !!(window.MCL && MCL.Main.ready && MCL.Hud.mode === 'game' && MCL.World.chunks.size > 20);
}, 60000);
console.log('spawn ready:', ready, 'lastThrow:', page.lastThrow);
if (!ready) { console.log('FATAL: world never came up'); await page.close?.(); process.exit(1); }
await sleep(1500);

const seedInfo = await page.evaluate(function () {
  return { seed: MCL.Main.seed, spawnXYZ: [MCL.Player.x, MCL.Player.y, MCL.Player.z] };
});
console.log('seed info:', JSON.stringify(seedInfo));

// Village centre: seed 1337, chunk (-79, 90) -> block (-1264+8, *, 1440+8) = (-1256, *, 1448)
const VX = -1256, VZ = 1448;

function evalTemplate(src) { return src; }

const tp = await page.evaluate(mkFn(
  'var P = MCL.Player;' +
  'P.flying = true; P.noclip = true;' +
  'P.vy = 0; P.vx = 0; P.vz = 0;' +
  'P.x = ' + VX + '; P.y = 200; P.z = ' + VZ + ';' +
  'P.pitch = -1.5; P.yaw = 0;' +
  'if (P.interpolate) P.interpolate(0);' +
  'return { x: P.x, y: P.y, z: P.z };'
));
console.log('teleported (high):', JSON.stringify(tp));

await sleep(4000);

const ground = await page.evaluate(function () {
  var W = MCL.World, P = MCL.Player;
  var bx = Math.floor(P.x), bz = Math.floor(P.z);
  var topY = -1, topBlock = 0;
  for (var y = 255; y >= -64; y--) {
    var b = W.getBlock(bx, y, bz);
    if (b) { topY = y; topBlock = b; break; }
  }
  var chunksLoaded = W.chunks.size;
  return { bx: bx, bz: bz, topY: topY, topBlock: topBlock, chunksLoaded: chunksLoaded };
});
console.log('ground scan at village centre:', JSON.stringify(ground));

const dropY = (ground.topY >= 0 ? ground.topY : 90) + 6;
await page.evaluate(mkFn(
  'var P = MCL.Player; P.y = ' + dropY + ';' +
  'P.pitch = -1.5; P.yaw = 0;' +
  'if (P.interpolate) P.interpolate(0);'
));
await sleep(1000);

async function shot(name, srcOrNull) {
  if (srcOrNull) await page.evaluate(mkFn(srcOrNull));
  await sleep(600);
  const fog = await page.evaluate(function () {
    var G = MCL.Gfx;
    var f = G && G.fog;
    if (Array.isArray(f)) return [f[0], f[1], f[2]];
    if (typeof f === 'number') return [(f >> 16) & 255, (f >> 8) & 255, f & 255];
    return null;
  });
  const s = await page.send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(s.data, 'base64');
  const p = join(OUT, 'villagepeek_' + name + '.png');
  writeFileSync(p, buf);
  let skyFrac = null;
  try {
    const img = decodePng(buf);
    const cx0 = Math.floor(img.width * 0.3), cx1 = Math.floor(img.width * 0.7);
    const cy0 = Math.floor(img.height * 0.3), cy1 = Math.floor(img.height * 0.7);
    let total = 0, skyLike = 0;
    // fog is normalized 0..1 in this engine's fog[] triplet (10_gfx.js divides by 255
    // internally in some spots) -- compare both raw 0..255 and 0..1*255 scalings so a
    // representation mismatch does not silently zero out the count.
    const fogScaled = fog ? fog.map((v) => (v <= 1 ? v * 255 : v)) : null;
    for (let y = cy0; y < cy1; y++) {
      for (let x = cx0; x < cx1; x++) {
        const idx = (y * img.width + x) * img.channels;
        const r = img.data[idx], g = img.data[idx + 1], b = img.data[idx + 2];
        total++;
        if (fogScaled) {
          const d = Math.abs(r - fogScaled[0]) + Math.abs(g - fogScaled[1]) + Math.abs(b - fogScaled[2]);
          if (d < 30) skyLike++;
        }
      }
    }
    skyFrac = total ? skyLike / total : null;
  } catch (e) { console.log('  (pixel analysis failed:', e.message, ')'); }
  console.log('shot:', name, '-> ', p, ' fog=', JSON.stringify(fog), ' centerSkyFrac=', skyFrac);
  return skyFrac;
}

const skyFracs = {};
skyFracs.above_down = await shot('above_down', 'MCL.Player.pitch = -1.5; MCL.Player.yaw = 0;');

for (let i = 0; i < 4; i++) {
  const yaw = i * (Math.PI / 2);
  skyFracs['above_horizon_' + i] = await shot('above_horizon_' + i, 'MCL.Player.pitch = -0.2; MCL.Player.yaw = ' + yaw + ';');
}

const groundEyeY = (ground.topY >= 0 ? ground.topY : 90) + 1.6;
const offsets = [[0, 0], [6, 0], [-6, 0], [0, 6], [0, -6], [4, 4], [-4, -4]];
const perPointResults = [];
for (let i = 0; i < offsets.length; i++) {
  const dx = offsets[i][0], dz = offsets[i][1];
  const px = VX + dx, pz = VZ + dz;
  const info = await page.evaluate(mkFn(
    'var W = MCL.World, P = MCL.Player;' +
    'P.x = ' + px + '; P.z = ' + pz + '; P.y = ' + groundEyeY + ';' +
    'P.pitch = -1.5; P.yaw = 0;' +
    'if (P.interpolate) P.interpolate(0);' +
    'var bx = Math.floor(P.x), bz = Math.floor(P.z);' +
    'var below = W.getBlock(bx, Math.floor(P.y) - 2, bz);' +
    'return { x: P.x, y: P.y, z: P.z, belowBlock: below };'
  ));
  perPointResults.push(info);
  skyFracs['ground_down_' + i] = await shot('ground_down_' + i, null);
  await page.evaluate(function () { MCL.Player.pitch = 0; MCL.Player.yaw = 0; });
  skyFracs['ground_horizon_' + i] = await shot('ground_horizon_' + i, null);
}

const warnings = await page.evaluate(function () { return window.__warnings || []; });
const problems = page.problems.slice(0, 30);

console.log('--- warnings (console.warn) ---');
console.log(JSON.stringify(warnings, null, 2));
console.log('--- problems (console.error / exceptions) ---');
console.log(JSON.stringify(problems, null, 2));
console.log('--- per-point ground scan ---');
console.log(JSON.stringify(perPointResults, null, 2));

console.log('--- centre sky-color fraction per shot (>0.5 while standing on/above real geometry looking down = suspicious) ---');
console.log(JSON.stringify(skyFracs, null, 2));

const meshWarnHit = warnings.some(function (w) { return /MAX_QUADS/.test(w); });
console.log('MAX_QUADS warning fired during this repro:', meshWarnHit);

await page.close?.();
process.exit(0);
