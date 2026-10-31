// ravagerlockstepcheck.mjs -- #6678 (G17-L107): lockstep scenario 'ravager': shield-blocked bite (50% stunTick 40 / else private knockBack), stunTick -> 0 starts roarTick 20,
// roar() at roarTick 10 (4-block box, 6 damage, knockBack 4.0/0.2, game event ravager_roar), leaf-breaking while horizontalCollision, attackTick decrement, immobile speed 0.
// Reference = .decomp RavagerEntity.tickMovement/knockback/roar/knockBack written out independently. 20 seeds. Per tick: attackTick/stunTick/roarTick, dummy vel + health,
// roar event tick, leaf blocks changed [[x,y,z,old,new]]. NOTE vanilla breaks leaves EVERY tick of horizontalCollision (no 4-tick gate in 1.18.2's tickMovement).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { serverRow, engineRow, compareTraces } from './lockstep/trace.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '07k_goals.js'], dom: false, initReg: true });
M.Tags.init({ tags: readFileSync(join(MCLITE_ROOT, 'assets', 'tags.bin')).toString('base64'), tagsBytes: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'tags.meta.json'), 'utf8')).blobBytes });
const { Ai } = M;
let fails = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const TICKS = 80, BITE = 3, salts = Array.from({ length: 20 }, (_, i) => i);
const leaves = M.Reg.real(M.Reg.names.indexOf('oak_leaves'), 0);
let ev = -1, clock = 0, rolls = [];
M.GameEvent = { emit(name) { if (name === 'ravager_roar') ev = clock; } };
M.MobVoice = { emit() {} };
// 50% stun draw per salt; ravager is `dist` from the dummy; leaf cell at (lx,64,0) is broken while horizontalCollision (salt odd) 
const setup = (salt) => ({ stunDraw: (salt % 4) < 2 ? 0.25 : 0.75, dist: 1 + (salt % 5), coll: salt % 2 === 1, hp: 20 });
function reference(s) {
  const rows = []; let att = 0, stun = 0, roar = 0, vx = 0, vy = 0, vz = 0, hp = s.hp, e = -1, leaf = true;
  for (let t = 0; t < TICKS; t++) {
    const blocks = [];
    if (t === BITE) {   // RavagerEntity.knockback(target): roarTick==0 gates; nextFloat()<0.5 -> stunTick=40 + pushAwayFrom, else knockBack
      if (roar === 0) {
        if (s.stunDraw < 0.5) { stun = 40; const dx = s.dist, m = Math.sqrt(Math.max(Math.abs(dx), 0)); const k = Math.min(1 / m, 1) * Math.fround(0.05); vx += dx / m * k; }
        else { const d = Math.max(s.dist * s.dist, 0.001); vx += s.dist / d * 4.0; vy += 0.2; }
      }
    } else {
      if (s.coll && leaf) { leaf = false; blocks.push([1, 64, 0, 'oak_leaves', 'air']); }   // breakBlock(leaves) once, the cell is then air
      if (roar > 0) { roar--; if (roar === 10) { e = t; if (s.dist < 0.975 + 4 + 0.3) { hp -= 6; vx += s.dist / Math.max(s.dist * s.dist, 0.001) * 4.0; vy += 0.2; } } }
      if (att > 0) att--;
      if (stun > 0) { stun--; if (stun === 0) roar = 20; }
    }
    rows.push({ att, stun, roar, vx, vy, vz, hp, e, blocks });
  }
  return rows;
}
function engine(s, patch) {
  const r = { type: 'ravager', x: 0, y: 64, z: 0, width: 1.95, height: 2.2, ravagerStunTick: 0, ravagerRoarTick: 0, ravagerAttackTick: 0, maxHealth: 100, health: 100, onGround: true, horizontalCollision: s.coll };
  const d = { type: 'player', x: s.dist, y: 64, z: 0, width: 0.6, height: 1.8, maxHealth: 20, health: s.hp, vx: 0, vy: 0, vz: 0 };
  let cell = leaves; const log = [];
  M.Physics = Object.assign(M.Physics || {}, { blockAt: (x, y, z) => (x === 1 && y === 64 && z === 0 ? cell : 0) });
  M.World = { setBlock(x, y, z, v) { if (x === 1 && y === 64 && z === 0) { log.push([1, 64, 0, 'oak_leaves', 'air']); cell = v; } }, getBlock: () => 0 };
  M.Player = null; M.EntityList = { list: [d], random: () => 0.5 };
  M.Survival = { hurt(o, _t, dmg) { o.health -= dmg; return true; } };
  M.Combat = Object.assign(M.Combat || {}, { hurt(o, dmg) { o.health -= dmg; return true; } });
  const g = new Ai.RavagerRoarGoal(r, { mobGriefing: () => true, random: () => s.stunDraw });
  if (patch) patch(Ai);
  const rows = []; ev = -1;
  for (let t = 0; t < TICKS; t++) {
    clock = t; log.length = 0;
    if (t === BITE) Ai.ravagerAttackBlockedByShield(r, d, { random: () => s.stunDraw });
    else { g.tick(); }
    rows.push({ att: r.ravagerAttackTick, stun: r.ravagerStunTick, roar: r.ravagerRoarTick, vx: d.vx, vy: d.vy, vz: d.vz, hp: d.health, e: ev, blocks: log.map((b) => b.slice()) });
  }
  return rows;
}
const ex = (r) => ({ att: r.att, stun: r.stun, roar: r.roar, dvx: r.vx, dvy: r.vy, hp: r.hp, event: r.e, chg: JSON.stringify(r.blocks) });
const F = ['att', 'stun', 'roar', 'dvx', 'dvy', 'hp', 'event', 'chg'];
const run = (salt, patch) => {
  const s = setup(salt), R = reference(s), E = engine(s, patch);
  const S = R.map((r, t) => Object.assign(serverRow(t, {}), ex(r))), G = E.map((r, t) => Object.assign(engineRow(t, {}), ex(r)));
  return { d: compareTraces(S, G, { fields: F }), R, E };
};
const bad = salts.map((x) => ({ x, r: run(x) })).filter((q) => q.r.d);
ok(!bad.length, 'ravager lockstep: ' + bad.slice(0, 2).map((q) => `salt ${q.x} ${JSON.stringify(q.r.d)}`));
{ const R = run(0).R; ok(R[BITE].stun === 40 && R[BITE + 40].roar === 20 && R[BITE + 40 + 10].e === BITE + 50, 'stun 40 -> roar 20 -> roar event at roarTick 10'); }
{ const R = run(2).R; ok(R[BITE].stun === 0 && R[BITE].vx > 0.5, 'unstunned bite applies knockBack 4.0'); }
{ const R = run(1).R; ok(R.some((r) => r.blocks.length), 'leaf broken'); }
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
brk(salts.some((x) => run(x, (A) => { A.RAVAGER_STUN_TICKS = 30; }).d), 'stunTick 40 -> 30 caught');
brk(salts.some((x) => run(x, (A) => { A.RAVAGER_ROAR_TICKS = 15; }).d), 'roarTick 20 -> 15 caught');
brk(salts.some((x) => run(x, (A) => { A.RAVAGER_KNOCKBACK_STRENGTH = 2; }).d), 'knockback strength 4 -> 2 caught');
console.log(`ravagerlockstepcheck: ${n + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
