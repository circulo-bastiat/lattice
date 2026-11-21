#!/usr/bin/env node
// lockstep-ravagerroar -- #8643 (G18b-L34): ravager vs a player holding a shield, 20 salts x 800 ticks (engine side).
// A blocked hit (Survival.hurt -> Use.takeShieldHit -> RavagerEntity.knockback) stuns 50% for 40 ticks; stunTick 0 -> roarTick 20;
// roarTick 10 -> roar(): 6 damage + knockBack(4.0) to every non-ravager in the 4-block expanded box (illagers take no damage).
// Per tick: stunTick/attackTick/roarTick, immobile, the bystanders' health/velocity. Vanilla RavagerEntity.tickMovement/roar/knockback.
import { harness, buildLane } from './referee/lockstep/zombielane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';

const { M, w, cells } = harness();
const EL = M.EntityList, P = M.Player, Ai = M.Ai;
let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const stream = (s) => { let a = (s + 1) * 2654435761 >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
const T = 800, HIT = 50;

function run(salt) {
  const r = stream(salt); EL.random = r; Math.random = r;
  buildLane({ w, cells, M });
  EL.list.length = 0; EL.nextId = 1; EL.spawnCounter = 0; EL.ticks = 0;
  const rv = EL.spawn('ravager', 5.5, 0, 0.5);
  const cow = EL.spawn('cow', 7.5, 0, 0.5), far = EL.spawn('cow', 14.5, 0, 0.5), ill = EL.spawn('vindicator', 5.5, 0, 3.5);
  for (const m of [rv, cow, far, ill]) { m.persistent = true; m.aiDisabled = true; }
  P.x = 4.5; P.y = 0; P.z = 0.5; P.dead = false; P.health = 20;
  const rows = [];
  for (let t = 0; t < T; t++) {
    if (t % HIT === 0 && !(rv.ravagerRoarTick > 0) && !(rv.ravagerStunTick > 0)) {
      P.health = 20; P.dead = false;   // Use.takeShieldHit(P, rv) -> RavagerEntity.knockback (14l_use.js is not in the lane harness)
      rv.ravagerAttackTick = 10; Ai.ravagerAttackBlockedByShield(rv, P, { random: EL.random });
    }
    rows.push({ tick: t, stun: rv.ravagerStunTick || 0, attack: rv.ravagerAttackTick || 0, roar: rv.ravagerRoarTick || 0,
      cowHp: cow.health, farHp: far.health, illHp: ill.health, cowVx: +(cow.vx || 0).toFixed(6), cowVy: +(cow.vy || 0).toFixed(6) });
    EL.tick();
    cow.x = 7.5; cow.z = 0.5; far.x = 14.5; ill.z = 3.5; ill.x = 5.5; rv.x = 5.5; rv.z = 0.5;
    for (const m of [rv, cow, far, ill]) if (m.y < 0) { m.y = 0; m.vy = 0; }   // the lane floor is not the point
  }
  return rows;
}
run(0);
const base = run(0);
const F = ['stun', 'attack', 'roar', 'cowHp', 'farHp', 'illHp', 'cowVx', 'cowVy'];
let stunned = 0, roared = 0;
for (let s = 0; s < 20; s++) {
  run(s); const a = run(s), b = run(s);
  { const d = compareTraces(a, b, { fields: F }); ok(d === null, `salt ${s}: repeatable ${d && JSON.stringify(d).slice(0, 300)}`); }
  const st = a.findIndex((r) => r.stun === 40);
  if (st >= 0) {
    stunned++;
    const ro = a.findIndex((r, i) => i > st && r.roar === 20);
    ok(ro === st + 40, `salt ${s}: roar starts ${ro - st} ticks after stun`);
    const hit = a.findIndex((r, i) => i > ro && r.cowHp < a[ro].cowHp);
    if (hit >= 0) roared++;
    ok(hit === ro + 10 || hit === ro + 11, `salt ${s}: cow hurt at +${hit - ro}`);
    ok(a.every((r) => r.farHp === a[0].farHp && r.illHp === a[0].illHp), `salt ${s}: far cow / vindicator untouched`);
  }
}
ok(stunned > 0 && stunned < 20 + 1, `some salts stun (${stunned})`);
ok(roared > 0, 'a roar landed');
const mut = (f, fn) => base.map((r, t) => (t === 200 ? { ...r, [f]: fn(r[f]) } : r));
caught(compareTraces(base, mut('stun', (v) => v + 1), { fields: F })?.field === 'stun', 'stun +1');
caught(compareTraces(base, mut('cowHp', (v) => v - 1), { fields: F })?.field === 'cowHp', 'cowHp -1');
const cur = Ai.RAVAGER_STUN_TICKS; Ai.RAVAGER_STUN_TICKS = 30;
const alt = run(0); Ai.RAVAGER_STUN_TICKS = cur;
caught(compareTraces(base, alt, { fields: F }) !== null || stunned === 0, 'stun 40 changed to 30');
caught(compareTraces(base, base.slice(1), { fields: F }) !== null, 'row shift');
console.log(`${20 * 4 + 4} assertions, ${bad} failures, ${breaks} breaks caught (20 salts x ${T} ticks; ${stunned} stunned, ${roared} roared)`);
process.exit(bad ? 1 : 0);
