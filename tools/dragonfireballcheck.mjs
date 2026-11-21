#!/usr/bin/env node
// #2756: EnderDragonEntity.world handle + DragonFireballEntity (spawns a dragon-breath cloud on impact).
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
let fails = 0, caught = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  x ' + m); } };
const brk = (c, m) => { if (c) { caught++; console.log('  ✓ anti-vacuity: ' + m); } else { fails++; console.log('  x break NOT caught: ' + m); } };

function fresh() {
  const M = loadEngine({ extra: ['07_world.js', '07h_entities.js', '14b_physics.js', '07k_goals.js', '07i_entitylist.js', '07z_potion.js', '07zzh_blaze.js', '07zzl_enderdragon.js', '07zx_particle.js'] });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
  M.Entities.init(); M.EntityList.init(); M.EnderDragon.init();
  return M;
}
function fire(M, breakIt) {
  const EL = M.EntityList; EL.clear();
  const f = EL.spawn('dragon_fireball', 0, 80, 0, { power: [1, 0, 0] });
  if (!f) return null;
  if (breakIt) M.EnderDragon.tickDragonFireball = function () {};
  M.Physics.solidAt = () => true;                      // block hit
  EL.tick(); EL.tick();                                // the hit is found in one tick, acted on in the next (referee: dfireball_wall)
  return { f, cloud: EL.list.find((e) => e.type === 'area_effect_cloud') };
}
{
  const M = fresh();
  const d = new M.EnderDragon.EnderDragonEntity({});
  ok(d.world && typeof d.world.spawnEntity === 'function' && typeof d.world.isAir === 'function' && typeof d.world.canSee === 'function', 'dragon has world.spawnEntity/isAir/canSee');
  M.Physics.solidAt = () => false;   // empty world
  const f = M.EntityList.spawn('dragon_fireball', 0, 80, 0, { power: [1, 0, 0] });
  ok(!!f && M.EntityList.canSpawn('dragon_fireball'), 'dragon_fireball spawns');
  for (let i = 0; i < 3; i++) M.EntityList.tick(); 
  ok(f.vx > 0, 'fireball accelerates along its power vector');
  const r = fire(M, false);
  ok(r.f.removed && r.cloud, 'impact discards the fireball and spawns a cloud');
  ok(r.cloud && r.cloud.radius === 3 && r.cloud.duration === 600 && r.cloud.custom[0].effect === 'instant_damage' && r.cloud.custom[0].amplifier === 1, 'cloud is radius 3, 600 ticks, instant_damage II');
  // anti-vacuity: no tick hook -> no cloud
  const M2 = fresh();
  const r2 = fire(M2, true);
  brk(!(r2 && r2.cloud), 'without the tick hook no cloud spawns');
  const M3 = fresh(); delete M3.EnderDragon.defaultWorld.spawnEntity;
  brk(typeof new M3.EnderDragon.EnderDragonEntity({}).world.spawnEntity !== 'function', 'a world missing spawnEntity is detected');
}
// #6470: impact plays world event 2006 -- 200 dragon_breath + one explode sound, none when silent
{
  const run = (silent, brk) => {
    const M = fresh(); const EL = M.EntityList; EL.clear();
    const snd = []; M.Sound = { play: (n) => snd.push(n) };
    if (brk) M.Particle.worldEvent = () => 0;
    M.Particle.init(); M.Particle.list.length = 0; M.Particle.tally = {};
    const f = EL.spawn('dragon_fireball', 0, 80, 0, { power: [1, 0, 0] }); f.silent = silent;
    M.Physics.solidAt = () => true; EL.tick(); EL.tick();
    return { n: M.Particle.tally.dragon_breath | 0, snd: snd.filter((x) => x === 'entity.dragon_fireball.explode').length };
  };
  const a = run(false, false), b = run(true, false), c = run(false, true);
  ok(a.n === 200 && a.snd === 1, `impact: 200 particles + 1 sound (got ${a.n}, ${a.snd})`);
  ok(b.n === 200 && b.snd === 0, `silent: particles, no sound (got ${b.n}, ${b.snd})`);
  brk(c.n !== 200 && c.snd === 0, 'without the 2006 event the assertion fails');
  caught += 0;
}
console.log(`dragonfireballcheck: ${6 - fails} checks passed, ${fails} failures, ${caught} breaks caught`);
process.exit(fails ? 1 : 0);
