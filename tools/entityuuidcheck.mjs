#!/usr/bin/env node
// entityuuidcheck.mjs — #5626: every EL.spawn'd entity has a UUID; saved; TNT igniter resolved by UUID, not index.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js',
               '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js',
               '14c_raycast.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
               '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js', '07m_breed.js',
               '07n_tame.js', '07o_profession.js', '07r_mount.js', '07ze_llama.js', '07t_fly.js',
               '07q_effects.js', '07zf_bat.js', '07zg_enderman.js', '07zh_rabbit.js', '07zj_fox.js',
               '07zj_goat.js', '07zl_panda.js', '07zm_axolotl.js', '07zn_mooshroom.js', '07zo_bee.js',
               '07zz2_dolphin.js', '07zj_fish.js', '07zp_turtle.js', '07zr_zvillager.js', '07s_raid.js', '07w_passive.js', '07zk_undead.js', '09b_sky.js', '16b_save.js', '07zw_mobnbt.js',
               '07zb_creeper.js', '07zd_slime.js', '07zi_squid.js', '07x_patrol.js', '07v_spell.js', '07zt_wtrader.js'];

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

let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

const run = (mode) => {
  const MCL = freshMCL();
  const EL = MCL.EntityList, Mb = MCL.MobNbt;
  const ev = EL.spawn('evoker', 10.5, 64, 10.5);
  const pig = EL.spawn('pig', 14.5, 64, 10.5);
  const tnt = EL.spawn('tnt', 12.5, 64, 10.5, { fuse: 60, igniter: ev });
  const before = { ev: ev.uuid, pig: pig.uuid, tnt: tnt.uuid };
  EL.list.reverse();   // the igniter's index in the save is no longer its spawn order
  const real = Mb.serializeAll;
  if (mode === 'nouuid') Mb.serializeAll = () => real().map((r) => { delete r.UUID; return r; });
  if (mode === 'noigniter') Mb.serializeAll = () => real().map((r) => { delete r.igniterUuid; return r; });
  MCL.Save.save(false);
  Mb.serializeAll = real;
  EL.clear(); MCL.Save.load(); Mb.restoreAll(MCL.Save.mobRecords);
  const g = (t) => EL.list.find((e) => e.type === t);
  return { before, ev: g('evoker'), pig: g('pig'), tnt: g('tnt') };
};
const good = run('');
ok(good.before.ev && good.before.pig && good.before.ev !== good.before.pig && good.before.tnt !== good.before.pig, 'spawned entities have distinct uuids');
ok(good.ev && good.ev.uuid === good.before.ev && good.pig.uuid === good.before.pig && good.tnt.uuid === good.before.tnt, 'uuids survive save/load');
ok(good.tnt && good.tnt.igniter === good.ev, 'igniter is the same entity after load and list reorder');
const b1 = run('nouuid');
breaks++; ok(!(b1.ev && b1.ev.uuid === b1.before.ev), 'anti-vacuity: dropping UUID is seen'); console.log('  ✓ break caught: dropping UUID is seen');
const b2 = run('noigniter');
breaks++; ok(!(b2.tnt && b2.tnt.igniter === b2.ev), 'anti-vacuity: dropping igniterUuid is seen'); console.log('  ✓ break caught: dropping igniterUuid is seen');

console.log(`OK  ${pass} checks passed, ${fails.length} failures; ${breaks} breaks caught`);
if (fails.length) { fails.forEach((m) => console.log('  FAIL: ' + m)); process.exit(1); }
