#!/usr/bin/env node
// particle11606check.mjs — #11606 (AUDIT-MAP). The four classes of 07zx_particle.js particleclasscheck does not drive:
//   EnderPearlEntity (spawnPearlBurst: 32 portal particles, y+rand*2, gaussian vx/vz, vy 0)
//   BufferBuilder (colorOf: float colour stored (int)(c*255) in a byte wraps)
//   AxisCycleDirection (RainSplash tick reads the cell shape at (z-frac, x-frac) order: cellTopAt called with x-frac then z-frac as vanilla's swapped getEndingCoord)
//   ClientWorld.addParticle (Settings.particles Minimal refuses a non-block spawn, block dust is never gated)
// Each is re-run against a source mutant that cuts it; every cut must be noticed.
import { loadEngine } from './loadsrc.mjs';
let N = 0;
function run(patch) {
  const E = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07zx_particle.js', '14j_combat.js', '14c_raycast.js'], dom: false,
    ...(patch ? { patch: (f, t) => (f === '07zx_particle.js' ? patch(t) : t) } : {}) });
  const P = E.Particle, f = [];
  const ok = (c, m) => { N++; if (!c) f.push(m); };
  try {
    P.init();
    const r = () => 0.5;
    P.list.length = 0;
    const n = P.spawnPearlBurst(10, 20, 30, r);
    const L = P.list.filter((p) => p.type === 'portal');
    ok(n === 32 && L.length === 32, 'EnderPearlEntity spawns 32 portal particles');
    ok(L.every((p) => p.y === 21 && p.startY === 21 && p.vy === 0), 'EnderPearlEntity y + nextDouble*2, vy 0');
    ok(L.every((p) => p.x === 10 && p.z === 30), 'EnderPearlEntity at the pearl x/z');
    P.list.length = 0;
    const ink = P.spawn('squid_ink', 0, 0, 0, 0, 0, 0, r);
    ink.red = 2; ink.green = 0.5; ink.blue = 1; ink.alpha = 1;
    const c = P.colorOf(ink);
    ok(Math.abs(c[0] - 254 / 255) < 1e-9 && Math.abs(c[1] - 127 / 255) < 1e-9 && Math.abs(c[2] - 1) < 1e-9 && c[3] === 1, 'BufferBuilder colour byte wrap');
    P.list.length = 0;
    const seen = [];
    P.cellTopAt = (bx, by, bz, a, b) => { seen.push([a, b]); return 0; };
    const rp = P.spawn('rain', 5.25, 5, 5.75, 0, 0, 0, r);
    if (rp) { rp.onGround = false; rp.vx = rp.vy = rp.vz = 0; rp.maxAge = 5; P.rainRand = () => 0.9; P.tick(); }
    ok(seen.length > 0 && Math.abs(seen[0][0] - 0.25) < 0.01 && Math.abs(seen[0][1] - 0.75) < 0.01, 'AxisCycleDirection cell shape read order');
    E.Settings = E.Settings || {};
    const NSs = E;
    NSs.Settings.particles = 2;
    P.list.length = 0;
    const lo = () => 0.0;
    const a = P.spawn('flame', 0, 0, 0, 0, 0, 0, lo), b = P.spawn('block', 0, 0, 0, 0, 0, 0, lo);
    NSs.Settings.particles = 0;
    ok(a === null && !!b, 'ClientWorld.addParticle Minimal gate (block exempt)');
  } catch (e) { f.push('threw: ' + e.message); }
  return f;
}
const base = run(null);
if (base.length) { console.log('FAIL baseline: ' + base.join('; ')); process.exit(1); }
const muts = [
  ['pearl count', (t) => t.replace('Px.PEARL_BURST_COUNT = 32;', 'Px.PEARL_BURST_COUNT = 31;')],
  ['pearl y spread', (t) => t.replace("Px.spawn('portal', x, y + r() * 2, z", "Px.spawn('portal', x, y + r(), z")],
  ['ink wrap', (t) => t.replace('return ((Math.floor(c * 255) & 255) / 255);', 'return c;')],
  ['axis swap', (t) => t.replace('Px.cellTopAt(bx, by, bz, p.x - bx, p.z - bz)', 'Px.cellTopAt(bx, by, bz, p.z - bz, p.x - bx)')],
  ['minimal gate', (t) => t.replace("type !== 'block' && Px.calculateParticleLevel(lvl, false, rand || Math.random) === 2", 'false')],
  ['block exempt', (t) => t.replace("lvl && type !== 'block' &&", 'lvl &&')],
];
let caught = 0; const missed = [];
for (const [name, fn] of muts) {
  const probe = (t) => { const o = fn(t); if (o === t) throw new Error('mutant did not change source: ' + name); return o; };
  let f; try { f = run(probe); } catch (e) { if (/did not change/.test(e.message)) { console.log('FAIL ' + e.message); process.exit(1); } f = ['threw']; }
  if (f.length) { caught++; console.log('   ✓ cutting ' + name + ' fails: ' + f[0].slice(0, 70)); } else { missed.push(name); console.log('  FAIL cutting ' + name + ' went unnoticed'); }
}
console.log(` assertions passed .. ${N / (muts.length + 1) | 0}`);
console.log(` failures ........... ${missed.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(missed.length ? 1 : 0);
