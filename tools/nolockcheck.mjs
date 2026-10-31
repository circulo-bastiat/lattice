#!/usr/bin/env node
// nolockcheck.mjs — #2091: the game is playable without pointer lock (VM / RDP / remote).
//   MCLITE_PRESET=medium node tools/nolockcheck.mjs [dist/mclite.html]
// Enables no-lock mode, holds the look keys through CDP and asserts yaw changes while the world
// keeps ticking and nothing pauses; drags the right button; then breaks the mode and proves the
// same inputs do nothing (anti-vacuity).
import { open, sleep } from './cdp.mjs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FILE = args[0] ? (args[0].startsWith('/') ? args[0] : ROOT + args[0]) : ROOT + 'dist/mclite.html';

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m, d) => { if (c) { pass++; console.log('ok    ' + m); } else { fails.push(m + (d !== undefined ? ' (' + d + ')' : '')); console.log('FAIL  ' + m + (d !== undefined ? '   ' + d : '')); } return c; };
const okAv = (c, m, d) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else { fails.push('anti-vacuity: ' + m + (d !== undefined ? ' (' + d + ')' : '')); console.log('   x ' + m + (d !== undefined ? '   ' + d : '')); } };

const page = await open(FILE, { port: 9453, width: 960, height: 540 });
if (!page) { console.log('SKIP  nolockcheck: no Chromium found'); process.exit(0); }

try {
  await sleep(1200);
  await page.evaluate(function () { if (window.MCL && MCL.Main && !MCL.Main.ready) MCL.Main.play({}); });
  const up = await page.waitFor(function () {
    return !!(window.MCL && MCL.Main.ready && MCL.Hud.mode === 'game' && MCL.World.chunks.size > 20);
  }, 60000);
  if (!ok(up, 'the world came up', page.lastThrow)) throw new Error('never reached the game');
  const ev = (src) => page.evaluate(new Function(src));
  const hold = async (code, key, ms) => {
    const base = { key, code, windowsVirtualKeyCode: key === 'ArrowRight' ? 39 : key === 'ArrowLeft' ? 37 : key.toUpperCase().charCodeAt(0) };
    await page.send('Input.dispatchKeyEvent', Object.assign({ type: 'rawKeyDown' }, base));
    await sleep(ms);
    await page.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, base));
  };
  const snap = () => ev('return { yaw: MCL.Player.yaw, pitch: MCL.Player.pitch, frame: MCL.Main.frame | 0, tick: (MCL.Main.tick || MCL.Main.ticks || 0), screen: MCL.Hud.screen || null, locked: MCL.Input.locked };');

  // --- before: no lock available, look keys do nothing (the normal path is unchanged)
  ok(await ev('return MCL.Input.noLock === false;'), 'no-lock mode is off by default');
  await ev('MCL.Input.locked = false; MCL.Input.uiOpen = false; return 1;');
  let a = await snap();
  await hold('ArrowRight', 'ArrowRight', 500);
  let b = await snap();
  okAv(Math.abs(b.yaw - a.yaw) < 1e-9, 'with no-lock OFF and no lock the arrow keys do not turn the player', a.yaw + ' -> ' + b.yaw);

  // --- enable
  await ev('MCL.Input.setNoLock(true); return 1;');
  ok(await ev('return MCL.Input.noLock && MCL.Input.locked && !MCL.Hud.needClick;'), 'setNoLock(true) gives the game the input without a real lock');
  await sleep(200);
  a = await snap();
  await hold('ArrowRight', 'ArrowRight', 500);
  b = await snap();
  const d1 = b.yaw - a.yaw;
  ok(Math.abs(d1) > 0.3, 'ArrowRight turns the player at a fixed rate', 'dyaw=' + d1.toFixed(3));
  await hold('ArrowLeft', 'ArrowLeft', 500);
  const c = await snap();
  ok(Math.abs(c.yaw - b.yaw) > 0.3 && Math.sign(c.yaw - b.yaw) !== Math.sign(d1), 'ArrowLeft turns it back', 'dyaw=' + (c.yaw - b.yaw).toFixed(3));
  await hold('KeyK', 'k', 400);
  const k = await snap();
  ok(Math.abs(k.pitch - c.pitch) > 0.2, 'K (IJKL) changes the pitch', 'dpitch=' + (k.pitch - c.pitch).toFixed(3));
  ok(k.frame > a.frame + 10, 'frames keep running', a.frame + ' -> ' + k.frame);
  ok(k.screen === null, 'no pause screen opened', k.screen);

  // --- right-button drag looks
  const y0 = (await snap()).yaw;
  await ev(
    'var fire = function (t, o) { window.dispatchEvent(new MouseEvent(t, Object.assign({ bubbles: true, clientX: 400, clientY: 300 }, o))); };' +
    'fire("mousedown", { button: 2 }); fire("mousemove", { clientX: 440, clientY: 300, movementX: 40, buttons: 2 }); fire("mousemove", { clientX: 480, clientY: 300, movementX: 40, buttons: 2 }); fire("mouseup", { button: 2 }); return 1;');
  await sleep(300);
  const y1 = (await snap()).yaw;
  ok(Math.abs(y1 - y0) > 0.1, 'a right-button drag turns the player', 'dyaw=' + (y1 - y0).toFixed(3));
  const pl = await ev(
    'var fire = function (t, o) { window.dispatchEvent(new MouseEvent(t, Object.assign({ bubbles: true, clientX: 400, clientY: 300 }, o))); };' +
    'var n = 0; var oldE = MCL.Input.endFrame; MCL.Input.endFrame = function () { if (MCL.Input.mousePressed[2]) n++; oldE.call(MCL.Input); };' +
    'fire("mousedown", { button: 2 }); fire("mouseup", { button: 2 }); window.__n = function () { return n; }; return 1;');
  await sleep(300);
  ok(await ev('return window.__n() === 1;'), 'a right click that does not drag is still a place press (not a look)');

  // --- Esc still opens the menu
  await page.key('Escape');
  await sleep(300);
  ok(await ev('return !!MCL.Hud.screen;'), 'Esc opens the menu');
  await page.key('Escape');
  await sleep(300);
  ok(await ev('return !MCL.Hud.screen && MCL.Input.locked;'), 'Esc closes it and the game has the input again (no click needed)');

  // --- a lost real lock does not pause
  await ev('document.dispatchEvent(new Event("pointerlockchange")); return 1;');
  await sleep(200);
  ok(await ev('return !MCL.Hud.screen && MCL.Input.locked;'), 'a pointerlockchange does not unlock or pause in no-lock mode');

  // --- anti-vacuity: switch it off again, the keys stop working
  await ev('MCL.Input.setNoLock(false); MCL.Input.locked = true; MCL.Input.uiOpen = false; return 1;');
  a = await snap();
  await hold('ArrowRight', 'ArrowRight', 500);
  b = await snap();
  okAv(Math.abs(b.yaw - a.yaw) < 1e-9, 'switched back off, the arrow keys no longer turn the player', a.yaw + ' -> ' + b.yaw);
  ok(page.problems.length === 0, 'the page logged no errors (' + page.problems.slice(0, 2).join(' | ') + ')');
} catch (e) {
  fails.push('harness: ' + (e && e.message));
  console.log('FAIL  harness: ' + (e && (e.stack || e.message)));
} finally {
  await page.close();
}
console.log('\n===========================================');
console.log(' nolockcheck: ' + pass + ' assertions, ' + fails.length + ' failed, ' + breaks + ' breaks');
console.log('===========================================');
process.exit(fails.length ? 1 : 0);
