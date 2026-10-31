// lockstep-opendoor -- #7031 (G18b-L5): OpenDoorGoal/DoorInteractGoal vs an independent per-tick reference, 20 salts.
// Reference = .decomp DoorInteractGoal.canStart (first min(idx+2,len) path nodes, door at node.y+1, dist^2 <= 2.25, then the block above the feet;
// wooden doors only, iron refused, 1.18.2 has no gate handling) + OpenDoorGoal (start: ticksLeft=20, open; shouldContinue = delayedClose && ticksLeft>0;
// stop: close) + the GoalSelector order (stop-check, else start, then tick) + canEnterOpenDoors. Compared per tick: door open state (both halves), tick of change.
import { loadEngine } from '../loadsrc.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js', '07_world.js', '07l_spawn.js', '07k_goals.js'], dom: false, initReg: true });
const cells = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
const w = { getBlock: (x, y, z) => cells.get(key(x, y, z)) || 0, setBlock: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); } };
M.World = Object.assign(M.World || {}, w);
M.Physics = Object.assign(M.Physics || {}, { blockAt: w.getBlock });
if (M.Behave && M.Behave.init) M.Behave.init(w);
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; if (fails < 25) console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const { Ai } = M;
function closedState(name, half) {
  const id = M.Reg.id[name], first = M.Reg.realFirst[id], n = M.Reg.realFirst[id + 1] - first;
  for (let s = first; s < first + n; s++) if (M.Behave.propName(s, 'open') === 'false' && (half === undefined || M.Behave.propName(s, 'half') === half)) return s;
  throw new Error('no state ' + name);
}
const TICKS = 80;
const openOf = (x, y, z) => M.Behave.propName(cells.get(key(x, y, z)) || 0, 'open') === 'true';
function lane(c) {
  cells.clear();
  const gate = c.door === 'oak_fence_gate';
  cells.set(key(0, 1, 1), closedState(c.door, gate ? undefined : 'lower'));
  if (!gate) cells.set(key(0, 2, 1), closedState(c.door, 'upper'));
  const rnd = stream(c.salt), t0 = 2 + Math.floor(rnd() * 5), span = 1 + Math.floor(rnd() * 12), speed = 0.05 + rnd() * 0.1;
  const e = { type: c.mob, x: 0.5, y: 0, z: 0.5, navPath: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 2 }], navIdx: 0, horizontalCollision: false, canEnterOpenDoors: c.canEnter };
  const g = new Ai.OpenDoorGoal(e, {}, c.delayed);
  const refWood = c.door === 'oak_door' || c.door === 'birch_door' || c.door === 'spruce_door';
  let running = false, refRun = false, left = 0, refOpen = false;
  const eng = [], ref = [];
  for (let t = 0; t < TICKS; t++) {
    const inWin = t >= t0 && t < t0 + span;
    e.horizontalCollision = inWin; e.z = 0.5 + (inWin ? (t - t0) * speed * 0.2 : 0); e.navIdx = inWin && e.z > 1.0 ? 1 : 0;
    // engine
    if (!running) { if (g.canUse()) { g.start(); running = true; } }
    else if (!g.canContinueToUse()) { g.stop(); running = false; }
    if (running) g.tick();
    eng.push(openOf(0, 1, 1) + '/' + (gate ? '-' : openOf(0, 2, 1)));
    // reference
    const near = (() => {
      if (!e.horizontalCollision || c.canEnter === false) return false;
      const lim = Math.min(e.navIdx + 2, 3);
      for (let i = 0; i < lim; i++) { const dz = i - e.z, dx = -e.x; if (i === 1 && dx * dx + dz * dz <= 2.25 && refWood) return true; }
      return refWood && Math.floor(e.z) === 1;
    })();
    if (!refRun) { if (near) { refRun = true; left = 20; refOpen = true; } }
    else if (!(c.delayed && left > 0)) { refRun = false; refOpen = false; }
    if (refRun) left--;
    ref.push(refOpen + '/' + (gate ? '-' : refOpen));
  }
  return eng.join() === ref.join() ? null : 'door timeline differs: ' + eng.findIndex((v, i) => v !== ref[i]) + ' ' + eng.join(' ').slice(0, 60);
}
function run() {
  let n = 0, bad = null;
  for (let s = 0; s < 20 && !bad; s++) for (const mob of ['vindicator', 'villager', 'iron_golem', 'cow']) for (const door of ['oak_door', 'iron_door', 'oak_fence_gate']) for (const delayed of [true, false]) for (const canEnter of [true, false]) {
    const b = lane({ salt: s * 11 + mob.length, mob, door, delayed, canEnter }); n++;
    if (b && !bad) bad = `salt ${s} ${mob} ${door} delayed=${delayed} canEnter=${canEnter}: ${b}`;
  }
  return { bad, n };
}
const base = run(); ok(!base.bad, base.bad); ok(base.n === 20 * 48, 'lanes ' + base.n);
{ const p = lane({ salt: 3, mob: 'cow', door: 'oak_door', delayed: true, canEnter: true }); ok(!p, 'probe'); }
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
{ const o = Ai.doorAt; Ai.doorAt = (...a) => { const d = o(...a); if (d) { d.iron = false; d.wood = true; } return d; }; brk(!!run().bad, 'iron door made openable'); Ai.doorAt = o; }
{ const o = Ai.OpenDoorGoal; Ai.OpenDoorGoal = function (e, c, d) { return new o(e, c, false); }; brk(!!run().bad, 'closeDoor delay skipped'); Ai.OpenDoorGoal = o; }
{ const o = Ai.OpenDoorGoal; Ai.OpenDoorGoal = function (e, c, d) { return new o(e, c, true); }; brk(!!run().bad, 'close forced delayed'); Ai.OpenDoorGoal = o; }
{ const o = Ai.setDoorOpen; Ai.setDoorOpen = (x, y, z, op) => o(x, y, z, true); brk(!!run().bad, 'door never closes'); Ai.setDoorOpen = o; }
console.log(`lockstep-opendoor: ${base.n} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
