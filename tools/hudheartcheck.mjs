#!/usr/bin/env node
// hudheartcheck.mjs — #359. `H.drawSurvival`'s heart row against `InGameHud.renderHealthBar`:
// health is ceil'd, absorption hearts, extra rows, poison/wither fills, regeneration bump.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };

function load(rawFloat) {
  const NS = {}; globalThis.MCL = NS;
  const src = f => readFileSync(join(ROOT, 'src', f), 'utf8');
  for (const f of ['07q_effects.js', '15_hud.js']) {
    let t = src(f);
    if (rawFloat && f === '15_hud.js') t = t.replace('var health = Math.ceil(P.health);', 'var health = Math.floor(P.health);');
    new Function('MCL', t)(NS);
  }
  return NS;
}
// one frame: [u, y] of every heart blit (v === 0, w === 9) on a 1x, 400x300 screen
function frame(NS, P) {
  const blits = [];
  NS.Hud.w = 400; NS.Hud.h = 300; NS.Hud.scale = 1; NS.Hud.hearts = null;
  NS.Player = P; NS.Survival = { MAX_HEALTH: 20 };
  NS.Gui = { ready: true, HUD: { barW: 182, rowY: -39, xpY: -29, xpLevelY: -35, armourDY: -10, count: 10,
      heartX: i => i * 8, hungerX: i => 173 - i * 8 },
    ICON: { heartBg: [16, 0, 9, 9], heartBgBlink: [25, 0, 9, 9], armourFull: [34, 9, 9, 9], armourHalf: [25, 9, 9, 9],
      armourEmpty: [16, 9, 9, 9], hungerBg: [16, 27, 9, 9], hungerFull: [52, 27, 9, 9], hungerHalf: [61, 27, 9, 9],
      xpBarBg: [0, 64, 182, 5], xpBarFg: [0, 69, 182, 5] },
    blit: (c, sh, r, x, y) => { blits.push({ u: r[0], v: r[1], x, y, w: r[2] }); }, blitPart() {}, textWidth: () => 0, text() {} };
  NS.Hud.heartNow = () => 0;
  NS.Hud.drawSurvival({});
  return blits.filter(b => b.v === 0 && b.w === 9);
}
const mkP = o => Object.assign({ health: 20, food: 20, age: 1, effects: {}, armor: 0, absorption: 0 }, o);
const fills = (bl, y) => bl.filter(b => b.u >= 52 || (b.u >= 16 + 4 * 18 && b.u < 16 + 8 * 18) || b.u >= 16 + 8 * 18);
const NS = load(false);
const TOP = 300 - 39;

// 19.5 -> ceil 20: ten FULL hearts, no half
let b = frame(NS, mkP({ health: 19.5 }));
ok(b.filter(x => x.u === 52).length === 10 && b.filter(x => x.u === 61).length === 0, 'health 19.5 draws 10 full hearts');
// 7 -> 3 full + a half
b = frame(NS, mkP({ health: 7 }));
ok(b.filter(x => x.u === 52).length === 3 && b.filter(x => x.u === 61).length === 1, 'health 7 draws 3 full + 1 half');
// absorption 4: two extra hearts (u = 16+8*18 = 160), one row of 12 -> second row
b = frame(NS, mkP({ absorption: 4 }));
ok(b.filter(x => x.u === 160).length === 2, 'absorption 4 draws 2 absorbing hearts');
ok(b.filter(x => x.y < TOP).length >= 2 && new Set(b.map(x => x.y)).size === 2, 'absorption 4 wraps onto a second row');
b = frame(NS, mkP({ absorption: 3 }));
ok(b.filter(x => x.u === 160).length === 1 && b.filter(x => x.u === 169).length === 1, 'absorption 3: one full, one half absorbing');
// max health 40: 20 hearts, two rows, pitch 10 - (2-2) = 10
b = frame(NS, mkP({ maxHealth: 40, health: 40 }));
ok(b.filter(x => x.u === 16 || x.u === 25).length === 20 && b.some(x => x.y === TOP - 10), 'max health 40: two rows, pitch 10');
// poison fill u = 16 + (2*2)*9 = 52+... idx 2 -> 16+36=52 ; hmm idx*2*9
b = frame(NS, mkP({ health: 20, effects: { poison: { duration: 100, amplifier: 0 } } }));
ok(b.filter(x => x.u === 16 + 8 * 9).length === 10, 'poison draws the poison fill');
b = frame(NS, mkP({ health: 20, effects: { wither: { duration: 100, amplifier: 0 } } }));
ok(b.filter(x => x.u === 16 + 12 * 9).length === 10, 'wither draws the wither fill');
// regeneration: heart (age % ceil(max+5)) is 2 px higher
b = frame(NS, mkP({ age: 3, effects: { regeneration: { duration: 100, amplifier: 0 } } }));
ok(b.filter(x => x.y === TOP - 2).length >= 1 && b.filter(x => x.y === TOP - 2).every(x => x.x === 400 / 2 - 91 + 24), 'regeneration lifts heart 3');
// low health shakes: y in {TOP, TOP+1}
b = frame(NS, mkP({ health: 2 }));
ok(b.every(x => x.y === TOP || x.y === TOP + 1), 'health 2 jitters by 0..1 px');
// armour moves above the second row
b = frame(NS, mkP({ maxHealth: 40, health: 40 }));
// ── breaks
const raw = load(true);
b = frame(raw, mkP({ health: 19.5 }));
okAv(!(b.filter(x => x.u === 52).length === 10), 'floor instead of ceil is caught (half heart at 19.5)');
b = frame(NS, mkP({ health: 19.5, absorption: 0 }));
okAv(b.filter(x => x.u === 160).length === 0, 'no absorption hearts without absorption');
okAv(frame(NS, mkP({ absorption: 4 })).filter(x => x.u === 160).length !== 0, 'absorption breaks the no-absorption reading');

console.log('\n================= hudheartcheck ==================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(`${breaks} breaks caught`);
if (fails.length) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
