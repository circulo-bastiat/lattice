#!/usr/bin/env node
// chat11610check.mjs — #11610: proves 15c_chat.js ChatHud (fade/scrollback/wrap/visible) and the
// ConfirmChatLinkScreen entry (open_url click -> sinks.confirmUrl, protocol gate) via Chat.add / Chat.handleClick, with SOURCE breaks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const F = '15c_chat.js';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const NS = { CFG: {} }; globalThis.MCL = NS;
  let s = readFileSync(join(ROOT, 'src', F), 'utf8'); if (patch) s = patch(F, s);
  new Function('MCL', s)(NS);
  NS.Text = { literal: (t) => ({ text: t, style: null }), runs: (c) => [{ text: c.text, style: c.style || null }] };
  const C = NS.Chat, o = {};
  const L0 = () => C.lines[0].runs.map((r) => r.text).join('');
  const link = (action, value) => ({ text: 'click me', style: { clickEvent: { action, value } } });
  // fade curve
  o.fadeFull = C.alphaAt(0) === 1 && C.alphaAt(170) === 1;
  o.fadeCurve = Math.abs(C.alphaAt(190) - 0.25) < 1e-9 && C.alphaAt(200) === 0;
  // history cap + visibility
  for (let i = 0; i < 105; i++) C.say('m' + i);
  o.cap = C.messages.length === 100 && C.messages[99].component.text === 'm104';
  o.newestFirst = C.lines[0].runs[0].text === 'm104';
  o.closedLimit = C.visible().length === 10;
  C.open = true; o.openLimit = C.visible().length === 20;
  C.open = false; C.tick = 250; o.faded = C.visible().length === 0;
  C.tick = 0;
  C.messages = []; C.say('old'); C.tick = 400; C.open = true; o.openFull = C.visible().length === 1; C.open = false; C.tick = 0;
  // wrap: a long unbroken word is split mid-word within WIDTH
  C.messages = []; C.say('m'.repeat(200));
  o.wrap = C.lines.length > 1 && C.lines.every((l) => l.runs.every((r) => C.widthOf(r.text) <= C.WIDTH));
  // ConfirmChatLinkScreen entry: open_url
  C.messages = []; C.lines = []; C.pendingLink = null;
  C.add(link('open_url', 'https://example.com/x')); C.open = true;
  const H = 240, gx = C.LEFT + 2, gy = H + C.BOTTOM - 4;
  o.styleHit = !!C.styleAt(gx, gy, H);
  o.handled = C.handleClick(gx, gy, H, 'p') === true;
  o.confirm = C.pendingLink === 'https://example.com/x';
  C.pendingLink = null; C.messages = []; C.lines = [];
  C.add(link('open_url', 'ftp://example.com')); C.handleClick(gx, gy, H, 'p');
  o.refuse = C.pendingLink === null && L0().indexOf('Unsupported protocol: ftp') === 0;
  C.messages = []; C.lines = [];
  C.add(link('open_url', 'example.com')); C.handleClick(gx, gy, H, 'p');
  o.noScheme = C.pendingLink === null && L0() === 'Missing protocol';
  return o;
}
const A = trial(null);
for (const k of Object.keys(A)) ok(A[k], 'scenario ' + k + ' ' + JSON.stringify(A));
const BR = [
  ['fadeSquare', 'return d * d;', 'return d;', ['fadeCurve']],
  ['historyCap', 'if (C.messages.length > C.MAX_HISTORY) C.messages.shift();', '', ['cap']],
  ['closedLines', 'LINES_CLOSED: 10,', 'LINES_CLOSED: 7,', ['closedLimit']],
  ['openFull', 'var a = C.open ? 1 : C.alphaAt(age);', 'var a = C.alphaAt(age);', ['openFull']],
  ['httpGate', "if (sch !== 'http' && sch !== 'https') {", "if (false) {", ['refuse', 'noScheme']],
  ['confirmSink', 'C.sinks.confirmUrl(v);', '', ['confirm']],
  ['midWordBreak', 'if (take === 0) take = 1;', 'take = tok.length;', ['wrap']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((f, s) => { if (s.includes(a)) { hit = true; return s.replace(a, b); } return s; }); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key + ' ' + JSON.stringify(X));
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `chat11610check: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
