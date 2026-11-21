#!/usr/bin/env node
// explosionparticlecheck.mjs -- #5253: Explosion.affectWorld(true)'s particle (explosion_emitter when power>=2 and
// blocks are destroyed, else explosion) and ExplosionEmitterParticle's 6 children/tick over 8 ticks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
               '07e_loot.js', '07h_entities.js', '14b_physics.js', '14c_raycast.js',
               '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
               '14j_combat.js', '07za_explosion.js', '07zx_particle.js', '07zzl_enderdragon.js', '07zzn_endcrystal.js', '07zzt_armorstand.js'];

function freshEngine() {
  const M = loadEngine({ extra: EXTRA, dom: false });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
  const W = M.World, CH = M.CH, S = M.States;
  M.Behave.init(W);
  M.Entities.init();
  M.EntityList.init();
  M.Ai.init();
  M.Spawn.init();
  M.Combat.init();
  M.Explosion.init();
  M.EnderDragon.init();
  M.EndCrystal.init();
  W.init(1);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
    const c = W.makeChunk(cx, cz);
    c.state = CH.GENERATED;
    W.chunks.set(W.key(cx, cz), c);
  }
  return M;
}


let fail = 0, breaks = 0;
const ok = (c, m) => { if (!c) { console.log('x ' + m); fail++; } };
function run(power, griefing, mutate) {
  const M = freshEngine();
  M.Particle.init();
  if (mutate) mutate(M);
  const log = [], orig = M.Particle.spawn;
  M.Particle.spawn = function (t) { log.push(t); return orig.apply(this, arguments); };
  M.Explosion.explode(null, 0.5, 70, 0.5, power, griefing);
  const first = log.slice();
  for (let i = 0; i < 30; i++) M.Particle.tick();
  return { first, all: log, left: M.Particle.list.length };
}
const count = (a, t) => a.filter((x) => x === t).length;
const tnt = run(4, true);
ok(tnt.first.length === 1 && tnt.first[0] === 'explosion_emitter', 'tnt: ' + tnt.first);
ok(count(tnt.all, 'explosion') === 48, 'emitter children ' + count(tnt.all, 'explosion'));
ok(tnt.left === 0, 'particles left ' + tnt.left);
ok(run(1, true).first.join() === 'explosion', 'power 1 not explosion');
ok(run(4, false).first.join() === 'explosion', 'mobGriefing false not explosion');
// anti-vacuity: break the explode hook (no particle) and the power gate
{
  const M = freshEngine(); M.Particle.init();
  const log = []; const o = M.Particle.spawn; M.Particle.spawn = function (t) { log.push(t); return o.apply(this, arguments); };
  M.Explosion.explode(null, 0.5, 70, 0.5, 4, true);
  breaks++; if (log.length !== 1) { console.log('x vacuous: baseline'); fail++; }
  const log2 = []; M.Particle.spawn = function (t) { log2.push(t); };
  M.Explosion.explode(null, 0.5, 70, 0.5, 1, true);
  breaks++; if (log2[0] === 'explosion_emitter') { console.log('x vacuous: power gate'); fail++; }
}
console.log(`${breaks} breaks caught, ${fail} failed`);
process.exit(fail ? 1 : 0);
