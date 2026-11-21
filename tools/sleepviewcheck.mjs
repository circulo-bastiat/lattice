#!/usr/bin/env node
// sleepviewcheck.mjs — G17-O8. G.sleepOverlay / sleepScreen / sleepLeave vs InGameHud.java:235-249 and SleepingChatScreen.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'src/15b_gui.js'), 'utf8');
function load(src) {
  const NS = { Sleep: { wake(P, r) { P.sleepTimer = r ? 0 : 100; P.sleeping = false; P.woke = true; } } };
  try { new Function('MCL', src)(NS); } catch (e) { /* module init needs a DOM; the pure functions are set before */ }
  return NS;
}
let asserted = 0;
function verify(src) {
  const f = [], no = (c, m) => { asserted++; if (!c) f.push(m); };
  const NS = load(src), G = NS.Gui;
  if (!G || !G.sleepOverlay) return ['Gui.sleepOverlay missing'];
  no(G.sleepOverlay(0) === null, 'timer 0 draws nothing');
  const ref = t => { let a = t / 100; if (a > 1) a = 1 - (t - 100) / 10; return ((Math.floor(220 * a) << 24) | 1052704) >>> 0; };
  for (let t = 1; t <= 110; t++) no(G.sleepOverlay(t).argb === ref(t), 'argb at ' + t);
  no(G.sleepOverlay(100).argb >>> 24 === 220, 'full alpha 220');
  no(G.sleepOverlay(110).argb >>> 24 === 0, 'wake ramp ends at 0');
  const b = G.sleepScreen(854, 480);
  no(b.x === 327 && b.y === 440 && b.w === 200 && b.h === 20, 'button geometry');
  no(b.key === 'multiplayer.stopSleeping' && b.label === 'Leave Bed', 'label');
  const P = { sleepTimer: 50, sleeping: true };
  G.sleepLeave(P);
  no(P.woke && P.sleepTimer === 0 && !P.sleeping, 'leave bed wakes and resets timer');
  return f;
}
const ok = verify(SRC);
let bad = 0;
for (const [a, b] of [['/ 100;', '/ 90;'], ['/ 10;', '/ 20;'], ['h - 40', 'h - 30'], ['wake(P, true)', 'wake(P, false)'], ['220 * a', '200 * a']]) {
  if (!SRC.includes(a)) { console.log('FAIL break target missing: ' + a); process.exit(1); }
  if (verify(SRC.replace(a, b)).length) { bad++; console.log(`  ✓ break caught: ${a}`); }
}
if (ok.length || bad < 5) { console.log('FAIL', ok, bad); process.exit(1); }
console.log(`assertions passed ..... ${asserted}`);
console.log(`${bad} breaks caught (sleepviewcheck OK)`);
