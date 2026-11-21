#!/usr/bin/env node
// #11670: proves Task (07zzzb_brain.js) is reached via Brain.tick (startTasks/updateTasks) from the real axolotl brain
// (07zzze_axolotlidle.js makeBrain -> Task subclasses) and that its rules matter.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const rd = (f) => readFileSync(join(ROOT, 'src', f), 'utf8');
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL ' + m); } };
ok(/B\.Task|Brain\.Task/.test(rd('07zzze_axolotlidle.js')) && /Task\.call\(/.test(rd('07zzze_axolotlidle.js')), 'reach: axolotlidle subclasses Task');
function scenario(edit) {
  const NS = {}; globalThis.MCL = NS;
  let s = rd('07zzzb_brain.js');
  if (edit) { if (!s.includes(edit[0])) throw new Error('missing ' + edit[0]); s = s.replace(edit[0], edit[1]); }
  new Function('MCL', s)(NS);
  const B = NS.Brain, log = [];
  const world = { time: 100, random: { nextInt: (n) => { log.push('r' + n); return 1; } } };
  function T(req, min, max) { B.Task.call(this, req, min, max); }
  T.prototype = Object.create(B.Task.prototype);
  T.prototype.run = () => log.push('run'); T.prototype.keepRunning = () => log.push('keep');
  T.prototype.finishRunning = () => log.push('fin'); T.prototype.shouldKeepRunning = () => true;
  const mem = { id: 'm' };
  const br = new B.Brain([]); br.registerMemory(mem);
  const t = new T({ [mem.id]: B.VALUE_PRESENT }, 2, 5);
  br.setTaskList(B.IDLE, 0, [t], [], []); br.resetPossibleActivities(B.IDLE);
  const u = new T({}, 1, 1); u.shouldRun = () => false; u.run = () => log.push('U'); br.setTaskList(B.IDLE, 1, [u], [], []);
  const e = { brain: br };
  br.tick(world, e); log.push('st' + t.status);       // memory absent -> no start
  br.remember(mem.id, 1);
  br.tick(world, e); log.push('st' + t.status + 'end' + t.endTime); // starts, end=100+2+1
  world.time = 103; br.tick(world, e);  // not exceeded (103>103 false) keep
  world.time = 104; br.tick(world, e);  // exceeded -> stop
  log.push('st' + t.status);
  const w = new B.WaitTask(3, 3); log.push('w' + w.shouldKeepRunning() + w.minRunTime);
  const d = new B.Task(); log.push('d' + d.minRunTime + d.maxRunTime + d.shouldRun() + d.shouldKeepRunning());
  return log.join(',');
}
const base = scenario();
ok(base.startsWith('st0,r4,run,keep,st1end103'), 'start sequence');
const breaks = [
  [['if (!br.isMemoryInState(k, this.required[k])) return false;', ''], 'required memories ignored'],
  [['if (!this.shouldRun(world, e)) return false;', ''], 'shouldRun ignored'],
  [['t + this.minRunTime + world.random.nextInt(this.maxRunTime + 1 - this.minRunTime)', 't + this.minRunTime'], 'no random draw'],
  [['return t > this.endTime;', 'return t >= this.endTime;'], 'time limit boundary'],
  [['this.status = B.STOPPED; this.finishRunning', 'this.finishRunning'], 'stop keeps status'],
  [['if (!this.isTimeLimitExceeded(t) && this.shouldKeepRunning(world, e, t))', 'if (this.shouldKeepRunning(world, e, t))'], 'time limit ignored'],
  [['if (maxRun === undefined) maxRun = minRun;', 'if (maxRun === undefined) maxRun = 0;'], 'max default'],
];
let caught = 0;
for (const [ed, name] of breaks) {
  let got; try { got = scenario(ed); } catch (e) { got = 'throw'; }
  if (got !== base) caught++; else { fails++; console.log('NOT CAUGHT ' + name); }
}
console.log(`brain11670check -- ${fails ? fails + ' FAIL' : 'ok'}; ${caught} breaks caught`);
process.exit(fails || caught !== breaks.length ? 1 : 0);
