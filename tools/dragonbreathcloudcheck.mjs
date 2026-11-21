#!/usr/bin/env node
// #4343: SittingFlamingPhase spawns the dragon-breath area_effect_cloud at tick 10 (radius 5, duration 200).
import { loadEngine } from './loadsrc.mjs';
let fails = 0, caught = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  x ' + m); } };
const brk = (c, m) => { if (c) { caught++; console.log('  ✓ anti-vacuity: ' + m); } else { fails++; console.log('  x break NOT caught: ' + m); } };
function run(ticks, endEarly) {
  const M = loadEngine({ extra: ['07_world.js', '07h_entities.js', '07zzl_enderdragon.js'] });
  const spawns = [];
  const d = new M.EnderDragon.EnderDragonEntity({ world: { spawnEntity: (t, x, y, z, o) => { const e = { t, x, y, z, o }; spawns.push(e); return e; }, isAir: (x, y) => y > 64, canSee: () => false } });
  const ph = new M.EnderDragon.SittingFlamingPhase(d);
  d.x = 0; d.y = 70; d.z = 0; d.head.x = 0; d.head.y = 70; d.head.z = 5;
  for (let i = 0; i < ticks; i++) ph.serverTick();
  if (endEarly) ph.endPhase();
  return { spawns, ph };
}
{
  const r = run(10);
  const c = r.spawns[0];
  ok(r.spawns.length === 1 && c.t === 'area_effect_cloud', 'one area_effect_cloud after 10 ticks');
  ok(c && c.o.radius === 5 && c.o.duration === 200 && c.o.custom[0].effect === 'instant_damage', 'radius 5, duration 200, instant damage');
  ok(c && c.y === 64, 'cloud sits on the top of the solid block (y 63)');
  const e = run(10, true);
  ok(e.spawns[0].removed === true, 'endPhase discards the cloud');
  brk(run(9).spawns.length === 0, 'no cloud before tick 10');
  brk(run(30).spawns.length === 1, 'cloud spawns only once');
}
console.log(`dragonbreathcloudcheck: ${6 - fails} checks passed, ${fails} failures, ${caught} breaks caught`);
process.exit(fails ? 1 : 0);
