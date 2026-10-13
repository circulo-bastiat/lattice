#!/usr/bin/env node
// dolphincheck.mjs — #718: DolphinEntity moistness/dry-out/land hop, 4800 air, drowning
// (.decomp passive/DolphinEntity.java:240-262, getMaxAir 192, canBreatheInWater false 90).
import { loadEngine } from './loadsrc.mjs';

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
console.log('dolphincheck — #718: dolphin air 4800 / moistness 2400 / DRYOUT / land hop');

function run(patch) {
  const M = loadEngine({ extra: ['07zq_snowgolem.js', '07zz2_dolphin.js'], dom: false, initReg: false, patch });
  const D = M.Dolphin;
  const hits = [];
  M.Combat = { hurt: (e, a, x, y, o) => { hits.push([a, o && o.source]); } };
  const out = {};
  const e = { air: undefined, moistness: undefined };
  D.spawnInit(e);
  out.init = e.air === 4800 && e.moistness === 2400 && e.pitch === 0;
  // wet: moistness stays 2400, no hop
  e.inWater = true; e.moistness = 100; D.tickMoist(e, () => 0.5);
  out.wet = e.moistness === 2400;
  // dry on ground: -1, hop
  e.inWater = false; e.onGround = true; e.vx = e.vy = e.vz = 0;
  D.tickMoist(e, () => 1);
  out.dry = e.moistness === 2399 && !e.onGround && e.vy === 0.5 && Math.abs(e.vx - 0.2) < 1e-9 && hits.length === 0;
  // dry-out at 0
  e.moistness = 1; e.onGround = false; D.tickMoist(e, () => 0.5);
  out.dryout = e.moistness === 0 && hits.length === 1 && hits[0][0] === 1 && hits[0][1] === 'dryout';
  // drown on 4800 scale: 4800 ticks to reach 0 boundary, hit at -20
  const f = { air: 4800, eyeInWater: true };
  let t = 0; hits.length = 0;
  while (!hits.length && t < 6000) { D.tickAir(f); t++; }
  out.drown = t === 4820 && hits[0][0] === 2 && f.air === 0;
  // #4025: Water Breathing stops the drowning (LivingEntity.baseTick hasWaterBreathing)
  M.Effects = { hasWaterBreathing: () => true };
  const w = { air: 4800, eyeInWater: true }; hits.length = 0;
  for (let i = 0; i < 6000; i++) D.tickAir(w);
  out.wbreath = hits.length === 0 && w.air === 4800;
  M.Effects = undefined;
  const g = { air: 100, eyeInWater: false }; D.tickAir(g);
  out.refill = g.air === 4800;
  // vanilla: a bubble column at the eye does not drain air
  const bc = { air: 4800, eyeInWater: true, eyeInBubble: true }; D.tickAir(bc);
  out.bubbleair = bc.air === 4800;
  // NoAI: frozen, air refilled, no dry-out
  hits.length = 0;
  const n = { air: 10, moistness: 5, inWater: false, onGround: true, aiDisabled: true };
  D.tick(n);
  out.noai = n.air === 4800 && n.moistness === 5 && n.onGround && hits.length === 0;
  // bubble column above water: stays wet
  M.World = { getBlock: () => 1 }; M.States = { block: [0, 7] }; M.Reg = { id: { bubble_column: 7 } };
  const b = { moistness: 5, x: 0, y: 0, z: 0 };
  D.tickMoist(b, () => 0.5);
  out.bubble = b.moistness === 2400;
  return out;
}

const base = run(null);
for (const k of Object.keys(base)) ok(base[k], 'dolphin ' + k);

let caught = 0;
const brk = (from, to) => (f, s) => f === '07zz2_dolphin.js' ? s.replace(from, to) : s;
const breaks = [
  ['Dol.MAX_AIR = 4800', 'Dol.MAX_AIR = 300', 'init'],
  ['if (isWet(e)) { e.moistness = Dol.MAX_MOISTNESS; return; }', 'if (isWet(e)) { return; }', 'wet'],
  ['e.vy = (e.vy || 0) + 0.5;', 'e.vy = (e.vy || 0);', 'dry'],
  ["{ source: 'dryout' }", "{ source: 'x' }", 'dryout'],
  ['if (e.aiDisabled || e.noAI) {', 'if (false) {', 'noai'],
  ['NS.SnowGolem && NS.SnowGolem.isWet', 'false', 'bubble'],
  ['if (e.eyeInWater &&', 'if (false &&', 'drown'],
  ['NS.Effects.hasWaterBreathing(e)', 'false', 'wbreath'],
  ['!e.eyeInBubble &&', '', 'bubbleair'],
  ['e.air = Dol.MAX_AIR;\n    }\n  };', 'e.air = e.air;\n    }\n  };', 'refill']
];
for (const [a, b, key] of breaks) {
  const r = run(brk(a, b));
  if (!r[key]) { caught++; console.log('  ✓ break caught: ' + key); } else fails.push('break not caught: ' + key);
}
ok(caught === breaks.length, 'all breaks caught');
console.log(`  ${caught} breaks caught`);
console.log(`dolphincheck: ${pass} checks passed, ${fails.length} failures (${caught} anti-vacuity)`);
for (const f of fails) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
