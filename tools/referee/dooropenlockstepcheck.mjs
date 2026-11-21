// lockstep-dooropen -- #7911 (G18b-L19): OpenDoorGoal/DoorInteractGoal vs an independent per-tick reference, 20 salts.
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
const TICKS = 90;
const openOf = (x, y, z) => M.Behave.propName(cells.get(key(x, y, z)) || 0, 'open') === 'true';
// A mover walks +z toward a door in cell z=1; a closed door/gate blocks (half-width 0.3), an open one lets it through.
// Trace per tick: position, horizontalCollision, doorInteractedAt, door open state, navIdx (node index = cells passed).
function lane(c) {
  cells.clear();
  const gate = c.door === 'oak_fence_gate';
  cells.set(key(0, 1, 1), closedState(c.door, gate ? undefined : 'lower'));
  if (!gate) cells.set(key(0, 2, 1), closedState(c.door, 'upper'));
  const rnd = stream(c.salt), speed = 0.05 + rnd() * 0.1;
  const e = { type: c.mob, x: 0.5, y: 0, z: 0.5, navPath: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 2 }, { x: 0, y: 0, z: 3 }], navIdx: 0, horizontalCollision: false, canEnterOpenDoors: true };
  const g = new Ai.OpenDoorGoal(e, {}, true);
  const refWood = c.door === 'oak_door';
  let running = false, refRun = false, left = 0, refOpen = false, refAt = '-', engAt = '-', refZ = 0.5;
  const eng = [], ref = [];
  const blocked = (z, open) => !open && z + 0.3 > 1 && z - 0.3 < 2;
  for (let t = 0; t < TICKS; t++) {
    // engine: move, then goal selector (stop-check else start, then tick)
    const nz = e.z + speed; e.horizontalCollision = blocked(nz, openOf(0, 1, 1)); if (!e.horizontalCollision) e.z = nz;
    e.navIdx = Math.min(4, Math.floor(e.z));
    if (!running) { if (g.canUse()) { g.start(); running = true; engAt = '0,2,1'; } }
    else if (!g.canContinueToUse()) { g.stop(); running = false; }
    if (running) g.tick();
    eng.push(e.z.toFixed(4) + '|' + e.horizontalCollision + '|' + engAt + '|' + openOf(0, 1, 1) + '|' + e.navIdx);
    // reference (.decomp DoorInteractGoal/OpenDoorGoal)
    const rcol = blocked(refZ + speed, refOpen); if (!rcol) refZ += speed;
    const idx = Math.min(4, Math.floor(refZ));
    const near = (() => {
      if (!rcol) return false;
      const lim = Math.min(idx + 2, 4);
      for (let i = 0; i < lim; i++) { const dz = i - refZ, dx = -0.5; if (i === 1 && dx * dx + dz * dz <= 2.25 && refWood) return true; }
      return refWood && Math.floor(refZ) === 1;
    })();
    if (!refRun) { if (near) { refRun = true; left = 20; refOpen = true; refAt = '0,2,1'; } }
    else if (!(left > 0)) { refRun = false; refOpen = false; }
    if (refRun) left--;
    ref.push(refZ.toFixed(4) + '|' + rcol + '|' + refAt + '|' + refOpen + '|' + idx);
  }
  const i = eng.findIndex((v, k) => v !== ref[k]);
  return i < 0 ? null : 'trace differs at tick ' + i + ': ' + eng[i] + ' vs ' + ref[i];
}
function run() {
  let n = 0, bad = null;
  for (let s = 0; s < 20 && !bad; s++) for (const mob of ['villager', 'zombie', 'iron_golem']) for (const door of ['oak_door', 'iron_door', 'oak_fence_gate']) {
    const b = lane({ salt: s * 11 + mob.length, mob, door }); n++;
    if (b && !bad) bad = `salt ${s} ${mob} ${door}: ${b}`;
  }
  return { bad, n };
}
const base = run(); ok(!base.bad, base.bad); ok(base.n === 20 * 9, 'lanes ' + base.n);
{ const p = lane({ salt: 3, mob: 'villager', door: 'oak_door' }); ok(!p, 'probe'); }
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
{ const o = Ai.doorAt; Ai.doorAt = (...a) => { const d = o(...a); if (d) { d.iron = false; d.wood = true; } return d; }; brk(!!run().bad, 'iron door made openable'); Ai.doorAt = o; }
{ const o = Ai.OpenDoorGoal; Ai.OpenDoorGoal = function (e, c, d) { return new o(e, c, false); }; brk(!!run().bad, 'close delay removed'); Ai.OpenDoorGoal = o; }
{ const o = Ai.setDoorOpen; Ai.setDoorOpen = (x, y, z, op) => o(x, y, z, true); brk(!!run().bad, 'door never closes'); Ai.setDoorOpen = o; }
{ const o = Ai.setDoorOpen; Ai.setDoorOpen = (x, y, z, op) => { if (!op) o(x, y, z, false); }; brk(!!run().bad, 'door never opens'); Ai.setDoorOpen = o; }
console.log(`lockstep-dooropen: ${base.n} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
