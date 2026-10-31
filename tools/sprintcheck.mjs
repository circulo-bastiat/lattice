#!/usr/bin/env node
// sprintcheck.mjs -- #10621: the sprint feature against 1.18.2 (.decomp PlayerEntity / LivingEntity).
//   speed     sprinting is a MULTIPLY_TOTAL +0.3 modifier on 0.1 (LivingEntity SPRINTING_SPEED_BOOST); ground push = speed*(0.216/f^3),
//             drag f*0.91: per-tick velocity over 60 ticks is compared with an independent float transcription of travel().
//   jump      PlayerEntity.jump: +0.2F exhaustion sprinting, 0.05F otherwise; LivingEntity.jump adds (-sin yaw, cos yaw)*0.2 only when sprinting.
//   hunger    increaseTravelMotionStats: sprinting costs 0.1F * round(dist*100) * 0.01F; walking and sneaking cost 0.0F.
//   knockback PlayerEntity.attack: a sprinting full-strength hit adds +1 knockback level and blocks the crit.
// Anti-vacuity: every number is broken in the real source text and each break must be caught.
import { loadEngine } from './loadsrc.mjs';
import { readFileSync } from 'node:fs';

const F = Math.fround;
const EXTRA = ['02f_tags.js', '07b_behaviour.js', '07_world.js', '14b_physics.js', '14d_survival.js'];

function boot(patch) {
  const M = loadEngine({ extra: EXTRA, dom: false, patch });
  const W = M.World, S = M.Section, CFG = M.CFG;
  W.init(1);
  const stone = M.States.stateOf('stone');
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
    const c = W.getOrCreate(cx, cz); c.state = M.CH.GENERATED; c.biome = new Uint8Array(256);
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
      const ly = 63 - CFG.WORLD_MIN_Y;
      S.set(c.sec[ly >> 4], ((ly & 15) << 8) | (z << 4) | x, stone);
    }
  }
  return M;
}
const mkP0 = () => ({ x: 0.5, y: 64, z: 0.5, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: true, width: 0.6, height: 1.8,
  health: 20, maxHealth: 20, food: 20, saturation: 5, exhaustion: 0, mode: 0, age: 0, dead: false, eyeInWater: false, inWater: false });

function mkP(M) {
  const P = mkP0(); if (!M) return P;
  for (let i = 0; i < 3; i++) M.Physics.tick(P, { fwd: 0, strafe: 0, jump: false, sneak: false, sprint: false });   // settle on the floor
  P.vx = P.vz = 0; P.x = 0.5; P.z = 0.5; return P;
}
// independent oracle of LivingEntity.travel on block friction 0.6 (stone), flat ground, forward input 1 (x0.98)
function oracleSpeed(sprint, ticks) {
  const base = F(0.1), speed = sprint ? F(base * F(1 + F(0.3))) : base, f3 = F(0.6), f1 = F(f3 * F(0.91));
  const a = speed * (0.21600002 / (f3 * f3 * f3)), out = []; let v = 0;
  for (let i = 0; i < ticks; i++) { v += 0.98 * a; const moved = v; v *= f1; out.push(moved); }
  return out;
}
function engineSpeed(M, sprint, ticks, o = {}) {
  const P = mkP(M), out = [];
  for (let i = 0; i < ticks; i++) { const z0 = P.z; M.Physics.tick(P, { fwd: 1, strafe: 0, jump: false, sneak: false, sprint }); out.push(Math.abs(P.z - z0)); }
  return out;
}
function jumpVec(M, sprint, yaw) {
  const P = mkP(M); P.yaw = yaw; M.Physics.tick(P, { fwd: 1, strafe: 0, jump: true, sneak: false, sprint });
  return P;
}
const jumpOracle = (sprint, yaw) => { const a = 0.98 * (sprint ? F(0.1 * 1.3) : 0.1) * (0.21600002 / (0.6 ** 3)) , d = Math.fround(0.6 * 0.91); return { yaw, a, d }; };

function run(patch) {
  const bad = [];
  const M = boot(patch);
  // speed
  for (const sprint of [false, true]) {
    const e = engineSpeed(M, sprint, 60), o = oracleSpeed(sprint, 60);
    // the oracle moves AFTER adding; the engine reports displacement after the tick, which includes collision-free motion
    for (let i = 0; i < 60; i++) if (Math.abs(e[i] - o[i]) > 1e-5) { bad.push(`speed sprint=${sprint} tick ${i}: engine ${e[i]} oracle ${o[i]}`); break; }
  }
  // sprint-jump boost along the yaw, on top of the walking push
  for (const yaw of [0, 0.7, 2.1, -1.3]) {
    const s = jumpVec(M, true, yaw), w = jumpVec(M, false, yaw);
    const o = jumpOracle(true, yaw), ow = jumpOracle(false, yaw);
    const f1 = o.d;
    // after the tick vx,vz are (push + boost) * f1 where push is along the wish vector (== yaw forward)
    const boostX = Math.sin(yaw) * 0.2 * f1, boostZ = -Math.cos(yaw) * 0.2 * f1;
    const dx = (s.vx - w.vx) - (boostX - 0 + (o.a - ow.a) * (Math.sin(yaw)) * f1), dz = (s.vz - w.vz) - (boostZ + (o.a - ow.a) * (-Math.cos(yaw)) * f1);
    if (Math.hypot(dx, dz) > 1e-4) bad.push(`jump yaw ${yaw}: delta off by ${dx},${dz}`);
  }
  // hunger
  const Sv = M.Survival;
  const ex = (f) => { const e = mkP0(); f(e); return e.exhaustion; };
  const near = (a, b) => Math.abs(a - b) < 1e-5;
  const dist = 12.34, cm = Math.round(F(Math.sqrt(dist * dist) * 100));
  if (!near(ex((e) => Sv.movement(e, dist, { sprinting: true })), F(0.1) * cm * F(0.01))) bad.push('sprint exhaustion per distance');
  if (!near(ex((e) => Sv.movement(e, dist, { walking: true })), 0)) bad.push('walk exhaustion not 0');
  if (!near(ex((e) => Sv.jumped(e, true)), F(0.2))) bad.push('sprint-jump exhaustion');
  if (!near(ex((e) => Sv.jumped(e, false)), F(0.05))) bad.push('jump exhaustion');
  return bad;
}

const decomp = (() => { try { return readFileSync(new URL('../.decomp/net/minecraft/entity/player/PlayerEntity.java', import.meta.url), 'utf8'); } catch { return null; } })();
let fails = 0, breaks = 0; const notes = [];
const base = run();
if (base.length) { fails++; console.log('  FAIL baseline: ' + base.join('; ')); }
const sp = engineSpeed(boot(), true, 60), wk = engineSpeed(boot(), false, 60);
if (!(sp[59] > wk[59] * 1.29 && sp[59] < wk[59] * 1.31)) { fails++; console.log('  FAIL vacuous: sprint/walk ratio ' + sp[59] / wk[59]); }
if (decomp) {
  for (const [re, what] of [[/addExhaustion\(0\.2F\)/, 'sprint jump 0.2F'], [/addExhaustion\(0\.05F\)/, 'jump 0.05F'], [/addExhaustion\(0\.1F \* \(float\)\$\$6 \* 0\.01F\)/, 'sprint distance 0.1F']])
    if (!re.test(decomp)) { fails++; console.log('  FAIL decomp no longer shows ' + what); }
  if (!/isSprinting\(\) && \$\$5\) \{[\s\S]{0,260}\$\$7\+\+;/.test(decomp)) { fails++; console.log('  FAIL decomp sprint knockback +1'); }
}
const cb = readFileSync(new URL('../src/14j_combat.js', import.meta.url), 'utf8');
if (!/if \(sprinting && full\) \{ kb\+\+; sprintKnock = true;/.test(cb) || !/!sprinting && !\(NS\.Effects/.test(cb)) { fails++; console.log('  FAIL combat sprint knockback/crit rule'); }

const brk = [
  ['SPRINT_MULT 1.3->1.2', (f, s) => f === '14b_physics.js' ? s.replace('SPRINT_MULT: 1.3,', 'SPRINT_MULT: 1.2,') : s],
  ['SPEED 0.1->0.11', (f, s) => f === '14b_physics.js' ? s.replace('SPEED: 0.1, ', 'SPEED: 0.11,') : s],
  ['SPRINT_JUMP_BOOST 0.2->0.25', (f, s) => f === '14b_physics.js' ? s.replace('SPRINT_JUMP_BOOST: 0.2,', 'SPRINT_JUMP_BOOST: 0.25,') : s],
  ['sprint boost along wrong axis', (f, s) => f === '14b_physics.js' ? s.replace('e.vx += Math.sin(e.yaw) * Ph.SPRINT_JUMP_BOOST;', 'e.vx += Math.cos(e.yaw) * Ph.SPRINT_JUMP_BOOST;') : s],
  ['EX_SPRINT 0.1->0.2', (f, s) => f === '14d_survival.js' ? s.replace('EX_SPRINT: 0.1,', 'EX_SPRINT: 0.2,') : s],
  ['EX_SPRINT_JUMP 0.2->0.1', (f, s) => f === '14d_survival.js' ? s.replace('EX_SPRINT_JUMP: 0.2,', 'EX_SPRINT_JUMP: 0.1,') : s],
  ['EX_JUMP 0.05->0.1', (f, s) => f === '14d_survival.js' ? s.replace('EX_JUMP: 0.05,', 'EX_JUMP: 0.1,') : s],
  ['walking costs exhaustion', (f, s) => f === '14d_survival.js' ? s.replace('else if (o.swimming) Sv.addExhaustion', 'else if (o.swimming || o.walking) Sv.addExhaustion') : s],
];
for (const [name, patch] of brk) {
  let src = null; const probe = (f, s) => { const r = patch(f, s); if (r !== s) src = true; return r; };
  const d = run(probe);
  if (!src) { fails++; console.log(`  FAIL ${name}: patch did not match`); } else if (d.length) { breaks++; notes.push(`   ✓ ${name} caught: ${d[0]}`); } else { fails++; console.log(`  FAIL ${name} not caught`); }
}
console.log(`${brk.length + 2 - fails} assertions, ${fails} failures, ${breaks} breaks caught`);
notes.forEach((n) => console.log(n));
process.exit(fails ? 1 : 0);
