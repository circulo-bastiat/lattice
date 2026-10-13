#!/usr/bin/env node
// blastknockbackcheck.mjs -- #5085: ProtectionEnchantment.transformExplosionKnockback.
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
const ench = (id, lvl) => ({ i: 0, c: 1, t: { Enchantments: [{ id: 'minecraft:' + id, lvl }] } });
// levels[slot] = level (or 0); ench id overridable for the anti-vacuity cases
function vx(type, levels, id, opts) {
  const M = freshEngine();
  const e = M.EntityList.spawn(type, 2.5, 70, 0.5, opts || {});
  if (!e) { console.log('x spawn failed ' + type); process.exit(1); }
  const IT = M.Items;
  const slots = [IT.FEET, IT.LEGS, IT.CHEST, IT.HEAD];
  e.equip = [];
  levels.forEach((l, i) => { if (l) e.equip[slots[i]] = ench(id || 'blast_protection', l); });
  e.vx = 0;
  M.Explosion.damageEntities(null, 0.5, 70, 0.5, 4);
  return e.vx;
}
let fail = 0, breaks = 0;
const ok = (c, m) => { if (!c) { console.log('x ' + m); fail++; } };
const bare = vx('zombie', [0, 0, 0, 0]);
ok(bare > 0, 'bare zombie not pushed');
// ix is shared, so vx scales with the transformed s; recover s from the bare run (ix*s = bare)
const ratio = (l, v) => v / bare;
const want = (l) => { const s = 0.5; return l ? (s - Math.floor(s * Math.fround(l * Math.fround(0.15)))) / s : 1; };
for (let l = 0; l <= 4; l++) {
  const one = vx('zombie', [0, 0, l, 0]);
  const four = vx('zombie', [l, 1 <= l ? l : 0, l, l]);
  const mixed = vx('zombie', [l, 0, 0, Math.max(0, l - 1)]);
  // s is a fraction <1 so floor(s*k) is 0 unless s*k>=1: tolerate by computing from real s
  ok(Math.abs(ratio(l, four) - ratio(l, one)) < 1e-12, `level ${l}: four pieces != one piece (sum used?)`);
  ok(Math.abs(ratio(l, mixed) - ratio(l, one)) < 1e-12, `level ${l}: mixed pieces != max`);
  ok(one <= bare + 1e-12, `level ${l}: knockback grew`);
}
// vanilla: s - floor(s*0.15*l); with s<1 exposure fraction floor(...) is 0 unless s*0.15*l >= 1 -> formula check on the helper
{
  const M = freshEngine();
  const z = M.EntityList.spawn('zombie', 0.5, 70, 0.5, {});
  const IT = M.Items;
  for (const [l, s, w] of [[0, 3, 3], [1, 10, 9], [2, 10, 7], [4, 10, 4], [4, 2.5, 1.5], [3, 7, 4]]) {
    z.equip = []; if (l) z.equip[IT.CHEST] = ench('blast_protection', l);
    const g = M.Explosion.knockbackScale(z, s);
    ok(g === w, `knockbackScale(l=${l}, s=${s}) = ${g}, want ${w}`);
  }
  z.equip = []; z.equip[IT.HEAD] = ench('blast_protection', 2); z.equip[IT.FEET] = ench('blast_protection', 3);
  ok(M.Explosion.knockbackScale(z, 10) === 10 - Math.floor(10 * Math.fround(3 * Math.fround(0.15))), 'two pieces: max (3), not sum');
  // anti-vacuity: wrong enchantment / summed levels must differ from vanilla
  z.equip = []; z.equip[IT.CHEST] = ench('fire_protection', 4);
  breaks++; if (M.Explosion.knockbackScale(z, 10) !== 10) { console.log('x vacuous: fire_protection'); fail++; }
  z.equip = []; z.equip[IT.HEAD] = ench('blast_protection', 2); z.equip[IT.FEET] = ench('blast_protection', 2);
  breaks++; if (M.Explosion.knockbackScale(z, 10) === 10 - Math.floor(10 * Math.fround(4 * Math.fround(0.15)))) { console.log('x vacuous: sum'); fail++; }
}
// non-living unchanged
{
  const M = freshEngine();
  const e = M.EntityList.spawn('item', 2.5, 70, 0.5, { item: 'stone', count: 1 });
  e.equip = []; e.equip[M.Items.CHEST] = ench('blast_protection', 4);
  ok(M.Explosion.knockbackScale(e, 10) === 10, 'non-living knockback changed');
}
console.log(`${breaks} breaks caught, ${fail} failed`);
process.exit(fail ? 1 : 0);
