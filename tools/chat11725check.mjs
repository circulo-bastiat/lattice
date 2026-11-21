#!/usr/bin/env node
// chat11725check.mjs — #11725: proves ChatHudLine (scrollback entry {component,tick}), ChatHudListener / ClientChatListener
// (every speaker goes through Chat.add / Chat.say) and GameInfoChatListener (the action-bar overlay alpha, H.actionBarAlpha) with source breaks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const HUD = readFileSync(join(ROOT, 'src', '15_hud.js'), 'utf8');
function trial(chatPatch, hudPatch) {
  const NS = { CFG: {} }; globalThis.MCL = NS;
  let s = readFileSync(join(ROOT, 'src', '15c_chat.js'), 'utf8'); if (chatPatch) s = chatPatch(s);
  new Function('MCL', s)(NS);
  NS.Text = { literal: (t) => ({ text: t, style: null }), runs: (c) => [{ text: c.text, style: c.style || null }] };
  const C = NS.Chat, o = {};
  C.tick = 7; const line = C.add({ text: 'hello', style: null });
  o.hudLine = line.tick === 7 && line.component.text === 'hello' && C.messages.length === 1;
  const l2 = C.say('second'); o.listener = l2.component.text === 'second' && C.messages.length === 2 && C.lines[0].runs[0].text === 'second';
  for (let i = 0; i < 110; i++) C.say('x' + i);
  o.cap = C.messages.length === 100;
  // action bar: the 15_hud.js function, run in isolation
  let h = HUD; if (hudPatch) h = hudPatch(h);
  const fn = /H\.actionBarAlpha = function \(t\) \{[\s\S]*?\n  \};/.exec(h);
  const fade = /H\.ACTION_BAR_FADE = (\d+)/.exec(h);
  const H = { ACTION_BAR_FADE: fade ? +fade[1] : 20 };
  new Function('H', fn[0])(H);
  o.barNone = H.actionBarAlpha(null) === 0 && H.actionBarAlpha({ barTime: -5 }) === 0;
  o.barSolid = H.actionBarAlpha({ barTime: 40 }) === 255;
  o.barFade = Math.abs(H.actionBarAlpha({ barTime: H.ACTION_BAR_FADE / 2 }) - 127.5) < 1e-9;
  o.reach = /H\.actionBarAlpha\(t\)/.test(h);
  return o;
}
const A = trial(null, null);
for (const k of Object.keys(A)) ok(A[k], 'scenario ' + k + ' ' + JSON.stringify(A));
const BR = [
  ['tickStamp', ['c', 'tick: C.tick }'], 'tick: 0 }', ['hudLine']],
  ['historyCap', ['c', 'C.messages.length > C.MAX_HISTORY'], 'C.messages.length > 1000', ['cap']],
  ['sayRoutes', ['c', 'return C.add(NS.Text'], 'return ({ component: { text: "" } }, NS.Text', ['listener']],
  ['barZero', ['h', 'if (!t || t.barTime <= 0) return 0;'], 'if (!t) return 0;', ['barNone']],
  ['barCap', ['h', 'Math.min(255, t.barTime'], 'Math.min(200, t.barTime', ['barSolid']],
];
for (const [key, [w, a], b, expect] of BR) {
  breaks++; let hit = false, X;
  const p = (s) => { if (s.includes(a)) { hit = true; return s.replace(a, b); } return s; };
  try { X = w === 'c' ? trial(p, null) : trial(null, p); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key + ' ' + JSON.stringify(X));
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(`chat11725check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
