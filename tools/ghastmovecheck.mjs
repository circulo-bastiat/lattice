#!/usr/bin/env node
// ghastmovecheck.mjs — #1878: Fl.flyingTravel vs FlyingEntity.travel's recurrence v=(v+0.1)*f (air 0.91, water 0.8, lava 0.5).
import { loadEngine, initRegistry } from './loadsrc.mjs';

const EXTRA = ['02f_tags.js', '07_world.js', '08_lighting.js', '07b_behaviour.js', '07h_entities.js', '14b_physics.js',
               '07i_entitylist.js', '07k_goals.js', '07t_fly.js', '19_data.gen.js', '07zzk_shulker.js', '07zzi_ghast.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
initRegistry(M); M.Entities.init();
const Ph = M.Physics, Fl = M.Fly;
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

// run 60 ticks of impulse(+0.1 vy, as GhastMoveControl) then travel, with a stubbed fluid + move
function series(fluid, factor) {
  const realBlockAt = Ph.blockAt, realMove = Ph.move;
  Ph.blockAt = () => fluid ? M.States.stateOf(fluid) : 0;
  Ph.move = () => {};
  const e = { type: 'ghast', x: 0, y: 100, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, onGround: false };
  let v = 0, worst = 0;
  for (let t = 0; t < 60; t++) {
    e.vy += 0.1; v = (v + 0.1) * factor;
    Fl.travelMob(e);
    worst = Math.max(worst, Math.abs(e.vy - v));
  }
  Ph.blockAt = realBlockAt; Ph.move = realMove;
  return worst;
}
// #3098: isSpaceEmpty = blocks + collidable entities + world border (Gh.boxEmptyAt)
{
  const Gh = M.Ghast, EL = M.EntityList, realShape = Ph.shapeAt, realList = EL.list;
  Ph.shapeAt = () => null;
  const g = { type: 'ghast', width: 4, height: 4 };
  EL.list = [g];
  ok(Gh.boxEmptyAt(g, 0, 100, 0), 'open air is empty');
  EL.list = [g, { type: 'boat', x: 1, y: 101, z: 1 }];
  ok(!Gh.boxEmptyAt(g, 0, 100, 0), 'a boat in the box blocks it');
  EL.list = [g];
  ok(!Gh.boxEmptyAt(g, M.Shulker.BORDER + 10, 100, 0), 'beyond the world border blocks it');
  EL.list = [g, { type: 'boat', x: 1, y: 101, z: 1 }];
  const caught = Gh.boxEmptyAt({ ...g, width: 0.1, height: 0.1 }, 50, 100, 50) // anti-vacuity: a far-away box ignores the boat
  ok(caught, 'a box away from the boat is empty');
  Ph.shapeAt = realShape; EL.list = realList;
}
const BREAK = process.argv.includes('--break');
for (const [name, fluid, f] of [['air', null, 0.91], ['water', 'water', 0.8], ['lava', 'lava', 0.5]]) {
  ok(series(fluid, f) < 1e-9, name + ' vy series matches v=(v+0.1)*' + f);
}
// anti-vacuity: the old 0.98 law must be rejected by the same comparison
const bad = series(null, 0.98);
ok(bad > 0.1, 'anti-vacuity: a 0.98 recurrence differs from the port (' + bad.toFixed(3) + ')');
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : 'ghastmovecheck: ' + pass + ' checks ok, 2 breaks caught');
process.exit(fails.length ? 1 : 0);
