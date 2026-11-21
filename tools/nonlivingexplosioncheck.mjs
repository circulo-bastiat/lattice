#!/usr/bin/env node
// nonlivingexplosioncheck.mjs -- #4895: ArmorStandEntity.isImmuneToExplosion() == isInvisible():
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

function blast(type, dx, opts) {
  const M = freshEngine();
  const e = M.EntityList.spawn(type, 0.5 + dx, 70, 0.5, opts || {});
  if (!e) { console.log('x spawn failed ' + type); process.exit(1); }
  M.Explosion.damageEntities(null, 0.5, 70, 0.5, 4);
  return e;
}
let fail = 0, breaks = 0;
const ok = (c, m) => { if (!c) { console.log('x ' + m); fail++; } };
const item = blast('item', 1, { item: 'stone', count: 1 });
ok(item.removed, 'item 1 block from blast not removed');
const edge = blast('item', 7, { item: 'stone', count: 1 });
ok(!edge.removed && Math.abs(edge.vx - (1 - 7 / 8)) < 0.2 && edge.vx > 0, 'edge item not pushed: ' + edge.vx);
ok(blast('experience_orb', 1, { value: 1 }).removed, 'xp orb not removed');
const tnt = blast('tnt', 3, { fuse: 80 });
ok(tnt.vx > 0.1, 'primed tnt not shoved');
// anti-vacuity: with the branch disabled every case must fail
for (const [t, o, chk] of [['item', { item: 'stone', count: 1 }, (e, vx0) => e.removed], ['experience_orb', { value: 1 }, (e, vx0) => e.removed], ['tnt', { fuse: 80 }, (e, vx0) => e.vx - vx0 > 0.1]]) {
  const M = freshEngine();
  M.Explosion.NONLIVING = {};
  const e = M.EntityList.spawn(t, t === 'tnt' ? 3.5 : 1.5, 70, 0.5, o);
  const vx0 = e.vx;
  M.Explosion.damageEntities(null, 0.5, 70, 0.5, 4);
  breaks++; if (chk(e, vx0)) { console.log('x vacuous: ' + t); fail++; }
}
console.log(`${breaks} breaks caught, ${fail} failed`);
process.exit(fail ? 1 : 0);
