#!/usr/bin/env node
// cloudparticlecheck.mjs — AreaEffectCloudEntity.tick client branch (Po.cloudParticles): counts, colour, offsets.
import { loadEngine } from './loadsrc.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '07_world.js', '07b_behaviour.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
  '14i_hand.js', '14j_combat.js', '14d_survival.js', '07q_effects.js', '07z_potion.js', '07zx_particle.js'] });
const Po = M.Potion; Po.cloudDry = true;
function lcg(seed) { let s = BigInt(seed) ^ 0x5DEECE66Dn; s &= (1n << 48n) - 1n;
  const next = b => { s = (s * 0x5DEECE66Dn + 0xBn) & ((1n << 48n) - 1n); return Number(s >> (48n - BigInt(b))); };
  return () => ((next(26) * 134217728) + next(27)) / 9007199254740992; }
// float-precision nextFloat is next(24)/2^24; use that for fidelity
function jr(seed) { let s = (BigInt(seed) ^ 0x5DEECE66Dn) & ((1n << 48n) - 1n);
  return () => { s = (s * 0x5DEECE66Dn + 0xBn) & ((1n << 48n) - 1n); return Number(s >> 24n) / 16777216; }; }
function run(o) {
  const e = Object.assign({ x: 10, y: 64, z: -5, age: 0, waitTime: 10, radius: 3, potionId: 'swiftness', custom: null }, o);
  const r = jr(42), all = [];
  for (let t = 0; t < 10; t++) { e.age = t + (o.startAge || 0); all.push(Po.cloudParticles(e, r)); }
  return all;
}
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const wait = run({}), act = run({ startAge: 10 });
const col = Po.colorOf('swiftness', null);
const rgb = [(col >> 16 & 255) / 255, (col >> 8 & 255) / 255, (col & 255) / 255].map(Math.fround);
ok(wait.every(t => t.length === 0 || t.length === 2), 'waiting ticks spawn 0 or 2');
ok(act.every(t => t.length === Math.ceil(Math.fround(Math.fround(Math.PI) * 9))), 'active spawns ceil(pi*r^2)=29');
ok(wait.flat().every(p => p[0] === 'entity_effect' && (p[4] === 1 || p[4] === rgb[0])), 'waiting colour white or potion');
ok(act.flat().every(p => p[4] === rgb[0] && p[5] === rgb[1] && p[6] === rgb[2]), 'active colour is potion colour');
ok(act.flat().every(p => Math.hypot(p[1] - 10, p[3] + 5) <= 3.0001), 'offsets within radius');
ok(wait.flat().every(p => Math.hypot(p[1] - 10, p[3] + 5) <= 0.2001), 'waiting offsets within 0.2');
const sig = a => JSON.stringify(a);
const base = sig(act);
ok(sig(run({ startAge: 10 })) === base, 'deterministic for a seed'); 
for (const [n, o] of [['radius', { startAge: 10, radius: 2 }], ['waiting flag', { startAge: 0 }], ['custom colour', { startAge: 10, color: 0x123456 }], ['dragon_breath', { startAge: 10, particle: 'dragon_breath' }]]) {
  breaks++; if (sig(run(o)) === base) fails.push('anti-vacuity: ' + n + ' did not change output'); else console.log('  ✓ break caught: ' + n);
}
const db = run({ startAge: 10, particle: 'dragon_breath' }).flat();
ok(db.every(p => p[5] === Math.fround(0.01)), 'dragon_breath active vy 0.01');
console.log(`cloudparticlecheck: ${pass} checks passed, ${fails.length} failures, ${breaks} breaks caught`);
if (fails.length) { for (const f of fails) console.log('  - ' + f); process.exit(1); }
