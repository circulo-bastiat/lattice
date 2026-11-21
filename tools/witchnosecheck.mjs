#!/usr/bin/env node
// witchnosecheck.mjs -- #1000: WitchEntityModel.setAngles nose wiggle / drinking lift, and
// WitchEntity.handleStatus(15) magic particles (.decomp WitchEntity.java:185-199).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
console.log('witchnosecheck - witch nose animation + status 15 particles (#1000)');

const M = loadEngine({ extra: ['07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07j_entityrender.js',
  '07zx_particle.js', '10_gfx.js', '15h_bemodel.js'], dom: false });
initRegistry(M);
{
  const mm = JSON.parse(readFileSync(join(ASSETS, 'models.meta.json'), 'utf8'));
  M.BEModel.init({ models: readFileSync(join(ASSETS, 'models.bin')).toString('base64'), modelsBytes: mm.rawBytes });
}
const ER = M.EntityRender, BE = M.BEModel, Px = M.Particle;
ER.init();
const D = Math.PI / 180;
const rest = BE.layer('witch').parts.find((p) => p.n === 'nose');

function run(er, id, age, drinking) {
  const a = { limbSwing: 0, limbSwingAmount: 0, netHeadYaw: 0, headPitch: 0, riding: false, ageInTicks: age, witch: { id, drinking } };
  const p = er.posedPart(rest, a, 'witch');
  return p;
}
function checks(er, o) {
  let p = run(er, 3, 100, false), f = 0.03;
  o(Math.abs(p.rx - Math.sin(100 * f) * 4.5 * D) < 1e-5, 'nose pitch = sin(age*f)*4.5deg');
  o(Math.abs(p.rz - Math.cos(100 * f) * 2.5 * D) < 1e-5, 'nose roll = cos(age*f)*2.5deg');
  o(p.py === -2 && p.pz === 0 && p.px === 0, 'nose pivot (0,-2,0) when not drinking');
  p = run(er, 13, 100, false);
  o(Math.abs(p.rx - Math.sin(100 * 0.03) * 4.5 * D) < 1e-5, 'id%10 folds the wiggle speed');
  p = run(er, 3, 100, true);
  o(p.py === 1 && p.pz === -1.5 && Math.abs(p.rx + 0.9) < 1e-5, 'drinking: pivot (0,1,-1.5), pitch -0.9');
}
checks(ER, ok);

// status 15
{
  const fixed = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };
  const e = { x: 1, y: 64, z: 2, height: 1.95 };
  Px.list.length = 0;
  const n = Px.spawnWitchMagic(e, fixed([0.5]));
  ok(n > 0 && Px.list.length === n && Px.list.every((p) => p.type === 'witch'), 'status 15 spawns witch particles (' + n + ')');
  ok(Px.list.every((p) => Math.abs(p.y - (64 + 1.95 + 0.5)) < 1), 'particles sit near maxY + 0.5');
  ok(Px.list.every((p) => p.green === 0 && p.red === p.blue), 'witch tint (c, 0, c)');
  const M0 = Px.spawnWitchMagic(e, fixed([0]));   // nextInt(35)+10 with roll 0 => 10 (bound re-rolled, still 10)
  ok(M0 === 10, 'count floor is 10 (got ' + M0 + ')');
}

// anti-vacuity
{
  const broken = Object.create(ER);
  broken.posedPart = (r, a, l) => ER.posedPart(r, Object.assign({}, a, { witch: null }), l);
  const lf = []; checks(broken, (c, m) => { if (!c) lf.push(m); return c; });
  ok(lf.length > 0, 'disabling the witch ctx fails the nose checks');
  console.log('   ✓ ' + lf.length + ' breaks caught');
  if (!lf.length) fails.push('no breaks caught');
}
if (fails.length) { console.log(pass + ' assertions, ' + fails.length + ' failures'); fails.forEach((f) => console.log('  x ' + f)); console.log('FAIL witchnosecheck'); process.exit(1); }
console.log('PASS witchnosecheck: ' + pass + ' assertions, 0 failures, 1 breaks caught');
