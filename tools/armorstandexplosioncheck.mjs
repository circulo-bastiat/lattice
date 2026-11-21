#!/usr/bin/env node
// armorstandexplosioncheck.mjs -- #4895: ArmorStandEntity.isImmuneToExplosion() == isInvisible():
// an invisible stand takes no explosion damage and no knockback; a visible one is pushed.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
               '07e_loot.js', '07h_entities.js', '14b_physics.js', '14c_raycast.js',
               '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
               '14j_combat.js', '07za_explosion.js', '07zzl_enderdragon.js', '07zzn_endcrystal.js', '07zzt_armorstand.js'];

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

function run(invisible) {
  const M = freshEngine();
  const e = M.EntityList.spawn('armor_stand', 4.5, 70, 0.5, { Invisible: invisible });
  if (!e) { console.log('x spawn failed'); process.exit(1); }
  e.invisible = invisible;
  M.Explosion.damageEntities(null, 0.5, 70, 0.5, 4);
  return e;
}
let fail = 0, breaks = 0;
const vis = run(false), inv = run(true);
// vanilla pushes a visible stand (even as it breaks); an immune one is untouched
const pushed = (e) => (e.vx || 0) !== 0;
if (!pushed(vis)) { console.log('x visible stand not hit'); fail++; }
if (pushed(inv) || (inv.vz || 0) !== 0) { console.log('x invisible stand hit'); fail++; }
// anti-vacuity: the same setup with the flag flipped must change the outcome
breaks++; if (pushed(vis) === pushed(inv)) { console.log('x vacuous: invisible flag has no effect'); fail++; }
console.log(`${breaks} breaks caught, ${fail} failed`);
process.exit(fail ? 1 : 0);
