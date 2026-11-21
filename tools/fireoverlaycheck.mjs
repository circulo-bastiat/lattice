#!/usr/bin/env node
// fireoverlaycheck.mjs -- #2268: a burning entity (isOnFire / blaze fireActive) gets a fire-block overlay entry
// in ER.visible; a non-burning one does not. Anti-vacuity: break the gate and the checks fail ("<n> breaks caught").
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { loadEngine, initRegistry, MCLITE_ROOT, ASSETS } from './loadsrc.mjs';
import { join } from 'node:path';
const M = loadEngine({
  extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
          '07zb_creeper.js', '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js', '07w_passive.js', '07zzj_strider.js'],
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
  // §4/§5 (loop/fleece-s97) drive ER.visible through a REAL EntityList, which refuses to
  // initialise (EL.ready stays false, ER.visible then a no-op) without entities.json's own
  // species table — §1-§3 never needed EL.list at all (they hand-build entity objects and call
  // ER.emitMobLayer directly), which is why this was never loaded before this session.
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8'))
});
M.Entities.init();
M.EntityList.init();
M.EntityRender.init();
M.Passive.init();
const ER = M.EntityRender;
const fails = []; let total = 0;
const ok = (c, m) => { total++; if (!c) fails.push(m); };
const mk = (over) => Object.assign({ type: 'zombie', x: 0, y: 5, z: 0, px: 0, py: 5, pz: 0, yaw: 0, pyaw: 0, age: 0,
  width: 0.6, height: 1.95 }, over);
const fireIts = (e) => { M.EntityList.list = [e]; return ER.visible(0, 5, 0, 1).filter((it) => it.shape === 'mushroom' && it.state === M.States.stateOf('fire')); };
const cases = () => {
  const a = fireIts(mk({ isOnFire: true }));
  ok(a.length === 1, 'burning zombie draws one fire overlay');
  ok(a.length === 1 && Math.abs(a[0].mush.m[0] - 0.84) < 1e-9 && a[0].mush.m[4] === 1.95, 'overlay is width*1.4 wide, full height');
  ok(fireIts(mk({ type: 'blaze', width: 0.6, height: 1.8, fireActive: true })).length === 1, 'charging blaze (fireActive) draws fire');
  ok(fireIts(mk({})).length === 0, 'non-burning zombie draws none');
  ok(fireIts(mk({ type: 'blaze', height: 1.8 })).length === 0, 'idle blaze draws none');
};
cases();
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
// anti-vacuity: with the overlay's own state lookup broken, the checks must fail
let breaks = 0;
const real = M.States.stateOf;
M.States.stateOf = () => 0;
const n0 = fails.length; cases();
if (fails.length > n0) { breaks++; console.log("   ✓ broken state lookup caught"); }
M.States.stateOf = real; fails.length = 0;
const sv = ER.visible; ER.visible = () => []; const n1 = fails.length; cases(); if (fails.length > n1) { breaks++; console.log("   ✓ broken ER.visible caught"); } ER.visible = sv;
if (breaks !== 2) { console.log('FAIL: anti-vacuity broke only ' + breaks); process.exit(1); }
console.log(`OK  ${total} checks passed, 0 failures; ${breaks} breaks caught`);
