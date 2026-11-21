#!/usr/bin/env node
// witherparticlecheck.mjs — #4876: Wi.tickParticles (WitherEntity.tickMovement client particles).
import { loadEngine, initRegistry } from './loadsrc.mjs';

let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };

const M = loadEngine({ extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
  '07j_entityrender.js', '07m_breed.js', '10_gfx.js', '15h_bemodel.js', '07k_goals.js', '07t_fly.js', '07zw_mobnbt.js', '07zx_particle.js', '07zzm_wither.js', '07_world.js', '07b_behaviour.js'], dom: false });
initRegistry(M);
const NS = M, Wi = NS.Wither, Px = NS.Particle;
Px.init();
const count = (e) => { Px.list.length = 0; Wi.tickMovement(e); const c = {}; for (const p of Px.list) c[p.type] = (c[p.type] || 0) + 1; return c; };
const mk = (o) => Object.assign({ type: 'wither', x: 0, y: 70, z: 0, yaw: 0, health: 300, maxHealth: 300, invulTimer: 0, age: 1 }, o);

let c = count(mk({}));
ok(c.smoke === 3 && !c.effect, 'healthy wither: 3 smoke, no effect ' + JSON.stringify(c));
const e = mk({}); Px.list.length = 0; Wi.tickMovement(e);
ok(Px.list.filter(p => p.type === 'smoke').every(p => Math.abs(p.y - 70) < 4 && Math.hypot(p.x, p.z) < 4), 'smoke near the heads');
let eff = 0; for (let i = 0; i < 400; i++) eff += count(mk({ health: 100 })).effect || 0;
ok(eff > 200 && eff < 400, 'below half health: ~1/4 per head per tick, got ' + eff + '/1200');
c = count(mk({ invulTimer: 100, health: 100 }));
ok(c.effect >= 3, 'invulnerable: >=3 effect ' + JSON.stringify(c));

okAv(!((count(mk({})).effect || 0) >= 3), 'a healthy wither with a charge-up swirl would be caught');
okAv(!((count(mk({ invulTimer: 100 })).effect || 0) < 3), 'a charge-up with no swirl would be caught');
okAv(!(count(mk({})).smoke !== 3), 'a missing smoke trail would be caught');

console.log(`witherparticlecheck (#4876, wither particles)\n assertions passed .. ${pass}\n failures ........... ${fails.length}\n breaks caught ...... ${breaks}`);
if (fails.length) { for (const f of fails) console.log('  FAIL: ' + f); process.exit(1); }
