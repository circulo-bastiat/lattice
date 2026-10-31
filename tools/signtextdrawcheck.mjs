#!/usr/bin/env node
// signtextdrawcheck.mjs — #9262: BE.signTextLayout's glyphs drawn on the sign board (ER.signTextVerts, riding
// the crystal-beam pass), proven on a real screenshot: text changes pixels vs an empty sign, a dyed sign has the
// dye colour, a glowing black sign has the 0xF0EBCC outline. Anti-vacuity: skip the draw, wrong colour.
//
//   MCLITE_PRESET=medium node tools/signtextdrawcheck.mjs [dist/mclite.html]

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
  port: 9461, width: 960, height: 540,
  initScript: 'window.addEventListener("load", function () { setTimeout(function () {' +
             ' if (window.MCL && MCL.Sky) { MCL.Sky.daylightCycle = false; MCL.Sky.weatherCycle = false; var wD = MCL.Sky.weather; if (wD) { wD.raining = wD.thundering = false; wD.rainLevel = wD.oRainLevel = wD.thunderLevel = wD.oThunderLevel = 0; } } }, 50); });',
});
if (!page) { console.log('SKIP  signtextdrawcheck: no Chromium found'); process.exit(0); }

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
  await page.waitFor(function () { var P = MCL.Player; return !!(P.onGround && MCL.Main.frame > 120); }, 30000);
  await sleep(1500);

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

    // ── the stage: a standing sign facing the player, in an open lit spot ───────────────────
  await ev('MCL.__flip = ' + (process.argv.includes('--flip') ? 1 : 0) + '; return 1;');
  const stage = await ev(
    'var P = MCL.Player, W = MCL.World;' +
    'P.pitch = 0; if (P.interpolate) P.interpolate(1);' +
    'var f = P.lookVec();' +
    'for (var d = 2; d <= 4; d += 0.5) {' +
    '  var bx = Math.floor(P.x + f[0] * d), bz = Math.floor(P.z + f[2] * d);' +
    '  for (var dy = -1; dy <= 2; dy++) {' +
    '    var y = Math.floor(P.y) + dy;' +
    '    if (W.getBlock(bx, y, bz) === 0 && W.getBlock(bx, y + 1, bz) === 0 && W.getBlock(bx, y - 1, bz) !== 0 && (W.getLight(bx, y, bz) >> 4) >= 12) {' +
    '      var a = Math.atan2(-f[0], -f[2]) + (MCL.__flip ? Math.PI : 0), r = (((Math.round(-a / (Math.PI / 8))) % 16) + 16) % 16;' +
    '      return { x: bx, y: y, z: bz, rot: r };' +
    '    }' +
    '  }' +
    '}' +
    'return null;');
  if (!ok(!!stage, 'found an open, lit, floored spot in front of the player')) throw new Error('no stage');
  await ev('MCL.EntityList.list.length = 0; return 1;');
  const setSign = (lines, color, glow) => ev(
    'var W = MCL.World, SR = MCL.States, R = MCL.Reg, BE = MCL.BlockEntities;' +
    'var st = SR.stateOf("oak_sign"), vi = R.valueNames.indexOf("' + stage.rot + '");' +
    'st = SR.withProp(st, R.PROP.rotation, vi);' +
    'W.setBlock(' + stage.x + ',' + stage.y + ',' + stage.z + ', st);' +
    'var e = BE.get(' + stage.x + ',' + stage.y + ',' + stage.z + ') || BE.create(' + stage.x + ',' + stage.y + ',' + stage.z + ', "sign");' +
    'e.lines = ' + JSON.stringify(lines) + '; e.color = "' + color + '"; e.glowing = ' + glow + ';' +
    'return { be: !!e, state: SR.name(W.getBlock(' + stage.x + ',' + stage.y + ',' + stage.z + ')) };');
  const empty = ['', '', '', ''], hello = ['HELLO', 'WORLD', 'HELLO', 'WORLD'];
  const r0 = await setSign(empty, 'black', false);
  ok(r0.be && /oak_sign/.test(r0.state), 'an oak_sign with a block entity is placed (' + r0.state + ')');
  console.log('   stage ' + JSON.stringify(stage));
  const base = await step(8);
  await setSign(hello, 'black', false);
  const txt = await step(8);
  if (process.argv.includes('--shots')) { writeFileSync('/tmp/sign-base.png', Buffer.from(base.raw, 'base64')); writeFileSync('/tmp/sign-txt.png', Buffer.from(txt.raw, 'base64')); }
  const d1 = compare(base.rgba, txt.rgba);
  console.log('   HELLO vs empty: ' + d1.differing + ' px');
  const want = 40;
  ok(d1.differing > want, 'a sign with text changes more pixels than the empty sign (' + d1.differing + ' > ' + want + ')');

  // colour counts of "strongly red" pixels
  const newPx = (s, ref, f) => { let n = 0; for (let i = 0; i < s.rgba.data.length; i += 4) { const a = [s.rgba.data[i], s.rgba.data[i + 1], s.rgba.data[i + 2]], b = [ref.rgba.data[i], ref.rgba.data[i + 1], ref.rgba.data[i + 2]]; if (f(...a) && !f(...b)) n++; } return n; };
  const isRed = (r, g, b) => r > g + 50 && r > b + 50, isPale = (r, g, b) => r > 200 && g > 190 && b > 140 && r - b > 20 && r - b < 90;
  const reds = (s) => { let n = 0; for (let i = 0; i < s.rgba.data.length; i += 4) { const r = s.rgba.data[i], g = s.rgba.data[i + 1], b = s.rgba.data[i + 2]; if (r > 120 && g < 40 && b < 40) n++; } return n; };
  const pale = (s) => { let n = 0; for (let i = 0; i < s.rgba.data.length; i += 4) { const r = s.rgba.data[i], g = s.rgba.data[i + 1], b = s.rgba.data[i + 2]; if (r > 225 && g > 215 && b > 170 && b < 225) n++; } return n; };
  await setSign(hello, 'red', true);
  const redGlow = await step(8);
  await setSign(hello, 'red', false);
  const redDim = await step(8);
  if (process.argv.includes('--shots')) writeFileSync('/tmp/sign-red.png', Buffer.from(redGlow.raw, 'base64'));
  const rN = newPx(redGlow, base, isRed);
  ok(rN > 10, 'a glowing red sign adds red pixels over the empty sign (' + rN + ')');
  await setSign(hello, 'black', true);
  const blackGlow = await step(8);
  const pN = newPx(blackGlow, base, isPale), pT = newPx(txt, base, isPale);
  ok(pN > pT + 10, 'a glowing black sign has the 0xF0EBCC outline (' + pN + ' vs ' + pT + ')');
  const d3 = compare(txt.rgba, blackGlow.rgba);
  ok(d3.differing > want, 'glowing differs from plain (' + d3.differing + ')');
  void redDim;

  // ── anti-vacuity ────────────────────────────────────────────────────────────────────────
  console.log('\nanti-vacuity');
  await ev('MCL.EntityRender.skipSignText = true; return 1;');
  await setSign(hello, 'black', false);
  await step(16);
  const skipA = await step(8);
  await setSign(empty, 'black', false);
  await step(16);
  const skipB = await step(8);
  const skipC = await step(8);
  console.log('   noise floor (same scene twice): ' + compare(skipB.rgba, skipC.rgba).differing + ' px');
  const noise = compare(skipB.rgba, skipC.rgba).differing, dSkip = compare(skipA.rgba, skipB.rgba).differing;
  okAv(dSkip <= noise + d1.differing / 4, 'with the draw skipped the text sign matches the empty one up to frame noise (' + dSkip + ' px, noise ' + noise + ', text ' + d1.differing + ')');
  await ev('MCL.EntityRender.skipSignText = false; return 1;');
  await ev('window.__sc = MCL.BlockEntities.SIGN_COLORS.red; MCL.BlockEntities.SIGN_COLORS.red = 0x0000FF; return 1;');
  await setSign(hello, 'red', true);
  const wrong = await step(8);
  const wN = newPx(wrong, base, isRed);
  okAv(wN < rN / 2, 'with a wrong dye colour the red pixels vanish (' + wN + ' vs ' + rN + ')');
  await ev('MCL.BlockEntities.SIGN_COLORS.red = window.__sc; return 1;');

  ok(page.problems.length === 0, 'the page logged no errors (' + page.problems.slice(0, 2).join(' | ') + ')');
} catch (e) {
  fails.push('harness: ' + (e && e.message));
  console.log('FAIL  harness: ' + (e && (e.stack || e.message)));
} finally {
  await page.close();
}

console.log('\n===========================================');
console.log(' signtextdrawcheck: ' + pass + ' assertions, ' + fails.length + ' failed, ' + breaks + ' breaks caught');
console.log('===========================================');
process.exit(fails.length ? 1 : 0);
