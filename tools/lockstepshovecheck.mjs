#!/usr/bin/env node
// lockstepshovecheck.mjs -- #6719 (G17-L123): lockstep scenario 'shove': 6 mobs (zombies, cows) and a player body packed into a 2x2 pen, then
// integrated freely for 40 ticks. 20 seeds place them and mark some sleeping / with a passenger / noClip / spectator. Per tick, per entity, the velocity
// is compared with an independent transcription of Entity.pushAwayFrom (.decomp Entity.java:1269-1295): d = absMax(dx,dz), skip < (float)0.01,
// d = sqrt(d), dx/=d, scale min(1,1/d), x (float)0.05, a side with passengers keeps its velocity; sleepers, spectators and noClip are never pushed.
import { loadEngine } from './loadsrc.mjs';

const SEEDS = 20, TICKS = 40, F = Math.fround;
const rng = (s) => () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);

function scen(seed) {
  const r = rng(seed * 7919 + 1), mk = (type, i) => ({
    type, x: r() * 1.6, y: 5, z: r() * 1.6, vx: 0, vy: 0, vz: 0, width: type === 'cow' ? 0.9 : 0.6, height: type === 'cow' ? 1.4 : 1.95, maxHealth: 20,
  });
  const mobs = []; for (let i = 0; i < 6; i++) mobs.push(mk(i % 2 ? 'cow' : 'zombie', i));
  const P = mk('player', 0); P.width = 0.6; P.height = 1.8;
  mobs[seed % 6].sleeping = seed % 3 === 0;
  if (seed % 4 === 0) mobs[(seed + 1) % 6].passenger = {};
  if (seed % 5 === 0) mobs[(seed + 2) % 6].noclip = true;
  if (seed % 7 === 0) mobs[(seed + 3) % 6].spectator = true;
  return { mobs, P };
}
const clone = (s) => ({ mobs: s.mobs.map((m) => ({ ...m })), P: { ...s.P } });
const overlap = (a, b) => Math.abs(a.x - b.x) < (a.width + b.width) / 2 && Math.abs(a.z - b.z) < (a.width + b.width) / 2 && a.y < b.y + b.height && b.y < a.y + a.height;
const snap = (s) => [...s.mobs, s.P].map((e) => e.vx + ',' + e.vz).join('|');
const step = (s) => { for (const e of [...s.mobs, s.P]) { e.x += e.vx; e.z += e.vz; } };

function oracle(s, o = {}) {
  const rows = [], all = [...s.mobs, s.P], SC = F(o.scale || 0.05), MIN = F(0.01);
  for (let t = 0; t < TICKS; t++) {
    for (const e of all) {
      if (e.spectator) continue;
      for (const q of all) {
        if (q === e || q.spectator || !overlap(e, q) || q.sleeping || e.sleeping || q.noclip || e.noclip) continue;
        let dx = q.x - e.x, dz = q.z - e.z, d = Math.max(Math.abs(dx), Math.abs(dz));
        if (d < MIN) continue;
        d = Math.sqrt(d); dx /= d; dz /= d;
        const k = Math.min(1, 1 / d); dx *= k; dz *= k; dx *= SC; dz *= SC;
        if (!e.passenger) { e.vx -= dx; e.vz -= dz; }
        if (!q.passenger) { q.vx += dx; q.vz += dz; }
      }
    }
    rows.push(snap(s)); step(s);
  }
  return rows;
}
function engine(s, patch) {
  const M = loadEngine({ patch, extra: ['02f_tags.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '14j_combat.js'] });
  const EL = M.EntityList, rows = [];
  EL.list = s.mobs; EL.pushPlayer = () => s.P; EL.random = () => 0.5; M.Combat = M.Combat || {}; M.Combat.hurt = () => {};
  for (let t = 0; t < TICKS; t++) {
    for (const e of s.mobs) if (!e.spectator) EL.pushAround(e);
    EL.pushAround(s.P);   // the player body runs its own pushEntities, after the mobs
    rows.push(snap(s)); step(s);
  }
  return rows;
}
function run(o = {}) {
  let bad = 0, first = '';
  for (let seed = 1; seed <= SEEDS; seed++) {
    const a = engine(clone(scen(seed)), o.patch), b = oracle(clone(scen(seed)), o);
    for (let i = 0; i < TICKS; i++) if (a[i] !== b[i]) { bad++; if (!first) first = `seed ${seed} tick ${i}: engine ${a[i]} oracle ${b[i]}`; break; }
  }
  return { bad, first };
}
let fails = 0, breaks = 0; const notes = [];
const base = run();
if (base.bad) { fails++; console.log(`  FAIL ${base.bad} divergences; first: ${base.first}`); }
const moved = oracle(clone(scen(1)))[TICKS - 1].split('|').filter((v) => v !== '0,0').length;
if (moved < 4) { fails++; console.log('  FAIL vacuous: nothing moved'); }
const brk = [
  ['scale 0.05->0.06', { scale: 0.06 }],
  ['engine scale 0.06', { patch: (f, s) => f === '14b_physics.js' ? s.replace('0.05000000074505806;', '0.06;') : s }],
  ['engine min 0.01->0.5', { patch: (f, s) => f === '14b_physics.js' ? s.replace('0.009999999776482582;', '0.5;') : s }],
  ['engine sleeping rule', { patch: (f, s) => f === '07i_entitylist.js' ? s.replace('if (q.sleeping || e.sleeping) continue;', '') : s }],
];
for (const [name, o] of brk) {
  const d = run(o);
  if (d.bad) { breaks++; notes.push(`   ✓ ${name} caught: ${d.first}`); } else { fails++; console.log(`  FAIL ${name} not caught`); }
}
console.log(`${brk.length + 2 - fails} assertions, ${fails} failures, ${breaks} breaks caught (${SEEDS} seeds, ${base.bad} divergences)`);
notes.forEach((n) => console.log(n));
process.exit(fails ? 1 : 0);
