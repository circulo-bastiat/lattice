// projchorusflowercheck.mjs - #8665: ChorusFlowerBlock.onProjectileHit via Cb.PROJ_BLOCK_HIT.chorus_flower.
// A projectile whose type is in entity_types tag impact_projectiles breaks the flower and drops chorus_flower.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const A = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js', '14b_physics.js', '14f_inventory.js',
          '07f_redstone.js', '09b_sky.js', '07d_mining.js', '07e_loot.js', '07h_entities.js', '07i_entitylist.js', '07k_goals.js', '14j_combat.js'],
  dom: false, initReg: true
});
M.Items.init({ items: readFileSync(join(A, 'items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
const Cb = M.Combat, S = M.States, T = M.Tags;
const CF = S.stateOf('chorus_flower');
const cells = new Map(); const k = (x, y, z) => x + ',' + y + ',' + z;
M.World = { getBlock: (x, y, z) => cells.get(k(x, y, z)) || 0, setBlock: (x, y, z, s) => { cells.set(k(x, y, z), s); return true; } };
M.Loot.ready = true; M.Loot.breakDrops = (st) => (st === CF ? [{ item: 'chorus_flower', count: 1 }] : []);
let dropped = [];
M.EntityList.ready = true; M.EntityList.popResource = (x, y, z, it, n) => dropped.push(it + 'x' + n);
const tag = T.members('entity_types', 'impact_projectiles').map(T.key);
ok(tag.length > 0, 'impact_projectiles resolves from the tag data');
for (const n of ['arrow', 'spectral_arrow', 'trident', 'snowball']) ok(tag.includes(n), n + ' is in impact_projectiles');
const hit = (type) => {
  cells.clear(); dropped = []; cells.set(k(0, 0, 0), CF);
  Cb.PROJ_BLOCK_HIT.chorus_flower({ type }, { cx: 0, cy: 0, cz: 0, state: CF });
  return cells.get(k(0, 0, 0)) === 0;
};
for (const t of ['arrow', 'spectral_arrow', 'trident', 'snowball', 'ender_pearl', 'experience_bottle', 'zombie', 'item']) {
  const broke = hit(t);
  ok(broke === tag.includes(t), t + ' breaks the flower iff in the tag (broke=' + broke + ')');
  if (tag.includes(t)) ok(dropped.length === 1 && dropped[0] === M.Items.of('chorus_flower') + 'x1', t + ' drops one chorus_flower');
  else ok(dropped.length === 0, t + ' drops nothing');
}
// anti-vacuity: with the handler removed, the flower must survive
{
  const real = Cb.PROJ_BLOCK_HIT.chorus_flower; delete Cb.PROJ_BLOCK_HIT.chorus_flower; breaks++;
  cells.clear(); cells.set(k(0, 0, 0), CF);
  Cb.projectileBlockHit({ type: 'arrow' }, { cx: 0, cy: 0, cz: 0, state: CF });
  ok(cells.get(k(0, 0, 0)) === CF, 'without the handler the flower survives (break is real)');
  Cb.PROJ_BLOCK_HIT.chorus_flower = real;
  cells.clear(); cells.set(k(0, 0, 0), CF);
  Cb.projectileBlockHit({ type: 'arrow' }, { cx: 0, cy: 0, cz: 0, state: CF });
  ok(cells.get(k(0, 0, 0)) === 0, 'dispatch breaks the flower through projectileBlockHit');
}
if (fails.length) { console.log('FAIL\n  ' + fails.join('\n  ')); process.exit(1); }
console.log(`${pass} assertions, 0 failures, ${breaks} breaks caught`);
