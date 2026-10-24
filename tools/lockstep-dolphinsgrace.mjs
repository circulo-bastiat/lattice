#!/usr/bin/env node
// lockstep-dolphinsgrace.mjs -- #8762 (G17-L232): lockstep scenario 'dolphinsgrace': a player (Depth Strider 0..3) and a zombie swim 60 ticks
// in open 12-deep water with and without Dolphin's Grace, 20 salts (yaw, start velocity). Per tick x,y,z,vx,vy,vz are compared with an
// independent transcription of LivingEntity.travel's water branch (.decomp): f = 0.8; depth strider (capped 3, halved off ground):
// f += (0.54600006 - f)*ds/3, a += (speed - a)*ds/3; DOLPHINS_GRACE sets f = 0.96; velocity * (f, 0.8, f); gravity/16 with the -0.003 settle.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SALTS = 20, TICKS = 60;
const rng = (s) => () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);

function boot(patch) {
  const NS = {}; globalThis.MCL = NS;
  for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js', '02_blocks.js', '02b_registry.js', '02c_states.js', '03_section.js',
    '05_mesher.js', '14b_physics.js', '07q_effects.js']) {
    let s = readFileSync(join(ROOT, 'src', f), 'utf8'); if (patch) { const t = patch(f, s); if (f === '14b_physics.js' && t === s) throw new Error('patch not found: no-op'); s = t; }
    new Function('MCL', s)(NS);
  }
  const A = join(ROOT, 'assets'), j = (n) => JSON.parse(readFileSync(join(A, n), 'utf8'));
  const gm = j('block-geometry.meta.json'), rm = j('block-runtime.meta.json'), P = j('block-physics.json');
  NS.Reg.init({ runtime: readFileSync(join(A, 'block-runtime.bin')).toString('base64'), runtimeBytes: rm.rawBytes,
    geometry: readFileSync(join(A, 'block-geometry.bin')).toString('base64'), geometryBytes: gm.rawBytes,
    physics: { defaults: P.defaults, exceptions: P.exceptions } });
  NS.Blocks.init();
  const Ph = NS.Physics;
  Ph.shapeAt = () => null; Ph.blockAt = () => NS.States.stateOf('water');
  Ph.updateFluids = (e) => (e.inWater = true, e.eyeInWater = true, e);
  return NS;
}
const key = (e) => [e.x, e.y, e.z, e.vx, e.vy, e.vz].map((v) => v.toFixed(7)).join(',');

// independent oracle: one water-branch tick. kind 'player' (input 0.98 * a) or 'mob' (zza * 0.02).
function oracle(e, o, grace, ds, kind) {
  const rows = [];
  for (let t = 0; t < TICKS; t++) {
    let f = 0.8, a = 0.02;
    if (kind === 'player') {
      let d = Math.min(ds, 3); if (!e.onGround) d *= 0.5;
      if (d > 0) { f += (o.drag - f) * d / 3; a += (0.1 - a) * d / 3; }
    }
    if (grace) f = o.grace;
    const inp = kind === 'player' ? 0.98 : 1, sy = Math.sin(e.yaw), cy = Math.cos(e.yaw);
    e.vx += inp * sy * a; e.vz += -inp * cy * a;
    e.x += e.vx; e.y += e.vy; e.z += e.vz;
    e.vx *= f; e.vz *= f; e.vy *= 0.8;
    const g = 0.08 / 16;
    if (e.vy <= 0 && Math.abs(e.vy - 0.005) >= 0.003 && Math.abs(e.vy - g) < 0.003) e.vy = -0.003; else e.vy -= g;
    rows.push(key(e));
  }
  return rows;
}
function engine(NS, e, grace, ds, kind) {
  const Ph = NS.Physics, rows = [];
  if (grace) NS.Effects.addStatusEffect(e, 'dolphins_grace', 100000, 0);
  e.depthStrider = ds;
  for (let t = 0; t < TICKS; t++) {
    if (kind === 'player') Ph.tick(e, { fwd: 1, strafe: 0, jump: false, sneak: false, sprint: false });
    else { e.zza = 1; e.inWater = true; Ph.travelMob(e, 0); }
    rows.push(key(e));
  }
  return rows;
}
function ent(salt, kind) {
  const r = rng(salt * 7919 + (kind === 'player' ? 1 : 2));
  const e = { x: 0.5, y: 20, z: 0.5, vx: (r() - 0.5) * 0.2, vy: (r() - 0.5) * 0.2, vz: (r() - 0.5) * 0.2, yaw: r() * 6.28, pitch: 0,
    onGround: false, flying: false, inWater: true, noclip: false, fallDistance: 0, effects: {} };
  if (kind === 'player') Object.assign(e, { height: 1.8, eyeHeight: 1.62 }); else Object.assign(e, { zza: 1, mobSpeed: 0.23, width: 0.6, height: 1.95, type: 'zombie' });
  return e;
}
function run(o = {}) {
  const NS = boot(o.patch); let bad = 0, first = '';
  const ph = { drag: 0.54600006, grace: 0.96, ...o.oracle };
  for (let salt = 1; salt <= SALTS; salt++) for (const grace of [false, true]) for (const [kind, ds] of [['player', 0], ['player', 3], ['mob', 0]]) {
    const dsl = ds && (salt % 3 + 1) > 0 ? (ds === 3 ? 1 + salt % 3 : 0) : 0;
    const a = engine(NS, ent(salt, kind), grace, dsl, kind), b = oracle(ent(salt, kind), ph, grace, o.noDs ? 0 : dsl, kind);
    for (let i = 0; i < TICKS; i++) if (a[i] !== b[i]) { bad++; if (!first) first = `salt ${salt} ${kind} ds ${dsl} grace ${grace} tick ${i}: engine ${a[i]} oracle ${b[i]}`; break; }
  }
  return { bad, first };
}
let fails = 0, breaks = 0; const notes = [];
const base = run();
if (base.bad) { fails++; console.log(`  FAIL ${base.bad} divergences; first: ${base.first}`); }
const brk = [
  ['oracle grace 0.96->0.9', { oracle: { grace: 0.9 } }],
  ['oracle depth-strider term dropped', { noDs: true }],
  ['engine grace 0.96->0.9', { patch: (f, s) => f === '14b_physics.js' ? s.replace('Ph.DOLPHIN_SLOWDOWN = 0.96', 'Ph.DOLPHIN_SLOWDOWN = 0.9').replace('if (e.dolphinsGrace) fr = 0.96;', '') : s }],
  ['engine depth-strider drag dropped', { patch: (f, s) => f === '14b_physics.js' ? s.replace('fr += (0.54600006 - fr) * ds / 3;', '') : s }],
];
for (const [name, o] of brk) {
  const d = run(o);
  if (d.bad) { breaks++; notes.push(`   ✓ ${name} caught: ${d.first}`); } else { fails++; console.log(`  FAIL ${name} not caught`); }
}
console.log(`${brk.length + 1 - fails} assertions, ${fails} failures, ${breaks} breaks caught (${SALTS} salts, ${base.bad} divergences)`);
notes.forEach((n) => console.log(n));
process.exit(fails ? 1 : 0);
