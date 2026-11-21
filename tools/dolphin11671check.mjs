#!/usr/bin/env node
// #11671: proves BreatheAirGoal, ChaseBoatGoal(+ChaseBoatState), MoveIntoWaterGoal, SwimAroundGoal (07zj2_dolphin.js)
// are reached from Ai.ROSTER.dolphin -> Dolphin.buildGoals and that their rules matter (cut a rule -> a scenario differs).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const rd = (f) => readFileSync(join(ROOT, 'src', f), 'utf8');
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL ' + m); } };
ok(/dolphin:\s*function \(e, ctx\) \{ return NS\.Dolphin\.buildGoals/.test(rd('07k_goals.js')), 'reach: ROSTER.dolphin -> buildGoals');
function scenario(edit) {
  const log = [];
  let s = rd('07zj2_dolphin.js');
  if (edit) { if (!s.includes(edit[0])) throw new Error('missing ' + edit[0]); s = s.replace(edit[0], edit[1]); }
  const blocks = new Map(); const set = (x, y, z, v) => blocks.set(x + ',' + y + ',' + z, v);
  const Player = { x: 0.5, y: 5, z: 0.5, yaw: 0, vehicle: null };
  const boat = { type: 'boat', x: 0.5, y: 5, z: 0.5, rider: Player };
  Player.vehicle = boat; boat.riderInput = { forwardSpeed: 1 };
  let rv = 0;
  const NS = {
    World: { getBlock: (x, y, z) => blocks.has(x + ',' + y + ',' + z) ? blocks.get(x + ',' + y + ',' + z) : 0 },
    States: { block: new Proxy({}, { get: (_, k) => +k }), waterIn: new Proxy({}, { get: (_, k) => k == 2 }), isAir: new Proxy({}, { get: (_, k) => k == 0 }) },
    Reg: { id: { water: 2, bubble_column: 9, lava: 3 } },
    Physics: { solidAt: (x, y, z) => blocks.get(x + ',' + y + ',' + z) === 1, move() {} },
    EntityList: { list: [boat], random: () => rv },
    Player,
    Fish: { fuzzFind: () => ({ x: 7, y: 8, z: 9 }) },
    Ai: {
      MOVE: 1, LOOK: 2, JUMP: 4, TARGET: 8,
      swimNavigate: () => null,
      findPath: (x, y, z, tx, ty, tz) => { log.push('path' + [tx, ty, tz].join('/')); return [{}, {}]; },
      stepToward() {}, advancePathNode: (e, p, i) => i, rotlerp: (a) => a,
      GoalSelector: function () { this.add = (p, f, g) => log.push('add' + p + ':' + (g.constructor === Object ? '' : '') + (g.chance !== undefined ? 'wander' : '')); },
    },
  };
  for (const n of ['RandomLookAroundGoal', 'LookAtPlayerGoal', 'MeleeAttackGoal', 'AvoidEntityGoal', 'RevengeGoal']) NS.Ai[n] = function () {};
  new Function('MCL', s)(NS);
  const D = NS.Dolphin;
  const e = { x: 0.5, y: 5, z: 0.5, yaw: 0, air: 100, onGround: true };
  // BreatheAir: air cell at y+3
  for (let y = 5; y <= 8; y++) set(0, y, 0, 2); set(0, 9, 0, 0);
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) for (let y = 5; y <= 8; y++) set(x, y, z, 2);
  const b = new D.BreatheAirGoal(e);
  log.push('b' + b.canUse() + b.canStop()); b.start(); e.air = 200; log.push('b' + b.canUse());
  // MoveIntoWater: water at (1,4,0)
  set(1, 4, 0, 2); set(0, 5, 0, 0); set(0, 4, 0, 1);
  const m = new D.MoveIntoWaterGoal(e); log.push('m' + m.canUse()); m.start(); log.push('m' + JSON.stringify(e.dolMoveTo));
  set(0, 5, 0, 2); log.push('m' + m.canUse()); set(0, 5, 0, 0); e.onGround = false; log.push('m' + m.canUse()); e.onGround = true; set(0, 5, 0, 2);
  // SwimAround
  const sw = new D.SwimAroundGoal(e, 1.0, 10);
  rv = 0; log.push('s' + sw.canUse()); sw.start(); log.push('s' + !!e.dolPath);
  rv = 0.5; log.push('s' + sw.canUse());
  rv = 0; e.passenger = {}; log.push('s' + sw.canUse()); e.passenger = null; e.despawnCounter = 100; log.push('s' + sw.canUse()); e.despawnCounter = 0;
  sw.stop(); log.push('s' + e.dolPath);
  // ChaseBoat (ChaseBoatState GO_TO_BOAT -> CIRCLE)
  const c = new D.ChaseBoatGoal(e); log.push('c' + c.canUse());
  c.start(); e.x = 40.5; c.tick(); log.push('cd' + c.canContinueToUse());
  e.x = 2.5; c.tick(); for (let i = 0; i < 12; i++) c.tick();
  e.x = 20.5; for (let i = 0; i < 12; i++) c.tick();
  boat.riderInput = {}; log.push('c' + c.canUse()); log.push('cd' + c.canContinueToUse());
  boat.riderInput = { forwardSpeed: 1 }; boat.x = 99; log.push('c' + c.canUse());
  c.stop(); log.push('c' + c.canUse());
  // buildGoals wiring
  D.buildGoals(e, { random: () => 0.5 });
  return log.join(',');
}
const base = scenario();
const breaks = [
  [['return e.air < 140; };', 'return e.air < 100; };'], 'breathe threshold'],
  [['this.canStop = function () { return false; };   // vanilla canStop() == false\n    function go()', 'function go()'], 'breathe canStop'],
  [['var y0 = Math.floor(e.y), y1 = Math.floor(e.y + 8)', 'var y0 = Math.floor(e.y), y1 = Math.floor(e.y + 1)'], 'breathe search range'],
  [['moveTo(e, t.x, t.y + 1, t.z, 1.0);\n    }\n    this.canUse', 'moveTo(e, t.x, t.y, t.z, 1.0);\n    }\n    this.canUse'], 'breathe target offset'],
  [['return !!e.onGround && !waterAt(e.x, e.y, e.z); };\n    this.canContinueToUse', 'return !waterAt(e.x, e.y, e.z); };\n    this.canContinueToUse'], 'water onGround'],
  [['return !!e.onGround && !waterAt(e.x, e.y, e.z); };', 'return !!e.onGround; };'], 'water not-in-water'],
  [['if (waterAt(x, y, z)) { t = { x: x, y: y, z: z }; break; }', 'if (false) { t = { x: x, y: y, z: z }; break; }'], 'water search'],
  [['if (e.passenger) return false;\n      if ((e.despawnCounter', 'if ((e.despawnCounter'], 'swim passenger'],
  [['if ((e.despawnCounter | 0) >= 100) return false;', ''], 'swim despawn'],
  [['if (rint(chance) !== 0) return false;', ''], 'swim chance'],
  [['this.stop = function () { stopNav(e); };\n    this.tick = function () {};\n  };\n  Dol.SwimWithPlayerGoal', 'this.stop = function () {};\n    this.tick = function () {};\n  };\n  Dol.SwimWithPlayerGoal'], 'swim stop'],
  [['Math.abs(b.x - e.x) <= 5.3', 'Math.abs(b.x - e.x) <= 500'], 'boat range'],
  [['if (d < 4) { cd = 0; state = 1; }', ''], 'boat state go->circle'],
  [['if (d > 12) { cd = 0; state = 0; }', ''], 'boat state circle->go'],
  [['return !!pass && !!NS.Player && !!NS.Player.vehicle && moving(pass); };', 'return true; };'], 'boat continue'],
  [['this.stop = function () { pass = null; };', 'this.stop = function () {};'], 'boat stop'],
  [['gs.add(8, 0, new Dol.ChaseBoatGoal(e));', ''], 'boat not registered'],
  [['gs.add(0, Ai.MOVE | Ai.LOOK, new Dol.BreatheAirGoal(e));', ''], 'breathe not registered'],
  [['gs.add(0, 0, new Dol.MoveIntoWaterGoal(e));', ''], 'water not registered'],
  [['gs.add(4, Ai.MOVE, new Dol.SwimAroundGoal(e, 1.0, 10));', ''], 'swim not registered'],
];
let caught = 0;
for (const [ed, name] of breaks) {
  let got; try { got = scenario(ed); } catch (e) { got = 'throw ' + e.message; }
  if (got !== base) caught++; else { fails++; console.log('NOT CAUGHT ' + name); }
}
console.log(`dolphin11671check -- ${fails ? fails + ' FAIL' : 'ok'}; ${caught} breaks caught`);
process.exit(fails || caught !== breaks.length ? 1 : 0);
