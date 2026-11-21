#!/usr/bin/env node
// particle11726check.mjs - #11726 (AUDIT-MAP). SoulParticle, SnowflakeParticle, CurrentDownParticle (client/particle),
// ported from .decomp into Px.spawn / Px.tick of 07zx_particle.js. Each rule is re-run against a source mutant that cuts it.
import { loadEngine } from './loadsrc.mjs';
let N = 0;
function run(patch) {
  const E = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07zx_particle.js', '14j_combat.js', '14c_raycast.js'], dom: false,
    ...(patch ? { patch: (f, t) => (f === '07zx_particle.js' ? patch(t) : t) } : {}) });
  const P = E.Particle, f = [];
  const ok = (c, m) => { N++; if (!c) f.push(m); };
  try {
    P.init(); P.list.length = 0;
    const r = () => 0.5;
    const s = P.spawn('soul', 1, 2, 3, 0.1, 0.2, 0.3, r);
    ok(s && s.alpha === 1 && s.velocityMultiplier === 0.96 && s.maxAge === 17 && Math.abs(s.x - 1) < 1e-9, 'SoulParticle ctor: maxAge 17, alpha 1, drag .96');
    ok(Math.abs(s.vx - 0.1) < 0.01 && Math.abs(s.vy - 0.2) < 0.01, 'SoulParticle velocity = caller + jitter*0.01');
    const n = P.spawn('snowflake', 0, 0, 0, 0, 0, 0, r);
    ok(n && n.gravityStrength === 0.225 && n.red === 0.923 && n.green === 0.964 && n.blue === 0.999, 'SnowflakeParticle gravity + colour');
    ok(n.maxAge === Math.floor(16 / 0.6) + 2 && Math.abs(n.scale - 0.1 * 1.25) < 1e-9, 'SnowflakeParticle maxAge/scale');
    n.vx = n.vy = n.vz = 1; n.gravityStrength = 0; P.list.length = 0; P.list.push(n); P.tick();
    ok(Math.abs(n.vx - 0.95) < 1e-9 && Math.abs(n.vy - 0.9) < 1e-9, 'SnowflakeParticle tick *0.95/*0.9');
    const c = P.spawn('current_down', 0, 0, 0, 0, 0, 0, r);
    ok(c && c.maxAge === 60 && c.vy === -0.05 && c.gravityStrength === 0.002, 'CurrentDownParticle ctor');
    const gb = E.World.getBlock, W = E.Reg.id.water;
    const ws = [...Array(E.States.block.length).keys()].find((i) => E.States.block[i] === W);
    E.World.getBlock = () => ws;
    P.list.length = 0; P.list.push(c); const y0 = c.y; P.tick();
    ok(P.list.length === 1 && c.y < y0 && c.age === 1, 'CurrentDownParticle sinks in water');
    E.World.getBlock = () => 0; P.tick();
    ok(P.list.length === 0, 'CurrentDownParticle dies out of water');
    E.World.getBlock = gb;
    P.list.length = 0;
    const bp = P.spawn('bubble_pop', 0, 0, 0, 0, 0, 0, r);
    ok(bp && bp.maxAge === 4 && Math.abs(bp.gravityStrength * 0.04 - 0.008) < 1e-9 && bp.velocityMultiplier === 1, 'BubblePopParticle ctor');
    P.tick(); ok(Math.abs(bp.vy + 0.008) < 1e-9 && Math.abs(bp.y + 0.008) < 1e-9, 'BubblePopParticle tick gravity');
    P.list.length = 0;
    const rp = P.spawn('reverse_portal', 0, 0, 0, 1, 2, 3, r);
    ok(rp && rp.maxAge === 61 && Math.abs(rp.scale - 0.1 * 0.6 * 1.5) < 1e-9, 'ReversePortalParticle ctor: maxAge 61, scale*1.5');
    P.tick(); ok(Math.abs(rp.x - 1 / 61) < 1e-9 && Math.abs(rp.z - 3 / 61) < 1e-9, 'ReversePortalParticle tick pos += v*age/maxAge');
    P.list.length = 0;
    const ls = P.spawn('large_smoke', 0, 0, 0, 0.1, 0.2, 0.3, r), sm = P.spawn('smoke', 0, 0, 0, 0.1, 0.2, 0.3, r);
    ok(ls && sm && Math.abs(ls.scale - sm.scale * 2.5) < 1e-9 && ls.maxAge === Math.round(sm.maxAge * 2.5) && ls.gravityStrength === -0.1 && ls.velocityMultiplier === 0.96, 'LargeFireSmokeParticle: FireSmoke with size 2.5 (scale, maxAge)');
  } catch (e) { f.push('threw: ' + e.message); }
  return f;
}
const base = run(null);
if (base.length) { console.log('FAIL baseline: ' + base.join('; ')); process.exit(1); }
const muts = [
  ['soul drag', (t) => t.replace('gravityStrength: 0, velocityMultiplier: 0.96, alpha: 1,', 'gravityStrength: 0, velocityMultiplier: 0.9, alpha: 1,')],
  ['soul maxAge', (t) => t.replace('Math.floor(8 / (r() * 0.8 + 0.2)) + 4, scale: baseScale * 1.5', 'Math.floor(8 / (r() * 0.8 + 0.2)) + 3, scale: baseScale * 1.5')],
  ['snow gravity', (t) => t.replace('gravityStrength: 0.225', 'gravityStrength: 0.2')],
  ['snow colour', (t) => t.replace('green: 0.964', 'green: 0.9')],
  ['snow tick', (t) => t.replace('p.vy *= 0.9; p.vz *= 0.95; }   // Snow', 'p.vy *= 0.95; p.vz *= 0.95; }   // Snow')],
  ['snow maxAge', (t) => t.replace('(r() * 0.8 + 0.2)) + 2;', '(r() * 0.8 + 0.2)) + 1;')],
  ['current maxAge', (t) => t.replace('Math.floor(r() * 60) + 30', 'Math.floor(r() * 60) + 20')],
  ['current vy', (t) => t.replace("vx: 0, vy: -0.05, vz: 0, gravityStrength: 0.002", "vx: 0, vy: -0.5, vz: 0, gravityStrength: 0.002")],
  ['bubblepop maxAge', (t) => t.replace('age: 0, maxAge: 4, scale: baseScale }', 'age: 0, maxAge: 5, scale: baseScale }')],
  ['bubblepop gravity', (t) => t.replace('gravityStrength: 0.2, velocityMultiplier: 1, age: 0, maxAge: 4', 'gravityStrength: 0.1, velocityMultiplier: 1, age: 0, maxAge: 4')],
  ['revportal maxAge', (t) => t.replace('Math.floor(r() * 2) + 60', 'Math.floor(r() * 2) + 40')],
  ['revportal scale', (t) => t.replace('* 0.2 + 0.5) * 1.5,', '* 0.2 + 0.5),')],
  ['revportal tick', (t) => t.replace('p.x += p.vx * rf;', 'p.x += p.vx;')],
  ['largesmoke size', (t) => t.replace("type === 'large_smoke' ? 2.5 : 1", "type === 'large_smoke' ? 2 : 1")],
  ['largesmoke age', (t) => t.replace('* smSize)),', ')),')],
];
let caught = 0;
for (const [name, fn] of muts) {
  const probe = (t) => { const o = fn(t); if (o === t) throw new Error('mutant did not change source (no-op): ' + name); return o; };
  let f; try { f = run(probe); } catch (e) { console.log('FAIL ' + e.message); process.exit(1); }
  if (f.length) { caught++; console.log('   ✓ cutting ' + name + ' fails: ' + f[0].slice(0, 70)); } else console.log('  FAIL cutting ' + name + ' went unnoticed');
}
console.log(` assertions passed .. ${N / (muts.length + 1) | 0}`);
console.log(` failures ........... ${muts.length - caught}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(caught === muts.length ? 0 : 1);
