#!/usr/bin/env node
// spiderclimbcheck.mjs — #5308: SpiderEntity.tick -> setClimbingWall(horizontalCollision) after super.tick();
// onClimbable reads that synced flag, so climbing starts/ends one tick after the collision.
import { loadEngine } from './loadsrc.mjs';

const run = (broken) => {
  const MCL = loadEngine({ extra: ['14b_physics.js'], dom: false,
    patch: broken ? (f, s) => f === '14b_physics.js' ? s.replace('return !!e.climbingWall;', 'return !!e.horizontalCollision;') : s : undefined });
  const Ph = MCL.Phys || MCL.Physics, r = [];
  const e = { type: 'spider', x: 0.5, y: 64, z: 0.5, vx: 0, vy: 0, vz: 0, onGround: true, horizontalCollision: false };
  r.push([Ph.onClimbable(e) === false, 'default flag is false']);
  Ph.blockAt = () => 0;
  const origMove = Ph.move;
  let hit = false;
  Ph.move = (m) => { m.horizontalCollision = hit; };
  const tick = () => { try { Ph.travelMob(e, 0); } catch (x) { if (process.env.V) console.log(x.stack.split('\n').slice(0,3).join('\n')); } };
  hit = true; e.climbingWall = false;
  // the flag read inside travel (before the move) is the previous tick's
  tick(); r.push([e.climbingWall === true, 'flag set after the collision tick']);
  r.push([Ph.onClimbable({ type: 'spider', horizontalCollision: true, climbingWall: false }) === false, 'collision tick: not climbing yet']);
  hit = false; tick(); r.push([e.climbingWall === false, 'flag clears after leaving the wall']);
  Ph.move = origMove;
  return r;
};
const good = run(false); const fails = good.filter(c => !c[0]).map(c => c[1]);
let caught = 0;
if (run(true).some(c => !c[0])) caught++; else fails.push('break not caught');
if (fails.length) { console.log('FAIL ' + fails.join('; ')); process.exit(1); }
console.log(`spiderclimbcheck: ${good.length} checks, ${caught} breaks caught`);
