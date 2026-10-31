#!/usr/bin/env node
// airbubblecheck.mjs — #361 (G11): the air row of H.drawSurvival. Vanilla InGameHud.renderStatusBars
// (.decomp, air block): `if (player.isSubmergedIn(WATER) || air < maxAir)`, air = min(getAir(), maxAir);
// full = ceil((air-2)*10/max), popping = ceil(air*10/max) - full.
import { loadEngine } from './loadsrc.mjs';

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
console.log('airbubblecheck — #361: air bubbles show when submerged OR air < max');

function bubblesFor(patch, eye, air) {
  const M = loadEngine({ extra: ['15_hud.js'], dom: false, initReg: false, patch });
  const H = M.Hud;
  let n = 0;
  M.Gui = { ready: true, HUD: { barW: 182, rowY: -39, xpY: -29, hungerX: (i) => i * 8, armourDY: -10, count: 0 },
    ICON: new Proxy({}, { get: (_, k) => k }),
    blit: (c, name, r) => { if (r === 'bubbleFull' || r === 'bubblePop') n++; },
    blitPart() {}, text() {}, textWidth: () => 0 };
  M.Player = { health: 20, food: 20, air, eyeInWater: eye };
  M.Survival = {};
  H.w = 800; H.h = 600; H.scale = 2;
  try { H.drawSurvival({ fillStyle: '', fillRect() {} }); } catch (e) { return 'ERR ' + e.message; }
  return n;
}

const cases = [[true, 300, 10], [false, 150, 5], [false, 300, 0], [true, 150, 5], [true, 0, 0]];
for (const [eye, air, want] of cases) {
  const got = bubblesFor(null, eye, air);
  ok(got === want, `eye=${eye} air=${air}: ${want} bubbles, got ${got}`);
}
// anti-vacuity: restore the old AND
let caught = 0;
const brk = (f, s) => f === '15_hud.js' ? s.replace('(P.eyeInWater || P.air < 300)', '(P.air < 300 && P.eyeInWater)') : s;
if (bubblesFor(brk, true, 300) !== 10) caught++;
if (bubblesFor(brk, false, 150) !== 5) caught++;
ok(caught === 2, 'the restored AND is caught twice');
for (let i = 0; i < caught; i++) console.log(`  ✓ anti-vacuity break ${i + 1} caught`);
console.log(`airbubblecheck: ${pass} checks passed, ${fails.length} failures (${caught} anti-vacuity)`);
for (const f of fails) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
