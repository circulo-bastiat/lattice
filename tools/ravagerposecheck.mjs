#!/usr/bin/env node
// ravagerposecheck.mjs -- #1023: RavagerEntity.spawnStunnedParticles (the model pose is #843's ER.ravagerDelta).
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { loadEngine, initRegistry, MCLITE_ROOT, ASSETS } from './loadsrc.mjs';
import { join } from 'node:path';

const VERBOSE = process.argv.includes('--verbose');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c && VERBOSE) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };


const M = loadEngine({
  extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
          '07w_passive.js', '07r_mount.js', '07ze_llama.js', '07zt_wtrader.js',
          '07v_spell.js', '07zx_particle.js', '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js'],
  dom: false
});
initRegistry(M);
{
  const mm = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'models.meta.json'), 'utf8'));
  M.BEModel.init({ models: readFileSync(join(MCLITE_ROOT, 'assets', 'models.bin')).toString('base64'),
                    modelsBytes: mm.rawBytes });
}
const mobGeomRaw = readFileSync(join(MCLITE_ROOT, 'assets', 'mob-geometry.json'));
M.DATA = Object.assign({}, M.DATA, {
  mobGeometry: deflateRawSync(mobGeomRaw, { level: 9 }).toString('base64'),
  mobGeometryBytes: mobGeomRaw.length,
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8'))
});
M.Entities.init();
M.EntityList.init();
M.EntityRender.init();
const ER = M.EntityRender;


const EL = M.EntityList, Px = M.Particle;
const near = (a, b) => Math.abs(a - b) < 1e-5;
ok(ER.ready, 'renderer up');
// the model pose (neck lunge, jaw, stun wobble, roar, legs) is ER.ravagerDelta from #843 and has its own check;
// this check keeps only what #1023 adds: RavagerEntity.spawnStunnedParticles.
// stun particles
{
  Px.list.length = 0; EL.random = () => 0;
  const e = { type: 'ravager', x: 0, y: 64, z: 0, width: 1.95, height: 2.2, yBodyRot: Math.PI, ravagerStunTick: 5 };
  ok(EL.ravagerStunParticles(e) === 1 && Px.list.length === 1, 'stun particle spawns on a 1/6 roll');
  ok(near(Px.list[0].red, 0.4980392156862745) && near(Px.list[0].y, 65.9), 'tint 0.498/0.514/0.573 at y+height-0.3');
  Px.list.length = 0; EL.random = () => 0.9;
  ok(EL.ravagerStunParticles(e) === 0 && !Px.list.length, 'no particle on a failed roll');
}
// anti-vacuity
{
  const e = { type: 'ravager', x: 0, y: 64, z: 0, width: 1.95, height: 2.2, yBodyRot: Math.PI, ravagerStunTick: 5 };
  Px.list.length = 0; EL.random = () => 0.9;
  okAv(EL.ravagerStunParticles(e) === 0, 'a failed 1/6 roll that still spawned would be caught');
  Px.list.length = 0; EL.random = () => 0; EL.ravagerStunParticles(e);
  okAv(!near(Px.list[0].red, 0.5), 'a rounded tint (0.5) is caught');
  okAv(!near(Px.list[0].y, 66), 'spawning at y+height instead of y+height-0.3 is caught');
}
console.log(`\n${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL: ' + f);
if (fails.length) process.exit(1);
