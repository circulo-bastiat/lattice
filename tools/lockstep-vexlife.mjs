#!/usr/bin/env node
// lockstep-vexlife -- #6860 (G17-L159): lockstep scenario 'vexlife', 20 salts. An evoker casts SummonVexGoal (EvokerEntity.java): three vexes at
// blockPos + (-2+nextInt(5), 1, -2+nextInt(5)), owner = evoker, bound = that pos, lifeTicks = 20*(30+nextInt(90)); the engine's real SP.castSummonVex
// and Fl.tickVexLife run 1100 ticks and are compared per tick with VexEntity.tick (.decomp:69-77): alive && --lifeTicks <= 0 -> lifeTicks = 20,
// damage(STARVE, 1.0) (bypasses armor), so one damage per 20 ticks from expiry on; a vex with 1 hp... health is tracked here as 14 - hits.
import { loadEngine } from './loadsrc.mjs';

const SALTS = 20, TICKS = 1100;
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };

function engine(salt, patch) {
  const M = loadEngine({ patch, extra: ['07k_goals.js', '07t_fly.js', '07v_spell.js'], dom: false });
  const r = stream(salt), evoker = { type: 'evoker', x: 10.3, y: 64, z: -4.7 }, vexes = [];
  M.Spell.castSummonVex(evoker, { random: r, spawnFn: (type, x, y, z) => { const v = { type, x, y, z, hp: 14, hits: [] }; vexes.push(v); return v; } });
  const rows = [], ctx = (v) => ({ hurt: (e, amt, o) => { e.hp -= amt; e.hits.push(amt + (o.bypassArmor ? 'b' : '')); } });
  for (let t = 0; t < TICKS; t++) {
    vexes.forEach((v) => { M.Fly.tickVexLife(v, ctx(v)); });
    rows.push(vexes.map((v) => [v.x, v.y, v.z, v.owner === evoker, JSON.stringify(v.bounds), v.vexAlive, v.vexLifeTicks, v.hp].join(',')).join('|'));
  }
  return rows;
}

function reference(salt) {
  const r = stream(salt), ni = (n) => Math.floor(r() * n), evoker = { x: 10.3, y: 64, z: -4.7 }, vs = [];
  for (let i = 0; i < 3; i++) {
    const bx = Math.floor(evoker.x) + (-2 + ni(5)), by = Math.floor(evoker.y) + 1, bz = Math.floor(evoker.z) + (-2 + ni(5));
    vs.push({ x: bx + 0.5, y: by, z: bz + 0.5, b: { x: bx, y: by, z: bz }, life: 20 * (30 + ni(90)), hp: 14 });
  }
  const rows = [];
  for (let t = 0; t < TICKS; t++) {
    vs.forEach((v) => { if (--v.life <= 0) { v.life = 20; v.hp -= 1; } });
    rows.push(vs.map((v) => [v.x, v.y, v.z, true, JSON.stringify(v.b), true, v.life, v.hp].join(',')).join('|'));
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
const breaks = [
  ['lifetime 20*(30+nextInt(90)) -> 20*(30+nextInt(91))', (f, s) => f === '07v_spell.js' ? s.replace('rand() * 90', 'rand() * 91') : s],
  ['expiry reset 20 -> 40', (f, s) => f === '07t_fly.js' ? s.replace('e.vexLifeTicks = 20;', 'e.vexLifeTicks = 40;') : s],
  ['countdown <= 0 -> < 0', (f, s) => f === '07t_fly.js' ? s.replace('e.vexLifeTicks <= 0', 'e.vexLifeTicks < 0') : s],
];
for (const [name, p] of breaks) {
  const x = run(p);
  if (x.bad > 0) caught++; else { ok = false; console.log('NOT CAUGHT: ' + name); }
}
console.log(`vexlife: ${caught} breaks caught, ${base.bad} divergences${base.first ? " " + base.first : ""}`);
process.exit(ok && caught === breaks.length ? 0 : 1);
