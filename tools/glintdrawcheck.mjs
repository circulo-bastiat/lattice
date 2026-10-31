#!/usr/bin/env node
// glintdrawcheck.mjs — #9239: THE ENCHANTMENT GLINT ON WORN ARMOUR, ON A REAL SCREEN (WebGL2 or WebGPU, whichever the page picks).
//
//   MCLITE_PRESET=medium node tools/glintdrawcheck.mjs [dist/mclite.html] [--shots]
//
// An enchanted chestplate on a live zombie draws a second, additive, scrolling layer (alpha field 30 in the
// additive model bucket); the same plain chestplate does not. Every comparison diffs two screenshots a few frames
// apart (the glint scrolls, nothing else on the zombie does), so cloud drift never has room to matter (see
// crystalbeamdrawcheck.mjs's header). Held-item glint is NOT drawn yet (owed on #9239).

import { open, sleep } from './cdp.mjs';
import { decodePng, toRgba } from './pngdec.mjs';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FILE = args[0] ? (args[0].startsWith('/') ? args[0] : ROOT + args[0]) : ROOT + 'dist/mclite.html';
const SHOTS = process.argv.includes('--shots');

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m, d) => { if (c) { pass++; console.log('ok    ' + m); } else { fails.push(m + (d !== undefined ? ' (' + d + ')' : '')); console.log('FAIL  ' + m + (d !== undefined ? '   ' + d : '')); } return c; };
const okAv = (c, m, d) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else { fails.push('anti-vacuity: ' + m + (d !== undefined ? ' (' + d + ')' : '')); console.log('   x ' + m + (d !== undefined ? '   ' + d : '')); } };

/** Changed-pixel count — same recipe as bowdrawcheck.mjs's `compare`, brightness dropped (not
 *  needed: every assertion here is a plain magnitude comparison between two live screenshots). */
function compare(a, b) {
  if (a.width !== b.width || a.height !== b.height) return { differing: -1, total: 1 };
  let differing = 0, total = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
    total++;
    if (d > 12) differing++;
  }
  return { differing, total };
}

const page = await open(FILE, {
  port: 9457, width: 960, height: 540,
  initScript: 'window.addEventListener("load", function () { setTimeout(function () {' +
             ' if (window.MCL && MCL.Sky) { MCL.Sky.daylightCycle = false; MCL.Sky.weatherCycle = false; var wD = MCL.Sky.weather; if (wD) { wD.raining = wD.thundering = false; wD.rainLevel = wD.oRainLevel = wD.thunderLevel = wD.oThunderLevel = 0; } } }, 50); });',
});
if (!page) { console.log('SKIP  glintdrawcheck: no Chromium found'); process.exit(0); }

try {
  await sleep(1200);
  await page.evaluate(function () { if (window.MCL && MCL.Main && !MCL.Main.ready) MCL.Main.play({}); });
  const up = await page.waitFor(function () {
    return !!(window.MCL && MCL.Main.ready && MCL.Hud.mode === 'game' && MCL.World.chunks.size > 20);
  }, 60000);
  if (!ok(up, 'the world came up', page.lastThrow)) throw new Error('never reached the game');
  await page.evaluate(function () { if (MCL.Sky) { MCL.Sky.daylightCycle = false; MCL.Sky.weatherCycle = false; var wD = MCL.Sky.weather; if (wD) { wD.raining = wD.thundering = false; wD.rainLevel = wD.oRainLevel = wD.thunderLevel = wD.oThunderLevel = 0; } } });
  await page.evaluate(function () { if (MCL.Spawn) MCL.Spawn.ready = false; });
  await sleep(3000);

  const shot = async () => {
    const s = await page.send('Page.captureScreenshot', { format: 'png' });
    return { rgba: toRgba(decodePng(Buffer.from(s.data, 'base64'))), raw: s.data };
  };
  const ev = (src) => page.evaluate(new Function(src));
  const frames = (n) => page.waitFor(new Function(
    'if (window.__fb === undefined) { window.__fb = MCL.Main.frame | 0; return 0; }' +
    'if (((MCL.Main.frame | 0) - window.__fb) < ' + n + ') return 0;' +
    'window.__fb = undefined; return 1;'), 20000);
  /** Advance a few frames, then screenshot — every comparison in this file diffs two shots
   *  taken this way, seconds (not tens of seconds) apart — see this file's own header. */
  const step = async (n) => { await frames(n || 6); return shot(); };

  
  console.log('\n1. the stage');
  const stage = await ev(
    'var P = MCL.Player, W = MCL.World;' +
    'P.pitch = 0; if (P.interpolate) P.interpolate(1);' +
    'var f = P.lookVec(), rx = -f[2], rz = f[0];' +
    'for (var d = 3; d <= 6; d += 0.5) for (var s = -1; s <= 1; s += 0.5) {' +
    '  var x = P.x + f[0] * d + rx * s, z = P.z + f[2] * d + rz * s;' +
    '  var bx = Math.floor(x), bz = Math.floor(z);' +
    '  for (var dy = 0; dy <= 3; dy++) {' +
    '    var y = Math.floor(P.y) + dy;' +
    '    if (W.getBlock(bx, y, bz) === 0 && W.getBlock(bx, y + 1, bz) === 0 && W.getBlock(bx, y + 2, bz) === 0 && W.getBlock(bx, y - 1, bz) !== 0) return { x: x, y: y, z: z };' +
    '  }' +
    '}' +
    'return null;');
  if (!ok(!!stage, 'found an open floored spot in front of the player')) throw new Error('no stage');

  const spawn = (enchanted) => ev(
    'var EL = MCL.EntityList, IT = MCL.Items; EL.list.length = 0;' +
    'var e = EL.spawn("zombie", ' + stage.x + ', ' + stage.y + ', ' + stage.z + ');' +
    'if (!e) return false; e.equip = e.equip || [];' +
    'e.equip[IT.CHEST] = { i: IT.names.indexOf("iron_chestplate"), n: 1, d: 0, t: ' + (enchanted ? '{ Enchantments: [{ id: "minecraft:protection", lvl: 1 }] }' : 'null') + ' };' +
    'e.aiDisabled = true; e.fire = 0; e.invulnerable = true; return true;');
  const nrm = (a) => compare(a.rgba, a.rgba); void nrm;
  /** median of 3 frame-to-frame diffs, a fresh pair each time */
  const scroll = async () => {
    const v = [];
    for (let i = 0; i < 3; i++) { const a = await step(5); const b = await step(5); v.push(compare(a.rgba, b.rgba).differing); }
    v.sort((x, y) => x - y); return v[1];
  };

  console.log('\n2. plain chestplate (control) vs enchanted');
  ok(await spawn(false), 'zombie with a plain iron chestplate spawns');
  await sleep(2500);
  await scroll();   // settle (chunk uploads / first-draw churn), not measured
  const plain = Math.min(await scroll(), await scroll());
  ok(await spawn(true), 'zombie with an enchanted iron chestplate spawns');
  await sleep(1000);
  const glint = Math.max(await scroll(), await scroll());
  const backend = await ev('return MCL.Gfx.name;');
  console.log('   backend ' + backend + ': frame-to-frame changed px  plain ' + plain + '  enchanted ' + glint);
  ok(glint > plain * 1.5 + 200, 'the enchanted chestplate changes more pixels frame-to-frame than the plain one (' + glint + ' > ' + plain + ' * 1.5 + 200)');

  console.log('\n3. anti-vacuity (each break must bring the enchanted figure back to the plain one)');
  await ev('window.__sg = MCL.EntityRender.stackHasGlint; MCL.EntityRender.stackHasGlint = function () { return false; }; return 1;');
  await sleep(300);
  const b1 = await scroll();
  okAv(b1 < glint * 0.6, 'stackHasGlint -> false (no foil quads emitted): ' + b1 + ' px, was ' + glint);
  await ev('MCL.EntityRender.stackHasGlint = window.__sg; return 1;');
  await sleep(300);
  const b3 = await scroll();
  okAv(b3 > plain * 1.5 + 200, 'restored: the glint is back (' + b3 + ' > ' + plain + ' * 1.5 + 200), so the break above was real');
  await ev('MCL.EntityList.list.length = 0; return 1;');

  ok(page.problems.length === 0, 'the page logged no errors (' + page.problems.slice(0, 2).join(' | ') + ')');
} catch (e) {
  fails.push('harness: ' + (e && e.message));
  console.log('FAIL  harness: ' + (e && (e.stack || e.message)));
} finally {
  await page.close();
}

console.log('\n===========================================');
console.log(' glintdrawcheck: ' + pass + ' assertions, ' + fails.length + ' failed, ' + breaks + ' breaks caught');
console.log('===========================================');
process.exit(fails.length ? 1 : 0);
