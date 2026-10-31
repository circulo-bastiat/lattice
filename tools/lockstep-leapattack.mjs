#!/usr/bin/env node
// lockstep-leapattack -- #7940 (G18b-L27): lockstep scenario 'leapattack', 20 salts. Spider / cave spider vs a player on flat ground or behind a 3-block wall,
// night (brightness 0) and day (brightness 1). The engine's real Ai.PounceAtTargetGoal (PounceAtTargetGoal.java: 4 <= d^2 <= 16, onGround, 1/5-ish roll, velocity
// 0.4 fwd*unit + 0.2*old, y = 0.4), Ai.SpiderAttackGoal (reach 4 + targetWidth, 20-tick cooldown, SpiderEntity.AttackGoal.shouldContinue: brightness >= 0.5 and
// nextInt(100)==0 drops the target) and Physics.onClimbable (spider: last tick's horizontalCollision flag) run 600 ticks against a hand reference of the Java.
import { loadEngine } from './loadsrc.mjs';

const SALTS = 20, TICKS = 600;
const stream = (salt) => { let s = (salt * 2654435761 + 4242) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const num = (v) => Math.fround(v).toFixed(5);

function scenario(salt) {
  const r = stream(salt);
  return { name: r() < 0.5 ? 'spider' : 'cave_spider', wall: salt % 2 === 1, day: (salt >> 1) % 2 === 1, x: r() * 2, z: r() * 2, tx: 4 + r() * 3, tz: -1 + r() * 2, seed: salt * 31 + 7 };
}
const hw = (n) => (n === 'spider' ? 0.7 : 0.35);

// shared scripted world (same for both sides): gravity, drag, ground y=64, wall block x in [wallX, wallX+1] up to y=67
function physics(e, sc) {
  const wallX = sc.wall ? sc.tx - 2 : 1e9;
  e.vy = e.climbing ? 0.2 : (e.vy - 0.08) * 0.98; e.vx *= e.onGround ? 0.6 : 0.91; e.vz *= e.onGround ? 0.6 : 0.91;
  if (e.onGround && !e.vx && !e.vz) e.vx = 0.1;   // keep pushing at the target
  if (e.onGround && Math.abs(e.vx) < 0.05) e.vx = 0.1;
  const h = hw(sc.name); let nx = e.x + e.vx;
  e.hc = nx + h > wallX && e.y < 67;
  if (e.hc) { nx = wallX - h; e.vx = 0; }
  e.x = nx; e.y += e.vy; e.z += e.vz;
  if (e.y <= 64) { e.y = 64; e.vy = 0; e.onGround = true; } else e.onGround = false;
}
const row = (e, hits, tgt, cl) => [num(e.x), num(e.y), num(e.z), num(e.vx), num(e.vy), num(e.vz), e.onGround, cl, hits, tgt ? 1 : 0].join(',');

function engine(salt, patch) {
  const M = loadEngine({ patch, extra: ['14b_physics.js', '07k_goals.js'], dom: false });
  const Ai = M.Ai; let hits = 0;
  Ai.stepToward = () => {}; Ai.meleeNavTick = () => {};
  const sc = scenario(salt), rnd = stream(sc.seed);
  Ai.lightLevelDependentMagicValue = () => (sc.day ? 1 : 0);
  M.Combat = { mobAttack: () => { hits++; } };
  const t = { type: 'player', x: sc.tx, y: 64, z: sc.tz, width: 0.6 };
  const e = { type: sc.name, x: sc.x, y: 64, z: sc.z, vx: 0.1, vy: 0, vz: 0, onGround: true, target: t, age: 0, climbingWall: false };
  const leap = new Ai.PounceAtTargetGoal(e, { random: rnd }, 0.4), atk = new Ai.SpiderAttackGoal(e, { random: rnd });
  atk.start(); let leaping = false; const rows = [];
  for (let k = 0; k < TICKS; k++) {
    e.age = k;
    if (e.target) {
      if (!atk.canContinueToUse()) atk.stop(); else atk.tick();
    }
    if (leaping) { if (!leap.canContinueToUse()) leaping = false; }
    else if (leap.canUse()) { leap.start(); leaping = true; e.onGround = false; }
    e.climbing = M.Physics.onClimbable(e);
    physics(e, sc);
    e.climbingWall = e.hc;
    rows.push(row(e, hits, e.target, e.climbing));
  }
  return rows;
}

function reference(salt) {
  const sc = scenario(salt), rnd = stream(sc.seed);
  const t = { x: sc.tx, y: 64, z: sc.tz, w: 0.6 };
  const e = { x: sc.x, y: 64, z: sc.z, vx: 0.1, vy: 0, vz: 0, onGround: true, climbing: false, hc: false, cd: 0 };
  let target = true, hits = 0, leaping = false, climbingWall = false; const rows = [];
  for (let k = 0; k < TICKS; k++) {
    if (target) {
      // SpiderEntity.AttackGoal.shouldContinue
      if (sc.day && rnd() < 0.01) target = false;   // nextInt(100) == 0
      else {
        if (e.cd > 0) e.cd--;
        const d = (t.x - e.x) ** 2 + (t.y - e.y) ** 2 + (t.z - e.z) ** 2;
        if (d <= 4 + t.w && e.cd <= 0) { e.cd = 20; hits++; }
      }
    }
    if (leaping) { if (e.onGround) leaping = false; }
    else if (target) {
      const d = (t.x - e.x) ** 2 + (t.y - e.y) ** 2 + (t.z - e.z) ** 2;
      if (d >= 4 && d <= 16 && e.onGround && Math.floor(rnd() * 6) === 0) {
        const dx = t.x - e.x, dz = t.z - e.z, l = Math.hypot(dx, dz);
        const nx = l * l > 1e-7 ? dx / l * 0.4 + e.vx * 0.2 : dx, nz = l * l > 1e-7 ? dz / l * 0.4 + e.vz * 0.2 : dz;
        e.vx = nx; e.vy = 0.4; e.vz = nz; leaping = true; e.onGround = false;
      }
    }
    e.climbing = climbingWall;
    physics(e, sc);
    climbingWall = e.hc;
    rows.push(row(e, hits, target, e.climbing));
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
const G = '07k_goals.js';
const breaks = [
  ['leap strength 0.4 -> 0.5', (f, s) => f === G ? s.replace('* 0.4 + e.vx * 0.2', '* 0.5 + e.vx * 0.2') : s],
  ['leap up 0.4 -> 0.5', (f, s) => f === G ? s.replace('e.vy = momentumMultiplier;', 'e.vy = momentumMultiplier + 0.1;') : s],
  ['leap min distance 4 -> 1', (f, s) => f === G ? s.replace('Ai.LEAP_MIN_DSQ = 4;', 'Ai.LEAP_MIN_DSQ = 1;') : s],
  ['attack cooldown 20 -> 19', (f, s) => f === G ? s.replace("+MOB_AI['melee.attack_interval'] || 20", '19') : s],
  ['daylight give-up 0.5 -> 2', (f, s) => f === G ? s.replace('if (f >= 0.5 && random() < 0.01)', 'if (f >= 2 && random() < 0.01)') : s],
  ['climbing ignores flag', (f, s) => f === '14b_physics.js' ? s.replace('return !!e.climbingWall;', 'return false;') : s],
];
import fs from 'node:fs';
for (const [name, p] of breaks) {
  // no-op guard: the break must actually change its target source (pattern not found = no-op)
  const files = ['14b_physics.js', G];
  if (!files.some(f => { const t = fs.readFileSync(new URL('../src/' + f, import.meta.url), 'utf8'); return p(f, t) !== t; })) { ok = false; console.log('NO-OP BREAK (pattern not found): ' + name); continue; }
  const x = run(p);
  if (x.bad > 0) caught++; else { ok = false; console.log('NOT CAUGHT: ' + name); }
}
console.log(`${SALTS * 2 + breaks.length} assertions, `+`leapattack: ${caught} breaks caught, ${base.bad} divergences${base.first ? ' ' + base.first : ''}`);
process.exit(ok && caught === breaks.length ? 0 : 1);
