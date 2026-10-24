#!/usr/bin/env node
// underwaterwirecheck.mjs — #9241: static wiring of the underwater overlay draw (the browser stage underwaterdrawcheck is skipped by --fast).
import fs from 'node:fs';
console.log('underwaterwirecheck — overlay draw wiring');
const hud = fs.readFileSync('src/15_hud.js', 'utf8');
const rules = [
  ['draw fn exists', (s) => /H\.drawUnderwaterOverlay = function/.test(s)],
  ['spectator draws nothing', (s) => /H\.spectatorHud\(\)\) return true/.test(s)],
  ['uses the packed sheet', (s) => /Gui\.sheets\.underwater/.test(s)],
  ['uses the quad', (s) => /H\.underwaterOverlayQuad\(P\.yaw/.test(s)],
  ['alpha applied', (s) => /globalAlpha = q\.rgba\[3\]/.test(s)],
  ['called only when eye in water', (s) => /!P\.inLava && P\.eyeInWater && H\.drawUnderwaterOverlay\(c\)/.test(s)],
  ['blits the tinted tile', (s) => /c\.drawImage\(t, 0, 0/.test(s)],
];
let bad = 0, caught = 0;
for (const [n, f] of rules) {
  if (!f(hud)) { console.log('FAIL ' + n); bad++; }
  const broken = hud.replace(/drawUnderwaterOverlay|spectatorHud\(\)\) return true|Gui\.sheets\.underwater|underwaterOverlayQuad\(P\.yaw|globalAlpha = q|P\.eyeInWater &&|c\.drawImage\(t, 0, 0/g, 'ZZ');
  if (!f(broken)) caught++;
}
console.log(bad ? 'FAIL' : rules.length + ' assertions, ' + bad + ' failed, ' + (caught === rules.length ? caught + ' breaks caught' : 'VACUOUS ' + caught));
process.exit(bad || caught !== rules.length ? 1 : 0);
