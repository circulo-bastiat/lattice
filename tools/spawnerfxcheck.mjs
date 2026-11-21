#!/usr/bin/env node
// spawnerfxcheck.mjs — #168 (G18c-e): the monster spawner's client half. Headless proof of
// `Spawner.clientTick` (MobSpawnerLogic.clientTick, .decomp/net/minecraft/world/MobSpawnerLogic.java
// :49-63: smoke + flame at ONE shared random point in the block, only with a player in range; the spin
// advances by 1000/(delay+200) mod 360 and rests when nobody is near), the FlameParticle numbers
// (`Px.spawn('flame')`) and `Spawner.display` (MobSpawnerBlockEntityRenderer: scale 0.53125, / max(w,h)
// when > 1, lift 0.2, spin*10 degrees). Breaks its own data and prints "<n> breaks caught".
//   node tools/spawnerfxcheck.mjs
import { loadEngine } from './loadsrc.mjs';

const fails = []; let pass = 0;
const near = (a, b) => Math.abs(a - b) < 1e-4;

function fresh() {
  const MCL = loadEngine({ extra: ['07zx_particle.js', '07zs_spawner.js', '07j_entityrender.js'], dom: false });
  MCL.Player = { x: 10.5, y: 64.5, z: 10.5 };
  MCL.Particle.init && MCL.Particle.init();
  MCL.Particle.list.length = 0;
  return MCL;
}
function seq(...v) { let i = 0; return () => v[i++ % v.length]; }

// returns a list of failure strings for the engine `MCL`
function verify(MCL) {
  const bad = [];
  const t = (c, m) => { if (c) pass++; else bad.push(m); };
  const S = MCL.Spawner, Px = MCL.Particle;
  const e = { x: 10, y: 64, z: 10, delay: 200 };
  // in range: exactly one smoke + one flame, same (rolled) point
  Px.list.length = 0;
  S.clientTick(e, seq(0.25, 0.5, 0.75));
  const ty = Px.list.map((p) => p.type).sort().join();
  t(ty === 'flame,smoke', 'in range spawns one smoke and one flame, got ' + ty);
  const sm = Px.list.find((p) => p.type === 'smoke'), fl = Px.list.find((p) => p.type === 'flame');
  t(sm && near(sm.x, 10.25) && near(sm.y, 64.5) && near(sm.z, 10.75), 'smoke sits at (x+r1, y+r2, z+r3)');
  t(fl && Math.abs(fl.x - 10.25) < 0.051 && Math.abs(fl.y - 64.5) < 0.051 && Math.abs(fl.z - 10.75) < 0.051,
    'flame sits at the same point (within the +-0.05 wobble)');
  t(near(e.spin, 1000 / 400), 'spin advances by 1000/(delay+200) = 2.5, got ' + e.spin);
  t(e.spinO === 0, 'spinO holds the previous spin');
  e.delay = 0; S.clientTick(e, seq(0.5));
  t(near(e.spin, 2.5 + 5), 'delay 0 advances by 5');
  e.spin = 358; S.clientTick(e, seq(0.5));
  t(e.spin < 360 && near(e.spin, (358 + 5) % 360), 'spin wraps mod 360');
  // out of range: nothing spawned, spin frozen, spinO catches up
  Px.list.length = 0; MCL.Player.x = 100;
  const before = e.spin;
  const r = S.clientTick(e, seq(0.5));
  t(!r && Px.list.length === 0, 'out of range spawns nothing');
  t(e.spin === before && e.spinO === before, 'out of range: spin rests, spinO = spin');
  MCL.Player.x = 10.5;
  // range is per-block-entity: requiredPlayerRange 2 excludes a player 5 away
  MCL.Player.x = 15.5; Px.list.length = 0;
  t(S.clientTick({ x: 10, y: 64, z: 10, delay: 5, requiredPlayerRange: 2 }, seq(0.5)) === false && Px.list.length === 0,
    'requiredPlayerRange is honoured');
  MCL.Player.x = 10.5;
  // FlameParticle numbers
  for (let i = 0; i < 200; i++) {
    const p = Px.spawn('flame', 0, 0, 0, 0, 0, 0, Math.random);
    t(p.maxAge >= 12 && p.maxAge <= 44, 'flame maxAge is (int)(8/(0.2..1))+4');
    t(p.gravityStrength === 0 && near(p.velocityMultiplier, 0.96), 'flame: no gravity, slowing 0.96');
    t(Math.abs(p.vy - 0.001) < 0.0025 && p.vy > -0.003 && Math.abs(p.vx) < 0.0025, 'flame velocity is the 0.01-scaled jitter');
  }
  const f0 = Px.spawn('flame', 0, 0, 0, 0, 0, 0, seq(0.5)); f0.age = f0.maxAge;
  t(near(Px.sizeOf(f0), f0.scale * 0.5), 'flame size shrinks to 0.5 at end of life');
  // display: numbers
  const d = S.display({ spin: 3, spinO: 1 }, 0.5, { width: 0.6, height: 1.95 });
  t(near(d.scale, 0.53125 / 1.95), 'height 1.95 divides the scale');
  t(near(S.display({ spin: 0 }, 0, { width: 0.4, height: 0.3 }).scale, 0.53125), 'small mob uses 0.53125');
  t(near(d.spinDeg, 20) && d.lift === 0.2 && d.tiltDeg === -30, 'spin is lerp(1,3,.5)*10 = 20 degrees, lift 0.2');
  // #5186: the emitted pose carries the -30 degree X pitch (R = Ry(yaw) * Rx(30) in sleepPose's shape), not yaw alone
  const ER = MCL.EntityRender;
  const pe = ER && ER.spawnerDisplays ? { isSpawnerDisplay: true, yaw: -20, yawO: -20, age: 0 } : null;
  const sp = pe && ER.spawnerPoseOf(pe, 0);
  t(!!sp && near(sp.R[5], -Math.sin(30 * Math.PI / 180)) && near(sp.R[4], Math.cos(30 * Math.PI / 180)),
    'spawner mob pose has the -30 degree X tilt (R[4]=cos30, R[5]=-sin30)');
  t(ER && ER.spawnerPoseOf({ type: 'zombie' }, 0) === null, 'a real mob gets no spawner pose');
  // #6338: the display mob's age is the spawner's own tick count (ageInTicks = age + partial)
  if (ER && ER.spawnerDisplays) {
    if (!MCL.BlockEntities) MCL.BlockEntities = {};
    const BE = MCL.BlockEntities, was = BE.forEachNear, was2 = BE.stale, wr = BE.ready;
    const sb = { type: 'mob_spawner', entity: 'blaze', x: 10, y: 5, z: 10, spin: 0, delay: 20 };
    BE.ready = true; BE.stale = () => false; BE.forEachNear = (x, z, r, f) => f(sb);
    const ageAt = () => ER.spawnerDisplays(10, 10, 0)[0].age;
    const a0 = ageAt(), a0b = ageAt();
    S.clientTick(sb, Math.random); S.clientTick(sb, Math.random);
    const a2 = ageAt();
    BE.forEachNear = was; BE.stale = was2; BE.ready = wr;
    t(a0 === a0b, 'same tick: same age');
    t(a2 === a0 + 2, 'two spawner ticks advance the blaze display age by 2 (rods spin)');
  }
  return bad;
}

const good = verify(fresh());
fails.push(...good);

// ── anti-vacuity: each broken engine MUST fail verify() ──────────────────────────────────────
let breaks = 0;
const mutants = {
  'no flame': (M) => { const o = M.Particle.spawn; M.Particle.spawn = (ty, ...a) => (ty === 'flame' ? null : o.apply(M.Particle, [ty, ...a])); },
  'spawns even when far': (M) => { const o = M.Spawner.clientTick; M.Spawner.clientTick = (e, r) => { const p = M.Player.x; M.Player.x = 10.5; const v = o(e, r); M.Player.x = p; return v; }; },
  'spin never advances': (M) => { const o = M.Spawner.clientTick; M.Spawner.clientTick = (e, r) => { const s = e.spin; const v = o(e, r); e.spin = s || 0; return v; }; },
  'wrong scale': (M) => { const o = M.Spawner.display; M.Spawner.display = (e, p, d) => Object.assign(o(e, p, d), { scale: 0.5 }); },
  'frozen age': (M) => { const o = M.EntityRender.spawnerDisplays; M.EntityRender.spawnerDisplays = (...a) => o(...a).map((d) => Object.assign(d, { age: 0 })); },
  'no tilt': (M) => { M.EntityRender.spawnerPoseOf = () => ({ R: [1, 0, 0, 0, 1, 0, 0, 0, 1] }); },
  'flame keeps full size': (M) => { const o = M.Particle.sizeOf; M.Particle.sizeOf = (p) => (p.type === 'flame' ? p.scale : o(p)); },
};
for (const [name, mut] of Object.entries(mutants)) {
  const M = fresh(); mut(M);
  let bad; try { bad = verify(M); } catch (e) { bad = ['threw ' + e.message]; }
  if (bad.length) breaks++; else fails.push('mutant survived: ' + name);
}
console.log(`spawnerfxcheck: ${pass} checks, ${breaks} breaks caught`);
if (fails.length) { for (const f of fails) console.log('  FAIL ' + f); process.exit(1); }
