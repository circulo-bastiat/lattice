#!/usr/bin/env node
// particlecapcheck.mjs — Px.MAX degradation rule (#10762): 100,000 mixed spawns, drop-oldest.
import { loadEngine } from './loadsrc.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '07_world.js', '07b_behaviour.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
  '14i_hand.js', '14j_combat.js', '14d_survival.js', '07q_effects.js', '07z_potion.js', '07zx_particle.js'] });
const Px = M.Particle;
const TYPES = ['heart', 'smoke', 'happy_villager', 'angry_villager', 'portal', 'flame'];
let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
function run(breakCap) {
  Px.init(); Px.evicted = 0;
  if (breakCap) Px.makeRoom = function () {};
  const N = 100000; let maxLive = 0, tickMax = 0, tag = 0, last = [];
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) {
    const p = Px.spawn(TYPES[i % TYPES.length], i, 64, 0, 0, 0, 0, rnd);
    if (p) { p.__id = i; if (i >= N - 100) last.push(p); }
    if (Px.list.length > maxLive) maxLive = Px.list.length;
    if (i % 1000 === 999) { const t = process.hrtime.bigint(); Px.tick(); tickMax = Math.max(tickMax, Number(process.hrtime.bigint() - t) / 1e6); }
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { maxLive, tickMax, ms, last, evicted: Px.evicted, live: Px.list.slice() };
}
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const r = run(false);
ok(r.maxLive <= Px.MAX, 'live count ' + r.maxLive + ' <= MAX ' + Px.MAX);
ok(r.tickMax < 50, 'worst tick ' + r.tickMax.toFixed(2) + 'ms < 50ms');
ok(r.ms < 20000, 'total ' + r.ms.toFixed(0) + 'ms bounded');
ok(r.evicted > 0, 'oldest were evicted');
const live = new Set(r.live);
const lastAlive = r.last.filter(p => live.has(p)).length;
ok(r.last.length > 0 && lastAlive > 0, 'newest spawns still present (' + lastAlive + '/' + r.last.length + ')');
ok(r.live.every(p => p.__id !== undefined), 'all live are spawns of this run');
// anti-vacuity: with the degrade rule removed the cap assertion must fail
breaks++;
const b = run(true);
if (b.maxLive <= Px.MAX) fails.push('anti-vacuity: cap removed but count still <= MAX'); else console.log('  ✓ break caught: no cap -> live ' + b.maxLive);
console.log(`particlecapcheck: ${pass} checks passed, ${fails.length} failures, ${breaks} breaks caught`);
if (fails.length) { for (const f of fails) console.log('  - ' + f); process.exit(1); }
