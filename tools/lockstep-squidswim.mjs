#!/usr/bin/env node
// lockstep-squidswim -- #6892 (G17-L175): lockstep scenario 'squidswim', 20 salts. A squid and a glow squid in a 16x8x16 water tank; the squid is
// hurt at tick 100 (attacker 3 blocks away), the tank is drained at tick 300. The engine's real Sq.tickAi/tickAir/tickMovement/onAttacked/onDamaged
// run 650 ticks and are compared per tick with SquidEntity.tickMovement + SwimGoal + EscapeAttackerGoal (.decomp) written out again here: pos/vel,
// swim vector, tentacleAngle, swimVelocityScale (rotateSpeed), turningSpeed, air, glow dark ticks, ink squirt tick/count, escape speed.
import { loadEngine } from './loadsrc.mjs';

const SALTS = 20, TICKS = 650, HURT = 100, DRAIN = 300;
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const inTank = (x, y, z) => x >= 0 && x < 16 && z >= 0 && z < 16 && y >= 60 && y < 68;
const fmt = (e) => [e.x, e.y, e.z, e.vx, e.vy, e.vz, e.swimX, e.swimY, e.swimZ, e.tentacleAngle, e.swimVelocityScale, e.turningSpeed, e.squidAir, e.darkTicksRemaining || 0, e.inkSquirts || 0, e.inkTick].join(',');

function engine(salt, patch) {
  const M = loadEngine({ patch, extra: ['02f_tags.js', '07_world.js', '07k_goals.js', '07t_fly.js', '07zi_squid.js'], dom: false });
  const Sq = M.Squid, W = M.World;
  Sq.ready = true;
  const drained = () => t0 >= DRAIN;
  let t0 = 0;
  W.getBlock = (x, y, z) => (!drained() && inTank(x, y, z) ? M.States.stateOf('water') : 0);
  const r = stream(salt);
  Sq.random = r;
  const atk = { x: 3, y: 64, z: 8, health: 20 };
  const mk = (type) => { const e = { type, id: 1, x: 8.5, y: 63, z: 8.5, vx: 0, vy: 0, vz: 0, age: 0, hurtAge: 0, inWater: true, width: 0.8, height: 0.8 }; Sq.spawnInit(e); e.thrustTimerSpeed = 0.15; e.inkTick = -1; return e; };
  const es = [mk('squid'), mk('glow_squid')], rows = [];
  for (let t = 0; t < TICKS; t++) {
    t0 = t;
    for (const e of es) {
      e.age++;
      e.inWater = !drained() && inTank(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z));
      if (t === HURT && e.type === 'squid') { e.lastHurtByEntity = atk; e.hurtAge = e.age; Sq.onAttacked(e); e.inkTick = t; }
      if (t === HURT && e.type === 'glow_squid') { e.lastHurtByEntity = atk; e.hurtAge = e.age; Sq.onDamaged(e); }
      Sq.tickAi(e);
      Sq.tickAir(e);
      e.x += e.vx; e.y += e.vy; e.z += e.vz;
      Sq.tickMovement(e);
    }
    rows.push(es.map(fmt).join('|'));
  }
  return rows;
}

function reference(salt) {
  const r = stream(salt), ni = (n) => Math.floor(r() * n), PI2 = Math.PI * 2;
  const atk = { x: 3, y: 64, z: 8 };
  const mk = (glow) => ({ glow, x: 8.5, y: 63, z: 8.5, vx: 0, vy: 0, vz: 0, age: 0, hurtAge: 0, th: 0, ths: 0.15, ta: 0, sv: 0, ts: 0, sx: 0, sy: 0, sz: 0, air: 300, dark: 0, ink: 0, inkTick: -1, att: false });
  const es = [mk(false), mk(true)], rows = []; r(); r();   // spawnInit draws thrustTimerSpeed per squid (the check then pins it)
  for (let t = 0; t < TICKS; t++) {
    const drained = t >= DRAIN;
    const water = (x, y, z) => !drained && inTank(x, y, z);
    for (const e of es) {
      e.age++;
      const w = water(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z));
      if (t === HURT) { e.att = true; e.hurtAge = e.age; if (!e.glow) { e.ink++; e.inkTick = t; } else e.dark = 100; }
      // SwimGoal
      if (ni(50) === 0 || !w || !(e.sx !== 0 || e.sy !== 0 || e.sz !== 0)) {
        const a = r() * PI2; e.sx = Math.cos(a) * 0.2; e.sy = -0.1 + r() * 0.2; e.sz = Math.sin(a) * 0.2;
      }
      // EscapeAttackerGoal (attacker remembered 100 ticks)
      const live = e.att && e.age - e.hurtAge <= 100;
      let dx = e.x - atk.x, dy = e.y - atk.y, dz = e.z - atk.z;
      if (live && w && dx * dx + dy * dy + dz * dz < 100) {
        const bx = Math.floor(e.x + dx), by = Math.floor(e.y + dy), bz = Math.floor(e.z + dz);
        const air = !water(bx, by, bz);
        if (water(bx, by, bz) || air) {
          const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (len > 0) { let s = 3.0; if (len > 5) s -= (len - 5) / 5; if (s > 0) { dx *= s; dy *= s; dz *= s; } }
          if (air) dy = 0;
          e.sx = dx / 20; e.sy = dy / 20; e.sz = dz / 20;
        }
      }
      // air
      if (w) e.air = 300; else { e.air--; if (e.air === -20) e.air = 0; }
      e.x += e.vx; e.y += e.vy; e.z += e.vz;
      // tickMovement
      e.th += e.ths;
      if (e.th > PI2) { e.th -= PI2; if (ni(10) === 0) e.ths = 1 / (r() + 1) * 0.2; }
      if (w) {
        if (e.th < Math.PI) {
          const q = e.th / Math.PI;
          e.ta = Math.sin(q * q * Math.PI) * Math.PI * 0.25;
          if (q > 0.75) { e.sv = 1; e.ts = 1; } else e.ts *= 0.8;
        } else { e.ta = 0; e.sv *= 0.9; e.ts *= 0.99; }
        e.vx = e.sx * e.sv; e.vy = e.sy * e.sv; e.vz = e.sz * e.sv;
      } else {
        e.ta = Math.abs(Math.sin(e.th)) * Math.PI * 0.25;
        e.vy = (e.vy - 0.08) * 0.98; e.vx = 0; e.vz = 0;
      }
      if (e.glow && e.dark > 0) e.dark--;
    }
    rows.push(es.map((e) => [e.x, e.y, e.z, e.vx, e.vy, e.vz, e.sx, e.sy, e.sz, e.ta, e.sv, e.ts, e.air, e.dark, e.ink, e.inkTick].join(',')).join('|'));
  }
  return rows;
}

function run(patch) {
  let bad = 0, first = '';
  for (let s = 1; s <= SALTS; s++) {
    const a = engine(s, patch), b = reference(s);
    for (let i = 0; i < TICKS; i++) if (a[i] !== b[i]) { bad++; if (!first) first = `salt ${s} tick ${i}:\n  engine ${a[i]}\n  ref    ${b[i]}`; break; }
  }
  return { bad, first };
}

const base = run();
let ok = base.bad === 0, caught = 0;
const breaks = [
  ['escape speed 3.0 -> 2.5', (f, s) => f === '07zi_squid.js' ? s.replace('var scale = 3.0;', 'var scale = 2.5;') : s],
  ['dark ticks 100 -> 99', (f, s) => f === '07zi_squid.js' ? s.replace('darkTicksRemaining = 100', 'darkTicksRemaining = 99') : s],
  ['out-of-water gravity 0.08 -> 0.07', (f, s) => f === '07zi_squid.js' ? s.replace('vy -= 0.08;', 'vy -= 0.07;') : s],
  ['drown threshold -20 -> -19', (f, s) => f === '07zi_squid.js' ? s.replace('e.squidAir === -20', 'e.squidAir === -19') : s],
];
for (const [name, p] of breaks) {
  const x = run(p);
  if (x.bad > 0) caught++; else { ok = false; console.log('NOT CAUGHT: ' + name); }
}
console.log(`squidswim: ${caught} breaks caught, ${base.bad} divergences${base.first ? " " + base.first : ""}`);
process.exit(ok && caught === breaks.length ? 0 : 1);
