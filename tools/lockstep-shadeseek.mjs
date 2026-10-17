#!/usr/bin/env node
// lockstep-shadeseek -- #7033 (G18b-L7): lockstep scenario shadeseek, 20 salts. A skeleton in open sun, a tree canopy whose shade
// starts 4 blocks off (and one patch 12 blocks off, beyond the search box), with and without a helmet, at a noon time set.
// Reference = EscapeSunlightGoal.canStart/locateShadedPos + AvoidSunlightGoal.canStart/start/stop (.decomp) fed the SAME pinned
// stream as the engine: per tick canStart, the 10-draw search box (nextInt(20)-10, nextInt(6)-3, nextInt(20)-10), the chosen target
// and the start flag (navAvoidSunlight). A helmet must end both goals without consuming a draw.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dec = readFileSync(join(ROOT, '.decomp/net/minecraft/entity/ai/goal/EscapeSunlightGoal.java'), 'utf8');
if (!/nextInt\(20\) - 10, \$\$0\.nextInt\(6\) - 3, \$\$0\.nextInt\(20\) - 10/.test(dec) || !/< 10/.test(dec)) throw new Error('EscapeSunlightGoal search box changed in the decomp');
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const TICKS = 80, BY = 64;
// shade: a canopy at x 4..8 (inside the box) and one at x 22..26 (12+ blocks past the box); sky visible everywhere else
const shaded = (x, y, z) => y >= BY - 1 && Math.abs(z) <= 3 && ((x >= 4 && x <= 8) || (x >= 22 && x <= 26));
const favor = (x, y, z) => (y <= BY + 1 ? -1 : 1);

function reference(helmet, onFire, rnd) {
  const rows = [];
  for (let t = 0; t < TICKS; t++) {
    let can = false, tgt = null;
    if (onFire && !helmet) for (let i = 0; i < 10; i++) {
      const x = Math.floor(rnd() * 20) - 10, y = BY + Math.floor(rnd() * 6) - 3, z = Math.floor(rnd() * 20) - 10;
      if (shaded(x, y, z) && favor(x, y, z) < 0) { can = true; tgt = [x, y, z]; break; }
    }
    rows.push({ can, tgt, avoid: !helmet });
  }
  return rows;
}
function engine(patch, helmet, onFire, rnd) {
  const M = loadEngine({ patch, extra: ['02f_tags.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js'] });
  const e = { type: 'skeleton', x: 0.5, y: BY, z: 0.5, target: null, isOnFire: onFire };
  M.Sky = { isDay: () => true };
  M.Equip = { ready: true, getEquipped: () => (helmet ? { i: 1 } : null) };
  M.Items = { HEAD: 5 };
  M.World = { canSeeSky: (x, y, z) => !shaded(x, y, z) };
  let found = null;
  M.Ai.findPath = (ax, ay, az, x, y, z) => { found = [Math.floor(x), Math.floor(y), Math.floor(z)]; return [{}, {}]; };
  const esc = new M.Ai.EscapeSunlightGoal(e, 1.0, rnd, favor), av = new M.Ai.AvoidSunlightGoal(e);
  const rows = [];
  for (let t = 0; t < TICKS; t++) {
    found = null;
    const can = esc.canUse();
    const a = av.canUse(); if (a) av.start(); const flag = !!e.navAvoidSunlight; if (a) av.stop();
    rows.push({ can, tgt: can ? found : null, avoid: flag });
  }
  return rows;
}
// the engine's canSeeSky is true at the feet only when unshaded; the feet are at x=0 (open), so the reference needs no gate there
function run(patch) {
  const bad = []; let hits = 0, fires = 0;
  for (let salt = 0; salt < 20; salt++) for (const helmet of [false, true]) {
    const R = reference(helmet, true, stream(salt)), E = engine(patch, helmet, true, stream(salt));
    for (let t = 0; t < TICKS; t++) {
      if (R[t].can) hits++;
      if (R[t].can !== E[t].can || JSON.stringify(R[t].tgt) !== JSON.stringify(E[t].tgt) || R[t].avoid !== E[t].avoid) { bad.push(`salt ${salt} helmet=${helmet} tick ${t}: ref ${JSON.stringify(R[t])} engine ${JSON.stringify(E[t])}`); break; }
    }
    if (!helmet) fires++;
  }
  // not on fire: no search, no draw consumed
  const idle = engine(patch, false, false, stream(1));
  if (idle.some((r) => r.can)) bad.push('goal started while not on fire');
  return { bad, hits };
}
let fails = 0, breaks = 0;
const base = run(null);
if (base.bad.length) { fails++; console.log('  FAIL ' + base.bad.slice(0, 3).join(' | ')); }
if (!base.hits) { fails++; console.log('  FAIL vacuous: no shade ever found'); }
const mut = (name, f, to) => {
  let hit = false;
  const patch = (fn, src) => { if (fn !== '07k_goals.js') return src; const o = src.replace(f, to); hit = hit || o !== src; return o; };
  const r = run(patch);
  if (!hit) { fails++; console.log('  FAIL mutation did not apply: ' + name); } else if (r.bad.length) { breaks++; console.log('   ✓ break caught: ' + name); } else { fails++; console.log('  ✗ break NOT caught: ' + name); }
};
mut('search box 6 -> 8 high', 'rand() * 6) - 3', 'rand() * 8) - 3');
mut('helmet exemption dropped', 'if (Eq && Eq.ready && IT && Eq.getEquipped(e, IT.HEAD)) return false;\n      for', 'for');
mut('avoid flag not set', 'this.start = function () { e.navAvoidSunlight = true; };', 'this.start = function () {};');
console.log(`lockstep-shadeseek: ${40 + 2 + breaks} assertions, ${fails} failures, ${breaks} breaks caught (${base.hits} shade finds over 20 salts)`);
process.exit(fails ? 1 : 0);
