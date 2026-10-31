// villagerheadshakecheck.mjs -- #1000: WitchEntityModel.setAngles nose wiggle / drinking lift, and
// WitchEntity.handleStatus(15) magic particles (.decomp WitchEntity.java:185-199).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
console.log('villagerheadshakecheck - villager head shake (#4058)');

const M = loadEngine({ extra: ['07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07j_entityrender.js',
  '07zx_particle.js', '10_gfx.js', '15h_bemodel.js'], dom: false });
initRegistry(M);
{
  const mm = JSON.parse(readFileSync(join(ASSETS, 'models.meta.json'), 'utf8'));
  M.BEModel.init({ models: readFileSync(join(ASSETS, 'models.bin')).toString('base64'), modelsBytes: mm.rawBytes });
}
const ER = M.EntityRender, BE = M.BEModel, Px = M.Particle;
ER.init();
const rest = BE.layer('villager').parts.find((p) => p.n === 'head');
const run = (er, age, shake, pitch) => er.posedPart(rest, { limbSwing: 0, limbSwingAmount: 0, netHeadYaw: 0, headPitch: pitch, riding: false, ageInTicks: age, headShake: shake }, 'villager');
function checks(er, o) {
  // VillagerResemblingModel.setAngles :72-86: roll = 0.3*sin(0.45*age), pitch = 0.4 while headRollingTimeLeft>0
  let p = run(er, 10, true, 25);
  o(Math.abs(p.rz - 0.3 * Math.sin(4.5)) < 1e-5, 'shaking head roll = 0.3*sin(0.45*age)');
  o(Math.abs(p.rx - 0.4) < 1e-5, 'shaking head pitch = 0.4');
  p = run(er, 10, false, 25);
  o(Math.abs(p.rz) < 1e-5 && Math.abs(p.rx - 25 * Math.PI / 180) < 1e-5, 'not shaking: roll 0, pitch = headPitch');
}
checks(ER, ok);
{
  const broken = Object.create(ER);
  broken.posedPart = (r, a, l) => ER.posedPart(r, Object.assign({}, a, { headShake: false }), l);
  const lf = []; checks(broken, (c, m) => { if (!c) lf.push(m); return c; });
  ok(lf.length > 0, 'disabling headShake fails the checks');
  console.log('   ✓ ' + lf.length + ' breaks caught');
  if (!lf.length) fails.push('no breaks caught');
}
if (fails.length) { console.log(pass + ' assertions, ' + fails.length + ' failures'); fails.forEach((f) => console.log('  x ' + f)); console.log('FAIL villagerheadshakecheck'); process.exit(1); }
console.log('PASS villagerheadshakecheck: ' + pass + ' assertions, 0 failures, 1 breaks caught');
