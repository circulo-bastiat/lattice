// walkpeek.mjs — QUEUE 0.0 ground-see-through, D-702 item (2): normal WALKING-physics repro
// (no noclip, no flying) crossing a chunk-load boundary near spawn, screenshotting rapidly to
// catch a one-frame camera/interpolation glitch. Kept as a standalone diagnostic, like
// villagepeek.mjs -- not wired into suite.mjs.
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
if (!page) { console.log('SKIP -- no Chromium'); process.exit(0); }

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
if (!ready) process.exit(1);
await sleep(1500);

// Place player a few blocks before a chunk boundary at x=16 (chunk edge between chunk 0 and 1),
// walking normal physics (no noclip/flying), then walk it forward across the boundary while
// screenshotting rapidly. Face +X, fly OFF so real gravity/ground-collision physics runs.
const info = await page.evaluate(function () {
  var W = MCL.World, P = MCL.Player;
  P.flying = false; P.noclip = false;
  P.x = 10; P.z = 0.5;
  var topY = -1;
  for (var y = 255; y >= -64; y--) { var b = W.getBlock(10, y, 0); if (b) { topY = y; break; } }
  P.y = topY + 2;
  P.vx = P.vy = P.vz = 0;
  P.yaw = Math.PI * 0.5; // facing +x (adjust if convention differs -- verified by movement below)
  P.pitch = -0.35;
  if (P.interpolate) P.interpolate(0);
  // Fake pointer-lock state so Input reads WASD normally (headless Chromium never gets a real
  // pointer lock) -- this is the only synthetic bit; movement itself runs through real physics.
  MCL.Input.locked = true;
  MCL.Input.uiOpen = false;
  return { x: P.x, y: P.y, z: P.z, topY: topY };
});
console.log('start:', JSON.stringify(info));
await sleep(500);

// hold KeyW
await page.evaluate(function () { MCL.Input.keys['KeyW'] = true; });

const shots = [];
for (let i = 0; i < 40; i++) {
  await sleep(150);
  const st = await page.evaluate(function () {
    var P = MCL.Player, W = MCL.World;
    var bx = Math.floor(P.x), bz = Math.floor(P.z);
    var below = W.getBlock(bx, Math.floor(P.y - 0.1), bz);
    return { x: P.x, y: P.y, z: P.z, onGround: P.onGround, below: below, chunkX: bx >> 4 };
  });
  const s = await page.send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(s.data, 'base64');
  const p = join(OUT, 'walkpeek_' + String(i).padStart(2, '0') + '.png');
  writeFileSync(p, buf);
  let skyFrac = null;
  try {
    const img = decodePng(buf);
    const fog = await page.evaluate(function () {
      var f = MCL.Gfx && MCL.Gfx.fog;
      if (Array.isArray(f)) return [f[0], f[1], f[2]];
      return null;
    });
    const fogScaled = fog ? fog.map((v) => (v <= 1 ? v * 255 : v)) : null;
    const cx0 = Math.floor(img.width * 0.35), cx1 = Math.floor(img.width * 0.65);
    const cy0 = Math.floor(img.height * 0.55), cy1 = Math.floor(img.height * 0.85);
    let total = 0, skyLike = 0;
    for (let y = cy0; y < cy1; y++) for (let x = cx0; x < cx1; x++) {
      const idx = (y * img.width + x) * img.channels;
      const r = img.data[idx], g = img.data[idx + 1], b = img.data[idx + 2];
      total++;
      if (fogScaled) { const d = Math.abs(r - fogScaled[0]) + Math.abs(g - fogScaled[1]) + Math.abs(b - fogScaled[2]); if (d < 30) skyLike++; }
    }
    skyFrac = total ? skyLike / total : null;
  } catch (e) {}
  shots.push({ i, ...st, skyFrac });
  console.log(i, JSON.stringify(st), 'skyFrac=', skyFrac);
}
await page.evaluate(function () { MCL.Input.keys['KeyW'] = false; });

console.log('--- summary ---');
const warnings = await page.evaluate(function () { return window.__warnings || []; });
console.log('warnings:', JSON.stringify(warnings));
const suspicious = shots.filter(s => s.onGround && s.below === 0 && s.skyFrac > 0.3);
console.log('SUSPICIOUS frames (onGround but below=air and sky-like pixels below crosshair):', JSON.stringify(suspicious));

await page.close?.();
process.exit(0);
