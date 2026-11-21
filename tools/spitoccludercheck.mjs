#!/usr/bin/env node
// #4632: a spectator player / dying mob on the spit line must not shadow the live mob behind it (ProjectileEntity.canHit).
import { loadEngine } from './loadsrc.mjs';
const M = loadEngine({ extra: ['02i_text.js', '14d_survival.js', '14j_combat.js', '07i_entitylist.js', '07ze_llama.js'], dom: false });
const Ll = M.Llama, NS = M;
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const hits = [];
Object.assign(NS.Combat, { hurt: (t) => { hits.push(t); return true; }, notifyHurt() {}, arrowRaycast: () => null, arrowTouchingWater: () => false });
NS.Survival.hurt = (t) => { hits.push(t); return true; };
const run = (front, back) => {
  hits.length = 0; NS.EntityList = { list: [front, back].filter(Boolean) };
  const sp = { type: 'llama_spit', x: 0, y: 64, z: 0, vx: 0, vy: 0, vz: 1, shooter: { x: -9, y: 64, z: -9, width: 0.9, height: 1.9 }, leftOwner: true };
  for (let i = 0; i < 12 && !sp.removed && !hits.length; i++) { sp.z += 1; Ll.tick(sp); }
  return hits.slice();
};
const mob = (z, x = {}) => Object.assign({ type: 'zombie', x: 0, y: 64, z, width: 0.6, height: 1.8, maxHealth: 20, health: 20 }, x);
const live = mob(6);
NS.Player = null;
ok(run(mob(3, { dead: true }), live)[0] === live, 'dying mob (dead) does not shadow live target');
ok(run(mob(3, { health: 0 }), live)[0] === live, 'health<=0 mob does not shadow live target');
NS.Player = mob(3, { maxHealth: undefined }); NS.Gamemode = { isSpectator: () => true };
ok(run(null, live)[0] === live, 'spectator player does not shadow live target');
// anti-vacuity: with the occluder alive and normal, it IS the (only) hit
NS.Gamemode = { isSpectator: () => false };
const r = run(null, live); breaks++; ok(r[0] === NS.Player, 'break caught: non-spectator player in front takes the hit');
for (const f of fails) console.log('   ✗ ' + f);
console.log(`${pass} assertions passed, ${fails.length} failed, ${breaks} breaks caught`);
process.exit(fails.length || breaks < 1 ? 1 : 0);
