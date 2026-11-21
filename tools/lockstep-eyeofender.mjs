#!/usr/bin/env node
// lockstep-eyeofender -- #7079 (G17-L216): thrown eye of ender, 20 salts. Th.eyeInit/tickEye/useEye per tick (pos, vel, lifespan) and the end state
// (shatter vs item drop, nextInt(5) > 0 roll, survival stack shrink) against an independent transcription of EyeOfEnderEntity.initTargetPos/tick
// and EnderEyeItem.use (.decomp). Targets near (<= 12) and far (clamped, +8 y) are both covered.
import { loadEngine } from './loadsrc.mjs';

const SALTS = 20, TICKS = 90;
const stream = (salt) => { let s = (salt * 2654435761 + 977) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const fl = Math.fround;
function scen(salt) {
  const r = stream(salt), far = salt % 4 !== 0;
  const x = (r() - 0.5) * 200, y = 60 + r() * 20, z = (r() - 0.5) * 200, a = r() * 6.283, d = far ? 13 + r() * 90 : r() * 11.5;
  return { x, y, z, tx: Math.floor(x + Math.cos(a) * d), ty: Math.floor(y - 30 - r() * 20), tz: Math.floor(z + Math.sin(a) * d), creative: salt % 5 === 3, vx: (r() - 0.5) * 0.3, vy: (r() - 0.5) * 0.3, vz: (r() - 0.5) * 0.3 };
}
const row = (e, drop, log) => [e.x, e.y, e.z, e.vx, e.vy, e.vz, e.lifespan, e.removed ? 1 : 0, log.join(';')].join('|');

function engine(salt, patch) {
  const M = loadEngine({ patch, extra: ['07zzd_throw.js'], dom: false });
  const sc = scen(salt), r = stream(salt + 5000), log = [];
  const stack = { i: 7, n: 3 };
  M.Items = { nameOf: () => 'ender_eye' };
  M.Inventory = { shrink: (s, n) => { s.n -= n; }, setItem: () => {} };
  M.Structures = { locateStructure: () => ({ x: sc.tx, y: sc.ty, z: sc.tz }) };
  M.EntityList = { ready: true, random: r, spawn: (t, x, y, z, o) => { const e = { type: t, x, y, z, vx: sc.vx, vy: sc.vy, vz: sc.vz, item: o.item }; return e; }, dropStack: (x, y, z, it, n) => log.push('D' + it + ',' + n) };
  M.Sound = { entitySound: (n) => log.push('S' + n) };
  M.Particle = { worldEvent: (id) => log.push('W' + id) };
  const e0 = { x: sc.x, y: sc.y, z: sc.z, vx: sc.vx, vy: sc.vy, vz: sc.vz };
  // capture the spawned entity: wrap spawn
  let ent; const sp = M.EntityList.spawn; M.EntityList.spawn = (...a) => (ent = sp(...a));
  const P = { x: sc.x, y: sc.y - 1.62, z: sc.z, eyeHeight: 1.62, instabuild: sc.creative, inventory: {}, slot: 0 };
  const ok = M.Throw.useEye(P, stack);
  const rows = [ok + '|' + stack.n + '|' + ent.tx + ',' + ent.ty + ',' + ent.tz + '|' + ent.dropsItem];
  for (let t = 0; t < TICKS && !ent.removed; t++) { log.length = 0; M.Throw.tickEye(ent); rows.push(row(ent, 0, log)); }
  return rows;
}
function reference(salt, o = {}) {
  const sc = scen(salt), r = stream(salt + 5000), LIFE = o.life || 80, BOUND = o.bound || 5, IT = 7;
  let x = sc.x, y = sc.y, z = sc.z, vx = sc.vx, vy = sc.vy, vz = sc.vz, n = 3;
  const dx = sc.tx - x, dz = sc.tz - z, d = Math.sqrt(dx * dx + dz * dz); let tx, ty, tz;
  if (d > 12.0) { tx = x + dx / d * 12.0; tz = z + dz / d * 12.0; ty = y + 8.0; } else { tx = sc.tx; ty = sc.ty; tz = sc.tz; }
  const drops = Math.floor(r() * BOUND) > 0;
  if (!sc.creative) n--;
  const rows = [true + '|' + n + '|' + tx + ',' + ty + ',' + tz + '|' + drops];
  let life = 0, removed = false;
  for (let t = 0; t < TICKS && !removed; t++) {
    const log = [], nx = x + vx, ny = y + vy, nz = z + vz, h = Math.sqrt(vx * vx + vz * vz);
    const ex = tx - nx, ez = tz - nz, dist = fl(Math.sqrt(ex * ex + ez * ez)), ang = fl(Math.atan2(ez, ex));
    let sp = h + (dist - h) * 0.0025, nvy = vy; if (dist < 1.0) { sp *= 0.8; nvy *= 0.8; }
    const dir = y < ty ? 1 : -1;
    vx = Math.cos(ang) * sp; vz = Math.sin(ang) * sp; vy = nvy + (dir - nvy) * fl(0.015);
    x = nx; y = ny; z = nz;
    if (++life > LIFE) { removed = true; log.push('Sentity.ender_eye.death'); log.push(drops ? 'D' + IT + ',1' : 'W2003'); }
    rows.push([x, y, z, vx, vy, vz, life, removed ? 1 : 0, log.join(';')].join('|'));
  }
  return rows;
}
function run(o = {}) {
  let bad = 0, first = '';
  for (let salt = 1; salt <= SALTS; salt++) {
    const a = engine(salt, o.patch), b = reference(salt, o);
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) { bad++; if (!first) first = `salt ${salt} row ${i}: engine ${a[i]} ref ${b[i]}`; break; }
  }
  return { bad, first };
}
let fails = 0, breaks = 0; const notes = [];
const base = run();
if (base.bad) { fails++; console.log(`  FAIL ${base.bad} divergences; first: ${base.first}`); }
let shat = 0, drop = 0, cre = 0;
for (let s = 1; s <= SALTS; s++) { const b = reference(s); const last = b[b.length - 1]; if (last.includes('W2003')) shat++; if (last.includes(';D7')) drop++; if (b[0].split('|')[1] === '3') cre++; }
if (!shat || !drop || !cre) { fails++; console.log(`  FAIL vacuous: shatter ${shat} drop ${drop} creative ${cre}`); }
const brk = [
  ['reference lifespan 80->81', { life: 81 }],
  ['reference drop roll 5->4', { bound: 4 }],
  ['engine lifespan 80->81', { patch: (f, s) => f === '07zzd_throw.js' ? s.replace('e.lifespan > 80', 'e.lifespan > 81') : s }],
  ['engine drop roll 5->4', { patch: (f, s) => f === '07zzd_throw.js' ? s.replace('() * 5) > 0', '() * 4) > 0') : s }],
  ['engine clamp 12->13', { patch: (f, s) => f === '07zzd_throw.js' ? s.replace('d > 12.0', 'd > 13.0') : s }],
];
for (const [name, o] of brk) {
  const d = run(o);
  if (d.bad) { breaks++; notes.push(`   ✓ ${name} caught: ${d.first}`); } else { fails++; console.log(`  FAIL ${name} not caught`); }
}
console.log(`${brk.length + 2 - fails} assertions, ${fails} failures, ${breaks} breaks caught (${SALTS} salts, ${base.bad} divergences)`);
notes.forEach((n) => console.log(n));
process.exit(fails ? 1 : 0);
