#!/usr/bin/env node
// deathscreen11725check.mjs — #11725: DeathScreen geometry/strings (H.deathLayout/deathTitle/deathButtons/deathScore) and its draw, proven with source breaks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const HUD = readFileSync(join(ROOT, 'src/15_hud.js'), 'utf8');
const grab = (s, re, w) => { const m = re.exec(s); if (!m) throw new Error('missing ' + w); return m[0]; };
function trial(patch) {
  const h = patch ? patch(HUD) : HUD, o = {}, H = {};
  const src = grab(h, /H\.deathLayout = function[\s\S]*?\n  \};/, 'l') + grab(h, /H\.deathTitle = [^\n]*/, 't') + grab(h, /H\.deathButtons = [^\n]*/, 'b') + grab(h, /H\.deathScore = [^\n]*/, 's');
  new Function('H', src)(H);
  const L = H.deathLayout(640, 480, 2);   // gui 320x240
  o.rows = L.titleY === 120 && L.msgY === 170 && L.scoreY === 200 && L.titleScale === 4;
  o.btns = L.buttons[0].y === (60 + 72) * 2 && L.buttons[1].y === (60 + 96) * 2 && L.buttons[0].w === 400 && L.buttons[0].h === 40 && L.buttons[0].x === 120;
  o.grad = L.gradTop === 'rgba(80,0,0,0.376)' && L.gradBottom === 'rgba(128,48,48,0.627)';
  o.text = H.deathTitle(false) === 'You died!' && H.deathTitle(true) === 'Game Over!' && H.deathButtons(false)[0] === 'Respawn' && H.deathButtons(true)[0] === 'Spectate World' && H.deathButtons(false)[1] === 'Title Screen';
  o.score = H.deathScore({ score: 7, xpTotal: 3 }) === 7 && H.deathScore({ xpTotal: 3 }) === 3 && H.deathScore({}) === 0;
  o.wired = /if \(P\.dead\) \{\n      var DL = H\.deathLayout/.test(h) && /'Score: '/.test(h);
  return o;
}
const base = trial(); for (const [k, v] of Object.entries(base)) ok(v, 'baseline ' + k);
const BR = [
  ['title', 'titleY: 60 * s', 'titleY: 30 * s', ['rows']], ['msg', 'msgY: 85 * s', 'msgY: 80 * s', ['rows']], ['score', 'scoreY: 100 * s', 'scoreY: 95 * s', ['rows']],
  ['b1', '(q + 72) * s', '(q + 70) * s', ['btns']], ['b2', '(q + 96) * s', '(q + 92) * s', ['btns']], ['bw', 'w: 200 * s, h: 20 * s }, {', 'w: 150 * s, h: 20 * s }, {', ['btns']],
  ['gradT', 'rgba(80,0,0,0.376)', 'rgba(80,0,0,0.5)', ['grad']], ['gradB', 'rgba(128,48,48,0.627)', 'rgba(128,48,48,0.9)', ['grad']],
  ['hc', "'Game Over!'", "'You died!'", ['text']], ['spec', "'Spectate World'", "'Respawn'", ['text']],
  ['score2', 'P.score != null ? P.score : P.xpTotal', '0', ['score']], ['unwired', "var DL = H.deathLayout(H.w, H.h, s)", "var DL = 0; H.deathLayout(H.w, H.h, s)", ['wired']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  const p = (s) => { const j = s.indexOf(a); if (j >= 0) { hit = true; return s.slice(0, j) + b + s.slice(j + a.length); } return s; };
  try { X = trial(p); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key);
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(`deathscreen11725check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
