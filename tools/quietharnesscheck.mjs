#!/usr/bin/env node
// tools/quietharnesscheck.mjs — the test harness must never touch Dan's real mouse or speakers (D-817).
// 27 Sept 2026: running the suite on his PC trapped his cursor in a box (headless Chromium's pointer lock → Windows
// ClipCursor on the hidden window) and played game audio. Asserts, in both directions, that EVERY file that launches a
// browser passes QUIET_FLAGS and installs NO_OS_INPUT, and that NO_OS_INPUT really emulates pointer lock in the page.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { QUIET_FLAGS, NO_OS_INPUT } from './cdp.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log(` ✗ ${m}`); } };
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? (f === 'node_modules' ? [] : walk(p)) : f.endsWith('.mjs') ? [p] : []; });

// 1. every launcher (a file that passes --headless to a spawned browser) is quiet
const launchers = walk(join(ROOT, 'tools')).filter((p) => p !== fileURLToPath(import.meta.url) && /'--headless(=new)?'/.test(readFileSync(p, 'utf8')));
ok(launchers.length >= 3, `expected the three launchers (cdp, smoke, bench), found ${launchers.length}`);
const quiet = (src) => /\.\.\.QUIET_FLAGS/.test(src) && /NO_OS_INPUT/.test(src);
for (const p of launchers) ok(quiet(readFileSync(p, 'utf8')), `${p.slice(ROOT.length + 1)} launches a browser without QUIET_FLAGS + NO_OS_INPUT (Dan's cursor/speakers)`);
ok(QUIET_FLAGS.includes('--mute-audio'), 'QUIET_FLAGS lost --mute-audio');

// 2. NO_OS_INPUT emulates pointer lock in the page and never calls the real API
function sandbox() {
  let realCalls = 0; const events = [];
  class Element { requestPointerLock() { realCalls++; } }
  class Document { exitPointerLock() { realCalls++; } dispatchEvent(e) { events.push(e.type); } }
  const document = new Document();
  const ctx = { Element, Document, document, window: {}, Event: class { constructor(t) { this.type = t; } }, Promise, setTimeout: (f) => f() };
  vm.createContext(ctx);
  return { ctx, run: (src) => vm.runInContext(src, ctx), get realCalls() { return realCalls; }, events };
}
{
  const s = sandbox(); s.run(NO_OS_INPUT);
  const el = new s.ctx.Element();
  el.requestPointerLock();
  ok(s.ctx.document.pointerLockElement === el && s.events.includes('pointerlockchange'), 'emulated lock: pointerLockElement + pointerlockchange');
  s.ctx.document.exitPointerLock();
  ok(s.ctx.document.pointerLockElement === null, 'emulated unlock');
  ok(s.realCalls === 0, 'the REAL pointer-lock API was called (that is what traps Dan\'s cursor)');
  ok(s.ctx.window.__MCLITE_NO_OS_INPUT === true, 'marker missing');
}
// anti-vacuity: without the stub the real API is reached; a launcher missing the flags is caught
{
  const s = sandbox(); new s.ctx.Element().requestPointerLock();
  ok(s.realCalls === 1, 'BREAK: without NO_OS_INPUT the real API must be reached (else section 2 proves nothing)');
  ok(!quiet("spawn(c, ['--headless=new', '--no-sandbox'])"), 'BREAK: a launcher without the quiet flags must be caught');
}
console.log(fails ? `quietharnesscheck: ${fails} of ${n} FAILED` : `quietharnesscheck: ${n} passed, 0 failed`);
process.exit(fails ? 1 : 0);
