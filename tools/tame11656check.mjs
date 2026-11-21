#!/usr/bin/env node
// tame11656check.mjs — #11656: proves 07zw_mobnbt.js's Tameable persistence (Tame/Owner/Sitting on wolf, cat, parrot) through
// MobNbt.serializeAll -> restoreAll (the real EL.spawn path). Source breaks (a field struck from the species row) must fail.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
const EXTRA = ['02f_tags.js', '07z_potion.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js',
               '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js',
               '14c_raycast.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
               '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js', '07m_breed.js',
               '07n_tame.js', '07o_profession.js', '07r_mount.js', '07ze_llama.js', '07t_fly.js',
               '07q_effects.js', '07zf_bat.js', '07zg_enderman.js', '07zh_rabbit.js', '07zj_fox.js',
               '07zj_goat.js', '07zl_panda.js', '07zm_axolotl.js', '07zn_mooshroom.js', '07zo_bee.js',
               '07zz2_dolphin.js', '07zj_fish.js', '07zp_turtle.js', '07zr_zvillager.js', '07s_raid.js', '07w_passive.js', '07zk_undead.js', '09b_sky.js', '16b_save.js', '07zw_mobnbt.js',
               '07zb_creeper.js', '07zd_slime.js', '07zi_squid.js', '07x_patrol.js', '07v_spell.js', '07zt_wtrader.js', '07zzm_wither.js', '07zzf_piglin.js', '07zzq_rail.js', '07zzr_minecart.js', '07zzt_boat.js', '07zz_xporb.js', '07zzh_blaze.js', '07zzi_ghast.js', '07zc_tnt.js', '07z_potion.js', '07zzd_throw.js', '15g_commands.js', '07zzs_portal.js'];
let asserted = 0;
function run(patch) {
  const f = [], no = (c, m) => { asserted++; if (!c) f.push(m); };
  const M = loadEngine({ extra: EXTRA, dom: false, patch });
  M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
  M.Entities.init(); M.Entities.attrs = M.DATA.entities.attrs;
  M.World.init(1); M.Behave.init(M.World);
  if (M.BlockEntities && M.BlockEntities.init) M.BlockEntities.init();
  M.EntityList.init();
  if (M.Breed && M.Breed.init) M.Breed.init();
  if (M.Tame && M.Tame.init) M.Tame.init();
  const EL = M.EntityList;
  for (const t of ['wolf', 'cat', 'parrot']) {
    const e = EL.spawn(t, 0, 64, 0);
    if (!e) { f.push('no spawn ' + t); continue; }
    e.tamed = true; e.owner = 'player'; e.sitting = true;
    const recs = M.MobNbt.serializeAll().filter((r) => r.type === t);
    no(recs.length === 1, t + ' not serialized');
    const r = recs[0] || {};
    no(r.tamed === true && r.owner === 'player' && r.sitting === true, t + ' record lacks Tame/Owner/Sitting');
    EL.list.length = 0;
    M.MobNbt.restoreAll(recs);
    const g = EL.list.find((x) => x.type === t);
    no(g && g.tamed === true && g.owner === 'player' && g.sitting === true, t + ' reload lost Tame/Owner/Sitting');
  }
  return f;
}
const fails = run();
const brk = (a, b) => (f, s) => { if (f !== '07zw_mobnbt.js') return s; if (!s.includes(a)) throw new Error('anchor gone: ' + a); return s.replace(a, b); };
const mutants = [
  ['wolf tamed', brk("wolf: ['tamed', 'owner'", "wolf: ['owner'")],
  ['cat owner', brk("cat: ['tamed', 'owner', 'sitting'", "cat: ['tamed', 'sitting'")],
  ['parrot sitting', brk("parrot: ['parrotVariant', 'tamed', 'owner', 'sitting']", "parrot: ['parrotVariant', 'tamed', 'owner']")],
];
let caught = 0;
for (const [name, patch] of mutants) {
  let bad; try { bad = run(patch); } catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('   ✓ broken (' + name + ') → ' + bad[0]); } else fails.push('mutant NOT caught: ' + name);
}
if (fails.length) { console.log('tame11656check: FAIL'); fails.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log('assertions passed ..... ' + asserted);
console.log('tame11656check: OK — ' + caught + ' breaks caught');
