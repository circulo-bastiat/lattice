#!/usr/bin/env node
// lockstep-foxpounce -- #6899 (G17-L182): lockstep scenario 'foxpounce', 20 salts. A fox crouches (15 ticks to fully crouched), then
// FoxEntity.JumpChasingGoal (.decomp 1087-1183) starts: velocity += normalize(target - fox) * (0.8, 0.9, 0.8) (NOT the 0.2/0.6 of the issue text;
// the decomp is the truth), jumping/chasing set, then tick(): pitch from velocity, attack at distance <= 2, continue-while rule. The engine's real
// Fx.JumpChasingGoal and Fx.mobTick crouch counter run 1600 ticks against a hand reference of the Java, per-tick pos/vel/pitch/flags compared.
import { loadEngine } from './loadsrc.mjs';

const SALTS = 20, TICKS = 1600;
const stream = (salt) => { let s = (salt * 2654435761 + 777) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const num = (v) => Math.fround(v).toFixed(5);

// shared scripted world: gravity, ground at y=64, drag; same for both sides
function physics(e) {
  e.vy = (e.vy - 0.08) * 0.98; e.vx *= e.onGround ? 0.6 : 0.91; e.vz *= e.onGround ? 0.6 : 0.91;
  e.x += e.vx; e.y += e.vy; e.z += e.vz;
  if (e.y <= 64) { e.y = 64; e.vy = 0; e.onGround = true; } else e.onGround = false;
}
const row = (e, hits) => [num(e.x), num(e.y), num(e.z), num(e.vx), num(e.vy), num(e.vz), num(e.pitch), e.jumping, e.chasing, e.crouching, e.rollingHead, e.walking, e.crouchTicks | 0, hits].join(',');

function scenario(salt) {
  const r = stream(salt), name = r() < 0.5 ? 'fox' : 'snow_fox';
  return { name, x: r() * 6, z: r() * 6, tx: 4 + r() * 8, tz: -4 + r() * 8, crouchAt: 20 + Math.floor(r() * 400), period: 60 + Math.floor(r() * 120) };
}

function engine(salt, patch) {
  const M = loadEngine({ patch, extra: ['07k_goals.js', '07zj_fox.js'], dom: false });
  M.Combat = { mobAttack: () => { hits++; } };
  let hits = 0;
  const sc = scenario(salt), t = { type: 'chicken', x: sc.tx, y: 64, z: sc.tz }, e = { type: sc.name, x: sc.x, y: 64, z: sc.z, vx: 0, vy: 0, vz: 0, pitch: 0, onGround: true, target: t, walking: false };
  const g = new M.Fox.JumpChasingGoal(e, { isReplaceable: () => true, isInSnow: () => false }), rows = []; let active = false;
  for (let k = 0; k < TICKS; k++) {
    if (k % sc.period === sc.crouchAt % sc.period && !active) { e.crouching = true; e.rollingHead = true; }
    M.Fox.mobTick(e, () => 0.5);
    if (!active && g.canUse()) { active = true; g.start(); }
    else if (active) { g.tick(); if (!g.canContinueToUse()) { g.stop(); active = false; } }
    physics(e);
    rows.push(row(e, hits));
  }
  return rows;
}

function reference(salt) {
  const sc = scenario(salt), t = { x: sc.tx, y: 64, z: sc.tz }, e = { x: sc.x, y: 64, z: sc.z, vx: 0, vy: 0, vz: 0, pitch: 0, onGround: true, jumping: undefined, chasing: undefined, crouching: undefined, rollingHead: undefined, walking: false, crouchTicks: 0 };
  let hits = 0, active = false; const rows = [];
  for (let k = 0; k < TICKS; k++) {
    if (k % sc.period === sc.crouchAt % sc.period && !active) { e.crouching = true; e.rollingHead = true; }
    e.crouchTicks = e.crouching ? Math.min(15, e.crouchTicks + 1) : 0;
    if (!active && e.crouchTicks >= 15) {
      active = true; e.jumping = true; e.chasing = true; e.rollingHead = false;
      const dx = t.x - e.x, dy = t.y - e.y, dz = t.z - e.z, l = Math.sqrt(dx * dx + dy * dy + dz * dz);
      e.vx += dx / l * 0.8; e.vy += 0.9; e.vz += dz / l * 0.8;
    } else if (active) {
      if (!e.walking) {
        const h = Math.sqrt(e.vx * e.vx + e.vz * e.vz), len = Math.sqrt(e.vx * e.vx + e.vy * e.vy + e.vz * e.vz);
        if (e.vy * e.vy < 0.03 && e.pitch !== 0) e.pitch = e.pitch + (0 - e.pitch) * 0.2;
        else e.pitch = len > 0 ? Math.sign(-e.vy) * Math.acos(Math.min(1, h / len)) * 180 / Math.PI : 0;
      }
      if (Math.hypot(t.x - e.x, t.y - e.y, t.z - e.z) <= 2) hits++;
      const c = (!(e.vy * e.vy < 0.05) || !(Math.abs(e.pitch) < 15) || !e.onGround) && !e.walking;
      if (!c) { e.crouching = false; e.rollingHead = false; e.chasing = false; active = false; }
    }
    physics(e);
    rows.push(row(e, hits));
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
  ['pounce velocity y 0.9 -> 1.0', (f, s) => f === '07zj_fox.js' ? s.replace('(e.vy || 0) + 0.9', '(e.vy || 0) + 1.0') : s],
  ['pounce forward 0.8 -> 0.6', (f, s) => f === '07zj_fox.js' ? s.replace('dx / l * 0.8', 'dx / l * 0.6') : s],
  ['fully crouched 15 -> 14 ticks', (f, s) => f === '07zj_fox.js' ? s.replace('(e.crouchTicks | 0) >= 15', '(e.crouchTicks | 0) >= 14') : s],
];
for (const [name, p] of breaks) {
  const x = run(p);
  if (x.bad > 0) caught++; else { ok = false; console.log('NOT CAUGHT: ' + name); }
}
console.log(`foxpounce: ${caught} breaks caught, ${base.bad} divergences${base.first ? " " + base.first : ""}`);
process.exit(ok && caught === breaks.length ? 0 : 1);
