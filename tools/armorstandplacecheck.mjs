#!/usr/bin/env node
// armorstandplacecheck.mjs — #4393. (placement/interact: armorstandusecheck.) NBT read/write round trip + MobNbt save round trip. Drives 07zzt_armorstand.js,
// 14l_use.js's itemUseOn/entityUse and 07zw_mobnbt.js for real; anti-vacuity at the bottom.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); };

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js',
  '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07k_goals.js',
  '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js', '07m_breed.js',
  '07n_tame.js', '07q_effects.js', '07zw_mobnbt.js', '07zzt_armorstand.js'];

function fresh() {
  const M = loadEngine({ extra: EXTRA, dom: false });
  M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
  M.Entities.init(); M.Entities.attrs = M.DATA.entities.attrs;
  M.World.init(1); M.Behave.init(M.World);
  if (M.BlockEntities && M.BlockEntities.init) M.BlockEntities.init();
  M.EntityList.init(); M.Use.init(M.World);
  return M;
}
const M = fresh();
const { Inventory: Iv, Items: IT, EntityList: EL, ArmorStand: AS, Use } = M;
const item = (n, c = 1) => Iv.stack(n, c, 0, null);
const mkP = (instabuild = false, f = [0, 0, 1]) => {
  const P = { inventory: Iv.create(), slot: 0, instabuild, ey: 65.62, EYE: 1.62, ez: 0, ex: 0, lookVec: () => f, syncHotbar() {} };
  return P;
};
const held = (P, s) => { Iv.setItem(P.inventory, 0, s); return Iv.getItem(P.inventory, 0); };
const air = 0, UP = 2, DOWN = 3;

// § NBT round trip + save round trip
const tag = { ShowArms: 1, Small: 1, NoBasePlate: 1, Invisible: 1, Marker: 1, DisabledSlots: 4144,
  Pose: { Head: [20, 0, 0], LeftLeg: [5, 6, 7] },
  ArmorItems: [{}, {}, {}, { id: 'minecraft:diamond_helmet', Count: 1 }], HandItems: [{ id: 'minecraft:stick', Count: 1 }, {}] };
const run = (breakIt) => {
  EL.list.length = 0;
  const a = EL.spawn('armor_stand', 5.5, 64, 5.5); AS.readNbt(a, tag);
  const w1 = JSON.stringify(AS.writeNbt(a));
  let recs = JSON.parse(JSON.stringify(M.MobNbt.serializeAll()));
  if (breakIt) recs.forEach((r) => { delete r.asPose; delete r.equip; });
  EL.list.length = 0; M.MobNbt.restoreAll(recs);
  const b = EL.list.find((e) => e.type === 'armor_stand');
  return b && JSON.stringify(AS.writeNbt(b)) === w1 && b.height < 1 && AS.writeNbt(b).Pose.Head[0] === 20 && AS.pose(b, 'RightArm')[0] === -15;
};
ok(run(false), 'all flags/pose/equipment survive writeNbt -> MobNbt save -> restore -> writeNbt');
okAv(!run(true), 'drop pose+equipment from the save records and the round trip fails');
ok(AS.writeNbt(Object.assign(EL.spawn('armor_stand', 1, 64, 1), {})).Pose && Object.keys(AS.writeNbt(EL.spawn('armor_stand', 2, 64, 2)).Pose).length === 0, 'default pose writes an empty Pose compound');
// item EntityTag reaches a placed stand
{ const P = mkP(); Iv.setItem(P.inventory, 0, Iv.stack('armor_stand', 1, 0, { EntityTag: { ShowArms: 1, Small: 1 } }));
  Use.itemUseOn(P, 10, 63, 10, 2, 1, Iv.getItem(P.inventory, 0));
  const s1 = EL.list.find((e) => e.type === 'armor_stand'); ok(s1 && s1.showArms && s1.small, 'item EntityTag applied on placement'); }
// #4897: clicked cell is used only if replaceable (tall_grass), else the face neighbour (torch)
{ const S = M.States, place = (blk) => { EL.list.length = 0; 
    const P = mkP(); Iv.setItem(P.inventory, 0, item('armor_stand')); Use.itemUseOn(P, 10, 64, 10, UP, S.stateOf(blk), Iv.getItem(P.inventory, 0));
    const e = EL.list.find((x) => x.type === 'armor_stand'); return e && Math.floor(e.y); };
  ok(place('torch') === 65, 'torch top click: stand spawns one above the torch, got ' + place('torch'));
  ok(place('tall_grass') === 64, 'tall_grass top click: stand replaces the grass cell, got ' + place('tall_grass'));
 }
console.log(pass + ' assertions, ' + fails.length + ' failures, ' + breaks + ' breaks caught');
if (fails.length) { fails.forEach((m) => console.log('  FAIL: ' + m)); process.exit(1); }
