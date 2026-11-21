#!/usr/bin/env node
// parrotshouldercheck.mjs — #3929: ShoulderParrotFeatureRenderer. player.shoulderLeft/Right {type:'parrot',parrotVariant}
// draws a parrot (variant skin, ON_SHOULDER pose) at the player's shoulder in third person. Proves it can fail.
import { loadEngine, initRegistry } from './loadsrc.mjs';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { join } from 'node:path';
import { MCLITE_ROOT, ASSETS } from './loadsrc.mjs';

const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js', '14j_combat.js', '07za_explosion.js', '07m_breed.js', '07t_fly.js', '07zw_mobnbt.js', '07zx_particle.js', '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js'],
  dom: false
});
initRegistry(M);
{
  const mm = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'models.meta.json'), 'utf8'));
  M.BEModel.init({ models: readFileSync(join(MCLITE_ROOT, 'assets', 'models.bin')).toString('base64'), modelsBytes: mm.rawBytes });
}
const raw = readFileSync(join(MCLITE_ROOT, 'assets', 'mob-geometry.json'));
M.DATA = Object.assign({}, M.DATA, { mobGeometry: deflateRawSync(raw, { level: 9 }).toString('base64'), mobGeometryBytes: raw.length,
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.EntityRender.init();
const ER = M.EntityRender, EL = M.EntityList;
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const near = (a, b) => Math.abs(a - b) < 1e-4;
M.Player = { thirdPerson: 1, ex: 10, ey: 64, ez: 10, yaw: 0, yawO: 0, pitch: 0, walkDist: 0 };
const P = M.Player;
const mobs = () => ER.visible(10, 65, 10, 1).filter(it => it.e && it.e.shoulder);
const run = () => {
  const o = [];
  P.shoulderLeft = P.shoulderRight = null;
  o.push(mobs().length === 0);
  P.shoulderLeft = { type: 'parrot', parrotVariant: 3 };
  { const m = mobs(); o.push(m.length === 1 && m[0].mobLayer === 'parrot' && m[0].shape === 'mob');
    o.push(m.length === 1 && m[0].texKey === M.Fly.PARROT_SKIN[3]);
    // yaw 0 looks -Z, right is +X: the LEFT shoulder is -X of the player, 0.4*0.9375 out, ~1.4 up
    o.push(m.length === 1 && near(m[0].x, 10 - 0.4 * 0.9375) && near(m[0].z, 10) && near(m[0].y, 64 + 1.501 * 0.9375));
    o.push(m.length === 1 && near(M.EntityRender.mobScale(m[0].e, 1).sy, 0.9375)); }
  P.shoulderRight = { type: 'parrot', parrotVariant: 1 };
  { const m = mobs(); o.push(m.length === 2 && near(m[1].x, 10 + 0.4 * 0.9375) && m[1].texKey === M.Fly.PARROT_SKIN[1]); }
  P.shoulderLeft = { type: 'cat' };
  o.push(mobs().length === 1);
  P.shoulderLeft = { type: 'parrot', parrotVariant: 0 }; P.thirdPerson = 0;
  o.push(mobs().length === 0);   // first person: no player body, no shoulder layer
  P.thirdPerson = 1;
  // ON_SHOULDER pose: flap 0, no leg swing
  { const a = ER.parrotAnim(mobs()[0].e, 1); o.push(a.pose === 'shoulder' && a.flap === 0);
    o.push(near(ER.setupAnimDelta('left_leg', 2, 0.5, 0, 0, false, 'quadruped', { parrot: { pose: 'shoulder', age: 0, flap: 0 } }).rx, -0.0299)); }
  return o;
};
const good = (o) => o.every(Boolean);
run().forEach((v, i) => ok(v, 'assertion #' + i));
const caught = (label, fn, restore) => {
  fn(); let bad; try { bad = !good(run()); } catch (e) { bad = true; }
  restore(); breaks += bad ? 1 : 0;
  if (bad) console.log(`   ✓ break caught: ${label}`); else fails.push('anti-vacuity: ' + label + ' went unnoticed');
};
{ const o = ER.shoulderParrots; caught('shoulder layer draws nothing', () => { ER.shoulderParrots = () => []; }, () => { ER.shoulderParrots = o; }); }
{ const o = ER.shoulderParrots; caught('right shoulder mirrored onto left', () => { ER.shoulderParrots = (pe) => { const r = o(pe); r.forEach(e => { e.x = e.px = 10 - 0.4 * 0.9375; }); return r; }; }, () => { ER.shoulderParrots = o; }); }
{ const o = ER.shoulderParrots; caught('variant ignored', () => { ER.shoulderParrots = (pe) => { const r = o(pe); r.forEach(e => { e.parrotVariant = 0; }); return r; }; }, () => { ER.shoulderParrots = o; }); }
{ const o = ER.parrotAnim; caught('shoulder pose flaps', () => { ER.parrotAnim = (e, p) => { const a = o(e, p); if (a) { a.pose = 'standing'; a.flap = 0.5; } return a; }; }, () => { ER.parrotAnim = o; }); }

console.log('\n================ parrotshouldercheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('  ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
