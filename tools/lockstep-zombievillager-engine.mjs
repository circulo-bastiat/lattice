#!/usr/bin/env node
// lockstep-zombievillager-engine -- #9377 (G17-L69a-0): the ENGINE half of the zombie-kills-villager scenario (#9263). At HARD a zombie
// (ZombieEntity.initCustomGoals: ActiveTargetGoal<Merchant>, ZombieAttackGoal) acquires a villager in the lane, closes in, kills it, and
// ZombieEntity.onKilledOther (Zv.convertVillagerToZombie) leaves a zombie_villager. The trace is (type, id, conversion tick) per salt;
// same salt = same trace, and each tamper below must change it or fail an assertion.
import { harness } from './referee/lockstep/zombielane.mjs';
import { startX } from './referee/chasescen.mjs';

let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { bad++; console.log('NOT CAUGHT ' + m); } };
const T = 1500, SALTS = [0, 1, 2, 3, 4];
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };

function run(salt, diff) {
  const h = harness(), M = h.M, EL = M.EntityList, P = M.Player;
  const { buildLane } = h; void buildLane;
  const r = stream(salt); EL.random = r; Math.random = r; if (M.VB) M.VB.rand = r; if (M.wrandReset) M.wrandReset();
  h.cells.clear();
  const stone = M.States.stateOf('stone');
  for (let x = -4; x <= 26; x++) for (let z = -1; z <= 1; z++) {
    h.w.set(x, -1, z, stone);
    if (z !== 0) for (let y = 0; y <= 1; y++) h.w.set(x, y, z * 2, stone);
  }
  for (let z = -1; z <= 1; z++) for (let y = 0; y <= 1; y++) { h.w.set(-4, y, z, stone); h.w.set(26, y, z, stone); }
  M.Diff.set(diff);
  EL.list.length = 0; EL.nextId = 1; EL.spawnCounter = 0; EL.ticks = 0;
  P.init(); M.Gamemode.set(P, M.Gamemode.CREATIVE);   // a creative player is no target: the zombie can only want the villager
  P.x = 200; P.y = 0; P.z = 0.5;
  const z = EL.spawn('zombie', startX(), 0, 0.5), v = EL.spawn('villager', startX() + 8, 0, 0.5);
  z.persistent = v.persistent = true; z.vx = z.vy = z.vz = 0;
  const trace = [];
  let targeted = false;
  for (let t = 0; t < T; t++) {
    EL.tick();
    if (z.target === v) targeted = true;
    const zv = EL.list.find((e) => e.type === 'zombie_villager' && !e.removed);
    if (zv) { trace.push({ type: zv.type, id: zv.id, tick: t + 1 }); break; }
  }
  return { trace, targeted, villagerGone: !!v.removed || !!v.dead };
}
const key = (R) => JSON.stringify(R.trace);

for (const s of SALTS) {
  const a = run(s, 'hard'), b = run(s, 'hard');
  ok(a.targeted, `salt ${s}: zombie never targeted the villager`);
  ok(a.trace.length === 1 && a.trace[0].type === 'zombie_villager', `salt ${s}: no zombie_villager appeared`);
  ok(key(a) === key(b), `salt ${s}: not deterministic`);
  ok(a.villagerGone, `salt ${s}: villager survived`);
}
const hardKeys = SALTS.map((s) => key(run(s, 'hard')));
// breaks
const easy = run(0, 'easy');
caught(easy.trace.length === 0, 'easy must not convert');
{ const M = harness().M, Zv = M.ZVillager, o = Zv.convertVillagerToZombie; Zv.convertVillagerToZombie = () => null;
  caught(run(0, 'hard').trace.length === 0, 'conversion disabled -> no zombie_villager'); Zv.convertVillagerToZombie = o; }
{ const M = harness().M, o = M.Combat.mobAttack; M.Combat.mobAttack = () => null;
  const R = run(0, 'hard'); M.Combat.mobAttack = o;
  caught(R.trace.length === 0, 'zombie never lands a hit -> no zombie_villager'); }
console.log(`lockstep-zombievillager-engine: ${5 * 4 + 3 - bad} assertions, ${bad} failures, ${breaks} breaks caught`);
process.exit(bad ? 1 : 0);
