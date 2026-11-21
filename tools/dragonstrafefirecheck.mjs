#!/usr/bin/env node
// #4342: StrafePlayerPhase fires a DragonFireball after 5 seen ticks with the target in the aim cone.
import { loadEngine } from './loadsrc.mjs';
let fails = 0, caught = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  x ' + m); } };
const brk = (c, m) => { if (c) { caught++; console.log('  ✓ anti-vacuity: ' + m); } else { fails++; console.log('  x break NOT caught: ' + m); } };

function run(seen, tgtX, ticks) {
  const M = loadEngine({ extra: ['07_world.js', '07h_entities.js', '07zzl_enderdragon.js', '07c_blockentity.js'] });
  const spawns = [];
  if (M.BlockEntities) M.BlockEntities.eventLog = spawns.ev = [];
  const d = new M.EnderDragon.EnderDragonEntity({ world: { spawnEntity: (t, x, y, z, o) => spawns.push({ t, x, y, z, o }), isAir: () => true, canSee: () => seen } });
  const ph = new M.EnderDragon.StrafePlayerPhase(d);
  d.setPosition ? d.setPosition(0, 80, 0) : (d.x = 0, d.y = 80, d.z = 0);
  d.yaw = 0;                       // facing +? : (sin0, -cos0) = -z
  ph.target = { x: tgtX, y: 80, z: -30, height: 1.8 };
  ph.pathTarget = { x: 0, y: 80, z: -60 };
  const log = [];
  for (let i = 0; i < ticks; i++) { ph.serverTick(); log.push(ph.seenTargetTimes); }
  return { spawns, ph, log, ev: spawns.ev };
}
{
  const r = run(true, 0, 6);
  ok(r.spawns.length === 1 && r.spawns[0].t === 'dragon_fireball', 'one dragon_fireball spawns by tick 6');
  ok(r.log.slice(0, 5).join() === '1,2,3,4,0', 'seenTargetTimes counts up then resets');
  const o = r.spawns[0] && r.spawns[0].o;
  ok(o && o.power[2] < 0 && o.shooter, 'aimed at the target (-z) with the dragon as shooter');
  ok(r.ev && r.ev.length === 1 && r.ev[0].id === 1017, 'exactly one world event 1017 per fireball');
  brk(run(true, 0, 4).ev.length === 0, 'no 1017 when seenTargetTimes < 5');
  brk(run(true, 100, 6).ev.length === 0, 'no 1017 outside the cone');
  brk(run(false, 0, 6).spawns.length === 0, 'unseen target never fires');
  brk(run(true, 100, 6).spawns.length === 0, 'target outside the aim cone never fires');
  brk(run(true, 0, 4).spawns.length === 0, 'fewer than 5 seen ticks never fires');
}
console.log(`dragonstrafefirecheck: ${9 - fails} checks passed, ${fails} failures, ${caught} breaks caught`);
process.exit(fails ? 1 : 0);
