#!/usr/bin/env node
// lockstep-wolfshake -- #6903 (G17-L186): lockstep scenario 'wolfshake', 20 salts. A wolf walks into water, out, stands in rain, then dries; the
// engine's NS.WolfShake.tick is compared per tick with WolfEntity.tickMovement/tick (.decomp:183-250): furWet, canShakeWaterOff, shakeProgress /
// lastShakeProgress (float32, +0.05 per tick, ends when last >= 2.0 = 41 ticks), shake sound at progress 0 (volume, pitch from two nextFloat),
// splash count (int(sin((p-0.4)*PI)*7)) with their random offsets, and the 200-tick idle tail afterwards.
import { loadEngine } from './loadsrc.mjs';

const SALTS = 20, TICKS = 600;
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const f = Math.fround;
// environment per tick: [inWater, rained]
function env(salt, t) {
  const a = 20 + (salt % 7) * 3, b = a + 30 + salt, c = b + 60, d = c + 25 + (salt % 5), g = d + 10;
  if (t >= a && t < b) return [true, false];
  if (t >= c && t < d) return [false, true];
  if (t >= g && t < g + 6 && salt % 2) return [true, false];
  return [false, false];
}

function engine(salt, patch) {
  const M = loadEngine({ patch, extra: ['07zq2_wolfshake.js'], dom: false });
  const r = stream(salt), log = [];
  const e = { x: 3.5, y: 64, z: -2.5, width: 0.6, onGround: true, navigating: false };
  M.Sound = { play: (n, o) => log.push('S' + n + ',' + o.volume + ',' + o.pitch + ',' + o.source) };
  M.Particles = { spawn: (n, x, y, z, vx, vy, vz) => log.push('P' + [n, x, y, z, vx, vy, vz].join(',')) };
  M.Sky = { isEntityRainedOn: (en) => en.rain };
  M.GameEvent = { emit: (n) => log.push('G' + n) };
  const rows = [];
  for (let t = 0; t < TICKS; t++) {
    const [w, rn] = env(salt, t); e.inWater = w; e.rain = rn; log.length = 0;
    M.WolfShake.tick(e, r);
    rows.push([e.furWet, e.canShakeWaterOff, e.shakeProgress, e.lastShakeProgress, log.join(';')].join('|'));
  }
  return rows;
}

function reference(salt) {
  const r = stream(salt), rows = [];
  let furWet = false, can = false, sp = 0, lsp = 0;
  for (let t = 0; t < TICKS; t++) {
    const [w, rn] = env(salt, t), log = [];
    if (furWet && !can) { can = true; sp = 0; lsp = 0; log.push('Gwolf_shaking'); }
    if (w || rn) { furWet = true; if (can) { can = false; sp = 0; lsp = 0; } }
    else if (can) {
      if (sp === 0) log.push('Sentity.wolf.shake,0.4,' + ((r() - r()) * 0.2 + 1) + ',neutral');
      lsp = sp; sp = f(sp + f(0.05));
      if (lsp >= 2.0) { furWet = false; can = false; lsp = 0; sp = 0; }
      if (sp > 0.4) {
        const n = Math.trunc(Math.sin(f(f(sp - f(0.4)) * f(Math.PI))) * 7);
        for (let i = 0; i < n; i++) log.push('P' + ['splash', 3.5 + (r() * 2 - 1) * 0.6 * 0.5, 64 + 0.8, -2.5 + (r() * 2 - 1) * 0.6 * 0.5, 0, 0, 0].join(','));
      }
    }
    rows.push([furWet, can, sp, lsp, log.join(';')].join('|'));
  }
  return rows;
}

function run(patch) {
  let bad = 0, first = '';
  for (let s = 1; s <= SALTS; s++) {
    const a = engine(s, patch), b = reference(s);
    for (let i = 0; i < TICKS; i++) if (a[i] !== b[i]) { bad++; if (!first) first = `salt ${s} tick ${i}: engine ${a[i]} ref ${b[i]}`; break; }
  }
  return { bad, first };
}

const base = run();
let ok = base.bad === 0, caught = 0;
const P = (a, b) => (n, s) => n === '07zq2_wolfshake.js' ? s.replace(a, b) : s;
const breaks = [
  ['shake duration 40 -> 30 ticks (END 2.0 -> 1.5)', P('WS.END = 2.0', 'WS.END = 1.5')],
  ['shake speed 0.05 -> 0.06', P('WS.SPEED = 0.05', 'WS.SPEED = 0.06')],
  ['splash count 7 -> 6', P('* 7)', '* 6)')],
  ['sound volume 0.4 -> 0.5', P('volume: 0.4', 'volume: 0.5')],
  ['rain no longer wets', P('(S && S.isEntityRainedOn && S.isEntityRainedOn(e))', 'false')],
];
for (const [name, p] of breaks) {
  const x = run(p);
  if (x.bad > 0) caught++; else { ok = false; console.log('NOT CAUGHT: ' + name); }
}
console.log(`wolfshake: ${caught} breaks caught, ${base.bad} divergences${base.first ? " " + base.first : ""}`);
process.exit(ok && caught === breaks.length ? 0 : 1);
