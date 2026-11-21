#!/usr/bin/env node
// smoothlivecheck.mjs — #1264: the Smooth Lighting option must change what the REAL page draws.
//
//   node tools/smoothlivecheck.mjs [dist/mclite.html]
//
// Dan (1 Oct): toggling Smooth Lighting did nothing he could see. facecheck 4c proves the MESHER does
// it in node; this drives the real page (mesh workers ON): it presses the real menu row, lets the world
// remesh, and reads every section mesh the renderer is HOLDING. Per quad it compares the four vertices'
// sky/block light: with smooth ON many quads carry a gradient, with it OFF none may.
// Anti-vacuity: the same measurement on a deliberately mis-set mesher (smooth forced ON while the
// "OFF" state is read) must be caught.
import { open, sleep } from './cdp.mjs';
import { decodePng, toRgba } from './pngdec.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv.slice(2).find((a) => a.endsWith('.html')) || join(ROOT, 'dist', 'mclite.html');
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); console.log((c ? '  ✓ ' : '  ✗ ') + m); return c; };
console.log('smoothlivecheck - Smooth Lighting toggle on the real page (#1264)');

const page = await open(target, { width: 800, height: 600 });
if (!page) { console.log('SKIP -- no Chromium on this machine'); process.exit(0); }
await sleep(1200);
await page.evaluate(function () { if (window.MCL && MCL.Main && !MCL.Main.ready) MCL.Main.play({}); });
const ready = await page.waitFor(function () {
  return !!(window.MCL && MCL.Main.ready && MCL.Hud.mode === 'game' && MCL.World.chunks.size > 4);
}, 180000);
if (!ready) { console.log('FATAL: world never came up'); process.exit(1); }
await page.settleWorld();

// Install the tap: the latest buffer the renderer received for each section.
await page.evaluate(function () {
  var G = MCL.Gfx, held = window.__held = new Map(), orig = G.setSectionMesh;
  G.setSectionMesh = function (cx, cz, sy, buf) { held.set(G.sectionKey(cx, cz, sy), buf); return orig.call(G, cx, cz, sy, buf); };
  window.__gradient = function () {
    var Q = MCL.CFG.QUAD_BYTES, quads = 0, grad = 0, mq = 0, mgrad = 0;
    held.forEach(function (buf) {
      if (!buf) return;
      var h = MCL.Mesher.readHeader(buf), u = new Uint32Array(buf);
      for (var l = 0; l < 3; l++) for (var i = 0; i < h.quads[l]; i++) {
        var o = (h.off[l] + i * Q) >> 2, a = (u[o] >>> 23) & 0x1FF, same = 1;
        for (var v = 1; v < 4; v++) if (((u[o + 2 * v] >>> 23) & 0x1FF) !== a) same = 0;
        quads++; if (!same) grad++;
      }
      // the MODEL stream (stairs, slabs, grass blocks, ...): per-vertex ao+sky+blk is w3 bits 3..12
      for (var m = 0; m < 3; m++) for (var j = 0; j < h.modelQuads[m]; j++) {
        var mo = (h.modelOff[m] >> 2) + j * 16, a0 = (u[mo + 3] >>> 3) & 0x3FF, same2 = 1;
        for (var w = 1; w < 4; w++) if (((u[mo + 4 * w + 3] >>> 3) & 0x3FF) !== a0) same2 = 0;
        mq++; if (!same2) mgrad++;
      }
    });
    return { quads: quads, grad: grad, mq: mq, mgrad: mgrad, held: held.size };
  };
  // The REAL menu path: the row the player clicks.
  window.__press = function () {
    MCL.Options.screen = 'video'; MCL.Options.rowsBuilt = null;
    var rows = MCL.Options.ROWS.video(), r = null;
    for (var i = 0; i < rows.length; i++) if (rows[i].label === 'Smooth Lighting') r = rows[i];
    if (!r) return null;
    r.fn(); return r.val();
  };
});
let lastLabel = null;
const measure = async (action) => {
  await page.evaluate(function () { window.__held.clear(); });
  lastLabel = await page.evaluate(action);
  await sleep(300);
  // the remesh trickles in a few sections per frame: wait until the held count stops growing
  let last = -1, still = 0;
  for (let i = 0; i < 400 && still < 8; i++) {
    const n = await page.evaluate(function () { return window.__held.size; });
    if (n > 0 && n === last) still++; else still = 0;
    last = n; await sleep(500);
  }
  return page.evaluate(function () { return window.__gradient(); });
};

// A lit room six blocks under the surface: a glowstone on the far wall, the camera facing it.
await page.evaluate(function () {
  var P = MCL.Player, W = MCL.World, x = Math.floor(P.x), z = Math.floor(P.z);
  var y = MCL.Column.height(x, z) - 6;
  for (var dy = 0; dy <= 3; dy++) for (var dx = -3; dx <= 3; dx++) for (var dz = -3; dz <= 3; dz++) W.setBlock(x + dx, y + dy, z + dz, 0);
  W.setBlock(x + 2, y + 1, z, MCL.States.stateOf('glowstone'));
  for (var sx = -2; sx <= 2; sx++) W.setBlock(x + sx, y, z + 2, MCL.States.stateOf('stone_stairs'));
  MCL.Light.settle(400);
  P.x = x + 0.5; P.y = y + 0.2; P.z = z + 0.5; P.vy = 0; P.pitch = 0; P.yaw = 0;
});
const shot = async () => {
  const r = await page.send('Page.captureScreenshot', { format: 'png' });
  return toRgba(decodePng(Buffer.from(r.data, 'base64')));
};
const diffPx = (a, b) => {
  let n = 0;
  for (let i = 0; i < a.width * a.height * 4; i += 4) {
    if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) > 3) n++;
  }
  return n;
};

const start = await page.evaluate(function () { return { ao: MCL.Settings.ao, sm: MCL.Settings.smoothLighting }; });
console.log('start', JSON.stringify(start));
if (!start.ao) await page.evaluate(function () { window.__press(); });
const press = function () { return window.__press(); };
const on = await measure(function () { MCL.World.remeshAll(); return 'remesh'; });
const shotOn = await shot(); await sleep(1500); const shotOn2 = await shot();
const off = await measure(press); const label1 = lastLabel;
await sleep(1500); const shotOff = await shot();
const on2 = await measure(press); const label2 = lastLabel;
console.log('on', JSON.stringify(on), label1, 'off', JSON.stringify(off), label2, 'on again', JSON.stringify(on2));

ok(on.quads > 100, `enough geometry to judge (${on.quads} quads)`);
ok(on.grad > 0, `smooth ON: some quads carry a light gradient (${on.grad})`);
ok(off.grad === 0, `smooth OFF: no quad carries a light gradient (${off.grad})`);
ok(on2.grad > 0, `smooth back ON: gradients return (${on2.grad})`);
ok(on.mgrad > 0, `smooth ON: model-stream quads (stairs, slabs, grass) carry a per-vertex gradient (${on.mgrad} of ${on.mq})`);
ok(off.mgrad === 0, `smooth OFF: no model-stream quad carries one (${off.mgrad})`);
ok(off.quads < on.quads, `OFF merges more: ${off.quads} < ${on.quads} quads`);

const noise = diffPx(shotOn, shotOn2), seen = diffPx(shotOn, shotOff);
console.log('pixels: noise', noise, 'ON vs OFF', seen);
ok(seen > noise + 200, `the lit room looks different with Smooth Lighting off: ${seen} pixels vs a noise floor of ${noise}`);

// anti-vacuity: lie to the check — force smooth ON in every thread while the setting says OFF.
await page.evaluate(press);
const lie = await measure(function () { var o = Object.assign({}, MCL.Jobs.meshOpts, { ao: true, smooth: true }); MCL.Jobs.setMeshOptions(o); MCL.World.remeshAll(); return 'lie'; });
await sleep(3000); const shotLie = await shot();
const lieSeen = diffPx(shotOn, shotLie);
if (lie.grad > 0 && lie.mgrad > 0) breaks++;
if (!(lieSeen > noise + 200)) breaks++;
ok(lieSeen <= noise + 200, `the pixel test sees nothing when the mesher ignores OFF (${lieSeen} vs noise ${noise})`);
ok(lie.grad > 0, `the check sees a mesher that ignores the OFF state (${lie.grad} gradient quads)`);

console.log(`${pass} checks passed, ${fails.length} failures, ${breaks} breaks caught`);
await page.close();
process.exit(fails.length ? 1 : 0);
