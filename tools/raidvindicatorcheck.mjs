#!/usr/bin/env node
// raidvindicatorcheck.mjs — #2751: Rd.addBonusForWave on a vindicator (VindicatorEntity.addBonusForWave,
// .decomp:174-189): always a NEW iron_axe, sharpness 1 (wave<=5) / 2 (wave>5) at getEnchantmentChance,
// replacing whatever spawnFn handed it (default axe + updateEnchantments roll).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07_world.js', '07h_entities.js',
  '09b_sky.js', '14b_physics.js', '07y_equip.js', '07i_entitylist.js', '07s_raid.js'] });
{
  const meta = JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8'));
  M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
}
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Equip.init(); M.Raid.init();
const Rd = M.Raid, Eq = M.Equip, IT = M.Items;
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const enchOf = (m) => { const s = Eq.getEquipped(m, IT.MAINHAND); return s ? ((s.t && s.t.Enchantments) || []).map(e => e.id + ':' + e.lvl).join() : null; };
const run = (level, wave, roll) => {
  const mob = { type: 'vindicator' };
  Eq.setEquipped(mob, IT.MAINHAND, Eq.stackOf('iron_axe'));
  Eq.applyEnchants(Eq.getEquipped(mob, IT.MAINHAND), [{ id: 'fire_aspect', lvl: 1 }]);   // spawnFn's junk roll
  Rd.addBonusForWave({ badOmenLevel: level }, mob, wave, { nextFloat: () => roll });
  const s = Eq.getEquipped(mob, IT.MAINHAND);
  return { name: s && s.id !== undefined ? s.id : (s && s.n), ench: enchOf(mob) };
};
const a = run(3, 3, 0.1);   ok(a.ench === 'minecraft:sharpness:1', 'wave 3 roll hit -> sharpness 1, junk replaced: ' + a.ench);
const b = run(3, 6, 0.1);   ok(b.ench === 'minecraft:sharpness:2', 'wave 6 -> sharpness 2: ' + b.ench);
const c = run(3, 6, 0.9);   ok(c.ench === '', 'roll miss -> plain axe, junk replaced: ' + c.ench);
const d = run(3, 3, 0.25);  ok(d.ench === 'minecraft:sharpness:1', 'roll == chance still enchants (<=)');
// anti-vacuity: break each expectation's input and require the check to notice
breaks++; ok(run(3, 5, 0.1).ench !== 'minecraft:sharpness:2', 'wave 5 must NOT be sharpness 2');
breaks++; ok(run(2, 3, 0.2).ench === '', 'level 2 chance 0.1: roll 0.2 misses');
breaks++; ok(run(1, 3, 0.5).ench === '', 'level 1 chance 0: never enchants');
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `PASS raidvindicatorcheck — ${pass} assertions, ${breaks} breaks caught, 0 failure(s)`);
process.exit(fails.length ? 1 : 0);
