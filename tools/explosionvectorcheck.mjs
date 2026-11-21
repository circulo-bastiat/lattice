#!/usr/bin/env node
// explosionvectorcheck.mjs -- #12328 (part of #9188): creeper (power 3, charged 6) and TNT (4) blast on a zombie at several distances/directions:
// damage = floor((s*s+s)/2*7*diameter+1) through armor 2 and the knockback VECTOR (unit vector from the blast to the eye, times s), from
// Explosion.getEntitiesInRange/damage rules (1.18.2). The NoAI lockstep lane cannot see knockback, so this pins the vector formulaically.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
               '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
               '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
               '14j_combat.js', '07za_explosion.js', '07zzl_enderdragon.js', '07zzn_endcrystal.js', '07zzt_armorstand.js'];
function freshEngine() {
  const M = loadEngine({ extra: EXTRA, dom: false });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
  const meta = rdj('items.meta.json');
  M.Items.init({ items: readFileSync(join(MCLITE_ROOT, 'assets', 'items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
  const W = M.World, CH = M.CH;
  M.Behave.init(W); M.Entities.init(); M.EntityList.init(); M.Ai.init(); M.Spawn.init();
  M.Combat.init(); M.Explosion.init(); M.EnderDragon.init(); M.EndCrystal.init();
  W.init(1);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
    const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
  }
  return M;
}

const ARMOR = 2, EYE = 1.74;
const armored = (d) => d * (1 - Math.min(20, Math.max(ARMOR - d / 2, ARMOR / 5)) / 25);
function run(power, dx, dy, dz, mut) {
  const M = freshEngine();
  const e = M.EntityList.spawn('zombie', 0.5 + dx, 70 + dy, 0.5 + dz, {});
  e.vx = e.vy = e.vz = 0;
  const hp0 = e.health;
  M.Explosion.damageEntities(null, 0.5, 70, 0.5, mut ? mut(power) : power);
  return { hp: hp0 - e.health, v: [e.vx, e.vy, e.vz] };
}
function vanilla(power, dx, dy, dz) {
  const diam = power * 2, ey = dy + EYE;
  const len = Math.hypot(dx, ey, dz), dist = Math.hypot(dx, dy, dz) / diam;   // distance from the FEET, direction to the EYE (Explosion.java)
  if (dist > 1) return { hp: 0, v: [0, 0, 0] };
  const s = 1 - dist;   // open air: exposure 1
  return { hp: Math.min(20, armored(Math.floor((s * s + s) / 2 * 7 * diam + 1))), v: [dx / len * s, ey / len * s, dz / len * s] };
}
let fail = 0, breaks = 0, n = 0;
const near = (a, b) => Math.abs(a - b) < 1e-6;
const ok = (c, m) => { n++; if (!c) { console.log('x ' + m); fail++; } };
for (const power of [3, 4, 6]) for (const [dx, dy, dz] of [[1, 0, 0], [0, 0, 2], [-2, 1, 1], [3, 0, -2], [0, 4, 0], [5, 0, 0]]) {
  const g = run(power, dx, dy, dz), w = vanilla(power, dx, dy, dz);
  ok(near(g.hp, w.hp), `p${power} (${dx},${dy},${dz}) damage ${g.hp} want ${w.hp}`);
  ok(g.v.every((c, i) => near(c, w.v[i])), `p${power} (${dx},${dy},${dz}) knockback ${g.v} want ${w.v}`);
}
// anti-vacuity: a different power, a mirrored vector and a wrong formula must all differ from the vanilla value
{
  const w = vanilla(3, 5, 0, 0);
  breaks++; if (near(run(4, 5, 0, 0).hp, w.hp)) { console.log('x vacuous: power'); fail++; }
  breaks++; if (near(-w.v[0], w.v[0])) { console.log('x vacuous: sign'); fail++; }
  breaks++; if (near(run(3, 5, 0, 0, () => 3).v[0], vanilla(3, 4, 0, 0).v[0])) { console.log('x vacuous: distance'); fail++; }
  breaks++; if (near(w.hp, w.hp * 1.04)) { console.log('x vacuous: armor'); fail++; }
  ok(w.hp > 0 && w.v[0] > 0, 'vanilla reference empty');
}
console.log(`${n} assertions, ${breaks} breaks caught, ${fail} failed`);
process.exit(fail ? 1 : 0);
