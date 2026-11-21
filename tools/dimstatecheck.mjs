#!/usr/bin/env node
// dimstatecheck.mjs — G27c (#10977): each dimension keeps its OWN chunks, entities, block entities and dragon-fight
// state; World.setDimension swaps them and the save carries them (docs/decisions/254-dimension-substrate.md).
//   node tools/dimstatecheck.mjs
// Anti-vacuity (D-30): each section breaks its own data (a shared list, a dropped dimension tag) and asserts it is caught.
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const caught = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); };
const EXTRA = ['02f_tags.js', '07z_potion.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js',
               '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js',
               '14c_raycast.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
               '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js', '07m_breed.js',
               '07n_tame.js', '07o_profession.js', '07r_mount.js', '07ze_llama.js', '07t_fly.js',
               '07q_effects.js', '07zf_bat.js', '07zg_enderman.js', '07zh_rabbit.js', '07zj_fox.js',
               '07zj_goat.js', '07zl_panda.js', '07zm_axolotl.js', '07zn_mooshroom.js', '07zo_bee.js',
               '07zz2_dolphin.js', '07zj_fish.js', '07zp_turtle.js', '07zr_zvillager.js', '07s_raid.js', '07w_passive.js', '07zk_undead.js', '09b_sky.js', '16b_save.js', '07zw_mobnbt.js',
               '07zb_creeper.js', '07zd_slime.js', '07zi_squid.js', '07x_patrol.js', '07v_spell.js', '07zt_wtrader.js', '07zzm_wither.js', '07zzf_piglin.js', '07zzq_rail.js', '07zzr_minecart.js', '07zzt_boat.js', '07zz_xporb.js', '07zzh_blaze.js', '07zzi_ghast.js', '07zc_tnt.js', '07z_potion.js', '07zzd_throw.js', '15g_commands.js', '07zzs_portal.js'];

function freshMCL() {
  const store = {};
  const MCL = loadEngine({ extra: EXTRA, dom: false });
  MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
  MCL.Entities.init();
  MCL.Entities.attrs = MCL.DATA.entities.attrs;
  MCL.World.init(1);
  MCL.Behave.init(MCL.World);
  if (MCL.BlockEntities && MCL.BlockEntities.init) MCL.BlockEntities.init();
  MCL.EntityList.init();
  if (MCL.Breed && MCL.Breed.init) MCL.Breed.init();
  if (MCL.Tame && MCL.Tame.init) MCL.Tame.init();
  if (MCL.Profession && MCL.Profession.init) MCL.Profession.init();
  // ⚠ 16b_save.js is main-thread/DOM code (localStorage, btoa/atob). Node has neither — the
  // SAME stub shape savecheck.mjs already uses for the same reason, not a new convention.
  globalThis.btoa = globalThis.btoa || ((s) => Buffer.from(s, 'binary').toString('base64'));
  globalThis.atob = globalThis.atob || ((s) => Buffer.from(s, 'base64').toString('binary'));
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  // `S.save` unconditionally calls `NS.Player.toJSON()`; this check has no live player, only
  // mobs, so it stubs the one field 16b_save.js reaches for outside `S.encode`/`MobNbt`.
  MCL.Player = { toJSON: () => ({ x: 0, y: 64, z: 0 }), fromJSON: () => false };
  MCL.Save.init();
  return MCL;
}

const NETHER = 'the_nether';
function scenario(M) {
  const W = M.World, EL = M.EntityList, BE = M.BlockEntities;
  M.EnderDragon = M.EnderDragon || { activeFight: null };
  const pig = EL.spawn('pig', 10.5, 64, 10.5);
  BE.create(5, 64, 5, 'chest');
  M.EnderDragon.activeFight = { tag: 'overworld-fight' };
  W.setDimension(NETHER);
  const hog = EL.spawn('piglin', 3.5, 70, 3.5);
  BE.create(7, 70, 7, 'chest').items[0] = { i: 5, n: 9 };
  W.getOrCreate(0, 0);
  return { pig, hog };
}

// 1. swap: nothing leaks across, everything is back on return
{
  const M = freshMCL(), W = M.World, EL = M.EntityList, BE = M.BlockEntities;
  const { pig, hog } = scenario(M);
  ok(pig && hog, 'spawned a pig and a piglin');
  ok(EL.list.includes(hog) && !EL.list.includes(pig), 'in the nether EL.list holds only nether entities');
  ok(hog.dimension === NETHER && pig.dimension === 'overworld', 'entities carry their dimension');
  ok(!BE.get(5, 64, 5) && !!BE.get(7, 70, 7), 'nether sees only its own block entity');
  ok(M.EnderDragon.activeFight === null, 'the overworld dragon fight is not live in the nether');
  W.setDimension('overworld');
  ok(EL.list.includes(pig) && !EL.list.includes(hog), 'back in the overworld: the pig is back, the piglin is not');
  ok(!!BE.get(5, 64, 5) && !BE.get(7, 70, 7), 'overworld block entity back, nether one hidden');
  ok(M.EnderDragon.activeFight && M.EnderDragon.activeFight.tag === 'overworld-fight', 'fight state restored on return');
  W.setDimension(NETHER);
  ok(BE.get(7, 70, 7).items[0].n === 9 && EL.list.includes(hog), 'second visit: nether chest contents and piglin survived');
  ok(W.dims[NETHER].size > 0, 'nether chunks survived');
  // break: the old shared-list substrate (swap disabled) would leak the pig into the nether
  const M3 = freshMCL(); M3.World.swapDimState = () => {};
  const p3 = M3.EntityList.spawn('pig', 1.5, 64, 1.5); M3.World.setDimension(NETHER);
  caught(M3.EntityList.list.includes(p3), 'with the swap disabled the overworld pig is still in the nether list');
}

// 2. save / load round trip with the player in the nether
function roundTrip(strike) {
  const M = freshMCL();
  scenario(M);
  if (strike) { const f = M.BlockEntities.serializeAll; M.BlockEntities.serializeAll = () => f().map((r) => { delete r.dimension; return r; }); }
  M.Save.save(false);
  const raw = globalThis.localStorage.getItem(M.Save.KEY);
  const M2 = freshMCL();
  globalThis.localStorage.setItem(M2.Save.KEY, raw);
  M2.Save.load();
  M2.World.setDimension('overworld');
  M2.MobNbt.restoreAll(M2.Save.mobRecords);
  M2.BlockEntities.restoreAll(M2.Save.beRecords);
  const EL = M2.EntityList, BE = M2.BlockEntities;
  const res = { ow: EL.list.some((e) => e.type === 'pig') && !EL.list.some((e) => e.type === 'piglin') && !!BE.get(5, 64, 5) && !BE.get(7, 70, 7) };
  M2.World.setDimension(NETHER);
  res.nether = EL.list.some((e) => e.type === 'piglin') && !EL.list.some((e) => e.type === 'pig') && !!BE.get(7, 70, 7) && BE.get(7, 70, 7).items[0] && BE.get(7, 70, 7).items[0].n === 9 && !BE.get(5, 64, 5);
  return res;
}
{
  const r = roundTrip(false);
  ok(r.ow, 'save/load: overworld holds its pig and chest only');
  ok(r.nether, 'save/load: nether holds its piglin and chest (contents intact) only');
  const s = roundTrip(true);
  caught(!(s.ow && s.nether), 'dropping the block-entity dimension tag mixes the dimensions on load');
}

console.log(pass + ' assertions, ' + fails.length + ' failures, ' + breaks + ' breaks caught');
if (fails.length) { fails.forEach((m) => console.log('  FAIL: ' + m)); process.exit(1); }
