// lockstep-doorbreak -- #6780 (G17-L135): zombie/husk/drowned BreakDoorGoal on a closed wooden door, Easy/Normal/Hard, 20 salts.
// Reference = .decomp BreakDoorGoal.java (MIN_MAX_PROGRESS 240; canStart = DoorInteractGoal.canStart && doMobGriefing && difficulty==HARD && !isDoorOpen;
// tick: nextInt(20)==0 -> event 1019 + swing; breakProgress++; stage=(int)(progress/240*10) published on every change; progress==240 -> removeBlock +
// event 1021 (2001 reads the post-removal air state); shouldContinue: door within 2.0, not open, difficulty ok) and the GoalSelector start-then-tick order.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js', '07_world.js', '07l_spawn.js', '07k_goals.js'], dom: false, initReg: true });
void readFileSync; void join; void MCLITE_ROOT;
const cells = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
const w = { getBlock: (x, y, z) => cells.get(key(x, y, z)) || 0, setBlock: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); } };
M.World = Object.assign(M.World || {}, w);
M.Physics = Object.assign(M.Physics || {}, { blockAt: w.getBlock });
if (M.Behave && M.Behave.init) M.Behave.init(w);
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; if (fails < 25) console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const { Ai } = M;
function doorState(name, half) {
  const id = M.Reg.id[name], first = M.Reg.realFirst[id], n = M.Reg.realFirst[id + 1] - first;
  for (let s = first; s < first + n; s++) if (M.Behave.propName(s, 'open') === 'false' && M.Behave.propName(s, 'half') === half) return s;
  throw new Error('no state ' + name + ' ' + half);
}
const events = [];
M.Sound = { play: (ev) => events.push(ev) };
const MAX = 240;
function lane(c) {
  // ---- engine ----
  cells.clear(); events.length = 0;
  const door = c.door;
  cells.set(key(0, 1, 1), doorState(door, 'lower')); cells.set(key(0, 2, 1), doorState(door, 'upper'));
  const e = { type: c.mob, x: 0.5, y: 0, z: 0.5, navPath: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }], navIdx: 0, horizontalCollision: true, handSwinging: true };
  const rEng = stream(c.salt);
  M.EntityList = M.EntityList || {}; M.EntityList.randomOf = () => rEng;
  M.Diff.value = c.diff;
  const g = new Ai.BreakDoorGoal(e, { mobGriefing: () => c.grief, isHard: () => M.Diff.isHard() });
  // ---- reference ----
  const rRef = stream(c.salt); let rRunning = false, rProg = 0, rPrev = -1, rDoor = c.door === 'oak_door' || c.door === 'spruce_door' || c.door === 'birch_door';
  const rEv = [], rStage = [], eStage = [], eEv = [], rRemoved = [];
  let removedEng = -1, removedRef = -1, startedEng = -1, startedRef = -1, runEng = false;
  for (let t = 0; t < MAX + 40; t++) {
    // engine: GoalSelector order
    const before = events.length, cb = e.doorCrack;
    if (!runEng) { if (g.canUse()) { g.start(); runEng = true; if (startedEng < 0) startedEng = t; } }
    else if (!g.canContinueToUse()) { g.stop(); runEng = false; }
    if (runEng) g.tick();
    if (e.doorCrack !== cb && e.doorCrack !== undefined) eStage.push(t + ':' + e.doorCrack);
    for (let i = before; i < events.length; i++) eEv.push(t + ':' + events[i]);
    if (removedEng < 0 && !cells.has(key(0, 1, 1))) removedEng = t;
    // reference
    const hard = c.diff === 'hard', present = rRemoved.length === 0 && rDoor;
    if (!rRunning) { if (c.grief && hard && present) { rRunning = true; rProg = 0; rPrev = -1; if (startedRef < 0) startedRef = t; } }
    else if (!(rProg <= MAX && present && hard)) { rRunning = false; rStage.push(t + ':-1'); }
    if (rRunning) {
      if (Math.floor(rRef() * 20) === 0) { rEv.push(t + ':entity.zombie.attack_wooden_door'); rRef(); rRef(); }
      rProg++;
      const st = Math.floor(rProg / MAX * 10);
      if (st !== rPrev) { rStage.push(t + ':' + st); rPrev = st; }
      if (rProg === MAX) { rRemoved.push(t); removedRef = t; rEv.push(t + ':entity.zombie.break_wooden_door'); rRef(); rRef(); }
    }
  }
  const bad = [];
  if (startedEng !== startedRef) bad.push(`start tick ${startedEng} vs ${startedRef}`);
  if (removedEng !== removedRef) bad.push(`door removed at ${removedEng} vs ${removedRef}`);
  if (eStage.join() !== rStage.join()) bad.push(`stages ${eStage.slice(0, 12)} vs ${rStage.slice(0, 12)}`);
  if (eEv.join() !== rEv.join()) bad.push(`events ${eEv.slice(0, 5)} vs ${rEv.slice(0, 5)}`);
  if (removedRef >= 0 && (cells.has(key(0, 2, 1)))) bad.push('upper half left behind');
  if (removedRef >= 0 && runEng) bad.push('goal still running after removal (navigation not released)');
  return bad.join('; ') || null;
}
function run() {
  let n = 0, bad = null;
  for (let s = 0; s < 20 && !bad; s++) {
    for (const mob of ['zombie', 'husk', 'drowned']) for (const diff of ['easy', 'normal', 'hard']) for (const door of ['oak_door', 'iron_door']) {
      const b = lane({ salt: s * 7 + mob.length, mob, diff, door, grief: true }); n++;
      if (b) { bad = `salt ${s} ${mob} ${diff} ${door}: ${b}`; break; }
    }
    if (!bad) { const b = lane({ salt: s, mob: 'zombie', diff: 'hard', door: 'oak_door', grief: false }); n++; if (b) bad = `salt ${s} mobGriefing off: ${b}`; }
  }
  return { bad, n };
}
const base = run(); ok(!base.bad, base.bad); ok(base.n === 20 * 19, 'lanes ' + base.n);
// sanity: the hard wooden lane really breaks the door at tick 239 (240 ticks of progress, started tick 0)
{ const probe = lane({ salt: 1, mob: 'zombie', diff: 'hard', door: 'oak_door', grief: true }); ok(!probe && cells.size === 0, 'hard oak lane removes the door'); }
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
{ const o = M.Diff.isHard; M.Diff.isHard = () => M.Diff.value === 'hard' || M.Diff.value === 'normal'; brk(!!run().bad, 'Hard gate -> Normal'); M.Diff.isHard = o; }
{ const o = Ai.DOOR_BREAK_TICKS; Ai.DOOR_BREAK_TICKS = 200; brk(!!run().bad, 'progress constant 240 -> 200'); Ai.DOOR_BREAK_TICKS = o; }
{ const o = Ai.doorAt; Ai.doorAt = (...a) => { const d = o(...a); if (d) d.iron = false; return d; }; brk(!!run().bad, 'iron door treated as wooden'); Ai.doorAt = o; }
{ const o = Ai.breakDoor; Ai.breakDoor = (x, y, z, e) => { M.World.setBlock(x, y, z, 0); return true; }; brk(!!run().bad, 'upper half not removed'); Ai.breakDoor = o; }
{ const o = Ai.doorEvent; Ai.doorEvent = (e, ev, ...r) => o(e, ev === 'entity.zombie.break_wooden_door' ? 'entity.zombie.attack_wooden_door' : ev, ...r); brk(!!run().bad, 'break sound id swapped'); Ai.doorEvent = o; }
console.log(`lockstep-doorbreak: ${base.n} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
