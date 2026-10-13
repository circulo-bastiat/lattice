// endermanlockstepcheck.mjs -- #6302 (G17-L54): lockstep scenario 'enderman': an enderman 6 blocks from a scripted player who starts turning toward it at tick LOOK (10); 20 seeds.
// Reference = EndermanEntity.isPlayerStaring (:211-224: dot > 1 - 0.025/dist) and teleportRandomly (:273-282: nextDouble-0.5)*64, getY + nextInt(64)-32, then
// LivingEntity.teleport's walk-down onto a floor) written out independently over java.util.Random (NS.JRandom). Per tick aggro and, once aggro'd, each teleport destination.
// NOTE: engine ints are floor(double*n), not Random.nextInt (stream not bit-aligned); the lane feeds the draw ORDER faithfully. OWED: block pick-up (needs the 'blocks' field, #6293) and the rain/water damage teleport lanes.
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const BASE = ['02f_tags.js', '07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '14j_combat.js', '07l_spawn.js', '07zg_enderman.js'];
const M = loadEngine({ extra: BASE, dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init();
const { Enderman: EM, States: S } = M;
const stone = S.stateOf('stone'), FLOOR = 63;
const w = { getBlock: (x, y, z) => (y <= FLOOR ? stone : 0), setBlock() {}, getLight: () => 0, tickingAt: () => true, loadedAt: () => true, heightAt: () => FLOOR, BOTTOM_Y: -64 };
M.World = Object.assign(M.World || {}, w);
M.Physics.shapeAt = (x, y, z) => { const st = w.getBlock(x, y, z); return st ? M.Physics.shapesForState(st) : null; };   // the flat stub world, not the chunk store
let fails = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const salts = Array.from({ length: 20 }, (_, i) => i), TICKS = 60, LOOK = 10, TELEPORTS = 8;
const EYE = 1.62, EEYE = 2.55;
const mkRand = (salt) => new M.JRandom(1000 + salt);
const norm = (v) => { const l = Math.hypot(v.x, v.y, v.z); return { x: v.x / l, y: v.y / l, z: v.z / l }; };
// scripted player: from LOOK the look vector closes on the enderman by `rate` per tick (angle error err0 - rate*(t-LOOK))
function setup(salt) {
  const yaw = (salt * 0.7) % (2 * Math.PI), dist = 6;
  const en = { x: Math.cos(yaw) * dist, y: FLOOR + 1, z: Math.sin(yaw) * dist };
  const err0 = 0.3 + 0.02 * (salt % 7), rate = 0.02 + 0.003 * (salt % 5);
  return { en, err0, rate, yaw };
}
function look(s, t) {
  const to = norm({ x: s.en.x, y: s.en.y + EEYE - (FLOOR + 1 + EYE), z: s.en.z });
  const err = t < LOOK ? 1.0 : Math.max(0, s.err0 - s.rate * (t - LOOK));
  // rotate about the vertical axis by err (t<LOOK: looking away by 1 rad)
  const c = Math.cos(err), sn = Math.sin(err);
  return norm({ x: to.x * c - to.z * sn, y: to.y, z: to.x * sn + to.z * c });
}
function refStare(s, t) {
  const f = look(s, t), px = 0, py = FLOOR + 1 + EYE, pz = 0;
  const dx = s.en.x - px, dy = s.en.y + EEYE - py, dz = s.en.z - pz, d = Math.hypot(dx, dy, dz);
  return f.x * dx / d + f.y * dy / d + f.z * dz / d > 1 - 0.025 / d;
}
function engStare(s, t) {
  const f = look(s, t);
  const p = { x: 0, y: FLOOR + 1, z: 0, eyeHeight: EYE, lookVec: () => f };
  return EM.isPlayerStaring({ x: s.en.x, y: s.en.y, z: s.en.z }, p);
}
function refTeleports(s, salt) {
  const r = mkRand(salt), out = [];
  let x = s.en.x, y = s.en.y, z = s.en.z;
  for (let k = 0; k < 400 && out.length < TELEPORTS; k++) {
    const nx = x + (r.nextDouble() - 0.5) * 64, ny = y + (r.nextInt(64) - 32), nz = z + (r.nextDouble() - 0.5) * 64;
    const by0 = Math.floor(ny);
    if (by0 < FLOOR + 1) continue;   // lands inside the floor: teleport reverts
    x = nx; y = ny - (by0 - (FLOOR + 1)); z = nz; out.push({ x, y, z });
  }
  return out;
}
function engTeleports(s, salt) {
  const r = mkRand(salt), out = [];
  // the engine's rint(n) is floor(rnd()*n) over ONE double source, not Random.nextInt: feed the Java draw order (double, int, double) with the int encoded as (i+0.5)/64
  let k0 = 0;
  M.EntityList.random = () => (k0++ % 3 === 1 ? (r.nextInt(64) + 0.5) / 64 : r.nextDouble());
  const e = { type: 'enderman', x: s.en.x, y: s.en.y, z: s.en.z, width: 0.6, height: 2.9, dead: false, health: 40, silent: true };
  for (let k = 0; k < 400 && out.length < TELEPORTS; k++) if (EM.teleportRandomly(e)) out.push({ x: e.x, y: e.y, z: e.z });
  return out;
}
const run = (salt) => {
  const s = setup(salt);
  let ref = -1, eng = -1;
  for (let t = 0; t < TICKS; t++) { if (ref < 0 && refStare(s, t)) ref = t; if (eng < 0 && engStare(s, t)) eng = t; }
  const A = refTeleports(s, salt), B = engTeleports(s, salt);
  let bad = ref !== eng ? 'aggro tick ' + eng + ' != ' + ref : '';
  if (!bad) for (let i = 0; i < Math.max(A.length, B.length); i++) if (!A[i] || !B[i] || Math.abs(A[i].x - B[i].x) > 1e-9 || Math.abs(A[i].y - B[i].y) > 1e-9 || Math.abs(A[i].z - B[i].z) > 1e-9) { bad = 'teleport ' + i; break; }
  return { bad, ref, tp: A.length };
};
const dirty = () => salts.some((s) => run(s).bad);
const res = salts.map(run);
ok(!res.some((r) => r.bad), 'divergence: ' + res.map((r, i) => r.bad && i + ':' + r.bad).filter(Boolean).slice(0, 3));
ok(res.every((r) => r.ref > LOOK) && new Set(res.map((r) => r.ref)).size > 3, 'aggro ticks are after LOOK and vary by seed (not vacuous)');
ok(res.every((r) => r.tp === TELEPORTS), 'every seed collected ' + TELEPORTS + ' teleports');
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
{ const o = EM.RANDOM_TP_XZ; EM.RANDOM_TP_XZ = 32; brk(dirty(), 'teleport box 64 -> 32 caught'); EM.RANDOM_TP_XZ = o; }
{ const o = EM.STARE_K; EM.STARE_K = 0.05; brk(dirty(), 'stare constant 0.025 -> 0.05 caught'); EM.STARE_K = o; }
{ const o = EM.RANDOM_TP_Y; EM.RANDOM_TP_Y = 32; brk(dirty(), 'teleport Y range 64 -> 32 caught'); EM.RANDOM_TP_Y = o; }
console.log(`endermanlockstepcheck: ${n + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
