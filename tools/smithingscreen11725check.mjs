#!/usr/bin/env node
// smithingscreen11725check.mjs — #11725: SmithingScreen / ForgingScreen (H.openSmithing, smithAt, smithingClick,
// H.draw dispatch, close-time drop of the inputs) proven with source breaks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const grab = (s, re, what) => { const m = re.exec(s); if (!m) throw new Error('missing ' + what); return m[0]; };
const HUD = readFileSync(join(ROOT, 'src/15_hud.js'), 'utf8');
const MAIN = readFileSync(join(ROOT, 'src/17_main.js'), 'utf8');
function trial(patch, mainPatch) {
  const h = patch ? patch(HUD) : HUD, mn = mainPatch ? mainPatch(MAIN) : MAIN, o = {};
  const calls = []; let opened = null;
  const NS = { Player: { menu: { inventory: {} } },
    Menu: { smithingMenu: () => ({ slots: [], refresh() {} }), OUTSIDE: -999, PICKUP: 0, QUICK_MOVE: 1,
      doClick: (m, s, b, t) => calls.push([s, t]) } };
  const H = { open: (n) => { opened = n; } };
  const src = grab(h, /H\.openSmithing = function[\s\S]*?\n  \};/, 'open') + grab(h, /function smithXY[\s\S]*?\n  \}\n  function smithAt[\s\S]*?\n  \}\n/, 'xy')
    + 'H.smithAt = smithAt;' + grab(h, /H\.smithingClick = function[\s\S]*?\n  \};/, 'click');
  new Function('H', 'NS', src)(H, NS);
  o.open = H.openSmithing() === true && opened === 'smithing';
  o.slots = H.smithAt(27, 47) === 0 && H.smithAt(76, 47) === 1 && H.smithAt(134, 47) === 2 && H.smithAt(8, 84) === 3 && H.smithAt(8, 142) === 30 && H.smithAt(0, 0) === -1;
  H.smithOrigin = { x: 100, y: 100, s: 2 };
  calls.length = 0; H.smithingClick(100 + 134 * 2, 100 + 47 * 2, 0, true); o.shift = calls.length === 1 && calls[0][0] === 2 && calls[0][1] === 1;
  calls.length = 0; H.smithingClick(100 + 27 * 2, 100 + 47 * 2, 0, false); o.pick = calls.length === 1 && calls[0][0] === 0 && calls[0][1] === 0;
  calls.length = 0; H.smithingClick(0, 0, 0, false); o.out = calls.length === 1 && calls[0][0] === -999;
  o.title = /Upgrade Gear', ox \+ 60 \* s, oy \+ 18 \* s/.test(h);
  o.reach = /H\.screen === 'smithing'\) H\.drawSmithing\(c\)/.test(h) && /H\.screen === 'smithing'\) \{\n\s+H\.smithingClick/.test(h);
  o.drop = /H\.screen === 'smithing' && H\.smithMenu\) \{[\s\S]*?sgi < 2/.test(h);
  o.esc = /H\.screen === 'smithing' \|\| H\.screen === 'beacon' \|\| H\.screen === 'loom'/.test(mn);
  return o;
}
const base = trial(); for (const [k, v] of Object.entries(base)) ok(v, 'baseline ' + k);
const BR = [
  ['in0', 'if (i === 0) return [27, 47];', 'if (i === 0) return [27, 48];', ['slots']],
  ['in1', 'if (i === 1) return [76, 47];', 'if (i === 1) return [60, 47];', ['slots']],
  ['res', 'if (i === 2) return [134, 47];', 'if (i === 2) return [143, 47];', ['slots']],
  ['hotbar', 'return [8 + (i - 30) * 18, 142];\n  }\n  function smithAt', 'return [8 + (i - 29) * 18, 142];\n  }\n  function smithAt', ['slots']],
  ['open', "H.open('smithing');", "H.open('anvil');", ['open']],
  ['shift', 'else if (shift) M.doClick(m, slot, 0, M.QUICK_MOVE, P);\n    else M.doClick(m, slot, b, M.PICKUP, P);\n    m.refresh();\n    if (P && P.syncHotbar) P.syncHotbar();\n    return true;\n  };\n\n  // --- the dispenser', 'else M.doClick(m, slot, b, M.PICKUP, P);\n    m.refresh();\n    if (P && P.syncHotbar) P.syncHotbar();\n    return true;\n  };\n\n  // --- the dispenser', ['shift']],
  ['title', "'Upgrade Gear', ox + 60 * s", "'Upgrade Gear', ox + 8 * s", ['title']],
  ['undispatched', "H.screen === 'smithing') H.drawSmithing(c)", "H.screen === 'smithing') 0", ['reach']],
  ['nodrop', "sgi < 2", "sgi < 0", ['drop']],
  ['esc', "H.screen === 'smithing' || H.screen === 'beacon' || H.screen === 'loom'", "H.screen === 'beacon' || H.screen === 'loom'", ['esc'], 'main'],
];
for (const [key, a, b, expect, which] of BR) {
  breaks++; let hit = false, X;
  const p = (s) => { const j = s.indexOf(a); if (j >= 0) { hit = true; return s.slice(0, j) + b + s.slice(j + a.length); } return s; };
  try { X = which === 'main' ? trial(null, p) : trial(p); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key + ' ' + JSON.stringify(X));
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(`smithingscreen11725check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
